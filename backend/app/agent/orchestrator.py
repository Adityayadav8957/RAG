"""The agent orchestrator: ties every stage of the request flow together.

Stage order (see docs/architecture.md):
  input guardrails -> intent + policy -> semantic cache -> model routing -> agent loop
  (RAG retrieval / tool execution with approval) -> grounding validation -> output guardrails
  -> persistence, cache write, audit.

Everything the user sees is produced by ``Orchestrator`` as a stream of event dicts:
  status | token | approval_required | final | error
"""

from __future__ import annotations

import asyncio
import re
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.gateway import ToolDenied, describe_action
from app.agent.guardrails import (
    REFUSAL_INJECTION,
    check_input,
    check_output,
    sanitize_untrusted,
)
from app.agent.intent import IntentResult, choose_model, classify_intent
from app.agent.prompts import SYSTEM_PROMPT
from app.db.models import Conversation, Message, PendingAction
from app.db.session import get_sessionmaker
from app.llm.client import LLMError, LLMMessage, ToolCall, ToolSpec, llm_provider_ctx
from app.logging import get_logger
from app.observability.audit import audit
from app.observability.metrics import CHAT_REQUESTS, LLM_CALLS
from app.observability.trace_events import Trace, elapsed_ms
from app.observability.tracing import span
from app.rag.retrieval import RetrievedChunk, retrieve
from app.security.rbac import Principal
from app.services import Services

log = get_logger("orchestrator")

KNOWLEDGE_TOOL = ToolSpec(
    name="search_company_knowledge",
    description=(
        "Search the company's internal documents (policies, handbooks, procedures). "
        "Returns numbered excerpts you must cite as [n]."
    ),
    parameters={
        "type": "object",
        "properties": {"query": {"type": "string", "description": "Self-contained search query"}},
        "required": ["query"],
    },
)

NO_EVIDENCE_ANSWER = (
    "I couldn't find anything about that in the company documents you have access to. "
    "Try rephrasing, or ask the document owner to upload it."
)
UNGROUNDED_NOTICE = "\n\n_Note: this answer is not backed by a cited company document._"
MAX_HISTORY_MESSAGES = 24
_CITATION = re.compile(r"\[(\d{1,3})\]")


class ConversationNotFound(Exception):
    pass


class ActionNotFound(Exception):
    """Unknown, already decided, expired, or not owned by the caller."""


@dataclass
class RunState:
    principal: Principal
    conversation_id: uuid.UUID
    intent: IntentResult
    model: str
    cache_vector: list[float] | None = None
    user_text: str = ""
    sources: dict[int, RetrievedChunk] = field(default_factory=dict)
    source_numbers: dict[uuid.UUID, int] = field(default_factory=dict)
    used_tools: bool = False
    no_evidence: bool = False
    awaiting_approval: bool = False
    final_text: str = ""
    llm_calls: int = 0
    trace: Trace = field(default_factory=Trace)


def _event(type_: str, **kwargs: Any) -> dict[str, Any]:
    return {"type": type_, **kwargs}


def _chunk_text(text: str, size: int = 40) -> list[str]:
    words = re.findall(r"\S+\s*", text)
    return ["".join(words[i : i + size]) for i in range(0, len(words), size)] or [""]


class Orchestrator:
    def __init__(self, services: Services) -> None:
        self._s = services

    # ------------------------------------------------------------------ public API

    async def chat(
        self, principal: Principal, conversation_id: uuid.UUID, text: str
    ) -> AsyncIterator[dict[str, Any]]:
        s = self._s
        async with get_sessionmaker()() as session:
            conv = await self._load_conversation(session, principal, conversation_id)
            await self._supersede_pending(session, conversation_id)

            trace = Trace()
            yield _event("status", step="Checking your request")
            t0 = time.perf_counter()
            with span("input_guardrails"):
                verdict = await check_input(text, settings=s.settings, policy=s.policy, llm=s.llm)
            trace.step(
                "input",
                "Input guardrails",
                status="done" if verdict.allowed else "blocked",
                ms=elapsed_ms(t0),
                checks=["prompt injection", "policy rules", "PII masking"],
                flags=verdict.flags,
                masked=verdict.allowed and verdict.text != text,
                reason=None if verdict.allowed else verdict.reason,
            )
            for ev in trace.drain():
                yield ev
            if not verdict.allowed:
                CHAT_REQUESTS.labels(intent="-", outcome="blocked_input").inc()
                await audit(
                    "chat.input_blocked",
                    actor_id=principal.user_id,
                    resource=f"conversation:{conversation_id}",
                    details={"flags": verdict.flags},
                )
                await self._add_message(session, conversation_id, "user", "[message blocked]", None)
                async for ev in self._emit_final(
                    session,
                    conversation_id,
                    verdict.reason or REFUSAL_INJECTION,
                    [],
                    cached=False,
                    trace=trace,
                ):
                    yield ev
                return

            clean_text = verdict.text
            await self._add_message(session, conversation_id, "user", clean_text, {"flags": verdict.flags})
            if conv.title == "New chat":
                conv.title = clean_text[:60]
            await session.commit()

            yield _event("status", step="Understanding your request")
            t0 = time.perf_counter()
            # The query embedding (for the cache) does not depend on the intent, so overlap them.
            embed_task = (
                asyncio.create_task(s.llm.embed([clean_text], task="query"))
                if s.settings.cache_enabled
                else None
            )
            try:
                with span("intent"):
                    intent = await classify_intent(s.llm, s.settings, clean_text)
            except BaseException:
                if embed_task:
                    embed_task.cancel()
                raise
            trace.step(
                "intent",
                "Intent and policy",
                status="blocked" if intent.intent == "unsafe" else "done",
                ms=elapsed_ms(t0),
                intent=intent.intent,
                complexity=intent.complexity,
                needs_knowledge=intent.needs_knowledge,
                summary=intent.summary,
                provider=llm_provider_ctx.get(),
            )
            for ev in trace.drain():
                yield ev
            if intent.intent == "unsafe":
                CHAT_REQUESTS.labels(intent="unsafe", outcome="refused").inc()
                await audit(
                    "chat.unsafe_refused",
                    actor_id=principal.user_id,
                    resource=f"conversation:{conversation_id}",
                    details={"summary": intent.summary},
                )
                async for ev in self._emit_final(
                    session, conversation_id, "I can't help with that request.", [], cached=False, trace=trace
                ):
                    yield ev
                return

            state = RunState(principal, conversation_id, intent, choose_model(s.settings, intent))
            state.trace = trace
            state.user_text = clean_text

            # --- semantic cache (never for actions) ---------------------------------
            cached = None
            if intent.intent in ("knowledge", "simple") and s.settings.cache_enabled:
                t0 = time.perf_counter()
                try:
                    assert embed_task is not None
                    (state.cache_vector,) = await embed_task
                    cached = await s.cache.get(session, principal, state.cache_vector)
                except LLMError:
                    cached = None
                trace.step(
                    "cache",
                    "Semantic cache",
                    status="done",
                    ms=elapsed_ms(t0),
                    result="hit" if cached is not None else "miss",
                    note="Hits are re-checked against your document permissions.",
                )
            else:
                if embed_task:
                    embed_task.cancel()
                reason = (
                    "answers that use tools are never cached"
                    if intent.intent == "action"
                    else "small talk is not cached"
                    if intent.intent == "smalltalk"
                    else "cache disabled"
                )
                trace.step("cache", "Semantic cache", status="skipped", result="skipped", note=reason)
            for ev in trace.drain():
                yield ev
            if cached is not None:
                yield _event("status", step="Found a verified earlier answer")
                out = check_output(cached.answer, settings=s.settings, policy=s.policy)
                if not out.blocked:
                    CHAT_REQUESTS.labels(intent=intent.intent, outcome="cache_hit").inc()
                    await audit(
                        "chat.answered",
                        actor_id=principal.user_id,
                        resource=f"conversation:{conversation_id}",
                        details={"cached": True, "intent": intent.intent},
                    )
                    async for ev in self._emit_final(
                        session, conversation_id, out.text, cached.citations, cached=True, trace=trace
                    ):
                        yield ev
                    return

            # --- agent loop -----------------------------------------------------------
            trace.step(
                "router",
                "Model router",
                model=state.model,
                tier="frontier" if state.model == s.settings.model_frontier else "small",
                why=f"{intent.intent} request, {intent.complexity} complexity",
            )
            for ev in trace.drain():
                yield ev
            history = await self._history(session, conversation_id)
            if intent.needs_knowledge and intent.intent != "action":
                yield _event("status", step="Searching company documents")
                excerpts = await self._search(session, state, clean_text)
                for ev in trace.drain():
                    yield ev
                if history and history[-1].role == "user" and excerpts:
                    history[-1].text = f"{history[-1].text}\n\nRelevant excerpts:\n{excerpts}"
                if intent.intent == "knowledge" and not excerpts:
                    # Nothing readable for this user: no model call can fix that.
                    state.final_text = NO_EVIDENCE_ANSWER
                    async for ev in self._finalize(session, state):
                        yield ev
                    return
            # A pure knowledge question already has its excerpts: answer directly, no tool round trip.
            direct = intent.intent == "knowledge" and bool(state.sources)
            async for ev in self._loop(session, state, history, use_tools=not direct):
                yield ev

    async def resume(
        self, principal: Principal, action_id: uuid.UUID, approve: bool
    ) -> AsyncIterator[dict[str, Any]]:
        s = self._s
        async with get_sessionmaker()() as session:
            now = datetime.now(UTC)
            # Atomic compare-and-set: a pending action can be decided exactly once.
            stmt = (
                update(PendingAction)
                .where(
                    PendingAction.id == action_id,
                    PendingAction.user_id == principal.user_id,
                    PendingAction.status == "pending",
                    PendingAction.expires_at > now,
                )
                .values(status="approved" if approve else "rejected", decided_at=now)
                .returning(PendingAction)
            )
            action = (await session.execute(stmt)).scalar_one_or_none()
            await session.commit()
            if action is None:
                raise ActionNotFound()
            await audit(
                "tool.approved" if approve else "tool.rejected",
                actor_id=principal.user_id,
                resource=f"action:{action.id}",
                details={"tool": action.tool, "arguments": action.arguments},
            )
            await self._load_conversation(session, principal, action.conversation_id)

            resume_trace = Trace()
            resume_trace.step(
                "approval",
                "Human approval",
                status="done" if approve else "blocked",
                decision="approved" if approve else "rejected",
                tool=action.tool,
                summary=action.summary,
            )
            for ev in resume_trace.drain():
                yield ev
            if approve:
                yield _event("status", step=f"Running {action.tool}")
                t0 = time.perf_counter()
                with span("tool_execute", tool=action.tool):
                    result = await s.gateway.execute(session, principal, action.tool, action.arguments)
                resume_trace.step(
                    "tool",
                    action.tool,
                    ms=elapsed_ms(t0),
                    access="write",
                    on_behalf_of="your Jira account",
                    outcome="error" if result.startswith("ERROR") else "ok",
                )
                for ev in resume_trace.drain():
                    yield ev
                await session.commit()
                await audit(
                    "tool.executed",
                    actor_id=principal.user_id,
                    resource=f"action:{action.id}",
                    details={"tool": action.tool},
                )
            else:
                result = "The user rejected this action. Do not retry it; acknowledge and offer alternatives."
            await self._add_message(
                session,
                action.conversation_id,
                "tool",
                result,
                {"tool_call_id": action.call_id, "name": action.tool},
            )
            await session.commit()

            intent = IntentResult(intent="action", complexity="high", needs_knowledge=False)
            state = RunState(principal, action.conversation_id, intent, s.settings.model_frontier)
            state.used_tools = True
            state.trace = resume_trace
            history = await self._history(session, action.conversation_id)
            async for ev in self._loop(session, state, history):
                yield ev

    # ------------------------------------------------------------------ agent loop

    async def _loop(
        self, session: AsyncSession, state: RunState, messages: list[LLMMessage], use_tools: bool = True
    ) -> AsyncIterator[dict[str, Any]]:
        s = self._s
        specs = [KNOWLEDGE_TOOL, *await s.gateway.specs_for(state.principal)] if use_tools else []
        for _step in range(s.settings.max_agent_steps):
            yield _event("status", step="Thinking")
            result = None
            t0 = time.perf_counter()
            try:
                with span("llm_generate", model=state.model):
                    LLM_CALLS.labels(model=state.model, purpose="agent").inc()
                    result = await s.llm.generate(
                        model=state.model, system=SYSTEM_PROMPT, messages=messages, tools=specs or None
                    )
                state.trace.step(
                    "llm",
                    f"Model call {state.llm_calls + 1}",
                    ms=elapsed_ms(t0),
                    model=state.model,
                    provider=llm_provider_ctx.get(),
                    decided="call tools: " + ", ".join(c.name for c in result.tool_calls)
                    if result.tool_calls
                    else "write the answer",
                )
                for ev in state.trace.drain():
                    yield ev
            except LLMError:
                state.trace.step(
                    "llm", "Model call failed", status="error", ms=elapsed_ms(t0), model=state.model
                )
                for ev in state.trace.drain():
                    yield ev
                if state.model != s.settings.model_small:
                    state.model = s.settings.model_small  # degrade gracefully on frontier limits
                    continue
            if result is None:
                CHAT_REQUESTS.labels(intent=state.intent.intent, outcome="llm_error").inc()
                yield _event(
                    "error", message="The assistant is temporarily unavailable. Please retry shortly."
                )
                return
            state.llm_calls += 1

            if not result.tool_calls:
                state.final_text = result.text
                break

            state.used_tools = True
            messages.append(LLMMessage("assistant", result.text, result.tool_calls))
            await self._add_message(
                session,
                state.conversation_id,
                "assistant",
                result.text,
                {
                    "tool_calls": [
                        {"id": c.id, "name": c.name, "args": c.args, "sig": c.signature}
                        for c in result.tool_calls
                    ]
                },
            )
            deferred = False
            for call in result.tool_calls:
                if deferred:
                    text = "Not executed: an earlier action is waiting for the user's approval."
                    await self._record_tool_result(session, state, messages, call, text)
                    continue
                async for ev in self._dispatch(session, state, messages, call):
                    yield ev
                deferred = state.awaiting_approval
            await session.commit()
            if state.no_evidence and state.intent.intent == "knowledge" and not state.sources:
                state.final_text = NO_EVIDENCE_ANSWER
                break
            if state.awaiting_approval:
                CHAT_REQUESTS.labels(intent=state.intent.intent, outcome="awaiting_approval").inc()
                return
        else:
            state.final_text = (
                "I wasn't able to finish that within my step limit. Please try a narrower request."
            )

        async for ev in self._finalize(session, state):
            yield ev

    async def _record_tool_result(
        self, session: AsyncSession, state: RunState, messages: list[LLMMessage], call: ToolCall, text: str
    ) -> None:
        messages.append(LLMMessage("tool", text, tool_call_id=call.id, tool_name=call.name))
        await self._add_message(
            session, state.conversation_id, "tool", text, {"tool_call_id": call.id, "name": call.name}
        )

    async def _dispatch(
        self, session: AsyncSession, state: RunState, messages: list[LLMMessage], call: ToolCall
    ) -> AsyncIterator[dict[str, Any]]:
        s, p = self._s, state.principal
        if call.name == KNOWLEDGE_TOOL.name:
            yield _event("status", step="Searching company documents")
            query = str(call.args.get("query", "")).strip()[:500]
            text = await self._search(session, state, query) if query else "ERROR: empty query"
            for ev in state.trace.drain():
                yield ev
            if not text:
                # Nothing readable exists for this user: retrying the search cannot help.
                state.no_evidence = True
                text = (
                    "No relevant documents found. The knowledge base has nothing on this topic for "
                    "this user. Do not search again; tell the user plainly that nothing was found."
                )
            await self._record_tool_result(session, state, messages, call, text)
            return

        try:
            policy = s.gateway.authorize(p, call.name)
        except ToolDenied as exc:
            state.trace.step("tool", call.name, status="blocked", reason=str(exc))
            for ev in state.trace.drain():
                yield ev
            await audit(
                "tool.denied",
                actor_id=p.user_id,
                resource=f"tool:{call.name}",
                details={"reason": str(exc), "arguments": call.args},
            )
            await self._record_tool_result(session, state, messages, call, f"ERROR: {exc}")
            return

        if policy.approval:
            now = datetime.now(UTC)
            action = PendingAction(
                conversation_id=state.conversation_id,
                user_id=p.user_id,
                tool=call.name,
                call_id=call.id,
                arguments=call.args,
                summary=describe_action(call.name, call.args),
                expires_at=now + timedelta(minutes=s.settings.approval_ttl_minutes),
            )
            session.add(action)
            await session.flush()
            state.awaiting_approval = True
            state.trace.step(
                "approval",
                "Human approval",
                status="waiting",
                tool=call.name,
                summary=action.summary,
                expires_in_minutes=s.settings.approval_ttl_minutes,
            )
            for ev in state.trace.drain():
                yield ev
            await audit(
                "tool.approval_requested",
                actor_id=p.user_id,
                resource=f"action:{action.id}",
                details={"tool": call.name, "arguments": call.args},
            )
            yield _event(
                "approval_required",
                action={
                    "id": str(action.id),
                    "tool": call.name,
                    "summary": action.summary,
                    "arguments": call.args,
                    "expires_at": action.expires_at.isoformat(),
                },
            )
            return

        yield _event("status", step=f"Running {call.name}")
        t0 = time.perf_counter()
        with span("tool_execute", tool=call.name):
            text = await s.gateway.execute(session, p, call.name, call.args)
        state.trace.step(
            "tool",
            call.name,
            ms=elapsed_ms(t0),
            access=policy.access,
            on_behalf_of="your Jira account",
            outcome="error" if text.startswith("ERROR") else "ok",
            result_checked="scanned for injection, wrapped as untrusted data",
        )
        for ev in state.trace.drain():
            yield ev
        await audit(
            "tool.executed",
            actor_id=p.user_id,
            resource=f"tool:{call.name}",
            details={"arguments": call.args},
        )
        await self._record_tool_result(session, state, messages, call, text)

    # ------------------------------------------------------------------ RAG

    async def _search(self, session: AsyncSession, state: RunState, query: str) -> str:
        s = self._s
        t0 = time.perf_counter()
        with span("retrieval") as extra:
            chunks = await retrieve(
                session=session,
                principal=state.principal,
                query=query,
                llm=s.llm,
                index=s.chunk_index,
                settings=s.settings,
                # The cache lookup already embedded the user's own text; reuse it.
                query_vector=state.cache_vector if query == state.user_text else None,
            )
            extra["hits"] = len(chunks)
        parts: list[str] = []
        dropped = 0
        for chunk in chunks:
            number = state.source_numbers.get(chunk.chunk_id)
            if number is None:
                number = len(state.sources) + 1
            fenced, _ = sanitize_untrusted(f"DOCUMENT EXCERPT {number}", chunk.text, s.settings)
            if fenced is None:
                await audit(
                    "retrieval.injection_dropped",
                    actor_id=state.principal.user_id,
                    resource=f"document:{chunk.document_id}",
                    details={"chunk_id": str(chunk.chunk_id)},
                )
                dropped += 1
                continue
            state.source_numbers[chunk.chunk_id] = number
            state.sources[number] = chunk
            parts.append(f"[{number}] Source: {chunk.title}\n{fenced}")
        state.trace.step(
            "retrieval",
            "Search company documents",
            ms=elapsed_ms(t0),
            method="vector + keyword, permission-filtered",
            hits=[
                {"n": state.source_numbers[c.chunk_id], "title": c.title}
                for c in chunks
                if c.chunk_id in state.source_numbers
            ],
            dropped_for_injection=dropped,
        )
        return "\n\n".join(parts)

    # ------------------------------------------------------------------ validation + output

    def _validate_grounding(self, state: RunState, text: str) -> tuple[str, bool, list[dict[str, Any]]]:
        """Evidence validation. Returns (text, grounded, citations)."""
        used = {int(n) for n in _CITATION.findall(text)}
        valid = {n for n in used if n in state.sources}
        # Drop citation markers that point at nothing we actually retrieved.
        for n in used - valid:
            text = text.replace(f"[{n}]", "")
        citations = [
            {
                "n": n,
                "document_id": str(state.sources[n].document_id),
                "title": state.sources[n].title,
                "chunk_id": str(state.sources[n].chunk_id),
                "excerpt": state.sources[n].text[:300],
            }
            for n in sorted(valid)
        ]
        needs_grounding = state.intent.intent == "knowledge" and state.intent.needs_knowledge
        if not needs_grounding or not self._s.settings.strict_grounding:
            return text, bool(valid) or not needs_grounding, citations
        if not state.sources:
            return NO_EVIDENCE_ANSWER, False, []
        if not valid:
            return text + UNGROUNDED_NOTICE, False, []
        return text, True, citations

    async def _finalize(self, session: AsyncSession, state: RunState) -> AsyncIterator[dict[str, Any]]:
        s, p = self._s, state.principal
        t0 = time.perf_counter()
        with span("validate_and_guard"):
            text, grounded, citations = self._validate_grounding(state, state.final_text or "")
            if not text.strip():
                text = "I don't have an answer for that."
            out = check_output(text, settings=s.settings, policy=s.policy)
        if out.blocked or out.modified:
            await audit(
                "chat.output_guardrail",
                actor_id=p.user_id,
                resource=f"conversation:{state.conversation_id}",
                details={"blocked": out.blocked, "reasons": out.reasons},
            )
        text = out.text
        if out.blocked:
            citations = []
        state.trace.step(
            "validation",
            "Answer validation",
            ms=elapsed_ms(t0),
            grounded=grounded,
            citations=len(citations),
            sources_retrieved=len(state.sources),
        )
        state.trace.step(
            "output",
            "Output guardrails",
            status="blocked" if out.blocked else "done",
            checks=["secret and PII masking", "policy rules", "no tracking images"],
            masked=out.modified and not out.blocked,
            reasons=out.reasons,
        )
        for ev in state.trace.drain():
            yield ev

        cacheable = (
            state.cache_vector is not None
            and not state.used_tools
            and grounded
            and not out.blocked
            and not out.modified
            and state.intent.intent in ("knowledge", "simple")
        )
        async for ev in self._emit_final(
            session, state.conversation_id, text, citations, cached=False, trace=state.trace
        ):
            yield ev
        CHAT_REQUESTS.labels(intent=state.intent.intent, outcome="answered").inc()
        await audit(
            "chat.answered",
            actor_id=p.user_id,
            resource=f"conversation:{state.conversation_id}",
            details={
                "cached": False,
                "intent": state.intent.intent,
                "model": state.model,
                "llm_calls": state.llm_calls,
                "sources": len(citations),
            },
        )
        if cacheable and state.cache_vector is not None:
            try:
                await s.cache.put(
                    p, state.cache_vector, text, citations, [uuid.UUID(c["document_id"]) for c in citations]
                )
            except Exception:  # noqa: BLE001 - cache is best-effort
                log.warning("cache_write_failed", exc_info=True)

    async def _emit_final(
        self,
        session: AsyncSession,
        conversation_id: uuid.UUID,
        text: str,
        citations: list[dict[str, Any]],
        *,
        cached: bool,
        trace: Trace | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        # The text is only released after validation and DLP, so "streaming" replays the
        # already-approved answer instead of forwarding raw model tokens.
        data: dict[str, Any] = {"citations": citations, "cached": cached}
        if trace is not None:
            trace.step("done", "Answer ready", total_ms=trace.total_ms, cached=cached)
            data["trace"] = trace.events
        msg = await self._add_message(session, conversation_id, "assistant", text, data)
        await session.commit()
        if trace is not None:
            for ev in trace.drain():
                yield ev
        for piece in _chunk_text(text):
            yield _event("token", text=piece)
        yield _event("final", message_id=str(msg.id), text=text, citations=citations, cached=cached)

    # ------------------------------------------------------------------ persistence helpers

    async def _load_conversation(
        self, session: AsyncSession, principal: Principal, conversation_id: uuid.UUID
    ) -> Conversation:
        conv = (
            await session.execute(
                select(Conversation).where(
                    Conversation.id == conversation_id, Conversation.user_id == principal.user_id
                )
            )
        ).scalar_one_or_none()
        if conv is None:
            raise ConversationNotFound()
        return conv

    async def _supersede_pending(self, session: AsyncSession, conversation_id: uuid.UUID) -> None:
        await session.execute(
            update(PendingAction)
            .where(PendingAction.conversation_id == conversation_id, PendingAction.status == "pending")
            .values(status="superseded", decided_at=datetime.now(UTC))
        )

    async def _add_message(
        self,
        session: AsyncSession,
        conversation_id: uuid.UUID,
        role: str,
        text: str,
        data: dict[str, Any] | None,
    ) -> Message:
        msg = Message(conversation_id=conversation_id, role=role, text=text, data=data)
        session.add(msg)
        await session.flush()
        return msg

    async def _history(self, session: AsyncSession, conversation_id: uuid.UUID) -> list[LLMMessage]:
        rows = (
            (
                await session.execute(
                    select(Message)
                    .where(Message.conversation_id == conversation_id)
                    .order_by(Message.created_at.desc(), Message.id)
                    .limit(MAX_HISTORY_MESSAGES)
                )
            )
            .scalars()
            .all()
        )
        rows = list(reversed(rows))
        answered = {r.data.get("tool_call_id") for r in rows if r.role == "tool" and r.data}
        out: list[LLMMessage] = []
        skip_ids: set[str] = set()
        for r in rows:
            if r.role == "user":
                out.append(LLMMessage("user", r.text))
            elif r.role == "assistant":
                calls = (r.data or {}).get("tool_calls")
                if calls:
                    ids = {c["id"] for c in calls}
                    if not ids <= answered:  # unanswered call (superseded approval): drop it
                        skip_ids |= ids
                        continue
                    out.append(
                        LLMMessage(
                            "assistant",
                            r.text,
                            [ToolCall(c["id"], c["name"], c["args"], c.get("sig", "")) for c in calls],
                        )
                    )
                else:
                    out.append(LLMMessage("assistant", r.text))
            elif r.role == "tool" and r.data:
                if r.data.get("tool_call_id") in skip_ids:
                    continue
                out.append(
                    LLMMessage(
                        "tool", r.text, tool_call_id=r.data["tool_call_id"], tool_name=r.data.get("name", "")
                    )
                )
        # A valid history starts with a user turn.
        while out and out[0].role != "user":
            out.pop(0)
        return out

"""Deterministic test doubles: a fake LLM and a fake MCP client."""

from __future__ import annotations

import math
import re
import zlib
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel

from app.agent.guardrails import _InjectionJudgement
from app.agent.intent import IntentResult
from app.agent.mcp_client import McpError, McpTool
from app.llm.client import LLMMessage, LLMResult, ToolCall, ToolSpec
from app.rag.retrieval import _Ranking

DIM = 768


def embed_text(text: str) -> list[float]:
    """Hashed bag-of-words embedding: similar wording -> high cosine similarity."""
    vec = [0.0] * DIM
    for word in re.findall(r"[a-z0-9]+", text.lower()):
        vec[zlib.crc32(word.encode()) % DIM] += 1.0
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]


class FakeLLM:
    def __init__(self) -> None:
        self.generate_calls: list[dict[str, Any]] = []
        self.models_used: list[str] = []
        self.agent_override: Callable[[list[LLMMessage], list[ToolSpec]], LLMResult | None] | None = None

    async def embed(self, texts: list[str], *, task: str) -> list[list[float]]:
        return [embed_text(t) for t in texts]

    async def generate_json(
        self, *, model: str, system: str, prompt: str, schema: type[BaseModel], temperature: float = 0.0
    ) -> Any:
        self.models_used.append(model)
        lower = prompt.lower()
        if schema is IntentResult:
            if "jira" in lower or "ticket" in lower:
                return IntentResult(intent="action", complexity="high", needs_knowledge=False)
            if "hello" in lower:
                return IntentResult(intent="smalltalk", complexity="low", needs_knowledge=False)
            if "bypass the audit" in lower:
                return IntentResult(intent="unsafe", complexity="low", needs_knowledge=False)
            return IntentResult(intent="knowledge", complexity="low", needs_knowledge=True)
        if schema is _InjectionJudgement:
            return _InjectionJudgement(is_injection=False, confidence=0.0)
        if schema is _Ranking:
            n = len(re.findall(r"^\[\d+\]", prompt, flags=re.M))
            return _Ranking(ranking=list(range(n)))
        raise AssertionError(f"unexpected schema {schema}")

    async def generate(
        self,
        *,
        model: str,
        system: str,
        messages: list[LLMMessage],
        tools: list[ToolSpec] | None = None,
        temperature: float = 0.2,
    ) -> LLMResult:
        self.models_used.append(model)
        self.generate_calls.append({"model": model, "messages": list(messages), "tools": tools})
        if self.agent_override is not None:
            out = self.agent_override(messages, tools or [])
            if out is not None:
                return out
        last = messages[-1]
        names = {t.name for t in tools or []}
        if last.role == "tool":
            m = re.search(r"\[(\d+)\] Source: ([^\n]+)\n<<<UNTRUSTED[^\n]*\n(.{0,80})", last.text, flags=re.S)
            if m:
                return LLMResult(f"According to {m.group(2)}: {m.group(3).strip()} [{m.group(1)}]", [], model)
            return LLMResult(f"Done. Tool said: {last.text[:60]}", [], model)
        text = last.text.lower()
        if "relevant excerpts:" in text:
            m = re.search(r"\[(\d+)\] Source: ([^\n]+)\n<<<UNTRUSTED[^\n]*\n(.{0,80})", last.text, flags=re.S)
            if m:
                return LLMResult(f"According to {m.group(2)}: {m.group(3).strip()} [{m.group(1)}]", [], model)
        if "create" in text and "jira" in text and "jira_create_issue" in names:
            return LLMResult(
                "",
                [ToolCall("c1", "jira_create_issue", {"project_key": "OPS", "summary": "Printer broken"})],
                model,
            )
        if "search jira" in text and "jira_search_issues" in names:
            return LLMResult(
                "", [ToolCall("c1", "jira_search_issues", {"jql": "assignee = currentUser()"})], model
            )
        if "search_company_knowledge" in names and "?" in text:
            return LLMResult("", [ToolCall("k1", "search_company_knowledge", {"query": last.text})], model)
        return LLMResult("Hello! How can I help?", [], model)


class FakeMcp:
    """Stands in for the MCP client; records calls and the per-user headers it received."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any], dict[str, str]]] = []
        self.result = '{"key": "OPS-1"}'
        self.fail = False

    async def list_tools(self) -> list[McpTool]:
        schema = {"type": "object", "properties": {}}
        return [
            McpTool(n, n, schema)
            for n in (
                "jira_search_issues",
                "jira_get_issue",
                "jira_create_issue",
                "jira_add_comment",
                "jira_transition_issue",
                "rogue_tool",
            )
        ]

    async def call_tool(self, name: str, arguments: dict[str, Any], user_headers: dict[str, str]) -> str:
        if self.fail:
            raise McpError("Tool server unavailable")
        self.calls.append((name, arguments, user_headers))
        return self.result

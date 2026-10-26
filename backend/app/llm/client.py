"""Provider-neutral LLM interface with a Gemini implementation.

The rest of the application only depends on ``LLMClient``; swapping providers (or using a
fake in tests) means implementing four methods.
"""

from __future__ import annotations

import base64
import math
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, TypeVar

from pydantic import BaseModel
from tenacity import (
    AsyncRetrying,
    retry_if_exception,
    stop_after_attempt,
    wait_random_exponential,
)

from app.config import Settings
from app.logging import get_logger

log = get_logger("llm")

# Which provider/model served the most recent call in this task (for the activity trace).
llm_provider_ctx: ContextVar[str] = ContextVar("llm_provider", default="gemini")

T = TypeVar("T", bound=BaseModel)


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]  # JSON Schema object


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    args: dict[str, Any]
    # Opaque provider state that must accompany the call when it is sent back
    # (Gemini 3 "thought signature", base64). Empty for providers that don't use it.
    signature: str = ""


@dataclass
class LLMMessage:
    role: Literal["user", "assistant", "tool"]
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)  # assistant
    tool_call_id: str = ""  # tool
    tool_name: str = ""  # tool


@dataclass
class LLMResult:
    text: str
    tool_calls: list[ToolCall]
    model: str


class LLMError(Exception):
    """The provider failed after retries (rate limit, outage, blocked content...)."""


class LLMClient(Protocol):
    async def generate(
        self,
        *,
        model: str,
        system: str,
        messages: list[LLMMessage],
        tools: list[ToolSpec] | None = None,
        temperature: float = 0.2,
    ) -> LLMResult: ...

    async def generate_json(
        self, *, model: str, system: str, prompt: str, schema: type[T], temperature: float = 0.0
    ) -> T: ...

    async def embed(self, texts: list[str], *, task: Literal["document", "query"]) -> list[list[float]]: ...


def _is_retryable(exc: BaseException) -> bool:
    code = getattr(exc, "code", None)
    if isinstance(code, int):
        # A per-day quota will not recover within a request; fail fast so the fallback can answer.
        if code == 429 and "PerDay" in str(exc):
            return False
        return code in (408, 429, 500, 502, 503, 504)
    return isinstance(exc, TimeoutError | ConnectionError)


class GeminiClient:
    def __init__(self, settings: Settings) -> None:
        from google import genai

        if settings.gemini_api_key is None:
            raise RuntimeError("GEMINI_API_KEY is not configured")
        self._settings = settings
        self._client = genai.Client(api_key=settings.gemini_api_key.get_secret_value())

    def _retrying(self) -> AsyncRetrying:
        return AsyncRetrying(
            retry=retry_if_exception(_is_retryable),
            stop=stop_after_attempt(self._settings.llm_max_retries),
            wait=wait_random_exponential(multiplier=1.5, max=20),
            reraise=True,
        )

    async def _call(self, fn: Any, **kwargs: Any) -> Any:
        try:
            async for attempt in self._retrying():
                with attempt:
                    return await fn(**kwargs)
        except Exception as exc:  # noqa: BLE001 - normalised into a single error type
            log.warning("llm_call_failed", error=type(exc).__name__, detail=str(exc)[:300])
            raise LLMError("The language model is temporarily unavailable") from exc

    @staticmethod
    def _to_contents(messages: list[LLMMessage]) -> list[Any]:
        from google.genai import types

        contents: list[Any] = []
        for m in messages:
            if m.role == "user":
                contents.append(types.Content(role="user", parts=[types.Part.from_text(text=m.text)]))
            elif m.role == "assistant":
                parts: list[Any] = []
                if m.text:
                    parts.append(types.Part.from_text(text=m.text))
                for tc in m.tool_calls:
                    parts.append(
                        types.Part(
                            function_call=types.FunctionCall(id=tc.id, name=tc.name, args=tc.args),
                            thought_signature=base64.b64decode(tc.signature)
                            if tc.signature
                            else b"skip_thought_signature_validator",
                        )
                    )
                contents.append(types.Content(role="model", parts=parts))
            else:
                contents.append(
                    types.Content(
                        role="user",
                        parts=[
                            types.Part.from_function_response(name=m.tool_name, response={"result": m.text})
                        ],
                    )
                )
        return contents

    async def generate(
        self,
        *,
        model: str,
        system: str,
        messages: list[LLMMessage],
        tools: list[ToolSpec] | None = None,
        temperature: float = 0.2,
    ) -> LLMResult:
        from google.genai import types

        config = types.GenerateContentConfig(
            system_instruction=system,
            temperature=temperature,
            thinking_config=types.ThinkingConfig(thinking_level="low"),
            tools=[
                types.Tool(
                    function_declarations=[
                        types.FunctionDeclaration(
                            name=t.name, description=t.description, parameters_json_schema=t.parameters
                        )
                        for t in tools
                    ]
                )
            ]
            if tools
            else None,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )
        resp = await self._call(
            self._client.aio.models.generate_content,
            model=model,
            contents=self._to_contents(messages),
            config=config,
        )
        calls: list[ToolCall] = []
        for c in (resp.candidates or [])[:1]:
            for part in c.content.parts if c.content and c.content.parts else []:
                fc = part.function_call
                if fc is None:
                    continue
                sig = getattr(part, "thought_signature", None)
                calls.append(
                    ToolCall(
                        id=fc.id or f"call_{len(calls)}",
                        name=fc.name or "",
                        args=dict(fc.args or {}),
                        signature=base64.b64encode(sig).decode() if sig else "",
                    )
                )
        text = "".join(
            p.text or ""
            for c in (resp.candidates or [])[:1]
            for p in (c.content.parts if c.content and c.content.parts else [])
            if getattr(p, "text", None) and not getattr(p, "thought", False)
        )
        return LLMResult(text=text, tool_calls=calls, model=model)

    async def generate_json(
        self, *, model: str, system: str, prompt: str, schema: type[T], temperature: float = 0.0
    ) -> T:
        from google.genai import types

        config = types.GenerateContentConfig(
            system_instruction=system,
            temperature=temperature,
            response_mime_type="application/json",
            response_schema=schema,
            thinking_config=types.ThinkingConfig(thinking_level="low"),
        )
        resp = await self._call(
            self._client.aio.models.generate_content, model=model, contents=prompt, config=config
        )
        try:
            return schema.model_validate_json(resp.text or "{}")
        except ValueError as exc:
            raise LLMError("Model returned invalid structured output") from exc

    async def embed(self, texts: list[str], *, task: Literal["document", "query"]) -> list[list[float]]:
        from google.genai import types

        if not texts:
            return []
        task_type = "RETRIEVAL_DOCUMENT" if task == "document" else "RETRIEVAL_QUERY"
        dim = self._settings.embedding_dim
        vectors: list[list[float]] = []
        for i in range(0, len(texts), 64):
            batch = texts[i : i + 64]
            resp = await self._call(
                self._client.aio.models.embed_content,
                model=self._settings.embedding_model,
                contents=batch,
                config=types.EmbedContentConfig(task_type=task_type, output_dimensionality=dim),
            )
            for emb in resp.embeddings or []:
                vectors.append(_l2_normalize(list(emb.values or [])))
        if len(vectors) != len(texts):
            raise LLMError("Embedding count mismatch")
        return vectors


def _l2_normalize(v: list[float]) -> list[float]:
    # Truncated (Matryoshka) embeddings are not unit length; normalise for cosine similarity.
    norm = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / norm for x in v]

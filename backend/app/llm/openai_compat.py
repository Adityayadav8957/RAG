"""OpenAI-compatible chat client (xAI Grok, Groq, OpenRouter, Ollama, ...) and a fallback wrapper."""

from __future__ import annotations

import json
from typing import Any, Literal, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from app.config import Settings
from app.llm.client import (
    LLMClient,
    LLMError,
    LLMMessage,
    LLMResult,
    ToolCall,
    ToolSpec,
    llm_provider_ctx,
)
from app.logging import get_logger

log = get_logger("llm.compat")
T = TypeVar("T", bound=BaseModel)

_RETRYABLE = {408, 429, 500, 502, 503, 504}


class OpenAICompatClient:
    """Chat only. Embeddings are not offered, so the primary provider keeps that job."""

    def __init__(self, *, base_url: str, api_key: str, timeout: float = 60.0) -> None:
        self._http = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=httpx.Timeout(timeout),
        )

    async def _chat(self, body: dict[str, Any]) -> dict[str, Any]:
        try:
            resp = await self._http.post("/chat/completions", json=body)
        except httpx.HTTPError as exc:
            raise LLMError("The fallback language model is unreachable") from exc
        if resp.status_code >= 400:
            log.warning("fallback_llm_failed", status=resp.status_code, body=resp.text[:300])
            raise LLMError(f"Fallback model error {resp.status_code}")
        return dict(resp.json())

    @staticmethod
    def _messages(system: str, messages: list[LLMMessage]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = [{"role": "system", "content": system}]
        for m in messages:
            if m.role == "user":
                out.append({"role": "user", "content": m.text})
            elif m.role == "assistant":
                msg: dict[str, Any] = {"role": "assistant", "content": m.text or None}
                if m.tool_calls:
                    msg["tool_calls"] = [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {"name": tc.name, "arguments": json.dumps(tc.args)},
                        }
                        for tc in m.tool_calls
                    ]
                out.append(msg)
            else:
                out.append({"role": "tool", "tool_call_id": m.tool_call_id, "content": m.text})
        return out

    async def generate(
        self,
        *,
        model: str,
        system: str,
        messages: list[LLMMessage],
        tools: list[ToolSpec] | None = None,
        temperature: float = 0.2,
    ) -> LLMResult:
        body: dict[str, Any] = {
            "model": model,
            "messages": self._messages(system, messages),
            "temperature": temperature,
        }
        if tools:
            body["tools"] = [
                {
                    "type": "function",
                    "function": {"name": t.name, "description": t.description, "parameters": t.parameters},
                }
                for t in tools
            ]
        data = await self._chat(body)
        try:
            msg = data["choices"][0]["message"]
            calls = [
                ToolCall(
                    id=tc["id"],
                    name=tc["function"]["name"],
                    args=json.loads(tc["function"]["arguments"] or "{}"),
                )
                for tc in msg.get("tool_calls") or []
            ]
        except (KeyError, IndexError, ValueError) as exc:
            raise LLMError("Fallback model returned an unreadable response") from exc
        return LLMResult(text=msg.get("content") or "", tool_calls=calls, model=model)

    async def generate_json(
        self, *, model: str, system: str, prompt: str, schema: type[T], temperature: float = 0.0
    ) -> T:
        instruction = (
            f"{system}\n\nRespond with ONLY a JSON object matching this JSON Schema:\n"
            f"{json.dumps(schema.model_json_schema())}"
        )
        data = await self._chat(
            {
                "model": model,
                "messages": [{"role": "system", "content": instruction}, {"role": "user", "content": prompt}],
                "temperature": temperature,
                "response_format": {"type": "json_object"},
            }
        )
        try:
            return schema.model_validate_json(data["choices"][0]["message"]["content"] or "{}")
        except (KeyError, IndexError, ValidationError, ValueError) as exc:
            raise LLMError("Fallback model returned invalid structured output") from exc

    async def embed(self, texts: list[str], *, task: Literal["document", "query"]) -> list[list[float]]:
        raise LLMError("The fallback provider does not provide embeddings")

    async def aclose(self) -> None:
        await self._http.aclose()


class FallbackLLM:
    """Two providers: try the preferred one; on provider failure retry once on the other.

    Embeddings always use the Gemini client (``primary``), because vectors from different
    models are not comparable. ``prefer_secondary`` makes the OpenAI-compatible provider
    (e.g. Groq) answer first, which is much faster and steadier than Gemini's free tier.
    """

    def __init__(
        self, primary: LLMClient, secondary: LLMClient, settings: Settings, prefer_secondary: bool = False
    ) -> None:
        self._primary = primary
        self._secondary = secondary
        self._settings = settings
        self._prefer_secondary = prefer_secondary

    def _map(self, model: str) -> str:
        s = self._settings
        return s.fallback_model_frontier if model == s.model_frontier else s.fallback_model_small

    def _order(self, model: str) -> list[tuple[LLMClient, str, str]]:
        gemini = (self._primary, model, "gemini")
        other = (self._secondary, self._map(model), f"fallback ({self._map(model)})")
        return [other, gemini] if self._prefer_secondary else [gemini, other]

    async def generate(
        self,
        *,
        model: str,
        system: str,
        messages: list[LLMMessage],
        tools: list[ToolSpec] | None = None,
        temperature: float = 0.2,
    ) -> LLMResult:
        order = self._order(model)
        for i, (client, name, label) in enumerate(order):
            try:
                llm_provider_ctx.set(label)
                return await client.generate(
                    model=name, system=system, messages=messages, tools=tools, temperature=temperature
                )
            except LLMError:
                if i == len(order) - 1:
                    raise
                log.warning("llm_fallback", purpose="generate", failed=label)
        raise LLMError("no provider available")  # pragma: no cover

    async def generate_json(
        self, *, model: str, system: str, prompt: str, schema: type[T], temperature: float = 0.0
    ) -> T:
        order = self._order(model)
        for i, (client, name, label) in enumerate(order):
            try:
                llm_provider_ctx.set(label)
                return await client.generate_json(
                    model=name, system=system, prompt=prompt, schema=schema, temperature=temperature
                )
            except LLMError:
                if i == len(order) - 1:
                    raise
                log.warning("llm_fallback", purpose="json", failed=label)
        raise LLMError("no provider available")  # pragma: no cover

    async def embed(self, texts: list[str], *, task: Literal["document", "query"]) -> list[list[float]]:
        return await self._primary.embed(texts, task=task)

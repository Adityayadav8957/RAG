"""Thin MCP (streamable HTTP) client. A fresh short-lived session per operation keeps the
gateway stateless, so it scales horizontally and never shares a connection between users."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from app.config import Settings


class McpError(Exception):
    pass


@dataclass(frozen=True)
class McpTool:
    name: str
    description: str
    input_schema: dict[str, Any]


class McpClient:
    def __init__(self, settings: Settings) -> None:
        self._url = settings.jira_mcp_url
        self._secret = settings.mcp_shared_secret.get_secret_value()

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        return {"X-MCP-Gateway-Secret": self._secret, **(extra or {})}

    @asynccontextmanager
    async def _session(self, headers: dict[str, str]) -> AsyncIterator[ClientSession]:
        async with httpx.AsyncClient(headers=headers, timeout=httpx.Timeout(30.0)) as http:
            async with streamable_http_client(self._url, http_client=http) as (read, write, _):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    yield session

    async def list_tools(self) -> list[McpTool]:
        try:
            async with self._session(self._headers()) as session:
                result = await session.list_tools()
        except Exception as exc:  # noqa: BLE001
            raise McpError("Tool server unavailable") from exc
        return [McpTool(t.name, t.description or "", dict(t.inputSchema)) for t in result.tools]

    async def call_tool(self, name: str, arguments: dict[str, Any], user_headers: dict[str, str]) -> str:
        try:
            async with self._session(self._headers(user_headers)) as session:
                result = await session.call_tool(name, arguments)
        except Exception as exc:  # noqa: BLE001
            raise McpError("Tool server unavailable") from exc
        text = "\n".join(getattr(c, "text", "") for c in result.content if getattr(c, "type", "") == "text")
        if result.isError:
            raise McpError(text[:500] or "Tool call failed")
        # Normalise to compact JSON text when possible.
        try:
            return json.dumps(json.loads(text), ensure_ascii=False)
        except ValueError:
            return text

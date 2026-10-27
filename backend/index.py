"""Vercel entrypoint: the API at /, the Jira MCP tool server at /mcp (one function, one deployment)."""

from __future__ import annotations

from contextlib import AsyncExitStack

from app.main import create_app
from jira_mcp.server import app as mcp_app

api_app = create_app()


async def _lifespan(receive, send):  # type: ignore[no-untyped-def]
    """Run both apps' startup/shutdown hooks (DB engine for the API, session manager for MCP)."""
    async with AsyncExitStack() as stack:
        await receive()  # lifespan.startup
        try:
            await stack.enter_async_context(api_app.router.lifespan_context(api_app))
            await stack.enter_async_context(mcp_app.router.lifespan_context(mcp_app))
        except Exception as exc:  # noqa: BLE001
            await send({"type": "lifespan.startup.failed", "message": str(exc)})
            return
        await send({"type": "lifespan.startup.complete"})
        await receive()  # lifespan.shutdown
    await send({"type": "lifespan.shutdown.complete"})


async def app(scope, receive, send):  # type: ignore[no-untyped-def]
    if scope["type"] == "lifespan":
        await _lifespan(receive, send)
    elif scope["type"] == "http" and scope["path"].rstrip("/") == "/mcp":
        await mcp_app(scope, receive, send)
    else:
        await api_app(scope, receive, send)

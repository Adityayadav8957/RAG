"""FastAPI application factory."""

from __future__ import annotations

import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from sqlalchemy import text

from app.api import admin, auth, chat, documents, integrations
from app.config import Settings, get_settings
from app.db.session import dispose_engine, get_engine, init_engine
from app.logging import configure_logging, get_logger, request_id_ctx, user_id_ctx
from app.observability.metrics import HTTP_LATENCY, HTTP_REQUESTS
from app.services import Services, build_services

log = get_logger("main")


def create_app(settings: Settings | None = None, services: Services | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, json_logs=settings.environment != "local")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        init_engine(settings)
        app.state.services = services or build_services(settings)
        svc: Services = app.state.services
        try:
            await svc.chunk_index.ensure()
        except Exception:  # noqa: BLE001 - /readyz reports it; don't crash-loop on a DB blip
            log.error("vector_bootstrap_failed", exc_info=True)
        try:  # open a few DB connections now so the first requests don't pay TLS setup
            engine = get_engine()
            conns = [await engine.connect() for _ in range(min(3, settings.db_pool_size))]
            for conn in conns:
                await conn.close()
        except Exception:  # noqa: BLE001
            log.warning("db_prewarm_failed", exc_info=True)
        log.info("startup_complete", environment=settings.environment)
        yield
        await dispose_engine()

    app = FastAPI(
        title="Enterprise AI Assistant",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
        allow_credentials=False,
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):  # type: ignore[no-untyped-def]
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        request_id_ctx.set(rid)
        user_id_ctx.set("-")
        start = time.perf_counter()
        try:
            response: Response = await call_next(request)
        except Exception:
            log.error("unhandled_error", path=request.url.path, exc_info=True)
            response = JSONResponse({"detail": "Internal server error"}, status_code=500)
        elapsed = time.perf_counter() - start
        route = getattr(request.scope.get("route"), "path", "unmatched")
        HTTP_REQUESTS.labels(request.method, route, response.status_code).inc()
        HTTP_LATENCY.labels(route).observe(elapsed)
        response.headers["X-Request-ID"] = rid
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = response.headers.get("Cache-Control", "no-store")
        if settings.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        log.info(
            "request",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            ms=round(elapsed * 1000, 1),
        )
        return response

    for router in (auth.router, chat.router, documents.router, integrations.router, admin.router):
        app.include_router(router)

    @app.get("/healthz", tags=["ops"])
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz", tags=["ops"])
    async def readyz(request: Request) -> JSONResponse:
        checks: dict[str, str] = {}
        try:
            async with get_engine().connect() as conn:
                await conn.execute(text("SELECT 1"))
            checks["postgres"] = "ok"
        except Exception:  # noqa: BLE001
            checks["postgres"] = "error"
        try:
            await request.app.state.services.chunk_index.ensure()
            checks["pgvector"] = "ok"
        except Exception:  # noqa: BLE001
            checks["pgvector"] = "error"
        ok = all(v == "ok" for v in checks.values())
        return JSONResponse(
            {"status": "ready" if ok else "degraded", **checks}, status_code=200 if ok else 503
        )

    @app.get("/metrics", include_in_schema=False)
    async def metrics(authorization: Annotated[str | None, Header()] = None) -> Response:
        token = settings.metrics_token
        if token is not None and authorization != f"Bearer {token.get_secret_value()}":
            raise HTTPException(401, "Unauthorized")
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    return app


# Run with: uvicorn --factory app.main:create_app

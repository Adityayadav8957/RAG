"""Async engine/session factory with Neon-friendly connection handling."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.config import Settings, get_settings

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def normalize_database_url(url: str) -> tuple[str, dict[str, Any]]:
    """Convert a libpq-style URL (as Neon provides) into an asyncpg-compatible one.

    * ``postgres://`` / ``postgresql://`` -> ``postgresql+asyncpg://``
    * ``sslmode=require`` -> ``ssl=True`` connect arg (asyncpg has no ``sslmode``)
    * Neon's pooled endpoint runs PgBouncer in transaction mode, which does not support
      prepared statements, so the statement cache is disabled.
    """
    parts = urlsplit(url)
    scheme = parts.scheme
    if scheme in ("postgres", "postgresql"):
        scheme = "postgresql+asyncpg"
    query = dict(parse_qsl(parts.query))
    connect_args: dict[str, Any] = {}
    sslmode = query.pop("sslmode", None)
    query.pop("channel_binding", None)
    if sslmode and sslmode != "disable":
        connect_args["ssl"] = True
    if "-pooler" in (parts.hostname or ""):
        connect_args["statement_cache_size"] = 0
    normalized = urlunsplit((scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))
    return normalized, connect_args


def init_engine(settings: Settings | None = None) -> AsyncEngine:
    global _engine, _sessionmaker
    settings = settings or get_settings()
    url, connect_args = normalize_database_url(settings.database_url)
    _engine = create_async_engine(
        url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_pre_ping=True,
        pool_recycle=900,  # pre_ping handles Neon dropping idle connections; recycling is only a backstop.
        connect_args=connect_args,
    )
    _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


def get_engine() -> AsyncEngine:
    if _engine is None:
        return init_engine()
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    if _sessionmaker is None:
        init_engine()
    assert _sessionmaker is not None
    return _sessionmaker


async def get_session() -> AsyncIterator[AsyncSession]:
    async with get_sessionmaker()() as session:
        yield session


async def dispose_engine() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None

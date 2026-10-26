"""Alembic environment (async engine, URL taken from application settings)."""

from __future__ import annotations

import asyncio

from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from alembic import context
from app.config import get_settings
from app.db import models  # noqa: F401  (register tables)
from app.db.base import Base
from app.db.session import normalize_database_url

config = context.config
target_metadata = Base.metadata


def _url() -> tuple[str, dict[str, object]]:
    return normalize_database_url(get_settings().database_url)


def run_migrations_offline() -> None:
    url, _ = _url()
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def _do_run(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    url, connect_args = _url()
    engine = create_async_engine(url, connect_args=connect_args)
    async with engine.connect() as connection:
        await connection.run_sync(_do_run)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())

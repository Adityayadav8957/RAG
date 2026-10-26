# ruff: noqa: S608  (the f-strings only splice constant SQL fragments; every value is a bound parameter)
"""pgvector access: chunk embeddings and the semantic cache, both stored in Postgres.

Vectors live in the same database as the rows they describe, so there is no second system to
keep in sync: access-control changes, document deletes and tenant isolation are ordinary SQL.

Vectors are sent as text (``'[0.1,0.2,...]'``) and cast server-side. That avoids registering a
binary codec on every connection, which would not survive Neon's PgBouncer pooler.
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db.session import get_sessionmaker

VEC = "CAST(CAST(:{name} AS text) AS vector)"


def vec_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{float(x):.7g}" for x in vector) + "]"


@dataclass(frozen=True)
class VectorHit:
    chunk_id: uuid.UUID
    score: float


class ChunkIndex:
    """Nearest-neighbour search over ``chunks.embedding``, filtered by tenant and document ACL."""

    def __init__(self, settings: Settings) -> None:
        self._dim = settings.embedding_dim

    async def ensure(self) -> None:
        """Fail early if the database cannot do vector search."""
        async with get_sessionmaker()() as session:
            found = (
                await session.execute(text("SELECT 1 FROM pg_extension WHERE extname = 'vector'"))
            ).first()
        if not found:
            raise RuntimeError("The pgvector extension is not installed (run migrations)")

    async def store_embeddings(
        self, session: AsyncSession, pairs: list[tuple[uuid.UUID, list[float]]]
    ) -> None:
        """Write embeddings for chunk rows that already exist in this transaction."""
        stmt = text(f"UPDATE chunks SET embedding = {VEC.format(name='v')} WHERE id = :id")
        await session.execute(stmt, [{"id": cid, "v": vec_literal(vec)} for cid, vec in pairs])


class CacheIndex:
    """Semantic cache storage. Entries are scoped; a lookup never crosses scopes."""

    def __init__(self, settings: Settings) -> None:
        self._ttl = settings.cache_ttl_seconds

    async def ensure(self) -> None:
        return None  # the table is created by migration 0003

    async def lookup(
        self, session: AsyncSession, vector: list[float], scope: str, threshold: float
    ) -> dict[str, Any] | None:
        stmt = text(
            f"""SELECT answer, citations, source_doc_ids,
                       1 - (embedding <=> {VEC.format(name="q")}) AS sim
                FROM semantic_cache
                WHERE scope = :scope AND expires_at > now()
                ORDER BY embedding <=> {VEC.format(name="q")}
                LIMIT 1"""
        )
        row = (await session.execute(stmt, {"q": vec_literal(vector), "scope": scope})).first()
        if row is None or float(row.sim) < threshold:
            return None
        return {
            "answer": row.answer,
            "citations": row.citations,
            "source_doc_ids": [str(d) for d in row.source_doc_ids],
        }

    async def store(self, vector: list[float], scope: str, payload: dict[str, Any]) -> None:
        stmt = text(
            f"""INSERT INTO semantic_cache (scope, answer, citations, source_doc_ids, expires_at, embedding)
                VALUES (:scope, :answer, CAST(:citations AS jsonb), CAST(:docs AS uuid[]),
                        to_timestamp(:expires), {VEC.format(name="v")})"""
        )
        docs = [uuid.UUID(str(d)) for d in payload.get("source_doc_ids", [])]
        async with get_sessionmaker()() as session:
            await session.execute(
                stmt,
                {
                    "scope": scope,
                    "answer": payload["answer"],
                    "citations": json.dumps(payload.get("citations", [])),
                    "docs": docs,
                    "expires": time.time() + self._ttl,
                    "v": vec_literal(vector),
                },
            )
            await session.commit()

    async def purge_document(self, document_id: uuid.UUID) -> None:
        """Drop cached answers that cited a document that changed or was deleted."""
        async with get_sessionmaker()() as session:
            await session.execute(
                text("DELETE FROM semantic_cache WHERE CAST(:d AS uuid) = ANY(source_doc_ids)"),
                {"d": str(document_id)},
            )
            await session.commit()

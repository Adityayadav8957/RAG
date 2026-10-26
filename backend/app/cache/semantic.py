"""Permission-aware semantic cache.

Entries are stored per tenant and carry the ids of the documents the answer was built from.
On every hit the caller's access to *all* of those documents is re-validated against
Postgres; if any is missing, no longer ready, or unreadable, the hit is discarded. This is
stricter than keying by role: users with the same roles can still differ in per-user grants.

Only answers that used no tools (so nothing user-specific) and passed all guardrails
unmodified are ever written.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db.models import Document
from app.logging import get_logger
from app.observability.metrics import CACHE_LOOKUPS
from app.rag.retrieval import doc_acl
from app.rag.vectorstore import CacheIndex
from app.security.rbac import Principal, can_read_document

log = get_logger("cache")


@dataclass(frozen=True)
class CachedAnswer:
    answer: str
    citations: list[dict[str, Any]]
    source_doc_ids: list[uuid.UUID]


class SemanticCache:
    def __init__(self, index: CacheIndex, settings: Settings) -> None:
        self._index = index
        self._settings = settings

    async def get(
        self, session: AsyncSession, principal: Principal, vector: list[float]
    ) -> CachedAnswer | None:
        if not self._settings.cache_enabled:
            return None
        payload = await self._index.lookup(
            vector, principal.tenant, self._settings.cache_similarity_threshold
        )
        if payload is None:
            CACHE_LOOKUPS.labels(result="miss").inc()
            return None
        doc_ids = [uuid.UUID(d) for d in payload.get("source_doc_ids", [])]
        if doc_ids:
            docs = (await session.execute(select(Document).where(Document.id.in_(doc_ids)))).scalars().all()
            found = {d.id: d for d in docs}
            for did in doc_ids:
                doc = found.get(did)
                if doc is None or doc.status != "ready" or not can_read_document(principal, doc_acl(doc)):
                    CACHE_LOOKUPS.labels(result="acl_rejected").inc()
                    return None
        CACHE_LOOKUPS.labels(result="hit").inc()
        return CachedAnswer(
            answer=str(payload["answer"]),
            citations=list(payload.get("citations", [])),
            source_doc_ids=doc_ids,
        )

    async def put(
        self,
        principal: Principal,
        vector: list[float],
        answer: str,
        citations: list[dict[str, Any]],
        source_doc_ids: list[uuid.UUID],
    ) -> None:
        if not self._settings.cache_enabled:
            return
        await self._index.store(
            vector,
            principal.tenant,
            {
                "answer": answer,
                "citations": citations,
                "source_doc_ids": [str(d) for d in source_doc_ids],
            },
        )

"""Document ingestion: parse -> chunk -> embed -> store (rows and vectors both live in Postgres)."""

from __future__ import annotations

import hashlib
import uuid

from sqlalchemy import delete, select

from app.config import Settings
from app.db.models import Chunk, Document
from app.db.session import get_sessionmaker
from app.llm.client import LLMClient
from app.logging import get_logger
from app.observability.audit import audit
from app.rag.chunking import chunk_text
from app.rag.parsing import extract_text
from app.rag.vectorstore import ChunkIndex
from app.security.injection import scan_text

log = get_logger("ingest")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


async def process_document(
    *,
    document_id: uuid.UUID,
    data: bytes,
    kind: str,
    llm: LLMClient,
    index: ChunkIndex,
    settings: Settings,
) -> None:
    """Runs as a background task with its own DB session."""
    sessionmaker = get_sessionmaker()
    try:
        text = extract_text(data, kind)
        chunks = chunk_text(text, size=settings.chunk_size_chars, overlap=settings.chunk_overlap_chars)
        if not chunks:
            raise ValueError("No extractable text found in the document")

        verdict = scan_text(text)
        vectors = await llm.embed(chunks, task="document")

        async with sessionmaker() as session:
            doc = (await session.execute(select(Document).where(Document.id == document_id))).scalar_one()
            rows = [
                Chunk(id=uuid.uuid4(), document_id=doc.id, ordinal=i, text=t) for i, t in enumerate(chunks)
            ]
            session.add_all(rows)
            await session.flush()
            await index.store_embeddings(
                session, [(row.id, vec) for row, vec in zip(rows, vectors, strict=True)]
            )
            doc.chunk_count = len(rows)
            doc.status = "ready"
            owner_id = doc.owner_id
            await session.commit()
        await audit(
            "document.indexed",
            actor_id=owner_id,
            resource=f"document:{document_id}",
            details={"chunks": len(chunks), "injection_score": verdict.score, "reasons": verdict.reasons},
        )
    except Exception as exc:  # noqa: BLE001
        log.error("ingest_failed", document_id=str(document_id), exc_info=True)
        async with sessionmaker() as session:
            failed = (
                await session.execute(select(Document).where(Document.id == document_id))
            ).scalar_one_or_none()
            if failed is not None:
                await session.execute(delete(Chunk).where(Chunk.document_id == document_id))
                failed.status = "failed"
                failed.error = str(exc)[:500]
                await session.commit()

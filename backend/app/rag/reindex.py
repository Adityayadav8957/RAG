"""Re-embed chunks that have no vector yet (after the Qdrant -> pgvector move, or a model change).

python -m app.rag.reindex
"""

from __future__ import annotations

import asyncio

from sqlalchemy import select, text

from app.config import get_settings
from app.db.models import Chunk, Document
from app.db.session import dispose_engine, get_sessionmaker, init_engine
from app.llm.client import GeminiClient
from app.rag.vectorstore import ChunkIndex

BATCH = 64


async def main() -> None:
    settings = get_settings()
    init_engine(settings)
    llm = GeminiClient(settings)
    index = ChunkIndex(settings)
    sessionmaker = get_sessionmaker()
    done = 0
    async with sessionmaker() as session:
        ids = (
            (
                await session.execute(
                    text("SELECT id FROM chunks WHERE embedding IS NULL ORDER BY document_id, ordinal")
                )
            )
            .scalars()
            .all()
        )
        for i in range(0, len(ids), BATCH):
            batch = ids[i : i + BATCH]
            rows = (await session.execute(select(Chunk).where(Chunk.id.in_(batch)))).scalars().all()
            vectors = await llm.embed([r.text for r in rows], task="document")
            await index.store_embeddings(session, [(r.id, v) for r, v in zip(rows, vectors, strict=True)])
            await session.commit()
            done += len(rows)
            print(f"embedded {done}/{len(ids)}")
        # Documents whose chunks are all embedded are searchable again.
        await session.execute(
            text(
                "UPDATE documents d SET status = 'ready' WHERE d.status = 'processing' AND d.chunk_count > 0 "
                "AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.document_id = d.id AND c.embedding IS NULL)"
            )
        )
        await session.commit()
        ready = (await session.execute(select(Document.id).where(Document.status == "ready"))).all()
    print(f"done: {done} chunks embedded, {len(ready)} documents ready")
    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())

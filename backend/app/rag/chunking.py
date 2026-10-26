"""Paragraph-aware text chunking with overlap."""

from __future__ import annotations

import re


def chunk_text(text: str, *, size: int, overlap: int) -> list[str]:
    if size <= overlap:
        raise ValueError("chunk size must exceed overlap")
    text = re.sub(r"[ \t]+", " ", text.replace("\r\n", "\n")).strip()
    if not text:
        return []
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    chunks: list[str] = []
    current = ""
    for para in paragraphs:
        # Hard-split paragraphs that alone exceed the chunk size.
        pieces = (
            [para[i : i + size] for i in range(0, len(para), size - overlap)] if len(para) > size else [para]
        )
        for piece in pieces:
            if current and len(current) + len(piece) + 2 > size:
                chunks.append(current)
                tail = current[-overlap:] if overlap else ""
                current = f"{tail}\n\n{piece}".strip() if tail else piece
            else:
                current = f"{current}\n\n{piece}".strip() if current else piece
    if current:
        chunks.append(current)
    return chunks

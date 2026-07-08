"""Split long source text into translation-sized chunks."""

import os
import re

CHUNK_MAX_CHARS = int(os.getenv("CHUNK_MAX_CHARS", "500"))
API_MAX_TOKENS_BASE = int(os.getenv("API_MAX_TOKENS", "2048"))
API_MAX_TOKENS_CAP = int(os.getenv("API_MAX_TOKENS_CAP", "8192"))

_SENTENCE_SPLIT = re.compile(r"(?<=[。！？.!?\n])\s*")


def max_tokens_for_piece(piece: str) -> int:
    """Scale output budget with source length (CJK output is often ~1–2× source)."""
    scaled = max(API_MAX_TOKENS_BASE, len(piece) * 3)
    return min(API_MAX_TOKENS_CAP, scaled)


def split_text(text: str, max_chars: int = CHUNK_MAX_CHARS) -> list[str]:
    """Split *text* at sentence boundaries, then hard-wrap oversized segments."""
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    sentences = [s for s in _SENTENCE_SPLIT.split(text) if s]
    chunks: list[str] = []
    buf = ""

    for sent in sentences:
        if len(buf) + len(sent) <= max_chars:
            buf += sent
            continue
        if buf:
            chunks.append(buf)
            buf = ""
        if len(sent) <= max_chars:
            buf = sent
        else:
            for i in range(0, len(sent), max_chars):
                chunks.append(sent[i : i + max_chars])

    if buf:
        chunks.append(buf)
    return chunks
"""Split long source text into translation-sized chunks."""

import os
import re

CHUNK_MAX_CHARS = int(os.getenv("CHUNK_MAX_CHARS", "500"))

_SENTENCE_SPLIT = re.compile(r"(?<=[。！？.!?])\s*")


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
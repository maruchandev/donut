"""Per-speaker source chunk history for mid-utterance translation context."""

from __future__ import annotations

PREV_CHUNK_CTX = 3

CHUNK_CTX_NOTE = (
    "Earlier fragments from the same speaker are context only. "
    "Use them to infer meaning and keep coherence (especially when the new "
    "fragment is a short tail or continuation), but translate ONLY "
    "the new fragment marked below. Do not translate or repeat the context."
)


def build_chunk_user_content(prev_chunks: list[str], text: str) -> str:
    """Wrap prior fragments as non-translatable context around the new piece."""
    prev = [c.strip() for c in prev_chunks if c and c.strip()]
    if not prev:
        return text

    lines = [CHUNK_CTX_NOTE, ""]
    for i, chunk in enumerate(prev[-PREV_CHUNK_CTX:], 1):
        lines.append(f"[Context {i}] {chunk}")
    lines.extend(["", "Translate ONLY this new fragment:", text])
    return "\n".join(lines)


class SpeakerChunkStore:
    def __init__(self, maxlen: int = PREV_CHUNK_CTX) -> None:
        self.maxlen = maxlen
        self._bufs: dict[str, list[str]] = {}

    def _key(self, room_id: str, spk: str) -> str:
        return f"{room_id}:{spk}"

    def get_prev(self, room_id: str, spk: str) -> list[str]:
        return list(self._bufs.get(self._key(room_id, spk), []))

    def append(self, room_id: str, spk: str, text: str) -> None:
        chunk = text.strip()
        if not chunk:
            return
        key = self._key(room_id, spk)
        buf = self._bufs.setdefault(key, [])
        buf.append(chunk)
        while len(buf) > self.maxlen:
            buf.pop(0)

    def clear_room(self, room_id: str) -> None:
        prefix = f"{room_id}:"
        for key in [k for k in self._bufs if k.startswith(prefix)]:
            self._bufs.pop(key, None)
"""Deterministic punctuation / newline normalization for JA·KO display text."""

from __future__ import annotations

import re

# Sentence-final marks only (never split on です / ます alone).
_TERMINATORS = set("。．.！？!?…")
_CLOSERS = set("」』\"')）)】］]>」")


def _normalize_ws(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Literal backslash-n from sloppy models
    text = text.replace("\\n", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def ensure_sentence_newlines(text: str) -> str:
    """After sentence terminators (。！？ etc.), force a newline before the next sentence.

    Does NOT split on bare です/ます — that breaks ですか → です。か.
    """
    if not text or not text.strip():
        return text or ""

    text = _normalize_ws(text)
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        out.append(ch)
        if ch in _TERMINATORS:
            j = i + 1
            # absorb repeated terminators + closing quotes/brackets
            while j < n and (text[j] in _TERMINATORS or text[j] in _CLOSERS):
                out.append(text[j])
                j += 1
            # skip spaces/tabs (not newlines)
            k = j
            while k < n and text[k] in " \t":
                k += 1
            if k < n and text[k] != "\n":
                out.append("\n")
            i = k if k > j else j
            continue
        i += 1

    return _normalize_ws("".join(out))


def format_display_text(text: str, lang: str | None = None) -> str:
    """Normalize whitespace and insert newlines only after real sentence punctuation."""
    if not text:
        return ""
    return ensure_sentence_newlines(text)

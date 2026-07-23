"""Deterministic punctuation / newline normalization for JA·KO display text."""

from __future__ import annotations

import re

# Sentence-final marks (JA / KO / Latin)
_TERMINATORS = set("。．.！？!?…")
_CLOSERS = set("」』\"')）)】］]>」")

# Japanese clause endings often spoken without 「。」 in ASR
_JA_CLAUSE = re.compile(
    r"(です|ます|でした|ました|ません|ましょう|ですよ|ですね|ますよ|ますね)"
    r"(?=(?:[ぁ-んァ-ヶ一-龥A-Za-z0-9「『(（]))"
)

# Korean formal / polite endings before more Hangul content
_KO_CLAUSE = re.compile(
    r"(습니다|ㅂ니다|세요|세요|예요|이에요|입니다|죠|네요)"
    r"(?=(?:[가-힣A-Za-z0-9「\"'(]))"
)


def _normalize_ws(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Literal backslash-n from sloppy models
    text = text.replace("\\n", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def ensure_sentence_newlines(text: str) -> str:
    """After sentence terminators, force a newline before the next sentence."""
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
            # skip the spaces we jumped over (don't keep them before newline)
            i = k if k > j else j
            continue
        i += 1

    return _normalize_ws("".join(out))


def soft_clause_breaks(text: str, lang: str) -> str:
    """When ASR/model omit 。, break after common clause endings mid-string."""
    if not text or not text.strip():
        return text or ""
    text = _normalize_ws(text)
    if lang == "ko":
        text = _KO_CLAUSE.sub(r"\1.\n", text)
    else:
        # Default JA (also ok for mixed)
        text = _JA_CLAUSE.sub(r"\1。\n", text)
    return ensure_sentence_newlines(text)


def format_display_text(text: str, lang: str | None = None) -> str:
    """Full pipeline: soft clause breaks + terminator newlines."""
    if not text:
        return ""
    lang = lang or "ja"
    # If text already has enough newlines relative to length, only enforce terminators
    if text.count("\n") >= max(1, len(text) // 80):
        return ensure_sentence_newlines(text)
    return soft_clause_breaks(text, lang)

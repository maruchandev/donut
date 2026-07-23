import asyncio
import json
import os
import random
import re
import time
import logging
from pathlib import Path
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import (
    Cookie,
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from pydantic import BaseModel, Field

from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from openai import AsyncOpenAI

import aiosqlite

import auth
import db
from chunk_context import SpeakerChunkStore, build_chunk_user_content
from chunking import max_tokens_for_piece, split_text

load_dotenv()

HERE = Path(__file__).resolve().parent
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
API_KEY = os.getenv("API_KEY") or os.getenv("OPENAI_API_KEY", "")
API_BASE_URL = os.getenv("API_BASE_URL", "https://api.deepseek.com/v1")
API_MODEL = os.getenv("API_MODEL", "deepseek-chat")
API_TEMPERATURE = float(os.getenv("API_TEMPERATURE", "0.1"))
ORIGINS = os.getenv("ORIGINS", "*")
ROOM_IDLE_SECS = int(os.getenv("ROOM_IDLE_SECS", "3600"))
ROOM_CLEANUP_INTERVAL = int(os.getenv("ROOM_CLEANUP_INTERVAL", "60"))

class RoomCreateBody(BaseModel):
    password: str | None = Field(default=None, max_length=128)

class AdminSettingsBody(BaseModel):
    room_create_mode: str = Field(pattern=r"^(open|closed|password)$")

class IssuePasswordBody(BaseModel):
    label: str = Field(default="", max_length=64)

class IssuePasswordPatchBody(BaseModel):
    enabled: bool

class AdminCertPatchBody(BaseModel):
    enabled: bool

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("stream-translator")

if not API_KEY:
    logger.warning("API_KEY is not set — translation will fail")

client = AsyncOpenAI(api_key=API_KEY, base_url=API_BASE_URL)

# Bilingual JSON output: polished source + translation (ja/ko fields always both set).
JSON_TRANSLATE_RULES = (
    "You are a real-time interpreter for Japanese↔Korean speech recognition input. "
    "The input is raw ASR text: it may lack punctuation, contain typos, false starts, "
    "or mid-sentence corrections. Infer the intended meaning. "
    "Preserve tone and formality. "
    "Segments may be partial; use any [Context] only to understand continuity, "
    "and process ONLY the new fragment (do not re-translate context). "
    "\n\n"
    "TECHNICAL TERMS: Keep domain jargon, product names, acronyms, code-like tokens, "
    "and multi-word technical phrases intact in BOTH languages when appropriate "
    "(transliterate only when a standard target-language form exists). "
    "Never insert a line break inside a technical term or compound noun. "
    "\n\n"
    "PUNCTUATION & LINE BREAKS: ASR usually omits them. You MUST restore natural "
    "punctuation for each language (Japanese: 、。！？ ; Korean: . ! ? and natural "
    "endings such as 요/다). Put a newline ONLY between clearly separate sentences "
    "(after sentence-final punctuation). Do not break a single short clause into "
    "multiple lines. "
    "\n\n"
    "Respond with ONE JSON object only (no markdown fences, no commentary). Schema:\n"
    '{"ja":"<Japanese text>","ko":"<Korean text>"}\n'
    "Rules for fields:\n"
    "- Always fill both \"ja\" and \"ko\".\n"
    "- If the new fragment is Japanese, \"ja\" = polished source (light ASR cleanup + "
    "punctuation/newlines), \"ko\" = full natural Korean translation.\n"
    "- If the new fragment is Korean, \"ko\" = polished source, \"ja\" = full natural "
    "Japanese translation.\n"
    "- Do not invent content that was not implied by the speech."
)

# Kept for rare non-JSON continue paths / explicit target-lang formatting.
STREAM_PROMPT = JSON_TRANSLATE_RULES + (
    " Target language preference: {lang}."
    " Still return the same JSON with both ja and ko filled."
)

AUTO_PROMPT = JSON_TRANSLATE_RULES

CONTINUE_PROMPT = (
    "Continue the previous JSON translation from exactly where you stopped. "
    "Output ONLY a valid JSON object with \"ja\" and \"ko\" keys, no fences."
)

LANG_MAP = {"ja": "Japanese", "ko": "Korean"}

HANGUL_RANGES = [
    (0xAC00, 0xD7AF), (0x1100, 0x11FF), (0x3130, 0x318F),
    (0xA960, 0xA97F), (0xD7B0, 0xD7FF),
]

def detect_lang(text: str) -> str:
    hangul_count = 0
    kana_count = 0
    kanji_count = 0
    for ch in text:
        cp = ord(ch)
        if any(lo <= cp <= hi for lo, hi in HANGUL_RANGES):
            hangul_count += 1
        elif 0x3040 <= cp <= 0x309F or 0x30A0 <= cp <= 0x30FF:
            kana_count += 1
        elif 0x4E00 <= cp <= 0x9FFF or 0x3400 <= cp <= 0x4DBF:
            kanji_count += 1
    if hangul_count > kana_count + kanji_count:
        return "ko"
    return "ja"

JP_NAMES = [
    "いちご", "ちょこ", "ばにら", "まっちゃ", "かすたーど", "めーぷる", "きなこ", "ぶるーべりー", "れもん", "オレンジ",
    "ばなな", "みるく", "あずき", "こくとう", "しお", "きゃらめる", "ぴすたちお", "ここなっつ", "らずべりー", "まんごー",
    "パイン", "ちーず", "ほわいと", "びたー", "みんと", "ろーず", "らべんだー", "はちみつ", "くりーむ", "ぷれーん",
    "しゅがー", "もか", "こーひー", "らて", "くるみ", "あーもんど", "ぴーなっつ", "さつまいも", "かぼちゃ", "ゆず",
    "さくら", "うめ", "もも", "ぶどう", "すいか", "メロン", "りんご", "チェリー", "カシス", "マスカット",
    "トフィー", "ブラウニー", "プリン", "パンプキン", "シナモン", "ココア", "ホイップ", "スプリンクル", "グレーズ", "パウダー",
    "クルーラー", "ポンデ", "エンゼル", "デビル", "フレンチ", "オールド", "サクサク", "ふわふわ", "もちもち", "とろける",
    "あまおう", "濃いちょこ", "みるくてぃー", "紅茶", "抹茶らて", "黒ごま", "白ごま", "ジャム", "マーマレード", "ソルティ",
    "スイート", "ダブルちょこ", "トリプル", "ミックス", "デラックス", "スペシャル", "クラシック", "プレミアム", "はちみつれもん", "コーヒー",
    "カフェオレ", "メープルきなこ", "いちごみるく", "チョコバナナ", "バニラきなこ", "塩バター", "焦がしちょこ", "ホワイトちょこ", "ベリーミックス", "フルーツ",
]

KR_NAMES = [
    "딸기", "초코", "바닐라", "말차", "커스터드", "메이플", "콩가루", "블루베리", "레몬", "오렌지",
    "바나나", "밀크", "팥", "흑당", "소금", "캐러멜", "피스타치오", "코코넛", "라즈베리", "망고",
    "파인", "치즈", "화이트", "다크", "민트", "장미", "라벤더", "꿀", "크림", "플레인",
    "슈가", "모카", "커피", "라떼", "호두", "아몬드", "피넛", "고구마", "호박", "유자",
    "벚꽃", "매실", "복숭아", "포도", "수박", "멜론", "사과", "체리", "카시스", "머스캣",
    "토피", "브라우니", "푸딩", "펌킨", "시나몬", "코코아", "휘핑", "스프링클", "글레이즈", "파우더",
    "크룰러", "폰데", "엔젤", "데블", "프렌치", "올드", "바삭", "폭신", "쫀득", "녹는",
    "단딸기", "진초코", "밀크티", "홍차", "말차라떼", "흑임자", "백임자", "잼", "마멀레이드", "솔티",
    "스위트", "더블초코", "트리플", "믹스", "디럭스", "스페셜", "클래식", "프리미엄", "꿀레몬", "카페라떼",
    "메이플콩", "딸기우유", "초코바나나", "바닐라콩", "소금버터", "카라멜초코", "화이트초코", "베리믹스", "후르츠", "도넛",
]

ROOM_ID_RE = re.compile(r"^\d{6}$")

rooms: dict[str, set[WebSocket]] = {}
room_clients: dict[WebSocket, str] = {}
room_names: dict[WebSocket, str] = {}
room_ctx: dict[str, list[dict]] = {}
room_last_active: dict[str, float] = {}
utterance_state: dict[str, dict] = {}
utterance_locks: dict[str, asyncio.Lock] = {}
utterance_rev: dict[str, int] = {}
speaker_chunks = SpeakerChunkStore()
MAX_CTX = 6
# Short-term source dedupe: room:spk → list of (monotonic_ts, norm_hash)
recent_src_hashes: dict[str, list[tuple[float, str]]] = {}
SRC_DEDUP_TTL_SECS = 300.0
SRC_DEDUP_MAX = 48


def normalize_src_hash(text: str) -> str:
    return "".join((text or "").split()).lower()


def prune_src_dedup(key: str, now: float | None = None) -> None:
    now = time.monotonic() if now is None else now
    buf = recent_src_hashes.get(key)
    if not buf:
        return
    kept = [(t, h) for t, h in buf if now - t < SRC_DEDUP_TTL_SECS]
    if len(kept) > SRC_DEDUP_MAX:
        kept = kept[-SRC_DEDUP_MAX:]
    if kept:
        recent_src_hashes[key] = kept
    else:
        recent_src_hashes.pop(key, None)


def is_duplicate_src(room_id: str, spk: str, text: str) -> bool:
    """Return True if the exact same normalized source was just translated."""
    h = normalize_src_hash(text)
    if not h or len(h) < 2:
        return True
    key = f"{room_id}:{spk}"
    now = time.monotonic()
    prune_src_dedup(key, now)
    for _, prev in recent_src_hashes.get(key, []):
        if prev == h:
            return True
    return False


def remember_src(room_id: str, spk: str, text: str) -> None:
    h = normalize_src_hash(text)
    if not h:
        return
    key = f"{room_id}:{spk}"
    now = time.monotonic()
    prune_src_dedup(key, now)
    buf = recent_src_hashes.setdefault(key, [])
    buf.append((now, h))
    if len(buf) > SRC_DEDUP_MAX:
        recent_src_hashes[key] = buf[-SRC_DEDUP_MAX:]


def format_ctx(buf: list[dict]) -> str:
    if not buf:
        return ""
    lines = [f"{e['spk']}: {e['text']}" for e in buf]
    return "Recent conversation:\n" + "\n".join(lines) + "\n\n"


def upsert_ctx_entry(buf: list[dict], uid: str, spk: str, text: str) -> None:
    for entry in buf:
        if entry["uid"] == uid:
            entry["text"] = text
            return
    buf.append({"uid": uid, "spk": spk, "text": text})
    if len(buf) > MAX_CTX:
        buf.pop(0)

def touch_room(room_id: str) -> None:
    room_last_active[room_id] = time.time()

async def dissolve_room(room_id: str, reason: str) -> None:
    room = rooms.pop(room_id, None)
    room_ctx.pop(room_id, None)
    speaker_chunks.clear_room(room_id)
    room_last_active.pop(room_id, None)
    prefix = f"{room_id}:"
    for key in [k for k in recent_src_hashes if k.startswith(prefix)]:
        recent_src_hashes.pop(key, None)
    if not room:
        return
    sockets = list(room)
    for ws in sockets:
        room_clients.pop(ws, None)
        room_names.pop(ws, None)
    payload = json.dumps({"type": "room_closed", "reason": reason}, ensure_ascii=False)
    for ws in sockets:
        try:
            await ws.send_text(payload)
        except Exception:
            pass
    await asyncio.sleep(0.05)
    for ws in sockets:
        try:
            await ws.close(code=4001, reason=reason)
        except Exception:
            pass
    await db.delete_room_messages(room_id)
    prefix = f"{room_id}:"
    for key in [k for k in utterance_state if k.startswith(prefix)]:
        utterance_state.pop(key, None)
        utterance_locks.pop(key, None)
    logger.info("Room %s closed (%s)", room_id, reason)

async def cleanup_idle_rooms() -> None:
    while True:
        await asyncio.sleep(ROOM_CLEANUP_INTERVAL)
        now = time.time()
        expired = [
            rid for rid, ts in list(room_last_active.items())
            if now - ts > ROOM_IDLE_SECS
        ]
        for rid in expired:
            if rid in rooms:
                logger.info("Room %s expired after %ds idle", rid, ROOM_IDLE_SECS)
                await dissolve_room(rid, "idle")

def is_valid_room_id(room_id: str) -> bool:
    return bool(ROOM_ID_RE.fullmatch(room_id))

def gen_room_code() -> str:
    while True:
        code = f"{random.randint(0, 999999):06d}"
        if code not in rooms:
            return code

def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"

async def admin_is_configured() -> bool:
    return auth.env_admin_configured() or await db.has_enabled_admin_certificates()


async def authorize_admin_certificate(fingerprint: str) -> bool:
    allowed = auth.env_cert_fingerprints() | await db.get_enabled_admin_fingerprints()
    return fingerprint in allowed


async def require_admin(
    admin_session: str | None = Cookie(None, alias=auth.SESSION_COOKIE),
) -> str:
    if not await admin_is_configured():
        raise HTTPException(status_code=503, detail="Admin is not configured")
    if not auth.validate_admin_session(admin_session):
        raise HTTPException(status_code=401, detail="Unauthorized")
    return admin_session

async def authorize_room_creation(
    request: Request,
    body: RoomCreateBody | None,
    *,
    admin_bypass: bool = False,
) -> None:
    if admin_bypass:
        return

    mode = await db.get_room_create_mode()
    if mode == "open":
        return

    if mode == "closed":
        raise HTTPException(
            status_code=403,
            detail={"code": "room_creation_closed", "message": "Room creation is disabled"},
        )

    password = (body.password if body else None) or ""
    password = password.strip()
    if not password:
        raise HTTPException(
            status_code=403,
            detail={"code": "room_password_required", "message": "Issue password required"},
        )

    ip = client_ip(request)
    rate_key = f"room_pw:{ip}"
    if not auth.rate_limit_allowed(
        rate_key, auth.ROOM_PW_MAX_ATTEMPTS, auth.ROOM_PW_WINDOW_SECS,
    ):
        raise HTTPException(status_code=429, detail="Too many attempts")

    matched_id = None
    for pw_id, stored_hash in await db.get_enabled_room_password_hashes():
        if auth.verify_password(password, stored_hash):
            matched_id = pw_id
            break

    if matched_id is None:
        auth.record_failed_attempt(rate_key)
        raise HTTPException(
            status_code=403,
            detail={"code": "room_password_invalid", "message": "Invalid issue password"},
        )

    await db.touch_room_password(matched_id)

def _create_room_record() -> str:
    code = gen_room_code()
    rooms[code] = set()
    room_ctx[code] = []
    touch_room(code)
    logger.info("Room created: %s", code)
    return code

def pick_name(ws: WebSocket, room_id: str, lang: str) -> str:
    pool = JP_NAMES if lang == "ja" else KR_NAMES
    old = room_names.get(ws)
    room_sockets = rooms.get(room_id, set())
    used = {room_names.get(s) for s in room_sockets if s is not ws}
    for name in pool:
        if name not in used:
            room_names[ws] = name
            return name
    if old and old not in used:
        return old
    name = f"User{len(used)}"
    room_names[ws] = name
    return name

async def broadcast(room_id: str, data: str):
    dead: list[WebSocket] = []
    room = rooms.get(room_id, set())
    for c in room:
        try:
            await c.send_text(data)
        except Exception:
            dead.append(c)
    for c in dead:
        room.discard(c)
        room_clients.pop(c, None)
        room_names.pop(c, None)

async def send_to(ws: WebSocket, data: str):
    try:
        await ws.send_text(data)
    except Exception:
        rid = room_clients.get(ws)
        if rid:
            rooms.get(rid, set()).discard(ws)
        room_clients.pop(ws, None)
        room_names.pop(ws, None)

def utterance_key(room_id: str, uid: str) -> str:
    return f"{room_id}:{uid}"


def _strip_code_fence(raw: str) -> str:
    s = (raw or "").strip()
    if not s.startswith("```"):
        return s
    lines = s.split("\n")
    # drop first fence line and optional trailing fence
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip().startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines).strip()


def parse_bilingual_json(raw: str) -> tuple[str, str]:
    """Parse model JSON into (ja, ko). Raises ValueError on failure."""
    s = _strip_code_fence(raw)
    # Tolerate leading/trailing junk around the object.
    start = s.find("{")
    end = s.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("no JSON object in model output")
    data = json.loads(s[start : end + 1])
    if not isinstance(data, dict):
        raise ValueError("JSON root is not an object")
    ja = str(data.get("ja") or data.get("japanese") or "").strip()
    ko = str(data.get("ko") or data.get("korean") or "").strip()
    # Alternate schema: source/translation
    if not ja and not ko:
        src = str(data.get("source") or "").strip()
        tgt = str(data.get("translation") or data.get("target") or "").strip()
        if src or tgt:
            # Heuristic assign by script
            if detect_lang(src) == "ko":
                ko, ja = src, tgt
            else:
                ja, ko = src, tgt
    if not ja and not ko:
        raise ValueError("empty ja/ko in JSON")
    return ja, ko


def polished_and_translation(
    ja: str, ko: str, source_lang: str, raw_fallback: str
) -> tuple[str, str]:
    """Map bilingual fields → (polished_source, translation)."""
    if source_lang == "ko":
        polished = ko or raw_fallback
        translation = ja
    else:
        polished = ja or raw_fallback
        translation = ko
    if not translation:
        # Fall back to whichever side is not the polished source.
        translation = (ko if polished == ja else ja) or ""
    return polished, translation


async def json_translate_pieces(
    *,
    room_id: str,
    pieces: list[str],
    system_content: str,
    state: dict,
    should_abort,
    make_chunk_payload,
    source_lang: str,
    user_contents: list[str] | None = None,
) -> None:
    """Translate pieces via JSON {ja, ko}; broadcast polished src + translation.

    Uses non-streaming completion so punctuation/newlines are reliable, then
    pushes full fields to clients (src-first raw already went out earlier).
    """
    polished_parts: list[str] = []
    tgt_parts: list[str] = []

    for idx, piece in enumerate(pieces):
        if should_abort():
            return
        user_content = (
            user_contents[idx] if user_contents and idx < len(user_contents) else piece
        )
        messages = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": user_content},
        ]
        raw_out = ""
        # Prefer JSON mode when the provider supports it.
        create_kwargs = dict(
            model=API_MODEL,
            messages=messages,
            stream=False,
            temperature=API_TEMPERATURE,
            max_tokens=max_tokens_for_piece(piece),
        )
        try:
            resp = await client.chat.completions.create(
                **create_kwargs,
                response_format={"type": "json_object"},
            )
        except Exception as e:
            logger.warning("json_object mode failed, retrying plain: %s", e)
            resp = await client.chat.completions.create(**create_kwargs)

        raw_out = (resp.choices[0].message.content or "").strip()
        try:
            ja, ko = parse_bilingual_json(raw_out)
            polished, translation = polished_and_translation(
                ja, ko, source_lang, piece
            )
        except Exception as e:
            logger.warning(
                "bilingual JSON parse failed (%s); raw fallback | head=%r",
                e, raw_out[:160],
            )
            # Last resort: treat entire output as translation, keep ASR source.
            polished, translation = piece, raw_out

        polished_parts.append(polished)
        tgt_parts.append(translation)

        # Progressive update for multi-piece inputs.
        state["tgt"] = "\n".join(p for p in tgt_parts if p)
        # Polished source for *this request's pieces* is applied by caller via return
        # We also stash on state for intermediate broadcasts.
        state["_polished_delta"] = "\n".join(p for p in polished_parts if p)

        await broadcast(
            room_id,
            json.dumps(make_chunk_payload(""), ensure_ascii=False),
        )

    state["_polished_parts"] = polished_parts
    state["_tgt_parts"] = tgt_parts

async def finalize_utterance(
    ws: WebSocket,
    room_id: str,
    uid: str,
    spk: str,
    target: str,
) -> None:
    """Close a streaming utterance without translating (client sent finalize_only)."""
    key = utterance_key(room_id, uid)
    lock = utterance_locks.setdefault(key, asyncio.Lock())

    async with lock:
        state = utterance_state.get(key)
        if not state:
            return

        full_src = state["src"]
        use_src = state["src_lang"]
        tgt_lang = state["tgt_lang"]

        await broadcast(room_id, json.dumps({
            "type": "t_done",
            "full": state["tgt"],
            "uid": uid,
            "final": True,
            "spk": spk,
            "src": full_src,
            "src_lang": use_src,
            "tgt_lang": tgt_lang,
        }, ensure_ascii=False))

        ctx_buf = room_ctx.get(room_id, [])
        upsert_ctx_entry(ctx_buf, uid, spk, full_src)

        updated = await db.update_message_by_uid(
            room_id, uid, full_src, state["tgt"], use_src, tgt_lang,
        )
        if not updated:
            await db.insert_message(
                room_id, uid, spk, full_src, state["tgt"],
                use_src, tgt_lang, True,
            )
        utterance_state.pop(key, None)
        utterance_locks.pop(key, None)
        logger.info(
            "translate finalized | room=%s uid=%s src_len=%d tgt_len=%d",
            room_id, uid, len(full_src), len(state["tgt"]),
        )


async def handle_translate(
    ws: WebSocket,
    room_id: str,
    text: str,
    target: str,
    source: str,
    uid: str,
    spk: str,
    final: bool,
) -> None:
    text = (text or "").strip()
    if not text:
        return

    # Server-side guard against client multi-send / ASR restarts.
    if is_duplicate_src(room_id, spk, text):
        logger.info(
            "translate skip dedupe | room=%s uid=%s spk=%s len=%d",
            room_id, uid, spk, len(text),
        )
        await send_to(ws, json.dumps({
            "type": "t_skip",
            "uid": uid,
            "reason": "duplicate",
        }, ensure_ascii=False))
        return

    detected_src = detect_lang(text)
    use_src = detected_src if source in ("auto", "?") else source
    if target == "auto":
        prompt = AUTO_PROMPT
        logger.info(
            "translate | room=%s uid=%s spk=%s src=%s->tgt=%s delta_len=%d final=%s",
            room_id, uid, spk, detected_src,
            "ko" if detected_src == "ja" else "ja", len(text), final,
        )
    else:
        lang = LANG_MAP.get(target, target)
        prompt = STREAM_PROMPT.format(lang=lang)
        logger.info(
            "translate | room=%s uid=%s spk=%s src=%s tgt=%s delta_len=%d final=%s",
            room_id, uid, spk, detected_src, target, len(text), final,
        )

    ctx_buf = room_ctx.get(room_id, [])
    ctx = format_ctx(ctx_buf)
    prev_chunks = speaker_chunks.get_prev(room_id, spk)
    pieces = split_text(text)
    user_contents: list[str] = []
    for i, piece in enumerate(pieces):
        if i == 0 and prev_chunks:
            user_contents.append(build_chunk_user_content(prev_chunks, piece))
        else:
            user_contents.append(piece)

    key = utterance_key(room_id, uid)
    lock = utterance_locks.setdefault(key, asyncio.Lock())

    async with lock:
        state = utterance_state.setdefault(
            key,
            {"src": "", "tgt": "", "src_lang": use_src, "tgt_lang": target},
        )
        state["_rev"] = utterance_rev.get(key, 0)
        prev_src = state["src"]
        if prev_src:
            state["src"] = prev_src + " " + text
        else:
            state["src"] = text
        state["src_lang"] = use_src
        state["tgt_lang"] = target
        full_src = state["src"]  # raw ASR until JSON polish replaces the delta

        def should_abort() -> bool:
            return state.get("_rev") != utterance_rev.get(key, 0)

        def make_chunk_payload(_t: str) -> dict:
            # Prefer polished source mid-flight when available.
            src_out = state.get("_display_src") or state["src"]
            return {
                "type": "t_chunk",
                "text": _t,
                "acc": state["tgt"],
                "uid": uid,
                "final": final,
                "spk": spk,
                "src": src_out,
                "src_lang": use_src,
                "tgt_lang": target,
                "ja": state.get("ja") or "",
                "ko": state.get("ko") or "",
            }

        # Fan out raw source immediately (before LLM) so peers see speech ASAP.
        await broadcast(room_id, json.dumps({
            "type": "t_chunk",
            "text": "",
            "acc": state["tgt"],
            "uid": uid,
            "final": False,
            "spk": spk,
            "src": full_src,
            "src_lang": use_src,
            "tgt_lang": target,
        }, ensure_ascii=False))

        if prev_chunks:
            logger.info(
                "chunk ctx | room=%s spk=%s prev=%d new_len=%d",
                room_id, spk, len(prev_chunks), len(text),
            )

        try:
            await json_translate_pieces(
                room_id=room_id,
                pieces=pieces,
                user_contents=user_contents,
                system_content=ctx + prompt,
                state=state,
                should_abort=should_abort,
                make_chunk_payload=make_chunk_payload,
                source_lang=use_src,
            )
        except Exception as e:
            logger.error("API error: %s", e)
            await send_to(ws, json.dumps({
                "type": "error", "message": str(e), "uid": uid,
            }))
            return

        polished_delta = state.get("_polished_delta") or text
        if prev_src:
            state["src"] = (prev_src.rstrip() + "\n" + polished_delta).strip()
        else:
            state["src"] = polished_delta
        state["_display_src"] = state["src"]
        full_src = state["src"]

        # Expose both languages on the wire for clients that want ja/ko fields.
        if use_src == "ja":
            state["ja"] = full_src
            state["ko"] = state["tgt"]
        else:
            state["ko"] = full_src
            state["ja"] = state["tgt"]

        remember_src(room_id, spk, text)
        # Store polished text in chunk memory for better next-fragment context.
        speaker_chunks.append(room_id, spk, polished_delta)

        if not final:
            if should_abort():
                return
            await broadcast(room_id, json.dumps({
                "type": "t_chunk",
                "text": "",
                "acc": state["tgt"],
                "uid": uid,
                "final": False,
                "spk": spk,
                "src": full_src,
                "src_lang": use_src,
                "tgt_lang": target,
                "ja": state.get("ja") or "",
                "ko": state.get("ko") or "",
            }, ensure_ascii=False))

        if final:
            if should_abort():
                return
            await broadcast(room_id, json.dumps({
                "type": "t_done",
                "full": state["tgt"],
                "uid": uid,
                "final": final,
                "spk": spk,
                "src": full_src,
                "src_lang": use_src,
                "tgt_lang": target,
                "ja": state.get("ja") or "",
                "ko": state.get("ko") or "",
            }, ensure_ascii=False))

            upsert_ctx_entry(ctx_buf, uid, spk, full_src)

            updated = await db.update_message_by_uid(
                room_id, uid, full_src, state["tgt"], use_src, target,
            )
            if not updated:
                await db.insert_message(
                    room_id, uid, spk, full_src, state["tgt"],
                    use_src, target, final,
                )
            utterance_state.pop(key, None)
            utterance_locks.pop(key, None)
            logger.info(
                "translate done | room=%s uid=%s src_len=%d tgt_len=%d",
                room_id, uid, len(full_src), len(state["tgt"]),
            )

async def handle_retranslate(
    ws: WebSocket,
    room_id: str,
    text: str,
    target: str,
    source: str,
    uid: str,
    spk: str,
) -> None:
    detected_src = detect_lang(text)
    use_src = detected_src if source in ("auto", "?") else source
    if target == "auto":
        prompt = AUTO_PROMPT
    else:
        lang = LANG_MAP.get(target, target)
        prompt = STREAM_PROMPT.format(lang=lang)

    logger.info(
        "retranslate | room=%s uid=%s spk=%s src_len=%d",
        room_id, uid, spk, len(text),
    )

    ctx_buf = room_ctx.get(room_id, [])
    upsert_ctx_entry(ctx_buf, uid, spk, text)
    ctx = format_ctx(ctx_buf)

    key = utterance_key(room_id, uid)
    utterance_rev[key] = utterance_rev.get(key, 0) + 1
    utterance_state.pop(key, None)
    lock = utterance_locks.setdefault(key, asyncio.Lock())

    async with lock:
        state = {
            "src": text,
            "tgt": "",
            "src_lang": use_src,
            "tgt_lang": target,
        }
        utterance_state[key] = state
        full_src = text

        def make_chunk_payload(_t: str) -> dict:
            src_out = state.get("_display_src") or state["src"]
            return {
                "type": "t_chunk",
                "text": _t,
                "acc": state["tgt"],
                "uid": uid,
                "final": True,
                "revised": True,
                "spk": spk,
                "src": src_out,
                "src_lang": use_src,
                "tgt_lang": target,
                "ja": state.get("ja") or "",
                "ko": state.get("ko") or "",
            }

        try:
            await json_translate_pieces(
                room_id=room_id,
                pieces=split_text(text),
                system_content=ctx + prompt,
                state=state,
                should_abort=lambda: False,
                make_chunk_payload=make_chunk_payload,
                source_lang=use_src,
            )
            polished = state.get("_polished_delta") or text
            state["src"] = polished
            state["_display_src"] = polished
            full_src = polished
            if use_src == "ja":
                state["ja"], state["ko"] = full_src, state["tgt"]
            else:
                state["ko"], state["ja"] = full_src, state["tgt"]
        except Exception as e:
            logger.error("API error (retranslate): %s", e)
            await send_to(ws, json.dumps({
                "type": "error", "message": str(e), "uid": uid,
            }))
            return
        finally:
            utterance_state.pop(key, None)
            utterance_locks.pop(key, None)

        await broadcast(room_id, json.dumps({
            "type": "t_done",
            "full": state["tgt"],
            "uid": uid,
            "final": True,
            "revised": True,
            "spk": spk,
            "src": full_src,
            "src_lang": use_src,
            "tgt_lang": target,
            "ja": state.get("ja") or "",
            "ko": state.get("ko") or "",
        }, ensure_ascii=False))

        updated = await db.update_message_by_uid(
            room_id, uid, full_src, state["tgt"], use_src, target,
        )
        if not updated:
            await db.insert_message(
                room_id, uid, spk, full_src, state["tgt"],
                use_src, target, True,
            )
        logger.info(
            "retranslate done | room=%s uid=%s src_len=%d tgt_len=%d",
            room_id, uid, len(full_src), len(state["tgt"]),
        )

@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db()
    logger.info("Server starting (room idle timeout: %ds)", ROOM_IDLE_SECS)
    cleanup_task = asyncio.create_task(cleanup_idle_rooms())
    yield
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass
    logger.info("Server shutting down")

app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok", "model": API_MODEL}

@app.get("/screen")
async def screen_page():
    return RedirectResponse(url="/screen.html", status_code=302)

@app.get("/admin")
async def admin_page():
    return RedirectResponse(url="/admin.html", status_code=302)

@app.get("/api/room-policy")
async def room_policy():
    return {"mode": await db.get_room_create_mode()}

@app.post("/room")
async def create_room(request: Request, body: RoomCreateBody | None = None):
    await authorize_room_creation(request, body)
    return {"room": _create_room_record()}

@app.post("/api/admin/login")
async def admin_login(
    request: Request,
    response: Response,
    certificate: UploadFile = File(...),
):
    if not await admin_is_configured():
        raise HTTPException(status_code=503, detail="Admin is not configured")

    ip = client_ip(request)
    rate_key = f"admin_login:{ip}"
    if not auth.rate_limit_allowed(
        rate_key, auth.LOGIN_MAX_ATTEMPTS, auth.LOGIN_WINDOW_SECS,
    ):
        raise HTTPException(status_code=429, detail="Too many login attempts")

    data = await certificate.read(auth.MAX_CERT_BYTES + 1)
    if len(data) > auth.MAX_CERT_BYTES:
        raise HTTPException(status_code=400, detail="Certificate file is too large")

    try:
        parsed = auth.parse_certificate_bytes(data)
    except ValueError as exc:
        auth.record_failed_attempt(rate_key)
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not await authorize_admin_certificate(parsed.fingerprint):
        auth.record_failed_attempt(rate_key)
        raise HTTPException(status_code=401, detail="Certificate is not authorized")

    await db.touch_admin_certificate(parsed.fingerprint)
    token = auth.create_admin_session()
    response.set_cookie(
        auth.SESSION_COOKIE,
        token,
        **auth.cookie_flags(request.url.scheme),
    )
    logger.info("Admin login fingerprint=%s subject=%r", parsed.fingerprint[:12], parsed.subject)
    return {"ok": True}

@app.post("/api/admin/logout")
async def admin_logout(
    response: Response,
    request: Request,
    admin_session: str = Depends(require_admin),
):
    auth.revoke_admin_session(admin_session)
    flags = auth.cookie_flags(request.url.scheme)
    response.delete_cookie(
        auth.SESSION_COOKIE,
        path="/",
        secure=flags.get("secure", False),
        httponly=flags.get("httponly", True),
        samesite=flags.get("samesite", "strict"),
    )
    return {"ok": True}

@app.get("/api/admin/session")
async def admin_session(admin_session: str | None = Cookie(None, alias=auth.SESSION_COOKIE)):
    configured = await admin_is_configured()
    return {
        "authenticated": configured and auth.validate_admin_session(admin_session),
        "configured": configured,
    }

@app.get("/api/admin/settings")
async def admin_get_settings(_: str = Depends(require_admin)):
    return {"room_create_mode": await db.get_room_create_mode()}

@app.put("/api/admin/settings")
async def admin_put_settings(
    body: AdminSettingsBody,
    _: str = Depends(require_admin),
):
    await db.set_room_create_mode(body.room_create_mode)
    logger.info("Room create mode set to %s", body.room_create_mode)
    return {"room_create_mode": body.room_create_mode}

@app.get("/api/admin/passwords")
async def admin_list_passwords(_: str = Depends(require_admin)):
    return {"passwords": await db.list_room_passwords()}

@app.post("/api/admin/passwords")
async def admin_create_password(
    body: IssuePasswordBody,
    _: str = Depends(require_admin),
):
    plain = auth.generate_issue_password()
    pw_id = await db.insert_room_password(body.label, auth.hash_password(plain))
    logger.info("Issue password created id=%d label=%r", pw_id, body.label.strip()[:64])
    return {
        "id": pw_id,
        "password": plain,
        "label": body.label.strip()[:64],
    }

@app.patch("/api/admin/passwords/{password_id}")
async def admin_patch_password(
    password_id: int,
    body: IssuePasswordPatchBody,
    _: str = Depends(require_admin),
):
    updated = await db.set_room_password_enabled(password_id, body.enabled)
    if not updated:
        raise HTTPException(status_code=404, detail="Password not found")
    logger.info("Issue password id=%d enabled=%s", password_id, body.enabled)
    return {"id": password_id, "enabled": body.enabled}

@app.get("/api/admin/certificates")
async def admin_list_certificates(_: str = Depends(require_admin)):
    return {"certificates": await db.list_admin_certificates()}


@app.post("/api/admin/certificates")
async def admin_register_certificate(
    certificate: UploadFile = File(...),
    label: str = Form(""),
    _: str = Depends(require_admin),
):
    data = await certificate.read(auth.MAX_CERT_BYTES + 1)
    if len(data) > auth.MAX_CERT_BYTES:
        raise HTTPException(status_code=400, detail="Certificate file is too large")

    try:
        parsed = auth.parse_certificate_bytes(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        cert_id = await db.insert_admin_certificate(
            parsed.fingerprint,
            label,
            parsed.subject,
        )
    except aiosqlite.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Certificate already registered") from exc

    logger.info(
        "Admin certificate registered id=%d fingerprint=%s",
        cert_id,
        parsed.fingerprint[:12],
    )
    return {
        "id": cert_id,
        "fingerprint": parsed.fingerprint,
        "label": label.strip()[:64],
        "subject": parsed.subject,
        "enabled": True,
    }


@app.patch("/api/admin/certificates/{cert_id}")
async def admin_patch_certificate(
    cert_id: int,
    body: AdminCertPatchBody,
    _: str = Depends(require_admin),
):
    updated = await db.set_admin_certificate_enabled(cert_id, body.enabled)
    if not updated:
        raise HTTPException(status_code=404, detail="Certificate not found")
    logger.info("Admin certificate id=%d enabled=%s", cert_id, body.enabled)
    return {"id": cert_id, "enabled": body.enabled}


@app.post("/api/admin/room")
async def admin_create_room(_: str = Depends(require_admin)):
    return {"room": _create_room_record()}

@app.get("/room/{room_id}")
async def room_exists(room_id: str):
    if not is_valid_room_id(room_id):
        return {"exists": False}
    return {"exists": room_id in rooms}

@app.get("/room/{room_id}/messages")
async def room_messages(
    room_id: str,
    limit: int = Query(default=db.DEFAULT_LIMIT, ge=1, le=db.MAX_LIMIT),
    before_id: int | None = Query(default=None, ge=1),
):
    if not is_valid_room_id(room_id) or room_id not in rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    messages, has_more = await db.get_messages(room_id, limit, before_id)
    return {"messages": messages, "has_more": has_more}

@app.websocket("/ws/{room_id}")
async def ws_endpoint(ws: WebSocket, room_id: str):
    if not is_valid_room_id(room_id) or room_id not in rooms:
        await ws.close(code=4004, reason="Room not found")
        return
    await ws.accept()
    rooms[room_id].add(ws)
    room_clients[ws] = room_id
    touch_room(room_id)

    init_lang = "ja"
    try:
        init_raw = await ws.receive_text()
        init_msg = json.loads(init_raw)
        if init_msg.get("type") == "init" and init_msg.get("lang") in ("ja", "ko"):
            init_lang = init_msg["lang"]
            touch_room(room_id)
    except (json.JSONDecodeError, KeyError):
        logger.warning("Invalid init message, using default lang=ja")
    assigned = pick_name(ws, room_id, init_lang)
    await ws.send_text(json.dumps({
        "type": "system",
        "speaker_id": assigned,
    }))
    logger.info("WebSocket connected room=%s (%d in room, name=%s)", room_id, len(rooms.get(room_id, set())), assigned)
    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)

            if msg.get("type") == "dissolve":
                await dissolve_room(room_id, "dissolved")
                return

            if msg.get("type") == "init":
                touch_room(room_id)
                if msg.get("lang") in ("ja", "ko"):
                    new_name = pick_name(ws, room_id, msg["lang"])
                    await send_to(ws, json.dumps({
                        "type": "system", "speaker_id": new_name,
                    }))
                continue

            touch_room(room_id)

            msg_type = msg.get("type")
            if msg_type not in ("translate", "retranslate"):
                continue

            text = msg.get("text", "")
            target = msg["target_lang"]
            source = msg.get("source_lang", "?")
            uid = msg.get("uid", 0)
            spk = msg.get("speaker_id") or room_names.get(ws, "unknown")
            final = msg.get("is_final", True)
            finalize_only = msg.get("finalize_only", False)

            if finalize_only:
                await finalize_utterance(ws, room_id, uid, spk, target)
                continue

            if not text or not target:
                await send_to(ws, json.dumps({
                    "type": "error", "message": "text and target_lang are required", "uid": uid,
                }))
                continue

            if msg_type == "retranslate":
                await handle_retranslate(
                    ws, room_id, text, target, source, uid, spk,
                )
            else:
                await handle_translate(
                    ws, room_id, text, target, source, uid, spk, final,
                )

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("Unexpected error: %s", e)
    finally:
        rid = room_clients.pop(ws, None)
        if rid:
            room = rooms.get(rid)
            if room is not None:
                room.discard(ws)
            room_names.pop(ws, None)
        logger.info("WebSocket disconnected (rooms: %d)", len(rooms))

class WebSocketSafeStaticFiles(StaticFiles):
    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await send({"type": "websocket.close", "code": 1000})
            return
        await super().__call__(scope, receive, send)

static_dir = HERE.parent / "client"
if static_dir.exists():
    app.mount("/", WebSocketSafeStaticFiles(directory=str(static_dir), html=True), name="client")

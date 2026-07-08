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

STREAM_PROMPT = (
    "You are a real-time interpreter for speech recognition input. "
    "Detect whether the input is Japanese or Korean, "
    "then translate it to {lang}. "
    "The input may contain ASR errors (typos, missing words, false starts, "
    "mid-sentence corrections). Infer the intended meaning and translate "
    "accordingly. Be forgiving of grammar errors in the source. "
    "Preserve the tone and formality of the original. "
    "Output ONLY the translation, no explanations, no notes, no greetings."
)

AUTO_PROMPT = (
    "You are a real-time interpreter for speech recognition input. "
    "Detect whether the input is Japanese or Korean, "
    "then translate it to the opposite language. "
    "(If Japanese → output Korean; if Korean → output Japanese). "
    "The input may contain ASR errors (typos, missing words, false starts, "
    "mid-sentence corrections). Infer the intended meaning and translate "
    "accordingly. Be forgiving of grammar errors in the source. "
    "Preserve the tone and formality of the original. "
    "Output ONLY the translation, no explanations, no notes, no greetings."
)

CONTINUE_PROMPT = (
    "Continue the translation from exactly where you stopped. "
    "Output ONLY the remaining translation with no repetition or commentary."
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
MAX_CTX = 6


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
    room_last_active.pop(room_id, None)
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

async def stream_translate_pieces(
    *,
    room_id: str,
    pieces: list[str],
    system_content: str,
    state: dict,
    should_abort,
    make_chunk_payload,
) -> None:
    """Translate each source piece; auto-continue when max_tokens truncates output."""
    for piece in pieces:
        if should_abort():
            return
        messages = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": piece},
        ]
        while True:
            if should_abort():
                return
            stream = await client.chat.completions.create(
                model=API_MODEL,
                messages=messages,
                stream=True,
                temperature=API_TEMPERATURE,
                max_tokens=max_tokens_for_piece(piece),
            )
            segment = ""
            finish_reason = None
            async for chunk in stream:
                if should_abort():
                    return
                choice = chunk.choices[0]
                if choice.finish_reason:
                    finish_reason = choice.finish_reason
                t = choice.delta.content
                if not t:
                    continue
                segment += t
                state["tgt"] += t
                await broadcast(
                    room_id,
                    json.dumps(make_chunk_payload(t), ensure_ascii=False),
                )
            if finish_reason != "length" or not segment:
                break
            logger.warning(
                "translation truncated (length), continuing | piece_len=%d seg_len=%d",
                len(piece), len(segment),
            )
            messages.extend([
                {"role": "assistant", "content": segment},
                {"role": "user", "content": CONTINUE_PROMPT},
            ])

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

    key = utterance_key(room_id, uid)
    lock = utterance_locks.setdefault(key, asyncio.Lock())

    async with lock:
        state = utterance_state.setdefault(
            key,
            {"src": "", "tgt": "", "src_lang": use_src, "tgt_lang": target},
        )
        state["_rev"] = utterance_rev.get(key, 0)
        state["src"] += text
        state["src_lang"] = use_src
        state["tgt_lang"] = target
        full_src = state["src"]
        rev = state["_rev"]

        def should_abort() -> bool:
            return state.get("_rev") != utterance_rev.get(key, 0)

        def make_chunk_payload(_t: str) -> dict:
            return {
                "type": "t_chunk",
                "text": _t,
                "acc": state["tgt"],
                "uid": uid,
                "final": final,
                "spk": spk,
                "src": full_src,
                "src_lang": use_src,
                "tgt_lang": target,
            }

        try:
            await stream_translate_pieces(
                room_id=room_id,
                pieces=split_text(text),
                system_content=ctx + prompt,
                state=state,
                should_abort=should_abort,
                make_chunk_payload=make_chunk_payload,
            )
        except Exception as e:
            logger.error("API error: %s", e)
            await send_to(ws, json.dumps({
                "type": "error", "message": str(e), "uid": uid,
            }))
            return

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
            return {
                "type": "t_chunk",
                "text": _t,
                "acc": state["tgt"],
                "uid": uid,
                "final": True,
                "revised": True,
                "spk": spk,
                "src": full_src,
                "src_lang": use_src,
                "tgt_lang": target,
            }

        try:
            await stream_translate_pieces(
                room_id=room_id,
                pieces=split_text(text),
                system_content=ctx + prompt,
                state=state,
                should_abort=lambda: False,
                make_chunk_payload=make_chunk_payload,
            )
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

            text = msg["text"]
            target = msg["target_lang"]
            source = msg.get("source_lang", "?")
            uid = msg.get("uid", 0)
            spk = msg.get("speaker_id") or room_names.get(ws, "unknown")
            final = msg.get("is_final", True)

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

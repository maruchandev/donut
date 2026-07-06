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
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from openai import AsyncOpenAI

import db

load_dotenv()

HERE = Path(__file__).resolve().parent
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
API_KEY = os.getenv("API_KEY") or os.getenv("OPENAI_API_KEY", "")
API_BASE_URL = os.getenv("API_BASE_URL", "https://api.deepseek.com/v1")
API_MODEL = os.getenv("API_MODEL", "deepseek-chat")
API_TEMPERATURE = float(os.getenv("API_TEMPERATURE", "0.1"))
API_MAX_TOKENS = int(os.getenv("API_MAX_TOKENS", "256"))
ORIGINS = os.getenv("ORIGINS", "*")
ROOM_IDLE_SECS = int(os.getenv("ROOM_IDLE_SECS", "3600"))
ROOM_CLEANUP_INTERVAL = int(os.getenv("ROOM_CLEANUP_INTERVAL", "60"))

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
    "ねこ", "いぬ", "くま", "うさぎ", "きつね", "とら", "さる", "ぞう", "りす", "はち",
    "ふくろう", "ぺんぎん", "たぬき", "からす", "ぶた", "ひつじ", "うま", "しか", "たにし", "たこ",
    "かえる", "くじら", "らいおん", "あなぐま", "あざらし", "かも", "とり", "ねずみ", "ひとで", "かわうそ",
    "ちーたー", "わし", "ふらみんご", "やもり", "はむすたー", "いぐあな", "じゃがー", "こあら", "れむーる", "まなてぃー",
    "いつかく", "ぱんだ", "くぉっか", "わたがらす", "なまけもの", "くも", "まむし", "せいうち", "やく", "しまうま",
    "あるぱか", "びーばー", "こよーて", "はと", "えみゅー", "ふぇれっと", "きりん", "あいべっくす", "じゃっかる", "きーうぃ",
    "らま", "いもり", "おせろっと", "かものはし", "うずら", "かめ", "はげわし", "おおかみ", "くせるす", "やびー",
    "ぞりら", "あなこんだ", "ひひ", "からかる", "いるか", "はりもぐら", "ふぉっさ", "てながざる", "はいえな", "いんぱら",
    "かんがるー", "すらそにー", "みーあきゃっと", "ぬーとりあ", "おらんうーたん", "くじゃく", "さい", "おおはし", "へらじか", "らくだ",
    "ちんぱんじー", "がぜる", "かば", "ひょう", "まんどりる", "やまあらし", "すかんく", "いたち", "かに", "かます",
]

KR_NAMES = [
    "고양이", "개", "곰", "토끼", "여우", "호랑이", "원숭이", "코끼리", "다람쥐", "벌",
    "올빼미", "펭귄", "너구리", "까마귀", "돼지", "양", "말", "사슴", "우렁이", "문어",
    "개구리", "고래", "사자", "오소리", "물개", "오리", "새", "쥐", "불가사리", "수달",
    "치타", "독수리", "홍학", "도마뱀", "햄스터", "이구아나", "재규어", "코알라", "여우원숭이", "매너티",
    "일각고래", "판다", "쿼카", "까마귀", "나무늘보", "거미", "살모사", "바다코끼리", "야크", "얼룩말",
    "알파카", "비버", "코요테", "비둘기", "에뮤", "족제비", "기린", "아이벡스", "자칼", "키위",
    "라마", "도롱뇽", "오셀롯", "오리너구리", "메추라기", "거북이", "대머리독수리", "늑대", "저빌", "야비",
    "줄무늬족제비", "아나콘다", "개코원숭이", "카라칼", "돌고래", "가시두더지", "포사", "긴팔원숭이", "하이에나", "임팔라",
    "캥거루", "스라소니", "미어캣", "뉴트리아", "오랑우탄", "공작", "코뿔소", "큰부리새", "무스", "낙타",
    "침팬지", "가젤", "하마", "표범", "망토개코원숭이", "호저", "스컹크", "족제비", "게", "가마우지",
]

ROOM_ID_RE = re.compile(r"^\d{6}$")

rooms: dict[str, set[WebSocket]] = {}
room_clients: dict[WebSocket, str] = {}
room_names: dict[WebSocket, str] = {}
room_ctx: dict[str, list[str]] = {}
room_last_active: dict[str, float] = {}
MAX_CTX = 6

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

@app.post("/room")
async def create_room():
    code = gen_room_code()
    rooms[code] = set()
    room_ctx[code] = []
    touch_room(code)
    logger.info("Room created: %s", code)
    return {"room": code}

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

            if msg.get("type") != "translate":
                continue

            touch_room(room_id)

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

            detected_src = detect_lang(text)
            use_src = detected_src if source in ("auto", "?") else source
            if target == "auto":
                target_lang_name = "Korean" if detected_src == "ja" else "Japanese"
                prompt = AUTO_PROMPT
                logger.info("translate | room=%s uid=%s spk=%s src=%s->tgt=%s text_len=%d",
                            room_id, uid, spk, detected_src, "ko" if detected_src == "ja" else "ja", len(text))
            else:
                lang = LANG_MAP.get(target, target)
                target_lang_name = lang
                prompt = STREAM_PROMPT.format(lang=lang)
                logger.info("translate | room=%s uid=%s spk=%s src=%s tgt=%s text_len=%d",
                            room_id, uid, spk, detected_src, target, len(text))

            ctx_buf = room_ctx.get(room_id, [])
            ctx = ""
            if ctx_buf:
                ctx = "Recent conversation:\n" + "\n".join(ctx_buf) + "\n\n"

            try:
                stream = await client.chat.completions.create(
                    model=API_MODEL,
                    messages=[
                        {"role": "system", "content": ctx + prompt},
                        {"role": "user", "content": text},
                    ],
                    stream=True,
                    temperature=API_TEMPERATURE,
                    max_tokens=API_MAX_TOKENS,
                )
            except Exception as e:
                logger.error("API error: %s", e)
                await send_to(ws, json.dumps({
                    "type": "error", "message": str(e), "uid": uid,
                }))
                continue

            acc = ""
            async for chunk in stream:
                t = chunk.choices[0].delta.content
                if not t:
                    continue
                acc += t
                await broadcast(room_id, json.dumps({
                    "type": "t_chunk", "text": t, "acc": acc, "uid": uid,
                    "final": final, "spk": spk, "src": text,
                    "src_lang": use_src, "tgt_lang": target,
                }, ensure_ascii=False))

            await broadcast(room_id, json.dumps({
                "type": "t_done", "full": acc, "uid": uid,
                "final": final, "spk": spk, "src": text,
                "src_lang": use_src, "tgt_lang": target,
            }, ensure_ascii=False))

            ctx_buf.append(f"{spk}: {text}")
            if len(ctx_buf) > MAX_CTX:
                ctx_buf.pop(0)

            await db.insert_message(
                room_id, uid, spk, text, acc, use_src, target, final,
            )
            logger.info("translate done | room=%s uid=%s tokens=%d", room_id, uid, len(acc))

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

static_dir = HERE.parent / "client"
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="client")

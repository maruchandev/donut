import json
import os
import logging
from pathlib import Path
from contextlib import asynccontextmanager
from asyncio import Queue

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from openai import AsyncOpenAI

load_dotenv()

HERE = Path(__file__).resolve().parent
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
API_KEY = os.getenv("API_KEY") or os.getenv("OPENAI_API_KEY", "")
API_BASE_URL = os.getenv("API_BASE_URL", "https://api.deepseek.com/v1")
API_MODEL = os.getenv("API_MODEL", "deepseek-chat")
API_TEMPERATURE = float(os.getenv("API_TEMPERATURE", "0.1"))
API_MAX_TOKENS = int(os.getenv("API_MAX_TOKENS", "256"))
ORIGINS = os.getenv("ORIGINS", "*")

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

clients: dict[WebSocket, str] = {}
ctx_buf: list[str] = []
MAX_CTX = 6

def pick_name(ws: WebSocket, lang: str) -> str:
    pool = JP_NAMES if lang == "ja" else KR_NAMES
    old = clients.get(ws)
    used = {v for k, v in clients.items() if k is not ws}
    for name in pool:
        if name not in used:
            clients[ws] = name
            return name
    if old and old not in used:
        return old
    name = f"User{len(used)}"
    clients[ws] = name
    return name

async def broadcast(data: str):
    dead: list[WebSocket] = []
    for c in clients:
        try:
            await c.send_text(data)
        except Exception:
            dead.append(c)
    for c in dead:
        clients.pop(c, None)

async def send_to(ws: WebSocket, data: str):
    try:
        await ws.send_text(data)
    except Exception:
        clients.pop(ws, None)

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Server starting")
    yield
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

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    init_lang = "ja"
    try:
        init_raw = await ws.receive_text()
        init_msg = json.loads(init_raw)
        if init_msg.get("type") == "init" and init_msg.get("lang") in ("ja", "ko"):
            init_lang = init_msg["lang"]
    except (json.JSONDecodeError, KeyError):
        logger.warning("Invalid init message, using default lang=ja")
    assigned = pick_name(ws, init_lang)
    await ws.send_text(json.dumps({
        "type": "system",
        "speaker_id": assigned,
    }))
    logger.info("WebSocket connected (%d total, name=%s)", len(clients), assigned)
    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)

            if msg.get("type") == "init":
                if msg.get("lang") in ("ja", "ko"):
                    new_name = pick_name(ws, msg["lang"])
                    await send_to(ws, json.dumps({
                        "type": "system",
                        "speaker_id": new_name,
                    }))
                continue

            if msg.get("type") != "translate":
                continue

            text = msg["text"]
            target = msg["target_lang"]
            source = msg.get("source_lang", "?")
            uid = msg.get("uid", 0)
            spk = msg.get("speaker_id") or clients.get(ws, "unknown")
            final = msg.get("is_final", True)

            if not text or not target:
                await send_to(ws, json.dumps({
                    "type": "error",
                    "message": "text and target_lang are required",
                    "uid": uid,
                }))
                continue

            detected_src = detect_lang(text)
            use_src = detected_src if source in ("auto", "?") else source
            if target == "auto":
                target_lang_name = "Korean" if detected_src == "ja" else "Japanese"
                prompt = AUTO_PROMPT
                logger.info("translate | uid=%s spk=%s src=%s->tgt=%s text_len=%d",
                            uid, spk, detected_src, "ko" if detected_src == "ja" else "ja", len(text))
            else:
                lang = LANG_MAP.get(target, target)
                target_lang_name = lang
                prompt = STREAM_PROMPT.format(lang=lang)
                logger.info("translate | uid=%s spk=%s src=%s tgt=%s text_len=%d",
                            uid, spk, detected_src, target, len(text))

            ctx = ""
            if ctx_buf:
                ctx = "Recent conversation:\n" + "\n".join(ctx_buf) + "\n\n"

            try:
                stream = await client.chat.completions.create(
                    model=API_MODEL,
                    messages=[
                        {"role": "system",
                         "content": ctx + prompt},
                        {"role": "user", "content": text},
                    ],
                    stream=True,
                    temperature=API_TEMPERATURE,
                    max_tokens=API_MAX_TOKENS,
                )
            except Exception as e:
                logger.error("API error: %s", e)
                await send_to(ws, json.dumps({
                    "type": "error",
                    "message": str(e),
                    "uid": uid,
                }))
                continue

            acc = ""
            async for chunk in stream:
                t = chunk.choices[0].delta.content
                if not t:
                    continue
                acc += t
                await broadcast(json.dumps({
                    "type": "t_chunk",
                    "text": t,
                    "acc": acc,
                    "uid": uid,
                    "final": final,
                    "spk": spk,
                    "src": text,
                    "src_lang": use_src,
                    "tgt_lang": target,
                }, ensure_ascii=False))

            await broadcast(json.dumps({
                "type": "t_done",
                "full": acc,
                "uid": uid,
                "final": final,
                "spk": spk,
                "src": text,
                "src_lang": use_src,
                "tgt_lang": target,
            }, ensure_ascii=False))

            ctx_buf.append(f"{spk}: {text}")
            if len(ctx_buf) > MAX_CTX:
                ctx_buf.pop(0)

            logger.info("translate done | uid=%s tokens=%d", uid, len(acc))

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("Unexpected error: %s", e)
    finally:
        clients.pop(ws, None)
        logger.info("WebSocket disconnected (%d remaining)", len(clients))

static_dir = HERE.parent / "client"
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="client")

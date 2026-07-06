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
    "Translate the following text to {lang}. "
    "The input may contain ASR errors (typos, missing words, false starts, "
    "mid-sentence corrections). Infer the intended meaning and translate "
    "accordingly. Be forgiving of grammar errors in the source. "
    "Preserve the tone and formality of the original. "
    "Output ONLY the translation, no explanations, no notes, no greetings."
)

LANG_MAP = {"ja": "Japanese", "en": "English", "ko": "Korean"}

clients: set[WebSocket] = set()
ctx_buf: list[str] = []
MAX_CTX = 6


async def broadcast(data: str):
    dead: list[WebSocket] = []
    for c in clients:
        try:
            await c.send_text(data)
        except Exception:
            dead.append(c)
    for c in dead:
        clients.discard(c)


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
    clients.add(ws)
    logger.info("WebSocket connected (%d total)", len(clients))
    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)

            if msg.get("type") != "translate":
                continue

            text = msg["text"]
            target = msg["target_lang"]
            source = msg.get("source_lang", "?")
            uid = msg.get("uid", 0)
            spk = msg.get("speaker_id", "unknown")
            final = msg.get("is_final", False)

            if not text or not target:
                await broadcast(json.dumps({
                    "type": "error",
                    "message": "text and target_lang are required",
                    "uid": uid,
                }))
                continue

            lang = LANG_MAP.get(target, target)
            logger.info("translate | uid=%s spk=%s lang=%s text_len=%d",
                        uid, spk, lang, len(text))

            ctx = ""
            if ctx_buf:
                ctx = "Recent conversation:\n" + "\n".join(ctx_buf) + "\n\n"

            try:
                stream = await client.chat.completions.create(
                    model=API_MODEL,
                    messages=[
                        {"role": "system",
                         "content": ctx + STREAM_PROMPT.format(lang=lang)},
                        {"role": "user", "content": text},
                    ],
                    stream=True,
                    temperature=API_TEMPERATURE,
                    max_tokens=API_MAX_TOKENS,
                )
            except Exception as e:
                logger.error("API error: %s", e)
                await broadcast(json.dumps({
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
                    "src_lang": source,
                    "tgt_lang": target,
                }, ensure_ascii=False))

            await broadcast(json.dumps({
                "type": "t_done",
                "full": acc,
                "uid": uid,
                "final": final,
                "spk": spk,
                "src": text,
                "src_lang": source,
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
        clients.discard(ws)
        logger.info("WebSocket disconnected (%d remaining)", len(clients))


static_dir = HERE.parent / "client"
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="client")

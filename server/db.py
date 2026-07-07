import time
from pathlib import Path

import aiosqlite

HERE = Path(__file__).resolve().parent
DB_PATH = HERE / "data" / "conversations.db"
DEFAULT_LIMIT = 25
MAX_LIMIT = 50


async def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room_id TEXT NOT NULL,
                uid TEXT NOT NULL,
                speaker TEXT NOT NULL,
                src TEXT NOT NULL,
                tgt TEXT NOT NULL,
                src_lang TEXT NOT NULL DEFAULT '?',
                tgt_lang TEXT NOT NULL DEFAULT 'auto',
                is_final INTEGER NOT NULL DEFAULT 1,
                created_at REAL NOT NULL
            )
            """
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id, id)"
        )
        await db.commit()


async def insert_message(
    room_id: str,
    uid: str,
    speaker: str,
    src: str,
    tgt: str,
    src_lang: str,
    tgt_lang: str,
    is_final: bool,
) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """
            INSERT INTO messages
                (room_id, uid, speaker, src, tgt, src_lang, tgt_lang, is_final, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                room_id,
                uid,
                speaker,
                src,
                tgt,
                src_lang,
                tgt_lang,
                1 if is_final else 0,
                time.time(),
            ),
        )
        await db.commit()
        return cursor.lastrowid or 0


def _row_to_dict(row: aiosqlite.Row) -> dict:
    return {
        "id": row["id"],
        "uid": row["uid"],
        "spk": row["speaker"],
        "src": row["src"],
        "full": row["tgt"],
        "src_lang": row["src_lang"],
        "tgt_lang": row["tgt_lang"],
        "final": bool(row["is_final"]),
        "ts": row["created_at"],
    }


async def get_messages(
    room_id: str,
    limit: int = DEFAULT_LIMIT,
    before_id: int | None = None,
) -> tuple[list[dict], bool]:
    limit = max(1, min(limit, MAX_LIMIT))
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if before_id is not None:
            cursor = await db.execute(
                """
                SELECT id, uid, speaker, src, tgt, src_lang, tgt_lang, is_final, created_at
                FROM messages
                WHERE room_id = ? AND id < ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (room_id, before_id, limit + 1),
            )
        else:
            cursor = await db.execute(
                """
                SELECT id, uid, speaker, src, tgt, src_lang, tgt_lang, is_final, created_at
                FROM messages
                WHERE room_id = ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (room_id, limit + 1),
            )
        rows = await cursor.fetchall()
    has_more = len(rows) > limit
    rows = rows[:limit]
    rows = list(reversed(rows))
    return [_row_to_dict(r) for r in rows], has_more


async def update_message_by_uid(
    room_id: str,
    uid: str,
    src: str,
    tgt: str,
    src_lang: str,
    tgt_lang: str,
) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """
            UPDATE messages
            SET src = ?, tgt = ?, src_lang = ?, tgt_lang = ?, is_final = 1, created_at = ?
            WHERE room_id = ? AND uid = ?
            """,
            (src, tgt, src_lang, tgt_lang, time.time(), room_id, uid),
        )
        await db.commit()
        return (cursor.rowcount or 0) > 0


async def delete_room_messages(room_id: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM messages WHERE room_id = ?", (room_id,))
        await db.commit()
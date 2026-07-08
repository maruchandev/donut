import time
from pathlib import Path

import aiosqlite

HERE = Path(__file__).resolve().parent
DB_PATH = HERE / "data" / "conversations.db"
DEFAULT_LIMIT = 25
MAX_LIMIT = 50

ROOM_CREATE_MODES = frozenset({"open", "closed", "password"})
DEFAULT_ROOM_CREATE_MODE = "open"


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
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS room_passwords (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                label TEXT NOT NULL DEFAULT '',
                password_hash TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at REAL NOT NULL,
                last_used_at REAL
            )
            """
        )
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS admin_certificates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fingerprint TEXT NOT NULL UNIQUE,
                label TEXT NOT NULL DEFAULT '',
                subject TEXT NOT NULL DEFAULT '',
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at REAL NOT NULL,
                last_used_at REAL
            )
            """
        )
        await db.execute(
            """
            INSERT OR IGNORE INTO settings (key, value)
            VALUES ('room_create_mode', ?)
            """,
            (DEFAULT_ROOM_CREATE_MODE,),
        )
        await db.commit()


async def get_setting(key: str, default: str = "") -> str:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "SELECT value FROM settings WHERE key = ?",
            (key,),
        )
        row = await cursor.fetchone()
    return row[0] if row else default


async def set_setting(key: str, value: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (key, value),
        )
        await db.commit()


async def get_room_create_mode() -> str:
    mode = await get_setting("room_create_mode", DEFAULT_ROOM_CREATE_MODE)
    return mode if mode in ROOM_CREATE_MODES else DEFAULT_ROOM_CREATE_MODE


async def set_room_create_mode(mode: str) -> None:
    if mode not in ROOM_CREATE_MODES:
        raise ValueError(f"Invalid room create mode: {mode}")
    await set_setting("room_create_mode", mode)


async def list_room_passwords() -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT id, label, enabled, created_at, last_used_at
            FROM room_passwords
            ORDER BY id DESC
            """
        )
        rows = await cursor.fetchall()
    return [
        {
            "id": row["id"],
            "label": row["label"],
            "enabled": bool(row["enabled"]),
            "created_at": row["created_at"],
            "last_used_at": row["last_used_at"],
        }
        for row in rows
    ]


async def insert_room_password(label: str, password_hash: str) -> int:
    now = time.time()
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """
            INSERT INTO room_passwords (label, password_hash, enabled, created_at)
            VALUES (?, ?, 1, ?)
            """,
            (label.strip()[:64], password_hash, now),
        )
        await db.commit()
        return cursor.lastrowid or 0


async def set_room_password_enabled(password_id: int, enabled: bool) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "UPDATE room_passwords SET enabled = ? WHERE id = ?",
            (1 if enabled else 0, password_id),
        )
        await db.commit()
        return (cursor.rowcount or 0) > 0


async def get_enabled_room_password_hashes() -> list[tuple[int, str]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT id, password_hash
            FROM room_passwords
            WHERE enabled = 1
            """
        )
        rows = await cursor.fetchall()
    return [(row["id"], row["password_hash"]) for row in rows]


async def touch_room_password(password_id: int) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE room_passwords SET last_used_at = ? WHERE id = ?",
            (time.time(), password_id),
        )
        await db.commit()


async def has_enabled_admin_certificates() -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "SELECT 1 FROM admin_certificates WHERE enabled = 1 LIMIT 1"
        )
        row = await cursor.fetchone()
    return row is not None


async def list_admin_certificates() -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT id, fingerprint, label, subject, enabled, created_at, last_used_at
            FROM admin_certificates
            ORDER BY id DESC
            """
        )
        rows = await cursor.fetchall()
    return [
        {
            "id": row["id"],
            "fingerprint": row["fingerprint"],
            "label": row["label"],
            "subject": row["subject"],
            "enabled": bool(row["enabled"]),
            "created_at": row["created_at"],
            "last_used_at": row["last_used_at"],
        }
        for row in rows
    ]


async def get_enabled_admin_fingerprints() -> set[str]:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "SELECT fingerprint FROM admin_certificates WHERE enabled = 1"
        )
        rows = await cursor.fetchall()
    return {row[0] for row in rows}


async def insert_admin_certificate(
    fingerprint: str,
    label: str,
    subject: str,
) -> int:
    now = time.time()
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """
            INSERT INTO admin_certificates
                (fingerprint, label, subject, enabled, created_at)
            VALUES (?, ?, ?, 1, ?)
            """,
            (fingerprint, label.strip()[:64], subject[:128], now),
        )
        await db.commit()
        return cursor.lastrowid or 0


async def set_admin_certificate_enabled(cert_id: int, enabled: bool) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "UPDATE admin_certificates SET enabled = ? WHERE id = ?",
            (1 if enabled else 0, cert_id),
        )
        await db.commit()
        return (cursor.rowcount or 0) > 0


async def touch_admin_certificate(fingerprint: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE admin_certificates SET last_used_at = ? WHERE fingerprint = ?",
            (time.time(), fingerprint),
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
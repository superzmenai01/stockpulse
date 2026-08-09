"""
models/trade_journal.py — Trade Journal MVP (大少 2026-08-09 11:07 揀 MVP scope)

Stage 1+ 真實 forward return tracking:
- init_trade_journal_table()  — DDL
- add_entry()                  — POST endpoint helper
- list_entries()               — GET list helper
- get_entry_by_id()            — GET by id helper (future use)

DB schema (大少 11:07 MVP):
- id: auto-increment unit_id
- symbol: 'HK.00700' / 'US.AAPL'
- entry_date: 'YYYY-MM-DD'
- entry_price: 買入價
- shares: 買入股數 (default 1)
- target_price: optional 目標價
- stop_loss: optional 止蝕價
- notes: optional 大少 備註
- created_at: auto timestamp
- UNIQUE(symbol, entry_date) — 防止重複 add

永久保留 (大少 22:28 永久 rule: forward return cache 永久)
"""
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

DEFAULT_DB_PATH = Path.home() / "stockpulse" / "backend" / "data" / "stocks.db"


def get_connection(db_path: Path = DEFAULT_DB_PATH) -> sqlite3.Connection:
    return sqlite3.connect(str(db_path))


# ============================================================================
# DDL
# ============================================================================

def init_trade_journal_table(db_path: Path = DEFAULT_DB_PATH) -> None:
    """Create trade_journal table if not exists (Stage 1+ MVP)"""
    with get_connection(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS trade_journal (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL,
                entry_date TEXT NOT NULL,
                entry_price REAL NOT NULL,
                shares REAL NOT NULL DEFAULT 1.0,
                target_price REAL,
                stop_loss REAL,
                notes TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(symbol, entry_date)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_trade_journal_symbol ON trade_journal(symbol)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_trade_journal_entry_date ON trade_journal(entry_date DESC)")
        conn.commit()


# ============================================================================
# Helpers
# ============================================================================

def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "symbol": row["symbol"],
        "entry_date": row["entry_date"],
        "entry_price": row["entry_price"],
        "shares": row["shares"],
        "target_price": row["target_price"],
        "stop_loss": row["stop_loss"],
        "notes": row["notes"] or "",
        "created_at": row["created_at"],
    }


def add_entry(
    symbol: str,
    entry_date: str,
    entry_price: float,
    shares: float = 1.0,
    target_price: Optional[float] = None,
    stop_loss: Optional[float] = None,
    notes: Optional[str] = "",
    db_path: Path = DEFAULT_DB_PATH,
) -> dict[str, Any]:
    """[POST] 加 1 條 Trade Journal entry.

    Raises sqlite3.IntegrityError if (symbol, entry_date) 重複.
    """
    with get_connection(db_path) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.execute(
            """
            INSERT INTO trade_journal (symbol, entry_date, entry_price, shares, target_price, stop_loss, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (symbol, entry_date, entry_price, shares, target_price, stop_loss, notes or ""),
        )
        conn.commit()
        entry_id = cursor.lastrowid
        row = conn.execute("SELECT * FROM trade_journal WHERE id = ?", (entry_id,)).fetchone()
    return _row_to_dict(row)


def list_entries(
    symbol: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    db_path: Path = DEFAULT_DB_PATH,
) -> list[dict[str, Any]]:
    """[GET] 列出 entries (newest first by entry_date DESC, id DESC)"""
    with get_connection(db_path) as conn:
        conn.row_factory = sqlite3.Row
        if symbol:
            rows = conn.execute(
                "SELECT * FROM trade_journal WHERE symbol = ? ORDER BY entry_date DESC, id DESC LIMIT ? OFFSET ?",
                (symbol, limit, offset),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM trade_journal ORDER BY entry_date DESC, id DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
    return [_row_to_dict(r) for r in rows]


def count_entries(
    symbol: Optional[str] = None,
    db_path: Path = DEFAULT_DB_PATH,
) -> int:
    """[GET] 計算 total entries (for pagination)"""
    with get_connection(db_path) as conn:
        if symbol:
            row = conn.execute("SELECT COUNT(*) AS c FROM trade_journal WHERE symbol = ?", (symbol,)).fetchone()
        else:
            row = conn.execute("SELECT COUNT(*) AS c FROM trade_journal").fetchone()
    return row[0] if row else 0


def get_entry_by_id(
    entry_id: int,
    db_path: Path = DEFAULT_DB_PATH,
) -> Optional[dict[str, Any]]:
    """[GET] 拎單一 entry by id"""
    with get_connection(db_path) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM trade_journal WHERE id = ?", (entry_id,)).fetchone()
    return _row_to_dict(row) if row else None

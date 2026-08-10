"""
models/trade_journal.py — Trade Journal (Stage 1+ MVP + Followup, 大少 2026-08-09 15:04 揀 Full scope)

Stage 1+ 真實 forward return tracking:
- init_trade_journal_table()  — DDL + idempotent migration
- add_entry()                  — POST endpoint helper
- list_entries()               — GET list helper
- get_entry_by_id()            — GET by id helper
- update_entry()               — PUT endpoint helper (Stage 1+ followup)
- delete_entry()               — DELETE endpoint helper (Stage 1+ followup)
- get_stats()                  — GET stats endpoint helper (Stage 1+ followup, 6 metrics)

DB schema (Stage 1+ followup 2026-08-09, 揀 Full scope):
- id: auto-increment unit_id
- symbol: 'HK.00700' / 'US.AAPL'
- entry_date: 'YYYY-MM-DD'
- entry_price: 買入價
- shares: 買入股數 (default 1)
- target_price: optional 目標價
- stop_loss: optional 止蝕價
- notes: optional 大少 備註
- created_at: auto timestamp
- actual_exit_date: optional 真實賣出日期 (Stage 1+ followup 加)
- actual_exit_price: optional 真實賣出價 (Stage 1+ followup 加)
- is_correct: 0/1/NULL — 大少 mark 啱/錯 (Stage 1+ followup 加, NULL = 未 mark)
- updated_at: 最後改時間 (Stage 1+ followup 加)
- source: TEXT NOT NULL DEFAULT 'manual' (Hybrid source field, 2026-08-10 09:33 大少 confirm Option 3)
  - 'manual': 大少真實 trade (default)
  - 'paper_trading': 獨立 page paper trading sim (sprint 2 設計, source = paper trading)
  - 'm9_pilot_derive': M9 Pilot 過去 records derive (Stage 1+ baseline, source = M9 derived)
- UNIQUE(symbol, entry_date) — 防止重複 add

永久保留 (大少 22:28 永久 rule: forward return cache 永久)
"""
import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

DEFAULT_DB_PATH = Path.home() / "stockpulse" / "backend" / "data" / "stocks.db"


def get_connection(db_path: Path = DEFAULT_DB_PATH) -> sqlite3.Connection:
    return sqlite3.connect(str(db_path))


# ============================================================================
# DDL
# ============================================================================

# Stage 1+ followup (大少 15:04 揀 Full scope): 加 4 個 column 落 existing table
FOLLOWUP_COLUMNS = [
    ("actual_exit_date", "TEXT"),
    ("actual_exit_price", "REAL"),
    ("is_correct", "INTEGER"),
    ("updated_at", "TEXT"),
]

# Hybrid source column (大少 2026-08-10 09:33 confirm Option 3 — 3 條 stream 並行)
# 唔入 FOLLOWUP_COLUMNS list 因為 source field 唔屬於 15:04 followup scope
# 3 個 values: 'manual' (大少真實) / 'paper_trading' (sprint 2 sim) / 'm9_pilot_derive' (Stage 1+ baseline)
SOURCE_COLUMN = ("source", "TEXT NOT NULL DEFAULT 'manual'")


def _ensure_columns(conn: sqlite3.Connection) -> None:
    """Idempotent migration: 加 Stage 1+ followup column 落 existing table.

    大少 15:04 揀 Full scope default decision #1: standard naming.
    大少 2026-08-10 09:33 confirm Option 3 Hybrid: source column 區分 3 條 stream.
    """
    existing_cols = {row[1] for row in conn.execute("PRAGMA table_info(trade_journal)").fetchall()}
    # Stage 1+ followup 4 columns (大少 15:04 揀 Full scope)
    for col_name, col_type in FOLLOWUP_COLUMNS:
        if col_name not in existing_cols:
            conn.execute(f"ALTER TABLE trade_journal ADD COLUMN {col_name} {col_type}")
    # Hybrid source column (大少 2026-08-10 09:33 Option 3)
    src_name, src_type = SOURCE_COLUMN
    if src_name not in existing_cols:
        conn.execute(f"ALTER TABLE trade_journal ADD COLUMN {src_name} {src_type}")


def init_trade_journal_table(db_path: Path = DEFAULT_DB_PATH) -> None:
    """Create trade_journal table if not exists + idempotent migration (Stage 1+ MVP + followup)"""
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
        # Stage 1+ followup: 加 4 個新 column (idempotent)
        _ensure_columns(conn)
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
        # Stage 1+ followup 4 個新 column
        "actual_exit_date": row["actual_exit_date"],
        "actual_exit_price": row["actual_exit_price"],
        "is_correct": row["is_correct"],
        "updated_at": row["updated_at"],
        # Hybrid source column (大少 2026-08-10 09:33 Option 3)
        # 0 pollution: 純加 column + dict field, 唔改 logic
        "source": row["source"] if "source" in row.keys() else "manual",
    }


def add_entry(
    symbol: str,
    entry_date: str,
    entry_price: float,
    shares: float = 1.0,
    target_price: Optional[float] = None,
    stop_loss: Optional[float] = None,
    notes: Optional[str] = "",
    source: Optional[str] = None,  # Sprint 2 paper trading sim 加 (大少 2026-08-10 Option A fix): None = 默認 'manual'
    db_path: Path = DEFAULT_DB_PATH,
) -> dict[str, Any]:
    """[POST] 加 1 條 Trade Journal entry.

    Raises sqlite3.IntegrityError if (symbol, entry_date) 重複.

    Sprint 2 paper trading sim 加 source param (default None = 默認 'manual')
    """
    with get_connection(db_path) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.execute(
            """
            INSERT INTO trade_journal (symbol, entry_date, entry_price, shares, target_price, stop_loss, notes, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'manual'))
            """,
            (symbol, entry_date, entry_price, shares, target_price, stop_loss, notes or "", source),
        )
        conn.commit()
        entry_id = cursor.lastrowid
        row = conn.execute("SELECT * FROM trade_journal WHERE id = ?", (entry_id,)).fetchone()
    return _row_to_dict(row)


def list_entries(
    symbol: Optional[str] = None,
    source: Optional[str] = None,  # Sprint 2 paper trading sim: filter by source field (大少 2026-08-10 Option A 1 line 改動)
    limit: int = 50,
    offset: int = 0,
    db_path: Path = DEFAULT_DB_PATH,
) -> list[dict[str, Any]]:
    """[GET] 列出 entries (newest first by entry_date DESC, id DESC)

    Args:
        symbol: Filter by stock code (e.g. 'HK.00700') — optional
        source: Filter by source field (e.g. 'paper_trading', 'm9_pilot_derive', 'manual') — Sprint 2 paper trading sim 加
        limit: Max entries (default 50)
        offset: Pagination offset (default 0)

    跟 AGENTS.md '3-Section 永久 Rule' 應用: 0 改 logic, 純加 optional filter param
    """
    with get_connection(db_path) as conn:
        conn.row_factory = sqlite3.Row
        # 構建 WHERE clause (Sprint 2 paper trading sim 改動: 支持 symbol + source 任意組合 filter)
        where_clauses: list[str] = []
        params: list[Any] = []
        if symbol:
            where_clauses.append("symbol = ?")
            params.append(symbol)
        if source:
            where_clauses.append("source = ?")
            params.append(source)
        where_sql = " WHERE " + " AND ".join(where_clauses) if where_clauses else ""
        sql = f"SELECT * FROM trade_journal{where_sql} ORDER BY entry_date DESC, id DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = conn.execute(sql, params).fetchall()
    return [_row_to_dict(r) for r in rows]


def count_entries(
    symbol: Optional[str] = None,
    source: Optional[str] = None,  # Sprint 2 paper trading sim: 同步加 source filter
    db_path: Path = DEFAULT_DB_PATH,
) -> int:
    """[GET] 計算 total entries (for pagination)"""
    with get_connection(db_path) as conn:
        # 構建 WHERE clause (跟 list_entries 同步)
        where_clauses: list[str] = []
        params: list[Any] = []
        if symbol:
            where_clauses.append("symbol = ?")
            params.append(symbol)
        if source:
            where_clauses.append("source = ?")
            params.append(source)
        where_sql = " WHERE " + " AND ".join(where_clauses) if where_clauses else ""
        sql = f"SELECT COUNT(*) AS c FROM trade_journal{where_sql}"
        row = conn.execute(sql, params).fetchone()
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


# ============================================================================
# Stage 1+ followup (大少 15:04 揀 Full scope) helpers
# ============================================================================

def update_entry(
    entry_id: int,
    actual_exit_date: Optional[str] = None,
    actual_exit_price: Optional[float] = None,
    is_correct: Optional[bool] = None,
    notes: Optional[str] = None,
    db_path: Path = DEFAULT_DB_PATH,
) -> Optional[dict[str, Any]]:
    """[PUT] 改 entry 嘅 actual exit + 啱/錯 mark.

    大少 15:04 default decision #3 + #4:
    - forward return 用 actual_exit_price (大少手動 mark 真實賣出價)
    - is_correct 手動 mark (大少自己判斷, NULL = 未 mark)

    Returns updated entry, or None if entry not exist.
    """
    updates: list[str] = []
    values: list[Any] = []

    if actual_exit_date is not None:
        updates.append("actual_exit_date = ?")
        values.append(actual_exit_date)
    if actual_exit_price is not None:
        updates.append("actual_exit_price = ?")
        values.append(actual_exit_price)
    if is_correct is not None:
        updates.append("is_correct = ?")
        values.append(1 if is_correct else 0)
    if notes is not None:
        updates.append("notes = ?")
        values.append(notes)

    if not updates:
        # 冇嘢要 update, return existing
        return get_entry_by_id(entry_id, db_path)

    # 大少 15:04: updated_at 每次 update 都 set 做而家
    updates.append("updated_at = ?")
    values.append(datetime.utcnow().isoformat(timespec="seconds") + "Z")

    values.append(entry_id)

    with get_connection(db_path) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.execute(
            f"UPDATE trade_journal SET {', '.join(updates)} WHERE id = ?",
            values,
        )
        conn.commit()
        if cursor.rowcount == 0:
            return None
        row = conn.execute("SELECT * FROM trade_journal WHERE id = ?", (entry_id,)).fetchone()
    return _row_to_dict(row) if row else None


def delete_entry(
    entry_id: int,
    db_path: Path = DEFAULT_DB_PATH,
) -> bool:
    """[DELETE] 刪 entry by id.

    Returns True if deleted, False if not exist.
    """
    with get_connection(db_path) as conn:
        cursor = conn.execute("DELETE FROM trade_journal WHERE id = ?", (entry_id,))
        conn.commit()
        return cursor.rowcount > 0


def get_stats(
    symbol: Optional[str] = None,
    days: int = 30,
    db_path: Path = DEFAULT_DB_PATH,
) -> dict[str, Any]:
    """[GET] 計算 6 個 metrics 過去 N 日.

    大少 15:04 揀 6 個 metrics (default decision):
    - total: total entries in window
    - correct_count: entries with is_correct = 1
    - hit_rate: correct_count / (entries with is_correct not null)
    - avg_return_5d: 平均 forward return, holding period <= 5 日
    - avg_return_20d: 平均 forward return, holding period 5-20 日
    - best_worst_trade: {best, worst} 最高 / 最低 return (any holding period)

    Edge case: total=0 → hit_rate=null, all avg=null
    """
    cutoff_date = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")

    with get_connection(db_path) as conn:
        conn.row_factory = sqlite3.Row
        if symbol:
            rows = conn.execute(
                """
                SELECT * FROM trade_journal
                WHERE symbol = ? AND entry_date >= ?
                ORDER BY entry_date DESC, id DESC
                """,
                (symbol, cutoff_date),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT * FROM trade_journal
                WHERE entry_date >= ?
                ORDER BY entry_date DESC, id DESC
                """,
                (cutoff_date,),
            ).fetchall()

    # 計算 metrics
    total = len(rows)
    entries_with_correct = [r for r in rows if r["is_correct"] is not None]
    correct_count = sum(1 for r in entries_with_correct if r["is_correct"] == 1)

    # Hit rate
    if len(entries_with_correct) > 0:
        hit_rate = correct_count / len(entries_with_correct)
    else:
        hit_rate = None

    # Forward return (用 actual_exit_price 對比 entry_price, 大少 15:04 default #3)
    # 分 5d / 20d bucket 根據 holding period (actual_exit_date - entry_date)
    returns_5d: list[float] = []
    returns_20d: list[float] = []
    all_returns: list[float] = []
    for r in rows:
        if r["actual_exit_price"] is None or not r["entry_price"]:
            continue
        if not r["actual_exit_date"] or not r["entry_date"]:
            continue
        try:
            holding_days = (
                datetime.strptime(r["actual_exit_date"], "%Y-%m-%d")
                - datetime.strptime(r["entry_date"], "%Y-%m-%d")
            ).days
        except ValueError:
            continue
        ret = (r["actual_exit_price"] - r["entry_price"]) / r["entry_price"]
        all_returns.append(ret)
        if holding_days <= 5:
            returns_5d.append(ret)
        elif holding_days <= 20:
            returns_20d.append(ret)

    avg_return_5d = sum(returns_5d) / len(returns_5d) if returns_5d else None
    avg_return_20d = sum(returns_20d) / len(returns_20d) if returns_20d else None

    return {
        "total": total,
        "correct_count": correct_count,
        "hit_rate": hit_rate,
        "avg_return_5d": avg_return_5d,
        "avg_return_20d": avg_return_20d,
        "best_worst_trade": {
            "best": max(all_returns) if all_returns else None,
            "worst": min(all_returns) if all_returns else None,
        },
        "filter": {"symbol": symbol, "days": days},
    }

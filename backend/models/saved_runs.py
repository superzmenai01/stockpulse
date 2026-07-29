"""
models/saved_runs.py — Saved Algorithm Runs CRUD (大少 2026-07-24)

Modular block architecture:
- init_saved_runs_table()  — DDL
- save_run()               — POST endpoint helper
- list_runs()              — GET list helper
- get_run()                — GET by id helper
- update_run()             — PUT (name/note)
- delete_run()             — DELETE
- generate_auto_name()     — auto-name helper (algorithm_name + date + HHMM)

DB schema (大少 2026-07-24 #7051):
- id: auto-increment unit_id (primary key)
- algorithm_id: 'AS-01'
- algorithm_name: '板塊龍頭股'
- name: editable, user-friendly name
- note: editable, optional 備註
- saved_at: auto timestamp
- updated_at: auto timestamp
- stocks: JSON list of stock codes
- metadata: JSON {plates, top_n, created_by_run_id, ...}
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

def init_saved_runs_table(db_path: Path = DEFAULT_DB_PATH) -> None:
    """Create saved_algorithm_runs table if not exists."""
    with get_connection(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS saved_algorithm_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                algorithm_id TEXT NOT NULL,
                algorithm_name TEXT NOT NULL,
                name TEXT NOT NULL,
                note TEXT,
                saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                stocks JSON NOT NULL,
                saved_stocks JSON NOT NULL DEFAULT '[]',
                metadata JSON NOT NULL,
                -- 大少 #8960 (2026-07-29): LibraryPage reorder + 置頂 嘅 columns
                position INTEGER NOT NULL DEFAULT 0,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                UNIQUE(algorithm_id, name)
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_saved_runs_algorithm ON saved_algorithm_runs(algorithm_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_saved_runs_saved_at ON saved_algorithm_runs(saved_at DESC)"
        )
        # Migration: add saved_stocks column to existing tables (大少 2026-07-26 #7566)
        cursor = conn.execute("PRAGMA table_info(saved_algorithm_runs)").fetchall()
        existing_cols = {row[1] for row in cursor}
        if "saved_stocks" not in existing_cols:
            conn.execute(
                "ALTER TABLE saved_algorithm_runs ADD COLUMN saved_stocks JSON NOT NULL DEFAULT '[]'"
            )
        # 大少 #8960 (2026-07-29): reorder + 置頂 嘅 migration
        if "position" not in existing_cols:
            conn.execute(
                "ALTER TABLE saved_algorithm_runs ADD COLUMN position INTEGER NOT NULL DEFAULT 0"
            )
        if "is_pinned" not in existing_cols:
            conn.execute(
                "ALTER TABLE saved_algorithm_runs ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0"
            )
        # Init position from id ordering (only if any rows missing position)
        conn.execute(
            "UPDATE saved_algorithm_runs SET position = id WHERE position = 0 AND id > 0"
        )
        conn.commit()


# ============================================================================
# Helpers
# ============================================================================

def generate_auto_name(algorithm_name: str) -> str:
    """
    自動生成名稱: `{algorithm_name} {YYYY-MM-DD} {HHMM}`
    大少 2026-07-24 #7049 Q2: HHMM 一日最多 1440 個組合。
    """
    now = datetime.now()
    return f"{algorithm_name} {now.strftime('%Y-%m-%d %H%M')}"


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    """Convert sqlite3.Row to dict, parse JSON columns."""
    d = dict(row)
    d["stocks"] = json.loads(d["stocks"])
    # 大少 2026-07-26 #7566: saved_stocks 係 full snapshot (Leader fields per stock)
    d["saved_stocks"] = json.loads(d.get("saved_stocks", "[]"))
    d["metadata"] = json.loads(d["metadata"])
    # 大少 #8960 (2026-07-29): reorder + 置頂 嘅 fields (Pydantic-friendly defaults)
    d["position"] = int(d.get("position", 0) or 0)
    d["is_pinned"] = bool(int(d.get("is_pinned", 0) or 0))
    return d


def _resolve_name_conflict(
    conn: sqlite3.Connection,
    algorithm_id: str,
    name: str,
) -> str:
    """
    如果 (algorithm_id, name) 已存在，append 序號 (`-2`, `-3`, ...)。
    大少 2026-07-24 #7050: 撞名罕見但要 handle。
    """
    existing = conn.execute(
        "SELECT COUNT(*) FROM saved_algorithm_runs WHERE algorithm_id = ? AND name LIKE ?",
        (algorithm_id, f"{name}%"),
    ).fetchone()[0]
    if existing == 0:
        return name
    return f"{name}-{existing + 1}"


# ============================================================================
# CRUD (modular — one function per responsibility)
# ============================================================================

def save_run(
    algorithm_id: str,
    algorithm_name: str,
    stocks: list[str],
    metadata: dict[str, Any],
    saved_stocks: list[dict[str, Any]] | None = None,
    name: Optional[str] = None,
    note: Optional[str] = None,
    db_path: Path = DEFAULT_DB_PATH,
) -> dict[str, Any]:
    """
    [POST] 儲存新 result。
    - name 唔提供 → auto-name `{algorithm_name} {YYYY-MM-DD} {HHMM}`
    - 撞名 → auto-append `-2`, `-3`
    - 大少 2026-07-26 #7566: 接受 saved_stocks (full Leader data per stock)。
      如果提供 saved_stocks, 自動 derive stocks (codes) 以保持 backward field 同步。
    - 回傳完整 record (含 id, saved_at, saved_stocks)
    """
    if not name:
        name = generate_auto_name(algorithm_name)

    # 大少 #7566: derived stocks from saved_stocks if provided (single source of truth)
    if saved_stocks is not None:
        stocks = [s.get("code", "") for s in saved_stocks]
    else:
        saved_stocks = []

    with get_connection(db_path) as conn:
        conn.row_factory = sqlite3.Row  # 大少 2026-07-24 18:43 fix: TypeError 'object is not iterable'
        final_name = _resolve_name_conflict(conn, algorithm_id, name)
        cursor = conn.execute(
            """
            INSERT INTO saved_algorithm_runs
                (algorithm_id, algorithm_name, name, note, stocks, saved_stocks, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                algorithm_id,
                algorithm_name,
                final_name,
                note,
                json.dumps(stocks, ensure_ascii=False),
                json.dumps(saved_stocks, ensure_ascii=False),
                json.dumps(metadata, ensure_ascii=False),
            ),
        )
        conn.commit()
        new_id = cursor.lastrowid
        row = conn.execute(
            "SELECT * FROM saved_algorithm_runs WHERE id = ?", (new_id,)
        ).fetchone()
    return _row_to_dict(row)


def list_runs(
    algorithm_id: Optional[str] = None,
    db_path: Path = DEFAULT_DB_PATH,
) -> list[dict[str, Any]]:
    """
    [GET] 列出所有 saved runs (新至舊 sort — 大少 #7050)。
    - Optional filter by algorithm_id
    - 大少 #8960 (2026-07-29): 改 ORDER BY — pinned 先, position 後, saved_at 兜底
    """
    with get_connection(db_path) as conn:
        conn.row_factory = sqlite3.Row
        if algorithm_id:
            rows = conn.execute(
                "SELECT * FROM saved_algorithm_runs WHERE algorithm_id = ? "
                "ORDER BY is_pinned DESC, position ASC, saved_at DESC",
                (algorithm_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM saved_algorithm_runs "
                "ORDER BY is_pinned DESC, position ASC, saved_at DESC"
            ).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_run(
    run_id: int,
    db_path: Path = DEFAULT_DB_PATH,
) -> Optional[dict[str, Any]]:
    """[GET] 攞 1 個 saved run by id."""
    with get_connection(db_path) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM saved_algorithm_runs WHERE id = ?", (run_id,)
        ).fetchone()
    return _row_to_dict(row) if row else None


def update_run(
    run_id: int,
    name: Optional[str] = None,
    note: Optional[str] = None,
    saved_stocks: Optional[list[dict[str, Any]]] = None,
    db_path: Path = DEFAULT_DB_PATH,
) -> Optional[dict[str, Any]]:
    """
    [PUT] Update name/note/saved_stocks (大少 #7051 + #8762)。
    - name/note/saved_stocks 都 optional — 只 update 提供嘅 field
    - algorithm_id 鎖死, 唔可以改
    - saved_stocks 提供時自動 derive `stocks` (codes) 以保持兩欄同步
      (同 save_run() 一樣邏輯, single source of truth = saved_stocks)
    - 撞名 → raise ValueError
    """
    if name is None and note is None and saved_stocks is None:
        raise ValueError("At least one of name/note/saved_stocks must be provided")

    # 大少 #8762: 如果提供 saved_stocks, 自動 derive codes list
    derived_stocks: Optional[list[str]] = None
    if saved_stocks is not None:
        derived_stocks = [s.get("code", "") for s in saved_stocks]

    with get_connection(db_path) as conn:
        # Get current record
        conn.row_factory = sqlite3.Row
        current = conn.execute(
            "SELECT * FROM saved_algorithm_runs WHERE id = ?", (run_id,)
        ).fetchone()
        if not current:
            return None

        # Check name conflict (if changing name)
        if name and name != current["name"]:
            conflict = conn.execute(
                "SELECT 1 FROM saved_algorithm_runs WHERE algorithm_id = ? AND name = ? AND id != ?",
                (current["algorithm_id"], name, run_id),
            ).fetchone()
            if conflict:
                raise ValueError(f"Name '{name}' already exists for algorithm '{current['algorithm_id']}'")

        # Build UPDATE
        updates: list[str] = []
        params: list[Any] = []
        if name is not None:
            updates.append("name = ?")
            params.append(name)
        if note is not None:
            updates.append("note = ?")
            params.append(note)
        # 大少 #8762: saved_stocks 提供時一齊 update stocks (codes list)
        if saved_stocks is not None:
            updates.append("saved_stocks = ?")
            params.append(json.dumps(saved_stocks, ensure_ascii=False))
            updates.append("stocks = ?")
            params.append(json.dumps(derived_stocks, ensure_ascii=False))
        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.append(run_id)

        conn.execute(
            f"UPDATE saved_algorithm_runs SET {', '.join(updates)} WHERE id = ?",
            params,
        )
        conn.commit()

        row = conn.execute(
            "SELECT * FROM saved_algorithm_runs WHERE id = ?", (run_id,)
        ).fetchone()
    return _row_to_dict(row) if row else None


# ============================================================================
# 大少 #8960 (2026-07-29): 排位 + 置頂 嘅新 functions
# ============================================================================

def reorder_runs(
    ordered_ids: list[int],
    db_path: Path = DEFAULT_DB_PATH,
) -> list[dict[str, Any]]:
    """
    [POST /reorder] 將 runs 按 ordered_ids 順序重設 position (= ordered_ids index)。
    - 只 update 包含 ordered_ids 入面嘅 rows，其他 runs position 唔郁
    - atomic txn: BEGIN 然後逐條 UPDATE，COMMIT
    """
    if not ordered_ids:
        return list_runs(db_path=db_path)
    with get_connection(db_path) as conn:
        conn.row_factory = sqlite3.Row
        for idx, rid in enumerate(ordered_ids):
            conn.execute(
                "UPDATE saved_algorithm_runs SET position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (idx, rid),
            )
        conn.commit()
    return list_runs(db_path=db_path)


def pin_run(
    run_id: int,
    pinned: bool,
    db_path: Path = DEFAULT_DB_PATH,
) -> Optional[dict[str, Any]]:
    """
    [POST /{id}/pin] 設置 is_pinned (boolean toggle).
    - pinned=True → 置頂 (排前)
    - pinned=False → 取消置頂
    """
    with get_connection(db_path) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute(
            "UPDATE saved_algorithm_runs SET is_pinned = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (1 if pinned else 0, run_id),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM saved_algorithm_runs WHERE id = ?", (run_id,)
        ).fetchone()
    return _row_to_dict(row) if row else None


def delete_run(
    run_id: int,
    db_path: Path = DEFAULT_DB_PATH,
) -> bool:
    """[DELETE] 刪 1 個 saved run. Return True if deleted."""
    with get_connection(db_path) as conn:
        cursor = conn.execute(
            "DELETE FROM saved_algorithm_runs WHERE id = ?", (run_id,)
        )
        conn.commit()
        return cursor.rowcount > 0
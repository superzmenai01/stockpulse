"""
models/stock_reasons.py — Per-Stock Reason Reports (大少 2026-08-03 #9920)

Generic per-stock reason storage with sanitized HTML content.
獨立 table — 唔再嵌入 saved_stocks JSON。

Design decisions (大少 confirmed):
- Q1: Smart Dedupe — UNIQUE(code, source_type, source_ref) ON CONFLICT DO UPDATE
       同一 (code, source_type, source_ref) → overwrite with latest (RECOVER semantics)
- Q2: 舊 saved_stocks[i].reason string → wipe (testing data only)
- Q3: Table name = stock_reasons (跟 stocks prefix)
- Generic source_type: 'algorithm' / 'manual' / 'news' / 'research'
- SOFT DELETE via is_active flag (preserve audit trail, 同 StockPulse 其他 delete 一致)
- HTML sanitization + size limit (50KB) done at write time (caller responsibility)

DB schema:
- id: auto-increment primary key
- code: TEXT NOT NULL (FK to stocks.code, logical — no hard FK for flexibility)
- source_type: TEXT NOT NULL (whitelist)
- source_run_id: INTEGER NULL (FK → saved_algorithm_runs.id, logical only)
- source_ref: TEXT NOT NULL (algorithm_id like 'AS-02', or manual ref string)
- title: TEXT NOT NULL (display title e.g. '板塊龍頭股篩選')
- html: TEXT NOT NULL (sanitized HTML, ≤ 50KB)
- created_at: TIMESTAMP DEFAULT CURRENT_TIMESTAMP
- updated_at: TIMESTAMP DEFAULT CURRENT_TIMESTAMP
- is_active: INTEGER NOT NULL DEFAULT 1 (soft delete flag)

UNIQUE(code, source_type, source_ref) — smart dedupe latest wins

Query pattern (ViewRunModal):
    SELECT * FROM stock_reasons
    WHERE code = ? AND is_active = 1
    ORDER BY created_at DESC;
"""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Optional


DEFAULT_DB_PATH = Path.home() / "stockpulse" / "backend" / "data" / "stocks.db"

# HTML size limit per entry (50KB) — applied after sanitization
MAX_HTML_BYTES = 50_000

# Source type whitelist — 將來 manual / news / research 都用同一 table
VALID_SOURCE_TYPES = {"algorithm", "manual", "news", "research"}


def get_connection(db_path: Path = DEFAULT_DB_PATH) -> sqlite3.Connection:
    return sqlite3.connect(str(db_path))


# ============================================================================
# DDL
# ============================================================================

def init_stock_reasons_table(db_path: Path = DEFAULT_DB_PATH) -> None:
    """Create stock_reasons table + indexes if not exist. Safe to call multiple times."""
    if db_path is None:
        db_path = DEFAULT_DB_PATH
    with get_connection(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS stock_reasons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT NOT NULL,
                source_type TEXT NOT NULL,
                source_run_id INTEGER,
                source_ref TEXT NOT NULL,
                title TEXT NOT NULL,
                html TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active INTEGER NOT NULL DEFAULT 1,
                UNIQUE(code, source_type, source_ref)
            )
            """
        )
        # Primary query path: WHERE code=? AND is_active=1 ORDER BY created_at DESC
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_stock_reasons_code "
            "ON stock_reasons(code, is_active, created_at DESC)"
        )
        # Secondary: trace reasons back to source run
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_stock_reasons_run "
            "ON stock_reasons(source_run_id) WHERE source_run_id IS NOT NULL"
        )
        conn.commit()


# ============================================================================
# Helpers
# ============================================================================

def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    """Convert sqlite3.Row to dict; coerce booleans."""
    d = dict(row)
    d["is_active"] = bool(int(d.get("is_active", 1) or 0))
    return d


def _validate_inputs(
    code: str,
    source_type: str,
    source_ref: str,
    title: str,
    html: str,
) -> None:
    """
    Defensive input validation. Raise ValueError on invalid.
    唔做 sanitization (caller responsibility: html_sanitizer.py)
    """
    if not code or not isinstance(code, str):
        raise ValueError("code 唔可以空, 必須係 string")
    if source_type not in VALID_SOURCE_TYPES:
        raise ValueError(
            f"source_type '{source_type}' 唔合法. 必須係其中之一: {sorted(VALID_SOURCE_TYPES)}"
        )
    if not source_ref or not isinstance(source_ref, str):
        raise ValueError("source_ref 唔可以空, 必須係 string")
    if not title or not isinstance(title, str):
        raise ValueError("title 唔可以空, 必須係 string")
    if not html or not isinstance(html, str):
        raise ValueError("html 唔可以空, 必須係 string")
    byte_size = len(html.encode("utf-8"))
    if byte_size > MAX_HTML_BYTES:
        raise ValueError(
            f"html 超過 {MAX_HTML_BYTES} bytes limit (實際: {byte_size} bytes)"
        )


# ============================================================================
# CRUD — Single reason
# ============================================================================

def create_reason(
    code: str,
    source_type: str,
    source_ref: str,
    title: str,
    html: str,
    source_run_id: Optional[int] = None,
    db_path: Optional[Path] = None,
) -> dict[str, Any]:
    """
    [INSERT/UPSERT] Create or replace a reason entry.

    Smart Dedupe (Q1): If (code, source_type, source_ref) 已存在,
    OVERWRITE 嗰條 row (title, html, source_run_id, updated_at, is_active=1).
    created_at 保留舊值 (audit trail of first creation).

    IMPORTANT: html 必須已經 sanitize 過 (caller responsibility — see html_sanitizer.py).
    Server-side validation enforces: size limit + non-empty + source_type whitelist.

    Returns the upserted reason dict.
    """
    if db_path is None:
        db_path = DEFAULT_DB_PATH
    _validate_inputs(code, source_type, source_ref, title, html)

    with get_connection(db_path) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute(
            """
            INSERT INTO stock_reasons
                (code, source_type, source_ref, title, html, source_run_id, is_active)
            VALUES (?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(code, source_type, source_ref) DO UPDATE SET
                title = excluded.title,
                html = excluded.html,
                source_run_id = excluded.source_run_id,
                updated_at = CURRENT_TIMESTAMP,
                is_active = 1
            """,
            (code, source_type, source_ref, title, html, source_run_id),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM stock_reasons "
            "WHERE code = ? AND source_type = ? AND source_ref = ?",
            (code, source_type, source_ref),
        ).fetchone()
    return _row_to_dict(row)


def get_reason(
    reason_id: int,
    db_path: Optional[Path] = None,
) -> Optional[dict[str, Any]]:
    """[GET] Single reason by id (active or inactive)."""
    if db_path is None:
        db_path = DEFAULT_DB_PATH
    with get_connection(db_path) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM stock_reasons WHERE id = ?", (reason_id,)
        ).fetchone()
    return _row_to_dict(row) if row else None


def list_reasons(
    code: str,
    include_inactive: bool = False,
    db_path: Optional[Path] = None,
) -> list[dict[str, Any]]:
    """[大少 #9920] Backward compat — list reasons for a single stock only."""
    return list_reasons_filtered(code=code, include_inactive=include_inactive, db_path=db_path)


def list_reasons_filtered(
    code: Optional[str] = None,
    source_run_id: Optional[int] = None,
    include_inactive: bool = False,
    db_path: Optional[Path] = None,
) -> list[dict[str, Any]]:
    """
    [大少 #10103 + #10105 fix] List reasons with per-run scoping + source_ref filter.

    Per-run scoping 邏輯 (refined after smoke test #10103):
    1. 如果 source_run_id provided:
       - 攞 saved_algorithm_runs #X 入面嘅 algorithm_id + saved_stocks codes
       - Filter reasons:
         * code IN (#X stocks) AND source_ref = (#X algorithm_id)
       - 即是 ViewRunModal #86 (AS-01) 只顯示 AS-01 reasons for #86 stocks
       - ViewRunModal #89 (AS-02) 只顯示 AS-02 reasons for #89 stocks
       - 避免顯示 cross-run stale AS-02 reasons for HK.00981 喺 #86 ViewRunModal

    2. 如果 only code provided (e.g. AS-01 結果頁面 inline render, 沒有 runId):
       - Fallback to code-only query (cross-run cross-algorithm accumulation)
       - Backward compat for ReasonCell v2 冇 runId 嘅 use case

    Returns: list of reason dicts, newest first
    """
    if db_path is None:
        db_path = DEFAULT_DB_PATH

    if not code and not source_run_id:
        return []  # caller should validate at least one

    with get_connection(db_path) as conn:
        conn.row_factory = sqlite3.Row

        if source_run_id is not None:
            # Get algorithm_id + codes from this run
            run_row = conn.execute(
                "SELECT algorithm_id, saved_stocks FROM saved_algorithm_runs WHERE id = ?",
                (source_run_id,),
            ).fetchone()
            if not run_row:
                return []

            run_algorithm_id = run_row["algorithm_id"]
            try:
                import json as _json
                saved_stocks_list = _json.loads(run_row["saved_stocks"])
            except (ValueError, TypeError):
                return []

            codes_in_run = [
                s.get("code", "")
                for s in saved_stocks_list
                if isinstance(s, dict) and s.get("code")
            ]

            if not codes_in_run:
                return []

            # 大少 #10103 fix: source_ref filter 嗰個 run's algorithm
            where_parts: list[str] = ["source_ref = ?"]
            params: list[Any] = [run_algorithm_id]

            if code:
                # Caller 有指定單一 stock code → intersect
                where_parts.append("code = ?")
                params.append(code)
                if code not in codes_in_run:
                    return []  # code 唔喺 嗰個 run 入面
            else:
                # Filter by all codes in run
                placeholders = ",".join(["?"] * len(codes_in_run))
                where_parts.append(f"code IN ({placeholders})")
                params.extend(codes_in_run)

            if not include_inactive:
                where_parts.append("is_active = 1")

            rows = conn.execute(
                f"SELECT * FROM stock_reasons WHERE {' AND '.join(where_parts)} ORDER BY created_at DESC",
                params,
            ).fetchall()
        else:
            # Fallback: code-only (cross-run cross-algorithm accumulation)
            assert code is not None
            if include_inactive:
                rows = conn.execute(
                    "SELECT * FROM stock_reasons WHERE code = ? "
                    "ORDER BY created_at DESC",
                    (code,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM stock_reasons WHERE code = ? AND is_active = 1 "
                    "ORDER BY created_at DESC",
                    (code,),
                ).fetchall()

    return [_row_to_dict(r) for r in rows]


def list_reasons_legacy(
    code: str,
    include_inactive: bool = False,
    db_path: Optional[Path] = None,
) -> list[dict[str, Any]]:
    """
    [GET] List all reasons for a stock, newest first.

    Default: only active (is_active=1). Pass include_inactive=True for audit.
    將來 ViewRunModal 入面 query 一隻 stock 嘅 reasons 就係用呢個。
    """
    if db_path is None:
        db_path = DEFAULT_DB_PATH
    with get_connection(db_path) as conn:
        conn.row_factory = sqlite3.Row
        if include_inactive:
            rows = conn.execute(
                "SELECT * FROM stock_reasons WHERE code = ? "
                "ORDER BY created_at DESC",
                (code,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM stock_reasons WHERE code = ? AND is_active = 1 "
                "ORDER BY created_at DESC",
                (code,),
            ).fetchall()
    return [_row_to_dict(r) for r in rows]


def update_reason(
    reason_id: int,
    title: Optional[str] = None,
    html: Optional[str] = None,
    db_path: Optional[Path] = None,
) -> Optional[dict[str, Any]]:
    """
    [PUT] Update title/html of existing reason.

    只有 title + html user-editable. source_type / source_ref / code immutable
    (改呢啲會違反 UNIQUE constraint semantic)。

    Raises ValueError if html exceeds MAX_HTML_BYTES.
    Returns updated reason dict, or None if reason_id not found.
    """
    if db_path is None:
        db_path = DEFAULT_DB_PATH
    if title is None and html is None:
        raise ValueError("At least one of title/html must be provided")

    if html is not None and len(html.encode("utf-8")) > MAX_HTML_BYTES:
        raise ValueError(
            f"html 超過 {MAX_HTML_BYTES} bytes limit (實際: {len(html.encode('utf-8'))} bytes)"
        )
    if title is not None and (not title or not isinstance(title, str)):
        raise ValueError("title 唔可以空, 必須係 string")

    with get_connection(db_path) as conn:
        conn.row_factory = sqlite3.Row
        current = conn.execute(
            "SELECT id FROM stock_reasons WHERE id = ?", (reason_id,)
        ).fetchone()
        if not current:
            return None

        updates: list[str] = []
        params: list[Any] = []
        if title is not None:
            updates.append("title = ?")
            params.append(title)
        if html is not None:
            updates.append("html = ?")
            params.append(html)
        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.append(reason_id)

        conn.execute(
            f"UPDATE stock_reasons SET {', '.join(updates)} WHERE id = ?",
            params,
        )
        conn.commit()

        row = conn.execute(
            "SELECT * FROM stock_reasons WHERE id = ?", (reason_id,)
        ).fetchone()
    return _row_to_dict(row) if row else None


def soft_delete_reason(
    reason_id: int,
    db_path: Optional[Path] = None,
) -> bool:
    """
    [DELETE] Soft delete: set is_active = 0. Returns True if row was found+updated.

    Q3 design decision: preserve data (SOFT DELETE), 唔 hard delete.
    Row 留喺 DB for audit trail. list_reasons() defaults to is_active=1 only.
    """
    if db_path is None:
        db_path = DEFAULT_DB_PATH
    with get_connection(db_path) as conn:
        cursor = conn.execute(
            "UPDATE stock_reasons SET is_active = 0, updated_at = CURRENT_TIMESTAMP "
            "WHERE id = ? AND is_active = 1",
            (reason_id,),
        )
        conn.commit()
        return cursor.rowcount > 0


# ============================================================================
# Bulk operation — used by save_run() to insert multiple reasons at once
# ============================================================================

def upsert_reasons_batch(
    reasons: list[dict[str, Any]],
    db_path: Optional[Path] = None,
) -> list[dict[str, Any]]:
    """
    Batch upsert multiple reasons (single transaction).

    Each reason dict must have: code, source_type, source_ref, title, html
    Optional: source_run_id (default None)

    Returns list of upserted reason dicts.
    Caller responsibility: html 必須已經 sanitize 過。
    """
    if db_path is None:
        db_path = DEFAULT_DB_PATH
    if not reasons:
        return []

    # Validate all first (fail-fast — atomic)
    for r in reasons:
        _validate_inputs(
            code=r["code"],
            source_type=r["source_type"],
            source_ref=r["source_ref"],
            title=r["title"],
            html=r["html"],
        )

    with get_connection(db_path) as conn:
        conn.row_factory = sqlite3.Row
        for r in reasons:
            conn.execute(
                """
                INSERT INTO stock_reasons
                    (code, source_type, source_ref, title, html, source_run_id, is_active)
                VALUES (?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(code, source_type, source_ref) DO UPDATE SET
                    title = excluded.title,
                    html = excluded.html,
                    source_run_id = excluded.source_run_id,
                    updated_at = CURRENT_TIMESTAMP,
                    is_active = 1
                """,
                (
                    r["code"],
                    r["source_type"],
                    r["source_ref"],
                    r["title"],
                    r["html"],
                    r.get("source_run_id"),
                ),
            )
        conn.commit()

        # Fetch all upserted rows to return
        placeholders = ",".join(["(?, ?, ?)" for _ in reasons])
        params: list[Any] = []
        for r in reasons:
            params.extend([r["code"], r["source_type"], r["source_ref"]])
        rows = conn.execute(
            f"SELECT * FROM stock_reasons WHERE (code, source_type, source_ref) IN ({placeholders})",
            params,
        ).fetchall()
    return [_row_to_dict(r) for r in rows]
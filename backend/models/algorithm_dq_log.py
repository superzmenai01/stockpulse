"""
Algorithm DQ Log Model — 大少 2026-08-01 #9132

當 algorithm 跑嘅時候，合格 + 不合格嘅股票都 log 入呢個 table。
用途：
- 將來做 training data
- Audit trail（邊隻股票邊日 fail 過）
- Review 改進
- 重做 / re-run 嘅 reference

DB schema:
- id: INTEGER PRIMARY KEY AUTOINCREMENT
- run_id: INTEGER (link 去 saved_algorithm_runs; nullable 因為有時 run 完未 save)
- algorithm_id: TEXT (AS-02)
- stock_code: TEXT (HK.00981 等)
- stock_name: TEXT
- score: REAL (0-100)
- classification: TEXT ('qualified' / 'disqualified')
- reasons: JSON list of DQ reasons
- financial_data: JSON (基本財務 snapshot)
- analysis_text: TEXT (LLM narrative)
- data_sources: JSON list (sources used)
- created_at: TIMESTAMP
"""
import json
import sqlite3
from pathlib import Path
from typing import Any, Optional

DEFAULT_DB_PATH = Path.home() / "stockpulse" / "backend" / "data" / "stocks.db"


def get_connection(db_path: Path = DEFAULT_DB_PATH) -> sqlite3.Connection:
    return sqlite3.connect(str(db_path))


def init_algorithm_dq_log_table(db_path: Path = DEFAULT_DB_PATH) -> None:
    """Create algorithm_dq_log table if not exists."""
    with get_connection(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS algorithm_dq_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id INTEGER,
                algorithm_id TEXT NOT NULL,
                stock_code TEXT NOT NULL,
                stock_name TEXT,
                score REAL,
                classification TEXT NOT NULL,
                reasons JSON,
                financial_data JSON,
                analysis_text TEXT,
                data_sources JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (run_id) REFERENCES saved_algorithm_runs(id) ON DELETE SET NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_dq_log_run ON algorithm_dq_log(run_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_dq_log_algorithm ON algorithm_dq_log(algorithm_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_dq_log_stock ON algorithm_dq_log(stock_code)"
        )
        conn.commit()


def log_dq(
    algorithm_id: str,
    stock_code: str,
    classification: str,
    stock_name: Optional[str] = None,
    score: Optional[float] = None,
    reasons: Optional[list[str]] = None,
    financial_data: Optional[dict[str, Any]] = None,
    analysis_text: Optional[str] = None,
    data_sources: Optional[list[str]] = None,
    run_id: Optional[int] = None,
    db_path: Path = DEFAULT_DB_PATH,
) -> int:
    """
    Log a single algorithm result (qualified or disqualified).
    Returns the new row id.
    """
    if classification not in ("qualified", "disqualified"):
        raise ValueError(
            f"classification must be 'qualified' or 'disqualified', got '{classification}'"
        )

    with get_connection(db_path) as conn:
        cursor = conn.execute(
            """
            INSERT INTO algorithm_dq_log
                (run_id, algorithm_id, stock_code, stock_name, score,
                 classification, reasons, financial_data, analysis_text, data_sources)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                algorithm_id,
                stock_code,
                stock_name,
                score,
                classification,
                json.dumps(reasons or [], ensure_ascii=False),
                json.dumps(financial_data or {}, ensure_ascii=False),
                analysis_text,
                json.dumps(data_sources or [], ensure_ascii=False),
            ),
        )
        conn.commit()
        return cursor.lastrowid


def log_dq_batch(
    entries: list[dict[str, Any]],
    db_path: Path = DEFAULT_DB_PATH,
) -> list[int]:
    """
    Batch insert DQ log entries. Each entry dict accepts all log_dq() kwargs.
    Returns list of new ids.
    """
    ids = []
    for entry in entries:
        new_id = log_dq(db_path=db_path, **entry)
        ids.append(new_id)
    return ids


def list_dq_logs(
    run_id: Optional[int] = None,
    algorithm_id: Optional[str] = None,
    classification: Optional[str] = None,
    db_path: Path = DEFAULT_DB_PATH,
) -> list[dict[str, Any]]:
    """List DQ log entries with optional filters."""
    with get_connection(db_path) as conn:
        conn.row_factory = sqlite3.Row
        query = "SELECT * FROM algorithm_dq_log WHERE 1=1"
        params: list[Any] = []
        if run_id is not None:
            query += " AND run_id = ?"
            params.append(run_id)
        if algorithm_id:
            query += " AND algorithm_id = ?"
            params.append(algorithm_id)
        if classification:
            query += " AND classification = ?"
            params.append(classification)
        query += " ORDER BY created_at DESC"
        rows = conn.execute(query, params).fetchall()
    return [_row_to_dict(r) for r in rows]


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    for col in ("reasons", "financial_data", "data_sources"):
        if col in d and d[col]:
            d[col] = json.loads(d[col])
    return d

"""
StockPulse 設置 Model
"""

import sqlite3
import os
import json
from typing import Optional

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'stocks.db')


def get_connection():
    return sqlite3.connect(DB_PATH)


def init_settings_table():
    """初始化設置表"""
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        conn.commit()


def get_settings(key: str) -> Optional[dict]:
    """獲取設置"""
    with get_connection() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.execute("SELECT value FROM settings WHERE key = ?", (key,))
        row = cursor.fetchone()
        if row:
            return json.loads(row['value'])
        return None


def save_settings(key: str, value: dict) -> None:
    """保存設置"""
    from datetime import datetime
    with get_connection() as conn:
        json_value = json.dumps(value)
        now = datetime.now().isoformat()
        conn.execute("""
            INSERT INTO settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """, (key, json_value, now))
        conn.commit()


def get_all_settings() -> dict:
    """獲取所有設置"""
    with get_connection() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.execute("SELECT key, value FROM settings")
        rows = cursor.fetchall()
        result = {}
        for row in rows:
            result[row['key']] = json.loads(row['value'])
        return result


# 確保表存在
init_settings_table()

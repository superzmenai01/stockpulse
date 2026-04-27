"""
StockPulse 組別-股票關聯 Model
"""

import sqlite3
import os
from typing import Optional
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'stocks.db')


def get_connection():
    return sqlite3.connect(DB_PATH)


def init_group_stocks_table():
    """初始化組別-股票關聯表"""
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS group_stocks (
                group_id TEXT NOT NULL,
                stock_code TEXT NOT NULL,
                added_at TEXT NOT NULL,
                PRIMARY KEY (group_id, stock_code),
                FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE
            )
        """)
        conn.commit()


def add_stock_to_group(group_id: str, stock_code: str) -> bool:
    """添加股票到組別"""
    now = datetime.now().isoformat()
    try:
        with get_connection() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO group_stocks (group_id, stock_code, added_at) VALUES (?, ?, ?)",
                (group_id, stock_code, now)
            )
            conn.commit()
        return True
    except Exception as e:
        print(f"Error adding stock to group: {e}")
        return False


def remove_stock_from_group(group_id: str, stock_code: str) -> bool:
    """從組別移除股票"""
    try:
        with get_connection() as conn:
            cursor = conn.execute(
                "DELETE FROM group_stocks WHERE group_id = ? AND stock_code = ?",
                (group_id, stock_code)
            )
            conn.commit()
        return cursor.rowcount > 0
    except Exception as e:
        print(f"Error removing stock from group: {e}")
        return False


def get_group_stocks(group_id: str) -> list[dict]:
    """獲取組別的所有股票"""
    with get_connection() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.execute("""
            SELECT gs.stock_code, gs.added_at, s.name, s.market, s.exchange_type
            FROM group_stocks gs
            JOIN stocks s ON gs.stock_code = s.code
            WHERE gs.group_id = ?
            ORDER BY gs.added_at DESC
        """, (group_id,))
        return [dict(row) for row in cursor.fetchall()]


def set_group_stocks(group_id: str, stock_codes: list[str]) -> bool:
    """設置組別的股票列表（替換）"""
    try:
        with get_connection() as conn:
            # 刪除現有關聯
            conn.execute("DELETE FROM group_stocks WHERE group_id = ?", (group_id,))
            
            # 添加新的關聯
            now = datetime.now().isoformat()
            for code in stock_codes:
                conn.execute(
                    "INSERT INTO group_stocks (group_id, stock_code, added_at) VALUES (?, ?, ?)",
                    (group_id, code, now)
                )
            conn.commit()
        return True
    except Exception as e:
        print(f"Error setting group stocks: {e}")
        return False


def is_stock_in_group(group_id: str, stock_code: str) -> bool:
    """檢查股票是否在組別中"""
    with get_connection() as conn:
        cursor = conn.execute(
            "SELECT 1 FROM group_stocks WHERE group_id = ? AND stock_code = ?",
            (group_id, stock_code)
        )
        return cursor.fetchone() is not None


# 確保表存在
init_group_stocks_table()

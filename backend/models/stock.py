"""
StockPulse 股票 Model
"""

import sqlite3
import os
from typing import Optional

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'stocks.db')


def get_connection():
    return sqlite3.connect(DB_PATH)


def init_stocks_table():
    """初始化股票表"""
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS stocks (
                code TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                lot_size INTEGER,
                stock_type TEXT,
                stock_child_type TEXT,
                listing_status TEXT,
                exchange_type TEXT,
                market TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_stocks_name ON stocks(name)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_stocks_code ON stocks(code)")
        conn.commit()


def search_stocks(keyword: str, market: str = None, limit: int = 20) -> list[dict]:
    """
    搜索股票
    
    Args:
        keyword: 搜索關鍵詞（代碼或名稱）
        market: 市場過濾 ('HK' 或 'US')，None 表示全部
        limit: 返回數量限制
        
    Returns:
        股票列表
    """
    # 移除 HK. 或 US. 前綴，方便用戶直接輸入數字或字母
    clean_keyword = keyword.replace('HK.', '').replace('US.', '')
    
    with get_connection() as conn:
        conn.row_factory = sqlite3.Row
        
        # 使用 %keyword% 匹配，這樣 HK.00700 可以被 00700 匹配到
        pattern = f'%{clean_keyword}%'
        
        if market:
            cursor = conn.execute("""
                SELECT code, name, lot_size, stock_type, exchange_type, market
                FROM stocks 
                WHERE market = ? AND (code LIKE ? OR name LIKE ?)
                ORDER BY 
                    CASE WHEN code LIKE ? THEN 0 ELSE 1 END,
                    name
                LIMIT ?
            """, (market, pattern, pattern, f'%{clean_keyword}%', limit))
        else:
            cursor = conn.execute("""
                SELECT code, name, lot_size, stock_type, exchange_type, market
                FROM stocks 
                WHERE code LIKE ? OR name LIKE ?
                ORDER BY 
                    CASE WHEN code LIKE ? THEN 0 ELSE 1 END,
                    name
                LIMIT ?
            """, (pattern, pattern, f'%{clean_keyword}%', limit))
        
        return [dict(row) for row in cursor.fetchall()]


def get_stock(code: str) -> Optional[dict]:
    """獲取單個股票"""
    with get_connection() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.execute("""
            SELECT code, name, lot_size, stock_type, stock_child_type, 
                   listing_status, exchange_type, market, updated_at
            FROM stocks 
            WHERE code = ?
        """, (code,))
        row = cursor.fetchone()
        return dict(row) if row else None


def get_stocks_by_market(market: str, limit: int = 100) -> list[dict]:
    """獲取指定市場的股票"""
    with get_connection() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.execute("""
            SELECT code, name, lot_size, stock_type, exchange_type, market
            FROM stocks 
            WHERE market = ?
            ORDER BY code
            LIMIT ?
        """, (market, limit))
        return [dict(row) for row in cursor.fetchall()]


# 確保表存在
init_stocks_table()

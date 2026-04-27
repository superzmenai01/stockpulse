#!/usr/bin/env python3
"""
下載並存儲股票數據到 SQLite
- 港股 (HK)
- 美股 (US)
"""

import sqlite3
import os
import signal
from datetime import datetime

# Futu API
from futu import OpenQuoteContext, Market, SecurityType

DB_PATH = os.path.join(os.path.dirname(__file__), 'backend', 'data', 'stocks.db')


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
        # 添加全文搜索支持
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_stocks_name ON stocks(name)
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_stocks_code ON stocks(code)
        """)
        conn.commit()


def download_stocks(market: str, futu_market: Market) -> int:
    """下載指定市場的股票"""
    print(f'=== 下載 {market} 股票 ===')
    
    ctx = OpenQuoteContext(host='127.0.0.1', port=11111)
    ret, data = ctx.get_stock_basicinfo(futu_market, SecurityType.STOCK)
    ctx.close()
    
    if ret != 0:
        print(f'  獲取失敗: {data}')
        return 0
    
    print(f'  獲取到 {len(data)} 隻股票')
    
    now = datetime.now().isoformat()
    stocks = []
    for _, row in data.iterrows():
        stocks.append((
            row['code'],
            row['name'],
            row.get('lot_size'),
            row.get('stock_type'),
            row.get('stock_child_type'),
            row.get('listing_status'),
            row.get('exchange_type'),
            market,
            now
        ))
    
    with get_connection() as conn:
        # 先刪除該市場的舊數據
        conn.execute("DELETE FROM stocks WHERE market = ?", (market,))
        
        # 批量插入
        conn.executemany("""
            INSERT OR REPLACE INTO stocks 
            (code, name, lot_size, stock_type, stock_child_type, listing_status, exchange_type, market, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, stocks)
        conn.commit()
    
    print(f'  已存入數據庫 {len(stocks)} 隻股票')
    return len(stocks)


def search_stocks(keyword: str, market: str = None, limit: int = 20) -> list:
    """搜索股票"""
    with get_connection() as conn:
        conn.row_factory = sqlite3.Row
        
        if market:
            cursor = conn.execute("""
                SELECT * FROM stocks 
                WHERE market = ? AND (code LIKE ? OR name LIKE ?)
                ORDER BY name
                LIMIT ?
            """, (market, f'%{keyword}%', f'%{keyword}%', limit))
        else:
            cursor = conn.execute("""
                SELECT * FROM stocks 
                WHERE code LIKE ? OR name LIKE ?
                ORDER BY name
                LIMIT ?
            """, (f'%{keyword}%', f'%{keyword}%', limit))
        
        return [dict(row) for row in cursor.fetchall()]


def get_stock_count() -> dict:
    """獲取股票數量"""
    with get_connection() as conn:
        cursor = conn.execute("""
            SELECT market, COUNT(*) as count FROM stocks GROUP BY market
        """)
        return {row['market']: row['count'] for row in cursor.fetchall()}


def main():
    print('StockPulse 股票下載工具')
    print('=' * 40)
    
    # 初始化表
    init_stocks_table()
    print()
    
    # 下載港股
    download_stocks('HK', Market.HK)
    print()
    
    # 下載美股
    download_stocks('US', Market.US)
    print()
    
    # 顯示統計
    print('=== 數據庫統計 ===')
    counts = get_stock_count()
    for market, count in counts.items():
        print(f'  {market}: {count} 隻')


if __name__ == '__main__':
    main()

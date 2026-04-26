# StockPulse 數據庫模組
# 負責數據庫連接和初始化

import sqlite3
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any
from contextlib import contextmanager

logger = logging.getLogger(__name__)

# 數據庫路徑
DB_PATH = Path(__file__).parent / "stockpulse.db"


def get_connection() -> sqlite3.Connection:
    """
    獲取數據庫連接
    
    Returns:
        sqlite3.Connection: 數據庫連接
    """
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row  # 讓你可以用 column name 訪問
    return conn


@contextmanager
def get_cursor():
    """
    獲取數據庫游標的上下文管理器
    
    Usage:
        with get_cursor() as cursor:
            cursor.execute("SELECT * FROM stocks")
            results = cursor.fetchall()
    """
    conn = get_connection()
    cursor = conn.cursor()
    try:
        yield cursor
        conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error(f"數據庫操作失敗: {e}")
        raise
    finally:
        conn.close()


def init_database():
    """
    初始化數據庫（創建所有表）
    
    表結構：
    - users: 用戶表
    - groups: 組別表
    - stocks: 股票基礎數據表
    - group_stocks: 組別-股票關聯表
    - strategies: 策略表
    - scheduled_tasks: 定時任務表
    - calendar_events: 日曆事件表
    - watchlist: 關注列表表
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    # === 用戶表 ===
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    logger.info("[DB] 用戶表創建完成")
    
    # === 組別表 ===
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS groups (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            color TEXT DEFAULT '#666666',
            sort_order INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    logger.info("[DB] 組別表創建完成")
    
    # === 股票基礎數據表 ===
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS stocks (
            code TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            market TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    logger.info("[DB] 股票表創建完成")
    
    # === 組別-股票關聯表 ===
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS group_stocks (
            id TEXT PRIMARY KEY,
            group_id TEXT NOT NULL,
            stock_code TEXT NOT NULL,
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
            FOREIGN KEY (stock_code) REFERENCES stocks(code),
            UNIQUE(group_id, stock_code)
        )
    """)
    logger.info("[DB] 組別-股票關聯表創建完成")
    
    # === 策略表 ===
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS strategies (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            prompt TEXT,
            code TEXT,
            description TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    logger.info("[DB] 策略表創建完成")
    
    # === 定時任務表 ===
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS scheduled_tasks (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            cron_expr TEXT NOT NULL,
            strategy_ids TEXT NOT NULL,
            combine_type TEXT DEFAULT 'AND',
            enabled INTEGER DEFAULT 1,
            last_run DATETIME,
            next_run DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    logger.info("[DB] 定時任務表創建完成")
    
    # === 日曆事件表 ===
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS calendar_events (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            date DATE NOT NULL,
            strategy_id TEXT NOT NULL,
            stock_code TEXT NOT NULL,
            match_details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (strategy_id) REFERENCES strategies(id),
            FOREIGN KEY (stock_code) REFERENCES stocks(code)
        )
    """)
    logger.info("[DB] 日曆事件表創建完成")
    
    # === 關注列表表 ===
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS watchlist (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            stock_code TEXT NOT NULL,
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (stock_code) REFERENCES stocks(code),
            UNIQUE(user_id, stock_code)
        )
    """)
    logger.info("[DB] 關注列表表創建完成")
    
    # === 創建索引 ===
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_groups_user ON groups(user_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_group_stocks_group ON group_stocks(group_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_calendar_events_user ON calendar_events(user_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id)")
    logger.info("[DB] 索引創建完成")
    
    conn.commit()
    conn.close()
    
    logger.info(f"數據庫初始化完成: {DB_PATH}")


def drop_all_tables():
    """刪除所有表（用於測試）"""
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute("DROP TABLE IF EXISTS watchlist")
    cursor.execute("DROP TABLE IF EXISTS calendar_events")
    cursor.execute("DROP TABLE IF EXISTS scheduled_tasks")
    cursor.execute("DROP TABLE IF EXISTS strategies")
    cursor.execute("DROP TABLE IF EXISTS group_stocks")
    cursor.execute("DROP TABLE IF EXISTS groups")
    cursor.execute("DROP TABLE IF EXISTS stocks")
    cursor.execute("DROP TABLE IF EXISTS users")
    
    conn.commit()
    conn.close()
    
    logger.info("[DB] 所有表已刪除")


def get_database_info() -> Dict[str, Any]:
    """
    獲取數據庫信息
    
    Returns:
        dict: 包含表名和記錄數
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    tables = ['users', 'groups', 'stocks', 'group_stocks', 
               'strategies', 'scheduled_tasks', 'calendar_events', 'watchlist']
    
    info = {}
    for table in tables:
        try:
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            count = cursor.fetchone()[0]
            info[table] = count
        except:
            info[table] = -1  # 表不存在
    
    conn.close()
    return info


if __name__ == "__main__":
    # 初始化數據庫
    print("初始化 StockPulse 數據庫...")
    init_database()
    
    # 顯示數據庫信息
    print("\n數據庫信息:")
    info = get_database_info()
    for table, count in info.items():
        print(f"  {table}: {count} 條記錄")
    
    print(f"\n數據庫路徑: {DB_PATH}")

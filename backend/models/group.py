"""
StockPulse 組別 Model
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Optional
import sqlite3
import os
import json

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'stocks.db')


@dataclass
class Group:
    id: str
    name: str
    color: str
    user_id: str = 'default'
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'color': self.color,
            'user_id': self.user_id,
            'created_at': self.created_at,
            'updated_at': self.updated_at,
        }


def get_connection():
    """獲取數據庫連接"""
    return sqlite3.connect(DB_PATH)


def init_group_table():
    """初始化組別表"""
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS `groups` (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT NOT NULL DEFAULT '#1890ff',
                user_id TEXT NOT NULL DEFAULT 'default',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        conn.commit()


def create_group(name: str, color: str = '#1890ff', user_id: str = 'default') -> Group:
    """創建組別"""
    import uuid
    now = datetime.now().isoformat()
    group = Group(
        id=str(uuid.uuid4())[:8],
        name=name,
        color=color,
        user_id=user_id,
        created_at=now,
        updated_at=now,
    )
    
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO `groups` (id, name, color, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (group.id, group.name, group.color, group.user_id, group.created_at, group.updated_at)
        )
        conn.commit()
    
    return group


def get_groups(user_id: str = 'default') -> list[Group]:
    """獲取所有組別"""
    with get_connection() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.execute(
            "SELECT * FROM `groups` WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,)
        )
        rows = cursor.fetchall()
        return [Group(**dict(row)) for row in rows]


def get_group(group_id: str, user_id: str = 'default') -> Optional[Group]:
    """獲取單個組別"""
    with get_connection() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.execute(
            "SELECT * FROM `groups` WHERE id = ? AND user_id = ?",
            (group_id, user_id)
        )
        row = cursor.fetchone()
        return Group(**dict(row)) if row else None


def update_group(group_id: str, name: str, color: str, user_id: str = 'default') -> Optional[Group]:
    """更新組別"""
    now = datetime.now().isoformat()
    with get_connection() as conn:
        cursor = conn.execute(
            "UPDATE `groups` SET name = ?, color = ?, updated_at = ? WHERE id = ? AND user_id = ?",
            (name, color, now, group_id, user_id)
        )
        conn.commit()
        if cursor.rowcount > 0:
            return get_group(group_id, user_id)
        return None


def delete_group(group_id: str, user_id: str = 'default') -> bool:
    """刪除組別"""
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM `groups` WHERE id = ? AND user_id = ?",
            (group_id, user_id)
        )
        conn.commit()
        return cursor.rowcount > 0


# 初始化表
init_group_table()

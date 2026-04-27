# StockPulse Session 管理
# 每個 WebSocket 連接 = 一個獨立 Session

import logging
from typing import Set, Dict
from dataclasses import dataclass, field
from datetime import datetime
import uuid

logger = logging.getLogger(__name__)


@dataclass
class Session:
    """
    單個客戶端 Session
    
    維護自己的訂閱狀態，完全隔離
    """
    id: str
    subscriptions: Set[str] = field(default_factory=set)
    created_at: datetime = field(default_factory=datetime.now)
    last_active: datetime = field(default_factory=datetime.now)
    
    def add_subscription(self, code: str):
        """添加訂閱"""
        self.subscriptions.add(code)
        self.last_active = datetime.now()
        logger.info(f"Session {self.id} ★ add_subscription({code}), current_subs={self.subscriptions}")
    
    def remove_subscription(self, code: str):
        """移除訂閱"""
        self.subscriptions.discard(code)
        self.last_active = datetime.now()
        logger.info(f"Session {self.id} 取消訂閱: {code}")
    
    def clear_subscriptions(self):
        """清除所有訂閱"""
        self.subscriptions.clear()
        self.last_active = datetime.now()
        logger.info(f"Session {self.id} 清除所有訂閱")
    
    def is_subscribed(self, code: str) -> bool:
        """檢查是否已訂閱"""
        result = code in self.subscriptions
        logger.info(f"Session {self.id} ★ is_subscribed({code})={result}, subscriptions={self.subscriptions}")
        return result


class SessionManager:
    """
    Session 管理器
    
    維護所有 WebSocket 連接的 Session 狀態
    """
    
    def __init__(self):
        self._sessions: Dict[str, Session] = {}
        logger.info("SessionManager 初始化完成")
    
    def create_session(self) -> Session:
        """創建新 Session"""
        session_id = str(uuid.uuid4())[:8]
        session = Session(id=session_id)
        self._sessions[session_id] = session
        logger.info(f"創建 Session: {session_id}")
        return session
    
    def get_session(self, session_id: str) -> Session:
        """獲取 Session"""
        return self._sessions.get(session_id)
    
    def remove_session(self, session_id: str):
        """移除 Session"""
        if session_id in self._sessions:
            del self._sessions[session_id]
            logger.info(f"移除 Session: {session_id}")
    
    def list_sessions(self) -> Dict[str, Session]:
        """列出所有 Session"""
        return self._sessions.copy()
    
    def broadcast_to_subscribed(self, code: str, data: dict):
        """
        廣播俾所有訂閱了呢個股票既 Session
        
        呢個方法俾 broadcaster 用
        """
        subscribed_sessions = [
            sid for sid, s in self._sessions.items()
            if s.is_subscribed(code)
        ]
        logger.info(f"SessionManager ★ broadcast_to_subscribed({code}) -> sessions={subscribed_sessions}, all_sessions={dict(self._sessions)}")
        return subscribed_sessions


# 全域實例
session_manager = SessionManager()

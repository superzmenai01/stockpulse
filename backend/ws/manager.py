# StockPulse WebSocket 連接管理

import logging
import json
from typing import List, Dict, Any
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)


class ConnectionManager:
    """
    WebSocket 連接管理器
    
    管理所有 WebSocket 連接，支援廣播
    """
    
    def __init__(self):
        # session_id -> WebSocket
        self._connections: Dict[str, WebSocket] = {}
        logger.info("ConnectionManager 初始化完成")
    
    async def connect(self, session_id: str, websocket: WebSocket):
        """接受並註冊連接"""
        await websocket.accept()
        self._connections[session_id] = websocket
        logger.info(f"WebSocket 連接: {session_id}")
    
    def disconnect(self, session_id: str):
        """斷開連接"""
        if session_id in self._connections:
            del self._connections[session_id]
            logger.info(f"WebSocket 斷開: {session_id}")
    
    async def send_to(self, session_id: str, message: dict):
        """發送消息俾指定 Session"""
        if session_id in self._connections:
            try:
                await self._connections[session_id].send_json(message)
            except Exception as e:
                logger.error(f"發送失敗 {session_id}: {e}")
                self.disconnect(session_id)
    
    async def broadcast_to_sessions(self, session_ids: List[str], message: dict):
        """廣播消息俾指定 Session 列表"""
        for session_id in session_ids:
            await self.send_to(session_id, message)
    
    async def broadcast_all(self, message: dict):
        """廣播俾所有連接"""
        for session_id in list(self._connections.keys()):
            await self.send_to(session_id, message)
    
    def get_connection_count(self) -> int:
        """獲取連接數"""
        return len(self._connections)


# 全域實例
connection_manager = ConnectionManager()

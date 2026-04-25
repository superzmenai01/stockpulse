# StockPulse WebSocket 路由

import logging
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict

from .manager import connection_manager
from .session import session_manager
from services.event_bus import event_bus

logger = logging.getLogger(__name__)

router = APIRouter()


@router.websocket("/quote")
async def websocket_quote(websocket: WebSocket):
    """
    實時報價 WebSocket 端點
    
    流程：
    1. 客戶端連接 → 創建 Session
    2. 客戶端發送 {"action": "subscribe", "codes": ["HK.00700"]}
    3. 後端處理訂閱，更新 Session 狀態
    4. 後端收到富途回調 → 事件總線 → broadcaster → 廣播俾相關 Session
    """
    # 創建新 Session
    session = session_manager.create_session()
    
    await connection_manager.connect(session.id, websocket)
    
    try:
        # 監聽客戶端消息
        while True:
            data = await websocket.receive_json()
            await handle_client_message(session.id, data)
            
    except WebSocketDisconnect:
        logger.info(f"客戶端斷開: {session.id}")
    except Exception as e:
        logger.error(f"WebSocket 錯誤 {session.id}: {e}")
    finally:
        # 清理
        session_manager.remove_session(session.id)
        connection_manager.disconnect(session.id)


async def handle_client_message(session_id: str, data: dict):
    """處理客戶端消息"""
    action = data.get("action")
    
    if action == "subscribe":
        codes = data.get("codes", [])
        for code in codes:
            session_manager.get_session(session_id).add_subscription(code)
        
        # 測試：log 出收到的訂閱請求
        logger.info(f"[TEST] Session {session_id} 訂閱: {codes}")
        
        # 發送確認
        await connection_manager.send_to(session_id, {
            "type": "subscribed",
            "codes": codes
        })
        
        # 發送測試數據（稍後會由 futu 模組替換）
        await connection_manager.send_to(session_id, {
            "type": "quote",
            "code": codes[0] if codes else "",
            "price": 0,
            "message": f"已收到訂閱請求: {codes}"
        })
        
    elif action == "unsubscribe":
        codes = data.get("codes", [])
        for code in codes:
            session_manager.get_session(session_id).remove_subscription(code)
        
        logger.info(f"[TEST] Session {session_id} 取消訂閱: {codes}")
        
        await connection_manager.send_to(session_id, {
            "type": "unsubscribed",
            "codes": codes
        })
        
    elif action == "unsubscribe_all":
        session_manager.get_session(session_id).clear_subscriptions()
        
        logger.info(f"[TEST] Session {session_id} 清除所有訂閱")
        
        await connection_manager.send_to(session_id, {
            "type": "cleared",
            "message": "已清除所有訂閱"
        })
        
    else:
        logger.warning(f"未知 action: {action}")


# 廣播器 - 訂閱事件總線的 quote 事件
def setup_broadcaster():
    """初始化廣播器，訂閱事件總線"""
    
    def handle_quote_event(event):
        """收到 quote 事件，廣播俾相關 Session"""
        code = event.data.get("code")
        if not code:
            return
        
        # 找出所有訂閱了呢個股票的 Session
        session_ids = session_manager.broadcast_to_subscribed(code, event.data)
        
        if session_ids:
            # 異步廣播
            import asyncio
            loop = asyncio.get_event_loop()
            loop.create_task(
                connection_manager.broadcast_to_sessions(session_ids, {
                    "type": "quote",
                    **event.data
                })
            )
    
    event_bus.on("quote", handle_quote_event)
    logger.info("Broadcaster 訂閱事件總線 'quote' 事件")


# 啟動時設置
setup_broadcaster()

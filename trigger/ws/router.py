# StockPulse WebSocket 路由
# 處理客戶端的訂閱/取消訂閱請求

import logging
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict, Optional

from .manager import connection_manager
from .session import session_manager
from services.event_bus import event_bus
from futu_conn import SubscriptionManager
from futu import OpenQuoteContext
from config import FUTU_HOST, FUTU_PORT

logger = logging.getLogger(__name__)

router = APIRouter()

# 全域富途 Context 和 SubscriptionManager
_futu_ctx: Optional[OpenQuoteContext] = None
_sub_manager: Optional[SubscriptionManager] = None


def get_subscription_manager() -> Optional[SubscriptionManager]:
    """獲取或初始化 SubscriptionManager"""
    global _futu_ctx, _sub_manager
    
    if _sub_manager is None:
        try:
            _futu_ctx = OpenQuoteContext(host=FUTU_HOST, port=FUTU_PORT)
            _sub_manager = SubscriptionManager(_futu_ctx, event_bus)
            logger.info(f"[WS] 富途連接成功: {FUTU_HOST}:{FUTU_PORT}")
        except Exception as e:
            logger.error(f"[WS] 富途連接失敗: {e}")
            return None
    
    return _sub_manager


def close_futu_connection():
    """關閉富途連接"""
    global _futu_ctx, _sub_manager
    if _futu_ctx:
        try:
            _futu_ctx.close()
            logger.info("[WS] 富途連接已關閉")
        except Exception as e:
            logger.error(f"[WS] 關閉富途連接失敗: {e}")
        _futu_ctx = None
        _sub_manager = None


@router.websocket("/quote")
async def websocket_quote(websocket: WebSocket):
    """
    實時報價 WebSocket 端點
    
    客戶端消息格式：
    - {"action": "init", "codes": ["HK.00700", "HK.00981"]}  # 登入後初始化訂閱
    - {"action": "subscribe", "codes": ["HK.00700"]}          # 追加訂閱
    - {"action": "unsubscribe", "codes": ["HK.00700"]}        # 取消訂閱（個別）
    - {"action": "unsubscribe_all"}                            # 取消所有訂閱
    """
    # 創建新 Session
    session = session_manager.create_session()
    
    await connection_manager.connect(session.id, websocket)
    logger.info(f"[WS] 客戶端連接: session={session.id}")
    
    try:
        while True:
            data = await websocket.receive_json()
            await handle_client_message(session.id, data)
            
    except WebSocketDisconnect:
        logger.info(f"[WS] 客戶端斷開: session={session.id}")
    except Exception as e:
        logger.error(f"[WS] WebSocket 錯誤 session={session.id}: {e}")
    finally:
        # 客戶端斷開時記錄
        logger.info(f"[WS] Session 清理: session={session.id}, 訂閱={list(session.subscriptions)}")
        session_manager.remove_session(session.id)
        connection_manager.disconnect(session.id)


async def handle_client_message(session_id: str, data: dict):
    """處理客戶端消息"""
    action = data.get("action")
    session = session_manager.get_session(session_id)
    
    if not session:
        logger.error(f"[WS] Session 不存在: {session_id}")
        return
    
    logger.info(f"[WS] 收到 action={action} from session={session_id}")
    
    if action == "init":
        await handle_init(session, data)
        
    elif action == "subscribe":
        await handle_subscribe(session, data)
        
    elif action == "unsubscribe":
        await handle_unsubscribe(session, data)
        
    elif action == "unsubscribe_all":
        await handle_unsubscribe_all(session)
        
    elif action == "ping":
        await connection_manager.send_to(session_id, {"type": "pong"})
        
    else:
        logger.warning(f"[WS] 未知 action: {action}")
        await connection_manager.send_to(session_id, {
            "type": "error",
            "message": f"未知 action: {action}"
        })


async def handle_init(session, data: dict):
    """
    處理初始化訂閱（登入後首次）
    
    流程：
    1. 查詢當前訂閱狀態
    2. 如有舊訂閱，先取消並等待確認
    3. 訂閱新的初始股票
    4. 記錄到 session
    """
    codes = data.get("codes", [])
    
    if not codes:
        logger.warning(f"[WS][INIT] 股票列表為空")
        await connection_manager.send_to(session.id, {
            "type": "init_result",
            "success": False,
            "message": "股票列表為空"
        })
        return
    
    logger.info(f"[WS][INIT] 初始股票: {codes}")
    
    sub_manager = get_subscription_manager()
    if not sub_manager:
        await connection_manager.send_to(session.id, {
            "type": "init_result",
            "success": False,
            "message": "富途連接失敗"
        })
        return
    
    # Step 1: 查詢並取消所有舊訂閱
    old_codes = sub_manager.get_subscribed_codes()
    if old_codes:
        logger.info(f"[WS][INIT] 發現舊訂閱: {old_codes}，先取消...")
        success = sub_manager.cancel_all_with_confirm(timeout=120)
        if not success:
            logger.warning(f"[WS][INIT] 取消舊訂閱未完全成功，繼續...")
    
    # Step 2: 訂閱新股票
    success = sub_manager.subscribe(codes)
    
    if success:
        # 更新 session 訂閱狀態
        for code in codes:
            session.add_subscription(code)
        
        logger.info(f"[WS][INIT] 初始化成功: {codes}")
        await connection_manager.send_to(session.id, {
            "type": "init_result",
            "success": True,
            "codes": codes,
            "message": "初始化成功"
        })
    else:
        logger.error(f"[WS][INIT] 初始化失敗")
        await connection_manager.send_to(session.id, {
            "type": "init_result",
            "success": False,
            "message": "訂閱失敗"
        })


async def handle_subscribe(session, data: dict):
    """處理追加訂閱"""
    codes = data.get("codes", [])
    
    if not codes:
        return
    
    logger.info(f"[WS][SUB] 追加訂閱: {codes}")
    
    sub_manager = get_subscription_manager()
    if not sub_manager:
        await connection_manager.send_to(session.id, {
            "type": "subscribe_result",
            "success": False,
            "message": "富途連接失敗"
        })
        return
    
    success = sub_manager.subscribe(codes)
    
    if success:
        for code in codes:
            session.add_subscription(code)
        
        await connection_manager.send_to(session.id, {
            "type": "subscribed",
            "codes": codes
        })
    else:
        await connection_manager.send_to(session.id, {
            "type": "subscribe_result",
            "success": False,
            "codes": codes,
            "message": "訂閱失敗"
        })


async def handle_unsubscribe(session, data: dict):
    """處理取消個別訂閱"""
    codes = data.get("codes", [])
    
    if not codes:
        return
    
    logger.info(f"[WS][UNSUB] 取消訂閱: {codes}")
    
    sub_manager = get_subscription_manager()
    if not sub_manager:
        return
    
    # 從 session 移除
    for code in codes:
        session.remove_subscription(code)
    
    # 注意：富途 unsubscribe 也有冷卻問題，這裡先不做詳細實現
    # 實際應該像 unsubscribe_all 一樣處理
    await connection_manager.send_to(session.id, {
        "type": "unsubscribed",
        "codes": codes
    })


async def handle_unsubscribe_all(session):
    """
    處理取消所有訂閱
    
    四種觸發情況都係調呢個 function：
    1. 用戶點擊「取消訂閱」按鈕
    2. 頁面刷新（前端會在 beforeunload 發請求）
    3. 關閉頁面
    4. 登出
    """
    logger.info(f"[WS][UNSUB_ALL] 取消所有訂閱, session={session.id}")
    
    sub_manager = get_subscription_manager()
    if not sub_manager:
        return
    
    # 記錄當前 session 訂閱了邊啲
    codes_to_cancel = list(session.subscriptions)
    logger.info(f"[WS][UNSUB_ALL] Session {session.id} 訂閱了: {codes_to_cancel}")
    
    # 執行取消
    success = sub_manager.cancel_all_with_confirm(timeout=120)
    
    # 清除 session 狀態
    session.clear_subscriptions()
    
    await connection_manager.send_to(session.id, {
        "type": "all_unsubscribed",
        "success": success,
        "codes": codes_to_cancel
    })
    
    logger.info(f"[WS][UNSUB_ALL] 完成, success={success}")


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
            import asyncio
            loop = asyncio.get_event_loop()
            loop.create_task(
                connection_manager.broadcast_to_sessions(session_ids, {
                    "type": "quote",
                    **event.data
                })
            )
    
    event_bus.on("quote", handle_quote_event)
    logger.info("[Broadcaster] 訂閱事件總線 'quote' 事件")


# 啟動時設置
setup_broadcaster()

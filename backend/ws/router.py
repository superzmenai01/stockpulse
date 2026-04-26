# StockPulse WebSocket 路由
# 處理客戶端的訂閱/取消訂閱請求

import logging
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict, Optional

from .manager import connection_manager
from .session import session_manager
from .broadcaster import create_broadcaster
from services.event_bus import event_bus
from futu_conn import SubscriptionManager, create_quote_handler
from futu import OpenQuoteContext
from config import FUTU_HOST, FUTU_PORT

logger = logging.getLogger(__name__)

router = APIRouter()

# 全域變量
_futu_ctx: Optional[OpenQuoteContext] = None
_sub_manager: Optional[SubscriptionManager] = None
_broadcaster = None


def get_subscription_manager() -> Optional[SubscriptionManager]:
    """
    獲取或初始化 SubscriptionManager
    
    Returns:
        SubscriptionManager: 配置好的訂閱管理器
    """
    global _futu_ctx, _sub_manager
    
    if _sub_manager is None:
        try:
            # 創建富途連接
            _futu_ctx = OpenQuoteContext(host=FUTU_HOST, port=FUTU_PORT)
            logger.info(f"[WS] 富途連接成功: {FUTU_HOST}:{FUTU_PORT}")
            
            # 創建 QuoteHandler 並設置到 context
            handler = create_quote_handler(event_bus)
            _futu_ctx.set_handler(handler)
            logger.info("[WS] QuoteHandler 已設置")
            
            # 創建 SubscriptionManager
            _sub_manager = SubscriptionManager(_futu_ctx, event_bus)
            logger.info("[WS] SubscriptionManager 初始化完成")
            
        except Exception as e:
            logger.error(f"[WS] 富途連接失敗: {e}")
            return None
    
    return _sub_manager


def get_broadcaster():
    """
    獲取或初始化 QuoteBroadcaster
    
    Returns:
        QuoteBroadcaster: 配置好的廣播器
    """
    global _broadcaster
    
    if _broadcaster is None:
        _broadcaster = create_broadcaster(event_bus, session_manager, connection_manager)
        _broadcaster.start()
        logger.info("[WS] QuoteBroadcaster 已啟動")
    
    return _broadcaster


def close_futu_connection():
    """關閉富途連接"""
    global _futu_ctx, _sub_manager, _broadcaster
    
    # 停止廣播器
    if _broadcaster is not None:
        _broadcaster.stop()
        _broadcaster = None
        logger.info("[WS] QuoteBroadcaster 已停止")
    
    # 關閉富途連接
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
    # 確保廣播器已啟動
    get_broadcaster()
    
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
    1. 直接取消所有訂閱（cancel_all + 等待確認）
       - 如果取消失敗，返回失敗信息，結束
    2. 停 1 秒（等取消完成）
    3. 直接訂閱所需的股票
    4. 檢查訂閱狀態
    5. 如果訂閱失敗，返回失敗信息
    6. 如果訂閱成功，返回成功信息和股票，記錄到 session
    """
    import asyncio
    
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
    
    # Step 1: 直接取消所有訂閱（等待確認）
    logger.info(f"[WS][INIT] 取消所有訂閱...")
    success, err_msg = sub_manager.cancel_all_with_confirm(timeout=120)
    
    # 如果取消失敗，立即返回失敗
    if not success:
        logger.warning(f"[WS][INIT] 取消失敗: {err_msg}")
        await connection_manager.send_to(session.id, {
            "type": "init_result",
            "success": False,
            "message": "取消訂閱失敗，需要等待一分鐘"
        })
        return
    
    # Step 2: 停 1 秒（等取消完成）
    await asyncio.sleep(1)
    
    # Step 3: 直接訂閱
    logger.info(f"[WS][INIT] 開始訂閱: {codes}")
    success = sub_manager.subscribe(codes)
    
    # Step 4 & 5: 檢查結果
    if not success:
        logger.error(f"[WS][INIT] 訂閱失敗")
        await connection_manager.send_to(session.id, {
            "type": "init_result",
            "success": False,
            "message": "訂閱失敗"
        })
        return
    
    # Step 6: 訂閱成功
    for code in codes:
        session.add_subscription(code)
    
    logger.info(f"[WS][INIT] 初始化成功: {codes}")
    await connection_manager.send_to(session.id, {
        "type": "init_result",
        "success": True,
        "codes": codes,
        "message": "初始化成功"
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
    success, err_msg = sub_manager.cancel_all_with_confirm(timeout=120)
    
    # 清除 session 狀態（即使取消失敗也清除本地狀態）
    session.clear_subscriptions()
    
    if success:
        await connection_manager.send_to(session.id, {
            "type": "all_unsubscribed",
            "success": True,
            "codes": codes_to_cancel
        })
    else:
        # 取消失敗，可能係未滿1分鐘
        logger.warning(f"[WS][UNSUB_ALL] 取消失敗: {err_msg}")
        
        # 嘗試解析剩餘冷卻時間
        cooldown = 60  # 預設60秒
        if "1分鐘" in err_msg or "1 minute" in err_msg.lower():
            cooldown = 60
        
        await connection_manager.send_to(session.id, {
            "type": "unsubscribe_failed",
            "message": err_msg,
            "cooldown": cooldown,
            "codes": codes_to_cancel
        })
    
    logger.info(f"[WS][UNSUB_ALL] 完成, success={success}, err={err_msg}")

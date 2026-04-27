# Quote Broadcaster
# 負責將報價事件廣播給 WebSocket 客戶端

import logging
import asyncio
import threading
from typing import List
from queue import Queue

logger = logging.getLogger(__name__)


class QuoteBroadcaster:
    """
    報價廣播器
    
    職責：
    - 訂閱事件總線的 'quote' 事件
    - 將事件放入佇列
    - 在主線程中廣播給 WebSocket 客戶端
    
    特點：
    - 使用 Queue 線程安全地傳遞事件
    - 不直接在回調線程中操作 WebSocket
    - 可靈活開關
    """
    
    def __init__(self, event_bus, session_manager, connection_manager, main_loop=None):
        """
        初始化廣播器
        
        Args:
            event_bus: 事件總線實例
            session_manager: Session 管理器
            connection_manager: WebSocket 連接管理器
            main_loop: FastAPI 的主 event loop（用於線程安全地發送到 WebSocket）
        """
        self.event_bus = event_bus
        self.session_manager = session_manager
        self.connection_manager = connection_manager
        self._main_loop = main_loop
        self._handler = None
        self._queue = Queue()
        self._running = False
        self._thread = None
        logger.info("[BROADCASTER] 初始化完成")
    
    def start(self):
        """啟動廣播器，訂閱事件總線"""
        if self._handler is None:
            self._handler = self._create_handler()
            self.event_bus.on('quote', self._handler)
            self._running = True
            self._thread = threading.Thread(target=self._process_queue, daemon=True)
            self._thread.start()
            logger.info("[BROADCASTER] 已啟動")
    
    def stop(self):
        """停止廣播器"""
        self._running = False
        if self._handler is not None:
            self.event_bus.off('quote', self._handler)
            self._handler = None
        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None
        logger.info("[BROADCASTER] 已停止")
    
    def _create_handler(self):
        """
        創建事件處理函數
        
        Returns:
            function: 處理 quote 事件的函數
        """
        def handle_quote_event(event):
            """收到 quote 事件，放入佇列"""
            self._queue.put(event.data)
            logger.info(f"[BROADCASTER] ★ 收到 quote 事件 -> 放入佇列: code={event.data.get('code')}")
        
        return handle_quote_event
    
    def _process_queue(self):
        """
        處理佇列中的事件（在獨立線程中運行）
        
        從佇列取出事件，廣播給相關客戶端
        """
        logger.info("[BROADCASTER] 佇列處理線程已啟動")
        
        while self._running:
            try:
                # 阻塞等待佇列內容
                quote_data = self._queue.get(timeout=0.5)
                self._broadcast_quote(quote_data)
            except Exception:
                # 佇列為空或超時，繼續等待
                continue
    
    def _broadcast_quote(self, quote_data: dict):
        """
        廣播報價數據給訂閱了該股票的客戶端
        
        Args:
            quote_data: 報價數據
        """
        code = quote_data.get('code')
        if not code:
            return
        
        # 找出所有訂閱了該股票的 Session
        session_ids = self.session_manager.broadcast_to_subscribed(code, quote_data)
        
        if not session_ids:
            logger.info(f"[BROADCASTER] ★ 廣播失敗，沒有 Session 訂閱 {code}")
            return
        
        logger.info(f"[BROADCASTER] ★ 廣播俾 {len(session_ids)} 個 Session: {session_ids}")
        
        # 構建消息
        message = {
            "type": "quote",
            **quote_data
        }
        
        # 廣播給所有相關 Session
        # 使用主 loop 的 run_coroutine_threadsafe 避免 asyncio.run() 創建新 loop 的問題
        for session_id in session_ids:
            try:
                if self._main_loop is not None:
                    # run_coroutine_threadsafe 會自動處理線程安全，唔需要 get_event_loop()
                    future = asyncio.run_coroutine_threadsafe(
                        self._send_to_session(session_id, message),
                        self._main_loop
                    )
                    # 等待結果（可選，超時則放棄）
                    try:
                        future.result(timeout=1.0)
                    except Exception:
                        pass
                    logger.info(f"[BROADCASTER] ★ 已發送俾 {session_id}: code={code}")
                else:
                    logger.warning(f"[BROADCASTER] 主 loop 未設置，跳過發送俾 {session_id}")
            except Exception as e:
                logger.error(f"[BROADCASTER] 發送給 {session_id} 失敗: {e}")
    
    async def _send_to_session(self, session_id: str, message: dict):
        """
        異步發送消息給指定 Session
        
        Args:
            session_id: Session ID
            message: 消息內容
        """
        await self.connection_manager.send_to(session_id, message)


def create_broadcaster(event_bus, session_manager, connection_manager, main_loop=None) -> QuoteBroadcaster:
    """
    工廠函數：創建 QuoteBroadcaster
    
    Args:
        event_bus: 事件總線
        session_manager: Session 管理器
        connection_manager: WebSocket 連接管理器
        main_loop: FastAPI 的主 event loop
        
    Returns:
        QuoteBroadcaster: 配置好的廣播器
    """
    return QuoteBroadcaster(event_bus, session_manager, connection_manager, main_loop)

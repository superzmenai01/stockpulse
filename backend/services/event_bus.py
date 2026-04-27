# StockPulse 事件總線
# 所有模組通過它溝通，實現零耦合

import logging
from typing import Callable, Dict, List
from dataclasses import dataclass
from datetime import datetime

logger = logging.getLogger(__name__)


@dataclass
class Event:
    """事件對象"""
    type: str
    data: dict
    timestamp: datetime = None
    
    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = datetime.now()


class EventBus:
    """
    事件總線 - 模組間通訊的核心
    
    用法：
        # 發送事件
        event_bus.emit('quote', {'code': 'HK.00700', 'price': 400})
        
        # 訂閱事件
        def handle_quote(event):
            print(event.data)
        
        event_bus.on('quote', handle_quote)
    """
    
    def __init__(self):
        self._subscribers: Dict[str, List[Callable]] = {}
        logger.info("EventBus 初始化完成")
    
    def on(self, event_type: str, callback: Callable):
        """訂閱事件"""
        if event_type not in self._subscribers:
            self._subscribers[event_type] = []
        self._subscribers[event_type].append(callback)
        logger.debug(f"訂閱事件: {event_type} -> {callback.__name__}")
    
    def off(self, event_type: str, callback: Callable):
        """取消訂閱"""
        if event_type in self._subscribers:
            self._subscribers[event_type].remove(callback)
            logger.debug(f"取消訂閱: {event_type} -> {callback.__name__}")
    
    def emit(self, event_type: str, data: dict):
        """發送事件"""
        event = Event(type=event_type, data=data)
        logger.info(f"[EVENT_BUS] emit '{event_type}' -> data={data}")
        
        if event_type in self._subscribers:
            for callback in self._subscribers[event_type]:
                try:
                    callback(event)
                except Exception as e:
                    logger.error(f"事件處理錯誤 {event_type}: {e}")


# 全域實例
event_bus = EventBus()

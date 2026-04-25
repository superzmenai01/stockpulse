# Futu API 模組（預留）
# 目前係 STUB，稍後實現真實連接

import logging

logger = logging.getLogger(__name__)

# 標記為 STUB
IS_STUB = True

def get_handler():
    """獲取回調處理器（STUB）"""
    logger.warning("[FUTU STUB] 富途模組係 STUB，未連接真實行情")
    return None

def subscribe(codes: list):
    """訂閱股票（STUB）"""
    logger.info(f"[FUTU STUB] 收到訂閱請求: {codes}")
    return True

def unsubscribe(codes: list):
    """取消訂閱（STUB）"""
    logger.info(f"[FUTU STUB] 收到取消訂閱請求: {codes}")
    return True

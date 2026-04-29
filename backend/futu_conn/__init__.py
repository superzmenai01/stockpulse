# Futu Connection 模組
from .subscription import SubscriptionManager
from .handler import QuoteHandler, create_quote_handler

# 懶加載獲取 quote context（避免循環 import）
def get_quote_ctx():
    """獲取富途 Quote Context - 每次都動態查找避免模組導入時間問題"""
    import importlib
    mod = importlib.import_module('ws.router')
    return mod._futu_ctx

__all__ = ["SubscriptionManager", "QuoteHandler", "create_quote_handler", "get_quote_ctx"]

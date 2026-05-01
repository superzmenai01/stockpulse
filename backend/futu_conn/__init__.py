# Futu Connection 模組
# 提供富途行情連接的封裝
#
# 主要組件：
# - SubscriptionManager: 管理股票訂閱
# - QuoteHandler: 解析富途回調數據
# - get_quote_ctx(): 獲取已連接的富途 context

from .subscription import SubscriptionManager
from .handler import QuoteHandler, create_quote_handler

# 懶加載獲取 quote context（避免循環 import）
def get_quote_ctx():
    """
    獲取富途 Quote Context
    
    每次都動態查找 ws.router._futu_ctx，避免模組導入時間問題。
    注意：只有在 init_futu_connection() 成功後才能獲取到有效的 context。
    
    Returns:
        OpenQuoteContext or None: 富途連接 context
    """
    import importlib
    mod = importlib.import_module('ws.router')
    return mod._futu_ctx

__all__ = ["SubscriptionManager", "QuoteHandler", "create_quote_handler", "get_quote_ctx"]

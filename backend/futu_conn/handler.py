# Futu Quote Handler
# 處理富途回調，將報價數據發送到事件總線

import logging
import pandas as pd
from futu import StockQuoteHandlerBase, RET_OK

logger = logging.getLogger(__name__)


class QuoteHandler(StockQuoteHandlerBase):
    """
    富途報價回調處理器
    
    職責：
    - 接收富途的實時報價回調
    - 解析 DataFrame 為 dict
    - 發送到事件總線
    
    特點：
    - 只做數據解析和轉發，不做其他邏輯
    - 可以獨立測試
    - 可以靈活替換
    """
    
    def __init__(self, event_bus):
        """
        初始化 Handler
        
        Args:
            event_bus: 事件總線實例，用於發送報價事件
        """
        super().__init__()
        self.event_bus = event_bus
        logger.info("[QUOTE_HANDLER] 初始化完成")
    
    def on_recv_rsp(self, rsp):
        """
        富途回調函數（被子線程調用）
        
        收到實時報價時自動調用
        重要：運行在富途的子線程中
        """
        ret_code, content = super().on_recv_rsp(rsp)
        
        if ret_code != RET_OK:
            logger.warning(f"[QUOTE_HANDLER] 回調錯誤: {content}")
            return RET_OK, content
        
        # content 是 pandas DataFrame
        if isinstance(content, pd.DataFrame):
            # 遍歷每一行（每個股票）
            for _, row in content.iterrows():
                quote_data = self._parse_row(row)
                if quote_data:
                    # 發送到事件總線
                    self.event_bus.emit('quote', quote_data)
                    logger.info(f"[QUOTE_HANDLER] ★ 收到報價 -> 發送到事件總線: code={quote_data.get('code')}, price={quote_data.get('last_price')}")
        
        return RET_OK, content
    
    def _parse_row(self, row: pd.Series) -> dict:
        """
        解析一行報價數據
        
        將 pandas Series 轉換為 dict
        
        升跌計算邏輯：
        - 優先使用 API 的 change_val / change_rate（如有）
        - 否則用 last_price - prev_close_price 計算
        
        Args:
            row: pandas Series，代表一隻股票的報價
            
        Returns:
            dict: 股票報價數據
        """
        try:
            last_price = float(row.get('last_price', 0))
            prev_close = float(row.get('prev_close_price', 0))
            
            # 嘗試使用 API 提供的 change_val
            change_val = row.get('change_val')
            if change_val is not None and str(change_val) != 'N/A':
                change = float(change_val)
            else:
                # API 沒有提供，自己計算
                change = round(last_price - prev_close, 3) if prev_close else 0
            
            # 嘗試使用 API 提供的 change_rate
            change_rate_val = row.get('change_rate')
            if change_rate_val is not None and str(change_rate_val) != 'N/A':
                pct_change = float(change_rate_val)
            else:
                # API 沒有提供，自己計算
                pct_change = round((last_price - prev_close) / prev_close * 100, 2) if prev_close else 0
            
            # 格式化更新時間
            update_time = str(row.get('data_time', '')) or str(row.get('update_time', ''))
            
            return {
                'code': str(row.get('code', '')),
                'name': str(row.get('name', '')),
                'last_price': last_price,
                'open_price': float(row.get('open_price', 0)),
                'high_price': float(row.get('high_price', 0)),
                'low_price': float(row.get('low_price', 0)),
                'prev_close': prev_close,
                'change': round(change, 3),
                'pct_change': round(pct_change, 2),
                'volume': int(row.get('volume', 0)),
                'turnover': float(row.get('turnover', 0)),
                'update_time': update_time,
            }
        except Exception as e:
            logger.error(f"[QUOTE_HANDLER] 解析報價數據失敗: {e}")
            return None


def create_quote_handler(event_bus) -> QuoteHandler:
    """
    工廠函數：創建 QuoteHandler
    
    Args:
        event_bus: 事件總線實例
        
    Returns:
        QuoteHandler: 配置好的回調處理器
    """
    return QuoteHandler(event_bus)

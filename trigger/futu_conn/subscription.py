# Futu Subscription Manager
# 管理富途訂閱邏輯,所有操作都係獨立 function

import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)


class SubscriptionManager:
    """
    富途訂閱管理器

    職責:
    - 查詢當前訂閱狀態
    - 取消所有訂閱(帶冷卻檢查)
    - 訂閱新股
    """

    def __init__(self, ctx, event_bus):
        self.ctx = ctx
        self.event_bus = event_bus
        self._is_cancelling = False  # 防止同時取消
        logger.info("SubscriptionManager 初始化")

    def query_current(self) -> dict:
        """
        查詢當前訂閱狀態

        Returns:
            dict: {
                'total_used': int,
                'own_used': int,
                'sub_list': {'RT_DATA': [...], 'KLINE_1M': [...]}
            }
        """
        try:
            ret, data = self.ctx.query_subscription(is_all_conn=False)
            if ret == 0:
                logger.info(f"[SUB] 查詢訂閱成功: own_used={data.get('own_used', 0)}")
                return data
            else:
                logger.warning(f"[SUB] 查詢訂閱失敗: {data}")
                return {}
        except Exception as e:
            logger.error(f"[SUB] 查詢訂閱異常: {e}")
            return {}

    def get_subscribed_codes(self) -> list:
        """
        獲取已訂閱的股票代碼列表

        Returns:
            list: 已訂閱的股票代碼
        """
        data = self.query_current()
        sub_list = data.get('sub_list', {})
        rt_data = sub_list.get('RT_DATA', [])
        logger.info(f"[SUB] 當前已訂閱股票: {rt_data}")
        return rt_data

    def cancel_all(self) -> tuple:
        """
        取消所有訂閱(一次性)

        Returns:
            tuple: (bool, str) - (是否成功, 錯誤原因或'ok')
        """
        if self._is_cancelling:
            logger.warning("[SUB] 正在取消中,跳過")
            return (False, "正在取消中")

        self._is_cancelling = True
        try:
            logger.info("[SUB] 執行取消所有訂閱...")
            ret, err = self.ctx.unsubscribe_all()
            if ret == 0:
                logger.info("[SUB] 取消所有訂閱成功")
                self.event_bus.emit('subscription_cancelled', {'all': True})
                return (True, "ok")
            else:
                logger.error(f"[SUB] 取消所有訂閱失敗: {err}")
                return (False, str(err))
        except Exception as e:
            logger.error(f"[SUB] 取消所有訂閱異常: {e}")
            return (False, str(e))
        finally:
            self._is_cancelling = False

    def wait_until_cancelled(self, timeout=120) -> tuple:
        """
        等待取消訂閱確認（最多 timeout 秒）
        
        富途要求取消後要等一段時間才能確認成功
        呢個方法會輪詢查詢直到確認所有股票都取消
        
        Args:
            timeout: 最大等待秒數
            
        Returns:
            tuple: (bool, str) - (是否成功, 錯誤原因或'ok')
        """
        logger.info(f"[SUB] 等待取消確認（最多 {timeout}s）...")
        start = time.time()
        interval = 2  # 每 2 秒查詢一次
        
        while time.time() - start < timeout:
            codes = self.get_subscribed_codes()
            if not codes:
                logger.info("[SUB] 取消確認成功，所有訂閱已清除")
                return (True, "ok")
            logger.info(f"[SUB] 等待取消... 仍有: {codes}")
            time.sleep(interval)
        
        logger.warning("[SUB] 取消確認超時")
        return (False, "取消確認超時")

    def cancel_all_with_confirm(self, timeout=120) -> tuple:
        """
        取消所有訂閱並等待確認
        
        完整流程：
        1. 執行取消
        2. 輪詢查詢直到確認或超時
        
        Args:
            timeout: 最大等待秒數
            
        Returns:
            tuple: (bool, str) - (是否成功, 錯誤原因或'ok')
        """
        success, err = self.cancel_all()
        if not success:
            return (False, err)
        return self.wait_until_cancelled(timeout)

    def subscribe(self, codes: list) -> bool:
        """
        訂閱股票

        Args:
            codes: 股票代碼列表,如 ['HK.00700', 'HK.00981']

        Returns:
            bool: 是否成功
        """
        if not codes:
            logger.warning("[SUB] 訂閱列表為空,跳過")
            return False

        from futu import SubType

        try:
            logger.info(f"[SUB] 開始訂閱: {codes}")
            ret, err = self.ctx.subscribe(codes, [SubType.QUOTE])

            if ret == 0:
                logger.info(f"[SUB] 訂閱成功: {codes}")
                self.event_bus.emit('stocks_subscribed', {
                    'codes': codes,
                    'timestamp': time.time()
                })
                return True
            else:
                logger.error(f"[SUB] 訂閱失敗: {err}")
                return False

        except Exception as e:
            logger.error(f"[SUB] 訂閱異常: {e}")
            return False

    def is_subscribed(self, code: str) -> bool:
        """檢查某股票是否已訂閱"""
        return code in self.get_subscribed_codes()

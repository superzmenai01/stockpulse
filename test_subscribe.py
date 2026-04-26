#!/usr/bin/env python3
"""
測試富途訂閱功能
訂閱股票 10 秒，將收到的數據寫入日誌
"""

import sys
import time
import logging
from pathlib import Path

# 添加項目路徑
sys.path.insert(0, str(Path(__file__).parent / "backend"))

from futu import OpenQuoteContext, SubType, StockQuoteHandlerBase, RET_OK

# 配置日誌
LOG_DIR = Path(__file__).parent / "logs"
LOG_DIR.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOG_DIR / "test_subscribe.log"),
    ],
)
logger = logging.getLogger(__name__)


class TestQuoteHandler(StockQuoteHandlerBase):
    """測試用的 Quote Handler"""
    
    def on_recv_rsp(self, rsp):
        """收到報價回調"""
        ret_code, content = super().on_recv_rsp(rsp)
        
        if ret_code != RET_OK:
            logger.warning(f"[HANDLER] 回調錯誤: {content}")
            return RET_OK, content
        
        logger.info(f"[HANDLER] 收到回調數據: {type(content)}")
        logger.info(f"[HANDLER] 內容:\n{content}")
        
        return RET_OK, content


def test_subscribe():
    """測試訂閱功能"""
    logger.info("=" * 50)
    logger.info("開始測試富途訂閱功能")
    logger.info("=" * 50)
    
    # 連接 FutuOpenD
    host = "127.0.0.1"
    port = 11111
    
    logger.info(f"連接 FutuOpenD: {host}:{port}")
    
    ctx = OpenQuoteContext(host=host, port=port)
    
    # 設置回調處理器
    handler = TestQuoteHandler()
    ctx.set_handler(handler)
    logger.info("已設置 QuoteHandler")
    
    # 訂閱股票
    codes = ["HK.00700", "HK.00981"]
    logger.info(f"訂閱股票: {codes}")
    
    ret, err = ctx.subscribe(codes, [SubType.QUOTE])
    
    if ret == 0:
        logger.info(f"訂閱成功！")
    else:
        logger.error(f"訂閱失敗: {err}")
        ctx.close()
        return
    
    # 等待 10 秒，收集數據
    logger.info("等待 10 秒接收數據...")
    logger.info("-" * 50)
    
    start_time = time.time()
    received_count = 0
    
    while time.time() - start_time < 10:
        time.sleep(1)
        elapsed = int(time.time() - start_time)
        logger.info(f"已等待 {elapsed}/10 秒... (收到 {received_count} 次回調)")
    
    # 清理
    logger.info("-" * 50)
    logger.info("測試結束，取消訂閱")
    
    ret, err = ctx.unsubscribe(codes, [SubType.QUOTE])
    if ret == 0:
        logger.info("取消訂閱成功")
    else:
        logger.error(f"取消訂閱失敗: {err}")
    
    ctx.close()
    logger.info("連接已關閉")
    logger.info("=" * 50)


if __name__ == "__main__":
    try:
        test_subscribe()
    except Exception as e:
        logger.exception(f"測試過程中發生錯誤: {e}")

# K線 API

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from futu import KLType

logger = logging.getLogger(__name__)
router = APIRouter()

# 富途週期映射
PERIOD_MAP = {
    '1m': KLType.K_1M,
    '5m': KLType.K_5M,
    '15m': KLType.K_15M,
    '30m': KLType.K_30M,
    '1h': KLType.K_60M,
    '1d': KLType.K_DAY,
    '1w': KLType.K_WEEK,
    '1M': KLType.K_MON,
}


class KlineResponse(BaseModel):
    code: str
    name: str
    period: str
    klines: list[dict]


def get_kline_type(period: str) -> KLType:
    """將字串轉換為富途 KLType"""
    ktype = PERIOD_MAP.get(period.lower())
    if ktype is None:
        raise HTTPException(status_code=400, detail=f"不支援的週期: {period}")
    return ktype


@router.get("/kline")
async def get_kline(code: str, period: str = "1d", count: int = 100):
    """
    獲取 K線數據
    
    Params:
        code: 股票代碼 (如 HK.00700, US.INTC)
        period: 週期 (1m, 5m, 15m, 30m, 1h, 1d, 1w, 1M)
        count: 獲取多少根 K線
    """
    from backend.futu_conn import get_quote_ctx
    
    logger.info(f"[KLine] 獲取 {code} {period} K線，count={count}")
    
    try:
        ktype = get_kline_type(period)
        ctx = get_quote_ctx()
        
        if ctx is None or ctx.context is None:
            logger.warning(f"[KLine] 富途未連接，返回 mock 數據")
            # 返回 mock 數據方便測試
            return {
                'code': code,
                'name': code,
                'period': period,
                'klines': _get_mock_klines(code, count),
                'mock': True,
            }
        
        # 拉取歷史 K線
        ret, data, page_key = ctx.request_history_kline(
            code=code,
            ktype=ktype,
            autype='qfq',  # 前復權
            max_count=count,
        )
        
        if ret != 0:
            logger.error(f"[KLine] 富途錯誤: {data}")
            raise HTTPException(status_code=500, detail=f"富途錯誤: {data}")
        
        # 轉換為我們需要的格式
        klines = []
        for _, row in data.iterrows():
            klines.append({
                'time': row['time_key'],
                'open': float(row['open']),
                'high': float(row['high']),
                'low': float(row['low']),
                'close': float(row['close']),
                'volume': int(row['volume']),
            })
        
        # 股票名稱
        name = code
        
        logger.info(f"[KLine] 成功獲取 {len(klines)} 根 K線")
        
        return {
            'code': code,
            'name': name,
            'period': period,
            'klines': klines,
            'mock': False,
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[KLine] 錯誤: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _get_mock_klines(code: str, count: int) -> list:
    """返回 Mock K線數據（方便測試前端）"""
    import datetime
    klines = []
    base_price = 400.0 if 'HK.00700' in code else 100.0
    for i in range(count):
        t = datetime.datetime.now() - datetime.timedelta(days=count-i-1)
        klines.append({
            'time': t.strftime('%Y-%m-%d %H:%M:%S'),
            'open': base_price + i * 0.5,
            'high': base_price + i * 0.5 + 2,
            'low': base_price + i * 0.5 - 1,
            'close': base_price + i * 0.5 + 1,
            'volume': 1000000 + i * 10000,
        })
    return klines
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
    '1d': KLType.K_DAY,
    '1M': KLType.K_MON,
    '1y': KLType.K_YEAR,
}


class KlineResponse(BaseModel):
    code: str
    name: str
    period: str
    klines: list[dict]


def get_kline_type(period: str) -> KLType:
    """將字串轉換為富途 KLType"""
    # 注意：1M 和 1m 不同，1M 是月K，1m 是分鐘K
    # 所以唔好用 lower()，直接精確匹配
    ktype = PERIOD_MAP.get(period)
    if ktype is None:
        raise HTTPException(status_code=400, detail=f"不支援的週期: {period}")
    return ktype


@router.get("/kline")
async def get_kline(code: str, period: str = "1d", count: int = 100, start: Optional[str] = None, end: Optional[str] = None):
    """
    獲取 K線數據
    
    Params:
        code: 股票代碼 (如 HK.00700, US.INTC)
        period: 週期 (1m, 5m, 15m, 30m, 1h, 1d, 1w, 1M)
        count: 獲取多少根 K線
        start: 開始日期 (YYYY-MM-DD)，可選
        end: 結束日期 (YYYY-MM-DD)，預設今天
    """
    from backend.futu_conn import get_quote_ctx
    
    logger.info(f"[KLine] 獲取 {code} {period} K線，count={count}, start={start}, end={end}")
    
    # ========================================
    # 1. 前置檢查
    # ========================================
    
    # 1a. 美股不支援分鐘K
    if code.startswith('US.') and period in ('1m', '5m', '15m', '30m', '60m'):
        logger.warning(f"[KLine] 美股不支援分鐘K: {code} {period}")
        return {
            'code': code,
            'name': code,
            'period': period,
            'klines': [],
            'mock': False,
            'error': '美股不支援分鐘K',
        }
    
    try:
        ktype = get_kline_type(period)
        ctx = get_quote_ctx()
        
        logger.info(f"[KLine] period={period} -> ktype={ktype}")
        
        # 1b. 富途未連接 → 直接告知前端
        if ctx is None:
            logger.error(f"[KLine] 富途未連接，請檢查 FutuOpenD 是否運行")
            return {
                'code': code,
                'name': code,
                'period': period,
                'klines': [],
                'mock': False,
                'error': '富途未連接，請確保 FutuOpenD 已開啟',
            }
        
        # 1c. 處理日期範圍
        import datetime
        # 如果用戶有指定 start/end，就用戶的；否則用自動計算的
        start_date = start
        end_date = end
        
        # 1m 自動需要昨天（用戶指定時以用戶為準）
        if period == '1m' and not start:
            yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
            start_date = yesterday
            end_date = end_date or datetime.date.today().isoformat()
        
        # 美股日K：需要更大範圍（用戶指定時以用戶為準）
        if code.startswith('US.') and period == '1d' and not start:
            week_ago = (datetime.date.today() - datetime.timedelta(days=7)).isoformat()
            start_date = week_ago
            end_date = end_date or datetime.date.today().isoformat()
        
        ret, data, page_key = ctx.request_history_kline(
            code=code,
            ktype=ktype,
            autype='qfq',  # 前復權
            max_count=count,
            start=start_date,
            end=end_date,
        )
        
        if ret != 0:
            logger.error(f"[KLine] 富途錯誤: {data}")
            return {
                'code': code,
                'name': code,
                'period': period,
                'klines': [],
                'mock': False,
                'error': f'富途錯誤: {data}',
            }
        
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
        return {
            'code': code,
            'name': code,
            'period': period,
            'klines': [],
            'mock': False,
            'error': str(e),
        }


def _get_mock_klines(code: str, count: int, period: str = '1d') -> list:
    """返回 Mock K線數據（方便測試前端）"""
    import datetime
    import random
    klines = []
    base_price = 400.0 if 'HK.00700' in code else 100.0
    current_price = base_price
    
    now = datetime.datetime.now()
    
    for i in range(count):
        # 根據週期計算時間
        if period == '1m':
            t = now - datetime.timedelta(minutes=(count-i-1))
            time_str = t.strftime('%Y-%m-%d %H:%M:%S')
        elif period == '1M':
            t = now - datetime.timedelta(days=30*(count-i-1))
            time_str = t.strftime('%Y-%m')
        elif period == '1y':
            t = now - datetime.timedelta(days=365*(count-i-1))
            time_str = t.strftime('%Y')
        else:  # 1d
            t = now - datetime.timedelta(days=(count-i-1))
            time_str = t.strftime('%Y-%m-%d')
        
        # 隨機波動
        change = random.uniform(-5, 5)
        open_price = current_price
        close_price = current_price + change
        high_price = max(open_price, close_price) + abs(random.uniform(0, 2))
        low_price = min(open_price, close_price) - abs(random.uniform(0, 2))
        volume = random.randint(500000, 2000000)
        klines.append({
            'time': time_str,
            'open': round(open_price, 2),
            'high': round(high_price, 2),
            'low': round(low_price, 2),
            'close': round(close_price, 2),
            'volume': volume,
        })
        current_price = close_price
    return klines
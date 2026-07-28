# K線 API

"""
K線 API endpoint

大少 2026-07-28 #7987 trigger：cache-aside pattern
===================================================

Cache strategy (大少 trigger):
- period='1d': 走 KlineCache service（lazy fetch + bulk insert + qfq overwrite）
- 其他 period (1m, 1M, 1y): 直接 OpenD（Phase 1 唔 cache）
- 即時數據：保留現有 /api/snapshot endpoint，永遠 OpenD

Design:
- 改 existing endpoint 對 frontend **0 影響**（transparent cache-aside）
- 即使 cache path fail，fallback 直接 OpenD，唔會 break user
- Response 加 'cached' + 'fetch_count' flag（frontend debug 用）
"""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from futu import KLType
from backend.services.kline_cache import get_kline_cache

logger = logging.getLogger(__name__)
router = APIRouter()

# 富途週期映射表
# Key: 前端使用的週期字串
# Value: 富途的 KLType 枚舉
# 大少 #7985: Phase 1 only cache '1d'，其他直接 OpenD
PERIOD_MAP = {
    '1m': KLType.K_1M,   # 1分鐘K
    '1d': KLType.K_DAY,  # 日K ← cache path
    '1M': KLType.K_MON,  # 月K
    '1y': KLType.K_YEAR, # 年K
}


class KlineResponse(BaseModel):
    code: str
    name: str
    period: str
    klines: list[dict]


@router.get("/kline")
async def get_kline(
    code: str,
    period: str = "1d",
    count: int = 100,
    start: Optional[str] = None,
    end: Optional[str] = None,
):
    """
    獲取 K線數據

    大少 #7987：cache-aside pattern
    - period='1d' → KlineCache（本地 DB，lazy fetch，qfq overwrite）
    - 其他 period → 直接 OpenD（保留原邏輯）

    Params:
        code: 股票代碼 (如 HK.00700, US.INTC)
        period: 週期 (1m, 1d, 1M, 1y)
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
            'code': code, 'name': code, 'period': period,
            'klines': [], 'mock': False, 'cached': False,
            'error': '美股不支援分鐘K',
        }

    # 1b. period 必須支援
    if period not in PERIOD_MAP:
        logger.warning(f"[KLine] 不支援的週期: {period}")
        return {
            'code': code, 'name': code, 'period': period,
            'klines': [], 'mock': False, 'cached': False,
            'error': f'不支援的週期: {period}',
        }

    try:
        ctx = get_quote_ctx()
        if ctx is None:
            logger.error("[KLine] 富途未連接")
            return {
                'code': code, 'name': code, 'period': period,
                'klines': [], 'mock': False, 'cached': False,
                'error': '富途未連接，請確保 FutuOpenD 已開啟',
            }

        # ========================================
        # 2. Cache path (period='1d') vs Direct path
        # ========================================
        cache = get_kline_cache()

        if period == '1d':
            # Cache-aside path (大少 #7987 Phase 1)
            result = await cache.get_or_fetch(
                code=code, ctx=ctx, period=period,
                count=count, start=start, end=end,
            )
            # 大少 #8296: 加 detail logger 顯示 DB pass 咩 data 俾 chart
            klines = result.get('klines', [])
            first_time = klines[0]['time'] if klines else None
            last_time = klines[-1]['time'] if klines else None
            logger.info(
                f"[KLine] response: code={code} period={period} "
                f"cached={result.get('cached')} fetch_count={result.get('fetch_count', 0)} "
                f"rows={len(klines)} first={first_time} last={last_time} "
                f"(query: count={count} start={start} end={end})"
            )
            return {
                'code': code, 'name': code, 'period': period,
                'klines': klines,
                'mock': False,
                'cached': result['cached'],
                'fetch_count': result.get('fetch_count', 0),
                'error': result.get('error'),
            }
        else:
            # Direct OpenD path (1m, 1M, 1y — Phase 1 不 cache)
            # 保留原 endpoint 邏輯：直接從 OpenD fetch
            result = await cache._fetch_direct_only(
                code, ctx, period, count, start, end,
            )
            return {
                'code': code, 'name': code, 'period': period,
                'klines': result['klines'],
                'mock': False,
                'cached': False,
                'fetch_count': result.get('fetch_count', 0),
                'error': result.get('error'),
            }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[KLine] 錯誤: {e}")
        return {
            'code': code, 'name': code, 'period': period,
            'klines': [], 'mock': False, 'cached': False,
            'error': str(e),
        }
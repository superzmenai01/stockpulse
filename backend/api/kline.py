# K線 API

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from futu import KLType

logger = logging.getLogger(__name__)
router = APIRouter()

# 大少 #8505: KlineCache module-level instance (凡人話: cache 整個 process 共用)
from backend.services.kline_cache import KlineCache
_cache = KlineCache()

# 富途週期映射表
# Key: 前端使用的週期字串
# Value: 富途的 KLType 枚舉
PERIOD_MAP = {
    '1m': KLType.K_1M,   # 1分鐘K
    '1d': KLType.K_DAY,  # 日K
    '1M': KLType.K_MON,  # 月K
    '1y': KLType.K_YEAR, # 年K
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

        # 大少 #11070 (2026-08-07) — Testing page 改 dataWindowDays 但 chart 仲係用舊 data
        # Root cause: 1d 默認 start = 6 個月前 (180 日), 拎 ~120 trading days
        # 改為按 user count 計算 start_date (1.5x 緩衝 cover weekends/holidays)
        # e.g. count=300 → start=450 calendar days ago → ~300 trading days
        if period == '1d' and not start:
            # 1 trading day ≈ 1.5 calendar days (含週末 + 假期)
            calendar_days_back = max(int(count * 1.5), 180)
            start_date = (datetime.date.today() - datetime.timedelta(days=calendar_days_back)).isoformat()
            end_date = end_date or datetime.date.today().isoformat()
            logger.info(f"[KLine] 1d default start={start_date} (count={count} → {calendar_days_back} calendar days back)")

        # 月K：默認前72個月 = 6年（用戶指定時以用戶為準）
        if period == '1M' and not start:
            from dateutil.relativedelta import relativedelta
            six_years_ago = datetime.date.today() - relativedelta(months=72)
            # 月K的start需要使用月份的第一天，否則會漏掉該月的K線
            start_date = six_years_ago.replace(day=1).isoformat()
            end_date = end_date or datetime.date.today().isoformat()

        # 年K：默認所有歷史數據（用戶指定時以用戶為準）
        # 富途預設行為當 start/end 都為 None 時只返回最近一年，
        # 所以我們用一個很早的日期確保拿到所有歷史數據
        if period == '1y' and not start:
            start_date = '1990-01-01'
            end_date = end_date or datetime.date.today().isoformat()
        elif period == '1y' and start and not end:
            end_date = datetime.date.today().isoformat()

        # 大少 #8505 + #8513: cache-aside — caller (kline.py) 負責 PERIOD_MAP 轉 ktype
        cache_result = await _cache.get_or_fetch(
            code=code, ctx=ctx, ktype=ktype, period=period,
            start=start_date, end=end_date, max_count=count
        )
        # 大少 #8549: KlineCache 已 return formatted klines (per #8505 contract)
        # 之前 refactor leftover: data=None + for row in data.iterrows() → NoneType crash
        # 刪走 dead code, 直接用 cache_result['klines']
        klines = cache_result['klines']
        cached_flag = cache_result['cached']
        fetch_count = cache_result['fetch_count']

        # 大少 #11070 (2026-08-07) — Trim response 落 user-requested count
        # Cache 返晒所有 fetched (wide-fetch 30*365 為將來 gap-fill),但 response 應該對齊 user 設定
        # 取最後 N 條 (最 recent) 因為 testing page user 冇 specify start
        requested_count = count
        data_limited = False
        if requested_count and len(klines) > requested_count:
            klines = klines[-requested_count:]
        elif requested_count and len(klines) < requested_count:
            # 拎唔夠 user 想要嘅條數 (OpenD 限制)
            data_limited = True
            logger.warning(
                f"[KLine] {code} {period} 數據不足: user request={requested_count}, "
                f"actual={len(klines)} (可能 OpenD history 限制或 cold cache 撞牆)"
            )
        actual_count = len(klines)

        # 大少 #7780: 加 turnover_rate per candle (volume / outstanding_shares)
        outstanding_shares = 0
        try:
            ret_snap, snap_data = ctx.get_market_snapshot([code])
            if ret_snap == 0 and len(snap_data) > 0 and 'outstanding_shares' in snap_data.columns:
                outstanding_shares = float(snap_data.iloc[0]['outstanding_shares'] or 0)
                logger.info(f"[KLine] {code} outstanding_shares = {outstanding_shares:,.0f}")
        except Exception as e:
            logger.warning(f"[KLine] 取 outstanding_shares 失敗: {e}")

        if outstanding_shares > 0:
            for kline in klines:
                kline['turnover_rate'] = round((kline['volume'] / outstanding_shares) * 100, 3)
        else:
            for kline in klines:
                kline['turnover_rate'] = None

        # 股票名稱
        name = code

        logger.info(
            f"[KLine] 成功獲取 {actual_count} 根 K線 "
            f"(requested={requested_count}, cached={cached_flag}, fetch_count={fetch_count}, data_limited={data_limited})"
        )

        # 大少 #8505: 加 cached + fetch_count flags 俾 frontend debug
        # 大少 #11070: 加 requested_count / actual_count / data_limited flags 俾 frontend UI 顯示
        return {
            'code': code,
            'name': name,
            'period': period,
            'klines': klines,
            'mock': False,
            'cached': cached_flag,
            'fetch_count': fetch_count,
            'requested_count': requested_count,
            'actual_count': actual_count,
            'data_limited': data_limited,
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



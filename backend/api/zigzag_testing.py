"""
backend/api/zigzag_testing.py — ZigZag Testing API endpoint (大少 2026-08-29 19:34 trigger)

凡人話: 新後台 endpoint, 1-to-1 port testing-page.js 嘅 ZigZag 全部嘢
(紫線 algorithm + auto threshold 計算 + 鮮綠線 + P 點順序號碼)

Endpoint: GET /api/zigzag-testing/run
- 拎 K 線 (KlineCache full flow, T-1 normalized, 跟 /api/kline endpoint 對齊)
- 跑 zigzag_testing 模組 (1-to-1 port frontend calculateZigZag)
- 返 {points, threshold, extension_line, sequence_count, ...}

對應 frontend: testing-page.js 撳跑 algorithm 嗰陣嘅 ZigZag flow
- 凡人話原因: 大少要對比新後台 vs 舊 testing page 拎到嘅結果係咪一致
- 永久 rule (大少 2026-08-29 19:34): 唔好動 testing-page.js / index.html / 舊 backend/algorithms/zigzag/algorithm.py

Spec Sync: 屬於 Spec Sync #47 (待 push, 大少 confirm 後)
"""

import datetime
import logging
from typing import Optional

from fastapi import APIRouter, Query

from backend.algorithms.zigzag_testing.algorithm import run_zigzag_testing

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/zigzag-testing", tags=["zigzag-testing"])


@router.get("/run")
async def run_zigzag_testing_endpoint(
    symbol: str = Query(..., description="股票代號 (e.g. HK.00941, HK.00700)"),
    period: str = Query("1d", description="K 線週期 (1d / 1w / 1M)"),
    data_window_days: int = Query(1260, description="拎幾多日 K 線 (默認 1260 = 5 年, 大少 2026-08-14 23:15 永久 rule)"),
    threshold_mode: str = Query("auto", description="Threshold 模式: 'auto' / 'manual' (對齊 testing-page.js LS_KEY_THRESHOLD_MODE)"),
    manual_threshold: Optional[float] = Query(None, description="手動 mode 用, 1-20 (%) (對齊 testing-page.js LS_KEY_MANUAL_THRESHOLD)"),
    lookback: int = Query(20, description="自動 mode 計 threshold 用, 5-100 (對齊 testing-page.js LS_KEY_LOOKBACK)"),
    multiplier: float = Query(2.5, description="自動 mode 倍數, 預設 2.5 (對齊 testing-page.js autoThresholdVolatility)"),
):
    """凡人話: 跑 ZigZag testing algorithm (新後台, 1-to-1 port frontend)

    Query params:
    - symbol: 股票代號 (e.g. HK.00941)
    - period: K 線週期 (1d / 1w / 1M), 默認 1d
    - data_window_days: 拎幾多日 K 線, 默認 1260 (5 年)
    - threshold_mode: 'auto' / 'manual', 默認 auto (跟 testing page default)
    - manual_threshold: 手動 mode 用, 1-20 (%)
    - lookback: 自動 mode 計 threshold 用, 5-100, 默認 20
    - multiplier: 自動 mode 倍數, 默認 2.5

    Returns:
        {
            "ok": bool,
            "symbol": str,
            "period": str,
            "klines_count": int,
            "points": [{date, value, type, index, sequence}],
            "threshold": float (%, 實際用嘅 threshold),
            "threshold_mode": str,
            "extension_line": {from, to, color: '#00C853'} or None,
            "sequence_count": int,
            "error": str or None
        }
    """
    try:
        # 1. 拎 K 線 (KlineCache full flow, 對齊 services/algorithm_runner.py pattern)
        from backend.services.kline_cache import KlineCache

        cache = KlineCache()

        end_date = datetime.date.today().isoformat()
        if period == "1d":
            calendar_days_back = max(int(data_window_days * 1.5), 180)
        elif period == "1w":
            calendar_days_back = max(int(data_window_days * 7 * 1.2), 365)
        elif period in ("1M", "1m"):
            calendar_days_back = max(int(data_window_days * 31 * 1.1), 365)
        else:
            calendar_days_back = max(int(data_window_days * 1.5), 180)
        start_date = (datetime.date.today() - datetime.timedelta(days=calendar_days_back)).isoformat()

        klines = cache.get_klines(symbol, period, start=start_date, end=end_date)

        # Stale cache fix (永久 rule 大少 2026-08-23 13:19)
        t_minus_1 = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
        is_stale = bool(klines) and (klines[-1].get('time', '') < t_minus_1)
        need_refresh = (not klines) or is_stale

        if need_refresh:
            try:
                import asyncio
                import nest_asyncio
                nest_asyncio.apply()
                from backend.futu_conn import get_quote_ctx
                from backend.api.kline import get_kline_type

                ctx = get_quote_ctx()
                ktype = get_kline_type(period)
                fetch_max = KlineCache._compute_fetch_max_count(period)

                async def _fetch_with_retry():
                    for retry_attempt in range(3):
                        try:
                            result = await cache.get_or_fetch(
                                symbol, ctx, ktype, period=period,
                                start=start_date, end=end_date, max_count=fetch_max
                            )
                            if result and result.get("klines"):
                                return result
                            return None
                        except Exception as fetch_err:
                            err_str = str(fetch_err)
                            if ("频率" in err_str or "ExceedReqLimit" in err_str) and retry_attempt < 2:
                                wait_time = 1.0 * (retry_attempt + 1)
                                logger.warning(
                                    f"[ZigZag Testing] OpenD throttle (attempt {retry_attempt+1}/3), "
                                    f"sleep {wait_time}s + retry: {err_str[:100]}"
                                )
                                await asyncio.sleep(wait_time)
                                continue
                            logger.warning(
                                f"[ZigZag Testing] cache refresh failed: {type(fetch_err).__name__}: {err_str[:200]}"
                            )
                            return None
                    return None

                cache_result = asyncio.run(_fetch_with_retry())
                if cache_result and cache_result.get("klines"):
                    klines = cache_result["klines"]
                    logger.info(
                        f"[ZigZag Testing] cache refresh: {len(klines)} klines for {symbol} {period} "
                        f"(cached={cache_result.get('cached')})"
                    )
            except Exception as e:
                logger.warning(f"[ZigZag Testing] cache refresh failed: {type(e).__name__}: {e}")

        # 2. Trim 落 user requested count
        if len(klines) > data_window_days:
            klines = klines[-data_window_days:]

        if not klines:
            return {
                "ok": False,
                "symbol": symbol,
                "period": period,
                "klines_count": 0,
                "points": [],
                "threshold": 0.0,
                "threshold_mode": threshold_mode,
                "extension_line": None,
                "sequence_count": 0,
                "error": f"{symbol} {period} 冇 K 線 data (可能 OpenD 未連接或 cold cache)",
            }

        # 3. 跑 zigzag_testing 模組 (1-to-1 port frontend calculateZigZag)
        result = run_zigzag_testing(
            klines=klines,
            threshold_mode=threshold_mode,
            manual_threshold=manual_threshold,
            lookback=lookback,
            multiplier=multiplier,
        )

        # 4. 包埋 symbol / period 響應
        result["symbol"] = symbol
        result["period"] = period

        return result
    except Exception as e:
        logger.exception(f"[ZigZag Testing] run 失敗: symbol={symbol}")
        return {
            "ok": False,
            "symbol": symbol,
            "period": period,
            "klines_count": 0,
            "points": [],
            "threshold": 0.0,
            "threshold_mode": threshold_mode,
            "extension_line": None,
            "sequence_count": 0,
            "error": f"內部錯誤: {e}",
        }

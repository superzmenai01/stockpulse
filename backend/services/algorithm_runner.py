"""
backend/services/algorithm_runner.py — Algorithm runner service (大少 2026-08-20 Phase 1)

凡人話: 統一由呢度 fetch K 線 + 跑 algorithm + 返 verdict
- Algorithm 入面唔可以直接 fetch K 線 (永久 rule)
- API endpoint 入面唔可以直接 call algorithm (永久 rule, 要經呢個 runner)
- 將 fetch K 線 + algorithm run + warning log 集中喺度

對應 backup: backups/zigzag-frontend-2026-08-20/RESTORE.md
Spec: docs/research/AS-03-cycle-detection/MODULE-XX-*.md (per algorithm)
Algorithm: fetch K 線 → 拎 algorithm 實例 → 跑 algorithm → wrap response
凡人話: 統一 algorithm 入口, 將 K 線 + 參數 餵入, 拎 verdict 出嚟
"""

import datetime
import logging
from typing import Dict, Any

from backend.algorithms import get_algorithm
from backend.algorithms.base import Verdict

logger = logging.getLogger(__name__)


def run_algorithm(
    algo_name: str,
    symbol: str,
    period: str = "1d",
    data_window_days: int = 1260,
    **options
) -> Dict[str, Any]:
    """凡人話: 統一 algorithm 入口

    Args:
        algo_name: Algorithm name (e.g. "zigzag")
        symbol: 股票代號 (e.g. "HK.00700")
        period: K 線週期 (1d / 1w / 1M)
        data_window_days: 拎幾多日 K 線 (默認 1260 = 5 年, 大少 2026-08-14 23:15 永久 rule)
        **options: 自訂參數 (e.g. threshold=5 畀 ZigZag)

    Returns:
        dict: 統一 response shape
        {
            "ok": bool,
            "algorithm": str,
            "version": str,
            "symbol": str,
            "period": str,
            "klines_count": int,
            "points": [...],
            "meta": {...},
            "warnings": [...],
            "error": str | None,
        }
    """
    # 1. 拎 algorithm 實例 (凡人話: 會 trigger KeyError 如果 algorithm 唔存在)
    algo = get_algorithm(algo_name)

    # 2. 拎 K 線 (大少 #8602 永久 rule: 1d 用 30*365 wide-fetch, caller max_count 只作 trim)
    from backend.services.kline_cache import KlineCache
    cache = KlineCache()

    # 大少 #11070 永久 rule: 1d 默認 start = 1.5x calendar days back
    end_date = datetime.date.today().isoformat()
    if period == "1d":
        calendar_days_back = max(int(data_window_days * 1.5), 180)
    elif period == "1w":
        calendar_days_back = max(int(data_window_days * 7 * 1.2), 365)
    elif period in ("1M", "1m"):  # 1m = monthly K (小心: 1m 細寫係分鐘, 1M 大寫係月)
        calendar_days_back = max(int(data_window_days * 31 * 1.1), 365)
    else:
        calendar_days_back = max(int(data_window_days * 1.5), 180)
    start_date = (datetime.date.today() - datetime.timedelta(days=calendar_days_back)).isoformat()

    klines = cache.get_klines(symbol, period, start=start_date, end=end_date)

    # 大少 #11070 永久 rule: trim 落 user requested count
    if len(klines) > data_window_days:
        klines = klines[-data_window_days:]

    if not klines:
        return {
            "ok": False,
            "algorithm": algo_name,
            "version": algo.version,
            "symbol": symbol,
            "period": period,
            "klines_count": 0,
            "points": [],
            "meta": {},
            "warnings": [],
            "error": f"{symbol} {period} 冇 K 線 data (可能 OpenD 未連接或 cold cache)",
        }

    # 3. 跑 algorithm
    # 大少 2026-08-20 20:05 Phase 2 — M1 algorithm 拎 ZigZag data
    # 凡人話: 跑 algorithm 之前, 如果 algorithm 係 ma_alignment, 先拎 ZigZag verdict inject 落 options
    # 永久 rule: caller (runner service) 負責 algorithm 嘅 dependency inject, 唔好喺 algorithm 入面 fetch
    if algo_name == "ma_alignment":
        try:
            from backend.algorithms.zigzag import ZigZagAlgorithm
            zigzag_algo = ZigZagAlgorithm()
            threshold = options.get("threshold", 5)
            zigzag_verdict = zigzag_algo.run(klines, {"threshold": threshold})
            if zigzag_verdict.ok and zigzag_verdict.points:
                options["zigzagPoints"] = zigzag_verdict.points
                options["lastSwingHigh"] = zigzag_verdict.meta.get("lastSwingHigh")
                options["lastSwingLow"] = zigzag_verdict.meta.get("lastSwingLow")
                options["zigzagThreshold"] = zigzag_verdict.meta.get("threshold", threshold)
                options["zigzagSource"] = "backend (Phase 1 v1.0.0, M1 dependency inject)"
                logger.info(
                    f"[Algorithm] M1 inject ZigZag: {len(zigzag_verdict.points)} points "
                    f"from backend ({zigzag_verdict.meta.get('klines_count', 0)} klines)"
                )
        except Exception as e:
            # 永久 rule: dependency inject 失敗 fallback caller 拎 (唔 crash algorithm)
            logger.warning(f"[Algorithm] M1 ZigZag inject 失敗, 繼續跑 (verdict 會有 null ZigZag): {e}")

    logger.info(
        f"[Algorithm] Running {algo_name} v{algo.version} on {symbol} {period} "
        f"({len(klines)} klines, options={options})"
    )
    try:
        verdict: Verdict = algo.run(klines, options)
    except Exception as e:
        logger.exception(f"[Algorithm] {algo_name} run 失敗")
        return {
            "ok": False,
            "algorithm": algo_name,
            "version": algo.version,
            "symbol": symbol,
            "period": period,
            "klines_count": len(klines),
            "points": [],
            "meta": {},
            "warnings": [],
            "error": f"Algorithm 內部錯誤: {e}",
        }

    # 4. Wrap 返 response shape (frontend / 其他 module 直接用)
    return {
        "ok": verdict.ok,
        "algorithm": algo_name,
        "version": algo.version,
        "symbol": symbol,
        "period": period,
        "klines_count": len(klines),
        "points": verdict.points,
        "meta": verdict.meta,
        "warnings": verdict.warnings,
        "error": verdict.error,
    }

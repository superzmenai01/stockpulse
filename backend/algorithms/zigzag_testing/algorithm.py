"""
backend/algorithms/zigzag_testing/algorithm.py — ZigZag Testing Algorithm (大少 2026-08-29 19:34, 23:30 重置)

凡人話: 大少 23:30 trigger 拎走所有 ZigZag 算法, 等重新再來。
呢個 file 而家係 stub, frontend `~/stockpulse/zigzag-testing/` page 撳跑會見到 error message。

重寫時要 retrieve 返嘅 rule:
- 1-to-1 port testing-page.js 嘅 `calculateZigZagFrontend` (line 61-91) + `autoThresholdVolatility` (line 52-75)
- 拎 K 線用 KlineCache full flow (KlineCache 嘅 `get_or_fetch` method, 唔好用 `get_klines` 純 read, 大少 2026-08-22 18:06 永久 rule)
- Return verdict 結構要對齊 frontend 拎到嘅 shape: {ok, points, threshold, threshold_mode, klines_count, extension_line, sequence_count, error}
- 大少 4.15.0 永久 rule: 之字拎 point 同 trigger 都用 high/low 對齊, 唔好用 close
- 大少 4.16.0 永久 rule: 永遠用 1 個 direction flag + 1 個 ref value (唔好分 2 loop)
- P 點 sequence: 1=最新, 倒序排 (testing page 4.9.0/4.10.0)
- 鮮綠線: 從最後 ZigZag point → K 線最後 close, 顏色 #00C853 (testing page 4.33.0)
- 拎走嘅 function 清單: extract_hlc, auto_threshold_volatility, _zigzag_normalize_date, calculate_zigzag, build_extension_line, assign_sequence_numbers, point_marker_position, run_zigzag_testing
"""

import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)


# ============================================================
# 凡人話: Stub — 大少 2026-08-29 23:30 trigger 拎走, 等重新再來
# ============================================================
def run_zigzag_testing(
    klines: List[Dict[str, Any]],
    threshold_mode: str = "auto",
    manual_threshold: Optional[float] = None,
    lookback: int = 20,
    multiplier: float = 2.5,
) -> Dict[str, Any]:
    """凡人話: ZigZag testing 算法 stub (大少 23:30 拎走, 等重寫)

    Returns:
        {"ok": False, "error": "ZigZag 算法已重置, 請重寫", ...其他 field 都係 default}
    """
    logger.warning("[ZigZag Testing] run_zigzag_testing 係 stub, 算法未實現, 請重寫")
    return {
        "ok": False,
        "points": [],
        "threshold": 0.0,
        "threshold_mode": threshold_mode,
        "klines_count": 0,
        "extension_line": None,
        "sequence_count": 0,
        "error": "ZigZag 算法已重置, 請重寫",
    }

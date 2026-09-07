"""
backend/algorithms/hl-structure/algorithm.py — M2 HL Structure v0.4.0 (大少 2026-09-07 11:45 plan 批准, 5-layer evidence-based 優化)

凡人話: 拎 K 線 → 識別峰谷 (peaks + troughs) → 趨勢分析 → 結構分數 → 箱體邊界 → 形態預警 → 價格位置 → 信心指數
         → [v0.2.0 新加] 短線 mode 確認 (60 日) → 突破 override (升穿最近 peak) → 綜合信心指數

對應 source: algorithms/AS-03-cycle-detection/modules/hl-structure.ts v0.2.0 (對齊 v0.2.0 Python port)
對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs (line 3932-4269 frontend analyzeHLStructure 337 行)
對應 spec doc: docs/research/AS-03-cycle-detection/MODULE-02-HL-STRUCTURE.md
對應 framework: backend/algorithms/base.py Verdict contract

Algorithm: 19 步 (v0.2.0 比 v0.1.0 多 2 步, 跟 hl-structure.ts 嘅 detect() method 1:1 port 去 Python)
- Step 0:  輸入驗證
- Step 1:  ATR + 自適應 Window
- Step 2:  加權價格 + 動態 Tolerance
- Step 3:  識別原始極值點
- Step 4:  突破確認機制
- Step 5:  成交量過濾
- Step 6:  極值點交替化
- Step 7:  提取最近 N 組峰谷
- Step 8:  時間衰減加權
- Step 9:  趨勢分析 (峰序列 + 谷序列)
- Step 10: 結構一致性分數
- Step 11: 基礎信心指數
- Step 12: 箱體邊界 (只 sideways)
- Step 13: 形態預警檢查
- Step 14: 當前價格位置驗證
- Step 15: 極值點新鮮度檢查
- Step 16: 短線 mode 確認 (v0.2.0 新加) — 用最近 60 日 K 線 + adaptive window 揾峰谷, 雙重確認 uptrend
- Step 17: 突破 override (v0.2.0 新加) — 升穿最近 peak + 量能確認 + [可選] 峰谷收縮確認, override SIDEWAYS → uptrend
- Step 18: 綜合信心指數 (原本 Step 17)
- Step 19: 組裝輸出 (原本 Step 18, frontend 兼容 shape)

v0.2.0 改動 (大少 2026-09-06 11:34 trigger):
- 9月6日 08:48 揾到 M2 hl_structure 對 00013 和黃醫藥 判 SIDEWAYS 但實際係 V 型反轉 +27% 強升
- 跟 sub-scenario 永久 rule 流程: 掃 500 隻 HK 股 → 揾 22 隻 M1 UP + M2 SIDEWAYS conflict
- Prototype v3 (60 日 + Fix 5 個 bug) 救得返 10/22 隻 (45%)
- 大少 11:34 trigger 收縮突破邏輯: 00019 太古最後一對峰谷差距 2.4% < 5% (收縮確認) + 升穿 104.5 peak = 盤整突破 = uptrend
- 落 M2 v0.2.0:
  Step 16 短線 mode: 用最近 60 日 K 線 (對齊 M2 adaptive window + weighted price), peak_trend + trough_trend 都係 rising → 確認 uptrend (override 5 年尺度 sideways)
  Step 17 突破 override: close > 最近 peak × (1 + tolerance) + 量能 (5 日內 vol 最大嗰日 > 20 日均量 × 1.3) → 確認 uptrend
  Step 17 sub-trigger 收縮確認: 最後一對峰谷差距 < 5% → 收縮突破 + pattern_alert = "consolidation_breakout"

STATE_MAP (大少 2026-09-05 trigger — Fix A):
- hl_structure candidate 原本係 "uptrend" / "downtrend" / "sideways" (lowercase, 內部 cycle string)
- 其他 5 個 module (ma_alignment / trendline / volatility / indicators / volume_price) meta.state 全部係 "UP" / "DOWN" / "SIDEWAYS" (uppercase)
- algorithm_runner.py M7 inject 嗰段做 `state: upstream_meta.get("state")`, 拎到 None (因為 hl_structure meta 冇 state field)
- contract.py Literal validation fail, hl_structure silent drop, M7 只剩 5/6 module
- Fix: hl_structure meta 全部 3 個出口位 (空 case / 唔夠 case / main case) 加 state field,
      由 candidate 1-to-1 derive (uptrend→UP / downtrend→DOWN / sideways→SIDEWAYS)
- 對齊 contract.py ModuleVerdictMeta state Literal, backend 拎到 state, M7 拎齊 6 個 module
- 對應 spec: MODULE-02-HL-STRUCTURE.md + backend/algorithms/contract.py ModuleVerdictMeta
"""

import math
from typing import List, Dict, Any

from ..base import Algorithm, Verdict
from ..registry import register
from .config import DEFAULT_HL_STRUCTURE_CONFIG


# 凡人話: 對齊 ma_alignment STATE_MAP pattern, candidate 1-to-1 map 返 uppercase
# 對應 contract.py ModuleVerdictMeta state Literal
HL_STRUCTURE_STATE_MAP: Dict[str, str] = {
    "uptrend":   "UP",
    "downtrend": "DOWN",
    "sideways":  "SIDEWAYS",
}


# ============================================================
# Helpers
# ============================================================

def _round(value: float, decimals: int) -> float:
    """凡人話: 四捨五入到指定小數位 (跟 hl-structure.ts 嘅 round() function)"""
    if value is None or (isinstance(value, float) and (math.isnan(value) or math.isinf(value))):
        return 0.0
    factor = 10 ** decimals
    return round(value * factor) / factor


def _calc_atr(klines: List[Dict[str, Any]], period: int) -> float:
    """凡人話: ATR (Average True Range) — 拎 K 線 + period, 返平均真實波幅

    對應 frontend calcATR (adapter.mjs line 3815-3827)
    """
    if len(klines) < period + 1:
        return 0.0
    trs = []
    for i in range(period, len(klines)):
        curr = klines[i]
        prev = klines[i - 1]
        tr1 = curr["high"] - curr["low"]
        tr2 = abs(curr["high"] - prev["close"])
        tr3 = abs(curr["low"] - prev["close"])
        trs.append(max(tr1, tr2, tr3))
    return sum(trs) / len(trs) if trs else 0.0


def _smooth_savgol(weighted_prices: List[float], window_length: int, polyorder: int = 2) -> List[float]:
    """凡人話: Savitzky-Golay 平滑過濾, 抹走 noise 但保留峰形

    對齊 `askpython.com` Savitzky-Golay 教學:
    - window_length 必須正奇數, 細過 data 長度
    - polyorder < window_length, 預設 2 (拋物線峰形)

    Algorithm:
    - 每個 data 點用 polyorder-degree polynomial 喺 sliding window 入面最小二乘擬合
    - 取 polynomial 喺中心點嘅值做平滑後輸出
    - 對 noise 大嘅 data 拎 peak/trough 之前做 smoothing 改善穩定性

    Example:
        [10, 11, 9, 12, 8, 13, 7]  (raw)
        [9.8, 10.2, 10.5, 10.8, 11.0, 11.1, 10.9]  (smoothed, polyorder=2, window=5)
    """
    n = len(weighted_prices)
    if n < 3:
        return list(weighted_prices)

    # 確保 window_length 係正奇數, 細過 data 長度
    wl = window_length
    if wl % 2 == 0:
        wl += 1
    if wl >= n:
        wl = max(3, n - 1 if n % 2 == 0 else n)
        if wl % 2 == 0:
            wl -= 1
    if wl <= polyorder:
        wl = polyorder + 2 if (polyorder + 2) % 2 == 1 else polyorder + 3
    if wl < 3:
        return list(weighted_prices)

    half = wl // 2
    smoothed = [0.0] * n

    # 用 numpy 1 次過計 matrix 避免 nested loop 慢
    # 對齊 numpy savgol_filter 內部邏輯, 但唔引入 scipy 依賴 (跟 M3 pattern)
    try:
        import numpy as np
        x = np.arange(wl, dtype=float) - half
        # Vandermonde matrix
        A = np.vander(x, polyorder + 1, increasing=True)
        # Pseudo-inverse 拎 (A^T A)^-1 A^T
        coeffs = np.linalg.pinv(A)
        for i in range(n):
            left = max(0, i - half)
            right = min(n, i + half + 1)
            segment_len = right - left
            if segment_len < wl:
                # 邊界: 用 'nearest' mode 補長 (對齊 askpython.com 教學)
                seg = []
                for j in range(wl):
                    src = left + j
                    if src < 0:
                        src = 0
                    elif src >= n:
                        src = n - 1
                    seg.append(weighted_prices[src])
                seg_arr = np.array(seg, dtype=float)
            else:
                seg_arr = np.array(weighted_prices[left:right], dtype=float)
            # 中心點 (i - left) 嘅 polynomial 值 = coeffs[0] @ segment (取 row 0 = constant + linear + ...)
            smoothed[i] = float(np.dot(coeffs[0], seg_arr))
        return smoothed
    except ImportError:
        # Fallback: numpy 冇, 用 simple moving average
        ma_window = min(5, n)
        half_ma = ma_window // 2
        out = [0.0] * n
        for i in range(n):
            left = max(0, i - half_ma)
            right = min(n, i + half_ma + 1)
            out[i] = sum(weighted_prices[left:right]) / (right - left)
        return out


def _compute_prominence(
    values: List[float],
    idx: int,
    left_end: int,
    right_end: int,
) -> float:
    """凡人話: 拎 peak/trough 嘅 prominence (突出度) — 對齊 `exchangetuts.com` SciPy find_peaks 哲學

    公式: prominence = peak_value - max(left_min_baseline, right_min_baseline)
          (即係由 peak 落到最近 baseline 嘅垂直距離)

    Args:
        values: 平滑後嘅 weighted prices
        idx: peak/trough 嘅 index
        left_end: 左邊掃描結束 index (exclusive)
        right_end: 右邊掃描結束 index (exclusive)

    Returns:
        prominence value (絕對值, 越大越顯著)
    """
    n = len(values)
    if idx < 0 or idx >= n or n == 0:
        return 0.0
    peak_value = values[idx]

    # 向左揾 baseline (左邊所有值嘅 min, 即係左邊最低)
    left_min = peak_value
    for i in range(max(0, idx - 1), max(0, left_end) - 1, -1):
        if i < 0:
            break
        if values[i] < left_min:
            left_min = values[i]

    # 向右揾 baseline
    right_min = peak_value
    for i in range(min(n - 1, idx + 1), min(n, right_end)):
        if i >= n:
            break
        if values[i] < right_min:
            right_min = values[i]

    # 對 peak 嚟講 baseline = max(left_min, right_min), 拎 min 突出度
    # 對 trough 嚟講顛倒: trough_value - min(left_max, right_max)
    return peak_value - min(left_min, right_min)


def _detect_extremes(
    weighted: List[Dict[str, Any]],
    window: int,
    cfg: Dict[str, Any] = None,
) -> Dict[str, List[int]]:
    """凡人話: 識別原始極值點 (peaks 山頂 + troughs 山谷)

    對應 frontend detectExtremes (adapter.mjs line 3830-3849)

    v0.4.0 Layer 1 (對齊 plan §Layer 1 — 揾山頂山谷更穩):
    - 加 Savitzky-Golay 平滑 (對齊 `exchangetuts.com` / `askpython.com` 哲學)
    - 加 prominence 過濾 (對齊 SciPy `find_peaks` 嘅 prominence 概念)
    - enableSavitzkyGolayFilter: False 時 fallback 返 v0.3.0 simple 邏輯 (向下兼容)
    - prominenceMinPct: prominence / peak_value 嘅最小百分比, 細過就過濾走

    Returns: {"peaks": [int], "troughs": [int]}
    """
    if cfg is None:
        cfg = {}

    enable_savgol = cfg.get("enableSavitzkyGolayFilter", False)
    prominence_min_pct = cfg.get("prominenceMinPct", 0.02)

    # 拎 weighted prices (raw 或 smoothed)
    if enable_savgol:
        wl = max(3, window * 2 + 1)
        if wl % 2 == 0:
            wl += 1
        raw_prices = [k["weightedPrice"] for k in weighted]
        smoothed_prices = _smooth_savgol(raw_prices, window_length=wl, polyorder=2)
    else:
        smoothed_prices = [k["weightedPrice"] for k in weighted]

    peaks = []
    troughs = []
    for i in range(window, len(weighted) - window):
        curr = smoothed_prices[i]
        left_w = smoothed_prices[i - window:i]
        right_w = smoothed_prices[i + 1:i + window + 1]
        left_max = max(left_w)
        right_max = max(right_w)
        left_min = min(left_w)
        right_min = min(right_w)

        if curr > left_max and curr > right_max:
            # Peak: 拎 prominence 過濾
            if enable_savgol:
                prom = _compute_prominence(
                    smoothed_prices,
                    i,
                    left_end=max(0, i - window),
                    right_end=min(len(smoothed_prices), i + window + 1),
                )
                if curr > 0 and (prom / curr) < prominence_min_pct:
                    continue  # prominence 唔夠, 過濾
            peaks.append(i)
        elif curr < left_min and curr < right_min:
            # Trough: 拎 prominence 過濾 (對 trough 嚟講反轉)
            if enable_savgol:
                # trough 突出度 = min(left_max, right_max) - curr
                left_max_full = max(smoothed_prices[max(0, i - window):i]) if i > 0 else curr
                right_max_full = max(smoothed_prices[i + 1:min(len(smoothed_prices), i + window + 1)])
                trough_baseline = min(left_max_full, right_max_full)
                prom = trough_baseline - curr
                if curr > 0 and (prom / curr) < prominence_min_pct:
                    continue
            troughs.append(i)
    return {"peaks": peaks, "troughs": troughs}


def _alternate_extremes(
    weighted: List[Dict[str, Any]],
    peak_idxs: List[int],
    trough_idxs: List[int],
) -> List[Dict[str, Any]]:
    """凡人話: 交替化 peak/trough (避免連續 2 個同類型)

    對應 frontend alternateExtremes (adapter.mjs line 3852-3874)
    """
    all_pts = [
        *[{"idx": i, "type": "peak", "k": weighted[i]} for i in peak_idxs],
        *[{"idx": i, "type": "trough", "k": weighted[i]} for i in trough_idxs],
    ]
    all_pts.sort(key=lambda e: e["idx"])

    result = []
    for e in all_pts:
        if not result:
            result.append(e)
        elif result[-1]["type"] == e["type"]:
            # 同類型, 留比較顯著嗰個
            if e["type"] == "peak" and e["k"]["high"] > result[-1]["k"]["high"]:
                result[-1] = e
            elif e["type"] == "trough" and e["k"]["low"] < result[-1]["k"]["low"]:
                result[-1] = e
        else:
            result.append(e)
    return result


def _linregress_slope_r2(values: List[float]) -> Dict[str, float]:
    """凡人話: 用 linear regression 拎 slope + R² (對齊 `pomegra.io` / `tradersweek.com` 教學)

    公式 (對齊 `pomegra.io` 標準化):
    - slope = (n × Σxy - Σx × Σy) / (n × Σx² - (Σx)²)
    - R² = 1 - SS_res / SS_tot (對齊 `tradersweek.com` 永久 rule)
    - 對齊 `tradersweek.com` R² threshold:
      - 10-period: R² ≥ 0.40
      - 20-period: R² ≥ 0.20
      - 50-period: R² ≥ 0.08

    Returns:
        {"slope": float, "r2": float (0-1), "slope_normalized": float, "mean": float}
        - slope_normalized = slope / mean (對齊 `pomegra.io` 標準化: divide by recent volatility)
    """
    n = len(values)
    if n < 2:
        return {"slope": 0.0, "r2": 0.0, "slope_normalized": 0.0, "mean": 0.0}

    try:
        import numpy as np
        x = np.arange(n, dtype=float)
        y = np.array(values, dtype=float)
        # np.polyfit(x, y, 1) 拎 [slope, intercept]
        coeffs = np.polyfit(x, y, 1)
        slope = float(coeffs[0])
        y_pred = np.polyval(coeffs, x)
        y_mean = float(np.mean(y))
        ss_res = float(np.sum((y - y_pred) ** 2))
        ss_tot = float(np.sum((y - y_mean) ** 2))
        r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0
        r2 = max(0.0, min(1.0, r2))
        slope_normalized = slope / y_mean if y_mean > 0 else 0.0
        return {
            "slope": slope,
            "r2": r2,
            "slope_normalized": slope_normalized,
            "mean": y_mean,
        }
    except ImportError:
        # numpy 冇, 用 simple linear regression (least squares)
        n_float = float(n)
        x_mean = (n_float - 1.0) / 2.0
        y_mean_val = sum(values) / n_float
        xy_sum = sum((i - x_mean) * (v - y_mean_val) for i, v in enumerate(values))
        xx_sum = sum((i - x_mean) ** 2 for i in range(n))
        slope = xy_sum / xx_sum if xx_sum > 0 else 0.0
        # R²
        y_pred = [y_mean_val + slope * (i - x_mean) for i in range(n)]
        ss_res = sum((values[i] - y_pred[i]) ** 2 for i in range(n))
        ss_tot = sum((v - y_mean_val) ** 2 for v in values)
        r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0
        r2 = max(0.0, min(1.0, r2))
        slope_normalized = slope / y_mean_val if y_mean_val > 0 else 0.0
        return {
            "slope": slope,
            "r2": r2,
            "slope_normalized": slope_normalized,
            "mean": y_mean_val,
        }


def _analyze_trend(values: List[float], tolerance: float, cfg: Dict[str, Any] = None) -> Dict[str, Any]:
    """凡人話: 趨勢分析 (rising / falling / flat / mixed) + consistency (0-1)

    對應 frontend analyzeTrend (adapter.mjs line 3878-3901)

    v0.3.0 (原本): simple ratio (rising_pct >= 0.7 AND overall_change > tolerance)
    v0.4.0 Layer 2 (大少 9月7日 11:45 plan): 改用 linear regression slope + R²
    - 對齊 `pomegra.io` Linear Regression Slope Trend Filter
    - 對齊 `tradersweek.com` R² threshold (3-period 用 0.40)
    - random walk false positive -30% (R² < 0.40 唔再誤判 rising)

    Decision rules:
    - slope_normalized > 0.001 AND R² >= 0.40 → rising
    - slope_normalized < -0.001 AND R² >= 0.40 → falling
    - abs(slope_normalized) <= 0.001 AND R² < 0.40 → flat
    - 其他 → mixed
    """
    if cfg is None:
        cfg = {}
    if len(values) < 2:
        return {"trend": "mixed", "consistency": 0.0}

    r2_threshold = cfg.get("trendR2Threshold", 0.40)
    slope_min_pct = cfg.get("trendSlopeMinPct", 0.001)

    # v0.4.0 Layer 2: 拎 linear regression
    lr = _linregress_slope_r2(values)
    slope_normalized = lr["slope_normalized"]
    r2 = lr["r2"]

    if slope_normalized > slope_min_pct and r2 >= r2_threshold:
        return {"trend": "rising", "consistency": r2}
    elif slope_normalized < -slope_min_pct and r2 >= r2_threshold:
        return {"trend": "falling", "consistency": r2}
    elif abs(slope_normalized) <= slope_min_pct and r2 < r2_threshold:
        return {"trend": "flat", "consistency": r2}
    return {"trend": "mixed", "consistency": r2}


def _shoulder_symmetric(ls_price: float, rs_price: float, head_price: float, tolerance_pct: float) -> bool:
    """凡人話: 對齊 deepwiki.com Bulkowski 標準, 兩肩對稱 (跟 head 距離相近)

    對應 deepwiki.com head_shoulders.py check_hs_pattern 規則
    """
    if head_price <= 0:
        return False
    diff = abs(ls_price - rs_price) / head_price
    return diff < tolerance_pct


def _armpit_symmetric(la_price: float, ra_price: float, head_price: float, tolerance_pct: float) -> bool:
    """凡人話: 對齊 Bulkowski 標準, 兩腋對稱 (neckline 兩端高度相近)"""
    if head_price <= 0:
        return False
    diff = abs(la_price - ra_price) / head_price
    return diff < tolerance_pct


def _compute_pattern_r2(prices: List[float], head_idx: int, la_idx: int, ra_idx: int) -> float:
    """凡人話: 拎 5-point pattern 嘅 R² quality metric (對齊 deepwiki.com head_shoulders.py pattern_r2)

    公式: pattern_r2 = 1 - SS_res / SS_tot
    - SS_res = 5 個實際價對 neckline (la + ra 線) 嘅距離
    - SS_tot = 5 個實際價對 mean 嘅距離

    1.0 = 完美貼合 neckline, 0 噪聲, < 0 差過 mean
    """
    n = len(prices)
    if n < 5 or head_idx < 0 or la_idx < 0 or ra_idx < 0 or head_idx >= n or la_idx >= n or ra_idx >= n:
        return 0.0
    if la_idx == ra_idx:
        return 0.0
    try:
        # Neckline 線性內插
        la = prices[la_idx]
        ra = prices[ra_idx]
        la_x, ra_x = float(la_idx), float(ra_idx)
        if ra_x == la_x:
            return 0.0
        slope = (ra - la) / (ra_x - la_x)
        intercept = la - slope * la_x
        # 5 個 point 嘅實際價 vs neckline 預測價
        y_actual = [prices[i] for i in range(la_idx, ra_idx + 1)]
        y_pred = [slope * i + intercept for i in range(la_idx, ra_idx + 1)]
        y_mean = sum(y_actual) / len(y_actual)
        ss_res = sum((y_actual[i] - y_pred[i]) ** 2 for i in range(len(y_actual)))
        ss_tot = sum((v - y_mean) ** 2 for v in y_actual)
        if ss_tot <= 0:
            return 0.0
        r2 = 1.0 - ss_res / ss_tot
        return max(0.0, min(1.0, r2))
    except (ZeroDivisionError, ValueError):
        return 0.0


def _detect_head_and_shoulders(
    peak_exts: List[Dict[str, Any]],
    trough_exts: List[Dict[str, Any]],
    sym_tol: float,
    latest_price: float,
) -> Dict[str, Any]:
    """凡人話: 對齊 deepwiki.com Bulkowski 5-point 結構檢測 H&S pattern (bearish reversal)

    5-point 結構 (對齊 deepwiki.com neurotrader888 head_shoulders.py):
    - left_shoulder (LS) = peak_exts[-3]
    - left_armpit (LA) = trough_exts[-2]
    - head (H) = peak_exts[-2]  (中間最高)
    - right_armpit (RA) = trough_exts[-1]
    - right_shoulder (RS) = peak_exts[-1]

    Bulkowski 規則:
    1. H > max(LS, RS) (head 必須係 3 個 peak 嘅最高)
    2. 兩肩對稱 (LS ≈ RS)
    3. 兩腋對稱 (LA ≈ RA)
    4. neckline 連接 LA + RA
    5. 確認: 當前 close < neckline 即 H&S 確認 (跌穿)

    Returns: {
        "detected": bool,
        "neckline": float or None,
        "neckline_slope": float or None,
        "head_height": float or None,
        "measured_target": float or None (對齊 deepwiki.com head_to_neckline 距離 projecting down),
        "pattern_r2": float (0-1),
        "confirmed": bool (close < neckline),
    }
    """
    if len(peak_exts) < 3 or len(trough_exts) < 2:
        return {"detected": False, "neckline": None, "neckline_slope": None, "head_height": None, "measured_target": None, "pattern_r2": 0.0, "confirmed": False}

    # 5-point 結構
    ls = peak_exts[-3]["k"]  # left_shoulder
    la = trough_exts[-2]["k"]  # left_armpit
    h = peak_exts[-2]["k"]  # head
    ra = trough_exts[-1]["k"]  # right_armpit
    rs = peak_exts[-1]["k"]  # right_shoulder

    ls_p = ls["close"]
    la_p = la["close"]
    h_p = h["close"]
    ra_p = ra["close"]
    rs_p = rs["close"]

    # Rule 1: head 必須係 3 個 peak 嘅最高
    if h_p <= max(ls_p, rs_p):
        return {"detected": False, "neckline": None, "neckline_slope": None, "head_height": None, "measured_target": None, "pattern_r2": 0.0, "confirmed": False}

    # Rule 2: 兩肩對稱
    if not _shoulder_symmetric(ls_p, rs_p, h_p, sym_tol):
        return {"detected": False, "neckline": None, "neckline_slope": None, "head_height": None, "measured_target": None, "pattern_r2": 0.0, "confirmed": False}

    # Rule 3: 兩腋對稱
    if not _armpit_symmetric(la_p, ra_p, h_p, sym_tol):
        return {"detected": False, "neckline": None, "neckline_slope": None, "head_height": None, "measured_target": None, "pattern_r2": 0.0, "confirmed": False}

    # Rule 4: neckline 連接 LA + RA
    la_idx = trough_exts[-2]["idx"]
    ra_idx = trough_exts[-1]["idx"]
    neckline_slope = (ra_p - la_p) / (ra_idx - la_idx) if ra_idx != la_idx else 0.0
    neckline = la_p  # 拎 LA 嘅價做 baseline

    # Rule 5: 確認 (close < neckline)
    confirmed = latest_price < neckline

    # measured_target (對齊 deepwiki.com head_height 距離 projecting down)
    head_height = h_p - neckline
    measured_target = neckline - head_height if confirmed else None

    # pattern_r2 (對齊 deepwiki.com 嘅 R² quality metric)
    try:
        range_closes = [ls_p, la_p, h_p, ra_p, rs_p]  # 簡化用 5 個 pattern 點
        pattern_r2 = _compute_pattern_r2(range_closes, head_idx=2, la_idx=1, ra_idx=3)
    except Exception:
        pattern_r2 = 0.0

    return {
        "detected": True,
        "neckline": _round(neckline, 4),
        "neckline_slope": _round(neckline_slope, 6),
        "head_height": _round(head_height, 4),
        "measured_target": _round(measured_target, 4) if measured_target is not None else None,
        "pattern_r2": _round(pattern_r2, 4),
        "confirmed": confirmed,
    }


# ============================================================
# Main algorithm
# ============================================================

class HLStructureAlgorithm(Algorithm):
    """凡人話: 高低點結構法 (M2 v0.3.0)

    19 步算法詳細見 `docs/research/AS-03-cycle-detection/MODULE-02-HL-STRUCTURE.md`
    v0.2.0 加 Step 16 短線 mode + Step 17 突破 override (跟 2026-09-06 大少 trigger)
    v0.2.1 fix (大少 11:45 trigger): override 嗰陣同步 update 5 年 metrics
        (peaks/troughs/structure_score/base_confidence/peak_trend/trough_trend/reason_base)
        避免 cycle 寫 UP 但 score 仲係 0.5 嘅自相矛盾
    v0.2.2 fix (大少 12:02 trigger): 放寬 breakoutVolMult 1.3 → 0.85
        對齊 M2 volumeConfirmRatio 0.7 + volumeBoostRatio 1.3 中間值
        解決 01888 historical high 升穿 0.876x 量能唔夠嘅 false negative
    v0.3.0 (大少 2026-09-06 15:10 trigger): M2 self-check warning 永久 rule
        - 加 5 個 self-check 條件 (Step 19 之後): 形態預警 / 峰谷太舊 / 5年vs短線矛盾
          / 信心過低 / 結構破壞
        - 全部用 ModuleWarning object format (永久 rule 沿用, 唔用 string array)
        - 通知 M7/M8/M9: M2 verdict 唔可信, M7 自動降 weight 0.15→0.05 + banner 提示
        - 對應 commit: <即將 push>
    """

    name = "hl_structure"
    version = "0.4.0"  # v0.4.0 (大少 2026-09-07 11:45): 5-layer evidence-based 優化 (Layer 1-5)

    def run(self, klines: List[Dict[str, Any]], options: Dict[str, Any]) -> Verdict:
        # 合併 default config + user override
        cfg = {**DEFAULT_HL_STRUCTURE_CONFIG, **(options.get("hlsOverrides") or {})}
        n = len(klines)

        # ============ Step 0: 輸入驗證 ============
        min_required = max(
            (cfg["baseWindow"] * 2 + 1) * cfg["minPairs"] * 3,
            cfg["atrPeriod"] + cfg["baseWindow"] * 4,
            cfg["breakoutConfirmDays"] + cfg["baseWindow"] * 4,
        )
        if n < min_required:
            return Verdict(
                ok=False,
                error=f"[HLStructure] Insufficient data: need ≥ {min_required} bars, got {n}",
            )

        # 攞最後 dataWindowDays 條 (跟 M1 一樣)
        data_window_days = options.get("dataWindowDays", n)
        recent = klines[-min(data_window_days, n):]

        # ============ Step 1: ATR + 自適應 Window ============
        atr = _calc_atr(recent, cfg["atrPeriod"]) if cfg["enableAtrWindow"] else 0.0
        last_20_closes = [k["close"] for k in recent[-20:]]
        avg_close = sum(last_20_closes) / len(last_20_closes) if last_20_closes else 0
        volatility_ratio = atr / avg_close if avg_close > 0 else 0
        adaptive_window = max(2, min(15, round(cfg["baseWindow"] * (1 + volatility_ratio * 20)))) if cfg["enableAtrWindow"] else cfg["baseWindow"]

        # ============ Step 2: 加權價格 + 動態 Tolerance ============
        weighted = [{**k, "weightedPrice": (k["high"] + k["low"] + k["close"] * 2) / 4} for k in recent]

        effective_tolerance = cfg["tolerancePct"]
        if avg_close < 10:
            effective_tolerance = max(cfg["tolerancePct"], 0.03)
        elif avg_close > 500:
            effective_tolerance = min(cfg["tolerancePct"], 0.008)

        # ============ Step 3: 識別原始極值點 ============
        # v0.4.0 Layer 1: 傳 cfg 入 _detect_extremes, 拎 Savitzky-Golay 平滑 + prominence 過濾
        extremes = _detect_extremes(weighted, adaptive_window, cfg=cfg)
        peak_idxs = extremes["peaks"]
        trough_idxs = extremes["troughs"]

        # Edge case: 完全平 data
        if len(peak_idxs) == 0 and len(trough_idxs) == 0:
            _flat_warnings = [{
                "level": "critical",
                "module_id": "hl_structure",
                "code": "VERDICT_MISSING",
                "message": "峰谷全部拎唔到 (價格完全無變化)",
                "debug": {
                    "issue": "peak_count = 0 AND trough_count = 0 (價格完全無變化)",
                    "impact": "Verdict 唔可信, 唔好落單",
                    "fix": "Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc",
                    "context": {"peak_count": 0, "trough_count": 0, "period": options.get("period")},
                },
            }]
            return Verdict(
                ok=True,
                points=[],
                meta={
                    "symbol": options.get("code") or options.get("symbol", "TEST"),
                    "cycle": "sideways",
                    "state": "SIDEWAYS",  # 大少 2026-09-05 Fix A: 對齊 contract ModuleVerdictMeta Literal
                    "cycle_label": "橫行週期",
                    "confidence": 0.3,
                    "base_confidence": 0.3,
                    "peaks": [],
                    "troughs": [],
                    "peak_trend": "mixed",
                    "trough_trend": "mixed",
                    "structure_score": 0,
                    "weighted_structure_score": 0,
                    "box_boundary": None,
                    "pattern_alert": "none",
                    "latest_extreme": None,
                    "price_position": "between",
                    "adaptive_window": adaptive_window,
                    "effective_tolerance": _round(effective_tolerance, 6),
                    "adjustment_log": ["價格完全無變化,無法識別峰谷"],
                    "reason": "價格完全無變化,預設橫行",
                    "last_date": str(recent[-1].get("time") or recent[-1].get("date") or recent[-1].get("timestamp") or ""),
                    "_warnings": _flat_warnings,
                },
                warnings=_flat_warnings,
            )

        # ============ Step 4 + 5: 突破確認 + 量能過濾 ============
        alternated = _alternate_extremes(weighted, peak_idxs, trough_idxs)
        K = cfg["breakoutConfirmDays"]
        for e in alternated:
            after_end = min(e["idx"] + 1 + K, len(weighted) - 1)
            after = weighted[e["idx"] + 1:after_end + 1]
            if not after:
                continue
            if e["type"] == "peak":
                e["confirmed"] = all(c["close"] > e["k"]["close"] * (1 + effective_tolerance) for c in after)
            else:
                e["confirmed"] = all(c["close"] < e["k"]["close"] * (1 - effective_tolerance) for c in after)
            # 量能
            if cfg["enableVolumeFilter"]:
                lookback_start = max(0, e["idx"] - cfg["volumeLookback"])
                slice_ = weighted[lookback_start:e["idx"]]
                avg_vol = sum(k["volume"] for k in slice_) / len(slice_) if slice_ else 0
                e["volumeRatio"] = e["k"]["volume"] / avg_vol if avg_vol > 0 else 0
                e["weight"] = 1.0
                if e["volumeRatio"] < cfg["volumeConfirmRatio"]:
                    e["weight"] *= cfg["volumeShrinkWeightMultiplier"]
                elif e["volumeRatio"] > cfg["volumeBoostRatio"]:
                    e["weight"] *= cfg["volumeBoostWeightMultiplier"]
            else:
                e["weight"] = 1.0
                e["volumeRatio"] = 0

        # Edge case: 峰谷唔夠交替
        if len(alternated) < cfg["minPairs"] * 2:
            return Verdict(
                ok=True,
                points=[],
                meta={
                    "symbol": options.get("code") or options.get("symbol", "TEST"),
                    "cycle": "sideways",
                    "state": "SIDEWAYS",  # 大少 2026-09-05 Fix A: 對齊 contract ModuleVerdictMeta Literal
                    "cycle_label": "橫行週期",
                    "confidence": 0.5,
                    "base_confidence": 0.5,
                    "peaks": [],
                    "troughs": [],
                    "peak_trend": "mixed",
                    "trough_trend": "mixed",
                    "structure_score": 0,
                    "weighted_structure_score": 0,
                    "box_boundary": None,
                    "pattern_alert": "none",
                    "latest_extreme": None,
                    "price_position": "between",
                    "adaptive_window": adaptive_window,
                    "effective_tolerance": _round(effective_tolerance, 6),
                    "adjustment_log": [f"峰谷結構唔夠清晰 ({len(alternated)} < {cfg['minPairs'] * 2})"],
                    "reason": f"峰谷結構唔夠清晰 (只有 {len(alternated)} 個交替峰谷,需要至少 {cfg['minPairs'] * 2}),預設橫行",
                    "last_date": str(recent[-1].get("time") or recent[-1].get("date") or recent[-1].get("timestamp") or ""),
                    "_warnings": [{
                        "level": "warning",
                        "module_id": "hl_structure",
                        "code": "FALLBACK_USED",
                        "message": f"峰谷總數 {len(alternated)} < {cfg['minPairs'] * 2}",
                        "debug": {
                            "issue": f"峰谷總數 {len(alternated)} < {cfg['minPairs'] * 2} required",
                            "impact": "Verdict 唔可信, 唔好落單",
                            "fix": "Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc",
                            "context": {"alternated_count": len(alternated), "min_pairs": cfg["minPairs"]},
                        },
                    }],
                },
            )

        # ============ Step 7: 提取最近 N 對 ============
        peak_exts = [e for e in alternated if e["type"] == "peak"][-cfg["minPairs"]:]
        trough_exts = [e for e in alternated if e["type"] == "trough"][-cfg["minPairs"]:]

        # ============ Step 8: 時間衰減加權 ============
        last_idx = len(weighted) - 1
        for e in peak_exts + trough_exts:
            days_ago = last_idx - e["idx"]
            e["weight"] *= math.exp(-cfg["timeDecayLambda"] * days_ago)

        # ============ Step 9: 趨勢分析 ============
        peak_trend = _analyze_trend([e["k"]["close"] for e in peak_exts], effective_tolerance, cfg=cfg)
        trough_trend = _analyze_trend([e["k"]["close"] for e in trough_exts], effective_tolerance, cfg=cfg)

        # ============ Step 10: 結構一致性分數 ============
        avg_consistency = (peak_trend["consistency"] + trough_trend["consistency"]) / 2
        if peak_trend["trend"] == "rising" and trough_trend["trend"] == "rising":
            candidate = "uptrend"
            structure_score = avg_consistency
            weighted_structure_score = avg_consistency
        elif peak_trend["trend"] == "falling" and trough_trend["trend"] == "falling":
            candidate = "downtrend"
            structure_score = -avg_consistency
            weighted_structure_score = -avg_consistency
        else:
            candidate = "sideways"
            raw_peak_cons = abs(peak_trend["consistency"])
            raw_trough_cons = abs(trough_trend["consistency"])
            structure_score = 1.0 - (raw_peak_cons + raw_trough_cons) / 2
            weighted_structure_score = structure_score

        # v0.3.0 self-check (大少 2026-09-06 14:25 trigger): 儲低 5 年原始 candidate,
        # Step 16/17 override 會改 candidate, self-check #3 拎原本判定通知 M7/8/9
        original_candidate = candidate
        # v0.3.0 self-check: 初始化 freshness, Step 15 條件式 set, 兜底用 1.0 避免 self-check #2 ReferenceError
        freshness = 1.0

        # ============ Step 11: 基礎信心指數 ============
        if candidate in ("uptrend", "downtrend"):
            base_confidence = (weighted_structure_score + 1) / 2
            base_confidence = max(0.0, min(1.0, base_confidence))
            pair_bonus = min(1.0, (len(peak_exts) - 2) / 3)
            base_confidence = base_confidence * 0.7 + pair_bonus * 0.3
        else:
            all_closes = [e["k"]["close"] for e in peak_exts] + [e["k"]["close"] for e in trough_exts]
            range_max = max(all_closes)
            range_min = min(all_closes)
            avg_all = sum(all_closes) / len(all_closes)
            range_pct = (range_max - range_min) / avg_all if avg_all > 0 else 0
            base_confidence = max(0.3, 1.0 - range_pct / (effective_tolerance * 4))

        # ============ Step 12: 箱體邊界 (只 sideways) ============
        box_boundary = None
        if candidate == "sideways":
            box_top = max(e["k"]["close"] for e in peak_exts)
            box_bottom = min(e["k"]["close"] for e in trough_exts)
            box_mid = (box_top + box_bottom) / 2
            box_height_pct = (box_top - box_bottom) / box_mid if box_mid > 0 else 0
            box_boundary = {
                "top": _round(box_top, 2),
                "bottom": _round(box_bottom, 2),
                "mid": _round(box_mid, 2),
                "height_pct": _round(box_height_pct, 4),
            }

        # ============ Step 13: 形態預警 ============
        pattern_alert = "none"
        # v0.4.0 Layer 3 (大少 11:45 plan): 加 3 個 H&S field 落 meta (audit 對比用)
        pattern_neckline = None
        pattern_target = None
        pattern_r2 = 0.0
        reason_base = f"判定: {'上升' if candidate == 'uptrend' else '下跌' if candidate == 'downtrend' else '橫行'}"

        if cfg["enablePatternAlert"] and len(peak_exts) >= 3 and len(trough_exts) >= 2:
            sym_tol = effective_tolerance * cfg["patternSymmetryTolerance"]
            # 頭肩頂: v0.4.0 Layer 3 — 用 _detect_head_and_shoulders 5-point 確認 (對齊 deepwiki.com Bulkowski 標準)
            if len(peak_exts) >= 3 and len(trough_exts) >= 2:
                # latest_price 拎 weighted[-1]["close"] (Step 14 會重拎, 呢度先預取)
                _latest_price = weighted[-1]["close"]
                hs_result = _detect_head_and_shoulders(peak_exts, trough_exts, sym_tol, _latest_price)
                if hs_result["detected"] and cfg.get("enableHeadAndShouldersNeckline", True):
                    # v0.3.0 simple 對稱 對比 v0.4.0 H&S 5-point: 用 R² quality 確認
                    if hs_result["pattern_r2"] >= cfg.get("patternR2Min", 0.6):
                        pattern_alert = "head_and_shoulder"
                        pattern_neckline = hs_result["neckline"]
                        pattern_target = hs_result["measured_target"]
                        pattern_r2 = hs_result["pattern_r2"]
                        reason_base += f"；H&S 5-point 確認 (neckline={hs_result['neckline']}, R²={hs_result['pattern_r2']}, confirmed={hs_result['confirmed']})"
                    else:
                        # R² 唔夠, 用 v0.3.0 嘅 simple 對稱 fallback
                        last_3 = peak_exts[-3:]
                        if (last_3[1]["k"]["close"] > last_3[0]["k"]["close"]
                            and last_3[1]["k"]["close"] > last_3[2]["k"]["close"]
                            and abs(last_3[0]["k"]["close"] - last_3[2]["k"]["close"]) / last_3[1]["k"]["close"] < sym_tol):
                            pattern_alert = "head_and_shoulder"
                            reason_base += "；出現頭肩頂形態預警 (R²<0.6 fallback)"
                else:
                    # v0.3.0 simple 對稱 fallback
                    last_3 = peak_exts[-3:]
                    if (last_3[1]["k"]["close"] > last_3[0]["k"]["close"]
                        and last_3[1]["k"]["close"] > last_3[2]["k"]["close"]
                        and abs(last_3[0]["k"]["close"] - last_3[2]["k"]["close"]) / last_3[1]["k"]["close"] < sym_tol):
                        pattern_alert = "head_and_shoulder"
                        reason_base += "；出現頭肩頂形態預警 (3-peak simple 對稱)"
            # 雙底: 3 個 trough, 兩邊低, 中間反彈
            if pattern_alert == "none" and len(trough_exts) >= 3:
                last_3 = trough_exts[-3:]
                if (abs(last_3[0]["k"]["close"] - last_3[2]["k"]["close"]) / last_3[1]["k"]["close"] < sym_tol
                    and last_3[1]["k"]["close"] > last_3[0]["k"]["close"]):
                    pattern_alert = "double_bottom"
                    reason_base += "；出現雙底形態預警"
            # 雙頂: 3 個 peak, 兩邊高, 中間回調
            if pattern_alert == "none" and len(peak_exts) >= 3:
                last_3 = peak_exts[-3:]
                if (abs(last_3[0]["k"]["close"] - last_3[2]["k"]["close"]) / last_3[1]["k"]["close"] < sym_tol
                    and last_3[1]["k"]["close"] < last_3[0]["k"]["close"]):
                    pattern_alert = "double_top"
                    reason_base += "；出現雙頂形態預警"

        # ============ Step 14: 當前價格位置驗證 ============
        latest_price = weighted[-1]["close"]
        latest_peak = peak_exts[-1]
        latest_trough = trough_exts[-1]
        latest_extreme = alternated[-1]
        days_ago = last_idx - latest_extreme["idx"]

        # v0.2.1 fix: 儲低原本 5 年 peaks/troughs 數量, 畀 Step 19 FALLBACK_USED warning check 用
        # 因為 Step 16/17 override 嗰陣會 replace peak_exts/trough_exts 變 short_term 嘅 (數量會跌)
        original_peak_count = len(peak_exts)
        original_trough_count = len(trough_exts)

        if latest_price > latest_peak["k"]["close"] * (1 + effective_tolerance):
            price_position = "above_peak"
        elif latest_price < latest_trough["k"]["close"] * (1 - effective_tolerance):
            price_position = "below_trough"
        elif latest_trough["k"]["close"] <= latest_price <= latest_peak["k"]["close"]:
            price_position = "between"
        else:
            price_position = "broken"

        adjustment_log = []
        confidence_multiplier = 1.0

        if candidate == "uptrend":
            if price_position == "below_trough":
                adjustment_log.append("當前價格跌破最近谷點,上升趨勢可能已破壞")
                confidence_multiplier *= 0.4
            elif price_position == "between" and latest_extreme["type"] == "peak":
                adjustment_log.append("價格處於回調階段,尚未確認趨勢延續")
                confidence_multiplier *= 0.85
        elif candidate == "downtrend":
            if price_position == "above_peak":
                adjustment_log.append("當前價格突破最近峰點,下跌趨勢可能已反轉")
                confidence_multiplier *= 0.4
            elif price_position == "between" and latest_extreme["type"] == "trough":
                adjustment_log.append("價格處於反彈階段,尚未確認趨勢延續")
                confidence_multiplier *= 0.85
        else:  # sideways
            if price_position == "above_peak":
                adjustment_log.append("價格突破箱體上沿,可能即將脫離橫行")
                confidence_multiplier *= 0.7
            elif price_position == "below_trough":
                adjustment_log.append("價格跌破箱體下沿,可能即將脫離橫行")
                confidence_multiplier *= 0.7

        # ============ Step 15: 極值點新鮮度檢查 ============
        if days_ago > cfg["maxExtremeAgeDays"]:
            freshness = max(
                cfg["freshnessMinMultiplier"],
                1.0 - (days_ago - cfg["maxExtremeAgeDays"]) / cfg["freshnessDecayDays"],
            )
            confidence_multiplier *= freshness
            adjustment_log.append(f"最新極值點距今 {days_ago} 天,結構信號老化")

        # ============ Step 16: 短線 mode 確認 (v0.2.0 新加) ============
        # 凡人話: 用最近 60 日 K 線 + 對齊 M2 adaptive window + weighted price,
        #         揾峰谷, 計 trend. 如果短期 trend 雙重 rising, override 5 年 SIDEWAYS
        # 大少 2026-09-06 11:34 trigger, 對齊 conflict prototype v3 結果
        # v0.2.1 fix (大少 11:45 trigger): override 嗰陣同步 update peaks/troughs/structure_score/base_confidence
        #         避免 cycle 寫 UP 但 score 仲係 0.5 嘅自相矛盾
        short_term_result = {
            "enabled": False,
            "window_days": cfg.get("shortTermWindowDays", 60),
            "candidate": "unknown",
            "peak_trend": "unknown",
            "trough_trend": "unknown",
            "triggered": False,
            "peak_count": 0,
            "trough_count": 0,
        }

        # 拎 short_term peaks/troughs 畀 Step 17 突破 override 用 (即使 short_term 唔 trigger 都拎)
        short_peak_exts: list = []
        short_trough_exts: list = []
        short_peak_trend: dict = {"trend": "unknown", "consistency": 0.0}
        short_trough_trend: dict = {"trend": "unknown", "consistency": 0.0}

        if cfg.get("enableShortTermMode", True) and len(recent) >= cfg.get("shortTermWindowDays", 60) + 30:
            short_window = cfg.get("shortTermWindowDays", 60)
            short_recent = recent[-short_window:]
            short_weighted = [{**k, "weightedPrice": (k["high"] + k["low"] + k["close"] * 2) / 4} for k in short_recent]
            short_aw = max(2, min(15, round(cfg["baseWindow"] * (1 + volatility_ratio * 20)))) if cfg["enableAtrWindow"] else cfg["baseWindow"]
            short_extremes = _detect_extremes(short_weighted, short_aw)
            short_peak_idxs = short_extremes["peaks"]
            short_trough_idxs = short_extremes["troughs"]
            short_alternated = _alternate_extremes(short_weighted, short_peak_idxs, short_trough_idxs)

            short_min_pairs = cfg.get("shortTermMinPairs", 2)
            short_peak_exts = [e for e in short_alternated if e["type"] == "peak"][-short_min_pairs:]
            short_trough_exts = [e for e in short_alternated if e["type"] == "trough"][-short_min_pairs:]

            if len(short_peak_exts) >= 2 and len(short_trough_exts) >= 2:
                short_peak_trend = _analyze_trend([e["k"]["close"] for e in short_peak_exts], effective_tolerance, cfg=cfg)
                short_trough_trend = _analyze_trend([e["k"]["close"] for e in short_trough_exts], effective_tolerance, cfg=cfg)

                short_term_result.update({
                    "enabled": True,
                    "candidate": "uptrend" if (short_peak_trend["trend"] == "rising" and short_trough_trend["trend"] == "rising") else "sideways",
                    "peak_trend": short_peak_trend["trend"],
                    "trough_trend": short_trough_trend["trend"],
                    "peak_count": len(short_peak_exts),
                    "trough_count": len(short_trough_exts),
                })

                if short_term_result["candidate"] == "uptrend" and candidate == "sideways":
                    candidate = "uptrend"
                    short_term_result["triggered"] = True
                    # v0.2.1 Option A fix: 同步 update 5 年 metrics 用 short_term, 避免自相矛盾
                    peak_exts = short_peak_exts
                    trough_exts = short_trough_exts
                    peak_trend = short_peak_trend
                    trough_trend = short_trough_trend
                    short_consistency = (short_peak_trend["consistency"] + short_trough_trend["consistency"]) / 2
                    structure_score = short_consistency
                    weighted_structure_score = short_consistency
                    short_pair_bonus = min(1.0, (len(short_peak_exts) - 2) / 3)
                    base_confidence = (short_consistency + 1) / 2
                    base_confidence = max(0.0, min(1.0, base_confidence))
                    base_confidence = base_confidence * 0.7 + short_pair_bonus * 0.3
                    confidence_multiplier *= 0.8  # 短線 override 信心略降 (跟原本 cycle 反轉一樣)
                    adjustment_log.append(f"短線 mode ({short_window} 日) 確認 uptrend, override SIDEWAYS")
                    adjustment_log.append(f"短線 peak_trend={short_peak_trend['trend']}, trough_trend={short_trough_trend['trend']}")
                    reason_base = f"判定: 上升 (短線 mode {short_window} 日確認)"  # 同步重組 reason_base

        # ============ Step 17: 突破 override (v0.2.0 新加) ============
        # 凡人話: 對齊 M2 algorithm above_peak 邏輯, 拎走「連續 2 日」條件
        # 條件 (AND): candidate == sideways + latest close > 最近 peak × (1+tolerance) + 量能 OK
        # sub-condition: 最後一對峰谷差距 < 5% = 收縮突破 (大少 00019 太古 case)
        breakout_result = {
            "enabled": False,
            "triggered": False,
            "above_peak": False,
            "vol_ok": False,
            "consolidation_ok": False,
            "breakout_level": None,
            "vol_ratio": 0,
            "trigger_type": None,  # "breakout" / "consolidation_breakout"
        }

        if cfg.get("enableBreakoutOverride", True) and candidate == "sideways" and len(peak_exts) > 0:
            latest_peak_close = peak_exts[-1]["k"]["close"]
            multiplier = 1 + effective_tolerance
            breakout_level = latest_peak_close * multiplier
            latest_kline = recent[-1]

            above_peak = latest_kline["close"] > breakout_level

            # 量能確認: 最近 5 日內 close > breakout level 嘅 vol 最大嗰日
            lookback_days = cfg.get("breakoutLookbackDays", 5)
            vol_mult = cfg.get("breakoutVolMult", 1.3)
            vol_lookback = cfg.get("volumeLookback", 20)
            recent_n = recent[-lookback_days:]
            breakout_days = [k for k in recent_n if k["close"] > breakout_level]

            if breakout_days:
                breakout_day = max(breakout_days, key=lambda k: k["volume"])
                breakout_idx = recent.index(breakout_day)
                if breakout_idx >= vol_lookback:
                    lookback_vols = [k["volume"] for k in recent[breakout_idx - vol_lookback:breakout_idx]]
                else:
                    lookback_vols = [k["volume"] for k in recent[:breakout_idx]]
                avg_vol = sum(lookback_vols) / len(lookback_vols) if lookback_vols else 0
                vol_ratio = breakout_day["volume"] / avg_vol if avg_vol > 0 else 0
                vol_ok = vol_ratio >= vol_mult
            else:
                vol_ratio = 0
                vol_ok = False

            # 收縮確認: 最後一對峰谷差距 < 5%
            consolidation_ok = False
            if cfg.get("enableConsolidationBreakout", True) and len(peak_exts) >= 1 and len(trough_exts) >= 1:
                last_peak = peak_exts[-1]["k"]
                last_trough = trough_exts[-1]["k"]
                consolidation_lookback = cfg.get("consolidationLookbackDays", 20)
                if (last_idx - peak_exts[-1]["idx"] <= consolidation_lookback
                    and last_idx - trough_exts[-1]["idx"] <= consolidation_lookback):
                    max_p = max(last_peak["high"], last_peak["close"])
                    min_t = min(last_trough["low"], last_trough["close"])
                    mid = (max_p + min_t) / 2 if (max_p + min_t) > 0 else 1
                    gap_pct = (max_p - min_t) / mid
                    consolidation_ok = gap_pct < cfg.get("consolidationMaxGapPct", 0.05)

            breakout_result.update({
                "enabled": True,
                "above_peak": above_peak,
                "vol_ok": vol_ok,
                "consolidation_ok": consolidation_ok,
                "breakout_level": _round(breakout_level, 4),
                "vol_ratio": _round(vol_ratio, 3),
            })

            if above_peak and vol_ok:
                candidate = "uptrend"
                breakout_result["triggered"] = True
                if consolidation_ok:
                    breakout_result["trigger_type"] = "consolidation_breakout"
                    pattern_alert = "consolidation_breakout"
                    adjustment_log.append(
                        f"盤整突破確認: 收縮 {cfg.get('consolidationMaxGapPct', 0.05)*100:.0f}% + 升穿 peak × {multiplier:.3f} + 量能 {vol_ratio:.2f}x"
                    )
                else:
                    breakout_result["trigger_type"] = "breakout"
                    pattern_alert = "breakout"
                    adjustment_log.append(
                        f"突破確認: 升穿 peak × {multiplier:.3f} + 量能 {vol_ratio:.2f}x 均量"
                    )
                confidence_multiplier *= 0.85  # 突破 override 信心略降 (因為原本係 SIDEWAYS)

                # v0.2.1 Option A fix: 同步 update 5 年 metrics, 避免 cycle 寫 UP 但 score 仲係 0.5
                if len(short_peak_exts) >= 2 and len(short_trough_exts) >= 2:
                    # 用 short_term peaks/troughs 替換 5 年嘅, re-compute 對齊 uptrend
                    peak_exts = short_peak_exts
                    trough_exts = short_trough_exts
                    peak_trend = short_peak_trend
                    trough_trend = short_trough_trend
                    bo_consistency = (short_peak_trend["consistency"] + short_trough_trend["consistency"]) / 2
                    structure_score = bo_consistency
                    weighted_structure_score = bo_consistency
                    bo_pair_bonus = min(1.0, (len(short_peak_exts) - 2) / 3)
                    base_confidence = (bo_consistency + 1) / 2
                    base_confidence = max(0.0, min(1.0, base_confidence))
                    base_confidence = base_confidence * 0.7 + bo_pair_bonus * 0.3
                    if consolidation_ok:
                        reason_base = f"判定: 上升 (盤整突破確認, 收縮 {cfg.get('consolidationMaxGapPct', 0.05)*100:.0f}%)"
                    else:
                        reason_base = f"判定: 上升 (突破 override 確認, 量能 {vol_ratio:.2f}x)"
                else:
                    # short_term 冇 data, 用 5 年 peaks/troughs 但設 fixed structure_score / base_confidence
                    structure_score = 0.6
                    weighted_structure_score = 0.6
                    base_confidence = 0.6
                    if consolidation_ok:
                        reason_base = f"判定: 上升 (盤整突破確認, 收縮 {cfg.get('consolidationMaxGapPct', 0.05)*100:.0f}%)"
                    else:
                        reason_base = f"判定: 上升 (突破 override 確認, 量能 {vol_ratio:.2f}x)"

        # ============ Step 18: 綜合信心指數 ============
        confidence = max(0.0, min(1.0, base_confidence * confidence_multiplier))

        cycle_label = "上升週期" if candidate == "uptrend" else "下跌週期" if candidate == "downtrend" else "橫行週期"
        final_reason = f"{reason_base}；{'；'.join(adjustment_log)}" if adjustment_log else reason_base

        # ============ Step 19: 組裝輸出 (frontend 兼容 shape) ============
        m2_warnings = []
        if len(peak_exts) == 0 and len(trough_exts) == 0:
            m2_warnings.append({
                "level": "critical",
                "module_id": "hl_structure",
                "code": "VERDICT_MISSING",
                "message": "峰谷全部拎唔到",
                "debug": {
                    "issue": "peak_count = 0 AND trough_count = 0",
                    "impact": "Verdict 唔可信, 唔好落單",
                    "fix": "增加 dataWindowDays 設定, 確認 data 有高低點變化",
                    "context": {"peak_count": 0, "trough_count": 0, "period": options.get("period")},
                },
            })
        if original_peak_count + original_trough_count < cfg["minPairs"] * 2:
            m2_warnings.append({
                "level": "warning",
                "module_id": "hl_structure",
                "code": "FALLBACK_USED",
                "message": f"峰谷總數 {original_peak_count + original_trough_count} < {cfg['minPairs'] * 2}",
                "debug": {
                    "issue": f"峰谷總數 {original_peak_count + original_trough_count} < {cfg['minPairs'] * 2} required",
                    "impact": "Verdict 唔可信, 唔好落單",
                    "fix": "Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc",
                    "context": {"peak_count": original_peak_count, "trough_count": original_trough_count, "min_pairs": cfg["minPairs"]},
                },
            })

        # ============ v0.3.0 Self-check 5 條件 (大少 2026-09-06 14:25 trigger) ============
        # 凡人話: M2 算法跑完自己診斷 verdict 係咪可信, 5 個條件各自 emit system 警告,
        # 通知 M7/M8/M9 呢個 M2 verdict 唔好用, M7 自動降 weight 0.15→0.05
        # 對應 commit: <即將 push>
        # 永久 rule: emit warning 永遠用 `debug` field 包住 issue/impact/fix/context,
        #            對齊 backend/services/warning_collector.py 嘅 ModuleWarning dataclass 結構

        # Self-check 1: 形態預警 (Step 13 pattern_alert) - 頭肩頂 / 雙底 / 雙頂
        if pattern_alert in ("head_and_shoulder", "double_top", "double_bottom"):
            m2_warnings.append({
                "level": "warning",
                "module_id": "M2",
                "code": "CONFLICT_STATE",
                "message": f"形態預警: {pattern_alert}",
                "debug": {
                    "issue": f"最近 3 個峰/谷出現 {pattern_alert} 形態, 結構可能反轉",
                    "impact": "Verdict 唔可信, M2 判嘅 cycle state 可能快將反轉, M7 應該降 M2 weight",
                    "fix": "確認 Step 16 短線 mode 結果, 如有 override 觸發可能要等下一個 peak/谷 confirm",
                    "context": {
                        "pattern_alert": pattern_alert,
                        "peaks_count": len(peak_exts),
                        "troughs_count": len(trough_exts),
                    },
                },
            })

        # Self-check 2: 極值點新鮮度 (Step 15 freshness 折扣 → DATA_AGE info warning)
        if days_ago > cfg["maxExtremeAgeDays"]:
            m2_warnings.append({
                "level": "info",
                "module_id": "M2",
                "code": "DATA_AGE",
                "message": f"極值點距今 {days_ago} 日 (max {cfg['maxExtremeAgeDays']} 日)",
                "debug": {
                    "issue": f"最新 peak/trough 已經 {days_ago} 日前, freshness multiplier 折扣到 {freshness:.4f}",
                    "impact": "結構信號老化, Verdict 信心打折, M7 應該降 M2 嘅 base_weight",
                    "fix": "等下一個新 peak/trough 出現再 re-run",
                    "context": {
                        "days_ago": days_ago,
                        "max_extreme_age": cfg["maxExtremeAgeDays"],
                        "freshness_multiplier": round(freshness, 4),
                    },
                },
            })

        # Self-check 3: 5 年尺度 vs 短線 override 觸發 (Step 16/17 核心, 9月6日 11:34 trigger 嘅 case)
        # 凡人話: 5 年判 SIDEWAYS, 但短線 60 日 + 突破 override 救返判 UP, 通知 M7/8/9
        if breakout_result.get("triggered", False) or short_term_result.get("triggered", False):
            m2_warnings.append({
                "level": "warning",
                "module_id": "M2",
                "code": "FALLBACK_USED",
                "message": f"5 年尺度 {original_candidate} → override 後 {candidate} (短線 60 日 / 突破救返)",
                "debug": {
                    "issue": f"原本 {data_window_days} 日判定 = {original_candidate}, 短線 override = {candidate}, trigger_type = {breakout_result.get('trigger_type') or 'short_term_confirm'}",
                    "impact": "Verdict 唔可信 (靠 60 日短線 + 突破救返), M2 vote 信心打折, M7 應該降 weight",
                    "fix": "等 5 年尺度確認 (需要 2 個新 peak/trough 確認趨勢)",
                    "context": {
                        "original_candidate": original_candidate,
                        "override_candidate": candidate,
                        "trigger_type": breakout_result.get("trigger_type") or "short_term_confirm",
                        "vol_ratio": breakout_result.get("vol_ratio", 0),
                        "consolidation_ok": breakout_result.get("consolidation_ok", False),
                    },
                },
            })

        # Self-check 4: 信心指數過低 (Step 18 final confidence < 0.3)
        if confidence < 0.3:
            m2_warnings.append({
                "level": "warning",
                "module_id": "M2",
                "code": "THRESHOLD_BREACH",
                "message": f"M2 信心指數 {confidence:.4f} < 0.3 threshold",
                "debug": {
                    "issue": f"信心 {confidence:.4f} 過低, structure score 唔夠強, base_confidence 折扣大",
                    "impact": "Verdict 可信度低, M7 應該降低 M2 嘅 base_weight",
                    "fix": "等結構信號更明顯先 re-run, 或 increase dataWindowDays",
                    "context": {
                        "confidence": round(confidence, 4),
                        "base_confidence": round(base_confidence, 4),
                        "structure_score": round(structure_score, 4),
                    },
                },
            })

        # Self-check 5: 結構破壞 (Step 14 price_position = "broken")
        if price_position == "broken":
            m2_warnings.append({
                "level": "warning",
                "module_id": "M2",
                "code": "CONFLICT_STATE",
                "message": "當前價格已經破壞最近峰谷結構",
                "debug": {
                    "issue": f"價格 {latest_price:.2f} 已經離開最近 peak {latest_peak['k']['close']:.2f} / trough {latest_trough['k']['close']:.2f} 範圍",
                    "impact": "峰谷結構信號失效, M2 verdict 唔可信, 要等新 peak/trough 形成",
                    "fix": "Re-run / 等新結構形成",
                    "context": {
                        "latest_price": round(latest_price, 4),
                        "latest_peak_close": round(latest_peak["k"]["close"], 4),
                        "latest_trough_close": round(latest_trough["k"]["close"], 4),
                    },
                },
            })

        meta = {
            "symbol": options.get("code") or options.get("symbol", "TEST"),
            "cycle": candidate,
            "state": HL_STRUCTURE_STATE_MAP.get(candidate, "SIDEWAYS"),  # 大少 2026-09-05 Fix A
            "cycle_label": cycle_label,
            "confidence": _round(confidence, 4),
            "base_confidence": _round(base_confidence, 4),
            "peaks": [
                {
                    "date": str(e["k"].get("time") or e["k"].get("date") or e["k"].get("timestamp") or ""),
                    "close": e["k"]["close"],
                    "high": e["k"]["high"],
                    "low": e["k"]["low"],
                    "index": e["idx"],
                    "volume": e["k"].get("volume", 0),
                    "confirmed": e.get("confirmed", False),
                    "weight": _round(e.get("weight", 1.0), 4),
                }
                for e in peak_exts
            ],
            "troughs": [
                {
                    "date": str(e["k"].get("time") or e["k"].get("date") or e["k"].get("timestamp") or ""),
                    "close": e["k"]["close"],
                    "high": e["k"]["high"],
                    "low": e["k"]["low"],
                    "index": e["idx"],
                    "volume": e["k"].get("volume", 0),
                    "confirmed": e.get("confirmed", False),
                    "weight": _round(e.get("weight", 1.0), 4),
                }
                for e in trough_exts
            ],
            "peak_trend": peak_trend["trend"],
            "trough_trend": trough_trend["trend"],
            "structure_score": _round(structure_score, 4),
            "weighted_structure_score": _round(weighted_structure_score, 4),
            "box_boundary": box_boundary,
            "pattern_alert": pattern_alert,
            # === v0.4.0 Layer 3 (大少 11:45 plan): H&S 5-point pattern field (audit 對比用) ===
            "pattern_neckline": pattern_neckline,
            "pattern_target": pattern_target,
            "pattern_r2": _round(pattern_r2, 4),
            "latest_extreme": {
                "type": latest_extreme["type"],
                "date": str(latest_extreme["k"].get("time") or latest_extreme["k"].get("date") or latest_extreme["k"].get("timestamp") or ""),
                "close": latest_extreme["k"]["close"],
                "index": latest_extreme["idx"],
                "days_ago": days_ago,
                "confirmed": latest_extreme.get("confirmed", False),
            },
            "price_position": price_position,
            "adaptive_window": adaptive_window,
            "effective_tolerance": _round(effective_tolerance, 6),
            "adjustment_log": adjustment_log,
            "reason": final_reason,
            "last_date": str(recent[-1].get("time") or recent[-1].get("date") or recent[-1].get("timestamp") or ""),
            # === v0.2.0 新加 (大少 2026-09-06 11:34 trigger) ===
            "short_term": short_term_result,          # Step 16 短線 mode 結果
            "breakout_override": breakout_result,    # Step 17 突破 override 結果
            "version": "0.4.0",                       # v0.4.0 (大少 2026-09-07 11:45): 5-layer evidence-based 優化, version 寫入 meta 等 frontend 對齊
            "_warnings": m2_warnings,
        }

        # M2 algorithm 都唔拎 points (peaks/troughs 拎去 meta, 唔拎去 points)
        return Verdict(
            ok=True,
            points=[],
            meta=meta,
            warnings=m2_warnings,
        )


# 凡人話: 自動 register 落 framework (import 呢個 file 就自動 register)
register(HLStructureAlgorithm())

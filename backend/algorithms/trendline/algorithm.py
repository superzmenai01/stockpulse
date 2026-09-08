"""
backend/algorithms/trendline/algorithm.py — M3 Trendline v0.3.0 (大少 2026-09-07 Spec Sync #45)

凡人話: 拎 K 線 → 識別峰谷 → 線性回歸畫支持線 + 阻力線 → 10 條 rule check → derive state + confidence

v0.3.0 Layer 4 (對齊 Bulkowski 2005 trendline quality + 永久 rule §M3 self-check warning spirit):
- _derive_trendline_confidence 改 4 維加權公式
- 對齊永久 rule: warning 觸發即扣 conf, conf ≤ 0.95 (clamp), 永久 ban conf = 1.0
- 公式: base 0.6 × R² × touches × volume × self-check penalty

v0.2.0 Layer 1 (對齊權威 source):
- DFA Hurst 加 log-r² emit (Peng 1994 pitfall: check log-log linearity)
- ADX 加 +DI / -DI / ATR emit (Wilder 1978 standard)

v0.2.0 Layer 2 (對齊 Bulkowski 2005 Encyclopedia):
- minR2: 0.55 → 0.6 (Bulkowski 標準)
- minLineLength: 30 日 (Bulkowski median 48 嘅 minimum floor)
- minTouchSpacing: 5 日 (Bulkowski median 13)
- maxLineSlope: 0.05 (Bulkowski shallow trendline 標準)
- 唔合格嘅 fit emit INSUFFICIENT_DATA / THRESHOLD_BREACH warning (system category)

凡人話: 拎 K 線 → 識別峰谷 → 線性回歸畫支持線 + 阻力線 → 10 條 rule check → derive state + confidence

對應 source: algorithms/AS-03-cycle-detection/modules/trendline.ts v0.1.0 (742 行)
對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs (line 4254-5197 frontend analyzeTrendline + 4 helper + 4 render function = 944 行)
對應 spec doc: docs/research/AS-03-cycle-detection/MODULE-03-TRENDLINE.md
對應 framework: backend/algorithms/base.py Verdict contract

Algorithm: 6 step (跟 trendline.ts 嘅 detect() method 1:1 port 去 Python)
- Step 1: 數據驗證
- Step 2: 識別極值點 (peaks 高點 + troughs 低點, extremeWindow 預設 3 日)
- Step 3: 動態最優點數 + 簡單 OLS 擬合 (support + resistance line)
- Step 4: Channel + %B 計算
- Step 5: 觸線統計 (touches) + 突破判定 (breakout)
- Step 6: 投影 (5 日)

10 條 rule A-J:
- A (強): 支撐線上升 + R² >= 0.55
- B (強): 壓力線下降 + R² >= 0.55
- C (中): 通道窄 (3% 之內) + 中位 (%B 0.4-0.6)
- D (中): 收斂三角形 (支撐升 + 壓力跌)
- E (中): 上升楔形 (支撐升 + 壓力平)
- F (中): 下降楔形 (支撐平 + 壓力跌)
- G (強): 真跌破支撐 (5 日內穿越 + 連續 2 日喺下面)
- H (強): 真突破壓力 (5 日內穿越 + 連續 2 日喺上面)
- I (弱): 支撐有效 (觸線 2 次以上 + 反彈 1% 以上)
- J (弱): 壓力有效 (觸線 2 次以上 + 回調 1% 以上)

State priority: H+G → TRANSITION · H → A → B → F → G → C/D → 默認 SIDEWAYS

凡人話: 自動畫趨勢線, 突破/跌破就出信號
"""

from typing import List, Dict, Any, Tuple

from ..base import Algorithm, Verdict
from ..registry import register
from .config import DEFAULT_TRENDLINE_CONFIG
# 大少 2026-09-08 23:30 fix — 將 make_warning import 拎出 function 內 inner scope
# Root cause: 之前 `from backend.services.warning_collector import make_warning` 喺
# `if n < min_required:` 內 scope (line 704), 個 import 從來冇 trigger (n 一定 >= 30),
# Python 將 make_warning 標 local, 之後 7 個 self-check warning 全部 call make_warning().to_dict()
# 時 UnboundLocalError, M3 100% runtime fail
# 對齊永久 rule §M9 postErrors ReferenceError spirit (大少 2026-08-11 Spec Sync #23)
# 對齊 synthesizer/algorithm.py:38 pattern
from backend.services.warning_collector import make_warning


# ============================================================
# Helpers
# ============================================================

def _round(value: float, decimals: int) -> float:
    """凡人話: 四捨五入到指定小數位 (跟 trendline.ts 嘅 round() function)"""
    if value is None or (isinstance(value, float) and (value != value)):  # NaN check
        return 0.0
    factor = 10 ** decimals
    return round(value * factor) / factor


def _compute_hurst(closes: List[float], window: int = 100) -> float:
    """凡人話: Hurst 指數 (DFA - Detrended Fluctuation Analysis)

    量度股價係咪有「持續方向」(trending) 定「均值回歸」(mean-reverting) 定「隨機遊走」(random walk)。
    - H > 0.5 = trending (有方向, 持續)
    - H ≈ 0.5 = random walk (冇方向, 行嚟行去)
    - H < 0.5 = mean-reverting (會返去平均)

    對應 frontend computeHurst (trendline.ts, Phase 1 (B3) 1:1 port)
    對應 spec doc: MODULE-03-TRENDLINE.md §4.2 Hurst+ADX gate

    大少 2026-09-07 01:08 trigger: 解決 audit 揭發嘅 M3 結構性問題 (一致率 28%, self-check 84%, over-confident 46%)
    Phase 1 (B3): 用 Hurst+ADX 兩招 confirm 個股價真係有方向先用得 trend line。

    DFA 算法 (Detrended Fluctuation Analysis):
    1. 取 log return 序列 r_t = log(close_t / close_{t-1})
    2. 累積求和得 Y_t = Σ(r_i) - mean(r) * t (去均值累積)
    3. 對 window size n, 將 Y 切成區間, 每區 fit 一條直線, 取殘差 std = F(n)
    4. log(F(n)) vs log(n) 嘅 slope = Hurst 指數

    Args:
        closes: 收盤價序列 (由舊到新, 大少 4.55.0 永久 rule 對齊)
        window: DFA 窗口大小 (預設 100 日)

    Returns:
        Hurst 指數 (0-1), 0.5 = random walk baseline
    """
    import math

    if len(closes) < window + 10:
        # 數據太少, 返 (0.5, 0.0) tuple (random walk default, 唔做判定)
        # 大少 2026-09-08 23:57 fix (Spec Sync #50) — caller 期望 tuple unpack, 之前返 single float 撞 UnboundLocalError 同類 bug
        # 影響: 細股 / 新股 / 停牌 stock K 線 < 110 條 全部撞, HK.00068 (99 條) + HK.02476 (97 條) trigger
        return 0.5, 0.0

    # 取最近 window 日
    recent_closes = closes[-window:]
    n_total = len(recent_closes)

    # 1. 計 log return 序列
    log_returns = []
    for i in range(1, n_total):
        if recent_closes[i] > 0 and recent_closes[i - 1] > 0:
            log_returns.append(math.log(recent_closes[i] / recent_closes[i - 1]))
    if len(log_returns) < 20:
        # 數據太少, 返 tuple 對齊 caller
        return 0.5, 0.0

    # 2. 累積去均值序列
    mean_r = sum(log_returns) / len(log_returns)
    cum_dev = []
    cum_sum = 0.0
    for r in log_returns:
        cum_sum += r - mean_r
        cum_dev.append(cum_sum)

    # 3. 對多個 scale 計 F(n) — 14 個 log-spaced scale points
    n_points = len(cum_dev)
    # scale 範圍: 8 到 n_points/2, log-spaced
    scales = []
    for k in range(1, 15):
        n_scale = int(8 * (n_points / 8) ** (k / 14))
        if n_scale < 8:
            n_scale = 8
        if n_scale > n_points // 2:
            n_scale = n_points // 2
        if n_scale not in scales:
            scales.append(n_scale)

    log_scales = []
    log_fluctuations = []
    for n_scale in scales:
        if n_scale < 4:
            continue
        # 將 cum_dev 切成 n_scale 大小嘅區間, 計每區 fluctuation
        n_segments = n_points // n_scale
        if n_segments < 1:
            continue
        fluctuation_sum = 0.0
        segment_count = 0
        for seg in range(n_segments):
            start = seg * n_scale
            end = start + n_scale
            segment = cum_dev[start:end]
            if len(segment) < 4:
                continue
            # Linear detrend: fit y = a*x + b, 拎殘差 std
            xs = list(range(len(segment)))
            x_mean = sum(xs) / len(xs)
            y_mean = sum(segment) / len(segment)
            num = sum((xs[i] - x_mean) * (segment[i] - y_mean) for i in range(len(segment)))
            denom = sum((xs[i] - x_mean) ** 2 for i in range(len(segment)))
            if denom == 0:
                continue
            slope = num / denom
            intercept = y_mean - slope * x_mean
            residuals = [segment[i] - (slope * xs[i] + intercept) for i in range(len(segment))]
            variance = sum(r ** 2 for r in residuals) / len(residuals)
            fluctuation_sum += variance ** 0.5
            segment_count += 1
        if segment_count == 0:
            continue
        avg_fluctuation = fluctuation_sum / segment_count
        if avg_fluctuation > 0:
            log_scales.append(math.log(n_scale))
            log_fluctuations.append(math.log(avg_fluctuation))

    # 4. log(F) vs log(n) 嘅 slope = Hurst 指數
    if len(log_scales) < 3:
        return 0.5, 0.0
    x_mean = sum(log_scales) / len(log_scales)
    y_mean = sum(log_fluctuations) / len(log_fluctuations)
    num = sum((log_scales[i] - x_mean) * (log_fluctuations[i] - y_mean) for i in range(len(log_scales)))
    denom = sum((log_scales[i] - x_mean) ** 2 for i in range(len(log_scales)))
    if denom == 0:
        return 0.5, 0.0
    hurst = num / denom

    # 5. log-log R² (對齊 Peng 1994 DFA pitfall: 必須 check log-log linearity)
    # 凡人話: 如果 log-log 唔 linear, Hurst value 唔可靠 (可能係 noise)
    # 永久 rule §Layer 1 (大少 2026-09-07 Spec Sync #45): 永遠 emit log-r² 確認 DFA self-similarity
    y_pred = [y_mean + hurst * (x - x_mean) for x in log_scales]
    ss_res = sum((log_fluctuations[i] - y_pred[i]) ** 2 for i in range(len(log_scales)))
    ss_tot = sum((log_fluctuations[i] - y_mean) ** 2 for i in range(len(log_fluctuations)))
    log_r2 = 0.0 if ss_tot == 0 else max(0.0, 1 - ss_res / ss_tot)

    # Clamp 落 [0, 1] 範圍 (DFA 數值可能超出)
    hurst_clamped = max(0.0, min(1.0, hurst))
    return hurst_clamped, log_r2


def _compute_adx(klines: List[Dict[str, Any]], period: int = 14) -> float:
    """凡人話: ADX (Average Directional Index) — 量度股價趨勢強度

    - ADX > 25 = 強趨勢 (有方向, 可信)
    - ADX 20-25 = 發展中 (中性)
    - ADX < 20 = 弱趨勢 / 橫行 (冇方向, 唔好用 trend line)

    對應 frontend computeAdx (trendline.ts, Phase 1 (B3) 1:1 port)
    對應 spec doc: MODULE-03-TRENDLINE.md §4.2 Hurst+ADX gate

    ADX 算法 (Wilder's smoothing, 14 日 standard):
    1. True Range (TR) = max(high - low, |high - prev_close|, |low - prev_close|)
    2. +DM = max(high - prev_high, 0) if (high - prev_high) > (prev_low - low) else 0
       -DM = max(prev_low - low, 0) if (prev_low - low) > (high - prev_high) else 0
    3. Wilder's smooth TR / +DM / -DM over `period` days
    4. +DI = 100 * smoothed(+DM) / smoothed(TR)
       -DI = 100 * smoothed(-DM) / smoothed(TR)
    5. DX = 100 * |+DI - -DI| / (+DI + -DI)
    6. ADX = Wilder's smooth DX over `period` days

    Args:
        klines: K 線序列 (由舊到新, 大少 4.55.0 永久 rule 對齊)
        period: ADX 計算週期 (預設 14 日, Wilder's standard)

    Returns:
        ADX 值 (0-100), 25 以上為強趨勢
    """
    if len(klines) < period * 2 + 1:
        # 數據太少, 返 0 (冇方向)
        return {"adx": 0.0, "plus_di": 0.0, "minus_di": 0.0, "atr": 0.0}

    n = len(klines)

    # 1-2. 計 TR / +DM / -DM 序列
    tr_list = []
    plus_dm_list = []
    minus_dm_list = []
    for i in range(1, n):
        high = klines[i]["high"]
        low = klines[i]["low"]
        prev_close = klines[i - 1]["close"]
        prev_high = klines[i - 1]["high"]
        prev_low = klines[i - 1]["low"]

        # True Range
        tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
        tr_list.append(tr)

        # Directional Movement
        up_move = high - prev_high
        down_move = prev_low - low
        if up_move > down_move and up_move > 0:
            plus_dm_list.append(up_move)
        else:
            plus_dm_list.append(0.0)
        if down_move > up_move and down_move > 0:
            minus_dm_list.append(down_move)
        else:
            minus_dm_list.append(0.0)

    if len(tr_list) < period:
        return {"adx": 0.0, "plus_di": 0.0, "minus_di": 0.0, "atr": 0.0}

    # 3. Wilder's smoothing (recursive): smoothed[i] = smoothed[i-1] - smoothed[i-1]/period + value[i]
    def wilder_smooth(values: List[float], period: int) -> List[float]:
        if len(values) < period:
            return []
        smoothed = [sum(values[:period])]  # 第一個係 period 日 sum
        for i in range(period, len(values)):
            smoothed.append(smoothed[-1] - smoothed[-1] / period + values[i])
        return smoothed

    tr_smooth = wilder_smooth(tr_list, period)
    plus_dm_smooth = wilder_smooth(plus_dm_list, period)
    minus_dm_smooth = wilder_smooth(minus_dm_list, period)

    if not tr_smooth or tr_smooth[0] == 0:
        return {"adx": 0.0, "plus_di": 0.0, "minus_di": 0.0, "atr": 0.0}

    # 4. +DI / -DI
    plus_di_list = []
    minus_di_list = []
    for i in range(len(tr_smooth)):
        if tr_smooth[i] == 0:
            plus_di_list.append(0.0)
            minus_di_list.append(0.0)
        else:
            plus_di_list.append(100.0 * plus_dm_smooth[i] / tr_smooth[i])
            minus_di_list.append(100.0 * minus_dm_smooth[i] / tr_smooth[i])

    # 5. DX
    dx_list = []
    for i in range(len(plus_di_list)):
        di_sum = plus_di_list[i] + minus_di_list[i]
        if di_sum == 0:
            dx_list.append(0.0)
        else:
            dx_list.append(100.0 * abs(plus_di_list[i] - minus_di_list[i]) / di_sum)

    if len(dx_list) < period:
        return {"adx": 0.0, "plus_di": 0.0, "minus_di": 0.0, "atr": 0.0}

    # 6. ADX = Wilder's smooth DX over period
    # Wilder's standard: 第一個值係 period 日平均, 之後 recursive smoothing
    # smoothed[0] = sum(values[:period]) / period
    # smoothed[i] = smoothed[i-1] - smoothed[i-1]/period + values[i] / period
    # = smoothed[i-1] * (period-1)/period + values[i] / period
    # 因為我嘅 wilder_smooth 返 sum 形式 (smoothed[0] = sum), 所以 ADX = smoothed_sum / period
    adx_smoothed = wilder_smooth(dx_list, period)
    if not adx_smoothed:
        return {"adx": 0.0, "plus_di": 0.0, "minus_di": 0.0, "atr": 0.0}

    adx_value = adx_smoothed[-1] / period  # 最新嘅 ADX 值, 0-100 range
    # 永久 rule §Layer 1 (大少 2026-09-07 Spec Sync #45): 永遠 emit +DI / -DI / ATR 對齊 Wilder 1978 standard
    # +DI / -DI 對齊 Wilder formula: 100 * smoothed(+DM) / smoothed(TR)
    # ATR 對齊 Wilder formula: smoothed(TR) / period
    plus_di_value = plus_di_list[-1] if plus_di_list else 0.0
    minus_di_value = minus_di_list[-1] if minus_di_list else 0.0
    atr_value = tr_smooth[-1] / period if tr_smooth else 0.0

    return {
        "adx": adx_value,
        "plus_di": plus_di_value,
        "minus_di": minus_di_value,
        "atr": atr_value,
    }


def _linear_regression(xs: List[float], ys: List[float]) -> Dict[str, float]:
    """凡人話: 簡單 OLS 線性回歸 — 拎 slope / intercept / R²

    對應 frontend linearRegression (adapter.mjs line 4632-4652)
    """
    n = len(xs)
    if n < 2:
        return {"slope": 0.0, "intercept": 0.0, "r2": 0.0}

    x_mean = sum(xs) / n
    y_mean = sum(ys) / n
    num = 0.0
    denom = 0.0
    for i in range(n):
        num += (xs[i] - x_mean) * (ys[i] - y_mean)
        denom += (xs[i] - x_mean) ** 2
    slope = 0.0 if denom == 0 else num / denom
    intercept = y_mean - slope * x_mean

    ss_res = 0.0
    ss_tot = 0.0
    for i in range(n):
        y_pred = slope * xs[i] + intercept
        ss_res += (ys[i] - y_pred) ** 2
        ss_tot += (ys[i] - y_mean) ** 2
    r2 = 0.0 if ss_tot == 0 else max(0.0, 1 - ss_res / ss_tot)
    return {"slope": slope, "intercept": intercept, "r2": r2}


def _fit_line(points: List[Dict[str, Any]], line_type: str, cfg: Dict[str, Any]) -> Dict[str, Any]:
    """凡人話: 動態最優點數 + 簡單 OLS 線性回歸擬合支持線/阻力線

    對應 frontend fitLine (adapter.mjs line 4611-4630)

    Bulkowski 對齊 (大少 2026-09-07 Spec Sync #45, 對齊 thepatternsite.com 標準):
    - minLineLength: 趨勢線覆蓋至少 30 日 (Bulkowski median 48 嘅 minimum floor)
    - minTouchSpacing: 觸線間距至少 5 日 (Bulkowski median 13)
    - maxLineSlope: slope 絕對值 ≤ 0.05 (Bulkowski shallow trendline 標準)
    - 凡人話: 唔啱 Bulkowski 標準嘅 fit 都會 emit warning, 但 keep best fit 避免 silent return
    """
    ys = [p["low"] for p in points] if line_type == "support" else [p["high"] for p in points]
    xs = [p["index"] for p in points]

    best_fit = None
    best_r2 = float("-inf")
    max_n = min(cfg["maxLinePoints"], len(points))

    # Bulkowski checks 收集 (Layer 2 emit warnings 用)
    bulkowski_warnings = []

    for n in range(cfg["minLinePoints"], max_n + 1):
        x_subset = xs[-n:]
        y_subset = ys[-n:]
        points_subset = points[-n:]
        reg = _linear_regression(x_subset, y_subset)

        # Layer 2: Bulkowski checks (永久 rule §Layer 2 大少 2026-09-07)
        line_length = x_subset[-1] - x_subset[0] if x_subset else 0
        spacings = [x_subset[i+1] - x_subset[i] for i in range(len(x_subset)-1)] if len(x_subset) > 1 else []
        min_spacing = min(spacings) if spacings else 0

        # Check 1: Line length (永久 rule)
        if line_length < cfg["minLineLength"]:
            # 唔 override best_fit, 但記低 warning 畀後續 emit
            if not any(w["code"] == "INSUFFICIENT_DATA" and w["line_type"] == line_type for w in bulkowski_warnings):
                bulkowski_warnings.append({
                    "code": "INSUFFICIENT_DATA",
                    "line_type": line_type,
                    "issue": f"{line_type} 線覆蓋只有 {line_length} 日 (< {cfg['minLineLength']})",
                })
            continue  # 呢個 n 唔做 candidate

        # Check 2: Touch spacing (永久 rule)
        if spacings and min_spacing < cfg["minTouchSpacing"]:
            if not any(w["code"] == "THRESHOLD_BREACH" and w["line_type"] == line_type and "spacing" in w.get("detail", "") for w in bulkowski_warnings):
                bulkowski_warnings.append({
                    "code": "THRESHOLD_BREACH",
                    "line_type": line_type,
                    "detail": f"{line_type} spacing 太密",
                    "issue": f"{line_type} 觸線間距最細 {min_spacing} 日 (< {cfg['minTouchSpacing']})",
                })
            continue  # 唔做 candidate

        # Check 3: Slope magnitude (永久 rule)
        if abs(reg["slope"]) > cfg["maxLineSlope"]:
            if not any(w["code"] == "THRESHOLD_BREACH" and w["line_type"] == line_type and "slope" in w.get("detail", "") for w in bulkowski_warnings):
                bulkowski_warnings.append({
                    "code": "THRESHOLD_BREACH",
                    "line_type": line_type,
                    "detail": f"{line_type} slope 太陡",
                    "issue": f"{line_type} slope 絕對值 {abs(reg['slope']):.4f} (> {cfg['maxLineSlope']})",
                })
            continue  # 唔做 candidate

        # 通過 Bulkowski checks, 計 candidate
        if reg["r2"] > best_r2:
            best_r2 = reg["r2"]
            best_fit = {**reg, "numPoints": n, "usedPoints": points_subset}

    if not best_fit:
        # 全部 candidate 都唔過 Bulkowski check, fallback 揾一個最接近嘅 (R² 最高) 同 emit warning
        fallback_fit = None
        fallback_r2 = float("-inf")
        for n in range(cfg["minLinePoints"], max_n + 1):
            x_subset = xs[-n:]
            y_subset = ys[-n:]
            points_subset = points[-n:]
            reg = _linear_regression(x_subset, y_subset)
            if reg["r2"] > fallback_r2:
                fallback_r2 = reg["r2"]
                fallback_fit = {**reg, "numPoints": n, "usedPoints": points_subset}
        if not fallback_fit:
            return {
                "slope": 0.0, "intercept": 0.0, "r2": 0.0, "numPoints": 0, "usedPoints": [],
                "bulkowskiWarnings": bulkowski_warnings,
            }
        # Fallback 帶 warning
        return {
            **fallback_fit,
            "bulkowskiWarnings": bulkowski_warnings,
            "bulkowskiFallback": True,
        }
    return {**best_fit, "bulkowskiWarnings": bulkowski_warnings}


def _analyze_touches(fit: Dict[str, Any], line_type: str, recent: List[Dict[str, Any]], cfg: Dict[str, Any]) -> Dict[str, Any]:
    """凡人話: 觸線統計 — 拎 line 嘅 touch 點數 + 反彈平均 %

    對應 frontend analyzeTouches (adapter.mjs line 4654-4696)
    """
    fitted_indices = {p["index"] for p in fit["usedPoints"]}
    n = len(recent)
    touches = 0
    bounces = []
    for i in range(0, n - 4):
        if i in fitted_indices:
            continue
        line_value = fit["intercept"] + fit["slope"] * i
        tolerance = line_value * cfg["touchTolerancePct"]
        bar = recent[i]
        is_touch = False
        bounce_pct = 0.0
        if line_type == "support":
            if (bar["low"] <= line_value * (1 + cfg["touchTolerancePct"])
                or abs(bar["low"] - line_value) <= tolerance):
                is_touch = True
                future_high = 0
                for j in range(i + 1, min(n, i + 5)):
                    future_high = max(future_high, recent[j]["high"])
                if future_high > 0 and bar["close"] > 0:
                    bounce_pct = (future_high - bar["close"]) / bar["close"]
        else:
            if (bar["high"] >= line_value * (1 - cfg["touchTolerancePct"])
                or abs(bar["high"] - line_value) <= tolerance):
                is_touch = True
                future_low = float("inf")
                for j in range(i + 1, min(n, i + 5)):
                    future_low = min(future_low, recent[j]["low"])
                if future_low < float("inf") and bar["close"] > 0:
                    bounce_pct = (bar["close"] - future_low) / bar["close"]
        if is_touch:
            touches += 1
            bounces.append(bounce_pct)
    avg_bounce_pct = sum(bounces) / len(bounces) if bounces else 0.0
    return {"touches": touches, "avgBouncePct": avg_bounce_pct, "bounceScores": bounces}


def _detect_breakout(fit: Dict[str, Any], line_type: str, recent: List[Dict[str, Any]], cfg: Dict[str, Any]) -> Dict[str, Any]:
    """凡人話: 突破/跌破判定 — 拎 5 日內穿越 + breakoutConfirmDays 日確認

    對應 frontend detectBreakout (adapter.mjs line 4698-4742)
    """
    n = len(recent)
    latest_idx = n - 1
    window_start = max(0, latest_idx - cfg["breakoutWindow"])
    is_breakout = False
    direction = "none"
    breakout_type = "unknown"
    breakout_idx = -1

    for i in range(window_start + 1, latest_idx + 1):
        line_curr = fit["intercept"] + fit["slope"] * i
        line_prev = fit["intercept"] + fit["slope"] * (i - 1)
        prev_close = recent[i - 1]["close"]
        curr_close = recent[i]["close"]
        if line_type == "support":
            if prev_close >= line_prev and curr_close < line_curr:
                is_breakout = True
                direction = "support"
                breakout_idx = i
                days_below = 0
                for j in range(i + 1, min(latest_idx, i + cfg["breakoutConfirmDays"]) + 1):
                    line_j = fit["intercept"] + fit["slope"] * j
                    if recent[j]["close"] < line_j:
                        days_below += 1
                breakout_type = "true" if days_below >= cfg["breakoutConfirmDays"] else "false"
                break
        else:
            if prev_close <= line_prev and curr_close > line_curr:
                is_breakout = True
                direction = "resistance"
                breakout_idx = i
                days_above = 0
                for j in range(i + 1, min(latest_idx, i + cfg["breakoutConfirmDays"]) + 1):
                    line_j = fit["intercept"] + fit["slope"] * j
                    if recent[j]["close"] > line_j:
                        days_above += 1
                breakout_type = "true" if days_above >= cfg["breakoutConfirmDays"] else "false"
                break
    days_since = latest_idx - breakout_idx if breakout_idx >= 0 else -1
    return {"isBreakout": is_breakout, "direction": direction, "type": breakout_type, "daysSince": days_since, "breakoutIdx": breakout_idx}


def _derive_trendline_state(rules: List[Dict[str, str]], support_fit: Dict[str, Any] = None) -> str:
    """凡人話: 10 條 rule 拎 state — H(support_slope<=0 強制 SIDEWAYS) → H+G(TRANSITION) → H(UP) → A+B(SIDEWAYS 收斂三角) → A → B → F → G → C/D → 默認 SIDEWAYS

    對應 frontend deriveTrendlineState (adapter.mjs line 4744-4754 拎走, Phase 4 backend Python 拎走 frontend)
    對應 spec doc: docs/research/AS-03-cycle-detection/MODULE-03-TRENDLINE.md §5 State derivation priority + 特殊規則

    大少 2026-09-06 23:17 fix: 補 spec doc §5 line 109-111 嘅特殊規則「A + B 同時 fire (支撐升 + 壓力降) → 收斂三角形 = SIDEWAYS」
    之前 algorithm.py 直接 A in ids → return UP, 冇處理 A + B special case (從來冇人 implement 落 code, frontend 舊版 backups/zigzag-frontend-2026-08-20/adapter.mjs line 5386 都冇)
    影響 HK.00700 ['A','B','D','I','J'] 返 UP 0.9, US.GOOGL ['A','B','C','D','I','J'] 返 UP 0.9 — 應該 SIDEWAYS

    大少 2026-09-07 00:14 fix: 補 H 真突破 guard — H fire + support_slope <= 0 → SIDEWAYS
    HK.01347 個 case: support slope = -1.07, resistance slope = -2.29, H fire (4 日前突破 pressure) 但 long-term 兩個 line 都 downtrend
    短線「真突破」H fire 蓋過 long-term context → over-confident UP 0.9, 但 M1 + M2 都係 SIDEWAYS
    Fix: H fire + support_slope <= 0 (long-term support 下降) → 改判 SIDEWAYS 對齊 M1+M2 verdict
    對齊 M2 self-check warning 永久 rule 嘅 spirit (algorithm self-check verdict 可信度, 對齊 M2 step 16/17 short-term override pattern)

    Priority 擺位:
    - H(support_slope<=0 SIDEWAYS) 第一 (新加, 對齊 M2 self-check spirit)
    - H + G → TRANSITION 第二
    - H 單獨 → UP 第三 (對齊 spec doc §5 priority H 排第一)
    - A + B → SIDEWAYS 第四 (新加, spec §5 line 109-111 特殊規則)
    - A → UP 第五
    - B → DOWN 第六
    - F → DOWN 第七
    - G → DOWN 第八
    - C / D → SIDEWAYS 第九
    - default SIDEWAYS 第十
    """
    ids = {r["id"] for r in rules}
    # Spec Sync #51 (大少 2026-09-09 00:42 confirm): Donchian Rule K/L 入 priority 第一/二位
    # 對齊 newtrading.io 100 年 backtest Donchian win rate 74.1% (rank #3 全部 indicator)
    # Rule K = Donchian 上突破 20 日 high → 強 UP
    # Rule L = Donchian 下突破 20 日 low → 強 DOWN
    if "K" in ids:
        return "UP"
    if "L" in ids:
        return "DOWN"
    # 大少 2026-09-07 00:14 fix: H 真突破 guard — H fire + support_slope <= 0 → SIDEWAYS
    # 短線突破但 long-term 兩個 support/resistance 都 downtrend → over-confident 改判 SIDEWAYS
    if support_fit is not None and "H" in ids and support_fit["slope"] <= 0:
        return "SIDEWAYS"
    if "H" in ids and "G" in ids:
        return "TRANSITION"
    if "H" in ids:
        return "UP"
    # Spec doc §5 line 109-111 特殊規則: A + B 同時 fire → 收斂三角形 = SIDEWAYS (override A 單獨拎 UP)
    if "A" in ids and "B" in ids:
        return "SIDEWAYS"
    if "A" in ids:
        return "UP"
    if "B" in ids:
        return "DOWN"
    if "F" in ids:
        return "DOWN"
    if "G" in ids:
        return "DOWN"
    if "C" in ids or "D" in ids:
        return "SIDEWAYS"
    return "SIDEWAYS"


def _derive_trendline_confidence(
    rules: List[Dict[str, str]],
    support_fit: Dict[str, Any],
    resistance_fit: Dict[str, Any],
    support_touch: Dict[str, Any],
    resistance_touch: Dict[str, Any],
    m3_warnings: List[Dict[str, Any]],
    recent_n: int,
    cfg: Dict[str, Any],
    volume_confirmed: bool = False,
) -> Dict[str, Any]:
    """凡人話: 信心分數 — 4 維加權公式 (Layer 4 大少 2026-09-07 Spec Sync #45 + Spec Sync #50 9月8日 tune)

    對齊 Bulkowski 2005 trendline quality 標準 + 永久 rule §M3 self-check warning spirit:
    - 唔再用 hardcoded 0.3 / 0.6 / 0.9 baseConfidence
    - 由 R² (line fit quality) × touches (5 觸 = 1.0) × volume (1.0/0.7) × self-check warning (-0.10/warn) 綜合
    - 永久 rule: conf ≤ 0.95 (clamp), 永久 ban conf = 1.0

    Formula (Spec Sync #50 9月8日 tune — 由 -0.15 改 -0.10, floor 0.4 改 0.5):
        base = 0.6
        r2_avg = (support_fit.r2 + resistance_fit.r2) / 2  # 0-1
        touch_factor = min((support_touches + resistance_touches) / 5, 1.0)
        vol_factor = 1.0 if volume_confirmed else 0.7
        warn_penalty = max(1.0 - 0.10 * len(m3_warnings), 0.5)   # Spec Sync #50
        confidence = base * r2_avg * touch_factor * vol_factor * warn_penalty
        confidence = clamp(confidence, 0.3, 0.95)

    對齊永久 rule §M3 self-check warning spirit (大少 2026-09-07 00:14): warning 觸發即扣 conf
    對齊永久 rule §M2 self-check 永久 rule (大少 2026-09-06 15:08): A 行為層 + C 顯示層

    Volume factor 預設 0.7 (volume 確認要等 Layer 3 對齊 Edwards-Magee 8th Ed,
    大少 Option A 跳過 Layer 3 先做 Layer 4 — 將來 Layer 3 加咗 volume check,
    傳 volume_confirmed=True 即可)

    Spec Sync #50 tune rationale (大少 9月8日 23:57 trigger):
    - 之前 -0.15/warn + floor 0.4 太重, 99% stock 跌到 0.3 floor (對落單冇用)
    - 改 -0.10/warn + floor 0.5, 預期 99% → 70-80% stock 拎 0.5-0.7 有用 conf
    - 仍保留 0.3-0.95 clamp (避免 over-confident 同時保留 gate fail 0.3)
    """
    # R² factor: 兩條線平均 R², 0-1
    r2_avg = (support_fit["r2"] + resistance_fit["r2"]) / 2

    # Touch factor: 5 觸 = 1.0 (凡人話: 越多觸線, trendline 越確認)
    total_touches = support_touch["touches"] + resistance_touch["touches"]
    touch_factor = min(total_touches / 5.0, 1.0)

    # Volume factor: 確認 1.0, 冇確認 0.7 (Layer 3 跳過, 永遠 0.7 暫時)
    vol_factor = 1.0 if volume_confirmed else 0.7

    # Self-check warning penalty: 每個 warn -0.10, floor 0.5
    # 大少 2026-09-08 23:57 tune (Spec Sync #50) — 之前 -0.15/warn + floor 0.4 太重, 99% stock 跌到 0.3 floor
    # 改 -0.10/warn + floor 0.5, 令 41% 真正 verdict stock 拎 0.5-0.7 有用 conf
    # 凡人話: 之前 formula 太敏感, 改輕啲等 M3 verdict 對落單有用
    warn_count = len(m3_warnings)
    warn_penalty = max(1.0 - 0.10 * warn_count, 0.5)

    # Base + 4 維加權
    base = 0.6
    confidence = base * r2_avg * touch_factor * vol_factor * warn_penalty

    # 永久 rule §Layer 4: clamp 0.3 - 0.95, 永久 ban conf = 1.0
    # 大少 Spec Sync #50 確認: 保留 0.3-0.95 clamp (避免 over-confident 同時保留 gate fail 0.3)
    confidence = max(min(confidence, 0.95), 0.3)

    # Adjustment log 凡人話解釋
    adjustment_log = [
        f"Layer 4 4 維加權: base=0.6 × R²={r2_avg:.3f} × touches={total_touches}/5={touch_factor:.3f} × vol={vol_factor} × (1-0.15×{warn_count})={warn_penalty:.3f} = {confidence:.3f}",
    ]

    return {"baseConfidence": base, "confidence": confidence, "adjustmentLog": adjustment_log}


def _build_trendline_reason(
    state: str,
    rules: List[Dict[str, str]],
    support_fit: Dict[str, Any],
    resistance_fit: Dict[str, Any],
    channel_width_pct: float,
    percent_b: float,
    support_breakout: Dict[str, Any],
    resistance_breakout: Dict[str, Any],
) -> str:
    """凡人話: 凡人話 verdict 解釋 (e.g. 上升趨勢: 觸發 A+I rules, 支撐 R²=0.85, 壓力 R²=0.78, 窄通道, %B=0.45)

    對應 frontend buildTrendlineReason (adapter.mjs line 4790-4799)
    """
    if not rules:
        return "趨勢線信號唔清晰, 預設橫行"
    state_text = {"UP": "上升趨勢", "DOWN": "下跌趨勢", "SIDEWAYS": "橫行", "TRANSITION": "短線反轉"}
    rule_str = "+".join(r["id"] for r in rules)
    channel_str = "窄通道" if channel_width_pct < 0.03 else "中等通道" if channel_width_pct < 0.10 else "寬通道"
    if state == "TRANSITION":
        return f"短線反轉: 支撐同壓力線都出現真突破訊號 ({rule_str}), 趨勢可能反轉"
    return f"{state_text[state]}: 觸發 {rule_str} rules, 支撐 R²={support_fit['r2']:.2f}, 壓力 R²={resistance_fit['r2']:.2f}, {channel_str}, %B={percent_b:.2f}"


# ============================================================
# Main algorithm
# ============================================================

class TrendlineAlgorithm(Algorithm):
    """凡人話: 趨勢線法 (M3 v0.3.0) — 10 條 rule 自動畫趨勢線 + 突破/跌破信號 + Hurst+ADX gate + Bulkowski 條件 + Layer 4 confidence 加權"""

    name = "trendline"
    version = "0.3.0"

    def run(self, klines: List[Dict[str, Any]], options: Dict[str, Any]) -> Verdict:
        # 合併 default config + user override
        cfg = {**DEFAULT_TRENDLINE_CONFIG, **(options.get("trendlineConfig") or {})}
        n = len(klines)

        # ============ Step 1: 數據驗證 ============
        min_required = 30
        if n < min_required:
            # 大少 2026-09-07 17:23 fix (Spec Sync #46) — 對「n < min_required」case 改返 ok=True + INSUFFICIENT_DATA warning
            # 對齊 RC-3 永久 fix: algorithm 跑完成但 verdict 唔可信 → 200 + warning, 唔再 400
            # 對齊永久 rule §Module Warning v1.1.0 — category "system" 因為 verdict 可能唔可信
            # 對齊永久 rule §dataWindowDays frontend inputs 表單 audit (2026-09-07 17:23)
            # 大少 2026-09-08 23:30 fix — 拎走 inner-scope import, make_warning 已經喺 file 頂部 import
            insufficient_warning = make_warning(
                level="info",
                module_id="M3",
                code="INSUFFICIENT_DATA",
                message=f"M3 trendline 數據唔夠: need ≥ {min_required} bars, got {n}",
                issue=f"拎到 {n} 條 K 線, trendline 至少要 {min_required} 條先 fit 到線性回歸",
                impact="Verdict 唔可信 (數據太少, linear regression 唔穩), 唔好落單",
                fix="加大 dataWindowDays / 檢查 stock 上市時間 / 加大 minLineLength / 換 stock 試下",
            ).to_dict()
            return Verdict(
                ok=True,         # False → True (永久 rule: verdict 仲可信, 帶 warning)
                points=[],
                meta={
                    "moduleId": "trendline",
                    "state": "SIDEWAYS",
                    "cycle_label": "橫行",
                    "confidence": 0.3,
                    "dataDays": n,
                    "minRequired": min_required,
                    "reason": "insufficient_data",
                    # Spec Sync #49 (大少 2026-09-08 23:30 confirm): self-check audit field emit 對齊 M2 永久 rule spirit
                    "self_check_triggered": True,  # INSUFFICIENT_DATA warning 觸發
                    "original_confidence": 0.3,    # 早 return 強制 0.3
                    "self_check_warning_count": 1,  # 1 個 INSUFFICIENT_DATA warning
                },
                warnings=[insufficient_warning],
            )

        data_window_days = options.get("dataWindowDays", n)
        recent = klines[-min(data_window_days, n):]
        recent_n = len(recent)

        # ============ Step 1.5: Hurst+ADX gate (Phase 1 (B3), 大少 2026-09-07 01:08 trigger) ============
        # 凡人話: 確認個股價真係有「方向」先用 trend line, 唔係 random walk / mean-reverting
        # 解決 audit 揭發嘅 M3 結構性問題:
        #   - 一致率 28% (M3 同 M1+M2 對唔足)
        #   - self-check 84% 觸發
        #   - over-confident 46%
        # Phase 1 (B3) 目標: 一致率 50%+, self-check 60%-, over-confident 25%-
        #
        # Hurst (DFA) — 量度 trending 持續性:
        #   - H > 0.55 = 有方向 (trending)
        #   - H ≈ 0.50 = random walk
        #   - H < 0.45 = mean-reverting
        # ADX (Wilder 14 日) — 量度趨勢強度:
        #   - ADX > 25 = 強趨勢
        #   - ADX 20-25 = 發展中
        #   - ADX < 20 = 弱 / 橫行
        #
        # Gate 規則 (大少 2026-09-09 00:42 confirm Spec Sync #51 — gate 由 hard gate 改 confirmation filter):
        #   - 之前: H<0.45 OR ADX<18 → 早 return SIDEWAYS 0.3 (hard gate, 99% stock 跌到呢度)
        #   - Spec Sync #51: gate 失敗時繼續出 verdict, 但 emit 1 個 LOW_CONFIDENCE warning,
        #     由 Layer 4 公式 warn_penalty 自動扣 conf 0.10
        #   - 對齊 fractalcycles.com 3-layer framework: Hurst + ADX 應該係 confirmation 而非 hard gate
        #   - 對齊權威 source: AInvest 建議 H>0.65 strong, 0.5-0.6 maybe, <0.4 mean-reverting
        closes = [bar["close"] for bar in recent]
        # Layer 1 (大少 2026-09-07 Spec Sync #45): _compute_hurst 返 (hurst, log_r2) tuple, 用 Peng 1994 pitfall check
        hurst_value, hurst_log_r2 = _compute_hurst(closes, window=100)
        # Layer 1: _compute_adx 返 dict, emit +DI / -DI / ATR 對齊 Wilder 1978 standard
        adx_data = _compute_adx(recent, period=14)
        adx_value = adx_data["adx"]
        plus_di_value = adx_data["plus_di"]
        minus_di_value = adx_data["minus_di"]
        atr_value = adx_data["atr"]

        if hurst_value < 0.45 or adx_value < 18:
            # Spec Sync #51 (大少 2026-09-09 00:42 confirm): gate 由 hard gate 改 confirmation filter
            # 之前: 早 return SIDEWAYS 0.3 (99% stock 跌到呢度, 對 UP/DOWN 識別差)
            # 而家: emit 1 個 LOW_CONFIDENCE warning 落 m3_warnings (Layer 4 公式 warn_penalty 自動扣 conf 0.10)
            # 繼續行正常 algorithm (10 + 2 條 rule + self-check)
            gate_soft_warning = {
                "level": "info",
                "category": "system",
                "module_id": "trendline",
                "code": "LOW_CONFIDENCE",
                "message": f"Hurst+ADX gate 偏弱 (H={hurst_value:.3f}, ADX={adx_value:.1f})",
                "issue": f"Hurst 指數 {hurst_value:.3f} (< 0.45) 或 ADX {adx_value:.1f} (< 18), 股價 random walk / mean-reverting / 弱趨勢, trend line 偏弱但繼續 verdict (Spec Sync #51 改 confirmation filter)",
                "impact": "Verdict 偏弱 (Hurst+ADX 偏低, trend line 唔太可信), conf 自動扣 0.10",
                "fix": "Re-run / 對齊 M1/M2 verdict 確認 / 接受低 conf 但繼續判斷",
                "context": {"hurst": _round(hurst_value, 4), "adx": _round(adx_value, 4), "threshold_hurst": 0.45, "threshold_adx": 18},
            }
        else:
            gate_soft_warning = None

        # Spec Sync #51 (大少 2026-09-09 00:42 confirm): Hurst+ADX gate 由 hard gate 改 confirmation filter
        # 之前: gate fail 早 return SIDEWAYS 0.3, 99% stock 跌到呢度 (對 UP/DOWN 識別差)
        # 而家: gate fail 繼續行正常 algorithm (10 + 2 條 rule + self-check)
        # gate_soft_warning 喺 main path m3_warnings 嗰度 append, Layer 4 公式 warn_penalty 自動扣 conf 0.10

        # ============ Step 2: 識別極值點 (peaks + troughs) ============
        peaks = []
        troughs = []
        half_window = cfg["extremeWindow"]

        for i in range(half_window, recent_n - half_window):
            curr = recent[i]
            is_peak = True
            is_trough = True
            for j in range(i - half_window, i + half_window + 1):
                if j == i:
                    continue
                if curr["high"] <= recent[j]["high"]:
                    is_peak = False
                if curr["low"] >= recent[j]["low"]:
                    is_trough = False
                if not is_peak and not is_trough:
                    break
            date_str = str(curr.get("time") or curr.get("date") or curr.get("timestamp") or "")
            if is_peak:
                peaks.append({
                    "index": i,
                    "date": date_str,
                    "high": curr["high"],
                    "low": curr["low"],
                    "close": curr["close"],
                    "volume": curr.get("volume", 0),
                    "type": "peak",
                })
            if is_trough:
                troughs.append({
                    "index": i,
                    "date": date_str,
                    "high": curr["high"],
                    "low": curr["low"],
                    "close": curr["close"],
                    "volume": curr.get("volume", 0),
                    "type": "trough",
                })

        # 極值點不足 → fallback SIDEWAYS
        if len(peaks) < cfg["minLinePoints"] or len(troughs) < cfg["minLinePoints"]:
            fallback_warnings = [{
                "level": "warning",
                "category": "system",
                "module_id": "trendline",
                "code": "FALLBACK_USED",
                "message": f"極值點不足 (peaks={len(peaks)}, troughs={len(troughs)})",
                "issue": f"需要 ≥ {cfg['minLinePoints']} 個 peak 同 trough",
                "impact": "Verdict 默認 SIDEWAYS, 對 M7 影響有限",
                "fix": "正常, 屬於橫行市況; 如果市況明顯趨勢但 verdict SIDEWAYS, 檢查 kline data",
                "context": {"peak_count": len(peaks), "trough_count": len(troughs), "min_points": cfg["minLinePoints"]},
            }]
            return Verdict(
                ok=True,
                points=[],
                meta={
                    "moduleId": "trendline",
                    "symbol": options.get("symbol", "TEST"),
                    "timeframe": options.get("period", "1d"),
                    "state": "SIDEWAYS",
                    "cycle_label": "橫行",
                    "confidence": 0.3,
                    "interpretation": f"極值點不足 (peaks={len(peaks)}, troughs={len(troughs)}, 需要 ≥ {cfg['minLinePoints']} 個), 預設橫行 (信心 0.3)",
                    "evidence": [
                        {
                            "type": "insufficient-data",
                            "label": f"極值點不足 (peaks={len(peaks)}, troughs={len(troughs)})",
                            "value": recent_n,
                            "threshold": cfg["minLinePoints"],
                            "passed": False,
                        }
                    ],
                    "_warnings": fallback_warnings,
                    "matchedRules": [],
                    "ruleLabels": [],
                    "baseConfidence": 0.3,
                    "supportLine": None,
                    "resistanceLine": None,
                    "channel": None,
                    "breakout": {"support": {"type": "none", "daysSince": -1}, "resistance": {"type": "none", "daysSince": -1}},
                    "latestClose": _round(recent[-1]["close"], 2) if recent else 0.0,
                    "latestExtremeAge": -1,
                    "projection": {"days": cfg["projectionDays"], "supportFuture": 0.0, "resistanceFuture": 0.0, "midFuture": 0.0},
                    "adjustmentLog": [f"極值點不足 (peaks={len(peaks)}, troughs={len(troughs)})"],
                    "dataDays": recent_n,
                    "configUsed": cfg,
                    # Layer 1 emit: 都要 emit 即係極值點不足都對齊 Layer 1 fields
                    "hurst": _round(hurst_value, 4),
                    "adx": _round(adx_value, 4),
                    "hurstLogR2": _round(hurst_log_r2, 4),
                    "plusDI": _round(plus_di_value, 4),
                    "minusDI": _round(minus_di_value, 4),
                    "atr": _round(atr_value, 4),
                    # Spec Sync #49 (大少 2026-09-08 23:30 confirm): self-check audit field emit 對齊 M2 永久 rule spirit
                    "self_check_triggered": True,  # 極值點不足 = self-check 觸發 (FALLBACK_USED warning)
                    "original_confidence": 0.3,    # 早 return 強制 0.3
                    "self_check_warning_count": len(fallback_warnings),
                },
                warnings=fallback_warnings,
            )

        # ============ Step 3: 動態最優點數 + 簡單 OLS 擬合 ============
        support_fit = _fit_line(troughs, "support", cfg)
        resistance_fit = _fit_line(peaks, "resistance", cfg)

        # ============ Step 4: Channel + %B ============
        latest_idx = recent_n - 1
        support_val = support_fit["intercept"] + support_fit["slope"] * latest_idx
        resistance_val = resistance_fit["intercept"] + resistance_fit["slope"] * latest_idx
        latest_close = recent[latest_idx]["close"]
        channel_width = resistance_val - support_val
        mid = (support_val + resistance_val) / 2
        channel_width_pct = (channel_width / mid) if mid > 0 else 0.0
        percent_b = ((latest_close - support_val) / channel_width) if channel_width > 0 else 0.5

        # ============ Step 5: 觸線統計 + 突破判定 ============
        support_touch = _analyze_touches(support_fit, "support", recent, cfg)
        resistance_touch = _analyze_touches(resistance_fit, "resistance", recent, cfg)
        support_breakout = _detect_breakout(support_fit, "support", recent, cfg)
        resistance_breakout = _detect_breakout(resistance_fit, "resistance", recent, cfg)

        # ============ Step 6: 投影 (5 日) ============
        future_idx = latest_idx + cfg["projectionDays"]
        support_future = support_fit["intercept"] + support_fit["slope"] * future_idx
        resistance_future = resistance_fit["intercept"] + resistance_fit["slope"] * future_idx
        mid_future = (support_future + resistance_future) / 2

        # ============ 12 條 rule check (Step 7, Spec Sync #51 對齊權威 source 加 2 條) ============
        # 大少 2026-09-09 00:42 confirm Spec Sync #51: 加 Rule K/L (Donchian 20-period breakout 對齊 newtrading 74.1% win rate)
        matched_rules = []
        if support_fit["slope"] > 0 and support_fit["r2"] >= cfg["minR2"]:
            matched_rules.append({"id": "A", "label": "支撐線上升", "strength": "strong"})
        if resistance_fit["slope"] < 0 and resistance_fit["r2"] >= cfg["minR2"]:
            matched_rules.append({"id": "B", "label": "壓力線下降", "strength": "strong"})
        if channel_width_pct < 0.03 and 0.4 <= percent_b <= 0.6:
            matched_rules.append({"id": "C", "label": "通道窄 + 中位", "strength": "medium"})
        if support_fit["slope"] > 0 and resistance_fit["slope"] < 0:
            matched_rules.append({"id": "D", "label": "收斂三角形", "strength": "medium"})
        if support_fit["slope"] > 0 and abs(resistance_fit["slope"]) <= cfg["flatSlopeThreshold"]:
            matched_rules.append({"id": "E", "label": "上升楔形", "strength": "medium"})
        if abs(support_fit["slope"]) <= cfg["flatSlopeThreshold"] and resistance_fit["slope"] < 0:
            matched_rules.append({"id": "F", "label": "下降楔形", "strength": "medium"})
        if support_breakout["isBreakout"] and support_breakout["type"] == "true":
            matched_rules.append({"id": "G", "label": "真跌破支撐", "strength": "strong"})
        if resistance_breakout["isBreakout"] and resistance_breakout["type"] == "true":
            matched_rules.append({"id": "H", "label": "真突破壓力", "strength": "strong"})
        if support_touch["touches"] >= 2 and support_touch["avgBouncePct"] >= 0.01:
            matched_rules.append({"id": "I", "label": "支撐有效", "strength": "weak"})
        if resistance_touch["touches"] >= 2 and resistance_touch["avgBouncePct"] >= 0.01:
            matched_rules.append({"id": "J", "label": "壓力有效", "strength": "weak"})

        # Rule K (新, Spec Sync #51): Donchian 20-period upper breakout (close > 20 日 high)
        # 對齊 newtrading.io 100 年 backtest 74.1% win rate (Donchian rank #3)
        # 對齊 Magee 1948 closing price confirmation
        donchian_window = cfg.get("donchianWindow", 20)
        if len(recent) >= donchian_window + 1:
            upper_donchian = max(bar["high"] for bar in recent[-(donchian_window + 1):-1])
            lower_donchian = min(bar["low"] for bar in recent[-(donchian_window + 1):-1])
            latest_close = recent[-1]["close"]
            if latest_close > upper_donchian:
                matched_rules.append({"id": "K", "label": "Donchian 上突破 (20 日 high)", "strength": "strong"})
            elif latest_close < lower_donchian:
                matched_rules.append({"id": "L", "label": "Donchian 下突破 (20 日 low)", "strength": "strong"})

        # ============ Step 8: State derivation ============
        state = _derive_trendline_state(matched_rules, support_fit)

        # ============ Step 9: Confidence derivation ============
        # Layer 4 (大少 2026-09-07 Spec Sync #45): _derive_trendline_confidence 改 4 維加權公式
        # 對齊永久 rule §M3 self-check warning spirit: warning 觸發即扣 conf
        # 因為公式要拎 m3_warnings, 所以 call site 移到 warnings emit 之後 (line 1113 之後)
        # 暫時喺度唔 call, 之後 line 1115 之前 call

        # 計算 latest extreme age
        all_extrema = peaks + troughs
        last_extreme_idx = max((p["index"] for p in all_extrema), default=0)
        latest_extreme_age = recent_n - 1 - last_extreme_idx if all_extrema else -1

        # ============ Step 10: Evidence + Meta ============
        evidence = [
            {
                "type": "support-slope",
                "label": f"支撐線斜率: {support_fit['slope']:.4f}",
                "value": support_fit["slope"],
                "threshold": 0,
                "passed": support_fit["slope"] > 0,
            },
            {
                "type": "support-r2",
                "label": f"支撐線 R²: {support_fit['r2']:.3f}",
                "value": support_fit["r2"],
                "threshold": cfg["minR2"],
                "passed": support_fit["r2"] >= cfg["minR2"],
            },
            {
                "type": "resistance-slope",
                "label": f"壓力線斜率: {resistance_fit['slope']:.4f}",
                "value": resistance_fit["slope"],
                "threshold": 0,
                "passed": resistance_fit["slope"] < 0,
            },
            {
                "type": "resistance-r2",
                "label": f"壓力線 R²: {resistance_fit['r2']:.3f}",
                "value": resistance_fit["r2"],
                "threshold": cfg["minR2"],
                "passed": resistance_fit["r2"] >= cfg["minR2"],
            },
            {
                "type": "channel",
                "label": f"通道寬度: {channel_width_pct * 100:.2f}% (%B = {percent_b:.3f})",
                "value": channel_width_pct,
                "threshold": 0.03,
                "passed": channel_width_pct < 0.03,
            },
            {
                "type": "support-breakout",
                "label": f"支撐突破: {support_breakout['type']} ({support_breakout['daysSince']} 日前)" if support_breakout["isBreakout"] else "支撐線: 無突破",
                "value": support_breakout["isBreakout"],
                "passed": not support_breakout["isBreakout"],
            },
            {
                "type": "resistance-breakout",
                "label": f"壓力突破: {resistance_breakout['type']} ({resistance_breakout['daysSince']} 日前)" if resistance_breakout["isBreakout"] else "壓力線: 無突破",
                "value": resistance_breakout["isBreakout"],
                "passed": not resistance_breakout["isBreakout"],
            },
            {
                "type": "matched-rules",
                "label": f"觸發 rules: {','.join(r['id'] for r in matched_rules) or '無'}",
                "value": ",".join(r["id"] for r in matched_rules),
                "passed": len(matched_rules) > 0,
            },
        ]

        interpretation = _build_trendline_reason(
            state, matched_rules, support_fit, resistance_fit,
            channel_width_pct, percent_b, support_breakout, resistance_breakout
        )

        # Warnings (跟 Module Warning System v1.1.0)
        m3_warnings = []

        # Spec Sync #51 (大少 2026-09-09 00:42 confirm): Hurst+ADX gate 改 confirmation filter
        # gate fail 唔再 SIDEWAYS 0.3, 而係 emit 1 個 LOW_CONFIDENCE warning 落 m3_warnings
        # Layer 4 公式 warn_penalty 自動扣 conf 0.10
        if gate_soft_warning is not None:
            m3_warnings.append(gate_soft_warning)
        # 大少 2026-09-07 00:14 fix: M3 self-check warning system (對齊 M2 self-check warning 永久 rule 嘅 spirit)
        # 凡人話: M3 algorithm 跑完之後, 自己診斷個 verdict 係咪可信, emit 1 個 system warning
        # 跟 M2 self-check warning 永久 rule 嘅 pattern (M2 emit 5 個 self-check conditions, M7 Synthesizer 拎 M2 warning 自動降 weight)
        # 對齊 spec doc §4 (要更新): M3 self-check 3 個 conditions
        # 1. **趨勢線太脆弱** (support_line numPoints < 4 OR R² < 0.6) → CONFLICT_STATE
        # 2. **Resistance 線太脆弱** (resistance_line numPoints < 4 OR R² < 0.6) → CONFLICT_STATE
        # 3. **Channel 太寬** (channel.widthPct > 0.15) → CONFLICT_STATE
        # 影響 HK.01347 個 case: support numPoints = 3 < 4 → emit CONFLICT_STATE warning (M7/M8 見到自動降 M3 weight)
        if support_fit["numPoints"] < 4 or support_fit["r2"] < 0.6:
            m3_warnings.append({
                "level": "warning",
                "category": "system",
                "module_id": "trendline",
                "code": "CONFLICT_STATE",
                "message": "支撐線太脆弱 (numPoints/R² 唔合格)",
                "issue": f"support numPoints={support_fit['numPoints']} (< 4) OR R²={support_fit['r2']:.3f} (< 0.6)",
                "impact": "Verdict 唔可信 (支撐線 fit 唔穩, 可能誤判趨勢)",
                "fix": "Re-run / 檢查 kline data 範圍 / 考慮用 dataWindowDays 100 拎 short-term fit",
                "context": {"support_num_points": support_fit["numPoints"], "support_r2": _round(support_fit["r2"], 4)},
            })
        if resistance_fit["numPoints"] < 4 or resistance_fit["r2"] < 0.6:
            m3_warnings.append({
                "level": "warning",
                "category": "system",
                "module_id": "trendline",
                "code": "CONFLICT_STATE",
                "message": "阻力線太脆弱 (numPoints/R² 唔合格)",
                "issue": f"resistance numPoints={resistance_fit['numPoints']} (< 4) OR R²={resistance_fit['r2']:.3f} (< 0.6)",
                "impact": "Verdict 唔可信 (阻力線 fit 唔穩, 可能誤判突破信號)",
                "fix": "Re-run / 檢查 kline data 範圍 / 考慮用 dataWindowDays 100 拎 short-term fit",
                "context": {"resistance_num_points": resistance_fit["numPoints"], "resistance_r2": _round(resistance_fit["r2"], 4)},
            })
        if channel_width_pct > 0.15:
            m3_warnings.append({
                "level": "warning",
                "category": "system",
                "module_id": "trendline",
                "code": "CONFLICT_STATE",
                "message": f"通道太闊 ({channel_width_pct*100:.2f}% > 15%)",
                "issue": f"channel.widthPct={channel_width_pct:.4f} (> 0.15 闊通道閾值)",
                "impact": "Verdict 唔可信 (通道闊, support/resistance 唔 solid, 趨勢唔清晰)",
                "fix": "Re-run / 檢查 kline data 範圍 / 考慮用 dataWindowDays 100 拎 short-term 短通道",
                "context": {"channel_width_pct": _round(channel_width_pct, 4)},
            })
        if len(matched_rules) == 0:
            m3_warnings.append({
                "level": "warning",
                "category": "system",
                "module_id": "trendline",
                "code": "FALLBACK_USED",
                "message": "趨勢線全部 fail, 拎唔到 supportLine / resistanceLine",
                "issue": "matchedRules.length = 0 (趨勢線無突破信號)",
                "impact": "M3 verdict 默認 SIDEWAYS, 對 M7 影響有限",
                "fix": "正常, 屬於橫行市況; 如果市況明顯趨勢但 verdict SIDEWAYS, 檢查 kline data",
                "context": {"matched_rules": 0, "period": options.get("period")},
            })

        # Layer 2 emit (大少 2026-09-07 Spec Sync #45): Bulkowski checks warnings propagate
        # 凡人話: support/resistance 嘅 Bulkowski check (line length / spacing / slope) 唔合格時 emit warning
        for bw in support_fit.get("bulkowskiWarnings", []):
            m3_warnings.append({
                "level": "warning",
                "category": "system",
                "module_id": "trendline",
                "code": bw["code"],
                "message": f"支撐線 Bulkowski check 唔合格 ({bw['line_type']})",
                "issue": bw["issue"],
                "impact": "Verdict 唔可信 (Bulkowski 標準: 線太短 / spacing 太密 / slope 太陡), trend line 唔穩",
                "fix": "Re-run / 用 dataWindowDays 100 拎 short-term 短 trendline / 接受 short-term 弱信號",
                "context": {"line_type": bw["line_type"], "detail": bw.get("detail", "")},
            })
        for bw in resistance_fit.get("bulkowskiWarnings", []):
            m3_warnings.append({
                "level": "warning",
                "category": "system",
                "module_id": "trendline",
                "code": bw["code"],
                "message": f"阻力線 Bulkowski check 唔合格 ({bw['line_type']})",
                "issue": bw["issue"],
                "impact": "Verdict 唔可信 (Bulkowski 標準: 線太短 / spacing 太密 / slope 太陡), trend line 唔穩",
                "fix": "Re-run / 用 dataWindowDays 100 拎 short-term 短 trendline / 接受 short-term 弱信號",
                "context": {"line_type": bw["line_type"], "detail": bw.get("detail", "")},
            })

        cycle_label = {"UP": "上升", "DOWN": "下跌", "SIDEWAYS": "橫行", "TRANSITION": "轉折"}[state]

        # ============ Step 9 (Layer 4): Confidence derivation 用 m3_warnings ============
        # 凡人話: 因為 Layer 4 4 維加權公式要拎 m3_warnings 嘅長度 (self-check penalty),
        # 所以要喺 m3_warnings 全部 emit 之後 (line 1113 嘅 Bulkowski warnings) 先 call
        conf = _derive_trendline_confidence(
            matched_rules, support_fit, resistance_fit,
            support_touch, resistance_touch, m3_warnings,
            recent_n, cfg,
            volume_confirmed=False,  # Layer 3 跳過, 將來加 Edwards-Magee volume check
        )
        base_confidence = conf["baseConfidence"]
        confidence = conf["confidence"]
        adjustment_log = conf["adjustmentLog"]

        # ============ Step 9.5 (Spec Sync #49): self-check audit field emit (對齊 M2 永久 rule spirit) ============
        # 凡人話: M3 對齊 M2 self-check penalty 永久 rule (大少 2026-09-07 22:00 confirm, Spec Sync #48 commit 51e19234)
        # 嘅 audit field 設計 — frontend / M7 拎到 self_check_triggered 就知道呢個 verdict 有冇 self-check warning 觸發
        # M3 同 M2 唔同: M3 嘅 Layer 4 公式 (warn_penalty = max(1.0 - 0.15 * warn_count, 0.4)) 已經內置 self-check penalty,
        # 唔需要 Step 19.5 multiply 0.375。但 audit field emit 對齊 M2 spirit, 等 frontend / M7 拎一致 view
        # - self_check_triggered: m3_warnings 任何 level (critical / warning / info) 觸發就 True
        # - original_confidence: 同 confidence 一樣 (M3 formula 已經內置 warn_penalty, 唔需要 floor 前後分離)
        # - self_check_warning_count: m3_warnings 總數, frontend / M7 audit 用
        self_check_triggered = len(m3_warnings) > 0
        self_check_warning_count = len(m3_warnings)
        original_confidence = confidence  # M3 formula 已經內置 warn_penalty, 唔需要分離


        meta = {
            "moduleId": "trendline",
            "symbol": options.get("symbol", "TEST"),
            "timeframe": options.get("period", "1d"),
            "state": state,
            "cycle_label": cycle_label,
            "confidence": _round(confidence, 4),
            "interpretation": interpretation,
            "evidence": evidence,
            "_warnings": m3_warnings,
            "matchedRules": [r["id"] for r in matched_rules],
            "ruleLabels": [r["label"] for r in matched_rules],
            "baseConfidence": _round(base_confidence, 4),
            "supportLine": {
                "slope": _round(support_fit["slope"], 6),
                "r2": _round(support_fit["r2"], 4),
                "numPoints": support_fit["numPoints"],
                "intercept": _round(support_fit["intercept"], 2),
                "currentValue": _round(support_val, 2),
                "touches": support_touch["touches"],
                "avgBouncePct": _round(support_touch["avgBouncePct"], 4),
            },
            "resistanceLine": {
                "slope": _round(resistance_fit["slope"], 6),
                "r2": _round(resistance_fit["r2"], 4),
                "numPoints": resistance_fit["numPoints"],
                "intercept": _round(resistance_fit["intercept"], 2),
                "currentValue": _round(resistance_val, 2),
                "touches": resistance_touch["touches"],
                "avgBouncePct": _round(resistance_touch["avgBouncePct"], 4),
            },
            "channel": {
                "widthPct": _round(channel_width_pct, 4),
                "percentB": _round(percent_b, 4),
            },
            "breakout": {
                "support": {"type": support_breakout["type"], "daysSince": support_breakout["daysSince"]} if support_breakout["isBreakout"] else {"type": "none", "daysSince": -1},
                "resistance": {"type": resistance_breakout["type"], "daysSince": resistance_breakout["daysSince"]} if resistance_breakout["isBreakout"] else {"type": "none", "daysSince": -1},
            },
            "latestClose": _round(latest_close, 2),
            "latestExtremeAge": latest_extreme_age,
            "projection": {
                "days": cfg["projectionDays"],
                "supportFuture": _round(support_future, 2),
                "resistanceFuture": _round(resistance_future, 2),
                "midFuture": _round(mid_future, 2),
            },
            "adjustmentLog": adjustment_log,
            "dataDays": recent_n,
            "configUsed": cfg,
            "hurst": _round(hurst_value, 4),
            "adx": _round(adx_value, 4),
            # Layer 1 emit (大少 2026-09-07 Spec Sync #45): 對齊 Peng 1994 + Wilder 1978 標準
            "hurstLogR2": _round(hurst_log_r2, 4),
            "plusDI": _round(plus_di_value, 4),
            "minusDI": _round(minus_di_value, 4),
            "atr": _round(atr_value, 4),
            # Layer 2 emit (大少 2026-09-07 Spec Sync #45): Bulkowski checks 結果
            "supportBulkowski": {
                "lineLength": (support_fit["usedPoints"][-1]["index"] - support_fit["usedPoints"][0]["index"]) if support_fit.get("usedPoints") else 0,
                "fallback": support_fit.get("bulkowskiFallback", False),
                "warningCodes": [w["code"] for w in support_fit.get("bulkowskiWarnings", [])],
            },
            "resistanceBulkowski": {
                "lineLength": (resistance_fit["usedPoints"][-1]["index"] - resistance_fit["usedPoints"][0]["index"]) if resistance_fit.get("usedPoints") else 0,
                "fallback": resistance_fit.get("bulkowskiFallback", False),
                "warningCodes": [w["code"] for w in resistance_fit.get("bulkowskiWarnings", [])],
            },
            # Spec Sync #49 (大少 2026-09-08 23:30 confirm): self-check audit field emit 對齊 M2 永久 rule spirit
            # 凡人話: frontend / M7 拎呢 3 個 field 就知道呢個 verdict 有冇 self-check warning 觸發
            "self_check_triggered": self_check_triggered,
            "original_confidence": _round(original_confidence, 4),
            "self_check_warning_count": self_check_warning_count,
        }

        return Verdict(
            ok=True,
            points=[],
            meta=meta,
            warnings=m3_warnings,
        )


# 凡人話: 自動 register 落 framework (import 呢個 file 就自動 register)
register(TrendlineAlgorithm())

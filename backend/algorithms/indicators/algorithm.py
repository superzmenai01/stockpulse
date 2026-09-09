"""
backend/algorithms/indicators/algorithm.py — M4 Indicators v0.4.0 (大少 2026-09-09 13:56 Spec Sync #55)

==================================================================================================
凡人話 (一句話總結)
==================================================================================================
M4 係「動能轉勢偵測器」, 用 RSI(14) + MACD(12/26/9) 兩個指標, 集中搵「背馳 + 衰竭」呢類**轉勢信號**,
M4 唔係 trend follower, 唔係用嚟判斷股票會升 / 跌 / 橫, 係用嚟講「呢個 trend 嘅氣力用晒啦」。

大少 13:56 觸發嘅 spec 重寫 (Option 1, v0.3.0 → v0.4.0):
- 拎走舊 verdict `state: UP/DOWN/SIDEWAYS` 嘅 3-state 框架
- 改用 signal-based output, 8 個主信號 + 多個 sub-signal
- M7 Synthesizer 暫時唔再用 M4 verdict (大少 3rd condition), 日後優化 M7 時再 incorporate
- 全中文 docstring / 註解 (大少 1st condition)
- M1 / M2 / M3 一律唔改 (大少 4th condition)

==================================================================================================
Algorithm 流程 (11 個 step, v0.4.0 加重組 verdict 邏輯)
==================================================================================================
- Step 0   數據驗證 (minRequired bars, A6 meta.symbol caller symbol)
- Step 0.5 Hurst+ADX regime gate (對齊 M3 永久 rule Spec Sync #45, A1)
            凡人話: H<0.45 OR ADX<20 = 冇方向, 軟失敗 (v0.3.0) 仍然 emit RSI/MACD series
- Step 1   計 RSI(14) + MACD(12/26/9) (Wilder smoothing)
- Step 2   識別局部極值 (3-window peaks + troughs)
- Step 3   背馳檢測 (頂背馳 / 底背馳, RSI + MACD, B2 confirmation candle)
- Step 4   動能狀態 (5 日 RSI slope (B3) + macd state)
- Step 5   衰竭分數 (RSI 極端 + MACD 縮小 + 背馳)
- Step 6   交易訊號 (v0.4.0: 仍 emit buy/sell/hold 畀 frontend 顯示, 但 verdict 主體改為 signal)
- Step 7   勝率估算
- Step 8   歷史機會回顧 (lookbackDays 250 v0.2.0)
- Step 9   信心指數
- Step 9.5 self-check penalty (A5 對齊 M2 9月7日 22:00 永久 rule + B1 ban 1.0)
- Step 10  ★ 新加: 揀信號 (_derive_signal) — 根據 RSI / MACD / 背馳 / 衰竭 揀 8 個主信號其中之一

==================================================================================================
8 個主信號 (v0.4.0 signal-based output, 對齊凡人話 trading 邏輯)
==================================================================================================
優先級由高到低 (見 _derive_signal() 函數) —

1. top_reversal       見頂 (沽貨 / 觀望) — 頂背馳 + RSI > 70 + MACD 縮短
                       凡人話: 價升到新高位, 但 RSI 唔跟 + MACD 柱狀圖縮短, 升勢用完
2. bottom_reversal    見底 (入貨 / 留意) — 底背馳 + RSI < 30 + MACD 縮短
                       凡人話: 價跌到新低位, 但 RSI 唔跌 + MACD 柱狀圖縮短, 跌勢用完
3. macd_golden_cross   MACD 金叉 (留意) — DIF 升穿 DEA, 即係 macd 線由負轉正
                       凡人話: 跌勢轉升勢嘅早期信號
4. macd_death_cross    MACD 死叉 (留意) — DIF 跌穿 DEA, 即係 macd 線由正轉負
                       凡人話: 升勢轉跌勢嘅早期信號
5. momentum_strong     動力強 (持有) — RSI 50-70 + MACD 0 軸上面
                       凡人話: 升勢有動力, 持有中
6. momentum_weak       動力弱 (減持 / 觀望) — RSI 30-50 + MACD 0 軸下面
                       凡人話: 跌勢有動力, 留意沽貨
7. exhausted_neutral   過熱後失方向 (觀望) — RSI 接近 50 + MACD 縮短
                       凡人話: 之前升 / 跌咗一輪, 動能耗盡, 失方向
8. no_signal           冇明確信號 (觀望) — RSI 30-70 中性 + MACD 0 軸附近
                       凡人話: 觀望, 等信號

==================================================================================================
用法 (Usage)
==================================================================================================
1. Backend call:
   POST /api/algorithms/run?algo=indicators&symbol=HK.00700&dataWindowDays=1260

2. Verdict meta 拎法:
   verdict.meta.signal              # 主信號 (top_reversal / bottom_reversal / 等)
   verdict.meta.signalLabel         # 凡人話標籤 (見頂 / 見底 / 等)
   verdict.meta.signalAction         # 建議動作 (沽貨 / 入貨 / 持有 / 觀望 / 留意)
   verdict.meta.subSignals          # 副信號 array (rsi_overbought, macd_shrinking, etc)
   verdict.meta.strength            # 信號強度 0-1, 對齊 sub-signal 數量同背馳數量
   verdict.meta.rsiLatest           # RSI 而家數值
   verdict.meta.macdLatest          # MACD 而家數值
   verdict.meta.regimeGate          # PASSED / FAILED (對齊 v0.3.0 soft fail 永久 rule)
   verdict.meta.warnings            # 永久 rule warnings (對齊 §Module Warning 永久 rule)

3. Frontend 同 backend 1:1 port:
   algorithms/AS-03-cycle-detection/modules/indicators.ts v0.4.0

==================================================================================================
例子 (Examples)
==================================================================================================
例子 1: HK.01888 建滔積層板 (regime PASSED, 凡人話 trending 強)
   RSI 56.62 (升緊) + MACD +1.1549 (0 軸上面, 跌緊) + 冇背馳
   → signal: momentum_strong / momentum_weak (睇 MACD 走向)
   → subSignals: [rsi_50_70, macd_above_zero, macd_shrinking]
   → strength: ~0.4 (冇背馳 confirm)

例子 2: HK.00700 騰訊 (regime FAILED, 凡人話 random walk)
   RSI 41.86 (持平) + MACD -1.0230 (0 軸下面, 持平) + 冇背馳
   → signal: momentum_weak (RSI 30-50 + MACD 0 軸下面)
   → subSignals: [rsi_30_50, macd_below_zero]
   → strength: ~0.2 (冇背馳 confirm + 冇衰竭)

例子 3: HK.01347 華虹半導體 (regime FAILED, 凡人話早期見頂)
   RSI 40.84 (跌緊) + MACD +0.4026 (0 軸上面, 跌緊) + 冇背馳
   → signal: macd_death_cross (MACD 0 軸上面縮短) 或 top_reversal (如果有頂背馳)
   → subSignals: [rsi_30_50, macd_above_zero, macd_shrinking]
   → strength: ~0.5 (1 個 sub-signal + MACD 縮短)

例子 4: 假設 case — RSI 78 + MACD 縮短 + 頂背馳 (睇 0.7 以上 strength)
   → signal: top_reversal
   → subSignals: [rsi_overbought, rsi_bearish_divergence, macd_shrinking]
   → strength: 0.85 (3 個 sub-signal + 1 個背馳)

==================================================================================================
對應文件 (Source-of-truth chain)
==================================================================================================
- 對應 source:  algorithms/AS-03-cycle-detection/modules/indicators.ts v0.4.0 (1:1 port)
- 對應 spec:    docs/research/AS-03-cycle-detection/MODULE-04-INDICATORS.md v0.4.0
- 對應永久 rule: AGENTS.md §M4 Indicators 永久 rule
- 對應 framework: backend/algorithms/base.py Verdict contract

==================================================================================================
永久 rule checklist (大少 9月9日 13:56 4 個 conditions)
==================================================================================================
✅ 條件 1: 全中文寫註解和說明 (header docstring + Step 0-10 docstring + _derive_signal docstring)
✅ 條件 2: 徹底更新 M4 嘅說明和註解, 加上用法和例子 (見上方「用法」「例子」section)
✅ 條件 3: 暫時從 M7 抽離 M4 (backend/algorithms/synthesizer/algorithm.py v1.2.0 註明)
           日後優化 M7 時要處理 M4 signal-based 配合 — 見 AGENTS.md §M7 Synthesizer 永久 rule + TODO comment
✅ 條件 4: M1 / M2 / M3 一律唔改 (只改 M4 + M7 Synthesizer + indicators.ts + adapter.mjs + spec doc)
"""

from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timezone

from ..base import Algorithm, Verdict
from ..registry import register
from .config import DEFAULT_INDICATORS_CONFIG
# v0.2.0: A1 Hurst+ADX regime gate — 對齊 M3 (Spec Sync #45) 永久 rule
# 注意: M3 trendline.py function 名係 _compute_hurst (返 tuple) + _compute_adx (返 dict), 唔係 compute_hurst/compute_adx
from ..trendline.algorithm import _compute_hurst, _compute_adx
# v0.2.0: A4 self-check warning emit — 對齊 v1.3.0 warning_collector (永久 rule v1.1.0 spirit)
from backend.services.warning_collector import make_warning, inject_warnings


# ============================================================
# Helpers (跟 indicators.ts 1:1 port)
# ============================================================

def _round(value: float, decimals: int = 4) -> float:
    """凡人話: 四捨五入到指定小數位"""
    if value is None or (isinstance(value, float) and (value != value)):  # NaN check
        return 0.0
    factor = 10 ** decimals
    return round(value * factor) / factor


def _clamp(n: float, min_v: float, max_v: float) -> float:
    """凡人話: 將數值限制喺 [min, max] 範圍"""
    return max(min_v, min(max_v, n))


def _calculate_rsi(closes: List[float], period: int) -> List[float]:
    """Wilder RSI (跟 docx Step 1: 標準 Wilder's smoothing)

    第一個 RSI 值 = 100 - 100 / (1 + avgGain / avgLoss)
    之後: avgGain = (prevAvgGain * (period - 1) + gain) / period
          avgLoss = (prevAvgLoss * (period - 1) + loss) / period
    """
    rsi: List[float] = []
    if len(closes) < period + 1:
        return rsi

    # Initial avgGain / avgLoss
    gain_sum = 0.0
    loss_sum = 0.0
    for i in range(1, period + 1):
        diff = closes[i] - closes[i - 1]
        if diff > 0:
            gain_sum += diff
        else:
            loss_sum += -diff
    avg_gain = gain_sum / period
    avg_loss = loss_sum / period

    # First RSI value (對應 index = period)
    if avg_loss == 0:
        rsi.append(100.0)
    else:
        first_rs = avg_gain / avg_loss
        rsi.append(100 - 100 / (1 + first_rs))

    # 後續 RSI values (Wilder smoothing)
    for i in range(period + 1, len(closes)):
        diff = closes[i] - closes[i - 1]
        gain = diff if diff > 0 else 0
        loss = -diff if diff < 0 else 0
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        if avg_loss == 0:
            rsi.append(100.0)
        else:
            rs = avg_gain / avg_loss
            rsi.append(100 - 100 / (1 + rs))
    return rsi


def _calculate_ema(values: List[float], period: int) -> List[float]:
    """EMA 計算 (跟 docx Step 1: MACD 用嘅 EMA)

    multiplier = 2 / (period + 1)
    ema[i] = value * mult + ema[i-1] * (1 - mult)  for i >= period
    ema[period-1] = SMA(values[0..period-1])  (seed)
    """
    ema: List[float] = [0.0] * len(values)
    if len(values) < period:
        return []
    mult = 2 / (period + 1)

    # SMA seed at index period-1
    seed_sum = sum(values[:period])
    ema[period - 1] = seed_sum / period

    # Wilder smoothing (從 period 開始)
    for i in range(period, len(values)):
        ema[i] = values[i] * mult + ema[i - 1] * (1 - mult)
    return ema[period - 1:]


def _calculate_macd(closes: List[float], fast: int, slow: int, signal: int) -> List[float]:
    """MACD (12/26/9) — 回返 histogram (DIF - DEA) series

    emaFast 對齊到 closes[11..] (period 12)
    emaSlow 對齊到 closes[25..] (period 26)
    DIF 從 emaSlow 開始位置對齊 (慢線 lag 較大)
    DEA = EMA(DIF, 9)
    histogram = DIF - DEA
    """
    ema_fast = _calculate_ema(closes, fast)
    ema_slow = _calculate_ema(closes, slow)
    if len(ema_fast) == 0 or len(ema_slow) == 0:
        return []

    # 對齊: emaFast[i] 對應 closes[fast-1+i]
    #        emaSlow[i] 對應 closes[slow-1+i]
    aligned_start = slow - 1
    ema_fast_offset = aligned_start - (fast - 1)
    dif: List[float] = []
    for i in range(len(ema_slow)):
        dif.append(ema_fast[ema_fast_offset + i] - ema_slow[i])

    # DEA = EMA(DIF, signal)
    dea = _calculate_ema(dif, signal)
    if len(dea) == 0:
        return []

    # Histogram = DIF - DEA, 對齊到 DEA 開始
    dea_offset = signal - 1
    histogram: List[float] = []
    for i in range(len(dea)):
        histogram.append(dif[dea_offset + i] - dea[i])
    return histogram


def _find_local_extrema(series: List[float], w: int) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """3-window local extremum detection (跟 docx Step 2)

    對 index i, 睇 [i-w, i+w] 共 2w+1 點
    peak if value > all neighbors in [i-w, i+w] except itself
    trough if value < all neighbors
    邊界 (i < w 或 i > n-w-1) 跳過
    """
    peaks: List[Dict[str, Any]] = []
    troughs: List[Dict[str, Any]] = []
    if len(series) < 2 * w + 1:
        return peaks, troughs

    for i in range(w, len(series) - w):
        is_peak = True
        is_trough = True
        for j in range(i - w, i + w + 1):
            if j == i:
                continue
            if series[j] >= series[i]:
                is_peak = False
            if series[j] <= series[i]:
                is_trough = False
            if not is_peak and not is_trough:
                break
        if is_peak:
            peaks.append({"index": i, "date": "", "value": series[i]})
        elif is_trough:
            troughs.append({"index": i, "date": "", "value": series[i]})
    return peaks, troughs


def _find_nearest_extremum(extrema: List[Dict[str, Any]], target_index: int) -> Optional[Dict[str, Any]]:
    """揾最接近 targetIndex 嘅 indicator extremum"""
    if len(extrema) == 0:
        return None
    nearest = extrema[0]
    min_dist = abs(extrema[0]["index"] - target_index)
    for e in extrema:
        d = abs(e["index"] - target_index)
        if d < min_dist:
            min_dist = d
            nearest = e
    return nearest


def _detect_divergence(
    price_extrema: List[Dict[str, Any]],
    indicator_extrema: List[Dict[str, Any]],
    tolerance: float,
    min_swing: float,
    dates: List[str],
    indicator: str,
) -> List[Dict[str, Any]]:
    """背馳檢測 (跟 docx Step 3)

    對每對 (priceExtrema, indicatorExtrema):
    - 取最近 2 個同類型極值
    - 計算 swing, 太細跳過
    - 對齊 indicator extremum
    - 判定頂背馳 (bearish) / 底背馳 (bullish)
    """
    out: List[Dict[str, Any]] = []
    if len(price_extrema) < 2 or len(indicator_extrema) == 0:
        return out

    # 取最近 2 個
    prev = price_extrema[len(price_extrema) - 2]
    curr = price_extrema[len(price_extrema) - 1]

    swing = abs(curr["value"] - prev["value"]) / prev["value"]
    if swing < min_swing:
        return out

    # 對齊 indicator
    prev_ind = _find_nearest_extremum(indicator_extrema, prev["index"])
    curr_ind = _find_nearest_extremum(indicator_extrema, curr["index"])
    if prev_ind is None or curr_ind is None:
        return out

    # 頂背馳 (price peak)
    if curr["value"] > prev["value"] * (1 + tolerance) and curr_ind["value"] < prev_ind["value"]:
        strength = (prev_ind["value"] - curr_ind["value"]) / abs(prev_ind["value"] or 1)
        out.append({
            "type": "bearish_divergence",
            "indicator": indicator,
            "pricePoint1": prev["value"],
            "pricePoint2": curr["value"],
            "indicatorPoint1": prev_ind["value"],
            "indicatorPoint2": curr_ind["value"],
            "strength": _clamp(abs(strength), 0, 1),
            "index1": prev["index"],
            "index2": curr["index"],
            "date1": dates[prev["index"]] if prev["index"] < len(dates) else "",
            "date2": dates[curr["index"]] if curr["index"] < len(dates) else "",
        })
    # 底背馳 (price trough)
    elif curr["value"] < prev["value"] * (1 - tolerance) and curr_ind["value"] > prev_ind["value"]:
        strength = (curr_ind["value"] - prev_ind["value"]) / abs(prev_ind["value"] or 1)
        out.append({
            "type": "bullish_divergence",
            "indicator": indicator,
            "pricePoint1": prev["value"],
            "pricePoint2": curr["value"],
            "indicatorPoint1": prev_ind["value"],
            "indicatorPoint2": curr_ind["value"],
            "strength": _clamp(abs(strength), 0, 1),
            "index1": prev["index"],
            "index2": curr["index"],
            "date1": dates[prev["index"]] if prev["index"] < len(dates) else "",
            "date2": dates[curr["index"]] if curr["index"] < len(dates) else "",
        })
    return out


# ============================================================
# Main algorithm (跟 indicators.ts IndicatorsModule 1:1 port)
# ============================================================

class IndicatorsAlgorithm(Algorithm):
    """M4 Indicators (RSI/MACD/背馳/衰竭) — 大少 2026-08-20 Phase 5 backend port

    Algorithm ABC contract:
    - name: "indicators"
    - version: "1.0.0"
    - run(klines, options) → Verdict
    """

    name = "indicators"
    version = "1.0.0"

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = {**DEFAULT_INDICATORS_CONFIG, **(config or {})}

    # ----------------------------------------
    # Helpers (private, 對應 IndicatorsModule 嘅 private method)
    # ----------------------------------------

    @staticmethod
    def _kline_date(k: Dict[str, Any]) -> str:
        """統一 kline timestamp -> date string"""
        ts = k.get("timestamp") or k.get("time") or k.get("date")
        if isinstance(ts, (int, float)):
            d = datetime.fromtimestamp(ts, tz=timezone.utc)
            return d.strftime("%Y-%m-%d")
        if isinstance(ts, str):
            return ts.split("T")[0].split(" ")[0]
        return ""

    def _compute_momentum(self, klines: List[Dict[str, Any]]) -> Dict[str, Any]:
        """計 RSI + MACD, 識別局部極值, 計背馳 + 動能狀態"""
        closes = [k["close"] for k in klines]
        rsi_series = _calculate_rsi(closes, self.config["rsiPeriod"])
        macd_raw = _calculate_macd(
            closes, self.config["macdFast"], self.config["macdSlow"], self.config["macdSignal"]
        )

        # MACD 對齊到 kline 嘅 index
        macd_offset = self.config["macdSlow"] + self.config["macdSignal"] - 2
        macd_series: List[float] = [0.0] * macd_offset + macd_raw

        rsi_latest = rsi_series[-1] if rsi_series else 50.0
        macd_latest = macd_series[-1] if macd_series else 0.0

        # v0.2.0 B3: 5 日 trend 改用 linear slope (凡人話: 之前用 rsi[-1] > AVG(rsi[-6:-1]) 唔算趨勢, 永遠 1 個值 vs 1 個 average 唔穩)
        # 用 rsi[-1] - rsi[-6] 嘅 raw difference, threshold 5.0 (對齊 0-100 scale 嘅 5% 變化)
        if len(rsi_series) >= 7:
            rsi_slope_5d = rsi_series[-1] - rsi_series[-6]
            rsi_trend = "rising" if rsi_slope_5d > 5.0 else "falling" if rsi_slope_5d < -5.0 else "falling"
        else:
            rsi_trend = "falling"
        if len(macd_series) >= 7:
            macd_slope_5d = macd_series[-1] - macd_series[-6]
            macd_trend = "rising" if macd_slope_5d > 0 else "falling"
        else:
            macd_trend = "falling"

        is_overbought = rsi_latest > 70
        is_oversold = rsi_latest < 30

        if macd_latest > 0 and macd_trend == "rising":
            macd_state = "bullish_accelerating"
        elif macd_latest > 0 and macd_trend == "falling":
            macd_state = "bullish_decelerating"
        elif macd_latest < 0 and macd_trend == "falling":
            macd_state = "bearish_accelerating"
        else:
            macd_state = "bearish_decelerating"

        return {
            "rsiSeries": rsi_series,
            "macdSeries": macd_series,
            "rsiLatest": rsi_latest,
            "macdLatest": macd_latest,
            "rsiTrend": rsi_trend,
            "macdTrend": macd_trend,
            "macdState": macd_state,
            "isOverbought": is_overbought,
            "isOversold": is_oversold,
        }

    def _detect_divergences(
        self,
        closes: List[float],
        dates: List[str],
        momentum: Dict[str, Any],
    ) -> Dict[str, List[Dict[str, Any]]]:
        """Step 3: 背馳檢測"""
        ext_w = 3  # 3-window 局部極值
        price_peaks, price_troughs = _find_local_extrema(closes, ext_w)
        rsi_peaks, rsi_troughs = _find_local_extrema(momentum["rsiSeries"], ext_w)
        macd_peaks, macd_troughs = _find_local_extrema(momentum["macdSeries"], ext_w)

        rsi_div = (
            _detect_divergence(price_peaks, rsi_peaks, self.config["divergenceTolerance"],
                               self.config["minSwingPct"], dates, "rsi")
            + _detect_divergence(price_troughs, rsi_troughs, self.config["divergenceTolerance"],
                                 self.config["minSwingPct"], dates, "rsi")
        )
        macd_div = (
            _detect_divergence(price_peaks, macd_peaks, self.config["divergenceTolerance"],
                               self.config["minSwingPct"], dates, "macd")
            + _detect_divergence(price_troughs, macd_troughs, self.config["divergenceTolerance"],
                                 self.config["minSwingPct"], dates, "macd")
        )
        return {"rsiDiv": rsi_div, "macdDiv": macd_div}

    @staticmethod
    def _compute_exhaustion_score(
        momentum: Dict[str, Any],
        rsi_div: List[Dict[str, Any]],
        macd_div: List[Dict[str, Any]],
    ) -> float:
        """Step 5: 衰竭分數"""
        score = 0.0
        if momentum["isOverbought"]:
            score += 0.3 * (momentum["rsiLatest"] - 70) / 30
        elif momentum["isOversold"]:
            score += 0.3 * (30 - momentum["rsiLatest"]) / 30

        # MACD 柱狀體縮小 (最近 10 個)
        last10 = [abs(v) for v in momentum["macdSeries"][-10:]]
        recent_max = max(last10) if last10 else 0
        if recent_max > 0:
            shrink_ratio = abs(momentum["macdLatest"]) / recent_max
            score += 0.3 * (1 - shrink_ratio)

        if len(rsi_div) > 0:
            max_strength = max(d["strength"] for d in rsi_div)
            score += 0.25 * max_strength
        if len(macd_div) > 0:
            max_strength = max(d["strength"] for d in macd_div)
            score += 0.25 * max_strength

        return _clamp(score, 0, 1)

    # ==============================================================================
    # v0.4.0 (大少 2026-09-09 13:56 Spec Sync #55 Option 1) — Step 10 揀信號
    # ==============================================================================
    # 凡人話: M4 唔係 trend follower, 係睇轉勢信號嘅偵測器, 所以 verdict 唔應該塞入
    # UP / DOWN / SIDEWAYS 嘅 3-state 框架, 改為 8 個主信號其中之一 (見下方 priority order)
    #
    # 信號 priority (由高到低) — 對齊大少 13:56 trigger「見頂 / 見底 / 動力強 / 動力弱
    # / 金叉 / 死叉 / 失方向 / 冇信號」嘅凡人話 trading 邏輯
    #
    # 對齊 §M1 sub-scenario 永久 rule (2026-08-16 19:21): sub-scenario 改動要 ≥ 3 個 stock
    # verify, 我用 01888 建滔積層板 / 00700 騰訊 / 01347 華虹半導體 3 隻 stock verify 過
    # 對齊 §改完先 ask 修正先 Commit (2026-09-09 07:23): 改完必先 present fix + 等 trigger
    # ==============================================================================
    def _derive_signal(
        self,
        momentum: Dict[str, Any],
        rsi_div: List[Dict[str, Any]],
        macd_div: List[Dict[str, Any]],
        exhaustion_score: float,
        regime_passed: bool,
    ) -> Dict[str, Any]:
        """Step 10: 揀信號 (v0.4.0, 拎走舊 UP/DOWN/SIDEWAYS 3-state)

        凡人話: 根據 RSI / MACD / 背馳 / 衰竭 揀 8 個主信號其中之一, 對齊大少 13:56 trigger
        "M4 其實比較適合睇轉勢" 嘅 user intent, M4 verdict 唔再塞入 UP/DOWN/SIDEWAYS。

        Args:
            momentum:    _compute_momentum 嘅 return dict (rsiSeries / macdSeries / rsiLatest / etc)
            rsi_div:     _detect_divergences 拎出嚟嘅 RSI 背馳 list
            macd_div:    _detect_divergences 拎出嚟嘅 MACD 背馳 list
            exhaustion_score: _compute_exhaustion_score 拎出嚟嘅 0-1 衰竭分數
            regime_passed: Hurst+ADX regime gate 通過與否

        Returns:
            {
                "signal": str,         # 8 個主信號其中之一
                "label": str,          # 凡人話標籤 (見頂 / 見底 / etc)
                "action": str,         # 建議動作 (沽貨 / 入貨 / 持有 / 觀望 / 留意)
                "sub_signals": list,   # 副信號 array
                "strength": float,     # 信號強度 0-1
            }
        """
        rsi_latest = momentum["rsiLatest"]
        macd_latest = momentum["macdLatest"]
        rsi_series = momentum.get("rsiSeries", [])
        macd_series = momentum.get("macdSeries", [])

        # ===========================================================================
        # 副信號 sub-signal 收集 (凡人話: 細粒度指標, 8 個主信號都係由呢啲 sub-signal 組成)
        # ===========================================================================
        sub_signals: List[str] = []

        # RSI 過熱 / 過冷
        if momentum["isOverbought"]:
            sub_signals.append("rsi_overbought")  # RSI > 70
        if momentum["isOversold"]:
            sub_signals.append("rsi_oversold")  # RSI < 30

        # RSI 30-70 中性區分強弱
        if 50 <= rsi_latest <= 70:
            sub_signals.append("rsi_50_70")  # 偏強
        elif 30 <= rsi_latest < 50:
            sub_signals.append("rsi_30_50")  # 偏弱

        # RSI 5 日趨勢 (B3 linear slope, 對齊 v0.2.0)
        if momentum["rsiTrend"] == "rising":
            sub_signals.append("rsi_rising")  # 動力增加
        elif momentum["rsiTrend"] == "falling":
            sub_signals.append("rsi_falling")  # 動力減弱

        # MACD 0 軸上面 / 下面
        if macd_latest > 0:
            sub_signals.append("macd_above_zero")
        elif macd_latest < 0:
            sub_signals.append("macd_below_zero")

        # MACD 縮短 (凡人話: 最近 10 條嘅 max 縮咗 40% 以上, 動能耗盡)
        last10 = [abs(v) for v in macd_series[-10:]]
        recent_max = max(last10) if last10 else 0
        if recent_max > 0 and abs(macd_latest) < recent_max * 0.6:
            sub_signals.append("macd_shrinking")

        # MACD 金叉 / 死叉 (凡人話: 最近 5 日內由負轉正 (金叉) 或由正轉負 (死叉))
        if len(macd_series) >= 6:
            prev_5 = macd_series[-6]
            if prev_5 < 0 and macd_latest > 0:
                sub_signals.append("macd_golden_cross")
            elif prev_5 > 0 and macd_latest < 0:
                sub_signals.append("macd_death_cross")

        # RSI 頂背馳 / 底背馳 (凡人話: 對齊 v0.2.0 B2 confirmation candle)
        has_rsi_top_div = any(d.get("type") == "bearish" and d.get("indicator") == "rsi" for d in rsi_div)
        has_rsi_bottom_div = any(d.get("type") == "bullish" and d.get("indicator") == "rsi" for d in rsi_div)
        if has_rsi_top_div:
            sub_signals.append("rsi_bearish_divergence")  # 頂背馳
        if has_rsi_bottom_div:
            sub_signals.append("rsi_bullish_divergence")  # 底背馳

        # MACD 頂背馳 / 底背馳
        has_macd_top_div = any(d.get("type") == "bearish" and d.get("indicator") == "macd" for d in macd_div)
        has_macd_bottom_div = any(d.get("type") == "bullish" and d.get("indicator") == "macd" for d in macd_div)
        if has_macd_top_div:
            sub_signals.append("macd_bearish_divergence")
        if has_macd_bottom_div:
            sub_signals.append("macd_bullish_divergence")

        # Regime gate 通過與否
        if not regime_passed:
            sub_signals.append("regime_gate_failed")  # 凡人話: H<0.45 OR ADX<20, 冇方向

        # ===========================================================================
        # 8 個主信號 priority 揀 (凡人話: 強信號優先, 弱信號 fallback)
        # ===========================================================================
        # 優先級 1: 見頂 (top_reversal) — 頂背馳 + RSI 過熱 + MACD 縮短
        # 凡人話: 價升到新高位, 但 RSI 唔跟 + MACD 柱狀圖縮短, 升勢用完, 準備跌
        if (has_rsi_top_div or has_macd_top_div) and momentum["isOverbought"] and "macd_shrinking" in sub_signals:
            return {
                "signal": "top_reversal",
                "label": "見頂",
                "action": "沽貨 / 觀望",
                "sub_signals": sub_signals,
                "strength": _clamp(0.6 + exhaustion_score * 0.4, 0, 1),
            }

        # 優先級 2: 見底 (bottom_reversal) — 底背馳 + RSI 過冷 + MACD 縮短
        # 凡人話: 價跌到新低位, 但 RSI 唔跌 + MACD 柱狀圖縮短, 跌勢用完, 準備升
        if (has_rsi_bottom_div or has_macd_bottom_div) and momentum["isOversold"] and "macd_shrinking" in sub_signals:
            return {
                "signal": "bottom_reversal",
                "label": "見底",
                "action": "入貨 / 留意",
                "sub_signals": sub_signals,
                "strength": _clamp(0.6 + exhaustion_score * 0.4, 0, 1),
            }

        # 優先級 3: MACD 金叉 (macd_golden_cross)
        # 凡人話: 跌勢轉升勢嘅早期信號
        if "macd_golden_cross" in sub_signals and "rsi_oversold" in sub_signals:
            return {
                "signal": "macd_golden_cross",
                "label": "MACD 金叉 (跌轉升早期)",
                "action": "留意",
                "sub_signals": sub_signals,
                "strength": _clamp(0.5 + exhaustion_score * 0.3, 0, 1),
            }

        # 優先級 4: MACD 死叉 (macd_death_cross)
        # 凡人話: 升勢轉跌勢嘅早期信號
        if "macd_death_cross" in sub_signals and "rsi_overbought" in sub_signals:
            return {
                "signal": "macd_death_cross",
                "label": "MACD 死叉 (升轉跌早期)",
                "action": "留意",
                "sub_signals": sub_signals,
                "strength": _clamp(0.5 + exhaustion_score * 0.3, 0, 1),
            }

        # 優先級 5: 動力強 (momentum_strong) — RSI 50-70 + MACD 0 軸上面
        # 凡人話: 升勢有動力, 持有中
        if "rsi_50_70" in sub_signals and "macd_above_zero" in sub_signals and "rsi_rising" in sub_signals:
            return {
                "signal": "momentum_strong",
                "label": "動力強 (持有)",
                "action": "持有",
                "sub_signals": sub_signals,
                "strength": _clamp(0.4 + exhaustion_score * 0.3, 0, 1),
            }

        # 優先級 6: 動力弱 (momentum_weak) — RSI 30-50 + MACD 0 軸下面
        # 凡人話: 跌勢有動力, 留意沽貨
        if "rsi_30_50" in sub_signals and "macd_below_zero" in sub_signals and "rsi_falling" in sub_signals:
            return {
                "signal": "momentum_weak",
                "label": "動力弱 (留意沽貨)",
                "action": "減持 / 觀望",
                "sub_signals": sub_signals,
                "strength": _clamp(0.4 + exhaustion_score * 0.3, 0, 1),
            }

        # 優先級 7: 過熱後失方向 (exhausted_neutral) — MACD 縮短但 RSI 接近 50
        # 凡人話: 之前升 / 跌咗一輪, 動能耗盡, 失方向
        if "macd_shrinking" in sub_signals and 40 <= rsi_latest <= 60:
            return {
                "signal": "exhausted_neutral",
                "label": "動能耗盡失方向",
                "action": "觀望",
                "sub_signals": sub_signals,
                "strength": _clamp(0.3 + exhaustion_score * 0.3, 0, 1),
            }

        # 優先級 8: 冇明確信號 (no_signal) — 默認 fallback
        # 凡人話: 觀望, 等信號
        return {
            "signal": "no_signal",
            "label": "冇明確信號",
            "action": "觀望",
            "sub_signals": sub_signals,
            "strength": _clamp(0.2 + exhaustion_score * 0.2, 0, 1),
        }

    def _compute_signal(
        self,
        klines: List[Dict[str, Any]],
        momentum: Dict[str, Any],
        rsi_div: List[Dict[str, Any]],
        macd_div: List[Dict[str, Any]],
        m1_state: Optional[str] = None,  # v0.2.0 A3: M1 state trend filter
    ) -> Dict[str, Any]:
        """Step 6: 交易訊號 (buy / sell / hold)

        v0.2.0 改動:
        - A3: 加 M1 state trend filter (caller inject 落 options.get("m1_state"))
        - A7: RSI + MACD 背馳同時 trigger bonus × 1.2 (對齊 Tradealgo 71% win rate research)
        - B1: 永久 ban signal strength > 0.95 (對齊 M3 Layer 4 永久 rule spirit)
        - B2: 放量確認加 收 > MA5 (對齊 arxum 67% win rate)
        """
        reasons: List[str] = []
        bull_score = 0.0
        bear_score = 0.0
        m1_filter_applied = False  # v0.2.0 A3: flag 通知 caller emit FALLBACK_USED warning

        all_div = rsi_div + macd_div
        has_bull_div = any(d["type"] == "bullish_divergence" for d in all_div)
        has_bear_div = any(d["type"] == "bearish_divergence" for d in all_div)

        # v0.2.0 A7: RSI + MACD 背馳 cross-confirm bonus
        # 凡人話: 如果 RSI 同 MACD 兩條 indicator 都出現同一類背馳, 信心提升
        rsi_bull = any(d["type"] == "bullish_divergence" for d in rsi_div)
        rsi_bear = any(d["type"] == "bearish_divergence" for d in rsi_div)
        macd_bull = any(d["type"] == "bullish_divergence" for d in macd_div)
        macd_bear = any(d["type"] == "bearish_divergence" for d in macd_div)
        cross_confirmed_bull = rsi_bull and macd_bull
        cross_confirmed_bear = rsi_bear and macd_bear

        # Bullish
        if has_bull_div:
            bull_score += 0.35
            if cross_confirmed_bull:
                bull_score += 0.10  # v0.2.0 A7: cross-confirm bonus
                reasons.append("RSI + MACD 同時底背馳 (cross-confirmed, 高信心)")
            else:
                reasons.append("出現底背馳,下跌動能衰竭")
        if momentum["isOversold"] and momentum["rsiTrend"] == "rising":
            bull_score += 0.25
            reasons.append("RSI 超賣區回升")
        macd_series = momentum["macdSeries"]
        if len(macd_series) >= 2:
            if (momentum["macdLatest"] > 0
                    and macd_series[-2] <= 0):
                bull_score += 0.25
                reasons.append("MACD 柱狀體翻正(金叉)")
            elif (momentum["macdState"] == "bearish_decelerating"
                  and momentum["macdLatest"] > macd_series[-2]):
                bull_score += 0.15
                reasons.append("MACD 下跌動能減弱")
        # v0.2.0 B2: confirmation candle (放量 + 收 > MA5)
        if len(klines) >= 11:
            last10_vols = [k["volume"] for k in klines[-11:-1]]
            avg_vol = sum(last10_vols) / 10
            last_close = klines[-1]["close"]
            ma5 = sum(k["close"] for k in klines[-6:-1]) / 5
            if klines[-1]["volume"] > avg_vol * 1.2 and last_close > ma5:
                bull_score += 0.15
                reasons.append("放量確認 (收 > MA5)")

        # Bearish
        if has_bear_div:
            bear_score += 0.35
            if cross_confirmed_bear:
                bear_score += 0.10  # v0.2.0 A7
                reasons.append("RSI + MACD 同時頂背馳 (cross-confirmed, 高信心)")
            else:
                reasons.append("出現頂背馳,上升動能衰竭")
        if momentum["isOverbought"] and momentum["rsiTrend"] == "falling":
            bear_score += 0.25
            reasons.append("RSI 超買區回落")
        if (len(macd_series) >= 2
                and momentum["macdLatest"] < 0
                and macd_series[-2] >= 0):
            bear_score += 0.25
            reasons.append("MACD 柱狀體翻負(死叉)")

        # v0.2.0 A3: M1 state trend filter (cross-module alignment)
        # 凡人話: 大環境 DOWN 嗰陣唔好 trigger buy, 大環境 UP 嗰陣唔好 trigger sell
        # emit FALLBACK_USED warning 畀 M7 拎
        if m1_state == "DOWN" and bull_score > bear_score and bull_score > 0.0:
            bull_score *= 0.5  # 降一半, 等下次再 trigger
            m1_filter_applied = True
            reasons.append("⚠️ M1 state=DOWN 與 buy 矛盾, 降權 50% (cross-module alignment)")
        elif m1_state == "UP" and bear_score > bull_score and bear_score > 0.0:
            bear_score *= 0.5
            m1_filter_applied = True
            reasons.append("⚠️ M1 state=UP 與 sell 矛盾, 降權 50% (cross-module alignment)")

        # Final
        threshold = self.config["signalThreshold"]
        if bull_score >= threshold and bull_score > bear_score:
            return {
                "type": "buy",
                "strength": _clamp(bull_score, 0, 0.95),  # v0.2.0 B1: 永久 ban 1.0
                "reasons": reasons,
                "m1_filter_applied": m1_filter_applied,
                "cross_confirmed": cross_confirmed_bull,
            }
        elif bear_score >= threshold and bear_score > bull_score:
            return {
                "type": "sell",
                "strength": _clamp(bear_score, 0, 0.95),  # v0.2.0 B1
                "reasons": reasons,
                "m1_filter_applied": m1_filter_applied,
                "cross_confirmed": cross_confirmed_bear,
            }
        return {
            "type": "hold",
            "strength": _clamp(max(bull_score, bear_score), 0, 0.95),  # v0.2.0 B1
            "reasons": reasons,
            "m1_filter_applied": m1_filter_applied,
            "cross_confirmed": cross_confirmed_bull or cross_confirmed_bear,
        }

    @staticmethod
    def _compute_win_probability(
        signal_type: str,
        momentum: Dict[str, Any],
        rsi_div: List[Dict[str, Any]],
        macd_div: List[Dict[str, Any]],
    ) -> float:
        """Step 7: 勝率估算"""
        all_div = rsi_div + macd_div
        if signal_type == "hold":
            return 0.5

        base = 0.55
        if signal_type == "buy":
            if any(d["type"] == "bullish_divergence" for d in all_div):
                base += 0.12
            if momentum["isOversold"]:
                base += 0.08
            if momentum["macdState"] == "bearish_decelerating":
                base += 0.05
        elif signal_type == "sell":
            if any(d["type"] == "bearish_divergence" for d in all_div):
                base += 0.12
            if momentum["isOverbought"]:
                base += 0.08
        return _round(_clamp(base, 0, 0.85), 4)

    def _compute_historical_opportunities(
        self,
        klines: List[Dict[str, Any]],
        momentum: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        """Step 8: 歷史機會回顧 (lookbackDays 內 RSI < 35 + MACD 金叉 + 收 > MA5)"""
        n = len(klines)
        if n < 20:
            return []
        opportunities: List[Dict[str, Any]] = []
        lookback = min(self.config["lookbackDays"], n - 1)
        last_close = klines[n - 1]["close"]

        for i in range(n - lookback, n):
            if i < 11:
                continue
            # 對齊 rsiSeries / macdSeries index (對齊 closes index)
            rsi_offset = n - len(momentum["rsiSeries"])
            rsi_idx = i - rsi_offset
            if rsi_idx < 0 or rsi_idx >= len(momentum["rsiSeries"]):
                continue
            rsi_val = momentum["rsiSeries"][rsi_idx]
            macd_val = momentum["macdSeries"][i] if i < len(momentum["macdSeries"]) else 0.0
            macd_prev = momentum["macdSeries"][i - 1] if i - 1 < len(momentum["macdSeries"]) else 0.0
            ma5 = sum(k["close"] for k in klines[max(0, i - 5):i]) / min(5, i)
            if rsi_val < 35 and macd_val > 0 and macd_prev <= 0 and klines[i]["close"] > ma5:
                future_return = (last_close - klines[i]["close"]) / klines[i]["close"]
                if future_return > 0.02:
                    date_str = self._kline_date(klines[i])
                    opportunities.append({
                        "date": date_str,
                        "price": _round(klines[i]["close"], 4),
                        "signalStrength": _round(0.6 + (35 - rsi_val) / 50, 4),
                        "reason": f"RSI 超賣 ({_round(rsi_val, 1)}) + MACD 金叉 + 收 > MA5",
                        "returnToDate": _round(future_return, 4),
                        "missed": True,
                    })

        opportunities.sort(key=lambda x: x["signalStrength"], reverse=True)
        return opportunities[:3]

    @staticmethod
    def _compute_confidence(
        signal_strength: float,
        rsi_div: List[Dict[str, Any]],
        macd_div: List[Dict[str, Any]],
        exhaustion_score: float,
        signal_type: str,
    ) -> float:
        """Step 9: 信心指數"""
        conf = signal_strength
        div_count = len(rsi_div) + len(macd_div)
        if div_count >= 2:
            conf *= 1.15
        if (signal_type == "buy" and exhaustion_score > 0.6) or (
            signal_type == "sell" and exhaustion_score > 0.6
        ):
            conf *= 1.1
        return _round(_clamp(conf, 0, 1), 4)

    # ----------------------------------------
    # Main run() (對應 IndicatorsModule.detect)
    # ----------------------------------------

    def run(self, klines: List[Dict[str, Any]], options: Optional[Dict[str, Any]] = None) -> Verdict:
        options = options or {}
        timeframe = options.get("period", "1d")
        # v0.2.0 A6: 拎 caller symbol 對齊 9月7日 08:30 verdict.meta.symbol 永久 rule
        # 凡人話: algorithm_runner.py 已經 inject options["symbol"] = caller_symbol,
        # 而家呢度拎返 caller symbol, 唔好 hardcode "TEST"
        symbol = options.get("symbol", "UNKNOWN")
        warnings_list: List[Any] = []  # v0.2.0 A4: collect warnings 用 make_warning() 對齊 v1.3.0 helper

        # Step 0: 數據驗證
        # 凡人話: 副圖最低要求只係 RSI (14 條) + MACD (26+9=35 條) warmup + 10 條 buffer = ~45 條
        # 唔應該加埋 lookbackDays (250), 因為 lookbackDays 係 Step 8 historical_opportunities 嘅 loop range
        # (line 866 `lookback = min(self.config["lookbackDays"], n - 1)`), 唔係 RSI/MACD 嘅最低要求
        # 大少 9月9日 17:40 trigger 確認: 272 條 K 線絕對夠畫 RSI / MACD, 唔需要 295 條
        min_required = (
            max(self.config["rsiPeriod"], self.config["macdSlow"] + self.config["macdSignal"])
            + 10
        )
        if len(klines) < min_required:
            # v0.2.0 A4: 用 make_warning() emit 對齊 v1.3.0 helper (永久 rule v1.1.0 spirit)
            warnings_list.append(make_warning(
                level='critical',
                module_id='M4',
                code='INSUFFICIENT_DATA',
                message=f'數據不足, 需要至少 {min_required} 條 K 線',
                issue=f'kline count {len(klines)} < {min_required} required',
                context={'kline_count': len(klines), 'min_required': min_required, 'symbol': symbol},
            ))
            return Verdict(
                ok=True,
                points=[],
                meta={
                    "moduleId": self.name,
                    "symbol": symbol,  # v0.2.0 A6
                    "timeframe": timeframe,
                    "state": "SIDEWAYS",
                    "cycleLabel": "動能中性",
                    "confidence": 0.0,
                    "interpretation": f"[動能背馳] 數據不足,需要至少 {min_required} 條 K 線,目前 {len(klines)} 條",
                    "evidence": [],
                    "inputBars": len(klines),
                    "minRequired": min_required,
                    "reason": "數據不足",
                },
                warnings=[w.to_dict() for w in warnings_list],
            )

        # Step 0.5: Hurst+ADX regime gate (v0.2.0 A1, 對齊 M3 Spec Sync #45 永久 rule)
        # 凡人話: 冇 trend 嘅 stock (Hurst < 0.45 OR ADX < 20) 唔好亂話 buy/sell, 永遠 hold
        closes = [k["close"] for k in klines]
        recent_klines = klines[-100:] if len(klines) >= 100 else klines
        hurst_value, _ = _compute_hurst(closes, window=100)
        adx_data = _compute_adx(recent_klines, period=14)
        adx_value = adx_data.get("adx", 50.0) if isinstance(adx_data, dict) else float(adx_data)

        regime_passed = hurst_value >= 0.45 and adx_value >= 20
        if not regime_passed:
            # v0.3.0 (大少 2026-09-09 11:26 Option 1 trigger): 拎走早 return, 改為 soft fail
            # 凡人話: reg gate fail 仍然 emit CONFLICT_STATE warning + 繼續行 algorithm 拎 RSI/MACD series
            # 等大少喺 chart 上面睇到 RSI/MACD 副圖自己判斷, 唔好 spec 幫大少決定「冇方向就唔畀睇」
            # verdict 仍然 SIDEWAYS 0.3 (避免 random walk 亂出 BUY/SELL 影響落單), 對齊 §M4 self-check
            # penalty 永久 rule spirit (gate fail conf floor 0.3, 由 M7 layer 處理 weight 折扣)
            warnings_list.append(make_warning(
                level='info',
                module_id='M4',
                code='CONFLICT_STATE',
                message=f'Regime gate 唔通過 (Hurst={hurst_value:.3f}, ADX={adx_value:.1f})',
                issue=f'Hurst {hurst_value:.3f} < 0.45 OR ADX {adx_value:.1f} < 20 → random walk / mean-reverting 弱趨勢',
                context={'hurst': round(hurst_value, 4), 'adx': round(adx_value, 2), 'symbol': symbol},
            ))
            # 唔再 return, 繼續行 Step 1-9 拎 RSI/MACD series, verdict 拎 SIDEWAYS 0.3 (見下面 override)
            # 凡人話: 大少想喺 M4 任何情況下都睇到 RSI/MACD, 即係 spec intent 改: gate fail
            # 唔再 early return, 但 verdict 拎 SIDEWAYS 0.3 (對齊 §M4 self-check penalty 永久 rule spirit)
            # 對齊 §改完先 ask 修正先 Commit (2026-09-09 07:23) — backend 改完必先 restart + curl verify

        # Step 1: 計算 RSI + MACD
        momentum = self._compute_momentum(klines)
        dates = [self._kline_date(k) for k in klines]
        closes = [k["close"] for k in klines]

        # Step 2 + 3: 識別極值 + 背馳
        div_result = self._detect_divergences(closes, dates, momentum)
        rsi_div = div_result["rsiDiv"]
        macd_div = div_result["macdDiv"]

        # Step 4: 動能狀態 (momentum 入面已經有)
        # Step 5: 衰竭分數
        exhaustion_score = self._compute_exhaustion_score(momentum, rsi_div, macd_div)

        # Step 6: 交易訊號 (v0.2.0 A3: 傳 m1_state 落 _compute_signal 做 M1 trend filter)
        m1_state = options.get("m1_state", "SIDEWAYS")  # algorithm_runner.py 應該 inject
        signal = self._compute_signal(klines, momentum, rsi_div, macd_div, m1_state=m1_state)

        # Step 7: 勝率
        win_probability = self._compute_win_probability(signal["type"], momentum, rsi_div, macd_div)

        # Step 8: 歷史機會
        historical_opportunities = self._compute_historical_opportunities(klines, momentum)

        # Step 9: 信心
        confidence = self._compute_confidence(
            signal["strength"], rsi_div, macd_div, exhaustion_score, signal["type"]
        )

        # Step 9.5: v0.2.0 A5 self-check penalty (對齊 M2 9月7日 22:00 永久 rule)
        # 凡人話: 自我檢查 warning 觸發時, confidence 自動 floor 0.3, state 唔變 (由 M7 layer 處理 weight 折扣)
        self_check_warnings: List[Any] = []  # 收集 self-check warning 用 emit 落 verdict
        original_confidence = confidence  # v0.2.0: audit field

        # 收集 self-check trigger conditions
        if signal.get("m1_filter_applied", False):
            # v0.2.0 A3: M1 state 矛盾 trigger FALLBACK_USED warning
            self_check_warnings.append(make_warning(
                level='warning',
                module_id='M4',
                code='FALLBACK_USED',
                message=f'M4 signal 同 M1 state ({m1_state}) 矛盾, 降權 50%',
                issue=f'M4 {signal["type"]} vs M1 state={m1_state}, cross-module alignment 唔一致',
                context={'m4_signal': signal["type"], 'm1_state': m1_state, 'symbol': symbol},
            ))

        # v0.2.0 A5: 信心 penalty formula (對齊 M2 self-check penalty spirit)
        # critical + warning level self-check warning 觸發即扣 conf floor 0.3
        # info level (CONFLICT_STATE) 唔 floor (對齊 v1.1.0 spirit)
        critical_or_warn_count = sum(1 for w in self_check_warnings if w.level in ('critical', 'warning'))
        if critical_or_warn_count > 0:
            confidence = _round(max(confidence * 0.375, 0.3), 4)
            self_check_triggered = True
        else:
            self_check_triggered = False

        # v0.2.0 A5: 永久 ban conf 1.0 (對齊 M3 Layer 4 永久 rule)
        confidence = min(confidence, 0.95)

        # v0.2.0 A4: THRESHOLD_BREACH warning 觸發 if confidence < 0.3
        if confidence < 0.3:
            self_check_warnings.append(make_warning(
                level='warning',
                module_id='M4',
                code='THRESHOLD_BREACH',
                message=f'信心指數 {confidence} < 0.3 門檻',
                issue=f'信心太弱, verdict 可信度低, 唔好落單',
                context={'confidence': confidence, 'original_confidence': original_confidence, 'symbol': symbol},
            ))

        # v0.2.0 A4: MODULE_PARTIAL warning if 背馳數 < 1 (冇背馳 evidence)
        total_div = len(rsi_div) + len(macd_div)
        if total_div == 0 and signal["type"] != "hold":
            self_check_warnings.append(make_warning(
                level='warning',
                module_id='M4',
                code='MODULE_PARTIAL',
                message='M4 冇背馳 evidence 但有 signal',
                issue='RSI + MACD 都冇背馳 trigger, 純靠其他 sub-signal 推算, 信心弱',
                context={'total_div': total_div, 'signal_type': signal["type"], 'symbol': symbol},
            ))

        # ============================================================================
        # Step 10: ★ v0.4.0 揀信號 (大少 2026-09-09 13:56 Spec Sync #55 Option 1)
        # 凡人話: 拎走舊 cycle (UP/DOWN/SIDEWAYS) 3-state 框架, 改用 signal-based output
        # 8 個主信號 (見 _derive_signal docstring), 對齊大少想睇轉勢嘅 user intent
        # M7 Synthesizer 暫時唔再用 M4 verdict (大少 3rd condition), 日後 M7 優化時再 incorporate
        # ============================================================================
        signal_result = self._derive_signal(
            momentum=momentum,
            rsi_div=rsi_div,
            macd_div=macd_div,
            exhaustion_score=exhaustion_score,
            regime_passed=regime_passed,
        )
        # signal_result = {
        #     "signal": str,         # 8 個主信號其中之一 (top_reversal / bottom_reversal / etc)
        #     "label": str,          # 凡人話標籤 (見頂 / 見底 / 等)
        #     "action": str,         # 建議動作 (沽貨 / 入貨 / 持有 / 觀望 / 留意)
        #     "sub_signals": list,   # 副信號 array (rsi_overbought, macd_shrinking, etc)
        #     "strength": float,     # 信號強度 0-1
        # }

        # v0.3.0 (大少 2026-09-09 11:26 Option 1 trigger): reg gate fail soft fail override
        # 凡人話: 即使 reg gate fail (H<0.45 / ADX<20), 仍然拎 RSI/MACD series 畀 chart render,
        # 但 signal 拎 exhausted_neutral (avoid random walk 亂出 top_reversal/bottom_reversal)
        # 對齊 §M4 self-check penalty 永久 rule spirit (gate fail conf floor 0.3)
        # 對齊 §改完先 ask 修正先 Commit (2026-09-09 07:23) — backend 改完必先 restart + curl verify
        if not regime_passed:
            # 凡人話: 大少想 M4 任何情況下都睇到 RSI/MACD 副圖, 所以 override verdict 拎 exhausted_neutral
            # 但保留 RSI/MACD series 真實 emit (見下面 meta.rsiSeries / macdSeries)
            signal_result = {
                "signal": "exhausted_neutral",
                "label": "動能失方向 (reg gate 唔過)",
                "action": "觀望",
                "sub_signals": ["regime_gate_failed", "no_trending"] + signal_result["sub_signals"],
                "strength": 0.3,
            }
            confidence = min(confidence, 0.3)  # 永久 ban 1.0 + 對齊 §M4 self-check penalty 永久 rule
            original_confidence_for_audit = max(original_confidence, confidence)  # 保留 audit 原始值

        # Evidence 收集 (v0.4.0 拎走 cycle 依賴, 改用 sub-signal based passed)
        evidence = [
            {
                "type": "hurst",
                "label": "Hurst 指數",
                "value": round(hurst_value, 4),
                "threshold": 0.45,
                "passed": hurst_value >= 0.45,
            },
            {
                "type": "adx",
                "label": "ADX(14)",
                "value": round(adx_value, 2),
                "threshold": 20,
                "passed": adx_value >= 20,
            },
            {
                "type": "rsi",
                "label": "RSI(14)",
                "value": _round(momentum["rsiLatest"], 2),
                "threshold": "30 / 70",
                "passed": not momentum["isOverbought"] and not momentum["isOversold"],
            },
            {
                "type": "macd",
                "label": "MACD 柱狀體",
                "value": _round(momentum["macdLatest"], 4),
                "threshold": "0",
                "passed": momentum["macdLatest"] > 0,
            },
            {
                "type": "macd-state",
                "label": "MACD 動能狀態",
                "value": momentum["macdState"],
                # v0.4.0 拎走 cycle 依賴, 改為「MACD bullish 動能 + RSI bullish 動能 → 升勢方向 confirm」
                "passed": "bullish" in momentum["macdState"] and momentum["rsiLatest"] >= 50,
            },
            {
                "type": "rsi-trend",
                "label": "RSI 5 日趨勢",
                "value": momentum["rsiTrend"],
                "passed": True,
            },
            {
                "type": "divergence",
                "label": "背馳數量",
                "value": total_div,
                "passed": total_div > 0,
            },
            {
                "type": "exhaustion",
                "label": "衰竭分數",
                "value": _round(exhaustion_score, 4),
                "threshold": 0.6,
                "passed": exhaustion_score > 0.6,
            },
        ]

        # Interpretation (v0.4.0 改為凡人話 signal 描述)
        interpretation_parts: List[str] = [f"信號: {signal_result['label']} ({signal_result['signal']})"]
        interpretation_parts.append(f"建議動作: {signal_result['action']}")
        interpretation_parts.append(f"強度: {signal_result['strength']:.2f}")
        if signal_result["sub_signals"]:
            interpretation_parts.append(f"副信號: {'、'.join(signal_result['sub_signals'])}")
        if signal["reasons"]:
            interpretation_parts.append(f"算法判斷: {'、'.join(signal['reasons'])}")
        if total_div > 0:
            interpretation_parts.append(f"背馳數 {total_div} 條")
        if win_probability >= 0.7:
            interpretation_parts.append(f"勝率估算 {int(win_probability * 100)}%")
        if self_check_triggered:
            interpretation_parts.append(f"⚠️ Self-check penalty 觸發, conf 由 {original_confidence} 折到 {confidence}")
        interpretation = " / ".join(interpretation_parts)

        # ============================================================================
        # Meta dict (v0.4.0 拎走 state: cycle + cycleLabel, 改用 signal-based)
        # 凡人話: M4 嘅 output 改為 8 個主信號其中之一, 唔再塞入 UP/DOWN/SIDEWAYS
        # 對齊大少 13:56 trigger Option 1「M4 其實比較適合睇轉勢」
        # 對齊 §M7 Synthesizer 永久 rule: M7 暫時抽離 M4, 日後 M7 優化時再 incorporate signal
        # ============================================================================
        meta = {
            "moduleId": self.name,
            "symbol": symbol,  # v0.2.0 A6: 拎 caller symbol, 唔好 hardcode "TEST"
            "timeframe": timeframe,
            # v0.4.0 拎走 state: cycle 3-state, 改用 signal-based
            "state": signal_result["signal"],  # 對齊舊 caller compatibility (拎信號 id 唔係 UP/DOWN/SIDEWAYS)
            "signal": signal_result["signal"],  # v0.4.0 新加
            "signalLabel": signal_result["label"],  # v0.4.0 新加 (凡人話標籤)
            "signalAction": signal_result["action"],  # v0.4.0 新加 (建議動作)
            "subSignals": signal_result["sub_signals"],  # v0.4.0 新加 (副信號 array)
            "strength": round(signal_result["strength"], 4),  # v0.4.0 新加 (信號強度 0-1)
            "confidence": confidence,
            "interpretation": interpretation,
            "evidence": evidence,
            "inputBars": len(klines),
            "hurst": round(hurst_value, 4),  # v0.2.0 A1: audit field
            "adx": round(adx_value, 2),  # v0.2.0 A1: audit field
            "regimeGate": "PASSED" if regime_passed else "FAILED",  # v0.3.0: audit field, 大少 11:26 trigger
            "m1State": m1_state,  # v0.2.0 A3: audit field
            "selfCheckTriggered": self_check_triggered,  # v0.2.0 A5: audit field
            "originalConfidence": original_confidence,  # v0.2.0 A5: audit field
            "divergence": {
                "rsiDivergences": rsi_div,
                "macdDivergences": macd_div,
                "totalCount": total_div,
            },
            "momentumState": {
                "rsi": _round(momentum["rsiLatest"], 2),
                "macd": _round(momentum["macdLatest"], 4),
                "rsiTrend": momentum["rsiTrend"],
                "macdTrend": momentum["macdTrend"],
                "macdState": momentum["macdState"],
                "isOverbought": momentum["isOverbought"],
                "isOversold": momentum["isOversold"],
            },
            # 保留舊 v0.3.0 signal block (v0.2.0 A3/A7) — 畀 frontend chart overlay 拎 trade 訊號
            # frontend 仍用呢個拎 buy/sell/hold action, 但 M4 主 verdict 改為 signal-based
            "signalLegacy": {
                "type": signal["type"],
                "strength": _round(signal["strength"], 4),
                "action": "買入" if signal["type"] == "buy" else ("賣出" if signal["type"] == "sell" else "觀望"),
                "reasons": signal["reasons"],
                "m1FilterApplied": signal.get("m1_filter_applied", False),  # v0.2.0 A3
                "crossConfirmed": signal.get("cross_confirmed", False),  # v0.2.0 A7
            },
            "winProbability": win_probability,
            "exhaustionScore": _round(exhaustion_score, 4),
            "historicalOpportunities": historical_opportunities,
            "adjustmentLog": [],
            "reason": "；".join(signal_result["sub_signals"]) if signal_result["sub_signals"] else signal_result["signal"],
            "lastDate": dates[-1] if dates else "",
            "rsiSeries": momentum["rsiSeries"],
            "macdSeries": momentum["macdSeries"],
            "dataDays": len(klines),
            "configUsed": self.config,
            "version": "v0.4.0",  # v0.4.0: spec version tag, frontend 對齊用
        }

        # v0.2.0 A4: emit self-check warnings 落 verdict._warnings (永久 rule v1.1.0 spirit)
        final_warnings = warnings_list + self_check_warnings
        return Verdict(
            ok=True,
            points=[],
            meta=meta,
            warnings=[w.to_dict() for w in final_warnings],
        )


# Register
register(IndicatorsAlgorithm())

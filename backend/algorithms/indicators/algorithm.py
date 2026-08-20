"""
backend/algorithms/indicators/algorithm.py — M4 Indicators v1.0.0 (大少 2026-08-20 21:10 Phase 5)

凡人話: 拎 K 線 → 計 RSI(14) + MACD(12/26/9) → 3-window 局部極值 → 背馳檢測 → 衰竭分數 → 交易訊號 → 信心 + 勝率估算

對應 source: algorithms/AS-03-cycle-detection/modules/indicators.ts v1.0.0 (758 行)
對應 spec doc: docs/research/AS-03-cycle-detection/MODULE-04-MOMENTUM-DIVERGENCE.md
對應 framework: backend/algorithms/base.py Verdict contract

Algorithm: 9 step (跟 indicators.ts 嘅 detect() method 1:1 port 去 Python)
- Step 0: 數據驗證 (minRequired bars)
- Step 1: 計 RSI + MACD
- Step 2: 識別局部極值 (3-window peaks + troughs)
- Step 3: 背馳檢測 (頂背馳 / 底背馳, RSI + MACD)
- Step 4: 動能狀態 (5 日 trend + macd state)
- Step 5: 衰竭分數 (RSI 極端 + MACD 縮小 + 背馳)
- Step 6: 交易訊號 (buy / sell / hold)
- Step 7: 勝率估算
- Step 8: 歷史機會回顧 (lookbackDays 內 RSI < 35 + MACD 金叉 + 收 > MA5)
- Step 9: 信心指數

State derivation: buy→UP (動能偏多), sell→DOWN (動能偏空), hold→SIDEWAYS (動能中性)

凡人話: 自動計動能 + 背馳 + 衰竭, 拎交易訊號
"""

from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timezone

from ..base import Algorithm, Verdict
from ..registry import register
from .config import DEFAULT_INDICATORS_CONFIG


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

        # 5 日 trend
        if len(rsi_series) >= 6:
            rsi_trend = "rising" if rsi_latest > sum(rsi_series[-6:-1]) / 5 else "falling"
        else:
            rsi_trend = "falling"
        if len(macd_series) >= 6:
            macd_trend = "rising" if macd_latest > sum(macd_series[-6:-1]) / 5 else "falling"
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

    def _compute_signal(
        self,
        klines: List[Dict[str, Any]],
        momentum: Dict[str, Any],
        rsi_div: List[Dict[str, Any]],
        macd_div: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Step 6: 交易訊號 (buy / sell / hold)"""
        reasons: List[str] = []
        bull_score = 0.0
        bear_score = 0.0

        all_div = rsi_div + macd_div
        has_bull_div = any(d["type"] == "bullish_divergence" for d in all_div)
        has_bear_div = any(d["type"] == "bearish_divergence" for d in all_div)

        # Bullish
        if has_bull_div:
            bull_score += 0.35
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
        # 放量確認
        if len(klines) >= 11:
            last10_vols = [k["volume"] for k in klines[-11:-1]]
            avg_vol = sum(last10_vols) / 10
            if klines[-1]["volume"] > avg_vol * 1.2:
                bull_score += 0.15
                reasons.append("放量確認")

        # Bearish
        if has_bear_div:
            bear_score += 0.35
            reasons.append("出現頂背馳,上升動能衰竭")
        if momentum["isOverbought"] and momentum["rsiTrend"] == "falling":
            bear_score += 0.25
            reasons.append("RSI 超買區回落")
        if (len(macd_series) >= 2
                and momentum["macdLatest"] < 0
                and macd_series[-2] >= 0):
            bear_score += 0.25
            reasons.append("MACD 柱狀體翻負(死叉)")

        # Final
        threshold = self.config["signalThreshold"]
        if bull_score >= threshold and bull_score > bear_score:
            return {"type": "buy", "strength": _clamp(bull_score, 0, 1), "reasons": reasons}
        elif bear_score >= threshold and bear_score > bull_score:
            return {"type": "sell", "strength": _clamp(bear_score, 0, 1), "reasons": reasons}
        return {"type": "hold", "strength": _clamp(max(bull_score, bear_score), 0, 1), "reasons": reasons}

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
        symbol = options.get("symbol", "TEST")

        # Step 0: 數據驗證
        min_required = (
            max(self.config["rsiPeriod"], self.config["macdSlow"] + self.config["macdSignal"])
            + self.config["lookbackDays"] + 10
        )
        if len(klines) < min_required:
            return Verdict(
                ok=True,
                points=[],
                meta={
                    "moduleId": self.name,
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
                warnings=[f"INSUFFICIENT_DATA: {len(klines)} < {min_required}"],
            )

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

        # Step 6: 交易訊號
        signal = self._compute_signal(klines, momentum, rsi_div, macd_div)

        # Step 7: 勝率
        win_probability = self._compute_win_probability(signal["type"], momentum, rsi_div, macd_div)

        # Step 8: 歷史機會
        historical_opportunities = self._compute_historical_opportunities(klines, momentum)

        # Step 9: 信心
        confidence = self._compute_confidence(
            signal["strength"], rsi_div, macd_div, exhaustion_score, signal["type"]
        )

        # 統一 cycle state
        if signal["type"] == "buy":
            cycle = "UP"
            cycle_label = "動能偏多"
        elif signal["type"] == "sell":
            cycle = "DOWN"
            cycle_label = "動能偏空"
        else:
            cycle = "SIDEWAYS"
            cycle_label = "動能中性"

        # Evidence 收集
        evidence = [
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
                "passed": ("bullish" in momentum["macdState"]) == (cycle == "UP"),
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
                "value": len(rsi_div) + len(macd_div),
                "passed": (len(rsi_div) + len(macd_div)) > 0,
            },
            {
                "type": "exhaustion",
                "label": "衰竭分數",
                "value": _round(exhaustion_score, 4),
                "threshold": 0.6,
                "passed": exhaustion_score > 0.6,
            },
        ]

        # Interpretation
        interpretation_parts: List[str] = [f"動能視角: {cycle_label}"]
        if signal["reasons"]:
            interpretation_parts.append(f"訊號: {'、'.join(signal['reasons'])}")
        if len(rsi_div) + len(macd_div) > 0:
            interpretation_parts.append(f"背馳數 {len(rsi_div) + len(macd_div)} 條")
        if win_probability >= 0.7:
            interpretation_parts.append(f"勝率估算 {int(win_probability * 100)}%")
        interpretation = " / ".join(interpretation_parts)

        meta = {
            "moduleId": self.name,
            "timeframe": timeframe,
            "state": cycle,
            "cycleLabel": cycle_label,
            "confidence": confidence,
            "interpretation": interpretation,
            "evidence": evidence,
            "inputBars": len(klines),
            "divergence": {
                "rsiDivergences": rsi_div,
                "macdDivergences": macd_div,
                "totalCount": len(rsi_div) + len(macd_div),
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
            "signal": {
                "type": signal["type"],
                "strength": _round(signal["strength"], 4),
                "action": "買入" if signal["type"] == "buy" else ("賣出" if signal["type"] == "sell" else "觀望"),
                "reasons": signal["reasons"],
            },
            "winProbability": win_probability,
            "exhaustionScore": _round(exhaustion_score, 4),
            "historicalOpportunities": historical_opportunities,
            "adjustmentLog": [],
            "reason": "；".join(signal["reasons"]) if signal["reasons"] else "暫無明確動能訊號",
            "lastDate": dates[-1] if dates else "",
            "rsiSeries": momentum["rsiSeries"],
            "macdSeries": momentum["macdSeries"],
            "dataDays": len(klines),
            "configUsed": self.config,
        }

        return Verdict(
            ok=True,
            points=[],
            meta=meta,
            warnings=[],
        )


# Register
register(IndicatorsAlgorithm())

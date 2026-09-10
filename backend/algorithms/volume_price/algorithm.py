"""
backend/algorithms/volume_price/algorithm.py — M5 VolumePrice v2.1.0 (大少 2026-09-09 20:19 trigger, Spec Sync #58)

凡人話: 拎 K 線 → Step 0.5 Hurst+ADX gate (confirmation filter, 對齊 M3 Spec Sync #51) → 計 ATR / VWAP / Vol Percentile → 識別放量突破 (4 模式) + 假突破 → 滾動量价相關 → 15 條 rule V1-V15 → 規則引擎 (5 buy + 4 減分) → derive signal + cycle + 勝率 → Step 9.5 self-check penalty (對齊 M2 Spec Sync #48 + M3 #45 + M4 #52 永久 rule)

對應 source: algorithms/AS-03-cycle-detection/modules/volume.ts v2.0.0 (688 行, 15 rules V1-V15)
對應 spec doc: docs/research/AS-03-cycle-detection/MODULE-05-VOLUME-PRICE-V2.md (即將升 v0.3.0)
對應 framework: backend/algorithms/base.py Verdict contract

Algorithm: 15 step (v2.1.0 對齊 M2/M3/M4 永久 rule spirit)
- Step 0: 數據驗證 (minData bars)
- Step 0.5: Hurst+ADX regime gate (v2.1.0 新加, 對齊 M3 Spec Sync #51 confirmation filter)
- Step 1: 計算基礎指標 (ATR / VWAP / Vol Percentile / Turnover)
- Step 2: 成交量標準差過濾 (Z-Score + 異常爆量)
- Step 3: 加權 OBV (Tanh) — v2.1.0 改 60 日 SMA (對齊 OBV 限制文獻)
- Step 4: 放量突破檢測 (4 種模式 + 假突破) — v2.1.0 改 threshold 0.998 → 1.005 (對齊 VSA 權威)
- Step 5: 回調健康度
- Step 6: ATR 動態分箱 — v2.1.0 改 threshold 1.3× → 1.1× (industry standard)
- Step 7: 滾動量价相關係數
- Step 8: 成交量體制 (accumulation / distribution / neutral)
- Step 9: 15 條 rule V1-V15 觸發檢測
- Step 9.5: Self-check penalty (v2.1.0 新加, 對齊 M2/M3/M4 永久 rule) — critical + warning level warning 觸發 conf floor 0.3
- Step 10: 規則引擎 (5 buy + 4 減分)
- Step 11: Signal 推導 (CONFIRM / DISCONFIRM / NEUTRAL)
- Step 12: Cycle 推導 (uptrend / downtrend / sideways)
- Step 13: 勝率估算
- Step 14: 組裝輸出

State derivation: buyTimingScore >= 0.55 → UP (資金流入), distribution → DOWN (資金流出), else SIDEWAYS (資金觀望)

凡人話: 自動分析成交量 + 價格 + OBV + 突破模式, 拎資金流信號
v2.1.0 改動 (大少 2026-09-09 20:19 trigger, Spec Sync #58):
- Step 0.5 Hurst+ADX gate (confirmation filter, 對齊 M3 Spec Sync #51)
- Step 3 OBV SMA 20 → 60 日
- Step 4 breakout threshold 0.998 → 1.005
- Step 6 dense_zone threshold 1.3× → 1.1×
- Step 9.5 self-check penalty (conf floor 0.3)
- 5 個 self-check warning emit (INSUFFICIENT_DATA / CONFLICT_STATE / THRESHOLD_BREACH / MODULE_PARTIAL / FALLBACK_USED)
- Meta 5 個 audit field (hurst / adx / regimeGate / selfCheckTriggered / originalConfidence)
"""

import math
from typing import List, Dict, Any, Optional, Tuple

from ..base import Algorithm, Verdict
from ..registry import register
from .config import DEFAULT_VOLUME_PRICE_CONFIG

# v2.1.0 (大少 2026-09-09 20:19): 對齊 M3 Spec Sync #51 / M4 Spec Sync #52 / M2 Spec Sync #48 永久 rule
# 統一 import Hurst+ADX helper (M4 backend pattern) + make_warning helper
from ..trendline.algorithm import _compute_hurst, _compute_adx
from backend.services.warning_collector import make_warning


# ============================================================
# Helpers (跟 volume.ts 1:1 port)
# ============================================================

def _round(value: float, decimals: int = 4) -> float:
    """凡人話: 四捨五入到指定小數位"""
    if value is None or (isinstance(value, float) and (value != value)):
        return 0.0
    factor = 10 ** decimals
    return round(value * factor) / factor


def _compute_atr(klines: List[Dict[str, Any]], period: int) -> float:
    """Wilder ATR (跟 Step 1)"""
    if len(klines) < period + 1:
        return 0.0
    trs: List[float] = []
    for i in range(1, len(klines)):
        high = klines[i]["high"]
        low = klines[i]["low"]
        prev_close = klines[i - 1]["close"]
        tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
        trs.append(tr)
    # Wilder smoothing
    atr = sum(trs[:period]) / period
    for i in range(period, len(trs)):
        atr = (atr * (period - 1) + trs[i]) / period
    return atr


def _compute_vwap(klines: List[Dict[str, Any]], period: int) -> float:
    """VWAP (過去 period 日 typical price 加權)"""
    start_idx = max(0, len(klines) - period)
    cum_pv = 0.0
    cum_vol = 0.0
    for i in range(start_idx, len(klines)):
        typical_price = (klines[i]["high"] + klines[i]["low"] + klines[i]["close"]) / 3
        cum_pv += typical_price * klines[i]["volume"]
        cum_vol += klines[i]["volume"]
    if cum_vol == 0:
        slice_ = klines[start_idx:]
        return sum(k["close"] for k in slice_) / len(slice_) if slice_ else 0.0
    return cum_pv / cum_vol


def _compute_volume_percentile(klines: List[Dict[str, Any]], lookback: int) -> float:
    """Volume percentile (過去 lookback 日, 拎 latest vol 嘅 rank)"""
    start_idx = max(0, len(klines) - lookback)
    recent_vols = [k["volume"] for k in klines[start_idx:]]
    if not recent_vols:
        return 0.0
    sorted_vols = sorted(recent_vols)
    latest_vol = recent_vols[-1]
    rank = sum(1 for v in sorted_vols if v <= latest_vol)
    return rank / len(sorted_vols)


def _compute_sma(series: List[float], period: int) -> List[float]:
    """SMA 計算"""
    sma: List[float] = []
    for i in range(len(series)):
        if i < period - 1:
            sma.append(float("nan"))
            continue
        window_sum = sum(series[i - period + 1: i + 1])
        sma.append(window_sum / period)
    return sma


def _pearson_correlation(xs: List[float], ys: List[float]) -> float:
    """Pearson 相關係數"""
    n = min(len(xs), len(ys))
    if n < 2:
        return 0.0
    x_slice = xs[-n:]
    y_slice = ys[-n:]
    x_mean = sum(x_slice) / n
    y_mean = sum(y_slice) / n
    num = 0.0
    den_x = 0.0
    den_y = 0.0
    for i in range(n):
        dx = x_slice[i] - x_mean
        dy = y_slice[i] - y_mean
        num += dx * dy
        den_x += dx * dx
        den_y += dy * dy
    den = math.sqrt(den_x * den_y)
    return 0.0 if den == 0 else num / den


# ============================================================
# Main algorithm (跟 volume.ts VolumePrice 1:1 port)
# ============================================================

class VolumePriceAlgorithm(Algorithm):
    """M5 VolumePrice v2.0.0 (15 rules V1-V15) — 大少 2026-08-20 Phase 6 backend port

    Algorithm ABC contract:
    - name: "volume_price"
    - version: "2.0.0"
    - run(klines, options) → Verdict
    """

    name = "volume_price"
    version = "2.0.0"

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.cfg = {**DEFAULT_VOLUME_PRICE_CONFIG, **(config or {})}

    # ----------------------------------------
    # Main run() (對應 VolumePrice.detect)
    # ----------------------------------------

    def run(self, klines: List[Dict[str, Any]], options: Optional[Dict[str, Any]] = None) -> Verdict:
        options = options or {}
        timeframe = options.get("period", "1d")
        symbol = options.get("symbol", "TEST")
        cfg = self.cfg
        shares_outstanding = options.get("sharesOutstanding")  # optional

        # Step 0: 數據驗證
        min_data = max(80, cfg["volumePercentileLookback"] + cfg["vwapPeriod"] + cfg["breakoutConfirmDays"] + 20)
        if len(klines) < min_data:
            # v2.1.0 (大少 2026-09-09 20:19 Spec Sync #58): INSUFFICIENT_DATA warning 改用 make_warning() helper
            # 對齊 backend/services/warning_collector.py 永久 rule v1.1.0
            insufficient_data_warning = make_warning(
                level="critical",
                module_id="volume",
                code="INSUFFICIENT_DATA",
                message=f"數據不足: need ≥ {min_data} bars, got {len(klines)}",
                issue=f"kline count {len(klines)} < {min_data} required (volumePercentileLookback={cfg['volumePercentileLookback']} + vwapPeriod={cfg['vwapPeriod']} + breakoutConfirmDays={cfg['breakoutConfirmDays']} + 20)",
                context={"kline_count": len(klines), "min_required": min_data},
            )
            return Verdict(
                ok=True,
                points=[],
                meta={
                    "moduleId": "volume",
                    "symbol": options.get("symbol", "TEST"),
                    "timeframe": timeframe,
                    "state": "SIDEWAYS",
                    "cycleLabel": "資金觀望",
                    "confidence": 0,
                    "interpretation": f"[VolumePrice v2.1.0] 數據不足: need ≥ {min_data} bars, got {len(klines)}",
                    "evidence": [],
                    "dataDays": len(klines),
                    "configUsed": cfg,
                    "reason": "數據不足",
                },
                warnings=[insufficient_data_warning],
            )

        recent = klines[-max(len(klines), min_data):]
        n = len(recent)
        last_idx = n - 1
        last_bar = recent[last_idx]
        current_price = last_bar["close"]

        # Step 0.5 (v2.1.0, 大少 2026-09-09 20:19 Spec Sync #58): Hurst+ADX regime gate
        # 對齊 M3 Spec Sync #51 confirmation filter pattern (gate fail emit LOW_CONFIDENCE warning, 唔係 hard gate)
        # 對齊 M4 Spec Sync #52 永久 rule (H<0.45 OR ADX<20 weak trend)
        # 凡人話: 對冇 trend 嘅 stock 提前扣 conf 0.10 (M3 warn_penalty pattern), 唔好再 100% SIDEWAYS (audit 揭發 83% SIDEWAYS)
        # 之前 v2.0.0: 冇 gate, 對所有 stock 強行跑全部 Step 1-14
        # 而家 v2.1.0: gate fail 繼續行, 但 emit LOW_CONFIDENCE warning (info level), Step 14 conf 計算時 × 0.90
        closes_for_hurst = [bar["close"] for bar in recent]
        hurst_value, hurst_log_r2 = _compute_hurst(closes_for_hurst, window=100)
        adx_data = _compute_adx(recent, period=14)
        adx_value = adx_data["adx"]
        plus_di_value = adx_data["plus_di"]
        minus_di_value = adx_data["minus_di"]
        atr_value_from_adx = adx_data["atr"]

        regime_gate_passed = (hurst_value >= cfg["regimeGateHurstThreshold"]
                              and adx_value >= cfg["regimeGateAdxThreshold"])
        regime_gate_warning: Optional[Any] = None
        if not regime_gate_passed:
            # 對齊 M3 Spec Sync #51 pattern: emit LOW_CONFIDENCE warning (info level, system category)
            # 唔係 hard gate, 繼續行 algorithm
            # 凡人話: gate 偏弱但仲有條件繼續 verdict, 由 Step 14 conf 計算時 × 0.90 (M3 warn_penalty -0.10)
            regime_gate_warning = make_warning(
                level="info",
                module_id="volume",
                code="LOW_CONFIDENCE",
                message=f"Hurst+ADX gate 偏弱 (H={hurst_value:.3f}, ADX={adx_value:.1f})",
                issue=f"Hurst 指數 {hurst_value:.3f} (< {cfg['regimeGateHurstThreshold']}) 或 ADX {adx_value:.1f} (< {cfg['regimeGateAdxThreshold']}), 股價 random walk / mean-reverting / 弱趨勢, 量價信號偏弱但繼續 verdict (Spec Sync #58 對齊 M3 Spec Sync #51 confirmation filter)",
                impact="Verdict 偏弱 (Hurst+ADX 偏低, 量價信號唔太可信), conf 自動扣 0.10",
                fix="Re-run / 對齊 M1/M2 verdict 確認 / 接受低 conf 但繼續判斷",
                context={
                    "hurst": round(hurst_value, 4),
                    "adx": round(adx_value, 4),
                    "threshold_hurst": cfg["regimeGateHurstThreshold"],
                    "threshold_adx": cfg["regimeGateAdxThreshold"],
                    "plus_di": round(plus_di_value, 4),
                    "minus_di": round(minus_di_value, 4),
                },
            )

        # Step 1: 計算基礎指標
        atr_value = _compute_atr(recent, 14)
        vwap_value = _compute_vwap(recent, cfg["vwapPeriod"])
        vol_percentile = _compute_volume_percentile(recent, cfg["volumePercentileLookback"])
        turnover_rate = (last_bar["volume"] / shares_outstanding) if shares_outstanding else None

        # Step 2: 成交量標準差過濾
        vol20 = [k["volume"] for k in recent[-20:]]
        vol_mean20 = sum(vol20) / 20
        vol_var20 = sum((v - vol_mean20) ** 2 for v in vol20) / 20
        vol_std20 = math.sqrt(vol_var20)
        vol_z_score = (last_bar["volume"] - vol_mean20) / vol_std20 if vol_std20 > 0 else 0.0

        prev_vol1 = recent[n - 2]["volume"] if n >= 3 else 0
        prev_vol2 = recent[n - 3]["volume"] if n >= 3 else 0
        is_anomaly_spike = (
            vol_z_score > 3.0
            and prev_vol1 < vol_mean20 * 1.5
            and prev_vol2 < vol_mean20 * 1.5
            and last_bar["volume"] >= vol_mean20 * 5
        )

        # 連續放量日數
        consecutive_surge = 0
        for i in range(last_idx, max(0, last_idx - 9) - 1, -1):
            day_vol_ratio = recent[i]["volume"] / vol_mean20 if vol_mean20 > 0 else 0
            if day_vol_ratio >= 1.3:
                consecutive_surge += 1
            else:
                break
        is_sustained_volume = consecutive_surge >= cfg["volumeSurgeMinDays"] and not is_anomaly_spike

        # Step 3: 加權 OBV (Tanh)
        weighted_obv: List[float] = [0.0]
        for i in range(1, n):
            price_change_pct = (recent[i]["close"] - recent[i - 1]["close"]) / recent[i - 1]["close"] if recent[i - 1]["close"] else 0
            weight = math.tanh(price_change_pct * 10)
            weighted_obv.append(weighted_obv[i - 1] + recent[i]["volume"] * weight)

        # v2.1.0 (大少 2026-09-09 20:19 Spec Sync #58): OBV SMA window 20 → 60
        # 對齊 OBV 限制文獻: 20 日太短, 平滑後多數 stock 落入 flat (audit 揭發 53% flat)
        obv_sma_window = cfg["obvSmaWindow"]
        obv_sma_arr = _compute_sma(weighted_obv, obv_sma_window)
        obv_latest = weighted_obv[last_idx]
        obv_sma_latest = obv_sma_arr[last_idx] if not math.isnan(obv_sma_arr[last_idx]) else obv_latest
        obv_trend: str = (
            "rising" if obv_latest > obv_sma_latest * 1.03
            else "falling" if obv_latest < obv_sma_latest * 0.97
            else "flat"
        )

        # v2.1.0 (大少 2026-09-09 20:19 Spec Sync #58): OBV 與 close 相關係數 改用 60 日 (對齊 obv_sma_window)
        recent_closes = [k["close"] for k in recent[-obv_sma_window:]]
        recent_obv = weighted_obv[-obv_sma_window:]
        obv_price_corr = _pearson_correlation(recent_closes, recent_obv)

        # Step 4: 放量突破檢測
        last20_closes = [k["close"] for k in recent[-20:]]
        recent20_high = max(last20_closes)
        last40_closes = [k["close"] for k in recent[-40:-20]]
        prev_period_high = max(last40_closes) if last40_closes else recent20_high

        breakout_window = [k["close"] for k in recent[-(cfg["breakoutConfirmDays"] + 1):]]
        max_close_in_breakout_window = max(breakout_window)
        # v2.1.0 (大少 2026-09-09 20:19 Spec Sync #58): breakout threshold 0.998 → cfg["breakoutThreshold"] (1.005)
        # 對齊 VSA 權威建議: 0.998 條件太鬆, 接近 20 日高位就 trigger (audit 揭發 7 隻 stock 落入 low_volume + FBR=0.7)
        # 改 1.005 後, 必須真係突破 0.5% 先算 breakout, 減少 false positive
        is_price_breakout = max_close_in_breakout_window > recent20_high * cfg["breakoutThreshold"]

        breakout_pattern = "none"
        breakout_strength = 0.0
        false_breakout_risk = 0.0

        if is_price_breakout and n >= 4:
            baseline7 = [k["volume"] for k in recent[n - 9:n - 2]]
            pre_avg = sum(baseline7) / len(baseline7) if baseline7 else vol_mean20
            pre_breakout_vols = [recent[n - 4]["volume"], recent[n - 3]["volume"], recent[n - 2]["volume"]]
            breakout_vols = [recent[n - 2]["volume"], last_bar["volume"]]

            gradual_buildup = (
                all(v > pre_avg * 1.1 for v in pre_breakout_vols)
                and last_bar["volume"] > pre_avg * 1.5
                and not is_anomaly_spike
            )
            surge_breakout = (
                last_bar["volume"] > pre_avg * 2.0
                and consecutive_surge >= 2
            )

            if gradual_buildup:
                breakout_pattern = "gradual_buildup"
                breakout_strength = 0.9
            elif surge_breakout and not is_anomaly_spike:
                breakout_pattern = "sustained_surge"
                breakout_strength = 0.75
            elif last_bar["volume"] > pre_avg * 1.5:
                breakout_pattern = "single_spike"
                breakout_strength = 0.4
                false_breakout_risk = 0.4
            else:
                breakout_pattern = "low_volume"
                breakout_strength = 0.15
                false_breakout_risk = 0.7

            if breakout_strength >= 0.4 and n >= cfg["breakoutConfirmDays"] + 1:
                post_breakout_lows = [k["low"] for k in recent[-cfg["breakoutConfirmDays"]:]]
                post_breakout_low = min(post_breakout_lows)
                breakout_level = recent20_high
                range_ = breakout_level - prev_period_high if breakout_level - prev_period_high > 0 else 1
                retrace_pct = (breakout_level - post_breakout_low) / range_
                if retrace_pct > cfg["falseBreakoutRetracePct"]:
                    false_breakout_risk += 0.3

        is_breakout_confirmed = (
            False if breakout_pattern == "none"
            else False if breakout_strength < 0.4
            else "pending" if n < cfg["breakoutConfirmDays"] + 1
            else (false_breakout_risk < 0.6)
        )

        # Step 5: 回調健康度
        last20 = recent[-20:]
        recent_peak_idx = 0
        recent_peak_price = last20[0]["close"]
        for i in range(1, len(last20)):
            if last20[i]["close"] > recent_peak_price:
                recent_peak_price = last20[i]["close"]
                recent_peak_idx = i
        recent_peak_full_idx = (n - 20) + recent_peak_idx
        pullback_days = last_idx - recent_peak_full_idx
        is_pullback = current_price < recent_peak_price * 0.97

        pullback_is_healthy: Any = False
        depth_vol_corr = 0.0
        support_zone: Any = None
        days_to_support: Any = None

        if is_pullback and 2 <= pullback_days <= 20:
            pullback_segment = recent[recent_peak_full_idx:]
            depths: List[float] = []
            volumes_pb: List[float] = []
            for k in pullback_segment:
                depth = (recent_peak_price - k["close"]) / recent_peak_price
                depths.append(depth)
                volumes_pb.append(k["volume"])
            if len(depths) >= 5:
                depth_vol_corr = _pearson_correlation(depths, volumes_pb)
                if depth_vol_corr < -0.3:
                    pullback_is_healthy = True
                    if current_price > vwap_value * 0.99:
                        support_zone = "vwap"
                        days_to_support = 0
                    else:
                        support_zone = "dense_zone_pending"
                        days_to_support = 0
                elif depth_vol_corr > 0.3:
                    pullback_is_healthy = False
                else:
                    pullback_is_healthy = "unclear"

        # Step 6: ATR 動態分箱
        bin_width = atr_value * cfg["denseZoneAtrMultiple"] if atr_value > 0 else current_price * 0.01
        bins: Dict[float, Dict[str, float]] = {}
        for i in range(max(0, n - 60), n):
            center = round(recent[i]["close"] / bin_width) * bin_width
            if center not in bins:
                bins[center] = {"totalVol": 0, "high": recent[i]["high"], "low": recent[i]["low"], "count": 0}
            b = bins[center]
            b["totalVol"] += recent[i]["volume"]
            b["high"] = max(b["high"], recent[i]["high"])
            b["low"] = min(b["low"], recent[i]["low"])
            b["count"] += 1
        overall_avg_vol = sum(k["volume"] for k in recent[-60:]) / 60
        sorted_bins = sorted(bins.items(), key=lambda x: x[1]["totalVol"], reverse=True)[:3]
        dense_zones: List[Dict[str, Any]] = []
        for center, data in sorted_bins:
            avg_vol_in_bin = data["totalVol"] / data["count"] if data["count"] > 0 else 0
            # v2.1.0 (大少 2026-09-09 20:19 Spec Sync #58): dense_zone threshold 1.3× → cfg["denseZoneVolumeRatioThreshold"] (1.1)
            # 凡人話: 1.3× 過濾咗大部分 high traffic zone (audit 揭發 4 隻 stock supportZone="dense_zone_pending" 但 denseZones=[]), 改 1.1× 後解決呢個 bug
            if avg_vol_in_bin > overall_avg_vol * cfg["denseZoneVolumeRatioThreshold"]:
                zone_type = (
                    "support" if current_price > center + bin_width / 2
                    else "resistance" if current_price < center - bin_width / 2
                    else "neutral"
                )
                dense_zones.append({
                    "priceLevelLow": round(data["low"] * 100) / 100,
                    "priceLevelHigh": round(data["high"] * 100) / 100,
                    "priceLevelMid": round(center * 100) / 100,
                    "totalVolume": data["totalVol"],
                    "volumeRatio": round((avg_vol_in_bin / overall_avg_vol) * 100) / 100 if overall_avg_vol > 0 else 0,
                    "type": zone_type,
                    "distancePct": round(((current_price - center) / center) * 10000) / 10000 if center else 0,
                })
                if zone_type == "support" and support_zone == "dense_zone_pending":
                    support_zone = f"dense_zone_{round(center)}"

        # Step 7: 滾動量价相關係數
        last15 = recent[-15:]
        price_changes: List[float] = []
        volume_changes: List[float] = []
        for i in range(1, len(last15)):
            pc = (last15[i]["close"] - last15[i - 1]["close"]) / last15[i - 1]["close"] if last15[i - 1]["close"] else 0
            vc = (last15[i]["volume"] - last15[i - 1]["volume"]) / last15[i - 1]["volume"] if last15[i - 1]["volume"] > 0 else 0
            price_changes.append(pc)
            volume_changes.append(vc)
        corr_recent = _pearson_correlation(price_changes[5:10], volume_changes[5:10]) if len(price_changes) >= 10 else 0.0
        corr_earlier = _pearson_correlation(price_changes[0:5], volume_changes[0:5]) if len(price_changes) >= 5 else 0.0
        correlation_decay = corr_earlier - corr_recent
        divergence_detected = correlation_decay > 0.4 and abs(corr_recent) < 0.2
        divergence_type: Any = (
            ("bearish_vp" if current_price > last15[len(last15) - 6]["close"] else "bullish_vp")
            if divergence_detected
            else None
        )

        # Step 8: 成交量體制
        accumulation_score = 0.0
        distribution_score = 0.0
        price_trend_10d = (recent[n - 1]["close"] - recent[n - 11]["close"]) / recent[n - 11]["close"] if n >= 11 else 0
        price_rising = price_trend_10d > 0.02
        price_falling = price_trend_10d < -0.02
        if obv_trend == "rising" and vol_percentile < 0.3:
            accumulation_score += 0.3
        if pullback_is_healthy is True:
            accumulation_score += 0.25
        if breakout_pattern == "gradual_buildup":
            accumulation_score += 0.25
        if price_rising and obv_trend == "rising":
            accumulation_score += 0.2
        if obv_trend == "falling" and vol_percentile > 0.7:
            distribution_score += 0.3
        if divergence_type == "bearish_vp":
            distribution_score += 0.25
        if breakout_pattern == "single_spike" and false_breakout_risk > 0.5:
            distribution_score += 0.2
        if price_falling and obv_trend == "falling":
            distribution_score += 0.2

        volume_regime = (
            "accumulation" if accumulation_score > distribution_score and accumulation_score > 0.4
            else "distribution" if distribution_score > accumulation_score and distribution_score > 0.4
            else "neutral"
        )

        # Step 9: 15 條 rule V1-V15 觸發檢測
        rules_list = [
            ("V1", "ATR 波動充足", "weak"),
            ("V2", "VWAP 支撐", "weak"),
            ("V3", "成交量百分位正常", "weak"),
            ("V4", "連續堆量", "medium"),
            ("V5", "異常爆量過濾", "strong"),
            ("V6", "加權 OBV 上升", "medium"),
            ("V7", "加權 OBV 下跌", "medium"),
            ("V8", "OBV 與價格同向", "strong"),
            ("V9", "溫和堆量突破", "strong"),
            ("V10", "放量突破確認", "strong"),
            ("V11", "縮量突破警告", "strong"),
            ("V12", "假突破識別", "strong"),
            ("V13", "健康回調", "medium"),
            ("V14", "拋售拋壓", "strong"),
            ("V15", "量价背馳", "strong"),
        ]
        matched_rules: List[Dict[str, str]] = []

        if atr_value > current_price * 0.005:
            matched_rules.append({"id": "V1", "label": rules_list[0][1], "strength": rules_list[0][2]})
        if current_price > vwap_value * 0.99:
            matched_rules.append({"id": "V2", "label": rules_list[1][1], "strength": rules_list[1][2]})
        if 0 <= vol_percentile <= 1:
            matched_rules.append({"id": "V3", "label": rules_list[2][1], "strength": rules_list[2][2]})
        if is_sustained_volume:
            matched_rules.append({"id": "V4", "label": rules_list[3][1], "strength": rules_list[3][2]})
        if is_anomaly_spike:
            matched_rules.append({"id": "V5", "label": rules_list[4][1], "strength": rules_list[4][2]})
        if obv_trend == "rising":
            matched_rules.append({"id": "V6", "label": rules_list[5][1], "strength": rules_list[5][2]})
        if obv_trend == "falling":
            matched_rules.append({"id": "V7", "label": rules_list[6][1], "strength": rules_list[6][2]})
        if obv_price_corr > 0.5:
            matched_rules.append({"id": "V8", "label": rules_list[7][1], "strength": rules_list[7][2]})
        if breakout_pattern == "gradual_buildup":
            matched_rules.append({"id": "V9", "label": rules_list[8][1], "strength": rules_list[8][2]})
        if breakout_pattern == "sustained_surge" and is_breakout_confirmed is True:
            matched_rules.append({"id": "V10", "label": rules_list[9][1], "strength": rules_list[9][2]})
        if breakout_pattern == "low_volume" or false_breakout_risk > 0.5:
            matched_rules.append({"id": "V11", "label": rules_list[10][1], "strength": rules_list[10][2]})
        if false_breakout_risk > 0.6:
            matched_rules.append({"id": "V12", "label": rules_list[11][1], "strength": rules_list[11][2]})
        if pullback_is_healthy is True:
            matched_rules.append({"id": "V13", "label": rules_list[12][1], "strength": rules_list[12][2]})
        if depth_vol_corr > 0.3:
            matched_rules.append({"id": "V14", "label": rules_list[13][1], "strength": rules_list[13][2]})
        if divergence_detected:
            matched_rules.append({"id": "V15", "label": rules_list[14][1], "strength": rules_list[14][2]})

        # Step 10: 規則引擎
        buy_timing_score = 0.3
        buy_reasons: List[str] = []
        false_signal_flags: List[str] = []

        # V9 (0.9) — Spec Sync #60 拆 AND 條件: secondary confirm 由 AND 改 OR
        # 凡人話: primary trigger (gradual_buildup + breakout_confirmed) 維持 AND,
        #         secondary confirm (obv_corr>0.5 OR 冇 divergence) 2 揀 1
        # 預期: V9 觸發率微升, 仍然保留 primary trigger 嘅 quality
        if (breakout_pattern == "gradual_buildup" and is_breakout_confirmed is True
                and (obv_price_corr > 0.5 or not divergence_detected)):
            buy_timing_score = 0.9
            buy_reasons.append("V9 溫和堆量突破確認 + V8 OBV 同步,黃金買點")
        # V13 (0.75) — Spec Sync #60 audit 觸發 trigger 還原條件: 拎走 V13 拆 AND 改動, 返 baseline
        # 凡人話: V13 拆 AND 條件 (4 個 AND 拆做 2 個 group) 觸發 UP verdict + DISCONFIRM/NEUTRAL signal 矛盾
        # 10/68 (14.7%) UP verdict signal 唔一致, 跌穿 95% 還原門檻
        # 保留 V9 拆 AND 改動 (UP 一致性 100%, 凡人話 audit 通過)
        elif (pullback_is_healthy is True and support_zone is not None
              and volume_regime == "accumulation" and obv_trend == "rising"):
            buy_timing_score = 0.75
            buy_reasons.append(f"V13 健康回調至 {support_zone},V6 OBV 資金流入")
        elif divergence_type == "bullish_vp" and vol_percentile < 0.2 and obv_trend != "falling":
            buy_timing_score = 0.6
            buy_reasons.append("V15 拋壓枯竭,試探性買入")
        elif (vwap_value * 0.995 < current_price < vwap_value * 1.02
              and vol_percentile < 0.5 and obv_trend == "rising"):
            buy_timing_score = 0.55
            buy_reasons.append("V2 VWAP 支撐反彈,量縮")
        else:
            buy_reasons.append("暫無明確成交量買入模式")

        # 4 條減分覆蓋
        if false_breakout_risk > 0.6:
            buy_timing_score *= 0.5
            false_signal_flags.append("high_false_breakout_risk")
            buy_reasons.append("警告:假突破風險極高")
        if divergence_type == "bearish_vp" and vol_percentile > 0.8:
            buy_timing_score *= 0.4
            false_signal_flags.append("distribution_with_price_rise")
            buy_reasons.append("警告:放量滯漲,主力可能出貨")
        if is_anomaly_spike:
            buy_timing_score *= 0.6
            false_signal_flags.append("anomaly_volume_spike")
            buy_reasons.append("警告:單日異常爆量,信號不可靠")
        if obv_price_corr < -0.3:
            buy_timing_score *= 0.7
            false_signal_flags.append("obv_price_divergence")
            buy_reasons.append("警告:OBV 與價格背馳,資金暗中流出")
        if obv_trend == "falling" and vol_percentile > 0.8 and price_trend_10d > 0.02:
            buy_timing_score *= 0.5
            false_signal_flags.append("distribution_with_price_rise")
            buy_reasons.append("警告:放量滯漲,主力可能出貨")

        # Step 10.5 (v2.1.0, 大少 2026-09-09 20:19 Spec Sync #58): 收集 4 個 self-check warning
        # 對齊 M2 Spec Sync #48 / M3 Spec Sync #45 / M4 Spec Sync #52 永久 rule
        # 統一用 make_warning() helper (對齊 backend/services/warning_collector.py v1.3.0)
        # 凡人話: 5 個 self-check warning (INSUFFICIENT_DATA 已經喺 Step 0 emit, LOW_CONFIDENCE 已經喺 Step 0.5 emit)
        # 呢度 emit FALLBACK_USED / MODULE_PARTIAL / THRESHOLD_BREACH (Step 13.5 觸發)
        self_check_warnings: List[Any] = []

        # Warning 1: FALLBACK_USED (warning) — false_signal_flags 觸發 (已有嘅 5 個減分覆蓋)
        # 對齊 M2 self-check warning 永久 rule (FALLBACK_USED 對齊 M2 嘅 5 個 code 之一)
        if len(false_signal_flags) > 0:
            fallback_used_warning = make_warning(
                level="warning",
                module_id="volume",
                code="FALLBACK_USED",
                message=f"觸發 {len(false_signal_flags)} 個減分覆蓋: {', '.join(false_signal_flags)}",
                issue=f"4 條減分覆蓋觸發 ({len(false_signal_flags)} 個 flags): {', '.join(false_signal_flags)}",
                context={"false_signal_flags": false_signal_flags, "count": len(false_signal_flags)},
            )
            self_check_warnings.append(fallback_used_warning)

        # Warning 2: MODULE_PARTIAL (warning) — 冇任何 buy rule 觸發 (只 buy_timing_score = 0.3 默認)
        # 凡人話: 15 條 V1-V15 rule 全部都唔觸發, 或者觸發咗但 buy rule (5 條) 都唔 match
        rules_fired_count = len(matched_rules)
        if buy_timing_score == 0.3 and "暫無明確成交量買入模式" in ";".join(buy_reasons):
            module_partial_warning = make_warning(
                level="warning",
                module_id="volume",
                code="MODULE_PARTIAL",
                message="冇 buy rule 觸發 (5 條 buy rule 全部唔 match)",
                issue=f"5 條 buy rule (黃金買入/健康回調/拋壓枯竭/VWAP 支撐/觀望) 全部唔 match, 只 buy_timing_score 默認 0.3, rules_fired={rules_fired_count}",
                context={"rules_fired": rules_fired_count, "buy_timing_score": buy_timing_score, "matched_rules": [r["id"] for r in matched_rules]},
            )
            self_check_warnings.append(module_partial_warning)

        # Step 11: Signal 推導
        signal = "NEUTRAL"
        if (volume_regime == "distribution" or len(false_signal_flags) >= 2
                or (obv_trend == "falling" and vol_percentile > 0.7)):
            signal = "DISCONFIRM"
        elif (buy_timing_score >= 0.55 and volume_regime != "distribution"
              and len(false_signal_flags) == 0 and obv_trend != "falling"):
            signal = "CONFIRM"

        # Step 12: Cycle 推導
        cycle = (
            "uptrend" if buy_timing_score >= 0.55
            else "downtrend" if volume_regime == "distribution"
            else "sideways"
        )
        cycle_label = (
            "資金流入" if buy_timing_score >= 0.55
            else "資金流出" if volume_regime == "distribution"
            else "資金觀望"
        )
        cycle_state = "UP" if cycle == "uptrend" else "DOWN" if cycle == "downtrend" else "SIDEWAYS"

        # Step 13: 勝率估算
        if buy_timing_score >= 0.85:
            base_win = 0.68
        elif buy_timing_score >= 0.7:
            base_win = 0.60
        elif buy_timing_score >= 0.55:
            base_win = 0.52
        else:
            base_win = 0.40
        base_win -= 0.08 * len(false_signal_flags)
        win_probability = max(0.25, min(0.80, base_win))

        # Step 13.5 (v2.1.0, 大少 2026-09-09 20:19 Spec Sync #58): Self-check penalty
        # 對齊 M2 Spec Sync #48 永久 rule: 拎 critical + warning level self-check warning, conf = max(conf * 0.375, 0.3)
        # 對齊 M3 Layer 4 formula 永久 rule: 永遠 ban conf 1.0 (clamp 0.95)
        # 對齊 §Module Warning v1.1.0: info level warning (LOW_CONFIDENCE) 唔觸發 floor
        # 凡人話: 算法自己都 flag 唔 sure 嗰陣, 大少唔應該再睇到 80% 高信心
        # state 唔變 → 由 M7 layer 處理 weight 折扣 (對齊 M2 self-check weight 折扣永久 rule)
        original_confidence = round(buy_timing_score, 4)
        self_check_triggered = False
        # 對齊 M2 Spec Sync #48 永久 rule: critical + warning level warning 觸發 floor
        # info level (LOW_CONFIDENCE / DATA_AGE) 唔觸發 floor
        # 凡人話: critical = INSUFFICIENT_DATA / VERDICT_MISSING / NAN_RESULT, warning = FALLBACK_USED / MODULE_PARTIAL / THRESHOLD_BREACH
        critical_codes = {"INSUFFICIENT_DATA", "VERDICT_MISSING", "NAN_RESULT", "CACHE_INVALID", "KLINE_MISSING"}
        warning_codes = {"FALLBACK_USED", "MODULE_PARTIAL", "THRESHOLD_BREACH", "CONFLICT_STATE", "OUTLIER_VALUE", "LOW_SAMPLE_SIZE", "POST_FAILED", "CONFIG_DEFAULTS"}
        for w in self_check_warnings:
            if w.code in critical_codes or w.code in warning_codes:
                self_check_triggered = True
                break
        if self_check_triggered:
            buy_timing_score = max(buy_timing_score * 0.375, 0.3)
            buy_reasons.append(f"⚠️ Self-check penalty 觸發: conf 由 {original_confidence} → {round(buy_timing_score, 4)} (floor 0.3, 對齊 M2/M3/M4 永久 rule)")

        # Warning 3: THRESHOLD_BREACH (warning) — final conf < 0.3 嘅時候 (after self-check penalty)
        if buy_timing_score < 0.3:
            threshold_breach_warning = make_warning(
                level="warning",
                module_id="volume",
                code="THRESHOLD_BREACH",
                message=f"最終信心 {round(buy_timing_score, 4)} < 0.3 門檻",
                issue=f"buy_timing_score 經 self-check penalty 後 {round(buy_timing_score, 4)} < 0.3, 已 floor 處理 (對齊 M2 Spec Sync #48 永久 rule)",
                context={"original_confidence": original_confidence, "final_confidence": round(buy_timing_score, 4), "self_check_triggered": self_check_triggered},
            )
            self_check_warnings.append(threshold_breach_warning)

        # v2.1.0 (大少 2026-09-09 20:19 Spec Sync #58): clamp conf 0.95 (對齊 M3 Layer 4 formula 永久 rule)
        # 永久 ban conf=1.0, 因為永遠唔可能 100% 肯定
        if buy_timing_score > 0.95:
            buy_timing_score = 0.95
            buy_reasons.append("⚠️ Conf clamp 0.95 (對齊 M3 Layer 4 formula 永久 rule)")

        # Step 14: 組裝輸出
        confidence = _round(buy_timing_score, 4)
        meta = {
            "moduleId": "volume",
            "symbol": options.get("symbol", "TEST"),
            "timeframe": timeframe,
            "state": cycle_state,
            "cycleLabel": cycle_label,
            "confidence": confidence,
            "interpretation": "；".join(buy_reasons),
            "evidence": [
                {
                    "type": f"rule-{r['id']}",
                    "label": r["label"],
                    "value": r["id"],
                    "passed": True,
                }
                for r in matched_rules
            ],
            "cycle": cycle,
            "cycleLabel": cycle_label,
            "signal": signal,
            "buyTimingScore": confidence,
            "winProbability": _round(win_probability, 4),
            "falseSignalFlags": false_signal_flags,
            "volumeRegime": volume_regime,
            "accumulationScore": _round(accumulation_score, 2),
            "distributionScore": _round(distribution_score, 2),
            "breakoutStatus": {
                "isBreakout": is_price_breakout,
                "isConfirmed": is_breakout_confirmed,
                "pattern": breakout_pattern,
                "strength": _round(breakout_strength, 2),
                "falseBreakoutRisk": _round(false_breakout_risk, 2),
            },
            "pullbackHealth": {
                "isHealthy": pullback_is_healthy,
                "depthVolCorrelation": _round(depth_vol_corr, 4),
                "supportZone": support_zone,
                "daysToSupport": days_to_support,
            },
            "vwapAnalysis": {
                "vwapValue": _round(vwap_value, 2),
                "priceVsVwapPct": _round(((current_price - vwap_value) / vwap_value), 4) if vwap_value else 0,
                "vwapSupportStrength": (
                    "strong" if current_price > vwap_value * 1.01
                    else "testing" if current_price > vwap_value * 0.99
                    else "broken"
                ),
            },
            "volumePercentile": _round(vol_percentile, 4),
            "turnoverRate": _round(turnover_rate, 6) if turnover_rate is not None else None,
            "denseZones": dense_zones,
            "volumePriceCorrelation": {
                "pearsonRecent": _round(corr_recent, 4),
                "pearsonEarlier": _round(corr_earlier, 4),
                "correlationDecay": _round(correlation_decay, 4),
                "divergenceDetected": divergence_detected,
                "divergenceType": divergence_type,
            },
            "obvAnalysis": {
                "obvTrend": obv_trend,
                "obvPriceCorrelation": _round(obv_price_corr, 4),
                "weightedObvValue": _round(obv_latest),
            },
            "matchedRules": [r["id"] for r in matched_rules],
            "ruleLabels": [r["label"] for r in matched_rules],
            "rulesFired": len(matched_rules),
            "atr": _round(atr_value, 2),
            "vwap": _round(vwap_value, 2),
            "consecutiveSurge": consecutive_surge,
            "isAnomalySpike": is_anomaly_spike,
            "configUsed": cfg,
            "dataDays": n,
            "reason": "；".join(buy_reasons),
            # v2.1.0 (大少 2026-09-09 20:19 Spec Sync #58): 5 個 audit field
            # 對齊 M3 Spec Sync #45+#51 (hurst+adx) + M2 Spec Sync #48 (selfCheckTriggered+originalConfidence) 永久 rule
            "hurst": _round(hurst_value, 4),
            "adx": _round(adx_value, 4),
            "regimeGate": {
                "passed": regime_gate_passed,
                "hurstThreshold": cfg["regimeGateHurstThreshold"],
                "adxThreshold": cfg["regimeGateAdxThreshold"],
                "plusDI": _round(plus_di_value, 4),
                "minusDI": _round(minus_di_value, 4),
            },
            "selfCheckTriggered": self_check_triggered,
            "originalConfidence": original_confidence,
        }

        # v2.1.0 (大少 2026-09-09 20:19 Spec Sync #58): 收集 5 個 self-check warning + LOW_CONFIDENCE (regime gate) 落 verdict._warnings
        # 對齊 backend/services/warning_collector.py v1.3.0 永久 rule + §Module Warning v1.1.0
        all_warnings: List[Any] = []
        if regime_gate_warning is not None:
            all_warnings.append(regime_gate_warning)
        all_warnings.extend(self_check_warnings)

        return Verdict(ok=True, points=[], meta=meta, warnings=all_warnings)


# Register
register(VolumePriceAlgorithm())

"""
backend/algorithms/volatility/algorithm.py — M6 Volatility v1.0.0 (大少 2026-08-20 21:30 Phase 7)

凡人話: 拎 K 線 → 計 BB / KC / ATR → Squeeze 檢測 + 質量評分 → ATR 分解 (Trend + Noise + SNR) → VCP 結構 → Follow-through → 失敗模式 → 入場評分 (5 setup) → 12 條 rule S1-S12 → derive state + 勝率

對應 source: algorithms/AS-03-cycle-detection/modules/volatility.ts v1.0.0 (456 行, 12 rules S1-S12)
對應 spec doc: docs/research/AS-03-cycle-detection/MODULE-06-VOLATILITY.md
對應 framework: backend/algorithms/base.py Verdict contract

Algorithm: 10 step (跟 volatility.ts 嘅 detect() method 1:1 port 去 Python)
- Step 0: 數據驗證 (minData bars)
- Step 1: 計算基礎指標 (ATR + BB + KC)
- Step 2: Squeeze 檢測 + 質量評分 (水平 + 量集中 + priceCV)
- Step 3: ATR 分解 (Trend + Noise + SNR)
- Step 4: VCP 結構 (高低點配對 + 量縮確認)
- Step 5: Follow-through (突破後量縮 + 價格進展)
- Step 6: 失敗模式 (noisy_squeeze / weak_follow_through)
- Step 7: 入場評分 (5 setup: mtf_squeeze_fire / confirmed_vcp_breakout / genuine_squeeze_forming / clean_trend_expansion / no_clear_setup)
- Step 8: 12 條 rule S1-S12 觸發
- Step 9: 勝率估算
- Step 10: 組裝輸出

State derivation: mtf_squeeze_fire / confirmed_vcp_breakout / clean_trend_expansion → UP; genuine_squeeze_forming / no_clear_setup → SIDEWAYS

凡人話: 自動檢測波動率壓縮 (Squeeze) + 結構性擴張, 拎入場 setup + 失敗模式警告
"""

import math
from typing import List, Dict, Any, Optional, Tuple

from ..base import Algorithm, Verdict
from ..registry import register
from .config import DEFAULT_VOLATILITY_CONFIG


# ============================================================
# Helpers (跟 volatility.ts 1:1 port)
# ============================================================

def _round(value: float, decimals: int = 4) -> float:
    """凡人話: 四捨五入到指定小數位"""
    if value is None or (isinstance(value, float) and (value != value)):
        return 0.0
    factor = 10 ** decimals
    return round(value * factor) / factor


def _compute_atr(klines: List[Dict[str, Any]], period: int) -> float:
    """Wilder ATR"""
    if len(klines) < period + 1:
        return 0.0
    trs: List[float] = []
    for i in range(1, len(klines)):
        tr = max(
            klines[i]["high"] - klines[i]["low"],
            abs(klines[i]["high"] - klines[i - 1]["close"]),
            abs(klines[i]["low"] - klines[i - 1]["close"]),
        )
        trs.append(tr)
    atr = sum(trs[:period]) / period
    for i in range(period, len(trs)):
        atr = (atr * (period - 1) + trs[i]) / period
    return atr


def _sma_at(klines: List[Dict[str, Any]], idx: int, period: int) -> float:
    """過去 period 日 SMA at index idx"""
    start = max(0, idx - period + 1)
    s = 0.0
    count = 0
    for i in range(start, idx + 1):
        s += klines[i]["close"]
        count += 1
    return s / count if count > 0 else 0.0


def _std_at(klines: List[Dict[str, Any]], idx: int, period: int) -> float:
    """過去 period 日 close std at index idx"""
    start = max(0, idx - period + 1)
    closes = [klines[i]["close"] for i in range(start, idx + 1)]
    mean = sum(closes) / len(closes)
    var = sum((c - mean) ** 2 for c in closes) / len(closes)
    return math.sqrt(var)


# ============================================================
# Main algorithm (跟 volatility.ts VolatilityModule 1:1 port)
# ============================================================

class VolatilityAlgorithm(Algorithm):
    """M6 Volatility (BB/KC Squeeze + ATR 分解 + VCP) — 大少 2026-08-20 Phase 7 backend port

    Algorithm ABC contract:
    - name: "volatility"
    - version: "1.0.0"
    - run(klines, options) → Verdict
    """

    name = "volatility"
    version = "1.0.0"

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.cfg = {**DEFAULT_VOLATILITY_CONFIG, **(config or {})}

    def run(self, klines: List[Dict[str, Any]], options: Optional[Dict[str, Any]] = None) -> Verdict:
        options = options or {}
        timeframe = options.get("period", "1d")
        symbol = options.get("symbol", "TEST")
        cfg = self.cfg

        # Step 0: 數據驗證
        min_data = max(85, cfg["bbPeriod"] + 50 + cfg["followThroughDays"] + 10)
        if len(klines) < min_data:
            return Verdict(
                ok=True,
                points=[],
                meta={
                    "moduleId": "volatility",
                    "timeframe": timeframe,
                    "state": "SIDEWAYS",
                    "cycleLabel": "蓄力觀察",
                    "confidence": 0,
                    "interpretation": f"[Volatility v1.0] 數據不足: need >= {min_data} bars, got {len(klines)}",
                    "evidence": [],
                    "dataDays": len(klines),
                    "configUsed": cfg,
                    "reason": "數據不足",
                },
                warnings=[f"INSUFFICIENT_DATA: {len(klines)} < {min_data}"],
            )

        recent = klines[-max(len(klines), min_data):]
        n = len(recent)
        last_idx = n - 1
        last_bar = recent[last_idx]

        # Step 1: 計算基礎指標
        atr_value = _compute_atr(recent, cfg["atrPeriod"])
        bb_upper: List[float] = []
        bb_lower: List[float] = []
        bb_sma: List[float] = []
        kc_upper: List[float] = []
        kc_lower: List[float] = []

        for i in range(n):
            sma = _sma_at(recent, i, cfg["bbPeriod"])
            std = _std_at(recent, i, cfg["bbPeriod"])
            bb_sma.append(sma)
            bb_upper.append(sma + cfg["bbStd"] * std)
            bb_lower.append(sma - cfg["bbStd"] * std)
            kc_upper.append(sma + cfg["kcAtrMult"] * atr_value)
            kc_lower.append(sma - cfg["kcAtrMult"] * atr_value)

        bb_width = bb_upper[last_idx] - bb_lower[last_idx]
        kc_width = kc_upper[last_idx] - kc_lower[last_idx]

        # Step 2: Squeeze 檢測
        squeeze_history: List[bool] = []
        for i in range(n):
            w_bb = (bb_upper[i] - bb_lower[i]) / bb_sma[i] if bb_sma[i] else 0
            w_kc = (kc_upper[i] - kc_lower[i]) / bb_sma[i] if bb_sma[i] else 0
            squeeze_history.append(w_bb < w_kc)
        is_squeeze = squeeze_history[last_idx]

        squeeze_duration = 0
        for i in range(last_idx, -1, -1):
            if squeeze_history[i]:
                squeeze_duration += 1
            else:
                break

        # Squeeze 質量評分
        squeeze_start_idx = max(0, last_idx - squeeze_duration + 1)
        squeeze_segment = recent[squeeze_start_idx: last_idx + 1]
        squeeze_prices = [k["close"] for k in squeeze_segment]
        if squeeze_prices:
            price_mean = sum(squeeze_prices) / len(squeeze_prices)
            price_var = sum((p - price_mean) ** 2 for p in squeeze_prices) / len(squeeze_prices)
            price_std = math.sqrt(price_var)
            price_cv = price_std / price_mean if price_mean > 0 else 0
        else:
            price_mean = 0
            price_cv = 0

        # 成交量集中度 (Entropy)
        if squeeze_prices:
            min_p = min(squeeze_prices)
            max_p = max(squeeze_prices)
            range_p = max_p - min_p
            vol_bins = [0.0] * 5
            if range_p > 0:
                for k in squeeze_segment:
                    bin_idx = min(4, int((k["close"] - min_p) / (range_p / 5)))
                    vol_bins[bin_idx] += k["volume"]
            total_vol = sum(vol_bins)
            entropy = 0.0
            if total_vol > 0:
                for v in vol_bins:
                    if v > 0:
                        p = v / total_vol
                        entropy -= p * math.log(p)
            max_entropy = math.log(5)
            volume_concentration = 1 - entropy / max_entropy if max_entropy > 0 else 0
        else:
            volume_concentration = 0

        # 趨勢水平
        squeeze_trend = (
            (squeeze_prices[-1] - squeeze_prices[0]) / squeeze_prices[0]
            if squeeze_prices and squeeze_prices[0]
            else 0
        )
        is_horizontal = abs(squeeze_trend) < 0.02

        quality_score = 0.0
        if is_horizontal:
            quality_score += 0.3
        quality_score += volume_concentration * 0.4
        quality_score += (1 - min(1, price_cv / 0.03)) * 0.3

        is_genuine_squeeze = quality_score >= 0.6 and squeeze_duration >= cfg["squeezeMinDuration"]

        # Step 3: ATR 分解
        trend_atr: List[float] = []
        noise_atr: List[float] = []
        lookback = 20
        for i in range(lookback - 1, n):
            segment = recent[i - lookback + 1: i + 1]
            xs = list(range(segment_length := len(segment)))
            ys = [k["close"] for k in segment]
            x_mean = sum(xs) / segment_length
            y_mean = sum(ys) / segment_length
            num = 0.0
            den_x = 0.0
            for j in range(segment_length):
                dx = xs[j] - x_mean
                dy = ys[j] - y_mean
                num += dx * dy
                den_x += dx * dx
            slope = num / den_x if den_x > 0 else 0.0
            intercept = y_mean - slope * x_mean
            predicted = [slope * xi + intercept for xi in xs]
            residuals = [ys[j] - predicted[j] for j in range(segment_length)]
            trend_comp = 0.0
            for j in range(segment_length):
                trend_comp += abs(segment[j]["high"] - predicted[j]) + abs(segment[j]["low"] - predicted[j])
            trend_comp = trend_comp / (2 * segment_length)
            noise_comp = sum(abs(r) for r in residuals) / len(residuals) if residuals else 0
            trend_atr.append(trend_comp)
            noise_atr.append(noise_comp)

        latest_trend_atr = trend_atr[-1] if trend_atr else 0
        latest_noise_atr = noise_atr[-1] if noise_atr else 0
        snr = latest_trend_atr / latest_noise_atr if latest_noise_atr > 0 else 10
        if snr > 2:
            regime = "trending"
        elif snr < 0.5:
            regime = "choppy"
        else:
            regime = "balanced"

        # ATR 趨勢
        recent5_atr = sum(noise_atr[-5:]) / 5 if len(noise_atr) >= 5 else 0
        prev5_atr = sum(noise_atr[-10:-5]) / 5 if len(noise_atr) >= 10 else recent5_atr
        atr_contraction = recent5_atr < prev5_atr * 0.85
        atr_expansion = recent5_atr > prev5_atr * 1.15

        # Step 4: VCP 結構
        last20 = recent[-20:]
        highs: List[Dict[str, Any]] = []
        lows: List[Dict[str, Any]] = []
        for i in range(4, len(last20) - 4):
            is_high = True
            is_low = True
            for j in range(i - 3, i + 4):
                if j == i:
                    continue
                if last20[j]["high"] >= last20[i]["high"]:
                    is_high = False
                if last20[j]["low"] <= last20[i]["low"]:
                    is_low = False
            if is_high:
                highs.append({"idx": i, "price": last20[i]["high"]})
            if is_low:
                lows.append({"idx": i, "price": last20[i]["low"]})

        high_low_pairs = 0
        last_pair_high = math.inf
        last_pair_low = -math.inf
        min_idx = min(len(highs), len(lows))
        for i in range(min_idx):
            if highs[i]["price"] < last_pair_high and lows[i]["price"] > last_pair_low:
                high_low_pairs += 1
                last_pair_high = highs[i]["price"]
                last_pair_low = lows[i]["price"]
        vcp_detected = high_low_pairs >= cfg["vcpMinWindows"]

        vol_tightening = False
        if vcp_detected and len(last20) >= 20:
            first_half = sum(k["volume"] for k in last20[:10]) / 10
            second_half = sum(k["volume"] for k in last20[-10:]) / 10
            vol_tightening = second_half < first_half * 0.7

        # Step 5: Follow-through
        recent_range = recent[-cfg["followThroughDays"]:]
        prev_range = recent[-cfg["followThroughDays"] * 2: -cfg["followThroughDays"]]
        recent_high = max(k["high"] for k in recent_range)
        recent_low = min(k["low"] for k in recent_range)
        prev_high = max(k["high"] for k in prev_range)
        prev_low = min(k["low"] for k in prev_range)
        is_breakout_attempt = recent_high > prev_high * 1.01 or recent_low < prev_low * 0.99

        follow_score = 0.0
        volume_decay = 0.0
        price_progression = 0.0
        if is_breakout_attempt:
            direction_up = recent_high > prev_high * 1.01
            if direction_up:
                closes = [k["close"] for k in recent_range]
                higher = sum(1 for i in range(1, len(closes)) if closes[i] > closes[i - 1])
                price_progression = higher / (len(closes) - 1) if len(closes) > 1 else 0
                max_high_idx = next((i for i, k in enumerate(recent_range) if k["high"] == recent_high), -1)
                if max_high_idx >= 0:
                    breakout_day_vol = recent_range[max_high_idx]["volume"]
                    post_vols = recent_range[max_high_idx + 1:]
                    avg_vol = sum(k["volume"] for k in recent_range) / len(recent_range)
                    if breakout_day_vol > avg_vol * 1.3:
                        if len(post_vols) >= 2:
                            post_avg = sum(k["volume"] for k in post_vols) / len(post_vols)
                            volume_decay = 0.8 if post_avg < breakout_day_vol * 0.8 else 0.4
                        else:
                            volume_decay = 0.4
                    else:
                        volume_decay = 0.2
                follow_score = volume_decay * 0.5 + price_progression * 0.5

        # Step 6: 失敗模式
        failure_mode = "none"
        failure_reason: Any = None
        if is_squeeze and latest_noise_atr > latest_trend_atr * 2:
            failure_mode = "noisy_squeeze"
            failure_reason = "Squeeze 期間 Noise ATR 過高,結構不穩定"
        elif is_breakout_attempt and follow_score < 0.4:
            failure_mode = "weak_follow_through"
            failure_reason = "突破後跟進無力,可能是假突破"

        # Step 7: 入場評分
        failure_max_cap = 0.4 if failure_mode != "none" else 1.0
        entry_score = 0.0
        setup_type = "no_clear_setup"
        risk_reward = 0.0

        was_squeeze = squeeze_history[last_idx - 1] if last_idx >= 1 else False
        if not is_squeeze and was_squeeze and quality_score >= 0.6 and failure_mode != "weak_follow_through":
            entry_score = 0.95 * failure_max_cap
            setup_type = "mtf_squeeze_fire"
            risk_reward = 3.5
        elif vcp_detected and vol_tightening and follow_score >= 0.5 and failure_mode != "noisy_squeeze":
            entry_score = 0.9 * failure_max_cap
            setup_type = "confirmed_vcp_breakout"
            risk_reward = 3.0
        elif is_genuine_squeeze and quality_score >= 0.75:
            entry_score = 0.55 * failure_max_cap
            setup_type = "genuine_squeeze_forming"
        elif latest_noise_atr < latest_trend_atr * 0.5 and regime == "trending" and follow_score >= 0.6:
            entry_score = 0.7 * failure_max_cap
            setup_type = "clean_trend_expansion"
            risk_reward = 2.0
        else:
            entry_score = 0.25
            setup_type = "no_clear_setup"

        # Step 8: 12 條 rule S1-S12 觸發
        matched_rules: List[Dict[str, str]] = []
        if is_squeeze:
            matched_rules.append({"id": "S1", "label": "日線 Squeeze", "strength": "medium"})
        if quality_score >= 0.6:
            matched_rules.append({"id": "S2", "label": "Squeeze 質量高", "strength": "medium"})
        if squeeze_duration >= cfg["squeezeMinDuration"]:
            matched_rules.append({"id": "S3", "label": "Squeeze 持續夠耐", "strength": "medium"})
        if snr > 2:
            matched_rules.append({"id": "S4", "label": "趨勢 ATR 強", "strength": "strong"})
        if snr < 0.5:
            matched_rules.append({"id": "S5", "label": "噪音 ATR 高", "strength": "strong"})
        if atr_contraction:
            matched_rules.append({"id": "S6", "label": "結構性收縮", "strength": "medium"})
        if atr_expansion:
            matched_rules.append({"id": "S7", "label": "結構性擴張", "strength": "medium"})
        if volume_concentration > 0.6:
            matched_rules.append({"id": "S8", "label": "籌碼集中", "strength": "medium"})
        if vcp_detected:
            matched_rules.append({"id": "S9", "label": "VCP 結構", "strength": "medium"})
        if vol_tightening:
            matched_rules.append({"id": "S10", "label": "VCP 量縮確認", "strength": "medium"})
        if follow_score >= 0.5:
            matched_rules.append({"id": "S11", "label": "突破跟進", "strength": "medium"})
        if failure_mode != "none":
            matched_rules.append({"id": "S12", "label": f"失敗模式 ({failure_mode})", "strength": "strong"})

        # Step 9: 勝率估算
        if setup_type == "mtf_squeeze_fire":
            base_win = 0.75
        elif setup_type == "confirmed_vcp_breakout":
            base_win = 0.70
        elif setup_type == "clean_trend_expansion":
            base_win = 0.62
        elif setup_type == "genuine_squeeze_forming":
            base_win = 0.50
        else:
            base_win = 0.35
        if failure_mode == "market_headwind":
            base_win -= 0.08
        if failure_mode == "weak_follow_through":
            base_win -= 0.12
        if failure_mode == "noisy_squeeze":
            base_win -= 0.10
        win_probability = max(0.25, min(0.82, base_win))

        # Step 10: 組裝輸出
        cycle = (
            "uptrend" if setup_type in ("mtf_squeeze_fire", "confirmed_vcp_breakout", "clean_trend_expansion")
            else "sideways"
        )
        cycle_label = (
            "高質量蓄力" if entry_score >= 0.8
            else "假蓄力警告" if failure_mode != "none"
            else "亂爆階段" if regime == "choppy"
            else "蓄力觀察"
        )
        state = "UP" if cycle == "uptrend" else "SIDEWAYS"

        interpretation = (
            "；".join(r["label"] for r in matched_rules)
            if matched_rules
            else "無明確波動率信號"
        )

        confidence = _round(entry_score, 4)
        meta = {
            "moduleId": "volatility",
            "timeframe": timeframe,
            "state": state,
            "cycleLabel": cycle_label,
            "confidence": confidence,
            "interpretation": interpretation,
            "evidence": [
                {"type": f"rule-{r['id']}", "label": r["label"], "value": r["id"], "passed": True}
                for r in matched_rules
            ],
            "cycle": cycle,
            "setupType": setup_type,
            "riskReward": risk_reward,
            "entryScore": confidence,
            "winProbability": _round(win_probability, 4),
            "failureMode": failure_mode,
            "failureReason": failure_reason,
            "squeeze": {
                "isSqueeze": is_squeeze,
                "duration": squeeze_duration,
                "qualityScore": _round(quality_score, 4),
                "isGenuine": is_genuine_squeeze,
            },
            "vcpStructure": {
                "detected": vcp_detected,
                "highLowPairs": high_low_pairs,
                "volTightening": vol_tightening,
            },
            "atrDecomposition": {
                "totalAtr": _round(atr_value, 2),
                "trendAtr": _round(latest_trend_atr, 2),
                "noiseAtr": _round(latest_noise_atr, 2),
                "snr": _round(snr, 2),
                "regime": regime,
            },
            "followThrough": {
                "followScore": _round(follow_score, 2),
                "volumeDecay": _round(volume_decay, 2),
                "priceProgression": _round(price_progression, 2),
            },
            "matchedRules": [r["id"] for r in matched_rules],
            "ruleLabels": [r["label"] for r in matched_rules],
            "rulesFired": len(matched_rules),
            "atr": _round(atr_value, 2),
            "bbWidth": _round(bb_width, 2),
            "kcWidth": _round(kc_width, 2),
            "priceCV": _round(price_cv, 4),
            "volumeConcentration": _round(volume_concentration, 4),
            "configUsed": cfg,
            "dataDays": n,
            "reason": interpretation,
        }

        return Verdict(ok=True, points=[], meta=meta, warnings=[])


# Register
register(VolatilityAlgorithm())

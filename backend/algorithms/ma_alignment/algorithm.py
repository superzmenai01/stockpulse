"""
backend/algorithms/ma-alignment/algorithm.py — M1 MA Alignment v2.0 (大少 2026-08-20 20:05 Phase 2, v2.2.0 adaptive 2026-08-21)

凡人話: 拎 K 線 → 計算 MA5/MA10/MA20/MA60 → 判定 9 個 sub-scenario cycle + 6 個 cycle position

對應 backup: backups/zigzag-frontend-2026-08-20/(adapter.mjs / ma-alignment.ts)
對應 source: algorithms/AS-03-cycle-detection/modules/ma-alignment.ts (551 行, v0.3.0 + 9 個 sub-scenario)
對應 ref code: 大少 2026-08-15 9 個 sub-scenario 永久 rule (M1-V22-RESEARCH.md)
對應 framework: backend/algorithms/base.py Verdict contract

Algorithm: 8 個 step (跟 ma-alignment.ts 嘅 detect() method 1:1 port 去 Python)
- Step 1: Input validation
- Step 2: 計算各週期 MA latest value
- Step 3: MA ranks + candidate (uptrend / downtrend / sideways)
- Step 4: Spread + 橫行精細判定 (v2.2.0: adaptive thresholdPct)
- Step 5: Volume trend + signal
- Step 5.5: 9 個 sub-scenario 細分判定 (大少 2026-08-15 永久 rule)
- Step 6: MA slopes + momentum score
- Step 7: Confidence (base × vol × slope, 三階段調整)
- Step 8: 組裝 verdict (跟 frontend verdict shape 100% 兼容)

v2.2.0 改動 (大少 2026-08-21 18:37):
- thresholdPct 改用 adaptive (ATR% × 1.5, clamp 0.5%-5%)
- 每隻股用自己嘅 20 日 ATR 自動計 threshold
- Verdict meta 加 thresholdPctUsed / thresholdPctSource / adaptiveAtrPct 顯示
"""

import numpy as np
from typing import List, Dict, Any

from ..base import Algorithm, Verdict
from ..registry import register
from .config import DEFAULT_MA_ALIGNMENT_V2_CONFIG


# ============================================================
# v2.2.0 Adaptive ThresholdPct (大少 2026-08-21 18:37)
# 凡人話: 用 20 日 ATR% 自動計 thresholdPct
# ============================================================
def _compute_atr_pct(klines: List[Dict[str, Any]], lookback: int = 20) -> float:
    """凡人話: 計 20 日真實波幅 (ATR) ÷ 最新收盤價
    
    TR_t = max(High-Low, |High-Close_prev|, |Low-Close_prev|)
    ATR% = mean(TR for last N days) / latest_close
    
    Returns:
        float: 例如 0.0169 即 1.69%, 數據 < lookback+1 條返 0.0
    """
    if len(klines) < lookback + 1:
        return 0.0
    recent = klines[-(lookback + 1):]
    trs: List[float] = []
    for i in range(1, len(recent)):
        h_l = float(recent[i]["high"]) - float(recent[i]["low"])
        h_pc = abs(float(recent[i]["high"]) - float(recent[i-1]["close"]))
        l_pc = abs(float(recent[i]["low"]) - float(recent[i-1]["close"]))
        trs.append(max(h_l, h_pc, l_pc))
    if not trs:
        return 0.0
    atr = float(np.mean(trs))
    latest_close = float(recent[-1]["close"])
    if latest_close <= 0:
        return 0.0
    return atr / latest_close


def _resolve_threshold_pct(
    cfg_threshold_pct: Any,
    klines: List[Dict[str, Any]],
    multiplier: float = 1.5,
    min_pct: float = 0.005,
    max_pct: float = 0.05,
    atr_lookback: int = 20,
) -> Dict[str, Any]:
    """凡人話: 攞 actual thresholdPct + 來源資訊 (用嚟 verdict meta 顯示)
    
    Args:
        cfg_threshold_pct: config 入面嘅 thresholdPct, None = adaptive, 數字 = 固定
        klines: K 線 (用嚟計 ATR%)
        multiplier, min_pct, max_pct, atr_lookback: adaptive config
    
    Returns:
        dict: {
            "value": float,        # 實際用咗嘅 threshold (0.005-0.05)
            "source": str,         # "adaptive" / "fixed" / "adaptive-fallback"
            "atrPct": float|None,  # ATR% (只用 adaptive mode)
            "rawValue": float|None,  # 未 clamp 嘅 threshold (只用 adaptive mode)
        }
    """
    # Case 1: User 傳咗 fixed 數字 → 用固定
    if cfg_threshold_pct is not None and isinstance(cfg_threshold_pct, (int, float)):
        return {
            "value": float(cfg_threshold_pct),
            "source": "fixed",
            "atrPct": None,
            "rawValue": None,
        }
    # Case 2: adaptive mode
    atr_pct = _compute_atr_pct(klines, lookback=atr_lookback)
    if atr_pct <= 0 or np.isnan(atr_pct):
        # 數據不足 fallback 2%
        return {
            "value": 0.02,
            "source": "adaptive-fallback",
            "atrPct": 0.0,
            "rawValue": 0.0,
        }
    raw = atr_pct * multiplier
    value = max(min_pct, min(max_pct, raw))
    return {
        "value": value,
        "source": "adaptive",
        "atrPct": atr_pct,
        "rawValue": raw,
    }


# ============================================================
# Labels (跟 ma-alignment.ts 嘅 CYCLE_LABELS / POSITION_LABELS / VOLUME_SIGNAL_LABELS)
# ============================================================

CYCLE_LABELS: Dict[str, str] = {
    "strong_uptrend":     "強上升週期",
    "weak_uptrend":       "弱上升週期",
    "sideways":           "橫行週期",
    "weak_downtrend":     "弱下跌週期",
    "strong_downtrend":   "強下跌週期",
    "uptrend_correction": "上升回調中",
    "downtrend_bounce":   "下跌反彈中",
    "decelerating_up":    "到頂轉勢中",
    "decelerating_down":  "到底轉勢中",
}

POSITION_LABELS: Dict[str, str] = {
    "mid_stage":            "趨勢中期 (主升/主跌段)",
    "tentative_rise":       "剛開始升 (起勢)",
    "tentative_fall":       "剛開始跌 (起勢)",
    "range_bound":          "橫行整理中",
    "correction_at_ma20":   "回調到 20 日均線",
    "bounce_in_progress":   "反彈進行中",
    "late_stage_topping":   "到頂轉勢中 (見頂跡象)",
    "late_stage_bottoming": "到底轉勢中 (見底跡象)",
}

VOLUME_SIGNAL_LABELS: Dict[str, str] = {
    "expanding": "放量",
    "shrinking": "縮量",
    "neutral":   "持平",
}

# 9 個 sub-scenario map 返 3 個 high-level state (M7 Synthesizer 用)
STATE_MAP: Dict[str, str] = {
    "strong_uptrend":     "UP",
    "weak_uptrend":       "UP",
    "sideways":           "SIDEWAYS",
    "weak_downtrend":     "DOWN",
    "strong_downtrend":   "DOWN",
    "uptrend_correction": "UP",         # 上升回調中, 仍算上升
    "downtrend_bounce":   "DOWN",       # 下跌反彈中, 仍算下跌
    "decelerating_up":    "SIDEWAYS",    # 到頂轉勢中, 算過渡
    "decelerating_down":  "SIDEWAYS",    # 到底轉勢中, 算過渡
}


def _round(value: float, decimals: int) -> float:
    """凡人話: 四捨五入到指定小數位 (跟 ma-alignment.ts 嘅 round() function)"""
    if not isinstance(value, (int, float)) or np.isnan(value) or np.isinf(value):
        return 0.0
    factor = 10 ** decimals
    return round(value * factor) / factor


class MAAlignmentV2Algorithm(Algorithm):
    """M1 MA Alignment v2.2.0 algorithm (凡人話 contract) - Adaptive ThresholdPct (大少 2026-08-21 18:37)"""
    name = "ma_alignment"
    version = "2.2.0"

    def run(self, klines: List[Dict[str, Any]], options: Dict[str, Any]) -> Verdict:
        cfg = options.get("config", DEFAULT_MA_ALIGNMENT_V2_CONFIG)
        adjustment_log: List[str] = []

        # ============ Step 1: Input validation ============
        max_period = max(cfg["maPeriods"])
        min_length_for_ma = max_period + 5
        min_length_for_slope = cfg["slopeLookback"] + max_period + 5 if cfg["enableSlopeCheck"] else 0
        min_length_for_vol = cfg["volumeLookback"] * 2 + 5 if cfg["enableVolumeWeight"] else 0
        required_length = max(min_length_for_ma, min_length_for_slope, min_length_for_vol)

        # ============ Step 1.5: v2.2.0 Adaptive ThresholdPct 解析 (大少 2026-08-21 18:37) ============
        # 凡人話: 如果 config thresholdPct 係 None, 用該股 20 日 ATR% × 1.5 動態計算
        # 結果寫入 cfg["thresholdPct"] (overwrite), verdict meta 同時記錄 source/atrPct
        threshold_resolution = _resolve_threshold_pct(
            cfg_threshold_pct=cfg.get("thresholdPct"),
            klines=klines,
            multiplier=cfg.get("thresholdAdaptiveMultiplier", 1.5),
            min_pct=cfg.get("thresholdMinPct", 0.005),
            max_pct=cfg.get("thresholdMaxPct", 0.05),
            atr_lookback=cfg.get("thresholdAtrLookback", 20),
        )
        cfg = dict(cfg)  # copy 避免污染 default
        cfg["thresholdPct"] = threshold_resolution["value"]
        if threshold_resolution["source"] == "adaptive":
            adjustment_log.append(
                f"v2.2.0 adaptive threshold: ATR%={threshold_resolution['atrPct']*100:.2f}% × 1.5 = {threshold_resolution['rawValue']*100:.2f}%, clamp 至 {threshold_resolution['value']*100:.2f}%"
            )
        elif threshold_resolution["source"] == "adaptive-fallback":
            adjustment_log.append(
                f"v2.2.0 adaptive fallback: 數據不足, 用 2% 固定"
            )

        if len(klines) < required_length:
            return Verdict(
                ok=False,
                error=f"需要 ≥ {required_length} 條 K 線, 拎到 {len(klines)} 條"
            )

        # 檢查日期升序
        for i in range(1, len(klines)):
            if klines[i].get("date", "") < klines[i-1].get("date", ""):
                return Verdict(
                    ok=False,
                    error=f"K 線必須按日期升序排列 (第 {i-1} → {i} 條違反)"
                )

        # ============ Step 2: 計算各週期 MA latest value ============
        ma_values: Dict[str, float] = {}
        for period in cfg["maPeriods"]:
            tail = klines[-period:]
            ma_values[f"MA{period}"] = sum(k["close"] for k in tail) / period

        # ============ Step 3: MA ranks + candidate ============
        ma_keys = [f"MA{p}" for p in cfg["maPeriods"]]
        ma_ranks = sorted(ma_keys, key=lambda k: -ma_values[k])
        rank_periods = [int(k.replace("MA", "")) for k in ma_ranks]
        sorted_periods_asc = sorted(cfg["maPeriods"])
        sorted_periods_desc = list(reversed(sorted_periods_asc))

        if rank_periods == sorted_periods_asc:
            candidate = "uptrend"
        elif rank_periods == sorted_periods_desc:
            candidate = "downtrend"
        else:
            candidate = "sideways"

        # ============ Step 4: Spread + 橫行精細判定 ============
        max_ma = max(ma_values.values())
        min_ma = min(ma_values.values())
        max_spread_pct = (max_ma - min_ma) / min_ma if min_ma > 0 else 0

        if candidate in ("uptrend", "downtrend") and max_spread_pct < cfg["thresholdPct"]:
            candidate = "sideways"
            adjustment_log.append("均線雖有排列但過於靠近，視為橫行整理")

        # ============ Step 5: Volume trend + signal ============
        volume_trend_ratio = 1.0
        volume_signal = "neutral"

        if cfg["enableVolumeWeight"]:
            volume_lookback = cfg["volumeLookback"]
            recent = klines[-volume_lookback:]
            previous = klines[-(volume_lookback*2):-volume_lookback]

            recent_avg_vol = sum(k.get("volume", 0) or 0 for k in recent) / len(recent)
            previous_avg_vol = sum(k.get("volume", 0) or 0 for k in previous) / len(previous)

            if previous_avg_vol > 0:
                volume_trend_ratio = recent_avg_vol / previous_avg_vol
                if volume_trend_ratio >= cfg["volumeBoostThreshold"]:
                    volume_signal = "expanding"
                elif volume_trend_ratio <= cfg["volumeShrinkThreshold"]:
                    volume_signal = "shrinking"

        # ============ Step 5.5: 9 個 sub-scenario 細分判定 (大少 2026-08-15 永久 rule) ============
        is_bullish = rank_periods == sorted_periods_asc
        is_bearish = rank_periods == sorted_periods_desc

        # 計最近連續跌日數 + 連續升日數
        consecutive_down_days = 0
        for i in range(len(klines) - 1, 0, -1):
            if klines[i]["close"] < klines[i-1]["close"]:
                consecutive_down_days += 1
            else:
                break
        consecutive_up_days = 0
        for i in range(len(klines) - 1, 0, -1):
            if klines[i]["close"] > klines[i-1]["close"]:
                consecutive_up_days += 1
            else:
                break

        # 拎短期 / 長期 MA 嘅 slope
        def calc_slope(period: int) -> float:
            current_ma = ma_values[f"MA{period}"]
            past_segment = klines[-(period + 5):-5]
            if not past_segment:
                return 0
            past_ma = sum(k["close"] for k in past_segment) / len(past_segment)
            return (current_ma - past_ma) / past_ma if past_ma > 0 else 0

        slope_ma5 = calc_slope(5)
        slope_ma10 = calc_slope(10)
        slope_ma60 = calc_slope(60)
        all_short_slope_negative = slope_ma5 < 0 and slope_ma10 < 0
        all_short_slope_positive = slope_ma5 > 0 and slope_ma10 > 0
        long_slope_positive = slope_ma60 > 0
        long_slope_negative = slope_ma60 < 0

        sub_scenario = None
        cycle_position = None

        # Priority 1: 到頂轉勢
        if slope_ma5 < -0.03 and long_slope_positive and consecutive_down_days >= 4:
            sub_scenario = "decelerating_up"
            cycle_position = "late_stage_topping"
            adjustment_log.append(
                f"到頂轉勢跡象: 短期急跌 {slope_ma5*100:.2f}% + 長期均線仲升 + 連跌 {consecutive_down_days} 日"
            )
        # Priority 1: 到底轉勢
        elif slope_ma5 > 0.03 and long_slope_negative and consecutive_up_days >= 4:
            sub_scenario = "decelerating_down"
            cycle_position = "late_stage_bottoming"
            adjustment_log.append(
                f"到底轉勢跡象: 短期急升 {slope_ma5*100:.2f}% + 長期均線仲跌 + 連升 {consecutive_up_days} 日"
            )
        # Priority 2: 強上升 / 弱上升
        elif is_bullish:
            all_slopes_positive = all(calc_slope(p) > 0 for p in cfg["maPeriods"])
            if all_slopes_positive and volume_signal == "expanding":
                sub_scenario = "strong_uptrend"
                cycle_position = "mid_stage"
                adjustment_log.append("強上升跡象: 全部均線斜率正 + 放量配合")
            else:
                sub_scenario = "weak_uptrend"
                cycle_position = "tentative_rise"
                adjustment_log.append("弱上升跡象: 排列對但部分斜率 / 量能唔配合")
        # Priority 3: 強下跌 / 弱下跌
        elif is_bearish:
            all_slopes_negative = all(calc_slope(p) < 0 for p in cfg["maPeriods"])
            if all_slopes_negative and volume_signal == "expanding":
                sub_scenario = "strong_downtrend"
                cycle_position = "mid_stage"
                adjustment_log.append("強下跌跡象: 全部均線斜率負 + 放量確認")
            else:
                sub_scenario = "weak_downtrend"
                cycle_position = "tentative_fall"
                adjustment_log.append("弱下跌跡象: 排列對但部分斜率 / 量能唔配合")
        # Priority 4: 上升回調
        elif all_short_slope_negative and long_slope_positive and max_spread_pct >= cfg["thresholdPct"]:
            sub_scenario = "uptrend_correction"
            cycle_position = "correction_at_ma20"
            adjustment_log.append("上升回調跡象: 短期均線急跌但長期均線仲升 (回調到 20 日均線)")
        # Priority 5: 下跌反彈
        elif all_short_slope_positive and long_slope_negative and max_spread_pct >= cfg["thresholdPct"]:
            sub_scenario = "downtrend_bounce"
            cycle_position = "bounce_in_progress"
            adjustment_log.append("下跌反彈跡象: 短期均線急升但長期均線仲跌 (反彈進行中)")
        # Default: 橫行
        else:
            sub_scenario = "sideways"
            cycle_position = "range_bound"

        # override 原本 candidate
        candidate = sub_scenario

        # ============ Step 6: MA slopes + momentum score ============
        ma_slopes: Dict[str, float] = {}
        momentum_score = 0.0

        if cfg["enableSlopeCheck"]:
            slope_lookback = cfg["slopeLookback"]
            total_weight = sum(1.0 / p for p in cfg["maPeriods"])

            for period in cfg["maPeriods"]:
                current_ma = ma_values[f"MA{period}"]
                past_segment = klines[-(period + slope_lookback):-slope_lookback]
                if not past_segment:
                    ma_slopes[f"MA{period}"] = 0
                    continue
                past_ma = sum(k["close"] for k in past_segment) / len(past_segment)
                slope = (current_ma - past_ma) / past_ma if past_ma > 0 else 0
                ma_slopes[f"MA{period}"] = slope
                momentum_score += (slope * (1.0 / period)) / total_weight

        # ============ Step 7: Confidence (三階段調整) ============
        # 7a. 基礎信心
        if candidate in ("strong_uptrend", "strong_downtrend", "uptrend_correction", "downtrend_bounce", "decelerating_up", "decelerating_down"):
            base_confidence = min(1.0, max_spread_pct / cfg["spreadConfidenceScale"])
            if max_spread_pct < 0.05:
                base_confidence *= 0.7
        elif candidate in ("weak_uptrend", "weak_downtrend"):
            base_confidence = min(0.7, max_spread_pct / cfg["spreadConfidenceScale"] * 0.7)
        else:  # sideways
            base_confidence = max(
                cfg["sidewaysBaseConfidence"],
                1.0 - abs(max_spread_pct - cfg["thresholdPct"]) / cfg["thresholdPct"]
            )

        # 7b. 成交量加權
        vol_multiplier = 1.0
        if cfg["enableVolumeWeight"]:
            if candidate in ("strong_uptrend", "weak_uptrend", "uptrend_correction"):
                if volume_signal == "expanding":
                    vol_multiplier = min(1.25, 1.0 + (volume_trend_ratio - 1.0) * 0.5)
                    adjustment_log.append("放量上漲，信心提升")
                elif volume_signal == "shrinking":
                    vol_multiplier = max(0.65, 1.0 - (1.0 - volume_trend_ratio) * 0.8)
                    adjustment_log.append("上漲縮量，信心打折")
            elif candidate in ("strong_downtrend", "weak_downtrend", "downtrend_bounce"):
                if volume_signal == "expanding":
                    vol_multiplier = 1.15
                    adjustment_log.append("放量下跌，趨勢確認")
                elif volume_signal == "shrinking":
                    vol_multiplier = 0.85
                    adjustment_log.append("下跌縮量，動能可能不足")
            elif candidate in ("decelerating_up", "decelerating_down"):
                vol_multiplier = 1.0
            else:  # sideways
                if volume_signal == "shrinking":
                    vol_multiplier = 1.15
                    adjustment_log.append("縮量整理，橫行信號增強")
                elif volume_signal == "expanding":
                    vol_multiplier = 0.85
                    adjustment_log.append("放量震盪，可能醞釀突破")

        # 7c. 斜率動能
        slope_multiplier = 1.0
        if cfg["enableSlopeCheck"]:
            sorted_periods = sorted(cfg["maPeriods"])
            short_periods = sorted_periods[:2]
            long_period = max(cfg["maPeriods"])
            negative_count = sum(1 for p in cfg["maPeriods"] if ma_slopes.get(f"MA{p}", 0) < 0)

            if candidate in ("strong_uptrend", "weak_uptrend", "uptrend_correction"):
                if any(ma_slopes.get(f"MA{p}", 0) < 0 for p in short_periods):
                    slope_multiplier = cfg["slopeDiscountFactor"]
                    adjustment_log.append("短期均線斜率為負，上升動能減弱")
                elif negative_count > 0:
                    slope_multiplier = 0.85
                    adjustment_log.append("部分長期均線斜率為負")
            elif candidate in ("strong_downtrend", "weak_downtrend", "downtrend_bounce"):
                if ma_slopes.get(f"MA{long_period}", 0) > 0:
                    slope_multiplier = 0.8
                    adjustment_log.append("長期均線斜率轉正，下跌動能減弱")
                elif any(ma_slopes.get(f"MA{p}", 0) > 0 for p in short_periods):
                    slope_multiplier = 0.9
                    adjustment_log.append("短期均線斜率轉正，可能醞釀反彈")
            elif candidate in ("decelerating_up", "decelerating_down"):
                slope_multiplier = 1.0
            else:  # sideways
                avg_abs_slope = sum(abs(ma_slopes.get(f"MA{p}", 0)) for p in cfg["maPeriods"]) / len(cfg["maPeriods"])
                if avg_abs_slope > 0.005:
                    slope_multiplier = 0.8
                    adjustment_log.append("均線斜率過大，橫行周期可能即將結束")

        # 7d. 綜合信心
        confidence = base_confidence * vol_multiplier * slope_multiplier
        confidence = max(0.0, min(1.0, confidence))
        confidence = _round(confidence, 4)

        # ============ Step 8: 組裝 verdict ============
        last_date = (
            klines[-1].get("date") or klines[-1].get("time")
            or klines[-1].get("timestamp") or None
        )

        # 大少 2026-08-30 01:04 — 拎走 M1 ZigZag 依賴 (C 方案 phase 2):
        # 之後 M1 純 MA alignment, 之字 points 由 testing page frontend 自己 inject
        # (applyFrontendZigZagOverlay line 1424 verdict.meta.zigzagPoints = frontendPoints)
        # Spec Sync #46 永久 rule 改: M1 純 MA alignment, 之字 points 由 frontend inject

        meta: Dict[str, Any] = {
            "symbol": options.get("symbol", "UNKNOWN"),
            "cycle": candidate,
            "cycleLabel": CYCLE_LABELS[candidate],
            "state": STATE_MAP[candidate],
            "cyclePosition": cycle_position,
            "cyclePositionLabel": POSITION_LABELS[cycle_position],
            "confidence": confidence,
            "baseConfidence": _round(base_confidence, 4),
            "maValues": {k: _round(v, 4) for k, v in ma_values.items()},
            "maRanks": ma_ranks,
            "maSlopes": {k: _round(v, 6) for k, v in ma_slopes.items()},
            "momentumScore": _round(momentum_score, 6),
            "volumeTrendRatio": _round(volume_trend_ratio, 4),
            "volumeSignal": volume_signal,
            "volumeSignalLabel": VOLUME_SIGNAL_LABELS[volume_signal],
            "maxSpreadPct": _round(max_spread_pct, 6),
            "consecutiveDays": (
                consecutive_down_days if candidate == "decelerating_up"
                else (consecutive_up_days if candidate == "decelerating_down" else 0)
            ),
            "adjustmentLog": adjustment_log,
            "reason": (
                f"【週期】{CYCLE_LABELS[candidate]} ({POSITION_LABELS[cycle_position]})"
                + ("；" + "；".join(adjustment_log) if adjustment_log else "")
            ),
            "lastDate": last_date,
            "configUsed": cfg,
            # v2.2.0 永久 rule (大少 2026-08-21 18:37) — 顯示實際用咗嘅 thresholdPct%
            "thresholdPctUsed": _round(threshold_resolution["value"], 6),
            "thresholdPctUsedPctDisplay": f"{threshold_resolution['value']*100:.3f}%",  # e.g. "2.543%"
            "thresholdPctSource": threshold_resolution["source"],  # "adaptive" / "fixed" / "adaptive-fallback"
            "adaptiveAtrPct": _round(threshold_resolution["atrPct"], 6) if threshold_resolution["atrPct"] is not None else None,
            "adaptiveAtrPctDisplay": f"{threshold_resolution['atrPct']*100:.3f}%" if threshold_resolution["atrPct"] is not None else None,
            "adaptiveRawThreshold": _round(threshold_resolution["rawValue"], 6) if threshold_resolution["rawValue"] is not None else None,
            # 大少 2026-08-30 01:04 — 拎走 ZigZag 5 個 field (zigzagPoints / lastSwingHigh / lastSwingLow / zigzagThreshold / zigzagSlope / zigzagSource)
            # Spec Sync #46 永久 rule 改: M1 純 MA alignment, 之字 points 由 frontend inject
        }

        # Warnings (跟 Module Warning System v1.1.0)
        warnings = []
        if len(klines) < 30:
            warnings.append({
                "level": "warning",
                "category": "system",
                "module_id": "ma_alignment",
                "code": "LOW_SAMPLE_SIZE",
                "message": f"只有 {len(klines)} 條 K 線, sample size 較細",
                "issue": f"actual klines = {len(klines)}, 建議 ≥ 30 條先可信",
                "impact": "Verdict 唔可信, 唔好落單",
                "fix": "Re-run / 加大 dataWindowDays",
                "context": {"actual_count": len(klines), "recommended_min": 30},
            })

        # M1 algorithm 唔拎 points (ZigZag 拎), 返 Verdict shape
        return Verdict(
            ok=True,
            points=[],  # M1 algorithm 唔拎 points, ZigZag algorithm 拎
            meta=meta,
            warnings=warnings,
        )


# 凡人話: 自動 register 落 framework (import 呢個 file 就自動 register)
register(MAAlignmentV2Algorithm())

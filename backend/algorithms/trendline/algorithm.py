"""
backend/algorithms/trendline/algorithm.py — M3 Trendline v0.1.0 (大少 2026-08-20 20:50 Phase 4)

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


# ============================================================
# Helpers
# ============================================================

def _round(value: float, decimals: int) -> float:
    """凡人話: 四捨五入到指定小數位 (跟 trendline.ts 嘅 round() function)"""
    if value is None or (isinstance(value, float) and (value != value)):  # NaN check
        return 0.0
    factor = 10 ** decimals
    return round(value * factor) / factor


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
    """
    ys = [p["low"] for p in points] if line_type == "support" else [p["high"] for p in points]
    xs = [p["index"] for p in points]

    best_fit = None
    best_r2 = float("-inf")
    max_n = min(cfg["maxLinePoints"], len(points))
    for n in range(cfg["minLinePoints"], max_n + 1):
        x_subset = xs[-n:]
        y_subset = ys[-n:]
        points_subset = points[-n:]
        reg = _linear_regression(x_subset, y_subset)
        if reg["r2"] > best_r2:
            best_r2 = reg["r2"]
            best_fit = {**reg, "numPoints": n, "usedPoints": points_subset}
    if not best_fit:
        return {"slope": 0.0, "intercept": 0.0, "r2": 0.0, "numPoints": 0, "usedPoints": []}
    return best_fit


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


def _derive_trendline_state(rules: List[Dict[str, str]]) -> str:
    """凡人話: 10 條 rule 拎 state — H+G → TRANSITION · H → A → B → F → G → C/D → 默認 SIDEWAYS

    對應 frontend deriveTrendlineState (adapter.mjs line 4744-4754)
    """
    ids = {r["id"] for r in rules}
    if "H" in ids and "G" in ids:
        return "TRANSITION"
    if "H" in ids:
        return "UP"
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
    latest_idx: int,
    recent_n: int,
    cfg: Dict[str, Any],
) -> Dict[str, Any]:
    """凡人話: 信心分數 — 強 0.7 / 中 0.5 / 弱 +0.10, R² 偏低 -0.05, 老化 -0.10

    對應 frontend deriveTrendlineConfidence (adapter.mjs line 4756-4788)
    """
    adjustment_log = []
    base = 0.5
    if any(r["strength"] == "strong" for r in rules):
        base = 0.7

    conf = base
    for r in rules:
        if r["strength"] == "weak":
            conf += 0.10

    if support_fit["r2"] < cfg["minR2"] and resistance_fit["r2"] < cfg["minR2"]:
        conf -= 0.10
        adjustment_log.append("兩條趨勢線 R² 均低於 minR2, 信心 -0.10")
    elif support_fit["r2"] < cfg["minR2"]:
        conf -= 0.05
        adjustment_log.append("支撐線 R² 偏低, 信心 -0.05")
    elif resistance_fit["r2"] < cfg["minR2"]:
        conf -= 0.05
        adjustment_log.append("壓力線 R² 偏低, 信心 -0.05")

    last_fit_idx = max((p["index"] for p in support_fit["usedPoints"]), default=0)
    latest_extreme_age = recent_n - 1 - last_fit_idx
    if latest_extreme_age > cfg["maxExtremeAgeDays"]:
        conf -= 0.10
        adjustment_log.append(f"趨勢線最舊極值點距今 {latest_extreme_age} 日, 信號老化, 信心 -0.10")

    clamped = max(0.0, min(1.0, conf))
    return {"baseConfidence": base, "confidence": clamped, "adjustmentLog": adjustment_log}


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
    """凡人話: 趨勢線法 (M3 v0.1.0) — 10 條 rule 自動畫趨勢線 + 突破/跌破信號"""

    name = "trendline"
    version = "0.1.0"

    def run(self, klines: List[Dict[str, Any]], options: Dict[str, Any]) -> Verdict:
        # 合併 default config + user override
        cfg = {**DEFAULT_TRENDLINE_CONFIG, **(options.get("trendlineConfig") or {})}
        n = len(klines)

        # ============ Step 1: 數據驗證 ============
        min_required = 30
        if n < min_required:
            return Verdict(
                ok=False,
                error=f"[Trendline] Insufficient data: need ≥ {min_required} bars, got {n}",
            )

        data_window_days = options.get("dataWindowDays", n)
        recent = klines[-min(data_window_days, n):]
        recent_n = len(recent)

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

        # ============ 10 條 rule check (Step 7) ============
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

        # ============ Step 8: State derivation ============
        state = _derive_trendline_state(matched_rules)

        # ============ Step 9: Confidence derivation ============
        conf = _derive_trendline_confidence(
            matched_rules, support_fit, resistance_fit, latest_idx, recent_n, cfg
        )
        base_confidence = conf["baseConfidence"]
        confidence = conf["confidence"]
        adjustment_log = conf["adjustmentLog"]

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

        cycle_label = {"UP": "上升", "DOWN": "下跌", "SIDEWAYS": "橫行", "TRANSITION": "轉折"}[state]

        meta = {
            "moduleId": "trendline",
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
        }

        return Verdict(
            ok=True,
            points=[],
            meta=meta,
            warnings=m3_warnings,
        )


# 凡人話: 自動 register 落 framework (import 呢個 file 就自動 register)
register(TrendlineAlgorithm())

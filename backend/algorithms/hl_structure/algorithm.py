"""
backend/algorithms/hl-structure/algorithm.py — M2 HL Structure v0.1.0 (大少 2026-08-20 20:35 Phase 3)

凡人話: 拎 K 線 → 識別峰谷 (peaks + troughs) → 趨勢分析 → 結構分數 → 箱體邊界 → 形態預警 → 價格位置 → 信心指數

對應 source: algorithms/AS-03-cycle-detection/modules/hl-structure.ts v0.1.0 (656 行, 18 步算法)
對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs (line 3932-4269 frontend analyzeHLStructure 337 行)
對應 spec doc: docs/research/AS-03-cycle-detection/MODULE-02-HL-STRUCTURE.md
對應 framework: backend/algorithms/base.py Verdict contract

Algorithm: 18 步 (跟 hl-structure.ts 嘅 detect() method 1:1 port 去 Python)
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


def _detect_extremes(weighted: List[Dict[str, Any]], window: int) -> Dict[str, List[int]]:
    """凡人話: 識別原始極值點 (peaks 山頂 + troughs 山谷)

    對應 frontend detectExtremes (adapter.mjs line 3830-3849)
    """
    peaks = []
    troughs = []
    for i in range(window, len(weighted) - window):
        curr = weighted[i]["weightedPrice"]
        left_w = [k["weightedPrice"] for k in weighted[i - window:i]]
        right_w = [k["weightedPrice"] for k in weighted[i + 1:i + window + 1]]
        left_max = max(left_w)
        right_max = max(right_w)
        left_min = min(left_w)
        right_min = min(right_w)

        if curr > left_max and curr > right_max:
            peaks.append(i)
        elif curr < left_min and curr < right_min:
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


def _analyze_trend(values: List[float], tolerance: float) -> Dict[str, Any]:
    """凡人話: 趨勢分析 (rising / falling / flat / mixed) + consistency (0-1)

    對應 frontend analyzeTrend (adapter.mjs line 3878-3901)
    """
    if len(values) < 2:
        return {"trend": "mixed", "consistency": 0.0}

    rising_count = 0
    falling_count = 0
    for i in range(1, len(values)):
        if values[i] > values[i - 1]:
            rising_count += 1
        elif values[i] < values[i - 1]:
            falling_count += 1

    total_diff = len(values) - 1
    rising_pct = rising_count / total_diff
    falling_pct = falling_count / total_diff
    consistency = max(rising_pct, falling_pct)
    overall_change = (values[-1] - values[0]) / values[0] if values[0] != 0 else 0

    if rising_pct >= 0.7 and overall_change > tolerance:
        return {"trend": "rising", "consistency": consistency}
    elif falling_pct >= 0.7 and overall_change < -tolerance:
        return {"trend": "falling", "consistency": consistency}
    elif consistency > 0.6 and abs(overall_change) < tolerance:
        return {"trend": "flat", "consistency": consistency}
    return {"trend": "mixed", "consistency": consistency}


# ============================================================
# Main algorithm
# ============================================================

class HLStructureAlgorithm(Algorithm):
    """凡人話: 高低點結構法 (M2 v0.1.0)

    18 步算法詳細見 `docs/research/AS-03-cycle-detection/MODULE-02-HL-STRUCTURE.md`
    """

    name = "hl_structure"
    version = "0.1.0"

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
        extremes = _detect_extremes(weighted, adaptive_window)
        peak_idxs = extremes["peaks"]
        trough_idxs = extremes["troughs"]

        # Edge case: 完全平 data
        if len(peak_idxs) == 0 and len(trough_idxs) == 0:
            _flat_warnings = [{
                "level": "critical",
                "category": "system",
                "module_id": "hl_structure",
                "code": "VERDICT_MISSING",
                "message": "峰谷全部拎唔到 (價格完全無變化)",
                "issue": "peak_count = 0 AND trough_count = 0 (價格完全無變化)",
                "impact": "Verdict 唔可信, 唔好落單",
                "fix": "Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc",
                "context": {"peak_count": 0, "trough_count": 0, "period": options.get("period")},
            }]
            return Verdict(
                ok=True,
                points=[],
                meta={
                    "symbol": options.get("code", "TEST"),
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
                    "symbol": options.get("code", "TEST"),
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
                        "category": "system",
                        "module_id": "hl_structure",
                        "code": "FALLBACK_USED",
                        "message": f"峰谷總數 {len(alternated)} < {cfg['minPairs'] * 2}",
                        "issue": f"峰谷總數 {len(alternated)} < {cfg['minPairs'] * 2} required",
                        "impact": "Verdict 唔可信, 唔好落單",
                        "fix": "Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc",
                        "context": {"alternated_count": len(alternated), "min_pairs": cfg["minPairs"]},
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
        peak_trend = _analyze_trend([e["k"]["close"] for e in peak_exts], effective_tolerance)
        trough_trend = _analyze_trend([e["k"]["close"] for e in trough_exts], effective_tolerance)

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
        reason_base = f"判定: {'上升' if candidate == 'uptrend' else '下跌' if candidate == 'downtrend' else '橫行'}"

        if cfg["enablePatternAlert"] and len(peak_exts) >= 3 and len(trough_exts) >= 2:
            sym_tol = effective_tolerance * cfg["patternSymmetryTolerance"]
            # 頭肩頂: 3 個 peak, 中間最高
            if len(peak_exts) >= 3:
                last_3 = peak_exts[-3:]
                if (last_3[1]["k"]["close"] > last_3[0]["k"]["close"]
                    and last_3[1]["k"]["close"] > last_3[2]["k"]["close"]
                    and abs(last_3[0]["k"]["close"] - last_3[2]["k"]["close"]) / last_3[1]["k"]["close"] < sym_tol):
                    pattern_alert = "head_and_shoulder"
                    reason_base += "；出現頭肩頂形態預警"
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

        # ============ Step 17: 綜合信心指數 ============
        confidence = max(0.0, min(1.0, base_confidence * confidence_multiplier))

        cycle_label = "上升週期" if candidate == "uptrend" else "下跌週期" if candidate == "downtrend" else "橫行週期"
        final_reason = f"{reason_base}；{'；'.join(adjustment_log)}" if adjustment_log else reason_base

        # ============ Step 18: 組裝輸出 (frontend 兼容 shape) ============
        m2_warnings = []
        if len(peak_exts) == 0 and len(trough_exts) == 0:
            m2_warnings.append({
                "level": "critical",
                "category": "system",
                "module_id": "hl_structure",
                "code": "VERDICT_MISSING",
                "message": "峰谷全部拎唔到",
                "issue": "peak_count = 0 AND trough_count = 0",
                "impact": "Verdict 唔可信, 唔好落單",
                "fix": "增加 dataWindowDays 設定, 確認 data 有高低點變化",
                "context": {"peak_count": 0, "trough_count": 0, "period": options.get("period")},
            })
        if len(peak_exts) + len(trough_exts) < cfg["minPairs"] * 2:
            m2_warnings.append({
                "level": "warning",
                "category": "system",
                "module_id": "hl_structure",
                "code": "FALLBACK_USED",
                "message": f"峰谷總數 {len(peak_exts) + len(trough_exts)} < {cfg['minPairs'] * 2}",
                "issue": f"峰谷總數 {len(peak_exts) + len(trough_exts)} < {cfg['minPairs'] * 2} required",
                "impact": "Verdict 唔可信, 唔好落單",
                "fix": "Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc",
                "context": {"peak_count": len(peak_exts), "trough_count": len(trough_exts), "min_pairs": cfg["minPairs"]},
            })

        meta = {
            "symbol": options.get("code", "TEST"),
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

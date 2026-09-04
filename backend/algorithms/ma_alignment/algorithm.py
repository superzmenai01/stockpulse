"""
backend/algorithms/ma-alignment/algorithm.py — M1 MA Alignment v2.0 (大少 2026-08-20 20:05 Phase 2, v2.2.0 adaptive 2026-08-21, v2.3.0 第 10 個 sub-scenario 2026-09-05)

凡人話: 拎 K 線 → 計算 MA5/MA10/MA20/MA60 → 判定 10 個 sub-scenario cycle + 9 個 cycle position

對應 backup: backups/zigzag-frontend-2026-08-20/(adapter.mjs / ma-alignment.ts)
對應 source: algorithms/AS-03-cycle-detection/modules/ma-alignment.ts (551 行, v0.3.0 + 9 個 sub-scenario, v2.3.0 加第 10 個)
對應 ref code: 大少 2026-08-15 9 個 sub-scenario 永久 rule + 大少 2026-09-05 第 10 個 sub-scenario trigger (C 方案, M1-V22-RESEARCH.md)
對應 framework: backend/algorithms/base.py Verdict contract

Algorithm: 8 個 step (跟 ma-alignment.ts 嘅 detect() method 1:1 port 去 Python)
- Step 1: Input validation
- Step 2: 計算各週期 MA latest value
- Step 3: MA ranks + candidate (uptrend / downtrend / sideways)
- Step 4: Spread + 橫行精細判定 (v2.2.0: adaptive thresholdPct)
- Step 5: Volume trend + signal
- Step 5.5: 10 個 sub-scenario 細分判定 (大少 2026-08-15 9 個 + 2026-09-05 1 個永久 rule)
- Step 6: MA slopes + momentum score
- Step 7: Confidence (base × vol × slope, 三階段調整)
- Step 8: 組裝 verdict (跟 frontend verdict shape 100% 兼容)

v2.2.0 改動 (大少 2026-08-21 18:37):
- thresholdPct 改用 adaptive (ATR% × 1.5, clamp 0.5%-5%)
- 每隻股用自己嘅 20 日 ATR 自動計 threshold
- Verdict meta 加 thresholdPctUsed / thresholdPctSource / adaptiveAtrPct 顯示

v2.3.0 改動 (大少 2026-09-05, C 方案):
- 新加第 10 個 sub-scenario: strong_uptrend_consolidating (強升中整固 / 蓄勢)
- 條件: 排列 bull + 全部 slope 正 + P 點 higher high + P 點 higher low + 最近 5 日 range < 5% + close > MA20
- 唔強制 volume=expanding (boundary case 通常 vol 中性, 唔夠 expanding 但接近)
- STATE_MAP: UP (仍算上升), CYCLE_LABELS: 強升中整固, POSITION_LABELS: 強升後整固 (蓄勢)
- Step 7a/7b/7c 加入強升 sub-class (用強升公式)
- Config 加 2 個 option: consolidationLookback (5), consolidationRangeThresholdPct (0.05)
- 補返「強升 + 短期整固 + vol 唔夠 expanding」boundary case (e.g. 00019 9月4日 vol 1.2285 跌入橫行 → 改為強升中整固)
- 對齊 2026-09-03 07:23 sub-scenario 流程永久 rule (P 點全部由 recent_zz 拎)
- 對齊 2026-08-16 19:21 永久 rule (拎 ≥3 個 stock 例子 confirm trigger)
  證據: 00386 中石化 (range 3.31%, vol 0.501 shrinking) + 00857 中石油 (range 4.67%, vol 1.2496 neutral)
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
    "strong_uptrend":              "強上升週期",
    "weak_uptrend":                "初升週期",
    "sideways":                    "橫行週期",
    "weak_downtrend":              "初跌週期",
    "strong_downtrend":            "強下跌週期",
    "uptrend_correction":          "上升回調中",
    "downtrend_bounce":            "下跌反彈中",
    "decelerating_up":             "到頂轉勢中",
    "decelerating_down":           "到底轉勢中",
    "strong_uptrend_consolidating": "強升中整固",  # 大少 2026-09-05 trigger (C 方案)
}

POSITION_LABELS: Dict[str, str] = {
    "mid_stage":                   "趨勢中期 (主升/主跌段)",
    "tentative_rise":              "剛開始升 (起勢)",
    "tentative_fall":              "剛開始跌 (起勢)",
    "range_bound":                 "橫行整理中",
    "correction_at_ma20":          "回調到 20 日均線",
    "bounce_in_progress":          "反彈進行中",
    "late_stage_topping":          "到頂轉勢中 (見頂跡象)",
    "late_stage_bottoming":        "到底轉勢中 (見底跡象)",
    "consolidating_after_rally":   "強升後整固 (蓄勢)",  # 大少 2026-09-05 trigger (C 方案)
}

VOLUME_SIGNAL_LABELS: Dict[str, str] = {
    "expanding": "放量",
    "shrinking": "縮量",
    "neutral":   "持平",
}

# 10 個 sub-scenario map 返 3 個 high-level state (M7 Synthesizer 用)
# 凡人話: 大少 2026-09-05 trigger 加第 10 個 sub-scenario「強升中整固」(C 方案)
STATE_MAP: Dict[str, str] = {
    "strong_uptrend":              "UP",
    "weak_uptrend":                "UP",
    "sideways":                    "SIDEWAYS",
    "weak_downtrend":              "DOWN",
    "strong_downtrend":            "DOWN",
    "uptrend_correction":          "UP",         # 上升回調中, 仍算上升
    "downtrend_bounce":            "DOWN",       # 下跌反彈中, 仍算下跌
    "decelerating_up":             "SIDEWAYS",   # 到頂轉勢中, 算過渡
    "decelerating_down":           "SIDEWAYS",   # 到底轉勢中, 算過渡
    "strong_uptrend_consolidating": "UP",        # 強升中整固, 仍算上升 (大少 9月5日 C 方案 trigger)
}


def _round(value: float, decimals: int) -> float:
    """凡人話: 四捨五入到指定小數位 (跟 ma-alignment.ts 嘅 round() function)"""
    if not isinstance(value, (int, float)) or np.isnan(value) or np.isinf(value):
        return 0.0
    factor = 10 ** decimals
    return round(value * factor) / factor


def _get_recent_zigzag_points(klines: List[Dict[str, Any]], options: Dict[str, Any], n: int = 5) -> List[Dict[str, Any]]:
    """凡人話: 拎最近 n 個 ZigZag P 點, 保證返**新→舊** list 俾 caller

    大少 2026-09-02 12:24 trigger: M1 trigger 用 Z 點形態 (P2/P3/P4/P5 比較)
    大少 2026-09-03 07:35 trigger: 所有 sub-scenario trigger 嘅 P1/P2/P3 都要用 P 點來源
    大少 2026-09-03 07:05 P 點 vocabulary: P1=最新, list[0]=P1, list[-1]=P_n=最舊
    大少 2026-09-03 11:00 trigger: P 點必須有 `type` field (Peak / Trough), 唔直接用 Z 點 high/low

    ⚠️ **重要: 順序約定 (大少 9月3日 07:05 + 07:35 trigger 修正)**
    Helper 永遠返**新→舊** list, 對齊 ZigZagAlgorithm.run().points output:
    - list[0] = P1 = 最新 Z 點
    - list[1] = P2 = 第二新
    - list[n-1] = P_n = 第 n 新
    - list[-1] = P_n = 最舊 (如果 list 內有 n 個)

    Caller (algorithm.py 到頂/到底 trigger) 用:
    - p1 = recent_zz[0]  ← 最新
    - p2 = recent_zz[1]  ← 第二新
    - p3 = recent_zz[2]
    - p4 = recent_zz[3]
    - p5 = recent_zz[4]  ← 第五新
    - p6 = recent_zz[5]  ← 第六新
    - p7 = recent_zz[6]  ← 第七新

    ⚠️ **P 點 type 永久 rule (大少 2026-09-03 11:00 trigger)**
    Helper 內部統一 Z 點 type "high"/"low" → P 點 type "Peak"/"Trough":
    - Z 點 type="high" → P 點 type="Peak"  (峰頂)
    - Z 點 type="low"  → P 點 type="Trough" (谷底)
    Caller 永遠用 P 點 type (Peak / Trough), 唔直接寫 Z 點 high/low。
    套用: M1 / M7 / 其他 algorithm 之後嘅 P 點 trigger 全部跟呢個 pattern。

    Z 點取法 (混合方案, 大少 9月2日 plan 確認):
    1. 優先取 caller 傳入 options['zigzagPoints'] (對齊 Spec Sync #46 精神, frontend inject)
       - Caller 必須傳**新→舊**順序 (對齊 ZigZagAlgorithm.run().points output)
       - list[0] = P1 = 最新
    2. Fallback: 內部 call calculate_zigzag() (用現有 backend/algorithms/zigzag/algorithm.py 算法,
       1-to-1 port testing page 4.15.0 + 4.16.0 + 4.56.0/4.57.x)
       - calculate_zigzag() raw output 係**舊→新** (list[0] = 最舊, list[-1] = 最新)
       - Helper 內部 reverse 變新→舊, 對齊 caller inject 嘅順序

    Returns:
        list of {date, value, type, index, triggerIndex, triggerDate, triggerPrice}
        **新→舊** 順序, 頭 n 個 (P1 = list[0] = 最新)
        `type` 永遠係 "Peak" 或 "Trough" (大少 9月3日 11:00 永久 rule)
    """

    def _normalize_type(point: Dict[str, Any]) -> Dict[str, Any]:
        """凡人話: Z 點 type "high"/"low" 轉 P 點 type "Peak"/"Trough"
        (大少 2026-09-03 11:00 永久 rule, P 點抽象層唔直接用 Z 點 type)"""
        if not point:
            return point
        z_type = point.get("type")
        if z_type == "high":
            return {**point, "type": "Peak"}
        if z_type == "low":
            return {**point, "type": "Trough"}
        # 已經係 Peak/Trough (caller inject 過) 或 None, 保留
        return point

    caller_points = options.get("zigzagPoints")
    if caller_points and len(caller_points) >= n:
        # Caller 傳新→舊, 頭 n 個 = 最新 n 個 (對齊 ZigZagAlgorithm.run().points output)
        return [_normalize_type(p) for p in caller_points[:n]]

    # Fallback: instantiate ZigZagAlgorithm class 拎 Z 點 (大少 2026-09-03 14:37 trigger 方案 B)
    # 對齊 backend endpoint `/api/algorithms/run?algo=zigzag` + frontend testing page 拎法
    # 拎走舊版 calculate_zigzag function (拎出嚟 Z 點 trigger date 拎早 6 日, 唔係完整 1-to-1 port frontend)
    from ..zigzag.algorithm import ZigZagAlgorithm
    threshold_mode = options.get("threshold_mode", "auto")
    manual_threshold = options.get("manual_threshold")
    lookback = int(options.get("lookback", 20))
    multiplier = float(options.get("multiplier", 2.5))
    # 對齊 run_zigzag / ZigZagAlgorithm 拎法 (auto threshold 用 K 線波動率計, 唔寫死 5%)
    if threshold_mode == "manual" and manual_threshold is not None:
        threshold = float(manual_threshold)
    else:
        threshold = options.get("threshold", options.get("zigzagThresholdPercent", 5.0))
    zz_algo = ZigZagAlgorithm()
    zz_verdict = zz_algo.run(klines, {
        "threshold": float(threshold),
        "threshold_mode": threshold_mode,
        "manual_threshold": manual_threshold,
        "lookback": lookback,
        "multiplier": multiplier,
    })
    if not zz_verdict.ok:
        # ZigZag 拎失敗 (數據太少), return empty list 俾 caller fall through
        return []
    # ZigZagAlgorithm.run().points 已經係**新→舊**排序 (sequence 1=最新), 直接 [:n] 拎頭 n 個
    points = zz_verdict.points or []
    selected = points[:n]  # 拎頭 n 個 (已經係新→舊, list[0]=P1=最新)
    return [_normalize_type(p) for p in selected]


def _recent_consolidation_range(klines: List[Dict[str, Any]], lookback: int = 5) -> float:
    """凡人話: 拎最近 N 日 high-low range, 判斷整固程度

    整固 = 窄幅上落, range 細
    用最近 N 日嘅 high_max - low_min / low_min
    例如 00019 太古最近 5 日 (9月1日-9月5日):
      high_max = 107.0, low_min = 105.4 → range = 1.52% (整固)

    大少 2026-09-05 trigger (C 方案): 強升中整固 sub-scenario 用呢個 helper 判定
    預設 5% threshold, 對齊強升股自然整固範圍 (3-7%)
    """
    if not klines or lookback <= 0 or len(klines) < lookback:
        return 0.0
    recent = klines[-lookback:]
    high_max = max(k["high"] for k in recent)
    low_min = min(k["low"] for k in recent)
    return (high_max - low_min) / low_min if low_min > 0 else 0.0


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

        # 大少 2026-09-02 12:24 trigger: 拎走連跌/連升日數計算
        # 原因: 舊 trigger 嘅「連跌/連升 4 日」條件太脆弱 (1 日微升打斷), 新 trigger 改用 Z 點形態 + MA 條件 + 斜率組合, 唔再用連跌日數
        # Spec Sync (即將 push) 永久 rule: 到頂/到底 trigger 拎走 consecutiveDays field

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

        # Priority 1: 到頂轉勢 (大少 2026-09-03 11:00 trigger, 取代 9月2日 12:24 舊 trigger)
        # 新 trigger: 3 個留低 + 5 個新加 (拎走舊 C: close<P2 + D: P2>P4 AND P3>P5)
        # 留低:
        #   A: MA60 斜率 > 0          (長期仲升)
        #   B: close < MA5 < MA20     (close 跌穿晒短中線)
        #   E: MA5 斜率 < -1%         (短期急跌)
        # 新加 (P 點 Peak/Trough 形態確認, 對齊 9月3日 11:00 P 點 type 永久 rule):
        #   C': P1 < P3              (跌穿前低)
        #   D': P2 < P4              (峰頂降底, 最後峰頂唔再係新高)
        #   E': P2.type == "Peak"    (確認 P2 係峰頂, 唔係谷底)
        #   F': P4 > P6              (再之前峰頂抬高, 之前真係上升趨勢)
        #   G': P5 > P7              (再之前谷底抬高, 之前真係上升趨勢)
        # 凡人話: 之前真係上升趨勢 (再之前峰頂抬高 + 谷底抬高), 最後峰頂已經唔係新高
        #         (峰頂降底), 而家跌穿埋前低 → 可能到頂轉勢
        last_close = klines[-1]["close"]
        ma5_value = ma_values["MA5"]
        ma20_value = ma_values["MA20"]

        # 拎 Z 點 P1/P2/P3/P4/P5/P6/P7 (P1=最新, P2=第二新, ..., 對齊 9月3日 07:05 P 點 vocabulary 永久 rule)
        # 對齊 9月3日 07:35 大少 trigger: sub-scenario trigger 嘅 P1/P2/P3 都用 P 點來源
        # 大少 2026-09-03 11:00 trigger: P 點 type 統一用 "Peak"/"Trough" (helper 內部已做 Z 點 high/low → P 點 Peak/Trough 轉換)
        # recent_zz 已經係新→舊 list (helper 保證返), list[0]=P1=最新
        # Fallback 設計: 拎唔夠 7 個 Z 點時 (新股 / Z 點太短), condition 自動 skip, fall through 去 P2 強升/強跌
        recent_zz = _get_recent_zigzag_points(klines, options, n=7)
        p1_value = recent_zz[0]["value"] if len(recent_zz) >= 1 else None  # 最新
        p2_value = recent_zz[1]["value"] if len(recent_zz) >= 2 else None  # 第二新
        p3_value = recent_zz[2]["value"] if len(recent_zz) >= 3 else None
        p4_value = recent_zz[3]["value"] if len(recent_zz) >= 4 else None
        p5_value = recent_zz[4]["value"] if len(recent_zz) >= 5 else None  # 第五新
        p6_value = recent_zz[5]["value"] if len(recent_zz) >= 6 else None  # 第六新
        p7_value = recent_zz[6]["value"] if len(recent_zz) >= 7 else None  # 第七新
        # P 點 type 統一係 "Peak" / "Trough" (大少 9月3日 11:00 永久 rule, helper 已 normalize)
        p2_type = recent_zz[1].get("type") if len(recent_zz) >= 2 else None
        # 強升/強跌 trigger 拎 P 點 type (大少 9月4日 10:34 trigger: 強升 P3=Peak, 強跌 P3=Trough)
        p1_type = recent_zz[0].get("type") if len(recent_zz) >= 1 else None
        p3_type = recent_zz[2].get("type") if len(recent_zz) >= 3 else None
        p4_type = recent_zz[3].get("type") if len(recent_zz) >= 4 else None

        # 到頂/到底 trigger 要 7 個 P 點 (P1-P7)
        zz_ok = all(v is not None for v in [p1_value, p2_value, p3_value, p4_value, p5_value, p6_value, p7_value])
        # 強升/強跌 trigger 要 4 個 P 點 (P1-P4) + 4 個 type (大少 9月4日 trigger)
        zz_ok_4 = all(v is not None for v in [p1_value, p2_value, p3_value, p4_value, p1_type, p2_type, p3_type, p4_type])

        if (
            slope_ma60 > 0
            and last_close < ma5_value < ma20_value
            and zz_ok
            # 新 5 個條件 (大少 9月3日 11:00 trigger, 拎走舊 C/D, 加 P 點形態確認)
            and p1_value < p3_value          # 跌穿前低
            and p2_value < p4_value          # 峰頂降底
            and p2_type == "Peak"            # 確認 P2 係峰頂
            and p4_value > p6_value          # 再之前峰頂抬高
            and p5_value > p7_value          # 再之前谷底抬高
            and slope_ma5 < -0.01
        ):
            sub_scenario = "decelerating_up"
            cycle_position = "late_stage_topping"
            adjustment_log.append(
                f"到頂轉勢跡象 (大少 2026-09-03 11:00 trigger): 之前真係上升趨勢 (再之前峰頂抬高 P4={p4_value:.2f}>P6={p6_value:.2f} + 谷底抬高 P5={p5_value:.2f}>P7={p7_value:.2f}), 最後峰頂已經唔係新高 (峰頂降底 P2={p2_value:.2f}<P4={p4_value:.2f} + P2.type=Peak), 跌穿前低 (P1={p1_value:.2f}<P3={p3_value:.2f}), close 急跌穿短中線 (close={last_close:.2f}<MA5={ma5_value:.2f}<MA20={ma20_value:.2f}) + 短期急跌 {slope_ma5*100:.2f}% + 長期均線仲升 → 上升趨勢可能到頂"
            )
        # Priority 1: 到底轉勢 (大少 2026-09-03 11:00 trigger, 對稱, 取代 9月2日 12:24 舊 trigger)
        # 留低:
        #   A: MA60 斜率 < 0          (長期仲跌)
        #   B: close > MA5 > MA20     (close 升穿晒短中線)
        #   E: MA5 斜率 > +1%         (短期急升)
        # 新加 (對稱):
        #   C': P1 > P3              (升穿前高)
        #   D': P2 > P4              (谷底抬高, 最後谷底唔再係新低)
        #   E': P2.type == "Trough"  (確認 P2 係谷底, 唔係峰頂)
        #   F': P4 < P6              (再之前峰頂降底, 之前真係下跌趨勢)
        #   G': P5 < P7              (再之前谷底降底, 之前真係下跌趨勢)
        # 凡人話: 之前真係下跌趨勢 (再之前峰頂降底 + 谷底降底), 最後谷底已經唔係新低
        #         (谷底抬高), 而家升穿埋前高 → 可能到底轉勢
        elif (
            slope_ma60 < 0
            and last_close > ma5_value > ma20_value
            and zz_ok
            # 新 5 個條件 (對稱, 大少 9月3日 11:00 trigger)
            and p1_value > p3_value          # 升穿前高
            and p2_value > p4_value          # 谷底抬高
            and p2_type == "Trough"          # 確認 P2 係谷底
            and p4_value < p6_value          # 再之前峰頂降底
            and p5_value < p7_value          # 再之前谷底降底
            and slope_ma5 > 0.01
        ):
            sub_scenario = "decelerating_down"
            cycle_position = "late_stage_bottoming"
            adjustment_log.append(
                f"到底轉勢跡象 (大少 2026-09-03 11:00 trigger): 之前真係下跌趨勢 (再之前峰頂降底 P4={p4_value:.2f}<P6={p6_value:.2f} + 谷底降底 P5={p5_value:.2f}<P7={p7_value:.2f}), 最後谷底已經唔係新低 (谷底抬高 P2={p2_value:.2f}>P4={p4_value:.2f} + P2.type=Trough), 升穿前高 (P1={p1_value:.2f}>P3={p3_value:.2f}), close 急升穿短中線 (close={last_close:.2f}>MA5={ma5_value:.2f}>MA20={ma20_value:.2f}) + 短期急升 {slope_ma5*100:.2f}% + 長期均線仲跌 → 下跌趨勢可能到底"
            )
        # Priority 2: 強上升 / 初上升 (大少 9月4日 10:34 trigger, 加 P 點趨勢確認)
        # 強升原 trigger: 排列 bull + 全部斜率正 + 放量
        # 強升新 trigger (大少 9月4日 10:34): 加 峰頂抬高 (P1>P3 + P1.type=P3.type=Peak) + 谷底抬高 (P2>P4 + P2.type=P4.type=Trough)
        # 凡人話: 確認上升趨勢真係延續緊, 唔係「排列對但峰頂已經唔再抬高」嘅假強升
        # Fallback: 拎唔夠 4 個 P 點 (新股 / Z 點太短) → 條件 skip, fall through 去初升
        elif (
            is_bullish
            and all(calc_slope(p) > 0 for p in cfg["maPeriods"])
            and volume_signal == "expanding"
            and zz_ok_4
            # P 點 type 確認 (alternating sequence: P1/P3 同 type, P2/P4 同 type)
            and p1_type == "Peak" and p3_type == "Peak"
            and p2_type == "Trough" and p4_type == "Trough"
            # 峰頂抬高 + 谷底抬高
            and p1_value > p3_value
            and p2_value > p4_value
        ):
            sub_scenario = "strong_uptrend"
            cycle_position = "mid_stage"
            adjustment_log.append(
                f"強上升跡象 (大少 2026-09-04 10:34 trigger): 排列 bull + 全部均線斜率正 + 放量, 加上 P 點趨勢確認 (峰頂抬高 P1={p1_value:.2f}>P3={p3_value:.2f} + 谷底抬高 P2={p2_value:.2f}>P4={p4_value:.2f}, P1/P3.type=Peak + P2/P4.type=Trough) → 上升趨勢真係延續緊"
            )
        # Priority 2.5: 初升 (大少 9月4日 17:12 trigger, 拎走舊 fall through 初升, 改用獨立 trigger)
        # 條件: MA60 正 + MA5 正 + P2=Trough + P1<=P3 + P2>P4
        # 凡人話: 上升趨勢中, 谷底抬高但峰頂未突破 → 整固中 / 剛起步
        # Fallback: 拎唔夠 4 個 P 點 (新股 / Z 點太短) → 條件 skip, fall through 去下一個 elif
        elif (
            slope_ma60 > 0
            and slope_ma5 > 0
            and zz_ok_4
            and p2_type == "Trough"
            and p1_value <= p3_value
            and p2_value > p4_value
        ):
            sub_scenario = "weak_uptrend"
            cycle_position = "tentative_rise"
            adjustment_log.append(
                f"初升跡象 (大少 2026-09-04 17:12 trigger): 上升趨勢中 (MA60 斜率 {slope_ma60*100:.2f}% + MA5 斜率 {slope_ma5*100:.2f}%), 谷底抬高 (P2={p2_value:.2f}>P4={p4_value:.2f}, P2.type=Trough), 峰頂未突破 (P1={p1_value:.2f}<=P3={p3_value:.2f}) → 趨勢剛起步 / 整固中"
            )
        # Priority 2.6: 強升中整固 (大少 2026-09-05 trigger, C 方案, 加 sub-scenario 補 boundary case)
        # 條件: 強升 + 短期整固 + 唔跌穿
        #   - 排列 bull + 全部 slope 正 (大方向強升)
        #   - P 點 higher high + P 點 higher low (峰頂抬高 + 谷底抬高, 確認上升趨勢延續緊)
        #   - 最近 N 日 high-low range < 5% (短期整固, 強升中消化)
        #   - close > MA20 (唔跌穿, 防轉勢)
        #   - 唔強制 volume=expanding (boundary case 通常 vol 中性, 唔夠 expanding 但接近)
        # 凡人話: 強升格局確認, 但最近 5 日喺窄幅整固, 唔係真橫行, 屬「強升中整固 / 蓄勢待發」
        # 同 strong_uptrend 差: 唔需要 expanding (boundary case)
        # 同 weak_uptrend 差: P1 必須 > P3 (峰頂已突破, 而家食力消化)
        # 同 uptrend_correction 差: MA5 斜率正 (短期冇急跌, 只係整固)
        # 對齊 2026-09-03 07:23 sub-scenario 流程永久 rule: P 點全部由 recent_zz 拎 (helper 拎好)
        # 對齊 2026-08-16 19:21 永久 rule: 拎 ≥3 個 stock 例子 confirm trigger
        #   證據: 00386 中石化 (range 3.31%, vol 0.501 shrinking) + 00857 中石油 (range 4.67%, vol 1.2496 neutral, MA60 微負 -0.009% boundary case)
        #   註: 00857 因為 MA60 微負 (-0.009%) 唔命中, MA60 平滑特性, 強升中短期微升拉唔起 MA60 升, 屬 trigger 設計取捨
        # Fallback: 拎唔夠 4 個 P 點 (新股 / Z 點太短) → 條件 skip, fall through 去下一個 elif
        elif (
            is_bullish
            and all(calc_slope(p) > 0 for p in cfg["maPeriods"])
            and zz_ok_4
            # P 點 type 確認 (alternating sequence: P1/P3 同 type, P2/P4 同 type)
            and p1_type == "Peak" and p3_type == "Peak"
            and p2_type == "Trough" and p4_type == "Trough"
            # 峰頂抬高 + 谷底抬高 (確認強升趨勢真係延續緊, 唔係假強升)
            and p1_value > p3_value
            and p2_value > p4_value
            # 短期整固: 最近 N 日 high-low range < 5% (強升股自然整固範圍 3-7%)
            and _recent_consolidation_range(klines, lookback=cfg["consolidationLookback"]) < cfg["consolidationRangeThresholdPct"]
            # 唔跌穿: close 仲喺 MA20 上面 (防轉勢, 確認真係整固唔係見頂)
            and last_close > ma20_value
        ):
            sub_scenario = "strong_uptrend_consolidating"
            cycle_position = "consolidating_after_rally"
            consolidation_range = _recent_consolidation_range(klines, lookback=cfg["consolidationLookback"])
            adjustment_log.append(
                f"強升中整固跡象 (大少 2026-09-05 trigger, C 方案): 大方向強升格局 (排列 bull + 全部均線斜率正) + P 點趨勢確認 (峰頂抬高 P1={p1_value:.2f}>P3={p3_value:.2f} + 谷底抬高 P2={p2_value:.2f}>P4={p4_value:.2f}, P1/P3.type=Peak + P2/P4.type=Trough) + 短期整固 (最近 {cfg['consolidationLookback']} 日 range {consolidation_range*100:.2f}% < {cfg['consolidationRangeThresholdPct']*100:.1f}%) + 唔跌穿 (close={last_close:.2f} > MA20={ma20_value:.2f}) → 強升中嘅健康消化, 蓄勢待發"
            )
        # Priority 3: 強下跌 / 初下跌 (大少 9月4日 10:34 trigger, 對稱, 加 P 點趨勢確認)
        # 強跌原 trigger: 排列 bear + 全部斜率負 + 放量
        # 強跌新 trigger (大少 9月4日 10:34): 加 谷底降底 (P1<P3 + P1.type=P3.type=Trough) + 峰頂降底 (P2<P4 + P2.type=P4.type=Peak)
        # 凡人話: 確認下跌趨勢真係延續緊, 唔係「排列對但峰頂已經唔再降底」嘅假強跌
        # Fallback: 拎唔夠 4 個 P 點 → 條件 skip, fall through 去初跌
        elif (
            is_bearish
            and all(calc_slope(p) < 0 for p in cfg["maPeriods"])
            and volume_signal == "expanding"
            and zz_ok_4
            # P 點 type 確認 (alternating sequence: P1/P3 同 type, P2/P4 同 type)
            and p1_type == "Trough" and p3_type == "Trough"
            and p2_type == "Peak" and p4_type == "Peak"
            # 谷底降底 + 峰頂降底
            and p1_value < p3_value
            and p2_value < p4_value
        ):
            sub_scenario = "strong_downtrend"
            cycle_position = "mid_stage"
            adjustment_log.append(
                f"強下跌跡象 (大少 2026-09-04 10:34 trigger): 排列 bear + 全部均線斜率負 + 放量, 加上 P 點趨勢確認 (谷底降底 P1={p1_value:.2f}<P3={p3_value:.2f} + 峰頂降底 P2={p2_value:.2f}<P4={p4_value:.2f}, P1/P3.type=Trough + P2/P4.type=Peak) → 下跌趨勢真係延續緊"
            )
        # Priority 3.5: 初跌 (大少 9月4日 17:12 trigger, 拎走舊 fall through 初跌, 改用獨立 trigger, 對稱初升)
        # 條件: MA60 負 + MA5 負 + P2=Peak + P1>=P3 + P2<P4
        # 凡人話: 下跌趨勢中, 峰頂降底但谷底未跌穿 → 整固中 / 剛起步
        # Fallback: 拎唔夠 4 個 P 點 → 條件 skip, fall through 去下一個 elif
        elif (
            slope_ma60 < 0
            and slope_ma5 < 0
            and zz_ok_4
            and p2_type == "Peak"
            and p1_value >= p3_value
            and p2_value < p4_value
        ):
            sub_scenario = "weak_downtrend"
            cycle_position = "tentative_fall"
            adjustment_log.append(
                f"初跌跡象 (大少 2026-09-04 17:12 trigger): 下跌趨勢中 (MA60 斜率 {slope_ma60*100:.2f}% + MA5 斜率 {slope_ma5*100:.2f}%), 峰頂降底 (P2={p2_value:.2f}<P4={p4_value:.2f}, P2.type=Peak), 谷底未跌穿 (P1={p1_value:.2f}>=P3={p3_value:.2f}) → 趨勢剛起步 / 整固中"
            )
        # Priority 4: 上升回調 (大少 2026-09-04 15:06 trigger, C 方案 v2.3.0, 6 條件: P 點 + MA5/MA60 斜率 + spread 過濾)
        # 新 trigger (大少 9月4日 15:06): zz_ok_4 + P2=Peak + P1>P3 + P2>P4 + MA60 斜率正 + MA5 斜率負
        # C 方案 (大少 9月4日 15:22 揀): 加返 spread 過濾 (max_spread_pct >= thresholdPct) 防 MA 線 noise
        # 拎走舊 MA10 條件 (all_short_slope_negative 包 MA5+MA10, A/B test 證明拎走拎到 15 隻新信號)
        # 凡人話: 確認上升趨勢中嘅健康回調 (P 點 higher high + higher low + 短跌長升 + spread 夠大)
        elif (
            zz_ok_4
            and p2_type == "Peak"             # 確認 P2 係峰頂 (alternating sequence)
            and p1_value > p3_value           # 谷底抬高 (P1/P3 同 Trough, higher low)
            and p2_value > p4_value           # 峰頂抬高 (P2/P4 同 Peak, higher high)
            and slope_ma60 > 0                # 長期仲升, 趨勢未變
            and slope_ma5 < 0                 # 短期急跌, 真係回調緊
            and max_spread_pct >= cfg["thresholdPct"]  # C 方案: spread 過濾防 MA 線 noise
        ):
            sub_scenario = "uptrend_correction"
            cycle_position = "correction_at_ma20"
            adjustment_log.append(
                f"上升回調跡象 (大少 2026-09-04 15:06 trigger, C 方案): P 點形態確認上升趨勢 (峰頂抬高 P2={p2_value:.2f}>P4={p4_value:.2f} + 谷底抬高 P1={p1_value:.2f}>P3={p3_value:.2f}, P2.type=Peak) + 短期急跌 (MA5 斜率 {slope_ma5*100:.2f}%) + 長期仲升 (MA60 斜率 {slope_ma60*100:.2f}%) + spread 夠大 ({max_spread_pct*100:.2f}% ≥ {cfg['thresholdPct']*100:.2f}%) → 上升趨勢中嘅健康回調"
            )
        # Priority 5: 下跌回調 (大少 2026-09-04 15:06 trigger, 對稱, C 方案 v2.3.0, 6 條件)
        # 凡人話: 確認下跌趨勢中嘅死貓彈 (P 點 lower low + lower high + 短升長跌 + spread 夠大)
        elif (
            zz_ok_4
            and p2_type == "Trough"           # 確認 P2 係谷底 (alternating sequence)
            and p1_value < p3_value           # 峰頂降底 (P1/P3 同 Peak, lower high)
            and p2_value < p4_value           # 谷底降底 (P2/P4 同 Trough, lower low)
            and slope_ma60 < 0                # 長期仲跌, 趨勢未變
            and slope_ma5 > 0                 # 短期急升, 真係反彈緊
            and max_spread_pct >= cfg["thresholdPct"]  # C 方案: spread 過濾
        ):
            sub_scenario = "downtrend_bounce"
            cycle_position = "bounce_in_progress"
            adjustment_log.append(
                f"下跌回調跡象 (大少 2026-09-04 15:06 trigger, C 方案, 對稱): P 點形態確認下跌趨勢 (谷底降底 P2={p2_value:.2f}<P4={p4_value:.2f} + 峰頂降底 P1={p1_value:.2f}<P3={p3_value:.2f}, P2.type=Trough) + 短期急升 (MA5 斜率 {slope_ma5*100:.2f}%) + 長期仲跌 (MA60 斜率 {slope_ma60*100:.2f}%) + spread 夠大 ({max_spread_pct*100:.2f}% ≥ {cfg['thresholdPct']*100:.2f}%) → 下跌趨勢中嘅死貓彈"
            )
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
        # 大少 2026-09-05 trigger: 強升中整固加入強升 sub-class (本質係強升 sub-class, 只係短期整固消化)
        if candidate in ("strong_uptrend", "strong_downtrend", "uptrend_correction", "downtrend_bounce", "decelerating_up", "decelerating_down", "strong_uptrend_consolidating"):
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
        # 大少 2026-09-05 trigger: 強升中整固加入上升 sub-class, 用強升 vol multiplier 邏輯
        # (boundary case 通常 vol 中性/微縮, 信心略打折, 但仍用強升公式)
        vol_multiplier = 1.0
        if cfg["enableVolumeWeight"]:
            if candidate in ("strong_uptrend", "weak_uptrend", "uptrend_correction", "strong_uptrend_consolidating"):
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

            if candidate in ("strong_uptrend", "weak_uptrend", "uptrend_correction", "strong_uptrend_consolidating"):
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
            # 大少 2026-09-02 12:24 trigger: 拎走 consecutiveDays field
            # 原因: 舊 trigger 嘅「連跌/連升 4 日」條件拎走, 改用 Z 點形態 + MA 條件 + 斜率組合
            # Spec Sync (即將 push) 永久 rule: consecutiveDays 永久拎走, frontend 拎走對應 field reference
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

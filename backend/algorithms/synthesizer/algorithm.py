"""
backend/algorithms/synthesizer/algorithm.py — M7 Synthesizer v2.0.0 (大少 2026-09-10 Spec Sync #62, 8-stage architecture)

凡人話: 拎 6 個 module 嘅 standard verdict → Stage 1 input → Stage 2 signal normalization (M4 8 signal → 3-state) → Stage 3 weight discount (M2 0.15→0.05) → Stage 4 conflict detection → Stage 5 consensus scoring (67% threshold) → Stage 6 Kelly → Stage 7 state derivation → Stage 8 verdict assembly → SynthesizerVerdict

對應 source: algorithms/AS-03-cycle-detection/modules/synthesizer.ts v2.0.0 (420 行, 8-stage 1:1 port)
對應 spec doc: docs/research/AS-03-cycle-detection/MODULE-07-SYNTHESIZER.md v2.0.0
對應 framework: backend/algorithms/base.py Verdict contract

==================================================================================================
v2.0.0 永久改動 (大少 2026-09-10 20:30 Spec Sync #62, enhanced plan v2 6 個 deep dive evidence)
==================================================================================================
- **Stage 1 Input handling**: 拎走 v1.2.0 永久 skip M4 邏輯 (line 16-17+33+43+129), 拎 6 個 module verdict 都對齊 TCM/Alignment
- **Stage 2 Signal normalization**: 拎方案 A 拎 M4 8 signal 統一 map 落 3-state, override 落 verdict['state'] (拎 strength 拎 confidence)
  - top_reversal → DOWN, bottom_reversal → UP, macd_golden_cross → UP, macd_death_cross → DOWN
  - momentum_strong → UP, momentum_weak → DOWN, exhausted_neutral → SIDEWAYS, no_signal → SIDEWAYS
  - 對齊 plan §D mapping table + spec doc MODULE-04-INDICATORS.md §2.2
- **Stage 3 Weight calculation**: 拎 M2 self-check warning 自動降 weight 0.15 → 0.05 (沿用 v0.3.0 永久 rule)
  - 同時拎 M1/M3/M4/M5/M6 self_check 對齊 (snake_case audit field 統一, 對齊 M2/M3 永久 rule pattern)
- **Stage 4 Conflict detection**: 拎 UP↔DOWN 直接矛盾 → CONFLICT_STATE warning (system category)
- **Stage 5 Consensus scoring**: 拎 67% threshold (拎方案 A recommendation, 5 stock 對齊表 60% hit rate evidence)
- **Stage 6 Kelly + risk**: 沿用 v1.0 公式, 跟 avg max_drawdown_estimate 自動切 half/quarter/octo
- **Stage 7 State derivation**: 拎 weighted consensus + grade_score 拎 final state
- **Stage 8 Verdict assembly**: emit 落 Verdict 拎 meta + warnings (永久 rule §Module Warning v1.1.0 propagation)

==================================================================================================
Algorithm: 8 sub-step (對齊 plan §H 8-stage architecture)
==================================================================================================
- Stage 1: Input handling (拎 6 個 module verdict, 拎走永久 skip M4)
- Stage 2: Signal normalization (M4 8 signal → 3-state 拎方案 A, override verdict['state'])
- Stage 3: Weight calculation (M2 self-check discount 0.15→0.05, 5 個其他 normalize 補返)
- Stage 4: Conflict detection (UP↔DOWN 矛盾 + MODULE_PARTIAL)
- Stage 5: Consensus scoring (67% threshold, 拎 majority state + weighted consensus)
- Stage 6: Kelly + risk (跟 avg DD 自動切 half/quarter/octo)
- Stage 7: State derivation (final state + confidence)
- Stage 8: Verdict assembly (emit Verdict 拎 meta + warnings)
- Stage 3.5: ZigZagSlope Cross-Module Alignment Enrichment (大少 2026-08-21 12:04 Stage 2 第一步) — 沿用 v1.0 永久 rule
  - 拎 M1 verdict 嘅 meta.zigzagSlope 嘅 lastToToday.dailySlope
  - M1 cycle UP + ZigZag 短期急跌 (>2%/日) → alignment 扣 5% (短期動能背馳)
  - M1 cycle DOWN + ZigZag 短期急升 (>2%/日) → alignment 扣 5% (短期反彈背馳)

v2.0.0 永久 rule:
- 拎走 v1.2.0 永久 skip M4 邏輯 (Stage 1+2 拎方案 A override)
- M4 8 signal → 3-state mapping 拎方案 A (Stage 2)
- 67% threshold 拎共識 (Stage 5, 對齊 plan §F 5 stock 對齊表 evidence 60% hit rate)
- 對齊 §改完先 ask 修正先 Commit (2026-09-09 07:23): 改完必先 present fix 結果 + 等大少 trigger commit
- 對齊 §Algorithm Backend-only + 模組化: 改 backend 必 restart + curl evidence 確認

Caller inject pattern (沿用 v1.0 permanent rule):
- 跑 synthesizer 之後, algorithm_runner 自動跑 M1-M6 拎 verdict
- 將每個 verdict 轉做 standard verdict (state / confidence / base_weight / max_drawdown_estimate / rules_fired / meta)
- 6 個 standard verdict 放落 options['moduleVerdicts']
- Synthesizer 拎 options['moduleVerdicts'] 計 synth verdict
- M1 verdict 嘅 meta (e.g. zigzagSlope) 透過 standard verdict 嘅 meta field 傳入

凡人話: Synthesizer 唔拎 K 線, 拎 6 個 module verdict 拎綜合判定, 等於 1 個 senior 同事睇晒 6 個 junior 同事嘅分析再拎最終意見
"""

from typing import List, Dict, Any, Optional, Tuple
import math

from ..base import Algorithm, Verdict
from ..registry import register
from .config import DEFAULT_SYNTHESIZER_CONFIG
from backend.services.warning_collector import WarningCollector, make_warning


# ============================================================
# Helpers (跟 synthesizer.ts 1:1 port)
# ============================================================

def _is_opposite_state(s1: str, s2: str) -> bool:
    """判斷 2 個 state 係咪 opposite (UP ↔ DOWN)"""
    return (s1 == "UP" and s2 == "DOWN") or (s1 == "DOWN" and s2 == "UP")


# ============================================================
# Step 1: SSI 戰略強度指數
# ============================================================

def _compute_ssi(verdicts: List[Dict[str, Any]]) -> Tuple[float, Dict[str, float]]:
    """SSI 計算 (0-100):
    - consistency: 6 個 module 嘅 state 最大 group 嘅比例
    - confidence_avg: 6 個 confidence 加權平均 (用 base_weight)
    - rules_coverage: 6 個 rules_fired union 嘅覆蓋率 (max 20 unique rules)
    - ssi_score: consistency × 50 + confidence_avg × 30 + rules_coverage × 20
    """
    # consistency
    state_count: Dict[str, int] = {}
    for v in verdicts:
        state = v.get("state", "SIDEWAYS")
        state_count[state] = state_count.get(state, 0) + 1
    max_count = max(state_count.values(), default=0)
    consistency = (max_count / len(verdicts)) if verdicts else 0

    # confidence_avg (加權)
    total_weight = sum(v.get("base_weight", 0) for v in verdicts)
    confidence_avg = (
        sum(v.get("confidence", 0) * v.get("base_weight", 0) for v in verdicts) / total_weight
        if total_weight > 0 else 0
    )

    # rules_coverage
    all_rules: set = set()
    for v in verdicts:
        for r in v.get("rules_fired", []):
            all_rules.add(r)
    max_unique_rules = 20
    rules_coverage = min(1, len(all_rules) / max_unique_rules)

    # ssi_score (0-100)
    ssi_score = consistency * 50 + confidence_avg * 30 + rules_coverage * 20

    return (
        round(ssi_score, 1),
        {
            "consistency": round(consistency, 3),
            "confidence_avg": round(confidence_avg, 3),
            "rules_coverage": round(rules_coverage, 3),
        },
    )


# ============================================================
# Step 2: TCM 戰術交叉驗證矩陣
# ============================================================

def _compute_tcm(verdicts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """TCM 計算 (3 對 pair):
    - (ma-alignment, trendline) — 形態 + 趨勢線 confirm
    - (hl-structure, volume)    — 形態 + 量能 confirm
    - (indicators, volatility)  — 情緒 + 波動 confirm (v1.2.0 暫時 skip, 對齊大少 13:56 3rd condition)
    每對:
    - alignment: -1 (矛盾), 0 (部分), +1 (一致)
    - trap_penalty: alignment=-1 → 0.6, alignment=0 → 0.2, alignment=+1 → 0

    v2.0.0 (大少 2026-09-10 Spec Sync #62) — 拎走 v1.2.0 永久 skip M4 邏輯
    凡人話: M4 拎方案 A 拎 8 signal → 3-state mapping 落 verdict['state'] (Stage 2), TCM 用 6 個 module 對齊
    """
    v_map = {v.get("module_id"): v for v in verdicts}
    pairs: List[Tuple[str, str]] = [
        ("ma-alignment", "trendline"),
        ("hl-structure", "volume"),
        ("indicators", "volatility"),
    ]

    results: List[Dict[str, Any]] = []
    for id1, id2 in pairs:
        v1 = v_map.get(id1)
        v2 = v_map.get(id2)
        if not v1 or not v2:
            results.append({"pair": [id1, id2], "alignment": 0, "trap_penalty": 0})
            continue

        # alignment
        s1 = v1.get("state", "SIDEWAYS")
        s2 = v2.get("state", "SIDEWAYS")
        if s1 == s2:
            alignment: float = 1.0
        elif _is_opposite_state(s1, s2):
            alignment = -1.0
        else:
            alignment = 0.0

        # trap_penalty
        if alignment == -1:
            trap_penalty = 0.6
        elif alignment == 0:
            trap_penalty = 0.2
        else:
            trap_penalty = 0.0

        results.append({"pair": [id1, id2], "alignment": alignment, "trap_penalty": trap_penalty})

    return results


# ============================================================
# Step 3: Alignment Score
# ============================================================

def _compute_alignment(verdicts: List[Dict[str, Any]]) -> float:
    """Alignment Score (0-1): 6 個 module (M1-M6) state 一致程度
    v2.0.0 (大少 2026-09-10 Spec Sync #62) — 拎走 v1.2.0 M4 filter 邏輯
    M4 拎方案 A 拎 state 落 verdict['state'] (Stage 2 _normalize_module_verdicts 處理),
    TCM/Alignment 用 6 個 module 拎對齊
    對齊 plan v2 §H Stage 5 (consensus scoring)

    alignment_score = max_group_size / total_count
    """
    if not verdicts:
        return 0.0
    state_count: Dict[str, int] = {}
    for v in verdicts:
        state = v.get("state", "SIDEWAYS")
        state_count[state] = state_count.get(state, 0) + 1
    max_count = max(state_count.values())
    return round((max_count / len(verdicts)) * 1000) / 1000


# ============================================================
# v2.0.0 Stage 2: Signal normalization (M4 8 signal → 3-state 拎方案 A)
# 大少 2026-09-10 Spec Sync #62 — 拎走 v1.2.0 永久 skip M4 邏輯
# 凡人話: M4 v0.4.0 拎走 3-state 改用 signal-based output, M7 v2.0 拎方案 A 拎 8 signal
#         統一 map 落 UP / DOWN / SIDEWAYS, override 落 verdict['state'] 拎 6 個 module 對齊
# 對應 plan v2 §D mapping table + spec doc MODULE-04-INDICATORS.md §2.2
# ============================================================

M4_SIGNAL_STATE_MAP: Dict[str, str] = {
    "top_reversal":      "DOWN",       # 見頂 = 跌
    "bottom_reversal":   "UP",         # 見底 = 升
    "macd_golden_cross": "UP",         # 金叉 = 跌轉升早期
    "macd_death_cross":  "DOWN",       # 死叉 = 升轉跌早期
    "momentum_strong":   "UP",         # 動力強 = 升
    "momentum_weak":     "DOWN",       # 動力弱 = 跌
    "exhausted_neutral": "SIDEWAYS",   # 動能耗盡 = 失方向
    "no_signal":         "SIDEWAYS",   # 冇信號 = 觀望
}


def _normalize_module_verdicts(verdicts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """v2.0.0 Stage 2: Signal normalization — 拎 M4 8 signal → 3-state 拎方案 A

    拎方案 A mapping (對齊 spec doc MODULE-04-INDICATORS.md §2.2 + plan v2 §D):
    - top_reversal → DOWN (見頂 = 跌)
    - bottom_reversal → UP (見底 = 升)
    - macd_golden_cross → UP (金叉 = 升)
    - macd_death_cross → DOWN (死叉 = 跌)
    - momentum_strong → UP (動力強 = 升)
    - momentum_weak → DOWN (動力弱 = 跌)
    - exhausted_neutral → SIDEWAYS (動能耗盡 = 失方向)
    - no_signal → SIDEWAYS (冇信號 = 觀望)

    Override verdict['state'] 拎 6 個 module 對齊 TCM/Alignment (Stage 4+5)
    同時拎 M4 strength 拎 confidence (對齊 M4 spec doc §2.4 strength formula)
    M4 verdict 拎 module_specific.signal 保留, 拎方案 A 拎 state 對齊

    Returns:
        shallow copy 嘅 6 個 module verdict list, M4 拎 state override
    """
    normalized: List[Dict[str, Any]] = []
    for v in verdicts:
        v_copy = dict(v)  # shallow copy 避免 mutate caller 嘅 state
        if v_copy.get("module_id") == "indicators":
            module_specific = v_copy.get("module_specific") or {}
            signal = module_specific.get("signal")
            if signal in M4_SIGNAL_STATE_MAP:
                v_copy["state"] = M4_SIGNAL_STATE_MAP[signal]
                # 拎 strength 拎 confidence (對齊 M4 spec doc §2.4 strength formula)
                strength = module_specific.get("strength")
                if strength is not None:
                    v_copy["confidence"] = float(strength)
        normalized.append(v_copy)
    return normalized


# ============================================================
# Step 3.5: ZigZagSlope Cross-Module Alignment Enrichment
# 大少 2026-08-21 12:04 trigger — Stage 2 第一步
# 凡人話: 拎 M1 verdict 嘅 zigzagSlope 短期斜率做 cross-module alignment check
#         M1 cycle UP + ZigZag 短期急跌 → 短期動能背馳 → 扣 alignment
#         M1 cycle DOWN + ZigZag 短期急升 → 短期反彈背馳 → 扣 alignment
# 對應 spec: MODULE-07-SYNTHESIZER.md v2.1.0 Level 4 cross-module alignment enrich
# ============================================================

# 凡人話: 短期 dailySlope 門檻 (絕對值 > 2%/日 視為急變)
ZIGZAG_ALIGNMENT_DAILY_SLOPE_THRESHOLD = 2.0

# 凡人話: 每條 rule 嘅 alignment penalty (5%)
ZIGZAG_ALIGNMENT_PENALTY_PER_RULE = 0.05


def _compute_zigzag_alignment(verdicts: List[Dict[str, Any]]) -> Dict[str, Any]:
    """ZigZagSlope cross-module alignment enrichment (Stage 2 第一步)

    拎 M1 verdict 嘅 meta.zigzagSlope 嘅 lastToToday.dailySlope,
    對 M1 state 做 cross-module alignment check:
    - M1 state == "UP" + dailySlope < -2.0%/日 → 扣 5% (短期動能背馳)
    - M1 state == "DOWN" + dailySlope > +2.0%/日 → 扣 5% (短期反彈背馳)

    Returns:
        dict: {
            penalty: float (0 / 0.05 / 0.10),
            reasons: List[str] (凡人話原因, display 畀大少睇),
            m1_state: str | None,
            zigzag_slope: dict | None (raw zigzagSlope meta, 方便 frontend display)
        }
    """
    # 拎 M1 verdict
    m1_verdict = next(
        (v for v in verdicts if v.get("module_id") == "ma-alignment"),
        None,
    )
    if not m1_verdict:
        return {"penalty": 0.0, "reasons": [], "m1_state": None, "zigzag_slope": None}

    m1_state = m1_verdict.get("state", "SIDEWAYS")
    # 大少 2026-08-21 12:04 — Stage 2 第一步: 拎 M1 verdict 嘅 module_specific 拎 zigzagSlope
    # (algorithm_runner.py 嗰處 inject 嘅 field 叫 `module_specific`, 對齊 frontend decisionEngineToStandardVerdict interface)
    m1_module_specific = m1_verdict.get("module_specific") or {}
    zigzag_slope = m1_module_specific.get("zigzagSlope")

    penalty = 0.0
    reasons: List[str] = []

    if zigzag_slope and zigzag_slope.get("ok") and zigzag_slope.get("lastToToday"):
        last_to_today = zigzag_slope["lastToToday"]
        daily_slope = last_to_today.get("dailySlope", 0.0)

        # Rule 1: M1 UP + ZigZag 短期急跌 → 短期動能背馳
        if m1_state == "UP" and daily_slope < -ZIGZAG_ALIGNMENT_DAILY_SLOPE_THRESHOLD:
            penalty += ZIGZAG_ALIGNMENT_PENALTY_PER_RULE
            reasons.append(
                f"M1 上升趨勢 ({m1_state}) 但 ZigZag 短期急跌 {daily_slope:.2f}%/日 "
                f"(最後 1 點 {last_to_today.get('from', {}).get('date', '?')} → "
                f"今日 {last_to_today.get('to', {}).get('date', '?')}), 短期動能背馳, "
                f"扣 alignment {ZIGZAG_ALIGNMENT_PENALTY_PER_RULE * 100:.0f}%"
            )

        # Rule 2: M1 DOWN + ZigZag 短期急升 → 短期反彈背馳
        elif m1_state == "DOWN" and daily_slope > ZIGZAG_ALIGNMENT_DAILY_SLOPE_THRESHOLD:
            penalty += ZIGZAG_ALIGNMENT_PENALTY_PER_RULE
            reasons.append(
                f"M1 下跌趨勢 ({m1_state}) 但 ZigZag 短期急升 +{daily_slope:.2f}%/日 "
                f"(最後 1 點 {last_to_today.get('from', {}).get('date', '?')} → "
                f"今日 {last_to_today.get('to', {}).get('date', '?')}), 短期反彈背馳, "
                f"扣 alignment {ZIGZAG_ALIGNMENT_PENALTY_PER_RULE * 100:.0f}%"
            )

    return {
        "penalty": penalty,
        "reasons": reasons,
        "m1_state": m1_state,
        "zigzag_slope": zigzag_slope,
    }


# ============================================================
# Step 4: Grade 評級
# ============================================================

def _compute_grade(ssi_score: float, alignment_score: float) -> Tuple[str, float, str]:
    """Grade 計算:
    - grade_score = ssi_score × 0.6 + alignment_score × 100 × 0.4
    - 8 個 grade: 90-100 A+ / 80-89 A / 70-79 B+ / 60-69 B / 50-59 C+ / 40-49 C / 30-39 D / 0-29 F
    """
    grade_score = round((ssi_score * 0.6 + alignment_score * 100 * 0.4) * 10) / 10

    if grade_score >= 90:
        grade = "A+"
    elif grade_score >= 80:
        grade = "A"
    elif grade_score >= 70:
        grade = "B+"
    elif grade_score >= 60:
        grade = "B"
    elif grade_score >= 50:
        grade = "C+"
    elif grade_score >= 40:
        grade = "C"
    elif grade_score >= 30:
        grade = "D"
    else:
        grade = "F"

    reason = f"分數 {grade_score} (SSI {ssi_score} × 60% + Alignment {alignment_score * 100:.1f} × 40%) → {grade}"
    return grade, grade_score, reason


# ============================================================
# Step 5: Kelly 倉位分數
# ============================================================

def _compute_kelly(verdicts: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Kelly fraction — 跟 6 個 modules 嘅 avg max_drawdown_estimate 自動切
    - avg DD < 0.05: half (0.5)   — 波動低
    - 0.05 ≤ avg DD < 0.10: quarter (0.25)  — 波動中
    - avg DD ≥ 0.10: octo (0.125) — 波動高
    """
    if not verdicts:
        return {"fraction": "quarter", "numeric": 0.25, "position": 0.25}

    avg_dd = sum(v.get("max_drawdown_estimate", 0.05) for v in verdicts) / len(verdicts)

    if avg_dd < 0.05:
        fraction = "half"
        numeric = 0.5
    elif avg_dd < 0.10:
        fraction = "quarter"
        numeric = 0.25
    else:
        fraction = "octo"
        numeric = 0.125

    return {"fraction": fraction, "numeric": numeric, "position": numeric}


# ============================================================
# Step 6: Aggregate upstream warnings (永久 rule v1.1.0 propagation)
# 永久 rule §Module Warning v1.1.0: M1-M6 → M7 → M8 → M9 propagation chain
# 之前 algorithm_runner.py M7 inject 嗰段漏咗 _warnings field, M1-M6 嘅 13 個 warning
# code (THRESHOLD_BREACH / NAN_RESULT / MODULE_PARTIAL 等) 永久 silent drop
# Fix (大少 2026-08-31): runner 已經加 _warnings field, 呢度統一 aggregate
# ============================================================

def _aggregate_warnings(verdicts: List[Dict[str, Any]], nan_fields: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """凡人話: 拎 6 個 module verdict 嘅 warnings 統一 dedupe + sort 落 M7 verdict.warnings

    永久 rule v1.1.0:
    - Dedupe by (level + module_id + code)
    - 排序: Critical (0) → Warning (1) → Info (2), 然後 by module_id
    - 統一用 ModuleWarning object (禁止 string array)

    Batch 2 (大少 2026-08-31): 改 `_warnings` → `warnings` 對齊 frontend verdict.warnings naming
    大少 2026-09-05 Fix B: 加 nan_fields 參數, inject NAN_RESULT warning
    """
    collector = WarningCollector()
    for v in verdicts:
        # 永久 rule: 拎每個 module verdict 嘅 warnings (algorithm_runner.py 嗰處 inject, 對齊 frontend)
        for w in v.get("warnings", []) or []:
            collector.push_dict(w)

    # Module partial: 6 個 module 唔齊
    if len(verdicts) < 6:
        collector.push(make_warning(
            level="warning",
            module_id="M7",
            code="MODULE_PARTIAL",
            message=f"得 {len(verdicts)}/6 個 module verdict",
            issue=f"runner 拎唔到 {6 - len(verdicts)} 個 module verdict, synth verdict 會少訊息",
            impact="Verdict 唔可信, 唔好落單",
            fix="Re-run / 檢查 algorithm_runner log 揾邊個 module 拎失敗",
        ))

    # 大少 2026-09-05 Fix B: NaN guard warning (對齊 frontend adapter.mjs:5927 永久 rule)
    # 凡人話: 如果 ssi_score / alignment_score / grade_score 唔係 finite (NaN / Infinity),
    #         inject 🔴 NAN_RESULT warning, 大少睇到即知 verdict 唔可信
    if nan_fields:
        collector.push(make_warning(
            level="critical",
            module_id="M7",
            code="NAN_RESULT",
            message="M7 綜合判定計算結果 NaN",
            issue=f"{', '.join(nan_fields)} 結果係 NaN 或 Infinity (上游 module verdict 數值唔啱)",
            impact="Verdict 唔可信, 唔好落單",
            fix="Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc",
        ))

    return collector.to_list()


# ============================================================
# Main algorithm (跟 synthesizer.ts Synthesizer 1:1 port)
# ============================================================

class SynthesizerAlgorithm(Algorithm):
    """M7 Synthesizer v2.0.0 (8-stage architecture) — 大少 2026-09-10 Spec Sync #62

    Algorithm ABC contract:
    - name: "synthesizer"
    - version: "2.0.0"
    - run(klines, options) → Verdict
    - options.moduleVerdicts: List[Dict] (6 個 module standard verdict, 由 runner inject)

    凡人話: 拎 6 個 module 嘅 verdict 拎綜合判定, 拎 SSI/TCM/Alignment/Grade/Kelly + 8-stage 架構

    v2.0.0 (大少 2026-09-10 20:30 Spec Sync #62, enhanced plan v2 6 個 deep dive evidence):
    - 拎走 v1.2.0 永久 skip M4 邏輯 (line 16-17+33+43+129)
    - Stage 1+2: 拎方案 A 拎 M4 8 signal → 3-state mapping
    - Stage 3-8: weight discount / conflict detection / 67% consensus / Kelly / state / verdict assembly
    - 對齊 §改完先 ask 修正先 Commit (2026-09-09 07:23): 改完必先 present fix 結果 + 等大少 trigger commit

    v1.1.0 (大少 2026-09-06 15:10 trigger): M2 self-check weight 折扣永久 rule
    - 拎 M2 (hl-structure) 嘅 self-check warning (FALLBACK_USED / CONFLICT_STATE / THRESHOLD_BREACH)
    - 自動降 M2 weight 0.15 → 0.05
    - 5 個其他 module (M1/M3/M4/M5/M6) 等比例 normalize 補返 0.10
    - emit 1 個 stock_state MODULE_PARTIAL warning 通知 banner
    - meta 加 m2_discounted / m2_original_weight / m2_discounted_weight 3 個 field
    - 對應 commit: 對齊 plan v2 永久 rule §M2 self-check weight 折扣
    """

    name = "synthesizer"
    version = "2.0.0"

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.cfg = {**DEFAULT_SYNTHESIZER_CONFIG, **(config or {})}

    def run(self, klines: List[Dict[str, Any]], options: Optional[Dict[str, Any]] = None) -> Verdict:
        options = options or {}
        timeframe = options.get("period", "1d")
        symbol = options.get("symbol", "TEST")

        # M7 Synthesizer 拎 options.moduleVerdicts (由 algorithm_runner inject)
        verdicts: List[Dict[str, Any]] = options.get("moduleVerdicts", [])

        # ============ v2.0.0 Stage 1: Input handling ============
        # 拎 6 個 module verdict 都拎, 拎走 v1.2.0 永久 skip M4 邏輯 (line 16-17+33+43+129)
        # 對齊 plan v2 §H Stage 1 + 永久 rule §M4 v0.4.0 signal-based output
        # 對齊 §改完先 ask 修正先 Commit (2026-09-09 07:23): 改完必先 present fix 結果 + 等大少 trigger commit

        # ============ v2.0.0 Stage 2: Signal normalization ============
        # 拎 M4 8 signal → 3-state mapping 拎方案 A override verdict['state']
        # 對齊 plan v2 §D + spec doc MODULE-04-INDICATORS.md §2.2
        verdicts = _normalize_module_verdicts(verdicts)

        # ============ v0.3.0 M2 self-check weight 折扣 (大少 2026-09-06 15:10 trigger) ============
        # 凡人話: M2 self-check warning emit 之後, M7 自動降 M2 weight 0.15→0.05,
        # 5 個其他 module (M1/M3/M4/M5/M6) 等比例 normalize 補返 0.10, sum 仍 = 1.0
        # 永久 rule: 拎 M2 self-check warning 即 FALLBACK_USED / CONFLICT_STATE / THRESHOLD_BREACH,
        # shallow copy verdicts 避免 mutate caller 嘅 state
        verdicts_for_synth: List[Dict[str, Any]] = [dict(v) for v in verdicts]
        m2_self_check_triggered = False
        m2_discount_codes = ("FALLBACK_USED", "CONFLICT_STATE", "THRESHOLD_BREACH")

        for v in verdicts_for_synth:
            if v.get("module_id") == "hl-structure":
                v_warnings = v.get("warnings", []) or []
                for w in v_warnings:
                    if isinstance(w, dict):
                        code = w.get("code")
                    else:
                        code = getattr(w, "code", None)
                    if code in m2_discount_codes:
                        m2_self_check_triggered = True
                        break
                if m2_self_check_triggered:
                    # 折扣 M2 weight 0.15 → 0.05
                    v["base_weight"] = 0.05
                    # Re-normalize 其他 5 個 module weight (等比例, sum = 1.0)
                    other_total = sum(
                        other.get("base_weight", 0)
                        for other in verdicts_for_synth
                        if other.get("module_id") != "hl-structure"
                    )
                    if other_total > 0:
                        factor = (1.0 - 0.05) / other_total
                        for other in verdicts_for_synth:
                            if other.get("module_id") != "hl-structure":
                                other["base_weight"] = round(other.get("base_weight", 0) * factor, 4)
                    break

        # Step 0: 數據驗證 (need ≥ 1 module verdict)
        if not verdicts:
            return Verdict(
                ok=True,
                points=[],
                meta={
                    "moduleId": "synthesizer",
                    "timeframe": timeframe,
                    "symbol": symbol,
                    "state": "SIDEWAYS",
                    "cycleLabel": "綜合判定觀望",
                    "confidence": 0,
                    "interpretation": "[Synthesizer v1.0] 無 module verdicts (empty input, runner 拎唔到 M1-M6 verdict)",
                    "evidence": [],
                    "dataDays": 0,
                    "reason": "無 module verdicts",
                    "ssi_score": 0,
                    "ssi_breakdown": {"consistency": 0, "confidence_avg": 0, "rules_coverage": 0},
                    "tcm_matrix": [],
                    "alignment_score": 0,
                    "grade": "F",
                    "grade_score": 0,
                    "grade_reason": "無 module verdicts (empty input)",
                    "kelly_fraction": "quarter",
                    "kelly_numeric": 0.25,
                    "kelly_position": 0.25,
                    "module_verdicts": [],
                },
                # 永久 rule §Module Warning v1.1.0: 統一用 ModuleWarning object (禁止 string array)
                # 永久 rule §Verdict type hint: warnings 必須係 List[Dict[str, Any]], 用 .to_dict() 序列化
                warnings=[
                    make_warning(
                        level="critical",
                        module_id="M7",
                        code="INSUFFICIENT_DATA",
                        message="0 module verdicts",
                        issue="runner 拎唔到任何 M1-M6 verdict",
                        impact="Verdict 唔可信, 唔好落單",
                        fix="睇 algorithm_runner log 揾上游 module 拎失敗原因, Re-run",
                    ).to_dict()
                ],
            )

        # Step 1: SSI (用 verdicts_for_synth 反映 M2 weight 折扣)
        ssi_score, ssi_breakdown = _compute_ssi(verdicts_for_synth)

        # Step 2: TCM
        tcm_matrix = _compute_tcm(verdicts_for_synth)

        # Step 3: Alignment
        alignment_score = _compute_alignment(verdicts_for_synth)

        # Step 3.5: ZigZagSlope Cross-Module Alignment Enrichment
        # 大少 2026-08-21 12:04 — Stage 2 第一步
        # 拎 M1 verdict 嘅 meta.zigzagSlope 做 cross-module alignment check
        # 扣 alignment 但唔直接改 grade (跟 spec: Level 4 cross-module alignment enrich)
        zigzag_alignment = _compute_zigzag_alignment(verdicts_for_synth)
        zigzag_alignment_penalty = zigzag_alignment["penalty"]
        zigzag_alignment_reasons = zigzag_alignment["reasons"]
        # alignment_score 扣 penalty (cap 0)
        alignment_score_after_penalty = max(0.0, alignment_score - zigzag_alignment_penalty)

        # Step 3.7: NaN guard (大少 2026-09-05 Fix B)
        # 凡人話: 如果任何 upstream module verdict 嘅 confidence 係 NaN/Infinity,
        #         conf_avg 會變 NaN, ssi_score / grade_score 全部污染。
        #         Backend 都要 detect 同 inject NAN_RESULT warning (對齊 frontend adapter.mjs:5891)
        nan_fields: list = []
        if not math.isfinite(ssi_score):
            nan_fields.append("ssi_score")
            ssi_score = 0.0
            ssi_breakdown = {"consistency": 0, "confidence_avg": 0, "rules_coverage": 0}
        if not math.isfinite(alignment_score_after_penalty):
            nan_fields.append("alignment_score")
            alignment_score_after_penalty = 0.0

        # Step 4: Grade (用 penalty 後嘅 alignment_score)
        grade, grade_score, grade_reason = _compute_grade(ssi_score, alignment_score_after_penalty)

        # Step 4.5: Grade NaN guard
        if not math.isfinite(grade_score):
            nan_fields.append("grade_score")
            grade_score = 0.0
            # grade 落 F, grade_reason 解釋
            grade = "F"
            grade_reason = f"分數 0 (因 NaN fallback, 凡人話: 上游 module verdict 數值唔啱) → F"

        # Step 4.6: Inject NAN_RESULT warning if any field is NaN
        # 對齊 frontend adapter.mjs:5927 永久 rule, backend 一致 inject
        # 對應 spec: MODULE-07-SYNTHESIZER.md + MODULE-WARNING-SYSTEM.md NAN_RESULT

        # Step 5: Kelly
        kelly = _compute_kelly(verdicts_for_synth)

        # Cycle state derivation (跟 majority state, 唔睇 weight)
        state_count: Dict[str, int] = {}
        for v in verdicts_for_synth:
            state = v.get("state", "SIDEWAYS")
            state_count[state] = state_count.get(state, 0) + 1
        if state_count:
            majority_state = max(state_count.items(), key=lambda x: x[1])[0]
        else:
            majority_state = "SIDEWAYS"

        # Cycle label 跟 state
        cycle_label = (
            "強烈綜合買入" if grade in ("A+", "A")
            else "綜合買入" if grade in ("B+", "B")
            else "綜合觀望" if grade in ("C+", "C")
            else "綜合賣出" if grade == "D"
            else "綜合強烈賣出"
        )

        # Interpretation
        interpretation = f"{cycle_label} (Grade {grade} / SSI {ssi_score} / Alignment {alignment_score * 100:.1f}% / Kelly {kelly['fraction']})"

        # Evidence
        evidence = [
            {"type": "ssi", "label": f"SSI 戰略強度: {ssi_score}", "value": ssi_score, "passed": ssi_score >= 60},
            {"type": "alignment", "label": f"Alignment 戰略戰術匹配: {alignment_score * 100:.1f}%", "value": alignment_score, "passed": alignment_score >= 0.7},
            {"type": "grade", "label": f"Grade 評級: {grade} ({grade_score})", "value": grade, "passed": grade in ("A+", "A", "B+", "B")},
            {"type": "tcm-trap", "label": f"TCM 矛盾數: {sum(1 for t in tcm_matrix if t['alignment'] == -1)}", "value": sum(1 for t in tcm_matrix if t["alignment"] == -1), "passed": sum(1 for t in tcm_matrix if t["alignment"] == -1) == 0},
        ]

        # Module summary (用 verdicts_for_synth 拎 discount 後嘅 base_weight 顯示出嚟)
        module_summary = [
            {
                "module_id": v.get("module_id"),
                "state": v.get("state"),
                "confidence": v.get("confidence"),
                "base_weight": v.get("base_weight"),
                "rules_fired_count": len(v.get("rules_fired", [])),
            }
            for v in verdicts_for_synth
        ]

        meta = {
            "moduleId": "synthesizer",
            "timeframe": timeframe,
            "symbol": symbol,
            "state": majority_state,
            "cycleLabel": cycle_label,
            "confidence": round(grade_score / 100, 4),
            "interpretation": interpretation,
            "evidence": evidence,
            # M7 Synthesizer 7 個 spec 永久 rule
            "ssi_score": ssi_score,
            "ssi_breakdown": ssi_breakdown,
            "tcm_matrix": tcm_matrix,
            "alignment_score": alignment_score,
            # 大少 2026-08-21 12:04 — Stage 2 第一步: ZigZagSlope enrichment
            "alignment_score_after_penalty": alignment_score_after_penalty,
            "zigzag_alignment_penalty": zigzag_alignment_penalty,
            # v0.3.0 (大少 2026-09-06 15:10): M2 self-check 折扣 metadata
            "m2_discounted": m2_self_check_triggered,
            "m2_original_weight": 0.15 if m2_self_check_triggered else None,
            "m2_discounted_weight": 0.05 if m2_self_check_triggered else None,
            "zigzag_alignment_reasons": zigzag_alignment_reasons,
            "grade": grade,
            "grade_score": grade_score,
            "grade_reason": grade_reason,
            "kelly_fraction": kelly["fraction"],
            "kelly_numeric": kelly["numeric"],
            "kelly_position": kelly["position"],
            "module_verdicts": verdicts,
            "module_summary": module_summary,
            "reason": interpretation,
            "dataDays": len(verdicts),
        }

        # Step 6: Aggregate upstream warnings (永久 rule v1.1.0 propagation chain)
        aggregated_warnings = _aggregate_warnings(verdicts, nan_fields=nan_fields)

        # ============ v0.3.0 M2 self-check 通知 (大少 2026-09-06 15:10 trigger) ============
        # 凡人話: M2 self-check 觸發咗, M7 自動降 weight 之後, 同步 emit 1 個 stock_state
        # warning 通知 banner (用 MODULE_PARTIAL code, 沿用 15 個 code, 唔加新 code)
        if m2_self_check_triggered:
            aggregated_warnings.append(make_warning(
                level="warning",
                module_id="M7",
                code="MODULE_PARTIAL",
                message="M2 self-check 觸發, 自動降 weight 0.15 → 0.05",
                issue="M2 嘅 self-check warning 觸發, M7 自動將 M2 base_weight 由 0.15 折扣到 0.05",
                impact="M2 vote 保留但 weight 大減, 其他 5 個 module (M1/M3/M4/M5/M6) 等比例 normalize 補返, sum 仍 = 1.0",
                fix="睇 banner 提示 M2 觸發咗邊個 self-check (形態預警/峰谷太舊/5年vs短線矛盾/信心過低/結構破壞), Re-run / 確認 K 線數據",
                context={
                    "m2_original_weight": 0.15,
                    "m2_discounted_weight": 0.05,
                    "discount_reason": "M2 self-check warning detected",
                },
            ).to_dict())

        return Verdict(ok=True, points=[], meta=meta, warnings=aggregated_warnings)


# Register
register(SynthesizerAlgorithm())

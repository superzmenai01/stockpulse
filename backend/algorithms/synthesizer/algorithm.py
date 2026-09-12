"""
backend/algorithms/synthesizer/algorithm.py — M7 Synthesizer v2.0.1 (大少 2026-09-11 confirm fix, 8-stage architecture)

凡人話: 拎 6 個 module 嘅 standard verdict → Stage 1 input → Stage 2 signal normalization (M4 8 signal → 3-state) → Stage 3 weight discount (M2 0.15→0.05) → Stage 4 conflict detection → Stage 5 consensus scoring (67% threshold) → Stage 6 Kelly → Stage 7 state derivation → Stage 8 verdict assembly → SynthesizerVerdict

對應 source: algorithms/AS-03-cycle-detection/modules/synthesizer.ts v2.0.0 (420 行, 8-stage 1:1 port)
對應 spec doc: docs/research/AS-03-cycle-detection/MODULE-07-SYNTHESIZER.md v2.0.0
對應 framework: backend/algorithms/base.py Verdict contract

==================================================================================================
v2.0.1 永久改動 (大少 2026-09-11 confirm fix — 4 個 bug fix)
==================================================================================================
- **Stage 3 weight_discounts 加 category check**: 拎走 stock_state category 嘅 self-check warning, 對齊 §Module Warning v1.1.0 spirit (stock_state 屬 verdict 已經準確, 唔 trigger weight discount). 只對 system category 嘅 FALLBACK_USED / CONFLICT_STATE / THRESHOLD_BREACH / VERDICT_MISSING 觸發 discount
- **Stage 3 normalize fallback**: 5 個 module 全部 self-check 觸發 (other_total == 0) 嗰陣, 拎每個 trigger module 1/n normalize 補返 sum = 1.0, 避免 5×0.05 = 0.25 唔等於 1.0 嘅 bug
- **Stage 7 cycleLabel 跟 state**: 拎走 v2.0.0 grade-based 寫法 (A+/A/B+/B/C+/C/D/F 對應 cycleLabel), 改 state-based 寫法 (UP→綜合看升, DOWN→綜合看跌, SIDEWAYS→綜合觀望). 對齊 spec spirit: 副校長嘅 label 應該跟老師嘅 state 寫, 唔再睇 grade
- **Stage 8 module_verdicts emit normalized weight**: 拎走 raw verdict 嘅 base_weight (0.25/0.15/0.10/0.10/0.10/0.10), emit normalized weight (對齊 backend 計嘅 discount + normalize). 凡人話: frontend 拎到嘅 base_weight 對齊 backend 計嘅, 1 個 source of truth

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
    v2.0.4 (大少 2026-09-12 07:28 Spec Sync #65) — 方案 A 拎走 SIDEWAYS 共識 bonus
    凡人話: 6 個朋友都話「冇所謂」(SIDEWAYS 共識), 唔應該當「100% 對齊」拎 bonus
    對齊 plan v2 §H Stage 5 (consensus scoring)

    v2.0.0 (大少 2026-09-10 Spec Sync #62) — 拎走 v1.2.0 M4 filter 邏輯
    M4 拎方案 A 拎 state 落 verdict['state'] (Stage 2 _normalize_module_verdicts 處理),
    TCM/Alignment 用 6 個 module 拎對齊

    alignment_score = max_group_size / total_count, 但 SIDEWAYS 最多 → 0
    (冇方向 = 冇對齊)
    """
    if not verdicts:
        return 0.0
    state_count: Dict[str, int] = {}
    for v in verdicts:
        state = v.get("state", "SIDEWAYS")
        state_count[state] = state_count.get(state, 0) + 1

    # v2.0.4 方案 A (大少 9月12日 07:28 Spec Sync #65):
    # 拎最多 state, 如果係 SIDEWAYS → 對齊分 = 0
    # 凡人話: 6 個老師都話「唔郁」, 唔應該當「對齊」拎 alignment bonus
    max_state = max(state_count, key=state_count.get)
    if max_state == "SIDEWAYS":
        return 0.0

    max_count = state_count[max_state]
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
# v2.0.0 Stage 3: Weight discount generalization (大少 2026-09-10 23:06 永久 rule)
# 凡人話: 拎任何 module 嘅 self-check warning, 自動降 base_weight 落 0.05
#         其他 5 個 module 等比例 normalize 補返, sum 仍 = 1.0
# 對齊永久 rule:
# - §M2 self-check weight 折扣 (大少 2026-09-06 15:10): 沿用 4 個 trigger code 拎 generalize
# - §M2 self-check penalty (Spec Sync #48): 拎 4 個 critical + warning level code (FALLBACK_USED / CONFLICT_STATE / THRESHOLD_BREACH / VERDICT_MISSING)
# - §M3 self-check warning (Spec Sync #45)
# - §M4 self-check warning (Spec Sync #52)
# - §M5 self-check warning (Spec Sync #58)
# - §M6 self-check warning (Spec Sync #54)
# 對齊 §Module Warning v1.1.0: info level (DATA_AGE) 唔觸發 discount
# ============================================================

# 凡人話: 各 module 嘅 default base_weight (對齊 algorithm_runner.py line 277-282)
MODULE_BASE_WEIGHTS: Dict[str, float] = {
    "ma-alignment": 0.25,
    "hl-structure":  0.15,
    "trendline":     0.10,
    "indicators":    0.10,
    "volume":        0.10,
    "volatility":    0.10,
}

# 凡人話: 邊啲 warning code 觸發 self-check weight discount
# 對齊 §M2 self-check penalty 永久 rule 4 個 critical + warning code
# (FALLBACK_USED / CONFLICT_STATE / THRESHOLD_BREACH / VERDICT_MISSING)
# 拎走 info level (DATA_AGE) 對齊 §Module Warning v1.1.0 spirit
SELF_CHECK_TRIGGER_CODES: Tuple[str, ...] = (
    "FALLBACK_USED",
    "CONFLICT_STATE",
    "THRESHOLD_BREACH",
    "VERDICT_MISSING",
)

# 凡人話: self-check 觸發後, 拎 module 嘅 base_weight 折到 0.05 (對齊 M2 永久 rule spirit)
SELF_CHECK_DISCOUNT_TARGET_WEIGHT: float = 0.05


def _extract_warning_code(w: Any) -> Optional[str]:
    """拎 warning 嘅 code (對齊 ModuleWarning object 或 dict)"""
    if isinstance(w, dict):
        return w.get("code")
    return getattr(w, "code", None)


def _extract_warning_category(w: Any) -> Optional[str]:
    """拎 warning 嘅 category (對齊 ModuleWarning object 或 dict)"""
    if isinstance(w, dict):
        return w.get("category")
    return getattr(w, "category", None)


def _has_self_check_trigger(verdict: Dict[str, Any]) -> bool:
    """檢查 verdict 嘅 warnings 入面有冇 self-check trigger code (Stage 3 入口)

    v2.0.1 永久 rule: 拎走 stock_state category 嘅 self-check warning
    對齊 §Module Warning v1.1.0: stock_state 屬 verdict 已經準確, 只係狀態提示, 唔 trigger weight discount
    只對 system category 嘅 self-check warning 觸發 weight discount
    """
    for w in (verdict.get("warnings") or []):
        code = _extract_warning_code(w)
        category = _extract_warning_category(w)
        if code in SELF_CHECK_TRIGGER_CODES:
            # 對齊 §Module Warning v1.1.0 spirit: stock_state 唔 trigger discount
            if category == "stock_state":
                continue
            return True
    return False


def _apply_weight_discounts(verdicts: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """v2.0.0 Stage 3: Generalize weight discount — 拎任何 module 嘅 self-check warning 自動降 weight

    凡人話: 6 個 module 任何一個 emit self-check warning (FALLBACK_USED / CONFLICT_STATE /
            THRESHOLD_BREACH / VERDICT_MISSING), M7 自動將該 module 嘅 base_weight 折到 0.05,
            其他 5 個 module 等比例 normalize 補返, sum 仍 = 1.0

    對齊永久 rule:
    - §M2 self-check weight 折扣 (Spec Sync v0.3.0 沿用)
    - §M3 / §M4 / §M5 / §M6 self-check warning: generalize 至所有 module

    Returns:
        (normalized_verdicts, discount_meta_list)
        - normalized_verdicts: shallow copy 嘅 verdict list, 已套用 discount + normalize
        - discount_meta_list: List[Dict], 每個 entry 描述 1 個 module 嘅 discount 詳情
          [
            {
              "module_id": "hl-structure",
              "triggered": True,
              "original_weight": 0.15,
              "discounted_weight": 0.05,
              "trigger_codes": ["FALLBACK_USED", "CONFLICT_STATE"],
            },
            ...
          ]
    """
    # 拎 list copy 避免 mutate caller 嘅 state
    verdicts_copy: List[Dict[str, Any]] = [dict(v) for v in verdicts]

    # 拎 6 個 module 嘅 default base_weight (algorithm_runner 拎 normalized 過嘅值可能唔同, 拎 meta fallback)
    discount_meta: List[Dict[str, Any]] = []
    for v in verdicts_copy:
        module_id = v.get("module_id")
        default_w = MODULE_BASE_WEIGHTS.get(module_id, v.get("base_weight", 0))
        triggered = _has_self_check_trigger(v)
        trigger_codes: List[str] = []
        if triggered:
            for w in (v.get("warnings") or []):
                code = _extract_warning_code(w)
                if code in SELF_CHECK_TRIGGER_CODES and code not in trigger_codes:
                    trigger_codes.append(code)
        discount_meta.append({
            "module_id": module_id,
            "triggered": triggered,
            "original_weight": default_w,
            "discounted_weight": SELF_CHECK_DISCOUNT_TARGET_WEIGHT if triggered else default_w,
            "trigger_codes": trigger_codes,
        })

    # 拎 list 拎邊啲 module 觸發 self-check
    triggered_ids = {d["module_id"] for d in discount_meta if d["triggered"]}

    # 套用 discount + re-normalize
    if triggered_ids:
        # 拎觸發 module 嘅 discount 落 base_weight = 0.05
        for v in verdicts_copy:
            if v.get("module_id") in triggered_ids:
                v["base_weight"] = SELF_CHECK_DISCOUNT_TARGET_WEIGHT

        # 拎其他 module 等比例 normalize 補返 (sum = 1.0)
        other_total = sum(
            v.get("base_weight", 0)
            for v in verdicts_copy
            if v.get("module_id") not in triggered_ids
        )
        if other_total > 0:
            target_other_total = 1.0 - SELF_CHECK_DISCOUNT_TARGET_WEIGHT * len(triggered_ids)
            factor = target_other_total / other_total
            for v in verdicts_copy:
                if v.get("module_id") not in triggered_ids:
                    v["base_weight"] = round(v.get("base_weight", 0) * factor, 4)
        else:
            # v2.0.1 fix: 所有 module 都 trigger (other_total == 0), 拎每個 trigger module normalize 補返 sum = 1.0
            # 凡人話: 強跌股 5 個 module 全部 self-check 觸發, sum 1/n 拎平均, 唔可以跌 0.25
            equal_weight = round(1.0 / len(triggered_ids), 4) if triggered_ids else 0
            for v in verdicts_copy:
                if v.get("module_id") in triggered_ids:
                    v["base_weight"] = equal_weight

    return verdicts_copy, discount_meta


def _detect_conflicts(verdicts: List[Dict[str, Any]]) -> List[Tuple[str, str]]:
    """v2.0.0 Stage 4: Conflict detection — 拎 UP↔DOWN 直接矛盾 pairs

    凡人話: 6 個 module 任何 1 對 state 直接矛盾 (M1 升 + M2 跌 互相打架),
            M7 拎到就 emit 1 個 system CONFLICT_STATE warning + 紀錄 conflict_pairs 落 meta
            對綜合判定有疑問, 大少見到 banner 即知「呢個 verdict 內部有矛盾」

    Returns:
        List[Tuple[str, str]] — conflict pairs [(module_id_1, module_id_2), ...]
    """
    conflicts: List[Tuple[str, str]] = []
    n = len(verdicts)
    for i in range(n):
        for j in range(i + 1, n):
            s1 = verdicts[i].get("state", "SIDEWAYS")
            s2 = verdicts[j].get("state", "SIDEWAYS")
            if _is_opposite_state(s1, s2):
                id1 = verdicts[i].get("module_id", "?")
                id2 = verdicts[j].get("module_id", "?")
                conflicts.append((id1, id2))
    return conflicts


# ============================================================
# v2.0.0 Stage 5: Consensus scoring (67% threshold)
# 凡人話: 拎 67% threshold (4/6 個 module 同意) 拎 weighted state consensus
# 對齊 plan v2 §F 5 stock 對齊表 60% hit rate evidence + Spec Sync #62 recommendation
# ============================================================

# 凡人話: consensus 達成 threshold (≥ 4/6 = 67% 拎 state 一致, 對齊 plan v2 §F)
CONSENSUS_THRESHOLD: float = 0.67


def _compute_consensus(verdicts: List[Dict[str, Any]]) -> Dict[str, Any]:
    """v2.0.0 Stage 5: Weighted consensus scoring — 拎 67% threshold 拎 majority state

    凡人話: 拎 6 個 module 嘅 state 用 base_weight 拎加權, 拎 majority state 拎 ≥ 67% 拎共識。
            consensus 達成 → 用 consensus_state 拎 final state; 唔達成 → fall back 落 simple majority

    Returns:
        dict: {
            consensus_state: str,        # 多數 state (UP / DOWN / SIDEWAYS)
            consensus_score: float,     # weighted 共識比例 (0-1)
            simple_majority_state: str,  # 簡單多數 state (fallback)
            consensus_achieved: bool,    # 拎 ≥ 67% threshold 拎共識
            state_breakdown: dict,       # {state: weight_sum, ...} 詳細
        }
    """
    if not verdicts:
        return {
            "consensus_state": "SIDEWAYS",
            "consensus_score": 0.0,
            "simple_majority_state": "SIDEWAYS",
            "consensus_achieved": False,
            "state_breakdown": {},
        }

    # weighted state 拎 base_weight 拎 weighted count
    state_breakdown: Dict[str, float] = {}
    simple_count: Dict[str, int] = {}
    for v in verdicts:
        state = v.get("state", "SIDEWAYS")
        w = v.get("base_weight", 0)
        state_breakdown[state] = state_breakdown.get(state, 0.0) + w
        simple_count[state] = simple_count.get(state, 0) + 1

    total_weight = sum(state_breakdown.values()) or 1.0
    consensus_state = max(state_breakdown.items(), key=lambda x: x[1])[0]
    consensus_score = state_breakdown[consensus_state] / total_weight
    simple_majority_state = max(simple_count.items(), key=lambda x: x[1])[0]

    return {
        "consensus_state": consensus_state,
        "consensus_score": round(consensus_score, 4),
        "simple_majority_state": simple_majority_state,
        "consensus_achieved": consensus_score >= CONSENSUS_THRESHOLD,
        "state_breakdown": {k: round(v, 4) for k, v in state_breakdown.items()},
    }


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

def _compute_kelly(verdicts: List[Dict[str, Any]], final_state: str = "SIDEWAYS") -> Dict[str, Any]:
    """Kelly fraction — 跟 6 個 modules 嘅 avg max_drawdown_estimate 自動切
    - avg DD < 0.05: half (0.5)   — 波動低
    - 0.05 ≤ avg DD < 0.10: quarter (0.25)  — 波動中
    - avg DD ≥ 0.10: octo (0.125) — 波動高

    v2.0.2 (大少 2026-09-12 Spec Sync #63, 凡人話 trigger "Kelly 應該 0"): state guard
    - state=DOWN 或 SIDEWAYS → Kelly = 0 (zero, 唔開新倉)
    - 對齊 spec doc §7 Cycle State 判定: Grade D/F → SELL action (唔開倉)
    - 對齊凡人話: 跌訊號 / 觀望 verdict 唔應該開新倉
    - frontend 拎 kelly_state_guard_triggered 3 個 audit field 顯示原因

    凡人話: 大少 9月12日 06:31 trigger 揭發 M7 Kelly 計算完全冇睇 state,
    跌 verdict 都畀 quarter 倉係 spec bug, 改 state guard 對齊 spec doc §7 spirit。
    """
    # v2.0.2 state guard: DOWN / SIDEWAYS → 0 倉 (對齊 spec doc §7 Grade D/F SELL action)
    if final_state in ("DOWN", "SIDEWAYS"):
        return {
            "fraction": "zero",
            "numeric": 0.0,
            "position": 0.0,
            "state_guard_triggered": True,
            "state_guard_reason": f"state={final_state} (DOWN/SIDEWAYS) → 0 倉, 對齊 spec doc §7 Grade D/F SELL action, 唔開新倉",
        }

    if not verdicts:
        return {
            "fraction": "quarter",
            "numeric": 0.25,
            "position": 0.25,
            "state_guard_triggered": False,
            "state_guard_reason": "fallback (no verdicts)",
        }

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

    return {
        "fraction": fraction,
        "numeric": numeric,
        "position": numeric,
        "state_guard_triggered": False,
        "state_guard_reason": f"state=UP, avg DD {avg_dd:.4f} → {fraction} 倉",
    }


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
    version = "2.0.1"

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

        # ============ v2.0.0 Stage 3: Weight discount generalization (大少 2026-09-10 23:06 永久 rule) ============
        # 凡人話: 拎任何 module 嘅 self-check warning (FALLBACK_USED / CONFLICT_STATE /
        #         THRESHOLD_BREACH / VERDICT_MISSING) 自動降 base_weight 落 0.05,
        #         其他 5 個 module 等比例 normalize 補返, sum 仍 = 1.0
        # 對齊永久 rule: §M2 self-check weight 折扣 (Spec Sync v0.3.0) generalize 至 M1/M3/M4/M5/M6
        # 對齊永久 rule: §M3/§M4/§M5/§M6 self-check warning emit
        # 對齊永久 rule: §Module Warning v1.1.0 info level (DATA_AGE) 唔觸發 discount
        verdicts_for_synth, weight_discounts = _apply_weight_discounts(verdicts)

        # ============ v0.3.0 backward compat: 保留 m2_discounted / m2_original_weight / m2_discounted_weight ============
        # 對齊永久 rule §M2 self-check weight 折扣: meta 永遠 emit M2 嘅 discount 狀態 (frontend 拎嚟 audit / banner)
        m2_discount = next(
            (d for d in weight_discounts if d["module_id"] == "hl-structure"),
            {"triggered": False, "original_weight": None, "discounted_weight": None},
        )
        m2_self_check_triggered = m2_discount["triggered"]

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

        # ============ v2.0.0 Stage 4: Conflict detection (大少 2026-09-10 23:06 永久 rule) ============
        # 凡人話: 拎 UP↔DOWN 直接矛盾 pairs, 凡人話: M1 升 + M2 跌 互相打架 → emit warning
        conflict_pairs = _detect_conflicts(verdicts_for_synth)

        # ============ v2.0.0 Stage 5: Consensus scoring (大少 2026-09-10 23:06 永久 rule) ============
        # 凡人話: 拎 67% threshold (4/6 個 module 同意) 拎 weighted state 共識
        #         共識達成 → 用 consensus_state; 唔達成 → fall back 落 simple_majority_state
        consensus = _compute_consensus(verdicts_for_synth)

        # ============ v2.0.0 Stage 7: State derivation (大少 2026-09-10 23:06 永久 rule) ============
        # 凡人話: 共識先重要, 共識唔到先睇簡單多數
        final_state = (
            consensus["consensus_state"]
            if consensus["consensus_achieved"]
            else consensus["simple_majority_state"]
        )
        majority_state = final_state  # backward compat alias

        # Step 5: Kelly (v2.0.2 大少 9月12日 trigger, 加 final_state 入 signature)
        # 凡人話: state=DOWN/SIDEWAYS → Kelly=0, 對齊 spec doc §7 Grade D/F SELL action
        kelly = _compute_kelly(verdicts_for_synth, final_state)

        # v2.0.1 永久 rule: Cycle label 跟 state 而唔係 grade (大少 11/9 確認)
        # 對齊 §M7 Synthesizer spirit: 副校長嘅 label 應該跟老師嘅 state 寫, 唔再睇 grade
        # 凡人話: state=DOWN → 綜合看跌, state=UP → 綜合看升, state=SIDEWAYS → 綜合觀望
        # 避免 state=DOWN 但 label=綜合觀望 嘅矛盾
        cycle_label = (
            "綜合看升" if majority_state == "UP"
            else "綜合看跌" if majority_state == "DOWN"
            else "綜合觀望"
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
            # v2.0.0 (大少 2026-09-10 23:06): generalize 至所有 module 嘅 weight discount 詳情
            "weight_discounts": weight_discounts,
            # v2.0.0 (大少 2026-09-10 23:06): Stage 4 conflict detection
            "conflict_pairs": [list(p) for p in conflict_pairs],
            "conflict_count": len(conflict_pairs),
            # v2.0.0 (大少 2026-09-10 23:06): Stage 5 consensus scoring
            "consensus_state": consensus["consensus_state"],
            "consensus_score": consensus["consensus_score"],
            "simple_majority_state": consensus["simple_majority_state"],
            "consensus_achieved": consensus["consensus_achieved"],
            "state_breakdown": consensus["state_breakdown"],
            "zigzag_alignment_reasons": zigzag_alignment_reasons,
            "grade": grade,
            "grade_score": grade_score,
            "grade_reason": grade_reason,
            "kelly_fraction": kelly["fraction"],
            "kelly_numeric": kelly["numeric"],
            "kelly_position": kelly["position"],
            # v2.0.2 (大少 2026-09-12 Spec Sync #63): Kelly state guard audit field
            # 凡人話: 大少 trigger 揭發 Kelly 算法完全冇睇 state, 加 3 個 audit field 顯示點解 Kelly=0
            "kelly_state_guard_triggered": kelly.get("state_guard_triggered", False),
            "kelly_state_guard_reason": kelly.get("state_guard_reason", "fallback"),
            # v2.0.1 永久 rule: module_verdicts emit normalized weight (對齊 backend 計嘅 discount + normalize)
            # 凡人話: frontend 拎到嘅 base_weight 對齊 backend 計嘅, 避免 raw/discounted 不一致
            "module_verdicts": [
                {**v, "base_weight": nv.get("base_weight", v.get("base_weight"))}
                for v, nv in zip(verdicts, verdicts_for_synth)
            ],
            "module_summary": module_summary,
            "reason": interpretation,
            "dataDays": len(verdicts),
        }

        # Step 6: Aggregate upstream warnings (永久 rule v1.1.0 propagation chain)
        aggregated_warnings = _aggregate_warnings(verdicts, nan_fields=nan_fields)

        # ============ v2.0.0 Stage 3 warning 通知 (大少 2026-09-10 23:06 generalize) ============
        # 凡人話: 拎任何 module 嘅 self-check warning 觸發咗, M7 自動降 weight 之後,
        #         每個 trigger 嘅 module 同步 emit 1 個 stock_state MODULE_PARTIAL warning
        #         通知 banner (沿用 15 個 code, 唔加新 code 對齊永久 rule §Module Warning v1.1.0)
        for d in weight_discounts:
            if d["triggered"]:
                aggregated_warnings.append(make_warning(
                    level="warning",
                    module_id="M7",
                    code="MODULE_PARTIAL",
                    message=f"{d['module_id']} self-check 觸發, 自動降 weight {d['original_weight']} → {d['discounted_weight']}",
                    issue=f"{d['module_id']} 嘅 self-check warning 觸發 (codes: {', '.join(d['trigger_codes'])}), M7 自動將 {d['module_id']} base_weight 由 {d['original_weight']} 折扣到 {d['discounted_weight']}",
                    impact=f"{d['module_id']} vote 保留但 weight 大減, 其他 5 個 module 等比例 normalize 補返, sum 仍 = 1.0",
                    fix=f"睇 banner 提示 {d['module_id']} 觸發咗邊個 self-check, Re-run / 確認 K 線數據",
                    context={
                        "module_id": d["module_id"],
                        "original_weight": d["original_weight"],
                        "discounted_weight": d["discounted_weight"],
                        "trigger_codes": d["trigger_codes"],
                        "discount_reason": f"{d['module_id']} self-check warning detected",
                    },
                ).to_dict())

        # ============ v2.0.0 Stage 4 warning 通知 (大少 2026-09-10 23:06 conflict detection) ============
        # 凡人話: 拎 UP↔DOWN 直接矛盾 pairs, 每對 emit 1 個 system CONFLICT_STATE warning
        #         通知 banner, 對齊 §Module Warning v1.1.0 (system category, verdict 可能唔可信)
        for id1, id2 in conflict_pairs:
            aggregated_warnings.append(make_warning(
                level="warning",
                module_id="M7",
                code="CONFLICT_STATE",
                message=f"{id1} ↔ {id2} state 矛盾 (UP↔DOWN)",
                issue=f"{id1} 同 {id2} 嘅 state 直接相反, 對綜合判定有疑問, 大少睇到即知 verdict 內部有矛盾",
                impact="Verdict 唔可信, 唔好落單",
                fix="睇 6 個 module verdict card 確認邊個 module 比較合理, Re-run / 確認 K 線數據",
                context={
                    "module_a": id1,
                    "module_b": id2,
                    "conflict_reason": "UP↔DOWN direct opposite state",
                },
            ).to_dict())

        # ============ v2.0.0 Stage 5 warning 通知 (大少 2026-09-10 23:06 consensus scoring) ============
        # 凡人話: 拎 weighted consensus 達成, 同步 emit 1 個 stock_state CONFLICT_STATE
        #         通知 banner (對齊 plan v2 §F 67% threshold spirit)
        #         凡人話: 「6 個 module 入面, 4 個以上同意 {state}, 綜合判定跟呢個 state」
        if consensus["consensus_achieved"]:
            aggregated_warnings.append(make_warning(
                level="info",
                module_id="M7",
                code="CONFLICT_STATE",
                message=f"Consensus 達成: {consensus['consensus_state']} (score {consensus['consensus_score']:.2f} ≥ {CONSENSUS_THRESHOLD})",
                issue=f"6 個 module 入面 ≥ {int(CONSENSUS_THRESHOLD * 100)}% 同意 {consensus['consensus_state']}, weighted consensus 達成",
                impact="Verdict 已經準確, 留意股票狀態",
                fix="睇其他 module 確認 / 留意 M7 alignment",
                context={
                    "consensus_state": consensus["consensus_state"],
                    "consensus_score": consensus["consensus_score"],
                    "state_breakdown": consensus["state_breakdown"],
                    "consensus_threshold": CONSENSUS_THRESHOLD,
                },
            ).to_dict())

        return Verdict(ok=True, points=[], meta=meta, warnings=aggregated_warnings)


# Register
register(SynthesizerAlgorithm())

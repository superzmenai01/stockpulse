"""
backend/algorithms/synthesizer/algorithm.py — M7 Synthesizer v1.0.0 (大少 2026-08-20 21:30 Phase 8)

凡人話: 拎 6 個 module 嘅 standard verdict → 計 SSI (戰略強度) + TCM (戰術交叉驗證) + Alignment + Grade (8 個評級 A+~F) + Kelly 倉位 → SynthesizerVerdict

對應 source: algorithms/AS-03-cycle-detection/modules/synthesizer.ts v1.0.0 (319 行, Plan A 拆返 M7 + M8)
對應 spec doc: docs/research/AS-03-cycle-detection/MODULE-07-SYNTHESIZER.md
對應 framework: backend/algorithms/base.py Verdict contract

Algorithm: 5 sub-step (跟 synthesizer.ts 嘅 synthesize() 1:1 port 去 Python)
- Step 1: SSI 戰略強度指數 (consistency × 50 + confidence_avg × 30 + rules_coverage × 20)
- Step 2: TCM 戰術交叉驗證矩陣 (3 對 pair: ma-trendline / hl-volume / indicators-volatility, alignment -1/0/+1 + trap_penalty 0.6/0.2/0)
- Step 3: Alignment Score 戰略戰術匹配度 (max_group_size / total_count)
- Step 4: Grade 評級 (ssi_score × 0.6 + alignment × 100 × 0.4, 8 個 grade: A+/A/B+/B/C+/C/D/F)
- Step 5: Kelly 倉位分數 (跟 avg max_drawdown_estimate 自動切 half/quarter/octo)

Caller inject pattern (Phase 8 permanent rule):
- 跑 synthesizer 之後, algorithm_runner 自動跑 M1-M6 拎 verdict
- 將每個 verdict 轉做 standard verdict (state / confidence / base_weight / max_drawdown_estimate / rules_fired)
- 6 個 standard verdict 放落 options['moduleVerdicts']
- Synthesizer 拎 options['moduleVerdicts'] 計 synth verdict

凡人話: Synthesizer 唔拎 K 線, 拎 6 個 module verdict 拎綜合判定, 等於 1 個 senior 同事睇晒 6 個 junior 同事嘅分析再拎最終意見
"""

from typing import List, Dict, Any, Optional, Tuple

from ..base import Algorithm, Verdict
from ..registry import register
from .config import DEFAULT_SYNTHESIZER_CONFIG


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
    - (indicators, volatility)  — 情緒 + 波動 confirm
    每對:
    - alignment: -1 (矛盾), 0 (部分), +1 (一致)
    - trap_penalty: alignment=-1 → 0.6, alignment=0 → 0.2, alignment=+1 → 0
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
    """Alignment Score (0-1): 6 個 module state 一致程度
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
# Main algorithm (跟 synthesizer.ts Synthesizer 1:1 port)
# ============================================================

class SynthesizerAlgorithm(Algorithm):
    """M7 Synthesizer (SSI + TCM + Alignment + Grade + Kelly) — 大少 2026-08-20 Phase 8 backend port

    Algorithm ABC contract:
    - name: "synthesizer"
    - version: "1.0.0"
    - run(klines, options) → Verdict
    - options.moduleVerdicts: List[Dict] (6 個 module standard verdict, 由 runner inject)

    凡人話: 拎 6 個 module 嘅 verdict 拎綜合判定, 拎 SSI/TCM/Alignment/Grade/Kelly
    """

    name = "synthesizer"
    version = "1.0.0"

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.cfg = {**DEFAULT_SYNTHESIZER_CONFIG, **(config or {})}

    def run(self, klines: List[Dict[str, Any]], options: Optional[Dict[str, Any]] = None) -> Verdict:
        options = options or {}
        timeframe = options.get("period", "1d")
        symbol = options.get("symbol", "TEST")

        # M7 Synthesizer 拎 options.moduleVerdicts (由 algorithm_runner inject)
        verdicts: List[Dict[str, Any]] = options.get("moduleVerdicts", [])

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
                warnings=["INSUFFICIENT_DATA: 0 module verdicts"],
            )

        # Step 1: SSI
        ssi_score, ssi_breakdown = _compute_ssi(verdicts)

        # Step 2: TCM
        tcm_matrix = _compute_tcm(verdicts)

        # Step 3: Alignment
        alignment_score = _compute_alignment(verdicts)

        # Step 4: Grade
        grade, grade_score, grade_reason = _compute_grade(ssi_score, alignment_score)

        # Step 5: Kelly
        kelly = _compute_kelly(verdicts)

        # Cycle state derivation (跟 majority state)
        state_count: Dict[str, int] = {}
        for v in verdicts:
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

        # Module summary (每個 module 拎 state + confidence)
        module_summary = [
            {
                "module_id": v.get("module_id"),
                "state": v.get("state"),
                "confidence": v.get("confidence"),
                "base_weight": v.get("base_weight"),
                "rules_fired_count": len(v.get("rules_fired", [])),
            }
            for v in verdicts
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

        return Verdict(ok=True, points=[], meta=meta, warnings=[])


# Register
register(SynthesizerAlgorithm())

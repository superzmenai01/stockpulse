// modules/decision-engine.ts — AS-03 · M7 Synthesizer + M8 Decision Engine (Stage 1)
//
// 大少 2026-08-08 12:30 — Sprint 1 sub-task 1.2 落地
//
// 大少 2026-08-08 11:22 指示: M7 Synthesizer + M8 Decision Engine 合併做 1 個 mega module
//   (testing page 1 個 entry, spec 拆 2 份 reference, codebase 1 個 file)
//
// Sprint 1 (Stage 1) 範圍: M7 Synthesizer 邏輯 (SSI + TCM + Alignment + Grade + Kelly)
//   Sprint 2 (Stage 2) 範圍: M8 Decision Engine 邏輯 (decision tree + trading card + 5 adaptive params + L2 cache)
//
// File 雖然叫 decision-engine.ts, 但而家只 export M7 部分 (Synthesizer)
//   Sprint 2 會加 M8 邏輯 (finalAction 8 個 + trading card + adaptive params)
//
// Spec doc: docs/research/AS-03-cycle-detection/MODULE-07-08-DECISION-ENGINE.md §M7 Synthesizer

import type {
  CycleModuleId, CycleState, Grade, KellyFraction,
  ModuleStandardVerdict, SSIBreakdown, SynthesizerVerdict, TCMPairResult,
} from '../types.ts';

// =============================================================
// Helper functions
// =============================================================

/** 判斷 2 個 state 係咪 opposite
 *  UP ↔ DOWN → opposite
 *  其他 (e.g. SIDEWAYS + UP) → 唔算 opposite
 */
function isOppositeState(s1: CycleState, s2: CycleState): boolean {
  return (s1 === 'UP' && s2 === 'DOWN') || (s1 === 'DOWN' && s2 === 'UP');
}

// =============================================================
// Step 1: SSI 戰略強度指數 (0-100)
// =============================================================

/** SSI 計算
 *  consistency: 6 個 modules 嘅 state 最大 group 嘅比例
 *  confidence_avg: 6 個 confidence 加權平均 (用 base_weight)
 *  rules_coverage: 6 個 rules_fired union 嘅覆蓋率 (max 20 unique rules, normalize 0-1)
 *  ssi_score: consistency × 50 + confidence_avg × 30 + rules_coverage × 20 (0-100)
 */
function computeSSI(verdicts: ModuleStandardVerdict[]): { ssi_score: number; breakdown: SSIBreakdown } {
  // consistency
  const stateCount: Record<string, number> = {};
  for (const v of verdicts) {
    stateCount[v.state] = (stateCount[v.state] ?? 0) + 1;
  }
  const maxCount = Math.max(...Object.values(stateCount), 0);
  const consistency = verdicts.length > 0 ? maxCount / verdicts.length : 0;

  // confidence_avg (加權)
  const totalWeight = verdicts.reduce((acc, v) => acc + v.base_weight, 0);
  const confidence_avg = totalWeight > 0
    ? verdicts.reduce((acc, v) => acc + v.confidence * v.base_weight, 0) / totalWeight
    : 0;

  // rules_coverage
  const allRules = new Set<string>();
  for (const v of verdicts) {
    for (const r of v.rules_fired) allRules.add(r);
  }
  const MAX_UNIQUE_RULES = 20;
  const rules_coverage = Math.min(1, allRules.size / MAX_UNIQUE_RULES);

  // ssi_score (0-100)
  const ssi_score = consistency * 50 + confidence_avg * 30 + rules_coverage * 20;

  return {
    ssi_score: Math.round(ssi_score * 10) / 10,
    breakdown: {
      consistency: Math.round(consistency * 1000) / 1000,
      confidence_avg: Math.round(confidence_avg * 1000) / 1000,
      rules_coverage: Math.round(rules_coverage * 1000) / 1000,
    },
  };
}

// =============================================================
// Step 2: TCM 戰術交叉驗證矩陣 (3 對 pair)
// =============================================================

/** TCM 計算
 *  3 對 pair:
 *    (ma-alignment, trendline) — 形態 + 趨勢線 confirm
 *    (hl-structure, volume)    — 形態 + 量能 confirm
 *    (indicators, volatility)  — 情緒 + 波動 confirm
 *  每對:
 *    alignment: -1 (矛盾), 0 (部分), +1 (一致)
 *    trap_penalty: alignment=-1 → 0.6, alignment=0 → 0.2, alignment=+1 → 0
 */
function computeTCM(verdicts: ModuleStandardVerdict[]): TCMPairResult[] {
  const map = new Map(verdicts.map(v => [v.module_id, v]));
  const pairs: [CycleModuleId, CycleModuleId][] = [
    ['ma-alignment', 'trendline'],
    ['hl-structure', 'volume'],
    ['indicators', 'volatility'],
  ];

  return pairs.map(([id1, id2]) => {
    const v1 = map.get(id1);
    const v2 = map.get(id2);
    if (!v1 || !v2) {
      return { pair: [id1, id2], alignment: 0, trap_penalty: 0 };
    }

    // alignment
    let alignment: number;
    if (v1.state === v2.state) {
      alignment = 1.0;
    } else if (isOppositeState(v1.state, v2.state)) {
      alignment = -1.0;
    } else {
      alignment = 0;
    }

    // trap_penalty — alignment 派生
    // 矛盾 = 0.6 (虛漲), 部分 = 0.2 (唔肯定), 一致 = 0
    let trap_penalty: number;
    if (alignment === -1) trap_penalty = 0.6;
    else if (alignment === 0) trap_penalty = 0.2;
    else trap_penalty = 0;

    return { pair: [id1, id2], alignment, trap_penalty };
  });
}

// =============================================================
// Step 3: Alignment Score (0-1)
// =============================================================

/** Alignment Score — 6 個 module state 一致程度
 *  alignment_score = max_group_size / total_count
 *  全部一致 = 1.0, 5/6 一致 = 0.833, 一半 = 0.5
 */
function computeAlignment(verdicts: ModuleStandardVerdict[]): number {
  if (verdicts.length === 0) return 0;
  const stateCount: Record<string, number> = {};
  for (const v of verdicts) {
    stateCount[v.state] = (stateCount[v.state] ?? 0) + 1;
  }
  const maxCount = Math.max(...Object.values(stateCount));
  return Math.round((maxCount / verdicts.length) * 1000) / 1000;
}

// =============================================================
// Step 4: Grade 評級 (8 個: A+~F)
// =============================================================

/** Grade 計算
 *  grade_score = ssi_score × 0.6 + alignment_score × 100 × 0.4
 *  Map 到 8 個 grade:
 *    90-100: A+
 *    80-89:  A
 *    70-79:  B+
 *    60-69:  B
 *    50-59:  C+
 *    40-49:  C
 *    30-39:  D
 *    0-29:   F
 */
function computeGrade(ssi_score: number, alignment_score: number): {
  grade: Grade;
  grade_score: number;
  reason: string;
} {
  const grade_score = Math.round((ssi_score * 0.6 + alignment_score * 100 * 0.4) * 10) / 10;

  let grade: Grade;
  if (grade_score >= 90) grade = 'A+';
  else if (grade_score >= 80) grade = 'A';
  else if (grade_score >= 70) grade = 'B+';
  else if (grade_score >= 60) grade = 'B';
  else if (grade_score >= 50) grade = 'C+';
  else if (grade_score >= 40) grade = 'C';
  else if (grade_score >= 30) grade = 'D';
  else grade = 'F';

  const reason = `分數 ${grade_score} (SSI ${ssi_score} × 60% + Alignment ${(alignment_score * 100).toFixed(1)} × 40%) → ${grade}`;

  return { grade, grade_score, reason };
}

// =============================================================
// Step 5: Kelly 倉位分數
// =============================================================

/** Kelly fraction — 跟 6 個 modules 嘅 avg max_drawdown_estimate 自動切
 *  - avg DD < 0.05: half (0.5)   — 波動低
 *  - 0.05 ≤ avg DD < 0.10: quarter (0.25)  — 波動中
 *  - avg DD ≥ 0.10: octo (0.125) — 波動高
 *
 *  Note: 而家 static (跟 spec default), Sprint 2 M8 會加 adaptive params auto-calibrate
 */
function computeKelly(verdicts: ModuleStandardVerdict[]): {
  fraction: KellyFraction;
  numeric: number;
  position: number;
} {
  if (verdicts.length === 0) {
    return { fraction: 'quarter', numeric: 0.25, position: 0.25 };
  }
  const avgDD = verdicts.reduce((acc, v) => acc + v.max_drawdown_estimate, 0) / verdicts.length;

  let fraction: KellyFraction;
  let numeric: number;
  if (avgDD < 0.05) {
    fraction = 'half';
    numeric = 0.5;
  } else if (avgDD < 0.10) {
    fraction = 'quarter';
    numeric = 0.25;
  } else {
    fraction = 'octo';
    numeric = 0.125;
  }

  return { fraction, numeric, position: numeric };
}

// =============================================================
// DecisionEngine class — M7 Synthesizer 邏輯
// =============================================================

export interface SynthesizeInput {
  moduleVerdicts: ModuleStandardVerdict[];  // 6 個 modules 嘅 standard verdict
}

/** M7 Synthesizer — 6 個 ModuleStandardVerdict → SynthesizerVerdict
 *
 *  5 個 sub-step:
 *    1. SSI 戰略強度指數 (consistency + confidence_avg + rules_coverage)
 *    2. TCM 戰術交叉驗證矩陣 (3 對 pair × alignment + trap_penalty)
 *    3. Alignment Score 戰略戰術匹配度
 *    4. Grade 評級 (A+~F, 8 個)
 *    5. Kelly 倉位分數 (half/quarter/octo, 跟 avg DD 自動切)
 */
export class DecisionEngine {
  /** 跑 Synthesizer — 一次過 return SynthesizerVerdict */
  async synthesize(input: SynthesizeInput): Promise<SynthesizerVerdict> {
    const verdicts = input.moduleVerdicts;

    // 空 input 處理
    if (verdicts.length === 0) {
      return {
        ssi_score: 0,
        ssi_breakdown: { consistency: 0, confidence_avg: 0, rules_coverage: 0 },
        tcm_matrix: [],
        alignment_score: 0,
        grade: 'F',
        grade_score: 0,
        grade_reason: '無 module verdicts (empty input)',
        kelly_fraction: 'quarter',
        kelly_numeric: 0.25,
        kelly_position: 0.25,
        module_verdicts: [],
        timestamp: Date.now(),
      };
    }

    // Step 1: SSI
    const { ssi_score, breakdown } = computeSSI(verdicts);

    // Step 2: TCM
    const tcm_matrix = computeTCM(verdicts);

    // Step 3: Alignment
    const alignment_score = computeAlignment(verdicts);

    // Step 4: Grade
    const { grade, grade_score, reason } = computeGrade(ssi_score, alignment_score);

    // Step 5: Kelly
    const { fraction, numeric, position } = computeKelly(verdicts);

    return {
      ssi_score,
      ssi_breakdown: breakdown,
      tcm_matrix,
      alignment_score,
      grade,
      grade_score,
      grade_reason: reason,
      kelly_fraction: fraction,
      kelly_numeric: numeric,
      kelly_position: position,
      module_verdicts: verdicts,
      timestamp: Date.now(),
    };
  }
}

export default DecisionEngine;

// =============================================================
// Convenience function — 6 個 modules wrapper 一次過跑
// =============================================================

/** 一次過跑 6 個 modules + DecisionEngine
 *  @example
 *    const result = await synthesizeAll({
 *      klines, ctx,
 *      modules: {
 *        ma: () => toStandardVerdictMA(klines, ctx),
 *        hl: () => toStandardVerdictHL(klines, ctx),
 *        ...
 *      },
 *    });
 */
export async function synthesizeAll(
  moduleVerdicts: ModuleStandardVerdict[],
): Promise<SynthesizerVerdict> {
  const engine = new DecisionEngine();
  return engine.synthesize({ moduleVerdicts });
}

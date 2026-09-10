// modules/synthesizer.ts — AS-03 · M7 Synthesizer
//
// 大少 2026-08-08 13:30 — Plan A 拆返 M7 + M8 兩個獨立 module
//   之前 sprint 1 合併做 1 個 mega module (decision-engine.ts), 大少澄清係設計上
//   一起考慮但 implementation 應該分開, 而家拆返 2 個:
//     - modules/synthesizer.ts (本 file, M7)  — 6 個 modules → SynthesizerVerdict
//     - modules/decision-engine.ts (M8 stub)  — Sprint 2 chain M7 output → DecisionVerdict
//
//   M7 chain: Promise.all([6 個 modules]) → standard verdict → SSI + TCM + Alignment + Grade + Kelly
//   M8 chain: M7 output + adaptive params → finalAction + trading card + forecast
//
//   Plan A refactor: 之前 decision-engine.ts 嘅 5 個 sub-step logic (M7 部分) 搬去本 file,
//     decision-engine.ts 變 stub (Sprint 2 寫)
//
// v2.0.0 (大少 2026-09-10 23:06 Spec Sync #62) — 8-stage architecture
//   Stage 1: Input handling (拎 6 個 module verdict)
//   Stage 2: Signal normalization (M4 8 signal → 3-state) — 喺 backend 計, frontend 拎
//   Stage 3: Weight discount generalization — 加 _applyWeightDiscounts helper
//   Stage 4: Conflict detection — 加 _detectConflicts helper
//   Stage 5: Consensus scoring (67% threshold) — 加 _computeConsensus helper
//   Stage 6: Kelly + risk — 沿用 v1.0 computeKelly
//   Stage 7: State derivation — 共識先重要, 共識唔到先睇簡單多數
//   Stage 8: Verdict assembly — 加 8 個新 field
//
// Spec doc: docs/research/AS-03-cycle-detection/MODULE-07-SYNTHESIZER.md
// 對應 spec: docs/research/AS-03-cycle-detection/MODULE-07-08-DECISION-ENGINE.md §M7 Synthesizer (之前合併 spec, 拆返後保留 M7 部分)

import type {
  ConsensusResult, ConflictPair, CycleModuleId, CycleState, Grade, KellyFraction,
  ModuleStandardVerdict, SSIBreakdown, SynthesizerVerdict, TCMPairResult,
  WeightDiscount,
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

// ============================================================
// v2.0.0 Stage 3: Weight discount generalization (大少 2026-09-10 23:06)
// 凡人話: 拎任何 module 嘅 self-check warning 自動降 base_weight 落 0.05
//         其他 5 個 module 等比例 normalize 補返, sum 仍 = 1.0
// 對齊 backend algorithm.py 嘅 _apply_weight_discounts helper
// 對齊永久 rule: §M2 self-check weight 折扣 (Spec Sync v0.3.0) generalize 至 M1/M3/M4/M5/M6
// ============================================================

/** v2.0.0 SELF_CHECK_TRIGGER_CODES (對齊 backend algorithm.py)
 *  邊啲 warning code 觸發 self-check weight discount
 *  對齊 §M2 self-check penalty 永久 rule 4 個 critical + warning code
 *  (FALLBACK_USED / CONFLICT_STATE / THRESHOLD_BREACH / VERDICT_MISSING)
 *  拎走 info level (DATA_AGE) 對齊 §Module Warning v1.1.0 spirit
 */
const SELF_CHECK_TRIGGER_CODES: ReadonlySet<string> = new Set([
  'FALLBACK_USED',
  'CONFLICT_STATE',
  'THRESHOLD_BREACH',
  'VERDICT_MISSING',
]);

/** v2.0.0 SELF_CHECK_DISCOUNT_TARGET_WEIGHT (對齊 backend algorithm.py)
 *  self-check 觸發後, 拎 module 嘅 base_weight 折到 0.05 (對齊 M2 永久 rule spirit)
 */
const SELF_CHECK_DISCOUNT_TARGET_WEIGHT = 0.05;

/** v2.0.0 BASE_WEIGHTS_BY_MODULE (對齊 backend algorithm.py MODULE_BASE_WEIGHTS)
 *  各 module 嘅 default base_weight (對齊 algorithm_runner.py line 277-282)
 */
const BASE_WEIGHTS_BY_MODULE: Record<CycleModuleId, number> = {
  'ma-alignment': 0.25,
  'hl-structure': 0.15,
  'trendline': 0.10,
  'indicators': 0.10,
  'volume': 0.10,
  'volatility': 0.10,
};

/** 拎 warning 嘅 code (對齊 ModuleWarning object 或 dict) */
function extractWarningCode(w: unknown): string | undefined {
  if (typeof w === 'object' && w !== null) {
    const wObj = w as Record<string, unknown>;
    if (typeof wObj.code === 'string') return wObj.code;
  }
  return undefined;
}

/** 拎 v2.0.0 (Stage 3) — 拎每個 module 嘅 self-check weight discount 詳情
 *  對齊 backend algorithm.py 嘅 _apply_weight_discounts helper
 *  Returns: { verdicts: 已套用 discount 嘅 verdict list, discount_meta: WeightDiscount[] }
 */
function applyWeightDiscounts(
  verdicts: ModuleStandardVerdict[],
): { verdicts: ModuleStandardVerdict[]; discountMeta: WeightDiscount[] } {
  const verdictsCopy: ModuleStandardVerdict[] = verdicts.map((v) => ({ ...v }));
  const discountMeta: WeightDiscount[] = [];

  for (const v of verdictsCopy) {
    const moduleId = v.module_id;
    const defaultW = BASE_WEIGHTS_BY_MODULE[moduleId] ?? v.base_weight;
    const warnings = (v.module_specific as Record<string, unknown> | undefined)?.warnings as unknown[] | undefined
      ?? (v as unknown as { warnings?: unknown[] }).warnings
      ?? [];
    const triggerCodes: string[] = [];
    for (const w of warnings) {
      const code = extractWarningCode(w);
      if (code && SELF_CHECK_TRIGGER_CODES.has(code) && !triggerCodes.includes(code)) {
        triggerCodes.push(code);
      }
    }
    const triggered = triggerCodes.length > 0;
    discountMeta.push({
      module_id: moduleId,
      triggered,
      original_weight: defaultW,
      discounted_weight: triggered ? SELF_CHECK_DISCOUNT_TARGET_WEIGHT : defaultW,
      trigger_codes: triggerCodes,
    });
  }

  const triggeredIds = new Set(discountMeta.filter((d) => d.triggered).map((d) => d.module_id));

  if (triggeredIds.size > 0) {
    // 拎觸發 module 嘅 discount 落 base_weight = 0.05
    for (const v of verdictsCopy) {
      if (triggeredIds.has(v.module_id)) {
        v.base_weight = SELF_CHECK_DISCOUNT_TARGET_WEIGHT;
      }
    }
    // 拎其他 module 等比例 normalize 補返 (sum = 1.0)
    const otherTotal = verdictsCopy
      .filter((v) => !triggeredIds.has(v.module_id))
      .reduce((acc, v) => acc + v.base_weight, 0);
    if (otherTotal > 0) {
      const targetOtherTotal = 1.0 - SELF_CHECK_DISCOUNT_TARGET_WEIGHT * triggeredIds.size;
      const factor = targetOtherTotal / otherTotal;
      for (const v of verdictsCopy) {
        if (!triggeredIds.has(v.module_id)) {
          v.base_weight = Math.round(v.base_weight * factor * 10000) / 10000;
        }
      }
    }
  }

  return { verdicts: verdictsCopy, discountMeta };
}

// ============================================================
// v2.0.0 Stage 4: Conflict detection (大少 2026-09-10 23:06)
// 凡人話: 拎 UP↔DOWN 直接矛盾 pairs
// 對齊 backend algorithm.py 嘅 _detect_conflicts helper
// ============================================================

/** 拎 v2.0.0 (Stage 4) — 拎 UP↔DOWN 直接矛盾 pairs
 *  凡人話: M1 升 + M2 跌 互相打架 → emit CONFLICT_STATE warning
 *  對齊 backend algorithm.py 嘅 _detect_conflicts helper
 */
function detectConflicts(verdicts: ModuleStandardVerdict[]): ConflictPair[] {
  const conflicts: ConflictPair[] = [];
  for (let i = 0; i < verdicts.length; i++) {
    for (let j = i + 1; j < verdicts.length; j++) {
      const s1 = verdicts[i].state;
      const s2 = verdicts[j].state;
      if (isOppositeState(s1, s2)) {
        conflicts.push([verdicts[i].module_id, verdicts[j].module_id]);
      }
    }
  }
  return conflicts;
}

// ============================================================
// v2.0.0 Stage 5: Consensus scoring (大少 2026-09-10 23:06)
// 凡人話: 拎 67% threshold (4/6 個 module 同意) 拎 weighted state 共識
// 對齊 backend algorithm.py 嘅 _compute_consensus helper + plan v2 §F
// ============================================================

/** v2.0.0 CONSENSUS_THRESHOLD (對齊 backend algorithm.py)
 *  consensus 達成 threshold (≥ 4/6 = 67% 拎 state 一致, 對齊 plan v2 §F)
 */
const CONSENSUS_THRESHOLD = 0.67;

/** 拎 v2.0.0 (Stage 5) — 拎 67% threshold weighted state consensus
 *  凡人話: 拎 6 個 module 嘅 state 用 base_weight 拎加權, 拎 majority state 拎 ≥ 67% 拎共識
 *  對齊 backend algorithm.py 嘅 _compute_consensus helper
 */
function computeConsensus(verdicts: ModuleStandardVerdict[]): ConsensusResult {
  if (verdicts.length === 0) {
    return {
      consensus_state: 'SIDEWAYS',
      consensus_score: 0,
      simple_majority_state: 'SIDEWAYS',
      consensus_achieved: false,
      state_breakdown: {},
    };
  }

  const stateBreakdown: Record<string, number> = {};
  const simpleCount: Record<string, number> = {};
  for (const v of verdicts) {
    const state = v.state;
    const w = v.base_weight;
    stateBreakdown[state] = (stateBreakdown[state] ?? 0) + w;
    simpleCount[state] = (simpleCount[state] ?? 0) + 1;
  }

  const totalWeight = Object.values(stateBreakdown).reduce((a, b) => a + b, 0) || 1;
  const sortedByWeight = Object.entries(stateBreakdown).sort((a, b) => b[1] - a[1]);
  const consensusState = (sortedByWeight[0]?.[0] ?? 'SIDEWAYS') as CycleState;
  const consensusScore = (stateBreakdown[consensusState] ?? 0) / totalWeight;
  const sortedByCount = Object.entries(simpleCount).sort((a, b) => b[1] - a[1]);
  const simpleMajorityState = (sortedByCount[0]?.[0] ?? 'SIDEWAYS') as CycleState;

  return {
    consensus_state: consensusState,
    consensus_score: Math.round(consensusScore * 10000) / 10000,
    simple_majority_state: simpleMajorityState,
    consensus_achieved: consensusScore >= CONSENSUS_THRESHOLD,
    state_breakdown: Object.fromEntries(
      Object.entries(stateBreakdown).map(([k, v]) => [k, Math.round(v * 10000) / 10000]),
    ),
  };
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
 *  Note: 而家 static (跟 spec default), Sprint 2 M8 將加 adaptive params auto-calibrate
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
// Synthesizer class — M7 主邏輯
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
 *
 *  M8 Decision Engine 將來食 SynthesizerVerdict 推導 finalAction + trading card + forecast
 */
export class Synthesizer {
  /** 跑 Synthesizer — 一次過 return SynthesizerVerdict
   *  v2.0.0 (大少 2026-09-10 23:06 Spec Sync #62, 8-stage architecture)
   *  Stage 1: Input handling
   *  Stage 2: Signal normalization (backend 計, frontend 拎已 override 嘅 verdict)
   *  Stage 3: Weight discount generalization
   *  Stage 4: Conflict detection
   *  Stage 5: Consensus scoring (67% threshold)
   *  Stage 6: Kelly + risk
   *  Stage 7: State derivation (共識先重要, 共識唔到先睇簡單多數)
   *  Stage 8: Verdict assembly (8 個新 field)
   */
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
        // v2.0.0 Stage 3-5 default empty
        weight_discounts: [],
        conflict_pairs: [],
        conflict_count: 0,
        consensus_state: 'SIDEWAYS',
        consensus_score: 0,
        consensus_achieved: false,
        simple_majority_state: 'SIDEWAYS',
        state_breakdown: {},
        final_state: 'SIDEWAYS',
        module_verdicts: [],
        timestamp: Date.now(),
      };
    }

    // Stage 3: Weight discount generalization (對齊 backend algorithm.py _apply_weight_discounts)
    const { verdicts: verdictsWithDiscount, discountMeta } = applyWeightDiscounts(verdicts);

    // Step 1: SSI (用 verdictsWithDiscount 反映 weight discount 效果)
    const { ssi_score, breakdown } = computeSSI(verdictsWithDiscount);

    // Step 2: TCM
    const tcm_matrix = computeTCM(verdictsWithDiscount);

    // Step 3: Alignment
    const alignment_score = computeAlignment(verdictsWithDiscount);

    // Stage 4: Conflict detection (對齊 backend algorithm.py _detect_conflicts)
    const conflictPairs = detectConflicts(verdictsWithDiscount);

    // Stage 5: Consensus scoring (對齊 backend algorithm.py _compute_consensus)
    const consensus = computeConsensus(verdictsWithDiscount);

    // Stage 7: State derivation — 共識先重要, 共識唔到先睇簡單多數
    const finalState: CycleState = consensus.consensus_achieved
      ? consensus.consensus_state
      : consensus.simple_majority_state;

    // Step 4: Grade
    const { grade, grade_score, reason } = computeGrade(ssi_score, alignment_score);

    // Stage 6: Kelly + risk
    const { fraction, numeric, position } = computeKelly(verdictsWithDiscount);

    // Stage 8: Verdict assembly (對齊 backend algorithm.py verdict.meta 嘅 v2.0.0 output)
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
      // v2.0.0 Stage 3-7 output
      weight_discounts: discountMeta,
      conflict_pairs: conflictPairs,
      conflict_count: conflictPairs.length,
      consensus_state: consensus.consensus_state,
      consensus_score: consensus.consensus_score,
      consensus_achieved: consensus.consensus_achieved,
      simple_majority_state: consensus.simple_majority_state,
      state_breakdown: consensus.state_breakdown,
      final_state: finalState,
      module_verdicts: verdicts,
      timestamp: Date.now(),
    };
  }
}

export default Synthesizer;

// =============================================================
// Convenience function — 6 個 modules wrapper 一次過跑
// =============================================================

/** 一次過跑 6 個 modules + Synthesizer
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
  const syn = new Synthesizer();
  return syn.synthesize({ moduleVerdicts });
}

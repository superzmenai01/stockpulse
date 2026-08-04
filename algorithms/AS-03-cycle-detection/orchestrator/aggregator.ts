// orchestrator/aggregator.ts — AS-03 · 點 7 conflict resolution (placeholder)
//
// ⏳ D004 (2026-08-04): 詳細做法最後先傾 — 大少未決定策略
//
// 3 個候選:
//   1. htf-override:  HTF confidence > threshold 就壓倒 LTF
//   2. weighted-vote: 每個 module 有 weight，weighted sum
//   3. expert-rules: rule-based (e.g.「MA + HL 一致 UP 就大膽講 UP」)
//
// 當前 placeholder: simple majority vote (no weight, no HTF override)

import type { CycleVerdict } from '../types';

export interface AggregatorInput {
  htf?: CycleVerdict;
  moduleVerdicts: CycleVerdict[];
}

export interface AggregatorResult {
  state: CycleVerdict['state'];
  confidence: number;
  reason: string;
  breakdown: Record<string, number>;
}

export class Aggregator {
  /**
   * Aggregate multiple verdicts into one
   *
   * @returns AggregatorResult with final state + confidence + reason
   */
  async aggregate(input: AggregatorInput): Promise<AggregatorResult> {
    const states: CycleVerdict['state'][] = [
      ...(input.htf ? [input.htf.state] : []),
      ...input.moduleVerdicts.map(v => v.state),
    ];

    const counts: Record<string, number> = {};
    states.forEach(s => { counts[s] = (counts[s] ?? 0) + 1; });

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const top = sorted[0];
    const state = (top?.[0] ?? 'TRANSITION') as CycleVerdict['state'];
    const confidence = states.length > 0 ? (top?.[1] ?? 0) / states.length : 0;

    return {
      state,
      confidence,
      reason: 'Majority vote placeholder — 待大少 confirm aggregator 策略 (htf-override / weighted-vote / expert-rules)',
      breakdown: counts,
    };
  }
}

export default Aggregator;
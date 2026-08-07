// orchestrator/aggregator.ts — AS-03 · 點 7 conflict resolution
//
// 大少 #10809 (2026-08-06) — D004 default strategy:
//   - 採用 expert-rules strategy (D004 pending 嘅 default 選擇)
//   - 因為同 v0.3.0 ma-alignment rule-based pattern 一致 — 全部都 transparent + 可審計
//   - weighted-vote 對 rule-based verdict 嚟講唔自然 (rule 已經表達 weighted priority)
//
// 3 個候選策略 (D004):
//   1. htf-override:  HTF confidence > threshold 就壓倒 LTF
//   2. weighted-vote: 每個 module 有 weight (config.ts tunable)
//   3. expert-rules: rule-based — ma-alignment 主 verdict, optional modules 為 confirm/disconfirm (大少 #10809 default)
//
// Expert-rules combine 邏輯 (D020):
//   Step 1 — 取 ma-alignment verdict 做 base state (mandatory)
//   Step 2 — VolumePrice signal 調整 confidence:
//             CONFIRM    → +10% (強化)
//             DISCONFIRM → -30% (削弱)；如果 vol confidence 高 → 考慮改 TRANSITION
//             NEUTRAL    → 唔影響
//   Step 3 — 大少 2026-08-07 23:15 SlopeMomentum 暫時隱藏,Stage 1 done 最後先做返
//   Step 4 — 其他 enabled peer modules (hl-structure / trendline / indicators) 暫時 skip (未實作)
//
// Handle null verdict:
//   - moduleVerdicts 可以有 null entry (將來 optional module 唔跑時)
//   - filter null 先做 combine

import type { CycleVerdict, SignalType } from '../types.ts';

export type AggregatorStrategy = 'majority-vote' | 'htf-override' | 'weighted-vote' | 'expert-rules';

export interface AggregatorInput {
  htf?: CycleVerdict;
  moduleVerdicts: (CycleVerdict | null)[];  // null = 該 module 冇跑/未實作
}

export interface AggregatorResult {
  state: CycleVerdict['state'];
  confidence: number;
  reason: string;
  breakdown: Record<string, number>;
  strategy: AggregatorStrategy;
}

export class Aggregator {
  private readonly strategy: AggregatorStrategy;

  constructor(strategy: AggregatorStrategy = 'expert-rules') {
    this.strategy = strategy;
  }

  /**
   * Aggregate multiple verdicts into one
   *
   * @returns AggregatorResult with final state + confidence + reason
   */
  async aggregate(input: AggregatorInput): Promise<AggregatorResult> {
    switch (this.strategy) {
      case 'expert-rules':
        return this.expertRulesAggregate(input);
      case 'majority-vote':
      case 'weighted-vote':
      case 'htf-override':
      default:
        return this.majorityVoteAggregate(input);
    }
  }

  /**
   * Expert-rules aggregate (大少 #10809 default):
   *   ma-alignment = base
   *   volume signal = CONFIRM/DISCONFIRM/NEUTRAL 調整 confidence
   *   大少 2026-08-07 23:15 — slope-momentum 暫時隱藏,Stage 1 done 最後先做返
   */
  private expertRulesAggregate(input: AggregatorInput): AggregatorResult {
    const reasons: string[] = [];
    const breakdown: Record<string, number> = {};

    // 過濾 null verdicts (D019 — handle null gracefully)
    const validVerdicts = input.moduleVerdicts.filter(
      (v): v is CycleVerdict => v !== null && v !== undefined,
    );

    // 記低每個 verdict 嘅 state 進 breakdown (for transparency)
    for (const v of validVerdicts) {
      breakdown[`${v.moduleId}:${v.state}`] = v.confidence;
    }
    if (input.htf) {
      breakdown[`htf:${input.htf.state}`] = input.htf.confidence;
    }

    // 取 ma-alignment (mandatory) — 永遠 enabled
    const ma = validVerdicts.find(v => v.moduleId === 'ma-alignment');
    if (!ma) {
      // ma-alignment 唔在 → fallback
      return {
        state: 'TRANSITION',
        confidence: 0,
        reason: 'Expert-rules: ma-alignment verdict missing (should never happen — ma-alignment is mandatory)',
        breakdown,
        strategy: 'expert-rules',
      };
    }

    let finalState: CycleVerdict['state'] = ma.state;
    let finalConfidence = ma.confidence;
    reasons.push(`Base ma-alignment: ${ma.state} (${(ma.confidence * 100).toFixed(1)}%)`);

    // === Step 2: VolumePrice signal 調整 ===
    const volume = validVerdicts.find(v => v.moduleId === 'volume');
    if (volume) {
      const signal = volume.meta?.signal as SignalType | undefined;
      if (signal === 'CONFIRM') {
        finalConfidence = Math.min(1.0, finalConfidence * 1.10);
        reasons.push(`Volume CONFIRM (+10%)`);
      } else if (signal === 'DISCONFIRM') {
        finalConfidence = Math.max(0, finalConfidence * 0.70);
        reasons.push(`Volume DISCONFIRM (-30%)`);
        if (volume.confidence > 0.7) {
          // Volume 強烈反對 → 考慮 TRANSITION
          if (finalState !== 'TRANSITION') {
            reasons.push(`Volume strong DISCONFIRM → TRANSITION`);
            finalState = 'TRANSITION';
          }
        }
      } else {
        reasons.push(`Volume NEUTRAL (no change)`);
      }
    }

    // === Step 3: 大少 2026-08-07 23:15 SlopeMomentum verdict 處理暫時隱藏 ===
    //   等 Stage 1 全部 done 最後先做返,將來由 git history 拎返呢段 block

    // === Step 4: HTF verdict override ===
    if (input.htf && input.htf.confidence > 0.8) {
      if (input.htf.state !== finalState) {
        reasons.push(`HTF override (high conf ${(input.htf.confidence * 100).toFixed(0)}%): ${input.htf.state} vs ${finalState}`);
        finalState = input.htf.state;
      } else {
        reasons.push(`HTF agrees: ${finalState}`);
      }
    }

    finalConfidence = Math.round(finalConfidence * 10000) / 10000;

    return {
      state: finalState,
      confidence: finalConfidence,
      reason: reasons.join('；'),
      breakdown,
      strategy: 'expert-rules',
    };
  }

  /**
   * Majority vote (placeholder fallback for non-expert-rules strategies)
   */
  private majorityVoteAggregate(input: AggregatorInput): AggregatorResult {
    const states: CycleVerdict['state'][] = [
      ...(input.htf ? [input.htf.state] : []),
      ...input.moduleVerdicts
        .filter((v): v is CycleVerdict => v !== null && v !== undefined)
        .map(v => v.state),
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
      reason: `${this.strategy} placeholder — ${state} (${top?.[1] ?? 0}/${states.length})`,
      breakdown: counts,
      strategy: this.strategy,
    };
  }
}

export default Aggregator;
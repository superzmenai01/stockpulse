// orchestrator/synthesize.ts — AS-03 · 點 7: 綜合判定
//
// 大少 #10809 (2026-08-06) — 採用 expert-rules strategy (D004 default)
// aggregator.ts 係 single source of truth for combine logic
// synthesize.ts 負責 CycleVerdict format + interpretation
//
// D019 — Handle null verdict gracefully:
//   - moduleVerdicts 可以有 null entry (將來 optional module 唔跑時)
//   - aggregator 已經 filter null

import type { CycleVerdict } from '../types.ts';
import { Aggregator, type AggregatorStrategy } from './aggregator.ts';

export interface SynthesizeInput {
  htf?: CycleVerdict;
  moduleVerdicts: (CycleVerdict | null)[];  // null = 該 module 冇跑/未實作 (D019)
  strategy?: AggregatorStrategy;
}

export class Synthesizer {
  private readonly aggregator: Aggregator;

  constructor(aggregator?: Aggregator) {
    // 大少 #10809 — expert-rules 為 default (D004 pending strategy)
    this.aggregator = aggregator ?? new Aggregator('expert-rules');
  }

  async synthesize(input: SynthesizeInput): Promise<CycleVerdict> {
    const aggregator = input.strategy
      ? new Aggregator(input.strategy)
      : this.aggregator;

    const result = await aggregator.aggregate({
      htf: input.htf,
      moduleVerdicts: input.moduleVerdicts,
    });

    // 計算 enabled peer module verdicts (exclude null)
    const enabledVerdicts = input.moduleVerdicts.filter(
      (v): v is CycleVerdict => v !== null && v !== undefined,
    );

    // 列出 enabled module 嘅 state 摘要
    const moduleSummary = enabledVerdicts
      .map(v => `${v.moduleId}=${v.state}`)
      .join(', ') || 'none';

    return {
      moduleId: 'synthesized',
      timeframe: input.htf?.timeframe ?? enabledVerdicts[0]?.timeframe ?? '1d',
      state: result.state,
      confidence: result.confidence,
      interpretation: `[Synthesized · ${result.strategy}] ${result.reason}。最終: ${result.state} (信心 ${(result.confidence * 100).toFixed(1)}%)。Enabled: ${moduleSummary}`,
      evidence: [],
      warnings: enabledVerdicts.length < 1
        ? ['無 enabled module verdict (ma-alignment 必須 enabled)']
        : [],
      meta: {
        htf: input.htf?.state,
        breakdown: result.breakdown,
        strategy: result.strategy,
        aggregatorReason: result.reason,
        enabledModules: enabledVerdicts.map(v => v.moduleId),
        moduleSummary,
      },
      timestamp: Date.now(),
    };
  }
}

export default Synthesizer;
// orchestrator/synthesize.ts — AS-03 · 點 7: 綜合判定
//
// ⏳ D004 (2026-08-04): aggregator 策略最後先傾 — 大少未決定
//
//   3 個候選:
//     1. htf-override: HTF 壓倒性優先，LTF 只做微調
//     2. weighted-vote: 每個 module 有 weight (config.ts tunable)
//     3. expert-rules: rule-based (e.g.「MA + HL 一致就大膽」)
//
// 當前實作: 內部 call Aggregator 做 majority vote，再 wrap 做 CycleVerdict
//           aggregator.ts 係 single source of truth for vote logic
//           synthesize.ts 負責 CycleVerdict format + interpretation

import type { CycleVerdict } from '../types.ts';
import { Aggregator } from './aggregator.ts';

export interface SynthesizeInput {
  htf?: CycleVerdict;
  moduleVerdicts: CycleVerdict[];
}

export class Synthesizer {
  private readonly aggregator: Aggregator;

  constructor(aggregator?: Aggregator) {
    this.aggregator = aggregator ?? new Aggregator();
  }

  async synthesize(input: SynthesizeInput): Promise<CycleVerdict> {
    const result = await this.aggregator.aggregate({
      htf: input.htf,
      moduleVerdicts: input.moduleVerdicts,
    });

    const totalVerdicts = (input.htf ? 1 : 0) + input.moduleVerdicts.length;
    const dominantCount = result.breakdown[result.state] ?? 0;

    return {
      moduleId: 'synthesized',
      timeframe: input.htf?.timeframe ?? input.moduleVerdicts[0]?.timeframe ?? '1d',
      state: result.state,
      confidence: result.confidence,
      interpretation: `[Synthesized placeholder] ${result.reason}。結果: ${result.state} (${dominantCount}/${totalVerdicts} 票)。待大少 confirm aggregator 策略。`,
      evidence: [],
      warnings: [
        '此為 placeholder verdict，aggregator 策略待大少確認',
        `HTF state: ${input.htf?.state ?? 'N/A'}`,
        `Breakdown: ${JSON.stringify(result.breakdown)}`,
      ],
      meta: {
        htf: input.htf?.state,
        breakdown: result.breakdown,
        aggregatorReason: result.reason,
      },
      timestamp: Date.now(),
    };
  }
}

export default Synthesizer;
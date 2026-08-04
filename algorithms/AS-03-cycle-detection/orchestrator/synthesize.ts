// orchestrator/synthesize.ts — AS-03 · 點 7: 綜合判定 (placeholder)
//
// ⏳ D004 (2026-08-04): 詳細做法最後先傾 — 大少未決定 aggregator 策略
//
// 3 個候選:
//   1. htf-override: HTF 壓倒性優先，LTF 只做微調
//   2. weighted-vote: 每個 module 有 weight (config.ts tunable)
//   3. expert-rules: rule-based (e.g.「MA + HL 一致就大膽」)
//
// 當前 placeholder: simple majority vote

import type { CycleVerdict } from '../types';

export interface SynthesizeInput {
  htf?: CycleVerdict;
  moduleVerdicts: CycleVerdict[];
}

export class Synthesizer {
  async synthesize(input: SynthesizeInput): Promise<CycleVerdict> {
    // TODO: 等大少 confirm aggregator 策略
    const states: CycleVerdict['state'][] = [
      ...(input.htf ? [input.htf.state] : []),
      ...input.moduleVerdicts.map(v => v.state),
    ];

    const counts: Record<string, number> = {};
    states.forEach(s => { counts[s] = (counts[s] ?? 0) + 1; });

    const dominantEntry = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const dominantState = (dominantEntry?.[0] ?? 'TRANSITION') as CycleVerdict['state'];
    const dominantCount = dominantEntry?.[1] ?? 0;
    const confidence = states.length > 0 ? dominantCount / states.length : 0;

    return {
      moduleId: 'synthesized',
      timeframe: input.htf?.timeframe ?? input.moduleVerdicts[0]?.timeframe ?? '1d',
      state: dominantState,
      confidence,
      interpretation: `[Synthesized placeholder] 多數決結果: ${dominantState} (${dominantCount}/${states.length} 票)。待大少 confirm aggregator 策略。`,
      evidence: [],
      warnings: [
        '此為 placeholder verdict，aggregator 策略待大少確認',
        `HTF state: ${input.htf?.state ?? 'N/A'}`,
        `Module states: ${JSON.stringify(counts)}`,
      ],
      meta: { htf: input.htf?.state, ltfCounts: counts },
      timestamp: Date.now(),
    };
  }
}

export default Synthesizer;
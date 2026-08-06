// orchestrator/multi-tf.ts — AS-03 · 點 6: 時間框架統一性 (HTF 約束 LTF)
//
// 文檔: 均線系統週期判斷法算法.docx
// 規則: 大周期決定小周期 — 週線/月線先確認大方向，日線再確認位置
//
// ⚠️ D001 (2026-08-04): 架構上係 orchestrator step 0，唔係 peer module
// 因為 hierarchy constraint 同其他 5 個判斷方法唔同 level
//
// ⏳ 暫定用 MA Alignment 做 HTF proxy — 大少可以指定用其他 module

import type { CycleContext, CycleVerdict, KLine } from '../types.ts';
import { MAAlignmentModule } from '../modules/ma-alignment.ts';

export class MultiTFOrchestrator {
  private readonly htfProxy: MAAlignmentModule;

  constructor() {
    this.htfProxy = new MAAlignmentModule();
  }

  /**
   * 跑 HTF analysis — 喺 LTF peer modules 之前做
   *
   * @param htfKlines 較高時間框架嘅 K-lines (e.g. weekly)
   * @param ctx execution context
   * @returns HTF verdict (CycleState + confidence)
   */
  async run(htfKlines: KLine[], ctx: CycleContext): Promise<CycleVerdict> {
    const htfTf = ctx.htf ?? '1w';
    const htfVerdict = await this.htfProxy.detect(htfKlines, {
      ...ctx,
      ltf: htfTf,
    });

    return {
      ...htfVerdict,
      moduleId: 'htf-multi-tf',
      interpretation: `[HTF ${htfTf}] ${htfVerdict.interpretation}`,
      meta: {
        ...htfVerdict.meta,
        htfTimeframe: htfTf,
        proxyModule: 'ma-alignment',
      },
    };
  }
}

export default MultiTFOrchestrator;
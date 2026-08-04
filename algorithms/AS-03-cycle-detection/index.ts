// index.ts — AS-03 股票周期判定 · 主入口
//
// ⏳ 階段: skeleton (v0.1.0) — 等大少逐個 module 提供詳細做法

import type {
  CycleContext, CycleModuleId, CycleReport, CycleState, CycleVerdict, KLine,
} from './types.ts';

import { MAAlignmentModule } from './modules/ma-alignment.ts';
import { HLStructureModule } from './modules/hl-structure.ts';
import { TrendlineModule } from './modules/trendline.ts';
import { IndicatorsModule } from './modules/indicators.ts';
import { VolumeModule } from './modules/volume.ts';

import { MultiTFOrchestrator } from './orchestrator/multi-tf.ts';
import { Synthesizer } from './orchestrator/synthesize.ts';
import { RegimeChangeAlerter } from './orchestrator/alert.ts';
import { Aggregator } from './orchestrator/aggregator.ts';

export interface AnalyzeOptions {
  symbol: string;
  ltfKlines: KLine[];
  htfKlines?: KLine[];
  ltf?: CycleContext['ltf'];
  htf?: CycleContext['htf'];
  previousState?: CycleState;       // 用作 regime change 對比
  modules?: CycleModuleId[];        // 指定跑邊啲 modules (預設全部 5)
}

export const VERSION = '0.1.0-skeleton';

/**
 * CycleDetector — AS-03 嘅主 entry point
 *
 * 用法:
 *   - 單 module: detector.runModule('ma-alignment', klines, ctx)
 *   - 全分析:    detector.analyze({ symbol, ltfKlines, htfKlines, previousState })
 */
export class CycleDetector {
  private readonly modules: Record<CycleModuleId, {
    id: CycleModuleId; version: string; detect: (k: KLine[], c: CycleContext) => Promise<CycleVerdict>;
  }>;
  private readonly multiTF: MultiTFOrchestrator;
  private readonly synthesizer: Synthesizer;
  private readonly alerter: RegimeChangeAlerter;
  private readonly aggregator: Aggregator;

  constructor() {
    this.modules = {
      'ma-alignment': new MAAlignmentModule(),
      'hl-structure': new HLStructureModule(),
      'trendline': new TrendlineModule(),
      'indicators': new IndicatorsModule(),
      'volume': new VolumeModule(),
    };
    this.multiTF = new MultiTFOrchestrator();
    this.synthesizer = new Synthesizer();
    this.alerter = new RegimeChangeAlerter();
    this.aggregator = new Aggregator();
  }

  /**
   * 直接攞 aggregator (D004: 將來用嚟 tune synthesis strategy)
   */
  getAggregator(): Aggregator {
    return this.aggregator;
  }

  /**
   * 跑單個 module — Module 1-5 任何一個可獨立調用
   */
  async runModule(
    moduleId: CycleModuleId,
    klines: KLine[],
    ctx: CycleContext,
  ): Promise<CycleVerdict> {
    return this.modules[moduleId].detect(klines, ctx);
  }

  /**
   * 跑全部 5 個 peer modules + HTF + synthesize + alert
   *
   * 流程:
   *   Step 0: HTF analysis (Module 6 — orchestrator step 0)
   *   Step 1-5: LTF peer modules (Module 1-5)
   *   Step 6: Synthesize (Module 7)
   *   Step 7: Regime change alert (if state changed)
   */
  async analyze(opts: AnalyzeOptions): Promise<CycleReport> {
    const ltf = opts.ltf ?? '1d';
    const htf = opts.htf ?? '1w';
    const ctx: CycleContext = { symbol: opts.symbol, ltf, htf };

    const targetModules = opts.modules ?? (Object.keys(this.modules) as CycleModuleId[]);

    // Step 0: HTF analysis (Module 6)
    let htfVerdict: CycleVerdict | undefined;
    if (opts.htfKlines && opts.htfKlines.length > 0) {
      htfVerdict = await this.multiTF.run(opts.htfKlines, ctx);
    }

    // Step 1-5: LTF peer modules
    const moduleVerdicts: CycleVerdict[] = [];
    for (const m of targetModules) {
      const verdict = await this.runModule(m, opts.ltfKlines, ctx);
      moduleVerdicts.push(verdict);
    }

    // Step 6: Synthesize
    const synthesized = await this.synthesizer.synthesize({
      htf: htfVerdict,
      moduleVerdicts,
    });

    // Step 7: Regime change alert (only if state changed)
    const alerts = [];
    if (htfVerdict && opts.previousState && htfVerdict.state !== opts.previousState) {
      const alert = this.alerter.detect({
        symbol: opts.symbol,
        timeframe: htf,
        current: htfVerdict.state,
        previous: opts.previousState,
        confidence: htfVerdict.confidence,
        supportingModules: ['htf-multi-tf'],
      });
      if (alert) alerts.push(alert);
    }

    return {
      symbol: opts.symbol,
      ltf,
      htf: htfVerdict ? { timeframe: htf, verdict: htfVerdict } : undefined,
      moduleVerdicts,
      alerts,
      synthesized,
      timestamp: Date.now(),
    };
  }
}

// Re-exports
export * from './types.ts';
export * from './config.ts';

export { MAAlignmentModule } from './modules/ma-alignment.ts';
export { HLStructureModule } from './modules/hl-structure.ts';
export { TrendlineModule } from './modules/trendline.ts';
export { IndicatorsModule } from './modules/indicators.ts';
export { VolumeModule } from './modules/volume.ts';

export { MultiTFOrchestrator } from './orchestrator/multi-tf.ts';
export { Synthesizer } from './orchestrator/synthesize.ts';
export { RegimeChangeAlerter } from './orchestrator/alert.ts';
export { Aggregator } from './orchestrator/aggregator.ts';
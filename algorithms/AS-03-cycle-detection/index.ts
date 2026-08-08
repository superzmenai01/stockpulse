// index.ts — AS-03 股票周期性判定 (umbrella) · 主入口
//
// 大少 #10809 (2026-08-06) — v1.0.0
//   - 加 Module 5 VolumePrice (replaces skeleton VolumeModule)
//   - 加 Module 8 SlopeMomentum (新獨立 peer module) — 大少 2026-08-07 23:15 隱藏
//   - 採用 option toggle design (D019): MA core mandatory + 5 個 optional toggle
//   - Synthesizer default = expert-rules (D004 pending 嘅 default 選擇)
//   - Handle enableFlags + null verdict gracefully

import type {
  CycleContext, CycleModuleId, CycleReport, CycleState, CycleVerdict, KLine,
} from './types.ts';

import { ZmenMAAlignmentModule } from './modules/zmen-ma-alignment.ts';  // 大少 2026-08-08 09:13: 舊 M1 改名 zmen均算法 (獨立算法, 唔屬 7 個 modules)
import { MAAlignmentV2Module } from './modules/ma-alignment.ts';  // 大少 2026-08-08 12:00: Sprint 1 — M1 v2.0 應該係 7 個 modules 嘅 M1, 而 zmen均算法 係獨立
import { HLStructureModule } from './modules/hl-structure.ts';
import { TrendlineModule } from './modules/trendline.ts';
import { IndicatorsModule } from './modules/indicators.ts';
import { VolumePrice } from './modules/volume.ts';
import { VolatilityModule } from './modules/volatility.ts';  // 大少 2026-08-08 12:00: Sprint 1 — M6 應該加入 CycleDetector
// 大少 2026-08-07 23:15 — SlopeMomentum 暫時隱藏,Stage 1 done 最後先做返
// import { SlopeMomentum } from './modules/slope-momentum.ts';

import { MultiTFOrchestrator } from './orchestrator/multi-tf.ts';
import { Synthesizer } from './orchestrator/synthesize.ts';
import { RegimeChangeAlerter } from './orchestrator/alert.ts';
import { Aggregator } from './orchestrator/aggregator.ts';
import { DEFAULT_ENABLE_FLAGS, type EnableFlags } from './config.ts';

export interface AnalyzeOptions {
  symbol: string;
  ltfKlines: KLine[];
  htfKlines?: KLine[];
  ltf?: CycleContext['ltf'];
  htf?: CycleContext['htf'];
  previousState?: CycleState;             // 用作 regime change 對比
  modules?: CycleModuleId[];              // 指定跑邊啲 modules (預設全部 enabled)
  enableFlags?: Partial<EnableFlags>;     // D019 — friendly key toggle design
}

/**
 * 將 user-friendly EnableFlags 轉成 Record<CycleModuleId, boolean>
 * 對應: maAlignment → ma-alignment, volumePrice → volume, 等
 * 大少 2026-08-08 12:00: Sprint 1 — 加 'volatility' 映射
 */
function enableFlagsToRecord(flags: EnableFlags): Record<CycleModuleId, boolean> {
  return {
    'ma-alignment': flags.maAlignment,
    'volume': flags.volumePrice,
    // 大少 2026-08-07 23:15 — slope-momentum 暫時隱藏,Stage 1 done 最後先做返
    'hl-structure': flags.hlStructure,
    'trendline': flags.trendline,
    'indicators': flags.indicators,
    'volatility': flags.volatility,
  };
}

export const VERSION = '1.0.0';

/**
 * CycleDetector — AS-03 嘅主 entry point
 *
 * 用法:
 *   - 單 module: detector.runModule('ma-alignment', klines, ctx)
 *   - 全分析:    detector.analyze({ symbol, ltfKlines, htfKlines, previousState, enableFlags })
 *
 * 大少 #10809 — D019 option toggle design:
 *   - maAlignment = core mandatory (always on)
 *   - 其他 4 個 module 跟 enableFlags 決定 (預設: VolumePrice ON)
 *   - 大少 2026-08-07 23:15 — SlopeMomentum 暫時隱藏,Stage 1 done 最後先做返
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
      'ma-alignment': new MAAlignmentV2Module(),  // 大少 2026-08-08 12:00: Sprint 1 — M1 = MAAlignmentV2Module (新 v2.0), 而 ZmenMAAlignmentModule 係 zmen均算法 (獨立算法, 唔屬 7 個 modules)
      'hl-structure': new HLStructureModule(),
      'trendline': new TrendlineModule(),
      'indicators': new IndicatorsModule(),
      'volume': new VolumePrice(),
      'volatility': new VolatilityModule(),  // 大少 2026-08-08 12:00: Sprint 1 — M6 加入 CycleDetector
      // 大少 2026-08-07 23:15 — slope-momentum 暫時隱藏,Stage 1 done 最後先做返
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
   * 跑單個 module — Module 1-6 任何一個可獨立調用
   */
  async runModule(
    moduleId: CycleModuleId,
    klines: KLine[],
    ctx: CycleContext,
  ): Promise<CycleVerdict> {
    const mod = this.modules[moduleId];
    if (!mod) {
      throw new Error(`[CycleDetector] Unknown module: ${moduleId}`);
    }
    return mod.detect(klines, ctx);
  }

  /**
   * 跑全部 enabled peer modules + HTF + synthesize + alert
   *
   * 流程:
   *   Step 0: HTF analysis (Module 6 — orchestrator step 0)
   *   Step 1-6: LTF peer modules (Module 1-6 — enabled 嘅先跑)
   *   Step 7: Synthesize (Module 7 — expert-rules combine)
   *   Step 8: Regime change alert (if state changed)
   *
   * Enable flags filter (D019):
   *   - maAlignment = core, 永遠跑 (enableFlags 寫 false 都照跑)
   *   - 其他 module: enableFlags[id] === false 嘅 skip
   *   - enableFlags 唔包 = 預設 enabled (跟 DEFAULT_ENABLE_FLAGS)
   */
  async analyze(opts: AnalyzeOptions): Promise<CycleReport> {
    const ltf = opts.ltf ?? '1d';
    const htf = opts.htf ?? '1w';

    // D019 — merge enableFlags: caller 嘅 override 蓋過 default
    const friendlyFlags: EnableFlags = {
      ...DEFAULT_ENABLE_FLAGS,
      ...(opts.enableFlags ?? {}),
    };
    // maAlignment 永遠 enabled (核心強制)
    friendlyFlags.maAlignment = true;

    const moduleFlags = enableFlagsToRecord(friendlyFlags);

    const ctx: CycleContext = {
      symbol: opts.symbol,
      ltf,
      htf,
      enableFlags: moduleFlags,
    };

    // 計算要跑嘅 modules: ma-alignment + 跟 enableFlags
    const allModuleIds = Object.keys(this.modules) as CycleModuleId[];
    const targetModules = opts.modules
      ? opts.modules.filter(m => m === 'ma-alignment' || moduleFlags[m] !== false)
      : allModuleIds.filter(m => m === 'ma-alignment' || moduleFlags[m] !== false);

    // Step 0: HTF analysis (Module 6)
    let htfVerdict: CycleVerdict | undefined;
    if (opts.htfKlines && opts.htfKlines.length > 0) {
      htfVerdict = await this.multiTF.run(opts.htfKlines, ctx);
    }

    // Step 1-6: LTF peer modules
    const moduleVerdicts: CycleVerdict[] = [];
    for (const m of targetModules) {
      const verdict = await this.runModule(m, opts.ltfKlines, ctx);
      moduleVerdicts.push(verdict);
    }

    // Step 7: Synthesize (expert-rules)
    const synthesized = await this.synthesizer.synthesize({
      htf: htfVerdict,
      moduleVerdicts,
    });

    // Step 8: Regime change alert (only if state changed)
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

  /**
   * 攞已 enable 嘅 modules list (D019 — UI 用)
   */
  getEnabledModules(enableFlags?: Partial<EnableFlags>): CycleModuleId[] {
    const friendlyFlags: EnableFlags = {
      ...DEFAULT_ENABLE_FLAGS,
      ...(enableFlags ?? {}),
    };
    friendlyFlags.maAlignment = true;
    const moduleFlags = enableFlagsToRecord(friendlyFlags);
    return (Object.keys(this.modules) as CycleModuleId[]).filter(
      m => m === 'ma-alignment' || moduleFlags[m] !== false,
    );
  }
}

// Re-exports
export * from './types.ts';
export * from './config.ts';
// 大少 2026-08-08 12:00 — Sprint 1 sub-task 1.1 — re-export std-verdict helpers
export {
  toStandardVerdict, runAndStandardize,
  computeSentiment6D, computeExpectedReturn, computeMaxDrawdownEstimate,
  type ToStandardVerdictInput, type RunAndStandardizeOptions,
} from './std-verdict.ts';

export { ZmenMAAlignmentModule } from './modules/zmen-ma-alignment.ts';  // 大少 2026-08-08 09:13: 舊 M1 改名 zmen均算法
export { MAAlignmentV2Module, toStandardVerdictMA } from './modules/ma-alignment.ts';
export { HLStructureModule, toStandardVerdictHL } from './modules/hl-structure.ts';
export { TrendlineModule, toStandardVerdictTL } from './modules/trendline.ts';
export { IndicatorsModule, toStandardVerdictIND } from './modules/indicators.ts';
export { VolumePrice, toStandardVerdictVP } from './modules/volume.ts';
export { VolatilityModule, toStandardVerdictVOL } from './modules/volatility.ts';
// 大少 2026-08-08 12:30 — Sprint 1 sub-task 1.2 — M7 Synthesizer
export { DecisionEngine, synthesizeAll, type SynthesizeInput } from './modules/decision-engine.ts';
// 大少 2026-08-07 23:15 — SlopeMomentum 暫時隱藏,Stage 1 done 最後先做返
// export { SlopeMomentum } from './modules/slope-momentum.ts';

export { MultiTFOrchestrator } from './orchestrator/multi-tf.ts';
export { Synthesizer } from './orchestrator/synthesize.ts';
export { RegimeChangeAlerter } from './orchestrator/alert.ts';
export { Aggregator } from './orchestrator/aggregator.ts';
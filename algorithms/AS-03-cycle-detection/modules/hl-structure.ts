// modules/hl-structure.ts — AS-03 · 點 2: 高低點結構法 (Dow Theory)
//
// 文檔: 股票周期判定算法.docx
// 規則:
//   - 上升: 一浪高過一浪 — 每個 HH 比前一個高，每個 HL 也比前一個高
//   - 下跌: 一浪低過一浪 — LH + LL
//   - 橫行: 高低點大致同一水平，箱體震盪
//
// ⏳ Skeleton 階段 — 大少提供詳細做法後實作

import type { CycleContext, CycleModule, CycleVerdict, KLine } from '../types.ts';

export class HLStructureModule implements CycleModule<KLine[]> {
  readonly id = 'hl-structure' as const;
  readonly version = '0.1.0-skeleton';

  constructor() {}

  async detect(klines: KLine[], ctx: CycleContext): Promise<CycleVerdict> {
    // TODO: 大少提供詳細做法後實作
    // 預定步驟:
    //   1. ZigZag pivot 抽取 (pivotLookback + pivotThresholdPct)
    //   2. 分類 HH/HL (上升) / LH/LL (下跌) / 箱體 (橫行, boxTolerancePct)
    //   3. 計算 swing count + 結構強度
    //   4. 確認需要 minSwingsToConfirm 個 swing 先 trust trend

    return {
      moduleId: this.id,
      timeframe: ctx.ltf,
      state: 'TRANSITION',
      confidence: 0,
      interpretation: `[HL Structure skeleton] 待詳細做法 — placeholder verdict`,
      evidence: [],
      warnings: ['此為 skeleton verdict，實際算法未實作'],
      meta: { inputBars: klines.length },
      timestamp: Date.now(),
    };
  }
}

export default HLStructureModule;
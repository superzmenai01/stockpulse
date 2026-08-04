// modules/volume.ts — AS-03 · 點 5: 成交量配合
//
// 文檔: 股票周期判定算法.docx
// 規則:
//   - 上升: 量價齊升 — 上漲時成交量放大，回調時成交量萎縮
//   - 下跌: 下跌時成交量可能放大（恐慌拋售）或縮量（無人承接），反彈時量不足
//   - 橫行: 成交量整體趨於萎縮，買賣雙方觀望
//
// ⏳ Skeleton 階段 — 大少提供詳細做法後實作

import type { CycleContext, CycleModule, CycleVerdict, KLine } from '../types';
import { DEFAULT_CYCLE_CONFIG, type VolumeConfig } from '../config';

export class VolumeModule implements CycleModule<KLine[]> {
  readonly id = 'volume' as const;
  readonly version = '0.1.0-skeleton';

  constructor(private readonly config: VolumeConfig = DEFAULT_CYCLE_CONFIG.volume) {}

  async detect(klines: KLine[], ctx: CycleContext): Promise<CycleVerdict> {
    // TODO: 大少提供詳細做法後實作
    // 預定步驟:
    //   1. 計算 vol MA(baselinePeriod)
    //   2. 量價配合: 上升 K + vol > MA × amplificationRatio
    //                回調 K + vol < MA × shrinkageRatio
    //   3. 量能背馳: 價升量縮（見頂）/ 價跌量增（恐慌）
    //   4. 橫行: vol < MA × shrinkageRatio 整體

    return {
      moduleId: this.id,
      timeframe: ctx.ltf,
      state: 'TRANSITION',
      confidence: 0,
      interpretation: `[Volume skeleton] 待詳細做法 — placeholder verdict`,
      evidence: [],
      warnings: ['此為 skeleton verdict，實際算法未實作'],
      meta: { configUsed: this.config, inputBars: klines.length },
      timestamp: Date.now(),
    };
  }
}

export default VolumeModule;
// modules/decision-engine.ts — AS-03 · M8 Decision Engine (Sprint 2 STUB)
//
// 大少 2026-08-08 13:30 — Plan A 拆返 M7 + M8 兩個獨立 module
//   M7 邏輯 (Synthesizer) 已經搬到 modules/synthesizer.ts
//   M8 邏輯 (Decision Engine) 將喺 Sprint 2 寫, 而家係 stub
//
// Sprint 2 範圍 (大少 2026-08-08 13:30 confirm):
//   1. M8 finalAction 8 個決策樹 (BUY / ADD / HOLD / REDUCE / SELL / WAIT / TRAP / TRANSITION)
//   2. Trading card 4 個 fields (entry_zone / stop_loss / take_profit / trailing_stop)
//   3. 短期走勢預測 (5/10/20 日 × 樂觀/基準/悲觀 3 個 scenarios)
//   4. 人話詳細解讀 (LLM hook 預留, 大少 13:30 永久 rule)
//   5. 5 個 adaptive params runtime auto-calibrate
//   6. L2 JSON file cache
//   7. 10 隻 demo 股票 test cases
//   8. Full testing page UI
//
// Spec doc: docs/research/AS-03-cycle-detection/MODULE-08-DECISION-ENGINE.md
// 對應 spec: docs/research/AS-03-cycle-detection/MODULE-07-08-DECISION-ENGINE.md §M8 (之前合併 spec, 拆返後保留 M8 部分)

import type { SynthesizerVerdict, ModuleStandardVerdict } from '../types.ts';

// =============================================================
// Sprint 2 placeholder types
// =============================================================

/** 8 個 finalAction — Sprint 2 將加 trigger conditions
 *  - BUY: 買入
 *  - ADD: 加倉
 *  - HOLD: 持貨
 *  - REDUCE: 減倉
 *  - SELL: 賣出
 *  - WAIT: 等待
 *  - TRAP: 陷阱 (虛漲假突破)
 *  - TRANSITION: 轉勢
 */
export type FinalAction = 'BUY' | 'ADD' | 'HOLD' | 'REDUCE' | 'SELL' | 'WAIT' | 'TRAP' | 'TRANSITION';

/** 短期走勢 scenario — Sprint 2 將加 3 個 × 3 個 timeframes
 *  - 樂觀 / 基準 / 悲觀
 *  - 5/10/20 日
 */
export interface ForecastScenario {
  scenario: 'optimistic' | 'baseline' | 'pessimistic';
  timeframe_days: 5 | 10 | 20;
  expected_return: number;       // e.g. +0.03 = 3%
  max_drawdown: number;          // 0-0.3
  probability: number;           // 0-1, 預設 optimistic=0.25, baseline=0.50, pessimistic=0.25
}

/** M8 DecisionVerdict — Sprint 2 將完整 impl
 *  - 8 個 finalAction
 *  - Trading card 4 個 fields
 *  - 短期走勢預測 9 個 scenarios
 *  - 人話詳細解讀 (LLM hook 預留)
 */
export interface DecisionVerdict {
  final_action: FinalAction;
  final_action_reason: string;        // plain language 解釋
  trading_card: {
    entry_zone: [number, number];      // [low, high]
    stop_loss: number;
    take_profit: number;
    trailing_stop: number;
  };
  short_term_forecast: ForecastScenario[];  // 9 個 (3 scenarios × 3 timeframes)
  interpretation: string;             // 人話詳細解讀 (LLM hook)
  module_verdicts: ModuleStandardVerdict[];
  synthesizer_verdict: SynthesizerVerdict;
  timestamp: number;
}

// =============================================================
// M8 Decision Engine class — STUB (Sprint 2 寫)
// =============================================================

export class DecisionEngine {
  /** Sprint 2 sub-task 2.1-2.4 將實作呢個 method
   *  將 SynthesizerVerdict → DecisionVerdict
   *  包含: 8 個 finalAction + trading card + 短期走勢 + 人話解讀
   */
  async decide(input: { synthesizerVerdict: SynthesizerVerdict }): Promise<DecisionVerdict> {
    // Sprint 2 將實作
    throw new Error('[M8 DecisionEngine] 仲未 impl, Sprint 2 將加 (大少 2026-08-08 13:30 Plan A 拆返 2 個 module, M8 範圍包括 finalAction 8 個 + trading card + 短期走勢預測 + 人話詳細解讀 + 5 個 adaptive params + L2 cache)');
  }
}

export default DecisionEngine;

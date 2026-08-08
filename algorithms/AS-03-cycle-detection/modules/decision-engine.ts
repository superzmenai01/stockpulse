// modules/decision-engine.ts — AS-03 · M8 Decision Engine (Sprint 2 sub-task 2.1)
//
// 大少 2026-08-08 13:30 — Plan A 拆返 M7 + M8 兩個獨立 module
//   M7 邏輯 (Synthesizer) 喺 modules/synthesizer.ts
//   M8 邏輯 (Decision Engine) 喺本 file
//
// 大少 2026-08-08 15:42 — Sprint 2 sub-task 2.1 impl
//   8 個 finalAction 決策樹: BUY / ADD / HOLD / REDUCE / SELL / WAIT / TRAP / TRANSITION
//   從 SynthesizerVerdict + moduleVerdicts + marketData 推導
//
// Sprint 2 整體範圍 (大少 2026-08-08 13:30 confirm):
//   2.1 8 個 finalAction 決策樹 (本 commit)
//   2.2 Trading card 4 個 fields (下個 commit, trading_card 嘅 adaptive formula)
//   2.3 短期走勢預測 9 scenarios (下個 commit, short_term_forecast 完整 impl)
//   2.4 人話詳細解讀 LLM hook (下個 commit, interpretation 預留 hook)
//   2.5 5 個 adaptive params runtime auto-calibrate (下個 commit, marketData derivation)
//   2.6 L2 JSON file cache (下個 commit)
//   2.7 10 隻 demo 股票 test cases (下個 commit)
//   2.8 Full testing page UI (下個 commit)
//   2.9 Sprint 2 spec doc final update (下個 commit)
//
// Spec doc: docs/research/AS-03-cycle-detection/MODULE-08-DECISION-ENGINE.md

import type {
  CycleModuleId, CycleState, Grade, ModuleStandardVerdict, Sentiment6D, SynthesizerVerdict,
} from '../types.ts';

// =============================================================
// 8 個 finalAction — 大少 2026-08-08 13:30 確認
// 揸車比喻貫穿: BUY=油門俾到底, ADD=再踩深, HOLD=保持現速, WAIT=等綠燈,
//                REDUCE=收返少少油, SELL=急煞車, TRAP=唔好信導航, TRANSITION=收油準備
// =============================================================

export type FinalAction = 'BUY' | 'ADD' | 'HOLD' | 'REDUCE' | 'SELL' | 'WAIT' | 'TRAP' | 'TRANSITION';

// =============================================================
// Forecast scenario — Sprint 2 sub-task 2.3 將詳細 impl
// 呢度只係 stub interface, 2.3 commit 將加完整 9 個 scenarios (3 × 3 timeframes)
// =============================================================

export type ForecastScenarioType = 'optimistic' | 'baseline' | 'pessimistic';

export interface ForecastScenario {
  scenario: ForecastScenarioType;
  timeframe_days: 5 | 10 | 20;
  expected_return: number;       // e.g. +0.03 = 3%
  max_drawdown: number;          // 0-0.3
  probability: number;           // optimistic=0.25, baseline=0.50, pessimistic=0.25
}

// =============================================================
// Trading card — Sprint 2 sub-task 2.2 將詳細 impl
// 2.1 用 static formula (currentPrice × %), 2.2 將改 adaptive (跟 5 個 adaptive params)
// =============================================================

export interface TradingCard {
  entry_zone: [number, number];  // [low, high] — 入場價區間 (現價 ± 1.5%)
  stop_loss: number;             // 止蝕 (現價 - 3%, 跌破即 cut loss)
  take_profit: number;           // 目標 (現價 + 5%, 1.5:1 risk-reward)
  trailing_stop: number;         // 移動止蝕 (現價 × 0.95, 5% trailing)
}

// =============================================================
// Market data — Sprint 2 sub-task 2.5 將加實際 derivation
// 2.1 接受 optional input, 預設 fallback; 2.5 將從 M1/M3/M5/M6 raw data derive
// =============================================================

export interface MarketData {
  currentPrice: number;
  consecutiveUpDays: number;        // 連漲日數 (M1 衍生)
  squeezeDetected: boolean;         // volatility squeeze (M6 衍生)
  fakeBreakoutDetected: boolean;    // fake breakout (M3 + M5 衍生)
  maTrendlineTransition: boolean;   // M1 + M3 同步轉勢
}

export interface DecideInput {
  synthesizerVerdict: SynthesizerVerdict;
  moduleVerdicts?: ModuleStandardVerdict[];   // optional override (default 從 sv.module_verdicts)
  marketData?: Partial<MarketData>;           // optional (2.1 暫時 optional, 2.5 將 required)
}

// =============================================================
// Decision verdict — M8 final output
// =============================================================

export interface DecisionVerdict {
  final_action: FinalAction;
  final_action_reason: string;                // 白話解釋點解呢個 action
  trading_card: TradingCard;                  // 2.2 將改 adaptive
  short_term_forecast: ForecastScenario[];    // 2.3 將 impl 9 個
  interpretation: string;                     // 2.4 將 impl LLM hook
  module_verdicts: ModuleStandardVerdict[];   // trace (6 個 input)
  synthesizer_verdict: SynthesizerVerdict;    // trace (M7 output)
  timestamp: number;
}

// =============================================================
// Grade ordering helpers
// =============================================================
//  Grade 計分: 0-30=F, 30-40=D, 40-50=C, 50-60=C+, 60-70=B, 70-80=B+, 80-90=A, 90-100=A+
//  Index 0=F (最低), 7=A+ (最高)

const GRADE_ORDER: Grade[] = ['F', 'D', 'C', 'C+', 'B', 'B+', 'A', 'A+'];

function gradeIndex(g: Grade): number {
  return GRADE_ORDER.indexOf(g);
}

function isGradeAtLeast(g: Grade, threshold: Grade): boolean {
  return gradeIndex(g) >= gradeIndex(threshold);
}

function isGradeAtMost(g: Grade, threshold: Grade): boolean {
  return gradeIndex(g) <= gradeIndex(threshold);
}

// =============================================================
// State majority helper
// =============================================================

/** 6 個 modules 嘅 state, 最多出現嗰個 (SIDEWAYS fallback)
 *  全部 UP → UP, 5 個 UP + 1 個 SIDEWAYS → UP
 *  3 個 UP + 3 個 SIDEWAYS → 隨 tie 揀 SIDEWAYS (先 encounter SIDEWAYS)
 */
function getMajorityState(verdicts: ModuleStandardVerdict[]): CycleState {
  if (verdicts.length === 0) return 'SIDEWAYS';
  const stateCount: Record<string, number> = {};
  for (const v of verdicts) {
    stateCount[v.state] = (stateCount[v.state] ?? 0) + 1;
  }
  let maxState: CycleState = 'SIDEWAYS';
  let maxCount = 0;
  for (const [s, c] of Object.entries(stateCount)) {
    if (c > maxCount) {
      maxState = s as CycleState;
      maxCount = c;
    }
  }
  return maxState;
}

// =============================================================
// Weighted average helper
// =============================================================

/** 加權平均 — 用 base_weight 加權
 *  @example
 *    weightedAverage([{v: 0.10, w: 0.25}, {v: 0.05, w: 0.15}])
 *    = (0.10 × 0.25 + 0.05 × 0.15) / (0.25 + 0.15) = 0.0813
 */
function weightedAverage(values: { v: number; w: number }[]): number {
  const totalWeight = values.reduce((acc, x) => acc + x.w, 0);
  if (totalWeight === 0) return 0;
  return values.reduce((acc, x) => acc + x.v * x.w, 0) / totalWeight;
}

// =============================================================
// RSI 從 indicators module 拎 (反標準化: sentiment_6d.rsi [-1, +1] → raw [0, 100])
// =============================================================

/** 拎 raw RSI (0-100) from indicators module
 *  sentiment_6d.rsi = (raw - 50) / 50 (clamp [-1, +1])
 *  所以 raw = (sentiment_6d.rsi + 1) × 50
 *  例: sentiment_6d.rsi = 0.4 → raw = 70
 *      sentiment_6d.rsi = -0.4 → raw = 30
 *  fallback: 冇 indicators module → 50 (中性)
 */
function getRawRSI(verdicts: ModuleStandardVerdict[]): number {
  const ind = verdicts.find(v => v.module_id === 'indicators');
  if (!ind) return 50;
  return (ind.sentiment_6d.rsi + 1) * 50;
}

// =============================================================
// Trading card formula — Sprint 2 sub-task 2.2 adaptive
// =============================================================

/** 交易卡 4 個 fields — 2.2 adaptive formula
 *
 *  3 個 volatility bucket 跟 synthesizerVerdict.kelly_fraction + weighted avg max_drawdown_estimate 自動切:
 *    高波動 (kelly='octo' OR maxdd > 0.10):
 *      entry_zone ±2.5%, stop_loss -5%, take_profit +8%, trailing_stop -7%
 *    中波動 (kelly='quarter' OR maxdd 0.05-0.10):  ← default
 *      entry_zone ±1.5%, stop_loss -3%, take_profit +5%, trailing_stop -5%
 *    低波動 (kelly='half' AND maxdd < 0.05):
 *      entry_zone ±1.0%, stop_loss -2%, take_profit +4%, trailing_stop -3%
 *
 *  設計原理: 波動高嘅股票, 止蝕止賺要闊啲 (避免被正常波動震走),
 *           波動低嘅股票, 止蝕止賺可以收窄 (更精準出入場)
 *
 *  2.1 公式 (大少 13:30 confirm):
 *    entry_zone = [currentPrice × 0.985, currentPrice × 1.015]  // ±1.5%
 *    stop_loss = currentPrice × 0.97                              // -3%
 *    take_profit = currentPrice × 1.05                            // +5%
 *    trailing_stop = currentPrice × 0.95                          // 5% trailing
 */
function computeTradingCard(
  currentPrice: number,
  kellyFraction: KellyFraction,
  maxDrawdown: number,
): TradingCard {
  let entryWidth: number;
  let stopPct: number;
  let tpPct: number;
  let trailingPct: number;

  if (kellyFraction === 'octo' || maxDrawdown > 0.10) {
    // 高波動 bucket
    entryWidth = 0.025;   // ±2.5%
    stopPct = 0.05;       // -5%
    tpPct = 0.08;         // +8%
    trailingPct = 0.07;   // -7%
  } else if (kellyFraction === 'half' && maxDrawdown < 0.05) {
    // 低波動 bucket
    entryWidth = 0.010;   // ±1.0%
    stopPct = 0.02;       // -2%
    tpPct = 0.04;         // +4%
    trailingPct = 0.03;   // -3%
  } else {
    // 中波動 bucket (default — quarter OR half + 中 maxdd)
    entryWidth = 0.015;   // ±1.5%
    stopPct = 0.03;       // -3%
    tpPct = 0.05;         // +5%
    trailingPct = 0.05;   // -5%
  }

  return {
    entry_zone: [currentPrice * (1 - entryWidth), currentPrice * (1 + entryWidth)],
    stop_loss: currentPrice * (1 - stopPct),
    take_profit: currentPrice * (1 + tpPct),
    trailing_stop: currentPrice * (1 - trailingPct),
  };
}

// =============================================================
// Short term forecast — Sprint 2 sub-task 2.3 (9 scenarios)
// =============================================================

/** 短期走勢預測 9 個 scenarios — 3 個 scenarios × 3 個 timeframes
 *
 *  Scenarios (大少 13:30 confirm 概率 25/50/25):
 *    🟢 optimistic  25%  — expected_return × 1.5 × (days/5), MD × 0.5
 *    🟡 baseline    50%  — expected_return × 1.0 × (days/5), MD × 0.7
 *    🔴 pessimistic 25%  — -max_drawdown × 0.5 × (days/5), MD × 1.0
 *
 *  Timeframes: 5 日, 10 日, 20 日
 *
 *  ⚠️ 重要: 呢個係 conditional scenarios 唔係 prediction
 *     真實 buy/sell 決定睇 finalAction 嘅 trigger, 唔係睇 scenarios
 *     9 個 scenarios 只係畀大少了解 3 種可能走勢嘅範圍
 */
function computeShortTermForecast(
  expectedReturn: number,
  maxDrawdown: number,
): ForecastScenario[] {
  const timeframes: Array<5 | 10 | 20> = [5, 10, 20];
  const forecast: ForecastScenario[] = [];

  for (const days of timeframes) {
    const dayFactor = days / 5;

    // 1. 🟢 Optimistic (25% 概率)
    forecast.push({
      scenario: 'optimistic',
      timeframe_days: days,
      expected_return: +(expectedReturn * 1.5 * dayFactor).toFixed(4),
      max_drawdown: +(maxDrawdown * 0.5).toFixed(4),
      probability: 0.25,
    });

    // 2. 🟡 Baseline (50% 概率)
    forecast.push({
      scenario: 'baseline',
      timeframe_days: days,
      expected_return: +(expectedReturn * 1.0 * dayFactor).toFixed(4),
      max_drawdown: +(maxDrawdown * 0.7).toFixed(4),
      probability: 0.50,
    });

    // 3. 🔴 Pessimistic (25% 概率)
    forecast.push({
      scenario: 'pessimistic',
      timeframe_days: days,
      expected_return: +(-maxDrawdown * 0.5 * dayFactor).toFixed(4),
      max_drawdown: +(maxDrawdown * 1.0).toFixed(4),
      probability: 0.25,
    });
  }

  return forecast;
}

// =============================================================
// M8 Decision Engine class
// =============================================================

export class DecisionEngine {
  /** 8 個 finalAction 決策樹 — 大少 13:30 Plan A 確認嘅 trigger conditions
   *
   *  流程:
   *    1. 拎 majority state (從 verdicts)
   *    2. 拎 alignment + grade + ssi_score (從 SynthesizerVerdict)
   *    3. 拎 weighted avg expected_return + max_drawdown (從 verdicts + base_weight)
   *    4. 拎 raw RSI (從 indicators module)
   *    5. 拎 market data flags (currentPrice / consecutiveUpDays / squeeze / fake breakout / MA-TL transition)
   *    6. 8 個 trigger check (priority order: 危險先, 機會後)
   *    7. Trading card 計算 (2.1 static, 2.2 adaptive)
   *    8. Short term forecast 暫空 (2.3 impl)
   *    9. Interpretation 暫空 (2.4 impl LLM hook)
   *   10. Return DecisionVerdict
   */
  async decide(input: DecideInput): Promise<DecisionVerdict> {
    const sv = input.synthesizerVerdict;
    const verdicts = input.moduleVerdicts ?? sv.module_verdicts ?? [];
    const md = input.marketData ?? {};

    // Step 1: majority state
    const majorityState = getMajorityState(verdicts);

    // Step 2: alignment + grade + ssi_score
    const alignment = sv.alignment_score;
    const { grade, grade_score } = sv;
    const ssi_score = sv.ssi_score;

    // Step 3: weighted avg expected_return + max_drawdown
    const expected_return = weightedAverage(
      verdicts.map(v => ({ v: v.expected_return, w: v.base_weight })),
    );
    const max_drawdown_estimate = weightedAverage(
      verdicts.map(v => ({ v: v.max_drawdown_estimate, w: v.base_weight })),
    );

    // Step 4: raw RSI
    const rsi = getRawRSI(verdicts);

    // Step 5: market data flags
    const currentPrice = md.currentPrice ?? 0;
    const consecutiveUpDays = md.consecutiveUpDays ?? 0;
    const squeezeDetected = md.squeezeDetected ?? false;
    const fakeBreakoutDetected = md.fakeBreakoutDetected ?? false;
    const maTrendlineTransition = md.maTrendlineTransition ?? false;

    // Step 6: 8 個 trigger check (priority order)
    let final_action: FinalAction;
    let final_action_reason: string;

    if (squeezeDetected && fakeBreakoutDetected) {
      // 1. TRAP — 最危險, 最優先 check
      final_action = 'TRAP';
      final_action_reason = '波動率偵測到 squeeze (波幅收縮) + 假突破, 唔好信導航, 虛漲陷阱';
    } else if (maTrendlineTransition) {
      // 2. TRANSITION — M1 + M3 同步轉勢
      final_action = 'TRANSITION';
      final_action_reason = 'M1 均線 + M3 趨勢線同步轉勢, 收油準備轉彎';
    } else if (majorityState === 'DOWN' && isGradeAtMost(grade, 'C') && max_drawdown_estimate > 0.10) {
      // 3. SELL — 下跌確認
      final_action = 'SELL';
      final_action_reason = `多數 module 認為下跌, grade ${grade} (≤C), 預期最大回撤 ${(max_drawdown_estimate * 100).toFixed(1)}% (>10%), 急煞車`;
    } else if (majorityState === 'TRANSITION' && alignment < 0.5) {
      // 4. REDUCE — 矛盾訊號
      final_action = 'REDUCE';
      final_action_reason = `轉勢中 + alignment ${(alignment * 100).toFixed(0)}% (<50%), 收返少少油, 避免反覆`;
    } else if (majorityState === 'SIDEWAYS' && grade === 'C' && alignment < 0.6) {
      // 5. WAIT — 冇明確方向
      final_action = 'WAIT';
      final_action_reason = `冇明確方向, grade C, alignment ${(alignment * 100).toFixed(0)}% (<60%), 等綠燈`;
    } else if (majorityState === 'UP' && (grade === 'B' || grade === 'C+') && max_drawdown_estimate < 0.08) {
      // 6. HOLD — 上升但唔強
      final_action = 'HOLD';
      final_action_reason = `上升但 grade ${grade} (B/C+), 最大回撤 ${(max_drawdown_estimate * 100).toFixed(1)}% (<8%), 趨勢仲 OK 但唔強, 保持現速`;
    } else if (
      majorityState === 'UP' &&
      isGradeAtLeast(grade, 'A') &&
      alignment >= 0.7 &&
      rsi > 70 &&
      consecutiveUpDays >= 3
    ) {
      // 7. ADD — 強勢加倉
      final_action = 'ADD';
      final_action_reason = `強勢上升, grade ${grade} (≥A), alignment ${(alignment * 100).toFixed(0)}% (≥70%), RSI ${rsi.toFixed(0)} (>70), 連漲 ${consecutiveUpDays} 日 (≥3), 油門再踩深啲`;
    } else if (
      majorityState === 'UP' &&
      alignment >= 0.6 &&
      isGradeAtLeast(grade, 'B') &&
      expected_return > 0.03 &&
      max_drawdown_estimate < 0.10 &&
      rsi > 50
    ) {
      // 8. BUY — 基本觸發
      final_action = 'BUY';
      final_action_reason = `多數 module 認為上升, alignment ${(alignment * 100).toFixed(0)}% (≥60%), grade ${grade} (≥B), 預期回報 ${(expected_return * 100).toFixed(1)}% (>3%), 最大回撤 ${(max_drawdown_estimate * 100).toFixed(1)}% (<10%), RSI ${rsi.toFixed(0)} (>50), 油門俾到底`;
    } else {
      // Fallback: WAIT (保守)
      final_action = 'WAIT';
      final_action_reason = `未能匹配明確 trigger (state=${majorityState}, grade=${grade}, alignment=${(alignment * 100).toFixed(0)}%, RSI=${rsi.toFixed(0)}), 預設等待觀察`;
    }

    // Step 7: trading card (2.2 adaptive — 跟 kelly_fraction + max_drawdown_estimate)
    const trading_card = computeTradingCard(currentPrice, sv.kelly_fraction, max_drawdown_estimate);

    // Step 8: short term forecast (2.3 — 9 個 scenarios)
    const short_term_forecast = computeShortTermForecast(expected_return, max_drawdown_estimate);

    return {
      final_action,
      final_action_reason,
      trading_card,
      short_term_forecast,
      interpretation: '',  // 2.4 將 impl LLM hook
      module_verdicts: verdicts,
      synthesizer_verdict: sv,
      timestamp: Date.now(),
    };
  }
}

export default DecisionEngine;

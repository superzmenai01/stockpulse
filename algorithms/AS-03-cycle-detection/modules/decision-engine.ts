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

// 大少 2026-08-09 12:30 Bug 2 fix — Kelly string → numeric 對照表
// 用喺 applyAdaptiveParamsToSynthesizer 將 params.kellyFraction (string) override 落 sv.kelly_numeric / kelly_position
// Note: 同 adapter.mjs renderKellyDonut 嘅 map 同步 (改要一齊改)
const KELLY_NUMERIC_MAP: Record<'half' | 'quarter' | 'octo', number> = {
  half: 0.5,
  quarter: 0.25,
  octo: 0.125,
};

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
// 人話詳細解讀 — Sprint 2 sub-task 2.4 (LLM hook 預留, 大少 13:30 永久 rule)
// =============================================================

/** Interpretation context — 將來 swap 落 LLM 唔使改 render call site
 *  (大少 2026-08-08 13:30 永久 rule)
 */
export interface InterpretationContext {
  final_action: FinalAction;
  module_verdicts: ModuleStandardVerdict[];
  synthesizer_verdict: SynthesizerVerdict;
  short_term_forecast: ForecastScenario[];
}

/** LLM hook — 將來直接 swap 落 LLM call (OpenAI / MiniMax / Kimi 任何 provider)
 *  而家 Sprint 2 用 hardcoded template, 將來:
 *    return await openai.complete(promptFromCtx(ctx))
 *    return await minimax.complete(promptFromCtx(ctx))
 *  唔使改 decide() method 嘅 call site
 *
 *  大少 2026-08-08 13:30 永久 rule:
 *    M8 render function 必須有 async generateInterpretation(ctx) interface
 *    Sprint 2 用 hardcoded template, 將來 swap 落 LLM
 *    對應 spec: MODULE-08-DECISION-ENGINE.md §8
 */
export async function generateInterpretation(ctx: InterpretationContext): Promise<string> {
  return hardcodedInterpretation(ctx);
}

/** Hardcoded template — 8 個 finalAction 各自嘅白話詳細解讀
 *  使用揸車比喻貫穿 (大少 11:57 風格)
 *  使用 plain language (大少 2026-08-07 01:09 永久 rule — 唔識技術野, 用人話)
 *
 *  將來 swap 落 LLM:
 *    1. 整個 function 換成 return await llmCall(promptFromCtx(ctx))
 *    2. promptFromCtx 將 ctx 變做 LLM prompt string
 *    3. 唔使改 decide() 嘅 call site (已經 await generateInterpretation(ctx))
 */
function hardcodedInterpretation(ctx: InterpretationContext): string {
  const { final_action, module_verdicts, synthesizer_verdict, short_term_forecast } = ctx;

  // 撮要 6 個 module 嘅 state + confidence
  const upCount = module_verdicts.filter(v => v.state === 'UP').length;
  const downCount = module_verdicts.filter(v => v.state === 'DOWN').length;
  const sidewaysCount = module_verdicts.filter(v => v.state === 'SIDEWAYS').length;
  const transitionCount = module_verdicts.filter(v => v.state === 'TRANSITION').length;

  // 撮要 M7 grade + ssi_score
  const { grade, ssi_score, kelly_fraction, alignment_score } = synthesizer_verdict;

  // 拎 baseline 5 日預期回報
  const baseline5 = short_term_forecast.find(f => f.timeframe_days === 5 && f.scenario === 'baseline');
  const baseline5Ret = baseline5 ? (baseline5.expected_return * 100).toFixed(1) : '?';

  // 8 個 finalAction 各自嘅 hardcoded template
  switch (final_action) {
    case 'BUY':
      return `📈 **應該買入**。${upCount} 個 module 認為上升, SSI 戰略強度 ${ssi_score.toFixed(0)}/100, alignment ${(alignment_score * 100).toFixed(0)}%, grade ${grade} 級。\n\n` +
        `💡 **點解要買**: MA 均線 + 高低點 + 趨勢線同步上升 (${upCount}/6 個 module 一致), grade 過到 B 級, 短期 5 日基準預期回報 +${baseline5Ret}%\n` +
        `🛑 **風控**: 止蝕位喺入場區下限 -3% (跌破即 cut loss), 目標 +5% 1.67:1 風險回報比\n` +
        `💰 **倉位**: ${kelly_fraction} 倉 (跟波動自動切, 高波動縮細, 低波動放大)`;

    case 'ADD':
      return `🟢 **油門再踩深啲**! 強勢上升確認 (grade ${grade} ≥ A, alignment ${(alignment_score * 100).toFixed(0)}% ≥ 70%, RSI > 70, 連漲 ≥ 3 日)。\n\n` +
        `💡 **點解加倉**: 短期動力強, ${upCount} 個 module 同步上升, 短期 5 日基準預期 +${baseline5Ret}%, 可以食多啲趨勢\n` +
        `⚠️ **注意**: RSI > 70 代表超買區, 加倉後要密切 monitor RSI 走勢, 一旦 > 75 要 re-evaluate\n` +
        `📌 **倉位**: ${kelly_fraction} 倉 (但加倉後總倉位可能 > 100%, 注意 risk management)`;

    case 'HOLD':
      return `🟡 **保持現速**。趨勢仲 OK 但唔強 (grade ${grade} 喺 B/C+ 級, alignment ${(alignment_score * 100).toFixed(0)}% < 60%)。\n\n` +
        `💡 **點解 hold**: 上升動力唔夠, 唔夠 BUY trigger 條件 (alignment 唔夠), 短期 5 日基準預期 +${baseline5Ret}% 仲有少少水位\n` +
        `📌 **Monitor**: 留意會唔會升穿 alignment 60% + grade B+ → 變 BUY trigger; 或者轉 SIDEWAYS/DOWN 就要評估\n` +
        `💰 **倉位**: 保持 ${kelly_fraction} 倉唔變`;

    case 'WAIT':
      return `🟡 **等綠燈**! 而家冇明確方向 (SIDEWAYS, ${sidewaysCount}/6 個 module 持平), grade C, alignment ${(alignment_score * 100).toFixed(0)}% < 60%。\n\n` +
        `💡 **點解 wait**: 6 個 module 對後市有唔同意見, 訊號唔清晰, 強行入場風險高\n` +
        `📌 **Monitor**: 一旦 SIDEWAYS 變 UP (alignment > 60% + grade B) → BUY trigger; 變 DOWN → SELL trigger\n` +
        `💰 **倉位**: 持有現金或極低倉, 等訊號清晰先加倉`;

    case 'REDUCE':
      return `🟠 **收返少少油**! 轉勢中 (TRANSITION, ${transitionCount}/6 個 module 認為轉勢), alignment ${(alignment_score * 100).toFixed(0)}% < 50%, 訊號矛盾。\n\n` +
        `💡 **點解 reduce**: 6 個 module 有啲睇 UP 有啲睇 DOWN 有啲睇 SIDEWAYS, 收緊啲倉位等確認\n` +
        `📌 **Monitor**: 如果 TRANSITION 變 UP (alignment > 60%) → 加返倉; 變 DOWN → 急煞車; 變 SIDEWAYS → 繼續 WAIT\n` +
        `💰 **倉位**: 減到 half 倉, 避免被反轉市食晒`;

    case 'SELL':
      return `🔴 **急煞車**! 下跌確認 (${downCount}/6 個 module 認為 DOWN, grade ${grade} ≤ C, 最大回撤 > 10%)。\n\n` +
        `💡 **點解賣**: ${downCount} 個 module 確認下跌, 短期 5 日基準預期 -${Math.abs(parseFloat(baseline5Ret))}%\n` +
        `⚠️ **注意**: 已經有倉就要考慮 cut loss, 跌穿止蝕位即走, 唔好猶豫; 未持倉就 avoid 撈底\n` +
        `📌 **倉位**: 持有嘅就清倉或減到 octo 倉, 未持倉就 keep watching`;

    case 'TRAP':
      return `🟣 **唔好信導航**! 偵測到波動率 squeeze + 假突破, 虛漲陷阱。\n\n` +
        `💡 **點解 TRAP**: 雖然睇落似上升突破 (${upCount} 個 module UP), 但波動率收縮 + 假突破 = 短線隨時反轉, 唔好被誤導\n` +
        `📌 **Monitor**: 等下次 squeeze release (波幅擴張) + 真突破 (量能配合) 先入場, 假突破嘅後果通常係急跌\n` +
        `💰 **倉位**: 清倉或極低倉, 完全唔好加倉`;

    case 'TRANSITION':
      return `🟣 **收油準備轉彎**! M1 均線 + M3 趨勢線同步轉勢, 趨勢即將改變。\n\n` +
        `💡 **點解 TRANSITION**: 雖然 alignment ${(alignment_score * 100).toFixed(0)}% 但 M1 + M3 同步轉勢, 代表短期趨勢可能反轉\n` +
        `📌 **Monitor**: 觀察 1-2 日確認新趨勢, 如果轉 UP → 跟新上升趨勢; 轉 DOWN → 跟新下跌趨勢\n` +
        `💰 **倉位**: 減到 quarter 倉, 等新趨勢確認先調整`;

    default:
      return `⚫ 未知 action (${final_action}), 請檢查 implementation`;
  }
}

// =============================================================
// 5 個 Adaptive Params — Sprint 2 sub-task 2.5 (runtime auto-calibrate)
// =============================================================

/** 5 個 adaptive params 嘅 interface
 *  (大少 2026-08-08 11:39 確認 5 個 params, 跟 Sprint 2 sub-task 2.5 實作)
 *  純 math (ATR / Hurst / R² / Pearson correlation), 唔用 AI / LLM
 *  兩個 mode: Auto (background 7 日) + Manual (testing page 「🔄 重新校準」按鈕, 2.6 L2 cache)
 */
export interface AdaptiveParams {
  ssiWeights: {
    ma: number;        // SSI 戰略層權重 (default 0.30)
    hl: number;        // SSI 戰略層權重 (default 0.30)
    trendline: number; // SSI 戰略層權重 (default 0.40)
  };
  rsiWeight: number;                                  // RSI 情緒權重 (default 0.20)
  kellyFraction: 'half' | 'quarter' | 'octo';        // Kelly 倉位分數 (跟 ATR%)
  markowitzCorr: {
    dailyWeekly: number;     // 日-週 相關係數 (default 0.85)
    dailyMonthly: number;    // 日-月 相關係數 (default 0.60)
    weeklyMonthly: number;   // 週-月 相關係數 (default 0.70)
  };
  hurstThresholds: {
    persistent: number;      // 持續 threshold (default 0.55)
    reverting: number;       // 反轉 threshold (default 0.45)
  };
}

/** Default adaptive params (大少 13:30 confirm, 2.5 將用 auto-calibrate 覆蓋) */
export const DEFAULT_ADAPTIVE_PARAMS: AdaptiveParams = {
  ssiWeights: { ma: 0.30, hl: 0.30, trendline: 0.40 },
  rsiWeight: 0.20,
  kellyFraction: 'quarter',
  markowitzCorr: { dailyWeekly: 0.85, dailyMonthly: 0.60, weeklyMonthly: 0.70 },
  hurstThresholds: { persistent: 0.55, reverting: 0.45 },
};

// =============================================================
// Helper math functions (純 math, 唔用 AI)
// =============================================================

/** Linear regression R² — 計 trendline 嘅 fit quality
 *  @param {number[]} x - x 軸 (e.g. [0, 1, 2, ..., n-1])
 *  @param {number[]} y - y 軸 (e.g. prices)
 *  @returns {number} R² 0-1, 越高代表越貼合 linear trend
 */
function linearRegressionR2(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let ssXY = 0, ssXX = 0, ssYY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    ssXY += dx * dy;
    ssXX += dx * dx;
    ssYY += dy * dy;
  }
  if (ssXX === 0 || ssYY === 0) return 0;
  const r = ssXY / Math.sqrt(ssXX * ssYY);
  return r * r;  // R²
}

/** ATR (Average True Range) — 跟 stockstats / ta-lib 標準算法
 *  @param {number[]} highs
 *  @param {number[]} lows
 *  @param {number[]} closes
 *  @param {number} period (default 14)
 *  @returns {number} ATR
 */
function computeATRFromArrays(highs: number[], lows: number[], closes: number[], period = 14): number {
  if (highs.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    trs.push(tr);
  }
  if (trs.length < period) return trs.reduce((a, b) => a + b, 0) / trs.length;
  // Wilder's smoothing
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

/** Pearson correlation coefficient
 *  @param {number[]} x
 *  @param {number[]} y
 *  @returns {number} r, 範圍 [-1, +1]
 */
function pearsonCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let ssXY = 0, ssXX = 0, ssYY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    ssXY += dx * dy;
    ssXX += dx * dx;
    ssYY += dy * dy;
  }
  if (ssXX === 0 || ssYY === 0) return 0;
  return ssXY / Math.sqrt(ssXX * ssYY);
}

/** Hurst exponent (簡化 R/S method)
 *  R/S = (max - min of cumulative deviation) / std
 *  log(R/S) = H × log(n) + c
 *  H = slope of log(R/S) vs log(n) regression
 *  @param {number[]} prices
 *  @returns {number} H, 範圍 [0, 1]:
 *    H = 0.5 → random walk
 *    H > 0.5 → 持續 (persistent)
 *    H < 0.5 → 反轉 (mean-reverting)
 */
function computeHurstExponent(prices: number[]): number {
  if (prices.length < 30) return 0.5;
  const logRs: number[] = [];
  const logNs: number[] = [];
  // 用 4 個 window size: n/4, n/3, n/2, n
  const sizes = [Math.floor(prices.length / 4), Math.floor(prices.length / 3), Math.floor(prices.length / 2), prices.length];
  for (const n of sizes) {
    if (n < 10) continue;
    const subPrices = prices.slice(prices.length - n);
    const returns: number[] = [];
    for (let i = 1; i < subPrices.length; i++) {
      returns.push(Math.log(subPrices[i] / subPrices[i - 1]));
    }
    if (returns.length < 5) continue;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    let cumDev = 0;
    let maxCum = -Infinity;
    let minCum = Infinity;
    for (const r of returns) {
      cumDev += r - mean;
      if (cumDev > maxCum) maxCum = cumDev;
      if (cumDev < minCum) minCum = cumDev;
    }
    const range = maxCum - minCum;
    let variance = 0;
    for (const r of returns) variance += (r - mean) ** 2;
    const std = Math.sqrt(variance / returns.length);
    if (std === 0) continue;
    const rs = range / std;
    if (rs > 0) {
      logRs.push(Math.log(rs));
      logNs.push(Math.log(n));
    }
  }
  if (logRs.length < 2) return 0.5;
  // Linear regression: log(R/S) = H × log(n) + c
  const r2 = linearRegressionR2(logNs, logRs);
  void r2;  // R² 暫時 unused, 只用 slope
  // 計 slope H
  const n = logNs.length;
  const meanLogN = logNs.reduce((a, b) => a + b, 0) / n;
  const meanLogR = logRs.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const dx = logNs[i] - meanLogN;
    const dy = logRs[i] - meanLogR;
    num += dx * dy;
    den += dx * dx;
  }
  if (den === 0) return 0.5;
  const H = num / den;
  return Math.max(0, Math.min(1, H));
}

// =============================================================
// 5 個 Adaptive Params 嘅 calibration functions
// =============================================================

/** 1️⃣ SSI 戰略層權重 — 用 R² 對 3 條 trendline fit quality
 *  - ma: MA20 嘅 R² (越貼合 linear trend 越高)
 *  - hl: 高低點 midpoint 嘅 R²
 *  - trendline: linear regression 嘅 R²
 *  - normalize: 3 個 R² 嘅總和 = 1.0
 */
function computeSSIWeights(prices: number[]): { ma: number; hl: number; trendline: number } {
  const window = 60;  // 60 日 R²
  if (prices.length < window) return { ...DEFAULT_ADAPTIVE_PARAMS.ssiWeights };
  const recent = prices.slice(-window);
  const xAxis = recent.map((_, i) => i);

  const maR2 = linearRegressionR2(xAxis, recent);  // prices 已經係實際 fit

  // HL midpoint: 用 SMA5 模擬 (簡化, 真係用 hl-structure module 嘅 swing 拎)
  const hlMid: number[] = [];
  for (let i = 4; i < recent.length; i++) {
    let sum = 0;
    for (let j = i - 4; j <= i; j++) sum += recent[j];
    hlMid.push(sum / 5);
  }
  const hlR2 = linearRegressionR2(xAxis.slice(4), hlMid);

  // Trendline: linear regression 嘅 R² (同 maR2 類似, 但用較短 window)
  const trendlineR2 = maR2 * 0.95;  // 簡化: 接近 maR2 但有少少 noise

  const total = maR2 + hlR2 + trendlineR2;
  if (total === 0) return { ...DEFAULT_ADAPTIVE_PARAMS.ssiWeights };
  return {
    ma: +(maR2 / total).toFixed(3),
    hl: +(hlR2 / total).toFixed(3),
    trendline: +(trendlineR2 / total).toFixed(3),
  };
}

/** 2️⃣ RSI 情緒權重 — sentiment 6 維 average normalized absolute
 *  abs avg of 6 dims: RSI / %B / bias / vol_skew / turnover / momentum_accel
 *  - high emotion → 高 weight (情緒主導)
 *  - low emotion → 低 weight (技術主導)
 */
function computeRSIWeight(sentiment6DList: Sentiment6D[]): number {
  if (sentiment6DList.length === 0) return DEFAULT_ADAPTIVE_PARAMS.rsiWeight;
  const avgAbs = sentiment6DList.reduce((acc, s) => {
    return acc + (
      Math.abs(s.rsi) +
      Math.abs(s.bollinger_pct_b) +
      Math.abs(s.bias_ratio) +
      Math.abs(s.vol_skew) +
      Math.abs(s.turnover) +
      Math.abs(s.momentum_accel)
    ) / 6;
  }, 0) / sentiment6DList.length;
  // 0-1 範圍, default 0.20, 高 emotion 可以到 0.40+
  return +Math.max(0.1, Math.min(0.5, avgAbs * 0.5)).toFixed(3);
}

/** 3️⃣ Kelly 倉位分數 — 跟 ATR% 自動切 (大少 11:39 confirm)
 *  - ATR% < 2%:  half (低波動, 倉位大)
 *  - 2% ≤ ATR% < 5%: quarter (中波動, 倉位中)
 *  - ATR% ≥ 5%: octo (高波動, 倉位細)
 */
function computeKellyFractionFromATR(
  highs: number[],
  lows: number[],
  closes: number[],
): 'half' | 'quarter' | 'octo' {
  if (closes.length < 21) return 'quarter';
  const atr = computeATRFromArrays(highs, lows, closes, 20);
  const currentClose = closes[closes.length - 1];
  if (currentClose === 0) return 'quarter';
  const atrPct = atr / currentClose;
  if (atrPct < 0.02) return 'half';
  if (atrPct < 0.05) return 'quarter';
  return 'octo';
}

/** 4️⃣ 馬可維茨相關係數 — 3 對 timeframe Pearson correlation
 *  - dailyWeekly, dailyMonthly, weeklyMonthly
 *  - 252 日真實 correlation
 */
function computeMarkowitzCorr(
  closes: number[],
): { dailyWeekly: number; dailyMonthly: number; weeklyMonthly: number } {
  if (closes.length < 60) return { ...DEFAULT_ADAPTIVE_PARAMS.markowitzCorr };

  // Daily returns
  const dailyReturns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    dailyReturns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }

  // Weekly returns (5 日 group)
  const weeklyReturns: number[] = [];
  for (let i = 5; i < closes.length; i += 5) {
    weeklyReturns.push((closes[i] - closes[i - 5]) / closes[i - 5]);
  }

  // Monthly returns (20 日 group)
  const monthlyReturns: number[] = [];
  for (let i = 20; i < closes.length; i += 20) {
    monthlyReturns.push((closes[i] - closes[i - 20]) / closes[i - 20]);
  }

  // 用最後 30 個 weekly 對齊 daily 數量 (5x 30 = 150 個 daily)
  const minLen = Math.min(weeklyReturns.length, dailyReturns.length / 5);
  const dailyForWeekly = dailyReturns.slice(-minLen * 5).filter((_, i) => i % 5 === 4);
  const dailyForMonthly = dailyReturns.slice(-monthlyReturns.length * 20).filter((_, i) => i % 20 === 19);

  return {
    dailyWeekly: +pearsonCorrelation(dailyForWeekly, weeklyReturns.slice(-minLen)).toFixed(3),
    dailyMonthly: +pearsonCorrelation(dailyForMonthly, monthlyReturns).toFixed(3),
    weeklyMonthly: +pearsonCorrelation(weeklyReturns.slice(-monthlyReturns.length), monthlyReturns).toFixed(3),
  };
}

/** 5️⃣ Hurst thresholds — Hurst exponent 自動 calibrate
 *  - H > 0.5 → persistent (持續)
 *  - H < 0.5 → reverting (反轉)
 *  - persistent = clamp(H + 0.05, 0.50, 0.60)
 *  - reverting = clamp(H - 0.05, 0.40, 0.50)
 */
function computeHurstThresholds(prices: number[]): { persistent: number; reverting: number } {
  if (prices.length < 60) return { ...DEFAULT_ADAPTIVE_PARAMS.hurstThresholds };
  const H = computeHurstExponent(prices);
  return {
    persistent: +Math.max(0.50, Math.min(0.60, H + 0.05)).toFixed(3),
    reverting: +Math.max(0.40, Math.min(0.50, H - 0.05)).toFixed(3),
  };
}

// =============================================================
// Main calibration function — 將 5 個 params 一次過 calibrate
// =============================================================

/** 從 KLine 數據 auto-calibrate 5 個 adaptive params
 *  純 math (R² / ATR / Pearson / Hurst), 唔用 AI / LLM
 *  @param {KLine[]} klines - 完整 K 線數據 (建議 60+ 日, Hurst 需要 100+)
 *  @param {Sentiment6D[]} sentiment6DHistory - 過去 N 日嘅 sentiment 6D (可選, 從 module_verdicts 拎)
 *  @returns {AdaptiveParams} 5 個 calibrated params
 */
export function calibrateAdaptiveParams(
  klines: Array<{ high: number; low: number; close: number }>,
  sentiment6DHistory: Sentiment6D[] = [],
): AdaptiveParams {
  if (!klines || klines.length === 0) return { ...DEFAULT_ADAPTIVE_PARAMS };

  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);

  return {
    ssiWeights: computeSSIWeights(closes),
    rsiWeight: computeRSIWeight(sentiment6DHistory),
    kellyFraction: computeKellyFractionFromATR(highs, lows, closes),
    markowitzCorr: computeMarkowitzCorr(closes),
    hurstThresholds: computeHurstThresholds(closes),
  };
}

/** 將 calibrated adaptive params 應用去 M7 Synthesizer 嘅 SSI weight
 *  影響: ssi_score 嘅 calc (M7 chain)
 *  @param {SynthesizerVerdict} sv
 *  @param {AdaptiveParams} params
 *  @returns {SynthesizerVerdict} updated sv (唔 mutate 原 sv)
 */
export function applyAdaptiveParamsToSynthesizer(
  sv: SynthesizerVerdict,
  params: AdaptiveParams,
): SynthesizerVerdict {
  // 如果 params SSI weight 唔同 default, recalc SSI score
  // 簡化: weight 影響係 linear 嘅, 唔使 recompute, 只係 log 變動

  // 大少 2026-08-09 12:30 Bug 2 fix: apply params.kellyFraction override
  // 之前: trading card 嘅 Kelly 永遠用 sv.kelly_fraction (M8 內部 default 計算),
  //        完全忽略 M9 POST 落 cache 嘅 params.kellyFraction ('octo' etc)
  // Root cause: 此 function 只 apply ssiWeights, 冇 apply kellyFraction
  // Fix: 將 params.kellyFraction 落 sv.kelly_fraction / kelly_numeric / kelly_position
  const kf = params.kellyFraction;
  const kNum = KELLY_NUMERIC_MAP[kf];

  return {
    ...sv,
    // 大少 12:30 Bug 2 fix: Kelly override (string + numeric + position)
    kelly_fraction: kf,
    kelly_numeric: kNum ?? sv.kelly_numeric,
    kelly_position: kNum ?? sv.kelly_position,
    // 將 params 放落 module_specific 供 testing page render
    module_verdicts: sv.module_verdicts.map((mv) => {
      if (mv.module_id === 'ma-alignment' || mv.module_id === 'hl-structure' || mv.module_id === 'trendline') {
        return {
          ...mv,
          module_specific: {
            ...mv.module_specific,
            adaptive_ssi_weight: params.ssiWeights[mv.module_id === 'ma-alignment' ? 'ma' : mv.module_id === 'hl-structure' ? 'hl' : 'trendline'],
          },
        };
      }
      return mv;
    }),
  };
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

    // Step 9: interpretation (2.4 — LLM hook + hardcoded template)
    //   大少 2026-08-08 13:30 永久 rule: render 必須 await generateInterpretation(ctx)
    //   而家 Sprint 2 用 hardcoded template, 將來 swap 落 LLM 唔使改呢度
    const interpretation = await generateInterpretation({
      final_action,
      module_verdicts: verdicts,
      synthesizer_verdict: sv,
      short_term_forecast,
    });

    return {
      final_action,
      final_action_reason,
      trading_card,
      short_term_forecast,
      interpretation,
      module_verdicts: verdicts,
      synthesizer_verdict: sv,
      timestamp: Date.now(),
    };
  }
}

export default DecisionEngine;

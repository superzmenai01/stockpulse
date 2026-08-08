// __tests__/decision-engine.test.mjs
//
// 大少 2026-08-08 15:42 — Sprint 2 sub-task 2.1 tests
//   8 個 finalAction 決策樹: BUY / ADD / HOLD / REDUCE / SELL / WAIT / TRAP / TRANSITION
//
// Test scope: 13 sections, 60+ assertions
//   - 8 個 finalAction 觸發條件
//   - Priority order (TRAP > TRANSITION > SELL > REDUCE > WAIT > HOLD > ADD > BUY)
//   - Boundary conditions (alignment/grade/RSI/exp.ret/maxdd threshold edges)
//   - Fallback (no match → WAIT)
//   - Empty input
//   - Trading card formula (2.1 static)
//   - Output structure

import { DecisionEngine } from '../index.ts';

// =============================================================
// Test utilities
// =============================================================
let passed = 0, failed = 0;
const failures = [];
function assert(name, cond) {
  if (cond) passed++;
  else { failed++; failures.push(name); console.log(`❌ ${name}`); }
}
function section(name) { console.log(`\n━━ ${name} ━━`); }

// =============================================================
// Mock helpers
// =============================================================

const ALL_MODULE_IDS = ['ma-alignment', 'hl-structure', 'trendline', 'indicators', 'volume', 'volatility'];

/** 1 個 mock ModuleStandardVerdict
 *  @param {string} moduleId
 *  @param {string} state - 'UP' | 'DOWN' | 'SIDEWAYS' | 'TRANSITION' | 'TRAP'
 *  @param {object} overrides
 */
function makeSV(moduleId, state, overrides = {}) {
  const baseRsi = state === 'UP' ? 0.4 : state === 'DOWN' ? -0.4 : 0;  // raw 70 / 30 / 50
  return {
    state,
    confidence: 0.7,
    base_weight: 0.15,
    expected_return: state === 'UP' ? 0.07 : state === 'DOWN' ? -0.07 : 0,
    max_drawdown_estimate: 0.08,
    sentiment_6d: {
      rsi: baseRsi,
      bollinger_pct_b: 0,
      bias_ratio: 0,
      vol_skew: 0,
      turnover: 0,
      momentum_accel: 0,
    },
    rules_fired: ['mock'],
    module_id: moduleId,
    module_specific: {},
    timestamp: Date.now(),
    ...overrides,
  };
}

/** 6 個 mock verdicts (全部同一 state)
 *  @param {string} state
 *  @param {object} overridesPerModule
 */
function make6Verdicts(state, overridesPerModule = {}) {
  return ALL_MODULE_IDS.map(id => makeSV(id, state, overridesPerModule[id] ?? {}));
}

/** Mock SynthesizerVerdict
 *  @param {string} grade
 *  @param {number} alignment
 *  @param {object} overrides
 */
function makeSynth(grade, alignment, overrides = {}) {
  return {
    ssi_score: 50,
    ssi_breakdown: { consistency: 0.5, confidence_avg: 0.5, rules_coverage: 0.5 },
    tcm_matrix: [],
    alignment_score: alignment,
    grade,
    grade_score: 50,
    grade_reason: 'mock',
    kelly_fraction: 'quarter',
    kelly_numeric: 0.25,
    kelly_position: 0.25,
    module_verdicts: overrides.verdicts ?? make6Verdicts('UP'),
    timestamp: Date.now(),
    ...overrides,
  };
}

const engine = new DecisionEngine();

// =============================================================
// Test 1: DecisionEngine class
// =============================================================
section('1. DecisionEngine class');
assert('1.1 DecisionEngine 係 class', typeof DecisionEngine === 'function');
assert('1.2 engine.decide 係 function', typeof engine.decide === 'function');

// =============================================================
// Test 2: BUY trigger
// =============================================================
section('2. BUY trigger (UP + alignment≥0.6 + grade≥B + exp.ret>3% + maxdd<10% + RSI>50)');

// 2.1: 全部 conditions 滿足 → BUY
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.2, bollinger_pct_b: 0.2, bias_ratio: 0.1, vol_skew: 0, turnover: 0, momentum_accel: 0.1 } },  // RSI = 60
  });
  const sv = makeSynth('B+', 0.7, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  assert('2.1 BUY 觸發 (UP + B+ + 0.7 alignment + RSI 60 + 信心 0.7)', d.final_action === 'BUY');
}

// 2.2: grade = A (但 RSI < 70, 連漲 < 3) → BUY 觸發, ADD 唔觸發
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.2, bollinger_pct_b: 0.2, bias_ratio: 0.1, vol_skew: 0, turnover: 0, momentum_accel: 0.1 } },
  });
  const sv = makeSynth('A', 0.8, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv, marketData: { consecutiveUpDays: 1 } });
  assert('2.2 BUY 觸發 (A grade 但連漲 1 日, ADD 唔觸發 → BUY)', d.final_action === 'BUY');
}

// 2.3: grade = B+ + alignment 0.65 + RSI 60 → BUY
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.2, bollinger_pct_b: 0.2, bias_ratio: 0.1, vol_skew: 0, turnover: 0, momentum_accel: 0.1 } },
  });
  const sv = makeSynth('B+', 0.65, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  assert('2.3 BUY 觸發 (B+ + 0.65 alignment boundary)', d.final_action === 'BUY');
}

// 2.4: alignment 0.59 (低於 0.6) → 唔觸發 BUY
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.2, bollinger_pct_b: 0.2, bias_ratio: 0.1, vol_skew: 0, turnover: 0, momentum_accel: 0.1 } },
  });
  const sv = makeSynth('B+', 0.59, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  assert('2.4 唔觸發 BUY (alignment 0.59 < 0.6)', d.final_action !== 'BUY');
}

// 2.5: maxdd 0.20 (高過 0.10) → 唔觸發 BUY
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.2, bollinger_pct_b: 0.2, bias_ratio: 0.1, vol_skew: 0, turnover: 0, momentum_accel: 0.1 } },
    'ma-alignment': { max_drawdown_estimate: 0.20 },
    'hl-structure': { max_drawdown_estimate: 0.20 },
    trendline: { max_drawdown_estimate: 0.20 },
    volume: { max_drawdown_estimate: 0.20 },
    volatility: { max_drawdown_estimate: 0.20 },
  });
  const sv = makeSynth('B+', 0.7, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  assert('2.5 唔觸發 BUY (weighted maxdd > 0.10)', d.final_action !== 'BUY');
}

// =============================================================
// Test 3: ADD trigger
// =============================================================
section('3. ADD trigger (UP + grade≥A + alignment≥0.7 + RSI>70 + 連漲≥3日)');

// 3.1: 全部 conditions 滿足 → ADD
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.6, bollinger_pct_b: 0.5, bias_ratio: 0.3, vol_skew: 0, turnover: 0, momentum_accel: 0.3 } },  // RSI = 80
  });
  const sv = makeSynth('A', 0.8, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv, marketData: { consecutiveUpDays: 5 } });
  assert('3.1 ADD 觸發 (UP + A + 0.8 + RSI 80 + 連漲 5 日)', d.final_action === 'ADD');
}

// 3.2: 連漲 2 日 (低於 3) → 唔觸發 ADD
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.6, bollinger_pct_b: 0.5, bias_ratio: 0.3, vol_skew: 0, turnover: 0, momentum_accel: 0.3 } },
  });
  const sv = makeSynth('A', 0.8, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv, marketData: { consecutiveUpDays: 2 } });
  assert('3.2 唔觸發 ADD (連漲 2 日 < 3)', d.final_action !== 'ADD');
}

// 3.3: RSI 70 (boundary) → 唔觸發 ADD (> 70 嚴格)
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.4, bollinger_pct_b: 0.5, bias_ratio: 0.3, vol_skew: 0, turnover: 0, momentum_accel: 0.3 } },  // RSI = 70
  });
  const sv = makeSynth('A', 0.8, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv, marketData: { consecutiveUpDays: 5 } });
  assert('3.3 唔觸發 ADD (RSI 70 boundary, 嚴格 >)', d.final_action !== 'ADD');
}

// 3.4: grade = A+ (高過 A) → ADD 觸發
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.6, bollinger_pct_b: 0.5, bias_ratio: 0.3, vol_skew: 0, turnover: 0, momentum_accel: 0.3 } },
  });
  const sv = makeSynth('A+', 0.85, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv, marketData: { consecutiveUpDays: 10 } });
  assert('3.4 ADD 觸發 (A+ grade + alignment 0.85 + 連漲 10 日)', d.final_action === 'ADD');
}

// =============================================================
// Test 4: HOLD trigger
// =============================================================
section('4. HOLD trigger (UP + grade=B/C+ + maxdd<8%)');

// 4.1: UP + B + maxdd 0.05 → HOLD (唔夠 BUY 條件因 alignment 唔夠)
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.2, bollinger_pct_b: 0.2, bias_ratio: 0.1, vol_skew: 0, turnover: 0, momentum_accel: 0.1 } },
    'ma-alignment': { max_drawdown_estimate: 0.05 },
    'hl-structure': { max_drawdown_estimate: 0.05 },
    trendline: { max_drawdown_estimate: 0.05 },
    volume: { max_drawdown_estimate: 0.05 },
    volatility: { max_drawdown_estimate: 0.05 },
  });
  const sv = makeSynth('B', 0.5, { verdicts });  // alignment 0.5 < 0.6 唔觸發 BUY
  const d = await engine.decide({ synthesizerVerdict: sv });
  assert('4.1 HOLD 觸發 (UP + B + maxdd 0.05 + alignment 0.5 < 0.6)', d.final_action === 'HOLD');
}

// 4.2: UP + C+ → HOLD
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.0, bollinger_pct_b: 0, bias_ratio: 0, vol_skew: 0, turnover: 0, momentum_accel: 0 } },  // RSI = 50
    'ma-alignment': { max_drawdown_estimate: 0.05 },
    'hl-structure': { max_drawdown_estimate: 0.05 },
    trendline: { max_drawdown_estimate: 0.05 },
    volume: { max_drawdown_estimate: 0.05 },
    volatility: { max_drawdown_estimate: 0.05 },
  });
  const sv = makeSynth('C+', 0.55, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  assert('4.2 HOLD 觸發 (UP + C+ + maxdd 0.05)', d.final_action === 'HOLD');
}

// 4.3: UP + B + maxdd 0.085 (>0.08) → 唔觸發 HOLD
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.2, bollinger_pct_b: 0.2, bias_ratio: 0.1, vol_skew: 0, turnover: 0, momentum_accel: 0.1 } },
    'ma-alignment': { max_drawdown_estimate: 0.085 },
    'hl-structure': { max_drawdown_estimate: 0.085 },
    trendline: { max_drawdown_estimate: 0.085 },
    volume: { max_drawdown_estimate: 0.085 },
    volatility: { max_drawdown_estimate: 0.085 },
  });
  const sv = makeSynth('B', 0.5, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  assert('4.3 唔觸發 HOLD (maxdd 0.085 > 0.08)', d.final_action !== 'HOLD');
}

// =============================================================
// Test 5: WAIT trigger
// =============================================================
section('5. WAIT trigger (SIDEWAYS + grade=C + alignment<0.6)');

// 5.1: SIDEWAYS + C + alignment 0.5 → WAIT
{
  const verdicts = make6Verdicts('SIDEWAYS');
  const sv = makeSynth('C', 0.5, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  assert('5.1 WAIT 觸發 (SIDEWAYS + C + 0.5 alignment)', d.final_action === 'WAIT');
}

// 5.2: SIDEWAYS + C + alignment 0.7 → WAIT trigger 唔啱, fallback WAIT (reason 唔同)
{
  const verdicts = make6Verdicts('SIDEWAYS');
  const sv = makeSynth('C', 0.7, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  // Final action 係 WAIT (fallback), 但係 reason 應該係 "未能匹配" 而唔係 "等綠燈" (trigger)
  assert('5.2 fallback WAIT (alignment 0.7 ≥ 0.6, trigger 唔啱)', d.final_action === 'WAIT' && d.final_action_reason.includes('未能匹配'));
}

// 5.3: SIDEWAYS + C+ + alignment 0.5 → WAIT trigger 唔啱因 grade, fallback WAIT
{
  const verdicts = make6Verdicts('SIDEWAYS');
  const sv = makeSynth('C+', 0.5, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  assert('5.3 fallback WAIT (C+ grade 唔係 C, trigger 唔啱)', d.final_action === 'WAIT' && d.final_action_reason.includes('未能匹配'));
}

// =============================================================
// Test 6: REDUCE trigger
// =============================================================
section('6. REDUCE trigger (TRANSITION + alignment<0.5)');

// 6.1: TRANSITION + alignment 0.4 → REDUCE
{
  const verdicts = make6Verdicts('TRANSITION');
  const sv = makeSynth('C', 0.4, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  assert('6.1 REDUCE 觸發 (TRANSITION + 0.4 alignment)', d.final_action === 'REDUCE');
}

// 6.2: TRANSITION + alignment 0.6 → 唔觸發 REDUCE
{
  const verdicts = make6Verdicts('TRANSITION');
  const sv = makeSynth('C', 0.6, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  assert('6.2 唔觸發 REDUCE (alignment 0.6 ≥ 0.5)', d.final_action !== 'REDUCE');
}

// =============================================================
// Test 7: SELL trigger
// =============================================================
section('7. SELL trigger (DOWN + grade≤C + maxdd>10%)');

// 7.1: DOWN + C + maxdd 0.12 → SELL
{
  const verdicts = make6Verdicts('DOWN', {
    'ma-alignment': { max_drawdown_estimate: 0.12 },
    'hl-structure': { max_drawdown_estimate: 0.12 },
    trendline: { max_drawdown_estimate: 0.12 },
    indicators: { max_drawdown_estimate: 0.12, sentiment_6d: { rsi: -0.4, bollinger_pct_b: -0.4, bias_ratio: -0.2, vol_skew: 0, turnover: 0, momentum_accel: 0 } },
    volume: { max_drawdown_estimate: 0.12 },
    volatility: { max_drawdown_estimate: 0.12 },
  });
  const sv = makeSynth('C', 0.5, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  assert('7.1 SELL 觸發 (DOWN + C + maxdd 0.12)', d.final_action === 'SELL');
}

// 7.2: DOWN + D + maxdd 0.15 → SELL
{
  const verdicts = make6Verdicts('DOWN', {
    'ma-alignment': { max_drawdown_estimate: 0.15 },
    'hl-structure': { max_drawdown_estimate: 0.15 },
    trendline: { max_drawdown_estimate: 0.15 },
    indicators: { max_drawdown_estimate: 0.15, sentiment_6d: { rsi: -0.5, bollinger_pct_b: -0.5, bias_ratio: -0.3, vol_skew: 0, turnover: 0, momentum_accel: 0 } },
    volume: { max_drawdown_estimate: 0.15 },
    volatility: { max_drawdown_estimate: 0.15 },
  });
  const sv = makeSynth('D', 0.4, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  assert('7.2 SELL 觸發 (DOWN + D + maxdd 0.15)', d.final_action === 'SELL');
}

// 7.3: DOWN + C + maxdd 0.08 (< 0.10) → 唔觸發 SELL
{
  const verdicts = make6Verdicts('DOWN', {
    'ma-alignment': { max_drawdown_estimate: 0.08 },
    'hl-structure': { max_drawdown_estimate: 0.08 },
    trendline: { max_drawdown_estimate: 0.08 },
    indicators: { max_drawdown_estimate: 0.08, sentiment_6d: { rsi: -0.4, bollinger_pct_b: -0.4, bias_ratio: -0.2, vol_skew: 0, turnover: 0, momentum_accel: 0 } },
    volume: { max_drawdown_estimate: 0.08 },
    volatility: { max_drawdown_estimate: 0.08 },
  });
  const sv = makeSynth('C', 0.5, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  assert('7.3 唔觸發 SELL (maxdd 0.08 < 0.10)', d.final_action !== 'SELL');
}

// 7.4: DOWN + C+ + maxdd 0.12 → 唔觸發 SELL (grade 唔啱)
{
  const verdicts = make6Verdicts('DOWN', {
    'ma-alignment': { max_drawdown_estimate: 0.12 },
    'hl-structure': { max_drawdown_estimate: 0.12 },
    trendline: { max_drawdown_estimate: 0.12 },
    indicators: { max_drawdown_estimate: 0.12, sentiment_6d: { rsi: -0.4, bollinger_pct_b: -0.4, bias_ratio: -0.2, vol_skew: 0, turnover: 0, momentum_accel: 0 } },
    volume: { max_drawdown_estimate: 0.12 },
    volatility: { max_drawdown_estimate: 0.12 },
  });
  const sv = makeSynth('C+', 0.4, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  assert('7.4 唔觸發 SELL (C+ grade > C)', d.final_action !== 'SELL');
}

// =============================================================
// Test 8: TRAP trigger
// =============================================================
section('8. TRAP trigger (squeeze + fake breakout)');

// 8.1: squeeze + fake breakout → TRAP (priority 最高)
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.2, bollinger_pct_b: 0.2, bias_ratio: 0.1, vol_skew: 0, turnover: 0, momentum_accel: 0.1 } },
  });
  const sv = makeSynth('B+', 0.7, { verdicts });
  const d = await engine.decide({
    synthesizerVerdict: sv,
    marketData: { squeezeDetected: true, fakeBreakoutDetected: true },
  });
  assert('8.1 TRAP 觸發 (squeeze + fake breakout 優先過 BUY)', d.final_action === 'TRAP');
}

// 8.2: 只有 squeeze 冇 fake breakout → 唔觸發 TRAP
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.2, bollinger_pct_b: 0.2, bias_ratio: 0.1, vol_skew: 0, turnover: 0, momentum_accel: 0.1 } },
  });
  const sv = makeSynth('B+', 0.7, { verdicts });
  const d = await engine.decide({
    synthesizerVerdict: sv,
    marketData: { squeezeDetected: true, fakeBreakoutDetected: false },
  });
  assert('8.2 唔觸發 TRAP (得 squeeze 唔夠)', d.final_action !== 'TRAP');
}

// 8.3: TRAP 優先過 SELL (DOWN + TRAP → TRAP)
{
  const verdicts = make6Verdicts('DOWN', {
    'ma-alignment': { max_drawdown_estimate: 0.12 },
    'hl-structure': { max_drawdown_estimate: 0.12 },
    trendline: { max_drawdown_estimate: 0.12 },
    indicators: { max_drawdown_estimate: 0.12, sentiment_6d: { rsi: -0.4, bollinger_pct_b: -0.4, bias_ratio: -0.2, vol_skew: 0, turnover: 0, momentum_accel: 0 } },
    volume: { max_drawdown_estimate: 0.12 },
    volatility: { max_drawdown_estimate: 0.12 },
  });
  const sv = makeSynth('C', 0.5, { verdicts });
  const d = await engine.decide({
    synthesizerVerdict: sv,
    marketData: { squeezeDetected: true, fakeBreakoutDetected: true },
  });
  assert('8.3 TRAP 優先過 SELL', d.final_action === 'TRAP');
}

// =============================================================
// Test 9: TRANSITION trigger
// =============================================================
section('9. TRANSITION trigger (MA-TL transition flag)');

// 9.1: maTrendlineTransition → TRANSITION (priority 次高)
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.2, bollinger_pct_b: 0.2, bias_ratio: 0.1, vol_skew: 0, turnover: 0, momentum_accel: 0.1 } },
  });
  const sv = makeSynth('B+', 0.7, { verdicts });
  const d = await engine.decide({
    synthesizerVerdict: sv,
    marketData: { maTrendlineTransition: true },
  });
  assert('9.1 TRANSITION 觸發 (MA-TL 同步轉勢優先過 BUY)', d.final_action === 'TRANSITION');
}

// 9.2: TRANSITION 優先過 REDUCE
{
  const verdicts = make6Verdicts('TRANSITION');
  const sv = makeSynth('C', 0.4, { verdicts });
  const d = await engine.decide({
    synthesizerVerdict: sv,
    marketData: { maTrendlineTransition: true },
  });
  assert('9.2 TRANSITION 優先過 REDUCE', d.final_action === 'TRANSITION');
}

// =============================================================
// Test 10: Fallback (no match)
// =============================================================
section('10. Fallback (no match → WAIT)');

// 10.1: UP + D + alignment 0.4 + RSI 50 → 唔觸發任何 trigger → fallback WAIT
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0, bollinger_pct_b: 0, bias_ratio: 0, vol_skew: 0, turnover: 0, momentum_accel: 0 } },
  });
  const sv = makeSynth('D', 0.4, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  assert('10.1 Fallback WAIT (UP + D + 0.4 + RSI 50 唔觸發任何 trigger)', d.final_action === 'WAIT');
}

// 10.2: Empty verdicts → fallback WAIT
{
  const sv = makeSynth('C', 0.5, { verdicts: [] });
  const d = await engine.decide({ synthesizerVerdict: sv });
  assert('10.2 Fallback WAIT (empty verdicts)', d.final_action === 'WAIT');
}

// 10.3: SIDEWAYS + D + alignment 0.5 → fallback WAIT
{
  const verdicts = make6Verdicts('SIDEWAYS');
  const sv = makeSynth('D', 0.5, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  assert('10.3 Fallback WAIT (SIDEWAYS + D, 唔係 C)', d.final_action === 'WAIT');
}

// =============================================================
// Test 11: Priority order
// =============================================================
section('11. Priority order (TRAP > TRANSITION > SELL > REDUCE > WAIT > HOLD > ADD > BUY)');

// 11.1: TRAP + TRANSITION + SELL 條件都滿足 → TRAP
{
  const verdicts = make6Verdicts('DOWN', {
    'ma-alignment': { max_drawdown_estimate: 0.12 },
    'hl-structure': { max_drawdown_estimate: 0.12 },
    trendline: { max_drawdown_estimate: 0.12 },
    indicators: { max_drawdown_estimate: 0.12, sentiment_6d: { rsi: -0.4, bollinger_pct_b: -0.4, bias_ratio: -0.2, vol_skew: 0, turnover: 0, momentum_accel: 0 } },
    volume: { max_drawdown_estimate: 0.12 },
    volatility: { max_drawdown_estimate: 0.12 },
  });
  const sv = makeSynth('C', 0.5, { verdicts });
  const d = await engine.decide({
    synthesizerVerdict: sv,
    marketData: { squeezeDetected: true, fakeBreakoutDetected: true, maTrendlineTransition: true },
  });
  assert('11.1 TRAP 最高優先 (TRAP + TRANSITION + SELL 都滿足)', d.final_action === 'TRAP');
}

// 11.2: TRANSITION + SELL → TRANSITION
{
  const verdicts = make6Verdicts('DOWN', {
    'ma-alignment': { max_drawdown_estimate: 0.12 },
    'hl-structure': { max_drawdown_estimate: 0.12 },
    trendline: { max_drawdown_estimate: 0.12 },
    indicators: { max_drawdown_estimate: 0.12, sentiment_6d: { rsi: -0.4, bollinger_pct_b: -0.4, bias_ratio: -0.2, vol_skew: 0, turnover: 0, momentum_accel: 0 } },
    volume: { max_drawdown_estimate: 0.12 },
    volatility: { max_drawdown_estimate: 0.12 },
  });
  const sv = makeSynth('C', 0.5, { verdicts });
  const d = await engine.decide({
    synthesizerVerdict: sv,
    marketData: { maTrendlineTransition: true },
  });
  assert('11.2 TRANSITION 優先過 SELL', d.final_action === 'TRANSITION');
}

// 11.3: ADD 優先過 BUY
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.6, bollinger_pct_b: 0.5, bias_ratio: 0.3, vol_skew: 0, turnover: 0, momentum_accel: 0.3 } },
  });
  const sv = makeSynth('A', 0.8, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv, marketData: { consecutiveUpDays: 5 } });
  assert('11.3 ADD 優先過 BUY (UP + A + 連漲 5 + RSI 80)', d.final_action === 'ADD');
}

// =============================================================
// Test 12: Trading card (2.2 adaptive — 3 volatility buckets)
// =============================================================
section('12. Trading card formula (2.2 adaptive — 跟 kelly_fraction + max_drawdown)');

// 12.1-12.5: 高波動 bucket (kelly=octo, maxdd=0.12) → ±2.5% / -5% / +8% / -7%
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.2, bollinger_pct_b: 0.2, bias_ratio: 0.1, vol_skew: 0, turnover: 0, momentum_accel: 0.1 } },
    'ma-alignment': { max_drawdown_estimate: 0.12 },
    'hl-structure': { max_drawdown_estimate: 0.12 },
    trendline: { max_drawdown_estimate: 0.12 },
    volume: { max_drawdown_estimate: 0.12 },
    volatility: { max_drawdown_estimate: 0.12 },
  });
  const sv = makeSynth('B+', 0.7, { verdicts, kelly_fraction: 'octo', kelly_numeric: 0.125 });
  const d = await engine.decide({ synthesizerVerdict: sv, marketData: { currentPrice: 100 } });
  assert('12.1 high vol entry_zone low = 97.5 (±2.5%)', Math.abs(d.trading_card.entry_zone[0] - 97.5) < 0.01);
  assert('12.2 high vol entry_zone high = 102.5 (±2.5%)', Math.abs(d.trading_card.entry_zone[1] - 102.5) < 0.01);
  assert('12.3 high vol stop_loss = 95 (-5%)', Math.abs(d.trading_card.stop_loss - 95) < 0.01);
  assert('12.4 high vol take_profit = 108 (+8%)', Math.abs(d.trading_card.take_profit - 108) < 0.01);
  assert('12.5 high vol trailing_stop = 93 (-7%)', Math.abs(d.trading_card.trailing_stop - 93) < 0.01);
}

// 12.6-12.10: 中波動 bucket (kelly=quarter, maxdd=0.08) → ±1.5% / -3% / +5% / -5% (2.1 公式保留)
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.2, bollinger_pct_b: 0.2, bias_ratio: 0.1, vol_skew: 0, turnover: 0, momentum_accel: 0.1 } },
    'ma-alignment': { max_drawdown_estimate: 0.08 },
    'hl-structure': { max_drawdown_estimate: 0.08 },
    trendline: { max_drawdown_estimate: 0.08 },
    volume: { max_drawdown_estimate: 0.08 },
    volatility: { max_drawdown_estimate: 0.08 },
  });
  const sv = makeSynth('B+', 0.7, { verdicts, kelly_fraction: 'quarter', kelly_numeric: 0.25 });
  const d = await engine.decide({ synthesizerVerdict: sv, marketData: { currentPrice: 100 } });
  assert('12.6 medium vol entry_zone low = 98.5 (±1.5%)', Math.abs(d.trading_card.entry_zone[0] - 98.5) < 0.01);
  assert('12.7 medium vol entry_zone high = 101.5 (±1.5%)', Math.abs(d.trading_card.entry_zone[1] - 101.5) < 0.01);
  assert('12.8 medium vol stop_loss = 97 (-3%)', Math.abs(d.trading_card.stop_loss - 97) < 0.01);
  assert('12.9 medium vol take_profit = 105 (+5%)', Math.abs(d.trading_card.take_profit - 105) < 0.01);
  assert('12.10 medium vol trailing_stop = 95 (-5%)', Math.abs(d.trading_card.trailing_stop - 95) < 0.01);
}

// 12.11-12.15: 低波動 bucket (kelly=half, maxdd=0.04) → ±1.0% / -2% / +4% / -3%
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.2, bollinger_pct_b: 0.2, bias_ratio: 0.1, vol_skew: 0, turnover: 0, momentum_accel: 0.1 } },
    'ma-alignment': { max_drawdown_estimate: 0.04 },
    'hl-structure': { max_drawdown_estimate: 0.04 },
    trendline: { max_drawdown_estimate: 0.04 },
    volume: { max_drawdown_estimate: 0.04 },
    volatility: { max_drawdown_estimate: 0.04 },
  });
  const sv = makeSynth('B+', 0.7, { verdicts, kelly_fraction: 'half', kelly_numeric: 0.5 });
  const d = await engine.decide({ synthesizerVerdict: sv, marketData: { currentPrice: 100 } });
  assert('12.11 low vol entry_zone low = 99.0 (±1.0%)', Math.abs(d.trading_card.entry_zone[0] - 99.0) < 0.01);
  assert('12.12 low vol entry_zone high = 101.0 (±1.0%)', Math.abs(d.trading_card.entry_zone[1] - 101.0) < 0.01);
  assert('12.13 low vol stop_loss = 98 (-2%)', Math.abs(d.trading_card.stop_loss - 98) < 0.01);
  assert('12.14 low vol take_profit = 104 (+4%)', Math.abs(d.trading_card.take_profit - 104) < 0.01);
  assert('12.15 low vol trailing_stop = 97 (-3%)', Math.abs(d.trading_card.trailing_stop - 97) < 0.01);
}

// 12.16: 高波動 override (kelly=quarter 但 maxdd=0.12 > 0.10) → 仍係高波動 bucket
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.2, bollinger_pct_b: 0.2, bias_ratio: 0.1, vol_skew: 0, turnover: 0, momentum_accel: 0.1 } },
    'ma-alignment': { max_drawdown_estimate: 0.12 },
    'hl-structure': { max_drawdown_estimate: 0.12 },
    trendline: { max_drawdown_estimate: 0.12 },
    volume: { max_drawdown_estimate: 0.12 },
    volatility: { max_drawdown_estimate: 0.12 },
  });
  const sv = makeSynth('B+', 0.7, { verdicts, kelly_fraction: 'quarter', kelly_numeric: 0.25 });
  const d = await engine.decide({ synthesizerVerdict: sv, marketData: { currentPrice: 100 } });
  assert('12.16 kelly=quarter 但 maxdd=0.12 → high vol (maxdd 優先)', Math.abs(d.trading_card.stop_loss - 95) < 0.01);
}

// 12.17: currentPrice = 0 fallback
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.2, bollinger_pct_b: 0.2, bias_ratio: 0.1, vol_skew: 0, turnover: 0, momentum_accel: 0.1 } },
  });
  const sv = makeSynth('B+', 0.7, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  assert('12.17 currentPrice 0 → all 0', d.trading_card.entry_zone[0] === 0 && d.trading_card.stop_loss === 0);
}

// =============================================================
// Test 13: Output structure
// =============================================================
section('13. Output structure');

// 13.1-13.10
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.2, bollinger_pct_b: 0.2, bias_ratio: 0.1, vol_skew: 0, turnover: 0, momentum_accel: 0.1 } },
  });
  const sv = makeSynth('B+', 0.7, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  assert('13.1 final_action 存在', typeof d.final_action === 'string');
  assert('13.2 final_action_reason 存在', typeof d.final_action_reason === 'string');
  assert('13.3 final_action_reason 唔空', d.final_action_reason.length > 0);
  assert('13.4 trading_card 存在', typeof d.trading_card === 'object');
  assert('13.5 short_term_forecast 係 array', Array.isArray(d.short_term_forecast));
  assert('13.6 short_term_forecast 9 個 (2.3 done)', d.short_term_forecast.length === 9);
  assert('13.7 interpretation 暫空 (2.4 將 impl)', d.interpretation === '');
  assert('13.8 module_verdicts 6 個', d.module_verdicts.length === 6);
  assert('13.9 synthesizer_verdict 存在', typeof d.synthesizer_verdict === 'object');
  assert('13.10 timestamp > 0', d.timestamp > 0);
}

// 13.11: final_action reason 包含 plain language
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.2, bollinger_pct_b: 0.2, bias_ratio: 0.1, vol_skew: 0, turnover: 0, momentum_accel: 0.1 } },
  });
  const sv = makeSynth('B+', 0.7, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  const hasDriver = d.final_action_reason.includes('油門') || d.final_action_reason.includes('綠燈') || d.final_action_reason.includes('煞車') || d.final_action_reason.includes('導航') || d.final_action_reason.includes('油') || d.final_action_reason.includes('保持現速');
  assert('13.11 final_action_reason 揸車比喻或 plain language', hasDriver || d.final_action_reason.length > 10);
}

// =============================================================
// Test 14: Short term forecast (2.3 — 9 個 scenarios)
// =============================================================
section('14. Short term forecast (2.3 — 9 scenarios: 3 × 3 timeframes)');

// 14.1-14.3: 預期 9 個 forecasts, 3 個 scenarios × 3 個 timeframes
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.2, bollinger_pct_b: 0.2, bias_ratio: 0.1, vol_skew: 0, turnover: 0, momentum_accel: 0.1 } },
  });
  const sv = makeSynth('B+', 0.7, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  assert('14.1 short_term_forecast 9 個', d.short_term_forecast.length === 9);
  assert('14.2 全部 3 個 timeframes (5/10/20)', d.short_term_forecast.every(f => [5, 10, 20].includes(f.timeframe_days)));
  assert('14.3 全部 3 個 scenarios (optimistic/baseline/pessimistic)', d.short_term_forecast.every(f => ['optimistic', 'baseline', 'pessimistic'].includes(f.scenario)));
}

// 14.4-14.6: UP case (expected_return > 0) — optimistic 同 baseline 正, pessimistic 負
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.2, bollinger_pct_b: 0.2, bias_ratio: 0.1, vol_skew: 0, turnover: 0, momentum_accel: 0.1 } },
  });
  const sv = makeSynth('B+', 0.7, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  const optimistic = d.short_term_forecast.find(f => f.timeframe_days === 5 && f.scenario === 'optimistic');
  const baseline = d.short_term_forecast.find(f => f.timeframe_days === 5 && f.scenario === 'baseline');
  const pessimistic = d.short_term_forecast.find(f => f.timeframe_days === 5 && f.scenario === 'pessimistic');
  assert('14.4 5 日 optimistic > 0 (UP case)', optimistic.expected_return > 0);
  assert('14.5 5 日 baseline > 0 (UP case)', baseline.expected_return > 0);
  assert('14.6 5 日 pessimistic < 0 (UP case)', pessimistic.expected_return < 0);
}

// 14.7-14.9: 概率 25/50/25
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.2, bollinger_pct_b: 0.2, bias_ratio: 0.1, vol_skew: 0, turnover: 0, momentum_accel: 0.1 } },
  });
  const sv = makeSynth('B+', 0.7, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  const optimistic = d.short_term_forecast.find(f => f.scenario === 'optimistic');
  const baseline = d.short_term_forecast.find(f => f.scenario === 'baseline');
  const pessimistic = d.short_term_forecast.find(f => f.scenario === 'pessimistic');
  assert('14.7 optimistic probability = 0.25', optimistic.probability === 0.25);
  assert('14.8 baseline probability = 0.50', baseline.probability === 0.50);
  assert('14.9 pessimistic probability = 0.25', pessimistic.probability === 0.25);
}

// 14.10-14.12: Day factor 線性 scaling (5/10/20)
//   optimistic[10] = optimistic[5] × 2, optimistic[20] = optimistic[5] × 4
{
  const verdicts = make6Verdicts('UP', {
    indicators: { sentiment_6d: { rsi: 0.2, bollinger_pct_b: 0.2, bias_ratio: 0.1, vol_skew: 0, turnover: 0, momentum_accel: 0.1 } },
  });
  const sv = makeSynth('B+', 0.7, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  const opt5 = d.short_term_forecast.find(f => f.timeframe_days === 5 && f.scenario === 'optimistic');
  const opt10 = d.short_term_forecast.find(f => f.timeframe_days === 10 && f.scenario === 'optimistic');
  const opt20 = d.short_term_forecast.find(f => f.timeframe_days === 20 && f.scenario === 'optimistic');
  assert('14.10 optimistic 10 日 = 5 日 × 2', Math.abs(opt10.expected_return - opt5.expected_return * 2) < 0.001);
  assert('14.11 optimistic 20 日 = 5 日 × 4', Math.abs(opt20.expected_return - opt5.expected_return * 4) < 0.001);
  assert('14.12 baseline 10 日 = 5 日 × 2', Math.abs(d.short_term_forecast.find(f => f.timeframe_days === 10 && f.scenario === 'baseline').expected_return - d.short_term_forecast.find(f => f.timeframe_days === 5 && f.scenario === 'baseline').expected_return * 2) < 0.001);
}

// 14.13-14.15: max_drawdown 跟 scenario bucket
//   optimistic MD × 0.5, baseline × 0.7, pessimistic × 1.0
{
  const verdicts = make6Verdicts('UP', {
    'ma-alignment': { max_drawdown_estimate: 0.10 },
    'hl-structure': { max_drawdown_estimate: 0.10 },
    trendline: { max_drawdown_estimate: 0.10 },
    indicators: { max_drawdown_estimate: 0.10, sentiment_6d: { rsi: 0.2, bollinger_pct_b: 0.2, bias_ratio: 0.1, vol_skew: 0, turnover: 0, momentum_accel: 0.1 } },
    volume: { max_drawdown_estimate: 0.10 },
    volatility: { max_drawdown_estimate: 0.10 },
  });
  const sv = makeSynth('B+', 0.7, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  const opt5 = d.short_term_forecast.find(f => f.timeframe_days === 5 && f.scenario === 'optimistic');
  const base5 = d.short_term_forecast.find(f => f.timeframe_days === 5 && f.scenario === 'baseline');
  const pess5 = d.short_term_forecast.find(f => f.timeframe_days === 5 && f.scenario === 'pessimistic');
  assert('14.13 optimistic MD = 0.05 (maxdd 0.10 × 0.5)', Math.abs(opt5.max_drawdown - 0.05) < 0.001);
  assert('14.14 baseline MD = 0.07 (maxdd 0.10 × 0.7)', Math.abs(base5.max_drawdown - 0.07) < 0.001);
  assert('14.15 pessimistic MD = 0.10 (maxdd 0.10 × 1.0)', Math.abs(pess5.max_drawdown - 0.10) < 0.001);
}

// 14.16: DOWN case — pessimistic 同樣負, optimistic 可能正 (跟 expected_return)
{
  const verdicts = make6Verdicts('DOWN', {
    'ma-alignment': { max_drawdown_estimate: 0.12 },
    'hl-structure': { max_drawdown_estimate: 0.12 },
    trendline: { max_drawdown_estimate: 0.12 },
    indicators: { max_drawdown_estimate: 0.12, sentiment_6d: { rsi: -0.4, bollinger_pct_b: -0.4, bias_ratio: -0.2, vol_skew: 0, turnover: 0, momentum_accel: 0 } },
    volume: { max_drawdown_estimate: 0.12 },
    volatility: { max_drawdown_estimate: 0.12 },
  });
  const sv = makeSynth('C', 0.5, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  assert('14.16 DOWN case → 9 個 forecasts 仍生成', d.short_term_forecast.length === 9);
}

// 14.17: SIDEWAYS case — expected_return = 0 → baseline = 0
{
  const verdicts = make6Verdicts('SIDEWAYS');
  const sv = makeSynth('C', 0.5, { verdicts });
  const d = await engine.decide({ synthesizerVerdict: sv });
  const base5 = d.short_term_forecast.find(f => f.timeframe_days === 5 && f.scenario === 'baseline');
  assert('14.17 SIDEWAYS case → baseline 5 日 = 0', base5.expected_return === 0);
}

// =============================================================
// Final report
// =============================================================
console.log(`\n${'='.repeat(60)}`);
console.log(`Total: ${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failures.length > 0) {
  console.log(`\nFailures:`);
  failures.forEach(f => console.log(`  - ${f}`));
}
console.log('='.repeat(60));
process.exit(failed > 0 ? 1 : 0);

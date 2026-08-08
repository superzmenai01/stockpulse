// __tests__/decision-engine-demo.test.mjs
//
// 大少 2026-08-08 16:40 — Sprint 2 sub-task 2.7 — 10 隻 demo 股票 test cases
//   5 港股: HK.00700 (騰訊) / HK.09988 (阿里) / HK.03690 (美團) / HK.01024 (快手) / HK.01810 (小米)
//   5 美股: US.AAPL (蘋果) / US.MSFT (微軟) / US.GOOG (谷歌) / US.NVDA (英偉達) / US.TSLA (特斯拉)
//
// Test scope: 10 stocks × 3-5 assertions
//   - 冇 crash (calibrate + decide 都 work)
//   - finalAction 係 8 個之一 (唔係 unknown)
//   - adaptive_params 5 個 fields 全部 valid range
//   - trading_card 4 個 fields 全部 > 0
//   - 短期走勢 9 scenarios 全部生成
//   - interpretation 唔空 + 包含 plain language

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
// Demo stock klines generator — 隨機 walk (seed by symbol 確保 reproducible)
// =============================================================

/** 從 symbol 拎 stable seed (hash)
 */
function hashSymbol(symbol) {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = ((hash << 5) - hash) + symbol.charCodeAt(i);
    hash = hash & hash;  // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/** Seeded random number generator (LCG)
 */
function seededRandom(seed) {
  let state = seed;
  return function() {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

/** Generate 252 個 mock klines (1 年 daily data) for a given symbol
 *  @param {string} symbol — e.g. "HK.00700"
 *  @param {object} options — {startPrice, volatility, drift}
 *  @returns {Array<{timestamp, open, high, low, close, volume}>}
 */
function makeDemoKlines(symbol, options = {}) {
  const {
    startPrice = 100,
    volatility = 0.02,  // 2% daily vol (default 中波動)
    drift = 0.0005,     // slight upward drift
  } = options;
  const seed = hashSymbol(symbol);
  const rand = seededRandom(seed);
  const klines = [];
  let price = startPrice;
  const baseTime = Date.now() - 252 * 24 * 60 * 60 * 1000;
  for (let i = 0; i < 252; i++) {
    const dailyReturn = drift + volatility * (rand() - 0.5) * 2;
    const open = price;
    price = price * (1 + dailyReturn);
    const high = Math.max(open, price) * (1 + rand() * volatility * 0.5);
    const low = Math.min(open, price) * (1 - rand() * volatility * 0.5);
    klines.push({
      timestamp: baseTime + i * 24 * 60 * 60 * 1000,
      open,
      high,
      low,
      close: price,
      volume: 1000000 + Math.floor(rand() * 500000),
    });
  }
  return klines;
}

/** 拎 standard ModuleStandardVerdict 從 makeSV helper
 *  Demo 股票用 mock verdicts (唔跑 6 個 modules, 直接 mock)
 */
function makeDemoVerdicts(symbol, majorityState) {
  // 用 symbol hash 決定 module 嘅 state (stable + deterministic)
  const seed = hashSymbol(symbol);
  const rand = seededRandom(seed);
  const stateChoices = ['UP', 'DOWN', 'SIDEWAYS', 'TRANSITION'];
  const states = stateChoices.map(s => majorityState || s);
  return states.map((state, i) => ({
    state,
    confidence: 0.5 + rand() * 0.5,
    base_weight: 0.10 + i * 0.02,
    expected_return: state === 'UP' ? 0.05 + rand() * 0.05 : state === 'DOWN' ? -0.05 - rand() * 0.05 : 0,
    max_drawdown_estimate: 0.05 + rand() * 0.05,
    sentiment_6d: {
      rsi: state === 'UP' ? 0.3 : state === 'DOWN' ? -0.3 : 0,
      bollinger_pct_b: 0,
      bias_ratio: 0,
      vol_skew: 0,
      turnover: 0,
      momentum_accel: 0,
    },
    rules_fired: ['demo'],
    module_id: ['ma-alignment', 'hl-structure', 'trendline', 'indicators', 'volume', 'volatility'][i],
    module_specific: {},
    timestamp: Date.now(),
  }));
}

function makeDemoSynth(grade, alignment, verdicts) {
  return {
    ssi_score: 50,
    ssi_breakdown: { consistency: 0.5, confidence_avg: 0.5, rules_coverage: 0.5 },
    tcm_matrix: [],
    alignment_score: alignment,
    grade,
    grade_score: 50,
    grade_reason: 'demo',
    kelly_fraction: 'quarter',
    kelly_numeric: 0.25,
    kelly_position: 0.25,
    module_verdicts: verdicts,
    timestamp: Date.now(),
  };
}

const engine = new DecisionEngine();

// =============================================================
// Demo test cases
// =============================================================

const DEMO_STOCKS = [
  // 5 港股 (大少 11:39)
  { symbol: 'HK.00700', name: '騰訊', startPrice: 380, vol: 0.018 },
  { symbol: 'HK.09988', name: '阿里', startPrice: 85, vol: 0.022 },
  { symbol: 'HK.03690', name: '美團', startPrice: 120, vol: 0.025 },
  { symbol: 'HK.01024', name: '快手', startPrice: 50, vol: 0.030 },
  { symbol: 'HK.01810', name: '小米', startPrice: 15, vol: 0.025 },
  // 5 美股
  { symbol: 'US.AAPL', name: '蘋果', startPrice: 175, vol: 0.015 },
  { symbol: 'US.MSFT', name: '微軟', startPrice: 380, vol: 0.013 },
  { symbol: 'US.GOOG', name: '谷歌', startPrice: 140, vol: 0.018 },
  { symbol: 'US.NVDA', name: '英偉達', startPrice: 850, vol: 0.030 },
  { symbol: 'US.TSLA', name: '特斯拉', startPrice: 240, vol: 0.035 },
];

const VALID_FINAL_ACTIONS = ['BUY', 'ADD', 'HOLD', 'REDUCE', 'SELL', 'WAIT', 'TRAP', 'TRANSITION'];

for (const stock of DEMO_STOCKS) {
  section(`${stock.symbol} (${stock.name})`);

  // 17.1: generate 252 mock klines without crash
  let klines;
  try {
    klines = makeDemoKlines(stock.symbol, { startPrice: stock.startPrice, volatility: stock.vol });
    assert(`${stock.symbol}: 252 個 mock klines 生成成功`, klines && klines.length === 252);
  } catch (e) {
    assert(`${stock.symbol}: klines 生成 crash`, false);
    continue;
  }

  // 17.2: klines OHLC 全部 > 0
  const allPositive = klines.every(k => k.open > 0 && k.high > 0 && k.low > 0 && k.close > 0);
  assert(`${stock.symbol}: 所有 OHLC > 0`, allPositive);

  // 17.3: calibrateAdaptiveParams 唔 crash
  let params;
  try {
    const decMod = await import('/Users/zmenai/stockpulse/algorithms/AS-03-cycle-detection/modules/decision-engine.ts');
    params = decMod.calibrateAdaptiveParams(klines, []);
    assert(`${stock.symbol}: calibrateAdaptiveParams 唔 crash`, params && params.ssiWeights);
  } catch (e) {
    assert(`${stock.symbol}: calibrateAdaptiveParams crash`, false);
    continue;
  }

  // 17.4: 5 個 params 全部 valid
  assert(`${stock.symbol}: ssiWeights sum = 1.0`, Math.abs(params.ssiWeights.ma + params.ssiWeights.hl + params.ssiWeights.trendline - 1.0) < 0.01);
  assert(`${stock.symbol}: rsiWeight 0.1-0.5`, params.rsiWeight >= 0.1 && params.rsiWeight <= 0.5);
  assert(`${stock.symbol}: kellyFraction valid`, ['half', 'quarter', 'octo'].includes(params.kellyFraction));
  assert(`${stock.symbol}: markowitzCorr 3 對 範圍 [-1, +1]`, params.markowitzCorr.dailyWeekly >= -1 && params.markowitzCorr.dailyWeekly <= 1 && params.markowitzCorr.dailyMonthly >= -1 && params.markowitzCorr.dailyMonthly <= 1 && params.markowitzCorr.weeklyMonthly >= -1 && params.markowitzCorr.weeklyMonthly <= 1);
  assert(`${stock.symbol}: hurstThresholds 範圍`, params.hurstThresholds.persistent >= 0.5 && params.hurstThresholds.persistent <= 0.6 && params.hurstThresholds.reverting >= 0.4 && params.hurstThresholds.reverting <= 0.5);

  // 17.5: decide() 唔 crash
  let verdict;
  try {
    const verdicts = makeDemoVerdicts(stock.symbol, 'SIDEWAYS');
    const sv = makeDemoSynth('C', 0.5, verdicts);
    verdict = await engine.decide({
      synthesizerVerdict: sv,
      marketData: { currentPrice: stock.startPrice, consecutiveUpDays: 2 },
    });
    assert(`${stock.symbol}: decide() 唔 crash`, verdict && verdict.final_action);
  } catch (e) {
    assert(`${stock.symbol}: decide() crash`, false);
    continue;
  }

  // 17.6: finalAction 8 個之一
  assert(`${stock.symbol}: finalAction 8 個之一 (${verdict.final_action})`, VALID_FINAL_ACTIONS.includes(verdict.final_action));

  // 17.7: trading card 4 個 fields > 0 (因為 currentPrice = startPrice > 0)
  assert(`${stock.symbol}: entry_zone[0] > 0`, verdict.trading_card.entry_zone[0] > 0);
  assert(`${stock.symbol}: entry_zone[1] > 0`, verdict.trading_card.entry_zone[1] > 0);
  assert(`${stock.symbol}: stop_loss > 0`, verdict.trading_card.stop_loss > 0);
  assert(`${stock.symbol}: take_profit > 0`, verdict.trading_card.take_profit > 0);
  assert(`${stock.symbol}: trailing_stop > 0`, verdict.trading_card.trailing_stop > 0);

  // 17.8: trading card entry_zone[0] < entry_zone[1] (low < high)
  assert(`${stock.symbol}: trading card entry_zone low < high`, verdict.trading_card.entry_zone[0] < verdict.trading_card.entry_zone[1]);

  // 17.9: stop_loss < currentPrice < take_profit
  assert(`${stock.symbol}: stop_loss < currentPrice < take_profit`,
    verdict.trading_card.stop_loss < stock.startPrice && stock.startPrice < verdict.trading_card.take_profit);

  // 17.10: 9 個 short_term_forecast
  assert(`${stock.symbol}: 9 個 short_term_forecast`, verdict.short_term_forecast.length === 9);

  // 17.11: interpretation 唔空
  assert(`${stock.symbol}: interpretation 唔空`, verdict.interpretation && verdict.interpretation.length > 0);

  // 17.12: 9 個 forecast probability 總和 (25+50+25) × 3 timeframes = 3.0
  const sumProb = verdict.short_term_forecast.reduce((acc, f) => acc + f.probability, 0);
  assert(`${stock.symbol}: 9 個 forecast probability 總和 = 3.0 (3 scenarios × 3 timeframes × 1.0)`, Math.abs(sumProb - 3.0) < 0.01);
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

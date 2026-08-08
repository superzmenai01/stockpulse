// __tests__/standard-verdict.test.mjs
//
// 大少 2026-08-08 12:00 — Sprint 1 sub-task 1.1
//   6 個 modules (M1-M6) 嘅 toStandardVerdict wrapper + std-verdict.ts helper 嘅 tests
//
// Test scope:
//   - std-verdict.ts 通用 helper (computeSentiment6D, computeExpectedReturn, computeMaxDrawdownEstimate, toStandardVerdict, runAndStandardize)
//   - 6 個 modules 嘅 toStandardVerdict{Module}() wrapper 函數
//
// 用法: node --experimental-strip-types __tests__/standard-verdict.test.mjs

import {
  // std-verdict helpers
  toStandardVerdict, runAndStandardize,
  computeSentiment6D, computeExpectedReturn, computeMaxDrawdownEstimate,
  // 6 個 modules 嘅 wrapper
  toStandardVerdictMA, toStandardVerdictHL, toStandardVerdictTL,
  toStandardVerdictIND, toStandardVerdictVP, toStandardVerdictVOL,
  // constants
  BASE_WEIGHTS,
} from '../index.ts';

// =============================================================
// Test utilities
// =============================================================
let passed = 0, failed = 0;
const failures = [];
function assert(name, cond) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(name);
    console.log(`❌ ${name}`);
  }
}
function section(name) { console.log(`\n━━ ${name} ━━`); }

// =============================================================
// Mock klines fixtures
// =============================================================

/** 上升趨勢 klines (100 日, 價格由 100 升至 130, 漲 30%) */
function makeUptrendKlines(days = 100, start = 100, end = 130) {
  const step = (end - start) / (days - 1);
  return Array.from({ length: days }, (_, i) => {
    const close = start + step * i;
    return {
      timestamp: new Date('2026-01-01').getTime() + i * 86400000,
      open: close - 0.5, high: close + 1, low: close - 1, close,
      volume: 1000000 + i * 1000,
    };
  });
}

/** 下跌趨勢 klines (100 日, 價格由 130 跌至 100) */
function makeDowntrendKlines(days = 100, start = 130, end = 100) {
  return makeUptrendKlines(days, start, end);
}

/** 橫行 klines (100 日, 價格 100 ± 2%) */
function makeSidewaysKlines(days = 100, base = 100) {
  return Array.from({ length: days }, (_, i) => {
    const wobble = (i % 20 < 10 ? +0.02 : -0.02) * base;
    const close = base + wobble;
    return {
      timestamp: new Date('2026-01-01').getTime() + i * 86400000,
      open: close, high: close + 0.5, low: close - 0.5, close,
      volume: 1000000,
    };
  });
}

const ctx = { symbol: 'TEST', ltf: '1d' };

// =============================================================
// Test 1: BASE_WEIGHTS 結構
// =============================================================
section('Test 1: BASE_WEIGHTS');

assert('BASE_WEIGHTS.ma-alignment === 0.25', BASE_WEIGHTS['ma-alignment'] === 0.25);
assert('BASE_WEIGHTS.hl-structure === 0.15', BASE_WEIGHTS['hl-structure'] === 0.15);
assert('BASE_WEIGHTS.trendline === 0.20', BASE_WEIGHTS['trendline'] === 0.20);
assert('BASE_WEIGHTS.indicators === 0.15', BASE_WEIGHTS['indicators'] === 0.15);
assert('BASE_WEIGHTS.volume === 0.15', BASE_WEIGHTS['volume'] === 0.15);
assert('BASE_WEIGHTS.volatility === 0.10', BASE_WEIGHTS['volatility'] === 0.10);
// 6 個 modules 加埋 = 1.00
const sumWeights = Object.values(BASE_WEIGHTS).reduce((a, b) => a + b, 0);
assert('BASE_WEIGHTS 總和 = 1.00', Math.abs(sumWeights - 1.0) < 0.001);

// =============================================================
// Test 2: computeExpectedReturn
// =============================================================
section('Test 2: computeExpectedReturn');

assert('UP + 0.8 conf → +0.08', Math.abs(computeExpectedReturn('UP', 0.8) - 0.08) < 0.0001);
assert('DOWN + 0.8 conf → -0.08', Math.abs(computeExpectedReturn('DOWN', 0.8) + 0.08) < 0.0001);
assert('SIDEWAYS → 0', computeExpectedReturn('SIDEWAYS', 0.8) === 0);
assert('TRANSITION → 0', computeExpectedReturn('TRANSITION', 0.8) === 0);
assert('TRAP → -0.05', computeExpectedReturn('TRAP', 1.0) === -0.05);
assert('UP + 0.0 conf → 0', computeExpectedReturn('UP', 0) === 0);
assert('UP + 1.0 conf → +0.10 (cap)', Math.abs(computeExpectedReturn('UP', 1.0) - 0.10) < 0.0001);
// Confidence > 1 應該 clamp
assert('UP + 2.0 conf → +0.10 (clamp)', Math.abs(computeExpectedReturn('UP', 2.0) - 0.10) < 0.0001);
// Confidence < 0 應該 clamp
assert('UP + -0.5 conf → 0 (clamp)', computeExpectedReturn('UP', -0.5) === 0);

// =============================================================
// Test 3: computeMaxDrawdownEstimate
// =============================================================
section('Test 3: computeMaxDrawdownEstimate');

const klinesFlat = makeSidewaysKlines(50);
const ddFlat = computeMaxDrawdownEstimate(klinesFlat);
assert('Sideways klines 嘅 drawdown 範圍 [0, 0.30]', ddFlat >= 0 && ddFlat <= 0.30);

const klinesEmpty = [];
const ddEmpty = computeMaxDrawdownEstimate(klinesEmpty);
assert('Empty klines → fallback 0.05', ddEmpty === 0.05);

const klinesShort = makeSidewaysKlines(10);
const ddShort = computeMaxDrawdownEstimate(klinesShort);
assert('Short klines (< period) → fallback 0.05', ddShort === 0.05);

// Volatile klines (大波幅)
const klinesVolatile = Array.from({ length: 50 }, (_, i) => {
  const close = 100 + (i % 2 === 0 ? 10 : -10);  // 上下 10%
  return {
    timestamp: i * 86400000,
    open: close, high: close + 5, low: close - 5, close,
    volume: 1000000,
  };
});
const ddVolatile = computeMaxDrawdownEstimate(klinesVolatile);
assert('Volatile klines 嘅 drawdown > 0.10 (因為波動大)', ddVolatile > 0.10);
assert('Volatile klines 嘅 drawdown ≤ 0.30 (cap)', ddVolatile <= 0.30);

// =============================================================
// Test 4: computeSentiment6D
// =============================================================
section('Test 4: computeSentiment6D');

const s6dUptrend = computeSentiment6D(makeUptrendKlines(250));
assert('Sentiment6D.rsi 範圍 [-1, +1]', s6dUptrend.rsi >= -1 && s6dUptrend.rsi <= 1);
assert('Sentiment6D.bollinger_pct_b 範圍 [-1, +1]', s6dUptrend.bollinger_pct_b >= -1 && s6dUptrend.bollinger_pct_b <= 1);
assert('Sentiment6D.bias_ratio 範圍 [-1, +1]', s6dUptrend.bias_ratio >= -1 && s6dUptrend.bias_ratio <= 1);
assert('Sentiment6D.vol_skew 範圍 [-1, +1]', s6dUptrend.vol_skew >= -1 && s6dUptrend.vol_skew <= 1);
assert('Sentiment6D.turnover 範圍 [-1, +1]', s6dUptrend.turnover >= -1 && s6dUptrend.turnover <= 1);
assert('Sentiment6D.momentum_accel 範圍 [-1, +1]', s6dUptrend.momentum_accel >= -1 && s6dUptrend.momentum_accel <= 1);
// 上升趨勢應該 RSI > 0
assert('Uptrend → RSI > 0', s6dUptrend.rsi > 0);
// 上升趨勢應該 bias_ratio > 0
assert('Uptrend → bias_ratio > 0', s6dUptrend.bias_ratio > 0);

const s6dDowntrend = computeSentiment6D(makeDowntrendKlines(250));
assert('Downtrend → RSI < 0', s6dDowntrend.rsi < 0);
assert('Downtrend → bias_ratio < 0', s6dDowntrend.bias_ratio < 0);

const s6dEmpty = computeSentiment6D([]);
assert('Empty klines → 全部 0 (中性)', Object.values(s6dEmpty).every(v => v === 0));

const s6dShort = computeSentiment6D(makeSidewaysKlines(20));
assert('Short klines (< 30) → vol_skew = 0 fallback', s6dShort.vol_skew === 0);
assert('Short klines (< 30) → momentum_accel = 0 fallback', s6dShort.momentum_accel === 0);

// =============================================================
// Test 5: toStandardVerdict (低 level helper)
// =============================================================
section('Test 5: toStandardVerdict');

const fakeVerdict = {
  moduleId: 'ma-alignment-v2',
  timeframe: '1d',
  state: 'UP',
  confidence: 0.8,
  interpretation: 'test',
  evidence: [{ type: 'A', label: 'rule A', value: 1, passed: true }],
  meta: { customField: 'hello' },
  timestamp: 1700000000,
};

const sv1 = toStandardVerdict({
  verdict: fakeVerdict,
  klines: makeUptrendKlines(100),
  moduleId: 'ma-alignment',
});
assert('sv1.state === UP', sv1.state === 'UP');
assert('sv1.confidence === 0.8', sv1.confidence === 0.8);
assert('sv1.base_weight === 0.25', sv1.base_weight === 0.25);
assert('sv1.expected_return ≈ +0.08', Math.abs(sv1.expected_return - 0.08) < 0.0001);
assert('sv1.max_drawdown_estimate 範圍 [0, 0.30]', sv1.max_drawdown_estimate >= 0 && sv1.max_drawdown_estimate <= 0.30);
assert('sv1.module_id === ma-alignment', sv1.module_id === 'ma-alignment');
assert('sv1.module_specific.customField === hello', sv1.module_specific.customField === 'hello');
assert('sv1.rules_fired === [A]', sv1.rules_fired.length === 1 && sv1.rules_fired[0] === 'A');
assert('sv1.timestamp === 1700000000', sv1.timestamp === 1700000000);
assert('sv1.sentiment_6d.rsi > 0 (uptrend)', sv1.sentiment_6d.rsi > 0);

// =============================================================
// Test 6: toStandardVerdict 6 個 modules 嘅 base_weight 正確
// =============================================================
section('Test 6: 6 個 modules 嘅 base_weight');

const testKlines = makeUptrendKlines(100);
const allModuleIds = ['ma-alignment', 'hl-structure', 'trendline', 'indicators', 'volume', 'volatility'];
for (const id of allModuleIds) {
  const sv = toStandardVerdict({
    verdict: { ...fakeVerdict, state: 'UP', confidence: 0.8 },
    klines: testKlines,
    moduleId: id,
  });
  assert(`module ${id} → base_weight = ${BASE_WEIGHTS[id]}`, sv.base_weight === BASE_WEIGHTS[id]);
}

// =============================================================
// Test 7: 6 個 modules 嘅 wrapper 函數 (高 level)
// =============================================================
section('Test 7: 6 個 modules 嘅 toStandardVerdict{Module}() wrappers');

// M1 MA
const svMA = await toStandardVerdictMA(makeUptrendKlines(100), ctx);
assert('svMA.state valid', ['UP', 'DOWN', 'SIDEWAYS', 'TRANSITION', 'TRAP'].includes(svMA.state));
assert('svMA.base_weight === 0.25', svMA.base_weight === 0.25);
assert('svMA.module_id === ma-alignment', svMA.module_id === 'ma-alignment');
assert('svMA.module_specific 有 maValues', svMA.module_specific && 'maValues' in svMA.module_specific);

// M2 HL
const svHL = await toStandardVerdictHL(makeUptrendKlines(100), ctx);
assert('svHL.state valid', ['UP', 'DOWN', 'SIDEWAYS', 'TRANSITION', 'TRAP'].includes(svHL.state));
assert('svHL.base_weight === 0.15', svHL.base_weight === 0.15);
assert('svHL.module_id === hl-structure', svHL.module_id === 'hl-structure');

// M3 TL
const svTL = await toStandardVerdictTL(makeUptrendKlines(100), ctx);
assert('svTL.state valid', ['UP', 'DOWN', 'SIDEWAYS', 'TRANSITION', 'TRAP'].includes(svTL.state));
assert('svTL.base_weight === 0.20', svTL.base_weight === 0.20);
assert('svTL.module_id === trendline', svTL.module_id === 'trendline');

// M4 IND
const svIND = await toStandardVerdictIND(makeUptrendKlines(100), ctx);
assert('svIND.state valid', ['UP', 'DOWN', 'SIDEWAYS', 'TRANSITION', 'TRAP'].includes(svIND.state));
assert('svIND.base_weight === 0.15', svIND.base_weight === 0.15);
assert('svIND.module_id === indicators', svIND.module_id === 'indicators');

// M5 VP
const svVP = await toStandardVerdictVP(makeUptrendKlines(100), ctx);
assert('svVP.state valid', ['UP', 'DOWN', 'SIDEWAYS', 'TRANSITION', 'TRAP'].includes(svVP.state));
assert('svVP.base_weight === 0.15', svVP.base_weight === 0.15);
assert('svVP.module_id === volume', svVP.module_id === 'volume');

// M6 VOL
const svVOL = await toStandardVerdictVOL(makeUptrendKlines(100), ctx);
assert('svVOL.state valid', ['UP', 'DOWN', 'SIDEWAYS', 'TRANSITION', 'TRAP'].includes(svVOL.state));
assert('svVOL.base_weight === 0.10', svVOL.base_weight === 0.10);
assert('svVOL.module_id === volatility', svVOL.module_id === 'volatility');

// =============================================================
// Test 8: 趨勢 vs 反向 — 6 個 modules 嘅 expected_return 符號
// =============================================================
section('Test 8: 趨勢 vs 反向');

const svUp = await toStandardVerdictMA(makeUptrendKlines(100), ctx);
const svDown = await toStandardVerdictMA(makeDowntrendKlines(100), ctx);
// Note: M1 自己 derive 嘅 state 唔一定係 UP / DOWN (可能 SIDEWAYS), 但 expected_return formula 跟 state 走
// 我哋只係 verify expected_return 嘅 sign 同 state 一致
if (svUp.state === 'UP') {
  assert('Uptrend → sv.expected_return > 0', svUp.expected_return > 0);
}
if (svDown.state === 'DOWN') {
  assert('Downtrend → sv.expected_return < 0', svDown.expected_return < 0);
}

// =============================================================
// Test 9: 數據不足 (empty klines)
// =============================================================
section('Test 9: 數據不足 edge case');

try {
  await toStandardVerdictMA([], ctx);
  // M1 v2.0 會 throw error (length < required)
  assert('Empty klines → throw error', false);  // 如果冇 throw 失敗
} catch (e) {
  assert('Empty klines → throw error', e instanceof Error);
}

// =============================================================
// Test 10: 5 個 adaptive params auto-calibrate 預備 (SSI 加權和)
// =============================================================
section('Test 10: SSI 加權和 (1.00 預備 auto-calibrate)');

const allSVs = await Promise.all([
  toStandardVerdictMA(makeUptrendKlines(100), ctx),
  toStandardVerdictHL(makeUptrendKlines(100), ctx),
  toStandardVerdictTL(makeUptrendKlines(100), ctx),
  toStandardVerdictIND(makeUptrendKlines(100), ctx),
  toStandardVerdictVP(makeUptrendKlines(100), ctx),
  toStandardVerdictVOL(makeUptrendKlines(100), ctx),
]);
const ssiWeightSum = allSVs.reduce((acc, sv) => acc + sv.base_weight, 0);
assert('6 個 SV 加權和 = 1.00 (SSI ready)', Math.abs(ssiWeightSum - 1.0) < 0.001);

// =============================================================
// Summary
// =============================================================
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`📊 Standard Verdict Tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\n❌ Failures:');
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
console.log('✅ All standard verdict tests passed');

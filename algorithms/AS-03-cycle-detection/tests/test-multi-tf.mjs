// algorithms/AS-03-cycle-detection/tests/test-multi-tf.mjs
//
// 大少 2026-08-09 21:33 — M5 Multi-TF pytest 10+ 個 scenario
//   1: 3 個 TF 全 UP, conflict=false
//   2: 3 個 TF 全 DOWN, conflict=false
//   3: 3 個 TF 全 SIDEWAYS, conflict=false
//   4: 2 個 TF UP + 1 個 SIDEWAYS, conflict=false
//   5: 1D UP, 1W UP, 1M DOWN → 2 UP, 1 DOWN, conflict=true, confidence * 0.85
//   6: 1D UP, 1W DOWN, 1M DOWN → 1 UP, 2 DOWN, conflict=true
//   7: 1D UP, 1W DOWN, 1M UP → 2 UP, 1 DOWN, conflict=true (mixed)
//   8: 加權 default (25/35/40) baseConfidence 計算啱
//   9: 加權自訂 (30/30/40) baseConfidence 計算啱
//   10: Conflict penalty (× 0.5) confidence 折半
//   11: 3 個 TF 唔同方向 (UP/DOWN/SIDEWAYS) → CONFLICT
//
// 跑法: `node algorithms/AS-03-cycle-detection/tests/test-multi-tf.mjs`
//   exit code 0 = pass, 1 = fail
//
// Spec: docs/research/AS-03-cycle-detection/MODULE-05-MULTI-TIMEFRAME.md

import { synthesizeMultiTF } from '../modules/multi-tf.ts';

// ===== Helpers =====

function makeKlines(count, startPrice, direction) {
  const closes = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    if (direction === 'up') price = price * 1.005;        // 每條升 0.5%
    else if (direction === 'down') price = price * 0.995;  // 每條跌 0.5%
    else price = startPrice + (i % 2 === 0 ? 0.5 : -0.5); // 橫行
    closes.push(price);
  }
  return closes;
}

function makeKlinesFromCloses(closes) {
  return closes.map((close, i) => ({
    time: `2026-${String(Math.floor(i / 30) + 1).padStart(2, '0')}-${String((i % 30) + 1).padStart(2, '0')}`,
    open: close * 0.998,
    high: close * 1.005,
    low: close * 0.995,
    close,
    volume: 1000000,
  }));
}

function makeUpKlines(count = 100, startPrice = 100) {
  return makeKlinesFromCloses(makeKlines(count, startPrice, 'up'));
}
function makeDownKlines(count = 100, startPrice = 100) {
  return makeKlinesFromCloses(makeKlines(count, startPrice, 'down'));
}
function makeSidewaysKlines(count = 100, startPrice = 100) {
  return makeKlinesFromCloses(makeKlines(count, startPrice, 'sideways'));
}

// ===== Test cases =====

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, cond, detail = '') {
  if (cond) {
    console.log(`✅ ${name}`);
    passed++;
  } else {
    console.log(`❌ ${name} ${detail ? '— ' + detail : ''}`);
    failed++;
    failures.push(name);
  }
}

// Test 1: 3 個 TF 全 UP, conflict=false, high confidence
{
  const result = synthesizeMultiTF({
    symbol: 'HK.00700',
    klines1D: makeUpKlines(100),
    klines1W: makeUpKlines(100),
    klines1M: makeUpKlines(100),
  });

  assert('Test 1: 3 個 TF 全 UP → state=UP, conflict=false, consensus=aligned',
    result.state === 'UP' && result.conflict === false && result.consensus.direction === 'aligned',
    `got state=${result.state} conflict=${result.conflict} consensus=${result.consensus.direction}`);

  // 1D/1W/1M 全部 UP
  assert('Test 1b: 3 個 TF verdicts 全部 UP',
    result.timeframe_verdicts['1D'].state === 'UP' &&
    result.timeframe_verdicts['1W'].state === 'UP' &&
    result.timeframe_verdicts['1M'].state === 'UP',
    `got 1D=${result.timeframe_verdicts['1D'].state} / 1W=${result.timeframe_verdicts['1W'].state} / 1M=${result.timeframe_verdicts['1M'].state}`);
}

// Test 2: 3 個 TF 全 DOWN, conflict=false
{
  const result = synthesizeMultiTF({
    symbol: 'HK.00700',
    klines1D: makeDownKlines(100),
    klines1W: makeDownKlines(100),
    klines1M: makeDownKlines(100),
  });

  assert('Test 2: 3 個 TF 全 DOWN → state=DOWN, conflict=false',
    result.state === 'DOWN' && result.conflict === false,
    `got state=${result.state} conflict=${result.conflict}`);
}

// Test 3: 3 個 TF 全 SIDEWAYS, conflict=false
{
  const result = synthesizeMultiTF({
    symbol: 'HK.00700',
    klines1D: makeSidewaysKlines(100),
    klines1W: makeSidewaysKlines(100),
    klines1M: makeSidewaysKlines(100),
  });

  assert('Test 3: 3 個 TF 全 SIDEWAYS → state=SIDEWAYS, conflict=false',
    result.state === 'SIDEWAYS' && result.conflict === false,
    `got state=${result.state} conflict=${result.conflict}`);
}

// Test 4: 2 個 TF UP + 1 個 SIDEWAYS, conflict=false (SIDEWAYS fallback)
{
  const result = synthesizeMultiTF({
    symbol: 'HK.00700',
    klines1D: makeUpKlines(100),
    klines1W: makeSidewaysKlines(100),
    klines1M: makeUpKlines(100),
  });

  assert('Test 4: 2 TF UP + 1 SIDEWAYS → state=UP, conflict=false, partial consensus',
    result.state === 'UP' && result.conflict === false && result.consensus.direction === 'partial',
    `got state=${result.state} conflict=${result.conflict} consensus=${result.consensus.direction}`);
}

// Test 5: 1D UP, 1W UP, 1M DOWN → 2 UP, 1 DOWN, conflict=true, warning, confidence * 0.85
{
  const result = synthesizeMultiTF({
    symbol: 'HK.00700',
    klines1D: makeUpKlines(100),
    klines1W: makeUpKlines(100),
    klines1M: makeDownKlines(100),
  });

  assert('Test 5: 1D UP + 1W UP + 1M DOWN → state=UP, conflict=true, 1M 逆 warning',
    result.state === 'UP' && result.conflict === true && result.warning !== null && result.warning.includes('1M'),
    `got state=${result.state} conflict=${result.conflict} warning=${result.warning}`);

  // 2 TF UP + 1 TF DOWN → confidence 折 0.85
  // baseConfidence = (UP.conf × 0.25) + (UP.conf × 0.35) + (DOWN.conf × 0.40)
  // 假設 UP 0.7, DOWN 0.6 → base = 0.7*0.25 + 0.7*0.35 + 0.6*0.40 = 0.175 + 0.245 + 0.24 = 0.66
  // final = 0.66 * 0.85 = 0.561
  const base = result.timeframe_verdicts['1D'].confidence * 0.25 +
              result.timeframe_verdicts['1W'].confidence * 0.35 +
              result.timeframe_verdicts['1M'].confidence * 0.40;
  const expected = +(base * 0.85).toFixed(4);
  assert(`Test 5b: 2 UP + 1 DOWN confidence = base * 0.85 = ${expected}`,
    Math.abs(result.confidence - expected) < 0.01,
    `got ${result.confidence}, expected ${expected}`);
}

// Test 6: 1D UP, 1W DOWN, 1M DOWN → 1 UP, 2 DOWN, conflict=true, state=DOWN
{
  const result = synthesizeMultiTF({
    symbol: 'HK.00700',
    klines1D: makeUpKlines(100),
    klines1W: makeDownKlines(100),
    klines1M: makeDownKlines(100),
  });

  assert('Test 6: 1D UP + 1W DOWN + 1M DOWN → state=DOWN, conflict=true, 1D 逆 warning',
    result.state === 'DOWN' && result.conflict === true && result.warning !== null && result.warning.includes('1D'),
    `got state=${result.state} conflict=${result.conflict} warning=${result.warning}`);
}

// Test 7: 1D UP, 1W DOWN, 1M UP → 2 UP, 1 DOWN, conflict=true (mixed partial)
{
  const result = synthesizeMultiTF({
    symbol: 'HK.00700',
    klines1D: makeUpKlines(100),
    klines1W: makeDownKlines(100),
    klines1M: makeUpKlines(100),
  });

  assert('Test 7: 1D UP + 1W DOWN + 1M UP → state=UP, conflict=true, 1W 逆 warning',
    result.state === 'UP' && result.conflict === true && result.warning !== null && result.warning.includes('1W'),
    `got state=${result.state} conflict=${result.conflict} warning=${result.warning}`);
}

// Test 8: 加權 default (25/35/40) baseConfidence 計算啱
{
  const result = synthesizeMultiTF({
    symbol: 'HK.00700',
    klines1D: makeUpKlines(100),
    klines1W: makeUpKlines(100),
    klines1M: makeUpKlines(100),
  });

  const c1d = result.timeframe_verdicts['1D'].confidence;
  const c1w = result.timeframe_verdicts['1W'].confidence;
  const c1m = result.timeframe_verdicts['1M'].confidence;
  const expectedBase = c1d * 0.25 + c1w * 0.35 + c1m * 0.40;

  assert(`Test 8: 加權 default (25/35/40) baseConfidence = ${expectedBase.toFixed(4)}`,
    Math.abs(result.confidence - expectedBase) < 0.01,
    `got ${result.confidence}, expected ${expectedBase.toFixed(4)}`);

  // 因為 3 TF 全 UP, multiplier = 1.0, final = base
  assert('Test 8b: 3 TF 一致, confidence multiplier = 1.0',
    Math.abs(result.confidence - expectedBase) < 0.01,
    `got ${result.confidence}, expected ${expectedBase.toFixed(4)}`);
}

// Test 9: 加權自訂 (30/30/40) — 大少可調
{
  const result = synthesizeMultiTF({
    symbol: 'HK.00700',
    klines1D: makeUpKlines(100),
    klines1W: makeUpKlines(100),
    klines1M: makeUpKlines(100),
    config: { tfWeights: { '1D': 0.30, '1W': 0.30, '1M': 0.40 } },
  });

  const c1d = result.timeframe_verdicts['1D'].confidence;
  const c1w = result.timeframe_verdicts['1W'].confidence;
  const c1m = result.timeframe_verdicts['1M'].confidence;
  const expectedBase = c1d * 0.30 + c1w * 0.30 + c1m * 0.40;

  assert(`Test 9: 加權自訂 (30/30/40) baseConfidence = ${expectedBase.toFixed(4)}`,
    Math.abs(result.confidence - expectedBase) < 0.01,
    `got ${result.confidence}, expected ${expectedBase.toFixed(4)}`);
}

// Test 10: Conflict penalty (× 0.5) — 3 TF 唔同 (UP/DOWN/SIDEWAYS) → CONFLICT
{
  const result = synthesizeMultiTF({
    symbol: 'HK.00700',
    klines1D: makeUpKlines(100),
    klines1W: makeDownKlines(100),
    klines1M: makeSidewaysKlines(100),
  });

  assert('Test 10: 3 TF 唔同方向 → state=CONFLICT, conflict=true, divergent consensus',
    result.state === 'CONFLICT' && result.conflict === true && result.consensus.direction === 'divergent',
    `got state=${result.state} conflict=${result.conflict} consensus=${result.consensus.direction}`);

  // Conflict penalty: confidence * 0.5
  const c1d = result.timeframe_verdicts['1D'].confidence;
  const c1w = result.timeframe_verdicts['1W'].confidence;
  const c1m = result.timeframe_verdicts['1M'].confidence;
  const base = c1d * 0.25 + c1w * 0.35 + c1m * 0.40;
  const expected = +(base * 0.5).toFixed(4);
  assert(`Test 10b: CONFLICT confidence = base * 0.5 = ${expected}`,
    Math.abs(result.confidence - expected) < 0.01,
    `got ${result.confidence}, expected ${expected}`);

  // Warning 必須包含 3 個 TF state
  assert('Test 10c: CONFLICT warning 包含 3 個 TF state',
    result.warning !== null &&
    result.warning.includes('UP') &&
    result.warning.includes('DOWN') &&
    result.warning.includes('SIDEWAYS'),
    `got warning=${result.warning}`);
}

// Test 11: Data 不足 error case
{
  let errored = false;
  try {
    synthesizeMultiTF({
      symbol: 'HK.00700',
      klines1D: makeUpKlines(50),  // 只有 50 條 (< 90)
      klines1W: makeUpKlines(100),
      klines1M: makeUpKlines(100),
    });
  } catch (e) {
    errored = true;
    assert('Test 11: 1D 數據不足 (< 90) 拋 error',
      e.message.includes('Insufficient data') && e.message.includes('90'),
      `got error: ${e.message}`);
  }
  if (!errored) {
    failed++;
    failures.push('Test 11: 1D 數據不足 (< 90) 應拋 error 但冇拋');
    console.log(`❌ Test 11: 1D 數據不足 (< 90) 應拋 error 但冇拋`);
  }
}

// Test 12: Cycle transitions — turn_around
{
  const result = synthesizeMultiTF({
    symbol: 'HK.00700',
    klines1D: makeUpKlines(100),
    klines1W: makeUpKlines(100),
    klines1M: makeUpKlines(100),
  });

  // 兩個都 UP, 1M confidence >= 0.65 → turn_around = true
  assert('Test 12: 3 TF 全 UP + 1M high confidence → turn_around = true',
    result.transitions.turn_around === true,
    `got turn_around=${result.transitions.turn_around}, 1M conf=${result.timeframe_verdicts['1M'].confidence}`);
}

// Test 13: Meta fields 啱
{
  const result = synthesizeMultiTF({
    symbol: 'HK.00700',
    klines1D: makeUpKlines(100),
    klines1W: makeUpKlines(100),
    klines1M: makeUpKlines(100),
  });

  assert('Test 13: meta.tf_weights 對應 default 25/35/40',
    result.meta.tf_weights['1D'] === 0.25 &&
    result.meta.tf_weights['1W'] === 0.35 &&
    result.meta.tf_weights['1M'] === 0.40,
    `got ${JSON.stringify(result.meta.tf_weights)}`);

  assert('Test 13b: meta.data_days_xxx 對應 100 條',
    result.meta.data_days_1d === 100 &&
    result.meta.data_days_1w === 100 &&
    result.meta.data_days_1m === 100,
    `got 1D=${result.meta.data_days_1d} / 1W=${result.meta.data_days_1w} / 1M=${result.meta.data_days_1m}`);

  assert('Test 13c: meta.sub_module = "ma-alignment"',
    result.meta.sub_module === 'ma-alignment',
    `got ${result.meta.sub_module}`);
}

// ===== Summary =====
console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0) {
  console.log('Failed tests:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
process.exit(0);

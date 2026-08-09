// algorithms/AS-03-cycle-detection/tests/test-cycle-synth.mjs
//
// 大少 2026-08-09 19:06 — 兩線策略 pytest 8 個 scenario
//   1-2: 綜合方法 (M1 60% + zmen 40% 加權平均, 兩個都 UP)
//   3:   Cycle gate (CONFLICT, M1 UP zmen DOWN, confidence 折半)
//   4:   Cycle gate (SIDEWAYS, 都 SIDEWAYS, 唔入場)
//   5-8: 5 個 MA trigger
//
// 跑法: `node algorithms/AS-03-cycle-detection/tests/test-cycle-synth.mjs`
//   exit code 0 = pass, 1 = fail
//
// Spec: docs/research/AS-03-cycle-detection/MODULE-08-CYCLE-SYNTHESIZER.md

import { synthesizeCycle } from '../modules/cycle-synthesizer.ts';

// 1. Helper: 模擬 kline 上升 (close 一直升)
function makeUpKlines(n = 30, startPrice = 100) {
  const closes = [];
  let price = startPrice;
  for (let i = 0; i < n; i++) {
    price = price * 1.005;  // 每條升 0.5%
    closes.push(price);
  }
  return closes;
}

// 2. Helper: 模擬 kline 下跌
function makeDownKlines(n = 30, startPrice = 100) {
  const closes = [];
  let price = startPrice;
  for (let i = 0; i < n; i++) {
    price = price * 0.995;  // 每條跌 0.5%
    closes.push(price);
  }
  return closes;
}

// 3. Helper: 模擬 kline 橫行
function makeSidewaysKlines(n = 30, startPrice = 100) {
  const closes = [];
  for (let i = 0; i < n; i++) {
    closes.push(startPrice + (i % 2 === 0 ? 0.5 : -0.5));
  }
  return closes;
}

// 4. Helper: 模擬 kline "5 日線 -2% 跌破" 嘅 close (close < MA5 * 0.98)
function makeMa5StopKlines(n = 30, startPrice = 100) {
  const closes = [];
  let price = startPrice;
  // 前 19 日平穩, 第 20-24 日 build MA5 ~100, 第 25 日插穿 -2%
  for (let i = 0; i < 20; i++) {
    closes.push(100);
  }
  for (let i = 20; i < 24; i++) {
    closes.push(101);
  }
  // 第 25 日 (最舊) 拎 100, MA5[24] = 100.4, 99 < 100.4 * 0.98 = 98.39
  // 但 reverse 落 klineCloses[0] = 第 25 日, [4] = 第 21 日
  // closes[0] = 95, closes[1] = 100, ... 咁樣
  // MA5[0] = 95 (只有 1 個值)... 唔啱
  // 改寫: 全部 push 然後 reverse
  // klineCloses[0] = 今日 (跌到 95), [1] = 昨日, [2] = ..., [4] = 4 日前
  // 計算 MA5[0] = avg(closes[0..4]) = (95 + 100 + 100 + 100 + 100) / 5 = 99
  // 99 * 0.98 = 97.02, closes[0] = 95 < 97.02 ✓ trigger
  closes.length = 0;
  for (let i = 0; i < 25; i++) {
    closes.push(100);
  }
  // 跌穿 5% (95 < 99)
  closes.push(95);
  // 要 ensure [0] = 95 (今日最 close) — 陣列順序: [0]=今日, [n-1]=最舊
  // close 95 應該 push 入 [0], 所以要 prepend
  // 但 helper 由舊到新 push, 跟住 reverse
  return closes.reverse();  // [0]=95, [1]=100, [2]=100, ... [4]=100
}

// 5. Helper: 模擬 kline "5 日線穿 1 日" (今日 close < MA5 但 ≥ MA5 * 0.98)
function makeMa5BreakDay1Klines() {
  // MA5[0] = avg(closes[0..4])
  // 想 closes[0] < MA5[0] 但 closes[0] >= MA5[0] * 0.98
  // 例: closes[1..4] = 100, closes[0] = 99, MA5[0] = (99+100+100+100+100)/5 = 99.8
  // 99.8 * 0.98 = 97.804, 99 >= 97.804 ✓ ma5BreakDay1
  // 99 < 99.8 ✓ 穿
  // 99 / 99.8 = 0.992 冇到 -2% trigger
  const closes = [99, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100];
  return closes;
}

// 6. Helper: 模擬 kline "5 日線穿 2 日" (連續 2 日 close < MA5)
function makeMa5BreakDay2Klines() {
  // closes[0] = 98, closes[1] = 98, closes[2..4] = 100
  // MA5[0] = (98+98+100+100+100)/5 = 99.2
  // MA5[1] = (98+100+100+100+100)/5 = 99.6
  // closes[0] = 98 < 99.2 ✓, closes[1] = 98 < 99.6 ✓ ma5BreakDay2
  const closes = [98, 98, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100];
  return closes;
}

// 7. Helper: 模擬 kline "20 日線跌破"
function makeMa20BreakKlines() {
  // closes[0] = 70 (今日急跌), closes[1..19] = 80 (之前 19 日穩定), closes[20..24] = 100
  // MA20[0] = avg(closes[0..19]) = (70 + 80*19) / 20 = 79.5
  // 70 < 79.5 ✓ ma20Break
  const closes = [70];
  for (let i = 0; i < 19; i++) closes.push(80);
  for (let i = 0; i < 5; i++) closes.push(100);
  return closes;
}

// 8. Helper: 模擬 kline "5 日線 re-test 成功" (過去 5 日曾穿, 今日回升過 MA5)
function makeMa5RetestSuccessKlines() {
  // closes[0] = 101 (今日回升), closes[1..4] = 99 (穿左 1-4 日前)
  // MA5[0] = (101+99+99+99+99)/5 = 99.4
  // closes[0] = 101 >= 99.4 ✓ re-test success
  // closes[1] = 99 < MA5[1]=(99+99+99+99+99)/5=99 唔算穿
  // 改寫: closes[1] = 98, MA5[1] = 99, 98 < 99 ✓
  const closes = [101, 98, 98, 98, 98, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100];
  return closes;
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

function makeVerdict(state, confidence) {
  return {
    state,
    confidence,
    interpretation: `${state} test`,
    meta: { matchedRules: [], dataDays: 100 },
    timestamp: Date.now(),
  };
}

// Test 1: 兩個都 UP, 一致, 高 confidence
{
  const m1 = makeVerdict('UP', 0.7);
  const zmen = makeVerdict('UP', 0.6);
  const closes = makeUpKlines(30);
  const result = synthesizeCycle({ m1Verdict: m1, zmenVerdict: zmen, klineCloses: closes });

  assert('Test 1: 兩個都 UP → state=UP, conflict=false, confidence=0.66',
    result.state === 'UP' && result.conflict === false && Math.abs(result.confidence - 0.66) < 0.01,
    `got state=${result.state} conflict=${result.conflict} confidence=${result.confidence}`);
}

// Test 2: 兩個都 DOWN, 一致
{
  const m1 = makeVerdict('DOWN', 0.6);
  const zmen = makeVerdict('DOWN', 0.5);
  const closes = makeDownKlines(30);
  const result = synthesizeCycle({ m1Verdict: m1, zmenVerdict: zmen, klineCloses: closes });

  assert('Test 2: 兩個都 DOWN → state=DOWN, conflict=false',
    result.state === 'DOWN' && result.conflict === false,
    `got state=${result.state} conflict=${result.conflict}`);
}

// Test 3: M1 UP + zmen DOWN → CONFLICT, confidence 折半
{
  const m1 = makeVerdict('UP', 0.8);
  const zmen = makeVerdict('DOWN', 0.6);
  const closes = makeUpKlines(30);
  const result = synthesizeCycle({ m1Verdict: m1, zmenVerdict: zmen, klineCloses: closes });

  // baseConfidence = 0.8*0.6 + 0.6*0.4 = 0.48 + 0.24 = 0.72
  // 折半 = 0.36
  assert('Test 3: M1 UP + zmen DOWN → state=CONFLICT, conflict=true, confidence=0.36',
    result.state === 'CONFLICT' && result.conflict === true && Math.abs(result.confidence - 0.36) < 0.01,
    `got state=${result.state} conflict=${result.conflict} confidence=${result.confidence}`);
}

// Test 4: 都 SIDEWAYS → state=SIDEWAYS, consensus=sideways
{
  const m1 = makeVerdict('SIDEWAYS', 0.5);
  const zmen = makeVerdict('SIDEWAYS', 0.4);
  const closes = makeSidewaysKlines(30);
  const result = synthesizeCycle({ m1Verdict: m1, zmenVerdict: zmen, klineCloses: closes });

  assert('Test 4: 都 SIDEWAYS → state=SIDEWAYS, conflict=false, consensus=sideways',
    result.state === 'SIDEWAYS' && result.conflict === false && result.meta.consensus === 'sideways',
    `got state=${result.state} conflict=${result.conflict} consensus=${result.meta.consensus}`);
}

// Test 5: 5 個 trigger — ma5StopTriggered
{
  const m1 = makeVerdict('UP', 0.7);
  const zmen = makeVerdict('UP', 0.6);
  const closes = makeMa5StopKlines();
  const result = synthesizeCycle({ m1Verdict: m1, zmenVerdict: zmen, klineCloses: closes });

  assert('Test 5a: 5 個 trigger — ma5StopTriggered (close=95, MA5≈99, 95 < 99*0.98)',
    result.triggers.ma5StopTriggered === true,
    `got ma5StopTriggered=${result.triggers.ma5StopTriggered} (closes[0]=${closes[0]})`);

  // Test 5b: 5 個 trigger — ma5BreakDay1 (穿 1 日)
  const closes2 = makeMa5BreakDay1Klines();
  const result2 = synthesizeCycle({ m1Verdict: m1, zmenVerdict: zmen, klineCloses: closes2 });
  assert('Test 5b: 5 個 trigger — ma5BreakDay1 (close=99, MA5=99.8, 99 < 99.8 但 ≥ 99.8*0.98)',
    result2.triggers.ma5BreakDay1 === true,
    `got ma5BreakDay1=${result2.triggers.ma5BreakDay1} (closes[0]=${closes2[0]}, MA5=${(closes2[0]+closes2[1]+closes2[2]+closes2[3]+closes2[4])/5})`);

  // Test 5c: 5 個 trigger — ma5BreakDay2 (穿 2 日)
  const closes3 = makeMa5BreakDay2Klines();
  const result3 = synthesizeCycle({ m1Verdict: m1, zmenVerdict: zmen, klineCloses: closes3 });
  assert('Test 5c: 5 個 trigger — ma5BreakDay2 (連 2 日 close=98 < MA5)',
    result3.triggers.ma5BreakDay2 === true,
    `got ma5BreakDay2=${result3.triggers.ma5BreakDay2}`);

  // Test 5d: 5 個 trigger — ma20Break
  const closes4 = makeMa20BreakKlines();
  const result4 = synthesizeCycle({ m1Verdict: m1, zmenVerdict: zmen, klineCloses: closes4 });
  assert('Test 5d: 5 個 trigger — ma20Break (close=80, MA20=90, 80 < 90)',
    result4.triggers.ma20Break === true,
    `got ma20Break=${result4.triggers.ma20Break}`);

  // Test 5e: 5 個 trigger — ma5RetestSuccess
  const closes5 = makeMa5RetestSuccessKlines();
  const result5 = synthesizeCycle({ m1Verdict: m1, zmenVerdict: zmen, klineCloses: closes5 });
  assert('Test 5e: 5 個 trigger — ma5RetestSuccess (曾穿後回升)',
    result5.triggers.ma5RetestSuccess === true,
    `got ma5RetestSuccess=${result5.triggers.ma5RetestSuccess}`);
}

// Test 6: 2 個 transition — turnAroundDetected (兩個都 UP, confidence ≥ 0.65)
{
  const m1 = makeVerdict('UP', 0.8);
  const zmen = makeVerdict('UP', 0.7);
  const closes = makeUpKlines(30);
  const result = synthesizeCycle({ m1Verdict: m1, zmenVerdict: zmen, klineCloses: closes });

  // baseConfidence = 0.8*0.6 + 0.7*0.4 = 0.48 + 0.28 = 0.76
  // 兩個都 UP, 0.76 >= 0.65, 0.7 (zmen) >= 0.65, 0.8 (m1) >= 0.65 ✓
  assert('Test 6a: 2 個 transition — turnAroundDetected (兩個都 UP + confidence ≥ 0.65)',
    result.transitions.turnAroundDetected === true,
    `got turnAroundDetected=${result.transitions.turnAroundDetected} (confidence=${result.confidence})`);

  // Test 6b: 2 個 transition — adjustmentComplete (re-test success + 兩個都 UP)
  const closes2 = makeMa5RetestSuccessKlines();
  const result2 = synthesizeCycle({ m1Verdict: m1, zmenVerdict: zmen, klineCloses: closes2 });
  assert('Test 6b: 2 個 transition — adjustmentComplete (5 日線 re-test success + 兩個都 UP)',
    result2.transitions.adjustmentComplete === true,
    `got adjustmentComplete=${result2.transitions.adjustmentComplete}`);
}

// Test 7: 加權默認 (M1 0.6 + zmen 0.4)
{
  const m1 = makeVerdict('UP', 0.5);
  const zmen = makeVerdict('UP', 0.7);
  const closes = makeUpKlines(30);
  const result = synthesizeCycle({ m1Verdict: m1, zmenVerdict: zmen, klineCloses: closes });

  // baseConfidence = 0.5*0.6 + 0.7*0.4 = 0.30 + 0.28 = 0.58
  assert('Test 7: 加權默認 (M1 0.6 + zmen 0.4) — confidence=0.58',
    Math.abs(result.confidence - 0.58) < 0.01,
    `got confidence=${result.confidence}`);

  // Test 7b: 自訂加權 (M1 0.7 + zmen 0.3)
  const result2 = synthesizeCycle({
    m1Verdict: m1, zmenVerdict: zmen, klineCloses: closes,
    weights: { m1: 0.7, zmen: 0.3 },
  });
  // baseConfidence = 0.5*0.7 + 0.7*0.3 = 0.35 + 0.21 = 0.56
  assert('Test 7b: 自訂加權 (M1 0.7 + zmen 0.3) — confidence=0.56',
    Math.abs(result2.confidence - 0.56) < 0.01,
    `got confidence=${result2.confidence}`);
}

// Test 8: Warning message when conflict
{
  const m1 = makeVerdict('UP', 0.7);
  const zmen = makeVerdict('DOWN', 0.6);
  const closes = makeUpKlines(30);
  const result = synthesizeCycle({ m1Verdict: m1, zmenVerdict: zmen, klineCloses: closes });

  assert('Test 8: Conflict warning message includes both states',
    result.warning !== null && result.warning.includes('UP') && result.warning.includes('DOWN'),
    `got warning=${result.warning}`);
}

// ===== Summary =====
console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0) {
  console.log('Failed tests:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
process.exit(0);

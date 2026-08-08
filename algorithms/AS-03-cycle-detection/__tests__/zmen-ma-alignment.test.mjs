// __tests__/ma-alignment.test.mjs — MA Alignment (v0.3.0, 大少 #10332)
//
// 11 tests:
//   T1  — Step 1 data validation (< 90 days throws)
//   T2  — Case A 上升勢 (連續 5 日 MA5 > MA60)
//   T3  — Case B 下跌勢 (連續 5 日 MA5 < MA60)
//   T4  — Case C 橫行向下 (5 日裡 MA5 > MA60 但當日 low < MA60)
//   T5  — Case D 橫行向上 (5 日裡 MA5 < MA60 但當日 high > MA60)
//   T6  — Case F 升勢調整向下 (MA5+MA10 > MA60 但 MA5 < MA10)
//   T7  — Case G 跌勢調整向上 (MA5+MA10 < MA60 但 MA5 > MA10)
//   T8  — Case H 7 日反轉 (3 sub-case)
//   T9  — Case I 有機會長升 (連續 5 日 low ≥ MA5 × 0.98)
//   T10 — Case J 有機會長跌 (連續 5 日 high ≤ MA5 × 1.02, 大少 #10317 fix)
//   T11 — Multi-rule 共存 (大少 spec #10299 答問題 D)
//
// Run: cd ~/stockpulse/algorithms/AS-03-cycle-detection
//      node --experimental-strip-types __tests__/ma-alignment.test.mjs

import { ZmenMAAlignmentModule } from '../modules/zmen-ma-alignment.ts';
import { DEFAULT_MA_ALIGNMENT_CONFIG } from '../config.ts';

let passed = 0;
let failed = 0;

function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`✅ ${name}`);
    passed++;
  } else {
    console.log(`❌ ${name}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

// ============ Test Data Generators ============

/**
 * 通用 generator
 * - price[i] = piecewise linear segments
 * - segments: [{start, end, fromPrice, toPrice}] (start inclusive, end inclusive)
 * - lowSpreadPct / highSpreadPct: 控制當日 OHLC spread (e.g. 0.02 = 2%)
 * - overrideLastN: 最後 N 日 override low/high (for Case C/D/I/J testing)
 */
function genKLines(opts) {
  const {
    count = 100,
    segments = [{ start: 0, end: count - 1, fromPrice: 100, toPrice: 100 }],
    lowSpreadPct = 0.002,
    highSpreadPct = 0.002,
    lowOverrideLastN = 0,
    lowOverrideValue = null,
    highOverrideLastN = 0,
    highOverrideValue = null,
    dailyVol = 1000000,
  } = opts;

  const klines = [];
  const startTime = new Date('2026-01-01').getTime();

  // 計算每個 day 嘅 close price
  const closes = new Array(count);
  for (let i = 0; i < count; i++) {
    // 找適用 segment
    let price = 100;
    for (const seg of segments) {
      if (i >= seg.start && i <= seg.end) {
        const span = seg.end - seg.start;
        const t = span === 0 ? 0 : (i - seg.start) / span;
        price = seg.fromPrice + (seg.toPrice - seg.fromPrice) * t;
        break;
      }
    }
    closes[i] = price;
  }

  // 組裝 OHLCV
  const lowStart = count - lowOverrideLastN;
  const highStart = count - highOverrideLastN;

  for (let i = 0; i < count; i++) {
    const price = closes[i];
    let low = price * (1 - lowSpreadPct);
    let high = price * (1 + highSpreadPct);

    if (lowOverrideLastN > 0 && i >= lowStart && lowOverrideValue !== null) {
      low = lowOverrideValue;
    }
    if (highOverrideLastN > 0 && i >= highStart && highOverrideValue !== null) {
      high = highOverrideValue;
    }

    klines.push({
      timestamp: startTime + i * 86400000,
      open: price,
      high,
      low,
      close: price,
      volume: dailyVol,
    });
  }

  return klines;
}

const ctx = { symbol: 'HK.00981', ltf: '1d' };

// ============ T1: Validation (< 90 days throws) ============

async function test1() {
  console.log('\n📊 T1: Step 1 validation (< 90 days throws)');
  const klines = genKLines({ count: 50 });
  try {
    await new ZmenMAAlignmentModule().detect(klines, ctx);
    assert('T1.1: should throw for 50 days', false);
  } catch (err) {
    assert('T1.1: throws for 50 days (< 90 min)', err.message.includes('Insufficient data'),
      `got "${err.message}"`);
  }
  // 89 days 應該都 throw
  try {
    await new ZmenMAAlignmentModule().detect(genKLines({ count: 89 }), ctx);
    assert('T1.2: should throw for 89 days', false);
  } catch (err) {
    assert('T1.2: throws for 89 days', err.message.includes('Insufficient data'),
      `got "${err.message}"`);
  }
  // 90 days 應該 OK
  try {
    const v = await new ZmenMAAlignmentModule().detect(genKLines({ count: 90 }), ctx);
    assert('T1.3: 90 days passes', v !== null);
  } catch (err) {
    assert('T1.3: 90 days passes', false, `got error: ${err.message}`);
  }
}

// ============ T2: Case A 上升勢 (連續 5 日 MA5 > MA60) ============

async function test2() {
  console.log('\n📊 T2: Case A 上升勢 (linear uptrend 100→110)');
  const klines = genKLines({
    count: 100,
    segments: [{ start: 0, end: 99, fromPrice: 100, toPrice: 110 }],
  });
  const v = await new ZmenMAAlignmentModule().detect(klines, ctx);

  assert('T2.1: Case A fires', v.meta.matchedRules.includes('A'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}`);
  assert('T2.2: state = UP', v.state === 'UP', `got ${v.state}`);
  assert('T2.3: Case B NOT fire', !v.meta.matchedRules.includes('B'));
  console.log(`   ℹ️  matched: ${JSON.stringify(v.meta.matchedRules)}, conf=${v.confidence}`);
}

// ============ T3: Case B 下跌勢 (連續 5 日 MA5 < MA60) ============

async function test3() {
  console.log('\n📊 T3: Case B 下跌勢 (linear downtrend 110→100)');
  const klines = genKLines({
    count: 100,
    segments: [{ start: 0, end: 99, fromPrice: 110, toPrice: 100 }],
  });
  const v = await new ZmenMAAlignmentModule().detect(klines, ctx);

  assert('T3.1: Case B fires', v.meta.matchedRules.includes('B'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}`);
  assert('T3.2: state = DOWN', v.state === 'DOWN', `got ${v.state}`);
  console.log(`   ℹ️  matched: ${JSON.stringify(v.meta.matchedRules)}, conf=${v.confidence}`);
}

// ============ T4: Case C 橫行向下 (5 日裡 MA5 > MA60 但當日 low < MA60) ============

async function test4() {
  console.log('\n📊 T4: Case C 橫行向下');
  // Setup: 穩定 100 (days 0-94), last 5 days price = 115 (uptrend MA5 > MA60)
  // 但 override 最後 5 日 low = 95 (跌穿 MA60)
  const klines = genKLines({
    count: 100,
    segments: [
      { start: 0, end: 94, fromPrice: 100, toPrice: 100 },
      { start: 95, end: 99, fromPrice: 115, toPrice: 115 },
    ],
    lowOverrideLastN: 5,
    lowOverrideValue: 95,
  });
  const v = await new ZmenMAAlignmentModule().detect(klines, ctx);

  assert('T4.1: Case C fires', v.meta.matchedRules.includes('C'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}`);
  console.log(`   ℹ️  matched: ${JSON.stringify(v.meta.matchedRules)}, conf=${v.confidence}`);
}

// ============ T5: Case D 橫行向上 (5 日裡 MA5 < MA60 但當日 high > MA60) ============

async function test5() {
  console.log('\n📊 T5: Case D 橫行向上');
  // Setup: 穩定 110 (days 0-94), last 5 days price = 95 (downtrend MA5 < MA60)
  // 但 override 最後 5 日 high = 115 (升穿 MA60)
  const klines = genKLines({
    count: 100,
    segments: [
      { start: 0, end: 94, fromPrice: 110, toPrice: 110 },
      { start: 95, end: 99, fromPrice: 95, toPrice: 95 },
    ],
    highOverrideLastN: 5,
    highOverrideValue: 115,
  });
  const v = await new ZmenMAAlignmentModule().detect(klines, ctx);

  assert('T5.1: Case D fires', v.meta.matchedRules.includes('D'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}`);
  console.log(`   ℹ️  matched: ${JSON.stringify(v.meta.matchedRules)}, conf=${v.confidence}`);
}

// ============ T6: Case F 升勢調整向下 (MA5+MA10 > MA60 但 MA5 < MA10) ============

async function test6() {
  console.log('\n📊 T6: Case F 升勢調整向下');
  // Setup: days 0-89 = 100, days 90-94 = 115 (急升), days 95-99 = 105 (回調)
  // 結果: MA5(105) > MA60 但 MA5 < MA10(110)
  const klines = genKLines({
    count: 100,
    segments: [
      { start: 0, end: 89, fromPrice: 100, toPrice: 100 },
      { start: 90, end: 94, fromPrice: 115, toPrice: 115 },
      { start: 95, end: 99, fromPrice: 105, toPrice: 105 },
    ],
  });
  const v = await new ZmenMAAlignmentModule().detect(klines, ctx);

  assert('T6.1: Case F fires', v.meta.matchedRules.includes('F'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}`);
  console.log(`   ℹ️  matched: ${JSON.stringify(v.meta.matchedRules)}, conf=${v.confidence}`);
}

// ============ T7: Case G 跌勢調整向上 (MA5+MA10 < MA60 但 MA5 > MA10) ============

async function test7() {
  console.log('\n📊 T7: Case G 跌勢調整向上');
  // Setup: days 0-89 = 100, days 90-94 = 85 (急跌), days 95-99 = 95 (反彈)
  // 結果: MA5(95) < MA60 但 MA5 > MA10(90)
  const klines = genKLines({
    count: 100,
    segments: [
      { start: 0, end: 89, fromPrice: 100, toPrice: 100 },
      { start: 90, end: 94, fromPrice: 85, toPrice: 85 },
      { start: 95, end: 99, fromPrice: 95, toPrice: 95 },
    ],
  });
  const v = await new ZmenMAAlignmentModule().detect(klines, ctx);

  assert('T7.1: Case G fires', v.meta.matchedRules.includes('G'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}`);
  console.log(`   ℹ️  matched: ${JSON.stringify(v.meta.matchedRules)}, conf=${v.confidence}`);
}

// ============ T8: Case H 7 日反轉 ============

async function test8() {
  console.log('\n📊 T8: Case H 7 日反轉 (1 日新方向)');
  // Setup: days 0-94 = 100 (穩定), days 95-99 = 95 (下跌), day 100 = 130 (反轉大升)
  // Sub-case 1: day 100 MA5 > MA60, days 94-99 MA5 < MA60
  const klines = genKLines({
    count: 101,  // 需要 101 日確保 day 100 嘅 MA60 計算 (需要 day 41-100 = 60 個)
    segments: [
      { start: 0, end: 89, fromPrice: 100, toPrice: 100 },   // 90 日 100 (day 94 = 95 避免 MA5=MA60 boundary)
      { start: 90, end: 99, fromPrice: 95, toPrice: 95 },    // 10 日 95
      { start: 100, end: 100, fromPrice: 130, toPrice: 130 }, // day 100 spike up
    ],
  });
  const v = await new ZmenMAAlignmentModule().detect(klines, ctx);

  assert('T8.1: Case H reverse-up fires', v.meta.matchedRules.includes('H-reverse-up'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}`);
  assert('T8.2: state = TRANSITION', v.state === 'TRANSITION', `got ${v.state}`);
  console.log(`   ℹ️  matched: ${JSON.stringify(v.meta.matchedRules)}, conf=${v.confidence}`);
}

// ============ T9: Case I 有機會長升 (連續 5 日 low ≥ MA5 × 0.98) ============

async function test9() {
  console.log('\n📊 T9: Case I 有機會長升');
  // Setup: 穩定 100 (days 0-99), low default 100 * 0.998 = 99.8
  // MA5 = 100, MA5 × 0.98 = 98
  // low = 99.8 ≥ 98 ✓ → Case I fires
  const klines = genKLines({
    count: 100,
    segments: [{ start: 0, end: 99, fromPrice: 100, toPrice: 100 }],
  });
  const v = await new ZmenMAAlignmentModule().detect(klines, ctx);

  assert('T9.1: Case I fires', v.meta.matchedRules.includes('I'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}`);
  console.log(`   ℹ️  matched: ${JSON.stringify(v.meta.matchedRules)}, conf=${v.confidence}`);
}

// ============ T10: Case J 有機會長跌 (連續 5 日 high ≤ MA5 × 1.02) ============

async function test10() {
  console.log('\n📊 T10: Case J 有機會長跌 (大少 #10317 fix: 用 high)');
  // Setup: 穩定 100, high default 100 * 1.002 = 100.2
  // MA5 = 100, MA5 × 1.02 = 102
  // high = 100.2 ≤ 102 ✓ → Case J fires
  const klines = genKLines({
    count: 100,
    segments: [{ start: 0, end: 99, fromPrice: 100, toPrice: 100 }],
  });
  const v = await new ZmenMAAlignmentModule().detect(klines, ctx);

  assert('T10.1: Case J fires', v.meta.matchedRules.includes('J'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}`);
  console.log(`   ℹ️  matched: ${JSON.stringify(v.meta.matchedRules)}, conf=${v.confidence}`);
}

// ============ T11: Multi-rule coexistence (大少 spec) ============

async function test11() {
  console.log('\n📊 T11: Multi-rule coexistence (A + I + J 同時 fire)');
  // Setup: 穩定 100 + mild uptrend 最後 5 日 升上 110
  // 應該: Case A + Case I + Case J 同時 fire
  const klines = genKLines({
    count: 100,
    segments: [
      { start: 0, end: 89, fromPrice: 100, toPrice: 100 },
      { start: 90, end: 99, fromPrice: 110, toPrice: 110 },
    ],
  });
  const v = await new ZmenMAAlignmentModule().detect(klines, ctx);

  // Case A (last 5 days MA5 > MA60)
  // Case I (low ≥ MA5 × 0.98)
  // Case J (high ≤ MA5 × 1.02)
  assert('T11.1: Case A fires', v.meta.matchedRules.includes('A'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}`);
  assert('T11.2: Case I fires', v.meta.matchedRules.includes('I'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}`);
  assert('T11.3: Case J fires', v.meta.matchedRules.includes('J'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}`);
  console.log(`   ℹ️  matched: ${JSON.stringify(v.meta.matchedRules)}, conf=${v.confidence}`);
}

// ============ Main ============

async function main() {
  console.log('🧪 MA Alignment (v0.3.0, 大少 A-J 算法) — 11 Tests\n');

  try {
    await test1();
    await test2();
    await test3();
    await test4();
    await test5();
    await test6();
    await test7();
    await test8();
    await test9();
    await test10();
    await test11();
  } catch (err) {
    console.error('❌ Test runner error:', err.message);
    console.error(err.stack);
    failed++;
  }

  console.log(`\n📊 Result: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
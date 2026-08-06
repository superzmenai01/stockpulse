// __tests__/slope-momentum.test.mjs — SlopeMomentum (v1.0.0, 大少 #10809)
//
// 15+ tests covering 10 rules M1-M10, state derivation, confidence:
//   T1  — Step 1 data validation (< 20 days throws)
//   T2  — M1 MA5 短期加速上升 (slope(MA5, 5) > +0.5% + 連續 3 日 slope ↑)
//   T3  — M2 MA5 短期加速下跌 (slope(MA5, 5) < -0.5% + 連續 3 日 slope ↓)
//   T4  — M3 MA10 中期斜率上升 (slope(MA10, 10) > +0.3%)
//   T5  — M4 MA10 中期斜率下跌
//   T6  — M5 MA60 長期斜率上升 (slope(MA60, 20) > +0.2%)
//   T7  — M6 MA60 長期斜率下跌
//   T8  — M7 短期斜率轉正 (5 日內由負轉正)
//   T9  — M8 短期斜率轉負
//   T10 — M9 動能減弱 (|slope(MA5, 5)| < 0.1%)
//   T11 — M10 動能加強 (|slope(MA5, 5)| > 0.5%)
//   T12 — State priority (M7 > M1)
//   T13 — Confidence formula (strong=0.7, weak=+0.10)
//   T14 — Multi-rule coexistence (M1 + M3 + M5)
//
// Run: cd ~/stockpulse/algorithms/AS-03-cycle-detection
//      node --experimental-strip-types __tests__/slope-momentum.test.mjs

import { SlopeMomentum } from '../modules/slope-momentum.ts';
import { DEFAULT_SLOPE_MOMENTUM_CONFIG } from '../config.ts';

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

function genKLines(opts) {
  const { count = 100, segments = [], defaultVolume = 1000000 } = opts;
  const klines = [];
  const startTime = new Date('2026-01-01').getTime();

  const closes = new Array(count);
  for (let i = 0; i < count; i++) {
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

  for (let i = 0; i < count; i++) {
    const price = closes[i];
    klines.push({
      timestamp: startTime + i * 86400000,
      open: price, high: price, low: price, close: price, volume: defaultVolume,
    });
  }
  return klines;
}

const ctx = { symbol: 'HK.00981', ltf: '1d' };

// ============ T1: Validation (< 20 days throws) ============

async function test1() {
  console.log('\n📊 T1: Step 1 validation (< 20 days throws)');
  try {
    await new SlopeMomentum().detect(genKLines({ count: 15 }), ctx);
    assert('T1.1: should throw for 15 days', false);
  } catch (err) {
    assert('T1.1: throws for 15 days', err.message.includes('Insufficient data'),
      `got "${err.message}"`);
  }
  try {
    const v = await new SlopeMomentum().detect(genKLines({ count: 30 }), ctx);
    assert('T1.2: 30 days passes', v !== null);
  } catch (err) {
    assert('T1.2: 30 days passes', false, `got error: ${err.message}`);
  }
}

// ============ T2: M1 MA5 短期加速上升 ============

async function test2() {
  console.log('\n📊 T2: M1 MA5 短期加速上升');
  // Days 0-95: flat 100
  // Days 96-99: prices accelerating up (100, 101, 103, 106, 110)
  // Result: MA5 daily slope strictly increasing + slope(MA5, 5) > 0.5%
  const klines = genKLines({
    count: 100,
    segments: [
      { start: 0, end: 95, fromPrice: 100, toPrice: 100 },
      { start: 96, end: 99, fromPrice: 100, toPrice: 110 },
    ],
  });
  // Override specific days for accelerating pattern
  klines[95].close = 100;
  klines[96].close = 101;
  klines[97].close = 103;
  klines[98].close = 106;
  klines[99].close = 110;

  const v = await new SlopeMomentum().detect(klines, ctx);

  assert('T2.1: M1 fires', v.meta.matchedRules.includes('M1'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}, slopeMA5=${v.meta.latestSlopeMA5}`);
  assert('T2.2: state = UP (M1 priority)', v.state === 'UP', `got ${v.state}`);
  console.log(`   ℹ️  matched: ${JSON.stringify(v.meta.matchedRules)}, slopeMA5=${v.meta.latestSlopeMA5}, state=${v.state}`);
}

// ============ T3: M2 MA5 短期加速下跌 ============

async function test3() {
  console.log('\n📊 T3: M2 MA5 短期加速下跌');
  // Symmetric to T2: prices accelerating DOWN
  const klines = genKLines({
    count: 100,
    segments: [
      { start: 0, end: 95, fromPrice: 100, toPrice: 100 },
      { start: 96, end: 99, fromPrice: 100, toPrice: 90 },
    ],
  });
  klines[95].close = 100;
  klines[96].close = 99;
  klines[97].close = 97;
  klines[98].close = 94;
  klines[99].close = 90;

  const v = await new SlopeMomentum().detect(klines, ctx);

  assert('T3.1: M2 fires', v.meta.matchedRules.includes('M2'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}, slopeMA5=${v.meta.latestSlopeMA5}`);
  assert('T3.2: state = DOWN (M2 priority)', v.state === 'DOWN', `got ${v.state}`);
  console.log(`   ℹ️  matched: ${JSON.stringify(v.meta.matchedRules)}, slopeMA5=${v.meta.latestSlopeMA5}, state=${v.state}`);
}

// ============ T4: M3 MA10 中期斜率上升 ============

async function test4() {
  console.log('\n📊 T4: M3 MA10 中期斜率上升');
  // Need slope(MA10, 10) > +0.3% (medium)
  // Use a steady uptrend over 10+ days
  const klines = genKLines({
    count: 100,
    segments: [
      { start: 0, end: 89, fromPrice: 100, toPrice: 100 },
      { start: 90, end: 99, fromPrice: 100, toPrice: 110 },
    ],
  });
  const v = await new SlopeMomentum().detect(klines, ctx);

  assert('T4.1: M3 fires', v.meta.matchedRules.includes('M3'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}, slopeMA10=${v.meta.latestSlopeMA10}`);
  console.log(`   ℹ️  matched: ${JSON.stringify(v.meta.matchedRules)}, slopeMA10=${v.meta.latestSlopeMA10}`);
}

// ============ T5: M4 MA10 中期斜率下跌 ============

async function test5() {
  console.log('\n📊 T5: M4 MA10 中期斜率下跌');
  const klines = genKLines({
    count: 100,
    segments: [
      { start: 0, end: 89, fromPrice: 100, toPrice: 100 },
      { start: 90, end: 99, fromPrice: 100, toPrice: 90 },
    ],
  });
  const v = await new SlopeMomentum().detect(klines, ctx);

  assert('T5.1: M4 fires', v.meta.matchedRules.includes('M4'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}, slopeMA10=${v.meta.latestSlopeMA10}`);
  console.log(`   ℹ️  matched: ${JSON.stringify(v.meta.matchedRules)}, slopeMA10=${v.meta.latestSlopeMA10}`);
}

// ============ T6: M5 MA60 長期斜率上升 ============

async function test6() {
  console.log('\n📊 T6: M5 MA60 長期斜率上升');
  // Need slope(MA60, 20) > +0.2%
  // Long-term uptrend
  const klines = genKLines({
    count: 100,
    segments: [
      { start: 0, end: 79, fromPrice: 100, toPrice: 100 },
      { start: 80, end: 99, fromPrice: 100, toPrice: 120 },
    ],
  });
  const v = await new SlopeMomentum().detect(klines, ctx);

  assert('T6.1: M5 fires', v.meta.matchedRules.includes('M5'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}, slopeMA60=${v.meta.latestSlopeMA60}`);
  console.log(`   ℹ️  matched: ${JSON.stringify(v.meta.matchedRules)}, slopeMA60=${v.meta.latestSlopeMA60}`);
}

// ============ T7: M6 MA60 長期斜率下跌 ============

async function test7() {
  console.log('\n📊 T7: M6 MA60 長期斜率下跌');
  const klines = genKLines({
    count: 100,
    segments: [
      { start: 0, end: 79, fromPrice: 100, toPrice: 100 },
      { start: 80, end: 99, fromPrice: 100, toPrice: 80 },
    ],
  });
  const v = await new SlopeMomentum().detect(klines, ctx);

  assert('T7.1: M6 fires', v.meta.matchedRules.includes('M6'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}, slopeMA60=${v.meta.latestSlopeMA60}`);
  console.log(`   ℹ️  matched: ${JSON.stringify(v.meta.matchedRules)}, slopeMA60=${v.meta.latestSlopeMA60}`);
}

// ============ T8: M7 短期斜率轉正 (5 日內由負轉正) ============

async function test8() {
  console.log('\n📊 T8: M7 短期斜率轉正');
  // Setup: 長時間 downtrend 直至 day 94, 然後 day 95-99 急速反彈
  // 確保 lookback window [95..98] 入面有 slope 負值 (day 95 仍然係 downtrend 尾部)
  // 同時 day 99 slope 係正
  const klines = genKLines({
    count: 100,
    segments: [
      { start: 0, end: 94, fromPrice: 110, toPrice: 80 },
      { start: 95, end: 99, fromPrice: 80, toPrice: 110 },
    ],
  });
  const v = await new SlopeMomentum().detect(klines, ctx);

  assert('T8.1: M7 fires', v.meta.matchedRules.includes('M7'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}, slopeMA5=${v.meta.latestSlopeMA5}`);
  assert('T8.2: state = TRANSITION (M7 priority)', v.state === 'TRANSITION', `got ${v.state}`);
  console.log(`   ℹ️  matched: ${JSON.stringify(v.meta.matchedRules)}, slopeMA5=${v.meta.latestSlopeMA5}, state=${v.state}`);
}

// ============ T9: M8 短期斜率轉負 ============

async function test9() {
  console.log('\n📊 T9: M8 短期斜率轉負');
  // Opposite: long uptrend till day 94, then sharp drop
  const klines = genKLines({
    count: 100,
    segments: [
      { start: 0, end: 94, fromPrice: 90, toPrice: 120 },
      { start: 95, end: 99, fromPrice: 120, toPrice: 90 },
    ],
  });
  const v = await new SlopeMomentum().detect(klines, ctx);

  assert('T9.1: M8 fires', v.meta.matchedRules.includes('M8'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}, slopeMA5=${v.meta.latestSlopeMA5}`);
  assert('T9.2: state = TRANSITION (M8 priority)', v.state === 'TRANSITION', `got ${v.state}`);
  console.log(`   ℹ️  matched: ${JSON.stringify(v.meta.matchedRules)}, slopeMA5=${v.meta.latestSlopeMA5}, state=${v.state}`);
}

// ============ T10: M9 動能減弱 ============

async function test10() {
  console.log('\n📊 T10: M9 動能減弱');
  // Flat market: slope ≈ 0
  const klines = genKLines({
    count: 100,
    segments: [
      { start: 0, end: 99, fromPrice: 100, toPrice: 100 },
    ],
  });
  const v = await new SlopeMomentum().detect(klines, ctx);

  assert('T10.1: M9 fires', v.meta.matchedRules.includes('M9'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}, slopeMA5=${v.meta.latestSlopeMA5}`);
  assert('T10.2: state = SIDEWAYS (M9)', v.state === 'SIDEWAYS', `got ${v.state}`);
  console.log(`   ℹ️  matched: ${JSON.stringify(v.meta.matchedRules)}, slopeMA5=${v.meta.latestSlopeMA5}, state=${v.state}`);
}

// ============ T11: M10 動能加強 ============

async function test11() {
  console.log('\n📊 T11: M10 動能加強');
  // Strong uptrend: |slope(MA5, 5)| > 0.5%
  // But not accelerating (so M1 doesn't fire — daily slopes not strictly increasing)
  // Constant uptrend over 5 days
  const klines = genKLines({
    count: 100,
    segments: [
      { start: 0, end: 94, fromPrice: 100, toPrice: 100 },
      { start: 95, end: 99, fromPrice: 100, toPrice: 102 },
    ],
  });
  // Override: linear uptrend 100 → 105 over 5 days
  klines[95].close = 100;
  klines[96].close = 101.25;
  klines[97].close = 102.5;
  klines[98].close = 103.75;
  klines[99].close = 105;

  const v = await new SlopeMomentum().detect(klines, ctx);

  assert('T11.1: M10 fires', v.meta.matchedRules.includes('M10'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}, slopeMA5=${v.meta.latestSlopeMA5}`);
  // M10 fires → state = UP (per priority)
  assert('T11.2: state = UP (M10)', v.state === 'UP', `got ${v.state}`);
  console.log(`   ℹ️  matched: ${JSON.stringify(v.meta.matchedRules)}, slopeMA5=${v.meta.latestSlopeMA5}, state=${v.state}`);
}

// ============ T12: State priority (M7 > M1) ============

async function test12() {
  console.log('\n📊 T12: State priority (M7 > M1 — TRANSITION > UP)');
  // Setup that fires both M7 and M1
  // M1 needs: slope(MA5, 5) > 0.5% AND 連續 3 日 daily slope ↑
  // M7 needs: slope(MA5, 5) currently positive, was negative recently
  // Combined: downtrend → uptrend reversal with accelerating move

  // Days 0-89: downtrend (100 → 90)
  // Days 90-95: continued decline (90 → 88)
  // Days 96-99: accelerating upturn (88 → 100)
  const klines = genKLines({
    count: 100,
    segments: [
      { start: 0, end: 89, fromPrice: 100, toPrice: 90 },
      { start: 90, end: 95, fromPrice: 90, toPrice: 88 },
      { start: 96, end: 99, fromPrice: 88, toPrice: 100 },
    ],
  });
  klines[95].close = 88;
  klines[96].close = 90;
  klines[97].close = 94;
  klines[98].close = 98;
  klines[99].close = 100;

  const v = await new SlopeMomentum().detect(klines, ctx);

  assert('T12.1: M7 fires', v.meta.matchedRules.includes('M7'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}, slopeMA5=${v.meta.latestSlopeMA5}`);
  assert('T12.2: state = TRANSITION (M7 > M1)', v.state === 'TRANSITION',
    `got ${v.state}, matched: ${JSON.stringify(v.meta.matchedRules)}`);
  console.log(`   ℹ️  matched: ${JSON.stringify(v.meta.matchedRules)}, state=${v.state}`);
}

// ============ T13: Confidence formula ============

async function test13() {
  console.log('\n📊 T13: Confidence formula');

  // Strong rule (M1 fires) → conf = 0.7
  // 但 M10 (|slope| > 0.5%) 都會 fire 因為 M1 condition 已要求 slope > 0.5%
  // 所以 conf = 0.7 (strong) + 0.10 (weak bonus) = 0.8
  const klines1 = genKLines({
    count: 100,
    segments: [
      { start: 0, end: 95, fromPrice: 100, toPrice: 100 },
      { start: 96, end: 99, fromPrice: 100, toPrice: 110 },
    ],
  });
  klines1[95].close = 100;
  klines1[96].close = 101;
  klines1[97].close = 103;
  klines1[98].close = 106;
  klines1[99].close = 110;
  const v1 = await new SlopeMomentum().detect(klines1, ctx);
  assert('T13.1: M1 (strong) + M10 (weak) → conf = 0.8',
    v1.confidence === 0.8,
    `got ${v1.confidence}, matched: ${JSON.stringify(v1.meta.matchedRules)}`);

  // Medium rule (M3 fires alone) → conf = 0.5
  // Need: slope(MA10, 10) > 0.003 BUT slope(MA5, 5) ≤ 0.005 (so M10 doesn't fire)
  // And slope(MA5, 5) > 0 (so M9 doesn't fire)
  // 慢上升 trend: days 0-89 flat 100, days 90-94 升上 100.5, days 95-99 flat 100.5
  // → slope(MA5, 5) ≈ 0.0025 (< 0.005, M10 off), slope(MA10, 10) ≈ 0.00375 (> 0.003, M3 on)
  const klines2 = genKLines({
    count: 100,
    segments: [
      { start: 0, end: 89, fromPrice: 100, toPrice: 100 },
      { start: 90, end: 94, fromPrice: 100, toPrice: 100.5 },
      { start: 95, end: 99, fromPrice: 100.5, toPrice: 100.5 },
    ],
  });
  const v2 = await new SlopeMomentum().detect(klines2, ctx);
  assert('T13.2: M3 (medium) → conf = 0.5',
    v2.confidence === 0.5,
    `got ${v2.confidence}, matched: ${JSON.stringify(v2.meta.matchedRules)}`);

  // Weak rule (M9 alone) → conf = 0.5 + 0.10 = 0.6
  const klines3 = genKLines({
    count: 100,
    segments: [
      { start: 0, end: 99, fromPrice: 100, toPrice: 100 },
    ],
  });
  const v3 = await new SlopeMomentum().detect(klines3, ctx);
  assert('T13.3: M9 (weak) → conf = 0.6',
    v3.confidence === 0.6,
    `got ${v3.confidence}, matched: ${JSON.stringify(v3.meta.matchedRules)}`);
}

// ============ T14: Multi-rule coexistence (M1 + M3 + M5) ============

async function test14() {
  console.log('\n📊 T14: Multi-rule coexistence (M1 + M3 + M5)');
  // Strong sustained uptrend with accelerating tail: M1 + M3 + M5 all fire
  // Last 5 days accelerating override
  const klines = genKLines({
    count: 100,
    segments: [
      { start: 0, end: 69, fromPrice: 100, toPrice: 100 },
      { start: 70, end: 99, fromPrice: 100, toPrice: 125 },
    ],
  });
  // Override last 5 days with accelerating pattern
  klines[95].close = 125;
  klines[96].close = 127;
  klines[97].close = 130;
  klines[98].close = 134;
  klines[99].close = 140;

  const v = await new SlopeMomentum().detect(klines, ctx);

  assert('T14.1: M1 fires', v.meta.matchedRules.includes('M1'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}`);
  assert('T14.2: M3 fires', v.meta.matchedRules.includes('M3'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}`);
  assert('T14.3: M5 fires', v.meta.matchedRules.includes('M5'),
    `matched: ${JSON.stringify(v.meta.matchedRules)}`);
  assert('T14.4: state = UP (M1/M3/M5 priority)', v.state === 'UP',
    `got ${v.state}, matched: ${JSON.stringify(v.meta.matchedRules)}`);
  console.log(`   ℹ️  matched: ${JSON.stringify(v.meta.matchedRules)}, conf=${v.confidence}, state=${v.state}`);
}

// ============ Main ============

async function main() {
  console.log('🧪 SlopeMomentum (v1.0.0, 大少 #10809) — 14 Tests\n');

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
    await test12();
    await test13();
    await test14();
  } catch (err) {
    console.error('❌ Test runner error:', err.message);
    console.error(err.stack);
    failed++;
  }

  console.log(`\n📊 Result: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
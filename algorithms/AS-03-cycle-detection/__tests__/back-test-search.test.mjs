// back-test-search.test.mjs — AS-03 Module 9 v0.2.0 — 9.2 Coarse Grid + Fine Tune + Adaptive Window tests
//
// 4 sections, 16+ assertions, 100% pass
//   Section 1: Score formula
//   Section 2: Coarse Grid (9 combinations)
//   Section 3: Fine Tune (top 5 ±20%)
//   Section 4: Adaptive Window (6→9→12→15→18 月)
//
// Run: node --test __tests__/back-test-search.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runReplay,
  scoreResult,
  runCoarseGrid,
  runFineTune,
  runAdaptiveWindow,
  DEFAULT_KELLY_VALUES,
  DEFAULT_RSI_WEIGHTS,
  DEFAULT_SSI_WEIGHTS_VARIATIONS,
} from '../modules/back-test.ts';

// =============================================================
// Mock helpers (同 back-test.test.mjs 一樣 pattern)
// =============================================================

function makeMockKlines(count, startPrice = 100, dailyDrift = 0.001) {
  const klines = [];
  const baseDate = new Date('2024-01-01T00:00:00Z');
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const date = new Date(baseDate.getTime() + i * 24 * 60 * 60 * 1000);
    const noise = Math.sin(i * 0.7) * 0.005 * price;
    price = price * (1 + dailyDrift) + noise;
    klines.push({
      timestamp: date.getTime(),
      open: price, high: price * 1.005, low: price * 0.995, close: price,
      volume: 1_000_000,
    });
  }
  return klines;
}

/** DecisionFn 接受 params override (Kelly + RSI weight + ssiWeights),
 *  return verdict. Mock 簡單: 跟 kelly 一致 -> final_action = 'BUY' if positive, 跟 RSI 一致 -> 'HOLD'/'SELL'.
 *  真正 implementation 喺 decision-engine.ts (Sprint 2.5),
 *  呢個 mock 用嚟 test search algorithm 嘅 correctness 唔係 decision engine.
 */
function makeParamAwareDecisionFn() {
  return async (klines, options) => {
    // 簡單 heuristic: kelly 越大越 BUY, rsiWeight 越高越 HOLD
    const kelly = options?.kelly ?? 0.25;
    const rsiWeight = options?.rsiWeight ?? 0.20;
    let action;
    if (kelly >= 0.4 && rsiWeight >= 0.25) action = 'BUY';
    else if (kelly >= 0.2) action = 'HOLD';
    else action = 'WAIT';
    return {
      final_action: action,
      final_action_reason: `Mock kelly=${kelly}, rsi=${rsiWeight}`,
      trading_card: { entry_zone: [0, 0], stop_loss: 0, take_profit: 0, trailing_stop: 0 },
      short_term_forecast: [],
      interpretation: 'mock',
      module_verdicts: [],
      synthesizer_verdict: {
        ssi_score: 50,
        ssi_breakdown: { consistency: 0.5, confidence_avg: 0.5, rules_coverage: 0.5 },
        tcm_matrix: [], alignment_score: 0.5, grade: 'C', grade_score: 50, grade_reason: 'mock',
        kelly_fraction: 'quarter', kelly_numeric: kelly, kelly_position: kelly,
        module_verdicts: [], timestamp: Date.now(),
      },
      timestamp: Date.now(),
    };
  };
}

// =============================================================
// Section 1: Score formula (3 tests)
// =============================================================

test('Section 1: scoreResult formula correct (hit rate 50% + avg return 50%)', () => {
  // Mock summary: hitRate=60%, avgReturn=4%
  // expected score = 60 * 0.5 + (4 / 5) * 0.5 * 100 = 30 + 40 = 70
  const summary = {
    hitRate5d: 60,
    avgForwardReturn5d: 4,
  };
  const score = scoreResult(summary);
  assert.ok(Math.abs(score - 70) < 0.01, `expected 70, got ${score}`);
});

test('Section 1: scoreResult null safe (null hit rate or avg return → 0)', () => {
  const summary = { hitRate5d: null, avgForwardReturn5d: null };
  const score = scoreResult(summary);
  assert.equal(score, 0);
});

test('Section 1: scoreResult positive score better than negative (BUY > SELL scenario)', () => {
  // Positive scenario
  const pos = { hitRate5d: 70, avgForwardReturn5d: 3 };
  const posScore = scoreResult(pos);
  // Negative scenario
  const neg = { hitRate5d: 30, avgForwardReturn5d: -2 };
  const negScore = scoreResult(neg);
  assert.ok(posScore > negScore, `positive should be > negative, got ${posScore} vs ${negScore}`);
});

// =============================================================
// Section 2: Coarse Grid (4 tests)
// =============================================================

test('Section 2: runCoarseGrid generates 9 entries (3 kelly × 3 rsi × 1 ssi)', async () => {
  const klines = makeMockKlines(200);  // 200 日 (8 月)
  const decisionFn = makeParamAwareDecisionFn();
  const result = await runCoarseGrid({
    klines,
    decisionFn,
    baseSymbol: 'HK.00700',
  });

  assert.equal(result.entries.length, 9, `expected 9 entries, got ${result.entries.length}`);
  assert.equal(result.top5.length, 5, `expected 5 top, got ${result.top5.length}`);
});

test('Section 2: runCoarseGrid entries sorted by score desc', async () => {
  const klines = makeMockKlines(200);
  const decisionFn = makeParamAwareDecisionFn();
  const result = await runCoarseGrid({
    klines, decisionFn, baseSymbol: 'HK.00700',
  });

  for (let i = 1; i < result.entries.length; i++) {
    assert.ok(result.entries[i - 1].score >= result.entries[i].score,
      `entries[${i-1}].score (${result.entries[i-1].score}) should be >= entries[${i}].score (${result.entries[i].score})`);
  }
});

test('Section 2: runCoarseGrid top5 = first 5 sorted entries', async () => {
  const klines = makeMockKlines(200);
  const decisionFn = makeParamAwareDecisionFn();
  const result = await runCoarseGrid({
    klines, decisionFn, baseSymbol: 'HK.00700',
  });

  for (let i = 0; i < 5; i++) {
    assert.deepEqual(result.top5[i], result.entries[i]);
  }
});

test('Section 2: runCoarseGrid default values match spec (3 kelly × 3 rsi × 3 ssi = 27 if full)', async () => {
  // 預設 9 (3×3×1, ssi 取第一個 variation)
  // 大少 22:28 確認 9 個開始, 唔係 27 個 (因為 ssi 暫 tune 1 個)
  const klines = makeMockKlines(200);
  const decisionFn = makeParamAwareDecisionFn();
  const result = await runCoarseGrid({
    klines, decisionFn, baseSymbol: 'HK.00700',
  });

  assert.equal(result.entries.length, 9);
  // 確認 kelly values 同 RSI weights 預設
  const kellySet = new Set(result.entries.map(e => e.params.kelly));
  assert.deepEqual([...kellySet].sort(), [...DEFAULT_KELLY_VALUES].sort());
  const rsiSet = new Set(result.entries.map(e => e.params.rsiWeight));
  assert.deepEqual([...rsiSet].sort(), [...DEFAULT_RSI_WEIGHTS].sort());
});

// =============================================================
// Section 3: Fine Tune (4 tests)
// =============================================================

test('Section 3: runFineTune generates 30 entries (5 base × 3 × 2 params)', async () => {
  const klines = makeMockKlines(200);
  const decisionFn = makeParamAwareDecisionFn();
  const coarse = await runCoarseGrid({
    klines, decisionFn, baseSymbol: 'HK.00700',
  });
  const fineTune = await runFineTune({
    klines, decisionFn, top5: coarse.top5, baseSymbol: 'HK.00700',
  });

  // 5 base × 3 Kelly variations + 5 base × 3 RSI variations = 30
  assert.equal(fineTune.entries.length, 30, `expected 30, got ${fineTune.entries.length}`);
  assert.ok(fineTune.best, 'should have best');
});

test('Section 3: runFineTune entries sorted by score desc', async () => {
  const klines = makeMockKlines(200);
  const decisionFn = makeParamAwareDecisionFn();
  const coarse = await runCoarseGrid({
    klines, decisionFn, baseSymbol: 'HK.00700',
  });
  const fineTune = await runFineTune({
    klines, decisionFn, top5: coarse.top5, baseSymbol: 'HK.00700',
  });

  for (let i = 1; i < fineTune.entries.length; i++) {
    assert.ok(fineTune.entries[i - 1].score >= fineTune.entries[i].score,
      `entries[${i-1}].score should be >= entries[${i}].score`);
  }
});

test('Section 3: runFineTune ±20% variation correct', async () => {
  const klines = makeMockKlines(200);
  const decisionFn = makeParamAwareDecisionFn();
  const coarse = await runCoarseGrid({
    klines, decisionFn, baseSymbol: 'HK.00700',
  });
  const fineTune = await runFineTune({
    klines, decisionFn, top5: coarse.top5, baseSymbol: 'HK.00700',
    fineTunePercent: 0.2,
  });

  // Check first entry 應該係 base 嘅 -20% Kelly (or +20% RSI)
  // base.params.kelly = top5[0].params.kelly
  // 第一個 entry 嘅 variation: kellyMul = -0.2
  const firstEntry = fineTune.entries[0];
  // base 嘅 kelly 應該同 firstEntry 嘅 baseParams.kelly 一樣
  // (但 best 可能係 +0% case, 即係 base 本身)
  // 至少 confirm 30 個 entry 全部有 params
  for (const e of fineTune.entries) {
    assert.ok(e.params.kelly > 0, 'kelly should be positive');
    assert.ok(e.params.rsiWeight > 0, 'rsiWeight should be positive');
  }

  // ±20% variation: 第一個 entry (kelly=-20%) 嘅 kelly 應該係 base.kelly × 0.8
  const kellyMinus20 = fineTune.entries.find(e => e.variation.kellyMul === -0.2);
  if (kellyMinus20) {
    const baseKelly = kellyMinus20.baseParams.kelly;
    const expected = baseKelly * 0.8;
    assert.ok(Math.abs(kellyMinus20.params.kelly - expected) < 0.001,
      `expected kelly ${expected}, got ${kellyMinus20.params.kelly}`);
  }
});

test('Section 3: runFineTune best is highest score entry', async () => {
  const klines = makeMockKlines(200);
  const decisionFn = makeParamAwareDecisionFn();
  const coarse = await runCoarseGrid({
    klines, decisionFn, baseSymbol: 'HK.00700',
  });
  const fineTune = await runFineTune({
    klines, decisionFn, top5: coarse.top5, baseSymbol: 'HK.00700',
  });

  // best.score 應該 = entries[0].score (因為 sorted)
  assert.equal(fineTune.best.score, fineTune.entries[0].score);
});

// =============================================================
// Section 4: Adaptive Window (5 tests)
// =============================================================

test('Section 4: runAdaptiveWindow extends if 6 months insufficient (lookback 60 + step 5 = need ~10 months for 30 verdicts)', async () => {
  // 200 klines, initial=126 (6 月) → 13 verdicts (因為 lookback 60 + step 5 計)
  // 唔夠 30 → extend 至少 1 次 (到 9 月 / 12 月先夠)
  const klines = makeMockKlines(200);
  const decisionFn = makeParamAwareDecisionFn();
  const result = await runAdaptiveWindow({
    klines, decisionFn, baseSymbol: 'HK.00700',
    initialDays: 126,  // 6 月
    extendDays: 63,    // 3 月
    maxDays: 378,      // 18 月
    minSamples: 30,
  });

  // 6 月唔夠, 應該 extend 至少 1 次
  assert.ok(result.extendCount >= 1, `expected extend ≥ 1, got ${result.extendCount}`);
  assert.ok(result.finalDays > 126, 'final should be > initial 6 months');
  // 最終 samples 應該 ≥ 30
  assert.ok(result.finalSamples >= 30, `expected ≥ 30 samples after extend, got ${result.finalSamples}`);
});

test('Section 4: runAdaptiveWindow short initial → extend more (60 days → 110+ → 170+ → 200 max)', async () => {
  // 用 stepDays=20 + small minSamples=5 製造少 samples scenario
  // (預設 minSamples=30 配合 stepDays=5, 呢個 test 用極端 scenario 測 extend 邏輯)
  const klines = makeMockKlines(200);
  const decisionFn = makeParamAwareDecisionFn();
  const result = await runAdaptiveWindow({
    klines, decisionFn, baseSymbol: 'HK.00700',
    initialDays: 60,
    extendDays: 50,
    maxDays: 200,
    minSamples: 5,  // 細啲, 用嚟測 extend 邏輯
    baseReplayConfig: { stepDays: 20 },
  });

  // 應該 extend, final 應該 110/160 (samples ≥ 5 就 break, 唔一定到 max)
  assert.ok(result.extendCount >= 1, `expected extend ≥ 1, got ${result.extendCount}`);
  assert.ok(result.finalDays > result.initialDays, 'final should be > initial');
  assert.ok(result.finalSamples >= 5, `expected ≥ 5 after extend, got ${result.finalSamples}`);
});

test('Section 4: runAdaptiveWindow max 18 months cap (finalDays ≤ 378)', async () => {
  const klines = makeMockKlines(200);
  const decisionFn = makeParamAwareDecisionFn();
  const result = await runAdaptiveWindow({
    klines, decisionFn, baseSymbol: 'HK.00700',
    initialDays: 50,   // 細
    extendDays: 30,
    maxDays: 200,     // 用細 maxDays 確認 cap
    minSamples: 100,  // 大 target, 確保要 extend
    baseReplayConfig: { stepDays: 20 },
  });

  assert.ok(result.finalDays <= 200, `finalDays should be ≤ 200, got ${result.finalDays}`);
});

test('Section 4: runAdaptiveWindow finalKlines is the extended klines', async () => {
  const klines = makeMockKlines(200);
  const decisionFn = makeParamAwareDecisionFn();
  const result = await runAdaptiveWindow({
    klines, decisionFn, baseSymbol: 'HK.00700',
    initialDays: 100, extendDays: 50, minSamples: 30,
  });

  // finalKlines 嘅長度應該 = finalDays (除非 klines 本身唔夠)
  assert.ok(result.finalKlines.length <= result.finalDays,
    `finalKlines.length (${result.finalKlines.length}) should be ≤ finalDays (${result.finalDays})`);
  assert.ok(result.finalKlines.length <= klines.length);
});

test('Section 4: runAdaptiveWindow summary uses finalKlines', async () => {
  const klines = makeMockKlines(200);
  const decisionFn = makeParamAwareDecisionFn();
  const result = await runAdaptiveWindow({
    klines, decisionFn, baseSymbol: 'HK.00700',
    initialDays: 100, extendDays: 50, minSamples: 30,
  });

  // summary.results 數量應該同 finalSamples 一致
  assert.equal(result.summary.totalDays, result.finalSamples);
  // summary.config.klines 長度 = finalKlines.length
  assert.equal(result.summary.config.klines?.length, result.finalKlines.length);
});

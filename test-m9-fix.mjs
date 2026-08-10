// Test M9 fix 喺 Node.js environment
import { runWalkForwardCV } from '/Users/zmenai/stockpulse/algorithms/AS-03-cycle-detection/build/back-test.bundle.js';

// Mock decisionFn 模擬 HLStructure 失敗情況
const decisionFn = async (klines, options) => {
  if (klines.length < 99) {
    throw new Error(`[HLStructure] Insufficient data: need ≥ 99 bars, got ${klines.length}`);
  }
  return {
    final_action: 'BUY',
    confidence: 0.7,
    state: 'UP',
  };
};

// Mock 300 條 HK.00700 K 線(模仿 backend 真實 data)
const klines = Array.from({ length: 300 }, (_, i) => ({
  timestamp: Date.now() - (300 - i) * 86400000,
  open: 500 + Math.random() * 10,
  high: 510 + Math.random() * 10,
  low: 490 + Math.random() * 10,
  close: 500 + Math.random() * 10,
  volume: 1000000 + i * 1000,
}));

console.log('=== Test 1: Default walk-forward CV (300 klines, 3 folds) ===');
const result = await runWalkForwardCV({
  klines,
  baseSymbol: 'HK.00700',
  decisionFn,
  numFolds: 1,  // 大少 2026-08-10 08:35 fix
  tuneRatio: 0.6,  // tune 60% (180 > 99 ✅) + validate 40% (120 > 99 ✅) for 300 K 線 mock
  baseReplayConfig: {
    holdDays: [5, 10, 20],
    stepDays: 5,
    lookbackDays: 0,  // 累積
  },
});
console.log(`\n總結果:`);
console.log(`  folds: ${result.folds.length}`);
console.log(`  overall.totalValidateSamples: ${result.overall.totalValidateSamples}`);
console.log(`  overall.avgValidateScore: ${result.overall.avgValidateScore}`);
for (let i = 0; i < result.folds.length; i++) {
  const f = result.folds[i];
  console.log(`  Fold ${i+1}: tuneScore=${f.tuneScore?.toFixed(1)} validateScore=${f.validateScore?.toFixed(1)} validateSamples=${f.validateSamples} (tuneKlines=${f.tuneKlines?.length} validateKlines=${f.validateKlines?.length})`);
}

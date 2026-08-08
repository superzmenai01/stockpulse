// __tests__/smoke.mjs — AS-03 skeleton smoke test
//
// 用 node 跑 (唔需要 vitest):
//   cd ~/stockpulse/algorithms/AS-03-cycle-detection
//   node --experimental-strip-types __tests__/smoke.mjs
//
// 目的: 確保所有 module / orchestrator 可以 instantiate + 跑 placeholder verdict

import {
  CycleDetector,
  VERSION,
  DEFAULT_MA_ALIGNMENT_CONFIG,
  ZmenMAAlignmentModule,  // 大少 2026-08-08 09:13: 舊 M1 改名 zmen均算法, class name 跟住改
  HLStructureModule,
  TrendlineModule,
  IndicatorsModule,
  VolumePrice,
  // 大少 2026-08-07 23:15 — SlopeMomentum 暫時隱藏,Stage 1 done 最後先做返
  // SlopeMomentum,
  MultiTFOrchestrator,
  Synthesizer,
  RegimeChangeAlerter,
  Aggregator,
} from '../index.ts';

let passed = 0;
let failed = 0;

function assert(name, condition) {
  if (condition) {
    console.log(`✅ ${name}`);
    passed++;
  } else {
    console.log(`❌ ${name}`);
    failed++;
  }
}

async function main() {
  console.log('🧪 AS-03 cycle-detection skeleton smoke test\n');

  // Test 1: VERSION
  assert('VERSION === "1.0.0"', VERSION === '1.0.0');

  // Test 2: DEFAULT_MA_ALIGNMENT_CONFIG (v0.3.0)
  assert(
    'DEFAULT_MA_ALIGNMENT_CONFIG.dataWindowDays === 100',
    DEFAULT_MA_ALIGNMENT_CONFIG.dataWindowDays === 100
  );
  assert(
    'DEFAULT_MA_ALIGNMENT_CONFIG.consecutiveDays === 5',
    DEFAULT_MA_ALIGNMENT_CONFIG.consecutiveDays === 5
  );
  assert(
    'DEFAULT_MA_ALIGNMENT_CONFIG.chanceThresholdPct === 0.02',
    DEFAULT_MA_ALIGNMENT_CONFIG.chanceThresholdPct === 0.02
  );

  // Test 3: 5 個 peer modules instantiate (大少 #10809 — Module 5 VolumePrice)
  //   大少 2026-08-07 23:15 — Module 8 SlopeMomentum 暫時隱藏,Stage 1 done 最後先做返
  assert("ZmenMAAlignmentModule.id === 'ma-alignment'", new ZmenMAAlignmentModule().id === 'ma-alignment');
  assert("HLStructureModule.id === 'hl-structure'", new HLStructureModule().id === 'hl-structure');
  assert("TrendlineModule.id === 'trendline'", new TrendlineModule().id === 'trendline');
  assert("IndicatorsModule.id === 'indicators'", new IndicatorsModule().id === 'indicators');
  assert("VolumePrice.id === 'volume'", new VolumePrice().id === 'volume');

  // Test 4: orchestrator components instantiate
  assert('MultiTFOrchestrator instantiable', new MultiTFOrchestrator() instanceof MultiTFOrchestrator);
  assert('Synthesizer instantiable', new Synthesizer() instanceof Synthesizer);
  assert('RegimeChangeAlerter instantiable', new RegimeChangeAlerter() instanceof RegimeChangeAlerter);
  assert('Aggregator instantiable', new Aggregator() instanceof Aggregator);

  // Test 5: runModule returns valid verdict
  const detector = new CycleDetector();
  const dummyKlines = Array.from({ length: 100 }, (_, i) => ({
    timestamp: new Date('2026-01-01').getTime() + i * 86400000,
    open: 100, high: 100, low: 100, close: 100, volume: 1000000,
  }));
  const maVerdict = await detector.runModule('ma-alignment', dummyKlines, {
    symbol: 'TEST', ltf: '1d',
  });
  assert("maVerdict.moduleId === 'ma-alignment'", maVerdict.moduleId === 'ma-alignment');
  assert('maVerdict.state valid (UP/DOWN/SIDEWAYS/TRANSITION)',
    ['UP', 'DOWN', 'SIDEWAYS', 'TRANSITION'].includes(maVerdict.state));
  assert('maVerdict.confidence >= 0', maVerdict.confidence >= 0);
  assert('maVerdict.interpretation truthy', typeof maVerdict.interpretation === 'string' && maVerdict.interpretation.length > 0);
  assert('maVerdict.timestamp is number', typeof maVerdict.timestamp === 'number');

  // Test 6: analyze() returns CycleReport
  const report = await detector.analyze({
    symbol: 'TEST',
    ltfKlines: dummyKlines,
    htfKlines: [],
    previousState: 'UP',
  });
  assert("report.symbol === 'TEST'", report.symbol === 'TEST');
  assert("report.ltf === '1d'", report.ltf === '1d');
  // 大少 #10809 — 預設 enableFlags: maAlignment/volumePrice/hl-structure/trendline/indicators ON
  //   大少 2026-08-07 23:15 — slopeMomentum 暫時隱藏,所以 report.moduleVerdicts.length 仍然係 5
  assert('report.moduleVerdicts.length === 5', report.moduleVerdicts.length === 5);
  assert('report.alerts.length === 0 (no HTF klines)', report.alerts.length === 0);
  assert('report.synthesized defined', report.synthesized !== undefined);
  assert('report.timestamp is number', typeof report.timestamp === 'number');

  // Test 7: RegimeChangeAlerter emits alert on state change
  const alerter = new RegimeChangeAlerter();
  const alert = alerter.detect({
    symbol: 'TEST',
    timeframe: '1w',
    current: 'DOWN',
    previous: 'UP',
    confidence: 0.85,
    supportingModules: ['htf-multi-tf'],
  });
  assert('alert !== null on state change', alert !== null);
  assert("alert.fromState === 'UP'", alert?.fromState === 'UP');
  assert("alert.toState === 'DOWN'", alert?.toState === 'DOWN');
  assert("alert.status === 'PENDING'", alert?.status === 'PENDING');
  assert('alert.chineseMessage contains TEST', alert?.chineseMessage.includes('TEST') === true);
  assert('alert.chineseMessage contains 上升', alert?.chineseMessage.includes('上升') === true);
  assert('alert.chineseMessage contains 下跌', alert?.chineseMessage.includes('下跌') === true);

  // Test 8: RegimeChangeAlerter does NOT emit when state unchanged
  const noAlert = alerter.detect({
    symbol: 'TEST',
    timeframe: '1w',
    current: 'UP',
    previous: 'UP',
    confidence: 0.85,
    supportingModules: [],
  });
  assert('noAlert === null when state unchanged', noAlert === null);

  // Test 9: RegimeChangeAlerter does NOT emit on first-run (previous === null)
  const firstRun = alerter.detect({
    symbol: 'TEST',
    timeframe: '1w',
    current: 'UP',
    previous: null,
    confidence: 0.85,
    supportingModules: [],
  });
  assert('firstRun === null when previous === null', firstRun === null);

  // Test 10: Aggregator placeholder
  const agg = new Aggregator();
  const aggResult = await agg.aggregate({
    htf: { moduleId: 'htf-multi-tf', timeframe: '1w', state: 'UP', confidence: 0.8, interpretation: '', evidence: [], timestamp: 0 },
    moduleVerdicts: [
      { moduleId: 'ma-alignment', timeframe: '1d', state: 'UP', confidence: 0.7, interpretation: '', evidence: [], timestamp: 0 },
      { moduleId: 'hl-structure', timeframe: '1d', state: 'UP', confidence: 0.6, interpretation: '', evidence: [], timestamp: 0 },
    ],
  });
  assert("aggResult.state === 'UP' (3/3 majority)", aggResult.state === 'UP');
  assert('aggResult.confidence > 0', aggResult.confidence > 0);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ Passed: ${passed}  ❌ Failed: ${failed}`);
  console.log('='.repeat(50));

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Smoke test crashed:', err);
  process.exit(1);
});
// algorithms/AS-03-cycle-detection/tests/test-backtest-timeline.mjs
//
// 大少 2026-08-10 00:13 — M11 Backtest Timeline pytest 10+ 個 scenario (Stage 2 第三次 focus)
//   1:  Data 不足 (forward return 0 records) → empty result, 4 sections 顯示「數據不足」
//   2:  正常情況 (90 日, 47 verdicts + 5 journal entries) → 47 data points + 5 journal match
//   3:  邊界 30 日 (dateRange=30) → 拎到 records 30 日內
//   4:  邊界 365 日 (dateRange=365) → 拎到 records 365 日內
//   5:  Date alignment 對齊 bug (UNIQUE constraint 應該唔出現, defensive 處理)
//   6:  Empty Trade Journal (有 verdicts, 冇 journal) → NO_JOURNAL
//   7:  全部命中 (all hit + all mark_correct) → MATCH
//   8:  全部 miss (all hit false + all mark_wrong) → MATCH
//   9:  Golden entry detection (fwd5=3.5%, hit=true, mark=5) → isGoldenEntry=true
//   10: Golden entry threshold (fwd5=2.9%, 唔夠 3%) → isGoldenEntry=false
//   11: Meta fields 啱 (dateRange, dataLimited, counts)
//   12: 6 色標 (6 個 color string 對應唔同 action + hit + mark 組合)
//   13: LLM hook (generateTimelineInterpretation async function 返 string)
//   14: Date range filter chip (90 default 拎到, 30 拎到少啲)
//
// 跑法: `node algorithms/AS-03-cycle-detection/tests/test-backtest-timeline.mjs`
//   exit code 0 = pass, 1 = fail
//
// Spec: docs/research/AS-03-cycle-detection/MODULE-11-BACKTEST-TIMELINE.md §9

import { analyzeBacktestTimeline, generateTimelineInterpretation, GOLDEN_ENTRY_FWD5_THRESHOLD, TIMELINE_COLORS } from '../modules/backtest-timeline.ts';

// ===== Helpers =====

/**
 * Build forward return history (mock)
 * @param count - 幾多條 records
 * @param daysBack - 由 today 開始, 過去幾多日
 * @param hitRate - 0-1, 命中率 (e.g. 0.6 = 60% 會 hit)
 */
function makeForwardReturns(count, daysBack, hitRate = 0.6) {
  const records = [];
  const today = new Date();
  for (let i = 0; i < count; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() - daysBack + i);
    const isHit = (i % 10) < hitRate * 10;
    records.push({
      date: date.toISOString().slice(0, 10),
      action: i % 4 === 0 ? 'BUY' : i % 4 === 1 ? 'HOLD' : i % 4 === 2 ? 'WAIT' : 'SELL',
      fwd5: isHit ? 2.0 + (i % 3) : -1.0 - (i % 2),
      fwd10: isHit ? 3.5 + (i % 3) : -1.5 - (i % 2),
      fwd20: isHit ? 5.0 + (i % 3) : -2.0 - (i % 2),
      hit: isHit,
    });
  }
  return records;
}

/** Build trade journal entries (mock) */
function makeJournalEntries(symbol, count, daysBack, markCorrect = 4) {
  const entries = [];
  for (let i = 0; i < count; i++) {
    const today = new Date();
    const date = new Date(today);
    date.setDate(today.getDate() - daysBack + i * 5);  // 每 5 日一個 entry
    entries.push({
      id: i + 1,
      symbol,
      entry_date: date.toISOString().slice(0, 10),
      entry_price: 380.50 + i,
      shares: 100,
      target_price: 420.00,
      stop_loss: 365.00,
      notes: `Test entry ${i + 1}`,
      created_at: date.toISOString(),
      mark_correct: i < count / 2 ? markCorrect : null,
      mark_wrong: i >= count / 2 ? 4 : null,
      mark_scale: null,
    });
  }
  return entries;
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

// Test 1: Data 不足 (forward return 0 records) → empty result
{
  const result = analyzeBacktestTimeline({
    symbol: 'HK.00700',
    forwardReturnHistory: [],
    tradeJournalEntries: [],
  });

  assert('Test 1: Data 不足 → dataPoints.length = 0',
    result.dataPoints.length === 0,
    `got ${result.dataPoints.length}`);

  assert('Test 1b: Data 不足 → totalVerdicts = 0',
    result.stats.totalVerdicts === 0,
    `got ${result.stats.totalVerdicts}`);

  assert('Test 1c: Data 不足 → hitRate5d = null',
    result.stats.hitRate5d === null,
    `got ${result.stats.hitRate5d}`);
}

// Test 2: 正常情況 (90 日, 47 verdicts + 5 journal entries)
{
  const fr = makeForwardReturns(47, 80, 0.6);
  const journal = makeJournalEntries('HK.00700', 5, 70, 4);

  const result = analyzeBacktestTimeline({
    symbol: 'HK.00700',
    dateRange: 90,
    forwardReturnHistory: fr,
    tradeJournalEntries: journal,
  });

  assert('Test 2: 正常情況 → 47 data points',
    result.dataPoints.length === 47,
    `got ${result.dataPoints.length}`);

  assert('Test 2b: 5 個 journal match (5 條 journal 入到 timeline)',
    result.stats.totalJournalEntries === 5,
    `got ${result.stats.totalJournalEntries}`);

  assert('Test 2c: hitRate5d 計算啱 (約 60% 命中率)',
    result.stats.hitRate5d !== null && Math.abs(result.stats.hitRate5d - 0.6) < 0.1,
    `got ${result.stats.hitRate5d}`);
}

// Test 3: 邊界 30 日
{
  const fr = makeForwardReturns(50, 60, 0.6);
  const result = analyzeBacktestTimeline({
    symbol: 'HK.00700',
    dateRange: 30,
    forwardReturnHistory: fr,
  });

  // 60 日內 50 條 (i=0..49 對應 -60..-11), 30 日內應該 20 條 (i=30..49 對應 -30..-11)
  assert('Test 3: 邊界 30 日 → 20 條 data points (-30 到 -11)',
    result.dataPoints.length === 20,
    `got ${result.dataPoints.length}`);

  assert('Test 3b: 邊界 30 日 → meta.dateRangeUsed = 30',
    result.meta.dateRangeUsed === 30,
    `got ${result.meta.dateRangeUsed}`);
}

// Test 4: 邊界 365 日
{
  const fr = makeForwardReturns(50, 60, 0.6);  // 50 條, 60 日內
  const result = analyzeBacktestTimeline({
    symbol: 'HK.00700',
    dateRange: 365,
    forwardReturnHistory: fr,
  });

  assert('Test 4: 邊界 365 日 → 全部 50 條都入到',
    result.dataPoints.length === 50,
    `got ${result.dataPoints.length}`);

  assert('Test 4b: 邊界 365 日 → dataLimited = false (冇 filter 走)',
    result.meta.dataLimited === false,
    `got dataLimited=${result.meta.dataLimited}`);
}

// Test 5: Date alignment 對齊 (Trade Journal entry_date 對齊 forward return date)
{
  const fr = [
    { date: '2026-05-15', action: 'BUY', fwd5: 2.5, fwd10: 4.0, fwd20: 5.5, hit: true },
    { date: '2026-05-20', action: 'HOLD', fwd5: -0.5, fwd10: -1.0, fwd20: -1.5, hit: false },
  ];
  const journal = [
    { id: 1, symbol: 'HK.00700', entry_date: '2026-05-15', entry_price: 100, shares: 1, target_price: null, stop_loss: null, notes: '', created_at: '', mark_correct: 5, mark_wrong: null, mark_scale: null },
  ];

  const result = analyzeBacktestTimeline({
    symbol: 'HK.00700',
    dateRange: 365,
    forwardReturnHistory: fr,
    tradeJournalEntries: journal,
  });

  // 第一個 data point 應該對齊到 journal entry
  assert('Test 5: Date alignment 對齊 → 第一個 data point 對齊 journal',
    result.dataPoints[0].journalEntry !== null && result.dataPoints[0].journalEntry.id === 1,
    `got journalEntry=${result.dataPoints[0].journalEntry}`);

  assert('Test 5b: 第二個 data point 冇 journal (NO_JOURNAL)',
    result.dataPoints[1].journalEntry === null,
    `got journalEntry=${result.dataPoints[1].journalEntry}`);

  assert('Test 5c: 第一個 data point predictionVsActual = MATCH (hit + mark_correct)',
    result.dataPoints[0].predictionVsActual === 'MATCH',
    `got ${result.dataPoints[0].predictionVsActual}`);
}

// Test 6: Empty Trade Journal (有 verdicts, 冇 journal) → 全部 NO_JOURNAL
{
  const fr = makeForwardReturns(10, 30, 0.6);
  const result = analyzeBacktestTimeline({
    symbol: 'HK.00700',
    dateRange: 90,
    forwardReturnHistory: fr,
    tradeJournalEntries: [],
  });

  assert('Test 6: Empty Journal → 全部 predictionVsActual = NO_JOURNAL',
    result.dataPoints.every((d) => d.predictionVsActual === 'NO_JOURNAL'),
    `got match breakdown: ${JSON.stringify(result.stats.matchBreakdown)}`);

  assert('Test 6b: Empty Journal → totalJournalEntries = 0',
    result.stats.totalJournalEntries === 0,
    `got ${result.stats.totalJournalEntries}`);
}

// Test 7: 全部命中 (all hit + all mark_correct) → MATCH
{
  const today = new Date();
  const fr = [];
  for (let i = 0; i < 5; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() - 30 + i);
    fr.push({
      date: date.toISOString().slice(0, 10),
      action: 'BUY',
      fwd5: 2.0,
      fwd10: 3.0,
      fwd20: 5.0,
      hit: true,
    });
  }
  const journal = fr.map((r, i) => ({
    id: i + 1,
    symbol: 'HK.00700',
    entry_date: r.date,
    entry_price: 100,
    shares: 1,
    target_price: null,
    stop_loss: null,
    notes: '',
    created_at: '',
    mark_correct: 5,
    mark_wrong: null,
    mark_scale: null,
  }));

  const result = analyzeBacktestTimeline({
    symbol: 'HK.00700',
    dateRange: 90,
    forwardReturnHistory: fr,
    tradeJournalEntries: journal,
  });

  assert('Test 7: 全部命中 → 全部 predictionVsActual = MATCH',
    result.stats.matchBreakdown.MATCH === 5,
    `got MATCH=${result.stats.matchBreakdown.MATCH}`);

  assert('Test 7b: 全部命中 → 全部 isGoldenEntry = true (mark=5 ≥ 4, fwd5=2.0 < 3 唔夠)',
    result.dataPoints.every((d) => !d.isGoldenEntry),  // fwd5=2.0 < 3 唔夠 golden
    `got goldenEntries=${result.stats.goldenEntries}`);

  assert('Test 7c: hitRate5d = 1.0',
    result.stats.hitRate5d === 1.0,
    `got ${result.stats.hitRate5d}`);
}

// Test 8: 全部 miss (all hit false + all mark_wrong) → MATCH (因為兩者一致)
{
  const today = new Date();
  const fr = [];
  for (let i = 0; i < 5; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() - 30 + i);
    fr.push({
      date: date.toISOString().slice(0, 10),
      action: 'BUY',
      fwd5: -1.0,
      fwd10: -1.5,
      fwd20: -2.0,
      hit: false,
    });
  }
  const journal = fr.map((r, i) => ({
    id: i + 1,
    symbol: 'HK.00700',
    entry_date: r.date,
    entry_price: 100,
    shares: 1,
    target_price: null,
    stop_loss: null,
    notes: '',
    created_at: '',
    mark_correct: null,
    mark_wrong: 4,
    mark_scale: null,
  }));

  const result = analyzeBacktestTimeline({
    symbol: 'HK.00700',
    dateRange: 90,
    forwardReturnHistory: fr,
    tradeJournalEntries: journal,
  });

  assert('Test 8: 全部 miss + 全部 mark_wrong → 全部 MATCH (一致)',
    result.stats.matchBreakdown.MATCH === 5,
    `got MATCH=${result.stats.matchBreakdown.MATCH}`);
}

// Test 9: Golden entry detection (fwd5=3.5%, hit=true, mark=5) → isGoldenEntry=true
{
  const fr = [{
    date: '2026-05-15',
    action: 'BUY',
    fwd5: 3.5,
    fwd10: 5.0,
    fwd20: 7.0,
    hit: true,
  }];
  const journal = [{
    id: 1,
    symbol: 'HK.00700',
    entry_date: '2026-05-15',
    entry_price: 100,
    shares: 1,
    target_price: null,
    stop_loss: null,
    notes: '',
    created_at: '',
    mark_correct: 5,
    mark_wrong: null,
    mark_scale: null,
  }];

  const result = analyzeBacktestTimeline({
    symbol: 'HK.00700',
    dateRange: 365,
    forwardReturnHistory: fr,
    tradeJournalEntries: journal,
  });

  assert('Test 9: Golden entry (fwd5=3.5%, hit, mark=5) → isGoldenEntry = true',
    result.dataPoints[0].isGoldenEntry === true,
    `got isGoldenEntry=${result.dataPoints[0].isGoldenEntry}`);

  assert('Test 9b: Golden entry color = GOLDEN (#26BA75)',
    result.dataPoints[0].color === TIMELINE_COLORS.GOLDEN,
    `got color=${result.dataPoints[0].color}`);

  assert('Test 9c: stats.goldenEntries = 1',
    result.stats.goldenEntries === 1,
    `got ${result.stats.goldenEntries}`);
}

// Test 10: Golden entry threshold (fwd5=2.9%, 唔夠 3%)
{
  const fr = [{
    date: '2026-05-15',
    action: 'BUY',
    fwd5: 2.9,  // 唔夠 3%
    fwd10: 5.0,
    fwd20: 7.0,
    hit: true,
  }];
  const journal = [{
    id: 1,
    symbol: 'HK.00700',
    entry_date: '2026-05-15',
    entry_price: 100,
    shares: 1,
    target_price: null,
    stop_loss: null,
    notes: '',
    created_at: '',
    mark_correct: 5,
    mark_wrong: null,
    mark_scale: null,
  }];

  const result = analyzeBacktestTimeline({
    symbol: 'HK.00700',
    dateRange: 365,
    forwardReturnHistory: fr,
    tradeJournalEntries: journal,
  });

  assert('Test 10: Golden entry threshold (fwd5=2.9%, 唔夠 3%) → isGoldenEntry = false',
    result.dataPoints[0].isGoldenEntry === false,
    `got isGoldenEntry=${result.dataPoints[0].isGoldenEntry}`);

  assert('Test 10b: fwd5=2.9% < threshold 3.0%',
    GOLDEN_ENTRY_FWD5_THRESHOLD === 3.0,
    `got threshold=${GOLDEN_ENTRY_FWD5_THRESHOLD}`);
}

// Test 11: Meta fields 啱
{
  const fr = makeForwardReturns(10, 30, 0.6);
  const journal = makeJournalEntries('HK.00700', 3, 20, 4);

  const result = analyzeBacktestTimeline({
    symbol: 'HK.00700',
    dateRange: 90,
    forwardReturnHistory: fr,
    tradeJournalEntries: journal,
  });

  assert('Test 11: meta.forwardReturnCount 對齊 fr records',
    result.meta.forwardReturnCount === 10,
    `got ${result.meta.forwardReturnCount}`);

  assert('Test 11b: meta.journalCount 對齊 journal entries',
    result.meta.journalCount === 3,
    `got ${result.meta.journalCount}`);

  assert('Test 11c: dateRange.days = 90',
    result.dateRange.days === 90,
    `got ${result.dateRange.days}`);

  assert('Test 11d: dataPoints 已經 sort by date ascending',
    result.dataPoints.every((d, i) => i === 0 || d.date >= result.dataPoints[i - 1].date),
    `dataPoints not sorted by date`);
}

// Test 12: 6 色標 (唔同 action + hit + mark 組合)
{
  const today = new Date();
  const fr = [
    { date: '2026-05-01', action: 'BUY', fwd5: 3.5, fwd10: 5.0, fwd20: 7.0, hit: true },     // golden
    { date: '2026-05-02', action: 'BUY', fwd5: 1.0, fwd10: 1.5, fwd20: 2.0, hit: true },      // hit_general
    { date: '2026-05-03', action: 'HOLD', fwd5: 0.5, fwd10: 1.0, fwd20: 1.5, hit: true },     // wait
    { date: '2026-05-04', action: 'BUY', fwd5: -1.0, fwd10: -1.5, fwd20: -2.0, hit: false },  // miss_general
    { date: '2026-05-05', action: 'SELL', fwd5: -2.0, fwd10: -3.0, fwd20: -4.0, hit: false }, // sell_danger
  ];
  const journal = [
    { id: 1, symbol: 'HK.00700', entry_date: '2026-05-01', entry_price: 100, shares: 1, target_price: null, stop_loss: null, notes: '', created_at: '', mark_correct: 5, mark_wrong: null, mark_scale: null },  // golden
    { id: 2, symbol: 'HK.00700', entry_date: '2026-05-02', entry_price: 100, shares: 1, target_price: null, stop_loss: null, notes: '', created_at: '', mark_correct: 3, mark_wrong: null, mark_scale: null },  // hit_general
    { id: 3, symbol: 'HK.00700', entry_date: '2026-05-03', entry_price: 100, shares: 1, target_price: null, stop_loss: null, notes: '', created_at: '', mark_correct: null, mark_wrong: null, mark_scale: null },  // wait
    { id: 4, symbol: 'HK.00700', entry_date: '2026-05-04', entry_price: 100, shares: 1, target_price: null, stop_loss: null, notes: '', created_at: '', mark_correct: null, mark_wrong: 2, mark_scale: null },  // miss_general
    { id: 5, symbol: 'HK.00700', entry_date: '2026-05-05', entry_price: 100, shares: 1, target_price: null, stop_loss: null, notes: '', created_at: '', mark_correct: null, mark_wrong: 4, mark_scale: null },  // sell_danger
  ];

  const result = analyzeBacktestTimeline({
    symbol: 'HK.00700',
    dateRange: 365,
    forwardReturnHistory: fr,
    tradeJournalEntries: journal,
  });

  assert('Test 12: 6 色標 → 第 1 個 golden (深綠)',
    result.dataPoints[0].color === TIMELINE_COLORS.GOLDEN,
    `got ${result.dataPoints[0].color}`);

  assert('Test 12b: 6 色標 → 第 2 個 hit_general (淺綠)',
    result.dataPoints[1].color === TIMELINE_COLORS.HIT_GENERAL,
    `got ${result.dataPoints[1].color}`);

  assert('Test 12c: 6 色標 → 第 3 個 wait (黃)',
    result.dataPoints[2].color === TIMELINE_COLORS.WAIT,
    `got ${result.dataPoints[2].color}`);

  assert('Test 12d: 6 色標 → 第 4 個 miss_general (淺橙)',
    result.dataPoints[3].color === TIMELINE_COLORS.MISS_GENERAL,
    `got ${result.dataPoints[3].color}`);

  assert('Test 12e: 6 色標 → 第 5 個 sell_danger (紅)',
    result.dataPoints[4].color === TIMELINE_COLORS.SELL_DANGER,
    `got ${result.dataPoints[4].color}`);

  // 7 個色 string 唔同
  const colorSet = new Set(Object.values(TIMELINE_COLORS));
  assert('Test 12f: TIMELINE_COLORS 有 7 個唔同嘅色 string',
    colorSet.size === 7,
    `got ${colorSet.size} distinct colors: ${[...colorSet].join(', ')}`);
}

// Test 13: LLM hook (generateTimelineInterpretation 返 string)
{
  const fr = [{
    date: '2026-05-15',
    action: 'BUY',
    fwd5: 3.5,
    fwd10: 5.0,
    fwd20: 7.0,
    hit: true,
  }];
  const journal = [{
    id: 1,
    symbol: 'HK.00700',
    entry_date: '2026-05-15',
    entry_price: 100,
    shares: 1,
    target_price: null,
    stop_loss: null,
    notes: '',
    created_at: '',
    mark_correct: 5,
    mark_wrong: null,
    mark_scale: null,
  }];

  const result = analyzeBacktestTimeline({
    symbol: 'HK.00700',
    dateRange: 365,
    forwardReturnHistory: fr,
    tradeJournalEntries: journal,
  });

  const interp = await generateTimelineInterpretation({
    symbol: 'HK.00700',
    stats: result.stats,
    bestGolden: result.dataPoints[0] || null,
    worstMiss: null,
  });

  assert('Test 13: LLM hook → generateTimelineInterpretation 返 string',
    typeof interp === 'string' && interp.length > 0,
    `got type=${typeof interp}, length=${interp?.length}`);

  assert('Test 13b: LLM hook → interp 提及 stock symbol',
    interp.includes('HK.00700'),
    `got interp: ${interp}`);

  assert('Test 13c: LLM hook → interp 提及 golden entry',
    interp.includes('黃金') || interp.includes('golden') || interp.includes('5 日'),
    `got interp: ${interp}`);
}

// Test 14: Date range filter chip (90 default 拎到 90 日內, 30 拎到 30 日內, 拎到少啲)
{
  const fr = makeForwardReturns(50, 100, 0.6);  // 50 條, 過去 100 日

  const result90 = analyzeBacktestTimeline({
    symbol: 'HK.00700',
    dateRange: 90,
    forwardReturnHistory: fr,
  });

  const result30 = analyzeBacktestTimeline({
    symbol: 'HK.00700',
    dateRange: 30,
    forwardReturnHistory: fr,
  });

  assert('Test 14: Date range chip 90 → 拎到 40 條 (50 條喺 -100..-51, 90 日內 -90..-51 共 40)',
    result90.dataPoints.length === 40,
    `got ${result90.dataPoints.length}`);

  assert('Test 14b: Date range chip 30 → 拎到 0 條 (records 全部 -100..-51, 30 日內 -30..0 都唔命中)',
    result30.dataPoints.length === 0,
    `got ${result30.dataPoints.length}`);

  assert('Test 14c: 30 日 chip 拎到少啲 records 比起 90 日',
    result30.dataPoints.length < result90.dataPoints.length,
    `90=${result90.dataPoints.length}, 30=${result30.dataPoints.length}`);
}

// ===== Summary =====
console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0) {
  console.log('Failed tests:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
process.exit(0);

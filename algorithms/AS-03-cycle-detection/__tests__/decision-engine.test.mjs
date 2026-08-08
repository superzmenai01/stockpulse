// __tests__/decision-engine.test.mjs
//
// 大少 2026-08-08 12:30 — Sprint 1 sub-task 1.3
//   M7 Synthesizer (DecisionEngine) 嘅 tests
//
// Test scope: 16 tests, 60+ assertions
//   - 一致上升 / 一致下跌 / 矛盾 / 4+2 / 5+1 / 全部 SIDEWAYS / Empty
//   - High / Low / Medium drawdown → Kelly fraction
//   - TCM 3 對 pair alignment
//   - SSI consistency / confidence_avg / rules_coverage
//   - Alignment Score
//   - Grade score formula
//   - synthesizeAll convenience function

import { DecisionEngine, synthesizeAll } from '../index.ts';

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
// Mock helpers
// =============================================================

const ALL_MODULE_IDS = ['ma-alignment', 'hl-structure', 'trendline', 'indicators', 'volume', 'volatility'];

/** 1 個 mock ModuleStandardVerdict
 *  @param {string} moduleId
 *  @param {string} state - 'UP' | 'DOWN' | 'SIDEWAYS' | 'TRANSITION' | 'TRAP'
 *  @param {object} overrides
 */
function makeSV(moduleId, state, overrides = {}) {
  return {
    state,
    confidence: 0.8,
    base_weight: 0.15,  // default, override below for specific modules
    expected_return: 0.05,
    max_drawdown_estimate: 0.08,
    sentiment_6d: { rsi: 0, bollinger_pct_b: 0, bias_ratio: 0, vol_skew: 0, turnover: 0, momentum_accel: 0 },
    rules_fired: ['A'],
    module_id: moduleId,
    module_specific: {},
    timestamp: Date.now(),
    ...overrides,
  };
}

/** 6 個 module 嘅 standard verdicts — 全部同一個 state
 *  @param {string} state
 *  @param {object} overrides
 */
function makeAllSameSV(state, overrides = {}) {
  return ALL_MODULE_IDS.map((id, i) => makeSV(id, state, {
    base_weight: [0.25, 0.15, 0.20, 0.15, 0.15, 0.10][i],
    confidence: 0.8,
    ...overrides,
  }));
}

/** 6 個 module 嘅 standard verdicts — mixed state
 *  @param {string[]} states - 6 個 state
 */
function makeMixedSV(states) {
  if (states.length !== 6) throw new Error('need 6 states');
  return ALL_MODULE_IDS.map((id, i) => makeSV(id, states[i], {
    base_weight: [0.25, 0.15, 0.20, 0.15, 0.15, 0.10][i],
  }));
}

const engine = new DecisionEngine();

// =============================================================
// Test 1: Empty input → F grade
// =============================================================
section('Test 1: Empty input');
{
  const result = await engine.synthesize({ moduleVerdicts: [] });
  assert('Empty → ssi_score = 0', result.ssi_score === 0);
  assert('Empty → alignment_score = 0', result.alignment_score === 0);
  assert('Empty → grade = F', result.grade === 'F');
  assert('Empty → grade_score = 0', result.grade_score === 0);
  assert('Empty → kelly_fraction = quarter (default)', result.kelly_fraction === 'quarter');
  assert('Empty → tcm_matrix empty', result.tcm_matrix.length === 0);
  assert('Empty → module_verdicts empty', result.module_verdicts.length === 0);
}

// =============================================================
// Test 2: 一致上升 (6 個都 UP) → 高 SSI + A grade + half Kelly (低波動)
// =============================================================
section('Test 2: 一致上升 (6 UP)');
{
  const verdicts = makeAllSameSV('UP', { max_drawdown_estimate: 0.03 });
  const result = await engine.synthesize({ moduleVerdicts: verdicts });
  assert('6 UP → ssi_breakdown.consistency = 1.0', result.ssi_breakdown.consistency === 1.0);
  assert('6 UP → alignment_score = 1.0', result.alignment_score === 1.0);
  assert('6 UP → kelly_fraction = half (avg DD 0.03 < 0.05)', result.kelly_fraction === 'half');
  assert('6 UP → kelly_numeric = 0.5', result.kelly_numeric === 0.5);
  assert('6 UP → kelly_position = 0.5', result.kelly_position === 0.5);
  // ssi = 1.0 × 50 + 0.8 × 30 + 0.05 × 20 = 50 + 24 + 1 = 75
  // grade_score = 75 × 0.6 + 100 × 0.4 = 45 + 40 = 85 → A
  assert('6 UP → ssi_score ≈ 75', Math.abs(result.ssi_score - 75) < 1);
  assert('6 UP → grade = A (score 85)', result.grade === 'A');
  assert('6 UP → tcm_matrix 3 對 pair', result.tcm_matrix.length === 3);
  for (const pair of result.tcm_matrix) {
    assert(`6 UP → ${pair.pair[0]}-${pair.pair[1]} alignment = 1`, pair.alignment === 1);
    assert(`6 UP → ${pair.pair[0]}-${pair.pair[1]} trap_penalty = 0`, pair.trap_penalty === 0);
  }
}

// =============================================================
// Test 3: 一致下跌 (6 個都 DOWN) → F grade
// =============================================================
section('Test 3: 一致下跌 (6 DOWN)');
{
  const verdicts = makeAllSameSV('DOWN', { max_drawdown_estimate: 0.04 });  // 0.04 < 0.05 → half
  const result = await engine.synthesize({ moduleVerdicts: verdicts });
  assert('6 DOWN → ssi_breakdown.consistency = 1.0', result.ssi_breakdown.consistency === 1.0);
  assert('6 DOWN → alignment_score = 1.0', result.alignment_score === 1.0);
  // ssi = 50 + 24 + 1 = 75, grade_score = 85 → A
  // 註: 下跌但一致, M7 仲係畀 A grade, 因為 consistency 高
  // 真正判斷 SELL 嘅係 M8 finalAction, M7 只係 judge 一致性 + 信心
  assert('6 DOWN → grade = A (一致下跌仍然高分)', result.grade === 'A');
  assert('6 DOWN → kelly_fraction = half (avg DD 0.04 < 0.05)', result.kelly_fraction === 'half');
}

// =============================================================
// Test 4: 矛盾 (3 UP + 3 DOWN) → 低 SSI + C+ grade
// =============================================================
section('Test 4: 矛盾 (3 UP + 3 DOWN)');
{
  const verdicts = makeMixedSV(['UP', 'UP', 'UP', 'DOWN', 'DOWN', 'DOWN']);
  const result = await engine.synthesize({ moduleVerdicts: verdicts });
  assert('3UP+3DOWN → ssi_breakdown.consistency = 0.5', result.ssi_breakdown.consistency === 0.5);
  assert('3UP+3DOWN → alignment_score = 0.5', result.alignment_score === 0.5);
  // ssi = 0.5 × 50 + 0.8 × 30 + 0.05 × 20 = 25 + 24 + 1 = 50
  // grade_score = 50 × 0.6 + 50 × 0.4 = 30 + 20 = 50 → C+ (50 啱啱 hit 50 boundary)
  assert('3UP+3DOWN → ssi_score ≈ 50', Math.abs(result.ssi_score - 50) < 1);
  assert('3UP+3DOWN → grade = C+ (50 分)', result.grade === 'C+');
}

// =============================================================
// Test 5: 4 UP + 2 HOLD (SIDEWAYS) → 中 SSI
// =============================================================
section('Test 5: 4 UP + 2 SIDEWAYS');
{
  const verdicts = makeMixedSV(['UP', 'UP', 'UP', 'UP', 'SIDEWAYS', 'SIDEWAYS']);
  const result = await engine.synthesize({ moduleVerdicts: verdicts });
  assert('4UP+2SW → ssi_breakdown.consistency = 0.667', Math.abs(result.ssi_breakdown.consistency - 0.667) < 0.01);
  assert('4UP+2SW → alignment_score = 0.667', Math.abs(result.alignment_score - 0.667) < 0.01);
  // ssi = 0.667 × 50 + 0.8 × 30 + 0.05 × 20 = 33.3 + 24 + 1 = 58.3
  // grade_score = 58.3 × 0.6 + 66.7 × 0.4 = 35 + 26.7 = 61.7 → B
  assert('4UP+2SW → ssi_score ≈ 58', Math.abs(result.ssi_score - 58) < 1);
  assert('4UP+2SW → grade = B (62 分)', result.grade === 'B');
}

// =============================================================
// Test 6: 5 UP + 1 DOWN → 高 SSI
// =============================================================
section('Test 6: 5 UP + 1 DOWN');
{
  const verdicts = makeMixedSV(['UP', 'UP', 'UP', 'UP', 'UP', 'DOWN']);
  const result = await engine.synthesize({ moduleVerdicts: verdicts });
  assert('5UP+1DOWN → ssi_breakdown.consistency = 0.833', Math.abs(result.ssi_breakdown.consistency - 0.833) < 0.01);
  assert('5UP+1DOWN → alignment_score = 0.833', Math.abs(result.alignment_score - 0.833) < 0.01);
  // ssi = 0.833 × 50 + 0.8 × 30 + small = 41.6 + 24 + small = 65+
  // grade_score = 65 × 0.6 + 83.3 × 0.4 = 39 + 33.3 = 72.3 → B+
  assert('5UP+1DOWN → ssi_score ≈ 66', Math.abs(result.ssi_score - 66) < 1);
  assert('5UP+1DOWN → grade = B+ (72 分)', result.grade === 'B+');
}

// =============================================================
// Test 7: 全部 SIDEWAYS → C grade
// =============================================================
section('Test 7: 全部 SIDEWAYS');
{
  const verdicts = makeAllSameSV('SIDEWAYS');
  const result = await engine.synthesize({ moduleVerdicts: verdicts });
  assert('6 SW → ssi_breakdown.consistency = 1.0', result.ssi_breakdown.consistency === 1.0);
  // ssi = 50 + 24 + small = 74+
  // grade_score = 74 × 0.6 + 100 × 0.4 = 44.4 + 40 = 84.4 → A 級
  // 註: SIDEWAYS 仍然係 high consistency + high confidence = A grade
  // 真正 SELL/HOLD 嘅決定係 M8 finalAction
  assert('6 SW → grade = A (一致 SIDEWAYS 仍然高分)', result.grade === 'A');
}

// =============================================================
// Test 8: Kelly 自動切 — high drawdown
// =============================================================
section('Test 8: Kelly — high drawdown → octo');
{
  const verdicts = makeAllSameSV('UP', { max_drawdown_estimate: 0.15 });  // 15% drawdown
  const result = await engine.synthesize({ moduleVerdicts: verdicts });
  assert('High DD → kelly_fraction = octo', result.kelly_fraction === 'octo');
  assert('High DD → kelly_numeric = 0.125', result.kelly_numeric === 0.125);
  assert('High DD → kelly_position = 0.125', result.kelly_position === 0.125);
}

// =============================================================
// Test 9: Kelly 自動切 — low drawdown
// =============================================================
section('Test 9: Kelly — low drawdown → half');
{
  const verdicts = makeAllSameSV('UP', { max_drawdown_estimate: 0.02 });  // 2% drawdown
  const result = await engine.synthesize({ moduleVerdicts: verdicts });
  assert('Low DD → kelly_fraction = half', result.kelly_fraction === 'half');
  assert('Low DD → kelly_numeric = 0.5', result.kelly_numeric === 0.5);
}

// =============================================================
// Test 10: Kelly 自動切 — medium drawdown
// =============================================================
section('Test 10: Kelly — medium drawdown → quarter');
{
  const verdicts = makeAllSameSV('UP', { max_drawdown_estimate: 0.07 });  // 7% drawdown
  const result = await engine.synthesize({ moduleVerdicts: verdicts });
  assert('Medium DD → kelly_fraction = quarter', result.kelly_fraction === 'quarter');
  assert('Medium DD → kelly_numeric = 0.25', result.kelly_numeric === 0.25);
}

// =============================================================
// Test 11: TCM 3 對 pair
// =============================================================
section('Test 11: TCM 3 對 pair');
{
  // MA-UP + TL-DOWN (矛盾) → alignment = -1, trap = 0.6
  const verdicts = makeMixedSV(['UP', 'SIDEWAYS', 'DOWN', 'SIDEWAYS', 'SIDEWAYS', 'SIDEWAYS']);
  const result = await engine.synthesize({ moduleVerdicts: verdicts });
  assert('TCM 3 對', result.tcm_matrix.length === 3);
  const map = new Map(result.tcm_matrix.map(p => [`${p.pair[0]}-${p.pair[1]}`, p]));
  const ma_tl = map.get('ma-alignment-trendline');
  assert('MA-TL → alignment = -1 (UP vs DOWN)', ma_tl && ma_tl.alignment === -1);
  assert('MA-TL → trap_penalty = 0.6', ma_tl && ma_tl.trap_penalty === 0.6);
  const hl_vp = map.get('hl-structure-volume');
  assert('HL-VP → alignment = 1 (都係 SIDEWAYS)', hl_vp && hl_vp.alignment === 1);
  assert('HL-VP → trap_penalty = 0', hl_vp && hl_vp.trap_penalty === 0);
}

// =============================================================
// Test 12: SSI confidence_avg (加權)
// =============================================================
section('Test 12: SSI confidence_avg 加權');
{
  // confidence 唔同, base_weight 唔同, 加權平均要跟 base_weight
  const verdicts = ALL_MODULE_IDS.map((id, i) => makeSV(id, 'UP', {
    base_weight: [0.25, 0.15, 0.20, 0.15, 0.15, 0.10][i],
    confidence: [1.0, 0.5, 0.5, 0.5, 0.5, 0.5][i],
  }));
  const result = await engine.synthesize({ moduleVerdicts: verdicts });
  // 加權平均 = (1.0×0.25 + 0.5×0.15 + 0.5×0.20 + 0.5×0.15 + 0.5×0.15 + 0.5×0.10) / 1.0
  //          = (0.25 + 0.075 + 0.10 + 0.075 + 0.075 + 0.05) / 1.0
  //          = 0.625
  assert('confidence_avg = 0.625 (加權平均)', Math.abs(result.ssi_breakdown.confidence_avg - 0.625) < 0.001);
}

// =============================================================
// Test 13: SSI rules_coverage (10 unique rules)
// =============================================================
section('Test 13: SSI rules_coverage');
{
  // 6 個 module 各有唔同 rules
  // Union 計算: A, B, C, D, E, F, G, H, I0~I5 = 14 個
  // (注意: ['I' + i] 喺 callback 入面每次 re-evaluate, 但 callback 只取 [i] 一個,
  //  所以只取 'I' + i 一個 value, 即 6 個 module 用 6 個唔同 i, 但每個 module 只取 1 個)
  // 實際 trace: M0=A,B | M1=C | M2=D,E | M3=F | M4=G,H | M5=I5 (i=5)
  // Union: A, B, C, D, E, F, G, H, I5 = 9 個
  const verdicts = ALL_MODULE_IDS.map((id, i) => makeSV(id, 'UP', {
    base_weight: 0.15,
    rules_fired: [['A', 'B'], ['C'], ['D', 'E'], ['F'], ['G', 'H'], ['I' + i]][i],
  }));
  const result = await engine.synthesize({ moduleVerdicts: verdicts });
  // 9 / 20 = 0.45
  assert('rules_coverage = 0.45 (9 unique rules / 20 max)', Math.abs(result.ssi_breakdown.rules_coverage - 0.45) < 0.01);
}

// =============================================================
// Test 14: synthesizeAll convenience function
// =============================================================
section('Test 14: synthesizeAll convenience');
{
  const verdicts = makeAllSameSV('UP', { max_drawdown_estimate: 0.04 });
  const result = await synthesizeAll(verdicts);
  assert('synthesizeAll → 跟 engine.synthesize 一樣', result.grade === 'A');
  assert('synthesizeAll → kelly_fraction 正確', result.kelly_fraction === 'half');
}

// =============================================================
// Test 15: Grade 邊界測試
// =============================================================
section('Test 15: Grade 邊界測試');
{
  // 高信心 + 全部 UP → ssi 75 (consistency 50, confidence 30, rules 1) = 81 (with confidence 1.0)
  // grade_score = 81 × 0.6 + 100 × 0.4 = 48.6 + 40 = 88.6 → A (88 唔到 90, 所以唔係 A+)
  const svHigh = makeAllSameSV('UP', { confidence: 1.0 });
  const rHigh = await engine.synthesize({ moduleVerdicts: svHigh });
  assert('高信心 + 全部 UP → ssi ≈ 81', Math.abs(rHigh.ssi_score - 81) < 1);
  assert('高信心 + 全部 UP → grade = A (88 分, 唔夠 A+)', rHigh.grade === 'A');

  // 低信心 + 全部 TRANSITION → ssi 50 + 3 + 1 = 54, grade_score = 54*0.6 + 100*0.4 = 72.4 → B+
  // 註: consistency 仍然 1.0, 所以 grade 唔會跌到 F
  const svLow = makeAllSameSV('TRANSITION', { confidence: 0.1 });
  const rLow = await engine.synthesize({ moduleVerdicts: svLow });
  assert('低信心 TRANSITION → ssi ≈ 54', Math.abs(rLow.ssi_score - 54) < 1);
  assert('低信心 TRANSITION → grade = B+ (72 分)', rLow.grade === 'B+');

  // F 級: 完全矛盾 + 低信心
  const svMixed = makeMixedSV(['UP', 'DOWN', 'UP', 'DOWN', 'UP', 'DOWN']);
  const rMixedVerdicts = svMixed.map((s) => ({ ...s, confidence: 0.1 }));
  const rMixed = await engine.synthesize({ moduleVerdicts: rMixedVerdicts });
  // consistency 0.5, ssi = 0.5*50 + 0.1*30 + small = 25 + 3 + 1 = 29
  // alignment 0.5, grade_score = 29*0.6 + 50*0.4 = 17.4 + 20 = 37.4 → D
  assert('完全矛盾 + 低信心 → ssi ≈ 29', Math.abs(rMixed.ssi_score - 29) < 1);
  assert('完全矛盾 + 低信心 → grade = D (37 分)', rMixed.grade === 'D');
}

// =============================================================
// Test 16: 6 個 module 全部都係獨立 (唔好互相 override)
// =============================================================
section('Test 16: module_verdicts trace 保留');
{
  const verdicts = makeAllSameSV('UP');
  const result = await engine.synthesize({ moduleVerdicts: verdicts });
  assert('module_verdicts.length === 6', result.module_verdicts.length === 6);
  assert('module_verdicts 全部有 module_id', result.module_verdicts.every(v => v.module_id));
  assert('6 個 module id 全部唔同', new Set(result.module_verdicts.map(v => v.module_id)).size === 6);
}

// =============================================================
// Summary
// =============================================================
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`📊 Decision Engine Tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\n❌ Failures:');
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
console.log('✅ All decision engine tests passed');

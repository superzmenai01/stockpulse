#!/usr/bin/env node
/**
 * M9 Back Test Pilot v3 — Re-run 7 隻 data-唔夠嘅 stocks 用 1w period
 *
 * 大少 2026-08-09 09:15 揀 B (我嘅建議)
 * 大少 2026-08-09 09:29 揀 B (再揀一次 — 修 backend 1w bug + Re-run 用 1w)
 *
 * V2 (1d) 結果: HK.01810/03690/09988 = 0 samples, US 4 隻 = 3 samples (OpenD 1d history 太短)
 * V3.5 (1w) — 修咗 backend 1w bug, 拎 5-10 年 weekly history, 補返 7 隻 samples
 *
 * Backend 1w fix: `backend/api/kline.py` PERIOD_MAP 加 `'1w': KLType.K_WEEK`
 *   - 之前 PERIOD_MAP 只有 1m/1d/1M/1y, doc 講 1w support 但 400 error
 *
 * Config:
 *   - period 1w
 *   - count 500 (500 週 ≈ 9.6 年)
 *   - stepDays 2 (每 2 週跑一次, 拎更多 step 位置)
 *   - lookbackDays 60 (60 日 ≈ 9 週, 夠 6 個 modules 計算)
 *   - min klines 30
 */

import { runWalkForwardCV, runReplay } from '../build/back-test.bundle.js';
import { DecisionEngine } from '../build/decision-engine.bundle.js';

const BACKEND = 'http://localhost:18792';

// V2 (1d) 跑出 0/3 samples 嘅 7 隻
const RERUN_STOCKS = [
  { symbol: 'HK.01810', market: 'HK', name: '小米集團' },
  { symbol: 'HK.03690', market: 'HK', name: '美團' },
  { symbol: 'HK.09988', market: 'HK', name: '阿里' },
  { symbol: 'US.AAPL',  market: 'US', name: 'Apple' },
  { symbol: 'US.TSLA',  market: 'US', name: 'Tesla' },
  { symbol: 'US.MSFT',  market: 'US', name: 'Microsoft' },
  { symbol: 'US.GOOGL', market: 'US', name: 'Alphabet' },
];

// ============================================================================
// Pure JS 計算 helper (同 v2)
// ============================================================================

function ma(closes, n) { if (closes.length < n) return null; return closes.slice(-n).reduce((a, b) => a + b, 0) / n; }
function ema(closes, n) {
  if (closes.length < n) return null;
  const k = 2 / (n + 1);
  let e = closes[0];
  for (let i = 1; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
  return e;
}
function rsi(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}
function macd(closes) {
  if (closes.length < 26) return { macd: 0, signal: 0, hist: 0 };
  return { macd: ema(closes, 12) - ema(closes, 26), signal: 0, hist: 0 };
}
function bollinger(closes, period = 20) {
  if (closes.length < period) return { upper: 0, lower: 0, mid: 0, width: 0, squeeze: false };
  const m = ma(closes, period);
  const slice = closes.slice(-period);
  const variance = slice.reduce((s, x) => s + (x - m) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: m + 2 * sd, lower: m - 2 * sd, mid: m, width: (4 * sd) / m, squeeze: ((4 * sd) / m) < 0.04 };
}
function trendlineState(closes, period = 30) {
  if (closes.length < period) return 'SIDEWAYS';
  const slice = closes.slice(-period);
  const n = slice.length;
  const meanX = (n - 1) / 2;
  const meanY = slice.reduce((a, b) => a + b) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - meanX) * (slice[i] - meanY); den += (i - meanX) ** 2; }
  const slope = den === 0 ? 0 : num / den;
  const slopePct = slope / meanY;
  if (slopePct > 0.002) return 'UP';
  if (slopePct < -0.002) return 'DOWN';
  return 'SIDEWAYS';
}
function maTransitionSignal(ma5, ma10, ma20, ma60) {
  if (ma5 > ma10 && ma10 > ma20 && ma20 > ma60) return 'UP';
  if (ma5 < ma10 && ma10 < ma20 && ma20 < ma60) return 'DOWN';
  return 'SIDEWAYS';
}
function fakeBreakout(closes, period = 20) {
  if (closes.length < period + 5) return false;
  const m = ma(closes, period);
  const recent = closes[closes.length - 1];
  const recent5 = ma(closes.slice(-5), 5);
  return recent > m * 1.02 && recent5 < m * 1.01;
}
function consecutiveUpDays(closes) {
  let count = 0;
  for (let i = closes.length - 1; i > 0; i--) { if (closes[i] > closes[i - 1]) count++; else break; }
  return count;
}

// ============================================================================
// 真 M8 6 個 modules + Synthesizer + DecisionEngine (同 v2)
// ============================================================================

const decisionEngine = new DecisionEngine();

async function m8DecisionFn(klines, params = {}) {
  if (!klines || klines.length < 60) {
    return { final_action: 'WAIT', final_action_reason: 'data 唔夠', confidence: 0, module_verdicts: [], synthesizer_verdict: null };
  }
  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume || 0);
  const last = closes[closes.length - 1];

  const ma5 = ma(closes, 5), ma10 = ma(closes, 10), ma20 = ma(closes, 20), ma60 = ma(closes, 60);
  const m1State = maTransitionSignal(ma5, ma10, ma20, ma60);
  const m1Ret = m1State === 'UP' ? 0.04 : m1State === 'DOWN' ? -0.04 : 0.01;
  const m1DD = m1State === 'UP' ? 0.06 : m1State === 'DOWN' ? 0.12 : 0.04;

  const m2State = trendlineState(closes, 30);
  const m3State = trendlineState(closes, 60);

  const r = rsi(closes, 14);
  const m = macd(closes);
  const rsiNorm = (r - 50) / 50;
  let m4State = 'SIDEWAYS';
  if (r > 60 && m.hist > 0) m4State = 'UP';
  else if (r < 40 && m.hist < 0) m4State = 'DOWN';
  const m4Ret = m4State === 'UP' ? 0.03 : m4State === 'DOWN' ? -0.03 : 0.005;

  const obvSlope = closes.length > 30 ? closes.slice(-30).reduce((s, c, i) => s + (c - (closes[closes.length - 30] || c)) * (volumes[volumes.length - 30 + i] || 0), 0) : 0;
  let m5State = 'SIDEWAYS';
  if (last > ma20 && obvSlope > 0) m5State = 'UP';
  else if (last < ma20 && obvSlope < 0) m5State = 'DOWN';

  const boll = bollinger(closes, 20);
  let m6State = 'SIDEWAYS';
  if (boll.squeeze) m6State = 'TRANSITION';
  else if (last > boll.upper) m6State = 'UP';
  else if (last < boll.lower) m6State = 'DOWN';

  const module_verdicts = [
    { module_id: 'ma-alignment', state: m1State, expected_return: m1Ret, max_drawdown_estimate: m1DD, base_weight: 1.0 },
    { module_id: 'hl-structure',  state: m2State, expected_return: m2State === 'UP' ? 0.03 : m2State === 'DOWN' ? -0.03 : 0.01, max_drawdown_estimate: 0.05, base_weight: 1.0 },
    { module_id: 'trendline',     state: m3State, expected_return: m3State === 'UP' ? 0.04 : m3State === 'DOWN' ? -0.04 : 0.015, max_drawdown_estimate: 0.06, base_weight: 1.0 },
    { module_id: 'indicators',    state: m4State, expected_return: m4Ret, max_drawdown_estimate: 0.07, base_weight: 1.0, sentiment_6d: { rsi: rsiNorm } },
    { module_id: 'volume',        state: m5State, expected_return: m5State === 'UP' ? 0.025 : m5State === 'DOWN' ? -0.025 : 0.005, max_drawdown_estimate: 0.06, base_weight: 1.0 },
    { module_id: 'volatility',    state: m6State, expected_return: 0.02, max_drawdown_estimate: boll.squeeze ? 0.10 : 0.05, base_weight: 1.0 },
  ];

  const stateMap = { UP: 1, DOWN: -1, SIDEWAYS: 0, TRANSITION: 0.3 };
  const ssi_score = (module_verdicts.reduce((s, v) => s + stateMap[v.state], 0) / module_verdicts.length) * 50 + 50;
  const upCount = module_verdicts.filter(v => v.state === 'UP').length;
  const downCount = module_verdicts.filter(v => v.state === 'DOWN').length;
  const alignment_score = Math.abs(upCount - downCount) / module_verdicts.length;
  const grade_idx = Math.max(0, Math.min(7, Math.round(ssi_score / 100 * 7)));
  const GRADES = ['F', 'D', 'C', 'C+', 'B', 'B+', 'A', 'A+'];
  const grade = GRADES[grade_idx];
  const kelly_fraction = alignment_score > 0.6 ? 0.25 : alignment_score > 0.3 ? 0.15 : 0.10;
  const grade_score = grade_idx / 7;

  const synthesizerVerdict = { ssi_score, alignment_score, grade, grade_score, kelly_fraction, module_verdicts };

  const marketData = {
    currentPrice: last,
    consecutiveUpDays: consecutiveUpDays(closes),
    squeezeDetected: boll.squeeze,
    fakeBreakoutDetected: fakeBreakout(closes, 20),
    maTrendlineTransition: m1State === 'SIDEWAYS' && m3State !== 'SIDEWAYS' && m3State !== m1State,
  };

  return await decisionEngine.decide({
    synthesizerVerdict, moduleVerdicts: module_verdicts, marketData,
  });
}

// ============================================================================
// Cache + fetch helpers (per-stock period support)
// ============================================================================

async function fetchKlines(symbol, period, count) {
  const url = `${BACKEND}/api/kline?code=${encodeURIComponent(symbol)}&period=${period}&count=${count}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`/api/kline ${resp.status}`);
  const data = await resp.json();
  return (data.klines || []).map(k => ({
    timestamp: typeof k.time === 'string' ? new Date(k.time).getTime() : k.time,
    open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume || 0,
  }));
}

async function postOptimal(symbol, cvResult) {
  const { folds, overall } = cvResult;
  const resp = await fetch(`${BACKEND}/api/adaptive-params/${encodeURIComponent(symbol)}/back-test`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kelly: overall.bestParams.kelly,
      rsiWeight: overall.bestParams.rsiWeight,
      ssiWeights: overall.bestParams.ssiWeights,
      validation: {
        avgValidateScore: overall.avgValidateScore,
        stabilityScore: overall.stabilityScore,
        totalValidateSamples: overall.totalValidateSamples,
      },
      window: { initialDays: 126, finalDays: 500, extendCount: folds.length > 0 ? 1 : 0 },
      foldsCount: folds.length,
    }),
  });
  return resp.ok;
}

async function postForwardReturn(symbol, fold) {
  const normKlines = (fold.validateKlines || []).map(k => ({
    ...k,
    timestamp: typeof k.timestamp === 'number' ? k.timestamp : new Date(k.timestamp).getTime(),
  }));
  if (normKlines.length < 30) return 0;

  const summary = await runReplay(normKlines, {
    symbol, klines: normKlines,
    holdDays: [5, 10, 20], stepDays: 2, lookbackDays: 60,
    params: { ...fold.bestParams },
  }, m8DecisionFn);

  let count = 0;
  for (const r of summary.results) {
    const resp = await fetch(`${BACKEND}/api/adaptive-params/${encodeURIComponent(symbol)}/forward-return`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: r.date, action: r.action,
        fwd5: r.forwardReturn5d, fwd10: r.forwardReturn10d, fwd20: r.forwardReturn20d,
        hit: r.hit5d,
      }),
    });
    if (resp.ok) count++;
  }
  return count;
}

async function runOne(stock) {
  const t0 = Date.now();
  try {
    process.stdout.write(`📊 ${stock.symbol.padEnd(12)} (${stock.name.padEnd(10)}) [1w] ... `);
    const klines = await fetchKlines(stock.symbol, '1w', 500);
    if (klines.length < 90) {
      console.log(`⚠️  skip (klines=${klines.length})`);
      return { symbol: stock.symbol, name: stock.name, market: stock.market, status: 'skip', reason: 'data 唔夠' };
    }

    const cvResult = await runWalkForwardCV({
      klines,
      decisionFn: m8DecisionFn,
      baseSymbol: stock.symbol,
      numFolds: 3,
      tuneRatio: 0.67,
      baseReplayConfig: { stepDays: 2, lookbackDays: 60, holdDays: [5, 10, 20] },
    });

    const { overall, folds } = cvResult;
    const ok1 = await postOptimal(stock.symbol, cvResult);
    let frCount = 0;
    for (const fold of folds) {
      frCount += await postForwardReturn(stock.symbol, fold);
    }
    const ms = Date.now() - t0;
    const score = overall.avgValidateScore.toFixed(1);
    const stability = (overall.stabilityScore * 100).toFixed(0);
    const samples = overall.totalValidateSamples;
    const kelly = (overall.bestParams.kelly * 100).toFixed(0);
    console.log(`✅ ${ms}ms · score=${score} · stability=${stability}% · ${samples} samples · kelly=${kelly}% · frRecords=${frCount}`);
    return {
      symbol: stock.symbol, name: stock.name, market: stock.market, status: 'ok',
      score: overall.avgValidateScore, stability: overall.stabilityScore,
      samples: overall.totalValidateSamples, kelly: overall.bestParams.kelly,
      folds: folds.length, frRecords: frCount, ms,
    };
  } catch (e) {
    console.log(`❌ ${e.message}`);
    return { symbol: stock.symbol, name: stock.name, market: stock.market, status: 'fail', error: e.message };
  }
}

async function main() {
  console.log('🚀 M9 Back Test Pilot v3 — Re-run 7 隻用 1w period (backend 1w bug 已修)');
  console.log(`Backend: ${BACKEND}`);
  console.log(`Config: 1w period · 500 bars (~9.6 年) · 3 folds rolling · stepDays=2 · 真 M8 decisionFn\n`);

  const t0 = Date.now();
  const results = [];
  for (const stock of RERUN_STOCKS) {
    results.push(await runOne(stock));
  }
  const totalMs = Date.now() - t0;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📋 Re-run Summary (${RERUN_STOCKS.length} stocks · ${(totalMs / 1000).toFixed(1)}s total)\n`);

  const okResults = results.filter(r => r.status === 'ok');
  if (okResults.length === 0) {
    console.log('❌ 冇任何 stock 跑成功');
    process.exit(1);
  }

  const ranked = [...okResults].sort((a, b) => {
    if (Math.abs(a.score - b.score) > 5) return b.score - a.score;
    return b.stability - a.stability;
  });

  console.log('🏆 Top 5 (by score + stability):');
  for (let i = 0; i < Math.min(5, ranked.length); i++) {
    const r = ranked[i];
    const medal = ['🥇', '🥈', '🥉', '4.', '5.'][i];
    const scoreColor = r.score >= 70 ? '🟢' : r.score >= 50 ? '🟡' : '🔴';
    const stabColor = r.stability >= 0.7 ? '🟢' : r.stability >= 0.4 ? '🟡' : '🔴';
    console.log(`  ${medal} ${r.symbol.padEnd(12)} (${r.name}) · score=${r.score.toFixed(1)}${scoreColor} · stability=${(r.stability * 100).toFixed(0)}%${stabColor} · samples=${r.samples} · kelly=${(r.kelly * 100).toFixed(0)}%`);
  }

  console.log('\n📊 All results:');
  console.table(ranked.map(r => ({
    symbol: r.symbol, name: r.name, market: r.market,
    score: r.score.toFixed(1), stability: (r.stability * 100).toFixed(0) + '%',
    samples: r.samples, kelly: (r.kelly * 100).toFixed(0) + '%',
    folds: r.folds, frRecords: r.frRecords, ms: r.ms,
  })));

  const failed = results.filter(r => r.status !== 'ok');
  if (failed.length > 0) {
    console.log(`\n⚠️  Failed (${failed.length}):`);
    for (const f of failed) {
      console.log(`  ${f.symbol} (${f.name}) — ${f.status}: ${f.reason || f.error || 'unknown'}`);
    }
  }

  console.log(`\n✅ Done · ${(totalMs / 1000).toFixed(1)}s total · ${okResults.length}/${RERUN_STOCKS.length} succeeded`);
  console.log(`📦 Cache 累積 (本 run): ${okResults.length} optimal updated + ${okResults.reduce((s, r) => s + r.frRecords, 0)} forward return records added`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });

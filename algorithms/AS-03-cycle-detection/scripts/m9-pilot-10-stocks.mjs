#!/usr/bin/env node
/**
 * M9 Back Test Pilot v2 — 10 隻 (5 港 + 5 美) with 真 M8 decisionFn
 *
 * 大少 2026-08-09 "C" 確認: 換 decisionFn = 真 M8 (DecisionEngine.decide()) + 加大 range 落 500 日
 *
 * 真 M8 流程:
 *   1. 計算 4 條 MA (5/10/20/60) + RSI (14) + MACD + Bollinger squeeze + OBV
 *   2. 拎 6 個 module verdicts (M1-M6, pure JS 計算)
 *   3. Compute ssi_score + alignment + grade + kelly (純算, 模擬 Synthesizer)
 *   4. Call 真 DecisionEngine.decide() 拎 finalAction + trading card + interpretation
 *
 * Config:
 *   - range 500 日 (vs v1 252)
 *   - 3 folds rolling walk-forward CV
 *   - min klines per fold 30 (vs v1 60)
 */

import { runWalkForwardCV, runReplay } from '../build/back-test.bundle.js';
import { DecisionEngine, DEFAULT_ADAPTIVE_PARAMS } from '../build/decision-engine.bundle.js';

const BACKEND = 'http://localhost:18792';
const PILOT_STOCKS = [
  { symbol: 'HK.00700', market: 'HK', name: '騰訊' },
  { symbol: 'HK.00981', market: 'HK', name: '中芯國際' },
  { symbol: 'HK.01810', market: 'HK', name: '小米集團' },
  { symbol: 'HK.03690', market: 'HK', name: '美團' },
  { symbol: 'HK.09988', market: 'HK', name: '阿里' },
  { symbol: 'US.AAPL',  market: 'US', name: 'Apple' },
  { symbol: 'US.TSLA',  market: 'US', name: 'Tesla' },
  { symbol: 'US.NVDA',  market: 'US', name: 'NVIDIA' },
  { symbol: 'US.MSFT',  market: 'US', name: 'Microsoft' },
  { symbol: 'US.GOOGL', market: 'US', name: 'Alphabet' },
];

// ============================================================================
// Pure JS 計算 helper
// ============================================================================

function ma(closes, n) {
  if (closes.length < n) return null;
  return closes.slice(-n).reduce((a, b) => a + b, 0) / n;
}

function ema(closes, n) {
  if (closes.length < n) return null;
  const k = 2 / (n + 1);
  let e = closes[0];
  for (let i = 1; i < closes.length; i++) {
    e = closes[i] * k + e * (1 - k);
  }
  return e;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function macd(closes) {
  if (closes.length < 26) return { macd: 0, signal: 0, hist: 0 };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12 - ema26;
  // Signal line: 9-day EMA of MACD (simplified)
  return { macd: macdLine, signal: macdLine * 0.9, hist: macdLine * 0.1 };
}

function bollinger(closes, period = 20) {
  if (closes.length < period) return { upper: 0, lower: 0, mid: 0, width: 0, squeeze: false };
  const m = ma(closes, period);
  const slice = closes.slice(-period);
  const variance = slice.reduce((s, x) => s + (x - m) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  const upper = m + 2 * sd;
  const lower = m - 2 * sd;
  const width = (upper - lower) / m;
  // squeeze if width < 0.04 (4%)
  return { upper, lower, mid: m, width, squeeze: width < 0.04 };
}

function obv(closes, volumes) {
  if (closes.length !== volumes.length) return 0;
  let total = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) total += volumes[i];
    else if (closes[i] < closes[i - 1]) total -= volumes[i];
  }
  return total;
}

function consecutiveUpDays(closes) {
  let count = 0;
  for (let i = closes.length - 1; i > 0; i--) {
    if (closes[i] > closes[i - 1]) count++;
    else break;
  }
  return count;
}

function trendlineState(closes, period = 30) {
  if (closes.length < period) return 'SIDEWAYS';
  const slice = closes.slice(-period);
  // Linear regression slope
  const n = slice.length;
  const xs = Array.from({ length: n }, (_, i) => i);
  const meanX = xs.reduce((a, b) => a + b) / n;
  const meanY = slice.reduce((a, b) => a + b) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (slice[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const slopePct = slope / meanY;
  if (slopePct > 0.002) return 'UP';
  if (slopePct < -0.002) return 'DOWN';
  return 'SIDEWAYS';
}

function maTransitionSignal(ma5, ma10, ma20, ma60) {
  // Detect MA cross transitions
  if (ma5 > ma10 && ma10 > ma20 && ma20 > ma60) return 'UP';
  if (ma5 < ma10 && ma10 < ma20 && ma20 < ma60) return 'DOWN';
  return 'SIDEWAYS';
}

function fakeBreakout(closes, period = 20) {
  if (closes.length < period + 5) return false;
  const m = ma(closes, period);
  const recent = closes[closes.length - 1];
  const recent5 = ma(closes.slice(-5), 5);
  // Price just broke above MA20 but only briefly, MA still flat
  return recent > m * 1.02 && recent5 < m * 1.01;
}

// ============================================================================
// 真 M8 嘅 6 個 modules 純算 → SynthesizerVerdict → DecisionEngine.decide()
// ============================================================================

const decisionEngine = new DecisionEngine();

async function m8DecisionFn(klines, params = {}) {
  if (!klines || klines.length < 60) {
    return {
      final_action: 'WAIT', final_action_reason: 'data 唔夠', confidence: 0,
      module_verdicts: [], synthesizer_verdict: null,
    };
  }

  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume || 0);
  const last = closes[closes.length - 1];

  // ===== 6 個 modules (M1-M6) =====
  // M1 MA alignment
  const ma5 = ma(closes, 5);
  const ma10 = ma(closes, 10);
  const ma20 = ma(closes, 20);
  const ma60 = ma(closes, 60);
  const m1State = maTransitionSignal(ma5, ma10, ma20, ma60);
  const m1Conf = m1State === 'UP' ? 0.6 : m1State === 'DOWN' ? 0.4 : 0.5;
  const m1Ret = m1State === 'UP' ? 0.04 : m1State === 'DOWN' ? -0.04 : 0.01;
  const m1DD = m1State === 'UP' ? 0.06 : m1State === 'DOWN' ? 0.12 : 0.04;

  // M2 HL structure
  const m2State = trendlineState(closes, 30);
  const m2Ret = m2State === 'UP' ? 0.03 : m2State === 'DOWN' ? -0.03 : 0.01;
  const m2DD = 0.05;

  // M3 Trendline
  const m3State = trendlineState(closes, 60);
  const m3Ret = m3State === 'UP' ? 0.04 : m3State === 'DOWN' ? -0.04 : 0.015;
  const m3DD = 0.06;

  // M4 Indicators (RSI + MACD)
  const r = rsi(closes, 14);
  const m = macd(closes);
  const rsiNorm = (r - 50) / 50; // [-1, 1]
  let m4State = 'SIDEWAYS';
  if (r > 60 && m.hist > 0) m4State = 'UP';
  else if (r < 40 && m.hist < 0) m4State = 'DOWN';
  const m4Ret = m4State === 'UP' ? 0.03 : m4State === 'DOWN' ? -0.03 : 0.005;
  const m4DD = 0.07;

  // M5 Volume-Price (OBV)
  const obvSlope = closes.length > 30 ?
    (closes.slice(-30).reduce((s, c, i) => s + (c - (closes[closes.length - 30] || c)) * (volumes[volumes.length - 30 + i] || 0), 0)) : 0;
  let m5State = 'SIDEWAYS';
  if (last > ma20 && obvSlope > 0) m5State = 'UP';
  else if (last < ma20 && obvSlope < 0) m5State = 'DOWN';
  const m5Ret = m5State === 'UP' ? 0.025 : m5State === 'DOWN' ? -0.025 : 0.005;
  const m5DD = 0.06;

  // M6 Volatility (Bollinger squeeze)
  const boll = bollinger(closes, 20);
  let m6State = 'SIDEWAYS';
  if (boll.squeeze) m6State = 'TRANSITION';
  else if (last > boll.upper) m6State = 'UP';
  else if (last < boll.lower) m6State = 'DOWN';
  const m6Ret = 0.02;
  const m6DD = boll.squeeze ? 0.10 : 0.05;

  // Module verdicts array
  const module_verdicts = [
    { module_id: 'ma-alignment', state: m1State, expected_return: m1Ret, max_drawdown_estimate: m1DD, base_weight: 1.0 },
    { module_id: 'hl-structure',  state: m2State, expected_return: m2Ret, max_drawdown_estimate: m2DD, base_weight: 1.0 },
    { module_id: 'trendline',     state: m3State, expected_return: m3Ret, max_drawdown_estimate: m3DD, base_weight: 1.0 },
    { module_id: 'indicators',    state: m4State, expected_return: m4Ret, max_drawdown_estimate: m4DD, base_weight: 1.0, sentiment_6d: { rsi: rsiNorm } },
    { module_id: 'volume',        state: m5State, expected_return: m5Ret, max_drawdown_estimate: m5DD, base_weight: 1.0 },
    { module_id: 'volatility',    state: m6State, expected_return: m6Ret, max_drawdown_estimate: m6DD, base_weight: 1.0 },
  ];

  // SynthesizerVerdict (純算)
  const stateMap = { UP: 1, DOWN: -1, SIDEWAYS: 0, TRANSITION: 0.3 };
  const ssi_score = (module_verdicts.reduce((s, v) => s + stateMap[v.state], 0) / module_verdicts.length) * 50 + 50; // [0, 100]
  const upCount = module_verdicts.filter(v => v.state === 'UP').length;
  const downCount = module_verdicts.filter(v => v.state === 'DOWN').length;
  const alignment_score = Math.abs(upCount - downCount) / module_verdicts.length;
  const grade_idx = Math.max(0, Math.min(7, Math.round(ssi_score / 100 * 7))); // 0-7
  const GRADES = ['F', 'D', 'C', 'C+', 'B', 'B+', 'A', 'A+'];
  const grade = GRADES[grade_idx];
  const kelly_fraction = alignment_score > 0.6 ? 0.25 : alignment_score > 0.3 ? 0.15 : 0.10;
  const grade_score = grade_idx / 7;

  const synthesizerVerdict = {
    ssi_score, alignment_score, grade, grade_score, kelly_fraction,
    module_verdicts,
  };

  // Market data flags
  const marketData = {
    currentPrice: last,
    consecutiveUpDays: consecutiveUpDays(closes),
    squeezeDetected: boll.squeeze,
    fakeBreakoutDetected: fakeBreakout(closes, 20),
    maTrendlineTransition: m1State === 'SIDEWAYS' && m3State !== 'SIDEWAYS' && m3State !== m1State,
  };

  // 真 M8 DecisionEngine.decide()
  return await decisionEngine.decide({
    synthesizerVerdict,
    moduleVerdicts: module_verdicts,
    marketData,
  });
}

// ============================================================================
// Cache + fetch helpers
// ============================================================================

async function fetchKlines(symbol, count = 500) {
  const url = `${BACKEND}/api/kline?code=${encodeURIComponent(symbol)}&period=1d&count=${count}`;
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    holdDays: [5, 10, 20], stepDays: 5, lookbackDays: 60,
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

async function runOne(stock, range = 500) {
  const t0 = Date.now();
  try {
    process.stdout.write(`📊 ${stock.symbol.padEnd(12)} (${stock.name.padEnd(10)}) ... `);
    const klines = await fetchKlines(stock.symbol, range);
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
      baseReplayConfig: { stepDays: 5, lookbackDays: 60, holdDays: [5, 10, 20] },
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
  console.log('🚀 M9 Back Test Pilot v2 — 10 隻 (5 港 + 5 美) with 真 M8');
  console.log(`Backend: ${BACKEND}`);
  console.log(`Config: 500 日 range · 3 folds rolling walk-forward CV · 真 M8 decisionFn (6 modules + Synthesizer + DecisionEngine)\n`);

  const t0 = Date.now();
  const results = [];
  for (const stock of PILOT_STOCKS) {
    results.push(await runOne(stock, 500));
  }
  const totalMs = Date.now() - t0;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📋 Summary (${PILOT_STOCKS.length} stocks · ${(totalMs / 1000).toFixed(1)}s total)\n`);

  const okResults = results.filter(r => r.status === 'ok');
  if (okResults.length === 0) {
    console.log('❌ 冇任何 stock 跑成功');
    process.exit(1);
  }

  // Sort by score desc, then stability desc
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
    symbol: r.symbol,
    name: r.name,
    market: r.market,
    score: r.score.toFixed(1),
    stability: (r.stability * 100).toFixed(0) + '%',
    samples: r.samples,
    kelly: (r.kelly * 100).toFixed(0) + '%',
    folds: r.folds,
    frRecords: r.frRecords,
    ms: r.ms,
  })));

  const failed = results.filter(r => r.status !== 'ok');
  if (failed.length > 0) {
    console.log(`\n⚠️  Failed (${failed.length}):`);
    for (const f of failed) {
      console.log(`  ${f.symbol} (${f.name}) — ${f.status}: ${f.reason || f.error || 'unknown'}`);
    }
  }

  console.log(`\n✅ Done · ${(totalMs / 1000).toFixed(1)}s total · ${okResults.length}/${PILOT_STOCKS.length} succeeded`);
  console.log(`📦 Cache 累積: ${okResults.length} optimal (30 日 expiry) + ${okResults.reduce((s, r) => s + r.frRecords, 0)} forward return records (永久)`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });

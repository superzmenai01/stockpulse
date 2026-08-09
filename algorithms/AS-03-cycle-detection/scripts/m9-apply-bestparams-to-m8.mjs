#!/usr/bin/env node
/**
 * M9 → M8 Apply — 拎 1w 嘅 bestParams from cache, POST 落 M8 cache
 *
 * 大少 2026-08-09 09:54 揀 Option B (Recommended)
 *
 * 1w cache (v3.5 寫入) 已有 US.AAPL/MSFT/GOOGL 嘅 high score bestParams:
 *   - US.AAPL: score 103.6, stability 82%, 39 samples
 *   - US.MSFT: score 88.8, stability 78%, 39 samples
 *   - US.GOOGL: score 82.0, stability 76%, 39 samples
 *
 * 直接 POST 落 M8 cache, 之後 testing page 切去 08 — AS-03-DEC 跑會用呢啲 bestParams
 *
 * M9 bestParams (3 fields) → M8 AdaptiveParamsSave (5 fields):
 *   - kelly (float) → kellyFraction (enum: 'octo' | 'quarter' | 'half')
 *   - rsiWeight (float) → rsiWeight (float)
 *   - ssiWeights: {ma, hl, tl} → ssiWeights: {ma, hl, trendline}
 *   - markowitzCorr: default {dailyWeekly: 0.85, dailyMonthly: 0.6, weeklyMonthly: 0.7}
 *   - hurstThresholds: default {persistent: 0.55, reverting: 0.45}
 */

const BACKEND = 'http://localhost:18792';
const TOP_3_STOCKS = [
  { symbol: 'US.AAPL',  name: 'Apple' },
  { symbol: 'US.MSFT',  name: 'Microsoft' },
  { symbol: 'US.GOOGL', name: 'Alphabet' },
];

// Map M9 kelly float → M8 kellyFraction enum
// (half = 0.5, quarter = 0.25, octo = 0.125)
function kellyToFraction(kelly) {
  if (kelly >= 0.30) return 'half';
  if (kelly >= 0.15) return 'quarter';
  return 'octo';
}

async function fetchM9Optimal(symbol) {
  const resp = await fetch(`${BACKEND}/api/adaptive-params/${encodeURIComponent(symbol)}/back-test`);
  if (!resp.ok) {
    if (resp.status === 404) return null;
    throw new Error(`/api/adaptive-params/${symbol}/back-test ${resp.status}`);
  }
  const data = await resp.json();
  if (!data.optimal_params) return null;
  return data;
}

async function saveM8Params(symbol, m8Body) {
  const resp = await fetch(`${BACKEND}/api/adaptive-params/${encodeURIComponent(symbol)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(m8Body),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`POST ${symbol} failed (${resp.status}): ${errText}`);
  }
  return await resp.json();
}

async function verifyM8Cache(symbol) {
  const resp = await fetch(`${BACKEND}/api/adaptive-params/${encodeURIComponent(symbol)}`);
  if (!resp.ok) return null;
  return await resp.json();
}

async function main() {
  console.log('🚀 M9 → M8 Apply — 拎 1w bestParams POST 落 M8 cache\n');
  console.log('Stocks: US.AAPL, US.MSFT, US.GOOGL (大少 揀嘅 Top 3)\n');

  let success = 0, fail = 0;
  for (const stock of TOP_3_STOCKS) {
    try {
      console.log(`📊 ${stock.symbol} (${stock.name})...`);

      // 1. Fetch M9 optimal from 1w cache
      const m9 = await fetchM9Optimal(stock.symbol);
      if (!m9) {
        console.log(`  ⚠️  no M9 cache, skip`);
        fail++;
        continue;
      }
      const { optimal_params, validation } = m9;
      const kellyFloat = optimal_params.kelly;
      const m8Kelly = kellyToFraction(kellyFloat);
      const m8Body = {
        ssiWeights: {
          ma: optimal_params.ssiWeights.ma,
          hl: optimal_params.ssiWeights.hl,
          trendline: optimal_params.ssiWeights.tl ?? optimal_params.ssiWeights.trendline ?? 0.3,
        },
        rsiWeight: optimal_params.rsiWeight,
        kellyFraction: m8Kelly,
        markowitzCorr: { dailyWeekly: 0.85, dailyMonthly: 0.6, weeklyMonthly: 0.7 },
        hurstThresholds: { persistent: 0.55, reverting: 0.45 },
      };

      console.log(`  ✓ M9 cache: kelly=${kellyFloat} → M8 kellyFraction=${m8Kelly}, rsi=${optimal_params.rsiWeight}, ssi=${JSON.stringify(m8Body.ssiWeights)}`);
      console.log(`  ✓ M9 validation: score=${validation.avgValidateScore.toFixed(1)}, stab=${(validation.stabilityScore * 100).toFixed(0)}%, samples=${validation.totalValidateSamples}`);

      // 2. POST 落 M8 cache
      const saveResult = await saveM8Params(stock.symbol, m8Body);
      console.log(`  ✅ M8 cache saved (expires ${saveResult.expires_at || saveResult.expiresAt || '7d'})`);

      // 3. Verify
      const verify = await verifyM8Cache(stock.symbol);
      if (verify && verify.params) {
        console.log(`  ✓ Verify: kellyFraction=${verify.params.kellyFraction}, rsiWeight=${verify.params.rsiWeight}`);
      }

      success++;
      console.log('');
    } catch (e) {
      console.log(`  ❌ ${e.message}\n`);
      fail++;
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📋 Apply Summary: ${success}/${TOP_3_STOCKS.length} succeeded, ${fail} failed`);

  if (success > 0) {
    console.log(`\n✅ ${success} 隻 stock 嘅 M9 bestParams 已經 POST 落 M8 cache (7 日 expiry)`);
    console.log(`📋 Next: 喺 testing page 切去 08 — AS-03-DEC, 填 US.AAPL/MSFT/GOOGL, 撳 跑算法`);
    console.log(`        M8 會用 M9 嘅 bestParams (kellyFraction + rsiWeight + ssiWeights), 拎到 high score 嘅 finalAction`);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });

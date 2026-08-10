// modules/back-test.ts
function getKlineDate(kline) {
  return new Date(kline.timestamp).toISOString().substring(0, 10);
}
function findKlineIndexByDate(klines, date) {
  if (klines.length === 0) return -1;
  const target = new Date(date).getTime();
  for (let i = 0; i < klines.length; i++) {
    if (klines[i].timestamp >= target) return i;
  }
  return klines.length - 1;
}
function computeForwardReturn(closeAt, closeAfter) {
  if (closeAfter === null || closeAfter === void 0 || closeAt === 0) return null;
  return (closeAfter - closeAt) / closeAt * 100;
}
function computeHit(forwardReturn) {
  if (forwardReturn === null) return null;
  return forwardReturn > 0;
}
function computeAvg(values) {
  const valid = values.filter((v) => v !== null && !isNaN(v));
  if (valid.length === 0) return null;
  const sum = valid.reduce((acc, v) => acc + v, 0);
  return sum / valid.length;
}
function computeHitRate(hits) {
  const valid = hits.filter((h) => h !== null);
  if (valid.length === 0) return null;
  const countTrue = valid.filter((h) => h === true).length;
  return countTrue / valid.length * 100;
}
function computeActionBreakdown(results) {
  const breakdown = {};
  for (const r of results) {
    breakdown[r.action] = (breakdown[r.action] || 0) + 1;
  }
  return breakdown;
}
async function runReplay(klines, config, decisionFn) {
  const stepDays = config.stepDays ?? 5;
  const lookbackDays = config.lookbackDays ?? 60;
  const holdDays = config.holdDays ?? [5, 10, 20];
  if (klines.length === 0) {
    return {
      symbol: config.symbol,
      config,
      results: [],
      totalDays: 0,
      actionBreakdown: {},
      avgForwardReturn5d: null,
      avgForwardReturn10d: null,
      avgForwardReturn20d: null,
      hitRate5d: null,
      hitRate10d: null,
      hitRate20d: null
    };
  }
  const startDate = config.startDate ?? getKlineDate(klines[0]);
  const endDate = config.endDate ?? getKlineDate(klines[klines.length - 1]);
  const startIdx = Math.max(0, findKlineIndexByDate(klines, startDate));
  const rawEndIdx = findKlineIndexByDate(klines, endDate);
  const endIdx = Math.min(klines.length - 1, Math.max(0, rawEndIdx));
  const results = [];
  for (let stepIdx = startIdx; stepIdx <= endIdx; stepIdx += stepDays) {
    const stepKline = klines[stepIdx];
    const historicalKlines = klines.slice(0, stepIdx + 1);
    if (historicalKlines.length < 30) {
      continue;
    }
    try {
      const verdict = await decisionFn(historicalKlines, config.params ?? {});
      const closeAtVerdict = stepKline.close;
      const closeAfter5d = holdDays.includes(5) && stepIdx + 5 < klines.length ? klines[stepIdx + 5].close : null;
      const closeAfter10d = holdDays.includes(10) && stepIdx + 10 < klines.length ? klines[stepIdx + 10].close : null;
      const closeAfter20d = holdDays.includes(20) && stepIdx + 20 < klines.length ? klines[stepIdx + 20].close : null;
      const forwardReturn5d = computeForwardReturn(closeAtVerdict, closeAfter5d);
      const forwardReturn10d = computeForwardReturn(closeAtVerdict, closeAfter10d);
      const forwardReturn20d = computeForwardReturn(closeAtVerdict, closeAfter20d);
      const hit5d = computeHit(forwardReturn5d);
      const hit10d = computeHit(forwardReturn10d);
      const hit20d = computeHit(forwardReturn20d);
      results.push({
        date: getKlineDate(stepKline),
        action: verdict.final_action,
        closeAtVerdict,
        forwardReturn5d,
        forwardReturn10d,
        forwardReturn20d,
        hit5d,
        hit10d,
        hit20d,
        verdict
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[back-test] Replay at ${getKlineDate(stepKline)} failed: ${errMsg}`);
      continue;
    }
  }
  const totalDays = results.length;
  const actionBreakdown = computeActionBreakdown(results);
  const avgForwardReturn5d = computeAvg(results.map((r) => r.forwardReturn5d));
  const avgForwardReturn10d = computeAvg(results.map((r) => r.forwardReturn10d));
  const avgForwardReturn20d = computeAvg(results.map((r) => r.forwardReturn20d));
  const hitRate5d = computeHitRate(results.map((r) => r.hit5d));
  const hitRate10d = computeHitRate(results.map((r) => r.hit10d));
  const hitRate20d = computeHitRate(results.map((r) => r.hit20d));
  return {
    symbol: config.symbol,
    config,
    results,
    totalDays,
    actionBreakdown,
    avgForwardReturn5d,
    avgForwardReturn10d,
    avgForwardReturn20d,
    hitRate5d,
    hitRate10d,
    hitRate20d
  };
}
function formatForwardReturn(forwardReturn, hit) {
  if (forwardReturn === null) {
    return { returnText: "N/A", hitEmoji: "\u26AB" };
  }
  const sign = forwardReturn >= 0 ? "+" : "";
  const returnText = `${sign}${forwardReturn.toFixed(2)}%`;
  const hitEmoji = hit === true ? "\u{1F7E2}" : hit === false ? "\u{1F534}" : "\u26AB";
  return { returnText, hitEmoji };
}
function scoreResult(summary) {
  const hitRate = summary.hitRate5d ?? 0;
  const avgReturn = summary.avgForwardReturn5d ?? 0;
  return hitRate * 0.5 + avgReturn / 5 * 0.5 * 100;
}
var DEFAULT_SSI_WEIGHTS_VARIATIONS = [
  { ma: 0.4, hl: 0.3, tl: 0.3 },
  // 偏 MA
  { ma: 0.3, hl: 0.3, tl: 0.4 },
  // 偏 TL
  { ma: 0.3, hl: 0.4, tl: 0.3 }
  // 偏 HL
];
var DEFAULT_KELLY_VALUES = [0.125, 0.25, 0.5];
var DEFAULT_RSI_WEIGHTS = [0.1, 0.2, 0.3];
async function runCoarseGrid(options) {
  const kellyValues = options.kellyValues ?? DEFAULT_KELLY_VALUES;
  const rsiWeights = options.rsiWeights ?? DEFAULT_RSI_WEIGHTS;
  const ssiWeights = (options.ssiWeightsVariations ?? DEFAULT_SSI_WEIGHTS_VARIATIONS)[0];
  const entries = [];
  for (const kelly of kellyValues) {
    for (const rsiWeight of rsiWeights) {
      const params = { kelly, rsiWeight, ssiWeights };
      const replayConfig = {
        symbol: options.baseSymbol,
        klines: options.klines,
        holdDays: [5, 10, 20],
        stepDays: 5,
        lookbackDays: 60,
        ...options.baseReplayConfig,
        params: { ...options.baseReplayConfig?.params ?? {}, ...params }
      };
      const summary = await runReplay(options.klines, replayConfig, options.decisionFn);
      const score = scoreResult(summary);
      entries.push({
        params,
        score,
        hitRate5d: summary.hitRate5d,
        avgReturn5d: summary.avgForwardReturn5d,
        resultsCount: summary.totalDays,
        summary
      });
    }
  }
  entries.sort((a, b) => b.score - a.score);
  const top5 = entries.slice(0, 5);
  return { entries, top5 };
}
async function runFineTune(options) {
  const fineTunePct = options.fineTunePercent ?? 0.2;
  const entries = [];
  for (const base of options.top5) {
    const kellyVariations = [
      base.params.kelly * (1 - fineTunePct),
      base.params.kelly,
      base.params.kelly * (1 + fineTunePct)
    ];
    const rsiWeightVariations = [
      base.params.rsiWeight * (1 - fineTunePct),
      base.params.rsiWeight,
      base.params.rsiWeight * (1 + fineTunePct)
    ];
    for (let i = 0; i < kellyVariations.length; i++) {
      const kelly = kellyVariations[i];
      const params = { kelly, rsiWeight: base.params.rsiWeight, ssiWeights: base.params.ssiWeights };
      const replayConfig = {
        symbol: options.baseSymbol,
        klines: options.klines,
        holdDays: [5, 10, 20],
        stepDays: 5,
        lookbackDays: 60,
        ...options.baseReplayConfig,
        params: { ...options.baseReplayConfig?.params ?? {}, ...params }
      };
      const summary = await runReplay(options.klines, replayConfig, options.decisionFn);
      const score = scoreResult(summary);
      entries.push({
        baseParams: base.params,
        variation: { kellyMul: i === 0 ? -fineTunePct : i === 1 ? 0 : fineTunePct, rsiWeightMul: 0 },
        params,
        score,
        hitRate5d: summary.hitRate5d,
        avgReturn5d: summary.avgForwardReturn5d,
        resultsCount: summary.totalDays,
        summary
      });
    }
    for (let i = 0; i < rsiWeightVariations.length; i++) {
      const rsiWeight = rsiWeightVariations[i];
      const params = { kelly: base.params.kelly, rsiWeight, ssiWeights: base.params.ssiWeights };
      const replayConfig = {
        symbol: options.baseSymbol,
        klines: options.klines,
        holdDays: [5, 10, 20],
        stepDays: 5,
        lookbackDays: 60,
        ...options.baseReplayConfig,
        params: { ...options.baseReplayConfig?.params ?? {}, ...params }
      };
      const summary = await runReplay(options.klines, replayConfig, options.decisionFn);
      const score = scoreResult(summary);
      entries.push({
        baseParams: base.params,
        variation: { kellyMul: 0, rsiWeightMul: i === 0 ? -fineTunePct : i === 1 ? 0 : fineTunePct },
        params,
        score,
        hitRate5d: summary.hitRate5d,
        avgReturn5d: summary.avgForwardReturn5d,
        resultsCount: summary.totalDays,
        summary
      });
    }
  }
  entries.sort((a, b) => b.score - a.score);
  const best = entries[0];
  return { entries, best };
}
async function runAdaptiveWindow(options) {
  const initialDays = options.initialDays ?? 126;
  const extendDays = options.extendDays ?? 63;
  const maxDays = options.maxDays ?? 378;
  const minSamples = options.minSamples ?? 30;
  let currentDays = initialDays;
  let extendCount = 0;
  let currentKlines = options.klines.slice(-initialDays);
  let summary;
  while (true) {
    const replayConfig = {
      symbol: options.baseSymbol,
      klines: currentKlines,
      holdDays: [5, 10, 20],
      stepDays: 5,
      lookbackDays: 60,
      ...options.baseReplayConfig
    };
    summary = await runReplay(currentKlines, replayConfig, options.decisionFn);
    if (summary.totalDays >= minSamples || currentDays >= maxDays) {
      break;
    }
    currentDays = Math.min(maxDays, currentDays + extendDays);
    currentKlines = options.klines.slice(-currentDays);
    extendCount++;
  }
  return {
    finalKlines: currentKlines,
    initialDays,
    finalDays: currentDays,
    extendCount,
    finalSamples: summary.totalDays,
    minSamples,
    summary
  };
}
function splitFolds(klines, numFolds) {
  if (klines.length < numFolds * 30) {
    throw new Error(`[walk-forward] Insufficient klines: need \u2265 ${numFolds * 30}, got ${klines.length}`);
  }
  const foldSize = Math.floor(klines.length / numFolds);
  const folds = [];
  for (let i = 0; i < numFolds; i++) {
    const start = i * foldSize;
    const end = i === numFolds - 1 ? klines.length : (i + 1) * foldSize;
    folds.push(klines.slice(start, end));
  }
  return folds;
}
function stddev(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
async function runWalkForwardCV(options) {
  const numFolds = options.numFolds ?? 3;
  const tuneRatio = options.tuneRatio ?? 0.67;
  const folds = splitFolds(options.klines, numFolds);
  const foldResults = [];
  for (let i = 0; i < folds.length; i++) {
    const foldKlines = folds[i];
    const tuneEnd = Math.floor(foldKlines.length * tuneRatio);
    const tuneKlines = foldKlines.slice(0, tuneEnd);
    const validateKlines = foldKlines.slice(tuneEnd);
    if (tuneKlines.length < 30) {
      console.warn(`[walk-forward] Fold ${i} tune set too short: ${tuneKlines.length} klines, skipping`);
      continue;
    }
    if (validateKlines.length < 20) {
      console.warn(`[walk-forward] Fold ${i} validate set too short: ${validateKlines.length} klines, skipping`);
      continue;
    }
    const coarse = await runCoarseGrid({
      klines: tuneKlines,
      decisionFn: options.decisionFn,
      baseSymbol: options.baseSymbol,
      kellyValues: options.kellyValues,
      rsiWeights: options.rsiWeights,
      baseReplayConfig: options.baseReplayConfig
    });
    const fineTune = await runFineTune({
      klines: tuneKlines,
      decisionFn: options.decisionFn,
      top5: coarse.top5,
      baseSymbol: options.baseSymbol,
      fineTunePercent: options.fineTunePercent,
      baseReplayConfig: options.baseReplayConfig
    });
    const validateReplayConfig = {
      symbol: options.baseSymbol,
      klines: validateKlines,
      holdDays: [5, 10, 20],
      stepDays: 5,
      lookbackDays: 0,
      // 累積 (V1 fix)
      ...options.baseReplayConfig,
      params: { ...options.baseReplayConfig?.params ?? {}, ...fineTune.best.params }
    };
    const validateSummary = await runReplay(validateKlines, validateReplayConfig, options.decisionFn);
    const validateScore = scoreResult(validateSummary);
    foldResults.push({
      foldIndex: i,
      tuneKlines,
      validateKlines,
      bestParams: fineTune.best.params,
      tuneScore: fineTune.best.score,
      validateScore,
      validateSamples: validateSummary.totalDays,
      tuneResult: coarse
    });
  }
  if (foldResults.length === 0) {
    return {
      folds: [],
      overall: {
        bestParams: { kelly: 0.25, rsiWeight: 0.2, ssiWeights: { ma: 0.4, hl: 0.3, tl: 0.3 } },
        // default fallback
        avgValidateScore: 0,
        stabilityScore: 0,
        totalValidateSamples: 0
      }
    };
  }
  const bestFold = foldResults.reduce(
    (best, curr) => curr.validateScore > best.validateScore ? curr : best
  );
  const validateScores = foldResults.map((f) => f.validateScore);
  const avgValidateScore = validateScores.reduce((a, b) => a + b, 0) / validateScores.length;
  const stddevScore = stddev(validateScores);
  const stabilityScore = Math.abs(avgValidateScore) < 1e-3 ? 0 : Math.max(0, Math.min(1, 1 - stddevScore / Math.abs(avgValidateScore)));
  const totalValidateSamples = foldResults.reduce((sum, f) => sum + f.validateSamples, 0);
  return {
    folds: foldResults,
    overall: {
      bestParams: bestFold.bestParams,
      avgValidateScore,
      stabilityScore,
      totalValidateSamples
    }
  };
}
export {
  DEFAULT_KELLY_VALUES,
  DEFAULT_RSI_WEIGHTS,
  DEFAULT_SSI_WEIGHTS_VARIATIONS,
  formatForwardReturn,
  runAdaptiveWindow,
  runCoarseGrid,
  runFineTune,
  runReplay,
  runWalkForwardCV,
  scoreResult
};

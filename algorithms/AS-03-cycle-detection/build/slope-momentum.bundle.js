"use strict";
var SlopeMomentum = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // algorithms/AS-03-cycle-detection/modules/slope-momentum.ts
  var slope_momentum_exports = {};
  __export(slope_momentum_exports, {
    DEFAULT_SLOPE_MOMENTUM_CONFIG: () => DEFAULT_SLOPE_MOMENTUM_CONFIG,
    analyzeSlopeMomentum: () => analyzeSlopeMomentum
  });
  var DEFAULT_SLOPE_MOMENTUM_CONFIG = {
    // 大少 22:34 confirm Decision 2: 短期 slope threshold 0.5%
    shortPeriod: 5,
    // MA5 短期
    midPeriod: 10,
    // MA10 中期
    longPeriod: 20,
    // MA20 長期 (v1.0 spec 用 20 日做 long period, 60 日太多)
    shortSlopeThreshold: 5e-3,
    // 0.5% (D2 揀 A)
    midSlopeThreshold: 3e-3,
    // 0.3%
    longSlopeThreshold: 2e-3,
    // 0.2%
    // 大少 22:34 confirm Decision 3: reversal window 5 日
    reversalWindow: 5,
    // 5 日 (D3 揀 A)
    consecutiveDays: 3,
    // 連續 3 日 (M1/M2 acceleration filter)
    dataWindowDays: 100,
    // 用最近 100 日
    weakMomentumThreshold: 1e-3
    // 0.1% (M9 trigger)
  };
  function avgClose(klines, endIdx, period) {
    const startIdx = Math.max(0, endIdx - period + 1);
    const slice = klines.slice(startIdx, endIdx + 1);
    const sum = slice.reduce((acc, k) => acc + k.close, 0);
    return sum / slice.length;
  }
  function slope(history, i, N) {
    if (i < N) return 0;
    const denom = history[i - N];
    if (denom === 0) return 0;
    return (history[i] - history[i - N]) / denom;
  }
  function allConsecutiveIncreasing(history, endIdx, length) {
    if (endIdx - length + 1 < 0) return false;
    const EPSILON = 1e-9;
    for (let i = endIdx; i > endIdx - length + 1; i--) {
      if (history[i] < history[i - 1] - EPSILON) return false;
    }
    return true;
  }
  function allConsecutiveDecreasing(history, endIdx, length) {
    if (endIdx - length + 1 < 0) return false;
    const EPSILON = 1e-9;
    for (let i = endIdx; i > endIdx - length + 1; i--) {
      if (history[i] > history[i - 1] + EPSILON) return false;
    }
    return true;
  }
  function slopeCrossedZero(slopeHistory, endIdx, window, direction) {
    const startIdx = Math.max(0, endIdx - window);
    const latestSlope = slopeHistory[endIdx];
    if (direction === "positive") {
      if (latestSlope <= 0) return false;
      for (let i = startIdx; i < endIdx; i++) {
        if (slopeHistory[i] < 0) return true;
      }
      return false;
    } else {
      if (latestSlope >= 0) return false;
      for (let i = startIdx; i < endIdx; i++) {
        if (slopeHistory[i] > 0) return true;
      }
      return false;
    }
  }
  function round(value, decimals) {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }
  function analyzeSlopeMomentum(input) {
    const cfg = { ...DEFAULT_SLOPE_MOMENTUM_CONFIG, ...input.config ?? {} };
    const { klines, symbol, timeframe = "1d" } = input;
    if (!Array.isArray(klines) || klines.length < cfg.longPeriod) {
      throw new Error(
        `[SlopeMomentum] Insufficient data: need \u2265 ${cfg.longPeriod} bars, got ${klines?.length ?? 0}`
      );
    }
    const recent = klines.slice(-Math.max(klines.length, cfg.longPeriod * 5));
    const workingData = klines.slice(-Math.max(cfg.dataWindowDays, cfg.longPeriod * 5));
    const lastIdx = workingData.length - 1;
    const ma5History = [];
    const ma10History = [];
    const ma20History = [];
    for (let i = 0; i < workingData.length; i++) {
      ma5History.push(avgClose(workingData, i, cfg.shortPeriod));
      ma10History.push(avgClose(workingData, i, cfg.midPeriod));
      ma20History.push(avgClose(workingData, i, cfg.longPeriod));
    }
    const slopeMA5 = [];
    const slopeMA10 = [];
    const slopeMA20 = [];
    const slopeMA5Daily = [];
    for (let i = 0; i < workingData.length; i++) {
      slopeMA5.push(slope(ma5History, i, cfg.shortPeriod));
      slopeMA10.push(slope(ma10History, i, cfg.midPeriod));
      slopeMA20.push(slope(ma20History, i, cfg.longPeriod));
      slopeMA5Daily.push(slope(ma5History, i, 1));
    }
    const latestSlopeMA5 = slopeMA5[lastIdx];
    const latestSlopeMA10 = slopeMA10[lastIdx];
    const latestSlopeMA20 = slopeMA20[lastIdx];
    const matchedRules = [];
    if (latestSlopeMA5 > cfg.shortSlopeThreshold && allConsecutiveIncreasing(slopeMA5Daily, lastIdx, cfg.consecutiveDays)) {
      matchedRules.push({ id: "M1", label: "MA5 \u77ED\u671F\u52A0\u901F\u4E0A\u5347", strength: "strong" });
    }
    if (latestSlopeMA5 < -cfg.shortSlopeThreshold && allConsecutiveDecreasing(slopeMA5Daily, lastIdx, cfg.consecutiveDays)) {
      matchedRules.push({ id: "M2", label: "MA5 \u77ED\u671F\u52A0\u901F\u4E0B\u8DCC", strength: "strong" });
    }
    if (latestSlopeMA10 > cfg.midSlopeThreshold) {
      matchedRules.push({ id: "M3", label: "MA10 \u4E2D\u671F\u659C\u7387\u4E0A\u5347", strength: "medium" });
    }
    if (latestSlopeMA10 < -cfg.midSlopeThreshold) {
      matchedRules.push({ id: "M4", label: "MA10 \u4E2D\u671F\u659C\u7387\u4E0B\u8DCC", strength: "medium" });
    }
    if (latestSlopeMA20 > cfg.longSlopeThreshold) {
      matchedRules.push({ id: "M5", label: "MA20 \u9577\u671F\u659C\u7387\u4E0A\u5347", strength: "medium" });
    }
    if (latestSlopeMA20 < -cfg.longSlopeThreshold) {
      matchedRules.push({ id: "M6", label: "MA20 \u9577\u671F\u659C\u7387\u4E0B\u8DCC", strength: "medium" });
    }
    if (slopeCrossedZero(slopeMA5, lastIdx, cfg.reversalWindow, "positive")) {
      matchedRules.push({ id: "M7", label: "\u77ED\u671F\u659C\u7387\u8F49\u6B63 (\u8DA8\u52E2\u8F49\u5F37)", strength: "strong" });
    }
    if (slopeCrossedZero(slopeMA5, lastIdx, cfg.reversalWindow, "negative")) {
      matchedRules.push({ id: "M8", label: "\u77ED\u671F\u659C\u7387\u8F49\u8CA0 (\u8DA8\u52E2\u8F49\u5F31)", strength: "strong" });
    }
    if (Math.abs(latestSlopeMA5) < cfg.weakMomentumThreshold) {
      matchedRules.push({ id: "M9", label: "\u52D5\u80FD\u6E1B\u5F31", strength: "weak" });
    }
    if (Math.abs(latestSlopeMA5) > cfg.shortSlopeThreshold) {
      matchedRules.push({ id: "M10", label: "\u52D5\u80FD\u52A0\u5F37", strength: "weak" });
    }
    const state = deriveState(matchedRules);
    const confidence = deriveConfidence(matchedRules);
    const interpretation = matchedRules.length > 0 ? matchedRules.map((r) => r.label).join("\uFF1B") : "\u7121 match";
    const evidence = matchedRules.map((r) => ({
      type: `rule-${r.id}`,
      label: r.label,
      value: r.id,
      passed: true
    }));
    return {
      moduleId: "slope-momentum",
      timeframe,
      state,
      confidence,
      interpretation,
      evidence,
      warnings: [],
      meta: {
        matchedRules: matchedRules.map((r) => r.id),
        ruleLabels: matchedRules.map((r) => r.label),
        latestSlopeMA5: round(latestSlopeMA5, 6),
        latestSlopeMA10: round(latestSlopeMA10, 6),
        latestSlopeMA60: round(latestSlopeMA20, 6),
        // backward compat name (called MA60 in v1.0)
        latestMA5: round(ma5History[lastIdx], 4),
        latestMA10: round(ma10History[lastIdx], 4),
        latestMA60: round(ma20History[lastIdx], 4),
        dataDays: workingData.length,
        configUsed: {
          shortPeriod: cfg.shortPeriod,
          midPeriod: cfg.midPeriod,
          longPeriod: cfg.longPeriod,
          shortSlopeThreshold: cfg.shortSlopeThreshold,
          midSlopeThreshold: cfg.midSlopeThreshold,
          longSlopeThreshold: cfg.longSlopeThreshold,
          reversalWindow: cfg.reversalWindow,
          consecutiveDays: cfg.consecutiveDays
        }
      },
      timestamp: Date.now()
    };
  }
  function deriveState(rules) {
    const ids = new Set(rules.map((r) => r.id));
    if (ids.has("M7") || ids.has("M8")) return "TRANSITION";
    const hasM1 = ids.has("M1");
    const hasM2 = ids.has("M2");
    if (hasM1 && !hasM2) return "UP";
    if (hasM2 && !hasM1) return "DOWN";
    if (hasM1 && hasM2) {
      return "UP";
    }
    const hasM3OrM5 = ids.has("M3") || ids.has("M5");
    const hasM4OrM6 = ids.has("M4") || ids.has("M6");
    if (hasM3OrM5 && !hasM4OrM6) return "UP";
    if (hasM4OrM6 && !hasM3OrM5) return "DOWN";
    if (hasM3OrM5 && hasM4OrM6) {
      return ids.has("M3") || ids.has("M5") ? "UP" : "DOWN";
    }
    if (ids.has("M10")) return "UP";
    if (ids.has("M9")) return "SIDEWAYS";
    return "SIDEWAYS";
  }
  function deriveConfidence(rules) {
    let base = 0.5;
    if (rules.some((r) => r.strength === "strong")) base = 0.7;
    else if (rules.some((r) => r.strength === "medium")) base = 0.5;
    let conf = base;
    for (const r of rules) {
      if (r.strength === "weak") conf += 0.1;
    }
    return Math.min(1, Math.round(conf * 1e4) / 1e4);
  }
  return __toCommonJS(slope_momentum_exports);
})();

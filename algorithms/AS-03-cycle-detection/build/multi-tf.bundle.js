"use strict";
var MultiTF = (() => {
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

  // algorithms/AS-03-cycle-detection/modules/multi-tf.ts
  var multi_tf_exports = {};
  __export(multi_tf_exports, {
    DEFAULT_MULTI_TF_CONFIG: () => DEFAULT_MULTI_TF_CONFIG,
    synthesizeMultiTF: () => synthesizeMultiTF
  });
  var DEFAULT_MULTI_TF_CONFIG = {
    // 大少 21:33 confirm Decision 2: 分層 weights
    tfWeights: { "1D": 0.25, "1W": 0.35, "1M": 0.4 },
    // Consensus threshold
    consensusThreshold: 0.65,
    // Conflict penalty
    conflictConfidenceMultiplier: 0.5,
    // 3 TF 唔同 → confidence * 0.5
    partialConsensusMultiplier: 0.85,
    // 1 TF 唔同 → confidence * 0.85
    // Min data validation
    minDataDays: { "1D": 90, "1W": 26, "1M": 12 },
    // 大少 21:33 confirm Decision 3: 動態 MA pullback
    pullbackMAFast: 10,
    pullbackMASlow: 20
  };
  function avgClose(klines, endIdx, period) {
    const startIdx = Math.max(0, endIdx - period + 1);
    const slice = klines.slice(startIdx, endIdx + 1);
    const sum = slice.reduce((acc, k) => acc + k.close, 0);
    return sum / slice.length;
  }
  function computeMAHistory(klines, period) {
    const out = [];
    for (let i = 0; i < klines.length; i++) {
      out.push(avgClose(klines, i, period));
    }
    return out;
  }
  function detectMatchedRules(klines, ma5, ma10, ma60) {
    const matched = [];
    const win = 5;
    if (klines.length < win) return matched;
    const lastN = klines.slice(-win);
    const last5MA5 = ma5.slice(-win);
    const last5MA10 = ma10.slice(-win);
    const last5MA60 = ma60.slice(-win);
    if (last5MA5.every((m, i) => m > last5MA60[i])) {
      matched.push({ id: "A", label: "\u4E0A\u5347\u52E2", strength: "strong" });
    }
    if (last5MA5.every((m, i) => m < last5MA60[i])) {
      matched.push({ id: "B", label: "\u4E0B\u8DCC\u52E2", strength: "strong" });
    }
    let cDay = -1;
    for (let i = 0; i < win; i++) {
      if (last5MA5[i] > last5MA60[i] && lastN[i].low < last5MA60[i]) cDay = i;
    }
    if (cDay >= 0) matched.push({ id: "C", label: "\u6A6B\u884C\u5411\u4E0B", strength: "medium" });
    let dDay = -1;
    for (let i = 0; i < win; i++) {
      if (last5MA5[i] < last5MA60[i] && lastN[i].high > last5MA60[i]) dDay = i;
    }
    if (dDay >= 0) matched.push({ id: "D", label: "\u6A6B\u884C\u5411\u4E0A", strength: "medium" });
    let fDay = -1;
    for (let i = 0; i < win; i++) {
      if (last5MA5[i] > last5MA60[i] && last5MA10[i] > last5MA60[i] && last5MA5[i] < last5MA10[i]) fDay = i;
    }
    if (fDay >= 0) matched.push({ id: "F", label: "\u5347\u52E2\u8ABF\u6574", strength: "medium" });
    let gDay = -1;
    for (let i = 0; i < win; i++) {
      if (last5MA5[i] < last5MA60[i] && last5MA10[i] < last5MA60[i] && last5MA5[i] > last5MA10[i]) gDay = i;
    }
    if (gDay >= 0) matched.push({ id: "G", label: "\u8DCC\u52E2\u8ABF\u6574", strength: "medium" });
    const revWin = 7;
    if (klines.length >= revWin) {
      const lastNMA5 = ma5.slice(-revWin);
      const lastNMA60 = ma60.slice(-revWin);
      const upDays = (n) => {
        for (let i = revWin - n; i < revWin; i++) {
          if (!(lastNMA5[i] > lastNMA60[i])) return false;
        }
        for (let i = 0; i < revWin - n; i++) {
          if (!(lastNMA5[i] < lastNMA60[i])) return false;
        }
        return true;
      };
      if (upDays(1) || upDays(2) || upDays(3)) {
        matched.push({ id: "H-reverse-up", label: "\u8DCC\u52E2\u8F49\u5347\u52E2", strength: "strong" });
      }
      const downDays = (n) => {
        for (let i = revWin - n; i < revWin; i++) {
          if (!(lastNMA5[i] < lastNMA60[i])) return false;
        }
        for (let i = 0; i < revWin - n; i++) {
          if (!(lastNMA5[i] > lastNMA60[i])) return false;
        }
        return true;
      };
      if (downDays(1) || downDays(2) || downDays(3)) {
        matched.push({ id: "H-reverse-down", label: "\u5347\u52E2\u8F49\u8DCC\u52E2", strength: "strong" });
      }
    }
    let iChance = true;
    for (let i = 0; i < win; i++) {
      const dayMA5 = last5MA5[i];
      if (lastN[i].low < dayMA5 * 0.98) {
        iChance = false;
        break;
      }
    }
    if (iChance) matched.push({ id: "I", label: "\u6709\u6A5F\u6703\u9577\u5347", strength: "weak" });
    let jChance = true;
    for (let i = 0; i < win; i++) {
      const dayMA5 = last5MA5[i];
      if (lastN[i].high > dayMA5 * 1.02) {
        jChance = false;
        break;
      }
    }
    if (jChance) matched.push({ id: "J", label: "\u6709\u6A5F\u6703\u9577\u8DCC", strength: "weak" });
    return matched;
  }
  function deriveState(rules) {
    const ids = new Set(rules.map((r) => r.id));
    if (ids.has("H-reverse-up") || ids.has("H-reverse-down")) return "SIDEWAYS";
    if (ids.has("A")) return "UP";
    if (ids.has("B")) return "DOWN";
    if (ids.has("F")) return "UP";
    if (ids.has("G")) return "DOWN";
    if (ids.has("C") || ids.has("D")) return "SIDEWAYS";
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
  function runMAAlignmentForTF(klines) {
    if (klines.length < 90) {
      throw new Error(
        `[MultiTF] Insufficient data: need \u2265 90 bars, got ${klines.length}`
      );
    }
    const recent = klines.slice(-Math.min(klines.length, 200));
    const ma5History = computeMAHistory(recent, 5);
    const ma10History = computeMAHistory(recent, 10);
    const ma60History = computeMAHistory(recent, 60);
    const matched = detectMatchedRules(recent, ma5History, ma10History, ma60History);
    const state = deriveState(matched);
    const confidence = deriveConfidence(matched);
    return {
      state,
      confidence,
      matched_rules: matched.map((r) => r.id),
      rule_labels: matched.map((r) => r.label),
      data_days: recent.length,
      ma5: round(ma5History[ma5History.length - 1], 4),
      ma10: round(ma10History[ma10History.length - 1], 4),
      ma20: round(avgClose(recent, recent.length - 1, 20), 4),
      ma60: round(ma60History[ma60History.length - 1], 4),
      current_price: recent[recent.length - 1].close
    };
  }
  function round(value, decimals) {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }
  function synthesizeMultiTF(input) {
    const cfg = { ...DEFAULT_MULTI_TF_CONFIG, ...input.config ?? {} };
    const { symbol, klines1D, klines1W, klines1M } = input;
    const verdict1D = runMAAlignmentForTF(klines1D);
    const verdict1W = runMAAlignmentForTF(klines1W);
    const verdict1M = runMAAlignmentForTF(klines1M);
    const baseConfidence = verdict1D.confidence * cfg.tfWeights["1D"] + verdict1W.confidence * cfg.tfWeights["1W"] + verdict1M.confidence * cfg.tfWeights["1M"];
    const states = [verdict1D.state, verdict1W.state, verdict1M.state];
    const upCount = states.filter((s) => s === "UP").length;
    const downCount = states.filter((s) => s === "DOWN").length;
    const sidewaysCount = states.filter((s) => s === "SIDEWAYS").length;
    let state;
    let conflict;
    let warning = null;
    let consensusMultiplier;
    let consensus;
    if (upCount === 3) {
      state = "UP";
      conflict = false;
      consensusMultiplier = 1;
      consensus = { score: 1, direction: "aligned", description: "3 \u500B TF \u4E00\u81F4 UP, \u9806\u5927\u65B9\u5411" };
    } else if (downCount === 3) {
      state = "DOWN";
      conflict = false;
      consensusMultiplier = 1;
      consensus = { score: 1, direction: "aligned", description: "3 \u500B TF \u4E00\u81F4 DOWN, \u9806\u5927\u65B9\u5411" };
    } else if (sidewaysCount === 3) {
      state = "SIDEWAYS";
      conflict = false;
      consensusMultiplier = 1;
      consensus = { score: 1, direction: "aligned", description: "3 \u500B TF \u4E00\u81F4 SIDEWAYS, \u5927\u65B9\u5411\u6A6B\u884C" };
    } else if (upCount === 2) {
      state = "UP";
      conflict = downCount === 1;
      consensusMultiplier = conflict ? cfg.partialConsensusMultiplier : 1;
      if (conflict) {
        const otherTF = states.indexOf("DOWN") === 0 ? "1D" : states.indexOf("DOWN") === 1 ? "1W" : "1M";
        warning = `\u26A0\uFE0F ${otherTF} \u9006\u5176\u4ED6 TF (UP), \u4FE1\u5FC3\u964D\u4F4E ${((1 - cfg.partialConsensusMultiplier) * 100).toFixed(0)}%`;
        consensus = { score: 0.65, direction: "partial", description: `2 \u500B TF UP, 1 \u500B TF DOWN (${otherTF} \u9006)` };
      } else {
        consensus = { score: 0.85, direction: "partial", description: "2 \u500B TF UP, 1 \u500B TF SIDEWAYS" };
      }
    } else if (downCount === 2) {
      state = "DOWN";
      conflict = upCount === 1;
      consensusMultiplier = conflict ? cfg.partialConsensusMultiplier : 1;
      if (conflict) {
        const otherTF = states.indexOf("UP") === 0 ? "1D" : states.indexOf("UP") === 1 ? "1W" : "1M";
        warning = `\u26A0\uFE0F ${otherTF} \u9006\u5176\u4ED6 TF (DOWN), \u4FE1\u5FC3\u964D\u4F4E ${((1 - cfg.partialConsensusMultiplier) * 100).toFixed(0)}%`;
        consensus = { score: 0.65, direction: "partial", description: `2 \u500B TF DOWN, 1 \u500B TF UP (${otherTF} \u9006)` };
      } else {
        consensus = { score: 0.85, direction: "partial", description: "2 \u500B TF DOWN, 1 \u500B TF SIDEWAYS" };
      }
    } else {
      state = "CONFLICT";
      conflict = true;
      consensusMultiplier = cfg.conflictConfidenceMultiplier;
      warning = `\u26A0\uFE0F 3 \u500B TF \u5514\u540C\u65B9\u5411 (1D=${verdict1D.state} / 1W=${verdict1W.state} / 1M=${verdict1M.state}), \u6488\u5E95\u98A8\u96AA, \u5514\u597D\u5165\u5834`;
      consensus = { score: 0.3, direction: "divergent", description: "3 \u500B TF \u5B8C\u5168\u5206\u6B67" };
    }
    const finalConfidence = +(baseConfidence * consensusMultiplier).toFixed(4);
    const transitions = {
      turn_around: verdict1M.state === "UP" && verdict1D.state === "UP" && verdict1M.confidence >= 0.65,
      adjustment_complete: false
      // 簡化版, 將來可加 re-test success logic
    };
    return {
      symbol,
      timeframe: "1D",
      state,
      confidence: finalConfidence,
      conflict,
      warning,
      timeframe_verdicts: {
        "1D": verdict1D,
        "1W": verdict1W,
        "1M": verdict1M
      },
      consensus,
      transitions,
      meta: {
        data_days_1d: verdict1D.data_days,
        data_days_1w: verdict1W.data_days,
        data_days_1m: verdict1M.data_days,
        tf_weights: cfg.tfWeights,
        sub_module: "ma-alignment"
      }
    };
  }
  return __toCommonJS(multi_tf_exports);
})();

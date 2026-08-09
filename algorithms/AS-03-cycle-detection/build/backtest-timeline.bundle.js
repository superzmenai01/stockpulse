"use strict";
var BacktestTimeline = (() => {
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

  // modules/backtest-timeline.ts
  var backtest_timeline_exports = {};
  __export(backtest_timeline_exports, {
    GOLDEN_ENTRY_FWD5_THRESHOLD: () => GOLDEN_ENTRY_FWD5_THRESHOLD,
    GOLDEN_ENTRY_MARK_THRESHOLD: () => GOLDEN_ENTRY_MARK_THRESHOLD,
    TIMELINE_COLORS: () => TIMELINE_COLORS,
    analyzeBacktestTimeline: () => analyzeBacktestTimeline,
    fetchForwardReturnHistory: () => fetchForwardReturnHistory,
    fetchTradeJournal: () => fetchTradeJournal,
    generateTimelineInterpretation: () => generateTimelineInterpretation
  });
  var GOLDEN_ENTRY_FWD5_THRESHOLD = 3;
  var GOLDEN_ENTRY_MARK_THRESHOLD = 4;
  var TIMELINE_COLORS = {
    GOLDEN: "#26BA75",
    // 🟢 綠 deep (Golden entry)
    HIT_GENERAL: "#52C41A",
    // 🟢 綠 light (一般啱)
    WAIT: "#F39C12",
    // 🟡 黃 (HOLD / WAIT)
    MISS_GENERAL: "#FA8C16",
    // 🟠 橙 light (一般錯)
    MISS_SEVERE: "#EE5151",
    // 🟠 橙 deep (嚴重錯)
    SELL_DANGER: "#CF1322",
    // 🔴 紅 (SELL/REDUCE/TRAP/TRANSITION)
    NO_JOURNAL: "#999999"
    // ⚪ 灰 (大少冇 mark)
  };
  function alignDates(forwardReturns, journalEntries) {
    return forwardReturns.map((fr) => {
      const journalMatch = journalEntries.find((j) => j.entry_date === fr.date) || null;
      return {
        date: fr.date,
        action: fr.action,
        fwd5: fr.fwd5,
        fwd10: fr.fwd10,
        fwd20: fr.fwd20,
        hit: fr.hit,
        journalEntry: journalMatch,
        markCorrect: journalMatch?.mark_correct ?? null,
        markWrong: journalMatch?.mark_wrong ?? null,
        markScale: journalMatch?.mark_scale ?? null,
        predictionVsActual: computeMatch(fr, journalMatch),
        color: "",
        // Step 4 set
        isGoldenEntry: false
        // Step 4 set
      };
    });
  }
  function computeMatch(fr, j) {
    if (!j) return "NO_JOURNAL";
    if (fr.hit === true && j.mark_correct !== null) return "MATCH";
    if (fr.hit === false && j.mark_wrong !== null) return "MATCH";
    if (fr.hit === true && j.mark_wrong !== null) return "MISS";
    if (fr.hit === false && j.mark_correct !== null) return "PARTIAL";
    return "NO_JOURNAL";
  }
  function getActionColor(action, hit, markCorrect, markWrong) {
    const isBuy = action === "BUY" || action === "ADD";
    const isHoldOrWait = action === "HOLD" || action === "WAIT";
    const isDanger = action === "SELL" || action === "REDUCE" || action === "TRAP" || action === "TRANSITION";
    if (isBuy && hit === true) {
      if (markCorrect !== null && markCorrect >= GOLDEN_ENTRY_MARK_THRESHOLD) {
        return TIMELINE_COLORS.GOLDEN;
      }
      return TIMELINE_COLORS.HIT_GENERAL;
    }
    if (isBuy && hit === false) {
      if (markWrong !== null && markWrong >= GOLDEN_ENTRY_MARK_THRESHOLD) {
        return TIMELINE_COLORS.MISS_SEVERE;
      }
      return TIMELINE_COLORS.MISS_GENERAL;
    }
    if (isHoldOrWait) {
      return TIMELINE_COLORS.WAIT;
    }
    if (isDanger) {
      return TIMELINE_COLORS.SELL_DANGER;
    }
    return TIMELINE_COLORS.NO_JOURNAL;
  }
  function isGoldenEntry(dp) {
    return dp.fwd5 !== null && dp.fwd5 >= GOLDEN_ENTRY_FWD5_THRESHOLD && dp.hit === true && dp.markCorrect !== null && dp.markCorrect >= GOLDEN_ENTRY_MARK_THRESHOLD;
  }
  function computeView(dataPoints) {
    return dataPoints.map((dp) => ({
      ...dp,
      color: getActionColor(dp.action, dp.hit, dp.markCorrect, dp.markWrong),
      isGoldenEntry: isGoldenEntry(dp)
    }));
  }
  function avg(arr) {
    if (arr.length === 0) return null;
    return arr.reduce((sum, v) => sum + v, 0) / arr.length;
  }
  function countBy(arr, keyFn) {
    return arr.reduce((acc, item) => {
      const k = keyFn(item);
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
  }
  function computeStats(dataPoints) {
    const validFwd5 = dataPoints.filter((d) => d.fwd5 !== null);
    const hits = validFwd5.filter((d) => d.hit === true);
    const validFwd10 = dataPoints.filter((d) => d.fwd10 !== null);
    const validFwd20 = dataPoints.filter((d) => d.fwd20 !== null);
    const journalEntries = dataPoints.filter((d) => d.journalEntry !== null);
    const goldenEntries = dataPoints.filter((d) => d.isGoldenEntry);
    return {
      totalVerdicts: dataPoints.length,
      totalJournalEntries: journalEntries.length,
      hitRate5d: hits.length / (validFwd5.length || 1) || (validFwd5.length === 0 ? null : 0),
      avgFwd5: avg(validFwd5.map((d) => d.fwd5)),
      avgFwd10: avg(validFwd10.map((d) => d.fwd10)),
      avgFwd20: avg(validFwd20.map((d) => d.fwd20)),
      actionBreakdown: countBy(dataPoints, (d) => d.action),
      matchBreakdown: countBy(dataPoints, (d) => d.predictionVsActual),
      goldenEntries: goldenEntries.length
    };
  }
  function analyzeBacktestTimeline(input) {
    const { symbol, dateRange = 90 } = input;
    const forwardReturnHistory = input.forwardReturnHistory ?? [];
    const tradeJournalEntries = input.tradeJournalEntries ?? [];
    const sortedFR = [...forwardReturnHistory].sort((a, b) => a.date.localeCompare(b.date));
    const cutoffDate = /* @__PURE__ */ new Date();
    cutoffDate.setDate(cutoffDate.getDate() - dateRange);
    const cutoffStr = cutoffDate.toISOString().slice(0, 10);
    const filteredFR = sortedFR.filter((r) => r.date >= cutoffStr);
    const sortedJ = [...tradeJournalEntries].sort((a, b) => a.entry_date.localeCompare(b.entry_date));
    const filteredJ = sortedJ.filter((j) => j.entry_date >= cutoffStr);
    const aligned = alignDates(filteredFR, filteredJ);
    const viewed = computeView(aligned);
    const stats = computeStats(viewed);
    const startDate = viewed.length > 0 ? viewed[0].date : cutoffStr;
    const endDate = viewed.length > 0 ? viewed[viewed.length - 1].date : (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    return {
      symbol,
      dateRange: { start: startDate, end: endDate, days: dateRange },
      totalPoints: viewed.length,
      dataPoints: viewed,
      stats,
      meta: {
        forwardReturnCount: filteredFR.length,
        journalCount: filteredJ.length,
        dateRangeUsed: dateRange,
        dataLimited: filteredFR.length < sortedFR.length
        // 有 data 被 filter 走
      }
    };
  }
  async function generateTimelineInterpretation(ctx) {
    const { symbol, stats, bestGolden, worstMiss } = ctx;
    let interp = `\u300C${symbol} \u904E\u53BB ${stats.totalVerdicts} \u500B verdict, \u5176\u4E2D ${stats.hitRate5d !== null ? (stats.hitRate5d * 100).toFixed(0) : "N/A"}% 5 \u65E5\u5167\u6709\u5347\u3002`;
    if (stats.totalJournalEntries > 0) {
      interp += `\u5927\u5C11\u843D\u5BE6\u5497 ${stats.totalJournalEntries} \u500B trade, `;
      const matchRate = stats.matchBreakdown.MATCH / stats.totalJournalEntries * 100;
      interp += `match rate ${matchRate.toFixed(0)}% (\u9810\u6E2C\u540C\u5BE6\u6230\u4E00\u81F4)\u3002`;
    } else {
      interp += `\u5927\u5C11\u4EF2\u672A mark \u4EFB\u4F55 trade, \u5EFA\u8B70\u53BB Trade Journal \u52A0\u5E7E\u689D\u53C3\u8003\u3002`;
    }
    if (stats.goldenEntries > 0) {
      interp += `\u63C0\u5230 ${stats.goldenEntries} \u500B\u9EC3\u91D1\u8CB7\u9EDE, `;
      if (bestGolden) {
        interp += `\u6700\u52C1\u4FC2 ${bestGolden.date}: ${bestGolden.action} \u2192 5 \u65E5\u5F8C\u5347 ${bestGolden.fwd5.toFixed(1)}%`;
        if (bestGolden.markCorrect) {
          interp += `, \u5927\u5C11 mark ${bestGolden.markCorrect}/5`;
        }
      }
      interp += `\u3002`;
    }
    if (worstMiss && worstMiss.fwd5 !== null) {
      interp += `\u6700\u5DEE\u4FC2 ${worstMiss.date}: ${worstMiss.action} \u2192 5 \u65E5\u5F8C ${worstMiss.fwd5 > 0 ? "\u5347" : "\u8DCC"} ${Math.abs(worstMiss.fwd5).toFixed(1)}%`;
      if (worstMiss.markWrong) {
        interp += `, \u5927\u5C11 mark \u932F ${worstMiss.markWrong}/5`;
      }
      interp += `\u3002`;
    }
    interp += `\u5462\u500B timeline \u986F\u793A algorithm \u5C0D\u5462\u96BB\u80A1\u7968\u5605\u5224\u65B7\u6709\u53C3\u8003\u50F9\u503C, \u5EFA\u8B70\u6301\u7E8C\u7D2F\u7A4D Trade Journal \u6A23\u672C\u3002`;
    return interp;
  }
  async function fetchForwardReturnHistory(symbol, limit = 200) {
    try {
      const resp = await fetch(`http://localhost:18792/api/adaptive-params/${encodeURIComponent(symbol)}/forward-return?limit=${limit}`);
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.history || [];
    } catch (e) {
      console.warn(`[backtest-timeline] fetch forward return history failed:`, e);
      return [];
    }
  }
  async function fetchTradeJournal(symbol, limit = 200) {
    try {
      const resp = await fetch(`http://localhost:18792/api/trade-journal?symbol=${encodeURIComponent(symbol)}&limit=${limit}`);
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.entries || [];
    } catch (e) {
      console.warn(`[backtest-timeline] fetch trade journal failed:`, e);
      return [];
    }
  }
  return __toCommonJS(backtest_timeline_exports);
})();

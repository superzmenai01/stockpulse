// algorithms/AS-03-cycle-detection/modules/cycle-synthesizer.ts
function computeMA(closes, period) {
  const ma = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      ma.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += closes[j];
    }
    ma.push(sum / period);
  }
  return ma;
}
function synthesizeCycle(input) {
  const { m1Verdict, zmenVerdict, klineCloses } = input;
  const weights = input.weights ?? { m1: 0.6, zmen: 0.4 };
  const baseConfidence = m1Verdict.confidence * weights.m1 + zmenVerdict.confidence * weights.zmen;
  const m1State = m1Verdict.state;
  const zmenState = zmenVerdict.state;
  let state;
  let confidence;
  let conflict = false;
  let warning = null;
  let consensus;
  if (m1State === zmenState) {
    state = m1State;
    confidence = baseConfidence;
    consensus = "aligned";
    if (state === "SIDEWAYS") {
      consensus = "sideways";
    }
  } else {
    conflict = true;
    state = "CONFLICT";
    confidence = baseConfidence * 0.5;
    consensus = "conflict";
    warning = `\u26A0\uFE0F \u5169\u500B module \u8A0A\u865F\u5206\u6B67 (M1=${m1State} / zmen=${zmenState}), \u5C0F\u5FC3\u5165\u5834, confidence \u6298\u534A`;
  }
  const triggers = computeTriggers(klineCloses);
  const transitions = computeTransitions(m1State, zmenState, triggers, m1Verdict, zmenVerdict);
  const maArr = computeMA(klineCloses, 5);
  const ma20Arr = computeMA(klineCloses, 20);
  const meta = {
    currentPrice: klineCloses[0] ?? null,
    ma5: isNaN(maArr[0]) ? null : maArr[0],
    ma20: isNaN(ma20Arr[0]) ? null : ma20Arr[0],
    consensus
  };
  return {
    state,
    confidence,
    conflict,
    warning,
    m1State,
    zmenState,
    weights,
    transitions,
    triggers,
    meta
  };
}
function computeTriggers(closes) {
  if (closes.length < 20) {
    return {
      ma5StopTriggered: false,
      ma5BreakDay1: false,
      ma5BreakDay2: false,
      ma20Break: false,
      ma5RetestSuccess: false
    };
  }
  const ma5Arr = computeMA(closes, 5);
  const ma20Arr = computeMA(closes, 20);
  const todayClose = closes[0];
  const yesterdayClose = closes[1] ?? todayClose;
  const ma5Today = ma5Arr[0];
  const ma5Yesterday = ma5Arr[1] ?? ma5Today;
  const ma20Today = ma20Arr[0];
  const ma5StopTriggered = !isNaN(ma5Today) && todayClose < ma5Today * 0.98;
  const ma5BreakDay1 = !isNaN(ma5Today) && todayClose < ma5Today && todayClose >= ma5Today * 0.98;
  const ma5BreakDay2 = !isNaN(ma5Today) && !isNaN(ma5Yesterday) && todayClose < ma5Today && yesterdayClose < ma5Yesterday;
  const ma20Break = !isNaN(ma20Today) && todayClose < ma20Today;
  let ma5RetestSuccess = false;
  for (let i = 1; i <= Math.min(5, closes.length - 1); i++) {
    if (!isNaN(ma5Arr[i]) && closes[i] < ma5Arr[i]) {
      ma5RetestSuccess = !isNaN(ma5Today) && todayClose >= ma5Today;
      break;
    }
  }
  return {
    ma5StopTriggered,
    ma5BreakDay1,
    ma5BreakDay2,
    ma20Break,
    ma5RetestSuccess
  };
}
function computeTransitions(m1State, zmenState, triggers, m1Verdict, zmenVerdict) {
  const bothUp = m1State === "UP" && zmenState === "UP";
  const turnAroundDetected = bothUp && m1Verdict.confidence >= 0.65 && zmenVerdict.confidence >= 0.65;
  const adjustmentComplete = bothUp && triggers.ma5RetestSuccess;
  return {
    turnAroundDetected,
    adjustmentComplete
  };
}

// algorithms/AS-03-cycle-detection/modules/decision-engine.ts
var GRADE_ORDER = ["F", "D", "C", "C+", "B", "B+", "A", "A+"];
var KELLY_NUMERIC_MAP = {
  half: 0.5,
  quarter: 0.25,
  octo: 0.125
};
function gradeIndex(g) {
  return GRADE_ORDER.indexOf(g);
}
function isGradeAtLeast(g, threshold) {
  return gradeIndex(g) >= gradeIndex(threshold);
}
function isGradeAtMost(g, threshold) {
  return gradeIndex(g) <= gradeIndex(threshold);
}
function getMajorityState(verdicts) {
  if (verdicts.length === 0) return "SIDEWAYS";
  const stateCount = {};
  for (const v of verdicts) {
    stateCount[v.state] = (stateCount[v.state] ?? 0) + 1;
  }
  let maxState = "SIDEWAYS";
  let maxCount = 0;
  for (const [s, c] of Object.entries(stateCount)) {
    if (c > maxCount) {
      maxState = s;
      maxCount = c;
    }
  }
  return maxState;
}
function weightedAverage(values) {
  const totalWeight = values.reduce((acc, x) => acc + x.w, 0);
  if (totalWeight === 0) return 0;
  return values.reduce((acc, x) => acc + x.v * x.w, 0) / totalWeight;
}
function getRawRSI(verdicts) {
  const ind = verdicts.find((v) => v.module_id === "indicators");
  if (!ind) return 50;
  return (ind.sentiment_6d.rsi + 1) * 50;
}
function computeTradingCard(currentPrice, kellyFraction, maxDrawdown) {
  let entryWidth;
  let stopPct;
  let tpPct;
  let trailingPct;
  if (kellyFraction === "octo" || maxDrawdown > 0.1) {
    entryWidth = 0.025;
    stopPct = 0.05;
    tpPct = 0.08;
    trailingPct = 0.07;
  } else if (kellyFraction === "half" && maxDrawdown < 0.05) {
    entryWidth = 0.01;
    stopPct = 0.02;
    tpPct = 0.04;
    trailingPct = 0.03;
  } else {
    entryWidth = 0.015;
    stopPct = 0.03;
    tpPct = 0.05;
    trailingPct = 0.05;
  }
  return {
    entry_zone: [currentPrice * (1 - entryWidth), currentPrice * (1 + entryWidth)],
    stop_loss: currentPrice * (1 - stopPct),
    take_profit: currentPrice * (1 + tpPct),
    trailing_stop: currentPrice * (1 - trailingPct)
  };
}
function computeShortTermForecast(expectedReturn, maxDrawdown) {
  const timeframes = [5, 10, 20];
  const forecast = [];
  for (const days of timeframes) {
    const dayFactor = days / 5;
    forecast.push({
      scenario: "optimistic",
      timeframe_days: days,
      expected_return: +(expectedReturn * 1.5 * dayFactor).toFixed(4),
      max_drawdown: +(maxDrawdown * 0.5).toFixed(4),
      probability: 0.25
    });
    forecast.push({
      scenario: "baseline",
      timeframe_days: days,
      expected_return: +(expectedReturn * 1 * dayFactor).toFixed(4),
      max_drawdown: +(maxDrawdown * 0.7).toFixed(4),
      probability: 0.5
    });
    forecast.push({
      scenario: "pessimistic",
      timeframe_days: days,
      expected_return: +(-maxDrawdown * 0.5 * dayFactor).toFixed(4),
      max_drawdown: +(maxDrawdown * 1).toFixed(4),
      probability: 0.25
    });
  }
  return forecast;
}
async function generateInterpretation(ctx) {
  return hardcodedInterpretation(ctx);
}
function hardcodedInterpretation(ctx) {
  const { final_action, module_verdicts, synthesizer_verdict, short_term_forecast } = ctx;
  const upCount = module_verdicts.filter((v) => v.state === "UP").length;
  const downCount = module_verdicts.filter((v) => v.state === "DOWN").length;
  const sidewaysCount = module_verdicts.filter((v) => v.state === "SIDEWAYS").length;
  const transitionCount = module_verdicts.filter((v) => v.state === "TRANSITION").length;
  const { grade, ssi_score, kelly_fraction, alignment_score } = synthesizer_verdict;
  const baseline5 = short_term_forecast.find((f) => f.timeframe_days === 5 && f.scenario === "baseline");
  const baseline5Ret = baseline5 ? (baseline5.expected_return * 100).toFixed(1) : "?";
  switch (final_action) {
    case "BUY":
      return `\u{1F4C8} **\u61C9\u8A72\u8CB7\u5165**\u3002${upCount} \u500B module \u8A8D\u70BA\u4E0A\u5347, SSI \u6230\u7565\u5F37\u5EA6 ${ssi_score.toFixed(0)}/100, alignment ${(alignment_score * 100).toFixed(0)}%, grade ${grade} \u7D1A\u3002

\u{1F4A1} **\u9EDE\u89E3\u8981\u8CB7**: MA \u5747\u7DDA + \u9AD8\u4F4E\u9EDE + \u8DA8\u52E2\u7DDA\u540C\u6B65\u4E0A\u5347 (${upCount}/6 \u500B module \u4E00\u81F4), grade \u904E\u5230 B \u7D1A, \u77ED\u671F 5 \u65E5\u57FA\u6E96\u9810\u671F\u56DE\u5831 +${baseline5Ret}%
\u{1F6D1} **\u98A8\u63A7**: \u6B62\u8755\u4F4D\u55BA\u5165\u5834\u5340\u4E0B\u9650 -3% (\u8DCC\u7834\u5373 cut loss), \u76EE\u6A19 +5% 1.67:1 \u98A8\u96AA\u56DE\u5831\u6BD4
\u{1F4B0} **\u5009\u4F4D**: ${kelly_fraction} \u5009 (\u8DDF\u6CE2\u52D5\u81EA\u52D5\u5207, \u9AD8\u6CE2\u52D5\u7E2E\u7D30, \u4F4E\u6CE2\u52D5\u653E\u5927)`;
    case "ADD":
      return `\u{1F7E2} **\u6CB9\u9580\u518D\u8E29\u6DF1\u5572**! \u5F37\u52E2\u4E0A\u5347\u78BA\u8A8D (grade ${grade} \u2265 A, alignment ${(alignment_score * 100).toFixed(0)}% \u2265 70%, RSI > 70, \u9023\u6F32 \u2265 3 \u65E5)\u3002

\u{1F4A1} **\u9EDE\u89E3\u52A0\u5009**: \u77ED\u671F\u52D5\u529B\u5F37, ${upCount} \u500B module \u540C\u6B65\u4E0A\u5347, \u77ED\u671F 5 \u65E5\u57FA\u6E96\u9810\u671F +${baseline5Ret}%, \u53EF\u4EE5\u98DF\u591A\u5572\u8DA8\u52E2
\u26A0\uFE0F **\u6CE8\u610F**: RSI > 70 \u4EE3\u8868\u8D85\u8CB7\u5340, \u52A0\u5009\u5F8C\u8981\u5BC6\u5207 monitor RSI \u8D70\u52E2, \u4E00\u65E6 > 75 \u8981 re-evaluate
\u{1F4CC} **\u5009\u4F4D**: ${kelly_fraction} \u5009 (\u4F46\u52A0\u5009\u5F8C\u7E3D\u5009\u4F4D\u53EF\u80FD > 100%, \u6CE8\u610F risk management)`;
    case "HOLD":
      return `\u{1F7E1} **\u4FDD\u6301\u73FE\u901F**\u3002\u8DA8\u52E2\u4EF2 OK \u4F46\u5514\u5F37 (grade ${grade} \u55BA B/C+ \u7D1A, alignment ${(alignment_score * 100).toFixed(0)}% < 60%)\u3002

\u{1F4A1} **\u9EDE\u89E3 hold**: \u4E0A\u5347\u52D5\u529B\u5514\u5920, \u5514\u5920 BUY trigger \u689D\u4EF6 (alignment \u5514\u5920), \u77ED\u671F 5 \u65E5\u57FA\u6E96\u9810\u671F +${baseline5Ret}% \u4EF2\u6709\u5C11\u5C11\u6C34\u4F4D
\u{1F4CC} **Monitor**: \u7559\u610F\u6703\u5514\u6703\u5347\u7A7F alignment 60% + grade B+ \u2192 \u8B8A BUY trigger; \u6216\u8005\u8F49 SIDEWAYS/DOWN \u5C31\u8981\u8A55\u4F30
\u{1F4B0} **\u5009\u4F4D**: \u4FDD\u6301 ${kelly_fraction} \u5009\u5514\u8B8A`;
    case "WAIT":
      return `\u{1F7E1} **\u7B49\u7DA0\u71C8**! \u800C\u5BB6\u5187\u660E\u78BA\u65B9\u5411 (SIDEWAYS, ${sidewaysCount}/6 \u500B module \u6301\u5E73), grade C, alignment ${(alignment_score * 100).toFixed(0)}% < 60%\u3002

\u{1F4A1} **\u9EDE\u89E3 wait**: 6 \u500B module \u5C0D\u5F8C\u5E02\u6709\u5514\u540C\u610F\u898B, \u8A0A\u865F\u5514\u6E05\u6670, \u5F37\u884C\u5165\u5834\u98A8\u96AA\u9AD8
\u{1F4CC} **Monitor**: \u4E00\u65E6 SIDEWAYS \u8B8A UP (alignment > 60% + grade B) \u2192 BUY trigger; \u8B8A DOWN \u2192 SELL trigger
\u{1F4B0} **\u5009\u4F4D**: \u6301\u6709\u73FE\u91D1\u6216\u6975\u4F4E\u5009, \u7B49\u8A0A\u865F\u6E05\u6670\u5148\u52A0\u5009`;
    case "REDUCE":
      return `\u{1F7E0} **\u6536\u8FD4\u5C11\u5C11\u6CB9**! \u8F49\u52E2\u4E2D (TRANSITION, ${transitionCount}/6 \u500B module \u8A8D\u70BA\u8F49\u52E2), alignment ${(alignment_score * 100).toFixed(0)}% < 50%, \u8A0A\u865F\u77DB\u76FE\u3002

\u{1F4A1} **\u9EDE\u89E3 reduce**: 6 \u500B module \u6709\u5572\u7747 UP \u6709\u5572\u7747 DOWN \u6709\u5572\u7747 SIDEWAYS, \u6536\u7DCA\u5572\u5009\u4F4D\u7B49\u78BA\u8A8D
\u{1F4CC} **Monitor**: \u5982\u679C TRANSITION \u8B8A UP (alignment > 60%) \u2192 \u52A0\u8FD4\u5009; \u8B8A DOWN \u2192 \u6025\u715E\u8ECA; \u8B8A SIDEWAYS \u2192 \u7E7C\u7E8C WAIT
\u{1F4B0} **\u5009\u4F4D**: \u6E1B\u5230 half \u5009, \u907F\u514D\u88AB\u53CD\u8F49\u5E02\u98DF\u6652`;
    case "SELL":
      return `\u{1F534} **\u6025\u715E\u8ECA**! \u4E0B\u8DCC\u78BA\u8A8D (${downCount}/6 \u500B module \u8A8D\u70BA DOWN, grade ${grade} \u2264 C, \u6700\u5927\u56DE\u64A4 > 10%)\u3002

\u{1F4A1} **\u9EDE\u89E3\u8CE3**: ${downCount} \u500B module \u78BA\u8A8D\u4E0B\u8DCC, \u77ED\u671F 5 \u65E5\u57FA\u6E96\u9810\u671F -${Math.abs(parseFloat(baseline5Ret))}%
\u26A0\uFE0F **\u6CE8\u610F**: \u5DF2\u7D93\u6709\u5009\u5C31\u8981\u8003\u616E cut loss, \u8DCC\u7A7F\u6B62\u8755\u4F4D\u5373\u8D70, \u5514\u597D\u7336\u8C6B; \u672A\u6301\u5009\u5C31 avoid \u6488\u5E95
\u{1F4CC} **\u5009\u4F4D**: \u6301\u6709\u5605\u5C31\u6E05\u5009\u6216\u6E1B\u5230 octo \u5009, \u672A\u6301\u5009\u5C31 keep watching`;
    case "TRAP":
      return `\u{1F7E3} **\u5514\u597D\u4FE1\u5C0E\u822A**! \u5075\u6E2C\u5230\u6CE2\u52D5\u7387 squeeze + \u5047\u7A81\u7834, \u865B\u6F32\u9677\u9631\u3002

\u{1F4A1} **\u9EDE\u89E3 TRAP**: \u96D6\u7136\u7747\u843D\u4F3C\u4E0A\u5347\u7A81\u7834 (${upCount} \u500B module UP), \u4F46\u6CE2\u52D5\u7387\u6536\u7E2E + \u5047\u7A81\u7834 = \u77ED\u7DDA\u96A8\u6642\u53CD\u8F49, \u5514\u597D\u88AB\u8AA4\u5C0E
\u{1F4CC} **Monitor**: \u7B49\u4E0B\u6B21 squeeze release (\u6CE2\u5E45\u64F4\u5F35) + \u771F\u7A81\u7834 (\u91CF\u80FD\u914D\u5408) \u5148\u5165\u5834, \u5047\u7A81\u7834\u5605\u5F8C\u679C\u901A\u5E38\u4FC2\u6025\u8DCC
\u{1F4B0} **\u5009\u4F4D**: \u6E05\u5009\u6216\u6975\u4F4E\u5009, \u5B8C\u5168\u5514\u597D\u52A0\u5009`;
    case "TRANSITION":
      return `\u{1F7E3} **\u6536\u6CB9\u6E96\u5099\u8F49\u5F4E**! M1 \u5747\u7DDA + M3 \u8DA8\u52E2\u7DDA\u540C\u6B65\u8F49\u52E2, \u8DA8\u52E2\u5373\u5C07\u6539\u8B8A\u3002

\u{1F4A1} **\u9EDE\u89E3 TRANSITION**: \u96D6\u7136 alignment ${(alignment_score * 100).toFixed(0)}% \u4F46 M1 + M3 \u540C\u6B65\u8F49\u52E2, \u4EE3\u8868\u77ED\u671F\u8DA8\u52E2\u53EF\u80FD\u53CD\u8F49
\u{1F4CC} **Monitor**: \u89C0\u5BDF 1-2 \u65E5\u78BA\u8A8D\u65B0\u8DA8\u52E2, \u5982\u679C\u8F49 UP \u2192 \u8DDF\u65B0\u4E0A\u5347\u8DA8\u52E2; \u8F49 DOWN \u2192 \u8DDF\u65B0\u4E0B\u8DCC\u8DA8\u52E2
\u{1F4B0} **\u5009\u4F4D**: \u6E1B\u5230 quarter \u5009, \u7B49\u65B0\u8DA8\u52E2\u78BA\u8A8D\u5148\u8ABF\u6574`;
    default:
      return `\u26AB \u672A\u77E5 action (${final_action}), \u8ACB\u6AA2\u67E5 implementation`;
  }
}
function decidePositionTrading(synth) {
  const { state, confidence, conflict, warning, m1State, zmenState, transitions, triggers } = synth;
  if (conflict && confidence < 0.3) {
    return {
      action: "TRAP",
      reason: `M1 \u5224 ${m1State} / zmen \u5224 ${zmenState}, \u5169\u500B module \u56B4\u91CD\u5206\u6B67, confidence \u8DCC\u5230 ${(confidence * 100).toFixed(0)}%, \u5514\u597D\u4FE1\u5C0E\u822A, \u865B\u6F32\u9677\u9631`
    };
  }
  if (m1State === "UP" && zmenState === "UP" && !transitions.adjustmentComplete && confidence >= 0.5) {
    return {
      action: "TRANSITION",
      reason: `M1+zmen \u90FD\u8F49 UP \u4F46 5 \u65E5\u7DDA re-test \u4EF2\u672A\u6210\u529F, \u8ABF\u6574\u4E2D, \u7B49 adjustment complete \u518D\u5165\u5834`
    };
  }
  if (triggers.ma5StopTriggered) {
    return {
      action: "SELL",
      reason: `5 \u65E5\u7DDA -2% \u8DCC\u7834 (\u52D5\u614B stop \u89F8\u767C), \u6025\u715E\u8ECA\u96E2\u5834`
    };
  }
  if (triggers.ma20Break) {
    return {
      action: "SELL",
      reason: `20 \u65E5\u7DDA\u8DCC\u7834, \u4E2D\u9577\u671F\u8DA8\u52E2\u8F49\u5F31, \u6025\u715E\u8ECA\u96E2\u5834`
    };
  }
  if (triggers.ma5BreakDay2) {
    return {
      action: "SELL",
      reason: `5 \u65E5\u7DDA\u9023\u7A7F 2 \u65E5, \u4E0A\u5347\u52D5\u529B\u5187\u5497, \u6025\u715E\u8ECA\u96E2\u5834`
    };
  }
  if (triggers.ma5BreakDay1) {
    return {
      action: "REDUCE",
      reason: `5 \u65E5\u7DDA\u7A7F\u7B2C 1 \u65E5, \u6536\u7DCA\u5572\u5009\u4F4D\u7B49\u78BA\u8A8D, \u8DCC\u7A7F MA5 \xD7 0.98 \u5373\u8D70`
    };
  }
  if (state === "SIDEWAYS") {
    return {
      action: "WAIT",
      reason: `M1+zmen \u90FD SIDEWAYS (\u6A6B\u884C), \u5187\u660E\u78BA\u65B9\u5411, \u7B49\u7DA0\u71C8`
    };
  }
  if (state === "CONFLICT") {
    return {
      action: "WAIT",
      reason: `M1 (${m1State}) / zmen (${zmenState}) \u8A0A\u865F\u5206\u6B67, ${warning || "\u5C0F\u5FC3\u5165\u5834"}, \u7B49\u8A0A\u865F\u4E00\u81F4\u5148\u5165\u5834`
    };
  }
  if (confidence < 0.5) {
    return {
      action: "WAIT",
      reason: `\u7D9C\u5408\u4FE1\u5FC3 ${(confidence * 100).toFixed(0)}% < 50%, \u8A0A\u865F\u5514\u6E05\u6670, \u7B49\u7DA0\u71C8`
    };
  }
  if (state === "UP" && confidence < 0.65) {
    return {
      action: "HOLD",
      reason: `M1+zmen \u90FD UP \u4F46 confidence \u53EA\u6709 ${(confidence * 100).toFixed(0)}% (50-65% \u4E2D\u9593\u5340), \u8A0A\u865F\u672A\u5920\u6E05\u6670, \u6301\u6709\u73FE\u91D1\u7B49\u52A0\u5F37`
    };
  }
  if (state === "UP" && confidence >= 0.65 && triggers.ma5RetestSuccess) {
    return {
      action: "ADD",
      reason: `M1+zmen \u90FD UP, confidence ${(confidence * 100).toFixed(0)}% \u2265 65%, 5 \u65E5\u7DDA re-test \u6210\u529F (\u66FE\u7A7F\u5F8C\u56DE\u5347), \u6CB9\u9580\u518D\u8E29\u6DF1\u5572`
    };
  }
  if (state === "UP" && confidence >= 0.65) {
    if (transitions.turnAroundDetected) {
      return {
        action: "BUY",
        reason: `M1+zmen \u90FD UP, confidence ${(confidence * 100).toFixed(0)}% \u2265 65%, turn-around \u78BA\u8A8D (\u5169\u500B module \u540C\u6B65\u7531\u5F31\u8F49\u5F37), \u6CB9\u9580\u4FFE\u5230\u5E95`
      };
    }
    if (transitions.adjustmentComplete) {
      return {
        action: "BUY",
        reason: `M1+zmen \u90FD UP, confidence ${(confidence * 100).toFixed(0)}% \u2265 65%, adjustment complete (5 \u65E5\u7DDA re-test \u6210\u529F, \u4E0A\u5347\u8ABF\u6574\u525B\u5B8C), \u6CB9\u9580\u4FFE\u5230\u5E95`
      };
    }
    return {
      action: "HOLD",
      reason: `M1+zmen \u90FD UP, confidence ${(confidence * 100).toFixed(0)}% \u2265 65%, \u4F46 cycle transition \u672A\u78BA\u8A8D (\u7B49 turn-around / adjustment complete), \u6301\u6709\u89C0\u5BDF`
    };
  }
  if (state === "DOWN") {
    return {
      action: "SELL",
      reason: `M1+zmen \u90FD DOWN, \u4E0B\u8DCC\u78BA\u8A8D, \u6025\u715E\u8ECA`
    };
  }
  return {
    action: "WAIT",
    reason: `\u672A\u80FD\u5339\u914D\u660E\u78BA trigger (state=${state}, confidence=${(confidence * 100).toFixed(0)}%), \u9810\u8A2D\u7B49\u5F85\u89C0\u5BDF`
  };
}
function computePositionTradingCard(currentPrice, ma5, ma20) {
  const entryWidth = 0.015;
  const stopLoss = (ma5 ?? currentPrice * 0.98) * 0.98;
  const trailingStop = ma20 ?? currentPrice * 0.95;
  return {
    entry_zone: [currentPrice * (1 - entryWidth), currentPrice * (1 + entryWidth)],
    stop_loss: stopLoss,
    stop_loss_source: "MA5 * 0.98",
    take_profit: null,
    trailing_stop: trailingStop,
    holding_period: "1-3 months",
    kelly_fraction: "octo"
  };
}
var DEFAULT_ADAPTIVE_PARAMS = {
  ssiWeights: { ma: 0.3, hl: 0.3, trendline: 0.4 },
  rsiWeight: 0.2,
  kellyFraction: "quarter",
  markowitzCorr: { dailyWeekly: 0.85, dailyMonthly: 0.6, weeklyMonthly: 0.7 },
  hurstThresholds: { persistent: 0.55, reverting: 0.45 }
};
function linearRegressionR2(x, y) {
  if (x.length !== y.length || x.length < 2) return 0;
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let ssXY = 0, ssXX = 0, ssYY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    ssXY += dx * dy;
    ssXX += dx * dx;
    ssYY += dy * dy;
  }
  if (ssXX === 0 || ssYY === 0) return 0;
  const r = ssXY / Math.sqrt(ssXX * ssYY);
  return r * r;
}
function computeATRFromArrays(highs, lows, closes, period = 14) {
  if (highs.length < period + 1) return 0;
  const trs = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trs.push(tr);
  }
  if (trs.length < period) return trs.reduce((a, b) => a + b, 0) / trs.length;
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}
function pearsonCorrelation(x, y) {
  if (x.length !== y.length || x.length < 2) return 0;
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let ssXY = 0, ssXX = 0, ssYY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    ssXY += dx * dy;
    ssXX += dx * dx;
    ssYY += dy * dy;
  }
  if (ssXX === 0 || ssYY === 0) return 0;
  return ssXY / Math.sqrt(ssXX * ssYY);
}
function computeHurstExponent(prices) {
  if (prices.length < 30) return 0.5;
  const logRs = [];
  const logNs = [];
  const sizes = [Math.floor(prices.length / 4), Math.floor(prices.length / 3), Math.floor(prices.length / 2), prices.length];
  for (const n2 of sizes) {
    if (n2 < 10) continue;
    const subPrices = prices.slice(prices.length - n2);
    const returns = [];
    for (let i = 1; i < subPrices.length; i++) {
      returns.push(Math.log(subPrices[i] / subPrices[i - 1]));
    }
    if (returns.length < 5) continue;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    let cumDev = 0;
    let maxCum = -Infinity;
    let minCum = Infinity;
    for (const r of returns) {
      cumDev += r - mean;
      if (cumDev > maxCum) maxCum = cumDev;
      if (cumDev < minCum) minCum = cumDev;
    }
    const range = maxCum - minCum;
    let variance = 0;
    for (const r of returns) variance += (r - mean) ** 2;
    const std = Math.sqrt(variance / returns.length);
    if (std === 0) continue;
    const rs = range / std;
    if (rs > 0) {
      logRs.push(Math.log(rs));
      logNs.push(Math.log(n2));
    }
  }
  if (logRs.length < 2) return 0.5;
  const r2 = linearRegressionR2(logNs, logRs);
  const n = logNs.length;
  const meanLogN = logNs.reduce((a, b) => a + b, 0) / n;
  const meanLogR = logRs.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const dx = logNs[i] - meanLogN;
    const dy = logRs[i] - meanLogR;
    num += dx * dy;
    den += dx * dx;
  }
  if (den === 0) return 0.5;
  const H = num / den;
  return Math.max(0, Math.min(1, H));
}
function computeSSIWeights(prices) {
  const window = 60;
  if (prices.length < window) return { ...DEFAULT_ADAPTIVE_PARAMS.ssiWeights };
  const recent = prices.slice(-window);
  const xAxis = recent.map((_, i) => i);
  const maR2 = linearRegressionR2(xAxis, recent);
  const hlMid = [];
  for (let i = 4; i < recent.length; i++) {
    let sum = 0;
    for (let j = i - 4; j <= i; j++) sum += recent[j];
    hlMid.push(sum / 5);
  }
  const hlR2 = linearRegressionR2(xAxis.slice(4), hlMid);
  const trendlineR2 = maR2 * 0.95;
  const total = maR2 + hlR2 + trendlineR2;
  if (total === 0) return { ...DEFAULT_ADAPTIVE_PARAMS.ssiWeights };
  return {
    ma: +(maR2 / total).toFixed(3),
    hl: +(hlR2 / total).toFixed(3),
    trendline: +(trendlineR2 / total).toFixed(3)
  };
}
function computeRSIWeight(sentiment6DList) {
  if (sentiment6DList.length === 0) return DEFAULT_ADAPTIVE_PARAMS.rsiWeight;
  const avgAbs = sentiment6DList.reduce((acc, s) => {
    return acc + (Math.abs(s.rsi) + Math.abs(s.bollinger_pct_b) + Math.abs(s.bias_ratio) + Math.abs(s.vol_skew) + Math.abs(s.turnover) + Math.abs(s.momentum_accel)) / 6;
  }, 0) / sentiment6DList.length;
  return +Math.max(0.1, Math.min(0.5, avgAbs * 0.5)).toFixed(3);
}
function computeKellyFractionFromATR(highs, lows, closes) {
  if (closes.length < 21) return "quarter";
  const atr = computeATRFromArrays(highs, lows, closes, 20);
  const currentClose = closes[closes.length - 1];
  if (currentClose === 0) return "quarter";
  const atrPct = atr / currentClose;
  if (atrPct < 0.02) return "half";
  if (atrPct < 0.05) return "quarter";
  return "octo";
}
function computeMarkowitzCorr(closes) {
  if (closes.length < 60) return { ...DEFAULT_ADAPTIVE_PARAMS.markowitzCorr };
  const dailyReturns = [];
  for (let i = 1; i < closes.length; i++) {
    dailyReturns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const weeklyReturns = [];
  for (let i = 5; i < closes.length; i += 5) {
    weeklyReturns.push((closes[i] - closes[i - 5]) / closes[i - 5]);
  }
  const monthlyReturns = [];
  for (let i = 20; i < closes.length; i += 20) {
    monthlyReturns.push((closes[i] - closes[i - 20]) / closes[i - 20]);
  }
  const minLen = Math.min(weeklyReturns.length, dailyReturns.length / 5);
  const dailyForWeekly = dailyReturns.slice(-minLen * 5).filter((_, i) => i % 5 === 4);
  const dailyForMonthly = dailyReturns.slice(-monthlyReturns.length * 20).filter((_, i) => i % 20 === 19);
  return {
    dailyWeekly: +pearsonCorrelation(dailyForWeekly, weeklyReturns.slice(-minLen)).toFixed(3),
    dailyMonthly: +pearsonCorrelation(dailyForMonthly, monthlyReturns).toFixed(3),
    weeklyMonthly: +pearsonCorrelation(weeklyReturns.slice(-monthlyReturns.length), monthlyReturns).toFixed(3)
  };
}
function computeHurstThresholds(prices) {
  if (prices.length < 60) return { ...DEFAULT_ADAPTIVE_PARAMS.hurstThresholds };
  const H = computeHurstExponent(prices);
  return {
    persistent: +Math.max(0.5, Math.min(0.6, H + 0.05)).toFixed(3),
    reverting: +Math.max(0.4, Math.min(0.5, H - 0.05)).toFixed(3)
  };
}
function calibrateAdaptiveParams(klines, sentiment6DHistory = []) {
  if (!klines || klines.length === 0) return { ...DEFAULT_ADAPTIVE_PARAMS };
  const closes = klines.map((k) => k.close);
  const highs = klines.map((k) => k.high);
  const lows = klines.map((k) => k.low);
  return {
    ssiWeights: computeSSIWeights(closes),
    rsiWeight: computeRSIWeight(sentiment6DHistory),
    kellyFraction: computeKellyFractionFromATR(highs, lows, closes),
    markowitzCorr: computeMarkowitzCorr(closes),
    hurstThresholds: computeHurstThresholds(closes)
  };
}
function applyAdaptiveParamsToSynthesizer(sv, params) {
  const kf = params.kellyFraction;
  const kNum = KELLY_NUMERIC_MAP[kf];
  return {
    ...sv,
    // 大少 12:30 Bug 2 fix: Kelly override (string + numeric + position)
    kelly_fraction: kf,
    kelly_numeric: kNum ?? sv.kelly_numeric,
    kelly_position: kNum ?? sv.kelly_position,
    // 將 params 放落 module_specific 供 testing page render
    module_verdicts: sv.module_verdicts.map((mv) => {
      if (mv.module_id === "ma-alignment" || mv.module_id === "hl-structure" || mv.module_id === "trendline") {
        return {
          ...mv,
          module_specific: {
            ...mv.module_specific,
            adaptive_ssi_weight: params.ssiWeights[mv.module_id === "ma-alignment" ? "ma" : mv.module_id === "hl-structure" ? "hl" : "trendline"]
          }
        };
      }
      return mv;
    })
  };
}
var DecisionEngine = class {
  /** 8 個 finalAction 決策樹 — 大少 13:30 Plan A 確認嘅 trigger conditions
   *
   *  流程:
   *    1. 拎 majority state (從 verdicts)
   *    2. 拎 alignment + grade + ssi_score (從 SynthesizerVerdict)
   *    3. 拎 weighted avg expected_return + max_drawdown (從 verdicts + base_weight)
   *    4. 拎 raw RSI (從 indicators module)
   *    5. 拎 market data flags (currentPrice / consecutiveUpDays / squeeze / fake breakout / MA-TL transition)
   *    6. 8 個 trigger check (priority order: 危險先, 機會後)
   *    7. Trading card 計算 (2.1 static, 2.2 adaptive)
   *    8. Short term forecast 暫空 (2.3 impl)
   *    9. Interpretation 暫空 (2.4 impl LLM hook)
   *   10. Return DecisionVerdict
   */
  async decide(input) {
    const sv = input.synthesizerVerdict;
    const verdicts = input.moduleVerdicts ?? sv.module_verdicts ?? [];
    const md = input.marketData ?? {};
    const strategyMode = input.strategyMode ?? "swing";
    const majorityState = getMajorityState(verdicts);
    const alignment = sv.alignment_score;
    const { grade, grade_score } = sv;
    const ssi_score = sv.ssi_score;
    const expected_return = weightedAverage(
      verdicts.map((v) => ({ v: v.expected_return, w: v.base_weight }))
    );
    const max_drawdown_estimate = weightedAverage(
      verdicts.map((v) => ({ v: v.max_drawdown_estimate, w: v.base_weight }))
    );
    const rsi = getRawRSI(verdicts);
    const currentPrice = md.currentPrice ?? 0;
    const consecutiveUpDays = md.consecutiveUpDays ?? 0;
    const squeezeDetected = md.squeezeDetected ?? false;
    const fakeBreakoutDetected = md.fakeBreakoutDetected ?? false;
    const maTrendlineTransition = md.maTrendlineTransition ?? false;
    let final_action;
    let final_action_reason;
    if (squeezeDetected && fakeBreakoutDetected) {
      final_action = "TRAP";
      final_action_reason = "\u6CE2\u52D5\u7387\u5075\u6E2C\u5230 squeeze (\u6CE2\u5E45\u6536\u7E2E) + \u5047\u7A81\u7834, \u5514\u597D\u4FE1\u5C0E\u822A, \u865B\u6F32\u9677\u9631";
    } else if (maTrendlineTransition) {
      final_action = "TRANSITION";
      final_action_reason = "M1 \u5747\u7DDA + M3 \u8DA8\u52E2\u7DDA\u540C\u6B65\u8F49\u52E2, \u6536\u6CB9\u6E96\u5099\u8F49\u5F4E";
    } else if (majorityState === "DOWN" && isGradeAtMost(grade, "C") && max_drawdown_estimate > 0.1) {
      final_action = "SELL";
      final_action_reason = `\u591A\u6578 module \u8A8D\u70BA\u4E0B\u8DCC, grade ${grade} (\u2264C), \u9810\u671F\u6700\u5927\u56DE\u64A4 ${(max_drawdown_estimate * 100).toFixed(1)}% (>10%), \u6025\u715E\u8ECA`;
    } else if (majorityState === "TRANSITION" && alignment < 0.5) {
      final_action = "REDUCE";
      final_action_reason = `\u8F49\u52E2\u4E2D + alignment ${(alignment * 100).toFixed(0)}% (<50%), \u6536\u8FD4\u5C11\u5C11\u6CB9, \u907F\u514D\u53CD\u8986`;
    } else if (majorityState === "SIDEWAYS" && grade === "C" && alignment < 0.6) {
      final_action = "WAIT";
      final_action_reason = `\u5187\u660E\u78BA\u65B9\u5411, grade C, alignment ${(alignment * 100).toFixed(0)}% (<60%), \u7B49\u7DA0\u71C8`;
    } else if (majorityState === "UP" && (grade === "B" || grade === "C+") && max_drawdown_estimate < 0.08) {
      final_action = "HOLD";
      final_action_reason = `\u4E0A\u5347\u4F46 grade ${grade} (B/C+), \u6700\u5927\u56DE\u64A4 ${(max_drawdown_estimate * 100).toFixed(1)}% (<8%), \u8DA8\u52E2\u4EF2 OK \u4F46\u5514\u5F37, \u4FDD\u6301\u73FE\u901F`;
    } else if (majorityState === "UP" && isGradeAtLeast(grade, "A") && alignment >= 0.7 && rsi > 70 && consecutiveUpDays >= 3) {
      final_action = "ADD";
      final_action_reason = `\u5F37\u52E2\u4E0A\u5347, grade ${grade} (\u2265A), alignment ${(alignment * 100).toFixed(0)}% (\u226570%), RSI ${rsi.toFixed(0)} (>70), \u9023\u6F32 ${consecutiveUpDays} \u65E5 (\u22653), \u6CB9\u9580\u518D\u8E29\u6DF1\u5572`;
    } else if (majorityState === "UP" && alignment >= 0.6 && isGradeAtLeast(grade, "B") && expected_return > 0.03 && max_drawdown_estimate < 0.1 && rsi > 50) {
      final_action = "BUY";
      final_action_reason = `\u591A\u6578 module \u8A8D\u70BA\u4E0A\u5347, alignment ${(alignment * 100).toFixed(0)}% (\u226560%), grade ${grade} (\u2265B), \u9810\u671F\u56DE\u5831 ${(expected_return * 100).toFixed(1)}% (>3%), \u6700\u5927\u56DE\u64A4 ${(max_drawdown_estimate * 100).toFixed(1)}% (<10%), RSI ${rsi.toFixed(0)} (>50), \u6CB9\u9580\u4FFE\u5230\u5E95`;
    } else {
      final_action = "WAIT";
      final_action_reason = `\u672A\u80FD\u5339\u914D\u660E\u78BA trigger (state=${majorityState}, grade=${grade}, alignment=${(alignment * 100).toFixed(0)}%, RSI=${rsi.toFixed(0)}), \u9810\u8A2D\u7B49\u5F85\u89C0\u5BDF`;
    }
    const trading_card = computeTradingCard(currentPrice, sv.kelly_fraction, max_drawdown_estimate);
    const short_term_forecast = computeShortTermForecast(expected_return, max_drawdown_estimate);
    const interpretation = await generateInterpretation({
      final_action,
      module_verdicts: verdicts,
      synthesizer_verdict: sv,
      short_term_forecast
    });
    return {
      final_action,
      final_action_reason,
      trading_card,
      short_term_forecast,
      interpretation,
      module_verdicts: verdicts,
      synthesizer_verdict: sv,
      // 大少 2026-08-09 19:06 — 兩線策略 output
      strategy_mode: strategyMode,
      timestamp: Date.now()
    };
  }
  /** 大少 2026-08-09 19:06 — Position Trading 決策 (兩線策略第一線)
   *  用 cycle-synthesizer (M1+zmen 加權綜合) + 5 個 trigger 推導 final action
   *  跟 swing 唔同嘅地方:
   *    - 8 個 finalAction 統一 priority chain: TRAP > TRANSITION > SELL > REDUCE > WAIT > HOLD > ADD > BUY
   *    - Entry condition 要 confidence >= 0.65 + turn-around / adjustment complete trigger
   *    - Trading card 動態 MA5/MA20 stop, Kelly 'octo' (1/8)
   *    - 持倉 1-3 個月, 唔好追高
   *
   *  @param input DecideInput (必須包含 m1Verdict + zmenVerdict + klineCloses)
   *  @returns DecisionVerdict (strategy_mode='position' + cycle_synthesizer + position_trading_card)
   */
  async decidePosition(input) {
    const sv = input.synthesizerVerdict;
    const verdicts = input.moduleVerdicts ?? sv.module_verdicts ?? [];
    const md = input.marketData ?? {};
    const currentPrice = md.currentPrice ?? 0;
    let synth;
    if (input.cycleSynthesizerResult) {
      synth = input.cycleSynthesizerResult;
    } else if (input.m1Verdict && input.zmenVerdict && input.klineCloses) {
      synth = synthesizeCycle({
        m1Verdict: input.m1Verdict,
        zmenVerdict: input.zmenVerdict,
        klineCloses: input.klineCloses
      });
    } else {
      synth = {
        state: sv.module_verdicts[0]?.state === "UP" || sv.module_verdicts[0]?.state === "DOWN" ? sv.module_verdicts[0].state : "SIDEWAYS",
        confidence: sv.ssi_score / 100,
        conflict: false,
        warning: "\u26A0\uFE0F decidePosition \u7F3A\u5C11 m1Verdict/zmenVerdict/klineCloses, \u7528 synthesizer verdict fallback",
        m1State: "SIDEWAYS",
        zmenState: "SIDEWAYS",
        weights: { m1: 0.6, zmen: 0.4 },
        transitions: { turnAroundDetected: false, adjustmentComplete: false },
        triggers: {
          ma5StopTriggered: false,
          ma5BreakDay1: false,
          ma5BreakDay2: false,
          ma20Break: false,
          ma5RetestSuccess: false
        },
        meta: { currentPrice, ma5: null, ma20: null, consensus: "sideways" }
      };
    }
    const { action: final_action, reason: final_action_reason } = decidePositionTrading(synth);
    const position_trading_card = computePositionTradingCard(
      currentPrice,
      synth.meta.ma5,
      synth.meta.ma20
    );
    const trading_card = {
      entry_zone: position_trading_card.entry_zone,
      stop_loss: position_trading_card.stop_loss,
      take_profit: 0,
      // 0 = 無 fixed take_profit (swing 唔識 render null, fallback 0)
      trailing_stop: position_trading_card.trailing_stop
    };
    const expectedReturn = 0.05;
    const maxDrawdown = 0.08;
    const short_term_forecast = computeShortTermForecast(expectedReturn, maxDrawdown);
    const interpretation = await generatePositionInterpretation({
      final_action,
      cycle_synthesizer: synth,
      position_trading_card
    });
    return {
      final_action,
      final_action_reason,
      trading_card,
      short_term_forecast,
      interpretation,
      module_verdicts: verdicts,
      synthesizer_verdict: sv,
      strategy_mode: "position",
      cycle_synthesizer: synth,
      position_trading_card,
      timestamp: Date.now()
    };
  }
};
async function generatePositionInterpretation(ctx) {
  return hardcodedPositionInterpretation(ctx);
}
function hardcodedPositionInterpretation(ctx) {
  const { final_action, cycle_synthesizer, position_trading_card } = ctx;
  const { state, confidence, conflict, warning, m1State, zmenState, transitions, triggers, meta } = cycle_synthesizer;
  const confPct = (confidence * 100).toFixed(0);
  const ma5Str = meta.ma5 != null ? meta.ma5.toFixed(2) : "N/A";
  const ma20Str = meta.ma20 != null ? meta.ma20.toFixed(2) : "N/A";
  const stopStr = position_trading_card.stop_loss.toFixed(2);
  const trailingStr = position_trading_card.trailing_stop.toFixed(2);
  const synthStateLabel = state === "CONFLICT" ? "\u26A0\uFE0F \u8A0A\u865F\u5206\u6B67" : state === "UP" ? "\u4E0A\u5347" : state === "DOWN" ? "\u4E0B\u8DCC" : "\u6A6B\u884C";
  const triggerBadges = [
    triggers.ma5StopTriggered ? "\u{1F534} MA5-2%" : "\u26AA MA5-2%",
    triggers.ma5BreakDay1 ? "\u{1F7E1} MA5\u7A7F1\u65E5" : "\u26AA MA5\u7A7F1\u65E5",
    triggers.ma5BreakDay2 ? "\u{1F534} MA5\u7A7F2\u65E5" : "\u26AA MA5\u7A7F2\u65E5",
    triggers.ma20Break ? "\u{1F534} MA20\u8DCC\u7834" : "\u26AA MA20\u8DCC\u7834",
    triggers.ma5RetestSuccess ? "\u{1F7E2} MA5-re-test" : "\u26AA MA5-re-test"
  ].join(" ");
  const header = `\u{1F4C8} **Position Trading \u5224\u5B9A\uFF1A${synthStateLabel}\uFF08${state}\uFF09**, \u7D9C\u5408\u4FE1\u5FC3 ${confPct}%
\u{1F9EE} M1=${m1State} / zmen=${zmenState} (60/40 \u52A0\u6B0A) ${conflict ? warning || "\u26A0\uFE0F \u8A0A\u865F\u5206\u6B67" : "\u2705 \u4E00\u81F4"}
\u{1F4CA} 5 \u500B trigger: ${triggerBadges}
\u{1F3AF} Cycle transition: turn-around=${transitions.turnAroundDetected ? "\u2705" : "\u26AA"} / adjustment-complete=${transitions.adjustmentComplete ? "\u2705" : "\u26AA"}
\u{1F4B0} Trading card: \u52D5\u614B stop=$${stopStr} (MA5=$${ma5Str} \xD7 0.98) / trailing=$${trailingStr} (MA20=$${ma20Str}) / Kelly=1/8 / \u6301\u5009 1-3 \u500B\u6708 / \u7121 fixed take_profit

`;
  switch (final_action) {
    case "BUY":
      return header + `\u{1F7E2} **\u61C9\u8A72\u8CB7\u5165**\u3002M1+zmen \u90FD UP, \u4FE1\u5FC3 ${confPct}% \u2265 65%, \u800C\u4E14 cycle transition \u78BA\u8A8D:
   - ${transitions.turnAroundDetected ? "turn-around: \u5169\u500B module \u540C\u6B65\u7531\u5F31\u8F49\u5F37" : "adjustment complete: 5 \u65E5\u7DDA re-test \u6210\u529F, \u4E0A\u5347\u8ABF\u6574\u525B\u5B8C"}
\u{1F4A1} **\u9EDE\u89E3\u8981\u8CB7**: \u5927\u5C11 position trading \u98A8\u683C, \u5514\u8FFD\u9AD8, \u7B49 cycle \u78BA\u8A8D\u5148\u5165\u5834\u3002\u6301\u5009 1-3 \u500B\u6708, \u4E2D\u9577\u671F\u98DF\u4E0A\u5347\u8DA8\u52E2
\u{1F6D1} **\u98A8\u63A7**: \u52D5\u614B stop $${stopStr} (MA5 \xD7 0.98, \u6BCF\u65E5 update), \u5514\u597D\u7747\u6B7B
\u{1F4C8} **\u52A0\u5009\u8A0A\u865F**: 5 \u65E5\u7DDA re-test \u6210\u529F \u2192 ADD (\u8DCC\u5B8C\u518D\u4E0A\u52A0\u591A\u6CE8)
\u{1F4C9} **\u64A4\u9000\u8A0A\u865F**: \u7A7F 1 \u65E5 (REDUCE) / \u7A7F 2 \u65E5 (SELL) / 5 \u65E5\u7DDA -2% \u8DCC\u7834 (SELL) / 20 \u65E5\u7DDA\u8DCC\u7834 (SELL)`;
    case "ADD":
      return header + `\u{1F7E2} **\u52A0\u5009\u8A0A\u865F**! 5 \u65E5\u7DDA re-test \u6210\u529F, \u6CB9\u9580\u518D\u8E29\u6DF1\u5572
\u{1F4A1} **\u9EDE\u89E3\u52A0\u5009**: position trading \u98A8\u683C, \u5347\u52E2\u78BA\u8A8D + re-test \u6210\u529F = \u5065\u5EB7\u4E0A\u5347, \u52A0\u6CE8\u98DF\u591A\u5572\u8DA8\u52E2
\u26A0\uFE0F **\u6CE8\u610F**: \u52D5\u614B stop \u4ECD\u7136\u55BA $${stopStr} (MA5 \xD7 0.98), \u52A0\u5009\u5F8C\u8981\u5BC6\u5207 monitor
\u{1F4B0} **\u5009\u4F4D**: 1/8 (octo), \u52A0\u5009\u5F8C\u7E3D\u5009\u4F4D\u53EF\u80FD > 100%, \u6CE8\u610F risk management`;
    case "HOLD":
      return header + `\u{1F7E1} **\u6301\u6709\u73FE\u91D1\u7B49\u52A0\u5F37**\u3002M1+zmen \u90FD UP \u4F46\u4FE1\u5FC3\u672A\u5920\u5165\u5834 (50-65% \u4E2D\u9593\u5340, \u6216 cycle transition \u672A\u78BA\u8A8D)
\u{1F4A1} **\u9EDE\u89E3 hold**: ${confidence < 0.65 ? `\u4FE1\u5FC3 ${confPct}% \u55BA 50-65% \u4E2D\u9593\u5340, \u7B49\u52A0\u5F37\u5230 65% \u5148\u5165\u5834` : "cycle transition \u672A\u78BA\u8A8D, \u7B49 turn-around / adjustment complete trigger"}
\u{1F4CC} **Monitor**: \u4E00\u65E6 confidence \u2265 65% + transition \u78BA\u8A8D \u2192 BUY trigger; \u8DCC\u7A7F MA5 \xD7 0.98 \u2192 SELL trigger`;
    case "WAIT":
      return header + `\u{1F7E1} **\u7B49\u7DA0\u71C8**\u3002${state === "SIDEWAYS" ? "M1+zmen \u90FD SIDEWAYS (\u6A6B\u884C), \u5187\u660E\u78BA\u65B9\u5411" : state === "CONFLICT" ? `M1=${m1State} / zmen=${zmenState} \u8A0A\u865F\u5206\u6B67, ${warning || "\u5C0F\u5FC3\u5165\u5834"}` : `\u4FE1\u5FC3 ${confPct}% < 50% \u5514\u5920\u5165\u5834`}
\u{1F4A1} **\u9EDE\u89E3 wait**: position trading \u5514\u8FFD\u9AD8, \u8A0A\u865F\u8981\u6E05\u6670\u5148\u5165\u5834, \u5F37\u884C\u5165\u5834\u98A8\u96AA\u9AD8
\u{1F4CC} **Monitor**: \u4E00\u65E6 SIDEWAYS \u8B8A UP (confidence \u2265 65% + transition \u78BA\u8A8D) \u2192 BUY trigger; \u8B8A DOWN \u2192 SELL trigger`;
    case "REDUCE":
      return header + `\u{1F7E0} **\u6536\u7DCA\u5572\u5009\u4F4D**! 5 \u65E5\u7DDA\u7A7F\u7B2C 1 \u65E5, \u8DCC\u7A7F MA5 \xD7 0.98 \u5373\u8D70
\u{1F4A1} **\u9EDE\u89E3 reduce**: \u7A7F 1 \u65E5\u4EF2\u672A\u7B97\u8F49\u52E2, \u4F46\u6536\u7DCA\u6B62\u640D\u7B49\u78BA\u8A8D\u3002\u5982\u679C\u56DE\u5347\u5C31 hold \u4F4F, \u8DCC\u7A7F\u5C31 SELL
\u{1F4CC} **Monitor**: \u7A7F 2 \u65E5 \u2192 SELL; \u8DCC\u7A7F MA5 \xD7 0.98 \u2192 SELL; \u56DE\u5347\u904E MA5 \u2192 HOLD`;
    case "SELL":
      return header + `\u{1F534} **\u6025\u715E\u8ECA\u96E2\u5834**! ${triggers.ma5StopTriggered ? "5 \u65E5\u7DDA -2% \u8DCC\u7834 (\u52D5\u614B stop \u89F8\u767C)" : triggers.ma5BreakDay2 ? "5 \u65E5\u7DDA\u9023\u7A7F 2 \u65E5" : triggers.ma20Break ? "20 \u65E5\u7DDA\u8DCC\u7834, \u4E2D\u9577\u671F\u8F49\u5F31" : state === "DOWN" ? "M1+zmen \u90FD DOWN, \u4E0B\u8DCC\u78BA\u8A8D" : "Stop trigger \u89F8\u767C"}
\u{1F4A1} **\u9EDE\u89E3\u8CE3**: position trading \u98A8\u683C, \u52D5\u614B stop \u89F8\u767C\u5C31\u8981\u8D70, \u5514\u597D\u7336\u8C6B
\u{1F4CC} **\u4E4B\u5F8C\u9EDE**: \u7B49\u4E0B\u4E00\u500B cycle \u78BA\u8A8D (BUY \u689D\u4EF6) \u5148\u518D\u5165\u5834, \u5514\u597D\u6488\u5E95`;
    case "TRAP":
      return header + `\u{1F7E3} **\u5514\u597D\u4FE1\u5C0E\u822A**! M1+zmen \u56B4\u91CD\u5206\u6B67, confidence \u8DCC\u5230 ${confPct}%
\u{1F4A1} **\u9EDE\u89E3 TRAP**: \u96D6\u7136\u7747\u843D\u4F3C\u4E0A\u5347, \u4F46\u5169\u500B module \u56B4\u91CD\u5206\u6B67 = \u8A0A\u865F\u5514\u53EF\u4FE1, \u5514\u597D\u88AB\u8AA4\u5C0E
\u{1F4CC} **Monitor**: \u7B49 M1+zmen \u9054\u6210\u5171\u8B58 (consensus='aligned') \u5148\u5165\u5834
\u{1F4B0} **\u5009\u4F4D**: \u6E05\u5009\u6216\u6975\u4F4E\u5009, \u5B8C\u5168\u5514\u597D\u52A0\u5009`;
    case "TRANSITION":
      return header + `\u{1F7E3} **\u8ABF\u6574\u4E2D, \u7B49 adjustment complete**! M1+zmen \u90FD\u8F49 UP \u4F46 5 \u65E5\u7DDA re-test \u4EF2\u672A\u6210\u529F
\u{1F4A1} **\u9EDE\u89E3 TRANSITION**: \u4E0A\u5347\u52D5\u529B\u51FA\u73FE\u5497, \u4F46 adjustment \u4EF2\u9032\u884C\u7DCA, \u5514\u597D\u8FFD\u5165, \u7B49\u5B8C\u6210
\u{1F4CC} **Monitor**: 5 \u65E5\u7DDA re-test \u6210\u529F \u2192 adjustment complete \u2192 BUY trigger; \u53CD\u8F49 \u2192 SELL trigger
\u{1F4B0} **\u5009\u4F4D**: \u6301\u6709\u73FE\u91D1\u6216\u6975\u4F4E\u5009, \u7B49\u8ABF\u6574\u5B8C`;
    default:
      return header + `\u26AB \u672A\u77E5 action (${final_action}), \u8ACB\u6AA2\u67E5 implementation`;
  }
}
var decision_engine_default = DecisionEngine;
export {
  DEFAULT_ADAPTIVE_PARAMS,
  DecisionEngine,
  applyAdaptiveParamsToSynthesizer,
  calibrateAdaptiveParams,
  decision_engine_default as default,
  generateInterpretation,
  generatePositionInterpretation
};

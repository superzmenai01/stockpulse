// modules/cycle-synthesizer.ts — 大少 2026-08-09 19:06 確認兩線策略
//
// 第一線 (大少 position trading) 用 M1 + zmen 兩個 cycle detector 互相驗證:
// - 第一路: AS-03-MA v2.0.0 (M1) — 均線系統週期判斷法
// - 第二路: zmen均算法 v0.3.0 (zmen) — 舊 M1 抽出獨立
// - 第三路: 加權綜合結果
//
// 大少 5 個 default (19:06 confirm):
// 1. 綜合方法: 加權平均 (M1 60% + zmen 40%)
// 2. 一致/分歧/SIDEWAYS: 一致=high confidence / 分歧=low+⚠️ / 都 SIDEWAYS=唔入場
// 3. confidence threshold: ≥0.65 入場 / 0.50-0.65 小心 / <0.50 唔入場
// 4. 5 個 trigger base: 綜合結果
// 5. UI 顯示 order: 第一線先, 第二線後
//
// 5 個 trigger (大少 position trading 風格):
// 1. 5 日線 -2% 跌破 (動態 stop, 每日 update)
// 2. 5 日線穿第 1 日
// 3. 5 日線穿第 2 日
// 4. 20 日線跌破
// 5. 5 日線 re-test 成功 (跌完再上)
//
// Spec doc: docs/research/AS-03-cycle-detection/MODULE-08-CYCLE-SYNTHESIZER.md (v0.1.0, 2026-08-09)
// Parent module: docs/research/AS-03-cycle-detection/MODULE-08-DECISION-ENGINE.md (§ 14 兩線策略)

// =============================================================
// Types
// =============================================================

export type CycleState = 'UP' | 'DOWN' | 'SIDEWAYS';

export interface CycleVerdict {
  state: CycleState;
  confidence: number;  // 0-1
  interpretation?: string;
  meta?: {
    matchedRules?: string[];
    ruleLabels?: string[];
    dataDays?: number;
    [k: string]: any;
  };
  timestamp?: number;
}

export interface CycleSynthesizerWeights {
  m1: number;       // 預設 0.6
  zmen: number;     // 預設 0.4
}

export interface CycleSynthesizerInput {
  m1Verdict: CycleVerdict;
  zmenVerdict: CycleVerdict;
  // kline 嘅 close prices, [0] = 今日 (newest), [1] = 昨日, ... [n-1] = 最舊
  // 至少 20 條 (trigger 計算要 MA5/MA20)
  klineCloses: number[];
  weights?: CycleSynthesizerWeights;
}

export interface CycleTriggers {
  // Trigger 1: 5 日線 -2% 跌破 (動態 stop)
  ma5StopTriggered: boolean;
  // Trigger 2: 5 日線穿第 1 日 (今日 close < MA5)
  ma5BreakDay1: boolean;
  // Trigger 3: 5 日線穿第 2 日 (連續 2 日 close < MA5)
  ma5BreakDay2: boolean;
  // Trigger 4: 20 日線跌破
  ma20Break: boolean;
  // Trigger 5: 5 日線 re-test 成功 (過去 5 日內曾穿, 今日回升過 MA5)
  ma5RetestSuccess: boolean;
}

export interface CycleTransitions {
  // M1/zmen 由 down → up 第一日 (turn-around)
  turnAroundDetected: boolean;
  // M1/zmen 上升調整剛完 (5 日線 re-test success, 大少 buy-back trigger)
  adjustmentComplete: boolean;
}

export type SynthesizedState = CycleState | 'CONFLICT';

export interface CycleSynthesizerResult {
  // 綜合判定
  state: SynthesizedState;            // UP / DOWN / SIDEWAYS / CONFLICT
  confidence: number;                 // 加權平均, 分歧時 *0.5 penalty
  conflict: boolean;                  // true if 兩個 module 唔同 state
  warning: string | null;             // 分歧時嘅 warning message
  m1State: CycleState;
  zmenState: CycleState;
  weights: CycleSynthesizerWeights;
  // Cycle transition
  transitions: CycleTransitions;
  // 5 個 trigger
  triggers: CycleTriggers;
  // Debug meta
  meta: {
    currentPrice: number | null;
    ma5: number | null;
    ma20: number | null;
    consensus: 'aligned' | 'conflict' | 'sideways';
  };
}

// =============================================================
// Helpers
// =============================================================

/**
 * Simple Moving Average, 返 array (length = closes.length).
 * 假設 closes[0] = 今日 (newest), closes[n-1] = 最舊 (大少 19:06 spec)
 * ma[i] = avg(closes[i..i+period-1]) (5 個 window 內嘅 close 平均)
 * i + period - 1 >= closes.length 嗰陣 push NaN (data 唔夠)
 */
function computeMA(closes: number[], period: number): number[] {
  const ma: number[] = [];
  const n = closes.length;
  for (let i = 0; i < n; i++) {
    if (i + period - 1 >= n) {
      ma.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += closes[i + j];
    }
    ma.push(sum / period);
  }
  return ma;
}

// =============================================================
// Main synthesizer
// =============================================================

export function synthesizeCycle(input: CycleSynthesizerInput): CycleSynthesizerResult {
  const { m1Verdict, zmenVerdict, klineCloses } = input;
  const weights: CycleSynthesizerWeights = input.weights ?? { m1: 0.6, zmen: 0.4 };

  // 1. 加權綜合 confidence
  const baseConfidence = m1Verdict.confidence * weights.m1 + zmenVerdict.confidence * weights.zmen;

  // 2. 判定一致/分歧/SIDEWAYS
  const m1State = m1Verdict.state;
  const zmenState = zmenVerdict.state;
  let state: SynthesizedState;
  let confidence: number;
  let conflict = false;
  let warning: string | null = null;
  let consensus: 'aligned' | 'conflict' | 'sideways';

  if (m1State === zmenState) {
    // 兩者一致
    state = m1State;
    confidence = baseConfidence;
    consensus = 'aligned';
    if (state === 'SIDEWAYS') {
      consensus = 'sideways';
    }
  } else {
    // 兩者分歧
    conflict = true;
    state = 'CONFLICT';
    confidence = baseConfidence * 0.5;  // penalty
    consensus = 'conflict';
    warning = `⚠️ 兩個 module 訊號分歧 (M1=${m1State} / zmen=${zmenState}), 小心入場, confidence 折半`;
  }

  // 3. 計 MA5/MA20 + 5 個 trigger
  const triggers = computeTriggers(klineCloses);

  // 4. 計 cycle transition
  const transitions = computeTransitions(m1State, zmenState, triggers, m1Verdict, zmenVerdict);

  // 5. Debug meta
  const maArr = computeMA(klineCloses, 5);
  const ma20Arr = computeMA(klineCloses, 20);
  const meta = {
    currentPrice: klineCloses[0] ?? null,
    ma5: isNaN(maArr[0]) ? null : maArr[0],
    ma20: isNaN(ma20Arr[0]) ? null : ma20Arr[0],
    consensus,
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
    meta,
  };
}

// =============================================================
// 5 個 trigger (大少 position trading)
// =============================================================

function computeTriggers(closes: number[]): CycleTriggers {
  if (closes.length < 20) {
    return {
      ma5StopTriggered: false,
      ma5BreakDay1: false,
      ma5BreakDay2: false,
      ma20Break: false,
      ma5RetestSuccess: false,
    };
  }

  const ma5Arr = computeMA(closes, 5);
  const ma20Arr = computeMA(closes, 20);
  const todayClose = closes[0];
  const yesterdayClose = closes[1] ?? todayClose;
  const ma5Today = ma5Arr[0];
  const ma5Yesterday = ma5Arr[1] ?? ma5Today;
  const ma20Today = ma20Arr[0];

  // Trigger 1: 5 日線 -2% 跌破 (動態 stop, 大少風格)
  const ma5StopTriggered = !isNaN(ma5Today) && todayClose < ma5Today * 0.98;

  // Trigger 2: 5 日線穿第 1 日 (今日 close < MA5, 但未到 -2%)
  const ma5BreakDay1 = !isNaN(ma5Today) && todayClose < ma5Today && todayClose >= ma5Today * 0.98;

  // Trigger 3: 5 日線穿第 2 日 (連續 2 日 close < MA5)
  const ma5BreakDay2 =
    !isNaN(ma5Today) && !isNaN(ma5Yesterday) &&
    todayClose < ma5Today && yesterdayClose < ma5Yesterday;

  // Trigger 4: 20 日線跌破
  const ma20Break = !isNaN(ma20Today) && todayClose < ma20Today;

  // Trigger 5: 5 日線 re-test 成功
  // 過去 5 日內曾經 close < MA5, 今日 close >= MA5
  let ma5RetestSuccess = false;
  for (let i = 1; i <= Math.min(5, closes.length - 1); i++) {
    if (!isNaN(ma5Arr[i]) && closes[i] < ma5Arr[i]) {
      // 之前曾穿, 今日回升
      ma5RetestSuccess = !isNaN(ma5Today) && todayClose >= ma5Today;
      break;
    }
  }

  return {
    ma5StopTriggered,
    ma5BreakDay1,
    ma5BreakDay2,
    ma20Break,
    ma5RetestSuccess,
  };
}

// =============================================================
// Cycle transition (turn-around + adjustment complete)
// =============================================================

function computeTransitions(
  m1State: CycleState,
  zmenState: CycleState,
  triggers: CycleTriggers,
  m1Verdict: CycleVerdict,
  zmenVerdict: CycleVerdict,
): CycleTransitions {
  // turnAroundDetected: 兩個 module 都 UP (一致高 confidence) + cycle 剛剛由 down 轉
  // 簡化: 兩個都 UP (state) + 綜合 confidence >= 0.65 (大少 threshold)
  const bothUp = m1State === 'UP' && zmenState === 'UP';
  const turnAroundDetected = bothUp && (m1Verdict.confidence >= 0.65) && (zmenVerdict.confidence >= 0.65);

  // adjustmentComplete: 5 日線 re-test 成功 (trigger 5) + 兩個都 UP
  const adjustmentComplete = bothUp && triggers.ma5RetestSuccess;

  return {
    turnAroundDetected,
    adjustmentComplete,
  };
}

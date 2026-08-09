// modules/multi-tf.ts — AS-03 · M5 Multi-TF 多時間框架週期判定法 v1.0.0
//
// 大少 2026-08-09 21:33 — Stage 2 重新 plan (大少 14:16 揀 A drop, 21:30 confirm go)
//
// 4 個 design decision (大少 21:33 confirm 全 A):
//   D1: 1D (主) + 1W (confirm) + 1M (大方向) = 3 個 timeframe
//   D2: 分層 weights — 1D 25% / 1W 35% / 1M 40% (大方向權重最高)
//   D3: 動態 MA10/MA20 pullback 邏輯
//   D4: 12:1 walk-forward (Pardo 標準, 較 M9 嚴格)
//
// 答「3 個 timeframe 嘅 cycle 方向一致嗎」:
//   - 一致 (3 個 TF 同一方向) = 高信心
//   - 半一致 (1 個 TF 唔同) = 中信心 + ⚠️ warning
//   - 完全分歧 (3 個 TF 唔同) = CONFLICT 唔好入場
//
// Spec doc: docs/research/AS-03-cycle-detection/MODULE-05-MULTI-TIMEFRAME.md

// =============================================================
// Types
// =============================================================

export type Timeframe = '1D' | '1W' | '1M';

export type CycleState = 'UP' | 'DOWN' | 'SIDEWAYS';

export interface KLine {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SubVerdict {
  state: CycleState;
  confidence: number;
  matched_rules: string[];
  rule_labels: string[];
  data_days: number;
  ma5: number;
  ma10: number;
  ma20: number;
  ma60: number;
  current_price: number;
}

export interface ConsensusInfo {
  score: number;                              // 0-1
  direction: 'aligned' | 'partial' | 'divergent';
  description: string;
}

export interface CycleTransitions {
  turn_around: boolean;                       // 大方向由 DOWN 轉 UP
  adjustment_complete: boolean;               // 大方向調整剛完
}

export type SynthesizedState = CycleState | 'CONFLICT';

export interface MultiTFVerdict {
  symbol: string;
  timeframe: string;                          // 主要 TF (e.g. '1D' for daily)
  state: SynthesizedState;                    // UP / DOWN / SIDEWAYS / CONFLICT
  confidence: number;                         // 0-1, 加權綜合 (分歧時 *0.5 penalty)
  conflict: boolean;                          // true if 唔同方向
  warning: string | null;                     // 分歧時嘅 warning message

  // 3 個 timeframe 嘅 sub-verdict
  timeframe_verdicts: {
    '1D': SubVerdict;
    '1W': SubVerdict;
    '1M': SubVerdict;
  };

  // 一致性評分 (confluence)
  consensus: ConsensusInfo;

  // Cycle transition
  transitions: CycleTransitions;

  meta: {
    data_days_1d: number;
    data_days_1w: number;
    data_days_1m: number;
    tf_weights: Record<Timeframe, number>;
    sub_module: string;
  };
}

export interface MultiTFWeights {
  '1D': number;
  '1W': number;
  '1M': number;
}

export interface MultiTFConfig {
  tfWeights: MultiTFWeights;
  consensusThreshold: number;
  conflictConfidenceMultiplier: number;
  partialConsensusMultiplier: number;
  minDataDays: { '1D': number; '1W': number; '1M': number };
  pullbackMAFast: number;
  pullbackMASlow: number;
}

export const DEFAULT_MULTI_TF_CONFIG: MultiTFConfig = {
  // 大少 21:33 confirm Decision 2: 分層 weights
  tfWeights: { '1D': 0.25, '1W': 0.35, '1M': 0.40 },

  // Consensus threshold
  consensusThreshold: 0.65,

  // Conflict penalty
  conflictConfidenceMultiplier: 0.5,         // 3 TF 唔同 → confidence * 0.5
  partialConsensusMultiplier: 0.85,           // 1 TF 唔同 → confidence * 0.85

  // Min data validation
  minDataDays: { '1D': 90, '1W': 26, '1M': 12 },

  // 大少 21:33 confirm Decision 3: 動態 MA pullback
  pullbackMAFast: 10,
  pullbackMASlow: 20,
};

// =============================================================
// MA Alignment Sub-Algorithm (v0.3.0 10 條 rule)
// =============================================================
// 跟 zmen-ma-alignment.ts 嘅 10 條 rule (A-J) 相同:
//   A. 連續 5 日 MA5 > MA60 → 上升勢 (strong)
//   B. 連續 5 日 MA5 < MA60 → 下跌勢 (strong)
//   C. 5 日裡 MA5 > MA60 但當日 low < MA60 → 橫行向下 (medium)
//   D. 5 日裡 MA5 < MA60 但當日 high > MA60 → 橫行向上 (medium)
//   F. 5 日裡 MA5+MA10 都 > MA60 但 MA5 < MA10 → 升勢調整向下 (medium)
//   G. 5 日裡 MA5+MA10 都 < MA60 但 MA5 > MA10 → 跌勢調整向上 (medium)
//   H. 7 日反轉 (3 sub-case) → 跌勢轉升勢 / 升勢轉跌勢 (strong)
//   I. 連續 5 日 low ≥ MA5 × 0.98 → 有機會長升 (weak)
//   J. 連續 5 日 high ≤ MA5 × 1.02 → 有機會長跌 (weak)
//
// State derivation priority: H > A > B > F > G > C > D > default SIDEWAYS
// Confidence: strong 0.7 / medium 0.5 / weak +0.10 bonus

function avgClose(klines: KLine[], endIdx: number, period: number): number {
  const startIdx = Math.max(0, endIdx - period + 1);
  const slice = klines.slice(startIdx, endIdx + 1);
  const sum = slice.reduce((acc, k) => acc + k.close, 0);
  return sum / slice.length;
}

function computeMAHistory(klines: KLine[], period: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < klines.length; i++) {
    out.push(avgClose(klines, i, period));
  }
  return out;
}

interface MatchedRule { id: string; label: string; strength: 'strong' | 'medium' | 'weak'; }

function detectMatchedRules(klines: KLine[], ma5: number[], ma10: number[], ma60: number[]): MatchedRule[] {
  const matched: MatchedRule[] = [];
  const win = 5;  // 連續日數
  if (klines.length < win) return matched;

  const lastN = klines.slice(-win);
  const last5MA5 = ma5.slice(-win);
  const last5MA10 = ma10.slice(-win);
  const last5MA60 = ma60.slice(-win);

  // A. 連續 5 日 MA5 > MA60
  if (last5MA5.every((m, i) => m > last5MA60[i])) {
    matched.push({ id: 'A', label: '上升勢', strength: 'strong' });
  }
  // B. 連續 5 日 MA5 < MA60
  if (last5MA5.every((m, i) => m < last5MA60[i])) {
    matched.push({ id: 'B', label: '下跌勢', strength: 'strong' });
  }
  // C. 5 日裡 MA5 > MA60 但當日 low < MA60
  let cDay = -1;
  for (let i = 0; i < win; i++) {
    if (last5MA5[i] > last5MA60[i] && lastN[i].low < last5MA60[i]) cDay = i;
  }
  if (cDay >= 0) matched.push({ id: 'C', label: '橫行向下', strength: 'medium' });
  // D. 5 日裡 MA5 < MA60 但當日 high > MA60
  let dDay = -1;
  for (let i = 0; i < win; i++) {
    if (last5MA5[i] < last5MA60[i] && lastN[i].high > last5MA60[i]) dDay = i;
  }
  if (dDay >= 0) matched.push({ id: 'D', label: '橫行向上', strength: 'medium' });
  // F. 5 日裡 MA5+MA10 > MA60 但 MA5 < MA10
  let fDay = -1;
  for (let i = 0; i < win; i++) {
    if (last5MA5[i] > last5MA60[i] && last5MA10[i] > last5MA60[i] && last5MA5[i] < last5MA10[i]) fDay = i;
  }
  if (fDay >= 0) matched.push({ id: 'F', label: '升勢調整', strength: 'medium' });
  // G. 5 日裡 MA5+MA10 < MA60 但 MA5 > MA10
  let gDay = -1;
  for (let i = 0; i < win; i++) {
    if (last5MA5[i] < last5MA60[i] && last5MA10[i] < last5MA60[i] && last5MA5[i] > last5MA10[i]) gDay = i;
  }
  if (gDay >= 0) matched.push({ id: 'G', label: '跌勢調整', strength: 'medium' });

  // H. 7 日反轉 (3 sub-case)
  const revWin = 7;
  if (klines.length >= revWin) {
    const lastNMA5 = ma5.slice(-revWin);
    const lastNMA60 = ma60.slice(-revWin);

    const upDays = (n: number) => {
      for (let i = revWin - n; i < revWin; i++) {
        if (!(lastNMA5[i] > lastNMA60[i])) return false;
      }
      for (let i = 0; i < revWin - n; i++) {
        if (!(lastNMA5[i] < lastNMA60[i])) return false;
      }
      return true;
    };
    if (upDays(1) || upDays(2) || upDays(3)) {
      matched.push({ id: 'H-reverse-up', label: '跌勢轉升勢', strength: 'strong' });
    }
    const downDays = (n: number) => {
      for (let i = revWin - n; i < revWin; i++) {
        if (!(lastNMA5[i] < lastNMA60[i])) return false;
      }
      for (let i = 0; i < revWin - n; i++) {
        if (!(lastNMA5[i] > lastNMA60[i])) return false;
      }
      return true;
    };
    if (downDays(1) || downDays(2) || downDays(3)) {
      matched.push({ id: 'H-reverse-down', label: '升勢轉跌勢', strength: 'strong' });
    }
  }

  // I. 連續 5 日 low ≥ MA5 × 0.98
  let iChance = true;
  for (let i = 0; i < win; i++) {
    const dayMA5 = last5MA5[i];
    if (lastN[i].low < dayMA5 * 0.98) { iChance = false; break; }
  }
  if (iChance) matched.push({ id: 'I', label: '有機會長升', strength: 'weak' });

  // J. 連續 5 日 high ≤ MA5 × 1.02
  let jChance = true;
  for (let i = 0; i < win; i++) {
    const dayMA5 = last5MA5[i];
    if (lastN[i].high > dayMA5 * 1.02) { jChance = false; break; }
  }
  if (jChance) matched.push({ id: 'J', label: '有機會長跌', strength: 'weak' });

  return matched;
}

function deriveState(rules: MatchedRule[]): CycleState {
  const ids = new Set(rules.map(r => r.id));
  if (ids.has('H-reverse-up') || ids.has('H-reverse-down')) return 'SIDEWAYS';  // H = TRANSITION 簡化為 SIDEWAYS
  if (ids.has('A')) return 'UP';
  if (ids.has('B')) return 'DOWN';
  if (ids.has('F')) return 'UP';
  if (ids.has('G')) return 'DOWN';
  if (ids.has('C') || ids.has('D')) return 'SIDEWAYS';
  return 'SIDEWAYS';
}

function deriveConfidence(rules: MatchedRule[]): number {
  let base = 0.5;
  if (rules.some(r => r.strength === 'strong')) base = 0.7;
  else if (rules.some(r => r.strength === 'medium')) base = 0.5;

  let conf = base;
  for (const r of rules) {
    if (r.strength === 'weak') conf += 0.10;
  }
  return Math.min(1.0, Math.round(conf * 10000) / 10000);
}

/** 跑 1 個 timeframe 嘅 MA alignment (10 條 rule) */
function runMAAlignmentForTF(klines: KLine[]): SubVerdict {
  if (klines.length < 90) {
    throw new Error(
      `[MultiTF] Insufficient data: need ≥ 90 bars, got ${klines.length}`,
    );
  }
  const recent = klines.slice(-Math.min(klines.length, 200));  // 用最近 200 條
  const ma5History = computeMAHistory(recent, 5);
  const ma10History = computeMAHistory(recent, 10);
  const ma60History = computeMAHistory(recent, 60);

  const matched = detectMatchedRules(recent, ma5History, ma10History, ma60History);
  const state = deriveState(matched);
  const confidence = deriveConfidence(matched);

  return {
    state,
    confidence,
    matched_rules: matched.map(r => r.id),
    rule_labels: matched.map(r => r.label),
    data_days: recent.length,
    ma5: round(ma5History[ma5History.length - 1], 4),
    ma10: round(ma10History[ma10History.length - 1], 4),
    ma20: round(avgClose(recent, recent.length - 1, 20), 4),
    ma60: round(ma60History[ma60History.length - 1], 4),
    current_price: recent[recent.length - 1].close,
  };
}

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// =============================================================
// Main Multi-TF Synthesizer
// =============================================================

export interface MultiTFInput {
  symbol: string;
  klines1D: KLine[];
  klines1W: KLine[];
  klines1M: KLine[];
  config?: Partial<MultiTFConfig>;
}

export function synthesizeMultiTF(input: MultiTFInput): MultiTFVerdict {
  const cfg: MultiTFConfig = { ...DEFAULT_MULTI_TF_CONFIG, ...(input.config ?? {}) };
  const { symbol, klines1D, klines1W, klines1M } = input;

  // 1. 每個 TF 跑 MA alignment
  const verdict1D = runMAAlignmentForTF(klines1D);
  const verdict1W = runMAAlignmentForTF(klines1W);
  const verdict1M = runMAAlignmentForTF(klines1M);

  // 2. 加權綜合 confidence
  const baseConfidence =
    verdict1D.confidence * cfg.tfWeights['1D'] +
    verdict1W.confidence * cfg.tfWeights['1W'] +
    verdict1M.confidence * cfg.tfWeights['1M'];

  // 3. 判定 3 個 TF 方向一致性 + final state
  const states = [verdict1D.state, verdict1W.state, verdict1M.state];
  const upCount = states.filter(s => s === 'UP').length;
  const downCount = states.filter(s => s === 'DOWN').length;
  const sidewaysCount = states.filter(s => s === 'SIDEWAYS').length;

  let state: SynthesizedState;
  let conflict: boolean;
  let warning: string | null = null;
  let consensusMultiplier: number;
  let consensus: ConsensusInfo;

  if (upCount === 3) {
    state = 'UP';
    conflict = false;
    consensusMultiplier = 1.0;
    consensus = { score: 1.0, direction: 'aligned', description: '3 個 TF 一致 UP, 順大方向' };
  } else if (downCount === 3) {
    state = 'DOWN';
    conflict = false;
    consensusMultiplier = 1.0;
    consensus = { score: 1.0, direction: 'aligned', description: '3 個 TF 一致 DOWN, 順大方向' };
  } else if (sidewaysCount === 3) {
    state = 'SIDEWAYS';
    conflict = false;
    consensusMultiplier = 1.0;
    consensus = { score: 1.0, direction: 'aligned', description: '3 個 TF 一致 SIDEWAYS, 大方向橫行' };
  } else if (upCount === 2) {
    state = 'UP';
    conflict = downCount === 1;  // 1 個 DOWN 對 2 個 UP = conflict
    consensusMultiplier = conflict ? cfg.partialConsensusMultiplier : 1.0;
    if (conflict) {
      const otherTF = states.indexOf('DOWN') === 0 ? '1D' : states.indexOf('DOWN') === 1 ? '1W' : '1M';
      warning = `⚠️ ${otherTF} 逆其他 TF (UP), 信心降低 ${((1 - cfg.partialConsensusMultiplier) * 100).toFixed(0)}%`;
      consensus = { score: 0.65, direction: 'partial', description: `2 個 TF UP, 1 個 TF DOWN (${otherTF} 逆)` };
    } else {
      consensus = { score: 0.85, direction: 'partial', description: '2 個 TF UP, 1 個 TF SIDEWAYS' };
    }
  } else if (downCount === 2) {
    state = 'DOWN';
    conflict = upCount === 1;
    consensusMultiplier = conflict ? cfg.partialConsensusMultiplier : 1.0;
    if (conflict) {
      const otherTF = states.indexOf('UP') === 0 ? '1D' : states.indexOf('UP') === 1 ? '1W' : '1M';
      warning = `⚠️ ${otherTF} 逆其他 TF (DOWN), 信心降低 ${((1 - cfg.partialConsensusMultiplier) * 100).toFixed(0)}%`;
      consensus = { score: 0.65, direction: 'partial', description: `2 個 TF DOWN, 1 個 TF UP (${otherTF} 逆)` };
    } else {
      consensus = { score: 0.85, direction: 'partial', description: '2 個 TF DOWN, 1 個 TF SIDEWAYS' };
    }
  } else {
    // 3 個 TF 完全唔同 (UP/DOWN/SIDEWAYS) → CONFLICT
    state = 'CONFLICT';
    conflict = true;
    consensusMultiplier = cfg.conflictConfidenceMultiplier;
    warning = `⚠️ 3 個 TF 唔同方向 (1D=${verdict1D.state} / 1W=${verdict1W.state} / 1M=${verdict1M.state}), 撈底風險, 唔好入場`;
    consensus = { score: 0.30, direction: 'divergent', description: '3 個 TF 完全分歧' };
  }

  const finalConfidence = +(baseConfidence * consensusMultiplier).toFixed(4);

  // 4. Cycle transitions
  const transitions: CycleTransitions = {
    turn_around: verdict1M.state === 'UP' && verdict1D.state === 'UP' && verdict1M.confidence >= 0.65,
    adjustment_complete: false,  // 簡化版, 將來可加 re-test success logic
  };

  return {
    symbol,
    timeframe: '1D',
    state,
    confidence: finalConfidence,
    conflict,
    warning,
    timeframe_verdicts: {
      '1D': verdict1D,
      '1W': verdict1W,
      '1M': verdict1M,
    },
    consensus,
    transitions,
    meta: {
      data_days_1d: verdict1D.data_days,
      data_days_1w: verdict1W.data_days,
      data_days_1m: verdict1M.data_days,
      tf_weights: cfg.tfWeights,
      sub_module: 'ma-alignment',
    },
  };
}

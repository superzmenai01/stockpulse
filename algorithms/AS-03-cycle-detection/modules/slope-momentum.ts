// modules/slope-momentum.ts — AS-03 · M8 斜率動能 (SlopeMomentum) v1.0.0
//
// 大少 2026-08-09 22:34 — Stage 2 第二次 focus (大少 14:16 揀 A drop, 22:34 confirm 4 個 A 重新開工)
//
// 4 個 design decision (大少 22:34 confirm 全 A):
//   D1: 4 state output — UP/DOWN/SIDEWAYS/TRANSITION (v1.0 spec 原本)
//   D2: 短期 slope threshold = 0.5% (1 週 1% ≈ 20% 年化, 主流 setting)
//   D3: Reversal window = 5 日 (1 週, 平衡 detection speed vs noise)
//   D4: 與 ma-alignment H rule 獨立 trigger, state 睇 priority
//
// 10 條 rule M1-M10 (跟 ma-alignment 10 條 rule A-J pattern 一致):
//   M1. slope(MA5, 5) > +0.5% 且 連續 3 日 slope(MA5, 1) ↑ → MA5 短期加速上升 (strong)
//   M2. slope(MA5, 5) < -0.5% 且 連續 3 日 slope(MA5, 1) ↓ → MA5 短期加速下跌 (strong)
//   M3. slope(MA10, 10) > +0.3%                              → MA10 中期斜率上升 (medium)
//   M4. slope(MA10, 10) < -0.3%                              → MA10 中期斜率下跌 (medium)
//   M5. slope(MA60, 20) > +0.2%                              → MA60 長期斜率上升 (medium)
//   M6. slope(MA60, 20) < -0.2%                              → MA60 長期斜率下跌 (medium)
//   M7. MA5 斜率 5 日內由負轉正 (zero-cross)                  → 短期斜率轉正 (strong)
//   M8. MA5 斜率 5 日內由正轉負 (zero-cross)                  → 短期斜率轉負 (strong)
//   M9. |slope(MA5, 5)| < 0.1%                                → 動能減弱 (weak)
//   M10. |slope(MA5, 5)| > 0.5%                               → 動能加強 (weak)
//
// State derivation: M7/M8→TRANSITION · M1/M3/M5/M10→UP · M2/M4/M6→DOWN · M9→SIDEWAYS
// Confidence: strong 0.7 / medium 0.5 / weak +0.10 bonus, cap 1.0
//
// Spec doc: docs/research/AS-03-cycle-detection/MODULE-08-SLOPE-MOMENTUM.md

// =============================================================
// Types
// =============================================================

export interface KLine {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type CycleState = 'UP' | 'DOWN' | 'SIDEWAYS' | 'TRANSITION';

export interface SlopeMomentumConfig {
  shortPeriod: number;
  midPeriod: number;
  longPeriod: number;
  shortSlopeThreshold: number;
  midSlopeThreshold: number;
  longSlopeThreshold: number;
  reversalWindow: number;
  consecutiveDays: number;
  dataWindowDays: number;
  weakMomentumThreshold: number;  // |slope(MA5, 5)| < 0.1% trigger M9
}

export const DEFAULT_SLOPE_MOMENTUM_CONFIG: SlopeMomentumConfig = {
  // 大少 22:34 confirm Decision 2: 短期 slope threshold 0.5%
  shortPeriod: 5,                  // MA5 短期
  midPeriod: 10,                   // MA10 中期
  longPeriod: 20,                  // MA20 長期 (v1.0 spec 用 20 日做 long period, 60 日太多)
  shortSlopeThreshold: 0.005,      // 0.5% (D2 揀 A)
  midSlopeThreshold: 0.003,        // 0.3%
  longSlopeThreshold: 0.002,       // 0.2%
  // 大少 22:34 confirm Decision 3: reversal window 5 日
  reversalWindow: 5,               // 5 日 (D3 揀 A)
  consecutiveDays: 3,              // 連續 3 日 (M1/M2 acceleration filter)
  dataWindowDays: 100,             // 用最近 100 日
  weakMomentumThreshold: 0.001,    // 0.1% (M9 trigger)
};

export interface SlopeMomentumVerdict {
  moduleId: 'slope-momentum';
  timeframe: string;
  state: CycleState;
  confidence: number;
  interpretation: string;
  evidence: Array<{ type: string; label: string; value: string; passed: boolean }>;
  warnings: string[];
  meta: {
    matchedRules: string[];
    ruleLabels: string[];
    latestSlopeMA5: number;
    latestSlopeMA10: number;
    latestSlopeMA60: number;
    latestMA5: number;
    latestMA10: number;
    latestMA60: number;
    dataDays: number;
    configUsed: Partial<SlopeMomentumConfig>;
  };
  timestamp: number;
}

export interface SlopeMomentumInput {
  symbol: string;
  klines: KLine[];
  config?: Partial<SlopeMomentumConfig>;
  timeframe?: string;
}

interface MatchedRule {
  id: string;
  label: string;
  strength: 'strong' | 'medium' | 'weak';
}

// =============================================================
// Helpers
// =============================================================

function avgClose(klines: KLine[], endIdx: number, period: number): number {
  const startIdx = Math.max(0, endIdx - period + 1);
  const slice = klines.slice(startIdx, endIdx + 1);
  const sum = slice.reduce((acc, k) => acc + k.close, 0);
  return sum / slice.length;
}

/**
 * slope(history, i, N) = (history[i] - history[i-N]) / history[i-N]
 * Returns 0 if i-N < 0 or denominator is 0
 */
function slope(history: number[], i: number, N: number): number {
  if (i < N) return 0;
  const denom = history[i - N];
  if (denom === 0) return 0;
  return (history[i] - history[i - N]) / denom;
}

/**
 * Check if `length` consecutive values ending at `endIdx` are increasing
 *   用 absolute EPSILON 容忍 floating point precision noise (sign-agnostic)
 *   e.g. constant +0.005 嘅 daily slope 連續 3 日 noise 會係 ±1e-15
 */
function allConsecutiveIncreasing(history: number[], endIdx: number, length: number): boolean {
  if (endIdx - length + 1 < 0) return false;
  const EPSILON = 1e-9;  // absolute tolerance
  for (let i = endIdx; i > endIdx - length + 1; i--) {
    // 真係 decreasing 過 (history[i] < history[i-1] - EPSILON) → fail
    if (history[i] < history[i - 1] - EPSILON) return false;
  }
  return true;
}

/**
 * Check if `length` consecutive values ending at `endIdx` are decreasing
 *   用 absolute EPSILON 容忍 floating point precision noise
 */
function allConsecutiveDecreasing(history: number[], endIdx: number, length: number): boolean {
  if (endIdx - length + 1 < 0) return false;
  const EPSILON = 1e-9;
  for (let i = endIdx; i > endIdx - length + 1; i--) {
    // 真係 increasing 過 (history[i] > history[i-1] + EPSILON) → fail
    if (history[i] > history[i - 1] + EPSILON) return false;
  }
  return true;
}

/**
 * Check if slope crossed zero in `window` days ending at `endIdx`
 *   direction 'positive' = 5 日內由負轉正 (M7)
 *   direction 'negative' = 5 日內由正轉負 (M8)
 */
function slopeCrossedZero(
  slopeHistory: number[],
  endIdx: number,
  window: number,
  direction: 'positive' | 'negative',
): boolean {
  const startIdx = Math.max(0, endIdx - window);
  const latestSlope = slopeHistory[endIdx];

  if (direction === 'positive') {
    if (latestSlope <= 0) return false;  // 今日斜率要正
    // window 內必須有對面 sign (曾經係負)
    for (let i = startIdx; i < endIdx; i++) {
      if (slopeHistory[i] < 0) return true;
    }
    return false;
  } else {
    if (latestSlope >= 0) return false;  // 今日斜率要負
    for (let i = startIdx; i < endIdx; i++) {
      if (slopeHistory[i] > 0) return true;
    }
    return false;
  }
}

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// =============================================================
// Main analyze function
// =============================================================

export function analyzeSlopeMomentum(input: SlopeMomentumInput): SlopeMomentumVerdict {
  const cfg: SlopeMomentumConfig = { ...DEFAULT_SLOPE_MOMENTUM_CONFIG, ...(input.config ?? {}) };
  const { klines, symbol, timeframe = '1d' } = input;

  // ============ Step 1: 數據驗證 ============
  if (!Array.isArray(klines) || klines.length < cfg.longPeriod) {
    throw new Error(
      `[SlopeMomentum] Insufficient data: need ≥ ${cfg.longPeriod} bars, got ${klines?.length ?? 0}`,
    );
  }
  const recent = klines.slice(-Math.max(klines.length, cfg.longPeriod * 5));
  // 確保至少 100 條做 MA5/MA10/MA20 + 5 日 reversal window
  const workingData = klines.slice(-Math.max(cfg.dataWindowDays, cfg.longPeriod * 5));
  const lastIdx = workingData.length - 1;

  // ============ Step 2: 計算 MA history + slope history ============
  const ma5History: number[] = [];
  const ma10History: number[] = [];
  const ma20History: number[] = [];  // 大少 M8 改用 MA20 代替 MA60 (因為 longPeriod = 20)

  for (let i = 0; i < workingData.length; i++) {
    ma5History.push(avgClose(workingData, i, cfg.shortPeriod));
    ma10History.push(avgClose(workingData, i, cfg.midPeriod));
    ma20History.push(avgClose(workingData, i, cfg.longPeriod));
  }

  // Slope history (% change)
  const slopeMA5: number[] = [];
  const slopeMA10: number[] = [];
  const slopeMA20: number[] = [];   // 跟 longPeriod 對應
  const slopeMA5Daily: number[] = [];  // N=1 連續日數 check 用

  for (let i = 0; i < workingData.length; i++) {
    slopeMA5.push(slope(ma5History, i, cfg.shortPeriod));
    slopeMA10.push(slope(ma10History, i, cfg.midPeriod));
    slopeMA20.push(slope(ma20History, i, cfg.longPeriod));
    slopeMA5Daily.push(slope(ma5History, i, 1));
  }

  const latestSlopeMA5 = slopeMA5[lastIdx];
  const latestSlopeMA10 = slopeMA10[lastIdx];
  const latestSlopeMA20 = slopeMA20[lastIdx];

  // ============ Step 3: 10 條 rule check ============
  const matchedRules: MatchedRule[] = [];

  // M1. MA5 短期加速上升 (strong)
  if (latestSlopeMA5 > cfg.shortSlopeThreshold &&
      allConsecutiveIncreasing(slopeMA5Daily, lastIdx, cfg.consecutiveDays)) {
    matchedRules.push({ id: 'M1', label: 'MA5 短期加速上升', strength: 'strong' });
  }

  // M2. MA5 短期加速下跌 (strong)
  if (latestSlopeMA5 < -cfg.shortSlopeThreshold &&
      allConsecutiveDecreasing(slopeMA5Daily, lastIdx, cfg.consecutiveDays)) {
    matchedRules.push({ id: 'M2', label: 'MA5 短期加速下跌', strength: 'strong' });
  }

  // M3. MA10 中期斜率上升 (medium)
  if (latestSlopeMA10 > cfg.midSlopeThreshold) {
    matchedRules.push({ id: 'M3', label: 'MA10 中期斜率上升', strength: 'medium' });
  }

  // M4. MA10 中期斜率下跌 (medium)
  if (latestSlopeMA10 < -cfg.midSlopeThreshold) {
    matchedRules.push({ id: 'M4', label: 'MA10 中期斜率下跌', strength: 'medium' });
  }

  // M5. MA20 長期斜率上升 (medium)
  if (latestSlopeMA20 > cfg.longSlopeThreshold) {
    matchedRules.push({ id: 'M5', label: 'MA20 長期斜率上升', strength: 'medium' });
  }

  // M6. MA20 長期斜率下跌 (medium)
  if (latestSlopeMA20 < -cfg.longSlopeThreshold) {
    matchedRules.push({ id: 'M6', label: 'MA20 長期斜率下跌', strength: 'medium' });
  }

  // M7. MA5 斜率 5 日內由負轉正 (strong) — D3 reversal window 5 日
  if (slopeCrossedZero(slopeMA5, lastIdx, cfg.reversalWindow, 'positive')) {
    matchedRules.push({ id: 'M7', label: '短期斜率轉正 (趨勢轉強)', strength: 'strong' });
  }

  // M8. MA5 斜率 5 日內由正轉負 (strong) — D3 reversal window 5 日
  if (slopeCrossedZero(slopeMA5, lastIdx, cfg.reversalWindow, 'negative')) {
    matchedRules.push({ id: 'M8', label: '短期斜率轉負 (趨勢轉弱)', strength: 'strong' });
  }

  // M9. |slope(MA5, 5)| < 0.1% → 動能減弱 (weak)
  if (Math.abs(latestSlopeMA5) < cfg.weakMomentumThreshold) {
    matchedRules.push({ id: 'M9', label: '動能減弱', strength: 'weak' });
  }

  // M10. |slope(MA5, 5)| > shortSlopeThreshold → 動能加強 (weak)
  if (Math.abs(latestSlopeMA5) > cfg.shortSlopeThreshold) {
    matchedRules.push({ id: 'M10', label: '動能加強', strength: 'weak' });
  }

  // ============ Step 4: State derivation ============
  const state = deriveState(matchedRules);

  // ============ Step 5: Confidence derivation ============
  const confidence = deriveConfidence(matchedRules);

  // ============ Output ============
  const interpretation = matchedRules.length > 0
    ? matchedRules.map((r) => r.label).join('；')
    : '無 match';

  const evidence = matchedRules.map((r) => ({
    type: `rule-${r.id}`,
    label: r.label,
    value: r.id,
    passed: true,
  }));

  return {
    moduleId: 'slope-momentum',
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
      latestSlopeMA60: round(latestSlopeMA20, 6),  // backward compat name (called MA60 in v1.0)
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
        consecutiveDays: cfg.consecutiveDays,
      },
    },
    timestamp: Date.now(),
  };
}

// =============================================================
// State + Confidence derivation (跟 ma-alignment v0.3.0 pattern 一樣)
// =============================================================

function deriveState(rules: MatchedRule[]): CycleState {
  const ids = new Set(rules.map((r) => r.id));
  // Priority 1: TRANSITION (M7/M8 zero-cross, strong)
  if (ids.has('M7') || ids.has('M8')) return 'TRANSITION';
  // Priority 2: 強 rule 決定方向 (M1 strong UP, M2 strong DOWN)
  //   強 rule 應該 dominate 弱 rule (e.g. M10 weak UP 唔應該 override M2 strong DOWN)
  const hasM1 = ids.has('M1');
  const hasM2 = ids.has('M2');
  if (hasM1 && !hasM2) return 'UP';
  if (hasM2 && !hasM1) return 'DOWN';
  if (hasM1 && hasM2) {
    // 矛盾, 揀 M1 (短期加速上升贏短期加速下跌, 因為 M1 priority 較 M2 高)
    return 'UP';
  }
  // Priority 3: medium rule 決定方向 (M3/M5 medium UP, M4/M6 medium DOWN)
  const hasM3OrM5 = ids.has('M3') || ids.has('M5');
  const hasM4OrM6 = ids.has('M4') || ids.has('M6');
  if (hasM3OrM5 && !hasM4OrM6) return 'UP';
  if (hasM4OrM6 && !hasM3OrM5) return 'DOWN';
  if (hasM3OrM5 && hasM4OrM6) {
    // 矛盾 medium, 睇多啲 UP rule 定 DOWN rule
    return (ids.has('M3') || ids.has('M5')) ? 'UP' : 'DOWN';
  }
  // Priority 4: weak rule (M10 動能加強, M9 動能減弱)
  if (ids.has('M10')) return 'UP';  // 動能加強 weak UP
  if (ids.has('M9')) return 'SIDEWAYS';  // 動能減弱 weak SIDEWAYS
  return 'SIDEWAYS';  // default
}

function deriveConfidence(rules: MatchedRule[]): number {
  let base = 0.5;
  if (rules.some((r) => r.strength === 'strong')) base = 0.7;
  else if (rules.some((r) => r.strength === 'medium')) base = 0.5;

  let conf = base;
  for (const r of rules) {
    if (r.strength === 'weak') conf += 0.10;
  }
  return Math.min(1.0, Math.round(conf * 10000) / 10000);
}

// modules/volume.ts — AS-03 · 點 5: 成交量判斷法 (VolumePrice 量價) (v1.0.0)
//
// 大少 #10809 (2026-08-06) — Module 5 實作
// 跟 quick-draft-main-agent.md Section Module 5 嘅 10 rule K-T
// D012 Option B + D020: VolumePrice 唔直接出 cycle verdict，出 confirm/disconfirm signal
//
// 算法 (10 條):
//   Step 1 — 數據驗證 (最少 30 日, 目標 100 日)
//   Step 2 — 計算 OBV (On-Balance Volume) + 5/20 日均量
//   Step 3 — 10 條 rule check (K-T):
//     K. 連續 5 日 close ↑ 且 volume ↑                              → 量價齊升確認
//     L. close 創 5 日新高但 volume < 5 日均量                       → 量價背馳（見頂警號）
//     M. 連續 5 日 close ↓ 且 volume ↑                              → 放量下跌（趨勢確認）
//     N. 連續 5 日 close ↓ 但 volume ↓                              → 縮量下跌（拋售衰竭）
//     O. OBV 創 N 日新高                                            → OBV 創新高
//     P. OBV 創 N 日新低                                            → OBV 創新低
//     Q. max_spread_pct < 2% 且 5 日均量 < 20 日均量 × shrinkThreshold → 縮量橫行整理
//     R. max_spread_pct > 3% 且 5 日均量 > 20 日均量 × boostThreshold → 放量震盪（醞釀突破）
//     S. OBV 趨勢 同 close 趨勢 背馳 (5 日 correlation < divergenceCorrelation) → 量能背馳
//     T. 5 日均量 < 20 日均量 × 0.5                                 → 量能不濟
//
// State derivation: priority K/O→UP · M/P→DOWN · L/S→TRANSITION · N/T→SIDEWAYS · Q→SIDEWAYS · R→TRANSITION
// Signal output: meta.signal = 'CONFIRM' | 'DISCONFIRM' | 'NEUTRAL' (D012 Option B + D020)

import type {
  CycleContext, CycleModule, CycleVerdict, Evidence, KLine, CycleState, SignalType,
} from '../types.ts';
import { DEFAULT_VOLUME_PRICE_CONFIG, type VolumePriceConfig } from '../config.ts';

interface MatchedRule {
  id: string;
  label: string;
  strength: 'strong' | 'medium' | 'weak';
}

export class VolumePrice implements CycleModule<KLine[]> {
  readonly id = 'volume' as const;
  readonly version = '1.0.0';  // ⬆️ 0.1.0-skeleton → 1.0.0 (大少 #10809 實作)

  private readonly cfg: VolumePriceConfig;

  constructor(config: VolumePriceConfig = DEFAULT_VOLUME_PRICE_CONFIG) {
    this.cfg = config;
  }

  async detect(klines: KLine[], ctx: CycleContext): Promise<CycleVerdict> {
    const cfg = this.cfg;

    // ============ Step 1: 數據驗證 ============
    if (klines.length < cfg.volumeLookback) {
      throw new Error(
        `[VolumePrice] Insufficient data: need ≥ ${cfg.volumeLookback} bars, got ${klines.length}`,
      );
    }
    // 用晒所有 klines (同 ma-alignment 一樣取全部)
    const recent = klines.slice(-Math.max(klines.length, cfg.volumeLookback));

    // ============ Step 2: 計算 OBV + 均量 ============
    const obvHistory: number[] = [];
    obvHistory.push(0); // OBV[0] = 0
    for (let i = 1; i < recent.length; i++) {
      const prev = recent[i - 1];
      const curr = recent[i];
      if (curr.close > prev.close) {
        obvHistory.push(obvHistory[i - 1] + curr.volume);
      } else if (curr.close < prev.close) {
        obvHistory.push(obvHistory[i - 1] - curr.volume);
      } else {
        obvHistory.push(obvHistory[i - 1]);
      }
    }

    // 5 日均量、20 日均量
    const volMA5History: number[] = [];
    const volMA20History: number[] = [];
    for (let i = 0; i < recent.length; i++) {
      volMA5History.push(this.avg(recent, i, 5, 'volume'));
      volMA20History.push(this.avg(recent, i, cfg.volumeLookback, 'volume'));
    }

    // ============ Step 3: 10 條 rule check ============
    const matchedRules: MatchedRule[] = [];

    const win = cfg.consecutiveDays;        // 5
    const last5 = recent.slice(-win);
    const last5VolMA = volMA5History.slice(-win);
    const lastClose = last5[last5.length - 1].close;
    const lastVolume = last5[last5.length - 1].volume;
    const lastOBV = obvHistory[obvHistory.length - 1];

    // K. 連續 5 日 close ↑ 且 volume ↑ → 量價齊升確認 (strong)
    if (this.allConsecutiveIncreasing(last5, 'close') &&
        this.allConsecutiveIncreasing(last5, 'volume')) {
      matchedRules.push({ id: 'K', label: '量價齊升確認', strength: 'strong' });
    }

    // L. close 創 5 日新高但 volume < 5 日均量 → 量價背馳（見頂警號）(strong)
    const last5Closes = last5.map(k => k.close);
    const maxClose5 = Math.max(...last5Closes);
    const avgVol5 = last5VolMA[last5VolMA.length - 1];
    if (lastClose === maxClose5 && lastVolume < avgVol5) {
      matchedRules.push({ id: 'L', label: '量價背馳（見頂警號）', strength: 'strong' });
    }

    // M. 連續 5 日 close ↓ 且 volume ↑ → 放量下跌（趨勢確認）(strong)
    if (this.allConsecutiveDecreasing(last5, 'close') &&
        this.allConsecutiveIncreasing(last5, 'volume')) {
      matchedRules.push({ id: 'M', label: '放量下跌（趨勢確認）', strength: 'strong' });
    }

    // N. 連續 5 日 close ↓ 但 volume ↓ → 縮量下跌（拋售衰竭）(medium)
    if (this.allConsecutiveDecreasing(last5, 'close') &&
        this.allConsecutiveDecreasing(last5, 'volume')) {
      matchedRules.push({ id: 'N', label: '縮量下跌（拋售衰竭）', strength: 'medium' });
    }

    // O. OBV 創 N 日新高 → OBV 創新高 (medium)
    if (obvHistory.length >= cfg.obvLookback + 1) {
      const prevOBV = obvHistory.slice(-cfg.obvLookback - 1, -1);
      const maxPrevOBV = Math.max(...prevOBV);
      if (lastOBV > maxPrevOBV) {
        matchedRules.push({ id: 'O', label: 'OBV 創新高', strength: 'medium' });
      }
    }

    // P. OBV 創 N 日新低 → OBV 創新低 (medium)
    if (obvHistory.length >= cfg.obvLookback + 1) {
      const prevOBV = obvHistory.slice(-cfg.obvLookback - 1, -1);
      const minPrevOBV = Math.min(...prevOBV);
      if (lastOBV < minPrevOBV) {
        matchedRules.push({ id: 'P', label: 'OBV 創新低', strength: 'medium' });
      }
    }

    // Q. max_spread_pct < 2% 且 5 日均量 < 20 日均量 × shrinkThreshold → 縮量橫行整理 (medium)
    const last5High = Math.max(...last5.map(k => k.high));
    const last5Low = Math.min(...last5.map(k => k.low));
    const last5AvgClose = last5Closes.reduce((a, b) => a + b, 0) / last5Closes.length;
    const maxSpreadPct = last5AvgClose > 0 ? (last5High - last5Low) / last5AvgClose : 0;
    const lastVolMA5 = volMA5History[volMA5History.length - 1];
    const lastVolMA20 = volMA20History[volMA20History.length - 1];
    if (maxSpreadPct < 0.02 && lastVolMA5 < lastVolMA20 * cfg.shrinkThreshold) {
      matchedRules.push({ id: 'Q', label: '縮量橫行整理', strength: 'medium' });
    }

    // R. max_spread_pct > 3% 且 5 日均量 > 20 日均量 × boostThreshold → 放量震盪（醞釀突破）(medium)
    if (maxSpreadPct > 0.03 && lastVolMA5 > lastVolMA20 * cfg.boostThreshold) {
      matchedRules.push({ id: 'R', label: '放量震盪（醞釀突破）', strength: 'medium' });
    }

    // S. OBV 趨勢 同 close 趨勢 背馳 (5 日 correlation < divergenceCorrelation) → 量能背馳 (strong)
    if (obvHistory.length >= win) {
      const corr = this.correlation(
        last5.map(k => k.close),
        obvHistory.slice(-win),
      );
      if (corr < cfg.divergenceCorrelation) {
        matchedRules.push({ id: 'S', label: '量能背馳 (OBV vs close)', strength: 'strong' });
      }
    }

    // T. 5 日均量 < 20 日均量 × 0.5 → 量能不濟 (weak)
    // (注意: shrinkThreshold = 0.8，呢度用一半 0.5 更嚴格)
    const weakShrinkThreshold = 0.5;
    if (lastVolMA5 < lastVolMA20 * weakShrinkThreshold) {
      matchedRules.push({ id: 'T', label: '量能不濟', strength: 'weak' });
    }

    // ============ Step 4: State derivation ============
    const state = this.deriveState(matchedRules);

    // ============ Step 5: Confidence derivation ============
    const confidence = this.deriveConfidence(matchedRules);

    // ============ Step 6: Signal derivation (D012 Option B + D020) ============
    const signal = this.deriveSignal(matchedRules);

    // ============ Output ============
    const interpretation = matchedRules.length > 0
      ? matchedRules.map(r => r.label).join('；')
      : '無 match';

    const evidence: Evidence[] = matchedRules.map(r => ({
      type: `rule-${r.id}`,
      label: r.label,
      value: r.id,
      passed: true,
    }));

    return {
      moduleId: this.id,
      timeframe: ctx.ltf,
      state,
      confidence,
      interpretation,
      evidence,
      warnings: [],
      meta: {
        matchedRules: matchedRules.map(r => r.id),
        ruleLabels: matchedRules.map(r => r.label),
        signal,                                    // D020 — confirm/disconfirm signal
        latestOBV: round(lastOBV, 2),
        latestVolMA5: round(lastVolMA5, 2),
        latestVolMA20: round(lastVolMA20, 2),
        latestClose: round(lastClose, 4),
        latestVolume: round(lastVolume, 2),
        maxSpreadPct: round(maxSpreadPct, 4),
        obvCorrelation: obvHistory.length >= win
          ? round(this.correlation(last5.map(k => k.close), obvHistory.slice(-win)), 4)
          : null,
        dataDays: recent.length,
        configUsed: {
          consecutiveDays: cfg.consecutiveDays,
          volumeLookback: cfg.volumeLookback,
          boostThreshold: cfg.boostThreshold,
          shrinkThreshold: cfg.shrinkThreshold,
          obvLookback: cfg.obvLookback,
          divergenceCorrelation: cfg.divergenceCorrelation,
        },
      },
      timestamp: Date.now(),
    };
  }

  // ============ Helpers ============

  private avg(klines: KLine[], endIdx: number, period: number, field: 'close' | 'volume'): number {
    const startIdx = Math.max(0, endIdx - period + 1);
    const slice = klines.slice(startIdx, endIdx + 1);
    const sum = slice.reduce((acc, k) => acc + (k[field] as number), 0);
    return sum / slice.length;
  }

  private allConsecutiveIncreasing(
    klines: KLine[],
    field: 'close' | 'volume',
  ): boolean {
    for (let i = 1; i < klines.length; i++) {
      if (!(klines[i][field] > klines[i - 1][field])) return false;
    }
    return klines.length > 1;
  }

  private allConsecutiveDecreasing(
    klines: KLine[],
    field: 'close' | 'volume',
  ): boolean {
    for (let i = 1; i < klines.length; i++) {
      if (!(klines[i][field] < klines[i - 1][field])) return false;
    }
    return klines.length > 1;
  }

  /**
   * Pearson correlation coefficient
   * 用嚟計 OBV vs close 嘅 5 日 correlation (rule S)
   */
  private correlation(xs: number[], ys: number[]): number {
    if (xs.length !== ys.length || xs.length < 2) return 0;
    const n = xs.length;
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let denX = 0;
    let denY = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - meanX;
      const dy = ys[i] - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }
    const den = Math.sqrt(denX * denY);
    return den === 0 ? 0 : num / den;
  }

  /**
   * State derivation: priority K/O→UP · M/P→DOWN · L/S→TRANSITION · N/T→SIDEWAYS · Q→SIDEWAYS · R→TRANSITION
   */
  private deriveState(rules: MatchedRule[]): CycleState {
    const ids = new Set(rules.map(r => r.id));
    if (ids.has('K') || ids.has('O')) return 'UP';
    if (ids.has('M') || ids.has('P')) return 'DOWN';
    if (ids.has('L') || ids.has('S')) return 'TRANSITION';
    if (ids.has('N') || ids.has('T')) return 'SIDEWAYS';
    if (ids.has('Q')) return 'SIDEWAYS';
    if (ids.has('R')) return 'TRANSITION';
    return 'SIDEWAYS';  // default
  }

  /**
   * Confidence derivation (同 v0.3.0 ma-alignment pattern):
   *   strong rule → 0.7
   *   medium rule → 0.5
   *   weak rule → +0.10 bonus each
   *   cap at 1.0
   */
  private deriveConfidence(rules: MatchedRule[]): number {
    let base = 0.5;
    if (rules.some(r => r.strength === 'strong')) base = 0.7;
    else if (rules.some(r => r.strength === 'medium')) base = 0.5;

    let conf = base;
    for (const r of rules) {
      if (r.strength === 'weak') conf += 0.10;
    }
    return Math.min(1.0, Math.round(conf * 10000) / 10000);
  }

  /**
   * Signal derivation (D012 Option B + D020):
   *   CONFIRM    — 量價齊升 (K) / 放量下跌 (M) / OBV 突破/跌破 (O/P)
   *   DISCONFIRM — 量價背馳 (L) / 量能背馳 (S) / 縮量下跌 (N 拋售衰竭)
   *   NEUTRAL    — 縮量橫行 (Q) / 放量震盪 (R) / 量能不濟 (T) / 無 match
   */
  private deriveSignal(rules: MatchedRule[]): SignalType {
    const ids = new Set(rules.map(r => r.id));
    // DISCONFIRM (strong/medium) — 背馳、見頂警號、拋售衰竭
    if (ids.has('L') || ids.has('S')) return 'DISCONFIRM';
    if (ids.has('N')) return 'DISCONFIRM';
    // CONFIRM (strong/medium) — 量價齊升、放量下跌、OBV 突破/跌破
    if (ids.has('K') || ids.has('M')) return 'CONFIRM';
    if (ids.has('O') || ids.has('P')) return 'CONFIRM';
    // NEUTRAL (default)
    return 'NEUTRAL';
  }
}

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export default VolumePrice;
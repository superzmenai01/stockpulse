// modules/ma-alignment.ts — AS-03 · 點 1: 均線系統週期判斷法 (v0.3.0)
//
// 大少 #10332 決定: 全部 Kimi v0.2.0 算法刪走，換上大少嘅 A-J 10 條 rule
//
// 算法 (10 條):
//   Step 1 — 數據驗證 (最少 90 日, 目標 100 日)
//   Step 2 — 計算 MA5 / MA10 / MA60 嘅歷史
//   Step 3 — 10 條 rule check:
//     A. 連續 5 日 MA5 > MA60                              → 上升勢
//     B. 連續 5 日 MA5 < MA60                              → 下跌勢
//     C. 5 日裡 MA5 > MA60 但當日 low < MA60               → 橫行向下
//     D. 5 日裡 MA5 < MA60 但當日 high > MA60              → 橫行向上
//     E. C/D 多過一日，最後一日為準                         → (隱含)
//     F. 5 日裡 MA5+MA10 > MA60 但 MA5 < MA10               → 升勢調整向下
//     G. 5 日裡 MA5+MA10 < MA60 但 MA5 > MA10               → 跌勢調整向上
//     H. 7 日反轉 (3 sub-case)                              → 跌勢轉升勢 / 升勢轉跌勢
//     I. 連續 5 日 low ≥ MA5 × (1 - 2%)                    → 有機會長升狀態
//     J. 連續 5 日 high ≤ MA5 × (1 + 2%)                   → 有機會長跌狀態
//
// 大少 #10301 (I, J typo "最最股價" → "最高股價") + #10317 typo fix 已包
// 大少 #10332 — Kimi 算法全刪，A-J 取代
//
// 設計規則: 同時成立時例晒所有 rule (大少 #10299 答問題 D)
// State derivation: priority H > A > B > F > G > C > D > default SIDEWAYS

import type { 
  CycleContext, CycleModule, CycleVerdict, Evidence, KLine, CycleState,
} from '../types.ts';
import { DEFAULT_MA_ALIGNMENT_CONFIG, type MAAlignmentConfig } from '../config.ts';

export class MAAlignmentModule implements CycleModule<KLine[]> {
  readonly id = 'ma-alignment' as const;
  readonly version = '0.3.0';  // ⬆️ 0.2.0 → 0.3.0 (大少 #10332 大改)

  private readonly cfg: MAAlignmentConfig;

  constructor(config: MAAlignmentConfig = DEFAULT_MA_ALIGNMENT_CONFIG) {
    this.cfg = config;
  }

  async detect(klines: KLine[], ctx: CycleContext): Promise<CycleVerdict> {
    const cfg = this.cfg;

    // ============ Step 1: 數據驗證 ============
    if (klines.length < cfg.minDataDays) {
      throw new Error(
        `[MAAlignment] Insufficient data: need ≥ ${cfg.minDataDays} bars, got ${klines.length}`,
      );
    }
    // 取最後 dataWindowDays 條 (< dataWindowDays 就全部用)
    const recent = klines.slice(-cfg.dataWindowDays);

    // ============ Step 2: 計算 MA 歷史 (需要 history for Case H) ============
    const ma5History: number[] = [];
    const ma10History: number[] = [];
    const ma60History: number[] = [];

    for (let i = 0; i < recent.length; i++) {
      ma5History.push(this.avgClose(recent, i, 5));   // MA5 of day i = avg(close[i-4..i])
      ma10History.push(this.avgClose(recent, i, 10)); // MA10 of day i = avg(close[i-9..i])
      ma60History.push(this.avgClose(recent, i, 60)); // MA60 of day i = avg(close[i-59..i])
    }

    // 最後 N 日
    const win = cfg.consecutiveDays;  // 5
    const last5Klines = recent.slice(-win);
    const last5MA5 = ma5History.slice(-win);
    const last5MA10 = ma10History.slice(-win);
    const last5MA60 = ma60History.slice(-win);

    // ============ Step 3: 10 條 rule check ============
    const matchedRules: { id: string; label: string; strength: 'strong' | 'medium' | 'weak' }[] = [];

    // A. 連續 5 日 MA5 > MA60 → 上升勢
    if (last5MA5.every((m, i) => m > last5MA60[i])) {
      matchedRules.push({ id: 'A', label: '上升勢', strength: 'strong' });
    }

    // B. 連續 5 日 MA5 < MA60 → 下跌勢
    if (last5MA5.every((m, i) => m < last5MA60[i])) {
      matchedRules.push({ id: 'B', label: '下跌勢', strength: 'strong' });
    }

    // C. 5 日裡出現 MA5 > MA60 但當日 low < MA60 → 橫行向下
    let lastCDay = -1;
    for (let i = 0; i < win; i++) {
      if (last5MA5[i] > last5MA60[i] && last5Klines[i].low < last5MA60[i]) {
        lastCDay = i;
      }
    }
    if (lastCDay >= 0) {
      matchedRules.push({ id: 'C', label: '橫行向下', strength: 'medium' });
    }

    // D. 5 日裡出現 MA5 < MA60 但當日 high > MA60 → 橫行向上
    let lastDDay = -1;
    for (let i = 0; i < win; i++) {
      if (last5MA5[i] < last5MA60[i] && last5Klines[i].high > last5MA60[i]) {
        lastDDay = i;
      }
    }
    if (lastDDay >= 0) {
      matchedRules.push({ id: 'D', label: '橫行向上', strength: 'medium' });
    }

    // E. C/D 多過一日，最後一日為準 (隱含: 用 lastCDay/lastDDay 已經 reflect)

    // F. 5 日裡出現 MA5+MA10 都 > MA60 但 MA5 < MA10 → 升勢調整向下
    let lastFDay = -1;
    for (let i = 0; i < win; i++) {
      if (last5MA5[i] > last5MA60[i] && last5MA10[i] > last5MA60[i] && last5MA5[i] < last5MA10[i]) {
        lastFDay = i;
      }
    }
    if (lastFDay >= 0) {
      matchedRules.push({ id: 'F', label: '升勢調整向下', strength: 'medium' });
    }

    // G. 5 日裡出現 MA5+MA10 都 < MA60 但 MA5 > MA10 → 跌勢調整向上
    let lastGDay = -1;
    for (let i = 0; i < win; i++) {
      if (last5MA5[i] < last5MA60[i] && last5MA10[i] < last5MA60[i] && last5MA5[i] > last5MA10[i]) {
        lastGDay = i;
      }
    }
    if (lastGDay >= 0) {
      matchedRules.push({ id: 'G', label: '跌勢調整向上', strength: 'medium' });
    }

    // H. 7 日趨勢反轉 (3 sub-case)
    const revWin = cfg.reversalWindowDays;  // 7
    if (recent.length >= revWin) {
      const last7MA5 = ma5History.slice(-revWin);
      const last7MA60 = ma60History.slice(-revWin);

      // 跌勢轉升勢: 1, 1+2, 或 1+2+3 日新 (上), 餘下舊 (下)
      // 1日新: index 6 (最新) > MA60, index 0-5 < MA60
      // 2日新: index 5-6 > MA60, index 0-4 < MA60
      // 3日新: index 4-6 > MA60, index 0-3 < MA60
      const upDays = (n: number) => {
        for (let i = revWin - n; i < revWin; i++) {
          if (!(last7MA5[i] > last7MA60[i])) return false;
        }
        for (let i = 0; i < revWin - n; i++) {
          if (!(last7MA5[i] < last7MA60[i])) return false;
        }
        return true;
      };
      if (upDays(1) || upDays(2) || upDays(3)) {
        matchedRules.push({ id: 'H-reverse-up', label: '跌勢轉升勢', strength: 'strong' });
      }

      // 升勢轉跌勢: 1, 1+2, 或 1+2+3 日新 (下), 餘下舊 (上)
      const downDays = (n: number) => {
        for (let i = revWin - n; i < revWin; i++) {
          if (!(last7MA5[i] < last7MA60[i])) return false;
        }
        for (let i = 0; i < revWin - n; i++) {
          if (!(last7MA5[i] > last7MA60[i])) return false;
        }
        return true;
      };
      if (downDays(1) || downDays(2) || downDays(3)) {
        matchedRules.push({ id: 'H-reverse-down', label: '升勢轉跌勢', strength: 'strong' });
      }
    }

    // I. 連續 5 日 low ≥ MA5 × (1 - threshold) → 有機會長升狀態
    let chanceRise = true;
    for (let i = 0; i < win; i++) {
      const dayMA5 = last5MA5[i];
      if (last5Klines[i].low < dayMA5 * (1 - cfg.chanceThresholdPct)) {
        chanceRise = false;
        break;
      }
    }
    if (chanceRise) {
      matchedRules.push({ id: 'I', label: '有機會長升狀態', strength: 'weak' });
    }

    // J. 連續 5 日 high ≤ MA5 × (1 + threshold) → 有機會長跌狀態
    // 大少 #10317 typo fix: 用 high 而唔係 low
    let chanceFall = true;
    for (let i = 0; i < win; i++) {
      const dayMA5 = last5MA5[i];
      if (last5Klines[i].high > dayMA5 * (1 + cfg.chanceThresholdPct)) {
        chanceFall = false;
        break;
      }
    }
    if (chanceFall) {
      matchedRules.push({ id: 'J', label: '有機會長跌狀態', strength: 'weak' });
    }

    // ============ State derivation ============
    const state = this.deriveState(matchedRules);

    // ============ Confidence derivation ============
    const confidence = this.deriveConfidence(matchedRules);

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
        latestMA5: round(ma5History[ma5History.length - 1], 4),
        latestMA10: round(ma10History[ma10History.length - 1], 4),
        latestMA60: round(ma60History[ma60History.length - 1], 4),
        dataDays: recent.length,
        configUsed: {
          dataWindowDays: cfg.dataWindowDays,
          minDataDays: cfg.minDataDays,
          consecutiveDays: cfg.consecutiveDays,
          reversalWindowDays: cfg.reversalWindowDays,
          chanceThresholdPct: cfg.chanceThresholdPct,
        },
      },
      timestamp: Date.now(),
    };
  }

  // ============ Helpers ============

  private avgClose(klines: KLine[], endIdx: number, period: number): number {
    const startIdx = Math.max(0, endIdx - period + 1);
    const slice = klines.slice(startIdx, endIdx + 1);
    const sum = slice.reduce((acc, k) => acc + k.close, 0);
    return sum / slice.length;
  }

  /**
   * State derivation: priority H > A > B > F > G > C > D > default SIDEWAYS
   * 大少 #10299 答問題 D: 同時成立時例晒所有 rule (state 仍按 priority 揀)
   */
  private deriveState(rules: { id: string }[]): CycleState {
    const ids = new Set(rules.map(r => r.id));
    if (ids.has('H-reverse-up') || ids.has('H-reverse-down')) return 'TRANSITION';
    if (ids.has('A')) return 'UP';
    if (ids.has('B')) return 'DOWN';
    if (ids.has('F')) return 'UP';   // 仲係上升，但轉弱
    if (ids.has('G')) return 'DOWN'; // 仲係下跌，但轉強
    if (ids.has('C') || ids.has('D')) return 'SIDEWAYS';
    return 'SIDEWAYS';  // default (只有 I/J 或無 match)
  }

  /**
   * Confidence derivation:
   *   strong rule (A/B/H) → 0.7
   *   medium rule (C/D/F/G) → 0.5
   *   weak rule (I/J) → +0.10 bonus each
   *   cap at 1.0
   */
  private deriveConfidence(rules: { strength: string }[]): number {
    let base = 0.5;
    if (rules.some(r => r.strength === 'strong')) base = 0.7;
    else if (rules.some(r => r.strength === 'medium')) base = 0.5;

    let conf = base;
    for (const r of rules) {
      if (r.strength === 'weak') conf += 0.10;
    }
    return Math.min(1.0, Math.round(conf * 10000) / 10000);
  }
}

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export default MAAlignmentModule;
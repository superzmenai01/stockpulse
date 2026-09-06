// modules/hl-structure.ts — AS-03 · 點 2: 高低點結構法 (Peak-Trough Structure Cycle Detector, v0.2.0)
//
// 大少 + MiniMax Code 2026-08-07 — 跟 docx `高低點結構法.docx` v2.0 spec 嘅 18 步算法落地
//
// 設計原理 (Dow Theory 基礎):
//   - 揾股價嘅 peak (山頂) 同 trough (山谷)
//   - 睇峰谷嘅排列結構 → 判斷個股係上升/下跌/橫行
//   - 多重 filter: ATR 自適應 + 加權價 + 突破確認 + 量能過濾 + 時間衰減 + 動態 tolerance
//
// 18 步算法 (詳細見 `docs/research/AS-03-cycle-detection/MODULE-02-HL-STRUCTURE.md`):
//   Step 0  輸入驗證
//   Step 1  ATR + 自適應 Window
//   Step 2  加權價格 + 動態 Tolerance
//   Step 3  識別原始極值點
//   Step 4  突破確認機制
//   Step 5  成交量過濾
//   Step 6  極值點交替化
//   Step 7  提取最近 N 組峰谷
//   Step 8  時間衰減加權
//   Step 9  趨勢分析 (峰序列 + 谷序列)
//   Step 10 結構一致性分數
//   Step 11 基礎信心指數
//   Step 12 箱體邊界 (只 sideways)
//   Step 13 形態預警檢查
//   Step 14 當前價格位置驗證
//   Step 15 極值點新鮮度檢查
//   Step 16 成交量趨勢信心調整
//   Step 17 綜合信心指數
//   Step 18 組裝輸出
//
// Output: 3-state cycle (uptrend/downtrend/sideways),唔 emit TRANSITION
//         (per D011 — TRANSITION 由 Synthesizer 判)
//
// State priority (從 verdict derive state):
//   - structure_score > 0.1  AND peak_trend=trough_trend=rising  → UP
//   - structure_score < -0.1 AND peak_trend=trough_trend=falling → DOWN
//   - 其他                                                      → SIDEWAYS

import type {
  CycleContext, CycleModule, CycleVerdict, Evidence, KLine, CycleState, ModuleStandardVerdict,
} from '../types.ts';
import { DEFAULT_HL_STRUCTURE_CONFIG, type HLStructureConfig } from '../config.ts';
import { runAndStandardize } from '../std-verdict.ts';
import { makeWarning, type ModuleWarning } from '../lib/warnings.ts';

// ============ Internal types ============

interface ExtremePoint {
  date: string;
  close: number;
  high: number;
  low: number;
  index: number;
  type: 'peak' | 'trough';
  volume: number;
  confirmed: boolean;
  weight: number;
  volumeRatio: number;
}

interface TrendResult {
  trend: 'rising' | 'falling' | 'flat' | 'mixed';
  consistency: number;        // 0-1
}

export class HLStructureModule implements CycleModule<KLine[]> {
  readonly id = 'hl-structure' as const;
  readonly version = '0.2.0';  // v0.2.0 (大少 2026-09-06 15:10): M2 self-check warning 永久 rule — 1:1 port backend v0.3.0 4 個 self-check

  private readonly cfg: HLStructureConfig;

  constructor(config: HLStructureConfig = DEFAULT_HL_STRUCTURE_CONFIG) {
    this.cfg = config;
  }

  async detect(klines: KLine[], ctx: CycleContext): Promise<CycleVerdict> {
    const cfg = this.cfg;
    const n = klines.length;

    // ============ Step 0: 輸入驗證 ============
    const minRequired = Math.max(
      (cfg.baseWindow * 2 + 1) * cfg.minPairs * 3,
      cfg.atrPeriod + cfg.baseWindow * 4,
      cfg.breakoutConfirmDays + cfg.baseWindow * 4,
    );
    if (n < minRequired) {
      throw new Error(
        `[HLStructure] Insufficient data: need ≥ ${minRequired} bars, got ${n}`,
      );
    }

    // 攞最後 dataWindowDays 條 (跟 ma-alignment 一樣)
    const dataWindowDays = (ctx.config as any)?.dataWindowDays ?? n;
    const recent = klines.slice(-Math.min(dataWindowDays, n));

    // ============ Step 1: ATR + 自適應 Window ============
    const atrValues: number[] = [];
    if (cfg.enableAtrWindow) {
      for (let i = cfg.atrPeriod; i < recent.length; i++) {
        const curr = recent[i];
        const prev = recent[i - 1];
        const tr1 = curr.high - curr.low;
        const tr2 = Math.abs(curr.high - prev.close);
        const tr3 = Math.abs(curr.low - prev.close);
        atrValues.push(Math.max(tr1, tr2, tr3));
      }
    }
    const atr = atrValues.length > 0
      ? atrValues.reduce((a, b) => a + b, 0) / atrValues.length
      : 0;

    const last20Closes = recent.slice(-20).map(k => k.close);
    const avgClose = last20Closes.reduce((a, b) => a + b, 0) / last20Closes.length;
    const volatilityRatio = avgClose > 0 ? atr / avgClose : 0;
    const adaptiveWindow = cfg.enableAtrWindow
      ? Math.max(2, Math.min(15, Math.round(cfg.baseWindow * (1 + volatilityRatio * 20))))
      : cfg.baseWindow;

    // ============ Step 2: 加權價格 + 動態 Tolerance ============
    const weighted = recent.map(k => ({
      ...k,
      weightedPrice: (k.high + k.low + k.close * 2) / 4,
    }));

    let effectiveTolerance = cfg.tolerancePct;
    if (avgClose < 10) {
      effectiveTolerance = Math.max(cfg.tolerancePct, 0.03);
    } else if (avgClose > 500) {
      effectiveTolerance = Math.min(cfg.tolerancePct, 0.008);
    }

    // ============ Step 3: 識別原始極值點 ============
    const rawExtremes: ExtremePoint[] = [];
    for (let i = adaptiveWindow; i < weighted.length - adaptiveWindow; i++) {
      const curr = weighted[i];
      const leftW = weighted.slice(i - adaptiveWindow, i).map(k => k.weightedPrice);
      const rightW = weighted.slice(i + 1, i + adaptiveWindow + 1).map(k => k.weightedPrice);
      const leftMax = Math.max(...leftW);
      const rightMax = Math.max(...rightW);
      const leftMin = Math.min(...leftW);
      const rightMin = Math.min(...rightW);

      if (curr.weightedPrice > leftMax && curr.weightedPrice > rightMax) {
        rawExtremes.push({
          date: String(curr.timestamp),
          close: curr.close,
          high: curr.high,
          low: curr.low,
          index: i,
          type: 'peak',
          volume: curr.volume,
          confirmed: false,
          weight: 1.0,
          volumeRatio: 0,
        });
      } else if (curr.weightedPrice < leftMin && curr.weightedPrice < rightMin) {
        rawExtremes.push({
          date: String(curr.timestamp),
          close: curr.close,
          high: curr.high,
          low: curr.low,
          index: i,
          type: 'trough',
          volume: curr.volume,
          confirmed: false,
          weight: 1.0,
          volumeRatio: 0,
        });
      }
    }

    // ============ Edge case: 冇 rawExtremes (完全平 data / 停牌) ============
    // Spec §6: 所有價格完全相同 → sideways, conf 0.3
    if (rawExtremes.length === 0) {
      // v0.2.0: 改 string array warnings → _warnings ModuleWarning object (永久 rule 沿用)
      const noExtremesWarnings: ModuleWarning[] = [
        makeWarning(
          'critical', 'M2', 'VERDICT_MISSING',
          '峰谷全部拎唔到 (價格完全無變化)',
          {
            issue: 'peak_count = 0 AND trough_count = 0 (價格完全無變化)',
            impact: 'Verdict 唔可信, 唔好落單, M7 應該降 M2 weight',
            fix: 'Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc',
            context: { peak_count: 0, trough_count: 0 },
          }
        ),
      ];
      return {
        moduleId: this.id,
        timeframe: ctx.ltf,
        state: 'SIDEWAYS',
        confidence: 0.3,
        interpretation: '價格完全無變化,無法識別峰谷,預設橫行',
        evidence: [{
          type: 'no-extremes',
          label: '無峰谷結構 (數據全平)',
          value: 0,
          passed: false,
        }],
        _warnings: noExtremesWarnings,
        meta: {
          cycle: 'sideways',
          cycleLabel: '橫行週期',
          baseConfidence: 0.3,
          peaks: [],
          troughs: [],
          peakTrend: 'mixed',
          troughTrend: 'mixed',
          structureScore: 0,
          weightedStructureScore: 0,
          boxBoundary: null,
          patternAlert: 'none',
          latestExtreme: null,
          pricePosition: 'between',
          adaptiveWindow,
          effectiveTolerance: round(effectiveTolerance, 6),
          adjustmentLog: ['價格完全無變化,無法識別峰谷'],
          lastDate: String(recent[recent.length - 1].timestamp),
          dataDays: recent.length,
          configUsed: { ...cfg },
        },
        timestamp: Date.now(),
      };
    }

    // ============ Step 4: 突破確認機制 ============
    const K = cfg.breakoutConfirmDays;
    for (const ext of rawExtremes) {
      const afterIdx = ext.index + 1;
      const endIdx = Math.min(ext.index + 1 + K, weighted.length - 1);
      if (afterIdx > endIdx) continue;
      const afterCandles = weighted.slice(afterIdx, endIdx + 1);

      if (ext.type === 'peak') {
        // 確認 = 後續 K 日 close 持續高過 peak close
        ext.confirmed = afterCandles.every(c => c.close > ext.close * (1 + effectiveTolerance));
      } else {
        // 確認 = 後續 K 日 close 持續低過 trough close
        ext.confirmed = afterCandles.every(c => c.close < ext.close * (1 - effectiveTolerance));
      }
    }

    // ============ Step 5: 成交量過濾 ============
    if (cfg.enableVolumeFilter) {
      for (const ext of rawExtremes) {
        const lookbackStart = Math.max(0, ext.index - cfg.volumeLookback);
        const slice = weighted.slice(lookbackStart, ext.index);
        const avgVol = slice.length > 0
          ? slice.reduce((a, b) => a + b.volume, 0) / slice.length
          : 0;
        ext.volumeRatio = avgVol > 0 ? ext.volume / avgVol : 0;
        if (ext.volumeRatio < cfg.volumeConfirmRatio) {
          ext.weight *= cfg.volumeShrinkWeightMultiplier;
        } else if (ext.volumeRatio > cfg.volumeBoostRatio) {
          ext.weight *= cfg.volumeBoostWeightMultiplier;
        }
      }
    }

    // ============ Step 6: 極值點交替化 ============
    const alternated: ExtremePoint[] = [];
    for (const ext of rawExtremes) {
      const last = alternated[alternated.length - 1];
      if (!last) {
        alternated.push(ext);
      } else if (last.type === ext.type) {
        // 連續兩個同類型,留比較顯著嗰個
        if (ext.type === 'peak' && ext.high > last.high) {
          alternated[alternated.length - 1] = ext;
        } else if (ext.type === 'trough' && ext.low < last.low) {
          alternated[alternated.length - 1] = ext;
        }
      } else {
        alternated.push(ext);
      }
    }

    if (alternated.length < cfg.minPairs * 2) {
      // 2026-08-07 — Graceful handle: 真實 K 線 noise 大,alternated 唔夠 strict 要求
      // 唔 throw,return SIDEWAYS verdict 0.5 (跟 T11 全平 data pattern)
      // v0.2.0: 改 string array warnings → _warnings ModuleWarning object (永久 rule 沿用)
      const insufficientAlternationWarnings: ModuleWarning[] = [
        makeWarning(
          'warning', 'M2', 'FALLBACK_USED',
          `峰谷總數 ${alternated.length} < ${cfg.minPairs * 2}`,
          {
            issue: `峰谷總數 ${alternated.length} < ${cfg.minPairs * 2} required`,
            impact: 'Verdict 唔可信, 唔好落單, M7 應該降 M2 weight',
            fix: 'Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc',
            context: { alternated_count: alternated.length, min_pairs: cfg.minPairs },
          }
        ),
      ];
      return {
        moduleId: this.id,
        timeframe: ctx.ltf,
        state: 'SIDEWAYS',
        confidence: 0.5,
        interpretation: `峰谷結構唔夠清晰 (只有 ${alternated.length} 個交替峰谷,需要至少 ${cfg.minPairs * 2}),預設橫行`,
        evidence: [{
          type: 'insufficient-alternation',
          label: `峰谷數量不足 (${alternated.length} < ${cfg.minPairs * 2})`,
          value: alternated.length,
          threshold: cfg.minPairs * 2,
          passed: false,
        }],
        _warnings: insufficientAlternationWarnings,
        meta: {
          cycle: 'sideways',
          cycleLabel: '橫行週期',
          baseConfidence: 0.5,
          peaks: [],
          troughs: [],
          peakTrend: 'mixed',
          troughTrend: 'mixed',
          structureScore: 0,
          weightedStructureScore: 0,
          boxBoundary: null,
          patternAlert: 'none',
          latestExtreme: null,
          pricePosition: 'between',
          adaptiveWindow,
          effectiveTolerance: round(effectiveTolerance, 6),
          adjustmentLog: [`峰谷結構唔夠清晰 (${alternated.length} < ${cfg.minPairs * 2})`],
          lastDate: String(recent[recent.length - 1].timestamp),
          dataDays: recent.length,
          configUsed: { ...cfg },
        },
        timestamp: Date.now(),
      };
    }

    // ============ Step 7: 提取最近 N 組峰谷 ============
    // 攞最後 minPairs 對 peak + minPairs 對 trough
    const peaks = alternated.filter(e => e.type === 'peak').slice(-cfg.minPairs);
    const troughs = alternated.filter(e => e.type === 'trough').slice(-cfg.minPairs);

    // ============ Step 8: 時間衰減加權 ============
    const lastIdx = weighted.length - 1;
    for (const ext of [...peaks, ...troughs]) {
      const daysAgo = lastIdx - ext.index;
      ext.weight *= Math.exp(-cfg.timeDecayLambda * daysAgo);
    }

    // ============ Step 9: 趨勢分析 ============
    const peakTrend = this.analyzeTrend(peaks.map(p => p.close), effectiveTolerance);
    const troughTrend = this.analyzeTrend(troughs.map(t => t.close), effectiveTolerance);

    // ============ Step 10: 結構一致性分數 ============
    let candidate: 'uptrend' | 'downtrend' | 'sideways';
    let structureScore: number;
    let weightedStructureScore: number;

    const peakConsistency = peakTrend.consistency;
    const troughConsistency = troughTrend.consistency;
    const avgConsistency = (peakConsistency + troughConsistency) / 2;

    if (peakTrend.trend === 'rising' && troughTrend.trend === 'rising') {
      candidate = 'uptrend';
      structureScore = avgConsistency;
      weightedStructureScore = avgConsistency;
    } else if (peakTrend.trend === 'falling' && troughTrend.trend === 'falling') {
      candidate = 'downtrend';
      structureScore = -avgConsistency;
      weightedStructureScore = -avgConsistency;
    } else {
      candidate = 'sideways';
      const rawPeakCons = Math.abs(peakConsistency);
      const rawTroughCons = Math.abs(troughConsistency);
      structureScore = 1.0 - (rawPeakCons + rawTroughCons) / 2;
      weightedStructureScore = structureScore;
    }

    // ============ Step 11: 基礎信心指數 ============
    let baseConfidence: number;
    if (candidate === 'uptrend' || candidate === 'downtrend') {
      baseConfidence = (weightedStructureScore + 1) / 2;
      baseConfidence = Math.max(0, Math.min(1, baseConfidence));
      const pairBonus = Math.min(1, (peaks.length - 2) / 3);
      baseConfidence = baseConfidence * 0.7 + pairBonus * 0.3;
    } else {
      const allCloses = [...peaks.map(p => p.close), ...troughs.map(t => t.close)];
      const rangeMax = Math.max(...allCloses);
      const rangeMin = Math.min(...allCloses);
      const avgAll = allCloses.reduce((a, b) => a + b, 0) / allCloses.length;
      const rangePct = avgAll > 0 ? (rangeMax - rangeMin) / avgAll : 0;
      baseConfidence = Math.max(0.3, 1.0 - rangePct / (effectiveTolerance * 4));
    }

    // ============ Step 12: 箱體邊界 ============
    let boxBoundary: { top: number; bottom: number; mid: number; heightPct: number } | null = null;
    if (candidate === 'sideways') {
      const boxTop = Math.max(...peaks.map(p => p.close));
      const boxBottom = Math.min(...troughs.map(t => t.close));
      const boxMid = (boxTop + boxBottom) / 2;
      const boxHeightPct = boxMid > 0 ? (boxTop - boxBottom) / boxMid : 0;
      boxBoundary = {
        top: round(boxTop, 2),
        bottom: round(boxBottom, 2),
        mid: round(boxMid, 2),
        heightPct: round(boxHeightPct, 4),
      };
    }

    // ============ Step 13: 形態預警 ============
    let patternAlert: 'head_and_shoulder' | 'double_bottom' | 'double_top' | 'none' = 'none';
    let reasonBase = `判定: ${candidate === 'uptrend' ? '上升' : candidate === 'downtrend' ? '下跌' : '橫行'}`;

    if (cfg.enablePatternAlert && peaks.length >= 3 && troughs.length >= 2) {
      // 頭肩頂: 3 個 peak, 中間最高
      if (peaks.length >= 3) {
        const last3Peaks = peaks.slice(-3);
        const symTol = effectiveTolerance * cfg.patternSymmetryTolerance;
        if (
          last3Peaks[1].close > last3Peaks[0].close &&
          last3Peaks[1].close > last3Peaks[2].close &&
          Math.abs(last3Peaks[0].close - last3Peaks[2].close) / last3Peaks[1].close < symTol
        ) {
          patternAlert = 'head_and_shoulder';
          reasonBase += '；出現頭肩頂形態預警';
        }
      }
      // 雙底: 3 個 trough, 兩邊低, 中間反彈
      if (patternAlert === 'none' && troughs.length >= 3) {
        const last3Troughs = troughs.slice(-3);
        const symTol = effectiveTolerance * cfg.patternSymmetryTolerance;
        if (
          Math.abs(last3Troughs[0].close - last3Troughs[2].close) / last3Troughs[1].close < symTol &&
          last3Troughs[1].close > last3Troughs[0].close
        ) {
          patternAlert = 'double_bottom';
          reasonBase += '；出現雙底形態預警';
        }
      }
      // 雙頂: 3 個 peak, 兩邊高, 中間回調
      if (patternAlert === 'none' && peaks.length >= 3) {
        const last3Peaks = peaks.slice(-3);
        const symTol = effectiveTolerance * cfg.patternSymmetryTolerance;
        if (
          Math.abs(last3Peaks[0].close - last3Peaks[2].close) / last3Peaks[1].close < symTol &&
          last3Peaks[1].close < last3Peaks[0].close
        ) {
          patternAlert = 'double_top';
          reasonBase += '；出現雙頂形態預警';
        }
      }
    }

    // ============ Step 14: 當前價格位置驗證 ============
    const latestPrice = weighted[weighted.length - 1].close;
    const latestPeak = peaks[peaks.length - 1];
    const latestTrough = troughs[troughs.length - 1];
    const latestExtreme = alternated[alternated.length - 1];
    const daysAgo = lastIdx - latestExtreme.index;

    let pricePosition: 'above_peak' | 'below_trough' | 'between' | 'broken';
    if (latestPrice > latestPeak.close * (1 + effectiveTolerance)) {
      pricePosition = 'above_peak';
    } else if (latestPrice < latestTrough.close * (1 - effectiveTolerance)) {
      pricePosition = 'below_trough';
    } else if (latestPrice >= latestTrough.close && latestPrice <= latestPeak.close) {
      pricePosition = 'between';
    } else {
      pricePosition = 'broken';
    }

    const adjustmentLog: string[] = [];
    let confidenceMultiplier = 1.0;

    if (candidate === 'uptrend') {
      if (pricePosition === 'below_trough') {
        adjustmentLog.push('當前價格跌破最近谷點,上升趨勢可能已破壞');
        confidenceMultiplier *= 0.4;
      } else if (pricePosition === 'between' && latestExtreme.type === 'peak') {
        adjustmentLog.push('價格處於回調階段,尚未確認趨勢延續');
        confidenceMultiplier *= 0.85;
      }
    } else if (candidate === 'downtrend') {
      if (pricePosition === 'above_peak') {
        adjustmentLog.push('當前價格突破最近峰點,下跌趨勢可能已反轉');
        confidenceMultiplier *= 0.4;
      } else if (pricePosition === 'between' && latestExtreme.type === 'trough') {
        adjustmentLog.push('價格處於反彈階段,尚未確認趨勢延續');
        confidenceMultiplier *= 0.85;
      }
    } else { // sideways
      if (pricePosition === 'above_peak') {
        adjustmentLog.push('價格突破箱體上沿,可能即將脫離橫行');
        confidenceMultiplier *= 0.7;
      } else if (pricePosition === 'below_trough') {
        adjustmentLog.push('價格跌破箱體下沿,可能即將脫離橫行');
        confidenceMultiplier *= 0.7;
      }
    }

    // ============ Step 15: 極值點新鮮度檢查 ============
    if (daysAgo > cfg.maxExtremeAgeDays) {
      const freshness = Math.max(
        cfg.freshnessMinMultiplier,
        1.0 - (daysAgo - cfg.maxExtremeAgeDays) / cfg.freshnessDecayDays,
      );
      confidenceMultiplier *= freshness;
      adjustmentLog.push(`最新極值點距今 ${daysAgo} 天,結構信號老化`);
    }

    // ============ Step 16: 成交量趨勢信心調整 ============
    if (cfg.enableVolumeFilter) {
      const recentExt = [...peaks.slice(-2), ...troughs.slice(-2)];
      const volRatios = recentExt.map(e => e.volumeRatio).filter(r => r > 0);
      if (volRatios.length > 0) {
        const avgVolRatio = volRatios.reduce((a, b) => a + b, 0) / volRatios.length;
        if (candidate === 'uptrend') {
          if (avgVolRatio < 0.8) {
            adjustmentLog.push('近期極值點多為縮量,上升動能可能不足');
            confidenceMultiplier *= Math.max(0.6, avgVolRatio);
          } else if (avgVolRatio > 1.3) {
            adjustmentLog.push('近期極值點放量確認,趨勢強勁');
            confidenceMultiplier *= Math.min(1.15, 1.0 + (avgVolRatio - 1.0) * 0.3);
          }
        } else if (candidate === 'downtrend') {
          if (avgVolRatio > 1.2) {
            adjustmentLog.push('放量下跌,趨勢確認');
          } else if (avgVolRatio < 0.8) {
            adjustmentLog.push('縮量下跌,動能可能衰竭');
            confidenceMultiplier *= Math.max(0.7, avgVolRatio);
          }
        } else { // sideways
          if (avgVolRatio < 0.7) {
            adjustmentLog.push('縮量整理,橫行信號增強');
            confidenceMultiplier *= 1.1;
          } else if (avgVolRatio > 1.3) {
            adjustmentLog.push('放量震盪,可能醞釀突破');
            confidenceMultiplier *= 0.8;
          }
        }
      }
    }

    // ============ Step 17: 綜合信心指數 ============
    const confidence = Math.max(0, Math.min(1, baseConfidence * confidenceMultiplier));

    // ============ v0.2.0 self-check 5 條件 (大少 2026-09-06 14:25 trigger) ============
    // 凡人話: M2 算法自己診斷 verdict 係咪可信, 5 個條件 emit system 警告
    // 通知 M7/M8/M9 呢個 M2 verdict 唔好用, M7 自動降 weight 0.15→0.05 + banner 提示
    // Frontend v0.1.0 冇 Step 16/17 override 邏輯, 所以 self-check #3 (5年vs短線矛盾) frontend skip
    // 1:1 port backend hl_structure/algorithm.py v0.3.0 4 個 self-check (1, 2, 4, 5)
    const m2Warnings: ModuleWarning[] = [];

    // Self-check 1: 形態預警 (跟 backend v0.3.0 對齊)
    if (patternAlert === 'head_and_shoulder' || patternAlert === 'double_top' || patternAlert === 'double_bottom') {
      m2Warnings.push(makeWarning(
        'warning', 'M2', 'CONFLICT_STATE',
        `形態預警: ${patternAlert}`,
        {
          issue: `最近 3 個峰/谷出現 ${patternAlert} 形態, 結構可能反轉`,
          impact: 'Verdict 唔可信, M2 判嘅 cycle state 可能快將反轉, M7 應該降 M2 weight',
          fix: '確認 Step 16 短線 mode 結果, 如有 override 觸發可能要等下一個 peak/谷 confirm',
          context: {
            pattern_alert: patternAlert,
            peaks_count: peaks.length,
            troughs_count: troughs.length,
          },
        }
      ));
    }

    // Self-check 2: 極值點新鮮度 (Step 15 freshness 折扣 → DATA_AGE info warning)
    if (daysAgo > cfg.maxExtremeAgeDays) {
      const freshness = Math.max(
        cfg.freshnessMinMultiplier,
        1.0 - (daysAgo - cfg.maxExtremeAgeDays) / cfg.freshnessDecayDays,
      );
      m2Warnings.push(makeWarning(
        'info', 'M2', 'DATA_AGE',
        `極值點距今 ${daysAgo} 日 (max ${cfg.maxExtremeAgeDays} 日)`,
        {
          issue: `最新 peak/trough 已經 ${daysAgo} 日前, freshness multiplier 折扣到 ${freshness.toFixed(4)}`,
          impact: '結構信號老化, Verdict 信心打折, M7 應該降 M2 嘅 base_weight',
          fix: '等下一個新 peak/trough 出現再 re-run',
          context: {
            days_ago: daysAgo,
            max_extreme_age: cfg.maxExtremeAgeDays,
            freshness_multiplier: Number(freshness.toFixed(4)),
          },
        }
      ));
    }

    // Self-check 4: 信心指數過低 (final confidence < 0.3)
    if (confidence < 0.3) {
      m2Warnings.push(makeWarning(
        'warning', 'M2', 'THRESHOLD_BREACH',
        `M2 信心指數 ${confidence.toFixed(4)} < 0.3 threshold`,
        {
          issue: `信心 ${confidence.toFixed(4)} 過低, structure score 唔夠強, base_confidence 折扣大`,
          impact: 'Verdict 可信度低, M7 應該降低 M2 嘅 base_weight',
          fix: '等結構信號更明顯先 re-run, 或 increase dataWindowDays',
          context: {
            confidence: Number(confidence.toFixed(4)),
            base_confidence: Number(baseConfidence.toFixed(4)),
            structure_score: Number(structureScore.toFixed(4)),
          },
        }
      ));
    }

    // Self-check 5: 結構破壞 (Step 14 price_position = "broken")
    if (pricePosition === 'broken') {
      m2Warnings.push(makeWarning(
        'warning', 'M2', 'CONFLICT_STATE',
        '當前價格已經破壞最近峰谷結構',
        {
          issue: `價格 ${latestPrice.toFixed(2)} 已經離開最近 peak ${latestPeak.close.toFixed(2)} / trough ${latestTrough.close.toFixed(2)} 範圍`,
          impact: '峰谷結構信號失效, M2 verdict 唔可信, 要等新 peak/trough 形成',
          fix: 'Re-run / 等新結構形成',
          context: {
            latest_price: Number(latestPrice.toFixed(4)),
            latest_peak_close: Number(latestPeak.close.toFixed(4)),
            latest_trough_close: Number(latestTrough.close.toFixed(4)),
          },
        }
      ));
    }

    // ============ Step 18: 組裝輸出 ============
    // 3-state → 4-state mapping (D011)
    let state: CycleState;
    if (candidate === 'uptrend') state = 'UP';
    else if (candidate === 'downtrend') state = 'DOWN';
    else state = 'SIDEWAYS';

    const cycleLabel = candidate === 'uptrend' ? '上升週期'
      : candidate === 'downtrend' ? '下跌週期' : '橫行週期';

    const finalReason = adjustmentLog.length > 0
      ? `${reasonBase}；${adjustmentLog.join('；')}`
      : reasonBase;

    // Build evidence
    const evidence: Evidence[] = [
      {
        type: 'peak-trough-structure',
        label: `${peaks.length} 峰 + ${troughs.length} 谷`,
        value: `${peaks.length + troughs.length}`,
        passed: true,
      },
      {
        type: 'peak-trend',
        label: `峰序列: ${peakTrend.trend}`,
        value: peakTrend.trend,
        passed: peakTrend.trend === 'rising' || peakTrend.trend === 'falling',
      },
      {
        type: 'trough-trend',
        label: `谷序列: ${troughTrend.trend}`,
        value: troughTrend.trend,
        passed: troughTrend.trend === 'rising' || troughTrend.trend === 'falling',
      },
      {
        type: 'pattern-alert',
        label: patternAlert === 'none' ? '無形態預警' : `形態預警: ${patternAlert}`,
        value: patternAlert,
        passed: patternAlert === 'none' || patternAlert === 'double_bottom', // H&S / double_top are reversal warnings
      },
    ];

    return {
      moduleId: this.id,
      timeframe: ctx.ltf,
      state,
      confidence: round(confidence, 4),
      interpretation: finalReason,
      evidence,
      _warnings: m2Warnings,
      meta: {
        cycle: candidate,
        cycleLabel,
        baseConfidence: round(baseConfidence, 4),
        peaks,
        troughs,
        peakTrend: peakTrend.trend,
        troughTrend: troughTrend.trend,
        structureScore: round(structureScore, 4),
        weightedStructureScore: round(weightedStructureScore, 4),
        boxBoundary,
        patternAlert,
        latestExtreme: {
          type: latestExtreme.type,
          date: latestExtreme.date,
          close: latestExtreme.close,
          index: latestExtreme.index,
          daysAgo,
          confirmed: latestExtreme.confirmed,
        },
        pricePosition,
        adaptiveWindow,
        effectiveTolerance: round(effectiveTolerance, 6),
        adjustmentLog,
        lastDate: String(recent[recent.length - 1].timestamp),
        dataDays: recent.length,
        configUsed: { ...cfg },
      },
      timestamp: Date.now(),
    };
  }

  // ============ Helpers ============

  private analyzeTrend(values: number[], tolerance: number): TrendResult {
    if (values.length < 2) {
      return { trend: 'mixed', consistency: 0 };
    }

    let risingCount = 0;
    let fallingCount = 0;
    const totalDiff = values.length - 1;

    for (let i = 1; i < values.length; i++) {
      if (values[i] > values[i - 1]) risingCount++;
      else if (values[i] < values[i - 1]) fallingCount++;
    }

    const risingPct = risingCount / totalDiff;
    const fallingPct = fallingCount / totalDiff;

    // 計算一致性 (linear regression R² simplified)
    const consistency = Math.max(risingPct, fallingPct);

    // 計算整體趨勢 (start vs end)
    const startVal = values[0];
    const endVal = values[values.length - 1];
    const overallChange = (endVal - startVal) / startVal;

    if (risingPct >= 0.7 && overallChange > tolerance) {
      return { trend: 'rising', consistency };
    } else if (fallingPct >= 0.7 && overallChange < -tolerance) {
      return { trend: 'falling', consistency };
    } else if (consistency > 0.6 && Math.abs(overallChange) < tolerance) {
      return { trend: 'flat', consistency };
    }
    return { trend: 'mixed', consistency };
  }
}

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export default HLStructureModule;

// =============================================================
// 大少 2026-08-08 12:00 — Sprint 1 sub-task 1.1 — M7 standard verdict wrapper
// =============================================================
/** M2 HL Structure 嘅 standard verdict wrapper
 *  @example
 *    const sv = await toStandardVerdictHL(klines, { symbol: 'HK.00700', ltf: '1d' });
 *    console.log(sv.base_weight);  // 0.15
 */
export async function toStandardVerdictHL(
  klines: KLine[],
  ctx: CycleContext,
  config: HLStructureConfig = DEFAULT_HL_STRUCTURE_CONFIG,
): Promise<ModuleStandardVerdict> {
  return runAndStandardize(new HLStructureModule(config), klines, ctx, 'hl-structure');
}

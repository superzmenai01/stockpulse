// modules/volume.ts — AS-03 · 點 5: 成交量價格行為確認法 (Volume-Price Action Confirmation) v2.0
//
// 大少 2026-08-07 — Module 5 v2.0 overwrite (由 v1.0 嘅 10 rule K-T 改為 v2.0 嘅 15 rule V1-V15)
// 對應 docx: `docs/演算法概念SPECS/05成交量價格行為確認法.docx` v2.0
// Spec doc: `docs/research/AS-03-cycle-detection/MODULE-05-VOLUME-PRICE-V2.md`
//
// v1.0 → v2.0 嘅 9 個根治:
//   1. 突破只看單日成交量 → 連續三日模式 + Z-Score 過濾
//   2. 縮量回調太簡單 → 回調深度-成交量相關係數
//   3. OBV 簡單加減 → 價格變化幅度加權 (Tanh)
//   4. 密集區固定 1% → ATR 動態分箱
//   5. 量价背馳固定 5 日 → 滾動 Pearson 相關 + 衰減
//   6. 無換手率 → 歷史百分位 + turnover rate
//   7. 假突破無驗證 → 突破後 N 日回撤 + 籌碼鎖定度
//   8. 線性評分 → 決策規則引擎 (5 buy + 4 減分)
//   9. 無視大盤波動 → 相對波動率 (M6 處理)
//
// 15 條 rule V1-V15 (對應 spec §5 Step 11):
//   V1  ATR 波動充足         V9  溫和堆量突破
//   V2  VWAP 支撐            V10 放量突破確認
//   V3  成交量百分位正常     V11 縮量突破警告
//   V4  連續堆量             V12 假突破識別
//   V5  異常爆量過濾         V13 健康回調
//   V6  加權 OBV 上升        V14 拋售拋壓
//   V7  加權 OBV 下跌        V15 量价背馳
//   V8  OBV 與價格同向
//
// State derivation:
//   cycle: uptrend if buyTimingScore >= 0.55 / downtrend if volumeRegime==distribution / sideways
//   signal: CONFIRM / DISCONFIRM / NEUTRAL (供 M1 alignment 使用)

import type {
  CycleContext, CycleModule, CycleVerdict, KLine, SignalType,
} from '../types.ts';
import { DEFAULT_VOLUME_PRICE_CONFIG, type VolumePriceConfig } from '../config.ts';

interface MatchedRule {
  id: string;
  label: string;
  strength: 'strong' | 'medium' | 'weak';
}

type VolumeRegime = 'accumulation' | 'distribution' | 'neutral';
type BreakoutPattern = 'gradual_buildup' | 'sustained_surge' | 'single_spike' | 'low_volume' | 'none';

export class VolumePrice implements CycleModule<KLine[]> {
  readonly id = 'volume' as const;
  readonly version = '2.0.0';  // ⬆️ 1.0.0 → 2.0.0 (大少 2026-08-07 overwrite)

  private readonly cfg: VolumePriceConfig;

  constructor(config: VolumePriceConfig = DEFAULT_VOLUME_PRICE_CONFIG) {
    this.cfg = config;
  }

  async detect(klines: KLine[], ctx: CycleContext): Promise<CycleVerdict> {
    const cfg = this.cfg;
    const symbol = ctx.symbol;

    // ============ Step 0: 輸入驗證 ============
    const minData = Math.max(80, cfg.volumePercentileLookback + cfg.vwapPeriod + cfg.breakoutConfirmDays + 20);
    if (klines.length < minData) {
      return {
        moduleId: 'volume',
        timeframe: ctx.ltf,
        state: 'SIDEWAYS',
        confidence: 0,
        interpretation: `[VolumePrice v2.0] 數據不足: need ≥ ${minData} bars, got ${klines.length}`,
        evidence: [],
        warnings: [`數據不足 (${klines.length}/${minData})`],
        meta: { dataDays: klines.length, configUsed: cfg },
        timestamp: Date.now(),
      };
    }

    // 用晒所有 klines
    const recent = klines.slice(-Math.max(klines.length, minData));
    const n = recent.length;
    const lastIdx = n - 1;
    const lastBar = recent[lastIdx];
    const currentPrice = lastBar.close;

    // ============ Step 1: 計算基礎指標 ============
    // ATR (Wilder 14 日)
    const atrValue = this.computeATR(recent, 14);

    // VWAP (過去 vwapPeriod 日)
    const vwapValue = this.computeVWAP(recent, cfg.vwapPeriod);

    // Volume percentile (過去 volumePercentileLookback 日)
    const volPercentile = this.computeVolumePercentile(recent, cfg.volumePercentileLookback);

    // Turnover rate (如有股本 - 從 external signal 拿)
    const sharesOutstanding = (ctx as any).sharesOutstanding ?? null;
    const turnoverRate = sharesOutstanding ? lastBar.volume / sharesOutstanding : null;

    // ============ Step 2: 成交量標準差過濾 ============
    const vol20 = recent.slice(-20).map(k => k.volume);
    const volMean20 = vol20.reduce((a, b) => a + b, 0) / 20;
    const volStd20 = Math.sqrt(vol20.reduce((acc, v) => acc + (v - volMean20) ** 2, 0) / 20);
    const volZScore = volStd20 > 0 ? (lastBar.volume - volMean20) / volStd20 : 0;

    const prevVol1 = n >= 3 ? recent[n - 2].volume : 0;
    const prevVol2 = n >= 3 ? recent[n - 3].volume : 0;
    // isAnomalySpike: Z-Score > 3 AND 前 2 日唔高 AND 今日 ≥ 5x 均量 (避免 gradual buildup 被誤判)
    const isAnomalySpike = volZScore > 3.0
      && prevVol1 < volMean20 * 1.5
      && prevVol2 < volMean20 * 1.5
      && lastBar.volume >= volMean20 * 5;

    // 連續放量日數
    let consecutiveSurge = 0;
    for (let i = lastIdx; i >= Math.max(0, lastIdx - 9); i--) {
      const dayVolRatio = recent[i].volume / volMean20;
      if (dayVolRatio >= 1.3) consecutiveSurge++;
      else break;
    }
    const isSustainedVolume = consecutiveSurge >= cfg.volumeSurgeMinDays && !isAnomalySpike;

    // ============ Step 3: 加權 OBV (Tanh) ============
    const weightedObv: number[] = [0];
    for (let i = 1; i < n; i++) {
      const priceChangePct = (recent[i].close - recent[i - 1].close) / recent[i - 1].close;
      const weight = Math.tanh(priceChangePct * 10);  // 映射 -1~1, 10% 接近飽和
      weightedObv.push(weightedObv[i - 1] + recent[i].volume * weight);
    }

    // OBV SMA 20
    const obvSma20 = this.computeSMA(weightedObv, 20);
    const obvTrend: 'rising' | 'falling' | 'flat' =
      weightedObv[lastIdx] > obvSma20[lastIdx] * 1.03 ? 'rising' :
      weightedObv[lastIdx] < obvSma20[lastIdx] * 0.97 ? 'falling' : 'flat';

    // OBV 與 close 20 日相關係數
    const recentCloses = recent.slice(-20).map(k => k.close);
    const recentObv = weightedObv.slice(-20);
    const obvPriceCorr = this.pearsonCorrelation(recentCloses, recentObv);

    // ============ Step 4: 放量突破檢測 (4 種模式) ============
    const last20Closes = recent.slice(-20).map(k => k.close);
    const recent20High = Math.max(...last20Closes);  // 用 close 而唔係 high (避免 high 過 close 嘅 false negative)
    const last40Closes = recent.slice(-40, -20).map(k => k.close);
    const prevPeriodHigh = last40Closes.length > 0 ? Math.max(...last40Closes) : recent20High;

    // isPriceBreakout: 最近 (breakoutConfirmDays + 1) 日內有 close > recent20High × 0.998
    // 唔係「最後一日」(容許「曾經突破但回撤」嘅 case 識別假突破)
    const breakoutWindow = recent.slice(-(cfg.breakoutConfirmDays + 1)).map(k => k.close);
    const maxCloseInBreakoutWindow = Math.max(...breakoutWindow);
    const isPriceBreakout = maxCloseInBreakoutWindow > recent20High * 0.998;

    let breakoutPattern: BreakoutPattern = 'none';
    let breakoutStrength = 0;
    let falseBreakoutRisk = 0;

    if (isPriceBreakout && n >= 4) {
      // 用 7 日 baseline (n-9 to n-2) 計算 pre_avg, 唔係 3 日 avg (數學陷阱)
      const baseline7 = recent.slice(n - 9, n - 2).map(k => k.volume);
      const preAvg = baseline7.reduce((a, b) => a + b, 0) / baseline7.length;
      const preBreakoutVols = [recent[n - 4].volume, recent[n - 3].volume, recent[n - 2].volume];
      const breakoutVols = [recent[n - 2].volume, lastBar.volume];

      // 模式 A: 溫和堆量 (最可信)
      // pre_breakout 3 日 vol 全部 > 7 日 baseline × 1.1
      const gradualBuildup = preBreakoutVols.every(v => v > preAvg * 1.1)
        && lastBar.volume > preAvg * 1.5
        && !isAnomalySpike;

      // 模式 B: 持續放量
      const surgeBreakout = lastBar.volume > preAvg * 2.0
        && consecutiveSurge >= 2;

      if (gradualBuildup) {
        breakoutPattern = 'gradual_buildup';
        breakoutStrength = 0.9;
      } else if (surgeBreakout && !isAnomalySpike) {
        breakoutPattern = 'sustained_surge';
        breakoutStrength = 0.75;
      } else if (lastBar.volume > preAvg * 1.5) {
        breakoutPattern = 'single_spike';
        breakoutStrength = 0.4;
        falseBreakoutRisk = 0.4;
      } else {
        breakoutPattern = 'low_volume';
        breakoutStrength = 0.15;
        falseBreakoutRisk = 0.7;
      }

      // 假突破二次驗證
      if (breakoutStrength >= 0.4 && n >= cfg.breakoutConfirmDays + 1) {
        const postBreakoutLows = recent.slice(-cfg.breakoutConfirmDays).map(k => k.low);
        const postBreakoutLow = Math.min(...postBreakoutLows);
        const breakoutLevel = recent20High;
        const range = breakoutLevel - prevPeriodHigh > 0 ? breakoutLevel - prevPeriodHigh : 1;
        const retracePct = (breakoutLevel - postBreakoutLow) / range;

        if (retracePct > cfg.falseBreakoutRetracePct) {
          falseBreakoutRisk += 0.3;
        }
      }
    }

    const isBreakoutConfirmed: boolean | 'pending' = breakoutPattern === 'none'
      ? false
      : breakoutStrength < 0.4
        ? false
        : n < cfg.breakoutConfirmDays + 1
          ? 'pending'
          : (falseBreakoutRisk < 0.6);

    // ============ Step 5: 回調健康度 ============
    const last20 = recent.slice(-20);
    let recentPeakIdx = 0;
    let recentPeakPrice = last20[0].close;
    for (let i = 1; i < last20.length; i++) {
      if (last20[i].close > recentPeakPrice) {
        recentPeakPrice = last20[i].close;
        recentPeakIdx = i;
      }
    }
    // 對應 recent array index
    const recentPeakFullIdx = (n - 20) + recentPeakIdx;
    const pullbackDays = lastIdx - recentPeakFullIdx;
    const isPullback = currentPrice < recentPeakPrice * 0.97;

    let pullbackIsHealthy: boolean | 'unclear' = false;
    let depthVolCorr = 0;
    let supportZone: string | null = null;
    let daysToSupport: number | null = null;

    if (isPullback && pullbackDays <= 20 && pullbackDays >= 2) {
      const pullbackSegment = recent.slice(recentPeakFullIdx);
      const depths: number[] = [];
      const volumes: number[] = [];
      for (const k of pullbackSegment) {
        const depth = (recentPeakPrice - k.close) / recentPeakPrice;
        depths.push(depth);
        volumes.push(k.volume);
      }
      if (depths.length >= 5) {
        depthVolCorr = this.pearsonCorrelation(depths, volumes);
        if (depthVolCorr < -0.3) {
          pullbackIsHealthy = true;
          // 找支撐
          if (currentPrice > vwapValue * 0.99) {
            supportZone = 'vwap';
            daysToSupport = 0;
          } else {
            supportZone = 'dense_zone_pending';  // 簡化: 待 dense zone 計算
            daysToSupport = 0;
          }
        } else if (depthVolCorr > 0.3) {
          pullbackIsHealthy = false;
        } else {
          pullbackIsHealthy = 'unclear';
        }
      }
    }

    // ============ Step 6: ATR 動態分箱 (簡化) ============
    const binWidth = atrValue > 0 ? atrValue * cfg.denseZoneAtrMultiple : currentPrice * 0.01;
    const bins: Map<number, { totalVol: number; high: number; low: number; count: number }> = new Map();
    for (let i = Math.max(0, n - 60); i < n; i++) {
      const center = Math.round(recent[i].close / binWidth) * binWidth;
      if (!bins.has(center)) {
        bins.set(center, { totalVol: 0, high: recent[i].high, low: recent[i].low, count: 0 });
      }
      const b = bins.get(center)!;
      b.totalVol += recent[i].volume;
      b.high = Math.max(b.high, recent[i].high);
      b.low = Math.min(b.low, recent[i].low);
      b.count++;
    }
    const overallAvgVol = recent.slice(-60).reduce((acc, k) => acc + k.volume, 0) / 60;
    const sortedBins = [...bins.entries()].sort((a, b) => b[1].totalVol - a[1].totalVol).slice(0, 3);
    const denseZones: Array<{
      priceLevelLow: number;
      priceLevelHigh: number;
      priceLevelMid: number;
      totalVolume: number;
      volumeRatio: number;
      type: 'support' | 'resistance' | 'neutral';
      distancePct: number;
    }> = [];
    for (const [center, data] of sortedBins) {
      const avgVolInBin = data.totalVol / data.count;
      if (avgVolInBin > overallAvgVol * 1.3) {
        const zoneType: 'support' | 'resistance' | 'neutral' =
          currentPrice > center + binWidth / 2 ? 'support' :
          currentPrice < center - binWidth / 2 ? 'resistance' : 'neutral';
        denseZones.push({
          priceLevelLow: Math.round(data.low * 100) / 100,
          priceLevelHigh: Math.round(data.high * 100) / 100,
          priceLevelMid: Math.round(center * 100) / 100,
          totalVolume: data.totalVol,
          volumeRatio: Math.round((avgVolInBin / overallAvgVol) * 100) / 100,
          type: zoneType,
          distancePct: Math.round(((currentPrice - center) / center) * 10000) / 10000,
        });
        if (zoneType === 'support' && supportZone === 'dense_zone_pending') {
          supportZone = `dense_zone_${Math.round(center)}`;
        }
      }
    }

    // ============ Step 7: 滾動量价相關係數 ============
    const last15 = recent.slice(-15);
    const priceChanges: number[] = [];
    const volumeChanges: number[] = [];
    for (let i = 1; i < last15.length; i++) {
      const pc = (last15[i].close - last15[i - 1].close) / last15[i - 1].close;
      const vc = last15[i - 1].volume > 0
        ? (last15[i].volume - last15[i - 1].volume) / last15[i - 1].volume
        : 0;
      priceChanges.push(pc);
      volumeChanges.push(vc);
    }
    const corrRecent = priceChanges.length >= 10
      ? this.pearsonCorrelation(priceChanges.slice(5, 10), volumeChanges.slice(5, 10))
      : 0;
    const corrEarlier = priceChanges.length >= 5
      ? this.pearsonCorrelation(priceChanges.slice(0, 5), volumeChanges.slice(0, 5))
      : 0;
    const correlationDecay = corrEarlier - corrRecent;
    const divergenceDetected = correlationDecay > 0.4 && Math.abs(corrRecent) < 0.2;
    const divergenceType: 'bullish_vp' | 'bearish_vp' | undefined = divergenceDetected
      ? (currentPrice > last15[last15.length - 6].close ? 'bearish_vp' : 'bullish_vp')
      : undefined;

    // ============ Step 8: 成交量體制 ============
    let accumulationScore = 0;
    let distributionScore = 0;
    const priceTrend10d = (n >= 11 ? (recent[n - 1].close - recent[n - 11].close) / recent[n - 11].close : 0);
    const priceRising = priceTrend10d > 0.02;
    const priceFalling = priceTrend10d < -0.02;
    if (obvTrend === 'rising' && volPercentile < 0.3) accumulationScore += 0.3;
    if (pullbackIsHealthy === true) accumulationScore += 0.25;
    if (breakoutPattern === 'gradual_buildup') accumulationScore += 0.25;
    if (priceRising && obvTrend === 'rising') accumulationScore += 0.2;  // 上升 + OBV 同步
    if (obvTrend === 'falling' && volPercentile > 0.7) distributionScore += 0.3;
    if (divergenceType === 'bearish_vp') distributionScore += 0.25;
    if (breakoutPattern === 'single_spike' && falseBreakoutRisk > 0.5) distributionScore += 0.2;
    if (priceFalling && obvTrend === 'falling') distributionScore += 0.2;  // 下跌 + OBV 同步

    const volumeRegime: VolumeRegime =
      accumulationScore > distributionScore && accumulationScore > 0.4 ? 'accumulation' :
      distributionScore > accumulationScore && distributionScore > 0.4 ? 'distribution' : 'neutral';

    // ============ Step 9: 15 條 rule V1-V15 觸發檢測 ============
    const matchedRules: MatchedRule[] = [];
    const rulesList: MatchedRule[] = [
      // V1: ATR 波動充足
      { id: 'V1', label: 'ATR 波動充足', strength: 'weak' as const },
      // V2: VWAP 支撐
      { id: 'V2', label: 'VWAP 支撐', strength: 'weak' as const },
      // V3: 成交量百分位正常
      { id: 'V3', label: '成交量百分位正常', strength: 'weak' as const },
      // V4: 連續堆量
      { id: 'V4', label: '連續堆量', strength: 'medium' as const },
      // V5: 異常爆量過濾 (反向)
      { id: 'V5', label: '異常爆量過濾', strength: 'strong' as const },
      // V6: 加權 OBV 上升
      { id: 'V6', label: '加權 OBV 上升', strength: 'medium' as const },
      // V7: 加權 OBV 下跌
      { id: 'V7', label: '加權 OBV 下跌', strength: 'medium' as const },
      // V8: OBV 與價格同向
      { id: 'V8', label: 'OBV 與價格同向', strength: 'strong' as const },
      // V9: 溫和堆量突破
      { id: 'V9', label: '溫和堆量突破', strength: 'strong' as const },
      // V10: 放量突破確認
      { id: 'V10', label: '放量突破確認', strength: 'strong' as const },
      // V11: 縮量突破警告 (反向)
      { id: 'V11', label: '縮量突破警告', strength: 'strong' as const },
      // V12: 假突破識別 (反向)
      { id: 'V12', label: '假突破識別', strength: 'strong' as const },
      // V13: 健康回調
      { id: 'V13', label: '健康回調', strength: 'medium' as const },
      // V14: 拋售拋壓 (反向)
      { id: 'V14', label: '拋售拋壓', strength: 'strong' as const },
      // V15: 量价背馳
      { id: 'V15', label: '量价背馳', strength: 'strong' as const },
    ];

    // V1: ATR 波動充足
    if (atrValue > currentPrice * 0.005) matchedRules.push(rulesList[0]);

    // V2: VWAP 支撐
    if (currentPrice > vwapValue * 0.99) matchedRules.push(rulesList[1]);

    // V3: 成交量百分位正常 (放寬到 always true if valid)
    if (volPercentile >= 0 && volPercentile <= 1) matchedRules.push(rulesList[2]);

    // V4: 連續堆量
    if (isSustainedVolume) matchedRules.push(rulesList[3]);

    // V5: 異常爆量過濾 (反向 - 觸發代表警告)
    if (isAnomalySpike) matchedRules.push(rulesList[4]);

    // V6: 加權 OBV 上升
    if (obvTrend === 'rising') matchedRules.push(rulesList[5]);

    // V7: 加權 OBV 下跌
    if (obvTrend === 'falling') matchedRules.push(rulesList[6]);

    // V8: OBV 與價格同向
    if (obvPriceCorr > 0.5) matchedRules.push(rulesList[7]);

    // V9: 溫和堆量突破
    if (breakoutPattern === 'gradual_buildup') matchedRules.push(rulesList[8]);

    // V10: 放量突破確認
    if (breakoutPattern === 'sustained_surge' && isBreakoutConfirmed === true) matchedRules.push(rulesList[9]);

    // V11: 縮量突破警告 (反向)
    if (breakoutPattern === 'low_volume' || falseBreakoutRisk > 0.5) matchedRules.push(rulesList[10]);

    // V12: 假突破識別 (反向)
    if (falseBreakoutRisk > 0.6) matchedRules.push(rulesList[11]);

    // V13: 健康回調
    if (pullbackIsHealthy === true) matchedRules.push(rulesList[12]);

    // V14: 拋售拋壓 (反向)
    if (depthVolCorr > 0.3) matchedRules.push(rulesList[13]);

    // V15: 量价背馳
    if (divergenceDetected) matchedRules.push(rulesList[14]);

    // ============ Step 10: 規則引擎 (5 條 buy + 4 條減分) ============
    let buyTimingScore = 0.3;
    const buyReasons: string[] = [];
    const falseSignalFlags: string[] = [];

    // 5 條 buy 規則 (按信心由高到低)
    if (breakoutPattern === 'gradual_buildup' && isBreakoutConfirmed === true
        && obvPriceCorr > 0.5 && !divergenceDetected) {
      buyTimingScore = 0.9;
      buyReasons.push('V9 溫和堆量突破確認 + V8 OBV 同步,黃金買點');
    } else if (pullbackIsHealthy === true && supportZone !== null
        && volumeRegime === 'accumulation' && obvTrend === 'rising') {
      buyTimingScore = 0.75;
      buyReasons.push(`V13 健康回調至 ${supportZone},V6 OBV 資金流入`);
    } else if (divergenceType === 'bullish_vp' && volPercentile < 0.2 && obvTrend !== 'falling') {
      buyTimingScore = 0.6;
      buyReasons.push('V15 拋壓枯竭,試探性買入');
    } else if (currentPrice > vwapValue * 0.995 && currentPrice < vwapValue * 1.02
        && volPercentile < 0.5 && obvTrend === 'rising') {
      buyTimingScore = 0.55;
      buyReasons.push('V2 VWAP 支撐反彈,量縮');
    } else {
      buyReasons.push('暫無明確成交量買入模式');
    }

    // 4 條減分覆蓋
    if (falseBreakoutRisk > 0.6) {
      buyTimingScore *= 0.5;
      falseSignalFlags.push('high_false_breakout_risk');
      buyReasons.push('警告:假突破風險極高');
    }
    if (divergenceType === 'bearish_vp' && volPercentile > 0.8) {
      buyTimingScore *= 0.4;
      falseSignalFlags.push('distribution_with_price_rise');
      buyReasons.push('警告:放量滯漲,主力可能出貨');
    }
    if (isAnomalySpike) {
      buyTimingScore *= 0.6;
      falseSignalFlags.push('anomaly_volume_spike');
      buyReasons.push('警告:單日異常爆量,信號不可靠');
    }
    if (obvPriceCorr < -0.3) {
      buyTimingScore *= 0.7;
      falseSignalFlags.push('obv_price_divergence');
      buyReasons.push('警告:OBV 與價格背馳,資金暗中流出');
    }
    // 額外: 派發型背馳 (高量 + 上升 + OBV 背馳)
    if (obvTrend === 'falling' && volPercentile > 0.8 && priceTrend10d > 0.02) {
      buyTimingScore *= 0.5;
      falseSignalFlags.push('distribution_with_price_rise');
      buyReasons.push('警告:放量滯漲,主力可能出貨');
    }

    // ============ Step 11: Signal 推導 ============
    let signal: SignalType = 'NEUTRAL';
    if (volumeRegime === 'distribution' || falseSignalFlags.length >= 2
        || (obvTrend === 'falling' && volPercentile > 0.7)) {
      signal = 'DISCONFIRM';
    } else if (buyTimingScore >= 0.55 && volumeRegime !== 'distribution'
        && falseSignalFlags.length === 0 && obvTrend !== 'falling') {
      signal = 'CONFIRM';
    }

    // ============ Step 12: Cycle 推導 (資金視角) ============
    const cycle: 'uptrend' | 'downtrend' | 'sideways' =
      buyTimingScore >= 0.55 ? 'uptrend' :
      volumeRegime === 'distribution' ? 'downtrend' : 'sideways';
    const cycleLabel = buyTimingScore >= 0.55 ? '資金流入' :
                       volumeRegime === 'distribution' ? '資金流出' : '資金觀望';

    // ============ Step 13: 勝率估算 ============
    let baseWin: number;
    if (buyTimingScore >= 0.85) baseWin = 0.68;
    else if (buyTimingScore >= 0.7) baseWin = 0.60;
    else if (buyTimingScore >= 0.55) baseWin = 0.52;
    else baseWin = 0.40;
    if (falseSignalFlags.length > 0) baseWin -= 0.08 * falseSignalFlags.length;
    const winProbability = Math.min(0.80, Math.max(0.25, baseWin));

    // ============ Step 14: 組裝輸出 ============
    return {
      moduleId: 'volume',
      timeframe: ctx.ltf,
      state: this.mapToCycleState(cycle),
      confidence: Math.round(buyTimingScore * 10000) / 10000,
      interpretation: buyReasons.join('；'),
      evidence: matchedRules.map(r => ({
        type: `rule-${r.id}`,
        label: r.label,
        value: r.id,
        passed: true,
      })),
      warnings: [],
      meta: {
        // v2.0 output fields
        cycle,
        cycleLabel,
        signal,
        buyTimingScore: Math.round(buyTimingScore * 10000) / 10000,
        winProbability: Math.round(winProbability * 10000) / 10000,
        falseSignalFlags,
        volumeRegime,
        accumulationScore: Math.round(accumulationScore * 100) / 100,
        distributionScore: Math.round(distributionScore * 100) / 100,
        breakoutStatus: {
          isBreakout: isPriceBreakout,
          isConfirmed: isBreakoutConfirmed,
          pattern: breakoutPattern,
          strength: Math.round(breakoutStrength * 100) / 100,
          falseBreakoutRisk: Math.round(falseBreakoutRisk * 100) / 100,
        },
        pullbackHealth: {
          isHealthy: pullbackIsHealthy,
          depthVolCorrelation: Math.round(depthVolCorr * 10000) / 10000,
          supportZone,
          daysToSupport,
        },
        vwapAnalysis: {
          vwapValue: Math.round(vwapValue * 100) / 100,
          priceVsVwapPct: Math.round(((currentPrice - vwapValue) / vwapValue) * 10000) / 10000,
          vwapSupportStrength:
            currentPrice > vwapValue * 1.01 ? 'strong' :
            currentPrice > vwapValue * 0.99 ? 'testing' : 'broken',
        },
        volumePercentile: Math.round(volPercentile * 10000) / 10000,
        turnoverRate: turnoverRate !== null ? Math.round(turnoverRate * 1000000) / 1000000 : null,
        denseZones,
        volumePriceCorrelation: {
          pearsonRecent: Math.round(corrRecent * 10000) / 10000,
          pearsonEarlier: Math.round(corrEarlier * 10000) / 10000,
          correlationDecay: Math.round(correlationDecay * 10000) / 10000,
          divergenceDetected,
          divergenceType,
        },
        obvAnalysis: {
          obvTrend,
          obvPriceCorrelation: Math.round(obvPriceCorr * 10000) / 10000,
          weightedObvValue: Math.round(weightedObv[lastIdx]),
        },
        // Legacy fields (保留向後兼容)
        matchedRules: matchedRules.map(r => r.id),
        ruleLabels: matchedRules.map(r => r.label),
        rulesFired: matchedRules.length,
        atr: Math.round(atrValue * 100) / 100,
        vwap: Math.round(vwapValue * 100) / 100,
        consecutiveSurge,
        isAnomalySpike,
        configUsed: cfg,
        dataDays: n,
      },
      timestamp: Date.now(),
    };
  }

  // ===== Helpers =====

  private computeATR(klines: KLine[], period: number): number {
    if (klines.length < period + 1) return 0;
    const trs: number[] = [];
    for (let i = 1; i < klines.length; i++) {
      const high = klines[i].high;
      const low = klines[i].low;
      const prevClose = klines[i - 1].close;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trs.push(tr);
    }
    // Wilder smoothing
    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) {
      atr = (atr * (period - 1) + trs[i]) / period;
    }
    return atr;
  }

  private computeVWAP(klines: KLine[], period: number): number {
    const startIdx = Math.max(0, klines.length - period);
    let cumPV = 0;
    let cumVol = 0;
    for (let i = startIdx; i < klines.length; i++) {
      const typicalPrice = (klines[i].high + klines[i].low + klines[i].close) / 3;
      cumPV += typicalPrice * klines[i].volume;
      cumVol += klines[i].volume;
    }
    if (cumVol === 0) {
      // Fallback: SMA of close
      const slice = klines.slice(startIdx);
      return slice.reduce((acc, k) => acc + k.close, 0) / slice.length;
    }
    return cumPV / cumVol;
  }

  private computeVolumePercentile(klines: KLine[], lookback: number): number {
    const startIdx = Math.max(0, klines.length - lookback);
    const recentVols = klines.slice(startIdx).map(k => k.volume);
    if (recentVols.length === 0) return 0;
    const sorted = [...recentVols].sort((a, b) => a - b);
    const latestVol = recentVols[recentVols.length - 1];
    const rank = sorted.filter(v => v <= latestVol).length;
    return rank / sorted.length;
  }

  private computeSMA(series: number[], period: number): number[] {
    const sma: number[] = [];
    for (let i = 0; i < series.length; i++) {
      if (i < period - 1) {
        sma.push(NaN);
        continue;
      }
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += series[j];
      }
      sma.push(sum / period);
    }
    return sma;
  }

  private pearsonCorrelation(xs: number[], ys: number[]): number {
    const n = Math.min(xs.length, ys.length);
    if (n < 2) return 0;
    const xSlice = xs.slice(-n);
    const ySlice = ys.slice(-n);
    const xMean = xSlice.reduce((a, b) => a + b, 0) / n;
    const yMean = ySlice.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let denX = 0;
    let denY = 0;
    for (let i = 0; i < n; i++) {
      const dx = xSlice[i] - xMean;
      const dy = ySlice[i] - yMean;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }
    const den = Math.sqrt(denX * denY);
    return den === 0 ? 0 : num / den;
  }

  private mapToCycleState(cycle: 'uptrend' | 'downtrend' | 'sideways'): 'UP' | 'DOWN' | 'SIDEWAYS' {
    if (cycle === 'uptrend') return 'UP';
    if (cycle === 'downtrend') return 'DOWN';
    return 'SIDEWAYS';
  }
}

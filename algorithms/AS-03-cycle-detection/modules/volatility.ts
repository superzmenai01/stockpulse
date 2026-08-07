// modules/volatility.ts — AS-03 · 點 6: 波動率與市場結構收縮擴張檢測法 v1.0.0
//
// 大少 2026-08-07 — Module 6 (Volatility & Squeeze Detector)
// 對應 docx: `docs/演算法概念SPECS/06波動率與市場結構收縮擴張檢測法.docx` v2.0
// Spec doc: `docs/research/AS-03-cycle-detection/MODULE-06-VOLATILITY.md`
//
// 簡化 v1.0 (testing page 唔支援 weekly + market data):
//   - Squeeze (BB vs KC) 為主軸 (daily only)
//   - ATR 分解 (Trend + Noise + SNR)
//   - VCP 結構 (linear regression 替代 RANSAC)
//   - 3 種失敗模式 (簡化 5→3 種)
//   - 5 種入場 setup (rule-based)
//
// 12 條 rule S1-S12 (對應 spec §5 Step 8):
//   S1  日線 Squeeze              S7  結構性擴張
//   S2  Squeeze 質量高            S8  籌碼集中
//   S3  Squeeze 持續夠耐          S9  VCP 結構
//   S4  趨勢 ATR 強              S10 VCP 量縮確認
//   S5  噪音 ATR 高 (反向)       S11 突破跟進
//   S6  結構性收縮                S12 失敗模式 (反向)
//
// State 派生: cycle (uptrend / downtrend / sideways) + state (UP / DOWN / SIDEWAYS)

import type {
  CycleContext, CycleModule, CycleVerdict, KLine,
} from '../types.ts';
import { DEFAULT_VOLATILITY_CONFIG, type VolatilityConfig } from '../config.ts';

interface MatchedRule {
  id: string;
  label: string;
  strength: 'strong' | 'medium' | 'weak';
}

type SetupType = 'mtf_squeeze_fire' | 'confirmed_vcp_breakout' | 'genuine_squeeze_forming'
  | 'clean_trend_expansion' | 'no_clear_setup';
type FailureMode = 'none' | 'noisy_squeeze' | 'weak_follow_through' | 'no_setup';

export class VolatilityModule implements CycleModule<KLine[]> {
  readonly id = 'volatility' as const;
  readonly version = '1.0.0';

  private readonly cfg: VolatilityConfig;

  constructor(config: VolatilityConfig = DEFAULT_VOLATILITY_CONFIG) {
    this.cfg = config;
  }

  async detect(klines: KLine[], ctx: CycleContext): Promise<CycleVerdict> {
    const cfg = this.cfg;
    const symbol = ctx.symbol;

    // ============ Step 0: 輸入驗證 ============
    const minData = Math.max(85, cfg.bbPeriod + 50 + cfg.followThroughDays + 10);
    if (klines.length < minData) {
      return {
        moduleId: 'volatility',
        timeframe: ctx.ltf,
        state: 'SIDEWAYS',
        confidence: 0,
        interpretation: `[Volatility v1.0] 數據不足: need >= ${minData} bars, got ${klines.length}`,
        evidence: [],
        warnings: [`數據不足 (${klines.length}/${minData})`],
        meta: { dataDays: klines.length, configUsed: cfg },
        timestamp: Date.now(),
      };
    }

    const recent = klines.slice(-Math.max(klines.length, minData));
    const n = recent.length;
    const lastIdx = n - 1;
    const lastBar = recent[lastIdx];

    // ============ Step 1: 計算基礎指標 ============
    const atrValue = this.computeATR(recent, cfg.atrPeriod);
    const bbUpper: number[] = [];
    const bbLower: number[] = [];
    const bbSma: number[] = [];
    const kcUpper: number[] = [];
    const kcLower: number[] = [];

    for (let i = 0; i < n; i++) {
      const sma = this.smaAt(recent, i, cfg.bbPeriod);
      const std = this.stdAt(recent, i, cfg.bbPeriod);
      bbSma.push(sma);
      bbUpper.push(sma + cfg.bbStd * std);
      bbLower.push(sma - cfg.bbStd * std);
      kcUpper.push(sma + cfg.kcAtrMult * atrValue);
      kcLower.push(sma - cfg.kcAtrMult * atrValue);
    }

    const bbWidth = bbUpper[lastIdx] - bbLower[lastIdx];
    const kcWidth = kcUpper[lastIdx] - kcLower[lastIdx];

    // ============ Step 2: Squeeze 檢測 ============
    const squeezeHistory: boolean[] = [];
    for (let i = 0; i < n; i++) {
      const w_bb = (bbUpper[i] - bbLower[i]) / bbSma[i];
      const w_kc = (kcUpper[i] - kcLower[i]) / bbSma[i];
      squeezeHistory.push(w_bb < w_kc);
    }
    const isSqueeze = squeezeHistory[lastIdx];
    let squeezeDuration = 0;
    for (let i = lastIdx; i >= 0; i--) {
      if (squeezeHistory[i]) squeezeDuration++;
      else break;
    }

    // Squeeze 質量評分
    const squeezeStartIdx = Math.max(0, lastIdx - squeezeDuration + 1);
    const squeezeSegment = recent.slice(squeezeStartIdx, lastIdx + 1);
    const squeezePrices = squeezeSegment.map(k => k.close);
    const priceMean = squeezePrices.reduce((a, b) => a + b, 0) / squeezePrices.length;
    const priceStd = Math.sqrt(squeezePrices.reduce((acc, p) => acc + (p - priceMean) ** 2, 0) / squeezePrices.length);
    const priceCV = priceMean > 0 ? priceStd / priceMean : 0;

    // 成交量集中度 (Entropy)
    const minP = Math.min(...squeezePrices);
    const maxP = Math.max(...squeezePrices);
    const rangeP = maxP - minP;
    const volBins = new Array(5).fill(0);
    if (rangeP > 0) {
      for (const k of squeezeSegment) {
        const binIdx = Math.min(4, Math.floor((k.close - minP) / (rangeP / 5)));
        volBins[binIdx] += k.volume;
      }
    }
    const totalVol = volBins.reduce((a, b) => a + b, 0);
    let entropy = 0;
    if (totalVol > 0) {
      for (const v of volBins) {
        if (v > 0) {
          const p = v / totalVol;
          entropy -= p * Math.log(p);
        }
      }
    }
    const maxEntropy = Math.log(5);
    const volumeConcentration = maxEntropy > 0 ? 1 - entropy / maxEntropy : 0;

    // 趨勢水平
    const squeezeTrend = (squeezePrices[squeezePrices.length - 1] - squeezePrices[0]) / squeezePrices[0];
    const isHorizontal = Math.abs(squeezeTrend) < 0.02;

    let qualityScore = 0;
    if (isHorizontal) qualityScore += 0.3;
    qualityScore += volumeConcentration * 0.4;
    qualityScore += (1 - Math.min(1, priceCV / 0.03)) * 0.3;

    const isGenuineSqueeze = qualityScore >= 0.6 && squeezeDuration >= cfg.squeezeMinDuration;

    // ============ Step 3: ATR 分解 ============
    const trendAtr: number[] = [];
    const noiseAtr: number[] = [];
    const lookback = 20;
    for (let i = lookback - 1; i < n; i++) {
      const segment = recent.slice(i - lookback + 1, i + 1);
      const x: number[] = [];
      const y: number[] = [];
      for (let j = 0; j < segment.length; j++) {
        x.push(j);
        y.push(segment[j].close);
      }
      const xMean = x.reduce((a, b) => a + b, 0) / x.length;
      const yMean = y.reduce((a, b) => a + b, 0) / y.length;
      let num = 0, denX = 0;
      for (let j = 0; j < x.length; j++) {
        const dx = x[j] - xMean;
        const dy = y[j] - yMean;
        num += dx * dy;
        denX += dx * dx;
      }
      const slope = denX > 0 ? num / denX : 0;
      const intercept = yMean - slope * xMean;
      const predicted = x.map(xi => slope * xi + intercept);
      const residuals = y.map((yi, j) => yi - predicted[j]);
      let trendComp = 0;
      for (let j = 0; j < segment.length; j++) {
        trendComp += Math.abs(segment[j].high - predicted[j]) + Math.abs(segment[j].low - predicted[j]);
      }
      trendComp = trendComp / (2 * segment.length);
      const noiseComp = residuals.reduce((a, r) => a + Math.abs(r), 0) / residuals.length;
      trendAtr.push(trendComp);
      noiseAtr.push(noiseComp);
    }
    const latestTrendAtr = trendAtr[trendAtr.length - 1];
    const latestNoiseAtr = noiseAtr[noiseAtr.length - 1];
    const snr = latestNoiseAtr > 0 ? latestTrendAtr / latestNoiseAtr : 10;
    const regime: 'trending' | 'balanced' | 'choppy' = snr > 2 ? 'trending' : snr < 0.5 ? 'choppy' : 'balanced';

    // ATR 趨勢
    const recent5Atr = noiseAtr.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const prev5Atr = noiseAtr.slice(-10, -5).reduce((a, b) => a + b, 0) / 5;
    const atrContraction = recent5Atr < prev5Atr * 0.85;
    const atrExpansion = recent5Atr > prev5Atr * 1.15;

    // ============ Step 4: VCP 結構 ============
    const last20 = recent.slice(-20);
    const highs: number[] = [];
    const lows: number[] = [];
    for (let i = 4; i < last20.length - 4; i++) {
      let isHigh = true, isLow = true;
      for (let j = i - 3; j <= i + 3; j++) {
        if (j === i) continue;
        if (last20[j].high >= last20[i].high) isHigh = false;
        if (last20[j].low <= last20[i].low) isLow = false;
      }
      if (isHigh) highs.push({ idx: i, price: last20[i].high });
      if (isLow) lows.push({ idx: i, price: last20[i].low });
    }
    let highLowPairs = 0;
    let lastPairHigh = Infinity, lastPairLow = -Infinity;
    const minIdx = Math.min(highs.length, lows.length);
    for (let i = 0; i < minIdx; i++) {
      if (highs[i].price < lastPairHigh && lows[i].price > lastPairLow) {
        highLowPairs++;
        lastPairHigh = highs[i].price;
        lastPairLow = lows[i].price;
      }
    }
    const vcpDetected = highLowPairs >= cfg.vcpMinWindows;

    // VCP 量縮確認
    let volTightening = false;
    if (vcpDetected) {
      const firstHalf = last20.slice(0, 10).reduce((a, k) => a + k.volume, 0) / 10;
      const secondHalf = last20.slice(-10).reduce((a, k) => a + k.volume, 0) / 10;
      volTightening = secondHalf < firstHalf * 0.7;
    }

    // ============ Step 5: Follow-through ============
    const recentRange = recent.slice(-cfg.followThroughDays);
    const prevRange = recent.slice(-cfg.followThroughDays * 2, -cfg.followThroughDays);
    const recentHigh = Math.max(...recentRange.map(k => k.high));
    const recentLow = Math.min(...recentRange.map(k => k.low));
    const prevHigh = Math.max(...prevRange.map(k => k.high));
    const prevLow = Math.min(...prevRange.map(k => k.low));
    const isBreakoutAttempt = recentHigh > prevHigh * 1.01 || recentLow < prevLow * 0.99;

    let followScore = 0;
    let volumeDecay = 0;
    let priceProgression = 0;
    if (isBreakoutAttempt) {
      const directionUp = recentHigh > prevHigh * 1.01;
      if (directionUp) {
        const closes = recentRange.map(k => k.close);
        const higher = closes.slice(1).filter((c, i) => c > closes[i]).length;
        priceProgression = higher / (closes.length - 1);
        const maxHighIdx = recentRange.findIndex(k => k.high === recentHigh);
        const breakoutDayVol = recentRange[maxHighIdx].volume;
        const postVols = recentRange.slice(maxHighIdx + 1);
        const avgVol = recentRange.reduce((a, k) => a + k.volume, 0) / recentRange.length;
        if (breakoutDayVol > avgVol * 1.3) {
          if (postVols.length >= 2) {
            const postAvg = postVols.reduce((a, k) => a + k.volume, 0) / postVols.length;
            volumeDecay = postAvg < breakoutDayVol * 0.8 ? 0.8 : 0.4;
          } else {
            volumeDecay = 0.4;
          }
        } else {
          volumeDecay = 0.2;
        }
        followScore = volumeDecay * 0.5 + priceProgression * 0.5;
      }
    }

    // ============ Step 6: 失敗模式 ============
    let failureMode: FailureMode = 'none';
    let failureReason: string | null = null;
    if (isSqueeze && latestNoiseAtr > latestTrendAtr * 2) {
      failureMode = 'noisy_squeeze';
      failureReason = 'Squeeze 期間 Noise ATR 過高,結構不穩定';
    } else if (isBreakoutAttempt && followScore < 0.4) {
      failureMode = 'weak_follow_through';
      failureReason = '突破後跟進無力,可能是假突破';
    }

    // ============ Step 7: 入場評分 ============
    const failureMaxCap = failureMode !== 'none' ? 0.4 : 1.0;
    let entryScore = 0;
    let setupType: SetupType = 'no_clear_setup';
    let riskReward = 0;

    // Squeeze Fire: 之前 Squeeze → 而家 NOT Squeeze
    const wasSqueeze = squeezeHistory[lastIdx - 1] || false;
    if (!isSqueeze && wasSqueeze && qualityScore >= 0.6 && failureMode !== 'weak_follow_through') {
      entryScore = 0.95 * failureMaxCap;
      setupType = 'mtf_squeeze_fire';
      riskReward = 3.5;
    } else if (vcpDetected && volTightening && followScore >= 0.5 && failureMode !== 'noisy_squeeze') {
      entryScore = 0.9 * failureMaxCap;
      setupType = 'confirmed_vcp_breakout';
      riskReward = 3.0;
    } else if (isGenuineSqueeze && qualityScore >= 0.75) {
      entryScore = 0.55 * failureMaxCap;
      setupType = 'genuine_squeeze_forming';
    } else if (latestNoiseAtr < latestTrendAtr * 0.5 && regime === 'trending' && followScore >= 0.6) {
      entryScore = 0.7 * failureMaxCap;
      setupType = 'clean_trend_expansion';
      riskReward = 2.0;
    } else {
      entryScore = 0.25;
      setupType = 'no_clear_setup';
    }

    // ============ Step 8: 12 條 rule S1-S12 觸發 ============
    const matchedRules: MatchedRule[] = [];
    if (isSqueeze) matchedRules.push({ id: 'S1', label: '日線 Squeeze', strength: 'medium' });
    if (qualityScore >= 0.6) matchedRules.push({ id: 'S2', label: 'Squeeze 質量高', strength: 'medium' });
    if (squeezeDuration >= cfg.squeezeMinDuration) matchedRules.push({ id: 'S3', label: 'Squeeze 持續夠耐', strength: 'medium' });
    if (snr > 2) matchedRules.push({ id: 'S4', label: '趨勢 ATR 強', strength: 'strong' });
    if (snr < 0.5) matchedRules.push({ id: 'S5', label: '噪音 ATR 高', strength: 'strong' });
    if (atrContraction) matchedRules.push({ id: 'S6', label: '結構性收縮', strength: 'medium' });
    if (atrExpansion) matchedRules.push({ id: 'S7', label: '結構性擴張', strength: 'medium' });
    if (volumeConcentration > 0.6) matchedRules.push({ id: 'S8', label: '籌碼集中', strength: 'medium' });
    if (vcpDetected) matchedRules.push({ id: 'S9', label: 'VCP 結構', strength: 'medium' });
    if (volTightening) matchedRules.push({ id: 'S10', label: 'VCP 量縮確認', strength: 'medium' });
    if (followScore >= 0.5) matchedRules.push({ id: 'S11', label: '突破跟進', strength: 'medium' });
    if (failureMode !== 'none') matchedRules.push({ id: 'S12', label: `失敗模式 (${failureMode})`, strength: 'strong' });

    // ============ Step 9: 勝率估算 ============
    let baseWin: number;
    if (setupType === 'mtf_squeeze_fire') baseWin = 0.75;
    else if (setupType === 'confirmed_vcp_breakout') baseWin = 0.70;
    else if (setupType === 'clean_trend_expansion') baseWin = 0.62;
    else if (setupType === 'genuine_squeeze_forming') baseWin = 0.50;
    else baseWin = 0.35;
    if (failureMode === 'market_headwind') baseWin -= 0.08;
    if (failureMode === 'weak_follow_through') baseWin -= 0.12;
    if (failureMode === 'noisy_squeeze') baseWin -= 0.10;
    const winProbability = Math.min(0.82, Math.max(0.25, baseWin));

    // ============ Step 10: 組裝輸出 ============
    const cycle: 'uptrend' | 'downtrend' | 'sideways' =
      (setupType === 'mtf_squeeze_fire' || setupType === 'confirmed_vcp_breakout' || setupType === 'clean_trend_expansion') ? 'uptrend' :
      setupType === 'no_clear_setup' ? 'sideways' : 'sideways';
    const cycleLabel = entryScore >= 0.8 ? '高質量蓄力' :
      failureMode !== 'none' ? '假蓄力警告' :
      regime === 'choppy' ? '亂爆階段' : '蓄力觀察';
    const state = cycle === 'uptrend' ? 'UP' : cycle === 'downtrend' ? 'DOWN' : 'SIDEWAYS';

    const interpretation = matchedRules.length > 0
      ? matchedRules.map(r => r.label).join('；')
      : '無明確波動率信號';

    return {
      moduleId: 'volatility',
      timeframe: ctx.ltf,
      state,
      confidence: Math.round(entryScore * 10000) / 10000,
      interpretation,
      evidence: matchedRules.map(r => ({ type: `rule-${r.id}`, label: r.label, value: r.id, passed: true })),
      warnings: [],
      meta: {
        cycle,
        cycleLabel,
        setupType,
        riskReward,
        entryScore: Math.round(entryScore * 10000) / 10000,
        winProbability: Math.round(winProbability * 10000) / 10000,
        failureMode,
        failureReason,
        squeeze: {
          isSqueeze,
          duration: squeezeDuration,
          qualityScore: Math.round(qualityScore * 10000) / 10000,
          isGenuine: isGenuineSqueeze,
        },
        vcpStructure: {
          detected: vcpDetected,
          highLowPairs,
          volTightening,
        },
        atrDecomposition: {
          totalAtr: Math.round(atrValue * 100) / 100,
          trendAtr: Math.round(latestTrendAtr * 100) / 100,
          noiseAtr: Math.round(latestNoiseAtr * 100) / 100,
          snr: Math.round(snr * 100) / 100,
          regime,
        },
        followThrough: {
          followScore: Math.round(followScore * 100) / 100,
          volumeDecay: Math.round(volumeDecay * 100) / 100,
          priceProgression: Math.round(priceProgression * 100) / 100,
        },
        matchedRules: matchedRules.map(r => r.id),
        ruleLabels: matchedRules.map(r => r.label),
        rulesFired: matchedRules.length,
        atr: Math.round(atrValue * 100) / 100,
        bbWidth: Math.round(bbWidth * 100) / 100,
        kcWidth: Math.round(kcWidth * 100) / 100,
        priceCV: Math.round(priceCV * 10000) / 10000,
        volumeConcentration: Math.round(volumeConcentration * 10000) / 10000,
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
      const tr = Math.max(
        klines[i].high - klines[i].low,
        Math.abs(klines[i].high - klines[i - 1].close),
        Math.abs(klines[i].low - klines[i - 1].close),
      );
      trs.push(tr);
    }
    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) {
      atr = (atr * (period - 1) + trs[i]) / period;
    }
    return atr;
  }

  private smaAt(klines: KLine[], idx: number, period: number): number {
    const start = Math.max(0, idx - period + 1);
    let sum = 0, count = 0;
    for (let i = start; i <= idx; i++) {
      sum += klines[i].close;
      count++;
    }
    return count > 0 ? sum / count : 0;
  }

  private stdAt(klines: KLine[], idx: number, period: number): number {
    const start = Math.max(0, idx - period + 1);
    const closes: number[] = [];
    for (let i = start; i <= idx; i++) closes.push(klines[i].close);
    const mean = closes.reduce((a, b) => a + b, 0) / closes.length;
    const variance = closes.reduce((acc, c) => acc + (c - mean) ** 2, 0) / closes.length;
    return Math.sqrt(variance);
  }
}

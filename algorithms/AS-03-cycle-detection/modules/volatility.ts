// modules/volatility.ts — AS-03 · 點 6: 波動率與市場結構收縮擴張檢測法 v2.0.0
//
// 大少 2026-09-10 — Spec Sync #54: M6 v2.0.0 (對齊 M3/M4 永久 rule + 修 5 個 critical bug)
// 對應 docx: `docs/演算法概念SPECS/06波動率與市場結構收縮擴張檢測法.docx` v2.0
// Spec doc: `docs/research/AS-03-cycle-detection/MODULE-06-VOLATILITY.md`
// 對應 backend: backend/algorithms/volatility/algorithm.py v2.0.0 (1:1 port 同步)
//
// v2.0.0 改動 (凡人話: 對齊 M3/M4 永久 rule + 修 5 個 critical bug):
//
// - Phase 1.1: 加 Hurst+ADX regime gate (對齊 §M3 Hurst+ADX gate Spec Sync #45 永久 rule)
//   - H < 0.45 OR ADX < 20 → emit 1 個 CONFLICT_STATE warning (info level) + 繼續行
//   - 對齊 M4 v0.3.0 Option 1 trigger: 唔好 early return
//   - meta 永遠 emit hurst + adx 兩個 audit field
//
// - Phase 1.2: 加 M1 state filter (對齊 §M4 M1 state filter Spec Sync #52 永久 rule)
//   - M1=DOWN 但 M6 出 bullish setup → FALLBACK_USED warning + setup score 折 0.5x
//   - M1=UP 但 M6 出 bearish setup → FALLBACK_USED warning + setup score 折 0.5x
//   - algorithm_runner.py 統一 inject `options["m1State"]` 落 M6
//   - meta 永遠 emit m1State 4 個 value
//
// - Phase 1.3: 加 self-check warning emit (5 個 code) (對齊 §M2 self-check + §M3 + §M4 永久 rule)
//   - INSUFFICIENT_DATA (critical) — K 線唔夠 85 條
//   - CONFLICT_STATE (info) — Hurst+ADX gate 唔過 OR noisy_squeeze
//   - FALLBACK_USED (warning) — M1 state 同 M6 setup 矛盾
//   - THRESHOLD_BREACH (warning) — 最終 conf < 0.3 門檻
//   - MODULE_PARTIAL (warning) — VCP 結構 partial 確認
//
// - Phase 1.4: 加 self-check penalty (對齊 §M2 self-check penalty Spec Sync #48 永久 rule)
//   - critical + warning level self-check warning 觸發 conf floor 0.3
//   - 公式 `max(conf * 0.375, 0.3)` 對齊 M2/M3/M4 一致
//   - meta 永遠 emit selfCheckTriggered: bool + originalConfidence: float
//
// - Phase 1.5: 修復 follow-through 邏輯矛盾 (Critical C3)
//   - 之前 downward breakout 仍然 trigger weak_follow_through → 邏輯錯
//   - 而家: upward 跟進用原算法 + downward 跟進用 close < prev_low 嘅比率
//   - 失敗模式: 只有 upward 跟進失敗先 trigger weak_follow_through
//
// - Phase 1.6: 修復 cycle 推導 (Critical C1)
//   - 之前 M6 永遠 UP/SIDEWAYS, 跌市永遠 SIDEWAYS
//   - 而家: bear_squeeze_fire / clean_trend_breakdown → cycle='downtrend' → state='DOWN'
//
// - Phase 1.7: 加 momentum histogram (TTM Squeeze 標準)
//   - 對齊 TTM Squeeze John Carter 2005 standard: BB + KC + Momentum Histogram
//   - histogram > 0 = bullish, < 0 = bearish
//   - meta 永遠 emit momentumHistogram + momentumDir
//
// - Phase 1.8: 加 bearish squeeze fire setup
//   - 對齊 TTM Squeeze 標準: histogram 喺 zero 下面 + squeeze fire = 做空
//   - new setup: bear_squeeze_fire (0.85)
//   - cycle 推導: bear_squeeze_fire / clean_trend_breakdown → 'downtrend' → state='DOWN'
//
// - Phase 2.1-2.3: 重寫 VCP detection 跟 Minervini 標準
//   - 2-5 個 progressively smaller pullback: C1 > C2 > C3 > C-final
//   - 每個 contraction ≤ 70% 之前 (ratio 0.7)
//   - higher low 結構 (每個 contraction low 比之前高)
//   - 量縮確認 (最後 contraction vol < avg vol × 60%)
//   - 必須喺 Stage 2 uptrend (200-day MA sloping up + current close > 200 MA × 0.85)
//   - lookback 20 日 → 60 日
//
// State derivation:
// - mtf_squeeze_fire / confirmed_vcp_breakout / clean_trend_expansion → cycle='uptrend' → state='UP'
// - bear_squeeze_fire / clean_trend_breakdown → cycle='downtrend' → state='DOWN'
// - genuine_squeeze_forming / no_clear_setup → cycle='sideways' → state='SIDEWAYS'

import type {
  CycleContext, CycleModule, CycleVerdict, KLine, ModuleStandardVerdict,
} from '../types.ts';
import { DEFAULT_VOLATILITY_CONFIG, type VolatilityConfig } from '../config.ts';
import { runAndStandardize } from '../std-verdict.ts';
import { computeHurst, computeAdx } from './trendline.ts';
import { makeWarning } from '../../lib/warnings.mjs';

interface MatchedRule {
  id: string;
  label: string;
  strength: 'strong' | 'medium' | 'weak';
}

type SetupType = 'mtf_squeeze_fire' | 'confirmed_vcp_breakout' | 'genuine_squeeze_forming'
  | 'clean_trend_expansion' | 'bear_squeeze_fire' | 'clean_trend_breakdown' | 'no_clear_setup';
type FailureMode = 'none' | 'noisy_squeeze' | 'weak_follow_through' | 'no_setup';

export class VolatilityModule implements CycleModule<KLine[]> {
  readonly id = 'volatility' as const;
  readonly version = '2.0.0';

  private readonly cfg: VolatilityConfig;

  constructor(config: VolatilityConfig = DEFAULT_VOLATILITY_CONFIG) {
    this.cfg = config;
  }

  async detect(klines: KLine[], ctx: CycleContext): Promise<CycleVerdict> {
    const cfg = this.cfg;
    const symbol = ctx.symbol;
    const m1State = (ctx as any).m1State as string | undefined;  // v2.0.0 A2: M1 state filter

    // Self-check warnings 收集 (v2.0.0 A4, 對齊 §M2 self-check 永久 rule)
    const warnings: any[] = [];

    // ============ Step 0: 輸入驗證 ============
    const minData = Math.max(85, cfg.bbPeriod + 50 + cfg.followThroughDays + 10);
    if (klines.length < minData) {
      warnings.push(makeWarning(
        'critical', 'M6', 'INSUFFICIENT_DATA',
        `數據不足: ${klines.length} < ${minData}`,
        `kline count ${klines.length} < ${minData} required (bbPeriod + 50 + followThroughDays + 10)`,
        { kline_count: klines.length, min_required: minData, symbol }
      ));
      return {
        moduleId: 'volatility',
        timeframe: ctx.ltf,
        state: 'SIDEWAYS',
        confidence: 0,
        interpretation: `[Volatility v2.0] 數據不足: need >= ${minData} bars, got ${klines.length}`,
        evidence: [],
        warnings,
        meta: { dataDays: klines.length, configUsed: cfg },
        timestamp: Date.now(),
      };
    }

    // ============ Step 0.5: Hurst+ADX regime gate (v2.0.0 A1) ============
    const closesForHurst = klines.map(k => k.close);
    const hurstValue = computeHurst(closesForHurst, 100);
    const adxValue = computeAdx(klines.slice(-100), 14);
    const regimePassed = hurstValue >= 0.45 && adxValue >= 20;
    if (!regimePassed) {
      warnings.push(makeWarning(
        'info', 'M6', 'CONFLICT_STATE',
        `Regime gate 唔通過 (Hurst=${hurstValue.toFixed(3)}, ADX=${adxValue.toFixed(1)})`,
        `Hurst ${hurstValue.toFixed(3)} < 0.45 OR ADX ${adxValue.toFixed(1)} < 20 → random walk / mean-reverting 弱趨勢`,
        { hurst: Math.round(hurstValue * 10000) / 10000, adx: Math.round(adxValue * 100) / 100, symbol }
      ));
      // 唔再 return, 繼續行 Step 1-9 (對齊 M4 v0.3.0 Option 1)
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

    // ============ Step 1.5: Momentum Histogram (v2.0.0 A7) ============
    const { momentumHist, momentumDir } = this.computeMomentumHistogram(recent, 20);

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

    // 凡人話: S2/S3 quality threshold 0.6 → 0.7 (對齊 TTM Squeeze best practice)
    // 大少 2026-09-10 11:30 Spec Sync #54 v2.0.1 — qualityThreshold 0.7 → 0.5 (對齊 v1.0.0 spirit + TTM Squeeze balance)
    // 凡人話: v2.0.0 用 0.7 太嚴, 99% stock 唔達標 setup 永遠 no_clear_setup
    // 改 0.5 平衡: regimeGate PASS 嗰陣 setup 容易 trigger, FAIL 嗰陣 (random walk) 唔會亂 trigger
    const qualityThreshold = 0.5;
    const isGenuineSqueeze = qualityScore >= qualityThreshold && squeezeDuration >= cfg.squeezeMinDuration;

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

    // ATR 趨勢 (v2.0.0 I5 fix: 用 total_atr 唔係 noise_atr)
    const totalAtrHistory: number[] = [];
    for (let i = 0; i < noiseAtr.length; i++) {
      totalAtrHistory.push(noiseAtr[i] + trendAtr[i]);
    }
    const recent5Atr = totalAtrHistory.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const prev5Atr = totalAtrHistory.slice(-10, -5).reduce((a, b) => a + b, 0) / 5;
    const atrContraction = recent5Atr < prev5Atr * 0.85;
    const atrExpansion = recent5Atr > prev5Atr * 1.15;

    // ============ Step 4: VCP 結構 (v2.0.0 Phase 2: 重寫跟 Minervini 標準) ============
    const vcp = this.detectVcpMinervini(klines, 60);
    const vcpDetected = vcp.detected;
    const vcpContractions = vcp.contractions;
    const vcpHigherLows = vcp.higherLows;
    const vcpVolTightening = vcp.volTightening;
    const vcpStage2 = vcp.stage2Uptrend;

    // v2.0.0 A4 MODULE_PARTIAL warning: VCP 結構 partial 確認
    if (!vcpDetected && vcpContractions >= 1 && vcpContractions < 2) {
      warnings.push(makeWarning(
        'warning', 'M6', 'MODULE_PARTIAL',
        `VCP 結構 partial 確認 (只 ${vcpContractions} 個 contraction, 唔夠 2 個)`,
        `VCP detection 揾到 ${vcpContractions} 個 swing pair, 唔符合 Minervini 標準 (>= 2 對 progressively smaller)`,
        { contractions: vcpContractions, higher_lows: vcpHigherLows, symbol }
      ));
    }

    // ============ Step 5: Follow-through (v2.0.0 A5 fix) ============
    const recentRange = recent.slice(-cfg.followThroughDays);
    const prevRange = recent.slice(-cfg.followThroughDays * 2, -cfg.followThroughDays);
    const recentHigh = Math.max(...recentRange.map(k => k.high));
    const recentLow = Math.min(...recentRange.map(k => k.low));
    const prevHigh = Math.max(...prevRange.map(k => k.high));
    const prevLow = Math.min(...prevRange.map(k => k.low));
    const isBreakoutUp = recentHigh > prevHigh * 1.01;
    const isBreakoutDown = recentLow < prevLow * 0.99;
    const isBreakoutAttempt = isBreakoutUp || isBreakoutDown;

    let followScore = 0;
    let volumeDecay = 0;
    let priceProgression = 0;
    let breakoutDirection: 'up' | 'down' | 'none' = 'none';

    if (isBreakoutAttempt) {
      if (isBreakoutUp) {
        breakoutDirection = 'up';
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
      } else if (isBreakoutDown) {
        breakoutDirection = 'down';
        const closes = recentRange.map(k => k.close);
        const lower = closes.slice(1).filter((c, i) => c < closes[i]).length;
        priceProgression = lower / (closes.length - 1);
        const minLowIdx = recentRange.findIndex(k => k.low === recentLow);
        const breakoutDayVol = recentRange[minLowIdx].volume;
        const postVols = recentRange.slice(minLowIdx + 1);
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

    // ============ Step 6: 失敗模式 (v2.0.0 A5 fix) ============
    let failureMode: FailureMode = 'none';
    let failureReason: string | null = null;
    if (isSqueeze && latestNoiseAtr > latestTrendAtr * 2) {
      failureMode = 'noisy_squeeze';
      failureReason = 'Squeeze 期間 Noise ATR 過高,結構不穩定';
    } else if (isBreakoutUp && followScore < 0.4) {
      failureMode = 'weak_follow_through';
      failureReason = '向上突破後跟進無力,可能是假突破';
    } else if (!isBreakoutAttempt && !isSqueeze && regime === 'choppy') {
      failureMode = 'no_setup';
      failureReason = '冇明確 setup (冇 squeeze 冇 breakout + choppy 環境)';
    }

    // ============ Step 7: 入場評分 (v2.0.0 A6 fix: 加 bearish) ============
    const failureMaxCap = failureMode !== 'none' ? 0.4 : 1.0;
    let entryScore = 0;
    let setupType: SetupType = 'no_clear_setup';
    let riskReward = 0;

    const wasSqueeze = squeezeHistory[lastIdx - 1] || false;
    if (!isSqueeze && wasSqueeze && qualityScore >= qualityThreshold && failureMode !== 'weak_follow_through') {
      if (momentumDir === 'bull') {
        entryScore = 0.95 * failureMaxCap;
        setupType = 'mtf_squeeze_fire';
        riskReward = 3.5;
      } else if (momentumDir === 'bear') {
        entryScore = 0.85 * failureMaxCap;
        setupType = 'bear_squeeze_fire';
        riskReward = 3.0;
      } else {
        entryScore = 0.90 * failureMaxCap;
        setupType = 'mtf_squeeze_fire';
        riskReward = 3.0;
      }
    } else if (vcpDetected && vcpVolTightening && followScore >= 0.5 && breakoutDirection === 'up' && failureMode !== 'noisy_squeeze') {
      entryScore = 0.9 * failureMaxCap;
      setupType = 'confirmed_vcp_breakout';
      riskReward = 3.0;
    } else if (isGenuineSqueeze && qualityScore >= 0.75) {
      entryScore = 0.55 * failureMaxCap;
      setupType = 'genuine_squeeze_forming';
    } else if (latestNoiseAtr < latestTrendAtr * 0.5 && regime === 'trending' && followScore >= 0.6 && momentumDir !== 'bear') {
      entryScore = 0.7 * failureMaxCap;
      setupType = 'clean_trend_expansion';
      riskReward = 2.0;
    } else if (latestNoiseAtr < latestTrendAtr * 0.5 && regime === 'trending' && followScore >= 0.6 && momentumDir === 'bear') {
      entryScore = 0.65 * failureMaxCap;
      setupType = 'clean_trend_breakdown';
      riskReward = 2.0;
    // v2.0.1 D: 新加 regime_pass_setup (大少 2026-09-10 11:30 Spec Sync #54)
    // 凡人話: regimeGate=PASS (Hurst+ADX 兩招過, 確認有真 trend) 但冇任何 5 種 setup
    // 對齊 §M4 cross-module alignment 永久 rule: M6 setup 一定要同 M1 確認大方向
    // 條件: regimeGate=PASS + 唔 trigger noisy_squeeze/weak_follow_through + 冇 5 種 setup
    // 評分 0.45 (比 no_clear_setup 0.25 高, 但比 5 種 setup 0.55-0.95 低, 提醒「有方向等突破」)
    } else if (regimePassed && failureMode === 'none' && !isSqueeze) {
      entryScore = 0.45 * failureMaxCap;
      setupType = 'regime_pass_setup';
      riskReward = 0;  // 等突破, 唔入場
    } else {
      entryScore = 0.25;
      setupType = 'no_clear_setup';
    }

    // v2.0.0 A2: M1 state filter (對齊 §M4 M1 filter Spec Sync #52 永久 rule)
    let m1FilterApplied = false;
    if (m1State) {
      if ((m1State === 'DOWN' || m1State === 'SIDEWAYS') && ['mtf_squeeze_fire', 'confirmed_vcp_breakout', 'clean_trend_expansion', 'genuine_squeeze_forming'].includes(setupType)) {
        warnings.push(makeWarning(
          'warning', 'M6', 'FALLBACK_USED',
          `M1 state=${m1State} 同 M6 bullish setup 矛盾`,
          `M1 答 ${m1State}, 但 M6 出 ${setupType} (bullish) — 大環境唔配合`,
          { m1_state: m1State, m6_setup: setupType, symbol }
        ));
        entryScore *= 0.5;
        m1FilterApplied = true;
      } else if ((m1State === 'UP' || m1State === 'SIDEWAYS') && ['bear_squeeze_fire', 'clean_trend_breakdown'].includes(setupType)) {
        warnings.push(makeWarning(
          'warning', 'M6', 'FALLBACK_USED',
          `M1 state=${m1State} 同 M6 bearish setup 矛盾`,
          `M1 答 ${m1State}, 但 M6 出 ${setupType} (bearish) — 大環境唔配合`,
          { m1_state: m1State, m6_setup: setupType, symbol }
        ));
        entryScore *= 0.5;
        m1FilterApplied = true;
      }
    }

    // ============ Step 8: 12 條 rule S1-S12 觸發 (v2.0.0 I6 fix) ============
    const matchedRules: MatchedRule[] = [];
    if (isSqueeze) matchedRules.push({ id: 'S1', label: '日線 Squeeze', strength: 'medium' });
    if (isSqueeze && qualityScore >= qualityThreshold) matchedRules.push({ id: 'S2', label: 'Squeeze 質量高', strength: 'medium' });
    if (isSqueeze && squeezeDuration >= cfg.squeezeMinDuration) matchedRules.push({ id: 'S3', label: 'Squeeze 持續夠耐', strength: 'medium' });
    if (snr > 2) matchedRules.push({ id: 'S4', label: '趨勢 ATR 強', strength: 'strong' });
    if (snr < 0.5) matchedRules.push({ id: 'S5', label: '噪音 ATR 高', strength: 'strong' });
    if (atrContraction) matchedRules.push({ id: 'S6', label: '結構性收縮', strength: 'medium' });
    if (atrExpansion) matchedRules.push({ id: 'S7', label: '結構性擴張', strength: 'medium' });
    if (isSqueeze && volumeConcentration > 0.6) matchedRules.push({ id: 'S8', label: '籌碼集中', strength: 'medium' });
    if (vcpDetected) matchedRules.push({ id: 'S9', label: 'VCP 結構 (Minervini)', strength: 'medium' });
    if (vcpVolTightening) matchedRules.push({ id: 'S10', label: 'VCP 量縮確認', strength: 'medium' });
    if (followScore >= 0.5) matchedRules.push({ id: 'S11', label: '突破跟進', strength: 'medium' });
    if (failureMode !== 'none') matchedRules.push({ id: 'S12', label: `失敗模式 (${failureMode})`, strength: 'strong' });

    // ============ Step 9: 勝率估算 ============
    let baseWin: number;
    if (setupType === 'mtf_squeeze_fire') baseWin = 0.75;
    else if (setupType === 'confirmed_vcp_breakout') baseWin = 0.70;
    else if (setupType === 'clean_trend_expansion') baseWin = 0.62;
    else if (setupType === 'genuine_squeeze_forming') baseWin = 0.50;
    else if (setupType === 'bear_squeeze_fire') baseWin = 0.68;
    else if (setupType === 'clean_trend_breakdown') baseWin = 0.58;
    else baseWin = 0.35;
    if (failureMode === 'weak_follow_through') baseWin -= 0.12;
    if (failureMode === 'noisy_squeeze') baseWin -= 0.10;
    if (failureMode === 'no_setup') baseWin -= 0.05;
    const winProbability = Math.min(0.82, Math.max(0.25, baseWin));

    // v2.0.0 A5: Self-check penalty (對齊 §M2 self-check penalty Spec Sync #48 永久 rule)
    const originalConfidence = entryScore;
    let selfCheckTriggered = false;
    const criticalOrWarningCount = warnings.filter(w => w.level === 'critical' || w.level === 'warning').length;
    if (criticalOrWarningCount > 0 && entryScore > 0.3) {
      entryScore = Math.max(entryScore * 0.375, 0.3);
      selfCheckTriggered = true;
    }

    // v2.0.0 A4: THRESHOLD_BREACH warning
    if (entryScore < 0.3) {
      warnings.push(makeWarning(
        'warning', 'M6', 'THRESHOLD_BREACH',
        `entry_score ${entryScore.toFixed(3)} < 0.3 門檻, 唔建議落單`,
        `最終 entry_score ${entryScore.toFixed(3)} 低過 0.3 信心門檻, M6 verdict 唔可信`,
        { entry_score: Math.round(entryScore * 10000) / 10000, original_confidence: Math.round(originalConfidence * 10000) / 10000, symbol }
      ));
    }

    // ============ Step 10: 組裝輸出 (v2.0.0 A6 fix) ============
    const cycle: 'uptrend' | 'downtrend' | 'sideways' =
      (setupType === 'mtf_squeeze_fire' || setupType === 'confirmed_vcp_breakout' || setupType === 'clean_trend_expansion') ? 'uptrend' :
      (setupType === 'bear_squeeze_fire' || setupType === 'clean_trend_breakdown') ? 'downtrend' : 'sideways';
    const cycleLabel = entryScore >= 0.8 ? '高質量蓄力' :
      (setupType === 'bear_squeeze_fire' || setupType === 'clean_trend_breakdown') && entryScore >= 0.6 ? '高質量沽空' :
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
      warnings,
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
          contractions: vcpContractions,
          higherLows: vcpHigherLows,
          volTightening: vcpVolTightening,
          stage2Uptrend: vcpStage2,
          depths: vcp.depths,
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
          direction: breakoutDirection,
        },
        matchedRules: matchedRules.map(r => r.id),
        ruleLabels: matchedRules.map(r => r.label),
        rulesFired: matchedRules.length,
        atr: Math.round(atrValue * 100) / 100,
        bbWidth: Math.round(bbWidth * 100) / 100,
        kcWidth: Math.round(kcWidth * 100) / 100,
        priceCV: Math.round(priceCV * 10000) / 10000,
        volumeConcentration: Math.round(volumeConcentration * 10000) / 10000,
        // v2.0.0 A1 audit field
        hurst: Math.round(hurstValue * 10000) / 10000,
        adx: Math.round(adxValue * 100) / 100,
        regimeGate: regimePassed ? 'PASS' : 'FAIL',
        // v2.0.0 A7 momentum histogram
        momentumHistogram: Math.round(momentumHist * 10000) / 10000,
        momentumDir,
        // v2.0.0 A2 M1 state
        m1State,
        m1FilterApplied,
        // v2.0.0 A5 self-check penalty
        selfCheckTriggered,
        originalConfidence: Math.round(originalConfidence * 10000) / 10000,
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

  /**
   * v2.0.0 A7: TTM Squeeze Momentum Histogram
   * 對齊 John Carter 2005 standard: smoothed linear regression of close
   */
  private computeMomentumHistogram(klines: KLine[], period: number = 20): { momentumHist: number; momentumDir: 'bull' | 'bear' | 'flat' } {
    if (klines.length < period + 5) return { momentumHist: 0, momentumDir: 'flat' };
    const closes = klines.slice(-(period + 5)).map(k => k.close);
    const n = closes.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = closes;
    const xMean = x.reduce((a, b) => a + b, 0) / n;
    const yMean = y.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - xMean;
      const dy = y[i] - yMean;
      num += dx * dy;
      den += dx * dx;
    }
    const slope = den > 0 ? num / den : 0;
    const momentum = yMean > 0 ? (slope * n) / yMean : 0;
    let dir: 'bull' | 'bear' | 'flat' = 'flat';
    if (momentum > 0.005) dir = 'bull';
    else if (momentum < -0.005) dir = 'bear';
    return { momentumHist: momentum, momentumDir: dir };
  }

  /**
   * v2.0.0 Phase 2: VCP detection 跟 Mark Minervini 標準
   * 凡人話: 2-5 個 progressively smaller pullback + higher low + 量縮 + Stage 2 uptrend
   */
  private detectVcpMinervini(klines: KLine[], lookback: number = 60): {
    detected: boolean;
    contractions: number;
    higherLows: boolean;
    volTightening: boolean;
    stage2Uptrend: boolean;
    isProgressivelySmaller: boolean;
    depths: number[];
    reason: string;
  } {
    if (klines.length < lookback + 50) {
      return { detected: false, contractions: 0, higherLows: false, volTightening: false, stage2Uptrend: false, isProgressivelySmaller: false, depths: [], reason: '數據不足' };
    }

    const segment = klines.slice(-lookback);

    // Step 1: 拎 swing high / low
    const highs: Array<{ idx: number; price: number }> = [];
    const lows: Array<{ idx: number; price: number }> = [];
    for (let i = 4; i < segment.length - 4; i++) {
      let isHigh = true, isLow = true;
      for (let j = i - 3; j <= i + 3; j++) {
        if (j === i) continue;
        if (segment[j].high >= segment[i].high) isHigh = false;
        if (segment[j].low <= segment[i].low) isLow = false;
      }
      if (isHigh) highs.push({ idx: i, price: segment[i].high });
      if (isLow) lows.push({ idx: i, price: segment[i].low });
    }

    if (highs.length < 2 || lows.length < 2) {
      return { detected: false, contractions: 0, higherLows: false, volTightening: false, stage2Uptrend: false, isProgressivelySmaller: false, depths: [], reason: 'swing points 不足' };
    }

    // Step 2: 拎 contraction depths
    const minIdx = Math.min(highs.length, lows.length);
    const contractions: number[] = [];
    const pairLows: number[] = [];
    for (let i = 0; i < minIdx; i++) {
      const highPrice = highs[i].price;
      const lowPrice = lows[i].price;
      if (highPrice <= 0) continue;
      const depth = (highPrice - lowPrice) / highPrice;
      contractions.push(depth);
      pairLows.push(lowPrice);
    }

    if (contractions.length < 2) {
      return { detected: false, contractions: contractions.length, higherLows: false, volTightening: false, stage2Uptrend: false, isProgressivelySmaller: false, depths: contractions.map(d => Math.round(d * 10000) / 10000), reason: 'contractions 不足 2 對' };
    }

    // Step 3: progressively smaller (C1 > C2 > C3 ...)
    let isProgressivelySmaller = true;
    for (let i = 1; i < contractions.length; i++) {
      if (contractions[i] > contractions[i - 1] * 0.7) {
        isProgressivelySmaller = false;
        break;
      }
    }

    // Step 4: higher lows
    let higherLows = true;
    for (let i = 1; i < pairLows.length; i++) {
      if (pairLows[i] <= pairLows[i - 1]) {
        higherLows = false;
        break;
      }
    }

    // Step 5: 量縮確認
    let volTightening = false;
    if (segment.length >= 20) {
      const lastHighIdx = highs[highs.length - 1].idx;
      const lastLowIdx = lows[lows.length - 1].idx;
      const contractionStart = Math.min(lastHighIdx, lastLowIdx);
      const contractionEnd = Math.max(lastHighIdx, lastLowIdx);
      if (contractionStart < contractionEnd && contractionEnd - contractionStart >= 3) {
        const contractionVols = segment.slice(contractionStart, contractionEnd + 1).map(k => k.volume);
        const priorVols = segment.slice(Math.max(0, contractionStart - 10), contractionStart).map(k => k.volume);
        if (contractionVols.length > 0 && priorVols.length > 0) {
          const contractionAvg = contractionVols.reduce((a, b) => a + b, 0) / contractionVols.length;
          const priorAvg = priorVols.reduce((a, b) => a + b, 0) / priorVols.length;
          volTightening = contractionAvg < priorAvg * 0.6;
        }
      }
    }

    // Step 6: Stage 2 uptrend filter
    let stage2Uptrend = false;
    if (klines.length >= 200) {
      const ma200Now = klines.slice(-200).reduce((a, k) => a + k.close, 0) / 200;
      const ma200Prev = klines.slice(-220, -20).reduce((a, k) => a + k.close, 0) / 200;
      const currentClose = klines[klines.length - 1].close;
      stage2Uptrend = ma200Now > ma200Prev && currentClose > ma200Now * 0.85;
    }

    const detected = isProgressivelySmaller && higherLows && volTightening && stage2Uptrend && contractions.length >= 2;

    return {
      detected,
      contractions: contractions.length,
      higherLows,
      volTightening,
      stage2Uptrend,
      isProgressivelySmaller,
      depths: contractions.map(d => Math.round(d * 10000) / 10000),
      reason: detected ? 'OK' : `progressively_smaller=${isProgressivelySmaller}, higher_lows=${higherLows}, vol_tightening=${volTightening}, stage2=${stage2Uptrend}`,
    };
  }
}

// =============================================================
// 大少 2026-09-10 — Spec Sync #54 — M6 v2.0.0 standard verdict wrapper
// =============================================================
/** M6 Volatility v2.0.0 嘅 standard verdict wrapper
 *  @example
 *    const sv = await toStandardVerdictVOL(klines, { symbol: 'HK.00700', ltf: '1d' });
 *    console.log(sv.base_weight);  // 0.10
 */
export async function toStandardVerdictVOL(
  klines: KLine[],
  ctx: CycleContext,
  config: VolatilityConfig = DEFAULT_VOLATILITY_CONFIG,
): Promise<ModuleStandardVerdict> {
  return runAndStandardize(new VolatilityModule(config), klines, ctx, 'volatility');
}

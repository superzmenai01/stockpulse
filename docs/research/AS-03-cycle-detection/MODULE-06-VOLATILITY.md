# AS-03 · Module 6: 波動率與市場結構收縮擴張檢測法 v2.0.0 (Volatility & Squeeze Detector)

> **對應 docx**: `docs/演算法概念SPECS/06波動率與市場結構收縮擴張檢測法.docx` v2.0
> **對應 TS 檔**: `algorithms/AS-03-cycle-detection/modules/volatility.ts` v2.0.0
> **對應 backend**: `backend/algorithms/volatility/algorithm.py` v2.0.0 (1:1 port 同步)
> **對應 tests**: `algorithms/AS-03-cycle-detection/__tests__/volatility.test.mjs`
> **對應 adapter**: `algorithms/AS-03-cycle-detection/adapter.mjs` (`volatilityAdapter`)
> **最後更新**: 2026-09-10 (大少 Spec Sync #54) — 對齊 M3/M4 永久 rule + 修 5 個 critical bug

---

## 1. 點解呢個 module (Why)

前五個 module 答「**而家係咩季節 + 有冇錢跟 + 突破真假**」 — 趨勢 / 結構 / 支撐壓力 / 動能 / 量价。

呢個 module 6 答「**而家係咪蓄力 / 爆發 / 噪音**」 — **波動率結構**。

兩個核心 insight:
- **波動率收縮 = 蓄力** — 當波動率跌到極低 (Squeeze), 後續通常有大波動
- **波動率擴張 = 趨勢 / 噪音** — Trend ATR 強 = 真趨勢, Noise ATR 強 = 假突破 / 噪音

v2.0 spec 嘅 9 個根治:
- 1: Squeeze 只看日線 BB vs KC, 無視大週期 → 多時間框架共振 (簡化為 daily only, 留 weekly 給 Stage 2)
- 2: VCP 用固定 5 日窗口 → RANSAC 擬合 (簡化為 simple linear regression)
- 3: ATR 總值斜率 → 分解為 Trend ATR + Noise ATR
- 4: 入場評分條件堆疊 → 動態權重決策樹
- 5: 無視突破後跟進 → Follow-through 評分
- 6: 無視大盤波動 → Beta 調整 (optional, fallback if no market data)
- 7: 無法識別假 Squeeze → Squeeze 質量評分
- 8: VCP 無量縮確認 → 量縮確認
- 9: 無失敗模式學習 → 失敗模式庫 (簡化 5→3 種)

## 2. 跟其他 module 嘅協同

| Module | 佢答嘅問題 | 呢個 module 補充 |
|---|---|---|
| M1-M3 | 趨勢 / 結構 / 支撐壓力 | 「波動率收縮到極低, 即將有大波動」 |
| M4 Indicators | 動能背馳 | 「動能見底 + Squeeze 蓄力 = 突破在即」 |
| M5 VolumePrice | 量价突破 | 「假突破 vs 真突破, 睇 Trend ATR 同 Noise ATR」 |
| **M6 Volatility** | **蓄力 / 爆發 / 噪音** | **「波動率結構 + 入場時機」** |

**典型用法**:
- M1+M2+M3+M4+M5 全部話「上升」,M6 話「黃金 Squeeze Fire 向上」→ 高勝率突破
- M1+M2+M3+M4+M5 話「上升」,M6 話「noisy_squeeze」→ 假突破風險
- M6 嘅核心 output 係 `entry_timing.score` + `setup_type` + `win_probability`

## 3. 輸入

| Field | Type | Required | Default | 說明 |
|-------|------|----------|---------|------|
| `klines` | KLine[] | ✅ | — | 日線歷史 K 線, 按日期升序 |
| `bbPeriod` | int | ❌ | 20 | Bollinger Band 週期 |
| `bbStd` | float | ❌ | 2.0 | BB 標準差倍數 |
| `kcPeriod` | int | ❌ | 20 | Keltner Channel 週期 |
| `kcAtrMult` | float | ❌ | 1.5 | KC ATR 倍數 |
| `atrPeriod` | int | ❌ | 14 | ATR 週期 |
| `squeezeMinDuration` | int | ❌ | 3 | Squeeze 最少持續日數 |
| `followThroughDays` | int | ❌ | 5 | 突破後跟進檢測天數 |
| `vcpTolerancePct` | float | ❌ | 0.02 | VCP 高低點遞減容忍度 |
| `vcpMinWindows` | int | ❌ | 2 | VCP 最少需要幾個高低點對 |

**Min data**: `MAX(100, bbPeriod + 50 + followThroughDays + 10)` = 20+50+5+10 = **85 條**

## 4. 輸出

```typescript
interface VolatilityVerdict {
  symbol: string;
  cycle: 'uptrend' | 'downtrend' | 'sideways';
  cycleLabel: string;
  confidence: number;                       // 0~1
  state: 'UP' | 'DOWN' | 'SIDEWAYS' | 'TRANSITION';

  squeeze: {
    isSqueeze: boolean;
    duration: number;                       // 連續 Squeeze 日數
    qualityScore: number;                    // 0~1 (價格集中 + 成交量熵)
    isGenuine: boolean;                      // qualityScore >= 0.6
  };

  vcpStructure: {
    detected: boolean;                       // VCP 結構
    highLowPairs: number;                    // 高低點對數
    volTightening: boolean;                  // 量縮確認
  };

  atrDecomposition: {
    totalAtr: number;                        // 總 ATR
    trendAtr: number;                       // 趨勢性 ATR (用 linear regression residual)
    noiseAtr: number;                        // 噪音 ATR
    snr: number;                             // Signal-to-Noise Ratio
    regime: 'trending' | 'balanced' | 'choppy';
  };

  followThrough: {
    followScore: number;                    // 0~1
    volumeDecay: number;                    // 突破後 vol 衰減
    priceProgression: number;               // 價格推進
  };

  failureMode: 'none' | 'noisy_squeeze' | 'weak_follow_through' | 'no_setup';
  failureReason: string | null;

  entryTiming: {
    score: number;                          // 0~1
    setupType: 'mtf_squeeze_fire' | 'confirmed_vcp_breakout' | 'genuine_squeeze_forming'
             | 'clean_trend_expansion' | 'no_clear_setup';
    riskReward: number;                     // R:R estimate
  };

  winProbability: number;                   // 0~1
  matchedRules: Array<{ id: string; label: string; strength: 'strong' | 'medium' | 'weak' }>;
  interpretation: string;
  warnings: string[];

  meta: {
    matchedRules: string[];
    ruleLabels: string[];
    atr: number;
    bbWidth: number;
    kcWidth: number;
    priceCV: number;                        // 價格變異係數
    volumeConcentration: number;            // 成交量集中度
    configUsed: VolatilityConfig;
    dataDays: number;
  };

  timestamp: number;
}
```

## 5. 算法步驟

### Step 0: 輸入驗證
- min data = 85 條, 唔夠就 default verdict + emit INSUFFICIENT_DATA (critical) warning

### Step 0.5: Hurst+ADX Regime Gate (v2.0.0 新加, 對齊 §M3 Hurst+ADX gate Spec Sync #45 永久 rule)
- 凡人話: random walk / mean-reverting 弱趨勢 stock 唔好亂話 squeeze fire, 永遠 hold
- 兩招確認: Hurst 指數 (DFA, 100 日) + ADX (Wilder 14 日)
- **H < 0.45 OR ADX < 20** → emit 1 個 CONFLICT_STATE warning (info level) + 繼續行
- 對齊 M4 v0.3.0 Option 1: 唔好 early return, verdict 仍然 SIDEWAYS 0.3
- meta 永遠 emit `hurst` + `adx` + `regimeGate` 3 個 audit field

### Step 0.7: M1 State Filter (v2.0.0 新加, 對齊 §M4 M1 state filter Spec Sync #52 永久 rule)
- 凡人話: 大環境 DOWN 嗰陣唔好亂話 bullish setup, 大環境 UP 嗰陣唔好亂話 bearish setup
- algorithm_runner.py 統一 inject `options["m1State"]` 落 M6
- **M1=DOWN/SIDEWAYS 但 M6 出 bullish setup** → FALLBACK_USED warning + entry score 折 0.5x
- **M1=UP/SIDEWAYS 但 M6 出 bearish setup** → FALLBACK_USED warning + entry score 折 0.5x
- meta 永遠 emit `m1State` + `m1FilterApplied` 2 個 audit field

### Step 1: 計算基礎指標
- **ATR (14)**: Wilder smoothing
- **Bollinger Band (20, 2σ)**: SMA20 ± 2σ
- **Keltner Channel (20, 1.5 ATR)**: SMA20 ± 1.5 × ATR
- **BB Width** = (BB_upper - BB_lower) / SMA20
- **KC Width** = (KC_upper - KC_lower) / SMA20

### Step 1.5: Momentum Histogram (v2.0.0 新加, 對齊 TTM Squeeze John Carter 2005 standard)
- 凡人話: TTM Squeeze 標準做法有 3 個 component — BB + KC + Momentum Histogram
- 過去 20 日 close 做 linear regression → 拎 slope → normalize by close
- **momentumHistogram > 0.005** = bull, **< -0.005** = bear, 中間 = flat
- meta 永遠 emit `momentumHistogram` + `momentumDir` 2 個 field

### Step 2: Squeeze 檢測 (核心)
- **isSqueeze = BB_width < KC_width** (i.e. BB 喺 KC 入面)
- **duration** = 連續 isSqueeze=true 嘅日數
- **Squeeze 質量評分**:
  - `priceCV = STD(close) / AVG(close)` (低 = 集中)
  - `volumeConcentration` = 1 - entropy / max_entropy (高 = 集中)
  - `qualityScore = is_horizontal ? 0.3 : 0 + volumeConcentration × 0.4 + (1 - min(1, priceCV/0.03)) × 0.3`
  - `isGenuine = qualityScore >= 0.6 AND duration >= squeezeMinDuration`

### Step 3: ATR 分解 (Trend vs Noise)
- Linear regression 過去 20 日 close
- **trendComponent** = AVG(|high - predicted| + |low - predicted|) / 2 (趨勢線附近波動)
- **noiseComponent** = AVG(|residual|) (殘差 = 純噪音)
- **snr = trendComponent / noiseComponent** (if noise > 0, else 10)
- **regime = snr > 2 ? 'trending' : snr < 0.5 ? 'choppy' : 'balanced'**

### Step 4: VCP 結構檢測 (v2.0.0 重寫跟 Mark Minervini 標準)
- **凡人話**: 跟 Mark Minervini VCP 教科書標準 — 2-5 個 progressively smaller pullback + higher low + 量縮 + Stage 2 uptrend
- **Lookback 20 日 → 60 日** (對齊 Minervini 標準窗口)
- **Step 4.1**: 拎 swing high / low (rolling 5 日 max/min, 對齊 frontend 簡化)
- **Step 4.2**: 拎 contraction depths (high → low 跌幅) — 需要 ≥ 2 對
- **Step 4.3**: progressively_smaller = 每個 contraction ≤ 70% 之前
- **Step 4.4**: higher_lows = 每個 contraction low 比之前高
- **Step 4.5**: vol_tightening = 最後 contraction 嘅 vol < avg vol × 60%
- **Step 4.6**: stage2_uptrend = 200-day MA sloping up + current close > 200 MA × 0.85
- **VCP detected = progressively_smaller AND higher_lows AND vol_tightening AND stage2_uptrend AND contractions >= 2**

### Step 5: Follow-through 評分 (v2.0.0 fix 邏輯矛盾)
- 過去 followThroughDays 日 vs 之前 followThroughDays 日
- **isBreakoutUp** = 近期高 > 之前高 × 1.01
- **isBreakoutDown** = 近期低 < 之前低 × 0.99 (v2.0.0 新加)
- **isBreakoutAttempt = isBreakoutUp OR isBreakoutDown**
- **v2.0.0 fix**: 之前 downward breakout 仍然 trigger weak_follow_through → 邏輯錯, 而家分方向計 follow_score
- 向上突破: price_progression = close 升嘅比率, volume_decay = 突破日量大 + 後續縮
- 向下突破: price_progression = close 跌嘅比率, volume_decay 同上
- **followScore = (volumeDecay × 0.5 + priceProgression × 0.5)**
- meta 加 `direction: 'up' | 'down' | 'none'` 標示突破方向

### Step 6: 失敗模式 (3 種, v2.0.0 fix upward only)
- **noisy_squeeze**: Squeeze 但 noise_atr > trend_atr × 2 (表面 squeeze 內部震盪)
- **weak_follow_through**: 向上突破 AND followScore < 0.4 (v2.0.0 fix: 唔再對 downward breakout 誤判)
- **no_setup**: 冇 squeeze 冇 breakout + choppy 環境 (v2.0.0 新加補返 spec 講 3 種失敗模式)

### Step 7: 入場評分 (v2.0.0 加 bearish setup, 對齊 TTM Squeeze 標準)
- **A 黃金 Squeeze Fire** (0.95): 之前 Squeeze → 而家 NOT Squeeze + quality >= 0.7 + momentum bull
- **A' 沽空 Squeeze Fire** (0.85, v2.0.0 新加): 之前 Squeeze → 而家 NOT Squeeze + quality >= 0.7 + momentum bear
- **B 確認 VCP 突破** (0.9): VCP detected (Minervini) + volTightening + follow >= 0.5 + direction=up
- **C 真 Squeeze 蓄力** (0.55): isGenuine + quality >= 0.75 (仲未突破, 觀望中)
- **D 乾淨趨勢擴張** (0.7): noise < trend × 0.5 + regime=trending + follow >= 0.6 + momentum ≠ bear
- **D' 趨勢沽空** (0.65, v2.0.0 新加): noise < trend × 0.5 + regime=trending + follow >= 0.6 + momentum=bear
- **E 觀望** (0.25): 其他

### Step 7.5: Self-Check Penalty (v2.0.0 新加, 對齊 §M2 self-check penalty Spec Sync #48 永久 rule)
- 拎 critical + warning level self-check warning 觸發 conf floor 0.3
- 公式 `max(conf × 0.375, 0.3)` — 原本 conf 0.8 → 0.3, 0.56 → 0.3
- info level (CONFLICT_STATE) 唔觸發 floor
- state 唔變, 由 M7 layer 處理 weight 折扣
- meta 永遠 emit `selfCheckTriggered: bool` + `originalConfidence: float` 2 個 audit field

### Step 7.6: Self-Check Warning Emit (v2.0.0 新加, 對齊 §M2 + §M3 + §M4 永久 rule)
- **INSUFFICIENT_DATA** (critical) — K 線唔夠 85 條
- **CONFLICT_STATE** (info) — Hurst+ADX gate 唔過 OR noisy_squeeze
- **FALLBACK_USED** (warning) — M1 state 同 M6 setup 矛盾
- **THRESHOLD_BREACH** (warning) — 最終 conf < 0.3 門檻
- **MODULE_PARTIAL** (warning) — VCP 結構 partial 確認 (1 contraction < 2)
- 統一用 `make_warning()` / `makeWarning()` ModuleWarning object

### Step 8: 12 條 rule S1-S12

| ID | 名 | 條件 | Strength |
|----|----|------|----------|
| **S1** | 日線 Squeeze | BB_width < KC_width | medium |
| **S2** | Squeeze 質量高 | qualityScore >= 0.6 | medium |
| **S3** | Squeeze 持續夠耐 | duration >= squeezeMinDuration | medium |
| **S4** | 趨勢 ATR 強 | snr > 2 (trending) | strong |
| **S5** | 噪音 ATR 高 | snr < 0.5 (choppy) | strong (反向) |
| **S6** | 結構性收縮 | ATR 下降趨勢 (最近 5 日 < 之前 5 日 × 0.85) | medium |
| **S7** | 結構性擴張 | ATR 上升趨勢 (最近 5 日 > 之前 5 日 × 1.15) | medium |
| **S8** | 籌碼集中 | volumeConcentration > 0.6 | medium |
| **S9** | VCP 結構 | VCP detected (高低點遞減) | medium |
| **S10** | VCP 量縮確認 | volTightening | medium |
| **S11** | 突破跟進 | followScore >= 0.5 | medium |
| **S12** | 失敗模式 | noisy_squeeze / weak_follow_through | strong (反向) |

### Step 9: 勝率估算
- baseWin: 0.75 (mtf_squeeze_fire) / 0.70 (vcp_breakout) / 0.62 (trend_expansion) / 0.50 (genuine_squeeze) / 0.35 (no_setup)
- 失敗模式: -0.08
- CLAMP [0.25, 0.82]

### Step 10: 組裝輸出

## 6. Cycle State 統一 (v2.0.0 fix 加 DOWN)

- **uptrend**: setup = mtf_squeeze_fire OR confirmed_vcp_breakout OR clean_trend_expansion
- **downtrend** (v2.0.0 新加): setup = bear_squeeze_fire OR clean_trend_breakdown
- **sideways**: 其他 (genuine_squeeze_forming / no_clear_setup)
- **state**: UP / DOWN / SIDEWAYS (用 cycle 推導)

## 7. Adapter 設計

```javascript
export const volatilityAdapter = {
  id: 'AS-03-VOL',
  name: '波動率與市場結構收縮擴張 (Volatility & Squeeze)',
  version: '1.0.0',
  description: '用 12 條 rule-based 算法 (S1-S12) 檢測 Squeeze + ATR 分解 + 失敗模式',
  inputs: [
    { key: 'code', type: 'autocomplete', required: true, ... },
    { key: 'period', type: 'select', options: ['1d'], default: '1d' },
    { key: 'dataWindowDays', type: 'number', default: 100, min: 80, max: 500 },
  ],
  analyze: analyzeVolatility,
  renderResult: renderVolatilityResult,
  getHelp: getVolatilityHelp,
};
```

- **3 個 sections 永久 rule (大少 #11056)**: 📖 詳細解讀 + 🎯 策略建議 + 💡 點用點睇

## 8. 永久 Rules

- **Plain language 解釋**: 全部用白話解釋
- **Rule-based + additive confidence**: 唔做 multiplicative
- **List all matched rules**: 全部觸發 rules 列晒出嚟
- **Vague 描述要 confirm**: 「最近」要明確定義天數
- **3 個 sections permanent rule**: 📖 詳細解讀 + 🎯 策略建議 + 💡 點用點睇
- **Backend 數據對齊**: testing page 顯示實際/請求/數據限制
- **Cold cache wide-fetch**: 1d 必須取 30 年窗口

## 9. 📖 詳細解讀 (永久 rule #11056)

| Field | 點樣睇 |
|-------|--------|
| `cycle` | 「而家股票嘅波動率結構」 — 上升 / 下跌 / 橫行 |
| `cycleLabel` | 「高質量蓄力 / 假蓄力警告 / 趨勢延伸 / 趨勢衰竭 / 亂爆階段」 |
| `squeeze.isSqueeze` | 而家 BB 喺唔喺 KC 入面 (波動率收縮) |
| `squeeze.duration` | 連續收縮幾多日 (≥ 3 日先有意義) |
| `squeeze.qualityScore` | Squeeze 質量 0~1 (高 = 真蓄力, 低 = 假 Squeeze) |
| `squeeze.isGenuine` | 是否真 Squeeze (quality >= 0.6 AND duration >= 3) |
| `vcpStructure.detected` | VCP (Volatility Contraction Pattern) 結構 |
| `vcpStructure.volTightening` | VCP 期間成交量有冇遞減 |
| `atrDecomposition.snr` | 信噪比 (> 2 = 趨勢清晰, < 0.5 = 噪音) |
| `atrDecomposition.regime` | trending / balanced / choppy |
| `followThrough.followScore` | 突破後跟進力 0~1 (≥ 0.5 = 健康) |
| `failureMode` | 失敗模式 (noisy_squeeze / weak_follow_through / no_setup / none) |
| `entryTiming.score` | 入場評分 0~1 (≥ 0.8 = 高勝率) |
| `entryTiming.setupType` | 黃金 Squeeze Fire / VCP 突破 / 真 Squeeze 蓄力 / 乾淨趨勢 / 觀望 |
| `entryTiming.riskReward` | 風險回報比 (≥ 2.0 為佳) |
| `winProbability` | 估計勝率 0~1 |

## 10. 🎯 策略建議 (永久 rule #11056)

**5 種 setup × 對應動作**:

| Setup | 評分 | 動作 | 風險管理 |
|-------|------|------|----------|
| 🏆 mtf_squeeze_fire (0.95) | 黃金突破 | 立即入場 | 設止損喺 BB 下軌 |
| 🏆 vcp_breakout (0.9) | 教科書突破 | 確認後入場 | 止損喺最後低點下方 |
| ⏳ genuine_squeeze_forming (0.55) | 蓄力中 | 等待突破 | 唔好追入,等訊號 |
| 🟢 trend_expansion (0.7) | 趨勢延伸 | 順勢入場 | 跟隨趨勢止損 |
| 🟡 no_clear_setup (0.25) | 觀望 | 等方向 | 唔好入場 |

**失敗模式處理**:
- **noisy_squeeze**: 最高入場評分 0.4, 等 noise 收縮先入場
- **weak_follow_through**: 最高入場評分 0.4, 等下個 setup
- **choppy regime (SNR < 0.5)**: 觀望為主, 只做短線

## 11. 💡 點用 + 點睇 (永久 rule #11056)

10 步 step-by-step guide:

1. **先睇 `entryTiming.setupType` 同 `score`** — 5 種 setup, 越高越可信
2. **睇 `squeeze.isSqueeze` 同 `duration`** — 收縮中 (≥ 3 日) = 蓄力
3. **睇 `squeeze.qualityScore`** — ≥ 0.6 = 真 Squeeze, < 0.6 = 假 Squeeze
4. **睇 `atrDecomposition.snr` 同 `regime`** — trending 入場, choppy 觀望
5. **睇 `vcpStructure.detected` 同 `volTightening`** — VCP + 量縮 = 教科書
6. **睇 `followThrough.followScore`** — ≥ 0.5 = 突破後健康跟進
7. **睇 `failureMode`** — noisy_squeeze / weak_follow_through 都要降評分
8. **睇 `winProbability`** — ≥ 0.65 = 高勝率, < 0.45 = 低勝率
9. **永遠配合 M1-M5 一齊睇** — M6 嘅 setup 類型要同其他 module 一致先信
10. **永遠配合風險管理** — 止損位跟 setup 嘅 invalidation zone

**重要提醒**:
- Squeeze 只係「蓄力」,唔係「必然升」,要等 Squeeze Fire (squeezeEnd) 先做
- SNR 高 (trending) 先好入場,choppy 環境下止損會被 noise 觸發
- 失敗模式優先 — noisy_squeeze / weak_follow_through 最高入場 0.4

## 12. 對比 v1.0 → v2.0 (簡化版)

由於 testing page 唔支援 weekly_price_data + market_index_data,M6 v1.0 簡化 docx 06 v2.0 spec:
- 多時間框架 Squeeze 共振 → daily only (Stage 2 統一處理)
- 5 種失敗模式 → 3 種 (noisy_squeeze / weak_follow_through / no_setup)
- RANSAC → simple linear regression
- 大盤 Beta 調整 → fallback (冇 market data)
- VCP 結構 → 簡化為高低點遞減 (linear regression 替代 RANSAC)

## 13. 邊界條件

| 情境 | 處理 |
|------|------|
| ATR = 0 (所有 K 線相同) | fallback 1% 計算 bin |
| BB/KC width 同時 = 0 | 視為 squeeze |
| SNR 分母為 0 | snr = 10 (默認高信噪比) |
| 數據 < 85 日 | default verdict (cycle=SIDEWAYS, confidence=0) |
| 高低點只 1 對 | VCP not detected (需要 ≥ 2 對) |
| 突破 followThroughDays 內冇 breakout | followScore = 0 |

## 14. Workflow Status (大少 7-step)

| Step | Status |
|------|--------|
| 1. Spec (`MODULE-06-VOLATILITY.md`) | ⏳ In progress |
| 2. Code (`modules/volatility.ts`) | ⏸ Pending |
| 3. Config (`config.ts` v1.0 fields) | ⏸ Pending |
| 4. Tests (`__tests__/volatility.test.mjs`, 30+ assertions) | ⏸ Pending |
| 5. Adapter (`adapter.mjs` `volatilityAdapter`) | ⏸ Pending |
| 6. Testing page visual verify (HK.00700) | ⏸ Pending |
| 7. Commit + push | ⏸ Pending |

---

**Maintainer**: 大少 (zmen) + MiniMax Code
**Created**: 2026-08-07
**Version**: 1.0.0

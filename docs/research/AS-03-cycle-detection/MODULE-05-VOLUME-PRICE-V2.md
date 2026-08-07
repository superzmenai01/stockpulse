# AS-03 · Module 5: 成交量價格行為確認法 v2.0 (Volume-Price Action Confirmation)

> **對應 docx**: `docs/演算法概念SPECS/05成交量價格行為確認法.docx` (Kimi v2.0)
> **對應 TS 檔**: `algorithms/AS-03-cycle-detection/modules/volume.ts` (overwrite v1.0)
> **對應 tests**: `algorithms/AS-03-cycle-detection/__tests__/volume.test.mjs` (rewrite)
> **對應 adapter**: `algorithms/AS-03-cycle-detection/adapter.mjs` (`volumePriceAdapter`)

---

## 1. 點解呢個 module (Why)

前四個 module (MA Alignment / HL Structure / Trendline / Indicators) 答嘅係「**而家係咩季節 + 幾時行動**」 — 趨勢 / 結構 / 支撐壓力 / 動能。

呢個 module 5 v2.0 答「**呢個趨勢有冇錢跟 / 係咪真嘅**」 — **成交量同價格嘅關係**。

兩個核心 insight:
- **錢跟價 = 真升** — 股價升嘅同時成交量都放大,代表有新資金入場,趨勢可信
- **錢唔跟 = 假升** — 股價升但成交量縮(或者背馳),代表只係少量買盤撐住,見頂警號

v1.0 (10 rule K-T) 嘅 9 個硬傷:
- 突破只看單日成交量(易被異常量誤導)
- 縮量回調判斷太簡單
- OBV 簡單加減(唔考慮漲跌幅度)
- 密集區固定 1% 分箱(高低價股唔公平)
- 量价背馳窗口固定 5 日
- 無換手率概念
- 假突破無二次驗證
- 買入評分線性疊加(易過擬合)

v2.0 根治方法(對應 docx §1):
- 連續三日成交量模式 + 標準差過濾
- 回調深度-成交量相關係數(健康回調 = 負相關)
- 價格變化幅度加權 OBV(用 Tanh 封頂)
- ATR 動態分箱(高低價股統一標準)
- 滾動相關係數(動態檢測背馳)
- 相對歷史成交量百分位
- 突破後 N 日籌碼鎖定度
- 決策規則引擎(條件組合,唔係分數相加)

## 2. 跟其他 module 嘅協同 (跟 docx §6 一致)

| Module | 佢答嘅問題 | 呢個 module 補充 |
|---|---|---|
| MA Alignment (M1) | 「均線話而家係咩 season」 | 「均線話升,但成交量萎縮,可能係假升」 |
| HL Structure (M2) | 「峰谷結構」 | 「結構 HH/HL,但量价背馳,結構可能見頂」 |
| Trendline (M3) | 「支撐壓力」 | 「價格突破壓力線,但成交量唔配合,可能係假突破」 |
| Indicators (M4) | 「動能背馳 + 衰竭」 | 「動能見底,但成交量未確認,等資金入場先信」 |
| **M5 量价確認 v2.0** | **資金跟進 + 突破驗證** | **「呢個趨勢有冇錢跟 / 突破係咪真嘅」** |

**典型用法**:
- M1+M2+M3+M4 全部話「上升」,M5 話「溫和堆量突破 + OBV 同步」→ 黃金買點
- M1+M2+M3+M4 話「上升」,M5 話「量价背馳 + 假突破風險高」→ 暫時觀望
- M1+M2+M3+M4 話「上升」,M5 話「健康回調至 VWAP 支撐 + OBV 仍升」→ 回調買入點
- M5 嘅核心 output 係 `signal` (CONFIRM / DISCONFIRM / NEUTRAL) + `volumeRegime` (accumulation / distribution / neutral)

## 3. 輸入 (跟 docx §2)

| Field | Type | Required | Default | 說明 |
|-------|------|----------|---------|------|
| `klines` | KLine[] | ✅ | — | 歷史 K 線,按日期升序 |
| `sharesOutstanding` | int | ❌ | null | 流通股本(用於換手率,可選) |
| `volumePercentileLookback` | int | ❌ | 60 | 成交量歷史百分位回顧天數 |
| `breakoutConfirmDays` | int | ❌ | 3 | 突破確認天數 |
| `pullbackCorrelationWindow` | int | ❌ | 10 | 回調深度-量相關計算窗口 |
| `vwapPeriod` | int | ❌ | 20 | VWAP 計算週期 |
| `denseZoneAtrMultiple` | float | ❌ | 0.5 | 密集區分箱寬度(幾倍 ATR) |
| `volumeSurgeMinDays` | int | ❌ | 2 | 放量最少持續日數(避免單日異常) |
| `falseBreakoutRetracePct` | float | ❌ | 0.5 | 假突破回撤判定比例 |

**Min data**: `MAX(80, volumePercentileLookback + vwapPeriod + breakoutConfirmDays + 20)` = 60+20+3+20 = **103 條**(預設)

## 4. 輸出 (跟 docx §3)

```typescript
interface VolumePriceV2Verdict {
  symbol: string;
  cycle: 'uptrend' | 'downtrend' | 'sideways';     // 資金視角
  cycleLabel: string;                                // 資金流入/流出/觀望
  confidence: number;                                // 綜合信心指數 0.0~1.0
  volumeRegime: 'accumulation' | 'distribution' | 'neutral';
  
  breakoutStatus: {
    isBreakout: boolean;
    isConfirmed: boolean | 'pending';
    pattern: 'gradual_buildup' | 'sustained_surge' | 'single_spike' | 'low_volume' | 'none';
    strength: number;                                // 0~1
    falseBreakoutRisk: number;                       // 0~1
  };
  
  pullbackHealth: {
    isHealthy: boolean | 'unclear';
    depthVolCorrelation: number;                     // -1~1
    supportZone: string | null;                      // 'vwap' | 'dense_zone_xxx' | null
    daysToSupport: number | null;
  };
  
  vwapAnalysis: {
    vwapValue: number;
    priceVsVwapPct: number;                          // (price - vwap) / vwap
    vwapSupportStrength: 'strong' | 'testing' | 'broken';
  };
  
  volumePercentile: number;                          // 0.0~1.0
  turnoverRate: number | null;                       // 換手率(如有股本)
  
  denseZones: Array<{
    priceLevelLow: number;
    priceLevelHigh: number;
    priceLevelMid: number;
    totalVolume: number;
    volumeRatio: number;                             // 相對均量
    type: 'support' | 'resistance' | 'neutral';
    distancePct: number;                             // 距離現價 %
  }>;
  
  volumePriceCorrelation: {
    pearsonRecent: number;                            // 最近 5 日
    pearsonEarlier: number;                           // 之前 5 日
    correlationDecay: number;                        // 衰減量(正 = 衰減中)
    divergenceDetected: boolean;
    divergenceType?: 'bullish_vp' | 'bearish_vp';    // 價跌量縮/價漲量縮
  };
  
  obvAnalysis: {
    obvTrend: 'rising' | 'falling' | 'flat';
    obvPriceCorrelation: number;                      // 20 日相關係數
    weightedObvValue: number;                         // 當前加權 OBV
  };
  
  signal: 'CONFIRM' | 'DISCONFIRM' | 'NEUTRAL';      // 跟 M1 alignment 嘅互動
  buyTimingScore: number;                            // 0~1 (規則引擎 output)
  winProbability: number;                             // 0~1
  falseSignalFlags: string[];                         // 假信號警告
  
  matchedRules: Array<{ id: string; label: string; strength: 'strong' | 'medium' | 'weak' }>;
  rulesFired: number;                                // 觸發規則總數
  interpretation: string;                             // 用人話解釋
  warnings: string[];
  
  meta: {
    matchedRules: string[];
    ruleLabels: string[];
    atr: number;
    vwap: number;
    volumePercentile: number;
    consecutiveSurge: number;
    isAnomalySpike: boolean;
    configUsed: VolumePriceV2Config;
    dataDays: number;
  };
  
  timestamp: number;
}
```

## 5. 算法步驟 (跟 docx §4)

### Step 0: 輸入驗證
- min data = `MAX(80, volumePercentileLookback + vwapPeriod + breakoutConfirmDays + 20)` 條
- 唔夠就 `warnings: ['數據不足']` + 早 return default verdict

### Step 1: 計算基礎指標
- **ATR**: Wilder 14 日真實波幅均值
- **VWAP (成交量加權均價)**: 過去 `vwapPeriod` 日的典型價(typical price)累積 ÷ 累積成交量
- **Volume percentile**: 最近 N 日成交量的歷史百分位(0~1)
- **Turnover rate** (如有股本): `volume / sharesOutstanding`

### Step 2: 成交量標準差過濾
- **vol_zscore**: 今日成交量偏離 20 日均量的 Z-Score
- **is_anomaly_spike**: Z-Score > 3 **AND** 前 2 日都 < 1.5× 均量 → 異常爆量(可能消息刺激,不可靠)
- **consecutive_surge**: 連續放量日數(由今日倒數,volume ≥ 1.3× 均量就 count,直到 break)
- **is_sustained_volume**: `consecutive_surge >= volumeSurgeMinDays AND NOT is_anomaly_spike`

### Step 3: 加權 OBV (Tanh 加權)
- **weight = TANH(price_change_pct × 10)**: 價格變化越大,權重越高(10% 變化接近飽和)
- `weightedObv[i] = weightedObv[i-1] + volume[i] × weight[i]`
- **obv_sma_20**: weighted OBV 嘅 20 日 SMA
- **obv_trend**: `rising` if `weightedObv[-1] > sma × 1.03` / `falling` if `< sma × 0.97` / `flat`
- **obv_price_corr**: weighted OBV 同 close 嘅 20 日 Pearson 相關係數

### Step 4: 放量突破檢測 (4 種模式)
- **is_price_breakout**: 今日 close > 過去 20 日 high × 0.998
- 4 種突破模式 (按可信度由高到低):
  - **gradual_buildup** (溫和堆量,最可信): 前 3 日全部 > 前均量 × 1.1, 今日 > × 1.5, 唔係異常量 → strength 0.9
  - **sustained_surge** (持續放量): 今日 > × 2.0, 連續放量 ≥ 2 日, 唔係異常量 → strength 0.75
  - **single_spike** (單日爆量): 今日 > × 1.5 → strength 0.4, falseBreakoutRisk 0.4
  - **low_volume** (縮量突破): 其他情況 → strength 0.15, falseBreakoutRisk 0.7
- **假突破二次驗證** (strength ≥ 0.4 先做): 突破後 N 日內回撤 > `falseBreakoutRetracePct` → falseBreakoutRisk += 0.3
- **isConfirmed**: true / false / 'pending' (數據不足)

### Step 5: 回調健康度
- 找出最近 20 日內嘅 peak,計算 pullback 深度
- `is_pullback = current_price < peak × 0.97` AND `pullback_days ∈ [2, 15]`
- 計算 `depth_vol_corr` = Pearson(回調深度序列, 對應成交量序列)
  - `corr < -0.3` → **healthy**(越跌越縮量 = 健康鎖籌)
  - `corr > +0.3` → **unhealthy**(越跌越放量 = 恐慌拋售)
  - 否則 → `unclear`
- `support_zone`: 找 VWAP 或 dense_zone 做支撐

### Step 6: ATR 動態分箱 (成交量密集區)
- `bin_width = ATR[-1] × denseZoneAtrMultiple`(動態,高低價股統一標準)
- 過去 60 日按 close 分箱,累計成交量
- 取 top 3 成交量 bin,過濾 `avg_vol_in_bin > overall_avg × 1.3`
- 每個 zone 標記 type: support / resistance / neutral (睇現價位置)

### Step 7: 滾動量价相關係數
- 取最近 15 日嘅 price_changes 同 volume_changes
- `corr_recent`: 最近 5 日 Pearson 相關
- `corr_earlier`: 之前 5 日 Pearson 相關
- `correlation_decay = corr_earlier - corr_recent`(正 = 相關性在下降)
- **divergence_detected**: `correlation_decay > 0.4 AND |corr_recent| < 0.2`
  - 價升 + 相關性衰減 → **bearish_vp** (價漲量縮)
  - 價跌 + 相關性衰減 → **bullish_vp** (價跌量縮,拋壓枯竭)

### Step 8: 成交量體制 (Accumulation / Distribution)
- 加總 accumulation / distribution 嘅 evidence score:
  - `acc +0.3`: obv_trend==rising AND volume_percentile < 0.3 (低調吸籌)
  - `acc +0.25`: pullback_health.is_healthy (回調縮量 = 主力沒走)
  - `acc +0.25`: breakout_status.pattern==gradual_buildup
  - `dist +0.3`: obv_trend==falling AND volume_percentile > 0.7 (高量但 OBV 跌)
  - `dist +0.25`: volume_price_correlation.divergence_type==bearish_vp
  - `dist +0.2`: breakout_status.pattern==single_spike AND falseBreakoutRisk > 0.5
- 取 max(> 0.4) 為 regime,否則 neutral

### Step 9: 規則引擎 (5 條 buy rules + 4 條減分覆蓋)
- **5 條買入規則** (按信心由高到低):
  1. **黃金買入** (0.9): gradual_buildup AND confirmed AND obv_price_corr > 0.5 AND no divergence
  2. **健康回調買入** (0.75): pullback healthy AND support_zone != null AND accumulation AND obv rising
  3. **拋壓枯竭反彈** (0.6): bullish_vp AND volume_percentile < 0.2 AND obv != falling
  4. **VWAP 支撐反彈** (0.55): price near VWAP (0.995~1.02) AND volume_percentile < 0.5 AND obv rising
  5. **觀望** (0.3): 其他
- **4 條減分覆蓋**(直接乘):
  - `× 0.5`: falseBreakoutRisk > 0.6
  - `× 0.4`: bearish_vp AND volume_percentile > 0.8
  - `× 0.6`: is_anomaly_spike
  - `× 0.7`: obv_price_corr < -0.3

### Step 10: 勝率估算
- Base win: 0.68 (≥0.85) / 0.60 (≥0.7) / 0.52 (≥0.55) / 0.40 (其他)
- ± signal_validation 影響
- ± false_signal_flags 影響(每個 -0.08)
- CLAMP [0.25, 0.80]

### Step 11: 15 條規則 (V1-V15) - 觸發條件

| ID | 名 | 條件 | Strength |
|----|----|------|----------|
| **V1** | ATR 波動充足 | ATR 正常(> 0.5% × close) | weak |
| **V2** | VWAP 支撐 | price > VWAP × 0.99 | weak |
| **V3** | 成交量歷史百分位正常 | 0.1 < volume_percentile < 0.9 | weak |
| **V4** | 連續堆量 | consecutive_surge ≥ 2, NOT is_anomaly_spike | medium |
| **V5** | 異常爆量過濾 | is_anomaly_spike(警告信號) | strong (反向) |
| **V6** | 加權 OBV 上升 | obv_trend == 'rising' | medium |
| **V7** | 加權 OBV 下跌 | obv_trend == 'falling' | medium |
| **V8** | OBV 與價格同向 | obv_price_corr > 0.5 | strong |
| **V9** | 溫和堆量突破 | breakout_status.pattern == 'gradual_buildup' | strong |
| **V10** | 放量突破確認 | pattern == 'sustained_surge' AND confirmed | strong |
| **V11** | 縮量突破警告 | pattern == 'low_volume' OR falseBreakoutRisk > 0.5 | strong (反向) |
| **V12** | 假突破識別 | falseBreakoutRisk > 0.6 | strong (反向) |
| **V13** | 健康回調 | pullback_health.is_healthy == true | medium |
| **V14** | 拋售拋壓 | depth_vol_corr > 0.3 | strong (反向) |
| **V15** | 量价背馳 | divergence_detected(無論 bullish/bearish) | strong |

### Step 12: Signal 推導 (給 M1 alignment 用)
- `signal = CONFIRM` if:
  - cycle 推導為 'uptrend' (buy_timing_score ≥ 0.55 AND volume_regime != 'distribution')
  - AND 冇 false_signal_flags
  - AND obv_trend != 'falling'
- `signal = DISCONFIRM` if:
  - cycle 推導為 'downtrend' (volume_regime == 'distribution')
  - OR false_signal_flags 太多 (≥ 2)
  - OR obv_trend == 'falling' AND volume_percentile > 0.7
- 否則 `signal = NEUTRAL`

### Step 13: 組裝輸出
- `cycle`: uptrend if buy_timing_score ≥ 0.55 / downtrend if regime == distribution / sideways
- `cycleLabel`: 資金流入 / 資金流出 / 資金觀望
- `confidence`: `buy_timing_score` rounded
- `matchedRules`: V1-V15 觸發的規則 list
- `rulesFired`: 觸發規則數量
- `interpretation`: 用人話解釋觸發咗咩 rules

## 6. Cycle State 統一 (跟 ma-alignment 一致)

呢個 module 唔直接 emit `state` 字段(由 Synthesizer/M1 combine),而係 emit `signal` 字段:
- `CONFIRM` → M1 confidence × 1.10
- `DISCONFIRM` → M1 confidence × 0.70
- `NEUTRAL` → 唔影響

但 `cycle` 字段(資金視角)係為咗 Synthesizer 而設嘅 auxiliary field。

## 7. Adapter 設計 (frontend 整合)

```javascript
export const volumePriceAdapter = {
  id: 'AS-03-VP',
  name: '量價分析 v2.0 (VolumePrice)',
  version: '2.0.0',
  description: '用 15 條 rule-based 算法 (V1-V15) 分析成交量價格行為',
  inputs: [
    { key: 'code', type: 'autocomplete', required: true, ... },
    { key: 'period', type: 'select', options: ['1d', '1w'], default: '1d' },
    { key: 'dataWindowDays', type: 'number', default: 100, min: 80, max: 500 },
    { key: 'volumePercentileLookback', type: 'number', default: 60, min: 20, max: 120 },
    { key: 'vwapPeriod', type: 'number', default: 20, min: 5, max: 60 },
  ],
  analyze: analyzeVolumePrice,
  renderResult: renderVolumeResult,
  getHelp: getVolumeHelp,
};
```

- **3 個 sections 永久 rule (大少 #11056)**:
  - `renderDetailedExplanationVolume` — 詳細解讀(逐個 field 點樣睇)
  - `renderStrategyAdviceVolume` — 策略建議(4 種 state × 對應動作)
  - `renderUsageGuideVolume` — 點用 + 點睇(10 步 step-by-step guide)

## 8. 永久 Rules (大少 #11056, #11070, #11085, #11099)

- **Plain language 解釋**: 全部用白話解釋, 唔用 jargon(MA / BB / KC / ATR 第一次用時解釋)
- **Rule-based + additive confidence**: 唔做 multiplicative
- **List all matched rules**: 全部觸發 rules 列晒出嚟
- **Vague 描述要 confirm**: 「最近」要明確定義天數
- **3 個 sections permanent rule**: 📖 詳細解讀 + 🎯 策略建議 + 💡 點用點睇
- **Backend 數據對齊**: testing page 顯示實際/請求/數據限制
- **Cold cache wide-fetch**: 1d 必須取 30 年窗口

## 9. 📖 詳細解讀 (永久 rule #11056)

**用白話逐個 field 解釋**(假設大少只識 PE/ETF/MACD/limit order 呢啲 common term):

| Field | 點樣睇 |
|-------|--------|
| `cycle` | 「而家股票嘅資金面」 — 資金流入/流出/觀望。唔係睇價,係睇**錢有冇入場** |
| `cycleLabel` | 同 cycle,但用人話寫:「資金流入」= 大戶買緊貨 / 「資金流出」= 大戶沽緊貨 / 「資金觀望」= 大家等緊 |
| `confidence` | 0~1 之間嘅數字,越高代表越肯定。0.6 以上可以參考落單 |
| `volumeRegime` | **accumulation** = 大戶低調吸籌(暗中買入) / **distribution** = 大戶高調派發(暗中賣出) / **neutral** = 雙方勢均力敵 |
| `breakoutStatus.pattern` | 突破類型。`gradual_buildup` = 慢慢堆量突破(最可信) / `sustained_surge` = 持續放量突破(可信) / `single_spike` = 單日爆量(可能有水分) / `low_volume` = 縮量突破(最不可信,假突破風險高) |
| `breakoutStatus.isConfirmed` | 突破後有冇 hold 住。`true` = hold 住(真突破) / `false` = 跌破突破位(假突破) / `pending` = 數據未夠,等緊確認 |
| `breakoutStatus.falseBreakoutRisk` | 0~1 嘅數字,越高代表假突破風險越高。> 0.6 要小心 |
| `pullbackHealth.isHealthy` | 回調期間籌鎖定度。`true` = 越跌越縮量(健康,主力沒走) / `unhealthy` = 越跌越放量(恐慌拋售) |
| `pullbackHealth.depthVolCorrelation` | -1~1。負數 = 越跌越縮量(健康) / 正數 = 越跌越放量(危險) |
| `pullbackHealth.supportZone` | 回調嘅支撐位喺邊。`vwap` = 喺 VWAP(成交加權均價)附近 / `dense_zone_xxx` = 喺成交量密集區 / null = 搵唔到支撐 |
| `vwapAnalysis.vwapValue` | 過去 20 日嘅「平均交易價」(考慮成交量)。大戶嘅平均成本大約喺呢個位 |
| `vwapAnalysis.priceVsVwapPct` | 而家股價對 VWAP 嘅偏離。> 0 = 喺 VWAP 之上(強勢) / < 0 = 喺 VWAP 之下(弱勢) |
| `vwapAnalysis.vwapSupportStrength` | VWAP 嘅支撐力。`strong` = 喺 VWAP 之上 1% / `testing` = 喺 VWAP 附近(±1%) / `broken` = 跌破 VWAP(弱勢) |
| `volumePercentile` | 而家成交量喺過去 N 日嘅排名位置。0 = 歷史最低 / 1 = 歷史最高。> 0.7 = 異常放量 / < 0.3 = 異常縮量 |
| `turnoverRate` | 換手率 = 成交量 / 流通股本。> 5% = 顯著換手(可能有大動作) |
| `denseZones` | 成交量密集區(過去 60 日最活躍嘅 3 個價位)。大戶嘅成本區通常喺度 |
| `denseZones[].type` | `support` = 喺現價之下(做支撐) / `resistance` = 喺現價之上(做壓力) / `neutral` = 喺現價附近 |
| `volumePriceCorrelation` | 量价相關性衰減。`divergenceDetected=true` = 量价背馳,警號 |
| `volumePriceCorrelation.divergenceType` | `bullish_vp` = 價跌量縮(拋壓枯竭,見底信號) / `bearish_vp` = 價漲量縮(見頂警號) |
| `obvAnalysis.obvTrend` | 加權 OBV(能量潮)嘅趨勢。`rising` = 資金流入中 / `falling` = 資金流出中 / `flat` = 橫行 |
| `obvAnalysis.obvPriceCorrelation` | OBV 同價格嘅相關性。> 0.5 = 同步(健康) / < -0.3 = 背馳(危險) |
| `signal` | 畀 MA alignment 用嘅建議。`CONFIRM` = 量价支持上升 / `DISCONFIRM` = 量价反對上升 / `NEUTRAL` = 唔影響 |
| `buyTimingScore` | 規則引擎 output。0.9 = 黃金買點 / 0.75 = 健康回調 / 0.6 = 拋壓枯竭 / 0.55 = VWAP 支撐 / 0.3 = 觀望 |
| `winProbability` | 估計嘅勝率。0.68 = 68% 機會贏。> 0.6 = 高勝率, < 0.45 = 低勝率 |
| `falseSignalFlags` | 假信號警告 list。`high_false_breakout_risk` / `distribution_with_price_rise` / `anomaly_volume_spike` / `obv_price_divergence` |
| `matchedRules` | 觸發咗嘅 V1-V15 rules list。`V9` = 溫和堆量突破 / `V13` = 健康回調 etc. |

## 10. 🎯 策略建議 (永久 rule #11056)

**4 種 state × 對應動作**(用白話講):

### 🟢 Cycle: uptrend (資金流入) — 對應 buy_timing_score ≥ 0.55

| 規則組合 | 策略 |
|----------|------|
| **V9 溫和堆量突破** (gradual_buildup + confirmed + OBV 同步) | 🏆 **黃金買入** — 信心 0.9,勝率 68%。趁回調入場,唔好追高 |
| **V13 健康回調** (回調縮量 + 有支撐) | ✅ **回調買入** — 信心 0.75,勝率 60%。等回調到 VWAP/dense_zone 反彈 |
| **V15 拋壓枯竭** (bullish_vp + 量縮) | ⏳ **試探性買入** — 信心 0.6,勝率 52%。成交量極度萎縮時嘅撈底訊號 |
| **V2 VWAP 支撐** (price near VWAP) | 🛡️ **VWAP 反彈** — 信心 0.55,勝率 52%。喺 VWAP 附近反彈入場 |

**風險管理**:
- `falseBreakoutRisk > 0.6` → 收緊止損,可能係假突破
- `isAnomalySpike` → 等下日確認,單日異常量唔可靠
- `obvPriceCorrelation < -0.3` → 警號,資金暗中流出

### 🔴 Cycle: downtrend (資金流出) — 對應 distribution regime

- **基本動作**: 避開 / 減倉
- **唔好撈底**: 等 `bullish_vp` 出現(拋壓枯竭)先考慮
- **V7 OBV 下跌 + V15 量价背馳** → 確認派發中,跌幅可能仲未完
- **V11 縮量突破** → 假突破訊號,大戶可能高位派發

### 🟡 Cycle: sideways (資金觀望)

- **基本動作**: 等方向
- **V4 連續堆量** 觸發 → 醞釀突破,密切留意
- **V9 突破確認** 觸發 → 突破訊號
- **冇任何 V rule 觸發** → 繼續觀望,唔好勉強入場

### ⚠️ Failure mode 處理

- `falseBreakoutRisk > 0.6` → 將 buy_timing_score × 0.5, 買入降級
- `distribution_with_price_rise` → 將 buy_timing_score × 0.4, 警告
- `anomaly_volume_spike` → 將 buy_timing_score × 0.6, 等下日
- `obv_price_divergence` → 將 buy_timing_score × 0.7, 警號

## 11. 💡 點用 + 點睇 (永久 rule #11056)

10 步 step-by-step guide:

1. **先睇 `cycle` 同 `cycleLabel`** — 個大色塊同標題。呢個係最概要嘅判斷(資金流入/流出/觀望)
2. **睇 `buyTimingScore` 同 `winProbability`** — 越高越可信。> 0.7 = 高勝率可考慮入場, < 0.5 = 觀望
3. **睇 `breakoutStatus.pattern`** — `gradual_buildup` = 黃金突破 / `low_volume` = 假突破高危
4. **睇 `breakoutStatus.isConfirmed`** — `true` = 真突破 / `false` = 假突破 / `pending` = 等緊確認
5. **睇 `volumeRegime`** — `accumulation` = 大戶低調吸籌(準備升) / `distribution` = 大戶高調派發(準備跌)
6. **睇 `pullbackHealth.isHealthy`** — 回調期間是否健康鎖籌。`true` = 健康, 可以等回調買入
7. **睇 `vwapAnalysis.priceVsVwapPct`** — 喺 VWAP 之上 1% = 強勢 / 之下 = 弱勢
8. **睇 `obvAnalysis.obvTrend` 同 `obvPriceCorrelation`** — OBV 上升 + 與價格同向 = 健康 / OBV 下跌 + 背馳 = 危險
9. **睇 `falseSignalFlags`** — 有任何 flag 都要打折扣。`anomaly_volume_spike` 一定要等下日確認
10. **永遠配合風險管理** — 呢個 module 嘅策略建議只係 reference,落單前要自己再睇下基本面 / 消息面 / 板塊走勢

**重要提醒**:
- 量价分析係「**事後確認**」嘅工具,唔係「預測」工具。要配合 M1+M2+M3+M4 一齊睇
- 單日異常爆量(> 3 個 Z-Score)**不可信** — 等下日確認先算
- 健康回調 = **越跌越縮量**(負相關),唔係「縮量就健康」
- 量价背馳 = **相關性衰減 + 量縮**,唔係單純嘅量縮

## 12. 對比 v1.0 → v2.0 (大少 #10809 + #11056 + #11070)

| 優化項 | v1.0 (10 rule K-T) | v2.0 (15 rule V1-V15) |
|--------|---------------------|------------------------|
| 突破檢測 | 單日成交量 vs 前 5 日均量 | 連續三日模式 + Z-Score 過濾 + 4 種模式 |
| 縮量回調 | 簡單比較回調期 vs 上升期均量 | 回調深度-成交量相關係數(負相關 = 健康) |
| OBV | 簡單加減 | 價格變化幅度加權(Tanh)+ 20 日 SMA 趨勢 |
| 密集區分箱 | 固定 1% | ATR 動態分箱(高低價股統一標準) |
| 量价背馳 | 固定 5 日窗口 | 滾動 Pearson 相關 + 相關性衰減 |
| 假突破 | 無檢測 | 突破後 N 日回撤比例 + 籌碼鎖定度 |
| 評分方式 | 線性分數疊加 | 決策規則引擎(5 條 buy + 4 條減分) |
| 成交量可比性 | 絕對值 | 歷史百分位 + 換手率(如有股本) |
| 新增指標 | 無 | VWAP 動態支撐/壓力 + ATR 分解 |
| 新增維度 | 無 | 成交量體制(Accumulation/Distribution/Neutral) |
| 3 個 sections | 部分 | 全部齊(永久 rule #11056) |

## 13. 邊界條件 (跟 docx §6)

| 情境 | 處理 |
|------|------|
| ATR = 0(所有 K 線相同) | bin_width = close × 0.01,避免除零 |
| 成交量 = 0(該日) | 該日不納入相關係數計算,OBV 不變 |
| 無外部信號 | signal_validation = null,獨立運行 |
| 數據不足突破確認 | isConfirmed = 'pending',不強行判定 |
| 換手率無股本(shares_outstanding 冇) | turnoverRate = null,不影響其他計算 |
| 相關係數分母為 0(無變化) | corr = 0,標記為中性 |
| VWAP 計算期間全為 0 成交量 | vwap = typical_price(退化為 SMA) |
| Z-Score 分母為 0(vol_std_20 = 0) | vol_zscore = 0,視為正常量 |
| isAnomalySpike 觸發 + buy 規則同時觸發 | 減分覆蓋優先(isAnomalySpike × 0.6) |

## 14. Workflow Status (大少 7-step)

| Step | Status |
|------|--------|
| 1. Spec (`MODULE-05-VOLUME-PRICE-V2.md`) | ⏳ In progress |
| 2. Code (`modules/volume.ts` overwrite) | ⏸ Pending |
| 3. Config (`config.ts` v2.0 fields) | ⏸ Pending |
| 4. Tests (`__tests__/volume.test.mjs` rewrite, 50+ assertions) | ⏸ Pending |
| 5. Adapter (`adapter.mjs` `volumePriceAdapter`) | ⏸ Pending |
| 6. Testing page visual verify (HK.00700) | ⏸ Pending |
| 7. Commit + push | ⏸ Pending |

---

**Maintainer**: 大少 (zmen) + MiniMax Code
**Created**: 2026-08-07 (M5 v2.0 overwrite)
**Supersedes**: MODULE-05-VOLUME-PRICE.md v1.0.0 (commit c62d5fcb)
**Version**: 2.0.0

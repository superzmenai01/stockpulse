# AS-03 · Module 7+8: 終極綜合判斷引擎 v2.0 (Ultimate Decision Engine)

> **對應 docx**: `docs/演算法概念SPECS/07多時間框架一致性與極端情緒校準法.docx` + `08終極綜合判斷引擎.docx`
> **對應 TS 檔**: `algorithms/AS-03-cycle-detection/modules/decision-engine.ts` (M7 + M8 合併做 1 個 mega module)
> **對應 tests**: `algorithms/AS-03-cycle-detection/__tests__/decision-engine.test.mjs`
> **對應 adapter**: `algorithms/AS-03-cycle-detection/adapter.mjs` (`decisionEngineAdapter`)

> **大少 2026-08-08 11:22 指示**: M7 + M8 合併做 1 個 mega module (testing page 1 個 entry 叫 `08 — AS-03-ENG`), 唔分 2 個 dropdown。Spec 拆 2 份 reference (`MODULE-07` + `MODULE-08`), 但 codebase 1 個 file。
>
> **大少 2026-08-08 11:39 指示**: 5 個 adaptive params (SSI 戰略層權重 / RSI 情緒權重 / Kelly 倉位分數 / 馬可維茨相關係數 / Hurst 持續反轉 threshold) — 唔同股票用唔同 params, runtime auto-calibrate + JSON cache + Testing page 加「重新校準」按鈕。
>
> **大少 2026-08-08 11:57 指示**: UX 多圖少文字, 顏色對應狀態, 永遠全 Show (將來可收埋個別 section)。

---

## 1. 點解呢個 module (Why)

前 6 個 module 各自睇一個維度嘅趨勢:
- M1 均線 / M2 峰谷結構 / M3 趨勢線 → **大方向 (戰略層)**
- M4 動能背馳 / M5 量价 / M6 波動率 → **短線操作 (戰術層)**

呢個 module (M7+M8 合併) = **校長 + 紀律委員會**:
- **M7 (評卷老師)**: 將 6 個 module 嘅 verdict 翻譯做 A+~F 評級 + 數學最優倉位 (凱利公式)
- **M8 (終極引擎)**: 喺 M7 評級之上加決策紀律 — 何時加倉/減倉/食胡、信號新舊、市場波動大嘅守則

**同其他 module 嘅分別:**
- 唔係獨立指標,而係 **fusion engine**: 接收 M1-M6 嘅 output 做 input
- 加 5 個新維度: SSI 戰略強度 + TCM 戰術交叉驗證 + Alignment 戰略-戰術匹配度 + 信號生命週期 + 動態風險預算
- 輸出**交易指令卡**(BUY/ADD/HOLD/REDUCE/SELL/WAIT + 倉位 + entry_zone + stop_loss + take_profit + trailing_stop + decision_path)

---

## 2. 跟其他 module 嘅協同

| Module | 角色 | 點用佢 |
|--------|------|--------|
| **M1 (MA Alignment v2.0)** | 戰略層 | 判大方向 (60-100 日) |
| **M2 (HL Structure)** | 戰略層 | 判峰谷結構 (HH/HL/LH/LL) |
| **M3 (Trendline)** | 戰略層 | 判支撐壓力 + 趨勢線斜率 |
| **M4 (Indicators 動能背馳)** | 戰術層 | 判動能背馳 + 6 維情緒雷達 (RSI/%B/乖離率/波動偏度/換手率/連漲跌加速度) |
| **M5 (VolumePrice v2.0)** | 戰術層 | 判量价 + 買入時機 + expected_return / max_drawdown_estimate (凱利公式 input) |
| **M6 (Volatility)** | 戰術層 | 判波動率結構 (Squeeze / VCP / ATR 分解) |
| **M7 (多 TF + 情緒 + Hurst)** | 校準層 | 馬可維茨組合 + 6 維情緒 + Hurst + Kelly + 異議分數 → A+~F 評級 |
| **M8 (終極引擎)** | **核心** | SSI + TCM + Alignment + 生命週期 + 風險預算 → **交易指令卡** |

**關係:** M8 喺 Step 1 **並行調用 M1-M7 全部 7 個 module**, M7 嘅 verdict (A+~F) 會作為 M8 嘅其中一個 input reference, 但 M8 會做**二次校準**(信號太新 = emerging 唔可以重倉)。

---

## 3. 5 個 Adaptive Params (大少 11:39 指示)

呢 5 個 params **唔係 hardcode**, 跟股票特性 auto-calibrate。Stage 1 用 L2 (JSON file cache), Stage 2+ 升 L3 (DB)。

### 3.1 完整列表 (Code 名 + Human 名 + Default + 點 Adaptive)

| # | Code 名 | Human 名 | Default | 點 Adaptive |
|---|---------|----------|---------|------------|
| 1 | `ssiWeights: { ma, hl, trendline }` | **SSI 戰略層權重** | 0.30 / 0.30 / 0.40 | 60 日 K 線計各 module 嘅 R², normalize 加權 |
| 2 | `rsiWeight` | **RSI 情緒權重** | 0.20 | 跟 sentiment 6 維平均分, 預設 0.20 |
| 3 | `kellyFraction` | **Kelly 倉位分數** | 'half' (0.5) | 跟 ATR%: < 2% = 'half', 2-5% = 'quarter', ≥ 5% = 'octo' |
| 4 | `markowitzCorr: { dailyWeekly, dailyMonthly, weeklyMonthly }` | **馬可維茨相關係數** (日-週 / 日-月 / 週-月) | 0.85 / 0.60 / 0.70 | 252 日 K 線計真實 correlation |
| 5 | `hurstThresholds: { persistent, reverting }` | **Hurst 持續/反轉 threshold** | 0.55 / 0.45 | 252 日 Hurst 自身: > 0.6 升, < 0.4 降 |

### 3.2 為什麼要 Adaptive?

**舉例:**
- **騰訊 (HK.00700)**: 低波動大藍籌, Hurst 高 → 持續股, Kelly 用 Half, threshold 提
- **特斯拉 (US.TSLA)**: 高波動, Hurst 變化大 → Kelly 用 Octo (1/8), threshold 降
- **阿里巴巴 (HK.09988)**: 中型股 → default params

如果 hardcode, 騰訊會過度保守(浪費機會), 特斯拉會過度進取(高風險), 都唔啱。

### 3.3 Runtime Auto-calibration 邏輯 (純 Algorithm, 唔需要 AI)

```javascript
function calibrateParams(stockData) {
  const atrPct = calcATR(stockData.last60Days) / stockData.currentPrice;  // 60 日 ATR / 股價
  const hurst = calcHurst(stockData.last252Days);                          // 252 日 Hurst 指數
  const moduleR2 = {
    ma: calcR2(stockData.last60Days, 'ma'),
    hl: calcR2(stockData.last60Days, 'hl'),
    trendline: calcR2(stockData.last60Days, 'trendline'),
  };

  // Rule 1: Kelly 跟 ATR%
  const kellyFraction = atrPct < 0.02 ? 'half' : atrPct < 0.05 ? 'quarter' : 'octo';

  // Rule 2: Hurst threshold 跟持續性
  const hurstThresholds = hurst > 0.6 ? { persistent: 0.6, reverting: 0.4 }
    : hurst < 0.4 ? { persistent: 0.5, reverting: 0.5 }
    : { persistent: 0.55, reverting: 0.45 };

  // Rule 3: SSI 權重跟 R² (高 R² = 高權重)
  const totalR2 = moduleR2.ma + moduleR2.hl + moduleR2.trendline;
  const ssiWeights = {
    ma: 0.30 + (moduleR2.ma / totalR2 - 1/3) * 0.20,
    hl: 0.30 + (moduleR2.hl / totalR2 - 1/3) * 0.20,
    trendline: 0.40 + (moduleR2.trendline / totalR2 - 1/3) * 0.20,
  };
  // normalize 加總 = 1.0

  // Rule 4: 馬可維茨相關係數 (用真實 correlation)
  const markowitzCorr = calcCorrelations(stockData.last252Days);

  // Rule 5: RSI 權重 (預設 0.20, 可調)
  const rsiWeight = 0.20;

  return { ssiWeights, rsiWeight, kellyFraction, markowitzCorr, hurstThresholds };
}
```

**全部純 math, 唔需要 AI:**
- ATR = simple moving average
- Hurst = log linear regression
- R² = simple least squares
- Correlation = Pearson

### 3.4 JSON File Cache (L2, 唔改 backend)

```
~/.stockpulse/adaptive_params/
├── HK.00700.json
├── HK.09988.json
├── US.AAPL.json
└── ...
```

**每個 JSON 內容:**

```json
{
  "symbol": "HK.00700",
  "lastCalibrated": "2026-08-08T11:00:00Z",
  "atrPct": 0.023,
  "hurstExponent": 0.62,
  "moduleR2": { "ma": 0.72, "hl": 0.68, "trendline": 0.75 },
  "ssiWeights": { "ma": 0.32, "hl": 0.28, "trendline": 0.40 },
  "rsiWeight": 0.20,
  "kellyFraction": "half",
  "markowitzCorr": { "dailyWeekly": 0.85, "dailyMonthly": 0.60, "weeklyMonthly": 0.70 },
  "hurstThresholds": { "persistent": 0.6, "reverting": 0.4 }
}
```

### 3.5 Auto + Manual 兩個 Mode

| Mode | 點觸發 | 點做 |
|------|--------|------|
| **Auto (background)** | 第一次跑某股票, 或 cache > 7 日 | 自動 calibrate, 唔需要大少撳 |
| **Manual (按鈕)** | 大少撳「🔄 重新校準」按鈕 | 即時 calibrate, 立即用新 params |

---

## 4. 輸入 (跟 docx §2)

| Field | Type | Required | Default | 說明 |
|-------|------|----------|---------|------|
| `symbol` | string | ✅ | — | 股票代碼 |
| `price_data` | list[dict] | ✅ | — | 日線價格, 按日期升序 |
| `weekly_data` | list[dict] | ❌ | null | 週線價格 (Stage 1 內 mock by 5-day aggregate from daily) |
| `monthly_data` | list[dict] | ❌ | null | 月線價格 (Stage 1 內 mock by 20-day aggregate from daily) |
| `sub_module_signals` | list[dict] | ✅ | — | M1-M6 嘅 verdict 結果 (testing page 自動組裝) |
| `module_accuracy_history` | dict | ❌ | null | 各 module 近期準確率 {ma: 0.72, ...} (Stage 1 hardcode 預設) |
| `market_index_data` | list[dict] | ❌ | null | 大盤指數 (Stage 2 支援) |
| `risk_free_rate` | float | ❌ | 0.02 | 無風險利率 (年化) |
| `max_position_pct` | float | ❌ | 1.0 | 最大倉位上限 |
| `sentiment_dimensions` | list[string] | ❌ | ["rsi", "bb_pct_b", "ma_deviation", "vol_skew", "turnover_extreme", "streak_accel"] | 啟用的情緒維度 |
| `risk_profile` | string | ❌ | "moderate" | "conservative" / "moderate" / "aggressive" |
| `signal_history` | list[dict] | ❌ | [] | 過去 10 日嘅 verdict 結果 (Stage 1 mock) |

**KLine 格式 (跟 docx):**
```typescript
{ date: "2026-07-01", close: 150.5, volume: 25000000 }
```

**Min data:** `MAX(200, 100) = 200` (跟 docx)

---

## 5. 輸出 (跟 docx §3 交易指令卡 v2.0)

```typescript
interface DecisionEngineVerdict {
  symbol: string;
  decisionDate: string;                                  // 判決日期
  finalAction: 'BUY' | 'ADD' | 'HOLD' | 'REDUCE' | 'SELL' | 'WAIT';
  actionLabel: string;                                    // 中文動作
  signalLifecycle: 'emerging' | 'confirmed' | 'mature' | 'decaying';
  confidence: number;                                     // 0.0 ~ 1.0
  confidenceStability: number;                            // 連續一致性 0.0 ~ 1.0
  grade: 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F';
  strategicStrengthIndex: number;                          // SSI -1.0 ~ 1.0
  tacticalConfirmationScore: number;                       // TCS 0.0 ~ 1.0
  alignmentScore: number;                                 // 戰略-戰術匹配 -1.0 ~ 1.0
  consensusMomentum: 'improving' | 'stable' | 'deteriorating';
  positionSizePct: number;                                // 0.0 ~ 100.0
  positionAction: 'open_new' | 'add_to_winner' | 'hold' | 'trim' | 'close';
  entryZone: { low: number, high: number };               // 入場區間
  stopLoss: number;                                       // 止損價
  takeProfit: number;                                     // 目標價
  trailingStop: number;                                   // 移動止損
  riskRewardRatio: number;                                // 風險回報比
  riskBudgetUsed: number;                                 // 使用風險預算 0.0 ~ 1.0
  decisionPath: string[];                                 // 決策路徑追溯 (人話)
  warnings: string[];                                     // 風險警告
  fullReport: {                                           // 完整原始輸出 (Stage 1 debug 用)
    m1: ...,
    m2: ...,
    m3: ...,
    m4: ...,
    m5: ...,
    m6: ...,
    m7: ...,
    ssi: { ... },
    tcs: { ... },
    alignment: { ... },
    kellyPosition: { ... },
    adaptiveParams: { ... },
  };
  reason: string;                                         // 綜合判斷理由 (人話)
  lastDate: string;
}
```

**State mapping (testing page):**
- `BUY` → 🟢 買入 / `ADD` → 🟢 加倉 / `HOLD` → 🟡 持有 / `REDUCE` → 🟡 減倉 / `SELL` → 🔴 賣出 / `WAIT` → ⚪ 觀望

---

## 6. Algorithm 步驟 (合併 M7 10 步 + M8 6 步, 簡化版)

### Step 0: 輸入驗證
- 檢查 `price_data.length >= 200`
- 檢查日期升序
- 檢查 adaptive_params JSON file (有就 load, 冚就 auto-calibrate)

### Step 1: 並行調用 M1-M6 + M7 (testing page 自動組裝)
- M1-M3 戰略層
- M4-M6 戰術層
- M7 校準層 (用 M1-M6 嘅 output 做 sub_module_signals)

### Step 2: SSI 戰略強度指數 (M8 Step 2)
```javascript
const strategicModules = [m1, m2, m3];
const ssiWeights = adaptiveParams.ssiWeights;  // 跟股票特性 auto-calibrate
let ssiBull = 0, ssiBear = 0, ssiTotal = 0;
for (const mod of strategicModules) {
  const w = ssiWeights[mod.moduleName];
  const conf = mod.confidence;
  if (mod.cycle === 'uptrend') { ssiBull += w * conf; ssiTotal += w; }
  else if (mod.cycle === 'downtrend') { ssiBear += w * conf; ssiTotal += w; }
  else { /* sideways: 信心低分配兩邊 */ }
}
const ssiNet = (ssiBull - ssiBear) / ssiTotal;

// 趨勢質量 bonus: 一致性
const uniqueCycles = new Set(strategicModules.map(m => m.cycle));
const consistencyBonus = uniqueCycles.size === 1 ? 1.15 : uniqueCycles.size === 2 ? 0.90 : 0.70;
const ssi = clamp(ssiNet * consistencyBonus, -1, 1);
```

### Step 3: TCM 戰術交叉驗證矩陣 (M8 Step 3)
```javascript
const tacticalModules = { momentum: m4, volume: m5, volatility: m6 };
// 提取各 module 嘅動作傾向
const t4 = m4.signal.type === 'buy' ? 'buy' : m4.signal.type === 'sell' ? 'sell' : 'hold';
const t5 = m5.buyTimingScore >= 0.5 ? 'buy' : m5.buyTimingScore < 0.2 ? 'sell' : 'hold';
const t6 = m6.entryTiming.score >= 0.6 ? 'buy' : m6.entryTiming.score < 0.3 ? 'sell' : 'hold';
// 兩兩驗證 → confirmations / conflicts → TCS 0-1
// 特殊降級: 動能買但量未跟 (虛漲 × 0.6), Squeeze Fire 但量派發 (假突破 × 0.3)
```

### Step 4: Alignment Score 戰略-戰術匹配度 (M8 Step 4)
```javascript
const alignment = 1.0 - Math.abs(ssi - tacticalNet);
// 戰略強多 + 戰術空 + 回調健康 = 0.7 (回調買點)
// 戰略強多 + 戰術空 + 回調唔健康 = 0.3 (轉勢警告)
```

### Step 5: 信號生命週期 (M8 Step 5)
```javascript
// 連續 N 日同向 = mature (可重倉)
// emerging (0-40%) / confirmed (40-70%) / mature (>70%)
// 共識動量: improving / stable / deteriorating
```

### Step 6: 動態風險預算 + 自適應門檻 (M8 Step 6)
```javascript
// SSI 越高, 允許戰術操作越激進
const riskBudget = ssi >= 0.7 ? 1.0 : ssi >= 0.4 ? 0.7 : ssi >= 0.2 ? 0.4 : 0.1;
// 門檻跟 ATR% 動態調整
const adaptiveThreshold = baseThreshold * (1 + atrPct * 5);
```

### Step 7: 多時間框架組合 + 馬可維茨 (M7 Step 1-2)
```javascript
// 日/週/月 3 個 timeframe 跑 M1 簡化版
// 用 markowitzCorr 真實 correlation 算最優權重
// 找夏普比率最高嘅 weights 組合
```

### Step 8: 六維情緒雷達 (M7 Step 3)
```javascript
// RSI + %B + 乖離率 + 波動偏度 + 換手率 + 連漲跌加速度
// 6 維 sentiment score 0-1
```

### Step 9: Hurst 指數 + 週期疲勞 (M7 Step 4)
```javascript
// Hurst > persistent threshold = 趨勢持續
// Hurst < reverting threshold = 即將反轉
// 疲勞分數: Hurst 下降 + 週期長 = 高疲勞
```

### Step 10: 動態貝葉斯共識 + 異議分數 (M7 Step 5)
```javascript
// 動態權重: 歷史準確率高嘅 module 升權
// 半衰期衰減: 越老信號降權
// 異議分數: 假共識陷阱檢測
```

### Step 11: 尾部風險指標 (M7 Step 6)
```javascript
// 偏度 (Skewness) + 峰度 (Kurtosis) + 最大回撤預估
// tail_risk_score 0-1
```

### Step 12: 三情景綜合校準 (M7 Step 7)
```javascript
// 樂觀 / 基準 / 悲觀 三情景置信區間
// Sentiment + Hurst + 疲勞 + 異議 + 尾部風險 校準
```

### Step 13: 凱利公式倉位 (M7 Step 8)
```javascript
// f* = (p*b - q) / b
// 跟 adaptive Kelly fraction policy (half / quarter / octo)
```

### Step 14: 最終評級 (M7 Step 9)
```javascript
// A+ / A / B+ / B / C+ / C / D / F
// 跟 baseline_score + sentiment level
```

### Step 15: 交易指令卡 (M8 Step 7)
```javascript
// 動態決策樹: 覆蓋所有 SSI/TCS/Alignment 組合
// finalAction: BUY / ADD / HOLD / REDUCE / SELL / WAIT
// position_size_pct: 跟 lifecycle + risk_budget
// entry_zone / stop_loss / take_profit / trailing_stop
// 全部用 ATR × 0.5/1.0/1.5 fixed formula
```

### Step 16: 決策路徑追溯 (M8 Step 10)
```javascript
// decisionPath: 每一步人話解釋
// e.g. "Step 2: SSI = 0.75 (強勢上升, M1-M3 一致)" → "Step 3: TCS = 0.7 (M4 買但量未跟, 降級)" → ...
```

### Step 17: 組裝輸出
- 全部 fields 整合成 `DecisionEngineVerdict`
- testing page 自動 render 交易指令卡 (大少 UX 設計: 多圖少文字, 顏色對應狀態)

---

## 7. Cycle State 判定 (8 個)

| State | 顏色 | 意思 | 對應評級 |
|-------|------|------|---------|
| `BUY` (買入) | 🟢 綠 | 強勢上升 + 戰術確認 + 高 alignment | A+ / A |
| `ADD` (加倉) | 🟢 綠 | 已有倉 + 信號成熟 (mature lifecycle) | A / B+ |
| `HOLD` (持有) | 🟡 黃 | 觀望, 信號唔夠強 | B / C+ |
| `REDUCE` (減倉) | 🟡 黃 | 信號 decaying + momentum deteriorating | C / D |
| `SELL` (賣出) | 🔴 紅 | 強勢下跌 + 戰術確認 | D / F |
| `WAIT` (觀望) | ⚪ 灰 | 數據不足 / 信號衝突 | — |
| `TRAP` (陷阱警告) | 🟣 紫 | 假共識檢測觸發 | — (附加警告) |
| `TRANSITION` (轉折) | 🟣 紫 | 5 日內趨勢可能反轉 | — (附加警告) |

---

## 8. 邊界條件 (跟 docx §6)

| 情境 | 處理 |
|------|------|
| 數據不足 (price_data < 200) | 拋 error, 提示「需要至少 200 條日線」 |
| weekly_data null | Mock: 從 daily 5 日 aggregate (Stage 1) |
| monthly_data null | Mock: 從 daily 20 日 aggregate (Stage 1) |
| Hurst 計算失敗 (R² < 0.3) | hurst = 0.5, 標記 random_walk |
| 無 sub_module_signals | 僅用時間框架 + 情緒雷達, Kelly 用默認 b=1.5 |
| 凱利計算為負 | recommended = 0, 建議 WAIT |
| 6 維情緒部分維度缺失 | 缺失維度用 0.5 (中性) 填充 |
| 馬可維茨組合方差 = 0 | 默認權重 [0.2, 0.5, 0.3] |
| adaptive_params JSON 缺失 + 第一次跑 | 自動 calibrate, 儲落 `~/.stockpulse/adaptive_params/<symbol>.json` |
| adaptive_params JSON > 7 日 | 自動重新 calibrate |

---

## 9. Adaptive Params 嘅 Runtime Auto-calibration 詳細

### 9.1 計股票特性

| Metric | 公式 | Window | 用途 |
|--------|------|--------|------|
| `atrPct` | `ATR(60) / currentPrice` | 60 日 | Kelly fraction + 風險預算 |
| `hurstExponent` | log linear regression on price changes | 252 日 | Hurst threshold 自適應 |
| `moduleR2` | 線性擬合度 (M1/M2/M3 各自) | 60 日 | SSI 權重自適應 |
| `markowitzCorr` | Pearson correlation (3 對) | 252 日 | 馬可維茨權重 |

### 9.2 Rules 對照表

| 股票特性 | Range | Rule | 結果 |
|---------|-------|------|------|
| **ATR%** | < 2% | 低波動 | `kellyFraction: 'half'` (0.5) |
| | 2-5% | 中波動 | `kellyFraction: 'quarter'` (0.25) |
| | ≥ 5% | 高波動 | `kellyFraction: 'octo'` (0.125) |
| **Hurst** | > 0.6 | 持續股 | `hurstThresholds: { persistent: 0.6, reverting: 0.4 }` |
| | 0.4-0.6 | 中性 | `hurstThresholds: { persistent: 0.55, reverting: 0.45 }` (default) |
| | < 0.4 | 反轉股 | `hurstThresholds: { persistent: 0.5, reverting: 0.5 }` |
| **R² 排名** | R² 最高 | 加權 0.4 | `ssiWeights.topR2 = 0.4` |
| | R² 中 | 加權 0.30 | `ssiWeights.midR2 = 0.30` |
| | R² 最低 | 加權 0.30 | `ssiWeights.lowR2 = 0.30` |

### 9.3 JSON File Format

```typescript
interface AdaptiveParams {
  symbol: string;
  lastCalibrated: string;          // ISO timestamp
  atrPct: number;
  hurstExponent: number;
  moduleR2: { ma: number; hl: number; trendline: number };
  ssiWeights: { ma: number; hl: number; trendline: number };
  rsiWeight: number;
  kellyFraction: 'full' | 'half' | 'quarter' | 'octo';
  markowitzCorr: { dailyWeekly: number; dailyMonthly: number; weeklyMonthly: number };
  hurstThresholds: { persistent: number; reverting: number };
}
```

**File path:** `~/.stockpulse/adaptive_params/<symbol>.json`

---

## 10. Testing Page 3 個 Sections (永久 Rule, 大少 #11056)

**永遠全 Show, 將來可 hide 個別 section (大少 11:57 指示)**

### 📖 詳細解讀
- 全部 23 個 output fields 解釋
- 5 個 adaptive params 解釋
- 倉位建議解釋
- 入場區間解釋
- Stop Loss / Take Profit 計算

### 🎯 策略建議
- 按 finalAction 各自建議
- BUY → 「強烈買入, 跟 Kelly 倉位」
- ADD → 「加倉, 信號成熟」
- HOLD → 「持有, 等待下一個信號」
- REDUCE → 「減倉, 信號老化」
- SELL → 「賣出, 確認下跌趨勢」
- WAIT → 「觀望, 數據不足或信號衝突」

### 💡 點用點睇
- 10 步 step-by-step guide
- 對比 M1-M6 結果
- 配合 risk_profile 嘅建議
- 何時手動 override params

---

## 11. UX 設計 (大少 11:57 指示: 多圖少文字, 顏色對應狀態)

### 11.1 顏色系統 (永久 rule)

| 顏色 | Hex | 意思 |
|------|-----|------|
| 🟢 綠 | `#26BA75` | 強勢上升 / BUY / 確認 |
| 🟡 黃 | `#F39C12` | 觀望 / HOLD / 中性 |
| 🔴 紅 | `#EE5151` | 強勢下跌 / SELL / 警告 |
| 🔵 藍 | `#1890ff` | 資訊性 / 中性 / 數據 |
| 🟣 紫 | `#722ed1` | 陷阱 / 矛盾 / TRANSITION |
| ⚫ 深灰 | `#666` | 唔適用 / N/A |

### 11.2 結果 Panel Layout (永遠全 Show)

```
┌─────────────────────────────────────────────────────────────┐
│  📦 終極綜合判斷引擎 v2.0 (Ultimate Decision Engine)            │
│  [08 — AS-03-ENG]                                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─ 🎯 頂部 verdict card (永遠 show) ─────────────────────┐  │
│  │                                                         │  │
│  │   ╔══════════════╗  ╔══════════╗  ╔══════════════╗    │  │
│  │   ║   🟢 BUY     ║  ║    A+    ║  ║  50% 倉位   ║    │  │
│  │   ║   強烈買入   ║  ║  信心 85% ║  ║  Kelly Half ║    │  │
│  │   ╚══════════════╝  ╚══════════╝  ╚══════════════╝    │  │
│  │                                                         │  │
│  │   戰略強度 SSI: 0.75 戰術確認 TCS: 0.70  匹配度: 0.85  │  │
│  │   信號生命週期: mature  風險預算使用: 60%                │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ 📊 6 個 Metric Mini-Cards (永遠 show) ───────────────┐  │
│  │  ┌────┐  ┌────┐  ┌────┐  ┌────┐  ┌────┐  ┌────┐    │  │
│  │  │SSI │  │TCS │  │Align│ │Cycle│ │Kelly│ │Risk │    │  │
│  │  │0.75│  │0.70│  │0.85 │ │📈mat│ │Half │ │60% │    │  │
│  │  └────┘  └────┘  └────┘  └────┘  └────┘  └────┘    │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ 📈 4 個 SVG Chart (永遠 show) ──────────────────────┐  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐    │  │
│  │  │ Sentiment  │  │ Timeframe  │  │ Trend      │    │  │
│  │  │ Radar      │  │ Alignment  │  │ Comparison │    │  │
│  │  │ (6 維)     │  │ (stacked)  │  │ (bar)      │    │  │
│  │  └────────────┘  └────────────┘  └────────────┘    │  │
│  │  ┌────────────┐                                       │  │
│  │  │ Position   │                                       │  │
│  │  │ Donut      │                                       │  │
│  │  └────────────┘                                       │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ 📋 詳細資料 (collapsible, 預設展開) ─────────────────┐  │
│  │  倉位建議表格                                          │  │
│  │  Entry Zone: 150-155  Stop Loss: 145  TP: 165          │  │
│  │  Trailing Stop: 158  Risk/Reward: 2.5:1                │  │
│  │  ⏱️ Trailing Stop 隨股價上升而上移                      │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ 🛤️ 決策路徑 (timeline, collapsible) ─────────────────┐  │
│  │  Step 1: M1-M3 一致上升, SSI = 0.75                     │  │
│  │  Step 2: M4-M5 確認, 但 M6 觀望, TCS = 0.70             │  │
│  │  Step 3: 戰略戰術匹配, Alignment = 0.85                  │  │
│  │  ... 8 steps ...                                        │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ 🔧 5 個 Adaptive Params (collapsible) ──────────────┐  │
│  │  ATR%: 2.3%  Hurst: 0.62  Module R²: ma=0.72 hl=0.68  │  │
│  │  SSI 權重: ma=0.32 hl=0.28 trendline=0.40              │  │
│  │  Kelly: half  Hurst Threshold: 0.6/0.4                  │  │
│  │  [🔄 重新校準]  [✏️ 自定義]                            │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ 📖 詳細解讀 (3 個 section之一, 永久) ───────────────┐  │
│  │  ... 23 個 output fields 解釋 ...                        │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ 🎯 策略建議 (永久) ─────────────────────────────────┐  │
│  │  按 finalAction 各自建議                                │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ 💡 點用點睇 (永久) ─────────────────────────────────┐  │
│  │  10 步 step-by-step guide                              │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ 🔧 技術細節 (collapsible, 預設收埋) ───────────────┐  │
│  │  fullReport JSON (raw output)                          │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ ⚠️ 風險警告 (如有) ─────────────────────────────────┐  │
│  │  ⚠️ Squeeze Fire 但量顯示派發, 假突破警告              │  │
│  │  ⚠️ 信號歷史不足, 連續一致性可靠性下降                │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 11.3 10 個 SVG Chart 設計

| # | Chart | Type | 數據來源 | 顏色 |
|---|-------|------|---------|------|
| 1 | **大型 State-Pill** | HTML div | finalAction | 狀態色 |
| 2 | **6 個 Metric Mini-Cards** | HTML grid | SSI/TCS/Alignment/Lifecycle/Kelly/Risk | 狀態色 |
| 3 | **Sentiment Radar** | SVG 6 維 | sentiment_radar 6 維 | 綠高/紅低 漸層 |
| 4 | **Timeframe Alignment Stacked Bar** | SVG | markowitz weights | 綠升/紅跌/灰橫 |
| 5 | **Trend Comparison Horizontal Bar** | SVG | SSI/Tactical/Consensus | 對比色 |
| 6 | **Position Size Donut** | SVG | kelly_position.recommended | Kelly fraction 顏色 |
| 7 | **Signal Lifecycle Timeline** | HTML cards | lifecycle 4 個 stage | 4 個階段色 |
| 8 | **Risk Budget Gauge** | SVG 半圓 | risk_budget_used | 綠/黃/紅 漸層 |
| 9 | **Decision Path Timeline** | HTML cards | decisionPath array | 每 step 結果色 |
| 10 | **評級 A+~F Letter Card** | HTML div | grade | A+ 綠 / A 淺綠 / B+ 黃綠 / B 黃 / C+ 橙 / C 深橙 / D 紅 / F 深紅 |

### 11.4 將來收埋個別 Section (大少 11:57 指示)

**Strategy:**
- 每個 section 有 `data-section="sentiment"` 等 attribute
- 加 toggle button 控制
- CSS `display: none` 即時收埋
- 唔需要重寫 layout

**將來 frontend 改:**
```css
.section-sentiment { display: none; }  /* 收埋 sentiment chart */
.section-decision-path { display: none; }  /* 收埋 decision path */
```

---

## 12. 範例 (跟 docx §7 + 5 個 adaptive params)

### 12.1 HK.00700 騰訊 (穩定大藍籌, 預期參數)

**Input (60 日 K 線 + 252 日 K 線):**
- ATR%: 1.8% (低)
- Hurst: 0.65 (持續股)
- M1 R²: 0.75, M2 R²: 0.70, M3 R²: 0.78

**Auto-calibrated params:**
- `kellyFraction: 'half'` (0.5, ATR% < 2%)
- `hurstThresholds: { persistent: 0.6, reverting: 0.4 }` (Hurst > 0.6)
- `ssiWeights: { ma: 0.31, hl: 0.28, trendline: 0.41 }` (M3 R² 最高)
- `rsiWeight: 0.20` (default)
- `markowitzCorr: { dailyWeekly: 0.87, dailyMonthly: 0.62, weeklyMonthly: 0.72 }` (騰訊真實 correlation)

**Output:**
- `finalAction: 'BUY'`
- `grade: 'A'`
- `confidence: 0.82`
- `positionSizePct: 50%` (Kelly Half)
- `entryZone: 380-388`
- `stopLoss: 370`
- `takeProfit: 405`
- `riskRewardRatio: 2.5`

### 12.2 US.TSLA 特斯拉 (高波動, 預期保守參數)

**Auto-calibrated params:**
- `kellyFraction: 'octo'` (0.125, ATR% > 5%)
- `hurstThresholds: { persistent: 0.5, reverting: 0.5 }` (Hurst 變化大)
- `ssiWeights: { ma: 0.30, hl: 0.30, trendline: 0.40 }` (default)

**Output (如果 BUY):**
- `finalAction: 'BUY'`
- `grade: 'B+'` (信號夠但波動大, 降評級)
- `positionSizePct: 12.5%` (Kelly Octo)
- `riskRewardRatio: 3.0` (要求更高 R:R 因為波動大)

---

## 13. Tests 規劃

`__tests__/decision-engine.test.mjs` 20+ tests, 30+ assertions:

| # | Test | 描述 | Assertions |
|---|------|------|------------|
| T1 | Input 驗證 | price_data < 200 拋 error | 1 |
| T2 | Auto-calibrate 第一次跑 | 自動產生 JSON, 5 個 params 都 set | 5 |
| T3 | Auto-calibrate JSON cache | 第二次跑, 讀 cache, 唔再 calibrate | 2 |
| T4 | Manual 重新校準按鈕 | 即時 calibrate, 覆寫 JSON | 2 |
| T5 | SSI 一致 (3 module 全部 uptrend) | consistency_bonus = 1.15 | 1 |
| T6 | SSI 矛盾 (3 module 全部唔同 cycle) | consistency_bonus = 0.70 | 1 |
| T7 | TCM 三劍客一致 (confirmations = 3) | tcs = 1.0 | 1 |
| T8 | TCM 動能買但量未跟 (虛漲) | tcs × 0.6 | 1 |
| T9 | TCM Squeeze Fire 但量派發 (假突破) | tcs × 0.3 | 1 |
| T10 | Alignment 完美匹配 (SSI = tactical_net) | alignment = 1.0 | 1 |
| T11 | Alignment 戰略強多 + 戰術空 + 回調健康 | alignment = 0.7 (回調買點) | 1 |
| T12 | Alignment 戰略強多 + 戰術空 + 回調唔健康 | alignment = 0.3 (轉勢警告) | 1 |
| T13 | Lifecycle emerging (連續 0-40%) | lifecycle = 'emerging' | 1 |
| T14 | Lifecycle mature (連續 >70% + momentum 唔 deteriorating) | lifecycle = 'mature' | 1 |
| T15 | Lifecycle decaying (連續 >70% + momentum deteriorating) | lifecycle = 'decaying' | 1 |
| T16 | Risk budget 強趨勢 (SSI >= 0.7) | risk_budget = 1.0 | 1 |
| T17 | Risk budget 弱趨勢 (SSI 0.2-0.4) | risk_budget = 0.4 | 1 |
| T18 | Kelly ATR% < 2% | kellyFraction = 'half' | 1 |
| T19 | Kelly ATR% > 5% | kellyFraction = 'octo' | 1 |
| T20 | Hurst > 0.6 升 threshold | persistent = 0.6, reverting = 0.4 | 1 |
| T21 | Hurst < 0.4 降 threshold | persistent = 0.5, reverting = 0.5 | 1 |
| T22 | Grade A+ (baseline >= 0.75 + extreme_fear) | grade = 'A+' | 1 |
| T23 | Grade F (baseline < -0.6) | grade = 'F' | 1 |
| T24 | Final action BUY 強信號 | finalAction = 'BUY' | 1 |
| T25 | Final action SELL 強信號 | finalAction = 'SELL' | 1 |
| T26 | Trading card entry_zone / SL / TP 計算 | 全部 positive numbers | 3 |
| T27 | Decision path 至少 5 個 step | decisionPath.length >= 5 | 1 |
| T28 | Mock timeframe (1w from daily 5-day agg) | 數據格式正確 | 2 |

**Total: 30+ assertions ✅**

**5 隻港股 + 5 隻美股 test data:**
- T29-T33: HK.00700 / 09988 / 03690 / 01024 / 01810 嘅 K 線 mock (各自 100 條)
- T34-T38: US.AAPL / MSFT / GOOG / NVDA / TSLA 嘅 K 線 mock (各自 100 條)
- Total: 10 個股票 + 各 2 assertions = 20 assertions

**Grand Total: 50+ assertions ✅**

---

## 14. Permanent Rules (永久)

- ✅ Rule-based + adaptive, 唔用 multiplicative
- ✅ List all matched modules, 唔好 silently pick 一個
- ✅ 5 個 adaptive params runtime auto-calibrate, 唔係 hardcode
- ✅ JSON file cache (L2) 喺 `~/.stockpulse/adaptive_params/<symbol>.json`
- ✅ 7 個 cycle states (BUY/ADD/HOLD/REDUCE/SELL/WAIT/TRAP/TRANSITION)
- ✅ 8 個 grade (A+/A/B+/B/C+/C/D/F)
- ✅ 永遠全 Show (大少 11:57 指示), 將來可 hide 個別 section
- ✅ 多圖少文字, 顏色對應狀態 (大少 11:57 指示)
- ✅ 3 sections 永久 rule (📖 詳細解讀 + 🎯 策略建議 + 💡 點用點睇)
- ✅ 數據 < 200 條 → 拋 error
- ✅ Auto + Manual 兩個 mode (background auto + Testing page 按鈕 manual)
- ✅ Algorithm-only, 唔需要 AI (Stage 1)

---

## 15. Spec 連結 + Permanent Reference

- **對應 docx M7**: `docs/演算法概念SPECS/07多時間框架一致性與極端情緒校準法.docx` (Kimi v2.0 spec)
- **對應 docx M8**: `docs/演算法概念SPECS/08終極綜合判斷引擎.docx` (Kimi v2.0 spec)
- **對應 TS 檔**: `algorithms/AS-03-cycle-detection/modules/decision-engine.ts`
- **對應 tests**: `algorithms/AS-03-cycle-detection/__tests__/decision-engine.test.mjs`
- **對應 adapter**: `algorithms/AS-03-cycle-detection/adapter.mjs` (`decisionEngineAdapter`)
- **Adaptive params cache**: `~/.stockpulse/adaptive_params/<symbol>.json`
- **舊 M7 spec (zmen均算法 spec file)**: `docs/research/AS-03-cycle-detection/ZMEN-MA-ALIGNMENT.md` (不變, 抽離獨立)
- **Roadmap**: `docs/research/AS-03-cycle-detection/ROADMAP.md` §2 Stage 1 排序表 (M7+M8 done, Stage 1 收官)

---

## 16. Changelog

| Date | Version | 改動 | Commit |
|------|---------|------|--------|
| 2026-08-08 | v2.0.0 | 新 module 設計 — M7+M8 合併做 1 個 mega module, 5 個 adaptive params, runtime auto-calibrate + JSON cache, UX 多圖少文字永遠全 Show | TBD (commit after implementation) |
| 2026-08-08 | — | 大少 11:22: 合併 M7 + M8 1 個 mega module, 1 個 testing page entry | spec doc |
| 2026-08-08 | — | 大少 11:39: 5 個 adaptive params auto-calibrate (L2 JSON cache) | spec doc |
| 2026-08-08 | — | 大少 11:57: UX 多圖少文字, 永遠全 Show, 顏色對應狀態 | spec doc |
| 2026-08-08 | v2.0.0 (M7 part) | **Sprint 1 done** — M7 Synthesizer 邏輯 impl (SSI + TCM + Alignment + 8 個 Grade + Kelly 倉位), spec + impl + tests + adapter + testing page 全部上線 (5 commits, +2032 lines, 64 個新 test assertions) | `2acab95d` `f991d9db` `4b8b64fe` `e96f673f` |
| TBD | v2.0.0 (M8 part) | Sprint 2 範圍 — M8 Decision Engine 邏輯 (finalAction 8 個 + trading card + 5 個 adaptive params runtime auto-calibrate + L2 JSON cache + 10 個 SVG chart) | TBD |

---

## 17. Sprint 1 Implementation Notes (大少 2026-08-08 12:30)

### 17.1 Sprint 1 Scope

Sprint 1 (4-5 日) 範圍:
- ✅ **Sub-task 1.1** — 6 個 modules 加 standard verdict interface (base_weight / expected_return / max_drawdown_estimate / sentiment_6d)
- ✅ **Sub-task 1.2** — M7 Synthesizer 邏輯 impl (SSI + TCM + Alignment + 8 個 Grade + Kelly)
- ✅ **Sub-task 1.3** — M7 tests (64 個 assertions, 16 sections)
- ✅ **Sub-task 1.4** — decisionEngineAdapter + testing page 整合 (08 — AS-03-ENG 從 disabled 變 enabled)
- ✅ **Sub-task 1.5** — Sprint 1 Implementation Notes 落 spec doc + 更新其他 spec files

### 17.2 Sprint 1 改動 (5 commits)

| Commit | 內容 |
|--------|------|
| `e96f673f` | `feat(as03-m7-prep): 6 個 modules 加 standard verdict interface 為 M7 Synthesizer 準備` (12 files, +878/-21) |
| `4b8b64fe` | `feat(as03-m7): M7 Synthesizer 邏輯 impl (SSI + TCM + Alignment + Grade + Kelly)` (3 files, +385/-1) |
| `f991d9db` | `test(as03-m7): M7 Synthesizer (DecisionEngine) 64 個 tests, 16 sections` (1 file, +344) |
| `2acab95d` | `feat(as03-m7-adapter): M7 Synthesizer adapter + testing page enable 08 — AS-03-ENG` (2 files, +485/-10) |
| TBD (sub-task 1.5c) | `docs(sync): Sprint 1 spec + doc 同步 (M7 Synthesizer v2.0 done, Sprint 2 M8 pending)` |

### 17.3 設計 decisions (跟 spec)

| Decision | 選擇 | 理由 |
|----------|------|------|
| Grade 8 個 (A+~F) vs 5 個 (A~F) | **8 個** | 跟 spec §6.2 寫明, 8 級更細分 |
| Kelly fraction (0.5/0.25/0.125) vs percentage | **fraction** | Math 較自然 (avg DD × 3 計算) |
| Module weight static vs dynamic | **static** | 5 個 adaptive params auto-calibrate 留俾 Sprint 2 M8 |
| TCM 3 對 pair | (MA, TL), (HL, VP), (IND, VOL) | 跟 spec §3, 形態+趨勢/形態+量能/情緒+波動 |
| Alignment Score formula | max_group_size / total_count | 比 SSI consistency 更直觀 (0-1 range) |
| Grade score formula | ssi_score × 0.6 + alignment × 100 × 0.4 | SSI 60% + Alignment 40% (跟 spec §6.4) |
| Grade boundary inclusive | `grade_score >= 90` 係 A+ | 包含 boundary, 50 → C+, 90 → A+ |
| CycleState 加 'TRAP' | 6 個 modules 唔 return, M7/M8 推導 | Type system 支持但實際由 M7/M8 設置 |

### 17.4 5 個 sub-step 邏輯 (詳細)

#### Step 1: SSI 戰略強度指數
- `consistency = max(state_count) / total_count` (0-1)
- `confidence_avg = Σ(confidence × base_weight) / Σ(base_weight)` (0-1, 加權平均)
- `rules_coverage = min(1, unique_rules / 20)` (0-1)
- `ssi_score = consistency × 50 + confidence_avg × 30 + rules_coverage × 20` (0-100)

#### Step 2: TCM 戰術交叉驗證矩陣
- 3 對 pair: (ma-alignment, trendline), (hl-structure, volume), (indicators, volatility)
- 每對 `alignment`:
  - state 相同 → +1
  - 矛盾 (UP vs DOWN) → -1
  - 其他 (SIDEWAYS + UP 等) → 0
- 每對 `trap_penalty`:
  - alignment = -1 → 0.6 (虛漲)
  - alignment = 0 → 0.2 (唔肯定)
  - alignment = +1 → 0

#### Step 3: Alignment Score
- `alignment_score = max(state_count) / total_count` (0-1)
- 同 SSI consistency, 但係 single field (冇 breakdown)

#### Step 4: Grade (8 個)
- `grade_score = ssi_score × 0.6 + alignment_score × 100 × 0.4` (0-100)
- Map 到 8 個 grade (inclusive boundary):
  - 90-100: A+
  - 80-89: A
  - 70-79: B+
  - 60-69: B
  - 50-59: C+
  - 40-49: C
  - 30-39: D
  - 0-29: F

#### Step 5: Kelly 倉位
- `avg_dd = Σ(max_drawdown_estimate) / 6`
- Map 到 3 個 fraction:
  - avg_dd < 0.05 → half (0.5)
  - 0.05 ≤ avg_dd < 0.10 → quarter (0.25)
  - avg_dd ≥ 0.10 → octo (0.125)
- `kelly_position = kelly_numeric` (基礎 Kelly, 將來 M8 加 TCM + alignment 調整)

### 17.5 Sprint 1 嘅 4 個 Notes (大少要知嘅 side effect)

1. **M1 'ma-alignment' 映射 fix** — Sprint 1.1 順手 fix 咗 index.ts 嘅 bug ('ma-alignment' 而家指 MAAlignmentV2Module 新 v2.0, 唔再指 ZmenMAAlignmentModule 舊 v0.3.0 zmen均算法). 冇呢個 fix M7 aggregate 會拎到舊 v0.3.0 嘅 6 個 fields 而唔係新 v2.0 嘅 13 個 fields.

2. **CycleModuleId 加 'volatility'** — Sprint 1.1 將 'volatility' 加入 CycleModuleId union (之前得 5 個), 同 EnableFlags 加 'volatility' field (預設 ON). CycleDetector 而家 instantiate 6 個 modules (M1-M6), `report.moduleVerdicts.length === 6` (之前 5).

3. **CycleState 加 'TRAP'** — Sprint 1.1 將 'TRAP' 加入 CycleState union. 6 個 modules 自己嘅 detect() 唔 return TRAP (佢哋淨係 return UP/DOWN/SIDEWAYS/TRANSITION), 但 type system 支持 M7/M8 set TRAP. Sprint 2 M8 將會用呢個 type.

4. **BaseWeights 加埋 = 1.00** — 之前 5 個 modules 加埋 = 0.90 (預留 0.10 buffer). Sprint 1.1 加埋 'volatility': 0.10, 6 個 modules 加埋 = 1.00. M7 內部直接用, 唔需要 normalize. 5 個 adaptive params auto-calibrate 會重 scale, 保持總和 = 1.0.

### 17.6 Sprint 1 Testing Page UX (永遠全 Show 簡化版)

Sprint 1 範圍嘅 testing page UI (簡化版, 永遠全 Show):
- ✅ 頂部 verdict card (大型 grade + 分數 + SSI/Alignment/Kelly mini-metric)
- ✅ 6 個 metric mini-cards (SSI 一致性 / 平均信心 / 規則覆蓋)
- ✅ 6 個 modules 表格 (module / state / conf / weight / exp.ret / maxdd / RSI)
- ✅ TCM 3 對 pair 表格 (pair / alignment / trap_penalty)
- ✅ Sprint 1 notice (提示 Sprint 2 將加 finalAction + trading card + 5 adaptive params)

Sprint 2 範圍 (未做):
- ⏸️ 永遠全 Show 嘅 full UI (10 個 SVG chart, 顏色對應狀態)
- ⏸️ M8 finalAction 8 個 (BUY/ADD/HOLD/REDUCE/SELL/WAIT/TRAP/TRANSITION)
- ⏸️ Trading card (entry_zone / stop_loss / take_profit / trailing_stop)
- ⏸️ 5 個 adaptive params runtime auto-calibrate (UI 顯示 + 手動重新校準按鈕)
- ⏸️ L2 JSON file cache (~/.stockpulse/adaptive_params/<symbol>.json)
- ⏸️ 10 隻 demo 股票 test cases (HK.00700/09988/03690/01024/01810 + US.AAPL/MSFT/GOOG/NVDA/TSLA)

### 17.7 Sprint 1 測試覆蓋

| 範圍 | 測試 file | Assertions |
|------|----------|-----------|
| 6 個 modules 加 standard verdict | `__tests__/standard-verdict.test.mjs` | 73 |
| M7 Synthesizer 邏輯 | `__tests__/decision-engine.test.mjs` | 64 |
| M7 Smoke test (adapter level) | 內聯 script 跑 decisionEngineAdapter.analyze() | 1 case |
| **Total Sprint 1 new** | | **137 + 1 smoke** |
| Existing 9 個 test files (unchanged) | | 210 |
| **Grand Total** | | **347 assertions pass** |

### 17.8 Sprint 2 計劃 (M8 Decision Engine + adaptive params)

- **Sprint 2 sub-task 2.1** — M8 finalAction 8 個決策樹 (從 grade + state + alignment 推導 finalAction)
- **Sprint 2 sub-task 2.2** — Trading card 4 個 fields (entry_zone / stop_loss / take_profit / trailing_stop)
- **Sprint 2 sub-task 2.3** — 5 個 adaptive params runtime auto-calibrate
  - 純 math (ATR / Hurst log regression / R² / Pearson correlation)
  - Auto mode (background, cache > 7 日自動重校)
  - Manual mode (testing page 「🔄 重新校準」按鈕)
- **Sprint 2 sub-task 2.4** — L2 JSON file cache (~/.stockpulse/adaptive_params/<symbol>.json)
- **Sprint 2 sub-task 2.5** — 10 隻 demo 股票 test cases
- **Sprint 2 sub-task 2.6** — Full testing page UI (10 個 SVG chart, 永遠全 Show, 顏色對應狀態)
- **Sprint 2 sub-task 2.7** — Sprint 2 spec doc update + commit + push

### 17.9 大少可以即刻試

```bash
# 1. 開 testing page (如果有 LaunchAgent running)
open http://localhost:8765/testing-page/

# 2. 揀 dropdown "08 — AS-03-ENG"
# 3. 輸入股票代碼 e.g. "HK.00700"
# 4. 撳 "跑算法"
# 5. 睇 M7 Synthesizer 嘅 verdict card + 6 個 modules 表格 + TCM 表格
```

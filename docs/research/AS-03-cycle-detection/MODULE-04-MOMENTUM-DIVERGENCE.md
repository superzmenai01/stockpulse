# AS-03 · Module 4: 動能背馳與衰竭檢測法 (Momentum Divergence & Exhaustion) v1.0.0

> 對應 docx: `docs/演算法概念SPECS/04動能背馳與衰竭檢測法.docx` (Kimi v1.0)
> 對應 TS 檔: `algorithms/AS-03-cycle-detection/modules/indicators.ts`
> 對應 tests: `algorithms/AS-03-cycle-detection/__tests__/indicators.test.mjs`
> 對應 adapter: `algorithms/AS-03-cycle-detection/adapter.mjs` (`indicatorsAdapter`)

---

## 1. 點解呢個 module (Why)

前三個 module (MA Alignment / HL Structure / Trendline) 答嘅係「**而家係咩季節**」 — 趨勢 / 結構 / 支撐壓力。

呢個 module 4 答「**幾時該行動**」 — 季節會唔會轉、而家係咪播種時機。

兩大核心功能:
- **背馳檢測 (Divergence)**: 價格創新高但動能指標創唔到新高(頂背馳 → 可能要跌);價格創新低但動能指標創唔到新低(底背馳 → 可能要升)
- **動能衰竭 (Exhaustion)**: 上升/下跌動能逐步減弱,預警趨勢即將結束

仲有兩樣加分嘢:
- **買入/賣出訊號強度** — 綜合背馳 + 超買超賣 + 成交量,輸出「而家買入有幾成勝算」
- **歷史回顧** — 標記過去一個月內「錯過了的最佳買入點」

## 2. 跟前三個 module 嘅協同 (跟 docx §6 一致)

| Module | 佢答嘅問題 | 呢個 module 補充 |
|---|---|---|
| MA Alignment (M1) | 「均線話而家係咩 season」 | 「均線話升,但動能開始衰竭,可能快轉」 |
| HL Structure (M2) | 「峰谷結構」 | 「結構 HH/HL,但 RSI 出現頂背馳,結構可能即將破壞」 |
| Trendline (M3) | 「支撐壓力」 | 「價格觸及支撐線,同時出現底背馳 → 高勝率買入點」 |
| **M4 動能背馳** | **轉勢預警 + 買賣時機** | **「而家係咪行動嘅時候」** |

用法 (docx §7):
- 先睇 M1/M2/M3 → 確認「大方向」
- 再睇 M4 → 確認「幾時入場」
- 例: M1+M2+M3 話「上升」,M4 話「底背馳 + RSI 超賣回升」→ 高勝率買入點
- 例: M1+M2+M3 話「上升」,M4 話「頂背馳 + MACD 死叉」→ 暫時觀望,等回調
- 睇 `historical_opportunities` → 學習「一個月前邊日買最好」

## 3. 輸入 (跟 docx §2)

| Field | Type | Required | Default | 說明 |
|-------|------|----------|---------|------|
| `klines` | KLine[] | ✅ | — | 歷史 K 線,按日期升序 |
| `lookbackDays` | int | ❌ | 60 | 背馳回顧 + 歷史機會掃描天數 |
| `rsiPeriod` | int | ❌ | 14 | RSI 週期 |
| `macdFast` | int | ❌ | 12 | MACD 快線 |
| `macdSlow` | int | ❌ | 26 | MACD 慢線 |
| `macdSignal` | int | ❌ | 9 | MACD 信號線 |
| `divergenceTolerance` | float | ❌ | 0.03 | 背馳判定容忍度 (3%) |
| `minSwingPct` | float | ❌ | 0.03 | 最小波動幅度(過濾雜訊) |
| `signalThreshold` | float | ❌ | 0.6 | 「明確訊號」最低分 |

Min data: `MAX(rsiPeriod, macdSlow + macdSignal) + lookbackDays + 10` = 14 + 35 + 60 + 10 = **119 條**

## 4. 輸出 (跟 docx §3)

```typescript
interface MomentumDivergenceVerdict {
  symbol: string;
  cycle: 'UP' | 'DOWN' | 'SIDEWAYS';          // 統一 cycle state
  cycleLabel: string;                          // 動能偏多 / 偏空 / 中性
  confidence: number;                          // 0.0 - 1.0
  divergence: {
    rsiDivergences: DivergenceEvent[];
    macdDivergences: DivergenceEvent[];
    totalCount: number;
  };
  momentumState: {
    rsi: number;                               // latest RSI value
    macd: number;                              // latest MACD histogram
    rsiTrend: 'rising' | 'falling';
    macdTrend: 'rising' | 'falling';
    macdState: 'bullish_accelerating' | 'bullish_decelerating' | 'bearish_accelerating' | 'bearish_decelerating';
    isOverbought: boolean;                     // RSI > 70
    isOversold: boolean;                       // RSI < 30
  };
  signal: {
    type: 'buy' | 'sell' | 'hold';
    strength: number;                          // 0.0 - 1.0
    action: '買入' | '賣出' | '觀望';
    reasons: string[];                         // List all matched rules
  };
  winProbability: number;                      // 0.5 - 0.85
  exhaustionScore: number;                     // 0.0 - 1.0
  historicalOpportunities: Array<{             // Top 3 missed buy points
    date: string;
    price: number;
    signalStrength: number;
    reason: string;
    returnToDate: number;
    missed: boolean;
  }>;
  adjustmentLog: string[];
  reason: string;                              // 綜合判斷
  lastDate: string;
}
```

## 5. 算法步驟 (跟 docx §4)

### Step 0: 輸入驗證
- min data = 119 條, 唔夠就 `warnings: ['數據不足']` + 早 return default verdict (cycle=SIDEWAYS, confidence=0)

### Step 1: 計算技術指標
- **RSI**: Wilder's smoothing method, period=14
  ```
  gains = max(close[i] - close[i-1], 0)
  losses = max(close[i-1] - close[i], 0)
  avgGain = SMA(gains, period) initially, then Wilder smoothing
  avgLoss = same
  RS = avgGain / avgLoss
  RSI = 100 - (100 / (1 + RS))
  ```
- **MACD (12/26/9)**: EMA-based
  ```
  emaFast = EMA(close, 12)
  emaSlow = EMA(close, 26)
  DIF = emaFast - emaSlow
  DEA = EMA(DIF, 9)
  histogram = DIF - DEA  ← 呢個係 spec 嘅 "macd_values"
  ```

### Step 2: 識別局部極值 (3-window 簡化版)
對 price / RSI / MACD 三條 series 各做:
- 對 index i, 睇 [i-3, i+3] 共 7 點
- 如果 i 嘅 value > [i-3, i-1] 全部 AND > [i+1, i+3] 全部 → **peak**
- 如果 i 嘅 value < [i-3, i-1] 全部 AND < [i+1, i+3] 全部 → **trough**
- 邊界 (i < 3 或 i > n-4) 跳過

### Step 3: 背馳檢測 (核心算法)
對每對 (priceExtrema, indicatorExtrema):
- 取最近 2 個同類型極值 (peak 對 peak / trough 對 trough)
- 計算 swing = `|curr - prev| / prev`, 如果 < minSwingPct (3%) → 跳過 (雜訊)
- 在 indicator series 揾最接近 prev.index / curr.index 嘅 indicator extremum
- **頂背馳 (bearish)**: `curr.close > prev.close × (1 + tolerance)` AND `curr.indicator < prev.indicator`
- **底背馳 (bullish)**: `curr.close < prev.close × (1 - tolerance)` AND `curr.indicator > prev.indicator`
- strength = `(prev.indicator - curr.indicator) / |prev.indicator|` (top) 或 `(curr - prev) / |prev|` (bottom)
- 對 RSI + MACD 各做一次,結果 merge

### Step 4: 動能狀態評估
- `rsiTrend = rising` if `rsi[-1] > AVG(rsi[-6:-1])`, else `falling`
- `macdTrend = rising` if `macd[-1] > AVG(macd[-6:-1])`, else `falling`
- `isOverbought = rsi[-1] > 70`
- `isOversold = rsi[-1] < 30`
- `macdState`:
  - macd > 0 + rising → `bullish_accelerating`
  - macd > 0 + falling → `bullish_decelerating`
  - macd < 0 + falling → `bearish_accelerating`
  - macd < 0 + rising → `bearish_decelerating`

### Step 5: 衰竭分數 (0-1)
```
exhaustionScore = 0
+ 0.3 * (latestRsi - 70) / 30   if isOverbought
+ 0.3 * (30 - latestRsi) / 30   if isOversold
+ 0.3 * (1 - |macd| / max(|macd| last 10))   if max > 0
+ 0.25 * max(rsiDivergence.strength)
+ 0.25 * max(macdDivergence.strength)
exhaustionScore = clamp(0, 1)
```

### Step 6: 交易訊號 (買入/賣出/觀望)
**多頭 score (買入)**:
- 底背馳: +0.35
- RSI 超賣回升: +0.25
- MACD 金叉 (macd > 0 AND prev macd <= 0): +0.25
- MACD 下跌動能減弱: +0.15
- 放量 (volume > 10d avg × 1.2): +0.15

**空頭 score (賣出)**:
- 頂背馳: +0.35
- RSI 超買回落: +0.25
- MACD 死叉 (macd < 0 AND prev macd >= 0): +0.25

**判定**:
- bullScore ≥ 0.6 AND bullScore > bearScore → `buy` + `UP`
- bearScore ≥ 0.6 AND bearScore > bullScore → `sell` + `DOWN`
- 否則 → `hold` + `SIDEWAYS`

### Step 7: 勝率估算
- buy/sell base = 0.55
- 底背馳 / 頂背馳: +0.12
- 超買 / 超賣: +0.08
- macd_decelerating: +0.05
- max 0.85
- hold → 0.50

### Step 8: 歷史機會回顧
- 掃描過去 `lookbackDays` 日,逐日 re-run 簡化版 signal
- 如果當時 signal = buy AND strength ≥ threshold AND 到今日 return > 2%
- → 加入 `historicalOpportunities`
- Sort by signal_strength desc, 取 top 3

### Step 9: 信心指數
- base = signalStrength
- 背馳數 ≥ 2: × 1.15
- exhaustion > 0.6 + 訊號方向 match: × 1.10
- clamp 0-1

### Step 10: 組裝輸出

## 6. Cycle State 統一 (跟 ma-alignment 一致)

| Signal Type | Cycle | Cycle Label |
|-------------|-------|-------------|
| `buy` | `UP` | 動能偏多 |
| `sell` | `DOWN` | 動能偏空 |
| `hold` | `SIDEWAYS` | 動能中性 |

**State priority**: 無 (呢個 module 直接 derive cycle 從 signal type,冇內部 priority list)

## 7. Adapter 設計 (frontend 整合)

跟其他 module 同一 pattern (`adapter.mjs`):
- `indicatorsAdapter` 喺 adapter.mjs export
- `analyzeIndicators(klines, options)` 入口
- `renderIndicatorsResult(verdict)` render 結果
- `renderChartOverlay` (optional, 視乎想唔想喺 chart 畫 RSI/MACD)
- 3 個 sections 永久 rule (大少 #11056): `renderDetailedExplanationIndicators` / `renderStrategyAdviceIndicators` / `renderUsageGuideIndicators`

Testing page entry 命名: **AS-03-IND** (跟 AS-03-MA / AS-03-HL / AS-03-TL pattern)

## 8. 永久 Rules

- **Rule-based + additive confidence** (大少 #10097) — 唔 multiplicative
- **List all matched rules** — `signal.reasons` array, 唔好 silently pick 一個
- **State priority** = 統一 (UP/DOWN/SIDEWAYS) 跟其他 module 一致
- **3-Section Rule** (大少 #11056) — 必 render 📖 + 🎯 + 💡
- **Plain language** (大少 #10299) — 假設大少只識 PE/ETF/MACD/limit order
- **Min data 119 條** — 唔夠就 default verdict (SIDEWAYS, conf=0) + warning, 唔 crash

## 9. Workflow Status (大少 7-step)

| Step | Status |
|------|--------|
| 1. Spec (本 doc) | 🚧 In progress |
| 2. Code (`modules/indicators.ts`) | ⏸ Pending |
| 3. Tests (`__tests__/indicators.test.mjs` 14/14) | ⏸ Pending |
| 4. Adapter (`adapter.mjs`) + 3 sections | ⏸ Pending |
| 5. Testing page entry (AS-03-IND) | ⏸ Pending |
| 6. Visual verify on testing page | ⏸ Pending |
| 7. Doc sync + commit + push | ⏸ Pending (待大少 review) |

---

**Maintainer**: 大少 (zmen)
**Created**: 2026-08-07
**Source spec**: `docs/演算法概念SPECS/04動能背馳與衰竭檢測法.docx` (Kimi v1.0)

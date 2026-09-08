# AS-03 · Module 4: 動能背馳與衰竭檢測法 (Momentum Divergence & Exhaustion) v0.2.0

> 對應 docx: `docs/演算法概念SPECS/04動能背馳與衰竭檢測法.docx` (Kimi v1.0)
> 對應 TS 檔: `algorithms/AS-03-cycle-detection/modules/indicators.ts` v0.2.0
> 對應 backend: `backend/algorithms/indicators/algorithm.py` v0.2.0 (1:1 port)
> 對應 tests: `algorithms/AS-03-cycle-detection/__tests__/indicators.test.mjs`
> 對應 adapter: `algorithms/AS-03-cycle-detection/adapter.mjs` (`indicatorsAdapter`)
> Spec Sync: #52 (大少 2026-09-09 01:55, 12 個 fix)

---

## 1. 點解呢個 module (Why)

前三個 module (MA Alignment / HL Structure / Trendline) 答嘅係「**而家係咩季節**」 — 趨勢 / 結構 / 支撐壓力。

呢個 module 4 答「**幾時該行動**」 — 季節會唔會轉、而家係咪播種時機。

兩大核心功能:
- **背馳檢測 (Divergence)**: 價格創新高但動能指標創唔到新高(頂背馳 → 可能要跌);價格創新低但動能指標創唔到新低(底背馳 → 可能要升)
- **動能衰竭 (Exhaustion)**: 上升/下跌動能逐步減弱,預警趨勢即將結束

仲有兩樣加分嘢:
- **買入/賣出訊號強度** — 綜合背馳 + 超買超賣 + 成交量,輸出「而家買入有幾成勝算」
- **歷史回顧** — 標記過去 `lookbackDays` (v0.2.0 1 年) 內「錯過了的最佳買入點」

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
- 睇 `historicalOpportunities` → 學習「一個月前邊日買最好」

**v0.2.0 改動 (A3 cross-module alignment)**: algorithm_runner.py 自動 inject M1 state 落 M4 options.m1State, M4 見到 M1 講 DOWN 但 M4 出 buy → 自動降權 50% + emit FALLBACK_USED warning, 凡人話: 大環境 DOWN 嗰陣唔好亂話 buy, 畀 M1 過濾一下。

## 3. 輸入 (跟 docx §2)

| Field | Type | Required | Default | 說明 |
|-------|------|----------|---------|------|
| `klines` | KLine[] | ✅ | — | 歷史 K 線,按日期升序 |
| `lookbackDays` | int | ❌ | **250** (v0.2.0) | 背馳回顧 + 歷史機會掃描天數 (1 年尺度) |
| `rsiPeriod` | int | ❌ | 14 | RSI 週期 |
| `macdFast` | int | ❌ | 12 | MACD 快線 |
| `macdSlow` | int | ❌ | 26 | MACD 慢線 |
| `macdSignal` | int | ❌ | 9 | MACD 信號線 |
| `divergenceTolerance` | float | ❌ | 0.03 | 背馳判定容忍度 (3%) |
| `minSwingPct` | float | ❌ | 0.03 | 最小波動幅度(過濾雜訊) |
| `signalThreshold` | float | ❌ | **0.5** (v0.2.0) | 「明確訊號」最低分 (買入/賣出) |

Min data (v0.2.0): `MAX(rsiPeriod, macdSlow + macdSignal) + lookbackDays + 10` = 35 + 250 + 10 = **295 條** (原本 v1.0.0 119 條)

## 4. 輸出 (跟 docx §3, v0.2.0 加 audit field)

```typescript
interface MomentumDivergenceVerdict {
  moduleId: 'indicators';
  symbol: string;                              // v0.2.0 A6: caller symbol
  timeframe: string;
  state: 'UP' | 'DOWN' | 'SIDEWAYS';           // 統一 cycle state
  cycleLabel: string;                          // 動能偏多 / 偏空 / 中性
  confidence: number;                          // 0.0 - 0.95 (v0.2.0 B1 ban 1.0)
  interpretation: string;
  evidence: Evidence[];                        // 含 Hurst / ADX (v0.2.0 A1)
  warnings: string[];                          // v0.2.0 A4: self-check warnings
  _warnings: string[];                         // 永久 rule v1.1.0 spirit: inlined
  meta: {
    inputBars: number;
    symbol: string;                            // v0.2.0 A6
    hurst: number;                             // v0.2.0 A1: audit field
    adx: number;                               // v0.2.0 A1: audit field
    regimeGate: 'PASSED' | 'FAILED';           // v0.2.0 A1
    m1State: 'UP' | 'DOWN' | 'SIDEWAYS' | 'TRANSITION';  // v0.2.0 A3: audit field
    selfCheckTriggered: boolean;               // v0.2.0 A5: audit field
    originalConfidence: number;                // v0.2.0 A5: audit field
    divergence: {
      rsiDivergences: DivergenceEvent[];
      macdDivergences: DivergenceEvent[];
      totalCount: number;
    };
    momentumState: {
      rsi: number;
      macd: number;
      rsiTrend: 'rising' | 'falling';
      macdTrend: 'rising' | 'falling';
      macdState: 'bullish_accelerating' | 'bullish_decelerating' | 'bearish_accelerating' | 'bearish_decelerating';
      isOverbought: boolean;
      isOversold: boolean;
    };
    signal: {
      type: 'buy' | 'sell' | 'hold';
      strength: number;                        // 0.0 - 0.95 (v0.2.0 B1)
      action: '買入' | '賣出' | '觀望';
      reasons: string[];
      m1FilterApplied: boolean;               // v0.2.0 A3
      crossConfirmed: boolean;                 // v0.2.0 A7
    };
    winProbability: number;
    exhaustionScore: number;
    historicalOpportunities: Array<{...}>;     // v0.2.0: lookbackDays 250
    reason: string;
    lastDate: string;
    rsiSeries: number[];
    macdSeries: number[];
    configUsed: IndicatorsConfig;
  };
  timestamp: number;
}
```

## 5. 算法步驟 (跟 docx §4, v0.2.0 加 Step 0.5 + Step 9.5)

### Step 0: 輸入驗證
- min data = **295 條** (v0.2.0), 唔夠就 emit `INSUFFICIENT_DATA` warning + 早 return default verdict (cycle=SIDEWAYS, confidence=0)

### Step 0.5: Hurst+ADX regime gate (v0.2.0 A1, 對齊 M3 Spec Sync #45 永久 rule)
**凡人話**: 冇 trend 嘅 stock (Hurst < 0.45 OR ADX < 20) 唔好亂話 buy/sell, 永遠 hold。

```python
hurst, _ = compute_hurst(closes, window=100)  # DFA Hurst 指數
adx_data = compute_adx(recent_klines, period=14)  # Wilder 14 日 ADX
adx = adx_data.get("adx", 50.0)

regime_passed = hurst >= 0.45 and adx >= 20
if not regime_passed:
    emit CONFLICT_STATE warning (info level, 唔 floor conf, 對齊 v1.1.0 spirit)
    return SIDEWAYS verdict with confidence=0.3 (base)
    meta: hurst, adx, regimeGate="FAILED"
```

- Hurst 0.45 = trending 持續性低 (random walk)
- ADX 20 = 弱趨勢 (Wilder's standard)
- H ≥ 0.45 AND ADX ≥ 20 → 繼續正常算法

### Step 1: 計算技術指標 (v0.2.0 B3 改 RSI 5 日 linear slope)
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
  histogram = DIF - DEA
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

### Step 4: 動能狀態評估 (v0.2.0 B3 改 linear slope)
- **rsiTrend (v0.2.0 B3)**: `rsiSlope5d = rsi[-1] - rsi[-6]`, threshold ±5.0 嘅 raw difference
  - 之前 v1.0.0: `rsi[-1] > AVG(rsi[-6:-1])` 唔算趨勢, 永遠 1 個值 vs 1 個 average 唔穩
  - v0.2.0 改用 linear slope, 對齊 0-100 scale 嘅 5% 變化
- **macdTrend**: `macd[-1] > 0` ? 'rising' : 'falling'
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

### Step 6: 交易訊號 (v0.2.0 加 A3 + A7 + B1 + B2)

**多頭 score (買入)**:
- 底背馳: +0.35
- **底背馳 + cross-confirm** (v0.2.0 A7): RSI 同 MACD 同時底背馳 → +0.10 bonus
- RSI 超賣回升: +0.25
- MACD 金叉 (macd > 0 AND prev macd <= 0): +0.25
- MACD 下跌動能減弱: +0.15
- **放量 + 收 > MA5** (v0.2.0 B2): 收 > MA5 AND volume > 10d avg × 1.2 → +0.15
  - 之前 v1.0.0: 純粹放量, 對齊 Arxum 67% win rate research 加埋 MA5 確認

**空頭 score (賣出)**:
- 頂背馳: +0.35
- **頂背馳 + cross-confirm** (v0.2.0 A7): +0.10 bonus
- RSI 超買回落: +0.25
- MACD 死叉: +0.25

**v0.2.0 A3 M1 state filter** (cross-module alignment):
```python
if m1_state == "DOWN" and bull_score > bear_score and bull_score > 0:
    bull_score *= 0.5  # 降一半
    m1_filter_applied = True
    reasons.append("⚠️ M1 state=DOWN 與 buy 矛盾, 降權 50%")
elif m1_state == "UP" and bear_score > bull_score and bear_score > 0:
    bear_score *= 0.5
    m1_filter_applied = True
```
凡人話: 大環境 DOWN 嗰陣唔好 trigger buy, 大環境 UP 嗰陣唔好 trigger sell, emit FALLBACK_USED warning 畀 M7 layer 拎。

**判定** (v0.2.0 signalThreshold 0.5):
- bullScore ≥ 0.5 AND bullScore > bearScore → `buy` + `UP` (strength clamp 0.95)
- bearScore ≥ 0.5 AND bearScore > bullScore → `sell` + `DOWN` (strength clamp 0.95)
- 否則 → `hold` + `SIDEWAYS` (strength clamp 0.95)

### Step 7: 勝率估算
- buy/sell base = 0.55
- 底背馳 / 頂背馳: +0.12
- 超買 / 超賣: +0.08
- macd_decelerating: +0.05
- max 0.85
- hold → 0.50

### Step 8: 歷史機會回顧 (v0.2.0 lookbackDays 250, 1 年尺度)
- 掃描過去 250 日,逐日 re-run 簡化版 signal
- 簡化 signal: RSI < 35 + MACD 由負翻正 + close > MA5
- 如果當時 signal 有效 AND 到今日 return > 2%
- → 加入 `historicalOpportunities`
- Sort by signal_strength desc, 取 top 3

### Step 9: 信心指數 (v0.2.0 B1 clamp 0.95)
- base = signalStrength
- 背馳數 ≥ 2: × 1.15
- exhaustion > 0.6 + 訊號方向 match: × 1.10
- **clamp 0 - 0.95** (v0.2.0 B1: 永久 ban 1.0, 對齊 M3 Layer 4 formula 永久 rule)

### Step 9.5: self-check penalty (v0.2.0 A5, 對齊 M2 9月7日 22:00 永久 rule)

**凡人話**: 算法自己 flag 唔 sure 嗰陣, conf 自動 floor 0.3, state 唔變 (由 M7 layer 處理 weight 折扣)。

```python
critical_or_warn_count = sum(1 for w in self_check_warnings if w.level in ('critical', 'warning'))
if critical_or_warn_count > 0:
    confidence = max(confidence * 0.375, 0.3)  # floor 0.3
    self_check_triggered = True

# 永久 ban 1.0 (對齊 M3 Layer 4)
confidence = min(confidence, 0.95)
```

5 個 self-check warning code:
- **INSUFFICIENT_DATA** (critical) — K 線唔夠 min data
- **CONFLICT_STATE** (info) — Regime gate 唔過, 唔 floor conf
- **FALLBACK_USED** (warning) — M1 state 同 M4 signal 矛盾, 已降權 50%
- **THRESHOLD_BREACH** (warning) — 最終 conf < 0.3 門檻
- **MODULE_PARTIAL** (warning) — 冇背馳 evidence 但有 buy/sell signal

info level 唔 floor conf (對齊 §Module Warning v1.1.0 spirit)。

### Step 10: 組裝輸出
- 統一 cycle state derivation (見 §6)
- 永遠 emit `symbol` 從 caller (永久 rule 9月7日 08:30)
- 永遠 emit `warnings` array 落 verdict (永久 rule v1.1.0 spirit)
- 永遠 emit audit field: hurst, adx, m1State, selfCheckTriggered, originalConfidence

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
- `analyzeIndicators(klines, options)` 入口 — **Phase 5 (大少 2026-08-20 21:10) 拎走 frontend algorithm, 改 fetch backend** `/api/algorithms/run?algo=indicators`
- `renderIndicatorsResult(verdict)` render 結果 — **v0.2.0 加 Hurst/ADX/regimeGate/M1 state/self-check 顯示**
- `renderChartOverlay` (RSI + MACD line series, 對齊 kline index)
- 3 個 sections 永久 rule (大少 #11056): `renderDetailedExplanationIndicators` / `renderStrategyAdviceIndicators` / `renderUsageGuideIndicators`

Testing page entry 命名: **AS-03-IND** (跟 AS-03-MA / AS-03-HL / AS-03-TL pattern)

**v0.2.0 對齊 backend shape**: verdict.meta 新增 `hurst` / `adx` / `regimeGate` / `m1State` / `selfCheckTriggered` / `originalConfidence` 6 個 audit field, verdict.meta.signal 新增 `m1FilterApplied` / `crossConfirmed` 2 個 flag。

## 8. 永久 Rules

### v1.0.0 永久 rules (沿用)
- **Rule-based + additive confidence** (大少 #10097) — 唔 multiplicative
- **List all matched rules** — `signal.reasons` array, 唔好 silently pick 一個
- **State priority** = 統一 (UP/DOWN/SIDEWAYS) 跟其他 module 一致
- **3-Section Rule** (大少 #11056) — 必 render 📖 + 🎯 + 💡
- **Plain language** (大少 #10299) — 假設大少只識 PE/ETF/MACD/limit order
- **Min data 295 條** (v0.2.0, 原本 119) — 唔夠就 default verdict (SIDEWAYS, conf=0) + INSUFFICIENT_DATA warning, 唔 crash

### v0.2.0 永久 rules (Spec Sync #52, 12 個 fix)

**§M4 Hurst+ADX regime gate (大少 2026-09-09 01:55, A1)**
- ✅ M4 algorithm 永遠 emit Hurst+ADX gate check
- ✅ H < 0.45 OR ADX < 20 → 強制 return SIDEWAYS + emit CONFLICT_STATE warning (info level)
- ✅ Backend `indicators/algorithm.py` + Frontend `modules/indicators.ts` 1:1 port 同步
- ✅ Meta 永遠 emit `hurst` + `adx` + `regimeGate` 3 個 audit field
- ✅ Frontend import `computeHurst` + `computeAdx` from `./trendline.ts` (frontend function 名 `computeHurst` / `computeAdx`, 唔係 backend `_compute_hurst` / `_compute_adx`)
- ✅ 對齊 Module Warning v1.1.0 — `CONFLICT_STATE` info level, 唔 floor conf

**§M4 M1 state trend filter cross-module alignment (大少 2026-09-09 01:55, A3)**
- ✅ algorithm_runner.py 自動 inject `options["m1State"]` 落 M4 (對齊 9月7日 08:30 meta.symbol 永久 rule pattern)
- ✅ M4 見到 M1=DOWN 但 M4 出 buy → bull_score × 0.5 + emit FALLBACK_USED warning
- ✅ M4 見到 M1=UP 但 M4 出 sell → bear_score × 0.5 + emit FALLBACK_USED warning
- ✅ Signal emit `m1FilterApplied: bool` flag 畀 caller audit
- ✅ Meta 永遠 emit `m1State: 'UP' | 'DOWN' | 'SIDEWAYS' | 'TRANSITION'`

**§M4 self-check penalty (大少 2026-09-09 01:55, A5)**
- ✅ M4 algorithm Step 9.5 永遠拎 critical + warning level self-check warning 觸發 conf floor 0.3
- ✅ 公式 `max(conf * 0.375, 0.3)` — 原本 conf 0.8 → 0.3, 0.56 → 0.3
- ✅ info level (CONFLICT_STATE) 唔觸發 floor
- ✅ state 唔變, 由 M7 layer 處理 weight 折扣
- ✅ Meta 永遠 emit `selfCheckTriggered: bool` + `originalConfidence: float` 2 個 audit field
- ✅ 對齊 M2 9月7日 22:00 self-check penalty 永久 rule spirit

**§M4 cross-confirm bonus (大少 2026-09-09 01:55, A7)**
- ✅ RSI + MACD 同時出現同一類背馳 → bull_score / bear_score +0.10 bonus
- ✅ Signal emit `crossConfirmed: bool` flag 畀 caller
- ✅ 對齊 Tradealgo 71% win rate research (兩個獨立指標同時確認, 信心提升)

**§M4 Layer 4 formula ban conf 1.0 (大少 2026-09-09 01:55, B1)**
- ✅ Signal strength clamp 0.95 (永久 ban 1.0)
- ✅ Confidence clamp 0.95
- ✅ 對齊 M3 Layer 4 永久 rule spirit (Spec Sync #45, 2026-09-07 00:14)

**§M4 confirmation candle (大少 2026-09-09 01:55, B2)**
- ✅ B2 放量必須同時 收 > MA5 (對齊 Arxum 67% win rate research)
- ✅ 之前 v1.0.0 純粹放量, v0.2.0 加收 > MA5 確認

**§M4 RSI 5 日 linear slope (大少 2026-09-09 01:55, B3)**
- ✅ 用 `rsi[-1] - rsi[-6]` raw difference, threshold ±5.0
- ✅ 之前 v1.0.0 單點 vs 5 日 average 唔穩, v0.2.0 改 linear slope 對齊 0-100 scale 嘅 5% 變化

**§M4 meta.symbol caller symbol (大少 2026-09-09 01:55, A6)**
- ✅ Algorithm 永遠用 `options.get("symbol", "UNKNOWN")` 拎 caller symbol (對齊 9月7日 08:30 永久 rule)
- ✅ algorithm_runner.py 統一 inject `options["symbol"] = caller_symbol`
- ✅ Meta 永遠 emit `symbol` field, 唔好 hardcode "TEST"

## 9. Workflow Status (大少 7-step)

| Step | Status |
|------|--------|
| 1. Spec (本 doc) | ✅ v0.2.0 done (Spec Sync #52, 2026-09-09) |
| 2. Code (`modules/indicators.ts` + `backend/algorithms/indicators/algorithm.py`) | ✅ v0.2.0 1:1 port done |
| 3. Tests (`__tests__/indicators.test.mjs` 14/14) | ⏸ Pending (待 v0.2.0 加 Hurst+ADX 測試) |
| 4. Adapter (`adapter.mjs`) + 3 sections | ✅ v0.2.0 done (對齊 backend shape 加 Hurst/ADX/M1/self-check 顯示) |
| 5. Testing page entry (AS-03-IND) | ✅ v0.2.0 cache bust done (ALGO_CACHE_BUST '4.76.0', ?v=2.3.155) |
| 6. Visual verify on testing page | ✅ 5 隻 stock curl verify done (HK.00700 SIDEWAYS 0.3, US.MSFT UP 0.35, US.AAPL/GOOGL SIDEWAYS, HK.00005 INSUFFICIENT_DATA) |
| 7. Doc sync + commit + push | ✅ Spec Sync #52 done, commit e342e4b (backend) + frontend sync (待 push) |

**Stage 2 audit 結果** (214 隻 stock, v0.2.0 vs v1.0.0):
- v1.0.0 baseline: 211/214 SIDEWAYS (98.6%), 0 UP, 0 warning
- v0.2.0: 188/214 (87.9%) 有 warning, 2 UP verdict (新!)
- Warning code 分布: CONFLICT_STATE 101, INSUFFICIENT_DATA 44, THRESHOLD_BREACH 43
- M1 一致率: 56.5% (v0.2.0) — A3 M1 filter 預期持續改善

---

**Maintainer**: 大少 (zmen)
**Created**: 2026-08-07 (v1.0.0)
**Updated**: 2026-09-09 01:55 (v0.2.0, Spec Sync #52)
**Source spec**: `docs/演算法概念SPECS/04動能背馳與衰竭檢測法.docx` (Kimi v1.0)

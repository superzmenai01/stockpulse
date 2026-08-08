# AS-03 · Module 8: 終極綜合判斷引擎 (Decision Engine v1.0.0, Sprint 2 sub-task 2.1 done)

> **對應 docx**: `docs/演算法概念SPECS/08終極綜合判斷引擎.docx` (Kimi v2.0 spec)
> **對應 TS 檔**: `algorithms/AS-03-cycle-detection/modules/decision-engine.ts` (M8 v1.0.0 impl, Sprint 2 sub-task 2.1 done)
> **對應 tests**: `algorithms/AS-03-cycle-detection/__tests__/decision-engine.test.mjs` (52 assertions, 13 sections)
> **對應 adapter**: `algorithms/AS-03-cycle-detection/adapter.mjs` (`decisionEngineAdapter` v1.0.0)

> **大少 2026-08-08 13:30 指示 (Plan A 拆返 M7+M8)**: M8 Decision Engine 將喺 Sprint 2 實作. M7 嘅 5 個 sub-step 邏輯 (SSI / TCM / Alignment / Grade / Kelly) 喺 `MODULE-07-SYNTHESIZER.md`, M8 chain M7 嘅 output 推導 finalAction + trading card + 短期走勢 + 人話解讀.

---

## 1. 點解呢個 module (Why)

M7 Synthesizer 出咗 SynthesizerVerdict (grade + kelly + 6 個 module breakdown). 但 verdict 唔等於 actionable decision — 大少要嘅係:

- **明確 buy/sell 訊號**: 「幾時買入, 咩價, 應唔應該買?」— 唔係一句 grade, 係 8 個 finalAction 嘅明確 trigger
- **人話詳細解讀**: 「點解要走 / 等待 / 持貨觀察」— 大少唔識 jargon, 要用白話解釋
- **短期走勢預測**: 「5 日 / 10 日 / 20 日 內會點?」— conditional scenarios (樂觀 / 基準 / 悲觀)

呢個 module = **M8 校長 + 紀律委員會** (接 M7 評卷老師 output):
- M7 評卷老師: 「呢個學生 (股票) 考試成績係 B+ (75分)」
- M8 校長: 「B+ 嘅成績應該點做? 入場價 $X, 止蝕 $Y, 目標 $Z, monitor 邊個 indicator」

---

## 2. M8 Chain (從 M7 output → finalAction + trading card + 短期走勢 + 人話解讀)

```
M7 SynthesizerVerdict
  ↓
[5 個 adaptive params runtime auto-calibrate] (auto + manual)
  ↓
M8 Decision Engine
  ↓
8 個 finalAction 決策樹
  ├─ BUY / ADD / HOLD / REDUCE / SELL / WAIT / TRAP / TRANSITION
  ↓
Trading card (entry_zone / stop_loss / take_profit / trailing_stop)
  ↓
短期走勢預測 (5/10/20 日 × 3 個 scenarios)
  ↓
人話詳細解讀 (LLM hook 預留, 大少 13:30 永久 rule)
  ↓
DecisionVerdict (final 嘅 output)
```

---

## 3. 8 個 FinalAction + Trigger Conditions (大少用揸車比喻) — **Sprint 2 sub-task 2.1 impl done**

| Final Action | 人話 | Trigger Conditions (全部 AND) | Priority |
|--------------|------|-------------------------------|----------|
| 🟣 **TRAP** | 「導航話直路但其實係懸崖, 唔好信」 | squeezeDetected=true AND fakeBreakoutDetected=true (虛漲假突破) | 1 (最危險) |
| 🟣 **TRANSITION** | 「前面路口要轉彎, 收油準備」 | maTrendlineTransition=true (M1 + M3 同步轉勢) | 2 |
| 🔴 **SELL** | 「前面有意外, 急煞車」 | majorityState=DOWN AND grade≤C AND max_drawdown_estimate>10% (下跌確認) | 3 |
| 🟠 **REDUCE** | 「路面開始爛, 收返少少油」 | majorityState=TRANSITION AND alignment<0.5 (矛盾訊號) | 4 |
| 🟡 **WAIT** | 「路口塞車, 等綠燈」 | majorityState=SIDEWAYS AND grade=C AND alignment<0.6 (冇明確方向) | 5 |
| 🟡 **HOLD** | 「條路平穩, 保持現速」 | majorityState=UP AND grade=B/C+ AND max_drawdown<8% (趨勢仲 OK 但唔強) | 6 |
| 🟢 **ADD** | 「直路仲長, 油門再踩深啲」 | majorityState=UP AND grade≥A AND alignment≥0.7 AND RSI>70 AND 連漲≥3日 | 7 |
| 🟢 **BUY** | 「導航話直路, 油門俾到底」 | majorityState=UP AND alignment≥0.6 AND grade≥B AND expected_return>3% AND max_drawdown<10% AND RSI>50 | 8 (最尾) |

**Implementation notes**:
- 8 個 trigger 用 if/else if priority order check, 第一個 match 嘅就 return
- 全部 trigger 唔 match → fallback WAIT (保守, final_action_reason 包含「未能匹配明確 trigger」)
- Grade 比較用 `GRADE_ORDER = ['F', 'D', 'C', 'C+', 'B', 'B+', 'A', 'A+']` index (0=F 最低, 7=A+ 最高)
  - `isGradeAtLeast(g, threshold)` = indexOf(g) >= indexOf(threshold)
  - `isGradeAtMost(g, threshold)` = indexOf(g) <= indexOf(threshold)
- majorityState 從 6 個 verdicts 用 majority vote (max count, tie → SIDEWAYS)
- RSI 從 indicators module 嘅 sentiment_6d.rsi 反標準化: raw = (sentiment_6d.rsi + 1) × 50
- 連漲日數從 klines 倒數計, 第一日唔升為止
- 2.1 嘅 squeeze/fake breakout/maTrendlineTransition 暫時用 false fallback, 2.5 將 derive 從 M1/M3/M5/M6 raw data

**Tests**: 13 sections, 52 assertions, 100% pass (decision-engine.test.mjs)
- 8 個 finalAction 各自 1-4 個 trigger test case
- Boundary conditions (alignment=0.6, grade=B, RSI=70, maxdd=0.10, exp.ret=3% etc.)
- Priority order (TRAP > TRANSITION > SELL > REDUCE > WAIT > HOLD > ADD > BUY)
- Fallback (no match → WAIT)
- Empty input
- Trading card static formula (entry_zone ±1.5%, stop_loss -3%, take_profit +5%, trailing_stop 5%)
- Output structure (DecisionVerdict 全部 9 個 fields)

---

## 4. Trading Card (4 個 fields) — **Sprint 2 sub-task 2.2 adaptive impl done**

```typescript
interface TradingCard {
  entry_zone: [number, number];    // [low, high] 入場價區間
  stop_loss: number;                // 止蝕 (跌破即 cut loss)
  take_profit: number;              // 目標
  trailing_stop: number;            // 移動止蝕
}
```

**Adaptive formula (2.2 — 跟 `synthesizerVerdict.kelly_fraction` + `weighted avg max_drawdown_estimate`)**:

| Volatility Bucket | Trigger | entry_zone | stop_loss | take_profit | trailing_stop | R:R |
|-------------------|---------|------------|-----------|-------------|---------------|-----|
| 🔴 **高波動** | `kelly='octo'` OR `maxdd > 0.10` | 現價 ± 2.5% | 現價 - 5% | 現價 + 8% | 現價 - 7% | 1.6:1 |
| 🟡 **中波動** (default) | `kelly='quarter'` OR `maxdd 0.05-0.10` | 現價 ± 1.5% | 現價 - 3% | 現價 + 5% | 現價 - 5% | 1.67:1 |
| 🟢 **低波動** | `kelly='half'` AND `maxdd < 0.05` | 現價 ± 1.0% | 現價 - 2% | 現價 + 4% | 現價 - 3% | 2.0:1 |

**Algorithm** (純 math):
```typescript
function computeTradingCard(currentPrice, kellyFraction, maxDrawdown) {
  if (kellyFraction === 'octo' || maxDrawdown > 0.10) {
    // 高波動 — 闊止蝕止賺避免被震走
    return makeCard(currentPrice, 0.025, 0.05, 0.08, 0.07);
  } else if (kellyFraction === 'half' && maxDrawdown < 0.05) {
    // 低波動 — 窄止蝕止賺更精準
    return makeCard(currentPrice, 0.010, 0.02, 0.04, 0.03);
  } else {
    // 中波動 default
    return makeCard(currentPrice, 0.015, 0.03, 0.05, 0.05);
  }
}
```

**設計原理**: 波動高嘅股票, 止蝕止賺要闊啲 (避免被正常波動震走); 波動低嘅股票, 止蝕止賺可以收窄 (更精準出入場).

**Tests**: 17 assertions (5 高波動 + 5 中波動 + 5 低波動 + 1 maxdd override + 1 currentPrice=0 fallback)

**未來 (Sprint 2 sub-task 2.5)**: 5 個 adaptive params 嘅 #3 Kelly 倉位分數 (跟 ATR% auto-calibrate) 將 refine 呢個 bucket 切換 threshold (而家 static maxdd > 0.10 / < 0.05).

---

## 5. 短期走勢預測 (3 scenarios × 3 timeframes = 9 個 forecasts)

| Scenario | 概率 | 5 日 | 10 日 | 20 日 |
|----------|------|------|-------|-------|
| 🟢 **樂觀** (optimistic) | 25% | +3% | +6% | +12% |
| 🟡 **基準** (baseline) | 50% | +1% | +2% | +3% |
| 🔴 **悲觀** (pessimistic) | 25% | -2% | -4% | -7% |

**算法** (純 math, 從 M7 sentiment_6d + expected_return + max_drawdown 衍生):
```typescript
function forecast(scenario, days, expected_return, max_drawdown) {
  const dayFactor = days / 5;  // 線性 scaling (5 日係 baseline)
  if (scenario === 'optimistic') return expected_return * 1.5 * dayFactor;
  if (scenario === 'baseline')   return expected_return * 1.0 * dayFactor;
  if (scenario === 'pessimistic') return -max_drawdown * 0.5 * dayFactor;
}
```

**重要**: 呢個係 conditional scenarios, **唔係 prediction**. 真實 buy/sell 決定睇 finalAction trigger, 唔係睇 scenarios.

---

## 6. 5 個 Adaptive Params (runtime auto-calibrate)

大少 11:39 + 11:42 確認嘅 5 個 params:

| # | Code 名 | Human 名 | Default | Adaptive Rule |
|---|---------|---------|---------|----------------|
| 1 | `ssiWeights: { ma, hl, trendline }` | SSI 戰略層權重 | 0.30/0.30/0.40 | 60 日 R² 計三條線貼合度, normalize 加權 |
| 2 | `rsiWeight` | RSI 情緒權重 | 0.20 | sentiment 6 維平均 (RSI/%B/乖離率/波動偏度/換手率/連漲跌加速度) |
| 3 | `kellyFraction` | Kelly 倉位分數 | 'half' (0.5) | ATR% < 2% = half, 2-5% = quarter, ≥ 5% = octo (跟股票波動自動切) |
| 4 | `markowitzCorr: { dailyWeekly, dailyMonthly, weeklyMonthly }` | 馬可維茨相關係數 | 0.85/0.60/0.70 | 252 日真實 correlation 算 |
| 5 | `hurstThresholds: { persistent, reverting }` | Hurst 持續/反轉 threshold | 0.55/0.45 | Hurst 自身 > 0.6 升, < 0.4 降 |

**純 math** (ATR / Hurst log regression / R² least squares / Pearson correlation), 唔用 AI / LLM.
**Auto + Manual 兩個 mode**: Auto (background, cache > 7 日自動重校) + Manual (testing page 「🔄 重新校準」按鈕).

---

## 7. L2 JSON File Cache (Stage 1, 唔改 backend)

```typescript
// ~/.stockpulse/adaptive_params/<symbol>.json
{
  "symbol": "HK.00700",
  "last_calibrated": "2026-08-08T12:00:00Z",
  "params": {
    "ssiWeights": { "ma": 0.32, "hl": 0.28, "trendline": 0.40 },
    "rsiWeight": 0.22,
    "kellyFraction": "half",
    "markowitzCorr": { "dailyWeekly": 0.86, "dailyMonthly": 0.58, "weeklyMonthly": 0.71 },
    "hurstThresholds": { "persistent": 0.56, "reverting": 0.44 }
  },
  "calibration_samples": 252,
  "calibration_window_days": 60,
  "auto": true
}
```

Stage 2 升 L3 DB (唔改呢個 format).

---

## 8. 人話詳細解讀 (LLM hook 預留, 大少 13:30 永久 rule)

```typescript
// render function 入面 (大少 13:30 永久 rule 必須有呢個 interface)
async function generateInterpretation(ctx: {
  finalAction: FinalAction;
  moduleVerdicts: ModuleStandardVerdict[];
  synthesizerVerdict: SynthesizerVerdict;
  shortTermForecast: ForecastScenario[];
}): Promise<string> {
  // 而家 Sprint 2 用 hardcoded template (template literal + if/else)
  // 將來可以直接 swap 落 LLM call (OpenAI / MiniMax / Kimi 任何 provider)
  return hardcodedInterpretation(ctx);
}
```

**Example BUY 嘅解讀**:
> **📈 應該買入**。6 個 module 入面, 4 個都認為上升 (M1 均線 + M2 高低 + M3 趨勢 + M5 量價), 信心度達 75%, grade B+ 級。
>
> **點解要買**: MA5 上穿 MA10 + 量能放大 1.3 倍 + RSI 60 (偏強但未超買), 4 個 trigger 全部 fired。
>
> **入場價**: $492.50 - $498.00 (現價 ± 1.5%)
> **止蝕**: $478.00 (現價 -3%, 跌破即 cut loss)
> **目標**: $515.00 (現價 +5%, 1.5:1 risk-reward)
>
> **後續 monitor**: 跌穿 $478 (止蝕) 或 RSI > 75 (超買) 就要 re-evaluate

---

## 9. 永遠全 Show UX (大少 11:57 永久 rule)

testing page 永遠全 Show, 多圖少文字, 6 個顏色對應狀態:

- 🟢 #26BA75 — 強勢上升 / BUY / 確認
- 🟡 #F39C12 — 觀望 / HOLD / 中性
- 🔴 #EE5151 — 強勢下跌 / SELL / 警告
- 🔵 #1890ff — 資訊性 / 中性 / 數據
- 🟣 #722ed1 — 陷阱 / 矛盾 / TRANSITION
- ⚫ #666 — 唔適用 / N/A

10 個 SVG chart 將喺 Sprint 2 實作 (Sentiment Radar / Timeframe Alignment / Trend Comparison / Position Donut / 等).

---

## 10. Sprint 2 範圍 (大少 13:30 confirm)

| Sub-task | 內容 | 工作量 |
|----------|------|--------|
| 2.1 | 8 個 finalAction 決策樹 | 0.5 日 |
| 2.2 | Trading card 4 個 fields | 0.5 日 |
| 2.3 | 短期走勢預測 (3 scenarios × 3 timeframes) | 0.5 日 |
| 2.4 | 人話詳細解讀 (LLM hook 預留) | 1 日 |
| 2.5 | 5 個 adaptive params runtime auto-calibrate | 1 日 |
| 2.6 | L2 JSON file cache | 0.5 日 |
| 2.7 | 10 隻 demo 股票 test cases (HK.00700/09988/03690/01024/01810 + US.AAPL/MSFT/GOOG/NVDA/TSLA) | 0.5 日 |
| 2.8 | Full testing page UI (10 個 SVG chart + 永遠全 Show) | 1 日 |
| 2.9 | Sprint 2 spec doc update + commit + push | 0.5 日 |
| **Total** | | **6-7 日** |

---

## 11. 大少可以即刻試 (M7 + M8 部分, 2.1 done, 2.2-2.5 pending)

```bash
# 1. 開 testing page
open http://localhost:8765/testing-page/

# 2a. 揀 dropdown "07 — AS-03-SYN (Synthesizer)" → 跑 M7
#     → 睇 grade card + 6 個 modules 表格 + TCM 表格

# 2b. 揀 dropdown "08 — AS-03-DEC (Decision Engine)" → 跑 M7 + M8 (2.1 done)
#     → 睇 M8 8 個 finalAction 標籤 (揸車比喻) + final_action_reason
#     → 睇 M7 grade card (reuse)
#     → 睇 trading card 4 個 fields (2.1 static formula, 2.2 將 adaptive)
#     → 2.3-2.4 仍係 placeholder (short_term_forecast [] / interpretation "")

# 3. 輸入股票代碼 e.g. "HK.00700"
# 4. 撳 "跑算法"
```

---

## 12. Changelog

| Date | Version | 改動 | Commit |
|------|---------|------|--------|
| 2026-08-08 13:30 | v0.0.0 (stub) | M8 spec doc 拆返自 MODULE-07-08-DECISION-ENGINE.md (Plan A 拆返 M7+M8) | 36496159 |
| 2026-08-08 15:42 | v1.0.0 (sub-task 2.1) | M8 finalAction 8 個決策樹 + 揸車比喻 final_action_reason + trading card static formula + decisionEngineAdapter 真正 render | cd1d5ac6 |
| 2026-08-08 16:05 | v1.1.0 (sub-task 2.2) | Trading card adaptive formula (3 個 volatility buckets: high/medium/low, 跟 kelly_fraction + max_drawdown) | TBD (本 commit) |
| TBD | v1.2.0 (sub-task 2.3) | 短期走勢預測 9 scenarios (3 × 3 timeframes) | TBD |
| TBD | v1.3.0 (sub-task 2.4) | 人話詳細解讀 (LLM hook, hardcoded template) | TBD |
| TBD | v2.0.0 (sub-task 2.5) | 5 個 adaptive params runtime auto-calibrate (squeeze/fake breakout/M1+M3 derivation) | TBD |

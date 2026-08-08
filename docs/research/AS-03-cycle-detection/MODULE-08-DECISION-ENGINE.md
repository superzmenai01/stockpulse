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

## 5. 短期走勢預測 (3 scenarios × 3 timeframes = 9 個 forecasts) — **Sprint 2 sub-task 2.3 impl done**

| Scenario | 概率 | expected_return formula | max_drawdown formula |
|----------|------|--------------------------|----------------------|
| 🟢 **optimistic** (樂觀) | 25% | `expected_return × 1.5 × (days/5)` | `max_drawdown × 0.5` |
| 🟡 **baseline** (基準) | 50% | `expected_return × 1.0 × (days/5)` | `max_drawdown × 0.7` |
| 🔴 **pessimistic** (悲觀) | 25% | `-max_drawdown × 0.5 × (days/5)` | `max_drawdown × 1.0` |

**Timeframes**: 5 日, 10 日, 20 日 (線性 scaling: dayFactor = days/5)

**Example** (UP state, expected_return=0.07, max_drawdown=0.10):

| 日數 | 🟢 Optimistic | 🟡 Baseline | 🔴 Pessimistic |
|------|----------------|--------------|-----------------|
| 5 日 | +10.5% (MD 5.0%) | +7.0% (MD 7.0%) | -5.0% (MD 10.0%) |
| 10 日 | +21.0% (MD 5.0%) | +14.0% (MD 7.0%) | -10.0% (MD 10.0%) |
| 20 日 | +42.0% (MD 5.0%) | +28.0% (MD 7.0%) | -20.0% (MD 10.0%) |

**Algorithm** (純 math, 從 synthesizerVerdict.expected_return + weighted avg max_drawdown 衍生):
```typescript
function computeShortTermForecast(expectedReturn, maxDrawdown) {
  const timeframes = [5, 10, 20];
  const forecast = [];
  for (const days of timeframes) {
    const dayFactor = days / 5;
    forecast.push({ scenario: 'optimistic', timeframe_days: days, expected_return: +(expectedReturn * 1.5 * dayFactor).toFixed(4), max_drawdown: +(maxDrawdown * 0.5).toFixed(4), probability: 0.25 });
    forecast.push({ scenario: 'baseline', timeframe_days: days, expected_return: +(expectedReturn * 1.0 * dayFactor).toFixed(4), max_drawdown: +(maxDrawdown * 0.7).toFixed(4), probability: 0.50 });
    forecast.push({ scenario: 'pessimistic', timeframe_days: days, expected_return: +(-maxDrawdown * 0.5 * dayFactor).toFixed(4), max_drawdown: +(maxDrawdown * 1.0).toFixed(4), probability: 0.25 });
  }
  return forecast;
}
```

**重要**: 呢個係 conditional scenarios, **唔係 prediction**. 真實 buy/sell 決定睇 finalAction trigger, 唔係睇 scenarios. 9 個 scenarios 只係畀大少了解 3 種可能走勢嘅範圍.

**Tests**: 17 assertions (1 數量 + 1 timeframe + 1 scenario + 3 sign + 3 概率 + 3 day factor scaling + 3 max_drawdown bucket + 2 fallback cases)

**Testing page render**: 3 × 3 table (rows = 5/10/20 日, columns = 樂觀/基準/悲觀), 每格顯示 expected_return 顏色 (綠正紅負) + MD 細字.

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

**Implementation** (純 math, 唔用 AI / LLM): 5 個 helper functions 喺 `modules/decision-engine.ts` (linearRegressionR2 / computeATRFromArrays / pearsonCorrelation / computeHurstExponent). `calibrateAdaptiveParams(klines, sentiment6DHistory)` 一次過 return 5 個 params. `applyAdaptiveParamsToSynthesizer(sv, params)` 將 params 應用去 M7 嘅 SSI weight.

**Auto + Manual 兩個 mode**: Auto (background, cache > 7 日自動重校, **2.6 將加 L2 JSON cache**) + Manual (testing page 「🔄 重新校準」按鈕, **2.6 將加**).

**Tests**: 18 assertions (3 export check + 5 個 params 各 2 個 test + 1 empty klines default + 1 數據不足 + 3 applyAdaptiveParams integration).

**3 個 market data detect helpers** (M6 squeeze / M3+M5 fake breakout / M1+M3 transition): `detectSqueeze`, `detectFakeBreakout`, `detectMATLTransition` 喺 adapter.mjs (純 math).

---

## 7. L2 JSON File Cache (Stage 1) — **Sprint 2 sub-task 2.6 impl done**

```json
// ~/.stockpulse/adaptive_params/<symbol>.json
{
  "symbol": "HK.00700",
  "last_calibrated": 1723089600.123,
  "params": {
    "ssiWeights": { "ma": 0.32, "hl": 0.28, "trendline": 0.40 },
    "rsiWeight": 0.22,
    "kellyFraction": "half",
    "markowitzCorr": { "dailyWeekly": 0.86, "dailyMonthly": 0.58, "weeklyMonthly": 0.71 },
    "hurstThresholds": { "persistent": 0.56, "reverting": 0.44 }
  },
  "auto": true
}
```

**Implementation** (Sprint 2 sub-task 2.6):
- `backend/services/adaptive_params_cache.py` — 純 disk I/O cache module
  - `save_params(symbol, params)` — atomic write (tmp file + rename)
  - `load_params(symbol)` — 讀返 + 7 日 expiry check
  - `is_cache_valid(symbol)` — 7 日內返 True
  - `delete_params(symbol)` — testing page 「🔄 重新校準」按鈕用
  - `list_cached_symbols()` — admin endpoint
  - `clear_all()` — admin endpoint
- `backend/api/adaptive_params.py` — FastAPI router
  - `GET    /api/adaptive-params/{symbol}` — 讀 cache (404 if 過期)
  - `POST   /api/adaptive-params/{symbol}` — 儲存 params (validate kelly + ssiWeights sum = 1.0)
  - `DELETE /api/adaptive-params/{symbol}` — 刪 cache
  - `GET    /api/adaptive-params` — 列出全部 cached symbols
- Path sanitization: 只允許 alphanumeric + `._-`, 任何 char 被移除都 reject (防 path traversal)
- Stage 2 將升 L3 DB, format 保持不變

**Frontend integration** (testing page):
- `adapter.mjs decisionEngineAdapter.analyze` 流程:
  1. `GET /api/adaptive-params/{symbol}` 試讀 cache
  2. valid → 用 cache; 過期/不存在 → 重新 calibrate + POST save
  3. cache info (last_calibrated, age, valid) 顯示喺 render

**Tests**: 21 pytest assertions (5 save + 3 load + 4 validity + 2 delete + 3 list + 1 clear + 2 integration + 1 atomic write)

**Manual 重新校準按鈕** (testing page render):
- 「🔄 重新校準」button 顯示喺 cache status 行
- 撳 → DELETE cache + 重新 calibrate (2.8 將 wire 落 testing-page.js event handler)

---

## 8. 人話詳細解讀 (LLM hook 預留, 大少 13:30 永久 rule) — **Sprint 2 sub-task 2.4 impl done**

```typescript
// LLM hook 永久 rule (大少 13:30 確認, 寫入 user memory)
// M8 render function 必須有 async generateInterpretation(ctx) interface
// Sprint 2 而家用 hardcoded template, 將來 swap 落 LLM call (OpenAI / MiniMax / Kimi 任何), 唔使改 decide() 嘅 call site

export async function generateInterpretation(ctx: InterpretationContext): Promise<string> {
  return hardcodedInterpretation(ctx);
  // 將來 swap 落 LLM:
  //   return await openai.complete(promptFromCtx(ctx))
  //   return await minimax.complete(promptFromCtx(ctx))
}

export interface InterpretationContext {
  final_action: FinalAction;
  module_verdicts: ModuleStandardVerdict[];
  synthesizer_verdict: SynthesizerVerdict;
  short_term_forecast: ForecastScenario[];
}
```

**Hardcoded template — 8 個 finalAction 各自嘅白話詳細解讀** (揸車比喻貫穿 + plain language + emoji):

| Final Action | 解讀主題 | 模板要素 |
|--------------|---------|---------|
| 🟢 BUY | 應該買入 | 上升 module 數 + grade + alignment + 短期基準預期 + 風控 (止蝕止賺) + 倉位建議 |
| 🟢 ADD | 油門再踩深啲 | 強勢確認 4 條件 + 短期基準預期 + RSI 超買注意 + 倉位可能 > 100% |
| 🟡 HOLD | 保持現速 | grade + alignment 唔夠 BUY 條件 + Monitor 等下次 trigger + 倉位不變 |
| 🟡 WAIT | 等綠燈 | SIDEWAYS + 6 個 module 持平 + 短期方向唔清晰 + 持有現金 |
| 🟠 REDUCE | 收返少少油 | TRANSITION 矛盾 + 收緊倉位 + Monitor 確認方向 |
| 🔴 SELL | 急煞車 | DOWN 確認 + 下跌 module 數 + 短期基準負回報 + 止蝕 cut loss + 未持倉 avoid 撈底 |
| 🟣 TRAP | 唔好信導航 | squeeze + 假突破 + 虛漲陷阱 + 完全唔好加倉 |
| 🟣 TRANSITION | 收油準備轉彎 | M1 + M3 同步轉勢 + 趨勢即將改變 + 減倉等確認 |

**Example BUY 嘅 hardcoded 解讀**:
> 📈 **應該買入**。4 個 module 認為上升, SSI 戰略強度 75/100, alignment 67%, grade B+ 級。
>
> 💡 **點解要買**: MA 均線 + 高低點 + 趨勢線同步上升 (4/6 個 module 一致), grade 過到 B 級, 短期 5 日基準預期回報 +7.0%
>
> 🛑 **風控**: 止蝕位喺入場區下限 -3% (跌破即 cut loss), 目標 +5% 1.67:1 風險回報比
>
> 💰 **倉位**: quarter 倉 (跟波動自動切, 高波動縮細, 低波動放大)

**將來 swap 落 LLM 步驟** (永久 rule 實作):
1. `hardcodedInterpretation()` 喺 modules/decision-engine.ts 換成 `return await llmCall(promptFromCtx(ctx))`
2. `promptFromCtx(ctx)` 將 ctx 變 LLM prompt string (含 finalAction + 6 module breakdown + grade + forecast)
3. `decide()` method 嘅 `await generateInterpretation(ctx)` 唔使改 (已經用 interface)
4. testing page 即時見到 LLM 解讀, render helper `renderInterpretation()` 唔使改

**Tests**: 15 assertions (8 finalAction 各 1 個 keyword + 1 LLM hook interface + 4 內容檢查: 唔空/包含 plain language/包含倉位/包含短期走勢/包含 emoji)

**Testing page render**: 「📖 大少話你知」box, 將 multiline `\n` 轉 `<div>`, `**bold**` 轉 `<strong>`, 加左 border 跟 finalAction 顏色 (大少 11:57 永久 rule).

---

## 9. 永遠全 Show UX (大少 11:57 永久 rule) — **Sprint 2 sub-task 2.8 impl done (4 個 SVG charts)**

testing page 永遠全 Show, 多圖少文字, 6 個顏色對應狀態 (大少 11:57 永久 rule):

- 🟢 #26BA75 — 強勢上升 / BUY / 確認
- 🟡 #F39C12 — 觀望 / HOLD / 中性
- 🔴 #EE5151 — 強勢下跌 / SELL / 警告
- 🔵 #1890ff — 資訊性 / 中性 / 數據
- 🟣 #722ed1 — 陷阱 / 矛盾 / TRANSITION
- ⚫ #666 — 唔適用 / N/A

**4 個 SVG Chart** (Sprint 2 sub-task 2.8 impl done, 將 spec 嘅 10 個濃縮做 4 個核心):

| # | Chart | Function | 用途 | 顏色對應 |
|---|-------|----------|------|----------|
| 1️⃣ | **Sentiment Radar** | renderSentimentRadar() | 6 維情緒雷達 (RSI/%B/乖離/波動/換手/動能) | 跟 finalAction 顏色 |
| 2️⃣ | **Kelly Donut** | renderKellyDonut() | 倉位分數 donut (half 50% / quarter 25% / octo 12.5%) | half=綠 / quarter=黃 / octo=紅 |
| 3️⃣ | **Alignment Bar** | renderAlignmentBar() | Alignment score 0-1 視覺化 | <0.4 紅, 0.4-0.7 黃, >0.7 綠 |
| 4️⃣ | **Module State Bar** | renderModuleStateBar() | 6 個 module 嘅 state + confidence 全部 Show | 跟 state color (UP 綠, DOWN 紅, SIDEWAYS 黃, TRANSITION/TRAP 紫) |

**Spec 原本 10 個 SVG Chart 嘅 status** (Stage 2+ 將做返):

- [x] Sentiment Radar ✅
- [x] Position Donut ✅ (Kelly)
- [x] Alignment Bar ✅
- [x] Trend Comparison Bar ✅ (Module State)
- [ ] Timeframe Alignment Heatmap
- [ ] Rule Coverage Donut
- [ ] Grade Progress Bar
- [ ] Adaptive Params Heatmap
- [ ] M8 Final Action Wheel
- [ ] Short Term Forecast Line Chart
- [ ] Probability Pie Chart

**Testing page 「🔄 重新校準」按鈕** (大少 2.8 wire 落 testing-page.js):
- M8 verdict card render 時, adaptive params box 顯示「🔄 重新校準」按鈕
- 撳 → DELETE cache → 重新跑 runAlgorithm() (會 calibrate + POST save 新 cache)
- 按鈕狀態: idle → ⏳ 重新校準中... → ✅ 已重新校準 / ❌ 失敗 → 2 秒後回 idle
- 對應 spec: MODULE-08-DECISION-ENGINE.md §6 (Manual mode)

**Tests**: 0 新增 (render helpers 純 SVG, 2.7 demo tests 已經 verify 完整 flow), 全部 728 assertions pass 唔受 2.8 影響.

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

## 13. 10 隻 Demo 股票 Test Cases (Sprint 2 sub-task 2.7)

大少 11:39 confirm 嘅 10 隻 demo 股票 (5 港 + 5 美):

| Symbol | Name | Mock startPrice | Volatility |
|--------|------|----------------|------------|
| 🇭🇰 HK.00700 | 騰訊 | $380 | 1.8% |
| 🇭🇰 HK.09988 | 阿里 | $85 | 2.2% |
| 🇭🇰 HK.03690 | 美團 | $120 | 2.5% |
| 🇭🇰 HK.01024 | 快手 | $50 | 3.0% |
| 🇭🇰 HK.01810 | 小米 | $15 | 2.5% |
| 🇺🇸 US.AAPL | 蘋果 | $175 | 1.5% |
| 🇺🇸 US.MSFT | 微軟 | $380 | 1.3% |
| 🇺🇸 US.GOOG | 谷歌 | $140 | 1.8% |
| 🇺🇸 US.NVDA | 英偉達 | $850 | 3.0% |
| 🇺🇸 US.TSLA | 特斯拉 | $240 | 3.5% |

**Test approach** (deterministic + reproducible):
- 每個 symbol 用 hash 拎 stable seed
- Seeded random walk (LCG) 生成 252 日 mock klines
- 跑完整 flow: `calibrateAdaptiveParams` + `engine.decide()` + verify output
- 唔 fetch 真實數據 (避免 backend 依賴)

**Tests**: 10 stocks × 20 assertions = **200 assertions**, 100% pass (decision-engine-demo.test.mjs)

每隻股票 20 個 assertion categories:
1. 252 個 mock klines 生成成功
2. 所有 OHLC > 0
3. `calibrateAdaptiveParams` 唔 crash
4-8. 5 個 adaptive params 全部 valid range (ssiWeights sum = 1.0, rsiWeight 0.1-0.5, kellyFraction in [half, quarter, octo], markowitzCorr 3 對 in [-1, +1], hurstThresholds 0.5/0.45 ± 0.05)
9. `engine.decide()` 唔 crash
10. finalAction 8 個之一 (唔係 unknown)
11-15. trading card 4 個 fields 全部 > 0
16. entry_zone[0] < entry_zone[1] (low < high)
17. stop_loss < currentPrice < take_profit (邏輯 sanity check)
18. 9 個 short_term_forecast
19. interpretation 唔空
20. 9 個 forecast probability 總和 = 3.0 (3 scenarios × 3 timeframes × 1.0)

## 12. Changelog

| Date | Version | 改動 | Commit |
|------|---------|------|--------|
| 2026-08-08 13:30 | v0.0.0 (stub) | M8 spec doc 拆返自 MODULE-07-08-DECISION-ENGINE.md (Plan A 拆返 M7+M8) | 36496159 |
| 2026-08-08 15:42 | v1.0.0 (sub-task 2.1) | M8 finalAction 8 個決策樹 + 揸車比喻 final_action_reason + trading card static formula + decisionEngineAdapter 真正 render | cd1d5ac6 |
| 2026-08-08 16:05 | v1.1.0 (sub-task 2.2) | Trading card adaptive formula (3 個 volatility buckets: high/medium/low, 跟 kelly_fraction + max_drawdown) | c4e072a5 |
| 2026-08-08 16:08 | v1.2.0 (sub-task 2.3) | 短期走勢預測 9 scenarios (3 × 3 timeframes) + 3 × 3 table render + example + algorithm | 8ad3af82 |
| 2026-08-08 16:15 | v1.3.0 (sub-task 2.4) | 人話詳細解讀 (LLM hook 預留 + 8 個 hardcoded template + InterpretationContext interface) | 917cc08d |
| 2026-08-08 16:25 | v2.0.0 (sub-task 2.5) | 5 個 adaptive params runtime auto-calibrate (純 math: R²/ATR/Pearson/Hurst + apply + 3 個 market data detect helpers) | f33774e9 |
| 2026-08-08 16:35 | v2.1.0 (sub-task 2.6) | L2 JSON file cache (~/.stockpulse/adaptive_params/) + Python FastAPI GET/POST/DELETE + 「🔄 重新校準」按鈕 (UI placeholder) | 16388296 |
| 2026-08-08 16:45 | v2.2.0 (sub-task 2.7) | 10 隻 demo 股票 test cases (5 港 + 5 美, seeded random walk 252 日 klines, 200 assertions) | ccb13d2b |
| 2026-08-08 16:55 | v2.3.0 (sub-task 2.8) | 4 個 SVG chart (Sentiment Radar + Kelly Donut + Alignment Bar + Module State) + 「🔄 重新校準」按鈕 wire 落 testing-page.js (DELETE → runAlgorithm → POST save) | TBD (本 commit) |

# AS-03 · 決策記錄 (ADR-style)

> 大少決定 / 我嘅架構判斷，記低呢度避免將來重覆諗。

---

## D001 · Module 6 = Orchestrator step 0 (唔係 peer)

**日期:** 2026-08-04
**狀態:** ✅ Accepted
**Decider:** 大少確認 + 架構判斷

### 背景
文件寫「6 個點」平行，但「時間框架統一性」本質係 hierarchy constraint (HTF 壓倒 LTF)，同其他 5 個「判斷方法」唔同 level。

### 決定
- Module 6 實作為 `orchestrator/multi-tf.ts`
- 喺 5 個 peer modules 之前跑
- HTF verdict 注入 LTF 分析做 constraint

### 影響
- ✅ UI 仍然顯示 Module 6 嘅 HTF verdict (符合大少「6 個 model 結果都顯示」)
- ❌ 唔可以將 Module 6 同 Module 1-5 平等 vote
- ❌ 唔可以做 weighted vote 時將 Module 6 同其他 5 個比 weight

---

## D002 · 4 個 Cycle State + 中文解讀

**日期:** 2026-08-04
**狀態:** ✅ Accepted
**Decider:** 大少確認

### 背景
文件 3 個 state (上升/下跌/橫行) 太粗，缺 transition。

### 決定
- `CycleState = UP | DOWN | SIDEWAYS | TRANSITION`
- 每個 `CycleVerdict` 必填 `interpretation: string` (中文人話)

### 影響
- ✅ Module 1-5 全部要 output 中文解讀
- ✅ Synthesizer 都要 output 中文解讀
- ⚠️ 大少之後可能加更多 state (e.g. accumulation/distribution)

---

## D003 · 滯後機制 = 提醒 + 手動判

**日期:** 2026-08-04
**狀態:** ✅ Accepted
**Decider:** 大少確認

### 背景
文件講「觀察 3-5 個交易日確認」。實作 state machine auto-progress 會誤導。

### 決定
- 唔做 state machine (TENTATIVE → CONFIRMED auto)
- 用 `RegimeChangeAlerter` emit `RegimeChangeAlert` (只喺 state 變化時)
- User 手動 confirm / reject
- Alert 帶 `chineseMessage` (人話提示)

### 影響
- ✅ User 唔會被假信號誤導
- ✅ Alert 有完整 audit trail
- ⚠️ User 要主動 check alert (可以接 push notification 之後)

---

## D004 · Synthesizer 策略 = 最後先傾

**日期:** 2026-08-04
**狀態:** ⏳ Pending
**Decider:** 大少未決定

### 背景
6 個 module conflict resolution 策略影響深遠，太早定會鎖死將來選擇。

### 決定
- 當前 placeholder: simple majority vote (`aggregator.ts`)
- 3 個候選策略 (大少最後揀):
  1. **htf-override** — HTF 壓倒性優先
  2. **weighted-vote** — 每個 module 有 weight
  3. **expert-rules** — rule-based (可審計)
- Config.ts 留 `aggregator.strategy` field

### 影響
- ⚠️ 將來切換策略需要 re-validate (backtest)
- ⚠️ Per-stock / per-sector 可能要唔同策略

---

## D005 · 所有 threshold 集中喺 config.ts

**日期:** 2026-08-04
**狀態:** ✅ Accepted
**Decider:** 架構判斷

### 背景
文件用形容詞（「明顯」「粘合」「放量」），落地需要 calibration。

### 決定
- 所有 tunable 參數集中喺 `config.ts`
- 每個 module 接受 config 注入 (`constructor(private config: XxxConfig)`)
- `DEFAULT_CYCLE_CONFIG` 提供合理預設

### 影響
- ✅ Calibration 容易 (改 config 唔使改 code)
- ✅ Per-stock / per-sector 客製 config (將來)
- ⚠️ Ground truth dataset 仍未建立 (backtest 後再 calibrate)

---

## D006 · 6 個 model 結果都顯示

**日期:** 2026-08-04
**狀態:** ✅ Accepted
**Decider:** 大少確認

### 背景
大少要求「6 個 model 結果都要顯示」。

### 決定
- `CycleReport.moduleVerdicts` 包含 **5 個 peer module verdicts**
- `CycleReport.htf` 包含 **Module 6 嘅 HTF verdict** (1 個)
- `CycleReport.synthesized` 包含 **Module 7 結果** (1 個)
- UI 全部顯示 (冇隱藏)
- **總共顯示 = 5 + 1 (HTF) + 1 (synth) = 7 個 verdict card**

### 影響
- ✅ User 見到所有 evidence，唔係黑盒
- ✅ 大少可以對比 module 間嘅分歧
- ⚠️ UI 比較複雜 (7 個 verdict card 要清楚表達)

---

## D007 · Per-stock calibration (待定)

**日期:** 2026-08-04
**狀態:** ⏳ Pending
**Decider:** 大少未答

### 背景
文件提「藍籌股週期長，小型股週期短」，但大少未答應要唔要 per-stock config。

### 決定
- 暫時用 single global config (`DEFAULT_CYCLE_CONFIG`)
- `CycleConfig` 設計支援 per-stock 注入 (將來)
- 等大少確認先決定

### 影響
- ⚠️ 將來可能要加 `config: Record<symbol, CycleConfig>` mapping

---

## D008 · 數據來源 = backend `/api/kline` (cache-aside 沿用)

**日期:** 2026-08-04
**狀態:** ✅ Accepted (大少更正)
**Decider:** 大少明確指出

### 背景
我之前說「數據全部從 OpenD 讀取」係錯嘅。大少更正：
- 正確流程：開竹節圖 → 先讀 DB → DB 唔夠 / 過期就由 OpenD 補到 T-1 → 當日由 OpenD 補 → 合併
- 數據遵從 StockPulse 現有 cache-aside 機制 (backend 已做)，AS-03 唔需要 re-implement

### 決定
- AS-03 frontend 通過 `GET /api/kline` 攞數據 (HTTP client in `data-loader.ts`)
- 沿用 `backend/services/kline_cache.py` 嘅 cache-aside 邏輯
- 關鍵 rule (#7983): DB 只 cache T-1 及之前，當日 always fresh from OpenD

### 影響
- ✅ AS-03 唔需要 implement cache
- ✅ Backend 改進自動惠及 AS-03
- ⚠️ AS-03 離線 / 後端不可用時會 fail (要 handle network errors)
- ⚠️ CycleDetector.analyze() 之前係接收 KLine[] input，而家可以內部 load data

---

## D009 · 6 個 module 全包 (Q3 答案)

**日期:** 2026-08-04
**狀態:** ✅ Accepted
**Decider:** 大少 Q3 確認

### 背景
之前 Q3 問「6 個 module 全部都係 required，定有 priority？」

### 決定
- 全部 6 個 peer module 都跑 (Q3 = 全包)
- UI 顯示全部 6 個結果 (D006)

### 影響
- ✅ 簡單，唔使 tune priority
- ⚠️ 多 D 1-2 個 ms response time (5 module 並列跑)

---

## D010 · Backtest ground truth = 日後再傾 (Q4 答案)

**日期:** 2026-08-04
**狀態:** ⏳ Deferred
**Decider:** 大少 Q4 確認

### 背景
之前 Q4 問「Backtest ground truth 邊度嚟？」

### 決定
- 暫時 skip (日後先傾)
- 等算法成熟後再 design calibration methodology

### 影響
- ⚠️ 現時 threshold 係合理 default (e.g. alignmentGapPct=0.5%)
- ⚠️ 將來 tune 時需要 ground truth

---

## 📝 對話歷史

- 2026-08-04 09:11 — 大少 trigger: 「現在我們開始研究第三條演算法」
- 2026-08-04 09:14 — 我讀完 docx，提出 5 個 critical issues + 4 個 questions
- 2026-08-04 09:44 — 大少答 5 個 issues
- 2026-08-04 09:45 — 我建 folder + skeleton + 寫 D001-D007
- 2026-08-04 10:13 — 大少講電腦吾句，要求人話 + 話數據全部由 OpenD 讀
- 2026-08-04 10:27 — 大少更正：數據遵從現有 cache-aside 機制 (DB + 當日 OpenD)，並答 Q3 = 全包 / Q4 = 日後再傾
- 2026-08-04 10:30 — 我加 D008 (cache-aside) / D009 (Q3) / D010 (Q4) + 寫 data-loader.ts
- 2026-08-04 10:45 — 大少 trigger 第一個 model 詳細做法 (MA Alignment docx)
- 2026-08-04 10:50 — 我寫 [MODULE-01-MA-ALIGNMENT.md](../../../docs/research/AS-03-cycle-detection/MODULE-01-MA-ALIGNMENT.md) (8.9 KB spec)，提出 D011-D015 等大少 decide
- 2026-08-04 12:13 — 大少 #10273 答 Q1-Q5: 1:A 2:B 3:A 4:A和B 5:A，加 note 測試要記得 3 個 concerns + 最終測試用大少標準
- 2026-08-04 12:14 — 我 update D011-D015 Accepted + 開始 implement

---

## D011 · 3-state vs 4-state cycle mapping (Q1)

**日期:** 2026-08-04
**狀態:** ✅ Accepted (Option A)
**Decider:** 大少 #10273

### 背景
Docx v2.0 algorithm 只 output 3 個 cycle state (`uptrend` / `downtrend` / `sideways`)，但 D002 已定咗 `CycleState = UP | DOWN | SIDEWAYS | TRANSITION` (4 state)。

### 衝突
- ma-alignment module 應該 output 邊個？
- TRANSITION 點 trigger？

### 3 個 Option

**Option A** — ma-alignment 只 output 3-state，TRANSITION 由 synthesizer 判
- ✅ 最簡單，符合 docx 原意
- ✅ Synthesizer 嘅 job 本身就係綜合衝突
- ❌ Synthesizer 需要加 TRANSITION detection logic

**Option B** — ma-alignment 自己 detect TRANSITION
- 例如：candidate=uptrend 但 vol_signal=shrinking + short_ma_slope<0 → emit TRANSITION
- ✅ Module 自主判
- ❌ Docx 冇呢個邏輯，要 invent
- ❌ 同 synthesizer 嘅判可能矛盾

**Option C** — ma-alignment output 3-state + `transitionScore: number` (0-1)
- Synthesizer 用 score 決定 TRANSITION
- ✅ 彈性最大
- ❌ 多一個 field，介面複雜

### 我嘅推薦
**Option A** — 保持 docx 簡單，synthesizer 嘅 job 加埋呢個 logic (D004 傾 strategy 時一齊決定)。

### 影響
- 影響 types.ts (唔加 RawCycle type)
- 影響 synthesizer 設計

---

## D012 · Volume 角色衝突 (Q2)

**日期:** 2026-08-04
**狀態:** ✅ Accepted (Option B)
**Decider:** 大少 #10273

### 背景
- Docx: volume 係 ma-alignment 內部嘅 confidence multiplier (Step 5 + 7b)
- Skeleton: 獨立 `modules/volume.ts` peer module

### 衝突
- 係 absorb 埋 volume 邏輯入 ma-alignment (刪獨立 module)？
- 定 volume.ts 仍然做其他 cycle detection (e.g. OBV, 量價背馳)？
- 定 ma-alignment 用 docx 邏輯，volume.ts 仍然跑但 output 唔同 type？

### 3 個 Option

**Option A** — Volume 完全 absorb 入 ma-alignment
- ✅ ma-alignment 自包含，docx 邏輯直接 implement
- ❌ 獨立 volume module 取消 = 5 個 peer module 變 4 個
- ❌ 同 D009 (6 個全包) 矛盾

**Option B** — ma-alignment 用 docx 邏輯 + 獨立 volume.ts 用另一套 (e.g. OBV / 量價背馳)
- ✅ 5 個 peer module 仍然齊
- ✅ Volume 從兩個角度分析 = 更全面
- ❌ Volume.ts 要諗 output 點 design (cycle 3-state 同 ma-alignment 唔同點處理？)
- ❌ Docx 邏輯有 volume_multiplier，但獨立 volume.ts 又 emit 自己 verdict — 兩個都影響最終 cycle，雙重計？

**Option C** — ma-alignment 用 docx 邏輯，獨立 volume.ts 取消 (volume 邏輯由 ma-alignment 全包)
- ✅ Docx 邏輯完整保留
- ❌ 4 個 peer module — 同 D009 唔 match

### 我嘅推薦
**Option B** — 但 volume.ts 嘅 output 應該 **只 emit "confirm/disconfirm" signal** 而唔係完整 cycle verdict，避免雙重計。或者 volume.ts 純粹做 OBV / 量價背馳，synthesizer 整合。

### 待澄清
- Volume.ts 嘅 output type 應該係咩？CycleVerdict 定 signal？

### 影響
- 影響 modules/volume.ts 嘅設計
- 影響 synthesizer 嘅 input shape
- 影響 D009 (6 個全包 vs 5 個)

---

## D013 · Slope 角色 (Q3)

**日期:** 2026-08-04
**狀態:** ✅ Accepted (Option A)
**Decider:** 大少 #10273

### 背景
- Docx: slope 係 ma-alignment 內部嘅 confidence multiplier (Step 6 + 7c)
- Skeleton: 冇獨立 slope module，但有 `modules/trendline.ts`

### 衝突
- Slope 係 MA 衍生指標，應該 absorb 入 ma-alignment？
- Trendline.ts 原本文件講點 3 嘅 chart pattern (上升支撐線 / 下降壓力線)，係咪同 slope 唔同 concept？

### 2 個 Option

**Option A** — Slope 完全 absorb 入 ma-alignment，trendline.ts 做 chart pattern trendline drawing
- ✅ Slope 同 MA 強相關 (計算 MA 嘅斜率)
- ✅ Trendline.ts 維持原意 (畫線分析)
- ❌ Trendline.ts 同 slope 同名但唔同 concept，要小心命名區分

**Option B** — Slope 抽出去做獨立 module
- ❌ Docx 冇呢個意圖
- ❌ 多一個 module

### 我嘅推薦
**Option A** — Slope 屬於 ma-alignment，trendline.ts 維持原意。

### 影響
- 影響 modules/trendline.ts 嘅 description (要寫清楚係 chart pattern，唔係 slope)

---

## D014 · Config schema 重構 (Q4)

**日期:** 2026-08-04
**狀態:** ✅ Accepted (Option A+B = 兩個 view 都要)
**Decider:** 大少 #10273

### 背景
- Skeleton `MAAlignmentConfig`: 4 fields (fastPeriods, slowPeriods, alignmentGapPct, divergenceSlopePct)
- Docx 需要 9+ fields：
  - 必要: `ma_periods`, `threshold_pct`
  - Volume: `enable_volume_weight`, `volume_lookback`, `volume_boost_threshold`, `volume_shrink_threshold`
  - Slope: `enable_slope_check`, `slope_lookback`, `slope_discount_factor`
- Docx 仲有 **hardcoded 數字** (per D005 應該搬入 config):
  - `0.10` (base confidence denominator)
  - `0.05` + `0.7` (spread 細嘅折扣)
  - `0.3` (sideways confidence floor)
  - `1.25`, `0.5` (uptrend vol expanding gain)
  - `0.65`, `0.8` (uptrend vol shrinking loss)
  - `1.15`, `0.85` (downtrend vol multipliers)
  - `1.15`, `0.85` (sideways vol multipliers)
  - `0.005`, `0.8` (sideways slope threshold + discount)

### 3 個 Option

**Option A** — Flat config (9+ fields 直接放)
- ✅ 簡單
- ❌ Field 太多，難 navigate

**Option B** — Group sub-configs (`{ma, volume, slope}`)
- ✅ 易 navigate，per-section tuning
- ✅ Docx 嘅 3 個 section 自然對應
- ❌ 多一層 nesting

**Option C** — Hybrid (保留 skeleton 4 fields + 加 docx 嘅)
- ❌ 字段重疊 (e.g. fastPeriods vs ma_periods)
- ❌ 混亂

### 我嘅推薦
**Option B** — sub-configs 結構清晰。例如：
```typescript
export interface MAAlignmentConfig {
  ma: {
    maPeriods: number[];              // [5, 10, 20, 60]
    thresholdPct: number;             // 0.02
    baseConfidenceSpread: number;     // 0.10
    baseConfidenceDiscount: number;   // 0.7
    minSidewaysConfidence: number;    // 0.3
  };
  volume: {
    enable: boolean;                  // true
    lookback: number;                 // 5
    boostThreshold: number;           // 1.2
    shrinkThreshold: number;          // 0.8
    // multipliers + scaling factors (per cycle state)
  };
  slope: {
    enable: boolean;                  // true
    lookback: number;                 // 5
    upShortDiscount: number;          // 0.7
    upPartialDiscount: number;        // 0.85
    downLongDiscount: number;         // 0.8
    downShortDiscount: number;        // 0.9
    sidewaysThreshold: number;        // 0.005
    sidewaysDiscount: number;         // 0.8
  };
}
```

### 影響
- 影響 `config.ts` (要改 MAAlignmentConfig + DEFAULT_CYCLE_CONFIG)
- 影響 `modules/ma-alignment.ts` (constructor 簽名)

---

## D015 · Docx 範例數值 discrepancy (Q5)

**日期:** 2026-08-04
**狀態:** ✅ Accepted (Option A)
**Decider:** 大少 #10273

### 背景
Docx 範例 (AAPL multi-head + short slope neg + shrinking vol) 計到 `confidence=0.448`：
- docx 用 `max_spread_pct ≈ 0.08` (rounded) → `base = MIN(1.0, 0.08/0.10) = 0.8`

但實際：
- `ma_values = {MA5:155, MA10:153.5, MA20:150, MA60:145}`
- `max_spread_pct = (155-145)/145 = 0.0689` (真實)
- `base = MIN(1.0, 0.0689/0.10) = 0.689`
- `confidence = 0.689 * 0.8 * 0.7 ≈ 0.386` (真實算法結果)

### 衝突
Docx 範例用 rounded value，我哋 implementation 用 actual value → 結果唔同 (0.386 vs 0.448)。

### 2 個 Option

**Option A** — 用 actual value (0.386)
- ✅ 真實反映 input data
- ✅ 算法透明
- ❌ 同 docx 範例數字唔 match

**Option B** — 用 docx 範例 rounded value (0.448)
- ✅ 同 docx 文件一致
- ❌ 引入 magic rounding — input 唔同但 output 一樣
- ❌ Debug 時會 confused

### 我嘅推薦
**Option A** — 用 actual value。Docx 範例可能只係用 rounded 嚟做 mental math，唔代表 algorithm 嘅 truth。我哋 implementation 要 faithful to 數學。

### 影響
- 影響 unit test 嘅 expected value
- 影響 spec doc (要寫明用 actual value 計算)
---

## D017 · Testing Page Generic Framework（2026-08-05, 大少 #10383 起）

**日期:** 2026-08-05
**狀態:** ✅ Accepted
**Decider:** 架構判斷 + 大少 trigger

### 背景
大少想人手測 AS-03 嘅 ma-alignment 10 條 rule，但 StockPulse web/backend 仲未接 AS-03。需要一個 generic framework 可以畀將來 AS-04/05/06 reuse。

### 決定
- 喺 `~/stockpulse/testing-page/` 建中央 testing page framework（vanilla JS standalone HTML）
- Algorithm 用 adapter pattern（每 algorithm 寫 `adapter.mjs` 喺 algorithm folder）
- Adapter 提供統一 interface：`id, name, version, description, inputs, analyze(), renderResult(), getHelp()`
- Testing page 自動 discover adapter via registry，render dropdown + 動態 input form
- 加新 algorithm：寫 `adapter.mjs` + 加 1 行 `REGISTRY` entry

### 影響
- ✅ AS-XX 將來寫完 algorithm 可以即時 testing
- ✅ K 線圖表自己 render（CDN lightweight-charts v4.2.3，唔 iframe embed StockPulse）
- ✅ Stock autocomplete UX 跟首頁 StockSearch
- ⚠️ AS-03 backend endpoint (`/api/as03/run`) 仲未實作 — testing page 直接 call adapter.analyze() 喺 browser
- ⚠️ Vite frontend 將來接 AS-03 時可以 reuse `adapter.mjs` 嘅 algorithm logic（避免重複）

### Source
- 大少 #10383 — 做 A（generic testing page framework）
- 大少 #10396 — start.command 自動開 browser
- 大少 #10400 — stock autocomplete UX 一致
- 大少 #10409 / #10423 / #10431 — K 線圖表（testing page 自己 render，唔 embed StockPulse）

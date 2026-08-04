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
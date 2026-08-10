# AS-03 · Module Paper Trading Sim (Sprint 2 獨立 page, 大少 2026-08-10 09:33 confirm Option 3 Stream B)

> **Status**: v0.1.0 spec done (大少 2026-08-10 09:56 揀 go, 1 日 design effort)
> **Stage**: Stage 1+ Hybrid Option 3 — Stream B
> **Trigger**: 大少 reject 原本等真實 trade 累積 30+ 樣本嘅 plan (2-3 個月, 投資風險) → 揀 Hybrid 3 條 stream 並行
> **Workflow**: 大少永久 7 步 (spec → code → test → verify → testing page → doc → commit)
> **大少 2026-08-10 09:33 指示**: 不想污染了原本嘅 Code Base, 獨立 page 操控 testing page 模擬人手落實倉位 + mark 啱錯

---

## 1. 點解呢個 module (Why)

Stage 1+ Bayesian tune 需要 30+ 真實 trade samples 觸發 tune 5 個 adaptive params。但大少 reject 等 2-3 個月真實 trade 累積 (投資風險 + 時間長), 揀 Hybrid 3 條 stream 並行。Stream B 係 paper trading sim:

| Stream | 做法 | 累積速度 |
|--------|------|----------|
| A | 即時 derive M9 Pilot baseline | 即時 (HK.00700 81 records 48.1%) — **done 2026-08-10 commit 34969ed8** |
| **B** | **Paper trading sim (本 module)** | **1-2 週 30+ samples (0 投資風險)** |
| C | 大少真實 trade | 2-3 個月, ground truth |

大少原則「不想污染了原本嘅 Code Base」: 本 module 純獨立 page 設計, backend code 0 改動, 純新 wireframe + spec + UX flow。

---

## 2. 範圍 (Scope)

### 2.1 In Scope

- **獨立 HTML page** `/paper-trading-sim.html` (放喺 `testing-page/` 旁邊)
- **4 個 button UI** (落實倉位 / Mark 啱 / Mark 錯 / 重新整理)
- **API endpoint 設計** (0 新加, 純 reuse 6 個 existing trade_journal endpoint)
- **DB schema 設計** (reuse trade_journal 配 `source='paper_trading'`, 唔新加 table)
- **Testing page 整合路徑** (新 entry 喺 dropdown 加 `10 — AS-03-PAPER`)
- **純前端 + 新 spec doc**, backend code 0 改動

### 2.2 Out of Scope (留返 sprint 2 之後)

- 真實 auto-mark 5d/10d/20d 後 auto-update is_correct (留 sprint 3)
- Bayesian tune algorithm 連 paper trade 樣本 (留 sprint 3)
- M12 Risk-Reward integration (留 sprint 4+)
- 修 `clear_all()` 永久 rule (留 sprint 2 side work, 唔屬本 module scope)

---

## 3. UX Flow (Wireframe)

### 3.1 4 個 button 設計

```
┌────────────────────────────────────────────────────────────┐
│ 📋 Paper Trading Sim (Stage 1+ Hybrid Stream B)            │
├────────────────────────────────────────────────────────────┤
│  股票: [HK.00700 ▼]      期間: [1d ▼]      [🔄 重新整理]   │
│                                                             │
│  M8 當前 verdict: BUY (confidence 0.72, state UP)          │
│  訊號時間: 2026-08-10 14:30                                 │
│  訊號價位: $352.40 (M8 verdict 嘅 entry_price)              │
│                                                             │
│  [📝 模擬落實倉位]    → 記入 trade_journal,                  │
│                        source='paper_trading'                │
│                        entry_date=today,                    │
│                        entry_price=$352.40                  │
│                                                             │
│  累計: 5 個 entry (3 BUY, 2 WAIT) | Hit rate: 60% (3/5)    │
│                                                             │
│  ─── 過去 entry (newest first) ───                          │
│  #6  2026-08-08  BUY  $350.10  →  5d 後: $355.20 (+1.5%)   │
│       [✅ Mark 啱] [❌ Mark 錯] (5d/10d/20d 之後先 enable)    │
│  #5  2026-08-05  WAIT  $348.50  →  5d 後: $352.10 (+1.0%)   │
│       [✅ Mark 啱 (WAIT 都 mark)] [❌ Mark 錯]                │
│  ...                                                       │
└────────────────────────────────────────────────────────────┘
```

### 3.2 4 個 button 詳細行為

| Button | 條件 | 動作 |
|--------|------|------|
| **📝 模擬落實倉位** | 必須有 M8 verdict 喺當前 page | INSERT 落 trade_journal, `source='paper_trading'`, `entry_date=today`, `entry_price=current M8 verdict close` |
| **✅ Mark 啱** | entry 已經 ≥ 5 個 trading days old (T+5 之後) | UPDATE trade_journal entry 嘅 `is_correct=1`, `actual_exit_price=current price`, `actual_exit_date=today` |
| **❌ Mark 錯** | entry 已經 ≥ 5 個 trading days old | UPDATE `is_correct=0`, exit_price/date 同上 |
| **🔄 重新整理** | 永遠 enable | 重新 fetch M8 verdict + 重新計算 stats panel |

### 3.3 Stats panel (永遠 full show, 6 個 metrics)

跟 Trade Journal 永久 rule (大少 11:57 永遠全 Show): 即時 `source='paper_trading'` 嘅 6 個 metrics:
- total
- correct_count
- hit_rate
- avg_return_5d
- avg_return_20d
- best_worst_trade

---

## 4. Data Model (Schema Reuse)

**0 新加 table**! 本 module 純 reuse `trade_journal` table, 標記 `source='paper_trading'`:

```sql
-- 已存在 (Stage 1+ Hybrid 2026-08-10 commit 34969ed8)
-- trade_journal.source TEXT NOT NULL DEFAULT 'manual'
--   'manual' = 大少真實 trade
--   'paper_trading' = 本 module (Sprint 2 設計)
--   'm9_pilot_derive' = M9 Pilot baseline (Stream A)

-- 本 module 寫入 query:
INSERT INTO trade_journal (symbol, entry_date, entry_price, source)
VALUES (?, ?, ?, 'paper_trading');
```

**好處**:
- 0 新 schema migration
- 0 新 column
- 純 reuse existing 6 個 endpoint (POST/GET/PUT/DELETE/stats)
- Stage 1+ Bayesian tune 直接 aggregate `WHERE source='paper_trading'`

---

## 5. API Endpoints (0 新加)

**本 module 0 新加 backend endpoint**! 純 reuse 6 個 existing trade_journal endpoint:

| HTTP | Path | 用途 | 本 module 用法 |
|------|------|------|---------------|
| POST | `/api/trade-journal` | 加 entry | 落實倉位 → POST with source='paper_trading' |
| GET | `/api/trade-journal?source=paper_trading` | 列出 entries | 過去 entry 列表 |
| GET | `/api/trade-journal/stats?source=paper_trading` | 6 個 metrics | Stats panel |

**注意**: 現有 GET endpoint 冇 `source` filter 參數, 需要 **sprint 2 minor 改動**:
- `list_entries(symbol=None, source=None, ...)` 加 source param
- 純 1 行改動, backward compat (default None = 全部)

或者 **sprint 2 真係要避免 backend code 改動**, 可以用 client-side filter (fetch 全部, filter 喺前端)。但效率差, sprint 2 impl 階段決定。

---

## 6. Testing Page 整合路徑

### 6.1 新 entry 喺 dropdown

Testing page REGISTRY 加 1 個 entry:
```javascript
{
  id: '10-AS-03-PAPER',
  displayName: '10 — AS-03-PAPER',
  description: 'Paper Trading Sim (Stage 1+ Hybrid Stream B)',
  url: '/paper-trading-sim.html',  // 獨立 page
  enabled: true,
}
```

### 6.2 獨立 page 路徑

- **File**: `testing-page/paper-trading-sim.html` (新 file, 獨立)
- **CSS**: Reuse testing-page.css (0 新加 style)
- **JS**: Inline 喺 HTML `<script>` (新 JS, ~200 lines, 獨立 file)
- **Import**: 從 testing-page/testing-page.js 拎 `__renderStockSelector` + `__formatNumber` 等 helper (sprint 2 抽 function 出 common module)

### 6.3 0 backend code 改動 verify

| 動作 | 影響 backend code? |
|------|-------------------|
| 加 paper-trading-sim.html 新 file | ❌ No |
| 加 inline JS 喺新 page | ❌ No |
| Reuse trade_journal API 6 個 endpoint | ❌ No |
| Source='paper_trading' field | ✅ Already added in commit 34969ed8 (Hybrid Step 1) |
| GET source filter param (可選 sprint 2 minor) | ⚠️ Optional 1 line |

**結論**: Sprint 2 paper trading sim 真實 impl 期間, 可以做到 **0 backend code 改動** (純前端新 page + reuse 6 個 existing API endpoint)。

---

## 7. 永久 Rules (Stage 1+ 應用)

- **永久保留** — paper trade entry 永遠唔刪 (同 trade_journal 永久 rule)
- **`source='paper_trading'` 標記** — 所有 paper trade 必須標記, 方便 Bayesian tune aggregate
- **0 投資風險** — 純 simulation, 唔接觸真實交易 API
- **永遠 full show stats panel** — 跟大少 11:57 永久 rule
- **5d/10d/20d holding period** — 跟 M9 forward return bucket 邏輯 (≤5日 / 5-20日 / >20日)

---

## 8. Spec 落地清單 (Sprint 2 1-3 日 effort)

| Step | Effort | 內容 | Status |
|------|--------|------|--------|
| **1. Spec** | 1 日 | 本 doc | ✅ done 2026-08-10 |
| **2. Code** | 1 日 | paper-trading-sim.html + inline JS (~200 lines) | ⏳ sprint 2 |
| **3. Test** | 0.5 日 | 5 個 pytest 對 `source='paper_trading'` filter (extends test_trade_journal_followup.py) | ⏳ sprint 2 |
| **4. Verify** | 0.5 日 | browser 試 4 個 button + 6 個 metrics chip + 大少 mock 手動操作 | ⏳ sprint 2 |
| **5. Testing page** | 0.5 日 | REGISTRY 加 entry + HTML cache bust 永久 rule | ⏳ sprint 2 |
| **6. Doc** | 0.5 日 | Spec Sync (4 份 spec doc 加 paper trading sim section) | ⏳ sprint 2 |
| **7. Commit** | 0.1 日 | feat + Spec Sync commits + push | ⏳ sprint 2 |
| **Total sprint 2** | **3-4 日** | | |

---

## 9. Sprint 2 工作分解 (預估)

```
Day 1: Step 2 (Code) — paper-trading-sim.html + JS
Day 2: Step 3 (Test) + Step 4 (Verify, partial)
Day 3: Step 4 (Verify, finish) + Step 5 (Testing page) + Step 6 (Doc)
Day 4: Step 7 (Commit + Spec Sync #10)
```

**Sprint 2 期間需要一齊做嘅 side work**:
- 修 `clear_all()` 永久 rule (避免 paper trading 測試期間 hit 同一個 bug)
- 修 EW bug (quick win, 跟 paper trading 同步做)
- 大少 review 本 spec doc 跟 AGENTS.md 7 步流程 spec 階段

---

## 10. Spec 風險 + 注意

| 風險 | 緩解 |
|------|------|
| Paper trade 樣本 overfit 過去 1w K 線 | 標記 `source='paper_trading'`, Stage 1+ Bayesian tune 加 paper trade weight 比真實 trade 低 (e.g. 0.5x) |
| 5d holding period 之後冇新數據 (T-1 rule) | Mark 啱/錯時 `actual_exit_price=current price` (即時 fetch), `actual_exit_date=today` |
| M8 verdict 改變 (calibrate / re-calibrate) | Mark 啱/錯時 snapshot 落 M8 verdict 嘅 finalAction / confidence 落 `notes` field |
| 累積 30+ 樣本需要 1-2 週 | 大少每日落實 2-3 個 paper trade, 1 星期到 14-21 樣本, 2 星期 30+ |

---

## 11. 大少 永久 Rules 應用

- ✅ 大少 11:57 永遠全 Show — Stats panel 永遠 full show 6 個 metrics
- ✅ 大少 23:57 testing page 全部繁體人話 — Button label + metric name 全部繁體
- ✅ 大少 workflow 7 步 per module — spec → code → test → verify → doc → commit
- ✅ 大少「不想污染原本 code base」 — 純前端新 page, backend 0 改動 (除 source field 已經加咗)
- ✅ Spec Sync Protocol — sprint 2 結束 trigger "update stockpulse" 4 步自動跑

---

**大少 2026-08-10 09:33 confirm Option 3 Stream B 設計方向**
**Spec 階段 effort**: 1 日 (本 doc)
**Sprint 2 真正 impl effort**: 3-4 日 (Step 2-7)
**依賴**: source field 永久 rule (commit 34969ed8 done) + trade_journal 6 個 API endpoint (Stage 1+ done 2026-08-09)

# StockPulse · TODO & Backlog

> 所有未做嘅嘢集中喺度，包括算法、infra、文件。
> 排隊用 (P0 = block current work, P1 = next session, P2 = this month, P3 = future)

最後更新: 2026-08-05 (大少 #10347 sync)

---

## 🔬 算法 (AS-XX)

### ✅ P0 · AS-03 Module 1 (ma-alignment) v0.3.0 — DONE (2026-08-04 #10332)
- [x] D011-D015 拍板 (大少 #10273)
- [x] D016 算法替換決定 (大少 #10332)
- [x] types.ts (加 RawCycle — 後來移除)
- [x] config.ts (v0.3.0 — 7 個 fields: dataWindowDays/minDataDays/consecutiveDays/reversalWindowDays/chanceThresholdPct/chanceWindowDays/chanceConfidenceBonus)
- [x] modules/ma-alignment.ts v0.3.0 (10 條 rule A-J + 2 setup steps)
- [x] __tests__/ma-alignment.test.mjs (T1-T11, 19/19 pass, TSC=0)
- [x] docs/research/AS-03-cycle-detection/MODULE-01-MA-ALIGNMENT.md (v0.3.0 spec)
- [x] docs/research/AS-03-cycle-detection/RESEARCH_LOG.md (更新 v0.3.0 entry)
- [x] algorithms/AS-03-cycle-detection/{ARCHITECTURE,README}.md (v0.3.0)

### ✅ P0 · 大少設計 8 主 + 2 補 rule 全部實裝
- [x] Case A 上升勢 (連續 5 日 MA5 > MA60)
- [x] Case B 下跌勢 (連續 5 日 MA5 < MA60)
- [x] Case C 橫行向下 (5 日裡 MA5 > MA60 但當日 low < MA60)
- [x] Case D 橫行向上 (5 日裡 MA5 < MA60 但當日 high > MA60) — 大少 #10317 typo fix
- [x] Case E 末位日優先 (隱含)
- [x] Case F 升勢調整向下 (MA5+MA10 > MA60 但 MA5 < MA10)
- [x] Case G 跌勢調整向上 (MA5+MA10 < MA60 但 MA5 > MA10)
- [x] Case H 7 日反轉 (1/2/3 日新方向 vs 4-7 日舊方向)
- [x] Case I 有機會長升 (連續 5 日 low ≥ MA5 × 0.98)
- [x] Case J 有機會長跌 (連續 5 日 high ≤ MA5 × 1.02)

### 🗑️ 已 Drop (v0.2.0 Kimi 算法, 大少 #10332)
- [x] Drop Step 1 (Kimi 風格) 輸入驗證
- [x] Drop Step 2 (Kimi) 計 [5,10,20,60] 最新值
- [x] Drop Step 3 排序 + 形態判定
- [x] Drop Step 4 黏合檢查
- [x] Drop Step 5 成交量趨勢
- [x] Drop Step 6 斜率動能
- [x] Drop Step 7a-d 信心指數 formula
- [x] Drop magic numbers (0.10/0.05/0.7/0.3 等)

### 🟡 P1 · 量價分析 + 斜率動能 新 Model (大少 #10301)
- [ ] **設計文檔** (詳細做法 docx, 大少準備)
- [ ] **核心概念**：
  - 量價背馳 (price up + volume down = 見頂警號)
  - 量價齊升 (price up + volume up = 確認上升)
  - OBV (On Balance Volume) 動量
  - 短期均線斜率加速/減速
  - 動能轉弱 (momentum weakening) 早期警號
- [ ] **輸入**：同 ma-alignment 一樣，KLine[] (從 backend `/api/kline` cache-aside)
- [ ] **輸出**：CycleVerdict with own verdict (獨立判定 cycle 唔好信 ma-alignment)
- [ ] **用法**：
  - 獨立 peer module，synthesizer 綜合 verdict (同 ma-alignment 平起平坐)
  - Volume verdict 嘅 role：synthesizer 視為「confirm/disconfirm」來源 (D012-B 決定)
  - Slope verdict 嘅 role：synthesizer 視為「accelerate/decelerate」modifier
- [ ] **同 ma-alignment 嘅關係**：
  - ma-alignment 專注做均線 crossover (A-J)
  - 新 module 專注做量價 + 短期動能
  - 兩者 verdict 都交俾 synthesizer 綜合
- [ ] **同 Kimi 原 design 嘅關係**：
  - Kimi Step 5 (volume trend) + Step 6 (slope) 嘅核心概念搬過嚟
  - 但唔做「信心指數 multiplier」(大少 #10301 決定唔做叠 modifier)
  - 改為：每個 modifier 自己 output verdict
- [ ] **預計 trigger 條件**：大少準備詳細做法 docx

### 🟡 P1 · AS-03 Module 2-7 (其他 5 個 peer + 2 orchestrator)
- [ ] **Module 2 (HL Structure)** — ZigZag + Dow Theory + HH/HL/LH/LL
- [ ] **Module 3 (Trendline)** — chart pattern (大少 #10273 D013-A 已定)
- [ ] **Module 4 (Indicators)** — MACD / RSI / Bollinger
- [ ] **Module 5 (Volume OBV)** — 等新 Model 完成
- [ ] **Module 6 (Multi-TF)** — orchestrator/multi-tf.ts skeleton 已就緒
- [ ] **Module 7 (Synthesizer)** — D004 pending strategy (htf-override / weighted-vote / expert-rules)

---

## 🏗️ 基建 (Infrastructure)

### P1 · D004 Synthesizer strategy
- [ ] 揀 1 個 strategy (htf-override / weighted-vote / expert-rules)
- [ ] Implement
- [ ] 驗證 (backtest ground truth — D010 deferred)

### P2 · D007 Per-stock calibration
- [ ] 大少決定要唔要 per-stock config
- [ ] CycleConfig 設計已支援 per-stock 注入

### P3 · Backtest ground truth (D010)
- [ ] 等算法成熟後 design calibration methodology

---

## 📚 Spec 文件更新 (per #9664)

### ✅ P0 · AS-03 v0.3.0 complete sync (大少 #10347 sync)
- [x] MODULE-01-MA-ALIGNMENT.md (v0.3.0 spec)
- [x] RESEARCH_LOG.md (v0.3.0 entry)
- [x] algorithms/AS-03-cycle-detection/{DECISIONS,ARCHITECTURE,README}.md
- [ ] docs/ALGORITHM_SPECS.md (加 AS-03 entry)
- [ ] ARCHITECTURE.md (加 AS-03 algorithm layer)
- [ ] README.md (加 AS-03 mention)
- [ ] PROJECT_SPEC.md (加 AS-03 entry)
- [ ] STOCKPULSE_REFERENCE.md (加 v0.3.0 lessons)
- [ ] memory/Projects/StockPulse/{ALGORITHM_SPECS,PROGRESS,STRATEGY_CONCEPTS}.md

### P2 · Doc freshness check (per #9664)
- [ ] 每週 grep spec doc 嘅 last modified date
- [ ] > 30 日 嘅 doc outbound 提大少 review

---

## 🔧 StockPulse Active Services (LaunchAgent)

| Service | Status | Port |
|---------|--------|------|
| Backend (uvicorn) | ✅ PID 66418 | 18792 |
| Vite dev | ✅ PID 71485 | 3000 |
| Miniapp (Flask) | ✅ PID 51683 | 18793 |
| Logrotate | ✅ scheduled (1800s) | — |
| FutuOpenD | ✅ PID 1206 | 11111 |

---

## ✅ 已解決嘅 Open Questions

- ✅ **AS-03 Issue 1** — Step 7c unreachable if (刪走 / 改預設值 / 照寫) → 已 drop 整個 v0.2.0 (#10332)
- ✅ **最終測試標準** — 大少 confirm 19/19 tests pass (#10332 spec docs sync)
- ✅ **Spec docs update** — 已 start complete sync (#10347)
- ✅ **大少算法** — A-J 10 條 rule 實裝完成

---

**最後更新：** 2026-08-05 00:03 (大少 #10347 complete sync trigger)
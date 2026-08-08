# AS-03 完整 Roadmap + 工作流程 (2026-08-07 規劃)

> **對應 module:** `~/stockpulse/algorithms/AS-03-cycle-detection/`
> **規劃者:** 大少 + MiniMax Code
> **規劃日期:** 2026-08-07
> **預計完成:** 6-8 週去到 Phase 2 complete (Stage 6)
> **大少 指示:** 「按流程做，每次一個 module，詳細測試和改良，再一步步做下去」

---

## 0. 為咩要 Roadmap

### 而家 7 個 modules 嘅盲點
| 而家做到 | 做唔到 |
|---------|--------|
| 走勢方向 (UP/DOWN/SIDEWAYS) | ❌ 預測「之後升嘅機率」 |
| 轉勢訊號 (H rule) | ❌ 比較「過去 vs 當下」邊個時機更好 |
| 形態識別 (頭肩頂/雙底) | ❌ 計算「呢個位置買值唔值」 |
| 量價背馳 | ❌ 學習功能（邊個 signal 啱 / 邊個錯） |

### 大少嘅需求
> 「呢度而家個 system 應該唔夠，我要從新規劃同設計之後要做咩 module，先可以達到我想像嘅目的」

大少想睇：
1. **轉勢判斷**（已部分做到：H rule）
2. **買入最佳時機**（預測「之後向上升嘅機會」）
3. **比較過去 vs 當下**（「一個月前其個位其實更靚」）
4. **學習功能**（做參考學習用）

---

## 1. 7 Stages 排程

| Stage | 做咩 | 時間 | 產出 | 依賴 |
|-------|------|------|------|------|
| **0. Foundation** | 統一 7 個 module 嘅 interface / config / testing contract | 2-3 日 | 7 個 module spec 統一，避免日後改壞其他 | — |
| **1. 完成 Module 3-7** | Multi-TF, Trendline, Indicators, Volume OBV, Synthesizer | 2-3 週 | 7 個 modules 全部 production-ready | Stage 0 |
| **2. 啟動數據收集** | DB schema 加 forward return field, schedule job 計 5/10/20 日後回報 | 1 日 | 由 Day 1 開始儲 trade outcome（Probability 嘅燃料）| Stage 1 任何一個 module done |
| **3. Confluence (Module 8)** | 7 modules 加權 0-100 分 | 1 週 | 綜合視角，信心門檻 tunable | Stage 1 |
| **4. Entry Timing + Backtest Timeline** | Module 9 + 11 一齊做 | 1 週 | 🟢🟡🔴 信號 + 過去比較 timeline | Stage 3 |
| **5. Trade Journal UI** | 大少 mark 啱/錯，存 outcome | 3 日 | 學習機制啟動 | Stage 2 |
| **6. Probability + Risk-Reward** | Module 10 + 12（要 trade data 累積）| 1-2 週 | 「5 日內升嘅機率 = X%」+ R:R ratio | Stage 5, 30+ 樣本 |
| **7. Bayesian Tuning + 個股化** | 30+ 樣本後自動 tune threshold | 持續 | threshold 個股化，長線優化 | Stage 6 |

**總時間估計：6-8 週去到 Phase 2 complete (Stage 6 done)。**

---

## 2. Stage 1 內部排序（最 critical 嘅先做）

> **大少 2026-08-08 10:06 更新:** 6 個 modules 加編號 01-06 喺 dropdown displayName, zmen均算法 唔加 (獨立算法)。  
> **大少 2026-08-08 09:13 更新:** 舊 M1「均線系統週期斷法」改名「zmen均算法」+ 抽離 7 個 modules 獨立處理 (file: `zmen-ma-alignment.ts` + spec: `ZMEN-MA-ALIGNMENT.md`)。新 M1「均線系統週期判斷法 v2.0」跟 docx Kimi v2.0 spec 全新做 (3 cycles + 成交量加權 + 斜率動能), file 佔用返 `ma-alignment.ts` + spec `MODULE-01-MA-ALIGNMENT.md`。  
> **大少 2026-08-08 11:22 更新:** M7 Synthesizer + M8 Decision Engine 合併做 1 個 mega module "終極綜合判斷引擎 v2.0" (testing page 1 個 entry 排 [6], spec 拆 2 份 reference, codebase 1 個 file `modules/decision-engine.ts`)。  
> **大少 2026-08-08 12:02 更新:** Stage 1 收官 spec + doc 同步 — M7+M8 合併 mega module 嘅 spec done (36.6KB, 16 sections, MODULE-07-08-DECISION-ENGINE.md), impl pending 等大少 review + confirm Plan A (Sprint 1: 6 個 modules 加 output fields + M7 impl; Sprint 2: M8 decision tree + trading card).  
> **大少 2026-08-08 12:30 更新:** Sprint 1 收官 (Plan A 確認) — M7 Synthesizer 邏輯 impl done (SSI + TCM + Alignment + 8 個 Grade + Kelly 倉位), 6 個 modules 加 standard verdict interface done, 64 個 tests pass, decisionEngineAdapter + testing page 整合 done (commits `e96f673f` `4b8b64fe` `f991d9db` `2acab95d`). Sprint 2 範圍: M8 finalAction 8 個 + trading card + 5 個 adaptive params runtime auto-calibrate + L2 JSON cache + 10 個 SVG chart.  
> **大少 2026-08-08 13:30 更新:** Plan A 拆返 M7 + M8 兩個獨立 module — 大少澄清「一齊優化」意思係「設計上一起考慮但 implementation 應該分開」, 而家拆返 2 個獨立 module + spec doc. 之前嘅 MODULE-07-08-DECISION-ENGINE.md (合併 spec) 改名做 MODULE-07-SYNTHESIZER.md (M7 spec), 新建 MODULE-08-DECISION-ENGINE.md (M8 spec, 6-7 日 Sprint 2 將加). Testing page REGISTRY 加返 07 — AS-03-SYN 個 entry, 08 改返只係 M8 (sprint 2 將 impl).

| 編號 | Module | 狀態 (2026-08-08 12:02) | 點解先做 |
|------|--------|------|----------|
| ⏸️ Hidden | ~~Module 6: Multi-TF~~ | ⏸️ Hidden 等 Stage 1 done | Entry Timing 嘅基礎 — 但 testing page 唔支援 multi-timeframe, 大少 2026-08-07 23:15 指示 Stage 1 done 先做返 |
| 03 | Module 3: Trendline | ✅ v0.1.0 done (20/20) | 趨勢線畫法對 Entry Timing 嘅 pullback 判斷有幫助 |
| 04 | Module 4: Indicators (MACD/RSI/Bollinger) | ✅ v1.0.0 done (36/36) | Confluence 嘅 building block，技術分析 standard |
| 05 | Module 5: VolumePrice v2.0 (overwrite Volume OBV) | ✅ v2.0.0 done (47/47) | 量能 confirm, 完整 9 個根治 vs v1.0 |
| 06 | Module 6: Volatility (新定義, 取代 Multi-TF) | ✅ v1.0.0 done (32/32) | 波動率收縮擴張, Squeeze + VCP + ATR 分解 |
| 01 | **Module 1: 均線系統週期判斷法 v2.0** (with Volume & Slope) | ✅ **v2.0.0 done (31/31)** | 大少 2026-08-08 09:13 跟 docx Kimi v2.0 spec, 3 cycles + 13 fields + 三階段信心調整 |
| 07 | **Module 7: Synthesizer** (M7 終極綜合判定) | ✅ **Sprint 1 done (大少 2026-08-08 13:30 Plan A 拆返)**: M7 Synthesizer 邏輯 impl (SSI + TCM + Alignment + 8 個 Grade + Kelly) + 64 個 tests + synthesizerAdapter + testing page enable. 獨立 module (M7 唔 chain M8). | M7 spec doc: `MODULE-07-SYNTHESIZER.md`. 6 個 modules 加權 + 5 個 sub-step 邏輯 (純 math, 唔用 AI). |
| 08 | **Module 8: Decision Engine** (M8 終極綜合判斷引擎) | ⏸️ **Sprint 2 pending (大少 2026-08-08 13:30 Plan A 拆返)** | M8 spec doc: `MODULE-08-DECISION-ENGINE.md`. 8 個 finalAction (BUY/ADD/HOLD/REDUCE/SELL/WAIT/TRAP/TRANSITION) 決策樹 + Trading card (entry_zone / stop_loss / take_profit / trailing_stop) + 短期走勢預測 (3 scenarios × 5/10/20 日) + 人話詳細解讀 (LLM hook 預留, 大少 13:30 永久 rule) + 5 個 adaptive params (SSI 戰略層權重 / RSI 情緒權重 / Kelly 倉位分數 / 馬可維茨相關係數 / Hurst 持續反轉 threshold) runtime auto-calibrate + L2 JSON file cache + 10 個 SVG chart. |
| ⭐ 獨立 | **zmen均算法** (舊 M1 抽出, 唔加編號) | ✅ v0.3.0 (19/19) | 大少 2026-08-08 08:47: 舊 M1 改名 + 抽離 7 個 modules, 排去 dropdown 最後, 獨立一類 |

---

## 3. 12 Modules 目標設計

### 而家 7 個 modules (AS-03 既有, 2026-08-08 11:22 合併 M7+M8) — Stage 1 收官
| 編號 | Module | Status (2026-08-08 12:02) | 功用 |
|------|--------|--------|------|
| 01 | **均線系統週期判斷法 v2.0** (with Volume & Slope) | ✅ **v2.0.0 done (31/31)** | 跟 docx Kimi v2.0 spec, 3 cycles (uptrend/downtrend/sideways) + 成交量加權 + 斜率動能, 信心 = base × volume × slope |
| 02 | HL Structure | ✅ v0.1.0 done (12/12) | peaks/troughs + 形態 (頭肩頂/雙底) |
| 03 | Trendline | ✅ v0.1.0 done (20/20) | 10 條 rule A-J, 動態 OLS + 觸線 + 真假突破 |
| 04 | Indicators 動能背馳與衰竭 | ✅ v1.0.0 done (36/36) | RSI + MACD + Bollinger + 背馳 + 衰竭 |
| 05 | VolumePrice 成交量價格行為確認 | ✅ v2.0.0 done (47/47) | 15 rules V1-V15, 9 個根治 vs v1.0 |
| 06 | Volatility 波動率收縮擴張 | ✅ v1.0.0 done (32/32) | 12 rules S1-S12, Squeeze + VCP + ATR 分解 |
| 07 | **Synthesizer (M7)** | ✅ **Sprint 1 done (大少 2026-08-08 13:30 Plan A 拆返)** | 6 個 modules 加權 + SSI 戰略強度指數 + TCM 戰術交叉驗證矩陣 + Alignment 戰略戰術匹配度 + 8 個 Grade (A+~F) + Kelly 倉位 (half/quarter/octo) |
| 08 | **Decision Engine (M8)** | ⏸️ **Sprint 2 pending (大少 2026-08-08 13:30 Plan A 拆返)** | 8 個 finalAction (BUY/ADD/HOLD/REDUCE/SELL/WAIT/TRAP/TRANSITION) 決策樹 + Trading card (entry_zone / stop_loss / take_profit / trailing_stop) + 短期走勢預測 (3 scenarios × 5/10/20 日) + 人話詳細解讀 (LLM hook 預留) + 5 個 adaptive params runtime auto-calibrate + L2 JSON file cache + 10 個 SVG chart |

### 獨立算法 (大少 2026-08-08 抽出, 唔屬 7 個 modules 之一, 唔加編號)
| Module | Status | 功用 |
|--------|--------|------|
| **zmen均算法** (舊 M1 改名) | ✅ v0.3.0 done (19/19) | MA5/10/60 排列 + 10 條 rule A-J — 抽離獨立處理, 排去 dropdown 最後, file 改名 zmen-ma-alignment.ts |

### 隱藏 (Stage 1 done 先做返)
| 編號 | Module | Status | 功用 |
|------|--------|--------|------|
| ⏸️ Hidden | Multi-TF (舊 M5) | ⏸️ Hidden (testing page 唔支援) | 跨時間框架 confirm |
| ⏸️ Hidden | SlopeMomentum (舊 M8) | ⏸️ Hidden | 斜率動能 |

### 新 5 個 modules (Roadmap 加, 2026-08-08 11:22 M7+M8 合併後)
> **改動說明:** 大少 2026-08-08 11:22 指示 M7 Synthesizer + M8 Decision Engine 合併做 1 個 mega module (即上表 編號 08), 所以新 6 個 modules 變新 5 個 (Confluence 由 M7+M8 mega module 包咗, 唔再獨立)。新 5 個從編號 09 開始 (08 已被 mega module 用咗)。

| # | Module | Stage | 功用 |
|---|--------|-------|------|
| 09 | **Entry Timing 買入時機** | 4 | 🟢 強烈買入 / 🟡 等待回調 / 🔴 唔好落 |
| 10 | **Probability Forecaster** | 6 | 「5 日內升嘅機率 = X%」+ 平均升幅 |
| 11 | **Backtest Timeline** | 4 | 過去 90 日 verdict timeline + 最佳時機標註 |
| 12 | **Risk-Reward 風險回報比** | 6 | support/resistance + R:R ratio, R:R<1.5 唔好落 |
| J | **Trade Journal 學習機制** | 5 | 大少 mark 啱/錯, 30+ 樣本後 tune threshold |

**12 Modules 目標設計 (Stage 1 收官版):**
- 8 個 AS-03 模組 (M1-M6 + M7 + M8) — Stage 1 Sprint 1 done (M7 Synthesizer), Sprint 2 pending (M8 Decision Engine, 6-7 日)
- 5 個 new modules (09 Entry / 10 Prob / 11 Backtest / 12 R:R / J Journal) — Stage 2+
- 1 個獨立 zmen均算法 (唔加編號, 排 dropdown 尾)

---

## 4. Workflow 原則（大少指示）

### 「按流程做，每次一個 module，詳細測試和改良」

每個 module 嘅工作流程：

```
1. 📝 寫 spec doc
   - 輸入 / 輸出 / config / algorithm
   - 邊個 pattern (rule-based / statistical / ML)
   - 參考既有 module 嘅格式 (見 MODULE-01, 02, 05, 08)

2. 💻 寫 implementation
   - modules/<name>.ts
   - config.ts 加 defaults
   - 跟 CycleModule interface (見 types.ts)
   - 加 named export 去 adapter.mjs

3. 🧪 寫 tests
   - __tests__/<name>.test.mjs
   - 至少 10 個 test case
   - 覆蓋: data 不足, 正常, 邊界, error cases

4. ✅ Verify
   - node --check syntax
   - import test
   - run all tests (全部 pass 唔可以 break 其他)
   - testing page manual test (見 5.)

5. 🖥️ Testing page update
   - REGISTRY 加 entry (if 獨立 dropdown)
   - adapter 加 renderResult, renderChartOverlay
   - 大少手動試: 跑幾個唔同 stock, 睇 result panel + chart
   - 大少 feedback → 改 spec / algorithm

6. 📚 Update docs
   - algorithms/AS-03-cycle-detection/ARCHITECTURE.md
   - 呢個 ROADMAP.md (status table)
   - HANDOVER.md § 5 Algorithms Status

7. 💾 Commit + push
   - 一個 module 一個 commit (atomic)
   - commit message 格式: feat(as03-moduleX): <description>
```

### 永遠唔好做嘅事
- ❌ 同時做 2 個 module — 唔夠專注
- ❌ 寫 spec 之前就寫 code — 大少會 push back
- ❌ Skip tests — break 咗其他 module 唔知
- ❌ Skip testing page manual test — UI bug 留到 production 先發現
- ❌ 改 config 唔更新 spec — spec 變 stale
- ❌ 一個 mega commit 包幾個 module — 唔好追蹤
- ❌ Auto-implement 唔 confirm — 大少 override 咗永久 confirm rule, **呢個 task 都係**

---

## 5. 關鍵 Dependencies（順序錯就會出事）

| 錯嘅做法 | 後果 |
|---------|------|
| ❌ Confluence 做咗但 3-7 仲 skeleton | Confluence 嘅 verdict 冇意義（垃圾入垃圾出）|
| ❌ Probability 做咗但冇 trade data | 永遠 work 唔到 |
| ❌ Bayesian tune 咗但 30 個樣本都冇 | tune 出嚟都 overfit |
| ❌ Walk-Forward 唔做 | Confluence weights 揀錯, 之後全部 overfit |
| ❌ Trade Journal 唔做 | 永遠唔知邊個 signal 啱, 改唔到 threshold |

---

## 6. 風險 + Mitigation

| 風險 | Mitigation |
|------|------------|
| Module 3-7 開發超 budget | Stage 1 設 hard deadline，唔 critical 嘅（Indicators / Volume OBV）排 Phase 2 |
| Trade data 累積太慢 | 大少先手動 mark 10 個高信心 trade 試 Journal UI |
| Confluence weights 揀錯 | Stage 3 後做 mini walk-forward 自動 tune weight |
| 7 個 module 嘅 verdict 唔夠 predict | 考慮 tune 個別 module 嘅 threshold / 加新 feature |
| LLM 自動做完一個 module 就走去做下一個 | 永遠大少 confirm 先做下一個（永久 confirm rule）|
| Spec drift（code 同 doc 唔對）| 每個 module commit 之前 update spec |

---

## 7. 開始 roadmap 之前要 confirm 嘅 decisions

1. **Module 6 Multi-TF 嘅 timeframe 組合**：用邊幾個 timeframe？default 點配？
   - 建議：1D（主）+ 1W（confirm）+ 1M（大方向）= 3 個
2. **Confluence 嘅 weights**：用「平均」（每個 module 同 weight）定「分層」？
   - 建議：分層 — MA 30% + 形態 25% + 量 25% + 轉勢 20%
3. **Entry Timing 嘅 pullback 邏輯**：用 MA10/MA20 做 dynamic support？定用 fixed percentage？
   - 建議：dynamic support 比較 robust
4. **Walk-Forward 嘅 in-sample:out-of-sample 比例**：12:1 標準？
   - 建議：跟 Pardo 標準 12:1

---

## 8. Status 追蹤 (每次做完一個 module 更新)

| # | Module | Status | 完成日期 | Test |
|---|--------|--------|---------|------|
| 1 | MA Alignment | ✅ v0.3.0 | 2026-08-04 | 19/19 |
| 2 | HL Structure | ✅ v0.1.0 | 2026-08-07 | 12/12 |
| 3 | Trendline | ⏳ Stage 1 | TBD | TBD |
| 4 | Indicators | ⏳ Stage 1 | TBD | TBD |
| 5 | Volume OBV | ⏳ Stage 1 | TBD | TBD |
| 6 | Multi-TF | ⏳ Stage 1 (🥇) | TBD | TBD |
| 7 | Synthesizer | ⏳ Stage 1 | TBD | TBD |
| 8 | Confluence | ⏳ Stage 3 | TBD | TBD |
| 9 | Entry Timing | ⏳ Stage 4 | TBD | TBD |
| 10 | Probability | ⏳ Stage 6 | TBD | TBD |
| 11 | Backtest Timeline | ⏳ Stage 4 | TBD | TBD |
| 12 | Risk-Reward | ⏳ Stage 6 | TBD | TBD |
| J | Trade Journal | ⏳ Stage 5 | TBD | TBD |

---

## 9. 下次接手嘅 checklist

無論係大少 / 我 / OpenClaw 接手開發：

1. ☐ 讀呢個 ROADMAP.md（同 HANDOVER.md, AGENTS.md, ARCHITECTURE.md）
2. ☐ 睇 Git log 最近 commits，知道做緊邊個 stage
3. ☐ 睇 § 8 Status table，知道邊個 module 唔同 status
4. ☐ 揀下一個 status = ⏳ 嘅 module 開始做
5. ☐ 跟 § 4 Workflow 7 個步驟 (spec → code → test → verify → testing page → doc → commit)
6. ☐ 每個 module 一個 commit，message 跟格式
7. ☐ 大少手動試 testing page confirm 後再做下一個
8. ☐ 任何 deviation 都要更新呢個 ROADMAP.md

---

## 10. 參考 Docs

- `~/stockpulse/HANDOVER.md` — Project handover, OpenClaw memory
- `~/stockpulse/AGENTS.md` — Auto-loaded by AI coding tools
- `~/stockpulse/algorithms/AS-03-cycle-detection/ARCHITECTURE.md` — AS-03 架構
- `~/stockpulse/algorithms/AS-03-cycle-detection/README.md` — 入口
- `~/stockpulse/docs/research/AS-03-cycle-detection/MODULE-*.md` — 各 module 詳細 spec
- `~/stockpulse/docs/research/AS-03-cycle-detection/RESEARCH_LOG.md` — Timeline + decisions

---

**最後更新:** 2026-08-07 (Stage 0-7 roadmap 確立)
**維護者:** 大少 + MiniMax Code
**下次 review:** Stage 1 第一個 module done 之後

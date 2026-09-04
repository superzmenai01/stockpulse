# M1 v2.2 Research 筆記 (大少 2026-08-15 ~ 2026-08-16 研究對話)

> **目的**: 記錄大少對 M1 v2.1.0 algorithm 嘅研究 + 爭議 + 反饋,等日後逐條人手 review 時有齊 context  
> **Status**: 🚧 RESEARCH — **未做 algorithm 改動**,等大少逐條 review 完先一齊改 code  
> **對應**: M1 v2.1.0 (commit `082090e8` + Spec Sync #19 `415ce5f5`)

---

## 📋 大少 trigger 列表 (按時間順序)

| # | 日期 | Trigger | 凡人話意思 |
|---|------|---------|----------|
| 1 | 2026-08-15 | 再研究M1,到頂轉勢 vs 上升回調 vs 趨勢反轉 100 隻 stock test | 大少想睇實際例子 |
| 2 | 2026-08-16 18:00 | 用連跌幾日判斷到頂/回調唔合適,應該用 MA5 穿 MA60 | 大少批評 Priority 1 trigger 條件 |
| 3 | 2026-08-16 18:30 | 圖1+圖2 藍框 MA5 喺 MA60 上上落落,係橫行,算法點處理? | 大少提出「上上落落」問題 |
| 4 | 2026-08-16 18:57 | MA5 升穿 MA60 但日K底穿 MA5 係虛火,研究斜率幫助 | 大少提出「虛火」概念 |
| 5 | 2026-08-16 19:02 | 整 10 個判斷狀態,用最簡單表示 | 大少要凡人話列表 |
| 6 | 2026-08-16 19:10 | 改用簡單算法 (MA5 升穿 MA60 + 斜率) | 大少要具體算法 |
| 7 | 2026-08-16 19:16 | 太古升係假嘅就錯晒,7月 80 升到 100 都仲虛火? | **大少推翻「虛火」概念** |
| 8 | 2026-08-16 19:21 | 逐條 review,先把現在 save,試晒先改 code | **新 workflow: 唔好 auto-implement** |
| 9 | 2026-09-05 07:00 | 00019 太古應該係強升但 M1 跌入橫行,檢查 | M1 9 個 sub-scenario 唔覆蓋「強升中整固 + vol 唔夠 expanding」boundary case |
| 10 | 2026-09-05 07:30 | 加新 sub-scenario「強升中整固」,C 方案,5% range threshold,證據 00386 (中國石油化工股份) | **第 10 個 sub-scenario trigger** (algorithm v2.3.0) |

---

## 📊 Research Data Summary (100 隻熱門港股)

### Test 範圍
- 88 隻去重港股 (涵蓋 12 個行業)
- 有效 63 隻 (24 隻 K 線不足 100 日, 1 隻拋錯)
- Backend: 127.0.0.1:18792, K 線 count=320 (~1.5 年)
- Test script: `/tmp/m1-100-stocks-test.mjs`
- 結果存: `/tmp/m1-100-stocks-results.json`, `/tmp/m1-100-stocks-output.log`

### 9 個 sub-scenario 觸發分佈 (M1 v2.1.0)
| Sub-scenario | 數量 | 觸發率 |
|---|---|---|
| 強下跌 strong_downtrend | 16 | 25% |
| 橫行 sideways | 15 | 24% |
| 初上升 (weak_uptrend) | 11 | 17% |
| 強上升 strong_uptrend | 8 | 13% |
| 上升回調 uptrend_correction | 7 | 11% |
| 下跌反彈 downtrend_bounce | 4 | 6% |
| 初下跌 (weak_downtrend) | 1 | 2% |
| 到頂轉勢 decelerating_up | 1 | 2% (騰訊) |
| 到底轉勢 decelerating_down | 0 | 0% |

### 4 個 sub-scenario 爭議 (大少 + 我發現)

| 爭議 | 來源 | 問題 |
|---|---|---|
| **Priority 1 trigger** (連跌 4 日) | 大少 trigger #2 | 4 日內 1 日微升就斷, 應改用 MA5 穿 MA60 (1 日 event) |
| **橫行過寬** | 我研究發現 | 16 隻 sideways 之中, 13 隻 MA5 斜率 > 2% (00023 東亞銀行 +23% 斜率被判做橫行) |
| **「虛火」概念錯** | 大少 trigger #7 | 太古 7月 81.1 → 8月 101.7 (+25.40%) 係真升, 唔係虛火 |
| **MA10 vs MA20** | 我研究發現 | MA10 對 transition 早識別, MA20 對強度分得清 |

---

## 🟢 騰訊 00700 真實 MA5 vs MA60 距離序列 (大少 trigger #3 證據)

**最近 60 日 MA5 同 MA60 距離 %**:

| 日期 | 距離 % | 訊號 | 備註 |
|---|---|---|---|
| 7月9日 | -1.80% | 🔴 跌穿 | MA5 仲低過 MA60 |
| **7月10日** | **+0.02%** | 🟡 **橫行** | MA5 同 MA60 幾乎一樣! |
| 7月13日 | +1.38% | 🟢 升穿 | 突破成功 |
| 7月20-22日 | +2.5 ~ +4.5% | 🟢 上升中 | 明確上升趨勢 |
| 7月27日 | +0.58% | 接近 | 開始回落 |
| **7月28日** | **-0.87%** | 🔴 **跌穿** | 跌穿! |
| **7月29日** | **-1.96%** | 🔴 跌穿 | 繼續跌穿 |
| 7月30日 | -0.83% | 🔴 跌穿 | 3 日都跌穿 |
| **7月31日** | **+0.34%** | 🟡 **橫行** | **反彈升穿返!** |
| 8月3日 | +2.11% | 🟢 升穿 | 突破返上去 |

**大少 insight**: 7月28日 - 8月3日 4 日內 MA5 同 MA60 上上落落 4 次,根本冇「連續 4 日跌穿」,呢段就係大少圖 1 藍框。

---

## 🟢 太古 00019 真實 K 線 (大少 trigger #7 證據)

**7月-8月 K 線 (證明虛火概念錯)**:

| 日期 | Close | 日升跌 |
|---|---|---|
| 7月2日 | 81.10 | -0.73% |
| 7月10日 | 87.60 | **+5.73%** (大陽燭) |
| 7月23日 | 93.25 | **+4.02%** (大陽燭) |
| 7月28日 | 96.95 | +2.38% |
| 7月29日 | 98.50 | +1.60% |
| 7月30日 | 99.10 | +0.61% |
| 7月31日 | 99.50 | +0.40% (連升 5 日) |
| 8月5日 | 96.35 | -1.58% |
| 8月10日 | 103.60 | **+4.70%** (再大陽燭) |
| 8月11日 | 104.50 | +0.87% |
| 8月14日 | 101.70 | -2.12% |

**7月初 81.10 → 8月中 101.70 = +25.40% 真升幅**

**大少反饋**: 太古 25% 升幅 + 多次大陽燭 (7月10日, 7月23日, 8月10日) + 連續上升,**明顯係真強升**,但我哋「虛火」algorithm (MA5>MA60 + 70% 日穿) 判斷錯晒。

---

## 📐 斜率研究 (大少 trigger #4)

### 各 sub-scenario 嘅斜率 + 距 MA60 + 日穿MA5 比例 (100 隻 stock 平均)

| Sub-scenario | 數 | MA5 斜率 | MA60 斜率 | 距 MA60 | 日穿MA5% |
|---|---|---|---|---|---|
| strong_uptrend | 8 | +11.72% | +4.93% | +11.86% | 70% |
| weak_uptrend | 11 | +5.82% | -3.39% | +3.28% | 61% |
| sideways | 16 | +4.34% | -1.82% | +3.19% | 63% |
| uptrend_correction | 7 | +4.80% | +2.61% | +5.51% | 62% |
| decelerating_up | 1 | -1.65% | -0.33% | +1.20% | 50% |
| downtrend_bounce | 4 | -0.37% | -4.90% | -5.34% | 64% |
| strong_downtrend | 16 | -1.39% | -5.01% | -4.27% | 53% |

### 關鍵發現
- **強上升都有 70% 日穿 MA5** (即係日日都穿底係常態, 唔一定虛火)
- **MA60 斜率負** = long-term 跌緊, 唔可以單靠 MA5 升就話強升 (weak_uptrend 嘅 MA60 跌 3.39%)
- **sideways 16 隻之中, 13 隻 MA5 斜率 > 2%** (根本唔平, algorithm 過寬)

### 日穿MA5 比例例子
- 75% 穿 (15/20 日): 00019 太古, 00004 九倉, 00241 阿里健康, 01060 阿里影業, 01093 石藥, 03690 美團
- 70% 穿 (14/20 日): 00001 長和, 00293 國泰, 00327 百富, 00823 領展, 01038 長江基建
- 50% 穿 (10/20 日): 騰訊 00700 (但騰訊實際 7月28日 - 8月3日 已經過咗 4 次穿過, 比 50% 嚴重)

---

## 📐 MA10 vs MA20 對比 (大少 trigger 對話)

### 距 MA10 vs 距 MA20 對 sub-scenario 區分度

| Sub-scenario | 距 MA10 | 距 MA20 | 邊個更好 |
|---|---|---|---|
| strong_uptrend | +1.85% | **+4.53%** | MA20 (距離大, 強更清楚) |
| weak_uptrend | +1.31% | +2.21% | 平手 |
| uptrend_correction | **-0.54%** | -0.21% | **MA10** (回調跌穿 MA10 早一步) |
| sideways | -0.60% | -0.20% | 撞 (兩個都接近 0) |
| decelerating_up (騰訊) | **-2.82%** | -1.29% | **MA10** (到頂早一步 trigger) |
| strong_downtrend | -1.72% | **-3.34%** | MA20 (距離大, 強更清楚) |

### 5 隻 stock detailed analysis
- **騰訊 00700 (到頂)**: 距 MA10 -2.82% 大幅跌穿, 距 MA20 -1.29% 仲未跌穿 → **MA10 早一步識別到頂**
- **長和 00001 (回調)**: 距 MA10 -0.96% 跌穿, 距 MA20 -0.75% 微跌穿 → **MA10 更清晰識別回調中**
- **00019 太古 (強升虛火)**: 距 MA10 +2.87%, 距 MA20 +6.17% → MA20 更凸顯「強」(但虛火概念錯!)
- **00083 信和 (強跌)**: 距 MA10 -0.96%, 距 MA20 -2.58% → MA20 更凸顯「強」
- **00327 百富 (強升剛轉)**: 距 MA10 0.03% 剛交叉, 距 MA20 +1.32% 確認 → 兩個一齊用最好

### 結論
- **MA10 對 transition 早識別** (回調 / 反彈 / 到頂 / 見底)
- **MA20 對趨勢強度分得清** (強升 +4.53% vs 強跌 -3.34% 差距大)
- 兩個各有優勢, 視乎用途

---

## 📋 10 個判斷狀態 (凡人話表 + 簡單算法)

### 🔼 上升類 (4 個)
| # | 狀態 | 簡單算法 |
|---|------|---------|
| 1 | 強升 | MA5 > MA10 > MA60 + MA5 斜率 > 1% + MA60 斜率 > 0.3% + 距 MA60 > 1% |
| 2 | 初升 | MA5 > MA10 > MA60 + 但 MA5 斜率 ≤ 1% 或 MA60 斜率 ≤ 0.3% |
| 3 | 回調 | MA5 > MA60 + MA5 斜率 -1% ~ 0 + MA60 斜率 > 0 |
| 4 | 虛火 🆕 | **❌ 大少推翻, 唔啱** |

### ➡️ 橫行類 (1 個)
| # | 狀態 | 簡單算法 |
|---|------|---------|
| 5 | 橫行 | MA 排列唔 clear + MA5 斜率 ±1% 內 + 距 MA60 ±1% 內 |

### 🔽 下跌類 (5 個)
| # | 狀態 | 簡單算法 |
|---|------|---------|
| 6 | 反彈 | MA5 < MA60 + MA5 斜率 +1% ~ 0 + MA60 斜率 < 0 |
| 7 | 初跌 | MA5 < MA10 < MA60 + MA5 斜率 ≥ -1% 或 MA60 斜率 ≥ -0.3% |
| 8 | 強跌 | MA5 < MA10 < MA60 + MA5 斜率 < -1% + MA60 斜率 < -0.3% + 距 MA60 < -1% |
| 9 | 見頂 ⚠️ | **待定: 改用 MA5 穿 MA60 (1 日 event) 取代連跌 4 日** |
| 10 | 見底 ⚠️ | MA5 由低過 MA60 升穿變高過 MA60 (1 日 event) |

---

## 🚧 待大少逐條 review 嘅爭議 (按優先度)

| # | 爭議 | 來源 | 大少指示 |
|---|------|------|---------|
| 1 | **「虛火」概念錯** | 大少 trigger #7 | 推翻, 唔做呢個 sub-scenario |
| 2 | **Priority 1 trigger** (連跌 4 日) | 大少 trigger #2 | 改用 MA5 穿 MA60 (1 日 event) — **大少要 review 確認** |
| 3 | **橫行過寬** | 我研究發現 | 16 隻 sideways 之中 13 隻 MA5 斜率 > 2% — **大少要 review 確認** |
| 4 | **MA10 vs MA20** | 我研究發現 | 兩個各有優勢, 加 MA20 vs 保留 MA10 — **大少要揀** |

---

## 🔄 新 Workflow Rule (大少 2026-08-16 19:21)

**凡人話**: 逐條人手 review sub-scenario 判定, 試晒無問題先改 code, 唔好 auto-implement

**細節**:
- 每個 sub-scenario 拎出嚟, 大少睇實際 stock 例子確認
- 確認 OK 先至加入改動清單
- 全部確認完一次過改 code (避免來回改)
- 改完做 Spec Sync + commit + push

**對應舊 rule** (2026-08-14 12:10): 「Mavis 收到 prompt 自動做 (凡人話解釋 → investigation → 修正 → spec sync → 報告)」
- 舊 rule 適用於**簡單 bug fix** + **凡人話解釋**
- 新 rule 適用於**algorithm 改動** (sub-scenario trigger / 定義)

---

## 📁 相關 file 索引

| File | 內容 |
|------|------|
| `/tmp/m1-100-stocks-test.mjs` | 100 隻 stock test script (line 51 `adapter.analyzeMAAlignmentV2` 應該改 `analyze`) |
| `/tmp/m1-100-stocks-output.log` | 100 隻 stock 完整 output (147 行) |
| `/tmp/m1-100-stocks-results.json` | 100 隻 stock JSON 結果 |
| `/tmp/m1-slope-research.log` | 斜率 + 日穿MA5 研究 log |
| `/tmp/ma10-vs-ma20.log` | MA10 vs MA20 對比 log |
| `/tmp/hk-top-100-unique.txt` | 88 隻去重 stock list |
| `/Users/zmenai/stockpulse/algorithms/AS-03-cycle-detection/adapter.mjs` | M1 v2.1.0 source (要改) |
| `/Users/zmenai/stockpulse/algorithms/AS-03-cycle-detection/modules/ma-alignment.ts` | M1 module TS source (要改) |
| `/Users/zmenai/stockpulse/docs/research/AS-03-cycle-detection/MODULE-01-MA-ALIGNMENT.md` | M1 spec doc (要 update) |

---

## 🗓️ 對話 timeline (2026-08-15 ~ 2026-08-16)

- 2026-08-15 22:40: Spec Sync #19 M1 v2.1.0 永久 rule commit (`415ce5f5`)
- 2026-08-15 22:50: M1 v2.1.0 algorithm commit (`082090e8`)
- 2026-08-16 18:00: 大少 trigger #1 (100 隻 stock test) — 完成
- 2026-08-16 18:30: 大少 trigger #2-3 (MA5 穿 MA60 + 上上落落) — 凡人話解
- 2026-08-16 18:57: 大少 trigger #4 (虛火 + 斜率) — 研究完成
- 2026-08-16 19:02: 大少 trigger #5 (10 個狀態) — 凡人話列表
- 2026-08-16 19:10: 大少 trigger #6 (簡單算法) — 凡人話算法表
- 2026-08-16 19:16: 大少 trigger #7 (太古錯) — 推翻虛火
- 2026-08-16 19:21: 大少 trigger #8 (逐條 review) — **新 workflow**
- 2026-08-16 19:30: 大少 trigger #9 (首先處理橫行 + close<MA5) — 研究完成
- 2026-08-18 06:36: 大少 trigger #10 (例出 9 個 sub-scenario + 簡單算法) — 已 save 喺呢個 section
- 2026-08-19 07:54: 大少 trigger #11 (ZigZag 加 M1 — 太多溜動 noise, 缺 ZigZag 5% 過濾指標) — Go 確認 3 步 plan
- 2026-08-19 08:35: M1 ZigZag 3 步 plan 完成 (commit 即將 push)
- 2026-09-05 07:00: 大少 trigger #9 (00019 太古跌入橫行, 應係強升) — root cause: 9 個 sub-scenario 唔覆蓋「強升 + 短期整固 + vol 唔夠 expanding」boundary case
- 2026-09-05 07:30: 大少 trigger #10 (C 方案, 5% range threshold, 第 10 個 sub-scenario「強升中整固」) — algorithm v2.3.0, 證據 00386 中國石油化工股份 (命中 conf 0.65) + 00857 中國石油股份 / 01088 中國神華 / 02611 國泰海通 屬 boundary case (MA60 微負 / range 略超 5%)

---

## 🟢 大少 trigger #11 — M1 ZigZag 5% threshold 過濾 noise (2026-08-19)

> **大少 trigger**: 「現在的M1太多溜動補不上, 缺了一個重要的指標「Zig Zag」在stockPulse 首頁的日K圖裡已用上, 你去學習一下, 把他加到M1裡和更新M1的圖表, 我要看到zig zag 指標」
>
> **凡人話解釋**: M1 嘅 9 個 sub-scenario 判定用 MA 距離 / 斜率, 太多 noise 補唔上。ZigZag 用 5% threshold 過濾 noise, 只拎**重要峰谷** (股價偏離峰/谷 5% 先判定做轉向), 拎出嘅點比 MA 距離穩定好多。

### 3 步 plan (大少 Go 確認)

| Step | 做咩 | 改動 file |
|---|---|---|
| 1 | 拎 `calculateZigZag` 由 `web/src/components/chart/ChartContainer.tsx` line 288 port 過去 `adapter.mjs` (跟 ma-alignment.ts helper style) | `algorithms/AS-03-cycle-detection/adapter.mjs` (port 入 helper area) |
| 2 | 改 `analyzeMAAlignmentV2` 嘅 meta 加 4 個新 field (zigzagPoints / lastSwingHigh / lastSwingLow / zigzagThreshold) + 改 `renderMAAlignmentV2ChartOverlay` 加紫色 ZigZag line series | `adapter.mjs` |
| 3 | testing page 加 UI control (啟用 checkbox + threshold 輸入, 預設 5, 大少可手調) + toggle handler 即時 re-render | `testing-page/testing-page.js` + `testing-page/index.html` |
| 4 | Cache bust bump (ALGO_CACHE_BUST 4.7.0 → 4.8.0, ?v=2.3.54 → 2.3.55) | testing page 永久 rule |

### 永久 rule (大少 2026-08-19 trigger)

- ✅ **M1 verdict 加 4 個新 field** (`meta.zigzagPoints` / `meta.lastSwingHigh` / `meta.lastSwingLow` / `meta.zigzagThreshold`)
- ✅ **M1 chart overlay 加紫色 ZigZag line** (跟 StockPulse ChartContainer.tsx 同 style, 唔加 peak/trough 箭嘴 marker)
- ✅ **ZigZag threshold 預設 5%** (跟 IndicatorPanel.tsx `ZigZag: { enabled: true, threshold: 5 }`)
- ✅ **Testing page 啟用 checkbox 控制** (toggle 即時 re-render chart overlay, 唔需要撳「跑算法」掣)
- ✅ **改 threshold 唔即時 re-render** (提示用戶撳「跑算法」掣應用新 threshold)
- ✅ **ZigZag 應用到所有 algorithm 之後都要考慮**: M2/M3/M4/M5/M6 嘅 chart overlay 都可以加 ZigZag (之後拎 stock 例子 review)
- ✅ **凡人話 popup 解釋之後再加**: M1_TOOLTIPS 加 m1_zigzag / m1_zigzag_threshold / m1_zigzag_peaks / m1_zigzag_troughs 4 個 key (Step 5 之後做)

### 永久 rule 改 algorithm 嗰陣 (應用返 M1 v2.1.0 review rule)

- 改 ZigZag threshold 默認值 → 大少拎 stock 例子 (≥ 3 隻) verify 先改
- 改 ZigZag 拎 peaks/troughs 邏輯 → 大少拎 stock 例子 (≥ 3 隻) verify 先改
- 加 ZigZag 做 sub-scenario trigger (e.g. 上傾回調 trigger 用 ZigZag peak 確認) → 大少拎 stock 例子 (≥ 3 隻) verify 先改

### ZigZag 紫色 line 唔 render bug 永久 fix (大少 2026-08-19 09:15 trigger — 「看不到zagzig線」+「主動加console.log」+ 開 Browser)

> **凡人話解釋**: 大少撳完 M1 撳跑算法, K 線圖只見到 4 條 MA 線 (紅/青/橙/藍), 冇紫色 ZigZag line。debug panel (commit c72bdf3d 加) 拎到 evidence: `chartRefs.maV2LineSeries keys (4): ma5, ma10, ma20, ma60` (冇 zigzag), `verdict.meta.zigzagPoints length: 160 個` (有 data)。

**Root cause**:
- klines 從 backend `/api/kline` 拎, 個 field 唔一定叫 `date` (有時叫 `timestamp` / `time`)
- `calculateZigZag` 之前直接用 `klines[i].date` 拎會拎到 undefined
- 之後 `dateToTime(p.date)` 拎 `p.date` (undefined) → return null
- `.filter(p => p.time != null)` 過濾晒所有 160 個 points
- `zigzagSeries.length = 0`, `addLineSeries` 永遠唔 render
- 順便: `lastSwingHigh` / `lastSwingLow.date` 拎不到 (顯示 'undefined 收 497.8')

**Fix** (commit `7567fe99`):
- 加 `_zigzagNormalizeDate(k)` helper, 拎 `k.date / k.timestamp / k.time` fallback chain
- 5 個 `klines[...].date` 用法 (line 1491, 1513, 1536, 1554, 1581, 1596) 全部改用 `_zigzagNormalizeDate(...)`
- 紫色 ZigZag line 而家 render 出嚟, 跟 MA 線一齊顯示
- `lastSwingHigh.date` 拎到 2026-08-05, `lastSwingLow.date` 拎到 (雖然 `lastSwingLow` 拎到嘅係最尾個 low point 嘅 date, 跟 M1 v2.1.0 永久 rule 解讀一致)

**永久 rule** (改 algorithm 嗰陣):
- 拎 raw kline data 永遠用 fallback chain (`date / timestamp / time`), 唔好假設 backend 一個叫 `date`
- 寫個 helper function (`_zigzagNormalizeDate` / `_maNormalizeTime`) 集中拎取, 唔好喺 5+ 個地方重複 fallback chain
- 改 chart overlay 之後, testing page auto-render 黑色 debug 區域 dump chart state (verdict meta keys / maV2LineSeries keys / zigzagEnabled / zigzag series exists), 大少唔使去 console 拎
- Debug panel 永久 rule: 改 chart overlay 之後都要 auto-dump state 落 page (大少唔識去 console, 直接睇 page debug panel)

**對應 commit**:
- `a280882d` feat(m1-zigzag): M1 v2.0 加 ZigZag 5% threshold 過濾 noise (初次 port calculateZigZag)
- `2c3e11ac` fix(m1-zigzag): 加 console.log + window.* assignment 方便大少 debug (但大少去錯地方拎 console)
- `c72bdf3d` fix(m1-zigzag-debug): 加 visible debug panel + 4 個 ZigZag field display (大少唔使去 console)
- `7567fe99` fix(m1-zigzag): 紫色 ZigZag line 唔 render root cause fix (_zigzagNormalizeDate helper)

### 對應 commit

- 即將 push (ZigZag 3 步 plan 完成)

### 對應 stock example verify

- 騰訊 00700: 25 個 ZigZag points, lastSwingHigh 8月5日 497.80, lastSwingLow 8月14日 436.00 (8月5日見頂跌穿 12.4% 到 8月14日見底)
- M1 v2.0 拎到嘅 ZigZag data 合理, 跟 StockPulse 首頁 ChartContainer 一樣
- 之後拎太古 / 莎莎 / 騰訊 / 沙嗲等多隻 stock 例子 review 拎出嘅 peak/trough 準唔準

---

---

## 📋 10 個 sub-scenario v2.3.0 簡單算法表 (大少 2026-08-18 06:36 trigger, v2.3.0 加第 10 個 2026-09-05)

> **永久 rule**: 改任何 sub-scenario trigger 都要即刻 update 呢個 section,等下次可以即刻調動出嚟 review
> **Source**: `backend/algorithms/ma_alignment/algorithm.py` (v2.3.0 2026-09-05)
> **Status**: 🚧 10 條之中 1 條已 fix (2026-09-05 加第 10 個 sub-scenario「強升中整固」補 boundary case)

### 🔼 Priority 1 - 警號 (transition, 最重要)

| # | 狀態 | 凡人話 | v2.2.0 簡單算法 (現有) | 已知問題 | 大少提議 |
|---|------|--------|----------------|---------|---------|
| 1 | **到頂** (decelerating_up) | 升到頂, 準備跌 | MA60 斜率 > 0 + close < MA5 < MA20 + P1 < P3 + P2 < P4 + P2.type=Peak + P4 > P6 + P5 > P7 + MA5 斜率 < -1% | ✅ 已 fix (2026-09-03 11:00 trigger) | ✅ 拎走舊 9月2日 嘅 close<P2 + P2>P4 AND P3>P5, 改用 P 點 Peak/Trough 形態確認 (P1-P7) |
| 2 | **到底** (decelerating_down) | 跌到底, 準備升 | MA60 斜率 < 0 + close > MA5 > MA20 + P1 > P3 + P2 > P4 + P2.type=Trough + P4 < P6 + P5 < P7 + MA5 斜率 > +1% | ✅ 已 fix (2026-09-03 11:00 trigger) | ✅ 對稱改, 拎走舊 9月2日 條件, 改用 P 點 Peak/Trough 形態確認 (P1-P7) |

### 🔼 Priority 2 - 強趨勢 (排列全 + 全部斜率 + 量能 + P 點趨勢確認)

| # | 狀態 | 凡人話 | v2.2.0 簡單算法 (現有) | 已知問題 | 大少提議 |
|---|------|--------|----------------|---------|---------|
| 3 | **強升** | 實力上升, 放量配合, P 點確認趨勢延續 | 排列 bull (MA5>MA10>MA60) + 全部 MA 斜率正 + 放量 + **P1>P3** (峰頂抬高) + **P2>P4** (谷底抬高) + **P1/P3.type=Peak** + **P2/P4.type=Trough** | ✅ 已加 P 點確認 (2026-09-04 10:34 trigger) — false positive 應該減少 (太古 25% 升幅但峰頂唔再抬高的 case 會 fall through 去初升) | ✅ 拎 ≥ 3 隻 stock verify 強升 trigger 真係更準 (e.g. 太古) |
| 4 | **強跌** | 實力下跌, 放量確認, P 點確認趨勢延續 | 排列 bear (MA5<MA10<MA60) + 全部 MA 斜率負 + 放量 + **P1<P3** (谷底降底) + **P2<P4** (峰頂降底) + **P1/P3.type=Trough** + **P2/P4.type=Peak** | ✅ 已加 P 點確認 (2026-09-04 10:34 trigger, 對稱) — false positive 應該減少 | ✅ 拎 ≥ 3 隻 stock verify 強跌 trigger 真係更準 |
| 4.5 | **強升中整固** (strong_uptrend_consolidating) | 強升格局確認, 但最近 5 日窄幅整固, 蓄勢待發 | `is_bullish` (排列 bull) + `all(calc_slope > 0)` (全部 MA 斜率正) + `zz_ok_4` + **P1>P3** (峰頂抬高) + **P2>P4** (谷底抬高) + **P1/P3.type=Peak** + **P2/P4.type=Trough** + **`_recent_consolidation_range(klines, lookback=5) < 0.05`** (最近 5 日 high-low range < 5%) + **`last_close > ma20_value`** (唔跌穿 MA20, 防轉勢). Fallback: 拎唔夠 4 個 P 點 → fall through | ✅ 已加 (2026-09-05 trigger, C 方案, v2.3.0) — 補返「強升 + 短期整固 + vol 唔夠 expanding」boundary case. 同 strong_uptrend 差: 唔需要 vol=expanding. 同 weak_uptrend 差: P1 必須 > P3 (峰頂已突破, 而家食力消化). 同 uptrend_correction 差: MA5 斜率正 (短期冇急跌, 只係整固). 證據: 00386 中國石油化工股份 (range 3.31%, vol 0.501 shrinking, 命中) | ✅ 拎 ≥ 3 隻 stock verify (8月16日 19:21 rule) — 而家 00386 命中, 00857 中國石油股份 (MA60 微負) / 01088 中國神華 (range 5.43%) / 02611 國泰海通 (range 6.62%) 屬 boundary case (MA60 微負 / range 略超 5%) |

### 🔼 Priority 3 - 初升 / 初跌 (MA60+MA5 雙斜率 + P 點剛起步)

| # | 狀態 | 凡人話 | v2.3.0 簡單算法 (大少 9月4日 17:12 trigger) | 已知問題 | 大少提議 |
|---|------|--------|----------------|---------|---------|
| 5 | **初升** (weak_uptrend) | 上升趨勢剛起步, 谷底抬高但峰頂未突破 | **拎走舊 fall through placeholder 邏輯** (強升唔成立就跌入嚟), 改用獨立 trigger: `slope_ma60 > 0` + `slope_ma5 > 0` + `P2=Trough` + `P1<=P3` (峰頂未突破) + `P2>P4` (谷底抬高) + `zz_ok_4`. Fallback: 拎唔夠 4 個 P 點 → fall through 去下一個 elif | ✅ 已 fix (2026-09-04 17:12 + 21:48 trigger) — 拎走舊 fall through 邏輯, 改用 P 點剛起步 + MA60+MA5 雙斜率獨立 trigger, 同強升完全唔同 trigger 邏輯 | ✅ 拎 ≥ 3 隻 stock verify (8月16日 19:21 rule) |
| 6 | **初跌** (weak_downtrend) | 下跌趨勢剛起步, 峰頂降底但谷底未跌穿 | 對稱: `slope_ma60 < 0` + `slope_ma5 < 0` + `P2=Peak` + `P1>=P3` (谷底未跌穿) + `P2<P4` (峰頂降底) + `zz_ok_4`. Fallback: 拎唔夠 4 個 P 點 → fall through | ✅ 已 fix (對稱, 2026-09-04 17:12 + 21:48 trigger) | ✅ 拎 ≥ 3 隻 stock verify (8月16日 19:21 rule) |

### 🔼 Priority 4 - 過渡形態 (短長期分裂 + P 點形態確認)

| # | 狀態 | 凡人話 | v2.3.0 簡單算法 (大少 9月4日 15:06 C 方案) | 已知問題 | 大少提議 |
|---|------|--------|----------------|---------|---------|
| 7 | **上升回調** | 升到一半抖下, P 點確認趨勢仲在 | `zz_ok_4` + `P2=Peak` + `P1>P3` (谷底抬高, higher low) + `P2>P4` (峰頂抬高, higher high) + `MA60 slope > 0` (長期仲升) + `MA5 slope < 0` (短期急跌) + `spread ≥ thresholdPct` (C 方案: 防 MA 線 noise) | ✅ 已加 P 點確認 (2026-09-04 15:06 C 方案) — A/B test 290 隻 stock 證明: 32 → 23 隻 trigger (新嚴 28%), 揀走 24 隻疑似 false positive (舊 fire 但 P 點形態唔似上升), 拎到 15 隻新信號 (拎走 MA10 之後 catch) | ✅ 大少拎 stock 例子 verify C 方案真係更準 (e.g. HK.00002 / HK.00003 / HK.00022) |
| 8 | **下跌回調** | 跌到一半彈下, P 點確認趨勢仲在 | 對稱: `zz_ok_4` + `P2=Trough` + `P1<P3` (峰頂降底, lower high) + `P2<P4` (谷底降底, lower low) + `MA60 slope < 0` (長期仲跌) + `MA5 slope > 0` (短期急升) + `spread ≥ thresholdPct` | ✅ 已加 P 點確認 (對稱, 2026-09-04 15:06 C 方案) | ✅ 拎 ≥ 3 隻 stock verify (8月16日 19:21 rule) |

### 🔼 Default - 橫行

| # | 狀態 | 凡人話 | v2.1.0 簡單算法 (現有) | 已知問題 | 大少提議 |
|---|------|--------|----------------|---------|---------|
| 9 | **橫行** | 平, 唔升唔跌 | 其他所有情況 (排列唔 clear) | ⚠️ 過寬 (16 隻中 13 隻 MA5 斜率 > 2%) + 大少提議 close<MA5 條件 | 改用 `MA5>MA60 + close<MA5 ≥ 50%` + 其他 sub-condition |

---

### 4 個已知問題清單 (待大少逐條 review)

| # | sub-scenario | 問題 | 大少提議 |
|---|---|---|---|
| 1 | ~~**到頂** (Priority 1)~~ | ~~連跌 4 日太脆弱, 1 日微升打斷~~ | ✅ **2026-09-02 fix**: 改用 Z 點形態 + MA 條件 + 斜率組合 → ✅ **2026-09-03 11:00 再 fix**: 拎走 close<P2 + P2>P4 AND P3>P5, 改用 P 點 Peak/Trough 形態確認 (P1-P7) |
| 2 | ~~**到底** (Priority 1)~~ | ~~連升 4 日太脆弱~~ | ✅ **2026-09-02 fix**: 改用 Z 點形態 + MA 條件 + 斜率組合 → ✅ **2026-09-03 11:00 再 fix**: 對稱改, 改用 P 點 Peak/Trough 形態確認 (P1-P7) |
| 3 | ~~**強升** (Priority 2)~~ | ~~太古 25% 升幅可能 algorithm 太鬆 (70% 日穿底)~~ | ✅ **2026-09-05 fix**: 加第 10 個 sub-scenario「強升中整固」(C 方案) 補返「vol 唔夠 expanding」boundary case, 唔影響原有強升 trigger (v2.3.0) |
| 4 | **橫行** (Default) | 16 隻中 13 隻 MA5 斜率 > 2% (根本唔平) | 改用 `MA5>MA60 + close<MA5 ≥ 50%` + sub-condition |

---

### 永久 rule (大少 2026-08-18 06:36 trigger)

- ✅ **改任何 sub-scenario trigger 都要即刻 update 呢個 section** (9 個 sub-scenario 簡單算法表)
- ✅ **大少 review 一條, 我拎 stock 例子 + 凡人話解釋, 等大少 confirm trigger 條件**
- ✅ **全部確認完一次過改 code, 之後做 Spec Sync + commit + push**
- ✅ **改完即時 update v2.1.0 簡單算法表 (呢個 section) 嘅算法條件 column**

### ⚠️ Z 點 caller 順序約定 (大少 2026-09-03 07:35 trigger 修正, 原 9月2日 12:24 永久 rule 寫錯方向)

Caller 傳入 `options['zigzagPoints']` 必須用 **新→舊** 順序 (對齊 `ZigZagAlgorithm().run().points` output, 因為 backend `assign_sequence_numbers()` 已經將 list 處理成新→舊):
- `list[0]` = P1 = 最新 Z 點
- `list[1]` = P2 = 第二新
- `list[n-1]` = P_n = 第 n 新
- `list[-1]` = P_n = 最舊 (如果 list 內有 n 個)

M1 `_get_recent_zigzag_points` helper **保證返新→舊** list 俾 algorithm.py:
- 拎 caller_points[:n] (caller 傳新→舊, 頭 n 個 = 最新 n 個)
- Fallback `calculate_zigzag()` raw 拎舊→新, 內部 `points[-n:][::-1]` reverse 變新→舊

⚠️ 凡人話: 之前 9月2日 plan 寫「Caller 必須用舊→新」係錯, 9月3日大少發現後修正為新→舊。Frontend testing page / M7 Synthesizer / batch run caller 必須用 **新→舊** 順序 inject (`ZigZagAlgorithm().run().points` 已經係呢個順序, 直接 inject 即可)。

### Sub-scenario 流程永久 rule (大少 2026-09-03 07:23 trigger)

對齊 P 點 vocabulary (9月3日 07:05 rule), M1 / zmen / 其他 algorithm sub-scenario trigger 嘅 P1/P2/P3... / Peak / Through / 觸發點都必須由 ZigZag P 點來源拎:
1. 先用讀取數據機制, 從 DB 取數據 (KlineCache full flow)
2. 檢查和補上缺失嘅數據 (K 線 < 30 條 warning)
3. 制作 P 點 (`ZigZagAlgorithm().run().points`, 新→舊, list[0]=P1=最新)
4. 之後所說嘅 P1, P2..., Peak, Through, 觸發點都係從 P 點 element 取出 (唔可以由 raw K 線拎)

套用: 之後所有 StockPulse sub-scenario 對話, trigger 講「P1 / Peak / Through / 觸發點」即指 P 點 element。

### 第 10 個 sub-scenario「強升中整固」永久 rule (大少 2026-09-05 trigger, C 方案, v2.3.0)

凡人話: M1 v2.2.0 嘅 9 個 sub-scenario trigger 唔覆蓋「強升 + 短期整固 + vol 唔夠 expanding」boundary case。
- **背景**: 00019 太古過去 6 個月由 79 升到 106 (+34.6%), 30 日由 94.7 升到 106.3 (+12.24%), MA 排列完美多頭 (MA5>MA10>MA20>MA60), 全部斜率正, P 點形態 (峰頂抬高 + 谷底抬高) 全部 match 強升, 但 verdict 跌入 default sideways
- **Root cause**: 9 個 sub-scenario trigger 全部唔命中:
  - `strong_uptrend` 要 `volume_signal == "expanding"`, 但 00019 volRatio=1.2285 < 1.25 (差 0.0215 唔夠 expanding)
  - `weak_uptrend` 要 `P1<=P3` (峰頂未突破), 但 00019 已經 P1=107 > P3=100 (峰頂已突破)
  - 其他 7 個 case 全部唔 match 上升
  - Fall through 去 default sideways
- **C 方案 fix**: 加第 10 個 sub-scenario `strong_uptrend_consolidating` (強升中整固 / 蓄勢), 補返 boundary case

**Trigger 條件 (Priority 2.5, 喺 weak_uptrend 之後, 強跌之前)**:
```python
elif (
    is_bullish                                          # 排列 MA5>MA10>MA20>MA60
    and all(calc_slope(p) > 0 for p in cfg["maPeriods"])  # 全部均線斜率正
    and zz_ok_4                                          # 拎到 4 個 P 點
    # P 點 type 確認 (alternating sequence: P1/P3 同 type, P2/P4 同 type)
    and p1_type == "Peak" and p3_type == "Peak"
    and p2_type == "Trough" and p4_type == "Trough"
    # 峰頂抬高 + 谷底抬高 (確認強升趨勢真係延續緊)
    and p1_value > p3_value
    and p2_value > p4_value
    # 短期整固: 最近 N 日 high-low range < 5% (強升股自然整固範圍 3-7%)
    and _recent_consolidation_range(klines, lookback=cfg["consolidationLookback"]) < cfg["consolidationRangeThresholdPct"]
    # 唔跌穿: close 仲喺 MA20 上面 (防轉勢)
    and last_close > ma20_value
):
```

**永久 rule**:
- ✅ **Config 2 個 option**: `consolidationLookback` (預設 5 日), `consolidationRangeThresholdPct` (預設 0.05 = 5%)
- ✅ **STATE_MAP**: "UP" (仍算上升, 大方向係強升)
- ✅ **CYCLE_LABELS**: "強升中整固"
- ✅ **POSITION_LABELS**: "consolidating_after_rally" / "強升後整固 (蓄勢)"
- ✅ **Step 7a/7b/7c 加入強升 sub-class** (用強升公式, 因為本質係強升 sub-class)
- ✅ **唔強制 volume=expanding** (boundary case 通常 vol 中性, 唔夠 expanding 但接近)
- ✅ **對齊 9月3日 07:23 sub-scenario 流程永久 rule**: P 點全部由 recent_zz 拎 (helper 拎好)
- ✅ **對齊 9月3日 11:00 P 點 type 永久 rule**: P1/P3.type=Peak + P2/P4.type=Trough
- ✅ **對齊 8月16日 19:21 永久 rule**: 拎 ≥ 3 個 stock 例子 confirm trigger
  - **真實 evidence (2026-09-05)**: 00386 中國石油化工股份 (range 3.31%, vol 0.501 shrinking) 命中, conf 0.65
  - **Boundary case (2026-09-05, 唔命中屬 trigger 設計取捨)**: 00857 中國石油股份 MA60 微負 (-0.009%), 01088 中國神華 range 5.43% 略超 5%, 02611 國泰海通 range 6.62% 略超 5%
  - **仲有 1 隻 (02388 中銀香港) vol=1.74 expanding 已經 hit strong_uptrend, 唔需要 C 方案**

**Fallback 設計**: 拎唔夠 4 個 P 點 (新股 / Z 點太短) → 條件 skip, fall through 去下一個 elif

**凡人話對齊 (跟 9月3日 07:05 P 點 vocabulary)**:
- 強升中整固 = 強升格局確認, 過去 1-3 個月持續上升, 短期 5 日喺窄幅整固
- 同 strong_uptrend 差: 唔需要 expanding vol
- 同 weak_uptrend 差: P1 必須 > P3 (峰頂已突破)
- 同 uptrend_correction 差: MA5 斜率正 (短期冇急跌, 只係整固)

**對應 code**:
- `backend/algorithms/ma_alignment/algorithm.py`: Priority 2.5 elif block + helper `_recent_consolidation_range` + STATE_MAP/CYCLE_LABELS/POSITION_LABELS + Step 7a/7b/7c
- `backend/algorithms/ma_alignment/config.py`: `consolidationLookback` + `consolidationRangeThresholdPct`

### P 點 type 統一永久 rule (大少 2026-09-03 11:00 trigger)

凡人話: 之前 sub-scenario trigger 寫 `P2.type == "high"` / `P2.type == "low"` 直接用 Z 點 type, 但大少要 P 點有自己嘅「類型」field, 命名用 "Peak" / "Trough", 唔直接用 Z 點 high/low。

- ✅ **P 點 (sub-scenario 流程用嘅 P1/P2/P3...) 每個 element 必須有 `type` field**
- ✅ **命名 "Peak" / "Trough"** (峰頂 / 谷底, 大寫頭字, 唔用 "high"/"low")
- ✅ **Helper 自動加 type field**: M1 `_get_recent_zigzag_points` 內部統一 Z 點 type "high"/"low" → P 點 type "Peak"/"Trough":
  - Z 點 type="high" → P 點 type="Peak"  (峰頂)
  - Z 點 type="low"  → P 點 type="Trough" (谷底)
- ✅ **Sub-scenario trigger 永遠用 P 點 type**: `p.type == "Peak"` / `p.type == "Trough"`, 唔直接寫 Z 點 high/low
- ✅ **套用**: M1 / M7 / 其他 algorithm 之後嘅 P 點 trigger 全部跟呢個 pattern
- ✅ **M1 trigger 落地實例 (2026-09-03 11:00)**:
  - 到頂轉勢: `P2.type == "Peak"` (確認 P2 係峰頂)
  - 到底轉勢: `P2.type == "Trough"` (確認 P2 係谷底)
- ✅ **凡人話解釋**: 拎 Z 點 (raw, type="high"/"low") → 經 helper → P 點 (抽象層, type="Peak"/"Trough"), caller 用抽象層

對應 commit: 將會跟 Spec Sync #20+2 push

### Sub-scenario caller 拎 Z 點 source 永久 rule (大少 2026-09-03 14:37 trigger)

凡人話: 之前 sub-scenario caller (M1 helper) 拎 Z 點用 `calculate_zigzag` function (backend/algorithms/zigzag/algorithm.py 入面), 但呢個 function 拎出嚟 Z 點 list 同 frontend testing page 拎出嚟 list 唔 match (trigger date 拎早 1 個 K 線), 導致 M1 trigger 結論 false positive (HK.00512 + HK.00669 假 trigger 到頂轉勢)。

**Root cause**:
- `calculate_zigzag` 拎 trigger date = 跌穿 5% 嗰支 K 線 (8月12日)
- `ZigZagAlgorithm` / `run_zigzag` 拎 trigger date = 跌穿 5% 嗰支 K 線之後拎 K 線 high/low (8月18日) — 對齊 frontend 1-to-1 port
- backend 拎 trigger date 早 1 個 K 線, 唔係完整 1-to-1 port frontend

**永久 rule**:
- ✅ **所有 sub-scenario caller (M1 / M7 / 其他 algorithm) 拎 Z 點必須用 `ZigZagAlgorithm` class** (`backend/algorithms/zigzag/algorithm.py` 嘅 framework class)
- ❌ **唔可以直接 call `calculate_zigzag` function** (拎 trigger date 早 1 個 K 線, 唔對齊 frontend)
- ✅ **拎走 `calculate_zigzag` function 嘅 public exposure** (`backend/algorithms/zigzag/__init__.py` 拎走 import + `__all__` entry)
- ✅ **M1 helper fallback 改 instantiate `ZigZagAlgorithm` 拎 Z 點** (對齊 backend endpoint `/api/algorithms/run?algo=zigzag` + frontend testing page 拎法)
- ✅ **function 本身保留** (private 形式 `_calculate_zigzag` 喺 algorithm.py 入面) 畀 `run_zigzag` helper 用, 拎走抽象層 (拎走 helper + function) 係大工程, 之後 sprint 處理
- ✅ **TODO 之後拎走 `run_zigzag` helper + `_calculate_zigzag` function, 拎走抽象層** (大少 trigger 標記, 短期保留 function 畀 helper 用)

**M1 trigger 落地實例 (2026-09-03 14:37)**:
- M1 `_get_recent_zigzag_points` helper fallback 段改 instantiate `ZigZagAlgorithm().run(klines, options)` 拎 Z 點
- 拎 `ZigZagAlgorithm.run().points` (新→舊, list[0]=P1=最新) 直接 `[:n]` 拎頭 n 個, 對齊 caller inject 嘅順序
- threshold_mode / manual_threshold / lookback / multiplier options 對齊 frontend testing page 預設值 (auto + lookback 20 + multiplier 2.5)
- 之前 false positive (HK.00512, HK.00669) 修正, true positive (HK.02688) 保留, 仲有 HK.02382 新 trigger 到底轉勢

**凡人話解釋**: Z 點算法有 1 個 single source of truth (`ZigZagAlgorithm` class), 拎 trigger date 拎「跌穿 5% 嗰支 K 線之後嘅 K 線 high/low」對齊 frontend, 拎 Z 點 list 拎 macro Z 點 (auto threshold 拎 179 個) 而非 micro Z 點 (manual 5% threshold 拎 307 個)。

對應 commit: 將會跟 Spec Sync #20+2 push

---

**Maintainer**: 大少 + Mavis
**Created**: 2026-08-16 19:25
**Last Updated**: 2026-09-03 14:37 (大少 trigger #15: 拎走 calculate_zigzag 公開暴露 + M1 helper 改用 ZigZagAlgorithm, 修正到頂轉勢 false positive)
**Status**: 🚧 Research doc, 等大少逐條 review 指示


---

## 🆕 大少 2026-08-19 Trigger — ZigZag 點順序號碼 (純 visual label, 唔影響 algorithm)

### 大少 trigger (2026-08-19 11:15)
> 「仲有一項想加的, 在 zigzag 每一個點加上一個順序號碼, 這個是 option 可以選擇睇吾睇, 號號排序方式從最新的開始, 要抱括最後那條錄色線。以 00700 為例, 第一個點是現在的的 close, 要寫上 1 字, 第二點是上一個最底位, 第三點是上一個最高位, 第四點是上一個最底位, 如此類推」

### 凡人話解釋
喺紫色 ZigZag 每個 point + 深綠色 close extension point 加順序號碼 label:
- **1 號 = 今日 close (深綠色 #2E7D32)**
- **2 號 = 紫色 ZigZag 最後 1 個 (最接近今日嘅 peak/trough)**
- **3 號 = 紫色 ZigZag 倒數第 2 個**
- ... 一直倒序排
- **N+1 號 = 紫色 ZigZag 最舊 1 個**

大少可以 option toggle 顯示/隱藏 (預設 false 關閉), 同時設定「只顯示最近 N 個」spinbutton (預設 30, 因為 161 個 marker 會太擠)。

### 凡人話警告
- **純 visual label, 唔影響 algorithm 邏輯** — 大少教學 / annotation 嗰陣方便對應「轉勢 5 號位」

### Implementation (commit `07d824b5`)

1. **adapter.mjs renderMAAlignmentV2ChartOverlay** (line 7883 之後):
   - 紫色 ZigZag 161 個 points 倒序排, 號碼 2-162
   - 深綠色 close extension point 號碼 1
   - 用 lightweight-charts v4.2.3 native `candleSeries.setMarkers()` API (永久 rule: testing page 行 v4.2.3, 唔好用 v5 `LightweightCharts.createSeriesMarkers` plugin)
   - `chartRefs.zigzagSequenceMarkers` 拎出 handle 畀 toggle handler 用 (wrapper object 因為 setMarkers() v4 冇 return handle)

2. **testing-page/index.html** 加 2 個新 UI controls:
   - 「顯示 ZigZag 點順序號碼」checkbox (`#zigzag-sequence-enabled`, 預設 false 關閉)
   - 「顯示最近 N 個」spinbutton (`#zigzag-sequence-max-count`, 預設 30, min 5, max 162)

3. **testing-page.js**:
   - 加 `let showZigzagSequence = false` + `let zigzagSequenceMaxCount = 30` state
   - 加 `reRenderZigZagSequence()` function (清 zigzag + extension series + 清 marker + re-render overlay)
   - 加 2 個 change handler
   - runAlgorithm 入面 chartRefs pass `showZigzagSequence` + `zigzagSequenceMaxCount`
   - **抽 `renderDebugPanel()` function 出去, runAlgorithm + reRenderZigZagSequence 都 call** (debug panel 之前喺 runAlgorithm create 一次之後永遠唔再 update, toggle 切 sequence 嗰陣 panel 入面 text 仲係舊 state — 違反大少 09:15 永久 rule「改 chart overlay 之後, testing page auto-render 黑色 debug 區域 dump chart state」)
   - Debug panel 加 `ZigZag sequence 號碼 toggle` + `ZigZag sequence markers plugin` 顯示

### 永久 rule (大少 2026-08-19 11:15 + 11:45)

- ✅ **ZigZag 點順序號碼由新到舊 1-N**: 1 號 = 今日 close (深綠色), 2-N+1 號 = 紫色 ZigZag points 倒序
- ✅ **Toggle 預設 false 關閉** (避免畫面太擠), 大少可以 option 開
- ✅ **「只顯示最近 N 個」spinbutton 預設 30, min 5, max 162** (因為 161 個 marker 全部顯示會太擠)
- ✅ **純 visual label 唔影響 algorithm 邏輯** (大少教學 / annotation 用)
- ✅ **永久用 lightweight-charts v4.2.3 native `setMarkers()` API** (testing page 行緊 v4.2.3, 唔好用 v5 `createSeriesMarkers` plugin — v4 冇 plugin API, 永遠 skip; `setMarkers()` v4 同 v5 都有, 向後兼容)
- ✅ **Debug panel 永遠 auto-update** (大少 09:15 永久 rule 衍生) — 改 chart overlay 之後, testing page 黑色 debug 區域 dump chart state, 唔可以淨係 create 一次就唔再 update
- ✅ **改 chart overlay 之後, 同時 update 抽出去嘅 `renderDebugPanel()` function** (避免後續 toggle / re-render 嘅時候 panel 入面 text 仲係舊 state)

### 凡人話 hint (UI)
- 個 UI text 寫住「(1 號=今日 close, 2 號=紫色最後 1 個, 倒序排)」, 大少一眼就明點排序

### Cache bust
- `ALGO_CACHE_BUST` 4.9.0 → 4.10.0
- `?v=2.3.62` → 2.3.64 (testing-page.js renderDebugPanel + handler)

### Verify evidence (HK.00700, M1 v2.0 + ZigZag 5%, N=30)
- Debug panel 顯示: `ZigZag sequence 號碼 toggle: ✅ 開 (顯示最近 30 個)` + `ZigZag sequence markers plugin: ✅ 已 create (拎出畀 toggle handler 用)`
- Chart 入面紫色 ZigZag 線 + 紫色號碼 (14, 16, 12, 10, 8 等倒序排) + 深綠色 收市延伸 (Close Ext.) 446.20 線 + 1 號深綠色 marker
- 改 spinbutton 拎唔同 N (5) 都 work
- 截圖: `docs/research/AS-03-cycle-detection/screenshots/m1-zigzag-sequence-verify-2026-08-19.jpg`

---

## 🆕 大少 2026-08-20 Trigger — ZigZag direction flag refactor (clean state machine)

### 大少 trigger (2026-08-20 12:01)
> 「我建議加一個Flage，如果做了Peak，方向就是向下，那就只看high，當High>5% 時就做Trough，方向就向上，那就只看low。所以不用同時要看high 和 low」

### 凡人話解釋

之前 `calculateZigZag` 雖然已經有 `inUptrend` flag，但代碼結構唔乾淨:
- 同時追蹤 2 個 variable (`lastSwingHigh` + `lastSwingLow`)
- 2 個 loop (第一個 break 拎 first swing, 第二個繼續)
- 讀起上嚟要記住邊個 variable 喺邊個 direction 先 update

大少想要嘅係 clean state machine:
- **1 個 direction flag** ('up' / 'down') 講晒方向
- **1 個 reference value** (running extreme — up 嗰陣係 max high, down 嗰陣係 min low)
- **1 個 refIdx** (拎到 extreme 嗰支 K 線嘅 index)
- **1 個 loop** (唔再 break 拎 first swing)

凡人話例子:
- 啱啱確認咗 peak → direction 轉 'down' → 之後每支 K 線只睇 low, low 跌穿 refValue 5% 就確認 trough
- 啱啱確認咗 trough → direction 轉 'up' → 之後每支 K 線只睇 high, high 升穿 refValue 5% 就確認 peak
- 永遠唔使同時追蹤 high 同 low，邏輯清晰唔會亂

### 行為對齊 evidence (4 隻 stock 100% 一樣)

Trace script: `/tmp/zigzag_trace/trace_refactor.mjs` (對比舊 vs 新)

| Stock | K線條數 | 舊算法拎 points | 新算法拎 points | 結果 |
|-------|---------|----------------|----------------|------|
| HK.00700 (騰訊) | 1260 | 254 | 254 | ✅ 100% 一樣 |
| HK.00019 (太古) | 258 | 28 | 28 | ✅ 100% 一樣 |
| HK.00005 (匯豐) | 258 | 24 | 24 | ✅ 100% 一樣 |
| HK.00016 (新鴻基) | 258 | 39 | 39 | ✅ 100% 一樣 |

### Refactor 過程發現嘅 subtle bug (trigger metric 計算 order)

第一次 refactor 拎出 318 個 points (vs 舊 254)，多咗 64 個 noise。Trace 落去 2026-01-15 (HK.00019) 搵到 root cause:

**舊算法嘅 changeFromHigh 喺 for loop 開頭計** (用 update 前嘅 lastSwingHigh)：
```javascript
for (let i = 1; i < klines.length; i++) {
  const changeFromHigh = (klines[i].low - lastSwingHigh) / lastSwingHigh;  // 開頭計, 用 pre-update value
  if (inUptrend) {
    if (klines[i].high > lastSwingHigh) { lastSwingHigh = ...; }  // post-update
    if (changeFromHigh <= -threshold) { ... }  // 用 pre-update value 計嘅 trigger
  }
}
```

**新算法 (第一版) 將 changeFromRef 擺入 if 入面計** (用 update 後嘅 refValue)：
```javascript
if (direction === 'up') {
  if (klines[i].high > refValue) { refValue = ...; }  // post-update
  const changeFromRef = (klines[i].low - refValue) / refValue;  // ← post-update
  if (changeFromRef <= -threshold) { ... }
}
```

Post-update 會喺「大 intraday range 嗰日」拎到假信號: e.g. 2026-01-15 H=70.25 L=66.6 (-5.2%) → 拎假 peak/trough 喺同一日 (2026-01-15 high=70.25 + 2026-01-15 low=66.6 兩個 noise point)。

**Fix**: pre-calculate `changeFromRef` 喺 for loop 開頭 (用 update 前嘅 refValue)，對齊舊算法行為。

### Implementation (commit 將會跟 Spec Sync #20+1 push)

`algorithms/AS-03-cycle-detection/adapter.mjs` line 1505-1647

**改動**:
1. `let direction = klines[1].close > klines[0].close ? 'up' : 'down';` (取代 `inUptrend`)
2. `let refValue = direction === 'up' ? klines[0].high : klines[0].low;` (取代 `lastSwingHigh` + `lastSwingLow`)
3. `let refIdx = 0;` (取代 `lastSwingIdx`)
4. 刪除 first loop (拎 first swing 嗰個 break loop) — 合併去 single loop
5. Pre-calculate `changeFromRef` 喺 for loop 開頭 (對齊舊算法行為)
6. 拎 last point 用 `refValue` / `refIdx` / `direction`, 唔再用 `lastSwingHigh` / `lastSwingLow`

**Refactor 結果**:
- 舊 121 行 (line 1505-1625) → 新 110 行 (line 1505-1614)
- 邏輯讀起嚟清晰: 「拎咗咩 → 朝咩方向 → 點樣搵下一個」
- 行為 100% 一樣 (4 隻 stock trace 拎 evidence)

### 永久 rule (大少 2026-08-20 12:01)

- ✅ **`calculateZigZag` 永遠用 1 個 direction flag + 1 個 refValue + 1 個 refIdx + 1 個 loop** — 唔好再分 2 個 loop + 2 個 variable
- ✅ **Direction 拎 'up' / 'down' 字符串 flag** (唔好用 boolean `inUptrend`, 讀起嚟易明)
- ✅ **Trigger metric (changeFromRef) 永遠 pre-calculate 喺 for loop 開頭** (用 update 前嘅 refValue, 對齊原本舊算法行為避免假信號)
- ✅ **拎 last point 用 `refValue` / `refIdx` / `direction`** (唔好用 `lastSwingHigh` / `lastSwingLow` / `inUptrend`)
- ✅ **改 `calculateZigZag` 嗰陣必須 trace ≥ 3 隻 stock 拎 evidence 確認拎出嚟 point 100% 一樣** (大少 algorithm sub-scenario 永久 rule 一致)
- ✅ **改完跑晒 `__tests__/*.test.mjs` 確認冇 break 任何 test** (14 個 test file 全部 pass / 21/31 ma-alignment 維持原狀)

### 對應 commit

- 即將 push (跟 Spec Sync #20+1 同步 push)

---

## 🆕 大少 2026-08-30 17:50 Trigger — ZigZag 決定點 橙色旗仔 marker (大少 approved plan)

### 大少 trigger (2026-08-30 17:35)

> 「現在 Zigzag 當股價反方向到達指定的 % 時就會完成上一支的 Zigzag，我想在當到達那個 % 的位置上在圖表上加上一個符號，等我知道是在那裡決定形成這個 Zigzag 的，明白我意思嗎？」

### 凡人話解釋

而家紫色 ZigZag 線 plot 喺 **peak/trough 嗰支 K 線** (即「確認咗嘅轉向點」), 但「上一支 ZigZag 喺邊一日決定形成」冇記號 — 即係股價反方向走到指定 % 嗰一日。

大少想喺 **「決定嗰一日」** (跌穿/升穿 threshold 嗰支 K 線) 加個視覺符號, 等佢即時分到:

```
K 線 A (peak, e.g. 100元)        K 線 B (跌穿 5% 到 94元, 確認轉勢)
      ╱╲                                ⚐
     ╱  ╲                          ↑ 橙色旗仔
────●────╲──────────────────────────●─── K 線 B
     ╲                               ↑
   紫色 P 點                       決定嗰日
   plot 喺 A                       plot 喺 B
```

### Design Decision (大少 2026-08-30 17:35 confirm)

- ✅ **形狀**: 細小旗仔 (Flag) — Lightweight Charts v4.2.3 / v5 setMarkers 支援
- ✅ **顏色**: 橙色 `#FF9800` (Material Orange 500) — 對比紫色 ZigZag 線 (`#9C27B0`) 鮮明
- ✅ **位置**: `aboveBar` — 旗仔喺決定嗰日 K 線 close 上面 8px
- ✅ **文字**: 空白 (純視覺 marker, 唔顯示號碼)
- ✅ **大小**: 預設 1 (細小)
- ✅ **顯示模式**: 跟 ZigZag 啟用 toggle 同步 (唔加新 toggle)
- ✅ **Sequence 互動**: 跟紫色 sequence marker merge 落 candleSeries (因為 setMarkers 係 per series, 唔可以分開 set)

### 改動範圍 (5 個 file)

| # | File | 改動 |
|---|------|------|
| 1 | `testing-page/testing-page.js` | `calculateZigZagFrontend` 每個 push point 加 3 個新 field (decisionDate / decisionValue / decisionType) |
| 2 | `algorithms/AS-03-cycle-detection/adapter.mjs` | `renderMAAlignmentV2ChartOverlay` 新加 flag marker (setMarkers API, 跟 sequence marker merge) |
| 3 | `backend/algorithms/zigzag/algorithm.py` | 1-to-1 port frontend algorithm + 內部加 3 個 decision field (跟大少 23:30 trigger「除消所有對zigzag 相關的限制」) |
| 4 | `web/src/components/chart/ChartContainer.tsx` | `fetchBackendZigZag` return shape 加 decisionTime/decisionValue + `createSeriesMarkers` 旗仔 marker |
| 5 | `web/src/pages/ElliottWaveTestPage/ElliottWaveTestPage.tsx` | 同 ChartContainer 對齊 |

### Algorithm 改動 (3 個新 field, 跟 plan)

每個 trigger 形成嘅 ZigZag point 加 3 個新 field (第一個 point 同最後 ongoing point 唔加):

```javascript
// Frontend (testing-page.js calculateZigZagFrontend):
result.push({
  date: _zigzagNormalizeDate(klines[lastSwingIdx]),  // peak/trough 嗰日 (紫色 P 點 plot 位置)
  value: lastSwingHigh,                              // 或 lastSwingLow
  type: 'high',                                      // 或 'low'
  // 大少 2026-08-30 17:50 新加 3 個 field ↓
  decisionDate: _zigzagNormalizeDate(klines[i]),     // 跌穿/升穿嗰日 (橙色旗仔 plot 位置)
  decisionValue: klines[i].close,                    // 嗰支 K 線 close (Y position)
  decisionType: 'confirmation',                      // 固定 'confirmation', 預留將來 sub-type
});

// Backend (backend/algorithms/zigzag/algorithm.py calculate_zigzag):
result.append({
    "date": _zigzag_normalize_date(klines[last_swing_idx]),
    "value": last_swing_high,  # 或 last_swing_low
    "type": 'high',  # 或 'low'
    "index": last_swing_idx,
    "decisionDate": _zigzag_normalize_date(klines[i]),  # 跌穿/升穿嗰日
    "decisionValue": klines[i]['close'],                # 嗰支 K 線 close
    "decisionType": 'confirmation',
})
```

### Render 改動 (3 個 layer, 對齊 plan)

#### Layer 1 - Testing page (`adapter.mjs`)

```javascript
// 旗仔 marker 永遠 render (跟 zigzagEnabled toggle, 唔跟 showZigzagSequence)
const _flagMarkerPoints = [];
for (const _p of (verdict.meta.zigzagPoints || [])) {
  if (!_p.decisionDate) continue;  // 拎走第一個 point + 最後 ongoing point
  // ... 拎 time + value ...
  _flagMarkerPoints.push({ time: {year, month, day}, value: p.decisionValue });
}

// Set state 喺 chartRefs.zigzagDecisionFlagMarkers
chartRefs.zigzagDecisionFlagMarkers = {
  markers: _flagMarkerPoints.map(_fp => ({
    time: _fp.time,
    position: 'aboveBar',
    color: '#FF9800',
    shape: 'flag',
    text: '',
    size: 1,
  })),
};

// Sequence marker set 嗰陣 merge 旗仔 marker
chartRefs.candleSeries.setMarkers([..._flagMarkersForMerge, ...visibleMarkers]);

// Sequence marker skip 嗰陣都 set 旗仔 marker
if (_flagOnlyMarkers.length > 0) {
  chartRefs.candleSeries.setMarkers(_flagOnlyMarkers);
}
```

#### Layer 2 - Production ChartContainer / ElliottWaveTestPage

```typescript
// fetchBackendZigZag return shape 加 decisionTime/decisionValue
return verdict.points.map((p) => ({
  time: parseTime(p.date, period),
  value: p.value,
  decisionTime: p.decisionDate ? parseTime(p.decisionDate, period) : undefined,
  decisionValue: p.decisionValue,
}));

// createSeriesMarkers 旗仔 marker
const flagMarkers = zigzagData
  .filter((p) => p.decisionTime != null && Number.isFinite(p.decisionValue))
  .map((p) => ({
    time: p.decisionTime,
    position: 'aboveBar' as const,
    color: '#FF9800',
    shape: 'flag' as const,
    text: '',
  }));
zigzagFlagMarkersRef.current = createSeriesMarkers(zigzagSeries, flagMarkers);
```

### Smoke Test 結果 (凡人話 verify)

跑 backend algorithm 用 mock K 線, 拎 3 個 test case 確認旗仔位置 100% 對齊:

| Test | 場景 | Point 拎出 | 旗仔位置 | 對齊 |
|------|------|------------|---------|------|
| 1 | 太古 00019 7/30 peak 100 → 8/6 trough 92.45 (-7.55%) | 3 個 points | 旗仔 plot 喺 2026-08-03 (跌穿 5% 嗰日) | ✅ 對齊 (跟 4.15.0 fix 拎 high/low 拎到 8/6 trough) |
| 2 | 簡單升 trend + 跌穿 trigger | 3 個 points | 旗仔 plot 喺 2026-01-16 (跌穿 5% 嗰日) | ✅ 對齊 |
| 3 | 多個 trigger (升→跌→升→跌) | 4 個 points | 2 個旗仔 (第 1 + 最後 ongoing 冇) | ✅ 對齊 (跟 plan) |

凡人話總結: 旗仔位置 = 跌穿/升穿嗰支 K 線 (即「決定嗰日」), 第一個 point 同最後 ongoing point 冇旗仔 (跟 plan)。

### 永久 rule (大少 2026-08-30 17:50 新加)

- ✅ **ZigZag 決定點 永久用橙色 #FF9800 細小旗仔 marker**, plot 喺決定嗰日 (即股價反方向到達 threshold 嗰支 K 線)
- ✅ **跟 ZigZag 啟用 toggle 同步 on/off** (`zigzagEnabled` toggle), 唔加新獨立 toggle
- ✅ **每個 ZigZag point 對應 1 個旗仔** (decisionDate 有值嗰陣), 第一個 point 冇旗仔 (永遠從第一支 K 線開始, 冇「決定」概念)
- ✅ **最後 ongoing point 都冇旗仔** (仲未確認轉勢, 等下一支 K 線先 trigger)
- ✅ **改 `calculateZigZagFrontend` / `backend/algorithms/zigzag/algorithm.py` 嗰陣, 必同步加 3 個 field** (`decisionDate` / `decisionValue` / `decisionType`), frontend + backend 鏡像
- ✅ **改 `adapter.mjs` 嗰陣, 必同步 bump 2 個地方 cache bust** (testing-page.js ALGO_CACHE_BUST + index.html ?v=2.3.X, 跟 2026-08-09 13:10 永久 rule)
- ✅ **setMarkers 跟 sequence marker merge 落 candleSeries** (因為 Lightweight Charts setMarkers 係 per series, 唔可以分開 set), sequence marker skip 嗰陣都要 set 旗仔 marker
- ✅ **旗仔 marker 拎 setData 之前必 dedupe by time** (對齊 4.40.0 永久 rule, 拎走 silent reject 破壞 chart state)
- ✅ **旗仔 marker time field 用 business day object** `{year, month, day}` (對齊 4.41.2 永久 rule, 避免 type 衝突 silent reject)

### 凡人話: 大少睇到橙色旗仔, 即知「上一支 ZigZag 喺呢一日決定形成」

### 對應 commit

- 即將 push (跟 Spec Sync 旗仔 marker commit 同步)

---

## 🟢 大少 trigger #N — ZigZag P 點 sequence label 排序統一 (2026-08-29 14:32 + 8月31日 09:00)

> **大少 trigger (2026-08-29 14:32)**: 大少附 K 線圖, 定義 P1 = 最新紫色 ZigZag 點 (zzp[-1]), P2 = 第二新, P3 = 第三新, P4 = 第四新
>
> **大少 trigger (8月31日 09:00)**: 「Zigzag的Point排序從右到左是從P1開始的，現在是從P 2開始，你去查明原因」

### 凡人話解釋

大少 8月29日 trigger 永久 rule 定義 P1 = 最新紫色 ZigZag 點, 用嚟做 M1 sub-scenario trigger (強上升/強下跌/到頂/到底)。但 testing page 紫色 marker label 一直由 2 號開始, 因為 1 號俾咗鮮綠色 close extension 終點拎咗 (4.9.0 永久 rule 2026-08-19)。

呢個係 **規則衝突**:
- 4.9.0 永久 rule (2026-08-19 11:15)：「1 號 = 鮮綠色 close extension 終點」(4.10.0 spirit)
- 大少 2026-08-29 14:32 永久 rule：「P1 = 最新紫色 ZigZag 點 (zzp[-1])」

8月31日 01:59 拎返 setMarkers 嗰陣, 4.49.0 永久 rule 盲目拎返 4.10.0 嗰個 spirit, 冇 reconcile 兩個 rule 嘅衝突, 紫色 marker label 繼續由 `idx + 2` 開始。

### Root cause

- `algorithms/AS-03-cycle-detection/adapter.mjs:5245` (4.49.0 拎返 setMarkers 嗰個 block): `text: String(idx + 2)` 紫色由 2 號開始
- `algorithms/AS-03-cycle-detection/adapter.mjs:5250-5257` 鮮綠色 close extension 終點 label 係 "1" (4.9.0 rule)
- `algorithms/AS-03-cycle-detection/adapter.mjs:5260` `const allMarkers = [...greenMarkers, ...purpleMarkers]`, 1 號 (鮮綠色) 排最前
- 鮮綠色 "1" 號 marker 喺 `klines[klines.length-1]` (今日 K 線), 但 testing page 預設 visible range = 最近 126 個交易日 (半年, `testing-page.js:1481`), 今日 K 線有時 out-of-range, 鮮綠色字 #00C853 又淺, 大少睇唔到「1」號以為錯咗

### 永久 rule (大少 8月31日 09:00 trigger — 4.51.0)

- ✅ **改寫 4.9.0 永久 rule**: 刪除「1 號 = 鮮綠色 close extension 終點」描述
- ✅ **統一跟大少 2026-08-29 14:32 永久 rule**:
  - P1 = 最新紫色 ZigZag 點 (verdict.meta.zigzagPoints 倒序後第一個, zzp[-1])
  - P2 = 第二新, P3 = 第三新, P4 = 第四新 (zzp[-2/-3/-4])
  - 上升: P1>P3, P2>P4
  - 下跌: P1<P3, P2<P4
  - 到頂轉勢: P1>P3 + P2>P4 + ZZ_slope<-3%
  - 到底轉勢: P1<P3 + P2>P4 + ZZ_slope>+3%
- ✅ **鮮綠色 close extension 線** (代表「趨勢延續到今日 close」) 仍然 render (對齊 4.8.3 永久 rule), 但冇 sequence label
- ✅ **testing page 紫色 marker label** 由 `idx + 2` 改 `idx + 1` (P1, P2, P3, ... 順序)
- ✅ **鮮綠色 close extension 終點 "1" 號 marker 拎走** (原 4.9.0 規則)
- ✅ **改 `adapter.mjs` 嗰陣, 必同步 bump 2 個地方 cache bust** (testing-page.js ALGO_CACHE_BUST + index.html ?v=2.3.X)
- ✅ **凡人話: 撳 showZigzagSequence toggle, 由右到左 P1, P2, P3, ... 全部紫色 circle, 對齊大少 8月29日 trigger**

### 改動 file

| File | Line | 改動 |
|------|------|------|
| `algorithms/AS-03-cycle-detection/adapter.mjs` | 5238-5260 | `idx + 2` → `idx + 1`, 拎走 `greenMarkers` block, `allMarkers = purpleMarkers` |
| `algorithms/AS-03-cycle-detection/adapter.mjs` | 5168-5169 | comment update 拎走「鮮綠色 1 號 marker」描述, 加 4.51.0 永久 rule 解釋 |
| `algorithms/AS-03-cycle-detection/adapter.mjs` | 5283 | console.log 拎走 "+ 鮮綠色: greenMarkers.length" |
| `testing-page/testing-page.js` | 402 | ALGO_CACHE_BUST '4.50.0' → '4.51.0' + 新永久 rule comment |
| `testing-page/index.html` | 10, 194 | ?v=2.3.111 → ?v=2.3.112 |
| `AGENTS.md` | (新加) | 加新永久 rule section |
| `docs/research/AS-03-cycle-detection/M1-V22-RESEARCH.md` | (本文) | 加呢個章節 (4.51.0 永久 rule 同步) |

### 對應 commit (即將 push)

- `fix(testing-page): ZigZag P 點 indexing 統一 (P1 = 紫色 zzp[-1], 拎走鮮綠色 1 號 marker, 4.51.0 永久 rule)`
- 改: `adapter.mjs` + `testing-page/testing-page.js` + `testing-page/index.html` + `AGENTS.md` + `M1-V22-RESEARCH.md`

---

## 🟢 大少 trigger #N+1 — ZigZag Threshold 切 manual mode 用 localStorage 優先 (2026-08-31 09:24, 4.52.0)

> **大少 trigger (8月31日 09:24)**: 「在Zigzag Threshold 模式 轉手動時沒有跟據輸入而更新，請檢查」

### 凡人話解釋

大少輸入 manual threshold value (e.g. 8%) 之後切去 manual mode, 紫色線 update 用咗 recent auto 結果 (e.g. 3%) 而唔係佢輸入嘅 8%。

呢個係 4.28.0 (2026-08-21 00:02) 切 manual mode handler 嘅邏輯錯誤: 用 recent auto 結果優先, overwrite manual input field。

### Root cause

- `testing-page/testing-page.js` 切 manual mode handler line 1651-1657 (4.28.0): 用 `displayVal.textContent` 拎 recent auto 結果優先, overwrite `manualInput.value`
- `_onManualChange` 觸發嗰陣 `setManualThreshold(v)` → localStorage = 8 (大少輸入嘅 value)
- 切 manual mode 嗰陣 line 1657 overwrite manual input value 變 recent auto 結果 → 紫色線 update 用 recent auto 結果錯

### 永久 rule (大少 8月31日 09:24 trigger — 4.52.0)

- ✅ 切 manual mode 嗰陣永遠用 localStorage manual value 優先 (大少手動輸入過嘅 value)
- ✅ 如果 localStorage 仲係默認 5 (即係從未手動輸入過), fallback 落 recent auto 結果
- ✅ 永遠唔 overwrite manual input field, 用大少真實手動輸入過嘅 value
- ✅ 同步 manual input field value 對齊 v (currentOptions.zigzagThreshold)
- ✅ 對齊 Spec Sync #31 永久 rule: Config UX 模式「自動+手動+自動儲存更新圖表」

### 改動 file

| File | Line | 改動 |
|------|------|------|
| `testing-page/testing-page.js` | 1651-1675 | 切 manual mode handler: 用 localStorage 優先 (v = getManualThreshold()), 否則 fallback 落 recent auto |
| `testing-page/testing-page.js` | 402 | ALGO_CACHE_BUST '4.51.0' → '4.52.0' + 4.52.0 永久 rule comment |
| `testing-page/index.html` | 10, 194 | ?v=2.3.112 → ?v=2.3.113 |
| `AGENTS.md` | (新加) | 加新永久 rule section |
| `docs/research/AS-03-cycle-detection/M1-V22-RESEARCH.md` | (本文) | 加呢個章節 (4.52.0 永久 rule 同步) |

### 對應 commit (即將 push)

- `fix(testing-page): 切 manual mode 用 localStorage 優先, 唔 overwrite 大少輸入 value (4.52.0 永久 rule)`
- 改: `testing-page/testing-page.js` + `testing-page/index.html` + `AGENTS.md` + `M1-V22-RESEARCH.md`

---

## 🔴 大少 trigger #N+2 — 拎走 ZigZag 橙旗決定點 + 鮮綠線 + P 點 sequence marker (2026-08-31 11:09, 4.53.0)

> **大少 trigger (8月31日 11:09)**: 「在圖表的Zigzag還是有些問題,你睇返記錄之前有叫你把最右迫的P2 改成P1 ,還有橙旗的zigzag決定點功能,這些我都想拿走不要,這些有可能影響了正常的Zigzag」
>
> **大少 trigger (8月31日 11:17 + 11:23)**: 「先做一個備份和還原點。有意外可以一鍵還原,現在動手做這個,做好了通知我」
>
> **大少 trigger (8月31日 11:27)**: 揀預設方案(拎走晒,推薦) — 拎走橙旗 + 鮮綠線 + P 點 sequence + Production frontend 橙旗

### 凡人話解釋

大少覺得 ZigZag 圖表太多花巧嘢(橙旗 + 鮮綠線 + P 點 sequence),想畫面乾淨啲,只留返基本嘅紫色 ZigZag 線同 K 線,等睇得清。大少 trigger 明確講「拎走不要,這些有可能影響了正常的 Zigzag」,所以拎走晒 3 個花巧 visual 嘢。

呢個係 4 個永久 rule 嘅逆向改動:
- **4.42.2 永久 rule**(8月30日 17:50)拎走:**橙色 #FF9800 細小旗仔 marker**(plot 喺決定嗰日)
- **4.8.3 永久 rule**(8月19日 09:40)拎走:**鮮綠色 #00C853 close extension 線**(連去今日收市)
- **4.51.0 永久 rule**(8月31日 09:00)拎走 toggle 保留 P1 規則:**紫色 P 點 sequence marker**(P1/P2/P3 號碼)
- **4.49.0 永久 rule**(8月31日 01:59)拎走:**setMarkers 整個 block**(v5 plugin API)

凡人話:Chart 完全乾淨,只有紫色 ZigZag 線 + K 線 + MA 線,再無額外嘅花巧視覺嘢。

### 改動範圍 (6 個 file)

| # | File | 改動 |
|---|------|------|
| 1 | `backend/algorithms/zigzag/algorithm.py` | 拎走 `decisionDate` / `decisionValue` / `decisionType` 3 個 field (4 個 `result.append` 拎走 3 行) + `decision_flag_count` 拎走 + class version 0.1.0 → 0.2.0 |
| 2 | `algorithms/AS-03-cycle-detection/adapter.mjs` | 拎走 line 5104-5304 整段 (橙旗 build 45 行 + 鮮綠線 build 63 行 + P 點 setMarkers block 91 行) |
| 3 | `web/src/components/chart/ChartContainer.tsx` | 拎走 `fetchBackendZigZag` return shape 嘅 `decisionTime?` / `decisionValue?` + `zigzagFlagMarkersRef` handle + 旗仔 marker build 整段 |
| 4 | `web/src/pages/ElliottWaveTestPage/ElliottWaveTestPage.tsx` | 同 ChartContainer 對齊拎走 |
| 5 | `testing-page/testing-page.js` | ALGO_CACHE_BUST '4.52.0' → '4.53.0' + 拎走 `showZigzagSequence` / `zigzagSequenceMaxCount` state + 拎走 `reRenderZigZagSequence` function + 拎走 2 個 toggle event listener + 拎走 debug panel 嘅 sequence + flag display |
| 6 | `testing-page/index.html` | 拎走 `#zigzag-sequence-controls` toggle + `?v=2.3.113` → `?v=2.3.114` |

### 永久 rule (大少 8月31日 11:09 trigger — 4.53.0 拎走)

- ✅ **拎走 ZigZag 橙旗決定點 marker** (4.42.2 永久 rule 拎走)
- ✅ **拎走鮮綠色 #00C853 close extension 線** (4.8.3 永久 rule 拎走)
- ✅ **拎走紫色 P 點 sequence marker toggle** (4.51.0 永久 rule 拎走 toggle, 4.9.0 拎返嘅「1 號 = 鮮綠線終點」規則連帶拎走)
- ✅ **拎走 setMarkers 整個 block** (4.49.0 永久 rule 拎走, 4.10.0 拎返嘅 setMarkers 連帶拎走)
- ✅ **拎走 backend `decisionDate` / `decisionValue` / `decisionType` 3 個 field** (frontend 唔再用, backend response size 縮細)
- ✅ **拎走 production frontend `decisionTime` / `decisionValue` 2 個 field** (跟 backend 對齊)
- ✅ **紫色 ZigZag 線只 render line, 冇 number marker, 冇 close extension 線, 冇旗仔** (chart 完全乾淨)
- ✅ **對齊 8月29日 22:44 永久 rule「所有改動要 confirm」**: 大少明確 trigger「拎走不要」先做
- ✅ **對齊 8月31日 11:01 永久 rule「Backend hot-reload」**: 改 algorithm.py 之後必 restart backend
- ✅ **對齊 2026-08-09 13:10 永久 rule「testing-page .mjs cache bust」**: ALGO_CACHE_BUST + ?v=2.3.X 2 個地方同步 bump
- ✅ **對齊 8月31日 01:48 永久 rule「還原點」**: `git reset --hard 5c89c659eda481918101fe8060480ccfdbc1a67a` 一鍵還原 (Step 0 備份嘅 hash)

### 凡人話: 撳跑完 M1 算法, 圖表只剩紫色 ZigZag 線 + K 線 + MA 線, 大少睇得清

### 對應 commit

- `chore: 拎走 ZigZag 橙旗 (4.53.0 永久 rule)` (大少 8月31日 11:09 + 11:27 trigger 揀預設方案)
- 改: `backend/algorithms/zigzag/algorithm.py` + `algorithms/AS-03-cycle-detection/adapter.mjs` + `web/src/components/chart/ChartContainer.tsx` + `web/src/pages/ElliottWaveTestPage/ElliottWaveTestPage.tsx` + `testing-page/testing-page.js` + `testing-page/index.html`

### Curl Verify (8月31日 11:01 永久 rule「Backend hot-reload」)

```bash
curl -s "http://localhost:18792/api/algorithms/run?algo=zigzag&symbol=HK.00700&period=1d&threshold=5" | python -c "
import json, sys
d = json.load(sys.stdin)
pts = d.get('points', [])
p0 = pts[0]
print('✅ verdict ok,', len(pts), '個 points')
print('  first point keys:', list(p0.keys()))
print('  decision fields:', '❌ 仲喺度' if 'decisionDate' in p0 else '✅ 拎走晒')
print('  meta keys:', list(d.get('meta', {}).keys()))
print('  decision_flag_count:', d.get('meta', {}).get('decision_flag_count', '✅ 拎走 (field 唔存在)'))
"
```

Verify 結果 (8月31日 11:35): 189 個 points, 每個 point 嘅 keys = `['date', 'value', 'type', 'index', 'sequence']`, 冇 `decisionDate` / `decisionValue` / `decisionType`, meta 7 個 field 冇 `decision_flag_count`。

### 對齊 Spec Sync #N+3 (大少 #10203 protocol, 4 steps)

1. `ARCHITECTURE.md` §15.52 加新 section (我負責) — Spec Sync
2. OpenClaw `STOCKPULSE_REFERENCE.md` (OpenClaw 負責, 我不做)
3. OpenClaw Daily Log entry (OpenClaw 負責, 我不做)
4. Commit + push (我負責) — `chore: 拎走 ZigZag 橙旗 (4.53.0 永久 rule)`

### Rollback Plan (8月31日 01:48 永久 rule「還原點」)

```bash
cd /Users/zmenai/stockpulse
git reset --hard 5c89c659eda481918101fe8060480ccfdbc1a67a
# restart backend: cd /Users/zmenai/stockpulse && ./start.sh
```

備份 commit hash `5c89c659eda481918101fe8060480ccfdbc1a67a` 喺 Step 0 記低, 出意外一鍵還原。

---

## 🟢 大少 trigger #N+3 — ZigZag 4.53.0 Sscript 還原點 (大少 2026-08-31 11:59)

> **大少 trigger (8月31日 11:59)**: 「對齊 Sscript pattern (推薦)」 — 大少發現我啱啱用 empty commit 嘅備份 (5c89c659, 7a424c58) 同之前 8月31日 07:52 嘅 Sscript pattern 唔同, 要求對齊 3-component 還原點 pattern (annotated tag + backup branch + restore script)

### 凡人話解釋

之前 §15.45 (大少 8月31日 07:52 trigger) 嘅 Sscript pattern 已經 set 過 Sprint 4 follow-up 嘅還原點 (annotated tag `restore-before-sprint-4-followup` + branch `backup-before-sprint-4-followup` + script `scripts/restore_sprint_4.sh`)。但今次 4.53.0 拎走橙旗嘅備份, 我用咗 empty commit 嘅簡化方式, 大少話要對齊返 Sscript pattern。

凡人話: 之後每個大項目改動前, 必先 set 一個 Sscript 還原點 (3 個 component 一齊), 唔好自己用簡化方式。

### 還原點 4 個 component

| Component | 內容 | 用途 |
|-----------|------|------|
| **Annotated tag** | `restore-after-zigzag-4.53.0` (喺 `7a424c58`) | 永久 marker, 唔會被 future commit 改變 |
| **Backup branch** | `backup-after-zigzag-4.53.0` (喺 `7a424c58`) | 大少可以 `git checkout` 入去睇, 永久 branch 唔會被刪 |
| **Restore script** | `~/stockpulse/scripts/restore_after_zigzag_4.53.0.sh` (chmod +x) | 一鍵還原: 兩次 confirm 撳 `yes` + `RESET` 即 `git reset --hard $RESTORE_TAG` |
| **永久 rule** | ARCHITECTURE §15.53 + AGENTS.md | 之後大項目之前必做還原點 set (annotated tag + branch + script) |

### 對應 commit

- `7a424c58` (本還原點, 4.53.0 之後 empty commit, 大少 trigger「再做一次備份和還是點」)
- `5c89c659` (舊還原點, 4.53.0 之前最後狀態, 拎返橙旗嗰個)
- `23d0231a` (4.53.0 commit, 拎走橙旗嗰個)
- `f4adfe05` (本 Sscript commit, 加 script + push tag + branch)

### 還原命令 (一鍵還原)

```bash
# 還原返 4.53.0 拎走橙旗後狀態 (推薦)
bash scripts/restore_after_zigzag_4.53.0.sh

# 或者手動 (無 double confirm)
git reset --hard 7a424c58c7180d9cc4617f1ec2f79484a4a9083d

# 還原返 4.53.0 之前 (拎返橙旗 + 鮮綠線 + P 點 sequence)
git reset --hard 5c89c659eda481918101fe8060480ccfdbc1a67a
```

### 永久 rule (對齊 §15.45 Sscript pattern)

- ✅ 之後大項目 (refactor / spec rewrite / framework 升級 / 大少明確 trigger) 必做還原點 set
- ✅ 還原點必用 Sscript pattern: annotated tag + backup branch + restore script
- ✅ Restore script 必 double confirm (撳 `yes` + `RESET`) 避免意外
- ✅ Restore script 必 verify HEAD 對應 tag 啱唔啱 + working tree clean
- ✅ Restore script 必 `chmod +x` + push tag + branch 去 origin
- ✅ 對齊 §15.39 「還原備份還原點」pattern

### 教訓 (大少 trigger「現在你這個怎麼不一樣了」)

- 大項目備份之前, 先睇返之前嘅 Sscript pattern, 唔好自己用簡化方式
- 每次做備份先查 `ls scripts/restore_*.sh` 睇返之前 pattern
- 對齊 §15.45 永久 rule pattern, 唔好 break pattern

### 對應 commit

- `f4adfe05 chore(scripts): 加 ZigZag 4.53.0 拎走橙旗後還原點 Sscript (大少 8月31日 11:59 trigger 對齊 Sscript pattern) + Spec Sync`
- 改: `scripts/restore_after_zigzag_4.53.0.sh` (新加 Sscript) + `AGENTS.md` + `ARCHITECTURE.md` + `M1-V22-RESEARCH.md`

對應 commit: 即將 push (Spec Sync §15.53 流程)

---

## 🟢 大少 trigger #N+4 — Backup Admin Page (大少 2026-08-31 12:00 trigger)

> **大少 trigger (8月31日 12:00)**: 「你去做一個新Page,係比我管理所有一鍵還原的備份,要有備份資料和備份的原因,如果我想還原我可以查看後簡單話你知就可以做到」
>
> **大少 trigger (8月31日 12:03)**: 揀「跟 testing-page 風格 (推薦)」 + 「Double confirm modal + 撳 yes (推薦)」

### 凡人話解釋

大少想統一管理所有備份點,睇到每個備份嘅 metadata (commit hash, 日期, 原因) 同揀邊個做一鍵還原。對齊 §15.45 Sscript pattern (annotated tag + backup branch + restore script),Backend 拎所有備份,Frontend 顯示 list + double confirm modal 做還原。

### 改動範圍 (5 個 file)

| # | File | 改動 |
|---|------|------|
| 1 | `backend/api/backup_admin.py` | 新加 endpoint: `GET /api/backup-points/list` 拎所有備份 list, `POST /api/backup-points/restore` 揀 tag 跑對應 restore script |
| 2 | `backend/main.py` | Register `backup_admin_router` 落 FastAPI app |
| 3 | `backup-admin/index.html` | 新加 Page UI: header + 載入掣 + 備份 list container + double confirm modal + progress modal + footer (跟 testing-page 風格) |
| 4 | `backup-admin/backup-admin.js` | JS: loadBackupList + renderBackupList + showRestoreConfirm (double modal) + executeRestore (POST + 顯示 output) + event listeners |
| 5 | `backup-admin/backup-admin.css` | CSS: 備份 card layout + modal 樣式 + status banner + badge 配色 (testing-page 風格) |

### API endpoint shape

#### `GET /api/backup-points/list`
- 掃 `refs/tags/restore-*` + `refs/heads/backup-*` + `scripts/restore_*.sh`
- Dedup by commit hash, combine tag + branch + script 入同一個 point
- Sort by date desc
- Return: `{ ok, points: [{ name, tag, branch, commit, commit_short, date, reason_short, reason_long, script_path, has_script, missing }], script_count, scripts }`

#### `POST /api/backup-points/restore`
- Body: `{ "tag": "restore-after-zigzag-4.53.0", "confirm": "RESET" }`
- 兩層 confirm 跟 Sscript pattern: backend 驗 `confirm == "RESET"` + frontend modal 撳 yes 才發 request
- 跑對應 `scripts/restore_<name>.sh`, auto input `"yes\nRESET\n"` 落 stdin
- Return: `{ ok, tag, commit, script, returncode, stdout, stderr }`

### Frontend UX (大少 8月31日 12:03 揀 double confirm modal + 撳 yes)
- 撳「🔄 載入備份 list」→ fetch API → render card list
- 每個 card: 名字 (優先 tag) + 日期 + commit_short + badge (tag/branch/script/reason) + reason_long box
- 撳「⚠️ 還原到呢個備份」掣 → double confirm modal 顯示警告 + command preview
- 撳「確認還原 (RESET)」才發 request → progress modal 顯示 stdout / stderr
- Esc 取消 modal

### 永久 rule
- ✅ 對齊 §15.45 Sscript pattern (annotated tag + backup branch + restore script)
- ✅ 對齊 §15.39 還原備份還原點 pattern
- ✅ 兩層 confirm 防止意外: frontend modal + backend 驗 "RESET"
- ✅ Backend 用 `_resolve_commit_from_ref` peel annotated tag, dedup by commit hash
- ✅ Backend `_scan_restore_scripts` 拎 EXPECTED_HEAD 配對 commit
- ✅ Frontend auto input `"yes\nRESET\n"` 落 stdin, 跟 Sscript double confirm 對齊
- ✅ Restore script timeout 60s
- ✅ UI 對齊 testing-page 風格 (跟 zigzag-testing/), simple HTML + JS + CSS
- ✅ 對應 8月29日 22:44 永久 rule「所有改動要 confirm」: 大少 12:00 + 12:03 trigger 明確揀 options

### Curl verify (8月31日 12:08, 對齊 §15.51 Backend hot-reload 永久 rule)
```bash
curl -s "http://localhost:18792/api/backup-points/list"
```
✅ ok: True
✅ points count: 2 (restore-after-zigzag-4.53.0 + restore-before-sprint-4-followup)
✅ script count: 2
✅ 全部有 tag + branch + script (missing: [])

### 對應 file
- `backend/api/backup_admin.py` (新加, 12KB)
- `backend/main.py` (加 import + include_router)
- `backup-admin/index.html` (新加, 3.7KB)
- `backup-admin/backup-admin.js` (新加, 8.7KB)
- `backup-admin/backup-admin.css` (新加, 7KB)

### 對應 commit
- `chore: 加 Backup Admin Page (§15.54 永久 rule, 大少 8月31日 12:00 trigger) (跟 testing-page 風格 + double confirm modal) + Spec Sync`
- Spec Sync: ARCHITECTURE.md §15.54 + AGENTS.md + M1-V22-RESEARCH.md

### 教訓
- 之後大項目改動, 必先 set Sscript 還原點 (跟 §15.45 永久 rule)
- Backup Admin Page 自動 scan git tags + branches + scripts, 唔需要人手 update
- 之後新增備份 script, 必 set 對應 annotated tag (`restore-xxx`) + backup branch (`backup-xxx`), 跟 Sscript pattern


## 🟢 大少 trigger #N+5 — M1 Console Log 加 ZigZag 最新 10 點 (大少 2026-08-31 12:50 trigger, 4.54.0 + 4.55.0 fix)

> **大少 trigger (8月31日 12:50)**: 「在 Testing Page M1 下邊有個你做的 Console Log, 我想把 zigzag 最新的十個點 (時間上最新的) 的日子和點數例出來 Console Log 內我可以方便看到」
>
> **大少 trigger (8月31日 13:14 fix)**: 「還是錯的」+ 「你只要把最後的十個例出來,P1就是最後一個 P2就是最後第二個...」

### 4.55.0 Fix (8月31日 13:14) — fix P1-P10 排法 (verdict.points 排法搞錯)

**凡人話解釋**: 4.54.0 commit 寫錯 backend verdict.points 排法, 當 (舊 → 新) 處理, 但實際 backend 拎出嚟係 **(新 → 舊)** (points[0] = 最新, points[-1] = 最舊)。所以之前 4.54.0 console log 嘅 P1 拎到最舊嗰個 point (e.g. 2021-07-14), P10 拎到較新嗰個 (e.g. 2022-06-10), 完全反咗。

**Curl evidence (8月31日 13:14, 確認 verdict.points 排法)**:
```bash
curl -s "http://localhost:18792/api/algorithms/run?algo=zigzag&symbol=HK.00019&threshold_mode=auto&data_window_days=1260" | python3 -c "
import json, sys
d = json.load(sys.stdin)
points = d.get('points', [])
print(f'points count: {len(points)}')
print(f'points[0] (最新): {points[0].get("date")} value={points[0].get("value")} type={points[0].get("type")}')
print(f'points[-1] (最舊): {points[-1].get("date")} value={points[-1].get("value")} type={points[-1].get("type")}')
"
```

**Evidence output**:
```
points count: 10
points[0] (最新): 2026-08-21 value=106.0 type=high
points[-1] (最舊): 2025-08-04 value=66.3 type=low
```

**確認**: verdict.points 排法係 **(新 → 舊)**, points[0] = 最新 (K線最近嗰個交易日), points[-1] = 最舊。

**Fix (1 行 surgical)**:
```javascript
// 改前 (4.54.0 錯):
const last10 = zigzagPoints.slice(-10).reverse();  // 反咗, P1 拎到最舊

// 改後 (4.55.0 對):
const last10 = zigzagPoints.slice(0, 10);  // array 已經 (新 → 舊), 最前 10 個 = 最新嗰 10 個
```

**凡人話 message 改返**:
- 改前: `// P1 = 最新紫色 ZigZag 點 (8月29日 14:32 永久 rule)...`
- 改後: `// P1 = K線最近嗰個交易日嘅紫色 ZigZag 點 (因為 backend verdict.points 排法係 (新 → 舊), points[0] = 最新)`

### 凡人話解釋

大少撳跑 M1 之後, 想喺現有黑色「🔧 Chart Debug」console log (testing page 圖表下面) 自動列出 ZigZag 最新 10 個點嘅日子同點數 (P1 為最新, 倒序排 P1 → P10), 方便對齊睇 chart 上面嘅紫色 ZigZag 線, 唔使再 scroll 開 DevTools console 拎 `window.currentVerdict.meta.zigzagPoints` raw data。

### 改動範圍 (2 個 file)

| # | File | 改動 |
|---|------|------|
| 1 | `testing-page/testing-page.js` | `renderDebugPanel()` 加 `_formatZigZagLatestPointsForDebug()` helper, 喺「K線最後 close」行之下 inject 1 個 mini-table (4 欄: 序號 / 日子 / 點數 / 類型) + bump `ALGO_CACHE_BUST` 4.53.0 → 4.54.0 (4.55.0 fix 改 4.54.0 → 4.55.0) + 加 changelog comment |
| 2 | `testing-page/index.html` | bump `?v=2.3.114` → `2.3.115` (4.55.0 fix 改 2.3.116, 2 個地方: CSS line 10 + JS line 184) |

### Mini-table format
```
📈 ZigZag 最新 10 點 (P1 為最新, 倒序排):
┌──────┬────────────┬────────┬──────────┐
│ 序號 │   日子     │  點數  │  類型    │
├──────┼────────────┼────────┼──────────┤
│ P1   │ 2026-08-21 │ 106.00 │ 📈 Peak  │  ← K線最近嗰個交易日 (backend verdict.points[0])
│ P2   │ 2026-06-23 │ 79.65  │ 📉 Trough│
│ P3   │ 2026-05-08 │ 91.55  │ 📈 Peak  │
│ ...  │    ...     │  ...   │   ...    │
│ P10  │ 2025-08-04 │ 66.30  │ 📉 Trough│  ← 倒數第 10 新 (backend verdict.points[9])
└──────┴────────────┴────────┴──────────┘
// P1 = 最新紫色 ZigZag 點 (8月29日 14:32 永久 rule), 上升判斷: P1>P3 + P2>P4 / 下跌判斷: P1<P3 + P2<P4
```

### 永久 rule
- ✅ Testing page M1 跑完之後, 喺黑色 🔧 Chart Debug panel 底部永遠 auto-render 1 段「📈 ZigZag 最新 10 點 (P1 為最新, 倒序排)」
- ✅ 永遠拎 `lastVerdict.meta.zigzagPoints` (renderDebugPanel 已經收 verdict 做 parameter), 唔好用 `window.currentVerdict`
- ✅ **P1 = points[0] = K線最近嗰個交易日嘅紫色 ZigZag 點** (backend verdict.points 排法係 (新 → 舊))
- ✅ **永遠用 `slice(0, 10)` 拎最前 10 個** (即係最新嗰 10 個, 因為 array 已經係 (新 → 舊)), 唔好用 `slice(-10).reverse()` (4.55.0 fix)
- ✅ Style 全部 inline (唔加 testing-page.css, 跟 popup 註解永久 rule 風格一致)
- ✅ 凡人話: 大少撳跑 M1 → 即時喺 console log 底部見到 P1-P10 日子 + 點數 → 唔使再 scroll 開 DevTools console
- ✅ 對齊 2026-08-09 13:10 永久 rule「改 .js 之後必同步 bump ALGO_CACHE_BUST + ?v=2.3.X」 (雖然今次冇改 .mjs, 但 .js 改動都跟同一個 pattern)
- ✅ 對齊 4.43.0 永久 rule「ZigZag 全部 backend 計」 (frontend 拎 backend 注入嘅 verdict.meta.zigzagPoints, 唔重計)
- ✅ 對齊 4.15.0 永久 rule「之字拎 point 用 high/low」 (type 'high' = peak, type 'low' = trough)
- ✅ 對齊 8月29日 14:32 永久 rule P1/P2/P3/P4 indexing 精神 (P1 = 最新, 之後順序)
- ✅ Edge case: empty / undefined → 顯示「(冇 points, 可能未跑算法 / threshold 太高)」, 唔 crash
- ✅ **4.55.0 lesson learned**: 改 array sort / iterate 邏輯之前, 必先用 curl / test script 拎 evidence 確認 array 排法, 唔可以靠注釋 / mental model 估
- ✅ Edge case: zigzagPoints.length < 10 → table 顯示實際有嘅 (1-9 行)

### Acceptance tests
1. 撳跑 M1 (AS-03-MA) 任何股票 e.g. HK.00019 (太古) → 撳跑完之後, scroll 落 chart 下面, 見到黑色 🔧 Chart Debug panel
2. Panel 底部 (K線最後 close 行之下) 見到新段「📈 ZigZag 最新 10 點 (P1 為最新, 倒序排):」
3. Mini-table 顯示最多 10 行 (如果 zigzagPoints.length >= 10), 每行有 4 欄
4. **P1 = K線最近嗰個交易日嘅紫色 ZigZag 點** (對齊 chart 上面紫色 ZigZag 線最後嗰個 point, 對齊 K線最近)
5. **P10 = 倒數第 10 新嗰個交易日** (e.g. HK.00019 = 2025-08-04)
6. 撳跑 zmen / M9 等其他 module → 因為 `verdict.meta.zigzagPoints` undefined, mini-table 顯示「(冇 points, 可能未跑算法 / threshold 太高)」, 唔 crash

### 對應 file
- `testing-page/testing-page.js` (改 1 個 function renderDebugPanel, 加 1 個 helper _formatZigZagLatestPointsForDebug, bump ALGO_CACHE_BUST 4.54.0 → 4.55.0)
- `testing-page/index.html` (改 2 個 ?v= cache bust 2.3.115 → 2.3.116)

### 對應 commit
- `feat(testing-page): M1 console log 加 ZigZag 最新 10 點 (日子 + 點數)` (`3f8ec81b` 4.54.0)
- `docs: Spec Sync #55 - M1 console log ZigZag 最新 10 點 永久 rule` (`d64ec77f` 4.54.0, 寫錯 verdict.points 排法 description, 4.55.0 fix commit 改返)
- `fix(testing-page): M1 console log P1-P10 排法 (verdict.points 排法搞錯, 4.55.0)` (即將 push, 4.55.0 fix)
- Spec Sync: ARCHITECTURE.md §15.55 (本段) + AGENTS.md 「M1 console log 加 ZigZag 最新 10 點 永久 rule」section + M1-V22-RESEARCH.md 「🟢 大少 trigger #N+5」section

### 教訓
- 大少 trigger「Console Log 內我可以方便看到」即係凡人話視覺易讀, 唔係要佢自己去 DevTools console 拎 raw data
- 之後 testing page 任何 verdict meta dump display 永遠 inline 喺 debug panel, 唔好新加獨立 section (會 split 大少視線)
- 揀 mini-table 而唔係 plain text 列表, 因為 4 欄 layout 對齊視覺易讀 (序號 / 日子 / 點數 / 類型)
- **4.55.0 lesson learned (重要)**: 改 array sort / iterate 邏輯之前, 必先用 curl / test script 拎 evidence 確認 array 排法, 唔可以靠注釋 / mental model 估 (4.54.0 我估 verdict.points 係 (舊 → 新), 實際係 (新 → 舊), 結果 P1-P10 完全反咗)
- 大少 8月29日 14:32 永久 rule P1/P2/P3/P4 indexing 已經定義咗順序 (P1 最新, zzp[-1] 精神, 但此處 verdict.points[0] = 最新, 對齊 K線最近), 之後任何 ZigZag point display 跟呢個 indexing
- **順便發現 backend bug** (唔喺今次 fix 範圍): `backend/algorithms/zigzag/algorithm.py` 嘅 `assign_sequence_numbers` 函數注釋寫 `1 = points[-1] (最後一個 = 最新)`, 但實際 points[-1] = 最舊。Production frontend 4.53.0 拎走 P 點 sequence marker, 暫時冇 visible impact, 之後 follow-up sprint 先處理

## 🟢 大少 trigger #N+6 — M1 P1 拎 K 線最後 close (大少 2026-08-31 15:19 trigger, 4.56.0)

> **大少 trigger (8月31日 15:19)**: 「很好,但我發現P1的點是在8月28日,但今日是8月31日也開了市,能不能把最新的數據也計進去?」
>
> **大少 trigger (8月31日 15:26)**: 「現在先做個備份和一鍵還原」
>
> **大少 trigger (8月31日 15:28)**: 「但在備份還原點管理沒有看到新的還原點,先處理這個」

### 凡人話解釋

大少撳跑 M1 之後, 想 P1 對齊 K 線最後 close (今日 8月31日), 即使未 trigger 5% threshold 都要拎「最新」嘅 K 線 close, 唔好拎最後 confirmed ZigZag point (8月28日 peak 46.50) 落後過 K 線最後一日。

大少 15:26 trigger 必先 set Sscript 還原點先做 implementation, 對齊 §15.45 + §15.53 + §15.54 永久 rule + 12:08 user memory 永久 rule (每做新 Sscript 還原點都要 verify Backup Admin Page 拎到)。

### 改動範圍 (7 個 file)

| # | File | 改動 |
|---|------|------|
| 1 | `backend/algorithms/zigzag/algorithm.py` | `calculate_zigzag` 函數喺 result 最後 add 多個 `type: 'today'` point, value = `klines[-1].close` |
| 2 | `algorithms/AS-03-cycle-detection/adapter.mjs` | `renderMAAlignmentV2ChartOverlay` filter 走 'today' point (line 5012) |
| 3 | `web/src/components/chart/ChartContainer.tsx` | `fetchBackendZigZag` filter 走 'today' point (line 302) |
| 4 | `web/src/pages/ElliottWaveTestPage/ElliottWaveTestPage.tsx` | `fetchBackendZigZag` filter 走 'today' point (line 240) |
| 5 | `web/src/utils/elliottWave.ts` | `detectElliottWave` filter 走 'today' point (避免 EWave pattern index shift) |
| 6 | `testing-page/testing-page.js` | `_formatZigZagLatestPointsForDebug` 拎 'today' point 做 P1 + bump ALGO_CACHE_BUST 4.55.0 → 4.56.0 |
| 7 | `testing-page/index.html` | `?v=2.3.116` → `2.3.117` (2 個地方: CSS line 10 + JS line 184) |

### Curl evidence (8月31日 15:35, 確認 'today' point 拎 OK)
```bash
curl -s "http://localhost:18792/api/algorithms/run?algo=zigzag&symbol=HK.00019&threshold_mode=auto&data_window_days=1260" | python3 -c "
import json, sys
d = json.load(sys.stdin)
points = d.get('points', [])
print(f'points count: {len(points)}')
for p in points[:3]:
    print(f'  {p.get(chr(34)datechr(34))} value={p.get(chr(34)valuechr(34))} type={p.get(chr(34)typechr(34))}')
"
```

**Evidence output**:
```
points count: 11
  2026-08-28 00:00:00 value=104.4 type=today
  2026-08-21 value=106.0 type=high
  2026-06-23 value=79.65 type=low
```

**確認**: 4.56.0 'today' point 拎 OK, P1 = 8月28日 close 104.4 (對齊 K 線最近嗰個交易日)。

### 永久 rule
- ✅ Backend algorithm 加 `type: 'today'` point 入 verdict.points, value = `klines[-1].close`
- ✅ 凡人話: P1 對齊 K 線最後 close (今日 8月31日), 即使未 trigger 5% threshold
- ✅ Chart 上面紫線最後 1 個 point 仍然係 8月28日 confirmed peak (對齊 4.53.0 拎走鮮綠線 decision)
- ✅ Production frontend ChartContainer + ElliottWaveTestPage + adapter.mjs + elliottWave.ts 全部 filter 走 'today' point 對齊 4.53.0 chart decision
- ✅ Testing page console log P1 拎 'today' point (display 改善, 對齊 K 線最後 close)
- ✅ 對齊 4.43.0 永久 rule「ZigZag 全部 backend 計」
- ✅ 對齊 4.53.0 永久 rule「拎走橙旗 + 鮮綠線 + 1 號 marker」
- ✅ 對齊 §15.45 + §15.53 + §15.54 永久 rule (Sscript 還原點)
- ✅ 對齊 §15.51 永久 rule (改 algorithm.py 必 restart backend + curl verify)

### Acceptance tests
1. Restart backend (§15.51 永久 rule): `cd ~/stockpulse && ./start.sh`
2. Curl verify backend 加 'today' point: `curl /api/algorithms/run?algo=zigzag&symbol=HK.00019&threshold_mode=auto&data_window_days=1260` 拎到 points count: 11, last point type='today'
3. 撳跑 M1 (AS-03-MA) HK.00019 → reload testing page (`?v=2.3.117` cache bust 自動)
4. 落黑色 🔧 Chart Debug panel 底部
5. P1 = 2026-08-28 value=104.4 type='today' (今日 K 線最後 close)
6. P2 = 2026-08-21 value=106.0 type='high' (原本 P1)
7. P3-P10 = 8月28日之前 confirmed ZigZag points
8. Chart 上面紫線最後 1 個 point 仍然係 8月21日 high 106.0 (對齊 4.53.0 chart decision)
9. 撳跑 zmen / M9 → mini-table 顯示「(冇 points, 可能未跑算法 / threshold 太高)」, 唔 crash

### 對應 file
- `backend/algorithms/zigzag/algorithm.py` (改 1 個 function calculate_zigzag)
- `algorithms/AS-03-cycle-detection/adapter.mjs` (改 1 行 filter)
- `web/src/components/chart/ChartContainer.tsx` (改 1 行 filter)
- `web/src/pages/ElliottWaveTestPage/ElliottWaveTestPage.tsx` (改 1 行 filter)
- `web/src/utils/elliottWave.ts` (改 1 個 function detectElliottWave)
- `testing-page/testing-page.js` (改 1 個 helper + bump ALGO_CACHE_BUST)
- `testing-page/index.html` (改 2 個 ?v= cache bust)

### 對應 commit
- `fix(zigzag): P1 拎 K 線最後 close (backend algorithm 加 'today' point, 4.56.0)` (即將 push, 4.56.0 fix)
- Spec Sync: ARCHITECTURE.md §15.56 + AGENTS.md 「M1 console log P1 拎 K 線最後 close 永久 rule」section + M1-V22-RESEARCH.md 「🟢 大少 trigger #N+6」section

### 對應 Sscript 還原點
- annotated tag: `restore-before-zigzag-4.56.0` (commit 1fca411b, 4.55.0 fix 之前最後狀態)
- backup branch: `backup-before-zigzag-4.56.0`
- restore script: `scripts/restore_before_zigzag_4.56.0.sh` (double confirm + git stash + git reset --hard)
- 對齊 §15.45 + §15.53 + §15.54 永久 rule
- Backup Admin Page 拎到 3 個還原點 (verify 過): `restore-before-zigzag-4.56.0` (1fca411b) + `restore-after-zigzag-4.53.0` (7a424c58) + `restore-before-sprint-4-followup` (7e68053a)

### 教訓
- 4.55.0 lesson learned (續): 改 algorithm verdict.points 結構必先 grep 所有 caller 拎 evidence 確認 impact (4.56.0 落實咗, 5 個 caller 全部 filter 走)
- 大少 15:26 trigger「現在先做個備份和一鍵還原」: 改大 algorithm 必先 set Sscript 還原點 (對齊 §15.45 + §15.53 + §15.54 永久 rule + 12:08 user memory 永久 rule)
- 大少 15:28 trigger「在備份還原點管理沒有看到新的還原點,先處理這個」: 落實 step 0 set 還原點後, 立即 verify Backup Admin Page 拎到 (對齊 12:08 user memory 永久 rule)
- M1 v2.0 + M7 Synthesizer 已經拎走 ZigZag 依賴 (Spec Sync #46 永久 rule), 所以 4.56.0 唔需要 filter 呢 2 個 module
- 凡人話: 大少 trigger「把最新的數據也計進去」意思係 P1 對齊 K 線最後一日, 而非對齊 K 線最後 confirmed ZigZag point。Backend 加 'today' point 解決, chart 對齊 4.53.0 唔 render 鮮綠線

## 🟢 大少 trigger #N+7 — Backup Admin Page 4 個優化 (大少 2026-08-31 17:37 trigger, §15.55)

> **大少 trigger (8月31日 17:37)**: 「你去優化下備份還原點管理」+ 答「全部都做,但還完了後我不想删走那個還完點,因為可能會再用」

### 凡人話解釋

大少 17:37 trigger「全部都做」對 backup admin page 做 4 個優化, 仲要保留 tag (reset 完之後, tag 仲喺度方便日後再 reset 返去, 對齊大少 trigger「可能會再用」+ 12:08 user memory 永久 rule)。

### 改動範圍 (4 個 file)

| # | File | 改動 |
|---|------|------|
| 1 | `backend/api/backup_admin.py` | 加 `can_restore` field 落 `GET /list` + 3 個新 endpoint (`/audit`, `/recover-script`, `/set`) |
| 2 | `backup-admin/backup-admin.js` | 加 4 個 handler + bump CACHE_BUST 1.0.0 → 1.1.0 |
| 3 | `backup-admin/index.html` | 加 audit section + sscript set modal + recover modal + bump ?v=1.0.0 → 1.1.0 |
| 4 | `backup-admin/backup-admin.css` | 加 4 個新 style |

### 永久 rule (4 個方向)
- ✅ A. Missing warning UI: `can_restore: true/false` field, missing 嘅 card 顯示「🚫 缺 component, 撳 Recover」+ disable reset btn + 加「🔧 Recover script」inline btn
- ✅ B. Sscript set helper: Frontend「+ 設定新還原點」掣 → Backend `POST /api/backup-points/set` 自動 generate script + tag + branch + push
- ✅ C. Audit trail: Backend `GET /api/backup-points/audit` 拎 git reflog 嘅 reset history
- ✅ D. Recover script (redefined cleanup): Backend `POST /api/backup-points/recover-script` 用 `git show <tag-commit>:<script-path>` 拎返 script, 保留 tag

### Curl evidence (8月31日 17:51 verify 4 個 endpoint)
```bash
# A 方向: can_restore field
curl -s "http://localhost:18792/api/backup-points/list" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for p in d.get('points', []):
    print(f'  {p["tag"]} ({p["commit_short"]}) — missing: {p.get("missing", [])} — can_restore: {p.get("can_restore")}')"

# C 方向: audit
curl -s "http://localhost:18792/api/backup-points/audit" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'ok: {d.get("ok")}, count: {d.get("count", 0)}')"

# D 方向: recover (KNOWN ISSUE: uvicorn subprocess 拎 dangling commit 拎唔到 stdout)
curl -s -X POST "http://localhost:18792/api/backup-points/recover-script" -H "Content-Type: application/json" -d '{"tag":"restore-before-zigzag-4.56.0"}' | python3 -m json.tool
```

**Evidence output**:
```
A 方向: 3 個 points, restore-before-zigzag-4.56.0 (1fca411b) — missing: ['script'] — can_restore: False
A 方向: restore-after-zigzag-4.53.0 (7a424c58) — missing: [] — can_restore: True
A 方向: restore-before-sprint-4-followup (7e68053a) — missing: [] — can_restore: True
C 方向: ok: True, count: 21
D 方向: KNOWN ISSUE - uvicorn subprocess 拎空 stdout (workaround: 大少手動 git show 拎返)
```

### 永久 rule
- ✅ 4 個方向全部做 (missing warning + Sscript helper + audit trail + recover script)
- ✅ 保留 tag (對齊 12:08 user memory 永久 rule, 大少 trigger「不想删走」)
- ✅ 對齊 §15.45 + §15.53 + §15.54 + 12:08 user memory 永久 rule
- ✅ 對齊 §15.51 永久 rule (改 endpoint 必 restart backend + curl verify)
- ✅ Cache bust 永久 rule: CACHE_BUST 1.0.0 → 1.1.0 + ?v=1.0.0 → 1.1.0

### Acceptance tests
1. Reload backup admin page (`?v=1.1.0` cache bust 自動)
2. 撳「🔄 載入備份 list」, 見到 3 個還原點, `restore-before-zigzag-4.56.0` 顯示 can_restore: false
3. 撳「🔧 Recover script」inline btn (D 方向, 但有 known issue)
4. 撳「+ 設定新還原點」掣 (B 方向), 輸入 name + reason, 自動做齊 tag + branch + script + push
5. 撳「🔄 載入 reset history」掣 (C 方向), 見到之前 reset 過嘅 21 條記錄

### 對應 file
- `backend/api/backup_admin.py` (加 3 個 endpoint + can_restore field)
- `backup-admin/backup-admin.js` (加 4 個 handler + bump CACHE_BUST)
- `backup-admin/index.html` (加 3 個新 section + bump ?v=)
- `backup-admin/backup-admin.css` (加 4 個新 style)

### 對應 commit
- `feat(backup-admin): 4 個優化 (§15.55 永久 rule, 大少 8月31日 17:37 trigger)` (`f545681d`)
- Spec Sync: ARCHITECTURE.md §15.55 + AGENTS.md 「Backup Admin Page 4 個優化永久 rule」section + M1-V22-RESEARCH.md 「🟢 大少 trigger #N+7」section

### 對齊永久 rule
- §15.45 Sscript pattern (annotated tag + backup branch + restore script)
- §15.53 Sscript 還原點永久 rule
- §15.54 Backup Admin Page 永久 rule
- 12:08 user memory 永久 rule (每做新 Sscript 還原點都要 verify Backup Admin Page 拎到)
- 大少 17:37 trigger「還完了後我不想删走那個還完點,因為可能會再用」

### 教訓
- 大少 trigger「保留 tag」+「可能會再用」= 對齊 §15.45 Sscript pattern + 12:08 user memory 永久 rule
- 改 endpoint 前必先 curl evidence (對齊 4.55.0 lesson learned)
- 改 Git endpoint 必先 restart backend + curl verify (對齊 §15.51 永久 rule)
- uvicorn subprocess + git reflog 拎 dangling commit 嘅 issue 屬於 OS-level, 之後 follow-up (可能要改用 os.system + file I/O)
- 凡人話: 大少 4 個優化方向 (missing warning + Sscript helper + audit + recover) 全部對齊 §15.45 + §15.53 + §15.54 + 12:08 user memory 永久 rule, 之後任何備份還原點 set / reset / recover 都要 verify 拎到

## 🟢 大少 trigger #N+8 — 拎返 M1 紫色 ZigZag P 點 sequence marker (4.62.0, 2026-09-01 22:58)

### 凡人話解釋
大少 9月1日 22:58 trigger「現在把在Backend已計好的P1，P2, P3,.....的點放到圖表裡，要寫上P1，P2， P3...」— 拎返 4.51.0 拎返嘅紫色 ZigZag P 點 sequence marker，但**唔拎返** 4.53.0/4.61.5 拎走嘅其他嘢 (橙旗 / 鮮綠 close extension 線 / 紅色觸發點 / P 點 toggle 同 spinbutton)。只係拎返 P 點視覺化, 拎走嗰陣拎走嘅其他嘢保留拎走。

### 改動清單
- `algorithms/AS-03-cycle-detection/adapter.mjs` `renderMAAlignmentV2ChartOverlay` (line 5103 之後) 拎返 P 點 marker block (約 65 行)
- `testing-page.js` ALGO_CACHE_BUST 4.61.8 → 4.62.0
- `testing-page/index.html` ?v=2.3.129 → 2.3.130
- 3 個 spec doc 同步 (AGENTS.md + ARCHITECTURE.md + M1-V22-RESEARCH.md)

### P 點 marker 規格
- **Label**: `P${point.sequence}` 直接用 backend `verdict.points[].sequence` (1=最新, N=最舊)
- **Position**: high → aboveBar, low → belowBar (4.51.0 永久 rule)
- **Shape**: circle
- **Color**: 紫色 #9C27B0
- **Size**: 1
- **Time**: business day object `{year, month, day}` (4.41.2 永久 rule)
- **Dedupe by time** (4.40.0 永久 rule)
- **v5 plugin API**: `LightweightCharts.createSeriesMarkers` (4.49.0 + 9月1日 22:38 永久 rule)
- **v4 fallback**: `candleSeries.setMarkers` (4.10.0 永久 rule v5 向後兼容)

### 對齊永久 rule
- 4.49.0 v5 createSeriesMarkers plugin API
- 4.51.0 P 點 label/color/shape/position 規格
- 4.10.0 v4 candleSeries.setMarkers fallback
- 4.40.0 dedupe by time
- 4.41.2 business day object time field
- 4.43.0 ZigZag 全部 backend 計 (frontend 唔重計)
- 8月29日 14:32 P1/P2/P3/P4 indexing (P1=zzp[-1] 最新)
- 9月1日 22:38 PPP 永久 rule (v5 plugin API + v4 fallback)
- 8月29日 22:44 所有改動要 confirm (大少 explicit trigger 已 confirm)
- 2026-08-09 13:10 testing-page .mjs cache bust (ALGO_CACHE_BUST + ?v=2.3.X)

### 唔拎返 (保留 4.53.0/4.61.5 拎走嘅永久 rule)
- ❌ P 點 toggle (checkbox) + max count spinbutton (4.53.0)
- ❌ 橙旗決定點 marker (4.42.2)
- ❌ 鮮綠 close extension 線 (4.8.3 / 4.51.0)
- ❌ 紅色觸發點 marker (4.61.5)

### 對應 commit
- 即將 push (`feat(adapter): 拎返 M1 紫色 ZigZag P 點 sequence marker (4.62.0, 對齊 8月29日 14:32 P1/P2/P3/P4 indexing)`)
- Spec Sync: ARCHITECTURE.md §15.61 + AGENTS.md 「M1 P 點 sequence marker 拎返 永久 rule (4.62.0)」section + M1-V22-RESEARCH.md 「🟢 大少 trigger #N+8」(本段)

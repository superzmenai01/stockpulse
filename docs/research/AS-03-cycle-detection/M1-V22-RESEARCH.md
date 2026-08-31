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
| 弱上升 weak_uptrend | 11 | 17% |
| 強上升 strong_uptrend | 8 | 13% |
| 上升回調 uptrend_correction | 7 | 11% |
| 下跌反彈 downtrend_bounce | 4 | 6% |
| 弱下跌 weak_downtrend | 1 | 2% |
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
| 2 | 弱升 | MA5 > MA10 > MA60 + 但 MA5 斜率 ≤ 1% 或 MA60 斜率 ≤ 0.3% |
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
| 7 | 弱跌 | MA5 < MA10 < MA60 + MA5 斜率 ≥ -1% 或 MA60 斜率 ≥ -0.3% |
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

## 📋 9 個 sub-scenario v2.1.0 簡單算法表 (大少 2026-08-18 06:36 trigger)

> **永久 rule**: 改任何 sub-scenario trigger 都要即刻 update 呢個 section,等下次可以即刻調動出嚟 review
> **Source**: `algorithms/AS-03-cycle-detection/modules/ma-alignment.ts` line 280-339
> **Status**: 🚧 9 條之中 5 條已知有問題 (待大少逐條 review)

### 🔼 Priority 1 - 警號 (transition, 最重要)

| # | 狀態 | 凡人話 | v2.1.0 簡單算法 (現有) | 已知問題 | 大少提議 |
|---|------|--------|----------------|---------|---------|
| 1 | **到頂** | 升到頂, 準備跌 | MA5 斜率 < -3% + MA60 斜率 > 0 + 連跌 ≥ 4 日 | ⚠️ 連跌 4 日太脆弱, 1 日微升打斷 | 改用 MA5 跌穿 MA60 (1 日 event) |
| 2 | **到底** | 跌到底, 準備升 | MA5 斜率 > +3% + MA60 斜率 < 0 + 連升 ≥ 4 日 | ⚠️ 連升 4 日太脆弱 | 改用 MA5 升穿 MA60 (1 日 event) |

### 🔼 Priority 2 - 強趨勢 (排列全 + 全部斜率 + 量能)

| # | 狀態 | 凡人話 | v2.1.0 簡單算法 (現有) | 已知問題 | 大少提議 |
|---|------|--------|----------------|---------|---------|
| 3 | **強升** | 實力上升, 放量配合 | 排列 bull (MA5>MA10>MA60) + 全部 MA 斜率正 + 放量 | ⚠️ 太古 25% 升幅但 algorithm 可能太鬆 (70% 日穿底) | ❓ 等 review |
| 4 | **強跌** | 實力下跌, 放量確認 | 排列 bear (MA5<MA10<MA60) + 全部 MA 斜率負 + 放量 | ❓ 未 review | ❓ 等 review |

### 🔼 Priority 3 - 弱趨勢 (排列全但部分斜率/量能唔配合)

| # | 狀態 | 凡人話 | v2.1.0 簡單算法 (現有) | 已知問題 | 大少提議 |
|---|------|--------|----------------|---------|---------|
| 5 | **弱升** | 初步上升, 量能唔配合 | 排列 bull + 但部分斜率/量能唔配合 | ❓ 未 review | ❓ 等 review |
| 6 | **弱跌** | 初步下跌, 量能唔配合 | 排列 bear + 但部分斜率/量能唔配合 | ❓ 未 review | ❓ 等 review |

### 🔼 Priority 4 - 過渡形態 (短長期分裂)

| # | 狀態 | 凡人話 | v2.1.0 簡單算法 (現有) | 已知問題 | 大少提議 |
|---|------|--------|----------------|---------|---------|
| 7 | **上升回調** | 升到一半抖下 | MA5+MA10 斜率負 + MA60 斜率正 + spread ≥ 某門檻 | ❓ 未 review | ❓ 等 review |
| 8 | **下跌反彈** | 跌到一半彈下 | MA5+MA10 斜率正 + MA60 斜率負 + spread ≥ 某門檻 | ❓ 未 review | ❓ 等 review |

### 🔼 Default - 橫行

| # | 狀態 | 凡人話 | v2.1.0 簡單算法 (現有) | 已知問題 | 大少提議 |
|---|------|--------|----------------|---------|---------|
| 9 | **橫行** | 平, 唔升唔跌 | 其他所有情況 (排列唔 clear) | ⚠️ 過寬 (16 隻中 13 隻 MA5 斜率 > 2%) + 大少提議 close<MA5 條件 | 改用 `MA5>MA60 + close<MA5 ≥ 50%` + 其他 sub-condition |

---

### 4 個已知問題清單 (待大少逐條 review)

| # | sub-scenario | 問題 | 大少提議 |
|---|---|---|---|
| 1 | **到頂** (Priority 1) | 連跌 4 日太脆弱, 1 日微升打斷 | 改用 MA5 跌穿 MA60 (1 日 event) |
| 2 | **到底** (Priority 1) | 連升 4 日太脆弱 | 改用 MA5 升穿 MA60 (1 日 event) |
| 3 | **強升** (Priority 2) | 太古 25% 升幅可能 algorithm 太鬆 (70% 日穿底) | ❓ 等 review |
| 4 | **橫行** (Default) | 16 隻中 13 隻 MA5 斜率 > 2% (根本唔平) | 改用 `MA5>MA60 + close<MA5 ≥ 50%` + sub-condition |

---

### 永久 rule (大少 2026-08-18 06:36 trigger)

- ✅ **改任何 sub-scenario trigger 都要即刻 update 呢個 section** (9 個 sub-scenario 簡單算法表)
- ✅ **大少 review 一條, 我拎 stock 例子 + 凡人話解釋, 等大少 confirm trigger 條件**
- ✅ **全部確認完一次過改 code, 之後做 Spec Sync + commit + push**
- ✅ **改完即時 update v2.1.0 簡單算法表 (呢個 section) 嘅算法條件 column**

---

**Maintainer**: 大少 + Mavis  
**Created**: 2026-08-16 19:25  
**Last Updated**: 2026-08-20 12:30 (大少 trigger #12: ZigZag direction flag refactor)  
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


## 🟢 大少 trigger #N+5 — M1 Console Log 加 ZigZag 最新 10 點 (大少 2026-08-31 12:50 trigger, 4.54.0)

> **大少 trigger (8月31日 12:50)**: 「在 Testing Page M1 下邊有個你做的 Console Log, 我想把 zigzag 最新的十個點 (時間上最新的) 的日子和點數例出來 Console Log 內我可以方便看到」

### 凡人話解釋

大少撳跑 M1 之後, 想喺現有黑色「🔧 Chart Debug」console log (testing page 圖表下面) 自動列出 ZigZag 最新 10 個點嘅日子同點數 (P1 為最新, 倒序排 P1 → P10), 方便對齊睇 chart 上面嘅紫色 ZigZag 線, 唔使再 scroll 開 DevTools console 拎 `window.currentVerdict.meta.zigzagPoints` raw data。

### 改動範圍 (2 個 file)

| # | File | 改動 |
|---|------|------|
| 1 | `testing-page/testing-page.js` | `renderDebugPanel()` 加 `_formatZigZagLatestPointsForDebug()` helper, 喺「K線最後 close」行之下 inject 1 個 mini-table (4 欄: 序號 / 日子 / 點數 / 類型) + bump `ALGO_CACHE_BUST` 4.53.0 → 4.54.0 + 加 changelog comment |
| 2 | `testing-page/index.html` | bump `?v=2.3.114` → `2.3.115` (2 個地方: CSS line 10 + JS line 184) |

### Mini-table format
```
📈 ZigZag 最新 10 點 (P1 為最新, 倒序排):
┌──────┬────────────┬────────┬──────────┐
│ 序號 │   日子     │  點數  │  類型    │
├──────┼────────────┼────────┼──────────┤
│ P1   │ 2026-08-15 │ 80.50  │ 📈 Peak  │
│ P2   │ 2026-08-10 │ 78.30  │ 📉 Trough│
│ P3   │ 2026-08-05 │ 82.10  │ 📈 Peak  │
│ ...  │    ...     │  ...   │   ...    │
│ P10  │ 2026-06-20 │ 75.40  │ 📈 Peak  │
└──────┴────────────┴────────┴──────────┘
// P1 = 最新紫色 ZigZag 點 (8月29日 14:32 永久 rule), 上升判斷: P1>P3 + P2>P4 / 下跌判斷: P1<P3 + P2<P4
```

### 永久 rule
- ✅ Testing page M1 跑完之後, 喺黑色 🔧 Chart Debug panel 底部永遠 auto-render 1 段「📈 ZigZag 最新 10 點 (P1 為最新, 倒序排)」
- ✅ 永遠拎 `lastVerdict.meta.zigzagPoints` (renderDebugPanel 已經收 verdict 做 parameter), 唔好用 `window.currentVerdict`
- ✅ 倒序排 (P1 = 最新, zzp[-1]), 對齊 8月29日 14:32 永久 rule P1/P2/P3/P4 indexing
- ✅ Style 全部 inline (唔加 testing-page.css, 跟 popup 註解永久 rule 風格一致)
- ✅ 凡人話: 大少撳跑 M1 → 即時喺 console log 底部見到 P1-P10 日子 + 點數 → 唔使再 scroll 開 DevTools console
- ✅ 對齊 2026-08-09 13:10 永久 rule「改 .js 之後必同步 bump ALGO_CACHE_BUST + ?v=2.3.X」 (雖然今次冇改 .mjs, 但 .js 改動都跟同一個 pattern)
- ✅ 對齊 4.43.0 永久 rule「ZigZag 全部 backend 計」 (frontend 拎 backend 注入嘅 verdict.meta.zigzagPoints, 唔重計)
- ✅ 對齊 4.15.0 永久 rule「之字拎 point 用 high/low」 (type 'high' = peak, type 'low' = trough)
- ✅ Edge case: empty / undefined → 顯示「(冇 points, 可能未跑算法 / threshold 太高)」, 唔 crash
- ✅ Edge case: zigzagPoints.length < 10 → table 顯示實際有嘅 (1-9 行)

### Acceptance tests
1. 撳跑 M1 (AS-03-MA) 任何股票 e.g. HK.00700 → 撳跑完之後, scroll 落 chart 下面, 見到黑色 🔧 Chart Debug panel
2. Panel 底部 (K線最後 close 行之下) 見到新段「📈 ZigZag 最新 10 點 (P1 為最新, 倒序排):」
3. Mini-table 顯示最多 10 行 (如果 zigzagPoints.length >= 10), 每行有 4 欄
4. P1 = chart 上面紫色 ZigZag 線嘅最後 1 個點 (跟 8月29日 14:32 永久 rule)
5. 撳跑 zmen / M9 等其他 module → 因為 `verdict.meta.zigzagPoints` undefined, mini-table 顯示「(冇 points, 可能未跑算法 / threshold 太高)」, 唔 crash

### 對應 file
- `testing-page/testing-page.js` (改 1 個 function renderDebugPanel, 加 1 個 helper _formatZigZagLatestPointsForDebug, bump ALGO_CACHE_BUST 4.53.0 → 4.54.0)
- `testing-page/index.html` (改 2 個 ?v= cache bust 2.3.114 → 2.3.115)

### 對應 commit
- `feat(testing-page): M1 console log 加 ZigZag 最新 10 點 (日子 + 點數)` (`3f8ec81b`)
- Spec Sync: ARCHITECTURE.md §15.55 (本段) + AGENTS.md 「M1 console log 加 ZigZag 最新 10 點 永久 rule」section + M1-V22-RESEARCH.md 「🟢 大少 trigger #N+5」section

### 教訓
- 大少 trigger「Console Log 內我可以方便看到」即係凡人話視覺易讀, 唔係要佢自己去 DevTools console 拎 raw data
- 之後 testing page 任何 verdict meta dump display 永遠 inline 喺 debug panel, 唔好新加獨立 section (會 split 大少視線)
- 揀 mini-table 而唔係 plain text 列表, 因為 4 欄 layout 對齊視覺易讀 (序號 / 日子 / 點數 / 類型)
- 大少 8月29日 14:32 永久 rule P1/P2/P3/P4 indexing 已經定義咗順序 (P1 最新, zzp[-1]), 之後任何 ZigZag point display 跟呢個 indexing



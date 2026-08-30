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


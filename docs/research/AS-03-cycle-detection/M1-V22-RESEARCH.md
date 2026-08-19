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
**Last Updated**: 2026-08-18 06:36 (大少 trigger #10: 例出 9 個 sub-scenario 簡單算法)  
**Status**: 🚧 Research doc, 等大少逐條 review 指示


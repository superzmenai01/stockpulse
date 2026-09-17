# MODULE-BRACK-TEST.md — M1 Brack Test (v0.1.0)

> Source: 大少 2026-09-14 19:02 trigger「我想在 M1 裡加一個 Brack Test 功能」
> Implementation: 大少 2026-09-14 21:30 (initial) + 21:32 (scope error fix) + 22:04 (移到 K線圖框內最下邊)
> Status: ✅ v0.1.0 spec + implementation done
> 對應 code: `backend/algorithms/m1_brack_test/algorithm.py` v0.1.0
> 對應 plan: 見 `/Users/zmenai/.minimax/v2/sessions/2026/09/14/12-18-45-647-session_bXZzXzA1ZTA0YTEyZGM1ZTRmNzRhMGM2YTU1ZDAxODU1MzQz/artifacts/plan.md`

---

## §1 Goal (凡人話)

**對齊 M1 algorithm 之上加一層「過往 replay 測試」**, 由第 65 日開始每次加一日跑 1 次 M1 (ma_alignment), 將每次 trigger 到嘅 sub_scenario (即係 cycle ≠ sideways fallback) 結果收集起來。Frontend 用嚟喺 K 線圖上面用唔同顏色 marker 標示每次觸發, 圖下面提供 hit list 表格, 表格頂部可以切換兩種 view:

1. **按時間舊 → 新** 顯示全部 hit
2. **按 sub_scenario 分類** 揀一個 cycle 只睇嗰類 hit (圖表 marker 同步跟住過濾)

凡人話: 將 M1 對歷史每日逐日回放, 畀大少睇到「過去呢隻股票邊一日觸發咗邊個 sub_scenario」, 用嚟做 back-test 嘅 sub-scenario timeline 視覺化, 對齊 M9 back-test 嘅 spirit 但 focus 喺 sub_scenario trigger 歷史而唔係 forward return。

---

## §2 Algorithm

### Step 1: Input validation
- 拎 K 線 array + options dict (對齊 backend runner pattern, K 線由 runner 統一拎)
- K 線 < `startIndex + 1 = 66` 條 → 返 `Verdict(ok=True, points=[], meta={totalRuns: 0, ...})`, 因為 spec Sync #46 永久 rule 0 K 線 verdict 仍然 ok=True

### Step 2: Instantiate M1 algorithm
- 對齊 §Algorithm Backend-only + 模組化 永久 rule: Brack Test 唔重做 M1 logic, 改為 instantiate `MAAlignmentV2Algorithm` 跑 sub-verdict
- 對齊 §M9 back_test 內部 call M8 spirit (algo 內部可以 instantiate 另一個 algo 跑 sub-verdict, runner 統一 fetch K 線)

```python
from ..ma_alignment.algorithm import MAAlignmentV2Algorithm
m1_algo = MAAlignmentV2Algorithm()
```

### Step 3: Sub-loop 跑 M1

```python
hits: List[Dict[str, Any]] = []
total_runs = 0
skipped_runs = 0

for i in range(start_index, len(klines)):
    total_runs += 1
    trimmed = klines[: i + 1]

    try:
        m1_verdict = m1_algo.run(trimmed, options)
    except Exception as e:
        skipped_runs += 1
        continue

    if not m1_verdict or not m1_verdict.ok:
        skipped_runs += 1
        continue

    # Q1: hit filter = cycle != "sideways" (對齊 M1 priority chain spirit)
    cycle = m1_verdict.meta.get("cycle")
    if not cycle or cycle in exclude_cycles:
        continue

    # 收集 hit 記錄
    kline = klines[i]
    adjustment_log = m1_verdict.meta.get("adjustmentLog", []) or []
    reason = adjustment_log[-1] if adjustment_log else ""

    hit = {
        "date": _format_kline_date(kline),
        "time": _format_kline_date(kline),
        "index": i,
        "open": kline.get("open"),
        "high": kline.get("high"),
        "low": kline.get("low"),
        "close": kline.get("close"),
        "cycle": cycle,
        "cycleLabel": m1_verdict.meta.get("cycleLabel", ""),
        "cyclePosition": m1_verdict.meta.get("cyclePosition"),
        "cyclePositionLabel": m1_verdict.meta.get("cyclePositionLabel", ""),
        "state": m1_verdict.meta.get("state", "SIDEWAYS"),
        "confidence": m1_verdict.meta.get("confidence", 0.0),
        "reason": reason,
    }
    hits.append(hit)
```

### Step 4: 計 summary

```python
total_hits = len(hits)
hit_rate = total_hits / total_runs if total_runs > 0 else 0.0

breakdown_by_cycle = {cycle: 0 for cycle in cfg["allCycles"]}
for h in hits:
    breakdown_by_cycle[h["cycle"]] = breakdown_by_cycle.get(h["cycle"], 0) + 1

breakdown_by_state = {"UP": 0, "DOWN": 0, "SIDEWAYS": 0, "TRANSITION": 0}
for h in hits:
    state = h["state"]
    breakdown_by_state[state] = breakdown_by_state.get(state, 0) + 1
```

### Step 5: 組裝 verdict

```python
return Verdict(
    ok=True,
    points=hits,  # Frontend 直接攞返做 chart marker + 表格 rows
    meta={
        "symbol": options.get("symbol", "UNKNOWN"),
        "totalRuns": total_runs,
        "totalHits": total_hits,
        "skippedRuns": skipped_runs,
        "hitRate": round(hit_rate, 6),
        "hitRatePct": f"{hit_rate * 100:.2f}%",
        "startIndex": start_index,
        "dataWindowDays": options.get("dataWindowDays", 1260),
        "firstKlineDate": _format_kline_date(klines[0]),
        "lastKlineDate": _format_kline_date(klines[-1]),
        "breakdownByCycle": breakdown_by_cycle,
        "breakdownByState": breakdown_by_state,
        "reason": f"跑了 {total_runs} 次 M1, 觸發 {total_hits} 次 sub_scenario ({hit_rate * 100:.2f}%)",
    },
    warnings=[],
)
```

---

## §3 Verdict shape (對齊 backend emit contract)

```json
{
    "ok": true,
    "algorithm": "m1_brack_test",
    "version": "0.1.0",
    "symbol": "HK.00700",
    "period": "1d",
    "klines_count": 1260,
    "points": [
        {
            "date": "2024-03-15",
            "time": "2024-03-15",
            "index": 256,
            "displayIndex": 1,
            "open": 315.20,
            "high": 320.10,
            "low": 314.80,
            "close": 318.40,
            "cycle": "strong_uptrend",
            "cycleLabel": "強上升週期",
            "cyclePosition": "mid_stage",
            "cyclePositionLabel": "趨勢中期 (主升 / 主跌段)",
            "state": "UP",
            "confidence": 0.74,
            "reason": "強上升跡象 (大少 2026-09-04 10:34 trigger): ...",
        }
    ],
    "meta": {
        "symbol": "HK.00700",
        "totalRuns": 1195,
        "totalHits": 613,
        "skippedRuns": 4,
        "hitRate": 0.5130,
        "hitRatePct": "51.30%",
        "startIndex": 65,
        "dataWindowDays": 1260,
        "firstKlineDate": "2021-07-30",
        "lastKlineDate": "2026-09-14",
        "displaySortBy": "date_desc",
        "breakdownByCycle": {
            "strong_uptrend": 100,
            "weak_uptrend": 46,
            "bearish_initial_rise": 45,
            "strong_downtrend": 125,
            "weak_downtrend": 57,
            "bullish_initial_decline": 52,
            "uptrend_correction": 53,
            "downtrend_bounce": 112,
            "decelerating_up": 11,
            "decelerating_down": 12,
            "sideways": 0
        },
        "breakdownByState": {
            "UP": 251,
            "DOWN": 339,
            "SIDEWAYS": 23,
            "TRANSITION": 0
        },
        "reason": "跑了 1195 次 M1, 觸發 613 次 sub_scenario (51.30%)"
    },
    "warnings": [],
    "error": null
}
```

---

## §4 Chart overlay (對齊 §M3 trendline chart overlay 修復永久 rule)

### §4.1 Index 規則 (大少 2026-09-14 22:47 trigger)

**凡人話**: 不論 Brack Test 點排列 (切換 sub_scenario / mode), 第 1 row = Index 1, 由大至小排, Index 排例 Backend 做好。

**Backend 規則** (`backend/algorithms/m1_brack_test/algorithm.py` Step 3.6):
1. 計完 hits 之後, sort by `date_desc` (新 → 舊, `hits.sort(key=lambda h: h["date"], reverse=True)`)
2. 每個 hit emit `displayIndex` field = sort 後嘅 position 1..N (1 = 最新, N = 最舊)
3. Meta emit `displaySortBy: "date_desc"` 寫低 sort 規則 (對齊 §M1 sub-scenario 永久 rule「改任何 sub-scenario trigger 都要即刻 update spec doc」)
4. 對齊 §M2 self-check penalty pattern (rule 永遠寫死喺 spec doc)

**Frontend 規則** (`algorithms/AS-03-cycle-detection/adapter.mjs` `renderBrackTestHitTable`):
- Mode A (全部): 用 backend `hit.displayIndex` 顯示 (1..N global sort by date_desc)
- Mode B (揀 cycle): 用 frontend local enumerate `viewIdx + 1` 顯示 (1..M filtered view index)
- 凡人話: filtered view 入面第 1 row = Index 1 (該 cycle 最新嗰個 hit), 第 2 row = Index 2, ..., 第 M row = Index M
- 對齊大少 trigger「不論 Brack Test 怎樣排列, 最上的第一個就是 Index 1」

**Chart overlay marker label 規則** (大少 2026-09-17 13:38 trigger, v0.8.0) — `renderBrackTestChartOverlay` (adapter.mjs line 5871+) 嘅 `#N` 永遠對齊例表 Index:
- Mode A (activeCycle='all'): 用 backend global `hit.displayIndex` (1..N, 對齊例表 Index 1..N)
- Mode B (activeCycle='cycle X'): 用 frontend local `viewIdx + 1` (1..M, 對齊例表 Index 1..M)
- 凡人話: 圖中「強上升週期 #208」= Mode A global 第 208 個 hit, Mode B 應該係「強上升 #1」= filtered 第 1 個 (該 cycle 最新嗰個 hit)
- 對齊 `renderBrackTestHitTable` line 5986 一樣嘅 `isFiltered ? (viewIdx + 1) : (h.displayIndex ?? (viewIdx + 1))` pattern, 兩處 source of truth 統一
- 對齊 §Backend 永久改 emit field name 永久 rule 9月10日 23:45 spirit:frontend 唔可以假設 backend global field 直接 render 落 filter view,必先 check filter state (`isFiltered`)

**凡人話 consistency check**: 大少講「Index 第幾個」時, Mavis 即刻知:
- Mode A (全部): 第 N row = backend `hit.displayIndex = N` (global sort),chart marker label 都係 `#N`
- Mode B (揀 cycle X): 第 N row = filtered view 內第 N 個 = 該 cycle X 第 N 新 hit,chart marker label 都係 `#N`
- 凡人話 verify scope (對齊 §M3 trendline chart overlay 修復永久 rule 9月6日 16:47 凡人話肉眼 verify spirit):大少肉眼 verify chart marker #N 對應例表 row N 嘅日期 ✅

Frontend `renderBrackTestChartOverlay(verdict, klines, chartRefs, activeCycle)` (adapter.mjs line 5871) 拎 `verdict.points` array, 每個 hit 對應 1 個 marker:

```javascript
// 大少 2026-09-17 13:38 trigger v0.8.0 — chart marker label #N 對齊例表 Index
const isFilteredChart = activeCycle && activeCycle !== 'all';
const markers = filteredHits.map((h, viewIdx) => {
    const time = _brackHitToLwcTime(h);  // 統一 UTC parse (對齊 8月29日 22:35 永久 rule)
    const markerIndex = isFilteredChart
      ? (viewIdx + 1)
      : (h.displayIndex != null ? h.displayIndex : (viewIdx + 1));  // 對齊 renderBrackTestHitTable line 5986 pattern
    return {
        time,
        position: h.state === 'UP' ? 'belowBar' : h.state === 'DOWN' ? 'aboveBar' : 'inBar',
        color: ZMEN_SCENARIO_COLOR_MAP[h.cycle] || '#666',  // 11 種顏色對齊 adapter.mjs line 1398-1411
        shape: h.cycle === 'strong_uptrend' ? 'arrowUp'
             : h.cycle === 'strong_downtrend' ? 'arrowDown'
             : h.cycle === 'decelerating_up' ? 'arrowDown'
             : h.cycle === 'decelerating_down' ? 'arrowUp'
             : 'circle',
        text: (h.cycleLabel || BRACK_TEST_CYCLE_LABELS[h.cycle] || h.cycle) + ` #${markerIndex}`,  // 大少 2026-09-17 13:38 trigger — 用 markerIndex 對齊例表 Index
    };
});

// 對齊 4.49.0 永久 rule: Lightweight Charts v5 createSeriesMarkers plugin API
const handle = LightweightCharts.createSeriesMarkers(candleSeries, markers);
```

### 11 個 sub_scenario 顏色 (reuse `ZMEN_SCENARIO_COLOR_MAP`)

| cycle | 顏色 |
|---|---|
| strong_uptrend | `#1FA960` 深綠 |
| weak_uptrend | `#7DD89F` 淺綠 |
| uptrend_correction | `#A8D5BA` 淡綠 |
| sideways | `#faad14` 黃 |
| downtrend_bounce | `#F5B7B1` 淡紅 |
| weak_downtrend | `#F1948A` 淺紅 |
| strong_downtrend | `#C0392B` 深紅 |
| decelerating_up | `#8E44AD` 紫 |
| decelerating_down | `#2980B9` 藍 |
| bearish_initial_rise | `#E6B0AA` 淡紅 (跌勢初升) |
| bullish_initial_decline | `#D5F5E3` 淡綠 (升勢初跌) |

---

### §4.2 Chart marker label 對齊例表 Index (大少 2026-09-17 13:38 trigger, v0.8.0)

**凡人話**: 大少睇到圖中「強上升週期 #208」嗰個 #208 應該要對應返 BrackTest 結果例表入面嘅 Index, 即係 Mode B (揀 cycle) 嗰陣 #N = filtered view 第 N 個 (該 cycle 最新嗰個 hit 排第 1)。

**Root cause**: `adapter.mjs` `renderBrackTestChartOverlay` line 5909 (改之前) 用 backend emit 嘅 `h.displayIndex` (1..N global sort by date_desc) 顯示 chart marker text label, **無處理 mode B 揀 cycle filter 嘅 case**。Mode B 嗰陣 filtered view 嘅 Index 應該係 frontend local enumerate `viewIdx + 1` (1..M filtered), 但 chart overlay 而家仲係用 backend global index (`displayIndex`), 完全對唔上例表 Index。

凡人話對齊情況:
- ✅ Mode A (Tab A「按時間排」):Backend global `displayIndex` = 例表 Index = chart marker #N → 已對齊
- ❌ Mode B (Tab B「按 sub-scenario 揀」):Backend global `displayIndex` ≠ 例表 Index = chart marker #N → **未對齊**(大少 trigger 揭發)

**凡人話 fix** (frontend only, v0.8.0):
1. **改 `renderBrackTestChartOverlay`** line 5871+:`filteredHits.map(h => ...)` 改為 `filteredHits.map((h, viewIdx) => ...)` + 加 `isFilteredChart = activeCycle && activeCycle !== 'all'` + `markerIndex = isFilteredChart ? (viewIdx + 1) : (h.displayIndex ?? (viewIdx + 1))` + text 公式用 `markerIndex`(對齊 `renderBrackTestHitTable` line 5986 一樣 pattern, DRY spirit 兩處 source of truth 統一)
2. **加 console.log 凡人話 visual evidence** (對齊 §M3 trendline chart overlay 修復永久 rule 9月6日 16:47 spirit):log 頭尾 marker 嘅 text + `isFiltered` flag, 等大少肉眼 verify chart marker #N 對齊例表 row N 嘅日期
3. **Spec doc** §4.1 consistency check rule 段加返 chart label 對齊(之前寫 consistency check 只覆蓋例表 Index, 漏咗 chart label)
4. **Cache bust sync bump**:`5.4.18` → `5.4.19` + `?v=2.3.213` → `?v=2.3.214`

**Backend 唔需要改** — backend emit 嘅 `displayIndex` (global) 同 frontend 處理好 filter, 對齊 §Backend 永久改 emit field name 永久 rule 9月10日 23:45 spirit:frontend 唔可以假設 backend global field 直接 render 落 filter view, 必先 check filter state (`isFiltered`)

**凡人話 verify scope** (對齊 §M3 trendline chart overlay 修復永久 rule 9月6日 16:47 凡人話肉眼 verify spirit):
1. Hard reload testing page (`?v=2.3.214`)
2. 撳跑 M1 (HK.00700 騰訊 or any stock)
3. 撳「🎯 跑 Brack Test」
4. 預設 Mode B (Tab B「按 sub-scenario 揀」), activeCycle = 'strong_uptrend'
5. **肉眼 verify chart 上嘅 cycle marker text**:應該見到「強上升週期 #1」、「強上升週期 #2」...「強上升週期 #M」(M = 強上升 filtered 數量), 每個 #N 對應例表入面第 N row 嘅日期 ✅
6. 切去 Mode A (Tab A「按時間排」):應該見到「強上升週期 #208」、「下跌反彈週期 #209」(backend global index), 每個 #N 對應例表入面第 N row 嘅日期 ✅
7. 切去 Mode B + 揀另一個 cycle (e.g. 「初升」):應該見「初升週期 #1」、「初升週期 #2」...「初升週期 #M」(M = 初升 filtered 數量)
8. 撳例表 row 5 (Index 5) → chart 自動 scroll 到嗰個 marker date (對齊既有 `_brackTestRowClickHandler`) ✅
9. Backend curl evidence: `curl -s 'http://localhost:18792/api/algorithms/run?algo=m1_brack_test&symbol=HK.00700&data_window_days=1260' | jq '.points[] | select(.cycle == "strong_uptrend") | {date, displayIndex}' | head -5` → 第 1 row (date 最新) 嘅 displayIndex = global 排第 N (大數字, e.g. 208)

**永久 rule 對齊**:
- ✅ §M3 trendline chart overlay 修復永久 rule 9月6日 16:47 — chart overlay 凡人話肉眼 verify scope
- ✅ §M1 sub-scenario 永久 rule 8月16日 19:21 — 改任何 sub_scenario / display / UI 必 update spec doc (本段 §4.2 已加)
- ✅ §Backend 永久改 emit field name 永久 rule 9月10日 23:45 spirit — frontend 必先 grep 所有 reference 對齊, frontend UI categorize 永遠拎 backend emit field 優先
- ✅ §Backend hot-reload 永久 rule 8月31日 11:01 — frontend only fix, backend 唔需要 restart
- ✅ Cache bust self-check 永久 rule 21:24 — 改 adapter.mjs 必同步 bump `ALGO_CACHE_BUST` + `?v=2.3.X`
- ✅ §Mavis 自己行 9月10日 23:06 — 自己 plan + 做 + check, 有問題先問
- ✅ §凡人話 workflow 9月14日 12:10 — 凡人話解釋 trigger 條件 + verify

**對應 commit message** (待大少 trigger):
```
fix(brack-test): chart marker label #N 對齊 BrackTest 結果例表 Index (v0.8.0, 對齊大少 9月17日 13:38 trigger)

- renderBrackTestChartOverlay line 5884-5925 text formula 改用 isFiltered viewIdx+1 pattern, 對齊 renderBrackTestHitTable line 5986
- Mode A 用 backend global displayIndex, Mode B 用 frontend local viewIdx+1
- Backend 唔需要改 (frontend only fix)
- Spec doc §4.2 加 v0.8.0 entry + consistency check 段
- Cache bust sync bump: 5.4.18 → 5.4.19 + ?v=2.3.213 → ?v=2.3.214
```

---

## §5 Mode 切換 (對齊 plan §Q3 confirm)

2 個 tab 「📅 時間 / 🎯 分類」 + tab B 入面 dropdown 揀 cycle:

| Mode | 顯示 | 圖表 marker | 表格 rows |
|---|---|---|---|
| 📅 時間 (default) | 全部 hit | 11 種顏色全部 | 按時間舊 → 新 排全部 |
| 🎯 分類 + dropdown | 揀 1 個 cycle (e.g. 「強上升」) | 只顯示嗰 cycle 嘅 marker (1 種顏色) | 只顯示嗰 cycle 嘅 hit 按時間舊 → 新 排 |

### Frontend handler (adapter.mjs line 5925-6043)

- `window._brackTestRunHandler(panelId, symbol)` — 撳「🎯 跑 Brack Test」button 嗰陣 fetch backend + render chart + 表格 + summary
- `window._brackTestModeHandler(panelId, mode)` — 切 tab 「時間」/「分類」
- `window._brackTestCycleHandler(panelId, cycleValue)` — dropdown 揀 cycle 嗰陣同步過濾 chart + 表格

---

## §6 Edge cases

### K 線 < 66 條 (新股 / 細股)
- 返 `Verdict(ok=True, points=[], meta={totalRuns: 0, reason: "insufficient_klines"})`
- Frontend 顯示 summary 「跑了 0 次 M1, 觸發 0 次 sub_scenario (0.00%)」, 冇 chart marker (因為 0 hit)

### M1 verdict 唔 ok 任何 1 日
- try/except skip 嗰日, continue loop, 唔 crash 整個 Brack Test
- `meta.skippedRuns` 計數, summary 顯示 `skip N 次 (M1 verdict 唔 ok)`

### K 線 date format 多變
- Backend `_format_kline_date` helper 支持 `date` / `time` / `timestamp` 3 種 field (對齊 8月29日 22:35 evidence)
- 統一攞返 `'YYYY-MM-DD'`

### INSUFFICIENT_DATA (K 線 0 條)
- Runner 已經 handle, 返 `Verdict(ok=True, points=[], meta={reason: "insufficient_klines"}, warnings=[INSUFFICIENT_DATA])`
- Brack Test 對齊: 拎到 0 條 klines 返 empty verdict, ok=True + INSUFFICIENT_DATA warning, 唔 crash

### 5 隻 stock evidence (對齊 §M1 sub-scenario 永久 rule)

| Stock | 真名 | klines | totalHits / totalRuns (hitRatePct) | top 5 breakdown cycle |
|---|---|---|---|---|
| HK.00700 | 騰訊控股 | 1260 | 613/1195 (51.30%) | strong_downtrend 125 / downtrend_bounce 112 / strong_uptrend 100 / weak_downtrend 57 / uptrend_correction 53 |
| HK.00005 | 滙豐控股 | 275 | 95/210 (45.24%) | strong_uptrend 46 / weak_uptrend 21 / uptrend_correction 18 / bullish_initial_decline 7 / decelerating_up 3 |
| US.AAPL | 蘋果 | 332 | 179/267 (67.04%) | strong_uptrend 86 / uptrend_correction 35 / weak_uptrend 21 / strong_downtrend 13 / bullish_initial_decline 10 |
| US.MSFT | 微軟 | 332 | 141/267 (52.81%) | downtrend_bounce 35 / strong_downtrend 23 / weak_uptrend 21 / uptrend_correction 17 / bearish_initial_rise 12 |
| US.GOOGL | 谷歌-A | 332 | 131/267 (49.06%) | strong_uptrend 42 / uptrend_correction 33 / weak_uptrend 14 / bearish_initial_rise 11 / strong_downtrend 11 |

對齊 9月5日 07:27 Stock 名 evidence 永久 rule: 跑之前先 `curl /api/stocks/{code}` 拎真實全名確認。

---

## §7 Chart top banner (大少 2026-09-14 23:18 trigger)

**凡人話**: 撳「🎯 按 sub-scenario 揀」Tab + dropdown 揀指定 sub_scenario 嗰陣 (cycle ≠ 'all'), 喺 K 線圖表頂部即時顯示 1 個 banner, 用嗰個 cycle 嘅 color 做 background (`BRACK_TEST_CYCLE_COLOR_MAP`) + 白字 + 「🎯 當前顯示: 🟢 強上升 (X / Y 條)」。大少唔使 scroll 去 brack-test-panel 表格上面嘅 filter info 先知揀咗邊個 sub_scenario, chart 上面就有顯眼 visual indicator。

**位置**:
- `#brack-chart-banner` DOM element 喺 `index.html` line 184 (`#chart-container` 之前, chart-section 入面)
- Conditional render: 撳跑 M1 (`currentAdapter.id === 'AS-03-MA'`) 先 render, 撳跑其他 algo → 清返 banner (對齊 §M6 dashboard panel pattern `testing-page.js` line 1555-1574)

**Banner HTML 結構** (`renderBrackTestChartBanner` helper):
```javascript
<div class="brack-chart-banner" style="background: ${color};">
  🎯 當前顯示: <span class="cycle-color-dot" style="background:#fff;"></span>
  <strong>${_brackEscapeHtml(label)}</strong> (${filteredCount} 條 / 全部 ${totalCount} 條)
</div>
```

**Frontend handler 整合**:
- `renderBrackTestChartBanner(verdict, activeCycle)` (adapter.mjs line 5931+) — 對齊 `renderBrackTestFilterInfo` pattern (line 5919-5928) 但用 cycle 顏色 background + 白字
  - activeCycle === 'all' / falsy → 返 empty string (banner hidden)
  - 用 `_brackEscapeHtml` 處理 label (對齊 9月7日 21:50 trigger「凡新加 render function 必 escape HTML」永久 rule)
- `updateBrackTestChartBanner(verdict, activeCycle)` (adapter.mjs) — 拎 `#brack-chart-banner` DOM element + populate innerHTML, 對齊 `_ModeHandler` / `_CycleHandler` pattern (line 6055-6066, 6076-6086)
- `window._brackTestModeHandler` + `window._brackTestCycleHandler` 同步 call `updateBrackTestChartBanner(verdict, activeCycle)`, 切 tab / 揀 cycle 嗰陣 chart 上面 banner 即時更新

**對齊現有永久 rule**:
- ✅ §M3 trendline chart overlay 修復永久 rule (9月6日 16:47) — Frontend render function 永遠拎 verdict.points
- ✅ §M1 sub-scenario 永久 rule (8月16日 19:21) — spec doc 同步 update (即呢個 §7)
- ✅ HTML escape 永久 rule (9月7日 21:50) — `_brackEscapeHtml` 對齊 renderBrackTestFilterInfo pattern
- ✅ Brack Test card 加卡模式永久 rule (9月14日 21:16) — 對齊 M6 dashboard panel pattern
- ✅ Cache bust self-check 永久 rule (21:24) — testing-page.js ALGO_CACHE_BUST 5.2.6 → 5.2.7 + index.html ?v=2.3.187 → ?v=2.3.188 同步 bump
- ✅ 凡人話 visual verify (9月6日 16:47 trigger) — chart banner 對齊「肉眼 verify chart overlay」spirit

---

## 對齊永久 rule checklist

- ✅ §KlineCache full flow (8月22日 23:20 永久 rule) — Backend runner 用 cache.get_or_fetch
- ✅ §Algorithm Backend-only + 模組化 (8月22日 23:20 永久 rule) — Algo 內部 instantiate M1, 唔重做 logic
- ✅ §M9 chain rule — Algo 唔可以直接 fetch K 線, 對齊 M9 back_test 內部 call M8 spirit
- ✅ §M3 trendline chart overlay 修復永久 rule (9月6日 16:47) — render function 永遠拎 verdict.points
- ✅ §Module Warning v1.0.0 (8月11日) — verdict.warnings 永遠 inlined (Brack Test 唔 emit warning 因為內部 sub_verdict 嘅 warning 由 caller propagate)
- ✅ §Module Warning v1.1.0 (8月14日) — 2 banner 分類 (Brack Test 唔自己 emit banner, frontend caller handle)
- ✅ §Backend hot-reload 永久 rule (8月31日 11:01) — 改 backend 必 restart + curl verify
- ✅ §meta.symbol 永久 rule (9月7日 07:00) — algorithm_runner inject caller symbol 落 options, Brack Test 跟住
- ✅ §dataWindowDays 永久 rule (9月6日 23:17) — backend handler + runner 對齊 camelCase
- ✅ §Array 邏輯必先 curl evidence (8月31日 13:14) — 5 隻 stock verify 之前 curl 拎真實 K 線
- ✅ §Stock 名 evidence 永久 rule (9月5日 07:27) — 5 隻 stock verify 之前 curl `/api/stocks/{code}`
- ✅ §M1 sub-scenario 永久 rule (8月16日 19:21) — Brack Test 唔改 M1 自己嘅 trigger (只 reuse), spec doc 已新加
- ✅ §Config UX 模式 (8月19日 13:03) — 預設 1260 日, 可手動改 (frontend 自動由 lastKlines.length 拎)
- ✅ 「用『取』唔用『拎』」(8月20日 trigger) — 所有凡人話描述跟住
- ✅ 凡人話 (8月14日 19:02 trigger) — 所有凡人話描述同 spec doc
- ✅ Cache bust self-check 永久 rule (21:24) — testing-page.js ALGO_CACHE_BUST 5.1.0 → 5.2.0 + index.html ?v=2.3.180 → ?v=2.3.181 同步 bump
- ✅ Mavis 自己行, 有問題先問 (9月10日 23:06) — 大少 trigger「先理清」, plan approved 後 Mavis 自己 implement
- ✅ Status Report 4 類例表 (9月11日 11:11) — 實作時 status report 用 4 類例表
- ✅ 唔好自己特登整一鍵還原點 (9月8日 22:41) — 純粹 commit SHA, 唔 push tag
- ✅ Stock 永遠指 stockpulse.db (9月8日 17:16) — Brack Test 對齊
- ✅ §M1 card 加卡模式 (大少 2026-09-14 21:16 confirm, 22:04 移到 K線圖框內最下邊) — testing page REGISTRY 唔加新 entry, Brack Test card 對齊 §M6 dashboard panel pattern (testing-page.js line 1555-1574), 撳跑 M1 之後 testing-page.js conditional populate `#brack-test-panel` (chart-section 入面, m6-dashboard-panel 之後, result section 之前), 視線一離開 chart 即刻見到 Brack Test 入口
- ✅ **Banner init guard (大少 2026-09-15 06:55 trigger, v0.3.1)** — 撳跑 M1 但**仲未撳**「🎯 跑 Brack Test」button 嗰陣, chart banner 唔 render (hidden), 唔顯示 misleading text「(0 條 / 全部 0 條)」。Root cause: `renderBrackTestChartBanner` 拎 `hits = (verdict && verdict.points) || []`, 撳跑 M1 嗰陣 M1 verdict.points 唔存在 → empty array → filteredCount=0 + totalCount=0 → misleading banner。Fix 2 個地方: (a) `testing-page.js` line 1696 chart banner init 加 guard `if (verdict && verdict.points && verdict.points.length > 0)` 先 render banner, 否則 innerHTML = '' (hidden); (b) `adapter.mjs` `renderBrackTestChartBanner` line 6096 加 defensive guard `if (hits.length === 0) return '';` 對齊 §M3 trendline chart overlay 修復永久 rule spirit「silent return 唔 throw」, 涵蓋 `updateBrackTestChartBanner` + `_ModeHandler` / `_CycleHandler` 等所有 callers
- ✅ **Cycle tooltip 改直接簡單算法條件 (大少 2026-09-17 08:30 trigger, v0.7.0)** — Brack Test cycle banner 嘅 ⓘ icon tooltip 內容由抽象嘅「Zmen X rule (A 連續 5 日 MA5 > MA60 等) + Layer 2 全部 MA 同方向 → mid_stage, 典型多頭排列確認」寫法, 改為直接列出 backend `ma_alignment/algorithm.py` line 477-680 嘅 11 個 elif trigger 條件 (排列 / 斜率正負 / P 點方向 / 拎幾多個 P 點 / spread ≥ thresholdPct 等)。凡人話: 大少撳 banner ⓘ icon 嗰陣即刻見到呢個 cycle 嘅 trigger 條件 (e.g. 「強上升 trigger: 排列 bull (MA5 > MA10 > MA60) + 全部 MA 斜率正 + P1 > P3 (峰頂抬高) + P2 > P4 (谷底抬高) + P1/P3.type = Peak + P2/P4.type = Trough + 拎到 4 個 P 點」), 等佢可以拎呢啲直接簡單算法條件去微調 algorithm. 改動 scope: `adapter.mjs` line 6108-6130 嘅 `BRACK_TEST_CYCLE_EXPLANATIONS` 11 個 entry string 改寫 (audit backend `ma_alignment/algorithm.py` line 477-680 嘅 11 個 elif trigger 條件, 對齊真實 algorithm 行為). Backend 唔需要改 (純 frontend display string 改動). 對齊 §M1 sub-scenario 永久 rule (8月16日 19:21) sub_scenario display 改動即 update spec doc (§7 加 v0.7.0 entry + Change log v0.7.0 entry). 對齊 §Backend hot-reload 永久 rule 8月31日 11:01 — frontend only fix, backend 唔需要 restart. 對齊 cache bust self-check 永久 rule 21:24 (5.4.16 → 5.4.17 + ?v=2.3.211 → 2.3.212). 凡人話 verify scope 對齊 §M3 trendline chart overlay 修復永久 rule 9月6日 16:47 凡人話肉眼 verify spirit (大少 hard reload testing page `?v=2.3.212` + 撳跑 M1 (HK.00700) + 撳「🎯 跑 Brack Test」+ 撳 banner ⓘ icon → tooltip panel 應該見到 11 個 cycle 嘅直接簡單算法 trigger 條件). ⚠️ 條件 key (排列 / 斜率正負 / P 點方向) 唔可以隨意調, 改咗要同步改 backend `ma_alignment/algorithm.py` 同 spec doc `M1-V22-RESEARCH.md` §3-§5

---

## §7.1 Hit Row Click → Chart Pan/Zoom (大少 2026-09-15 06:45 trigger, v0.3.0)

### 凡人話

大少撳 Brack Test hit table 入面 hit row 嘅任何 cell (尤其係日期 cell) → K 線圖即時 pan + zoom 到嗰個 hit.date 喺 viewport 中間, 範圍 ≈ 3 個月 (90 日)。對齊既有 chart instance reference pattern (`window.lastChartRefs` + `window.lastKlines` testing-page.js line 1746-1754), 唔需要新加 chart 結構。

### 大少 confirm (06:46)

- **Click target**: Option 3 (撳日期 cell + 整行 hover 高亮) — click delegation 對整個 `<tr data-hit-date>` 做, 撳任何 cell 都 trigger, 日期 cell 加 hover cursor pointer + underline visual cue
- **Edge fallback**: Option 1 (用 K 線 first date 做 from) — K 線 first date 早過 hit.date - 45 days 嗰陣, from fallback 用 K 線 first date

### 凡人話 verify (對齊 §M3 trendline chart overlay 修復永久 rule 9月6日 16:47 trigger「凡人話 visual evidence」)

大少 hard reload testing page + 撳跑 M1 (HK.00700) + 撳「🎯 跑 Brack Test」button + 撳其中一個 hit row 嘅日期 cell, K 線圖即時 pan/zoom 到嗰個 hit.date 喺 viewport 中間, 範圍 ≈ 3 個月 (60-65 個交易日, 約 90 日)。Console log 印 `[Brack Test row click] pan/zoom 到 2026-XX-XX, 範圍 [YYYY-MM-DD, YYYY-MM-DD]`。

### 凡人話 edge cases

- ✅ **K 線 first date 早過 hit.date - 45 days**: from fallback 用 K 線 first date (大少 06:46 confirm Option 1)
- ✅ **K 線 last date 早過 hit.date + 45 days**: to fallback 用 K 線 last date (clip)
- ✅ **hit.date 唔喺 K 線入面 (週末/假期)**: LWC v5 setVisibleRange 自動 snap nearest trading day, 不需要 binary search
- ✅ **chart 未 init 或 K 線 missing**: silent warn + return 唔 throw (對齊 §M3 trendline chart overlay 修復永久 rule 9月6日 16:47)
- ✅ **切其他 algo**: `#brack-test-panel.innerHTML = ''` 清 hit table DOM, click delegation 仍然 attached, `event.target.closest('tr[data-hit-date]')` return null silent return
- ✅ **多次撳跑 M1**: `brackTestRowClickAttached` flag 確保 click delegation 只 attach 1 次 (避免多次 runAlgorithm 重複 trigger)

### 凡人話 UX (Option 3 大少 confirm)

- ✅ **Click delegation 對整個 `<tr data-hit-date>` 做**: 撳任何 cell 都 trigger pan/zoom (大少唔需要對準日期 cell)
- ✅ **日期 cell 加 `.brack-hit-date` class**: hover cursor pointer + underline + 紅色 `#d4380d` (Option 3 visual cue)
- ✅ **Row hover background `#ffe0b2` (淺橙) + cursor pointer**: 整行 hover 高亮 (Option 3)

### 改動 scope (4 個 file)

| # | File | 改動 |
|---|------|------|
| 1 | `algorithms/AS-03-cycle-detection/adapter.mjs` line 5933 `renderBrackTestHitTable` | 加 `<tr data-hit-date="${hit.date}">` + `<td class="brack-hit-date">` |
| 2 | `algorithms/AS-03-cycle-detection/adapter.mjs` `BRACK_TEST_PANEL_STYLE` (line 5760+) | 加 3 條 CSS rules (row hover + date cell hover + date cursor) |
| 3 | `algorithms/AS-03-cycle-detection/adapter.mjs` 新加 `_brackHitDateToChartRange` helper (line 5973+) | 計 from/to UTC timestamp + 3 個月範圍 + Option 1 fallback |
| 4 | `algorithms/AS-03-cycle-detection/adapter.mjs` 新加 `_brackTestRowClickHandler` function (line 6010+) | click delegation handler, LWC v5 setVisibleRange call |
| 5 | `algorithms/AS-03-cycle-detection/adapter.mjs` module 尾 export (line 9642+) | 加 `_brackTestRowClickHandler` named export |
| 6 | `testing-page/testing-page.js` line 798 module-level state | 加 `let brackTestRowClickAttached = false;` flag |
| 7 | `testing-page/testing-page.js` runAlgorithm handler (line 1708+) | attach click delegation 落 `#brack-test-panel`, 拎 `window.lastChartRefs` + `window.lastKlines` 對齊 line 1752-1754 pattern |
| 8 | `testing-page/testing-page.js` line 636 `ALGO_CACHE_BUST` | `5.4.2` → `5.4.3` (sync bump 對齊 21:24 cache bust self-check 永久 rule) |
| 9 | `testing-page/index.html` line 214 `?v=` | `2.3.197` → `2.3.198` (sync bump 對齊 21:24 cache bust self-check 永久 rule) |
| 10 | `docs/research/AS-03-cycle-detection/MODULE-BRACK-TEST.md` (本段) | 加 §7.1 + Change log v0.3.0 entry |

### 對齊永久 rule

- ✅ §M3 trendline chart overlay 修復永久 rule (9月6日 16:47) — chart overlay silent return 唔 throw, 凡人話肉眼 verify pan/zoom 效果
- ✅ §M1 sub-scenario 永久 rule (8月16日 19:21) — 改 hit table display 即刻 update spec doc (本段)
- ✅ HTML escape 永久 rule (9月7日 21:50) — `data-hit-date` 用 `_brackEscapeHtml` escape hit.date value
- ✅ Cache bust self-check 永久 rule (21:24) — sync bump `ALGO_CACHE_BUST` `5.4.2` → `5.4.3` + `?v=2.3.197` → `?v=2.3.198`
- ✅ §Backend hot-reload 永久 rule (8月31日 11:01) — Backend 唔需要 restart (frontend only fix)
- ✅ §Cross-module 統一 date parsing 永久 rule (8月29日 22:35) — `${hitDate}T00:00:00Z` 強制 UTC midnight, 防 backend date format 混雜

---

## §8 指定日期範圍跑功能 (大少 2026-09-15 21:05 trigger, v0.4.0)

### 凡人話

大少喺 Brack Test card 入面, 保留左邊「🎯 跑 Brack Test」button 預設全跑 5 年 (1260 日), 右邊新加日期範圍 inputs + 「執行」button 指定日期範圍跑 Brack Test。Backend algorithm 內部 filter K 線 by date_from / date_to, verdict.points 只 emit 喺範圍內嘅 hit。

### UI layout

```
[🎯 跑 Brack Test] | [日期 From 📅] → [日期 To 📅] [執行]
```

### Backend 改動 (v0.4.0)

- `backend/api/algorithms.py` line 67+: 加 `date_from` + `date_to` Optional[str] Query params, options dict 注入 `dateFrom` + `dateTo` (對齊既有 dataWindowDays pattern)
- `backend/algorithms/m1_brack_test/algorithm.py`: 加 `_parse_date_range(date_from, date_to)` + `_kline_date_ts(kline)` helper, loop 入面加 date range filter (對齊既有 skipped_runs increment pattern)
- date_from / date_to empty → fallback 全跑 (對齊既有 default behaviour)
- date_from / date_to 唔合法 → silent fallback (return (None, None)), 唔 throw 對齊 §M3 trendline chart overlay 修復永久 rule spirit

### Frontend 改動 (v0.4.0)

- `adapter.mjs` renderBrackTestCard 加 `.brack-run-row` 結構: 保留左邊 button + 右邊 date from / date to + 「執行」button
- `adapter.mjs` 新加 `_brackTestRunDateRangeHandler(panelId, symbol)` window function
- `_renderBrackTestVerdict(panel, data, symbol)` helper 拎出嚟共用, `_brackTestRunHandler` + `_brackTestRunDateRangeHandler` 2 個 handler 都 call 同一個 render function (DRY principle)
- BRACK_TEST_PANEL_STYLE 加 `.brack-date-input` + `.brack-run-date-range-btn` CSS (對齊橙色 Brack Test 主題色 #ffa726)

### Edge cases

- ✅ date_from > date_to → silent return (frontend date input validation, 後端 fallback)
- ✅ date_from 早過 K 線 first date → fallback 用 K 線 first date (Algorithm loop 自然處理)
- ✅ date_to 晚過 K 線 last date → fallback 用 K 線 last date
- ✅ date_from / date_to empty → fallback 全跑 (對齊既有 default behaviour)
- ✅ date 唔喺 K 線入面 (週末/假期) → skip (silent, 唔 emit hit 喺日)

### 凡人話 verify

凡人話 verify (對齊 §M3 trendline chart overlay 修復永久 rule 9月6日 16:47 trigger「凡人話 visual evidence」):
- 大少 hard reload testing page (`?v=2.3.200`) + 撳跑 M1 (HK.00700) + 撳「🎯 跑 Brack Test」button → baseline (全跑, 對齊既有 v0.3.1 行為)
- 撳 date_from + date_to inputs 揀指定日期範圍 + 撳「執行」button → K 線圖 marker + 表格 + summary 全部對應 date_from / date_to 範圍內 hit
- 凡人話肉眼 verify chart marker 只 render 喺 date_from / date_to 範圍內 hit + table 只顯示範圍內 hit

### 對齊永久 rule

- ✅ §M3 trendline chart overlay 修復永久 rule (9月6日 16:47) — silent return 唔 throw, 凡人話肉眼 verify
- ✅ §M1 sub-scenario 永久 rule (8月16日 19:21) — 改任何 sub_scenario display 即刻 update spec doc
- ✅ HTML escape 永久 rule (9月7日 21:50) — date inputs 用 `_brackEscapeHtml` escape (雖然 date input value 係 ISO format, 但兜底 escape 防意外)
- ✅ Cache bust self-check 永久 rule (21:24) — sync bump ALGO_CACHE_BUST + ?v= parameter
- ✅ §Backend hot-reload 永久 rule (8月31日 11:01) — Backend 改咗需要 restart (`./start.sh`) + curl verify
- ✅ §Cross-module 統一 date parsing 永久 rule (8月29日 22:35) — UTC midnight 統一 date parsing
- ✅ §Backend 永久改 emit field name 之後 frontend 必先 grep 全 reference 對齊永久 rule (9月10日 23:45) — options dict 永久改 dateFrom + dateTo frontend 必先 grep 全 reference
- ✅ DRY principle spirit — 拎 render logic 拎出嚟共用, 2 個 handler 只係 fetch 嘅 url 唔同

---

## §8.1 指定日期範圍完整重跑功能 (大少 2026-09-15 21:37 trigger, v0.4.1 修正 v0.4.0)

### 凡人話

大少喺 21:37 trigger 澄清「Brack Test 指定日期不只是重跑 Brack Test, 那是整個 K 線圖和 Brack Test 都按指定的日期內重新再跑」。凡人話 v0.4.0 implementation 只改 Brack Test verdict filter 唔對齊真正 spirit, v0.4.1 修正:

- **右邊「執行」button** (v0.4.1 修正): 撳咗之後, **重新 fetch K 線** (filtered by date_from ~ date_to, 透過 `start` + `end` query params 對齊 api/kline.py line 47 既有 pattern), **重新 render chart** (K 線 reset, chart overlay reset), **重新 fetch M1 verdict** (用 filtered K 線), **重新 fetch Brack Test verdict** (用 filtered K 線), **重新 render chart overlay** (cycle marker reset), **重新 render chart banner** + **cycle legend**
- **左邊「🎯 跑 Brack Test」button** (unchanged): 用返預設全跑 5 年 (1260 日), 對齊既有 v0.3.1 行為

### UI layout

```
[🎯 跑 Brack Test] | [日期 From 📅] → [日期 To 📅] [執行]
```

### Backend 改動 (v0.4.1)

- `backend/api/kline.py` line 47: **已有** `start` + `end` Query params (凡人話 v0.4.1 唔需要新加 `date_from` + `date_to`, 因為 KlineCache `get_or_fetch` 已經 support `start`/`end` 拎 filtered K 線 line 144-145)
- `backend/services/kline_cache.py` KlineCache `get_or_fetch`: **已有** support `start` + `end` 拎 filtered K 線 (line 144-145)
- `backend/algorithms/m1_brack_test/algorithm.py`: **Revert v0.4.0 改動**, 拎走 `_parse_date_range` + `_kline_date_ts` + loop date range filter (因為 frontend testing-page.js fetch K 線嗰陣已經 add `start` + `end` query params, KlineCache 自然拎 filtered K 線, frontend 拎到嘅 klines 已經 filtered, algorithm 唔需要再 filter)
- `backend/api/algorithms.py`: 保留 v0.4.0 `date_from` + `date_to` Query params (algorithm 入面拎 `options.get("dateFrom")` 等於 None 嘅時候 fallback 全跑, silent return 對齊 §M3 永久 rule spirit; frontend唔傳 date params backend 唔需要 reject, fallback 接受)

### Frontend 改動 (v0.4.1)

- `testing-page.js`: `runAlgorithm(dateFrom, dateTo)` 拎 optional args, fetch K 線嗰陣 add `start` + `end` query params (mapping dateFrom → start, dateTo → end), expose 落 `window._runAlgorithmWithDateRange = function(dateFrom, dateTo) { return runAlgorithm(dateFrom, dateTo); }`
- `adapter.mjs` `_brackTestRunDateRangeHandler`: 改成 trigger `window._runAlgorithmWithDateRange(dateFrom, dateTo)` (透過 window global), 唔再自己 fetch verdict + render (對齊 v0.4.1 真正 spirit)
- `adapter.mjs` `_renderBrackTestVerdict`: 保留 (因為 testing-page.js `_runAlgorithmMain` 內部會 call `_renderBrackTestVerdict` 拎 chart overlay)

凡人話: 凡人話 plan v0.4.1 嘅 frontend refactor 對齊 DRY principle spirit (testing-page.js 主流程共用, 唔再 adapter.mjs 自己 fetch verdict)。

### Edge cases (v0.4.1)

- ✅ date_from > date_to → silent fallback (frontend date input validation + backend silent return)
- ✅ date_from 早過 K 線 first date → K-line Cache 自然 fallback (對齊既有 INSUFFICIENT_DATA pattern)
- ✅ date_to 晚過 K 線 last date → K-line Cache 自然 fallback
- ✅ date_from / date_to empty → silent warn (frontend validation), 唔 trigger fetch
- ✅ date_from / date_to 唔合法 → K-line Cache `get_or_fetch` 拎 K 線失敗 → silent fallback (return empty), 對齊 §M3 永久 rule spirit

### 凡人話 verify

凡人話 verify (對齊 §M3 trendline chart overlay 修復永久 rule 9月6日 16:47 trigger「凡人話 visual evidence」):
- 大少 hard reload testing page (`?v=2.3.201`) + 撳跑 M1 (HK.00700) → baseline (全跑 5 年, 對齊既有 v0.3.1 行為)
- 撳 date_from + date_to inputs 揀 [2026-09-01, 2026-09-15] + 撳「執行」button
- K 線圖 K 線只 render [2026-09-01, 2026-09-15] 範圍內 (大約 10 條 K 線) ✅
- Chart overlay (ZigZag 紫色線 + P 點 marker + 鮮紫觸發點 marker + Brack Test cycle marker) 全部 reset, 只 render 範圍內 ✅
- M1 verdict reset, verdict.points 用 filtered K 線 ✅
- Brack Test verdict reset, verdict.points 用 filtered K 線 (範圍內 emit, 對齊 v0.4.0 嘅 hit count) ✅
- Chart banner + cycle legend reset ✅

### 對齊永久 rule

- ✅ §M3 trendline chart overlay 修復永久 rule (9月6日 16:47) — silent return 唔 throw, 凡人話肉眼 verify
- ✅ §M1 sub-scenario 永久 rule (8月16日 19:21) — 改任何 sub_scenario display 即刻 update spec doc
- ✅ HTML escape 永久 rule (9月7日 21:50) — date inputs 用 `_brackEscapeHtml` escape
- ✅ Cache bust self-check 永久 rule (21:24) — sync bump ALGO_CACHE_BUST + ?v= parameter
- ✅ §Backend hot-reload 永久 rule (8月31日 11:01) — Backend 改咗需要 restart (`./start.sh`) + curl verify
- ✅ §K-line Cache 永久 rule (8月22日 23:20) — 「Frontend 拎 data, Backend 拎 K 線」, K 線 filtered 喺 K-line Cache layer
- ✅ §Cross-module 統一 date parsing 永久 rule (8月29日 22:35) — UTC midnight 統一 date parsing
- ✅ §Backend 永久改 emit field name 之後 frontend 必先 grep 全 reference 對齊永久 rule (9月10日 23:45) — options dict 永久改 dateFrom + dateTo frontend 必先 grep 全 reference
- ✅ DRY principle spirit — testing-page.js 主流程共用, 唔再 adapter.mjs 自己 fetch verdict

---

## §8.3 ZigZag 沒有重跑 fix + audit 其他 chart overlay 來源 (大少 2026-09-15 22:27 trigger, v0.4.3)

### 凡人話

大少 trigger「在指定日期內跑 Brack Test 但發現 zigzag 和 P 點 沒有重跑, 再檢查還有那些是溜了的」。凡人話 investigation 拎 root cause + audit 所有 chart overlay 來源確認邊啲 reset 邊啲漏咗。

### Root cause: ZigZag verdict hardcode 5 年 K 線

`testing-page.js` line 154-178 `fetchBackendZigZag` 入面 **hardcode `data_window_days: '1260'` (5 年)** + 唔 add `date_from`/`date_to` query params, 所以撳「執行」button 之後, chart 已經 reset (filtered, 11 條 K 線), 但係 ZigZag verdict 仍然拎 5 年嘅 points, 紫色 ZigZag 線 + P 點 marker 嘅 `time` 唔喺 chart visible range 內, 大少睇唔到 = 「冇重跑」。

### Audit 其他 chart overlay 來源

凡人話 plan v0.4.1 嘅 audit 確認所有 chart overlay 來源, 邊啲 reset 邊啲漏咗:

| 來源 | K 線 reset? | Reset 機制 | 漏咗? |
|---|---|---|---|
| K 線圖 candlestick | ✅ reset | testing-page.js line 1583 `renderChart(klines, code, period)` + line 1896-1899 dispose 舊 chart | ❌ |
| M1 verdict (`/api/algorithms/run?algo=m1`) | ✅ reset | runAlgorithm line 1591-1600 fetch verdict, `data_window_days` 用 `klines.length` (filtered) | ❌ |
| MA 線 (MA5/MA10/MA20/MA60) | ✅ reset | `renderMAAlignmentV2ChartOverlay` line 1840 call, 拎 `lastVerdict.meta` 嘅 MA lines (對齊 filtered K 線) | ❌ |
| 鮮紫觸發點 marker (4.66.0 spec) | ✅ reset | 拎 `lastVerdict.meta` 嘅 trigger points | ❌ |
| 鮮綠 extension line (4.53.0 spec) | ✅ reset | 拎 `lastVerdict.meta.lastExtensionClose` | ❌ |
| Brack Test verdict | ✅ reset | `_renderBrackTestVerdict` line 1838-1850 | ❌ |
| Brack Test cycle marker (chart overlay) | ✅ reset | `renderBrackTestChartOverlay` 拎 filtered verdict | ❌ |
| Chart banner + Cycle legend | ✅ reset | `renderBrackTestChartBanner` + cycle legend grid init | ❌ |
| **ZigZag verdict + 紫線 + P 點 marker** | ❌ **漏咗** | `fetchBackendZigZag` hardcode `data_window_days=1260` + 冇 date_from/date_to, 拎 5 年嘅 ZigZag verdict | ✅ **漏咗** |

凡人話 plan v0.4.3 嘅 fix 對齊 §K-line Cache 永久 rule (8月22日 23:20) spirit「Frontend 拎 data, Backend 拎 K 線」 — frontend testing-page.js 將 filtered K 線 range (dateFrom/dateTo) + length 傳落 backend ZigZag algorithm 拎 filtered ZigZag verdict。

### Fix (v0.4.3)

- **`fetchBackendZigZag(code, period, thresholdMode, manualThreshold, lookback, multiplier, signal, dateFrom, dateTo, dataWindowDays)`** 加 3 個 optional args
- **Fetch URL** add `start` + `end` query params (對齊 backend api/algorithms.py start/end 既有 pattern, 對齊 §Cross-module 統一 date parsing 永久 rule 8月29日 22:35 trigger)
- **Fetch URL** `data_window_days` 用 caller value (filtered K 線 length), 唔再 hardcode 1260
- **`fetchAndInjectBackendZigZag(thresholdMode, manualThreshold, lookback, multiplier, dateFrom, dateTo, dataWindowDays)`** 加 3 個 args + 傳落 `fetchBackendZigZag`
- **`runAlgorithm(dateFrom, dateTo)`** line 1599 call site 加 3 個 args (從 runAlgorithm scope 拎 `dateFrom`/`dateTo`/`klines.length`)

### Backend 唔需要改

凡人話 v0.4.3 只改 frontend (testing-page.js), backend ZigZag algorithm `backend/algorithms/zigzag/algorithm.py` 已經拎 `klines` 計 ZigZag verdict, 因為 backend 已經 support `start`/`end` 拎 filtered K 線 (api/kline.py line 47, KlineCache `get_or_fetch` line 144-145), frontend 傳 dateFrom/dateTo/dataWindowDays 之後 backend 自動拎 filtered ZigZag verdict。

凡人話 backend 唔需要 restart (frontend only fix), 對齊 §Backend hot-reload 永久 rule (8月31日 11:01)。

### 凡人話 verify (對齊 §M3 永久 rule 凡人話肉眼 verify spirit)

- 大少 hard reload testing page (`?v=2.3.202`) + 撳跑 M1 (HK.00700) → baseline (對齊 v0.4.1 行為)
- 撳 date_from + date_to inputs 揀 [2026-09-01, 2026-09-15] + 撳「執行」button
- 紫色 ZigZag 線 render 喺 [2026-09-01, 2026-09-15] 範圍內, 對齊 filtered K 線 ✅
- P 點 marker (鮮綠 + 鮮紫) 對齊 filtered K 線, 唔再係 5 年嘅 points 喺 chart visible range 外 ✅
- 其他 chart overlay (MA 線 / 鮮綠 extension line / Brack Test cycle marker) 對齊 filtered K 線 ✅

### 對齊永久 rule

- ✅ §M3 trendline chart overlay 修復永久 rule (9月6日 16:47) — silent return 唔 throw, 凡人話肉眼 verify
- ✅ §M1 sub-scenario 永久 rule (8月16日 19:21) — 改任何 sub_scenario display 即刻 update spec doc
- ✅ Cache bust self-check 永久 rule (21:24) — sync bump ALGO_CACHE_BUST + ?v= parameter
- ✅ §K-line Cache 永久 rule (8月22日 23:20) — 「Frontend 拎 data, Backend 拎 K 線」, K 線 filtered 喺 KlineCache layer
- ✅ §Cross-module 統一 date parsing 永久 rule (8月29日 22:35) — `start` + `end` YYYY-MM-DD 格式
- ✅ §Backend hot-reload 永久 rule (8月31日 11:01) — Backend 唔需要 restart (frontend only fix)
- ✅ DRY principle spirit — frontend testing-page.js 主流程共用

### §8.3.1 (附加 fix) 後端 K 線冷啟動 silent fallback (對齊 §M3 永久 rule spirit)

凡人話 plan v0.4.2 spirit 對齊 §M3 trendline chart overlay 修復永久 rule (9月6日 16:47) 「silent return 唔 throw」, 因為之前大少 trigger 過類似嘅 console error 但 plan mode active 之前我冇 implement, 大少 22:27 trigger「再檢查還有那些是溜了的」spirit 包 v0.4.2 silent fallback fix, v0.4.3 commit 一齊做埋。

- **Backend `api/kline.py` line 211-221 已經 silent fallback** (try/except return empty klines array), 唔需要改
- **Frontend `testing-page.js` line 1518 `throw error` 改 `silent fallback + return`**: 對齊 §M3 永久 rule spirit「silent return 唔 throw」
- `runStatus.innerHTML` 顯示 friendly error message
- `resultPanel.innerHTML` 顯示建議 (Retry / Check FutuOpenD / Check stock code)
- `console.warn` 而唔係 `console.error`

---

## §8.4 Backend runner 拎 caller start/end (大少 2026-09-16 06:16 trigger, v0.4.4 修正 v0.4.3 漏網之魚)

### 凡人話

大少 trigger screenshot「這是 00700 跑指定時間的結果, 你可以看到 zigzag 線和 P 點是把超出 K 線範圍的跑了, 那是因為之前跑的殘留了下來, 這個 Zigzag 線和 P 點都必須根據新範圍的 K 線再重新跑」。

凡人話 v0.4.3 commit `e2aad32f` 已改咗 frontend `fetchBackendZigZag` 傳 `start` + `end` query params, 但是 **backend `algorithm_runner.py` line 125-137 拎 K 線 hardcode `today - calendar_days_back` + `today`, 完全忽略 frontend 傳嘅 `start`/`end` params**。

### Audit evidence (curl)
- `algo=zigzag` baseline (no date) — 215 個 points, 5 年 (2021-08-02 ~ 2026-09-15) ✅
- `start=2026-09-01&end=2026-09-15&data_window_days=11` — klines_count=11, ZigZag points 對齊範圍 ✅ (因為 calendar_days_back=180 日 back, 拎 180 日 K 線取尾 11 條)
- `start=2026-05-01&end=2026-08-31&data_window_days=100` — **klines_count=100, 但 ZigZag points date range 2026-04-24 ~ 2026-09-15 (超出 start date)** ❌ — 因為 backend runner 拎 180 日 back K 線, 唔對齊 frontend start

### 凡人話 fix (v0.4.4)

`backend/services/algorithm_runner.py` line 125-137:
- 拎 caller 嘅 `dateFrom` + `dateTo` 從 `options.get(...)` 覆蓋 `start_date` + `end_date`
- silent fallback: caller 冇傳 → 用既有 `today - calendar_days_back` default (對齊 §M3 永久 rule spirit)
- frontend 不需要改 (v0.4.3 commit 已經傳 start/end)
- backend api/algorithms.py 不需要改 (v0.4.0 commit 已經 pass date_from/date_to 落 options dict)

### 凡人話 verify (對齊 §M3 永久 rule凡人話肉眼 verify spirit)

凡人話 verify (大少 hard reload testing page + 撳 date inputs 揀 [2026-05-01, 2026-08-31] + 撳「執行」button):
- Curl backend `/api/algorithms/run?algo=zigzag&...&start=2026-05-01&end=2026-08-31` → ZigZag points date range **2026-05-01 ~ 2026-08-31** ✅ (對齊 frontend 傳嘅 range)
- 大少睇 chart 入面 ZigZag 紫線 + P 點 marker 全部對齊 filtered K 線, 唔再超出 K 線 range ✅

### 對齊永久 rule

- ✅ §K-line Cache 永久 rule (8月22日 23:20) — 「Frontend 拎 data, Backend 拎 K 線」, K 線 filtered 喺 KlineCache layer, backend runner 拎 caller start/end
- ✅ §M3 trendline chart overlay 修復永久 rule (9月6日 16:47) — silent return 唔 throw, 凡人話肉眼 verify
- ✅ §M1 sub-scenario 永久 rule (8月16日 19:21) — 改任何 sub_scenario display 即刻 update spec doc
- ✅ Cache bust self-check 永久 rule (21:24) — sync bump ALGO_CACHE_BUST + ?v= parameter
- ✅ §Backend hot-reeload 永久 rule (8月31日 11:01) — Backend 改咗需要 restart (`./start.sh`) + curl verify
- ✅ §Cross-module 統一 date parsing 永久 rule (8月29日 22:35) — UTC midnight 統一 date parsing (frontend 傳嘅 date_from/date_to 已經係 YYYY-MM-DD 格式)

---

## §8.5 Backend `/api/algorithms/run` 兼容 ZigZag `start` + `end` Query params (大少 2026-09-16 06:37 trigger, v0.4.5 修正 v0.4.4 漏網之魚)

### 凡人話

大少 trigger「還是有問題, 你先確認 Ziagzag 的點和 P 點都是必須從後台拿取的, 確保前台只是根據後台及出的點而畫出線來」。

凡人話 v0.4.4 commit `28269285` 已 fix backend runner 拎 caller start/end (對齊 §K-line Cache 永久 rule spirit), 但係 frontend `testing-page.js` `fetchBackendZigZag` line 235 fetch URL 用 `start=${dateFrom}&end=${dateTo}` (legacy ChartContainer.tsx naming), 但 backend `/api/algorithms/run` Query params 只拎 `date_from` + `date_to` (legacy Brack Test pattern) — **兩個 caller naming 唔對齊, backend silent fallback 拎 default 5 年 K 線, emit 5 年 ZigZag points, frontend 拎錯 points 仍然超出 K 線 range**。

### Audit evidence (curl v0.4.4 fix #1 之後仍然有 bug)

凡人話 dual source of truth 確認:
- ✅ **Frontend 100% 用 backend** (testing-page.js line 47-66 永久 rule 拎走 frontend calculateZigZagFrontend, fetch `/api/algorithms/run?algo=zigzag` 唯一 source)
- ✅ **Backend emit source**: `backend/algorithms/zigzag/algorithm.py` `run_zigzag()` (1-to-1 port frontend 算法, 拎 klines + 計 points)
- ✅ **Runner v0.4.4 (commit 28269285)** line 141-146 拎 caller `dateFrom`/`dateTo` → `start_date`/`end_date` → `cache.get_klines(...)` 拎 filtered K 線

凡人話 Curl evidence (v0.4.4 commit 之後仍然有 bug):
- `algo=zigzag` baseline (no date) — 215 points 5 年 ✅
- `start=2026-05-01&end=2026-08-31` — **19 points, 2026-04-24 ~ 2026-09-15 超出範圍** ❌ (backend api/algorithms.py 拎唔到 frontend start/end, silent fallback 拎 5 年)
- `start=2026-09-01&end=2026-09-15` — 3 points ✅ (因為 caller end=2026-09-15 對齊 today, stale check 唔 trigger warm cache path)

### Root cause 確認

- **Frontend** `testing-page.js` line 235 fetch URL: `start=${dateFrom ? `&start=${dateFrom}` : ''}${dateTo ? `&end=${dateTo}` : ''}` (legacy ChartContainer.tsx naming)
- **Backend** `api/algorithms.py` Query params 之前只拎 `date_from` + `date_to` (legacy Brack Test pattern, v0.4.1 commit 落)
- **兩個 naming 唔對齊** → backend silent fallback → 拎 5 年 K 線 → emit 5 年 ZigZag points → frontend chart 對齊 filtered K 線但 ZigZag 紫線 + P 點超出

### 凡人話 fix (v0.4.5)

`backend/api/algorithms.py`:
- **新加 `start` + `end` Query params** (line 75-90) 對齊 frontend fetchBackendZigZag naming (legacy ChartContainer.tsx pattern)
- **保留 `date_from` + `date_to` Query params** 對齊 legacy Brack Test pattern (v0.4.1 commit 落, Brack Test frontend 仍用緊)
- **兼容 logic** (line 156-168): `effective_date_from = start or date_from`, `effective_date_to = end or date_to` — caller 傳邊個拎邊個, 同時兼容兩種 naming
- frontend 不需要改 (已經傳 start + end)
- backend runner 不需要改 (v0.4.4 commit 已經拎 caller dateFrom + dateTo)

### 凡人話 verify (對齊 §M3 永久 rule凡人話肉眼 verify spirit)

凡人話 verify (curl backend 3 tests):
- Curl 1 baseline (`algo=zigzag`, no date) — 215 points, 5 年 (2021-08-02 ~ 2026-09-15), `meta.klines_count=1260` ✅
- Curl 2 (`start=2026-05-01&end=2026-08-31`) — **13 points, 全部喺 [2026-05-01, 2026-08-31] 範圍內** (2026-05-04 ~ 2026-08-28), `meta.klines_count=84` ✅ (v0.4.4 commit 之前係 19 points 超出範圍, 而家 13 points 100% 對齊 filtered K 線)
- Curl 3 (`start=2026-09-01&end=2026-09-15`) — 3 points, 對齊 (2026-09-01 ~ 2026-09-15), `meta.klines_count=11` ✅

凡人話肉眼 verify (對齊 §M3 永久 rule 凡人話肉眼 verify spirit):
- 大少 hard reload testing page (`?v=2.3.203`) + 撳跑 M1 (HK.00700) + 撳 date inputs 揀 [2026-05-01, 2026-08-31] + 撳「執行」button → K 線圖 K 線只 render 範圍內 + ZigZag 紫線 + P 點 marker 對齊 filtered K 線, 唔再超出 K 線 range ✅

### 對齊永久 rule

- ✅ **§K-line Cache 永久 rule spirit「Frontend 拎 data, Backend 拎 K 線」最嚴格詮釋** (大少 9月16日 06:37 trigger 確認) — ZigZag points + P 點 emit 嘅唯一 source of truth 必須係 backend, frontend 只負責根據 emit 嘅 points 畫 chart overlay
- ✅ §Backend hot-reeload 永久 rule (8月31日 11:01) — Backend 改咗需要 restart (`./start.sh`) + curl verify
- ✅ §M3 trendline chart overlay 修復永久 rule (9月6日 16:47) — silent return 唔 throw, 凡人話肉眼 verify
- ✅ §Backend 永久改 emit field name 之後 frontend 必先 grep 全 reference 對齊永久 rule (9月10日 23:45) spirit — backend 加 Query params 影響 frontend fetch URL naming, 必須 verify frontend 傳嘅 params 同 backend 拎嘅 params 一致
- ✅ §M1 sub-scenario 永久 rule (8月16日 19:21) — 改任何 sub_scenario display 即刻 update spec doc (§8.5 新加)

---

## §8.6 Brack Test 指定日期 date inputs 保留 user 揀過嘅 value (大少 2026-09-16 07:21 trigger, v0.5.0)

### 凡人話

大少 trigger「撳完 Brack Test 指定日期後,date inputs 嘅 value 會 reset 返做空,要保留我揀過嘅日期」。凡人話:大少揀咗 date_from + date_to 撳「執行」之後,adapter.mjs `renderBrackTestCard` 重新 render 個 panel → date input DOM 重新 create 冇 value → 大少揀過嘅日期消失咗,大少要再揀過先可以再撳「執行」。

### Root cause

`adapter.mjs` `renderBrackTestCard` 嘅 date inputs HTML 寫死 `value=""`,而 `runAlgorithm` 之後重新 call `renderBrackTestCard(verdict)` → 個 HTML template 重新 render → 個 input DOM 重新 create,新 DOM 冇 value → 大少揀過嘅日期永遠 reset。

### 凡人話 fix (v0.5.0)

`adapter.mjs`:
- **module-level state** (line 6243-6244):`let lastBrackDateFrom = ''; let lastBrackDateTo = '';` 保留 user 揀過嘅 date
- **`_brackTestDateInputChange(field, value)` window function** (line 6258+):大少改 date input 即時 sync 落 state,等下次 `renderBrackTestCard` 重新 render 嗰陣 restore 返
- **`renderBrackTestCard` date inputs** (line 5795-5797):加 `value="${lastBrackDateFrom}"` + `value="${lastBrackDateTo}"` + `onchange="window._brackTestDateInputChange('from', this.value)"` + `oninput="window._brackTestDateInputChange('from', this.value)"` 即時 sync
- **`_brackTestRunDateRangeHandler`** (line 6324-6325):撳「執行」之前同步 `lastBrackDateFrom = dateFrom || ''; lastBrackDateTo = dateTo || '';`

對齊 §Config UX 模式 (2026-08-19 13:03)「自動+手動+自動儲存更新圖表」— user 揀過嘅 value 永遠要保留,唔好因為 re-render 失。

### 凡人話 verify

大少 hard reload testing page (`?v=2.3.204`) + 撳跑 M1 (HK.00700) + date inputs 揀 [2026-09-01, 2026-09-15] + 撳「執行」 → 肉眼 verify date inputs 仲係 [2026-09-01, 2026-09-15] (唔 reset)。再撳「🎯 跑 Brack Test」button (左邊全跑) → Brack Test card re-render → date inputs 仲係 [2026-09-01, 2026-09-15]。

### 對齊永久 rule

- ✅ §Config UX 模式 (2026-08-19 13:03) — user 揀過嘅 value 永遠要保留
- ✅ §Backend hot-reload 永久 rule (8月31日 11:01) — frontend only fix, backend 唔需要 restart
- ✅ cache bust self-check 永久 rule 21:24 — sync bump ALGO_CACHE_BUST + ?v=2.3.X

---

## §8.7 Frontend button event-leak bug fix (大少 2026-09-16 07:27 trigger, v0.5.1)

### 凡人話

大少 trigger「撳完指定日期後再撳『跑算法』撞 PointerEvent error」。凡人話:之前 commit `f0b0af91` 同 commit `760f28ba` 嘅 v0.5.0 fix 入面,撳「跑算法」button 之後 backend log 印 `start=[object PointerEvent]`,前端 verdict 唔 render 因為 backend 拎唔到 K 線。

### Root cause

`testing-page.js` 嘅 `runBtn.addEventListener('click', runAlgorithm)` 寫法,event listener 默認傳 `(event)` 做 first arg,`runAlgorithm` signature 第一個 param `dateFrom = PointerEvent` (truthy object),`dateRangeParams` 變咗 `&start=[object PointerEvent]`,backend silent fail 因為「format of code is wrong」類似嘅 fallback error。

### 凡人話 fix (v0.5.1)

`testing-page.js`:
- **3 個 addEventListener 改用 arrow function wrap** (對齊 DRY + 安全):
  - `runBtn.addEventListener('click', () => runAlgorithm())` (line 2081)
  - `runFullChainBtn.addEventListener('click', () => runFullChain())` (line 2889)
  - `addTradeJournalEntry btn.addEventListener('click', () => addTradeJournalEntry())` (line 3436)
- arrow function `() => runAlgorithm()` wrap 避免 PointerEvent event-leak

對齊 §M3 silent return 唔 throw spirit — silent fallback fix,v0.5.1 之後 backend log 唔再印 `start=[object PointerEvent]`。

### 凡人話 verify

大少 hard reload testing page (`?v=2.3.205`) + 撳跑 M1 (HK.00700) + 撳 Brack Test 指定日期跑 → 撳「執行」OK → 撳返「跑算法」button → verdict 正常 render (之前 backend log 印 `start=[object PointerEvent]` + 返 0 條 K 線)。

### 對齊永久 rule

- ✅ §M3 silent return 唔 throw spirit — silent fallback + console.warn 而唔係 console.error
- ✅ §Backend hot-reload 永久 rule (8月31日 11:01) — frontend only fix, backend 唔需要 restart
- ✅ cache bust self-check 永久 rule 21:24 — sync bump ALGO_CACHE_BUST + ?v=2.3.X
- ✅ 新永久 rule (對齊 §M3 trendline chart overlay 修復永久 rule spirit) —「Frontend button event listener 永遠 wrap arrow function 避免 event object 漏入 function args」

---

## §8.8 Brack Test 指定日期範圍 Brack Test verdict render fix (大少 2026-09-16 17:08 trigger, v0.5.2)

### 凡人話

大少 trigger「修改,現在只有 K 線圖和 Zigzag,但沒有 Brack Test,在指定的日期內跑是要包括 Brack Test」。凡人話:之前 v0.5.0/v0.5.1 commit 修咗 date inputs 保留 + PointerEvent event-leak,但指定日期範圍跑嗰陣 `_runAlgorithmWithDateRange` 只 fetch M1 verdict (ma_alignment),testing-page.js line 1699-1702 render Brack Test card 用 M1 verdict 但 M1 verdict.points 空 → Brack Test hit table / summary / chart banner 全部 empty,大少睇唔到指定日期範圍嘅 Brack Test verdict。

### Root cause

`testing-page.js` line 1699-1702 嘅 render Brack Test card panel skeleton 用 M1 verdict (空 points) display,因為 `_runAlgorithmWithDateRange` 只 fetch M1 verdict,唔 fetch Brack Test verdict。

### 凡人話 fix (v0.5.2)

`adapter.mjs` `_brackTestRunDateRangeHandler` (line 6345-6358):
- **自己 fetch Brack Test verdict** (對齊 `_brackTestRunHandler` 全跑 line 6262-6275 pattern):喺 `_runAlgorithmWithDateRange` 之後 fetch `m1_brack_test` algo 帶 `start + end` query params
- **call `_renderBrackTestVerdict` 共用 render helper** 寫入 panel
- 對齊 §K-line Cache 永久 rule (8月22日 23:20) — K 線 filtered 喺 KlineCache layer, frontend testing-page.js 拎 data,backend runner 拎 options.get("dateFrom") / options.get("dateTo") 落 start_date / end_date

### 凡人話 verify

大少 hard reload testing page (`?v=2.3.206`) + 撳跑 M1 (HK.00700) + 撳 date inputs 揀 [2026-09-01, 2026-09-15] + 撳「執行」 → Brack Test verdict re-fetched,hit table / summary / chart banner 全部對齊 filtered range。

### 對齊永久 rule

- ✅ §K-line Cache 永久 rule (8月22日 23:20) — Frontend 拎 data, Backend 拎 K 線
- ✅ §M3 silent return 唔 throw spirit — silent fallback + console.warn
- ✅ §Backend hot-reload 永久 rule (8月31日 11:01) — frontend only fix, backend 唔需要 restart
- ✅ cache bust self-check 永久 rule 21:24 — sync bump ALGO_CACHE_BUST + ?v=2.3.X

---

## §8.9 Brack Test 指定日期 ±1 日快速調整 UI (大少 2026-09-16 17:23 trigger, v0.5.3)

### 凡人話

大少 trigger「在指定日期 Brack Test 的『執行』制右邊,加上兩個功能制,第一個是把現在的 Brack Test 減一日,第二個是把現在的 Brack Test 加一日,同樣地要把正個 K 線圖, Zigzag 線, P 點, Brack Test, 都要再重新跑一編」。

凡人話:大少揀咗一個 date range 睇緊 Brack Test 結果,想快速睇前後一日嘅 Brack Test 結果,而唔需要再手動改 date inputs,符合 §Config UX 模式 (2026-08-19 13:03)「自動+手動+自動儲存更新圖表」spirit — ±1 日制就係「手動」嘅快捷掣。

### UI layout

```
[🎯 跑 Brack Test] | [日期 From 📅] → [日期 To 📅] [執行] [◀ -1 日] [+1 日 ▶]
```

6 個元素順序排成 1 行,2 個 ±1 日制喺「執行」右邊,用 ◀ ▶ 視覺 hint。

### 凡人話 fix (v0.5.3)

`adapter.mjs`:
- **新加 CSS class `.brack-shift-date-btn`** (`BRACK_TEST_PANEL_STYLE` line 5771+):橙色主題色 #ffa726 對齊 `.brack-run-date-range-btn` spirit,hover #ff9800 + disabled #ccc
- **renderBrackTestCard date row** (line 5802+):加 2 個 `<button class="brack-shift-date-btn">`,onclick 帶 `delta=-1` / `delta=+1` 參數,text 為 `◀ -1 日` / `+1 日 ▶`
- **新加 `_brackShiftDate(isoDate, deltaDays)` helper** (line 6268+):UTC midnight 統一 (對齊 §Cross-module 統一 date parsing 永久 rule 8月29日 22:35) — `new Date(isoDate + 'T00:00:00Z').setUTCDate(getUTCDate() + delta)` → `toISOString().slice(0, 10)`
- **新加 `window._brackTestShiftDateHandler(panelId, symbol, delta)`** (line 6401+):DRY spirit — 共用 1 個 handler,2 個 button 帶不同 `delta` param,完整 13 個 steps:
  1. 拎 date inputs value (即係 user 之前揀過嘅最新 value,對齊 v0.5.0 module-level state pattern)
  2. 兩個 empty → console.warn + return (edge case a)
  3. Date arithmetic: newFrom/newTo = _brackShiftDate(dateFrom/dateTo, delta)
  4. 拎 K 線 first date + last date (從 `window.lastKlines` 拎,對齊 v0.5.2 pattern)
  5. Boundary check: newFrom < K-line first date / newTo > K-line last date / newFrom > newTo → console.warn + return
  6. Sync state `lastBrackDateFrom/To = newFrom/newTo` (對齊 v0.5.0 pattern line 6324-6325)
  7. Update input DOM `input.value = newFrom/newTo` (即時 visual feedback)
  8. Disable 3 個 button (`-1 日` / `+1 日` / `執行`) 避免 double-click
  9. Trigger `window._runAlgorithmWithDateRange(newFrom, newTo)` (對齊 v0.5.2 pattern line 6334-6337)
  10. Fetch Brack Test verdict (對齊 v0.5.2 line 6345-6358):`/api/algorithms/run?algo=m1_brack_test&symbol=${symbol}&data_window_days=${dataWindowDays}&start=${newFrom}&end=${newTo}`
  11. Call `_renderBrackTestVerdict(panel, data, symbol)` 共用 render helper
  12. Re-enable 3 個 button + 更新 text
  13. Catch error: silent fallback + console.warn + result panel innerHTML 顯示 friendly error

`testing-page.js`:
- `ALGO_CACHE_BUST` bump `5.4.11` → `5.4.12`

`testing-page/index.html`:
- `?v=2.3.206` → `?v=2.3.207`

### Backend 改動 (v0.5.3)

無。Frontend only fix,backend algorithm / API / runner 完全唔改。

### Edge cases (凡人話 UX)

| Case | Trigger | 行為 |
|------|---------|------|
| 兩個 date 都 empty | Fresh page load + 撳 ±1 日 | console.warn + return + 唔 trigger (date inputs 唔變) |
| 撳 -1 越過 K 線 first date | newFrom < K-line first date | console.warn + return + 唔 trigger |
| 撳 +1 越過 K 線 last date | newTo > K-line last date | console.warn + return + 唔 trigger |
| 撳 -1 之後 from > to | newFrom > newTo | console.warn + return + 唔 trigger (e.g. K 線 first date = 2021-08-02, date range = [2021-08-03, 2021-08-05], 撳 -1 → [2021-08-02, 2021-08-04], 再撳 -1 → [2021-08-01, 2021-08-03] 越界) |
| Network error / backend error | Fetch fail / verdict.ok = false | try/catch + console.warn + result panel 顯示 friendly error (對齊 v0.4.3 silent fallback fix) |

### 凡人話 verify

凡人話 manual verify:
- 大少 hard reload testing page (`?v=2.3.207`) + 撳跑 M1 (HK.00700) + 撳「🎯 跑 Brack Test」→ baseline 5 年 hit
- Date inputs 揀 [2026-09-01, 2026-09-15] + 撳「執行」 → K 線 + ZigZag + P 點 + Brack Test 全部 reset 對齊
- 撳「◀ -1 日」制 → date inputs 變 [2026-08-31, 2026-09-14],K 線 + ZigZag + P 點 + Brack Test verdict 全部 re-fetched 對齊新 range
- 撳「+1 日 ▶」制 → date inputs 變 [2026-09-01, 2026-09-15] (返到之前)
- Edge case: K 線 first date = 2021-08-02,date range = [2021-08-03, 2021-08-05],撳「◀ -1 日」2 次,第 2 次 console.warn + 唔 trigger

Curl backend verify: `curl 'http://localhost:18792/api/algorithms/run?algo=m1_brack_test&symbol=HK.00700&start=2026-08-31&end=2026-09-14'` → verdict.points 對齊 [2026-08-31, 2026-09-14] 範圍 (對齊 v0.4.5 line 75-90 Query params)。

### 對齊永久 rule

- ✅ §Config UX 模式 (2026-08-19 13:03) — 自動+手動+自動儲存更新圖表
- ✅ §Cross-module 統一 date parsing 永久 rule (8月29日 22:35) — YYYY-MM-DD format + UTC midnight
- ✅ §K-line Cache 永久 rule (8月22日 23:20) — Frontend 拎 data, Backend 拎 K 線
- ✅ §M3 trendline silent return 唔 throw spirit — edge case silent warn
- ✅ §Backend hot-reload 永久 rule (8月31日 11:01) — frontend only fix, backend 唔需要 restart
- ✅ §M1 sub-scenario 永久 rule (8月16日 19:21) — 改任何 sub_scenario display 即刻 update spec doc
- ✅ cache bust self-check 永久 rule 21:24 — sync bump ALGO_CACHE_BUST + ?v=2.3.X
- ✅ DRY principle spirit — 共用 1 個 handler `_brackTestShiftDateHandler(panelId, symbol, delta)`,2 個 button 帶不同 `delta` param
- ✅ Re-use `_runAlgorithmWithDateRange` (v0.5.2 已實證 work 嘅 helper) — 對齊 testing-page.js 主流程共用 spirit

---

## §8.10 Brack Test ±1 日制 boundary check 改 auto-clamp + 永遠 re-run (大少 2026-09-16 20:39 trigger, v0.5.4 修正 v0.5.3 漏網之魚)

### 凡人話

大少 trigger「我指定的 Bracktest 日期是 2000-1-1 至 2026-8-7，但 console log: [Brack Test ±1 日] 撳完後 from (1999-12-31) 早過 K 線第一日 (2021-06-23), 唔 trigger. 這個問題在時間上是全錯了，你要找回當時 K 線的時間 Range 才可以做到加一日或減一日」。

凡人話:大少揀咗一個 date range 但係越界實際 K 線範圍(例如揀 `2000-01-01` 但 K 線 first date 係 `2021-06-23` 因為 `dataWindowDays=1260` default 5 年)。v0.5.3 boundary check 越界就 silent warn + return 唔 trigger re-run,所以大少撳 ±1 日制永遠都唔 work,console 永遠印「唔 trigger」。

### Root cause 確認

- v0.5.3 `window._brackTestShiftDateHandler` line 6448-6460 boundary check 用「越界 → silent warn + return」邏輯
- 大少 date range `[2000-01-01, 2026-08-07]` 但 K 線 actual range `[2021-06-23, 2026-08-07]`(因 `dataWindowDays=1260` default 5 年)
- 撳 `-1` 日 → `newFrom = 1999-12-31` < K 線 first `2021-06-23` → silent warn + return(永遠唔 trigger)
- 撳 `+1` 日 → `newFrom = 2000-01-02` < K 線 first → silent warn + return(永遠唔 trigger)
- 大少 console log: `[Brack Test ±1 日] 撳完後 from (1999-12-31) 早過 K 線第一日 (2021-06-23), 唔 trigger` ×6 次

### 凡人話 fix (v0.5.4)

**Root cause** v0.5.3 假設 user 輸入 date range 永遠喺 K 線範圍內,但實際 user 可能揀越界 date(特別係 stale state 留低嘅 date 輸入)。

**Fix** v0.5.4 boundary check 改為「auto-clamp + 永遠 re-run」:
- K 線 first date / last date 係 authoritative source (對齊 §K-line Cache 永久 rule spirit)
- 如果 `newFrom < K 線 first date` → auto-clamp `newFrom = K 線 first date` + console.log 提示「已 auto-clamp from 落 K 線 first date」
- 如果 `newTo > K 線 last date` → auto-clamp `newTo = K 線 last date` + console.log 提示「已 auto-clamp to 落 K 線 last date」
- 永遠 trigger `_runAlgorithmWithDateRange(newFrom, newTo)` + fetch Brack Test verdict + re-enable button
- Edge case (b) `newFrom > newTo`(極端 case: 兩個 date 都越界 clamp 落同一個 K 線 date)保留 silent warn + return

`adapter.mjs` `window._brackTestShiftDateHandler` line 6448+ 改 auto-clamp 邏輯(凡人話):

```js
// Step 5: Auto-clamp date 落 K 線範圍 (大少 2026-09-16 trigger — K 線 range 永遠係 authoritative source)
let autoClamped = false;
if (newFrom && newFrom < firstKlineDate) {
  console.log(`[Brack Test ±1 日] from (${newFrom}) 早過 K 線第一日 (${firstKlineDate}), auto-clamp → ${firstKlineDate}`);
  newFrom = firstKlineDate;
  autoClamped = true;
}
if (newTo && newTo > lastKlineDate) {
  console.log(`[Brack Test ±1 日] to (${newTo}) 遲過 K 線最後一日 (${lastKlineDate}), auto-clamp → ${lastKlineDate}`);
  newTo = lastKlineDate;
  autoClamped = true;
}
// Edge case (b) — from > to (極端 case) → silent warn + return
if (newFrom && newTo && newFrom > newTo) {
  console.warn(`[Brack Test ±1 日] 撳完後 from (${newFrom}) > to (${newTo}), 唔 trigger`);
  return;
}
if (autoClamped) {
  console.log(`[Brack Test ±1 日] auto-clamp 完, new from=${newFrom}, new to=${newTo}, re-run K 線 + ZigZag + P 點 + Brack Test verdict`);
}
```

### Backend 改動 (v0.5.4)

無。Frontend only fix,backend algorithm / API / runner 完全唔改。

### Edge cases (凡人話 UX) — v0.5.4 改進

| Case | Trigger | v0.5.3 行為 | v0.5.4 行為 (改進) |
|------|---------|------------|-------------------|
| 兩個 date 都 empty | Fresh page load + 撳 ±1 日 | console.warn + return | 唔變(console.warn + return) |
| 撳 -1 越過 K 線 first date | newFrom < K-line first date | console.warn + return + 唔 trigger | **auto-clamp newFrom = K 線 first date + console.log + re-run** ✅ |
| 撳 +1 越過 K 線 last date | newTo > K-line last date | console.warn + return + 唔 trigger | **auto-clamp newTo = K 線 last date + console.log + re-run** ✅ |
| 撳 -1 之後 from > to | 兩個 date 都越界 clamp 落同一個 K 線 date | n/a (之前邊界已 silent warn return) | 保留 silent warn + return(邏輯錯誤) |
| Network error / backend error | Fetch fail / verdict.ok = false | try/catch + console.warn + result panel 顯示 friendly error | 唔變 |

### 凡人話 verify (v0.5.4)

凡人話 manual verify:
- 大少 hard reload testing page (`?v=2.3.208`) + 撳跑 M1 (HK.00700) + 撳「🎯 跑 Brack Test」→ baseline 5 年 hit
- Date inputs 揀 [2000-01-01, 2026-08-07](越界 K 線 first date `2021-06-23`) + 撳「執行」→ re-fetch OK
- 撳「◀ -1 日」制 → console.log 印 `[Brack Test ±1 日] from (1999-12-31) 早過 K 線第一日 (2021-06-23), auto-clamp → 2021-06-23` + date input 變 `2021-06-23` + re-run K 線 + ZigZag + P 點 + Brack Test verdict
- 撳「+1 日 ▶」制 → console.log 印 `[Brack Test ±1 日] from (2000-01-02) 早過 K 線第一日 (2021-06-23), auto-clamp → 2021-06-23` + `[Brack Test ±1 日] to (2026-08-08) 遲過 K 線最後一日 (2026-08-07), auto-clamp → 2026-08-07` + date inputs 變 [2021-06-23, 2026-08-07] + re-run

Curl backend verify: `curl 'http://localhost:18792/api/algorithms/run?algo=m1_brack_test&symbol=HK.00700&start=2021-06-23&end=2026-08-07&data_window_days=1260'` → verdict.points 對齊 [2021-06-23, 2026-08-07] 範圍 (對齊 v0.4.5 line 75-90 Query params)。

### 對齊永久 rule

- ✅ §Config UX 模式 (2026-08-19 13:03) — 自動+手動+自動儲存更新圖表(±1 日制永遠 work,即使 date 越界都 auto-clamp 落 K 線範圍)
- ✅ §Cross-module 統一 date parsing 永久 rule (8月29日 22:35) — YYYY-MM-DD format + UTC midnight
- ✅ §K-line Cache 永久 rule (8月22日 23:20) — K 線 first/last date 係 authoritative source
- ✅ §M3 silent return 唔 throw spirit — extreme edge case (from > to) 保留 silent warn
- ✅ §Backend hot-reload 永久 rule (8月31日 11:01) — frontend only fix, backend 唔需要 restart
- ✅ §M1 sub-scenario 永久 rule (8月16日 19:21) — 改任何 sub_scenario display 即刻 update spec doc
- ✅ cache bust self-check 永久 rule 21:24 — sync bump ALGO_CACHE_BUST + ?v=2.3.X
- ✅ DRY principle spirit — 共用 1 個 handler `_brackTestShiftDateHandler(panelId, symbol, delta)`,2 個 button 帶不同 `delta` param
- ✅ Re-use `_runAlgorithmWithDateRange` (v0.5.2 已實證 work 嘅 helper)

---

## §8.11 Brack Test ±1 日制 改單邊 modify (大少 2026-09-16 20:50 trigger, v0.5.5 修正 v0.5.4)

### 凡人話

大少 trigger「現在減一日是對的,但加一日是錯的,你是修改了 From Date,應該是修改 To Date」。

凡人話:大少撳「◀ -1 日」期望 extend left boundary(修改 from 而 to 唔變),撳「▶ +1 日」期望 extend right boundary(修改 to 而 from 唔變)。v0.5.4 ±1 日制都係 from + to 雙邊 modify(整體移一日),大少 accept ◀ -1 日 但 reject ▶ +1 日(因為大少 expect +1 只 modify to,唔應該 modify from)。

### Root cause 確認

- v0.5.4 `window._brackTestShiftDateHandler` Step 3 line 6428-6446 用「from + to 雙邊 modify」邏輯:
  - 撳「◀ -1 日」:`newFrom = from - 1`,`newTo = to - 1`(from + to 都 -1,整體向前移一日)
  - 撳「▶ +1 日」:`newFrom = from + 1`,`newTo = to + 1`(from + to 都 +1,整體向後移一日)
- 大少 case date [2000-01-01, 2026-08-07],K 線 [2021-06-23, 2026-08-07]:
  - 撳「◀ -1 日」:`newFrom = 1999-12-31 → auto-clamp → 2021-06-23`,`newTo = 2026-08-06`(from auto-clamp + to -1 仲喺範圍)→ date range [2021-06-23, 2026-08-06](向前移一日) ✅
  - 撳「▶ +1 日」:`newFrom = 2000-01-02 → auto-clamp → 2021-06-23`,`newTo = 2026-08-08 → auto-clamp → 2026-08-07`(from + to 都 auto-clamp)→ date range 仲係 [2021-06-23, 2026-08-07](完全冇 effect,因為 from + to 都已經喺 K 線邊界)❌ 大少 reject
- 大少 feedback:「+1 應該修改 to date」,即係 +1 日只 modify to,from 唔變。

### 凡人話 fix (v0.5.5)

**Fix** v0.5.5 Step 3 logic 改**單邊 modify**:
- ◀ -1 日 → `newFrom = from - 1`,`newTo = to`(to 唔變),if `newFrom < K 線 first date` → auto-clamp + re-run (v0.5.4 spirit 保留)
- ▶ +1 日 → `newTo = to + 1`,`newFrom = from`(from 唔變),if `newTo > K 線 last date` → auto-clamp + re-run (v0.5.4 spirit 保留)

`adapter.mjs` `window._brackTestShiftDateHandler` Step 3 改單邊 modify 邏輯(凡人話):

```js
// Step 3: Date arithmetic — 單邊 modify (大少 2026-09-16 20:50 trigger v0.5.5)
let newFrom = '';
let newTo = '';
if (delta < 0) {
  // ◀ -1 日 — extend left boundary (modify from only)
  if (dateFrom) {
    try {
      newFrom = _brackShiftDate(dateFrom, delta);
      newTo = dateTo;  // to 唔變
    } catch (e) {
      console.warn(`[Brack Test ±1 日] dateFrom (${dateFrom}) 唔合法, 唔 trigger:`, e);
      return;
    }
  } else {
    console.warn(`[Brack Test ±1 日] dateFrom empty, 唔 trigger (-1 日需要 from 存在)`);
    return;
  }
} else if (delta > 0) {
  // ▶ +1 日 — extend right boundary (modify to only)
  if (dateTo) {
    try {
      newTo = _brackShiftDate(dateTo, delta);
      newFrom = dateFrom;  // from 唔變
    } catch (e) {
      console.warn(`[Brack Test ±1 日] dateTo (${dateTo}) 唔合法, 唔 trigger:`, e);
      return;
    }
  } else {
    console.warn(`[Brack Test ±1 日] dateTo empty, 唔 trigger (+1 日需要 to 存在)`);
    return;
  }
}
```

Step 5 auto-clamp 邏輯 v0.5.4 spirit 保留(對齊 §K-line Cache 永久 rule spirit):
- 如果 `newFrom < K 線 first date` → auto-clamp `newFrom = K 線 first date` + console.log 提示
- 如果 `newTo > K 線 last date` → auto-clamp `newTo = K 線 last date` + console.log 提示
- 永遠 trigger `_runAlgorithmWithDateRange(newFrom, newTo)` + fetch Brack Test verdict + re-enable button

### Backend 改動 (v0.5.5)

無。Frontend only fix,backend algorithm / API / runner 完全唔改。

### Edge cases (凡人話 UX) — v0.5.5 改進

| Case | Trigger | v0.5.4 行為 | v0.5.5 行為 (改進) |
|------|---------|------------|-------------------|
| 兩個 date 都 empty | Fresh page load + 撳 ±1 日 | console.warn + return | 唔變(console.warn + return) |
| 撳 ◀ -1 日 dateFrom empty | Fresh page load + 撳 ◀ -1 日 | -1 日修改 empty from → newFrom = '', silent fail | console.warn `dateFrom empty, 唔 trigger (-1 日需要 from 存在)` + return |
| 撳 ▶ +1 日 dateTo empty | Fresh page load + 撳 ▶ +1 日 | +1 日修改 empty to → newTo = '', silent fail | console.warn `dateTo empty, 唔 trigger (+1 日需要 to 存在)` + return |
| 撳 ◀ -1 日 dateFrom 越界 firstKlineDate | dateFrom < K-line first date | auto-clamp + re-run | 唔變(auto-clamp `newFrom = K 線 first date` + console.log + re-run) ✅ |
| 撳 ▶ +1 日 dateTo 越界 lastKlineDate | dateTo > K-line last date | auto-clamp + re-run | 唔變(auto-clamp `newTo = K 線 last date` + console.log + re-run) ✅ |
| 撳 ±1 日之後 from > to | 兩個 date 都越界 | 保留 silent warn + return | 唔變 |

### 凡人話 verify (v0.5.5)

凡人話 manual verify:
- 大少 hard reload testing page (`?v=2.3.209`) + 撳跑 M1 (HK.00700) + 撳「🎯 跑 Brack Test」→ baseline 5 年 hit
- date inputs 揀 [2000-01-01, 2026-08-07](越界 K 線 first date `2021-06-23`) + 撳「執行」→ re-fetch OK
- 撳「◀ -1 日」制 → console.log 印 `[Brack Test ±1 日] from (1999-12-31) 早過 K 線第一日 (2021-06-23), auto-clamp → 2021-06-23` + date input from 變 `2021-06-23` + date input to 仲係 `2026-08-07` + re-run K 線 + ZigZag + P 點 + Brack Test verdict
- 撳「▶ +1 日 ▶」制 → console.log 印 `[Brack Test ±1 日] to (2026-08-08) 遲過 K 線最後一日 (2026-08-07), auto-clamp → 2026-08-07` + date input from 仲係 `2021-06-23` + date input to 仲係 `2026-08-07` + re-run
- date inputs 揀 [2026-09-01, 2026-09-15](from 喺 K 線範圍內,to 越界 lastKlineDate) + 撳「執行」→ re-fetch OK
- 撳「◀ -1 日」制 → `newFrom = 2026-08-31`(from - 1, 唔越界 firstKlineDate),`newTo = 2026-09-15`(to 唔變)→ re-run
- 撳「▶ +1 日 ▶」制 → `newFrom = 2026-08-31`(from 唔變),`newTo = 2026-09-16` > `lastKlineDate` → auto-clamp `newTo = 2026-08-07` + console.log + re-run

### 對齊永久 rule

- ✅ §Config UX 模式 (2026-08-19 13:03) — ±1 日制單邊 extend date range(◀ extend left,▶ extend right)
- ✅ §Cross-module 統一 date parsing 永久 rule (8月29日 22:35) — YYYY-MM-DD format + UTC midnight
- ✅ §K-line Cache 永久 rule (8月22日 23:20) — K 線 first/last date 係 authoritative source (v0.5.4 auto-clamp spirit 保留)
- ✅ §M3 silent return 唔 throw spirit — extreme edge case (from > to / date 唔合法 / date empty) 保留 silent warn
- ✅ §Backend hot-reload 永久 rule (8月31日 11:01) — frontend only fix, backend 唔需要 restart
- ✅ §M1 sub-scenario 永久 rule (8月16日 19:21) — 改任何 sub_scenario display 即刻 update spec doc
- ✅ cache bust self-check 永久 rule 21:24 — sync bump ALGO_CACHE_BUST + ?v=2.3.X
- ✅ DRY principle spirit — 共用 1 個 handler `_brackTestShiftDateHandler(panelId, symbol, delta)`,2 個 button 帶不同 `delta` param
- ✅ Re-use `_runAlgorithmWithDateRange` (v0.5.2 已實證 work 嘅 helper)

---

## §8.12 Brack Test ±1 日制 簡化邏輯 (大少 2026-09-16 20:59 trigger, v0.5.6 簡化 v0.5.5)

### 凡人話

大少 reject v0.5.5 trigger「你很差啊,現在加一日和減一日都用不了,其他可以簡單處理,你只要吧 To Date 改變一日,然後再跑一次就可以了」。

凡人話:v0.5.5 嘅單邊 modify(◀ modify from / ▶ modify to)太複雜,兩個制都唔 work(可能 dateFrom / dateTo empty trigger silent warn,或者 date 唔合法,或者 from > to 邊界 case)。大少要最簡單 logic:兩個制(◀ -1 日 / ▶ +1 日)都係 modify to date 一日,from 永遠唔變,然後 re-run。

### Root cause 確認

- v0.5.5 `_brackTestShiftDateHandler` Step 3 line 6441-6474 用「單邊 modify」邏輯:
  - ◀ -1 日 → `newFrom = from - 1`, `newTo = to`(to 唔變),if dateFrom empty → silent warn + return
  - ▶ +1 日 → `newTo = to + 1`, `newFrom = from`(from 唔變),if dateTo empty → silent warn + return
- 大少 case date [2000-01-01, 2026-08-07]:
  - 撳 ◀ -1 日 → `newFrom = 1999-12-31 → auto-clamp → 2021-06-23`,`newTo = 2026-08-06`,date range 變 [2021-06-23, 2026-08-06](from auto-clamp + to -1 仲喺範圍)→ 應該 work
  - 撳 ▶ +1 日 → `newFrom = 2000-01-02 → auto-clamp → 2021-06-23`,`newTo = 2026-08-08 → auto-clamp → 2026-08-07`,date range 仲係 [2021-06-23, 2026-08-07](完全冇 effect)→ 但 date input from 由 2000-01-01 變 2021-06-23(visible)
- 大少 feedback:「現在加一日和減一日都用不了」 — 唔 work 嘅可能原因:
  1. dateFrom / dateTo empty(因為 user 之前 session 留低 stale state)
  2. date 唔合法
  3. from > to 邊界 case
  4. console error / network error

### 凡人話 fix (v0.5.6)

**Fix** v0.5.6 Step 3 logic **簡化** — 兩個制都用同一個 modify to date logic:
- ◀ -1 日 → `newTo = to - 1`, `newFrom = from`(from 永遠唔變)
- ▶ +1 日 → `newTo = to + 1`, `newFrom = from`(from 永遠唔變)
- 永遠 trigger `_runAlgorithmWithDateRange(newFrom, newTo)` + fetch Brack Test verdict + re-enable button

`adapter.mjs` `window._brackTestShiftDateHandler` Step 3 簡化邏輯(凡人話):

```js
// Step 3: Date arithmetic — 簡單邏輯 (大少 20:59 trigger v0.5.6 簡化 v0.5.5)
let newFrom = dateFrom;  // from 永遠唔變
let newTo = '';
if (dateTo) {
  try {
    newTo = _brackShiftDate(dateTo, delta);
  } catch (e) {
    console.warn(`[Brack Test ±1 日] dateTo (${dateTo}) 唔合法, 唔 trigger:`, e);
    return;
  }
} else {
  console.warn(`[Brack Test ±1 日] dateTo empty, 唔 trigger (±1 日需要 to 存在)`);
  return;
}
```

Step 5 auto-clamp 邏輯 v0.5.4 spirit 保留(對齊 §K-line Cache 永久 rule spirit):
- 如果 `newTo < K 線 first date` → auto-clamp `newTo = K 線 first date` + console.log 提示
- 如果 `newTo > K 線 last date` → auto-clamp `newTo = K 線 last date` + console.log 提示
- 永遠 trigger `_runAlgorithmWithDateRange(newFrom, newTo)` + fetch Brack Test verdict + re-enable button

### Backend 改動 (v0.5.6)

無。Frontend only fix,backend algorithm / API / runner 完全唔改。

### Edge cases (凡人話 UX) — v0.5.6 簡化

| Case | Trigger | v0.5.5 行為 | v0.5.6 行為 (簡化) |
|------|---------|------------|-------------------|
| 兩個 date 都 empty | Fresh page load + 撳 ±1 日 | console.warn + return | 唔變(console.warn + return) |
| dateTo empty | Fresh page load + 撳 ±1 日(只 dateFrom 有 value) | -1 日要 dateFrom, +1 日要 dateTo → 兩種 silent warn | 統一 silent warn `dateTo empty, 唔 trigger (±1 日需要 to 存在)` + return ✅ |
| dateTo 唔合法 | dateTo format 唔啱 | console.warn + return | 唔變(console.warn + return) |
| newTo 越界 firstKlineDate | dateTo < K-line first date | auto-clamp + re-run | 唔變(auto-clamp `newTo = K 線 first date` + console.log + re-run) ✅ |
| newTo 越界 lastKlineDate | dateTo > K-line last date | auto-clamp + re-run | 唔變(auto-clamp `newTo = K 線 last date` + console.log + re-run) ✅ |
| from > to | 兩個 date 都越界 | 保留 silent warn + return | 唔變(silent warn + return) |
| Network error / backend error | Fetch fail / verdict.ok = false | try/catch + console.warn + result panel 顯示 friendly error | 唔變 |

### 凡人話 verify (v0.5.6)

凡人話 manual verify:
- 大少 hard reload testing page (`?v=2.3.210`) + 撳跑 M1 (HK.00700) + 撳「🎯 跑 Brack Test」→ baseline 5 年 hit
- date inputs 揀 [2000-01-01, 2026-08-07](越界 K 線 first date `2021-06-23`) + 撳「執行」→ re-fetch OK
- 撳「◀ -1 日」制 → `newTo = 2026-08-06`(to - 1),`newFrom = 2000-01-01`(from 唔變)+ date input to 變 `2026-08-06`, date input from 仲係 `2000-01-01` + re-run K 線 + ZigZag + P 點 + Brack Test verdict ✅
- 撳「▶ +1 日 ▶」制 → `newTo = 2026-08-08 → auto-clamp → 2026-08-07`,`newFrom = 2000-01-01`(from 唔變)+ date input to 仲係 `2026-08-07`, date input from 仲係 `2000-01-01` + re-run ✅
- date inputs 揀 [2026-09-01, 2026-09-15](from 喺 K 線範圍內,to 越界 lastKlineDate) + 撳「執行」→ re-fetch OK
- 撳「◀ -1 日」制 → `newTo = 2026-09-14`(to - 1, 越界 lastKlineDate) → auto-clamp → `2026-08-07` + console.log + re-run
- 撳「▶ +1 日 ▶」制 → `newTo = 2026-09-16` > `lastKlineDate` → auto-clamp → `2026-08-07` + console.log + re-run

### 對齊永久 rule

- ✅ §Config UX 模式 (2026-08-19 13:03) — ±1 日制最簡單 logic(兩個制都 modify to date)
- ✅ §Cross-module 統一 date parsing 永久 rule (8月29日 22:35) — YYYY-MM-DD format + UTC midnight
- ✅ §K-line Cache 永久 rule (8月22日 23:20) — K 線 first/last date 係 authoritative source (v0.5.4 auto-clamp spirit 保留)
- ✅ §M3 silent return 唔 throw spirit — edge case (empty / 唔合法 / from > to) 保留 silent warn
- ✅ §Backend hot-reload 永久 rule (8月31日 11:01) — frontend only fix, backend 唔需要 restart
- ✅ §M1 sub-scenario 永久 rule (8月16日 19:21) — 改任何 sub_scenario display 即刻 update spec doc
- ✅ cache bust self-check 永久 rule 21:24 — sync bump ALGO_CACHE_BUST + ?v=2.3.X
- ✅ DRY principle spirit — 共用 1 個 handler `_brackTestShiftDateHandler(panelId, symbol, delta)`,2 個 button 帶不同 `delta` param
- ✅ Re-use `_runAlgorithmWithDateRange` (v0.5.2 已實證 work 嘅 helper)

---

## §8.13 Brack Test ±1 日制 拎走 v0.5.4 auto-clamp logic (大少 2026-09-16 21:15 reject v0.5.6, v0.5.7 修正 v0.5.6 嘅 from auto-clamp bug)

### 凡人話

大少 reject v0.5.6 trigger「點解你改來改去做係有問題,還是『多一日』的功能不能用」+ console log evidence `[Brack Test ±1 日] from (2010-01-01) 早過 K 線第一日 (2021-06-22), auto-clamp → 2021-06-22`。

凡人話:v0.5.6 嘅 Step 3 已經係最簡單邏輯(只 modify to,from 唔變),但 v0.5.4 嘅 Step 5 auto-clamp logic 仲 trigger from modify(因為 user 輸入嘅 `2010-01-01` 越界 K 線 first `2021-06-22`)。大少要嘅最簡單邏輯:**拎走 from + to auto-clamp**,只 modify to date + re-run,Backend KlineCache fetch K 線會自動用 K 線 actual range。

大少 trigger「改好了後要做測試,無問題才交給我」—所以 v0.5.7 fix 完之後必先自己 verify,先交畀大少(對齊 9月10日 23:06「自己行」永久 rule spirit)。

### Root cause 確認

- v0.5.6 `_brackTestShiftDateHandler` Step 3 line 6441-6456 已是最簡單邏輯:
  - `newFrom = dateFrom`(from 唔變)
  - `newTo = _brackShiftDate(dateTo, delta)`(兩個制都 modify to)
- 但 v0.5.4 Step 5 line 6479-6499 嘅 auto-clamp logic 仲 trigger from modify:
  ```js
  if (newFrom && newFrom < firstKlineDate) {
    newFrom = firstKlineDate;  // ❌ 修改 from
    autoClamped = true;
  }
  if (newTo && newTo > lastKlineDate) {
    newTo = lastKlineDate;  // ❌ 修改 to
    autoClamped = true;
  }
  ```
- 大少 case date `[2010-01-01, 2026-08-06]`,K 線 `[2021-06-22, 2026-08-06]`,撳 ▶ +1 日:
  - Step 3:`newFrom = 2010-01-01`(唔變),`newTo = 2026-08-07`(to + 1,越界 lastKlineDate)
  - Step 5 auto-clamp 觸發:
    - `from (2010-01-01) < K 線 first (2021-06-22)` → auto-clamp `newFrom = 2021-06-22`(❌ 大少 reject 因為 modify from)
    - `to (2026-08-07) > K 線 last (2026-08-06)` → auto-clamp `newTo = 2026-08-06`(❌ 大少 reject 因為 modify to)
  - date range 變 `[2021-06-22, 2026-08-06]`,date input from 由 `2010-01-01` 變 `2021-06-22`(visible 修改)
- 大少 feedback:「你只要吧 To Date 改變一日,然後再跑一次就可以了」+「改好了後要做測試,無問題才交給我」

### 凡人話 fix (v0.5.7)

**Fix** v0.5.7 Step 5 logic **拎走 from + to auto-clamp**:
- 兩個制(◀ -1 日 / ▶ +1 日)都係 modify to date,from 永遠唔變
- Backend KlineCache fetch K 線會自動用 K 線 actual range(越界 date 唔影響 verdict,因為 KlineCache layer 已經 handle `start` + `end` query params)
- 對齊 §Config UX 模式 spirit (2026-08-19 13:03) — user 揀過嘅 value 永遠要保留,唔好 auto-clamp date input

`adapter.mjs` `window._brackTestShiftDateHandler` Step 5 拎走 auto-clamp 邏輯(凡人話):

```js
// Step 5: 拎走 v0.5.4 嘅 from + to auto-clamp logic (大少 21:15 reject v0.5.6)
// 凡人話: 兩個制都係 modify to date, from 永遠唔變. Backend KlineCache fetch K 線會自動用 K 線 actual range.
if (newFrom && newTo && newFrom > newTo) {
  console.warn(`[Brack Test ±1 日] 撳完後 from (${newFrom}) > to (${newTo}) (用戶 input date range 錯咗), 唔 trigger`);
  return;
}
console.log(`[Brack Test ±1 日] re-run: new from=${newFrom}, new to=${newTo}`);
```

### Backend 改動 (v0.5.7)

無。Frontend only fix,backend algorithm / API / runner 完全唔改。Backend KlineCache fetch K 線已經 handle 越界 date。

### Edge cases (凡人話 UX) — v0.5.7 簡化

| Case | Trigger | v0.5.6 行為 | v0.5.7 行為 (簡化) |
|------|---------|------------|-------------------|
| 兩個 date 都 empty | Fresh page load + 撳 ±1 日 | console.warn + return | 唔變(console.warn + return) |
| dateTo empty | Fresh page load + 撳 ±1 日 | console.warn + return | 唔變(console.warn + return) |
| dateTo 唔合法 | dateTo format 唔啱 | console.warn + return | 唔變(console.warn + return) |
| from 越界 K 線 first date | user input from < K-line first date | auto-clamp `newFrom = K 線 first date` + console.log + re-run (modify from) ❌ | **唔變, 拎走 auto-clamp** (user input value 保留, Backend KlineCache handle) ✅ |
| to 越界 K 線 last date | user input to > K-line last date | auto-clamp `newTo = K 線 last date` + console.log + re-run (modify to) ❌ | **唔變, 拎走 auto-clamp** (user input value 保留, Backend KlineCache handle) ✅ |
| from > to | 用戶 input date range 錯咗 | silent warn + return | 唔變(silent warn + return) |
| Network error / backend error | Fetch fail / verdict.ok = false | try/catch + console.warn + result panel 顯示 friendly error | 唔變 |

### 凡人話 verify (v0.5.7) — 大少 trigger「無問題才交給我」

Mavis 自己測試 scope (對齊 9月10日 23:06「自己行」永久 rule):

**凡人話 manual verify**:
- 大少 hard reload testing page (`?v=2.3.211`) + 撳跑 M1 (HK.00700) + 撳「🎯 跑 Brack Test」→ baseline 5 年 hit
- date inputs 揀 [2010-01-01, 2026-08-06](from 越界 K 線 first date `2021-06-22`)+ 撳「執行」→ re-fetch OK
- 撳「◀ -1 日」制 → console.log 印 `[Brack Test ±1 日] re-run: new from=2010-01-01, new to=2026-08-05` + date input to 變 `2026-08-05`, from 仲係 `2010-01-01` (唔變) + re-run K 線 + ZigZag + P 點 + Brack Test verdict ✅
- 撳「▶ +1 日 ▶」制 → console.log 印 `[Brack Test ±1 日] re-run: new from=2010-01-01, new to=2026-08-07` + date input to 變 `2026-08-07`, from 仲係 `2010-01-01` (唔變) + re-run ✅

**Backend curl verify**: `curl 'http://localhost:18792/api/algorithms/run?algo=m1_brack_test&symbol=HK.00700&start=2010-01-01&end=2026-08-07&data_window_days=1260'` → verdict.points 對齊 K 線 actual range `[2021-06-22, 2026-08-06]` (Backend KlineCache 自動 clamp 落 K 線 actual range, 即使 user input 越界 date)。

**凡人話解**:兩個制都係 modify to date,from 永遠唔變,唔再 auto-clamp(對齊 §Config UX 模式 spirit「user 揀過嘅 value 永遠要保留」)。Backend KlineCache fetch K 線自動用 K 線 actual range,越界 date 唔影響 verdict。

### 對齊永久 rule

- ✅ §Config UX 模式 (2026-08-19 13:03) — user 揀過嘅 value 永遠要保留, 唔好 auto-clamp date input
- ✅ §Cross-module 統一 date parsing 永久 rule (8月29日 22:35) — YYYY-MM-DD format + UTC midnight
- ✅ §K-line Cache 永久 rule (8月22日 23:20) — Backend KlineCache fetch K 線自動用 K 線 actual range (越界 date 唔影響 verdict)
- ✅ §M3 silent return 唔 throw spirit — edge case (empty / 唔合法 / from > to) 保留 silent warn
- ✅ §Backend hot-reload 永久 rule (8月31日 11:01) — frontend only fix, backend 唔需要 restart
- ✅ §M1 sub-scenario 永久 rule (8月16日 19:21) — 改任何 sub_scenario display 即刻 update spec doc
- ✅ cache bust self-check 永久 rule 21:24 — sync bump ALGO_CACHE_BUST + ?v=2.3.X
- ✅ DRY principle spirit — 共用 1 個 handler `_brackTestShiftDateHandler(panelId, symbol, delta)`,2 個 button 帶不同 `delta` param
- ✅ Re-use `_runAlgorithmWithDateRange` (v0.5.2 已實證 work 嘅 helper)

---

## Change log

| Version | Date | Trigger | Change |
|---|---|---|---|
| v0.1.0 | 2026-09-14 | 大少 21:16 trigger「我想在 M1 裡加一個 Brack Test 功能」+ 21:16 confirm Q4「要在 M1 加卡去做」 | 首個 spec + implementation done. Backend algorithm + frontend Brack Test card (M1 verdict card 內加卡模式), 11 種 sub_scenario 11 種顏色 marker, 2 個 mode tab + dropdown 揀 cycle 同步過濾 |
| v0.1.0-fix1 | 2026-09-14 21:32 | 大少 manual verify testing page 撳 Brack Test 跑失敗 `ZMEN_SCENARIO_COLOR_MAP is not defined` | Scope fix: Brack Test 3 處 reference 拎 `ZMEN_SCENARIO_COLOR_MAP` (line 1398 in `renderMAResult` function 內 local const) 改為 `BRACK_TEST_CYCLE_COLOR_MAP` (Brack Test 模塊內 self-contained const, 內容 100% 對齊原本嗰份) |
| v0.1.0-fix2 | 2026-09-14 22:04 | 大少 trigger「把 Brack Test (M1 過往 replay) 放在 K線圖框內最下邊」 | 位置改動: `renderMAAlignmentV2Result` verdict card HTML 入面拎走 `renderBrackTestCard()` append, 改為 testing-page.js `runAlgorithm` 之後 conditional populate `#brack-test-panel` (chart-section 入面, m6-dashboard-panel 之後, result section 之前), 對齊 §M6 dashboard panel pattern. adapter.mjs module 尾加 `export { renderBrackTestCard }`. index.html 加 `<div id="brack-test-panel"></div>`. Cache bust `5.2.1` → `5.2.2`, `?v=2.3.182` → `?v=2.3.183` |
| v0.1.0-fix3 | 2026-09-14 22:15 | 大少 trigger「把 Brack Test 結果固定只顯示 16 行, 其他要 scroll down 去睇」 | 表格固定高度: adapter.mjs BRACK_TEST_PANEL_STYLE 入面加 `.brack-hit-table-scroll { max-height:480px; overflow-y:auto; }` + `.brack-hit-table thead th { position:sticky; top:0; z-index:1; background:#ffcc80; box-shadow:0 1px 0 #ffa726; }` (16 行 ≈ 480px max-height, header 固定 scroll 期間唔郁). renderBrackTestCard table HTML 包 `<div class="brack-hit-table-scroll">` scroll container. Cache bust `5.2.2` → `5.2.3`, `?v=2.3.183` → `?v=2.3.184` |
| v0.1.0-fix4 | 2026-09-14 22:20 | 大少 trigger「Brack Test 結果修改: 把日期從大至小排例, 在日期左邊加多一例 Index number, 當選擇指定的 sub-scenario 後, 要顯示該 sub-scenario 有多少個結果」 | 表格內容 3 個 modify: (1) renderBrackTestHitTable sort 改 descending `(a, b) => String(b.date).localeCompare(String(a.date))`, 大少睇最新嘅 hit 排喺最頂, (2) header 加 `<th>Index</th>` 第一個 column + 每 row 顯示 `hit.index` value (hit dict backend emit 已有 index field 對齊 plan §Verdict shape), (3) adapter.mjs 新加 `renderBrackTestFilterInfo(hits, activeCycle)` helper, 表格上方加 `<div class="brack-filter-info">` 顯示「📊 當前顯示 X 條 / 全部 Y 條 · 🟢 強上升」, testing-page.js runAlgorithm handler + adapter.mjs _ModeHandler / _CycleHandler 3 個 handler populate filter-info element. Cache bust `5.2.3` → `5.2.4`, `?v=2.3.184` → `?v=2.3.185` |
| v0.1.0-fix5 | 2026-09-14 22:22 | 大少 manual verify testing page 撳跑 M1 之後見 error `M1 Brack Test 渲染失敗: renderBrackTestFilterInfo is not a function` | Scope fix: adapter.mjs module 尾 `export { renderBrackTestCard, renderBrackTestFilterInfo }` 加返 renderBrackTestFilterInfo named export (對齊之前 renderBrackTestCard SCOPE fix pattern 2026-09-14 21:35). Cache bust `5.2.4` → `5.2.5`, `?v=2.3.185` → `?v=2.3.186` |
| v0.1.0-fix6 | 2026-09-14 22:47 | 大少 trigger「修正 Index 的規則, 不管 Brack Test 怎樣排列, 例如轉去了不同的 sub-scenario, 最上的第一個就是 Index 1, 由大至小排例, 這個 Index 排列要在後台做好, 因為當我說 Index 第幾個時, 你要清楚知道我在說那一個」 | Backend sort by date_desc + emit displayIndex field (1..N global, 對齊 spec doc §4.1 Index 規則). Meta emit displaySortBy="date_desc" 寫低規則. Frontend Mode A 用 backend displayIndex, Mode B filtered 用 frontend local enumerate 1..M (filtered view index). 不論 mode, 第 1 row 永遠 = Index 1. Cache bust `5.2.5` → `5.2.6`, `?v=2.3.186` → `?v=2.3.187` |
| v0.1.0-fix7 | 2026-09-14 23:18 | 大少 trigger「在 Bracktest 結果裡的『按 sub-scenario 揀』Tab, 揀指定 sub_scenario 嗰陣 (除咗『全部 sub_scenario』), 喺 K 線圖表上方顯示嗰個 sub_scenario banner」 | Chart top banner (對齊 §M3 trendline chart overlay 修復永久 rule): adapter.mjs 新加 `renderBrackTestChartBanner(verdict, activeCycle)` helper (對齊 `renderBrackTestFilterInfo` pattern line 5919-5928 但用 cycle 顏色 background + 白字 + `🎯 當前顯示: 🟢 強上升 (X / Y 條)`, activeCycle='all' 返 empty string) + `updateBrackTestChartBanner(verdict, activeCycle)` helper (拎 `#brack-chart-banner` DOM + populate innerHTML) + 修改 `_ModeHandler` / `_CycleHandler` 2 個 handler 同步 call `updateBrackTestChartBanner` (對齊 line 6055-6066 / 6076-6086 pattern). BRACK_TEST_PANEL_STYLE 加 `.brack-chart-banner` CSS (cycle color background + 白字 + 圓角 + box-shadow, 對齊 Futu health banner style spirit). Module 尾 `export { renderBrackTestChartBanner }` 加返 named export (對齊之前 `renderBrackTestCard` / `renderBrackTestFilterInfo` SCOPE fix pattern 21:35 / 22:22). testing-page.js 加 `lastBrackChartBanner` global state + runAlgorithm handler 加 init chart banner 對齊 §M6 dashboard panel pattern (line 1555-1574, chart-section 入面 chart-container 之前 conditional render, M1 先 render 其他 algo 清返) + resetResultPanel 加清 brack-chart-banner. index.html 加 `<div id="brack-chart-banner"></div>` 喺 chart-container 之前. Spec doc §7 Chart top banner 新加 (對齊 §M1 sub-scenario 永久 rule). Backend 唔需要改 (純 frontend UI 改動, verdict shape 唔變). Cache bust `5.2.6` → `5.2.7`, `?v=2.3.187` → `?v=2.3.188` |
| v0.1.0-fix8 | 2026-09-14 23:34 | 大少 trigger「1. banner 個圓形圖案要跟返 sub-scenario 嘅圓形嘅一樣顏色 (背景不用轉)」+「2. 撳 cycle 嗰陣 K 線圖入面睇唔到 marker」 | (a) Banner dot 跟 chart marker circle: `renderBrackTestChartBanner` helper 改 dot 用 cycle color fill (`BRACK_TEST_CYCLE_COLOR_MAP[activeCycle]`, 跟 chart marker circle 一樣, 大少話「跟返 sub-scenario 那個圓形的一樣顏色」) + 白色 border (`border: 2px solid #fff`) 對比 banner background (因為 background 同 dot 都係 cycle color 會撞色, 大少話「背景不用轉」所以保留 background + 改 dot 用 cycle color fill + 白色 border). BRACK_TEST_PANEL_STYLE `.brack-chart-banner .cycle-color-dot` 拎走 default `background:#fff` + `box-shadow`, 改 inline style 提供 (避免 CSS default override 唔到 inline value). (b) Chart marker reuse handle fix: `renderBrackTestChartOverlay` 改用 testing-page.js 4.63.0 `zigzagSequenceMarkers.handle.setMarkers` pattern (line 1879-1889), reuse 同一個 plugin handle update markers — 之前每次 call 都 `createSeriesMarkers(candleSeries, markers)` 拎新 handle 但唔清返舊 handle, LWC v5 plugin 重複 register 撞, 結果撳 cycle 嗰陣新 handle 嘅 markers render 唔到 (舊 handle 佔住位). Fix: 第一次 call (handle 唔存在) → `createSeriesMarkers` 拎 handle; 撳 cycle / 切 tab (handle 已存在) → reuse `handle.setMarkers(markers)` update markers. 對齊 §M3 trendline chart overlay 修復永久 rule (9月6日 16:47) — render function 永遠拎 verdict.points. Cache bust `5.2.7` → `5.2.8`, `?v=2.3.188` → `?v=2.3.189` |
| v0.1.0-fix9 | 2026-09-14 23:38 | 大少 trigger「你的Marker 是用了什麼顏色？我真的找不到, 有沒有辦法可以肯定你真的加了上去」 | Root cause 確認 (testing-page.js line 1797 chart layout.background = '#ffffff' 白底): 之前 marker 用 BRACK_TEST_CYCLE_COLOR_MAP 對應色 (e.g. `#F5B7B1` 淡紅 for downtrend_bounce, `#A8D5BA` 淡綠 for uptrend_correction), 對比白色 background 對比度低, 淡色 marker 溶入白底; 加 size 1 (LWC v5 預設細) 對比 14px K 線太細. Fix 3 個 modify: (a) marker `size: 1 → 2` (LWC v5 medium, 對齊 plan 不破壞 design); (b) marker 加 `borderColor: '#000'` + `borderWidth: 1` (黑色 outline 對比白色 chart background, 淡色 marker 對比度提升); (c) marker `text` 顯示 cycle 中文 label + displayIndex (e.g. 「下跌反彈 #42」, 大少肉眼 scan 易搵到). 同時加 `console.log` 證實 markers 真係有 add 落 chart handle (markers.length + first marker detail + handle.markers.length 對比, 對齊 §M3 trendline chart overlay 修復永久 rule「testing page chart overlay 視覺 verify」spirit). 凡人話 verify: 大少 hard reload testing page + 撳跑 M1 (HK.00700) + Tab B 揀「下跌反彈中」, console.log 印出 `markers=20 (半年內)` + sample[0].color=#F5B7B1 + sample[0].size=2 + handle.markers.length=20, 肉眼 verify 20 條淡紅 circle marker + 黑色 outline + size 2 + text 「下跌反彈 #42」 etc 同步 render 喺 chart 入面 (半年內 20 條, 全部 112 條 hit 入面半年內可見). 對齊 §M3 trendline chart overlay 修復永久 rule (9月6日 16:47) — render function 永遠拎 verdict.points. Cache bust `5.2.8` → `5.2.9`, `?v=2.3.189` → `?v=2.3.190` |
| v0.1.0-fix10 | 2026-09-14 23:43 | 大少 trigger「你自己看看真的沒有Marker」+ screenshot evidence (chart 入面冇任何 marker) + console log `lastChartRefs 或 lastKlines 缺失, skip chart overlay` | Root cause 確認: testing-page.js 嘅 `lastChartRefs` (line 783 top-level let) + `lastKlines` (line 784 top-level let) 係 module-level 變量, **唔會自動 attach 落 `window` global object**. 但 adapter.mjs `_brackTestRunHandler` (line 6079) + `_ModeHandler` (line 6063) + `_CycleHandler` (line 6084) 都拎 `window.lastChartRefs` 同 `window.lastKlines`, 所以呢 2 個 reference 永遠 `undefined` → `renderBrackTestChartOverlay` 嘅 `if (chartRefs && klines && klines.length)` 永遠 `false` → 早期 return, marker 永遠唔 render. v0.1.0-fix7 + fix8 + fix9 都冇 fix 呢個 root cause (plan + 前 3 個 fix 都 miss 咗). Fix: testing-page.js line 1500 (`lastKlines = klines`) 之後加 `window.lastKlines = klines`; line 1650 (`lastChartRefs = chartRefs`) 之後加 `window.lastChartRefs = chartRefs`. 對齊 line 1653-1655 既有 `window.currentVerdict` + `window.currentKlines` + `window.currentChartRefs` pattern (window.current* 已 set, 但 window.last* 漏 set). 凡人話 verify (對齊 §M3 trendline chart overlay 修復永久 rule 9月6日 16:47 trigger 「testing page chart overlay 嘅 silent return (`console.warn + return` 唔 throw) testing page 嗰個 try/catch catch 唔到 → 撳跑算法之後必肉眼 verify chart overlay 有冇 render」): 大少 hard reload testing page + 撳跑 M1 (HK.00700) + Tab B 揀「強下跌週期」, console.log 不再印 `lastChartRefs 或 lastKlines 缺失`, 改印 `[renderBrackTestChartOverlay] reuse handle.setMarkers, set 125 markers, handle.markers.length=125 (activeCycle=strong_downtrend)`, 肉眼 verify 125 條深紅 circle marker + 黑色 outline + size 2 + text 「強下跌 #1」 etc 同步 render 喺 chart 入面. Cache bust `5.2.9` → `5.3.0`, `?v=2.3.190` → `?v=2.3.191` |
| v0.1.0-fix11 | 2026-09-14 23:47 | 大少 trigger「現在看到了，但還有些Bug，當放大縮小或左右移動時那個Marker有時會消失有時會出現, 你上網研究下怎樣可以解決這問題」 | Web search 拎 evidence (3 個 source 一致): (a) [lightweight-charts-python issue #32](https://githubhelp.com/louisnw01/lightweight-charts-python/issues/32): "It appears this happens when markers are placed in a **non chronological order**. You could append each marker to a list and then sort the list by date before placing them"; (b) [lightweight-charts GitHub issue #1766](https://github.com/tradingview/lightweight-charts/issues/1766): "I think I've figured out what causes it! My markers **weren't ordered correctly time wise**, but now that I've adjusted the processing of them to result in a **time ordered list of dictionaries, it's fixed**"; (c) [GitCode 中文 blog](https://blog.gitcode.com/bc94c0179839950be0c8911673c326a7.html): "标记点消失的根本原因是**标记点数据未按时间顺序排序**. Lightweight Charts 内部对标记点的渲染机制依赖于时间序列的正确排序". 凡人話 root cause: LWC v5 marker primitive 內部用 time series index 渲染, **markers 必須按時間升序 (ascending) 排列**, 否則 chart pan/zoom 嗰陣 markers 會 silently dropped. Backend 嘅 `verdict.points` sort by `date_desc` (新 → 舊, `displayIndex=1` = 最新, 對齊 §M1 sub-scenario 永久 rule), 但 LWC v5 需要 ascending (舊 → 新), 所以前端要重新 sort. Fix: `renderBrackTestChartOverlay` 入面, markers map + filter(Boolean) 之後加 `markers.sort((a, b) => a.time - b.time)` ascending, 對齊 LWC v5 internal time series index 期望. 對齊 §M3 trendline chart overlay 修復永久 rule 9月6日 16:47 trigger 「testing page chart overlay 嘅 silent return (`console.warn + return` 唔 throw) ... 唔可以淨靠 console log 確認」spirit — 對齊 LWC v5 嘅 silent dropped marker issue, web search 拎 evidence 確認 root cause (唔靠 mental model 估). 凡人話 verify (對齊 9月6日 16:47 永久 rule): 大少 hard reload testing page + 撳跑 M1 (HK.00700) + Tab B 揀「強下跌週期」, 試 pan/zoom chart (mouse wheel zoom in/out + drag 左右移動), 肉眼 verify 125 條深紅 marker 全部**持續 render**, 唔再「有時消失有時出現」. Cache bust `5.3.0` → `5.3.1`, `?v=2.3.191` → `?v=2.3.192` |
| v0.1.0-fix12 | 2026-09-14 23:53 | 大少 trigger「另外我也發現 ZigZag 的 P 點 Marker 也有消失的問題, 你也修正他吧」 | 對齊 fix 11 + Brack Test chart markers sort pattern, 套用落所有 LWC v5 marker creation sites: (a) M1 ZigZag P 點 markers (line 6492 `_dedupedPmarkers.sort((a, b) => aKey - bKey)` 用 composite key `time.year*10000 + time.month*100 + time.day`, 因為 marker time 係 business day object 唔可以直接 `a.time - b.time`); (b) M1 Trigger + P 點 combined markers (line 6623 `_combinedMarkers.sort((a, b) => aKey - bKey)`, 因為 P 點 markers DESC + Trigger markers order 唔確定, combined 必須 sort ASC); (c) M2 peaks/troughs combined markers (line 3680 `markers.sort((a, b) => a.time - b.time)`, 因為 peaks 先 push DESC + troughs 之後 push DESC, combined 唔係嚴格 ASC). 對齊 §M3 trendline chart overlay 修復永久 rule 9月6日 16:47 trigger「testing page chart overlay 嘅 silent return ... 唔可以淨靠 console log 確認」spirit — 同一個 root cause (LWC v5 marker 必須 ascending) 影響多個 module 嘅 chart overlay. M3/M4/M5/M6 唔 render candle series marker (淨 render line series / panes), 所以唔需要 sort. Cache bust `5.3.1` → `5.3.2`, `?v=2.3.192` → `?v=2.3.193` |
| v0.1.0-fix13 | 2026-09-14 23:57 | 大少 trigger「現在的zigzag P點全部無晒了，你是不是做錯了地方？你做了要檢查」 | 凡人話 evidence (curl backend `/api/algorithms/run?algo=zigzag`): backend verdict.points 234 個, order DESC (idx=1258 最新 → P1, idx=0 最舊 → P234). 我 fix 12a sort ASC 之後 _dedupedPmarkers 變成 [P234, P233, ..., P1] (舊 → 新), 之前 line `_visiblePmarkers = _dedupedPmarkers.slice(0, _pmarkerMaxCount)` 拎前 10 個 = 最舊嘅 10 個 (P225-P234, date 喺 2021-2022), 大少睇唔到因為遠離 chart 半年 visible range (2026-03-18 開始). 大少 9月1日 23:46 4.63.0 永久 rule: 「只要顯示 P1-P10 就可以了」= 最新嘅 10 個 P 點. Fix: `_visiblePmarkers = _dedupedPmarkers.slice(-_pmarkerMaxCount)` 拎 ASC array 最尾 10 個 = 最新 10 個 (P1-P10). 同樣改 fallback chain `slice(0, 5)` → `slice(-5)` + `slice(0, 3)` → `slice(-3)`. 對齊 §M3 trendline chart overlay 修復永久 rule spirit「改 array access 之前必先 curl 拎 evidence 確認」+ §M1 sub-scenario 永久 rule (8月16日 19:21)「改任何 sub_scenario display 都要即刻 update spec doc」. Cache bust `5.3.2` → `5.3.3`, `?v=2.3.193` → `?v=2.3.194` |
| v0.2.0 | 2026-09-15 00:03 | 大少 trigger「現在可以做 - 加 legend 喺 chart 入面 - banner 入面加 cycle 嘅中文 explanation tooltip」 | 2 個新 feature: (1) **Cycle legend 喺 chart 入面 overlay** (對齊 §M6 dashboard panel pattern: chart-section 入面 conditional render, 撳跑 M1 + Brack Test button 之後先 render, 撳跑其他 algo → 清返 legend). `index.html` 加 `<div id="cycle-legend"></div>` (line 187); `testing-page.css` 加 `.cycle-legend` + `.cycle-legend-grid` + `.cycle-legend-cell` (line 745-763); `testing-page.js` 加 init cycle legend block (line 1706-1739), 對齊 §M3 trendline chart overlay 修復永久 rule 9月6日 16:47 trigger「凡人話 visual evidence」spirit. (2) **Cycle explanation tooltip 喺 banner 入面** (`adapter.mjs` 加 `BRACK_TEST_CYCLE_EXPLANATIONS` dict line 5990-6003, 11 個 cycle 中文解釋對齊 §M1 sub-scenario spec doc §3-§5 trigger; `renderBrackTestChartBanner` 加 ⓘ icon line 6015; `testing-page.css` 加 `.cycle-tooltip` + `.cycle-tooltip::after` + `.cycle-tooltip-title` line 765-789; `testing-page.js` 加 `showCycleTooltip` function line 1373 + click delegation line 1409). 凡人話: 撳 banner ⓘ icon → tooltip panel 顯示對應 cycle 中文解釋. 對齊 9月7日 21:50 永久 rule「凡新加 render function 必 escape HTML」: tooltip + legend + banner 全部用 `_brackEscapeHtml` + `escapeHtml`. 對齊 §M1 sub-scenario 永久 rule (8月16日 19:21)「改任何 sub_scenario display 都要即刻 update spec doc」: spec doc §7 + §8 新加, Change log v0.2.0 entry. Cache bust `5.3.3` → `5.4.0` (新 feature, 升 v0.4.0), `?v=2.3.194` → `?v=2.3.195` |
| v0.2.1 | 2026-09-15 06:29 | 大少 trigger「brack test結果的 TAb 我想先放"🎯 按 sub-scenario 揀"，之後才到"📅 按時間排"，預設是🎯 按 sub-scenario 揀」 | 改 4 個地方: (a) **Tab HTML 順序對調** (adapter.mjs line 5780-5783): 「🎯 按 sub-scenario 揀」Tab 放第一個 + 默認 active; 「📅 按時間排」Tab 放第二個 + 非 active (對齊大少 trigger「先放 🎯 按 sub-scenario 揀」). (b) **Dropdown 默認 selected** (adapter.mjs line 5789): `<option value="strong_uptrend" selected>🟢 強上升</>` 是第一個 selected cycle, 「全部 sub_scenario」unselected (對齊大少 trigger「預設是 🎯 按 sub-scenario 揀」). (c) **`_brackTestRunHandler` default activeCycle** (adapter.mjs line 6102-6127): `const defaultActiveCycle = 'strong_uptrend'`, 撳跑 Brack Test 第一眼見到強上升 markers + banner, 而唔係 11 種顏色全部 marker + banner hidden. renderBrackTestHitTable / renderBrackTestFilterInfo / renderBrackTestChartOverlay / renderBrackTestChartBanner 全部 default 拎 defaultActiveCycle. (d) **`testing-page.js init chart banner`** (testing-page.js line 1681-1696): defaultBannerCycle = 'strong_uptrend', 撳跑 M1 init chart banner 嗰陣 default 顯示「🟢 強上升 (X / Y 條)」banner (對齊 Tab B 默認 + Dropdown 默認). 凡人話 verify: 大少 hard reload testing page + 撳跑 M1 (HK.00700) + 撳「🎯 跑 Brack Test」button, 第一眼見到 (i) Tab B「🎯 按 sub-scenario 揀」active 高亮橙色 + Tab A「📅 按時間排」inactive; (ii) Dropdown 默認「🟢 強上升」selected; (iii) Banner 出現「🎯 當前顯示: 🟢 強上升 (X / Y 條)」深綠色; (iv) Chart 入面只見深綠強上升 marker, 100 條 (半年內 20 條). 對齊 §M1 sub-scenario 永久 rule (8月16日 19:21)「改任何 sub_scenario display 都要即刻 update spec doc」: spec doc §7 update 默認 Tab + Dropdown 行為. Cache bust `5.4.0` → `5.4.1`, `?v=2.3.195` → `?v=2.3.196` |
| v0.2.2 | 2026-09-15 06:35 | 大少 trigger「在"🎯 按 sub-scenario 揀"的第一次開啟時消失了"sub-scenario"的select list，你去修正這問題」 | Root cause 確認: v0.2.1 改 Tab order 但漏 toggle dropdown visible (HTML 默認 `style="display:none;"`, 因為 `_brackTestRunHandler` 唔 call `_brackTestModeHandler` 嚟 trigger dropdown toggle, 所以撳跑 Brack Test 第一眼見到 dropdown 永遠唔見). Fix (adapter.mjs line 6110-6120): inline toggle dropdown visible (`dropdown.style.display = ''` 對齊 `_brackTestModeHandler` line 6177 pattern `mode === 'cycle' ? '' : 'none'`) + toggle mode-tab active class 對齊 cycle (HTML 默認 cycle active 但 explicit toggle 確保 active state 對齊 `_brackTestModeHandler` spirit). 凡人話: 撳跑 Brack Test 第一眼見到 cycle dropdown (select list) 顯示 11 個 cycle options + Tab B「按 sub-scenario 揀」active 高亮橙色. Fix 唔重複 call `_brackTestModeHandler` 重 render data (避免 §K-line Cache 永久 rule 重 render), 只 inline toggle UI state 對齊既有 handler logic. Cache bust `5.4.1` → `5.4.2`, `?v=2.3.196` → `?v=2.3.197` |
| v0.3.0 | 2026-09-15 06:45 | 大少 trigger「click Brack Test hit row 日期 → K 線圖 pan/zoom 到嗰個日子中間 + 3 個月」 | Click delegation 對整個 `<tr data-hit-date>` 做, 撳任何 cell 都 trigger, 日期 cell 加 `.brack-hit-date` class + hover cursor pointer + underline 紅色 (大少 06:46 confirm Option 3)。範圍 `from = hit.date - 45 days`, `to = hit.date + 45 days` (90 日, hit.date 喺 viewport 中間)。Edge cases: K 線 first date 早過 from → fallback 用 K 線 first date (Option 1 大少 confirm); K 線 last date 早過 to → fallback 用 K 線 last date (clip); hit.date 唔喺 K 線入面 (週末/假期) → LWC v5 setVisibleRange 自動 snap nearest trading day。Chart 未 init / K 線 missing → silent warn + return 唔 throw (對齊 §M3 trendline chart overlay 修復永久 rule 9月6日 16:47)。Click delegation 用 `brackTestRowClickAttached` flag 確保只 attach 1 次 (避免多次 runAlgorithm 重複 trigger)。凡人話 verify (對齊 §M3 永久 rule 凡人話肉眼 verify): 大少 hard reload testing page + 撳跑 M1 (HK.00700) + 撳「🎯 跑 Brack Test」button + 撳其中一個 hit row 嘅日期 cell, K 線圖即時 pan/zoom 到嗰個 hit.date 喺 viewport 中間, 範圍 ≈ 3 個月 (60-65 個交易日)。對齊 §M1 sub-scenario 永久 rule (8月16日 19:21) 改任何 sub_scenario display 即刻 update spec doc (§7.1 加咗); HTML escape 永久 rule (9月7日 21:50) `data-hit-date` 用 `_brackEscapeHtml` escape; Cache bust `5.4.2` → `5.4.3`, `?v=2.3.197` → `?v=2.3.198` (對齊 21:24 cache bust self-check 永久 rule); §Backend hot-reload 永久 rule (8月31日 11:01) — backend 唔需要 restart (frontend only fix) |
| v0.3.1 | 2026-09-15 06:55 | 大少 trigger「當我跑了算法，但還沒有跑Brack Test時，不要顯示"當前顯示: 強上升週期 (0 條 / 全部 0 條)"」 | Fix 未跑 Brack Test 唔顯示 misleading banner: (a) `testing-page.js` line 1696 chart banner init 加 guard `if (verdict && verdict.points && verdict.points.length > 0)` 先 render banner, 否則 innerHTML = '' (hidden) 對齊既有 catch block fallback pattern; (b) `adapter.mjs` `renderBrackTestChartBanner` line 6096 加 defensive guard `if (hits.length === 0) return '';` 對齊 §M3 trendline chart overlay 修復永久 rule (9月6日 16:47) spirit「silent return 唔 throw」, 涵蓋 `updateBrackTestChartBanner` + `_ModeHandler` / `_CycleHandler` 等所有 callers (對齊 §Backend 永久改 emit field name 之後 frontend 必先 grep 全 reference 對齊永久 rule 9月10日 23:45)。凡人話 verify (對齊 §M3 永久 rule 凡人話肉眼 verify): 大少 hard reload testing page (`?v=2.3.199`) + 撳跑 M1 (HK.00700) 但**唔撳**「🎯 跑 Brack Test」button → chart banner 應該**唔顯示** (hidden), 冇「(0 條 / 全部 0 條)」misleading text。對齊 §M1 sub-scenario 永久 rule (8月16日 19:21) 改任何 sub_scenario display 即刻 update spec doc (§7 caveat 加咗); Cache bust `5.4.3` → `5.4.4`, `?v=2.3.198` → `?v=2.3.199` (對齊 21:24 cache bust self-check 永久 rule); §Backend hot-reeload 永久 rule (8月31日 11:01) — backend 唔需要 restart (frontend only fix) |
| v0.4.0 | 2026-09-15 21:05 | **Superseded by v0.4.1** — 大少 trigger「Brack Test 指定日期範圍跑功能: 右邊加日期 From / Date To + 執行 button, 保留左邊全跑 default」 | v0.4.0 implementation **淨係 Brack Test verdict filter**, K 線圖 + M1 verdict 仲係 full 5 年 data, **唔對齊大少 21:37 trigger 真正 spirit**。v0.4.1 修正: fetch K 線 (filtered, `start` + `end` query params 對齊 api/kline.py 既有 pattern) + renderChart reset + 重新 fetch verdict + 重新 render chart overlay + chart banner + cycle legend 全部 reset 對齊大少「整個 K 線圖和 Brack Test 都按指定的日期內重新再跑」。詳見 §8.1 v0.4.1 section |
| v0.4.1 | 2026-09-15 21:37 | 大少 trigger「修正, 這個Brack Test指定日期不只是重跑Brack Test, 那是整個K線圖和Brack Test都按指定的日期內重新再跑」 | **修正 v0.4.0 (淨改 Brack Test verdict filter 唔對齊 spirit)** — (a) **Backend** `api/kline.py` line 47 已經有 `start` + `end` Query params + KlineCache `get_or_fetch` line 144-145 已經 support 拎 filtered K 線 (凡人話 v0.4.1 唔需要新加 backend endpoint); (b) **Backend** `m1_brack_test/algorithm.py` **Revert v0.4.0 改動** (拎走 `_parse_date_range` + `_kline_date_ts` + loop date range filter, 因為 frontend testing-page.js fetch K 線嗰陣已經 add `start` + `end` query params, KlineCache 自然拎 filtered K 線, frontend 拎到嘅 klines 已經 filtered, algorithm 唔需要再 filter — 對齊 §K-line Cache 永久 rule spirit「Frontend 拎 data, Backend 拎 K 線」); (c) **Backend** `api/algorithms.py` 保留 v0.4.0 `date_from` + `date_to` Query params (algorithm 入面拎 `options.get("dateFrom")` 等於 None 嘅時候 fallback 全跑, silent return 對齊 §M3 永久 rule spirit); (d) **Frontend** `testing-page.js` Refactor `runAlgorithm()` → `runAlgorithm(dateFrom, dateTo)` 拎 optional args + fetch K 線嗰陣 add `start` + `end` query params + expose `window._runAlgorithmWithDateRange = function(dateFrom, dateTo) { return runAlgorithm(dateFrom, dateTo); }`; (e) **Frontend** `adapter.mjs` `_brackTestRunDateRangeHandler` 重寫成 trigger `window._runAlgorithmWithDateRange(dateFrom, dateTo)` (透過 window global), 唔再自己 fetch verdict + render (對齊 v0.4.1 真正 spirit「整個 K 線圖 + Brack Test 都按指定日期重跑」); (f) **Spec doc** §8.1 新加 + Change log v0.4.1 entry + v0.4.0 entry 加註「Superseded by v0.4.1」。對齊 §K-line Cache 永久 rule spirit; §M3 trendline chart overlay 修復永久 rule silent return 唔 throw; §Backend hot-reload 永久 rule 改 backend 必 restart (`./start.sh`) + curl verify; Cache bust `5.4.5` → `5.4.6`, `?v=2.3.200` → `?v=2.3.201` (對齊 21:24 cache bust self-check 永久 rule); DRY principle spirit — testing-page.js 主流程共用, 唔再 adapter.mjs 自己 fetch verdict |
| v0.4.3 | 2026-09-15 22:27 | 大少 trigger「在指定日期內跑 Brack Test 但發現zigzag 和P點 沒有重跑, 再檢查還有那些是溜了的」 | **修 ZigZag 沒有重跑 issue + audit 其他 chart overlay 來源** — (a) **Audit** 8 個 chart overlay 來源 (K 線 candlestick / M1 verdict / MA 線 / 鮮紫觸發點 marker / 鮮綠 extension line / Brack Test verdict / Brack Test cycle marker / chart banner + cycle legend) 全部對齊 filtered K 線 ✅, 只有 ZigZag verdict + ZigZag 紫線 + P 點 marker 漏咗 (frontend `fetchBackendZigZag` 之前 hardcode `data_window_days: '1260'` (5 年) + 冇 add `date_from`/`date_to` query params, ZigZag verdict 拎 5 年嘅 points, 紫色線 + P 點 marker 嘅 time 唔喺 chart visible range 內, 大少睇唔到 = 「冇重跑」); (b) **Frontend** `testing-page.js` `fetchBackendZigZag(code, period, thresholdMode, manualThreshold, lookback, multiplier, signal, dateFrom, dateTo, dataWindowDays)` 加 3 個 optional args + Fetch URL add `start` + `end` query params (對齊 backend api/algorithms.py start/end 既有 pattern) + `data_window_days` 用 caller value (filtered K 線 length), 唔再 hardcode 1260; (c) **Frontend** `fetchAndInjectBackendZigZag(...)` 加 3 個 args + 傳落 `fetchBackendZigZag`; (d) **Frontend** `runAlgorithm(dateFrom, dateTo)` line 1599 call site 加 3 個 args (從 runAlgorithm scope 拎 `dateFrom`/`dateTo`/`klines.length`); (e) **附加 silent fallback fix** (對齊 §M3 永久 rule spirit「silent return 唔 throw」): `testing-page.js` line 1518 `throw error` 改 `silent fallback + return` + `runStatus.innerHTML` 顯示 friendly error message + `resultPanel.innerHTML` 顯示建議 (Retry / Check FutuOpenD / Check stock code) + `console.warn` 而唔係 `console.error`; (f) **Spec doc** §8.3 新加 + Change log v0.4.3 entry。對齊 §K-line Cache 永久 rule spirit「Frontend 拎 data, Backend 拎 K 線」; §M3 trendline chart overlay 修復永久 rule silent return 唔 throw; §Backend hot-reload 永久 rule backend 唔需要 restart (frontend only fix); Cache bust `5.4.6` → `5.4.7`, `?v=2.3.201` → `?v=2.3.202` (對齊 21:24 cache bust self-check 永久 rule); 凡人話 verify (對齊 §M3 永久 rule 凡人話肉眼 verify spirit): 大少 hard reload testing page + 撳 date inputs 揀 [2026-09-01, 2026-09-15] + 撳「執行」button → ZigZag 紫線 + P 點 marker 對齊 filtered K 線 range, 唔再係 5 年嘅 points 喺 chart visible range 外 |
| v0.4.4 | 2026-09-16 06:16 | 大少 trigger screenshot「zigzag 線和 P 點 把超出 K 線範圍的跑了, 必須根據新範圍的 K 線再重新跑」 | **修 v0.4.3 漏網之魚 — backend runner 拎 caller start/end** — (a) **Backend** `services/algorithm_runner.py` line 125-137: 拎 caller 嘅 `dateFrom` + `dateTo` 從 `options.get(...)` 覆蓋 `start_date` + `end_date` (silent fallback: caller 冇傳 → 用既有 `today - calendar_days_back` default 對齊 §M3 永久 rule spirit); (b) **Backend** `cache.get_klines(symbol, period, start=start_date, end=end_date)` 拎 filtered K 線對齊 caller 傳嘅 start/end; (c) **Spec doc** §8.4 新加 + Change log v0.4.4 entry。對齊 §K-line Cache 永久 rule spirit「Frontend 拎 data, Backend 拎 K 線」; §M3 永久 rule silent return 唔 throw; §Backend hot-reload 永久 rule 改 backend 必 restart (`./start.sh`) + curl verify (frontend 不需要 restart); Cache bust `5.4.7` → `5.4.8`, `?v=2.3.202` → `?v=2.3.203` (對齊 21:24 cache bust self-check 永久 rule); DRY principle spirit — backend runner 共用 caller 嘅 start/end, 唔再 hardcode today - calendar_days_back |
| v0.5.0 | 2026-09-16 07:21 | 大少 trigger「撳完指定日期後, date inputs 嘅 value 會 reset 返做空, 要保留我揀過嘅日期」 | **Brack Test date inputs 保留 user 揀過嘅 value (對齊 §Config UX 模式)** — (a) **Frontend** `adapter.mjs` module 加 `lastBrackDateFrom` / `lastBrackDateTo` state (line 6243-6244) + `_brackTestDateInputChange(field, value)` window handler (line 6258+) 即時 sync state; (b) **Frontend** `adapter.mjs` `renderBrackTestCard` date inputs (line 5795-5797) 加 `value="${lastBrackDateFrom}"` + `value="${lastBrackDateTo}"` + `onchange` / `oninput` 即時 sync; (c) **Frontend** `adapter.mjs` `_brackTestRunDateRangeHandler` 撳「執行」之前同步 state (line 6324-6325); (d) **Spec doc** §8.6 新加 + Change log v0.5.0 entry。對齊 §Config UX 模式 (2026-08-19 13:03) — user 揀過嘅 value 永遠要保留; §Backend hot-reload 永久 rule (8月31日 11:01) — frontend only fix, backend 唔需要 restart; Cache bust `5.4.8` → `5.4.9`, `?v=2.3.203` → `?v=2.3.204` (對齊 21:24 cache bust self-check 永久 rule); 凡人話 verify: 大少 hard reload testing page (`?v=2.3.204`) + 撳跑 M1 (HK.00700) + date inputs 揀 [2026-09-01, 2026-09-15] + 撳「執行」 → 肉眼 verify date inputs 仲係 [2026-09-01, 2026-09-15] (唔 reset) |
| v0.5.1 | 2026-09-16 07:27 | 大少 trigger「撳完指定日期後再撳『跑算法』撞 PointerEvent error」 | **Frontend button event-leak bug fix** — (a) **Frontend** `testing-page.js` 3 個 addEventListener 改用 arrow function wrap: `runBtn` line 2081, `runFullChainBtn` line 2889, `addTradeJournalEntry btn` line 3436 — 改 `() => runAlgorithm()` / `() => runFullChain()` / `() => addTradeJournalEntry()` 避免 PointerEvent 漏入 function 嘅 first arg; (b) **Root cause** (curl + backend log evidence): `runBtn.addEventListener('click', runAlgorithm)` 撳 button 嗰陣 event listener 默認傳 `(event)` 做 first arg, `runAlgorithm(dateFrom, dateTo)` signature 第一個 param `dateFrom = PointerEvent` (truthy object), backend log 印 `start=[object PointerEvent]` silent fail; (c) **Spec doc** §8.7 新加 + Change log v0.5.1 entry。對齊 §M3 silent return 唔 throw spirit — silent fallback + console.warn; §Backend hot-reload 永久 rule (8月31日 11:01) — frontend only fix, backend 唔需要 restart; Cache bust `5.4.9` → `5.4.10`, `?v=2.3.204` → `?v=2.3.205` (對齊 21:24 cache bust self-check 永久 rule); 凡人話 verify: 大少 hard reload testing page + 撳 M1 + 撳 Brack Test 指定日期跑 → 撳「執行」OK → 撳返「跑算法」button → verdict 正常 render (之前 backend log 印 `start=[object PointerEvent]` + 返 0 條 K 線); 新永久 rule (新加 AGENTS.md) — 「Frontend button event listener 永遠 wrap arrow function 避免 event object 漏入 function args」 |
| v0.5.2 | 2026-09-16 17:08 | 大少 trigger「修改, 現在只有 K 線圖和 Zigzag, 但沒有 Brack Test, 在指定的日期內跑是要包括 Brack Test」 | **Brack Test 指定日期範圍 Brack Test verdict render fix** — (a) **Frontend** `adapter.mjs` `_brackTestRunDateRangeHandler` 喺 `_runAlgorithmWithDateRange` 之後自己 fetch Brack Test verdict (m1_brack_test algo) 帶 `start + end` query params (對齊 backend api/algorithms.py line 83-89 Query params); (b) call `_renderBrackTestVerdict(panel, data, symbol)` 共用 render helper 寫入 panel; (c) **Spec doc** §8.8 新加 + Change log v0.5.2 entry。對齊 §K-line Cache 永久 rule spirit「Frontend 拎 data, Backend 拎 K 線」 — K 線 filtered 喺 KlineCache layer, frontend testing-page.js 拎 data, backend runner 拎 options.get("dateFrom") / options.get("dateTo") 落 start_date / end_date; §M3 silent return 唔 throw spirit — silent fallback + console.warn; §Backend hot-reload 永久 rule (8月31日 11:01) — frontend only fix, backend 唔需要 restart; Cache bust `5.4.10` → `5.4.11`, `?v=2.3.205` → `?v=2.3.206` (對齊 21:24 cache bust self-check 永久 rule); 凡人話 verify: 大少 hard reload testing page (`?v=2.3.206`) + 撳跑 M1 (HK.00700) + 撳 date inputs 揀 [2026-09-01, 2026-09-15] + 撳「執行」 → Brack Test verdict re-fetched, hit table / summary / chart banner 全部對齊 filtered range |
| v0.5.3 | 2026-09-16 17:23 | 大少 trigger「在指定日期 Brack Test 的『執行』制右邊, 加上兩個功能制, 第一個是把現在的 Brack Test 減一日, 第二個是把現在的 Brack Test 加一日, 同樣地要把正個 K 線圖, Zigzag 線, P 點, Brack Test, 都要再重新跑一編」 | **Brack Test 指定日期 ±1 日快速調整 UI** — (a) **Frontend** `adapter.mjs` `BRACK_TEST_PANEL_STYLE` (line 5771+) 加 `.brack-shift-date-btn` CSS (橙色主題色 #ffa726 + hover #ff9800 + disabled #ccc); (b) **Frontend** `adapter.mjs` `renderBrackTestCard` (line 5802+) date row 加 2 個 `<button class="brack-shift-date-btn">` (「◀ -1 日」/「+1 日 ▶」), onclick 帶 `delta=-1` / `delta=+1` 參數; (c) **Frontend** `adapter.mjs` 新加 `_brackShiftDate(isoDate, deltaDays)` helper (line 6268+) — UTC midnight 統一 (對齊 §Cross-module 統一 date parsing 永久 rule 8月29日 22:35) — `new Date(isoDate + 'T00:00:00Z').setUTCDate(getUTCDate() + delta)` → `toISOString().slice(0, 10)`; (d) **Frontend** `adapter.mjs` 新加 `window._brackTestShiftDateHandler(panelId, symbol, delta)` handler (line 6401+) — DRY spirit 共用 1 個 handler 帶 delta param, 完整 13 個 steps: 拎 date inputs value + edge case empty + date arithmetic + 拎 K 線 first/last date + boundary check (3 個 case: 越界 / from > to) + sync state + update input DOM + disable 3 button + trigger `_runAlgorithmWithDateRange` + fetch Brack Test verdict + call `_renderBrackTestVerdict` + re-enable 3 button + catch error silent fallback; (e) **Spec doc** §8.9 新加 + Change log v0.5.3 entry。對齊 §Config UX 模式 (2026-08-19 13:03) — 自動+手動+自動儲存更新圖表 ±1 日制快捷掣; §Cross-module 統一 date parsing 永久 rule (8月29日 22:35); §K-line Cache 永久 rule (8月22日 23:20) — Frontend 拎 data; §M3 silent return 唔 throw spirit — edge case silent warn; §Backend hot-reload 永久 rule (8月31日 11:01) — frontend only fix; cache bust self-check 永久 rule 21:24 — sync bump `5.4.11` → `5.4.12` + `?v=2.3.206` → `?v=2.3.207`; DRY principle spirit — 共用 1 個 handler `_brackTestShiftDateHandler(panelId, symbol, delta)`, 2 個 button 帶不同 `delta` param; Re-use `_runAlgorithmWithDateRange` (v0.5.2 已實證 work 嘅 helper); 新永久 rule (新加 AGENTS.md) — 「Brack Test 指定日期 ±1 日快速調整 UI 永久 rule」 |
| v0.5.4 | 2026-09-16 20:39 | 大少 trigger「我指定的 Bracktest 日期是 2000-1-1 至 2026-8-7, 但 console log: [Brack Test ±1 日] 撳完後 from (1999-12-31) 早過 K 線第一日 (2021-06-23), 唔 trigger. 這個問題在時間上是全錯了, 你要找回當時 K 線的時間 Range 才可以做到加一日或減一日」 | **Brack Test ±1 日制 boundary check 改 auto-clamp + 永遠 re-run (修正 v0.5.3 漏網之魚)** — (a) **Root cause** v0.5.3 `_brackTestShiftDateHandler` line 6448-6460 boundary check 用「越界 → silent warn + return」邏輯, 大少 date range `[2000-01-01, 2026-08-07]` 但 K 線 actual range `[2021-06-23, 2026-08-07]` (因 `dataWindowDays=1260` default 5 年), 撳 ±1 日永遠 trigger「撳完後 from 早過 K 線第一日, 唔 trigger」console.warn, 永遠唔 re-run; (b) **Frontend** `adapter.mjs` `window._brackTestShiftDateHandler` line 6448+ 改 auto-clamp 邏輯 — K 線 first date / last date 係 authoritative source (對齊 §K-line Cache 永久 rule spirit), 如果 `newFrom < K 線 first date` → auto-clamp `newFrom = K 線 first date` + console.log 提示, 如果 `newTo > K 線 last date` → auto-clamp `newTo = K 線 last date` + console.log 提示, 永遠 trigger `_runAlgorithmWithDateRange` + fetch Brack Test verdict + re-enable button. Edge case (b) `newFrom > newTo` (極端 case: 兩個 date 都越界 clamp 落同一個 K 線 date) 保留 silent warn + return; (c) **Spec doc** §8.10 新加 + Change log v0.5.4 entry。對齊 §Config UX 模式 (2026-08-19 13:03) — ±1 日制永遠 work, 即使 date 越界都 auto-clamp 落 K 線範圍; §K-line Cache 永久 rule (8月22日 23:20) — K 線 first/last date 係 authoritative source; §M3 silent return 唔 throw spirit — extreme edge case (from > to) 保留 silent warn; §Backend hot-reload 永久 rule (8月31日 11:01) — frontend only fix, backend 唔需要 restart; Cache bust `5.4.12` → `5.4.13`, `?v=2.3.207` → `?v=2.3.208` (對齊 21:24 cache bust self-check 永久 rule); 凡人話 verify: 大少 hard reload testing page (`?v=2.3.208`) + 撳跑 M1 (HK.00700) + date inputs 揀 [2000-01-01, 2026-08-07] (越界 K 線 first date `2021-06-23`) + 撳「執行」→ 撳「◀ -1 日」制 → console.log 印 `[Brack Test ±1 日] from (1999-12-31) 早過 K 線第一日 (2021-06-23), auto-clamp → 2021-06-23` + date input 變 `2021-06-23` + re-run K 線 + ZigZag + P 點 + Brack Test verdict. 凡人話解: K 線 first / last date 永遠係 authoritative source, ±1 日制永遠 work, date 越界就 auto-clamp; AGENTS.md 永久 rule update (v0.5.3 → v0.5.4: boundary check 改 auto-clamp + 永遠 re-run) |
| v0.5.5 | 2026-09-16 20:50 | 大少 trigger「現在減一日是對的, 但加一日是錯的, 你是修改了 From Date, 應該是修改 To Date」 | **Brack Test ±1 日制 改單邊 modify (修正 v0.5.4)** — (a) **Root cause** v0.5.4 `_brackTestShiftDateHandler` Step 3 line 6428-6446 用「from + to 雙邊 modify」邏輯, 大少 case date `[2000-01-01, 2026-08-07]`, K 線 `[2021-06-23, 2026-08-07]`, 撳 ◀ -1 日雙邊 modify 對齊大少 accept(因為 from auto-clamp + to -1 仲喺範圍), 撳 ▶ +1 日雙邊 modify 大少 reject(因為 from auto-clamp + to auto-clamp → date range 仲係 [2021-06-23, 2026-08-07] 完全冇 effect, 大少 expect +1 只 modify to). 大少 feedback「+1 應該修改 to date」 — 即係 ◀ -1 日 = extend left (modify from only), ▶ +1 日 = extend right (modify to only); (b) **Frontend** `adapter.mjs` `window._brackTestShiftDateHandler` Step 3 line 6428-6456 改**單邊 modify** 邏輯 — `delta < 0` (◀ -1 日): `newFrom = _brackShiftDate(dateFrom, -1)`, `newTo = dateTo` (to 唔變), `delta > 0` (▶ +1 日): `newTo = _brackShiftDate(dateTo, +1)`, `newFrom = dateFrom` (from 唔變). Edge case (d) -1 日 dateFrom empty / +1 日 dateTo empty → silent warn + return. Step 5 auto-clamp v0.5.4 spirit 保留: `newFrom < K 線 first date` → auto-clamp + re-run, `newTo > K 線 last date` → auto-clamp + re-run. Edge case (b) from > to 保留 silent warn + return; (c) **Spec doc** §8.11 新加 + Change log v0.5.5 entry。對齊 §Config UX 模式 (2026-08-19 13:03) — ±1 日制單邊 extend date range (◀ extend left, ▶ extend right); §K-line Cache 永久 rule (8月22日 23:20) — K 線 first/last date 係 authoritative source (v0.5.4 auto-clamp spirit 保留); §M3 silent return 唔 throw spirit — edge case 保留 silent warn; §Backend hot-reload 永久 rule (8月31日 11:01) — frontend only fix, backend 唔需要 restart; Cache bust `5.4.13` → `5.4.14`, `?v=2.3.208` → `?v=2.3.209` (對齊 21:24 cache bust self-check 永久 rule); 凡人話 verify: 大少 hard reload testing page (`?v=2.3.209`) + 撳跑 M1 (HK.00700) + date inputs 揀 [2000-01-01, 2026-08-07] (越界 K 線 first date `2021-06-23`) + 撳「執行」→ 撳 ◀ -1 日 → console.log 印 `from (1999-12-31) 早過 K 線第一日 (2021-06-23), auto-clamp → 2021-06-23` + date input from 變 `2021-06-23` + date input to 仲係 `2026-08-07` + re-run K 線 + ZigZag + P 點 + Brack Test verdict; 撳 ▶ +1 日 → console.log 印 `to (2026-08-08) 遲過 K 線最後一日 (2026-08-07), auto-clamp → 2026-08-07` + date input from 仲係 `2021-06-23` + date input to 仲係 `2026-08-07` + re-run. 凡人話解: ◀ -1 日 = extend left (modify from only), ▶ +1 日 = extend right (modify to only); AGENTS.md 永久 rule update (v0.5.4 → v0.5.5: 單邊 modify logic) |
| v0.5.6 | 2026-09-16 20:59 | 大少 reject v0.5.5 trigger「你很差啊， 現在加一日和減一日都用不了， 其他可以簡單處理， 你只要吧 To Date 改變一日， 然後再跑一次就可以了」 | **Brack Test ±1 日制 簡化 (修正 v0.5.5 太複雜)** — (a) **Root cause** v0.5.5 `_brackTestShiftDateHandler` Step 3 line 6441-6474 用「單邊 modify」邏輯 (◀ modify from only / ▶ modify to only), 但大少 reject 因為「現在加一日和減一日都用不了」 — 可能因為 dateFrom / dateTo empty trigger silent warn + return, 或者 date 唔合法, 或者 from > to 邊界 case. 大少要最簡單 logic: 兩個制都係 modify to date, from 永遠唔變; (b) **Frontend** `adapter.mjs` `window._brackTestShiftDateHandler` Step 3 line 6441-6457 簡化邏輯 — `newFrom = dateFrom` (from 永遠唔變), `newTo = _brackShiftDate(dateTo, delta)` (兩個制都用同一個 modify to date logic). Edge case (b) dateTo empty → silent warn + return (新加, ±1 日需要 to 存在). v0.5.4 auto-clamp spirit 保留: `newTo < K 線 first date` → auto-clamp + re-run, `newTo > K 線 last date` → auto-clamp + re-run. Edge case (e) from > to (極端 case: auto-clamp 之後 from 仲大過 to) → silent warn + return; (c) **Spec doc** §8.12 新加 + Change log v0.5.6 entry。對齊 §K-line Cache 永久 rule (8月22日 23:20) — K 線 first/last date 係 authoritative source (v0.5.4 auto-clamp spirit 保留); §M3 silent return 唔 throw spirit — edge case 保留 silent warn; §Backend hot-reeload 永久 rule (8月31日 11:01) — frontend only fix, backend 唔需要 restart; Cache bust `5.4.14` → `5.4.15`, `?v=2.3.209` → `?v=2.3.210` (對齊 21:24 cache bust self-check 永久 rule); 凡人話 verify: 大少 hard reload testing page (`?v=2.3.210`) + 撳跑 M1 (HK.00700) + date inputs 揀 [2000-01-01, 2026-08-07] + 撳「執行」→ 撳 ◀ -1 日 → date input to 變 `2026-08-06`, from 仲係 `2000-01-01`, re-run K 線 + ZigZag + P 點 + Brack Test verdict; 撳 ▶ +1 日 → console.log 印 `to (2026-08-08) 遲過 K 線最後一日 (2026-08-07), auto-clamp → 2026-08-07` + date input to 仲係 `2026-08-07`, from 仲係 `2000-01-01`, re-run. 凡人話解: 兩個制都係 modify to date, from 永遠唔變, 最簡單 logic; AGENTS.md 永久 rule update (v0.5.5 → v0.5.6: 簡化邏輯) |
| v0.5.7 | 2026-09-16 21:15 | 大少 reject v0.5.6 trigger「點解你改來改去做係有問題， 還是『多一日』的功能不能用」 + console log evidence `[Brack Test ±1 日] from (2010-01-01) 早過 K 線第一日 (2021-06-22), auto-clamp → 2021-06-22` | **Brack Test ±1 日制 拎走 v0.5.4 auto-clamp logic (修正 v0.5.6 嘅 from auto-clamp bug)** — (a) **Root cause** v0.5.6 嘅 Step 3 已經係最簡單邏輯 (`newFrom = dateFrom`, `newTo = _brackShiftDate(dateTo, delta)`, 兩個制都 modify to, from 唔變), 但 v0.5.4 嘅 Step 5 auto-clamp logic 仲 trigger from modify (因為 user 輸入嘅 `2010-01-01` 越界 K 線 first `2021-06-22`). 大少 case date `[2010-01-01, 2026-08-06]`, K 線 `[2021-06-22, 2026-08-06]`, 撳 ▶ +1 日 → Step 3 `newFrom = 2010-01-01` 唔變, `newTo = 2026-08-07` 越界 → Step 5 auto-clamp 觸發 `from (2010-01-01) 早過 K 線第一日 (2021-06-22), auto-clamp → 2021-06-22` (❌ 大少 reject 因為 modify from) + `to (2026-08-07) 遲過 K 線最後一日 (2026-08-06), auto-clamp → 2026-08-06` (❌ 大少 reject 因為 modify to). 大少 feedback「改好了後要做測試， 無問題才交給我」; (b) **Frontend** `adapter.mjs` `window._brackTestShiftDateHandler` Step 5 line 6479+ 拎走 v0.5.4 嘅 from + to auto-clamp logic — `if (newFrom < K 線 first date) auto-clamp` 同 `if (newTo > K 線 last date) auto-clamp` 兩段拎走. 兩個制都係 modify to date, from 永遠唔變. Backend KlineCache fetch K 線會自動用 K 線 actual range (越界 date 唔影響 verdict, 因為 KlineCache layer 已經 handle `start` + `end` query params). 對齊 §Config UX 模式 (2026-08-19 13:03) — user 揀過嘅 value 永遠要保留, 唔好 auto-clamp date input. Edge case (b) from > to (用戶 input date range 錯咗, from 早過 to) 保留 silent warn + return; (c) **Spec doc** §8.13 新加 + Change log v0.5.7 entry。對齊 §Config UX 模式 (2026-08-19 13:03) — user 揀過嘅 value 永遠要保留; §Backend hot-reload 永久 rule (8月31日 11:01) — frontend only fix, backend 唔需要 restart; Cache bust `5.4.15` → `5.4.16`, `?v=2.3.210` → `?v=2.3.211` (對齊 21:24 cache bust self-check 永久 rule); 凡人話 verify: 大少 hard reload testing page (`?v=2.3.211`) + 撳跑 M1 (HK.00700) + date inputs 揀 [2010-01-01, 2026-08-06] + 撳「執行」→ 撳 ▶ +1 日 → console.log 印 `re-run: new from=2010-01-01, new to=2026-08-07` + date input to 變 `2026-08-07`, from 仲係 `2010-01-01` (唔變, 因為 v0.5.7 拎走 auto-clamp) + re-run K 線 + ZigZag + P 點 + Brack Test verdict; 撳 ◀ -1 日 → console.log 印 `re-run: new from=2010-01-01, new to=2026-08-05` + date input to 變 `2026-08-05`, from 仲係 `2010-01-01` + re-run. 凡人話解: 兩個制都係 modify to date, from 永遠唔變, 唔再 auto-clamp (auto-clamp 違反 §Config UX 模式 spirit); AGENTS.md 永久 rule update (v0.5.6 → v0.5.7: 拎走 auto-clamp) |
| v0.7.0 | 2026-09-17 08:30 | 大少 trigger「在K線圖上方有一個Bracktest 提示"當前顯示: 強上升週期 (101 條 / 全部 614 條)" 裡邊有一個Popup提示是講這個sub-scenraio 是用什麼算法，但現在這個寫法不夠全面，請修改這個提示，我想要是直接的簡單算法，因為我要參考這些簡單算法去作出微調」 | **Brack Test cycle banner ⓘ tooltip 改寫成「直接簡單算法」trigger 條件** — (a) **Root cause** 而家 banner ⓘ tooltip 入面嘅 cycle 中文解釋用抽象嘅「Zmen X rule (A 連續 5 日 MA5 > MA60 等) + Layer 2 全部 MA 同方向 → mid_stage, 典型多頭排列確認」寫法, 大少睇唔到呢個 cycle 嘅實際 trigger 條件, 拎唔去參考微調 algorithm; (b) **Frontend** `adapter.mjs` line 6108-6130 嘅 `BRACK_TEST_CYCLE_EXPLANATIONS` 11 個 entry string 改寫, 由抽象嘅「Zmen X rule + Layer 2 Y」寫法改為直接列出 backend `ma_alignment/algorithm.py` line 477-680 嘅 11 個 elif trigger 條件 — (排列 bull/bear / 斜率正負 / P 點方向 + type / 拎幾多個 P 點 / spread ≥ thresholdPct 等). 大少撳 banner ⓘ icon 嗰陣即刻見到呢個 cycle 嘅 trigger 條件 (e.g.「強上升 trigger: 排列 bull (MA5 > MA10 > MA60) + 全部 MA 斜率正 + P1 > P3 (峰頂抬高) + P2 > P4 (谷底抬高) + P1/P3.type = Peak + P2/P4.type = Trough + 拎到 4 個 P 點」), 等佢可以拎呢啲直接簡單算法條件去微調 algorithm; (c) **Spec doc** §7 對齊永久 rule checklist 加返 v0.7.0 entry + Change log v0.7.0 entry。對齊 §M1 sub-scenario 永久 rule (8月16日 19:21) sub_scenario display 改動即 update spec doc; §Backend hot-reload 永久 rule (8月31日 11:01) — backend 唔需要改 (純 frontend display string 改動); Cache bust `5.4.16` → `5.4.17`, `?v=2.3.211` → `?v=2.3.212` (對齊 21:24 cache bust self-check 永久 rule); 凡人話 verify scope 對齊 §M3 trendline chart overlay 修復永久 rule 9月6日 16:47 凡人話肉眼 verify spirit (大少 hard reload testing page `?v=2.3.212` + 撳跑 M1 (HK.00700) + 撳「🎯 跑 Brack Test」 + 撳 banner ⓘ icon → tooltip panel 應該見到 11 個 cycle 嘅直接簡單算法 trigger 條件, 而唔係抽象嘅「Zmen X rule + Layer 2 Y」寫法). ⚠️ 條件 key (排列 / 斜率正負 / P 點方向) 唔可以隨意調, 改咗要同步改 backend `ma_alignment/algorithm.py` 同 spec doc `M1-V22-RESEARCH.md` §3-§5 || v0.8.0 | 2026-09-17 13:38 | 大少 trigger「圖中你會見到強上升週期 #208 這個 #208 應該要對應返在 bracktest 結果例表裡的 Index. 你研究一下可以怎樣做」 | **Brack Test chart marker label #N 對齊結果例表 Index** — (a) **Root cause** `adapter.mjs` `renderBrackTestChartOverlay` line 5909 (改之前) 用 backend emit 嘅 `h.displayIndex` (1..N global sort by date_desc) 顯示 chart marker text label, **無處理 mode B 揀 cycle filter 嘅 case**. 凡人話: 大少睇到圖中「強上升週期 #208」其實係 backend global 第 208 個 hit, 但例表第 1 個「強上升」hit 係 Index 1, 兩者完全對唔上. Mode A (activeCycle='all') backend global Index 同例表 Index 對齊 ✅, 但 Mode B (activeCycle='cycle X') 例表用 frontend local `viewIdx + 1` filtered Index, chart marker 卻用 backend global ❌; (b) **Frontend** `adapter.mjs` `renderBrackTestChartOverlay` line 5871+ 改 text 公式 — `filteredHits.map((h, viewIdx) => { ... })` 加 viewIdx + `isFilteredChart = activeCycle && activeCycle !== 'all'` + `markerIndex = isFilteredChart ? (viewIdx + 1) : (h.displayIndex ?? (viewIdx + 1))` + text 用 `markerIndex` 對齊例表 Index, 對齊 `renderBrackTestHitTable` line 5986 一樣嘅 pattern (DRY spirit 兩處 source of truth 統一); (c) **Frontend** 加 console.log 凡人話 visual evidence (對齊 §M3 trendline chart overlay 修復永久 rule 9月6日 16:47 spirit) — log 頭尾 marker 嘅 text + `isFiltered` flag, 等大少肉眼 verify chart marker #N 對齊例表 row N 嘅日期; (d) **Spec doc** §4.1 Frontend 規則段加 chart overlay marker label 規則 + consistency check rule 段加 chart label 對齊 + 新加 §4.2 v0.8.0 section (大少 13:38 trigger 永久記錄)。對齊 §M3 trendline chart overlay 修復永久 rule 9月6日 16:47 — chart overlay 凡人話肉眼 verify scope; §M1 sub-scenario 永久 rule 8月16日 19:21 — 改任何 sub_scenario / display / UI 必 update spec doc (本段 §4.2 已加); §Backend 永久改 emit field name 永久 rule 9月10日 23:45 spirit — frontend 唔可以假設 backend global field 直接 render 落 filter view, 必先 check filter state (`isFiltered`); §Backend hot-reload 永久 rule 8月31日 11:01 — frontend only fix, backend 唔需要 restart (Backend `m1_brack_test/algorithm.py` 唔需要改, `displayIndex` global emit 仍然 work); Cache bust `5.4.18` → `5.4.19`, `?v=2.3.213` → `?v=2.3.214` (對齊 21:24 cache bust self-check 永久 rule); 凡人話 verify scope 對齊 §M3 trendline chart overlay 修復永久 rule 9月6日 16:47 凡人話肉眼 verify spirit (大少 hard reload testing page `?v=2.3.214` + 撳跑 M1 (HK.00700) + 撳「🎯 跑 Brack Test」→ 預設 Mode B (Tab B「按 sub-scenario 揀」, activeCycle='strong_uptrend') → 肉眼 verify chart 上面 marker text 應該見「強上升週期 #1」、「強上升週期 #2」...「強上升週期 #M」(M = 強上升 filtered 數量), 每個 #N 對應例表入面第 N row 嘅日期 ✅; 切去 Mode A (Tab A「按時間排」) → 肉眼 verify chart 上面 marker text 應該見「強上升週期 #208」、「下跌反彈週期 #209」(backend global index), 每個 #N 對應例表入面第 N row 嘅日期 ✅). Backend curl evidence: `curl -s 'http://localhost:18792/api/algorithms/run?algo=m1_brack_test&symbol=HK.00700&data_window_days=1260' | jq '.points[] | select(.cycle == "strong_uptrend") | {date, displayIndex}' | head -5` → 第 1 row (date 最新) 嘅 displayIndex = global 排第 N (大數字, e.g. 208) |

| v0.9.0 | 2026-09-18 00:14 | 大少 forward 2 張 image + trigger「你理解錯了我想做的東西, 圖1是指定日期跑的Bracktest, 但少了圖2紅框內的東西, 你能補上嗎」 | **Brack Test card 補回 State 分佈 + cycle breakdown 6 個獨立 box grid (對齊 image 2 紅框內嘅 6 個獨立 box 排版)** — (a) **Root cause** 大少 trigger「backtest 修正, 在指定的日期內跑, 也要有『按 sub-scenario 揀』和 sub-scenario 選項, 『📅 按時間排』」原本理解為 M9 Back Test ( 即「回測驗證 / 第九模組」) 而改了 7 個文件. 大少 push back 後 forward 2 張 image 確認實際 context 係 Brack Test card ( 屬於 M1 sub-task) 而唔係 M9 Back Test. Image 1 (Brack Test card 撳跑之前) 只有 date range 跑 UI; Image 2 (Brack Test card 撳跑之後) 有「🎯 按 sub-scenario 揀」+「📅 按時間排」2 個 tab +「🟢 強上升」dropdown + State 分佈 box + 5 個 cycle 獨立 box + filter info + 結果例表. 大少 trigger: 撳 date range 跑之後,缺少 image 2 嘅 UI. 同時確認我之前嘅 M9 Back Test v0.7.0 改動係理解錯嘅 task, 需要 revert; (b) **Revert M9 Back Test v0.7.0 改動** — backend  拎走  +  2 個 Query params + options dict 注入; backend  拎走 sub-scenario filter + sort by date 邏輯 +  +  拎走 subScenarios + sortBy 落  (curl evidence 揭發唔 propagate → filter 失效, §Array 邏輯必先 curl evidence 確認排法 永久 rule 8月31日 13:14); adapter.mjs  拎走 4 個新 fields (dateFrom / dateTo / subScenarios / sortBy) + analyze URLSearchParams 拎走 4 個新 params + 拎走 spread frontendShape + renderResult Section 1 header 拎走 v0.7.0 inline summary banner; testing-page.js 拎走 3 個 render function (renderDate + renderRadio + renderMultiSelectChips) + renderInput switch 拎走 3 個 case; MODULE-09-BACK-TEST.md 拎走 §15 v0.7.0 section; (c) **新加 Brack Test card 6 個獨立 box grid** — adapter.mjs  拆 2 個 function (renderBrackTestSummary 拎 summary 文字 only, renderBrackTestBreakdownGrid 拎 grid HTML); renderBrackTestBreakdownGrid 拎走 v0.2.1  inline 寫法, 改用  6 個獨立 box (1 個 State 分佈 box + 5 個 cycle 獨立 box) 對齊 image 2 紅框內嘅 6 個獨立 box 排版; backend  emit  11 個 cycle count, filter value 0 + sideways 拎返 5 個 cycle (對齊 image 2 紅框內嘅 5 個 cycle box display); 凡人話: 拎 cycle 嘅 color 做 box 左 border, 內含 cycle label + count; (d) **CSS 加  grid layout** —  line 5753-5760 加   +   +   (State 分佈 box 跨 2 column 對齊 image 2 排版); (e) ** 分別 query  +  element inject** — 對齊 §Backend 永久改 emit field name 之後 frontend 必先 grep 全 reference 對齊永久 rule (9月10日 23:45) spirit — frontend 拎 backend emit field 優先; (f) **Spec doc** 本段 Change log v0.9.0 entry。對齊 §M1 sub-scenario 永久 rule (8月16日 19:21) — cycle breakdown display 改動即 update spec doc; §Array 邏輯必先 curl evidence 確認排法 永久 rule (8月31日 13:14) — backend emit 11 個 cycle count, filter value 0 + sideways 拎返 5 個 cycle; §Backend hot-reload 永久 rule (8月31日 11:01) — Revert M9 Back Test 改動之後需要 restart backend ([00:22:01] Starting StockPulse backend (background)...
✅ Backend 跑緊喺 http://localhost:18792
Log file: /tmp/sp.log

Vite dev server frontend (if running):
  - http://localhost:3000/algorithms (StockPulse AS-01 panel)

Stop backend:
  pkill -9 -f 'main.py'; pkill -9 -f 'uvicorn') + curl verify (已 restart + curl verify backend 拎返正常 verdict 拎返冇 filter 冇 sort 嘅 results + silent fallback); Cache bust  → ,  →  (對齊 21:24 cache bust self-check 永久 rule); 凡人話 verify scope 對齊 §M3 trendline chart overlay 修復永久 rule 9月6日 16:47 — frontend render silent return 唔 throw 凡人話肉眼 verify: 大少 hard reload testing page () + 撳跑 M1 (HK.00700) + 撳「🎯 跑 Brack Test」→ 肉眼 verify brack-test-panel 入面有 image 2 紅框內嘅 6 個獨立 box (1 個 State 分佈 box 跨 2 column + 5 個 cycle 獨立 box, 每個 cycle box 左 border 用 cycle color); 撳 date range「執行」+ ◀ -1 日 + +1 日 ▶ → 結果區 render 對齊 image 2 紅框. Reusable lesson (cross-task, agent memory): 大少 trigger「backtest」可能指 Brack Test 而唔係 M9 Back Test, frontend UI context 重要, trigger keyword 唔可以假設對應固定 module. Plan Mode 永遠要 plan + investigate 之後先 ExitPlanMode. ⚠️ 改 renderBrackTestSummary 拎走 slice top 5 之前必先用 curl 拎 backend verdict 確認  11 個 cycle 全部 emit (對齊 §Array 邏輯必先 curl evidence 確認排法 永久 rule 8月31日 13:14) |
| v0.9.0 | 2026-09-18 00:14 | 大少 forward 2 張 image + trigger「你理解錯了我想做的東西, 圖1是指定日期跑的Bracktest, 但少了圖2紅框內的東西, 你能補上嗎」 | **Brack Test card 補回 State 分佈 + cycle breakdown 6 個獨立 box grid (對齊 image 2 紅框內嘅 6 個獨立 box 排版)** — (a) **Root cause** 大少 trigger「backtest 修正, 在指定的日期內跑, 也要有『按 sub-scenario 揀』和 sub-scenario 選項, 『📅 按時間排』」原本理解為 M9 Back Test (`back_test` 即「回測驗證 / 第九模組」) 而改了 7 個文件. 大少 push back 後 forward 2 張 image 確認實際 context 係 Brack Test card (`m1_brack_test` 屬於 M1 sub-task) 而唔係 M9 Back Test. Image 1 (Brack Test card 撳跑之前) 只有 date range 跑 UI; Image 2 (Brack Test card 撳跑之後) 有「🎯 按 sub-scenario 揀」+「📅 按時間排」2 個 tab +「🟢 強上升」dropdown + State 分佈 box + 5 個 cycle 獨立 box + filter info + 結果例表. 大少 trigger: 撳 date range 跑之後, 缺少 image 2 嘅 UI. 同時確認我之前嘅 M9 Back Test v0.7.0 改動係理解錯嘅 task, 需要 revert; (b) **Revert M9 Back Test v0.7.0 改動** — backend `api/algorithms.py` 拎走 `sub_scenarios` + `sort_by` 2 個 Query params + options dict 注入; backend `back_test/algorithm.py` 拎走 sub-scenario filter + sort by date 邏輯 + `run_walk_forward_cv` + `BackTestAlgorithm.run()` 拎走 subScenarios + sortBy 落 `validate_replay_config` (curl evidence 揭發唔 propagate → filter 失效, §Array 邏輯必先 curl evidence 確認排法 永久 rule 8月31日 13:14); adapter.mjs `backTestAdapter.inputs` 拎走 4 個新 fields (dateFrom / dateTo / subScenarios / sortBy) + analyze URLSearchParams 拎走 4 個新 params + 拎走 spread frontendShape + renderResult Section 1 header 拎走 v0.7.0 inline summary banner; testing-page.js 拎走 3 個 render function (renderDate + renderRadio + renderMultiSelectChips) + renderInput switch 拎走 3 個 case; MODULE-09-BACK-TEST.md 拎走 §15 v0.7.0 section; (c) **新加 Brack Test card 6 個獨立 box grid** — adapter.mjs `renderBrackTestSummary` 拆 2 個 function (renderBrackTestSummary 拎 summary 文字 only, renderBrackTestBreakdownGrid 拎 grid HTML); renderBrackTestBreakdownGrid 拎走 v0.2.1 `.breakdown-mini` inline 寫法, 改用 `.brack-breakdown-grid` 6 個獨立 box (1 個 State 分佈 box + 5 個 cycle 獨立 box) 對齊 image 2 紅框內嘅 6 個獨立 box 排版; backend `m1_brack_test/algorithm.py` emit `meta.breakdownByCycle` 11 個 cycle count, filter value 0 + sideways 拎返 5 個 cycle (對齊 image 2 紅框內嘅 5 個 cycle box display); 凡人話: 拎 cycle 嘅 color 做 box 左 border, 內含 cycle label + count; (d) **CSS 加 `.brack-breakdown-grid` grid layout** — `adapter.mjs` line 5753-5760 加 `.brack-breakdown-grid` `display:grid; grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:8px` + `.brack-breakdown-box` `background:#fff3e0; border:1px solid #ffcc80; border-radius:6px; padding:8px 12px; font-size:13px` + `.brack-breakdown-state` `grid-column:span 2` (State 分佈 box 跨 2 column 對齊 image 2 排版); (e) **`_renderBrackTestVerdict` 分別 query `.brack-summary` + `.brack-breakdown` element inject** — 對齊 §Backend 永久改 emit field name 之後 frontend 必先 grep 全 reference 對齊永久 rule (9月10日 23:45) spirit — frontend 拎 backend emit field 優先; (f) **Spec doc** 本段 Change log v0.9.0 entry。對齊 §M1 sub-scenario 永久 rule (8月16日 19:21) — cycle breakdown display 改動即 update spec doc; §Array 邏輯必先 curl evidence 確認排法 永久 rule (8月31日 13:14) — backend emit 11 個 cycle count, filter value 0 + sideways 拎返 5 個 cycle; §Backend hot-reload 永久 rule (8月31日 11:01) — Revert M9 Back Test 改動之後需要 restart backend (`./start.sh`) + curl verify (已 restart + curl verify backend 拎返正常 verdict 拎返冇 filter 冇 sort 嘅 results + silent fallback); Cache bust `5.4.19` → `5.4.20`, `?v=2.3.214` → `?v=2.3.215` (對齊 21:24 cache bust self-check 永久 rule); 凡人話 verify scope 對齊 §M3 trendline chart overlay 修復永久 rule 9月6日 16:47 — frontend render silent return 唔 throw 凡人話肉眼 verify: 大少 hard reload testing page (`?v=2.3.215`) + 撳跑 M1 (HK.00700) + 撳「🎯 跑 Brack Test」→ 肉眼 verify brack-test-panel 入面有 image 2 紅框內嘅 6 個獨立 box (1 個 State 分佈 box 跨 2 column + 5 個 cycle 獨立 box, 每個 cycle box 左 border 用 cycle color); 撳 date range「執行」+ ◀ -1 日 + +1 日 ▶ → 結果區 render 對齊 image 2 紅框. Reusable lesson (cross-task, agent memory): 大少 trigger「backtest」可能指 Brack Test 而唔係 M9 Back Test, frontend UI context 重要, trigger keyword 唔可以假設對應固定 module. Plan Mode 永遠要 plan + investigate 之後先 ExitPlanMode. ⚠️ 改 renderBrackTestSummary 拎走 slice top 5 之前必先用 curl 拎 backend verdict 確認 `meta.breakdownByCycle` 11 個 cycle 全部 emit (對齊 §Array 邏輯必先 curl evidence 確認排法 永久 rule 8月31日 13:14) |

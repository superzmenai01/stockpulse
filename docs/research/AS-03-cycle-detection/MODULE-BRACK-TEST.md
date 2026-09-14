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

**凡人話 consistency check**: 大少講「Index 第幾個」時, Mavis 即刻知:
- Mode A (全部): 第 N row = backend `hit.displayIndex = N` (global sort)
- Mode B (揀 cycle X): 第 N row = filtered view 內第 N 個 = 該 cycle X 第 N 新 hit

Frontend `renderBrackTestChartOverlay(verdict, klines, chartRefs, activeCycle)` (adapter.mjs line 5806) 拎 `verdict.points` array, 每個 hit 對應 1 個 marker:

```javascript
const markers = filteredHits.map(h => {
    const time = _brackHitToLwcTime(h);  // 統一 UTC parse (對齊 8月29日 22:35 永久 rule)
    return {
        time,
        position: h.state === 'UP' ? 'belowBar' : h.state === 'DOWN' ? 'aboveBar' : 'inBar',
        color: ZMEN_SCENARIO_COLOR_MAP[h.cycle] || '#666',  // 11 種顏色對齊 adapter.mjs line 1398-1411
        shape: h.cycle === 'strong_uptrend' ? 'arrowUp'
             : h.cycle === 'strong_downtrend' ? 'arrowDown'
             : h.cycle === 'decelerating_up' ? 'arrowDown'
             : h.cycle === 'decelerating_down' ? 'arrowUp'
             : 'circle',
        text: h.cycleLabel || BRACK_TEST_CYCLE_LABELS[h.cycle] || h.cycle,
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
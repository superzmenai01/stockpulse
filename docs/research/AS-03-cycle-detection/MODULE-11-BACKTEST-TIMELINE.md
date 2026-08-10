# AS-03 · Module 11: Backtest Timeline (時光機時序圖)

> **對應 module**: `~/stockpulse/algorithms/AS-03-cycle-detection/modules/backtest-timeline.ts` (M11 v0.1.0 impl pending)
> **對應 tests**: `~/stockpulse/algorithms/AS-03-cycle-detection/tests/test-backtest-timeline.mjs` (10+ assertions, pending)
> **對應 adapter**: `~/stockpulse/algorithms/AS-03-cycle-detection/adapter.mjs` (`backtestTimelineAdapter` v0.1.0, pending)
> **Stage**: **Stage 2 第三次 focus** (大少 2026-08-09 21:24 確認 Stage 2 重新 plan, 升級原本 Stage 4)
> **Workflow**: 大少永久 7 步 (spec → code → test → verify → testing page → doc → commit)
> **大少 2026-08-10 00:04 指示**: 4 個 design decision confirm 全 A — 90 日 default + 整合版 (verdict + forward return + Trade Journal 啱錯) + Testing page 獨立 entry + Date range filter chip

---

## 1. 點解呢個 module (Why)

M9 Back Test Engine (Sprint 3 done 2026-08-08 23:55) 累積咗 forward return predictions 落永久 cache, 加上 Trade Journal MVP + Followup (Stage 1+ done 2026-08-09) 大少可以 mark 啱錯 — 但**兩個 data source 都係 raw 數據**, 大少睇唔到:

1. **時間維度** — 「過去 3 個月 verdict 嘅時序」係點? 邊一日係「黃金買點」?
2. **預測 vs 實戰對比** — M9 預測 fwd5 > 0, 大少真實 mark 啱/錯, 兩者對比睇 algorithm 準唔準
3. **Action 分佈** — 過去 verdict 嘅 BUY/SELL/HOLD/WAIT/REDUCE 分佈, 睇 algorithm 偏唔偏一邊
4. **Hit rate 走勢** — 過去 hit rate 隨時間變化, 睇 algorithm 越嚟越準定越嚟越走樣

呢個 module = **時光機時序圖**:
- M9 後勤部: 「每次 verdict 嘅 forward return prediction 永久 cache」
- Trade Journal 大少: 「我真實 mark 啱錯嘅實戰記錄」
- **M11 戰情室**: 將兩個 data source 對齊時間線, 視覺化顯示畀大少睇, 拎到「邊一日係最佳時機」嘅 insight

> **大少需求 (2026-08-08 10:06 ROADMAP §0)**:
> - 「比較過去 vs 當下」 — M11 直接 cover
> - 「學習功能」 — M11 + Trade Journal + M9 cache 三位一體嘅 learning 機制嘅視覺化入口

---

## 2. Stage 2 第三次 focus context

### 原本 Stage 4 → 升做 Stage 2 第三次 focus

ROADMAP §1 Stage 排程原本寫 Stage 4 (Entry Timing + Backtest Timeline), 但大少 2026-08-09 21:24 重新 plan 整個 Stage 2 嘅排程:

| # | Module | Stage 2 重新 plan 排程 | 狀態 |
|---|--------|----------------------|------|
| 🥇 | M5 Multi-TF (日/週/月) | Stage 2 第一次 focus | ✅ done 2026-08-09 (commit 33b785be) |
| 🥈 | 舊 M8 SlopeMomentum | Stage 2 第二次 focus | ✅ done 2026-08-09 (commit 337a77b9) |
| 🥉 | **M11 Backtest Timeline** | **Stage 2 第三次 focus** | 🚧 **v0.1.0 spec 進行中** |
| 4 | M12 Risk-Reward | Stage 2 第四次 focus | ⏳ pending (等 M11 done) |

### 7 步 workflow (大少永久 rule)

1. ✅ Spec (本文件)
2. ⏳ Implementation — `modules/backtest-timeline.ts` + esbuild bundle
3. ⏳ Tests — 10+ test cases (data 不足 / 正常 / 邊界 / 整合)
4. ⏳ Verify — node --check + 跑晒所有 tests (唔可以 break 其他)
5. ⏳ Testing page update — `adapter.mjs` 加 `backtestTimelineAdapter` + renderTimeline + dropdown entry
6. ⏳ Doc sync — `ARCHITECTURE.md` §15 + `ROADMAP.md` §8 + `HANDOVER.md` §5
7. ⏳ Commit + push — 一個 module 一個 commit (atomic), `feat(as03-m11-timeline): ...`

---

## 3. 4 個 Design Decision (大少 00:04 confirm 全 A)

### D1: 時間範圍 default — A (90 日, 跟 ROADMAP §3)
- **A (揀)**: 90 日 default + filter chip 俾大少自己揀 30/90/180/365
  - 跟 ROADMAP §3 原本 default (過去 90 日 verdict timeline)
  - Chip 一鍵切換, testing page 唔需要重新 fetch (client-side filter)
- B: 180 日 default
- C: 365 日 default

**理由**: 90 日中等密度, 數據夠多但唔會太長擠迫 UI; chip filter 俾大少自己揀更長/更短。

### D2: 顯示內容 complexity — B (整合版)
- **B (揀)**: A + Trade Journal 大少 mark 嘅啱錯
  - verdict + forward return (5/10/20 日) + hit/miss 標記
  - **+ Trade Journal 啱錯 overlay (1-5 scale)**
  - 對比預測 vs 實戰, 最有 learning 價值
- A: 簡單版 (淨係 verdict + forward return, 唔整合 Trade Journal)
- C: Full 版 (B + 累計回報 + drawdown)

**理由**: Trade Journal 已經有 data, 唔整合等於嘥咗; Full 版 (C) 太多嘢可能 overload 大少嘅眼睛。Stage 2+ 30 樣本後 tune 嗰陣先考慮 Full 版。

### D3: UI 位置 — A (Testing page 獨立 entry)
- **A (揀)**: Testing page 1 個獨立 entry, id='AS-03-BTL', dropdown 揀
  - 跟 M9 (`AS-03-BT`) pattern
  - 大少手動 verify testing page
  - **dropdown UX bug (select onchange 唔 fire) 順手 fix**: 改用 radio chip 取代 select dropdown
- B: Main frontend 獨立 page (`/backtest-timeline?symbol=HK.00700`)
- C: Testing page 內嵌 (喺其他 algo result 底部加 sub-section)

**理由**: 跟 M9 precedent, 開發成本低; 順手修 dropdown UX bug (受益所有 algorithm); main frontend 改動比較大, Stage 2+ 先考慮。

### D4: 互動 / Filter 程度 — B (Date range filter chip)
- **B (揀)**: 30/90/180/365 chip 一鍵切換
  - Client-side filter (唔需要重新 fetch)
  - 簡單互動, 唔加複雜 filter
- A: Static
- C: Action filter (BUY/SELL/WAIT chip)
- D: Annotate (mark 最佳時機入 Trade Journal)

**理由**: 簡單 chip 互動, 已經 cover 大少最 common use case (睇唔同時間範圍); C/D 留返 Stage 2+ 擴展。

---

## 4. Data Source + Schema

### 4.1 Forward Return History (來源: M9 Back Test 永久 cache)

**API endpoint**: `GET /api/adaptive-params/{symbol}/forward-return`

**Response (M9 done 永久 cache)**:
```json
{
  "history": [
    {
      "date": "2026-05-15",
      "action": "BUY",
      "fwd5": 2.34,
      "fwd10": 4.12,
      "fwd20": 5.67,
      "hit": true
    },
    {
      "date": "2026-05-20",
      "action": "WAIT",
      "fwd5": -0.45,
      "fwd10": -1.23,
      "fwd20": -2.10,
      "hit": false
    }
  ],
  "stats": {
    "count": 47,
    "avgFwd5": 0.82,
    "avgFwd10": 1.45,
    "avgFwd20": 2.31,
    "hitRate5d": 0.62,
    "hitRate10d": 0.58,
    "hitRate20d": 0.55
  }
}
```

**Data retention**: 永久保留 (M9 永久 rule)

### 4.2 Trade Journal Records (來源: J Trade Journal + Followup)

**API endpoint**: `GET /api/trade-journal?symbol=HK.00700&limit=200`

**Response (J done)**:
```json
{
  "entries": [
    {
      "id": 1,
      "symbol": "HK.00700",
      "entry_date": "2026-05-15",
      "entry_price": 380.50,
      "shares": 100.0,
      "target_price": 420.00,
      "stop_loss": 365.00,
      "notes": "M8 verdict BUY, MA5/10 alignment strong",
      "created_at": "2026-05-15 10:30:00",
      "mark_correct": 4,
      "mark_wrong": null,
      "mark_scale": null
    }
  ],
  "count": 1
}
```

**Data retention**: 永久保留 (Stage 1+ 永久 rule)

### 4.3 M11 內部 Schema

```typescript
// 對齊後嘅 timeline data point
export interface TimelineDataPoint {
  date: string;                    // YYYY-MM-DD
  // 來自 M9 forward return
  action: string;                  // BUY/ADD/HOLD/REDUCE/SELL/WAIT/TRAP/TRANSITION
  fwd5: number | null;             // % (null if 數據不足)
  fwd10: number | null;
  fwd20: number | null;
  hit: boolean | null;             // fwd5 > 0 (null if 數據不足)
  // 來自 Trade Journal
  journalEntry: TradeJournalEntry | null;  // null if 大少冇 mark
  markCorrect: number | null;      // 1-5 scale, null if 冇 mark
  markWrong: number | null;
  markScale: number | null;
  // M11 計算
  predictionVsActual: 'MATCH' | 'PARTIAL' | 'MISS' | 'NO_JOURNAL';
  // 視覺化 metadata
  color: string;                   // 6 色標 (見 §8)
  isGoldenEntry: boolean;          // 標記「最佳時機」(fwd5 ≥ 3% + hit + journal mark 4-5)
}

// 整個 timeline result
export interface TimelineResult {
  symbol: string;
  dateRange: { start: string; end: string; days: number };
  totalPoints: number;             // timeline 上面有幾多個 data point
  dataPoints: TimelineDataPoint[]; // 已經 sort by date ascending
  // Stats summary
  stats: {
    totalVerdicts: number;
    totalJournalEntries: number;
    hitRate5d: number | null;      // 過去 N 日 hit rate
    avgFwd5: number | null;
    avgFwd10: number | null;
    avgFwd20: number | null;
    actionBreakdown: Record<string, number>;  // 8 個 finalAction count
    matchBreakdown: Record<PredictionVsActual, number>;  // MATCH/PARTIAL/MISS/NO_JOURNAL
    goldenEntries: number;         // 最佳時機 count
  };
  // 對齊 metadata
  meta: {
    forwardReturnCount: number;    // 拎到幾多個 M9 forward return records
    journalCount: number;          // 拎到幾多個 Trade Journal records
    dateRangeUsed: number;         // 實際用咗幾多日 (90 default)
    dataLimited: boolean;          // true if < requested days
  };
}
```

---

## 5. Inputs / Outputs

### 5.1 Input

```typescript
export interface BacktestTimelineInput {
  symbol: string;                  // 'HK.00700' / 'US.AAPL'
  dateRange?: number;              // 30 / 90 / 180 / 365, default 90
  // 內部 use, caller 唔需要 set
  forwardReturnHistory?: ForwardReturnRecord[];   // 從 API 拎, 永久 cache
  tradeJournalEntries?: TradeJournalEntry[];      // 從 API 拎, 永久 cache
}
```

### 5.2 Output

```typescript
export interface BacktestTimelineOutput {
  result: TimelineResult;
  // Testing page UI hint
  displayHint: {
    defaultView: 'TIMELINE';       // 永遠 full show 4 個 sections
    sections: ['TIMELINE_CHART', 'STATS', 'JOURNAL_OVERLAY', 'GOLDEN_ENTRIES'];
    llmHookReady: true;            // 大少永久 rule (預留 LLM 解讀 hook)
  };
}
```

### 5.3 ModuleId

```typescript
moduleId: 'backtest-timeline';     // 永遠固定
version: '0.1.0';                  // spec v0.1.0
```

---

## 6. Algorithm — 5 個 step

### Step 1: 拎 Forward Return History
```typescript
async function step1_fetchForwardReturn(symbol: string, days: number): Promise<ForwardReturnRecord[]> {
  const response = await fetch(`/api/adaptive-params/${symbol}/forward-return`);
  const data = await response.json();
  return (data.history || []).filter(r => isWithinDays(r.date, days));
}
```

### Step 2: 拎 Trade Journal Records
```typescript
async function step2_fetchTradeJournal(symbol: string, days: number): Promise<TradeJournalEntry[]> {
  const response = await fetch(`/api/trade-journal?symbol=${symbol}&limit=200`);
  const data = await response.json();
  return (data.entries || []).filter(e => isWithinDays(e.entry_date, days));
}
```

### Step 3: 對齊日期 (Date Alignment)
```typescript
function step3_alignDates(
  forwardReturns: ForwardReturnRecord[],
  journalEntries: TradeJournalEntry[]
): TimelineDataPoint[] {
  // 以 forward return 為主軸, 因為每日都有 verdict
  // Trade Journal entry_date 對齊返 verdict 嗰日
  return forwardReturns.map(fr => {
    const journalMatch = journalEntries.find(j => j.entry_date === fr.date);
    return {
      date: fr.date,
      action: fr.action,
      fwd5: fr.fwd5,
      fwd10: fr.fwd10,
      fwd20: fr.fwd20,
      hit: fr.hit,
      journalEntry: journalMatch || null,
      markCorrect: journalMatch?.mark_correct ?? null,
      markWrong: journalMatch?.mark_wrong ?? null,
      markScale: journalMatch?.mark_scale ?? null,
      predictionVsActual: computeMatch(fr, journalMatch),
      color: '',  // Step 4 set
      isGoldenEntry: false,  // Step 4 set
    };
  });
}
```

### Step 4: 計算整合 View (color + golden entry)
```typescript
function step4_computeView(dataPoints: TimelineDataPoint[]): TimelineDataPoint[] {
  return dataPoints.map(dp => ({
    ...dp,
    color: getActionColor(dp.action, dp.hit, dp.journalEntry),  // 6 色標 (見 §8)
    isGoldenEntry: isGoldenEntry(dp),  // fwd5 ≥ 3% + hit + journal mark 4-5
  }));
}

function isGoldenEntry(dp: TimelineDataPoint): boolean {
  return (
    dp.fwd5 !== null && dp.fwd5 >= 3.0 &&   // 5 日內升 ≥ 3%
    dp.hit === true &&                       // hit rate true
    dp.markCorrect !== null && dp.markCorrect >= 4  // 大少 mark 4-5
  );
}
```

### Step 5: 計算 Stats Summary
```typescript
function step5_computeStats(dataPoints: TimelineDataPoint[]): TimelineStats {
  const validFwd5 = dataPoints.filter(d => d.fwd5 !== null);
  const hits = validFwd5.filter(d => d.hit === true);
  const journalEntries = dataPoints.filter(d => d.journalEntry !== null);
  const goldenEntries = dataPoints.filter(d => d.isGoldenEntry);

  return {
    totalVerdicts: dataPoints.length,
    totalJournalEntries: journalEntries.length,
    hitRate5d: hits.length / validFwd5.length,  // null if 0 valid
    avgFwd5: avg(validFwd5.map(d => d.fwd5)),
    avgFwd10: avg(dataPoints.filter(d => d.fwd10 !== null).map(d => d.fwd10)),
    avgFwd20: avg(dataPoints.filter(d => d.fwd20 !== null).map(d => d.fwd20)),
    actionBreakdown: countBy(dataPoints, 'action'),
    matchBreakdown: countBy(dataPoints, 'predictionVsActual'),
    goldenEntries: goldenEntries.length,
  };
}

function computeMatch(fr: ForwardReturnRecord, j: TradeJournalEntry | null): PredictionVsActual {
  if (!j) return 'NO_JOURNAL';
  if (fr.hit && j.mark_correct !== null) return 'MATCH';
  if (!fr.hit && j.mark_wrong !== null) return 'MATCH';
  if (fr.hit && j.mark_wrong !== null) return 'MISS';
  if (!fr.hit && j.mark_correct !== null) return 'PARTIAL';
  return 'NO_JOURNAL';
}
```

---

## 7. UI 結構 (testing page entry 11 — AS-03-BTL)

### 7.1 Testing Page Entry

**REGISTRY** (testing-page.js, 跟 M9 entry pattern):
```javascript
{
  id: 'AS-03-BTL',                    // 跟 M9 (AS-03-BT) 命名
  displayName: 'M11 時光機時序圖',     // 繁體人話
  version: '0.1.0',
  stage: 'Stage 2 (第三次 focus)',
  description: '過去 N 日 verdict + forward return + Trade Journal 啱錯 timeline',
  defaultSymbol: 'HK.00700',         // 大少最熟
  defaultDateRange: 90,              // D1 揀 A
  inputs: [
    { key: 'symbol', type: 'text', default: 'HK.00700', label: '股票代碼' },
    { key: 'dateRange', type: 'chip', default: 90, label: '時間範圍', options: [30, 90, 180, 365] },
  ],
}
```

### 7.2 永遠 full show 4 個 sections (大少 11:57 永久 rule)

> 跟 M9 嘅 4 個 sections 永遠 full show, 唔用 toggle 收埋

**Section 1: Timeline Chart (SVG 互動圖)**
- X 軸: 日期 (過去 30/90/180/365 日)
- Y 軸: 8 個 finalAction (BUY/ADD/HOLD/REDUCE/SELL/WAIT/TRAP/TRANSITION) 對應色塊
- 每個 data point = 1 個方塊, color 由 §8 6 色標決定
- 點擊方塊 → 顯示 detail popup (date, action, fwd5, fwd10, fwd20, hit, journal mark)
- Golden entry 用星號 ★ 標記

**Section 2: Stats Panel (數字摘要)**
- Total verdicts (N 個)
- Total journal entries (M 個, M ≤ N)
- Hit rate 5d (%)
- Avg fwd5 / fwd10 / fwd20 (%)
- Action breakdown (8 個 finalAction count)
- Match breakdown (MATCH/PARTIAL/MISS/NO_JOURNAL)
- Golden entries count

**Section 3: Trade Journal Overlay (啱錯對比)**
- 對齊 date 嘅 journal entries, 顯示:
  - 大少 mark 啱 (1-5) 嘅綠色 bar (高度 = scale)
  - 大少 mark 錯 (1-5) 嘅紅色 bar (高度 = scale)
  - 冇 mark 嘅灰色 placeholder
- 同 §1 timeline 對齊 (同一日, 啱錯 overlay)

**Section 4: Golden Entries (最佳時機)**
- 列出所有 `isGoldenEntry=true` 嘅 data points
- 每個顯示: date, action, fwd5%, journal mark 評分, notes
- 大少可以快速 review 邊一日係「最佳時機」

### 7.3 Date Range Filter Chip (D4 揀 B)
- 4 個 chip: `[30 日] [90 日 (default)] [180 日] [365 日]`
- 一鍵切換, **client-side filter** (唔需要重新 fetch)
- testing page 嘅 dropdown UX bug (select onchange 唔 fire) 同時 fix — 改用 radio chip 取代 select

---

## 8. 6 色標 + LLM Hook (跟 M9 永久 rule)

### 8.1 6 色標定義

| Color | Action | Hit | Journal Mark | 意思 |
|-------|--------|-----|--------------|------|
| 🟢 綠 (deep) | BUY | hit | mark 4-5 | Golden entry (最佳時機) |
| 🟢 綠 (light) | BUY | hit | mark 1-3 或 NO_JOURNAL | 一般啱 |
| 🟡 黃 | HOLD / WAIT | - | - | 觀望 |
| 🟠 橙 (light) | BUY | miss | mark 1-3 | 一般錯 |
| 🟠 橙 (deep) | BUY | miss | mark 4-5 | 嚴重錯 (algorithm + 大少都判錯) |
| 🔴 紅 | SELL / REDUCE / TRAP / TRANSITION | - | - | 賣 / 危險 / 轉勢 |
| ⚪ 灰 | - | - | NO_JOURNAL | 大少冇 mark, 純算法 verdict |

> 跟 M9 嘅 6 色標 convention (大少永久 rule: 永遠全 Show, 6 個顏色)

### 8.2 LLM Hook (大少永久 rule 13:30)

```typescript
// M11 render function 必須有 LLM hook interface
async function generateTimelineInterpretation(
  ctx: TimelineRenderContext
): Promise<string> {
  // Sprint 2 用 hardcoded template, 將來 swap 落 LLM call
  // 對應: M8 永久 rule (commit 36496159)
  return hardcodedTimelineTemplate(ctx);
}
```

**Hardcoded template (Stage 2 v0.1.0, plain language + 揸車比喻)**:
```
「過去 90 日, 系統一共出咗 {totalVerdicts} 個 verdict, 其中 {hitRate5d}% 5 日內有升。
大少落實咗 {totalJournalEntries} 個 trade, mark 啱嘅 {markCorrectCount} 次, 錯嘅 {markWrongCount} 次。
揀咗 {goldenEntries} 個黃金買點 (5 日內升 ≥ 3% + 大少都 mark 啱)。
最勁係 {bestDate}: 嗰日系統出 BUY, 5 日後升 {bestFwd5}%, 大少 mark 4 分 (5 分滿分)。
呢個 timeline 顯示 algorithm 喺 {strongArea} 比較準, {weakArea} 仲有改善空間。」
```

**未來 swap 落 LLM (Stage 2+ 30 樣本後)**:
- OpenAI / MiniMax / Kimi / 任何
- render function call site 唔使改, 換 `generateTimelineInterpretation` 嘅 implementation 就得

---

## 9. 10 個 Test Case (Node + pytest)

### Node tests (`tests/test-backtest-timeline.mjs`)

| # | Scenario | 預期 Output |
|---|----------|-------------|
| 1 | **Data 不足** (forward return 0 records) | `result.dataPoints = []`, `stats.totalVerdicts = 0`, display 4 sections 顯示「數據不足」 |
| 2 | **正常情況** (90 日, 47 verdicts + 5 journal entries) | `result.dataPoints.length = 47`, `stats.totalJournalEntries = 5`, hit rate 計算正確 |
| 3 | **邊界 30 日** (dateRange=30) | 拎到嘅 records 都係 30 日內, `meta.dataLimited` 可能 true |
| 4 | **邊界 365 日** (dateRange=365) | 拎到最多 records, 同時 verify date sort ascending |
| 5 | **Date alignment 對齊 bug** (同一日有 2 個 journal entries) | 取第一個, 第二個被覆蓋 (UNIQUE constraint, 唔應該出現, 但 defensive code 處理) |
| 6 | **Empty Trade Journal** (有 verdicts, 冇 journal entries) | 全部 `predictionVsActual = 'NO_JOURNAL'`, `stats.totalJournalEntries = 0` |
| 7 | **全部命中** (hit all + mark_correct all) | `stats.matchBreakdown.MATCH = totalVerdicts`, `stats.hitRate5d = 1.0` |
| 8 | **全部 miss** (hit all false + mark_wrong all) | `stats.matchBreakdown.MATCH = 0`, `stats.matchBreakdown.MISS = totalVerdicts` |
| 9 | **Golden entry detection** (fwd5=3.5%, hit=true, mark=5) | `isGoldenEntry = true`, `stats.goldenEntries = 1` |
| 10 | **Golden entry threshold** (fwd5=2.9%, 唔夠 3%) | `isGoldenEntry = false` (3% 係 threshold, 2.9 < 3) |

### pytest tests (`backend/tests/test_backtest_timeline.py`)

| # | Test | 預期 |
|---|------|------|
| 1 | **Node runner test** (`node tests/test-backtest-timeline.mjs`) | 10/10 pass |
| 2 | **Bundle file exists** (`build/backtest-timeline.bundle.js`) | File exist, esbuild IIFE, `window.BacktestTimeline` |
| 3 | **Module exports** (analyzeBacktestTimeline, renderTimelineResult, isGoldenEntry) | 全部 named export |
| 4 | **API endpoints exist** (`/api/adaptive-params/{symbol}/forward-return`, `/api/trade-journal`) | 200 OK |
| 5 | **Adapter export** (`backtestTimelineAdapter` 喺 adapter.mjs) | Named export |
| 6 | **Spec doc exists** (`MODULE-11-BACKTEST-TIMELINE.md`) | File exist, ≥ 10 KB |
| 7 | **UI structure** (testing-page.js REGISTRY entry `AS-03-BTL`) | Entry exist, defaultSymbol, defaultDateRange |
| 8 | **Date range chip** (4 個 chip: 30/90/180/365) | All exist |
| 9 | **6 色標** (testing page render function 用 6 個 color) | Green/Yellow/Orange/Red/Gray + 1 deep variant |
| 10 | **LLM hook interface** (`generateTimelineInterpretation` async function) | Function exist, 將來可 swap |

---

## 10. Cache + State + Future

### 10.1 Cache Policy (永久保留)

| Data | 來源 | Retention | 永久 rule source |
|------|------|-----------|------------------|
| Forward return history | M9 Back Test | **永久保留** (180 日半衰期 weighted stats) | M9 spec §11, 大少 22:28 |
| Trade Journal entries | J Trade Journal + Followup | **永久保留** (Stage 1+ 永久 rule) | J spec §2, 大少 15:04 |
| M11 Timeline result | M11 計算 (client-side) | **唔 cache** (每次 caller request 重新計) | Stage 2 v0.1.0 簡化 |

**理由**: M11 result 係 derived data, 兩 source (forward return + trade journal) 都永久保留, 重新計係 O(N) 唔貴。

### 10.2 State Management

- **testing page**: 1 個 date range chip state + 1 個 data point click popup state
- **backend**: 冇 M11 dedicated state (純 derived data)
- **memory**: client-side localStorage 都唔 cache (Stage 2 v0.1.0 簡化)

### 10.3 Future Work (Stage 2+)

| Feature | Trigger | Spec |
|---------|---------|------|
| **Full 版 timeline** (D2 option C) | 大少 30 樣本後睇返 | 加累計回報 / drawdown / 同期指數回報 |
| **Action filter chip** (D4 option C) | 大少想 filter BUY only | 加 action type filter |
| **Annotate → Trade Journal** (D4 option D) | Trade Journal UI 完善 | click 最佳時機 → 直接 add entry |
| **Auto-tune** (Bayesian, Stage 7) | 30+ 真實 samples | M9 back test 拎 optimal params, M11 顯示「呢個 verdict 用 optimal params 嘅預測」 |
| **Cross-symbol comparison** | 大少想同時睇 5 隻 stock | Multi-symbol overlay |
| **LLM swap** (Stage 2+ 30 樣本後) | 大少 call 齊 M8/M9/M10/M11 trigger | `generateTimelineInterpretation` 換 LLM call |
| **Main frontend 獨立 page** (D3 option B) | Stage 2+ 大少想 standalone UX | `/backtest-timeline?symbol=HK.00700` |

### 10.4 對接其他 module

- **M9 Back Test**: 數據 source, 永久 cache
- **J Trade Journal**: 數據 source, 大少 mark 啱錯
- **M8 Decision Engine**: 同 M9 嘅 verdict source, M11 純 read-only display
- **M12 Risk-Reward** (Stage 2 第四次 focus): M12 可以用 M11 timeline 嘅 stats (hit rate, avg return) 計 risk-reward ratio
- **Stage 1+ Bayesian tune** (30+ 樣本後): M11 嘅 hit rate 走勢係 tune threshold 嘅 input

---

## 11. Spec Doc Meta

| 項目 | 內容 |
|------|------|
| **Spec version** | v0.1.0 |
| **對應 commit** | pending (Step 7 寫完做) |
| **對應 code** | pending (Step 2 寫) |
| **Workflow** | 大少 7 步永久 rule (spec → code → test → verify → testing page → doc → commit) |
| **Stage** | Stage 2 第三次 focus (大少 2026-08-09 21:24 重新 plan) |
| **Depends on** | M9 Back Test (done 2026-08-08) + J Trade Journal (done 2026-08-09) |
| **Blocks** | M12 Risk-Reward 嘅 risk-reward 計算 (Stage 2 第四次 focus) |
| **Author** | MiniMax Code + 大少 確認 (4 design decision 00:04 confirm) |
| **Created** | 2026-08-10 00:08 |

---

**大少永久 rule 對應**:
- ✅ Plain language 解釋 (大少 #10299)
- ✅ 永遠全 Show, 6 個顏色 (大少 11:57)
- ✅ M11 render function 預留 LLM hook (跟 M8 永久 rule 13:30)
- ✅ Testing page dropdown UX bug 順手 fix (改 chip)
- ✅ 7 步 workflow (大少 永久 rule)
- ✅ Spec Sync Protocol (本 spec 寫完, Step 6 會更新 ARCHITECTURE.md §15 + ROADMAP.md §8)
- ✅ Conftest fixture + idempotent ALTER TABLE (Stage 1+ Trade Journal followup 永久 rule)

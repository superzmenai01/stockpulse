# AS-03 · Module 9: Back Test Engine (v0.1.0, Sprint 3 sub-task 9.1 done)

> **對應 TS 檔**: `algorithms/AS-03-cycle-detection/modules/back-test.ts` (M9 v0.1.0 impl, Sprint 3 sub-task 9.1 done)
> **對應 tests**: `algorithms/AS-03-cycle-detection/__tests__/back-test.test.mjs` (15+ assertions, 4 sections)
> **對應 adapter**: `algorithms/AS-03-cycle-detection/adapter.mjs` (`backTestAdapter` v0.1.0, 9.5 加)
>
> **大少 2026-08-08 22:28 指示 (Stage 3 Back Test)**: 用 6 個月歷史 K 線 replay M8 verdict, 對比 5/10/20 日後真實升跌, 累積 forward return record, 為 tune optimal params 提供 ground truth。Coarse grid + fine tune + walk-forward CV + per-symbol optimal cache。先 HK.00700 pilot, work 咗先 extend。

---

## 1. 點解呢個 module (Why)

M8 Decision Engine 出咗 BUY / HOLD / WAIT 嘅 verdict, 但**唔知啱唔啱**:
- 「醫生話你身體好, 但從來冇覆診, 永遠唔知佢啱唔啱」

3 個關鍵問題要解決:
1. **Ground truth**: 過去 verdict 真實命中 % 幾多? 期望回報幾多? 最大回撤幾多?
2. **個股化**: 每隻股票 pattern 唔同 (e.g. 騰訊穩定 / TSLA 波動), tune 之前要有 per-symbol optimal params
3. **近期為主**: 同一股票 pattern 都會轉 (大少提醒), 6 個月半衰期, 舊 verdict 權重低, 追到最新 pattern

呢個 module = **時光機驗證官**:
- M8 校長: 「依家呢刻我會叫學生 BUY」(verdict)
- M9 驗證官: 「翻查過去 6 個月, 校長叫過 50 次 BUY, 5 日後命中 32 次 (64%), 平均賺 1.8%」(回測)

---

## 2. M9 Chain (Stage 3 完整 6 步 — 大少 22:28 確認)

```
[Step 9.1] Replay Engine — 9.1 done ✅
   ↓
[Step 9.2] Coarse Grid + Fine Tune + Adaptive Window 6→18 個月
   ↓
[Step 9.3] Walk-Forward Cross-Validation (3 段 rolling)
   ↓
[Step 9.4] Per-Symbol Optimal Params + Forward Return Record (extend L2 cache)
   ↓
[Step 9.5] Testing Page 新 Entry 09 — AS-03-BT
   ↓
[Step 9.6] HK.00700 Pilot + Spec Doc Final + Commit
```

**9.1 範圍**: 只做 Replay engine (input 歷史 K 線 → output ReplayResult[]), 9.2-9.6 喺之後 commits 加。

---

## 3. Replay Engine API (9.1 done)

### 3.1 Input / Output Types

```typescript
import type { DecisionVerdict } from './decision-engine.ts';
import type { KLine } from '../types.ts';

export interface ReplayConfig {
  symbol: string;             // 'HK.00700' / 'US.AAPL'
  klines: KLine[];            // 至少 holdDays + lookbackDays 對上嘅 K 線
  startDate?: string;         // ISO 'YYYY-MM-DD', default = klines[0].date
  endDate?: string;           // ISO 'YYYY-MM-DD', default = klines[last].date
  stepDays?: number;          // default 5 (每 5 日跑一次 verdict, 唔係逐日)
  holdDays: number[];         // [5, 10, 20] 對比 hold 5/10/20 日後升跌
  lookbackDays?: number;      // 每個 replay point 拎之前幾多日 K 線, default 60
  params?: Record<string, any>;  // optional, 暫時 default (9.2 將加 coarse grid)
}

export interface ReplayResult {
  date: string;               // verdict 當日 ISO
  action: string;             // FinalAction: BUY/ADD/HOLD/REDUCE/SELL/WAIT/TRAP/TRANSITION
  closeAtVerdict: number;     // verdict 當日 close
  forwardReturn5d: number | null;   // % (closeAfter5d - closeAtVerdict) / closeAtVerdict × 100
  forwardReturn10d: number | null;
  forwardReturn20d: number | null;
  hit5d: boolean | null;      // forwardReturn5d > 0 (or null if no data)
  hit10d: boolean | null;
  hit20d: boolean | null;
  verdict: DecisionVerdict;   // 完整 verdict for reference
}

export interface ReplaySummary {
  symbol: string;
  config: ReplayConfig;
  results: ReplayResult[];
  totalDays: number;          // stepDays 內 verdict count
  actionBreakdown: Record<string, number>;  // 8 個 finalAction count
  avgForwardReturn5d: number | null;
  avgForwardReturn10d: number | null;
  avgForwardReturn20d: number | null;
  hitRate5d: number | null;   // % of hit5d === true (excluding null)
  hitRate10d: number | null;
  hitRate20d: number | null;
}
```

### 3.2 核心邏輯

```typescript
export async function runReplay(
  klines: KLine[],
  config: ReplayConfig,
  decisionEngine: (klines: KLine[], options: any) => Promise<DecisionVerdict>
): Promise<ReplaySummary>
```

**Algorithm**:
1. **Filter klines** by [startDate, endDate] (or default = all klines)
2. **Generate step points**: `startDate, startDate+stepDays, startDate+2*stepDays, ...` 直至 ≤ endDate 對應嘅 index
3. **對每個 step point**:
   - 拎到 step point 嘅 historical K 線 (lookbackDays 之前到 step point)
   - Call `decisionEngine(historicalKlines, config.params)` → verdict
   - 拎 step point 當日 close
   - 對每個 holdDays:
     - 揾 step point + holdDays 對應嘅 K 線 (if exists)
     - 計 forward return = (closeAfter - closeAt) / closeAt × 100
     - hit = forwardReturn > 0 (or null if 冇 data)
4. **Aggregate**: action breakdown + avg return + hit rate

### 3.3 Edge Cases

| 情況 | 行為 |
|------|------|
| `klines.length === 0` | Return empty summary, 唔 throw |
| `klines.length < holdDays[last]` | Forward return 對應 null (data 唔夠) |
| `startDate < klines[0].date` | Auto-shift 到 klines[0].date |
| `endDate > klines[last].date` | Auto-cap 到 klines[last].date |
| `stepDays > klines.length` | 1 個 result (淨係第一日) |
| `decisionEngine` throw | Catch + log, 嗰個 step 跳過, 繼續下個 |
| Verdict 當日 close 唔存在 (data gap) | Skip 嗰個 step |

### 3.4 永遠 Full Show Forward Return

`forwardReturn5d/10d/20d` 三條 **永遠全部 render** (大少 11:57 永久 rule):
- 有 data: 顯示 % + hit boolean
- 冇 data (holdDays 超出 klines): 顯示 "N/A" (唔好 omit)

---

## 4. Tests (15+ assertions, 4 sections) — 9.1 done

**Section 1 — Empty & Boundary**:
- Empty klines → empty results, 唔 throw
- Single kline → 1 result, 全部 forward return null
- stepDays 太大 (e.g. 100 with 30 klines) → 1 result

**Section 2 — Happy Path**:
- 30 klines stepDays=5 holdDays=[5,10,20] → 5-6 results
- 252 klines (1 年) stepDays=5 → ~50 results
- Forward return math: (100 → 105) = +5%
- Hit boolean math: > 0 = true, ≤ 0 = false

**Section 3 — Edge Cases**:
- startDate 早過 klines[0] → auto-shift
- endDate 遲過 klines[last] → auto-cap
- 30 klines holdDays=20 → 部分 result 嘅 20d return 唔 null (因為 klines 30 = 30 holddays 啱啱夠)
- 25 klines holdDays=20 → 20d return 全部 null

**Section 4 — Aggregate**:
- Action breakdown count math (e.g. 5 BUY + 3 HOLD = 8 results)
- avg forward return math
- hit rate math (% of hit boolean)
- 全部 null → null avg/null hit rate (唔 throw divide by zero)

---

## 5. Out of Scope (9.2-9.6)

呢個 module 嘅 9.1 階段**淨係**做 Replay engine。下列功能 9.2-9.6 commits 將加:

- **9.2 Coarse grid search** + adaptive window
- **9.3 Walk-forward CV** (3 段 rolling 2+1)
- **9.4 Per-symbol optimal params cache** (extend L2 cache)
- **9.5 Testing page** (新 entry 09)
- **9.6 HK.00700 pilot** + 完整 spec doc

---

## 6. 大少 workflow confirm 記錄 (2026-08-08 22:28)

- ✅ **6 個月 window** start, adaptive extend +3 個月, max 18 個月
- ✅ **Tune 3 個 params** (Kelly + RSI weight + SSI weights), 其餘 freeze
- ✅ **半衰期 6 個月** (Recent-weighted)
- ✅ **先 HK.00700 pilot**, work 咗先 extend
- ✅ **Coarse grid** (3 values × 3 params = 9) → **fine tune top 5** (±20%)
- ✅ **Walk-forward CV** 3 段 rolling (大少揀 B, 唔係 80/20)
- ✅ **Forward return record 永久保留** (落 per-symbol cache, 唔會 delete)

---

## 7. 即刻試

呢個 9.1 階段 user 點試:

1. **Testing page** (9.5 先加 entry, 而家用 node):
   ```bash
   cd /Users/zmenai/stockpulse/algorithms/AS-03-cycle-detection
   node --test __tests__/back-test.test.mjs
   ```

2. **手動 quick test** (用 HK.00700 mock data):
   ```javascript
   import { runReplay } from './modules/back-test.ts';
   import { makeMockHK00700Klines } from './__tests__/fixtures/mock-klines.mjs';
   const klines = makeMockHK00700Klines(252);  // 1 年
   const summary = await runReplay(klines, {
     symbol: 'HK.00700',
     klines,
     stepDays: 5,
     holdDays: [5, 10, 20],
   }, decisionEngineAdapter);
   console.log(summary);
   ```

---

## 9. Coarse Grid + Fine Tune + Adaptive Window (9.2 done ✅)

### 9.2.1 核心概念 (plain language)
- **Coarse grid (粗篩)**: 試 9 個 params combinations, 揀 top 5
- **Fine tune (微調)**: 對 top 5 個做 ±20% 微調, 揀 best
- **Adaptive window (智能窗口)**: 6 個月 start, 樣本唔夠自動加, max 18 個月

### 9.2.2 Score Formula
- `score = hitRate5d × 0.5 + (avgForwardReturn5d / 5) × 0.5 × 100`
- 命中率 50% + 平均回報 50% (normalized)
- 範圍: -50 to +100 (typical)

### 9.2.3 Default Search Values
- **Kelly**: `[0.125, 0.25, 0.5]` (octo / quarter / half)
- **RSI weight**: `[0.10, 0.20, 0.30]`
- **SSI weights**: 1 個 default variation (大少 22:28 確認暫 tune 1 個 dimension, 9.4 將加 full)

### 9.2.4 永遠 Adaptive Window 真實邏輯
- 6 個月 (126 trading days) 開始
- lookback 60 + step 5 計算: 6 個月淨係 13 個 verdicts, 唔夠 30
- 通常要 extend 1-2 次到 9 月 / 12 月先夠
- Max 18 個月 (378 days) cap, 唔可以無限 extend

---

## 10. Walk-Forward Cross-Validation (9.3 next)

### 10.1 點解需要 (Why)

Coarse grid + fine tune 揾 optimal 容易 overfit 過去。例:
- 過去 6 個月 HK.00700 嘅 optimal Kelly = 0.5
- 但呢個 setting 係咪將來估 work? 唔知

Walk-forward CV 解決:
- 將 12 個月 data 切 3 段 rolling
- 每段: 前 2/3 tune, 後 1/3 validate
- 如果 3 段 validate 嘅 optimal 接近, 表示 stable, 唔係 overfit
- 如果差異大, 表示 overfit, 揀 average score 最高嗰個

### 10.2 Algorithm

```
Final klines (e.g. 12 月 from adaptive window)
  ↓
Split 3 folds (rolling, each 1/3 of data):
  Fold 1: klines[0:N/3]
  Fold 2: klines[N/3:2N/3]
  Fold 3: klines[2N/3:N]
  ↓
For each fold:
  Tune set = first 2/3 of fold
  Validate set = last 1/3 of fold
  
  Tune: runCoarseGrid + runFineTune on tune set → bestParams
  Validate: runReplay(validate set, bestParams) → score
  ↓
Output:
  folds: [{ tuneParams, validateScore, validateSamples }, ...]
  overall: 
    bestParams: average best across folds (or pick best by avg validate score)
    avgValidateScore: mean of 3 folds' validate scores
    stabilityScore: 1 - stddev(3 validate scores) / mean  (closer to 1 = more stable)
```

### 10.3 永遠 Full Show Fold Results (大少 11:57 永久 rule)
- 3 段 fold 嘅 tune params + validate score 全部 display
- User 可以睇到「係咪真係 stable, 唔係 overfit」

### 10.4 Edge Cases
- Final klines < 90 days: throw error (3 folds × 30 days each 唔夠)
- 任何 fold 嘅 tune set 唔夠 30 samples: skip fold, log warning
- 全部 fold skipped: throw error (insufficient data)

---

## 8. 下一步 (9.2-9.6)

| Sub-task | 做乜 | 預計 commit |
|---|---|---|
| 9.2 | Coarse grid + fine tune + adaptive window | 1 commit |
| 9.3 | Walk-forward CV 3 段 rolling | 1 commit |
| 9.4 | Per-symbol optimal + forward return cache (extend L2) | 1 commit |
| 9.5 | Testing page entry 09 — AS-03-BT | 1 commit |
| 9.6 | HK.00700 pilot + Spec doc final + ROADMAP update | 1 commit |
| **Total** | | **6 commits, ~1.5 小時** |

---

**Maintainer**: 大少 (zmen)
**Created**: 2026-08-08 22:28
**Version**: 0.1.0 (9.1 spec done)

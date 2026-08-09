# StockPulse API Inventory

> 所有 HTTP endpoints 嘅單一 source of truth。改 endpoint 行為必須同步 update 呢份 doc。
> 最後更新：2026-08-02（大少 #9700 AS-02 移除 auto-save + 新建 API.md）

---

## 📌 基礎資訊

| 項目 | 內容 |
|------|------|
| Base URL (Dev) | `http://localhost:18792` |
| Base URL (LAN) | `http://<mac_lan_ip>:18792`（動態，由 `/health` 返） |
| API prefix | `/api` |
| Auth | 內網 only，無 JWT（將來考慮 token-based） |
| Content-Type | `application/json` |
| CORS | Dev 開晒（`*`），Prod 需 tighten |

---

## 🧠 Algorithm Runtime (`/api/as02`)

### `POST /api/as02/run`

大少 2026-08-01 #9132 落地 · **大少 2026-08-02 #9700 改為手動儲存**

**Body:**
```json
{
  "stocks": ["HK.00981", "HK.01347", "HK.07709"]
}
```

| Field | Type | Validation | 說明 |
|---|---|---|---|
| `stocks` | `string[]` | 1-10 隻，自動 dedupe | 股票 code (`HK.XXXXX` / `US.XXXXX`) |

**Response 200:**
```json
{
  "run_id": null,            // ⭐ 永久 null (大少 #9700: 移除 auto-save)
  "stocks": [
    {
      "code": "HK.00981",
      "name": "中芯國際",
      "classification": "qualified",  // "qualified" / "disqualified"
      "score": 66.9,
      "breakdown": {
        "financial": 70, "business": 72, "management": 62,
        "industry": 78, "valuation": 50, "risk": 55
      },
      "reasons": ["中國最大晶圓代工廠", "ROE 穩步上升..."],
      "analysis_text": "...",
      "data_sources": ["FutuOpenD", "web_search"],
      "financial_data": { ... },
      "run_id": null,         // ⭐ per-stock run_id 都係 null
      // ⭐ 大少 2026-08-02 #9700 follow-up: stock data fields (令 ViewRunModal 顯示現價/變幅/市值/換手率/PE/PB)
      "price": 75.20,         // 現價 (FutuOpenD snapshot)
      "change_pct": -1.2,     // 變幅 %
      "mcap": 5.0e11,         // 市值 (HKD)
      "turnover": 1.2e8,      // 換手率 (HKD)
      "pe": 25.5,             // PE ratio
      "pb": 1.2               // PB ratio
    }
  ],
  "qualified_count": 3,
  "disqualified_count": 2,
  "ranked_at": "2026-08-02T15:00:00+08:00"
}
```

**Response 400 / 422:**
- 422: `stocks` 空 array / > 10 (Pydantic `min_length=1` / `max_length=10`)
- 500: 內部錯誤（如 LLM provider 未設定）

**Side-effects:**
- ✅ 寫入 `algorithm_dq_log` table（所有 stock, qualified + disqualified）
- ❌ **唔寫入 `saved_algorithm_runs`**（永遠係 False by design）
- ❌ 回傳 `run_id` 永遠 `null`

**User save flow:** 執行完後, frontend 嘅 `AS02ResultPanel` 顯示「💾 儲存 N 隻合格股票」按鈕。User 點按 → 開 SaveRunModal → 確認 → 調 `POST /api/saved-runs`。

---

### `GET /api/as02/health`

Health check endpoint.

**Response 200:**
```json
{
  "status": "ok",
  "algorithm": "AS-02",
  "version": "1.0"
}
```

---

## 📚 Saved Runs Library (`/api/saved-runs`)

大少 2026-07-24 #7051 首次落地 · #8960 reorder/pin · #7566 saved_stocks · #8762 editable stocks

### `POST /api/saved-runs`

**儲存新 result** — 唯一嘅寫入路徑（AS-02 / AS-01 等等所有 AS 嘅手動入庫入口）。

**Body:**
```json
{
  "algorithm_id": "AS-02",
  "algorithm_name": "公司質素分析",
  "stocks": ["HK.00981", "HK.01347"],          // optional, 從 saved_stocks derive
  "saved_stocks": [                              // 完整 snapshot per stock
    {
      "code": "HK.00981",
      "name": "中芯國際",
      "price": 75.20, "change_pct": -1.2, "mcap": 5e11, "turnover": 1e8,
      "plate_code": "", "plate_name": "",
      "score": 66.9, "mcap_rank": 0, "volume_rank": 0,
      "reason": "...",
      "classification": "qualified",
      "breakdown": { ... },
      "analysis_text": "...",
      "pe": 12.5, "pb": 1.2
    }
  ],
  "metadata": {
    "qualified_count": 1,
    "disqualified_count": 2,
    "total": 3,
    "source": "as02_v1"
  },
  "name": "My Custom Run Name",   // optional, 自動用 {algo_name} {YYYY-MM-DD HHMM}
  "note": "加註"                  // optional
}
```

**Response 200:**
```json
{
  "id": 178,
  "name": "公司質素分析 2026-08-02 1500",
  ...
}
```

**Side-effects:**
- 寫入 `saved_algorithm_runs` table
- 撞名 → 自動加 `-2`, `-3` suffix

---

### `GET /api/saved-runs`

**列出所有 saved runs**（新至舊 + pinned first）

**Query params:**
- `algorithm_id` (optional) — 例如 `AS-02` 只返 AS-02 嘅 runs

**Response 200:**
```json
{
  "runs": [
    {
      "id": 178,
      "algorithm_id": "AS-02",
      "algorithm_name": "公司質素分析",
      "name": "...",
      "note": "...",
      "saved_at": "2026-08-02T15:00:00",
      "updated_at": "2026-08-02T15:00:00",
      "stocks": ["HK.00981"],
      "saved_stocks": [ ... ],
      "metadata": { ... },
      "position": 0,
      "is_pinned": false
    }
  ],
  "count": 1
}
```

**Sort order:** `is_pinned DESC, position ASC, saved_at DESC`（大少 #8960）

---

### `GET /api/saved-runs/{run_id}`

**取得 1 個 saved run 嘅完整資料**。

**Response 200:** Single run object（同 list 嘅 run shape）
**Response 404:** `Run #{run_id} not found`

---

### `PUT /api/saved-runs/{run_id}`

**更新 name / note / saved_stocks**（大少 #7051 + #8762）

**Body:**
```json
{
  "name": "New Name (optional)",
  "note": "New note (optional)",
  "saved_stocks": [ ... ]  // optional, 提供時自動 derive stocks (codes)
}
```

**Response 200:** Updated run
**Response 400:** Name conflict
**Response 404:** Not found

**Rules:**
- `algorithm_id` 鎖死（唔可以改）
- 至少一個 field 必須提供

---

### `DELETE /api/saved-runs/{run_id}`

**刪 1 個 saved run**。

**Response 200:** `{"deleted": true, "id": 178}`
**Response 404:** Not found

---

### `POST /api/saved-runs/reorder`

大少 #8960 (2026-07-29) — per-row up/down arrow 重新排位

**Body:**
```json
{
  "ordered_ids": [178, 165, 172]
}
```

**Response 200:** `{"runs": [...], "count": N}`

---

### `POST /api/saved-runs/{run_id}/pin`

大少 #8960 (2026-07-29) — per-row 📌 置頂 toggle

**Body:**
```json
{
  "pinned": true
}
```

**Response 200:** Updated run
**Response 404:** Not found

---

## 🔗 端點關係圖

```
┌─────────────────────────────────────────────────────────────┐
│  USER FLOW: 執行 AS-02 → 顯示結果 → 手動儲存                │
└─────────────────────────────────────────────────────────────┘

   [Frontend: 點 "🔍 執行"]                [Frontend: 點 "💾 儲存"]
            │                                        │
            ▼                                        ▼
   POST /api/as02/run                    POST /api/saved-runs
   (分析 + DQ log,                         (純寫入 saved_algorithm_runs)
    永遠 run_id=null)                                │
            │                                        │
            ▼                                        ▼
   ┌─────────────────┐                     ┌─────────────────────┐
   │ algorithm_dq_log│                     │saved_algorithm_runs │
   │ (always 寫)      │                     │ (only user-driven)  │
   └─────────────────┘                     └─────────────────────┘
                                                       │
                                                       ▼
                                            GET /api/saved-runs
                                            (Library page 顯示)
```

---

## 🚫 永久 none-auto-save rule (大少 2026-08-02 #9700)

**任何 AS-XX 嘅 runtime endpoint (`/api/asXX/run`) 唔可以寫入 `saved_algorithm_runs` table。**

- ✅ `algorithm_dq_log` 寫入 OK（分析 trace）
- ❌ `saved_algorithm_runs` 寫入 ❌ 永久禁止
- 所有入庫必須由 user 喺前端**手動點**「💾 儲存」button → SaveRunModal → POST `/api/saved-runs`

`backend/api/as02.py` 已經移除 `from models.saved_runs import save_run` import。Automated enforcement 喺 `backend/tests/test_as02_no_autosave.py`。

詳見 `~/.openclaw/workspace-main/memory/Projects/StockPulse/ALGORITHM_SPECS.md` AS-XX 段嘅 none-auto-save rule。

---

## 📂 其他 endpoint（暫時未列 inventory）

下面呢啲 endpoint 已有 code + test 但 inventory 未完善：

| Module | Endpoints | Note |
|---|---|---|
| `/api/plates/*` | 5 endpoints | 板塊相關 |
| `/api/llm-settings/*` | 6 endpoints | LLM provider + API key 管理 |
| `/api/settings/*` | 3 endpoints | General settings |
| `/api/stocks/*` | 3 endpoints | 股票 search / snapshot |
| `/api/subscribe/*` | 2 endpoints | Futu 訂閱 |
| `/api/groups/*` | 9 endpoints | Group 管理 |
| `/api/kline` | GET | K 線 cache |
| `/api/debug/*` | GET | Dev only |
| `/api/network/*` | GET | LAN IP info |
| `/api/health` | GET | Service health |
| `/health` | GET | LAN-aware health |
| `/ws/quote` | WebSocket | 報價推送 |
| **`/api/adaptive-params/*`** | **8 endpoints** | **M8 adaptive params + M9 back test optimal + forward return (見下表)** |

📝 **TODO:** 將來逐一補完 endpoint inventory（每個 module 1 節，body/response/error code 完整）。

---

## 🧠 Adaptive Params API (M8 + M9, 大少 2026-08-08 22:28 Sprint 3 收官)

> M8 Decision Engine 同 M9 Back Test 都需要 per-symbol 嘅 adaptive params cache。呢個 module 提供 8 個 endpoints，分兩組:
>
> | Group | Endpoints | 用 | Expiry |
> |-------|-----------|---|---------|
> | **M8 (params)** | `GET / POST / DELETE /{symbol}` + `GET ""` (list) | M8 嘅 5 個 adaptive params (kelly, rsiWeight, ssiWeights, scoreWeights, hurstThreshold) | **7 日** (auto-calibrate) |
> | **M9 (back-test)** | `GET / POST /{symbol}/back-test` | M9 嘅 bestParams (kelly, rsiWeight, ssiWeights) + validation metrics | **30 日** (back test 唔需要每週 tune) |
> | **M9 (forward-return)** | `POST / GET /{symbol}/forward-return` | M9 永久累積 forward return records (大少 22:28 確認 6 月半衰期 180 日 weighted stats) | **永久保留** (per-symbol cache, 唔會 delete) |

**Base path:** `/api/adaptive-params`

---

### M8 端點 (5 個)

#### `GET /api/adaptive-params/{symbol}`

讀取某 symbol 嘅 cached M8 adaptive params (7 日 expiry)。

**Path Param:**

| Param | Type | 說明 |
|-------|------|------|
| `symbol` | str | 股票 code, e.g. `HK.00700` (URL-encoded) |

**Response 200:**
```json
{
  "symbol": "HK.00700",
  "params": {
    "kelly": 0.25,
    "rsiWeight": 0.20,
    "ssiWeights": { "ma": 0.4, "hl": 0.3, "tl": 0.3 },
    "scoreWeights": { "trend": 0.4, "momentum": 0.3, "volume": 0.3 },
    "hurstThreshold": 0.5
  },
  "metrics": {
    "avgScore": 65.4,
    "stability": 0.78,
    "totalSamples": 247
  },
  "created_at": "2026-08-07T14:30:00",
  "expires_at": "2026-08-14T14:30:00"
}
```

**Response 404:** Cache miss (returns `{"cached": false, "params": null}`)

**Use case:** M8 跑 algorithm 時讀 cache, miss 就 auto-calibrate + save.

---

#### `POST /api/adaptive-params/{symbol}`

儲存某 symbol 嘅 M8 adaptive params 落 cache (7 日 expiry)。

**Body:**
```json
{
  "kelly": 0.25,
  "rsiWeight": 0.20,
  "ssiWeights": { "ma": 0.4, "hl": 0.3, "tl": 0.3 },
  "scoreWeights": { "trend": 0.4, "momentum": 0.3, "volume": 0.3 },
  "hurstThreshold": 0.5,
  "metrics": { "avgScore": 65.4, "stability": 0.78, "totalSamples": 247 }
}
```

**Validation:**
- `kelly` ∈ [0, 0.5] (Kelly fraction 上限 50%)
- `ssiWeights` sum = 1.0 (否則 400)
- `rsiWeight` ∈ [0, 0.5]

**Response 200:** Updated cache object + `expires_at`

**Note (大少 2026-08-09 12:30 Bug 2 fix, commit `639e6d70`):** 之前 M8 嘅 `applyAdaptiveParamsToSynthesizer()` 唔 apply `params.kellyFraction` 落 `sv.kelly_fraction` (永遠用 M8 內部 default `decisionEngineComputeKelly(standardVerdicts)` base on `max_drawdown_estimate`)。今次 fix 加 `KELLY_NUMERIC_MAP` const + 3 行 override 落 `kelly_fraction` / `kelly_numeric` / `kelly_position`, 即 M9 → M8 apply workflow 真正 work 落 trading card + Kelly chart (4 個 Kelly 顯示位: M7 verdict card + Trading card vol bucket + Kelly Donut chart + Adaptive params box, 全部 override 落 M9 嘅 kellyFraction)。

---

#### `DELETE /api/adaptive-params/{symbol}`

刪除某 symbol 嘅 M8 cache (testing page 「🔄 重新校準」按鈕 trigger)。

**Use case:** 大少按「重新校準」, 強制下次跑 M8 時重新 calibrate, 唔用舊 cache。

**Response 200:** `{"deleted": true, "symbol": "HK.00700"}`

---

#### `GET /api/adaptive-params`

列出所有有 cache 嘅 symbols (admin endpoint, 暫時 dev only)。

**Response 200:**
```json
{
  "symbols": ["HK.00700", "HK.00981", "US.AAPL"],
  "count": 3
}
```

---

### M9 端點 (3 個, Sprint 3 9.4 落地)

#### `GET /api/adaptive-params/{symbol}/back-test`

讀取某 symbol 嘅 M9 back test optimal (30 日 expiry)。

**Response 200:**
```json
{
  "symbol": "HK.00700",
  "bestParams": {
    "kelly": 0.25,
    "rsiWeight": 0.20,
    "ssiWeights": { "ma": 0.4, "hl": 0.3, "tl": 0.3 }
  },
  "validation": {
    "avgValidateScore": 65.4,
    "stabilityScore": 0.78,
    "totalValidateSamples": 247
  },
  "window": { "initialDays": 126, "finalDays": 252, "extendCount": 1 },
  "foldsCount": 3,
  "created_at": "2026-08-08T22:30:00",
  "expires_at": "2026-09-07T22:30:00"
}
```

**Response 404:** Cache miss (returns `{"cached": false}`)

---

#### `POST /api/adaptive-params/{symbol}/back-test`

儲存 M9 back test optimal params 落 cache (30 日 expiry)。

**Body:**
```json
{
  "kelly": 0.25,
  "rsiWeight": 0.20,
  "ssiWeights": { "ma": 0.4, "hl": 0.3, "tl": 0.3 },
  "validation": { "avgValidateScore": 65.4, "stabilityScore": 0.78, "totalValidateSamples": 247 },
  "window": { "initialDays": 126, "finalDays": 252, "extendCount": 1 },
  "foldsCount": 3
}
```

**Validation:** Same as M8 (`kelly` / `rsiWeight` 範圍, `ssiWeights` sum=1.0)

**Response 200:** Updated cache object

**Use case:** 每次 M9 walk-forward CV 跑完, 自動 POST 落 cache, 30 日內重複用, 唔需要重跑 back test。

---

#### `POST /api/adaptive-params/{symbol}/forward-return`

加一條 forward return record 落 cache history (永久保留)。

**Body:**
```json
{
  "date": "2026-08-08",
  "action": "BUY",
  "fwd5": 2.3,
  "fwd10": 4.5,
  "fwd20": -1.2,
  "hit": true
}
```

**Fields:**
- `date` (str YYYY-MM-DD)
- `action` (str, FinalAction enum: BUY/ADD/HOLD/REDUCE/SELL/WAIT/TRAP/TRANSITION)
- `fwd5/10/20` (float, 5/10/20 日後回報 %, null if incomplete)
- `hit` (bool, true if 5 日後升)

**Response 200:** `{"added": true, "count": 24}` (累積 records 數)

**Use case:** M9 walk-forward CV 跑完每段後, 逐條 fold 嘅 validate result POST 入 history, 永久累積。

---

#### `GET /api/adaptive-params/{symbol}/forward-return`

拎 forward return history + 半衰期 weighted stats (大少 22:28 確認 6 月半衰期 = 180 日)。

**Query params:**

| Param | Type | Default | 說明 |
|-------|------|---------|------|
| `limit` | int | None | 最多返幾多條 (omit = 全部) |
| `half_life_days` | int | 180 | 半衰期日數, 越舊 record 權重越低 (`weight = 0.5^(days_ago/half_life)`) |

**Response 200:**
```json
{
  "symbol": "HK.00700",
  "count": 24,
  "history": [
    { "date": "2026-08-08", "action": "BUY", "fwd5": 2.3, "fwd10": 4.5, "fwd20": -1.2, "hit": true },
    { "date": "2026-08-03", "action": "HOLD", "fwd5": -0.5, "fwd10": 1.2, "fwd20": 3.4, "hit": false },
    ...
  ],
  "stats": {
    "weighted_hit_rate_5d": 0.62,
    "weighted_avg_return_5d": 1.45,
    "weighted_avg_return_10d": 2.31,
    "weighted_avg_return_20d": 3.12,
    "half_life_days": 180,
    "oldest_date": "2026-05-15",
    "newest_date": "2026-08-08"
  }
}
```

**Use case:** M9 UI 永遠 full show 最近 20 條 forward return 詳細表 (大少 11:57 永久 rule), 加散點圖 + 半衰期 weighted summary。

---

## 📦 K-line API 改動 (大少 #11070, 2026-08-07 + 大少 09:29 1w 永久 fix)

### `GET /api/kline` — 1w period 永久 fix (大少 09:29, commit `6b71affc`)

**Bug (之前)**: `backend/api/kline.py` PERIOD_MAP 只有 `1m / 1d / 1M / 1y`, doc 講 `1w` 支持但實作缺漏, `?period=1w` 返 `400 {"detail":"不支援的週期: 1w"}`。

**Fix** (1 行):
```python
PERIOD_MAP = {
    '1m': KLType.K_1M,
    '1d': KLType.K_DAY,
    '1w': KLType.K_WEEK,  # ← 加呢行, 大少 09:29 永久 fix (補返 5-10 年 weekly history)
    '1M': KLType.K_MON,
    '1y': KLType.K_YEAR,
}
```

**影響**: M9 Pilot 拎 5-10 年 weekly history, 7 隻 data 唔夠 stocks 全部拎到有意義 results (15-39 samples)。

**永久 Rule (大少 09:29)**: 所有 PERIOD 必須 register 落 PERIOD_MAP, doc 同實作必須 sync。將來加新 period (5m/15m/30m/60m 仲欠) 跟 same pattern。

---

## 📦 K-line API 改動 (大少 #11070, 2026-08-07)

### `GET /api/kline`

**改動 commit**: `c2b8b278`

**Query Parameters**:

| Param | Required | Type | Default | Description |
|-------|----------|------|---------|-------------|
| `code` | ✅ | str | — | 股票代碼 (例 `HK.00700`, `US.INTC`) |
| `period` | ❌ | str | `1d` | K 線週期 (`1m` / `1d` / `1M` / `1y`) |
| `count` | ❌ | int | 100 | Response 返幾多條 (取最尾 N 條 recent) |
| `start` | ❌ | str (YYYY-MM-DD) | 動態 | 開始日期 (override default) |
| `end` | ❌ | str (YYYY-MM-DD) | today | 結束日期 |

**Default start (1d period) 改動** (永久 rule, 大少 #11070):
- 1d 默認 `start_date = count × 1.5` calendar days back
- 1 trading day ≈ 1.5 calendar days (cover weekends + holidays)
- 例: `count=300` → start = 450 calendar days 前

**Response Schema (改動)**:

```json
{
  "code": "HK.00700",
  "name": "HK.00700",
  "period": "1d",
  "klines": [...],
  "mock": false,
  "cached": true,
  "fetch_count": 182,
  "requested_count": 300,    // ← 新增
  "actual_count": 182,        // ← 新增
  "data_limited": true        // ← 新增 (true if actual < requested)
}
```

**Frontend 對應** (testing-page.js line 465-481):
- `runStatus` 顯示「✅ 完成 · 182 日 (設定 300 / 實際 182 — 數據限制) · 4ms」
- User 即時知道 backend 返幾多條

**Verify**:
- `curl ?code=HK.00700&period=1d&count=300` → `actual_count=182, data_limited=True` ✅
- OpenD 對 HK.00700 1d 真實 history limit = 9 個月 (182 trading days)
- 清 DB 重新 cold fetch → 拎到 20 年 (4934 條) ✅ (見 ARCHITECTURE §13.1)

**K-line Cache Defensive Filter (大少 #11099, 2026-08-07, 永久 fix done `a58ce65c`)**:
- 問題: OpenD `autype='qfq'` (前復權) 對 2014 年拆股前嘅早期數據返負值 (e.g. HK.00700 2006-07-24: open=-20.88, high=-20.88, low=-20.90, close=-20.89)
- 永久 fix: `backend/services/kline_cache._fetch_klines()` 加 defensive filter, 任何 OHLC < 0 嘅 row skip 咗唔寫入 DB
- 影響: Frontend 算法唔需要再自己 guard (backend 保證 data clean)
- Commit: `a58ce65c fix(cache): filter negative OHLC (OpenD qfq 復權 bug) + start.sh +x`
- 詳見 ARCHITECTURE §13.2

---

## 📝 Changelog

| 日期 | 改動 | 大少 reference |
|---|---|---|
| 2026-08-09 10:57 | **M9 Pilot 收官 + Spec Sync #6** (10 隻 1w 統一 bench, 399 forward return records, Top 3 apply 落 M8, 4 個 followup bugs defer 落 Stage 1+) | 大少 09:34 / 09:54 / 10:02 / 10:57 |
| 2026-08-09 09:29 | **Backend 1w period 永久 fix** (`PERIOD_MAP` 加 `KLType.K_WEEK`, 補返 5-10 年 weekly history) | 大少 09:29 揀 B |
| 2026-08-08 23:55 | **Sprint 3 收官 + i18n 繁體人話 + Spec Sync #5** (M9 v0.6.0 9.1-9.7 全 done, testing page 全部繁體人話, 4 份 single source of truth doc 同步更新) | 大少 22:28 / 23:55 / 23:57 / 24:00 |
| 2026-08-08 22:28 | **M9 Back Test 啟動 + 4 個新 endpoints (per-symbol optimal + forward return)** (M9 v0.5.0 → v0.6.0, 9.1-9.6 done, HK.00700 pilot 3/3 folds ✅, 24ms) | 大少 22:28 |
| 2026-08-08 | **M8 Decision Engine 完成** (5 個 adaptive params + L2 JSON cache 7 日 expiry + 4 個 SVG chart + 8 個 finalAction + 揸車比喻 + LLM hook) | 大少 Sprint 2 done |
| 2026-08-07 | K-line cache 加 defensive filter 跳過負值 OHLC (OpenD qfq bug 永久 fix) | 大少 #11099 |
| 2026-08-07 | `/api/kline` 1d default start 改 `count*1.5` + response trim + 新 metadata (`requested_count`/`actual_count`/`data_limited`) | 大少 #11070 |
| 2026-08-02 | 新建 API.md + 加入 #9700 none-auto-save rule | 大少 #9700 |
| 2026-08-02 | `/api/as02/run` 行為改: run_id 永遠 null, 唔 auto-save | 大少 #9700 |
| 2026-08-02 | `/api/as02/run` response.stocks 加 `price/change_pct/mcap/turnover/pe/pb` (Pydantic schema bug fix) — 令 ViewRunModal 唔再顯示「—」 | 大少 #9700 follow-up |
| 2026-07-29 | `/api/saved-runs/reorder` + `/api/saved-runs/{id}/pin` 新增 | 大少 #8960 |
| 2026-07-26 | `save_run` 接受 `saved_stocks` (full snapshot) | 大少 #7566 |
| 2026-07-24 | 首次落地 saved_runs 5 個 endpoints | 大少 #7051 |

---

## 📦 Stock Reasons API (大少 #9920)

### Endpoints

| Method | Endpoint | Purpose | Body | Response |
|---|---|---|---|---|
| `GET` | `/api/stock-reasons?code=HK.00981&source_run_id=86` | List active reasons for stock (newest first) — `source_run_id` enables per-run scoping + 每個 reason 加 `is_stale` runtime flag (大少 #10144 Option C) | — | `{reasons: [...], count: N}` |
| `GET` | `/api/stock-reasons/{id}` | Single reason by id | — | `ReasonEntry` |
| `POST` | `/api/stock-reasons` | Create (sanitize + size check + UNIQUE dedupe) | `{code, source_type, source_ref, title, html, source_run_id?}` | `ReasonEntry` |
| `PUT` | `/api/stock-reasons/{id}` | Update title/html | `{title?, html?}` | `ReasonEntry` |
| `DELETE` | `/api/stock-reasons/{id}` | Soft delete (is_active=0) | — | `{deleted: true, id}` |

### Query Parameters

- `code` (optional if `source_run_id` provided) — Stock code, e.g. `HK.00981`
- `source_run_id` (optional, 大少 #10103/#10144 per-run scoped display) — SQL filter `code IN (run's saved_stocks)`, 每個 response reason 加 `is_stale` runtime flag (跨-run + 跨-algorithm = stale). 至少要提供 `code` 或 `source_run_id` 其中一個, 否則 400。
- `include_inactive` (optional, default false) — Show soft-deleted for audit

### Request/Response Schemas

```ts
interface ReasonEntry {
  id: number;
  code: string;
  source_type: 'algorithm' | 'manual' | 'news' | 'research';
  source_ref: string;
  source_run_id: number | null;
  title: string;
  html: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
  /**
   * 大少 #10144 Option C: is_stale runtime flag (computed when source_run_id query param provided).
   * - is_stale = (this.source_run_id != caller_run) AND (this.source_ref != caller_algo)
   * - Caller (UI) 應該 filter is_stale=true reasons out before render (e.g. ReasonCell filter)
   * - 如果 caller 唔傳 source_run_id, 全部 is_stale = false (no context)
   */
  is_stale?: boolean;
}
```

### save_run Body Extension

`POST /api/saved-runs` 接受新 field `reasons` (optional):

```json
{
  "algorithm_id": "AS-02",
  "algorithm_name": "公司質素分析",
  "stocks": ["HK.00981"],
  "saved_stocks": [...],
  "metadata": {...},
  "reasons": [
    {
      "code": "HK.00981",
      "source_type": "algorithm",
      "source_ref": "AS-02",
      "title": "公司質素分析篩選",
      "html": "<div>...</div>"
    }
  ]
}
```

- Backend 自動 sanitize HTML + bulk insert 到 stock_reasons
- `source_run_id` 自動設為新 run.id
- Smart Dedupe via UNIQUE constraint

### Sanitization Rules

- **Allowlist tags**: div, span, p, br, hr, h1-h4, strong, em, b, i, u, sub, sup, ul, ol, li, table, thead, tbody, tfoot, tr, th, td, caption, a, code, pre, blockquote, small
- **Allowlist attrs**: class, id, href, title, target, rel, colspan, rowspan, scope, border
- **Allowed protocols**: http, https, mailto, tel
- **Strip**: script, style, iframe, object, embed, on* handlers, javascript:, vbscript:, data:text/html
- **Size limit**: 50KB post-sanitize (超過 truncate + marker)


---

## 📝 Recent Updates (2026-08-04)

| 日期 | 改動 | 大少 reference |
|---|---|---|
| 2026-08-04 | **Option C is_stale flag**: `list_reasons_filtered` 改 return all + 每個 reason 加 `is_stale` runtime flag (跨-run + 跨-algorithm = stale); UI filter stale。取代 f25d287f 嘅 source_ref hard filter (失去 accumulation)。 | 大少 #10144 |
| 2026-08-04 | **v2 UX**: `build_as02_reason_html()` 改 emit bar chart (取代 table) + 中文 labels + 顏色 by score + class-based widths (w-10 ~ w-100) | 大少 #10031 |
| 2026-08-04 | **CSS Module `:global()` rule**: `ReasonPopUp.module.css` 加 32 個 `:global()` wrappers (innerHTML compat) | 大少 #10031, fix #10047 |
| 2026-08-04 | **Backend restart**: New PID 7630 listening on 18792 (started 00:22:20) — 載入所有今日寫嘅新 code | 大少 #9920 |
| 2026-08-04 | **Backend auto-build on save**: `api/saved_runs.py` save_run endpoint 加 AS-02 auto-build block (唔使 frontend wire) | 大少 #9920 fix #10005 |
| 2026-08-04 | **Backfill v2**: 3 AS-02 runs × 3 stocks = 9 reasons updated with bar chart HTML | 大少 #9920 |
| 2026-08-03 | Backend `auto-build AS-02 reasons` on save (前端唔使改) | 大少 #9920 (23:30 fix) |
| 2026-08-03 | 新 `/api/stock-reasons` 5 endpoints (GET list/single, POST create, PUT update, DELETE soft) | 大少 #9920 |


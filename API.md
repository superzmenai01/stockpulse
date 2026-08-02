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

📝 **TODO:** 將來逐一補完 endpoint inventory（每個 module 1 節，body/response/error code 完整）。

---

## 📝 Changelog

| 日期 | 改動 | 大少 reference |
|---|---|---|
| 2026-08-02 | 新建 API.md + 加入 #9700 none-auto-save rule | 大少 #9700 |
| 2026-08-02 | `/api/as02/run` 行為改: run_id 永遠 null, 唔 auto-save | 大少 #9700 |
| 2026-08-02 | `/api/as02/run` response.stocks 加 `price/change_pct/mcap/turnover/pe/pb` (Pydantic schema bug fix) — 令 ViewRunModal 唔再顯示「—」 | 大少 #9700 follow-up |
| 2026-07-29 | `/api/saved-runs/reorder` + `/api/saved-runs/{id}/pin` 新增 | 大少 #8960 |
| 2026-07-26 | `save_run` 接受 `saved_stocks` (full snapshot) | 大少 #7566 |
| 2026-07-24 | 首次落地 saved_runs 5 個 endpoints | 大少 #7051 |

# StockPulse 系統架構 (ARCHITECTURE)

> 本文件描述 StockPulse 嘅系統架構、組件關係、data flow。
> 其他 AI 接手項目時，先讀 `README.md` → `PROJECT_SPEC.md` → **本文件**。

---

## 1. 系統全景 (System Overview)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         StockPulse System                           │
│                                                                     │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐       │
│  │   Frontend    │    │   Backend     │    │    Miniapp    │       │
│  │   (port 3000) │ ←→ │  (port 18792) │ ←→ │ (port 18793)  │       │
│  │  React+Vite   │    │   FastAPI     │    │  Telegram Bot │       │
│  └───────┬───────┘    └───────┬───────┘    └───────┬───────┘       │
│          │ HTTP/WS           │                     │               │
│          └───────────────────┴─────────────────────┘               │
│                              │                                     │
│              ┌───────────────┴───────────────┐                     │
│              ↓                               ↓                     │
│     ┌─────────────────┐            ┌─────────────────┐            │
│     │   Data Tier     │            │  External APIs  │            │
│     │                 │            │                 │            │
│     │  SQLite (8 tbl) │            │  FutuOpenD      │            │
│     │  K-line cache   │            │  :11111         │            │
│     │  Event bus      │            │                 │            │
│     └─────────────────┘            │  MiniMax LLM    │            │
│                                    │  Kimi LLM       │            │
│                                    │  Gemini LLM     │            │
│                                    └─────────────────┘            │
└─────────────────────────────────────────────────────────────────────┘
```

### Tier 概覽

| Tier | 技術 | Port | 角色 |
|------|------|------|------|
| **Frontend** | React 18 + Vite 5 + Ant Design 5 + TS | 3000 | UI + WebSocket client |
| **Backend** | FastAPI + SQLAlchemy + Futu | 18792 | API + WS server + 算法 pipeline |
| **Miniapp** | Telegram Bot + 微信小程序 | 18793 | Mobile 簡化版 |
| **Data** | SQLite + in-memory cache | — | 持久化 + cache |
| **External** | FutuOpenD + LLM providers | 11111 (Futu) | 數據源 + AI |

---

## 2. Frontend Architecture

```
web/src/
├── main.tsx                       # Vite entry, mount <App/>
├── App.tsx                        # React Router setup (11 routes)
│
├── pages/                         # 13 頁面 (見 PROJECT_SPEC.md §UI 設計)
│   ├── HomePage/                  # 組別列表
│   ├── WatchlistPage/
│   ├── StrategyPage/
│   ├── AlgorithmStrategyPage/     # AS-XX 入口
│   ├── LibraryPage/               # Saved runs
│   ├── SettingsPage/              # LLM provider 切換
│   ├── CalendarPage/
│   └── ...
│
├── components/                    # 11 類組件庫
│   ├── common/                    # 通用 UI (Button/Card/Modal/...)
│   ├── layout/                    # AppLayout / Header / Sidebar / MobileNav
│   ├── stock/                     # StockCard / StockSearch / StockDetail
│   ├── group/                     # GroupCard / AddToGroupModal
│   ├── strategy/                  # StrategyEditor / StrategyResult
│   ├── algorithm/                 # AlgorithmSpec / RunButton / ProgressBar
│   ├── library/                   # ViewRunModal
│   ├── chart/                     # Lightweight Charts wrappers
│   ├── calendar/
│   ├── watchlist/
│   └── debug/
│
├── context/                       # React Context (global state)
│   ├── AuthContext                # 用戶登入狀態
│   ├── StockContext               # Stock list / watchlist
│   ├── WebSocketContext           # WS connection + 報價 stream
│   └── ThemeContext               # 暗色 / 亮色主題
│
├── hooks/                         # Custom hooks
│   ├── useWebSocket.ts
│   ├── useStockSearch.ts
│   ├── useGroups.ts
│   ├── useStrategy.ts
│   └── useWatchlist.ts
│
├── services/                      # API service layer (per resource)
│   ├── api.ts                     # axios / fetch wrapper
│   ├── stockService.ts
│   ├── groupService.ts
│   ├── strategyService.ts
│   ├── algorithmService.ts        # AS02 run / health
│   ├── libraryService.ts          # Saved runs CRUD
│   ├── settingsService.ts         # LLM provider 切換
│   └── wsService.ts               # WebSocket subscribe
│
└── types/                         # TypeScript 類型 (mirror backend models)
```

### 路由 (App.tsx)

| Path | Page | 角色 |
|------|------|------|
| `/login` | LoginPage | 登入 |
| `/` | HomePage | 組別列表 |
| `/watchlist` | WatchlistPage | 關注股票 |
| `/strategy` | StrategyPage | 策略管理 |
| `/algorithms` | AlgorithmStrategyPage | AS-XX 入口 |
| `/library` | LibraryPage | Saved runs |
| `/calendar` | CalendarPage | 日曆視圖 |
| `/settings` | SettingsPage | LLM provider 切換 |
| `/test-kline` | KlineDebugPage | Dev |
| `/ew-test` | ElliottWaveTestPage | Dev |
| `/grid-test` | GridTestPage | Dev |

### State management 策略
- **Local state** — `useState` / `useReducer` 喺 component 內
- **Shared state** — React Context (Auth/Stock/WS/Theme)
- **Server state** — 直接 fetch + local cache (冇用 Redux / SWR)
- **WebSocket state** — `WebSocketContext` 統一管理連線 + 報價 stream

---

## 3. Backend Architecture

```
backend/
├── main.py                        # FastAPI app + CORS + router mounts
│                                  #   - /api/* (HTTP)
│                                  #   - /ws/quote (WebSocket)
│                                  #   - /api/health (health check)
│
├── api/                           # HTTP Routes (11 modules)
│   ├── as02.py                    # POST /api/as02/run, GET /api/as02/health
│   ├── debug.py                   # GET /api/debug/* (dev only)
│   ├── group.py                   # /api/groups/* (9 endpoints)
│   ├── kline.py                   # GET /api/kline
│   ├── llm_settings.py            # /api/llm-settings/* (6 endpoints)
│   ├── plates.py                  # /api/plates/* (5 endpoints)
│   ├── saved_runs.py              # /api/saved-runs/* (9 endpoints)
│   ├── settings.py                # /api/settings/* (3 endpoints)
│   ├── stocks.py                  # /api/stocks/* (3 endpoints)
│   └── subscribe.py               # /api/subscribe/* (2 endpoints)
│
├── services/                      # 業務邏輯 (唔直接 expose HTTP)
│   ├── as02_analyzer.py           # AS02 公司質素分析 (核心)
│   ├── encryption.py              # API key 加密 (Fernet)
│   ├── event_bus.py               # 內部 event pub/sub
│   ├── futu_financials.py         # 從 Futu 攞財務數據
│   ├── kline_cache.py             # K 線 cache (memory + DB)
│   └── web_search.py              # MiniMax web search
│
├── llm/                           # LLM Provider Abstraction (NEW 2026-06)
│   ├── base.py                    # AbstractProvider interface
│   ├── factory.py                 # get_active_provider() — 單一入口
│   └── custom.py                  # OpenAI-compatible adapter
│
├── models/                        # SQLAlchemy ORM (8 tables)
│   ├── plate.py
│   ├── llm_settings.py            # API key encrypted at rest
│   ├── stock.py
│   ├── settings.py                # General key-value settings
│   ├── group.py
│   ├── group_stock.py
│   ├── saved_runs.py
│   └── algorithm_dq_log.py
│
├── futu_conn/                     # 富途行情 (port 11111)
│   ├── handler.py                 # QuoteHandler — 解析 push callback
│   └── subscription.py            # SubscriptionManager — 訂閱生命週期
│
├── ws/                            # WebSocket server
│   ├── manager.py                 # ConnectionManager — client 連線管理
│   ├── session.py                 # SessionManager — session 狀態
│   ├── broadcaster.py             # QuoteBroadcaster — quote 廣播
│   └── router.py                  # /ws/quote route
│
├── utils/
│   └── zh_normalize.py
│
├── scripts/                       # 一次性 scripts (板塊 populate / popularity compute)
└── tests/                         # pytest
```

### Layer 規則
- **api/** — 只負責 HTTP protocol (parse request, format response)
- **services/** — 業務邏輯，可以由 api / ws / 其他 services call
- **models/** — SQLAlchemy ORM，唔好喺呢度寫 business logic
- **llm/** — 唯一可以 import 個別 provider 嘅地方，**永遠** 經 factory
- **futu_conn/** — 隔離富途 SDK，外面唔可以直接 import futu

---

## 3.5 KlineCache v2 — Date-based Gap Detection (大少 #8602, 2026-08-06)

### 背景

舊 warm cache gap-fill 有 bug — 當 user query 嘅 `end < today`，`if today_in_range:` 跳過成個 Step 3 gap-fill，導致中間缺口（例如 HK.00700 2026-07-28 → 2026-08-04 嘅 7 日 gap）冇自動補返。

### 三個 Fix (OpenCode Daemon 落地)

| Fix | 內容 | 影響 |
|-----|------|------|
| **Fix 2** | `_compute_fetch_max_count(period)` helper | Cold + warm 共用 `max_count` override (30 yrs daily, 10 yrs other)；防止 caller 嘅 `max_count=100` miss 早期缺口 |
| **Fix 3** | `_fetch_today_bar()` 用 `ctx.get_cur_kline(num=1)` | 拎今日 intraday partial bar；T-1 rule 唔寫 DB |
| **Fix 4** | 刪走 `if today_in_range:` gate | Warm cache gap-fill 唔再受 user query 影響，永遠做 wide-fetch (`earliest_cached` → `today`) |

### Refactor 結構

```
get_or_fetch(code, ctx, ktype, period, start, end)
│
├─ Step 1: get_klines(code, period, start, end)
│          → user-range cached (for response merge)
│
├─ Step 2 (cold): _fetch_klines + _insert_klines(< today)
│          → full-range fetch 1996→today, insert all < today
│
├─ Step 3 (warm): wide-fetch earliest_cached → today
│          → diff OpenD vs FULL cache, fill missing (< today)
│          → NOT gated by today_in_range (Fix 4)
│
└─ Step 4: _fetch_today_bar (independent of path)
         → get_cur_kline(num=1), try/except fallback
         → append to all_klines_dict (overwrite history fetch 嘅 today bar)
```

### Helper Methods (extracted)

| Method | 角色 |
|--------|------|
| `_insert_klines(code, period, klines)` | DB INSERT OR REPLACE；caller 確保 `k['time'] < today` |
| `_fetch_klines(ctx, code, ktype, period, start, end, max_count)` | Pure OpenD fetch，no DB write |
| `_fetch_today_bar(ctx, code, ktype, period)` | Today real-time via `get_cur_kline()`；try/except 包住，mock 或 OpenD quirk → return None |
| `_compute_fetch_max_count(period)` | `1d` → 30×365；else → 10×365 |

### 永久 Rule (大少 #8602)

- ✅ Gap-fill 永遠做 wide-fetch (`earliest_cached → today`)，唔受 user query 嘅 `today_in_range` 影響
- ✅ Today 用 `get_cur_kline()` 而唔係 `request_history_kline()`（拎 intraday partial bar）
- ✅ Today NEVER 寫 DB（T-1 rule 不變 — 大少 #7983）
- ✅ Helper extraction — `_insert_klines` / `_fetch_klines` / `_fetch_today_bar` 拆出嚟，方便獨立 unit test
- ❌ 唔好再用 `max_count=100` caller default（會 miss 早期缺口）

### Test Coverage

`backend/tests/test_kline_cache.py` **14/14 pass**：

| Test | 驗證 |
|------|------|
| `test_gap_fill_db_jump` | DB 缺口自動 wide-fetch 補 |
| `test_today_in_response_not_in_db` | 今日 bar 喺 response 但唔入 DB |
| `test_repeat_call_today_not_duplicated` | 重複 call 唔重複今日 data |

### Source

- 大少 trigger #10714-#10721 (2026-08-06 02:15-02:19) — 問題發現 (00700 7-day gap) + workaround
- 大少 #8602 (OpenCode Daemon session 2026-08-06 02:08) — 3 個 fix 落地
- `backend/services/kline_cache.py` — 主要改動
- `backend/tests/test_kline_cache.py` — 14/14 tests pass
- `memory/2026-08-06-0208.md` — OpenCode session log

---

## 4. Algorithm Pipeline (AS02 detail)

```
[User clicks "Run" on /algorithms page]
          ↓
[Frontend POST /api/as02/run { stocks: ["HK.00700", ...] }]
          ↓
backend/api/as02.py::run_as02()
          ↓
backend/services/as02_analyzer.py::analyze_stocks(stocks)
          ↓
   for each stock:
          ↓
   analyze_one_stock(stock_code, provider)
          ↓
   ┌──────┴──────────────────────────────┐
   ↓                                     ↓
check_hard_dq_triggers()          futu_financials.get(stock_code)
   ↓                                     ↓
fail → algorithm_dq_log           calculate_financial_score()
   ↓                                     ↓
skip                          calculate_valuation_score()
                                        ↓
                                call_llm_analysis(provider, ...)
                                        ↓
                                backend/llm/factory.get_active_provider()
                                        ↓
                                AbstractProvider.chat_json()
                                        ↓
                                MiniMax / Kimi / Gemini / Custom
                                        ↓
                                (returns reason + scores)
                                        ↓
                                merge into final result
          ↓
[all stocks processed]
          ↓
backend/api/as02.py logs to algorithm_dq_log table (Python 寫 DQ trace - qualified + disqualified 全部)
          ↓
[Frontend 顯示結果 — 唔寫入 saved_runs]
          ↓
[User 手動點「💾 儲存 N 隻合格股票」button]
          ↓
[Frontend POST /api/saved-runs { algorithm_id: "AS-02", stocks: [...], saved_stocks: [...] }]
          ↓
backend/api/saved_runs.py::save_run()
          ↓
[Frontend navigates to /library]
```

> **📌 大少 2026-08-02 #9700 永久 rule:** AS-02 runtime endpoint (`/api/as02/run`) **唔可以** 寫入 `saved_algorithm_runs` table。execute 同 persist 行為唔可以 binding 死於單一 trigger — user 必須喺 frontend 手動點「💾 儲存」先入庫。原因：避免 execute 與 persist 行為 binding 死於單一 trigger,方便 user retry / refine 之後再決定儲存與否。詳細見 `ALGORITHM_SPECS.md` AS-XX 段嘅 none-auto-save rule。

### AS02 函數 (`backend/services/as02_analyzer.py`)

| Function | 角色 |
|----------|------|
| `check_hard_dq_triggers(financials)` | 財務數據 DQ check — missing/stale 即 fail |
| `calculate_financial_score(financials)` | 純數字計分 (ROE / margin / growth) |
| `calculate_valuation_score(financials)` | 估值分 (PE / PB / dividend) |
| `call_llm_analysis(provider, stock, financials, news)` | LLM 分析質素 + 故事 |
| `analyze_stocks(stocks)` | 批量入口 (parallel) |
| `analyze_one_stock(stock, provider)` | 單隻入口 |

### Data quality log
- 每個 DQ fail 都會寫入 `algorithm_dq_log` 表
- Severity: `warn` (可繼續) / `error` (skip 該 stock)
- 可以 query 統計某段時間 DQ rate

---

## 5. LLM Abstraction Layer

### 目標
- 統一所有 LLM call 嘅 interface
- 加新 provider = 加 1 個 adapter + register factory
- Fallback chain + retry policy 一處管理

### Interface (`backend/llm/base.py`)

```python
class AbstractProvider(ABC):
    @abstractmethod
    def chat(self, messages: list[dict], *,
             model: str | None = None,
             temperature: float = 0.3) -> str: ...

    @abstractmethod
    def chat_json(self, messages: list[dict], *,
                 schema: dict) -> dict: ...

    @abstractmethod
    def count_tokens(self, text: str) -> int: ...

    @abstractmethod
    def health_check(self) -> bool: ...
```

### Factory (`backend/llm/factory.py`)

```python
def get_active_provider() -> AbstractProvider:
    """單一入口。讀 llm_settings table 揾 active profile."""
    profile = db.query(LLMSettings).filter_by(is_active=True).first()
    return _build_provider(profile)
```

### Fallback chain (openclaw.json, 全局)

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "minimax/MiniMax-M3-highspeed",
        "fallbacks": ["minimax/MiniMax-M3", "minimax/MiniMax-M2.7"]
      }
    }
  },
  "auth": {
    "cooldowns": {
      "overloadedProfileRotations": 3,
      "rateLimitedProfileRotations": 3,
      "overloadedBackoffMs": 2000
    }
  }
}
```

### 規則 (重要!)
- ✅ 永遠 call `get_active_provider()` 或用 OpenClaw fallback chain
- ❌ 唔好 import 個別 provider 直接用
- ❌ 唔好 hard-code MiniMax / Kimi 嘅 endpoint
- ✅ API key 入 DB 必須 encrypt (`services/encryption.py` Fernet)
- ✅ 加新 provider 用 Settings UI (`/settings`)

---

## 6. Data Flow

### Flow A — 即時報價 (Real-time Quote)

```
[FutuOpenD push callback]
        ↓ (每 250ms 報價)
backend/futu_conn/handler.py::on_recv_quote()
        ↓
backend/services/event_bus.py::emit('quote', data)
        ↓
backend/ws/broadcaster.py (subscribe to 'quote' event)
        ↓
WebSocket.send() to all connected clients
        ↓
[Frontend WebSocketContext receives 'quote' message]
        ↓
update StockCard real-time price
```

### Flow B — Algorithm 執行

(見 §4 Algorithm Pipeline)

### Flow C — 用戶設定 LLM Provider

```
[User changes active provider on /settings page]
        ↓
[Frontend POST /api/llm-settings/switch { provider: "kimi" }]
        ↓
backend/api/llm_settings.py::switch_provider()
        ↓
db.update(LLMSettings.is_active) — atomic toggle
        ↓
[Frontend reloads settings, shows confirmation]
        ↓
[Next LLM call uses new provider via factory]
```

### Flow D — Saved Run 入庫

```
[AS02 run completes]
        ↓
backend/services/as02_analyzer.py returns List[Dict]
        ↓
backend/api/as02.py serializes to JSON
        ↓
db.insert(SavedRun)  with stocks + results + reason as JSON strings
        ↓
[User navigates to /library, GET /api/saved-runs]
        ↓
[Frontend renders runs in saved_runs table]
```

---

## 7. Miniapp Architecture

```
miniapp/
├── backend/main.py                # FastAPI (port 18793)
├── bot_command.py                 # Telegram Bot API (polling-based)
├── frontend/                      # 微信小程序 (Vue / WXML)
└── .env / .env.example
```

### 與主 backend 通訊
- Miniapp backend 唔直接 import 主 backend
- 用 HTTP client (`httpx`) call 主 backend API (e.g. `http://localhost:18792/api/...`)
- 共用同一個 SQLite DB (透過 SQLAlchemy 同 instance)

### Telegram Bot commands
- `/quote HK.00700` — 即時報價
- `/strategy list` — 列出 strategy
- `/run as02 HK.00700` — 簡易 AS02 run

---

## 8. External Dependencies

| 依賴 | 用途 | Failure handling |
|------|------|------------------|
| **FutuOpenD** (port 11111) | 報價 + K 線 + 財務數據 | auto-reconnect + retry subscribe |
| **MiniMax LLM** (`api.minimaxi.com`) | 主要 LLM provider | fallback chain + retry 3x |
| **Kimi LLM** (`api.moonshot.cn`) | 備選 (暫時未用) | 同上 |
| **Gemini** | planned | — |
| **SQLite** | 持久化 | WAL mode + 定期 backup |

### Critical: 連接依賴

- **Backend 啟動時必須 FutuOpenD 已運行**，否則 subscribe 全部 fail
- **LLM call 唔需要 Futu**，可以獨立運作 (Settings + Library 唔靠 Futu)
- **Frontend dev mode** 可以直接打 backend localhost:18792
- **Background services** — macOS LaunchAgent 自動管理 (2026-08-03 起) — Vite / Backend / Miniapp / Logrotate，reboot / crash 後 auto-restart

---

## 9. Deployment (production reference)

### 本地 dev (LaunchAgent-managed, 2026-08-03 起)

> 所有 background service 由 macOS LaunchAgent 自動管理 — reboot / crash 後 auto-restart。
> 修咗兩個 deadlock：(1) Vite reboot 後永遠死、(2) log 長期塞爆 disk (96% full)。

#### Service 清單

| Service | Label | Schedule | Port | Process |
|---------|-------|----------|------|---------|
| Backend | `com.stockpulse.trigger` | RunAtLoad + KeepAlive | 18792 | uvicorn main:app |
| Vite dev | `com.user.stockpulse-vite` | RunAtLoad + KeepAlive | 3000 | npm run dev |
| Miniapp | `com.user.stockpulse-miniapp` | RunAtLoad | 18793 | flask |
| Logrotate | `com.user.stockpulse-logrotate` | StartInterval=1800s (30min) | — | bash script |

#### 文件路徑

```
~/stockpulse/
├── scripts/
│   ├── start_vite.sh        # Vite launcher (absolute npm/node path)
│   └── rotate_logs.sh       # Safe rotation (tail + truncate)
└── logs/
    ├── vite.log             # Vite stdout/stderr
    ├── launchd.log          # Backend (uvicorn) log
    ├── stockpulse.log       # Python logging
    └── *.log.1 / .2 / .3    # Rotated backups (3 layers max)
~/Library/LaunchAgents/
├── com.stockpulse.trigger.plist
├── com.user.stockpulse-vite.plist
├── com.user.stockpulse-miniapp.plist
└── com.user.stockpulse-logrotate.plist
```

#### 啟動鏈條 (Frontend → Backend)

```
[User opens http://localhost:3000]
        ↓
[macOS launchd: com.user.stockpulse-vite RunAtLoad 已經起咗 Vite]
        ↓
Vite dev server 喺 port 3000 listen
        ↓
[Frontend 攞 /api/plates]
        ↓
[Vite proxy: /api → http://localhost:18792]
        ↓
[macOS launchd: com.stockpulse.trigger 已經起咗 Backend]
        ↓
Backend (uvicorn) 喺 port 18792 respond
```

#### 啟動鏈條 (FutuOpenD 報價)

```
[FutuOpenD 預先由大少人手啟動, port 11111]
        ↓
[Backend startup 連 OpenD 攞報價]
        ↓
[WebSocket push 落 Frontend]
```

**⚠️ 重要 — OpenD 唔由 LaunchAgent 管**，要由大少人手啟動 (`/Applications/Futu_OpenD.app`)。

#### 設計原則

1. **絕對 path + export PATH** — LaunchAgent 唔繼承 `~/.zshrc`，要 hard-code `/opt/homebrew/bin/npm` + `export PATH` 確保 child process 都搵到 node
2. **殺舊 → 釋 port → 起新** — `start_vite.sh` pattern 避免 double-bind (跟 start_trigger.sh)
3. **KeepAlive with SuccessfulExit=false** — crash 即 restart，但 intentional kill 唔會 loop
4. **ThrottleInterval=10** — 防 crash loop thrash
5. **Disk-safe rotation** — `rotate_logs.sh` 用 tail + truncate，**唔用 cp**（會 disk-double，tight space 必 crash）

#### 常用 commands

```bash
# Check status
launchctl list | grep stockpulse

# Reload (after edit plist)
launchctl unload ~/Library/LaunchAgents/com.user.stockpulse-vite.plist
launchctl load ~/Library/LaunchAgents/com.user.stockpulse-vite.plist

# 手動 trigger log rotation
bash ~/stockpulse/scripts/rotate_logs.sh

# Tail logs
tail -f ~/stockpulse/logs/vite.log
tail -f ~/stockpulse/logs/launchd.log
```

### Production (not yet)
- Backend: Docker + gunicorn
- Frontend: nginx static files
- DB: SQLite + Litestream (S3 backup)
- OpenD: 必須同機 (latency 考慮)

---

## 9.5 跨機訪問 (Cross-device LAN Access)

> **情境：** 大少喺屋企用 iPad / 第二部電腦訪問 StockPulse。
> **原理：** MacBook 跑 Backend + Frontend；其他設備透過 LAN IP 訪問。

### 拓樸圖 (Topology)

```mermaid
flowchart LR
    subgraph MacBook["💻 MacBook (Server)"]
        direction TB
        Backend["🐍 Backend<br/>FastAPI<br/>:18792<br/>(bind 0.0.0.0)"]
        Frontend["⚛️ Frontend<br/>Vite dev server<br/>:3000<br/>(bind 0.0.0.0)"]
        MiniApp["🤖 Miniapp<br/>Flask<br/>:18793<br/>(bind 127.0.0.1 🔒)"]
    end

    subgraph LAN["🌐 Same LAN (e.g. 192.168.1.x)"]
        iPad["📱 iPad"]
        PC["🖥️ Other PC / Mac"]
    end

    iPad -->|"http://192.168.1.64:3000/"| Frontend
    PC  -->|"http://192.168.1.64:3000/"| Frontend

    Frontend -.->|"Vite proxy<br/>/api → :18792"| Backend
    Frontend -.->|"WebSocket<br/>/ws/quote"| Backend

    MiniApp -.->|"127.0.0.1 only<br/>(not LAN-accessible)"| Backend

    classDef server fill:#e1f5ff,stroke:#01579b
    classDef client fill:#fff9c4,stroke:#f57f17
    classDef locked fill:#ffcdd2,stroke:#b71c1c
    class Backend,Frontend server
    class iPad,PC client
    class MiniApp locked
```

### 訪問鏈條詳解

| 步驟 | 動作 | 細節 |
|------|------|------|
| 1 | **用家查 MacBook LAN IP** | `ipconfig getifaddr en0` → e.g. `192.168.1.64` |
| 2 | **其他設備瀏覽器輸入** | `http://192.168.1.64:3000/` |
| 3 | **Frontend (Vite) 接到 request** | Vite dev server 喺 `0.0.0.0:3000`，所以 LAN 任何 device 都摸得到 |
| 4 | **Frontend 要打 backend API** | 唔係直接打 LAN IP，而係打 `window.location.hostname` (即 `192.168.1.64:18792`) → Vite proxy 轉去 localhost:18792 |
| 5 | **Backend 接到 request** | Backend 喺 `0.0.0.0:18792`，響 MacBook 本機處理 |
| 6 | **WebSocket 一樣** | `ws://192.168.1.64:18792/ws/quote`，proxy 內部轉去 localhost |

### Frontend LAN fallback chain (QW-2a)

`web/src/config/api.ts` 嘅 API host resolution 順序：

```
1. import.meta.env.VITE_API_BASE  ← 最高優先 (build-time env)
2. window.location.hostname      ← 自動 fallback (i.e. 用家個 browser URL 個 host)
3. 'localhost' (default)          ← dev 預設
```

**點解咁重要：**
- 大少喺 MacBook 自己開 → `window.location.hostname` = `localhost` → backend 用 localhost ✅
- 大少喺 iPad 訪問 → `window.location.hostname` = `192.168.1.64` → backend 用 LAN IP ✅
- 唔使 hardcode！同一份 build 兩個地方都 work

### Miniapp 鎖本地 (QW-1)

Miniapp backend (port 18793) 已經喺 QW-1 改 bind `127.0.0.1`：

- ✅ MacBook 自己用 Telegram bot command → OK
- ❌ 其他 LAN 設備 → 唔可以直訪問 Miniapp backend
- 🔒 原因：Miniapp backend 設計上只係 bot 嘅 internal API，唔需要對外

> 📘 詳細 PUBLIC / LOOPBACK 分類見 `~/.openclaw/workspace-main/PORTS.md`
> 📘 凡人 step-by-step 教學見 `README.md` §「🌐 其他電腦訪問 StockPulse」

---

## 10. 設計 trade-offs (要知)

| 決策 | 原因 | Trade-off |
|------|------|-----------|
| SQLite (not Postgres) | 單機部署 + 簡單 | 唔支援 concurrent write 多 |
| 冇用 Redux/SWR | 簡單 | Server state 唔自動 refetch |
| LLM abstraction 而唔直接 call MiniMax | 加新 provider 易 | 多一層 indirection |
| AlgoSpec 喺 `.md` 而唔係 code | 大少易改 | 要 sync script 確保一致 |
| Miniapp 共用 SQLite | 簡單 | 唔可以 horizontal scale |
| WebSocket (not SSE) | bidirectional | 連線管理複雜 |

---

_最後更新：2026-08-03 (LaunchAgent 永久 fix: Vite + logrotate)_
---

## 📦 Stock Reasons Architecture (大少 #9920)

### 改動概要

原本每隻 stock 嘅 reason 喺 `saved_stocks[i].reason` (String, plain text)，新架構獨立 `stock_reasons` table 儲存 sanitized HTML，獨立 components 渲染 PopUp。

### Data Flow

```
[Algorithm run] → backend/services/<algo>_analyzer.build_<algo>_reason_html(result)
                ↓
[Frontend SaveRunModal] → POST /api/saved-runs { ..., reasons: [{code, source_type, source_ref, title, html}] }
                ↓
[Backend api/saved_runs.py] → sanitize_html(req.html) → models.stock_reasons.upsert_reasons_batch()
                ↓
[SQLite stock_reasons table] → UNIQUE(code, source_type, source_ref) ON CONFLICT DO UPDATE
                ↓
[Frontend ViewRunModal] → ReasonCell v2 → useStockReasons(code) → GET /api/stock-reasons?code=X
                ↓
[Title list rendered] → click title → ReasonPopUp (DOMPurify sanitized HTML, 900px modal)
```

### Sanitization Pipeline (defense-in-depth)

1. **Algorithm-side** — `build_<algo>_reason_html()` 寫 structured HTML (no user input)
2. **Backend write** — `services.html_sanitizer.sanitize_html()` 用 bleach + post-scrub regex 移除 XSS vectors
3. **Frontend render** — `DOMPurify.sanitize()` client-side 第二重保險
4. **CSP** (將來 optional) — iframe sandbox 為極端 paranoia level

### 累積語意 (Q1 Smart Dedupe)

- 同 `(code, source_type, source_ref)` 重做 → **overwrite 最新** (RECOVER semantics)
- 唔同 algorithm (AS-01 vs AS-02) → 分開 row
- 唔同 source_type (algorithm vs manual) → 分開 row
- Result: ViewRunModal 入面睇一隻 stock 嘅 reasons = 全部做過嘅 algorithm reports + 任何 manual/news/research


---

## ⚠️ CSS Module Scoping in innerHTML (Permanent Rule, 2026-08-04)

**Problem**: 2026-08-04 大少 screenshot 報「什麼 Chart 都沒有」 — bar chart 0 width render 唔出

**Root Cause**:
```css
/* Vite CSS Modules 編譯時 scope 變 local */
.dim-row { display: flex; }     /* → ReasonPopUp_dim-row__abc123 */
.dim-bar-bg { height: 22px; }  /* → ReasonPopUp_dim-bar-bg__abc123 */
```
但 `dangerouslySetInnerHTML` content 嘅 class 係 raw:
```html
<div class="dim-row">...</div>  <!-- 仍然係 dim-row -->
```

**CSS 變 `_dim-row__abc123`，HTML 係 `dim-row` — selector 唔 match，styles 唔 apply**。

### 解決方案

凡係 component 嘅 HTML content 用 `dangerouslySetInnerHTML`，module.css 入面對應嘅 class 必須加 `:global()` 前綴：

```css
/* Fixed — 用 :global() keep raw class name */
:global(.dim-row) {
  display: flex;
  align-items: center;
  margin: 12px 0;
  gap: 14px;
}

:global(.dim-bar-bg) {
  flex: 1;
  height: 22px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 6px;
}
```

編譯後變:
```css
.dim-row { display: flex; ... }   /* global, no scoping */
.dim-bar-bg { height: 22px; ... }
```

跟 raw HTML `class="dim-row"` match ✅。

### 應用範圍 (大少 #9920 + #10031)

- `web/src/components/library/ReasonPopUp.module.css` — 32 個 `:global()` wrappers (bar chart + score colors + width classes)
- 將來其他 component 用 innerHTML 都要跟呢條 rule


---

## 🎨 Dim-Score Background Pill (大少 #10176, 2026-08-04)

### 設計 Trigger

大少 screenshot #10176 (HK.01347 AS-02 PopUp)：6 個 dimension 紅框（right side `dim-score`）只 show 純文字，score 數字同紅框嘅關聯唔夠 clear。Trigger：紅框加 score 數字 — 但 `dim-score` 已經有 text（`{v:.1f}`），所以 enhancement 純 CSS：將純文字 span 改 background pill。

### 設計 (大少 #10176)

**PopUp** (`ReasonPopUp.module.css`): `.dim-score` 改 background pill — 顯眼嘅 full-color background + 白字。

```css
/* 大少 #10176: 紅框 background pill — score 數字顯眼 */
:global(.dim-score) {
  flex: 0 0 64px;        /* up from 60px (pill 預留空間) */
  text-align: center;    /* changed from right (text-align center for pill) */
  font-weight: 700;
  font-size: 19px;
  padding: 2px 0;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);   /* fallback 半透明 */
  color: rgba(255, 255, 255, 0.95);
}

:global(.dim-score.score-high) {
  background: #52c41a;   /* 綠 full-color */
  color: #fff;
}
:global(.dim-score.score-med) {
  background: #faad14;   /* 黃 full-color */
  color: #fff;
}
:global(.dim-score.score-low) {
  background: #ff4d4f;   /* 紅 full-color */
  color: #fff;
}
```

**Backend HTML 唔需要改** — `build_as01_reason_html` / `build_as02_reason_html` 入面 `<span class="dim-score">70.0</span>` 已經有 score text，CSS 改即時對 stock_reasons table 入面嘅舊 HTML 生效（sanitize 後 class 保留）。

### AS-02「結果」inline (大少 #10176, AS02ResultPanel.tsx)

AS-02 inline render 用 AntD `<Progress>` component（唔用 `dim-bar` / `dim-score` custom CSS），已經有 `format` 函數顯示分數。原本 `format={(p) => \`${p?.toFixed(0) ?? 0}\`}` 用整數，改做 `${p?.toFixed(1) ?? '0.0'}` 顯示一位小數（與 PopUp 入面 `dim-score` 一致）。Stroke color 已分數 class 顯示（high 綠 / med 黃 / low 紅）。

### AS-01「結果」inline

AS-01「結果」inline (`ResultGrid.tsx`) 用 `ReasonCell` plain text mode（mirror #10097），唔屬 dimension bar 模式，**唔影響**呢個 scope。

### 行為對照 (大少 #10176 verify)

| 位置 | Before (#10176) | After (#10176) |
|---|---|---|
| PopUp `dim-score` | 純文字 19px, color by class, 冇 background | Background pill 64px, full-color (高/黃/紅), 白字 |
| AS-02 inline `Progress` format | 整數 (e.g. 70) | 一位小數 (e.g. 70.0) |
| AS-01 inline | plain text (ReasonCell) | — (唔變) |


---

## 📌 Update Stockpluse Trigger — 永久 Rule (大少 #10203, 2026-08-04 07:56)

### Trigger Keywords (case insensitive)

| Keyword | 備註 |
|---|---|
| `更新Stockpluse` | 大少 typo form (常見) |
| `Update Stockpluse` | typo form |
| `Update StockPulse` | correct form |
| `update stockpluse` / `update stockpulse` | lowercase 都收 |

大少 trigger 任何一個 keyword, 自動執行下面 4 個 steps — **唔再 ask 大少 confirm trigger 邊個** (override `#9664` 嘅「問大少 confirm trigger 邊個」rule)。

### Auto-execute 4 Steps

| Step | Action | File / Repo |
|---|---|---|
| **1** | Update ARCHITECTURE.md | `~/stockpulse/ARCHITECTURE.md` (append new feature section) |
| **2** | Update STOCKPULSE_REFERENCE.md | `~/.openclaw/workspace-main/STOCKPULSE_REFERENCE.md` (append new feature section) |
| **3** | Daily Log | `~/.openclaw/workspace-main/memory/YYYY-MM-DD.md` (append entry 記錄新 feature + spec update) |
| **4** | Commit And Push | `~/stockpulse` + `~/.openclaw/workspace-main` 兩個 repos |

### Override `#9664` StockPulse Spec Update Protocol

- ✅ `#9664` rule 仍然 work 但「直接做」4 steps (唔再 ask confirm) 當 trigger keyword match
- ✅ 其他 trigger (大少「普通 spec update」唔 trigger keyword) 仍然 follow `#9664` 嘅「建議 update + 等大少 confirm」flow

### Apply Scope

- ✅ 所有 StockPulse feature commit 之後大少 trigger「Update Stockpluse」
- ✅ Override 之前 `#9664` 嘅「問大少 confirm trigger 邊個」rule 對呢個 trigger keyword
- ❌ 其他 trigger (大少「普通 spec update」) 仍然 follow `#9664` rule

### Trigger Source

- 大少 2026-08-04 07:56:01 GMT+8 message #10203: 「記住以後當我講更新Stockpluse或Update Stockpluse，你就做Update ARCHITECTURE.md + STOCKPULSE_REFERENCE.md ＋ Daily Log ＋ Commit And Push」

---

## 📦 AS-01 Reason HTML Build Flow (大少 #10075, 2026-08-04)

### Flow Diagram

```
[AS-01 Algorithm run] → backend/models/plate.py::run_plate_leaders()
  → per-plate _rank_one_plate() → emit leaders with mcap_rank / volume_rank / score
  ↓
[Frontend AS-01 panel] → POST /api/saved-runs {algorithm_id: "AS-01", saved_stocks: [Leader with raw fields]}
  ↓
[Backend api/saved_runs.py] → save_run() auto-build block:
  - Group saved_stocks by plate_code
  - For each plate, compute plate_total = len(plate_stocks)
  - Call build_as01_reason_html(stock, plate_total_stocks=plate_total)
  - Append to all_reasons list
  - sanitize_html() + upsert_reasons_batch() → SQLite stock_reasons table
  ↓
[SQLite stock_reasons table] → UNIQUE(code, source_type, source_ref) ON CONFLICT DO UPDATE
  ↓
[Frontend ViewRunModal] → ReasonCell v2 → useStockReasons(code) → GET /api/stock-reasons?code=***
  ↓
[Title list rendered] → click title → ReasonPopUp (DOMPurify sanitized HTML, 1000px modal)
  → 4 個維度 bar chart + 顏色 + 龍頭因素分析
```

### Key Architectural Decisions (大少 #10075)

1. **Plate-grouping**: Backend auto-build 時按 `plate_code` group stocks — 同一板塊內所有 stocks 嘅 relative rank width 一致 (e.g. 全部 #1 都係 w-100, 全部 #5 都係 w-50)。
2. **4 個維度 display weights**: 40/40/10/10 (市值/成交量/綜合/龍頭度) — display 而唔係 algorithm weight。實際 AS-01 algorithm 只用 mcap_rank + volume_rank (50/50)。
3. **Cross-cutting helpers** (`_score_class`, `_width_class`): Duplicated 喺 `models/plate.py` 同 `services/as02_analyzer.py` — 唔 extract 避免 scope creep (將來可抽 `utils/scoring.py`)。
4. **Generic v2 template pattern**: 每個 algorithm 都用同一個 stock_reasons table (title + html + score_class + width_class) — 將來 AS-03/AS-04 跟同一個 pattern。


---

## 📋 Hybrid Reason Display — AS-01 vs AS-02 (大少 #10097, 2026-08-04)

### Decision Matrix

| 維度 | AS-01 板塊龍頭股 | AS-02 公司質素分析 |
|---|---|---|
| Reason 複雜度 | 簡單 (~30 chars plain text) | 複雜 (~1500 chars HTML with bar chart) |
| Data source | `_generate_reason()` 喺 AS-01 ranking | `build_as02_reason_html()` + LLM analysis |
| 即時 inline display | ✅ 喺 ResultGrid (ResultGrid.tsx line ~150) | ❌ 用 AS02StockCard panel 顯示分數 |
| Library PopUp | ✅ stock_reasons table (build_as01_reason_html v1) | ✅ stock_reasons table (build_as02_reason_html v2) |
| Title 喺 PopUp | "板塊龍頭股篩選" | "公司質素分析篩選" |

### Rationale (大少 #10097)

AS-01 reason ("市值 top 1 (5324億) / 成交 top 1") 太短太簡單，inline display 已經夠 clear。PopUp 反而 over-engineered (需 user 額外 click 睇)。

AS-02 reason 太複雜 (6 dimensions × score × LLM summary × 龍頭因素)，inline 顯示 會擠到 grid。所以用 stock_reasons table + PopUp。

### Implementation Diff (大少 #10097, 1 file edit)

`web/src/components/algorithm/ResultGrid.tsx`:
- Added: `{stock.reason && <Text type="secondary">{stock.reason}</Text>}` conditional render
- Comment: 大少 #10097 註明係 AS-01 inline，AS-02 仍用 stock_reasons PopUp (大少 #9920)
- No backend changes (saved_stocks[i].reason 已經 populated by `_generate_reason()` 喺 AS-01 ranking)
- No spec changes for stock_reasons table schema


---

## 📋 ViewRunModal Per-Run Scoped Query (大少 #10103, 2026-08-04)

### Data Flow Update (per-run scoped)

```
[Frontend ViewRunModal #86 (AS-01, 10 stocks)]
  ↓
[ReasonCell v2 (code="HK.00981", runId=86)]
  ↓
[useStockReasons(code="HK.00981", sourceRunId=86)]
  ↓
[GET /api/stock-reasons?code=HK.00981&source_run_id=86]
  ↓
[Backend list_reasons endpoint → list_reasons_filtered()]
  ↓
[SELECT * FROM stock_reasons
 WHERE code IN (codes from saved_algorithm_runs #86 saved_stocks)
   AND is_active = 1
 ORDER BY created_at DESC]
  ↓
[Return only reasons for stocks IN #86 run's saved_stocks]
  ↓
[Frontend render title list (1 reason: AS-01)]
```

### Old vs New Display Logic

| Scenario | Old (bug) | New (大少 #10103) |
|---|---|---|
| ViewRunModal #86 (AS-01), HK.00981 stock | Show AS-01 + AS-02 reasons (cross-algorithm stale) | Show AS-01 only (per-run scoped) |
| ViewRunModal #89 (AS-02 + HK.00981 qualified), HK.00981 stock | Show AS-01 + AS-02 reasons | Show AS-01 + AS-02 (cross-algorithm accumulation 保留) |
| ViewRunModal #90 (AS-02, HK.00981 disqualified) | HK.00981 不會出現 (frontend filter) | 同 left (frontend filter 已經 work) |

### Key Architectural Decisions

1. **Per-run scoping** (新): ViewRunModal 顯示嘅 reasons 只限於 嗰個 run 嘅 saved_stocks 入面 stocks 嘅 algorithm reasons. 解決 cross-run cross-algorithm stale display.
2. **Cross-algorithm accumulation** (保留): 如果同一 stock 曾經 qualified for 多個 algorithms, 嗰個 stock 嘅 reasons 全部都 show. Example: AS-01 #86 + AS-02 #89 都 qualify 同一 stock → ViewRunModal #89 顯示 2 條 reasons.
3. **Frontend filter 已經 work** (大少 #10105 確認): AS-02 panel `onSave` 只 pass qualified stocks. Backend 唔需要 enforce qualification check. Backend auto-build 只 insert `saved_stacks` 入面嘅 stocks → 自然 qualified-only.
4. **Backward compat**: `code`-only query (no source_run_id) 仍然 work (cross-run cross-algorithm aggregation). 為咗 AS-01 結果頁面 inline render (without runId context).


---

## 📋 ViewRunModal Per-Run Scoped Query — Option C (大少 #10144, 2026-08-04 07:03)

### Decision

取代 commit `f25d287f` 嘅 source_ref hard filter，改用 **is_stale runtime flag** + UI filter。

### Final Implementation (大少 #10144)

```python
# backend/models/stock_reasons.py::list_reasons_filtered

if source_run_id is not None:
    run_row = conn.execute(
        "SELECT algorithm_id, saved_stocks FROM saved_algorithm_runs WHERE id = ?",
        (source_run_id,),
    ).fetchone()
    run_algorithm_id = run_row["algorithm_id"]
    codes_in_run = [...]
    
    # SQL filter: code IN run's stocks (唔 filter source_ref — 保留 accumulation)
    where_parts: list[str] = []
    params: list[Any] = []
    if code:
        where_parts.append("code = ?")
        params.append(code)
    else:
        placeholders = ",".join(["?"] * len(codes_in_run))
        where_parts.append(f"code IN ({placeholders})")
        params.extend(codes_in_run)
    where_parts.append("is_active = 1")
    
    rows = conn.execute(
        f"SELECT * FROM stock_reasons WHERE {' AND '.join(where_parts)} ORDER BY created_at DESC",
        params,
    ).fetchall()
    
    # Compute is_stale per reason (Option C runtime flag)
    results: list[dict[str, Any]] = []
    for row in rows:
        d = _row_to_dict(row)
        d["is_stale"] = (
            d["source_run_id"] != source_run_id        # 跨-run
            and d["source_ref"] != run_algorithm_id    # 跨-algorithm
        )
        results.append(d)
    return results
```

```typescript
// web/src/components/library/ReasonCell.tsx (frontend filter)
const { reasons, loading } = useStockReasons(code, runId);
const visibleReasons = reasons.filter((r) => !r.is_stale);  // hide stale
```

### Data Flow Update (Option C)

```
[Frontend ViewRunModal #86 (AS-01, 10 stocks)]
  ↓
[ReasonCell v2 (code="HK.00981", runId=86)]
  ↓
[useStockReasons(code="HK.00981", sourceRunId=86)]
  ↓
[GET /api/stock-reasons?code=HK.00981&source_run_id=86]
  ↓
[Backend list_reasons_filtered(code, source_run_id=86)]
  ↓
[SELECT * FROM stock_reasons
 WHERE code = HK.00981
   AND is_active = 1
 ORDER BY created_at DESC]
 ↓
[For each row, compute is_stale based on run #86 (AS-01) context]
 ↓
[Return reasons + is_stale flag (id=34 AS-01 NOT stale + id=1 AS-02 STALE)]
 ↓
[Frontend filter: visibleReasons = reasons.filter(r => !r.is_stale)]
 ↓
[Render 1 AS-01 title only (hide AS-02 stale)]
```

### Smoke Test Evidence (大少 #10144 verification, 5/5 pass)

| Scenario | Expected | Actual | Result |
|---|---|---|---|
| AS-01 #86, HK.00981 | 1 visible (AS-01) + 1 stale (AS-02) | id=34 stale=False + id=1 stale=True | ✅ |
| AS-01 #83, HK.00981 | 1 visible (AS-01) + 1 stale (AS-02) | id=34 stale=False + id=1 stale=True | ✅ |
| AS-02 #52, HK.00981 | 1 stale (AS-01) + 1 visible (AS-02) | id=34 stale=True + id=1 stale=False | ✅ |
| AS-02 #82, HK.00981 | 1 stale (AS-01) + 1 visible (AS-02) | id=34 stale=True + id=1 stale=False | ✅ |
| code='HK.00981' (no run_id) | 全部 not stale (caller 冇 context) | id=34, id=1 stale=False | ✅ |
| HK.99999 + run_id=86 | 0 reasons | 0 reasons | ✅ |

### Key Architectural Decisions (Option C)

1. **Per-run scoping (SQL)**: `code IN (run's stocks)` — 保留 accumulation, 唔做 source_ref hard filter。
2. **is_stale runtime flag (Python)**: 每個 reason compute `is_stale = (cross-run) AND (cross-algo)` — runtime attribute, 唔做 DB column。
3. **UI filter (Frontend)**: `visibleReasons = reasons.filter(r => !r.is_stale)` — 1 行 hide stale。
4. **Cross-algorithm accumulation 保留**: 同一 stock 跨-run 同-algo 嘅 reasons 全部 not stale (visible)。例: HK.00981 AS-01 from #87 喺 AS-01 #86/#83 view 都 NOT stale (accumulation)。
5. **Cross-algorithm stale hide**: HK.00981 AS-02 from #82 喺 AS-01 #86 view STALE (hide)；AS-01 from #87 喺 AS-02 #52/#82 view STALE (hide)。
6. **Frontend filter 已經 work (大少 #10105)**: AS-02 panel `onSave` 只 pass qualified stocks. Backend 唔需要 enforce qualification check。
7. **Backward compat**: code-only query (no source_run_id) 仍然 work, 全部 `is_stale=False` (e.g. AS-01「結果」頁面 inline render)。

### f25d287f → 075ff644 Comparison

| 項目 | f25d287f (hard filter) | 075ff644 (Option C) |
|---|---|---|
| Cross-algo cross-run stale leak | ❌ Filter 咗 | ❌ UI filter 咗 |
| Cross-run same-algo accumulation | ❌ 失效 | ✅ 保留 |
| Backend SQL 複雜度 | 中 (JOIN + filter) | 低 (code IN only) |
| Frontend 邏輯 | 簡單 (顯示) | 加 1 行 filter |
| Design intent | 嚴格 per-run algorithm | 保留 accumulation + hide stale |

---

## N. Algorithm Layer — `algorithms/` (AS-03 股票周期性判定)

> **新章節 (2026-08-04)** — AS-03 cycle detection sub-project

### 位置

```
~/stockpulse/algorithms/AS-03-cycle-detection/
├── README.md           # 入口 + 快速開始
├── ARCHITECTURE.md     # 完整架構 + 數據流
├── DECISIONS.md        # D001-D010 ADR 決策記錄
├── types.ts            # CycleState / Verdict / Report / Alert 共用類型
├── config.ts           # 所有 tunable thresholds (DEFAULT_CYCLE_CONFIG)
├── data-loader.ts      # HTTP client → GET /api/kline (cache-aside 沿用)
├── index.ts            # CycleDetector 主入口 (runModule / analyze)
├── modules/            # 5 個 peer modules (Module 1-5)
│   ├── ma-alignment.ts
│   ├── hl-structure.ts
│   ├── trendline.ts
│   ├── indicators.ts
│   └── volume.ts
├── orchestrator/       # Module 6 + 7 + 輔助
│   ├── multi-tf.ts     # Module 6 — HTF 約束 LTF (orchestrator step 0)
│   ├── synthesize.ts   # Module 7 — placeholder
│   ├── aggregator.ts   # conflict resolution (placeholder)
│   └── alert.ts        # regime change reminders
└── __tests__/smoke.mjs
```

### 目標

識別股票當前所處嘅周期 (上升 / 下跌 / 橫行 / 轉勢)，輔助大少做交易決策。

### 架構 (7 個點)

- **Module 1-5** (peer modules): MA Alignment, HL Structure, Trendline, Indicators, Volume — 每個都係獨立判斷方法，可單獨調用
- **Module 6** (orchestrator step 0): MultiTFOrchestrator — HTF 約束 LTF (架構上唔係 peer, 見 D001)
- **Module 7** (orchestrator): Synthesizer + Aggregator — placeholder majority vote (D004 待大少決定策略)
- **RegimeChangeAlerter**: 轉勢時 emit alert，大少手動 confirm (D003 唔做 state machine)

### 4 個 Cycle State (D002)

`UP | DOWN | SIDEWAYS | TRANSITION` + 每個 verdict 必填 `interpretation: string` 中文解讀

### 數據來源 (D008)

- **Frontend (data-loader.ts)** HTTP client → `GET /api/kline`
- **Backend `KlineCache`** (cache-aside) 處理 DB + 當日 OpenD 組合
- AS-03 唔需要 re-implement cache — backend 已有 (`backend/services/kline_cache.py`)

### 狀態

- **v0.1.0-skeleton** (2026-08-04) — 5 peer modules + orchestrator + alert 全部 return placeholder verdict (`state='TRANSITION'`, `confidence=0`)
- 等待大少逐個 module 提供詳細做法後實作
- tsc type-check **EXIT=0**

### 相關文檔

- [AS-03 README](../algorithms/AS-03-cycle-detection/README.md)
- [AS-03 ARCHITECTURE.md](../algorithms/AS-03-cycle-detection/ARCHITECTURE.md)
- [AS-03 DECISIONS.md](../algorithms/AS-03-cycle-detection/DECISIONS.md)
- [AS-03 RESEARCH_LOG](../docs/research/AS-03-cycle-detection/RESEARCH_LOG.md)

### Apply Scope (永久 rules)

- ✅ 6 個 module 全包 (D009 / Q3) — 唔分 priority
- ✅ 6 個 model 結果都顯示 (D006) — UI 顯示 5 peer + 1 HTF + 1 synthesized = 7 個 verdict card
- ⚠️ Backtest ground truth (D010 / Q4) — 暫緩，日後先傾
- ⚠️ Synthesizer 策略 (D004) — 3 選 1 (htf-override / weighted-vote / expert-rules)，最後先定


---

## 10. AS-03 算法層 (v0.3.0, 2026-08-04 大少 #10332)

AS-03 係 StockPulse 第一個完全實裝嘅 stock analysis algorithm (Module 1 ma-alignment done)。

### 架構圖

```
┌─────────────────────────────────────────────────────┐
│  AS-03 Cycle Detector                                │
│  algorithms/AS-03-cycle-detection/index.ts          │
└───────────────────┬─────────────────────────────────┘
                    │
   ┌────────────────┼────────────────┐
   ▼                ▼                ▼
┌────────┐   ┌─────────────┐   ┌──────────┐
│ 5 Peer │   │ MultiTF     │   │  Synth   │
│Module  │   │Orchestrator │   │ (Module7)│
│ 1-5    │   │ (Module 6)  │   │          │
└───┬────┘   └─────────────┘   └──────────┘
    │
    ├─ Module 1: ma-alignment (v0.3.0 ✅ DONE — 19/19 tests pass)
    ├─ Module 2: hl-structure (v0.1.0 ✅ DONE)
    ├─ Module 3: trendline (v0.1.0 ✅ DONE — 14/14 tests pass, 大少 #11031)
    ├─ Module 4: indicators (⏳ TBD)
    └─ Module 5: volume OBV (⏳ TBD — 等新 Model)
```

### Module 1: ma-alignment 嘅 10 條算法 (A-J)

| # | 算法 | 規則 | 對應 state |
|---|------|------|-----------|
| A | 上升勢 | 連續 5 日 MA5 > MA60 | UP |
| B | 下跌勢 | 連續 5 日 MA5 < MA60 | DOWN |
| C | 橫行向下 | 5 日裡 MA5 > MA60 但當日 low < MA60 | SIDEWAYS |
| D | 橫行向上 | 5 日裡 MA5 < MA60 但當日 high > MA60 | SIDEWAYS |
| E | 末位日優先 | C/D 多過一日，最後一日為準 | (隱含) |
| F | 升勢調整向下 | MA5+MA10 都 > MA60 但 MA5 < MA10 | UP |
| G | 跌勢調整向上 | MA5+MA10 都 < MA60 但 MA5 > MA10 | DOWN |
| H | 7 日趨勢反轉 | 1/2/3 日新方向 vs 4-7 日舊方向 (3 sub-case) | TRANSITION |
| I | 有機會長升狀態 | 連續 5 日 low ≥ MA5 × 0.98 | supplementary |
| J | 有機會長跌狀態 | 連續 5 日 high ≤ MA5 × 1.02 | supplementary |

### 數據流向

```
[backend /api/kline] (cache-aside: DB + 當日 OpenD)
       ↓
[CycleDetector.analyze(symbol, ltf)]
       ↓
[DataLoader.loadKLines()] → KLine[]
       ↓
[5 Peer Modules.runModule(KLine[], ctx)]
       ├─ ma-alignment → CycleVerdict (A-J rules fired)
       ├─ hl-structure → CycleVerdict (placeholder)
       ├─ trendline → CycleVerdict (placeholder)
       ├─ indicators → CycleVerdict (placeholder)
       └─ volume → CycleVerdict (placeholder)
       ↓
[Synthesizer] → Final CycleVerdict (待 D004 strategy 落實)
       ↓
[RegimeChangeAlerter] (D003 手動 confirm)
       ↓
UI: 5 peer + 1 HTF + 1 synthesized = 7 個 verdict card (D006)
```

### Spec

- Spec: `~/stockpulse/docs/research/AS-03-cycle-detection/MODULE-01-MA-ALIGNMENT.md`
- Code: `~/stockpulse/algorithms/AS-03-cycle-detection/`
- Tests: 19/19 pass, TSC=0

### 已 Drop (v0.2.0 Kimi 13 個算法)

Step 1-7a-d + magic numbers。原因：三個折扣叠太狠 (worst case 0.31)。

---

## §11 · Algorithm Testing Page（2026-08-05, 大少 #10383）

> **背景：** AS-03 算法已 implement + tested，但 StockPulse web/backend 仲未接。為咗畀大少人手測試，建咗 standalone testing page framework。

### Folder Structure

```
~/stockpulse/
├── testing-page/                              ← 中央 testing framework
│   ├── index.html                             ← 主頁
│   ├── testing-page.js                        ← Logic (algorithm registry + dynamic UI)
│   ├── testing-page.css                       ← Style
│   ├── start.command                          ← 啟動 script（nohup + auto-open browser）
│   └── REGISTRY.md                            ← Algorithm list + 加新 AS-XX 步驟
└── algorithms/
    └── AS-03-cycle-detection/
        ├── adapter.mjs                        ← AS-03 adapter（vanilla JS port of ma-alignment.ts）
        └── ... (existing files)
```

### Adapter Pattern（永久 contract）

每個 algorithm 寫 `adapter.mjs`：
```javascript
export const id, name, version, description;
export const inputs = [...];                  // 'string' | 'number' | 'select' | 'autocomplete'
export async function analyze(klines, options) { return verdict; }
export function renderResult(verdict) { return HTML_string; }
export function getHelp() { return HTML_string; }
```

Testing page 自動 discover + render。加新 algorithm 只需要：
1. 寫 `adapter.mjs`
2. 加 1 行落 `testing-page.js` 嘅 `REGISTRY`
3. Browser reload

### Backend Integration

| Resource | Endpoint |
|----------|----------|
| K 線 | `GET /api/kline?code=***&period=***&count=***` |
| 股票搜尋 | `GET /api/stocks/search?q=***&market=HK|US&limit=***` |
| 跑算法 (generic) | TBD — AS-XX 自己實作 `/api/asXX/run` |

### K 線圖表（testing page 自己 render，2026-08-05 大少 #10431）

大少想撳完 AS-03 test 後下邊出日 K 線圖表，full width。原本想 iframe embed StockPulse，但發現 HomePage default 入面係 watchlist widget 唔係 chart（要 user 揀 stock + 登入）。

**最終方案：** CDN load lightweight-charts v4.2.3，vanilla JS render candlestick + volume。
- ✅ 100% width
- ✅ height 600px
- ✅ Auto render 撳完「跑算法」後
- ✅ Dispose 舊 chart + render 新嘅

**Permanent Rule：** testing page 自己 render chart，唔 iframe embed StockPulse。

### Server Lifecycle

- `start.command` 用 `nohup + disown`（server survive terminal close）
- Auto `open http://localhost:8765/testing-page/`（大少 #10396）
- `stop.command` kill server
- Port 8765 reserved

### Spec

- Adapter pattern: `~/stockpulse/testing-page/REGISTRY.md`
- AS-03 adapter: `~/stockpulse/algorithms/AS-03-cycle-detection/adapter.mjs`
- Source: 大少 #10383 / #10396 / #10400 / #10409 / #10423 / #10431

### § Testing Page UI Enhancement (2026-08-06, 大少 #10846 / #10859 / #10871)

**Architecture Overview:**
- Testing page 用 vanilla JS standalone HTML（CDN lightweight-charts v4.2.3）
- Backend adapter (`adapter.mjs`) 將 algorithm port 到 JS
- Frontend render verdict + plain language 解讀

**Recent enhancements (5 commits, 2026-08-06):**

| Commit | Scope | Trigger |
|--------|-------|---------|
| `c62d5fcb` | Module 5 VolumePrice + Module 8 SlopeMomentum + option toggle (D019) | #10809 |
| `4dfe7771` | ARCHITECTURE spec sync + archive quick-draft reference | #10809 |
| `a9c1dd20` | Testing page checkbox UI for VolumePrice + SlopeMomentum | #10846 |
| `a4463444` | Testing page REGISTRY cleanup (remove AS-03-VP/SM dropdown) + UI text 繁→普 | #10859 |
| `2f1f8cc7` | Testing page module section headers + plain language 解讀 templates | #10871 |

**Module Section Pattern (commit `2f1f8cc7`):**
- 兩粒 module section header: 「量价分析」「斜率动能」
- 每個 verdict 旁邊加「人話解讀」面板：
  - 量价: 💰 錢跟價 / ⚠️ 錢唔跟價 / 🔍 無明確信號
  - 斜率: 🚀 強勢升 / 📉 強勢跌 / 🔄 轉勢中 / ⏸️ 等待方向

**Checkbox UI Pattern (commit `a9c1dd20`):**
- Adapter `inputs[]` 加 `type: 'checkbox'` field
- Default `false` — 大少要求 user 主動剔
- `analyze()` 接受 `enableVolumePrice` + `enableSlopeMomentum` flags
- Pass 落 backend `enableFlags` 機制 (D019)

**Permanent Rules:**
- Testing page UI 統一簡體普通話 (commit `a4463444`)
- Module 5/8 + VolumePrice/SlopeMomentum 都係 optional toggle，MA alignment core mandatory (D019)
- Synthesizer default = expert-rules (D004 pending decision)
- Backend emit labels（e.g.「上升勢」「下跌勢」）保持繁體/algorithm context，不強行轉普通話

### § Testing Page Chart Overlay Contract (2026-08-07, 大少指示)

Generic contract 畀 testing page 嘅 K 線圖加多 module 自己嘅 visual overlay (peaks/troughs / MA trend lines / pattern box)：

```javascript
// testing-page/testing-page.js line 476
if (currentAdapter.renderChartOverlay) {
  currentAdapter.renderChartOverlay(verdict, klines, chartRefs);
}
```

`chartRefs` 結構 (testing-page.js line 601):
```javascript
{ chart, candleSeries, priceLines: {} }
// chartRefs.maLineSeries (line series refs) — adapter 自己儲, framework 唔 hard-code
```

**Module 1 (MA alignment) 嘅 overlay (commit `830927cc`):**
- **Trend lines (唔係水平價線)** — 大少要「跟股價走」嘅斜線, 主流 trading app 風格
- 用 `chart.addLineSeries({ color, lineWidth: 2, lastValueVisible: true })` 加 3 條 line series:
  - MA5: 紅 `#FF6B6B`
  - MA10: 青 `#4ECDC4`
  - MA60: 藍 `#45B7D1`
- Re-compute MA 歷史 series (`_computeMASeries(klines, period)` in adapter.mjs) — 頭 `period-1` 個 point 直接 skip (唔 emit null, 避免 lightweight-charts 將 null 當 0 畫)
- 跟 ma-alignment.ts 嘅 `avgClose` 一樣嘅算法, period = 5 / 10 / 60

**Module 2 (高低點結構法) 嘅 overlay:** peaks/troughs markers + 箱體線 + 形態預警 banner (commit `4950de63`)

**Permanent Rules:**
- **Function name 必須叫 `renderChartOverlay`** (testing page 嘅 contract, 唔好 alias) — 之前 `renderMAChartOverlay` 命名錯咗導致 function 永遠 skip (commit `9d77021a`)
- **Trend line 唔好水平價線** — 大少要 `addLineSeries` 跟股價走嘅斜線, 唔係 `createPriceLine` 嘅水平線
- **Skip 唔夠 data 嘅 point, 唔好 emit null** — lightweight-charts v4.2.3 將 null 當 0 處理, 會拉到 y-axis 底部
- 每個 module 自己 implement `renderChartOverlay`, framework 唔 hard-code 任何 algorithm 嘅 visual

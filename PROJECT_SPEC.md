# StockPulse 項目規格書

> 本文件定義 StockPulse 的完整設計，所有實現必須嚴格遵守此規格。
> 此文件跟隨項目走，無論 OpenClaw 如何重裝，只要 clone 项目就能繼續。

---

## 📌 項目概述

| 項目 | 內容 |
|------|------|
| 項目名 | StockPulse |
| 用途 | 股價分析 WebApp（實時報價、組別管理、策略篩選、日曆） |
| 技術棧 | Python FastAPI (Backend) + React + Vite + Ant Design (Frontend) |
| 數據源 | 富途 FutuOpenD (127.0.0.1:11111) |
| 部署 | macOS LaunchAgent (auto-restart on reboot / crash) |

---

## 🎯 設計原則

### 1. 多模組架構
- 每個功能係獨立 Component/Module
- 功能之間 **零耦合**，靠 Context/Hooks 溝通
- 插拔式設計，可以獨立測試/移除

### 2. Library 內建方法優先
- 寫 code 前先 `dir()` / `help()` 查內建方法
- FutuOpenD 和 圖表工具特別注意
- 有現成就不用自己寫

### 3. 響應式設計
- Desktop: 側邊欄 + 多列內容
- Mobile: 底部導航 + 單列內容

---

## 📂 目錄結構

### 後端 (backend/)

```
backend/
├── main.py                    # 入口，只負責啟動
├── config.py                  # 配置模組
│
├── futu_conn/                # 富途行情模組
│   ├── __init__.py
│   ├── handler.py            # QuoteHandler - 解析回調
│   └── subscription.py       # SubscriptionManager - 訂閱管理
│
├── ws/                        # WebSocket 模組
│   ├── __init__.py
│   ├── manager.py            # ConnectionManager - 連接管理
│   ├── session.py            # SessionManager - Session 狀態
│   ├── broadcaster.py        # QuoteBroadcaster - 廣播器
│   └── router.py             # WebSocket 路由
│
├── api/                       # HTTP API 模組（預留）
│
├── services/                  # 公共服務
│   └── event_bus.py         # 事件總線
│
├── data/                      # 數據模組（預留）
│
└── logs/                      # 日誌目錄
```

### 前端 (web/)

```
web/src/
├── components/                    # 通用組件庫
│   ├── common/                   # 通用組件
│   │   ├── Button/
│   │   ├── Card/
│   │   ├── Modal/
│   │   ├── Tag/
│   │   ├── Input/
│   │   └── Dropdown/
│   │
│   ├── layout/                   # 佈局組件
│   │   ├── AppLayout/           # 主佈局（側邊欄 + 內容）
│   │   ├── Header/              # 頂部導航
│   │   ├── Sidebar/            # 側邊欄
│   │   └── MobileNav/          # 手機底部導航
│   │
│   ├── stock/                   # 股票相關組件
│   │   ├── StockCard/          # 股票卡片（顯示報價）
│   │   ├── StockSearch/        # 股票搜索（自動完成）
│   │   ├── StockList/          # 股票列表
│   │   └── StockDetail/        # 股票詳情
│   │
│   ├── group/                  # 組別相關組件
│   │   ├── GroupCard/          # 組別卡片
│   │   ├── GroupList/         # 組別列表
│   │   ├── GroupItem/         # 組別列表項
│   │   └── AddToGroupModal/   # 加入組別彈窗
│   │
│   ├── strategy/               # 策略相關組件
│   │   ├── StrategyCard/      # 策略卡片
│   │   ├── StrategyList/      # 策略列表
│   │   ├── StrategyEditor/    # 策略編輯器
│   │   └── StrategyResult/    # 策略結果
│   │
│   ├── calendar/              # 日曆相關組件
│   │   ├── CalendarView/      # 日曆視圖
│   │   ├── CalendarDay/       # 日期單元格
│   │   └── CalendarEvent/     # 日曆事件
│   │
│   └── watchlist/             # 關注列表組件
│       ├── WatchlistCard/     # 關注股票卡片
│       └── WatchlistPanel/    # 關注面板
│
├── pages/                      # 頁面
│   ├── HomePage/              # 首頁（組別列表）
│   ├── WatchlistPage/         # 關注股票頁
│   ├── StrategyPage/          # 策略頁
│   ├── CalendarPage/          # 日曆頁
│   ├── StockDetailPage/       # 股票詳情頁
│   └── LoginPage/             # 登入頁
│
├── hooks/                      # 自定義 Hooks
│   ├── useWebSocket.ts        # WebSocket 連接
│   ├── useStockSearch.ts      # 股票搜索
│   ├── useGroups.ts           # 組別管理
│   ├── useWatchlist.ts        # 關注列表
│   ├── useStrategy.ts         # 策略管理
│   └── useCalendar.ts         # 日曆
│
├── context/                    # React Context
│   ├── AuthContext.tsx        # 認證上下文
│   ├── StockContext.tsx       # 股票數據上下文
│   ├── WebSocketContext.tsx   # WebSocket 上下文
│   └── ThemeContext.tsx       # 主題上下文
│
├── services/                   # API 服務
│   ├── api.ts                 # API 請求封裝
│   ├── stockService.ts        # 股票 API
│   ├── groupService.ts        # 組別 API
│   ├── strategyService.ts     # 策略 API
│   └── calendarService.ts     # 日曆 API
│
├── types/                      # TypeScript 類型
│   ├── stock.ts               # 股票類型
│   ├── group.ts               # 組別類型
│   ├── strategy.ts            # 策略類型
│   └── calendar.ts            # 日曆類型
│
├── utils/                      # 工具函數
│   ├── formatters.ts          # 格式化工具
│   └── validators.ts          # 驗證工具
│
└── styles/                     # 全域樣式
    ├── variables.ts           # CSS 變量
    ├── mixins.ts              # 混合樣式
    └── global.ts              # 全域樣式
```

---

## 🔄 Background Services (LaunchAgents)

> 大少 2026-08-03 永久 fix — Backend / Vite / Miniapp / Logrotate 由 macOS LaunchAgent 自動管理。
> 修咗兩個 deadlock：(1) Vite reboot / crash 後永久死、(2) log 長期塞爆 disk。

### Service 清單

| Service | Label | Schedule | Port |
|---------|-------|----------|------|
| Backend | `com.stockpulse.trigger` | RunAtLoad + KeepAlive | 18792 |
| Vite dev | `com.user.stockpulse-vite` | RunAtLoad + KeepAlive | 3000 |
| Miniapp | `com.user.stockpulse-miniapp` | RunAtLoad | 18793 |
| Logrotate | `com.user.stockpulse-logrotate` | StartInterval=1800s (30min) | — |

### 文件路徑

| 類型 | 路徑 |
|------|------|
| Scripts | `~/stockpulse/scripts/start_vite.sh` / `rotate_logs.sh` |
| Plists | `~/Library/LaunchAgents/com.user.stockpulse-{vite,logrotate}.plist` |
| Logs | `~/stockpulse/logs/{vite,launchd,stockpulse}.log` |

### 設計原則

1. **絕對 path + export PATH** — LaunchAgent 唔繼承 shell rc，要 hard-code `/opt/homebrew/bin/npm`
2. **殺舊 → 釋 port → 起新** — `start_vite.sh` pattern 避免 double-bind
3. **Disk-safe rotation** — `rotate_logs.sh` 用 tail + truncate，**唔用 cp**（會 disk-double, tight space 必 crash）
4. **ThrottleInterval** — 防 crash loop thrash

### 常用 commands

```bash
launchctl list | grep stockpulse
launchctl load ~/Library/LaunchAgents/com.user.stockpulse-vite.plist
bash ~/stockpulse/scripts/rotate_logs.sh   # 手動 trigger
```

---

## 🖥️ UI 設計

### 頁面結構

```
┌─────────────────────────────────────────────────────────┐
│  Header: Logo | 搜索框 | 連接狀態 | 登出              │
├───────────┬─────────────────────────────────────────────┤
│           │                                             │
│  Sidebar  │   組別列表 / 內容區域                       │
│  (Desktop)│                                             │
│           │                                             │
│  • 首頁   │                                             │
│  • 關注   │                                             │
│  • 策略   │                                             │
│  • 日曆   │                                             │
│           │                                             │
├───────────┴─────────────────────────────────────────────┤
│  MobileNav: 首頁 | 關注 | 策略 | 日曆                   │
└─────────────────────────────────────────────────────────┘
```

### 響應式斷點

| 設備 | 寬度 | 佈局 |
|------|------|------|
| Mobile | < 768px | 單列，底部導航 |
| Tablet | 768-1024px | 雙列，側邊欄可折疊 |
| Desktop | > 1024px | 多列，完整側邊欄 |

---

## 📱 頁面功能

### 1. 首頁 (HomePage) - 組別列表

**功能：**
- 顯示所有用戶組別
- 每個組別可展開/折疊
- 組內股票顯示實時報價
- 組別管理（創建、編輯、刪除）
- 加入/移除股票

**組別卡片內容：**
```
┌─────────────────────────────────────────┐
│ ▼ 科技股                    [+][筆][🗑️] │
├─────────────────────────────────────────┤
│ 00700 騰訊控股    493.40    +1.2%  🔴  │
│ 00981 中芯國際     64.30    +5.8%  🔴  │
│ 01810 小米集團     45.20    -0.3%  🟢  │
└─────────────────────────────────────────┘
```

### 2. 股票搜索 (StockSearch)

**功能：**
- 0.5 秒防抖
- 支持代碼或名稱搜索
- 鍵盤上下導航
- Enter 確認選擇
- 點擊選擇

**搜索結果：**
```
HK.00700  騰訊控股
HK.00981  中芯國際
HK.01810  小米集團
```

### 3. 關注股票頁 (WatchlistPage)

**功能：**
- 顯示所有關注股票
- 股票顯示是否中了策略（紅色邊框提示）
- 點擊查看中了哪些策略
- 添加/移除關注

### 4. 策略頁 (StrategyPage)

**功能：**
- 策略列表（AI 模式 / 代碼模式）
- 創建策略
- 執行策略（手動 / 定時）
- 策略 AND/OR 組合
- 查看歷史結果

### 5. 日曆頁 (CalendarPage)

**功能：**
- 月曆視圖
- 有結果的日期有標記
- 點擊日期查看當日策略結果

### 6. 股票詳情頁 (StockDetailPage)

**功能：**
- K 線圖（TradingView Lightweight Charts）
- 實時報價
- 基本資料
- 策略匹配情況

---

## 💾 數據庫 Schema

```sql
-- 用戶表
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 組別表
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#666666',
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 股票表（基礎數據）
CREATE TABLE stocks (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  market TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 組別-股票關聯表
CREATE TABLE group_stocks (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id),
  FOREIGN KEY (stock_code) REFERENCES stocks(code),
  UNIQUE(group_id, stock_code)
);

-- 策略表
CREATE TABLE strategies (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  prompt TEXT,
  code TEXT,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 定時任務表
CREATE TABLE scheduled_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  cron_expr TEXT NOT NULL,
  strategy_ids TEXT NOT NULL,
  combine_type TEXT DEFAULT 'AND',
  enabled INTEGER DEFAULT 1,
  last_run DATETIME,
  next_run DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 日曆事件表
CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date DATE NOT NULL,
  strategy_id TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  match_details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 關注列表
CREATE TABLE watchlist (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (stock_code) REFERENCES stocks(code),
  UNIQUE(user_id, stock_code)
);

-- K 線 cache (大少 #7987, #8505, 永久 rule T-1)
CREATE TABLE kline_cache (
  code TEXT NOT NULL,
  period TEXT NOT NULL,
  time TEXT NOT NULL,
  open REAL, high REAL, low REAL, close REAL,
  volume INTEGER, turnover_rate REAL,
  last_fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (code, period, time)
);
CREATE INDEX idx_kline_lookup ON kline_cache(code, period, time DESC);
```

---

## 🧠 AS-03 Stock Cycle Detection (2026-08-08)

`algorithms/AS-03-cycle-detection/` — 股票週期判定系統,Stage 1 (完成 Module 1-7) 進行中。

### Module 結構 (6 個 done + 1 個 Pending + 1 個獨立 + 2 個 hidden)

> 大少 2026-08-08 10:06 指示: 6 個 modules 加編號 01-06 喺 dropdown displayName, zmen均算法 唔加 (獨立算法)。

| 編號 | Module | 主檔 | Version | 3 Sections |
|------|--------|------|---------|-----------|
| 01 | **均線系統週期判斷法 v2.0** (with Volume & Slope) | `modules/ma-alignment.ts` | **v2.0.0** | ✅ — 3 cycles + 13 fields + 三階段信心調整 |
| 02 | HL Structure | `modules/hl-structure.ts` | v0.1.0 | ✅ |
| 03 | Trendline | `modules/trendline.ts` | v0.1.0 | ✅ |
| 04 | Indicators 動能背馳與衰竭 | `modules/indicators.ts` | v1.0.0 | ✅ |
| 05 | VolumePrice 成交量價格行為確認 | `modules/volume.ts` | **v2.0.0** | ✅ |
| 06 | Volatility 波動率收縮擴張 | `modules/volatility.ts` | **v1.0.0** | ✅ |
| 07 | Synthesizer 綜合判定 | TBD | — | 🚧 Pending (Stage 1 最後一個) |
| **獨立** | **zmen均算法** (唔加編號) | `modules/zmen-ma-alignment.ts` | v0.3.0 | ⭐ 獨立算法 — 抽離 7 個 modules, 排去 dropdown 尾, 唔屬於 AS-03 7 個 modules 計算 |
| ⏸️ Hidden (舊 M5) | Multi-TF (日/週/月) | `modules/multi-tf.ts` | v1.0.0 | — |
| ⏸️ Hidden (舊 M8) | SlopeMomentum 斜率動能 | `modules/slope-momentum.ts` | v1.0.0 | — |

### 3-Section 永久 Rule (大少 #11056)

每個 module 嘅 `render{Module}Result()` 必須 render 3 個 sections:
1. **📖 詳細解讀** — 17+ field 逐個用人話解
2. **🎯 策略建議** — 按 state (UP/DOWN/SIDEWAYS/TRANSITION) 各自建議
3. **💡 點用點睇** — 9-10 步 step-by-step guide

### 統一 Algorithm Design Principles

- **Rule-based + additive confidence** (避免 multiplicative 叠埋)
- **List all matched rules** (唔好 silently pick 一個)
- **State priority 一致**: H > A > B > F > G > C > D > SIDEWAYS + H+G → TRANSITION
- 假設大少只識 PE / ETF / MACD / limit order, 其他 technical term 第一次用要 plain language 解

### Testing Page (大少 #11085 UX, 2026-08-07)

`http://localhost:8765/testing-page/`
- Vanilla JS standalone HTML (CDN lightweight-charts v4.2.3)
- 唔 embed StockPulse main app
- 7 algorithms registered dropdown 排位 (大少 2026-08-08 10:06 加編號):
  ```
  01 — AS-03-MA   (M1 v2.0) ← 第 1 位 (新 M1 跟 docx v2.0 spec, 編號 01)
  02 — AS-03-HL   (M2) ← 第 2 位 (編號 02)
  03 — AS-03-TL   (M3) ← 第 3 位 (編號 03)
  04 — AS-03-IND  (M4) ← 第 4 位 (編號 04)
  05 — AS-03-VP   (M5) ← 第 5 位 (編號 05)
  06 — AS-03-VOL  (M6) ← 第 6 位 (編號 06)
  ────────────────
  zmen均算法 (舊 M1 v0.3.0) ← 最後 (獨立算法, 唔加編號)
  ```
- Dropdown 顯示用 `displayName` (e.g. `01 — AS-03-MA`); 舊 M1 顯示用 `zmen均算法`, 內部 id 維持 `AS-03` 唔變
- **切算法即清結果** (runStatus / resultPanel / chart, 3 個 sections 都喺 resultPanel)
- runStatus 顯示「設定 X 日 / 實際 Y 日 (數據限制)」

### Spec / Roadmap

詳細 spec: `docs/research/AS-03-cycle-detection/ROADMAP.md` (228 行, 7 stages)
每 module: `docs/research/AS-03-cycle-detection/MODULE-XX-*.md`

---

## 🔌 WebSocket 實時報價

**連接地址：** `ws://192.168.1.125:18792/ws/quote`

**消息格式：**

```typescript
// 客戶端發送
{ "action": "init", "codes": ["HK.00700", "HK.00981"] }
{ "action": "unsubscribe_all" }

// 服務端返回
{ "type": "quote", "code": "HK.00700", "name": "騰訊控股",
  "last_price": 493.4, "change": -1.8, "pct_change": -0.36, ... }
{ "type": "init_result", "success": true }
{ "type": "unsubscribe_failed", "cooldown": 60 }
```

---

## 📊 當前實現狀態

### ✅ 已完成
- [x] 項目架構設計
- [x] 後端 WebSocket + 富途整合
- [x] 前端首頁（組別視圖）
- [x] 實時報價顯示
- [x] 取消訂閱冷卻提示
- [x] 設計文檔（PROJECT_SPEC.md）

### ⏳ 待實現
- [ ] 數據庫建設
- [ ] 後端 API 接口
- [ ] 用戶登入/認證
- [ ] 組別 CRUD（創建/讀取/更新/刪除）
- [ ] 股票搜索自動完成
- [ ] 關注股票頁
- [ ] 策略頁
- [ ] 日曆頁
- [ ] 股票詳情頁（K 線圖）
- [ ] 定時任務

---

## 🚀 開發順序建議

### Phase 1: 基礎建設
1. 數據庫初始化（SQLite）
2. API 服務層封裝
3. Context 設計

### Phase 2: 核心功能
4. 組別管理（CRUD）
5. 股票搜索
6. 實時報價整合

### Phase 3: 高級功能
7. 關注股票
8. 策略系統
9. 日曆
10. K 線圖

---

## 🔧 技術選型

| 類別 | 技術 |
|------|------|
| UI 框架 | Ant Design |
| K 線圖 | TradingView Lightweight Charts |
| 狀態管理 | React Context + Hooks |
| 路由 | React Router v6 |
| 樣式 | CSS Modules + CSS Variables |
| 後端框架 | FastAPI |
| 數據庫 | SQLite |
| 實時數據 | WebSocket + FutuOpenD |

---

## 📝 備註

- 所有代碼改動必須加詳細 comment
- Commit message 要清楚說明改了什麼
- 詳細記錄見 `memory/stockpulse/` 目錄

---

_最後更新：2026-08-03 (大少 / AI assistant sync — LaunchAgent 永久 fix)_

---

## 📦 Stock Reasons (大少 2026-08-03 #9920)

### 概述

每隻股票嘅 reason 由原本嘅 plain text (string, 唔夠表達表格/圖表) → sanitized HTML 報告，獨立 table 儲存。

### 設計哲學

- **Generic table** — `stock_reasons` 唔只係 algorithm-specific，將來 manual notes / news / research 都用同一 table
- **Smart Dedupe** — 同一 `(code, source_type, source_ref)` 重做 → overwrite 最新版本 (RECOVER semantics)
- **Soft delete** — `is_active` flag，永遠保留 audit trail
- **Cross-run accumulation** — 同一 stock 喺唔同 algorithm runs 入面嘅 reasons 自動累積 (query `WHERE code=X` 攞晒)

### Schema

```sql
CREATE TABLE stock_reasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,                      -- FK → stocks.code (logical)
  source_type TEXT NOT NULL,               -- 'algorithm' | 'manual' | 'news' | 'research'
  source_ref TEXT NOT NULL,                -- algorithm_id ('AS-02') or manual ref
  source_run_id INTEGER,                   -- nullable, FK → saved_algorithm_runs.id (logical)
  title TEXT NOT NULL,                     -- '板塊龍頭股篩選'
  html TEXT NOT NULL,                      -- sanitized HTML, ≤ 50KB
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active INTEGER NOT NULL DEFAULT 1,    -- soft delete flag
  UNIQUE(code, source_type, source_ref)
);

CREATE INDEX idx_stock_reasons_code ON stock_reasons(code, is_active, created_at DESC);
CREATE INDEX idx_stock_reasons_run ON stock_reasons(source_run_id) WHERE source_run_id IS NOT NULL;
```

### Frontend Type

```ts
export interface ReasonEntry {
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
}
```

### 舊 Data 處理 (大少 Q2)

- 舊 `saved_stocks[i].reason` string — **wipe** (testing data only)
- ReasonCell v2 提供 fallback: 冇新 format reasons 時，render 舊 truncated text + 「(舊版)」標記
- 唔做 auto-migration (避免複雜度)


---

## 🎨 Stock Reasons Display v2 UX (大少 2026-08-04 #10031)

> **Trigger**: 大少 screenshot HK.00700 嘅 6-dim table — 要求中文 + chart + 顏色 + 大字
> **Status**: ✅ Done (Backend + Frontend + Restart + Backfill all verified)

### 中文 Labels + Weights

6 個維度跟 AS-02 spec 嘅 weighted score formula (30/20/15/15/10/10):

| English Key | 中文 Label | Weight |
|---|---|---|
| `financial` | 財務健康 | 30% |
| `business` | 業務模式 | 20% |
| `management` | 管理層 | 15% |
| `industry` | 行業前景 | 15% |
| `valuation` | 估值 | 10% |
| `risk` | 風險 | 10% |

### Bar Chart Format (取代舊 Table)

每個維度一行 (flex layout):
```html
<div class="dim-row">
  <span class="dim-label">財務健康 <small class="dim-weight">(30%)</small></span>
  <div class="dim-bar-bg"><div class="dim-bar-fill score-med w-70"></div></div>
  <span class="dim-score score-med">70.0</span>
</div>
```

### 顏色 Mapping (大少 2026-08-04)

| Score | Class | Color | Hex |
|---|---|---|---|
| ≥ 75 | `score-high` | 綠 | `#52c41a` |
| 60 - 74 | `score-med` | 黃 | `#faad14` |
| < 60 | `score-low` | 紅 | `#ff4d4f` |

### 字體 + Modal Sizing

| 項目 | v1 | v2 |
|---|---|---|
| Body | 14px | **17px** |
| h3 | 20px (default) | **26px** |
| h4 | 16px (default) | **20px** |
| Modal width | 900px | **1000px** |

### 永久 Rule (2026-08-04)

凡係 component 嘅 HTML content 用 `dangerouslySetInnerHTML` (例如 ReasonPopUp / ReasonCell)，module.css 入面對應嘅 class **必須加 `:global()` 前綴**。原因：Vite CSS Modules 預設 scope local class names (e.g. `_dim-row__abc123`)，但 innerHTML 嘅 class 係 raw (e.g. `dim-row`) — selector 唔 match。

**反面教材**: 2026-08-04 第一次寫 CSS 漏咗 `:global()` 前綴 → 大少 screenshot 報「什麼 Chart 都沒有」— bar chart 0 width 因為 `.dim-row` 變咗 `_dim-row__abc123` 而 HTML 係 raw。


---

## 📊 算法規格 (AS-XX Series)

### AS-03 · 股票周期性判定 (umbrella v1.0.0), 2026-08-04 大少 #10332)

**目的**：識別股票當前所處嘅周期 (上升/下跌/橫行/轉勢)，輔助交易決策。

**輸入**：`KLine[]` (從 backend `/api/kline` cache-aside)
**輸出**：`CycleVerdict` (state/confidence/interpretation/evidence/meta)

**10 條算法 (A-J)**：

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
| I | 有機會長升狀態 (大少 #10301) | 連續 5 日 low ≥ MA5 × (1 - 2%) | supplementary |
| J | 有機會長跌狀態 (大少 #10301/#10317) | 連續 5 日 high ≤ MA5 × (1 + 2%) | supplementary |

**Status**：Module 1 (ma-alignment) done, 19/19 tests pass, TSC=0

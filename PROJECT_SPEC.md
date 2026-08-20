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

`algorithms/AS-03-cycle-detection/` — 股票週期判定系統,Stage 1 (完成 Module 1-9) 進行中。

### Module 結構 (8 個 done + 1 個獨立 + 2 個 hidden, Stage 1 + Sprint 3 收官)

> 大少 2026-08-08 10:06 指示: 6 個 modules 加編號 01-06 喺 dropdown displayName, M7 用編號 07, M8 用編號 08, M9 用編號 09, zmen均算法 唔加 (獨立算法)。
> 大少 2026-08-08 13:30 指示: Plan A 拆返 M7 + M8 兩個獨立 module (testing page 2 個 entries, 2 份 spec doc, 2 個 codebase files).
> 大少 2026-08-08 22:28 指示: M9 Back Test 開工, Sprint 3 全部 6 個 sub-tasks (9.1-9.6) + 9.7 UI 升級 全部 done (23:55 收官).
> 大少 2026-08-09 09:29 指示: Backend 1w period bug 修 (PERIOD_MAP 加 K_WEEK, 補返 weekly history), 10 隻 (5 港 + 5 美) Pilot 收官 10:02.
> 大少 2026-08-09 09:54 指示: Top 3 (US.AAPL/MSFT/GOOGL) M9 bestParams 套用落 M8 (Node script 拎 1w cache POST 落 M8 cache).
> 大少 2026-08-09 10:57 指示: M9 Pilot 4 個 followup bugs 全部 defer 落 Stage 1+ 處理, Pilot 收官優先.
> 大少 2026-08-09 10:57 指示: M9 Pilot 4 個 followup bugs 全部 defer 落 Stage 1+ 處理, Pilot 收官優先.

| 編號 | Module | 主檔 | Version | 3 Sections |
|------|--------|------|---------|-----------|
| 01 | **均線系統週期判斷法 v2.0** (with Volume & Slope) | `modules/ma-alignment.ts` | **v2.0.0** | ✅ — 3 cycles + 13 fields + 三階段信心調整 |
| 02 | HL Structure | `modules/hl-structure.ts` | v0.1.0 | ✅ |
| 03 | Trendline | `modules/trendline.ts` | v0.1.0 | ✅ |
| 04 | Indicators 動能背馳與衰竭 | `modules/indicators.ts` | v1.0.0 | ✅ |
| 05 | VolumePrice 成交量價格行為確認 | `modules/volume.ts` | **v2.0.0** | ✅ |
| 06 | Volatility 波動率收縮擴張 | `modules/volatility.ts` | **v1.0.0** | ✅ |
| 07 | **終極綜合判定** (Synthesizer — M7) | `modules/synthesizer.ts` | **v1.0.0 (Sprint 1 done, 2026-08-08 13:30 Plan A 拆返)** | ✅ **Sprint 1 done**: M7 Synthesizer 邏輯 (SSI + TCM + Alignment + 8 個 Grade + Kelly) + 6 個 modules standard verdict interface + 64 個 tests + synthesizerAdapter + testing page enable |
| 08 | **終極綜合判斷引擎** (Decision Engine — M8) | `modules/decision-engine.ts` | **v2.0.0 (Sprint 2 收官, 2026-08-09 13:15)** | ✅ **Sprint 2 收官 (大少 16:55 8 commits + 13:15 2.9 spec doc final + 4 fix commits)**: 8 個 finalAction 決策樹 (2.1) + Trading card adaptive (2.2) + 短期走勢 9 scenarios (2.3) + 人話詳細解讀 LLM hook (2.4) + 5 個 adaptive params auto-calibrate (2.5) + L2 JSON cache (2.6) + 10 隻 demo 股票 tests (2.7) + 4 個 SVG chart + 「🔄 重新校準」按鈕 (2.8) + 2.9 spec doc final (Spec Sync #7, README + PROJECT_SPEC + ARCHITECTURE + API 4 份 spec doc 同步) + **Bug 1 fix** (testing page race condition `da32c4db`) + **Bug 2 fix** (M8 kelly override 落 Synthesizer `applyAdaptiveParamsToSynthesizer`, `639e6d70`) + **Bug 3+4 fix** (version 1.0.0 → 2.0.0 + testing page .mjs cache bust sync 永久 rule, `d61d96d6`) |
| **09** | **回測驗證** (Back Test — M9, 時光機驗證官) | `modules/back-test.ts` | **v0.6.0 (Sprint 3 done 2026-08-08 + Pilot 收官 2026-08-09 + Spec Sync #8 2026-08-10 5 fix commits)** | ✅ **Sprint 3 done (大少 22:28 啟動, 23:55 收官, 7 commits 9.1-9.7) + Pilot 收官 (大少 10:02)**: Replay engine + Coarse/Fine grid + Walk-Forward CV 3 folds + Per-symbol optimal cache 30 日 + Forward return 永久 + Testing page entry 09 + HK.00700 pilot + M9 UI 升級 (3 SVG + 6 色標 + 永遠 full show + 大少話你知 + 2 button) + **10 隻 (5 港 + 5 美) Pilot** (1w 統一 config, 399 forward return records 永久累積) + **Top 3 apply 落 M8** (US.AAPL 103.6/82%, US.MSFT 88.8/78%, US.GOOGL 82.0/76%) + **Backend 1w fix** (PERIOD_MAP 加 K_WEEK, 補返 5-10 年 weekly history). **Spec Sync #8 (2026-08-10, 5 fix commits)**: M9 forward return POST silent fail + UI error banner (`788ccab7`) + debug log 移去 normalizedKlines 後 (`ea75ebd1`) + Trade Journal 編號 M10→J (`ffaa7593`) + numFolds 3→1 + tuneRatio 0.67→0.6 過 HLStructure 99 bar gate (`01aed775`) + UI label 動態 + dataWindowDays 252→1260 (`6bd4e2d3`). |
| **獨立** | **zmen均算法** (唔加編號) | `modules/zmen-ma-alignment.ts` | v0.3.0 | ⭐ 獨立算法 — 抽離 7 個 modules, 排去 dropdown 尾, 唔屬於 AS-03 7 個 modules 計算 |
| ⏸️ Deferred (舊 M5) | Multi-TF (日/週/月) | `modules/multi-tf.ts` | v1.0.0 | — (大少 2026-08-09 14:16 揀 A drop, Stage 2+ 重新 plan) |
| ⏸️ Deferred (舊 M8) | SlopeMomentum 斜率動能 | `modules/slope-momentum.ts` | v1.0.0 | — (大少 2026-08-09 14:16 揀 A drop, Stage 2+ 重新 plan) |

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
- 10 algorithms registered dropdown 排位 (大少 2026-08-08 10:06 加編號 + 13:30 拆返 M7+M8 + 22:28 加 M9 + **2026-08-11 Spec Sync #13 改 M9 排 M8 上邊**):
  ```
  01 — AS-03-MA   (M1 v2.0) ← 第 1 位 (新 M1 跟 docx v2.0 spec, 編號 01)
  02 — AS-03-HL   (M2) ← 第 2 位 (編號 02)
  03 — AS-03-TL   (M3) ← 第 3 位 (編號 03)
  04 — AS-03-IND  (M4) ← 第 4 位 (編號 04)
  05 — AS-03-VP   (M5) ← 第 5 位 (編號 05)
  06 — AS-03-VOL  (M6) ← 第 6 位 (編號 06)
  07 — AS-03-SYN  (M7 Synthesizer) ← 第 7 位 (Sprint 1 done, 編號 07)
  09 — AS-03-BT   (M9 Back Test) ← 第 8 位 (Spec Sync #13: 排 M8 上邊反映 M7→M9→M8 chain 邏輯, ID 編號 09 唔改)
  ────────────────
  zmen均算法 (舊 M1 v0.3.0) ← 第 9 位 (獨立算法, 唔加編號)
  ────────────────
  08 — AS-03-DEC  (M8 Decision Engine) ← 第 10 位 (Spec Sync #13: 排 M9 下邊, ID 編號 08 唔改) — 8 個 finalAction 揸車比喻 + Trading card + 短期走勢 + LLM hook 解讀 + adaptive params + L2 cache + SVG chart + **頂部 optimal_params banner (Spec Sync #13 Step 2 B 改善)**
  ```
  註: 11 — AS-03-BTL (M11 Backtest Timeline) 都喺 dropdown 最後 (Stage 2 第三次 focus)
- Dropdown 顯示用 `displayName` (e.g. `01 — AS-03-MA`); 舊 M1 顯示用 `zmen均算法`, 內部 id 維持 `AS-03` 唔變
- **切算法即清結果** (runStatus / resultPanel / chart, 3 個 sections 都喺 resultPanel)
- runStatus 顯示「設定 X 日 / 實際 Y 日 (數據限制)」

**Testing Page 用法 (Spec Sync #13 — 3 個掣)**:
- **「跑算法」掣** (舊): 跑當前 dropdown 揀嘅單一 module
- **「🚀 跑完整鏈條 (M7→M9→M8)」掣** (Spec Sync #13 Step 3 + Spec Sync #14 改善 2 conditional, 紫藍漸層色): 撳 1 個掣自動跑, sequential + conditional
  - **Step 0 (改善 2 — chain conditional)**: check `/api/adaptive-params/{symbol}` 拎 `has_optimal` 30 日 expiry
    - has_optimal=true → skip M9 (4 秒搞掂, 唔再 30-60 秒浪費)
    - has_optimal=false / missing → 跑 M9 (拎新 optimal 落 cache)
  - Step 1/3: 跑 synthesizerAdapter.analyze (M7 綜合)
  - Step 2/3: 跑 backTestAdapter.analyze (M9 回測, 內部 POST 落 cache) — conditional, cache OK 跳過
  - Step 3/3: 跑 decisionEngineAdapter.analyze (M8 最終, 內部 load cache 自動)
  - M9 失敗 fallback 跑 M8, chain 唔 crash
  - 3 個 verdict card 一齊出 (cache OK 跳過 M9 嗰陣只 render M7 + M8), 頂部紫藍 banner 標明「完整鏈條跑完」
  - Skipped step render 1 個藍色 hint box「⚡ 跳過呢個 step (cache 仲有效, M8 已經用緊 cache 嘅 optimal)」
- **M8 verdict 內嵌 M9 summary sub-section** (Spec Sync #14 改善 1):
  - 撳 M8 之後, banner 之後自動 render 1 個 M9 summary 小卡 (從 cache 拎)
  - 5 個 metric mini-cards: 凱利倉位 / RSI 權重 / 均線+峰谷+趨勢線權重 / 穩定度分數 / 樣本+段數
  - 大少唔需要再撳 M9 module 跑, 撳 M8 即刻見到 M9 拎咗咩 optimal 設定
  - Hint: 「💡 想睇詳細 M9 verdict, 撳 M9 module (09 — AS-03-BT) 跑」
- **撳「跑 M8」前自動 check cache 過期** (Spec Sync #13 Step 4 C 改善):
  - 3 種狀況 hint: ⚠️ 過期 (建議撳完整鏈條掣重校) / ✅ 仲有效 (繼續跑) / ℹ️ 冇 cache (第一次跑, 建議撳完整鏈條掣)
  - 唔 auto trigger M9, 只係 hint, 大少自己決定
  - Cache endpoint 拎唔到 fallback 直接跑 M8
- **M8 verdict banner timestamp 修 bug** (Spec Sync #14 改善 3):
  - 之前拎 `cacheInfo.last_calibrated` (params cache 7 日), 但 banner 寫住「由 M9 cache 嚟」邏輯錯
  - Fix: 拎 `/api/adaptive-params/{symbol}/back-test` 拎 `optimalData.last_backtest` (M9 cache 30 日)
  - verdict 新加 `optimal_data` field 包含完整 optimal data

### Cache 永久保留 (Spec Sync #15, 大少 22:38)

永久 rule (大少 2026-08-08 22:28 確認):
- `forward_return_history` 永遠唔 delete (永久保留)
- `optimal` 永久保留 (M9 back test 拎嘅最佳設定)

`backend/services/adaptive_params_cache.py` 嘅 `save_params` function 必須 preserve 已有 optimal 同 forward_return_history, 即使 cache 過期或 `_read_cache` fail 都要 preserve。

Spec Sync #15 同時補 Phase 4 partial 漏咗嘅 6 個 adapter entry header 註解 (maAlignmentV2 / hlStructure / trendline / indicators / volumePrice / volatility) — 每個 5 行 header, 跟既有 entry style。

### Testing Page UX 改善 — 2 個掣 conditional show/hide (Spec Sync #16, 大少 22:50)

**永久 rule**:
- M8 (AS-03-DEC) 揀 chain 掣「🚀 跑完整鏈條」, 其他 module 揀單一跑掣「跑算法」
- 改 module 嗰陣, 自動 show/hide 掣 (onAlgorithmChange 內)
- 「跑完整鏈條」掣只喺 M8 度顯示 (避免其他 module 嘅大少混淆)
- 「跑算法」掣 M8 嗰陣隱藏 (改善 2 chain conditional 之後 M8 跑完整鏈條已經夠用, 拎走多餘掣)

對應 commit: 81f39818

### M9 popup 註解全面化 (Spec Sync #17, 大少 2026-08-13 07:23)

**永久 rule (M7/M8/M9 verdict popup 一致性)**:
- M7 / M8 / M9 三個 verdict 嘅 keyword 全部要有 hover popup 註解 (凡人話, 普通話, 0 英文 technical term)
- Style 全部 inline `<style>` block 喺 verdict HTML render 函數, 唔好放 testing-page.css
  - `.{module}-verdict-tooltip { position: relative; cursor: help; }`
  - `:hover::after { content: attr(data-help); ... }` (黑色背景 92% 透明, 大字 14px, max-width 380px, 即時顯示 0.1s)
  - `:hover::before { content: ''; border: 6px solid transparent; border-top-color: ...; }` (箭嘴)
  - `@keyframes {Module}TooltipFadeIn { from { opacity: 0; } to { opacity: 1; } }`
- `{Module}_TOOLTIPS` dict 喺 verdict render 函數入面 define, 改 keyword 嗰陣必須一齊更新
- 應用 span / div / svg / button / th / td 都得, 視乎 keyword 嘅 layout
- 大少 trigger (2026-08-13 07:23):「你先把M9都一樣加上Popup註解, 要全面化, 普通話無英文, 講人話」

**M9 25 個 key 對應 8 section** (跟 M9 verdict HTML 結構):
| Section | Key 數 | Key list |
|---------|-------|----------|
| 1 頂部時段表 | 4 | m9_title / m9_period / m9_folds / m9_samples |
| 2 最佳參數 | 5 | m9_kelly / m9_kelly_pct / m9_kelly_pie / m9_rsi_weight / m9_ssi_weights |
| 3 整體表現 | 4 | m9_avg_score / m9_stability / m9_samples_box / m9_folds_box |
| 4 Walk-Forward bar | 3 | m9_wf_bar / m9_tune_score / m9_validate_score |
| 5 段細節表 | 1 (新) | m9_fold_n (重 m9_tune_score / m9_validate_score) |
| 6 Forward return | 5 | m9_scatter / m9_fwd5 / m9_fwd10 / m9_fwd20 / m9_hit |
| 7 大少話你知 | 1 | m9_advice |
| 8 Apply to M8 | 2 | m9_recalibrate / m9_apply |
| **總** | **25** | 36 個 instance (有 reuse) |

對應 commit: 9f72b113 (feat(m9-rendering): M9 popup 註解全面化)

### Backend Algorithm Framework (Spec Sync #21, 2026-08-20)

**凡人話解釋**: 大少 2026-08-20 19:50 trigger「最終想把所有演算法搬去 backend」, 啟動 StockPulse algorithms → Python backend migration roadmap。Phase 1 (framework + ZigZag) + Phase 2 (M1 MA Alignment) done 2026-08-20, Phase 3+ 之後逐個 port 落 backend。

**設計原則**:
- **Algorithm ABC pattern** (`backend/algorithms/base.py`): `Algorithm.run(klines, options) → Verdict`, 每個 algorithm 一個 folder (e.g. `zigzag/`, `ma_alignment/`)
- **Verdict dataclass**: `ok / points / meta / warnings / error`, 統一 shape
- **Registry pattern** (`backend/algorithms/registry.py`): 全部 algorithm 用 `register(name, cls)` 自動 expose, 3 個 endpoint 自動生成
- **Algorithm runner** (`backend/services/algorithm_runner.py`): 統一 fetch K-line + 跑 algorithm + 包 response
- **Caller inject pattern**: M1 要 ZigZag 做 dependency, runner 自動跑 ZigZag + inject 落 M1 options, M1 唔需要知道 backend 有邊個 algorithm
- **Python module naming**: 用 underscore (`ma_alignment`) 唔用 hyphen (`ma-alignment`), 跟 PEP 8
- **Frontend `analyze` 變 fetch backend stub**: 拎走 1000+ 行 duplicated logic, testing page call site 完全唔改

**永久 rule (5 個 new rule)**:
- ✅ **Algorithm ABC contract** (`backend/algorithms/base.py`): `Algorithm.run(klines, options) → Verdict`, 永久 rule
- ✅ **Verdict dataclass shape** (`ok / points / meta / warnings / error`): 統一
- ✅ **Registry pattern** (`backend/algorithms/registry.py`): 全部 algorithm 必須 `register(name, cls)`, 永久 rule
- ✅ **Caller inject pattern** (`algorithm_runner.py`): algorithm dependency 由 runner 自動 inject, algorithm 唔需要直接 import 另一個 algorithm
- ✅ **Python module naming underscore** (`ma_alignment` not `ma-alignment`): 跟 Python PEP 8, 永久 rule

**Phase 1+2 done (2026-08-20)**:
- **Phase 1** (framework + ZigZag) v1.0.0: `backend/algorithms/zigzag/`
- **Phase 2** (M1 MA Alignment) v2.0.0: `backend/algorithms/ma_alignment/`
- pytest 163/163 PASS (ZigZag 11 + M1 9 + existing 143)
- 凡人話: 一個 source of truth, 之後加 machine learning / Bayesian 容易, miniapp + cron + batch run 可以直接 reuse

**Phase 3 done (2026-08-20)**:
- **Phase 3** (M2 HL Structure 高低點結構法) v0.1.0: `backend/algorithms/hl_structure/`
- M2 自己 derive peaks/troughs 拎 klines, **唔需要** caller inject (ZigZag dependency)
- pytest 173/173 PASS (M2 10 + existing 163)
- 5 隻 stock comprehensive test + cap 圖: HK.00700 騰訊 / HK.00005 匯豐 / US.AAPL / US.MSFT / US.GOOGL
- 凡人話: M2 拎 frontend 337 行 (analyzeHLStructure + 4 個 helper) 換 1 個 backend fetch stub, frontend 3 個 render function 拎 `verdict.X` → `verdict.meta.X` 對齊 backend shape

**Phase 4 done (2026-08-20)**:
- **Phase 4** (M3 Trendline 趨勢線法) v0.1.0: `backend/algorithms/trendline/`
- M3 自己 derive support/resistance line + channel 拎 klines (線性回歸), **唔需要** caller inject
- pytest 183/183 PASS (M3 10 + existing 173)
- 5 隻 stock verify: HK.00700 騰訊 SIDEWAYS 0.65 / HK.00005 匯豐 UP 0.90 / US.AAPL SIDEWAYS 0.70 / US.MSFT UP 0.90 / US.GOOGL SIDEWAYS 0.65
- 凡人話: M3 拎 frontend 506 行 (analyzeTrendline + 7 個 helper) 換 1 個 backend fetch stub, frontend 4 個 render function 拎 `verdict.X` → `verdict.meta.X` 對齊 backend shape

**Phase 5+6 done (2026-08-20, 大少 21:10 trigger「連做」)**:
- **Phase 5** (M4 Indicators 動能背馳與衰竭) v1.0.0: `backend/algorithms/indicators/`
- **Phase 6** (M5 VolumePrice 量价確認) v2.0.0: `backend/algorithms/volume_price/`
- M4 + M5 都係 standalone algorithm, 自己 derive RSI/MACD/OBV/VWAP 拎 klines, **唔需要** caller inject
- pytest 204/204 PASS (M4 10 + M5 11 + existing 183)
- 5 隻 stock verify: M4 全部 SIDEWAYS + hold; M5 全部 SIDEWAYS + NEUTRAL (4-6 rules V1-V15 觸發)
- 凡人話: M4 拎 frontend 566 行 (analyzeIndicators + 9 個 helper) + M5 拎 frontend ~993 行 (analyzeVolumePrice + helper) 換 2 個 backend fetch stub, frontend 8 個 render function 拎 `verdict.X` → `verdict.meta.X` 對齊 backend shape
- **Combined feat commit 永久 rule** (大少 21:10 trigger「連做」): 同一 trigger 嘅多個 module 用 1 個 feat commit (例如 Phase 5+6 = 1 個 commit), 唔好分拆, 但 spec sync 仍然 1 個獨立 commit
- **凡人話 line number shift fix pattern** (Phase 4 教訓, 大少 2026-08-20 20:50): 用 string search 而唔係 hardcode line number, 拎走後再 grep 確認範圍, 之後 migration 通用 pattern
- **Backend register pattern 永久 rule** (Phase 5 fix 教訓): `register(instance)` 而唔係 `register("name", cls)`, 1 個 argument
- **Backend port 流程永久 rule**: source file → algorithm.py (1:1 port) → config.py → __init__.py → __init__ import → tests → pytest pass → frontend migration → 5 stock verify

**凡人話 line number shift fix pattern** (Phase 4 教訓, 大少 2026-08-20 20:50): 拎走舊 function 之前必須重新 grep 實際 line 位置, hardcode 舊 line number 一定錯 (Phase 3 之後 + 506 行 shift 嘅 fix 教訓)。

**Backup tag + 還原方法** (大少 2026-08-20 18:39 永久 rule):
- Tag: `pre-zigzag-backend-refactor-2026-08-20` (annotated)
- Backup folder: `backups/zigzag-frontend-2026-08-20/` (852K, 8 個 file)
- 還原方法: 詳見 `backups/zigzag-frontend-2026-08-20/RESTORE.md` (4 個 scenario A/B/C/D)
- `.gitignore` 加 `backups/`: backup folder 唔 commit 入 git history
- Apply 條件: Phase 3+ 做之前必須確認 backup 仲喺度

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

## 📓 Trade Journal (Stage 1+ MVP + Followup, 大少 15:04 揀 Full scope)

大少真正落實倉位後記錄落 Trade Journal, 之後 mark 啱/錯, 拎真實 forward return, 之後 tune 5 個 adaptive params (Stage 1+ 真實 forward return tracking)。

### 6 個 Endpoint

| Method | URL | 用途 |
|--------|-----|------|
| `POST` | `/api/trade-journal` | 加 entry (永久保留, UNIQUE(symbol, entry_date) 防止重複) |
| `GET` | `/api/trade-journal` | 列出 entries (optional filter by symbol, limit 1-500) |
| `GET` | `/api/trade-journal/stats?symbol=&days=30` | 計算 6 個 metrics 過去 N 日 (Stage 1+ followup) |
| `GET` | `/api/trade-journal/{id}` | 拎單一 entry by id |
| `PUT` | `/api/trade-journal/{id}` | 改 entry 嘅 actual exit + 啱/錯 mark (Stage 1+ followup) |
| `DELETE` | `/api/trade-journal/{id}` | 刪 entry by id (Stage 1+ followup) |

### DB Schema (13 column)

| Column | Type | Nullable | 用途 |
|--------|------|----------|------|
| `id` | INTEGER PK AUTOINCREMENT | NO | 自動編號 |
| `symbol` | TEXT | NO | 股票 code (e.g. 'HK.00700') |
| `entry_date` | TEXT | NO | 買入日期 YYYY-MM-DD (UNIQUE with symbol) |
| `entry_price` | REAL | NO | 買入價 (> 0) |
| `shares` | REAL | NO DEFAULT 1.0 | 買入股數 |
| `target_price` | REAL | YES | 目標價 (optional) |
| `stop_loss` | REAL | YES | 止蝕價 (optional) |
| `notes` | TEXT | YES | 大少 備註 |
| `created_at` | TEXT | NO DEFAULT NOW | 創建時間 |
| `actual_exit_date` | TEXT | YES | 真實賣出日期 (Stage 1+ followup) |
| `actual_exit_price` | REAL | YES | 真實賣出價 (Stage 1+ followup) |
| `is_correct` | INTEGER | YES (0/1/NULL) | 啱(True)/錯(False)/未 mark(NULL) (Stage 1+ followup) |
| `updated_at` | TEXT | YES | 最後改時間 (Stage 1+ followup) |
| `source` | TEXT | YES (default `'manual'`) | **Hybrid 來源標記 (2026-08-10 09:33 大少 confirm Option 3)** — 3 個 values: `'manual'` (大少真實 trade) / `'paper_trading'` (Sprint 2 獨立 page sim) / `'m9_pilot_derive'` (M9 Pilot 過去 records 累積 baseline) |

### 6 個 Metrics (大少 15:04 揀 default)

| Metric | 計法 | 用途 |
|--------|------|------|
| `total` | window 內 total entries | 統計 window 大小 |
| `correct_count` | `is_correct = 1` 嘅 entry 數 | 啱嘅次數 |
| `hit_rate` | `correct_count / (entries with is_correct not null)`, 0-1 | 命中率 (前端顯示 * 100 加 % 號) |
| `avg_return_5d` | holding period ≤ 5 日嘅 entry 平均 forward return | 短線表現 |
| `avg_return_20d` | holding period 5-20 日嘅 entry 平均 forward return | 中線表現 |
| `best_worst_trade.best` | 所有 holding period 嘅最高 forward return | 最佳表現 |
| `best_worst_trade.worst` | 所有 holding period 嘅最低 forward return | 最差表現 |

### 3 Forward Return Bucket 邏輯 (大少 15:04 default)

- holding period = `actual_exit_date - entry_date` (日數)
- holding ≤ 5 日 → 入 `avg_return_5d` bucket
- 5 < holding ≤ 20 日 → 入 `avg_return_20d` bucket
- holding > 20 日 → 唔入 avg bucket, 但入 `best_worst_trade`
- 自動分桶, 大少只需要 mark 一次 actual_exit_date + actual_exit_price, system 自動根據 holding period 分桶

### 大少 15:04 預設 (defaults)

- forward return 用 `actual_exit_price` (大少手動 mark 真實賣出價, 唔自動 fetch 5/20 日後股價 — 簡單可靠, 對齊大少真實買賣日)
- `is_correct` 手動 mark (大少自己判斷, NULL = 未 mark — MVP 簡單版, Stage 1+ 30+ 樣本後再考慮 auto-calculate)
- hit_rate 用小數 (0.667), 前端顯示 * 100 加 % 號
- DB column 用 standard naming (`actual_exit_*` / `is_correct` / `updated_at`)

### Use Case

1. 大少喺 testing page 見 M8 BUY 訊號 (US.AAPL / MSFT / GOOGL Top 3) → 落實倉位 → 加 Trade Journal entry
2. 過 5/20 日 → 返去 testing page → 撳「✏️ 改」+ 輸入 actual_exit_price + actual_exit_date
3. 撳「✅ 啱」或「❌ 錯」 mark 啱錯
4. 統計 panel 自動計算 6 個 metrics (命中率 / avg return / best/worst)
5. 累積 30+ 樣本 → tune 5 個 adaptive params (Stage 1+ Bayesian tune, 1-2 hour)
6. Stage 1+ 真實 forward return workflow 完成

### Spec Doc 連結

- `ARCHITECTURE.md` §15.9 — Trade Journal Followup 詳細 spec (4 個新 column + 3 個新 endpoint + 6 個 metrics 設計 + 3 forward return bucket 邏輯)
- `API.md` 📓 Trade Journal API section — 6 個 endpoint 詳細 + 4 個新 column + 6 個 metrics schema
- `README.md` 📓 Trade Journal section — 6 個 endpoint 列表 + Testing page UI 設計

---

## 📊 Stock Price 即時股價 (Stage 1+, 大少 15:45 揀)

大少喺 testing page 紅框最左位置加「最新股價 + 日期時間」column,frontend 5 秒 polling backend 拎即時股價。休市時 keep last known + 加「(休市)」caption。

### Endpoint

| Method | URL | 用途 |
|--------|-----|------|
| `GET` | `/api/stock-price/{symbol}` | 拎當下股價 (Futu `ctx.get_cur_kline` 今日 partial bar close) + is_market_open + is_stale + currency |

### 6 個 Response field

| Field | Type | 用途 |
|-------|------|------|
| `symbol` | str | 股票 code (e.g. 'HK.00700' / 'US.AAPL') |
| `price` | float / null | 當下股價 (close from today partial bar) |
| `time` | str (ISO 8601) | server fetch time (HKT) |
| `bar_time` | str (HH:MM:SS) | today bar 嘅 time / null |
| `is_market_open` | bool | 簡單 weekday + hour 判斷 (HK 9:30-16:00 / US HKT 21:30-04:00 next day) |
| `is_stale` | bool | true if price is null (休市 / 連接未建立 / OpenD 拎唔到 bar) |
| `currency` | str | 'HKD' / 'USD' |

### 大少 15:45 預設 (5 個 default)

1. **Polling 頻率**: 5 秒 (前端 `setInterval`)
2. **Date/time format**: `MM-DD HH:mm:ss` (12 char)
3. **休市 hold 邏輯**: 拎唔到 price → keep last known + 顯示「(休市)」caption
4. **Backend source**: `ctx.get_cur_kline` (已存在, KLineCache._fetch_today_bar 同 pattern)
5. **UI 位置**: Trading card row 最左 column, date/time 上 + price 下

### Use Case

1. 大少喺 testing page 揀 AS-03-DEC algo + 輸入 stock code
2. 撳「跑算法」→ backend 跑 verdict, frontend render trading card
3. 跑完 algo 自動 start 5 秒 polling `/api/stock-price/{symbol}`
4. Trading card row 改 5 column, 最左加新 column 顯示「⏱️ 08-09 15:35:42 / HK$ 497.50」
5. 開市時股價 update 正常;16:00 後 / 週末 → freeze last known + 加「(休市)」caption
6. 換 algo → 自動停舊 polling, start 新 polling

### Spec Doc 連結

- `ARCHITECTURE.md` §15.10 — Stock Price 即時股價 詳細 spec
- `API.md` 📊 Stock Price API section
- `README.md` 近期重要更新 row

---

## 📊 當前實現狀態

### ✅ 已完成
- [x] 項目架構設計
- [x] 後端 WebSocket + 富途整合
- [x] 前端首頁（組別視圖）
- [x] 實時報價顯示
- [x] 取消訂閱冷卻提示
- [x] 設計文檔（PROJECT_SPEC.md）
- [x] **Trade Journal (Stage 1+ MVP + Followup, 2026-08-09 15:04 揀 Full scope)**: 6 個 endpoint (POST/GET/GET-stats/GET-id/PUT/DELETE) + 4 個新 column (actual_exit_date / actual_exit_price / is_correct / updated_at, idempotent migration) + 6 個 metrics (total / correct_count / hit_rate / avg_return_5d / avg_return_20d / best_worst_trade) + 3 forward return bucket 邏輯 (≤5日 / 5-20日 / >20日) + 5 個 pytest + testing page 4 個 button (啱/錯/改/刪) + 統計 panel (6 色, 永遠 full show) + 4 份 spec doc 同步
- [x] **兩線策略 (Position + Swing, 2026-08-09 19:06 揀 A 開工)**: `decision-engine.ts` 加 `StrategyMode` + `PositionTradingCard` + `decidePosition()` 8 個 finalAction priority chain (TRAP > TRANSITION > SELL > REDUCE > WAIT > HOLD > ADD > BUY) + `cycle-synthesizer.ts` 新 module (M1 60% + zmen 40% 加權綜合 + 5 個 MA trigger: MA5-2%/穿1日/穿2日/MA20跌破/re-test 成功 + 2 個 cycle transition: turnAround/adjustmentComplete) + adapter.mjs 兩線 wrapper (第一線 position 先, 第二線 swing 後, UI 永遠 full show 3 個 cycle synth 結果 + 5 trigger + 2 transition + position trading card) + Position Trading Card 動態 MA5 × 0.98 stop + MA20 trailing + Kelly octo 1/8 + 持倉 1-3 個月 + 唔好追高 + testing page 「交易策略」dropdown (📈 中長線 / 🎯 短炒) + 10 pytest (14 個 Node.js assertion) + 4 份 spec doc 同步 (ARCHITECTURE §15.11) + 永久 rule 收穫: `computeMA(closes, period)` convention 改 `[0] = 今日` (原本寫錯 `[0] = 最舊`)

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

### Module Warning v1.1.0 — 2 Banner 分類 (大少 2026-08-14 11:33, Spec Sync #18)

**永久 rule**:
- Warning 永久分 2 個 category: 🔧 system (12 個, verdict 可能唔可信) + 📊 stock_state (3 個, verdict 已經準確)
- 2 個 category 永遠 render 2 個獨立 banner (`renderWarningBanners()` 喺 `lib/warnings.mjs`)
- 13 個 warning code 嘅 `impact`/`fix` 統一跟 `CATEGORY_DISPLAY` template
- `issue` 保留各 module 嘅 specific context

**Template 統一**:
- system impact: `Verdict 唔可信, 唔好落單` / fix: `Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc`
- stock_state impact: `Verdict 已經準確, 留意股票狀態` / fix: `睇其他 module 確認 / 留意 M7 alignment`

對應 commit: 7ba21cc7 + 即將 push 嘅 Phase 4

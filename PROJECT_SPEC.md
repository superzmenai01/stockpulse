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

### 後端 (trigger/)

```
trigger/
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
```

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

_最後更新：2026-04-26_

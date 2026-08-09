# StockPulse 📈

> 股價分析 WebApp — 實時報價、組別管理、策略篩選、算法分析、日曆

---

## ⚡ 快速開始

### 1. Clone 項目
```bash
git clone https://github.com/superzmenai01/stockpulse.git
cd stockpulse
```

### 2. 安裝依賴

**Python（後端）：**
```bash
python3 -m venv ~/.futu_venv
~/.futu_venv/bin/pip install -r requirements.txt
```

**Node.js（前端）：**
```bash
cd web
npm install
```

### 3. 啟動富途 OpenD
確保富途牛牛已安裝並運行，Port: `11111`

### 4. 啟動服務

**終端 1 — 後端：**
```bash
cd stockpulse/backend
~/.futu_venv/bin/python3 main.py
```

**終端 2 — 前端：**
```bash
cd stockpulse/web
npm run dev
```

### 5. 打開瀏覽器
```
http://localhost:3000
```

---

## 📁 項目結構

```
stockpulse/
├── README.md                  # 本文件 (1-page 入口)
├── PROJECT_SPEC.md            # 完整項目規格書
├── ARCHITECTURE.md            # 系統架構圖 (新增 2026-08)
├── API.md                     # API 端點 inventory (新增 2026-08)
│
├── backend/                   # FastAPI 後端
│   ├── main.py                # 入口 (port 18792)
│   ├── config.py
│   ├── api/                   # HTTP routes (11 modules)
│   ├── services/              # 業務邏輯 (7 modules: AS02 analyzer, encryption, event_bus, futu_financials, kline_cache, web_search)
│   ├── llm/                   # LLM Provider 抽象層 (base / factory / custom)
│   ├── models/                # SQLAlchemy models (8 tables)
│   ├── futu_conn/             # 富途行情 (handler / subscription)
│   ├── ws/                    # WebSocket (manager / broadcaster)
│   └── tests/
│
├── web/                       # React + Vite 前端
│   └── src/
│       ├── pages/             # 13 頁 (Home, Watchlist, Strategy, AlgorithmStrategy, Library, Settings, Calendar, Login, etc.)
│       ├── components/        # 11 類組件 (algorithm / chart / group / strategy / library / ...)
│       ├── hooks/             # Custom React hooks
│       ├── context/           # React Context (Auth / Stock / WebSocket / Theme)
│       ├── services/          # API service layer
│       └── types/
│
├── miniapp/                   # Telegram Bot (OpenD 整合)
│   ├── backend/main.py
│   ├── bot_command.py
│   └── frontend/              # 小程序前端
│
├── docs/                      # 深度規格 / 學習筆記
│   ├── ALGORITHM_SPECS.md     # Algorithm master index (AS-XX)
│   ├── STRATEGY_CONCEPTS.md   # Strategy concepts (EW 等)
│   ├── FUTU_API_LEARN.md      # Futu API 學習筆記
│   ├── LIGHTWEIGHT_CHARTS_LEARN.md
│   └── CHART_PLAN.md
│
├── data/                      # 數據 (transcripts / etc.)
├── requirements.txt
└── PROJECT_SPEC.md
```

---

## 🔧 服務端口

| 服務 | Port | 說明 |
|------|------|------|
| Backend (FastAPI) | 18792 | 後端 + WebSocket `/ws/quote` |
| Frontend (Vite) | 3000 | 前端 dev server |
| 富途 OpenD | 11111 | 行情數據源 |
| Miniapp Backend | 18793 | Telegram bot API |

Backend 監聽 `0.0.0.0`，可從手機 / 其他機器訪問。

> 📘 想知點解咁設定 / LAN 訪問詳情 → 睇下面「🌐 其他電腦訪問 StockPulse」section
> 📘 Port 完整 source-of-truth → `~/.openclaw/workspace-main/PORTS.md`

---

## 🔄 Background Services (LaunchAgents) ⭐ 新

> 大少 2026-08-03 永久 fix — Backend / Vite / Miniapp / Logrotate 由 macOS LaunchAgent 自動管理。
> 修咗兩個 deadlock：(1) Vite reboot 後永遠 dead、(2) log 長期塞爆 disk (96% full)。

| Service | Label | Schedule | 用途 |
|---------|-------|----------|------|
| **Backend** | `com.stockpulse.trigger` | RunAtLoad + KeepAlive | uvicorn main:app port 18792 |
| **Vite dev** | `com.user.stockpulse-vite` | RunAtLoad + KeepAlive | npm run dev port 3000 |
| **Miniapp** | `com.user.stockpulse-miniapp` | RunAtLoad | Telegram bot port 18793 |
| **Logrotate** | `com.user.stockpulse-logrotate` | StartInterval=1800s (30min) | log files > 500MB 即 truncate |

**Scripts：** `~/stockpulse/scripts/`
- `start_vite.sh` — Vite launcher (absolute npm/node path，殺舊 → 釋 port → 起新)
- `rotate_logs.sh` — safe rotation (tail 1000 行 + truncate，**唔 disk-double**)

**Plist：** `~/Library/LaunchAgents/com.user.stockpulse-*.plist`

**常用 commands：**
```bash
# Check status
launchctl list | grep stockpulse

# Reload (after edit plist)
launchctl unload ~/Library/LaunchAgents/com.user.stockpulse-vite.plist
launchctl load ~/Library/LaunchAgents/com.user.stockpulse-vite.plist

# View logs
tail -f ~/stockpulse/logs/vite.log
tail -f ~/stockpulse/logs/launchd.log
```

**⚠️ LaunchAgent 唔繼承 `~/.zshrc` PATH**，所以 `start_vite.sh` 用 absolute path (`/opt/homebrew/bin/npm`) + `export PATH` 確保 child process 都搵到 node。

---

## 🌐 其他電腦訪問 StockPulse

> 想喺屋企用 iPad / 第二部 Mac / Windows PC 訪問 StockPulse？跟住以下步驟。

### Step 1 — 確認兩個設備同一個 LAN

兩個設備要**駁緊同一個 WiFi router**（同一個 subnet，例如都係 `192.168.1.x`）。

- ✅ 同屋企 WiFi → OK
- ❌ 一個係屋企 WiFi，另一個用 4G → 唔得（唔同 subnet）
- ❌ 一個係公司 WiFi，另一個係屋企 → 唔得

### Step 2 — 攞 MacBook 嘅 LAN IP

喺 MacBook 開 Terminal，跑：

```bash
ipconfig getifaddr en0
```

結果會係類似：

```
192.168.1.64
```

呢個就係你 MacBook 嘅 LAN IP。記住佢（例如 `192.168.1.64`）。

> 💡 想確認網絡通唔通？可以由其他電腦 `ping 192.168.1.64`。

### Step 3 — 喺其他電腦開瀏覽器

喺 iPad / 第二部電腦嘅瀏覽器網址列輸入：

```
http://192.168.1.64:3000/
```

（將 `192.168.1.64` 換成你 Step 2 攞到嘅 IP）

撳 Enter → 應該見到 StockPulse 主頁 ✅

### Step 4 — 訪問唔到？Check macOS Firewall

如果其他電腦開唔到個 URL（瀏覽器轉緊圈圈 / timeout），通常係 macOS Firewall 擋咗：

1. **系統設定** → **網絡** → **Firewall**
2. 撳 **Firewall Options...**
3. 加入以下 apps 為 **Allow incoming connections**：
   - `Python`（StockPulse backend 喺度）
   - `node`（Vite frontend dev server 喺度）
4. 或者**暫時 disable Firewall**（只係 development 環境先咁做，唔好 production disable）

加完之後重新試 Step 3。

### Step 5 — Backend 自動顯示 LAN URL

StockPulse backend 有個 `/api/network/info` endpoint，會自動偵測 LAN IP 然後顯示畀你參考：

- 主頁右上有個 **LanAccessPanel** panel，自動 fetch `/api/network/info` 並顯示 LAN URL
- 或者手動 query：`curl http://localhost:18792/api/network/info`
- Response 例：

  ```json
  {
    "backend_port": 18792,
    "mac_lan_ip": "192.168.1.64",
    "frontend_port": 3000,
    "frontend_url_local": "http://localhost:3000/",
    "frontend_url_lan": "http://192.168.1.64:3000/",
    "other_devices_can_reach": true,
    "miniapps": {
      "miniapp_backend_port": 18793,
      "miniapp_local_only": true
    }
  }
  ```

  直接 copy `frontend_url_lan` 落其他電腦嘅瀏覽器就得。

### 🛟 常見問題

| 問題 | 解法 |
|------|------|
| 其他電腦 timeout / 連唔到 | Step 4 — Check macOS Firewall |
| `ipconfig getifaddr en0` 冇 output | 用 WiFi 嘅話 interface 可能唔叫 `en0`。試 `ifconfig \| grep "inet "` 睇全部 IP |
| 攞到嘅 IP 係 `192.168.x.x` 但其他電腦唔通 | 兩個設備唔同 subnet，例如一個係 guest WiFi |
| 用 VPN 時 | VPN 會將所有 traffic 過 VPN，break LAN access。暫時 disconnect VPN |
| LAN IP 會變嗎？ | DHCP lease 一般幾日～幾星期。如果斷 WiFi / 重啟 router 可能會變，要重新跑 Step 2 |

### 🔒 邊啲 port 公開邊啲唔公開？

| Port | 服務 | 公開？ |
|------|------|--------|
| **3000** | Frontend (Vite) | ✅ 公開（你其他電腦要訪問嘅就係呢個）|
| **18792** | Backend (FastAPI) | ✅ 公開（同 LAN 訪問）|
| **18793** | Miniapp Backend | ❌ 鎖本地（只 MacBook 自己用，安全考量）|

詳見 `~/.openclaw/workspace-main/PORTS.md` 嘅 PUBLIC / LOOPBACK 分類。

---

## 🔌 技術棧

| 層面 | 技術 |
|------|------|
| **Frontend** | React 18 + Vite 5 + Ant Design 5 + TypeScript |
| **Backend** | Python 3.10+ + FastAPI + SQLAlchemy |
| **Database** | SQLite (production-grade schema 8 tables) |
| **Real-time data** | WebSocket + FutuOpenD (富途 API) |
| **K 線圖** | TradingView Lightweight Charts |
| **LLM 抽象層** | `backend/llm/` (provider-agnostic, factory pattern) |
| **Algorithms** | AS-XX series (見 `docs/ALGORITHM_SPECS.md`) |
| **Miniapp** | Telegram Bot + 小程序 |
| **外部依賴** | MiniMax / Kimi / Gemini 等多 LLM provider |

---

## 📖 文檔地圖 (Documentation Map)

新 AI 接手請按以下順序讀：

| 順序 | 文檔 | 用途 |
|------|------|------|
| 1 | 本文件 (README.md) | 入口 + Quick start |
| 2 | `PROJECT_SPEC.md` | 完整設計規格書 (設計原則 / 結構 / UI / Schema) |
| 3 | `ARCHITECTURE.md` | 系統架構 (3-tier + data flow) ⭐ 新 |
| 4 | `API.md` | 全部 HTTP endpoint inventory ⭐ 新 |
| 5 | `docs/ALGORITHM_SPECS.md` | Algorithm 規格 master index (AS-XX) |
| 6 | `docs/STRATEGY_CONCEPTS.md` | 策略概念 (Elliott Wave 等) |
| 7 | `docs/FUTU_API_LEARN.md` | Futu API 細節 |

---

## 🆕 主要功能模塊 (2026-08 狀態)

### 🧠 Algorithm System (AS-XX)
- **入口：** `/algorithms` 頁
- **核心算法：**
  - **AS02** (公司質素分析) — `backend/services/as02_analyzer.py`
  - **AS03** (股票週期判定) — `algorithms/AS-03-cycle-detection/` — **Stage 1 收官 done (2026-08-08 16:55) + Sprint 3 收官 done (2026-08-08 23:55) + M9 Pilot 收官 done (2026-08-09 10:02) + Sprint 2 收官 done (2026-08-09 13:15)**: 6 個 modules production + M7 Synthesizer (v1.0.0) + M8 Decision Engine (**v2.0.0**, 8 個 finalAction + 揸車比喻 + Trading card adaptive + 短期走勢 9 scenarios + 人話詳細解讀 LLM hook + 5 個 adaptive params auto-calibrate + L2 JSON cache + 4 個 SVG chart + 10 隻 demo 股票 tests) + **M9 Back Test (v0.6.0, 9.1-9.7 全部 done)**: Replay engine + Coarse/Fine grid search + Walk-Forward 3 folds CV + Per-symbol optimal cache (30 日 expiry) + Forward return 永久記錄 (半衰期 180 日) + 4 個 endpoints + Testing page entry 09 + **10 隻 (5 港 + 5 美) pilot 收官** (1w 統一 config, 399 forward return records 永久累積) + **Top 3 真正可落實倉位** (大少 11:57 永久 rule stability ≥ 70%): US.AAPL 103.6/82%, US.MSFT 88.8/78%, US.GOOGL 82.0/76% + **M9 → M8 Apply flow** (大少 09:54 Option B): Node script 拎 1w bestParams POST 落 M8 cache (5 個 fields), testing page 切 08 — AS-03-DEC verify M8 用咗 ssiWeights 40/30/30 + rsiWeight 0.10 + **kellyFraction=octo (Bug 2 fix 12:50 確認 work)** (大少 11:57 永久 rule). 9 個 algorithms 全部 Active (1-8 + 9 + zmen均算法 獨立). 776 assertions pass (730 node + 46 python).
- **AS03 模組 (2026-08-08 Stage 1 收官狀態):**

  > 大少 2026-08-08 10:06 指示: 6 個 modules 加編號 01-06 喺 dropdown displayName, M7 用編號 07, M8 用編號 08, zmen均算法 唔加 (獨立算法)。
  > 大少 2026-08-08 11:22 指示: M7 Synthesizer + M8 Decision Engine 一齊優化 (設計上一起考慮)。
  > 大少 2026-08-08 13:30 指示: Plan A 拆返 M7 + M8 兩個獨立 module (testing page 2 個 entries, 2 份 spec doc, 2 個 codebase files, implementation 分開做).

  | 編號 | Module | 算法 | 用途 | Version |
  |------|--------|------|------|---------|
  | 01 | AS-03-MA | 均線系統週期判斷法 v2.0 | MA 排列 + 成交量加權 + 斜率動能, 信心 = base × volume × slope | **v2.0.0** |
  | 02 | AS-03-HL | 高低點結構法 | Peaks/Troughs + 形態預警 | v0.1.0 |
  | 03 | AS-03-TL | 趨勢線法 | 支撐/壓力線 + 突破檢測 | v0.1.0 |
  | 04 | AS-03-IND | 動能背馳與衰竭 | RSI/MACD/背馳/衰竭檢測 | v1.0.0 |
  | 05 | AS-03-VP | 成交量價格行為確認 | 突破/縮量/OBV/量价背馳 (15 rules) | v2.0.0 |
  | 06 | AS-03-VOL | 波動率收縮擴張 | Squeeze + VCP + ATR 分解 (12 rules) | v1.0.0 |
  | 07 | **AS-03-SYN** | **終極綜合判定** (Synthesizer — M7) | 6 個 modules 綜合判定 (SSI 戰略強度指數 + TCM 戰術交叉驗證 + Alignment + 8 個 Grade + Kelly 倉位) | **v1.0.0 (Sprint 1 done)** |
  | 08 | **AS-03-DEC** | **終極綜合判斷引擎** (Decision Engine — M8) | **Sprint 2 收官 (2026-08-09 13:15)**: 8 個 finalAction (BUY/ADD/HOLD/REDUCE/SELL/WAIT/TRAP/TRANSITION) + 揸車比喻 + Trading card adaptive (3 vol buckets) + 短期走勢 9 scenarios (3×3) + 人話詳細解讀 (LLM hook, hardcoded template) + 5 個 adaptive params auto-calibrate (純 math) + L2 JSON file cache (7 日 expiry) + 4 個 SVG chart + 「🔄 重新校準」按鈕 + **Bug 1 fix (testing page race condition) + Bug 2 fix (M8 kelly override 落 Synthesizer) + Bug 3+4 fix (version 1.0.0 → 2.0.0)** | **v2.0.0 (Sprint 2 收官, 9 commits + 4 fix commits)** |
  | **09** | **AS-03-BT** | **回測驗證 (Back Test — M9, 時光機驗證官)** | **Sprint 3 done (2026-08-08 22:28, 6 commits 9.1-9.6 + 9.7 UI 升級)**: Replay engine (用歷史 K 線重播之前嘅判決, 對比 5/10/20 日後真實升跌) + Coarse grid (9 candidates) + Fine tune (±20% top 5 = 30 candidates) + Adaptive window 6→9→12→15→18 個月 + Walk-Forward CV 3 段 rolling (大少 22:28 揀 B) + Per-symbol optimal cache (30 日 expiry) + Forward return 永久記錄 (半衰期 180 日 weighted) + 4 個 endpoints (`GET/POST /back-test`, `GET/POST /forward-return`) + Testing page entry 09 + HK.00700 pilot (3/3 folds, 24ms) + M9 UI 升級: 3 SVG (Kelly pie + Walk-Forward bar + Forward return scatter) + 6 色標 + 永遠 full show 過往判決 + 大少話你知 box (4 scenario LLM hook) + 2 個 button (重新校準 + 立即套用 M8) | **v0.6.0 (Sprint 3 done, 7 commits)** |
  | **獨立** | **zmen均算法** (唔加編號) | 舊 M1 改名 + 抽離 7 個 modules | MA5/10/60 排列 + 10 條 rule 判 UP/DOWN/SIDEWAYS | v0.3.0 |
  | ⏸️ Deferred Multi-TF | 多時間框架 | (大少 2026-08-09 14:16 揀 A drop, Stage 2+ 重新 plan) | v1.0.0 |
  | ⏸️ Deferred SlopeMomentum | 斜率動能 | (大少 2026-08-09 14:16 揀 A drop, Stage 2+ 重新 plan) | v1.0.0 |

  **3-Section Rule (永久, 大少 #11056)**: 每個 module 嘅結果必須有 📖 詳細解讀 + 🎯 策略建議 + 💡 點用點睇 (plain language)。
- **AS02 Pipeline：** 股票清單 → 財務數據 → LLM 分析 → 結果顯示（auto DQ log）
- **AS03 Testing Page：** `http://localhost:8765/testing-page/` (vanilla JS, CDN lightweight-charts v4.2.3, 唔 embed StockPulse)
- **儲存：** User 手動點前端「💾 儲存 N 隻合格股票」button → SaveRunModal → POST `/api/saved-runs`（大少 #9700 永久 rule：runtime endpoint 唔可以 auto-save）
- **結果庫：** `/library` 頁 (`/api/saved-runs`)

### ⚙️ Settings Page
- **入口：** `/settings`
- **功能：** LLM provider 切換 / API key 管理 / OpenD 設定
- **API：** `/api/llm-settings/*` (6 endpoints) + `/api/settings/*`

### 🤖 LLM Provider Abstraction Layer
- **位置：** `backend/llm/`
- **支援：** MiniMax / Kimi / Gemini / custom OpenAI-compatible
- **API：** `AbstractProvider` interface (`base.py`)
- **Factory：** `factory.py` 按 `provider_id` 選擇 adapter
- **Custom：** `custom.py` for OpenAI-compatible endpoints

### 📚 Library / Saved Runs
- **入口：** `/library`
- **功能：** Algorithm 結果儲存 + 重新排序 + pin + view reason
- **API：** `/api/saved-runs/*` (9 endpoints)

### 📊 Strategy System
- **入口：** `/strategy`
- **支援：** AI mode (自然語言) + Code mode (JSON)
- **功能：** AND/OR 組合 / 歷史結果 / 日曆檢視

### 🪙 Miniapp (Telegram Bot)
- **位置：** `miniapp/`
- **功能：** Telegram 內即時報價 + 策略觸發 + 簡易查詢
- **Backend：** `miniapp/backend/main.py`

---

## 📅 近期重要更新 (2026-05 → 2026-08)

| 日期 | 變更 |
|------|------|
| 2026-05 | 數據庫 schema 落地 (8 tables) + 後端 API 全 implement |
| 2026-06 | LLM Provider Abstraction Layer + Settings Page |
| 2026-07 | AS02 algorithm 上線 + Library/Saved Runs page + StrategyPage 大改版 |
| 2026-07 | miniapp 整合 (Telegram bot) |
| 2026-08 | Fallback chain + retry policy (LLM 穩定性) |
| 2026-08 | README + PROJECT_SPEC + ARCHITECTURE + API 文檔重整 (本文件) |
| 2026-08 | AS-02 移除 auto-save: 改為 user 手動點「💾 儲存」(大少 #9700) |
| 2026-08-09 | **M9 Pilot 收官** — 10 隻 (5 港 + 5 美) 用 1w 統一 config, 399 forward return records 永久累積, Top 3 (US.AAPL/MSFT/GOOGL) apply 落 M8 落實倉位 | 大少 09:34 / 09:54 / 10:57 |
| 2026-08-09 | **Backend 1w period fix** — `backend/api/kline.py` PERIOD_MAP 加 `KLType.K_WEEK`, M9 拎 5-10 年 weekly history, 補返 7 隻 stocks data 唔夠問題 | 大少 09:29 揀 B |
| 2026-08-09 | **Sprint 2 收官 (2.9 spec doc final done)** — AS-03-DEC v2.0.0 (1.0.0 → 1.8.0 → 2.0.0) + 4 個 followup bugs 全部 fix: **Bug 1** (testing page race condition, `da32c4db`) + **Bug 2** (M8 kelly override 落 Synthesizer, `639e6d70`) + **Bug 3+4** (version 顯示 1.0.0 → 2.0.0 + testing page .mjs cache bust sync 永久 rule, `d61d96d6`) + 2 個 testing page 永久 rule 加咗落 memory (HTML cache bust sync + .mjs cache bust) | 大少 12:00 / 12:30 / 13:00 / 13:15 |
| **2026-08-03** | **LaunchAgent 永久 fix: Vite + logrotate auto-manage (Vite reboot deadlock + log disk 96% full)** |

---

## 🔄 日常開發

### 啟動服務
```bash
# 終端 1 — 後端
cd stockpulse/backend
~/.futu_venv/bin/python3 main.py

# 終端 2 — 前端
cd stockpulse/web
npm run dev
```

### 跑後端測試
```bash
cd stockpulse
~/.futu_venv/bin/python3 -m pytest backend/tests/ -v
```

### Git 操作
```bash
git add .
git commit -m "描述"
git push origin main
```

### Algorithm Specs Sync
```bash
# Sync algorithm specs (cron-driven, also manually)
~/.openclaw/scripts/sync_algorithm_specs.sh
```

---

## 🆘 疑難排解

### Q: 前端無法連接後端
A: 檢查後端是否運行：`lsof -i :18792`

### Q: Vite dev server 冇起 / frontend 報「載入板塊列表失敗」
A: LaunchAgent 應該 auto-start，但若手動 kill 後冇 restart：
1. Check status：`launchctl list | grep stockpulse-vite`
2. 若 `-` (not running)：`launchctl load ~/Library/LaunchAgents/com.user.stockpulse-vite.plist`
3. 若 running 但 port 3000 唔通：check `~/stockpulse/logs/vite.log`

### Q: Disk full (log 塞爆)
A: LaunchAgent `com.user.stockpulse-logrotate` 每 30 min 自動 truncate `*.log > 500MB`
即刻手動清：`bash ~/stockpulse/scripts/rotate_logs.sh`

### Q: 富途數據獲取失敗
A: 確保富途 OpenD 正在運行，Port `11111` (`lsof -i :11111`)

### Q: npm install 失敗
A: 刪除 `node_modules` + `package-lock.json`，重新 `npm install`

### Q: Python 模組找不到
A: 用對 venv 的 Python：`~/.futu_venv/bin/python3`

### Q: LLM call 失敗 (network error)
A: 見 `backend/llm/` — fallback chain 已 setup (`minimax/MiniMax-M3-highspeed → MiniMax-M3 → MiniMax-M2.7`)，3 retry × 2s backoff

---

## 📝 AI 開工指引 (接手必讀)

當你被打開並被要求繼續 StockPulse 項目時：

1. **先讀 `README.md`** (本文件) — 入口 + Quick start
2. **跟住讀 `ARCHITECTURE.md`** — 理解 3-tier 架構 + data flow
3. **再讀 `PROJECT_SPEC.md`** — 完整設計規格 + 設計原則
4. **查 `API.md`** — 知道 endpoint 點用
5. **睇 `docs/ALGORITHM_SPECS.md`** — Algorithm 規格 (AS-XX series)
6. **睇 `~/.openclaw/workspace-main/STOCKPULSE_REFERENCE.md`** — 進階教訓 + 重要 rules
7. **確認方向** — 問大少想做什么
8. **動前確認** — 任何改動前先解釋，確認後才做
9. **測試** — 每做一步都要測試，完全成功後才下一個
10. **記錄** — 重要決定和發現要記錄到 `~/.openclaw/workspace-main/memory/`

---

_最後更新：2026-08-03 (大少 / AI assistant sync — LaunchAgent 永久 fix)_
---

## 📊 算法 (Algorithms)

| 算法 | 狀態 | 描述 |
|------|------|------|
| **AS-01** | ✅ Active | 板塊龍頭股 Top N ranking (2-factor: 市值 + 換手率) |
| **AS-03** | ✅ Module 1 done (2026-08-04 #10332) | 股票周期性判定 (umbrella: MA v0.3.0 + 量價 v1.0.0 + 斜率 v1.0.0): 均線 crossover + 量能守則 + 趨勢反轉偵測 |

詳見 `docs/ALGORITHM_SPECS.md` 同 `~/stockpulse/algorithms/AS-03-cycle-detection/`。

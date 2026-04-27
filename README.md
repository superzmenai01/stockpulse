# StockPulse 📈

> 股價分析 WebApp - 實時報價、組別管理、策略篩選、日曆

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
# 創建虛擬環境
python3 -m venv ~/.futu_venv

# 安裝富途 API
~/.futu_venv/bin/pip install futu-api
```

**Node.js（前端）：**
```bash
cd web
npm install
```

### 3. 啟動富途 OpenD
確保富途牛牛已安裝並運行，Port: `11111`

### 4. 啟動服務

**終端 1 - 後端：**
```bash
cd stockpulse/backend
~/.futu_venv/bin/python3 main.py
```

**終端 2 - 前端：**
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
├── README.md              # 本文件
├── PROJECT_SPEC.md        # 完整項目規格（詳細設計）
├── backend/               # 後端（Python FastAPI）
│   ├── main.py           # 入口
│   ├── config.py         # 配置
│   ├── futu_conn/        # 富途連接
│   ├── ws/               # WebSocket
│   └── services/         # 公共服務
│
└── web/                  # 前端（React + Vite）
    ├── src/
    │   ├── components/  # 組件
    │   ├── pages/        # 頁面
    │   ├── hooks/        # Hooks
    │   ├── context/      # Context
    │   └── services/     # API 服務
    └── package.json
```

---

## 🔧 服務端口

| 服務 | Port | 說明 |
|------|------|------|
| Backend (backend) | 18792 | FastAPI 後端 |
| Frontend (web) | 3000 | Vite 開發服務器 |
| 富途 OpenD | 11111 | 行情數據源 |

**注意：** Backend 監聽 `0.0.0.0`，可從手機訪問

---

## 🔌 技術棧

| 層面 | 技術 |
|------|------|
| 前端框架 | React + Vite + Ant Design |
| 後端框架 | Python FastAPI |
| 實時數據 | WebSocket + FutuOpenD |
| 數據庫 | SQLite（待實現） |
| K線圖 | TradingView Lightweight Charts（待實現） |

---

## 📖 詳細規格

**完整設計文檔：** 見 `PROJECT_SPEC.md`

包含：
- UI/UX 設計
- 數據庫 Schema
- 組件架構
- 開發路線圖

---

## 🔄 日常開發

### 啟動服務
```bash
# 終端 1 - 後端
cd stockpulse/backend
~/.futu_venv/bin/python3 main.py

# 終端 2 - 前端
cd stockpulse/web
npm run dev
```

### 測試 WebSocket
```bash
cd stockpulse
~/.futu_venv/bin/python3 test_ws_debug.py
```

### 運行後端測試
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

---

## 🆘 疑難排解

### Q: 前端無法連接後端
A: 檢查後端是否運行：`lsof -i :18792`

### Q: 富途數據獲取失敗
A: 確保富途 OpenD 正在運行，Port 11111

### Q: npm install 失敗
A: 刪除 node_modules 和 package-lock.json，重新 npm install

### Q: Python 模組找不到
A: 確保使用正確的 Python：`~/.futu_venv/bin/python3`

---

## 📝 AI 開工指引

當你被打開並被要求繼續 StockPulse 項目時：

1. **首先閱讀** `README.md` 和 `PROJECT_SPEC.md`
2. **了解當前狀態**：查看 `memory/stockpulse/` 目錄
3. **確認方向**：問大少想做什么
4. **动前確認**：任何改動前先解釋，確認後才做
5. **測試**：每做一步都要測試，完全成功後才下一個
6. **記錄**：重要決定和發現要記錄到 memory

---

_最後更新：2026-04-27_

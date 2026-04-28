# StockPulse 圖表功能建設計劃

> 最後更新：2026-04-28
> 用途：萬一電腦問題，只要睇呢份文件就可以完全接手繼續做

---

## 📋 項目背景

- **項目名：** StockPulse
- **用戶：** zmen（大少）
- **用途：** 股票報價監控系統（港股/美股）
- **技術棧：** Python FastAPI + React + Vite + Ant Design
- **即時數據：** 富途 FutuOpenD

---

## 🎯 目標功能

### 股票詳情頁面（K線圖 + 指標）

用戶點擊股票 → 顯示詳情，內容包括：
- K線圖（多種周期：1m/5m/15m/1h/1d/1w）
- 即時報價（每秒更新）
- 技術指標

### 兩種顯示模式

| 模式 | 觸發 | 用途 |
|------|------|------|
| StockDetailModal | 點擊股票 | 快睇，即時睇 |
| StockDetailPage | Modal 內按鈕 | 新Tab，詳細比較 |

### 圖表週期

```
1m（1分鐘）| 5m（5分鐘）| 15m（15分鐘）| 1h（1小時）| 1d（日線）| 1w（週線）
```

---

## 📊 需要實現的指標

| 指標 | 英文 | 可調整參數 | 預設顯示 |
|------|------|-----------|----------|
| K線圖 | Candlestick | 週期 | ✅ |
| 成交量 | Volume | 顯示/隱藏 | ✅ |
| 移動平均線 | MA | 週期：5, 10, 20, 60 | ✅ |
| 指數移動平均 | EMA | 週期：12, 26 | ❌ |
| MACD | MACD | 快:12 慢:26 信號:9 | ❌ |
| 相對強度指數 | RSI | 週期：14 | ❌ |
| 布林帶 | BOLL | 週期:20 倍數:2 | ❌ |
| 折線指標 | ZigZag | Threshold: 5% | ❌ |
| 波浪理論 | Elliott Wave | 自動標示 | ❌ |

---

## 🔧 K線圖更新邏輯

### 週期邊界（刷新整個圖表）

```
每到週期邊界（1m/5m/15m/1h/1d/1w）→ 
    從富途拉取完整歷史K線 → 重建圖表 → 所有指標重新計算
```

### 實時報價（更新最後蠟燭）

```
每筆成交觸發 WS 報價 → 
    只更新最後蠟燭的：close/high/low/volume
    不影響其他已定型的蠟燭
```

### 週期刷新時間

| 周期 | 刷新時機 |
|------|----------|
| 1m | 每分鐘 00 秒 |
| 5m | 每 5 分鐘（00, 05, 10, 15...） |
| 15m | 每 15 分鐘（00, 15, 30, 45） |
| 1h | 每小時 00 分 |
| 1d | 每日 00:00 |
| 1w | 每周一 00:00 |

---

## 🏗️ 技術架構

### 前端結構

```
web/src/
├── components/
│   ├── chart/
│   │   ├── ChartContainer.tsx      # 主圖表容器（Lightweight Charts）
│   │   ├── ChartToolbar.tsx        # 工具列：週期選擇、指標開關
│   │   ├── IndicatorPanel.tsx     # 指標參數調整面板
│   │   └── CandlestickChart.tsx    # K線圖核心組件
│   ├── stock/
│   │   ├── StockDetailModal.tsx    # 股票詳情彈窗
│   │   └── StockDetailPage.tsx      # 股票詳情頁面（新Tab）
│   └── layout/
│       └── Header.tsx              # Header（已有 Theme Toggle）
├── hooks/
│   ├── useChartData.ts             # K線數據管理
│   ├── useRealtimeCandle.ts        # 實時蠟燭更新
│   └── useIndicators.ts            # 指標計算
├── services/
│   ├── stockDetailApi.ts           # 股票詳情 API
│   └── indicatorCalculations.ts    # 指標計算公式
└── types/
    └── chart.ts                   # 圖表相關 TypeScript 類型
```

### 後端結構

```
backend/
├── api/
│   ├── kline.py                   # K線 API endpoint
│   └── stocks.py                  # 股票搜索 API
├── services/
│   └── kline_service.py           # 富途 K線數據拉取
└── futu_conn/
    └── (現有架構不變)
```

### API 設計

```
GET /api/stocks/:code/kline
Query: { period: '1m' | '5m' | '15m' | '1h' | '1d' | '1w', count: number }

Response: {
  code: string,
  name: string,
  period: string,
  klines: [
    { time: string, open: number, high: number, low: number, close: number, volume: number }
  ]
}
```

---

## 📦 需要安裝的 Package

### 前端
```bash
npm install lightweight-charts   # TradingView K線圖
npm install indicators           # 技術指標計算（可選，或自己寫）
```

### 後端
```bash
# 富途 API 已有，不需要額外安裝
```

---

## 🎨 UI 設計參考（富途牛牛 Dark Mode）

### 暗色主題顏色

| 用途 | 顏色 |
|------|------|
| 背景 | `#0D1114` |
| 容器 | `#191C1F` |
| 主要文字 | `#D1D1D1` |
| 次要文字 | `#8A8A8A` |
| 漲（綠） | `#26BA75` |
| 跌（紅） | `#EE5151` |
| 品牌色 | `#F9A11B` |

---

## 🚀 實作順序

### Phase 1 — 基礎建設
1. [ ] 安裝 lightweight-charts
2. [ ] 研究富途 K線 Historical API
3. [ ] 實現 `GET /api/stocks/:code/kline`
4. [ ] 基本 ChartContainer 組件

### Phase 2 — K線顯示
5. [ ] CandlestickChart 基本顯示
6. [ ] 週期切換（1m/5m/15m/1h/1d/1w）
7. [ ] 富途 API 串接

### Phase 3 — 實時更新
8. [ ] 週期邊界刷新邏輯
9. [ ] WS 即時報價整合
10. [ ] 最後蠟燭實時更新

### Phase 4 — 指標系統
11. [ ] MA / EMA
12. [ ] MACD
13. [ ] RSI
14. [ ] BOLL
15. [ ] ZigZag
16. [ ] Elliott Wave

### Phase 5 — UI/UX
17. [ ] StockDetailModal
18. [ ] StockDetailPage（新Tab）
19. [ ] Toolbar 指標面板
20. [ ] 參數調整 UI

---

## ⚠️ 重要規則

### Memory 更新規則
1. 每做完一樣野要即時更新進度
2. PUSH 前一定要更新 memory
3. 重要決定要即時記錄

### 代碼原則
1. 先查富途內建方法（`dir()` / `help()`），冇先自己寫
2. Library 內建方法優先
3. 多模組架構，功能獨立

---

## 📁 重要檔案路徑

### 本地
- 項目：`/Users/zmenai/stockpulse/`
- Frontend：`/Users/zmenai/stockpulse/web/`
- Backend：`/Users/zmenai/stockpulse/backend/`
- Memory：`/Users/zmenai/.openclaw/workspace-reasoning/memory/2026-04-28.md`

### GitHub
- Repo：`https://github.com/superzmenai01/stockpulse`
- Main branch：`main`
- Current branch：`feature/chart-detail`

### 服務 Port
| 服務 | Port |
|------|------|
| Backend | 18792 |
| Frontend | 3000 |
| FutuOpenD | 11111 |

---

## 📝 待解決問題

1. **富途 K線 Historical API** — 需要 `dir()`/help 確認 method 名稱
2. **指標計算** — 可用現成 library 或自己寫
3. **ZigZag 實現** — 需要確認演算法

---

## 📅 實作日誌

| 日期 | 完成內容 |
|------|----------|
| 2026-04-28 | 完成圖表功能規劃 |

---

_最後更新：2026-04-28 13:28_
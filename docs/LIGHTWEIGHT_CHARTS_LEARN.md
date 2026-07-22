# Lightweight Charts 學習記錄

> 學習日期：2026-05-15
> 官網：https://tradingview.github.io/lightweight-charts/
> 版本：v5.2

---

## 📌 基礎用法

### 安裝
```bash
npm install lightweight-charts
```

### 基本範例
```typescript
import { createChart, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts'

const chart = createChart(container, options)

// K線
const candlestickSeries = chart.addSeries(CandlestickSeries, {
  upColor: '#26a69a',
  downColor: '#ef5350',
  borderVisible: false,
  wickUpColor: '#26a69a',
  wickDownColor: '#ef5350',
})

// 成交量
const histogramSeries = chart.addSeries(HistogramSeries, {
  color: '#26a69a',
  priceFormat: { type: 'volume' },
  priceScaleId: '', // 綁定到單獨的 scale
})

// 指標線
const lineSeries = chart.addSeries(LineSeries, {
  color: '#FFD700',
  lineWidth: 2,
})

// 設置數據
candlestickSeries.setData(data)
histogramSeries.setData(volumeData)

// 自動調整視圖
chart.timeScale().fitContent()
```

---

## 📊 Series 類型

| Series | 用途 | 數據格式 |
|--------|------|----------|
| `CandlestickSeries` | K線圖 | `CandlestickData` (open/high/low/close) |
| `BarSeries` | 美式柱狀圖 | `BarData` (open/high/low/close) |
| `LineSeries` | 線圖 | `LineData` / `SingleValueData` |
| `AreaSeries` | 面積圖 | `SingleValueData` |
| `HistogramSeries` | 柱狀圖/成交量 | `HistogramData` (帶顏色) |
| `BaselineSeries` | 基線圖 | `SingleValueData` |
| `CustomSeries` | 自定義系列 | 自行定義 |

### 數據格式

```typescript
// K線數據
interface CandlestickData {
  time: Time  // Time = UTCTimestamp | BusinessDay | string
  open: number
  high: number
  low: number
  close: number
}

// 成交量數據
interface HistogramData {
  time: Time
  value: number
  color?: string  // 可每根自定義顏色
}

// 線圖數據
interface LineData {
  time: Time
  value: number
}
```

---

## 🔧 Chart API (IChartApi)

### 核心方法

```typescript
// 創建圖表
const chart = createChart(container, options)

// 添加 Series
const series = chart.addSeries(CandlestickSeries, options)

// 時間軸
chart.timeScale().fitContent()
chart.timeScale().setVisibleRange({ from, to })
chart.timeScale().getVisibleRange()

// 價格軸
chart.priceScale('right').applyOptions({ ... })

// 調整大小
chart.resize(width, height)

// 刪除圖表
chart.remove()
```

### 監聽事件

```typescript
// 監聽時間軸範圍變化
chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
  console.log('Visible range:', range)
})

// 監聽點擊
chart.subscribeClick((param) => {
  console.log('Click:', param)
})

// 監聽跨縣移動
chart.subscribeCrosshairMove((param) => {
  console.log('Crosshair:', param)
})
```

---

## 📏 Time Scale (時間軸)

### 重要方法

```typescript
const timeScale = chart.timeScale()

// 自動調整內容
timeScale.fitContent()

// 設置可見範圍（邏輯範圍）
timeScale.setVisibleLogicalRange({ from: -5, to: 20 })

// 獲取當前可見範圍
const range = timeScale.getVisibleLogicalRange()

// 設置滾動位置
timeScale.scrollToPosition(10, false)

// 滾動到最新
timeScale.scrollToRealTime()

// 重置
timeScale.resetTimeScale()
```

### 時間格式
```typescript
type Time = UTCTimestamp | BusinessDay | string

// Unix timestamp (秒)
{ time: 1642427876 }

// Business day (日期)
{ time: { year: 2024, month: 1, day: 1 } }

// ISO string
{ time: '2024-01-01' }
```

---

## 💰 Price Scale (價格軸)

### 基礎用法

```typescript
// 默認左右兩個軸
chart.addSeries(CandlestickSeries, { ... })

// 覆蓋軸（用於成交量等獨立標度）
chart.addSeries(HistogramSeries, {
  priceScaleId: 'volume',  // 自定義 ID
})

// 設置軸選項
chart.applyOptions({
  rightPriceScale: { visible: true, borderVisible: false },
  overlayPriceScales: {
    volume: { scaleMargins: { top: 0.8, bottom: 0 } }
  }
})
```

### Overlay Scale（StockPulse 成交量用這個）
```typescript
// 成交量單獨佔底部 20%
histogramSeries.priceScale().applyOptions({
  scaleMargins: { top: 0.85, bottom: 0 }
})
```

---

## 🏷️ Series Markers（EW 標記用這個！）

### 基本用法

```typescript
import { createSeriesMarkers, MarkerShape } from 'lightweight-charts'

// 創建標記插件
const markersPlugin = createSeriesMarkers(candlestickSeries)

// 設置標記
markersPlugin.setMarkers([
  {
    time: '2024-01-01',
    position: 'aboveBar',  // 或 'belowBar'
    shape: 'text',          // MarkerShape: 'arrowUp' | 'arrowDown' | 'circle' | 'text' | ...
    color: '#FFD700',
    text: '1',
    size: 2,
  }
])
```

### Marker 屬性

| 屬性 | 類型 | 說明 |
|------|------|------|
| `time` | Time | 標記時間 |
| `position` | `aboveBar` \| `belowBar` \| `inBar` | 位置 |
| `shape` | `arrowUp` \| `arrowDown` \| `circle` \| `square` \| `text` | 形狀 |
| `color` | string | 顏色 |
| `text` | string | 文字（shape=text 時顯示） |
| `size` | number | 大小 |

### StockPulse 當前用法問題

看 `ChartContainer.tsx`，它用的是：
```typescript
const markersPlugin = createSeriesMarkers(candlestickSeries)
markersPlugin.setMarkers(ewMarkers)
```

**但有 Bug：** `ewMarkers` 全部顯示「A」
- 原因：EW 演算法只重複 12345ABC，冇真正循環

---

## 📐 ISeriesApi 關鍵方法

```typescript
const series = chart.addSeries(CandlestickSeries, options)

// 設置/更新數據
series.setData(klineData)
series.update(newBar)  // 添加或更新最新 bar

// 座標轉換
series.priceToCoordinate(price)    // 價格 → 像素座標
series.coordinateToPrice(coordinate)  // 像素座標 → 價格

// 獲取數據
series.data()                        // 所有數據
series.dataByIndex(10)              // 按索引獲取

// 價格線
const priceLine = series.createPriceLine({
  price: 150.0,
  color: '#FFD700',
  lineWidth: 1,
  lineStyle: 0,  // LineStyle
})

// 監聽數據變化
series.subscribeDataChanged(handler)
```

---

## ⚠️ 常見問題

### 1. `timeToCoordinate is not a function`
**原因：** v4/v5 API 改變了
- 舊版：`chart.timeToCoordinate(time)`
- 新版：`series.priceToCoordinate(price)`（只有價格轉換，冇時間轉換）

**解決：** 用 `chart.timeScale().getVisibleLogicalRange()` 配合計算

### 2. `getSerieses is not a function`
**原因：** v5 API
- 舊版：`chart.getSerieses()`
- 新版：`chart.getSeries()`（返回單個）或遍歷所有 series

### 3. 成交量和K線不對齊
**解決：** 確保使用同一個 `time` 值，並設置正確的 `priceScaleId`

---

## 🔗 StockPulse 當前使用情况

```typescript
// ChartContainer.tsx
import { createChart, IChartApi, ISeriesApi, CandlestickData, HistogramData, Time, 
         CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts'

// 創建圖表
const chart = createChart(container, {
  layout: { background: { type: 'solid', color: '#131722' } },
  grid: { vertLines: { color: '#1a1a2e' }, horzLines: { color: '#1a1a2e' } },
  crosshair: { mode: CrosshairMode.Normal },
  timeScale: { timeVisible: true, secondsVisible: false },
})

// 添加 K線
const candlestickSeries = chart.addSeries(CandlestickSeries, { ... })

// 添加成交量
const histogramSeries = chart.addSeries(HistogramSeries, {
  priceScaleId: 'volume',
})

// 添加 ZigZag 線
const zigzagSeries = chart.addSeries(LineSeries, { ... })

// 添加 EW 標記
const markersPlugin = createSeriesMarkers(candlestickSeries)
```

---

## 📚 文檔導航

| 頁面 | URL |
|------|-----|
| 首頁 | `/` |
| Series 基礎 | `/docs/series-types` |
| 時間軸 | `/docs/time-scale` |
| 價格軸 | `/docs/price-scale` |
| 圖表類型 | `/docs/chart-types` |
| IChartApi | `/docs/api/interfaces/IChartApi` |
| ISeriesApi | `/docs/api/interfaces/ISeriesApi` |
| ITimeScaleApi | `/docs/api/interfaces/ITimeScaleApi` |
| IPriceScaleApi | `/docs/api/interfaces/IPriceScaleApi` |
| Series Markers Plugin | `/docs/api/interfaces/ISeriesMarkersPluginApi` |
| Chart Options | `/docs/api/interfaces/TimeChartOptions` |

---

## 💡 可探索的高級功能

1. **Custom Series** — 自定義渲染器，實現任何繪圖效果
2. **Pane Support (v5.0)** — 多窗格支持，指標放不同區域
3. **Watermark** — 水印功能
4. **Baseline Series** — 適用於 MACD 等指標（高於/低於基線）
5. **Price Line** — 水平線（支持均線展示）
6. **Geometric Shapes** — 在圖表上繪製形狀（矩形、趨勢線等）

---

## ⚠️ API 變化警告（重要修正）

**我之前說 `timeToCoordinate` 被移除，這是舊版說法。實際上 v5.2 仍然有這個方法！**

查看官方文檔，v5.2 的 `ITimeScaleApi` 仍有：
- `timeToCoordinate(time)` → 時間 → X座標
- `coordinateToTime(x)` → X座標 → 時間

**所以 StockPulse 當前代碼 `chart.timeScale().timeToCoordinate(label.time)` 是合法的 v5.2 API。**

---

## ⚠️ StockPulse 實際問題分析

### 問題 1：Elliott Wave Bug（主要問題）

**現象：** EW 標記全部顯示「A」，波浪數字不正常循環

**代碼位置：**
- `ChartContainer.tsx:442` — `timeToCoordinate` 用於 EW 標記定位
- `ElliottWaveTestPage.tsx:415` — 同樣用法

**分析：**
1. `timeToCoordinate` API 本身是正確的（v5.2 支持）
2. 真正問題在 `calculateElliottWave()` 演算法
3. 演算法只是機械式重複 12345ABC，沒有真正識別波浪週期

**結論：** ⚠️ API 使用正確，問題在 EW 演算法本身

### 問題 2：Package Version

```json
"lightweight-charts": "^5.2.0"
```

StockPulse 使用 v5.2，API 都是最新的，冇衝突。

### 問題 3：ChartClickHandler 右鍵選單

`ChartContainer.tsx:435` 使用：
```typescript
const time = chart.timeScale().coordinateToTime(param.point.x)
```

這是正確的 v5.2 API，用於將點擊座標轉換為時間。

---

## 📝 結論

**冇衝突！** StockPulse 使用的 API 都是 v5.2 官方支持的：

| 用法 | 位置 | 狀態 |
|------|------|------|
| `timeToCoordinate` | ChartContainer.tsx:442 | ✅ 正確 |
| `coordinateToTime` | ChartContainer.tsx:435 | ✅ 正確 |
| `createSeriesMarkers` | ChartContainer.tsx | ✅ 正確 |
| `chart.addSeries(CandlestickSeries)` | ChartContainer.tsx | ✅ 正確 |

**真正需要修復的是 `calculateElliottWave()` 演算法，不是 API 調用方式。**

---

## 📝 StockPulse 改進建議

1. **Elliott Wave Bug（高優先）**：修復 `calculateElliottWave()` 演算法，真正實現波浪循環識別
2. **考慮 Pane 支持**：成交量和K線分開，更清晰
3. **考慮 Baseline Series**：MACD 等指標更適合放在單獨 pane

---

_最後更新：2026-05-15_

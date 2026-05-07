// GridTestPage - 測試 CSS Grid 對齊股票列表

import React, { useState } from 'react'
import styles from './GridTestPage.module.css'

// Mock stock data
const MOCK_STOCKS = [
  { code: 'HK.00981', name: '中芯國際', price: 28.50, pctChange: 2.35, open: 28.00, high: 29.00, low: 27.80, volume: 12500000 },
  { code: 'US.INTC', name: '英特爾', price: 42.30, pctChange: -1.25, open: 43.00, high: 43.50, low: 42.00, volume: 28000000 },
  { code: 'HK.00700', name: '騰訊控股', price: 385.00, pctChange: 0.85, open: 384.00, high: 388.00, low: 383.50, volume: 15800000 },
  { code: 'US.NVDA', name: '英偉達', price: 875.50, pctChange: 3.45, open: 860.00, high: 880.00, low: 855.00, volume: 42000000 },
]

// Column widths - single source of truth
export const GRID_COLUMNS = '60px 1fr 70px 60px 55px 50px 50px 50px 24px'

// Format volume
const formatVolume = (vol: number) => {
  if (vol >= 1000000) return `${(vol / 1000000).toFixed(1)}M`
  if (vol >= 1000) return `${(vol / 1000).toFixed(0)}K`
  return String(vol)
}

export default function GridTestPage() {
  const [stocks] = useState(MOCK_STOCKS)

  return (
    <div className={styles.container}>
      <h1>CSS Grid 對齊測試</h1>

      {/* Header */}
      <div className={styles.stockHeader}>
        <span className={styles.colCode}>代碼</span>
        <span className={styles.colName}>名稱</span>
        <span className={styles.colPrice}>現價</span>
        <span className={styles.colPct}>漲跌%</span>
        <span className={styles.colOpen}>開</span>
        <span className={styles.colHigh}>高</span>
        <span className={styles.colLow}>低</span>
        <span className={styles.colVolume}>成交量</span>
        <span className={styles.colMore}></span>
      </div>

      {/* Stock rows - same grid class */}
      {stocks.map((stock, idx) => (
        <div key={stock.code} className={styles.stockRow}>
          <span className={styles.colCode}>{stock.code.replace('HK.', '').replace('US.', '')}</span>
          <span className={styles.colName}>{stock.name}</span>
          <span className={styles.colPrice}>{stock.price.toFixed(2)}</span>
          <span className={styles.colPct} style={{ color: stock.pctChange >= 0 ? '#26BA75' : '#EE5151' }}>
            {stock.pctChange >= 0 ? '+' : ''}{stock.pctChange.toFixed(2)}%
          </span>
          <span className={styles.colOpen}>{stock.open.toFixed(2)}</span>
          <span className={styles.colHigh}>{stock.high.toFixed(2)}</span>
          <span className={styles.colLow}>{stock.low.toFixed(2)}</span>
          <span className={styles.colVolume}>{formatVolume(stock.volume)}</span>
          <span className={styles.colMore}>⋮</span>
        </div>
      ))}

      <div className={styles.info}>
        <p>使用 CSS Grid: <code>grid-template-columns: {GRID_COLUMNS}</code></p>
        <p>Header 和 Row 使用同一個 class，自動對齊 ✅</p>
      </div>
    </div>
  )
}
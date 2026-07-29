// ChartToolbar - K線圖工具列

import React from 'react'
import { Button, Space, Input } from 'antd'
import styles from './ChartToolbar.module.css'

interface Period {
  label: string
  value: string
}

interface QuoteData {
  last_price: number
  change: number
  pct_change: number
}

interface ChartToolbarProps {
  periods: Period[]
  currentPeriod: string
  onPeriodChange: (period: string) => void
  // 大少 #8648: 移除 stockName, 加 stockCode + real-time quote
  stockCode: string
  quote: QuoteData | null
  startDate: string
  endDate: string
  onDateChange: (start: string, end: string) => void
}

// 快捷按鈕
const PRESETS = [
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
  { label: '3Y', days: 1095 },
  { label: '6Y', days: 2190 },
  { label: '10Y', days: 3650 },
  { label: 'ALL', days: 9999 },
]

export default function ChartToolbar({
  periods,
  currentPeriod,
  onPeriodChange,
  stockCode,
  quote,
  startDate,
  endDate,
  onDateChange,
}: ChartToolbarProps) {
  const today = new Date().toISOString().split('T')[0]

  // 快捷按鈕點擊
  const handlePreset = (days: number) => {
    const end = today
    const start = days >= 9999 
      ? '2010-01-01'  // ALL 的起始
      : new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    onDateChange(start, end)
  }

  return (
    <div className={styles.toolbar}>
      {/* 大少 #8648: 藍框 stockName 已移除 (CHART 用 top header 大少指定唔要 stock name 重複) */}
      <Space size="middle" wrap>
        {/* 日期輸入 */}
        <Input
          placeholder="開始日期"
          value={startDate}
          onChange={e => onDateChange(e.target.value, endDate)}
          style={{ width: 110 }}
          size="small"
        />
        <span style={{ color: '#666' }}>至</span>
        <Input
          placeholder="結束日期"
          value={endDate}
          onChange={e => onDateChange(startDate, e.target.value)}
          style={{ width: 110 }}
          size="small"
        />
        {/* 快捷按鈕 */}
        {PRESETS.map(p => (
          <Button
            key={`preset-${p.label}`}
            type="text"
            size="small"
            onClick={() => handlePreset(p.days)}
          >
            {p.label}
          </Button>
        ))}
        {/* 週期按鈕 — 大少 #8648 指示 PERIODS array 順序 [1分鐘K, 日K, 月K, 年K] (1分鐘K index 0 最左) */}
        {periods.map(p => (
          <Button
            key={`period-${p.value}`}
            type={currentPeriod === p.value ? 'primary' : 'text'}
            size="small"
            onClick={() => onPeriodChange(p.value)}
            className={currentPeriod === p.value ? styles.activeBtn : ''}
          >
            {p.label}
          </Button>
        ))}
        {/* 大少 #8648: 紅框位置 (原本 1分鐘K button) 改為 real-time data — stock code + last price + change amount + change % */}
        {quote && (
          <span className={styles.realTimeData} data-testid="chart-realtime-quote">
            <span className={styles.realTimeCode}>{stockCode}</span>
            <span className={styles.realTimePrice}>{quote.last_price.toFixed(3)}</span>
            <span
              className={
                quote.change > 0 ? styles.realTimeChangeUp :
                quote.change < 0 ? styles.realTimeChangeDown :
                styles.realTimeChange
              }
            >
              {quote.change > 0 ? '+' : ''}{quote.change.toFixed(3)}
            </span>
            <span
              className={
                quote.pct_change > 0 ? styles.realTimeChangeUp :
                quote.pct_change < 0 ? styles.realTimeChangeDown :
                styles.realTimeChange
              }
            >
              ({quote.pct_change > 0 ? '+' : ''}{quote.pct_change.toFixed(2)}%)
            </span>
          </span>
        )}
      </Space>
    </div>
  )
}
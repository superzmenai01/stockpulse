// ChartToolbar - K線圖工具列

import React from 'react'
import { Button, Space, Input } from 'antd'
import styles from './ChartToolbar.module.css'

interface Period {
  label: string
  value: string
}

interface ChartToolbarProps {
  periods: Period[]
  currentPeriod: string
  onPeriodChange: (period: string) => void
  stockName: string
  startDate: string
  endDate: string
  onDateChange: (start: string, end: string) => void
  showSubChart?: boolean
  onShowSubChartChange?: (show: boolean) => void
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
  stockName,
  startDate,
  endDate,
  onDateChange,
  showSubChart = false,
  onShowSubChartChange,
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
      <div className={styles.stockInfo}>
        <span className={styles.stockName}>{stockName}</span>
      </div>
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
        {/* 週期按鈕 */}
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
        <Button
          type={showSubChart ? 'primary' : 'text'}
          size="small"
          onClick={() => onShowSubChartChange?.(!showSubChart)}
          className={showSubChart ? styles.activeBtn : ''}
        >
          MACD
        </Button>
      </Space>
    </div>
  )
}
// ChartToolbar - K線圖工具列

import React from 'react'
import { Button, Space } from 'antd'  // 大少 #8256: 刪 Input (date picker 已移除)
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
}

// 大少 #8256 #8258: 刪 date range picker + range buttons — UI concept 改成
// 「data 永遠 extend backward via scroll」 (Plan B fetchHistorical)

// export default function ChartToolbar({
//   periods, currentPeriod, onPeriodChange, stockName, startDate, endDate, onDateChange,
// }: ChartToolbarProps) {
//   const today = new Date().toISOString().split('T')[0]
//   const handlePreset = (days: number) => { ... onDateChange(start, end) }
//   return ( ... )
// }

export default function ChartToolbar({
  periods,
  currentPeriod,
  onPeriodChange,
  stockName,
}: ChartToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.stockInfo}>
        <span className={styles.stockName}>{stockName}</span>
      </div>
      <Space size="middle" wrap>
        {/* 週期按鈕 (大少 #8256 #8258: 保留 — 用嚟睇每支竹唔同 K 線粒度) */}
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
      </Space>
    </div>
  )
}
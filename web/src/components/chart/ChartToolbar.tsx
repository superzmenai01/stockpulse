// ChartToolbar - K線圖工具列

import React from 'react'
import { Button, Space } from 'antd'
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
      <Space>
        {periods.map(p => (
          <Button
            key={p.value}
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
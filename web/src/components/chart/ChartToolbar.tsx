// ChartToolbar - K線圖工具列

import React from 'react'
import { Button, Space, DatePicker } from 'antd'
import dayjs from 'dayjs'
import styles from './ChartToolbar.module.css'

const { RangePicker } = DatePicker

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
}

export default function ChartToolbar({
  periods,
  currentPeriod,
  onPeriodChange,
  stockName,
  startDate,
  endDate,
  onDateChange,
}: ChartToolbarProps) {
  // 格式化日期為 YYYY-MM-DD（用於 DatePicker 顯示）
  const startDayjs = startDate ? dayjs(startDate) : null
  const endDayjs = endDate ? dayjs(endDate) : null

  return (
    <div className={styles.toolbar}>
      <div className={styles.stockInfo}>
        <span className={styles.stockName}>{stockName}</span>
      </div>
      <Space size="middle">
        {/* 日期範圍選擇 */}
        <RangePicker
          value={[startDayjs, endDayjs]}
          onChange={(dates) => {
            if (dates && dates[0] && dates[1]) {
              onDateChange(dates[0].format('YYYY-MM-DD'), dates[1].format('YYYY-MM-DD'))
            }
          }}
          allowClear={false}
          size="small"
          format="YYYY-MM-DD"
        />
        {/* 週期按鈕 */}
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
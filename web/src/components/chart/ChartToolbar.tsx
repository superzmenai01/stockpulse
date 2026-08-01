// ChartToolbar - K線圖工具列

import React, { useState, useEffect } from 'react'
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
  // 大少 #8722 (2026-07-29): 移除 stockName — 改 layout：real-time data 移去最左，period buttons 移去最右
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

  // 大少 #8748 (2026-07-29): 日期輸入改 draft pattern — 輸入唔會即時 update 圖表
  // 只有 click 「執行」button 或者 click preset 先會 trigger onDateChange
  const [draftStartDate, setDraftStartDate] = useState(startDate)
  const [draftEndDate, setDraftEndDate] = useState(endDate)

  // 同步 props → draft (例如 preset click / parent reset 後)
  useEffect(() => { setDraftStartDate(startDate) }, [startDate])
  useEffect(() => { setDraftEndDate(endDate) }, [endDate])

  // 大少 #8748 (2026-07-29): 「執行」button — 將 draft 兩個日期 apply 去圖表
  const handleApplyDates = () => {
    onDateChange(draftStartDate, draftEndDate)
  }

  // 快捷按鈕點擊 (preset 直接 trigger onDateChange — 唔需要 click 「執行」)
  const handlePreset = (days: number) => {
    const end = today
    const start = days >= 9999
      ? '2010-01-01'  // ALL 的起始
      : new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    onDateChange(start, end)
  }

  return (
    <div className={styles.toolbar}>
      {/* 大少 #8722 (2026-07-29): Top row — real-time data (left) + period buttons (right)
          原本 top-left 係 stockName，已移除。
          period buttons 由原本 bottomRow 移上嚟呢度 right side。 */}
      <div className={styles.topRow}>
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
        <Space size="middle" wrap>
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

      {/* 大少 #8668 + #8748 (2026-07-29): Middle row — 日期輸入 (draft) + 「執行」button + 快捷按鈕 (1M/3M/...) */}
      <div className={styles.middleRow}>
        <Space size="middle" wrap>
          <Input
            placeholder="開始日期"
            value={draftStartDate}
            // 大少 #8748: 輸入唔再 trigger onDateChange — 只 update draft
            onChange={e => setDraftStartDate(e.target.value)}
            style={{ width: 110 }}
            size="small"
            data-testid="chart-date-start"
          />
          <span style={{ color: '#666' }}>至</span>
          <Input
            placeholder="結束日期"
            value={draftEndDate}
            onChange={e => setDraftEndDate(e.target.value)}
            style={{ width: 110 }}
            size="small"
            data-testid="chart-date-end"
          />
          {/* 大少 #8748: 「執行」button — click 先 trigger chart update */}
          <Button
            type="primary"
            size="small"
            onClick={handleApplyDates}
            data-testid="chart-apply-dates"
          >
            執行
          </Button>
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
        </Space>
      </div>

      </div>
  )
}
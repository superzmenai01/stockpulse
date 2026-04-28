// StockCard - 股票卡片組件

import React from 'react'
import { Tag } from 'antd'
import styles from './StockCard.module.css'

interface StockCardProps {
  code: string
  name: string
  price: number
  change: number
  pctChange: number
  volume?: number
  turnover?: number
  high?: number
  low?: number
  open?: number
  prevClose?: number
  compact?: boolean
  onRemove?: () => void
  onMoveToGroup?: () => void
}

function StockCard({
  code,
  name,
  price,
  change,
  pctChange,
  volume,
  turnover,
  high,
  low,
  open,
  prevClose,
  compact = false,
  onRemove,
  onMoveToGroup,
}: StockCardProps) {
  const hasPrice = price !== undefined && price !== null && price > 0
  const isPositive = change >= 0
  // 富途風格：綠升紅跌
  const changeColor = isPositive ? '#26BA75' : '#EE5151'

  // 格式化數字
  const formatVolume = (v?: number) => {
    if (!v) return '--'
    if (v >= 1000000000) return (v / 1000000000).toFixed(1) + 'B'
    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M'
    if (v >= 1000) return (v / 1000).toFixed(1) + 'K'
    return v.toString()
  }

  if (compact) {
    // 簡潔模式：顯示喺組別入面
    return (
      <div className={styles.compactRow}>
        <span className={styles.code}>{code.replace('HK.', '').replace('US.', '')}</span>
        <span className={styles.name}>{name}</span>
        <span className={styles.price}>{hasPrice ? price.toFixed(2) : '--'}</span>
        <span className={styles.tag} style={{ color: changeColor }}>
          {hasPrice ? `${isPositive ? '+' : ''}${pctChange.toFixed(2)}%` : '--'}
        </span>
        <span className={styles.open}>{open?.toFixed(2) ?? '--'}</span>
        <span className={styles.high}>{high?.toFixed(2) ?? '--'}</span>
        <span className={styles.low}>{low?.toFixed(2) ?? '--'}</span>
        <span className={styles.volume}>{formatVolume(volume)}</span>
      </div>
    )
  }

  // 完整模式
  return (
    <div className={styles.card}>
      <div className={styles.row}>
        <span className={styles.nameLarge}>{name}</span>
        <span className={styles.code}>{code}</span>
        <span className={styles.price}>{hasPrice ? price.toFixed(2) : '--'}</span>
        <span style={{ color: changeColor }}>
          {hasPrice ? `${isPositive ? '+' : ''}${change.toFixed(3)} (${pctChange.toFixed(2)}%)` : '--'}
        </span>
      </div>
    </div>
  )
}

export default StockCard

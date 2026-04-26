// StockCard - 股票卡片組件

import React from 'react'
import { Tag, Card } from 'antd'
import styles from './StockCard.module.css'

interface StockCardProps {
  code: string
  name: string
  price: number
  change: number
  pctChange: number
  compact?: boolean
  onClick?: () => void
}

function StockCard({
  code,
  name,
  price,
  change,
  pctChange,
  compact = false,
  onClick,
}: StockCardProps) {
  // 如果沒有價格數據，顯示 "--"
  const hasPrice = price !== undefined && price !== null && price > 0
  const isPositive = change >= 0
  const changeColor = isPositive ? '#f5222d' : '#52c41a' // 紅升綠降

  if (compact) {
    // 簡潔模式：用於組別內的列表
    return (
      <div className={styles.compact} onClick={onClick}>
        <div className={styles.left}>
          <span className={styles.code}>{code.replace('HK.', '')}</span>
          <span className={styles.name}>{name}</span>
        </div>
        <div className={styles.right}>
          <span className={styles.price}>
            {hasPrice ? price.toFixed(2) : '--'}
          </span>
          {hasPrice ? (
            <Tag color={changeColor} className={styles.tag}>
              {isPositive ? '+' : ''}{pctChange.toFixed(2)}%
            </Tag>
          ) : (
            <Tag className={styles.tag}>等待...</Tag>
          )}
        </div>
      </div>
    )
  }

  // 完整模式
  return (
    <Card className={styles.card} onClick={onClick} hoverable>
      <div className={styles.header}>
        <div>
          <div className={styles.nameLarge}>{name}</div>
          <div className={styles.codeSmall}>{code}</div>
        </div>
        <div className={styles.priceSection}>
          <div className={styles.priceLarge}>
            {hasPrice ? price.toFixed(2) : '--'}
          </div>
          {hasPrice ? (
            <Tag color={changeColor} className={styles.tagLarge}>
              {isPositive ? '+' : ''}{change.toFixed(3)} ({pctChange.toFixed(2)}%)
            </Tag>
          ) : (
            <Tag className={styles.tagLarge}>等待...</Tag>
          )}
        </div>
      </div>
    </Card>
  )
}

export default StockCard

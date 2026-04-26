// GroupCard - 組別卡片組件

import React from 'react'
import { Card, Button, Space, Dropdown, Tag } from 'antd'
import {
  DownOutlined,
  UpOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  MoreOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import StockCard from '../stock/StockCard'
import styles from './GroupCard.module.css'

interface Stock {
  code: string
  name: string
  price: number
  change: number
  pctChange: number
}

interface GroupCardProps {
  id: string
  name: string
  color: string
  stocks: Stock[]
  expanded: boolean
  onToggle: () => void
  onAddStock: () => void
  onEdit: () => void
  onDelete: () => void
}

function GroupCard({
  id,
  name,
  color,
  stocks,
  expanded,
  onToggle,
  onAddStock,
  onEdit,
  onDelete,
}: GroupCardProps) {
  // 右鍵菜單
  const menuItems: MenuProps['items'] = [
    {
      key: 'edit',
      icon: <EditOutlined />,
      label: '編輯',
      onClick: onEdit,
    },
    {
      key: 'delete',
      icon: <DeleteOutlined />,
      label: '刪除',
      danger: true,
      onClick: onDelete,
    },
  ]

  return (
    <Card className={styles.card} style={{ borderLeftColor: color }}>
      {/* 組別 Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft} onClick={onToggle}>
          <span className={styles.toggleIcon}>
            {expanded ? <DownOutlined /> : <RightOutlined />}
          </span>
          <Tag color={color} className={styles.colorTag}>
            {name}
          </Tag>
          <span className={styles.stockCount}>
            {stocks.length} 隻股票
          </span>
        </div>

        <Space>
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={onAddStock}
          >
            加入股票
          </Button>
          <Dropdown menu={{ items: menuItems }} trigger={['click']}>
            <Button size="small" icon={<MoreOutlined />} />
          </Dropdown>
        </Space>
      </div>

      {/* 股票列表 */}
      {expanded && (
        <div className={styles.stockList}>
          {stocks.length === 0 ? (
            <div className={styles.empty}>暫時沒有股票</div>
          ) : (
            stocks.map(stock => (
              <StockCard
                key={stock.code}
                code={stock.code}
                name={stock.name}
                price={stock.price}
                change={stock.change}
                pctChange={stock.pctChange}
                compact
              />
            ))
          )}
        </div>
      )}
    </Card>
  )
}

// 修復：使用正確的箭頭圖標
const RightOutlined = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
    <path d="M4.5 2L8.5 6L4.5 10" stroke="currentColor" strokeWidth="1.5" fill="none" />
  </svg>
)

export default GroupCard

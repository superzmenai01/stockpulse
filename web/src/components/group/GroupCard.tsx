// GroupCard - 組別卡片組件（可拖動排序）

import React from 'react'
import { Card, Button, Space, Dropdown, Tag } from 'antd'
import {
  DownOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  MoreOutlined,
  HolderOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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
  draggable?: boolean
  onToggle: () => void
  onAddStock: (groupId: string, groupName: string) => void
  onEdit: () => void
  onDelete: () => void
}

function GroupCard({
  id,
  name,
  color,
  stocks,
  expanded,
  draggable = false,
  onToggle,
  onAddStock,
  onEdit,
  onDelete,
}: GroupCardProps) {
  // dnd-kit sortable
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !draggable })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

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
    <div ref={setNodeRef} style={style}>
      <Card className={styles.card} style={{ borderLeftColor: color }}>
        {/* 組別 Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            {draggable && (
              <span 
                className={styles.dragHandle}
                {...attributes}
                {...listeners}
              >
                <HolderOutlined />
              </span>
            )}
            <span className={styles.toggleIcon} onClick={onToggle}>
              {expanded ? <DownOutlined /> : <RightOutlined />}
            </span>
            <Tag color={color} className={styles.colorTag} onClick={onToggle}>
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
              onClick={() => onAddStock(id, name)}
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
    </div>
  )
}

// 修復：使用正確的箭頭圖標
const RightOutlined = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
    <path d="M4.5 2L8.5 6L4.5 10" stroke="currentColor" strokeWidth="1.5" fill="none" />
  </svg>
)

export default GroupCard

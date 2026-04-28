// GroupCard - 組別卡片組件

import React from 'react'
import { Card, Button, Space, Dropdown, Tag } from 'antd'
import {
  DownOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  HolderOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import StockCard from '../stock/StockCard'
import styles from './GroupCard.module.css'

interface Stock {
  code: string
  name: string
  price: number
  change: number
  pctChange: number
  open?: number
  high?: number
  low?: number
  prevClose?: number
  volume?: number
  turnover?: number
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
  onRemoveStock?: (groupId: string, code: string) => void
  onMoveStock?: (code: string, stockName: string) => void
  onReorderStocks?: (groupId: string, oldIndex: number, newIndex: number) => void
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
  onRemoveStock,
  onMoveStock,
}: GroupCardProps) {
  // dnd-kit sensors - 只用於組別拖動
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Group card dnd-kit sortable
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !draggable })

  const groupStyle = {
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
    <div ref={setNodeRef} style={groupStyle}>
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

        {/* 股票列表（不可拖動，簡化版） */}
        {expanded && (
          <div className={styles.stockList}>
            {/* 標題行 */}
            <div className={styles.stockHeader}>
              <span className={styles.colCode}>代碼</span>
              <span className={styles.colName}>名稱</span>
              <span className={styles.colPrice}>現價</span>
              <span className={styles.colPct}>漲跌%</span>
              <span className={styles.colOpen}>開</span>
              <span className={styles.colHigh}>高</span>
              <span className={styles.colLow}>低</span>
              <span className={styles.colVolume}>成交量</span>
            </div>
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
                  open={stock.open}
                  high={stock.high}
                  low={stock.low}
                  volume={stock.volume}
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

// 箭頭組件
const RightOutlined = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
    <path d="M4.5 2L8.5 6L4.5 10" stroke="currentColor" strokeWidth="1.5" fill="none" />
  </svg>
)

// 三點更多按鈕
const MoreOutlined = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <circle cx="8" cy="3" r="1.5" />
    <circle cx="8" cy="8" r="1.5" />
    <circle cx="8" cy="13" r="1.5" />
  </svg>
)

export default GroupCard

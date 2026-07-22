// FilterPanel - 指標頁面範圍選擇面板

import React, { useState } from 'react'
import { Card, Checkbox, Select, InputNumber, Space, Divider, Typography } from 'antd'
import { FilterOutlined } from '@ant-design/icons'
import styles from './FilterPanel.module.css'

const { Text } = Typography

// 市場選項
const MARKET_OPTIONS = [
  { label: '港股主板', value: 'HK_MAIN' },
  { label: '港股創業板', value: 'HK_GEM' },
  { label: '美股', value: 'US' },
  { label: 'A股', value: 'CN' },
  { label: '中概股', value: 'CHINA' },
]

// 板塊選項
const SECTOR_OPTIONS = [
  { label: '全部', value: 'ALL' },
  { label: '半導體', value: 'SEMICONDUCTOR' },
  { label: '科技', value: 'TECH' },
  { label: '金融', value: 'FINANCE' },
  { label: '醫藥', value: 'PHARMA' },
  { label: '消費', value: 'CONSUMER' },
  { label: '地產', value: 'PROPERTY' },
  { label: '能源', value: 'ENERGY' },
  { label: '新能源', value: 'EV' },
  { label: '通訊', value: 'TELECOM' },
]

export interface FilterConfig {
  markets: string[]
  sector: string
  logic: 'AND' | 'OR'
}

interface FilterPanelProps {
  filters: FilterConfig
  onChange: (filters: FilterConfig) => void
}

export default function FilterPanel({ filters, onChange }: FilterPanelProps) {
  const [priceRange, setPriceRange] = useState<[number | null, number | null]>([null, null])

  const handleMarketChange = (checkedValues: string[]) => {
    onChange({ ...filters, markets: checkedValues })
  }

  const handleSectorChange = (value: string) => {
    onChange({ ...filters, sector: value })
  }

  const handleLogicChange = (value: 'AND' | 'OR') => {
    onChange({ ...filters, logic: value })
  }

  return (
    <Card className={styles.card} size="small">
      <div className={styles.header}>
        <FilterOutlined />
        <span>範圍選擇</span>
      </div>

      <div className={styles.section}>
        <Text strong>市場</Text>
        <Checkbox.Group
          className={styles.checkboxGroup}
          value={filters.markets}
          onChange={(values) => handleMarketChange(values as string[])}
        >
          <Space direction="vertical" size={4}>
            {MARKET_OPTIONS.map(opt => (
              <Checkbox key={opt.value} value={opt.value}>{opt.label}</Checkbox>
            ))}
          </Space>
        </Checkbox.Group>
      </div>

      <Divider className={styles.divider} />

      <div className={styles.section}>
        <Text strong>板塊</Text>
        <Select
          className={styles.select}
          value={filters.sector}
          onChange={handleSectorChange}
          options={SECTOR_OPTIONS}
          style={{ width: '100%' }}
        />
      </div>

      <Divider className={styles.divider} />

      <div className={styles.section}>
        <Text strong>邏輯組合</Text>
        <Select
          className={styles.select}
          value={filters.logic}
          onChange={handleLogicChange}
          options={[
            { label: 'AND - 全部條件滿足', value: 'AND' },
            { label: 'OR - 任一條件滿足', value: 'OR' },
          ]}
          style={{ width: '100%' }}
        />
      </div>
    </Card>
  )
}

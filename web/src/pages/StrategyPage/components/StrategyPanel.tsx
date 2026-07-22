// StrategyPanel - 指標面板

import React from 'react'
import { Card, Checkbox, InputNumber, Slider, Select, Space, Typography, Button, Divider, Collapse } from 'antd'
import { BarChartOutlined, LineChartOutlined, ThunderboltOutlined, FundOutlined, BarChartOutlined as BarOutlined } from '@ant-design/icons'
import styles from './StrategyPanel.module.css'

const { Text } = Typography

// 指標定義
export interface Strategy {
  id: string
  name: string
  category: string
  description: string
  enabled: boolean
  params: Record<string, any>
}

export interface StrategyConfig {
  id: string
  enabled: boolean
  params: Record<string, any>
}

// 指標分類
const STRATEGY_CATEGORIES = [
  {
    key: 'tech',
    label: '技術分析',
    icon: <BarChartOutlined />,
    strategies: [
      {
        id: 'zigzag_v',
        name: 'ZigZag V型反轉',
        description: '使用 ZigZag 識別價格 V 型反轉形態',
        params: { threshold: { label: 'Threshold', type: 'slider', min: 3, max: 20, default: 5 } },
      },
      {
        id: 'volume_surge',
        name: '成交量放大',
        description: '今日成交量高於平均成交量的倍數',
        params: { multiplier: { label: '倍數', type: 'number', min: 1.5, max: 5, step: 0.5, default: 2 } },
      },
      {
        id: 'breakout',
        name: '突破均線',
        description: '價格突破指定移動平均線',
        params: { period: { label: '均線週期', type: 'select', options: [5, 10, 20, 60], default: 20 } },
      },
    ],
  },
  {
    key: 'trend',
    label: '趨勢追蹤',
    icon: <LineChartOutlined />,
    strategies: [
      {
        id: 'above_ma20',
        name: '20日均線之上',
        description: '現價高於 20 日移動平均線',
        params: {},
      },
      {
        id: 'above_ma50',
        name: '50日均線之上',
        description: '現價高於 50 日移動平均線',
        params: {},
      },
      {
        id: 'above_ma200',
        name: '200日均線之上',
        description: '現價高於 200 日移動平均線（牛市確認）',
        params: {},
      },
    ],
  },
  {
    key: 'momentum',
    label: '動能指標',
    icon: <ThunderboltOutlined />,
    strategies: [
      {
        id: 'rsi_oversold',
        name: 'RSI 超賣',
        description: 'RSI 低於指定閾值（超賣區域）',
        params: { threshold: { label: 'RSI 閾值', type: 'slider', min: 20, max: 40, default: 30 } },
      },
      {
        id: 'macd_cross',
        name: 'MACD 金叉',
        description: 'MACD 線上穿訊號線（買入信號）',
        params: {},
      },
      {
        id: 'new_high',
        name: '股價創新高',
        description: '創指定期間內的新高',
        params: { period: { label: '期間', type: 'select', options: [20, 50, 252], default: 20 } },
      },
    ],
  },
  {
    key: 'fundamental',
    label: '基本面',
    icon: <FundOutlined />,
    strategies: [
      {
        id: 'low_pe',
        name: '低 P/E',
        description: 'P/E 低於行業均值',
        params: { maxPe: { label: '最大 P/E', type: 'number', default: 15 } },
      },
      {
        id: 'high_roe',
        name: '高 ROE',
        description: '淨資產收益率高於指定值',
        params: { minRoe: { label: '最小 ROE (%)', type: 'number', default: 15 } },
      },
    ],
  },
  {
    key: 'volume',
    label: '成交量',
    icon: <BarOutlined />,
    strategies: [
      {
        id: 'volume_surge_v2',
        name: '成交量放大',
        description: '成交量高於平均的倍數',
        params: { multiplier: { label: '倍數', type: 'number', min: 1.5, max: 5, step: 0.5, default: 2 } },
      },
      {
        id: 'volume_shrink',
        name: '成交量萎縮',
        description: '成交量低於平均的某個比例',
        params: { ratio: { label: '比例', type: 'number', min: 0.1, max: 0.5, step: 0.1, default: 0.3 } },
      },
    ],
  },
]

interface StrategyPanelProps {
  strategies: StrategyConfig[]
  onChange: (strategies: StrategyConfig[]) => void
}

export default function StrategyPanel({ strategies, onChange }: StrategyPanelProps) {
  const getStrategyConfig = (id: string): StrategyConfig => {
    return strategies.find(s => s.id === id) || { id, enabled: false, params: {} }
  }

  const handleStrategyToggle = (id: string, enabled: boolean) => {
    const existing = getStrategyConfig(id)
    onChange([
      ...strategies.filter(s => s.id !== id),
      { ...existing, enabled },
    ])
  }

  const handleParamChange = (id: string, paramKey: string, value: any) => {
    const existing = getStrategyConfig(id)
    onChange([
      ...strategies.filter(s => s.id !== id),
      { ...existing, params: { ...existing.params, [paramKey]: value } },
    ])
  }

  const renderParamInput = (strategyId: string, paramKey: string, param: any) => {
    const config = getStrategyConfig(strategyId)
    const value = config.params[paramKey] ?? param.default

    if (param.type === 'slider') {
      return (
        <div key={paramKey} className={styles.paramItem}>
          <Text className={styles.paramLabel}>{param.label}: {value}</Text>
          <Slider
            min={param.min}
            max={param.max}
            step={param.step ?? 1}
            value={value}
            onChange={(val) => handleParamChange(strategyId, paramKey, val)}
            className={styles.slider}
          />
        </div>
      )
    }

    if (param.type === 'number') {
      return (
        <div key={paramKey} className={styles.paramItem}>
          <Text className={styles.paramLabel}>{param.label}</Text>
          <InputNumber
            min={param.min}
            max={param.max}
            step={param.step ?? 1}
            value={value}
            onChange={(val) => handleParamChange(strategyId, paramKey, val)}
            className={styles.inputNumber}
          />
        </div>
      )
    }

    if (param.type === 'select') {
      return (
        <div key={paramKey} className={styles.paramItem}>
          <Text className={styles.paramLabel}>{param.label}</Text>
          <Select
            value={value}
            onChange={(val) => handleParamChange(strategyId, paramKey, val)}
            options={param.options.map((o: number) => ({ label: String(o), value: o }))}
            className={styles.select}
          />
        </div>
      )
    }

    return null
  }

  const renderStrategy = (strategy: any) => {
    const config = getStrategyConfig(strategy.id)
    const paramKeys = Object.keys(strategy.params)

    return (
      <div key={strategy.id} className={styles.strategyItem}>
        <div className={styles.strategyHeader}>
          <Checkbox
            checked={config.enabled}
            onChange={(e) => handleStrategyToggle(strategy.id, e.target.checked)}
          >
            <Text strong>{strategy.name}</Text>
          </Checkbox>
        </div>
        <Text type="secondary" className={styles.strategyDesc}>
          {strategy.description}
        </Text>
        {config.enabled && paramKeys.length > 0 && (
          <div className={styles.params}>
            {paramKeys.map(key => renderParamInput(strategy.id, key, strategy.params[key]))}
          </div>
        )}
      </div>
    )
  }

  const collapseItems = STRATEGY_CATEGORIES.map(cat => ({
    key: cat.key,
    label: (
      <span className={styles.categoryLabel}>
        {cat.icon}
        <span style={{ marginLeft: 8 }}>{cat.label}</span>
      </span>
    ),
    children: (
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {cat.strategies.map(renderStrategy)}
      </Space>
    ),
  }))

  return (
    <Card className={styles.card} size="small" title="指標列表">
      <Collapse
        items={collapseItems}
        defaultActiveKey={['tech', 'trend']}
        ghost
        className={styles.collapse}
      />
    </Card>
  )
}

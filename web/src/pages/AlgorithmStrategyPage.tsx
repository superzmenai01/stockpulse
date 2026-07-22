// AlgorithmStrategyPage - 演算法策略 (placeholder)

import React from 'react'
import { Card, Typography, Tag, Space } from 'antd'
import { AppLayout } from '../components/layout'

const { Title, Paragraph, Text } = Typography

interface AlgorithmItem {
  id: string
  name: string
  source: string
  status: '📝 Draft' | '✅ Active' | '🚧 待實裝'
  description: string
}

const algorithms: AlgorithmItem[] = [
  {
    id: 'AS-01',
    name: '板塊龍頭股',
    source: '',
    status: '🚧 待實裝',
    description: '',
  },
]

export default function AlgorithmStrategyPage() {
  return (
    <AppLayout connected={true} subscribed={false}>
      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
        <Title level={2}>🧮 演算法策略</Title>
        <Paragraph type="secondary">
          此頁面將集中所有演算法（待實裝）
        </Paragraph>

        <Space direction="vertical" size="middle" style={{ width: '100%', marginTop: 24 }}>
          {algorithms.map(algo => (
            <Card key={algo.id} title={
              <Space>
                <Text strong>{algo.id}</Text>
                <Text>{algo.name}</Text>
                <Tag color={algo.status.includes('Active') ? 'green' : algo.status.includes('Draft') ? 'blue' : 'orange'}>
                  {algo.status}
                </Tag>
              </Space>
            }>
              <Paragraph>{algo.description}</Paragraph>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Source: <Text code>{algo.source}</Text>
              </Text>
            </Card>
          ))}
        </Space>
      </div>
    </AppLayout>
  )
}

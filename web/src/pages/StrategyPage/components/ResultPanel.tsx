// ResultPanel - 策略結果顯示面板

import React, { useState } from 'react'
import { Card, Table, Tag, Typography, Button, Empty, Statistic, Row, Col, Modal } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { ColumnsType } from 'antd/es/table'
import ChartContainer from '../../../components/chart/ChartContainer'
import styles from './ResultPanel.module.css'

const { Text } = Typography

export interface ScreenedStock {
  code: string
  name: string
  price: number
  change: number
  pctChange: number
  matchedStrategies: string[]
}

interface ResultPanelProps {
  results: ScreenedStock[]
  loading: boolean
  onRefresh: () => void
  onExecute: () => void
}

// 策略ID到名稱的映射
const STRATEGY_NAMES: Record<string, string> = {
  zigzag_v: 'ZigZag V型',
  volume_surge: '成交量放大',
  volume_surge_v2: '成交量放大',
  breakout: '突破均線',
  above_ma20: '20日均線',
  above_ma50: '50日均線',
  above_ma200: '200日均線',
  rsi_oversold: 'RSI超賣',
  macd_cross: 'MACD金叉',
  new_high: '創新高',
  low_pe: '低P/E',
  high_roe: '高ROE',
  volume_shrink: '成交量萎縮',
}

export default function ResultPanel({ results, loading, onRefresh, onExecute }: ResultPanelProps) {
  const [selectedStock, setSelectedStock] = useState<{ code: string; name: string } | null>(null)
  const [chartModalOpen, setChartModalOpen] = useState(false)

  const handleRowClick = (record: ScreenedStock) => {
    setSelectedStock({ code: record.code, name: record.name })
    setChartModalOpen(true)
  }

  const handleCloseChart = () => {
    setChartModalOpen(false)
    setSelectedStock(null)
  }

  const columns: ColumnsType<ScreenedStock> = [
    {
      title: '代碼',
      dataIndex: 'code',
      key: 'code',
      width: 100,
      render: (code: string) => <Text code>{code}</Text>,
    },
    {
      title: '名稱',
      dataIndex: 'name',
      key: 'name',
      width: 150,
    },
    {
      title: '現價',
      dataIndex: 'price',
      key: 'price',
      width: 80,
      align: 'right',
      render: (price: number) => price.toFixed(2),
    },
    {
      title: '漲跌',
      key: 'change',
      width: 100,
      align: 'right',
      render: (_, record) => (
        <Text type={record.change >= 0 ? 'success' : 'danger'}>
          {record.change >= 0 ? '+' : ''}{record.change.toFixed(2)} ({record.pctChange >= 0 ? '+' : ''}{record.pctChange.toFixed(2)}%)
        </Text>
      ),
    },
    {
      title: '符合策略',
      dataIndex: 'matchedStrategies',
      key: 'matchedStrategies',
      render: (strategies: string[]) => (
        <div className={styles.tagList}>
          {strategies.map(s => (
            <Tag key={s} color="blue">{STRATEGY_NAMES[s] || s}</Tag>
          ))}
        </div>
      ),
    },
  ]

  return (
    <Card className={styles.card} size="small">
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Text strong>篩選結果</Text>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={onRefresh}
            loading={loading}
            className={styles.refreshBtn}
          >
            刷新
          </Button>
        </div>
        <Text type="secondary">
          找到 {results.length} 隻符合條件的股票
        </Text>
      </div>

      {results.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={loading ? '載入中...' : '尚未執行策略'}
          className={styles.empty}
        >
          {!loading && (
            <Button type="primary" onClick={onExecute}>
              執行策略
            </Button>
          )}
        </Empty>
      ) : (
        <Table
          className={styles.table}
          dataSource={results}
          columns={columns}
          rowKey="code"
          size="small"
          pagination={{ pageSize: 10, showSizeChanger: true }}
          loading={loading}
          onRow={(record) => ({
            onClick: () => handleRowClick(record),
            style: { cursor: 'pointer' },
          })}
        />
      )}

      {/* 股票詳情 Modal - 點擊股票後顯示圖表 */}
      <Modal
        open={chartModalOpen}
        onCancel={handleCloseChart}
        title={selectedStock?.name || ''}
        width={900}
        footer={null}
        styles={{ body: { padding: 0, height: 500 } }}
      >
        {selectedStock && (
          <ChartContainer stock={selectedStock} />
        )}
      </Modal>
    </Card>
  )
}

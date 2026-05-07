// ResultPanel - 策略結果顯示面板
// 使用 CSS Grid 對齊股票列表

import { useState, useMemo } from 'react'
import { Card, Typography, Button, Empty, Modal, Spin } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
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

// Pagination constants
const PAGE_SIZE = 10

export default function ResultPanel({ results, loading, onRefresh, onExecute }: ResultPanelProps) {
  const [selectedStock, setSelectedStock] = useState<{ code: string; name: string } | null>(null)
  const [chartModalOpen, setChartModalOpen] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)

  // Calculate pagination
  const totalPages = Math.ceil(results.length / PAGE_SIZE)
  const paginatedResults = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return results.slice(start, start + PAGE_SIZE)
  }, [results, currentPage])

  const handleRowClick = (record: ScreenedStock) => {
    setSelectedStock({ code: record.code, name: record.name })
    setChartModalOpen(true)
  }

  const handleCloseChart = () => {
    setChartModalOpen(false)
    setSelectedStock(null)
  }

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }

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

      {loading && results.length === 0 ? (
        <div className={styles.empty}>
          <Spin size="large" />
          <Text type="secondary" style={{ marginTop: 12 }}>載入中...</Text>
        </div>
      ) : results.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="尚未執行策略"
          className={styles.empty}
        >
          <Button type="primary" onClick={onExecute}>
            執行策略
          </Button>
        </Empty>
      ) : (
        <>
          {/* Header */}
          <div className={styles.stockHeader}>
            <span className={styles.colCode}>代碼</span>
            <span className={styles.colName}>名稱</span>
            <span className={styles.colPrice}>現價</span>
            <span className={styles.colChange}>漲跌</span>
            <span className={styles.colMore}></span>
          </div>

          {/* Stock rows - CSS Grid */}
          {paginatedResults.map((stock) => (
            <div
              key={stock.code}
              className={styles.stockRow}
              onClick={() => handleRowClick(stock)}
            >
              <span className={styles.colCode}>{stock.code}</span>
              <span className={styles.colName}>{stock.name}</span>
              <span className={styles.colPrice}>{stock.price.toFixed(2)}</span>
              <span className={`${styles.colChange} ${stock.change >= 0 ? styles.colChangePositive : styles.colChangeNegative}`}>
                {stock.change >= 0 ? '+' : ''}{stock.change.toFixed(2)} ({stock.pctChange >= 0 ? '+' : ''}{stock.pctChange.toFixed(2)}%)
              </span>
              <span className={styles.colMore}>⋮</span>
            </div>
          ))}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className={styles.pagination}>
              <Text className={styles.pageInfo}>
                第 {currentPage}/{totalPages} 頁
              </Text>
              <Button
                size="small"
                disabled={currentPage <= 1}
                onClick={() => handlePageChange(currentPage - 1)}
                className={styles.pageBtn}
              >
                上一頁
              </Button>
              <Button
                size="small"
                disabled={currentPage >= totalPages}
                onClick={() => handlePageChange(currentPage + 1)}
                className={styles.pageBtn}
              >
                下一頁
              </Button>
            </div>
          )}
        </>
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

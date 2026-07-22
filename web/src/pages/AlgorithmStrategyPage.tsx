// AlgorithmStrategyPage - 演算法策略 (main app /algorithms page)
//
// 整合自 test page:
// - 純手動 drag-to-resize (拉右邊界改 width)
// - localStorage auto-persist (drag 結束即寫 · reload 時讀返)
// - 4 個 algorithm items: AS-01 板塊龍頭股 + 3 個 TBD
// - 跟 main app dark theme (theme.css CSS vars)
//
// Scope defaults (per user confirm):
//   ✓ 保留 3 個 TBD items
//   ✓ 清理 test-specific UI (banner / back link / footer note)
//   ✓ 保留 drag-resize + auto-persist

import React, { useState } from 'react'
import {
  Card,
  Select,
  InputNumber,
  Button,
  Tooltip,
  Empty,
  Spin,
  Typography,
  Space,
  Tag,
} from 'antd'
import {
  SearchOutlined,
  ThunderboltOutlined,
  SaveOutlined,
  PlusOutlined,
  ExperimentOutlined,
} from '@ant-design/icons'
import { AppLayout } from '../components/layout'
import { useDragResize } from '../utils/useDragResize'
import styles from './AlgorithmStrategyPage.module.css'

const { Title, Paragraph, Text } = Typography

// ============== Mock data ==============
const MOCK_PLATES = [
  { value: 'HK.LIST1091', label: '半導體' },
  { value: 'HK.LIST1044', label: 'AI 人工智能' },
  { value: 'HK.LIST1234', label: '互聯網' },
  { value: 'HK.LIST5678', label: '金融' },
  { value: 'HK.LIST9012', label: '醫藥' },
  { value: 'HK.LIST3456', label: '新能源' },
  { value: 'HK.LIST7890', label: '消費' },
  { value: 'HK.LIST1111', label: '地產' },
  { value: 'HK.LIST2222', label: '通訊' },
  { value: 'HK.LIST3333', label: '公用事業' },
]

const MOCK_RESULTS_AS01 = [
  { code: '00981', name: '中芯國際', price: 73.80, change: -1.15, pct: -1.54, mcap: '4500 億', turnover: '2.3%' },
  { code: '00700', name: '騰訊控股', price: 467.80, change: -11.40, pct: -2.38, mcap: '44000 億', turnover: '1.8%' },
  { code: '02382', name: '比亞迪', price: 298.00, change: 9.26, pct: 3.21, mcap: '8700 億', turnover: '3.5%' },
  { code: '09988', name: '阿里巴巴', price: 89.50, change: 2.10, pct: 2.40, mcap: '17000 億', turnover: '1.5%' },
  { code: '01024', name: '快手', price: 52.30, change: 0.85, pct: 1.65, mcap: '2200 億', turnover: '4.1%' },
]

const SIDEBAR_ITEMS = [
  { key: 'as-01', id: 'AS-01', name: '板塊龍頭股', icon: <ThunderboltOutlined />, implemented: true },
  { key: 'as-02', id: '新演算法 A', name: '(TBD)', icon: <ExperimentOutlined />, implemented: false },
  { key: 'as-03', id: '新演算法 B', name: '(TBD)', icon: <ExperimentOutlined />, implemented: false },
  { key: 'as-04', id: '新演算法 C', name: '(TBD)', icon: <ExperimentOutlined />, implemented: false },
]

// ============== Placeholder panel (TBD algorithm) ==============
function NotImplementedPlaceholder({ algorithmId }: { algorithmId: string }) {
  return (
    <div className={styles.placeholderPanel}>
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <Space direction="vertical" size={4}>
            <Text strong>{algorithmId}</Text>
            <Text type="secondary" style={{ fontSize: 13 }}>
              尚未實裝 · 將來擺新演算法嘅 filter + 結果
            </Text>
          </Space>
        }
      />
    </div>
  )
}

// ============== AS-01 panel (with inner drag-to-resize + auto-persist) ==============
function AS01Panel() {
  const inner = useDragResize({
    initial: 380,
    min: 240,
    max: 500,
    storageKey: 'main-algorithms-inner-width',
  })

  const [selectedPlates, setSelectedPlates] = useState<string[]>(['HK.LIST1091', 'HK.LIST1044'])
  const [topN, setTopN] = useState<number>(3)
  const [loading, setLoading] = useState(false)
  const [hasRun, setHasRun] = useState(true)

  const handleExecute = () => {
    setLoading(true)
    setTimeout(() => {
      setLoading(false)
      setHasRun(true)
    }, 1200)
  }

  const displayedResults = MOCK_RESULTS_AS01.slice(0, topN)

  return (
    <div className={styles.twoPanel} style={{ gridTemplateColumns: `${inner.width}px 1fr` }}>
      {/* LEFT: Filter (drag-to-resize via right handle) */}
      <Card title="⚙️ 設定" className={styles.leftPanel}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div>
            <Text strong>🏷️ 板塊（可多選）</Text>
            <Select
              mode="multiple"
              showSearch
              placeholder="🔍 搵板塊..."
              value={selectedPlates}
              onChange={setSelectedPlates}
              options={MOCK_PLATES}
              className={styles.fullWidth}
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              maxTagCount="responsive"
            />
            <Text type="secondary" className={styles.hint}>
              已選 <Tag color="blue">{selectedPlates.length}</Tag> 個板塊
            </Text>
          </div>

          <div>
            <Text strong>🔢 取頭 N 位</Text>
            <InputNumber
              min={1}
              max={50}
              value={topN}
              onChange={(v) => setTopN(v ?? 3)}
              className={styles.fullWidth}
            />
            <Text type="secondary" className={styles.hint}>
              範圍 1-50，預設 3
            </Text>
          </div>

          <Button
            type="primary"
            size="large"
            icon={<SearchOutlined />}
            loading={loading}
            onClick={handleExecute}
            block
          >
            🔍 執行
          </Button>
        </Space>
        {/* Drag handle on right edge */}
        <div
          className={`${styles.resizeHandle} ${inner.dragging ? styles.resizeHandleActive : ''}`}
          onMouseDown={inner.handleMouseDown}
          title="拖拽改 filter 闊度"
        />
      </Card>

      {/* RIGHT: Results */}
      <Card
        title={
          <Space>
            <span>📊 結果</span>
            {hasRun && !loading && (
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
                （顯示 top {displayedResults.length}）
              </Text>
            )}
          </Space>
        }
        className={styles.rightPanel}
        extra={
          <Tooltip title="🚧 儲存結果待實裝">
            <Button icon={<SaveOutlined />} disabled size="small">
              💾 儲存結果
            </Button>
          </Tooltip>
        }
      >
        {loading ? (
          <div className={styles.center}>
            <Spin size="large" />
            <Text type="secondary" style={{ marginTop: 12, display: 'block' }}>
              正在執行 composite ranking...
            </Text>
          </div>
        ) : !hasRun ? (
          <Empty description="未有結果，請選板塊按執行" />
        ) : (
          <div className={styles.resultsGrid}>
            <div className={styles.gridHeader}>
              <span>排名</span>
              <span>代碼</span>
              <span>名稱</span>
              <span className={styles.alignRight}>現價</span>
              <span className={styles.alignRight}>漲跌</span>
              <span className={styles.alignRight}>市值</span>
              <span className={styles.alignRight}>換手率</span>
            </div>
            {displayedResults.map((stock, idx) => (
              <div key={stock.code} className={styles.gridRow}>
                <span className={styles.rankCell}>#{idx + 1}</span>
                <span className={styles.code}>{stock.code}</span>
                <span className={styles.name}>{stock.name}</span>
                <span className={`${styles.price} ${styles.alignRight}`}>
                  {stock.price.toFixed(2)}
                </span>
                <span
                  className={`${styles.change} ${styles.alignRight} ${
                    stock.pct >= 0 ? styles.up : styles.down
                  }`}
                >
                  {stock.pct >= 0 ? '+' : ''}
                  {stock.pct.toFixed(2)}%
                </span>
                <span className={`${styles.muted} ${styles.alignRight}`}>{stock.mcap}</span>
                <span className={`${styles.muted} ${styles.alignRight}`}>
                  {stock.turnover}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

// ============== Main Page ==============
export default function AlgorithmStrategyPage() {
  const outer = useDragResize({
    initial: 260,
    min: 180,
    max: 400,
    storageKey: 'main-algorithms-outer-width',
  })

  const [activeKey, setActiveKey] = useState('as-01')
  const activeItem = SIDEBAR_ITEMS.find(item => item.key === activeKey)

  return (
    <AppLayout connected={true} subscribed={false}>
      <div className={styles.container}>
        {/* Header */}
        <div className={styles.header}>
          <Title level={2} style={{ margin: 0 }}>
            🧮 演算法策略
          </Title>
          <Paragraph type="secondary" style={{ margin: '8px 0 0 0' }}>
            演算法集中點 · 各演算法有自己嘅 filter + 結果 · 拉 sidebar / filter 右邊界改 width · 自動 persist
          </Paragraph>
        </div>

        {/* Outer layout: sidebar + content (drag-to-resize) */}
        <div className={styles.outerLayout} style={{ gridTemplateColumns: `${outer.width}px 1fr` }}>
          {/* Outer Sidebar (algorithm list) */}
          <aside className={styles.sidebar}>
            <div className={styles.sidebarHeader}>
              <Text strong>⚙️ 演算法</Text>
              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
                {SIDEBAR_ITEMS.length} 個 · 拉右邊界改 width
              </Text>
            </div>

            <div className={styles.sidebarList}>
              {SIDEBAR_ITEMS.map(item => {
                const isActive = activeKey === item.key
                const isDisabled = !item.implemented
                return (
                  <div
                    key={item.key}
                    className={[
                      styles.sidebarItem,
                      isActive && styles.sidebarItemActive,
                      isDisabled && styles.sidebarItemDisabled,
                    ].filter(Boolean).join(' ')}
                    onClick={() => !isDisabled && setActiveKey(item.key)}
                  >
                    <div className={styles.sidebarItemIcon}>{item.icon}</div>
                    <div className={styles.sidebarItemContent}>
                      <div className={styles.sidebarItemId}>{item.id}</div>
                      <div className={styles.sidebarItemName}>{item.name}</div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className={styles.sidebarFooter}>
              <Tooltip title="🚧 將來實裝 — 暫不啟用">
                <Button type="dashed" icon={<PlusOutlined />} size="small" block disabled>
                  新增演算法
                </Button>
              </Tooltip>
            </div>

            {/* Drag handle on right edge */}
            <div
              className={`${styles.resizeHandle} ${outer.dragging ? styles.resizeHandleActive : ''}`}
              onMouseDown={outer.handleMouseDown}
              title="拖拽改 sidebar 闊度"
            />
          </aside>

          {/* Content area */}
          <main className={styles.contentArea}>
            {activeKey === 'as-01' && <AS01Panel />}
            {activeKey !== 'as-01' && activeItem && (
              <NotImplementedPlaceholder algorithmId={activeItem.id} />
            )}
          </main>
        </div>
      </div>
    </AppLayout>
  )
}
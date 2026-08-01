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

import React, { useState, useEffect, useCallback } from 'react'
import {
  Card,
  Select,
  InputNumber,
  Input,
  Button,
  Tooltip,
  Empty,
  Spin,
  Typography,
  Space,
  Tag,
  Switch,
  message,
} from 'antd'
import {
  SearchOutlined,
  ThunderboltOutlined,
  SaveOutlined,
  PlusOutlined,
  ExperimentOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { AppLayout } from '../components/layout'
import { useDragResize } from '../utils/useDragResize'
import styles from './AlgorithmStrategyPage.module.css'

// 大少 2026-07-24 Tier 1.3: Modular hooks + sub-components
import { usePlates } from '../hooks/usePlates'
import { useExecuteAlgorithm } from '../hooks/useExecuteAlgorithm'
import { useExecuteAS02 } from '../hooks/useExecuteAS02'
import { usePopularityStatus } from '../hooks/usePopularityStatus'
import NonStockToggle from '../components/algorithm/NonStockToggle'
import PlateSelector from '../components/algorithm/PlateSelector'
import ResultGrid from '../components/algorithm/ResultGrid'
import AS02ResultPanel from '../components/algorithm/AS02ResultPanel'
import SaveRunModal from '../components/library/SaveRunModal'
import { useSaveRunFlow } from '../hooks/useSaveRunFlow'
// 大少 2026-07-27: 每條 AS 嘅 user-facing description (V2 collapsed 模式)
import { ALGORITHM_DESCRIPTIONS } from '../constants/algorithmDescriptions'

const { Title, Paragraph, Text } = Typography

// ============== Mock data 已全部移除 ==============
// MOCK_PLATES 已移除 — 改從 /api/plates fetch 真實 popularity data
// (大少 2026-07-23 instruction: 板塊選項用 OpenD + popularity ranking)
// 真實 data 由 AS01Panel 入面嘅 fetchTopPlates() handle.
// MOCK_RESULTS_AS01 已移除 (大少 2026-07-23 Option A) — 改從 /api/plates/run fetch
// 真實 AS-01 結果, 直接 render `results` state, 冇 fallback mock。

const SIDEBAR_ITEMS = [
  { key: 'as-01', id: 'AS-01', name: '板塊龍頭股', icon: <ThunderboltOutlined />, implemented: true },
  { key: 'as-02', id: 'AS-02', name: '公司質素分析', icon: <ExperimentOutlined />, implemented: true },
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
// 大少指定 (2026-07-23): UI 板塊選項只顯示 top 50, search 用全部 275, 最多選 30 個
const MAX_PLATES = 30
const DEFAULT_TOP_N_LIMIT = 50

// Helper: 將 API 返嘅 plate dict 轉 Select option 格式
// 格式: "#1 其他金属及矿物 (29)" — rank + name + stock_count 令 user 一眼睇到
function toPlateOption(p: {
  plate_code: string
  plate_name: string
  popularity_rank: number | null
  stock_count: number
}) {
  const rank = p.popularity_rank != null ? `#${p.popularity_rank}` : '#?'
  return {
    value: p.plate_code,
    label: `${rank} ${p.plate_name} (${p.stock_count})`,
  }
}

// Helper: Format market cap 為 億/萬億 中文 (大少 SPEC: "市值 top 1 (4500億)")
// 同 backend `models/plate.py` 入面嘅 format_mcap 一致, frontend 都要
// 顯示 (因為 backend 個 response 冇 formatted field, 係 raw number)。
// 大少 2026-07-23 12:23 instruction: 0 / negative / NaN 返 "—" 避免
// Vite HMR stale state 個 stock.mcap=0 個 case 顯示 0 個誤導數值
function formatMcap(mcap: number): string {
  if (mcap === null || mcap === undefined || isNaN(mcap) || mcap <= 0) return '—'
  if (mcap >= 1e12) return `${(mcap / 1e12).toFixed(1)}萬億`
  if (mcap >= 1e8) return `${Math.round(mcap / 1e8)}億`
  if (mcap >= 1e4) return `${Math.round(mcap / 1e4)}萬`
  return `${Math.round(mcap)}`
}

// Helper: Format turnover 為 億/萬 簡單格式
// 大少 2026-07-23 12:23: 0 / negative / NaN 返 "—" 同上
function formatTurnover(turnover: number): string {
  if (turnover === null || turnover === undefined || isNaN(turnover) || turnover <= 0) return '—'
  if (turnover >= 1e8) return `${(turnover / 1e8).toFixed(1)}億`
  if (turnover >= 1e4) return `${(turnover / 1e4).toFixed(0)}萬`
  return `${turnover.toFixed(0)}`
}

// Helper: Normalize 一個 stock object — 大少 2026-07-23 12:01 instruction (Option C - A)
// 確保每個 field 都係正確 type (numbers default 0, strings default '')
// handleExecute (setResults 之前) 同 render (displayedResults.map 入面) 兩重 normalize
// 防 Vite HMR stale state 個 issue (舊 mock data string 喺 state 入面)
function normalizeStock(s: any) {
  return {
    code: String(s.code || ''),
    name: String(s.name || ''),
    price: Number(s.price) || 0,
    change_pct: Number(s.change_pct) || 0,
    mcap: Number(s.mcap) || 0,
    turnover: Number(s.turnover) || 0,
    plate_code: String(s.plate_code || ''),
    plate_name: String(s.plate_name || ''),  // 大少 2026-07-24 新加 — 顯示「板塊來源」column
    score: Number(s.score) || 0,
    mcap_rank: Number(s.mcap_rank) || 0,
    volume_rank: Number(s.volume_rank) || 0,
    reason: String(s.reason || ''),
  }
}

// ============================================================================
// ErrorBoundary — React 18 必須係 class component (暫時仲未出 hook 版本)
// 大少 2026-07-23 12:01 instruction (Option C - B): 任何 render error catch,
// 顯示 fallback UI 而唔 unmount 整棵 tree (即係全畫面黑色 issue 完全解決)
// ============================================================================
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; errorMessage: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, errorMessage: '' }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMessage: error.message }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log 喺 console, 等 dev 見到 stack trace
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24 }}>
          <Text strong>❌ 渲染出錯</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {this.state.errorMessage}
          </Text>
          <br />
          <Button
            size="small"
            style={{ marginTop: 12 }}
            onClick={() => this.setState({ hasError: false, errorMessage: '' })}
          >
            重試
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}

function AS01Panel() {
  // 大少 2026-07-24 Tier 1.3: Refactored to use custom hooks + sub-components
  // Old monolithic (~400 lines) → clean modular (~80 lines)

  const inner = useDragResize({
    initial: 380,
    min: 240,
    max: 500,
    storageKey: 'main-algorithms-inner-width',
  });

  // Custom hooks (Tier 1.3 modular architecture)
  const {
    plates, platesLoading, searching,
    includeNonStock, setIncludeNonStock,
    handleSearch,
    // 大少 2026-07-26 08:36: 一鍵還原 props
    isDefault, restoring, restoreDefault,
  } = usePlates();

  const {
    results, loading, hasRun, lastError, rankedAt,
    handleExecute,
  } = useExecuteAlgorithm();

  const {
    status, refreshing, handleRefresh,
  } = usePopularityStatus();

  // Local state (specific to this panel)
  const [selectedPlates, setSelectedPlates] = useState<string[]>([]);
  const [topN, setTopN] = useState<number>(10);
  // 大少 2026-07-27: Collapsed description (V2 簡化版，預設摺埋)
  const [showDescription, setShowDescription] = useState<boolean>(false);
  // 大少 2026-07-27 09:38 bug 3 fix: lift state 接收 selectedCodes 從 ResultGrid
  const [pendingSelectedCodes, setPendingSelectedCodes] = useState<Set<string> | null>(null);
  // 大少 2026-07-26 #7530 🥇: 抽 useSaveRunFlow hook 出 page (4 inline handlers → 1 hook call)
  const saveFlow = useSaveRunFlow({
    algorithmId: 'AS-01',
    algorithmName: '板塊龍頭股',
    results,
    selectedPlates,
    topN,
    rankedAt,
    selectedCodes: pendingSelectedCodes,
  });

  return (
    <div className={styles.twoPanel} style={{ gridTemplateColumns: `${inner.width}px 1fr` }}>
      {/* LEFT: Filter */}
      <Card title="⚙️ 設定" className={styles.leftPanel}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {/* 大少 2026-07-27: Collapsed algorithm description (V2) */}
          <div className={styles.descriptionBox}>
            <div
              className={styles.descriptionHeader}
              onClick={() => setShowDescription(!showDescription)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setShowDescription(!showDescription); }}
              title="點擊展開 / 摺埋"
            >
              <span>📖 點解用呢個？</span>
              <span className={styles.descriptionToggle}>{showDescription ? '⌃' : '⌄'}</span>
            </div>
            {showDescription && (
              <div className={styles.descriptionBody}>
                {ALGORITHM_DESCRIPTIONS['AS-01']}
              </div>
            )}
          </div>

          {/* Popularity status + refresh button + non-stock toggle */}
          <div className={styles.statusRow}>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={refreshing}
              onClick={handleRefresh}
              title="重新計算所有板塊的 popularity (背景跑 ~15 min)"
            >
              🔄 重新計算
            </Button>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {status ? (
                <>{status.ranked}/{status.total} ranked</>
              ) : (
                '載入中...'
              )}
            </Text>
            <NonStockToggle checked={includeNonStock} onChange={setIncludeNonStock} />
          </div>

          <PlateSelector
            plates={plates}
            loading={platesLoading}
            searching={searching}
            selectedPlates={selectedPlates}
            onChange={setSelectedPlates}
            onSearch={handleSearch}
            // 大少 2026-07-26 08:36: 一鍵還原 props
            isDefault={isDefault}
            restoring={restoring}
            restoreDefault={restoreDefault}
          />

          <Button
            type="primary"
            size="large"
            icon={<SearchOutlined />}
            loading={loading}
            onClick={() => handleExecute(selectedPlates, topN)}
            block
          >
            🔍 執行
          </Button>

          <div>
            <Text strong>🔢 取頭 N 位</Text>
            <InputNumber
              min={1}
              max={50}
              value={topN}
              onChange={(v) => setTopN(v ?? 10)}
              className={styles.fullWidth}
            />
            <Text type="secondary" className={styles.hint}>
              範圍 1-50，預設 10
            </Text>
          </div>
        </Space>
        <div
          className={`${styles.resizeHandle} ${inner.dragging ? styles.resizeHandleActive : ''}`}
          onMouseDown={inner.handleMouseDown}
          title="拖拽改 filter 闊度"
        />
      </Card>

      {/* RIGHT: Results */}
      <ResultGrid
        leaders={results}
        loading={loading}
        hasRun={hasRun}
        errorMessage={lastError}
        // 大少 2026-07-26 #7493 + #7530: save props from useSaveRunFlow hook
        canSave={hasRun && results.length > 0 && !loading}
        // 大少 2026-07-27 09:38 bug 3 fix: 接收 selectedCodes 從 ResultGrid
        onSave={(codes) => {
          setPendingSelectedCodes(codes);
          saveFlow.show();
        }}
        saving={saveFlow.saving}
      />

      {/* 大少 2026-07-26 #7493 + #7530: Save Run modal (state/handlers from useSaveRunFlow) */}
      {/* 大少 2026-07-27 09:44 confirm Option A: SaveRunModal 預覽 show selected stocks */}
      <SaveRunModal
        open={saveFlow.open}
        algorithmName="板塊龍頭股"
        stockCount={saveFlow.filteredResults.length}
        stockCodes={saveFlow.filteredResults.map((l) => l.code)}
        rankedAt={rankedAt}
        saving={saveFlow.saving}
        onSave={saveFlow.confirmSave}
        onCancel={saveFlow.hide}
      />
    </div>
  );
}

// ============== AS-02 Panel (大少 2026-08-01 Phase 5) ==============
function AS02Panel() {
  const inner = useDragResize({
    initial: 380,
    min: 240,
    max: 500,
    storageKey: 'main-algorithms-as02-inner-width',
  });

  const [stockInput, setStockInput] = useState<string>('');
  const [showDescription, setShowDescription] = useState<boolean>(false);
  const [pendingSelectedCodes, setPendingSelectedCodes] = useState<Set<string> | null>(null);

  const {
    qualifiedResults,
    disqualifiedResults,
    loading,
    hasRun,
    lastError,
    rankedAt,
    handleExecute,
  } = useExecuteAS02();

  const saveFlow = useSaveRunFlow({
    algorithmId: 'AS-02',
    algorithmName: '公司質素分析',
    results: qualifiedResults,
    selectedPlates: [],
    topN: 0,
    rankedAt,
    selectedCodes: pendingSelectedCodes,
  });

  // Parse stock codes (comma/space/newline separated)
  const parsedCodes = stockInput
    .split(/[\s,;\n]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);

  const handleRun = () => {
    if (parsedCodes.length === 0) {
      message.warning('請輸入至少 1 隻 stock code (e.g. HK.00981)');
      return;
    }
    handleExecute(parsedCodes);
  };

  return (
    <div className={styles.twoPanel} style={{ gridTemplateColumns: `${inner.width}px 1fr` }}>
      {/* LEFT: Filter */}
      <Card title="⚙️ 設定" className={styles.leftPanel}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {/* Description (collapsible, V2 簡化) */}
          <div className={styles.descriptionBox}>
            <div
              className={styles.descriptionHeader}
              onClick={() => setShowDescription(!showDescription)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setShowDescription(!showDescription); }}
              title="點擊展開 / 摺埋"
            >
              <span>📖 點解用呢個？</span>
              <span className={styles.descriptionToggle}>{showDescription ? '⌃' : '⌄'}</span>
            </div>
            {showDescription && (
              <div className={styles.descriptionBody}>
                {`AS-02 公司質素分析 — 根據 6 個 weighted dimensions (財務 30% / 業務 20% / 管理 15% / 行業 15% / 估值 10% / 風險 10%) + 8 個硬性 DQ triggers (ROE < 0% 連續 2 年 / Debt > 100% / Beta > 2.5 / OCF 連續負數 / ESG CCC / 重大訴訟 等) 評估股票。輸入 1-10 隻 stock codes, LLM (MiniMax M3) 分析返中文 result。`}
              </div>
            )}
          </div>

          {/* Stock codes input */}
          <div>
            <Text strong>📋 Stock Codes</Text>
            <Input.TextArea
              rows={4}
              value={stockInput}
              onChange={(e) => setStockInput(e.target.value)}
              placeholder="HK.00981, HK.01347, HK.07709 ..."
              className={styles.fullWidth}
              style={{ fontFamily: 'monospace' }}
            />
            <Text type="secondary" className={styles.hint}>
              已輸入 <Text strong>{parsedCodes.length}</Text> / 10 隻 · 格式 <code>HK.XXXXX</code>
              · 用逗號 / 空格 / 換行分隔
            </Text>
          </div>

          {/* Quick presets */}
          <div>
            <Text strong>⚡ 快速測試</Text>
            <Space wrap>
              <Button
                size="small"
                onClick={() => setStockInput('HK.00981, HK.01347, HK.07709, HK.09988, HK.00700')}
              >
                5 隻半導體+互聯網
              </Button>
              <Button
                size="small"
                onClick={() => setStockInput('')}
              >
                清空
              </Button>
            </Space>
          </div>

          {/* Execute button */}
          <Button
            type="primary"
            size="large"
            icon={<SearchOutlined />}
            loading={loading}
            onClick={handleRun}
            block
            disabled={parsedCodes.length === 0}
          >
            🔍 執行 ({parsedCodes.length})
          </Button>
        </Space>
        <div
          className={`${styles.resizeHandle} ${inner.dragging ? styles.resizeHandleActive : ''}`}
          onMouseDown={inner.handleMouseDown}
          title="拖拽改 filter 闊度"
        />
      </Card>

      {/* RIGHT: Results */}
      <AS02ResultPanel
        qualifiedStocks={qualifiedResults}
        disqualifiedStocks={disqualifiedResults}
        loading={loading}
        hasRun={hasRun}
        errorMessage={lastError}
        rankedAt={rankedAt}
        canSave={hasRun && qualifiedResults.length > 0 && !loading}
        saving={saveFlow.saving}
        onSave={(codes) => {
          setPendingSelectedCodes(codes);
          saveFlow.show();
        }}
      />

      {/* Save Run Modal (useSaveRunFlow state) */}
      <SaveRunModal
        open={saveFlow.open}
        algorithmName="公司質素分析"
        stockCount={saveFlow.filteredResults.length}
        stockCodes={saveFlow.filteredResults.map((s) => s.code)}
        rankedAt={rankedAt}
        saving={saveFlow.saving}
        onSave={saveFlow.confirmSave}
        onCancel={saveFlow.hide}
      />
    </div>
  );
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
            {/* 大少 2026-07-23 12:01 instruction (Option C - B): 包 ErrorBoundary 防黑畫面 */}
            <ErrorBoundary>
              {activeKey === 'as-01' && <AS01Panel />}
              {activeKey === 'as-02' && <AS02Panel />}
            </ErrorBoundary>
            {(activeKey !== 'as-01' && activeKey !== 'as-02') && activeItem && (
              <NotImplementedPlaceholder algorithmId={activeItem.id} />
            )}
          </main>
        </div>
      </div>
    </AppLayout>
  )
}
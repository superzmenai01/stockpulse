// components/debug/DebugPanel.tsx — Debug toggle button + drawer (大少 2026-07-24 Debug Panel)
// 大少 2026-07-24 12:48 enhancement:
// 1. 每個 Step 加中文註解 (從 STEP_DESCRIPTIONS map 顯示)
// 2. Detail Mode toggle (Switch ON = 顯示 kept/dropped/dropped_by_reason stock list)
//
// UX:
// - Button: 🐛 Debug (top-right of AppLayout header), badge shows run count
// - Click → Drawer slides in from right (Antd Drawer)
// - Drawer 內容:
//   1. Popularity status bar (live polling 5s)
//   2. Last run steps (collapsible list with 中文 description + Detail Mode toggle)
//   3. Refresh button

import { useState } from 'react';
import { Drawer, Button, Badge, Progress, Space, Typography, Tag, Empty, Spin, Switch, Divider } from 'antd';
import { BugOutlined, ReloadOutlined, ClockCircleOutlined, CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import { useDebugContext, type DebugStep } from '../../hooks/useDebugContext';
import styles from './DebugPanel.module.css';

const { Text } = Typography;

const STATE_ICON: Record<string, JSX.Element> = {
  idle: <ClockCircleOutlined />,
  running: <LoadingOutlined spin />,
  completed: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
  failed: <CloseCircleOutlined style={{ color: '#ff4d4f' }} />,
};

const STATE_COLOR: Record<string, string> = {
  idle: 'default',
  running: 'processing',
  completed: 'success',
  failed: 'error',
};

// 大少 2026-07-24 12:48 — 中文註解 mapping (對應 backend helpers 嘅 [STEP N] docstring)
const STEP_DESCRIPTIONS: Record<string, string> = {
  run_plate_leaders_start: '🚀 開始執行 AS-01 ranking',
  rank_one_plate_start: '📊 開始處理單一板塊',
  rank_one_plate_empty: '⚠️ 板塊無有效 stocks (early return)',
  resolve_plate_stocks_start: '🔍 攞取板塊股票列表 (OpenD get_plate_stock)',
  resolve_plate_stocks_end: '✅ 股票列表攞齊',
  resolve_plate_stocks_failed: '❌ 攞股票列表失敗 (OpenD 拒絕)',
  resolve_plate_stocks_exception: '❌ 攞股票列表 exception',
  filter_etf_structured: '🚫 過濾 ETF / 結構性產品 / U版 / R版',
  lookup_plate_name_start: '🏷️ 攞中文板塊名 (DB)',
  lookup_plate_name_end: '✅ 中文板塊名搵到',
  lookup_plate_name_exception: '❌ 搵中文板塊名 exception',
  fetch_snapshots_start: '📡 開始攞報價 (OpenD get_market_snapshot batch)',
  fetch_snapshots_end: '✅ 報價攞齊',
  filter_valid_stocks_start: '🔬 開始過濾無效 stocks',
  filter_valid_stocks_end: '✅ 過濾完成 (有效 stocks 留低)',
  rank_and_score_start: '🏆 開始計排名分數 (mcap_rank + volume_rank)',
  rank_and_score_end: '✅ 排名計好',
  generate_reason: '📝 生成原因字串',
};

function getStepDescription(stepName: string): string {
  return STEP_DESCRIPTIONS[stepName] ?? stepName;
}

// 大少 2026-07-24 12:48 — Detail Mode stock list display
function StockList({ title, stocks, color }: { title: string; stocks: Array<{ code: string; name?: string; reason?: string; [k: string]: unknown }>; color: string }) {
  if (!stocks || stocks.length === 0) {
    return (
      <div className={styles.stockGroup}>
        <Text strong style={{ color }}>{title}</Text>
        <Text type="secondary" className={styles.emptyHint}>(空)</Text>
      </div>
    );
  }
  return (
    <div className={styles.stockGroup}>
      <Text strong style={{ color }}>
        {title} ({stocks.length})
      </Text>
      <div className={styles.stockRows}>
        {stocks.map((s, idx) => (
          <div key={`${s.code}-${idx}`} className={styles.stockRow}>
            <Text className={styles.stockCode}>{s.code}</Text>
            {s.name !== undefined && <Text className={styles.stockName}>{String(s.name)}</Text>}
            {s.reason !== undefined && <Text type="secondary" className={styles.stockReason}>{String(s.reason)}</Text>}
          </div>
        ))}
      </div>
    </div>
  );
}

// Render step data based on Detail Mode
function StepDataView({ data, detailMode }: { data: Record<string, unknown>; detailMode: boolean }) {
  if (!detailMode) {
    // Summary mode: compact JSON (e.g. {"input_count": 30, "output_count": 17})
    try {
      return <pre className={styles.stepData}>{JSON.stringify(data, null, 2)}</pre>;
    } catch {
      return <pre className={styles.stepData}>{String(data)}</pre>;
    }
  }

  // Detail mode: structured display of stock lists + skip reasons
  const entries: JSX.Element[] = [];

  // Summary fields (input_count, output_count, etc.)
  const summaryKeys = Object.keys(data).filter(
    (k) => !['kept', 'dropped', 'dropped_by_reason', 'failed_codes', 'stocks', 'missing_count'].includes(k),
  );
  if (summaryKeys.length > 0) {
    const summary = summaryKeys.reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = data[k];
      return acc;
    }, {});
    entries.push(
      <div key="summary" className={styles.detailSummary}>
        <Text type="secondary" className={styles.detailLabel}>📋 Summary</Text>
        <pre className={styles.stepData}>{JSON.stringify(summary, null, 2)}</pre>
      </div>,
    );
  }

  // Kept stocks
  if (Array.isArray(data.kept)) {
    entries.push(<StockList key="kept" title="✅ Kept (保留)" stocks={data.kept as Array<{ code: string; name?: string }>} color="#52c41a" />);
  }

  // Dropped stocks (single list, with dropped_reason)
  if (Array.isArray(data.dropped)) {
    const reason = (data.dropped_reason as string) ?? '踢走原因';
    entries.push(
      <StockList
        key="dropped"
        title={`❌ Dropped (踢走) — ${reason}`}
        stocks={data.dropped as Array<{ code: string }>}
        color="#ff4d4f"
      />,
    );
  }

  // Failed codes (snapshots missing)
  if (Array.isArray(data.failed_codes)) {
    entries.push(
      <StockList
        key="failed_codes"
        title={`❌ Failed Codes (報價攞唔到)`}
        stocks={data.failed_codes.map((c) => ({ code: String(c) }))}
        color="#ff4d4f"
      />,
    );
  }

  // dropped_by_reason (per-reason breakdown)
  const droppedByReason = data.dropped_by_reason;
  if (droppedByReason && typeof droppedByReason === 'object' && !Array.isArray(droppedByReason)) {
    const reasonMap: Record<string, string> = {
      no_snapshot: 'OpenD 返唔到報價',
      suspended: '停牌股',
      mcap_invalid: 'mcap NaN 或 ≤ 0 (ETF/新股)',
      turnover_invalid: 'turnover NaN',
    };
    Object.entries(droppedByReason).forEach(([reasonKey, stocks]) => {
      if (Array.isArray(stocks) && stocks.length > 0) {
        const reasonText = reasonMap[reasonKey] ?? reasonKey;
        entries.push(
          <StockList
            key={`reason-${reasonKey}`}
            title={`❌ ${reasonText} (${reasonKey})`}
            stocks={stocks as Array<{ code: string; name?: string; reason?: string }>}
            color="#ff7a45"
          />,
        );
      }
    });
  }

  // Stocks list (single, e.g. resolve_plate_stocks_end)
  if (Array.isArray(data.stocks)) {
    entries.push(
      <StockList
        key="stocks"
        title={`📦 All Stocks (${data.stocks.length})`}
        stocks={(data.stocks as string[]).map((c) => ({ code: c }))}
        color="#1890ff"
      />,
    );
  }

  if (entries.length === 0) {
    return <pre className={styles.stepData}>(no detail data)</pre>;
  }

  return <div className={styles.detailView}>{entries}</div>;
}

function StepRow({ step, detailMode }: { step: DebugStep; detailMode: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const hasData = Object.keys(step.data).length > 0;
  const description = getStepDescription(step.step);
  return (
    <div className={styles.step}>
      <div
        className={styles.stepHeader}
        onClick={() => hasData && setExpanded(!expanded)}
        style={{ cursor: hasData ? 'pointer' : 'default' }}
      >
        <Text type="secondary" className={styles.stepElapsed}>
          {step.elapsed_ms.toFixed(1)}ms
        </Text>
        <div className={styles.stepInfo}>
          <Text strong className={styles.stepName}>
            {description}
          </Text>
          <Text type="secondary" className={styles.stepKey}>
            {step.step}
          </Text>
        </div>
        {hasData && (
          <Text type="secondary" className={styles.stepToggle}>
            {expanded ? '▼' : '▶'}
          </Text>
        )}
      </div>
      {expanded && hasData && (
        <div className={styles.stepDataWrapper}>
          <StepDataView data={step.data} detailMode={detailMode} />
        </div>
      )}
    </div>
  );
}

export default function DebugPanel() {
  const [open, setOpen] = useState(false);
  const [detailMode, setDetailMode] = useState(false);
  const { lastRun, status, loading, error, refresh, enabled, toggle } = useDebugContext();

  const popStatus = status?.popularity;
  const popState = popStatus?.state ?? 'idle';
  const popProgress = popStatus && popStatus.total > 0
    ? Math.round((popStatus.completed / popStatus.total) * 100)
    : 0;
  const runsCount = status?.runs_count ?? 0;

  return (
    <>
      <Badge count={runsCount} size="small" offset={[-4, 4]} color={enabled ? '#52c41a' : '#999'}>
        <Button
          type={enabled ? 'primary' : 'default'}
          icon={<BugOutlined />}
          onClick={() => {
            toggle();
            setOpen(true);
          }}
          size="small"
        >
          🐛 Debug
        </Button>
      </Badge>

      <Drawer
        title={
          <Space>
            <BugOutlined />
            <span>Debug Panel</span>
            {error && <Tag color="error">⚠️ {error}</Tag>}
          </Space>
        }
        placement="right"
        width={560}
        open={open}
        onClose={() => setOpen(false)}
        extra={
          <Button
            icon={<ReloadOutlined spin={loading} />}
            onClick={refresh}
            loading={loading}
            size="small"
          >
            Refresh
          </Button>
        }
      >
        {/* Section 1: Popularity status */}
        <div className={styles.section}>
          <Text strong>📊 Popularity Job Status</Text>
          <div className={styles.statusCard}>
            <Space size="small">
              {STATE_ICON[popState]}
              <Tag color={STATE_COLOR[popState]}>{popState}</Tag>
              {popStatus?.metric && <Tag>metric: {popStatus.metric}</Tag>}
            </Space>
            {popStatus?.total ? (
              <>
                <Progress
                  percent={popProgress}
                  size="small"
                  status={popState === 'failed' ? 'exception' : popState === 'completed' ? 'success' : 'active'}
                  format={() => `${popStatus.completed}/${popStatus.total}`}
                />
                {popStatus.current_plate && (
                  <Text type="secondary" className={styles.currentPlate}>
                    Current: {popStatus.current_plate}
                  </Text>
                )}
                {popStatus.started_at && (
                  <Text type="secondary" className={styles.timing}>
                    Started: {popStatus.started_at}
                  </Text>
                )}
                {popStatus.error && (
                  <Text type="danger">Error: {popStatus.error}</Text>
                )}
              </>
            ) : (
              <Empty description="No popularity job data" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </div>
        </div>

        <Divider />

        {/* Section 2: Last run steps + Detail Mode toggle */}
        <div className={styles.section}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space>
              <Text strong>🔬 Last Run Steps</Text>
              {lastRun && (
                <Tag>
                  {lastRun.run_id.slice(-6)} · {lastRun.duration_ms?.toFixed(0)}ms · {lastRun.steps.length} steps
                </Tag>
              )}
            </Space>
            <Space size="small">
              <Text type="secondary" style={{ fontSize: 12 }}>Detail Mode</Text>
              <Switch
                size="small"
                checked={detailMode}
                onChange={setDetailMode}
                checkedChildren="ON"
                unCheckedChildren="OFF"
              />
            </Space>
          </Space>
          {lastRun ? (
            <div className={styles.stepsList}>
              {lastRun.steps.map((s, idx) => (
                <StepRow key={`${s.step}-${idx}`} step={s} detailMode={detailMode} />
              ))}
            </div>
          ) : (
            <Spin spinning={loading}>
              <Empty
                description={error ? `Error: ${error}` : '未執行過任何 run。試下喺 StockPulse UI execute AS-01 algorithm。'}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            </Spin>
          )}
        </div>
      </Drawer>
    </>
  );
}
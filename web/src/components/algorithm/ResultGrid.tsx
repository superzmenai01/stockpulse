// components/algorithm/ResultGrid.tsx — 8-column results grid
// 大少 2026-07-24 Tier 1.3: Frontend modular refactor
// 大少 2026-07-27: 加 checkbox column + 全選 (useStockSelection hook)

import React, { useState, useMemo } from 'react';
import { Card, Modal, Spin, Empty, Typography, Space, Tag, Tooltip, Button, Checkbox } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { Leader } from '../../types/algorithm';
import { useStockSelection } from '../../hooks/useStockSelection';
import { formatMcap, formatTurnover } from '../../utils/formatters';
import ChartContainer from '../chart/ChartContainer';
import styles from './ResultGrid.module.css';

const { Text } = Typography;

interface ResultGridProps {
  leaders: Leader[];
  loading: boolean;
  hasRun: boolean;
  errorMessage?: string | null;
  // 大少 2026-07-26 #7493: 儲存結果 button props
  canSave?: boolean;
  onSave?: () => void;
  saving?: boolean;
}

function normalizeStock(s: Leader): Leader {
  // Re-normalize on each render to avoid Vite HMR stale state issues
  return {
    code: String(s.code || ''),
    name: String(s.name || ''),
    price: Number(s.price) || 0,
    change_pct: Number(s.change_pct) || 0,
    mcap: Number(s.mcap) || 0,
    turnover: Number(s.turnover) || 0,
    plate_code: String(s.plate_code || ''),
    plate_name: String(s.plate_name || ''),
    score: Number(s.score) || 0,
    mcap_rank: Number(s.mcap_rank) || 0,
    volume_rank: Number(s.volume_rank) || 0,
    reason: String(s.reason || ''),
  };
}

export default function ResultGrid({ leaders, loading, hasRun, errorMessage, canSave, onSave, saving }: ResultGridProps) {
  const displayedLeaders = leaders.map(normalizeStock);

  // 大少 #7694 #7754: 點擊股票出 K 線圖表
  const [selectedStock, setSelectedStock] = useState<{ code: string; name: string } | null>(null);
  const [chartModalOpen, setChartModalOpen] = useState(false);

  const handleStockClick = (stock: Leader) => {
    setSelectedStock({ code: stock.code, name: stock.name });
    setChartModalOpen(true);
  };

  const handleCloseChart = () => {
    setChartModalOpen(false);
    setSelectedStock(null);
  };

  // 大少 2026-07-27: checkbox 選 stocks (為將來 AS-02 輸入預備)
  // 預設全部 selected, 兩 states (大少 reject 咗 indeterminate)
  // 與 ViewRunModal 共用 useStockSelection hook
  // 09:21 fix: useMemo codes 穩定 reference, 避免 useCallback 每次 render rebuild
  const stockCodes = useMemo(() => displayedLeaders.map(s => s.code), [displayedLeaders]);
  const { selectedCodes, allSelected, toggle, toggleAll } = useStockSelection(stockCodes);

  return (
    <>
    <Card
      title={
        <Space>
          <span>📊 結果</span>
          {hasRun && !loading && (
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
              （共 {displayedLeaders.length} 隻）
            </Text>
          )}
        </Space>
      }
      className={styles.rightPanel}
      extra={
        // 大少 2026-07-26 #7493: 儲存結果 button 連住 SaveRunModal
        <Tooltip title={canSave ? '儲存到 Library page' : '請先執行 AS-01 算法先可以儲存'}>
          <Button
            icon={<SaveOutlined />}
            size="small"
            disabled={!canSave}
            loading={saving}
            onClick={onSave}
          >
            💾 儲存結果
          </Button>
        </Tooltip>
      }
    >
      {loading ? (
        <div className={styles.center}>
          <Spin size="large" />
          <Text type="secondary" style={{ marginTop: 12, display: 'block' }}>
            正在執行 composite ranking (AS-01 板塊龍頭股) ...
          </Text>
        </div>
      ) : !hasRun ? (
        <Empty description="未有結果，請選板塊按執行" />
      ) : displayedLeaders.length === 0 ? (
        <Empty description={errorMessage || "冇符合條件嘅股票 (可能全部停牌或 mcap=0)"} />
      ) : (
        <div className={styles.resultsGrid}>
          <div className={styles.gridHeader}>
            <span className={styles.checkboxCell}>
              <Checkbox
                checked={allSelected}
                onChange={toggleAll}
                aria-label="全選"
              />
            </span>
            <span>排名</span>
            <span>代碼</span>
            <span className={styles.alignRight}>現價</span>
            <span className={styles.alignRight}>市值</span>
            <span className={styles.alignRight}>換手率</span>
          </div>
          {displayedLeaders.map((stock, idx) => (
            <div
              key={stock.code}
              className={styles.gridRow}
              onClick={() => handleStockClick(stock)}
            >
              <span
                className={styles.checkboxCell}
                // 唔好 trigger row click 開 K 線圖
                onClick={(e) => e.stopPropagation()}
              >
                <Checkbox
                  checked={selectedCodes.has(stock.code)}
                  onChange={() => toggle(stock.code)}
                />
              </span>
              <span className={styles.rankCell}>#{idx + 1}</span>
              {/* 大少 2026-07-26 09:00: 代碼格 vertical stack: 代碼 → 名稱 → 板塊來源 → (最好是原因) */}
              <span className={styles.codeCell} title={stock.code}>
                <Text className={styles.codeMain}>{stock.code}</Text>
                <Text className={styles.nameMain}>{stock.name}</Text>
                <Text className={styles.plateMain} title={stock.plate_code}>
                  {stock.plate_name || stock.plate_code}
                </Text>
                {stock.reason && (
                  <Text type="secondary" className={styles.reasonMain}>
                    {stock.reason}
                  </Text>
                )}
              </span>
              <span className={`${styles.price} ${styles.alignRight}`} style={{ color: 'rgba(255, 255, 255, 0.88)' }}>
                {stock.price > 0 ? stock.price.toFixed(2) : '—'}
              </span>
              <span className={`${styles.muted} ${styles.alignRight}`} style={{ color: 'rgba(255, 255, 255, 0.85)' }}>
                {formatMcap(stock.mcap)}
              </span>
              <span className={`${styles.muted} ${styles.alignRight}`} style={{ color: 'rgba(255, 255, 255, 0.85)' }}>
                {formatTurnover(stock.turnover)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>

    {/* 大少 #7694 #7754: 點擊股票出 K 線圖表 (獨立 Modal) */}
    <Modal
      open={chartModalOpen}
      onCancel={handleCloseChart}
      title={selectedStock?.name || ''}
      width={900}
      footer={null}
      className={styles.modal}
      styles={{ body: { padding: 0, height: 500 } }}
    >
      {selectedStock && (
        <div className={styles.content}>
          <ChartContainer stock={selectedStock} />
        </div>
      )}
    </Modal>
    </>
  );
}
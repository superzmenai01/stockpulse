// components/library/ViewRunModal.tsx — View saved run detail modal (大少 2026-07-26 #7558 + #7566)
//
// Updated per 大少 修正 (#7566):
// - Metadata collapsed (click to expand) instead of always visible
// - Stocks list: detailed AntD Table (same fields as ResultGrid) instead of comma-joined codes
//
// Pattern: 同 EditRunModal/SaveRunModal 一樣 (Modal + 顯示 SavedRun data + onCancel callback).
// Triggered by LibraryPage row click.

import React, { useMemo, useState } from 'react';
import {
  Modal,
  Tag,
  Space,
  Typography,
  Descriptions,
  Button,
  Tooltip,
  Table,
  Collapse,
  Checkbox,
} from 'antd';
import {
  ExperimentOutlined,
  CloseOutlined,
  CaretRightOutlined,
} from '@ant-design/icons';
import { SavedRun } from '../../hooks/useSavedRuns';
import type { SavedStock } from '../../types/algorithm';
import { formatMcap, formatTurnover } from '../../utils/formatters';
import ChartContainer from '../chart/ChartContainer';
import styles from './ViewRunModal.module.css';

const { Text, Paragraph } = Typography;

interface ViewRunModalProps {
  run: SavedRun;
  onCancel: () => void;
  /**
   * 大少 #7558 future feature —「將 saved stocks 作 input 行其他演算法」。
   * 而家保留 stub，按鈕 disabled。等 AS-02/03/04 實裝時 enable + 連去對應 algorithm page。
   */
  onUseAsInput?: (run: SavedRun) => void;
  /**
   * 大少 2026-07-27 checkbox UI 預備料 — 將來 AS-02/03/04 落地時接收 selected stocks。
   * 而家**唔 connect**到任何 logic (底 button 留 disabled)。
   */
  onSelectionChange?: (selectedCodes: Set<string>) => void;
}

// Helper: format price (defensive for 0 / NaN, like ResultGrid)
function formatPrice(p: number): string {
  return p > 0 ? p.toFixed(2) : '—';
}

// Helper: format change % with sign
function formatChange(c: number): string {
  if (c === 0) return '0.00%';
  return `${c > 0 ? '+' : ''}${c.toFixed(2)}%`;
}

// Helper: change % color (same as ResultGrid aesthetic)
function changeColor(c: number): string {
  if (c > 0) return '#34d399'; // green
  if (c < 0) return '#f87171'; // red
  return 'rgba(255, 255, 255, 0.45)';
}

type SavedStockWithIdx = SavedStock & { idx: number };

function ViewRunModal({ run, onCancel, onUseAsInput, onSelectionChange }: ViewRunModalProps) {
  const metadata = run.metadata || {};
  const hasMetadata = Object.keys(metadata).length > 0;
  const savedStocks: SavedStock[] = run.saved_stocks || [];

  // Chart modal state (大少 #7694: 點擊股票出 K 線圖表)
  const [selectedStock, setSelectedStock] = useState<{ code: string; name: string } | null>(null);
  const [chartModalOpen, setChartModalOpen] = useState(false);

  const handleStockClick = (stock: SavedStock) => {
    setSelectedStock({ code: stock.code, name: stock.name });
    setChartModalOpen(true);
  };

  // 大少 2026-07-27: checkbox 選 stocks (為將來 AS-02 輸入預備)
  // 預設全部 selected, 兩 states (大少 reject 咗 indeterminate)
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(
    () => new Set(savedStocks.map(s => s.code))
  );
  const allSelected = savedStocks.length > 0 && selectedCodes.size === savedStocks.length;

  const handleToggle = (code: string) => {
    setSelectedCodes(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      onSelectionChange?.(next);
      return next;
    });
  };

  const handleToggleAll = () => {
    setSelectedCodes(prev => {
      // 用 prev 判斷 (避免 stale closure on allSelected)
      const allCurrentlySelected = prev.size === savedStocks.length && savedStocks.length > 0;
      const next: Set<string> = allCurrentlySelected
        ? new Set() // 全 unselect
        : new Set(savedStocks.map(s => s.code)); // 全 select
      onSelectionChange?.(next);
      return next;
    });
  };

  const handleCloseChart = () => {
    setChartModalOpen(false);
    setSelectedStock(null);
  };

  // Enrich saved stocks with idx for 排名 column
  const stocksWithIdx = useMemo<SavedStockWithIdx[]>(
    () => savedStocks.map((s, idx) => ({ ...s, idx: idx + 1 })),
    [savedStocks],
  );

  return (
    <>
    <Modal
      title={
        <Space>
          <ExperimentOutlined />
          <span>結果詳情 — {run.algorithm_name}</span>
        </Space>
      }
      open
      onCancel={onCancel}
      width={960}
      destroyOnClose
      footer={
        <Space>
          {/* 大少 #7558: 日後實裝「用作輸入去行其他演算法」(cross-algorithm feed) */}
          <Tooltip title="🚧 日後實裝 — 將 saved stocks 作 input 行其他演算法 (大少 #7558)">
            <Button
              icon={<ExperimentOutlined />}
              disabled={!onUseAsInput}
              onClick={() => onUseAsInput?.(run)}
            >
              用作輸入去行其他演算法
            </Button>
          </Tooltip>
          <Button type="primary" icon={<CloseOutlined />} onClick={onCancel}>
            關閉
          </Button>
        </Space>
      }
    >
      {/* Header tags */}
      <Space size="small" wrap style={{ marginBottom: 16 }}>
        <Tag color="blue">#{run.id}</Tag>
        <Tag color="purple">{run.algorithm_name}</Tag>
        <Tag>{savedStocks.length} 隻股票</Tag>
        <Text type="secondary" style={{ fontSize: 12 }}>
          儲存於 {run.saved_at}
        </Text>
        {run.updated_at !== run.saved_at && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            · 更新於 {run.updated_at}
          </Text>
        )}
      </Space>

      {/* Basic info — always visible (大少 #7566) */}
      <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
        <Descriptions.Item label="名稱">{run.name}</Descriptions.Item>
        <Descriptions.Item label="備註">
          {run.note || <Text type="secondary">(無)</Text>}
        </Descriptions.Item>
        <Descriptions.Item label="Algorithm ID">
          <Tag>{run.algorithm_id}</Tag>
        </Descriptions.Item>
      </Descriptions>

      {/* Metadata — collapsed by default (大少 #7566「Metadata可以收埋」) */}
      {hasMetadata && (
        <Collapse
          ghost
          expandIcon={({ isActive }) => (
            <CaretRightOutlined rotate={isActive ? 90 : 0} />
          )}
          style={{ marginBottom: 16 }}
        >
          <Collapse.Panel header={<Text strong>Metadata (click 展開)</Text>} key="meta">
            <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(metadata, null, 2)}
            </pre>
          </Collapse.Panel>
        </Collapse>
      )}

      {/* Stock list — detailed Table (大少 #7566) */}
      <div>
        <Space style={{ marginBottom: 8 }}>
          <Text strong>股票清單</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            (snapshot, 唔可以改)
          </Text>
          <Tag>{savedStocks.length} 隻</Tag>
        </Space>
        {savedStocks.length === 0 ? (
          <Paragraph type="secondary" style={{ fontStyle: 'italic' }}>
            (冇 saved_stocks 數據 — 舊式記錄, 只儲存咗股票代碼, 冇詳細資料)
          </Paragraph>
        ) : (
          <Table
            dataSource={stocksWithIdx}
            rowKey="code"
            pagination={false}
            size="small"
            data-testid="viewrunmodal-stocks-table"
            scroll={{ x: 'max-content' }}
            onRow={(record) => ({
              onClick: () => handleStockClick(record),
              style: { cursor: 'pointer' },
            })}
            columns={[
              {
                title: (
                  <Checkbox
                    checked={allSelected}
                    onChange={handleToggleAll}
                    aria-label="全選"
                  />
                ),
                key: 'select',
                width: 40,
                render: (_: unknown, record: SavedStockWithIdx) => (
                  <Checkbox
                    checked={selectedCodes.has(record.code)}
                    onChange={() => handleToggle(record.code)}
                    // 唔好 trigger row click 開 K 線圖
                    onClick={(e) => e.stopPropagation()}
                  />
                ),
              },
              {
                title: '#',
                dataIndex: 'idx',
                key: 'idx',
                width: 40,
                render: (idx: number) => <Text type="secondary">{idx}</Text>,
              },
              {
                title: '代碼',
                dataIndex: 'code',
                key: 'code',
                width: 140,
                render: (c: string) => (
                  <Text
                    style={{
                      fontFamily: 'SF Mono, Monaco, Consolas, monospace',
                      fontSize: 12,
                    }}
                  >
                    {c}
                  </Text>
                ),
              },
              {
                title: '名稱',
                dataIndex: 'name',
                key: 'name',
                width: 140,
              },
              {
                title: '板塊',
                dataIndex: 'plate_name',
                key: 'plate_name',
                width: 120,
                render: (p: string, stock: SavedStockWithIdx) => (
                  <Tooltip title={stock.plate_code}>
                    <Tag color="purple">{p || stock.plate_code || '—'}</Tag>
                  </Tooltip>
                ),
              },
              {
                title: '現價',
                dataIndex: 'price',
                key: 'price',
                align: 'right',
                width: 90,
                render: (p: number) => formatPrice(p),
              },
              {
                title: '漲跌',
                dataIndex: 'change_pct',
                key: 'change_pct',
                align: 'right',
                width: 90,
                render: (c: number) => (
                  <span style={{ color: changeColor(c), fontWeight: 600 }}>
                    {formatChange(c)}
                  </span>
                ),
              },
              {
                title: '市值',
                dataIndex: 'mcap',
                key: 'mcap',
                align: 'right',
                width: 90,
                render: (m: number) => formatMcap(m),
              },
              {
                title: '換手率',
                dataIndex: 'turnover',
                key: 'turnover',
                align: 'right',
                width: 90,
                render: (t: number) => formatTurnover(t),
              },
              {
                title: '原因',
                dataIndex: 'reason',
                key: 'reason',
                render: (r: string) =>
                  r ? (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {r}
                    </Text>
                  ) : (
                    <Text type="secondary">—</Text>
                  ),
              },
            ]}
          />
        )}
      </div>
    </Modal>

    {/* 大少 #7694: 點擊股票出 K 線圖表 (獨立 Modal，避免 nested AntD Modal 問題) */}
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

export default ViewRunModal;

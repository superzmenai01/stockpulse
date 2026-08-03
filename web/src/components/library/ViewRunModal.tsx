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
  Input,
  Popconfirm,
  App,
  Alert,
} from 'antd';
import {
  ExperimentOutlined,
  CloseOutlined,
  CaretRightOutlined,
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { SavedRun, useSavedRuns } from '../../hooks/useSavedRuns';
import type { SavedStock } from '../../types/algorithm';
import { useStockSelection } from '../../hooks/useStockSelection';
import { formatMcap, formatTurnover } from '../../utils/formatters';
import ChartContainer from '../chart/ChartContainer';
import { ReasonCell } from './ReasonCell';
import styles from './ViewRunModal.module.css';
// 大少 #8918 (2026-07-29): 用 HomePage AddStockModal 嘅 StockSearch 做 search-first UI
//              取代而家 2 個 <Input> (code + name)
import StockSearch from '../stock/StockSearch';
import type { StockSearchResult } from '../../services/stockApi';

const { Text, Paragraph } = Typography;

// 大少 #8807 (2026-07-29): ErrorBoundary — 渲染階段 crash 喺 modal 內頁 inline 顯示錯誤
// 取代空白畫面，避免 "全空白沒有東西也沒有 warning" 嘅 UX 痛點
class ViewRunErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ViewRunModal] render error caught:', error, info);
  }

  render() {
    if (this.state.error) {
      const e = this.state.error;
      return (
        <div style={{ padding: 24 }}>
          <Alert
            type="error"
            showIcon
            message="結果詳情載入失敗"
            description={
              <div>
                <p style={{ marginBottom: 8 }}>{e.message || '(冇錯誤訊息)'}</p>
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer' }}>stack trace</summary>
                  <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', marginTop: 4 }}>
                    {e.stack || '(no stack)'}
                  </pre>
                </details>
              </div>
            }
            data-testid="viewrunmodal-error-alert"
          />
        </div>
      );
    }
    return this.props.children;
  }
}

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
  /**
   * 大少 #8762 (2026-07-29): 結果詳情變 editable — 保存後通知 parent 刷新 list
   */
  onSaved?: (updated: SavedRun) => void;
}

// Helper: format price (defensive for 0 / NaN, like ResultGrid)
function formatPrice(p: number): string {
  return p > 0 ? p.toFixed(2) : '—';
}

type SavedStockWithIdx = SavedStock & { idx: number };

function ViewRunModal({ run, onCancel, onUseAsInput, onSelectionChange, onSaved }: ViewRunModalProps) {
  const { message } = App.useApp();
  const { updateRun } = useSavedRuns();
  const metadata = run.metadata || {};
  const hasMetadata = Object.keys(metadata).length > 0;
  const savedStocks: SavedStock[] = run.saved_stocks || [];

  // 大少 #8762 (2026-07-29): editable stocks — local working copy
  // 初始 = savedStocks; 有 add/remove 即 update; 「保存變更」先 commit 落 backend
  const [editableStocks, setEditableStocks] = useState<SavedStock[]>(savedStocks);
  const [addModalOpen, setAddModalOpen] = useState(false);
  // 大少 #8918 (2026-07-29): spec 用 StockSearch 取代 code/name input,
  //                          原因 default「手動新增」但可手動改
  // 大少 #9867 (2026-08-03): 板塊 input 移除, 只剩原因可改
  const [searchedStock, setSearchedStock] = useState<StockSearchResult | null>(null);
  const [newStockReason, setNewStockReason] = useState('手動新增');
  const [saving, setSaving] = useState(false);

  // 大少 #8918: 重置 Add Modal 內部 state (清 searchedStock + 還原 reason default)
  const resetAddStockModal = () => {
    setSearchedStock(null);
    setNewStockReason('手動新增');
  };

  // dirty flag: 本地 editable 同原始 savedStocks 有冇唔同
  const isDirty = useMemo(() => {
    if (editableStocks.length !== savedStocks.length) return true;
    const origCodes = savedStocks.map(s => s.code).join('|');
    const editCodes = editableStocks.map(s => s.code).join('|');
    return origCodes !== editCodes;
  }, [editableStocks, savedStocks]);

  // Chart modal state (大少 #7694: 點擊股票出 K 線圖表)
  const [selectedStock, setSelectedStock] = useState<{ code: string; name: string } | null>(null);
  const [chartModalOpen, setChartModalOpen] = useState(false);

  const handleStockClick = (stock: SavedStock) => {
    setSelectedStock({ code: stock.code, name: stock.name });
    setChartModalOpen(true);
  };

  // 大少 #8762: 刪除股票 (本地 state — 未 click「保存變更」前唔 commit)
  const handleDeleteStock = (code: string) => {
    setEditableStocks(prev => prev.filter(s => s.code !== code));
  };

  // 大少 #8918 (2026-07-29): refactor — 用 StockSearch 取得 code/name,
  //                           原因用 editable state (default「手動新增」但可改)
  // 大少 #8918 Q3=A: 加入只 setEditableStocks, user 再撳「保存變更」先 PUT
  // 大少 #9867 (2026-08-03): 板塊 input 移除, plate_code/plate_name set empty string
  //                           (Leader 仍 required, 但唔再 user-editable)
  const handleAddStock = () => {
    if (!searchedStock) {
      message.warning('請先喺搜尋 box 揀一隻股票');
      return;
    }
    const code = searchedStock.code;
    const name = searchedStock.name;
    const reason = newStockReason.trim() || '手動新增';
    if (editableStocks.some((s) => s.code === code)) {
      message.warning(`股票 ${code} 已經喺名單入面`);
      return;
    }
    const newStock: SavedStock = {
      code,
      name,
      plate_code: '', // 大少 #9867: 板塊 UI 移除, empty string 保留 type compatibility
      plate_name: '',
      // 冇實時數據 (price / change / mcap / turnover = 0)
      price: 0,
      change_pct: 0,
      mcap: 0,
      turnover: 0,
      reason,
    };
    setEditableStocks((prev) => [...prev, newStock]);
    resetAddStockModal();
    setAddModalOpen(false);
    message.success(`已新增 ${code} ${name}`);
  };

  // 大少 #8762: 保存變更 — PUT saved_stocks 落 backend
  const handleSaveChanges = async () => {
    setSaving(true);
    try {
      const updated = await updateRun(run.id, { saved_stocks: editableStocks });
      message.success(`已保存 ${updated.saved_stocks.length} 隻股票`);
      onSaved?.(updated);
    } catch (e) {
      message.error(`保存失敗：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  // 大少 2026-07-27: checkbox 選 stocks (為將來 AS-02 輸入預備)
  // 大少 #8762: 用 editableStocks (唔再係 savedStocks)
  // 預設全部 selected, 兩 states (大少 reject 咗 indeterminate)
  // 09:21 fix: useMemo codes 穩定 reference, 避免 useCallback 每次 render rebuild
  const stockCodes = useMemo(() => editableStocks.map(s => s.code), [editableStocks]);
  const { selectedCodes, allSelected, toggle, toggleAll } = useStockSelection(
    stockCodes,
    { onChange: onSelectionChange }
  );

  const handleCloseChart = () => {
    setChartModalOpen(false);
    setSelectedStock(null);
  };

  // 大少 #8762: 用 editableStocks 而非 savedStocks
  const stocksWithIdx = useMemo<SavedStockWithIdx[]>(
    () => editableStocks.map((s, idx) => ({ ...s, idx: idx + 1 })),
    [editableStocks],
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
          {/* 大少 #8762 (2026-07-29): 保存變更 button — enabled only when dirty */}
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSaveChanges}
            disabled={!isDirty}
            loading={saving}
            data-testid="viewrunmodal-save-changes-btn"
          >
            保存變更
          </Button>
          <Button icon={<CloseOutlined />} onClick={onCancel}>
            關閉
          </Button>
        </Space>
      }
    >
      {/* 大少 #8807 (2026-07-29): ErrorBoundary 包 render-time errors 入面 */}
      <ViewRunErrorBoundary>
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
        <Space style={{ marginBottom: 8 }} wrap>
          <Text strong>股票清單</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            (可編輯 · click 行 add/remove)
          </Text>
          <Tag>{editableStocks.length} 隻</Tag>
          {isDirty && <Tag color="orange">● 有改動未保存</Tag>}
          {/* 大少 #8762 (2026-07-29): 新增股票 button (內層 modal trigger) */}
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => setAddModalOpen(true)}
            data-testid="viewrunmodal-add-stock-btn"
          >
            新增股票
          </Button>
        </Space>
        {editableStocks.length === 0 ? (
          <Paragraph type="secondary" style={{ fontStyle: 'italic' }}>
            (名單已清空 — 按上面「新增股票」加入)
          </Paragraph>
        ) : (
          <Table
            dataSource={stocksWithIdx}
            rowKey="code"
            pagination={false}
            size="small"
            data-testid="viewrunmodal-stocks-table"
            scroll={{ x: 'max-content' }}
            // 大少 #8885 (2026-07-29): e.target.closest() 跳過 button / Popconfirm trigger,
            // 避免 click 刪除 bubble 上 row 而誤開 chart modal
            onRow={(record) => ({
              onClick: (e) => {
                const target = e.target as HTMLElement;
                if (
                  target.closest('button') ||
                  target.closest('.ant-popconfirm') ||
                  target.closest('.ant-popover') ||
                  target.closest('[data-testid^="viewrunmodal-delete"]')
                ) {
                  return;
                }
                handleStockClick(record);
              },
              style: { cursor: 'pointer' },
            })}
            columns={[
              {
                title: (
                  <Checkbox
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="全選"
                  />
                ),
                key: 'select',
                width: 40,
                render: (_: unknown, record: SavedStockWithIdx) => (
                  <Checkbox
                    checked={selectedCodes.has(record.code)}
                    onChange={() => toggle(record.code)}
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
                title: '現價',
                dataIndex: 'price',
                key: 'price',
                align: 'right',
                width: 90,
                render: (p: number) => formatPrice(p),
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
                width: 220,  // 大少 #9557 (2026-08-02 00:00): Fixed ~20 中文字 闊, 展開後 wrap 落多行唔擴闊
                // 大少 #9494 (2026-08-01): Truncate + onClick expand (方案 A)
                // 用獨立 ReasonCell component (唔可以 inline useState 喺 column.render
                // callback 入面, 違反 React Hooks Rules → AntD Cell2 crash).
                render: (r: string) => <ReasonCell text={r} />,
              },
              {
                // 大少 #8762 (2026-07-29): 操作 column — icon-only 刪除 button (低頻功能, 唔使常見)
                // 大少 #8897 (2026-07-29): 唔做 fixed (跟 table scroll), button 只保留 Icon, 拎走「刪除」文字
                title: '',
                key: 'actions',
                width: 48,
                align: 'center',
                render: (_: unknown, record: SavedStockWithIdx) => (
                  <Tooltip title="刪除呢隻股票">
                    <Popconfirm
                      title="刪除呢隻股票?"
                      description={`${record.code} ${record.name} 會從呢個列表中移除（未保存前僅本地）。`}
                      onConfirm={(e) => {
                        // 大少 #8885: stopPropagation 確保 handleDeleteStock 後唔 bubble
                        e?.stopPropagation?.();
                        handleDeleteStock(record.code);
                      }}
                      onCancel={(e) => e?.stopPropagation?.()}
                      okText="刪除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                    >
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        data-testid={`viewrunmodal-delete-${record.code}`}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Popconfirm>
                  </Tooltip>
                ),
              },
            ]}
          />
        )}
      </div>
      </ViewRunErrorBoundary>
    </Modal>

    {/* 大少 #8762 (2026-07-29): Add Stock Modal (內層 modal) — 手動新增股票 (板塊/原因 預設「手動新增」) */}
    <Modal
      open={addModalOpen}
      onCancel={() => {
        resetAddStockModal();
        setAddModalOpen(false);
      }}
      title="新增股票"
      okText="加入"
      cancelText="取消"
      onOk={handleAddStock}
      okButtonProps={{
        // 大少 #8918: 加入按鈕 enabled only when StockSearch 已揀 stock
        disabled: !searchedStock,
      }}
      data-testid="viewrunmodal-add-stock-modal"
    >
      <div style={{ padding: '8px 0' }}>
        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 16 }}>
          {/* 大少 #8918 (2026-07-29): 用 StockSearch (圖2 template) 取代 code/name input。
              大少 #9867 (2026-08-03): 板塊 input 移除, 只剩原因可改。 */}
          原因 default「手動新增」，可手動改成其他字。
          數值欄位（現價 / 市值 / 換手率）預設為 0。
        </Paragraph>
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 4 }}>
              搜索股票
            </Text>
            <StockSearch
              placeholder="打 stock code 或名 (例: 騰訊、00981、AAPL)"
              onSelect={setSearchedStock}
              autoFocus
            />
          </div>
          {searchedStock && (
            <div
              style={{
                padding: '8px 12px',
                background: '#fafafa',
                borderRadius: 6,
                fontSize: 12,
              }}
              data-testid="viewrunmodal-add-stock-selected-preview"
            >
              <Text type="secondary">已選擇：</Text>{' '}
              <Text strong style={{ fontFamily: 'SF Mono, Monaco, Consolas, monospace' }}>
                {searchedStock.code}
              </Text>{' '}
              <Text>{searchedStock.name}</Text>
            </div>
          )}
          <div>
            <Text strong style={{ display: 'block', marginBottom: 4 }}>
              原因 (可改)
            </Text>
            <Input
              placeholder="手動新增"
              value={newStockReason}
              onChange={(e) => setNewStockReason(e.target.value)}
              data-testid="viewrunmodal-add-stock-reason-input"
            />
          </div>
        </Space>
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

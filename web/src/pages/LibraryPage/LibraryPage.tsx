// pages/LibraryPage/LibraryPage.tsx — Saved Algorithm Runs Library (大少 2026-07-24)
//
// Modular block architecture:
// - LibraryPage (this file): 容器 — table view + filter + actions
// - EditRunModal: 改 name/note modal (separate component)
// - DeleteRunConfirm: 刪除 confirm modal (separate component)
// - useSavedRuns: hook for CRUD operations

import React, { useState, useMemo } from 'react';
import { Table, Input, Select, Button, Tag, Space, Typography, Empty, Spin, message, Tooltip } from 'antd';
import { AppLayout } from '../../components/layout';
import { EditOutlined, DeleteOutlined, SearchOutlined, ReloadOutlined, BookOutlined, ArrowUpOutlined, ArrowDownOutlined, PushpinOutlined, PushpinFilled } from '@ant-design/icons';
import { useSavedRuns, type SavedRun } from '../../hooks/useSavedRuns';
import EditRunModal from '../../components/library/EditRunModal';
import DeleteRunConfirm from '../../components/library/DeleteRunConfirm';
import ViewRunModal from '../../components/library/ViewRunModal';
import styles from './LibraryPage.module.css';

const { Title, Text } = Typography;

function LibraryPage() {
  const { runs, loading, error, refresh, updateRun, deleteRun, reorderRuns, pinRun } = useSavedRuns();
  const [algorithmFilter, setAlgorithmFilter] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [editingRun, setEditingRun] = useState<SavedRun | null>(null);
  const [deletingRun, setDeletingRun] = useState<SavedRun | null>(null);
  // 大少 2026-07-26 #7558: row click 開 ViewRunModal
  const [viewingRun, setViewingRun] = useState<SavedRun | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  // 提取 unique algorithms (用嚟 filter dropdown)
  const algorithms = useMemo(() => {
    const set = new Set<string>();
    runs.forEach((r) => set.add(`${r.algorithm_id} — ${r.algorithm_name}`));
    return Array.from(set);
  }, [runs]);

  // 過濾
  const filteredRuns = useMemo(() => {
    return runs.filter((r) => {
      if (algorithmFilter && !`${r.algorithm_id} — ${r.algorithm_name}`.match(algorithmFilter)) {
        return false;
      }
      if (search && !r.name.toLowerCase().includes(search.toLowerCase()) && !(r.note ?? '').toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [runs, algorithmFilter, search]);

  const handleEdit = async (id: number, updates: { name?: string; note?: string }) => {
    try {
      await updateRun(id, updates);
      messageApi.success('已更新');
      setEditingRun(null);
    } catch (e) {
      messageApi.error(`更新失敗: ${(e as Error).message}`);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteRun(id);
      messageApi.success('已刪除');
      setDeletingRun(null);
    } catch (e) {
      messageApi.error(`刪除失敗: ${(e as Error).message}`);
    }
  };

  return (
    <AppLayout>
      <div className={styles.container}>
      {contextHolder}
      <div className={styles.header}>
        <Title level={3} style={{ margin: 0 }}>
          <BookOutlined /> 演算法結果庫
        </Title>
        <Text type="secondary">
          儲存嘅演算法結果 (snapshot)，將來可畀其他演算法做輸入
        </Text>
      </div>

      <Space size="middle" className={styles.filters}>
        <Select
          allowClear
          placeholder="所有演算法"
          style={{ width: 200 }}
          value={algorithmFilter}
          onChange={setAlgorithmFilter}
          options={algorithms.map((a) => ({ label: a, value: a }))}
        />
        <Input
          placeholder="Search name 或 note"
          prefix={<SearchOutlined />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 300 }}
          allowClear
        />
        <Button icon={<ReloadOutlined spin={loading} />} onClick={refresh}>
          Refresh
        </Button>
        <Text type="secondary">共 {filteredRuns.length} 個</Text>
      </Space>

      {error && (
        <div className={styles.errorBanner}>
          <Text type="danger">⚠️ {error}</Text>
        </div>
      )}

      <Spin spinning={loading && runs.length === 0}>
        {filteredRuns.length === 0 ? (
          <Empty
            description={runs.length === 0 ? '未有任何儲存嘅結果。試下喺演算法 page 撳「💾 儲存」' : '冇 match 嘅結果'}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ marginTop: 60 }}
          />
        ) : (
          <Table
            dataSource={filteredRuns}
            rowKey="id"
            pagination={{ pageSize: 20, showSizeChanger: true }}
            size="middle"
            // 大少 2026-07-26 #7558: row click 開 ViewRunModal
            onRow={(run) => ({
              onClick: () => setViewingRun(run),
              style: { cursor: 'pointer' },
            })}
            columns={[
              {
                title: 'Unit',
                dataIndex: 'id',
                key: 'id',
                width: 70,
                render: (id: number) => <Tag color="blue">#{id}</Tag>,
              },
              {
                title: '名稱',
                dataIndex: 'name',
                key: 'name',
                render: (name: string, run: SavedRun) => (
                  <div>
                    <Text strong>{name}</Text>
                    {run.note && (
                      <Text type="secondary" className={styles.note}>
                        {run.note}
                      </Text>
                    )}
                  </div>
                ),
              },
              {
                title: '演算法',
                key: 'algorithm',
                width: 160,
                render: (_, run: SavedRun) => (
                  <Tag color="purple">{run.algorithm_name}</Tag>
                ),
              },
              {
                title: '股票數',
                key: 'count',
                width: 80,
                render: (_, run: SavedRun) => <Tag>{run.stocks.length} 隻</Tag>,
              },
              {
                title: '儲存時間',
                dataIndex: 'saved_at',
                key: 'saved_at',
                width: 180,
                render: (ts: string) => <Text type="secondary">{ts}</Text>,
              },
              {
                // 大少 #8960 (2026-07-29): 操作 column 改 reorder/pin icon-only。
                // 原先有嘅「刪除」移咗去 EditRunModal footer (popconfirm)。
                title: '操作',
                key: 'actions',
                width: 178,
                render: (_: unknown, run: SavedRun, idx: number) => {
                  const handleMoveUp = async () => {
                    const arr = filteredRuns.map((r) => r.id);
                    if (idx <= 0) return;
                    [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
                    await reorderRuns(arr);
                  };
                  const handleMoveDown = async () => {
                    const arr = filteredRuns.map((r) => r.id);
                    if (idx >= filteredRuns.length - 1) return;
                    [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
                    await reorderRuns(arr);
                  };
                  const handleTogglePin = async () => {
                    await pinRun(run.id, !run.is_pinned);
                  };
                  return (
                    <Space>
                      <Tooltip title="編輯 (內裏有儲存 / 刪除)">
                        <Button
                          size="small"
                          icon={<EditOutlined />}
                          data-testid={`librarypage-edit-${run.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingRun(run);
                          }}
                        >
                          編輯
                        </Button>
                      </Tooltip>
                      <Tooltip title="向上排位">
                        <Button
                          size="small"
                          icon={<ArrowUpOutlined />}
                          data-testid={`librarypage-up-${run.id}`}
                          disabled={idx === 0}
                          onClick={(e) => { e.stopPropagation(); handleMoveUp(); }}
                        />
                      </Tooltip>
                      <Tooltip title="向下排位">
                        <Button
                          size="small"
                          icon={<ArrowDownOutlined />}
                          data-testid={`librarypage-down-${run.id}`}
                          disabled={idx === filteredRuns.length - 1}
                          onClick={(e) => { e.stopPropagation(); handleMoveDown(); }}
                        />
                      </Tooltip>
                      <Tooltip title={run.is_pinned ? '取消置頂' : '置頂'}>
                        <Button
                          size={run.is_pinned ? 'middle' : 'small'}
                          type={run.is_pinned ? 'primary' : 'default'}
                          icon={run.is_pinned ? <PushpinFilled /> : <PushpinOutlined />}
                          data-testid={`librarypage-pin-${run.id}`}
                          style={run.is_pinned ? { color: '#faad14' } : undefined}
                          onClick={(e) => { e.stopPropagation(); handleTogglePin(); }}
                        />
                      </Tooltip>
                    </Space>
                  );
                },
              },
            ]}
          />
        )}
      </Spin>

      {/* Modals */}
      {editingRun && (
        <EditRunModal
          run={editingRun}
          onSave={(updates) => handleEdit(editingRun.id, updates)}
          onCancel={() => setEditingRun(null)}
          // 大少 #8960 (2026-07-29): Delete 喺 modal 入面（Popconfirm）→ 直接 handleDelete + refresh
          onDelete={async () => {
            await handleDelete(editingRun.id);
            setEditingRun(null);
          }}
        />
      )}
      {/* 大少 #8960 (2026-07-29): DeleteRunConfirm 唔再 mount — Delete 移咗入 EditRunModal footer */}
      {/* (保留 deletingRun state 給將來可能嘅 "archive" 功能用) */}
      {/* 大少 2026-07-26 #7558: ViewRunModal — row click trigger */}
      {/* 大少 #8762 (2026-07-29): onSaved callback — 保存後 close modal + refresh list */}
      {viewingRun && (
        <ViewRunModal
          run={viewingRun}
          onCancel={() => setViewingRun(null)}
          onSaved={() => {
            // ViewRunModal 嘅 handleSaveChanges 入面已經 POST PUT + message.success。
            // 呢度只需 close modal + refresh list。
            setViewingRun(null);
            refresh();
          }}
        />
      )}
      </div>
    </AppLayout>
  );
}

export default LibraryPage;
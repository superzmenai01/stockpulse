// pages/LibraryPage/LibraryPage.tsx — Saved Algorithm Runs Library (大少 2026-07-24)
//
// Modular block architecture:
// - LibraryPage (this file): 容器 — table view + filter + actions
// - EditRunModal: 改 name/note modal (separate component)
// - DeleteRunConfirm: 刪除 confirm modal (separate component)
// - useSavedRuns: hook for CRUD operations

import React, { useState, useMemo } from 'react';
import { Table, Input, Select, Button, Tag, Space, Typography, Empty, Spin, message } from 'antd';
import { AppLayout } from '../../components/layout';
import { EditOutlined, DeleteOutlined, SearchOutlined, ReloadOutlined, BookOutlined } from '@ant-design/icons';
import { useSavedRuns, type SavedRun } from '../../hooks/useSavedRuns';
import EditRunModal from '../../components/library/EditRunModal';
import DeleteRunConfirm from '../../components/library/DeleteRunConfirm';
import styles from './LibraryPage.module.css';

const { Title, Text } = Typography;

function LibraryPage() {
  const { runs, loading, error, refresh, updateRun, deleteRun } = useSavedRuns();
  const [algorithmFilter, setAlgorithmFilter] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [editingRun, setEditingRun] = useState<SavedRun | null>(null);
  const [deletingRun, setDeletingRun] = useState<SavedRun | null>(null);
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
                title: '操作',
                key: 'actions',
                width: 120,
                render: (_, run: SavedRun) => (
                  <Space>
                    <Button
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => setEditingRun(run)}
                    >
                      編輯
                    </Button>
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => setDeletingRun(run)}
                    >
                      刪除
                    </Button>
                  </Space>
                ),
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
        />
      )}
      {deletingRun && (
        <DeleteRunConfirm
          run={deletingRun}
          onConfirm={() => handleDelete(deletingRun.id)}
          onCancel={() => setDeletingRun(null)}
        />
      )}
      </div>
    </AppLayout>
  );
}

export default LibraryPage;
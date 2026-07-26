// components/library/DeleteRunConfirm.tsx — 刪除確認 modal (大少 2026-07-24 #7051 can delete)
//
// Modular component — single responsibility:
// - Show 將會刪除嘅 run 嘅 name + stocks count
// - Confirm / Cancel actions

import { useState } from 'react';
import { Modal, Typography, Tag, Space } from 'antd';
import type { SavedRun } from '../../hooks/useSavedRuns';

const { Text } = Typography;

interface DeleteRunConfirmProps {
  run: SavedRun;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

function DeleteRunConfirm({ run, onConfirm, onCancel }: DeleteRunConfirmProps) {
  const [loading, setLoading] = useState(false);

  const handleOk = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={`🗑️ 確認刪除 #${run.id}?`}
      open
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      okText="確認刪除"
      cancelText="取消"
      okButtonProps={{ danger: true }}
      destroyOnClose
    >
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        <Text>你將會永久刪除呢個 saved run，刪除後無法復原。</Text>
        <Space size="small">
          <Tag color="purple">{run.algorithm_name}</Tag>
          <Tag>{run.stocks.length} 隻股票</Tag>
        </Space>
        <Text strong>{run.name}</Text>
        {run.note && <Text type="secondary">{run.note}</Text>}
      </Space>
    </Modal>
  );
}

export default DeleteRunConfirm;
// components/library/EditRunModal.tsx — 編輯 saved run 嘅 name/note modal (大少 2026-07-24)
//
// Modular component — single responsibility:
// - Display name + note edit form
// - Save / Cancel actions
// - PropTypes: run, onSave(updates), onCancel()

import { useState, useEffect } from 'react';
import { Modal, Form, Input, Tag, Space, Typography, Button, Popconfirm } from 'antd';
import { DeleteOutlined, SaveOutlined } from '@ant-design/icons';
import type { SavedRun } from '../../hooks/useSavedRuns';

const { Text } = Typography;

interface EditRunModalProps {
  run: SavedRun;
  onSave: (updates: { name?: string; note?: string }) => Promise<void>;
  onCancel: () => void;
  // 大少 #8960 (2026-07-29): Delete button 移入編輯 modal (originally row 操作 column)。
  // 用 parent 嘅 useSavedRuns().deleteRun 嘅 callback，唔喺 modal 入面直接 import hook
  // (保持 modal 可重用 / 唔耦合 layer)。
  onDelete?: () => Promise<void>;
}

function EditRunModal({ run, onSave, onCancel, onDelete }: EditRunModalProps) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  // 大少 #8960: delete button 嘅 loading state
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    form.setFieldsValue({ name: run.name, note: run.note ?? '' });
  }, [run, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await onSave({ name: values.name, note: values.note });
    } catch {
      // validation failed or save error — message handled by parent
    } finally {
      setSaving(false);
    }
  };

  // 大少 #8960: 刪除 wrapper — Popconfirm 後 onConfirm 觸發
  const handleDelete = async () => {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      title={`編輯 #${run.id} — ${run.algorithm_name}`}
      open
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={saving || deleting}
      okText="儲存"
      cancelText="取消"
      destroyOnClose
      // 大少 #8960 (2026-07-29): footer 改 array form 加 刪除 button (Popconfirm 確認)
      footer={
        onDelete
          ? [
              <Popconfirm
                key="delete-pop"
                title="刪除呢個儲存結果？"
                description={`#${run.id}「${run.name}」(${run.stocks.length} 隻股票) 會永久刪除，無法復原。`}
                okText="確認刪除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={handleDelete}
              >
                <Button
                  key="delete"
                  danger
                  icon={<DeleteOutlined />}
                  loading={deleting}
                  data-testid="editrunmodal-delete-btn"
                >
                  刪除
                </Button>
              </Popconfirm>,
              <Button key="cancel" onClick={onCancel}>
                取消
              </Button>,
              <Button
                key="save"
                type="primary"
                icon={<SaveOutlined />}
                loading={saving}
                onClick={handleOk}
              >
                儲存
              </Button>,
            ]
          : undefined
      }
    >
      <Space size="small" style={{ marginBottom: 16 }}>
        <Tag color="purple">{run.algorithm_name}</Tag>
        <Tag>{run.stocks.length} 隻股票</Tag>
        <Text type="secondary">儲存於 {run.saved_at}</Text>
      </Space>
      <Form form={form} layout="vertical">
        <Form.Item
          label="名稱"
          name="name"
          rules={[{ required: true, message: '請輸入名稱' }]}
        >
          <Input placeholder="例: 板塊龍頭股 2026-07-24 1430" maxLength={120} />
        </Form.Item>
        <Form.Item
          label="備註"
          name="note"
        >
          <Input.TextArea rows={3} placeholder="可選備註 (e.g. 半導體+芯片股 候選)" maxLength={500} />
        </Form.Item>
        <Form.Item label="股票清單 (snapshot, 唔可以改)">
          <Text type="secondary" style={{ fontSize: 12 }}>
            {run.stocks.join(', ')}
          </Text>
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default EditRunModal;
// components/library/EditRunModal.tsx — 編輯 saved run 嘅 name/note modal (大少 2026-07-24)
//
// Modular component — single responsibility:
// - Display name + note edit form
// - Save / Cancel actions
// - PropTypes: run, onSave(updates), onCancel()

import { useState, useEffect } from 'react';
import { Modal, Form, Input, Tag, Space, Typography } from 'antd';
import type { SavedRun } from '../../hooks/useSavedRuns';

const { Text } = Typography;

interface EditRunModalProps {
  run: SavedRun;
  onSave: (updates: { name?: string; note?: string }) => Promise<void>;
  onCancel: () => void;
}

function EditRunModal({ run, onSave, onCancel }: EditRunModalProps) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

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

  return (
    <Modal
      title={`編輯 #${run.id} — ${run.algorithm_name}`}
      open
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={saving}
      okText="儲存"
      cancelText="取消"
      destroyOnClose
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
// components/library/SaveRunModal.tsx — 儲存 AS-01 結果 modal (大少 2026-07-26 #7493 trigger)
//
// Modal 入面收集 name + optional note, 確認後 POST /api/saved-runs.
// Default name 自動 generate: `{algorithmName} YYYY-MM-DD HHMM`

import React, { useEffect } from 'react';
import { Modal, Form, Input, Tag, Space, Typography, Alert } from 'antd';

const { Text } = Typography;

interface SaveRunModalProps {
  open: boolean;
  algorithmName: string;
  stockCount: number;
  stockCodes: string[];
  rankedAt: string | null;
  saving: boolean;
  onSave: (name: string, note?: string) => Promise<boolean>;
  onCancel: () => void;
}

/**
 計算 default name: `{algorithmName} YYYY-MM-DD HHMM`
 例如: "板塊龍頭股 2026-07-26 1430"
*/
function buildDefaultName(algorithmName: string): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${algorithmName} ${yyyy}-${mm}-${dd} ${hh}${min}`;
}

function SaveRunModal({
  open,
  algorithmName,
  stockCount,
  stockCodes,
  rankedAt,
  saving,
  onSave,
  onCancel,
}: SaveRunModalProps) {
  const [form] = Form.useForm();
  const defaultName = buildDefaultName(algorithmName);

  // Modal 開時 reset form + 預填 default name
  useEffect(() => {
    if (open) {
      form.setFieldsValue({ name: defaultName, note: '' });
    }
  }, [open, defaultName, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      const ok = await onSave(values.name, values.note || undefined);
      if (ok) {
        form.resetFields();
        onCancel();  // close modal
      }
    } catch {
      // validation fail — message handled by Form
    }
  };

  return (
    <Modal
      title={`💾 儲存結果 — ${algorithmName}`}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={saving}
      okText="儲存"
      cancelText="取消"
      destroyOnClose
      width={560}
    >
      <Space size="small" style={{ marginBottom: 16 }} wrap>
        <Tag color="purple">{algorithmName}</Tag>
        <Tag>{stockCount} 隻股票</Tag>
        {rankedAt && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            執行於 {rankedAt}
          </Text>
        )}
      </Space>

      <Alert
        message="儲存後可以喺 Library page 查閱 / 編輯名稱 / 刪除"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          label="名稱"
          name="name"
          initialValue={defaultName}
          rules={[
            { required: true, message: '請輸入名稱' },
            { max: 120, message: '最多 120 字' },
          ]}
        >
          <Input placeholder={defaultName} maxLength={120} />
        </Form.Item>
        <Form.Item
          label="備註"
          name="note"
          rules={[{ max: 500, message: '最多 500 字' }]}
        >
          <Input.TextArea
            rows={3}
            placeholder="可選備註 (e.g. 半導體+芯片股 候選)"
            maxLength={500}
          />
        </Form.Item>
        <Form.Item label="股票清單 (snapshot, 唔可以改)">
          <Text
            type="secondary"
            style={{ fontSize: 12, display: 'block', maxHeight: 100, overflow: 'auto' }}
          >
            {stockCodes.join(', ')}
          </Text>
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default SaveRunModal;

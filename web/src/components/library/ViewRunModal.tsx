// components/library/ViewRunModal.tsx — View saved run detail modal (大少 2026-07-26 #7558)
//
// Shows full saved run detail: name, note, algorithm, metadata, stocks list.
// Future-proof: 預留「用作輸入去行其他演算法」 button (disabled stub for #7558 future feature).
//
// Pattern: 同 EditRunModal 一樣 (Modal + 顯示 SavedRun data + onCancel callback).
// Triggered by LibraryPage row click.

import React from 'react';
import { Modal, Tag, Space, Typography, Alert, Descriptions, Button, Tooltip } from 'antd';
import { ExperimentOutlined, CloseOutlined } from '@ant-design/icons';
import { SavedRun } from '../../hooks/useSavedRuns';

const { Text, Paragraph } = Typography;

interface ViewRunModalProps {
  run: SavedRun;
  onCancel: () => void;
  /**
   * 大少 #7558 future feature —「將 saved stocks 作 input 行其他演算法」。
   * 而家保留 stub，按鈕 disabled。等 AS-02/03/04 實裝時 enable + 連去對應 algorithm page。
   */
  onUseAsInput?: (run: SavedRun) => void;
}

function ViewRunModal({ run, onCancel, onUseAsInput }: ViewRunModalProps) {
  const metadata = run.metadata || {};
  const hasMetadata = Object.keys(metadata).length > 0;

  return (
    <Modal
      title={
        <Space>
          <ExperimentOutlined />
          <span>結果詳情 — {run.algorithm_name}</span>
        </Space>
      }
      open
      onCancel={onCancel}
      width={720}
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
      <Space size="small" wrap style={{ marginBottom: 16 }}>
        <Tag color="blue">#{run.id}</Tag>
        <Tag color="purple">{run.algorithm_name}</Tag>
        <Tag>{run.stocks.length} 隻股票</Tag>
        <Text type="secondary" style={{ fontSize: 12 }}>
          儲存於 {run.saved_at}
        </Text>
        {run.updated_at !== run.saved_at && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            · 更新於 {run.updated_at}
          </Text>
        )}
      </Space>

      <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
        <Descriptions.Item label="名稱">{run.name}</Descriptions.Item>
        <Descriptions.Item label="備註">
          {run.note || <Text type="secondary">(無)</Text>}
        </Descriptions.Item>
        <Descriptions.Item label="Algorithm ID">
          <Tag>{run.algorithm_id}</Tag>
        </Descriptions.Item>
        {hasMetadata && (
          <Descriptions.Item label="Metadata">
            <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(metadata, null, 2)}
            </pre>
          </Descriptions.Item>
        )}
      </Descriptions>

      <Alert
        message={
          <Space>
            <span>股票清單 (snapshot, 唔可以改)</span>
            <Text type="secondary" style={{ fontSize: 12 }}>
              共 {run.stocks.length} 隻
            </Text>
          </Space>
        }
        description={
          <Paragraph
            copyable={{ text: run.stocks.join(', ') }}
            style={{
              margin: 0,
              maxHeight: 200,
              overflow: 'auto',
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            {run.stocks.join(', ')}
          </Paragraph>
        }
        type="info"
        showIcon
      />
    </Modal>
  );
}

export default ViewRunModal;

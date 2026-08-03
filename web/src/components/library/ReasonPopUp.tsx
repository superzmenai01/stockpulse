// components/library/ReasonPopUp.tsx — Per-stock HTML reason report popup (大少 #9920)
//
// 大少 2026-08-03: Modal 顯示 sanitized HTML 報告
// - Server-side 已 sanitize (bleach), frontend 再用 DOMPurify 做 defense-in-depth
// - 900px wide, body scroll 600px
// - Header: title + algorithm_name + 「跳到原 Run」按鈕 (if source_run_id)
// - Body: dangerouslySetInnerHTML with DOMPurify sanitized content

import React from 'react';
import { Modal, Tag, Space, Typography, Button, Tooltip } from 'antd';
import { ExperimentOutlined, LinkOutlined, CloseOutlined } from '@ant-design/icons';
import DOMPurify from 'dompurify';
import type { ReasonEntry } from '../../types/algorithm';
import styles from './ReasonPopUp.module.css';

const { Text, Title } = Typography;

interface ReasonPopUpProps {
  reason: ReasonEntry | null;
  onCancel: () => void;
  // 大少 #9920 optional: jump back to source run (LibraryPage row click handler)
  onJumpToRun?: (runId: number) => void;
}

const SOURCE_TYPE_COLORS: Record<ReasonEntry['source_type'], string> = {
  algorithm: 'purple',
  manual: 'blue',
  news: 'cyan',
  research: 'green',
};

const SOURCE_TYPE_LABELS: Record<ReasonEntry['source_type'], string> = {
  algorithm: '算法',
  manual: '手動',
  news: '新聞',
  research: '研究',
};

export default function ReasonPopUp({ reason, onCancel, onJumpToRun }: ReasonPopUpProps) {
  if (!reason) return null;

  // Defense-in-depth sanitization (server-side 已用 bleach, frontend 再保險)
  // DOMPurify config: 限制 tags, 阻擋 javascript:/on*= attributes
  const sanitizedHtml = DOMPurify.sanitize(reason.html, {
    ALLOWED_TAGS: [
      'div', 'span', 'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4',
      'strong', 'em', 'b', 'i', 'u', 'sub', 'sup',
      'ul', 'ol', 'li',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
      'a', 'code', 'pre', 'blockquote', 'small',
    ],
    ALLOWED_ATTR: ['class', 'id', 'href', 'title', 'target', 'rel', 'colspan', 'rowspan', 'scope', 'border'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:)/i,
  });

  return (
    <Modal
      open={reason !== null}
      onCancel={onCancel}
      width={1000}  // 大少 2026-08-04 UX: wider modal for bar chart readability
      destroyOnClose
      title={
        <Space>
          <ExperimentOutlined />
          <span>{reason.title}</span>
        </Space>
      }
      footer={
        <Space>
          {reason.source_run_id && onJumpToRun && (
            <Tooltip title="跳到原 Run (LibraryPage 開呢個 run 嘅 detail)">
              <Button
                icon={<LinkOutlined />}
                onClick={() => onJumpToRun(reason.source_run_id!)}
                data-testid={`reason-popup-jump-${reason.id}`}
              >
                跳到原 Run #{reason.source_run_id}
              </Button>
            </Tooltip>
          )}
          <Button icon={<CloseOutlined />} onClick={onCancel}>
            關閉
          </Button>
        </Space>
      }
      className={styles.modal}
    >
      {/* Header tags */}
      <Space size="small" wrap style={{ marginBottom: 16 }}>
        <Tag color={SOURCE_TYPE_COLORS[reason.source_type]}>
          {SOURCE_TYPE_LABELS[reason.source_type]}
        </Tag>
        <Tag color="blue">{reason.code}</Tag>
        {reason.source_run_id && (
          <Tag color="geekblue">Run #{reason.source_run_id}</Tag>
        )}
        <Text type="secondary" style={{ fontSize: 12 }}>
          {reason.source_ref}
        </Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          · 建立 {reason.created_at}
        </Text>
        {reason.updated_at !== reason.created_at && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            · 更新 {reason.updated_at}
          </Text>
        )}
      </Space>

      {/* Body — sanitized HTML rendered with scroll */}
      <div
        className={styles.body}
        data-testid={`reason-popup-body-${reason.id}`}
        dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      />
    </Modal>
  );
}
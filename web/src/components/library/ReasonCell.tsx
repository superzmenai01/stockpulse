// components/library/ReasonCell.tsx — Per-stock HTML reason titles + PopUp trigger (大少 #9920 v2)
//
// 大少 2026-08-03 #9920: v2 rewrite
// - Old: plain text + truncate 80 chars + click-to-expand (text only)
// - New: useStockReasons(code) → render titles list (NEW format)
//   - Each title = clickable → opens ReasonPopUp (sanitized HTML modal)
//   - Fallback: if useStockReasons returns empty + legacy `reason` string present →
//     render old truncated text + "(舊版)" 標記
//
// IMPORTANT: 必須係獨立 component (唔可以 inline useState 喺 AntD column.render callback 入面)
// 之前 inline `useState` 違反 React Hooks Rules → AntD Cell2 內部 useRef 撞冧 (大少 #9494)
//
// 大少 #9557 (2026-08-02 00:00): 2 個 UX fixes carry-over:
//   1. onClick 加 e.stopPropagation() 避免 bubble 到 <Table> onRow.onClick 開 chart modal
//   2. style 加 wordBreak: break-word + display: block 確保 column width fixed 時 wrap 落多行

import { useState } from 'react';
import { Typography, Space, Tag } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import { useStockReasons } from '../../hooks/useStockReasons';
import type { ReasonEntry } from '../../types/algorithm';
import ReasonPopUp from './ReasonPopUp';

const { Text } = Typography;

interface ReasonCellProps {
  code: string;
  /** Legacy plain-text reason (舊 saved_stocks[i].reason). Fallback if no new format reasons. */
  legacyReason?: string;
  /** Optional: jump to source run handler (passed to ReasonPopUp) */
  onJumpToRun?: (runId: number) => void;
}

const DEFAULT_TRUNCATE_LEN = 80;

export function ReasonCell({ code, legacyReason, onJumpToRun }: ReasonCellProps) {
  const { reasons, loading } = useStockReasons(code);
  const [openReason, setOpenReason] = useState<ReasonEntry | null>(null);

  // Loading state
  if (loading) {
    return <Text type="secondary" style={{ fontSize: 11 }}>載入中...</Text>;
  }

  // New format: titles list (click to open PopUp)
  if (reasons.length > 0) {
    return (
      <>
        <Space direction="vertical" size={2} style={{ display: 'block' }}>
          {reasons.map((r) => (
            <Text
              key={r.id}
              style={{
                fontSize: 11,
                cursor: 'pointer',
                color: '#1890ff',
                wordBreak: 'break-word',
                display: 'block',
              }}
              onClick={(e) => {
                e.stopPropagation();  // 大少 #9557: avoid bubble to <Table> onRow.onClick
                setOpenReason(r);
              }}
              data-testid={`reason-cell-title-${code}-${r.id}`}
            >
              <FileTextOutlined style={{ marginRight: 4 }} />
              {r.title}
              <Tag
                color={
                  r.source_type === 'algorithm' ? 'purple' :
                  r.source_type === 'manual' ? 'blue' :
                  r.source_type === 'news' ? 'cyan' : 'green'
                }
                style={{ fontSize: 9, marginLeft: 4, padding: '0 4px', lineHeight: '14px' }}
              >
                {r.source_ref}
              </Tag>
            </Text>
          ))}
        </Space>
        <ReasonPopUp
          reason={openReason}
          onCancel={() => setOpenReason(null)}
          onJumpToRun={onJumpToRun}
        />
      </>
    );
  }

  // Fallback: legacy plain-text reason (大少 Q2 default — 舊 testing data wipe, 但若將來有殘留)
  if (legacyReason && legacyReason.trim()) {
    const needsTruncate = legacyReason.length > DEFAULT_TRUNCATE_LEN;
    const display = needsTruncate ? legacyReason.slice(0, DEFAULT_TRUNCATE_LEN) + '...' : legacyReason;
    return (
      <Text
        type="secondary"
        style={{
          fontSize: 11,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          display: 'block',
        }}
        title={legacyReason}
      >
        {display}
        {needsTruncate && (
          <Text type="warning" style={{ fontSize: 10, marginLeft: 4 }}>
            (舊版)
          </Text>
        )}
      </Text>
    );
  }

  // Empty state
  return <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
}
// components/library/ReasonCell.tsx — Truncate + onClick expand for ViewRunModal reason column
//
// 大少 #9494 (2026-08-01): Truncate long reasons to 80 chars + click-to-expand toggle.
//
// IMPORTANT: 必須係獨立 component, 唔可以 inline useState 喺 AntD column.render callback 入面.
// 之前 inline `useState` 違反 React Hooks Rules (hook 喺 per-row render function 入面直接 call)
// → AntD Cell2 內部 useRef hook store 撞冧 → modal render 全炸 (error: "Cannot create property
// 'current' on boolean 'false'") → 永遠見 "結果詳情載入失敗" 而唔係 stock data.
//
// Fix: extract 出獨立 component, hook 喺 component top-level call.
//
// 大少 #9557 (2026-08-02 00:00): 2 個 UX fixes:
//   1. onClick 加 e.stopPropagation() 避免 bubble 到 <Table> onRow.onClick 開 chart modal
//   2. style 加 wordBreak: break-word + display: block 確保 column width fixed 時 wrap 落多行
//      (column 由 ViewRunModal.tsx 設 width: 220, 約 20 中文字)

import { useState } from 'react';
import { Typography } from 'antd';

const { Text } = Typography;

interface ReasonCellProps {
  text: string;
  truncateLen?: number;
}

const DEFAULT_TRUNCATE_LEN = 80;

export function ReasonCell({ text, truncateLen = DEFAULT_TRUNCATE_LEN }: ReasonCellProps) {
  const [expanded, setExpanded] = useState(false);

  if (!text) return <Text type="secondary">—</Text>;

  const needsTruncate = text.length > truncateLen;
  const display = !needsTruncate || expanded ? text : text.slice(0, truncateLen) + '...';

  return (
    <Text
      type="secondary"
      style={{
        fontSize: 11,
        cursor: needsTruncate ? 'pointer' : 'default',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        display: 'block',
      }}
      onClick={(e) => {
        // 大少 #9557 (00:00): 避免 click [展開] bubble 到 <Table> onRow.onClick → handleStockClick → 開 chart modal
        e.stopPropagation();
        if (needsTruncate) setExpanded(!expanded);
      }}
    >
      {display}
      {needsTruncate && (
        <Text type="secondary" style={{ fontSize: 10, marginLeft: 4, color: '#1890ff' }}>
          [{expanded ? '收合' : '展開'}]
        </Text>
      )}
    </Text>
  );
}
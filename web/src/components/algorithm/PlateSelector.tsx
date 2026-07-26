// components/algorithm/PlateSelector.tsx — Multi-select plate dropdown with search
// 大少 2026-07-24 Tier 1.3: Frontend modular refactor
// 大少 2026-07-26 08:36: 加 ↺ 還原預設 button + confirm dialog (一鍵還原 default 排位)

import React from 'react';
import { Select, Space, Tag, Typography, Button, Modal, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { Plate, MAX_PLATES } from '../../types/algorithm';

const { Text } = Typography;

interface PlateSelectorProps {
  plates: Plate[];
  loading: boolean;
  searching: boolean;
  selectedPlates: string[];
  onChange: (values: string[]) => void;
  onSearch: (query: string) => void;
  // 大少 2026-07-26 08:36: 一鍵還原 props (由 usePlates 串入嚟)
  isDefault: boolean;
  restoring: boolean;
  restoreDefault: () => Promise<boolean>;
}

function toPlateOption(p: Plate) {
  const rank = p.popularity_rank != null ? `#${p.popularity_rank}` : '#?';
  return {
    value: p.plate_code,
    label: `${rank} ${p.plate_name} (${p.stock_count})`,
  };
}

export default function PlateSelector({
  plates,
  loading,
  searching,
  selectedPlates,
  onChange,
  onSearch,
  isDefault,
  restoring,
  restoreDefault,
}: PlateSelectorProps) {
  // Enforce max 30 plates
  const handleChange = (values: string[]) => {
    if (values.length > MAX_PLATES) {
      message.warning(`最多選 ${MAX_PLATES} 個板塊`);
      return;
    }
    onChange(values);
  };

  // 大少 2026-07-26 08:36: 一鍵還原 confirm + execute
  const handleRestoreClick = () => {
    Modal.confirm({
      title: '還原預設排位？',
      content: (
        <div>
          <p>將排位還原返 <b>大少 2026-07-25 指定嘅 38 個 default 板塊排位</b>。</p>
          <p style={{ color: '#999', fontSize: 12 }}>
            如果你之前改過排位 (例如 drag)，舊 custom order 會 backup 去 ~/.Trash/，可以隨時 recover。
          </p>
        </div>
      ),
      okText: '✓ 還原',
      cancelText: '取消',
      okButtonProps: { type: 'primary' },
      onOk: async () => {
        const success = await restoreDefault();
        return success;
      },
    });
  };

  const displayOptions = plates.map(toPlateOption);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text strong>🏷️ 板塊（最多 {MAX_PLATES} 個）</Text>
        {/* 大少 2026-07-26 08:36: 一鍵還原 default 排位 button */}
        <Button
          size="small"
          icon={<ReloadOutlined />}
          loading={restoring}
          disabled={isDefault}
          onClick={handleRestoreClick}
          title={
            isDefault
              ? '已經係 default 排位'
              : '一鍵還原返大少 2026-07-25 指定嘅 38 個 default 排位'
          }
        >
          ↺ 還原預設
        </Button>
      </div>
      <Select
        mode="multiple"
        showSearch
        placeholder="🔍 搵板塊 (top 50 + 搜尋全部 275)..."
        value={selectedPlates}
        onChange={handleChange}
        onSearch={onSearch}
        options={displayOptions}
        loading={loading || searching}
        className="fullWidth"
        filterOption={false}
        notFoundContent={searching ? '搜尋中...' : '冇結果'}
        maxTagCount="responsive"
        style={{ width: '100%', marginTop: 8 }}
      />
      <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 6 }}>
        已選 <Tag color="blue">{selectedPlates.length}</Tag> / {MAX_PLATES} 個
        {/* 大少 2026-07-26 08:36: 顯示 order 狀態 (default / custom) */}
        <Tag color={isDefault ? 'default' : 'orange'} style={{ marginLeft: 8 }}>
          {isDefault ? '✓ 預設排位' : '⚠️ 自訂排位'}
        </Tag>
      </Text>
    </div>
  );
}
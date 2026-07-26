// components/algorithm/NonStockToggle.tsx — Toggle show non-stock plates
// 大少 2026-07-24 Tier 1.3: Frontend modular refactor (大少指示「小小的制」)

import React from 'react';
import { Switch, Typography } from 'antd';

const { Text } = Typography;

interface NonStockToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export default function NonStockToggle({ checked, onChange }: NonStockToggleProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, paddingTop: 8, borderTop: '1px dashed rgba(255, 255, 255, 0.08)', width: '100%' }}>
      <Switch
        size="small"
        checked={checked}
        onChange={onChange}
      />
      <Text type="secondary" style={{ fontSize: 12 }}>
        顯示非股票板塊
      </Text>
    </div>
  );
}
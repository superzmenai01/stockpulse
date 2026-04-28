// MoveStockModal - 移動股票到其他組別

import React, { useState } from 'react'
import { Modal, List, Radio, Button, message } from 'antd'
import { groupApi, Group } from '../../services/groupApi'

interface MoveStockModalProps {
  open: boolean
  stockCode: string
  stockName: string
  currentGroupId: string
  groups: Group[]
  onClose: () => void
  onMove: (targetGroupId: string) => void
}

function MoveStockModal({
  open,
  stockCode,
  stockName,
  currentGroupId,
  groups,
  onClose,
  onMove,
}: MoveStockModalProps) {
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)

  const availableGroups = groups.filter(g => g.id !== currentGroupId)

  const handleMove = () => {
    if (!selectedGroup) {
      message.warning('請選擇目標組別')
      return
    }
    onMove(selectedGroup)
    setSelectedGroup(null)
  }

  const handleCancel = () => {
    setSelectedGroup(null)
    onClose()
  }

  return (
    <Modal
      title={`移動 ${stockName} 到其他組別`}
      open={open}
      onCancel={handleCancel}
      footer={[
        <Button key="cancel" onClick={handleCancel}>
          取消
        </Button>,
        <Button key="move" type="primary" onClick={handleMove} disabled={!selectedGroup}>
          移動
        </Button>,
      ]}
    >
      <div style={{ marginBottom: 16 }}>
        <strong>股票：</strong> {stockName} ({stockCode})
      </div>
      
      <Radio.Group
        value={selectedGroup}
        onChange={e => setSelectedGroup(e.target.value)}
        style={{ width: '100%' }}
      >
        <List
          dataSource={availableGroups}
          renderItem={group => (
            <List.Item key={group.id}>
              <Radio value={group.id}>
                <span style={{ 
                  display: 'inline-block',
                  width: 12,
                  height: 12,
                  borderRadius: 2,
                  backgroundColor: group.color,
                  marginRight: 8,
                }} />
                {group.name}
              </Radio>
            </List.Item>
          )}
        />
      </Radio.Group>
      
      {availableGroups.length === 0 && (
        <div style={{ textAlign: 'center', color: '#999', padding: 20 }}>
          沒有其他組別可以移動
        </div>
      )}
    </Modal>
  )
}

export default MoveStockModal

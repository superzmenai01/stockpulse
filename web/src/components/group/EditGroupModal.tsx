// EditGroupModal - 編輯組別彈窗

import React, { useState, useEffect } from 'react'
import { Modal, Input, ColorPicker, Button, Space } from 'antd'
import styles from './AddGroupModal.module.css'

interface EditGroupModalProps {
  open: boolean
  name: string
  color: string
  onClose: () => void
  onSave: (name: string, color: string) => void
}

const defaultColors = [
  '#1890ff', // 藍
  '#52c41a', // 綠
  '#f5222d', // 紅
  '#faad14', // 黃
  '#722ed1', // 紫
  '#eb2f96', // 粉
  '#13c2c2', // 青
  '#fa8c16', // 橙
]

function EditGroupModal({ open, name, color, onClose, onSave }: EditGroupModalProps) {
  const [groupName, setGroupName] = useState(name)
  const [groupColor, setGroupColor] = useState(color)

  // 當 prop 變化時更新狀態
  useEffect(() => {
    setGroupName(name)
    setGroupColor(color)
  }, [name, color])

  const handleOk = () => {
    if (groupName.trim()) {
      onSave(groupName.trim(), groupColor)
    }
  }

  const handleCancel = () => {
    setGroupName(name)
    setGroupColor(color)
    onClose()
  }

  return (
    <Modal
      title="編輯組別"
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      okText="保存"
      cancelText="取消"
    >
      <div className={styles.form}>
        <div className={styles.field}>
          <label>組別名稱</label>
          <Input
            placeholder="例如：科技股、收息股"
            value={groupName}
            onChange={e => setGroupName(e.target.value)}
            maxLength={20}
          />
        </div>

        <div className={styles.field}>
          <label>顏色</label>
          <Space wrap>
            {defaultColors.map(c => (
              <div
                key={c}
                className={`${styles.colorOption} ${groupColor === c ? styles.selected : ''}`}
                style={{ backgroundColor: c }}
                onClick={() => setGroupColor(c)}
              />
            ))}
          </Space>
        </div>

        <div className={styles.preview}>
          <span style={{ color: groupColor }}>預覽：{groupName || '組別名稱'}</span>
        </div>
      </div>
    </Modal>
  )
}

export default EditGroupModal

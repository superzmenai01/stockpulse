// AddGroupModal - 添加組別彈窗

import React, { useState } from 'react'
import { Modal, Input, ColorPicker, Button, Space } from 'antd'
import styles from './AddGroupModal.module.css'

interface AddGroupModalProps {
  open: boolean
  onClose: () => void
  onAdd: (name: string, color: string) => void
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

function AddGroupModal({ open, onClose, onAdd }: AddGroupModalProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(defaultColors[0])

  const handleOk = () => {
    if (name.trim()) {
      onAdd(name.trim(), color)
      setName('')
      setColor(defaultColors[0])
    }
  }

  const handleCancel = () => {
    setName('')
    setColor(defaultColors[0])
    onClose()
  }

  return (
    <Modal
      title="新增組別"
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      okText="創建"
      cancelText="取消"
    >
      <div className={styles.form}>
        <div className={styles.field}>
          <label>組別名稱</label>
          <Input
            placeholder="例如：科技股、收息股"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={20}
          />
        </div>

        <div className={styles.field}>
          <label>顏色</label>
          <Space wrap>
            {defaultColors.map(c => (
              <div
                key={c}
                className={`${styles.colorOption} ${color === c ? styles.selected : ''}`}
                style={{ backgroundColor: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </Space>
        </div>

        <div className={styles.preview}>
          <span style={{ color }}>預覽：{name || '組別名稱'}</span>
        </div>
      </div>
    </Modal>
  )
}

export default AddGroupModal

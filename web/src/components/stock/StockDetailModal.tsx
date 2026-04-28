// StockDetailModal - 股票詳情彈窗

import React from 'react'
import { Modal } from 'antd'
import ChartContainer from '../chart/ChartContainer'
import styles from './StockDetailModal.module.css'

interface StockDetailModalProps {
  open: boolean
  stock: { code: string; name: string } | null
  onClose: () => void
}

export default function StockDetailModal({ open, stock, onClose }: StockDetailModalProps) {
  if (!stock) return null

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={stock.name}
      width={900}
      footer={null}
      className={styles.modal}
      bodyStyle={{ padding: 0, height: '500px' }}
    >
      <div className={styles.content}>
        <ChartContainer stock={stock} />
      </div>
    </Modal>
  )
}
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
  return (
    <Modal
      open={open}
      onCancel={onClose}
      // 大少 #8722 (2026-07-29): 移除 stock 名 title — toolbar top-left 已有 HK.00981 + price info
      title={null}
      width={900}
      footer={null}
      className={styles.modal}
      styles={{ body: { padding: 0, height: 500 } }}
    >
      {stock && (
        <div className={styles.content}>
          <ChartContainer stock={stock} />
        </div>
      )}
    </Modal>
  )
}
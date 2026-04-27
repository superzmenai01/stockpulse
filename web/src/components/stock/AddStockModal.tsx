// AddStockModal - 加入股票 Modal

import React, { useState } from 'react'
import { Modal, Button, message } from 'antd'
import StockSearch from './StockSearch'
import { StockSearchResult } from '../../services/stockApi'
import styles from './AddStockModal.module.css'

interface AddStockModalProps {
  open: boolean
  groupId: string
  groupName: string
  onClose: () => void
  onAdd: (code: string, name: string) => void
}

function AddStockModal({ open, groupId: _groupId, groupName, onClose, onAdd }: AddStockModalProps) {
  const [selectedStock, setSelectedStock] = useState<StockSearchResult | null>(null)

  const handleSelect = (stock: StockSearchResult) => {
    setSelectedStock(stock)
  }

  const handleConfirm = () => {
    if (selectedStock) {
      onAdd(selectedStock.code, selectedStock.name)
      setSelectedStock(null)
      onClose()
      message.success(`已加入 ${selectedStock.name}`)
    }
  }

  const handleClose = () => {
    setSelectedStock(null)
    onClose()
  }

  return (
    <Modal
      title={`加入股票到 ${groupName}`}
      open={open}
      onCancel={handleClose}
      footer={[
        <Button key="cancel" onClick={handleClose}>
          取消
        </Button>,
        <Button
          key="confirm"
          type="primary"
          disabled={!selectedStock}
          onClick={handleConfirm}
        >
          確認加入
        </Button>,
      ]}
    >
      <div className={styles.content}>
        <StockSearch
          placeholder="搜索股票..."
          onSelect={handleSelect}
          autoFocus
        />

        {selectedStock && (
          <div className={styles.preview}>
            <div className={styles.previewLabel}>已選擇：</div>
            <div className={styles.previewStock}>
              <span className={styles.code}>{selectedStock.code}</span>
              <span className={styles.name}>{selectedStock.name}</span>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

export default AddStockModal

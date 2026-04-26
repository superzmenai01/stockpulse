// HomePage - 首頁（組別列表）

import React, { useState, useEffect } from 'react'
import { Button, Empty, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { AppLayout } from '../../components/layout'
import GroupCard from '../../components/group/GroupCard'
import AddGroupModal from '../../components/group/AddGroupModal'
import EditGroupModal from '../../components/group/EditGroupModal'
import { useWebSocketContext } from '../../context'
import styles from './HomePage.module.css'

// 預設股票列表
const DEFAULT_STOCKS = ['HK.00700', 'HK.00981', 'HK.00005', 'HK.01810', 'HK.02382']

// Mock 組別數據
const mockGroups = [
  {
    id: '1',
    name: '科技股',
    color: '#1890ff',
    stockCodes: ['HK.00700', 'HK.01810'],
  },
  {
    id: '2',
    name: '收息股',
    color: '#52c41a',
    stockCodes: ['HK.00005'],
  },
  {
    id: '3',
    name: '長線持有',
    color: '#722ed1',
    stockCodes: [],
  },
]

function HomePage() {
  const {
    connected,
    subscribed,
    waitingCancel,
    cancelCooldown,
    quotes,
    init,
    unsubscribeAll,
    subscribeStatus,
  } = useWebSocketContext()

  const [groups, setGroups] = useState(mockGroups)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState<{ id: string; name: string; color: string } | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['1']))
  const [hasInitialized, setHasInitialized] = useState(false)

  // 初始化訂閱（只執行一次）
  useEffect(() => {
    if (connected && !hasInitialized) {
      init(DEFAULT_STOCKS)
      setHasInitialized(true)
    }
  }, [connected, hasInitialized, init])

  // 顯示訂閱狀態通知
  useEffect(() => {
    if (subscribeStatus) {
      switch (subscribeStatus) {
        case 'success':
          message.success('股票訂閱成功')
          break
        case 'failed':
          message.error('股票訂閱失敗，請稍後再試')
          break
        case 'waiting':
          message.warning('富途要求訂閱滿1分鐘後才能取消')
          break
      }
    }
  }, [subscribeStatus])

  // 切換組別展開/折疊
  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  // 添加新組別
  const handleAddGroup = (name: string, color: string) => {
    const newGroup = {
      id: Date.now().toString(),
      name,
      color,
      stockCodes: [],
    }
    setGroups(prev => [...prev, newGroup])
    setShowAddModal(false)
  }

  // 刪除組別
  const handleDeleteGroup = (groupId: string) => {
    setGroups(prev => prev.filter(g => g.id !== groupId))
  }

  // 編輯組別 - 打開編輯彈窗
  const handleEditGroup = (groupId: string) => {
    const group = groups.find(g => g.id === groupId)
    if (group) {
      setEditingGroup({ id: group.id, name: group.name, color: group.color })
      setShowEditModal(true)
    }
  }

  // 保存編輯
  const handleSaveEdit = (name: string, color: string) => {
    if (editingGroup) {
      setGroups(prev => prev.map(g => 
        g.id === editingGroup.id ? { ...g, name, color } : g
      ))
    }
    setShowEditModal(false)
    setEditingGroup(null)
  }

  // 添加股票到組別（TODO）
  const handleAddStock = (groupId: string) => {
    console.log('添加股票到組別:', groupId)
  }

  // 將 stockCodes 轉換為帶報價的股票列表
  const getStocksWithQuotes = (stockCodes: string[]) => {
    return stockCodes.map(code => {
      const quote = quotes[code]
      if (quote && quote.last_price > 0) {
        return {
          code: quote.code,
          name: quote.name,
          price: quote.last_price,
          change: quote.change,
          pctChange: quote.pct_change,
        }
      }
      return {
        code,
        name: quote?.name || code,
        price: 0,
        change: 0,
        pctChange: 0,
      }
    })
  }

  return (
    <AppLayout
      connected={connected}
      subscribed={subscribed}
      waitingCancel={waitingCancel}
      cancelCooldown={cancelCooldown}
      onUnsubscribe={unsubscribeAll}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <h2 className={styles.title}>我的組別</h2>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setShowAddModal(true)}
          >
            新增組別
          </Button>
        </div>

        <div className={styles.groupList}>
          {groups.length === 0 ? (
            <Empty description="暫時沒有組別" className={styles.empty}>
              <Button type="primary" onClick={() => setShowAddModal(true)}>
                創建第一個組別
              </Button>
            </Empty>
          ) : (
            groups.map(group => (
              <GroupCard
                key={group.id}
                id={group.id}
                name={group.name}
                color={group.color}
                stocks={getStocksWithQuotes(group.stockCodes)}
                expanded={expandedGroups.has(group.id)}
                onToggle={() => toggleGroup(group.id)}
                onAddStock={() => handleAddStock(group.id)}
                onEdit={() => handleEditGroup(group.id)}
                onDelete={() => handleDeleteGroup(group.id)}
              />
            ))
          )}
        </div>
      </div>

      <AddGroupModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdd={handleAddGroup}
      />

      {editingGroup && (
        <EditGroupModal
          open={showEditModal}
          name={editingGroup.name}
          color={editingGroup.color}
          onClose={() => {
            setShowEditModal(false)
            setEditingGroup(null)
          }}
          onSave={handleSaveEdit}
        />
      )}
    </AppLayout>
  )
}

export default HomePage

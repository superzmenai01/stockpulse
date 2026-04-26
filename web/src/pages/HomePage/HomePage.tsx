// HomePage - 首頁（組別列表）

import React, { useState, useEffect } from 'react'
import { Card, Button, Space, Empty, Spin } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { AppLayout } from '../../components/layout'
import GroupCard from '../../components/group/GroupCard'
import AddGroupModal from '../../components/group/AddGroupModal'
import styles from './HomePage.module.css'

// Mock 數據（暫時用黎展示 UI）
const mockGroups = [
  {
    id: '1',
    name: '科技股',
    color: '#1890ff',
    stocks: [
      { code: 'HK.00700', name: '騰訊控股', price: 493.4, change: 1.2, pctChange: 0.24 },
      { code: 'HK.01810', name: '小米集團', price: 45.2, change: -0.3, pctChange: -0.66 },
    ],
  },
  {
    id: '2',
    name: '收息股',
    color: '#52c41a',
    stocks: [
      { code: 'HK.00005', name: '滙豐控股', price: 72.5, change: 0.5, pctChange: 0.69 },
    ],
  },
  {
    id: '3',
    name: '長線持有',
    color: '#722ed1',
    stocks: [],
  },
]

function HomePage() {
  const [groups, setGroups] = useState(mockGroups) // TODO: 替換為真實 API
  const [loading, setLoading] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['1'])) // 預設展開第一個

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
      stocks: [],
    }
    setGroups(prev => [...prev, newGroup])
    setShowAddModal(false)
  }

  // 刪除組別
  const handleDeleteGroup = (groupId: string) => {
    setGroups(prev => prev.filter(g => g.id !== groupId))
  }

  // 添加股票到組別
  const handleAddStock = (groupId: string) => {
    // TODO: 打開股票搜索彈窗
    console.log('添加股票到組別:', groupId)
  }

  return (
    <AppLayout>
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

        <Spin spinning={loading}>
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
                  stocks={group.stocks}
                  expanded={expandedGroups.has(group.id)}
                  onToggle={() => toggleGroup(group.id)}
                  onAddStock={() => handleAddStock(group.id)}
                  onDelete={() => handleDeleteGroup(group.id)}
                />
              ))
            )}
          </div>
        </Spin>
      </div>

      <AddGroupModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdd={handleAddGroup}
      />
    </AppLayout>
  )
}

export default HomePage

// HomePage - 首頁（組別列表）

import React, { useState, useEffect } from 'react'
import { Button, Empty, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { AppLayout } from '../../components/layout'
import GroupCard from '../../components/group/GroupCard'
import AddGroupModal from '../../components/group/AddGroupModal'
import EditGroupModal from '../../components/group/EditGroupModal'
import { useWebSocketContext } from '../../context'
import { groupApi, Group } from '../../services/groupApi'
import styles from './HomePage.module.css'

// 預設股票列表
const DEFAULT_STOCKS = ['HK.00700', 'HK.00981', 'HK.00005', 'HK.01810', 'HK.02382']

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

  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState<{ id: string; name: string; color: string } | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [hasCalledInit, setHasCalledInit] = useState(false)

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // 從 API 載入組別
  useEffect(() => {
    loadGroups()
  }, [])

  const loadGroups = async () => {
    try {
      const data = await groupApi.list()
      setGroups(data)
      // 預設展開第一個組
      if (data.length > 0) {
        setExpandedGroups(new Set([data[0].id]))
      }
    } catch (err) {
      console.error('載入組別失敗:', err)
      message.error('載入組別失敗')
    } finally {
      setLoading(false)
    }
  }

  // 初始化訂閱（連接成功後調用一次）
  useEffect(() => {
    if (connected && !hasCalledInit) {
      console.log('[HomePage] 連接成功，調用 init')
      init(DEFAULT_STOCKS)
      setHasCalledInit(true)
    }
  }, [connected, hasCalledInit, init])

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

  // DnD: 拖結束後處理排序
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = groups.findIndex(g => g.id === active.id)
      const newIndex = groups.findIndex(g => g.id === over.id)
      
      // 本地更新順序
      const newGroups = arrayMove(groups, oldIndex, newIndex)
      setGroups(newGroups)

      // 發送 reorder 請求到 backend
      try {
        await groupApi.reorder(newGroups.map(g => g.id))
      } catch (err) {
        console.error('保存排序失敗:', err)
        message.error('保存排序失敗')
        // 回滾
        setGroups(groups)
      }
    }
  }

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
  const handleAddGroup = async (name: string, color: string) => {
    try {
      const newGroup = await groupApi.create({ name, color })
      setGroups(prev => [...prev, newGroup])
      setShowAddModal(false)
      message.success('組別已創建')
    } catch (err) {
      console.error('創建組別失敗:', err)
      message.error('創建組別失敗')
    }
  }

  // 刪除組別
  const handleDeleteGroup = async (groupId: string) => {
    try {
      await groupApi.delete(groupId)
      setGroups(prev => prev.filter(g => g.id !== groupId))
      message.success('組別已刪除')
    } catch (err) {
      console.error('刪除組別失敗:', err)
      message.error('刪除組別失敗')
    }
  }

  // 編輯組別
  const handleEditGroup = (groupId: string) => {
    const group = groups.find(g => g.id === groupId)
    if (group) {
      setEditingGroup({ id: group.id, name: group.name, color: group.color })
      setShowEditModal(true)
    }
  }

  // 保存編輯
  const handleSaveEdit = async (name: string, color: string) => {
    if (editingGroup) {
      try {
        const updated = await groupApi.update(editingGroup.id, { name, color })
        setGroups(prev => prev.map(g => 
          g.id === editingGroup.id ? updated : g
        ))
        message.success('組別已更新')
      } catch (err) {
        console.error('更新組別失敗:', err)
        message.error('更新組別失敗')
      }
    }
    setShowEditModal(false)
    setEditingGroup(null)
  }

  // 添加股票到組別
  const handleAddStock = (groupId: string) => {
    console.log('添加股票到組別:', groupId)
  }

  // 將 stockCodes 轉換為帶報價的股票列表
  // TODO: 組別和股票的關聯尚未實現，目前使用空數組
  const getStocksWithQuotes = (_stockCodes: string[] = []) => {
    return _stockCodes.map(code => {
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

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={groups.map(g => g.id)}
            strategy={verticalListSortingStrategy}
          >
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
                    stocks={getStocksWithQuotes(group.stockCodes || [])}
                    expanded={expandedGroups.has(group.id)}
                    onToggle={() => toggleGroup(group.id)}
                    onAddStock={() => handleAddStock(group.id)}
                    onEdit={() => handleEditGroup(group.id)}
                    onDelete={() => handleDeleteGroup(group.id)}
                    draggable
                  />
                ))
              )}
            </div>
          </SortableContext>
        </DndContext>
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

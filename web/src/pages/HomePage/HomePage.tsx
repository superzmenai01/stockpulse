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
import MoveStockModal from '../../components/group/MoveStockModal'
import AddStockModal from '../../components/stock/AddStockModal'
import { useWebSocketContext } from '../../context'
import { groupApi, Group } from '../../services/groupApi'
import styles from './HomePage.module.css'

// 預設股票列表（已移除，只訂閱組別入面的股票）
// const DEFAULT_STOCKS = ['HK.00700', 'HK.00981', 'HK.00005', 'HK.01810', 'HK.02382']

function HomePage() {
  const {
    connected,
    subscribed,
    waitingCancel,
    cancelCooldown,
    quotes,
    init,
    subscribe,
    unsubscribeAll,
    subscribeStatus,
  } = useWebSocketContext()

  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState<{ id: string; name: string; color: string } | null>(null)
  const [showAddStockModal, setShowAddStockModal] = useState(false)
  const [addStockToGroup, setAddStockToGroup] = useState<{ id: string; name: string } | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [hasCalledInit, setHasCalledInit] = useState(false)
  const [pendingInitCodes, setPendingInitCodes] = useState<string[] | null>(null)
  
  // 移動股票 Modal state
  const [showMoveStockModal, setShowMoveStockModal] = useState(false)
  const [movingStock, setMovingStock] = useState<{ code: string; name: string; fromGroupId: string } | null>(null)

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
      // 為每個組別載入股票
      const groupsWithStocks = await Promise.all(
        data.map(async (g) => {
          try {
            const stocks = await groupApi.getStocks(g.id)
            return { ...g, stockCodes: stocks.map(s => s.stock_code) }
          } catch {
            return { ...g, stockCodes: [] }
          }
        })
      )
      setGroups(groupsWithStocks)

      // 收集所有組別的股票（只訂閱組別入面的）
      const allStockCodes = new Set<string>()
      groupsWithStocks.forEach(g => {
        if (g.stockCodes) {
          g.stockCodes.forEach(c => allStockCodes.add(c))
        }
      })
      const allCodes = Array.from(allStockCodes)

      // 更新訂閱（只在連接後）
      if (connected) {
        console.log('[HomePage] 更新訂閱:', allCodes)
        init(allCodes)
      } else {
        // 等待連接後再init
        console.log('[HomePage] WS 未連接，設置 pendingInitCodes:', allCodes)
        setPendingInitCodes(allCodes)
      }

      // 預設展開第一個組
      if (groupsWithStocks.length > 0) {
        setExpandedGroups(new Set([groupsWithStocks[0].id]))
      }
    } catch (err) {
      console.error('載入組別失敗:', err)
      message.error('載入組別失敗')
    } finally {
      setLoading(false)
    }
  }

  // 當 pendingInitCodes 改變時，如果已連接，調用 init（force）
  useEffect(() => {
    if (pendingInitCodes && connected) {
      console.log('[HomePage] pendingInitCodes 已更新，強制 init:', pendingInitCodes)
      init(pendingInitCodes, true)  // force=true 強制重新初始化
    }
  }, [pendingInitCodes, connected, init])

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
  const handleAddStock = (groupId: string, groupName: string) => {
    setAddStockToGroup({ id: groupId, name: groupName })
    setShowAddStockModal(true)
  }

  // 確認添加股票
  const handleConfirmAddStock = async (code: string, name: string) => {
    if (addStockToGroup) {
      try {
        // 1. 保存到 DB
        await groupApi.addStock(addStockToGroup.id, code)
        
        // 2. 只訂閱新加的股票
        console.log('[HomePage] 追加訂閱:', [code])
        subscribe([code])
        
        // 3. 更新 UI state（把新股票放到最上面）
        setGroups(prev => prev.map(g => {
          if (g.id === addStockToGroup.id) {
            return { ...g, stockCodes: [code, ...(g.stockCodes || [])] }
          }
          return g
        }))
        
        message.success(`已添加 ${name} 到 ${addStockToGroup.name}`)
      } catch (err) {
        console.error('添加股票失敗:', err)
        message.error('添加股票失敗')
      }
    }
  }

  // 處理移除股票
  const handleRemoveStock = async (groupId: string, code: string) => {
    try {
      await groupApi.removeStock(groupId, code)
      // 從 UI 移除
      setGroups(prev => prev.map(g => {
        if (g.id === groupId) {
          return { ...g, stockCodes: (g.stockCodes || []).filter(c => c !== code) }
        }
        return g
      }))
      message.success('股票已從組別移除')
    } catch (err) {
      console.error('移除股票失敗:', err)
      message.error('移除股票失敗')
    }
  }

  // 處理移動股票（顯示 Modal）
  const handleMoveStock = (code: string, stockName: string) => {
    // 找到股票所在的組別
    const group = groups.find(g => (g.stockCodes || []).includes(code))
    if (group) {
      setMovingStock({ code, name: stockName, fromGroupId: group.id })
      setShowMoveStockModal(true)
    }
  }

  // 確認增加到其他組別（複製，不刪除原本）
  const handleConfirmAddToGroup = async (targetGroupId: string) => {
    if (!movingStock) return
    
    try {
      // 只需要添加到新組別，不刪除原本的
      await groupApi.addStock(targetGroupId, movingStock.code)
      
      // 更新 UI：目標組別加上股票
      setGroups(prev => prev.map(g => {
        if (g.id === targetGroupId && !g.stockCodes?.includes(movingStock.code)) {
          return { ...g, stockCodes: [movingStock.code, ...(g.stockCodes || [])] }
        }
        return g
      }))
      
      message.success(`已將 ${movingStock.name} 增加到目標組別`)
      setShowMoveStockModal(false)
      setMovingStock(null)
    } catch (err) {
      console.error('增加到其他組別失敗:', err)
      message.error('增加到其他組別失敗')
    }
  }

  // 處理組別內股票排序
  const handleReorderStocks = (groupId: string, oldIndex: number, newIndex: number) => {
    setGroups(prev => prev.map(g => {
      if (g.id === groupId && g.stockCodes) {
        const newStockCodes = arrayMove(g.stockCodes, oldIndex, newIndex)
        return { ...g, stockCodes: newStockCodes }
      }
      return g
    }))
    // TODO: 保存位置到 DB
  }

  // 處理關注股票（預留功能）
  const handleWatchStock = (code: string, stockName: string) => {
    message.info(`已關注 ${stockName}（功能待實現）`)
    console.log('[HomePage] 關注股票:', code, stockName)
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
          open: quote.open_price,
          high: quote.high_price,
          low: quote.low_price,
          prevClose: quote.prev_close,
          volume: quote.volume,
          turnover: quote.turnover,
        }
      }
      return {
        code,
        name: quote?.name || code,
        price: 0,
        change: 0,
        pctChange: 0,
        open: 0,
        high: 0,
        low: 0,
        prevClose: 0,
        volume: 0,
        turnover: 0,
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
                    onRemoveStock={handleRemoveStock}
                    onMoveStock={handleMoveStock}
                    onReorderStocks={handleReorderStocks}
                    onWatchStock={handleWatchStock}
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

      {addStockToGroup && (
        <AddStockModal
          open={showAddStockModal}
          groupId={addStockToGroup.id}
          groupName={addStockToGroup.name}
          onClose={() => {
            setShowAddStockModal(false)
            setAddStockToGroup(null)
          }}
          onAdd={handleConfirmAddStock}
        />
      )}

      {movingStock && (
        <MoveStockModal
          open={showMoveStockModal}
          stockCode={movingStock.code}
          stockName={movingStock.name}
          currentGroupId={movingStock.fromGroupId}
          groups={groups}
          onClose={() => {
            setShowMoveStockModal(false)
            setMovingStock(null)
          }}
          onMove={handleConfirmAddToGroup}
        />
      )}
    </AppLayout>
  )
}

export default HomePage

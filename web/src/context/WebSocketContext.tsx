// WebSocket Context - 保持 WebSocket 連接狀態
// 確保頁面導航時連接不會中斷

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'

interface QuoteData {
  code: string
  name: string
  last_price: number
  open_price: number
  high_price: number
  low_price: number
  prev_close: number
  change: number
  pct_change: number
  volume: number
  turnover: number
  update_time: string
}

interface WebSocketContextValue {
  connected: boolean
  subscribed: boolean
  waitingCancel: boolean
  cancelCooldown: number
  quotes: Record<string, QuoteData>
  subscribeStatus: 'success' | 'failed' | 'waiting' | null
  init: (codes: string[]) => void
  unsubscribeAll: () => void
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null)

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [waitingCancel, setWaitingCancel] = useState(false)
  const [cancelCooldown, setCancelCooldown] = useState(0)
  const [subscribeStatus, setSubscribeStatus] = useState<'success' | 'failed' | 'waiting' | null>(null)
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({})
  
  const wsRef = useRef<WebSocket | null>(null)
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null)
  const hasInitialized = useRef(false)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return // 已經連接
    }

    const wsUrl = `ws://${window.location.hostname}:18792/ws/quote`
    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      setConnected(true)
      console.log('[WS] 已連接')
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      console.log('[WS] 收到:', data)

      // 處理 quote
      if (data.type === 'quote') {
        setQuotes(prev => ({
          ...prev,
          [data.code]: {
            code: data.code,
            name: data.name,
            last_price: data.last_price,
            open_price: data.open_price,
            high_price: data.high_price,
            low_price: data.low_price,
            prev_close: data.prev_close,
            change: data.change,
            pct_change: data.pct_change,
            volume: data.volume,
            turnover: data.turnover,
            update_time: data.update_time,
          }
        }))
      }

      // 處理 init_result
      if (data.type === 'init_result') {
        if (data.success) {
          setSubscribed(true)
          setSubscribeStatus('success')
        } else {
          setSubscribed(false)
          if (data.cooldown) {
            setWaitingCancel(true)
            setCancelCooldown(data.cooldown)
            setSubscribeStatus('waiting')
            startCooldownTimer(data.cooldown)
          } else {
            setSubscribeStatus('failed')
          }
        }
        // 3秒後清除狀態
        setTimeout(() => setSubscribeStatus(null), 3000)
      }

      // 處理取消訂閱結果
      if (data.type === 'all_unsubscribed') {
        if (data.success) {
          setSubscribed(false)
          setWaitingCancel(false)
          setCancelCooldown(0)
          setSubscribeStatus(null)
        }
      }

      // 處理取消失敗
      if (data.type === 'unsubscribe_failed') {
        setWaitingCancel(true)
        setSubscribeStatus('waiting')
        const cooldown = data.cooldown || 60
        setCancelCooldown(cooldown)
        startCooldownTimer(cooldown)
      }
    }

    ws.onerror = (error) => {
      console.error('[WS] 錯誤:', error)
      setConnected(false)
    }

    ws.onclose = () => {
      setConnected(false)
      setSubscribed(false)
      console.log('[WS] 已斷開')
      // 清除計時器
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current)
        cooldownTimerRef.current = null
      }
    }

    wsRef.current = ws
  }, [])

  // 啟動取消冷卻倒計時
  const startCooldownTimer = (seconds: number) => {
    if (cooldownTimerRef.current) {
      clearInterval(cooldownTimerRef.current)
    }
    cooldownTimerRef.current = setInterval(() => {
      setCancelCooldown(prev => {
        if (prev <= 1) {
          clearInterval(cooldownTimerRef.current!)
          cooldownTimerRef.current = null
          setWaitingCancel(false)
          setSubscribeStatus(null)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  // 初始化訂閱（只執行一次）
  const init = useCallback((codes: string[]) => {
    if (hasInitialized.current) {
      console.log('[WS] 已初始化，跳過')
      return
    }
    
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      hasInitialized.current = true
      setSubscribeStatus(null)
      wsRef.current.send(JSON.stringify({ action: 'init', codes }))
      console.log('[WS] 發送 init:', codes)
    }
  }, [])

  // 取消所有訂閱
  const unsubscribeAll = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      setWaitingCancel(true)
      wsRef.current.send(JSON.stringify({ action: 'unsubscribe_all' }))
    }
  }, [])

  // 連接（只在首次 mount 時）
  useEffect(() => {
    connect()
    
    return () => {
      // 不在 unmount 時關閉連接，保持連接狀態
    }
  }, [connect])

  const value: WebSocketContextValue = {
    connected,
    subscribed,
    waitingCancel,
    cancelCooldown,
    quotes,
    subscribeStatus,
    init,
    unsubscribeAll,
  }

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  )
}

// Hook 來使用 WebSocket Context
export function useWebSocketContext() {
  const context = useContext(WebSocketContext)
  if (!context) {
    throw new Error('useWebSocketContext must be used within WebSocketProvider')
  }
  return context
}

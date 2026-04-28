// WebSocket Context - 保持 WebSocket 連接狀態
// 確保頁面導航時連接不會中斷

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { WS_BASE } from '../config'

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
  init: (codes: string[], force?: boolean) => void
  subscribe: (codes: string[]) => void
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
  const [initCodes, setInitCodes] = useState<string[] | null>(null)
  
  const wsRef = useRef<WebSocket | null>(null)
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null)
  const initSentRef = useRef(false)
  const pendingInitRef = useRef<string[] | null>(null)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    const ws = new WebSocket(`${WS_BASE}/quote`)

    ws.onopen = () => {
      setConnected(true)
      console.log('[WS] 已連接, readyState=', ws.readyState)
      if (pendingInitRef.current) {
        console.log('[WS] onopen 發送 pending init:', pendingInitRef.current)
        ws.send(JSON.stringify({ action: 'init', codes: pendingInitRef.current }))
        pendingInitRef.current = null
        setInitCodes(null)
      }
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      console.log('[WS] 收到:', data)

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
        setTimeout(() => setSubscribeStatus(null), 3000)
      }

      if (data.type === 'all_unsubscribed') {
        if (data.success) {
          setSubscribed(false)
          setWaitingCancel(false)
          setCancelCooldown(0)
          setSubscribeStatus(null)
        }
      }

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
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current)
        cooldownTimerRef.current = null
      }
    }

    wsRef.current = ws
  }, [])

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

  const init = useCallback((codes: string[], force: boolean = false) => {
    console.log('[WS] init 被調用, initSentRef.current=', initSentRef.current, 'subscribed=', subscribed, 'force=', force, 'wsReady=', wsRef.current?.readyState)
    if (subscribed) {
      console.log('[WS] 已訂閱，跳過')
      return
    }
    if (initSentRef.current && !force) {
      console.log('[WS] 已發送過 init（無 force），跳過')
      return
    }
    
    console.log('[WS] init 被調用，設置股票列表:', codes)
    initSentRef.current = true
    pendingInitRef.current = codes
    setInitCodes(codes)

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[WS] WS 已是 OPEN，直接發送 init:', codes)
      wsRef.current.send(JSON.stringify({ action: 'init', codes }))
      setInitCodes(null)
    } else {
      console.log('[WS] WS 未連接，等待 onopen 後發送')
    }
  }, [subscribed])

  useEffect(() => {
    console.log('[WS] initCodes effect: connected=', connected, 'initCodes=', initCodes, 'wsState=', wsRef.current?.readyState)
    if (connected && initCodes && wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[WS] 發送 init:', initCodes)
      wsRef.current.send(JSON.stringify({ action: 'init', codes: initCodes }))
      setInitCodes(null)
    }
  }, [connected, initCodes])

  useEffect(() => {
    if (connected && pendingInitRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[WS] WS opened with pending init:', pendingInitRef.current)
      wsRef.current.send(JSON.stringify({ action: 'init', codes: pendingInitRef.current }))
      pendingInitRef.current = null
      setInitCodes(null)
    }
  }, [connected])

  const unsubscribeAll = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      setWaitingCancel(true)
      wsRef.current.send(JSON.stringify({ action: 'unsubscribe_all' }))
    }
  }, [])

  const subscribe = useCallback((codes: string[]) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log('[WS] 追加訂閱:', codes)
      wsRef.current.send(JSON.stringify({ action: 'subscribe', codes }))
    }
  }, [])

  useEffect(() => {
    console.log('[WS] WebSocketProvider mounted，開始連接')
    connect()
  }, [connect])

  const value: WebSocketContextValue = {
    connected,
    subscribed,
    waitingCancel,
    cancelCooldown,
    quotes,
    subscribeStatus,
    init,
    subscribe,
    unsubscribeAll,
  }

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  )
}

export function useWebSocketContext() {
  const context = useContext(WebSocketContext)
  if (!context) {
    throw new Error('useWebSocketContext must be used within WebSocketProvider')
  }
  return context
}
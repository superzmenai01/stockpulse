// useWebSocket - WebSocket Hook
// 管理 WebSocket 連接和股票訂閱

import { useState, useEffect, useRef, useCallback } from 'react'

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

type SubscribeStatus = 'success' | 'failed' | 'waiting' | null

interface UseWebSocketReturn {
  connected: boolean
  subscribed: boolean
  waitingCancel: boolean
  cancelCooldown: number
  quotes: Record<string, QuoteData>
  subscribeStatus: SubscribeStatus
  init: (codes: string[]) => void
  unsubscribeAll: () => void
}

export function useWebSocket(): UseWebSocketReturn {
  const [connected, setConnected] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [waitingCancel, setWaitingCancel] = useState(false)
  const [cancelCooldown, setCancelCooldown] = useState(0)
  const [subscribeStatus, setSubscribeStatus] = useState<SubscribeStatus>(null)
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({})
  const wsRef = useRef<WebSocket | null>(null)
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null)

  // 連接 WebSocket
  const connect = useCallback(() => {
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
          // 如果有 cooldown 訊息，設置等待狀態
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
          setWaitingCancel(false)
          setSubscribeStatus(null)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  // 初始化訂閱
  const init = useCallback((codes: string[]) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      setSubscribeStatus(null) // 清除之前狀態
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

  // 連接
  useEffect(() => {
    connect()
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current)
      }
    }
  }, [connect])

  return {
    connected,
    subscribed,
    waitingCancel,
    cancelCooldown,
    quotes,
    subscribeStatus,
    init,
    unsubscribeAll,
  }
}

export type { QuoteData }

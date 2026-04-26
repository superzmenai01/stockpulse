import { useEffect, useState, useRef } from 'react'
import { Card, Row, Col, Typography, Tag, Button, Space, Statistic } from 'antd'
import { useNavigate } from 'react-router-dom'
import './HomePage.css'

const { Title, Text } = Typography

// STUB: 硬編碼的測試股票（之後會變成從數據庫讀取）
const INITIAL_STOCKS = ['HK.00700', 'HK.00981', 'HK.00005', 'HK.01810', 'HK.02382']

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

interface StockDisplayProps {
  quote: QuoteData
}

function StockCard({ quote }: StockDisplayProps) {
  const isPositive = quote.change >= 0
  const changeColor = isPositive ? '#f5222d' : '#52c41a'  // 紅升綠降

  return (
    <Card size="small" className="stock-card">
      <Row gutter={16} align="middle">
        {/* 股票名稱和代碼 */}
        <Col span={8}>
          <Text strong style={{ fontSize: 16 }}>{quote.name}</Text>
          <br />
          <Text code style={{ fontSize: 12 }}>{quote.code}</Text>
        </Col>

        {/* 價格 */}
        <Col span={8} style={{ textAlign: 'center' }}>
          <Text strong style={{ fontSize: 24, color: '#1890ff' }}>
            {quote.last_price.toFixed(2)}
          </Text>
        </Col>

        {/* 升跌 */}
        <Col span={8} style={{ textAlign: 'right' }}>
          <Tag 
            color={isPositive ? 'red' : 'green'} 
            style={{ fontSize: 14, padding: '4px 12px' }}
          >
            {isPositive ? '+' : ''}{quote.change.toFixed(3)}
          </Tag>
          <br />
          <Tag 
            color={isPositive ? 'red' : 'green'}
            style={{ fontSize: 12, marginTop: 4 }}
          >
            {isPositive ? '+' : ''}{quote.pct_change.toFixed(2)}%
          </Tag>
        </Col>
      </Row>

      {/* 詳細資訊 */}
      <Row gutter={16} style={{ marginTop: 12 }}>
        <Col span={8}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            開盤: {quote.open_price.toFixed(2)}
          </Text>
        </Col>
        <Col span={8} style={{ textAlign: 'center' }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            最高: {quote.high_price.toFixed(2)}
          </Text>
        </Col>
        <Col span={8} style={{ textAlign: 'right' }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            最低: {quote.low_price.toFixed(2)}
          </Text>
        </Col>
      </Row>

      {/* 更新時間 */}
      <div style={{ marginTop: 8, textAlign: 'right' }}>
        <Text type="secondary" style={{ fontSize: 10 }}>
          更新: {quote.update_time}
        </Text>
      </div>
    </Card>
  )
}

function HomePage() {
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({})
  const [connected, setConnected] = useState(false)
  const [initDone, setInitDone] = useState(false)
  const [waitingCancel, setWaitingCancel] = useState(false)  // 等待取消中
  const [cancelCooldown, setCancelCooldown] = useState(0)  // 取消冷卻倒計時
  const wsRef = useRef<WebSocket | null>(null)
  const navigate = useNavigate()
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null)

  // 連接 WebSocket
  const connectWebSocket = () => {
    const wsUrl = `ws://192.168.1.125:18792/ws/quote`
    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      setConnected(true)
      console.log('[WS] 已連接')
      // 發送初始化訂閱
      const initMsg = { action: 'init', codes: INITIAL_STOCKS }
      ws.send(JSON.stringify(initMsg))
      console.log('[WS] 發送初始化:', INITIAL_STOCKS)
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      console.log('[WS] 收到:', data)

      // 只處理 quote 類型的消息
      if (data.type === 'quote') {
        const quoteData: QuoteData = {
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
        // 用 code 作為 key，確保位置固定
        setQuotes(prev => ({
          ...prev,
          [data.code]: quoteData
        }))
      }

      // 處理 init_result
      if (data.type === 'init_result') {
        setInitDone(data.success || false)
      }

      // 處理取消訂閱結果
      if (data.type === 'all_unsubscribed') {
        if (data.success) {
          setInitDone(false)
          setWaitingCancel(false)
          setCancelCooldown(0)
        }
      }

      // 處理取消訂閱失敗（如未滿1分鐘）
      if (data.type === 'unsubscribe_failed') {
        setWaitingCancel(true)
        const cooldownSec = data.cooldown || 60
        setCancelCooldown(cooldownSec)
        startCooldownTimer(cooldownSec)
      }
    }

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
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }

    ws.onerror = (error) => {
      console.error('[WS] 錯誤:', error)
    }

    ws.onclose = () => {
      setConnected(false)
      console.log('[WS] 已斷開')
    }

    wsRef.current = ws
  }

  // 發送取消所有訂閱
  const sendUnsubscribeAll = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      setWaitingCancel(true)
      wsRef.current.send(JSON.stringify({ action: 'unsubscribe_all' }))
    }
  }

  // 頁面加載時連接
  useEffect(() => {
    connectWebSocket()
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

  // 頁面刷新/關閉前發送取消訂閱
  useEffect(() => {
    const handleBeforeUnload = () => {
      sendUnsubscribeAll()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  // 登出
  const handleLogout = () => {
    sendUnsubscribeAll()
    setTimeout(() => {
      navigate('/login')
    }, 500)
  }

  return (
    <div className="home-page">
      <div className="header">
        <Title level={3} style={{ margin: 0 }}>📈 StockPulse</Title>
        <Space direction="vertical" style={{ textAlign: 'right' }}>
          <Space>
            <Tag color={connected ? 'green' : 'red'}>
              {connected ? '已連接' : '未連接'}
            </Tag>
            <Tag color={waitingCancel ? 'purple' : (initDone ? 'blue' : 'orange')}>
              {waitingCancel ? '等待取消' : (initDone ? '已訂閱' : '未訂閱')}
            </Tag>
            {waitingCancel && cancelCooldown > 0 && (
              <Tag color="purple">
                等待取消: {cancelCooldown}秒
              </Tag>
            )}
          </Space>
          {!waitingCancel && initDone && (
            <Button danger size="small" onClick={sendUnsubscribeAll}>
              取消所有訂閱
            </Button>
          )}
          {waitingCancel && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              富途要求訂閱滿1分鐘後才能取消
            </Text>
          )}
        </Space>
      </div>

      <div className="stocks-container">
        {/* 股票列表 */}
        {INITIAL_STOCKS.map(code => (
          quotes[code] ? (
            <StockCard key={code} quote={quotes[code]} />
          ) : (
            <Card size="small" key={code} className="stock-card loading">
              <Text type="secondary">載入中: {code}</Text>
            </Card>
          )
        ))}
      </div>

      {/* 最後更新時間 */}
      {Object.keys(quotes).length > 0 && (
        <div className="footer">
          <Text type="secondary" style={{ fontSize: 11 }}>
            數據來源: 富途 | 休市期間顯示最後收盤價
          </Text>
        </div>
      )}
    </div>
  )
}

export default HomePage

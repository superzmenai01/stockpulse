import { useEffect, useState, useRef } from 'react'
import { Card, List, Typography, Tag, Button, message, Space } from 'antd'
import { useNavigate } from 'react-router-dom'

const { Title, Text } = Typography

// STUB: 硬編碼的測試股票（之後會變成從數據庫讀取）
const INITIAL_STOCKS = ['HK.00700', 'HK.00981']

interface QuoteMessage {
  type: string
  code?: string
  price?: number
  message?: string
  success?: boolean
}

function HomePage() {
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState<QuoteMessage[]>([])
  const [initDone, setInitDone] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const navigate = useNavigate()

  // 連接 WebSocket
  const connectWebSocket = () => {
    const wsUrl = `ws://${window.location.hostname}:18792/ws/quote`
    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      setConnected(true)
      message.success('WebSocket 已連接')
      console.log('[WS] 已連接到後端')

      // 發送初始化訂閱
      const initMsg = {
        action: 'init',
        codes: INITIAL_STOCKS
      }
      ws.send(JSON.stringify(initMsg))
      console.log('[WS] 發送初始化:', INITIAL_STOCKS)
    }

    ws.onmessage = (event) => {
      const data: QuoteMessage = JSON.parse(event.data)
      console.log('[WS] 收到:', data)
      setMessages(prev => [...prev.slice(-14), data])

      // 處理初始化結果
      if (data.type === 'init_result') {
        if (data.success) {
          setInitDone(true)
          message.success('股票訂閱成功')
        } else {
          message.error(data.message || '初始化失敗')
        }
      }

      // 處理取消訂閱結果
      if (data.type === 'all_unsubscribed') {
        message.info('已取消所有訂閱')
        setInitDone(false)
      }
    }

    ws.onerror = (error) => {
      console.error('[WS] 錯誤:', error)
      message.error('WebSocket 連接失敗')
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
      wsRef.current.send(JSON.stringify({ action: 'unsubscribe_all' }))
      console.log('[WS] 發送 unsubscribe_all')
    }
  }

  // 頁面加載時連接
  useEffect(() => {
    connectWebSocket()
    return () => {
      // 組件卸載時清理
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

  // 頁面刷新/關閉前發送取消訂閱
  useEffect(() => {
    const handleBeforeUnload = () => {
      console.log('[WS] 頁面即将刷新/關閉，發送 unsubscribe_all')
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
    // 等待一下讓請求發送出去
    setTimeout(() => {
      navigate('/login')
    }, 500)
  }

  // 渲染消息
  const renderMessage = (msg: QuoteMessage, index: number) => {
    const getTagColor = () => {
      switch (msg.type) {
        case 'quote': return 'blue'
        case 'init_result': return msg.success ? 'green' : 'red'
        case 'subscribed': return 'cyan'
        case 'all_unsubscribed': return 'orange'
        case 'pong': return 'purple'
        default: return 'gray'
      }
    }

    return (
      <List.Item key={index}>
        <Tag color={getTagColor()}>{msg.type}</Tag>
        <Text code={msg.code}>{msg.code}</Text>
        <Text>{msg.message || (msg.price ? `$${msg.price}` : '')}</Text>
      </List.Item>
    )
  }

  return (
    <div>
      <Title level={3}>📈 StockPulse 控制台</Title>
      
      <Card 
        title="連接狀態" 
        style={{ marginBottom: 16 }}
        extra={
          <Space>
            <Tag color={connected ? 'green' : 'red'}>
              {connected ? '已連接' : '未連接'}
            </Tag>
            <Tag color={initDone ? 'blue' : 'orange'}>
              {initDone ? '已訂閱' : '未訂閱'}
            </Tag>
          </Space>
        }
      >
        <p>初始股票: <Tag>{INITIAL_STOCKS.join(', ')}</Tag></p>
        <Space>
          <Button 
            danger 
            onClick={sendUnsubscribeAll}
            disabled={!connected || !initDone}
          >
            取消所有訂閱
          </Button>
          <Button onClick={handleLogout}>
            登出
          </Button>
        </Space>
        <p style={{ marginTop: 8, color: '#888', fontSize: 12 }}>
          💡 刷新頁面或關閉頁面時會自動取消訂閱
        </p>
      </Card>

      <Card title="📩 收到的消息">
        <List
          size="small"
          dataSource={messages}
          renderItem={renderMessage}
          locale={{ emptyText: '尚未收到任何消息...' }}
        />
      </Card>
    </div>
  )
}

export default HomePage

import { useEffect, useState, useRef } from 'react'
import { Card, List, Typography, Tag, message } from 'antd'

const { Title } = Typography

// STUB: 硬編碼的測試股票
const TEST_STOCKS = ['HK.00700', 'HK.00981']

interface QuoteMessage {
  type: string
  code?: string
  price?: number
  message?: string
}

function HomePage() {
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState<QuoteMessage[]>([])
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    connectWebSocket()
    return () => {
      wsRef.current?.close()
    }
  }, [])

  const connectWebSocket = () => {
    const wsUrl = `ws://${window.location.hostname}:18792/ws/quote`
    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      setConnected(true)
      message.success('WebSocket 已連接')
      console.log('[WS] 已連接到後端')

      // STUB: 自動發送訂閱請求（測試用）
      const subscribeMsg = {
        action: 'subscribe',
        codes: TEST_STOCKS
      }
      ws.send(JSON.stringify(subscribeMsg))
      console.log('[WS] 發送測試訂閱:', TEST_STOCKS)
    }

    ws.onmessage = (event) => {
      const data: QuoteMessage = JSON.parse(event.data)
      console.log('[WS] 收到:', data)
      setMessages(prev => [...prev.slice(-9), data]) // 保留最近 10 條
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

  const renderMessage = (msg: QuoteMessage, index: number) => {
    if (msg.type === 'quote') {
      return (
        <List.Item key={index}>
          <Tag color="blue">{msg.code}</Tag>
          <span>{msg.message || `價格: ${msg.price}`}</span>
        </List.Item>
      )
    }
    return (
      <List.Item key={index}>
        <Tag color={msg.type === 'subscribed' ? 'green' : 'orange'}>
          {msg.type}
        </Tag>
        <span>{msg.message}</span>
      </List.Item>
    )
  }

  return (
    <div>
      <Title level={3}>📈 StockPulse 控制台</Title>
      
      <Card 
        title="連接狀態" 
        style={{ marginBottom: 16 }}
        extra={<Tag color={connected ? 'green' : 'red'}>{connected ? '已連接' : '未連接'}</Tag>}
      >
        <p>測試股票: <Tag>{TEST_STOCKS.join(', ')}</Tag></p>
        <p>自動發送訂閱請求到後端，收到回覆後顯示係下面：</p>
      </Card>

      <Card title="📩 收到的消息">
        <List
          dataSource={messages}
          renderItem={renderMessage}
          locale={{ emptyText: '尚未收到任何消息...' }}
        />
      </Card>
    </div>
  )
}

export default HomePage

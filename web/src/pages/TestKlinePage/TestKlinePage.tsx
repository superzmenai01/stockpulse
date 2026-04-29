// TestKlinePage - K線圖除錯測試頁面
// 用於測試不同週期的K線數據，顯示詳細的調試信息

import React, { useEffect, useState, useRef } from 'react'
import { createChart, CandlestickSeries, HistogramSeries, Time } from 'lightweight-charts'
import { Button, Card, Space, Tag, Table, Divider } from 'antd'
import { AppLayout } from '../../components/layout'

interface KLine {
  time: string
  timeParsed: string
  timeType: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface RawKLine {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

const PERIODS = [
  { label: '1分鐘K', value: '1m' },
  { label: '日K', value: '1d' },
  { label: '月K', value: '1M' },
  { label: '年K', value: '1y' },
]

// 測試用的股票
const TEST_STOCKS = [
  { code: 'HK.00700', name: '騰訊控股' },
  { code: 'HK.00981', name: '中芯國際' },
  { code: 'US.INTC', name: '英特爾 Intel' },
]

// 解析時間的函數
const parseTime = (timeStr: string, period: string): { parsed: string; type: string } => {
  if (period === '1m') {
    const date = new Date(timeStr)
    const ts = Math.floor(date.getTime() / 1000)
    return { parsed: `${ts} (Unix)`, type: typeof ts === 'number' ? 'number' : 'unknown' }
  }
  if (period === '1d') {
    return { parsed: timeStr.substring(0, 10), type: 'string YYYY-MM-DD' }
  }
  if (period === '1M') {
    // 後端返回 2025-05-01 00:00:00 格式
    if (timeStr.includes('-') && timeStr.length >= 10) {
      return { parsed: timeStr.substring(0, 10), type: 'string YYYY-MM-DD (from backend)' }
    }
    return { parsed: timeStr.substring(0, 7) + '-01', type: 'string YYYY-MM-01' }
  }
  if (period === '1y') {
    // 後端返回 2026-01-01 00:00:00 格式
    if (timeStr.includes('-') && timeStr.length >= 10) {
      return { parsed: timeStr.substring(0, 10), type: 'string YYYY-MM-DD (from backend)' }
    }
    return { parsed: timeStr.substring(0, 4) + '-01-01', type: 'string YYYY-01-01' }
  }
  return { parsed: timeStr, type: 'unknown' }
}

export default function TestKlinePage() {
  const [selectedStock, setSelectedStock] = useState(TEST_STOCKS[0])
  const [selectedPeriod, setSelectedPeriod] = useState('1d')
  const [rawData, setRawData] = useState<RawKLine[]>([])
  const [parsedData, setParsedData] = useState<KLine[]>([])
  const [apiResponse, setApiResponse] = useState<any>(null)
  const [error, setError] = useState<string>('')
  const [loading, setLoading] = useState(false)
  
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInstanceRef = useRef<any>(null)

  // 載入K線數據
  const loadData = async () => {
    setLoading(true)
    setError('')
    console.log(`[TestKline] 開始載入: ${selectedStock.code} ${selectedPeriod}`)
    
    try {
      const res = await fetch(
        `http://${window.location.hostname}:18792/api/kline?code=${selectedStock.code}&period=${selectedPeriod}&count=10`
      )
      const data = await res.json()
      
      console.log('[TestKline] API 回應:', data)
      setApiResponse(data)
      setRawData(data.klines || [])
      
      // 解析時間
      const parsed = (data.klines || []).map((k: RawKLine) => {
        const { parsed, type } = parseTime(k.time, selectedPeriod)
        return {
          ...k,
          timeParsed: parsed,
          timeType: type,
        }
      })
      setParsedData(parsed)
      console.log('[TestKline] 解析後的數據:', parsed)
      
      // 嘗試繪製圖表
      if (chartRef.current && data.klines?.length > 0) {
        drawChart(data.klines, selectedPeriod)
      }
    } catch (err: any) {
      console.error('[TestKline] 錯誤:', err)
      setError(err.message || '載入失敗')
    } finally {
      setLoading(false)
    }
  }

  // 繪製圖表
  const drawChart = (klines: RawKLine[], period: string) => {
    if (!chartRef.current) return
    
    console.log('[TestKline] 開始繪製圖表, klines:', klines.length)
    
    // 清除舊圖表
    if (chartInstanceRef.current) {
      chartInstanceRef.current.remove()
      chartInstanceRef.current = null
    }
    
    const chart = createChart(chartRef.current, {
      width: 800,
      height: 400,
      layout: { background: { color: '#0D1114' }, textColor: '#D1D1D1' },
      grid: { vertLines: { color: '#21262D' }, horzLines: { color: '#21262D' } },
    })
    
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26BA75',
      downColor: '#EE5151',
    })
    
    // 準備數據
    const candleData: any[] = []
    for (const k of klines) {
      const { parsed, type } = parseTime(k.time, period)
      console.log(`[TestKline] K線: time=${k.time} -> parsed=${parsed}, type=${type}`)
      
      let timeValue: Time
      if (period === '1m') {
        timeValue = Math.floor(new Date(k.time).getTime() / 1000) as Time
      } else {
        timeValue = parsed as Time
      }
      
      candleData.push({
        time: timeValue,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
      })
    }
    
    console.log('[TestKline] 最終 candleData:', JSON.stringify(candleData, null, 2))
    
    try {
      candlestickSeries.setData(candleData)
      chart.timeScale().fitContent()
      chartInstanceRef.current = chart
      console.log('[TestKline] 圖表繪製成功')
    } catch (err: any) {
      console.error('[TestKline] 圖表繪製失敗:', err)
      setError(`圖表錯誤: ${err.message}`)
    }
  }

  // 初始載入
  useEffect(() => {
    loadData()
  }, [selectedStock, selectedPeriod])

  const columns = [
    { title: '時間(原始)', dataIndex: 'time', key: 'time' },
    { title: '時間(解析)', dataIndex: 'timeParsed', key: 'timeParsed' },
    { title: '時間類型', dataIndex: 'timeType', key: 'timeType' },
    { title: '開', dataIndex: 'open', key: 'open' },
    { title: '高', dataIndex: 'high', key: 'high' },
    { title: '低', dataIndex: 'low', key: 'low' },
    { title: '收', dataIndex: 'close', key: 'close' },
    { title: '成交量', dataIndex: 'volume', key: 'volume' },
  ]

  return (
    <AppLayout connected={true} subscribed={true} waitingCancel={false} cancelCooldown={0} onUnsubscribe={() => {}}>
      <div style={{ padding: 20 }}>
        <h1>K線圖除錯測試頁面</h1>
        
        {/* 控制區 */}
        <Card title="控制面板" style={{ marginBottom: 16 }}>
          <Space direction="vertical">
            <Space>
              <span>股票:</span>
              {TEST_STOCKS.map(s => (
                <Button 
                  key={s.code} 
                  type={selectedStock.code === s.code ? 'primary' : 'default'}
                  onClick={() => setSelectedStock(s)}
                >
                  {s.name}
                </Button>
              ))}
            </Space>
            <Space>
              <span>週期:</span>
              {PERIODS.map(p => (
                <Button 
                  key={p.value} 
                  type={selectedPeriod === p.value ? 'primary' : 'default'}
                  onClick={() => setSelectedPeriod(p.value)}
                >
                  {p.label}
                </Button>
              ))}
            </Space>
            <Button onClick={loadData} loading={loading}>重新載入</Button>
          </Space>
        </Card>

        {/* 錯誤顯示 */}
        {error && (
          <Card title="錯誤" style={{ marginBottom: 16, borderColor: '#EE5151' }}>
            <Tag color="error">{error}</Tag>
          </Card>
        )}

        {/* API 回應 */}
        <Card title="API 回應 (mock: {apiResponse?.mock})" style={{ marginBottom: 16 }}>
          <pre style={{ maxHeight: 200, overflow: 'auto', fontSize: 12 }}>
            {JSON.stringify(apiResponse, null, 2)}
          </pre>
        </Card>

        {/* 圖表預覽 */}
        <Card title="圖表預覽" style={{ marginBottom: 16 }}>
          <div ref={chartRef} style={{ width: '100%', height: 400, background: '#0D1114' }} />
        </Card>

        {/* 數據表格 */}
        <Card title="解析後的K線數據">
          <Table 
            dataSource={parsedData} 
            columns={columns} 
            rowKey="time"
            size="small"
            pagination={false}
            scroll={{ x: true }}
          />
        </Card>

        {/* Console 指引 */}
        <Card title="調試指引" style={{ marginTop: 16 }}>
          <p>1. 打開瀏覽器 Console (F12)</p>
          <p>2. 觀察 [TestKline] 的日誌</p>
          <p>3. 查看時間解析是否正確</p>
          <p>4. 觀察「圖表繪製成功」或錯誤信息</p>
          <p>5. 截圖或複製 Console 錯誤給我</p>
        </Card>
      </div>
    </AppLayout>
  )
}
// ChartContainer - K線圖主容器

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, IChartApi, ISeriesApi, CandlestickData, HistogramData, Time, CandlestickSeries, HistogramSeries } from 'lightweight-charts'
import { useWebSocketContext } from '../../context'
import ChartToolbar from './ChartToolbar'
import styles from './ChartContainer.module.css'

interface StockInfo {
  code: string
  name: string
}

interface KLine {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface ChartContainerProps {
  stock: StockInfo
  period?: string
}

interface ChartData {
  code: string
  name: string
  period: string
  klines: KLine[]
  error?: string
}

const PERIODS = [
  { label: '1分鐘K', value: '1m' },
  { label: '日K', value: '1d' },
  { label: '月K', value: '1M' },
  { label: '年K', value: '1y' },
]

// 將時間字串轉換為 lightweight-charts 的 Time 格式
const parseTime = (timeStr: string, period: string): Time => {
  if (period === '1m') {
    // 分鐘K: 2026-04-28 09:30:00 (HKT) -> Unix timestamp
    // JS new Date() 將字串解析為本地時間(HKT)後轉UTC，導致顯示時間偏早8小時
    // 修復：timestamp + 8小時，讓 lightweight-charts 顯示正確的 HKT 時間
    const date = new Date(timeStr)
    const ts = Math.floor(date.getTime() / 1000)
    return (ts + 8 * 3600) as Time
  }
  if (period === '1d') {
    // 日K: 2025-05-01 00:00:00 -> 2025-05-01
    return timeStr.substring(0, 10) as Time
  }
  if (period === '1M') {
    // 月K: 2025-05-01 00:00:00 -> 2025-05-01
    // 如果已經係 YYYY-MM-DD 格式就直接返回
    if (timeStr.includes('-') && timeStr.length >= 10) {
      return timeStr.substring(0, 10) as Time
    }
    // 否則用舊方法 YYYY-MM -> YYYY-MM-01
    return (timeStr.substring(0, 7) + '-01') as Time
  }
  if (period === '1y') {
    // 年K: 2026-01-01 00:00:00 -> 2026-01-01
    return timeStr.substring(0, 10) as Time
  }
  return timeStr.substring(0, 10) as Time
}

// 創建圖表的工廠函數
const createChartInstance = (container: HTMLDivElement) => {
  const chart = createChart(container, {
    width: container.clientWidth || 800,
    height: container.clientHeight || 450,
    layout: {
      background: { color: '#0D1114' },
      textColor: '#D1D1D1',
    },
    grid: {
      vertLines: { color: '#21262D' },
      horzLines: { color: '#21262D' },
    },
    crosshair: {
      mode: 1,
      vertLine: { color: '#F9A11B', labelBackgroundColor: '#F9A11B' },
      horzLine: { color: '#F9A11B', labelBackgroundColor: '#F9A11B' },
    },
    rightPriceScale: {
      borderColor: '#30363D',
      scaleMargins: { top: 0.1, bottom: 0.2 },
    },
    timeScale: {
      borderColor: '#30363D',
      timeVisible: true,
      secondsVisible: false,
    },
  })

  const candlestickSeries = chart.addSeries(CandlestickSeries, {
    upColor: '#26BA75',
    downColor: '#EE5151',
    borderUpColor: '#26BA75',
    borderDownColor: '#EE5151',
    wickUpColor: '#26BA75',
    wickDownColor: '#EE5151',
  })

  const volumeSeries = chart.addSeries(HistogramSeries, {
    color: '#26BA75',
    priceFormat: { type: 'volume' },
    priceScaleId: '',
  })
  volumeSeries.priceScale().applyOptions({
    scaleMargins: { top: 0.85, bottom: 0 },
  })

  return { chart, candlestickSeries, volumeSeries }
}

export default function ChartContainer({ stock, period = '1d' }: ChartContainerProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  
  // 追蹤當前載入的 period（避免 race condition）
  const loadingPeriodRef = useRef<string>('')
  const dataPeriodRef = useRef<string>('')
  
  // 日期範圍 state
  const today = new Date().toISOString().split('T')[0]
  const [currentPeriod, setCurrentPeriod] = useState(period)
  const [startDate, setStartDate] = useState<string>(today)
  const [endDate, setEndDate] = useState<string>(today)
  
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const { quotes } = useWebSocketContext()

  // 初始化圖表（只在組件 mount 時）
  useEffect(() => {
    if (!chartContainerRef.current) return

    const container = chartContainerRef.current
    const { chart, candlestickSeries, volumeSeries } = createChartInstance(container)

    chartRef.current = chart
    candlestickSeriesRef.current = candlestickSeries
    volumeSeriesRef.current = volumeSeries

    const handleResize = () => {
      if (container && chartRef.current) {
        chartRef.current.applyOptions({
          width: container.clientWidth || 800,
          height: container.clientHeight || 450,
        })
      }
    }
    window.addEventListener('resize', handleResize)
    handleResize()

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
      chartRef.current = null
    }
  }, [])

  // 載入K線數據
  const loadKlineData = useCallback(async (code: string, period: string, start?: string, end?: string) => {
    // 標記當前正在載入的 period
    loadingPeriodRef.current = period
    
    // 直接設置 loading，不延遲（避免閃爍）
    setLoading(true)
    
    try {
      // 時段越大需要的數據越多：1m用500(港股一天390支)，其餘用1000
      const reqCount = period === '1m' ? 500 : 1000
      
      // 構建 URL（加入 start/end 參數）
      const params = new URLSearchParams({
        code,
        period,
        count: String(reqCount),
      })
      if (start) params.set('start', start)
      if (end) params.set('end', end)
      
      const res = await fetch(`http://${window.location.hostname}:18792/api/kline?${params}`)
      const data: ChartData = await res.json()
      
      // 檢查是否係過時的請求（用戶可能已切換到另一個 period）
      if (loadingPeriodRef.current !== period) {
        console.log('[Chart] 請求已過時，忽略')
        return
      }
      
      // 檢查 API 返回的錯誤
      if (data.error) {
        console.warn('[Chart] API 返回錯誤:', data.error)
        setErrorMessage(data.error)
        setLoading(false)
        return
      }
      
      // 清除錯誤訊息
      setErrorMessage(null)
      
      // 設置 data 所屬的 period
      dataPeriodRef.current = period
      
      if (candlestickSeriesRef.current && volumeSeriesRef.current && chartRef.current) {
        // 去重：過濾相同時間的K線（富途返回的數據可能有重複）
        const candleMap = new Map<string, CandlestickData<Time>>()
        for (const k of data.klines) {
          const t = parseTime(k.time, period)
          const tStr = String(t)
          if (!candleMap.has(tStr)) {
            candleMap.set(tStr, {
              time: t,
              open: k.open,
              high: k.high,
              low: k.low,
              close: k.close,
            })
          }
        }
        const candleData = Array.from(candleMap.values())
        
        // 成交量的去重
        const volumeMap = new Map<string, HistogramData<Time>>()
        for (const k of data.klines) {
          const t = parseTime(k.time, period)
          const tStr = String(t)
          if (!volumeMap.has(tStr)) {
            volumeMap.set(tStr, {
              time: t,
              value: k.volume,
              color: k.close >= k.open ? '#26BA7544' : '#EE515144',
            })
          }
        }
        const volumeData = Array.from(volumeMap.values())
        
        candlestickSeriesRef.current.setData(candleData)
        volumeSeriesRef.current.setData(volumeData)

        chartRef.current.timeScale().fitContent()
      }
    } catch (err) {
      console.error('[Chart] 載入K線失敗:', err)
    } finally {
      // 只有當這個請求還係最新的時候先清除 loading
      if (loadingPeriodRef.current === period) {
        setLoading(false)
      }
    }
  }, [])

  // 處理 period 改變
  useEffect(() => {
    // period 改變時清除 data period，確保舊數據不會被用於更新
    dataPeriodRef.current = ''
    loadKlineData(stock.code, currentPeriod, startDate, endDate)
  }, [stock.code, currentPeriod, startDate, endDate, loadKlineData])

  // 實時更新最後一根蠟燭
  useEffect(() => {
    const quote = quotes[stock.code]
    if (!quote || !candlestickSeriesRef.current || loading) return
    if (dataPeriodRef.current !== currentPeriod) return
    
    // 1m 週期：只在交易時間內更新（港股 09:30-16:00 HKT）
    if (currentPeriod === '1m') {
      const now = new Date()
      const hktHour = parseInt(now.toLocaleTimeString('en-US', { timeZone: 'Asia/Hong_Kong', hour12: false }))
      const hktMinute = parseInt(now.toLocaleTimeString('en-US', { timeZone: 'Asia/Hong_Kong', minute: '2-digit', hour12: false }))
      const dayOfWeek = now.getDay()
      // 排除周末（0=周日，6=周六）和非交易時段
      if (dayOfWeek === 0 || dayOfWeek === 6) return
      if (hktHour < 9 || (hktHour === 9 && hktMinute < 30) || hktHour >= 16) return
    }
    
    // 從 quotes 取得實時數據來更新
    const lastKlineTime = quote.last_price ? parseTime(new Date().toISOString(), currentPeriod) : null
    if (!lastKlineTime) return

    candlestickSeriesRef.current.update({
      time: lastKlineTime,
      open: quote.open_price || quote.last_price,
      high: quote.high_price || quote.last_price,
      low: quote.low_price || quote.last_price,
      close: quote.last_price,
    })
  }, [quotes[stock.code], stock.code, currentPeriod, loading])

  const handlePeriodChange = (period: string) => {
    setCurrentPeriod(period)
  }

  const handleDateChange = (start: string, end: string) => {
    setStartDate(start)
    setEndDate(end)
  }

  return (
    <div className={styles.container}>
      <ChartToolbar
        periods={PERIODS}
        currentPeriod={currentPeriod}
        onPeriodChange={handlePeriodChange}
        stockName={stock.name}
        startDate={startDate}
        endDate={endDate}
        onDateChange={handleDateChange}
      />
      <div className={styles.chartWrapper}>
        {loading && <div className={styles.loading}>載入中...</div>}
        {errorMessage && <div className={styles.error}>{errorMessage}</div>}
        {!errorMessage && <div ref={chartContainerRef} className={styles.chart} />}
      </div>
    </div>
  )
}
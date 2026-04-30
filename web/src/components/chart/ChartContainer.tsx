// ChartContainer - K線圖主容器

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, IChartApi, ISeriesApi, CandlestickData, HistogramData, Time, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts'
import { useWebSocketContext } from '../../context'
import ChartToolbar from './ChartToolbar'
import IndicatorPanel, { DEFAULT_INDICATOR_CONFIG, type IndicatorConfig } from './IndicatorPanel'
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
  indicatorConfig?: IndicatorConfig
  onIndicatorChange?: (config: IndicatorConfig) => void
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

const parseTime = (timeStr: string, period: string): Time => {
  if (period === '1m') {
    const date = new Date(timeStr)
    const ts = Math.floor(date.getTime() / 1000)
    return (ts + 8 * 3600) as Time
  }
  if (period === '1d') return timeStr.substring(0, 10) as Time
  if (period === '1M') {
    if (timeStr.includes('-') && timeStr.length >= 10) return timeStr.substring(0, 10) as Time
    return (timeStr.substring(0, 7) + '-01') as Time
  }
  if (period === '1y') return timeStr.substring(0, 10) as Time
  return timeStr.substring(0, 10) as Time
}

// ============ 指標計算函數 ============

function calculateMA(klines: KLine[], period: number): Array<{ time: Time; value: number }> {
  const result: Array<{ time: Time; value: number }> = []
  for (let i = period - 1; i < klines.length; i++) {
    let sum = 0
    for (let j = 0; j < period; j++) {
      sum += klines[i - j].close
    }
    result.push({
      time: parseTime(klines[i].time, '1d'),
      value: parseFloat((sum / period).toFixed(4)),
    })
  }
  return result
}

function calculateEMA(klines: KLine[], period: number): Array<{ time: Time; value: number }> {
  if (klines.length < period) return []

  const result: Array<{ time: Time; value: number }> = []
  const multiplier = 2 / (period + 1)

  let sum = 0
  for (let i = 0; i < period; i++) {
    sum += klines[i].close
  }
  let prevEMA = sum / period

  for (let i = period - 1; i < klines.length; i++) {
    const ema = (klines[i].close - prevEMA) * multiplier + prevEMA
    result.push({
      time: parseTime(klines[i].time, '1d'),
      value: parseFloat(ema.toFixed(4)),
    })
    prevEMA = ema
  }
  return result
}

function calculateBOLL(klines: KLine[], period: number, stdDev: number): { upper: Array<{ time: Time; value: number }>; middle: Array<{ time: Time; value: number }>; lower: Array<{ time: Time; value: number }> } {
  const upper: Array<{ time: Time; value: number }> = []
  const middle: Array<{ time: Time; value: number }> = []
  const lower: Array<{ time: Time; value: number }> = []
  
  for (let i = period - 1; i < klines.length; i++) {
    let sum = 0
    for (let j = 0; j < period; j++) {
      sum += klines[i - j].close
    }
    const sma = sum / period
    
    let variance = 0
    for (let j = 0; j < period; j++) {
      variance += Math.pow(klines[i - j].close - sma, 2)
    }
    const std = Math.sqrt(variance / period)
    
    const time = parseTime(klines[i].time, '1d')
    upper.push({ time, value: parseFloat((sma + stdDev * std).toFixed(4)) })
    middle.push({ time, value: parseFloat(sma.toFixed(4)) })
    lower.push({ time, value: parseFloat((sma - stdDev * std).toFixed(4)) })
  }
  
  return { upper, middle, lower }
}

// ============ ZigZag 計算 ============

interface ZigZagPoint {
  time: Time
  price: number
}

function calculateZigZag(klines: KLine[], thresholdPercent: number = 10, period: string = '1d'): Array<{ time: Time; value: number }> {
  if (klines.length < 2) return []

  const result: Array<{ time: Time; value: number }> = []
  const threshold = thresholdPercent / 100

  // ZigZag 永遠從第一支竹開始
  result.push({
    time: parseTime(klines[0].time, period),
    value: klines[0].close,
  })

  let lastSwingPrice = klines[0].close
  let lastSwingIdx = 0
  let inUptrend = klines[1].close > klines[0].close

  // 找到第一個顯著高/低點
  for (let i = 1; i < klines.length; i++) {
    const change = (klines[i].close - lastSwingPrice) / lastSwingPrice
    if (Math.abs(change) >= threshold) {
      result.push({
        time: parseTime(klines[i].time, period),
        value: klines[i].close,
      })
      lastSwingPrice = klines[i].close
      lastSwingIdx = i
      inUptrend = change > 0
      break
    }
  }

  if (result.length <= 1) {
    // 沒有找到顯著轉向點，只返回第一個點
    return result
  }

  // 繼續追蹤轉向點
  for (let i = lastSwingIdx + 1; i < klines.length; i++) {
    const price = klines[i].close
    const change = (price - lastSwingPrice) / lastSwingPrice

    if (inUptrend) {
      // 上升趨勢：更新 high
      if (price > lastSwingPrice) {
        lastSwingPrice = price
        lastSwingIdx = i
      } else if (change <= -threshold) {
        // 轉向下跌：記錄當前 high 作轉向點
        result.push({
          time: parseTime(klines[lastSwingIdx].time, period),
          value: lastSwingPrice,
        })
        inUptrend = false
        lastSwingPrice = price
        lastSwingIdx = i
      }
    } else {
      // 下跌趨勢：更新 low
      if (price < lastSwingPrice) {
        lastSwingPrice = price
        lastSwingIdx = i
      } else if (change >= threshold) {
        // 轉向上漲：記錄當前 low 作轉向點
        result.push({
          time: parseTime(klines[lastSwingIdx].time, period),
          value: lastSwingPrice,
        })
        inUptrend = true
        lastSwingPrice = price
        lastSwingIdx = i
      }
    }
  }

  // 添加最後一個有效轉向點
  const lastTime = parseTime(klines[lastSwingIdx].time, period)
  if (result.length > 0 && result[result.length - 1].time !== lastTime) {
    result.push({ time: lastTime, value: klines[lastSwingIdx].close })
  }

  // 過濾並確保時間严格遞增
  const seen = new Set<Time>()
  const filtered: Array<{ time: Time; value: number }> = []
  for (const point of result) {
    if (!seen.has(point.time)) {
      seen.add(point.time)
      filtered.push(point)
    }
  }

  // 確保嚴格遞增（按時間排序）
  filtered.sort((a, b) => {
    if (a.time < b.time) return -1
    if (a.time > b.time) return 1
    return 0
  })

  return filtered
}

// ============ 創建圖表實例 ============

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
      autoScale: true,
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

// ============ Component ============

export default function ChartContainer({
  stock,
  period = '1d',
  indicatorConfig: externalConfig,
  onIndicatorChange,
}: ChartContainerProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const lineSeriesRefs = useRef<Record<string, ISeriesApi<'Line'>>>({})
  const bollSeriesRefs = useRef<Record<string, ISeriesApi<'Line'>>>({})
  const zigzagSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  
  const loadingPeriodRef = useRef<string>('')
  const dataPeriodRef = useRef<string>('')
  
  const [chartCreated, setChartCreated] = useState(false)
  
  const today = new Date().toISOString().split('T')[0]
  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const [currentPeriod, setCurrentPeriod] = useState(period)
  const [startDate, setStartDate] = useState<string>(sixMonthsAgo)
  const [endDate, setEndDate] = useState<string>(today)
  
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  
  const [indicatorConfig, setIndicatorConfig] = useState<IndicatorConfig>(
    externalConfig || DEFAULT_INDICATOR_CONFIG
  )

  // MACD overlay refs removed

  const [klineData, setKlineData] = useState<KLine[]>([])

  const { quotes } = useWebSocketContext()

  const handleIndicatorChange = useCallback((newConfig: IndicatorConfig) => {
    setIndicatorConfig(newConfig)
    onIndicatorChange?.(newConfig)
  }, [onIndicatorChange])

  // 初始化圖表（只在 mount 時執行一次）
  useEffect(() => {
    if (!chartContainerRef.current) return

    const container = chartContainerRef.current
    console.log('[Chart] Creating chart')

    const { chart, candlestickSeries, volumeSeries } = createChartInstance(container)

    chartRef.current = chart
    candlestickSeriesRef.current = candlestickSeries
    volumeSeriesRef.current = volumeSeries
    setChartCreated(true)
    console.log('[Chart] Chart created')
    
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
      console.log('[Chart] Cleanup')
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
      }
    }
  }, [])

  // 載入K線數據
  const loadKlineData = useCallback(async (code: string, period: string, start?: string, end?: string) => {
    loadingPeriodRef.current = period
    setLoading(true)
    
    try {
      const reqCount = period === '1m' ? 500 : 1000
      const params = new URLSearchParams({ code, period, count: String(reqCount) })
      if (start) params.set('start', start)
      if (end) params.set('end', end)
      
      const url = `http://${window.location.hostname}:18792/api/kline?${params}`
      const res = await fetch(url)
      const data: ChartData = await res.json()
      
      if (loadingPeriodRef.current !== period) return
      
      if (data.error) {
        setErrorMessage(data.error)
        setLoading(false)
        return
      }
      
      setErrorMessage(null)
      dataPeriodRef.current = period
      setKlineData(data.klines)
      
      if (candlestickSeriesRef.current && volumeSeriesRef.current && chartRef.current) {
        const candleMap = new Map<string, CandlestickData<Time>>()
        for (const k of data.klines) {
          const t = parseTime(k.time, period)
          const tStr = String(t)
          if (!candleMap.has(tStr)) {
            candleMap.set(tStr, { time: t, open: k.open, high: k.high, low: k.low, close: k.close })
          }
        }
        candlestickSeriesRef.current.setData(Array.from(candleMap.values()))
        
        const volumeMap = new Map<string, HistogramData<Time>>()
        for (const k of data.klines) {
          const t = parseTime(k.time, period)
          const tStr = String(t)
          if (!volumeMap.has(tStr)) {
            volumeMap.set(tStr, { time: t, value: k.volume, color: k.close >= k.open ? '#26BA7544' : '#EE515144' })
          }
        }
        volumeSeriesRef.current.setData(Array.from(volumeMap.values()))
        chartRef.current.timeScale().fitContent()
      }
    } catch (err) {
      console.error('[Chart] 載入K線失敗:', err)
    } finally {
      if (loadingPeriodRef.current === period) {
        setLoading(false)
      }
    }
  }, [])

  // chartCreated 後載入數據
  useEffect(() => {
    if (chartCreated) {
      loadKlineData(stock.code, currentPeriod, startDate, endDate)
    }
  }, [chartCreated, stock.code, currentPeriod, startDate, endDate, loadKlineData])

  // 更新指標線
  useEffect(() => {
    if (!chartRef.current || klineData.length === 0) return
    
    const chart = chartRef.current
    
    Object.entries(lineSeriesRefs.current).forEach(([key, series]) => {
      try { chart.removeSeries(series) } catch {}
    })
    lineSeriesRefs.current = {}
    
    Object.entries(bollSeriesRefs.current).forEach(([key, series]) => {
      try { chart.removeSeries(series) } catch {}
    })
    bollSeriesRefs.current = {}
    
    const maKeys: (keyof Pick<IndicatorConfig, 'MA5' | 'MA10' | 'MA20' | 'MA60' | 'MA120' | 'MA250'>)[] = ['MA5', 'MA10', 'MA20', 'MA60', 'MA120', 'MA250']
    for (const key of maKeys) {
      const config = indicatorConfig[key]
      if (config.enabled) {
        const data = calculateMA(klineData, config.period)
        if (data.length > 0) {
          const series = chart.addSeries(LineSeries, {
            color: config.color,
            lineWidth: 1,
            priceLineVisible: false,
          })
          series.setData(data)
          lineSeriesRefs.current[key] = series
        }
      }
    }
    
    const emaKeys: (keyof Pick<IndicatorConfig, 'EMA5' | 'EMA10' | 'EMA20'>)[] = ['EMA5', 'EMA10', 'EMA20']
    for (const key of emaKeys) {
      const config = indicatorConfig[key]
      if (config.enabled) {
        const data = calculateEMA(klineData, config.period)
        if (data.length > 0) {
          const series = chart.addSeries(LineSeries, {
            color: config.color,
            lineWidth: 1,
            priceLineVisible: false,
          })
          series.setData(data)
          lineSeriesRefs.current[key] = series
        }
      }
    }
    
    if (indicatorConfig.BOLL.enabled) {
      const { upper, middle, lower } = calculateBOLL(klineData, indicatorConfig.BOLL.period, indicatorConfig.BOLL.stdDev)
      const color = indicatorConfig.BOLL.color
      
      if (upper.length > 0) {
        const upperSeries = chart.addSeries(LineSeries, { color, lineWidth: 1, lineStyle: 2, priceLineVisible: false })
        upperSeries.setData(upper)
        bollSeriesRefs.current['BOLL_UPPER'] = upperSeries
        
        const middleSeries = chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false })
        middleSeries.setData(middle)
        bollSeriesRefs.current['BOLL_MIDDLE'] = middleSeries
        
        const lowerSeries = chart.addSeries(LineSeries, { color, lineWidth: 1, lineStyle: 2, priceLineVisible: false })
        lowerSeries.setData(lower)
        bollSeriesRefs.current['BOLL_LOWER'] = lowerSeries
      }
    }
  }, [klineData, currentPeriod, indicatorConfig])

  // ZigZag Indicator
  useEffect(() => {
    if (!chartRef.current || !chartCreated || klineData.length === 0) return

    const chart = chartRef.current
    const enabled = indicatorConfig.ZigZag.enabled
    const threshold = indicatorConfig.ZigZag.threshold

    // 移除舊的 ZigZag series（如果存在）
    if (zigzagSeriesRef.current) {
      try { chart.removeSeries(zigzagSeriesRef.current) } catch {}
      zigzagSeriesRef.current = null
    }

    if (!enabled) return

    const zigzagData = calculateZigZag(klineData, threshold, currentPeriod)
    if (zigzagData.length === 0) return

    const zigzagSeries = chart.addSeries(LineSeries, {
      color: '#FFD700',
      lineWidth: 1,
      priceLineVisible: false,
    })
    zigzagSeries.setData(zigzagData)
    zigzagSeriesRef.current = zigzagSeries
  }, [indicatorConfig.ZigZag, klineData, chartCreated])

  // 實時更新最後一根蠟燭
  useEffect(() => {
    const quote = quotes[stock.code]
    if (!quote || !candlestickSeriesRef.current || loading) return
    if (dataPeriodRef.current !== currentPeriod) return
    
    if (currentPeriod === '1m') {
      const now = new Date()
      const hktHour = parseInt(now.toLocaleTimeString('en-US', { timeZone: 'Asia/Hong_Kong', hour12: false }))
      const hktMinute = parseInt(now.toLocaleTimeString('en-US', { timeZone: 'Asia/Hong_Kong', minute: '2-digit', hour12: false }))
      const dayOfWeek = now.getDay()
      if (dayOfWeek === 0 || dayOfWeek === 6) return
      if (hktHour < 9 || (hktHour === 9 && hktMinute < 30) || hktHour >= 16) return
    }
    
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

  const handlePeriodChange = (period: string) => setCurrentPeriod(period)
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
      <IndicatorPanel
        config={indicatorConfig}
        onChange={handleIndicatorChange}
      />
      <div className={styles.chartWrapper}>
        <div ref={chartContainerRef} className={styles.chart} />
        {loading && <div className={styles.loading}>載入中...</div>}
        {errorMessage && <div className={styles.error}>{errorMessage}</div>}
      </div>
    </div>
  )
}

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

// ============ MACD 計算 ============

interface MACDResult {
  dif: Array<{ time: Time; value: number }>
  dea: Array<{ time: Time; value: number }>
  histogram: Array<{ time: Time; value: number; color: string }>
}

function calculateMACD(klines: KLine[], period: string): MACDResult {
  const fastPeriod = 12
  const slowPeriod = 26
  const signalPeriod = 9

  const closes = klines.map(k => k.close)
  const fastEMA = calculateEMA(klines, fastPeriod)
  const slowEMA = calculateEMA(klines, slowPeriod)

  const dif: Array<{ time: Time; value: number }> = []
  const dea: Array<{ time: Time; value: number }> = []
  const histogram: Array<{ time: Time; value: number; color: string }> = []

  const startIdx = slowPeriod - 1
  const difValues: number[] = []

  for (let i = startIdx; i < klines.length; i++) {
    const fastIdx = i - (slowPeriod - fastPeriod)
    const d = fastEMA[fastIdx].value - slowEMA[i - startIdx].value
    difValues.push(d)
    dif.push({
      time: parseTime(klines[i].time, period),
      value: parseFloat(d.toFixed(4)),
    })
  }

  const deaValues = calculateEMAWithValues(difValues, signalPeriod)
  for (let i = 0; i < deaValues.length; i++) {
    dea.push({
      time: dif[i + signalPeriod - 1].time,
      value: parseFloat(deaValues[i].toFixed(4)),
    })
  }

  for (let i = 0; i < deaValues.length; i++) {
    const difIdx = i + signalPeriod - 1
    const histValue = (difValues[difIdx] - deaValues[i]) * 2
    histogram.push({
      time: dif[difIdx].time,
      value: parseFloat(histValue.toFixed(4)),
      color: histValue >= 0 ? '#26BA75' : '#EE5151',
    })
  }

  return { dif, dea, histogram }
}

function calculateEMAWithValues(values: number[], period: number): number[] {
  const multiplier = 2 / (period + 1)
  const ema: number[] = []

  let sum = 0
  for (let i = 0; i < period; i++) {
    sum += values[i]
  }
  ema.push(sum / period)

  for (let i = period; i < values.length; i++) {
    ema.push((values[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1])
  }
  return ema
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
      scaleMargins: { top: 0.03, bottom: 0.55 },
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
    scaleMargins: { top: 0.93, bottom: 0 },
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
  
  const loadingPeriodRef = useRef<string>('')
  const dataPeriodRef = useRef<string>('')
  
  const [chartCreated, setChartCreated] = useState(false)
  
  const today = new Date().toISOString().split('T')[0]
  const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const [currentPeriod, setCurrentPeriod] = useState(period)
  const [startDate, setStartDate] = useState<string>(threeMonthsAgo)
  const [endDate, setEndDate] = useState<string>(today)
  
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  
  const [indicatorConfig, setIndicatorConfig] = useState<IndicatorConfig>(
    externalConfig || DEFAULT_INDICATOR_CONFIG
  )

  // MACD overlay series refs
  const macdSeriesRefs = useRef<{
    DIF: ISeriesApi<'Line'> | null
    DEA: ISeriesApi<'Line'> | null
    HIST: ISeriesApi<'Histogram'> | null
  }>({ DIF: null, DEA: null, HIST: null })
  
  const [klineData, setKlineData] = useState<KLine[]>([])

  const { quotes } = useWebSocketContext()

  const handleIndicatorChange = useCallback((newConfig: IndicatorConfig) => {
    setIndicatorConfig(newConfig)
    onIndicatorChange?.(newConfig)
  }, [onIndicatorChange])

  // MACD Overlay useEffect - 在主圖上以 overlay 方式顯示
  useEffect(() => {
    if (!chartRef.current || !chartCreated || klineData.length === 0) return

    const chart = chartRef.current
    const enabled = indicatorConfig.MACD.enabled

    // 移除舊的 MACD series
    if (macdSeriesRefs.current.DIF) {
      try { chart.removeSeries(macdSeriesRefs.current.DIF) } catch {}
      macdSeriesRefs.current.DIF = null
    }
    if (macdSeriesRefs.current.DEA) {
      try { chart.removeSeries(macdSeriesRefs.current.DEA) } catch {}
      macdSeriesRefs.current.DEA = null
    }
    if (macdSeriesRefs.current.HIST) {
      try { chart.removeSeries(macdSeriesRefs.current.HIST) } catch {}
      macdSeriesRefs.current.HIST = null
    }

    if (!enabled) return

    // 計算 MACD 數據
    const { dif, dea, histogram } = calculateMACD(klineData, currentPeriod)

    if (dif.length === 0) return

    // 添加 DIF 線 (使用 overlay price scale)
    const difSeries = chart.addSeries(LineSeries, {
      color: '#26BA75',
      lineWidth: 1,
      priceLineVisible: false,
      priceScaleId: '',
    })
    difSeries.setData(dif)
    macdSeriesRefs.current.DIF = difSeries

    // 添加 DEA 線 (使用相同 overlay price scale)
    const deaSeries = chart.addSeries(LineSeries, {
      color: '#EE5151',
      lineWidth: 1,
      priceLineVisible: false,
      priceScaleId: '',
    })
    deaSeries.setData(dea)
    macdSeriesRefs.current.DEA = deaSeries

    // 添加 MACD 柱子 (Histogram) - 使用單獨的 overlay price scale
    const histSeries = chart.addSeries(HistogramSeries, {
      color: '#26BA75',
      priceFormat: { type: 'price', precision: 4 },
      priceScaleId: '',
    })
    histSeries.setData(histogram.map(h => ({ time: h.time, value: h.value, color: h.color })))
    macdSeriesRefs.current.HIST = histSeries

    // 配置 overlay price scale - 將 MACD 放在中部位置
    difSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.52, bottom: 0.25 },
    })
  }, [indicatorConfig.MACD.enabled, klineData, chartCreated, currentPeriod])

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

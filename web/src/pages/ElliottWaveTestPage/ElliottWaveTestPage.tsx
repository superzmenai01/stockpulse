// ElliottWaveTestPage - Elliott Wave 指標測試頁面
// 複製 ChartContainer 的 K線圖功能，用於測試 Elliott Wave 指標

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, IChartApi, ISeriesApi, CandlestickData, HistogramData, Time, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts'
import { klineUrl } from '../../config/api'
import { useWebSocketContext } from '../../context'
import { useIndicatorSettings } from '../../context/IndicatorSettingsContext'
import { calculateElliottWave } from '../../utils/elliottWave'
import ChartToolbar from '../../components/chart/ChartToolbar'
import IndicatorPanel, { DEFAULT_INDICATOR_CONFIG, type IndicatorConfig } from '../../components/chart/IndicatorPanel'
import styles from './ElliottWaveTestPage.module.css'

// ============ Types ============

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

interface ChartData {
  code: string
  name: string
  period: string
  klines: KLine[]
  error?: string
}

// User adjustment for a single EW point
interface EWUserAdjustment {
  time: Time        // Identify point by time
  wave: number      // User-chosen wave number
}

// ============ Constants ============

const PERIODS = [
  { label: '1分鐘K', value: '1m' },
  { label: '日K', value: '1d' },
  { label: '月K', value: '1M' },
  { label: '年K', value: '1y' },
]

// Wave label colors
const WAVE_COLORS: Record<number, string> = {
  1: '#FFD700',  // Gold
  2: '#26BA75',  // Green
  3: '#FF6B6B',  // Red
  4: '#4ECDC4',  // Teal
  5: '#9B59B6',  // Purple
  6: '#FF8C00',  // Dark Orange
  7: '#8B4513',  // Saddle Brown
  8: '#00CED1',  // Dark Cyan
  9: '#DC143C',  // Crimson
  0: '#F39C12',  // Orange (A)
  [-1]: '#3498DB', // Blue (B)
  [-2]: '#E74C3C', // Red (C)
  [-3]: '#9B59B6', // Purple (D)
  [-4]: '#2ECC71', // Emerald (E)
}

// Wave label text
const WAVE_LABEL_MAP: Record<number, string> = {
  1: '1',
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  0: 'A',
  [-1]: 'B',
  [-2]: 'C',
  [-3]: 'D',
  [-4]: 'E',
}

// All available wave labels for the popup selector
const ALL_WAVE_OPTIONS = [
  { value: 1, label: '1', color: WAVE_COLORS[1] },
  { value: 2, label: '2', color: WAVE_COLORS[2] },
  { value: 3, label: '3', color: WAVE_COLORS[3] },
  { value: 4, label: '4', color: WAVE_COLORS[4] },
  { value: 5, label: '5', color: WAVE_COLORS[5] },
  { value: 6, label: '6', color: WAVE_COLORS[6] },
  { value: 7, label: '7', color: WAVE_COLORS[7] },
  { value: 8, label: '8', color: WAVE_COLORS[8] },
  { value: 9, label: '9', color: WAVE_COLORS[9] },
  { value: 0, label: 'A', color: WAVE_COLORS[0] },
  { value: -1, label: 'B', color: WAVE_COLORS[-1] },
  { value: -2, label: 'C', color: WAVE_COLORS[-2] },
  { value: -3, label: 'D', color: WAVE_COLORS[-3] },
  { value: -4, label: 'E', color: WAVE_COLORS[-4] },
]

// ============ Time Parsing ============

// LocalStorage key for EW adjustments
const EW_ADJUSTMENTS_KEY = 'stockpulse_ew_adjustments'

// Load adjustments from localStorage
function loadEWAdjustments(): EWUserAdjustment[] {
  try {
    const saved = localStorage.getItem(EW_ADJUSTMENTS_KEY)
    if (saved) {
      return JSON.parse(saved)
    }
  } catch (e) {
    console.error('[EW] Failed to load adjustments from localStorage:', e)
  }
  return []
}

// Save adjustments to localStorage
function saveEWAdjustments(adjustments: EWUserAdjustment[]): void {
  try {
    localStorage.setItem(EW_ADJUSTMENTS_KEY, JSON.stringify(adjustments))
  } catch (e) {
    console.error('[EW] Failed to save adjustments to localStorage:', e)
  }
}

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

// ============ Indicator Calculations ============

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

// ============ ZigZag — Phase 1 Backend Integration (大少 2026-08-20 19:50) ============
// 凡人話: 刪走 frontend calculateZigZag, 改 fetch /api/algorithms/run?algo=zigzag 拎 verdict
// 對應 backup: backups/zigzag-frontend-2026-08-20/ElliottWaveTestPage.tsx

/**
 * 凡人話: 拎 backend ZigZag 嘅 async function
 * 對應 ChartContainer.tsx 嘅 fetchBackendZigZag (ElliottWaveTestPage 獨立 copy, 因為唔 import ChartContainer)
 * 大少 8月31日 11:09 trigger 拎走橙旗決定點 (4.53.0 永久 rule): 拎走 decisionTime / decisionValue 2 個 field
 */
async function fetchBackendZigZag(
  symbol: string,
  period: string,
  threshold: number,
  signal: AbortSignal
): Promise<Array<{ time: Time; value: number }>> {
  const url = `/api/algorithms/run?algo=zigzag&symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}&threshold=${threshold}`;
  const resp = await fetch(url, { signal });
  if (!resp.ok) {
    throw new Error(`Backend ZigZag 拎唔到: ${resp.status} ${resp.statusText}`);
  }
  const verdict = await resp.json();
  if (!verdict.ok || !Array.isArray(verdict.points)) {
    throw new Error(`Backend ZigZag verdict fail: ${verdict.error || 'unknown'}`);
  }
  return verdict.points.map((p: { date: string; value: number; type: string; index: number }) => ({
    time: parseTime(p.date, period),
    value: p.value,
  }));
}


// ============ Chart Creation ============

const createChartInstance = (container: HTMLDivElement) => {
  const chart = createChart(container, {
    width: container.clientWidth || 900,
    height: container.clientHeight || 500,
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

// ChartClickHandler - right-click handler for EW point editing
interface ChartClickHandlerProps {
  chartRef: React.RefObject<IChartApi | null>
  ewResult: ReturnType<typeof calculateElliottWave> | null
  ewEnabled: boolean
  onEWPointClick: (time: Time, wave: number, price: number) => void
}

function ChartClickHandler({ chartRef, ewResult, ewEnabled, onEWPointClick }: ChartClickHandlerProps) {
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !ewEnabled || !ewResult) return

    const handleContextMenu = (param: any) => {
      if (!ewResult || ewResult.labels.length === 0) return
      
      const point = param.point
      if (!point) return
      
      // Get time at click position
      const time = chart.timeScale().coordinateToTime(point.x)
      if (!time) return
      
      // Find nearest EW label
      let nearestLabel: typeof ewResult.labels[0] | null = null
      let nearestDist = Infinity
      
      for (const label of ewResult.labels) {
        const labelTimeCoord = chart.timeScale().timeToCoordinate(label.time)
        if (labelTimeCoord === null) continue
        
        // Simple distance in screen coords
        const dist = Math.abs(labelTimeCoord - point.x) 
        if (dist < nearestDist && dist < 50) {
          nearestDist = dist
          nearestLabel = label
        }
      }
      
      if (nearestLabel) {
        onEWPointClick(nearestLabel.time, nearestLabel.wave, nearestLabel.price)
      }
    }

    chart.subscribeClick(handleContextMenu)
    return () => {
      try { chart.unsubscribeClick(handleContextMenu) } catch {}
    }
  }, [chartRef, ewResult, ewEnabled, onEWPointClick])

  return null
}

const TEST_STOCK: StockInfo = { code: 'HK.00981', name: '中芯國際' }

export default function ElliottWaveTestPage() {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const lineSeriesRefs = useRef<Record<string, ISeriesApi<'Line'>>>({})
  const bollSeriesRefs = useRef<Record<string, ISeriesApi<'Line'>>>({})
  const zigzagSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  // 大少 8月31日 11:09 trigger 拎走橙旗決定點 (4.53.0 永久 rule): 拎走 zigzagFlagMarkersRef handle
  const ewConnectionRefs = useRef<ISeriesApi<'Line'>[]>([])
  const ewMarkersRef = useRef<ReturnType<typeof createSeriesMarkers<Time>> | null>(null)
  
  const loadingPeriodRef = useRef<string>('')
  const dataPeriodRef = useRef<string>('')
  
  const [chartCreated, setChartCreated] = useState(false)
  
  const today = new Date().toISOString().split('T')[0]
  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const [currentPeriod, setCurrentPeriod] = useState('1d')
  const [startDate, setStartDate] = useState<string>(sixMonthsAgo)
  const [endDate, setEndDate] = useState<string>(today)
  
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0]
    let newStartDate: string
    
    if (currentPeriod === '1M') {
      const d = new Date()
      d.setFullYear(d.getFullYear() - 10)
      newStartDate = d.toISOString().split('T')[0]
    } else if (currentPeriod === '1y') {
      const d = new Date()
      d.setFullYear(d.getFullYear() - 120)
      newStartDate = d.toISOString().split('T')[0]
    } else if (currentPeriod === '1d') {
      const d = new Date()
      d.setDate(d.getDate() - 180)
      newStartDate = d.toISOString().split('T')[0]
    } else {
      newStartDate = ''
    }
    
    if (newStartDate !== startDate) {
      setStartDate(newStartDate)
      setEndDate(today)
    }
  }, [currentPeriod])
  
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [ewResult, setEwResult] = useState<ReturnType<typeof calculateElliottWave> | null>(null)
  
  const { config: contextConfig, setConfig: setContextConfig } = useIndicatorSettings()
  const [indicatorConfig, setIndicatorConfig] = useState<IndicatorConfig>(
    contextConfig || DEFAULT_INDICATOR_CONFIG
  )
  
  // EW enabled state 直接來自 indicatorConfig.ElliottWave.enabled
  const ewEnabled = indicatorConfig.ElliottWave?.enabled ?? false

  // Semi-auto: user adjustments - load from localStorage
  const [ewUserAdjustments, setEwUserAdjustments] = useState<EWUserAdjustment[]>(
    () => loadEWAdjustments()
  )

  // Semi-auto: popup state for editing wave label
  const [ewEditPopup, setEwEditPopup] = useState<{
    visible: boolean
    time: Time | null
    currentWave: number
    price: number
  }>({ visible: false, time: null, currentWave: 0, price: 0 })

  // Get wave number considering user adjustments
  const getWaveNumber = useCallback((time: Time, defaultWave: number): number => {
    const adj = ewUserAdjustments.find(a => a.time === time)
    return adj ? adj.wave : defaultWave
  }, [ewUserAdjustments])

  // Handle clicking an EW marker to change its label
  const handleEWMarkerClick = useCallback((time: Time, wave: number, price: number) => {
    setEwEditPopup({
      visible: true,
      time,
      currentWave: wave,
      price,
    })
  }, [])

  // Confirm wave label change and persist to localStorage
  const confirmEWLabelChange = useCallback((newWave: number) => {
    if (ewEditPopup.time !== null) {
      setEwUserAdjustments(prev => {
        const filtered = prev.filter(a => a.time !== ewEditPopup.time)
        const next = [...filtered, { time: ewEditPopup.time!, wave: newWave }]
        saveEWAdjustments(next)
        return next
      })
    }
    setEwEditPopup({ visible: false, time: null, currentWave: 0, price: 0 })
  }, [ewEditPopup.time])

  const [klineData, setKlineData] = useState<KLine[]>([])

  const { quotes } = useWebSocketContext()

  const handleIndicatorChange = useCallback((newConfig: IndicatorConfig) => {
    setIndicatorConfig(newConfig)
    setContextConfig(newConfig)
  }, [setContextConfig])

  // 初始化圖表
  useEffect(() => {
    if (!chartContainerRef.current) return

    const container = chartContainerRef.current
    console.log('[EW Test] Creating chart')

    const { chart, candlestickSeries, volumeSeries } = createChartInstance(container)

    chartRef.current = chart
    candlestickSeriesRef.current = candlestickSeries
    volumeSeriesRef.current = volumeSeries
    setChartCreated(true)
    console.log('[EW Test] Chart created')
    
    const handleResize = () => {
      if (container && chartRef.current) {
        chartRef.current.applyOptions({
          width: container.clientWidth || 900,
          height: container.clientHeight || 500,
        })
      }
    }
    window.addEventListener('resize', handleResize)
    handleResize()

    return () => {
      window.removeEventListener('resize', handleResize)
      console.log('[EW Test] Cleanup')
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
      
      const url = klineUrl(params)
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

      // 計算 Elliott Wave — Phase 1 改 fetch backend ZigZag (大少 2026-08-20 19:50)
      // 凡人話: 拎 stock code (從 URL params 拎), 改 fetch backend /api/algorithms/run?algo=zigzag
      const urlParams = new URLSearchParams(window.location.search);
      const stockCode = urlParams.get('symbol') || urlParams.get('code') || 'HK.00700';
      const controller = new AbortController();
      const zigzagPoints = await fetchBackendZigZag(
        stockCode, period, indicatorConfig.ZigZag.threshold, controller.signal
      );
      const ew = calculateElliottWave(zigzagPoints)
      setEwResult(ew)

      // DEBUG: 打印完整 EW 結果
      console.log('[EW Test] === DEBUG START ===')
      console.log('[EW Test] K-lines count:', data.klines.length)
      console.log('[EW Test] ZigZag threshold:', indicatorConfig.ZigZag.threshold)
      console.log('[EW Test] ZigZag points:', zigzagPoints.length)
      zigzagPoints.forEach((p, i) => {
        console.log(`  [${i}] ${p.time}: ${p.value}`)
      })
      console.log('[EW Test] EW result:', JSON.stringify({
        labelsCount: ew.labels.length,
        wavesCount: ew.waves.length,
        connectionsCount: ew.connections.length,
        labels: ew.labels.slice(0, 5).map(l => ({ t: l.text, w: l.wave, p: l.price }))
      }))
      console.log('[EW Test] === DEBUG END ===')

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
      console.error('[EW Test] 載入K線失敗:', err)
    } finally {
      if (loadingPeriodRef.current === period) {
        setLoading(false)
      }
    }
  }, [indicatorConfig.ZigZag.threshold])

  useEffect(() => {
    if (chartCreated) {
      loadKlineData(TEST_STOCK.code, currentPeriod, startDate, endDate)
    }
  }, [chartCreated, currentPeriod, startDate, endDate, loadKlineData])

  // 更新 MA/EMA/BOLL 指標線
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
        const rawData = calculateMA(klineData, config.period)
        if (rawData.length > 0) {
          const seen = new Set<Time>()
          const data = rawData.filter(p => {
            if (seen.has(p.time)) return false
            seen.add(p.time)
            return true
          }).sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0)
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
    }
    
    const emaKeys: (keyof Pick<IndicatorConfig, 'EMA5' | 'EMA10' | 'EMA20'>)[] = ['EMA5', 'EMA10', 'EMA20']
    for (const key of emaKeys) {
      const config = indicatorConfig[key]
      if (config.enabled) {
        const rawData = calculateEMA(klineData, config.period)
        if (rawData.length > 0) {
          const seen = new Set<Time>()
          const data = rawData.filter(p => {
            if (seen.has(p.time)) return false
            seen.add(p.time)
            return true
          }).sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0)
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
  }, [klineData, indicatorConfig])

  // ZigZag Indicator
  useEffect(() => {
    if (!chartRef.current || !chartCreated || klineData.length === 0) return

    const chart = chartRef.current
    const enabled = indicatorConfig.ZigZag.enabled
    const threshold = indicatorConfig.ZigZag.threshold

    if (zigzagSeriesRef.current) {
      try { chart.removeSeries(zigzagSeriesRef.current) } catch {}
      zigzagSeriesRef.current = null
    }
    // 大少 8月31日 11:09 trigger 拎走橙旗決定點 (4.53.0 永久 rule): 拎走旗仔 marker clear 嗰段

    if (!enabled) return

    // Phase 1 改 fetch backend ZigZag (大少 2026-08-20 19:50)
    const urlParams = new URLSearchParams(window.location.search);
    const stockCode = urlParams.get('symbol') || urlParams.get('code') || 'HK.00700';
    const controller = new AbortController()
    ;(async () => {
      try {
        const zigzagData = await fetchBackendZigZag(
          stockCode, currentPeriod, threshold, controller.signal
        )
        if (controller.signal.aborted || zigzagData.length === 0) return

        const zigzagSeries = chart.addSeries(LineSeries, {
          color: '#FFD700',
          lineWidth: 1,
          priceLineVisible: false,
        })
        zigzagSeries.setData(zigzagData)
        if (!controller.signal.aborted) {
          zigzagSeriesRef.current = zigzagSeries
        }

        // 大少 8月31日 11:09 trigger 拎走橙旗決定點 (4.53.0 永久 rule): 拎走整個旗仔 marker build block
      } catch (e) {
        if (!controller.signal.aborted) {
          console.warn('[EW Test ZigZag] backend fetch 失敗, 唔 render:', e)
        }
      }
    })()
    return () => controller.abort()
  }, [indicatorConfig.ZigZag, klineData, chartCreated, currentPeriod])

  // Elliott Wave Connections (lines between waves)
  useEffect(() => {
    if (!chartRef.current || !chartCreated || klineData.length === 0 || !ewEnabled) return

    const chart = chartRef.current

    // Remove old EW connection series
    for (const ref of ewConnectionRefs.current) {
      try { chart.removeSeries(ref) } catch {}
    }
    ewConnectionRefs.current = []

    if (!ewResult || ewResult.connections.length === 0) return

    // Draw wave connections (thicker lines for visibility)
    for (const conn of ewResult.connections) {
      const color = WAVE_COLORS[conn.wave] || '#FF6B6B'
      const connectionSeries = chart.addSeries(LineSeries, {
        color,
        lineWidth: 3,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      connectionSeries.setData([
        { time: conn.from, value: conn.priceFrom },
        { time: conn.to, value: conn.priceTo },
      ])
      ewConnectionRefs.current.push(connectionSeries)
    }
    
    console.log('[EW Test] Drew', ewResult.connections.length, 'wave connections')
  }, [ewResult, ewEnabled, chartCreated, klineData])

  // Elliott Wave Markers (wave labels on chart)
  useEffect(() => {
    if (!chartRef.current || !chartCreated || klineData.length === 0) return

    const series = candlestickSeriesRef.current
    if (!series) return

    // Clear markers when EW is disabled
    if (!ewEnabled || !ewResult || !ewResult.labels || ewResult.labels.length === 0) {
      if (ewMarkersRef.current) {
        ewMarkersRef.current.setMarkers([])
      }
      return
    }

    // Remove old markers
    if (ewMarkersRef.current) {
      ewMarkersRef.current.setMarkers([])
    }

    // Build marker data from EW labels
    const markers = ewResult.labels.map(label => {
      // Apply user adjustment
      const waveNum = getWaveNumber(label.time, label.wave)
      
      // Find corresponding wave in ewResult.waves to get the type (high/low)
      const waveInfo = ewResult.waves.find(w => 
        w.time === label.time && w.price === label.price
      )
      const isHighPoint = waveInfo?.type === 'high'
      
      // Position: aboveBar for highs, belowBar for lows
      const position: 'aboveBar' | 'belowBar' = isHighPoint ? 'aboveBar' : 'belowBar'
      
      // Shape: arrowUp for highs (push up), arrowDown for lows (push down)
      const shape: 'arrowUp' | 'arrowDown' = isHighPoint ? 'arrowUp' : 'arrowDown'
      
      return {
        time: label.time,
        position,
        shape,
        color: WAVE_COLORS[waveNum] || '#FFD700',
        text: WAVE_LABEL_MAP[waveNum] || String(waveNum),
        textColor: '#FFFFFF',
        size: 1,
      }
    })

    console.log('[EW Test] Setting', markers.length, 'EW markers')
    const markersPlugin = createSeriesMarkers(series, markers)
    ewMarkersRef.current = markersPlugin
    
    // Subscribe to marker clicks for semi-auto editing
    // Note: lightweight-charts markers don't have click events, using right-click instead
  }, [ewResult, ewEnabled, chartCreated, klineData, ewUserAdjustments, getWaveNumber])

  // 實時更新最後一根蠟燭
  useEffect(() => {
    const quote = quotes[TEST_STOCK.code]
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
  }, [quotes[TEST_STOCK.code], currentPeriod, loading])

  const handlePeriodChange = (period: string) => setCurrentPeriod(period)
  const handleDateChange = (start: string, end: string) => {
    setStartDate(start)
    setEndDate(end)
  }

  // 構建 EW 標籤列表用於調試顯示
  const ewLabelsDebug = ewResult?.labels.map(l => `${l.text}@${l.price}`).join(', ') || ''

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>📊 Elliott Wave 指標測試頁面</h2>
        <div className={styles.stockInfo}>
          <span className={styles.stockCode}>{TEST_STOCK.code}</span>
          <span className={styles.stockName}>{TEST_STOCK.name}</span>
          <span className={styles.ewStatus}>{ewEnabled ? '✓ EW On' : '✗ EW Off'}</span>
        </div>
        {ewResult && (
          <div className={styles.ewStats}>
            <span>ZigZag 點: {ewResult.waves.length}</span>
            <span>標記: {ewResult.labels.length}</span>
            <span>連線: {ewResult.connections.length}</span>
            <span style={{ color: ewResult.valid ? '#26BA75' : '#F39C12' }}>
              {ewResult.valid ? '✓ 規則驗證通過' : '⚠ ' + ewResult.message}
            </span>
          </div>
        )}
      </div>
      
      {ewLabelsDebug && ewEnabled && (
        <div className={styles.ewDebug}>
          {ewLabelsDebug}
        </div>
      )}
      
      <ChartToolbar
        periods={PERIODS}
        currentPeriod={currentPeriod}
        onPeriodChange={handlePeriodChange}
        stockName={TEST_STOCK.name}
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
        
        {/* Semi-auto EW Edit Popup */}
        {ewEditPopup.visible && (
          <div className={styles.ewEditPopup}>
            <div className={styles.ewEditPopupTitle}>🌊 選擇波浪標記</div>
            <div className={styles.ewEditPopupPrice}>價格: ${ewEditPopup.price.toFixed(2)}</div>
            <div className={styles.ewEditPopupButtons}>
              {ALL_WAVE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className={styles.ewWaveButton}
                  style={{ 
                    backgroundColor: opt.value === ewEditPopup.currentWave ? opt.color : '#333',
                    color: opt.value === ewEditPopup.currentWave ? '#000' : '#FFF'
                  }}
                  onClick={() => confirmEWLabelChange(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className={styles.ewEditPopupHint}>點擊波浪編號以更改標記</div>
            <button 
              className={styles.ewEditPopupCancel}
              onClick={() => setEwEditPopup({ visible: false, time: null, currentWave: 0, price: 0 })}
            >
              取消
            </button>
          </div>
        )}
      </div>
      
      {/* Right-click on chart to edit EW label */}
      <ChartClickHandler
        chartRef={chartRef}
        ewResult={ewResult}
        ewEnabled={ewEnabled}
        onEWPointClick={handleEWMarkerClick}
      />
    </div>
  )
}

// ChartContainer - K線圖主容器

import React, { useEffect, useRef, useState } from 'react'
import { createChart, IChartApi, ISeriesApi, CandlestickData, HistogramData, Time } from 'lightweight-charts'
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
}

const PERIODS = [
  { label: '1分', value: '1m' },
  { label: '5分', value: '5m' },
  { label: '15分', value: '15m' },
  { label: '30分', value: '30m' },
  { label: '1時', value: '1h' },
  { label: '日', value: '1d' },
  { label: '週', value: '1w' },
]

export default function ChartContainer({ stock, period = '1d' }: ChartContainerProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)

  const [currentPeriod, setCurrentPeriod] = useState(period)
  const [chartData, setChartData] = useState<ChartData | null>(null)
  const [loading, setLoading] = useState(false)

  const { quotes } = useWebSocketContext()

  // 初始化圖表
  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
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

    // 設置Candlestick series
    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#26BA75',
      downColor: '#EE5151',
      borderUpColor: '#26BA75',
      borderDownColor: '#EE5151',
      wickUpColor: '#26BA75',
      wickDownColor: '#EE5151',
    })

    // 設置Volume series
    const volumeSeries = chart.addHistogramSeries({
      color: '#26BA75',
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    })
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    })

    chartRef.current = chart
    candlestickSeriesRef.current = candlestickSeries
    volumeSeriesRef.current = volumeSeries

    // 響應窗口大小變化
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        })
      }
    }
    window.addEventListener('resize', handleResize)
    handleResize()

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [])

  // 載入K線數據
  const loadKlineData = async (code: string, period: string) => {
    setLoading(true)
    try {
      const res = await fetch(`http://${window.location.hostname}:18792/api/kline?code=${code}&period=${period}&count=100`)
      const data: ChartData = await res.json()
      setChartData(data)

      if (candlestickSeriesRef.current && volumeSeriesRef.current) {
        // 設置K線數據
        const candleData: CandlestickData<Time>[] = data.klines.map(k => ({
          time: k.time as Time,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
        }))
        candlestickSeriesRef.current.setData(candleData)

        // 設置成交量數據
        const volumeData: HistogramData<Time>[] = data.klines.map(k => ({
          time: k.time as Time,
          value: k.volume,
          color: k.close >= k.open ? '#26BA7544' : '#EE515144',
        }))
        volumeSeriesRef.current.setData(volumeData)

        // 讓圖表自動調整時間範圍
        chartRef.current?.timeScale().fitContent()
      }
    } catch (err) {
      console.error('[Chart] 載入K線失敗:', err)
    } finally {
      setLoading(false)
    }
  }

  // 初始載入 + period 改變時重新載入
  useEffect(() => {
    loadKlineData(stock.code, currentPeriod)
  }, [stock.code, currentPeriod])

  // 實時更新最後一根蠟燭
  useEffect(() => {
    const quote = quotes[stock.code]
    if (!quote || !candlestickSeriesRef.current || !chartData) return

    const lastKline = chartData.klines[chartData.klines.length - 1]
    if (!lastKline) return

    // 更新最後一根蠟燭
    candlestickSeriesRef.current.update({
      time: lastKline.time as Time,
      open: quote.open_price || lastKline.open,
      high: Math.max(lastKline.high, quote.last_price),
      low: Math.min(lastKline.low, quote.last_price),
      close: quote.last_price,
    })
  }, [quotes[stock.code]])

  const handlePeriodChange = (period: string) => {
    setCurrentPeriod(period)
  }

  return (
    <div className={styles.container}>
      <ChartToolbar
        periods={PERIODS}
        currentPeriod={currentPeriod}
        onPeriodChange={handlePeriodChange}
        stockName={stock.name}
      />
      <div className={styles.chartWrapper}>
        {loading && <div className={styles.loading}>載入中...</div>}
        <div ref={chartContainerRef} className={styles.chart} />
      </div>
    </div>
  )
}
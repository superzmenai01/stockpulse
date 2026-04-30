// SubChartPanel - 副圖面板（MACD/RSI/KDJ等）

import React, { useEffect, useRef } from 'react'
import { createChart, IChartApi, ISeriesApi, Time, HistogramSeries, LineSeries } from 'lightweight-charts'
import styles from './SubChartPanel.module.css'

interface SubChartPanelProps {
  klines: Array<{
    time: string
    open: number
    high: number
    low: number
    close: number
    volume: number
  }>
  type: 'MACD' | 'RSI' | 'KDJ' | 'WR' | 'CCI'
  mainChart: IChartApi
}

// ============ MACD 計算 ============

interface MACDResult {
  dif: Array<{ time: Time; value: number }>
  dea: Array<{ time: Time; value: number }>
  histogram: Array<{ time: Time; value: number; color: string }>
}

function calculateEMA(values: number[], period: number): number[] {
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

function calculateMACD(
  klines: Array<{ time: string; close: number }>,
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDResult {
  const closes = klines.map(k => k.close)
  const fastEMA = calculateEMA(closes, fastPeriod)
  const slowEMA = calculateEMA(closes, slowPeriod)
  
  const dif: Array<{ time: Time; value: number }> = []
  const dea: Array<{ time: Time; value: number }> = []
  const histogram: Array<{ time: Time; value: number; color: string }> = []
  
  const startIdx = slowPeriod - 1
  const difValues: number[] = []
  
  for (let i = startIdx; i < klines.length; i++) {
    const fastIdx = i - (slowPeriod - fastPeriod)
    const d = fastEMA[fastIdx] - slowEMA[i - startIdx]
    difValues.push(d)
    dif.push({
      time: klines[i].time.substring(0, 10) as Time,
      value: parseFloat(d.toFixed(4)),
    })
  }
  
  const deaValues = calculateEMA(difValues, signalPeriod)
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

// ============ Component ============

export default function SubChartPanel({ klines, type, mainChart }: SubChartPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRefs = useRef<{ [key: string]: ISeriesApi }>({})

  useEffect(() => {
    if (!containerRef.current) return
    
    if (chartRef.current) {
      chartRef.current.remove()
      chartRef.current = null
    }

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth || 800,
      height: 150,
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
      rightPriceScale: { borderColor: '#30363D' },
      timeScale: { borderColor: '#30363D', timeVisible: true, secondsVisible: false },
    })
    chartRef.current = chart
    
    // 同步主圖的 pan/zoom
    const syncHandler = () => {
      const mainRange = mainChart.timeScale().getVisibleLogicalRange()
      if (mainRange && chartRef.current) {
        chartRef.current.timeScale().setVisibleLogicalRange(mainRange)
      }
    }
    mainChart.timeScale().subscribe('visibleLogicalRangeChanged', syncHandler)
    
    // Crosshair 同步
    mainChart.subscribeCrosshairMove((param: unknown) => {
      if (chartRef.current) {
        chartRef.current.moveCrosshair((param as { point?: { x: number; y: number } }).point)
      }
    })
    
    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth || 800,
          height: 150,
        })
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
      }
    }
  }, [mainChart])

  useEffect(() => {
    if (!chartRef.current || klines.length === 0) return
    
    const chart = chartRef.current
    
    // 清除舊 series
    Object.values(seriesRefs.current).forEach(series => {
      try { chart.removeSeries(series) } catch {}
    })
    seriesRefs.current = {}
    
    if (type === 'MACD') {
      const { dif, dea, histogram } = calculateMACD(klines)
      
      if (dif.length > 0) {
        const difSeries = chart.addSeries(LineSeries, {
          color: '#26BA75',
          lineWidth: 1,
          priceLineVisible: false,
        })
        difSeries.setData(dif)
        seriesRefs.current['DIF'] = difSeries
        
        const deaSeries = chart.addSeries(LineSeries, {
          color: '#EE5151',
          lineWidth: 1,
          priceLineVisible: false,
        })
        deaSeries.setData(dea)
        seriesRefs.current['DEA'] = deaSeries
        
        const histSeries = chart.addSeries(HistogramSeries, {
          priceFormat: { type: 'price', precision: 4 },
          priceScaleId: '',
        })
        histSeries.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } })
        histSeries.setData(histogram)
        seriesRefs.current['HIST'] = histSeries
        
        // 同步可見範圍
        const mainRange = mainChart.timeScale().getVisibleLogicalRange()
        if (mainRange) {
          chart.timeScale().setVisibleLogicalRange(mainRange)
        }
      }
    }
  }, [klines, type, mainChart])

  return (
    <div className={styles.panel}>
      <div className={styles.title}>
        {type === 'MACD' && 'MACD (12, 26, 9)'}
        {type === 'RSI' && 'RSI (14)'}
        {type === 'KDJ' && 'KDJ (9, 3, 3)'}
      </div>
      <div ref={containerRef} className={styles.chart} />
    </div>
  )
}

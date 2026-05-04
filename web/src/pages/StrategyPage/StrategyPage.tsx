// StrategyPage - 策略頁面
// 用於根據技術指標篩選股票

import React, { useState, useCallback } from 'react'
import { Button, message, Spin } from 'antd'
import { PlayCircleOutlined } from '@ant-design/icons'
import { AppLayout } from '../../components/layout'
import FilterPanel, { FilterConfig } from './components/FilterPanel'
import StrategyPanel, { StrategyConfig } from './components/StrategyPanel'
import ResultPanel, { ScreenedStock } from './components/ResultPanel'
import styles from './StrategyPage.module.css'

// 預設 Filter 配置
const DEFAULT_FILTERS: FilterConfig = {
  markets: ['HK_MAIN', 'HK_GEM'],
  sector: 'ALL',
  logic: 'AND',
}

// 預設策略配置（所有策略預設關閉）
const DEFAULT_STRATEGIES: StrategyConfig[] = [
  // 技術分析
  { id: 'zigzag_v', enabled: false, params: { threshold: 5 } },
  { id: 'volume_surge', enabled: false, params: { multiplier: 2 } },
  { id: 'breakout', enabled: false, params: { period: 20 } },
  // 趨勢追蹤
  { id: 'above_ma20', enabled: false, params: {} },
  { id: 'above_ma50', enabled: false, params: {} },
  { id: 'above_ma200', enabled: false, params: {} },
  // 動能策略
  { id: 'rsi_oversold', enabled: false, params: { threshold: 30 } },
  { id: 'macd_cross', enabled: false, params: {} },
  { id: 'new_high', enabled: false, params: { period: 20 } },
  // 基本面
  { id: 'low_pe', enabled: false, params: { maxPe: 15 } },
  { id: 'high_roe', enabled: false, params: { minRoe: 15 } },
  // 成交量
  { id: 'volume_shrink', enabled: false, params: { ratio: 0.3 } },
]

// Mock 測試數據 - 動態生成 based on selected strategies
const generateMockResults = (enabledStrategyIds: string[]): ScreenedStock[] => {
  // 假設的股票數據
  const stocks = [
    { code: 'HK.00700', name: '騰訊控股', price: 467.80, change: -11.40, pctChange: -2.38 },
    { code: 'HK.00981', name: '中芯國際', price: 70.90, change: 5.10, pctChange: 7.75 },
    { code: 'HK.02382', name: '比亞迪', price: 298.00, change: 9.26, pctChange: 3.21 },
    { code: 'HK.06809', name: '瀾起科技', price: 42.50, change: 1.85, pctChange: 4.55 },
  ]
  
  // 策略映射 - 每隻股票實際符合的策略
  const stockStrategies: Record<string, string[]> = {
    'HK.00700': ['zigzag_v', 'volume_surge', 'above_ma20'],
    'HK.00981': ['zigzag_v', 'above_ma20', 'above_ma50'],
    'HK.02382': ['volume_surge', 'above_ma50', 'above_ma200'],
    'HK.06809': ['zigzag_v', 'macd_cross', 'rsi_oversold'],
  }
  
  return stocks
    .map(stock => {
      // 過濾：只保留用戶揀選了的策略
      const matched = stockStrategies[stock.code]?.filter(s => enabledStrategyIds.includes(s)) || []
      return {
        ...stock,
        matchedStrategies: matched,
      }
    })
    .filter(stock => stock.matchedStrategies.length > 0) // 至少要有一個匹配的策略
}

const MOCK_RESULTS: ScreenedStock[] = [] // 空，等動態生成

export default function StrategyPage() {
  const [filters, setFilters] = useState<FilterConfig>(DEFAULT_FILTERS)
  const [strategies, setStrategies] = useState<StrategyConfig[]>(DEFAULT_STRATEGIES)
  const [results, setResults] = useState<ScreenedStock[]>([])
  const [loading, setLoading] = useState(false)

  const handleExecute = useCallback(async () => {
    const enabledStrategies = strategies.filter(s => s.enabled)
    if (enabledStrategies.length === 0) {
      message.warning('請至少選擇一個策略')
      return
    }

    setLoading(true)
    try {
      // TODO: 調用真實 API
      // const response = await fetch('/api/strategy/screen', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ filters, strategies }),
      // })
      // const data = await response.json()
      // setResults(data.stocks)

      // Mock: 模擬 API 延遲
      await new Promise(resolve => setTimeout(resolve, 1500))
      
      // 只傳遞用戶選中的策略ID
      const enabledStrategyIds = enabledStrategies.map(s => s.id)
      const mockResults = generateMockResults(enabledStrategyIds)
      setResults(mockResults)
      message.success(`找到 ${mockResults.length} 隻符合條件的股票`)
    } catch (err) {
      console.error('執行策略失敗:', err)
      message.error('執行策略失敗')
    } finally {
      setLoading(false)
    }
  }, [filters, strategies])

  const handleRefresh = useCallback(() => {
    // 刷新：重新執行策略
    handleExecute()
  }, [handleExecute])

  return (
    <AppLayout connected={true} subscribed={false}>
      <div className={styles.container}>
        {/* 左側：條件選擇 + 策略面板 */}
        <div className={styles.leftPanel}>
          <FilterPanel filters={filters} onChange={setFilters} />
          <StrategyPanel strategies={strategies} onChange={setStrategies} />
          <Button
            type="primary"
            size="large"
            icon={<PlayCircleOutlined />}
            onClick={handleExecute}
            loading={loading}
            className={styles.executeBtn}
            block
          >
            執行策略
          </Button>
        </div>

        {/* 右側：結果顯示 */}
        <div className={styles.rightPanel}>
          <ResultPanel
            results={results}
            loading={loading}
            onRefresh={handleRefresh}
            onExecute={handleExecute}
          />
        </div>
      </div>
    </AppLayout>
  )
}

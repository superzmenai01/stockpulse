// StrategyPage - 指標頁面
// 用於根據技術指標篩選股票

import React, { useState, useCallback } from 'react'
import { Button, message, Spin } from 'antd'
import { PlayCircleOutlined } from '@ant-design/icons'
import { AppLayout } from '../../components/layout'
import FilterPanel, { FilterConfig } from './components/FilterPanel'
import StrategyPanel, { StrategyConfig } from './components/StrategyPanel'
import ResultPanel, { ScreenedStock } from './components/ResultPanel'
import { API_BASE } from '../../config'
import styles from './StrategyPage.module.css'

// 預設 Filter 配置
// 大少 2026-07-25 龍頭板塊 reset (Q2 A): 刪晒 hardcoded default
// - markets: []  → 空 (user 必須揀, 唔預設)
// - sector: ''   → 空 (user 必須揀, 唔預設 'ALL')
// - logic: 'AND' → 保留 (AND/OR 係 operator, 一定要有 default, TypeScript type 强制咗)
const DEFAULT_FILTERS: FilterConfig = {
  markets: [],
  sector: '',
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

export default function StrategyPage() {
  const [filters, setFilters] = useState<FilterConfig>(DEFAULT_FILTERS)
  const [strategies, setStrategies] = useState<StrategyConfig[]>(DEFAULT_STRATEGIES)
  const [results, setResults] = useState<ScreenedStock[]>([])
  const [loading, setLoading] = useState(false)

  const handleExecute = useCallback(async () => {
    const enabledStrategies = strategies.filter(s => s.enabled)
    if (enabledStrategies.length === 0) {
      message.warning('請至少選擇一個指標')
      return
    }

    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/strategy/screen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters, strategies: enabledStrategies }),
      })
      if (!response.ok) {
        const text = await response.text()
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`)
      }
      const data = await response.json()
      const matched = Array.isArray(data.stocks) ? data.stocks : []
      setResults(matched)
      message.success(`找到 ${matched.length} 隻符合條件的股票`)
    } catch (err) {
      console.error('執行指標失敗:', err)
      message.error('執行指標失敗')
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
            執行指標
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

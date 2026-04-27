// StockSearch - 股票搜索自動完成組件

import React, { useState, useRef } from 'react'
import { AutoComplete, Input } from 'antd'
import { stockApi, StockSearchResult } from '../../services/stockApi'
import styles from './StockSearch.module.css'

interface StockSearchProps {
  placeholder?: string
  onSelect: (stock: StockSearchResult) => void
  autoFocus?: boolean
}

function StockSearch({ placeholder = '搜索股票...', onSelect, autoFocus }: StockSearchProps) {
  const [options, setOptions] = useState<StockSearchResult[]>([])
  const [searchValue, setSearchValue] = useState('')
  const abortControllerRef = useRef<AbortController>()

  // 根據輸入內容判斷市場
  const getMarket = (value: string): string | undefined => {
    // 如果包含英文字母，搜尋美股
    if (/[a-zA-Z]/.test(value)) {
      return 'US'
    }
    // 如果純數字，搜尋港股
    if (/^\d+$/.test(value)) {
      return 'HK'
    }
    // 混合內容或中文，不指定市場
    return undefined
  }

  // 搜索股票（直接搜索，無防抖）
  const handleSearch = async (value: string) => {
    setSearchValue(value)
    console.log('[StockSearch] handleSearch called with:', value)

    if (!value.trim()) {
      console.log('[StockSearch] Empty value, clearing options')
      setOptions([])
      return
    }

    // 取消之前的請求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    try {
      abortControllerRef.current = new AbortController()
      const market = getMarket(value)
      console.log('[StockSearch] Calling API with market:', market)
      const results = await stockApi.search(value, market)
      console.log('[StockSearch] Got results:', results.length, results.slice(0, 3))
      // 確保是最新輸入的結果
      if (!abortControllerRef.current.signal.aborted) {
        setOptions(results.slice(0, 10))
      }
    } catch (err) {
      console.log('[StockSearch] Error:', err)
      if ((err as Error).name !== 'AbortError') {
        console.error('搜索失敗:', err)
      }
    }
  }

  // 選擇股票
  const handleSelect = (value: string) => {
    const stock = options.find(s => s.code === value)
    if (stock) {
      onSelect(stock)
      setSearchValue('')
      setOptions([])
    }
  }

  // 渲染選項
  const renderOption = (stock: StockSearchResult) => ({
    value: stock.code,
    label: (
      <div className={styles.option}>
        <span className={styles.optionCode}>{stock.code}</span>
        <span className={styles.optionName}>{stock.name}</span>
        <span className={styles.optionMarket}>{stock.market}</span>
      </div>
    ),
  })

  return (
    <AutoComplete
      className={styles.search}
      value={searchValue}
      options={options.map(renderOption)}
      onSearch={handleSearch}
      onSelect={handleSelect}
      placeholder={placeholder}
      autoFocus={autoFocus}
    >
      <Input.Search size="large" />
    </AutoComplete>
  )
}

export default StockSearch

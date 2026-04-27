// StockSearch - 股票搜索自動完成組件

import React, { useState, useEffect, useRef } from 'react'
import { AutoComplete, Input } from 'antd'
import { stockApi, StockSearchResult } from '../../services/stockApi'
import styles from './StockSearch.module.css'

interface StockSearchProps {
  placeholder?: string
  onSelect: (stock: StockSearchResult) => void
  autoFocus?: boolean
  market?: string  // 'HK' or 'US' or undefined for all
}

function StockSearch({ placeholder = '搜索股票...', onSelect, autoFocus, market }: StockSearchProps) {
  const [options, setOptions] = useState<StockSearchResult[]>([])
  const [searchValue, setSearchValue] = useState('')
  const debounceRef = useRef<NodeJS.Timeout>()
  const abortControllerRef = useRef<AbortController>()

  // 搜索股票
  const handleSearch = (value: string) => {
    setSearchValue(value)

    // 清除之前的計時器
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    // 取消之前的請求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // 0.3 秒防抖
    debounceRef.current = setTimeout(async () => {
      if (!value.trim()) {
        setOptions([])
        return
      }

      try {
        abortControllerRef.current = new AbortController()
        const results = await stockApi.search(value, market)
        setOptions(results.slice(0, 10)) // 最多顯示 10 個
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('搜索失敗:', err)
        }
      }
    }, 300)
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

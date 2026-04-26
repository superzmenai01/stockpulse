// StockSearch - 股票搜索自動完成組件

import React, { useState, useEffect, useRef } from 'react'
import { AutoComplete, Input } from 'antd'
import styles from './StockSearch.module.css'

interface Stock {
  code: string
  name: string
}

interface StockSearchProps {
  placeholder?: string
  onSelect: (stock: Stock) => void
  autoFocus?: boolean
}

// Mock 股票數據（TODO: 替換為 API）
const mockStocks: Stock[] = [
  { code: 'HK.00700', name: '騰訊控股' },
  { code: 'HK.00981', name: '中芯國際' },
  { code: 'HK.00005', name: '滙豐控股' },
  { code: 'HK.01810', name: '小米集團' },
  { code: 'HK.02382', name: '比亞迪' },
  { code: 'HK.09988', name: '阿里巴巴' },
  { code: 'HK.03690', name: '美團點評' },
  { code: 'HK.09660', name: '地平線機器人' },
]

function StockSearch({ placeholder = '搜索股票...', onSelect, autoFocus }: StockSearchProps) {
  const [options, setOptions] = useState<Stock[]>([])
  const [searchValue, setSearchValue] = useState('')
  const debounceRef = useRef<NodeJS.Timeout>()

  // 搜索股票
  const handleSearch = (value: string) => {
    setSearchValue(value)

    // 清除之前的計時器
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    // 0.5 秒防抖
    debounceRef.current = setTimeout(() => {
      if (!value.trim()) {
        setOptions([])
        return
      }

      // TODO: 調用真實 API
      // 模擬搜索：過濾股票代碼或名稱
      const filtered = mockStocks.filter(
        stock =>
          stock.code.toLowerCase().includes(value.toLowerCase()) ||
          stock.name.includes(value)
      )
      setOptions(filtered.slice(0, 10)) // 最多顯示 10 個
    }, 500)
  }

  // 選擇股票
  const handleSelect = (value: string) => {
    const stock = mockStocks.find(s => s.code === value)
    if (stock) {
      onSelect(stock)
      setSearchValue('')
      setOptions([])
    }
  }

  // 渲染選項
  const renderOption = (stock: Stock) => ({
    value: stock.code,
    label: (
      <div className={styles.option}>
        <span className={styles.optionCode}>{stock.code}</span>
        <span className={styles.optionName}>{stock.name}</span>
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

/**
 * StockPulse 股票 API 服務
 */

import { API_BASE } from '../config'

export interface Stock {
  code: string
  name: string
  lot_size?: number
  stock_type?: string
  exchange_type?: string
  market: string
}

export interface StockSearchResult {
  code: string
  name: string
  lot_size: number
  stock_type: string
  exchange_type: string
  market: string
}

async function request<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.json()
}

export const stockApi = {
  /** 搜索股票 */
  search: (keyword: string, market?: string): Promise<StockSearchResult[]> => {
    const params = new URLSearchParams({ q: keyword })
    if (market) {
      params.set('market', market)
    }
    return request<StockSearchResult[]>(`${API_BASE}/stocks/search?${params}`)
  },

  /** 獲取股票詳情 */
  get: (code: string): Promise<Stock> => {
    return request<Stock>(`${API_BASE}/stocks/${code}`)
  },

  /** 獲取市場股票列表 */
  listByMarket: (market: string, limit = 100): Promise<Stock[]> => {
    return request<Stock[]>(`${API_BASE}/stocks/?market=${market}&limit=${limit}`)
  },
}

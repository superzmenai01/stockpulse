/**
 * StockPulse 組別 API 服務
 */

import { API_BASE } from '../config'

export interface Group {
  id: string
  name: string
  color: string
  user_id: string
  position: number
  created_at?: string
  updated_at?: string
  stockCodes?: string[]
}

export interface CreateGroupRequest {
  name: string
  color: string
}

export interface UpdateGroupRequest {
  name: string
  color: string
}

export interface GroupStock {
  stock_code: string
  name: string
  market: string
  exchange_type: string
  added_at: string
}

async function request<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }))
    throw new Error(error.detail || `HTTP ${response.status}`)
  }
  
  return response.json()
}

export const groupApi = {
  /** 獲取所有組別 */
  list: (): Promise<Group[]> => {
    return request<Group[]>(`${API_BASE}/groups`)
  },

  /** 獲取單個組別 */
  get: (id: string): Promise<Group> => {
    return request<Group>(`${API_BASE}/groups/${id}`)
  },

  /** 創建組別 */
  create: (data: CreateGroupRequest): Promise<Group> => {
    return request<Group>(`${API_BASE}/groups`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /** 更新組別 */
  update: (id: string, data: UpdateGroupRequest): Promise<Group> => {
    return request<Group>(`${API_BASE}/groups/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  /** 刪除組別 */
  delete: (id: string): Promise<{ success: boolean }> => {
    return request<{ success: boolean }>(`${API_BASE}/groups/${id}`, {
      method: 'DELETE',
    })
  },

  /** 重新排序組別 */
  reorder: (groupIds: string[]): Promise<Group[]> => {
    return request<Group[]>(`${API_BASE}/groups/reorder`, {
      method: 'POST',
      body: JSON.stringify({ group_ids: groupIds }),
    })
  },

  // ============ 組別-股票關聯 ============

  /** 獲取組別的股票 */
  getStocks: (groupId: string): Promise<GroupStock[]> => {
    return request<GroupStock[]>(`${API_BASE}/groups/${groupId}/stocks`)
  },

  /** 添加股票到組別 */
  addStock: (groupId: string, stockCode: string): Promise<{ success: boolean }> => {
    return request<{ success: boolean }>(`${API_BASE}/groups/${groupId}/stocks`, {
      method: 'POST',
      body: JSON.stringify({ stock_code: stockCode }),
    })
  },

  /** 從組別移除股票 */
  removeStock: (groupId: string, stockCode: string): Promise<{ success: boolean }> => {
    return request<{ success: boolean }>(`${API_BASE}/groups/${groupId}/stocks/${stockCode}`, {
      method: 'DELETE',
    })
  },
}

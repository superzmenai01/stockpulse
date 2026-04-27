/**
 * StockPulse 組別 API 服務
 */

const API_BASE = `http://${window.location.hostname}:18792/api`

export interface Group {
  id: string
  name: string
  color: string
  user_id: string
  created_at?: string
  updated_at?: string
  stockCodes?: string[]  // TODO: 組別和股票的關聯尚未實現
}

export interface CreateGroupRequest {
  name: string
  color: string
}

export interface UpdateGroupRequest {
  name: string
  color: string
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
}

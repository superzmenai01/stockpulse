// Settings API Service
// 2026-08-02 #9699 QW-2a: use central API_BASE from config/api
import { API_BASE } from '../config/api'

export async function fetchIndicatorSettings(): Promise<Record<string, any>> {
  const res = await fetch(`${API_BASE}/settings`)
  if (!res.ok) throw new Error('Failed to fetch settings')
  return res.json()
}

export async function saveIndicatorSettings(config: Record<string, any>): Promise<void> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ indicator_config: config }),
  })
  if (!res.ok) throw new Error('Failed to save settings')
}

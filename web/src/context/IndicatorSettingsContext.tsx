// IndicatorSettingsContext - 指標設置持久化

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { fetchIndicatorSettings, saveIndicatorSettings } from '../services/settingsApi'
import { DEFAULT_INDICATOR_CONFIG, IndicatorConfig } from '../components/chart/IndicatorPanel'

interface IndicatorSettingsContextType {
  config: IndicatorConfig
  setConfig: (config: IndicatorConfig) => void
  loading: boolean
  error: string | null
}

const IndicatorSettingsContext = createContext<IndicatorSettingsContextType | null>(null)

export function IndicatorSettingsProvider({ children }: { children: ReactNode }) {
  const [config, setConfigState] = useState<IndicatorConfig>(DEFAULT_INDICATOR_CONFIG)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 載入設置
  useEffect(() => {
    fetchIndicatorSettings()
      .then((data) => {
        // 合併預設值和已保存的設置
        const merged = { ...DEFAULT_INDICATOR_CONFIG, ...data }
        setConfigState(merged)
        setLoading(false)
      })
      .catch((err) => {
        console.error('Failed to load indicator settings:', err)
        setError('Failed to load settings')
        setLoading(false)
      })
  }, [])

  // 保存設置
  const setConfig = useCallback((newConfig: IndicatorConfig) => {
    setConfigState(newConfig)
    // 非同步保存，不阻塞 UI
    saveIndicatorSettings(newConfig).catch((err) => {
      console.error('Failed to save indicator settings:', err)
    })
  }, [])

  return (
    <IndicatorSettingsContext.Provider value={{ config, setConfig, loading, error }}>
      {children}
    </IndicatorSettingsContext.Provider>
  )
}

export function useIndicatorSettings() {
  const context = useContext(IndicatorSettingsContext)
  if (!context) {
    throw new Error('useIndicatorSettings must be used within IndicatorSettingsProvider')
  }
  return context
}

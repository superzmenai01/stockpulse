// ThemeContext - 日夜主題切換（富途風格）

import React, { createContext, useContext, useState, useEffect } from 'react'
import { ConfigProvider, theme } from 'antd'

type ThemeMode = 'light' | 'dark'

interface ThemeContextType {
  mode: ThemeMode
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType>({
  mode: 'light',
  toggleTheme: () => {},
})

export function useTheme() {
  return useContext(ThemeContext)
}

// 從 localStorage 讀取保存的主題
function getInitialMode(): ThemeMode {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('stockpulse-theme')
    if (saved === 'dark' || saved === 'light') {
      return saved
    }
    // 預設跟隨系統
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark'
    }
  }
  return 'light'
}

// 富途風格暗色主題配置
const futuDarkTokens = {
  colorBgBase: '#0D1114',
  colorBgContainer: '#191C1F',
  colorBgElevated: '#24292E',
  colorBgLayout: '#0D1114',
  colorBgSpotlight: '#24292E',
  colorText: '#D1D1D1',
  colorTextSecondary: '#8A8A8A',
  colorTextTertiary: '#6E6E6E',
  colorTextQuaternary: '#4A4A4A',
  colorBorder: '#30363D',
  colorBorderSecondary: '#21262D',
  colorPrimary: '#F9A11B',
  colorSuccess: '#26BA75',
  colorError: '#EE5151',
  colorWarning: '#F9A11B',
  colorInfo: '#58A6FF',
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(getInitialMode)

  const toggleTheme = () => {
    setMode(prev => {
      const next = prev === 'light' ? 'dark' : 'light'
      localStorage.setItem('stockpulse-theme', next)
      return next
    })
  }

  // 設置 data-theme attribute 控制 CSS Variables
  useEffect(() => {
    document.body.setAttribute('data-theme', mode)
  }, [mode])

  const antTheme = mode === 'dark'
    ? { algorithm: theme.darkAlgorithm, token: futuDarkTokens }
    : { algorithm: theme.defaultAlgorithm }

  return (
    <ThemeContext.Provider value={{ mode, toggleTheme }}>
      <ConfigProvider theme={antTheme}>
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  )
}
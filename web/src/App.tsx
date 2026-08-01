// StockPulse 主應用

import { Routes, Route, Navigate } from 'react-router-dom'
import { App as AntApp } from 'antd' // 大少 #8807 (2026-07-29): wrap 喺 AntD <App> 入面，等 useApp() static method 用到 message/modal/notification context
import { WebSocketProvider } from './context'
import { ThemeProvider } from './context/ThemeContext'
import { IndicatorSettingsProvider } from './context/IndicatorSettingsContext'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import WatchlistPage from './pages/WatchlistPage'
import StrategyPage from './pages/StrategyPage'
import AlgorithmStrategyPage from './pages/AlgorithmStrategyPage'
import CalendarPage from './pages/CalendarPage'
import TestKlinePage from './pages/TestKlinePage/TestKlinePage'
import ElliottWaveTestPage from './pages/ElliottWaveTestPage/ElliottWaveTestPage'
import GridTestPage from './pages/GridTestPage/GridTestPage'
import LibraryPage from './pages/LibraryPage/LibraryPage'
import SettingsPage from './pages/SettingsPage/SettingsPage'

function App() {
  return (
    <ThemeProvider>
      <WebSocketProvider>
        <IndicatorSettingsProvider>
          {/* 大少 #8807 (2026-07-29): AntApp 提供 context 俾 useApp() 使用者 (e.g. ViewRunModal) */}
          <AntApp>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<HomePage />} />
            <Route path="/watchlist" element={<WatchlistPage />} />
            <Route path="/strategy" element={<StrategyPage />} />
            <Route path="/algorithms" element={<AlgorithmStrategyPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/test-kline" element={<TestKlinePage />} />
            <Route path="/ew-test" element={<ElliottWaveTestPage />} />
            <Route path="/grid-test" element={<GridTestPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </AntApp>
        </IndicatorSettingsProvider>
      </WebSocketProvider>
    </ThemeProvider>
  )
}

export default App

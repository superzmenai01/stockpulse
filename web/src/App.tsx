// StockPulse 主應用

import { Routes, Route, Navigate } from 'react-router-dom'
import { WebSocketProvider } from './context'
import { ThemeProvider } from './context/ThemeContext'
import { IndicatorSettingsProvider } from './context/IndicatorSettingsContext'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import WatchlistPage from './pages/WatchlistPage'
import StrategyPage from './pages/StrategyPage'
import CalendarPage from './pages/CalendarPage'
import TestKlinePage from './pages/TestKlinePage/TestKlinePage'

function App() {
  return (
    <ThemeProvider>
      <WebSocketProvider>
        <IndicatorSettingsProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<HomePage />} />
            <Route path="/watchlist" element={<WatchlistPage />} />
            <Route path="/strategy" element={<StrategyPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/test-kline" element={<TestKlinePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </IndicatorSettingsProvider>
      </WebSocketProvider>
    </ThemeProvider>
  )
}

export default App

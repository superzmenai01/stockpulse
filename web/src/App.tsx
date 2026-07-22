// StockPulse 主應用

import { Routes, Route, Navigate } from 'react-router-dom'
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
            <Route path="/algorithms" element={<AlgorithmStrategyPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/test-kline" element={<TestKlinePage />} />
            <Route path="/ew-test" element={<ElliottWaveTestPage />} />
            <Route path="/grid-test" element={<GridTestPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </IndicatorSettingsProvider>
      </WebSocketProvider>
    </ThemeProvider>
  )
}

export default App

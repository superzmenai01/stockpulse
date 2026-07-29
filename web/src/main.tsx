import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Button } from 'antd'
import App from './App'
import './styles/theme.css'

// 大少 #9002 (2026-07-29): 頂層 ErrorBoundary + Fallback UI
// - React 17/18 silent crash (no top-level boundary) 會令 root div 完全空白
// - 呢個 ErrorBoundary catch 將來 crash + 顯示 reset button + reload
interface RootErrorBoundaryState {
  hasError: boolean
  error: Error | null
}
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  RootErrorBoundaryState
> {
  state: RootErrorBoundaryState = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[RootErrorBoundary] caught:', error, info)
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <div
          style={{
            padding: 32,
            margin: 24,
            background: '#1e1e1e',
            color: '#fff',
            borderRadius: 8,
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          <h2 style={{ marginTop: 0 }}>⚠️ StockPulse 載入失敗</h2>
          <p style={{ color: '#999', marginBottom: 16 }}>
            React app 喺 startup 撞到 error (root catch)。撳下面 reload 重新試：
          </p>
          <pre
            style={{
              background: '#000',
              color: '#f88',
              padding: 12,
              borderRadius: 4,
              overflow: 'auto',
              fontSize: 12,
              maxHeight: 240,
            }}
          >
            {this.state.error.message}
            {'\n'}
            {this.state.error.stack?.split('\n').slice(0, 10).join('\n')}
          </pre>
          <div style={{ marginTop: 16 }}>
            <Button type="primary" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </RootErrorBoundary>
  </React.StrictMode>,
)
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhHK from 'antd/locale/zh_HK'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ConfigProvider locale={zhHK}>
        <App />
      </ConfigProvider>
    </BrowserRouter>
  </React.StrictMode>,
)

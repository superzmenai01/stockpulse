import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from 'antd'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'

const { Header, Content } = Layout

function App() {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: '#001529', padding: '0 24px', display: 'flex', alignItems: 'center' }}>
        <h1 style={{ color: 'white', margin: 0, fontSize: 20 }}>📈 StockPulse</h1>
      </Header>
      <Content style={{ padding: '24px', background: '#f0f2f5' }}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<HomePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Content>
    </Layout>
  )
}

export default App

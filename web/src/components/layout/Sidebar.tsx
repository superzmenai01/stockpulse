// Sidebar - 桌面版側邊欄

import React from 'react'
import { Menu } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  HomeOutlined,
  StarOutlined,
  BarChartOutlined,
  CalendarOutlined,
} from '@ant-design/icons'
import styles from './Sidebar.module.css'

// 導航項目
const navItems = [
  { key: '/', icon: <HomeOutlined />, label: '首頁' },
  { key: '/watchlist', icon: <StarOutlined />, label: '關注股票' },
  { key: '/strategy', icon: <BarChartOutlined />, label: '策略' },
  { key: '/calendar', icon: <CalendarOutlined />, label: '日曆' },
]

function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()

  const handleMenuClick = (key: string) => {
    navigate(key)
  }

  return (
    <div className={styles.sidebar}>
      <div className={styles.logo}>
        <span className={styles.logoText}>📈 StockPulse</span>
      </div>
      
      <Menu
        mode="inline"
        selectedKeys={[location.pathname]}
        className={styles.menu}
        items={navItems.map(item => ({
          key: item.key,
          icon: item.icon,
          label: item.label,
          onClick: () => handleMenuClick(item.key),
        }))}
      />
    </div>
  )
}

export default Sidebar

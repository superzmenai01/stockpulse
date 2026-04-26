// MobileNav - 手機版底部導航

import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { HomeOutlined, StarOutlined, BarChartOutlined, CalendarOutlined } from '@ant-design/icons'
import styles from './MobileNav.module.css'

// 導航項目
const navItems = [
  { key: '/', icon: <HomeOutlined />, label: '首頁' },
  { key: '/watchlist', icon: <StarOutlined />, label: '關注' },
  { key: '/strategy', icon: <BarChartOutlined />, label: '策略' },
  { key: '/calendar', icon: <CalendarOutlined />, label: '日曆' },
]

function MobileNav() {
  const navigate = useNavigate()
  const location = useLocation()

  const handleClick = (key: string) => {
    navigate(key)
  }

  return (
    <div className={styles.nav}>
      {navItems.map(item => {
        const isActive = location.pathname === item.key
        return (
          <div
            key={item.key}
            className={`${styles.navItem} ${isActive ? styles.active : ''}`}
            onClick={() => handleClick(item.key)}
          >
            <span className={styles.icon}>{item.icon}</span>
            <span className={styles.label}>{item.label}</span>
          </div>
        )
      })}
    </div>
  )
}

export default MobileNav

// Header - 頂部導航

import React from 'react'
import { Space, Tag, Button } from 'antd'
import { useNavigate } from 'react-router-dom'
import styles from './Header.module.css'

interface HeaderProps {
  connected?: boolean
  subscribed?: boolean
}

function Header({ connected = false, subscribed = false }: HeaderProps) {
  const navigate = useNavigate()

  const handleLogout = () => {
    navigate('/login')
  }

  return (
    <div className={styles.header}>
      <div className={styles.left}>
        <span className={styles.title}>📈 StockPulse</span>
      </div>
      
      <div className={styles.right}>
        <Space>
          <Tag color={connected ? 'green' : 'red'}>
            {connected ? '已連接' : '未連接'}
          </Tag>
          <Tag color={subscribed ? 'blue' : 'orange'}>
            {subscribed ? '已訂閱' : '未訂閱'}
          </Tag>
          <Button size="small" onClick={handleLogout}>
            登出
          </Button>
        </Space>
      </div>
    </div>
  )
}

export default Header

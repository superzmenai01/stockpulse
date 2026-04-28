// Header - 頂部導航

import React from 'react'
import { Space, Tag, Button, Switch } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '../../context/ThemeContext'
import styles from './Header.module.css'

interface HeaderProps {
  connected?: boolean
  subscribed?: boolean
  waitingCancel?: boolean
  cancelCooldown?: number
  onUnsubscribe?: () => void
}

function Header({
  connected = false,
  subscribed = false,
  waitingCancel = false,
  cancelCooldown = 0,
  onUnsubscribe,
}: HeaderProps) {
  const navigate = useNavigate()
  const { mode, toggleTheme } = useTheme()

  const handleLogout = () => {
    if (onUnsubscribe) {
      onUnsubscribe()
    }
    navigate('/login')
  }

  return (
    <div className={styles.header}>
      <div className={styles.left}>
        <span className={styles.title}>📈 StockPulse</span>
      </div>
      
      <div className={styles.right}>
        <Space>
          <Switch
            checked={mode === 'dark'}
            onChange={toggleTheme}
            checkedChildren="🌙"
            unCheckedChildren="☀️"
            size="small"
          />
          <Tag color={connected ? 'green' : 'red'}>
            {connected ? '已連接' : '未連接'}
          </Tag>
          <Tag color={waitingCancel ? 'purple' : (subscribed ? 'blue' : 'orange')}>
            {waitingCancel ? `等待取消 ${cancelCooldown}s` : (subscribed ? '已訂閱' : '未訂閱')}
          </Tag>
          {subscribed && !waitingCancel && (
            <Button size="small" danger onClick={onUnsubscribe}>
              取消訂閱
            </Button>
          )}
          <Button size="small" onClick={handleLogout}>
            登出
          </Button>
        </Space>
      </div>
    </div>
  )
}

export default Header

// AppLayout - 主要佈局組件
// Desktop: 側邊欄 (drag-to-resize + auto-persist) + 內容區
// Mobile: 底部導航 + 內容區

import React from 'react'
import { Layout } from 'antd'
import Sidebar from './Sidebar'
import MobileNav from './MobileNav'
import Header from './Header'
import { useDragResize } from '../../utils/useDragResize'
import styles from './AppLayout.module.css'

const { Content, Sider } = Layout

interface AppLayoutProps {
  children: React.ReactNode
  connected?: boolean
  subscribed?: boolean
  waitingCancel?: boolean
  cancelCooldown?: number
  onUnsubscribe?: () => void
}

function AppLayout({
  children,
  connected = false,
  subscribed = false,
  waitingCancel = false,
  cancelCooldown = 0,
  onUnsubscribe,
}: AppLayoutProps) {
  const [isMobile, setIsMobile] = React.useState(false)
  const sidebar = useDragResize({
    initial: 200,
    min: 160,
    max: 400,
    storageKey: 'main-sidebar-width',
  })

  React.useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }
    
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  return (
    <Layout className={styles.layout}>
      {isMobile ? (
        // Mobile: 只有 Header + Content + 底部導航
        <>
          <Header
            connected={connected}
            subscribed={subscribed}
            waitingCancel={waitingCancel}
            cancelCooldown={cancelCooldown}
            onUnsubscribe={onUnsubscribe}
          />
          <Content className={styles.content}>
            {children}
          </Content>
          <MobileNav />
        </>
      ) : (
        // Desktop: 側邊欄 + Header + Content
        <>
          <Sider width={sidebar.width} className={styles.sider}>
            <Sidebar />
            {/* Drag handle on right edge */}
            <div
              className={`${styles.resizeHandle} ${sidebar.dragging ? styles.resizeHandleActive : ''}`}
              onMouseDown={sidebar.handleMouseDown}
              title="拖拽改 sidebar 闊度"
            />
          </Sider>
          <Layout>
            <Header
              connected={connected}
              subscribed={subscribed}
              waitingCancel={waitingCancel}
              cancelCooldown={cancelCooldown}
              onUnsubscribe={onUnsubscribe}
            />
            <Content className={styles.content} style={{ marginLeft: sidebar.width }}>
              {children}
            </Content>
          </Layout>
        </>
      )}
    </Layout>
  )
}

export default AppLayout

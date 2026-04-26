// AppLayout - 主要佈局組件
// Desktop: 側邊欄 + 內容區
// Mobile: 底部導航 + 內容區

import React from 'react'
import { Layout } from 'antd'
import Sidebar from './Sidebar'
import MobileNav from './MobileNav'
import Header from './Header'
import styles from './AppLayout.module.css'

const { Content, Sider } = Layout

interface AppLayoutProps {
  children: React.ReactNode
}

function AppLayout({ children }: AppLayoutProps) {
  const [isMobile, setIsMobile] = React.useState(false)

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
          <Header />
          <Content className={styles.content}>
            {children}
          </Content>
          <MobileNav />
        </>
      ) : (
        // Desktop: 側邊欄 + Header + Content
        <>
          <Sider width={200} className={styles.sider}>
            <Sidebar />
          </Sider>
          <Layout>
            <Header />
            <Content className={styles.content}>
              {children}
            </Content>
          </Layout>
        </>
      )}
    </Layout>
  )
}

export default AppLayout

// WatchlistPage - 關注股票頁

import React from 'react'
import { AppLayout } from '../../components/layout'
import { Card, Empty } from 'antd'
import styles from './WatchlistPage.module.css'

function WatchlistPage() {
  return (
    <AppLayout>
      <div className={styles.container}>
        <h2 className={styles.title}>關注股票</h2>
        
        <Card className={styles.card}>
          <Empty description="功能開發中..." />
        </Card>
      </div>
    </AppLayout>
  )
}

export default WatchlistPage

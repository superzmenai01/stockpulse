// StrategyPage - 策略頁

import React from 'react'
import { AppLayout } from '../../components/layout'
import { Card, Empty } from 'antd'
import styles from './StrategyPage.module.css'

function StrategyPage() {
  return (
    <AppLayout>
      <div className={styles.container}>
        <h2 className={styles.title}>策略</h2>
        
        <Card className={styles.card}>
          <Empty description="功能開發中..." />
        </Card>
      </div>
    </AppLayout>
  )
}

export default StrategyPage

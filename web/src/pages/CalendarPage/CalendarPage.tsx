// CalendarPage - 日曆頁

import React from 'react'
import { AppLayout } from '../../components/layout'
import { Card, Empty } from 'antd'
import styles from './CalendarPage.module.css'

function CalendarPage() {
  return (
    <AppLayout>
      <div className={styles.container}>
        <h2 className={styles.title}>日曆</h2>
        
        <Card className={styles.card}>
          <Empty description="功能開發中..." />
        </Card>
      </div>
    </AppLayout>
  )
}

export default CalendarPage

import React, { useState, useEffect } from 'react'

export default function TestKlinePage() {
  const [currentPeriod, setCurrentPeriod] = useState('1d')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [log, setLog] = useState<string[]>([])

  const addLog = (msg: string) => {
    const now = new Date().toLocaleTimeString()
    setLog(prev => [...prev, `[${now}] ${msg}`])
  }

  // 當 period 改變時，自動調整 startDate
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0]
    let newStartDate = ''

    addLog(`useEffect triggered. currentPeriod=${currentPeriod}`)

    if (currentPeriod === '1M') {
      const d = new Date()
      d.setFullYear(d.getFullYear() - 10)
      newStartDate = d.toISOString().split('T')[0]
      addLog(`月K: 設置 startDate = ${newStartDate}`)
    } else if (currentPeriod === '1y') {
      const d = new Date()
      d.setFullYear(d.getFullYear() - 120)
      newStartDate = d.toISOString().split('T')[0]
      addLog(`年K: 設置 startDate = ${newStartDate}`)
    } else if (currentPeriod === '1d') {
      const d = new Date()
      d.setDate(d.getDate() - 180)
      newStartDate = d.toISOString().split('T')[0]
      addLog(`日K: 設置 startDate = ${newStartDate}`)
    } else {
      addLog(`分鐘K: 不需要 startDate`)
    }

    addLog(`newStartDate=${newStartDate}, current startDate=${startDate}`)
    
    if (newStartDate !== startDate) {
      addLog(`✅ 更新 startDate: ${startDate} -> ${newStartDate}`)
      setStartDate(newStartDate)
      setEndDate(today)
    } else {
      addLog(`❌ 冇更新: newStartDate === startDate`)
    }
  }, [currentPeriod])

  const handlePeriodChange = (period: string) => {
    addLog(`handlePeriodChange called: ${currentPeriod} -> ${period}`)
    setCurrentPeriod(period)
  }

  return (
    <div style={{ padding: 20, fontFamily: 'monospace' }}>
      <h2>Test K-line Date Debug</h2>
      
      <div style={{ marginBottom: 20 }}>
        <strong>Current Period:</strong> {currentPeriod}
      </div>
      
      <div style={{ marginBottom: 20 }}>
        <strong>Start Date:</strong> {startDate}
      </div>
      
      <div style={{ marginBottom: 20 }}>
        <strong>End Date:</strong> {endDate}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <button onClick={() => handlePeriodChange('1d')}>日K</button>
        <button onClick={() => handlePeriodChange('1M')}>月K</button>
        <button onClick={() => handlePeriodChange('1y')}>年K</button>
      </div>

      <div style={{ 
        background: '#000', 
        color: '#0f0', 
        padding: 10, 
        height: 300, 
        overflow: 'auto',
        fontSize: 12
      }}>
        <h3>Console Log:</h3>
        {log.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  )
}

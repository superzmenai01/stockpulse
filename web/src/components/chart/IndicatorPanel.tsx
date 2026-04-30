// IndicatorPanel - 技術指標控制面板

import React, { useState } from 'react'
import { Button, InputNumber } from 'antd'
import styles from './IndicatorPanel.module.css'

interface MAConfig {
  enabled: boolean
  period: number
  color: string
}

interface BOLLConfig {
  enabled: boolean
  period: number
  stdDev: number
  color: string
}

export interface IndicatorConfig {
  MA5: MAConfig
  MA10: MAConfig
  MA20: MAConfig
  MA60: MAConfig
  MA120: MAConfig
  MA250: MAConfig
  EMA5: MAConfig
  EMA10: MAConfig
  EMA20: MAConfig
  BOLL: BOLLConfig
}

export const DEFAULT_INDICATOR_CONFIG: IndicatorConfig = {
  MA5: { enabled: true, period: 5, color: '#FF6B6B' },
  MA10: { enabled: true, period: 10, color: '#4ECDC4' },
  MA20: { enabled: true, period: 20, color: '#45B7D1' },
  MA60: { enabled: false, period: 60, color: '#96CEB4' },
  MA120: { enabled: false, period: 120, color: '#DDA0DD' },
  MA250: { enabled: false, period: 250, color: '#FFB347' },
  EMA5: { enabled: false, period: 5, color: '#FF6B6B' },
  EMA10: { enabled: false, period: 10, color: '#4ECDC4' },
  EMA20: { enabled: false, period: 20, color: '#45B7D1' },
  BOLL: { enabled: false, period: 20, stdDev: 2, color: '#FFB347' },
}

interface IndicatorPanelProps {
  config: IndicatorConfig
  onChange: (config: IndicatorConfig) => void
}

export default function IndicatorPanel({ config, onChange }: IndicatorPanelProps) {
  const [collapsed, setCollapsed] = useState(false)

  const updateMA = (key: keyof Omit<IndicatorConfig, 'BOLL'>, updates: Partial<MAConfig>) => {
    onChange({
      ...config,
      [key]: { ...config[key], ...updates },
    })
  }

  const updateBOLL = (updates: Partial<BOLLConfig>) => {
    onChange({
      ...config,
      BOLL: { ...config.BOLL, ...updates },
    })
  }

  const toggleIndicator = (key: keyof IndicatorConfig) => {
    if (key === 'BOLL') {
      updateBOLL({ enabled: !config.BOLL.enabled })
    } else {
      updateMA(key as keyof Omit<IndicatorConfig, 'BOLL'>, { enabled: !config[key].enabled })
    }
  }

  const renderMAControl = (key: keyof Omit<IndicatorConfig, 'BOLL'>, label: string) => {
    const ma = config[key]
    return (
      <div className={styles.indicatorRow}>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={ma.enabled}
            onChange={() => toggleIndicator(key as keyof IndicatorConfig)}
          />
          <span style={{ color: ma.color }}>{label}</span>
        </label>
        <div className={styles.controls}>
          <span className={styles.label}>週期</span>
          <InputNumber
            size="small"
            min={1}
            max={500}
            value={ma.period}
            onChange={(val) => updateMA(key as keyof Omit<IndicatorConfig, 'BOLL'>, { period: val || 5 })}
            disabled={!ma.enabled}
            className={styles.numberInput}
          />
          <div className={styles.colorPicker}>
            <span className={styles.label}>顏色</span>
            <input
              type="color"
              value={ma.color}
              onChange={(e) => updateMA(key as keyof Omit<IndicatorConfig, 'BOLL'>, { color: e.target.value })}
              disabled={!ma.enabled}
              className={styles.colorInput}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>📊 指標設置</span>
        <Button type="text" size="small" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '展開' : '收起'}
        </Button>
      </div>

      {!collapsed && (
        <div className={styles.content}>
          {/* MA 系列 */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>MA 移動平均線</div>
            {renderMAControl('MA5', 'MA5')}
            {renderMAControl('MA10', 'MA10')}
            {renderMAControl('MA20', 'MA20')}
            {renderMAControl('MA60', 'MA60')}
            {renderMAControl('MA120', 'MA120')}
            {renderMAControl('MA250', 'MA250')}
          </div>

          {/* EMA 系列 */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>EMA 指數移動平均線</div>
            {renderMAControl('EMA5', 'EMA5')}
            {renderMAControl('EMA10', 'EMA10')}
            {renderMAControl('EMA20', 'EMA20')}
          </div>

          {/* BOLL */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>BOLL 布林帶</div>
            <div className={styles.indicatorRow}>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={config.BOLL.enabled}
                  onChange={() => toggleIndicator('BOLL')}
                />
                <span style={{ color: config.BOLL.color }}>BOLL</span>
              </label>
              <div className={styles.controls}>
                <span className={styles.label}>週期</span>
                <InputNumber
                  size="small"
                  min={1}
                  max={100}
                  value={config.BOLL.period}
                  onChange={(val) => updateBOLL({ period: val || 20 })}
                  disabled={!config.BOLL.enabled}
                  className={styles.numberInput}
                />
                <span className={styles.label}>標準差</span>
                <InputNumber
                  size="small"
                  min={0.1}
                  max={10}
                  step={0.1}
                  value={config.BOLL.stdDev}
                  onChange={(val) => updateBOLL({ stdDev: val || 2 })}
                  disabled={!config.BOLL.enabled}
                  className={styles.numberInput}
                />
                <div className={styles.colorPicker}>
                  <span className={styles.label}>顏色</span>
                  <input
                    type="color"
                    value={config.BOLL.color}
                    onChange={(e) => updateBOLL({ color: e.target.value })}
                    disabled={!config.BOLL.enabled}
                    className={styles.colorInput}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

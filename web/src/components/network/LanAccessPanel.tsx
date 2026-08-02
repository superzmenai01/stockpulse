// LanAccessPanel.tsx — 大少 2026-08-02 #9699 QW-5
// 「📡 LAN 訪問設定」panel — 顯示 MacBook LAN IP + frontend URL，
// 讓 user 知道點用其他 device (phone / tablet / laptop) 訪問 StockPulse。
//
// Design:
// - Fetch /api/network/info on mount (QW-2a API_BASE，唔好 hardcoded port)
// - Dark theme: 用 theme.css 既 var(--bg-elevated) + orange accent var(--sidebar-selected)
// - Collapsible to keep HomePage 整潔
// - Copy-to-clipboard for LAN URL

import React, { useState, useEffect } from 'react'
import { API_BASE } from '../../config/api'
import styles from './LanAccessPanel.module.css'

// Response shape 對應 backend/api/network.py network_info() 回傳嘅 JSON。
interface NetworkInfo {
  backend_port: number
  mac_lan_ip: string
  frontend_port: number
  frontend_url_local: string
  frontend_url_lan: string
  other_devices_can_reach: boolean
  miniapps: {
    miniapp_backend_port: number
    miniapp_local_only: boolean
  }
}

function LanAccessPanel() {
  const [info, setInfo] = useState<NetworkInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const loadInfo = async () => {
      try {
        const resp = await fetch(`${API_BASE}/network/info`)
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status} ${resp.statusText}`)
        }
        const data: NetworkInfo = await resp.json()
        setInfo(data)
      } catch (e: any) {
        // 大少 2026-08-02 #9699 QW-5: 即使 fetch 失敗都唔好 crash HomePage，
        // 只係 panel 入面顯示錯誤狀態。
        console.error('[LanAccessPanel] 載入 /api/network/info 失敗:', e)
        setError(e?.message || 'Failed to load network info')
      } finally {
        setLoading(false)
      }
    }
    loadInfo()
  }, [])

  const handleCopy = async () => {
    if (!info) return
    try {
      await navigator.clipboard.writeText(info.frontend_url_lan)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: no clipboard API — skip silently
    }
  }

  return (
    <div className={styles.panel}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <span className={styles.icon}>📡</span>
        <span className={styles.title}>LAN 訪問設定</span>
        <span className={styles.toggle}>{collapsed ? '▸' : '▾'}</span>
      </button>

      {!collapsed && (
        <div className={styles.body}>
          {loading && <div className={styles.loading}>載入中…</div>}

          {error && !loading && (
            <div className={styles.error}>❌ 載入失敗: {error}</div>
          )}

          {info && !loading && !error && (
            <>
              <div className={styles.row}>
                <span className={styles.label}>MacBook IP:</span>
                <span className={styles.value}>{info.mac_lan_ip}</span>
              </div>

              <div className={styles.row}>
                <span className={styles.label}>其他電腦訪問 URL:</span>
                <div className={styles.urlBox}>
                  <a
                    href={info.frontend_url_lan}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.url}
                    title={info.frontend_url_lan}
                  >
                    {info.frontend_url_lan}
                  </a>
                  <button
                    type="button"
                    className={styles.copyBtn}
                    onClick={handleCopy}
                    title="Copy URL"
                  >
                    {copied ? '✅' : '📋'}
                  </button>
                </div>
              </div>

              <div className={styles.row}>
                <span className={styles.label}>Miniapp 狀態:</span>
                <span
                  className={
                    info.miniapps.miniapp_local_only
                      ? styles.badgeLocal
                      : styles.badgeLan
                  }
                >
                  {info.miniapps.miniapp_local_only
                    ? `🔒 本地訪問 (:${info.miniapps.miniapp_backend_port})`
                    : `🌐 LAN 訪問 (:${info.miniapps.miniapp_backend_port})`}
                </span>
              </div>

              <div className={styles.row}>
                <span className={styles.label}>啟用狀態:</span>
                <span
                  className={
                    info.other_devices_can_reach
                      ? styles.badgeEnabled
                      : styles.badgeDisabled
                  }
                >
                  {info.other_devices_can_reach ? '✅ 已啟用' : '❌ 未偵測到 LAN'}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default LanAccessPanel
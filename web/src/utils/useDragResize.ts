// useDragResize - 純手動 drag-to-resize hook + optional localStorage auto-persist
//
// 用法:
//   const { width, handleMouseDown, dragging } = useDragResize({
//     initial: 200,
//     min: 160,
//     max: 400,
//     storageKey: 'main-sidebar-width',  // optional, omit = 唔 persist
//   })
//
// Behavior:
//   - mousedown handleMouseDown → 開始 drag
//   - mousemove → 計算新 width (clamp [min, max])
//   - mouseup → 結束 drag, if storageKey provided 自動寫入 localStorage
//   - Component mount → 先 read localStorage (有 → stored value, 冇 → initial)
//
// 範圍：純前端 hook · 無 backend

import { useState, useEffect, useRef, useCallback } from 'react'

export function useDragResize({
  initial,
  min = 140,
  max = 500,
  storageKey,
}: {
  initial: number
  min?: number
  max?: number
  storageKey?: string
}) {
  // Init: 讀 localStorage (有 → stored value · 冇 → 用 default `initial`)
  const [width, setWidth] = useState<number>(() => {
    if (storageKey) {
      try {
        const stored = localStorage.getItem(storageKey)
        if (stored !== null) {
          const parsed = parseFloat(stored)
          if (!isNaN(parsed) && parsed >= min && parsed <= max) {
            return parsed
          }
        }
      } catch {
        // localStorage unavailable / 私隱 mode — use default
      }
    }
    return initial
  })

  // Keep latest width in ref (for saveToStorage access without re-renders)
  const widthRef = useRef(width)
  useEffect(() => { widthRef.current = width }, [width])

  const [dragging, setDragging] = useState(false)
  const startRef = useRef<{ x: number; w: number } | null>(null)

  const handleMouseDown = (e: React.MouseEvent) => {
    startRef.current = { x: e.clientX, w: width }
    setDragging(true)
    e.preventDefault()
    e.stopPropagation()
  }

  // Auto-save on drag end (mouseup) — only if storageKey provided
  const saveToStorage = useCallback(() => {
    if (!storageKey) return
    try {
      localStorage.setItem(storageKey, String(widthRef.current))
    } catch {
      // localStorage unavailable / quota exceeded — silently ignore
    }
  }, [storageKey])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      if (!startRef.current) return
      const dx = e.clientX - startRef.current.x
      const next = Math.max(min, Math.min(max, startRef.current.w + dx))
      setWidth(next)
    }
    const onUp = () => {
      setDragging(false)
      startRef.current = null
      saveToStorage()  // auto-persist drag 結果
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, min, max, saveToStorage])

  return { width, handleMouseDown, dragging }
}
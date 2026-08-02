// API Configuration - re-export from single source of truth (QW-2a)
// 2026-08-02 #9699: 9 frontend files hardcoded port + host, refactored.
// 
// Backend: web/src/config/api.ts (fallback chain: env var → window.location.hostname → default)
// 
// 用法 (backward compatible):
//   import { API_BASE, WS_BASE } from '../config'  ← 仍然 work (re-export)
//   import { API_BASE, klineUrl } from '../config/api'  ← 新 import path (recommended)

export { API_BASE, WS_BASE, klineUrl } from './api';
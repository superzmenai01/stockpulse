/**
 * API Configuration - Single source of truth (QW-2a port optimization)
 *
 * 大少 2026-08-02 #9699: 9 個 files 之前 hardcoded port + host，refactor 統一。
 *
 * Fallback chain:
 *   1. import.meta.env.VITE_API_HOST / VITE_API_PORT (build-time, .env file)
 *   2. window.location.hostname (runtime, 自動取 MacBook LAN IP for cross-device)
 *   3. hardcoded defaults ('18792')
 *
 * 用法:
 *   import { API_BASE, WS_BASE, klineUrl } from '../config/api'
 *   fetch(`${API_BASE}/plates`)
 *   fetch(klineUrl(params))
 */

const API_PORT = import.meta.env.VITE_API_PORT || '18792';
const API_HOST = import.meta.env.VITE_API_HOST || (typeof window !== 'undefined' ? window.location.hostname : 'localhost');

export const API_BASE = `http://${API_HOST}:${API_PORT}/api`;
export const WS_BASE = `ws://${API_HOST}:${API_PORT}/ws`;

/** Build K-line API URL with query params */
export function klineUrl(params: string | URLSearchParams): string {
  const qs = typeof params === 'string' ? params : params.toString();
  return `http://${API_HOST}:${API_PORT}/api/kline?${qs}`;
}
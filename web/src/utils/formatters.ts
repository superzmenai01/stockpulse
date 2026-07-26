// utils/formatters.ts — Number formatting helpers (extracted from AlgorithmStrategyPage)
// 大少 2026-07-24 Tier 1.3: Frontend modular refactor

/**
 * Format market cap 為 億/萬億 中文
 * 同 backend `models/plate.py` 入面嘅 format_mcap 一致
 *
 * Examples:
 *   formatMcap(0) → '—'
 *   formatMcap(599256419650) → '5993億'
 *   formatMcap(1.2e12) → '1.2萬億'
 */
export function formatMcap(mcap: number): string {
  if (mcap === null || mcap === undefined || isNaN(mcap) || mcap <= 0) return '—';
  if (mcap >= 1e12) return `${(mcap / 1e12).toFixed(1)}萬億`;
  if (mcap >= 1e8) return `${Math.round(mcap / 1e8)}億`;
  if (mcap >= 1e4) return `${Math.round(mcap / 1e4)}萬`;
  return `${Math.round(mcap)}`;
}

/**
 * Format turnover 為 億/萬 簡單格式
 */
export function formatTurnover(turnover: number): string {
  if (turnover === null || turnover === undefined || isNaN(turnover) || turnover <= 0) return '—';
  if (turnover >= 1e8) return `${(turnover / 1e8).toFixed(1)}億`;
  if (turnover >= 1e4) return `${(turnover / 1e4).toFixed(0)}萬`;
  return `${turnover.toFixed(0)}`;
}
// data-loader.ts — AS-03 股票周期判定 · 數據載入器
//
// D008 (2026-08-04): 數據來源 = backend /api/kline (沿用 StockPulse 現有 cache-aside 機制)
//                    唔需要 re-implement cache，backend 已經處理 DB+OpenD hybrid
//
// 機制概要 (backend/services/kline_cache.py):
//   - Step 1: 讀 SQLite (kline_cache 表) — T-1 及之前嘅歷史數據
//   - Step 2: 補資料 — DB 唔夠就由 OpenD 攞 + 寫落 DB (T-1 截止)
//   - Step 3: 當日 from OpenD — always fresh，唔寫 DB
//
// AS-03 frontend 角色: 純 HTTP client → 將 response 轉成 KLine[] 餵俾 modules

import type { KLine, Timeframe } from './types.ts';

export interface LoadKLinesOptions {
  symbol: string;                              // e.g. 'HK.00981', 'US.INTC'
  period: Timeframe;                           // '1d' | '1w' | '1M' | ...
  count?: number;                              // 預設 250 (約 1 年 daily)
  start?: string;                              // YYYY-MM-DD (optional)
  end?: string;                                // YYYY-MM-DD (optional, default today)
  apiBaseUrl?: string;                         // 預設 '/api'
}

export interface LoadKLinesResult {
  klines: KLine[];
  cached: boolean;                             // 全部由 cache 命中
  fetchCount: number;                          // 從 OpenD 補嘅條數
  source: 'db+opend' | 'db-only' | 'opend-only' | 'unknown';
}

/**
 * 將 backend response 嘅 kline dict 轉成統一 KLine 結構
 *
 * Backend schema:
 *   { time, open, high, low, close, volume, turnover_rate? }
 *   (time 格式: 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:MM:SS')
 *
 * AS-03 schema:
 *   { timestamp (ms), open, high, low, close, volume }
 */
function transformKLine(raw: Record<string, unknown>): KLine {
  const timeStr = String(raw.time);
  // 統一時間格式: 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS' → timestamp (ms)
  const normalized = timeStr.includes('T')
    ? timeStr
    : timeStr.replace(' ', 'T');
  const timestamp = new Date(normalized).getTime();

  return {
    timestamp,
    open: Number(raw.open),
    high: Number(raw.high),
    low: Number(raw.low),
    close: Number(raw.close),
    volume: Number(raw.volume),
  };
}

/**
 * HTTP client → call backend /api/kline
 *
 * Backend 已經處理 cache-aside，所以 AS-03 唔需要做 caching。
 *
 * @returns KLine[] array (already merged DB + today's OpenD)
 */
export async function loadKLines(opts: LoadKLinesOptions): Promise<LoadKLinesResult> {
  const {
    symbol,
    period,
    count = 250,
    start,
    end,
    apiBaseUrl = '/api',
  } = opts;

  // Build query string
  const params = new URLSearchParams({
    code: symbol,
    period,
    count: String(count),
  });
  if (start) params.set('start', start);
  if (end) params.set('end', end);

  const url = `${apiBaseUrl}/kline?${params.toString()}`;

  // Fetch
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `[loadKLines] HTTP ${response.status}: ${response.statusText} for ${symbol} ${period}`,
    );
  }

  const data = await response.json() as {
    code: string;
    name: string;
    period: string;
    klines: Array<Record<string, unknown>>;
    cached?: boolean;
    fetch_count?: number;
    error?: string;
    mock?: boolean;
  };

  // Backend error
  if (data.error) {
    throw new Error(`[loadKLines] backend error for ${symbol} ${period}: ${data.error}`);
  }

  // Transform to KLine[]
  const klines = (data.klines ?? []).map(transformKLine);

  // Determine source
  const fetchCount = data.fetch_count ?? 0;
  const cached = data.cached ?? false;
  let source: LoadKLinesResult['source'] = 'unknown';
  if (cached && fetchCount === 0) {
    source = 'db-only';
  } else if (!cached && fetchCount > 0) {
    source = klines.length > 0 ? 'db+opend' : 'opend-only';
  } else if (fetchCount > 0) {
    source = 'db+opend';
  } else {
    source = 'db-only';
  }

  return {
    klines,
    cached,
    fetchCount,
    source,
  };
}

/**
 * Convenience wrapper: loadKLines for LTF (e.g. daily)
 */
export async function loadLTFKLines(symbol: string, ltf: Timeframe = '1d', count = 250) {
  return loadKLines({ symbol, period: ltf, count });
}

/**
 * Convenience wrapper: loadKLines for HTF (e.g. weekly)
 */
export async function loadHTFKLines(symbol: string, htf: Timeframe = '1w', count = 52) {
  return loadKLines({ symbol, period: htf, count });
}

export default loadKLines;
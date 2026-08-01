// types/algorithm.ts — AS-01 algorithm types
// 大少 2026-07-24 Tier 1.3: Frontend modular refactor

export interface Plate {
  plate_code: string;
  plate_name: string;
  market: string;
  stock_count: number;
  volume_30d: number;
  popularity_score: number;
  popularity_rank: number | null;
  popularity_updated_at: string | null;
  plate_type?: 'stock' | 'index' | 'etf' | 'reit' | 'bond' | 'warrant' | 'structured';
}

export interface Leader {
  code: string;
  name: string;
  price: number;
  change_pct: number;
  mcap: number;
  turnover: number;
  plate_code: string;
  plate_name: string;
  score: number;
  mcap_rank: number;
  volume_rank: number;
  reason: string;
}

// 大少 2026-07-26 #7566: SavedStock = full Leader snapshot (per saved_stocks DB column)
export type SavedStock = Leader;

export interface PopularityStatus {
  total: number;
  ranked: number;
  last_updated: string | null;
}

export interface PlatesApiResponse {
  plates: Plate[];
  count: number;
  total_active: number;
  include_non_stock: boolean;
  // 大少 2026-07-26 08:36: current custom order 係咪 = immutable default
  // 用嚟 disable ↺ 還原預設 button
  is_default: boolean;
}

export interface ExecuteApiResponse {
  leaders: Leader[];
  count: number;
  ranked_at: string;
}

export interface RunRequest {
  plates: string[];
  top_n: number;
}

export const MAX_PLATES = 30;
export const DEFAULT_TOP_N = 10;
export const DEFAULT_TOP_N_LIMIT = 50;

// ============================================================================
// AS-02 — 公司質素分析 (大少 2026-08-01 #9132)
// ============================================================================

export interface AS02Stock {
  code: string;
  name: string;
  classification: 'qualified' | 'disqualified';
  score: number;
  breakdown: {
    financial: number;
    business: number;
    management: number;
    industry: number;
    valuation: number;
    risk: number;
  };
  reasons: string[];
  analysis_text: string;
  data_sources: string[];
  // 大少 2026-08-01 #9446: 現價/市值/換手率/PE/PB (real OpenD snapshot from Phase F fix)
  price: number;
  change_pct: number;
  mcap: number;
  turnover: number;
  pe: number;
  pb: number;
}

export interface AS02ApiResponse {
  run_id: number | null;
  stocks: AS02Stock[];
  qualified_count: number;
  disqualified_count: number;
  ranked_at: string;
}

export interface AS02RunRequest {
  stocks: string[];  // e.g. ['HK.00981', 'HK.01347']
}

export const MAX_STOCKS = 10;
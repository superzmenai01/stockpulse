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
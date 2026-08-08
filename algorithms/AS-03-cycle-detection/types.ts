// types.ts — AS-03 股票周期性判定 (umbrella) · 共用類型定義
//
// 所有 module / orchestrator / alert 嘅介面合約集中呢度。
// 改呢度 = 改 contract，要小心。

/** 5 個 cycle state — D002 (2026-08-04) + 大少 2026-08-08 12:00 加 'TRAP'
 *  - UP / DOWN / SIDEWAYS: 6 個 modules 自己 return
 *  - TRANSITION: 6 個 modules 自己 return (e.g. H rule in ma-alignment)
 *  - TRAP: M7 Synthesizer / M8 Decision Engine 推導 (矛盾或假突破), 6 個 modules 唔會 return
 */
export type CycleState = 'UP' | 'DOWN' | 'SIDEWAYS' | 'TRANSITION' | 'TRAP';

/**
 * Raw MA alignment output — 3 states per docx v2.0 algorithm
 * D011 (2026-08-04): ma-alignment 用 3-state，TRANSITION 由 synthesizer 判
 */
export type RawCycle = 'uptrend' | 'downtrend' | 'sideways';

/**
 * Map RawCycle → CycleState for module output
 * TRANSITION 由 synthesizer 判 (D011 + D004 pending strategy)
 */
export function rawCycleToState(raw: RawCycle): CycleState {
  switch (raw) {
    case 'uptrend': return 'UP';
    case 'downtrend': return 'DOWN';
    case 'sideways': return 'SIDEWAYS';
  }
}

/**
 * Confirm/disconfirm signal — D012 (2026-08-04) Option B + D020 (2026-08-06)
 *
 * VolumePrice module emit 嘅 signal 而唔係完整 cycle verdict
 * Synthesizer 用呢個 signal 同 ma-alignment verdict 對齊
 */
export type SignalType = 'CONFIRM' | 'DISCONFIRM' | 'NEUTRAL';

/**
 * 5 個 peer module IDs (大少 #10809 — 加 slope-momentum,大少 2026-08-07 23:15 隱藏)
 * 大少 2026-08-08 12:00: 加 'volatility' (M6) — Sprint 1 6 個 modules 全部加入 CycleDetector
 */
export type CycleModuleId =
  | 'ma-alignment'
  | 'hl-structure'
  | 'trendline'
  | 'indicators'
  | 'volume'
  | 'volatility';
//   | 'slope-momentum'  // 大少 2026-08-07 23:15 暫時隱藏,Stage 1 done 最後先做返

/** 支援嘅 timeframe */
export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w' | '1M';

/** 基本 K 線資料 (OHLCV) */
export interface KLine {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** 一條 evidence — 用嚟解釋點解咁判 */
export interface Evidence {
  type: string;            // e.g. 'ma-gap' | 'swing-count' | 'macd-position'
  label: string;           // 中文 label (例如「MA20 gap」)
  value: number | string;
  threshold?: number | string;
  passed: boolean;
}

/** Module 執行 context */
export interface CycleContext {
  symbol: string;
  ltf: Timeframe;
  htf?: Timeframe;
  config?: unknown;        // CycleConfig (避免 circular import)
  /**
   * Enable flags (大少 #10809 — D019)
   * undefined / 唔包某 module = enabled by default
   * explicit false = skip 嗰個 module
   */
  enableFlags?: Partial<Record<CycleModuleId, boolean>>;
}

/**
 * 統一嘅 verdict 結構 — 每個 module / orchestrator 都 return 呢個 shape
 *
 * @property interpretation 中文人話解讀 (D002)
 * @property meta.signal Confirm/Disconfirm signal (大少 #10809 — D020)
 *                     VolumePrice module emit 嘅 signal type
 */
export interface CycleVerdict {
  moduleId: CycleModuleId | 'htf-multi-tf' | 'synthesized';
  timeframe: Timeframe;
  state: CycleState;
  confidence: number;             // 0-1
  interpretation: string;         // 中文解讀 (必填)
  evidence: Evidence[];
  warnings?: string[];
  meta?: Record<string, unknown> & {
    /**
     * D020 — VolumePrice module 嘅 confirm/disconfirm signal
     * Synthesizer 用呢個 signal 決定強化或削弱 ma-alignment 嘅 verdict
     */
    signal?: SignalType;
  };
  timestamp: number;
}

/**
 * 轉勢提醒 — D003 (2026-08-04)
 *
 * 只喺 state 變化時 emit，由 user 手動 confirm / reject
 * 唔做 auto-state-machine
 */
export interface RegimeChangeAlert {
  symbol: string;
  timeframe: Timeframe;
  fromState: CycleState;
  toState: CycleState;
  confidence: number;
  supportingModules: CycleModuleId[];
  chineseMessage: string;       // 人話提示
  timestamp: number;
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED';
}

/**
 * 最終 cycle report — D006 (2026-08-06 update)
 *
 * 包含已 enable 嘅 peer verdicts + 1 HTF verdict + 1 synthesized verdict
 * UI 顯示「已 enable 嘅 module + HTF + synthesized」(D006 update)
 * maAlignment 永遠 enabled (core mandatory)，其他跟 enableFlags 決定
 */
export interface CycleReport {
  symbol: string;
  ltf: Timeframe;
  htf?: {
    timeframe: Timeframe;
    verdict: CycleVerdict;
  };
  moduleVerdicts: CycleVerdict[];     // 已 enable 嘅 peer module verdicts (D006 update)
  alerts: RegimeChangeAlert[];        // 轉勢提醒 (empty if no change)
  synthesized?: CycleVerdict;         // 點 7 — expert-rules combine
  timestamp: number;
}

/** Module contract — 5 個 peer modules 都要 implement */
export interface CycleModule<I = KLine[]> {
  id: CycleModuleId | 'htf-multi-tf' | 'synthesized';
  version: string;
  detect(input: I, ctx: CycleContext): Promise<CycleVerdict>;
}

// =============================================================
// 大少 2026-08-08 12:00 — M7 Synthesizer 嘅 standard interface (Stage 1 收官準備)
// =============================================================
// 6 個 modules (M1-M6) 嘅 output 統一去呢個 shape, 方便 M7 / M8 讀
// 設計原則: 向後兼容, 每個 module 嘅 detail fields 仍然喺 module_specific 入面
// =============================================================

/** 6 維情緒雷達 (M7/M8 會用嚟畫 radar chart)
 *  每個 field 標準化去 [-1, +1]:
 *    rsi:                RSI(14) 標準化 ((rsi-50)/50)
 *    bollinger_pct_b:    Bollinger %B 標準化 (%B × 2 - 1)
 *    bias_ratio:         乖離率標準化 (現價 vs MA20, 限制 ±20%)
 *    vol_skew:           波動偏度 (20 日 historical vol skew)
 *    turnover:           換手率 (20 日平均 vs 250 日 baseline)
 *    momentum_accel:     動能加速度 (10 日 ROC 嘅 derivative)
 */
export interface Sentiment6D {
  rsi: number;              // -1 ~ +1
  bollinger_pct_b: number;  // -1 ~ +1
  bias_ratio: number;       // -1 ~ +1
  vol_skew: number;         // -1 ~ +1
  turnover: number;         // -1 ~ +1
  momentum_accel: number;   // -1 ~ +1
}

/** Standard verdict — 6 個 modules 共用嘅 output shape
 *  M7 Synthesizer 讀呢個 shape 計 SSI / grade / Kelly
 *  M8 Decision Engine 讀呢個 shape 推導 finalAction + trading card
 */
export interface ModuleStandardVerdict {
  // 5 個 core fields (所有 modules 必有)
  state: CycleState;             // UP / DOWN / SIDEWAYS / TRANSITION / TRAP
  confidence: number;            // 0-1, 信心分數
  base_weight: number;           // 0-1, 畀 SSI 加權用 (大少 2026-08-08 12:00: 5 個 modules 加埋 = 1.0, 跟 5 個 adaptive params 嘅 SSI 戰略層權重 auto-calibrate)
  expected_return: number;       // -0.1 ~ +0.1, 預期回報率 (例如 +0.05 = 5%)
  max_drawdown_estimate: number; // 0 ~ 0.3, 估計最大回撤 (例如 0.08 = 8%)

  // 6 維情緒雷達 (M7/M8 會畫成 radar chart)
  sentiment_6d: Sentiment6D;

  // Trace
  rules_fired: string[];         // 命中嘅 rule IDs (e.g. ["A", "H-G"])
  module_id: CycleModuleId;      // 邊個 module 出嘅 verdict (M7 用嚟辨識)
  module_specific: Record<string, unknown>;  // 保留 module 自己嘅 detail fields (向後兼容)
  timestamp: number;
}

/** 6 個 modules 嘅 base_weight 預設值
 *  大少 2026-08-08 12:00 確認嘅 defaults, 之後跟 5 個 adaptive params
 *  嘅 SSI 戰略層權重 auto-calibrate (runtime 60 日 R² 重新 normalize)
 *  6 個 modules 加埋 = 1.00 (M7 內部 normalize 用呢個做 base)
 *
 *  Rationale:
 *    ma-alignment 0.25 — 大多數 technical analysis 嘅基礎
 *    hl-structure 0.15  — 形態識別, 但慢
 *    trendline 0.20     — 支撐/壓力 + 突破檢測
 *    indicators 0.15    — 情緒指標, 補充
 *    volume 0.15        — 量能 confirm, 重要但 non-trending 時 noise 大
 *    volatility 0.10    — 波動率, 影響 Kelly 倉位多過方向
 */
export const BASE_WEIGHTS: Record<CycleModuleId, number> = {
  'ma-alignment': 0.25,
  'hl-structure': 0.15,
  'trendline': 0.20,
  'indicators': 0.15,
  'volume': 0.15,
  'volatility': 0.10,
  // 大少 2026-08-07 23:15 — slope-momentum 暫時隱藏, Stage 1 done 最後先做返
  // 'slope-momentum': 0.10,
};
// 註: 加埋 = 1.00, M7 內部直接用, 唔需要 normalize
// 註 2: 跟 5 個 adaptive params 嘅 SSI 戰略層權重 auto-calibrate 會重 scale, 保持總和 = 1.0

// =============================================================
// 大少 2026-08-08 12:30 — M7 Synthesizer output type (Sprint 1 sub-task 1.2)
// =============================================================

/** Kelly fraction — 跟 ATR% 自動切
 *  - half:   0.50 (波動低, ATR% < 5%)
 *  - quarter: 0.25 (波動中, 5% ≤ ATR% < 10%)
 *  - octo:   0.125 (波動高, ATR% ≥ 10%)
 */
export type KellyFraction = 'half' | 'quarter' | 'octo';

/** Grade 評級 — 8 個 level (A+~F)
 *  計分: 0-30=F, 30-40=D, 40-50=C, 50-60=C+, 60-70=B, 70-80=B+, 80-90=A, 90-100=A+
 */
export type Grade = 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F';

/** SSI 戰略強度指數 breakdown
 *  - consistency: 6 個 modules state 一致程度 (全部 UP = 1.0, 5個一致 1個唔同 = 0.8)
 *  - confidence_avg: 6 個 modules confidence 加權平均 (用 base_weight)
 *  - rules_coverage: 6 個 modules 嘅 rules_fired union 嘅覆蓋率 (max 20 unique rules, normalize 0-1)
 */
export interface SSIBreakdown {
  consistency: number;       // 0-1
  confidence_avg: number;    // 0-1
  rules_coverage: number;    // 0-1
}

/** TCM 戰術交叉驗證矩陣 — 1 對 pair 嘅結果
 *  - alignment: -1 to +1 (state 一致 = +1, 矛盾 = -1, 部分 = 0)
 *  - trap_penalty: 0-1 (虛漲 × 0.6, 假突破 × 0.3, 矛盾 = 0)
 */
export interface TCMPairResult {
  pair: [CycleModuleId, CycleModuleId];
  alignment: number;         // -1 to +1
  trap_penalty: number;      // 0-1
}

/** M7 Synthesizer 嘅 final verdict
 *  6 個 ModuleStandardVerdict → SynthesizerVerdict
 *  M8 Decision Engine 將來再吃 SynthesizerVerdict 推導 trading card
 */
export interface SynthesizerVerdict {
  // SSI 戰略強度指數
  ssi_score: number;         // 0-100
  ssi_breakdown: SSIBreakdown;

  // TCM 戰術交叉驗證矩陣 (3 對 pair)
  tcm_matrix: TCMPairResult[];

  // Alignment Score 戰略戰術匹配度
  alignment_score: number;   // 0-1

  // Grade 評級
  grade: Grade;
  grade_score: number;       // 0-100 (numeric)
  grade_reason: string;      // 中文 (點解畀呢個 grade)

  // Kelly 倉位
  kelly_fraction: KellyFraction;
  kelly_numeric: number;     // 0.5 / 0.25 / 0.125
  kelly_position: number;    // 0-1 (position size)

  // Meta
  module_verdicts: ModuleStandardVerdict[];  // 6 個 input (trace)
  timestamp: number;
}
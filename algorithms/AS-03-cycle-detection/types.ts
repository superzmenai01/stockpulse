// types.ts — AS-03 均線系統週期判斷法 · 共用類型定義
//
// 所有 module / orchestrator / alert 嘅介面合約集中呢度。
// 改呢度 = 改 contract，要小心。

/** 4 個 cycle state — D002 (2026-08-04) */
export type CycleState = 'UP' | 'DOWN' | 'SIDEWAYS' | 'TRANSITION';

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
 * 6 個 peer module IDs (大少 #10809 — 加 slope-momentum)
 */
export type CycleModuleId =
  | 'ma-alignment'
  | 'hl-structure'
  | 'trendline'
  | 'indicators'
  | 'volume'
  | 'slope-momentum';

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
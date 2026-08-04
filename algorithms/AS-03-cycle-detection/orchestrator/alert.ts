// orchestrator/alert.ts — AS-03 · 轉勢提醒 (regime change reminders)
//
// D003 (2026-08-04): 滯後機制只喺轉勢觸發，提醒方式表達，user 手動判
//
// 唔做 state machine auto-progress (TENTATIVE → CONFIRMED)
// 只 emit alert，等大少手動 confirm / reject

import type { CycleState, CycleModuleId, RegimeChangeAlert, Timeframe } from '../types';

export interface DetectAlertInput {
  symbol: string;
  timeframe: Timeframe;
  current: CycleState;
  previous: CycleState | null;       // null = 第一次分析，唔 emit
  confidence: number;
  supportingModules: string[];
}

const STATE_LABELS: Record<CycleState, string> = {
  UP: '上升',
  DOWN: '下跌',
  SIDEWAYS: '橫行',
  TRANSITION: '轉勢中',
};

export class RegimeChangeAlerter {
  /**
   * 檢測是否需要發出轉勢提醒
   *
   * @returns alert if state changed, null if unchanged or first-run
   */
  detect(input: DetectAlertInput): RegimeChangeAlert | null {
    if (input.previous === null) return null;
    if (input.current === input.previous) return null;

    const message = [
      `⚠️ [${input.symbol}] ${input.timeframe} 周期疑似由「${STATE_LABELS[input.previous]}」轉為「${STATE_LABELS[input.current]}」`,
      `(信心度 ${(input.confidence * 100).toFixed(0)}%)`,
      `基於 ${input.supportingModules.length} 個 module 嘅信號: ${input.supportingModules.join(', ')}`,
      `請人手判斷。`,
    ].join(' ');

    return {
      symbol: input.symbol,
      timeframe: input.timeframe,
      fromState: input.previous,
      toState: input.current,
      confidence: input.confidence,
      supportingModules: input.supportingModules as CycleModuleId[],
      chineseMessage: message,
      timestamp: Date.now(),
      status: 'PENDING',
    };
  }

  /** 靜態 helper — 攞 state 中文 label */
  static stateLabel(state: CycleState): string {
    return STATE_LABELS[state];
  }
}

export default RegimeChangeAlerter;
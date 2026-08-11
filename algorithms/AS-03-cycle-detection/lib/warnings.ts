// algorithms/AS-03-cycle-detection/lib/warnings.ts
// 大少 2026-08-11 — Module Warning System v1.0.0
// 對應 backend/services/warning_collector.py (Python mirror)

/**
 * 警告層級 (3 層)
 * - critical: 阻擋 verdict 計算, 結果唔可信
 * - warning: verdict 計算到但有偏差, 結果 partial
 * - info: 提示性, 唔影響結果
 */
export type WarningLevel = 'critical' | 'warning' | 'info';

/**
 * 15 個 warning codes (5 Critical / 7 Warning / 3 Info)
 */
export type WarningCode =
  // 🔴 Critical (5)
  | 'INSUFFICIENT_DATA'
  | 'VERDICT_MISSING'
  | 'NAN_RESULT'
  | 'CACHE_INVALID'
  | 'KLINE_MISSING'
  // 🟡 Warning (7)
  | 'MODULE_PARTIAL'
  | 'OUTLIER_VALUE'
  | 'LOW_SAMPLE_SIZE'
  | 'THRESHOLD_BREACH'
  | 'CONFLICT_STATE'
  | 'POST_FAILED'
  | 'FALLBACK_USED'
  // 🔵 Info (3)
  | 'CACHE_EXPIRING'
  | 'CONFIG_DEFAULTS'
  | 'DATA_AGE';

/**
 * ModuleWarning 統一結構
 */
export interface ModuleWarning {
  level: WarningLevel;
  module_id: string;
  code: WarningCode;
  message: string;
  debug: {
    issue: string;
    impact: string;
    fix: string;
    context: Record<string, unknown>;
  };
  timestamp: number;
}

/**
 * 警告 code → level 對照 (跟 Python WARNING_CODES mirror)
 */
export const WARNING_CODES_MAP: Record<WarningCode, WarningLevel> = {
  // 🔴 Critical
  INSUFFICIENT_DATA: 'critical',
  VERDICT_MISSING: 'critical',
  NAN_RESULT: 'critical',
  CACHE_INVALID: 'critical',
  KLINE_MISSING: 'critical',
  // 🟡 Warning
  MODULE_PARTIAL: 'warning',
  OUTLIER_VALUE: 'warning',
  LOW_SAMPLE_SIZE: 'warning',
  THRESHOLD_BREACH: 'warning',
  CONFLICT_STATE: 'warning',
  POST_FAILED: 'warning',
  FALLBACK_USED: 'warning',
  // 🔵 Info
  CACHE_EXPIRING: 'info',
  CONFIG_DEFAULTS: 'info',
  DATA_AGE: 'info',
};

/**
 * WarningCollector class — 收集 + dedupe + 排序
 *
 * Usage:
 *   const wc = new WarningCollector(parentWarnings);
 *   wc.push(makeWarning('critical', 'M1', 'INSUFFICIENT_DATA', '...'));
 *   verdict._warnings = wc.toList();
 */
export class WarningCollector {
  private warnings: ModuleWarning[] = [];

  constructor(parentWarnings?: ModuleWarning[]) {
    if (parentWarnings && Array.isArray(parentWarnings)) {
      for (const w of parentWarnings) {
        this.push(w);
      }
    }
  }

  /**
   * Push warning (auto-dedupe by level + module_id + code)
   */
  push(warning: ModuleWarning): void {
    for (const existing of this.warnings) {
      if (
        existing.level === warning.level &&
        existing.module_id === warning.module_id &&
        existing.code === warning.code
      ) {
        return; // 跳過重複
      }
    }
    this.warnings.push(warning);
  }

  pushMany(warnings: ModuleWarning[]): void {
    for (const w of warnings) {
      this.push(w);
    }
  }

  criticalCount(): number {
    return this.warnings.filter((w) => w.level === 'critical').length;
  }

  warningCount(): number {
    return this.warnings.filter((w) => w.level === 'warning').length;
  }

  infoCount(): number {
    return this.warnings.filter((w) => w.level === 'info').length;
  }

  totalCount(): number {
    return this.warnings.length;
  }

  hasCritical(): boolean {
    return this.criticalCount() > 0;
  }

  /**
   * 排序: Critical → Warning → Info, 然後 by module_id
   */
  toList(): ModuleWarning[] {
    const levelOrder: Record<WarningLevel, number> = {
      critical: 0,
      warning: 1,
      info: 2,
    };
    return [...this.warnings].sort((a, b) => {
      const levelDiff = levelOrder[a.level] - levelOrder[b.level];
      if (levelDiff !== 0) return levelDiff;
      return a.module_id.localeCompare(b.module_id);
    });
  }
}

/**
 * Helper: 建立 ModuleWarning (debug dict 自動 build)
 *
 * @example
 *   const w = makeWarning('critical', 'M1', 'INSUFFICIENT_DATA', '數據不足',
 *     { issue: 'kline count 30 < 100',
 *       impact: '5 個 module fallback',
 *       fix: '增加 count=200',
 *       context: { kline_count: 30, min_required: 100 } });
 */
export function makeWarning(
  level: WarningLevel,
  module_id: string,
  code: WarningCode,
  message: string,
  debug: { issue: string; impact: string; fix: string; context?: Record<string, unknown> } = {
    issue: '',
    impact: '',
    fix: '',
  }
): ModuleWarning {
  // Auto-fill level if mismatch
  if (WARNING_CODES_MAP[code] && WARNING_CODES_MAP[code] !== level) {
    // silently fix
    level = WARNING_CODES_MAP[code];
  }
  return {
    level,
    module_id,
    code,
    message,
    debug: {
      issue: debug.issue,
      impact: debug.impact,
      fix: debug.fix,
      context: debug.context || {},
    },
    timestamp: Date.now(),
  };
}

/**
 * Helper: 注入 warnings 入 verdict
 *
 * @example
 *   injectWarnings(myVerdict, [warning1, warning2]);
 */
export function injectWarnings(
  verdict: Record<string, unknown>,
  warnings: ModuleWarning[]
): void {
  if (!verdict || typeof verdict !== 'object') return;

  const existing = Array.isArray(verdict._warnings) ? (verdict._warnings as ModuleWarning[]) : [];
  const wc = new WarningCollector(existing);
  wc.pushMany(warnings);
  verdict._warnings = wc.toList();
}

/**
 * Format warning as Markdown 4 樣 (Mavis 立即 parse)
 *
 * @example
 *   const md = formatWarningForCopy(warning);
 *   // 🚨 **StockPulse 警告** [🔴 Critical]
 *   // - **Module**: M1
 *   // ...
 */
export function formatWarningForCopy(warning: ModuleWarning): string {
  const levelIcon = {
    critical: '🔴 Critical',
    warning: '🟡 Warning',
    info: '🔵 Info',
  }[warning.level] || '⚪ Unknown';

  const ctx = warning.debug.context || {};
  const contextLines = Object.keys(ctx).length
    ? Object.entries(ctx).map(([k, v]) => `  - ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    : ['  - (no context)'];

  return [
    `🚨 **StockPulse 警告** [${levelIcon}]`,
    `- **Module**: ${warning.module_id}`,
    `- **Code**: ${warning.code}`,
    `- **問題**: ${warning.debug.issue || warning.message}`,
    `- **影響**: ${warning.debug.impact || '?'}`,
    `- **修復建議**: ${warning.debug.fix || '?'}`,
    `- **Debug Context**:`,
    ...contextLines,
  ].join('\n');
}

/**
 * Format all warnings 為 Markdown 報告 (大少 Copy 1 個 button 就拎齊全部)
 */
export function formatAllWarningsForCopy(warnings: ModuleWarning[]): string {
  if (!warnings || warnings.length === 0) {
    return '(無警告)';
  }
  const header = `📋 **StockPulse 警告報告** (共 ${warnings.length} 個)\n\n`;
  const body = warnings.map((w, i) => {
    const title = `[${i + 1}] ${w.module_id} - ${w.code} (${w.level})`;
    return title + '\n' + formatWarningForCopy(w) + '\n';
  }).join('\n---\n\n');
  return header + body;
}

// algorithms/AS-03-cycle-detection/lib/warnings.mjs
// 大少 2026-08-11 — Module Warning System v1.0.0 (ES module mirror of warnings.ts)
// 對應 backend/services/warning_collector.py

/**
 * 警告層級 (3 層)
 */
export const WARNING_LEVELS = ['critical', 'warning', 'info'];

/**
 * 15 個 warning codes
 */
export const WARNING_CODES = {
  // 🔴 Critical (5)
  INSUFFICIENT_DATA: 'critical',
  VERDICT_MISSING: 'critical',
  NAN_RESULT: 'critical',
  CACHE_INVALID: 'critical',
  KLINE_MISSING: 'critical',
  // 🟡 Warning (7)
  MODULE_PARTIAL: 'warning',
  OUTLIER_VALUE: 'warning',
  LOW_SAMPLE_SIZE: 'warning',
  THRESHOLD_BREACH: 'warning',
  CONFLICT_STATE: 'warning',
  POST_FAILED: 'warning',
  FALLBACK_USED: 'warning',
  // 🔵 Info (3)
  CACHE_EXPIRING: 'info',
  CONFIG_DEFAULTS: 'info',
  DATA_AGE: 'info',
};

/**
 * WarningCollector class — 收集 + dedupe + 排序
 */
export class WarningCollector {
  constructor(parentWarnings) {
    this.warnings = [];
    if (parentWarnings && Array.isArray(parentWarnings)) {
      for (const w of parentWarnings) {
        this.push(w);
      }
    }
  }

  push(warning) {
    for (const existing of this.warnings) {
      if (
        existing.level === warning.level &&
        existing.module_id === warning.module_id &&
        existing.code === warning.code
      ) {
        return; // dedupe
      }
    }
    this.warnings.push(warning);
  }

  pushMany(warnings) {
    if (Array.isArray(warnings)) {
      for (const w of warnings) this.push(w);
    }
  }

  criticalCount() { return this.warnings.filter((w) => w.level === 'critical').length; }
  warningCount() { return this.warnings.filter((w) => w.level === 'warning').length; }
  infoCount() { return this.warnings.filter((w) => w.level === 'info').length; }
  totalCount() { return this.warnings.length; }
  hasCritical() { return this.criticalCount() > 0; }

  toList() {
    const levelOrder = { critical: 0, warning: 1, info: 2 };
    return [...this.warnings].sort((a, b) => {
      const levelDiff = levelOrder[a.level] - levelOrder[b.level];
      if (levelDiff !== 0) return levelDiff;
      return (a.module_id || '').localeCompare(b.module_id || '');
    });
  }
}

/**
 * Helper: 建立 ModuleWarning
 */
export function makeWarning(level, moduleId, code, message, debug = {}) {
  // Auto-fix level if code-level mismatch
  if (WARNING_CODES[code] && WARNING_CODES[code] !== level) {
    level = WARNING_CODES[code];
  }
  return {
    level,
    module_id: moduleId,
    code,
    message,
    debug: {
      issue: debug.issue || '',
      impact: debug.impact || '',
      fix: debug.fix || '',
      context: debug.context || {},
    },
    timestamp: Date.now(),
  };
}

/**
 * Helper: 注入 warnings 入 verdict
 */
export function injectWarnings(verdict, warnings) {
  if (!verdict || typeof verdict !== 'object') return;
  const existing = Array.isArray(verdict._warnings) ? verdict._warnings : [];
  const wc = new WarningCollector(existing);
  wc.pushMany(warnings);
  verdict._warnings = wc.toList();
}

/**
 * Format warning as Markdown 4 樣
 */
export function formatWarningForCopy(warning) {
  const levelIcon = {
    critical: '🔴 Critical',
    warning: '🟡 Warning',
    info: '🔵 Info',
  }[warning.level] || '⚪ Unknown';

  const ctx = warning.debug?.context || {};
  // 大少 2026-08-13 10:50 永久 rule: warning context 嘅 number value 統一 4 位小數 + 去 trailing zero
  // 凡人話: 大少 Copy warning 畀我 debug 嗰陣, 0.276 同 0.2760 同 0.27600 應該都係顯示做 0.276, 唔好睇到唔同 precision 嘅 number 混淆
  // - parseFloat(v.toFixed(4)) 自動去 trailing zero: 0.2760 → 0.276, 0.1234 → 0.1234, 5 → 5
  // - Object value (e.g. markowitz_corr {dailyWeekly: 0.85, ...}) 唔處理 (object 內部 number 由 caller 控制)
  const contextLines = Object.keys(ctx).length
    ? Object.entries(ctx).map(([k, v]) => {
        let displayValue;
        if (v === null || v === undefined) {
          displayValue = v;
        } else if (typeof v === 'object') {
          displayValue = JSON.stringify(v);
        } else if (typeof v === 'number') {
          displayValue = parseFloat(v.toFixed(4));
        } else {
          displayValue = v;
        }
        return `  - ${k}: ${displayValue}`;
      })
    : ['  - (no context)'];

  return [
    `🚨 **StockPulse 警告** [${levelIcon}]`,
    `- **Module**: ${warning.module_id}`,
    `- **Code**: ${warning.code}`,
    `- **問題**: ${warning.debug?.issue || warning.message}`,
    `- **影響**: ${warning.debug?.impact || '?'}`,
    `- **修復建議**: ${warning.debug?.fix || '?'}`,
    `- **Debug Context**:`,
    ...contextLines,
  ].join('\n');
}

/**
 * Format all warnings 為 Markdown 報告
 */
export function formatAllWarningsForCopy(warnings) {
  if (!warnings || warnings.length === 0) return '(無警告)';
  const header = `📋 **StockPulse 警告報告** (共 ${warnings.length} 個)\n\n`;
  const body = warnings.map((w, i) => {
    const title = `[${i + 1}] ${w.module_id} - ${w.code} (${w.level})`;
    return title + '\n' + formatWarningForCopy(w) + '\n';
  }).join('\n---\n\n');
  return header + body;
}

// =============================================================
// UI Render Helpers (HTML strings)
// =============================================================

const LEVEL_STYLES = {
  critical: { icon: '🔴', color: '#EE5151', bg: '#fff1f0', border: '#EE5151', label: 'Critical' },
  warning:  { icon: '🟡', color: '#FAAD14', bg: '#fffbe6', border: '#FAAD14', label: 'Warning' },
  info:     { icon: '🔵', color: '#1890ff', bg: '#e6f7ff', border: '#1890ff', label: 'Info' },
};

/**
 * Render 頂部 WarningBanner (testing page 結果區頂部, 1 個統一)
 *
 * @example
 *   const html = renderWarningBanner(verdict._warnings);
 *   // <div class="warning-banner warning-banner-critical"> ...
 */
export function renderWarningBanner(warnings) {
  if (!warnings || warnings.length === 0) {
    return ''; // 無 warning 唔 show banner (大少 11:57 rule 延伸: warning 有先 show)
  }

  const wc = new WarningCollector(warnings);
  const total = wc.totalCount();
  const critical = wc.criticalCount();
  const warningCnt = wc.warningCount();
  const info = wc.infoCount();

  // Banner 顏色跟最嚴重 level
  const topLevel = critical > 0 ? 'critical' : warningCnt > 0 ? 'warning' : 'info';
  const style = LEVEL_STYLES[topLevel];

  const summary = `⚠️ ${total} 個警告 (${critical} Critical / ${warningCnt} Warning / ${info} Info)`;

  const warningListHTML = wc.toList().map((w, i) => {
    const s = LEVEL_STYLES[w.level] || LEVEL_STYLES.info;
    return `
      <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 12px;margin:6px 0;background:${s.bg};border:1px solid ${s.border};border-radius:6px;font-size:13px;">
        <span style="font-size:16px;">${s.icon}</span>
        <div style="flex:1;">
          <div style="font-weight:700;color:${s.color};">[${i + 1}] ${w.module_id} - ${w.code} <span style="color:#999;font-weight:400;font-size:11px;">(${s.label})</span></div>
          <div style="color:#333;margin-top:2px;">${w.debug?.issue || w.message}</div>
          <div style="color:#666;margin-top:4px;font-size:12px;"><strong>影響</strong>: ${w.debug?.impact || '?'} · <strong>修復</strong>: ${w.debug?.fix || '?'}</div>
        </div>
        <button onclick="window.__copyWarning && window.__copyWarning(${i})" data-warning-idx="${i}" style="background:${s.color};color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;white-space:nowrap;">📋 Copy</button>
      </div>
    `;
  }).join('');

  // Copy all 嘅全局 button
  return `
    <div class="warning-banner warning-banner-${topLevel}" style="background:${style.bg};border:2px solid ${style.color};border-radius:8px;padding:12px 16px;margin:16px 0;font-family:system-ui,sans-serif;">
      <div style="display:flex;align-items:center;gap:12px;">
        <span style="font-size:20px;">${style.icon}</span>
        <strong style="color:${style.color};font-size:15px;">${summary}</strong>
        <button onclick="const d = this.parentElement.nextElementSibling; d.style.display = d.style.display === 'none' ? 'block' : 'none'; this.textContent = this.textContent === '展開 ▼' ? '收埋 ▲' : '展開 ▼';" style="background:${style.color};color:#fff;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;margin-left:auto;">展開 ▼</button>
        <button onclick="window.__copyAllWarnings && window.__copyAllWarnings()" style="background:#666;color:#fff;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;">📋 Copy 全部</button>
      </div>
      <div style="display:none;margin-top:12px;max-height:400px;overflow-y:auto;">
        ${warningListHTML}
      </div>
    </div>
  `;
}

/**
 * Render 個別 module verdict card 內部 WarningCard (細, inline)
 *
 * @example
 *   const html = renderWarningCards(verdict._warnings);
 *   // 顯示喺 verdict card 頂部 (如果有 warnings)
 */
export function renderWarningCards(warnings) {
  if (!warnings || warnings.length === 0) return '';

  // 只顯示 critical + warning (info 太嘈唔喺 card 內 show, info 只喺頂部 banner)
  const visibleWarnings = warnings.filter((w) => w.level !== 'info');
  if (visibleWarnings.length === 0) return '';

  return visibleWarnings.map((w, i) => {
    const s = LEVEL_STYLES[w.level] || LEVEL_STYLES.info;
    return `
      <div class="warning-card warning-card-${w.level}" style="display:flex;align-items:center;gap:8px;padding:8px 12px;margin:8px 0;background:${s.bg};border:1px solid ${s.border};border-radius:6px;font-size:13px;">
        <span>${s.icon}</span>
        <div style="flex:1;">
          <strong style="color:${s.color};">${w.code}</strong>: ${w.debug?.issue || w.message}
        </div>
        <button onclick="window.__copyWarning && window.__copyWarning('${w.module_id}_${w.code}')" style="background:${s.color};color:#fff;border:none;padding:3px 8px;border-radius:3px;cursor:pointer;font-size:11px;">📋 Copy</button>
      </div>
    `;
  }).join('');
}

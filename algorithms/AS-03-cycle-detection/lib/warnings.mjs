// algorithms/AS-03-cycle-detection/lib/warnings.mjs
// 大少 2026-08-11 — Module Warning System v1.0.0 (ES module mirror of warnings.ts)
// 大少 2026-08-14 11:33 v1.1.0 — Warning 分類 (system / stock_state) + 2 個 banner
// 對應 backend/services/warning_collector.py

/**
 * 警告層級 (3 層)
 */
export const WARNING_LEVELS = ['critical', 'warning', 'info'];

/**
 * 警告分類 (v1.1.0, 大少 2026-08-14 11:33)
 *
 * 凡人話: Warning 分 2 個 world
 * - 'system' = 系統/演算法/數據問題, verdict 可能唔可信, 唔好落單
 * - 'stock_state' = 股票狀態提醒, verdict 已經準確, 只係提示股票狀態
 *
 * 大少 11:33 trigger:「我想分開兩個警告, 一個是系統/演算法/數據等這些是會影響到正常結果的警告,
 *                      另一個是對股票狀態的提醒但前提下所有結果都是無問題和準確的」
 */
export const WARNING_CATEGORIES = {
  // 🔧 System / Algorithm / Data (12 個) — verdict 可能唔可信
  INSUFFICIENT_DATA: 'system',  // K 線數據唔夠
  VERDICT_MISSING: 'system',    // verdict 完全拎唔到 (crash)
  NAN_RESULT: 'system',         // 演算法出 NaN (數值錯)
  CACHE_INVALID: 'system',      // Cache 失效要 recalibrate
  KLINE_MISSING: 'system',      // K 線缺失 (gap)
  MODULE_PARTIAL: 'system',     // 部分 module verdict 缺失
  OUTLIER_VALUE: 'system',      // 極端 outlier
  LOW_SAMPLE_SIZE: 'system',    // 樣本少過 30
  POST_FAILED: 'system',        // Forward return POST 失敗
  FALLBACK_USED: 'system',      // 用咗 fallback (預設值)
  DATA_AGE: 'system',           // 數據太舊 (verdict 可能過時)
  CONFIG_DEFAULTS: 'system',    // 用咗默認 config (大少未 customize)
  // 📊 Stock State (3 個) — verdict 已經準確, 只係提示股票狀態
  THRESHOLD_BREACH: 'stock_state',  // 信心過低 / 觸發極端 threshold (e.g. M1 sideways 0.276)
  CONFLICT_STATE: 'stock_state',    // 2 個 module 判斷矛盾
  CACHE_EXPIRING: 'stock_state',    // 30 日 cache 快過期 (將來要重校)
};

/**
 * 2 個 category 嘅 display 設定
 */
export const CATEGORY_DISPLAY = {
  system: {
    icon: '🔧',
    label: '系統警告',
    desc: '系統/演算法/數據問題, verdict 可能唔可信, 唔好落單',
    impactTemplate: 'Verdict 唔可信, 唔好落單',
    fixTemplate: 'Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc',
  },
  stock_state: {
    icon: '📊',
    label: '股票狀態',
    desc: '股票狀態提醒, verdict 已經準確, 只係提示狀態',
    impactTemplate: 'Verdict 已經準確, 留意股票狀態',
    fixTemplate: '睇其他 module 確認 / 留意 M7 alignment',
  },
};

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

  // 大少 2026-08-14 11:33 v1.1.0: 加 category label (system / stock_state)
  const category = WARNING_CATEGORIES[warning.code] || 'system';
  const catDisplay = CATEGORY_DISPLAY[category];
  const categoryLabel = `${catDisplay.icon} **${catDisplay.label}** (${category === 'system' ? 'verdict 可能唔可信' : 'verdict 已經準確'})`;

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
    `- **Category**: ${categoryLabel}`,
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
 * Format all warnings 為 Markdown 報告 (v1.1.0, 大少 2026-08-14 11:33 — group by category)
 */
export function formatAllWarningsForCopy(warnings) {
  if (!warnings || warnings.length === 0) return '(無警告)';

  // v1.1.0: 按 category 分組 (system 先, stock_state 後)
  const systemWarnings = warnings.filter((w) => (WARNING_CATEGORIES[w.code] || 'system') === 'system');
  const stockStateWarnings = warnings.filter((w) => WARNING_CATEGORIES[w.code] === 'stock_state');

  const header = `📋 **StockPulse 警告報告** (共 ${warnings.length} 個 — 🔧 系統 ${systemWarnings.length} / 📊 股票狀態 ${stockStateWarnings.length})\n\n`;

  const sections = [];
  if (systemWarnings.length > 0) {
    sections.push(`## 🔧 系統警告 (${systemWarnings.length} 個) — verdict 可能唔可信\n`);
    sections.push(systemWarnings.map((w, i) => {
      const title = `[${i + 1}] ${w.module_id} - ${w.code} (${w.level})`;
      return title + '\n' + formatWarningForCopy(w) + '\n';
    }).join('\n---\n\n'));
  }
  if (stockStateWarnings.length > 0) {
    sections.push(`## 📊 股票狀態提醒 (${stockStateWarnings.length} 個) — verdict 已經準確\n`);
    sections.push(stockStateWarnings.map((w, i) => {
      const title = `[${i + 1}] ${w.module_id} - ${w.code} (${w.level})`;
      return title + '\n' + formatWarningForCopy(w) + '\n';
    }).join('\n---\n\n'));
  }

  return header + sections.join('\n');
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
 * @deprecated 2026-08-14 v1.1.0: 改用 renderWarningBanners() render 2 個獨立 banner (system + stock_state)
 * @example
 *   const html = renderWarningBanner(verdict._warnings);
 */
export function renderWarningBanner(warnings) {
  // v1.1.0 backward compat: 改用新嘅 renderWarningBanners()
  return renderWarningBanners(warnings);
}

/**
 * Render 2 個獨立 WarningBanner (v1.1.0, 大少 2026-08-14 11:33)
 *
 * 凡人話: 大少想分開 2 個 world
 * - 🔧 系統警告 banner (system category) — verdict 可能唔可信
 * - 📊 股票狀態 banner (stock_state category) — verdict 已經準確
 *
 * 2 個 banner 獨立 toggle / Copy, 大少一眼分到「呢個係 verdict 唔可信」定「呢個係股票狀態提示」
 *
 * @example
 *   const html = renderWarningBanners(verdict._warnings);
 *   // <div class="warning-banner warning-banner-system">...</div>
 *   // <div class="warning-banner warning-banner-stock_state">...</div>
 */
export function renderWarningBanners(warnings) {
  if (!warnings || warnings.length === 0) {
    return ''; // 無 warning 唔 show banner (大少 11:57 rule 延伸: warning 有先 show)
  }

  // 拎每個 warning 嘅 category
  const withCategory = warnings.map((w) => ({
    ...w,
    category: WARNING_CATEGORIES[w.code] || 'system',  // 默認 system (安全)
  }));

  // 分 2 組
  const systemWarnings = withCategory.filter((w) => w.category === 'system');
  const stockStateWarnings = withCategory.filter((w) => w.category === 'stock_state');

  // Render 2 個 banner (只有 warnings 嗰組先 render)
  const banners = [];
  if (systemWarnings.length > 0) {
    banners.push(_renderSingleCategoryBanner(systemWarnings, 'system'));
  }
  if (stockStateWarnings.length > 0) {
    banners.push(_renderSingleCategoryBanner(stockStateWarnings, 'stock_state'));
  }

  return banners.join('\n');
}

/**
 * Render 單一 category banner (helper, internal use only)
 *
 * 凡人話: 拎一組 warnings 同 category, render 1 個 banner
 * 大少 11:33 v1.1.0 永久 rule: 2 個 category 用 2 個獨立 banner render
 */
function _renderSingleCategoryBanner(warnings, category) {
  const wc = new WarningCollector(warnings);
  const total = wc.totalCount();
  const critical = wc.criticalCount();
  const warningCnt = wc.warningCount();
  const info = wc.infoCount();

  // Banner 顏色跟最嚴重 level
  const topLevel = critical > 0 ? 'critical' : warningCnt > 0 ? 'warning' : 'info';
  const style = LEVEL_STYLES[topLevel];
  const catDisplay = CATEGORY_DISPLAY[category];

  const summary = `${catDisplay.icon} ${total} 個${catDisplay.label} (${critical} Critical / ${warningCnt} Warning / ${info} Info) — ${catDisplay.desc}`;

  const warningListHTML = wc.toList().map((w, i) => {
    const s = LEVEL_STYLES[w.level] || LEVEL_STYLES.info;
    return `
      <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 12px;margin:6px 0;background:${s.bg};border:1px solid ${s.border};border-radius:6px;font-size:13px;">
        <span style="font-size:16px;">${s.icon}</span>
        <div style="flex:1;">
          <div style="font-weight:700;color:${s.color};">[${i + 1}] ${w.module_id} - ${w.code} <span style="color:#999;font-weight:400;font-size:11px;">(${s.label})</span> <span style="background:#f0f0f0;padding:1px 6px;border-radius:3px;font-size:10px;color:#666;">${catDisplay.icon} ${catDisplay.label}</span></div>
          <div style="color:#333;margin-top:2px;">${w.debug?.issue || w.message}</div>
          <div style="color:#666;margin-top:4px;font-size:12px;"><strong>影響</strong>: ${w.debug?.impact || '?'} · <strong>修復</strong>: ${w.debug?.fix || '?'}</div>
        </div>
        <button onclick="window.__copyWarning && window.__copyWarning(${i})" data-warning-idx="${i}" style="background:${s.color};color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;white-space:nowrap;">📋 Copy</button>
      </div>
    `;
  }).join('');

  // Copy all 嘅全局 button
  return `
    <div class="warning-banner warning-banner-${category} warning-banner-${topLevel}" style="background:${style.bg};border:2px solid ${style.color};border-radius:8px;padding:12px 16px;margin:16px 0;font-family:system-ui,sans-serif;">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <span style="font-size:20px;">${catDisplay.icon}</span>
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

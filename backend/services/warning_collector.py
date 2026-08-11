"""
backend/services/warning_collector.py — Module Warning System v1.0.0 (大少 2026-08-11)

統一收集 / dedupe / 排序 12 個 module (M1-M12) + zmen + adaptive params 嘅警告。
Warning inlined 入 verdict (唔入 DB table, 避免 storage overhead)。

凡人話設計:
- dataclass ModuleWarning (簡單 type, 易 extend)
- WarningCollector helper (push + dedupe + sort)
- 每個 module adapter analyze() return 之前 push 落 verdict._warnings
- Propagation: M1-M6 → M7 → M8 → M9 (push parent warnings 落 child verdict)
"""

import time
import logging
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Literal

logger = logging.getLogger(__name__)

WarningLevel = Literal['critical', 'warning', 'info']

# 15 個 warning codes (跟 frontend TS WarningCode mirror)
WARNING_CODES = {
    # 🔴 Critical (5)
    'INSUFFICIENT_DATA': 'critical',
    'VERDICT_MISSING': 'critical',
    'NAN_RESULT': 'critical',
    'CACHE_INVALID': 'critical',
    'KLINE_MISSING': 'critical',
    # 🟡 Warning (7)
    'MODULE_PARTIAL': 'warning',
    'OUTLIER_VALUE': 'warning',
    'LOW_SAMPLE_SIZE': 'warning',
    'THRESHOLD_BREACH': 'warning',
    'CONFLICT_STATE': 'warning',
    'POST_FAILED': 'warning',
    'FALLBACK_USED': 'warning',
    # 🔵 Info (3)
    'CACHE_EXPIRING': 'info',
    'CONFIG_DEFAULTS': 'info',
    'DATA_AGE': 'info',
}


@dataclass
class ModuleWarning:
    """ModuleWarning dataclass — 統一 warning 結構 (TypeScript ModuleWarning mirror)"""
    level: WarningLevel
    module_id: str
    code: str
    message: str
    debug: Dict[str, Any] = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)

    def __post_init__(self):
        # Auto-validate level (根據 code 自動 fill)
        if self.code in WARNING_CODES:
            expected_level = WARNING_CODES[self.code]
            if self.level != expected_level:
                logger.debug(
                    f"[WarningCollector] Level mismatch: {self.code} should be {expected_level}, got {self.level}"
                )

    def to_dict(self) -> dict:
        return {
            'level': self.level,
            'module_id': self.module_id,
            'code': self.code,
            'message': self.message,
            'debug': self.debug,
            'timestamp': int(self.timestamp * 1000),
        }


def make_warning(
    level: WarningLevel,
    module_id: str,
    code: str,
    message: str,
    issue: str = '',
    impact: str = '',
    fix: str = '',
    context: Optional[Dict[str, Any]] = None,
) -> ModuleWarning:
    """Helper: 建立 ModuleWarning (debug dict 自動 build)
    
    Usage:
        make_warning('critical', 'M1', 'INSUFFICIENT_DATA',
                     '數據不足',
                     issue=f'kline count {count} < {min_required} required',
                     impact='5 個 module verdict 全部 fallback',
                     fix='增加 dataWindowDays 設定 count=200',
                     context={'kline_count': count, 'min_required': min_required})
    """
    # Auto-fix level if code-level mismatch (per WARNING_CODES map)
    if code in WARNING_CODES and WARNING_CODES[code] != level:
        level = WARNING_CODES[code]
    
    debug = {
        'issue': issue,
        'impact': impact,
        'fix': fix,
        'context': context or {},
    }
    return ModuleWarning(
        level=level,
        module_id=module_id,
        code=code,
        message=message,
        debug=debug,
    )


class WarningCollector:
    """WarningCollector — 收集 + dedupe + 排序 警告
    
    Usage:
        wc = WarningCollector()
        wc.push(make_warning('critical', 'M1', 'INSUFFICIENT_DATA', '...'))
        wc.push(make_warning('warning', 'M8', 'OUTLIER_VALUE', '...'))
        verdict['_warnings'] = wc.to_list()
    """
    
    def __init__(self, parent_warnings: Optional[List[Dict[str, Any]]] = None):
        # Inherit parent warnings (M1-M6 → M7 → M8 → M9 propagation)
        self.warnings: List[ModuleWarning] = []
        if parent_warnings:
            for w in parent_warnings:
                if isinstance(w, dict):
                    self.warnings.append(ModuleWarning(**w))
                elif isinstance(w, ModuleWarning):
                    self.warnings.append(w)
    
    def push(self, warning):
        """Push warning (auto-dedupe by level + module_id + code)
        
        Accepts either ModuleWarning object or dict (auto-convert)
        """
        # Convert dict to ModuleWarning if needed
        if isinstance(warning, dict):
            try:
                warning = ModuleWarning(**warning)
            except Exception as e:
                logger.warning(f"[WarningCollector] push: dict conversion failed: {e}, dict: {warning}")
                return
        
        # Dedupe check
        for existing in self.warnings:
            if (existing.level == warning.level
                and existing.module_id == warning.module_id
                and existing.code == warning.code):
                logger.debug(
                    f"[WarningCollector] Dedupe: {warning.level}/{warning.module_id}/{warning.code}"
                )
                return  # 跳過重複
        self.warnings.append(warning)
    
    def push_dict(self, warning_dict: Dict[str, Any]):
        """Push warning from dict (e.g. 從 parent verdict 拎)"""
        if not isinstance(warning_dict, dict):
            return
        try:
            self.push(ModuleWarning(**warning_dict))
        except Exception as e:
            logger.warning(f"[WarningCollector] push_dict failed: {e}, dict: {warning_dict}")
    
    def critical_count(self) -> int:
        return sum(1 for w in self.warnings if w.level == 'critical')
    
    def warning_count(self) -> int:
        return sum(1 for w in self.warnings if w.level == 'warning')
    
    def info_count(self) -> int:
        return sum(1 for w in self.warnings if w.level == 'info')
    
    def total_count(self) -> int:
        return len(self.warnings)
    
    def has_critical(self) -> bool:
        return self.critical_count() > 0
    
    def to_list(self) -> List[Dict[str, Any]]:
        """Return sorted list of warning dicts (🔴 Critical → 🟡 Warning → 🔵 Info)"""
        level_order = {'critical': 0, 'warning': 1, 'info': 2}
        sorted_warnings = sorted(
            self.warnings,
            key=lambda w: (level_order.get(w.level, 99), w.module_id, w.code)
        )
        return [w.to_dict() for w in sorted_warnings]


# =============================================================
# Helper: Inject warnings into verdict (one-line call)
# =============================================================

def inject_warnings(verdict: Dict[str, Any], warnings: List[ModuleWarning]):
    """Inject warnings into verdict (auto-handle parent propagation)
    
    Usage:
        inject_warnings(my_verdict, [
            make_warning('critical', 'M1', 'INSUFFICIENT_DATA', '...'),
        ])
    """
    if not isinstance(verdict, dict):
        logger.warning(f"[WarningCollector] inject_warnings: verdict is not dict, got {type(verdict)}")
        return
    
    # Get existing warnings (e.g. parent propagation)
    existing = verdict.get('_warnings', [])
    if not isinstance(existing, list):
        existing = []
    
    # Create collector with parent
    wc = WarningCollector(parent_warnings=existing)
    for w in warnings:
        wc.push(w)
    
    verdict['_warnings'] = wc.to_list()


def format_all_warnings_for_copy(warnings: List[Dict[str, Any]]) -> str:
    """Format all warnings 為 Markdown 報告 (大少 Copy 1 個 button 就拎齊全部)
    
    Format:
        📋 **StockPulse 警告報告** (共 N 個)
        
        [1] M1 - INSUFFICIENT_DATA (critical)
        🚨 **StockPulse 警告** [🔴 Critical]
        ...
        
        ---
        
        [2] M5 - OUTLIER_VALUE (warning)
        ...
    """
    if not warnings or not isinstance(warnings, list):
        return '(無警告)'
    
    header = f"📋 **StockPulse 警告報告** (共 {len(warnings)} 個)\n\n"
    body_parts = []
    for i, w in enumerate(warnings):
        title = f"[{i + 1}] {w.get('module_id', '?')} - {w.get('code', '?')} ({w.get('level', '?')})"
        body_parts.append(title + "\n" + format_warning_for_copy(w) + "\n")
    body = "\n---\n\n".join(body_parts)
    return header + body


def format_warning_for_copy(warning_dict: Dict[str, Any]) -> str:
    """Format warning as Markdown 4 樣 (Mavis 立即 parse)
    
    Format:
        🚨 **StockPulse 警告** [🔴 Critical]
        - **Module**: M8 Decision Engine
        - **Code**: INSUFFICIENT_DATA
        - **問題**: kline count 30 < 100 required
        - **影響**: 5 個 module verdict 全部 fallback
        - **修復建議**: 增加 dataWindowDays 設定 count=200
        - **Debug Context**:
          - kline_count: 30
          - min_required: 100
    """
    level_icon = {
        'critical': '🔴 Critical',
        'warning': '🟡 Warning',
        'info': '🔵 Info',
    }.get(warning_dict.get('level', 'info'), '⚪ Unknown')
    
    debug = warning_dict.get('debug', {})
    context = debug.get('context', {})
    
    lines = [
        f"🚨 **StockPulse 警告** [{level_icon}]",
        f"- **Module**: {warning_dict.get('module_id', '?')}",
        f"- **Code**: {warning_dict.get('code', '?')}",
        f"- **問題**: {debug.get('issue', warning_dict.get('message', '?'))}",
        f"- **影響**: {debug.get('impact', '?')}",
        f"- **修復建議**: {debug.get('fix', '?')}",
        f"- **Debug Context**:",
    ]
    
    if context:
        for k, v in context.items():
            lines.append(f"  - {k}: {v}")
    else:
        lines.append("  - (no context)")
    
    return "\n".join(lines)

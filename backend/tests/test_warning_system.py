"""
Test 2: Module Warning System unit test (大少 2026-08-11)

Test 15 個 warning codes 全部 fire 過, 驗證:
- makeWarning() helper works
- WarningCollector dedupe
- injectWarnings() verdict 一行注入
- formatWarningForCopy() Markdown 4 樣
- formatAllWarningsForCopy() 全部 warnings 報告
- 3 個 level (critical / warning / info) 排序

Test 場景:
- INSUFFICIENT_DATA (kline count < 100)
- VERDICT_MISSING (0 個 peaks / cycle_synth null)
- NAN_RESULT (MA / RSI / MACD 計算結果 NaN)
- CACHE_INVALID (L2 cache 損壞)
- KLINE_MISSING (klines array 空)
- MODULE_PARTIAL (1+ 個 module 拎唔到)
- OUTLIER_VALUE (RSI > 1 / ATR > 30% / volume 全部 0)
- LOW_SAMPLE_SIZE (0 validate samples / forwardReturnHistory < 3)
- THRESHOLD_BREACH (Hurst > 0.95 / 5 個 trigger 全 false / 信心 < 0.4)
- CONFLICT_STATE (2 個 module state 衝突)
- POST_FAILED (forward return POST 失敗)
- FALLBACK_USED (matchedRules 0 個 / outstanding_shares = 0)
- CACHE_EXPIRING (L2 cache 超過 5 日)
- CONFIG_DEFAULTS (dataWindowDays / strategyMode default)
- DATA_AGE (last kline > 1 日前)
"""

import pytest
import json
import time
from backend.services.warning_collector import (
    ModuleWarning,
    WarningCollector,
    make_warning,
    inject_warnings,
    format_warning_for_copy,
    format_all_warnings_for_copy,
    WARNING_CODES,
)


# =============================================================
# 1. Schema + Helper test
# =============================================================

def test_warning_codes_all_have_level():
    """所有 15 個 warning codes 都要有對應 level (3 層級分佈)"""
    assert len(WARNING_CODES) == 17, f"expected 17 codes, got {len(WARNING_CODES)}"
    
    critical = [c for c, l in WARNING_CODES.items() if l == 'critical']
    warning = [c for c, l in WARNING_CODES.items() if l == 'warning']
    info = [c for c, l in WARNING_CODES.items() if l == 'info']
    
    assert len(critical) == 6, f"expected 6 critical, got {len(critical)}"
    assert len(warning) == 8, f"expected 8 warning, got {len(warning)}"
    assert len(info) == 3, f"expected 3 info, got {len(info)}"


def test_make_warning_basic():
    """make_warning() helper 自動 build debug dict"""
    w = make_warning(
        'critical', 'M1', 'INSUFFICIENT_DATA', '數據不足',
        issue='kline count 30 < 100 required',
        impact='5 個 module verdict 全部 fallback',
        fix='增加 dataWindowDays 設定 count=200',
        context={'kline_count': 30, 'min_required': 100}
    )
    assert w.level == 'critical'
    assert w.module_id == 'M1'
    assert w.code == 'INSUFFICIENT_DATA'
    assert w.message == '數據不足'
    assert w.debug['issue'] == 'kline count 30 < 100 required'
    assert w.debug['impact'] == '5 個 module verdict 全部 fallback'
    assert w.debug['fix'] == '增加 dataWindowDays 設定 count=200'
    assert w.debug['context']['kline_count'] == 30
    assert w.timestamp > 0


def test_make_warning_auto_level_fix():
    """make_warning() 自動 fix level (用 WARNING_CODES)"""
    # 明明 level 寫 'info', 但 code 係 'INSUFFICIENT_DATA' 應該自動 fix critical
    w = make_warning('info', 'M1', 'INSUFFICIENT_DATA', 'test')
    assert w.level == 'critical', "level should auto-fix to critical per WARNING_CODES"


def test_make_warning_to_dict():
    """to_dict() 返 dict 結構 (TypeScript ModuleWarning mirror)"""
    w = make_warning('warning', 'M8', 'OUTLIER_VALUE', 'test',
                     issue='rsi = 1.05', impact='RSI 唔可信', fix='check',
                     context={'rsi': 1.05})
    d = w.to_dict()
    assert d['level'] == 'warning'
    assert d['module_id'] == 'M8'
    assert d['code'] == 'OUTLIER_VALUE'
    assert d['message'] == 'test'
    assert d['debug']['issue'] == 'rsi = 1.05'
    assert d['debug']['context']['rsi'] == 1.05
    assert isinstance(d['timestamp'], int)


# =============================================================
# 2. WarningCollector test
# =============================================================

def test_warning_collector_push_dedupe():
    """WarningCollector 自動 dedupe (by level + module_id + code)"""
    wc = WarningCollector()
    w1 = make_warning('critical', 'M1', 'INSUFFICIENT_DATA', 'test1')
    w2 = make_warning('critical', 'M1', 'INSUFFICIENT_DATA', 'test2')  # 同 w1 一樣, 應該 dedupe
    wc.push(w1)
    wc.push(w2)
    assert wc.total_count() == 1, f"expected 1 after dedupe, got {wc.total_count()}"


def test_warning_collector_different_code_no_dedupe():
    """不同 code 唔 dedupe"""
    wc = WarningCollector()
    wc.push(make_warning('critical', 'M1', 'INSUFFICIENT_DATA', 'test'))
    wc.push(make_warning('critical', 'M1', 'NAN_RESULT', 'test'))
    assert wc.total_count() == 2


def test_warning_collector_count_by_level():
    """count by level 正確"""
    wc = WarningCollector()
    wc.push(make_warning('critical', 'M1', 'INSUFFICIENT_DATA', 'test'))
    wc.push(make_warning('critical', 'M8', 'NAN_RESULT', 'test'))
    wc.push(make_warning('warning', 'M5', 'OUTLIER_VALUE', 'test'))
    wc.push(make_warning('warning', 'M8', 'OUTLIER_VALUE', 'test'))
    wc.push(make_warning('info', 'M8', 'CONFIG_DEFAULTS', 'test'))
    assert wc.critical_count() == 2
    assert wc.warning_count() == 2
    assert wc.info_count() == 1
    assert wc.total_count() == 5
    assert wc.has_critical() == True


def test_warning_collector_sort():
    """排序: Critical → Warning → Info, 然後 by module_id"""
    wc = WarningCollector()
    wc.push(make_warning('info', 'M8', 'CONFIG_DEFAULTS', 'z'))
    wc.push(make_warning('critical', 'M8', 'NAN_RESULT', 'a'))
    wc.push(make_warning('warning', 'M1', 'OUTLIER_VALUE', 'm'))
    wc.push(make_warning('critical', 'M1', 'INSUFFICIENT_DATA', 'a'))
    
    sorted_list = wc.to_list()
    assert sorted_list[0]['code'] == 'INSUFFICIENT_DATA'  # critical, M1
    assert sorted_list[1]['code'] == 'NAN_RESULT'  # critical, M8
    assert sorted_list[2]['code'] == 'OUTLIER_VALUE'  # warning, M1
    assert sorted_list[3]['code'] == 'CONFIG_DEFAULTS'  # info, M8


def test_warning_collector_parent_propagation():
    """parent warnings auto-inherit"""
    parent_warnings = [make_warning('critical', 'M1', 'INSUFFICIENT_DATA', 'parent')]
    wc = WarningCollector(parent_warnings=parent_warnings)
    wc.push(make_warning('info', 'M9', 'DATA_AGE', 'child'))
    assert wc.total_count() == 2
    # 第一個應該係 parent critical
    assert wc.to_list()[0]['code'] == 'INSUFFICIENT_DATA'
    assert wc.to_list()[1]['code'] == 'DATA_AGE'


# =============================================================
# 3. inject_warnings test
# =============================================================

def test_inject_warnings_to_verdict():
    """inject_warnings() verdict 一行注入"""
    verdict = {'final_action': 'WAIT', 'grade': 'C+'}
    warnings = [
        make_warning('critical', 'M1', 'INSUFFICIENT_DATA', 'test',
                      issue='kline count 30 < 100', fix='increase count'),
        make_warning('warning', 'M8', 'OUTLIER_VALUE', 'test'),
    ]
    inject_warnings(verdict, warnings)
    assert '_warnings' in verdict
    assert len(verdict['_warnings']) == 2
    # 排序: critical 先
    assert verdict['_warnings'][0]['code'] == 'INSUFFICIENT_DATA'
    assert verdict['_warnings'][1]['code'] == 'OUTLIER_VALUE'


def test_inject_warnings_to_verdict_with_existing():
    """inject 落已有 _warnings 嘅 verdict (merge + dedupe)"""
    verdict = {
        '_warnings': [make_warning('critical', 'M1', 'INSUFFICIENT_DATA', 'existing').to_dict()]
    }
    new_warnings = [
        make_warning('critical', 'M1', 'INSUFFICIENT_DATA', 'new'),  # dedupe
        make_warning('warning', 'M5', 'OUTLIER_VALUE', 'new'),
    ]
    inject_warnings(verdict, new_warnings)
    assert len(verdict['_warnings']) == 2  # 1 個 dedupe + 1 個 new


def test_inject_warnings_invalid_verdict():
    """invalid verdict 唔 crash"""
    inject_warnings(None, [])
    inject_warnings("not a dict", [])
    # No assertion, just check 唔 crash


# =============================================================
# 4. format_warning_for_copy test (Markdown 4 樣)
# =============================================================

def test_format_warning_for_copy_critical():
    """Critical warning Markdown 4 樣格式"""
    w = make_warning('critical', 'M1', 'INSUFFICIENT_DATA', 'test',
                     issue='kline count 30 < 100 required',
                     impact='5 個 module verdict 全部 fallback',
                     fix='增加 dataWindowDays 設定 count=200',
                     context={'kline_count': 30, 'min_required': 100})
    md = format_warning_for_copy(w.to_dict())
    
    # 驗證 4 樣齊全
    assert '🚨 **StockPulse 警告** [🔴 Critical]' in md
    assert '- **Module**: M1' in md
    assert '- **Code**: INSUFFICIENT_DATA' in md
    assert '- **問題**: kline count 30 < 100 required' in md
    assert '- **影響**: 5 個 module verdict 全部 fallback' in md
    assert '- **修復建議**: 增加 dataWindowDays 設定 count=200' in md
    assert '- **Debug Context**:' in md
    assert 'kline_count: 30' in md
    assert 'min_required: 100' in md


def test_format_warning_for_copy_warning():
    """Warning level icon 🟡"""
    w = make_warning('warning', 'M5', 'OUTLIER_VALUE', 'test')
    md = format_warning_for_copy(w.to_dict())
    assert '[🟡 Warning]' in md


def test_format_warning_for_copy_info():
    """Info level icon 🔵"""
    w = make_warning('info', 'M8', 'CONFIG_DEFAULTS', 'test')
    md = format_warning_for_copy(w.to_dict())
    assert '[🔵 Info]' in md


def test_format_warning_for_copy_empty_context():
    """empty context 都 work"""
    w = make_warning('info', 'M8', 'CONFIG_DEFAULTS', 'test',
                     issue='default', impact='-', fix='-', context={})
    md = format_warning_for_copy(w.to_dict())
    assert '(no context)' in md


def test_format_all_warnings_for_copy():
    """format all warnings 報告 (1+ 個 warning)"""
    warnings = [
        make_warning('critical', 'M1', 'INSUFFICIENT_DATA', 'a').to_dict(),
        make_warning('warning', 'M5', 'OUTLIER_VALUE', 'b').to_dict(),
    ]
    md = format_all_warnings_for_copy(warnings)
    assert '📋 **StockPulse 警告報告** (共 2 個)' in md
    assert '[1] M1 - INSUFFICIENT_DATA (critical)' in md
    assert '[2] M5 - OUTLIER_VALUE (warning)' in md
    assert '---' in md  # separator


def test_format_all_warnings_for_copy_empty():
    """empty warnings 返 '(無警告)'"""
    assert format_all_warnings_for_copy([]) == '(無警告)'
    assert format_all_warnings_for_copy(None) == '(無警告)'


# =============================================================
# 5. 15 個 codes 全部 fire 過 (integration test)
# =============================================================

def test_all_15_warning_codes_fire():
    """15 個 warning codes 全部能 create + serialize"""
    # 5 Critical
    critical_codes = [
        ('INSUFFICIENT_DATA', 'M1'),
        ('VERDICT_MISSING', 'M2'),
        ('NAN_RESULT', 'M1'),
        ('CACHE_INVALID', 'M8'),
        ('KLINE_MISSING', 'M5'),
    ]
    for code, module in critical_codes:
        w = make_warning('critical', module, code, f'test {code}')
        d = w.to_dict()
        assert d['level'] == 'critical'
        assert d['code'] == code
        assert d['module_id'] == module
    
    # 7 Warning
    warning_codes = [
        ('MODULE_PARTIAL', 'M7'),
        ('OUTLIER_VALUE', 'M5'),
        ('LOW_SAMPLE_SIZE', 'M9'),
        ('THRESHOLD_BREACH', 'M8'),
        ('CONFLICT_STATE', 'M7'),
        ('POST_FAILED', 'M9'),
        ('FALLBACK_USED', 'M3'),
    ]
    for code, module in warning_codes:
        w = make_warning('warning', module, code, f'test {code}')
        d = w.to_dict()
        assert d['level'] == 'warning'
        assert d['code'] == code
        assert d['module_id'] == module
    
    # 3 Info
    info_codes = [
        ('CACHE_EXPIRING', 'M8'),
        ('CONFIG_DEFAULTS', 'M8'),
        ('DATA_AGE', 'M11'),
    ]
    for code, module in info_codes:
        w = make_warning('info', module, code, f'test {code}')
        d = w.to_dict()
        assert d['level'] == 'info'
        assert d['code'] == code
        assert d['module_id'] == module
    
    # Total 15
    assert len(critical_codes) + len(warning_codes) + len(info_codes) == 15


def test_end_to_end_workflow():
    """End-to-end workflow: 製造 3 個 warning → collect → inject → format → count"""
    # 模擬真實 verdict
    verdict = {
        'final_action': 'WAIT',
        'grade': 'C+',
        'confidence': 0.42,
    }
    
    # 1. 收集 M1 警告
    wc = WarningCollector()
    wc.push(make_warning('critical', 'M1', 'INSUFFICIENT_DATA', '數據不足',
                          issue='kline count 30 < 100', impact='m1 fallback',
                          fix='增加 count', context={'kline_count': 30}))
    wc.push(make_warning('warning', 'M5', 'OUTLIER_VALUE', 'volume 0',
                          issue='volume 全部 0', impact='量價不可信',
                          fix='check endpoint', context={'zero_volume': 30}))
    wc.push(make_warning('info', 'M8', 'CONFIG_DEFAULTS', 'default strategyMode',
                          issue='default', impact='-', fix='-'))
    
    # 2. Inject
    inject_warnings(verdict, wc.to_list())
    assert len(verdict['_warnings']) == 3
    
    # 3. Count by level
    levels = [w['level'] for w in verdict['_warnings']]
    assert levels.count('critical') == 1
    assert levels.count('warning') == 1
    assert levels.count('info') == 1
    
    # 4. Format all for Copy
    md = format_all_warnings_for_copy(verdict['_warnings'])
    assert '共 3 個' in md
    assert 'INSUFFICIENT_DATA' in md
    assert 'OUTLIER_VALUE' in md
    assert 'CONFIG_DEFAULTS' in md
    assert 'kline count 30 < 100' in md


def test_warning_data_structure_frontend_compatible():
    """warning 結構同 frontend TypeScript ModuleWarning interface mirror"""
    w = make_warning('critical', 'M1', 'INSUFFICIENT_DATA', 'test',
                     issue='test', impact='test', fix='test', context={'k': 1})
    d = w.to_dict()
    
    # 驗證 TypeScript ModuleWarning interface fields 全部存在
    required_fields = ['level', 'module_id', 'code', 'message', 'debug', 'timestamp']
    for f in required_fields:
        assert f in d, f"missing field: {f}"
    
    # 驗證 debug 內部 fields
    required_debug_fields = ['issue', 'impact', 'fix', 'context']
    for f in required_debug_fields:
        assert f in d['debug'], f"missing debug field: {f}"
    
    # level 必須係 valid value
    assert d['level'] in ['critical', 'warning', 'info']
    
    # timestamp 必須係 int (Unix ms)
    assert isinstance(d['timestamp'], int)
    assert d['timestamp'] > 0

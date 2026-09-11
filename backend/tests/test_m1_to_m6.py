"""
backend/tests/test_m1_to_m6.py — M1-M6 v2.x backend tests (大少 2026-09-12 §M1-M6 frontend 拎走 永久 rule)

大少 2026-09-12 07:22 trigger「你再去查下M1.-M6 有沒有同樣的問題,我要的是後台做計算,前台只是顯示」:
- 拎走 frontend algorithms/AS-03-cycle-detection/modules/{ma-alignment,hl-structure,trendline,
  indicators,volume,volatility}.ts (6 個 file, 全部 frontend KLine → verdict 計算動作)
- 拎走 frontend std-verdict.ts (348 行 frontend wrapper 純計算)
- 拎走 frontend __tests__/{ma-alignment,hl-structure,trendline,indicators,volume,volatility,smoke,
  standard-verdict}.test.mjs (8 個 frontend test file)
- 拎走 index.ts 嘅 CycleDetector class + 6 個 module import/re-export + 4 個 orchestrator import
  + 4 個 orchestrator re-export + AnalyzeOptions + enableFlagsToRecord + DEFAULT_ENABLE_FLAGS import
- 加 backend/tests/test_m1_to_m6.py 對齊 backend M1-M6 計算 (沿用 backend §Algorithm Backend-only
  + 模組化永久 rule)
- 對齊 §數據處理 Server 內部做 (大少 2026-08-23) + §Algorithm Backend-only + 模組化 (大少 2026-08-22)
- 對齊 §M7 v2.0.4 Phase 12 frontend 拎走 永久 rule (大少 2026-09-12 07:07)

6 tests (每個 algo 1 個):
- test_m1_ma_alignment_meta_shape
- test_m2_hl_structure_meta_shape
- test_m3_trendline_meta_shape
- test_m4_indicators_meta_shape
- test_m5_volume_price_meta_shape
- test_m6_volatility_meta_shape

每個 test mock 100 條 uptrend K 線 (backend Pydantic KLine shape, time 唔係 date) +
algo.run(klines, options={"symbol": "TEST"}) + 拎 verdict + assert meta shape 對齊
backend curl emit (M1 33 keys / M2 35 / M3 35 / M4 31 / M5 37 / M6 41, 全部 source of truth)

注:
- Verdict 係 dataclass (algorithms/base.py line 39-65), 唔係 dict, 用 attribute access (v.meta,
  v.warnings)
- v.state 頂層 + v.confidence 頂層暫時只 M6 v2.0.3 fix 咗 (§M6 Spec Sync #54 大少 2026-09-10 09:50),
  M1-M5 emit 落 v.meta.state + v.meta.confidence (runner service algorithm_runner.py line 313-314
  統一 inject state: upstream_meta.get("state"))
- pytest 拎 state 用 v.meta.get("state") 對齊 test_synthesizer.py line 60 pattern (M7 自己 set
  落 v.state 頂層所以 v.state 拎到, M1-M6 暫時拎 v.meta.state)
- K 線 field 用 backend Pydantic KLine shape: time / open / high / low / close / volume /
  turnover_rate (algorithms/base.py line 19-36)
- Algo 拎 options.get("symbol", ...) 取 caller 嘅 stock code, runner 統一 inject (對齊
  §verdict.meta.symbol 永久 rule, 大少 2026-09-07 08:30)
- TODO follow-up: M1-M5 backend algorithm 跟 M6 pattern 補返 set v.state + v.confidence 落頂層
  (對齊 §M6 Spec Sync #54 v2.0.3 永久 rule)
"""

import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from algorithms import get_algorithm
from algorithms.base import Verdict


# ============================================================
# Mock K 線 helper — 100 條 uptrend K 線 (backend Pydantic KLine shape)
# ============================================================
def make_uptrend_klines(n: int = 100, start_price: float = 100.0) -> list:
    """Mock 100 條 uptrend K 線 (對齊 backend Pydantic KLine shape)

    凡人話: 每日 +0.5, volume 隨機, 用嚟試 algo 拎 verdict shape
    對齊 smoke.mjs 嘅 `Array.from({ length: 100 }, (_, i) => ({...}))` pattern
    """
    import datetime
    base_date = datetime.date(2024, 1, 1)
    klines = []
    for i in range(n):
        date = (base_date + datetime.timedelta(days=i)).isoformat()
        close = start_price + i * 0.5
        klines.append({
            "time": date,
            "open": close - 0.5,
            "high": close + 1.0,
            "low": close - 1.0,
            "close": close,
            "volume": 1000000 + i * 1000,
            "turnover_rate": 0.5,
        })
    return klines


# ============================================================
# Test 1: M1 ma_alignment backend emit verdict shape
# ============================================================
def test_m1_ma_alignment_meta_shape():
    """§M1-M6 frontend 拎走 永久 rule: M1 backend emit 完整 meta (33 keys)"""
    algo = get_algorithm("ma_alignment")
    assert algo is not None
    assert algo.name == "ma_alignment"
    klines = make_uptrend_klines(100)
    v = algo.run(klines, {"symbol": "TEST"})
    assert isinstance(v, Verdict), f"M1 verdict 應該係 Verdict dataclass, 唔係 {type(v)}"
    assert v.ok is True, f"M1 verdict.ok 應該 True, 但係 {v.ok}, error={v.error}"
    # M1 暫時 emit meta.state (冇 set v.state 頂層, 對齊 §M6 Spec Sync #54 v2.0.3 永久 rule
    # 嘅 follow-up, 將來 M1 v2.6.0 補返 set 落頂層)
    meta_state = v.meta.get("state")
    assert meta_state in ("UP", "DOWN", "SIDEWAYS", "TRANSITION", "TRAP", "no_signal", None), \
        f"M1 meta.state 應該係 valid state, 但係 {meta_state}"
    meta_conf = v.meta.get("confidence")
    assert meta_conf is not None, "M1 meta.confidence 唔應該 None"
    assert 0.0 <= meta_conf <= 1.0, f"M1 meta.confidence 應該 [0,1], 但係 {meta_conf}"
    # meta 必須有 symbol field (對齊 §verdict.meta.symbol 永久 rule)
    assert v.meta.get("symbol") == "TEST", \
        f"M1 meta.symbol 應該 TEST, 但係 {v.meta.get('symbol')} (對齊 §verdict.meta.symbol 永久 rule)"
    # M1 spec 33 keys 拎 5 個關鍵: cycle / cycleLabel / maRanks / maSlopes / maValues
    for key in ("cycle", "cycleLabel", "maRanks", "maSlopes", "maValues", "volumeSignal"):
        assert key in v.meta, f"M1 meta 應該有 '{key}' field, 但係 missing. keys={sorted(v.meta.keys())}"


# ============================================================
# Test 2: M2 hl_structure backend emit verdict shape
# ============================================================
def test_m2_hl_structure_meta_shape():
    """§M1-M6 frontend 拎走 永久 rule: M2 backend emit 完整 meta (35 keys)"""
    algo = get_algorithm("hl_structure")
    assert algo is not None
    assert algo.name == "hl_structure"
    klines = make_uptrend_klines(100)
    v = algo.run(klines, {"symbol": "TEST"})
    assert isinstance(v, Verdict)
    assert v.ok is True, f"M2 verdict.ok 應該 True, 但係 {v.ok}, error={v.error}"
    meta_state = v.meta.get("state")
    assert meta_state in ("UP", "DOWN", "SIDEWAYS", "TRANSITION", "TRAP", None), \
        f"M2 meta.state 應該係 valid state, 但係 {meta_state}"
    meta_conf = v.meta.get("confidence")
    assert meta_conf is not None
    assert 0.0 <= meta_conf <= 1.0
    assert v.meta.get("symbol") == "TEST"
    # M2 spec 35 keys 拎 5 個關鍵: cycle / cycle_label / peaks / troughs / structure_score
    for key in ("cycle", "cycle_label", "peaks", "troughs", "structure_score"):
        assert key in v.meta, f"M2 meta 應該有 '{key}' field, 但係 missing. keys={sorted(v.meta.keys())}"
    # M2 self-check warning emit (對齊 §M2 self-check warning 永久 rule, 大少 2026-09-06 15:08)
    assert isinstance(v.warnings, list), "M2 verdict.warnings 應該係 list"


# ============================================================
# Test 3: M3 trendline backend emit verdict shape
# ============================================================
def test_m3_trendline_meta_shape():
    """§M1-M6 frontend 拎走 永久 rule: M3 backend emit 完整 meta (35 keys)"""
    algo = get_algorithm("trendline")
    assert algo is not None
    assert algo.name == "trendline"
    klines = make_uptrend_klines(100)
    v = algo.run(klines, {"symbol": "TEST"})
    assert isinstance(v, Verdict)
    assert v.ok is True, f"M3 verdict.ok 應該 True, 但係 {v.ok}, error={v.error}"
    meta_state = v.meta.get("state")
    assert meta_state in ("UP", "DOWN", "SIDEWAYS", "TRANSITION", "TRAP", None), \
        f"M3 meta.state 應該係 valid state, 但係 {meta_state}"
    meta_conf = v.meta.get("confidence")
    assert meta_conf is not None
    assert 0.0 <= meta_conf <= 1.0
    assert v.meta.get("symbol") == "TEST"
    # M3 spec 35 keys 拎 5 個關鍵: cycle_label / supportLine / resistanceLine / hurst / adx
    for key in ("cycle_label", "supportLine", "resistanceLine", "hurst", "adx"):
        assert key in v.meta, f"M3 meta 應該有 '{key}' field, 但係 missing. keys={sorted(v.meta.keys())}"
    # M3 Hurst+ADX gate emit (對齊 §M3 Hurst+ADX gate 永久 rule Spec Sync #51)
    assert isinstance(v.warnings, list)


# ============================================================
# Test 4: M4 indicators backend emit verdict shape
# ============================================================
def test_m4_indicators_meta_shape():
    """§M1-M6 frontend 拎走 永久 rule: M4 backend emit 完整 meta (31 keys)"""
    algo = get_algorithm("indicators")
    assert algo is not None
    assert algo.name == "indicators"
    klines = make_uptrend_klines(100)
    v = algo.run(klines, {"symbol": "TEST"})
    assert isinstance(v, Verdict)
    assert v.ok is True, f"M4 verdict.ok 應該 True, 但係 {v.ok}, error={v.error}"
    meta_state = v.meta.get("state")
    assert meta_state in ("UP", "DOWN", "SIDEWAYS", "TRANSITION", "TRAP", "no_signal", None), \
        f"M4 meta.state 應該係 valid state, 但係 {meta_state}"
    meta_conf = v.meta.get("confidence")
    assert meta_conf is not None
    assert 0.0 <= meta_conf <= 1.0
    assert v.meta.get("symbol") == "TEST"
    # M4 spec 31 keys 拎 5 個關鍵: signal / signalAction / regimeGate / hurst / adx
    for key in ("signal", "signalAction", "regimeGate", "hurst", "adx"):
        assert key in v.meta, f"M4 meta 應該有 '{key}' field, 但係 missing. keys={sorted(v.meta.keys())}"
    # M4 self-check warning emit (對齊 §M4 Spec Sync #52)
    assert isinstance(v.warnings, list)


# ============================================================
# Test 5: M5 volume_price backend emit verdict shape
# ============================================================
def test_m5_volume_price_meta_shape():
    """§M1-M6 frontend 拎走 永久 rule: M5 backend emit 完整 meta (37 keys)"""
    algo = get_algorithm("volume_price")
    assert algo is not None
    assert algo.name == "volume_price"
    klines = make_uptrend_klines(150)  # M5 need ≥ 103 bars, 用 150 確保夠
    v = algo.run(klines, {"symbol": "TEST"})
    assert isinstance(v, Verdict)
    assert v.ok is True, f"M5 verdict.ok 應該 True, 但係 {v.ok}, error={v.error}"
    meta_state = v.meta.get("state")
    assert meta_state in ("UP", "DOWN", "SIDEWAYS", "TRANSITION", "TRAP", None), \
        f"M5 meta.state 應該係 valid state, 但係 {meta_state}"
    meta_conf = v.meta.get("confidence")
    assert meta_conf is not None
    assert 0.0 <= meta_conf <= 1.0
    assert v.meta.get("symbol") == "TEST"
    # M5 spec 37 keys 拎 5 個關鍵: cycle / signal / regimeGate / vwapAnalysis / volumePriceCorrelation
    for key in ("cycle", "signal", "regimeGate", "vwapAnalysis", "volumePriceCorrelation"):
        assert key in v.meta, f"M5 meta 應該有 '{key}' field, 但係 missing. keys={sorted(v.meta.keys())}"
    # M5 self-check warning emit
    assert isinstance(v.warnings, list)


# ============================================================
# Test 6: M6 volatility backend emit verdict shape
# ============================================================
def test_m6_volatility_meta_shape():
    """§M1-M6 frontend 拎走 永久 rule: M6 backend emit 完整 meta (41 keys)"""
    algo = get_algorithm("volatility")
    assert algo is not None
    assert algo.name == "volatility"
    klines = make_uptrend_klines(100)
    v = algo.run(klines, {"symbol": "TEST"})
    assert isinstance(v, Verdict)
    assert v.ok is True, f"M6 verdict.ok 應該 True, 但係 {v.ok}, error={v.error}"
    # M6 v2.0.3 已經 set 落 v.state + v.confidence 頂層 (對齊 §M6 Spec Sync #54 v2.0.3 永久 rule)
    assert v.state in ("UP", "DOWN", "SIDEWAYS", "TRANSITION", "TRAP", None), \
        f"M6 v.state 應該係 valid state, 但係 {v.state}"
    assert v.confidence is not None, "M6 v.confidence 唔應該 None"
    assert 0.0 <= v.confidence <= 1.0, f"M6 v.confidence 應該 [0,1], 但係 {v.confidence}"
    assert v.meta.get("symbol") == "TEST"
    # M6 spec 41 keys 拎 5 個關鍵: cycle / setupType / regimeGate / vcpStructure / momentumHistogram
    for key in ("cycle", "setupType", "regimeGate", "vcpStructure", "momentumHistogram"):
        assert key in v.meta, f"M6 meta 應該有 '{key}' field, 但係 missing. keys={sorted(v.meta.keys())}"
    # M6 self-check warning emit (對齊 §M6 v2.0.0 永久 rule, 大少 2026-09-10 09:50 Spec Sync #54)
    assert isinstance(v.warnings, list)

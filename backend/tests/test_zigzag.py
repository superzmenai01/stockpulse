"""
backend/tests/test_zigzag.py — ZigZag algorithm pytest (大少 2026-08-20 Phase 1)

凡人話: 測試 ZigZag algorithm 啱唔啱
- 基本 test: 拎到 Peak/Trough 對
- 默認 threshold: 唔 specify 都 work
- 太少 K 線: 拎 error
- Sample size warning: < 30 條 trigger warning
- Meta field 拎到: lastSwingHigh / lastSwingLow 畀 M1 用
- Verdict shape 跟 framework contract 對齊

對應 backup: backups/zigzag-frontend-2026-08-20/RESTORE.md
Spec: docs/research/AS-03-cycle-detection/M1-V22-RESEARCH.md
Algorithm: 從 ref code port 嘅 ZigZag 拎 output, verify 跟 framework contract
"""
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import pytest

from backend.algorithms.zigzag.algorithm import ZigZagAlgorithm
from backend.algorithms.zigzag.config import DEFAULT_THRESHOLD
from backend.algorithms import get_algorithm, list_algorithms


def make_klines(highs, lows):
    """凡人話: 由 highs/lows array 整 fake K 線 dict (跟 kline API shape)"""
    n = len(highs)
    return [
        {
            "time": f"2024-{((i // 30) + 1):02d}-{(i % 30) + 1:02d}",
            "open": (highs[i] + lows[i]) / 2,
            "high": float(highs[i]),
            "low": float(lows[i]),
            "close": (highs[i] + lows[i]) / 2,
            "volume": 1000,
        }
        for i in range(n)
    ]


# ============================================================================
# Test: Algorithm registry
# ============================================================================

def test_zigzag_registered_in_registry():
    """凡人話: ZigZag 應該 register 咗落 framework registry"""
    assert "zigzag" in list_algorithms()
    algo = get_algorithm("zigzag")
    assert algo.name == "zigzag"
    assert algo.version == "1.0.0"


# ============================================================================
# Test: Basic functionality
# ============================================================================

def test_zigzag_basic_up_down():
    """凡人話: 上下波動 K 線拎到 Peak / Trough"""
    # 模擬: 上漲 → 回調 → 再上漲 → 大跌
    highs = [
        100, 102, 105, 103, 107, 110, 108, 112, 115, 113,
        110, 108, 105, 107, 104, 102, 100, 98, 95, 93,
        96, 99, 102, 105, 108, 110, 112, 115, 118, 120
    ]
    lows = [h - 1.5 for h in highs]
    klines = make_klines(highs, lows)

    algo = ZigZagAlgorithm()
    verdict = algo.run(klines, {"threshold": 5})

    # 凡人話: 應該 success
    assert verdict.ok, f"verdict.ok = False, error = {verdict.error}"
    assert len(verdict.points) > 0, "應該拎到至少 1 個轉折點"

    # 凡人話: 應該拎到 high 同 low 兩種類型
    types = [p["type"] for p in verdict.points]
    assert "high" in types, f"應該有 high point, got types={types}"
    assert "low" in types, f"應該有 low point, got types={types}"

    # 凡人話: 拎 point 應該有 date / value / type / index 4 個 field
    first_point = verdict.points[0]
    assert "date" in first_point
    assert "value" in first_point
    assert "type" in first_point
    assert "index" in first_point
    assert first_point["type"] in ("high", "low")


def test_zigzag_default_threshold():
    """凡人話: 唔 specify threshold 都用默認 5%"""
    highs = [100, 110, 105, 95, 100, 115, 110]
    lows = [h - 1.5 for h in highs]
    klines = make_klines(highs, lows)

    algo = ZigZagAlgorithm()
    verdict = algo.run(klines, {})  # 唔 specify threshold

    assert verdict.ok
    assert verdict.meta["threshold"] == DEFAULT_THRESHOLD
    assert verdict.meta["threshold"] == 5.0
    assert verdict.meta["threshold_proportion"] == 0.05


# ============================================================================
# Test: Edge cases
# ============================================================================

def test_zigzag_too_short():
    """凡人話: K 線太少 (< 2 條) 拎 error"""
    algo = ZigZagAlgorithm()
    verdict = algo.run(
        [{"time": "2024-01-01", "high": 100, "low": 99, "open": 100, "close": 100, "volume": 1000}],
        {"threshold": 5}
    )

    assert not verdict.ok
    assert verdict.error is not None
    assert "數據太少" in verdict.error or "at least" in verdict.error.lower()


def test_zigzag_empty_klines():
    """凡人話: K 線空 array 拎 error"""
    algo = ZigZagAlgorithm()
    verdict = algo.run([], {"threshold": 5})

    assert not verdict.ok
    assert verdict.error is not None


def test_zigzag_missing_high_low_field():
    """凡人話: K 線冇 high/low field 拎 error (唔 crash)"""
    algo = ZigZagAlgorithm()
    bad_klines = [
        {"time": "2024-01-01", "open": 100, "close": 100, "volume": 1000},  # 冇 high/low
        {"time": "2024-01-02", "open": 105, "close": 105, "volume": 1000},
    ]
    verdict = algo.run(bad_klines, {"threshold": 5})

    assert not verdict.ok
    assert "high" in verdict.error.lower() or "low" in verdict.error.lower()


# ============================================================================
# Test: Warnings (Module Warning System v1.1.0)
# ============================================================================

def test_zigzag_low_sample_warning():
    """凡人話: K 線 < 30 條 trigger LOW_SAMPLE_SIZE warning"""
    # 22 條 K 線 (細過 30)
    highs = [100, 105, 110, 102, 95, 100, 98, 103, 107, 100,
             95, 98, 102, 99, 100, 103, 105, 101, 99, 102, 98, 100]
    lows = [h - 1.5 for h in highs]
    klines = make_klines(highs, lows)

    algo = ZigZagAlgorithm()
    verdict = algo.run(klines, {"threshold": 5})

    assert verdict.ok
    assert len(verdict.warnings) > 0, "應該有 warning"
    codes = [w["code"] for w in verdict.warnings]
    assert "LOW_SAMPLE_SIZE" in codes

    # 凡人話: warning 跟 CATEGORY_DISPLAY template
    warning = next(w for w in verdict.warnings if w["code"] == "LOW_SAMPLE_SIZE")
    assert warning["level"] == "warning"
    assert warning["category"] == "system"  # 大少 2026-08-14 Spec Sync #18
    assert warning["module_id"] == "zigzag"
    assert "impact" in warning
    assert "fix" in warning
    assert "唔好落單" in warning["impact"]  # system category template


def test_zigzag_no_warning_for_sufficient_data():
    """凡人話: K 線 ≥ 30 條唔 trigger LOW_SAMPLE_SIZE warning"""
    highs = []
    lows = []
    for i in range(60):
        # 製造有上落波動嘅 60 條 K 線
        base = 100 + (i % 10) * 2
        highs.append(base + 3)
        lows.append(base - 3)
    klines = make_klines(highs, lows)

    algo = ZigZagAlgorithm()
    verdict = algo.run(klines, {"threshold": 5})

    assert verdict.ok
    codes = [w["code"] for w in verdict.warnings]
    assert "LOW_SAMPLE_SIZE" not in codes, "60 條 K 線唔應該 trigger warning"


# ============================================================================
# Test: Meta field (M1 拎緊呢啲 field)
# ============================================================================

def test_zigzag_meta_has_last_swing():
    """凡人話: meta 拎到 lastSwingHigh / lastSwingLow (M1 v2.0 拎緊呢 2 個 field)"""
    highs = [100, 110, 105, 95, 100, 115, 110, 105, 95, 90]
    lows = [h - 1.5 for h in highs]
    klines = make_klines(highs, lows)

    algo = ZigZagAlgorithm()
    verdict = algo.run(klines, {"threshold": 5})

    assert verdict.ok
    # 對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs line 7343-7347
    assert "lastSwingHigh" in verdict.meta
    assert "lastSwingLow" in verdict.meta
    assert "klines_count" in verdict.meta
    assert "points_count" in verdict.meta
    assert verdict.meta["klines_count"] == 10


def test_zigzag_empty_points_meta():
    """凡人話: 完全冇 point 嗰陣 lastSwingHigh / lastSwingLow 都係 None"""
    # 製造一條直線 (冇波動) — 唔會 trigger 反轉
    highs = [100] * 10
    lows = [99] * 10
    klines = make_klines(highs, lows)

    algo = ZigZagAlgorithm()
    verdict = algo.run(klines, {"threshold": 5})

    assert verdict.ok
    # 冇反轉 → 0 個 points
    assert verdict.meta["points_count"] == 0
    assert verdict.meta["lastSwingHigh"] is None
    assert verdict.meta["lastSwingLow"] is None


# ============================================================================
# Test: Verdict shape (framework contract)
# ============================================================================

def test_verdict_shape_contract():
    """凡人話: Verdict 一定跟 framework contract (ok/points/meta/warnings/error)"""
    highs = [100, 105, 110, 100, 95]
    lows = [98, 103, 108, 98, 93]
    klines = make_klines(highs, lows)

    algo = ZigZagAlgorithm()
    verdict = algo.run(klines, {"threshold": 5})

    # 必須有呢啲 field
    assert hasattr(verdict, "ok")
    assert hasattr(verdict, "points")
    assert hasattr(verdict, "meta")
    assert hasattr(verdict, "warnings")
    assert hasattr(verdict, "error")

    # type check
    assert isinstance(verdict.ok, bool)
    assert isinstance(verdict.points, list)
    assert isinstance(verdict.meta, dict)
    assert isinstance(verdict.warnings, list)
    assert verdict.error is None or isinstance(verdict.error, str)

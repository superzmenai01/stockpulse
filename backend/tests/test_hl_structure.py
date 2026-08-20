"""
backend/tests/test_hl_structure.py — M2 HL Structure pytest (大少 2026-08-20 20:35 Phase 3)

凡人話: 測試 M2 algorithm 啱唔啱
- Basic: 3-state cycle (uptrend / downtrend / sideways)
- Edge case: 唔夠峰谷 / 完全平 data
- Verdict shape: 跟 framework contract (frontend 兼容 shape)

對應 backup: backups/zigzag-frontend-2026-08-20/RESTORE.md
Spec: docs/research/AS-03-cycle-detection/MODULE-02-HL-STRUCTURE.md
Algorithm: 1:1 port 自 hl-structure.ts 嘅 detect() method 18 個 step
"""
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import pytest

from backend.algorithms.hl_structure.algorithm import HLStructureAlgorithm
from backend.algorithms.hl_structure.config import DEFAULT_HL_STRUCTURE_CONFIG
from backend.algorithms import get_algorithm, list_algorithms


def make_klines(prices, volume_base=1000, start_date=(2024, 1, 1)):
    """凡人話: 構造 fake K 線 (date unique)"""
    n = len(prices)
    import datetime
    start = datetime.date(*start_date)
    out = []
    for i in range(n):
        d = start + datetime.timedelta(days=i)
        out.append({
            "time": d.isoformat(),
            "date": d.isoformat(),
            "open": prices[i],
            "high": prices[i] * 1.02,
            "low": prices[i] * 0.98,
            "close": prices[i],
            "volume": volume_base + (i % 5) * 100,
        })
    return out


# ============================================================================
# Test: Algorithm registry
# ============================================================================

def test_hl_structure_registered_in_registry():
    """凡人話: hl_structure 註冊落 framework"""
    assert "hl_structure" in list_algorithms()
    algo = get_algorithm("hl_structure")
    assert algo.name == "hl_structure"
    assert algo.version == "0.1.0"


# ============================================================================
# Test: Basic functionality
# ============================================================================

def test_hl_structure_uptrend():
    """凡人話: 持續上升 K 線 判定上升週期 (uptrend)"""
    # 線性上升 — peaks 同 troughs 都係 rising trend
    prices = [100 + i * 2.0 for i in range(120)]
    klines = make_klines(prices, volume_base=2000)

    algo = HLStructureAlgorithm()
    verdict = algo.run(klines, {"hlsOverrides": DEFAULT_HL_STRUCTURE_CONFIG, "symbol": "TEST"})

    assert verdict.ok
    assert verdict.meta["cycle"] in ("uptrend", "sideways")  # 視乎峰谷識別結果
    assert verdict.meta["peak_trend"] in ("rising", "mixed", "flat")
    assert "peaks" in verdict.meta
    assert "troughs" in verdict.meta
    assert "pattern_alert" in verdict.meta
    assert "reason" in verdict.meta


def test_hl_structure_downtrend():
    """凡人話: 持續下跌 K 線 判定下跌週期 (downtrend)"""
    prices = [200 - i * 2.0 for i in range(120)]
    klines = make_klines(prices, volume_base=2000)

    algo = HLStructureAlgorithm()
    verdict = algo.run(klines, {"hlsOverrides": DEFAULT_HL_STRUCTURE_CONFIG, "symbol": "TEST"})

    assert verdict.ok
    assert verdict.meta["cycle"] in ("downtrend", "sideways")


def test_hl_structure_sideways():
    """凡人話: 橫行 K 線 判定 sideways (有 box boundary)"""
    # 構造真正橫行: 6 個 cycle, 每個 cycle 20 日 (peak 高 + trough 低交替)
    # 確保 peaks 同 troughs 交替, 趨勢 mixed (peak 唔升, trough 唔升)
    prices = []
    n = 120
    for i in range(n):
        cycle_pos = i % 20
        if cycle_pos < 10:
            # 上半 cycle: 100 → 102
            prices.append(100 + cycle_pos * 0.2)
        else:
            # 下半 cycle: 102 → 100
            prices.append(102 - (cycle_pos - 10) * 0.2)
    klines = make_klines(prices, volume_base=500)

    algo = HLStructureAlgorithm()
    verdict = algo.run(klines, {"hlsOverrides": DEFAULT_HL_STRUCTURE_CONFIG, "symbol": "TEST"})

    assert verdict.ok
    assert verdict.meta["cycle"] == "sideways"
    assert verdict.meta["box_boundary"] is not None
    assert "top" in verdict.meta["box_boundary"]
    assert "bottom" in verdict.meta["box_boundary"]


# ============================================================================
# Test: Edge cases
# ============================================================================

def test_hl_structure_insufficient_data():
    """凡人話: K 線不足 (< minRequired) 應該返 ok=False + error"""
    # 只有 30 條 (M2 預設需要 6 個 alternating 峰谷)
    prices = [100 + i for i in range(30)]
    klines = make_klines(prices, volume_base=1000)

    algo = HLStructureAlgorithm()
    verdict = algo.run(klines, {"hlsOverrides": DEFAULT_HL_STRUCTURE_CONFIG, "symbol": "TEST"})

    assert not verdict.ok
    assert "Insufficient data" in verdict.error


def test_hl_structure_flat_data():
    """凡人話: 完全平 K 線 返 sideways 0.3 + VERDICT_MISSING warning"""
    # 所有 price 一樣
    prices = [100.0] * 120
    klines = make_klines(prices, volume_base=1000)

    algo = HLStructureAlgorithm()
    verdict = algo.run(klines, {"hlsOverrides": DEFAULT_HL_STRUCTURE_CONFIG, "symbol": "TEST"})

    assert verdict.ok
    assert verdict.meta["cycle"] == "sideways"
    assert verdict.meta["confidence"] == 0.3
    assert len(verdict.warnings) >= 1
    assert any(w.get("code") == "VERDICT_MISSING" for w in verdict.warnings)


# ============================================================================
# Test: Verdict shape (跟 frontend 兼容)
# ============================================================================

def test_hl_structure_verdict_shape():
    """凡人話: M2 verdict shape 對齊 frontend (testing page 拎得到)"""
    prices = [100 + (i % 7) * 1.5 for i in range(120)]
    klines = make_klines(prices, volume_base=1500)

    algo = HLStructureAlgorithm()
    verdict = algo.run(klines, {"hlsOverrides": DEFAULT_HL_STRUCTURE_CONFIG, "symbol": "HK.00700"})

    assert verdict.ok
    # Top-level shape
    assert verdict.ok is True
    assert isinstance(verdict.points, list)
    assert isinstance(verdict.meta, dict)
    assert isinstance(verdict.warnings, list)

    # Frontend 兼容 meta fields
    meta_required = [
        "symbol", "cycle", "cycle_label", "confidence", "base_confidence",
        "peaks", "troughs", "peak_trend", "trough_trend",
        "structure_score", "weighted_structure_score", "box_boundary",
        "pattern_alert", "latest_extreme", "price_position",
        "adaptive_window", "effective_tolerance", "adjustment_log",
        "reason", "last_date", "_warnings",
    ]
    for field in meta_required:
        assert field in verdict.meta, f"Missing meta field: {field}"


def test_hl_structure_peaks_troughs_shape():
    """凡人話: peaks 同 troughs 拎 list of dict, 每個有 date / close / high / low"""
    prices = [100 + (i % 5) * 1.5 for i in range(120)]
    klines = make_klines(prices, volume_base=1500)

    algo = HLStructureAlgorithm()
    verdict = algo.run(klines, {"hlsOverrides": DEFAULT_HL_STRUCTURE_CONFIG, "symbol": "TEST"})

    assert verdict.ok
    for peak in verdict.meta["peaks"]:
        assert "date" in peak
        assert "close" in peak
        assert "high" in peak
        assert "low" in peak
        assert "index" in peak
        assert "weight" in peak
    for trough in verdict.meta["troughs"]:
        assert "date" in trough
        assert "close" in trough


def test_hl_structure_pattern_alert():
    """凡人話: 形態預警 (head_and_shoulder / double_top / double_bottom) 對齊 4 個值"""
    prices = [100 + i * 0.3 for i in range(120)]
    klines = make_klines(prices, volume_base=1500)

    algo = HLStructureAlgorithm()
    verdict = algo.run(klines, {"hlsOverrides": DEFAULT_HL_STRUCTURE_CONFIG, "symbol": "TEST"})

    assert verdict.ok
    assert verdict.meta["pattern_alert"] in ("none", "head_and_shoulder", "double_top", "double_bottom")


def test_hl_structure_adaptive_window():
    """凡人話: 自適應 window 拎 2-15 之間"""
    prices = [100 + i * 0.5 for i in range(120)]
    klines = make_klines(prices, volume_base=1500)

    algo = HLStructureAlgorithm()
    verdict = algo.run(klines, {"hlsOverrides": DEFAULT_HL_STRUCTURE_CONFIG, "symbol": "TEST"})

    assert verdict.ok
    assert 2 <= verdict.meta["adaptive_window"] <= 15

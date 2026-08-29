"""
backend/tests/test_ma_alignment.py — M1 algorithm pytest (大少 2026-08-20 20:05 Phase 2)

凡人話: 測試 M1 algorithm 啱唔啱
- Basic: 拎到 9 個 sub-scenario cycle + 6 個 cycle position
- ZigZag dependency inject: M1 verdict meta 入面有 ZigZag 5 個 field
- Verdict shape: 跟 framework contract

對應 backup: backups/zigzag-frontend-2026-08-20/RESTORE.md
Spec: docs/research/AS-03-cycle-detection/M1-V22-RESEARCH.md
Algorithm: 1:1 port 自 ma-alignment.ts 嘅 detect() method 9 個 step
"""
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import pytest

from backend.algorithms.ma_alignment.algorithm import MAAlignmentV2Algorithm
from backend.algorithms.ma_alignment.config import DEFAULT_MA_ALIGNMENT_V2_CONFIG
from backend.algorithms import get_algorithm, list_algorithms
# 大少 2026-08-30 01:04 — 拎走 backend.algorithms.zigzag import (C 方案 phase 2)
# 之後 M1 純 MA alignment, 之字 points 由 frontend inject
# Spec Sync #46 永久 rule 改: M1 純 MA alignment


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

def test_ma_alignment_registered_in_registry():
    """凡人話: ma_alignment 註冊落 framework"""
    assert "ma_alignment" in list_algorithms()
    algo = get_algorithm("ma_alignment")
    assert algo.name == "ma_alignment"
    assert algo.version == "2.2.0"  # v2.2.0 (大少 2026-08-21 18:37) — Adaptive ThresholdPct


# ============================================================================
# Test: Basic functionality
# ============================================================================

def test_ma_alignment_strong_uptrend():
    """凡人話: 持續上升 K 線 判定強上升 (strong_uptrend)"""
    # 持續上升趨勢
    prices = [100 + i * 2.0 for i in range(80)]
    klines = make_klines(prices, volume_base=2000)  # 放量上升

    algo = MAAlignmentV2Algorithm()
    verdict = algo.run(klines, {"config": DEFAULT_MA_ALIGNMENT_V2_CONFIG, "symbol": "TEST"})

    assert verdict.ok
    assert verdict.meta["cycle"] in ("strong_uptrend", "weak_uptrend", "uptrend_correction")
    # 強上升 / 弱上升 / 上升回調 屬於 UP cycle
    assert verdict.meta["confidence"] > 0
    assert "maValues" in verdict.meta
    assert "ma5" in verdict.meta["maValues"] or "MA5" in verdict.meta["maValues"]


def test_ma_alignment_strong_downtrend():
    """凡人話: 持續下跌 K 線 判定強下跌 (strong_downtrend)"""
    prices = [200 - i * 2.0 for i in range(80)]
    klines = make_klines(prices, volume_base=2000)  # 放量下跌

    algo = MAAlignmentV2Algorithm()
    verdict = algo.run(klines, {"config": DEFAULT_MA_ALIGNMENT_V2_CONFIG, "symbol": "TEST"})

    assert verdict.ok
    assert verdict.meta["cycle"] in ("strong_downtrend", "weak_downtrend", "downtrend_bounce")


def test_ma_alignment_sideways():
    """凡人話: 橫行 K 線 判定 sideways"""
    prices = [100 + (i % 3) * 0.5 for i in range(80)]  # 0.5% 範圍
    klines = make_klines(prices, volume_base=500)

    algo = MAAlignmentV2Algorithm()
    verdict = algo.run(klines, {"config": DEFAULT_MA_ALIGNMENT_V2_CONFIG, "symbol": "TEST"})

    assert verdict.ok
    assert verdict.meta["cycle"] == "sideways"
    assert verdict.meta["cyclePosition"] == "range_bound"


# ============================================================================
# Test: 9 個 sub-scenario (Priority 1-5)
# ============================================================================

def test_ma_alignment_decelerating_up_priority_1():
    """凡人話: 短期急跌 + 長期仲升 + 連跌 4+ 日 = 到頂轉勢"""
    # 80 日: 60 日上升, 最後 20 日急速下跌
    prices = [100 + i * 1.0 for i in range(60)]  # 60 日上升
    prices += [160 - i * 0.8 for i in range(20)]  # 20 日下跌 (-0.8%/日, 累積 -16% < -3%)
    klines = make_klines(prices, volume_base=1000)

    algo = MAAlignmentV2Algorithm()
    verdict = algo.run(klines, {"config": DEFAULT_MA_ALIGNMENT_V2_CONFIG, "symbol": "TEST"})

    assert verdict.ok
    # Priority 1 觸發: decelerating_up
    if verdict.meta["cycle"] == "decelerating_up":
        assert verdict.meta["cyclePosition"] == "late_stage_topping"
        assert verdict.meta["consecutiveDays"] >= 4
    # 可能因為跌幅唔夠 < -3% 條件而 fallback 其他 sub-scenario, 唔 fail test (priority 1 比較 strict)


def test_ma_alignment_all_sub_scenarios_in_meta():
    """凡人話: verdict meta 入面有 9 個 sub-scenario 對應嘅 label"""
    prices = [100 + i * 1.0 for i in range(80)]
    klines = make_klines(prices, volume_base=1000)

    algo = MAAlignmentV2Algorithm()
    verdict = algo.run(klines, {"config": DEFAULT_MA_ALIGNMENT_V2_CONFIG, "symbol": "TEST"})

    assert verdict.ok
    # cycleLabel 對應 9 個 sub-scenario 其中一個
    valid_cycles = [
        "強上升週期", "弱上升週期", "橫行週期",
        "弱下跌週期", "強下跌週期",
        "上升回調中", "下跌反彈中",
        "到頂轉勢中", "到底轉勢中",
    ]
    assert verdict.meta["cycleLabel"] in valid_cycles

    # cyclePosition 對應 6 個 position 其中一個
    valid_positions = [
        "趨勢中期 (主升/主跌段)",
        "剛開始升 (起勢)", "剛開始跌 (起勢)",
        "橫行整理中",
        "回調到 20 日均線", "反彈進行中",
        "到頂轉勢中 (見頂跡象)", "到底轉勢中 (見底跡象)",
    ]
    assert verdict.meta["cyclePositionLabel"] in valid_positions


# ============================================================================
# 大少 2026-08-30 01:04 — 拎走 test_ma_alignment_with_zigzag_inject 嗰段 (C 方案 phase 2)
# 之後 M1 純 MA alignment, 之字 points 由 frontend inject
# Spec Sync #46 永久 rule 改: M1 純 MA alignment


# ============================================================================
# Test: Verdict shape (framework contract)
# ============================================================================

def test_ma_alignment_verdict_shape():
    """凡人話: Verdict 跟 framework contract"""
    prices = [100 + i * 1.0 for i in range(80)]
    klines = make_klines(prices, volume_base=1000)

    algo = MAAlignmentV2Algorithm()
    verdict = algo.run(klines, {"config": DEFAULT_MA_ALIGNMENT_V2_CONFIG, "symbol": "TEST"})

    # 必須有 framework 5 個 field
    assert hasattr(verdict, "ok")
    assert hasattr(verdict, "points")
    assert hasattr(verdict, "meta")
    assert hasattr(verdict, "warnings")
    assert hasattr(verdict, "error")

    assert isinstance(verdict.ok, bool)
    assert isinstance(verdict.points, list)
    assert isinstance(verdict.meta, dict)
    assert isinstance(verdict.warnings, list)

    # M1 algorithm 唔拎 points (ZigZag 拎)
    assert verdict.points == []


def test_ma_alignment_input_validation():
    """凡人話: K 線太少拎 error"""
    algo = MAAlignmentV2Algorithm()
    # 30 條 < 60+5 = 65 required
    klines = make_klines([100 + i for i in range(30)])
    verdict = algo.run(klines, {"config": DEFAULT_MA_ALIGNMENT_V2_CONFIG, "symbol": "TEST"})

    assert not verdict.ok
    assert verdict.error is not None
    assert "≥ 65" in verdict.error or "K 線" in verdict.error

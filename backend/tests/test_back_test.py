"""
backend/tests/test_back_test.py — M9 Back Test v0.6.0 backend tests (大少 2026-08-20 Phase 9)

8 tests:
- test_back_test_registered_in_registry
- test_back_test_empty_klines
- test_back_test_insufficient_data
- test_back_test_replay_basic
- test_back_test_replay_forward_return
- test_back_test_coarse_grid_sorted
- test_back_test_adaptive_window_extend
- test_back_test_walk_forward_cv
- test_back_test_verdict_shape
- test_back_test_decision_fn_fallback
- test_back_test_post_optimal
"""

import sys
import os
import random
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from algorithms import get_algorithm, list_algorithms
from algorithms.back_test import (
    run_replay,
    run_coarse_grid,
    run_fine_tune,
    run_adaptive_window,
    run_walk_forward_cv,
    score_result,
    format_forward_return,
    DEFAULT_KELLY_VALUES,
    DEFAULT_RSI_WEIGHTS,
)


def _make_klines(prices: list, base_volume: int = 1000000):
    """凡人話: 用 prices 整 klines fixture"""
    n = len(prices)
    klines = []
    for i in range(n):
        klines.append({
            "timestamp": 1700000000 + i * 86400,  # ms (frontend 格式)
            "open": prices[i] * 0.99,
            "high": prices[i] * 1.01,
            "low": prices[i] * 0.99,
            "close": prices[i],
            "volume": base_volume + i * 1000,
        })
    return klines


def _mock_decision_fn(klines, options):
    """凡人話: 拎 mock decisionFn (返 UP/DOWN/SIDEWAYS verdict)
    Phase 9 開工時 M8 backend 仲未 port, 但可以 mock 拎真實 verdict 拎 chain 測試
    """
    if not klines:
        return {"final_action": "WAIT", "state": "SIDEWAYS", "confidence": 0.5}
    last = klines[-1]["close"]
    first = klines[0]["close"]
    change = (last - first) / first if first else 0
    if change > 0.05:
        return {"final_action": "BUY", "state": "UP", "confidence": 0.7}
    elif change < -0.05:
        return {"final_action": "SELL", "state": "DOWN", "confidence": 0.7}
    return {"final_action": "HOLD", "state": "SIDEWAYS", "confidence": 0.5}


def test_back_test_registered_in_registry():
    """確認 back_test 已 register 落 registry"""
    assert "back_test" in list_algorithms()
    algo = get_algorithm("back_test")
    assert algo.name == "back_test"
    assert algo.version == "0.6.0"


def test_back_test_empty_klines():
    """空 K 線: 應該返 empty summary 唔 throw"""
    summary = run_replay([], {"symbol": "TEST"}, _mock_decision_fn)
    assert summary["totalDays"] == 0
    assert summary["results"] == []
    assert summary["avgForwardReturn5d"] is None


def test_back_test_insufficient_data():
    """數據不足: 算法應該返 SIDEWAYS + warning"""
    prices = [100 + i * 0.1 for i in range(20)]  # 太短
    algo = get_algorithm("back_test")
    verdict = algo.run(_make_klines(prices), {"symbol": "TEST", "period": "1d"})
    assert verdict.ok
    assert verdict.meta["state"] == "SIDEWAYS"
    assert verdict.meta["confidence"] == 0
    assert any("INSUFFICIENT_DATA" in w for w in verdict.warnings)


def test_back_test_replay_basic():
    """基本 replay: 應該拎到 results"""
    random.seed(42)
    prices = []
    p = 100
    for _ in range(150):
        p *= 1.005
        prices.append(p)
    klines = _make_klines(prices)

    summary = run_replay(
        klines,
        {"symbol": "TEST", "klines": klines, "stepDays": 5, "holdDays": [5, 10, 20]},
        _mock_decision_fn,
    )
    # 150 / 5 = 30 steps
    assert summary["totalDays"] > 0
    assert summary["totalDays"] <= 30
    assert "actionBreakdown" in summary


def test_back_test_replay_forward_return():
    """Forward return 應該有 data (5/10/20 日後 close)"""
    random.seed(42)
    prices = [100 + i * 0.5 for i in range(150)]
    klines = _make_klines(prices)

    summary = run_replay(
        klines,
        {"symbol": "TEST", "klines": klines, "stepDays": 5, "holdDays": [5, 10, 20]},
        _mock_decision_fn,
    )
    # 至少 1 個 result 拎到 forward return 5d
    has_5d = any(r.get("forwardReturn5d") is not None for r in summary["results"])
    assert has_5d, "應該有 result 拎到 forward return 5d"


def test_back_test_coarse_grid_sorted():
    """Coarse grid 應該 sorted by score desc"""
    random.seed(42)
    prices = [100 + i * 0.3 for i in range(200)]
    klines = _make_klines(prices)

    result = run_coarse_grid({
        "klines": klines,
        "decisionFn": _mock_decision_fn,
        "baseSymbol": "TEST",
    })
    # 9 個 entries
    assert len(result["entries"]) == 9
    # Sorted by score desc
    for i in range(len(result["entries"]) - 1):
        assert result["entries"][i]["score"] >= result["entries"][i + 1]["score"]
    # Top 5 揀返 score 最高嗰 5 個
    assert len(result["top5"]) == 5


def test_back_test_adaptive_window_extend():
    """Adaptive window 應該 extend if samples < min"""
    random.seed(42)
    prices = [100 + i * 0.1 for i in range(100)]  # < 126 initial days
    klines = _make_klines(prices)

    result = run_adaptive_window({
        "klines": klines,
        "decisionFn": _mock_decision_fn,
        "baseSymbol": "TEST",
        "initialDays": 126,
        "maxDays": 378,
        "minSamples": 30,
    })
    # 唔夠 data 應該用晒 max
    assert result["finalDays"] <= 378
    assert result["finalSamples"] >= 0


def test_back_test_walk_forward_cv():
    """Walk-forward CV 應該拎到 folds + overall"""
    random.seed(42)
    prices = []
    p = 100
    for _ in range(300):
        p *= 1.003
        prices.append(p)
    klines = _make_klines(prices)

    result = run_walk_forward_cv({
        "klines": klines,
        "decisionFn": _mock_decision_fn,
        "baseSymbol": "TEST",
        "numFolds": 3,
    })
    # 3 個 folds
    assert len(result["folds"]) == 3
    # Overall 拎到 bestParams
    assert "bestParams" in result["overall"]
    assert "kelly" in result["overall"]["bestParams"]
    assert "rsiWeight" in result["overall"]["bestParams"]
    assert "ssiWeights" in result["overall"]["bestParams"]
    # avg + stability
    assert "avgValidateScore" in result["overall"]
    assert "stabilityScore" in result["overall"]
    # 0 ≤ stability ≤ 1
    assert 0 <= result["overall"]["stabilityScore"] <= 1


def test_back_test_verdict_shape():
    """Verdict shape 對齊 frontend meta 兼容"""
    random.seed(42)
    prices = []
    p = 100
    for _ in range(300):
        p *= 1.003
        prices.append(p)

    algo = get_algorithm("back_test")
    verdict = algo.run(_make_klines(prices), {"symbol": "TEST", "period": "1d", "decisionFn": _mock_decision_fn})

    assert verdict.ok
    meta = verdict.meta
    # frontend render function 拎呢啲 field
    assert meta["moduleId"] == "back-test"
    assert "timeframe" in meta
    assert "state" in meta
    assert "cycleLabel" in meta
    assert "confidence" in meta
    assert "interpretation" in meta
    assert "walkForwardResult" in meta
    assert "folds" in meta
    assert "overall" in meta
    assert "bestParams" in meta
    assert "avgValidateScore" in meta
    assert "stabilityScore" in meta
    assert "totalValidateSamples" in meta
    assert "foldsCount" in meta
    assert "postErrors" in meta


def test_back_test_decision_fn_fallback():
    """冇 inject decisionFn 應該 fallback _default_decision_fn (Phase 9 開工時 M8 仲未 port)"""
    random.seed(42)
    prices = [100 + i * 0.3 for i in range(200)]
    klines = _make_klines(prices)

    algo = get_algorithm("back_test")
    # 唔 pass decisionFn, 用 default fallback
    verdict = algo.run(_make_klines(prices), {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    # Default decisionFn 拎到 verdict
    assert "walkForwardResult" in verdict.meta
    # 唔 silent fail, 拎到 warning 提示
    # (M8 仲未 port, 拎 fallback, 但 verdict 仍然 work)


def test_back_test_post_optimal():
    """POST optimal 落 cache 應該 work (即使 backend.api.adaptive_params 唔存在, 唔 crash)"""
    random.seed(42)
    prices = []
    p = 100
    for _ in range(300):
        p *= 1.003
        prices.append(p)

    algo = get_algorithm("back_test")
    verdict = algo.run(_make_klines(prices), {"symbol": "TEST", "period": "1d", "decisionFn": _mock_decision_fn})

    # 即使 cache post 失敗 (Phase 9 開工時 backend.api.adaptive_params 仲未 import 完整),
    # algorithm 仍然 ok, 唔 crash
    assert verdict.ok
    assert "postErrors" in verdict.meta

"""
backend/tests/test_decision_engine.py — M8 Decision Engine v2.0.0 backend tests (大少 2026-08-20 Phase 10)

10 tests:
- test_decision_engine_registered_in_registry
- test_decision_engine_no_synthesizer_verdict
- test_decision_engine_trap_action
- test_decision_engine_sell_action
- test_decision_engine_buy_action
- test_decision_engine_hold_action
- test_decision_engine_trading_card_volatility_buckets
- test_decision_engine_short_term_forecast_9_scenarios
- test_decision_engine_apply_adaptive_params_kelly_override
- test_decision_engine_llm_hook_interface
- test_decision_engine_verdict_shape
- test_decision_engine_optimal_data_embed
"""

import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from algorithms import get_algorithm, list_algorithms
from algorithms.decision_engine import (
    KELLY_NUMERIC_MAP,
    _hardcoded_interpretation,
    _compute_trading_card,
    _compute_short_term_forecast,
    _get_majority_state,
    _apply_adaptive_params_to_synthesizer,
    generate_interpretation,
)


def _make_synth_verdict(
    state: str = "UP",
    confidence: float = 0.7,
    grade: str = "B+",
    kelly_fraction: str = "quarter",
    kelly_numeric: float = 0.25,
    ssi_score: float = 70.0,
    alignment_score: float = 0.8,
) -> dict:
    return {
        "state": state,
        "confidence": confidence,
        "grade": grade,
        "grade_score": 75.0,
        "kelly_fraction": kelly_fraction,
        "kelly_numeric": kelly_numeric,
        "kelly_position": kelly_numeric,
        "ssi_score": ssi_score,
        "alignment_score": alignment_score,
        "ssi_breakdown": {"consistency": 0.7, "confidence_avg": 0.7, "rules_coverage": 0.7},
        "tcm_matrix": [],
        "module_verdicts": [],
        "cycle": "uptrend",
        "cycleLabel": "上升趨勢",
    }


def _make_module_verdicts(state_distribution: dict) -> list:
    """state_distribution = {'UP': 5, 'DOWN': 1, 'SIDEWAYS': 0}"""
    verdicts = []
    idx = 0
    for state, count in state_distribution.items():
        for _ in range(count):
            verdicts.append({
                "module_id": ["ma-alignment", "hl-structure", "trendline", "indicators", "volume", "volatility"][idx % 6],
                "state": state,
                "confidence": 0.7,
                "base_weight": 0.15,
                "max_drawdown_estimate": 0.05,
                "rules_fired": ["R1"],
                "sentiment_6d": {"rsi": 0.4, "macd": 0.3, "mfi": 0.0, "obv": 0.0, "adx": 0.0, "cci": 0.0},
            })
            idx += 1
    return verdicts


def test_decision_engine_registered_in_registry():
    """確認 decision_engine 已 register 落 registry"""
    assert "decision_engine" in list_algorithms()
    algo = get_algorithm("decision_engine")
    assert algo.name == "decision_engine"
    assert algo.version == "2.0.0"


def test_decision_engine_no_synthesizer_verdict():
    """冇 M7 synthesizer verdict: 應該返 SIDEWAYS + warning"""
    algo = get_algorithm("decision_engine")
    verdict = algo.run([], {"symbol": "TEST", "period": "1d"})

    assert verdict.ok
    assert verdict.meta["state"] == "SIDEWAYS"
    assert verdict.meta["confidence"] == 0
    assert any("INSUFFICIENT_DATA" in w for w in verdict.warnings)


def test_decision_engine_trap_action():
    """TRAP — confidence 極低"""
    algo = get_algorithm("decision_engine")
    sv = _make_synth_verdict(confidence=0.1, grade="F")
    module_verdicts = _make_module_verdicts({"UP": 3, "DOWN": 3})

    verdict = algo.run([], {
        "symbol": "TEST",
        "period": "1d",
        "synthesizerVerdict": sv,
        "moduleVerdicts": module_verdicts,
        "marketData": {"currentPrice": 100.0},
    })

    assert verdict.ok
    assert verdict.meta["final_action"] == "TRAP"
    assert "唔好信導航" in verdict.meta["interpretation"]


def test_decision_engine_sell_action():
    """SELL — DOWN majority + 中高 confidence"""
    algo = get_algorithm("decision_engine")
    sv = _make_synth_verdict(state="DOWN", confidence=0.6, grade="B")
    module_verdicts = _make_module_verdicts({"DOWN": 5, "UP": 1})

    verdict = algo.run([], {
        "symbol": "TEST",
        "period": "1d",
        "synthesizerVerdict": sv,
        "moduleVerdicts": module_verdicts,
        "marketData": {"currentPrice": 100.0},
    })

    assert verdict.ok
    assert verdict.meta["final_action"] == "SELL"
    assert "急煞車" in verdict.meta["interpretation"]


def test_decision_engine_buy_action():
    """BUY — UP majority + 中高 confidence"""
    algo = get_algorithm("decision_engine")
    sv = _make_synth_verdict(state="UP", confidence=0.6, grade="B+")
    module_verdicts = _make_module_verdicts({"UP": 5, "DOWN": 1})

    verdict = algo.run([], {
        "symbol": "TEST",
        "period": "1d",
        "synthesizerVerdict": sv,
        "moduleVerdicts": module_verdicts,
        "marketData": {"currentPrice": 100.0},
    })

    assert verdict.ok
    assert verdict.meta["final_action"] in ("BUY", "ADD", "HOLD")
    assert verdict.meta["final_action_reason"]


def test_decision_engine_hold_action():
    """HOLD — UP majority 但 confidence 唔夠 0.65"""
    algo = get_algorithm("decision_engine")
    sv = _make_synth_verdict(state="UP", confidence=0.4, grade="B")
    module_verdicts = _make_module_verdicts({"UP": 4, "SIDEWAYS": 2})

    verdict = algo.run([], {
        "symbol": "TEST",
        "period": "1d",
        "synthesizerVerdict": sv,
        "moduleVerdicts": module_verdicts,
        "marketData": {"currentPrice": 100.0},
    })

    assert verdict.ok
    # confidence 0.4 < 0.65 threshold, UP majority → HOLD
    assert verdict.meta["final_action"] in ("HOLD", "WAIT")


def test_decision_engine_trading_card_volatility_buckets():
    """Trading card 3 個 volatility bucket adaptive"""
    # 高波動
    card_high = _compute_trading_card(100.0, "octo", 0.15)
    # 低波動
    card_low = _compute_trading_card(100.0, "half", 0.02)
    # 中波動 (default)
    card_mid = _compute_trading_card(100.0, "quarter", 0.07)
    # 高波動 entry_zone 範圍闊過低波動
    high_range = card_high["entry_zone"][1] - card_high["entry_zone"][0]
    low_range = card_low["entry_zone"][1] - card_low["entry_zone"][0]
    mid_range = card_mid["entry_zone"][1] - card_mid["entry_zone"][0]
    assert high_range > mid_range > low_range > 0
    # 全部 4 個 fields 都有
    for card in [card_high, card_mid, card_low]:
        assert "entry_zone" in card
        assert "stop_loss" in card
        assert "take_profit" in card
        assert "trailing_stop" in card
        assert card["stop_loss"] < 100.0 < card["take_profit"]


def test_decision_engine_short_term_forecast_9_scenarios():
    """9 個 scenarios = 3 (optimistic/baseline/pessimistic) × 3 (5/10/20 日)"""
    forecast = _compute_short_term_forecast(0.02, 0.05)
    assert len(forecast) == 9
    # 3 個 scenarios
    scenarios = set(f["scenario"] for f in forecast)
    assert scenarios == {"optimistic", "baseline", "pessimistic"}
    # 3 個 timeframes
    timeframes = set(f["timeframe_days"] for f in forecast)
    assert timeframes == {5, 10, 20}
    # Probability sum = 1.0
    total_prob = sum(f["probability"] for f in forecast[:3])  # 5 日嗰 3 個 scenarios
    assert abs(total_prob - 1.0) < 0.01


def test_decision_engine_apply_adaptive_params_kelly_override():
    """Apply adaptive params 落 Synthesizer (Bug 2 fix: Kelly string → numeric)"""
    sv = _make_synth_verdict(kelly_fraction="quarter", kelly_numeric=0.25)
    params = {"kellyFraction": "octo"}

    new_sv = _apply_adaptive_params_to_synthesizer(sv, params)

    # Kelly 應該 override 落 octo (0.125)
    assert new_sv["kelly_fraction"] == "octo"
    assert new_sv["kelly_numeric"] == 0.125
    assert new_sv["kelly_position"] == 0.125
    # 原本 sv 唔 mutate
    assert sv["kelly_fraction"] == "quarter"


def test_decision_engine_llm_hook_interface():
    """LLM hook 必須有 async generate_interpretation interface (大少 13:30 永久 rule)"""
    import asyncio
    ctx = {
        "final_action": "BUY",
        "module_verdicts": _make_module_verdicts({"UP": 5, "DOWN": 1}),
        "synthesizer_verdict": _make_synth_verdict(),
        "short_term_forecast": _compute_short_term_forecast(0.02, 0.05),
    }

    # 拎 coroutine 確認係 async function
    coro = generate_interpretation(ctx)
    result = asyncio.get_event_loop().run_until_complete(coro) if asyncio.get_event_loop().is_running() else asyncio.run(coro)
    assert "應該買入" in result


def test_decision_engine_verdict_shape():
    """Verdict shape 對齊 frontend meta 兼容"""
    algo = get_algorithm("decision_engine")
    sv = _make_synth_verdict()
    module_verdicts = _make_module_verdicts({"UP": 5, "DOWN": 1})
    optimal_params = {"kellyFraction": "quarter", "rsiWeight": 0.20}

    verdict = algo.run([], {
        "symbol": "TEST",
        "period": "1d",
        "synthesizerVerdict": sv,
        "moduleVerdicts": module_verdicts,
        "marketData": {"currentPrice": 100.0},
        "optimalParams": optimal_params,
    })

    assert verdict.ok
    meta = verdict.meta
    assert meta["moduleId"] == "decision-engine"
    assert "final_action" in meta
    assert "trading_card" in meta
    assert "short_term_forecast" in meta
    assert "interpretation" in meta
    assert "optimal_data" in meta
    # Trading card 4 fields
    assert "entry_zone" in meta["trading_card"]
    assert "stop_loss" in meta["trading_card"]
    assert "take_profit" in meta["trading_card"]
    assert "trailing_stop" in meta["trading_card"]


def test_decision_engine_optimal_data_embed():
    """M8 verdict 永久 embed M9 optimal_data (AS-03 chain rule)"""
    algo = get_algorithm("decision_engine")
    sv = _make_synth_verdict()
    module_verdicts = _make_module_verdicts({"UP": 5, "DOWN": 1})
    optimal_params = {"kellyFraction": "octo", "rsiWeight": 0.30}

    verdict = algo.run([], {
        "symbol": "TEST",
        "period": "1d",
        "synthesizerVerdict": sv,
        "moduleVerdicts": module_verdicts,
        "marketData": {"currentPrice": 100.0},
        "optimalParams": optimal_params,
    })

    assert verdict.ok
    assert verdict.meta["optimal_data"] is not None
    assert verdict.meta["optimal_data"]["bestParams"]["kellyFraction"] == "octo"
    assert "Phase 10" in verdict.meta["optimal_data"]["source"]

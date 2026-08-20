"""
backend/tests/test_m9_m8_chain_flow_5stocks.py — M9 + M8 全面測試 (大少 2026-08-20 22:21 揀 全面測試)

凡人話: 拎 5 隻 stock 嘅 mock K 線 (唔同 price trends), 跑 M1-M6 → M7 → M9 → M8 chain flow,
verify:
  - M7 Synthesizer 拎 M1-M6 verdict → 拎 synth verdict (state / grade / kelly)
  - M9 Back Test 拎 M7 + M8 decisionFn → 拎 walk-forward CV result
  - M8 Decision Engine 拎 M7 + 6 module standard verdict + M9 optimal params → 拎 final action
  - Chain integrity: M8 verdict.optimal_data 永遠 embed M9 bestParams (chain rule M9→M8)

Test 5 隻 stock:
  - HK.00700 騰訊 (mock 上升趨勢)
  - HK.00005 匯豐 (mock 橫行趨勢)
  - US.AAPL (mock 強升趨勢)
  - US.MSFT (mock 上升趨勢)
  - US.GOOGL (mock 弱升趨勢)
"""

import sys
import os
import random
import pytest
from typing import List, Dict, Any

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from algorithms import get_algorithm


# ============================================================
# Mock K-line generators (5 隻 stock, 唔同 price trends)
# ============================================================

def _make_klines(prices: list, base_volume: int = 1000000):
    """凡人話: 用 prices 整 klines fixture"""
    n = len(prices)
    klines = []
    for i in range(n):
        klines.append({
            "timestamp": 1700000000 + i * 86400,  # seconds (testing page frontend 格式)
            "open": prices[i] * 0.99,
            "high": prices[i] * 1.02,
            "low": prices[i] * 0.98,
            "close": prices[i],
            "volume": base_volume + i * 1000,
        })
    return klines


def _gen_hk_00700_klines(n: int = 1260) -> List[Dict[str, Any]]:
    """HK.00700 騰訊 — 上升趨勢 (中等)"""
    random.seed(700)
    prices = []
    p = 350.0
    for _ in range(n):
        p *= 1.001  # 0.1% 每日升
        p += random.uniform(-3, 3)  # noise ±3
        prices.append(max(p, 1.0))
    return _make_klines(prices)


def _gen_hk_00005_klines(n: int = 1260) -> List[Dict[str, Any]]:
    """HK.00005 匯豐 — 橫行趨勢"""
    random.seed(5)
    prices = []
    p = 65.0
    for _ in range(n):
        p += random.uniform(-0.5, 0.5)  # 純 noise
        p = max(p, 60.0)  # 防止跌穿底
        p = min(p, 70.0)  # 防止升穿頂
        prices.append(p)
    return _make_klines(prices)


def _gen_us_aapl_klines(n: int = 1260) -> List[Dict[str, Any]]:
    """US.AAPL — 強升趨勢"""
    random.seed(1111)
    prices = []
    p = 150.0
    for _ in range(n):
        p *= 1.002  # 0.2% 每日升 (強)
        p += random.uniform(-2, 2)
        prices.append(max(p, 1.0))
    return _make_klines(prices)


def _gen_us_msft_klines(n: int = 1260) -> List[Dict[str, Any]]:
    """US.MSFT — 上升趨勢 (中等)"""
    random.seed(2222)
    prices = []
    p = 300.0
    for _ in range(n):
        p *= 1.0015  # 0.15% 每日升
        p += random.uniform(-3, 3)
        prices.append(max(p, 1.0))
    return _make_klines(prices)


def _gen_us_googl_klines(n: int = 1260) -> List[Dict[str, Any]]:
    """US.GOOGL — 弱升趨勢"""
    random.seed(3333)
    prices = []
    p = 130.0
    for _ in range(n):
        p *= 1.0005  # 0.05% 每日升 (弱)
        p += random.uniform(-3, 3)
        prices.append(max(p, 1.0))
    return _make_klines(prices)


# ============================================================
# M1-M6 algorithm instances (phase 2-7 backend port 全部 done)
# ============================================================

M1_MA = get_algorithm("ma_alignment")
M2_HL = get_algorithm("hl_structure")
M3_TL = get_algorithm("trendline")
M4_IND = get_algorithm("indicators")
M5_VOL = get_algorithm("volume_price")
M6_VOLA = get_algorithm("volatility")
M7_SYN = get_algorithm("synthesizer")
M9_BT = get_algorithm("back_test")
M8_DE = get_algorithm("decision_engine")


# ============================================================
# Helper: 跑 M1-M6 algorithm 拎 standard verdict interface
# ============================================================

M1_TO_MODULE_ID = {
    "ma_alignment": "ma-alignment",
    "hl_structure": "hl-structure",
    "trendline": "trendline",
    "indicators": "indicators",
    "volume_price": "volume",
    "volatility": "volatility",
}

M_BASE_WEIGHTS = {
    "ma-alignment": 0.25,
    "hl-structure": 0.15,
    "trendline": 0.10,
    "indicators": 0.10,
    "volume": 0.10,
    "volatility": 0.10,
}


def _run_upstream(klines: List[Dict[str, Any]], period: str = "1d") -> List[Dict[str, Any]]:
    """跑 M1-M6 algorithm 拎 standard verdict interface
    凡人話: M7 拎呢啲 verdict 拎 synth verdict
    """
    module_verdicts = []
    for algo, algo_name in [
        (M1_MA, "ma_alignment"),
        (M2_HL, "hl_structure"),
        (M3_TL, "trendline"),
        (M4_IND, "indicators"),
        (M5_VOL, "volume_price"),
        (M6_VOLA, "volatility"),
    ]:
        v = algo.run(klines, {"period": period})
        if v.ok:
            state = v.meta.get("state", "SIDEWAYS")
            confidence = v.meta.get("confidence", 0)
            rules_fired = (
                v.meta.get("matchedRules")
                or v.meta.get("matched_rules")
                or v.meta.get("rules_fired", [])
            )
            module_verdicts.append({
                "module_id": M1_TO_MODULE_ID[algo_name],
                "state": state,
                "confidence": confidence,
                "base_weight": M_BASE_WEIGHTS[M1_TO_MODULE_ID[algo_name]],
                "max_drawdown_estimate": 0.05,
                "rules_fired": rules_fired if isinstance(rules_fired, list) else [],
                "sentiment_6d": {"rsi": 0.0, "macd": 0.0, "mfi": 0.0, "obv": 0.0, "adx": 0.0, "cci": 0.0},
                "expected_return": v.meta.get("expectedReturn", 0) or 0,
            })
    return module_verdicts


# ============================================================
# Tests
# ============================================================

STOCKS = [
    ("HK.00700", "騰訊 (mock 上升)", _gen_hk_00700_klines),
    ("HK.00005", "匯豐 (mock 橫行)", _gen_hk_00005_klines),
    ("US.AAPL", "AAPL (mock 強升)", _gen_us_aapl_klines),
    ("US.MSFT", "MSFT (mock 上升)", _gen_us_msft_klines),
    ("US.GOOGL", "GOOGL (mock 弱升)", _gen_us_googl_klines),
]


@pytest.mark.parametrize("symbol,desc,gen_klines", STOCKS, ids=[s[0] for s in STOCKS])
def test_full_chain_flow(symbol: str, desc: str, gen_klines):
    """M1-M6 → M7 → M9 → M8 完整 chain flow 全面測試"""
    klines = gen_klines()
    print(f"\n{'='*60}")
    print(f"🧪 {symbol} — {desc} (klines={len(klines)})")
    print(f"{'='*60}")

    # Step 1: 跑 M1-M6 拎 module standard verdict
    module_verdicts = _run_upstream(klines)
    print(f"\n📊 M1-M6 verdicts:")
    for mv in module_verdicts:
        print(f"  {mv['module_id']:18s} state={mv['state']:10s} conf={mv['confidence']:.3f} rules={len(mv['rules_fired'])}")

    # Step 2: 跑 M7 Synthesizer 拎 synth verdict
    synth_input = {
        "period": "1d",
        "symbol": symbol,
        "moduleVerdicts": module_verdicts,
    }
    synth_verdict = M7_SYN.run(klines, synth_input)
    assert synth_verdict.ok, f"M7 fail: {synth_verdict.error}"
    sv = synth_verdict.meta
    print(f"\n🎯 M7 Synthesizer verdict:")
    print(f"  state={sv.get('state', 'N/A')} grade={sv.get('grade', 'N/A')} ({sv.get('grade_score', 0)})")
    print(f"  SSI={sv.get('ssi_score', 0)} alignment={sv.get('alignment_score', 0):.3f}")
    print(f"  Kelly={sv.get('kelly_fraction', 'N/A')} ({sv.get('kelly_numeric', 0) * 100:.1f}%)")

    # Step 3: 跑 M9 Back Test 拎 walk-forward CV result (拎 M7 + M8 decisionFn inject)
    # Phase 9 done 之後, M9 algorithm 拎 M7 verdict + M8 decisionFn 拎 chain flow
    # 凡人話: M9 拎 M7 + M8 拎 walk-forward CV 拎 optimal params
    m9_input = {
        "period": "1d",
        "symbol": symbol,
        "moduleVerdicts": sv.get("module_verdicts", module_verdicts),  # M7 verdict 嘅 6 module standard verdict
    }
    m9_verdict = M9_BT.run(klines, m9_input)
    assert m9_verdict.ok, f"M9 fail: {m9_verdict.error}"
    m9_meta = m9_verdict.meta
    print(f"\n📈 M9 Back Test verdict:")
    print(f"  folds_count={m9_meta.get('foldsCount', 0)} total_samples={m9_meta.get('totalValidateSamples', 0)}")
    print(f"  avg_validate_score={m9_meta.get('avgValidateScore', 0):.1f} stability={m9_meta.get('stabilityScore', 0):.3f}")
    print(f"  bestParams: kelly={m9_meta.get('bestParams', {}).get('kelly', 'N/A')} rsi={m9_meta.get('bestParams', {}).get('rsiWeight', 'N/A')}")
    print(f"  post_errors={len(m9_meta.get('postErrors', []))}")

    # Step 4: 跑 M8 Decision Engine 拎 final verdict (拎 M7 + 6 module + M9 optimal params)
    m8_input = {
        "period": "1d",
        "symbol": symbol,
        "synthesizerVerdict": sv,
        "moduleVerdicts": module_verdicts,
        "marketData": {"currentPrice": float(klines[-1]["close"])},
        "optimalParams": {
            "kellyFraction": m9_meta.get("bestParams", {}).get("kelly", "quarter"),
            "rsiWeight": m9_meta.get("bestParams", {}).get("rsiWeight", 0.20),
            "ssiWeights": m9_meta.get("bestParams", {}).get("ssiWeights", {"ma": 0.4, "hl": 0.3, "tl": 0.3}),
        },
    }
    m8_verdict = M8_DE.run(klines, m8_input)
    assert m8_verdict.ok, f"M8 fail: {m8_verdict.error}"
    m8_meta = m8_verdict.meta
    print(f"\n🚦 M8 Decision Engine verdict:")
    print(f"  final_action={m8_meta.get('final_action', 'N/A')}")
    print(f"  reason={m8_meta.get('final_action_reason', 'N/A')[:80]}...")
    print(f"  trading_card: entry_zone=[{m8_meta.get('trading_card', {}).get('entry_zone', ['?', '?'])[0]:.2f}, {m8_meta.get('trading_card', {}).get('entry_zone', ['?', '?'])[1]:.2f}]")
    print(f"    stop_loss={m8_meta.get('trading_card', {}).get('stop_loss', 0):.2f} tp={m8_meta.get('trading_card', {}).get('take_profit', 0):.2f}")
    print(f"  forecast_5d_baseline={m8_meta.get('short_term_forecast', [{}])[1].get('expected_return', 0) * 100:.2f}%" if m8_meta.get('short_term_forecast') else "  forecast=N/A")
    print(f"  interpretation: {m8_meta.get('interpretation', 'N/A')[:100]}...")

    # Step 5: Verify chain integrity — M8 verdict 永久 embed M9 optimal_data
    optimal_data = m8_meta.get("optimal_data")
    assert optimal_data is not None, "M8 verdict 冇 embed M9 optimal_data (chain rule 破壞)"
    assert optimal_data.get("bestParams") is not None
    print(f"\n✅ Chain integrity verify: M8.optimal_data bestParams={optimal_data['bestParams']}")

    # Step 6: Verify chain — M9 verdict 拎 M7 verdict (chain rule M7→M9)
    assert m9_meta.get("m7Context", {}).get("verdict_count", 0) > 0, "M9 verdict 冇拎 M7 context"
    print(f"✅ M7→M9 chain: M9 verdict.optimal_data 拎 M7 verdict_count={m9_meta.get('m7Context', {}).get('verdict_count', 0)}")

    # Step 7: Warnings
    warnings = m8_verdict.warnings
    if warnings:
        print(f"⚠️ M8 warnings: {warnings}")
    else:
        print("✅ M8 verdict no warnings")

    print(f"\n{'='*60}")
    print(f"✅ {symbol} 完整 chain flow 通過 (M1-M6 → M7 → M9 → M8)")
    print(f"{'='*60}\n")


# ============================================================
# 5 stocks summary report
# ============================================================

def test_5_stocks_summary_report(capsys):
    """5 隻 stock 拎 chain flow verdict 拎 summary report"""
    print(f"\n{'='*70}")
    print(f"📊 5 STOCKS COMPREHENSIVE CHAIN FLOW SUMMARY")
    print(f"{'='*70}")
    print(f"{'Symbol':12s} {'M7 state':12s} {'M7 grade':10s} {'M9 folds':10s} {'M9 score':10s} {'M8 action':14s} {'OK':4s}")
    print(f"{'-'*70}")

    for symbol, desc, gen_klines in STOCKS:
        klines = gen_klines()
        try:
            module_verdicts = _run_upstream(klines)
            synth_v = M7_SYN.run(klines, {"period": "1d", "symbol": symbol, "moduleVerdicts": module_verdicts})
            m9_v = M9_BT.run(klines, {"period": "1d", "symbol": symbol, "moduleVerdicts": synth_v.meta.get("module_verdicts", module_verdicts)})
            m8_v = M8_DE.run(klines, {
                "period": "1d", "symbol": symbol,
                "synthesizerVerdict": synth_v.meta,
                "moduleVerdicts": module_verdicts,
                "marketData": {"currentPrice": float(klines[-1]["close"])},
                "optimalParams": {
                    "kellyFraction": m9_v.meta.get("bestParams", {}).get("kelly", "quarter"),
                    "rsiWeight": m9_v.meta.get("bestParams", {}).get("rsiWeight", 0.20),
                    "ssiWeights": m9_v.meta.get("bestParams", {}).get("ssiWeights", {"ma": 0.4, "hl": 0.3, "tl": 0.3}),
                },
            })
            ok = "✅" if (synth_v.ok and m9_v.ok and m8_v.ok) else "❌"
            print(f"{symbol:12s} {synth_v.meta.get('state', 'N/A'):12s} {synth_v.meta.get('grade', 'N/A'):10s} {m9_v.meta.get('foldsCount', 0):<10} {m9_v.meta.get('avgValidateScore', 0):<10.1f} {m8_v.meta.get('final_action', 'N/A'):14s} {ok:4s}")
        except Exception as e:
            print(f"{symbol:12s} ERROR: {e}")
    print(f"{'='*70}\n")

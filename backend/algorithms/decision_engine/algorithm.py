"""
backend/algorithms/decision_engine/algorithm.py — M8 Decision Engine v2.0.0 (大少 2026-08-20 22:08 Phase 10)

凡人話: 拎 M7 Synthesizer verdict + 6 個 module standard verdict → 8 個 finalAction 決策樹 (BUY/ADD/HOLD/REDUCE/SELL/WAIT/TRAP/TRANSITION)
+ Trading card 4 個 fields (adaptive 跟 kelly_fraction + max_drawdown_estimate) + 短期走勢 9 個 scenarios
+ LLM hook 預留 (大少 2026-08-08 13:30 永久 rule, 而家用 hardcoded template) + Adaptive params apply 落 Synthesizer

對應 source: algorithms/AS-03-cycle-detection/modules/decision-engine.ts v2.0.0 (1359 行, Sprint 2 收官 2.1-2.9 全部 done)
對應 spec doc: docs/research/AS-03-cycle-detection/MODULE-08-DECISION-ENGINE.md
對應 framework: backend/algorithms/base.py Verdict contract

Algorithm: 9 step (跟 decision-engine.ts DecisionEngine.decide() 1:1 port 去 Python, sync version 因為 backend)
- Step 0: 數據驗證 (need synthesizerVerdict + ≥ 1 module verdict)
- Step 1: 拎 majority state (6 個 modules state 最大 group)
- Step 2: 拎 weighted avg max_drawdown_estimate (用 base_weight 加權)
- Step 3: 拎 raw RSI (從 indicators verdict)
- Step 4: Apply adaptive params 落 Synthesizer (5 個 adaptive params override kelly / rsi / ssi / markowitz / hurst)
- Step 5: 8 個 finalAction 決策樹 (priority chain: TRAP > TRANSITION > SELL > REDUCE > WAIT > HOLD > ADD > BUY)
- Step 6: Trading card 4 個 fields (3 個 volatility bucket 跟 kelly + max_drawdown)
- Step 7: 短期走勢 9 個 scenarios (3 scenarios × 3 timeframes: 5/10/20 日)
- Step 8: LLM hook + hardcoded template interpretation (8 個 finalAction 各自白話)
- Step 9: 組裝 output (final_action + trading_card + forecast + interpretation + optimal_data)

Chain flow 永久 rule (大少 2026-08-11 v1.0.0):
- M7(綜合) → M9(回測取最佳設定) → M8(用最佳設定做最終判斷)
- M8 拎 M7 verdict + M9 optimal params 落 decide()
- 永久 rule: M8 algorithm 唔可以直接 fetch K 線, 由 runner 統一 inject
- Runner 自動 inject 落 options: moduleVerdicts (M7 verdict) + marketData (currentPrice + market state)
- 永久 rule: M8 verdict 永遠 embed M9 optimal_params (跟 AS-03 chain rule, 撳 M8 即刻見到 M9 拎咩 optimal 設定)

LLM hook 永久 rule (大少 2026-08-08 13:30):
- M8 algorithm 必須有 `async generate_interpretation(ctx) -> str` interface
- Sprint 2 用 hardcoded template (plain language + 揸車比喻)
- 將來 swap 落 LLM call (OpenAI / MiniMax / Kimi 任何), 唔使改 decide() call site
- 對應 spec: MODULE-08-DECISION-ENGINE.md §8

凡人話: M8 拎 M7 綜合結果, 用 walk-forward CV 最佳設定 + LLM 詳細解讀, 拎最終 BUY/SELL/HOLD 判決 + 交易卡 + 走勢預測
"""

import math
from typing import List, Dict, Any, Optional, Tuple

from ..base import Algorithm, Verdict
from ..registry import register
from .config import DEFAULT_DECISION_ENGINE_CONFIG


# ============================================================
# Constants (跟 decision-engine.ts 1:1 port)
# ============================================================

GRADE_ORDER = ['F', 'D', 'C', 'C+', 'B', 'B+', 'A', 'A+']

# 大少 2026-08-09 12:30 Bug 2 fix — Kelly string → numeric 對照表
KELLY_NUMERIC_MAP: Dict[str, float] = {
    'half': 0.5,
    'quarter': 0.25,
    'octo': 0.125,
}

FINAL_ACTIONS = ['BUY', 'ADD', 'HOLD', 'REDUCE', 'SELL', 'WAIT', 'TRAP', 'TRANSITION']


# ============================================================
# Helpers (跟 decision-engine.ts 1:1 port)
# ============================================================

def _grade_index(g: str) -> int:
    """Grade 計分: F=0, D=1, C=2, C+=3, B=4, B+=5, A=6, A+=7"""
    try:
        return GRADE_ORDER.index(g)
    except ValueError:
        return 0


def _is_grade_at_least(g: str, threshold: str) -> bool:
    return _grade_index(g) >= _grade_index(threshold)


def _get_majority_state(verdicts: List[Dict[str, Any]]) -> str:
    """6 個 modules 嘅 state, 最多出現嗰個 (SIDEWAYS fallback)"""
    if not verdicts:
        return 'SIDEWAYS'
    state_count: Dict[str, int] = {}
    for v in verdicts:
        s = v.get('state', 'SIDEWAYS')
        state_count[s] = state_count.get(s, 0) + 1
    max_state = 'SIDEWAYS'
    max_count = 0
    for s, c in state_count.items():
        if c > max_count:
            max_state = s
            max_count = c
    return max_state


def _weighted_average(values: List[Tuple[float, float]]) -> float:
    """加權平均 — 用 base_weight 加權"""
    total_weight = sum(w for _, w in values)
    if total_weight == 0:
        return 0.0
    return sum(v * w for v, w in values) / total_weight


def _get_raw_rsi(verdicts: List[Dict[str, Any]]) -> float:
    """拎 raw RSI (0-100) from indicators module
    sentiment_6d.rsi = (raw - 50) / 50 (clamp [-1, +1])
    所以 raw = (sentiment_6d.rsi + 1) × 50
    fallback: 冇 indicators module → 50 (中性)
    """
    ind = next((v for v in verdicts if v.get('module_id') == 'indicators'), None)
    if not ind:
        return 50.0
    sent6 = ind.get('sentiment_6d', {}) or {}
    return (sent6.get('rsi', 0) + 1) * 50


# ============================================================
# Step 6: Trading card 4 fields (3 volatility buckets)
# ============================================================

def _compute_trading_card(
    current_price: float,
    kelly_fraction: str,
    max_drawdown: float,
) -> Dict[str, Any]:
    """交易卡 4 個 fields adaptive formula
    - 高波動 (kelly='octo' OR maxdd > 0.10): entry_zone ±2.5%, stop -5%, tp +8%, trailing -7%
    - 中波動 (default): entry_zone ±1.5%, stop -3%, tp +5%, trailing -5%
    - 低波動 (kelly='half' AND maxdd < 0.05): entry_zone ±1.0%, stop -2%, tp +4%, trailing -3%
    """
    if kelly_fraction == 'octo' or max_drawdown > 0.10:
        entry_width = 0.025
        stop_pct = 0.05
        tp_pct = 0.08
        trailing_pct = 0.07
    elif kelly_fraction == 'half' and max_drawdown < 0.05:
        entry_width = 0.010
        stop_pct = 0.02
        tp_pct = 0.04
        trailing_pct = 0.03
    else:
        entry_width = 0.015
        stop_pct = 0.03
        tp_pct = 0.05
        trailing_pct = 0.05

    return {
        'entry_zone': [current_price * (1 - entry_width), current_price * (1 + entry_width)],
        'stop_loss': current_price * (1 - stop_pct),
        'take_profit': current_price * (1 + tp_pct),
        'trailing_stop': current_price * (1 - trailing_pct),
    }


# ============================================================
# Step 7: Short term forecast 9 scenarios
# ============================================================

def _compute_short_term_forecast(
    expected_return: float,
    max_drawdown: float,
) -> List[Dict[str, Any]]:
    """短期走勢 9 個 scenarios = 3 scenarios × 3 timeframes
    - 🟢 optimistic 25%  — expected_return × 1.5 × (days/5)
    - 🟡 baseline 50%    — expected_return × 1.0 × (days/5)
    - 🔴 pessimistic 25% — -max_drawdown × 0.5 × (days/5)
    """
    timeframes: List[int] = [5, 10, 20]
    forecast: List[Dict[str, Any]] = []

    for days in timeframes:
        day_factor = days / 5
        # 🟢 Optimistic
        forecast.append({
            'scenario': 'optimistic',
            'timeframe_days': days,
            'expected_return': round(expected_return * 1.5 * day_factor, 4),
            'max_drawdown': round(max_drawdown * 0.5, 4),
            'probability': 0.25,
        })
        # 🟡 Baseline
        forecast.append({
            'scenario': 'baseline',
            'timeframe_days': days,
            'expected_return': round(expected_return * 1.0 * day_factor, 4),
            'max_drawdown': round(max_drawdown * 0.7, 4),
            'probability': 0.50,
        })
        # 🔴 Pessimistic
        forecast.append({
            'scenario': 'pessimistic',
            'timeframe_days': days,
            'expected_return': round(-max_drawdown * 0.5 * day_factor, 4),
            'max_drawdown': round(max_drawdown * 1.0, 4),
            'probability': 0.25,
        })

    return forecast


# ============================================================
# Step 4: Apply adaptive params 落 Synthesizer
# ============================================================

def _apply_adaptive_params_to_synthesizer(
    sv: Dict[str, Any],
    params: Dict[str, Any],
) -> Dict[str, Any]:
    """大少 2026-08-09 12:30 Bug 2 fix: 將 params 嘅 5 個 adaptive params override 落 sv
    - params.ssiWeights override sv 嘅 SSI weight (影響 M7 alignment)
    - params.kellyFraction override sv 嘅 kelly_fraction / kelly_numeric / kelly_position
    - params.rsiWeight override sv 嘅 RSI weight
    """
    # 唔 mutate 原 sv, 返新 dict
    new_sv = dict(sv)

    # 1. Kelly override (Bug 2 fix — 永久 rule: 改要跟 M7 + M8 + adapter.mjs renderKellyDonut map 同步)
    kelly_str = params.get('kellyFraction')
    if kelly_str and kelly_str in KELLY_NUMERIC_MAP:
        kelly_numeric = KELLY_NUMERIC_MAP[kelly_str]
        new_sv['kelly_fraction'] = kelly_str
        new_sv['kelly_numeric'] = kelly_numeric
        new_sv['kelly_position'] = kelly_numeric

    # 2. SSI weights override
    ssi_weights = params.get('ssiWeights')
    if ssi_weights and isinstance(ssi_weights, dict):
        new_sv['ssi_weights'] = ssi_weights

    # 3. RSI weight override
    rsi_weight = params.get('rsiWeight')
    if rsi_weight is not None:
        new_sv['rsi_weight'] = rsi_weight

    return new_sv


# ============================================================
# Step 8: LLM hook + hardcoded template (8 個 finalAction)
# ============================================================

def _hardcoded_interpretation(ctx: Dict[str, Any]) -> str:
    """8 個 finalAction 各自嘅白話詳細解讀 — 揸車比喻貫穿 (大少 11:57 風格)"""
    final_action = ctx.get('final_action', 'WAIT')
    module_verdicts = ctx.get('module_verdicts', [])
    sv = ctx.get('synthesizer_verdict', {})
    short_term_forecast = ctx.get('short_term_forecast', [])

    up_count = sum(1 for v in module_verdicts if v.get('state') == 'UP')
    down_count = sum(1 for v in module_verdicts if v.get('state') == 'DOWN')
    sideways_count = sum(1 for v in module_verdicts if v.get('state') == 'SIDEWAYS')

    ssi_score = sv.get('ssi_score', 0)
    alignment = sv.get('alignment_score', 0)
    grade = sv.get('grade', 'F')
    kelly = sv.get('kelly_fraction', 'quarter')

    baseline5 = next((f for f in short_term_forecast if f.get('timeframe_days') == 5 and f.get('scenario') == 'baseline'), None)
    baseline5_ret = f"{baseline5.get('expected_return', 0) * 100:.1f}" if baseline5 else "?"

    # 8 個 finalAction 各自嘅 hardcoded template
    if final_action == 'BUY':
        return (
            f"📈 **應該買入**。{up_count} 個 module 認為上升, SSI 戰略強度 {ssi_score:.0f}/100, "
            f"alignment {alignment * 100:.0f}%, grade {grade} 級。\n\n"
            f"等於揸車油門俾到底, {kelly} 倉落注。短期 5 日 baseline 預期 {baseline5_ret}% 回報。"
            f"記得跟 trading card 嘅 entry zone 入市, 跌破 stop loss 即 cut。"
        )
    elif final_action == 'ADD':
        return (
            f"📈➕ **加碼買入**。已經有貨, 訊號再強化, {up_count} 個 module 一致上升, "
            f"grade {grade} 級, Kelly {kelly} 倉。\n\n揸車比喻: 已經踩緊油門, 路面順暢再踩深啲。"
            f"短期 5 日 baseline 預期 {baseline5_ret}%, 適合再加注。"
        )
    elif final_action == 'HOLD':
        return (
            f"⏸ **保持現速**。{up_count} 升 {down_count} 跌 {sideways_count} 橫, "
            f"訊號 mixed, 唔加唔減。grade {grade} 級, Kelly {kelly} 倉。\n\n"
            f"揸車比喻: 路面有少少起伏, 保持現速最安全。短期 5 日 baseline 預期 {baseline5_ret}%, "
            f"等訊號更清晰先再決定加注或減倉。"
        )
    elif final_action == 'REDUCE':
        return (
            f"📉 **收返少少倉**。{down_count} 個 module 開始睇淡, 訊號轉弱, "
            f"grade {grade} 級, Kelly {kelly} 倉。\n\n揸車比喻: 前路有少少暗湧, 收返少少油減速。"
            f"短期 5 日 baseline 預期 {baseline5_ret}%, 保留核心倉位避免 full sell。"
        )
    elif final_action == 'SELL':
        return (
            f"🔻 **急煞車清倉**。{down_count} 個 module 一致睇淡, alignment 跌穿, "
            f"grade {grade} 級, Kelly {kelly} 倉。\n\n揸車比喻: 前路有大暗湧, 急煞車減風險。"
            f"短期 5 日 baseline 預期 {baseline5_ret}%, 等待更好嘅 entry zone 再入場。"
        )
    elif final_action == 'WAIT':
        return (
            f"⏳ **等綠燈**。{sideways_count} 個 module 觀望, 訊號未夠清晰, "
            f"grade {grade} 級, Kelly {kelly} 倉。\n\n揸車比喻: 紅綠燈口前, 等綠燈至踩油門。"
            f"短期 5 日 baseline 預期 {baseline5_ret}%, 等到 grade 升到 B+ 或以上先再入場。"
        )
    elif final_action == 'TRAP':
        return (
            f"⚠️ **唔好信導航**。{up_count} 升 {down_count} 跌嚴重分歧, alignment 極低, "
            f"confidence 接近 0, 大少 trap 訊號。\n\n揸車比喻: 導航話轉左但路面右轉, 唔好跟導航。"
            f"短期 5 日 baseline 預期 {baseline5_ret}%, 切勿入場, 觀望為主。"
        )
    elif final_action == 'TRANSITION':
        return (
            f"🔄 **收油準備轉勢**。cycle 進入 transition state, M1 + 趨勢線 + 高低點 3 個 module "
            f"開始 split, 收油等下一個 clear 訊號。\n\n揸車比喻: 前面要轉彎, 收油慢行睇清楚。"
            f"短期 5 日 baseline 預期 {baseline5_ret}%, 等待 cycle 確認後再決定新方向。"
        )
    return f"🤔 **訊號未定**。grade {grade} 級, Kelly {kelly} 倉, 等更多 module 確認先決定。"


# 大少 2026-08-08 13:30 永久 rule: LLM hook 預留 (async function 永久 interface)
async def generate_interpretation(ctx: Dict[str, Any]) -> str:
    """LLM hook — 將來直接 swap 落 LLM call
    永久 rule: M8 algorithm 必須有 async generate_interpretation(ctx) interface
    Sprint 2 用 hardcoded template, 將來 swap 落 LLM 唔使改 decide() call site
    """
    return _hardcoded_interpretation(ctx)


# ============================================================
# Step 5: 8 個 finalAction 決策樹 (priority chain)
# ============================================================

def _decide_final_action(
    majority_state: str,
    module_verdicts: List[Dict[str, Any]],
    sv: Dict[str, Any],
    market_data: Dict[str, Any],
) -> Tuple[str, str]:
    """8 個 finalAction 統一 priority chain: TRAP > TRANSITION > SELL > REDUCE > WAIT > HOLD > ADD > BUY

    Entry condition (BUY):
      - majority_state === 'UP' (M1+zmen 一致上升)
      - confidence >= 0.65
    永久 rule: 8 個 finalAction 推導按 priority chain 順序, 第一個 match 即 return
    """
    confidence = sv.get('confidence', 0)
    grade = sv.get('grade', 'F')
    alignment = sv.get('alignment_score', 0)
    cycle = sv.get('cycle', 'sideways')

    up_count = sum(1 for v in module_verdicts if v.get('state') == 'UP')
    down_count = sum(1 for v in module_verdicts if v.get('state') == 'DOWN')

    # 1. TRAP — 兩個 module 嚴重分歧 (confidence 極低)
    if confidence < 0.2 or (up_count > 0 and down_count > 0 and alignment < 0.2):
        return 'TRAP', f"TRAP: confidence {confidence:.2f} 極低 / alignment {alignment * 100:.0f}% 太低, 唔好信導航"

    # 2. TRANSITION — cycle 進入 transition (M1 拎 cyclePosition 嗰 part)
    if cycle == 'transition' or sv.get('cycle_position') in ('late_stage_topping', 'late_stage_bottoming'):
        return 'TRANSITION', f"TRANSITION: cycle 進入 transition state, 收油等下一個 clear 訊號"

    # 3. SELL — 一致睇淡 (down majority + 高 confidence)
    if majority_state == 'DOWN' and confidence >= 0.5:
        return 'SELL', f"SELL: {down_count} 個 module 一致睇淡, confidence {confidence:.2f}, 急煞車清倉"

    # 4. REDUCE — 偏淡 (down majority, 中 confidence)
    if majority_state == 'DOWN' or (down_count > up_count and grade in ('D', 'F')):
        return 'REDUCE', f"REDUCE: {down_count} 跌 {up_count} 升, 訊號轉弱, 收返少少倉"

    # 5. WAIT — 橫行, 訊號未夠清晰
    if majority_state == 'SIDEWAYS' or grade in ('C', 'C+', 'D', 'F'):
        return 'WAIT', f"WAIT: {sideways_count_placeholder(module_verdicts)} 個 module 觀望, 訊號未夠清晰, 等綠燈"

    # 6. HOLD — 偏多但未夠 buy
    if majority_state == 'UP' and confidence < 0.65 and grade in ('B', 'B+'):
        return 'HOLD', f"HOLD: 升緊但 confidence {confidence:.2f} < 0.65, 保持現速等確認"

    # 7. ADD — 已經 UP + 高 grade
    if majority_state == 'UP' and _is_grade_at_least(grade, 'A') and confidence >= 0.7:
        return 'ADD', f"ADD: {up_count} 個 module 一致上升 + grade {grade}, 已經有貨再加注"

    # 8. BUY — 預設 entry (UP + 中高 confidence)
    if majority_state == 'UP' and confidence >= 0.5:
        return 'BUY', f"BUY: {up_count} 個 module 上升, confidence {confidence:.2f}, 油門俾到底落注"

    # 兜底: WAIT
    return 'WAIT', f"WAIT (default): 訊號 mixed, 等更清晰先決定"


def sideways_count_placeholder(module_verdicts: List[Dict[str, Any]]) -> int:
    return sum(1 for v in module_verdicts if v.get('state') == 'SIDEWAYS')


# ============================================================
# Main algorithm (跟 DecisionEngine.decide() 1:1 port)
# ============================================================

class DecisionEngineAlgorithm(Algorithm):
    """M8 Decision Engine v2.0.0 (8 finalAction + Trading card + Forecast + LLM hook)
    — 大少 2026-08-20 Phase 10 backend port

    Algorithm ABC contract:
    - name: "decision_engine"
    - version: "2.0.0"
    - run(klines, options) → Verdict
    - options.synthesizerVerdict: M7 verdict (由 runner inject, chain M7 → M8)
    - options.moduleVerdicts: 6 個 module standard verdict (chain M1-M6 → M7 → M8)
    - options.marketData: 當前 market state (currentPrice + market flags)
    - options.optimalParams: M9 back test 最佳設定 (chain M9 → M8, 30 日 cache)

    凡人話: M8 拎 M7 + M9 verdict 做最終判斷, 拎 8 個 finalAction + 交易卡 + 走勢預測
    """

    name = "decision_engine"
    version = "2.0.0"

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.cfg = {**DEFAULT_DECISION_ENGINE_CONFIG, **(config or {})}

    def run(self, klines: List[Dict[str, Any]], options: Optional[Dict[str, Any]] = None) -> Verdict:
        options = options or {}
        timeframe = options.get("period", "1d")
        symbol = options.get("symbol", "TEST")

        # Chain rule: M7 verdict + M9 optimal params + M1-M6 module verdicts 由 runner inject
        sv: Dict[str, Any] = options.get("synthesizerVerdict", {}) or {}
        module_verdicts: List[Dict[str, Any]] = options.get("moduleVerdicts", [])
        market_data: Dict[str, Any] = options.get("marketData", {})
        optimal_params: Dict[str, Any] = options.get("optimalParams", {})

        # Step 0: 數據驗證
        if not sv:
            return Verdict(
                ok=True,
                points=[],
                meta={
                    "moduleId": "decision-engine",
                    "timeframe": timeframe,
                    "symbol": symbol,
                    "state": "SIDEWAYS",
                    "cycleLabel": "數據不足",
                    "confidence": 0,
                    "interpretation": "[Decision Engine v2.0.0] 數據不足: 冇 M7 synthesizer verdict (runner inject 失敗)",
                    "evidence": [],
                    "dataDays": len(klines),
                    "reason": "數據不足",
                },
                warnings=["INSUFFICIENT_DATA: 冇 synthesizerVerdict (runner 拎唔到 M7 verdict)"],
            )

        # Step 1: 拎 majority state
        majority_state = _get_majority_state(module_verdicts)

        # Step 2: 拎 weighted avg max_drawdown_estimate
        max_dd_estimate = _weighted_average([
            (v.get("max_drawdown_estimate", 0.05), v.get("base_weight", 0.1))
            for v in module_verdicts
        ]) or 0.05

        # Step 3: 拎 raw RSI
        raw_rsi = _get_raw_rsi(module_verdicts)

        # Step 4: Apply adaptive params 落 Synthesizer (M9 optimal params override)
        if optimal_params:
            sv = _apply_adaptive_params_to_synthesizer(sv, optimal_params)

        # 拎 currentPrice
        current_price = market_data.get("currentPrice", 100.0)
        expected_return = sv.get("expected_return", 0)

        # Step 5: 8 個 finalAction 決策樹
        final_action, final_action_reason = _decide_final_action(
            majority_state, module_verdicts, sv, market_data
        )

        # Step 6: Trading card 4 fields
        kelly_fraction = sv.get("kelly_fraction", "quarter")
        trading_card = _compute_trading_card(current_price, kelly_fraction, max_dd_estimate)

        # Step 7: 短期走勢 9 個 scenarios
        short_term_forecast = _compute_short_term_forecast(expected_return, max_dd_estimate)

        # Step 8: LLM hook + hardcoded template interpretation
        # Phase 10 backend sync version, 用 _hardcoded_interpretation (Sprint 2 永久 rule)
        interpretation = _hardcoded_interpretation({
            "final_action": final_action,
            "module_verdicts": module_verdicts,
            "synthesizer_verdict": sv,
            "short_term_forecast": short_term_forecast,
        })

        # Step 9: 組裝 output
        # 凡人話: M8 verdict 永久 embed M9 optimal_params (跟 AS-03 chain rule, 撳 M8 即刻見到 M9 拎咩 optimal 設定)
        optimal_data = {
            "bestParams": optimal_params,
            "source": "backend (Phase 10 M8 chain, M9 optimal → M8 apply)",
            "timestamp": None,
        } if optimal_params else None

        meta = {
            "moduleId": "decision-engine",
            "timeframe": timeframe,
            "symbol": symbol,
            "state": majority_state,
            "cycleLabel": f"{final_action} ({majority_state})",
            "confidence": round(sv.get("confidence", 0), 4),
            "interpretation": interpretation,
            "evidence": [
                {"type": "final_action", "label": f"Final Action: {final_action}", "value": final_action, "passed": final_action not in ('TRAP', 'WAIT')},
                {"type": "grade", "label": f"Grade: {sv.get('grade', 'F')}", "value": sv.get('grade', 'F'), "passed": _is_grade_at_least(sv.get('grade', 'F'), 'B')},
                {"type": "kelly", "label": f"Kelly: {kelly_fraction} ({sv.get('kelly_numeric', 0.25) * 100:.1f}%)", "value": kelly_fraction, "passed": True},
                {"type": "rsi", "label": f"RSI: {raw_rsi:.1f}", "value": round(raw_rsi, 1), "passed": 30 <= raw_rsi <= 70},
            ],
            "dataDays": len(klines),
            "configUsed": self.cfg,
            "reason": interpretation,
            # M8 8 個永久 rule output
            "final_action": final_action,
            "final_action_reason": final_action_reason,
            "trading_card": trading_card,
            "short_term_forecast": short_term_forecast,
            "module_verdicts": module_verdicts,
            "synthesizer_verdict": sv,
            "optimal_data": optimal_data,
            "max_drawdown_estimate": round(max_dd_estimate, 4),
        }

        warnings: List[str] = []
        if not module_verdicts:
            warnings.append("INSUFFICIENT_DATA: 0 module verdicts (runner 拎唔到 M1-M6 verdict)")
        if not optimal_params:
            warnings.append("OPTIMAL_PARAMS_MISSING: 冇 M9 optimal params (M9 cache 過期 / 冇跑, M8 用 Synthesizer default Kelly)")

        return Verdict(ok=True, points=[], meta=meta, warnings=warnings)


# Register
register(DecisionEngineAlgorithm())

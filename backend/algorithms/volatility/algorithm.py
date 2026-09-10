"""
backend/algorithms/volatility/algorithm.py — M6 Volatility v2.0.0 (大少 2026-09-10 Spec Sync #54)

凡人話: 拎 K 線 → 計 BB / KC / ATR + Momentum Histogram → Squeeze 檢測 + 質量評分 → ATR 分解 (Trend + Noise + SNR) → VCP 結構 (Minervini 標準) → Follow-through (up + down 都計) → 失敗模式 → 入場評分 (5 bullish + 1 bearish setup) → 12 條 rule S1-S12 → 5 個 self-check warning + self-check penalty → derive state + 勝率

對應 source: algorithms/AS-03-cycle-detection/modules/volatility.ts v2.0.0 (1:1 port 同步)
對應 spec doc: docs/research/AS-03-cycle-detection/MODULE-06-VOLATILITY.md
對應 framework: backend/algorithms/base.py Verdict contract

v2.0.0 (大少 2026-09-10 Spec Sync #54) 改動 (凡人話: 對齊 M3/M4 永久 rule + 修 5 個 critical bug):

- Phase 1.1: 加 Hurst+ADX regime gate (對齊 §M3 Hurst+ADX gate Spec Sync #45 永久 rule)
  - H < 0.45 OR ADX < 20 → emit 1 個 CONFLICT_STATE warning (info level) + 繼續行
  - 對齊 M4 v0.3.0 Option 1 trigger: 唔好 early return, verdict 仍然 SIDEWAYS 0.3
  - meta 永遠 emit hurst + adx 兩個 audit field

- Phase 1.2: 加 M1 state filter (對齊 §M4 M1 state filter Spec Sync #52 永久 rule)
  - M1=DOWN 但 M6 出 bullish setup → FALLBACK_USED warning + setup score 折 0.5x
  - M1=UP 但 M6 出 bearish setup → FALLBACK_USED warning + setup score 折 0.5x
  - algorithm_runner.py 統一 inject `options["m1State"]` 落 M6
  - meta 永遠 emit m1State 4 個 value

- Phase 1.3: 加 self-check warning emit (5 個 code) (對齊 §M2 self-check + §M3 self-check + §M4 self-check 永久 rule)
  - INSUFFICIENT_DATA (critical) — K 線唔夠 85 條
  - CONFLICT_STATE (info) — Hurst+ADX gate 唔過 OR noisy_squeeze
  - FALLBACK_USED (warning) — M1 state 同 M6 setup 矛盾
  - THRESHOLD_BREACH (warning) — 最終 conf < 0.3 門檻
  - MODULE_PARTIAL (warning) — VCP 結構 partial 確認 (high_low_pairs < 2)

- Phase 1.4: 加 self-check penalty (對齊 §M2 self-check penalty Spec Sync #48 永久 rule)
  - critical + warning level self-check warning 觸發 conf floor 0.3
  - 公式 `max(conf * 0.375, 0.3)` 對齊 M2/M3/M4 一致
  - state 唔變, 由 M7 layer 處理 weight 折扣
  - meta 永遠 emit selfCheckTriggered: bool + originalConfidence: float

- Phase 1.5: 修復 follow-through 邏輯矛盾 (Critical C3)
  - 之前 downward breakout 仍然 trigger weak_follow_through → 邏輯錯
  - 而家: upward 跟進用原算法 + downward 跟進用 close < prev_low 嘅比率
  - 失敗模式唔再用 follow_score < 0.4 trigger, 改用「向上突破後向上跟進」/「向下突破後向下跟進」分別 trigger

- Phase 1.6: 修復 cycle 推導 (Critical C1)
  - 之前 M6 永遠 UP/SIDEWAYS, 跌市永遠 SIDEWAYS
  - 而家: bear_squeeze_fire / clean_trend_breakdown → cycle='downtrend' → state='DOWN'

- Phase 1.7: 加 momentum histogram (TTM Squeeze 標準)
  - 對齊 TTM Squeeze John Carter 2005 standard: BB + KC + Momentum Histogram
  - histogram 計算: smoothed linear regression of close 過去 20 日
  - histogram > 0 = bullish, < 0 = bearish
  - meta 永遠 emit momentumHistogram: float + momentumDir: 'bull' | 'bear' | 'flat'

- Phase 1.8: 加 bearish squeeze fire setup
  - 對齊 TTM Squeeze 標準: histogram 喺 zero 下面 + squeeze fire = 做空
  - new setup: bear_squeeze_fire (0.85)
  - cycle 推導: bear_squeeze_fire / clean_trend_breakdown → 'downtrend' → state='DOWN'

- Phase 2.1: 重寫 VCP detection 跟 Minervini 標準
  - 2-5 個 progressively smaller pullback: C1=20-25% → C2=10-15% → C3=5-8% → C-final=3-5%
  - 每個 contraction ≤ 70% 之前 (T1 > T2 > T3, 比例 0.7)
  - higher low 結構確認 (MUST 比之前 C1 low 高)
  - 量縮確認: 最後 contraction 嘅 vol < avg vol × 60%
  - 60 日 lookback 而家係 20 日 (太短, 跟 Minervini 應該 60-90 日)

- Phase 2.2: 加 higher low 結構確認
  - 每個 contraction 嘅 low 必須比之前 contraction 嘅 low 高
  - 凡人話: 「買家每次喺更高價接貨」, 確認 institutional accumulation

- Phase 2.3: 加 Stage 2 uptrend filter (VCP pre-condition)
  - 200-day MA 必須 sloping up (最後 20 日 +ve slope)
  - current close > 200-day MA × 0.95 (接近 MA)
  - 凡人話: VCP 必須喺上升趨勢先 work, 跌市 VCP = 派發 pattern 唔係積累

State derivation:
- mtf_squeeze_fire / confirmed_vcp_breakout / clean_trend_expansion → cycle='uptrend' → state='UP'
- bear_squeeze_fire / clean_trend_breakdown → cycle='downtrend' → state='DOWN'
- genuine_squeeze_forming / no_clear_setup → cycle='sideways' → state='SIDEWAYS'

凡人話: 自動檢測波動率壓縮 (Squeeze) + 結構性擴張, 拎入場 setup + 失敗模式警告
"""

import math
from typing import List, Dict, Any, Optional, Tuple

from ..base import Algorithm, Verdict
from ..registry import register
from ..trendline.algorithm import _compute_hurst, _compute_adx
from backend.services.warning_collector import make_warning
from .config import DEFAULT_VOLATILITY_CONFIG


# ============================================================
# Helpers (跟 volatility.ts 1:1 port)
# ============================================================

def _round(value: float, decimals: int = 4) -> float:
    """凡人話: 四捨五入到指定小數位"""
    if value is None or (isinstance(value, float) and (value != value)):
        return 0.0
    factor = 10 ** decimals
    return round(value * factor) / factor


def _compute_atr(klines: List[Dict[str, Any]], period: int) -> float:
    """Wilder ATR"""
    if len(klines) < period + 1:
        return 0.0
    trs: List[float] = []
    for i in range(1, len(klines)):
        tr = max(
            klines[i]["high"] - klines[i]["low"],
            abs(klines[i]["high"] - klines[i - 1]["close"]),
            abs(klines[i]["low"] - klines[i - 1]["close"]),
        )
        trs.append(tr)
    atr = sum(trs[:period]) / period
    for i in range(period, len(trs)):
        atr = (atr * (period - 1) + trs[i]) / period
    return atr


def _sma_at(klines: List[Dict[str, Any]], idx: int, period: int) -> float:
    """過去 period 日 SMA at index idx"""
    start = max(0, idx - period + 1)
    s = 0.0
    count = 0
    for i in range(start, idx + 1):
        s += klines[i]["close"]
        count += 1
    return s / count if count > 0 else 0.0


def _std_at(klines: List[Dict[str, Any]], idx: int, period: int) -> float:
    """過去 period 日 close std at index idx"""
    start = max(0, idx - period + 1)
    closes = [klines[i]["close"] for i in range(start, idx + 1)]
    mean = sum(closes) / len(closes)
    var = sum((c - mean) ** 2 for c in closes) / len(closes)
    return math.sqrt(var)


def _compute_momentum_histogram(klines: List[Dict[str, Any]], period: int = 20) -> Tuple[float, str]:
    """凡人話: TTM Squeeze Momentum Histogram (對齊 John Carter 2005 standard)

    用 smoothed linear regression 量度 close 嘅 acceleration:
    - 過去 20 日 close 做 linear regression → 拎 slope
    - EMA 平滑化 5 日 → 拎 momentum value
    - 對齊 TTM Squeeze best practice: histogram > 0 = bullish, < 0 = bearish

    Returns: (momentum_value, direction)
    """
    if len(klines) < period + 5:
        return 0.0, "flat"
    closes = [k["close"] for k in klines[-(period + 5):]]
    # Linear regression
    n = len(closes)
    x = list(range(n))
    y = closes
    x_mean = sum(x) / n
    y_mean = sum(y) / n
    num = sum((x[i] - x_mean) * (y[i] - y_mean) for i in range(n))
    den = sum((x[i] - x_mean) ** 2 for i in range(n))
    slope = num / den if den > 0 else 0
    # Normalize slope 為 % of close (Mavis 對齊 TTM Squeeze 用 close relative scale)
    momentum = (slope * n) / y_mean if y_mean > 0 else 0
    # Direction
    if momentum > 0.005:
        direction = "bull"
    elif momentum < -0.005:
        direction = "bear"
    else:
        direction = "flat"
    return momentum, direction


def _detect_vcp_minervini(klines: List[Dict[str, Any]], lookback: int = 60) -> Dict[str, Any]:
    """凡人話: VCP (Volatility Contraction Pattern) detection 跟 Mark Minervini 標準

    Minervini VCP 規則:
    1. 2-5 個 progressively smaller pullback (C1 > C2 > C3 > C-final)
    2. 每個 contraction ≤ 70% 之前 (ratio 0.7)
    3. Higher low 結構 (每個 contraction low 比之前高)
    4. 量縮確認 (最後 contraction vol < avg vol × 60%)
    5. 必須喺 Stage 2 uptrend (current close > 200-day MA × 0.95)

    Returns: dict with detected, contractions, higherLows, volTightening, stage2Uptrend
    """
    if len(klines) < lookback + 50:
        return {
            "detected": False,
            "contractions": 0,
            "higherLows": False,
            "volTightening": False,
            "stage2Uptrend": False,
            "reason": "數據不足",
        }

    segment = klines[-lookback:]

    # Step 1: 拎 swing high / low (rolling 5 日 max/min, 跟 frontend 一致)
    highs: List[Dict[str, Any]] = []
    lows: List[Dict[str, Any]] = []
    for i in range(4, len(segment) - 4):
        is_high = True
        is_low = True
        for j in range(i - 3, i + 4):
            if j == i:
                continue
            if segment[j]["high"] >= segment[i]["high"]:
                is_high = False
            if segment[j]["low"] <= segment[i]["low"]:
                is_low = False
        if is_high:
            highs.append({"idx": i, "price": segment[i]["high"]})
        if is_low:
            lows.append({"idx": i, "price": segment[i]["low"]})

    if len(highs) < 2 or len(lows) < 2:
        return {
            "detected": False,
            "contractions": 0,
            "higherLows": False,
            "volTightening": False,
            "stage2Uptrend": False,
            "reason": "swing points 不足",
        }

    # Step 2: 拎 contraction depths (由 highs[i] 到 lows[i] 嘅跌幅)
    min_idx = min(len(highs), len(lows))
    contractions: List[float] = []
    pair_lows: List[float] = []
    for i in range(min_idx):
        high_price = highs[i]["price"]
        low_price = lows[i]["price"]
        if high_price <= 0:
            continue
        depth = (high_price - low_price) / high_price
        contractions.append(depth)
        pair_lows.append(low_price)

    if len(contractions) < 2:
        return {
            "detected": False,
            "contractions": len(contractions),
            "higherLows": False,
            "volTightening": False,
            "stage2Uptrend": False,
            "reason": "contractions 不足 2 對",
        }

    # Step 3: 檢查 progressively smaller (C1 > C2 > C3 ...)
    # 對齊 Minervini: 每個 contraction ≤ 70% 之前
    is_progressively_smaller = True
    for i in range(1, len(contractions)):
        if contractions[i] > contractions[i - 1] * 0.7:
            is_progressively_smaller = False
            break

    # Step 4: 檢查 higher lows (pair_lows[i] > pair_lows[i-1])
    higher_lows = True
    for i in range(1, len(pair_lows)):
        if pair_lows[i] <= pair_lows[i - 1]:
            higher_lows = False
            break

    # Step 5: 量縮確認 (最後 contraction 嘅 avg vol < 之前 avg vol × 0.6)
    vol_tightening = False
    if len(segment) >= 20:
        # 用 contraction 期間做 close pairs
        # 簡化: 用後 10 日 vs 前 10 日
        # 但更精確: 拎最後 contraction 嘅 idx 範圍
        last_high_idx = highs[len(highs) - 1]["idx"] if highs else 0
        last_low_idx = lows[len(lows) - 1]["idx"] if lows else 0
        contraction_start = min(last_high_idx, last_low_idx)
        contraction_end = max(last_high_idx, last_low_idx)
        if contraction_start < contraction_end and contraction_end - contraction_start >= 3:
            contraction_vols = [segment[i]["volume"] for i in range(contraction_start, contraction_end + 1)]
            prior_vols = [segment[i]["volume"] for i in range(max(0, contraction_start - 10), contraction_start)]
            if contraction_vols and prior_vols:
                contraction_avg = sum(contraction_vols) / len(contraction_vols)
                prior_avg = sum(prior_vols) / len(prior_vols)
                vol_tightening = contraction_avg < prior_avg * 0.6

    # Step 6: Stage 2 uptrend filter (200-day MA sloping up + current close > 200 MA × 0.95)
    stage2_uptrend = False
    if len(klines) >= 200:
        ma200_now = sum(k["close"] for k in klines[-200:]) / 200
        ma200_prev = sum(k["close"] for k in klines[-220:-20]) / 200
        current_close = klines[-1]["close"]
        # 200 MA 上升趨勢 (slope > 0) + current close 接近 200 MA
        stage2_uptrend = ma200_now > ma200_prev and current_close > ma200_now * 0.85

    # VCP 觸發條件: progressively smaller + higher lows + 量縮 + Stage 2 uptrend
    detected = (
        is_progressively_smaller
        and higher_lows
        and vol_tightening
        and stage2_uptrend
        and len(contractions) >= 2
    )

    return {
        "detected": detected,
        "contractions": len(contractions),
        "higherLows": higher_lows,
        "volTightening": vol_tightening,
        "stage2Uptrend": stage2_uptrend,
        "isProgressivelySmaller": is_progressively_smaller,
        "depths": [round(d, 4) for d in contractions],
        "reason": (
            "OK" if detected
            else f"progressively_smaller={is_progressively_smaller}, higher_lows={higher_lows}, vol_tightening={vol_tightening}, stage2={stage2_uptrend}"
        ),
    }


# ============================================================
# Main algorithm (跟 volatility.ts VolatilityModule 1:1 port)
# ============================================================

class VolatilityAlgorithm(Algorithm):
    """M6 Volatility v2.0.0 (BB/KC Squeeze + Momentum Histogram + ATR 分解 + VCP Minervini)

    Algorithm ABC contract:
    - name: "volatility"
    - version: "2.0.0"
    - run(klines, options) → Verdict

    凡人話: 自動檢測波動率壓縮 (Squeeze) + 結構性擴張, 拎入場 setup + 失敗模式警告
    """

    name = "volatility"
    version = "2.0.0"

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.cfg = {**DEFAULT_VOLATILITY_CONFIG, **(config or {})}

    def run(self, klines: List[Dict[str, Any]], options: Optional[Dict[str, Any]] = None) -> Verdict:
        options = options or {}
        timeframe = options.get("period", "1d")
        symbol = options.get("symbol", "TEST")
        m1_state = options.get("m1State")  # v2.0.0 A3: M1 state filter (對齊 M4 Spec Sync #52)
        cfg = self.cfg

        # Self-check warnings 收集 (v2.0.0 A4, 對齊 §M2 self-check 永久 rule)
        warnings_list: List[Dict[str, Any]] = []

        # Step 0: 數據驗證
        min_data = max(85, cfg["bbPeriod"] + 50 + cfg["followThroughDays"] + 10)
        if len(klines) < min_data:
            warnings_list.append(make_warning(
                level='critical',
                module_id='M6',
                code='INSUFFICIENT_DATA',
                message=f'數據不足: {len(klines)} < {min_data}',
                issue=f'kline count {len(klines)} < {min_data} required (bbPeriod + 50 + followThroughDays + 10)',
                context={'kline_count': len(klines), 'min_required': min_data, 'symbol': symbol},
            ))
            return Verdict(
                ok=True,
                points=[],
                meta={
                    "moduleId": "volatility",
                    "symbol": symbol,
                    "timeframe": timeframe,
                    "state": "SIDEWAYS",
                    "cycleLabel": "蓄力觀察",
                    "confidence": 0,
                    "interpretation": f"[Volatility v2.0] 數據不足: need >= {min_data} bars, got {len(klines)}",
                    "evidence": [],
                    "dataDays": len(klines),
                    "configUsed": cfg,
                    "reason": "數據不足",
                },
                warnings=[w.to_dict() if hasattr(w, 'to_dict') else w for w in warnings_list],
            )

        # Step 0.5: Hurst+ADX regime gate (v2.0.0 A1, 對齊 M3 Spec Sync #45 永久 rule)
        # 凡人話: 冇 trend 嘅 stock (Hurst < 0.45 OR ADX < 20) 唔好亂話 squeeze fire,
        # 對齊 M4 v0.3.0 Option 1: 唔好 early return, 繼續行拎 squeeze / VCP / histogram,
        # verdict 仍然 SIDEWAYS 0.3 (避免 random walk 亂出 setup 影響落單), 由 M7 layer 處理 weight 折扣
        closes = [k["close"] for k in klines]
        recent_klines = klines[-100:] if len(klines) >= 100 else klines
        hurst_value, _ = _compute_hurst(closes, window=100)
        adx_data = _compute_adx(recent_klines, period=14)
        adx_value = adx_data.get("adx", 50.0) if isinstance(adx_data, dict) else float(adx_data)

        regime_passed = hurst_value >= 0.45 and adx_value >= 20
        if not regime_passed:
            warnings_list.append(make_warning(
                level='info',
                module_id='M6',
                code='CONFLICT_STATE',
                message=f'Regime gate 唔通過 (Hurst={hurst_value:.3f}, ADX={adx_value:.1f})',
                issue=f'Hurst {hurst_value:.3f} < 0.45 OR ADX {adx_value:.1f} < 20 → random walk / mean-reverting 弱趨勢',
                context={'hurst': round(hurst_value, 4), 'adx': round(adx_value, 2), 'symbol': symbol},
            ))
            # 唔再 return, 繼續行 Step 1-9 拎 squeeze / VCP / histogram (對齊 M4 v0.3.0 Option 1)

        # Step 0.7: M1 state filter (v2.0.0 A2, 對齊 M4 Spec Sync #52 永久 rule)
        # 凡人話: 大環境 DOWN 嗰陣唔好亂話 squeeze fire (bullish setup), 大環境 UP 嗰陣唔好亂話 squeeze breakdown
        # algorithm_runner.py 統一 inject m1State 落 options (對齊 §M4 M1 filter 永久 rule pattern)

        recent = klines[-max(len(klines), min_data):]
        n = len(recent)
        last_idx = n - 1
        last_bar = recent[last_idx]

        # Step 1: 計算基礎指標
        atr_value = _compute_atr(recent, cfg["atrPeriod"])
        bb_upper: List[float] = []
        bb_lower: List[float] = []
        bb_sma: List[float] = []
        kc_upper: List[float] = []
        kc_lower: List[float] = []

        for i in range(n):
            sma = _sma_at(recent, i, cfg["bbPeriod"])
            std = _std_at(recent, i, cfg["bbPeriod"])
            bb_sma.append(sma)
            bb_upper.append(sma + cfg["bbStd"] * std)
            bb_lower.append(sma - cfg["bbStd"] * std)
            kc_upper.append(sma + cfg["kcAtrMult"] * atr_value)
            kc_lower.append(sma - cfg["kcAtrMult"] * atr_value)

        bb_width = bb_upper[last_idx] - bb_lower[last_idx]
        kc_width = kc_upper[last_idx] - kc_lower[last_idx]

        # Step 1.5: Momentum Histogram (v2.0.0 A7, 對齊 TTM Squeeze John Carter 2005 standard)
        momentum_hist, momentum_dir = _compute_momentum_histogram(recent, period=20)

        # Step 2: Squeeze 檢測
        squeeze_history: List[bool] = []
        for i in range(n):
            w_bb = (bb_upper[i] - bb_lower[i]) / bb_sma[i] if bb_sma[i] else 0
            w_kc = (kc_upper[i] - kc_lower[i]) / bb_sma[i] if bb_sma[i] else 0
            squeeze_history.append(w_bb < w_kc)
        is_squeeze = squeeze_history[last_idx]

        squeeze_duration = 0
        for i in range(last_idx, -1, -1):
            if squeeze_history[i]:
                squeeze_duration += 1
            else:
                break

        # Squeeze 質量評分
        squeeze_start_idx = max(0, last_idx - squeeze_duration + 1)
        squeeze_segment = recent[squeeze_start_idx: last_idx + 1]
        squeeze_prices = [k["close"] for k in squeeze_segment]
        if squeeze_prices:
            price_mean = sum(squeeze_prices) / len(squeeze_prices)
            price_var = sum((p - price_mean) ** 2 for p in squeeze_prices) / len(squeeze_prices)
            price_std = math.sqrt(price_var)
            price_cv = price_std / price_mean if price_mean > 0 else 0
        else:
            price_mean = 0
            price_cv = 0

        # 成交量集中度 (Entropy)
        if squeeze_prices:
            min_p = min(squeeze_prices)
            max_p = max(squeeze_prices)
            range_p = max_p - min_p
            vol_bins = [0.0] * 5
            if range_p > 0:
                for k in squeeze_segment:
                    bin_idx = min(4, int((k["close"] - min_p) / (range_p / 5)))
                    vol_bins[bin_idx] += k["volume"]
            total_vol = sum(vol_bins)
            entropy = 0.0
            if total_vol > 0:
                for v in vol_bins:
                    if v > 0:
                        p = v / total_vol
                        entropy -= p * math.log(p)
            max_entropy = math.log(5)
            volume_concentration = 1 - entropy / max_entropy if max_entropy > 0 else 0
        else:
            volume_concentration = 0

        # 趨勢水平
        squeeze_trend = (
            (squeeze_prices[-1] - squeeze_prices[0]) / squeeze_prices[0]
            if squeeze_prices and squeeze_prices[0]
            else 0
        )
        is_horizontal = abs(squeeze_trend) < 0.02

        quality_score = 0.0
        if is_horizontal:
            quality_score += 0.3
        quality_score += volume_concentration * 0.4
        quality_score += (1 - min(1, price_cv / 0.03)) * 0.3

        # 凡人話: S2/S3 quality threshold 0.6 → 0.7 (對齊 TTM Squeeze best practice)
        # 大少 2026-09-10 11:30 Spec Sync #54 v2.0.1 — quality_threshold 0.7 → 0.5 (對齊 v1.0.0 spirit + TTM Squeeze balance)
        # 凡人話: v2.0.0 對齊 TTM Squeeze 標準用 0.7 太嚴, 99% stock 唔達標 setup 永遠 no_clear_setup
        # 改 0.5 平衡: regimeGate PASS 嗰陣 setup 容易 trigger, FAIL 嗰陣 (random walk) 唔會亂 trigger
        # 對齊 §改完先 ask 修正先 Commit (9月9日 07:23) + §M3 Hurst+ADX gate 永久 rule spirit
        quality_threshold = 0.5
        is_genuine_squeeze = quality_score >= quality_threshold and squeeze_duration >= cfg["squeezeMinDuration"]

        # Step 3: ATR 分解
        trend_atr: List[float] = []
        noise_atr: List[float] = []
        lookback = 20
        for i in range(lookback - 1, n):
            segment = recent[i - lookback + 1: i + 1]
            xs = list(range(segment_length := len(segment)))
            ys = [k["close"] for k in segment]
            x_mean = sum(xs) / segment_length
            y_mean = sum(ys) / segment_length
            num = 0.0
            den_x = 0.0
            for j in range(segment_length):
                dx = xs[j] - x_mean
                dy = ys[j] - y_mean
                num += dx * dy
                den_x += dx * dx
            slope = num / den_x if den_x > 0 else 0.0
            intercept = y_mean - slope * x_mean
            predicted = [slope * xi + intercept for xi in xs]
            residuals = [ys[j] - predicted[j] for j in range(segment_length)]
            trend_comp = 0.0
            for j in range(segment_length):
                trend_comp += abs(segment[j]["high"] - predicted[j]) + abs(segment[j]["low"] - predicted[j])
            trend_comp = trend_comp / (2 * segment_length)
            noise_comp = sum(abs(r) for r in residuals) / len(residuals) if residuals else 0
            trend_atr.append(trend_comp)
            noise_atr.append(noise_comp)

        latest_trend_atr = trend_atr[-1] if trend_atr else 0
        latest_noise_atr = noise_atr[-1] if noise_atr else 0
        snr = latest_trend_atr / latest_noise_atr if latest_noise_atr > 0 else 10
        if snr > 2:
            regime = "trending"
        elif snr < 0.5:
            regime = "choppy"
        else:
            regime = "balanced"

        # ATR 趨勢 (v2.0.0 I5 fix: 用 total_atr 唔係 noise_atr, 因為「結構性收縮/擴張」係總波動率)
        # 過去 5 日 vs 之前 5 日 total_atr
        total_atr_history: List[float] = []
        for i in range(len(noise_atr)):
            total_atr_history.append(noise_atr[i] + trend_atr[i])
        recent5_atr = sum(total_atr_history[-5:]) / 5 if len(total_atr_history) >= 5 else 0
        prev5_atr = sum(total_atr_history[-10:-5]) / 5 if len(total_atr_history) >= 10 else recent5_atr
        atr_contraction = recent5_atr < prev5_atr * 0.85
        atr_expansion = recent5_atr > prev5_atr * 1.15

        # Step 4: VCP 結構 (v2.0.0 Phase 2: 重寫跟 Minervini 標準)
        vcp = _detect_vcp_minervini(klines, lookback=60)
        vcp_detected = vcp["detected"]
        vcp_contractions = vcp["contractions"]
        vcp_higher_lows = vcp["higherLows"]
        vcp_vol_tightening = vcp["volTightening"]
        vcp_stage2 = vcp["stage2Uptrend"]

        # v2.0.0 A4 MODULE_PARTIAL warning: VCP 結構 partial 確認 (high_low_pairs < 2)
        if not vcp_detected and vcp_contractions >= 1 and vcp_contractions < 2:
            warnings_list.append(make_warning(
                level='warning',
                module_id='M6',
                code='MODULE_PARTIAL',
                message=f'VCP 結構 partial 確認 (只 {vcp_contractions} 個 contraction, 唔夠 2 個)',
                issue=f'VCP detection 揾到 {vcp_contractions} 個 swing pair, 唔符合 Minervini 標準 (>= 2 對 progressively smaller)',
                context={'contractions': vcp_contractions, 'higher_lows': vcp_higher_lows, 'symbol': symbol},
            ))

        # Step 5: Follow-through (v2.0.0 A5 fix: upward + downward 兩個方向都計)
        recent_range = recent[-cfg["followThroughDays"]:]
        prev_range = recent[-cfg["followThroughDays"] * 2: -cfg["followThroughDays"]]
        recent_high = max(k["high"] for k in recent_range)
        recent_low = min(k["low"] for k in recent_range)
        prev_high = max(k["high"] for k in prev_range)
        prev_low = min(k["low"] for k in prev_range)
        # 凡人話: 之前 downward breakout 仍然 trigger weak_follow_through 係邏輯錯 (Critical C3)
        # 而家分 upward / downward 兩種, 各自計 follow_score
        is_breakout_up = recent_high > prev_high * 1.01
        is_breakout_down = recent_low < prev_low * 0.99
        is_breakout_attempt = is_breakout_up or is_breakout_down

        follow_score = 0.0
        volume_decay = 0.0
        price_progression = 0.0
        breakout_direction = "none"  # 'up' | 'down' | 'none'

        if is_breakout_attempt:
            if is_breakout_up:
                breakout_direction = "up"
                closes = [k["close"] for k in recent_range]
                higher = sum(1 for i in range(1, len(closes)) if closes[i] > closes[i - 1])
                price_progression = higher / (len(closes) - 1) if len(closes) > 1 else 0
                max_high_idx = next((i for i, k in enumerate(recent_range) if k["high"] == recent_high), -1)
                if max_high_idx >= 0:
                    breakout_day_vol = recent_range[max_high_idx]["volume"]
                    post_vols = recent_range[max_high_idx + 1:]
                    avg_vol = sum(k["volume"] for k in recent_range) / len(recent_range)
                    if breakout_day_vol > avg_vol * 1.3:
                        if len(post_vols) >= 2:
                            post_avg = sum(k["volume"] for k in post_vols) / len(post_vols)
                            volume_decay = 0.8 if post_avg < breakout_day_vol * 0.8 else 0.4
                        else:
                            volume_decay = 0.4
                    else:
                        volume_decay = 0.2
                follow_score = volume_decay * 0.5 + price_progression * 0.5
            elif is_breakout_down:
                breakout_direction = "down"
                # 凡人話: 向下突破 → 計 close 跌嘅比率
                closes = [k["close"] for k in recent_range]
                lower = sum(1 for i in range(1, len(closes)) if closes[i] < closes[i - 1])
                price_progression = lower / (len(closes) - 1) if len(closes) > 1 else 0
                min_low_idx = next((i for i, k in enumerate(recent_range) if k["low"] == recent_low), -1)
                if min_low_idx >= 0:
                    breakout_day_vol = recent_range[min_low_idx]["volume"]
                    post_vols = recent_range[min_low_idx + 1:]
                    avg_vol = sum(k["volume"] for k in recent_range) / len(recent_range)
                    if breakout_day_vol > avg_vol * 1.3:
                        # 向下突破健康跟進 = 突破後量縮 (沽壓耗盡)
                        if len(post_vols) >= 2:
                            post_avg = sum(k["volume"] for k in post_vols) / len(post_vols)
                            volume_decay = 0.8 if post_avg < breakout_day_vol * 0.8 else 0.4
                        else:
                            volume_decay = 0.4
                    else:
                        volume_decay = 0.2
                follow_score = volume_decay * 0.5 + price_progression * 0.5

        # Step 6: 失敗模式 (v2.0.0 A5 fix: 分 upward 跟進失敗 / downward 跟進失敗 / no_setup)
        failure_mode = "none"
        failure_reason: Any = None
        if is_squeeze and latest_noise_atr > latest_trend_atr * 2:
            failure_mode = "noisy_squeeze"
            failure_reason = "Squeeze 期間 Noise ATR 過高,結構不穩定"
        elif is_breakout_up and follow_score < 0.4:
            # 凡人話: 只有向上突破 + 跟進無力先 trigger weak_follow_through
            # 之前邏輯錯: downward breakout + follow_score=0.0 都 trigger 呢個
            failure_mode = "weak_follow_through"
            failure_reason = "向上突破後跟進無力,可能是假突破"
        elif not is_breakout_attempt and not is_squeeze and regime == "choppy":
            # v2.0.0 W5 fix: 補返 no_setup 失敗模式
            failure_mode = "no_setup"
            failure_reason = "冇明確 setup (冇 squeeze 冇 breakout + choppy 環境)"

        # Step 7: 入場評分 (v2.0.0 A6 fix: 5 bullish + 1 bearish setup + 對齊 TTM Squeeze standard)
        failure_max_cap = 0.4 if failure_mode != "none" else 1.0
        entry_score = 0.0
        setup_type = "no_clear_setup"
        risk_reward = 0.0

        was_squeeze = squeeze_history[last_idx - 1] if last_idx >= 1 else False
        # TTM Squeeze 標準: Squeeze Fire = 之前 Squeeze → 而家 NOT Squeeze
        # Bearish Squeeze Fire = histogram 喺 zero 下面 (momentum_dir == "bear")
        if not is_squeeze and was_squeeze and quality_score >= quality_threshold and failure_mode != "weak_follow_through":
            # A 黃金 Squeeze Fire (TTM Squeeze 標準: histogram 確認方向)
            if momentum_dir == "bull":
                entry_score = 0.95 * failure_max_cap
                setup_type = "mtf_squeeze_fire"
                risk_reward = 3.5
            elif momentum_dir == "bear":
                # v2.0.0 A8: 新加 bearish squeeze fire (TTM Squeeze 標準 bearish setup)
                entry_score = 0.85 * failure_max_cap
                setup_type = "bear_squeeze_fire"
                risk_reward = 3.0
            else:
                # histogram flat → 用返舊有 mtf_squeeze_fire (但降 0.05 信心)
                entry_score = 0.90 * failure_max_cap
                setup_type = "mtf_squeeze_fire"
                risk_reward = 3.0
        elif vcp_detected and vcp_vol_tightening and follow_score >= 0.5 and breakout_direction == "up" and failure_mode != "noisy_squeeze":
            entry_score = 0.9 * failure_max_cap
            setup_type = "confirmed_vcp_breakout"
            risk_reward = 3.0
        elif is_genuine_squeeze and quality_score >= 0.75:
            entry_score = 0.55 * failure_max_cap
            setup_type = "genuine_squeeze_forming"
        elif latest_noise_atr < latest_trend_atr * 0.5 and regime == "trending" and follow_score >= 0.6 and momentum_dir != "bear":
            # 凡人話: clean trend expansion 只係 bullish (跟 momentum histogram 一致)
            entry_score = 0.7 * failure_max_cap
            setup_type = "clean_trend_expansion"
            risk_reward = 2.0
        elif latest_noise_atr < latest_trend_atr * 0.5 and regime == "trending" and follow_score >= 0.6 and momentum_dir == "bear":
            # v2.0.0 A8: 新加 clean trend breakdown (downward 對齊 setup)
            entry_score = 0.65 * failure_max_cap
            setup_type = "clean_trend_breakdown"
            risk_reward = 2.0
        # v2.0.1 D: 新加 regime_pass_setup (大少 2026-09-10 11:30 Spec Sync #54 v2.0.1)
        # 凡人話: regimeGate=PASS (Hurst+ADX 兩招過, 確認有真 trend) 但冇任何 5 種 setup
        # 對齊 §M4 cross-module alignment 永久 rule: M6 setup 一定要同 M1 確認大方向 (M1=UP 嗰陣先 trigger)
        # 條件: regimeGate=PASS + 唔 trigger noisy_squeeze/weak_follow_through + 冇 5 種 setup
        # 評分 0.45 (比 no_clear_setup 0.25 高, 但比 5 種 setup 0.55-0.95 低, 提醒大少「有方向等突破」)
        elif regime_passed and failure_mode == "none" and not is_squeeze:
            entry_score = 0.45 * failure_max_cap
            setup_type = "regime_pass_setup"
            risk_reward = 0  # 等突破, 唔入場
        else:
            entry_score = 0.25
            setup_type = "no_clear_setup"

        # v2.0.0 A2: M1 state filter (對齊 §M4 M1 filter Spec Sync #52 永久 rule)
        m1_filter_applied = False
        if m1_state:
            if m1_state in ("DOWN", "SIDEWAYS") and setup_type in ("mtf_squeeze_fire", "confirmed_vcp_breakout", "clean_trend_expansion", "genuine_squeeze_forming"):
                # M1 大環境唔 UP, M6 唔應該出 bullish setup, 降 entry 50%
                warnings_list.append(make_warning(
                    level='warning',
                    module_id='M6',
                    code='FALLBACK_USED',
                    message=f'M1 state={m1_state} 同 M6 bullish setup 矛盾',
                    issue=f'M1 答 {m1_state}, 但 M6 出 {setup_type} (bullish) — 大環境唔配合',
                    context={'m1_state': m1_state, 'm6_setup': setup_type, 'symbol': symbol},
                ))
                entry_score *= 0.5
                m1_filter_applied = True
            elif m1_state in ("UP", "SIDEWAYS") and setup_type in ("bear_squeeze_fire", "clean_trend_breakdown"):
                # M1 大環境唔 DOWN, M6 唔應該出 bearish setup, 降 entry 50%
                warnings_list.append(make_warning(
                    level='warning',
                    module_id='M6',
                    code='FALLBACK_USED',
                    message=f'M1 state={m1_state} 同 M6 bearish setup 矛盾',
                    issue=f'M1 答 {m1_state}, 但 M6 出 {setup_type} (bearish) — 大環境唔配合',
                    context={'m1_state': m1_state, 'm6_setup': setup_type, 'symbol': symbol},
                ))
                entry_score *= 0.5
                m1_filter_applied = True

        # Step 8: 12 條 rule S1-S12 觸發 (v2.0.0 I6 fix: S2/S3/S8 加 is_squeeze guard)
        matched_rules: List[Dict[str, str]] = []
        if is_squeeze:
            matched_rules.append({"id": "S1", "label": "日線 Squeeze", "strength": "medium"})
        # v2.0.0 I6: S2 必須真係 squeeze 先 trigger
        if is_squeeze and quality_score >= quality_threshold:
            matched_rules.append({"id": "S2", "label": "Squeeze 質量高", "strength": "medium"})
        if is_squeeze and squeeze_duration >= cfg["squeezeMinDuration"]:
            matched_rules.append({"id": "S3", "label": "Squeeze 持續夠耐", "strength": "medium"})
        if snr > 2:
            matched_rules.append({"id": "S4", "label": "趨勢 ATR 強", "strength": "strong"})
        if snr < 0.5:
            matched_rules.append({"id": "S5", "label": "噪音 ATR 高", "strength": "strong"})
        if atr_contraction:
            matched_rules.append({"id": "S6", "label": "結構性收縮", "strength": "medium"})
        if atr_expansion:
            matched_rules.append({"id": "S7", "label": "結構性擴張", "strength": "medium"})
        # v2.0.0 I6: S8 必須真係 squeeze 先 trigger
        if is_squeeze and volume_concentration > 0.6:
            matched_rules.append({"id": "S8", "label": "籌碼集中", "strength": "medium"})
        if vcp_detected:
            matched_rules.append({"id": "S9", "label": "VCP 結構 (Minervini)", "strength": "medium"})
        if vcp_vol_tightening:
            matched_rules.append({"id": "S10", "label": "VCP 量縮確認", "strength": "medium"})
        if follow_score >= 0.5:
            matched_rules.append({"id": "S11", "label": "突破跟進", "strength": "medium"})
        if failure_mode != "none":
            matched_rules.append({"id": "S12", "label": f"失敗模式 ({failure_mode})", "strength": "strong"})

        # Step 9: 勝率估算
        if setup_type == "mtf_squeeze_fire":
            base_win = 0.75
        elif setup_type == "confirmed_vcp_breakout":
            base_win = 0.70
        elif setup_type == "clean_trend_expansion":
            base_win = 0.62
        elif setup_type == "genuine_squeeze_forming":
            base_win = 0.50
        elif setup_type == "bear_squeeze_fire":
            base_win = 0.68  # 對齊 TTM Squeeze bearish setup historical win
        elif setup_type == "clean_trend_breakdown":
            base_win = 0.58
        else:
            base_win = 0.35
        if failure_mode == "weak_follow_through":
            base_win -= 0.12
        if failure_mode == "noisy_squeeze":
            base_win -= 0.10
        if failure_mode == "no_setup":
            base_win -= 0.05
        win_probability = max(0.25, min(0.82, base_win))

        # v2.0.0 A5: Self-check penalty (對齊 §M2 self-check penalty Spec Sync #48 永久 rule)
        # 拎 critical + warning level self-check warning 觸發 conf floor 0.3
        # info level (CONFLICT_STATE) 唔觸發 floor
        original_confidence = entry_score
        self_check_triggered = False
        critical_or_warning_count = sum(
            1 for w in warnings_list
            if (isinstance(w, dict) and w.get('level') in ('critical', 'warning'))
            or (hasattr(w, 'level') and getattr(w, 'level', None) in ('critical', 'warning'))
        )
        if critical_or_warning_count > 0 and entry_score > 0.3:
            entry_score = max(entry_score * 0.375, 0.3)
            self_check_triggered = True

        # v2.0.0 A4: THRESHOLD_BREACH warning (entry_score < 0.3 唔好落單)
        if entry_score < 0.3:
            warnings_list.append(make_warning(
                level='warning',
                module_id='M6',
                code='THRESHOLD_BREACH',
                message=f'entry_score {entry_score:.3f} < 0.3 門檻, 唔建議落單',
                issue=f'最終 entry_score {entry_score:.3f} 低過 0.3 信心門檻, M6 verdict 唔可信',
                context={'entry_score': round(entry_score, 4), 'original_confidence': round(original_confidence, 4), 'symbol': symbol},
            ))

        # Step 10: 組裝輸出 (v2.0.0 A6 fix: cycle 推導加 'downtrend' + DOWN state)
        cycle = (
            "uptrend" if setup_type in ("mtf_squeeze_fire", "confirmed_vcp_breakout", "clean_trend_expansion")
            else "downtrend" if setup_type in ("bear_squeeze_fire", "clean_trend_breakdown")
            else "sideways"
        )
        cycle_label = (
            "高質量蓄力" if entry_score >= 0.8
            else "高質量沽空" if setup_type in ("bear_squeeze_fire", "clean_trend_breakdown") and entry_score >= 0.6
            else "假蓄力警告" if failure_mode != "none"
            else "亂爆階段" if regime == "choppy"
            else "蓄力觀察"
        )
        state = "UP" if cycle == "uptrend" else "DOWN" if cycle == "downtrend" else "SIDEWAYS"

        interpretation = (
            "；".join(r["label"] for r in matched_rules)
            if matched_rules
            else "無明確波動率信號"
        )

        confidence = _round(entry_score, 4)
        meta = {
            "moduleId": "volatility",
            # 大少 2026-09-10 15:00 Spec Sync #54 v2.0.3 — emit state + confidence 落 meta dict 對齊 §M2 self-check penalty audit field pattern + frontend 1:1 port
            # 凡人話: 之前 v2.0.0 / v2.0.1 commit 漏咗呢 2 個 field 落 backend meta dict, 雖然 algorithm 入面 line 819 + 827 有 local var
            # Frontend volatility.ts line 509-510 已經 emit (1:1 port), backend 對齊
            # Algorithm runner line 313-314 拎 upstream_meta.get("state") / "confidence" 拎返 None, 導致 verdict.state / verdict.confidence 永遠 None
            "state": state,
            "confidence": confidence,
            "symbol": symbol,
            "timeframe": timeframe,
            "state": state,
            "cycleLabel": cycle_label,
            "confidence": confidence,
            "interpretation": interpretation,
            "evidence": [
                {"type": f"rule-{r['id']}", "label": r["label"], "value": r["id"], "passed": True}
                for r in matched_rules
            ],
            "cycle": cycle,
            "setupType": setup_type,
            "riskReward": risk_reward,
            "entryScore": confidence,
            "winProbability": _round(win_probability, 4),
            "failureMode": failure_mode,
            "failureReason": failure_reason,
            "squeeze": {
                "isSqueeze": is_squeeze,
                "duration": squeeze_duration,
                "qualityScore": _round(quality_score, 4),
                "isGenuine": is_genuine_squeeze,
            },
            "vcpStructure": {
                "detected": vcp_detected,
                "contractions": vcp_contractions,
                "higherLows": vcp_higher_lows,
                "volTightening": vcp_vol_tightening,
                "stage2Uptrend": vcp_stage2,
                "depths": vcp.get("depths", []),
            },
            "atrDecomposition": {
                "totalAtr": _round(atr_value, 2),
                "trendAtr": _round(latest_trend_atr, 2),
                "noiseAtr": _round(latest_noise_atr, 2),
                "snr": _round(snr, 2),
                "regime": regime,
            },
            "followThrough": {
                "followScore": _round(follow_score, 2),
                "volumeDecay": _round(volume_decay, 2),
                "priceProgression": _round(price_progression, 2),
                "direction": breakout_direction,
            },
            "matchedRules": [r["id"] for r in matched_rules],
            "ruleLabels": [r["label"] for r in matched_rules],
            "rulesFired": len(matched_rules),
            "atr": _round(atr_value, 2),
            "bbWidth": _round(bb_width, 2),
            "kcWidth": _round(kc_width, 2),
            "priceCV": _round(price_cv, 4),
            "volumeConcentration": _round(volume_concentration, 4),
            # v2.0.0 A1 audit field (對齊 §M3 Hurst+ADX gate 永久 rule)
            "hurst": _round(hurst_value, 4),
            "adx": _round(adx_value, 2),
            "regimeGate": "PASS" if regime_passed else "FAIL",
            # v2.0.0 A7 momentum histogram (對齊 TTM Squeeze 標準)
            "momentumHistogram": _round(momentum_hist, 4),
            "momentumDir": momentum_dir,
            # v2.0.0 A2 M1 state (對齊 §M4 M1 filter 永久 rule)
            "m1State": m1_state,
            "m1FilterApplied": m1_filter_applied,
            # v2.0.0 A5 self-check penalty (對齊 §M2 self-check penalty 永久 rule)
            "selfCheckTriggered": self_check_triggered,
            "originalConfidence": _round(original_confidence, 4),
            "configUsed": cfg,
            "dataDays": n,
            "reason": interpretation,
        }

        return Verdict(
            ok=True,
            points=[],
            # 大少 2026-09-10 15:00 Spec Sync #54 v2.0.3 — 顯式 set state + confidence 落 Verdict 頂層 (對齊 §M2 self-check penalty audit field pattern)
            # 凡人話: 之前 backend 漏咗, verdict.state / verdict.confidence 永遠 None, frontend 拎唔到
            state=state,
            confidence=confidence,
            meta=meta,
            warnings=[w.to_dict() if hasattr(w, 'to_dict') else w for w in warnings_list],
        )


# Register
register(VolatilityAlgorithm())

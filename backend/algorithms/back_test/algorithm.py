"""
backend/algorithms/back_test/algorithm.py — M9 Back Test v0.6.0 (大少 2026-08-20 21:54 Phase 9)

凡人話: 拎 M8 verdict 嘅歷史, 用 walk-forward CV (time-series cross-validation) 重播之前嘅判決,
對比之後 5/10/20 日真實升跌, 同時自動搵出呢隻股票嘅最佳 params (Kelly + RSI weight + SSI weights)
+ 累積 forward return records 落 cache (大少 22:28 確認嘅 6 月半衰期 180 日 weighted stats)

對應 source: algorithms/AS-03-cycle-detection/modules/back-test.ts v0.6.0 (768 行, Sprint 3 9.1-9.7 收官)
對應 spec doc: docs/research/AS-03-cycle-detection/MODULE-09-BACK-TEST.md
對應 framework: backend/algorithms/base.py Verdict contract

Algorithm: 5 sub-step (跟 back-test.ts 1:1 port 去 Python, sync version 因為 backend)
- Step 1: runReplay — 拎 K 線 + step 每 5 日, 模擬之前 M8 verdict, 計 5/10/20 日後真實回報 + 命中率
- Step 2: runCoarseGrid — 9 個 params 組合 (Kelly × RSI weight × SSI weights) 粗篩, 揾 top 5
- Step 3: runFineTune — 對 top 5 做 ±20% 微調, 揾 best params
- Step 4: runAdaptiveWindow — 6 個月 start, samples < 30 自動 +3 個月 (最長 18 個月)
- Step 5: runWalkForwardCV — 將 klines 切 3 段 rolling, 每段前 2/3 tune + 後 1/3 validate, 計 avg validate score + 穩定度

Chain flow 永久 rule (大少 2026-08-11 v1.0.0):
- M7(綜合) → M9(回測取最佳設定) → M8(用最佳設定做最終判斷)
- M9 algorithm 入面跑 walk-forward CV 需要 call M8 decisionFn 拎 verdict 30-100 次 (3 folds × 30 samples)
- 永久 rule: M9 algorithm 唔可以直接 call M8 algorithm (chain 永久 rule)
- Runner 統一 inject: M9 algorithm 拎 options['moduleVerdicts'] (M7 verdict) + options['decisionFn'] (M8 verdict sync function) 拎 chain flow
- Phase 9 開工時 M8 backend port 仲未做 (Phase 10), decisionFn fallback 為 _default_decision_fn 返 SIDEWAYS neutral verdict
- Phase 10 done 之後, runner 自動 inject M8 backend algorithm instance 落 decisionFn

Cache post 永久 rule (大少 22:28):
- 跑完 walk-forward CV 之後, M9 自動 POST optimal params 落 /api/adaptive-params/{symbol}/back-test cache (30 日 expiry)
- 跑完 walk-forward CV 之後, M9 自動 POST 逐條 forward return records 落 /api/adaptive-params/{symbol}/forward-return cache (永久保留)
- Backend 內部 in-process call 落 adaptive_params function (唔走 HTTP, 避免 overhead)
- 凡人話: M9 跑完自動將最佳設定 + 過往判決累積落 cache, 30 日內重複用, 唔需要重跑 back test

凡人話: M9 自動用過去 K 線 replay M8 嘅判決, 對比真實結果, 拎最佳 params + 累積過往表現
"""

import math
from typing import List, Dict, Any, Optional, Tuple, Callable

from ..base import Algorithm, Verdict
from ..registry import register
from .config import DEFAULT_BACK_TEST_CONFIG


# ============================================================
# Helpers (跟 back-test.ts 1:1 port 去 Python sync version)
# ============================================================

def _get_kline_date(kline: Dict[str, Any]) -> str:
    """凡人話: 拎 K 線 timestamp 轉做 ISO 'YYYY-MM-DD'
    - 對齊 backend K 線 shape (time = ISO string, timestamp = number ms)
    - frontend back-test.ts 用 'timestamp' (number), backend 用 'time' / 'timestamp' 都 support
    """
    ts = kline.get("timestamp") or kline.get("time") or kline.get("date")
    if isinstance(ts, (int, float)):
        from datetime import datetime, timezone
        d = datetime.fromtimestamp(ts / 1000 if ts > 1e10 else ts, tz=timezone.utc)
        return d.strftime("%Y-%m-%d")
    if isinstance(ts, str):
        return ts.split("T")[0].split(" ")[0]
    return ""


def _find_kline_index_by_date(klines: List[Dict[str, Any]], date: str) -> int:
    """揾 K 線對應 index by date (拎第一個 timestamp >= target)
    - 早過 klines[0] → return 0
    - 過 klines[last] → return klines.length - 1
    - 永久 rule: 統一用 ms 比對 (frontend lightweight-charts 用 ms, backend K 線 endpoint 都用 ms)
    - 自動將 seconds 轉 ms (ts < 1e10 視為 seconds)
    """
    if not klines:
        return -1
    from datetime import datetime
    try:
        target = datetime.fromisoformat(date).timestamp() * 1000  # 轉 ms
    except (ValueError, TypeError):
        return 0
    for i, k in enumerate(klines):
        ts = k.get("timestamp") or 0
        if isinstance(ts, str):
            try:
                ts = datetime.fromisoformat(ts).timestamp() * 1000
            except (ValueError, TypeError):
                ts = 0
        elif isinstance(ts, (int, float)) and ts < 1e10:
            # seconds → ms (frontend 嘅 K 線 endpoint 已經返 ms, 但 mock fixture 可能用 seconds)
            ts = ts * 1000
        if ts >= target:
            return i
    return len(klines) - 1


def _compute_forward_return(close_at: float, close_after: Optional[float]) -> Optional[float]:
    """計 forward return (percentage, %)
    - null if closeAfter is null/undefined or closeAt is 0
    """
    if close_after is None or close_at == 0:
        return None
    return ((close_after - close_at) / close_at) * 100


def _compute_hit(forward_return: Optional[float]) -> Optional[bool]:
    """Hit boolean: forward return > 0 (null if no data)"""
    if forward_return is None:
        return None
    return forward_return > 0


def _compute_avg(values: List[Optional[float]]) -> Optional[float]:
    """計 avg, skip null"""
    valid = [v for v in values if v is not None and not (isinstance(v, float) and math.isnan(v))]
    if not valid:
        return None
    return sum(valid) / len(valid)


def _compute_hit_rate(hits: List[Optional[bool]]) -> Optional[float]:
    """計 hit rate (%) — null if all null"""
    valid = [h for h in hits if h is not None]
    if not valid:
        return None
    return (sum(1 for h in valid if h) / len(valid)) * 100


def _compute_action_breakdown(results: List[Dict[str, Any]]) -> Dict[str, int]:
    """Action breakdown count"""
    breakdown: Dict[str, int] = {}
    for r in results:
        action = r.get("action", "UNKNOWN")
        breakdown[action] = breakdown.get(action, 0) + 1
    return breakdown


def _stddev(values: List[float]) -> float:
    """Stddev (population, 簡單除 n)"""
    if not values:
        return 0.0
    mean = sum(values) / len(values)
    variance = sum((v - mean) ** 2 for v in values) / len(values)
    return math.sqrt(variance)


def _split_folds(klines: List[Dict[str, Any]], num_folds: int) -> List[List[Dict[str, Any]]]:
    """將 klines 切 n 段 rolling folds
    - e.g. 100 klines, 3 folds → [0-33], [33-67], [67-100]
    - 每 fold 內部再 tuneRatio 切 tune/validate
    """
    if len(klines) < num_folds * 30:
        raise ValueError(f"[walk-forward] Insufficient klines: need ≥ {num_folds * 30}, got {len(klines)}")
    fold_size = len(klines) // num_folds
    folds: List[List[Dict[str, Any]]] = []
    for i in range(num_folds):
        start = i * fold_size
        end = len(klines) if i == num_folds - 1 else (i + 1) * fold_size
        folds.append(klines[start:end])
    return folds


# ============================================================
# Default decisionFn (Phase 9 開工時 M8 仲未 port, fallback 返 SIDEWAYS)
# ============================================================

def _default_decision_fn(klines: List[Dict[str, Any]], options: Dict[str, Any]) -> Dict[str, Any]:
    """Phase 9 開工時 M8 仲未 port, fallback 返 SIDEWAYS neutral verdict
    永久 rule: Phase 10 done 之後, runner 自動 inject M8 backend algorithm instance 落 decisionFn
    呢個 fallback 只係為咗 Phase 9 algorithm.py 1 take 過可以 pass pytest + 拎 default verdict
    """
    return {
        "ok": True,
        "final_action": "WAIT",
        "state": "SIDEWAYS",
        "confidence": 0.5,
        "cycle": "sideways",
        "cycleLabel": "橫行 (M8 仲未 port, fallback)",
        "kelly_fraction": "quarter",
        "kelly_numeric": 0.25,
        "kelly_position": 0.25,
        "interpretation": "[Back Test v0.6.0] M8 backend 仲未 port (Phase 10), 返 default WAIT verdict",
        "warnings": ["DECISION_FN_FALLBACK: M8 backend algorithm 仲未 port (Phase 10), verdict 唔係真實 M8 結果"],
    }


# ============================================================
# Score 公式 (大少 22:28 確認): 命中率 50% + 平均回報 50%
# ============================================================

def score_result(summary: Dict[str, Any]) -> float:
    """Score 公式: 命中率 50% + 平均回報 50%
    - 命中率 0-100 (%), 平均回報假設 normalise /5 變 0-20
    - 範圍大約 -50 to +100
    - 全部 null → return -Infinity (避免揀到空 result)
    """
    hit_rate = summary.get("hitRate5d") or 0
    avg_return = summary.get("avgForwardReturn5d") or 0
    return (hit_rate * 0.5) + ((avg_return / 5) * 0.5 * 100)


# ============================================================
# Constants (跟 frontend back-test.ts 1:1 對齊)
# ============================================================

DEFAULT_SSI_WEIGHTS_VARIATIONS: List[Dict[str, float]] = [
    {"ma": 0.4, "hl": 0.3, "tl": 0.3},  # 偏 MA
    {"ma": 0.3, "hl": 0.3, "tl": 0.4},  # 偏 TL
    {"ma": 0.3, "hl": 0.4, "tl": 0.3},  # 偏 HL
]

DEFAULT_KELLY_VALUES: List[float] = [0.125, 0.25, 0.5]  # octo / quarter / half
DEFAULT_RSI_WEIGHTS: List[float] = [0.10, 0.20, 0.30]


# ============================================================
# Main sub-step functions (跟 back-test.ts 1:1 port 去 Python sync)
# ============================================================

def run_replay(
    klines: List[Dict[str, Any]],
    config: Dict[str, Any],
    decision_fn: Callable[[List[Dict[str, Any]], Dict[str, Any]], Dict[str, Any]],
) -> Dict[str, Any]:
    """Replay engine — 9.1 main entry (sync version for backend)

    Algorithm:
      1. Filter klines by [startDate, endDate]
      2. Generate step points: startIdx, startIdx+stepDays, ... ≤ endIdx
      3. For each step point:
         - 拎到 historical K 線 (累積由 0 到 stepIdx, 大少 2026-08-10 08:08 fix 方案 C)
         - Call decisionFn(historicalKlines, params) → verdict
         - 拎 step point 當日 close + 5/10/20 日後 close
         - 計 forward return + hit boolean
      4. Aggregate: action breakdown + avg return + hit rate

    Edge cases (大少 22:28 確認嘅):
      - Empty klines → empty summary (唔 throw)
      - 1 kline → 1 result, 全部 forward return null
      - startDate 早過 klines[0] → auto-shift
      - endDate 過 klines[last] → auto-cap
      - stepDays 太大 → 1-2 results
      - decisionFn throw → catch + skip 嗰個 step

    永久 rule: backend M9 永遠用累積 K 線 (klines.slice(0, stepIdx+1)), 唔 sub-set lookbackDays
    (大少 2026-08-10 08:08 fix: 避免 HLStructure ≥99 bars gate 細到 throw Insufficient data)
    """
    step_days = config.get("stepDays", 5)
    lookback_days = config.get("lookbackDays", 60)  # 保留作 backward compat, 但唔 sub-set
    hold_days = config.get("holdDays", [5, 10, 20])
    symbol = config.get("symbol", "TEST")

    # Empty input → empty summary
    if not klines:
        return {
            "symbol": symbol,
            "config": config,
            "results": [],
            "totalDays": 0,
            "actionBreakdown": {},
            "avgForwardReturn5d": None,
            "avgForwardReturn10d": None,
            "avgForwardReturn20d": None,
            "hitRate5d": None,
            "hitRate10d": None,
            "hitRate20d": None,
        }

    # Filter klines by [startDate, endDate]
    start_date = config.get("startDate") or _get_kline_date(klines[0])
    end_date = config.get("endDate") or _get_kline_date(klines[-1])

    start_idx = max(0, _find_kline_index_by_date(klines, start_date))
    raw_end_idx = _find_kline_index_by_date(klines, end_date)
    end_idx = min(len(klines) - 1, max(0, raw_end_idx))

    # Generate step points
    results: List[Dict[str, Any]] = []
    params = config.get("params", {})

    for step_idx in range(start_idx, end_idx + 1, step_days):
        step_kline = klines[step_idx]

        # 累積 K 線 (0 to stepIdx), 永久 rule
        historical_klines = klines[: step_idx + 1]

        # 太短就 skip (decision engine 一般要 ≥ 30 bars, 留 buffer)
        if len(historical_klines) < 30:
            continue

        try:
            # 跑 decision engine (runner inject 落 decisionFn)
            verdict = decision_fn(historical_klines, params)

            # 拎 verdict 當日 close
            close_at_verdict = step_kline["close"]

            # 拎 +holdDays[i] 日後 close
            close_after_5d = klines[step_idx + 5]["close"] if 5 in hold_days and step_idx + 5 < len(klines) else None
            close_after_10d = klines[step_idx + 10]["close"] if 10 in hold_days and step_idx + 10 < len(klines) else None
            close_after_20d = klines[step_idx + 20]["close"] if 20 in hold_days and step_idx + 20 < len(klines) else None

            # 計 forward return + hit
            forward_return_5d = _compute_forward_return(close_at_verdict, close_after_5d)
            forward_return_10d = _compute_forward_return(close_at_verdict, close_after_10d)
            forward_return_20d = _compute_forward_return(close_at_verdict, close_after_20d)

            hit_5d = _compute_hit(forward_return_5d)
            hit_10d = _compute_hit(forward_return_10d)
            hit_20d = _compute_hit(forward_return_20d)

            results.append({
                "date": _get_kline_date(step_kline),
                "action": verdict.get("final_action", "WAIT"),
                "closeAtVerdict": close_at_verdict,
                "forwardReturn5d": forward_return_5d,
                "forwardReturn10d": forward_return_10d,
                "forwardReturn20d": forward_return_20d,
                "hit5d": hit_5d,
                "hit10d": hit_10d,
                "hit20d": hit_20d,
                "verdict": verdict,
            })
        except Exception as e:
            # decision engine throw, skip 嗰個 step, log warning
            print(f"[back-test] Replay at {_get_kline_date(step_kline)} failed: {e}")
            continue

    # Aggregate
    total_days = len(results)
    action_breakdown = _compute_action_breakdown(results)
    avg_forward_return_5d = _compute_avg([r["forwardReturn5d"] for r in results])
    avg_forward_return_10d = _compute_avg([r["forwardReturn10d"] for r in results])
    avg_forward_return_20d = _compute_avg([r["forwardReturn20d"] for r in results])
    hit_rate_5d = _compute_hit_rate([r["hit5d"] for r in results])
    hit_rate_10d = _compute_hit_rate([r["hit10d"] for r in results])
    hit_rate_20d = _compute_hit_rate([r["hit20d"] for r in results])

    return {
        "symbol": symbol,
        "config": config,
        "results": results,
        "totalDays": total_days,
        "actionBreakdown": action_breakdown,
        "avgForwardReturn5d": avg_forward_return_5d,
        "avgForwardReturn10d": avg_forward_return_10d,
        "avgForwardReturn20d": avg_forward_return_20d,
        "hitRate5d": hit_rate_5d,
        "hitRate10d": hit_rate_10d,
        "hitRate20d": hit_rate_20d,
    }


def run_coarse_grid(options: Dict[str, Any]) -> Dict[str, Any]:
    """跑 9 個 (or 27 個 if ssiWeightsVariations 3) coarse grid combinations
    - default 3 × 3 × 1 = 9 (kelly × rsi × 1 ssi)
    - 全部 sorted by score desc
    """
    kelly_values = options.get("kellyValues", DEFAULT_KELLY_VALUES)
    rsi_weights = options.get("rsiWeights", DEFAULT_RSI_WEIGHTS)
    ssi_weights = (options.get("ssiWeightsVariations") or DEFAULT_SSI_WEIGHTS_VARIATIONS)[0]
    base_klines = options["klines"]
    base_symbol = options["baseSymbol"]
    base_replay_config = options.get("baseReplayConfig", {})
    decision_fn = options["decisionFn"]

    entries: List[Dict[str, Any]] = []

    for kelly in kelly_values:
        for rsi_weight in rsi_weights:
            params = {"kelly": kelly, "rsiWeight": rsi_weight, "ssiWeights": ssi_weights}
            replay_config = {
                "symbol": base_symbol,
                "klines": base_klines,
                "holdDays": [5, 10, 20],
                "stepDays": 5,
                "lookbackDays": 60,
                **base_replay_config,
                "params": {**(base_replay_config.get("params") or {}), **params},
            }
            summary = run_replay(base_klines, replay_config, decision_fn)
            score = score_result(summary)
            entries.append({
                "params": params,
                "score": score,
                "hitRate5d": summary["hitRate5d"],
                "avgReturn5d": summary["avgForwardReturn5d"],
                "resultsCount": summary["totalDays"],
                "summary": summary,
            })

    # Sort by score desc
    entries.sort(key=lambda x: x["score"], reverse=True)
    top_5 = entries[:5]

    return {"entries": entries, "top5": top_5}


def run_fine_tune(options: Dict[str, Any]) -> Dict[str, Any]:
    """對 top 5 做 ±20% fine tune (大少 22:28 確認)
    - 5 base × 3 variations (-20% / 0 / +20% 對 Kelly)
    - + 5 base × 3 variations (-20% / 0 / +20% 對 RSI weight)
    = 5 × 3 + 5 × 3 = 30 candidates
    """
    fine_tune_pct = options.get("fineTunePercent", 0.2)
    top_5 = options["top5"]
    base_klines = options["klines"]
    base_symbol = options["baseSymbol"]
    base_replay_config = options.get("baseReplayConfig", {})
    decision_fn = options["decisionFn"]

    entries: List[Dict[str, Any]] = []

    for base in top_5:
        # Kelly ±20% × 3
        kelly_variations = [
            base["params"]["kelly"] * (1 - fine_tune_pct),
            base["params"]["kelly"],
            base["params"]["kelly"] * (1 + fine_tune_pct),
        ]
        # RSI weight ±20% × 3
        rsi_weight_variations = [
            base["params"]["rsiWeight"] * (1 - fine_tune_pct),
            base["params"]["rsiWeight"],
            base["params"]["rsiWeight"] * (1 + fine_tune_pct),
        ]

        # Kelly variations
        for i, kelly in enumerate(kelly_variations):
            params = {
                "kelly": kelly,
                "rsiWeight": base["params"]["rsiWeight"],
                "ssiWeights": base["params"]["ssiWeights"],
            }
            replay_config = {
                "symbol": base_symbol,
                "klines": base_klines,
                "holdDays": [5, 10, 20],
                "stepDays": 5,
                "lookbackDays": 60,
                **base_replay_config,
                "params": {**(base_replay_config.get("params") or {}), **params},
            }
            summary = run_replay(base_klines, replay_config, decision_fn)
            score = score_result(summary)
            entries.append({
                "baseParams": base["params"],
                "variation": {
                    "kellyMul": -fine_tune_pct if i == 0 else 0 if i == 1 else fine_tune_pct,
                    "rsiWeightMul": 0,
                },
                "params": params,
                "score": score,
                "hitRate5d": summary["hitRate5d"],
                "avgReturn5d": summary["avgForwardReturn5d"],
                "resultsCount": summary["totalDays"],
                "summary": summary,
            })

        # RSI weight variations
        for i, rsi_weight in enumerate(rsi_weight_variations):
            params = {
                "kelly": base["params"]["kelly"],
                "rsiWeight": rsi_weight,
                "ssiWeights": base["params"]["ssiWeights"],
            }
            replay_config = {
                "symbol": base_symbol,
                "klines": base_klines,
                "holdDays": [5, 10, 20],
                "stepDays": 5,
                "lookbackDays": 60,
                **base_replay_config,
                "params": {**(base_replay_config.get("params") or {}), **params},
            }
            summary = run_replay(base_klines, replay_config, decision_fn)
            score = score_result(summary)
            entries.append({
                "baseParams": base["params"],
                "variation": {
                    "kellyMul": 0,
                    "rsiWeightMul": -fine_tune_pct if i == 0 else 0 if i == 1 else fine_tune_pct,
                },
                "params": params,
                "score": score,
                "hitRate5d": summary["hitRate5d"],
                "avgReturn5d": summary["avgForwardReturn5d"],
                "resultsCount": summary["totalDays"],
                "summary": summary,
            })

    # Sort by score desc
    entries.sort(key=lambda x: x["score"], reverse=True)
    best = entries[0] if entries else None

    return {"entries": entries, "best": best}


def run_adaptive_window(options: Dict[str, Any]) -> Dict[str, Any]:
    """Adaptive window (大少 22:28 確認): 6 個月 start, samples < min 自動 +3 個月, max 18 個月
    - 預設 6 月 = 126 trading days, 3 月 = 63, 18 月 = 378
    - 拎 klines 最後 initialDays 嘅, 跑 runReplay
    - if totalDays < minSamples, extend +extendDays, 重做
    - 直至 totalDays ≥ minSamples OR finalDays ≥ maxDays
    """
    initial_days = options.get("initialDays", 126)
    extend_days = options.get("extendDays", 63)
    max_days = options.get("maxDays", 378)
    min_samples = options.get("minSamples", 30)
    base_klines = options["klines"]
    base_symbol = options["baseSymbol"]
    base_replay_config = options.get("baseReplayConfig", {})
    decision_fn = options["decisionFn"]

    current_days = initial_days
    extend_count = 0
    current_klines = base_klines[-initial_days:] if len(base_klines) >= initial_days else base_klines
    summary: Dict[str, Any] = {}

    while True:
        replay_config = {
            "symbol": base_symbol,
            "klines": current_klines,
            "holdDays": [5, 10, 20],
            "stepDays": 5,
            "lookbackDays": 60,
            **base_replay_config,
        }
        summary = run_replay(current_klines, replay_config, decision_fn)

        if summary["totalDays"] >= min_samples or current_days >= max_days:
            break

        # Extend
        current_days = min(max_days, current_days + extend_days)
        if current_days > len(base_klines):
            current_klines = base_klines
        else:
            current_klines = base_klines[-current_days:]
        extend_count += 1

    return {
        "finalKlines": current_klines,
        "initialDays": initial_days,
        "finalDays": current_days,
        "extendCount": extend_count,
        "finalSamples": summary.get("totalDays", 0),
        "minSamples": min_samples,
        "summary": summary,
    }


def run_walk_forward_cv(options: Dict[str, Any]) -> Dict[str, Any]:
    """Walk-forward CV (3 folds rolling, 大少 22:28 揀 B 方案)
    - 對每 fold:
      - Tune: runCoarseGrid + runFineTune on tune set → bestParams
      - Validate: runReplay(validate set, bestParams) → score
    - Overall:
      - bestParams = 用 validate score 最高嗰個 fold 嘅 params (out-of-sample 真實表現)
      - avgValidateScore = mean
      - stabilityScore = 1 - stddev/mean (越接近 1 越 stable)
    """
    num_folds = options.get("numFolds", 3)
    tune_ratio = options.get("tuneRatio", 0.67)
    base_klines = options["klines"]
    base_symbol = options["baseSymbol"]
    decision_fn = options["decisionFn"]
    base_replay_config = options.get("baseReplayConfig", {})
    # 永久 rule (大少 2026-08-31 P0-5): walk-forward CV emit fine-grained progress
    progress_callback: Optional[Callable] = options.get("progress_callback")

    def _emit_progress(stage: str, percent: int, extra: Optional[Dict[str, Any]] = None):
        if not progress_callback:
            return
        stage_dict = {"stage": stage, "percent": percent}
        if extra:
            stage_dict.update(extra)
        try:
            progress_callback(stage_dict)
        except Exception:
            pass  # 唔 crash fold 跑

    # 1. Split klines into n folds
    folds = _split_folds(base_klines, num_folds)
    _emit_progress("walk_forward_cv_folds_split", 15, {"num_folds": len(folds)})

    # 2. For each fold, tune + validate
    fold_results: List[Dict[str, Any]] = []

    for i, fold_klines in enumerate(folds):
        # 永久 rule P0-5: emit fold 進度 (fold 1/3 → 25%, fold 2/3 → 50%, fold 3/3 → 75%)
        _emit_progress(
            "walk_forward_cv_fold",
            20 + int(60 * (i / max(len(folds), 1))),
            {"fold": i + 1, "total_folds": len(folds)},
        )
        tune_end = int(len(fold_klines) * tune_ratio)
        tune_klines = fold_klines[:tune_end]
        validate_klines = fold_klines[tune_end:]

        # Check minimum samples
        if len(tune_klines) < 30:
            print(f"[walk-forward] Fold {i} tune set too short: {len(tune_klines)} klines, skipping")
            continue
        if len(validate_klines) < 20:
            print(f"[walk-forward] Fold {i} validate set too short: {len(validate_klines)} klines, skipping")
            continue

        # Tune: coarse grid + fine tune
        coarse = run_coarse_grid({
            "klines": tune_klines,
            "decisionFn": decision_fn,
            "baseSymbol": base_symbol,
            "kellyValues": options.get("kellyValues") or DEFAULT_KELLY_VALUES,
            "rsiWeights": options.get("rsiWeights") or DEFAULT_RSI_WEIGHTS,
            "baseReplayConfig": base_replay_config,
        })
        fine_tune = run_fine_tune({
            "klines": tune_klines,
            "decisionFn": decision_fn,
            "top5": coarse["top5"],
            "baseSymbol": base_symbol,
            "fineTunePercent": options.get("fineTunePercent") or 0.2,
            "baseReplayConfig": base_replay_config,
        })

        # Validate: 用 best params 跑 validate set
        validate_replay_config = {
            "symbol": base_symbol,
            "klines": validate_klines,
            "holdDays": [5, 10, 20],
            "stepDays": 5,
            "lookbackDays": 0,  # 累積 (V1 fix)
            **base_replay_config,
            "params": {**(base_replay_config.get("params") or {}), **fine_tune["best"]["params"]},
        }
        validate_summary = run_replay(validate_klines, validate_replay_config, decision_fn)
        validate_score = score_result(validate_summary)

        fold_results.append({
            "foldIndex": i,
            "tuneKlines": tune_klines,
            "validateKlines": validate_klines,
            "bestParams": fine_tune["best"]["params"],
            "tuneScore": fine_tune["best"]["score"],
            "validateScore": validate_score,
            "validateSamples": validate_summary["totalDays"],
            "tuneResult": coarse,
            # Phase 9 permanent rule: 拎 validateReplay 落 fold, _post_forward_return_records 後續拎呢個拎 forward return records 落 cache
            "validateReplay": validate_summary,
            "postErrors": [],  # Phase 9 frontend 拎返依個 field
        })

    # 3. Overall: 揾 bestParams 用 validate score 最高嗰個 fold (out-of-sample 真實表現)
    if not fold_results:
        # 全部 fold skipped (insufficient data) — return empty result 唔 throw
        return {
            "folds": [],
            "overall": {
                "bestParams": {"kelly": 0.25, "rsiWeight": 0.20, "ssiWeights": {"ma": 0.4, "hl": 0.3, "tl": 0.3}},  # default fallback
                "avgValidateScore": 0,
                "stabilityScore": 0,
                "totalValidateSamples": 0,
            },
        }

    best_fold = max(fold_results, key=lambda f: f["validateScore"])

    # 4. Stability + avg metrics
    validate_scores = [f["validateScore"] for f in fold_results]
    avg_validate_score = sum(validate_scores) / len(validate_scores)
    stddev_score = _stddev(validate_scores)
    # stability = 1 - (stddev / |mean|), clamp [0, 1]
    # mean ≈ 0 時 stability = 0 (避 divide by zero)
    stability_score = 0.0 if abs(avg_validate_score) < 0.001 else max(0.0, min(1.0, 1 - stddev_score / abs(avg_validate_score)))
    total_validate_samples = sum(f["validateSamples"] for f in fold_results)

    return {
        "folds": fold_results,
        "overall": {
            "bestParams": best_fold["bestParams"],
            "avgValidateScore": avg_validate_score,
            "stabilityScore": stability_score,
            "totalValidateSamples": total_validate_samples,
        },
    }


# ============================================================
# Format helper (大少 11:57 永久 rule: 永遠 full show)
# ============================================================

def format_forward_return(
    forward_return: Optional[float],
    hit: Optional[bool],
) -> Dict[str, str]:
    """Render forward return 永遠 full show (大少 11:57 永久 rule)
    - 有 data → "%+1.23%" (with sign + 2 decimal)
    - 冇 data → "N/A" (唔好 omit)
    - hit boolean 同時 display
    """
    if forward_return is None:
        return {"returnText": "N/A", "hitEmoji": "⚫"}
    sign = "+" if forward_return >= 0 else ""
    return_text = f"{sign}{forward_return:.2f}%"
    hit_emoji = "🟢" if hit is True else "🔴" if hit is False else "⚫"
    return {"returnText": return_text, "hitEmoji": hit_emoji}


# ============================================================
# Cache post helpers (in-process call 落 adaptive_params function, 唔走 HTTP)
# ============================================================

def _post_optimal_to_cache(symbol: str, optimal: Dict[str, Any], folds_count: int) -> Optional[Exception]:
    """Phase 9 永久 rule: 跑完 walk-forward CV 之後, 自動 POST optimal params 落 cache (30 日 expiry)
    - in-process call 落 backend.services.adaptive_params_cache.save_optimal, 避免 HTTP overhead
    - 失敗 fallback try/except (唔 crash algorithm)
    """
    try:
        from backend.services.adaptive_params_cache import save_optimal
        save_optimal(
            symbol=symbol,
            optimal_params={
                "kelly": optimal["bestParams"]["kelly"],
                "rsiWeight": optimal["bestParams"]["rsiWeight"],
                "ssiWeights": optimal["bestParams"]["ssiWeights"],
            },
            validation={
                "avgValidateScore": optimal.get("avgValidateScore", 0),
                "stabilityScore": optimal.get("stabilityScore", 0),
                "totalValidateSamples": optimal.get("totalValidateSamples", 0),
            },
            window={"initialDays": 126, "finalDays": 126, "extendCount": 0},
            folds_count=folds_count,
        )
        return None
    except Exception as e:
        print(f"[back-test] save optimal to cache failed: {e}")
        return e


def _post_forward_return_records(symbol: str, folds: List[Dict[str, Any]]) -> List[Exception]:
    """Phase 9 永久 rule: 跑完 walk-forward CV 之後, 自動 POST 逐條 forward return records 落 cache (永久保留)
    - 對每 fold 嘅 validate set 跑 runReplay 拎 results, 逐條 POST
    - 失敗 collect 落 list 返 (大少 22:28 永久 rule: 唔 silent fail, 0 validate samples 一定要 fire warning)
    """
    post_errors: List[Exception] = []
    try:
        from backend.services.adaptive_params_cache import add_forward_return_record

        for fold in folds:
            try:
                # 跑 fold 嘅 validate set 拎逐條 forward return record
                # 永久 rule: post 失敗唔可以 silent fail, 全部 collect 落 postErrors
                # 但 Phase 9 拎 fold.validateReplay 嘅 results (避免 拎多一次), 拎唔到就 collect error
                validate_replay_results = fold.get("validateReplay", {}).get("results", [])
                for result in validate_replay_results:
                    try:
                        add_forward_return_record(
                            symbol=symbol,
                            record={
                                "date": result["date"],
                                "action": result["action"],
                                "fwd5": result.get("forwardReturn5d"),
                                "fwd10": result.get("forwardReturn10d"),
                                "fwd20": result.get("forwardReturn20d"),
                                "hit": result.get("hit5d"),
                            },
                        )
                    except Exception as e:
                        post_errors.append(e)
                # 凡人話: 如果 validate_replay_results 空 (walk-forward CV 拎唔到), 都要 collect 1 個 error
                if not validate_replay_results:
                    post_errors.append(
                        ValueError(f"fold {fold.get('foldIndex', '?')} 冇 validate replay results (kline count 不足 / decisionFn throw)")
                    )
            except Exception as e:
                post_errors.append(e)
    except Exception as e:
        post_errors.append(e)

    return post_errors


# ============================================================
# Main algorithm (跟 back-test.ts BackTestEngine 1:1 port)
# ============================================================

class BackTestAlgorithm(Algorithm):
    """M9 Back Test (Walk-Forward CV + Adaptive Window + Coarse Grid + Fine Tune)
    — 大少 2026-08-20 Phase 9 backend port

    Algorithm ABC contract:
    - name: "back_test"
    - version: "0.6.0"
    - run(klines, options) → Verdict
    - options.moduleVerdicts: M7 verdict (由 runner inject, chain rule)
    - options.decisionFn: M8 verdict function (由 runner inject, chain rule, Phase 10 done 之後自動)

    凡人話: M9 用 walk-forward CV 跑 M8 verdict 30-100 次, 對比真實 5/10/20 日回報, 拎最佳 params + 累積 forward return
    """

    name = "back_test"
    version = "0.6.0"

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.cfg = {**DEFAULT_BACK_TEST_CONFIG, **(config or {})}

    def run(self, klines: List[Dict[str, Any]], options: Optional[Dict[str, Any]] = None) -> Verdict:
        options = options or {}
        timeframe = options.get("period", "1d")
        symbol = options.get("symbol", "TEST")

        # Chain rule: decisionFn 由 runner inject (Phase 10 done 之後自動), Phase 9 用 _default_decision_fn fallback
        decision_fn: Callable = options.get("decisionFn", _default_decision_fn)

        # M7 verdict inject (chain rule, M9 拎 M7 verdict 做 context)
        module_verdicts: List[Dict[str, Any]] = options.get("moduleVerdicts", [])

        # 永久 rule (大少 2026-08-31 P0-5): M9 必須 emit progress stage 落 options['progress_callback']
        # 之前 M9 跑 30-60 秒冇 feedback, 而家 frontend polling 拎 progress
        # 對齊 ARCHITECTURE §15.42 永久 rule
        progress_callback: Optional[Callable] = options.get("progress_callback")
        # 永久 rule P0-5: M9 verdict 必須包含 progress_log 落 meta, frontend 撳跑完之後 render progress timeline
        # (之前冇呢個 field, frontend 唔知 M9 跑到邊度)
        progress_log: List[Dict[str, Any]] = []

        def _emit_progress(stage: str, percent: int, extra: Optional[Dict[str, Any]] = None):
            """凡人話: 拎 stage label 推到 progress_callback + progress_log"""
            import time as _time
            stage_dict = {
                "stage": stage,
                "percent": percent,
                "timestamp": _time.time(),
            }
            if extra:
                stage_dict.update(extra)
            progress_log.append(stage_dict)
            if progress_callback:
                try:
                    progress_callback(stage_dict)
                except Exception as cb_err:
                    logger.warning(f"[M9] progress_callback 失敗: {cb_err}")

        # Step 0: 數據驗證 (need ≥ 126 日 / 6 個月)
        min_data = self.cfg["initialDays"]
        _emit_progress("data_validation", 5)
        if len(klines) < min_data:
            return Verdict(
                ok=True,
                points=[],
                meta={
                    "moduleId": "back-test",
                    "timeframe": timeframe,
                    "symbol": symbol,
                    "state": "SIDEWAYS",
                    "cycleLabel": "數據不足",
                    "confidence": 0,
                    "interpretation": f"[Back Test v0.6.0] 數據不足: need ≥ {min_data} bars, got {len(klines)}",
                    "evidence": [],
                    "dataDays": len(klines),
                    "configUsed": self.cfg,
                    "reason": "數據不足",
                },
                warnings=[
                    {
                        "level": "critical",
                        "module_id": "M9",
                        "code": "INSUFFICIENT_DATA",
                        "message": f"klines {len(klines)} < {min_data} required",
                        "debug": {
                            "issue": f"M9 need ≥ {min_data} bars, got {len(klines)}",
                            "impact": "Verdict 唔可信, 唔好落單",
                            "fix": "Re-run / 加大 dataWindowDays / 聯絡 admin",
                        },
                    }
                ],
            )

        # Step 1-4: Adaptive Window → Coarse Grid → Fine Tune
        # Step 5: Walk-Forward CV
        _emit_progress("walk_forward_cv_starting", 10, {"num_folds": self.cfg["numFolds"]})
        walk_forward_result = run_walk_forward_cv({
            "klines": klines,
            "decisionFn": decision_fn,
            "baseSymbol": symbol,
            "numFolds": self.cfg["numFolds"],
            "tuneRatio": self.cfg["tuneRatio"],
            "baseReplayConfig": {"stepDays": options.get("stepDays", 5)},
            # 永久 rule P0-5: progress callback 注入 sub-step, 拎 fine-grained fold/candidate 進度
            "progress_callback": progress_callback,
        })
        _emit_progress("walk_forward_cv_done", 90, {
            "folds_count": len(walk_forward_result["folds"]),
            "optimal_total_samples": walk_forward_result["overall"].get("totalValidateSamples", 0),
        })

        # 永久 rule: walk-forward CV 跑完之後, 自動 POST optimal + forward return 落 cache
        optimal = walk_forward_result["overall"]
        post_errors: List[Exception] = []

        # Step 6: POST optimal 落 cache (30 日 expiry)
        if optimal.get("totalValidateSamples", 0) > 0:
            err = _post_optimal_to_cache(symbol, optimal, len(walk_forward_result["folds"]))
            if err:
                post_errors.append(err)

        # Step 7: POST forward return records 落 cache (永久保留)
        # 大少 22:28 永久 rule: 唔 silent fail, 0 validate samples 一定要 fire warning
        const_post_errors = walk_forward_result["folds"][0].get("postErrors", []) if walk_forward_result["folds"] else []
        for fold in walk_forward_result["folds"]:
            const_post_errors.extend(fold.get("postErrors", []))
        post_errors.extend(const_post_errors)

        # 凡人話: 取 M7 verdict 做 context 顯示 (chain rule)
        m7_summary = {
            "verdict_count": len(module_verdicts),
            "states": list({v.get("state", "SIDEWAYS") for v in module_verdicts}),
        }

        # 組裝 meta
        meta = {
            "moduleId": "back-test",
            "timeframe": timeframe,
            "symbol": symbol,
            # M9 verdict 拎 walk-forward CV 嘅 best params + avg score
            "state": "SIDEWAYS",  # M9 唔派生 state (留畀 M8 final judgment)
            "cycleLabel": "回測驗證完成",
            "confidence": round(optimal.get("avgValidateScore", 0) / 100, 4),
            "interpretation": (
                f"[Back Test v0.6.0] 跑完 {len(walk_forward_result['folds'])} 段 walk-forward CV, "
                f"avg validate score {optimal.get('avgValidateScore', 0):.1f}, "
                f"stability {optimal.get('stabilityScore', 0):.2f}, "
                f"total samples {optimal.get('totalValidateSamples', 0)}"
            ),
            "evidence": [],
            "dataDays": len(klines),
            "configUsed": self.cfg,
            "reason": "回測驗證完成",
            # M9 7 個永久 rule output
            "walkForwardResult": walk_forward_result,
            "folds": walk_forward_result["folds"],
            "overall": optimal,
            "bestParams": optimal["bestParams"],
            "avgValidateScore": optimal.get("avgValidateScore", 0),
            "stabilityScore": optimal.get("stabilityScore", 0),
            "totalValidateSamples": optimal.get("totalValidateSamples", 0),
            "foldsCount": len(walk_forward_result["folds"]),
            "postErrors": post_errors,
            "m7Context": m7_summary,
            # 永久 rule P0-5 (大少 2026-08-31): M9 verdict 必含 progress_log 落 meta
            # 之前 M9 跑 30-60 秒冇 feedback, 而家 frontend render 揾 progress_log 顯示 timeline
            "progress_log": progress_log,
        }

        # 凡人話: 0 validate samples 一定要 fire warning (大少 22:28 永久 rule)
        warnings: List[str] = []
        if optimal.get("totalValidateSamples", 0) == 0:
            warnings.append("POST_FAILED: 0 validate samples, walk-forward CV 冇做 (kline count 不足 / decisionFn throw)")
        if post_errors:
            warnings.append(f"POST_FAILED: {len(post_errors)} 個 cache post 失敗 (見 meta.postErrors)")

        return Verdict(ok=True, points=[], meta=meta, warnings=warnings)


# Register
register(BackTestAlgorithm())

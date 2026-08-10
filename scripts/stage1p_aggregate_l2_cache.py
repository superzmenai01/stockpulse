"""
scripts/stage1p_aggregate_l2_cache.py — Stage 1+ Bayesian tune baseline trigger

Aggregate forward return history 從 L2 cache (per-symbol JSON files) → 寫入
stage1p_tuning_results.json 暫存,trigger Stage 1+ tune algorithm.

大少 2026-08-10 09:33 confirm Option 3 Hybrid:
- Option 2 derive (過去 M9 Pilot records) 即時 trigger Stage 1+ baseline
- Option 1 paper trading (sprint 2 設計) 之後累積
- 大少真實 trade (長期) 慢慢累積

Input: ~/.stockpulse/adaptive_params/<symbol>.json (L2 cache)
- forward_return_history[]: 每條 record { date, action, fwd5, fwd10, fwd20, hit }
- hit 已經 auto-populated by M9 個 runReplay engine (大少 22:28 confirm)

Output: scripts/stage1p_tuning_results.json (暫存, .gitignore)
- per_symbol: { symbol: { hit_rate, total_samples, fwd5_avg, fwd10_avg, fwd20_avg, hit_count } }
- overall: { total_samples, hit_rate, by_action: { BUY: {...}, WAIT: {...} } }
- generated_at: ISO timestamp
- next_step: "Run scripts/stage1p_bayesian_tune.py to tune 5 個 adaptive params"

永久保留 (大少 22:28 永久 rule: forward return cache 永久)
0 pollution: 純獨立 script, 唔入 backend code, 唔入 conftest
"""
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

L2_CACHE_DIR = Path.home() / ".stockpulse" / "adaptive_params"
OUTPUT_PATH = Path(__file__).parent / "stage1p_tuning_results.json"


def load_l2_cache(symbol: str) -> dict | None:
    """讀單一 symbol 嘅 L2 cache JSON file. None if not exist."""
    cache_file = L2_CACHE_DIR / f"{symbol}.json"
    if not cache_file.exists():
        return None
    with open(cache_file) as f:
        return json.load(f)


def load_all_l2_caches() -> dict[str, dict]:
    """讀 L2 cache directory 全部 *.json file. Return {symbol: cache_data}."""
    if not L2_CACHE_DIR.exists():
        return {}
    result = {}
    for cache_file in L2_CACHE_DIR.glob("*.json"):
        with open(cache_file) as f:
            data = json.load(f)
        symbol = data.get("symbol", cache_file.stem)
        result[symbol] = data
    return result


def aggregate_per_symbol(symbol: str, history: list[dict]) -> dict[str, Any]:
    """Aggregate stats 對單一 symbol 嘅 forward_return_history."""
    if not history:
        return {
            "symbol": symbol,
            "total_samples": 0,
            "hit_count": 0,
            "hit_rate": None,
            "fwd5_avg": None,
            "fwd10_avg": None,
            "fwd20_avg": None,
        }
    hit_count = sum(1 for r in history if r.get("hit"))
    fwd5_returns = [r["fwd5"] for r in history if r.get("fwd5") is not None]
    fwd10_returns = [r["fwd10"] for r in history if r.get("fwd10") is not None]
    fwd20_returns = [r["fwd20"] for r in history if r.get("fwd20") is not None]
    return {
        "symbol": symbol,
        "total_samples": len(history),
        "hit_count": hit_count,
        "hit_rate": hit_count / len(history) if history else None,
        "fwd5_avg": sum(fwd5_returns) / len(fwd5_returns) if fwd5_returns else None,
        "fwd10_avg": sum(fwd10_returns) / len(fwd10_returns) if fwd10_returns else None,
        "fwd20_avg": sum(fwd20_returns) / len(fwd20_returns) if fwd20_returns else None,
    }


def aggregate_overall(all_stats: list[dict]) -> dict[str, Any]:
    """Aggregate 跨所有 symbols 嘅 stats."""
    valid = [s for s in all_stats if s["total_samples"] > 0]
    if not valid:
        return {
            "total_samples": 0,
            "hit_rate": None,
            "symbols_count": 0,
            "by_action": {},
        }
    total_samples = sum(s["total_samples"] for s in valid)
    total_hits = sum(s["hit_count"] for s in valid)
    return {
        "total_samples": total_samples,
        "hit_count": total_hits,
        "hit_rate": total_hits / total_samples if total_samples else None,
        "symbols_count": len(valid),
        "fwd5_avg_overall": sum(s["fwd5_avg"] for s in valid if s["fwd5_avg"] is not None) / len([s for s in valid if s["fwd5_avg"] is not None]) if any(s["fwd5_avg"] is not None for s in valid) else None,
        "fwd10_avg_overall": sum(s["fwd10_avg"] for s in valid if s["fwd10_avg"] is not None) / len([s for s in valid if s["fwd10_avg"] is not None]) if any(s["fwd10_avg"] is not None for s in valid) else None,
        "fwd20_avg_overall": sum(s["fwd20_avg"] for s in valid if s["fwd20_avg"] is not None) / len([s for s in valid if s["fwd20_avg"] is not None]) if any(s["fwd20_avg"] is not None for s in valid) else None,
    }


def aggregate_by_action(all_histories: dict[str, list[dict]]) -> dict[str, dict]:
    """Aggregate stats 對每個 action (BUY / WAIT / SELL) 跨所有 symbols."""
    by_action: dict[str, list[dict]] = defaultdict(list)
    for symbol, history in all_histories.items():
        for r in history:
            action = r.get("action", "UNKNOWN")
            by_action[action].append(r)

    result = {}
    for action, records in by_action.items():
        if not records:
            continue
        hit_count = sum(1 for r in records if r.get("hit"))
        fwd5 = [r["fwd5"] for r in records if r.get("fwd5") is not None]
        result[action] = {
            "total_samples": len(records),
            "hit_count": hit_count,
            "hit_rate": hit_count / len(records),
            "fwd5_avg": sum(fwd5) / len(fwd5) if fwd5 else None,
        }
    return result


def main() -> None:
    """Main: 讀 L2 cache → aggregate → 寫 stage1p_tuning_results.json."""
    print(f"[stage1p_aggregate] 讀 L2 cache: {L2_CACHE_DIR}")
    all_caches = load_all_l2_caches()
    if not all_caches:
        print(f"[stage1p_aggregate] ⚠️ 冇 L2 cache file 喺 {L2_CACHE_DIR}")
        print("[stage1p_aggregate] 提示: 跑 M9 Pilot script 累積 forward_return_history 先")
        return

    all_histories = {sym: data.get("forward_return_history", []) for sym, data in all_caches.items()}
    per_symbol_stats = [aggregate_per_symbol(sym, hist) for sym, hist in all_histories.items()]
    overall_stats = aggregate_overall(per_symbol_stats)
    by_action_stats = aggregate_by_action(all_histories)

    output = {
        "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "trigger": "大少 2026-08-10 09:33 confirm Option 3 Hybrid (M9 Pilot derive baseline)",
        "per_symbol": per_symbol_stats,
        "overall": overall_stats,
        "by_action": by_action_stats,
        "next_step": "Run scripts/stage1p_bayesian_tune.py to tune 5 個 adaptive params",
    }

    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"[stage1p_aggregate] ✅ Wrote {OUTPUT_PATH}")
    print(f"[stage1p_aggregate] Symbols: {overall_stats['symbols_count']}")
    print(f"[stage1p_aggregate] Total samples: {overall_stats['total_samples']}")
    print(f"[stage1p_aggregate] Hit rate: {overall_stats['hit_rate']:.3f}" if overall_stats['hit_rate'] is not None else "[stage1p_aggregate] Hit rate: N/A")
    print(f"[stage1p_aggregate] By action: {list(by_action_stats.keys())}")


if __name__ == "__main__":
    main()

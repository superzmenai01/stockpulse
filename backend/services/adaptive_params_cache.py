"""
services/adaptive_params_cache.py — Adaptive Params L2 JSON File Cache (大少 2026-08-08 16:30)

Sprint 2 sub-task 2.6 — L2 cache 5 個 adaptive params (per-symbol)
Sprint 3 sub-task 9.4 — extend L2 cache 加 optimal params + forward return record (per-symbol, 永久保留)
- 路徑: ~/.stockpulse/adaptive_params/<symbol>.json
- 7 日 expiry: 超過 7 日就 invalid (前端會 trigger recalibrate) — 對 adaptive params
- 30 日 expiry: optimal params from back test (大少 22:28)
- 永久保留: forward_return_history (大少 22:28 confirm: 永遠唔 delete)
- Stage 1 唔改 backend architecture, Stage 2 升 L3 DB
- 純 disk I/O, 唔用 AI / LLM

Spec: docs/research/AS-03-cycle-detection/MODULE-08-DECISION-ENGINE.md §7
Spec: docs/research/AS-03-cycle-detection/MODULE-09-BACK-TEST.md §11
對應 commit: f33774e9 (2.5), e474a266 (9.3), 9.4
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# 7 日 expiry (大少 11:39 confirm: cache > 7 日自動重校)
CACHE_EXPIRY_SECONDS = 7 * 24 * 60 * 60  # 604800

# 30 日 expiry (大少 22:28: optimal params 唔需要每週重 tune, 30 日夠)
OPTIMAL_EXPIRY_SECONDS = 30 * 24 * 60 * 60  # 2592000

# Cache 根目錄: ~/.stockpulse/adaptive_params/
CACHE_ROOT = Path.home() / ".stockpulse" / "adaptive_params"


def _cache_path(symbol: str) -> Path:
    """取得某 symbol 嘅 cache file path
    Sanitize symbol (避免 path traversal): 只允許 alphanumeric + . _ -
    而且 sanitized 後必須等於原 symbol (即係任何 char 被移除都 reject)
    """
    if not symbol or not isinstance(symbol, str):
        raise ValueError(f"Invalid symbol: {symbol!r}")
    safe = "".join(c for c in symbol if c.isalnum() or c in "._-")
    if not safe:
        raise ValueError(f"Symbol sanitized to empty: {symbol!r}")
    if safe != symbol:
        # 任何 char 被移除 = path traversal 風險
        raise ValueError(f"Symbol has invalid characters: {symbol!r}")
    if ".." in safe:
        raise ValueError(f"Symbol contains '..': {symbol!r}")
    return CACHE_ROOT / f"{safe}.json"


def _read_cache(symbol: str) -> Optional[dict]:
    """讀 raw cache file (冇 expiry check)
    @returns dict if file exists, else None
    """
    path = _cache_path(symbol)
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f"[adaptive_params_cache] _read_cache error for {symbol}: {e}")
        return None


def _write_cache(symbol: str, data: dict) -> bool:
    """寫 raw cache file (atomic write)
    @returns True if success
    """
    if not data or not isinstance(data, dict):
        raise ValueError(f"Invalid data: {data!r}")
    path = _cache_path(symbol)  # raises ValueError if invalid
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        # Atomic write: 寫 temp file 然後 rename (避免半寫狀態)
        tmp_path = path.with_suffix(".json.tmp")
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp_path, path)
        return True
    except Exception as e:
        logger.error(f"[adaptive_params_cache] _write_cache error for {symbol}: {e}")
        return False


def is_cache_valid(symbol: str) -> bool:
    """檢查 cache 係咪仍然 valid (7 日內)
    @returns True if cache 存在 + last_calibrated < 7 日前
    """
    data = _read_cache(symbol)
    if data is None:
        return False
    last_calibrated = data.get("last_calibrated", 0)
    age = time.time() - last_calibrated
    return age < CACHE_EXPIRY_SECONDS


def is_optimal_valid(symbol: str) -> bool:
    """檢查 optimal cache 係咪仍然 valid (30 日內)
    @returns True if optimal 存在 + last_backtest < 30 日前
    """
    data = _read_cache(symbol)
    if data is None or "optimal" not in data:
        return False
    last_backtest = data["optimal"].get("last_backtest", 0)
    age = time.time() - last_backtest
    return age < OPTIMAL_EXPIRY_SECONDS


def load_params(symbol: str) -> Optional[dict]:
    """從 cache 讀 params
    @returns dict if valid cache exists, else None
    """
    if not is_cache_valid(symbol):
        return None
    return _read_cache(symbol)


def save_params(symbol: str, params: dict) -> bool:
    """儲存 params 落 cache
    @returns True if success
    """
    if not params or not isinstance(params, dict):
        raise ValueError(f"Invalid params: {params!r}")
    # 保留 existing optimal + forward_return_history (唔好覆蓋)
    existing = _read_cache(symbol) or {}
    data = {
        "symbol": symbol,
        "last_calibrated": time.time(),
        "params": params,
        "auto": True,  # 大少 11:39 confirm auto mode
        # 保留 optimal (如果有) 永久 (大少 22:28)
        **({"optimal": existing["optimal"]} if "optimal" in existing else {}),
        # 保留 forward_return_history (如果有) 永久
        **({"forward_return_history": existing["forward_return_history"]} if "forward_return_history" in existing else {}),
    }
    if _write_cache(symbol, data):
        logger.info(f"[adaptive_params_cache] save_params OK: {symbol}")
        return True
    return False


def delete_params(symbol: str) -> bool:
    """刪除某 symbol 嘅 cache (testing page 「🔄 重新校準」會先 delete 然後 recalibrate)
    @returns True if deleted, False if not exist
    """
    try:
        path = _cache_path(symbol)
        if path.exists():
            path.unlink()
            logger.info(f"[adaptive_params_cache] delete_params OK: {symbol}")
            return True
        return False
    except Exception as e:
        logger.error(f"[adaptive_params_cache] delete_params error for {symbol}: {e}")
        return False


def list_cached_symbols() -> list[str]:
    """列出所有有 cache 嘅 symbols
    @returns list of symbol strings
    """
    if not CACHE_ROOT.exists():
        return []
    symbols = []
    for p in CACHE_ROOT.glob("*.json"):
        if p.name.endswith(".json.tmp"):
            continue
        symbols.append(p.stem)
    return sorted(symbols)


def clear_all() -> int:
    """清空所有 cache (admin endpoint, 大少 2.6 spec 將加)
    @returns number of files deleted
    """
    if not CACHE_ROOT.exists():
        return 0
    count = 0
    for p in CACHE_ROOT.glob("*.json"):
        try:
            p.unlink()
            count += 1
        except Exception:
            pass
    return count


# =============================================================
# Sprint 3 sub-task 9.4 — Optimal params (per-symbol, 30 日 expiry)
# =============================================================
# 大少 2026-08-08 22:28 confirm: optimal params 永久保留喺同一 cache file 嘅 'optimal' key
# 用 30 日 expiry (因為 optimal 唔需要每週重 tune, 1 個月 tune 一次夠)
# 配合 spec: docs/research/AS-03-cycle-detection/MODULE-09-BACK-TEST.md §11

def load_optimal(symbol: str) -> Optional[dict]:
    """從 cache 讀 optimal params (30 日 expiry)
    @returns dict 含 'optimal' key if valid, else None
    """
    if not is_optimal_valid(symbol):
        return None
    return _read_cache(symbol)


def save_optimal(symbol: str, optimal_params: dict, validation: Optional[dict] = None,
                 window: Optional[dict] = None, folds_count: int = 3) -> bool:
    """儲存 back test 嘅 optimal params 落 cache

    @param symbol: stock code
    @param optimal_params: { kelly, rsiWeight, ssiWeights: {ma,hl,tl} }
    @param validation: { avgValidateScore, stabilityScore, totalValidateSamples } (optional)
    @param window: { initialDays, finalDays, extendCount } (optional)
    @param folds_count: walk-forward CV folds count (default 3)
    @returns True if success
    """
    if not optimal_params or not isinstance(optimal_params, dict):
        raise ValueError(f"Invalid optimal_params: {optimal_params!r}")

    # 保留 existing params + forward_return_history (唔好覆蓋)
    existing = _read_cache(symbol) or {}
    optimal_data = {
        "last_backtest": time.time(),
        "optimal_params": optimal_params,
        "auto": False,  # 標記為 back test result, 唔係 auto-calibrate
        **({"validation": validation} if validation else {}),
        **({"window": window} if window else {}),
        "folds_count": folds_count,
    }
    data = {
        "symbol": symbol,
        # 保留 params (如果有) 用舊 last_calibrated
        **({"last_calibrated": existing["last_calibrated"]} if "last_calibrated" in existing else {}),
        **({"params": existing["params"]} if "params" in existing else {}),
        "optimal": optimal_data,
        # 保留 forward_return_history (如果有) 永久
        **({"forward_return_history": existing["forward_return_history"]} if "forward_return_history" in existing else {}),
    }
    if _write_cache(symbol, data):
        logger.info(f"[adaptive_params_cache] save_optimal OK: {symbol} "
                    f"(kelly={optimal_params.get('kelly')}, rsi={optimal_params.get('rsiWeight')})")
        return True
    return False


# =============================================================
# Sprint 3 sub-task 9.4 — Forward Return Record (per-symbol, 永久保留)
# =============================================================
# 大少 2026-08-08 22:28 confirm: 永久保留 verdict + forward return record
# 每個 record: { date, action, fwd5, fwd10, fwd20, hit }
# 用嚟 build "per-symbol 成績表" + Stage 1+ forward return tracking

def add_forward_return_record(symbol: str, record: dict) -> bool:
    """加一條 forward return record 落 cache history (永久保留)
    @param record: { date: 'YYYY-MM-DD', action: 'BUY', fwd5: number, fwd10: number, fwd20: number, hit: boolean }
    @returns True if success
    """
    if not record or not isinstance(record, dict):
        raise ValueError(f"Invalid record: {record!r}")
    if "date" not in record or "action" not in record:
        raise ValueError(f"Record must have 'date' and 'action': {record!r}")

    existing = _read_cache(symbol) or {}
    history = existing.get("forward_return_history", [])
    history.append(record)

    data = {
        "symbol": symbol,
        # 保留所有舊 fields
        **({"last_calibrated": existing["last_calibrated"]} if "last_calibrated" in existing else {}),
        **({"params": existing["params"]} if "params" in existing else {}),
        **({"optimal": existing["optimal"]} if "optimal" in existing else {}),
        "forward_return_history": history,
    }
    if _write_cache(symbol, data):
        logger.info(f"[adaptive_params_cache] add_forward_return_record OK: {symbol} ({len(history)} records)")
        return True
    return False


def get_forward_return_history(symbol: str, limit: Optional[int] = None) -> list:
    """拎 forward return history (永久保留, 唔過濾 expiry)
    @param limit: 最多返幾多條 (None = all)
    @returns list of records, sorted by date desc
    """
    data = _read_cache(symbol)
    if data is None:
        return []
    history = data.get("forward_return_history", [])
    # Sort by date desc (most recent first)
    history_sorted = sorted(history, key=lambda r: r.get("date", ""), reverse=True)
    if limit is not None and limit > 0:
        return history_sorted[:limit]
    return history_sorted


def compute_forward_return_stats(symbol: str, half_life_days: int = 180) -> Optional[dict]:
    """用 history 計 hit rate + avg return (weighted by recent, 半衰期預設 180 日 = 6 個月, 大少 22:28 確認)
    @param half_life_days: 半衰期日數, 預設 180 (6 月)
    @returns { hit_rate_5d, avg_return_5d, sample_count } or None if no data
    """
    history = get_forward_return_history(symbol)
    if not history:
        return None

    # Filter records with fwd5 唔 null
    records_with_5d = [r for r in history if r.get("fwd5") is not None]
    if not records_with_5d:
        return None

    # Compute exponential decay weight (大少 22:28 永久 rule: 6 個月半衰期)
    from datetime import datetime
    now = datetime.now()
    weighted_hit_count = 0.0
    weighted_return_sum = 0.0
    weight_sum = 0.0
    for r in records_with_5d:
        try:
            r_date = datetime.strptime(r["date"], "%Y-%m-%d")
            days_ago = (now - r_date).days
            weight = 0.5 ** (days_ago / half_life_days)  # exponential decay
        except Exception:
            weight = 1.0  # fallback if date invalid
        if r.get("hit"):
            weighted_hit_count += weight
        weighted_return_sum += r.get("fwd5", 0) * weight
        weight_sum += weight

    if weight_sum == 0:
        return None
    return {
        "hit_rate_5d": (weighted_hit_count / weight_sum) * 100,
        "avg_return_5d": weighted_return_sum / weight_sum,
        "sample_count": len(records_with_5d),
        "half_life_days": half_life_days,
    }


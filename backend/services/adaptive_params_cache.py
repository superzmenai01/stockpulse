"""
services/adaptive_params_cache.py — Adaptive Params L2 JSON File Cache (大少 2026-08-08 16:30)

Sprint 2 sub-task 2.6 — L2 cache 5 個 adaptive params (per-symbol)
- 路徑: ~/.stockpulse/adaptive_params/<symbol>.json
- 7 日 expiry: 超過 7 日就 invalid (前端會 trigger recalibrate)
- Stage 1 唔改 backend architecture, Stage 2 升 L3 DB
- 純 disk I/O, 唔用 AI / LLM

Spec: docs/research/AS-03-cycle-detection/MODULE-08-DECISION-ENGINE.md §7
對應 commit: f33774e9 (2.5 5 個 adaptive params auto-calibrate)
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


def is_cache_valid(symbol: str) -> bool:
    """檢查 cache 係咪仍然 valid (7 日內)
    @returns True if cache 存在 + last_calibrated < 7 日前
    """
    path = _cache_path(symbol)
    if not path.exists():
        return False
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        last_calibrated = data.get("last_calibrated", 0)
        age = time.time() - last_calibrated
        return age < CACHE_EXPIRY_SECONDS
    except Exception as e:
        logger.warning(f"[adaptive_params_cache] is_cache_valid error for {symbol}: {e}")
        return False


def load_params(symbol: str) -> Optional[dict]:
    """從 cache 讀 params
    @returns dict if valid cache exists, else None
    """
    if not is_cache_valid(symbol):
        return None
    try:
        with open(_cache_path(symbol), "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f"[adaptive_params_cache] load_params error for {symbol}: {e}")
        return None


def save_params(symbol: str, params: dict) -> bool:
    """儲存 params 落 cache
    @returns True if success
    """
    if not params or not isinstance(params, dict):
        raise ValueError(f"Invalid params: {params!r}")
    # Path validation 放 try 外面 (ValueError 唔好被 except 吞)
    path = _cache_path(symbol)  # raises ValueError if invalid
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "symbol": symbol,
            "last_calibrated": time.time(),
            "params": params,
            "auto": True,  # 大少 11:39 confirm auto mode
        }
        # Atomic write: 寫 temp file 然後 rename (避免半寫狀態)
        tmp_path = path.with_suffix(".json.tmp")
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp_path, path)
        logger.info(f"[adaptive_params_cache] save_params OK: {symbol}")
        return True
    except Exception as e:
        logger.error(f"[adaptive_params_cache] save_params error for {symbol}: {e}")
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

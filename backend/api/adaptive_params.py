"""
api/adaptive_params.py — Adaptive Params API (大少 2026-08-08 16:30 Sprint 2 sub-task 2.6)

L2 JSON file cache endpoints for 5 個 adaptive params (M8 Decision Engine)
- GET    /api/adaptive-params/{symbol}     讀 cache (返 null if 過期)
- POST   /api/adaptive-params/{symbol}     儲存 params (前端的 calibrate result)
- DELETE /api/adaptive-params/{symbol}     刪 cache (「🔄 重新校準」按鈕)
- GET    /api/adaptive-params              列出所有 cached symbols (admin)

7 日 expiry: 大少 11:39 confirm
Stage 1 唔改 backend architecture, Stage 2 升 L3 DB

Spec: docs/research/AS-03-cycle-detection/MODULE-08-DECISION-ENGINE.md §7
對應 commit: f33774e9 (2.5 5 個 adaptive params auto-calibrate)
"""
from __future__ import annotations

import logging
import time
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services import adaptive_params_cache as cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/adaptive-params", tags=["adaptive-params"])


# ============================================================================
# Request/Response schemas
# ============================================================================

class AdaptiveParamsSave(BaseModel):
    """POST body — 5 個 adaptive params (前端 calibrate 完之後 save)"""
    ssiWeights: dict = Field(..., description="{ma, hl, trendline} 三個權重, 加埋 = 1.0")
    rsiWeight: float = Field(..., ge=0.0, le=1.0, description="RSI 情緒權重 [0.10, 0.50]")
    kellyFraction: str = Field(..., description="'half' | 'quarter' | 'octo'")
    markowitzCorr: dict = Field(..., description="{dailyWeekly, dailyMonthly, weeklyMonthly} [-1, +1]")
    hurstThresholds: dict = Field(..., description="{persistent, reverting}")


# ============================================================================
# Routes
# ============================================================================

@router.get("/{symbol}")
async def get_adaptive_params(symbol: str) -> dict:
    """讀取某 symbol 嘅 cached adaptive params

    Response:
    - 200: {symbol, last_calibrated, params, age_seconds, valid}
    - 404: cache not exist 或過期
    """
    data = cache.load_params(symbol)
    if data is None:
        raise HTTPException(404, f"Cache not exist or expired for {symbol}")
    last_calibrated = data.get("last_calibrated", 0)
    age = time.time() - last_calibrated
    return {
        "symbol": data.get("symbol"),
        "last_calibrated": last_calibrated,
        "age_seconds": int(age),
        "params": data.get("params"),
        "auto": data.get("auto", True),
        "valid": cache.is_cache_valid(symbol),
    }


@router.post("/{symbol}")
async def save_adaptive_params(symbol: str, req: AdaptiveParamsSave) -> dict:
    """儲存某 symbol 嘅 adaptive params 落 cache

    流程: 前端 calibrateAdaptiveParams() 計算完 5 個 params → POST 落 backend → cache
    將來 query 用 GET 讀
    """
    try:
        params_dict = req.dict()
        # Validate kellyFraction
        if params_dict.get("kellyFraction") not in ("half", "quarter", "octo"):
            raise HTTPException(400, "kellyFraction must be 'half' / 'quarter' / 'octo'")
        # Validate ssiWeights 加埋 = 1.0
        sw = params_dict.get("ssiWeights", {})
        sw_total = sw.get("ma", 0) + sw.get("hl", 0) + sw.get("trendline", 0)
        if abs(sw_total - 1.0) > 0.01:
            raise HTTPException(400, f"ssiWeights must sum to 1.0, got {sw_total}")
        success = cache.save_params(symbol, params_dict)
        if not success:
            raise HTTPException(500, f"Failed to save cache for {symbol}")
        return {
            "saved": True,
            "symbol": symbol,
            "params": params_dict,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[adaptive_params] save error for {symbol}: {e}")
        raise HTTPException(500, f"Save failed: {e}")


@router.delete("/{symbol}")
async def delete_adaptive_params(symbol: str) -> dict:
    """刪除某 symbol 嘅 cache (testing page 「🔄 重新校準」按鈕會 trigger)

    流程: DELETE → 前端重新 calibrate → POST 儲存
    """
    deleted = cache.delete_params(symbol)
    return {"deleted": deleted, "symbol": symbol}


@router.get("")
async def list_adaptive_params() -> dict:
    """列出所有有 cache 嘅 symbols (admin endpoint)"""
    symbols = cache.list_cached_symbols()
    return {"symbols": symbols, "count": len(symbols)}

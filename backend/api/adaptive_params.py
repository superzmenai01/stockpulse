"""
api/adaptive_params.py — Adaptive Params API (大少 2026-08-08 16:30 Sprint 2 sub-task 2.6 + Sprint 3 sub-task 9.4)

L2 JSON file cache endpoints for 5 個 adaptive params (M8 Decision Engine) + per-symbol optimal + forward return record
- GET    /api/adaptive-params/{symbol}                      讀 cache (返 null if 過期)
- POST   /api/adaptive-params/{symbol}                      儲存 params (前端的 calibrate result)
- DELETE /api/adaptive-params/{symbol}                      刪 cache (「🔄 重新校準」按鈕)
- GET    /api/adaptive-params                               列出所有 cached symbols (admin)
- GET    /api/adaptive-params/{symbol}/back-test            讀 optimal (30 日 expiry)
- POST   /api/adaptive-params/{symbol}/back-test            儲存 back test 嘅 optimal params
- POST   /api/adaptive-params/{symbol}/forward-return        加 forward return record (永久保留)
- GET    /api/adaptive-params/{symbol}/forward-return       拎 forward return history + stats

7 日 expiry (adaptive params), 30 日 expiry (optimal), 永久 (forward return)
Stage 1 唔改 backend architecture, Stage 2 升 L3 DB

Spec: docs/research/AS-03-cycle-detection/MODULE-08-DECISION-ENGINE.md §7
Spec: docs/research/AS-03-cycle-detection/MODULE-09-BACK-TEST.md §11
對應 commit: f33774e9 (2.5), e474a266 (9.3), 9.4 (Sprint 3)
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


class BackTestOptimalSave(BaseModel):
    """POST body for /back-test — 9.4 optimal params from back test"""
    kelly: float = Field(..., ge=0.0, le=1.0, description="Kelly fraction [0.125, 0.5]")
    rsiWeight: float = Field(..., ge=0.0, le=1.0, description="RSI weight [0.0, 1.0]")
    ssiWeights: dict = Field(..., description="{ma, hl, tl} 加埋 = 1.0")
    validation: Optional[dict] = Field(None, description="{avgValidateScore, stabilityScore, totalValidateSamples}")
    window: Optional[dict] = Field(None, description="{initialDays, finalDays, extendCount}")
    foldsCount: int = Field(3, description="Walk-forward CV folds count (default 3)")


class ForwardReturnRecord(BaseModel):
    """POST body for /forward-return — 9.4 永久保留 verdict + forward return record"""
    date: str = Field(..., description="ISO 'YYYY-MM-DD'")
    action: str = Field(..., description="FinalAction: BUY/ADD/HOLD/REDUCE/SELL/WAIT/TRAP/TRANSITION")
    fwd5: Optional[float] = Field(None, description="5 日 forward return %")
    fwd10: Optional[float] = Field(None, description="10 日 forward return %")
    fwd20: Optional[float] = Field(None, description="20 日 forward return %")
    hit: Optional[bool] = Field(None, description="fwd5 > 0")


# ============================================================================
# Routes — 5 個 adaptive params (Sprint 2 sub-task 2.6)
# ============================================================================

@router.get("/{symbol}")
async def get_adaptive_params(symbol: str) -> dict:
    """讀取某 symbol 嘅 cached adaptive params

    Response:
    - 200: {symbol, last_calibrated, params, age_seconds, valid, optimal, forward_return_count}
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
        # Sprint 3 sub-task 9.4 — extend response 加 optimal + forward return count
        "has_optimal": cache.is_optimal_valid(symbol),
        "forward_return_count": len(data.get("forward_return_history", [])),
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
    注意: optimal + forward_return_history 會一齊 delete (因為同一 file)
          大少 22:28 confirm 9.4: 永久保留, 但「🔄 重新校準」按鈕只清 adaptive params
    """
    deleted = cache.delete_params(symbol)
    return {"deleted": deleted, "symbol": symbol}


@router.get("")
async def list_adaptive_params() -> dict:
    """列出所有有 cache 嘅 symbols (admin endpoint)"""
    symbols = cache.list_cached_symbols()
    return {"symbols": symbols, "count": len(symbols)}


# ============================================================================
# Routes — 9.4 Back Test Optimal (Sprint 3 sub-task 9.4)
# ============================================================================

@router.get("/{symbol}/back-test")
async def get_back_test_optimal(symbol: str) -> dict:
    """讀取某 symbol 嘅 back test optimal (30 日 expiry)

    Response:
    - 200: {symbol, last_backtest, optimal_params, validation, window, folds_count, age_seconds, valid}
    - 404: 冇 optimal 或過期
    """
    data = cache.load_optimal(symbol)
    if data is None:
        raise HTTPException(404, f"Optimal not exist or expired for {symbol}")
    optimal = data.get("optimal", {})
    last_backtest = optimal.get("last_backtest", 0)
    age = time.time() - last_backtest
    return {
        "symbol": symbol,
        "last_backtest": last_backtest,
        "age_seconds": int(age),
        "optimal_params": optimal.get("optimal_params"),
        "validation": optimal.get("validation"),
        "window": optimal.get("window"),
        "folds_count": optimal.get("folds_count", 3),
        "valid": cache.is_optimal_valid(symbol),
    }


@router.post("/{symbol}/back-test")
async def save_back_test_optimal(symbol: str, req: BackTestOptimalSave) -> dict:
    """儲存 back test 嘅 optimal params 落 cache (30 日 expiry)

    流程: testing page 跑 back test 完 → 揾 best params → POST 落 backend → cache
    將來 query 用 GET 讀, M8 verdict 用 cache 嘅 optimal 取代 default
    """
    try:
        # Validate ssiWeights sum = 1.0
        sw = req.ssiWeights
        sw_total = sw.get("ma", 0) + sw.get("hl", 0) + sw.get("tl", 0)
        if abs(sw_total - 1.0) > 0.01:
            raise HTTPException(400, f"ssiWeights must sum to 1.0, got {sw_total}")

        optimal_params = {
            "kelly": req.kelly,
            "rsiWeight": req.rsiWeight,
            "ssiWeights": req.ssiWeights,
        }
        success = cache.save_optimal(
            symbol,
            optimal_params,
            validation=req.validation,
            window=req.window,
            folds_count=req.foldsCount,
        )
        if not success:
            raise HTTPException(500, f"Failed to save optimal for {symbol}")
        return {
            "saved": True,
            "symbol": symbol,
            "optimal_params": optimal_params,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[adaptive_params] save_back_test_optimal error for {symbol}: {e}")
        raise HTTPException(500, f"Save failed: {e}")


# ============================================================================
# Routes — 9.4 Forward Return Record (永久保留)
# ============================================================================

@router.post("/{symbol}/forward-return")
async def add_forward_return(symbol: str, req: ForwardReturnRecord) -> dict:
    """加一條 forward return record 落 cache history (永久保留)

    流程: 每次 replay verdict 對比 5/10/20 日後真實升跌 → POST 落 backend
    累積 records 用嚟 build per-symbol 成績表 + 將來 Stage 1+ forward return tracking
    """
    try:
        record = req.dict()
        success = cache.add_forward_return_record(symbol, record)
        if not success:
            raise HTTPException(500, f"Failed to add record for {symbol}")
        return {
            "saved": True,
            "symbol": symbol,
            "record": record,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[adaptive_params] add_forward_return error for {symbol}: {e}")
        raise HTTPException(500, f"Save failed: {e}")


@router.get("/{symbol}/forward-return")
async def get_forward_return(symbol: str, limit: Optional[int] = None,
                             half_life_days: int = 180) -> dict:
    """拎 forward return history + 半衰期 weighted stats (大少 22:28 確認 6 月半衰期)

    Response:
    - 200: {symbol, history: [...], stats: {hit_rate_5d, avg_return_5d, sample_count, half_life_days}, count}
    - 404: 冇 history
    """
    history = cache.get_forward_return_history(symbol, limit=limit)
    if not history:
        raise HTTPException(404, f"No forward return history for {symbol}")
    stats = cache.compute_forward_return_stats(symbol, half_life_days=half_life_days)
    return {
        "symbol": symbol,
        "history": history,
        "stats": stats,
        "count": len(history),
    }


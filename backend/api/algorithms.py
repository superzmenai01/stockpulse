"""
backend/api/algorithms.py — Algorithms unified API (大少 2026-08-20 Phase 1)

凡人話: 統一 endpoint 跑任何 algorithm, 之後 M1/M2 加落 framework 唔使加新 route
- GET /api/algorithms/run?algo=zigzag&symbol=HK.00700&threshold=5
- GET /api/algorithms/list (拎 available algorithms)
- GET /api/algorithms/health (framework health check)

對應 backup: backups/zigzag-frontend-2026-08-20/RESTORE.md
Spec: docs/research/AS-03-cycle-detection/MODULE-XX-*.md
Algorithm: 統一 endpoint + registry dispatch (唔係每個 algo 一個 router)
凡人話: 一個 endpoint 處理所有 algorithm, 大少唔使記多個 URL
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from backend.services.algorithm_runner import run_algorithm
from backend.algorithms import list_algorithms

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/algorithms", tags=["algorithms"])


@router.get("/run")
async def run_algo(
    algo: str = Query(..., description="Algorithm 名 (e.g. zigzag)"),
    symbol: str = Query(..., description="股票代號 (e.g. HK.00700, US.INTC)"),
    period: str = Query("1d", description="K 線週期 (1d / 1w / 1M)"),
    data_window_days: int = Query(1260, description="拎幾多日 K 線 (默認 1260 = 5 年)"),
    threshold: Optional[float] = Query(
        None,
        description="ZigZag legacy threshold (向後兼容 ChartContainer.tsx), 唔 specify 用 algorithm 默認 (5%)"
    ),
    # 大少 2026-08-30 22:04 — 4.43.0 新加 4 個 ZigZag params (對齊 testing page LS 拎法, frontend 拎 LS value 傳 backend)
    threshold_mode: str = Query(
        "auto",
        description="auto | manual (對齊 testing page LS_KEY_THRESHOLD_MODE)"
    ),
    manual_threshold: Optional[float] = Query(
        None,
        description="1-20, only used if threshold_mode=manual (對齊 testing page LS_KEY_MANUAL_THRESHOLD)"
    ),
    lookback: int = Query(
        20,
        description="5-100, only used if threshold_mode=auto (對齊 testing page LS_KEY_LOOKBACK)"
    ),
    multiplier: float = Query(
        2.5,
        description="1-5, only used if threshold_mode=auto (永久 2.5)"
    ),
):
    """凡人話: 跑 algorithm (4.43.0 加 4 個 ZigZag 新 params + validation)

    Query params:
    - algo: 揀邊個 algorithm (e.g. "zigzag", 之後 M1/M2 落 framework 自動 available)
    - symbol: 股票代號 (e.g. "HK.00700")
    - period: K 線週期
    - data_window_days: 拎幾多日 K 線 (默認 1260 = 5 年, 大少 2026-08-14 23:15 永久 rule)
    - threshold: 個別 algorithm 嘅自訂參數 (向後兼容 ChartContainer.tsx, 冇 specify 用 algorithm 默認 5%)
    - threshold_mode: 'auto' | 'manual' (對齊 testing page 拎法)
    - manual_threshold: 1-20, only used if threshold_mode=manual
    - lookback: 5-100, only used if threshold_mode=auto
    - multiplier: 1-5, only used if threshold_mode=auto (永久 2.5)

    4 個新 params validation (大少 4.43.0 safety improvement #1):
    - threshold_mode: 必須 'auto' 或 'manual', 否則 fallback 'auto'
    - lookback: clamp 5-100
    - multiplier: clamp 1.0-5.0
    - manual_threshold: 必須 1-20, 否則 fallback None (即係用 auto)

    Returns:
        統一 response shape (跟 run_algorithm 返 shape 一樣):
        {
            "ok": bool,
            "algorithm": str,
            "version": str,
            "symbol": str,
            "period": str,
            "klines_count": int,
            "points": [...],
            "meta": {...},
            "warnings": [...],
            "error": str | None,
        }
    """
    # 大少 2026-08-30 22:04 — 4.43.0 safety improvement #1: backend validation
    # 凡人話: 4 個新 params 防止 frontend pass 錯 value trigger silent bug
    if threshold_mode not in ("auto", "manual"):
        threshold_mode = "auto"
    lookback = max(5, min(100, lookback))
    multiplier = max(1.0, min(5.0, multiplier))
    if manual_threshold is not None and not (1 <= manual_threshold <= 20):
        manual_threshold = None

    # 凡人話: 4 個新 options 永遠 pass 畀 algorithm (auto/manual fallback 喺 algorithm 入面)
    options: dict = {
        "threshold_mode": threshold_mode,
        "manual_threshold": manual_threshold,
        "lookback": lookback,
        "multiplier": multiplier,
    }
    # 兼容: manual mode 用 manual_threshold, 否則 fallback legacy threshold (ChartContainer.tsx 用緊)
    if manual_threshold is not None and threshold_mode == "manual":
        options["threshold"] = float(manual_threshold)
    elif threshold is not None:
        options["threshold"] = float(threshold)

    try:
        result = run_algorithm(
            algo_name=algo,
            symbol=symbol,
            period=period,
            data_window_days=data_window_days,
            **options
        )
        if not result["ok"]:
            # 凡人話: algorithm 跑失敗, return 400 畀 frontend 顯示
            # (warning vs error: warning = verdict 仲可信; error = verdict 唔可信)
            raise HTTPException(400, result.get("error", "algorithm failed"))
        return result
    except KeyError as e:
        # 凡人話: algorithm 名唔存在
        raise HTTPException(400, f"Algorithm 唔存在: {e}")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[Algorithms API] run 失敗: algo={algo}, symbol={symbol}")
        raise HTTPException(500, f"內部錯誤: {e}")


@router.get("/list")
async def list_algos():
    """凡人話: 拎所有 available algorithms 嘅 name list

    Returns:
        {"algorithms": ["zigzag", "M1", ...]}
    """
    return {
        "algorithms": list_algorithms(),
    }


@router.get("/health")
async def health():
    """Algorithm framework health check"""
    return {
        "status": "ok",
        "framework": "algorithms",
        "version": "1.0.0",
        "available": list_algorithms(),
    }


@router.get("/progress/{request_id}")
async def get_algorithm_progress(request_id: str):
    """凡人話: 拎 algorithm progress (M9 跑 30-60 秒嗰陣 frontend polling 拎 progress)

    永久 rule (大少 2026-08-31 P0-5):
    - request_id 永久由 caller (e.g. spawn_m9_with_progress) 拎
    - response 包含 status (running / completed / failed) + stage label + percent
    - 完成後 verdict_dict 包含完整 M9 verdict (frontend polling 拎到 render 結果)
    - TTL 1 小時, 超時自動清
    """
    from backend.services.algorithm_progress import get_progress
    progress = get_progress(request_id)
    if progress is None:
        raise HTTPException(404, f"Request ID {request_id} 唔存在或已過期 (TTL 1 小時)")
    return progress


@router.get("/progress")
async def list_active_progress():
    """凡人話: 拎全部 active 嘅 algorithm progress request (debug / monitoring 用)"""
    from backend.services.algorithm_progress import _PROGRESS_STORE
    import time as _time
    now = _time.time()
    active = [
        {
            "request_id": rid,
            "algo_name": p.get("algo_name"),
            "symbol": p.get("symbol"),
            "status": p.get("status"),
            "stage": p.get("stage"),
            "percent": p.get("percent"),
            "started_at": p.get("started_at"),
            "age_seconds": round(now - p.get("started_at", now), 1),
        }
        for rid, p in _PROGRESS_STORE.items()
        if p.get("status") == "running"
    ]
    return {"active_requests": active, "count": len(active)}

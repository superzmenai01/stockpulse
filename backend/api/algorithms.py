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
        description="ZigZag 過濾 noise 門檻 (%), 唔 specify 用 algorithm 默認 (5%)"
    ),
):
    """凡人話: 跑 algorithm

    Query params:
    - algo: 揀邊個 algorithm (e.g. "zigzag", 之後 M1/M2 落 framework 自動 available)
    - symbol: 股票代號 (e.g. "HK.00700")
    - period: K 線週期
    - data_window_days: 拎幾多日 K 線 (默認 1260 = 5 年, 大少 2026-08-14 23:15 永久 rule)
    - threshold: 個別 algorithm 嘅自訂參數 (e.g. ZigZag 嘅 5% 門檻)

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
    # Algorithm 自訂 options (跟 algorithm 入面 options 結構)
    options: dict = {}
    if threshold is not None:
        options["threshold"] = threshold

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

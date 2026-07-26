"""
api/debug.py — Debug panel API endpoints (大少 2026-07-24)

Routes:
- GET /api/debug/last_run       — 最新一 run 嘅 step-by-step data
- GET /api/debug/runs           — 最近 10 runs (ring buffer)
- GET /api/debug/status         — popularity job status + summary
- GET /api/debug/health         — debug system health check
"""
from fastapi import APIRouter
from debug import DEBUG_ENABLED, get_debug

router = APIRouter(prefix="/api/debug", tags=["debug"])


@router.get("/last_run")
async def get_last_run() -> dict:
    """最新一 run 嘅 step-by-step data"""
    debug = get_debug()
    run = debug.get_last_run()
    if run is None:
        return {
            "run": None,
            "message": "未執行過任何 run。試下喺 StockPulse UI execute AS-01 algorithm。",
            "hint": "/api/plates/run",
        }
    return {"run": run}


@router.get("/runs")
async def get_all_runs() -> dict:
    """最近 10 runs (ring buffer)"""
    debug = get_debug()
    runs = debug.get_all_runs()
    return {
        "runs": runs,
        "count": len(runs),
        "max_runs": 10,
        "debug_enabled": DEBUG_ENABLED,
    }


@router.get("/status")
async def get_debug_status() -> dict:
    """Popularity job status + summary"""
    debug = get_debug()
    return debug.get_status()


@router.get("/health")
async def debug_health() -> dict:
    """Debug system health check"""
    debug = get_debug()
    return {
        "status": "ok",
        "debug_enabled": DEBUG_ENABLED,
        "runs_buffer_size": len(debug.runs),
        "popularity_state": debug.popularity_status.get("state"),
    }
"""
api/saved_runs.py — Saved Algorithm Runs API (大少 2026-07-24)

Modular FastAPI router (大少 modular block architecture):
- POST   /api/saved-runs        儲存 (auto-name 或 user-name)
- GET    /api/saved-runs        列出 (optional filter by algorithm_id)
- GET    /api/saved-runs/{id}   載入 detail (含 stocks + metadata)
- PUT    /api/saved-runs/{id}   改 name / note
- DELETE /api/saved-runs/{id}   刪除

DB init 喺 main.py lifespan 啟動時呼叫 `init_saved_runs_table()`。
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from models import saved_runs as model

router = APIRouter(prefix="/api/saved-runs", tags=["saved-runs"])


# ============================================================================
# Request/Response schemas
# ============================================================================

class SaveRunRequest(BaseModel):
    """POST body — 儲存新 result"""
    algorithm_id: str = Field(..., description="e.g. 'AS-01'")
    algorithm_name: str = Field(..., description="e.g. '板塊龍頭股'")
    stocks: list[str] = Field(..., description="Stock codes list, e.g. ['HK.00981', ...]")
    metadata: dict = Field(default_factory=dict, description="{plates, top_n, ...}")
    name: Optional[str] = Field(None, description="User-given name (optional, auto-generate if 唔提供)")
    note: Optional[str] = Field(None, description="Optional 備註")


class UpdateRunRequest(BaseModel):
    """PUT body — update name / note (大少 #7051: editable)"""
    name: Optional[str] = Field(None, description="新名稱 (optional)")
    note: Optional[str] = Field(None, description="新備註 (optional)")


# ============================================================================
# Routes
# ============================================================================

@router.post("")
async def save_run(req: SaveRunRequest) -> dict:
    """
    儲存新 result。
    - name 唔提供 → auto-generate `{algorithm_name} {YYYY-MM-DD} {HHMM}`
    - 撞名 → auto-append `-2`, `-3`
    """
    try:
        return model.save_run(
            algorithm_id=req.algorithm_id,
            algorithm_name=req.algorithm_name,
            stocks=req.stocks,
            metadata=req.metadata,
            name=req.name,
            note=req.note,
        )
    except Exception as e:
        raise HTTPException(500, f"Save failed: {e}")


@router.get("")
async def list_runs(
    algorithm_id: Optional[str] = Query(None, description="Filter by algorithm, e.g. 'AS-01'"),
) -> dict:
    """
    列出所有 saved runs (新至舊 sort)。
    - algorithm_id 唔提供 → 返全部
    - algorithm_id 提供 → 返該 algorithm 嘅 runs
    """
    runs = model.list_runs(algorithm_id=algorithm_id)
    return {"runs": runs, "count": len(runs)}


@router.get("/{run_id}")
async def get_run(run_id: int) -> dict:
    """載入 1 個 saved run by id (含 stocks + metadata)。"""
    run = model.get_run(run_id)
    if not run:
        raise HTTPException(404, f"Run #{run_id} not found")
    return run


@router.put("/{run_id}")
async def update_run(run_id: int, req: UpdateRunRequest) -> dict:
    """
    Update name / note (大少 #7051: editable)。
    - 唔可以改 algorithm_id/stocks (鎖死)
    - 撞名 → 400 error
    """
    try:
        result = model.update_run(
            run_id=run_id,
            name=req.name,
            note=req.note,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not result:
        raise HTTPException(404, f"Run #{run_id} not found")
    return result


@router.delete("/{run_id}")
async def delete_run(run_id: int) -> dict:
    """刪 1 個 saved run (大少 #7051: can delete)。"""
    ok = model.delete_run(run_id)
    if not ok:
        raise HTTPException(404, f"Run #{run_id} not found")
    return {"deleted": True, "id": run_id}
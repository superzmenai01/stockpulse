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
    stocks: list[str] = Field(
        default_factory=list,
        description="(optional) Stock codes list, e.g. ['HK.00981', ...] — 可由 saved_stocks 自動 derive"
    )
    # 大少 2026-07-26 #7566: 完整 snapshot 數據 (price / change_pct / mcap / turnover / plate_name 等)
    saved_stocks: list[dict] = Field(
        default_factory=list,
        description="(大少 #7566) Full Leader snapshot per stock — 在 ViewRunModal table 顯示"
    )
    metadata: dict = Field(default_factory=dict, description="{plates, top_n, ...}")
    name: Optional[str] = Field(None, description="User-given name (optional, auto-generate if 唔提供)")
    note: Optional[str] = Field(None, description="Optional 備註")


class UpdateRunRequest(BaseModel):
    """PUT body — update name / note / saved_stocks (大少 #7051 + #8762)"""
    name: Optional[str] = Field(None, description="新名稱 (optional)")
    note: Optional[str] = Field(None, description="新備註 (optional)")
    # 大少 #8762 (2026-07-29): 加 saved_stocks 支援 stock list editable
    # - 提供時 backend 會 derive stocks (codes list) 自動 derive + persist
    saved_stocks: Optional[list[dict]] = Field(
        None,
        description="(optional) Full saved stock snapshot per stock — 提供時會一齊更新 stocks column"
    )


# ============================================================================
# Routes
# ============================================================================

@router.post("")
async def save_run(req: SaveRunRequest) -> dict:
    """
    儲存新 result。
    - name 唔提供 → auto-generate `{algorithm_name} {YYYY-MM-DD} {HHMM}`
    - 撞名 → auto-append `-2`, `-3`
    - 大少 2026-07-26 #7566: 接受 saved_stocks (full snapshot), stocks 自動 derived if 唔提供
    """
    try:
        return model.save_run(
            algorithm_id=req.algorithm_id,
            algorithm_name=req.algorithm_name,
            stocks=req.stocks,
            saved_stocks=req.saved_stocks,
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


# ============================================================================
# 大少 #8960 (2026-07-29): LibraryPage reorder + pin 功能 嘅 endpoints
# ============================================================================

class ReorderRequest(BaseModel):
    ordered_ids: list[int] = Field(..., description="新嘅 display order (前 = 排前)")


class PinRequest(BaseModel):
    pinned: bool = Field(..., description="置頂 (True) / 取消置頂 (False)")


@router.post("/reorder")
async def reorder_runs(req: ReorderRequest) -> dict:
    """
    [POST reorder] 將 saved runs 按 ordered_ids 嘅 list 重新排序。
    - per-row up/down arrow button 用呢個 endpoint 一次性 save 全部
    - 唔喺 list 入面嘅 runs 嘅 position 唔變
    """
    try:
        runs = model.reorder_runs(req.ordered_ids)
        return {"runs": runs, "count": len(runs)}
    except Exception as e:
        raise HTTPException(500, f"Reorder failed: {e}")


@router.post("/{run_id}/pin")
async def pin_run(run_id: int, req: PinRequest) -> dict:
    """[POST pin] 設置 is_pinned (per-row 📌 button toggle)。"""
    run = model.pin_run(run_id, req.pinned)
    if not run:
        raise HTTPException(404, f"Run #{run_id} not found")
    return run


# ============================================================================
# 大少 #8960 (2026-07-29): LibraryPage 排位 + 置頂 嘅 endpoints
# ============================================================================

class ReorderRequest(BaseModel):
    ordered_ids: list[int] = Field(
        ...,
        description="New display order — front element sorts to top"
    )


class PinRequest(BaseModel):
    pinned: bool = Field(
        ...,
        description="Pin to top (True) / unpin (False)"
    )


@router.post("/reorder")
async def reorder_runs(req: ReorderRequest) -> dict:
    """Set positions based on ordered_ids list (大少 #8960: 排位)."""
    try:
        runs = model.reorder_runs(req.ordered_ids)
        return {"runs": runs, "count": len(runs)}
    except Exception as exc:
        raise HTTPException(500, f"Reorder failed: {exc}")


@router.post("/{run_id}/pin")
async def pin_run(run_id: int, req: PinRequest) -> dict:
    """Toggle is_pinned (大少 #8960: 置頂)."""
    run = model.pin_run(run_id, req.pinned)
    if not run:
        raise HTTPException(404, f"Run #{run_id} not found")
    return run


@router.put("/{run_id}")
async def update_run(run_id: int, req: UpdateRunRequest) -> dict:
    """
    Update name / note / saved_stocks (大少 #7051 + #8762)。
    - 唔可以改 algorithm_id (鎖死)
    - saved_stocks 提供時會自動 derive `stocks` (codes list) 保持同步
    - 撞名 → 400 error
    """
    try:
        result = model.update_run(
            run_id=run_id,
            name=req.name,
            note=req.note,
            saved_stocks=req.saved_stocks,
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
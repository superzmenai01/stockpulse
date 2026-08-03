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
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from models import saved_runs as model
# 大少 2026-08-03 #9920: stock_reasons model — cross-table insert on save_run
from models import stock_reasons as reasons_model
from services.html_sanitizer import sanitize_html

router = APIRouter(prefix="/api/saved-runs", tags=["saved-runs"])

# 大少 2026-08-03 #9920: logger for reasons insert diagnostics
logger = logging.getLogger(__name__)


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
    # 大少 2026-08-03 #9920: per-stock HTML reasons (algorithm-generated, sanitized server-side)
    # - Each reason dict: {code, source_type, source_ref, title, html}
    # - source_run_id auto-set to new run.id after save_run() returns
    # - Smart Dedupe via UNIQUE(code, source_type, source_ref) ON CONFLICT UPDATE
    reasons: list[dict] = Field(
        default_factory=list,
        description="(大少 #9920) Per-stock HTML reason reports — sanitized server-side + inserted into stock_reasons"
    )


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
    - 大少 2026-08-03 #9920: 接受 reasons (per-stock HTML reports) — sanitized + inserted into stock_reasons
      with source_run_id = new run.id. Smart Dedupe via UNIQUE(code, source_type, source_ref).
    """
    try:
        saved_run = model.save_run(
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

    new_run_id = saved_run.get("id")

    # 大少 #9920 (2026-08-03 23:30 fix): collect ALL reasons (user-provided + auto-built)
    all_reasons: list[dict] = []

    # 1. User-provided reasons (frontend explicit — 將來 manual UI / news 等用)
    if req.reasons:
        for r in req.reasons:
            # Sanitize HTML server-side (defense-in-depth)
            raw_html = r.get("html", "")
            sanitized = sanitize_html(raw_html)
            all_reasons.append({
                "code": r.get("code", ""),
                "source_type": r.get("source_type", "algorithm"),
                "source_ref": r.get("source_ref", req.algorithm_id),
                "title": r.get("title", ""),
                "html": sanitized,
                "source_run_id": new_run_id,
            })

    # 2. Auto-build AS-02 reasons from saved_stocks raw data (大少 #9920 23:30 fix)
    # - Frontend AS-02 panel send saved_stocks 入面已經有 raw fields (breakdown / reasons / analysis_text)
    #   因為 AS02Stock extends Leader, qualifiedResults 實際帶晒呢啲 fields
    # - Backend 自動 detect + call build_as02_reason_html() per stock → 唔使 frontend 額外 wire
    # - Smart Dedupe: 同 (code, source_type, source_ref) 自動 overwrite → 永遠 latest
    if req.algorithm_id == "AS-02" and req.saved_stocks:
        try:
            from services.as02_analyzer import build_as02_reason_html
            auto_built = 0
            for stock in req.saved_stocks:
                if "breakdown" in stock:  # only if raw AS-02 data present
                    html = build_as02_reason_html(stock)
                    all_reasons.append({
                        "code": stock.get("code", ""),
                        "source_type": "algorithm",
                        "source_ref": "AS-02",
                        "title": "公司質素分析篩選",
                        "html": html,
                        "source_run_id": new_run_id,
                    })
                    auto_built += 1
            if auto_built > 0:
                logger.info(
                    f"[save_run] AS-02 auto-build {auto_built} reasons for run #{new_run_id}"
                )
        except Exception as e:
            logger.warning(f"[save_run] AS-02 auto-build failed: {e}")
            # Don't fail the whole save — reasons are secondary

    # 3. Auto-build AS-01 reasons (大少 #10075, 2026-08-04)
    # - AS-01 saved_stocks 入面已經有 raw fields (mcap_rank / volume_rank / score / plate_name)
    #   因為 frontend AS-01 panel 唔 normalize strip 啲 fields
    # - Backend 自動 detect + call build_as01_reason_html() per stock
    # - plate_total_stocks = 該板塊內 valid stocks 總數 (用嚟計算 rank 嘅相對 width)
    if req.algorithm_id == "AS-01" and req.saved_stocks:
        try:
            from models.plate import build_as01_reason_html
            auto_built = 0
            # Group stocks by plate_code (因為 width 計算 per-plate)
            plates: dict[str, list[dict]] = {}
            for stock in req.saved_stocks:
                if "mcap_rank" in stock and "volume_rank" in stock:  # only raw AS-01 data present
                    pc = stock.get("plate_code", "")
                    plates.setdefault(pc, []).append(stock)

            for plate_code, plate_stocks in plates.items():
                plate_total = len(plate_stocks)
                for stock in plate_stocks:
                    html = build_as01_reason_html(stock, plate_total_stocks=plate_total)
                    all_reasons.append({
                        "code": stock.get("code", ""),
                        "source_type": "algorithm",
                        "source_ref": "AS-01",
                        "title": "板塊龍頭股篩選",
                        "html": html,
                        "source_run_id": new_run_id,
                    })
                    auto_built += 1
            if auto_built > 0:
                logger.info(
                    f"[save_run] AS-01 auto-build {auto_built} reasons for run #{new_run_id}"
                )
        except Exception as e:
            logger.warning(f"[save_run] AS-01 auto-build failed: {e}")
            # Don't fail the whole save — reasons are secondary

    # Bulk insert all reasons with smart dedupe
    if all_reasons:
        try:
            reasons_model.upsert_reasons_batch(all_reasons)
            logger.info(
                f"[save_run] Inserted {len(all_reasons)} reasons for run #{new_run_id}"
            )
        except ValueError as e:
            logger.warning(f"[save_run] reasons insert validation failed: {e}")
            # Don't fail the whole save — reasons are secondary
        except Exception as e:
            logger.error(f"[save_run] reasons insert failed: {e}")

    return saved_run


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
"""
api/stock_reasons.py — Stock Reasons CRUD API (大少 2026-08-03 #9920)

Endpoints:
- GET    /api/stock-reasons?code=***        List active reasons for a stock (newest first)
- GET    /api/stock-reasons/{id}             Single reason by id
- POST   /api/stock-reasons                  Create (sanitize + size check + UNIQUE dedupe)
- PUT    /api/stock-reasons/{id}             Update title/html
- DELETE /api/stock-reasons/{id}             Soft delete

DB init 喺 main.py lifespan 啟動時呼叫 `init_stock_reasons_table()`.

Design notes (大少 confirmed Q1/Q2/Q3):
- Q1: Smart Dedupe — UNIQUE(code, source_type, source_ref) ON CONFLICT DO UPDATE
       (latest run 自動 overwrite earlier run)
- Q2: 舊 saved_stocks[i].reason string 已 wipe (testing data only)
- Q3: Table name = stock_reasons
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from models import stock_reasons as model
from services.html_sanitizer import sanitize_html

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/stock-reasons", tags=["stock-reasons"])  # 跟 stocks.py 嘅 pattern, /api 由 main.py 加


# ============================================================================
# Request/Response schemas
# ============================================================================

VALID_SOURCE_TYPES = {"algorithm", "manual", "news", "research"}


class CreateReasonRequest(BaseModel):
    """POST body — create new reason"""
    code: str = Field(..., description="Stock code, e.g. 'HK.00981'")
    source_type: str = Field(..., description="One of: algorithm, manual, news, research")
    source_ref: str = Field(..., description="Algorithm ID (e.g. 'AS-02') or manual ref")
    title: str = Field(..., description="Display title, e.g. '公司質素分析篩選'")
    html: str = Field(..., description="Sanitized HTML content (will be sanitized server-side)")
    source_run_id: Optional[int] = Field(None, description="Link to saved_algorithm_runs.id if algorithm-generated")


class UpdateReasonRequest(BaseModel):
    """PUT body — update existing reason (title/html only)"""
    title: Optional[str] = Field(None, description="New title (optional)")
    html: Optional[str] = Field(None, description="New HTML content (will be sanitized)")


# ============================================================================
# Routes
# ============================================================================

@router.post("")
async def create_reason(req: CreateReasonRequest) -> dict:
    """
    Create new reason. Smart Dedupe — if (code, source_type, source_ref) exists,
    OVERWRITE with latest (title, html, source_run_id, updated_at).

    HTML 會喺 server-side sanitize (bleach + post-scrub regex) + size check (50KB).
    Returns the upserted reason dict.
    """
    # Validate source_type (defense layer, also enforced by model)
    if req.source_type not in VALID_SOURCE_TYPES:
        raise HTTPException(
            400,
            f"source_type '{req.source_type}' 唔合法. 必須係其中之一: {sorted(VALID_SOURCE_TYPES)}"
        )

    # Sanitize HTML server-side (defense-in-depth — caller 也可能要 sanitize)
    sanitized_html = sanitize_html(req.html)

    try:
        result = model.create_reason(
            code=req.code,
            source_type=req.source_type,
            source_ref=req.source_ref,
            title=req.title,
            html=sanitized_html,
            source_run_id=req.source_run_id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.error(f"[create_reason] failed: {e}")
        raise HTTPException(500, f"Create failed: {e}")
    return result


@router.get("")
async def list_reasons(
    code: Optional[str] = Query(None, description="Stock code, e.g. 'HK.00981'"),
    source_run_id: Optional[int] = Query(None, description="(大少 #10103) Filter by codes in this run's saved_stocks"),
    include_inactive: bool = Query(False, description="Include soft-deleted reasons (audit)"),
) -> dict:
    """
    List active reasons for a stock, newest first.

    Default: only is_active=1. Pass include_inactive=true for audit.

    大少 Option C (2026-08-04 07:03) Per-run scoping + is_stale flag:
    - 如果有 source_run_id, 攞嗰個 run's algorithm_id + saved_stocks codes
      → SQL filter: code IN (run's codes) — 唔 filter source_ref (保留 accumulation)
      → 每個 returned reason 加 is_stale runtime flag
    - is_stale 定義 (model layer):
      * is_stale = (reason.source_run_id != current_run_id) AND
                   (reason.source_ref != current_run.algorithm_id)
      * 跨-run AND 跨-algorithm = stale
      * 其他 cases (cross-run same-algo / same-run / cross-algo same-run) 全部 NOT stale
    - Caller (UI) 收到 reasons + is_stale，自己決定 hide 邊啲
    - 效果:
      ✅ 保留跨-run same-algorithm accumulation (#83 + #86 都 AS-01 → 兩條都見)
      ✅ 避免跨-algorithm cross-run stale leak (#86 AS-01 view 唔見 #52 AS-02)
    - 如果 caller 唔傳 source_run_id (e.g. AS-01「結果」頁面 inline render)，
      response 入面 is_stale 全部 False (冇 caller context 點樣判定 stale)
    - 至少要提供 code 或 source_run_id 其中一個
    """
    if not code and not source_run_id:
        raise HTTPException(400, "Either 'code' or 'source_run_id' is required")

    reasons = model.list_reasons_filtered(
        code=code,
        source_run_id=source_run_id,
        include_inactive=include_inactive,
    )
    return {"reasons": reasons, "count": len(reasons)}


@router.get("/{reason_id}")
async def get_reason(reason_id: int) -> dict:
    """Get single reason by id (active or inactive)."""
    reason = model.get_reason(reason_id)
    if not reason:
        raise HTTPException(404, f"Reason #{reason_id} not found")
    return reason


@router.put("/{reason_id}")
async def update_reason(reason_id: int, req: UpdateReasonRequest) -> dict:
    """
    Update title/html of existing reason.
    source_type / source_ref / code 唔可以改 (會違反 UNIQUE constraint semantic)。
    """
    if req.title is None and req.html is None:
        raise HTTPException(400, "At least one of title/html must be provided")

    # Sanitize HTML if provided
    sanitized_html = sanitize_html(req.html) if req.html is not None else None

    try:
        result = model.update_reason(
            reason_id=reason_id,
            title=req.title,
            html=sanitized_html,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not result:
        raise HTTPException(404, f"Reason #{reason_id} not found")
    return result


@router.delete("/{reason_id}")
async def soft_delete_reason(reason_id: int) -> dict:
    """
    Soft delete (set is_active=0). Returns True if deleted.

    Q3 design: data preserved for audit trail. Row 留喺 DB.
    """
    ok = model.soft_delete_reason(reason_id)
    if not ok:
        raise HTTPException(404, f"Reason #{reason_id} not found or already inactive")
    return {"deleted": True, "id": reason_id}
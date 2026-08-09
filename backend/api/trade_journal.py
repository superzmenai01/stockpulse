"""
api/trade_journal.py — Trade Journal API (Stage 1+ MVP + Followup, 大少 15:04 揀 Full scope)

Modular FastAPI router:
- POST /api/trade-journal           加 entry
- GET  /api/trade-journal           列出 entries (optional filter by symbol)
- GET  /api/trade-journal/stats     統計 6 個 metrics (Stage 1+ followup)
- GET  /api/trade-journal/{id}      拎單一 entry
- PUT  /api/trade-journal/{id}      Mark 啱/錯 + 改 actual exit (Stage 1+ followup)
- DELETE /api/trade-journal/{id}    刪 entry (Stage 1+ followup)

DB init 喺 main.py lifespan 啟動時呼叫 `init_trade_journal_table()`.

Spec: docs/research/AS-03-cycle-detection/MODULE-10-TRADE-JOURNAL.md
"""
import logging
import re
import sqlite3
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from models import trade_journal as model

router = APIRouter(prefix="/api/trade-journal", tags=["trade-journal"])

logger = logging.getLogger(__name__)

DATE_REGEX = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# ============================================================================
# Pydantic schemas
# ============================================================================

class TradeJournalAdd(BaseModel):
    symbol: str = Field(..., min_length=3, max_length=20, description="股票 code, e.g. 'HK.00700' / 'US.AAPL'")
    entry_date: str = Field(..., description="買入日期 YYYY-MM-DD")
    entry_price: float = Field(..., gt=0, description="買入價 (must > 0)")
    shares: float = Field(default=1.0, gt=0, description="買入股數 (default 1)")
    target_price: Optional[float] = Field(default=None, gt=0, description="目標價 (optional, 留空 = 算法自動)")
    stop_loss: Optional[float] = Field(default=None, gt=0, description="止蝕價 (optional, 留空 = 算法自動)")
    notes: Optional[str] = Field(default="", description="大少 備註 (optional)")


# Stage 1+ followup (大少 15:04 揀 Full scope): PUT 改 entry schema
class TradeJournalUpdate(BaseModel):
    """PUT body — 全部 optional, 只 update 有 fill in 嘅 field.

    大少 15:04 default #4: is_correct 手動 mark, True = 啱, False = 錯, 唔傳 = 唔改
    """
    actual_exit_date: Optional[str] = Field(default=None, description="真實賣出日期 YYYY-MM-DD (optional)")
    actual_exit_price: Optional[float] = Field(default=None, gt=0, description="真實賣出價 (optional, must > 0)")
    is_correct: Optional[bool] = Field(default=None, description="啱(True) / 錯(False) mark (optional)")
    notes: Optional[str] = Field(default=None, description="改備註 (optional)")


class TradeJournalEntry(BaseModel):
    id: int
    symbol: str
    entry_date: str
    entry_price: float
    shares: float
    target_price: Optional[float] = None
    stop_loss: Optional[float] = None
    notes: Optional[str] = ""
    created_at: str
    # Stage 1+ followup 4 個新 field
    actual_exit_date: Optional[str] = None
    actual_exit_price: Optional[float] = None
    is_correct: Optional[int] = None  # 0/1/NULL
    updated_at: Optional[str] = None


class TradeJournalListResponse(BaseModel):
    entries: list[TradeJournalEntry]
    count: int


# Stage 1+ followup: GET stats response schema
class TradeJournalStatsBestWorst(BaseModel):
    best: Optional[float] = None
    worst: Optional[float] = None


class TradeJournalStatsFilter(BaseModel):
    symbol: Optional[str] = None
    days: int = 30


class TradeJournalStatsResponse(BaseModel):
    total: int
    correct_count: int
    hit_rate: Optional[float] = None
    avg_return_5d: Optional[float] = None
    avg_return_20d: Optional[float] = None
    best_worst_trade: TradeJournalStatsBestWorst
    filter: TradeJournalStatsFilter


# ============================================================================
# Endpoints
# ============================================================================

@router.post("", response_model=TradeJournalEntry)
async def add_trade_journal_entry(req: TradeJournalAdd) -> dict:
    """加 1 條 Trade Journal entry (永久保留).

    大少 11:57 永久 rule 應用: 唔可以重複 (symbol, entry_date) — 返 409.
    """
    if not DATE_REGEX.match(req.entry_date):
        raise HTTPException(status_code=400, detail="entry_date 必須係 YYYY-MM-DD 格式")
    try:
        result = model.add_entry(
            symbol=req.symbol,
            entry_date=req.entry_date,
            entry_price=req.entry_price,
            shares=req.shares,
            target_price=req.target_price,
            stop_loss=req.stop_loss,
            notes=req.notes or "",
        )
        logger.info(f"[trade-journal] 加 entry: {req.symbol} {req.entry_date} @ {req.entry_price}")
        return result
    except sqlite3.IntegrityError as e:
        # UNIQUE constraint violation
        raise HTTPException(status_code=409, detail=f"已經有 {req.symbol} {req.entry_date} 嘅 entry (UNIQUE constraint)")
    except Exception as e:
        logger.error(f"[trade-journal] add_entry error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("", response_model=TradeJournalListResponse)
async def list_trade_journal_entries(
    symbol: Optional[str] = Query(default=None, description="Filter by stock code"),
    limit: int = Query(default=50, ge=1, le=500, description="Max entries (1-500)"),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
) -> dict:
    """列出 Trade Journal entries (newest first by entry_date DESC).

    Optional filter by symbol (大少 11:57 永久 rule: 永遠 full show 全部 sections).
    """
    try:
        entries = model.list_entries(symbol=symbol, limit=limit, offset=offset)
        count = model.count_entries(symbol=symbol)
        return {"entries": entries, "count": count}
    except Exception as e:
        logger.error(f"[trade-journal] list_entries error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Stage 1+ followup (大少 15:04): 必須 register 喺 GET /{entry_id} 之前
# 因為 FastAPI route 配對係順序嘅, 否則 /stats 會被 /{entry_id} 攔截
@router.get("/stats", response_model=TradeJournalStatsResponse)
async def get_trade_journal_stats(
    symbol: Optional[str] = Query(default=None, description="Filter by stock code (optional)"),
    days: int = Query(default=30, ge=1, le=365, description="統計過去 N 日 (1-365, default 30)"),
) -> dict:
    """[GET] 計算 6 個 metrics 過去 N 日.

    大少 15:04 揀 6 個 metrics:
    - total / correct_count / hit_rate / avg_return_5d / avg_return_20d / best_worst_trade
    """
    try:
        return model.get_stats(symbol=symbol, days=days)
    except Exception as e:
        logger.error(f"[trade-journal] get_stats error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{entry_id}", response_model=TradeJournalEntry)
async def get_trade_journal_entry(entry_id: int) -> dict:
    """[GET] 拎單一 entry by id (helper for future PUT/DELETE)"""
    result = model.get_entry_by_id(entry_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Entry #{entry_id} not found")
    return result


# Stage 1+ followup (大少 15:04): PUT 改 entry
@router.put("/{entry_id}", response_model=TradeJournalEntry)
async def update_trade_journal_entry(entry_id: int, req: TradeJournalUpdate) -> dict:
    """[PUT] 改 entry 嘅 actual exit + 啱/錯 mark.

    Body field 全部 optional, 只 update 有 fill in 嘅 field.
    大少 15:04 default:
    - forward return 用 actual_exit_price (大少手動 mark 真實賣出價)
    - is_correct 手動 mark (大少自己判斷)
    """
    # Validate actual_exit_date format if provided
    if req.actual_exit_date is not None and not DATE_REGEX.match(req.actual_exit_date):
        raise HTTPException(status_code=400, detail="actual_exit_date 必須係 YYYY-MM-DD 格式")
    try:
        result = model.update_entry(
            entry_id=entry_id,
            actual_exit_date=req.actual_exit_date,
            actual_exit_price=req.actual_exit_price,
            is_correct=req.is_correct,
            notes=req.notes,
        )
        if not result:
            raise HTTPException(status_code=404, detail=f"Entry #{entry_id} not found")
        logger.info(f"[trade-journal] 改 entry #{entry_id}: {req.model_dump(exclude_none=True)}")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[trade-journal] update_entry error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Stage 1+ followup (大少 15:04): DELETE 刪 entry
@router.delete("/{entry_id}")
async def delete_trade_journal_entry(entry_id: int) -> dict:
    """[DELETE] 刪 entry by id. Returns 200 if deleted, 404 if not exist."""
    try:
        deleted = model.delete_entry(entry_id)
        if not deleted:
            raise HTTPException(status_code=404, detail=f"Entry #{entry_id} not found")
        logger.info(f"[trade-journal] 刪 entry #{entry_id}")
        return {"deleted": True, "id": entry_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[trade-journal] delete_entry error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

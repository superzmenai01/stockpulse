"""
api/trade_journal.py — Trade Journal API (Stage 1+ MVP, 大少 11:07)

Modular FastAPI router:
- POST /api/trade-journal        加 entry
- GET  /api/trade-journal        列出 entries (optional filter by symbol)

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


class TradeJournalListResponse(BaseModel):
    entries: list[TradeJournalEntry]
    count: int


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


@router.get("/{entry_id}", response_model=TradeJournalEntry)
async def get_trade_journal_entry(entry_id: int) -> dict:
    """[GET] 拎單一 entry by id (helper for future PUT/DELETE)"""
    result = model.get_entry_by_id(entry_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Entry #{entry_id} not found")
    return result

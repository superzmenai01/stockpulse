# Stocks API - 股票搜尋

import logging
from fastapi import APIRouter

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/stocks/search")
async def search_stocks(q: str = ""):
    """
    搜尋股票
    TODO: 實現實際搜尋邏輯
    """
    logger.info(f"[STUB] 搜尋股票: {q}")
    return {
        "results": [],
        "message": "STUB - 待實現"
    }

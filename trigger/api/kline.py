# K線 API

import logging
from fastapi import APIRouter

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/kline")
async def get_kline(code: str, period: str = "1D"):
    """
    獲取 K線數據
    TODO: 實現實際 K線獲取
    """
    logger.info(f"[STUB] 獲取 K線: {code} period={period}")
    return {
        "code": code,
        "period": period,
        "data": [],
        "message": "STUB - 待實現"
    }

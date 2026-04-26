# Subscribe API - 訂閱管理

import logging
from fastapi import APIRouter

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/subscribe/batch")
async def batch_subscribe(codes: list):
    """
    批量訂閱股票
    TODO: 實現實際訂閱邏輯
    """
    logger.info(f"[STUB] 批量訂閱: {codes}")
    return {
        "subscribed": codes,
        "message": "STUB - 待實現"
    }


@router.delete("/subscribe/{code}")
async def unsubscribe(code: str):
    """
    取消訂閱股票
    TODO: 實現實際取消訂閱
    """
    logger.info(f"[STUB] 取消訂閱: {code}")
    return {
        "unsubscribed": code,
        "message": "STUB - 待實現"
    }

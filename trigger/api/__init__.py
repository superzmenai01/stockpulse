# API 模組
from fastapi import APIRouter
from . import stocks, kline, subscribe

router = APIRouter()

router.include_router(stocks.router, tags=["stocks"])
router.include_router(kline.router, tags=["kline"])
router.include_router(subscribe.router, tags=["subscribe"])

__all__ = ["router"]

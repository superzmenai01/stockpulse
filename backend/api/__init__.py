# API 模組
from fastapi import APIRouter
from . import stocks, kline, subscribe, group

router = APIRouter()

router.include_router(stocks.router, tags=["stocks"])
router.include_router(kline.router, tags=["kline"])
router.include_router(subscribe.router, tags=["subscribe"])
router.include_router(group.router, tags=["groups"])

__all__ = ["router"]

# API 模組
from fastapi import APIRouter
from . import stocks, kline, subscribe, group, settings, plates

router = APIRouter()

router.include_router(stocks.router, tags=["stocks"])
router.include_router(kline.router, tags=["kline"])
router.include_router(subscribe.router, tags=["subscribe"])
router.include_router(group.router, tags=["groups"])
router.include_router(settings.router, tags=["settings"])
router.include_router(plates.router, tags=["plates"])

__all__ = ["router"]

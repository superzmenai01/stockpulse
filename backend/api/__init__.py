# API 模組
from fastapi import APIRouter
from . import stocks, kline, subscribe, group, settings, plates
# 大少 2026-08-03 #9920: stock_reasons router (generic per-stock HTML reason storage)
from . import stock_reasons

router = APIRouter()

router.include_router(stocks.router, tags=["stocks"])
router.include_router(kline.router, tags=["kline"])
router.include_router(subscribe.router, tags=["subscribe"])
router.include_router(group.router, tags=["groups"])
router.include_router(settings.router, tags=["settings"])
router.include_router(plates.router, tags=["plates"])
# 大少 2026-08-03 #9920
router.include_router(stock_reasons.router, tags=["stock-reasons"])

__all__ = ["router"]

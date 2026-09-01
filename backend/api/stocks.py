"""
StockPulse 股票搜索 API — 大少 2026-08-08

凡人話: 大少喺 testing page 揀股票 / 或者 AS-XX 揀觀察名單嘅時候,
       經呢個 API 拎 stock data。

Endpoints:
- GET /api/stocks/search?q=xxx&market=HK    搜索股票 (autocomplete)
- GET /api/stocks/{code}                    拎單隻股票 metadata
- GET /api/stocks/?market=HK&limit=100      拎指定市場嘅股票列表

Cross-ref:
- backend/models/stock.py (CRUD: search_stocks / get_stock / get_stocks_by_market)
- 永久 rule: 股票 metadata cache 7 日 (backend/services/stock_cache.py)
"""

from fastapi import APIRouter, Query
from typing import Optional

from backend.models.stock import search_stocks, get_stock, get_stocks_by_market

router = APIRouter(prefix='/stocks', tags=['stocks'])


@router.get('/search')
async def search(
    q: str = Query('', description='搜索關鍵詞'),
    market: Optional[str] = Query(None, description='市場過濾 (HK/US)'),
    limit: int = Query(20, description='返回數量', ge=1, le=100)
):
    """
    搜索股票\n
    支持按代碼前綴或名稱關鍵詞搜索

    大少 9月1日 17:25 (4.62.0) — 改 async def (永久 rule):
    之前 sync def 經 uvicorn HTTP/1.1 觸發 anyio 4.13.0 threadpool 嘅 Python 3.14 weakref bug
    (TypeError: cannot create weak reference to 'NoneType' object), 500 Internal Server Error
    TestClient 直接 call 唔 trigger, 但 uvicorn HTTP server 100% 觸發
    Fix: 改 async def, uvicorn 唔再行 threadpool, 直接喺 event loop 跑, 避開 bug
    對齊 stocks router 其他 endpoint 嘅 pattern (algorithms.py 全部用 async def)
    """
    if not q:
        return []
    results = search_stocks(q, market, limit)
    return results


@router.get('/{code}')
async def get_by_code(code: str):
    """獲取股票詳情

    大少 9月1日 17:25 (4.62.0) — 改 async def (對齊 /search fix, 避 anyio weakref bug)
    """
    stock = get_stock(code)
    if not stock:
        return {'error': 'Stock not found'}
    return stock


@router.get('/')
async def list_by_market(
    market: str = Query(..., description='市場 (HK/US)'),
    limit: int = Query(100, description='返回數量', ge=1, le=500)
):
    """獲取指定市場的股票列表

    大少 9月1日 17:25 (4.62.0) — 改 async def (對齊 /search fix, 避 anyio weakref bug)
    """
    return get_stocks_by_market(market, limit)

"""
StockPulse 股票搜索 API
"""

from fastapi import APIRouter, Query
from typing import Optional

from backend.models.stock import search_stocks, get_stock, get_stocks_by_market

router = APIRouter(prefix='/stocks', tags=['stocks'])


@router.get('/search')
def search(
    q: str = Query('', description='搜索關鍵詞'),
    market: Optional[str] = Query(None, description='市場過濾 (HK/US)'),
    limit: int = Query(20, description='返回數量', ge=1, le=100)
):
    """
    搜索股票\n
    支持按代碼前綴或名稱關鍵詞搜索
    """
    if not q:
        return []
    results = search_stocks(q, market, limit)
    return results


@router.get('/{code}')
def get_by_code(code: str):
    """獲取股票詳情"""
    stock = get_stock(code)
    if not stock:
        return {'error': 'Stock not found'}
    return stock


@router.get('/')
def list_by_market(
    market: str = Query(..., description='市場 (HK/US)'),
    limit: int = Query(100, description='返回數量', ge=1, le=500)
):
    """獲取指定市場的股票列表"""
    return get_stocks_by_market(market, limit)

"""
StockPulse 組別 API — 大少 2026-08-08

凡人話: 大少用「組別」去將股票分類 (例: 「港股觀察名單」、「AI 概念股」
       「高息股」、「美股 ETF」), 然後 frontend sidebar 顯示。

Endpoints:
- GET    /api/groups                        拎所有組別
- GET    /api/groups/{group_id}             拎單個組別
- POST   /api/groups                        開新組別
- PUT    /api/groups/{group_id}             改組別名/顏色
- DELETE /api/groups/{group_id}             刪組別
- POST   /api/groups/reorder                重新排序 (拖拽 sidebar)
- GET    /api/groups/{group_id}/stocks      拎組別入面嘅股票
- POST   /api/groups/{group_id}/stocks      加股票落組別
- DELETE /api/groups/{group_id}/stocks/{code}  從組別移除股票

Cross-ref:
- backend/models/group.py (CRUD: create_group / get_groups / ...)
- backend/models/group_stock.py (M:N 關係表)
- 永久 rule: 組別排序 user drag 後要即時 save (sidebar 體驗)
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from backend.models.group import (
    create_group,
    get_groups,
    get_group,
    update_group,
    delete_group,
    reorder_groups,
)

router = APIRouter(prefix='/groups', tags=['groups'])


class GroupCreate(BaseModel):
    name: str
    color: str = '#1890ff'


class GroupUpdate(BaseModel):
    name: str
    color: str


class GroupReorder(BaseModel):
    """重新排序組別"""
    group_ids: list[str]


class GroupResponse(BaseModel):
    id: str
    name: str
    color: str
    user_id: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


@router.get('', response_model=list[GroupResponse])
def list_groups():
    """獲取所有組別"""
    groups = get_groups()
    return [GroupResponse(**g.to_dict()) for g in groups]


@router.get('/{group_id}', response_model=GroupResponse)
def get_group_by_id(group_id: str):
    """獲取單個組別"""
    group = get_group(group_id)
    if not group:
        raise HTTPException(status_code=404, detail='組別不存在')
    return GroupResponse(**group.to_dict())


@router.post('', response_model=GroupResponse, status_code=201)
def create(group_data: GroupCreate):
    """創建組別"""
    group = create_group(name=group_data.name, color=group_data.color)
    return GroupResponse(**group.to_dict())


@router.put('/{group_id}', response_model=GroupResponse)
def update(group_id: str, group_data: GroupUpdate):
    """更新組別"""
    group = update_group(group_id, name=group_data.name, color=group_data.color)
    if not group:
        raise HTTPException(status_code=404, detail='組別不存在')
    return GroupResponse(**group.to_dict())


@router.delete('/{group_id}')
def delete(group_id: str):
    """刪除組別"""
    success = delete_group(group_id)
    if not success:
        raise HTTPException(status_code=404, detail='組別不存在')
    return {'success': True}


@router.post('/reorder', response_model=list[GroupResponse])
def reorder(data: GroupReorder):
    """重新排序組別"""
    groups = reorder_groups(data.group_ids)
    return [GroupResponse(**g.to_dict()) for g in groups]


@router.get('/{group_id}/stocks')
def get_group_stocks(group_id: str):
    """獲取組別的所有股票"""
    from backend.models.group_stock import get_group_stocks as _get_group_stocks
    stocks = _get_group_stocks(group_id)
    return stocks


@router.post('/{group_id}/stocks')
def add_stock_to_group(group_id: str, data: dict):
    """添加股票到組別"""
    from backend.models.group_stock import add_stock_to_group as _add_stock_to_group
    stock_code = data.get('stock_code')
    if not stock_code:
        raise HTTPException(status_code=400, detail='stock_code is required')
    success = _add_stock_to_group(group_id, stock_code)
    if not success:
        raise HTTPException(status_code=500, detail='Failed to add stock')
    return {'success': True, 'stock_code': stock_code}


@router.delete('/{group_id}/stocks/{stock_code}')
def remove_stock_from_group(group_id: str, stock_code: str):
    """從組別移除股票"""
    from backend.models.group_stock import remove_stock_from_group as _remove_stock_from_group
    success = _remove_stock_from_group(group_id, stock_code)
    if not success:
        raise HTTPException(status_code=404, detail='Stock not found in group')
    return {'success': True}

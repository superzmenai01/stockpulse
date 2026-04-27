"""
StockPulse 組別 API
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
)

router = APIRouter(prefix='/groups', tags=['groups'])


class GroupCreate(BaseModel):
    name: str
    color: str = '#1890ff'


class GroupUpdate(BaseModel):
    name: str
    color: str


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

"""
StockPulse 設置 API
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Dict, Any
from models.settings import get_settings, save_settings, get_all_settings

router = APIRouter()


class SettingsUpdate(BaseModel):
    indicator_config: Dict[str, Any]


@router.get("/settings")
async def get_indicator_settings():
    """獲取指標設置"""
    settings = get_settings('indicator_config')
    if settings is None:
        # 返回預設值
        return {
            "MA5": {"enabled": True, "period": 5, "color": "#FF6B6B"},
            "MA10": {"enabled": True, "period": 10, "color": "#4ECDC4"},
            "MA20": {"enabled": True, "period": 20, "color": "#45B7D1"},
            "MA60": {"enabled": False, "period": 60, "color": "#96CEB4"},
            "MA120": {"enabled": False, "period": 120, "color": "#DDA0DD"},
            "MA250": {"enabled": False, "period": 250, "color": "#FFB347"},
            "EMA5": {"enabled": False, "period": 5, "color": "#FF6B6B"},
            "EMA10": {"enabled": False, "period": 10, "color": "#4ECDC4"},
            "EMA20": {"enabled": False, "period": 20, "color": "#45B7D1"},
            "BOLL": {"enabled": False, "period": 20, "stdDev": 2, "color": "#FFB347"},
            "ZigZag": {"enabled": true, "threshold": 5},
        }
    return settings


@router.put("/settings")
async def update_indicator_settings(data: SettingsUpdate):
    """更新指標設置"""
    save_settings('indicator_config', data.indicator_config)
    return {"status": "ok", "message": "Settings saved"}


@router.get("/settings/all")
async def get_all_settings_endpoint():
    """獲取所有設置（擴展用）"""
    return get_all_settings()

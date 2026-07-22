# Subscribe API - 訂閱管理
# Wire 真實 SubscriptionManager (replaces 之前嘅 STUB endpoints)

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException

logger = logging.getLogger(__name__)
router = APIRouter()


def _get_subscription_manager() -> Optional[object]:
    """
    Lazy import ws.router.get_subscription_manager()
    Returns None if FutuOpenD 未連接 or import fail
    """
    try:
        from backend.ws.router import get_subscription_manager
        return get_subscription_manager()
    except Exception as e:
        logger.warning(f"[Subscribe] 取得 SubscriptionManager 失敗: {e}")
        return None


@router.post("/subscribe/batch")
async def batch_subscribe(codes: list):
    """
    批量訂閱股票
    Body: codes list of stock codes, e.g. ["HK.00700", "HK.00981"]
    """
    if not codes:
        raise HTTPException(status_code=400, detail="codes 不能為空")

    sm = _get_subscription_manager()
    if sm is None:
        raise HTTPException(status_code=503, detail="FutuOpenD 未連接")

    success = sm.subscribe(codes)
    logger.info(f"[API] batch_subscribe: {codes}, success={success}")
    return {
        "subscribed": codes,
        "success": success,
    }


@router.delete("/subscribe/{code}")
async def unsubscribe(code: str):
    """
    取消訂閱
    - code = "all": 取消所有訂閱（含冷卻確認）
    - 其他: 目前未支援單個取消（return 501）
    """
    sm = _get_subscription_manager()
    if sm is None:
        raise HTTPException(status_code=503, detail="FutuOpenD 未連接")

    if code == "all":
        success, err = sm.cancel_all_with_confirm()
        logger.info(f"[API] unsubscribe_all: success={success}, err={err}")
        return {
            "unsubscribed": code,
            "success": success,
            "error": err if not success else None,
        }

    raise HTTPException(
        status_code=501,
        detail=f"per-code cancel not yet implemented (use 'all'); got {code}",
    )

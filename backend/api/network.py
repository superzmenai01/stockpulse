"""Network info API — 大少 2026-08-02 #9699 QW-5

Endpoint:
- GET /api/network/info  Return backend / frontend ports + LAN IP so frontend /
                         external devices know how to reach the app.

Used by:
- LanAccessPanel (frontend) — shows user the LAN URL to type on phone / tablet.
- Health check scripts — verify cross-device reachability.
"""
from __future__ import annotations

import logging
from typing import TypedDict

from fastapi import APIRouter

from config import BACKEND_PORT, FRONTEND_PORT
from utils.network import detect_lan_ip

# 大少 2026-08-02 #9699 QW-1: Miniapp backend 改 bind 127.0.0.1
# → MacBook only; Telegram Mini App 訪問方式係透過 reverse proxy / ngrok
# 所以 miniapp_backend_port 響 info 入面標明本地 only，唔好誤導 user。
MINIAPP_BACKEND_PORT: int = 18793

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/network", tags=["network"])


class MiniappInfo(TypedDict):
    miniapp_backend_port: int
    miniapp_local_only: bool


@router.get("/info")
async def network_info() -> dict[str, object]:
    """Return full network topology for cross-device access.

    Response shape (QW-5 spec):
    {
      "backend_port": 18792,
      "mac_lan_ip": "192.168.1.64",
      "frontend_port": 3000,
      "frontend_url_local": "http://localhost:3000/",
      "frontend_url_lan": "http://192.168.1.64:3000/",
      "other_devices_can_reach": true,
      "miniapps": {
        "miniapp_backend_port": 18793,
        "miniapp_local_only": true
      }
    }
    """
    mac_lan_ip: str = detect_lan_ip()
    other_devices_can_reach: bool = mac_lan_ip != "unknown"

    miniapp_info: MiniappInfo = {
        "miniapp_backend_port": MINIAPP_BACKEND_PORT,
        "miniapp_local_only": True,  # QW-1 已 fix bind 127.0.0.1
    }

    return {
        "backend_port": BACKEND_PORT,
        "mac_lan_ip": mac_lan_ip,
        "frontend_port": FRONTEND_PORT,
        "frontend_url_local": f"http://localhost:{FRONTEND_PORT}/",
        "frontend_url_lan": f"http://{mac_lan_ip}:{FRONTEND_PORT}/",
        "other_devices_can_reach": other_devices_can_reach,
        "miniapps": miniapp_info,
    }
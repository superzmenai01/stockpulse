"""Network utilities — 共用 LAN IP 偵測 (QW-4a + QW-5)
Refactor #9699 (2026-08-02): _detect_lan_ip() 由 main.py 抽出嚟俾多個 endpoint 共用。
"""
from __future__ import annotations

import socket
import subprocess


def detect_lan_ip() -> str:
    """Detect MacBook's primary LAN IP (used for cross-device access).

    優先用 socket.gethostbyname()（最快）；失敗 / 返 127.x 就 fallback 用
    `ipconfig getifaddr en0`（macOS built-in，唔使額外 dep）。
    最終 fallback 係 'unknown'，唔好 throw — health endpoint 一定要返 200。

    Returns:
        LAN IP string (e.g. "192.168.1.64"), or "unknown" if detection failed.
    """
    try:
        ip: str = socket.gethostbyname(socket.gethostname())
        if ip and not ip.startswith("127."):
            return ip
    except Exception:
        pass
    try:
        result = subprocess.run(
            ["ipconfig", "getifaddr", "en0"],
            capture_output=True,
            text=True,
            timeout=2,
        )
        ip2: str = result.stdout.strip()
        if ip2:
            return ip2
    except Exception:
        pass
    return "unknown"
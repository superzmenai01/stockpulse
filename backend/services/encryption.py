"""
API Key Encryption Helper — 大少 2026-08-01 #9146

AES-256 (Fernet) 加密 LLM API key。
- 加密 key 入 DB (at rest)
- 解密時用 stable key（唔好每次 restart 都變）

Key resolution order:
1. ENV LLM_ENCRYPTION_KEY  (production)
2. File ~/stockpulse/backend/data/.llm_encryption_key  (dev, auto-generated)
3. File 不存在 → generate + save (dev convenience)
"""
from __future__ import annotations
import os
import sys
from pathlib import Path

from cryptography.fernet import Fernet

# Dev-only key file location
_DATA_DIR = Path.home() / "stockpulse" / "backend" / "data"
_DEV_KEY_FILE = _DATA_DIR / ".llm_encryption_key"


def _get_master_key() -> bytes:
    """
    Get master key (stable across restarts).

    Order:
    1. ENV LLM_ENCRYPTION_KEY  → use it
    2. File exists            → read from file
    3. File not exists        → generate + save (dev only)
    """
    # 1. ENV
    key = os.environ.get("LLM_ENCRYPTION_KEY")
    if key:
        return key.encode() if isinstance(key, str) else key

    # 2. Dev file
    if _DEV_KEY_FILE.exists():
        return _DEV_KEY_FILE.read_text().strip().encode()

    # 3. Generate + save
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    new_key = Fernet.generate_key().decode()
    _DEV_KEY_FILE.write_text(new_key)
    print(
        f"[INFO] Generated new dev LLM encryption key, saved to {_DEV_KEY_FILE}",
        file=sys.stderr,
    )
    print(
        f"[INFO] For production, set LLM_ENCRYPTION_KEY env var instead.",
        file=sys.stderr,
    )
    return new_key.encode()


def _get_fernet() -> Fernet:
    return Fernet(_get_master_key())


def encrypt_api_key(api_key: str) -> bytes:
    """Encrypt API key and return bytes (for BLOB storage)."""
    if not api_key:
        raise ValueError("api_key must not be empty")
    return _get_fernet().encrypt(api_key.encode())


def decrypt_api_key(encrypted: bytes) -> str:
    """Decrypt API key from bytes."""
    if not encrypted:
        raise ValueError("encrypted blob must not be empty")
    return _get_fernet().decrypt(encrypted).decode()


def generate_master_key() -> str:
    """Generate a new master key (for initial setup)."""
    return Fernet.generate_key().decode()

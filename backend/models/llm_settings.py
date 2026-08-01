"""
LLM Settings Model — 大少 2026-08-01 #9146

Modular block architecture:
- init_llm_settings_table()  — DDL
- save_or_update_provider()  — POST /api/settings/llm
- set_active_provider()      — POST /api/settings/llm/switch
- get_active_provider()      — GET /api/settings/llm/active
- list_providers()           — GET /api/settings/llm (all)
- get_api_key()              — internal use (decrypt)
- delete_provider()          — DELETE
- _mask_api_key()            — 顯示用 (sk-****abc)

DB schema:
- id: INTEGER PRIMARY KEY AUTOINCREMENT
- provider: TEXT UNIQUE (minimax, kimi, gemini, openai, custom)
- api_key_encrypted: BLOB (Fernet encrypted)
- api_key_masked: TEXT (顯示用)
- endpoint: TEXT (Custom provider 嘅 URL)
- model: TEXT (Custom provider 嘅 model name)
- is_active: INTEGER (0/1, 邊個係 active)
- is_custom: INTEGER (0/1)
- created_at, updated_at: TIMESTAMP
"""
import json
import sqlite3
from pathlib import Path
from typing import Optional, Any

from services.encryption import encrypt_api_key, decrypt_api_key

DEFAULT_DB_PATH = Path.home() / "stockpulse" / "backend" / "data" / "stocks.db"


def get_connection(db_path: Path = DEFAULT_DB_PATH) -> sqlite3.Connection:
    return sqlite3.connect(str(db_path))


# ============================================================================
# DDL
# ============================================================================

def init_llm_settings_table(db_path: Path = DEFAULT_DB_PATH) -> None:
    """Create llm_settings table if not exists."""
    with get_connection(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS llm_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider TEXT NOT NULL UNIQUE,
                api_key_encrypted BLOB,
                api_key_masked TEXT,
                endpoint TEXT,
                model TEXT,
                is_active INTEGER NOT NULL DEFAULT 0,
                is_custom INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_llm_settings_active ON llm_settings(is_active)"
        )
        conn.commit()


# ============================================================================
# CRUD
# ============================================================================

def save_or_update_provider(
    provider: str,
    api_key: str,
    endpoint: Optional[str] = None,
    model: Optional[str] = None,
    is_custom: bool = False,
    db_path: Path = DEFAULT_DB_PATH,
) -> dict[str, Any]:
    """
    儲存或者更新 provider 嘅 API key + endpoint + model

    - 自動 encrypt API key
    - 自動 derive masked version (e.g. sk-****abc)
    - 如果未有任何 active provider, 自動設為 active
    - 已存在就 update；唔存在就 insert
    """
    if not api_key:
        raise ValueError("api_key must not be empty")

    encrypted = encrypt_api_key(api_key)
    masked = _mask_api_key(api_key)

    with get_connection(db_path) as conn:
        conn.row_factory = sqlite3.Row
        # Check if any active provider exists
        has_active = conn.execute(
            "SELECT 1 FROM llm_settings WHERE is_active = 1 LIMIT 1"
        ).fetchone() is not None

        # UPSERT
        conn.execute(
            """
            INSERT INTO llm_settings
                (provider, api_key_encrypted, api_key_masked, endpoint, model, is_custom, is_active, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(provider) DO UPDATE SET
                api_key_encrypted = excluded.api_key_encrypted,
                api_key_masked = excluded.api_key_masked,
                endpoint = excluded.endpoint,
                model = excluded.model,
                is_custom = excluded.is_custom,
                updated_at = CURRENT_TIMESTAMP
            """,
            (provider, encrypted, masked, endpoint, model, 1 if is_custom else 0,
             1 if not has_active else 0),
        )
        conn.commit()

        row = conn.execute(
            "SELECT * FROM llm_settings WHERE provider = ?", (provider,)
        ).fetchone()
    return _row_to_dict(row)


def set_active_provider(provider: str, db_path: Path = DEFAULT_DB_PATH) -> Optional[dict[str, Any]]:
    """Set the given provider as active (cancel others)."""
    with get_connection(db_path) as conn:
        conn.row_factory = sqlite3.Row
        # Reset all to 0
        conn.execute("UPDATE llm_settings SET is_active = 0")
        # Set this one to 1
        conn.execute(
            "UPDATE llm_settings SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE provider = ?",
            (provider,),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM llm_settings WHERE provider = ?", (provider,)
        ).fetchone()
    return _row_to_dict(row) if row else None


def get_active_provider(db_path: Path = DEFAULT_DB_PATH) -> Optional[dict[str, Any]]:
    """Get the currently active provider settings (NO plaintext key)."""
    with get_connection(db_path) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM llm_settings WHERE is_active = 1 LIMIT 1"
        ).fetchone()
    return _row_to_dict(row) if row else None


def list_providers(db_path: Path = DEFAULT_DB_PATH) -> list[dict[str, Any]]:
    """List all providers (with masked API key, NO plaintext)."""
    with get_connection(db_path) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM llm_settings ORDER BY is_active DESC, provider ASC"
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_api_key(provider: str, db_path: Path = DEFAULT_DB_PATH) -> Optional[str]:
    """Get decrypted API key for a provider (internal use only — factory call)."""
    with get_connection(db_path) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT api_key_encrypted FROM llm_settings WHERE provider = ?", (provider,)
        ).fetchone()
    if not row or not row["api_key_encrypted"]:
        return None
    return decrypt_api_key(row["api_key_encrypted"])


def delete_provider(provider: str, db_path: Path = DEFAULT_DB_PATH) -> bool:
    """Delete provider entry. Returns True if deleted."""
    with get_connection(db_path) as conn:
        cursor = conn.execute(
            "DELETE FROM llm_settings WHERE provider = ?", (provider,)
        )
        conn.commit()
        return cursor.rowcount > 0


# ============================================================================
# Helpers
# ============================================================================

def _mask_api_key(api_key: str) -> str:
    """Mask API key for display: 'sk-1234567890abcdef' → 'sk-****cdef'"""
    if len(api_key) <= 8:
        return "****"
    return f"{api_key[:4]}****{api_key[-4:]}"


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    """Convert row to dict. NEVER include plaintext API key — use get_api_key() instead."""
    d = dict(row)
    # Always remove encrypted blob from output
    if "api_key_encrypted" in d:
        del d["api_key_encrypted"]
    return d

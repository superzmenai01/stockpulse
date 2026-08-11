"""
LLM Factory — 大少 2026-08-01 #9146

`get_active_provider()` 每次 call 都讀 settings db，自動同 instantiate。
Settings 改咗即時生效（唔需要重啟 server）。

================================================================================
Apply Scope (永久 rule, 大少 2026-08-01 #9146):
================================================================================
  - AS-02 + 所有將來 AS-XX 永遠 call `get_active_provider()`
  - 唔好 pass provider 名做 parameter
  - 唔好 hard-code `OpenAICompatibleProvider(api_key=...)` 之類
  - 唔好 cache provider instance (settings 改咗要即時生效)
  - Caller 唔需要 try/except, get_active_provider() 內部 try-except
    包住, 失敗 return None, caller check None 就 fallback

================================================================================
Caller map (邊啲 module 用緊):
================================================================================
  - backend/services/as02_analyzer.py (AS-02 公司質素分析)
      └─> provider = get_active_provider()
      └─> if provider: provider.chat_json(messages, schema=AS02_SCHEMA)
  - 將來 AS-XX (所有用 LLM 嘅 algorithm)
      └─> 一律 call get_active_provider()
  - backend/api/llm_settings.py
      └─> 用 list_predefined_providers() 拎下拉選單 options
  - Settings page frontend
      └─> 用 /api/llm-settings/* endpoints, 唔直接 call factory

================================================================================
Hot-reload mechanism (凡人話):
================================================================================
  Step 1: 大少喺 Settings page 揀新 provider, 撳 Save
  Step 2: settings DB (sqlite) 寫入新 active provider
  Step 3: 下次 caller call get_active_provider() 自動讀新 settings
  Step 4: 新 OpenAICompatibleProvider(api_key, endpoint, model) 即時 instantiate
  Step 5: 唔需要重啟 backend server (uvicorn)

  Spec: PROJECT_SPEC.md §LLM Settings + ARCHITECTURE.md §LLM Abstraction Layer
  永久 rule: settings 改咗唔需要重啟 server
================================================================================
"""
import logging
from typing import Optional

from models.llm_settings import get_active_provider as _get_active_settings, get_api_key as _get_api_key

from .base import AbstractProvider
from .custom import OpenAICompatibleProvider

logger = logging.getLogger(__name__)


# ============================================================================
# Pre-defined Provider Endpoints
# ============================================================================
# 全部 OpenAI-compatible，用 generic OpenAICompatibleProvider instantiate

PREDEFINED_ENDPOINTS: dict[str, dict[str, str]] = {
    "minimax": {
        "endpoint": "https://api.minimaxi.com/v1",
        "model": "MiniMax-M3",
    },
    "kimi": {
        "endpoint": "https://api.moonshot.cn/v1",
        "model": "moonshot-v1-8k",
    },
    "openai": {
        "endpoint": "https://api.openai.com/v1",
        "model": "gpt-4o-mini",
    },
    "gemini": {
        "endpoint": "https://generativelanguage.googleapis.com/v1beta/openai",
        "model": "gemini-1.5-flash",
    },
}


# ============================================================================
# Public API
# ============================================================================

def get_active_provider() -> Optional[AbstractProvider]:
    """
    Get the currently active LLM provider instance.

    每次 call 都讀 settings DB — 唔 cache。
    Settings 改咗即用，唔需要重啟 server。

    Returns:
        AbstractProvider instance, or None if no active provider
    """
    try:
        active = _get_active_settings()
    except Exception as e:
        logger.error(f"Failed to load active provider settings: {e}")
        return None

    if not active:
        logger.warning("No active LLM provider configured. Add one in Settings.")
        return None

    provider_name = active.get("provider")
    if not provider_name:
        logger.error("Active settings missing 'provider' field")
        return None

    # 攞 decrypted API key (internal use only)
    api_key = _get_api_key(provider_name)
    if not api_key:
        logger.error(f"No API key for provider '{provider_name}'")
        return None

    is_custom = bool(active.get("is_custom"))

    if is_custom:
        # Custom provider — use stored endpoint + model
        endpoint = active.get("endpoint")
        model = active.get("model")
        if not endpoint or not model:
            logger.error(
                f"Custom provider '{provider_name}' missing endpoint or model"
            )
            return None
        return OpenAICompatibleProvider(
            api_key=api_key,
            endpoint=endpoint,
            model=model,
            provider_name=provider_name,
        )

    # Pre-defined provider — use PREDEFINED_ENDPOINTS lookup
    config = PREDEFINED_ENDPOINTS.get(provider_name)
    if not config:
        logger.error(f"Unknown pre-defined provider '{provider_name}'")
        return None

    return OpenAICompatibleProvider(
        api_key=api_key,
        endpoint=config["endpoint"],
        model=config["model"],
        provider_name=provider_name,
    )


def list_predefined_providers() -> list[str]:
    """List all pre-defined provider names."""
    return list(PREDEFINED_ENDPOINTS.keys())


def get_predefined_config(provider_name: str) -> Optional[dict[str, str]]:
    """Get predefined endpoint config for a provider."""
    return PREDEFINED_ENDPOINTS.get(provider_name)

"""
LLM Provider Abstraction Package — 大少 2026-08-01 #9146

凡人話 Architecture:
================================================================================
  backend/llm/                         ← 呢個 package
    ├── base.py        AbstractProvider 抽象 class
    │                  ↓ (extend)
    ├── custom.py      OpenAICompatibleProvider (1 個 adapter cover 多個 provider)
    │                  ↓ (instantiate)
    └── factory.py     get_active_provider() 每次讀 settings DB
                       list_predefined_providers() / PREDEFINED_ENDPOINTS

  外部 caller (e.g. services/as02_analyzer.py):
    └─> from backend.llm import get_active_provider
        provider = get_active_provider()
        provider.chat_json(messages, schema=...)

  Settings:
    └─> backend/models/llm_settings.py (DB schema + get_active_provider)
        backend/api/llm_settings.py (CRUD API)

================================================================================
設計原則 (永久 rule, 大少 2026-08-01 #9146):
================================================================================
  1. 唔好 hard-code provider name (e.g. "minimax"), 一律 get_active_provider()
  2. 唔好 pass provider name 做 parameter (caller 唔需要知)
  3. 唔好 cache provider instance (settings 改咗要即時生效)
  4. 唔好喺呢度加 try/except, get_active_provider() 已經包咗 (返 None)
  5. 新增 provider: 加去 factory.PREDEFINED_ENDPOINTS, 唔使加新 file
  6. 全部都係 OpenAI-compatible protocol, 用 1 個 generic adapter 就夠

================================================================================
Cross-ref:
================================================================================
  - models/llm_settings.py: settings DB (provider / endpoint / model / api_key)
  - api/llm_settings.py: Settings CRUD endpoints
  - services/as02_analyzer.py: 主要 caller
  - PROJECT_SPEC.md §LLM Providers
  - ARCHITECTURE.md §LLM Abstraction Layer
================================================================================
"""
from .base import AbstractProvider
from .custom import OpenAICompatibleProvider
from .factory import (
    get_active_provider,
    list_predefined_providers,
    get_predefined_config,
    PREDEFINED_ENDPOINTS,
)

__all__ = [
    "AbstractProvider",
    "OpenAICompatibleProvider",
    "get_active_provider",
    "list_predefined_providers",
    "get_predefined_config",
    "PREDEFINED_ENDPOINTS",
]

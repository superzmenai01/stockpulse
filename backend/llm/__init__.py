"""LLM Provider Abstraction package — 大少 2026-08-01 #9146"""
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

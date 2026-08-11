"""
Abstract LLM Provider Base Class — 大少 2026-08-01 #9146

所有 LLM provider (MiniMax / Kimi / Gemini / OpenAI / Custom) 都係 extend 呢個 class。

================================================================================
點解要呢個 abstraction (凡人話):
================================================================================
  StockPulse 之前 hard-code 死 MiniMax API (大少 2026-08-01 決定抽象化)。
  抽象出來之後:
  - 新增 provider (e.g. Kimi / OpenAI) 只需要寫 1 個 file, 唔使改 algorithm code
  - 切換 provider 唔需要重新 deploy, 改 settings DB 即時生效
  - 統一 test interface, 每個 provider 都有 chat / chat_json / count_tokens /
    health_check 4 個 method, 唔會有 surprise

Interface (所有 subclass 必須 implement):
- chat()           — 文字對話
- chat_json()      — 結構化 JSON 輸出
- count_tokens()   — Token 計數
- health_check()   — 連線測試
- provider_name    — Provider 名 (e.g. 'minimax', 'kimi', 'custom')
- default_model    — 預設 model

================================================================================
Caller map (邊啲 module 用緊呢個 abstraction):
================================================================================
  - AS-02 公司質素分析 (services/as02_analyzer.py)
      └─> get_active_provider() 拎 AbstractProvider instance
      └─> provider.chat_json() 拎 LLM narrative
  - 將來 AS-XX (所有用 LLM 嘅 algorithm)
      └─> 一律 call get_active_provider(), 唔好 hard-code provider
  - Settings page
      └─> provider.health_check() 測連線

  Spec: PROJECT_SPEC.md §LLM Providers + ARCHITECTURE.md §LLM Abstraction Layer
  Cross-ref:
    - factory.py: get_active_provider() 每次 call 重新讀 settings
    - custom.py: OpenAI-compatible 1 個 adapter cover 多個 provider
================================================================================
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Any, Optional


class AbstractProvider(ABC):
    """Abstract base class for all LLM providers."""

    @abstractmethod
    def chat(
        self,
        messages: list[dict[str, str]],
        *,
        model: Optional[str] = None,
        temperature: float = 0.3,
        max_tokens: Optional[int] = None,
    ) -> str:
        """
        文字對話。

        Args:
            messages: List of message dicts, each with 'role' and 'content'.
                      Roles: 'system' / 'user' / 'assistant'
            model: Override default model (optional)
            temperature: 0.0 = 確定性, 1.0 = 創意 (default 0.3)
            max_tokens: 最大 token 數

        Returns:
            AI response text
        """
        raise NotImplementedError

    @abstractmethod
    def chat_json(
        self,
        messages: list[dict[str, str]],
        *,
        schema: Optional[dict[str, Any]] = None,
        model: Optional[str] = None,
        temperature: float = 0.3,
    ) -> dict[str, Any]:
        """
        結構化 JSON 輸出。

        Args:
            messages: List of message dicts
            schema: Optional JSON schema for validation
            model: Override default model
            temperature: 0.0 = 確定性, 1.0 = 創意 (default 0.3)

        Returns:
            Parsed JSON dict
        """
        raise NotImplementedError

    @abstractmethod
    def count_tokens(self, text: str) -> int:
        """
        Token 計數 (rough estimate)。

        Returns:
            Estimated token count
        """
        raise NotImplementedError

    @abstractmethod
    def health_check(self) -> bool:
        """
        連線測試。

        Returns:
            True if provider responds OK
        """
        raise NotImplementedError

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Provider name (e.g. 'minimax', 'kimi', 'custom')."""
        raise NotImplementedError

    @property
    @abstractmethod
    def default_model(self) -> str:
        """Default model for this provider."""
        raise NotImplementedError

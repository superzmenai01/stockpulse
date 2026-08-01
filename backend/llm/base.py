"""
Abstract LLM Provider Base Class — 大少 2026-08-01 #9146

所有 LLM provider (MiniMax / Kimi / Gemini / OpenAI / Custom) 都係 extend 呢個 class。

Interface:
- chat()           — 文字對話
- chat_json()      — 結構化 JSON 輸出
- count_tokens()   — Token 計數
- health_check()   — 連線測試
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

"""
OpenAI-Compatible LLM Provider — 大少 2026-08-01 #9146

Cover 所有 OpenAI-compatible API:
- Kimi (Moonshot)
- OpenAI
- MiniMax M3 (if OpenAI-compatible)
- 任何其他 OpenAI-compatible endpoint (DeepSeek / Together / etc.)

設計原則：1 個 generic adapter cover 多個 provider，避免寫 N 個 specific adapter。

================================================================================
Data flow (凡人話):
================================================================================
  caller (e.g. AS-02 analyzer)
    │
    ▼
  provider.chat(messages) / chat_json(messages, schema)
    │
    │  1. Build payload: { model, messages, temperature, max_tokens? }
    │  2. urllib.request POST → <endpoint>/chat/completions
    │     (用 stdlib urllib 而唔係 requests, 因為 urllib3 latin-1 fallback 撞 emoji)
    │  3. Parse response: data["choices"][0]["message"]["content"]
    │  4. (chat_json only) 加 JSON instruction 到 system prompt, 處理 ```json block
    │
    ▼
  return str (or dict for chat_json)

================================================================================
Error handling:
================================================================================
  - HTTPError: 拎 status code + body 前 200 char 寫 log, 然後 re-raise
  - URLError / TimeoutError: 寫 log, re-raise (caller 決定 fallback)
  - Unexpected response format: 寫 log, raise ValueError
  - health_check(): try-except 包住, 失敗 return False (唔 re-raise, 畀 caller 友善處理)

================================================================================
Token counting (凡人話):
================================================================================
  - 中文字: ~1.5 chars per token
  - 英文/數字: ~4 chars per token
  - 用 regex `[\u4e00-\u9fff]` 數中文字, 其他 chars 計另一邊
  - 對大部分 use case 已經夠準確, 唔需要 call 真嘅 tokenizer

================================================================================
Cross-ref:
================================================================================
  - base.py: AbstractProvider interface
  - factory.py: get_active_provider() 返呢個 class 嘅 instance
  - models.llm_settings: settings DB schema (provider / endpoint / model / api_key)
"""
from __future__ import annotations
import json
import logging
import re
import urllib.error
import urllib.request
from typing import Any, Optional

# import requests  # 不再使用 (大少 fix: urllib3 latin-1 fallback 撞 emoji)
from .base import AbstractProvider

logger = logging.getLogger(__name__)


class OpenAICompatibleProvider(AbstractProvider):
    """
    OpenAI-compatible 提供者 adapter。

    Usage:
        provider = OpenAICompatibleProvider(
            api_key="sk-...",
            endpoint="https://api.moonshot.cn/v1",
            model="moonshot-v1-8k",
            provider_name="kimi",
        )
        response = provider.chat([
            {"role": "user", "content": "Hello"}
        ])
    """

    def __init__(
        self,
        api_key: str,
        endpoint: str,
        model: str,
        provider_name: str = "custom",
        timeout: int = 60,
    ):
        if not api_key:
            raise ValueError("api_key must not be empty")
        if not endpoint:
            raise ValueError("endpoint must not be empty")
        if not model:
            raise ValueError("model must not be empty")

        self._api_key = api_key
        self._endpoint = endpoint.rstrip("/")
        self._model = model
        self._provider_name = provider_name
        self._timeout = timeout

    @property
    def provider_name(self) -> str:
        return self._provider_name

    @property
    def default_model(self) -> str:
        return self._model

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    def _url(self) -> str:
        return f"{self._endpoint}/chat/completions"

    def chat(
        self,
        messages: list[dict[str, str]],
        *,
        model: Optional[str] = None,
        temperature: float = 0.3,
        max_tokens: Optional[int] = None,
    ) -> str:
        """
        文字對話 (OpenAI-compatible protocol)。
        """
        payload: dict[str, Any] = {
            "model": model or self._model,
            "messages": messages,
            "temperature": temperature,
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        try:
            # 用 stdlib urllib.request 取代 requests (urllib3 撞 latin-1 fallback \u2026)
            req = urllib.request.Request(
                self._url(),
                data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                headers={**self._headers(), "Content-Type": "application/json; charset=utf-8"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                raw = resp.read()
            data = json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as e:
            body_text = e.read().decode("utf-8", errors="replace")[:200]
            logger.error(f"[{self._provider_name}] HTTP error: {e.code} {body_text}")
            raise
        except (urllib.error.URLError, TimeoutError) as e:
            logger.error(f"[{self._provider_name}] URL/timeout error: {e}")
            raise
        except Exception as e:
            logger.error(f"[{self._provider_name}] Chat error: {e}")
            raise

        # OpenAI-compatible response: data["choices"][0]["message"]["content"]
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError) as e:
            logger.error(f"[{self._provider_name}] Unexpected response format: {data}")
            raise ValueError(f"Unexpected response format from {self._provider_name}: {e}")

    def chat_json(
        self,
        messages: list[dict[str, str]],
        *,
        schema: Optional[dict[str, Any]] = None,
        model: Optional[str] = None,
        temperature: float = 0.3,
    ) -> dict[str, Any]:
        """
        結構化 JSON 輸出。Strategy:
        1. 加 JSON 格式指示到 system prompt
        2. Call chat()
        3. Parse response (handle markdown code blocks)
        """
        # 加 JSON 指示到 system prompt
        json_instruction = (
            "\n\n重要：請只回傳純 JSON 格式，唔好有 markdown code block 或其他文字。"
            " JSON 結構必須係合法 JSON object。"
        )
        if schema:
            json_instruction += f"\n\nJSON Schema: {json.dumps(schema, ensure_ascii=False)}"

        # Prepend system instruction
        messages_with_json = list(messages)
        if messages_with_json and messages_with_json[0].get("role") == "system":
            messages_with_json[0] = {
                "role": "system",
                "content": messages_with_json[0]["content"] + json_instruction,
            }
        else:
            messages_with_json.insert(0, {"role": "system", "content": json_instruction.lstrip()})

        response_text = self.chat(
            messages_with_json,
            model=model,
            temperature=temperature,
        )

        # Parse JSON (handle markdown code blocks)
        return _parse_json_response(response_text)

    def count_tokens(self, text: str) -> int:
        """
        Rough token estimate (1 token ≈ 4 chars for English, 1.5 chars for Chinese)。
        對大部分 use case 已經夠準確。
        """
        if not text:
            return 0
        # Count Chinese chars differently
        chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text))
        other_chars = len(text) - chinese_chars
        # Chinese: ~1.5 chars per token, English: ~4 chars per token
        return int(chinese_chars / 1.5 + other_chars / 4)

    def health_check(self) -> bool:
        """
        連線測試 — send a minimal chat.
        """
        try:
            test_messages = [{"role": "user", "content": "ping"}]
            self.chat(test_messages, max_tokens=5)
            return True
        except Exception as e:
            logger.warning(f"[{self._provider_name}] Health check failed: {e}")
            return False


def _parse_json_response(text: str) -> dict[str, Any]:
    """Parse JSON response from LLM, handling markdown code blocks."""
    text = text.strip()

    # Remove markdown code blocks (```json ... ```)
    if text.startswith("```"):
        # Match ```json or ``` followed by content
        match = re.match(r'^```(?:json)?\s*\n?(.*?)\n?```$', text, re.DOTALL)
        if match:
            text = match.group(1).strip()

    # Try parse
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        # Try to find JSON object in text
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                pass
        raise ValueError(f"Failed to parse JSON response: {text[:200]}... ({e})")

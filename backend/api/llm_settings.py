"""
LLM Settings API — 大少 2026-08-01 #9146

Endpoints:
- GET    /api/llm-settings              列出所有 providers (masked key)
- GET    /api/llm-settings/active       攞當前 active provider
- POST   /api/llm-settings              儲存/更新 provider (api_key + endpoint + model)
- POST   /api/llm-settings/switch       切換 active provider
- POST   /api/llm-settings/test         測試連線 (1 token chat — 大少 Option A)
- DELETE /api/llm-settings/{provider}   刪除 provider (admin)

Security:
- API key 入 DB 用 AES-256 encrypt
- List / get 永遠只返 masked key
- Test endpoint 唔 save，只 verify 連線
"""
from __future__ import annotations
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from models import llm_settings as model
from llm import list_predefined_providers
from llm.factory import get_predefined_config
from llm.custom import OpenAICompatibleProvider

router = APIRouter(prefix="/api/llm-settings", tags=["llm-settings"])


# ============================================================================
# Request/Response schemas
# ============================================================================

class LLMSettingsSave(BaseModel):
    """POST body — 儲存/更新 provider"""
    provider: str = Field(..., description="e.g. 'minimax', 'kimi', 'gemini', 'openai', 'my-custom'")
    api_key: str = Field(..., description="Plaintext API key (會被 encrypt 儲存)")
    endpoint: Optional[str] = Field(None, description="Custom provider 嘅 URL")
    model: Optional[str] = Field(None, description="Custom provider 嘅 model name")
    is_custom: bool = Field(False, description="True for 任意 OpenAI-compatible endpoint")


class LLMSettingsSwitch(BaseModel):
    """POST /switch body"""
    provider: str = Field(..., description="要切換做 active 嘅 provider")


class LLMSettingsTest(BaseModel):
    """POST /test body — 唔 save, 只 verify 連線"""
    provider: str = Field(..., description="e.g. 'minimax', 'kimi', 'gemini', 'openai', 'my-custom'")
    api_key: str = Field(..., description="Plaintext API key (純測試，唔 save)")
    endpoint: Optional[str] = Field(None, description="Custom provider 嘅 URL")
    model: Optional[str] = Field(None, description="Custom provider 嘅 model name")
    is_custom: bool = Field(False)


# ============================================================================
# Routes
# ============================================================================

@router.get("")
async def list_providers() -> list[dict]:
    """列出所有 providers (masked API key, NO plaintext)."""
    return model.list_providers()


@router.get("/active")
async def get_active() -> dict:
    """Get currently active provider settings."""
    active = model.get_active_provider()
    if not active:
        raise HTTPException(404, "No active provider configured. Add one via POST /api/llm-settings.")
    return active


@router.post("")
async def save_provider(req: LLMSettingsSave) -> dict:
    """Save or update provider settings. Auto-active if first one."""
    if not req.is_custom:
        predefined = list_predefined_providers()
        if req.provider not in predefined:
            raise HTTPException(
                400,
                f"Unknown pre-defined provider '{req.provider}'. Available: {predefined}. "
                f"Use is_custom=True for custom endpoints.",
            )
    try:
        return model.save_or_update_provider(
            provider=req.provider,
            api_key=req.api_key,
            endpoint=req.endpoint,
            model=req.model,
            is_custom=req.is_custom,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/switch")
async def switch_active(req: LLMSettingsSwitch) -> dict:
    """Switch active provider to given one."""
    result = model.set_active_provider(req.provider)
    if not result:
        raise HTTPException(404, f"Provider '{req.provider}' not found. Add it first.")
    return result


@router.post("/test")
async def test_connection(req: LLMSettingsTest) -> dict:
    """
    測試連線（1 token chat — 大少 Option A 揀咗）。

    唔 save 任何嘢，純 verify:
    - API key 啱
    - Endpoint reachable
    - Model name 啱
    """
    # Resolve endpoint + model
    if req.is_custom:
        endpoint = req.endpoint
        model_name = req.model
    else:
        config = get_predefined_config(req.provider)
        if not config:
            raise HTTPException(400, f"Unknown pre-defined provider '{req.provider}'")
        endpoint = config["endpoint"]
        model_name = config["model"]

    if not endpoint or not model_name:
        raise HTTPException(400, "endpoint and model required for custom provider")

    try:
        provider = OpenAICompatibleProvider(
            api_key=req.api_key,
            endpoint=endpoint,
            model=model_name,
            provider_name=req.provider,
        )
        # 1 token chat
        response = provider.chat(
            [{"role": "user", "content": "ping"}],
            max_tokens=5,
        )
        return {
            "status": "ok",
            "provider": req.provider,
            "endpoint": endpoint,
            "model": model_name,
            "response_preview": response[:50],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Test failed: {e}")


@router.delete("/{provider}")
async def delete_provider(provider: str) -> dict:
    """Delete a provider entry (小心：刪 active 嘅會自動 reset 去其他)."""
    deleted = model.delete_provider(provider)
    if not deleted:
        raise HTTPException(404, f"Provider '{provider}' not found")
    return {"status": "deleted", "provider": provider}

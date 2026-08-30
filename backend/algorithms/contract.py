"""
backend/algorithms/contract.py — Algorithm Verdict Contract (大少 2026-08-31 架構評審 Batch 2)

凡人話: 統一 M1-M6 module verdict 嘅 shape 強制 contract, 防止 caller inject 嗰段 silent fall back
- 之前問題: algorithm_runner.py M7 inject 嗰段 (line 237-244) 用 .get("state", "SIDEWAYS") 拎 field, 缺 field 永久 fall back
- 影響: M1 verdict shape 改咗, M7 silent fall back 落 SIDEWAYS, 大少以為衡行但其實係 trend
- Fix (大少 2026-08-31 P0-3): 用 pydantic BaseModel 強制 contract, 缺 required field 即刻 fail
- 對齊永久 rule §Algorithm Backend-only + 模組化

對應 spec: docs/research/AS-03-cycle-detection/MODULE-XX-*.md
Algorithm:
- ModuleVerdictMeta: M1-M6 module 嘅 meta shape (state / confidence / matchedRules / ...)
- ModuleVerdict: 完整 standard verdict shape (runner inject 落 M7 嘅 shape)
- validate_module_verdict(): helper 拎 verdict 同 raise ValueError 如果 shape 唔啱
- Dedupe by (level + module_id + code) 永久 rule §Module Warning v1.1.0
凡人話: 呢個 file 係「verdict shape 護城河」, 之後 M1 verdict 改 shape 嗰陣, runner 即刻 crash 提示邊個 field 缺
"""

from typing import List, Dict, Any, Optional, Literal
from pydantic import BaseModel, Field, field_validator


# ============================================================
# 永久 rule: M1-M6 module 嘅 standard verdict shape
# 對應 algorithm_runner.py M7 inject 嗰段 (line 245-258)
# ============================================================

class ModuleVerdictMeta(BaseModel):
    """凡人話: M1-M6 module 嘅 meta shape (從 algorithm.meta 拎出嚟)

    Required field:
    - state: 個 module 嘅 cycle state (UP / DOWN / SIDEWAYS / TRANSITION)
    - confidence: 0-1, 信心指數
    - matchedRules: list of matched rule names (永久 rule §Algorithm Backend-only)

    Optional field:
    - matched_rules: alias of matchedRules (for backward compat)
    - rules_fired: alias of matchedRules (for backward compat)
    - 任何其他 field: pass-through 落 module_specific (e.g. zigzagSlope, volumeSignal)

    永久 rule: state / confidence / matchedRules 3 個 field 缺一不可, 缺 field 即刻 raise ValidationError
    """
    state: Literal["UP", "DOWN", "SIDEWAYS", "TRANSITION", "A", "B", "C", "D", "E", "F", "G", "H", "S"]
    confidence: float = Field(ge=0.0, le=1.0)
    matchedRules: Optional[List[str]] = None
    matched_rules: Optional[List[str]] = None
    rules_fired: Optional[List[str]] = None

    @field_validator("state", mode="before")
    @classmethod
    def _validate_state(cls, v: Any) -> str:
        """凡人話: state field 標準化, 缺 → ValueError, SIDEWAYS 唔可以 default (永久 rule P0-3)"""
        if v is None:
            raise ValueError(
                "state field 缺 (永久 rule P0-3: 唔可以 silent fall back 落 SIDEWAYS, "
                "M1 verdict shape 改咗嘅話 runner 要即刻 crash)"
            )
        valid_states = {"UP", "DOWN", "SIDEWAYS", "TRANSITION", "A", "B", "C", "D", "E", "F", "G", "H", "S"}
        if v not in valid_states:
            raise ValueError(
                f"state 嘅 value 唔啱: {v} (永久 rule P0-3: 必須係 {valid_states})"
            )
        return v

    @field_validator("confidence", mode="before")
    @classmethod
    def _validate_confidence(cls, v: Any) -> float:
        """凡人話: confidence field 標準化, 缺 → ValueError"""
        if v is None:
            raise ValueError(
                "confidence field 缺 (永久 rule P0-3: 唔可以 silent fall back 落 0, "
                "M1 verdict shape 改咗嘅話 runner 要即刻 crash)"
            )
        try:
            conf = float(v)
        except (TypeError, ValueError):
            raise ValueError(f"confidence 唔係 number: {v}")
        if not (0.0 <= conf <= 1.0):
            raise ValueError(f"confidence 超出範圍 [0.0, 1.0]: {conf}")
        return conf

    def get_matched_rules(self) -> List[str]:
        """凡人話: 拎 matchedRules (3 個 alias 取第一個有 value 嘅)"""
        return self.matchedRules or self.matched_rules or self.rules_fired or []


class ModuleVerdict(BaseModel):
    """凡人話: M1-M6 module 嘅 standard verdict shape (algorithm_runner M7 inject 嗰段拎)

    Required field:
    - module_id: 個 module 嘅 ID (e.g. "ma-alignment", "hl-structure")
    - state: 個 module 嘅 cycle state
    - confidence: 0-1
    - base_weight: M7 拎呢個 weight 計 SSI (M1=0.25, M2=0.15, M3-M6=0.10)
    - max_drawdown_estimate: Kelly 倉位計 base (預設 0.05)
    - rules_fired: list of matched rule names
    - module_specific: 個 module 嘅 full meta (e.g. M1 嘅 zigzagSlope, M5 嘅 volRatio)
    - warnings: M1-M6 verdict 嘅 warnings list (永久 rule §Module Warning v1.1.0, 對齊 frontend verdict.warnings)

    永久 rule: 全部 required field 缺一不可, 缺 field 即刻 raise ValidationError
    """
    module_id: str
    state: str
    confidence: float = Field(ge=0.0, le=1.0)
    base_weight: float = Field(ge=0.0, le=1.0)
    max_drawdown_estimate: float = Field(ge=0.0, le=1.0, default=0.05)
    rules_fired: List[str] = Field(default_factory=list)
    module_specific: Dict[str, Any] = Field(default_factory=dict)
    warnings: List[Dict[str, Any]] = Field(default_factory=list)

    @field_validator("module_id", mode="before")
    @classmethod
    def _validate_module_id(cls, v: Any) -> str:
        """凡人話: module_id 必須係 6 個 standard ID 之一 (algorithm_runner.py line 211-218 硬編碼)"""
        if not v or not isinstance(v, str):
            raise ValueError(
                f"module_id 缺或唔係 string: {v} (永久 rule P0-3: 必須係 6 個 standard ID 之一)"
            )
        valid_ids = {"ma-alignment", "hl-structure", "trendline", "indicators", "volume", "volatility"}
        if v not in valid_ids:
            raise ValueError(
                f"module_id 唔啱: {v} (永久 rule P0-3: 必須係 {valid_ids})"
            )
        return v

    @field_validator("base_weight", mode="before")
    @classmethod
    def _validate_base_weight(cls, v: Any) -> float:
        """凡人話: base_weight 必須 ≥ 0, 缺 → ValueError"""
        if v is None:
            raise ValueError(
                "base_weight field 缺 (永久 rule P0-3: 唔可以 silent fall back 落 0, "
                "M7 SSI 計錯)"
            )
        try:
            w = float(v)
        except (TypeError, ValueError):
            raise ValueError(f"base_weight 唔係 number: {v}")
        if w < 0.0 or w > 1.0:
            raise ValueError(f"base_weight 超出範圍 [0.0, 1.0]: {w}")
        return w


# ============================================================
# Helper function: 拎 verdict 同 raise ValueError 如果 shape 唔啱
# ============================================================

def validate_module_verdict(verdict_dict: Dict[str, Any]) -> ModuleVerdict:
    """凡人話: 拎 verdict dict 同驗證 shape, 缺 field 即刻 raise ValueError

    Usage:
        validate_module_verdict({
            "module_id": "ma-alignment",
            "state": "UP",
            "confidence": 0.8,
            "base_weight": 0.25,
            "max_drawdown_estimate": 0.05,
            "rules_fired": ["R1", "R2"],
            "module_specific": {...},
            "_warnings": [...],
        })

    永久 rule P0-3:
    - algorithm_runner.py M7 inject 嗰段必 call validate_module_verdict() 拎 shape
    - 缺 required field 即刻 raise ValueError (唔可以 silent fall back)
    - 對齊永久 rule §Algorithm Backend-only + 模組化
    """
    if not isinstance(verdict_dict, dict):
        raise ValueError(
            f"verdict 唔係 dict: {type(verdict_dict).__name__} (永久 rule P0-3)"
        )
    try:
        return ModuleVerdict(**verdict_dict)
    except Exception as e:
        # pydantic ValidationError 已經好詳細, 加 context 方便 debug
        raise ValueError(
            f"module verdict shape 唔啱 (永久 rule P0-3: 缺 required field): "
            f"{type(e).__name__}: {e} | verdict keys: {list(verdict_dict.keys())}"
        ) from e

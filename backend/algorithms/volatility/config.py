"""
backend/algorithms/volatility/config.py — M6 Volatility config (大少 2026-08-20 Phase 7)

凡人話: M6 嘅可調參數 (BB / KC period + std + ATR mult + Squeeze min duration + VCP min windows + Follow-through days)
"""

DEFAULT_VOLATILITY_CONFIG = {
    # Step 1: 基礎指標
    "atrPeriod": 14,
    "bbPeriod": 20,
    "bbStd": 2.0,
    "kcAtrMult": 1.5,
    # Step 2: Squeeze
    "squeezeMinDuration": 5,
    # Step 4: VCP
    "vcpMinWindows": 2,
    # Step 5: Follow-through
    "followThroughDays": 5,
}

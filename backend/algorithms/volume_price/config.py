"""
backend/algorithms/volume_price/config.py — M5 VolumePrice config (大少 2026-08-20 Phase 6)

凡人話: M5 嘅可調參數 (VWAP period / Volume percentile / Breakout / OBV / Pullback / 假突破 threshold)
"""

DEFAULT_VOLUME_PRICE_CONFIG = {
    # Step 1: 基礎指標
    "vwapPeriod": 20,
    "volumePercentileLookback": 60,
    # Step 2: 連續放量判定
    "volumeSurgeMinDays": 3,
    # Step 4: 放量突破
    "breakoutConfirmDays": 3,
    "falseBreakoutRetracePct": 0.5,
    # Step 5: 回調
    "pullbackMinDays": 2,
    "pullbackMaxDays": 20,
    # Step 6: 密集區
    "denseZoneAtrMultiple": 0.5,
    # Step 7: 量价相關係數
    "correlationWindow": 5,
    "divergenceThreshold": 0.4,
}

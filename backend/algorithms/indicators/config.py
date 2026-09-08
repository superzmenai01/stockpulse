"""
backend/algorithms/indicators/config.py — M4 Indicators config (大少 2026-08-20 Phase 5)

凡人話: M4 嘅可調參數 (RSI / MACD period, divergence tolerance, signal threshold, lookback)
"""

DEFAULT_INDICATORS_CONFIG = {
    # v0.2.0 (大少 2026-09-09 01:55 Spec Sync #52): lookbackDays 60 → 250 (1 年, 凡人話: 60 日太短, 永遠 0 個 historical opportunity)
    "lookbackDays": 250,
    "rsiPeriod": 14,
    "macdFast": 12,
    "macdSlow": 26,
    "macdSignal": 9,
    "divergenceTolerance": 0.03,
    "minSwingPct": 0.03,
    # v0.2.0 (大少 2026-09-09 01:55 Spec Sync #52): signalThreshold 0.6 → 0.5 (對齊業界 momentum win rate 35-45%, 之前 0.6 太嚴 98.6% 永遠 hold)
    "signalThreshold": 0.5,
}

"""
backend/algorithms/indicators/config.py — M4 Indicators config (大少 2026-08-20 Phase 5)

凡人話: M4 嘅可調參數 (RSI / MACD period, divergence tolerance, signal threshold, lookback)
"""

DEFAULT_INDICATORS_CONFIG = {
    "lookbackDays": 60,
    "rsiPeriod": 14,
    "macdFast": 12,
    "macdSlow": 26,
    "macdSignal": 9,
    "divergenceTolerance": 0.03,
    "minSwingPct": 0.03,
    "signalThreshold": 0.6,
}

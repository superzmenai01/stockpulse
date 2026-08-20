"""
backend/algorithms/decision_engine/config.py — M8 Decision Engine config (大少 2026-08-20 Phase 10)

凡人話: M8 嘅可調參數 (8 個 finalAction 嘅 trigger 門檻, trading card volatility bucket boundary, LLM hook 配置)
"""

DEFAULT_DECISION_ENGINE_CONFIG = {
    "version": "2.0.0",
    "trapConfidenceThreshold": 0.2,          # < 0.2 → TRAP
    "sellConfidenceThreshold": 0.5,          # >= 0.5 + DOWN majority → SELL
    "buyConfidenceThreshold": 0.5,           # >= 0.5 + UP majority → BUY
    "addGradeThreshold": "A",                # >= A grade + UP majority → ADD
    "holdConfidenceThreshold": 0.65,         # < 0.65 + UP majority → HOLD (等確認)
    "waitGradeThreshold": "C+",              # < B+ grade → WAIT
    # Trading card 3 個 volatility bucket boundary
    "highVolatilityMaxDrawdown": 0.10,       # > 0.10 → 高波動 bucket
    "lowVolatilityMaxDrawdown": 0.05,        # < 0.05 + half Kelly → 低波動 bucket
    # Forecast 3 個 scenarios probability
    "optimisticProbability": 0.25,
    "baselineProbability": 0.50,
    "pessimisticProbability": 0.25,
    # LLM hook (Phase 10 用 hardcoded template, 將來 swap 落 LLM)
    "llmHookEnabled": False,
    "llmProvider": "hardcoded",  # 將來: openai / minimax / kimi / hardcoded
}

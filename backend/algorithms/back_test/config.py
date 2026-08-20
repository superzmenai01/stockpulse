"""
backend/algorithms/back_test/config.py — M9 Back Test config (大少 2026-08-20 Phase 9)

凡人話: M9 嘅可調參數 (walk-forward CV folds / tune ratio / adaptive window size / fine tune percent)
"""

DEFAULT_BACK_TEST_CONFIG = {
    "version": "0.6.0",
    "initialDays": 126,         # 6 個月 (adaptive window start)
    "extendDays": 63,           # 3 個月 (adaptive window extend step)
    "maxDays": 378,             # 18 個月 (adaptive window max)
    "minSamples": 30,           # adaptive window 目標樣本數
    "numFolds": 3,              # walk-forward CV folds
    "tuneRatio": 0.67,          # 2/3 tune, 1/3 validate
    "fineTunePercent": 0.2,     # ±20% fine tune
    "stepDays": 5,              # replay 步長
    "holdDays": [5, 10, 20],    # 對比 hold 5/10/20 日後升跌
    "lookbackDays": 60,         # 保留作 backward compat (1:1 port frontend), 但實際唔 sub-set
}

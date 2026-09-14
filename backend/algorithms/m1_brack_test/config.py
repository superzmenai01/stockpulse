"""
backend/algorithms/m1_brack_test/config.py — M1 Brack Test config (大少 2026-09-14 21:16 confirm)

凡人話: M1 Brack Test 嘅可調參數 (start_index / hit filter / sub_scenario list)
"""

DEFAULT_M1_BRACK_TEST_CONFIG = {
    "version": "0.1.0",
    # Q2: start_index 對齊 M1 algorithm 內部 required_length = max_period + 5 = 65
    # 嚴格 i ≥ 60 會 silent error 跳過 5 日, 所以 start_index = 65
    "startIndex": 65,
    # Q1: hit filter — 只記錄 cycle != sideways 嘅 sub_scenario trigger
    # 對齊 M1 algorithm priority chain spirit (sideways 係 default fallback = 無 sub_scenario 觸發)
    "excludeCycles": ["sideways"],
    # 11 個 sub_scenario list (對齊 M1 v2.6.1 永久 cycle list)
    "allCycles": [
        "strong_uptrend",
        "weak_uptrend",
        "bearish_initial_rise",
        "strong_downtrend",
        "weak_downtrend",
        "bullish_initial_decline",
        "uptrend_correction",
        "downtrend_bounce",
        "decelerating_up",
        "decelerating_down",
        "sideways",  # 永遠 0 hit, 保留做 breakdown display
    ],
}
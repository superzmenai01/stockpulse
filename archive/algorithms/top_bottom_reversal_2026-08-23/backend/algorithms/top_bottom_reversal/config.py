"""
backend/algorithms/top_bottom_reversal/config.py — 評分門檻配置 (大少 2026-08-23)

凡人話: 拎返 extr_specs 嗰套 15 分制評分嘅門檻, 加埋新 framework 嘅 4 級強度
- 8-15 分: 強烈 (STRONG)
- 5-7 分: 中度 (MODERATE)
- 3-4 分: 輕度 (MILD)
- 0-2 分: 暫無 (NONE)

對應 source: docs/extr_specs/到頂轉勢/K线顶部反转判断算法.md §3 核心判斷邏輯
對應 spec: MODULE-TOP-BOTTOM-REVERSAL.md (即將起)
凡人話: 大少可以改呢度嘅數字, 唔使入 algorithm 入面
"""

# 評分權重 (跟 extr_specs 一致)
SCORE_WEIGHTS = {
    # 頂背離 (共 8 分)
    "macd_top_divergence": 3,        # MACD 頂背離
    "rsi_top_divergence": 3,         # RSI 頂背離
    "kdj_top_divergence": 2,         # KDJ 頂背離

    # 底背離 (共 8 分, 對稱頂背離)
    "macd_bottom_divergence": 3,     # MACD 底背離
    "rsi_bottom_divergence": 3,      # RSI 底背離
    "kdj_bottom_divergence": 2,      # KDJ 底背離

    # 超買 / 超賣 (1 分 each)
    "rsi_overbought": 1,             # RSI > 70
    "rsi_oversold": 1,               # RSI < 30
    "kdj_overbought": 1,             # KDJ J > 100
    "kdj_oversold": 1,               # KDJ J < 0

    # 成交量信號 (2 分)
    "volume_shrink_top": 2,          # 升緊但縮量 (見頂)
    "volume_shrink_bottom": 2,       # 跌緊但縮量 (見底)

    # 均線偏離 (1 分)
    "ma20_deviation_top": 1,         # 偏離 MA20 > 10% (見頂)
    "ma20_deviation_bottom": 1,      # 偏離 MA20 < -10% (見底)

    # K 線形態 (2 分 each)
    "dark_cloud_cover": 2,           # 烏雲蓋頂
    "bearish_engulfing": 2,          # 看跌吞沒
    "evening_star": 2,               # 黃昏之星
    "morning_star": 2,               # 晨星
    "bullish_engulfing": 2,          # 看漲吞沒
    "piercing_pattern": 2,           # 曙光初現
}

# 強度分級門檻 (4 級, 0-15 分制)
STRENGTH_THRESHOLDS = {
    "STRONG": 8,      # 強烈 (8-15)
    "MODERATE": 5,    # 中度 (5-7)
    "MILD": 3,        # 輕度 (3-4)
    "NONE": 0,        # 暫無 (0-2)
}

# 技術指標參數 (跟 extr_specs 默認值一致)
INDICATOR_PARAMS = {
    "macd_fast": 12,
    "macd_slow": 26,
    "macd_signal": 9,
    "rsi_period": 14,
    "kdj_n": 9,       # RSV 計算窗口
    "kdj_m1": 3,      # K 平滑係數
    "kdj_m2": 3,      # D 平滑係數
}

# 頂背離偵測參數
DIVERGENCE_PARAMS = {
    "lookback": 30,           # 揾最近 N 日內嘅峰/谷
    "window": 5,              # 局部峰/谷左右各 N 日確認
    "price_change_threshold": 0.01,   # 1% 確認創新高/新低
    "indicator_change_threshold": 0.02,  # 2% 確認指標冇創新高/新低
}

# 成交量萎縮判斷 (跟 extr_specs 一致)
VOLUME_PARAMS = {
    "ma_period": 20,                    # 20 日均量
    "shrink_ratio": 0.7,                # < 70% 均量算萎縮
    "lookback_days": 3,                 # 最近 3 日
    "price_confirm_pct": 0.02,          # 確認 5 日內升/跌 2%
}

# 均線偏離門檻
MA_DEVIATION_THRESHOLD = 0.10  # 10% (跟 extr_specs 一致)

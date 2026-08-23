"""
backend/algorithms/candlestick_patterns/top_patterns.py — 見頂 K 線形態識別 (大少 2026-08-23)

凡人話: 識別 3 個預警股價見頂嘅 K 線形態
- 烏雲蓋頂: 第一日大陽線, 第二日高開低走深入實體一半以下
- 看跌吞沒: 第二日大陰線完全包住第一日嘅小陽線
- 黃昏之星: 第一日大陽線, 第二日十字星, 第三日大陰線

對應 source: docs/extr_specs/到頂轉勢/top_reversal.py detect_dark_cloud_cover / detect_bearish_engulfing / detect_evening_star
對應 spec: MODULE-TOP-BOTTOM-REVERSAL.md
凡人話: 望一望最近 1-3 條 K 線, 判斷係咪見頂形態
"""

from typing import List, Dict, Any


def detect_dark_cloud_cover(klines: List[Dict[str, Any]]) -> bool:
    """凡人話: 烏雲蓋頂 — 第一日大陽線, 第二日高開低走深入實體一半以下

    K 線 pattern:
      Day 1: 大陽線 (close > open, 實體大)
      Day 2: 高開 (open > day1.high), 低走 (close < (day1.open + day1.close) / 2)

    凡人話: 好似烏雲蓋住, 第二日雖然高開但收市跌穿第一日實體中間, 預示見頂

    Args:
        klines: 最近嘅 K 線 list (至少 2 條, 最後一條係今日)

    Returns:
        True = 觸發烏雲蓋頂
    """
    if len(klines) < 2:
        return False

    prev = klines[-2]  # 倒數第二條 (前日)
    curr = klines[-1]  # 最後一條 (今日)

    # 第一日: 大陽線 (close > open)
    prev_bullish = float(prev['close']) > float(prev['open'])

    # 第二日: 大陰線 (close < open)
    curr_bearish = float(curr['close']) < float(curr['open'])

    # 高開 (curr.open > prev.high)
    gap_up = float(curr['open']) > float(prev['high'])

    # 收市深入第一日實體一半以下
    prev_mid = (float(prev['open']) + float(prev['close'])) / 2
    close_below_mid = float(curr['close']) < prev_mid

    return prev_bullish and curr_bearish and gap_up and close_below_mid


def detect_bearish_engulfing(klines: List[Dict[str, Any]]) -> bool:
    """凡人話: 看跌吞沒 — 第二日大陰線完全包住第一日嘅小陽線

    K 線 pattern:
      Day 1: 小陽線 (close > open, 實體細)
      Day 2: 大陰線 (close < open, 實體大, 完全包住 day1 實體)

    凡人話: 第二支大陰燭好似吞咗第一支細陽燭咁, 見頂訊號好強

    Args:
        klines: 最近嘅 K 線 list (至少 2 條)

    Returns:
        True = 觸發看跌吞沒
    """
    if len(klines) < 2:
        return False

    prev = klines[-2]
    curr = klines[-1]

    prev_bullish = float(prev['close']) > float(prev['open'])
    curr_bearish = float(curr['close']) < float(curr['open'])

    # 吞沒: curr.open > prev.close AND curr.close < prev.open
    engulfing = (float(curr['open']) > float(prev['close'])) and (float(curr['close']) < float(prev['open']))

    return prev_bullish and curr_bearish and engulfing


def detect_evening_star(klines: List[Dict[str, Any]]) -> bool:
    """凡人話: 黃昏之星 — 第一日大陽線, 第二日十字星, 第三日大陰線

    K 線 pattern:
      Day 1: 大陽線 (實體大)
      Day 2: 十字星 (實體好細, < day1 實體 30%)
      Day 3: 大陰線 (收市喺 day1 實體範圍內)

    凡人話: 三日見頂形態, 太陽 (大陽) → 星 (猶豫) → 黃昏 (大陰), 預示見頂

    Args:
        klines: 最近嘅 K 線 list (至少 3 條)

    Returns:
        True = 觸發黃昏之星
    """
    if len(klines) < 3:
        return False

    first = klines[-3]   # 3 日前
    second = klines[-2]  # 2 日前 (中間日)
    third = klines[-1]   # 1 日前 (今日)

    first_bullish = float(first['close']) > float(first['open'])
    first_body = abs(float(first['close']) - float(first['open']))

    # 十字星: 實體好細 (< first_body * 0.3)
    second_body = abs(float(second['close']) - float(second['open']))
    second_doji = second_body < (first_body * 0.3)

    # 第三日: 大陰線
    third_bearish = float(third['close']) < float(third['open'])

    # 第三日收市喺第一日實體範圍內 (close < first.close AND close > first.open)
    third_close_inside = (float(third['close']) < float(first['close']) and
                          float(third['close']) > float(first['open']))

    return first_bullish and second_doji and third_bearish and third_close_inside


def detect_all_top_patterns(klines: List[Dict[str, Any]]) -> Dict[str, bool]:
    """凡人話: 一次過 detect 晒 3 個見頂形態

    Returns:
        Dict: {"dark_cloud_cover": bool, "bearish_engulfing": bool, "evening_star": bool}
    """
    return {
        "dark_cloud_cover": detect_dark_cloud_cover(klines),
        "bearish_engulfing": detect_bearish_engulfing(klines),
        "evening_star": detect_evening_star(klines),
    }

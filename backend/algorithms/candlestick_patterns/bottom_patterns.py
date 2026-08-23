"""
backend/algorithms/candlestick_patterns/bottom_patterns.py — 見底 K 線形態識別 (大少 2026-08-23)

凡人話: 識別 3 個預警股價見底嘅 K 線形態 (對稱 top_patterns.py)
- 晨星: 第一日大陰線, 第二日十字星, 第三日大陽線 (黃昏之星嘅相反)
- 看漲吞沒: 第二日大陽線完全包住第一日嘅小陰線 (看跌吞沒嘅相反)
- 曙光初現: 第一日大陰線, 第二日低開高走深入實體一半以上 (烏雲蓋頂嘅相反)

對應 source: 對稱 docs/extr_specs/到頂轉勢/top_reversal.py 嘅 3 個見頂形態
對應 spec: MODULE-TOP-BOTTOM-REVERSAL.md
凡人話: 望一望最近 1-3 條 K 線, 判斷係咪見底形態
"""

from typing import List, Dict, Any


def detect_morning_star(klines: List[Dict[str, Any]]) -> bool:
    """凡人話: 晨星 — 第一日大陰線, 第二日十字星, 第三日大陽線 (黃昏之星嘅相反)

    K 線 pattern:
      Day 1: 大陰線 (實體大)
      Day 2: 十字星 (實體好細, < day1 實體 30%)
      Day 3: 大陽線 (收市喺 day1 實體範圍內)

    凡人話: 三日見底形態, 黑暗 (大陰) → 星 (猶豫) → 晨光 (大陽), 預示見底

    Args:
        klines: 最近嘅 K 線 list (至少 3 條)

    Returns:
        True = 觸發晨星
    """
    if len(klines) < 3:
        return False

    first = klines[-3]
    second = klines[-2]
    third = klines[-1]

    first_bearish = float(first['close']) < float(first['open'])
    first_body = abs(float(first['close']) - float(first['open']))

    second_body = abs(float(second['close']) - float(second['open']))
    second_doji = second_body < (first_body * 0.3)

    third_bullish = float(third['close']) > float(third['open'])

    # 第三日收市喺第一日實體範圍內 (close > first.close AND close < first.open)
    third_close_inside = (float(third['close']) > float(first['close']) and
                          float(third['close']) < float(first['open']))

    return first_bearish and second_doji and third_bullish and third_close_inside


def detect_bullish_engulfing(klines: List[Dict[str, Any]]) -> bool:
    """凡人話: 看漲吞沒 — 第二日大陽線完全包住第一日嘅小陰線 (看跌吞沒嘅相反)

    K 線 pattern:
      Day 1: 小陰線 (close < open)
      Day 2: 大陽線 (close > open, 完全包住 day1 實體)

    凡人話: 第二支大陽燭好似吞咗第一支細陰燭咁, 見底訊號好強

    Args:
        klines: 最近嘅 K 線 list (至少 2 條)

    Returns:
        True = 觸發看漲吞沒
    """
    if len(klines) < 2:
        return False

    prev = klines[-2]
    curr = klines[-1]

    prev_bearish = float(prev['close']) < float(prev['open'])
    curr_bullish = float(curr['close']) > float(curr['open'])

    # 吞沒: curr.open < prev.close AND curr.close > prev.open
    engulfing = (float(curr['open']) < float(prev['close'])) and (float(curr['close']) > float(prev['open']))

    return prev_bearish and curr_bullish and engulfing


def detect_piercing_pattern(klines: List[Dict[str, Any]]) -> bool:
    """凡人話: 曙光初現 — 第一日大陰線, 第二日低開高走深入實體一半以上 (烏雲蓋頂嘅相反)

    K 線 pattern:
      Day 1: 大陰線 (close < open, 實體大)
      Day 2: 低開 (open < day1.low), 高走 (close > (day1.open + day1.close) / 2)

    凡人話: 雖然低開但係反彈升穿第一日實體中間, 見底訊號

    Args:
        klines: 最近嘅 K 線 list (至少 2 條)

    Returns:
        True = 觸發曙光初現
    """
    if len(klines) < 2:
        return False

    prev = klines[-2]
    curr = klines[-1]

    prev_bearish = float(prev['close']) < float(prev['open'])
    curr_bullish = float(curr['close']) > float(curr['open'])

    # 低開 (curr.open < prev.low)
    gap_down = float(curr['open']) < float(prev['low'])

    # 收市深入第一日實體一半以上
    prev_mid = (float(prev['open']) + float(prev['close'])) / 2
    close_above_mid = float(curr['close']) > prev_mid

    return prev_bearish and curr_bullish and gap_down and close_above_mid


def detect_all_bottom_patterns(klines: List[Dict[str, Any]]) -> Dict[str, bool]:
    """凡人話: 一次過 detect 晒 3 個見底形態

    Returns:
        Dict: {"morning_star": bool, "bullish_engulfing": bool, "piercing_pattern": bool}
    """
    return {
        "morning_star": detect_morning_star(klines),
        "bullish_engulfing": detect_bullish_engulfing(klines),
        "piercing_pattern": detect_piercing_pattern(klines),
    }

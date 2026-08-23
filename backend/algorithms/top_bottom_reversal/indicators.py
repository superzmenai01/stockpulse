"""
backend/algorithms/top_bottom_reversal/indicators.py — MACD / RSI / KDJ 計算 (大少 2026-08-23)

凡人話: 從 K 線拎 MACD / RSI / KDJ 3 個技術指標, 用嚟做頂底背離偵測
全部用 EMA 算法 (跟 extr_specs reference 一致), 唔用 SMA

對應 source: docs/extr_specs/到頂轉勢/top_reversal.py calculate_macd / calculate_rsi / calculate_kdj
對應 spec: MODULE-TOP-BOTTOM-REVERSAL.md
凡人話: 3 個指標就好似汽車儀表板 (MACD 加速度計 / RSI 體溫計 / KDJ 脈搏計)
"""

from typing import List, Dict, Any
import numpy as np

from .config import INDICATOR_PARAMS


def calculate_macd(closes: np.ndarray) -> Dict[str, np.ndarray]:
    """凡人話: 計算 MACD 指標 (加速度計)

    MACD 公式:
      DIF = EMA(12 日) - EMA(26 日)        ← 短期趨勢 - 長期趨勢
      DEA = EMA(DIF, 9 日)                  ← DIF 嘅平滑線
      HISTOGRAM = (DIF - DEA) × 2           ← 兩條線嘅差距 (紅柱=多頭, 綠柱=空頭)

    凡人話: DIF 正數 = 上升趨勢, 負數 = 下跌趨勢; HISTOGRAM 越長 = 趨勢越強

    Args:
        closes: 收市價 array (numpy)

    Returns:
        Dict: {"dif": array, "dea": array, "histogram": array}
    """
    fast = INDICATOR_PARAMS["macd_fast"]
    slow = INDICATOR_PARAMS["macd_slow"]
    signal = INDICATOR_PARAMS["macd_signal"]

    ema_fast = _ema(closes, fast)
    ema_slow = _ema(closes, slow)
    dif = ema_fast - ema_slow
    dea = _ema(dif, signal)
    histogram = (dif - dea) * 2

    return {"dif": dif, "dea": dea, "histogram": histogram}


def calculate_rsi(closes: np.ndarray) -> np.ndarray:
    """凡人話: 計算 RSI 相對強弱指標 (體溫計)

    RSI 公式:
      delta = 今日收市 - 昨日收市
      gain = max(delta, 0)  ← 升幅
      loss = max(-delta, 0) ← 跌幅
      avg_gain = EMA(gain, 14)
      avg_loss = EMA(loss, 14)
      RS = avg_gain / avg_loss
      RSI = 100 - 100 / (1 + RS)

    凡人話: RSI 0-100 衡量買賣力量邊個強, 70 以上超買, 30 以下超賣

    Args:
        closes: 收市價 array

    Returns:
        RSI array (0-100)
    """
    period = INDICATOR_PARAMS["rsi_period"]

    delta = np.diff(closes, prepend=closes[0])
    gain = np.where(delta > 0, delta, 0)
    loss = np.where(delta < 0, -delta, 0)

    avg_gain = _ema(gain, period)
    avg_loss = _ema(loss, period)

    # 避免除以 0
    rs = np.divide(avg_gain, avg_loss, out=np.zeros_like(avg_gain), where=avg_loss > 0)
    rsi = 100 - (100 / (1 + rs))

    return rsi


def calculate_kdj(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray) -> Dict[str, np.ndarray]:
    """凡人話: 計算 KDJ 隨機指標 (脈搏計)

    KDJ 公式:
      RSV = (close - 9 日內最低) / (9 日內最高 - 9 日內最低) × 100
      K = 2/3 × 前日 K + 1/3 × 當日 RSV
      D = 2/3 × 前日 D + 1/3 × 當日 K
      J = 3K - 2D

    凡人話: K = 敏感線, D = 穩重線, J = K+D 嘅放大鏡 (J>100 超買, J<0 超賣)

    Args:
        highs: 最高價 array
        lows: 最低價 array
        closes: 收市價 array

    Returns:
        Dict: {"k": array, "d": array, "j": array}
    """
    n = INDICATOR_PARAMS["kdj_n"]
    m1 = INDICATOR_PARAMS["kdj_m1"]
    m2 = INDICATOR_PARAMS["kdj_m2"]

    # 計算 RSV
    lowest_low = _rolling_min(lows, n)
    highest_high = _rolling_max(highs, n)
    price_range = highest_high - lowest_low
    rsv = np.divide(
        (closes - lowest_low) * 100,
        price_range,
        out=np.zeros_like(closes),
        where=price_range > 0,
    )

    # 計算 K (RSV 嘅 EMA)
    k = _ema(rsv, m1)
    # 計算 D (K 嘅 EMA)
    d = _ema(k, m2)
    # 計算 J (K + D 嘅放大)
    j = 3 * k - 2 * d

    return {"k": k, "d": d, "j": j}


def _ema(values: np.ndarray, period: int) -> np.ndarray:
    """凡人話: 指數移動平均線 (EMA) — 對最近嘅數據加權更重

    公式: EMA_today = (value_today × 2/(period+1)) + (EMA_yesterday × (1 - 2/(period+1)))

    Args:
        values: 數值 array
        period: 計算窗口 (e.g. 12, 26, 9)

    Returns:
        EMA array
    """
    alpha = 2.0 / (period + 1)
    ema = np.zeros_like(values, dtype=float)
    ema[0] = values[0]

    for i in range(1, len(values)):
        ema[i] = values[i] * alpha + ema[i - 1] * (1 - alpha)

    return ema


def _rolling_min(values: np.ndarray, window: int) -> np.ndarray:
    """凡人話: N 日內最低值"""
    result = np.zeros_like(values, dtype=float)
    for i in range(len(values)):
        start = max(0, i - window + 1)
        result[i] = np.min(values[start:i + 1])
    return result


def _rolling_max(values: np.ndarray, window: int) -> np.ndarray:
    """凡人話: N 日內最高值"""
    result = np.zeros_like(values, dtype=float)
    for i in range(len(values)):
        start = max(0, i - window + 1)
        result[i] = np.max(values[start:i + 1])
    return result

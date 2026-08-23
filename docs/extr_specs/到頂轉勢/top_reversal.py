"""
K线图顶部反转判断算法
作者：AI量化助手
日期：2026-08-23
"""

import yfinance as yf
import pandas as pd
import numpy as np


# ============================================================
# 第一部分：技术指标计算函数
# ============================================================

def calculate_macd(close, fast=12, slow=26, signal=9):
    """
    计算MACD指标
    人话：MACD就像股价的"加速度计"
    - DIF（快线）：短期均线减长期均线
    - DEA（慢线）：DIF的平滑线
    - 柱状图：DIF和DEA的差距，红柱=多头强，绿柱=空头强
    """
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    dif = ema_fast - ema_slow
    dea = dif.ewm(span=signal, adjust=False).mean()
    histogram = (dif - dea) * 2
    return dif, dea, histogram


def calculate_rsi(close, period=14):
    """
    计算RSI相对强弱指标
    人话：RSI就像"体温计"，0-100衡量买卖双方谁更强
    >70 = 超买（买方透支），<30 = 超卖（卖方透支）
    """
    delta = close.diff()
    gain = delta.where(delta > 0, 0)
    loss = (-delta).where(delta < 0, 0)
    avg_gain = gain.ewm(span=period, adjust=False).mean()
    avg_loss = loss.ewm(span=period, adjust=False).mean()
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return rsi


def calculate_kdj(high, low, close, n=9, m1=3, m2=3):
    """
    计算KDJ随机指标
    人话：KDJ就像"弹簧"
    - K线：快速线，最敏感
    - D线：慢速线，更稳重
    - J线：K和D的放大镜，J>100=超买，J<0=超卖
    """
    lowest_low = low.rolling(window=n).min()
    highest_high = high.rolling(window=n).max()
    rsv = (close - lowest_low) / (highest_high - lowest_low) * 100
    k = rsv.ewm(com=m1-1, adjust=False).mean()
    d = k.ewm(com=m2-1, adjust=False).mean()
    j = 3 * k - 2 * d
    return k, d, j


def calculate_ma(close, periods=[5, 10, 20, 60]):
    """计算移动平均线"""
    mas = {}
    for period in periods:
        mas[f'MA{period}'] = close.rolling(window=period).mean()
    return mas


# ============================================================
# 第二部分：顶背离检测算法（核心）
# ============================================================

def detect_divergence(price, indicator, lookback=30, window=5):
    """
    检测顶背离
    人话：顶背离就是"股价和指标唱反调"
    - 正常：股价涨，指标也涨
    - 顶背离：股价创新高，但指标没创新高
    - 就像人还在往上爬，但力气已经用尽了
    """
    divergences = []
    price = pd.Series(price).reset_index(drop=True)
    indicator = pd.Series(indicator).reset_index(drop=True)

    # 找价格的局部高点
    price_peaks = []
    for i in range(window, len(price) - window):
        is_peak = True
        for j in range(1, window + 1):
            if price.iloc[i] < price.iloc[i - j] or price.iloc[i] < price.iloc[i + j]:
                is_peak = False
                break
        if is_peak:
            price_peaks.append((i, float(price.iloc[i])))

    # 找指标的局部高点
    indicator_peaks = []
    for i in range(window, len(indicator) - window):
        if pd.isna(indicator.iloc[i]):
            continue
        is_peak = True
        for j in range(1, window + 1):
            if pd.isna(indicator.iloc[i - j]) or pd.isna(indicator.iloc[i + j]):
                is_peak = False
                break
            if (float(indicator.iloc[i]) < float(indicator.iloc[i - j]) or
                float(indicator.iloc[i]) < float(indicator.iloc[i + j])):
                is_peak = False
                break
        if is_peak:
            indicator_peaks.append((i, float(indicator.iloc[i])))

    # 检测顶背离：价格创新高，但指标没创新高
    for i in range(1, len(price_peaks)):
        curr_price_idx, curr_price = price_peaks[i]
        prev_price_idx, prev_price = price_peaks[i-1]

        if curr_price_idx - prev_price_idx < lookback // 2:
            continue

        curr_indicator_val = None
        prev_indicator_val = None
        for idx, val in indicator_peaks:
            if abs(idx - curr_price_idx) <= window:
                curr_indicator_val = val
            if abs(idx - prev_price_idx) <= window:
                prev_indicator_val = val

        if curr_indicator_val is None and curr_price_idx < len(indicator):
            curr_indicator_val = float(indicator.iloc[curr_price_idx])
        if prev_indicator_val is None and prev_price_idx < len(indicator):
            prev_indicator_val = float(indicator.iloc[prev_price_idx])

        # 顶背离确认：价格创新高，指标没创新高（允许2%误差）
        if (curr_price > prev_price * 1.01 and 
            curr_indicator_val is not None and prev_indicator_val is not None):
            if curr_indicator_val < prev_indicator_val * 0.98:
                divergences.append({
                    'type': '顶背离',
                    'price_peak_idx': curr_price_idx,
                    'prev_price_peak_idx': prev_price_idx,
                    'curr_price': curr_price,
                    'prev_price': prev_price,
                    'curr_indicator': curr_indicator_val,
                    'prev_indicator': prev_indicator_val,
                    'strength': (prev_indicator_val - curr_indicator_val) / prev_indicator_val
                })

    return divergences


# ============================================================
# 第三部分：K线形态识别
# ============================================================

def detect_dark_cloud_cover(df):
    """乌云盖顶：第一天大阳线，第二天高开低走深入到第一天实体一半以下"""
    if len(df) < 2:
        return False
    prev = df.iloc[-2]
    curr = df.iloc[-1]
    prev_bullish = prev['Close'] > prev['Open']
    curr_bearish = curr['Close'] < curr['Open']
    gap_up = curr['Open'] > prev['High']
    prev_mid = (prev['Open'] + prev['Close']) / 2
    close_below_mid = curr['Close'] < prev_mid
    return prev_bullish and curr_bearish and gap_up and close_below_mid


def detect_bearish_engulfing(df):
    """看跌吞没：第二天大阴线完全包住第一天的小阳线"""
    if len(df) < 2:
        return False
    prev = df.iloc[-2]
    curr = df.iloc[-1]
    prev_bullish = prev['Close'] > prev['Open']
    curr_bearish = curr['Close'] < curr['Open']
    engulfing = (curr['Open'] > prev['Close']) and (curr['Close'] < prev['Open'])
    return prev_bullish and curr_bearish and engulfing


def detect_evening_star(df):
    """黄昏之星：第一天大阳线，第二天十字星，第三天大阴线"""
    if len(df) < 3:
        return False
    first = df.iloc[-3]
    second = df.iloc[-2]
    third = df.iloc[-1]
    first_bullish = first['Close'] > first['Open']
    first_body = abs(first['Close'] - first['Open'])
    second_body = abs(second['Close'] - second['Open'])
    second_doji = second_body < (first_body * 0.3)
    third_bearish = third['Close'] < third['Open']
    third_close_inside = third['Close'] < first['Close'] and third['Close'] > first['Open']
    return first_bullish and second_doji and third_bearish and third_close_inside


# ============================================================
# 第四部分：顶部反转综合判断（核心）
# ============================================================

def detect_top_reversal(df):
    """
    综合判断顶部反转信号
    就像给股票做"体检"：量血压(MACD)、体温(RSI)、脉搏(KDJ)
    三个指标同时说"不行了"，就是真的到顶了
    """
    signals = []

    # 计算所有指标
    dif, dea, macd_hist = calculate_macd(df['Close'])
    rsi = calculate_rsi(df['Close'])
    k, d, j = calculate_kdj(df['High'], df['Low'], df['Close'])
    mas = calculate_ma(df['Close'])

    # 加入DataFrame
    df['DIF'] = dif
    df['DEA'] = dea
    df['MACD_HIST'] = macd_hist
    df['RSI'] = rsi
    df['K'] = k
    df['D'] = d
    df['J'] = j
    for name, ma in mas.items():
        df[name] = ma

    # 1. 检测MACD顶背离
    macd_divergences = detect_divergence(df['Close'], macd_hist, lookback=30, window=5)
    # 2. 检测RSI顶背离
    rsi_divergences = detect_divergence(df['Close'], rsi, lookback=30, window=5)
    # 3. 检测KDJ顶背离
    kdj_divergences = detect_divergence(df['Close'], k, lookback=30, window=5)

    # 4. 成交量萎缩
    volume_ma20 = df['Volume'].rolling(window=20).mean()
    volume_shrink = ((df['Volume'].iloc[-3:] < volume_ma20.iloc[-3:] * 0.7).all() and
                     (df['Close'].iloc[-1] > df['Close'].iloc[-5] * 1.02))

    # 5. 股价远离均线
    price_deviation = (df['Close'].iloc[-1] - df['MA20'].iloc[-1]) / df['MA20'].iloc[-1]
    far_from_ma = price_deviation > 0.10

    # 6. K线形态
    dark_cloud = detect_dark_cloud_cover(df)
    bearish_engulfing = detect_bearish_engulfing(df)
    evening_star = detect_evening_star(df)

    # ========== 综合评分 ==========
    score = 0
    details = []

    if len(macd_divergences) > 0:
        score += 3
        details.append(f"MACD顶背离（最近：{df.index[macd_divergences[-1]['price_peak_idx']].strftime('%Y-%m-%d')}）")

    if len(rsi_divergences) > 0:
        score += 3
        details.append(f"RSI顶背离（最近：{df.index[rsi_divergences[-1]['price_peak_idx']].strftime('%Y-%m-%d')}）")

    if len(kdj_divergences) > 0:
        score += 2
        details.append(f"KDJ顶背离（最近：{df.index[kdj_divergences[-1]['price_peak_idx']].strftime('%Y-%m-%d')}）")

    if rsi.iloc[-1] > 70:
        score += 1
        details.append(f"RSI超买（当前：{rsi.iloc[-1]:.1f}）")

    if j.iloc[-1] > 100:
        score += 1
        details.append(f"KDJ超买（J值：{j.iloc[-1]:.1f}）")

    if volume_shrink:
        score += 2
        details.append("成交量萎缩（上涨无量）")

    if far_from_ma:
        score += 1
        details.append(f"股价远离均线（偏离MA20：{price_deviation*100:.1f}%）")

    if dark_cloud:
        score += 2
        details.append("乌云盖顶形态")
    if bearish_engulfing:
        score += 2
        details.append("看跌吞没形态")
    if evening_star:
        score += 2
        details.append("黄昏之星形态")

    # 判断信号强度
    if score >= 8:
        strength = "强烈见顶信号"
    elif score >= 5:
        strength = "中度见顶信号"
    elif score >= 3:
        strength = "轻度见顶信号"
    else:
        strength = "暂无见顶信号"

    signals.append({
        'date': df.index[-1],
        'score': score,
        'strength': strength,
        'details': details,
        'macd_divergences': macd_divergences,
        'rsi_divergences': rsi_divergences,
        'kdj_divergences': kdj_divergences,
        'volume_shrink': volume_shrink,
        'far_from_ma': far_from_ma,
        'dark_cloud': dark_cloud,
        'bearish_engulfing': bearish_engulfing,
        'evening_star': evening_star
    })

    return signals, df


# ============================================================
# 第五部分：主程序
# ============================================================

if __name__ == "__main__":
    # 下载股票数据（以腾讯控股为例，可换成其他股票）
    ticker = "0700.HK"
    df = yf.download(ticker, start="2024-01-01", end="2026-08-23", progress=False)

    # 处理多层列索引
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    print(f"已下载 {ticker} 数据，共 {len(df)} 个交易日")

    # 运行顶部反转检测
    signals, df_result = detect_top_reversal(df)

    # 打印结果
    latest = signals[-1]
    print("=" * 60)
    print(f"分析日期：{latest['date'].strftime('%Y-%m-%d')}")
    print(f"综合评分：{latest['score']} / 15 分")
    print(f"信号强度：{latest['strength']}")
    print("=" * 60)
    print("详细信号列表：")
    for i, detail in enumerate(latest['details'], 1):
        print(f"  {i}. {detail}")
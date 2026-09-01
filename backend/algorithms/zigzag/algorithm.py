"""
backend/algorithms/zigzag/algorithm.py — ZigZag Algorithm v0.3.0 (大少 2026-09-01 14:10 trigger 拎走 4.56.0 + 4.57.x)

凡人話: 1-to-1 port testing-page.js 嘅 ZigZag 算法去 Python backend,
對齊 frontend calculateZigZagFrontend, 拎 peak/trough 嘅 high/low value + trigger date/price 3 個新 field
畀 chart 上面嘅紫色 ZigZag line plot。

對應 source (frontend):
- testing-page.js:52-75 (autoThresholdVolatility)
- testing-page.js:78-91 (extractHLC fallback chain)
- testing-page.js 4.9.0/4.10.0 (P 點順序號碼 marker, 1=最新, 倒序排)
- testing-page.js 4.15.0 (大少 fix: 之字拎 point 同 trigger 都用 high/low 對齊, 唔好用 close)
- testing-page.js 4.16.0 (direction flag refactor)
- testing-page.js:61-155 (calculateZigZagFrontend 1-to-1 port)

Algorithm flow (1-to-1 對齊 frontend):
1. extractHLC 拎 high / low / close arrays (fallback chain: high/High/HIGH, low/Low/LOW, close/Close/CLOSE)
2. autoThresholdVolatility 計自動 threshold (formula: avg((high-low)/close, lookback N) × 2.5, clamp 0.5%-20%)
3. calculate_zigzag 拎 ZigZag points (peak/trough, 拎 value 用 high/low, trigger 都用 high/low)
4. 加 P 點 sequence (1=最新, 倒序排, 用 testing page 4.9.0 marker 邏輯)

大少 2026-09-01 14:10 trigger 拎走:
- 4.56.0 'today' point injection (P1 唔再拎 K線最後 close)
- 4.33.0 鮮綠線 build_extension_line function
- 4.57.x skip_today 邏輯 (紫色 P point 計返 T-0 對齊 frontend algorithm 1-to-1)
- 4.56.0 ongoing point 嘅 triggerPrice = K線最後 close (改返用 last_swing_idx K線 high/low)
"""

import datetime
import logging
from typing import List, Dict, Any, Optional, Tuple

from ..base import Algorithm, Verdict
from ..registry import register

logger = logging.getLogger(__name__)


# ============================================================
# 凡人話: 對齊 testing-page.js:78-91 extractHLC
# ============================================================
def extract_hlc(klines: List[Dict[str, Any]]) -> Optional[Dict[str, List[float]]]:
    """凡人話: 從 K 線取 high / low / close arrays (fallback chain, K 線可能用唔同名)

    對應 frontend: testing-page.js:78-91 extractHLC
    """
    if not klines or len(klines) == 0:
        return None
    n = len(klines)
    highs = [0.0] * n
    lows = [0.0] * n
    closes = [0.0] * n
    for i, k in enumerate(klines):
        # 大少 trigger: high / High / HIGH fallback chain
        h = k.get('high', k.get('High', k.get('HIGH')))
        l = k.get('low', k.get('Low', k.get('LOW')))
        c = k.get('close', k.get('Close', k.get('CLOSE')))
        try:
            highs[i] = float(h) if h is not None else 0.0
            lows[i] = float(l) if l is not None else 0.0
            closes[i] = float(c) if c is not None else 0.0
        except (ValueError, TypeError):
            return None
    return {"highs": highs, "lows": lows, "closes": closes}


# ============================================================
# 凡人話: 對齊 testing-page.js:52-75 autoThresholdVolatility
# ============================================================
def auto_threshold_volatility(
    highs: List[float],
    lows: List[float],
    closes: List[float],
    lookback: int = 20,
    multiplier: float = 2.5,
) -> Optional[float]:
    """凡人話: 自動計 threshold (formula: avg((high-low)/close, lookback N) × 2.5, clamp 0.5%-20%)

    對應 frontend: testing-page.js:52-75 autoThresholdVolatility
    """
    if not highs or not lows or not closes:
        return None
    n = min(len(highs), len(lows), len(closes), lookback)
    if n < 2:
        return None
    sum_range = 0.0
    count = 0
    for i in range(len(highs) - n, len(highs)):
        h = highs[i]
        l = lows[i]
        c = closes[i]
        if h is None or l is None or c is None or c <= 0:
            continue
        try:
            h_f = float(h)
            l_f = float(l)
            c_f = float(c)
        except (ValueError, TypeError):
            continue
        if not (h_f == h_f and l_f == l_f and c_f == c_f):  # NaN check
            continue
        sum_range += (h_f - l_f) / c_f
        count += 1
    if count == 0:
        return None
    avg_vol = sum_range / count
    threshold = avg_vol * multiplier
    # 上下限保護: 0.5% - 20%
    threshold = max(threshold, 0.005)
    threshold = min(threshold, 0.20)
    return threshold


# ============================================================
# 凡人話: 對齊 testing-page.js:843 附近 _zigzagNormalizeDate
# ============================================================
def _zigzag_normalize_date(kline: Dict[str, Any]) -> str:
    """凡人話: 拎 K 線 date (time/date/timestamp fallback chain, 對齊 adapter.mjs _zigzagNormalizeDate)

    對應 frontend: backups/zigzag-frontend-2026-08-20/adapter.mjs:843 _zigzagNormalizeDate
    永久 rule (大少 2026-08-19 10:15): 唔好直接拎 klines[].date, fallback chain
    永久 rule (大少 2026-08-22 23:20): 對齊 §3.6 + §3.7 永久 rule「Cross-module 統一 date parsing」

    大少 8月31日 22:03 trigger (4.57.2): backend 拎出嚟嘅 date 統一 YYYY-MM-DD, 唔可以有 datetime (e.g. "2026-08-28 00:00:00")
    對齊 frontend normalizeTime + adapter.mjs dateToTime pattern: `t.split(' ')[0]` 拎 date-only
    永久 rule: 之後改 algorithm / 拎 date 嗰陣必做 `t.split(' ')[0]` 拎 date-only
    """
    raw = (
        kline.get('time')
        or kline.get('date')
        or kline.get('timestamp')
        or ''
    )
    if not raw:
        return ''
    # 對齊 frontend normalizeTime + adapter.mjs dateToTime: 拎 date-only (YYYY-MM-DD)
    # frontend pattern: `t.split(' ')[0] + 'T00:00:00Z'`, backend 拎出嚟係 string, 我哋拎 date-only 部分
    return str(raw).split(' ')[0]


# ============================================================
# 凡人話: 判斷 K 線係咪今日 partial bar (T-1 rule 精神, 大少 2026-09-01 11:00 trigger)
# ============================================================
# ============================================================
# 凡人話: 對齊 testing-page.js:61-155 calculateZigZagFrontend (1-to-1 port)
# ============================================================
def calculate_zigzag(
    klines: List[Dict[str, Any]],
    threshold_percent: float = 5,
) -> List[Dict[str, Any]]:
    """凡人話: ZigZag 轉向點識別 (1-to-1 port frontend 算法)

    對應 frontend: testing-page.js:61-155 calculateZigZagFrontend

    大少 4.15.0 fix: 拎 point 用 high/low, trigger 都用 high/low (唔好用 close)
    大少 4.16.0 refactor: 1 個 direction flag + 1 個 ref value (原本 2 variable + 2 loop)

    拎 point value 用 high / low 對齊 K 線真實 high / low (跟 testing page 4.15.0 永久 rule)

    Returns:
        list of {date, value, type: 'high' | 'low', index, triggerIndex, triggerDate, triggerPrice}
        - value: point 嘅價 (高點拎 high, 低點拎 low)
        - triggerIndex: 獨發點 K 線 index (對齊 4.15.0 規則, 「之後反方向走勢去到 threshold % 確認前一個 point 嗰個 K 線」)
        - triggerDate: 獨發點 K 線日期
        - triggerPrice: 對齊 4.15.0 規則拎嗰個 K 線 high (trough) / low (peak)
    """
    if not klines or len(klines) < 2:
        return []

    result = []
    threshold = threshold_percent / 100.0

    # 拎第一個 point: 永遠用 klines[0].low (frontend 算法 1-to-1)
    # 凡人話: 第一個 point 永遠從第一支 K 線開始, 拎佢嘅 low 做為起點
    # 大少 8月31日 17:42 trigger (4.56.0) — 第一個 point 係起點, 冇「前一個 point 等 trigger」
    # 凡人話: trigger 設返自己 (i=0, date=klines[0].date, price=klines[0].low)
    result.append({
        "date": _zigzag_normalize_date(klines[0]),
        "value": klines[0]['low'],
        "type": 'low',
        "index": 0,
        "triggerIndex": 0,
        "triggerDate": _zigzag_normalize_date(klines[0]),
        "triggerPrice": klines[0]['low'],
    })

    last_swing_high = klines[0]['high']
    last_swing_low = klines[0]['low']
    last_swing_idx = 0
    # inUptrend 用 klines[1].close vs klines[0].close 對齊決定初始方向 (frontend 算法 1-to-1)
    in_uptrend = klines[1]['close'] > klines[0]['close'] if len(klines) >= 2 else False

    # 第一個 loop: 找第一個顯著高/低點 (frontend algorithm.mjs:1523-1568)
    for i in range(1, len(klines)):
        # 大少 4.15.0 fix: 用 high/low 拎 point 同 trigger (唔好用 close)
        change_from_high = (klines[i]['low'] - last_swing_high) / last_swing_high   # 用 low 對 high
        change_from_low = (klines[i]['high'] - last_swing_low) / last_swing_low     # 用 high 對 low

        if in_uptrend:
            if klines[i]['high'] > last_swing_high:
                last_swing_high = klines[i]['high']
                last_swing_low = klines[i]['low']
                last_swing_idx = i
            if change_from_high <= -threshold:
                # 大少 8月31日 17:42 trigger (4.57.0) — Peak 嘅獨發點 = 之後跌到 -threshold 嗰個 K 線
                # 對齊 4.15.0 永久 rule: Peak trigger 拎嗰日 K 線 low (跌到 low 先 confirm)
                # 大少 8月31日 21:29 trigger (4.57.1) — BUG FIX: 拎 P point K 線 candidate (last_swing_idx 喺跌 -threshold 嗰個 moment 嘅 snapshot)
                # 對齊凡人話: trigger 一定要係 P point 之後嘅 K 線, intra-bar 同一個 K 線跌夠 -threshold 唔算 confirm P point
                peak_idx_candidate = last_swing_idx  # ← snapshot P point K 線 (跌 -threshold 嗰個 moment)
                if i > peak_idx_candidate:  # ← trigger K 線 > P point K 線 (即係 trigger 喺 P point 之後)
                    result.append({
                        "date": _zigzag_normalize_date(klines[peak_idx_candidate]),
                        "value": last_swing_high,
                        "type": 'high',
                        "index": peak_idx_candidate,
                        "triggerIndex": i,
                        "triggerDate": _zigzag_normalize_date(klines[i]),
                        "triggerPrice": klines[i]['low'],
                    })
                    in_uptrend = False
                    last_swing_low = klines[i]['low']
                    last_swing_high = klines[i]['high']
                    last_swing_idx = i
                    break
                # else: P point K 線 = trigger K 線 (intra-bar volatility 邊界 case), 跳過, 等下一個 K 線跌夠 -threshold 先 confirm
        else:
            if klines[i]['low'] < last_swing_low:
                last_swing_low = klines[i]['low']
                last_swing_high = klines[i]['high']
                last_swing_idx = i
            if change_from_low >= threshold:
                # 大少 8月31日 17:42 trigger (4.57.0) — Trough 嘅獨發點 = 之後升到 +threshold 嗰個 K 線
                # 對齊 4.15.0 永久 rule: Trough trigger 拎嗰日 K 線 high (升到 high 先 confirm)
                # 大少 8月31日 21:29 trigger (4.57.1) — BUG FIX
                trough_idx_candidate = last_swing_idx  # ← snapshot P point K 線 (升 +threshold 嗰個 moment)
                if i > trough_idx_candidate:  # ← trigger K 線 > P point K 線 (即係 trigger 喺 P point 之後)
                    result.append({
                        "date": _zigzag_normalize_date(klines[trough_idx_candidate]),
                        "value": last_swing_low,
                        "type": 'low',
                        "index": trough_idx_candidate,
                        "triggerIndex": i,
                        "triggerDate": _zigzag_normalize_date(klines[i]),
                        "triggerPrice": klines[i]['high'],
                    })
                    in_uptrend = True
                    last_swing_low = klines[i]['low']
                    last_swing_high = klines[i]['high']
                    last_swing_idx = i
                    break
                # else: P point K 線 = trigger K 線 (intra-bar volatility 邊界 case), 跳過, 等下一個 K 線升夠 +threshold 先 confirm

    # 第二個 loop: 繼續追蹤轉向點 (frontend algorithm.mjs:1572-1609)
    for i in range(last_swing_idx + 1, len(klines)):
        change_from_high = (klines[i]['low'] - last_swing_high) / last_swing_high
        change_from_low = (klines[i]['high'] - last_swing_low) / last_swing_low

        if in_uptrend:
            if klines[i]['high'] > last_swing_high:
                last_swing_high = klines[i]['high']
                last_swing_idx = i
            if change_from_high <= -threshold:
                # 大少 8月31日 17:42 trigger (4.57.0) — Peak 嘅獨發點 = 之後跌到 -threshold 嗰個 K 線
                # 對齊 4.15.0 永久 rule: Peak trigger 拎嗰日 K 線 low (跌到 low 先 confirm)
                # 大少 8月31日 21:29 trigger (4.57.1) — BUG FIX: 拎 P point K 線 candidate (last_swing_idx 喺跌 -threshold 嗰個 moment 嘅 snapshot)
                # 對齊凡人話: trigger 一定要係 P point 之後嘅 K 線, intra-bar 同一個 K 線跌夠 -threshold 唔算 confirm P point
                peak_idx_candidate = last_swing_idx  # ← snapshot P point K 線 (跌 -threshold 嗰個 moment)
                if i > peak_idx_candidate:  # ← trigger K 線 > P point K 線 (即係 trigger 喺 P point 之後)
                    result.append({
                        "date": _zigzag_normalize_date(klines[peak_idx_candidate]),
                        "value": last_swing_high,
                        "type": 'high',
                        "index": peak_idx_candidate,
                        "triggerIndex": i,
                        "triggerDate": _zigzag_normalize_date(klines[i]),
                        "triggerPrice": klines[i]['low'],
                    })
                    in_uptrend = False
                    last_swing_low = klines[i]['low']
                    last_swing_idx = i
                # else: P point K 線 = trigger K 線 (intra-bar volatility 邊界 case), 跳過, 等下一個 K 線跌夠 -threshold 先 confirm
        else:
            if klines[i]['low'] < last_swing_low:
                last_swing_low = klines[i]['low']
                last_swing_idx = i
            if change_from_low >= threshold:
                # 大少 8月31日 17:42 trigger (4.57.0) — Trough 嘅獨發點 = 之後升到 +threshold 嗰個 K 線
                # 對齊 4.15.0 永久 rule: Trough trigger 拎嗰日 K 線 high (升到 high 先 confirm)
                # 大少 8月31日 21:29 trigger (4.57.1) — BUG FIX
                trough_idx_candidate = last_swing_idx  # ← snapshot P point K 線 (升 +threshold 嗰個 moment)
                if i > trough_idx_candidate:  # ← trigger K 線 > P point K 線 (即係 trigger 喺 P point 之後)
                    result.append({
                        "date": _zigzag_normalize_date(klines[trough_idx_candidate]),
                        "value": last_swing_low,
                        "type": 'low',
                        "index": trough_idx_candidate,
                        "triggerIndex": i,
                        "triggerDate": _zigzag_normalize_date(klines[i]),
                        "triggerPrice": klines[i]['high'],
                    })
                    in_uptrend = True
                    last_swing_high = klines[i]['high']
                    last_swing_idx = i
                # else: P point K 線 = trigger K 線 (intra-bar volatility 邊界 case), 跳過, 等下一個 K 線升夠 +threshold 先 confirm

    # 添加最後一個有效轉向點 (frontend algorithm.mjs:1611-1622)
    # 大少 2026-09-01 14:10 trigger (拎走 4.56.0 嘅 'today' point + 鮮綠線 + skip_today, full revert):
    # ongoing point 嘅 trigger 拎 last_swing_idx K線嘅 high/low + date (normal pattern)
    # 唔再用 K線最後 close (拎走 4.56.0 精神「加今日 close 做 P1」)
    # 大少 2026-09-01 16:48 trigger (4.60.0) — ongoing point 嘅 trigger 改 null + is_ongoing=true
    #   凡人話: 之前 ongoing point 硬填 trigger=last_swing_idx (講大話話「已經 confirm」),
    #   但真實情況係 threshold % 嘅 K 線未出現 (e.g. 01347 P1 trough 105.5 需要 high ≥ 125.89 先 trigger, 而家 K 線得 125.6 差 0.3 蚊)
    #   trigger 設 null 表示「仲未 trigger」, is_ongoing 畀 frontend 分到 (顯示「(待觸發)」)
    last_date = _zigzag_normalize_date(klines[last_swing_idx])
    if result[-1]['date'] != last_date:
        # 凡人話: 最後一個 point 係「ongoing」, 仲未確認轉勢 (K 線行緊)
        # trigger 設 null (唔好填 self 講大話), 加 is_ongoing flag 畀 frontend
        result.append({
            "date": last_date,
            "value": last_swing_high if in_uptrend else last_swing_low,
            "type": 'high' if in_uptrend else 'low',
            "index": last_swing_idx,
            "triggerIndex": None,    # ongoing 未 trigger, 唔填 self 講大話
            "triggerDate": None,     # ongoing 未 trigger
            "triggerPrice": None,    # ongoing 未 trigger
            "is_ongoing": True,      # 4.60.0 新加, frontend 拎呢個 flag 顯示「(待觸發)」
        })

    # 大少 8月31日 17:42 trigger (4.57.0) — 加獨發點 3 個 field (triggerIndex / triggerDate / triggerPrice)
    #   凡人話: 大少想知每個 ZigZag point 係「邊一日 trigger 到 threshold % 先 confirm 嘅」(獨發點)
    #   對齊 4.15.0 永久 rule「之字拎 point 同 trigger 都用 high/low」, trigger 拎嗰個 K 線 high (trough) / low (peak)
    #   永久 rule: 之後 ZigZag 拎新 point / 改 algorithm 嗰陣必加呢 3 個 field

    return result


# ============================================================
# 凡人話: 對齊 testing-page.js 4.9.0/4.10.0 P 點順序號碼 (1=最新, 倒序排)
# ============================================================
def assign_sequence_numbers(
    points: List[Dict[str, Any]],
    klines: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """凡人話: 為每個 ZigZag point 加 sequence 號碼, 1=最新, 倒序排

    對應 frontend: testing-page.js 4.9.0/4.10.0
    大少 trigger: 每個點加順序號碼, 由最新開始
    testing page marker: high → aboveBar, low → belowBar

    1 號 = 紫色最後 1 個 ZigZag point (points[-1])
    2 號 = 紫色倒數第 2 個 ZigZag point (points[-2])
    ... 倒序排

    Returns:
        points copy with `sequence` field (1-based, 1 = 最新)
    """
    if not points:
        return []

    n = len(points)
    # 倒序排: 1 = points[-1] (最後一個 = 最新), 2 = points[-2], ...
    sequence_points = []
    for seq in range(1, n + 1):
        p = points[n - seq]  # 倒序取
        p_copy = dict(p)
        p_copy['sequence'] = seq
        sequence_points.append(p_copy)
    return sequence_points


# ============================================================
# 凡人話: 對齊 testing-page.js 4.12.0 marker 排位 (high → aboveBar, low → belowBar)
# ============================================================
def point_marker_position(point_type: str) -> str:
    """凡人話: 拎 marker 排位 (testing page 4.12.0 永久 rule)

    high → aboveBar (Peak 號碼喺上)
    low → belowBar (Trough 號碼喺下)
    """
    if point_type == 'high':
        return 'aboveBar'
    return 'belowBar'


# ============================================================
# 凡人話: 對齊 testing-page.js 4.13.0 紫線顏色 #A020F0
# 大少 2026-08-30 17:50 新加: 橙色旗仔 marker 顏色 #FF9800
# ============================================================
ZIGZAG_LINE_COLOR = "#A020F0"  # 紫色 (testing page chart ZigZag 線)
DECISION_FLAG_COLOR = "#FF9800"  # 橙色 (大少 2026-08-30 17:50 旗仔 marker)


# ============================================================
# 凡人話: 主 entry — 統一由 runner 拎 K 線 + 計 ZigZag
# ============================================================
def run_zigzag(
    klines: List[Dict[str, Any]],
    threshold_mode: str = "auto",
    manual_threshold: Optional[float] = None,
    lookback: int = 20,
    multiplier: float = 2.5,
) -> Dict[str, Any]:
    """凡人話: 跑 ZigZag 算法 (1-to-1 對齊 frontend calculateZigZagFrontend)

    對應 frontend: testing-page.js 撳跑 algorithm 嗰陣嘅 ZigZag flow

    Args:
        klines: K 線 data (從 KlineCache full flow 拎, T-1 normalized)
        threshold_mode: 'auto' / 'manual' (對齊 testing page LS_KEY_THRESHOLD_MODE)
        manual_threshold: 手動 mode 用, 1-20 (對齊 testing page LS_KEY_MANUAL_THRESHOLD)
        lookback: 自動 mode 計 threshold 用, 5-100 (對齊 testing page LS_KEY_LOOKBACK)
        multiplier: 自動 mode 倍數, 預設 2.5 (testing page auto 公式)

    Returns:
        {
            "ok": bool,
            "points": [{date, value, type, index, sequence}],
            "threshold": float (實際用嘅 threshold, %),
            "threshold_mode": str,
            "klines_count": int,
            "sequence_count": int,
            "error": str or None
        }
    """
    if not klines or len(klines) < 2:
        return {
            "ok": False,
            "points": [],
            "threshold": 0.0,
            "threshold_mode": threshold_mode,
            "klines_count": len(klines) if klines else 0,
            "sequence_count": 0,
            "error": f"數據太少 ({len(klines) if klines else 0} 條), 至少要 2 條先可以計",
        }

    # 1. extractHLC
    hlc = extract_hlc(klines)
    if not hlc:
        return {
            "ok": False,
            "points": [],
            "threshold": 0.0,
            "threshold_mode": threshold_mode,
            "klines_count": len(klines),
            "sequence_count": 0,
            "error": "K 線 data 拎 high/low/close 失敗 (需要每個 kline dict 有 'high' / 'low' / 'close' field)",
        }

    # 2. 拎 threshold (對齊 testing-page.js 邏輯)
    if threshold_mode == "manual" and manual_threshold is not None:
        threshold_percent = float(manual_threshold)
        logger.info(f"[ZigZag] manual mode: threshold = {threshold_percent}%")
    else:
        # auto mode: 自動計
        auto_t = auto_threshold_volatility(
            hlc["highs"], hlc["lows"], hlc["closes"],
            lookback=lookback, multiplier=multiplier
        )
        if auto_t is None:
            return {
                "ok": False,
                "points": [],
                "threshold": 0.0,
                "threshold_mode": threshold_mode,
                "klines_count": len(klines),
                "sequence_count": 0,
                "error": "auto threshold 計算失敗 (K 線 data 唔夠)",
            }
        threshold_percent = auto_t * 100  # 轉做 %
        logger.info(f"[ZigZag] auto mode: threshold = {threshold_percent:.2f}% ({lookback} 日 × {multiplier})")

    # 3. calculate_zigzag
    points = calculate_zigzag(klines, threshold_percent)

    # 4. 加 sequence 號碼 (testing-page.js 4.9.0/4.10.0)
    points_with_seq = assign_sequence_numbers(points, klines)

    return {
        "ok": True,
        "points": points_with_seq,
        "threshold": round(threshold_percent, 4),
        "threshold_mode": threshold_mode,
        "klines_count": len(klines),
        "sequence_count": len(points_with_seq),
        "error": None,
    }


# ============================================================
# 凡人話: 跟 framework ABC 設計 (Phase 1 大少 2026-08-20 Phase 1) — Algorithm contract
# 大少 2026-08-30 17:50 trigger: 重新建 zigzag algorithm + register 入 framework
# 跟 ma_alignment/algorithm.py pattern (function helpers + class + register)
# ============================================================
class ZigZagAlgorithm(Algorithm):
    """ZigZag Algorithm v0.3.0 (大少 2026-09-01 14:10 trigger 拎走 4.56.0 'today' point + 鮮綠線 + 4.57.x skip_today, full revert 4.56.0)

    凡人話: 1-to-1 port testing-page.js calculateZigZagFrontend 算法
    跟 Algorithm ABC 設計, 畀 `/api/algorithms/run?algo=zigzag` endpoint 拎
    對應 source: testing-page.js:61-155 calculateZigZagFrontend

    大少 4.53.0 拎走: decisionDate / decisionValue / decisionType 3 個 field (橙旗決定點拎走後唔再用)
    大少 9月1日 14:10 拎走: 'today' point (4.56.0) + 鮮綠線 build_extension_line (4.33.0) + skip_today (4.57.x), P1 = 紫色 algorithm 拎到嘅最後 confirmed point

    Options shape (跟 framework 標準):
    - threshold: float (ZigZag 過濾 noise 門檻 %, 默認 5)

    Returns Verdict (跟 framework 標準):
    - points: [{date, value, type, index, sequence}]
    - meta: {klines_count, threshold, threshold_mode, lookback, multiplier, zigzag_points_count}
    """
    name = "zigzag"
    version = "0.3.0"

    def run(self, klines: List[Dict[str, Any]], options: Dict[str, Any]) -> Verdict:
        """凡人話: 跑 ZigZag algorithm (4.43.0 重用 run_zigzag helper, 1 個 function 拎所有嘢)

        1. 拎 4 個新 options (threshold_mode / manual_threshold / lookback / multiplier)
        2. call run_zigzag helper 拎所有嘢 (避免重複 logic, 1 個 function 1 個 source of truth)
        3. return Verdict (meta 6 個 field 對齊 testing page 拎法 + production frontend pattern)

        大少 4.43.0 safety improvement #3: 拎走原本重複 logic (extract_hlc + auto_threshold_volatility
        + calculate_zigzag + assign_sequence_numbers), 改 call run_zigzag helper
        拎所有嘢, 避免 2 個 function 重複維護

        大少 4.43.0 Verdict shape 改:
        - 原本 meta 5 個 field → 6 個 field 對齊 testing page 拎法
          (klines_count / threshold / threshold_mode / lookback / multiplier
           / zigzag_points_count)
        - 大少 4.53.0 拎走 decision_flag_count (橙旗決定點拎走後唔再用)
        - 大少 9月1日 14:10 拎走 extension_line (鮮綠線 / 'today' point 拎走後 meta 唔再有呢個 field)
        - points 拎返 verdict.points (跟 ChartContainer.tsx 拎法對齊)
        """
        # 1. 拎 4 個新 options (testing page LS value 經由 endpoint 傳入, validation 已喺 endpoint 做咗)
        threshold_mode = options.get("threshold_mode", "auto")
        manual_threshold = options.get("manual_threshold", None)
        lookback = int(options.get("lookback", 20))
        multiplier = float(options.get("multiplier", 2.5))

        # 2. 大少 4.43.0 safety improvement #3: 重用 run_zigzag helper 拎所有嘢
        #    (1 個 function 1 個 source of truth, 避免原本 2 個 function 重複維護 extract_hlc + auto_threshold_volatility + calculate_zigzag + assign_sequence_numbers)
        result = run_zigzag(klines, threshold_mode, manual_threshold, lookback, multiplier)

        if not result["ok"]:
            return Verdict(
                ok=False,
                points=[],
                meta={
                    "klines_count": result.get("klines_count", 0),
                    "threshold_mode": threshold_mode,
                    "lookback": lookback,
                    "multiplier": multiplier,
                },
                warnings=[],
                error=result.get("error", "ZigZag algorithm 跑失敗"),
            )

        # 3. return Verdict (6 個 meta field 對齊 testing page 拎法)
        return Verdict(
            ok=True,
            points=result["points"],
            meta={
                # 對齊 testing page 拎法 (frontend inject 落 verdict.meta 6 個 field):
                # - lastVerdict.meta.zigzagPoints ← points
                # - lastVerdict.meta.zigzagThreshold ← threshold
                # - lastVerdict.meta.zigzagPointsCount ← zigzag_points_count
                "klines_count": result["klines_count"],
                "threshold": result["threshold"],
                "threshold_mode": result["threshold_mode"],
                "lookback": lookback,
                "multiplier": multiplier,
                "zigzag_points_count": result["sequence_count"],
            },
            warnings=[],
        )


# 凡人話: 自動 register 落 framework (import 呢個 file 就自動 register)
# 跟 ma_alignment/algorithm.py line 535 嘅 pattern
register(ZigZagAlgorithm())

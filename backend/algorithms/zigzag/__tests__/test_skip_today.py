"""
Unit test: ZigZag 紫色 P point 算法跳過今日 partial bar (大少 2026-09-01 11:00 trigger)

凡人話: 確認 algorithm.py 改動 work, 紫色 P point 永遠唔喺今日 trigger,
        'today' point 仍用今日 close, 鮮綠線 P1/P2 唔同日 (P1/P2 同日 bug 永久 fix)

對應 commit: 即將 push (P1/P2 同日 bug fix)
對應永久 rule: AGENTS.md「ZigZag 跳過今日 partial bar (T-1 rule 一致)」

執行: cd /Users/zmenai/stockpulse && python3 backend/algorithms/zigzag/__tests__/test_skip_today.py
"""
import sys
import os
import datetime

# 加 backend 入 sys.path
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
sys.path.insert(0, PROJECT_ROOT)
os.chdir(PROJECT_ROOT)

from backend.algorithms.zigzag.algorithm import calculate_zigzag, _is_today_partial


def make_kline(date_str: str, high: float, low: float, close: float) -> dict:
    """凡人話: build 一個 K 線 dict (對齊 KlineCache format)"""
    return {
        "time": f"{date_str} 00:00:00",
        "high": high,
        "low": low,
        "close": close,
        "open": (high + low) / 2,
        "volume": 1000000,
    }


def make_simple_uptrend_klines(end_date: str, count: int = 20) -> list:
    """凡人話: 製造一個簡單上升趨勢 K 線, 最後 1 條係 trigger 嗰個 (high 升穿 5% threshold)"""
    klines = []
    base_date = datetime.date.fromisoformat(end_date) - datetime.timedelta(days=count)
    for i in range(count):
        d = (base_date + datetime.timedelta(days=i)).isoformat()
        # 平穩升 1% per day
        price = 100 * (1.01 ** i)
        klines.append(make_kline(d, high=price * 1.005, low=price * 0.995, close=price))
    return klines


# ============================================================
# Test 1: _is_today_partial 判斷今日 K 線
# ============================================================
def test_is_today_partial_today():
    """凡人話: 今日 K 線應該 return True"""
    today = datetime.date.today().isoformat()
    k = make_kline(today, 100, 90, 95)
    assert _is_today_partial(k) is True, f"今日 K 線應該 return True"
    print(f"✓ Test 1: _is_today_partial(今日 K 線) = True")


def test_is_today_partial_yesterday():
    """凡人話: 昨日 K 線應該 return False"""
    yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    k = make_kline(yesterday, 100, 90, 95)
    assert _is_today_partial(k) is False, f"昨日 K 線應該 return False"
    print(f"✓ Test 2: _is_today_partial(昨日 K 線) = False")


# ============================================================
# Test 3: 紫色 P point 唔喺今日 trigger (P1/P2 同日 bug fix)
# ============================================================
def test_purple_point_not_on_today():
    """凡人話: 上升趨勢 K 線, 最後 1 條係今日, high 比 T-1 高 5%+ → 算法跳過今日, 紫色 P point 留喺 T-1, 鮮綠線 P1/P2 唔同日"""
    today = datetime.date.today().isoformat()
    yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    day_before = (datetime.date.today() - datetime.timedelta(days=2)).isoformat()

    # Build K 線: T-2 (100), T-1 (101), 今日 (110, 升穿 5%)
    klines = [
        make_kline(day_before, 101, 99, 100),  # T-2
        make_kline(yesterday, 102, 100, 101),  # T-1
        make_kline(today, 115, 105, 110),  # 今日 (升穿 T-1 high 5%+, 但係 partial bar)
    ]

    points = calculate_zigzag(klines, threshold_percent=5)
    print(f"\n  K 線 = [T-2, T-1, 今日 (今日 high 升穿 5%)], threshold = 5%")
    print(f"  紫色 P points 數量 = {len([p for p in points if p['type'] in ('high', 'low')])}")
    print(f"  'today' point 數量 = {len([p for p in points if p['type'] == 'today'])}")
    for p in points:
        print(f"    date={p['date']} value={p['value']} type={p['type']} index={p['index']}")

    # 紫色 P point 唔應該喺今日 trigger
    purple_points = [p for p in points if p['type'] in ('high', 'low')]
    for p in purple_points:
        if p['date'] == today and p['type'] == 'high':
            assert False, f"❌ BUG: 紫色 P point (high) 喺今日 trigger, value={p['value']}, 應該 skip 今日"

    # 'today' point 應該存在, 用今日 close
    today_points = [p for p in points if p['type'] == 'today']
    assert len(today_points) == 1, f"應該有 1 個 'today' point, 拎到 {len(today_points)}"
    assert today_points[0]['date'] == today, f"'today' point date 應該係今日 ({today}), 拎到 {today_points[0]['date']}"
    assert today_points[0]['value'] == 110.0, f"'today' point value 應該係今日 close (110.0), 拎到 {today_points[0]['value']}"

    # P1 (today) 同 P2 (最後紫色) date 唔可以同日
    last_purple = purple_points[-1]
    p1 = today_points[0]
    assert last_purple['date'] != p1['date'], f"❌ BUG: P1 ({p1['date']}) 同 P2 ({last_purple['date']}) 同日"
    print(f"\n✅ Test 3: 紫色 P point 唔喺今日 trigger, P1 ({p1['date']}) 同 P2 ({last_purple['date']}) 唔同日")


# ============================================================
# Test 4: 紫色 P point 可以喺 T-1 trigger (K 線最後一條係 T-1, 唔係今日)
# ============================================================
def test_purple_point_can_trigger_on_t_minus_1():
    """凡人話: K 線最後一條係昨日 (T-1, 已經 close), 算法可以喺 T-1 trigger 紫色 P point, 鮮綠線 P1/P2 唔同日 (因為 today point 用今日 close, 但 K 線冇今日)"""
    today = datetime.date.today().isoformat()
    yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    day_before = (datetime.date.today() - datetime.timedelta(days=2)).isoformat()

    # K 線: T-2 (100), T-1 (110, 升穿 5%)
    # 注意: 今日 (today) 唔在 K 線入面 (e.g. 週末, 仲未開市)
    klines = [
        make_kline(day_before, 101, 99, 100),  # T-2
        make_kline(yesterday, 115, 105, 110),  # T-1 (升穿 5%)
    ]

    points = calculate_zigzag(klines, threshold_percent=5)
    print(f"\n  K 線 = [T-2, T-1 (升穿 5%)], threshold = 5%")
    print(f"  紫色 P points:")
    for p in points:
        if p['type'] in ('high', 'low'):
            print(f"    date={p['date']} value={p['value']} type={p['type']}")
    print(f"  today point:")
    for p in points:
        if p['type'] == 'today':
            print(f"    date={p['date']} value={p['value']} type={p['type']}")

    # 紫色 P point 應該喺 T-1 trigger (因為 K 線最後一條係 T-1, 已經 close)
    purple_points = [p for p in points if p['type'] in ('high', 'low')]
    high_on_t_minus_1 = [p for p in purple_points if p['type'] == 'high' and p['date'] == yesterday]
    assert len(high_on_t_minus_1) >= 1, f"應該有 1 個 high 紫色 P point 喺 T-1, 拎到 {len(high_on_t_minus_1)}"
    print(f"\n✅ Test 4: 紫色 P point 喺 T-1 (昨日, 已經 close) 正常 trigger")


# ============================================================
# Test 5: 原本 P1/P2 同日 bug 場景 (regression test)
# ============================================================
def test_p1_p2_same_day_bug_fixed():
    """凡人話: 原本 bug 場景 — 圖2 (HK.00100), 上升趨勢 + 今日升穿 5%, 紫色 P point 之前會喺今日 trigger, P1/P2 同日"""
    today = datetime.date.today().isoformat()
    yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    day_before = (datetime.date.today() - datetime.timedelta(days=2)).isoformat()

    # 模擬圖2: 上升趨勢, 今日 (今日 partial) high 比 T-1 high 高 5%+
    klines = [
        make_kline(day_before, 100, 95, 98),    # T-2
        make_kline(yesterday, 105, 100, 102),   # T-1
        make_kline(today, 360, 296, 351.4),     # 今日 partial bar (e.g. HK.00100 8月31號 high 360, close 351.4)
    ]

    points = calculate_zigzag(klines, threshold_percent=20)  # 對齊圖2 threshold 20%
    print(f"\n  圖2 場景: K 線 = [T-2, T-1, 今日 (升穿 20%)], threshold = 20%")
    for p in points:
        print(f"    date={p['date']} value={p['value']} type={p['type']}")

    # 紫色 P point 唔應該喺今日 trigger
    purple_points = [p for p in points if p['type'] in ('high', 'low')]
    today_purple = [p for p in purple_points if p['date'] == today]
    assert len(today_purple) == 0, f"❌ BUG: 紫色 P point 喺今日 trigger ({len(today_purple)} 個), 應該 skip 今日"

    # P1 (today) 同 P2 (最後紫色) date 唔可以同日
    today_points = [p for p in points if p['type'] == 'today']
    assert len(today_points) == 1, f"應該有 1 個 'today' point, 拎到 {len(today_points)}"
    last_purple = purple_points[-1] if purple_points else None
    if last_purple:
        p1 = today_points[0]
        assert last_purple['date'] != p1['date'], f"❌ BUG: P1 ({p1['date']}) 同 P2 ({last_purple['date']}) 同日"
        print(f"\n✅ Test 5: 圖2 場景 P1 ({p1['date']}) 同 P2 ({last_purple['date']}) 唔同日, bug 永久 fix")


# ============================================================
# Test 6: 邊界 case — K 線只有 1 條 (今日)
# ============================================================
def test_single_kline_today():
    """凡人話: K 線只有 1 條 (今日), 算法應該 return [] (algorithm.py line 160 已經 handle)"""
    today = datetime.date.today().isoformat()
    klines = [make_kline(today, 100, 90, 95)]
    points = calculate_zigzag(klines, threshold_percent=5)
    assert points == [], f"只有 1 條 K 線應該 return [], 拎到 {len(points)} 個 points"
    print(f"✅ Test 6: 邊界 case — K 線只有 1 條 (今日), return []")


# ============================================================
# Test 7: 邊界 case — K 線只有 2 條 (T-1 + 今日)
# ============================================================
def test_two_klines_t_minus_1_and_today():
    """凡人話: K 線只有 2 條 (T-1 + 今日), 跳過今日後算法拎唔到 P point, 但 'today' point 仍存在, 鮮綠線 P2 (T-1 low) → P1 (今日 close) 唔同日"""
    today = datetime.date.today().isoformat()
    yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()

    klines = [
        make_kline(yesterday, 105, 100, 102),  # T-1
        make_kline(today, 110, 105, 108),      # 今日
    ]

    points = calculate_zigzag(klines, threshold_percent=5)
    print(f"\n  邊界 case: K 線 = [T-1, 今日], threshold = 5%")
    for p in points:
        print(f"    date={p['date']} value={p['value']} type={p['type']}")

    # 應該有 first point (T-1 low) + today point (今日 close)
    today_points = [p for p in points if p['type'] == 'today']
    assert len(today_points) == 1, f"應該有 1 個 'today' point, 拎到 {len(today_points)}"

    purple_points = [p for p in points if p['type'] in ('high', 'low')]
    if purple_points:
        last_purple = purple_points[-1]
        p1 = today_points[0]
        assert last_purple['date'] != p1['date'], f"❌ BUG: P1 ({p1['date']}) 同 P2 ({last_purple['date']}) 同日"
        print(f"  P1 ({p1['date']}) 同 P2 ({last_purple['date']}) 唔同日 ✅")
    print(f"✅ Test 7: 邊界 case — K 線只有 2 條, P1/P2 唔同日")


# ============================================================
# Run all tests
# ============================================================
if __name__ == "__main__":
    print("=" * 70)
    print("ZigZag 跳過今日 partial bar (T-1 rule) — Unit Test")
    print("=" * 70)
    print()

    test_is_today_partial_today()
    test_is_today_partial_yesterday()
    test_purple_point_not_on_today()
    test_purple_point_can_trigger_on_t_minus_1()
    test_p1_p2_same_day_bug_fixed()
    test_single_kline_today()
    test_two_klines_t_minus_1_and_today()

    print()
    print("=" * 70)
    print("✅ 全部 7 個 test pass")
    print("=" * 70)

"""
tmp_research_v23_subscenarios_v4.py — 用真實 K 線 (HTTP call backend) + 跑 M1 拎真實 sub-scenario trigger

凡人話: v3 嘅 root cause 係用 mock_ctx 拎空 OpenD, fall back to DB cache 拎 stale K 線
呢個 v4 fix: 拎走 mock, 用 HTTP call 真 backend /api/kline endpoint, 確保拎到 T-1 8月21日真實 K 線

對應: 大少 2026-08-22 19:44 trigger「你 fix 後再跑, 一定要用真實數據」
"""

import sys
import json
import asyncio
import datetime
import urllib.request
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from algorithms.ma_alignment.algorithm import MAAlignmentV2Algorithm
from algorithms.zigzag.algorithm import ZigZagAlgorithm

BACKEND_URL = 'http://localhost:18792'
WINDOW_DAYS = 1260  # 5 年 K 線, 對齊 testing page 默認
MIN_KLINES = 60


# 從 v3 output 拎返 stock list
def get_stock_list():
    with open(Path(__file__).parent / 'tmp_research_v23_output.json') as f:
        data = json.load(f)
    return [s['code'] for s in data]


def fetch_real_klines_sync(code, period='1d', count=WINDOW_DAYS):
    """凡人話: HTTP call 真 backend /api/kline 拎 K 線 (1.5x buffer, T-1 8月21日 fresh)

    對應 testing-page.js line 826: const klineUrl = `${BACKEND_URL}/api/kline?code=${code}&period=1d}&count=${count}`;
    """
    url = f"{BACKEND_URL}/api/kline?code={urllib.parse.quote(code)}&period={period}&count={count}"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode('utf-8'))
    if data.get('error'):
        raise RuntimeError(f"Backend error: {data['error']}")
    klines = data.get('klines', [])
    if not klines:
        raise RuntimeError(f"No klines returned for {code}")
    return klines, data


def run_m1_with_zigzag_inject(klines, code='UNKNOWN'):
    """凡人話: 跑 M1 algorithm, Stage 2 inject ZigZag 落 options (跟 algorithm_runner pattern)"""
    # 1. 跑 ZigZag 拎 zigzag points
    zz_algo = ZigZagAlgorithm()
    zz_verdict = zz_algo.run(klines, {'threshold': 5.0})
    zigzag_points = zz_verdict.points if zz_verdict.ok else []
    zigzag_slope = zz_verdict.meta.get('zigzagSlope') if zz_verdict.ok else None

    # 2. 跑 M1 拎 verdict
    m1_algo = MAAlignmentV2Algorithm()
    options = {
        'symbol': code,
        'zigzagPoints': zigzag_points,
        'zigzagSlope': zigzag_slope,
        'lastSwingHigh': zz_verdict.meta.get('lastSwingHigh') if zz_verdict.ok else None,
        'lastSwingLow': zz_verdict.meta.get('lastSwingLow') if zz_verdict.ok else None,
        'zigzagThreshold': 5.0,
        'zigzagSource': 'backend (Phase 1 v1.0.0)',
    }
    m1_verdict = m1_algo.run(klines, options)
    return m1_verdict, zigzag_points, zz_verdict


def check_subscenarios_from_m1_verdict(klines, m1_verdict, kline_meta):
    """凡人話: trigger 拎 M1 verdict 嘅 field 拎 data, 唔好自己重新計"""
    meta = m1_verdict.meta if hasattr(m1_verdict, 'meta') else {}
    ma_values = meta.get('maValues', {})
    ma5 = ma_values.get('MA5')
    ma10 = ma_values.get('MA10')
    ma20 = ma_values.get('MA20')
    ma60 = ma_values.get('MA60')

    details = {
        'ma5': ma5, 'ma10': ma10, 'ma20': ma20, 'ma60': ma60,
        'ma_bull': bool(ma5 and ma10 and ma20 and ma60 and ma5 > ma10 > ma20 > ma60),
        'ma_bear': bool(ma5 and ma10 and ma20 and ma60 and ma5 < ma10 < ma20 < ma60),
    }

    volume_signal = meta.get('volumeSignal', 'unknown')
    details['volumeSignal'] = volume_signal

    last = klines[-1] if klines else {}
    details['currentClose'] = last.get('close')
    details['currentHigh'] = last.get('high')
    details['currentLow'] = last.get('low')
    details['lastDate'] = last.get('time')

    # window high/low (5 年 1260 日 K 線, 拎走今日)
    if len(klines) >= 2:
        window_klines = klines[:-1]
        details['windowHigh'] = max(k.get('high', 0) for k in window_klines)
        details['windowLow'] = min(k.get('low', 999999) for k in window_klines)
    else:
        details['windowHigh'] = last.get('high')
        details['windowLow'] = last.get('low')

    # 創新高 / 創新低 trigger
    new_high = False
    new_low = False
    if last.get('high') and details['windowHigh']:
        new_high = last['high'] >= details['windowHigh']
    if last.get('low') and details['windowLow']:
        new_low = last['low'] <= details['windowLow']

    # ZigZag points
    zigzag_points = meta.get('zigzagPoints', [])
    strong_uptrend = False
    strong_downtrend = False

    if len(zigzag_points) >= 4:
        last_4 = zigzag_points[-4:]
        p1, p2, p3, p4 = last_4
        p1p3_same_type = (p1.get('type') == p3.get('type'))
        p2p4_same_type = (p2.get('type') == p4.get('type'))
        p1_val = p1.get('value')
        p2_val = p2.get('value')
        p3_val = p3.get('value')
        p4_val = p4.get('value')

        details['P1'] = {'value': p1_val, 'type': p1.get('type'), 'date': p1.get('date', '')}
        details['P2'] = {'value': p2_val, 'type': p2.get('type'), 'date': p2.get('date', '')}
        details['P3'] = {'value': p3_val, 'type': p3.get('type'), 'date': p3.get('date', '')}
        details['P4'] = {'value': p4_val, 'type': p4.get('type'), 'date': p4.get('date', '')}
        details['p1p3_same_type'] = p1p3_same_type
        details['p2p4_same_type'] = p2p4_same_type

        zigzag_slope = (p1_val - p2_val) / p2_val if p2_val else 0
        details['zigzagSlope'] = zigzag_slope

        if p1p3_same_type and p2p4_same_type:
            if p1_val > p3_val and p2_val > p4_val:
                if details['ma_bull'] and zigzag_slope > 0:
                    strong_uptrend = True
            if p1_val < p3_val and p2_val < p4_val:
                if details['ma_bear'] and zigzag_slope < 0:
                    strong_downtrend = True

    return {
        'strong_uptrend': strong_uptrend,
        'strong_downtrend': strong_downtrend,
        'new_high': new_high,
        'new_low': new_low,
        'details': details,
    }


def process_stock(code):
    """凡人話: 拎真 K 線 (HTTP backend) + 跑 M1 + trigger"""
    try:
        klines, kline_meta = fetch_real_klines_sync(code)
    except Exception as e:
        print(f"  {code}: ❌ fetch fail: {e}")
        return None
    if len(klines) < MIN_KLINES:
        print(f"  {code}: ❌ only {len(klines)} klines")
        return None

    m1_verdict, zigzag_points, zz_verdict = run_m1_with_zigzag_inject(klines, code)
    if not m1_verdict.ok:
        print(f"  {code}: ❌ M1 fail: {m1_verdict.error if hasattr(m1_verdict, 'error') else 'unknown'}")
        return None

    sub = check_subscenarios_from_m1_verdict(klines, m1_verdict, kline_meta)
    d = sub['details']

    triggers = []
    if sub['strong_uptrend']: triggers.append('強勢上升')
    if sub['strong_downtrend']: triggers.append('強勢下跌')
    if sub['new_high']: triggers.append('創新高')
    if sub['new_low']: triggers.append('創新低')
    trigger_str = ' | '.join(triggers) if triggers else '—'

    print(f"  {code}: MA5={d['ma5']:.2f} MA10={d.get('ma10', 0):.2f} MA20={d['ma20']:.2f} MA60={d['ma60']:.2f} | "
          f"bull={d['ma_bull']} bear={d['ma_bear']} | VS={d['volumeSignal']} | "
          f"close={d['currentClose']} date={d['lastDate']} | "
          f"ZSlope={d.get('zigzagSlope', 0):.3f} | Trigger: {trigger_str}")

    return {
        'code': code,
        'klines_count': len(klines),
        'volume_signal': d['volumeSignal'],
        'zigzag_points_count': len(zigzag_points),
        'strong_uptrend': sub['strong_uptrend'],
        'strong_downtrend': sub['strong_downtrend'],
        'new_high': sub['new_high'],
        'new_low': sub['new_low'],
        'details': d,
        'source': 'REAL_BACKEND_HTTP_v4',
    }


def main():
    codes = get_stock_list()
    print(f'Total: {len(codes)} stocks research (REAL backend HTTP, 5 year 1d K-line)')
    print('=' * 80)

    all_results = []
    for i, code in enumerate(codes):
        r = process_stock(code)
        if r:
            all_results.append(r)
        if (i + 1) % 10 == 0:
            print(f'--- {i+1}/{len(codes)} done ---')

    print('=' * 80)
    print(f'Summary: {len(all_results)} stocks OK')
    su = [s['code'] for s in all_results if s.get('strong_uptrend')]
    sd = [s['code'] for s in all_results if s.get('strong_downtrend')]
    nh = [s['code'] for s in all_results if s.get('new_high')]
    nl = [s['code'] for s in all_results if s.get('new_low')]
    print(f'  強勢上升: {len(su)} 隻 — {su}')
    print(f'  強勢下跌: {len(sd)} 隻 — {sd}')
    print(f'  創新高: {len(nh)} 隻 — {nh}')
    print(f'  創新低: {len(nl)} 隻 — {nl}')

    out_path = Path(__file__).parent / 'tmp_research_v23_output_v4.json'
    with open(out_path, 'w') as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False)
    print(f'寫到: {out_path}')


if __name__ == '__main__':
    main()

"""
tmp_research_v25_v21subscenarios.py — 用 v2.1 公式 (包括放量) 拎 4 個 sub-scenario 真實 trigger

凡人話: 由 M1 algorithm 內部 verdict.meta.cycle 拎 9 個 sub-scenario 嘅官方判斷 (v2.1 公式, 包括放量)
大少 20:12 trigger「用返 2.1 嘅公式去揾 60 隻嘅強上升, 強下跌, 弱上升同弱下跌」
"""

import sys
import json
import urllib.request
import urllib.parse
from pathlib import Path
from collections import Counter

sys.path.insert(0, str(Path(__file__).parent.parent))

from algorithms.ma_alignment.algorithm import MAAlignmentV2Algorithm
from algorithms.zigzag.algorithm import ZigZagAlgorithm

BACKEND_URL = 'http://localhost:18792'
WINDOW_DAYS = 1260


def fetch_real_klines(code, period='1d', count=WINDOW_DAYS):
    url = f"{BACKEND_URL}/api/kline?code={urllib.parse.quote(code)}&period={period}&count={count}"
    with urllib.request.urlopen(url, timeout=30) as resp:
        data = json.loads(resp.read().decode('utf-8'))
    klines = data.get('klines', [])
    if not klines:
        raise RuntimeError(f"No klines for {code}")
    return klines


def run_m1_verdict(klines, code):
    zz = ZigZagAlgorithm().run(klines, {'threshold': 5.0})
    zz_points = zz.points if zz.ok else []
    zz_slope = zz.meta.get('zigzagSlope') if zz.ok else None
    m1 = MAAlignmentV2Algorithm().run(klines, {
        'symbol': code,
        'zigzagPoints': zz_points,
        'zigzagSlope': zz_slope,
        'zigzagThreshold': 5.0,
    })
    return m1


def get_stock_list():
    with open(Path(__file__).parent / 'tmp_research_v23_output.json') as f:
        return [s['code'] for s in json.load(f)]


def main():
    codes = get_stock_list()
    print(f'Total: {len(codes)} stocks (v2.1 sub-scenario from M1 verdict.meta.cycle)')
    print('=' * 80)

    sub_counter = Counter()
    target_lists = {
        'strong_uptrend': [],
        'strong_downtrend': [],
        'weak_uptrend': [],
        'weak_downtrend': [],
    }
    details_per_code = {}

    for i, code in enumerate(codes):
        try:
            klines = fetch_real_klines(code)
        except Exception as e:
            print(f'  {code}: ❌ fetch fail: {e}')
            continue
        if len(klines) < 60:
            continue
        m1 = run_m1_verdict(klines, code)
        if not m1.ok:
            continue
        sub = m1.meta.get('cycle', 'unknown')
        sub_counter[sub] += 1
        if sub in target_lists:
            target_lists[sub].append(code)
        details_per_code[code] = {
            'sub': sub,
            'cyclePosition': m1.meta.get('cyclePosition'),
            'ma5': m1.meta.get('maValues', {}).get('MA5'),
            'ma10': m1.meta.get('maValues', {}).get('MA10'),
            'ma20': m1.meta.get('maValues', {}).get('MA20'),
            'ma60': m1.meta.get('maValues', {}).get('MA60'),
            'maSlopes': m1.meta.get('maSlopes'),
            'volumeSignal': m1.meta.get('volumeSignal'),
            'confidence': m1.meta.get('confidence'),
        }
        if (i + 1) % 10 == 0:
            print(f'--- {i+1}/{len(codes)} done ---')

    print('=' * 80)
    print('9 個 sub-scenario 完整分佈 (M1 verdict.meta.cycle v2.1 公式):')
    for sub, cnt in sorted(sub_counter.items(), key=lambda x: -x[1]):
        print(f'  {sub:25s}: {cnt:3d} 隻')
    print('=' * 80)
    print('4 個 target sub-scenario 真實 stock list:')
    for sub in ['strong_uptrend', 'strong_downtrend', 'weak_uptrend', 'weak_downtrend']:
        codes_in = target_lists[sub]
        print(f'  {sub:20s} ({len(codes_in)} 隻): {codes_in}')

    # 拎 target sub-scenario 嘅 details (MA / slope / volume)
    print('=' * 80)
    print('Target sub-scenario 詳細數據 (MA + slope + volume):')
    for sub in ['strong_uptrend', 'strong_downtrend', 'weak_uptrend', 'weak_downtrend']:
        for code in target_lists[sub]:
            d = details_per_code[code]
            slopes = d['maSlopes']
            slope_str = ' '.join(f"{k}={v*100:+.2f}%" for k, v in slopes.items()) if slopes else 'N/A'
            print(f'  [{sub}] {code}: MA5={d["ma5"]:.2f} MA10={d["ma10"]:.2f} MA20={d["ma20"]:.2f} MA60={d["ma60"]:.2f} | VS={d["volumeSignal"]} | conf={d["confidence"]:.2f}')
            print(f'      slopes: {slope_str}')

    out = {
        'sub_counter': dict(sub_counter),
        'target_lists': target_lists,
        'details': details_per_code,
    }
    out_path = Path(__file__).parent / 'tmp_research_v25_output.json'
    with open(out_path, 'w') as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f'寫到: {out_path}')


if __name__ == '__main__':
    main()

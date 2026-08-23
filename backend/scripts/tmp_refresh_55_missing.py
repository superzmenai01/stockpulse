"""
Refresh 55 隻 missing hot stocks (single-thread, sleep 0.5s 避限頻)
- 用 KlineCache.get_or_fetch() 配 nest_asyncio 真 async I/O
- 1d period, 5 年 K 線 (1260 條)
"""
import sys, os, asyncio, time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import nest_asyncio
nest_asyncio.apply()

from futu import OpenQuoteContext
from services.kline_cache import KlineCache

# 55 隻 missing hot stocks (after 1 stock fixed by HK.00285 single trace)
missing_hot = ['HK.00011','HK.00303','HK.00321','HK.00762','HK.00884','HK.00902','HK.00909','HK.00921','HK.00941',
    'HK.01088','HK.01109','HK.01128','HK.01209','HK.01313','HK.01378','HK.01691','HK.01772','HK.01797','HK.01821',
    'HK.01997','HK.02007','HK.02015','HK.02020','HK.02269','HK.02282','HK.02319','HK.02331','HK.02382','HK.02388',
    'HK.02513','HK.02611','HK.02628','HK.02688','HK.02689','HK.02727','HK.02899','HK.03328','HK.03800','HK.03888',
    'HK.03898','HK.03900','HK.03908','HK.03968','HK.03988','HK.06030','HK.06160','HK.06618','HK.06690','HK.06862',
    'HK.06969','HK.09633','HK.09888','HK.09961','HK.09987','HK.09992']
print(f"Missing hot stocks: {len(missing_hot)} 隻")

ctx = OpenQuoteContext(host='127.0.0.1', port=11111)
cache = KlineCache()

async def refresh_one(code):
    try:
        result = await cache.get_or_fetch(
            code=code, ctx=ctx, ktype='K_DAY', period='1d', max_count=1260
        )
        if result and result.get('klines'):
            return {'code': code, 'status': 'SUCCESS', 'klines': len(result['klines']),
                    'fetch_count': result.get('fetch_count', 0)}
        return {'code': code, 'status': 'EMPTY', 'klines': 0}
    except Exception as e:
        return {'code': code, 'status': 'EXCEPTION', 'klines': 0, 'err': str(e)[:200]}

async def main():
    results = []
    print("\n開始 refresh 55 隻 hot stocks (single-thread, sleep 0.5s)...")
    print("=" * 80)
    start = time.time()
    for i, code in enumerate(missing_hot):
        t0 = time.time()
        r = await refresh_one(code)
        elapsed = time.time() - t0
        total = time.time() - start
        if r['status'] == 'SUCCESS':
            print(f"[{i+1:2d}/{len(missing_hot)}] ✅ {code:12s} {r['klines']:5d} 條 (fetch={r['fetch_count']}, {elapsed:.1f}s, total {total/60:.1f}m)")
        else:
            print(f"[{i+1:2d}/{len(missing_hot)}] ❌ {code:12s} {r['status']:10s} {r.get('err', '')[:60]}")
        sys.stdout.flush()
        results.append(r)
        await asyncio.sleep(0.5)

    print("=" * 80)
    success = [r for r in results if r['status'] == 'SUCCESS']
    empty = [r for r in results if r['status'] == 'EMPTY']
    excpt = [r for r in results if r['status'] == 'EXCEPTION']
    print(f"\n=== Summary ===")
    print(f"SUCCESS: {len(success)} / EMPTY: {len(empty)} / EXCEPTION: {len(excpt)}")
    print(f"Total time: {(time.time() - start)/60:.1f} 分鐘")

    if empty:
        print(f"\n=== EMPTY ({len(empty)} 隻) ===")
        for r in empty:
            print(f"  {r['code']}")
    if excpt:
        print(f"\n=== EXCEPTION ({len(excpt)} 隻) ===")
        for r in excpt:
            print(f"  {r['code']:12s} {r.get('err', '')[:80]}")

    ctx.close()
    return results

results = asyncio.run(main())

# 確認 hot stocks 入 K 線 cache 狀態
import sqlite3
conn = sqlite3.connect('backend/stockpulse.db')
cur = conn.cursor()
hot = ['HK.00001','HK.00002','HK.00003','HK.00004','HK.00005','HK.00006','HK.00011','HK.00012','HK.00016','HK.00017',
    'HK.00019','HK.00027','HK.00066','HK.00081','HK.00101','HK.00151','HK.00175','HK.00241','HK.00267','HK.00285',
    'HK.00288','HK.00293','HK.00303','HK.00308','HK.00316','HK.00321','HK.00384','HK.00386','HK.00388','HK.00669',
    'HK.00688','HK.00700','HK.00762','HK.00763','HK.00823','HK.00857','HK.00883','HK.00884','HK.00902','HK.00909',
    'HK.00921','HK.00939','HK.00941','HK.00992','HK.01024','HK.01038','HK.01044','HK.01088','HK.01093','HK.01109',
    'HK.01113','HK.01128','HK.01209','HK.01211','HK.01299','HK.01313','HK.01357','HK.01378','HK.01385','HK.01398',
    'HK.01691','HK.01772','HK.01797','HK.01810','HK.01821','HK.01928','HK.01997','HK.02007','HK.02015','HK.02020',
    'HK.02269','HK.02282','HK.02313','HK.02318','HK.02319','HK.02331','HK.02382','HK.02388','HK.02513','HK.02611',
    'HK.02628','HK.02688','HK.02689','HK.02727','HK.02899','HK.03328','HK.03690','HK.03800','HK.03888','HK.03898',
    'HK.03900','HK.03908','HK.03968','HK.03988','HK.06030','HK.06160','HK.06618','HK.06690','HK.06862','HK.06969',
    'HK.09618','HK.09633','HK.09888','HK.09961','HK.09987','HK.09988','HK.09992']
hot = list(dict.fromkeys(hot))
ph = ','.join(['?']*len(hot))
cur.execute(f'SELECT COUNT(DISTINCT code) FROM kline_cache WHERE code IN ({ph}) AND period="1d"', hot)
in_cache = cur.fetchone()[0]
print(f"\n=== 最終 Hot stocks 入 K 線 cache: {in_cache} / {len(hot)} ===")

# Save evidence
import json
out = os.path.join(os.path.dirname(__file__), 'tmp_refresh_55_results.json')
with open(out, 'w', encoding='utf-8') as f:
    json.dump({
        'total': len(results),
        'summary': {
            'SUCCESS': len(success), 'EMPTY': len(empty), 'EXCEPTION': len(excpt),
            'hot_in_cache': in_cache
        },
        'details': results
    }, f, ensure_ascii=False, indent=2)
print(f"Evidence: {out}")

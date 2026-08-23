"""
更新 K 線 cache 178 隻 stock (slow + retry 避限頻)
- 用 KlineCache.get_or_fetch() 配 nest_asyncio 真 async I/O
- 5 年 K 線 (1260 條) 寫入 cache
- Sleep 1.2s 避限頻 (OpenD 30s/60)
- KlineCache 內部已經有 retry 3 次 + sleep 1s
"""
import sys
import os
import asyncio
import time

# 加 backend path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import nest_asyncio
nest_asyncio.apply()

from futu import OpenQuoteContext
from services.kline_cache import KlineCache

# 拎 178 隻 stock (from kline_cache table, distinct code, period=1d)
import sqlite3
conn = sqlite3.connect('backend/stockpulse.db')
cur = conn.cursor()
cur.execute("SELECT DISTINCT code FROM kline_cache WHERE period='1d' ORDER BY code")
stocks_178 = [r[0] for r in cur.fetchall()]
conn.close()
print(f"K 線 cache 入面有 {len(stocks_178)} 隻 stock 1d period")

# 大少 hot stocks list (優先 refresh 呢啲先)
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
hot_set = set(hot)

# 排序: hot stocks 先, 其他跟 178 隻順序
sorted_stocks = []
for c in stocks_178:
    if c in hot_set:
        sorted_stocks.insert(0, c)  # 加到 list 頭
# 拎返 hot stocks 之後, 其他 (順序)
remaining = [c for c in stocks_178 if c not in hot_set]
# Hot stocks 都入咗 list 頭, 之後加返 remaining
final_stocks = []
seen = set()
for c in stocks_178:
    if c in hot_set and c not in seen:
        final_stocks.append(c)
        seen.add(c)
for c in stocks_178:
    if c not in seen:
        final_stocks.append(c)
        seen.add(c)

print(f"Sorted: {len(final_stocks)} 隻 (hot stocks 優先)")
print(f"預計時間: {len(final_stocks) * 1.5 / 60:.1f} 分鐘\n")

ctx = OpenQuoteContext(host='127.0.0.1', port=11111)
cache = KlineCache()

async def refresh_one(code):
    """用 KlineCache 真 async I/O 取 5 年 1d K 線"""
    try:
        # KlineCache 內部已經有 retry + sleep, 我加 outer sleep 1.2s 避限頻
        # 取 5 年 = 1260 條 K 線
        result = await cache.get_or_fetch(
            code=code,
            ctx=ctx,
            ktype='K_DAY',
            period='1d',
            max_count=1260
        )
        if result and result.get('klines'):
            return {
                'code': code,
                'status': 'SUCCESS',
                'klines': len(result['klines']),
                'fetch_count': result.get('fetch_count', 0),
                'cached': result.get('cached', False)
            }
        return {'code': code, 'status': 'EMPTY', 'klines': 0}
    except Exception as e:
        return {'code': code, 'status': 'EXCEPTION', 'klines': 0, 'err': str(e)[:200]}

async def main():
    results = []
    print("開始更新 178 隻 stock K 線 cache (5 年 1d, 1260 條)...")
    print("=" * 80)
    start_time = time.time()
    for i, code in enumerate(final_stocks):
        t0 = time.time()
        r = await refresh_one(code)
        elapsed = time.time() - t0
        total_elapsed = time.time() - start_time
        if r['status'] == 'SUCCESS':
            mark = "🆕" if r.get('fetch_count', 0) > 0 else "♻️"
            print(f"[{i+1:3d}/{len(final_stocks)}] {mark} {code:12s} {r['klines']:5d} 條 (fetch={r.get('fetch_count', 0)}, {elapsed:.1f}s, total {total_elapsed/60:.1f}m)")
        else:
            print(f"[{i+1:3d}/{len(final_stocks)}] ❌ {code:12s} {r['status']:10s} {r.get('err', '')[:60]}")
        sys.stdout.flush()
        results.append(r)
        # Sleep 1.2s 避限頻 (KlineCache 內部 sleep 唔夠, 加 outer)
        await asyncio.sleep(1.2)

    print("=" * 80)
    success = [r for r in results if r['status'] == 'SUCCESS']
    empty = [r for r in results if r['status'] == 'EMPTY']
    excpt = [r for r in results if r['status'] == 'EXCEPTION']
    fresh = [r for r in success if r.get('fetch_count', 0) > 0]
    cached = [r for r in success if r.get('cached', False) and r.get('fetch_count', 0) == 0]

    print(f"\n=== Summary ===")
    print(f"Total: {len(results)} 隻")
    print(f"SUCCESS: {len(success)} ({len(fresh)} fresh fetched, {len(cached)} all cached)")
    print(f"EMPTY: {len(empty)}")
    print(f"EXCEPTION: {len(excpt)}")
    print(f"Total time: {(time.time() - start_time)/60:.1f} 分鐘")

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

# 跑
results = asyncio.run(main())

# Save evidence
import json
out_path = os.path.join(os.path.dirname(__file__), 'tmp_refresh_178_results.json')
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump({
        'total': len(results),
        'summary': {
            'SUCCESS': sum(1 for r in results if r['status'] == 'SUCCESS'),
            'EMPTY': sum(1 for r in results if r['status'] == 'EMPTY'),
            'EXCEPTION': sum(1 for r in results if r['status'] == 'EXCEPTION'),
            'fresh_fetched': sum(1 for r in results if r.get('fetch_count', 0) > 0),
            'all_cached': sum(1 for r in results if r.get('cached', False) and r.get('fetch_count', 0) == 0)
        },
        'details': results
    }, f, ensure_ascii=False, indent=2)
print(f"\nEvidence saved: {out_path}")

"""
Trace 100 hot stocks OpenD raw return error (純 sync, 避 nest_asyncio 問題)
- 逐個 stock single call
- Sleep 1.2s 避限頻
- 記錄 OpenD return code + message
- 區分 NoDataAvailable vs ExceedReqLimit vs SUCCESS vs 其他
"""
import sys
import os
import time
import json

# 加 backend path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from futu import OpenQuoteContext, RET_OK, RET_ERROR

# 100 hot stocks list
stocks_100 = [
    'HK.00001','HK.00002','HK.00003','HK.00004','HK.00005','HK.00006','HK.00012','HK.00016','HK.00017',
    'HK.00019','HK.00027','HK.00066','HK.00081','HK.00101','HK.00151','HK.00175','HK.00241','HK.00267','HK.00285',
    'HK.00288','HK.00293','HK.00303','HK.00308','HK.00316','HK.00321','HK.00384','HK.00386','HK.00388','HK.00669',
    'HK.00688','HK.00700','HK.00762','HK.00763','HK.00823','HK.00857','HK.00883','HK.00884','HK.00902','HK.00909',
    'HK.00921','HK.00939','HK.00941','HK.00992','HK.01024','HK.01038','HK.01044','HK.01088','HK.01093','HK.01109',
    'HK.01113','HK.01128','HK.01209','HK.01211','HK.01299','HK.01313','HK.01357','HK.01378','HK.01385','HK.01398',
    'HK.01691','HK.01772','HK.01797','HK.01810','HK.01928','HK.01997','HK.02007','HK.02015','HK.02020',
    'HK.02269','HK.02282','HK.02313','HK.02318','HK.02319','HK.02331','HK.02382','HK.02388','HK.02513','HK.02611',
    'HK.02628','HK.02688','HK.02689','HK.02727','HK.02899','HK.03328','HK.03690','HK.03800','HK.03888','HK.03898',
    'HK.03900','HK.03908','HK.03968','HK.03988','HK.06030','HK.06160','HK.06618','HK.06690','HK.06862','HK.06969',
    'HK.09618','HK.09633','HK.09888','HK.09961','HK.09987','HK.09988','HK.09992'
]

# Dedupe
stocks_100 = list(dict.fromkeys(stocks_100))
print(f"Total unique stocks: {len(stocks_100)}")
print(f"預計時間: {len(stocks_100) * 1.2 / 60:.1f} 分鐘\n")

ctx = OpenQuoteContext(host='127.0.0.1', port=11111)

results = []

print("開始 trace 100 hot stocks OpenD raw error...")
print("=" * 80)

for i, stock in enumerate(stocks_100):
    code = stock  # OpenD 要 full prefix "HK.00001", 唔可以 strip
    try:
        # OpenD 返 3-tuple: (ret, data, next_page) - 用 generic unpack
        result = ctx.request_history_kline(
            code, ktype='K_DAY', start='2024-08-01', end='2024-08-23', max_count=10
        )
        ret = result[0]
        data = result[1]
        if ret == RET_OK and data is not None and len(data) > 0:
            results.append({"stock": stock, "status": "SUCCESS", "klines": len(data), "ret": ret})
            print(f"[{i+1:3d}/{len(stocks_100)}] ✅ {stock:12s} {len(data)} klines")
        else:
            err_msg = str(data)[:100] if data is not None else "None"
            results.append({"stock": stock, "status": "EMPTY", "klines": 0, "ret": ret, "err": err_msg})
            print(f"[{i+1:3d}/{len(stocks_100)}] ❌ {stock:12s} EMPTY ret={ret} {err_msg[:60]}")
    except Exception as e:
        err_str = str(e)[:200]
        results.append({"stock": stock, "status": "EXCEPTION", "klines": 0, "err": err_str})
        print(f"[{i+1:3d}/{len(stocks_100)}] ⚠️  {stock:12s} EXC  {err_str[:60]}")
    sys.stdout.flush()
    time.sleep(1.2)  # 避限頻 (30s/60 = 2/s, sleep 1.2s 安全)

print("=" * 80)

# Summary
success = [r for r in results if r["status"] == "SUCCESS"]
empty = [r for r in results if r["status"] == "EMPTY"]
excpt = [r for r in results if r["status"] == "EXCEPTION"]
print(f"\n=== Summary ===")
print(f"SUCCESS: {len(success)} / EMPTY: {len(empty)} / EXCEPTION: {len(excpt)}")

# 分類 EMPTY 嘅 error
no_data = [r for r in empty if "未知股票" in r.get("err", "") or "NoData" in r.get("err", "")]
exceed = [r for r in empty if "ExceedReqLimit" in r.get("err", "") or "频率" in r.get("err", "")]
other_empty = [r for r in empty if r not in no_data and r not in exceed]

print(f"\n=== EMPTY 錯誤分類 ===")
print(f"未知股票/NoDataAvailable: {len(no_data)} 隻")
print(f"ExceedReqLimit/限頻: {len(exceed)} 隻")
print(f"其他 EMPTY: {len(other_empty)} 隻")

if no_data:
    print(f"\n--- NoDataAvailable ({len(no_data)} 隻) ---")
    for r in no_data:
        print(f"  {r['stock']:12s} {r['err'][:80]}")

if exceed:
    print(f"\n--- ExceedReqLimit ({len(exceed)} 隻) ---")
    for r in exceed:
        print(f"  {r['stock']:12s} {r['err'][:80]}")

if other_empty:
    print(f"\n--- Other EMPTY ({len(other_empty)} 隻) ---")
    for r in other_empty:
        print(f"  {r['stock']:12s} ret={r['ret']} {r['err'][:80]}")

if excpt:
    print(f"\n=== EXCEPTION ({len(excpt)} 隻) ===")
    for r in excpt:
        print(f"  {r['stock']:12s} {r['err'][:120]}")

# Save evidence
out_path = os.path.join(os.path.dirname(__file__), 'tmp_opend_trace_results.json')
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump({
        "total": len(stocks_100),
        "summary": {
            "SUCCESS": len(success),
            "EMPTY": len(empty),
            "EXCEPTION": len(excpt),
            "NoDataAvailable": len(no_data),
            "ExceedReqLimit": len(exceed),
            "Other_EMPTY": len(other_empty)
        },
        "details": results
    }, f, ensure_ascii=False, indent=2)
print(f"\nEvidence saved: {out_path}")

ctx.close()

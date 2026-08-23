"""
tmp_research_top_bottom_reversal_100stocks.py — 100 隻港股 top/bottom reversal 批量測試 (大少 2026-08-23)

凡人話: 跟 KlineCache full flow 永久 rule, 用 HTTP call backend /api/algorithms/run 拎 verdict
跑 100 隻港股, 統計 top/bottom 評分分佈, 對比 M1 v2.1.0 trigger

對應: 大少 2026-08-23 trigger「100 隻都是真實數據, 要跟返讀取DB的機制」
對應: 大少 2026-08-22 23:20 永久 rule「K-line 讀取一定要用 KlineCache full flow」
"""

import sys
import json
import time
import urllib.request
import urllib.parse
import urllib.error
from collections import Counter

BACKEND_URL = "http://127.0.0.1:18792"
ALGO = "top_bottom_reversal"
DATA_WINDOW_DAYS = 1260  # 5 年 K 線
OUTPUT_FILE = "/tmp/top-bottom-reversal-100-stocks-results.json"


def fetch_stocks(limit=200):
    """凡人話: 拎港股 list, 揀前 N 隻做測試"""
    url = f"{BACKEND_URL}/api/stocks/?market=HK&limit={limit}"
    with urllib.request.urlopen(url, timeout=10) as resp:
        return json.loads(resp.read().decode('utf-8'))


def run_algo(symbol: str, period: str = "1d", data_window_days: int = DATA_WINDOW_DAYS):
    """凡人話: 跑 top_bottom_reversal algorithm, 返 verdict

    KlineCache full flow: runner 入面自動用 KlineCache.get_klines() 拎 K 線
    """
    params = urllib.parse.urlencode({
        "algo": ALGO,
        "symbol": symbol,
        "period": period,
        "data_window_days": data_window_days,
    })
    url = f"{BACKEND_URL}/api/algorithms/run?{params}"
    try:
        with urllib.request.urlopen(url, timeout=60) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": f"HTTP {e.code}: {e.read().decode('utf-8')[:200]}"}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)[:200]}"}


def main():
    print(f"=== 100 隻港股 top_bottom_reversal 測試 ===")
    print(f"Backend: {BACKEND_URL}")
    print(f"Algorithm: {ALGO}")
    print(f"Data window: {DATA_WINDOW_DAYS} 日 (5 年)")
    print(f"Output: {OUTPUT_FILE}")
    print()

    # 1. 拎 stock list
    print("📋 拎港股 list...")
    stocks = fetch_stocks(limit=200)
    print(f"   拎到 {len(stocks)} 隻港股")
    # 揀前 100 隻 (或者全部, 如果少過 100)
    test_stocks = stocks[:100] if len(stocks) >= 100 else stocks
    print(f"   揀 {len(test_stocks)} 隻做測試")
    print()

    # 2. 跑每隻 stock (用 ThreadPoolExecutor 平行跑, 加快 cold cache fetch)
    from concurrent.futures import ThreadPoolExecutor, as_completed

    def run_one(stock):
        """凡人話: 跑 1 隻 stock, 拎 verdict"""
        code = stock['code']
        name = stock['name']
        verdict = run_algo(code)
        return stock, verdict

    results = []
    errors = []
    top_strength_counter = Counter()
    bottom_strength_counter = Counter()
    trigger_top_count = 0
    trigger_bottom_count = 0

    start_time = time.time()
    completed = 0

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(run_one, s): s for s in test_stocks}
        for future in as_completed(futures):
            stock, verdict = future.result()
            completed += 1
            code = stock['code']
            name = stock['name']
            elapsed = time.time() - start_time
            avg = elapsed / completed if completed > 0 else 0
            eta = avg * (len(test_stocks) - completed)

            if not verdict.get("ok"):
                print(f"[{completed:3d}/{len(test_stocks)}] ❌ {code} {name} 失敗 (avg {avg:.1f}s, ETA {eta:.0f}s)", flush=True)
                errors.append({"code": code, "name": name, "error": verdict.get("error", "")})
                continue

            meta = verdict.get("meta", {})
            top_score = meta.get("topScore", 0)
            top_strength = meta.get("topStrength", "NONE")
            bottom_score = meta.get("bottomScore", 0)
            bottom_strength = meta.get("bottomStrength", "NONE")
            top_signals = meta.get("topSignals", [])
            bottom_signals = meta.get("bottomSignals", [])

            top_strength_counter[top_strength] += 1
            bottom_strength_counter[bottom_strength] += 1
            if top_score >= 5:
                trigger_top_count += 1
            if bottom_score >= 5:
                trigger_bottom_count += 1

            results.append({
                "code": code,
                "name": name,
                "topScore": top_score,
                "topStrength": top_strength,
                "topSignals": top_signals,
                "bottomScore": bottom_score,
                "bottomStrength": bottom_strength,
                "bottomSignals": bottom_signals,
                "klinesCount": meta.get("klines_count", 0),
                "peaksCount": meta.get("peaks_count", 0),
                "troughsCount": meta.get("troughs_count", 0),
                "ma20DeviationPct": meta.get("ma20_deviation_pct", 0),
                "rsiCurrent": meta.get("indicators", {}).get("rsi_current"),
                "kdjJCurrent": meta.get("indicators", {}).get("kdj_j_current"),
            })
            print(
                f"[{completed:3d}/{len(test_stocks)}] {code} {name} 頂={top_score}({top_strength[:1]}) 底={bottom_score}({bottom_strength[:1]}) (avg {avg:.1f}s, ETA {eta:.0f}s)",
                flush=True,
            )

    # 3. 統計分佈
    total_time = time.time() - start_time
    print()
    print(f"=== 完成! 總時間 {total_time:.0f}s ===")
    print()
    print(f"測試總數: {len(results)} (成功) / {len(test_stocks)} (嘗試)")
    print(f"失敗: {len(errors)} 隻")
    print()
    print(f"--- 到頂評分分佈 ---")
    print(f"  強烈 (STRONG ≥8):     {top_strength_counter.get('STRONG', 0)} 隻")
    print(f"  中度 (MODERATE 5-7):  {top_strength_counter.get('MODERATE', 0)} 隻")
    print(f"  輕度 (MILD 3-4):      {top_strength_counter.get('MILD', 0)} 隻")
    print(f"  暫無 (NONE 0-2):      {top_strength_counter.get('NONE', 0)} 隻")
    print(f"  觸發率 (≥5):          {trigger_top_count}/{len(results)} = {trigger_top_count/len(results)*100:.1f}%")
    print()
    print(f"--- 到底評分分佈 ---")
    print(f"  強烈 (STRONG ≥8):     {bottom_strength_counter.get('STRONG', 0)} 隻")
    print(f"  中度 (MODERATE 5-7):  {bottom_strength_counter.get('MODERATE', 0)} 隻")
    print(f"  輕度 (MILD 3-4):      {bottom_strength_counter.get('MILD', 0)} 隻")
    print(f"  暫無 (NONE 0-2):      {bottom_strength_counter.get('NONE', 0)} 隻")
    print(f"  觸發率 (≥5):          {trigger_bottom_count}/{len(results)} = {trigger_bottom_count/len(results)*100:.1f}%")
    print()

    # 4. Top 10 強烈見頂
    top_stocks = [r for r in results if r['topScore'] >= 5]
    top_stocks.sort(key=lambda r: -r['topScore'])
    if top_stocks:
        print(f"--- 觸發見頂 (score ≥ 5) Top 10 ---")
        for r in top_stocks[:10]:
            print(f"  {r['code']} {r['name']}: {r['topScore']}/15 {r['topStrength']}")
            for s in r['topSignals'][:2]:
                print(f"     {s[:80]}")
        print()

    # 5. Top 10 強烈見底
    bottom_stocks = [r for r in results if r['bottomScore'] >= 5]
    bottom_stocks.sort(key=lambda r: -r['bottomScore'])
    if bottom_stocks:
        print(f"--- 觸發見底 (score ≥ 5) Top 10 ---")
        for r in bottom_stocks[:10]:
            print(f"  {r['code']} {r['name']}: {r['bottomScore']}/15 {r['bottomStrength']}")
            for s in r['bottomSignals'][:2]:
                print(f"     {s[:80]}")
        print()

    # 6. 對比 M1 v2.1.0 trigger
    #    M1 v2.1.0 「到頂轉勢」: 連跌 4 日 (大少 100 隻 test 結果: 1 隻觸發 騰訊 2%)
    #    M1 v2.1.0 「到底轉勢」: 0 隻觸發
    print(f"=== 對比 M1 v2.1.0 trigger ===")
    print(f"M1 v2.1.0 到頂轉勢 (連跌 4 日): 1/100 隻觸發 (騰訊 2%)")
    print(f"M1 v2.1.0 到底轉勢 (連升 4 日): 0/100 隻觸發")
    print(f"新框架到頂 (score ≥5): {trigger_top_count}/{len(results)} 隻 ({trigger_top_count/len(results)*100:.1f}%)")
    print(f"新框架到底 (score ≥5): {trigger_bottom_count}/{len(results)} 隻 ({trigger_bottom_count/len(results)*100:.1f}%)")
    print()

    # 7. 寫結果去 file
    output = {
        "algorithm": ALGO,
        "version": "1.0.0",
        "data_window_days": DATA_WINDOW_DAYS,
        "test_count": len(results),
        "error_count": len(errors),
        "total_time_seconds": total_time,
        "top_distribution": dict(top_strength_counter),
        "bottom_distribution": dict(bottom_strength_counter),
        "top_trigger_count": trigger_top_count,
        "bottom_trigger_count": trigger_bottom_count,
        "results": results,
        "errors": errors,
    }
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"結果已存: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()

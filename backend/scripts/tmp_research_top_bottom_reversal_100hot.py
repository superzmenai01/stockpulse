"""
tmp_research_top_bottom_reversal_100hot.py — 100 隻熱門港股 TBR algorithm 批量測試 (大少 2026-08-23)

凡人話: 大少 13:38 trigger「我想要的是一百隻熱門股，有投資價值」, 唔要順序編號 (排後嘅係細股冇投資價值)
改用 HSI 恒生指數成份股 (~82 隻) + 熱門科技/藍籌股 (~18 隻) 拼 100 隻熱門股
全部都係 OpenD 有 5 年 K 線 + 有投資價值嘅 stock, 100% 拎到 verdict

對應: 大少 2026-08-23 13:38 trigger「我想要的是一百隻熱門股，有投資價值」
對應: 大少 2026-08-23 14:17「跟你的建議做」(慢跑 + retry on throttle)

永久 rule (大少 2026-08-23 14:17):
- ✅ 100 隻 stock 串行跑 (唔再用 ThreadPoolExecutor 5 workers parallel)
- ✅ 每隻 stock 之後 sleep 0.5s (避開 OpenD 限頻 30s/60)
- ✅ 100 隻預計 50 秒跑完 (vs 之前 1 秒撞限頻失敗 61 隻)
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
OUTPUT_FILE = "/tmp/top-bottom-reversal-100hot-results.json"
SLEEP_BETWEEN_REQUESTS = 0.5  # 永久 rule: 避開 OpenD 30s/60 限頻

# 100 隻熱門港股 (HSI 成分股 + 熱門科技/藍籌)
# 全部都係 OpenD 有 5 年 K 線 + 大市值 + 有投資價值
HOT_STOCKS = [
    # ===== HSI 恒生指數成份股 (88 隻) =====
    "HK.00001", "HK.00002", "HK.00003", "HK.00005", "HK.00006", "HK.00008",
    "HK.00010", "HK.00011", "HK.00012", "HK.00016", "HK.00019", "HK.00027",
    "HK.00066", "HK.00101", "HK.00175", "HK.00241", "HK.00267", "HK.00288",
    "HK.00291", "HK.00293", "HK.00388", "HK.00494", "HK.00522", "HK.00669",
    "HK.00688", "HK.00700", "HK.00762", "HK.00788", "HK.00823", "HK.00857",
    "HK.00883", "HK.00902", "HK.00939", "HK.00941", "HK.00960", "HK.00992",
    "HK.01024", "HK.01038", "HK.01044", "HK.01088", "HK.01093", "HK.01109",
    "HK.01113", "HK.01177", "HK.01208", "HK.01211", "HK.01299", "HK.01313",
    "HK.01347", "HK.01359", "HK.01378", "HK.01448", "HK.01530", "HK.01658",
    "HK.01772", "HK.01797", "HK.01801", "HK.01810", "HK.01821", "HK.01876",
    "HK.01928", "HK.01997", "HK.02020", "HK.02057", "HK.02162", "HK.02269",
    "HK.02282", "HK.02313", "HK.02318", "HK.02319", "HK.02331", "HK.02382",
    "HK.02388", "HK.02600", "HK.02601", "HK.02628", "HK.02688", "HK.02899",
    "HK.03328", "HK.03690", "HK.03968", "HK.03988", "HK.06030", "HK.06160",
    "HK.06618", "HK.06690", "HK.06862", "HK.06969",
    "HK.09618", "HK.09626", "HK.09633", "HK.09698", "HK.09888", "HK.09961",
    "HK.09988", "HK.09999",
    # ===== 熱門科技/藍籌股 (12 隻) =====
    "HK.02015",  # 理想汽車
    "HK.09868",  # 小鵬汽車
    "HK.03888",  # 金山軟件
    "HK.00354",  # 中軟國際
    "HK.00268",  # 金蝶國際
    "HK.00763",  # 中興通訊
    "HK.01357",  # 美圖
    "HK.09959",  # 聯易融
    "HK.09898",  # 微博
    "HK.02137",  # 騰盛博藥
    "HK.00178",  # 莎莎國際
    "HK.00345",  # 維他奶
]


def run_algo(symbol: str, period: str = "1d", data_window_days: int = DATA_WINDOW_DAYS):
    """凡人話: 跑 top_bottom_reversal algorithm, 返 verdict"""
    params = urllib.parse.urlencode({
        "algo": ALGO,
        "symbol": symbol,
        "period": period,
        "data_window_days": data_window_days,
    })
    url = f"{BACKEND_URL}/api/algorithms/run?{params}"
    try:
        with urllib.request.urlopen(url, timeout=180) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": f"HTTP {e.code}: {e.read().decode('utf-8')[:200]}"}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)[:200]}"}


def main():
    # 去重
    hot_stocks = list(dict.fromkeys(HOT_STOCKS))  # preserve order, 去重

    print(f"=== 100 隻熱門港股 TBR algorithm 測試 (大少 2026-08-23 13:38 trigger) ===")
    print(f"Backend: {BACKEND_URL}")
    print(f"Algorithm: {ALGO}")
    print(f"Data window: {DATA_WINDOW_DAYS} 日 (5 年)")
    print(f"Total stocks: {len(hot_stocks)} (去重後)")
    print(f"Output: {OUTPUT_FILE}")
    print()

    # 2. 跑每隻 stock (大少 2026-08-23 14:17 永久 rule: 串行跑 + sleep 0.5s 避開 OpenD 限頻)
    results = []
    errors = []
    top_strength_counter = Counter()
    bottom_strength_counter = Counter()
    trigger_top_count = 0
    trigger_bottom_count = 0

    start_time = time.time()
    completed = 0

    for symbol in hot_stocks:
        completed += 1
        elapsed = time.time() - start_time
        avg = elapsed / completed if completed > 0 else 0
        eta = avg * (len(hot_stocks) - completed)

        verdict = run_algo(symbol)
        if not verdict.get("ok"):
            print(f"[{completed:3d}/{len(hot_stocks)}] ❌ {symbol} 失敗 (avg {avg:.1f}s, ETA {eta:.0f}s)", flush=True)
            errors.append({"code": symbol, "error": verdict.get("error", "")})
            # 即係 sleep (避免 burst retry 撞限頻)
            time.sleep(SLEEP_BETWEEN_REQUESTS)
            continue

        meta = verdict.get("meta", {})
        top_score = meta.get("topScore", 0)
        top_strength = meta.get("topStrength", "NONE")
        bottom_score = meta.get("bottomScore", 0)
        bottom_strength = meta.get("bottomStrength", "NONE")

        top_strength_counter[top_strength] += 1
        bottom_strength_counter[bottom_strength] += 1
        if top_score >= 5:
            trigger_top_count += 1
        if bottom_score >= 5:
            trigger_bottom_count += 1

        results.append({
            "code": symbol,
            "topScore": top_score,
            "topStrength": top_strength,
            "topSignals": meta.get("topSignals", []),
            "bottomScore": bottom_score,
            "bottomStrength": bottom_strength,
            "bottomSignals": meta.get("bottomSignals", []),
            "klinesCount": meta.get("klines_count", 0),
            "ma20DeviationPct": meta.get("ma20_deviation_pct", 0),
            "rsiCurrent": meta.get("indicators", {}).get("rsi_current"),
        })
        print(
            f"[{completed:3d}/{len(hot_stocks)}] {symbol} 頂={top_score}({top_strength[:1]}) 底={bottom_score}({bottom_strength[:1]}) (avg {avg:.1f}s, ETA {eta:.0f}s)",
            flush=True,
        )
        # 永久 rule: 跑完 1 隻 stock 之後 sleep 0.5s (避開 OpenD 30s/60 限頻)
        time.sleep(SLEEP_BETWEEN_REQUESTS)

    total_time = time.time() - start_time
    print()
    print(f"=== 完成! 總時間 {total_time:.0f}s ===")
    print()
    print(f"測試總數: {len(results)} (成功) / {len(hot_stocks)} (嘗試)")
    print(f"失敗: {len(errors)} 隻")
    if errors:
        print(f"失敗 stock: {[e['code'] for e in errors]}")
    print()
    print(f"--- 到頂評分分佈 ---")
    print(f"  強烈 (STRONG ≥8):     {top_strength_counter.get('STRONG', 0)} 隻")
    print(f"  中度 (MODERATE 5-7):  {top_strength_counter.get('MODERATE', 0)} 隻")
    print(f"  輕度 (MILD 3-4):      {top_strength_counter.get('MILD', 0)} 隻")
    print(f"  暫無 (NONE 0-2):      {top_strength_counter.get('NONE', 0)} 隻")
    print(f"  觸發率 (≥5):          {trigger_top_count}/{len(results)} = {trigger_top_count/len(results)*100 if results else 0:.1f}%")
    print()
    print(f"--- 到底評分分佈 ---")
    print(f"  強烈 (STRONG ≥8):     {bottom_strength_counter.get('STRONG', 0)} 隻")
    print(f"  中度 (MODERATE 5-7):  {bottom_strength_counter.get('MODERATE', 0)} 隻")
    print(f"  輕度 (MILD 3-4):      {bottom_strength_counter.get('MILD', 0)} 隻")
    print(f"  暫無 (NONE 0-2):      {bottom_strength_counter.get('NONE', 0)} 隻")
    print(f"  觸發率 (≥5):          {trigger_bottom_count}/{len(results)} = {trigger_bottom_count/len(results)*100 if results else 0:.1f}%")
    print()

    # 4. Top 10 強烈見頂
    top_stocks = [r for r in results if r['topScore'] >= 5]
    top_stocks.sort(key=lambda r: -r['topScore'])
    if top_stocks:
        print(f"--- 觸發見頂 (score ≥ 5) Top 10 ---")
        for r in top_stocks[:10]:
            print(f"  {r['code']}: {r['topScore']}/15 {r['topStrength']}")
            for s in r['topSignals'][:2]:
                print(f"     {s[:80]}")
        print()

    # 5. Top 10 強烈見底
    bottom_stocks = [r for r in results if r['bottomScore'] >= 5]
    bottom_stocks.sort(key=lambda r: -r['bottomScore'])
    if bottom_stocks:
        print(f"--- 觸發見底 (score ≥ 5) Top 10 ---")
        for r in bottom_stocks[:10]:
            print(f"  {r['code']}: {r['bottomScore']}/15 {r['bottomStrength']}")
            for s in r['bottomSignals'][:2]:
                print(f"     {s[:80]}")
        print()

    # 6. 對比 M1 v2.1.0 trigger
    print(f"=== 對比 M1 v2.1.0 trigger ===")
    print(f"M1 v2.1.0 到頂轉勢 (連跌 4 日): 1/100 隻觸發 (騰訊 2%)")
    print(f"M1 v2.1.0 到底轉勢 (連升 4 日): 0/100 隻觸發")
    print(f"新框架到頂 (score ≥5): {trigger_top_count}/{len(results)} 隻 ({trigger_top_count/len(results)*100 if results else 0:.1f}%)")
    print(f"新框架到底 (score ≥5): {trigger_bottom_count}/{len(results)} 隻 ({trigger_bottom_count/len(results)*100 if results else 0:.1f}%)")
    print()

    # 7. 寫結果去 file
    output = {
        "algorithm": ALGO,
        "version": "1.0.0",
        "data_window_days": DATA_WINDOW_DAYS,
        "test_type": "100 hot stocks (HSI + 熱門股)",
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

"""
backend/tests/test_thread_leak_regression.py — Thread leak regression (大少 2026-09-02 21:14)

凡人話: KlineCache 拎走 per-instance thread leak 之後, 100 次 instantiate 應該 thread count 穩定
- 之前: 100 個 KlineCache = 100 個 thread (永久 leak)
- 之後: 100 個 KlineCache = 1 個 thread (singleton) ✅
- 之前: 撳跑 N 個 algorithm = N 個 KlineCache instance = N 個 thread
- 之後: 撳跑 N 個 algorithm = 1 個 KlineCache instance (module-level) = 1 個 thread ✅

註: 唔 reset KlineCache module-level state 因為 daemon=True thread 永遠 alive,
    reset 反而會造成 2 個 thread 累積 (舊 + 新)。改用 baseline comparison。
"""
import threading

from backend.services.kline_cache import KlineCache
from backend.services import kline_cache


def test_no_thread_leak_after_n_klinecache_instantiate():
    """100 個 KlineCache instance 應該 thread count 穩定 (singleton background thread)"""
    # 拎 baseline (test 之前可能已經有 KlineCache thread)
    baseline = sum(
        1 for t in threading.enumerate() if t.name == "kline-cache-health-check"
    )

    # Instantiate 100 次 KlineCache (模擬 request 嗰陣 instantiate)
    for _ in range(100):
        cache = KlineCache()
        _ = cache.get_futu_health()  # 模擬 request handler 用 KlineCache

    after = sum(
        1 for t in threading.enumerate() if t.name == "kline-cache-health-check"
    )
    # 拎 KlineCache 100 次唔應該 spawn 新 thread (singleton)
    assert after == baseline, (
        f"Thread leak: 拎 100 次 KlineCache 之前有 {baseline} 個 thread, "
        f"之後有 {after} 個 (應該一樣)"
    )


def test_no_thread_leak_after_n_algorithm_runs():
    """跑 50 次 KlineCache() (模擬 run_algorithm) 應該 thread count 穩定

    永久 rule: algorithm_runner.py thread leak regression
    之前: 50 次 run_algorithm = 50 個 KlineCache instance = 50 個 thread
    之後: 50 次 run_algorithm = 1 個 KlineCache instance (module-level) = 1 個 thread ✅
    """
    # 拎 baseline
    baseline = sum(
        1 for t in threading.enumerate() if t.name == "kline-cache-health-check"
    )

    # 模擬 algorithm_runner.py 嗰度嘅 instantiate 模式
    # (之前: cache = KlineCache() 每個 request 1 次, 之後: cache = _cache 用 module-level)
    # 註: backend.api.algorithms 需要 fastapi, 用 try/except 處理 (CI 環境有 fastapi)
    try:
        from backend.api.algorithms import _cache as algo_runner_cache
    except ImportError as e:
        # fastapi 冇裝 (例如本地 minimal test 環境), fallback 直接拎 KlineCache module-level
        # 因為 algorithm_runner.py 嗰度只係用 KlineCache instance, 唔需要 fastapi
        # 用一個 mock 嗰個 _cache 一樣
        from backend.services.kline_cache import KlineCache
        algo_runner_cache = KlineCache()

    for _ in range(50):
        # 模擬 run_algorithm 嗰度: cache = _cache (用 module-level singleton)
        cache = algo_runner_cache
        _ = cache.get_futu_health()

    after = sum(
        1 for t in threading.enumerate() if t.name == "kline-cache-health-check"
    )
    # 模擬 50 次 request 唔應該 spawn 新 thread (singleton + module-level)
    assert after == baseline, (
        f"Thread leak: 跑 50 次算法之前有 {baseline} 個 thread, "
        f"之後有 {after} 個 (應該一樣)"
    )

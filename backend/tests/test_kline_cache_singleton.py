"""
backend/tests/test_kline_cache_singleton.py — KlineCache singleton background thread (大少 2026-09-02 21:14)

凡人話: 100 個 KlineCache instance 應該只 start 1 個 background thread (singleton)
- 永久 rule: KlineCache 拎走 per-instance thread leak (之前 hit macOS kern.maxthread 2048)
- 之前: 100 個 KlineCache = 100 個 thread (hit 2048 limit 2.5 個鐘)
- 之後: 100 個 KlineCache = 1 個 thread ✅
"""
import threading

from backend.services.kline_cache import KlineCache
from backend.services import kline_cache


def test_kline_cache_health_thread_singleton():
    """100 個 KlineCache instance 應該只 start 1 個 background thread (singleton)"""
    # 清 KlineCache module-level state (確保 test 獨立)
    kline_cache._health_check_thread_started = False
    kline_cache._health_check_thread = None

    # Instantiate 100 次
    caches = [KlineCache() for _ in range(100)]

    # Verify 只有 1 個 thread
    assert kline_cache._health_check_thread is not None
    assert kline_cache._health_check_thread_started is True
    # 用 enumerate active threads 確認 kline-cache-health-check 只有 1 個
    threads = [t for t in threading.enumerate() if t.name == "kline-cache-health-check"]
    assert len(threads) == 1, f"Expected 1 thread, got {len(threads)}"

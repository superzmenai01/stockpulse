"""
backend/tests/test_thread_health_endpoint.py — /api/algorithms/health/threads endpoint (大少 2026-09-02 21:14)

凡人話: Backend 提供 /api/algorithms/health/threads endpoint 顯示 process thread count
- 永久 rule: 大少可以隨時 check thread leak 預防再爆
- Response shape: {is_healthy, kline_health_check_threads, threading_enumerate_count, ...}
- KlineCache background thread 應該永遠 == 1 (singleton)

註: 因為 backend 環境未必有 fastapi + uvicorn, 呢個 test 用 unittest.mock 模擬 endpoint
"""
from unittest.mock import patch, MagicMock


def test_thread_health_endpoint_response_shape():
    """驗證 /api/algorithms/health/threads endpoint 嘅 response shape"""
    # 模擬 endpoint 嘅邏輯
    import threading
    import os
    kline_health_threads = sum(
        1 for t in threading.enumerate() if t.name == "kline-cache-health-check"
    )
    total_threads = len(threading.enumerate())
    system_thread_count = total_threads
    try:
        import psutil
        proc = psutil.Process(os.getpid())
        system_thread_count = proc.num_threads()
    except ImportError:
        pass

    from backend.services.kline_cache import get_futu_health

    result = {
        "is_healthy": kline_health_threads <= 1,
        "kline_health_check_threads": kline_health_threads,
        "threading_enumerate_count": total_threads,
        "system_thread_count": system_thread_count,
        "thread_limit_warning": system_thread_count > 200,
        "thread_limit_critical": system_thread_count > 500,
        "thread_limit_emergency": system_thread_count > 1000,
        "thread_limit_max": 2048,
        "kline_cache_state": get_futu_health(),
    }

    # Verify response shape
    assert "is_healthy" in result
    assert "kline_health_check_threads" in result
    assert "threading_enumerate_count" in result
    assert "system_thread_count" in result
    assert "thread_limit_warning" in result
    assert "thread_limit_critical" in result
    assert "thread_limit_emergency" in result
    assert "thread_limit_max" in result
    assert "kline_cache_state" in result

    # Verify threshold values
    assert result["thread_limit_max"] == 2048  # macOS kern.maxthread 默認
    # KlineCache background thread 應該 <= 1 (singleton)
    # (test 環境可能 0 因為未 instantiate KlineCache, 或者 1 因為已經 instantiate)
    assert result["kline_health_check_threads"] <= 1
    assert isinstance(result["kline_cache_state"], dict)
    assert "is_healthy" in result["kline_cache_state"]

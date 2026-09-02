"""
backend/tests/test_kline_cache_health_state.py — KlineCache module-level health state (大少 2026-09-02 21:14)

凡人話: get_futu_health() 永遠返 module-level state, 唔係 per-instance
- 永久 rule: KlineCache 拎走 per-instance _futu_health
- 之前: 100 個 KlineCache = 100 個 _futu_health dict (background thread 只 update 1 個)
- 之後: 100 個 KlineCache 都用同一個 module-level _HEALTH_STATE ✅
"""
from backend.services.kline_cache import KlineCache, get_futu_health
from backend.services import kline_cache


def test_kline_cache_health_state_module_level():
    """get_futu_health() 永遠返 module-level state, 唔係 per-instance"""
    # Reset KlineCache module-level state
    with kline_cache._HEALTH_STATE_LOCK:
        kline_cache._HEALTH_STATE["is_healthy"] = True
        kline_cache._HEALTH_STATE["last_check_at"] = None
        kline_cache._HEALTH_STATE["last_error"] = None
        kline_cache._HEALTH_STATE["consecutive_failures"] = 0

    # 寫入 _HEALTH_STATE 直接 (模擬 background thread)
    with kline_cache._HEALTH_STATE_LOCK:
        kline_cache._HEALTH_STATE["is_healthy"] = False
        kline_cache._HEALTH_STATE["consecutive_failures"] = 5

    # 拎 2 個 KlineCache instance 嘅 state, 應該都係 False (因為 module-level)
    c1 = KlineCache()
    c2 = KlineCache()
    s1 = c1.get_futu_health()  # 仍然 call instance method (backward compat)
    s2 = c2.get_futu_health()
    assert s1["is_healthy"] == False, f"Expected False, got {s1['is_healthy']}"
    assert s2["is_healthy"] == False, f"Expected False, got {s2['is_healthy']}"
    assert s1["consecutive_failures"] == 5
    assert s2["consecutive_failures"] == 5

    # 順便 verify module-level function
    s3 = get_futu_health()
    assert s3["is_healthy"] == False
    assert s3["consecutive_failures"] == 5

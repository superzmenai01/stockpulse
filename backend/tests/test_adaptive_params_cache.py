"""
tests/test_adaptive_params_cache.py — Adaptive Params Cache Tests (大少 16:30 Sprint 2 sub-task 2.6)

Tests:
- save_params() 寫 JSON file
- load_params() 讀返
- is_cache_valid() 7 日 expiry
- delete_params() 刪 file
- list_cached_symbols() 列出全部
- path traversal 防護 (sanitize symbol)

Run: pytest backend/tests/test_adaptive_params_cache.py -v
"""
import json
import os
import time
import pytest
from pathlib import Path
from unittest.mock import patch

from services.adaptive_params_cache import (
    CACHE_ROOT,
    CACHE_EXPIRY_SECONDS,
    is_cache_valid,
    load_params,
    save_params,
    delete_params,
    list_cached_symbols,
    clear_all,
    _cache_path,
)


# ============================================================================
# Fixtures
# ============================================================================

@pytest.fixture(autouse=True)
def clean_cache():
    """每個 test 前後清 cache"""
    clear_all()
    yield
    clear_all()


@pytest.fixture
def sample_params():
    return {
        "ssiWeights": {"ma": 0.32, "hl": 0.28, "trendline": 0.40},
        "rsiWeight": 0.22,
        "kellyFraction": "quarter",
        "markowitzCorr": {"dailyWeekly": 0.86, "dailyMonthly": 0.58, "weeklyMonthly": 0.71},
        "hurstThresholds": {"persistent": 0.56, "reverting": 0.44},
    }


# ============================================================================
# Tests: save_params
# ============================================================================

class TestSaveParams:
    def test_save_creates_file(self, sample_params):
        result = save_params("HK.00700", sample_params)
        assert result is True
        assert _cache_path("HK.00700").exists()

    def test_save_writes_valid_json(self, sample_params):
        save_params("HK.00700", sample_params)
        with open(_cache_path("HK.00700"), "r", encoding="utf-8") as f:
            data = json.load(f)
        assert data["symbol"] == "HK.00700"
        assert data["params"] == sample_params
        assert "last_calibrated" in data
        assert data["auto"] is True

    def test_save_multiple_symbols(self, sample_params):
        save_params("HK.00700", sample_params)
        save_params("US.AAPL", sample_params)
        assert _cache_path("HK.00700").exists()
        assert _cache_path("US.AAPL").exists()

    def test_save_overwrites_existing(self, sample_params):
        save_params("HK.00700", sample_params)
        new_params = {**sample_params, "rsiWeight": 0.99}
        save_params("HK.00700", new_params)
        loaded = load_params("HK.00700")
        assert loaded["params"]["rsiWeight"] == 0.99

    def test_save_rejects_invalid_params(self):
        with pytest.raises(ValueError):
            save_params("HK.00700", None)
        with pytest.raises(ValueError):
            save_params("HK.00700", "not a dict")

    def test_save_rejects_invalid_symbol(self, sample_params):
        with pytest.raises(ValueError):
            save_params("", sample_params)
        with pytest.raises(ValueError):
            save_params("../etc/passwd", sample_params)  # path traversal
        with pytest.raises(ValueError):
            save_params("HK/00700", sample_params)  # slash


# ============================================================================
# Tests: load_params
# ============================================================================

class TestLoadParams:
    def test_load_existing(self, sample_params):
        save_params("HK.00700", sample_params)
        loaded = load_params("HK.00700")
        assert loaded is not None
        assert loaded["params"] == sample_params

    def test_load_nonexistent(self):
        loaded = load_params("HK.99999")
        assert loaded is None

    def test_load_garbage_file(self, sample_params):
        path = _cache_path("HK.00700")
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            f.write("{ invalid json")
        loaded = load_params("HK.00700")
        assert loaded is None  # returns None on parse error


# ============================================================================
# Tests: is_cache_valid (7 日 expiry)
# ============================================================================

class TestCacheValidity:
    def test_fresh_cache_valid(self, sample_params):
        save_params("HK.00700", sample_params)
        assert is_cache_valid("HK.00700") is True

    def test_nonexistent_invalid(self):
        assert is_cache_valid("HK.99999") is False

    def test_old_cache_invalid(self, sample_params):
        # 模擬 8 日前嘅 cache
        path = _cache_path("HK.00700")
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "symbol": "HK.00700",
            "last_calibrated": time.time() - (CACHE_EXPIRY_SECONDS + 1),
            "params": sample_params,
            "auto": True,
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)
        assert is_cache_valid("HK.00700") is False

    def test_exactly_7_days_valid(self, sample_params):
        # 7 日 expiry boundary (用 6.99 日)
        path = _cache_path("HK.00700")
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "symbol": "HK.00700",
            "last_calibrated": time.time() - (CACHE_EXPIRY_SECONDS - 100),
            "params": sample_params,
            "auto": True,
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)
        assert is_cache_valid("HK.00700") is True


# ============================================================================
# Tests: delete_params
# ============================================================================

class TestDeleteParams:
    def test_delete_existing(self, sample_params):
        save_params("HK.00700", sample_params)
        assert _cache_path("HK.00700").exists()
        result = delete_params("HK.00700")
        assert result is True
        assert not _cache_path("HK.00700").exists()

    def test_delete_nonexistent(self):
        result = delete_params("HK.99999")
        assert result is False


# ============================================================================
# Tests: list_cached_symbols
# ============================================================================

class TestListCachedSymbols:
    def test_empty_initially(self):
        assert list_cached_symbols() == []

    def test_list_after_save(self, sample_params):
        save_params("HK.00700", sample_params)
        save_params("US.AAPL", sample_params)
        save_params("HK.09988", sample_params)
        symbols = list_cached_symbols()
        assert set(symbols) == {"HK.00700", "US.AAPL", "HK.09988"}

    def test_list_sorted(self, sample_params):
        save_params("US.AAPL", sample_params)
        save_params("HK.00700", sample_params)
        save_params("HK.09988", sample_params)
        symbols = list_cached_symbols()
        assert symbols == sorted(symbols)


# ============================================================================
# Tests: clear_all
# ============================================================================

class TestClearAll:
    def test_clear(self, sample_params):
        save_params("HK.00700", sample_params)
        save_params("US.AAPL", sample_params)
        count = clear_all()
        assert count == 2
        assert list_cached_symbols() == []


# ============================================================================
# Tests: integration (save → load → expiry cycle)
# ============================================================================

class TestIntegration:
    def test_save_load_delete_cycle(self, sample_params):
        # Save
        assert save_params("HK.00700", sample_params) is True
        # Load
        loaded = load_params("HK.00700")
        assert loaded["params"] == sample_params
        # Valid
        assert is_cache_valid("HK.00700") is True
        # Delete
        assert delete_params("HK.00700") is True
        # Now invalid
        assert is_cache_valid("HK.00700") is False
        assert load_params("HK.00700") is None

    def test_atomic_write_no_partial(self, sample_params):
        """驗證 atomic write (tmp file + rename) 唔會留爛 file"""
        save_params("HK.00700", sample_params)
        # 唔應該有 .json.tmp 殘留
        tmp_path = _cache_path("HK.00700").with_suffix(".json.tmp")
        assert not tmp_path.exists()

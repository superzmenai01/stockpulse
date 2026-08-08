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
    OPTIMAL_EXPIRY_SECONDS,
    is_cache_valid,
    is_optimal_valid,
    load_params,
    save_params,
    delete_params,
    list_cached_symbols,
    clear_all,
    _cache_path,
    # Sprint 3 sub-task 9.4
    load_optimal,
    save_optimal,
    add_forward_return_record,
    get_forward_return_history,
    compute_forward_return_stats,
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


# =============================================================
# Sprint 3 sub-task 9.4 — Optimal params + Forward Return Record tests
# =============================================================
# 大少 2026-08-08 22:28 confirm: optimal (30 日) + forward return (永久) 永久保留
# 對應 spec: docs/research/AS-03-cycle-detection/MODULE-09-BACK-TEST.md §11
# 對應 commit: 9.4

class TestOptimalParams:
    """9.4 optimal params (per-symbol, 30 日 expiry)"""

    def test_save_optimal_writes_to_cache(self, sample_optimal_params):
        """save_optimal 寫入 cache 'optimal' key"""
        result = save_optimal("HK.00700", sample_optimal_params)
        assert result is True
        data = load_optimal("HK.00700")
        assert data is not None
        assert "optimal" in data
        assert data["optimal"]["optimal_params"] == sample_optimal_params
        assert data["optimal"]["auto"] is False  # 標記為 back test result

    def test_load_optimal_returns_30d_valid(self, sample_optimal_params):
        """load_optimal 30 日內 OK"""
        save_optimal("HK.00700", sample_optimal_params)
        data = load_optimal("HK.00700")
        assert data is not None

    def test_load_optimal_expired_after_30d(self, sample_optimal_params):
        """load_optimal 超過 30 日返 None"""
        save_optimal("HK.00700", sample_optimal_params)
        # Mock 31 日後 — patch time.time 直接返 future timestamp
        future = time.time() + 31 * 24 * 60 * 60
        with patch("services.adaptive_params_cache.time.time", return_value=future):
            assert load_optimal("HK.00700") is None

    def test_save_optimal_with_validation_window(self, sample_optimal_params):
        """save_optimal 加 validation + window metadata"""
        validation = {"avgValidateScore": 65.5, "stabilityScore": 0.85, "totalValidateSamples": 87}
        window = {"initialDays": 126, "finalDays": 252, "extendCount": 2}
        result = save_optimal("HK.00700", sample_optimal_params,
                              validation=validation, window=window, folds_count=3)
        assert result is True
        data = load_optimal("HK.00700")
        assert data["optimal"]["validation"] == validation
        assert data["optimal"]["window"] == window
        assert data["optimal"]["folds_count"] == 3

    def test_save_params_preserves_existing_optimal(self, sample_params, sample_optimal_params):
        """save_params 唔好覆蓋 existing optimal (大少 22:28 永久保留)"""
        # 先 save optimal
        save_optimal("HK.00700", sample_optimal_params)
        # 再 save params
        save_params("HK.00700", sample_params)
        # 兩者都要存在
        data = load_params("HK.00700")
        assert data["params"] == sample_params
        assert "optimal" in data
        assert data["optimal"]["optimal_params"] == sample_optimal_params

    def test_save_optimal_invalid_raises(self):
        """save_optimal invalid input 拋 ValueError"""
        with pytest.raises(ValueError):
            save_optimal("HK.00700", None)
        with pytest.raises(ValueError):
            save_optimal("HK.00700", "not a dict")


class TestForwardReturnRecord:
    """9.4 forward return record (永久保留, 唔 expiry)"""

    def test_add_record_appends_to_history(self):
        """add_forward_return_record 加一條落 history"""
        record = {"date": "2024-01-15", "action": "BUY", "fwd5": 1.2, "fwd10": 2.8, "fwd20": -0.5, "hit": True}
        result = add_forward_return_record("HK.00700", record)
        assert result is True
        history = get_forward_return_history("HK.00700")
        assert len(history) == 1
        assert history[0]["date"] == "2024-01-15"
        assert history[0]["action"] == "BUY"

    def test_add_multiple_records_cumulative(self):
        """多條 records 永久累積, 唔 delete"""
        for i in range(5):
            record = {"date": f"2024-0{i+1}-15", "action": "BUY", "fwd5": float(i), "hit": i > 2}
            add_forward_return_record("HK.00700", record)
        history = get_forward_return_history("HK.00700")
        assert len(history) == 5

    def test_get_history_sorted_desc(self):
        """get_forward_return_history 拎 records 排序 (最新先)"""
        # Add out-of-order
        add_forward_return_record("HK.00700", {"date": "2024-01-15", "action": "BUY"})
        add_forward_return_record("HK.00700", {"date": "2024-03-15", "action": "SELL"})
        add_forward_return_record("HK.00700", {"date": "2024-02-15", "action": "HOLD"})
        history = get_forward_return_history("HK.00700")
        # Sort by date desc
        assert history[0]["date"] == "2024-03-15"
        assert history[1]["date"] == "2024-02-15"
        assert history[2]["date"] == "2024-01-15"

    def test_get_history_with_limit(self):
        """get_forward_return_history 拎 limit 參數 (最新 N 條)"""
        for i in range(10):
            add_forward_return_record("HK.00700", {"date": f"2024-{i+1:02d}-01", "action": "BUY"})
        history = get_forward_return_history("HK.00700", limit=3)
        assert len(history) == 3

    def test_get_history_empty_symbol(self):
        """get_forward_return_history 冇 history 返 []"""
        history = get_forward_return_history("US.AAPL")
        assert history == []

    def test_add_record_validates_required_fields(self):
        """add_forward_return_record 必須有 date + action"""
        with pytest.raises(ValueError):
            add_forward_return_record("HK.00700", {"action": "BUY"})  # 冇 date
        with pytest.raises(ValueError):
            add_forward_return_record("HK.00700", {"date": "2024-01-15"})  # 冇 action

    def test_compute_forward_return_stats_weighted_recent(self):
        """compute_forward_return_stats 用半衰期 weighting (6 月 = 180 日, 大少 22:28)"""
        # Add 3 records: 1 hit 舊 (1 年前), 1 miss 新 (今日), 1 hit 新 (昨日)
        today = time.strftime("%Y-%m-%d")
        from datetime import datetime, timedelta
        old_date = (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d")
        yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

        add_forward_return_record("HK.00700", {
            "date": old_date, "action": "BUY", "fwd5": 5.0, "hit": True
        })
        add_forward_return_record("HK.00700", {
            "date": today, "action": "BUY", "fwd5": -2.0, "hit": False
        })
        add_forward_return_record("HK.00700", {
            "date": yesterday, "action": "BUY", "fwd5": 3.0, "hit": True
        })

        stats = compute_forward_return_stats("HK.00700", half_life_days=180)
        assert stats is not None
        assert stats["sample_count"] == 3
        # 舊 record (1 年前) 權重 = 0.5^(365/180) = 0.5^2.03 = 0.245
        # 新 record (今日) 權重 = 0.5^0 = 1
        # 新 record (昨日) 權重 = 0.5^(1/180) = 0.996
        # weighted_hit_count = 0.245 * 1 + 1.0 * 0 + 0.996 * 1 = 1.241
        # weight_sum = 0.245 + 1.0 + 0.996 = 2.241
        # hit_rate = 1.241 / 2.241 = 55.4%
        # 因為舊 record 權重低, hit rate 接近 50% (新 records 一 hit 一 miss)
        assert stats["hit_rate_5d"] > 50 and stats["hit_rate_5d"] < 70, \
            f"expected ~55%, got {stats['hit_rate_5d']}"

    def test_compute_forward_return_stats_no_data(self):
        """compute_forward_return_stats 冇 data 返 None"""
        stats = compute_forward_return_stats("US.AAPL")
        assert stats is None

    def test_save_params_preserves_existing_history(self, sample_params):
        """save_params 唔好覆蓋 existing forward_return_history (大少 22:28 永久保留)"""
        record = {"date": "2024-01-15", "action": "BUY"}
        add_forward_return_record("HK.00700", record)
        # 再 save params
        save_params("HK.00700", sample_params)
        # history 仍然存在
        history = get_forward_return_history("HK.00700")
        assert len(history) == 1


# =============================================================
# Fixtures for 9.4 tests
# =============================================================

@pytest.fixture
def sample_optimal_params():
    return {
        "kelly": 0.25,
        "rsiWeight": 0.20,
        "ssiWeights": {"ma": 0.4, "hl": 0.3, "tl": 0.3},
    }


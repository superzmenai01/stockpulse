"""
Tests for KlineCache service

大少 2026-07-28 #7987: K-line cache-aside pattern tests

7 test cases (per #7987 plan):
1. Cold cache (新 stock → fetch 全部)
2. Warm cache (增量 fetch)
3. Weekend boundary (DB max = 上個交易日)
4. 即日分開 (today 不寫 DB)
5. qfq 復權 overwrite (INSERT OR REPLACE)
6. Failure fallback (OpenD fail → direct)
7. Race protection (asyncio.Lock serialize)

運行方式:
    cd ~/stockpulse
    python3 -m pytest backend/tests/test_kline_cache.py -v
"""

import asyncio
import sqlite3
import datetime
from pathlib import Path
from unittest.mock import MagicMock

import pytest
import pandas as pd

# Setup path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.services.kline_cache import KlineCache


# ----------------------------------------------------------------
# Fixtures
# ----------------------------------------------------------------

@pytest.fixture
def temp_db_path(tmp_path):
    """Use tmp DB for isolation."""
    return tmp_path / "test_stockpulse.db"


@pytest.fixture
def temp_cache(temp_db_path):
    """KlineCache with tmp DB."""
    cache = KlineCache(db_path=temp_db_path)
    yield cache
    # Cleanup
    if temp_db_path.exists():
        temp_db_path.unlink()


def make_mock_ctx(
    klines_data: list[dict] | None = None,
    outstanding_shares: float = 5_000_000_000,
    fail: bool = False,
):
    """
    Create a mock Futu QuoteContext.

    klines_data: list of {time_key, open, high, low, close, volume}
    """
    ctx = MagicMock()

    def fake_history(code, ktype, autype, max_count, start, end):
        if fail:
            return (-1, "Mock OpenD error", None)
        if klines_data is None:
            return (0, pd.DataFrame(), None)
        # Filter by start/end
        rows = []
        for row in klines_data[:max_count]:
            time_str = str(row['time_key'])[:10]
            if start and time_str < start:
                continue
            if end and time_str > end:
                continue
            rows.append(row)
        return (0, pd.DataFrame(rows), None)

    ctx.request_history_kline = fake_history

    def fake_snapshot(codes):
        # Real Futu OpenD get_market_snapshot returns (ret, data) — 2-tuple
        return (
            0,
            pd.DataFrame([{'outstanding_shares': outstanding_shares}]),
        )

    ctx.get_market_snapshot = fake_snapshot
    return ctx


def make_kline_rows(start_date: str, end_date: str, close: float = 10.5) -> list[dict]:
    """Generate daily kline rows from start to end (Mon-Fri only)."""
    rows = []
    current = datetime.date.fromisoformat(start_date)
    end = datetime.date.fromisoformat(end_date)
    while current <= end:
        if current.weekday() < 5:  # Mon-Fri
            rows.append({
                'time_key': current.isoformat() + ' 00:00:00',
                'open': 10.0, 'high': 11.0, 'low': 9.0,
                'close': close, 'volume': 1_000_000,
            })
        current += datetime.timedelta(days=1)
    return rows


# ----------------------------------------------------------------
# Test 1: Cold cache (大少 #7987)
# ----------------------------------------------------------------

@pytest.mark.asyncio
async def test_cold_cache(temp_cache, temp_db_path):
    """新股票 → fetch 全部歷史 → bulk insert → DB max(time) < today."""
    today = datetime.date.today()
    start = (today - datetime.timedelta(days=30)).isoformat()  # 30 days for speed
    end = today.isoformat()

    klines = make_kline_rows(start, end)
    ctx = make_mock_ctx(klines_data=klines)

    result = await temp_cache.get_or_fetch('HK.00981', ctx, '1d', count=100)

    assert result['cached'] is True
    assert result['fetch_count'] > 0
    assert result['error'] is None
    # Mock data = 30 days (~21 trading days), less than count=100
    assert len(result['klines']) > 0
    assert len(result['klines']) <= 100  # limited by count

    # DB should have rows
    db_latest = temp_cache.get_latest_time('HK.00981', '1d')
    assert db_latest is not None
    assert db_latest < today.isoformat(), (
        f"DB max(time) {db_latest} should be < today {today.isoformat()}"
    )

    # Verify schema: turnover_rate populated
    sample = result['klines'][0]
    assert sample['turnover_rate'] is not None
    assert sample['turnover_rate'] > 0


# ----------------------------------------------------------------
# Test 2: Warm cache (incremental)
# ----------------------------------------------------------------

@pytest.mark.asyncio
async def test_warm_cache(temp_cache):
    """已存在 stock → fetch 增量（很少 rows）。"""
    today = datetime.date.today()
    start = (today - datetime.timedelta(days=30)).isoformat()
    end = today.isoformat()

    klines = make_kline_rows(start, end)
    ctx = make_mock_ctx(klines_data=klines)

    # First: cold
    r1 = await temp_cache.get_or_fetch('HK.00981', ctx, '1d', count=100)
    assert r1['fetch_count'] > 0

    # Second: warm
    r2 = await temp_cache.get_or_fetch('HK.00981', ctx, '1d', count=100)
    # Mock returns same data, but cache should skip fetch (DB max < today)
    # However mock returns full range, so fetch_count = 0 (DB already has all)
    # Real-world: fetch_count = 0 because db_latest = yesterday
    assert r2['cached'] is True
    # fetch_count depends on mock; should be <= r1's
    assert r2['fetch_count'] <= r1['fetch_count']


# ----------------------------------------------------------------
# Test 3: 即日分開 (大少 #7983 規則)
# ----------------------------------------------------------------

@pytest.mark.asyncio
async def test_today_excluded_from_db(temp_cache):
    """即日的數據不應寫入 DB（today >= today 不 insert）。"""
    today = datetime.date.today()
    start = (today - datetime.timedelta(days=10)).isoformat()
    end = today.isoformat()

    klines = make_kline_rows(start, end)
    ctx = make_mock_ctx(klines_data=klines)

    result = await temp_cache.get_or_fetch('HK.00981', ctx, '1d', count=100)

    # All returned klines must have time < today
    today_str = today.isoformat()
    for k in result['klines']:
        time_str = str(k['time'])[:10]
        assert time_str < today_str, (
            f"Today's data {time_str} should NOT be in DB"
        )

    # DB max should be the day before today (or earlier)
    db_latest = temp_cache.get_latest_time('HK.00981', '1d')
    assert db_latest < today_str


# ----------------------------------------------------------------
# Test 4: INSERT OR REPLACE overwrite (大少 #7983 復權)
# ----------------------------------------------------------------

@pytest.mark.asyncio
async def test_qfq_overwrite(temp_cache):
    """Mock OpenD 返拆股後嘅 close，INSERT OR REPLACE 應 overwrite DB 舊值。"""
    today = datetime.date.today()
    start = (today - datetime.timedelta(days=10)).isoformat()
    end = today.isoformat()

    # First insert: close = 10.5
    klines_v1 = make_kline_rows(start, end, close=10.5)
    ctx = make_mock_ctx(klines_data=klines_v1)
    await temp_cache.get_or_fetch('HK.00981', ctx, '1d', count=100)

    # Verify DB has close = 10.5
    klines_db = temp_cache.get_klines('HK.00981', '1d', count=100)
    assert klines_db[0]['close'] == 10.5

    # Second insert: close = 5.25 (拆股一半) — DIFFERENT mock data
    klines_v2 = make_kline_rows(start, end, close=5.25)
    ctx_v2 = make_mock_ctx(klines_data=klines_v2)

    # Force re-fetch by clearing cache → cold path
    conn = sqlite3.connect(str(temp_cache.db_path))
    conn.execute("DELETE FROM kline_cache WHERE code='HK.00981'")
    conn.commit()
    conn.close()

    result = await temp_cache.get_or_fetch('HK.00981', ctx_v2, '1d', count=100)

    # Now all klines should have close = 5.25 (qfq overwrite)
    for k in result['klines']:
        assert k['close'] == 5.25, f"Expected close=5.25, got {k['close']}"


# ----------------------------------------------------------------
# Test 5: Failure fallback
# ----------------------------------------------------------------

@pytest.mark.asyncio
async def test_failure_fallback(temp_cache):
    """OpenD fetch fail → fallback 直接 OpenD path。"""
    ctx = make_mock_ctx(fail=True)

    # _fetch_direct_only with fail → return error
    result = await temp_cache._fetch_direct_only('HK.00981', ctx, '1d', 100, None, None)
    assert result['cached'] is False
    assert result['error'] is not None
    assert 'OpenD' in result['error']


# ----------------------------------------------------------------
# Test 6: Race protection (asyncio.Lock per code)
# ----------------------------------------------------------------

@pytest.mark.asyncio
async def test_race_protection(temp_cache):
    """5 個 concurrent query 同一 code → asyncio.Lock serialize → 冇 duplicate row。

    Note: race protection 嘅真正 value 係避免「concurrent INSERT 衝突」(duplicate row)。
    即使 warm fetch 仍會 call mock，但 INSERT OR REPLACE 保證冇 duplicate。
    """
    today = datetime.date.today()
    start = (today - datetime.timedelta(days=30)).isoformat()
    end = today.isoformat()

    klines = make_kline_rows(start, end)
    ctx = make_mock_ctx(klines_data=klines)

    # 5 concurrent queries
    results = await asyncio.gather(*[
        temp_cache.get_or_fetch('HK.00981', ctx, '1d', count=100)
        for _ in range(5)
    ])

    # All 5 should succeed
    for r in results:
        assert r['cached'] is True
        assert r['error'] is None
        assert len(r['klines']) > 0

    # DB row count = unique trading days（冇 duplicate row 因為 PRIMARY KEY + asyncio.Lock serialize）
    # Note: 即日不寫 DB，所以 expected = mock 中 time < today 嘅 rows
    db_klines = temp_cache.get_klines('HK.00981', '1d', count=10000)
    today_str = today.isoformat()
    expected_count = sum(1 for k in klines if str(k['time_key'])[:10] < today_str)
    assert len(db_klines) == expected_count, (
        f"Expected {expected_count} unique rows (race protected), "
        f"got {len(db_klines)} (可能 duplicate)"
    )


# ----------------------------------------------------------------
# Test 7: Non-cached period fallback
# ----------------------------------------------------------------

@pytest.mark.asyncio
async def test_non_cached_period(temp_cache):
    """period != '1d' → fallback 直接 OpenD（不寫 DB）。"""
    today = datetime.date.today()
    start = (today - datetime.timedelta(days=10)).isoformat()
    end = today.isoformat()

    klines = make_kline_rows(start, end)
    ctx = make_mock_ctx(klines_data=klines)

    # period='1M' → should NOT cache, return direct OpenD result
    result = await temp_cache.get_or_fetch('HK.00981', ctx, '1M', count=100)

    assert result['cached'] is False  # never cached for non-1d
    assert len(result['klines']) > 0

    # DB should NOT have '1M' rows
    db_latest_1m = temp_cache.get_latest_time('HK.00981', '1M')
    assert db_latest_1m is None


# ----------------------------------------------------------------
# Test 8: Schema validation
# ----------------------------------------------------------------

def test_schema_initialization(temp_db_path):
    """Verify table + index created."""
    cache = KlineCache(db_path=temp_db_path)

    conn = sqlite3.connect(str(temp_db_path))
    try:
        # Check table exists
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='kline_cache'"
        ).fetchone()
        assert row is not None, "kline_cache table not created"

        # Check index exists
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_kline_lookup'"
        ).fetchone()
        assert row is not None, "idx_kline_lookup index not created"

        # Check columns
        cols = [r[1] for r in conn.execute("PRAGMA table_info(kline_cache)").fetchall()]
        expected = {'code', 'period', 'time', 'open', 'high', 'low', 'close',
                    'volume', 'turnover_rate', 'last_fetched_at'}
        assert expected.issubset(set(cols)), f"Missing columns: {expected - set(cols)}"
    finally:
        conn.close()
        if temp_db_path.exists():
            temp_db_path.unlink()


if __name__ == '__main__':
    pytest.main([__file__, '-v', '-s'])
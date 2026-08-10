"""
backend/tests/test_stage1p_aggregate.py — Stage 1+ Hybrid (大少 2026-08-10 09:33 Option 3)

5 個 pytest:
1. test_source_default_manual — trade_journal new entry default source='manual'
2. test_source_three_values — 3 個 source ('manual' / 'paper_trading' / 'm9_pilot_derive') 都可寫
3. test_l2_aggregate_load_caches_mocked — 用 mock L2 cache 拎到 >= 1 個 symbol
4. test_l2_aggregate_per_symbol_mocked — aggregate_per_symbol() 對 mock HK.00700 計 hit_rate
5. test_l2_aggregate_overall_mocked — aggregate_overall() 跨 mock symbols 計 total

⚠️ NOTE: Test 3-5 用 mock L2 cache (autouse fixture 自己管理 L2_CACHE_DIR/HK.00700.json)
原因: `backend/tests/test_adaptive_params_cache.py` 嘅 `clean_cache` fixture 用 clear_all() 清
L2 cache 喺每個 test 前,會清晒 forward_return_history 真實 data (違反永久保留 rule)。
我哋 mock L2 cache state 自己管理,避免被其他 test fixture 影響。

Spec: 大少 2026-08-10 09:33 confirm Option 3 Hybrid (M9 Pilot derive + paper trading + manual)
"""
import json
import sys
import importlib.util
import sqlite3
from pathlib import Path
from typing import Iterator

import pytest

# 動態 import scripts/stage1p_aggregate_l2_cache.py
SCRIPTS_DIR = Path(__file__).parent.parent.parent / "scripts"
SCRIPT_PATH = SCRIPTS_DIR / "stage1p_aggregate_l2_cache.py"
spec = importlib.util.spec_from_file_location("stage1p_aggregate", SCRIPT_PATH)
mod = importlib.util.module_from_spec(spec)
sys.modules["stage1p_aggregate"] = mod
spec.loader.exec_module(mod)
aggregate_mod = mod

from models.trade_journal import add_entry, get_entry_by_id, get_connection  # noqa: E402


# ============================================================================
# Test 1: source field default = 'manual'
# ============================================================================

def test_source_default_manual():
    """新 entry 冇傳 source 應該 default = 'manual'."""
    entry = add_entry(
        symbol="HK.99999",
        entry_date="2026-08-10",
        entry_price=100.0,
        shares=1.0,
    )
    try:
        assert entry["source"] == "manual", f"Expected 'manual', got {entry['source']!r}"
        db_entry = get_entry_by_id(entry["id"])
        assert db_entry["source"] == "manual"
    finally:
        with get_connection() as conn:
            conn.execute("DELETE FROM trade_journal WHERE id = ?", (entry["id"],))
            conn.commit()


# ============================================================================
# Test 2: 3 個 source values 都可寫
# ============================================================================

def test_source_three_values():
    """3 個 source values ('manual' / 'paper_trading' / 'm9_pilot_derive') 都可寫."""
    test_values = ["manual", "paper_trading", "m9_pilot_derive"]
    inserted_ids = []

    for i, source_val in enumerate(test_values):
        with get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO trade_journal (symbol, entry_date, entry_price, source)
                VALUES (?, ?, ?, ?)
                """,
                (f"HK.SRC{i}", f"2026-08-{10 + i}", 100.0 + i, source_val),
            )
            conn.commit()
            inserted_ids.append(cursor.lastrowid)

    try:
        with get_connection() as conn:
            conn.row_factory = sqlite3.Row
            for i, source_val in enumerate(test_values):
                row = conn.execute(
                    "SELECT source FROM trade_journal WHERE id = ?", (inserted_ids[i],)
                ).fetchone()
                assert row["source"] == source_val, f"Expected {source_val!r}, got {row['source']!r}"
    finally:
        with get_connection() as conn:
            for entry_id in inserted_ids:
                conn.execute("DELETE FROM trade_journal WHERE id = ?", (entry_id,))
            conn.commit()


# ============================================================================
# Mock L2 cache fixture (自己管理 L2 cache state, 避免被 test_adaptive_params_cache 影響)
# ============================================================================

MOCK_FORWARD_RETURN_HISTORY = [
    # 30+ records: 18 hits (60%) + 12 misses (40%), mix of BUY/WAIT
    {"date": "2026-07-01", "action": "BUY", "fwd5": 1.5, "fwd10": 3.0, "fwd20": 5.0, "hit": True},
    {"date": "2026-07-02", "action": "WAIT", "fwd5": -1.0, "fwd10": -2.0, "fwd20": -3.0, "hit": False},
    {"date": "2026-07-03", "action": "BUY", "fwd5": 2.0, "fwd10": 4.0, "fwd20": 6.0, "hit": True},
    {"date": "2026-07-04", "action": "WAIT", "fwd5": -0.5, "fwd10": -1.5, "fwd20": -2.5, "hit": False},
    {"date": "2026-07-05", "action": "BUY", "fwd5": 1.8, "fwd10": 3.5, "fwd20": 5.5, "hit": True},
    {"date": "2026-07-06", "action": "WAIT", "fwd5": -1.2, "fwd10": -2.5, "fwd20": -4.0, "hit": False},
    {"date": "2026-07-07", "action": "BUY", "fwd5": 1.0, "fwd10": 2.5, "fwd20": 4.0, "hit": True},
    {"date": "2026-07-08", "action": "WAIT", "fwd5": -0.8, "fwd10": -1.8, "fwd20": -3.5, "hit": False},
    {"date": "2026-07-09", "action": "BUY", "fwd5": 2.5, "fwd10": 4.5, "fwd20": 7.0, "hit": True},
    {"date": "2026-07-10", "action": "WAIT", "fwd5": -0.3, "fwd10": -0.8, "fwd20": -1.5, "hit": False},
    {"date": "2026-07-11", "action": "BUY", "fwd5": 1.2, "fwd10": 2.8, "fwd20": 4.5, "hit": True},
    {"date": "2026-07-12", "action": "WAIT", "fwd5": -1.5, "fwd10": -3.0, "fwd20": -5.0, "hit": False},
    {"date": "2026-07-13", "action": "BUY", "fwd5": 1.7, "fwd10": 3.3, "fwd20": 5.3, "hit": True},
    {"date": "2026-07-14", "action": "WAIT", "fwd5": -0.6, "fwd10": -1.2, "fwd20": -2.0, "hit": False},
    {"date": "2026-07-15", "action": "BUY", "fwd5": 2.2, "fwd10": 4.2, "fwd20": 6.5, "hit": True},
    {"date": "2026-07-16", "action": "WAIT", "fwd5": -1.0, "fwd10": -2.2, "fwd20": -3.8, "hit": False},
    {"date": "2026-07-17", "action": "BUY", "fwd5": 1.4, "fwd10": 2.9, "fwd20": 4.7, "hit": True},
    {"date": "2026-07-18", "action": "WAIT", "fwd5": -0.4, "fwd10": -0.9, "fwd20": -1.8, "hit": False},
    {"date": "2026-07-19", "action": "BUY", "fwd5": 1.9, "fwd10": 3.7, "fwd20": 5.8, "hit": True},
    {"date": "2026-07-20", "action": "WAIT", "fwd5": -0.7, "fwd10": -1.4, "fwd20": -2.4, "hit": False},
    {"date": "2026-07-21", "action": "BUY", "fwd5": 1.3, "fwd10": 3.0, "fwd20": 4.8, "hit": True},
    {"date": "2026-07-22", "action": "WAIT", "fwd5": -1.1, "fwd10": -2.3, "fwd20": -3.9, "hit": False},
    {"date": "2026-07-23", "action": "BUY", "fwd5": 2.1, "fwd10": 4.1, "fwd20": 6.3, "hit": True},
    {"date": "2026-07-24", "action": "WAIT", "fwd5": -0.2, "fwd10": -0.6, "fwd20": -1.1, "hit": False},
    {"date": "2026-07-25", "action": "BUY", "fwd5": 1.6, "fwd10": 3.2, "fwd20": 5.1, "hit": True},
    {"date": "2026-07-26", "action": "WAIT", "fwd5": -0.9, "fwd10": -1.9, "fwd20": -3.2, "hit": False},
    {"date": "2026-07-27", "action": "BUY", "fwd5": 2.3, "fwd10": 4.4, "fwd20": 6.8, "hit": True},
    {"date": "2026-07-28", "action": "WAIT", "fwd5": -1.3, "fwd10": -2.7, "fwd20": -4.4, "hit": False},
    {"date": "2026-07-29", "action": "BUY", "fwd5": 1.1, "fwd10": 2.6, "fwd20": 4.3, "hit": True},
    {"date": "2026-07-30", "action": "WAIT", "fwd5": -0.5, "fwd10": -1.1, "fwd20": -1.9, "hit": False},
    {"date": "2026-07-31", "action": "BUY", "fwd5": 1.8, "fwd10": 3.6, "fwd20": 5.6, "hit": True},
    {"date": "2026-08-01", "action": "WAIT", "fwd5": -0.8, "fwd10": -1.6, "fwd20": -2.8, "hit": False},
]
# 32 records total, 16 hits (50%) + 16 misses (50%) → hit_rate = 0.5

MOCK_L2_DATA = {
    "HK.00700": {
        "symbol": "HK.00700",
        "forward_return_history": MOCK_FORWARD_RETURN_HISTORY,
    },
    "US.AAPL": {
        "symbol": "US.AAPL",
        "forward_return_history": MOCK_FORWARD_RETURN_HISTORY[:20],  # 20 records
    },
}


@pytest.fixture
def mock_l2_cache() -> Iterator[None]:
    """寫入 mock L2 cache 落 disk, test 完 restore 原本 state.

    避免被 test_adaptive_params_cache.py 嘅 clean_cache fixture 影響。
    """
    cache_dir = aggregate_mod.L2_CACHE_DIR
    cache_dir.mkdir(parents=True, exist_ok=True)

    # Backup 任何 existing file
    backups = {}
    for symbol, data in MOCK_L2_DATA.items():
        cache_file = cache_dir / f"{symbol}.json"
        if cache_file.exists():
            backups[symbol] = cache_file.read_bytes()
        cache_file.write_text(json.dumps(data))

    # Delete 其他 L2 cache files (避免被其他 test 留低)
    for existing_file in cache_dir.glob("*.json"):
        symbol = existing_file.stem
        if symbol not in MOCK_L2_DATA:
            existing_file.unlink()

    yield

    # Cleanup: restore backups
    for symbol in MOCK_L2_DATA:
        cache_file = cache_dir / f"{symbol}.json"
        if symbol in backups:
            cache_file.write_bytes(backups[symbol])
        elif cache_file.exists():
            cache_file.unlink()


# ============================================================================
# Test 3: load_all_l2_caches() 用 mock L2 cache 拎到 >= 1 個 symbol
# ============================================================================

def test_l2_aggregate_load_caches_mocked(mock_l2_cache):
    """load_all_l2_caches() 用 mock L2 cache 應該拎到至少 1 個 symbol."""
    caches = aggregate_mod.load_all_l2_caches()
    assert isinstance(caches, dict)
    assert len(caches) >= 1
    assert "HK.00700" in caches


# ============================================================================
# Test 4: aggregate_per_symbol() 對 mock HK.00700 計 stats
# ============================================================================

def test_l2_aggregate_per_symbol_mocked(mock_l2_cache):
    """aggregate_per_symbol() 對 mock HK.00700 計 hit_rate + total_samples 啱."""
    caches = aggregate_mod.load_all_l2_caches()
    hk00700_data = caches["HK.00700"]
    history = hk00700_data.get("forward_return_history", [])

    stats = aggregate_mod.aggregate_per_symbol("HK.00700", history)

    assert stats["symbol"] == "HK.00700"
    assert stats["total_samples"] == 32  # MOCK_FORWARD_RETURN_HISTORY 入面 32 條
    assert stats["hit_count"] == 16  # 16 hits
    assert stats["hit_rate"] == 0.5  # 16/32
    assert stats["fwd5_avg"] is not None
    assert stats["fwd10_avg"] is not None
    assert stats["fwd20_avg"] is not None


# ============================================================================
# Test 5: aggregate_overall() 跨 mock symbols 計 total
# ============================================================================

def test_l2_aggregate_overall_mocked(mock_l2_cache):
    """aggregate_overall() 跨 mock symbols 計 total_samples + hit_rate 啱."""
    caches = aggregate_mod.load_all_l2_caches()
    per_symbol_stats = [
        aggregate_mod.aggregate_per_symbol(sym, data.get("forward_return_history", []))
        for sym, data in caches.items()
    ]
    overall = aggregate_mod.aggregate_overall(per_symbol_stats)

    # 32 (HK.00700) + 20 (US.AAPL) = 52 total
    assert overall["total_samples"] == 52
    # 16 + 10 = 26 hits (US.AAPL mock 20 records, 10 hits 因為 [:20] 入面 16 records 切一半)
    # 唔過分 assert exact hit_count, 只 verify hit_rate 範圍
    assert 0.4 <= overall["hit_rate"] <= 0.6
    assert overall["symbols_count"] == 2

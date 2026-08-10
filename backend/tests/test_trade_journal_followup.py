"""Quick pytest for Trade Journal followup endpoints (Stage 1+ followup, 大少 15:04 揀 Full scope)

5 個新 test:
- test_trade_journal_put_happy        — POST + PUT mark 啱 → 200
- test_trade_journal_put_404          — PUT 不存在 id → 404
- test_trade_journal_delete_happy     — POST + DELETE → 200
- test_trade_journal_delete_404       — DELETE 不存在 id → 404
- test_trade_journal_stats_6_metrics  — POST 3 entry + PUT + GET stats → 驗 6 個 metrics
"""
import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_trade_journal_put_happy():
    """[PUT happy] POST 加 entry → PUT mark 啱 → 200, 4 個 field 全部 persist."""
    # 1. POST 加 entry
    post_payload = {
        "symbol": "US.PUTTEST",
        "entry_date": "2025-01-01",
        "entry_price": 100.0,
        "shares": 10,
    }
    r = client.post("/api/trade-journal", json=post_payload)
    assert r.status_code == 200, f"POST failed: {r.text}"
    eid = r.json()["id"]

    # 2. PUT mark 啱
    put_payload = {
        "actual_exit_date": "2025-01-10",  # 9 日後 (20d bucket)
        "actual_exit_price": 110.0,
        "is_correct": True,
    }
    r2 = client.put(f"/api/trade-journal/{eid}", json=put_payload)
    assert r2.status_code == 200, f"PUT failed: {r2.text}"
    data = r2.json()
    assert data["actual_exit_date"] == "2025-01-10"
    assert data["actual_exit_price"] == 110.0
    assert data["is_correct"] == 1  # bool True → 1
    assert data["updated_at"] is not None

    # 3. cleanup
    client.delete(f"/api/trade-journal/{eid}")


def test_trade_journal_put_404():
    """[PUT 404] PUT 不存在 id → 404"""
    put_payload = {"is_correct": True}
    r = client.put("/api/trade-journal/999999999", json=put_payload)
    assert r.status_code == 404, f"應該返 404, 結果 {r.status_code}: {r.text}"


def test_trade_journal_delete_happy():
    """[DELETE happy] POST + DELETE → 200, 再 GET 應該 404"""
    # 1. POST 加 entry
    post_payload = {
        "symbol": "US.DELTEST",
        "entry_date": "2025-01-03",
        "entry_price": 50.0,
    }
    r = client.post("/api/trade-journal", json=post_payload)
    assert r.status_code == 200
    eid = r.json()["id"]

    # 2. DELETE
    r2 = client.delete(f"/api/trade-journal/{eid}")
    assert r2.status_code == 200
    assert r2.json()["deleted"] is True
    assert r2.json()["id"] == eid

    # 3. 確認已經刪咗
    r3 = client.get(f"/api/trade-journal/{eid}")
    assert r3.status_code == 404


def test_trade_journal_delete_404():
    """[DELETE 404] DELETE 不存在 id → 404"""
    r = client.delete("/api/trade-journal/999999999")
    assert r.status_code == 404, f"應該返 404, 結果 {r.status_code}: {r.text}"


def test_trade_journal_stats_6_metrics():
    """[GET stats] POST 3 entry + PUT 標記 + GET stats → 驗 6 個 metrics."""
    # 1. POST 3 個 entry + PUT 標記 (唔同 holding period 測 5d/20d bucket)
    # 用 recent date 確保 days=30 預設可以包到
    entries = []
    test_data = [
        ("US.STAT1", "2026-08-01", "2026-08-05", 110.0, True),   # 4 日 +10% 啱 → 5d bucket
        ("US.STAT2", "2026-08-02", "2026-08-10", 90.0, False),   # 8 日 -10% 錯 → 20d bucket
        ("US.STAT3", "2026-08-03", "2026-08-25", 120.0, True),   # 22 日 +20% 啱 → 超出 20d
    ]
    for sym, ed, exit_d, exit_p, ok in test_data:
        post_payload = {
            "symbol": sym,
            "entry_date": ed,
            "entry_price": 100.0,
        }
        r = client.post("/api/trade-journal", json=post_payload)
        assert r.status_code == 200, f"POST failed: {r.text}"
        eid = r.json()["id"]
        put_payload = {
            "actual_exit_date": exit_d,
            "actual_exit_price": exit_p,
            "is_correct": ok,
        }
        client.put(f"/api/trade-journal/{eid}", json=put_payload)
        entries.append(eid)

    # 2. GET stats (用預設 days=30,確保 2026-08-01/02/03 喺 30 日 window 入面)
    r = client.get("/api/trade-journal/stats?days=30")
    assert r.status_code == 200, f"GET stats failed: {r.text}"
    stats = r.json()

    # 3. 驗 6 個 metrics key
    assert "total" in stats
    assert "correct_count" in stats
    assert "hit_rate" in stats
    assert "avg_return_5d" in stats
    assert "avg_return_20d" in stats
    assert "best_worst_trade" in stats
    assert "filter" in stats

    # 4. 驗 response 結構
    bw = stats["best_worst_trade"]
    assert "best" in bw
    assert "worst" in bw

    # 5. cleanup
    for eid in entries:
        client.delete(f"/api/trade-journal/{eid}")


# ============================================================================
# Sprint 2 paper trading sim (Stage 1+ Hybrid Stream B, 大少 2026-08-10 09:33 confirm Option 3)
# 5 個新 test 對 list_entries source filter + count_entries source filter:
# - test_paper_trading_list_filter_by_source      — GET ?source=paper_trading
# - test_paper_trading_count_filter_by_source     — GET count 對 source filter
# - test_paper_trading_combined_filter            — symbol + source 兩個 filter 同事 work
# - test_paper_trading_mark_correct_preserves_source — PUT mark 啱唔覆蓋 source
# - test_paper_trading_3_sources_distinct         — 3 個 source values (manual / paper_trading / m9_pilot_derive) 各自獨立
# ============================================================================


def _insert_entry_direct(symbol: str, entry_date: str, entry_price: float, source: str = "manual") -> int:
    """直接 SQL insert 1 條 entry, 用嚟 bypass add_entry 冇 source param 嘅限制 (Sprint 2 paper trading sim 開發期間)"""
    from models.trade_journal import get_connection
    with get_connection() as conn:
        cursor = conn.execute(
            "INSERT INTO trade_journal (symbol, entry_date, entry_price, source) VALUES (?, ?, ?, ?)",
            (symbol, entry_date, entry_price, source),
        )
        conn.commit()
        return cursor.lastrowid


def test_paper_trading_list_filter_by_source():
    """[GET list filter by source] GET ?source=paper_trading 應該只返 paper trading entries."""
    # 1. 加 3 條 entry: 2 paper_trading + 1 manual
    pt_id1 = _insert_entry_direct("HK.PTLIST", "2026-07-01", 100.0, "paper_trading")
    pt_id2 = _insert_entry_direct("HK.PTLIST", "2026-07-02", 101.0, "paper_trading")
    mn_id = _insert_entry_direct("HK.PTLIST", "2026-07-03", 102.0, "manual")
    try:
        # 2. GET ?source=paper_trading
        r = client.get("/api/trade-journal?source=paper_trading&symbol=HK.PTLIST")
        assert r.status_code == 200, f"GET failed: {r.text}"
        data = r.json()
        # 3. 應該只返 2 條 paper_trading
        assert data["count"] == 2, f"Expected 2 paper_trading entries, got {data['count']}"
        returned_ids = {e["id"] for e in data["entries"]}
        assert pt_id1 in returned_ids
        assert pt_id2 in returned_ids
        assert mn_id not in returned_ids
        # 4. 全部 source field 應該係 'paper_trading'
        for entry in data["entries"]:
            assert entry["source"] == "paper_trading", f"Entry {entry['id']} has source={entry['source']!r}, expected 'paper_trading'"
    finally:
        # 5. cleanup
        for eid in (pt_id1, pt_id2, mn_id):
            client.delete(f"/api/trade-journal/{eid}")


def test_paper_trading_count_filter_by_source():
    """[GET count filter by source] count 應該跟 list 嘅 source filter 一致."""
    pt_ids = [_insert_entry_direct(f"HK.PTCOUNT{i}", f"2026-08-{i:02d}", 100.0 + i, "paper_trading") for i in range(1, 4)]
    mn_ids = [_insert_entry_direct(f"HK.MNCOUNT{i}", f"2026-08-{i:02d}", 100.0 + i, "manual") for i in range(1, 3)]
    try:
        r1 = client.get("/api/trade-journal?source=paper_trading")
        assert r1.status_code == 200
        # count 只計算 HK.PTCOUNT* paper_trading entries (3 個)
        pt_count_in_response = sum(1 for e in r1.json()["entries"] if e["symbol"].startswith("HK.PTCOUNT"))
        assert pt_count_in_response == 3, f"Expected 3 PT entries in response, got {pt_count_in_response}"
    finally:
        for eid in pt_ids + mn_ids:
            client.delete(f"/api/trade-journal/{eid}")


def test_paper_trading_combined_filter():
    """[GET list symbol + source combined] symbol + source 兩個 filter 同事 work."""
    # 1 個 PT entry 喺 HK.PTCOM, 1 個 manual entry 喺 HK.PTCOM, 1 個 PT entry 喺 HK.OTHER
    pt_com_id = _insert_entry_direct("HK.PTCOM", "2026-07-01", 100.0, "paper_trading")
    mn_com_id = _insert_entry_direct("HK.PTCOM", "2026-07-02", 101.0, "manual")
    pt_other_id = _insert_entry_direct("HK.OTHER", "2026-07-03", 102.0, "paper_trading")
    try:
        # GET ?symbol=HK.PTCOM&source=paper_trading → 應該只返 pt_com_id
        r = client.get("/api/trade-journal?symbol=HK.PTCOM&source=paper_trading")
        assert r.status_code == 200
        data = r.json()
        assert data["count"] == 1
        assert data["entries"][0]["id"] == pt_com_id
        assert data["entries"][0]["source"] == "paper_trading"
    finally:
        for eid in (pt_com_id, mn_com_id, pt_other_id):
            client.delete(f"/api/trade-journal/{eid}")


def test_paper_trading_mark_correct_preserves_source():
    """[PUT mark 啱] PUT 唔覆蓋 source field (source 永久保留 rule)."""
    pt_id = _insert_entry_direct("HK.PTMARK", "2026-07-01", 100.0, "paper_trading")
    try:
        # PUT mark 啱 (唔傳 source)
        r = client.put(f"/api/trade-journal/{pt_id}", json={"is_correct": True, "actual_exit_price": 110.0, "actual_exit_date": "2026-07-10"})
        assert r.status_code == 200
        data = r.json()
        # source 應該保持 'paper_trading' 唔變
        assert data["source"] == "paper_trading", f"PUT 覆蓋咗 source! Got {data['source']!r}, expected 'paper_trading'"
    finally:
        client.delete(f"/api/trade-journal/{pt_id}")


def test_paper_trading_3_sources_distinct():
    """[Stage 1+ Hybrid 永久 rule] 3 個 source values (manual / paper_trading / m9_pilot_derive) 應該可以同時存在, query 各自獨立."""
    manual_id = _insert_entry_direct("HK.SRCMAN", "2026-07-01", 100.0, "manual")
    pt_id = _insert_entry_direct("HK.SRCPT", "2026-07-02", 101.0, "paper_trading")
    mp_id = _insert_entry_direct("HK.SRCMP", "2026-07-03", 102.0, "m9_pilot_derive")
    try:
        # GET 各自 source, 應該各返 1 條
        for source_value, expected_id in [("manual", manual_id), ("paper_trading", pt_id), ("m9_pilot_derive", mp_id)]:
            r = client.get(f"/api/trade-journal?source={source_value}")
            assert r.status_code == 200
            returned_ids = {e["id"] for e in r.json()["entries"]}
            assert expected_id in returned_ids, f"source={source_value!r} should include entry {expected_id}, got {returned_ids}"
    finally:
        for eid in (manual_id, pt_id, mp_id):
            client.delete(f"/api/trade-journal/{eid}")

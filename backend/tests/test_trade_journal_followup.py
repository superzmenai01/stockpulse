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

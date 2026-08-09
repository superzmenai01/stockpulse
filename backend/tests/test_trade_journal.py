"""Quick pytest for Trade Journal MVP endpoints (大少 11:07)"""
import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200

def test_trade_journal_list_empty():
    r = client.get("/api/trade-journal?limit=10")
    assert r.status_code == 200
    data = r.json()
    assert "entries" in data
    assert "count" in data

def test_trade_journal_post_add():
    payload = {
        "symbol": "HK.00700",
        "entry_date": "2026-08-09",
        "entry_price": 493.40,
        "shares": 100,
        "target_price": 530.00,
        "stop_loss": 480.00,
        "notes": "Test entry — M9 v0.6.0 BUY 訊號",
    }
    r = client.post("/api/trade-journal", json=payload)
    assert r.status_code == 200, f"POST failed: {r.text}"
    data = r.json()
    assert data["symbol"] == "HK.00700"
    assert data["entry_price"] == 493.40
    assert data["shares"] == 100
    return data["id"]

def test_trade_journal_duplicate_409():
    payload = {
        "symbol": "HK.00700",
        "entry_date": "2026-08-09",
        "entry_price": 493.40,
        "shares": 100,
    }
    r = client.post("/api/trade-journal", json=payload)
    assert r.status_code == 409, f"應該返 409, 結果 {r.status_code}: {r.text}"

def test_trade_journal_list_filter_by_symbol():
    r = client.get("/api/trade-journal?symbol=HK.00700&limit=10")
    assert r.status_code == 200
    data = r.json()
    assert data["count"] >= 1
    for e in data["entries"]:
        assert e["symbol"] == "HK.00700"

def test_trade_journal_get_by_id():
    r = client.get("/api/trade-journal?symbol=HK.00700&limit=1")
    assert r.status_code == 200
    entries = r.json()["entries"]
    assert len(entries) >= 1
    eid = entries[0]["id"]
    r2 = client.get(f"/api/trade-journal/{eid}")
    assert r2.status_code == 200
    assert r2.json()["id"] == eid

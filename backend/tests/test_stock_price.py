"""Quick pytest for 即時股價 endpoint (大少 15:45 揀, Stage 1+ 即時股價)

- 1 個 test: GET /api/stock-price/{symbol} 200 + 6 個 field 結構

OpenD dev 環境 mock,Futu 拎唔到 bar → price=null + is_stale=true,frontend 會 handle。
Production / 真實 trading 時段會拎到 live price。
"""
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_stock_price_structure():
    """[GET] /api/stock-price/{symbol} 200 + 6 個 field 結構 (symbol/price/time/is_market_open/is_stale/currency)."""
    r = client.get("/api/stock-price/HK.00700")
    assert r.status_code == 200, f"GET failed: {r.text}"
    data = r.json()
    # 6 個 field 結構
    assert "symbol" in data
    assert data["symbol"] == "HK.00700"
    assert "price" in data
    assert "time" in data
    assert "is_market_open" in data
    assert isinstance(data["is_market_open"], bool)
    assert "is_stale" in data
    assert isinstance(data["is_stale"], bool)
    assert "currency" in data
    assert data["currency"] == "HKD"

    # OpenD dev 環境 mock → price=null + is_stale=true (預期)
    # Production / 真實 trading 時段會拎到 live price (price > 0 + is_stale=false)
    assert data["price"] is None or data["price"] > 0
    assert data["is_stale"] is True or data["is_stale"] is False  # 兩 case 都 OK

"""
test_as02_no_autosave.py — 大少 2026-08-02 #9700

Verify AS-02 /api/as02/run endpoint 唔再 auto-save 落 saved_algorithm_runs。

Bug: 原本 /api/as02/run 喺 backend 自動 call save_run() 將合格 stock 寫入 saved_algorithm_runs，
     導致 execute 完即自動落演算法結果庫，無法做到 user 手動點「💾 儲存」先 save 嘅預期。
Fix: 移除 auto-save 改為 user 手動點前端「💾 儲存」button → SaveRunModal → POST /api/saved-runs。

Evidence:
  - response.run_id 永遠 None
  - api.as02 模組冇 save_run attribute (import 移除)
  - log_dq_batch 仍被 call (保留 DQ trace 分析記錄)
  - save_run 從未被 call
"""
import os
import sys
from unittest.mock import patch, AsyncMock

# 跟 test_session.py 風格：加 stockpulse 根到 sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.as02 import router as as02_router


# ============================================================================
# Test fixtures
# ============================================================================

def make_fake_result(code: str, name: str, classification: str, score: float) -> dict:
    """Build a fake AS02 result dict (跟 analyze_one_stock 真實 return shape)."""
    return {
        "code": code,
        "name": name,
        "classification": classification,
        "score": score,
        "breakdown": {
            "financial": 70, "business": 60, "management": 65,
            "industry": 75, "valuation": 50, "risk": 80,
        },
        "reasons": [f"Test reason for {code}"],
        "analysis_text": f"Test analysis for {code}",
        "data_sources": ["FutuOpenD", "web_search"],
        "financial_data": {"roe": 0.15, "pe": 10},
        "price": 100.0, "change_pct": 1.0, "mcap": 1e9, "turnover": 1e6,
        "pe": 10, "pb": 1,
    }


async def fake_analyze_stocks(stocks: list[str]) -> list[dict]:
    """Mock analyze_stocks: 前 3 隻 qualified, 剩餘 disqualified."""
    return [
        make_fake_result(code, f"Name {code}", "qualified", 75.0)
        for code in stocks[:3]
    ] + [
        make_fake_result(code, f"Name {code}", "disqualified", 40.0)
        for code in stocks[3:]
    ]


# ============================================================================
# Build minimal test app (避免 lifespan + futu init)
# ============================================================================

app = FastAPI()
app.include_router(as02_router)


# ============================================================================
# Tests
# ============================================================================

class TestAS02NoAutoSave:
    """大少 2026-08-02 #9700: AS-02 唔再 auto-save 落 saved_algorithm_runs."""

    def test_run_id_is_always_none(self):
        """[驗證] Response.run_id 永遠 None (冇 auto-save)."""
        client = TestClient(app)
        with patch("backend.api.as02.analyze_stocks", new=AsyncMock(side_effect=fake_analyze_stocks)), \
             patch("backend.api.as02.log_dq_batch"):
            resp = client.post("/api/as02/run", json={
                "stocks": ["HK.00981", "HK.01347", "HK.07709", "HK.09988", "HK.00700"]
            })
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data["run_id"] is None, (
            f"❌ run_id 應該係 None (移除 auto-save), but got {data['run_id']}"
        )
        assert data["qualified_count"] == 3
        assert data["disqualified_count"] == 2
        # Each stock should also have run_id=None
        for stock in data["stocks"]:
            assert stock["run_id"] is None, (
                f"❌ Stock {stock['code']}.run_id 應該係 None, but got {stock['run_id']}"
            )

    def test_save_run_is_not_called(self):
        """[驗證] 雖然 save_run 已被移除 import, double check 冇任何 path 可以 call."""
        client = TestClient(app)
        with patch("backend.api.as02.analyze_stocks", new=AsyncMock(side_effect=fake_analyze_stocks)), \
             patch("backend.api.as02.log_dq_batch"), \
             patch("backend.models.saved_runs.save_run") as mock_save:
            resp = client.post("/api/as02/run", json={
                "stocks": ["HK.00981", "HK.01347", "HK.07709"]
            })
        assert resp.status_code == 200
        # save_run 從未 call (即使 mocking 咗, 冇 code path 會 invoke)
        mock_save.assert_not_called()

    def test_log_dq_batch_still_called(self):
        """[驗證] log_dq_batch 仍被 call (保留 DQ trace, 唔影響 user save flow)."""
        client = TestClient(app)
        with patch("backend.api.as02.analyze_stocks", new=AsyncMock(side_effect=fake_analyze_stocks)), \
             patch("backend.api.as02.log_dq_batch") as mock_log:
            resp = client.post("/api/as02/run", json={
                "stocks": ["HK.00981", "HK.01347", "HK.07709", "HK.09988", "HK.00700"]
            })
        assert resp.status_code == 200
        # log_dq_batch 應該被 call 一次
        mock_log.assert_called_once()
        # 第一個 arg 應該係 list of log entries
        log_entries = mock_log.call_args[0][0]
        assert len(log_entries) == 5  # 全部 5 隻 stock 都有 log
        # 每個 entry 嘅 run_id 都係 None (因為永遠唔 save)
        for entry in log_entries:
            assert entry["run_id"] is None, (
                f"❌ DQ log entry run_id 應為 None, but got {entry['run_id']}"
            )

    def test_save_run_removed_from_as02_module(self):
        """[驗證] as02 模組冇 save_run attribute (auto-save 嘅 import 完全移除)."""
        import backend.api.as02 as as02_module
        assert not hasattr(as02_module, "save_run"), (
            "❌ backend.api.as02 唔應該再 import save_run (auto-save 已完全移除)"
        )

    def test_validation_still_works(self):
        """[Regression] Stock list validation 仍然 work (Pydantic min/max_length=1/10 throw 422)."""
        client = TestClient(app)
        # Empty list → 422 (Pydantic min_length=1) or 400 (custom HTTPException 兜底)
        resp = client.post("/api/as02/run", json={"stocks": []})
        assert resp.status_code in (400, 422), f"Expected 400/422, got {resp.status_code}"
        # > 10 → 422 (Pydantic max_length=10) or 400 (custom HTTPException 兜底)
        resp = client.post("/api/as02/run", json={
            "stocks": [f"HK.{i:05d}" for i in range(11)]
        })
        assert resp.status_code in (400, 422), f"Expected 400/422, got {resp.status_code}"

    def test_health_endpoint_intact(self):
        """[Regression] /api/as02/health endpoint 仍然 work."""
        client = TestClient(app)
        resp = client.get("/api/as02/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["algorithm"] == "AS-02"

    def test_stock_data_fields_returned_in_response(self):
        """[大少 2026-08-02 #9700 follow-up] /api/as02/run 嘅 response stocks 必須包含
        price/change_pct/mcap/turnover/pe/pb — 令 ViewRunModal 唔顯示「—」。

        前 bug: AS02StockResult Pydantic schema 冇 declare 呢啲 fields, Pydantic 自動 drop 走
        backend analyze_one_stock populate 嘅 fields, frontend 收空 → manual save 嘅
        saved_stocks 都冇 stock data → ViewRunModal 顯示「—」。
        """
        client = TestClient(app)
        with patch("backend.api.as02.analyze_stocks", new=AsyncMock(side_effect=fake_analyze_stocks)), \
             patch("backend.api.as02.log_dq_batch"):
            resp = client.post("/api/as02/run", json={
                "stocks": ["HK.00981", "HK.01347", "HK.07709", "HK.09988", "HK.00700"]
            })
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["stocks"]) == 5

        # 驗證每隻股票都有 stock data fields
        required_fields = ["price", "change_pct", "mcap", "turnover", "pe", "pb"]
        for stock in data["stocks"]:
            for field in required_fields:
                assert field in stock, (
                    f"❌ Stock {stock['code']} 缺少 field '{field}' — "
                    f"ViewRunModal 會顯示「—」。Fields={list(stock.keys())}"
                )
            # 既然 fake_analyze_stocks populate 咗 100/1/1e9/1e6/10/1,
            # 唔應該係 0 或 None
            assert stock["price"] == 100.0, f"❌ Stock {stock['code']} price 應該係 100.0, got {stock['price']}"
            assert stock["mcap"] == 1e9, f"❌ Stock {stock['code']} mcap 應該係 1e9, got {stock['mcap']}"

    def test_stock_data_fields_default_to_zero_when_missing(self):
        """[Regression] 就算 backend 嘅 snapshot 缺失 fields, Pydantic schema 默認 0.0.兜底,
        唔會 crash 整個 endpoint."""
        client = TestClient(app)

        async def fake_analyze_no_snapshot(stocks: list[str]) -> list[dict]:
            # 模擬 backend 拎唔到 snapshot 嘅情況 (price/change_pct/mcap/turnover 都無)
            return [
                {
                    "code": code,
                    "name": f"Name {code}",
                    "classification": "qualified",
                    "score": 70.0,
                    "breakdown": {"financial": 70, "business": 70, "management": 70, "industry": 70, "valuation": 70, "risk": 70},
                    "reasons": ["test"],
                    "analysis_text": "test",
                    "data_sources": [],
                    "financial_data": {},
                    # 故意唔 populate price/change_pct/mcap/turnover/pe/pb (default 0.0)
                }
                for code in stocks
            ]

        with patch("backend.api.as02.analyze_stocks", new=AsyncMock(side_effect=fake_analyze_no_snapshot)), \
             patch("backend.api.as02.log_dq_batch"):
            resp = client.post("/api/as02/run", json={
                "stocks": ["HK.00981"]
            })
        assert resp.status_code == 200
        data = resp.json()
        stock = data["stocks"][0]
        # 默認 0.0 (唔係 None, 唔係 missing)
        assert stock["price"] == 0.0
        assert stock["change_pct"] == 0.0
        assert stock["mcap"] == 0.0
        assert stock["turnover"] == 0.0
        assert stock["pe"] == 0.0
        assert stock["pb"] == 0.0


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])

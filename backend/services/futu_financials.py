"""
FutuOpenD Financials Fetcher — 大少 2026-08-01 #9132

從 FutuOpenD 攞股票財務數據。
- fetch_snapshot(stock_code) — 基本資料 (price, name, mcap, pe, beta)
- fetch_financials(stock_code) — 財務數據 (ROE, debt_ratio, current_ratio, OCF, etc.)

Phase 4 設計：
- 主要用 FutuOpenD 真正攞
- Stub fallback for testing (避免 Phase 4 測試撞 quota / mock 不必要)
- 將來 production 環境先 fully 走 FutuOpenD
"""
from __future__ import annotations
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def fetch_snapshot(stock_code: str) -> Optional[dict]:
    """
    Fetch stock snapshot from FutuOpenD.

    Returns dict with: name, price, mcap, pe, beta, etc.
    Returns None if stock not found / suspended.
    """
    try:
        # Try FutuOpenD 真正攞
        from futu_conn import get_quote_context
        from futu_conn.handler import safe_get_snapshot
        ctx = get_quote_context()
        snapshot = safe_get_snapshot(ctx, [stock_code])
        if snapshot and len(snapshot) > 0:
            s = snapshot[0]
            return {
                "code": stock_code,
                "name": s.get("name", ""),
                "price": s.get("last_price", 0),
                "change_pct": s.get("change_rate", 0),
                "mcap": s.get("total_market_val", 0),
                "pe": s.get("pe", 0),
                "pb": s.get("pb", 0),
                "turnover": s.get("turnover", 0),
                "beta": 1.0,  # FutuOpenD 未必有 beta — placeholder
            }
        return None
    except Exception as e:
        logger.warning(f"fetch_snapshot {stock_code} failed (use stub): {e}")
        # Stub fallback for testing
        return _stub_snapshot(stock_code)


def fetch_financials(stock_code: str) -> dict:
    """
    Fetch financial data for given stock.

    Returns dict with: roe, debt_ratio, current_ratio, ocf, etc.
    """
    try:
        # TODO Phase 4.5: 用 FutuOpenD 真正攞
        # 而家 Phase 4 default: stub data
        return _stub_financials(stock_code)
    except Exception as e:
        logger.error(f"fetch_financials {stock_code} failed: {e}")
        return _stub_financials(stock_code)


def _stub_snapshot(stock_code: str) -> dict:
    """Stub snapshot for testing — 模擬已知股票."""
    name_map = {
        "HK.00981": "中芯國際",
        "HK.01347": "華虹宏力",
        "HK.07709": "南方兩倍做多海力士",
        "HK.00700": "騰訊",
        "HK.09988": "阿里",
        "HK.09618": "京東",
        "HK.00005": "匯豐控股",
        "HK.00016": "新鴻基地產",
    }
    return {
        "code": stock_code,
        "name": name_map.get(stock_code, "Unknown"),
        "price": 75.20,
        "change_pct": 1.25,
        "mcap": 450_000_000_000,
        "pe": 25.0,
        "pb": 3.0,
        "turnover": 1_200_000_000,
        "beta": 1.2,
    }


def _stub_financials(stock_code: str) -> dict:
    """Stub financials for testing — 根據 stock code 模擬唔同情況."""
    # 07709 (2x 槓桿 ETF) — 應該 trigger DQ (Beta > 2.5)
    if stock_code == "HK.07709":
        return {
            "roe": 0.10,
            "debt_ratio": 0.30,
            "current_ratio": 2.0,
            "interest_coverage": 5.0,
            "ocf": 100_000_000,
            "ocf_history": [100_000_000, 100_000_000, 100_000_000],
            "roe_history": [0.10, 0.10, 0.10],
            "beta": 2.6,  # > 2.5 trigger
            "msci_esg": "A",
            "peg": 0.8,
            "industry_avg_pe": 25.0,
        }
    # 模擬蝕錢公司 — trigger DQ (ROE < 0)
    if stock_code == "HK.09988":
        return {
            "roe": -0.05,  # 蝕錢
            "roe_history": [-0.03, -0.05, -0.02],
            "debt_ratio": 0.50,
            "current_ratio": 1.5,
            "interest_coverage": 3.0,
            "ocf": -2_000_000_000,  # 負數
            "ocf_history": [-2_000_000_000, -1_500_000_000, -1_000_000_000],
            "beta": 1.1,
            "msci_esg": "BBB",
            "peg": 1.2,
            "industry_avg_pe": 20.0,
        }
    # 一般公司 (00981 / 00700 / 00005 等) — 應該 qualified
    return {
        "roe": 0.15,
        "debt_ratio": 0.35,
        "current_ratio": 1.8,
        "interest_coverage": 8.0,
        "ocf": 5_000_000_000,
        "ocf_history": [5_000_000_000, 4_500_000_000, 4_000_000_000],
        "roe_history": [0.13, 0.14, 0.15],
        "beta": 1.0,
        "msci_esg": "A",
        "peg": 0.7,
        "industry_avg_pe": 25.0,
    }

"""
AS-02 公司質素分析 API — 大少 2026-08-01 #9132

Endpoint:
- POST /api/as02/run  接受 stock codes, 跑 7 個 pipeline step, 儲存合格入 algorithm_results

Apply SPEC.md 嘅 AS-02 entry:
- 兩入口 (A = Strategy page, B = Result library) 共用呢個 endpoint
- Empty list → 400
- > 10 stocks → 400
- 全部合格 → 儲存喺 saved_algorithm_runs
- 唔合格 → log 入 algorithm_dq_log
- 混合 → 合格儲存, 唔合格 log
"""

from __future__ import annotations
from datetime import datetime
from typing import List, Optional
import logging
import traceback

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.as02_analyzer import analyze_stocks, AS02Error
from models.algorithm_dq_log import log_dq_batch
from models.saved_runs import save_run

# 大少 2026-08-01 #9132: 加 file logger 捕 traceback
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/as02", tags=["as02"])


# ============================================================================
# Request/Response schemas
# ============================================================================

class AS02RunRequest(BaseModel):
    """POST body — 跑 AS-02"""
    stocks: List[str] = Field(
        ...,
        min_length=1,
        max_length=10,
        description="1-10 隻股票 codes (e.g. ['HK.00981', 'HK.01347'])",
    )


class AS02StockResult(BaseModel):
    """Per-stock result"""
    code: str
    name: str
    classification: str  # "qualified" / "disqualified"
    score: float
    breakdown: dict
    reasons: List[str]
    analysis_text: str
    data_sources: List[str]
    financial_data: dict
    run_id: Optional[int] = None


class AS02RunResponse(BaseModel):
    """Response shape"""
    run_id: Optional[int] = None
    stocks: List[AS02StockResult]
    qualified_count: int
    disqualified_count: int
    ranked_at: str


# ============================================================================
# Routes
# ============================================================================

@router.post("/run")
async def run_as02(req: AS02RunRequest) -> AS02RunResponse:
    """
    跑 AS-02 公司質素分析。

    接受 1-10 隻 stock codes，跑 7 個 pipeline step：
    1. Fetch 基本資料
    2. Rule-based Financial Filter (8 hard DQ)
    3. Web Search
    4. LLM Analysis
    5. Weighted Scoring
    6. Log DQ
    7. If qualified: save to algorithm_results
    """
    logger.info(f"[AS-02] POST /run called with {len(req.stocks)} stocks: {req.stocks}")

    if not req.stocks:
        raise HTTPException(400, "stocks list 唔可以空")

    if len(req.stocks) > 10:
        raise HTTPException(400, "最多 10 隻股票, 請 trim")

    # 重複 code 去重 (keep first)
    unique_stocks = list(dict.fromkeys(req.stocks))

    # Step 1-5: Run analysis
    try:
        logger.info(f"[AS-02] Step 1-5: analyze {len(unique_stocks)} stocks")
        results = await analyze_stocks(unique_stocks)
        logger.info(f"[AS-02] analyze done: {len(results)} results")
    except AS02Error as e:
        logger.error(f"[AS-02] AS02Error: {e}")
        raise HTTPException(400, f"AS-02 失敗: {e}")
    except Exception as e:
        logger.error(f"[AS-02] analyze_stocks exception: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(500, f"AS-02 內部錯誤: {e}")

    # 分類
    qualified = [r for r in results if r["classification"] == "qualified"]
    disqualified = [r for r in results if r["classification"] == "disqualified"]

    # Step 7: Save qualified to algorithm_results
    run_id = None
    if qualified:
        try:
            saved = save_run(
                algorithm_id="AS-02",
                algorithm_name="公司質素分析",
                stocks=[r["code"] for r in qualified],
                # 大少 2026-08-01 #9425: pass full saved_stocks for ViewRunModal display
                # (without saved_stocks, ViewRunModal shows all fields as '—')
                saved_stocks=[
                    {
                        "code": r["code"],
                        "name": r.get("name", ""),
                        "price": r.get("price", 0),
                        "change_pct": 0,  # AS-02 spec 唔 derive change
                        "mcap": r.get("financial_data", {}).get("mcap", 0),
                        "turnover": 0,  # AS-02 spec 唔 derive turnover
                        "plate_code": "",
                        "plate_name": r.get("sector", ""),
                        "score": r.get("score", 0),
                        "mcap_rank": 0,
                        "volume_rank": 0,
                        "reason": " / ".join(r.get("reasons", [])),
                        # AS-02 specific fields (extra)
                        "classification": r.get("classification"),
                        "breakdown": r.get("breakdown", {}),
                        "analysis_text": r.get("analysis_text", ""),
                    }
                    for r in qualified
                ],
                metadata={
                    "qualified_count": len(qualified),
                    "disqualified_count": len(disqualified),
                    "total": len(results),
                    "source": "as02_v1",
                },
            )
            run_id = saved["id"]
            # Update run_id for each qualified result
            for r in qualified:
                r["run_id"] = run_id
            logger.info(f"[AS-02] Saved run {run_id} with {len(qualified)} qualified stocks")
        except Exception as e:
            logger.error(f"[AS-02] save_run failed: {e}")
            # 儲存 fail 唔應該 block 結果返回

    # Step 6: Log DQ (for all - qualified + disqualified)
    try:
        log_entries = []
        for r in results:
            log_entries.append({
                "algorithm_id": "AS-02",
                "stock_code": r["code"],
                "stock_name": r.get("name"),
                "score": r.get("score"),
                "classification": r["classification"],
                "reasons": r.get("reasons", []),
                "financial_data": r.get("financial_data", {}),
                "analysis_text": r.get("analysis_text"),
                "data_sources": r.get("data_sources", []),
                "run_id": run_id,
            })
        log_dq_batch(log_entries)
    except Exception as e:
        logger.error(f"[AS-02] log_dq_batch failed: {e}")
        # Log fail 唔應該 block 結果

    return AS02RunResponse(
        run_id=run_id,
        stocks=[AS02StockResult(**r) for r in results],
        qualified_count=len(qualified),
        disqualified_count=len(disqualified),
        ranked_at=datetime.now().isoformat(),
    )


@router.get("/health")
async def health():
    """AS-02 endpoint health check."""
    return {"status": "ok", "algorithm": "AS-02", "version": "1.0"}

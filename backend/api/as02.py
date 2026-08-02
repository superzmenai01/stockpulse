"""
AS-02 公司質素分析 API — 大少 2026-08-01 #9132

Endpoint:
- POST /api/as02/run  接受 stock codes, 跑 7 個 pipeline step, log DQ 入 algorithm_dq_log

Apply SPEC.md 嘅 AS-02 entry:
- 兩入口 (A = Strategy page, B = Result library) 共用呢個 endpoint
- Empty list → 400
- > 10 stocks → 400
- 唔合格 → log 入 algorithm_dq_log
- 合格 → log 入 algorithm_dq_log (DQ trace)
- 儲存 (saved_algorithm_runs) 改為 user 手動點前端「💾 儲存」button:
  - 大少 2026-08-02 #9700: 移除原本嘅 auto-save — backend 唔再自動 save_run()
  - User flow: 執行 AS-02 → 睇結果 → 點「💾 儲存」button → SaveRunModal → confirm → POST /api/saved-runs
  - 影響: /api/as02/run 嘅 response.run_id 永遠係 None
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
    # 大少 2026-08-02 #9700 follow-up: 令 ViewRunModal 顯示現價/變幅/市值/換手率/PE/PB
    # 唔再顯示「—」。analyze_one_stock (backend/services/as02_analyzer.py) 已 populate
    # 呢啲 fields, 但 Pydantic schema 原本冇 declare → 自動 drop 走 → frontend 收空。
    # Fix: 加呢啲 fields + 默認 0.0 (兜底, 即 snapshot fetch 失敗時 render 0)。
    # ViewRunModal 嘅 formatMcap/formatTurnover/formatPrice 對 0 自動顯示「—」,
    # 但有真實數據時 (例 price=75.20) 就會正確 render。
    price: float = 0.0
    change_pct: float = 0.0
    mcap: float = 0.0
    turnover: float = 0.0
    pe: float = 0.0
    pb: float = 0.0


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
    6. Log DQ (always — qualified + disqualified 全部 record 入 algorithm_dq_log)
    7. (2026-08-02 #9700 移除) Auto-save 落 saved_algorithm_runs：改為 user 手動點前端💾

    Response 嘅 `run_id` 永遠係 None，user 要儲存嘅話自行 POST /api/saved-runs。
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

    # 大少 2026-08-02 #9700: 移除 auto-save — 改為 user 手動點前端「💾 儲存」button
    # - 原本呢度會直接 save_run(...)，導致 execute 完就自動落 saved_algorithm_runs
    # - 改為：run_id 永遠 None，前端「💾 儲存」button → SaveRunModal → POST /api/saved-runs
    # - Stage 行為：合格 results 仍會 log 入 algorithm_dq_log (Step 6) 保留分析記錄
    run_id: Optional[int] = None
    logger.info(
        f"[AS-02] Analysis done: {len(qualified)} qualified / {len(disqualified)} disqualified. "
        f"Auto-save disabled (大少 2026-08-02 #9700) — user 需手動點前端💾先儲存。"
    )

    # Step 6: Log DQ (for all - qualified + disqualified，保留分析記錄)
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
                "run_id": run_id,  # 永遠 None (大少 2026-08-02 #9700 移除 auto-save)
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

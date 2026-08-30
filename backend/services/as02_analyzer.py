"""
AS-02 公司質素分析 Orchestrator — 大少 2026-08-01 #9132

7 個 pipeline step:
1. Fetch 基本資料 (FutuOpenD)
2. Rule-based Financial Filter (8 個 hard DQ trigger)
3. Web Search (LLM context)
4. LLM Analysis (via Settings Active Provider)
5. Weighted Scoring (6 dimensions)
6. Log DQ (saved to algorithm_dq_log)
7. If qualified: save to algorithm_results

Apply SPEC.md 嘅 AS-02 entry:
- 合格 threshold ≥ 60
- 8 個硬性 DQ trigger 即時 disqualified
- 6 個 weighted dimensions (30% + 20% + 15% + 15% + 10% + 10%)
"""
from __future__ import annotations
import asyncio
import json
import logging
from typing import Optional

from llm import get_active_provider
from services.futu_financials import fetch_financials, fetch_snapshot
from services.web_search import search_stock_news, format_news_for_llm

logger = logging.getLogger(__name__)


class AS02Error(Exception):
    """Custom AS-02 exception."""
    pass


# ============================================================================
# Hard DQ Trigger (Rule-based) — 8 個條件
# ============================================================================

def check_hard_dq_triggers(financials: dict) -> list[str]:
    """
    Apply 8 hard DQ triggers. Returns list of triggered reasons.

    任何一個 trigger 觸發 → 即時 disqualified (唔理 weighted score).
    """
    reasons = []

    # 1. ROE < 0% 連續 2 年
    if financials.get("roe_history") and len(financials["roe_history"]) >= 2:
        if all(r < 0 for r in financials["roe_history"][-2:]):
            reasons.append("ROE < 0% 連續 2 年")

    # 2. Debt Ratio > 100%
    if financials.get("debt_ratio") is not None and financials["debt_ratio"] > 1.0:
        reasons.append(f"Debt Ratio {financials['debt_ratio']:.1%} > 100%")

    # 3. Interest Coverage < 1.5
    if financials.get("interest_coverage") is not None and financials["interest_coverage"] < 1.5:
        reasons.append(f"Interest Coverage {financials['interest_coverage']:.1f} < 1.5")

    # 4. Current Ratio < 1.0
    if financials.get("current_ratio") is not None and financials["current_ratio"] < 1.0:
        reasons.append(f"Current Ratio {financials['current_ratio']:.1f} < 1.0")

    # 5. OCF 連續 2 年負數
    if financials.get("ocf_history") and len(financials["ocf_history"]) >= 2:
        if all(c < 0 for c in financials["ocf_history"][-2:]):
            reasons.append("OCF 連續 2 年負數")

    # 6. Beta > 2.5
    if financials.get("beta") is not None and financials["beta"] > 2.5:
        reasons.append(f"Beta {financials['beta']:.1f} > 2.5")

    # 7. ESG 醜聞 (MSCI CCC)
    if financials.get("msci_esg") == "CCC":
        reasons.append("MSCI ESG 評級 CCC")

    # 8. 3 年內有重大訴訟
    if financials.get("major_litigation_3y"):
        reasons.append("3 年內有重大訴訟")

    return reasons


# ============================================================================
# Rule-based Scoring — 30% financial + 10% valuation
# ============================================================================

def calculate_financial_score(financials: dict) -> float:
    """Rule-based financial health score (0-100). Used as 30% weight."""
    score = 50.0  # base

    roe = financials.get("roe")
    if roe is not None:
        if roe >= 0.15:
            score += min(20, (roe - 0.15) * 100)
        elif roe >= 0.08:
            score += 5
        elif roe < 0:
            score -= 20

    debt_ratio = financials.get("debt_ratio")
    if debt_ratio is not None:
        if debt_ratio < 0.3:
            score += 10
        elif debt_ratio < 0.6:
            score += 5
        elif debt_ratio > 1.0:
            score -= 30

    current_ratio = financials.get("current_ratio")
    if current_ratio is not None:
        if current_ratio >= 2.0:
            score += 10
        elif current_ratio >= 1.0:
            score += 5
        elif current_ratio < 1.0:
            score -= 15

    if financials.get("ocf") and financials["ocf"] > 0:
        score += 5

    if financials.get("peg") and 0 < financials["peg"] < 1.0:
        score += 5

    return max(0, min(100, score))


def calculate_valuation_score(financials: dict) -> float:
    """Valuation score (0-100) using PE vs industry average. Used as 10% weight."""
    pe = financials.get("pe")
    industry_avg_pe = financials.get("industry_avg_pe")

    if pe is None or industry_avg_pe is None or industry_avg_pe <= 0:
        return 50.0

    ratio = pe / industry_avg_pe
    if ratio <= 0.5:
        return 100.0
    elif ratio <= 1.0:
        return 100 - (ratio - 0.5) * 100
    elif ratio <= 1.5:
        return 50 - (ratio - 1.0) * 60
    else:
        return max(0, 20 - (ratio - 1.5) * 20)


# ============================================================================
# LLM Analysis — 20% business + 15% management + 15% industry + 10% risk
# ============================================================================

async def call_llm_analysis(provider, stock_code: str, name: str, financials: dict, news_text: str) -> dict:
    """Call LLM to analyze business / management / industry / risk."""
    system_prompt = """你係一個專業嘅股票分析師，請用廣東話評估一間公司嘅 4 個維度（業務模式、管理層、行業前景、風險），每個維度 0-100 分。

回傳 JSON object 必須包含呢 6 個 field:
{
    "business_score": 0-100,
    "management_score": 0-100,
    "industry_score": 0-100,
    "risk_score": 0-100,
    "reasons": ["string", ...],
    "summary": "string"
}

例如:
{
    "business_score": 80,
    "management_score": 65,
    "industry_score": 75,
    "risk_score": 70,
    "reasons": ["半導體龍頭", "管理層穩定"],
    "summary": "公司基本面穩定，半導體板塊龍頭"
}
"""
    user_prompt = f"""公司: {stock_code} {name}

財務數據:
{json.dumps(financials, ensure_ascii=False, indent=2)}

最近新聞:
{news_text if news_text else "(冇新聞資料)"}

請評估呢間公司嘅業務模式、管理層、行業前景、風險 4 個維度 (0-100 分)。
"""

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    try:
        # 永久 rule (大少 2026-08-31 P1-9): LLM call 加 rate limit + timeout + exponential backoff retry
        # 之前撞 MiniMax/Kimi/Gemini rate limit 嗰陣, line 208 logger.error 然後 fallback 50 分, verdict 永遠平庸
        # 而家 rate limit detect + 4 次 retry + timeout handling, 大少睇到 LLM_RATE_LIMIT warning
        from backend.services.warning_collector import make_warning

        llm_warnings: list = []
        result = None
        max_retries = 4
        timeout_seconds = 30.0  # 30 秒 default

        for retry_attempt in range(max_retries):
            try:
                # 永久 rule P1-9: 用 asyncio.wait_for 加 timeout (避免 LLM hang 永久 block)
                async def _llm_call_with_timeout():
                    return await asyncio.wait_for(
                        asyncio.to_thread(
                            provider.chat_json,
                            messages,
                            temperature=0.3,
                        ),
                        timeout=timeout_seconds,
                    )
                result = await _llm_call_with_timeout()

                # 永久 rule P1-9: rate limit detection (MiniMax/Kimi/Gemini 返 429 或 rate_limit 字眼)
                if isinstance(result, dict) and (
                    result.get("error") in ("rate_limit_exceeded", "429")
                    or "rate limit" in str(result.get("error", "")).lower()
                ):
                    if retry_attempt < max_retries - 1:
                        wait_time = 1.0 * (2 ** retry_attempt)  # 1s, 2s, 4s exponential backoff
                        llm_warnings.append(make_warning(
                            level="warning",
                            module_id="M-AS02",
                            code="LLM_RATE_LIMIT",
                            message=f"LLM rate limit 撞 (attempt {retry_attempt+1}/{max_retries})",
                            issue=f"Provider 返 rate_limit, sleep {wait_time}s + retry",
                            impact="AS-02 verdict 暫時 fallback 50 分, retry 拎真實分",
                            fix="等 1-2 分鐘 Re-run / 切其他 LLM provider",
                        ).to_dict())
                        await asyncio.sleep(wait_time)
                        continue
                    # 最後一次 retry 失敗, emit warning 落 final return
                    llm_warnings.append(make_warning(
                        level="warning",
                        module_id="M-AS02",
                        code="LLM_RATE_LIMIT",
                        message=f"LLM rate limit 撞 (final attempt, 全部 retry 失敗)",
                        issue="Provider 返 rate_limit, 4 次 retry 都失敗",
                        impact="AS-02 verdict fallback 50 分, 唔可信",
                        fix="等幾分鐘 Re-run / 切其他 LLM provider",
                    ).to_dict())
                break
            except asyncio.TimeoutError:
                if retry_attempt < max_retries - 1:
                    wait_time = 1.0 * (2 ** retry_attempt)
                    logger.warning(f"[AS-02] {stock_code} LLM timeout (attempt {retry_attempt+1}/{max_retries}), retry")
                    await asyncio.sleep(wait_time)
                    continue
                logger.error(f"[AS-02] {stock_code} LLM timeout (final attempt, 全部 retry 失敗)")
                llm_warnings.append(make_warning(
                    level="warning",
                    module_id="M-AS02",
                    code="LLM_RATE_LIMIT",
                    message=f"LLM timeout > {timeout_seconds}s (final attempt, 全部 retry 失敗)",
                    issue=f"LLM hang 過 {timeout_seconds}s 4 次, 仍 fail",
                    impact="AS-02 verdict fallback 50 分, 唔可信",
                    fix="網絡慢 / 切其他 LLM provider / Re-run",
                ).to_dict())
                result = None
                break
            except Exception as e:
                err_str = str(e).lower()
                if "rate limit" in err_str or "429" in err_str or "exceed" in err_str:
                    if retry_attempt < max_retries - 1:
                        wait_time = 1.0 * (2 ** retry_attempt)
                        logger.warning(f"[AS-02] {stock_code} LLM rate limit exception (attempt {retry_attempt+1}), sleep {wait_time}s + retry")
                        await asyncio.sleep(wait_time)
                        continue
                logger.error(f"[AS-02] {stock_code} LLM call exception: {type(e).__name__}: {e}")
                result = None
                break

        if result is None:
            # Final fallback (rate limit / timeout 都 fail)
            return {
                "business_score": 50,
                "management_score": 50,
                "industry_score": 50,
                "risk_score": 50,
                "reasons": ["LLM call failed: rate limit / timeout (永久 rule P1-9 retry 4 次都失敗)"],
                "summary": "LLM 分析失敗，用 rule-based fallback",
                "_warnings": llm_warnings,
            }

        # Validate result
        if not isinstance(result, dict):
            raise ValueError(f"LLM result not dict: {result}")
        # Ensure all keys present
        for key in ("business_score", "management_score", "industry_score", "risk_score", "reasons", "summary"):
            if key not in result:
                result[key] = 50 if key.endswith("_score") else ([] if key == "reasons" else "No summary")
        if llm_warnings:
            result["_warnings"] = llm_warnings
        return result
    except Exception as e:
        logger.error(f"LLM call failed for {stock_code}: {e}")
        # Fallback: 全部 50 分
        return {
            "business_score": 50,
            "management_score": 50,
            "industry_score": 50,
            "risk_score": 50,
            "reasons": [f"LLM call failed: {e}"],
            "summary": "LLM 分析失敗，用 rule-based fallback",
        }


# ============================================================================
# Main Pipeline — 7 個 Step
# ============================================================================

async def analyze_stocks(stocks: list[str]) -> list[dict]:
    """
    跑 AS-02 pipeline 對一組股票 (1-10 隻).

    Returns list of dicts:
    {
        "code": "HK.00981",
        "name": "中芯國際",
        "classification": "qualified" / "disqualified",
        "score": 72.5,
        "breakdown": {...},
        "reasons": [...],
        "analysis_text": "...",
        "data_sources": ["FutuOpenD", "web_search"],
        "financial_data": {...},
    }
    """
    # Check active provider
    provider = get_active_provider()
    if provider is None:
        raise AS02Error("冇 active LLM provider, 請去 /settings 設定")

    # Run analysis for each stock (parallel)
    tasks = [analyze_one_stock(stock_code, provider) for stock_code in stocks]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Convert exceptions to DQ results
    final_results = []
    for stock_code, result in zip(stocks, results):
        if isinstance(result, Exception):
            logger.error(f"分析 {stock_code} 失敗: {result}")
            final_results.append({
                "code": stock_code,
                "name": "Unknown",
                "classification": "disqualified",
                "score": 0,
                "breakdown": {
                    "financial": 0,
                    "business": 0,
                    "management": 0,
                    "industry": 0,
                    "valuation": 0,
                    "risk": 0,
                },
                "reasons": [f"分析失敗: {result}"],
                "analysis_text": "",
                "data_sources": [],
                "financial_data": {},
            })
        else:
            final_results.append(result)

    return final_results


async def analyze_one_stock(stock_code: str, provider) -> dict:
    """Pipeline 7 個 step for 1 隻股票."""

    # ===== Step 1: Fetch 基本資料 =====
    snapshot = await asyncio.to_thread(fetch_snapshot, stock_code)
    if snapshot is None:
        return {
            "code": stock_code,
            "name": "Unknown",
            "classification": "disqualified",
            "score": 0,
            "breakdown": {
                "financial": 0,
                "business": 0,
                "management": 0,
                "industry": 0,
                "valuation": 0,
                "risk": 0,
            },
            "reasons": ["Stock 唔存在 / 停牌"],
            "analysis_text": "",
            "data_sources": [],
            "financial_data": {},
        }

    name = snapshot.get("name", stock_code)

    # ===== Step 2: Fetch financials + apply hard DQ trigger =====
    financials = await asyncio.to_thread(fetch_financials, stock_code)
    hard_dq_reasons = check_hard_dq_triggers(financials)

    if hard_dq_reasons:
        # 硬性 DQ trigger 觸發 → 即時 disqualified, 唔洗 LLM
        logger.info(f"[AS-02] {stock_code} hard DQ: {hard_dq_reasons}")
        return {
            "code": stock_code,
            "name": name,
            "classification": "disqualified",
            "score": 0,
            "breakdown": {
                "financial": 0,
                "business": 0,
                "management": 0,
                "industry": 0,
                "valuation": 0,
                "risk": 0,
            },
            "reasons": hard_dq_reasons,
            "analysis_text": "硬性 DQ trigger 觸發，唔符合基本投資條件",
            "data_sources": ["FutuOpenD"],
            "financial_data": financials,
        }

    # ===== Step 3: Web Search =====
    news = await asyncio.to_thread(search_stock_news, stock_code, name, max_results=5)
    news_text = format_news_for_llm(news)

    # ===== Step 4: LLM Analysis =====
    financial_score = calculate_financial_score(financials)
    valuation_score = calculate_valuation_score(financials)

    llm_result = await call_llm_analysis(provider, stock_code, name, financials, news_text)

    business_score = llm_result.get("business_score", 50)
    management_score = llm_result.get("management_score", 50)
    industry_score = llm_result.get("industry_score", 50)
    risk_score = llm_result.get("risk_score", 50)

    # ===== Step 5: Weighted Scoring =====
    # 永久 rule (大少 2026-08-31): 統一取 DIMENSION_WEIGHTS dict 計 total
    # 改之前 6 個 weight hardcoded 2 個地方 (decimal 0.30 + int 30), 改 weight 容易 drift
    # 改之後: build_as02_reason_html display 同 calc 永遠對齊 (改 dict 自動反映)
    total = sum(
        score * DIMENSION_WEIGHTS.get(key, 0) / 100
        for key, score in (
            ("financial", financial_score),
            ("business", business_score),
            ("management", management_score),
            ("industry", industry_score),
            ("valuation", valuation_score),
            ("risk", risk_score),
        )
    )

    classification = "qualified" if total >= 60 else "disqualified"

    # ===== Step 6 + 7: Log DQ (caller handles) + save if qualified (caller handles) =====
    return {
        "code": stock_code,
        "name": name,
        "classification": classification,
        "score": round(total, 1),
        "breakdown": {
            "financial": round(financial_score, 1),
            "business": round(business_score, 1),
            "management": round(management_score, 1),
            "industry": round(industry_score, 1),
            "valuation": round(valuation_score, 1),
            "risk": round(risk_score, 1),
        },
        "reasons": llm_result.get("reasons", []),
        "analysis_text": llm_result.get("summary", ""),
        "data_sources": ["FutuOpenD", "web_search"],
        "financial_data": financials,
        # 大少 2026-08-01 #9446: populate price/change_pct/mcap/turnover from fetch_snapshot
        # (Phase F fix 嘅 safe_get_snapshot 真係攞到 呢啲 fields from OpenD, 但之前 AS-02 spec
        # 唔 derive 入 return dict, save_run saved_stocks 永遠 0)
        "price": snapshot.get("price", 0),
        "change_pct": snapshot.get("change_pct", 0),
        "mcap": snapshot.get("mcap", 0),
        "turnover": snapshot.get("turnover", 0),
        "pe": snapshot.get("pe", 0),
        "pb": snapshot.get("pb", 0),
    }


# ============================================================================
# HTML Builder — 大少 2026-08-03 #9920 + UX update 2026-08-04
# AS-02 → stock_reasons.html 嘅 build function.
# Wrap 6-dim breakdown + reasons + summary + DQ trigger 落 structured HTML.
# IMPORTANT: Caller responsibility to call services/html_sanitizer.sanitize_html() before persist.
#
# 大少 2026-08-04 UX update: bar chart 取代 table + 中文 labels + 顏色 by score + 大字
# ============================================================================

# 大少 2026-08-04: 6 個維度嘅中文 labels (跟 AS-02 spec 嘅 30/20/15/15/10/10 weights)
DIMENSION_LABELS_ZH: dict[str, str] = {
    "financial": "財務健康",
    "business": "業務模式",
    "management": "管理層",
    "industry": "行業前景",
    "valuation": "估值",
    "risk": "風險",
}

DIMENSION_WEIGHTS: dict[str, int] = {
    "financial": 30,
    "business": 20,
    "management": 15,
    "industry": 15,
    "valuation": 10,
    "risk": 10,
}


def _score_class(score: float) -> str:
    """Map score (0-100) → CSS class for color (大少 2026-08-04 UX):
    ≥75 = score-high (綠), 60-74 = score-med (黃), <60 = score-low (紅).
    Note: bleach 會 strip inline style attribute, 所以用 class 而唔係 inline color.
    """
    if score >= 75:
        return "score-high"
    elif score >= 60:
        return "score-med"
    return "score-low"


def _width_class(value: float) -> str:
    """Round score (0-100) to nearest 10 → CSS class like 'w-70'.
    大少 2026-08-04 UX: bar chart width 用 class 控制 (10 個 bucket 足夠視覺分辨).
    """
    rounded = max(0, min(100, int(round(value / 10.0)) * 10))
    return f"w-{rounded}"


def build_as02_reason_html(result: dict) -> str:
    """
    [大少 #9920] Wrap AS-02 analysis result into HTML for stock_reasons.html storage.

    Args:
        result: AS-02 analyze_one_stock() return dict:
            {
                "code", "name", "classification", "score", "breakdown",
                "reasons", "analysis_text", "data_sources", "financial_data",
                "price", "change_pct", "mcap", "turnover", "pe", "pb"
            }

    Returns:
        Sanitized-safe HTML string. Caller must run sanitize_html() before DB insert.

    Display fields:
    - Title block: stock code + name + classification badge + score
    - Score breakdown table (6 dimensions: financial/business/management/industry/valuation/risk)
    - Hard DQ trigger section (if any)
    - LLM-derived reasons list
    - Analysis text summary
    - Stock snapshot (price/mcap/turnover/PE/PB) — 將來其他 report reuse

    大少 #9920: every new algorithm should have similar `build_<algo>_reason_html()` function
    following the same template structure.
    """
    code = result.get("code", "Unknown")
    name = result.get("name", "Unknown")
    classification = result.get("classification", "unknown")
    score = result.get("score", 0)
    breakdown = result.get("breakdown", {}) or {}
    reasons = result.get("reasons", []) or []
    analysis_text = result.get("analysis_text", "") or ""
    data_sources = result.get("data_sources", []) or []
    price = result.get("price", 0)
    change_pct = result.get("change_pct", 0)
    mcap = result.get("mcap", 0)
    turnover = result.get("turnover", 0)
    pe = result.get("pe", 0)
    pb = result.get("pb", 0)

    # 大少 2026-08-04: 6 個維度用 bar chart (中文 labels + 顏色 by score + class-based widths)
    breakdown_bars = ""
    for k, v in breakdown.items():
        if isinstance(v, (int, float)):
            label_zh = DIMENSION_LABELS_ZH.get(k, k)
            weight_pct = DIMENSION_WEIGHTS.get(k, 0)
            sclass = _score_class(v)  # score-high / score-med / score-low
            wcls = _width_class(v)    # w-10 ~ w-100 (rounded to nearest 10)
            breakdown_bars += (
                f'<div class="dim-row">'
                f'<span class="dim-label">{label_zh} '
                f'<small class="dim-weight">({weight_pct}%)</small></span>'
                f'<div class="dim-bar-bg"><div class="dim-bar-fill {sclass} {wcls}"></div></div>'
                f'<span class="dim-score {sclass}">{v:.1f}</span>'
                f'</div>'
            )

    # Reasons list
    if reasons:
        reasons_html = "<ul>" + "".join(f"<li>{r}</li>" for r in reasons) + "</ul>"
    else:
        reasons_html = "<p><em>(無)</em></p>"

    # Snapshot (price/mcap/etc) — only show if non-zero (avoid cluttering)
    snapshot_parts: list[str] = []
    if price > 0:
        snapshot_parts.append(f"<b>現價:</b> {price:.2f}")
    if change_pct != 0:
        snapshot_parts.append(f"<b>變幅:</b> {change_pct:+.2f}%")
    if mcap > 0:
        snapshot_parts.append(f"<b>市值:</b> {mcap / 1e9:.2f}B")
    if turnover > 0:
        snapshot_parts.append(f"<b>換手率:</b> {turnover:.2f}%")
    if pe > 0:
        snapshot_parts.append(f"<b>PE:</b> {pe:.2f}")
    if pb > 0:
        snapshot_parts.append(f"<b>PB:</b> {pb:.2f}")
    snapshot_html = " · ".join(snapshot_parts) if snapshot_parts else "(無實時數據)"

    # Data sources
    sources_html = ", ".join(data_sources) if data_sources else "(無)"

    # Classification badge color
    cls_class = "qualified" if classification == "qualified" else "disqualified"

    return f"""<div class="reason-report as02-report">
  <h3>{code} {name}</h3>
  <p>
    <b>綜合分數:</b> <span class="score">{score:.1f}</span> / 100
    &nbsp;|&nbsp;
    <span class="classification {cls_class}">{classification}</span>
  </p>
  <h4>評分明細 (6 個維度)</h4>
  <div class="dim-rows">{breakdown_bars}</div>
  <h4>主要觀察</h4>
  {reasons_html}
  <h4>總結</h4>
  <p>{analysis_text or '(無)'}</p>
  <h4>股票數據</h4>
  <p>{snapshot_html}</p>
  <h4>資料來源</h4>
  <p><small>{sources_html}</small></p>
</div>"""

"""
Web Search Service — 大少 2026-08-01 #9146

Scope: 為 AS-02 公司質素分析 攞股票新聞 / 公告 / 評論。

設計:
- 1 個 function `search_stock_news(stock_code, stock_name, max_results)`
- 返回 list of {title, url, snippet, source, date}
- Source: 將來用 Brave API / Google News (Phase 1.3 stub)

Phase 1.3 目標:
- 設計 interface
- 寫 1 個 placeholder implementation
- AS-02 orchestrator 將來會 call 呢個 function
"""
from __future__ import annotations
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def search_stock_news(
    stock_code: str,
    stock_name: str = "",
    max_results: int = 5,
) -> list[dict]:
    """
    搜尋股票相關新聞。

    Args:
        stock_code: e.g. 'HK.00981'
        stock_name: e.g. '中芯國際'
        max_results: max number of articles (default 5)

    Returns:
        list of dicts:
        [
            {"title": "...", "url": "...", "snippet": "...", "source": "...", "date": "..."},
            ...
        ]
    """
    # Phase 1.3 stub — 將來實作會 call Brave API / Google News
    logger.warning(
        "[web_search] stub implementation — Phase 1.3 basic shell, "
        "真實 API call 將來加 (Brave API ~$0.005/query)"
    )
    return [
        {
            "title": f"[stub] {stock_name or stock_code} 新聞",
            "url": "https://example.com/news",
            "snippet": f"Phase 1.3 stub — 將來真實 web search 結果",
            "source": "stub",
            "date": "2026-08-01",
        }
    ]


def format_news_for_llm(news_list: list[dict], max_chars: int = 4000) -> str:
    """
    Format news list into compact string for LLM context.

    Limit to max_chars to avoid blowing token budget.
    """
    if not news_list:
        return ""

    lines = [f"=== {len(news_list)} 篇新聞 ===", ""]
    total = 0
    for i, n in enumerate(news_list, 1):
        snippet = n.get("snippet", "")[:200]  # per-article cap
        line = f"{i}. [{n.get('date', 'unknown')}] {n['title']}\n   {snippet}\n   URL: {n.get('url', 'N/A')}\n"
        if total + len(line) > max_chars:
            lines.append(f"\n... ({len(news_list) - i + 1} 篇省略)")
            break
        lines.append(line)
        total += len(line)

    return "\n".join(lines)


# ============================================================================
# Phase 1.3 將來實作 plan
# ============================================================================
#
# 將來會加：
# - Brave Search API (https://brave.com/search/api/) — $0.005/query
# - Google News RSS (free)
# - HKEXnews 公告 (for Hong Kong stocks)
#
# 介面 signature 唔變，replace 個 implementation 就 OK。

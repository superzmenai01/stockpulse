"""
zh_normalize.py — A2 (大少 #7609) 永久 fix simplified/traditional split-brain

Single utility point for Chinese text normalization.
- Import 喺 populate scripts, model save functions, WS subscribe handlers
- 1-line per write call: `data['name'] = to_traditional(data.get('name', ''))`

History:
- 2026-07-26: 大少 #7609「做A2」confirm migrate + 1-line backend zhconv
- Migrated 4875 existing rows (4688 stocks + 187 plates) in 0.07s
- Future-proof: 任何新 write path 跟呢個 convention 自動 zhconv
"""
from zhconv import convert as _zh_convert
from functools import lru_cache
from typing import Optional, Any


@lru_cache(maxsize=10000)
def _to_traditional_cached(text: str) -> str:
    """Inner cached function — only accepts strings (lru_cache needs hashable)."""
    return _zh_convert(text, 'zh-tw')


def to_traditional(text: Optional[Any]) -> Optional[Any]:
    """
    Convert simplified Chinese → traditional Chinese (zh-tw).
    Pass-through if null/empty/non-string (e.g. list, int, dict).

    Usage:
        from utils.zh_normalize import to_traditional
        data['name'] = to_traditional(data.get('name', ''))

    Args:
        text: input (string expected, but non-string gracefully passed through)

    Returns:
        Traditional Chinese string, or original input if null/empty/non-string
    """
    # Gracefully handle non-string types (lru_cache requires hashable)
    if not isinstance(text, str) or not text:
        return text
    return _to_traditional_cached(text)


def to_traditional_batch(texts: list) -> list:
    """
    Batch convert for populating lists/tuples.
    Used by populate scripts that bulk-insert.

    Args:
        texts: list of strings (some may be None)

    Returns:
        list of normalized strings (same length)
    """
    return [to_traditional(t) for t in texts]
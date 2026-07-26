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
from typing import Optional


@lru_cache(maxsize=10000)
def to_traditional(text: Optional[str]) -> Optional[str]:
    """
    Convert simplified Chinese → traditional Chinese (zh-tw).
    Pass-through if null/empty/non-string.

    Usage:
        from utils.zh_normalize import to_traditional
        data['name'] = to_traditional(data.get('name', ''))

    Args:
        text: input string (may contain simplified Chinese)

    Returns:
        Traditional Chinese string, or original if null/empty
    """
    if not text or not isinstance(text, str):
        return text
    return _zh_convert(text, 'zh-tw')


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
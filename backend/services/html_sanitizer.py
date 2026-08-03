"""
services/html_sanitizer.py — HTML Sanitization for stock_reasons (大少 2026-08-03 #9920)

Centralized HTML sanitization to prevent XSS in reason popups.
- Uses bleach library (Python standard, ~150KB, no JS engine required)
- Allowlist of safe HTML tags + attributes
- Strips dangerous content: <script>, on* handlers, javascript: URLs, iframes
- Size limit enforced post-sanitize (50KB)

Caller responsibility: ALWAYS call sanitize_html() before persisting to stock_reasons.html
"""
from __future__ import annotations

import logging
import re
from typing import Final

import bleach

logger = logging.getLogger(__name__)

# 大少 #9920: 50KB post-sanitize size limit (跟 model/stock_reasons.py MAX_HTML_BYTES 一致)
MAX_HTML_BYTES: Final = 50_000

# Allowed tags — restricted set for reason reports
# Tables for score breakdowns, basic formatting, code/pre for data
ALLOWED_TAGS: Final[list[str]] = [
    "div", "span", "p", "br", "hr",
    "h1", "h2", "h3", "h4",
    "strong", "em", "b", "i", "u", "sub", "sup",
    "ul", "ol", "li",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
    "a",  # href restricted via ALLOWED_ATTRIBUTES
    "img",  # src restricted via ALLOWED_ATTRIBUTES
    "code", "pre", "blockquote",
    "small",  # for ⓘ notes etc
]

# Allowed attributes — strict per-element
ALLOWED_ATTRIBUTES: Final[dict[str, list[str]]] = {
    "*": ["class", "id"],  # 通用 class/id (for our own CSS styling)
    "a": ["href", "title", "target", "rel"],
    "img": ["src", "alt", "title", "width", "height"],
    "table": ["border"],
    "td": ["colspan", "rowspan"],
    "th": ["colspan", "rowspan", "scope"],
}

# Allowed URL schemes — block javascript:, data:, vbscript: etc
ALLOWED_PROTOCOLS: Final[list[str]] = ["http", "https", "mailto", "tel"]

# Truncation marker — when content exceeds size limit
TRUNCATION_MARKER: Final = "<!-- STOCKPULSE_REASON_TRUNCATED -->"

# Post-scrub patterns — bleach.strip=True 留低 disallowed tag 嘅 inner content,
# 要用 regex 二次 scrub 確保 nested / malformed attacks 都 strip 乾淨。
# 大少 #9920: defense-in-depth — bleach + regex 兩層。
_POST_SCRUB_PATTERNS: Final[list[tuple[re.Pattern[str], str]]] = [
    # 1. Strip tag-with-content (嵌套/畸形 HTML 嘅主要攻擊面)
    (re.compile(r"<script\b[^>]*>.*?</script\s*>", re.IGNORECASE | re.DOTALL), ""),
    (re.compile(r"<style\b[^>]*>.*?</style\s*>", re.IGNORECASE | re.DOTALL), ""),
    (re.compile(r"<iframe\b[^>]*>.*?</iframe\s*>", re.IGNORECASE | re.DOTALL), ""),
    (re.compile(r"<object\b[^>]*>.*?</object\s*>", re.IGNORECASE | re.DOTALL), ""),
    (re.compile(r"<embed\b[^>]*>.*?</embed\s*>", re.IGNORECASE | re.DOTALL), ""),
    # 2. Strip orphan tags (open/close 唔成對, nested attack 後遺)
    (re.compile(r"<\s*/?\s*script\b[^>]*>", re.IGNORECASE), ""),
    (re.compile(r"<\s*/?\s*style\b[^>]*>", re.IGNORECASE), ""),
    (re.compile(r"<\s*/?\s*iframe\b[^>]*>", re.IGNORECASE), ""),
    (re.compile(r"<\s*/?\s*object\b[^>]*>", re.IGNORECASE), ""),
    (re.compile(r"<\s*/?\s*embed\b[^>]*>", re.IGNORECASE), ""),
    # 3. Strip dangerous URL protocols
    (re.compile(r"\bjavascript\s*:", re.IGNORECASE), ""),
    (re.compile(r"\bvbscript\s*:", re.IGNORECASE), ""),
    (re.compile(r"\bdata\s*:\s*text/html", re.IGNORECASE), ""),
    # 4. Strip event handler attributes (bleach 應該已處理, defense-in-depth)
    (re.compile(r'\son\w+\s*=\s*"[^"]*"', re.IGNORECASE), ""),
    (re.compile(r"\son\w+\s*=\s*'[^']*'", re.IGNORECASE), ""),
]


def _post_scrub(html: str) -> str:
    """Run regex-based scrub on bleach-cleaned HTML for nested/malformed attacks."""
    for pattern, replacement in _POST_SCRUB_PATTERNS:
        html = pattern.sub(replacement, html)
    return html


def sanitize_html(html: str, max_bytes: int = MAX_HTML_BYTES) -> str:
    """
    Sanitize HTML for safe rendering in stock_reasons popup.

    Pipeline:
    1. bleach.clean() with allowlist (removes <script>, <iframe>, on* handlers, etc)
    2. Post-scrub regex patterns (defense-in-depth for nested/malformed attacks)
    3. 2nd bleach pass (idempotent, catches residual fragments)
    4. Size check (post-sanitize) — truncate if exceeds max_bytes, append marker

    Returns sanitized HTML string (always valid even on empty input).

    IMPORTANT: Caller MUST use this function before persisting to DB.
    Frontend also sanitizes (DOMPurify) for defense-in-depth.

    Known limitation (大少 #9920): bleach `strip=True` keeps inner content of disallowed tags
    as literal text. e.g. `<script>alert('XSS')</script>` → output retains `alert('XSS')` text
    (but the executable `<script>` context is gone, so the text is inert). Similarly
    `<style>body{display:none}</style>` retains `body{display:none}` text (no `<style>` context,
    so no CSS applied). Real XSS vectors use well-formed HTML where the tag context IS stripped
    — the residual literal text is harmless innerText. For extreme paranoia, render layer can
    use iframe sandbox for full isolation.
    """
    if not html or not isinstance(html, str):
        return ""

    try:
        sanitized = bleach.clean(
            html,
            tags=ALLOWED_TAGS,
            attributes=ALLOWED_ATTRIBUTES,
            protocols=ALLOWED_PROTOCOLS,
            strip=True,  # strip disallowed tags (vs escape)
            strip_comments=True,
        )
    except Exception as e:
        logger.error(f"[sanitize_html] bleach failed: {e}; returning empty string")
        return ""

    # Post-scrub — bleach strip=True 留低 disallowed tag 嘅 inner content,
    # 要 regex 二次 scrub 防 nested/malformed attacks (大少 #9920 defense-in-depth)
    sanitized = _post_scrub(sanitized)

    # 2nd bleach pass — idempotent, strips any residual fragments missed by post-scrub
    # (e.g. nested `<scr<script>ipt>` attacks where bleach 1st pass leaves `<scr`/`ipt>`)
    try:
        sanitized = bleach.clean(
            sanitized,
            tags=ALLOWED_TAGS,
            attributes=ALLOWED_ATTRIBUTES,
            protocols=ALLOWED_PROTOCOLS,
            strip=True,
            strip_comments=True,
        )
    except Exception as e:
        logger.error(f"[sanitize_html] 2nd bleach pass failed: {e}")

    # Post-sanitize size check
    byte_size = len(sanitized.encode("utf-8"))
    if byte_size > max_bytes:
        # Truncate at byte boundary (rough cut at character level to avoid broken UTF-8)
        truncated = sanitized.encode("utf-8")[:max_bytes].decode("utf-8", errors="ignore")
        # Trim back to last complete tag boundary if possible
        last_close = truncated.rfind("</")
        if last_close > max_bytes * 0.8:  # only trim if reasonable
            truncated = truncated[:last_close]
        logger.warning(
            f"[sanitize_html] truncated from {byte_size} bytes to "
            f"{len(truncated.encode('utf-8'))} bytes (max={max_bytes})"
        )
        return truncated + TRUNCATION_MARKER

    return sanitized


def is_html_safe(html: str) -> bool:
    """
    Quick check — does the HTML contain dangerous patterns?
    Used for input validation in API layer (fail fast before sanitize).
    Returns True if safe, False if contains obvious XSS patterns.

    Note: This is NOT a substitute for sanitize_html() — always run that for storage.
    """
    if not html:
        return True
    dangerous_patterns = [
        "<script", "</script",
        "javascript:", "vbscript:",
        "onerror=", "onload=", "onclick=", "onmouseover=",
        "<iframe", "</iframe>",
        "<object", "</object>",
        "<embed",
        "<style", "</style>",
        "data:text/html",
    ]
    lower = html.lower()
    return not any(p in lower for p in dangerous_patterns)
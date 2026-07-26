"""
StockPulse 板塊 Model
=====================

CRUD functions for `plate_leaders_options` table.

個 table 儲存 HK 板塊 + popularity 數據 (大少 instruction 2026-07-23):
- plate_code: e.g. "HK.LIST1001"
- plate_name: 板塊名, e.g. "半導體"
- market: 'HK' default
- is_active: 1=active, 0=disabled
- stock_count: 板塊有幾多股票 (OpenD get_plate_stock)
- volume_30d: 板塊總成交量 (snapshot sum)
- popularity_score: computed score
- popularity_rank: 1=最 popular
- popularity_updated_at: 最後 popularity 計算時間

Dependencies
------------
- sqlite3 (stdlib)
"""
import logging
from typing import Any, Callable, Optional
import json
import math
import os
import sqlite3
from pathlib import Path

# 大少 2026-07-24 08:57 feedback: Modular refactor 需要 helper 函數共用 RET_OK + OpenQuoteContext
# 之前 monolithic function-body 入面嘅 lazy import 攞唔到，移到 module-top level
from futu import OpenQuoteContext, RET_OK  # noqa: E402

# ============================================================================
# Logging
# ============================================================================
log = logging.getLogger(__name__)

# DB_PATH 同其他 model 一致 — 喺 backend/data/stocks.db
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'stocks.db')

# 大少 2026-07-25 22:04: 龍頭板塊 custom order file
# 存在 = 用 custom order (38 個), 不存在 = fallback 原本 ORDER BY
CUSTOM_ORDER_FILE = Path(__file__).parent.parent / "data" / "plate_custom_order.json"

# 大少 2026-07-26 08:36: 一鍵還原 immutable reference
# /api/plates/restore-default 從呢度讀 default → 寫返 custom_order.json
# 永遠唔可以改呢個 file (改咗會破壞 restore 功能)
IMMUTABLE_DEFAULT_FILE = Path(__file__).parent.parent / "data" / "plate_immutable_default.json"


def _load_custom_order() -> list[str] | None:
    """
    大少 2026-07-25 22:04 specified custom order.

    Returns:
        list of plate_code in 大少 specified order, or None if file not exists.
    """
    if not CUSTOM_ORDER_FILE.exists():
        return None
    try:
        with open(CUSTOM_ORDER_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        order = data.get("order", [])
        return order if order else None
    except Exception as e:
        log.warning("Failed to load custom order file: %s", e)
        return None


def is_current_order_default() -> bool:
    """
    大少 2026-07-26 08:36: 檢查 current custom order 係咪 = immutable default.

    Returns:
        True if 兩 file order list 完全一樣 (or custom file 唔存在).
        False if custom order 已經被改過.

    Used by:
    - GET /api/plates endpoint 加 is_default flag (前端 disable reset button)
    - POST /api/plates/restore-default 判斷 no-op
    """
    if not IMMUTABLE_DEFAULT_FILE.exists():
        # Immutable file missing = backend bug, 假設係 default (避免 disable button 永遠 disable)
        log.warning("IMMUTABLE_DEFAULT_FILE missing: %s", IMMUTABLE_DEFAULT_FILE)
        return True
    try:
        with open(IMMUTABLE_DEFAULT_FILE, "r", encoding="utf-8") as f:
            default_data = json.load(f)
        default_order = default_data.get("order", [])
    except Exception as e:
        log.warning("Failed to load immutable default: %s", e)
        return True

    current_order = _load_custom_order()
    if current_order is None:
        # 冇 custom file = fallback mode = "default" from user perspective
        return True
    return current_order == default_order


def get_connection() -> sqlite3.Connection:
    """Get SQLite connection (per-call, no pooling for simplicity)."""
    return sqlite3.connect(DB_PATH)


def init_plates_table() -> None:
    """
    創建 plate_leaders_options table (idempotent).

    同 backend/scripts/populate_plates.py 入面嘅 schema 一致.
    兩處 create 都係 IF NOT EXISTS, 冇衝突.

    Called from main.py 喺 startup, ensure table 存在.

    Migration (2026-07-24 大少 instruction):
    - 加 plate_type column (idempotent, 用 PRAGMA table_info check)
    - 加 idx_plate_type index (filter by type 快啲)
    """
    with get_connection() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS plate_leaders_options (
                plate_code TEXT PRIMARY KEY,
                plate_name TEXT NOT NULL,
                market TEXT NOT NULL DEFAULT 'HK',
                is_active INTEGER DEFAULT 1,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                stock_count INTEGER DEFAULT 0,
                volume_30d REAL DEFAULT 0,
                popularity_score REAL DEFAULT 0,
                popularity_rank INTEGER DEFAULT NULL,
                popularity_updated_at TIMESTAMP DEFAULT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_plate_active ON plate_leaders_options(is_active);
            CREATE INDEX IF NOT EXISTS idx_plate_market ON plate_leaders_options(market);
            CREATE INDEX IF NOT EXISTS idx_plate_popularity ON plate_leaders_options(popularity_rank);
        """)
        conn.commit()

    # Migration: 加 plate_type column (大少 2026-07-24 instruction)
    # Idempotent: PRAGMA table_info check, 已存在就 skip
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(plate_leaders_options)")
        existing_cols = {row[1] for row in cursor.fetchall()}
        if "plate_type" not in existing_cols:
            # SQLite ADD COLUMN 必須有 DEFAULT value (NOT NULL constraint)
            # 先用 DEFAULT 'stock' 填, 然後 ALTER TABLE
            conn.execute(
                "ALTER TABLE plate_leaders_options "
                "ADD COLUMN plate_type TEXT NOT NULL DEFAULT 'stock'"
            )
            conn.commit()
            log.info("Migration: added plate_type column ✓")
        else:
            log.debug("plate_type column already exists, skip migration")

        # Index (冇就加, idempotent)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_plate_type "
            "ON plate_leaders_options(plate_type)"
        )
        conn.commit()


# ============================================================================
# Plate type classification (大少 2026-07-24 instruction)
# ============================================================================

# Plate type values (放入 database plate_type column)
PLATE_TYPE_STOCK = "stock"          # 真係 stock 嘅 plate (行業/概念, e.g. 半導體、AI、金融)
PLATE_TYPE_INDEX = "index"          # 指數類 (e.g. 恒生指數、納指)
PLATE_TYPE_ETF = "etf"              # ETF (e.g. 盈富、A50)
PLATE_TYPE_REIT = "reit"            # REIT (e.g. 領展、置富)
PLATE_TYPE_BOND = "bond"            # 債券 (e.g. 國債 ETF)
PLATE_TYPE_WARRANT = "warrant"      # 窩輪/牛熊/認股證
PLATE_TYPE_STRUCTURED = "structured"  # 其他結構性產品

# 對應 list (給前端 / API filter 用)
NON_STOCK_TYPES = [
    PLATE_TYPE_INDEX,
    PLATE_TYPE_ETF,
    PLATE_TYPE_REIT,
    PLATE_TYPE_BOND,
    PLATE_TYPE_WARRANT,
    PLATE_TYPE_STRUCTURED,
]

# Classification keywords (first-match wins)
# Order matters: 較 specific 嘅 type 先 check
PLATE_TYPE_KEYWORDS: list[tuple[str, str]] = [
    # 指數類 (priority 高, 例如「恒生指數 ETF」首先歸 index)
    (PLATE_TYPE_INDEX, "指數"),
    (PLATE_TYPE_INDEX, "指数"),
    (PLATE_TYPE_INDEX, "Index"),
    (PLATE_TYPE_INDEX, "INDEX"),
    # 窩輪/牛熊/認股證 (derivative, 唔係 stock)
    (PLATE_TYPE_WARRANT, "窩輪"),
    (PLATE_TYPE_WARRANT, "牛熊"),
    (PLATE_TYPE_WARRANT, "認股證"),
    (PLATE_TYPE_WARRANT, "權證"),
    (PLATE_TYPE_WARRANT, "Warrant"),
    (PLATE_TYPE_WARRANT, "CBBC"),
    # 債券
    (PLATE_TYPE_BOND, "債券"),
    (PLATE_TYPE_BOND, "债券"),
    (PLATE_TYPE_BOND, "Bond"),
    (PLATE_TYPE_BOND, "BOND"),
    (PLATE_TYPE_BOND, "Debt"),
    # REIT
    (PLATE_TYPE_REIT, "REIT"),
    (PLATE_TYPE_REIT, "Reit"),
    (PLATE_TYPE_REIT, "信託"),
    (PLATE_TYPE_REIT, "信托"),
    (PLATE_TYPE_REIT, "Trust"),
    # ETF / 基金 (after REIT 因為 REIT 較 specific)
    (PLATE_TYPE_ETF, "ETF"),
    (PLATE_TYPE_ETF, "ETN"),
    (PLATE_TYPE_ETF, "交易所買賣基金"),
    (PLATE_TYPE_ETF, "基金"),
    (PLATE_TYPE_ETF, "Fund"),
    (PLATE_TYPE_ETF, "FUND"),
    # 結構性產品 (catch-all)
    (PLATE_TYPE_STRUCTURED, "結構性"),
    (PLATE_TYPE_STRUCTURED, "Structured"),
]


def classify_plate_type(plate_name: str) -> str:
    """
    根據 plate 名 classify type (大少 2026-07-24 instruction).

    用 first-match wins 邏輯, order 由 PLATE_TYPE_KEYWORDS 決定.
    冇 match 就 default 'stock' (即係真正 stock 板塊).

    Args:
        plate_name: e.g. "半導體" / "恒生指數" / "盈富基金" / "領展房託"

    Returns:
        plate_type string (e.g. "stock" / "index" / "etf" / "reit" / "bond" / "warrant" / "structured")

    Examples:
        >>> classify_plate_type("半導體")
        'stock'
        >>> classify_plate_type("恒生指數")
        'index'
        >>> classify_plate_type("盈富基金")
        'etf'
        >>> classify_plate_type("領展房託 REIT")
        'reit'
    """
    for plate_type, keyword in PLATE_TYPE_KEYWORDS:
        if keyword in plate_name:
            return plate_type
    return PLATE_TYPE_STOCK


def get_top_plates(limit: int = 50, include_non_stock: bool = True) -> list[dict[str, Any]]:
    """
    攞 top N plates by 大少 2026-07-25 22:04 custom order (default).

    Behavior:
        1. 如有 plate_custom_order.json → 用 38 個 custom order (CASE WHEN)
        2. 如冇 → fallback 原本 ORDER BY (popularity_rank + stock_count + code)

    大少 2026-07-25 22:04 instruction: 跟指定 order, 未指定嘅 random.
    一鍵還原 = DELETE /api/plates/restore-default (刪 custom order file).

    Args:
        limit: max plates to return (1-275)
        include_non_stock: False = 只 return 'stock' type,
                          True = return all types

    Returns:
        list of dict, each with keys: plate_code, plate_name, market, stock_count,
        volume_30d, popularity_score, popularity_rank, popularity_updated_at, plate_type
    """
    # ① 讀 custom order (如有)
    custom_codes = _load_custom_order()

    if custom_codes:
        # Custom order mode (大少 2026-07-25 22:04 specified)
        case_parts = []
        for i, code in enumerate(custom_codes, 1):
            # escape single quote (防 SQL injection, 雖然 plate_code 來自 OpenD)
            escaped = code.replace("'", "''")
            case_parts.append(f"WHEN '{escaped}' THEN {i}")
        # ELSE 999 → 38 個 specified 排先, 餘下 fallback plate_code ASC
        custom_order_sql = (
            "CASE plate_code\n          "
            + "\n          ".join(case_parts)
            + "\n          ELSE 999\n        END ASC,\n        plate_code ASC"
        )
        order_clause = custom_order_sql
    else:
        # Original ORDER BY (popularity_rank + stock_count)
        order_clause = """
        CASE WHEN popularity_rank IS NULL THEN 1 ELSE 0 END,
        popularity_rank ASC,
        stock_count DESC"""

    if include_non_stock:
        # No type filter — return everything
        type_clause = ""
        params: tuple[Any, ...] = (limit,)
    else:
        # Filter stock only (default) — 用 NOT IN 排除所有 non-stock types
        placeholders = ",".join("?" * len(NON_STOCK_TYPES))
        type_clause = f"AND plate_type NOT IN ({placeholders}) "
        params = (*NON_STOCK_TYPES, limit)

    with get_connection() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(
            f"""
            SELECT plate_code, plate_name, market, stock_count, volume_30d,
                   popularity_score, popularity_rank, popularity_updated_at, plate_type
            FROM plate_leaders_options
            WHERE is_active = 1
            {type_clause}
            ORDER BY
              {order_clause}
            LIMIT ?
            """,
            params,
        )
        return [dict(row) for row in cursor.fetchall()]


def search_plates(query: str, limit: int = 50, include_non_stock: bool = True) -> list[dict[str, Any]]:
    """
    Search plates by name (case-insensitive partial match, 簡↔繁 auto-convert).

    Result sort:
    1. Ranked plates 先 (ORDER BY popularity_rank ASC, NULL 排後)
    2. Unranked plates 後 (但有 match)

    簡↔繁 normalize (大少 2026-07-23):
    - OpenD 返嘅 plate name 用簡體 (e.g. "半导体")
    - 但 user 可能打繁體 (e.g. "半導體")
    - 所以 query 同時 LIKE 簡+繁 versions, 邊個都中
    - 用 zhconv 套件做轉換 (pip install zhconv)

    大少 2026-07-24 instruction: 預設 filter 走 non-stock plate.
    Frontend 有 toggle 控制是否 include.

    Args:
        query: 搜尋 keyword, e.g. "半導體" 或 "半导体" 都會中
        limit: max plates to return
        include_non_stock: False = 只 return 'stock' type (default),
                          True = return all types

    Returns:
        list of dict, 格式同 get_top_plates (多咗 plate_type field)
    """
    # 簡↔繁 雙向 query
    # zhconv import 喺 function 入面做 (避免 module load 慢)
    import zhconv
    q_simple = zhconv.convert(query, "zh-cn")  # 簡體
    q_trad = zhconv.convert(query, "zh-tw")    # 繁體
    # 去重 (如果 query 入面已經係簡體, 兩 versions 會一樣)
    patterns = list({f"%{q_simple}%", f"%{q_trad}%"})

    # Build WHERE clauses
    # 1. Name LIKE clause
    name_clauses = " OR ".join(["plate_name LIKE ?"] * len(patterns))
    params: list[Any] = [*patterns]

    # 2. Type filter (大少 2026-07-24)
    if not include_non_stock:
        placeholders = ",".join("?" * len(NON_STOCK_TYPES))
        type_clause = f"AND plate_type NOT IN ({placeholders}) "
        params.extend(NON_STOCK_TYPES)
    else:
        type_clause = ""

    params.append(limit)

    sql = f"""
        SELECT plate_code, plate_name, market, stock_count, volume_30d,
               popularity_score, popularity_rank, popularity_updated_at, plate_type
        FROM plate_leaders_options
        WHERE ({name_clauses}) AND is_active = 1
        {type_clause}
        ORDER BY
            CASE WHEN popularity_rank IS NULL THEN 1 ELSE 0 END,
            popularity_rank ASC,
            stock_count DESC
        LIMIT ?
    """
    with get_connection() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(sql, tuple(params))
        return [dict(row) for row in cursor.fetchall()]


def get_popularity_status() -> dict[str, Any]:
    """
    Get popularity calc status: 總 plate 數 / 已 rank 數 / 最後更新時間.

    用嚟 display 喺 UI 嘅 "Last updated: 2026-07-23 08:30" + "Refresh" button state.
    """
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN popularity_rank IS NOT NULL THEN 1 ELSE 0 END) AS ranked,
                   MAX(popularity_updated_at) AS last_updated
            FROM plate_leaders_options
        """)
        row = cursor.fetchone()
        return {
            "total": row[0] or 0,
            "ranked": row[1] or 0,
            "last_updated": row[2],
        }


def get_all_plates_count() -> int:
    """Get total active plates count (for UI 顯示 'search 全部 275 個')."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM plate_leaders_options WHERE is_active = 1")
        return int(cursor.fetchone()[0])
# ============================================================================
# AS-01 板塊龍頭股 ranking (run logic)
# ============================================================================

def format_mcap(mcap: float) -> str:
    """
    Format market cap 為 億/萬億 中文格式 (大少 SPEC: "市值 top 1 (4500億)").

    NaN / None / invalid → 返 "—" (defensive — 大少 2026-07-23 fix,
    因為 format_mcap(NaN) 之前 int(NaN) raise ValueError crash 成個 run_plate_leaders).

    Args:
        mcap: market cap in HKD (e.g. 450000000000 = 4500 億), or NaN/None

    Returns:
        formatted string, e.g. "4500億" / "1.2萬億" / "800萬" / "—"
    """
    # Defensive: handle NaN / None (大少 2026-07-23 option B + D)
    if mcap is None or (isinstance(mcap, float) and math.isnan(mcap)):
        return "—"
    try:
        if mcap >= 1e12:  # 1 萬億
            return f"{mcap / 1e12:.1f}萬億"
        if mcap >= 1e8:   # 1 億
            return f"{int(mcap / 1e8)}億"
        if mcap >= 1e4:   # 1 萬
            return f"{int(mcap / 1e4)}萬"
        return f"{int(mcap)}"
    except (ValueError, TypeError):
        return "—"


def is_etf_or_structured(code: str, snapshots: Optional[dict[str, Any]] = None) -> bool:
    """
    Check if stock code 屬於 ETF / 結構性產品 (大少 2026-07-25 fix).

    之前 code-prefix heuristic 太 aggressive (誤殺 13 隻真 chip stocks:
    02149 貝克微, 02533 黑芝麻智能, 09660 地平綫機器人-W 等)。

    新邏輯 (大少 2026-07-25 指示):
    - 用 OpenD `get_market_snapshot` 嘅 valid flags 判斷 (per 大少 breakthrough):
      • equity_valid=True + 其他 False → 真 stock (keep)
      • wrt_valid=True / trust_valid=True / index_valid=True / future_valid=True → drop
      • equity_valid=False + 冇其他 valid flag → drop (unknown type)
    - Fallback: 如果冇提供 snapshots, 用舊 code-prefix heuristic
      (e.g. 4 位 stock code 冇 flag data)

    Args:
        code: e.g. 'HK.02807' / 'HK.00700'
        snapshots: optional dict {code: snapshot_row_dict} from _fetch_snapshots()
                   if None, fallback to code-prefix heuristic

    Returns:
        True if ETF / 結構性 / 窩輪 / REIT / 指數 / 期貨, False if 真 stock
    """
    # New path: use OpenD valid flags if snapshots available
    if snapshots is not None:
        row = snapshots.get(code)
        if row is not None:
            wrt = bool(row.get("wrt_valid", False))
            trust = bool(row.get("trust_valid", False))
            idx = bool(row.get("index_valid", False))
            future = bool(row.get("future_valid", False))
            equity = bool(row.get("equity_valid", False))

            if wrt or trust or idx or future:
                return True
            if not equity:
                return True  # Unknown type without equity_valid flag
            return False  # 真 stock

    # Fallback: code-prefix heuristic (legacy)
    num = code.split('.')[-1]
    if len(num) != 5:
        return False  # 4位 = 普通股
    if num.startswith(('02', '03', '8')):
        return True
    if num.startswith('09') and num[2] != '9':  # 090xx-098xx = U 版本
        return True
    return False


# ============================================================================
# AS-01 Modular helpers (大少 2026-07-24 08:57 feedback: 模組塊架構)
# 每個 helper 一個 responsibility (Single Responsibility Principle)
# ============================================================================

def _resolve_plate_stocks(
    ctx: Any,
    plate_code: str,
    debug_log: Optional[Callable[[str, dict[str, Any]], None]] = None,
) -> list[str]:
    """
    [STEP 1] 攞取板塊內所有股票 codes。
    - OpenD `get_plate_stock(plate_code)` 返 stock code list
    - 失敗/exception 返 [] 並 log warning

    debug_log: optional callback(step_name, data_dict) for instrumentation
    """
    if debug_log:
        debug_log("resolve_plate_stocks_start", {"plate_code": plate_code})
    try:
        ret, data = ctx.get_plate_stock(plate_code)
        if ret != RET_OK:
            log.warning(f"_resolve_plate_stocks({plate_code}) failed: {data}")
            if debug_log:
                debug_log("resolve_plate_stocks_failed", {"plate_code": plate_code, "error": str(data)})
            return []
        result = [str(code) for code in data["code"]]
        if debug_log:
            debug_log(
                "resolve_plate_stocks_end",
                {
                    "plate_code": plate_code,
                    "count": len(result),
                    "stocks": result,  # 大少 2026-07-24 Detail Mode: 完整股票 list
                },
            )
        return result
    except Exception as e:
        log.warning(f"_resolve_plate_stocks({plate_code}) exception: {e}")
        if debug_log:
            debug_log("resolve_plate_stocks_exception", {"plate_code": plate_code, "error": str(e)})
        return []


def _filter_etf_structured(
    snapshots: dict[str, dict[str, Any]],
    debug_log: Optional[Callable[[str, dict[str, Any]], None]] = None,
) -> list[str]:
    """
    [STEP 2] 過濾 ETF / 結構性產品 / 窩輪 / REIT / 指數 / 期貨 (大少 2026-07-25 fix).

    改用 OpenD `get_market_snapshot` 嘅 valid flags 而唔係 code-prefix heuristic。
    之前 code-prefix 過 aggressive, 誤殺 13 隻真 chip stocks (02149 貝克微, 02533 黑芝麻智能,
    02658 天域半導體, 09660 地平綫機器人-W 等)。

    新邏輯 (per 大少 breakthrough):
    - equity_valid=True + 其他 (wrt/trust/index/future) False → 真 stock (keep)
    - wrt_valid=True → 窩輪 (drop)
    - trust_valid=True → REIT (drop)
    - index_valid=True → 指數 (drop)
    - future_valid=True → 期貨 (drop)
    - equity_valid=False + 冇其他 valid flag → drop (unknown type)

    Args:
        snapshots: {code: snapshot_row_dict} 從 _fetch_snapshots()
        debug_log: optional callback(step_name, data_dict)

    Returns:
        list of stock codes 屬於真 stock (普通股)
    """
    kept: list[str] = []
    dropped_by_type: dict[str, list[dict[str, Any]]] = {
        "warrant": [],
        "reit": [],
        "index": [],
        "future": [],
        "unknown": [],
    }

    for code, row in snapshots.items():
        if row is None:
            continue
        wrt = bool(row.get("wrt_valid", False))
        trust = bool(row.get("trust_valid", False))
        idx = bool(row.get("index_valid", False))
        future = bool(row.get("future_valid", False))
        equity = bool(row.get("equity_valid", False))

        if wrt:
            dropped_by_type["warrant"].append({"code": code, "name": str(row.get("name", ""))})
        elif trust:
            dropped_by_type["reit"].append({"code": code, "name": str(row.get("name", ""))})
        elif idx:
            dropped_by_type["index"].append({"code": code, "name": str(row.get("name", ""))})
        elif future:
            dropped_by_type["future"].append({"code": code, "name": str(row.get("name", ""))})
        elif not equity:
            dropped_by_type["unknown"].append({"code": code, "name": str(row.get("name", ""))})
        else:
            kept.append(code)

    total_dropped = sum(len(v) for v in dropped_by_type.values())
    if total_dropped > 0:
        log.debug(
            f"_filter_etf_structured (v2): kept {len(kept)}, dropped {total_dropped} "
            f"(warrant={len(dropped_by_type['warrant'])}, reit={len(dropped_by_type['reit'])}, "
            f"index={len(dropped_by_type['index'])}, future={len(dropped_by_type['future'])}, "
            f"unknown={len(dropped_by_type['unknown'])})"
        )
    if debug_log:
        debug_log(
            "filter_etf_structured_v2",
            {
                "input_count": len(snapshots),
                "kept_count": len(kept),
                "kept": kept,
                "dropped_by_type": dropped_by_type,
                "dropped_reason": "OpenD valid flags (wrt/trust/index/future/non-equity)",
            },
        )
    return kept


def _lookup_plate_name(
    plate_code: str,
    debug_log: Optional[Callable[[str, dict[str, Any]], None]] = None,
) -> str:
    """
    Lookup plate_name by plate_code from DB (plate_leaders_options table).

    Falls back to plate_code if not found.

    debug_log: optional callback(step_name, data_dict)
    """
    if debug_log:
        debug_log("lookup_plate_name_start", {"plate_code": plate_code})
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT plate_name FROM plate_leaders_options WHERE plate_code = ?",
            (plate_code,),
        )
        row = cursor.fetchone()
        result = row[0] if row else plate_code
    if debug_log:
        debug_log("lookup_plate_name_end", {"plate_code": plate_code, "plate_name": result})
    return result


def _fetch_snapshots(
    ctx: Any,
    stocks: list[str],
    batch_size: int = 400,
    debug_log: Optional[Callable[[str, dict[str, Any]], None]] = None,
) -> dict[str, dict[str, Any]]:
    """
    [STEP 4] Batch fetch 報價 (OpenD get_market_snapshot)。
    - 對 stock list 逐 batch 攞報價 (max 400 codes/batch, OpenD 限制)
    - 返回 {code: snapshot_dict}
    - 失敗 batch skip (log warning)，繼續 process 其他 batch

    debug_log: optional callback(step_name, data_dict)
    """
    if debug_log:
        debug_log(
            "fetch_snapshots_start",
            {"total_stocks": len(stocks), "batches": (len(stocks) + batch_size - 1) // batch_size},
        )
    snapshots: dict[str, dict[str, Any]] = {}
    failed_codes: list[str] = []  # 大少 2026-07-24 Detail Mode: 哪些 stock 報價 fail
    failed_batches = 0
    for i in range(0, len(stocks), batch_size):
        batch = stocks[i : i + batch_size]
        try:
            ret, data = ctx.get_market_snapshot(batch)
            if ret != RET_OK:
                log.warning(
                    f"_fetch_snapshots batch [{i}:{i + len(batch)}] failed: {data}"
                )
                failed_batches += 1
                failed_codes.extend(batch)  # 大少 Detail Mode
                continue
            for _, row in data.iterrows():
                snapshots[str(row["code"])] = row.to_dict()
        except Exception as e:
            log.warning(
                f"_fetch_snapshots batch [{i}:{i + len(batch)}] exception: {e}"
            )
            failed_batches += 1
            failed_codes.extend(batch)
    if debug_log:
        debug_log(
            "fetch_snapshots_end",
            {
                "success_count": len(snapshots),
                "failed_batches": failed_batches,
                "failed_codes": failed_codes,  # 大少 Detail Mode
                "missing_count": len(failed_codes),
            },
        )
    return snapshots


def _filter_valid_stocks(
    snapshots: dict[str, dict[str, Any]],
    stocks: list[str],
    debug_log: Optional[Callable[[str, dict[str, Any]], None]] = None,
) -> list[dict[str, Any]]:
    """
    [STEP 5] 過濾無用 stocks (suspended / NaN / 0 mcap / 0 turnover)。
    - 保留: 有報價 + 非停牌 + mcap > 0 + turnover ≠ NaN
    - 踢走原因:
      • no_snapshot: OpenD 返唔到報價
      • suspended: 停牌股
      • mcap_invalid: mcap NaN 或 ≤ 0 (通常 ETF 或新上市)
      • turnover_invalid: turnover NaN (pre-market 都接受 0，咁先唔會 skip 太多)

    Returns list of valid stock dicts (without plate_code/plate_name — filled by caller).

    debug_log: optional callback(step_name, data_dict)
    """
    if debug_log:
        debug_log("filter_valid_stocks_start", {"input_count": len(stocks)})
    valid: list[dict[str, Any]] = []
    skip_stats: dict[str, int] = {
        "no_snapshot": 0,
        "suspended": 0,
        "mcap_invalid": 0,
        "turnover_invalid": 0,
    }
    # 大少 2026-07-24 Detail Mode: per-reason stock list + values
    dropped_by_reason: dict[str, list[dict[str, Any]]] = {
        "no_snapshot": [],
        "suspended": [],
        "mcap_invalid": [],
        "turnover_invalid": [],
    }
    for code in stocks:
        row = snapshots.get(code)
        if row is None:
            skip_stats["no_snapshot"] += 1
            dropped_by_reason["no_snapshot"].append({"code": code, "reason": "OpenD 返唔到報價"})
            continue
        if row.get("suspension", False):
            skip_stats["suspended"] += 1
            dropped_by_reason["suspended"].append({"code": code, "name": str(row.get("name", "")), "reason": "停牌"})
            continue
        mcap = row.get("total_market_val", 0) or 0
        turnover = row.get("turnover", 0) or 0

        mcap_is_nan = isinstance(mcap, float) and math.isnan(mcap)
        turnover_is_nan = isinstance(turnover, float) and math.isnan(turnover)
        mcap_invalid = (
            (not isinstance(mcap, (int, float))) or mcap_is_nan or mcap <= 0
        )
        # 大少 2026-07-24 09:03 fix: 唔再 skip turnover ≤ 0 (pre-market 9:00-9:30 / off-hours 都 0)
        # 之前過濾太嚴 → 大少完全睇唔到 ranking。
        # 開市後 turnover 有 value, ranking 自然會精準。
        # NaN check 仍然保留 (避免 comparison error)。
        turnover_invalid = (
            (not isinstance(turnover, (int, float)))
            or turnover_is_nan
        )

        if mcap_invalid:
            skip_stats["mcap_invalid"] += 1
            reason_str = "NaN" if mcap_is_nan else f"mcap={mcap:.0f} ≤ 0"
            dropped_by_reason["mcap_invalid"].append({"code": code, "name": str(row.get("name", "")), "mcap": float(mcap) if isinstance(mcap, (int, float)) and not mcap_is_nan else "NaN", "reason": reason_str})
            continue
        if turnover_invalid:
            skip_stats["turnover_invalid"] += 1
            dropped_by_reason["turnover_invalid"].append({"code": code, "name": str(row.get("name", "")), "turnover": "NaN", "reason": "turnover NaN"})
            continue

        valid.append({
            "code": code,
            "name": str(row.get("name", "")),
            "price": float(row.get("last_price", 0) or 0),
            "change_pct": float(row.get("change_rate", 0) or 0),
            "mcap": float(mcap),
            "turnover": float(turnover),
        })

    total_skipped = sum(skip_stats.values())
    if total_skipped > 0:
        # 單個 warning log per call (避免 spam, 但明確 debug info)
        log.warning(
            f"_filter_valid_stocks: valid={len(valid)}/{len(stocks)}, skipped={total_skipped} "
            f"(no_snapshot={skip_stats['no_snapshot']}, suspended={skip_stats['suspended']}, "
            f"mcap_invalid={skip_stats['mcap_invalid']}, turnover_invalid={skip_stats['turnover_invalid']})"
        )
    if debug_log:
        debug_log(
            "filter_valid_stocks_end",
            {
                "input_count": len(stocks),
                "valid_count": len(valid),
                "skip_stats": skip_stats.copy(),
                # 大少 2026-07-24 Detail Mode: 每個 skip reason 嘅完整 stock list
                "kept": [{"code": v["code"], "name": v["name"], "mcap": v["mcap"], "turnover": v["turnover"]} for v in valid],
                "dropped_by_reason": dropped_by_reason,
            },
        )
    return valid


def _rank_and_score(
    valid: list[dict[str, Any]],
    debug_log: Optional[Callable[[str, dict[str, Any]], None]] = None,
) -> list[dict[str, Any]]:
    """
    Calculate mcap_rank (desc) + volume_rank (desc) + composite score for each stock.

    Mutates valid list in place (adds mcap_rank, volume_rank, score fields).
    Returns valid list for chaining.

    debug_log: optional callback(step_name, data_dict)
    """
    if debug_log:
        debug_log("rank_and_score_start", {"valid_count": len(valid)})
    sorted_by_mcap = sorted(valid, key=lambda x: -x["mcap"])
    for rank, item in enumerate(sorted_by_mcap, 1):
        item["mcap_rank"] = rank

    sorted_by_volume = sorted(valid, key=lambda x: -x["turnover"])
    for rank, item in enumerate(sorted_by_volume, 1):
        item["volume_rank"] = rank

    for item in valid:
        item["score"] = item["mcap_rank"] + item["volume_rank"]

    if debug_log and valid:
        scores = [item["score"] for item in valid]
        debug_log(
            "rank_and_score_end",
            {
                "count": len(valid),
                "score_min": min(scores),
                "score_max": max(scores),
            },
        )
    elif debug_log:
        debug_log("rank_and_score_end", {"count": 0, "score_min": None, "score_max": None})
    return valid


def _generate_reason(
    item: dict[str, Any],
    debug_log: Optional[Callable[[str, dict[str, Any]], None]] = None,
) -> str:
    """Generate reason string for a leader based on rank and metrics.

    debug_log: optional callback(step_name, data_dict) — only logs per-item if provided
    """
    parts = []
    if item["mcap_rank"] == 1:
        parts.append(f"市值 top 1 ({format_mcap(item['mcap'])})")
    elif item["mcap_rank"] <= 3:
        parts.append(f"市值 #{item['mcap_rank']}")
    if item["volume_rank"] == 1:
        parts.append("成交 top 1")
    elif item["volume_rank"] <= 3:
        parts.append(f"成交 #{item['volume_rank']}")
    result = " / ".join(parts) if parts else f"綜合 #{item['mcap_rank']}+#{item['volume_rank']}"
    if debug_log:
        debug_log(
            "generate_reason",
            {"code": item.get("code", "?"), "reason": result},
        )
    return result


def _rank_one_plate(
    ctx: Any,
    plate_code: str,
    top_n: int,
    plate_name_cache: dict[str, str],
    debug_log: Optional[Callable[[str, dict[str, Any]], None]] = None,
) -> list[dict[str, Any]]:
    """
    Per-plate orchestrator: rank one plate independently using helper blocks.

    Pipeline (each step = one helper):
        1. _resolve_plate_stocks
        2. _filter_etf_structured
        3. _lookup_plate_name (cache)
        4. _fetch_snapshots
        5. _filter_valid_stocks
        6. _rank_and_score
        7. sort by score ASC → top N
        8. fill plate_code + plate_name + reason

    Returns list of top N leader dicts (or [] if any step fails).
    Each leader dict has all standard fields + plate_code + plate_name.

    debug_log: optional callback(step_name, data_dict) — propagated to all sub-helpers
    """
    if debug_log:
        debug_log("rank_one_plate_start", {"plate_code": plate_code, "top_n": top_n})
    # Step 1: Resolve
    raw_stocks = _resolve_plate_stocks(ctx, plate_code, debug_log=debug_log)
    if not raw_stocks:
        log.warning(f"_rank_one_plate: {plate_code} no stocks from OpenD")
        if debug_log:
            debug_log("rank_one_plate_empty", {"plate_code": plate_code, "step": "resolve"})
        return []

    # Step 3: Lookup plate_name (cache) — moved up before fetch
    if plate_code not in plate_name_cache:
        plate_name_cache[plate_code] = _lookup_plate_name(plate_code, debug_log=debug_log)
    plate_name = plate_name_cache[plate_code]

    # Step 4: Fetch snapshots — moved up (now BEFORE ETF filter)
    # 大少 2026-07-25 fix: 需要 snapshots 嘅 valid flags 嚟 classify
    snapshots = _fetch_snapshots(ctx, raw_stocks, debug_log=debug_log)
    if not snapshots:
        log.warning(
            f"_rank_one_plate: {plate_code} no snapshots (OpenD may be throttled/down)"
        )
        if debug_log:
            debug_log("rank_one_plate_empty", {"plate_code": plate_code, "step": "snapshots"})
        return []

    # Step 2: Filter ETF/structured (v2, using OpenD valid flags)
    stocks = _filter_etf_structured(snapshots, debug_log=debug_log)
    if not stocks:
        log.warning(
            f"_rank_one_plate: {plate_code} all {len(snapshots)} snapshots are ETF/structured"
        )
        if debug_log:
            debug_log("rank_one_plate_empty", {"plate_code": plate_code, "step": "etf_filter"})
        return []

    # Step 5: Filter valid
    valid = _filter_valid_stocks(snapshots, stocks, debug_log=debug_log)
    if not valid:
        log.warning(
            f"_rank_one_plate: {plate_code} no valid stocks "
            f"(raw={len(raw_stocks)}, filtered={len(stocks)}, snapshots={len(snapshots)})"
        )
        if debug_log:
            debug_log("rank_one_plate_empty", {"plate_code": plate_code, "step": "valid_filter"})
        return []

    # Step 6: Rank + score
    _rank_and_score(valid, debug_log=debug_log)

    # Step 7: Sort + top N
    plate_leaders = sorted(valid, key=lambda x: x["score"])[:top_n]

    # Step 8: Fill metadata + reason
    for item in plate_leaders:
        item["plate_code"] = plate_code
        item["plate_name"] = plate_name
        item["reason"] = _generate_reason(item)

    log.info(
        f"_rank_one_plate: {plate_code} → {len(plate_leaders)} leaders "
        f"(raw={len(raw_stocks)}, filtered={len(stocks)}, "
        f"snapshots={len(snapshots)}, valid={len(valid)}, top_n={top_n})"
    )
    return plate_leaders


def run_plate_leaders(
    plates: list[str],
    top_n: int = 10,
    debug: bool = False,
) -> list[dict[str, Any]]:
    """
    AS-01 板塊龍頭股 Top N ranking — modular architecture (大少 2026-07-24 08:57 feedback).

    大少 2026-07-24 08:35 instruction (Q1=A + UI 改動):
    - Per-plate independent ranking (唔再 global dedupe + combined ranking)
    - 每個 plate 獨立 rank top N, concat 落 results
    - 唔 dedupe (per-plate 嚴格獨立, count = plate_count × top_n)
    - Response schema 加 plate_name field (frontend 用嚟 display「板塊來源」column)

    Architecture (大少 2026-07-24 08:57 feedback: 模組塊架構):
    - 8 helper functions, each Single Responsibility (見上面 definitions)
    - run_plate_leaders() 只係 simple orchestrator: loop plates, call _rank_one_plate(), concat
    - 每個 step explicit logging (避免 silent skip)

    Returns:
        list of leader dict (concat 順序: 板塊1 top N → 板塊2 top N → ...):
        {
            "code", "name", "price", "change_pct",
            "mcap", "turnover", "plate_code", "plate_name",
            "score", "mcap_rank", "volume_rank", "reason"
        }

    Edge cases (照 spec §⚠️ Edge cases):
        - 空 plates list → return []
        - top_n 越界 → fallback 10
        - Plate 唔存在 / 0 stocks → skip (logged warning), 繼續 process 其他 plate
        - Plate 內 stocks < top_n → return 全部 stocks (per-plate edge case)
        - Multi-plate 同 stock 出現 → 唔 dedupe (per-plate 嚴格獨立, 大少 2026-07-24 Q1=A)
        - 停牌股 (suspension=True) → skip (logged debug)
        - mcap=0 / NaN → skip (logged debug)
        - Snapshot 攞唔到 → skip (logged warning)
        - ETF / 結構性產品 → skip (logged debug)
    """
    if not plates:
        return []

    # Debug context init (大少 2026-07-24 Debug Panel)
    debug_run = None
    debug_log: Optional[Callable[[str, dict[str, Any]], None]] = None
    if debug:
        from debug import get_debug, make_debug_logger
        debug_run = get_debug().start_run(
            trigger=f"run_plate_leaders({len(plates)} plates × top {top_n})"
        )
        debug_log = make_debug_logger(debug_run)
        debug_log(
            "run_plate_leaders_start",
            {"plates": plates, "top_n": top_n},
        )

    if top_n < 1 or top_n > 50:
        top_n = 10  # fallback to default

    # plate_name cache (避免同一 plate 多次 DB query)
    plate_name_cache: dict[str, str] = {}

    # 大少 2026-07-24 08:57: RET_OK + OpenQuoteContext 喺 module-top import (helper 共享)
    ctx = OpenQuoteContext(host="127.0.0.1", port=11111)
    try:
        leaders_all: list[dict[str, Any]] = []

        # 大少 2026-07-24: Per-plate independent loop, concat results
        for plate_idx, plate_code in enumerate(plates, 1):
            log.info(f"run_plate_leaders: [{plate_idx}/{len(plates)}] {plate_code}")
            plate_leaders = _rank_one_plate(
                ctx, plate_code, top_n, plate_name_cache, debug_log=debug_log
            )
            leaders_all.extend(plate_leaders)

        log.info(
            f"run_plate_leaders: {len(plates)} plates → {len(leaders_all)} leaders (per-plate top {top_n})"
        )
        if debug_run:
            debug_run.finish("ok", {"total_leaders": len(leaders_all)})
        return leaders_all
    except Exception as e:
        if debug_run:
            debug_run.finish("error", {"error": str(e)})
        raise
    finally:
        ctx.close()
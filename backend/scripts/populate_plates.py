#!/usr/bin/env python3
"""
populate_plates.py
==================

從 Futu OpenD 攞所有 HK 板塊, 過濾後寫入 SQLite `plate_leaders_options` table。

Usage
-----
    # Run once (idempotent, safe to re-run)
    ~/.futu_venv/bin/python3 ~/stockpulse/backend/scripts/populate_plates.py

    # Custom DB path
    ~/.futu_venv/bin/python3 ~/stockpulse/backend/scripts/populate_plates.py --db /path/to/stocks.db

What it does
------------
1. 確保 `plate_leaders_options` table 存在 (CREATE TABLE IF NOT EXISTS)
2. 連接 Futu OpenD (127.0.0.1:11111)
3. 攞所有 HK 板塊 (Plate.ALL → 299 個)
4. 過濾: 移除指數類 / 債券類 / ETF / 基金 / REIT (淨係留行業/概念板塊)
5. DELETE + INSERT (全量 replace, 因為 plate 數目少)

Filter keywords
---------------
- 指數 / 指数 / Index / INDEX
- ETF / ETN
- 債券 / 债券 / Bond / BOND / Debt
- 基金 / Fund / FUND
- REIT / 信託 / 信托 / Trust
- 窩輪 / 牛熊 / 認股證 / 權證

Dependencies
------------
- futu SDK v10+ (喺 `~/.futu_venv/`)
- sqlite3 (stdlib)
- OpenD running at 127.0.0.1:11111

Notes
-----
- 板塊數目 ~275 個 (過濾後), 寫 DB 速度極快
- Idempotent: re-run OK, 會 DELETE + re-INSERT
- 唔做 popularity calculation (見 compute_popularity.py)
- 大少 2026-07-23 confirm 用 option A — 過濾指數/債券/ETF/基金/REIT/窩輪
"""
import argparse
import logging
import sqlite3
import sys
from pathlib import Path

import futu
from futu import OpenQuoteContext, RET_OK
from futu.common.constant import Plate

# Import classify function from models (single source of truth)
# models/plate.py 入面定義咗 PLATE_TYPE_KEYWORDS 同 classify_plate_type()
# 用同一份 logic 確保 backend query 同 populate 一致
sys.path.insert(0, str(Path.home() / "stockpulse"))
from backend.models.plate import classify_plate_type
from backend.utils.zh_normalize import to_traditional  # A2 大少 #7609: 永久 zhconv

# ============================================================================
# Constants
# ============================================================================

# Default DB path — overridable via --db
DEFAULT_DB_PATH = Path.home() / "stockpulse" / "backend" / "data" / "stocks.db"

# OpenD endpoint (本地)
FUTU_HOST = "127.0.0.1"
FUTU_PORT = 11111

# (大少 2026-07-24 instruction: 唔再 filter 走, 改做 classify 寫入 plate_type column)
# 原本嘅 SKIP_KEYWORDS list 而家由 backend/models/plate.py 入面嘅 PLATE_TYPE_KEYWORDS handle.
# 兩處 logic 一致 (classify_plate_type function) — single source of truth.

# ============================================================================
# Logging setup
# ============================================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("populate_plates")


# ============================================================================
# Functions
# ============================================================================

def ensure_table(db_path: Path) -> None:
    """
    確保 `plate_leaders_options` table 存在。

    個 table schema (see migration 2026-07-23):
    - plate_code           PK, e.g. "HK.LIST1001"
    - plate_name           板塊名, e.g. "半導體"
    - market               'HK' (default)
    - is_active            1=active, 0=disabled
    - last_updated         auto-update timestamp
    - stock_count          板塊有幾多股票 (OpenD get_plate_stock)
    - volume_30d           30 日累計成交量 (K-line sum)
    - popularity_score     computed score (default 0)
    - popularity_rank      1=最 popular, NULL=未計算
    - popularity_updated_at 最後 popularity 計算時間

    Idempotent: 用 IF NOT EXISTS, re-run 唔會 error.
    """
    log.info("Ensuring table exists at %s", db_path)
    conn = sqlite3.connect(db_path)
    try:
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
        log.info("Table ready ✓")
    finally:
        conn.close()


def fetch_plates_from_opend() -> list[tuple[str, str]]:
    """
    從 OpenD 攞所有 HK 板塊。

    Returns:
        list of (plate_code, plate_name) tuples

    Raises:
        SystemExit: 如果 OpenD 連唔到或 query fail

    Note:
        OpenD 返 DataFrame with columns: ['code', 'plate_name', 'plate_id']
        注意: column 叫 'code' 唔係 'plate_code' (SDK 慣例)
    """
    log.info("Connecting to OpenD at %s:%d", FUTU_HOST, FUTU_PORT)
    ctx = OpenQuoteContext(host=FUTU_HOST, port=FUTU_PORT)
    try:
        log.info("Calling get_plate_list(Market.HK, Plate.ALL) ...")
        ret, data = ctx.get_plate_list(futu.Market.HK, Plate.ALL)
        if ret != RET_OK:
            log.error("get_plate_list failed: %s", data)
            sys.exit(1)

        log.info("Got %d HK plates from OpenD", len(data))
        return [(str(row["code"]), str(row["plate_name"])) for _, row in data.iterrows()]
    finally:
        ctx.close()


def classify_all_plates(
    plates: list[tuple[str, str]],
) -> list[tuple[str, str, str, str]]:
    """
    分類 plate list (大少 2026-07-24 instruction: 唔再 filter 走, 改做 label type).

    每個 plate 都會 keep 住, 但係加返 plate_type field 寫入 database.
    用 backend/models/plate.py 入面嘅 classify_plate_type() 確保 logic 一致.

    Args:
        plates: list of (plate_code, plate_name) from fetch_plates_from_opend

    Returns:
        list of (plate_code, plate_name, market, plate_type) tuples
        e.g. ("HK.LIST1001", "半導體", "HK", "stock")
             ("HK.LIST9999", "恒生指數", "HK", "index")
    """
    result = []
    for code, name in plates:
        plate_type = classify_plate_type(name)
        result.append((code, name, "HK", plate_type))
    return result


def upsert_plates(
    db_path: Path, plates: list[tuple[str, str, str, str]]
) -> int:
    """
    UPSERT plate_leaders_options 嘅內容 (大少 2026-07-24 instruction).

    用 SQLite 3.24+ 嘅 INSERT ... ON CONFLICT DO UPDATE syntax
    (真正 UPSERT, 只更新 specified columns, 保留其它 columns):
    - DELETE 會清空 popularity_score / popularity_rank / popularity_updated_at
    - 用 INSERT OR REPLACE 都會 replace 成個 row (唔係真正 update)
    - 用 ON CONFLICT DO UPDATE 只 update plate_name / market / plate_type / is_active / last_updated,
      保留 popularity data (popularity_score / popularity_rank / popularity_updated_at)
    - plate 數目少 (~275-299), performance 唔係問題

    Args:
        db_path: SQLite file path
        plates: list of (plate_code, plate_name, market, plate_type)

    Returns:
        number of rows upserted
    """
    log.info("Upserting %d plates into DB ...", len(plates))
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        # A2 hook (大少 #7609): 永久 zhconv 將來新 plate 寫入都繁體
        plates = [(code, to_traditional(name), market, plate_type)
                  for code, name, market, plate_type in plates]
        # SQLite UPSERT (3.24+, 2018+): 只 update specified columns, preserve others
        cursor.executemany(
            """INSERT INTO plate_leaders_options
               (plate_code, plate_name, market, plate_type, is_active, last_updated)
               VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
               ON CONFLICT(plate_code) DO UPDATE SET
                 plate_name = excluded.plate_name,
                 market = excluded.market,
                 plate_type = excluded.plate_type,
                 is_active = excluded.is_active,
                 last_updated = CURRENT_TIMESTAMP""",
            plates,
        )
        conn.commit()
        log.info("Upserted %d plates ✓", cursor.rowcount)
        return cursor.rowcount
    finally:
        conn.close()


# ============================================================================
# Main
# ============================================================================

def main() -> None:
    parser = argparse.ArgumentParser(description="Populate plate_leaders_options from Futu OpenD")
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB_PATH,
        help=f"Path to SQLite DB (default: {DEFAULT_DB_PATH})",
    )
    args = parser.parse_args()

    if not args.db.exists():
        log.error("DB not found: %s", args.db)
        sys.exit(1)

    log.info("=" * 60)
    log.info("StockPulse: Populate HK Plates from OpenD")
    log.info("=" * 60)

    # 大少 2026-07-25: 龍頭板塊 pipeline 重置, populate + compute 全停。
    try:
        from backend.config import PLATES_PIPELINE_DISABLED
        if PLATES_PIPELINE_DISABLED:
            log.warning("=" * 60)
            log.warning("⚠️ PLATES_PIPELINE_DISABLED=True (大少 2026-07-25 龍頭板塊 reset)")
            log.warning("   populate_plates.py early-exit (no OpenD call, no DB write)。")
            log.warning("   將來重新 enable 改 backend/config.py PLATES_PIPELINE_DISABLED = False")
            log.warning("=" * 60)
            sys.exit(0)
    except ImportError:
        pass  # config.py 唔 importable, 正常行

    # Step 1: ensure table (含 plate_type column migration)
    ensure_table(args.db)

    # Step 2: fetch from OpenD
    raw_plates = fetch_plates_from_opend()

    # Step 3: classify (大少 2026-07-24: 唔再 filter 走, 改做 label type)
    classified = classify_all_plates(raw_plates)
    log.info("Classified %d plates (全部都保留, 加 plate_type label)", len(classified))

    # Step 3.5: count by type (方便 log + debug)
    type_counts: dict[str, int] = {}
    for _, _, _, ptype in classified:
        type_counts[ptype] = type_counts.get(ptype, 0) + 1
    log.info("Plate type breakdown:")
    for ptype, count in sorted(type_counts.items(), key=lambda x: -x[1]):
        marker = "✅" if ptype == "stock" else "⏭️ "
        log.info("  %s %-12s %d", marker, ptype, count)

    # Show non-stock samples (first 5 each type)
    non_stock_samples: dict[str, list] = {}
    for code, name, _, ptype in classified:
        if ptype != "stock":
            non_stock_samples.setdefault(ptype, []).append((code, name))
    if non_stock_samples:
        log.info("--- Non-stock plate samples (前 5 per type) ---")
        for ptype, samples in non_stock_samples.items():
            for code, name in samples[:5]:
                log.info("  %s %-12s %-30s [%s]", "⏭️ ", code, name, ptype)

    # Step 4: upsert (保留 popularity data)
    upsert_plates(args.db, classified)

    log.info("=" * 60)
    log.info("🎉 Done — %d plates in plate_leaders_options", len(classified))
    log.info("=" * 60)


if __name__ == "__main__":
    main()
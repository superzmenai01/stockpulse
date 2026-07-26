#!/usr/bin/env python3
"""
populate_plates_v2.py — 大少 2026-07-25 龍頭板塊 reset 重寫

簡單版 (target ~80 行)，由頭寫:
1. query OpenD get_plate_list(Market.HK, Plate.INDUSTRY/CONCEPT)
2. INSERT INTO plate_leaders_options (pure basic metadata)
3. ⏸️ 唔做 popularity compute (PLATES_PIPELINE_DISABLED 控制)

跟之前 v1 (294 行) 嘅分別:
- 冇 classify_plate_type (industry/concept 已經 known)
- 冇 non-stock filter (populate 全部)
- 冇 logging fancy 嘢
- ON CONFLICT REPLACE 確保 idempotent

Schema: plate_leaders_options (大少 Q2 A = 唔改 schema)
- plate_code (PK), plate_name, market='HK', is_active=1, last_updated=NOW
- stock_count=0, volume_30d=0, popularity_score=0, popularity_rank=NULL
- popularity_updated_at=NULL
- plate_type='industry' or 'concept' (explicit set, 唔用 default 'stock')
"""
import logging
import sqlite3
import sys
from pathlib import Path

# Add backend to sys.path for config import
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import PLATES_PIPELINE_DISABLED  # 大少 2026-07-25 reset gate
from utils.zh_normalize import to_traditional  # A2 大少 #7609: 永久 zhconv (1-line hook)
from futu import OpenQuoteContext, RET_OK, Plate
from futu.common.constant import Market

# ============================================================================
# Logging
# ============================================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("populate_plates_v2")

# ============================================================================
# Paths
# ============================================================================
DB_PATH = Path(__file__).parent.parent / "data" / "stocks.db"

# ============================================================================
# SQL
# ============================================================================
INSERT_SQL = """
INSERT INTO plate_leaders_options
  (plate_code, plate_name, market, plate_type, is_active, last_updated,
   stock_count, volume_30d, popularity_score, popularity_rank, popularity_updated_at)
VALUES (?, ?, 'HK', ?, 1, CURRENT_TIMESTAMP, 0, 0.0, 0.0, NULL, NULL)
ON CONFLICT(plate_code) DO UPDATE SET
  plate_name = excluded.plate_name,
  plate_type = excluded.plate_type,
  is_active = 1,
  last_updated = CURRENT_TIMESTAMP
"""


def fetch_plates_from_opend(ctx: OpenQuoteContext) -> list[dict]:
    """
    Query OpenD HK 行業 + 概念板塊 list.

    Returns:
        list of dict: [{code, name, plate_type}, ...]
    """
    out: list[dict] = []

    for plate_class_enum, plate_type_label in [
        (Plate.INDUSTRY, "industry"),
        (Plate.CONCEPT, "concept"),
    ]:
        log.info("Fetching HK %s plates ...", plate_type_label)
        ret, data = ctx.get_plate_list(Market.HK, plate_class_enum)
        if ret != RET_OK:
            log.error("get_plate_list(%s) failed: %s", plate_type_label, data)
            continue
        for _, row in data.iterrows():
            out.append({
                "code": row["code"],
                "name": row["plate_name"],
                "plate_type": plate_type_label,
            })
        log.info("  ✓ Got %d %s plates", len(data), plate_type_label)

    return out


def upsert_plates(db_path: Path, plates: list[dict]) -> int:
    """
    INSERT or UPDATE plates into plate_leaders_options table.

    Returns:
        int: number of rows affected (inserted + updated)
    """
    if not plates:
        log.warning("No plates to insert")
        return 0

    log.info("Upserting %d plates into %s ...", len(plates), db_path)
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        rows = [
            (p["code"], to_traditional(p["name"]), p["plate_type"])  # A2 hook
            for p in plates
        ]
        cursor.executemany(INSERT_SQL, rows)
        conn.commit()
        affected = cursor.rowcount
        log.info("  ✓ %d rows affected (inserted + updated)", affected)
        return affected
    finally:
        conn.close()


def main() -> None:
    if PLATES_PIPELINE_DISABLED:
        log.warning("=" * 60)
        log.warning("⚠️ PLATES_PIPELINE_DISABLED=True (大少 2026-07-25 龍頭板塊 reset)")
        log.warning("   populate_plates_v2.py early-exit (no OpenD call, no DB write)。")
        log.warning("   將來重新 enable 改 backend/config.py PLATES_PIPELINE_DISABLED = False")
        log.warning("=" * 60)
        sys.exit(0)

    log.info("=" * 60)
    log.info("StockPulse: Populate HK Plates from OpenD (v2 simple)")
    log.info("=" * 60)

    # 1. Fetch from OpenD
    ctx = OpenQuoteContext(host="127.0.0.1", port=11111)
    try:
        plates = fetch_plates_from_opend(ctx)
    finally:
        ctx.close()

    if not plates:
        log.error("❌ No plates fetched from OpenD, exit")
        sys.exit(1)

    # 2. Upsert to DB
    affected = upsert_plates(DB_PATH, plates)

    # 3. Summary
    by_type: dict[str, int] = {}
    for p in plates:
        by_type[p["plate_type"]] = by_type.get(p["plate_type"], 0) + 1
    log.info("=" * 60)
    log.info("🎉 Populate complete!")
    for t, n in sorted(by_type.items()):
        log.info("   %-10s %d plates", t, n)
    log.info("   Total: %d plates, %d rows affected", len(plates), affected)
    log.info("=" * 60)


if __name__ == "__main__":
    main()
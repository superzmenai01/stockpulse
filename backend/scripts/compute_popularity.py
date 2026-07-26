#!/usr/bin/env python3
"""
compute_popularity.py
=====================

計算每個板塊嘅 popularity score, 寫入 plate_leaders_options。

大少 2026-07-25 #7139 algorithm spec:
  popularity_score = sum(per-stock N-day volume) / stock_count
  - 用過去 10 日 daily K-line (per-stock N-day sum)
  - 唔係 today single-day snapshot (舊版, 太波動)

Usage
-----
    # Default: 10-day average per-stock (大少 #7139)
    ~/.futu_venv/bin/python3 ~/stockpulse/backend/scripts/compute_popularity.py

    # Legacy: today volume single-day (快但 noisy)
    ~/.futu_venv/bin/python3 ~/stockpulse/backend/scripts/compute_popularity.py --mode today

    # Custom window
    ~/.futu_venv/bin/python3 ~/stockpulse/backend/scripts/compute_popularity.py --days 30

What it does (10d mode, default)
--------------------------------
1. 讀 plate_leaders_options 所有 plates (~275)
2. 對每個 plate:
   a. OpenD `get_plate_stock(code)` → 攞板塊 stock list
   b. 對每隻 stock, OpenD `request_history_kline(code, K_DAY, max_count=N)` → 攞 N 日 K-line
   c. Sum `data['volume']` → 該 stock 嘅 N 日總成交股數
3. popularity_score = sum(per-stock N-day total) / stock_count
4. UPDATE plate_leaders_options SET stock_count, volume_30d (= N-day sum), popularity_score
5. ORDER BY popularity_score DESC, 計算 popularity_rank (1 = 最 popular)
6. UPDATE plate_leaders_options SET popularity_updated_at

Dependencies
------------
- futu SDK v10+ (喺 `~/.futu_venv/`)
- OpenD running at 127.0.0.1:11111
- sqlite3 (stdlib)
"""
import argparse
import logging
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import futu
from futu import OpenQuoteContext, RET_OK, KLType

# 大少 2026-07-24 Debug Panel: instrument popularity job for /api/debug/status
sys.path.insert(0, str(Path(__file__).parent.parent))
from debug import get_debug

# ============================================================================
# Constants
# ============================================================================

DEFAULT_DB_PATH = Path.home() / "stockpulse" / "backend" / "data" / "stocks.db"
FUTU_HOST = "127.0.0.1"
FUTU_PORT = 11111

# Sleep between plates 避免 OpenD throttle
# 重要: get_plate_stock 限速 "30 秒最多 10 次" (per Futu docs)
# 大少 2026-07-25 #7227 fix: bump 3.5s → 5s (避免 burst launch 撞 limit)
SLEEP_BETWEEN_PLATES = 5.0

# Sleep per stock for request_history_kline
# 大少 2026-07-25 #7156 fix: OpenD 限速 「每30秒最多60次」 (~2/s, 30s/60)
# 大少 2026-07-25 #7157 fix: 0.6s 仲 hit throttle, 增加至 0.8s + retry on error
SLEEP_BETWEEN_KLINE_CALLS = 0.8  # ~1.25/s = 75/min, 30s/37 ≤ 60 (大 buffer)

# get_market_snapshot 限速: 每次 call ≤ 400 codes
SNAPSHOT_BATCH_SIZE = 400

# ============================================================================
# Logging
# ============================================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("compute_popularity")


# ============================================================================
# DB functions
# ============================================================================

def get_all_plates(db_path: Path) -> list[tuple[str, str]]:
    """讀 plate_leaders_options 所有 plates."""
    log.info("Reading plates from DB ...")
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT plate_code, plate_name FROM plate_leaders_options")
        plates = cursor.fetchall()
        log.info("Found %d plates", len(plates))
        return plates
    finally:
        conn.close()


def update_plate_metric(
    db_path: Path,
    plate_code: str,
    stock_count: int,
    metric_value: float,
) -> None:
    """
    UPDATE 單個 plate 嘅 stock_count + volume_30d + popularity_score。

    popularity_score = metric_value / stock_count (average per stock)
    大少 2026-07-24 instruction: 避免 stock_count 多時佔優勢。
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        avg_metric = metric_value / stock_count if stock_count > 0 else 0.0
        cursor.execute(
            """UPDATE plate_leaders_options
               SET stock_count = ?,
                   volume_30d = ?,
                   popularity_score = ?,
                   last_updated = CURRENT_TIMESTAMP
               WHERE plate_code = ?""",
            (stock_count, metric_value, avg_metric, plate_code),
        )
        conn.commit()
    finally:
        conn.close()


def compute_and_save_ranks(db_path: Path) -> int:
    """計算 popularity_rank (1 = 最 popular) + 更新 popularity_updated_at."""
    log.info("Computing popularity_rank ...")
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute("""
            UPDATE plate_leaders_options
            SET popularity_rank = (
                SELECT COUNT(*) + 1
                FROM plate_leaders_options p2
                WHERE p2.popularity_score > plate_leaders_options.popularity_score
            ),
            popularity_updated_at = ?
        """, (now,))
        conn.commit()
        log.info("✓ Ranked %d plates at %s", cursor.rowcount, now)
        return cursor.rowcount
    finally:
        conn.close()


# ============================================================================
# OpenD functions
# ============================================================================

def get_plate_stocks(ctx: OpenQuoteContext, plate_code: str) -> list[str]:
    """
    攞一個板塊嘅 stock list via OpenD.

    大少 2026-07-25 #7227 fix: 加 retry logic (3 attempts + backoff)
    因為 PA job 開頭 burst launch 撞 OpenD 30s/10 throttle,
    之前 retry 0 直接 return [], 導致 0 stocks processed silent fail.
    """
    max_retries = 3
    for attempt in range(max_retries):
        try:
            ret, data = ctx.get_plate_stock(plate_code)
            if ret == RET_OK:
                return list(data["code"])
            # Throttle hit: 「频率太高」/ 「频率」
            err_str = str(data)
            if "频率" in err_str and attempt < max_retries - 1:
                wait_time = 3.0 * (attempt + 1)  # 3s, 6s, 9s
                log.warning(
                    "get_plate_stock(%s) throttled, retry in %.1fs (attempt %d/%d): %s",
                    plate_code, wait_time, attempt + 1, max_retries, err_str,
                )
                time.sleep(wait_time)
                continue
            # Non-throttle error OR exhausted retries
            log.warning("get_plate_stock(%s) failed: %s", plate_code, err_str)
            return []
        except Exception as e:
            log.warning("get_plate_stock(%s) exception: %s", plate_code, e)
            return []
    return []


def get_snapshot_metric(
    ctx: OpenQuoteContext,
    codes: list[str],
    metric: str = "volume",
) -> float:
    """Batch 攞多隻 stocks 嘅指定 metric (real-time snapshot), 返 sum."""
    if not codes:
        return 0.0
    total = 0.0
    for i in range(0, len(codes), SNAPSHOT_BATCH_SIZE):
        batch = codes[i : i + SNAPSHOT_BATCH_SIZE]
        try:
            ret, data = ctx.get_market_snapshot(batch)
            if ret != RET_OK:
                log.warning("snapshot batch [%d:%d] failed: %s",
                            i, i + len(batch), data)
                continue
            if metric not in data.columns:
                log.warning("Metric '%s' not in snapshot columns", metric)
                continue
            total += float(data[metric].sum())
        except Exception as e:
            log.warning("snapshot batch [%d:%d] exception: %s",
                        i, i + len(batch), e)
    return total


def get_stock_type_flags(
    ctx: OpenQuoteContext,
    codes: list[str],
) -> dict[str, dict[str, Any]]:
    """
    大少 2026-07-25 PA spec: Batch fetch snapshots 攞 OpenD valid flags.

    返 {code: snapshot_row_dict} for stock type classification.
    用 OpenD `get_market_snapshot` 嘅 valid flags:
    - equity_valid=True + 其他 False → 真 stock (keep)
    - wrt_valid=True / trust_valid=True / index_valid=True / future_valid=True → drop
    - equity_valid=False + 冇其他 valid flag → drop (unknown)

    Returns:
        dict mapping code → snapshot row dict (with wrt_valid, trust_valid, etc)
    """
    result: dict[str, dict[str, Any]] = {}
    if not codes:
        return result
    for i in range(0, len(codes), SNAPSHOT_BATCH_SIZE):
        batch = codes[i : i + SNAPSHOT_BATCH_SIZE]
        try:
            ret, data = ctx.get_market_snapshot(batch)
            if ret != RET_OK:
                log.warning("snapshot flags batch [%d:%d] failed: %s",
                            i, i + len(batch), data)
                continue
            for _, row in data.iterrows():
                result[str(row["code"])] = row.to_dict()
        except Exception as e:
            log.warning("snapshot flags batch [%d:%d] exception: %s",
                        i, i + len(batch), e)
    return result


def filter_stocks_by_type(
    stocks: list[str],
    type_flags: dict[str, dict[str, Any]],
    include_non_stock: bool = False,
) -> tuple[list[str], dict[str, list[str]]]:
    """
    大少 2026-07-25 PA spec: 每個板塊只留股票, 不是股票的不要在計算內。

    用 OpenD valid flags (大少 Option A 揀嘅方法):
    - equity_valid=True + 其他 False → 真 stock (keep)
    - wrt_valid=True → 窩輪 (drop, drop_reason='warrant')
    - trust_valid=True → REIT (drop, drop_reason='reit')
    - index_valid=True → 指數 (drop, drop_reason='index')
    - future_valid=True → 期貨 (drop, drop_reason='future')
    - equity_valid=False + 冇其他 valid flag → drop (drop_reason='unknown')

    Args:
        stocks: plate 入面所有 stock codes (從 get_plate_stock 攞)
        type_flags: {code: snapshot_row_dict} 從 get_stock_type_flags()
        include_non_stock: 大少 CLI flag `--include-non-stock` (default False)
                          False = 只 keep equity stocks (大少 PA rule)
                          True = keep all (for debug / regression)

    Returns:
        (kept_stocks, dropped_by_reason) tuple:
        - kept_stocks: list of stock codes 屬於真 stock
        - dropped_by_reason: dict {reason: [codes]} e.g. {'warrant': [...], 'reit': [...]}
    """
    kept: list[str] = []
    dropped_by_reason: dict[str, list[str]] = {
        "warrant": [],
        "reit": [],
        "index": [],
        "future": [],
        "unknown": [],
        "no_snapshot": [],
    }

    for code in stocks:
        row = type_flags.get(code)
        if row is None:
            # 冇 snapshot data (e.g. OpenD throttle / stock 下架)
            if not include_non_stock:
                dropped_by_reason["no_snapshot"].append(code)
                continue
            else:
                # include_non_stock=True: 保留 (debug mode)
                kept.append(code)
                continue

        wrt = bool(row.get("wrt_valid", False))
        trust = bool(row.get("trust_valid", False))
        idx = bool(row.get("index_valid", False))
        future = bool(row.get("future_valid", False))
        equity = bool(row.get("equity_valid", False))

        if include_non_stock:
            # Debug mode: keep all
            kept.append(code)
            continue

        # Default (大少 PA rule): only keep 真 equity stocks
        if wrt:
            dropped_by_reason["warrant"].append(code)
        elif trust:
            dropped_by_reason["reit"].append(code)
        elif idx:
            dropped_by_reason["index"].append(code)
        elif future:
            dropped_by_reason["future"].append(code)
        elif not equity:
            dropped_by_reason["unknown"].append(code)
        else:
            kept.append(code)

    return kept, dropped_by_reason


def request_history_kline_volume(
    ctx: OpenQuoteContext,
    code: str,
    days: int = 10,
) -> float:
    """
    [NEW 大少 2026-07-25 #7139] Fetch 1 stock 嘅 N-day daily K-line, return sum of volume.

    用 OpenD `request_history_kline` (sync) 而非 `get_history_kline` (async streaming).
    Returns 0.0 on error (logged).
    """
    try:
        # OpenD request_history_kline returns 3-tuple: (ret, data, page_req_key)
        # page_req_key 用嚟 pagination (>1000 records)，我哋 max_count=10 唔需要
        # 大少 2026-07-25 #7157 fix: retry on throttle errors (auto recover)
        max_retries = 3
        for attempt in range(max_retries):
            ret, data, _page_req_key = ctx.request_history_kline(
                code,
                ktype=KLType.K_DAY,
                max_count=days,
            )
            if ret == RET_OK:
                break
            elif "频率太高" in str(data) and attempt < max_retries - 1:
                # Throttle hit — wait + retry
                wait_time = 2.0 * (attempt + 1)  # 2s, 4s, 6s
                log.warning(f"request_history_kline({code}) throttled, retry in {wait_time}s (attempt {attempt+1}/{max_retries})")
                time.sleep(wait_time)
                continue
            else:
                log.warning(f"request_history_kline({code}, {days}d) failed: {data}")
                return 0.0
        else:
            return 0.0
        if ret != RET_OK:
            log.warning(f"request_history_kline({code}, {days}d) failed: {data}")
            return 0.0
        if data is None or data.empty:
            log.warning(f"request_history_kline({code}, {days}d) empty data")
            return 0.0
        if "volume" not in data.columns:
            log.warning(f"request_history_kline({code}) no 'volume' column")
            return 0.0
        return float(data["volume"].sum())
    except Exception as e:
        log.warning(f"request_history_kline({code}) exception: {e}")
        return 0.0


# ============================================================================
# Main compute logic
# ============================================================================

def compute_popularity_10d(
    db_path: Path,
    days: int = 10,
    include_non_stock: bool = False,
) -> None:
    """
    大少 2026-07-25 #7139 algorithm:
    - 對每隻 stock, fetch N-day daily K-line, sum volume
    - popularity_score = sum(per-stock N-day total) / stock_count

    大少 2026-07-25 PA spec (PA = Popularity Algorithm):
    - 首先每個板塊只留股票, 然後再計算Rank
    - 不是股票的不要在計算內
    - Default: include_non_stock=False (filter 走 warrant/REIT/index/future)
    - 用 OpenD valid flags (Option A: batch get_market_snapshot)

    預計時間:
    - 275 plates × ~30 stocks avg × 0.8s throttle = ~90 min total
      (因為加咗 snapshot batch call step, +30% time)
    """
    plates = get_all_plates(db_path)
    if not plates:
        log.warning("No plates found — run populate_plates.py first")
        return

    log.info("=" * 60)
    log.info("Computing popularity (10d mode, days=%d) for %d plates",
             days, len(plates))
    log.info("Algorithm: sum(per-stock N-day volume) / stock_count")
    log.info("Stock type filter: %s (大少 2026-07-25 PA spec)", "OFF (include all)" if include_non_stock else "ON (only equity stocks)")
    log.info("=" * 60)

    # 大少 2026-07-24 Debug Panel: init popularity status (frontend live update)
    debug = get_debug()
    started_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    debug.update_popularity(
        state="running",
        total=len(plates),
        completed=0,
        metric=f"volume_{days}d",
        started_at=started_at,
        finished_at=None,
        error=None,
        current_plate=None,
    )

    ctx = OpenQuoteContext(host=FUTU_HOST, port=FUTU_PORT)
    try:
        total_metric = 0.0
        total_stocks_processed = 0
        total_dropped_by_reason = {"warrant": 0, "reit": 0, "index": 0, "future": 0, "unknown": 0, "no_snapshot": 0}
        start = time.time()

        for i, (code, name) in enumerate(plates, 1):
            # Debug Panel: live update
            debug.update_popularity(completed=i - 1, current_plate=name)

            # Step 1: 攞 stock list (from OpenD get_plate_stock)
            stocks = get_plate_stocks(ctx, code)
            if not stocks:
                update_plate_metric(db_path, code, 0, 0.0)
                log.debug("[%d/%d] %s (%s): 0 stocks", i, len(plates), code, name)
                continue

            # Step 1.5 (NEW 大少 2026-07-25 PA spec): Filter non-stocks first
            # 攞 valid flags via batch get_market_snapshot
            type_flags = get_stock_type_flags(ctx, stocks)
            stocks_filtered, dropped_by_reason = filter_stocks_by_type(
                stocks, type_flags, include_non_stock=include_non_stock,
            )
            for reason, codes in dropped_by_reason.items():
                total_dropped_by_reason[reason] += len(codes)

            # Step 2: 對每隻 kept stock, fetch N-day K-line + sum volume
            plate_total_volume = 0.0
            valid_stocks = 0
            for stock in stocks_filtered:
                v = request_history_kline_volume(ctx, stock, days=days)
                if v > 0:
                    plate_total_volume += v
                    valid_stocks += 1
                time.sleep(SLEEP_BETWEEN_KLINE_CALLS)  # throttle
            total_metric += plate_total_volume
            total_stocks_processed += valid_stocks

            # Step 3: UPDATE DB (popularity_score = sum / stock_count per 大少 spec)
            update_plate_metric(db_path, code, valid_stocks, plate_total_volume)

            # Progress log (每 10 plates)
            if i % 10 == 0 or i == len(plates):
                elapsed = time.time() - start
                avg = elapsed / i
                eta = avg * (len(plates) - i)
                avg_per_stock = plate_total_volume / valid_stocks if valid_stocks > 0 else 0
                dropped_summary = (
                    f"drop(w={len(dropped_by_reason['warrant'])},"
                    f"r={len(dropped_by_reason['reit'])},"
                    f"i={len(dropped_by_reason['index'])},"
                    f"f={len(dropped_by_reason['future'])},"
                    f"u={len(dropped_by_reason['unknown'])},"
                    f"ns={len(dropped_by_reason['no_snapshot'])})"
                )
                log.info(
                    "[%d/%d] %-30s | %3d stocks | %dd_total=%.0f | avg=%.0f | %s | ETA %.0fs",
                    i, len(plates), name, valid_stocks, days, plate_total_volume,
                    avg_per_stock, dropped_summary, eta,
                )

            # Sleep between plates
            time.sleep(SLEEP_BETWEEN_PLATES)

        log.info("=" * 60)
        log.info("All plates processed (%d stocks, %d total volume, %.0fs)",
                 total_stocks_processed, total_metric, time.time() - start)
        log.info("=" * 60)
        log.info("Non-stock drop summary (大少 PA spec filter):")
        log.info("  warrant:  %d", total_dropped_by_reason["warrant"])
        log.info("  reit:     %d", total_dropped_by_reason["reit"])
        log.info("  index:    %d", total_dropped_by_reason["index"])
        log.info("  future:   %d", total_dropped_by_reason["future"])
        log.info("  unknown:  %d", total_dropped_by_reason["unknown"])
        log.info("  no_snap:  %d", total_dropped_by_reason["no_snapshot"])
        log.info("=" * 60)

    except Exception as e:
        debug.update_popularity(state="failed", error=str(e))
        raise
    else:
        debug.update_popularity(state="completed", completed=len(plates), current_plate=None)
    finally:
        ctx.close()

    # Step 4: compute rank + update timestamp
    compute_and_save_ranks(db_path)
    debug.update_popularity(finished_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

    # Final report (top 10 + 半導體)
    log.info("=" * 60)
    log.info("Top 10 most popular plates (大少 #7139 algorithm):")
    log.info("=" * 60)
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT popularity_rank, plate_code, plate_name, stock_count,
                   printf('%,.0f', volume_30d) AS total_str,
                   printf('%,.0f', popularity_score) AS avg_str
            FROM plate_leaders_options
            ORDER BY popularity_rank ASC
            LIMIT 10
        """)
        for rank, code, name, count, total_str, avg_str in cursor.fetchall():
            log.info("  #%-3d %-30s | %-20s | %3d stocks | avg=%s",
                     rank, name, code, count, avg_str)
    finally:
        conn.close()


def compute_popularity(
    db_path: Path,
    metric: str = "volume",
) -> None:
    """Legacy today-mode popularity (kept for backward compat)."""
    plates = get_all_plates(db_path)
    if not plates:
        log.warning("No plates found — run populate_plates.py first")
        return

    log.info("=" * 60)
    log.info("Computing popularity (today mode, metric=%s) for %d plates",
             metric, len(plates))
    log.info("=" * 60)

    debug = get_debug()
    started_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    debug.update_popularity(
        state="running",
        total=len(plates),
        completed=0,
        metric=metric,
        started_at=started_at,
        finished_at=None,
        error=None,
        current_plate=None,
    )

    ctx = OpenQuoteContext(host=FUTU_HOST, port=FUTU_PORT)
    try:
        total_metric = 0.0
        start = time.time()

        for i, (code, name) in enumerate(plates, 1):
            debug.update_popularity(completed=i - 1, current_plate=name)
            stocks = get_plate_stocks(ctx, code)
            if not stocks:
                update_plate_metric(db_path, code, 0, 0.0)
                continue
            metric_value = get_snapshot_metric(ctx, stocks, metric)
            total_metric += metric_value
            update_plate_metric(db_path, code, len(stocks), metric_value)
            if i % 20 == 0 or i == len(plates):
                elapsed = time.time() - start
                avg = elapsed / i
                eta = avg * (len(plates) - i)
                log.info(
                    "[%d/%d] %-30s | %4d stocks | %s=%.0f | ETA %.0fs",
                    i, len(plates), name, len(stocks), metric, metric_value, eta,
                )
            time.sleep(SLEEP_BETWEEN_PLATES)
    except Exception as e:
        debug.update_popularity(state="failed", error=str(e))
        raise
    else:
        debug.update_popularity(state="completed", completed=len(plates), current_plate=None)
    finally:
        ctx.close()
    compute_and_save_ranks(db_path)
    debug.update_popularity(finished_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"))


# ============================================================================
# CLI
# ============================================================================

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compute plate popularity (大少 2026-07-25 #7139: 10-day per-stock average)"
    )
    parser.add_argument(
        "--mode",
        choices=["today", "10d"],
        default="10d",
        help="Algorithm mode: '10d' (大少 #7139 default, 10-day per-stock average) or 'today' (legacy, single-day)",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=10,
        help="Days for 10d mode (default 10, per 大少 #7139 spec)",
    )
    parser.add_argument(
        "--metric",
        choices=["volume"],
        default="volume",
        help="(today mode only) Metric: 'volume' (default)",
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB_PATH,
        help=f"Path to SQLite DB (default: {DEFAULT_DB_PATH})",
    )
    parser.add_argument(
        "--include-non-stock",
        action="store_true",
        default=False,
        help="大少 2026-07-25 PA spec: 預設 False (filter 走 warrant/REIT/index/future)。"
             "True = include all (debug mode, 唔 filter)。"
    )
    args = parser.parse_args()

    if not args.db.exists():
        log.error("DB not found: %s", args.db)
        sys.exit(1)

    # 大少 2026-07-25: 龍頭板塊 pipeline 重置, populate + compute 全停。
    # check backend.config.PLATES_PIPELINE_DISABLED (single source of truth)。
    try:
        from config import PLATES_PIPELINE_DISABLED
        if PLATES_PIPELINE_DISABLED:
            log.warning("=" * 60)
            log.warning("⚠️ PLATES_PIPELINE_DISABLED=True (大少 2026-07-25 龍頭板塊 reset)")
            log.warning("   compute_popularity.py early-exit (no DB write)。")
            log.warning("   將來重新 enable 改 backend/config.py PLATES_PIPELINE_DISABLED = False")
            log.warning("=" * 60)
            sys.exit(0)
    except ImportError:
        pass  # config.py 唔 importable, 正常行 (script 預期 stockpulse/ 喺 sys.path)

    log.info("=" * 60)
    log.info("StockPulse: Compute Plate Popularity")
    log.info("Mode: %s | Days: %d | Metric: %s", args.mode, args.days, args.metric)
    log.info("Include non-stock: %s", args.include_non_stock)
    log.info("=" * 60)

    if args.mode == "10d":
        compute_popularity_10d(args.db, days=args.days, include_non_stock=args.include_non_stock)
    else:
        compute_popularity(args.db, metric=args.metric)

    log.info("🎉 Done — re-run anytime to refresh")


if __name__ == "__main__":
    main()
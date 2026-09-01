#!/usr/bin/env python3
"""
migrate_kline_datetime_to_dateonly.py — KlineCache datetime format 永久 rule migration

凡人話: 大少 9月1日 17:05 trigger (4.61.0) — 清走 cache 入面 233 隻 stock 嘅 datetime format K 線
entries (e.g. "2026-09-01 00:00:00") 統一改做 date-only ("2026-09-01"), 對齊 4.57.2 永久 rule
「backend date 統一 YYYY-MM-DD」。

背景: 之前 SQL filter `time <= '2026-09-01'` (date-only) string compare 會排除 datetime format
寫法, 今日 K 線永遠入唔到 result, 之字 algorithm 拎唔到今日新高 (e.g. 00100 嘅 2026-09-01 H=381.4)
Fix 1 (kline_cache.py:114): SQL filter 用 `substr(time, 1, 10) <= ?` 做 date-only normalized 比對
Fix 2 (呢個 script): 清走 datetime format 嘥 entry, 統一 date-only 格式
Fix 3 (kline_cache.py write path): 加 normalize assert, 之後寫入都係 date-only

Migration 邏輯:
- 對每隻 stock + period 嘅 K 線 entry
- 如果 time 包含 " " (datetime format), 拎 substr(time, 1, 10) 改返 date-only
- 用 INSERT OR REPLACE 撞 unique key (code, period, time), 自動去重
- 保留最後寫入嘅 value (per dedup 規則)

用法:
    ~/.futu_venv/bin/python3 scripts/migrate_kline_datetime_to_dateonly.py
"""
import sqlite3
import sys
import os
from datetime import datetime

# 對齊 KlineCache.db_path
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend", "stockpulse.db")


def main():
    if not os.path.exists(DB_PATH):
        print(f"❌ DB not found: {DB_PATH}")
        sys.exit(1)

    print(f"[{datetime.now().isoformat(timespec='seconds')}] Migration start: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # 1. Count datetime format entries (清之前)
    before_count = conn.execute(
        "SELECT COUNT(*) FROM kline_cache WHERE time LIKE '% %'"
    ).fetchone()[0]
    affected_stocks = conn.execute(
        "SELECT COUNT(DISTINCT code) FROM kline_cache WHERE time LIKE '% %'"
    ).fetchone()[0]
    print(f"  Before: {before_count} 條 datetime format entries, {affected_stocks} 隻 stock 受影響")

    # 2. 用 INSERT OR REPLACE 邏輯:
    #    - 對每條 datetime entry, 拎 normalized date key
    #    - 拎 entry 全部 field
    #    - 用 INSERT OR REPLACE 寫入 date-only 格式 (撞 unique key 自動 dedup)
    #    - DELETE 原本 datetime entry
    rows = conn.execute(
        "SELECT code, period, time, open, high, low, close, volume, turnover_rate, last_fetched_at "
        "FROM kline_cache WHERE time LIKE '% %'"
    ).fetchall()
    print(f"  拎到 {len(rows)} 條 datetime entries 準備 normalize")

    insert_count = 0
    dedup_count = 0
    for row in rows:
        normalized_time = row['time'][:10]  # "2026-09-01 00:00:00" → "2026-09-01"

        # Check if date-only entry already exists
        # (PRIMARY KEY 是 (code, period, time), 所以用 COUNT 拎存在與否)
        existing = conn.execute(
            "SELECT COUNT(*) FROM kline_cache WHERE code = ? AND period = ? AND time = ?",
            (row['code'], row['period'], normalized_time),
        ).fetchone()[0] > 0

        if existing:
            # Date-only entry 已經存在, dedup 會用最新寫入嗰個 value
            # 為咗保留最新 fresh value, 唔 INSERT OR REPLACE (會用 stale value overwrite fresh)
            # 只係 DELETE datetime entry, 保留 date-only entry
            dedup_count += 1
        else:
            # Date-only entry 唔存在, INSERT normalized entry
            conn.execute(
                "INSERT OR REPLACE INTO kline_cache "
                "(code, period, time, open, high, low, close, volume, turnover_rate, last_fetched_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (row['code'], row['period'], normalized_time,
                 row['open'], row['high'], row['low'], row['close'],
                 row['volume'], row['turnover_rate'], row['last_fetched_at']),
            )
            insert_count += 1

    # 3. DELETE datetime entries
    deleted_count = conn.execute(
        "DELETE FROM kline_cache WHERE time LIKE '% %'"
    ).rowcount

    conn.commit()
    conn.close()

    # 4. Verify
    print(f"\n[{datetime.now().isoformat(timespec='seconds')}] Migration done:")
    print(f"  ✅ 拎 {len(rows)} 條 datetime entries")
    print(f"  ✅ INSERT date-only: {insert_count} 條 (新增)")
    print(f"  ✅ DEDUP 保留原 date-only: {dedup_count} 條 (避免 overwrite fresh value)")
    print(f"  ✅ DELETE datetime: {deleted_count} 條")
    print(f"  ℹ️  淨變動: {insert_count} 條新增 (dedup 冇影響,因為保留 date-only 嗰個)")

    # Final check
    conn = sqlite3.connect(DB_PATH)
    remaining = conn.execute(
        "SELECT COUNT(*) FROM kline_cache WHERE time LIKE '% %'"
    ).fetchone()[0]
    total = conn.execute("SELECT COUNT(*) FROM kline_cache").fetchone()[0]
    print(f"\n  After: {remaining} 條 datetime format (期望 0), {total} 條 total")
    conn.close()

    if remaining > 0:
        print(f"  ⚠️ 仲有 {remaining} 條 datetime format, 可能要再 run")
        sys.exit(1)
    else:
        print(f"  🎉 Migration 成功, 之後寫入都必走 4.61.0 Fix 3 normalize assert")


if __name__ == "__main__":
    main()

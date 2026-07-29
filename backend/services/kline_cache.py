"""
backend/services/kline_cache.py — KlineCache service (大少 #8505)

Cache-aside pattern for K-line data:
1. Check DB cache first
2. If gap or missing data, fetch from OpenD + write to DB
3. Return merged data

凡人話 implementation (per大少 push back over-engineer):
- read DB first (大少 #7987)
- T-1 only cache, today from OpenD (大少 #7983)
- missing data auto-fill (大少 #8505)
- 30 years window for daily K (大少 #8484 backtest use case)
"""

import asyncio
import datetime
import logging
import sqlite3
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Per-code async locks (concurrent dedup — 大少 #7983)
_locks: dict[str, asyncio.Lock] = {}
_locks_meta_lock = asyncio.Lock()


async def _get_lock(code: str) -> asyncio.Lock:
    """大少 #7983: per-code async lock — 防止 concurrent duplicate OpenD fetch."""
    if code not in _locks:
        async with _locks_meta_lock:
            if code not in _locks:
                _locks[code] = asyncio.Lock()
    return _locks[code]


class KlineCache:
    """KlineCache service — cache-aside K-line data in SQLite."""

    DEFAULT_DB_PATH = Path(__file__).parent.parent / "stockpulse.db"

    def __init__(self, db_path: Optional[str] = None):
        # 大少 #8505: SQLite path (default backend/stockpulse.db)
        self.db_path = db_path or str(self.DEFAULT_DB_PATH)
        self._init_schema()

    def _init_schema(self):
        """大少 #7987: CREATE TABLE IF NOT EXISTS — kline_cache + idx."""
        conn = sqlite3.connect(self.db_path)
        try:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS kline_cache (
                    code TEXT NOT NULL,
                    period TEXT NOT NULL,
                    time TEXT NOT NULL,
                    open REAL, high REAL, low REAL, close REAL,
                    volume INTEGER, turnover_rate REAL,
                    last_fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (code, period, time)
                );
                CREATE INDEX IF NOT EXISTS idx_kline_lookup
                ON kline_cache(code, period, time DESC);
            """)
            conn.commit()
        finally:
            conn.close()

    def get_klines(self, code: str, period: str,
                  start: Optional[str] = None,
                  end: Optional[str] = None) -> list[dict]:
        """Read cached K-lines from DB, ASC order.

        大少 #7987: ORDER BY time ASC (oldest first) — chart expects ASC.
        Filter by start/end if provided.
        """
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row  # 大少 #8511: fix ValueError (dict(row) on default Row)
        try:
            sql = ("SELECT time, open, high, low, close, volume, turnover_rate "
                   "FROM kline_cache WHERE code = ? AND period = ?")
            params: list = [code, period]
            if start:
                sql += " AND time >= ?"
                params.append(start)
            if end:
                sql += " AND time <= ?"
                params.append(end)
            sql += " ORDER BY time ASC"
            return [dict(row) for row in conn.execute(sql, params).fetchall()]
        finally:
            conn.close()

    def get_latest_time(self, code: str, period: str) -> Optional[str]:
        """DB MAX(time) for given code+period. None if no data."""
        conn = sqlite3.connect(self.db_path)
        try:
            row = conn.execute(
                "SELECT MAX(time) FROM kline_cache WHERE code = ? AND period = ?",
                (code, period),
            ).fetchone()
            return row[0] if row and row[0] else None
        finally:
            conn.close()

    def get_earliest_time(self, code: str, period: str) -> Optional[str]:
        """DB MIN(time) for given code+period. None if no data."""
        conn = sqlite3.connect(self.db_path)
        try:
            row = conn.execute(
                "SELECT MIN(time) FROM kline_cache WHERE code = ? AND period = ?",
                (code, period),
            ).fetchone()
            return row[0] if row and row[0] else None
        finally:
            conn.close()

    async def get_or_fetch(self, code: str, ctx, ktype, period: str = '1d',
                           start: Optional[str] = None,
                           end: Optional[str] = None,
                           max_count: int = 1000) -> dict:
        """Main entry point — cache-aside.

        大少 #8505: 先查 DB, missing data 即補 from OpenD.
        Returns: {'klines': [...], 'cached': bool, 'fetch_count': int}
        """
        lock = await _get_lock(code)
        async with lock:
            # Step 1: read cache
            cached = self.get_klines(code, period, start, end)
            cached_times = {row['time'] for row in cached} if cached else set()

            today = datetime.date.today().isoformat()
            today_in_range = (not end or end >= today) and (not start or start <= today)

            # Step 2: cold cache — fetch full range
            if not cached:
                # 大少 #8484: 30 years backtest window
                fetch_start = start or '1996-01-01'
                fetch_end = end or today
                # 大少 #7985: per-period window
                if period == '1d':
                    default_years = 30
                else:
                    default_years = 10
                if not start:
                    earliest = datetime.date.today() - datetime.timedelta(days=default_years * 365)
                    fetch_start = earliest.isoformat()
                fetched = await self._fetch_and_store(
                    ctx, code, ktype, period, fetch_start, fetch_end, max_count
                )
                all_klines = sorted(cached + fetched, key=lambda k: k['time'])
                return {
                    'klines': all_klines,
                    'cached': False,
                    'fetch_count': len(fetched),
                }

            # Step 3: warm cache + auto-update missing days + today from OpenD
            # 大少 #8551: Step 3 fetch window 由 (today, today, 1) → (cached_latest+1 或 yesterday, today, 10)
            # 解決 Issue A (auto-update 28/29 missing) + Issue B (今日 OpenD 數據)
            fetch_count = 0
            fetched = []
            if today_in_range:
                today_date = datetime.date.today()
                yesterday_date = today_date - datetime.timedelta(days=1)

                if cached_times:
                    # cached 最新一日的 next day 作為 fetch start
                    # 大少 #8573: handle mixed format DB time (富途 SDK 偶爾 return 'YYYY-MM-DD HH:MM:SS')
                    latest_cached_str = max(cached_times)
                    if ' ' in latest_cached_str:
                        latest_cached_str = latest_cached_str.split(' ')[0]
                    elif 'T' in latest_cached_str:
                        latest_cached_str = latest_cached_str.split('T')[0]
                    latest_cached_date = datetime.date.fromisoformat(latest_cached_str)
                    fetch_start_date = max(
                        latest_cached_date + datetime.timedelta(days=1),
                        yesterday_date,
                    )
                else:
                    # cached_times 空 (rare — Step 2 應該已 handle cold cache)
                    fetch_start_date = yesterday_date

                # 只在 missing days 範圍先 fetch (避免 over-fetch)
                if fetch_start_date <= today_date:
                    fetched = await self._fetch_and_store(
                        ctx, code, ktype, period,
                        fetch_start_date.isoformat(), today_date.isoformat(), 10
                    )
                    fetch_count = len(fetched)
                    # 大少 #8551: partial failure log warning
                    expected_days = (today_date - fetch_start_date).days + 1
                    if len(fetched) < expected_days:
                        logger.warning(
                            f"KLineCache partial fetch {code} period={period}: "
                            f"got {len(fetched)}/{expected_days} days "
                            f"from {fetch_start_date} to {today_date}"
                        )

            all_klines = sorted(cached + fetched, key=lambda k: k['time'])
            return {
                'klines': all_klines,
                'cached': len(fetched) == 0,
                'fetch_count': fetch_count,
            }

    async def _fetch_and_store(self, ctx, code: str, ktype, period: str,
                               start: str, end: str,
                               max_count: int) -> list[dict]:
        """大少 #8505: OpenD fetch + DB write (skip time >= today per 大少 #7983).
        大少 #8551: retry 2 attempts on ret != 0 OR data is None (網絡抖動 robustness).
        """

        # 大少 #8551: retry 2 attempts — 網絡抖動 / SDK 暫時失敗
        ret = -1
        data = None
        last_error = None
        for attempt in range(2):
            ret, data, _ = ctx.request_history_kline(
                code=code, ktype=ktype, autype='qfq',
                max_count=max_count, start=start, end=end,
            )
            if ret == 0 and data is not None:
                break
            last_error = f"ret={ret} data={data}"
            logger.warning(
                f"KLineCache fetch attempt {attempt+1}/2 failed "
                f"for {code} period={period}: {last_error}"
            )
            if attempt < 1:
                await asyncio.sleep(0.5)  # brief delay before retry

        # 大少 #8549: 富途 SDK contract 是 ret==0 但 data 可能係 None (冇數據時)。
        # 之前無 check data is None → data.iterrows() → AttributeError 'NoneType' object has no attribute 'iterrows'
        # 紅字錯誤喺 frontend chart 中心顯示, 大少 09:18 報錯。
        if ret != 0 or data is None:
            level = logger.error if ret != 0 else logger.warning
            level(f"KLineCache fetch skip for {code} period={period} ktype={ktype}: {last_error}")
            return []

        today = datetime.date.today().isoformat()
        # 大少 #7983: skip today (T-1 only cache)
        klines = []
        rows_to_insert = []
        for _, row in data.iterrows():
            # 大少 #8573: normalize time 為 date-only (防止 DB mixed format → Step 3 fromisoformat 爆)
            time_str = str(row['time_key'])
            if ' ' in time_str:
                time_str = time_str.split(' ')[0]
            elif 'T' in time_str:
                time_str = time_str.split('T')[0]
            kline = {
                'time': time_str,
                'open': float(row['open']),
                'high': float(row['high']),
                'low': float(row['low']),
                'close': float(row['close']),
                'volume': int(row['volume']),
            }
            klines.append(kline)
            if kline['time'] < today:  # 大少 #7983 rule
                rows_to_insert.append((
                    code, period, kline['time'],
                    kline['open'], kline['high'], kline['low'], kline['close'],
                    kline['volume'], None,  # turnover_rate skip for now
                ))

        if rows_to_insert:
            conn = sqlite3.connect(self.db_path)
            try:
                # 大少 #7983: qfq INSERT OR REPLACE
                conn.executemany(
                    """INSERT OR REPLACE INTO kline_cache
                    (code, period, time, open, high, low, close, volume, turnover_rate)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    rows_to_insert,
                )
                conn.commit()
            finally:
                conn.close()

        return klines

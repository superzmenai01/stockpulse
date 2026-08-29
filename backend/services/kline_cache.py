"""
backend/services/kline_cache.py — KlineCache service (大少 #8505, #8602)

Cache-aside pattern for K-line data:
1. Check DB cache first
2. Detect gaps by comparing DB dates vs OpenD dates (大少 #8602)
3. Fill missing dates from OpenD + write to DB
4. Today's real-time data from OpenD (not in DB, returned to caller)

凡人話 implementation (per大少 push back over-engineer):
- read DB first (大少 #7987)
- T-1 only cache, today from OpenD (大少 #7983)
- missing data auto-fill (大少 #8505)
- date-based gap detection via OpenD comparison (大少 #8602)
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

        大少 2026-08-29 23:55 — dedupe by time (永久 rule):
        之前 HK.00941 K 線 cache 出現 duplicate entries (e.g. 2026-08-24 出現 2 次,
        high=80.10 同 83.00), 之字 algorithm 拎到第二個 entry 嘅極端 value,
        紫線飛上去。喺 service layer dedupe, 1 個 fix 解決所有 caller
        (api/kline.py, api/zigzag_testing.py, frontend testing page, chart)
        一勞永逸, 之後 frontend 唔再需要 defensive code。
        保留第一個 entry (T-1 intraday update 唔會撞原本 K 線, 第一個係 stable value)。
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
            raw = [dict(row) for row in conn.execute(sql, params).fetchall()]
            # 大少 2026-08-29 23:55: dedupe by date (保留第一個 entry)
            # 之前 dedupe by full time 唔 work 因為 backend response 有 2 種 time format
            # 混雜 (date-only "2026-08-26" vs datetime "2026-08-26 00:00:00"),
            # 同 date 嘅 2 個 entry time field 唔同, 用 time[:10] 拎 date part 統一 key
            seen_dates = set()
            deduped = []
            duplicate_count = 0
            for k in raw:
                t = k.get('time')
                if t is None:
                    deduped.append(k)  # 無 time 嘅 entry 保留 (defensive)
                    continue
                date_key = t[:10]  # 統一 YYYY-MM-DD
                if date_key not in seen_dates:
                    seen_dates.add(date_key)
                    deduped.append(k)
                else:
                    duplicate_count += 1
            if duplicate_count > 0:
                logger.warning(
                    f"[KlineCache] dedupe {code} {period}: 拎走 {duplicate_count} 個 duplicate K-line "
                    f"({len(raw)} → {len(deduped)} 條, 保留第一個 entry per date)"
                )
            return deduped
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

    def _insert_klines(self, code: str, period: str, klines: list[dict]) -> int:
        """大少 #8602: Insert klines into DB. Caller responsible for ensuring
        dates < today (per 大少 #7983 T-1 only rule).

        Returns number of rows inserted.
        """
        if not klines:
            return 0
        rows = [
            (code, period, k['time'], k['open'], k['high'], k['low'],
             k['close'], k['volume'], None)
            for k in klines
        ]
        conn = sqlite3.connect(self.db_path)
        try:
            # 大少 #7983: qfq INSERT OR REPLACE
            conn.executemany(
                """INSERT OR REPLACE INTO kline_cache
                (code, period, time, open, high, low, close, volume, turnover_rate)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                rows,
            )
            conn.commit()
            return len(rows)
        finally:
            conn.close()

    async def _fetch_klines(self, ctx, code: str, ktype, period: str,
                            start: str, end: str,
                            max_count: int) -> list[dict]:
        """大少 #8602: Pure OpenD fetch (no DB write). Includes today's real-time data.

        大少 #8551: retry 2 attempts on ret != 0 OR data is None (網絡抖動 robustness).
        大少 #8573: normalize time 為 date-only (防止 DB mixed format → fromisoformat 爆).
        大少 #14000 (2026-08-23): skip 邏輯 `or` → `and` (全部負值先 skip, 拆股前復權 bug 嗰日寫入),
                                  + qfq 拎 0 條 fallback raw (`autype='none'`)。
        """
        ret = -1
        data = None
        last_error = None
        for attempt in range(2):
            # 大少 #11099 (2026-08-07): OpenD qfq 復權對拆股前早期數據有 bug
            # (例 HK.00700 2006-07-24 返 open=-20.88 負值)。OpenD autype='none'
            # 對 HK.00700 完全唔 work (hang timeout),所以 keep qfq fetch。
            # Defensive: 喺 _fetch_klines 過濾負值/極端 close 嘅 row (skip 不入 cache)。
            # 影響: HK.00700 早期 (2006-2014 拆股前) 唔見咗,但拆股後 (2014+) 數據正常。
            # 大少 #14000 (2026-08-23): skip 條件改 `or` → `and` (全部負值先 skip),
            #   拆股前復權 bug 嗰日 (e.g. open 負但 high 正) 寫入, 避免錯過 100% 嘅 K 線。
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

        klines = []
        skipped_invalid = 0
        for _, row in data.iterrows():
            # 大少 #8573: normalize time 為 date-only
            time_str = str(row['time_key'])
            if ' ' in time_str:
                time_str = time_str.split(' ')[0]
            elif 'T' in time_str:
                time_str = time_str.split('T')[0]
            try:
                o = float(row['open'])
                h = float(row['high'])
                l = float(row['low'])
                c = float(row['close'])
                v = int(row['volume'])
            except (TypeError, ValueError) as e:
                skipped_invalid += 1
                logger.warning(
                    f"KLineCache skip invalid row {code} {time_str}: {e}"
                )
                continue
            # 大少 #11099 (2026-08-07): OpenD qfq 復權對拆股前早期數據有 bug
            # (例 HK.00700 2006-07-24 返 open=-20.88)。Defensive filter 跳過
            # 任何 OHLC 為負值嘅 row (唔入 cache, 唔返 response)。
            # 影響: HK.00700 拆股前 2006-2014 數據會被 filter,但拆股後正常。
            # 大少 #14000 (2026-08-23): skip 條件改 `or` → `and` (全部負值先 skip),
            #   拆股前復權 bug 嗰日 (e.g. open 負但 high 正) 寫入, 避免錯過 100% 嘅 K 線。
            if o < 0 and h < 0 and l < 0 and c < 0:
                skipped_invalid += 1
                logger.warning(
                    f"KLineCache skip all-negative OHLC {code} {time_str}: "
                    f"o={o}, h={h}, l={l}, c={c} (OpenD qfq 復權 bug, fallback raw next)"
                )
                continue
            klines.append({
                'time': time_str,
                'open': o,
                'high': h,
                'low': l,
                'close': c,
                'volume': v,
            })
        if skipped_invalid:
            logger.info(
                f"KLineCache {code} period={period}: filtered {skipped_invalid} all-negative rows"
            )

        # 大少 #14000 (2026-08-23): qfq 拎唔到 K 線 (拆股前復權 bug 影響 100% K 線)
        # → fallback 用 autype='none' (raw 不復權) 拎返真實 K 線值。
        # 影響: 拆股前用 raw K 線 (真實值), 拆股後用 qfq K 線 (對齊富途 app 預設)。
        if not klines and skipped_invalid > 0 and data is not None and len(data) > 0:
            # data 有但全部被 skip → fallback raw
            logger.warning(
                f"KLineCache {code} period={period}: qfq all-negative OHLC, "
                f"fallback to autype='none' (raw) for {len(data)} rows"
            )
            try:
                ret_raw, data_raw, _ = ctx.request_history_kline(
                    code=code, ktype=ktype, autype='none',
                    max_count=max_count, start=start, end=end,
                )
                if ret_raw == 0 and data_raw is not None:
                    for _, row in data_raw.iterrows():
                        time_str = str(row['time_key'])
                        if ' ' in time_str:
                            time_str = time_str.split(' ')[0]
                        elif 'T' in time_str:
                            time_str = time_str.split('T')[0]
                        try:
                            o = float(row['open'])
                            h = float(row['high'])
                            l = float(row['low'])
                            c = float(row['close'])
                            v = int(row['volume'])
                        except (TypeError, ValueError):
                            continue
                        klines.append({
                            'time': time_str,
                            'open': o,
                            'high': h,
                            'low': l,
                            'close': c,
                            'volume': v,
                        })
                    logger.info(
                        f"KLineCache {code} period={period}: fallback raw got {len(klines)} klines"
                    )
            except Exception as e:
                logger.warning(
                    f"KLineCache fallback raw fetch failed for {code}: {e}"
                )

        return klines

    @staticmethod
    def _compute_fetch_max_count(period: str) -> int:
        """Fix 2: max_count override for OpenD fetch (cold + warm cache 共用).

        大少 #8602 + #8484: max_count 要夠大去 cover 整個 window,
        唔係就會 miss 早期嘅缺口。
        30年 daily K ≈ 10950, 10年 ≈ 3650.
        """
        if period == '1d':
            return 30 * 365
        return 10 * 365

    async def _fetch_today_bar(self, ctx, code: str, ktype,
                               period: str) -> Optional[dict]:
        """Fix 3: 拎今日 real-time bar via ctx.get_cur_kline().

        大少 #7983 T-1 rule: today NEVER written to DB.
        用 get_cur_kline 唔係 request_history_kline, 因為
        request_history_kline 對 today 可能只 return 已 close 嘅 bar
        (or 空 if 開市前), get_cur_kline 拎 intraday partial bar.

        Try/except 包住成個 body: mock context or OpenD quirk → return None,
        唔 crash cache flow.
        """
        try:
            ret, data = ctx.get_cur_kline(
                code=code, num=1, ktype=ktype, autype='qfq',
            )
            if ret != 0 or data is None:
                return None
            try:
                if len(data) == 0:
                    return None
            except TypeError:
                return None
            row = data.iloc[-1]
            # 大少 #8573: normalize time 為 date-only
            time_str = str(row['time_key'])
            if ' ' in time_str:
                time_str = time_str.split(' ')[0]
            elif 'T' in time_str:
                time_str = time_str.split('T')[0]
            return {
                'time': time_str,
                'open': float(row['open']),
                'high': float(row['high']),
                'low': float(row['low']),
                'close': float(row['close']),
                'volume': int(row['volume']),
            }
        except Exception as e:
            logger.debug(
                f"KLineCache _fetch_today_bar skip for {code} period={period}: {e}"
            )
            return None

    async def get_or_fetch(self, code: str, ctx, ktype, period: str = '1d',
                           start: Optional[str] = None,
                           end: Optional[str] = None,
                           max_count: int = 1000) -> dict:
        """Main entry point — cache-aside.

        大少 #8505: 先查 DB, missing data 即補 from OpenD.
        大少 #8602: 對標 OpenD 日期 vs DB 日期, 缺咗邊啲補邊啲.
                   Wide-fetch from earliest_cached to today, diff against DB,
                   insert missing dates only. Today's real-time from OpenD
                   (NOT in DB per 大少 #7983 T-1 only) but returned to caller.
        Fix 4: gap-fill 唔再 gated by today_in_range — fetch window 由
               earliest_cached 到 today, cached_times = full cache。
        Fix 3: today's real-time via _fetch_today_bar (get_cur_kline)。
        Fix 2: cold + warm cache 共用 _compute_fetch_max_count(period)。
        Returns: {'klines': [...], 'cached': bool, 'fetch_count': int}
        """
        lock = await _get_lock(code)
        async with lock:
            today = datetime.date.today().isoformat()
            today_in_range = (not end or end >= today) and (not start or start <= today)

            # Step 1: read user-range cached (for response merge)
            cached = self.get_klines(code, period, start, end)
            # Fix 4: 全部 cache times (no filter) for cross-range gap detection
            all_cache_rows = self.get_klines(code, period) if cached else []
            cached_times = {row['time'] for row in all_cache_rows} if all_cache_rows else set()

            all_klines_dict: dict[str, dict] = {}
            fetch_count = 0
            cached_flag = False

            # Step 2: cold cache — fetch full range (insert all < today)
            if not cached:
                # 大少 #8484: 30 years backtest window
                fetch_start = start or '1996-01-01'
                fetch_end = end or today
                # Fix 2: cold cache override max_count (唔再用 caller 嘅 count, 通常得 100)
                fetch_max_count = self._compute_fetch_max_count(period)
                fetched = await self._fetch_klines(
                    ctx, code, ktype, period, fetch_start, fetch_end, fetch_max_count
                )
                # 大少 #7983: insert all < today, today kept in response only
                rows_to_insert = [k for k in fetched if k['time'] < today]
                if rows_to_insert:
                    self._insert_klines(code, period, rows_to_insert)
                # 大少 2026-08-30 00:25: 用 date[:10] 做 key 統一, 避免 time format 混雜
                # (date-only "2026-08-26" vs datetime "2026-08-26 00:00:00") 撞 duplicate
                for k in fetched:
                    all_klines_dict[k['time'][:10]] = k
                fetch_count = len(fetched)
                cached_flag = False
            else:
                # Step 3: warm cache — gap fill (NOT gated by today_in_range)
                # 大少 #8602: 唔用交易日曆, 直接 compare DB dates vs OpenD dates.
                # Wide fetch 由 earliest_cached 到 today, 咁就可以 detect
                # 中間任何缺口 (e.g. HK.00700 7月28 → 8月4 中間缺口).
                # Fix 4: Fetch window 用 earliest_cached → today, NOT user start/end.
                earliest_cached_str = min(cached_times)
                # 大少 #8573: normalize earliest_cached time format
                if ' ' in earliest_cached_str:
                    earliest_cached_str = earliest_cached_str.split(' ')[0]
                elif 'T' in earliest_cached_str:
                    earliest_cached_str = earliest_cached_str.split('T')[0]

                fetch_start = earliest_cached_str
                fetch_end = today
                # Fix 2: shared helper
                fetch_max_count = self._compute_fetch_max_count(period)

                fetched = await self._fetch_klines(
                    ctx, code, ktype, period,
                    fetch_start, fetch_end, fetch_max_count
                )

                # Filter fetched by user's start/end (OpenD might return extra)
                if start:
                    fetched = [k for k in fetched if k['time'] >= start]
                if end:
                    fetched = [k for k in fetched if k['time'] <= end]
                fetch_count = len(fetched)

                # Fix 4: 對標 OpenD dates vs FULL cache times (唔係 user range)
                fetched_times = {row['time'] for row in fetched}
                missing_dates = fetched_times - cached_times

                if missing_dates:
                    # 大少 #7983: today excluded — kept in response only, never in DB
                    missing_klines = [
                        k for k in fetched
                        if k['time'] in missing_dates and k['time'] < today
                    ]
                    if missing_klines:
                        inserted = self._insert_klines(code, period, missing_klines)
                        sample = sorted([k['time'] for k in missing_klines])[:5]
                        logger.info(
                            f"KLineCache gap-fill {code} period={period}: "
                            f"filled {inserted} missing dates "
                            f"(sample: {sample}{'...' if len(missing_klines) > 5 else ''})"
                        )

                # Merge cached (user-range) + fetched (user-range filtered)
                # 大少 2026-08-30 00:25: 用 date[:10] 做 key 統一, 避免 time format 混雜撞 duplicate
                for k in cached:
                    all_klines_dict[k['time'][:10]] = k
                for k in fetched:
                    all_klines_dict[k['time'][:10]] = k

                # 大少 #8551: partial failure log warning
                expected = (datetime.date.fromisoformat(fetch_end)
                            - datetime.date.fromisoformat(fetch_start)).days + 1
                if fetch_count < expected:
                    logger.debug(
                        f"KLineCache partial fetch {code} period={period}: "
                        f"got {fetch_count} OpenD days, expected ~{expected} "
                        f"(holidays/weekends reduce count)"
                    )

                cached_flag = (fetch_count == 0)

            # Step 4: Fix 3 — today's real-time from get_cur_kline (independent of path)
            # 跟 T-1 rule: today NEVER written to DB.
            # Append 去 all_klines_dict (key = today[:10]), 跟住會 overwrite history fetch 嘅 today bar.
            # 大少 2026-08-30 00:25: 用 date[:10] 做 key 統一, 避免 time format 混雜撞 duplicate
            if today_in_range:
                today_bar = await self._fetch_today_bar(ctx, code, ktype, period)
                if today_bar:
                    all_klines_dict[today_bar['time'][:10]] = today_bar

            all_klines = sorted(all_klines_dict.values(), key=lambda k: k['time'])

            return {
                'klines': all_klines,
                'cached': cached_flag,
                'fetch_count': fetch_count,
            }

    async def _fetch_and_store(self, ctx, code: str, ktype, period: str,
                               start: str, end: str,
                               max_count: int) -> list[dict]:
        """大少 #8505: OpenD fetch + DB write (skip time >= today per 大少 #7983).
        大少 #8551: retry 2 attempts on ret != 0 OR data is None.
        大少 #8602: thin wrapper around _fetch_klines + _insert_klines.
        """
        klines = await self._fetch_klines(ctx, code, ktype, period, start, end, max_count)
        today = datetime.date.today().isoformat()
        rows_to_insert = [k for k in klines if k['time'] < today]
        self._insert_klines(code, period, rows_to_insert)
        return klines

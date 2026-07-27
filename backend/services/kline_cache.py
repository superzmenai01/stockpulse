"""
K線本地 Cache Service

大少 2026-07-28 #7987 trigger：cache-aside pattern for 1d K-line
================================================================

Design:
- 即時數據永遠 OpenD（不 cache），保留現有 /api/snapshot endpoint
- K-line cache 永遠 ≤ T-1（前一個交易日）— 即日數據不入 DB
- Floating window: fetch 時 `start = today - 10 years`
- Phase 1 only: period = '1d'（其他 period 走 fallback 直接 OpenD）

Why these decisions:
- 大少 #7985：floating window（適應新查股票可能上市 < 10 年）
- 大少 #7985：Phase 1 只 cache 1d（最常用，data 量可控）
- 大少 #7985：唔加 TTL（OpenD quota 唔使理）
- 大少 #7983：single user → asyncio.Lock per-code 已 cover race
- 大少 #7983：即日不寫 DB → 避免 staleness
- INSERT OR REPLACE：每次 fetch 重新 qfq overwrite（拆股/派息後自動更新）

Not in this PR (留 for Phase 2/3):
- TTL cache
- pre-warm background scheduler
- multi-period cache (1w, 1M)
- real-time tick write
- metrics endpoint (cache hit rate)
- manual flush button
"""

import logging
import sqlite3
import asyncio
import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


# ----------------------------------------------------------------
# Schema — CREATE TABLE IF NOT EXISTS (idempotent)
# ----------------------------------------------------------------
# 大少 2026-07-28 #7987:
# - PRIMARY KEY (code, period, time) → upsert via INSERT OR REPLACE
# - INDEX (code, period, time DESC) → 主要 query pattern (latest N rows)
# - last_fetched_at → debug 用，知道呢條 row 幾時更新過
# - turnover_rate → per candle 換手率（volume / outstanding_shares * 100）
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS kline_cache (
    code            TEXT NOT NULL,
    period          TEXT NOT NULL,
    time            TEXT NOT NULL,
    open            REAL,
    high            REAL,
    low             REAL,
    close           REAL,
    volume          INTEGER,
    turnover_rate   REAL,
    last_fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (code, period, time)
);

CREATE INDEX IF NOT EXISTS idx_kline_lookup
ON kline_cache(code, period, time DESC);
"""


# ----------------------------------------------------------------
# Per-code asyncio locks (multi-tab race protection)
# ----------------------------------------------------------------
# 大少 #7983：single user → 但 multi-tab 仍可能 race
# asyncio.Lock per-code → 同一 stock 嘅 concurrent fetch serialize
# 用 dict lazy-init，避免每個 KlineCache instance 自己一份
_locks: dict[str, asyncio.Lock] = {}
_locks_meta_lock = asyncio.Lock()


async def _get_lock(code: str) -> asyncio.Lock:
    """Get or create asyncio.Lock for specific code. Thread-safe via meta-lock."""
    if code not in _locks:
        async with _locks_meta_lock:
            if code not in _locks:
                _locks[code] = asyncio.Lock()
    return _locks[code]


class KlineCache:
    """
    Cache-aside service for K-line history data.

    Phase 1 scope: period='1d' only.

    Usage:
        cache = KlineCache()  # uses default DB path
        result = await cache.get_or_fetch(
            code='HK.00981', ctx=quote_ctx, period='1d',
            count=100, start=None, end=None,
        )
        # result = {'klines': [...], 'cached': bool, 'fetch_count': int, 'error': str|None}
    """

    DEFAULT_DB_PATH = Path(__file__).parent.parent / "stockpulse.db"
    HISTORY_YEARS = 10
    CACHEABLE_PERIODS = frozenset({'1d'})
    MAX_FETCH_COUNT = 5000  # 10 years ~2500 trading days, 5000 safe margin

    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or self.DEFAULT_DB_PATH
        self._init_db()

    def _init_db(self):
        """
        Create table + index if not exists. Idempotent.

        大少 2026-07-28: 建 schema 用 executescript (multi-statement)
        """
        try:
            conn = sqlite3.connect(str(self.db_path))
            try:
                conn.executescript(SCHEMA_SQL)
                conn.commit()
                logger.info(f"[KlineCache] DB init at {self.db_path}")
            finally:
                conn.close()
        except Exception as e:
            logger.error(f"[KlineCache] DB init 失敗: {e}")
            raise

    # ============================================================
    # DB read helpers
    # ============================================================

    def get_latest_time(self, code: str, period: str) -> Optional[str]:
        """
        Return max(time) for (code, period), or None if no rows.

        Use to decide whether to fetch incrementally.
        """
        conn = sqlite3.connect(str(self.db_path))
        try:
            row = conn.execute(
                "SELECT MAX(time) FROM kline_cache WHERE code=? AND period=?",
                (code, period),
            ).fetchone()
            return row[0] if row and row[0] else None
        finally:
            conn.close()

    def get_klines(
        self,
        code: str,
        period: str,
        count: int = 100,
        start: Optional[str] = None,
        end: Optional[str] = None,
    ) -> list[dict]:
        """
        Read klines from DB (no fetch). ORDER BY time ASC LIMIT count.

        大少 #8042 Fix-2: lightweight-charts requires ASC order (setData throws
        assertion if data not strictly ascending by time).

        Optional start/end filters (inclusive on both sides).
        """
        conn = sqlite3.connect(str(self.db_path))
        try:
            sql = (
                "SELECT time, open, high, low, close, volume, turnover_rate "
                "FROM kline_cache WHERE code=? AND period=?"
            )
            params: list = [code, period]
            if start:
                sql += " AND time >= ?"
                params.append(start)
            if end:
                sql += " AND time <= ?"
                params.append(end)
            sql += " ORDER BY time ASC LIMIT ?"
            params.append(count)

            rows = conn.execute(sql, params).fetchall()
            return [
                {
                    'time': r[0],
                    'open': r[1],
                    'high': r[2],
                    'low': r[3],
                    'close': r[4],
                    'volume': r[5],
                    'turnover_rate': r[6],
                }
                for r in rows
            ]
        finally:
            conn.close()

    # ============================================================
    # Cache-aside main entry point
    # ============================================================

    async def get_or_fetch(
        self,
        code: str,
        ctx,
        period: str = '1d',
        count: int = 100,
        start: Optional[str] = None,
        end: Optional[str] = None,
    ) -> dict:
        """
        Cache-aside pattern:
        1. 查 DB max(time)
        2. 決定 fetch 範圍（cold = 10y, warm = 增量）
        3. Fetch OpenD + bulk insert (transaction)
        4. 從 DB 攞 return

        即日數據 (time >= today) **不寫 DB**（大少 #7983 規則）

        Returns:
            {
                'klines': [...],
                'cached': True,
                'fetch_count': int,  # 本次 call 寫入 DB 嘅 row 數
                'error': None,
            }
        """
        if period not in self.CACHEABLE_PERIODS:
            # Non-cached period → fallback 直接 OpenD
            return await self._fetch_direct_only(code, ctx, period, count, start, end)

        lock = await _get_lock(code)
        async with lock:
            try:
                today = datetime.date.today().isoformat()
                db_latest = self.get_latest_time(code, period)

                fetch_count = 0
                if db_latest is None:
                    # Cold cache: fetch 10 years
                    fetch_start = (
                        datetime.date.today()
                        - datetime.timedelta(days=365 * self.HISTORY_YEARS)
                    ).isoformat()
                    fetch_end = today
                    fetch_count = await self._fetch_and_store(
                        code, ctx, period, fetch_start, fetch_end,
                    )
                    logger.info(
                        f"[KlineCache] Cold cache: {code} {period} "
                        f"fetched {fetch_count} rows from {fetch_start}"
                    )
                elif db_latest < today:
                    # Warm cache: incremental fetch (db_latest+1 → today)
                    # OpenD 會自動 skip 非交易日
                    db_latest_date = datetime.date.fromisoformat(db_latest)
                    fetch_start = (db_latest_date + datetime.timedelta(days=1)).isoformat()
                    fetch_end = today
                    if fetch_start <= fetch_end:
                        fetch_count = await self._fetch_and_store(
                            code, ctx, period, fetch_start, fetch_end,
                        )
                        logger.info(
                            f"[KlineCache] Incremental: {code} {period} "
                            f"fetched {fetch_count} rows ({fetch_start} → {fetch_end})"
                        )
                # else: db_latest >= today → DB 已是 ≤ T-1，skip

                # Read from DB (always fresh after potential insert)
                klines = self.get_klines(code, period, count=count, start=start, end=end)

                return {
                    'klines': klines,
                    'cached': True,
                    'fetch_count': fetch_count,
                    'error': None,
                }

            except Exception as e:
                logger.error(f"[KlineCache] get_or_fetch {code} {period} 失敗: {e}")
                # Fallback: 直接 OpenD (don't propagate error to user)
                return await self._fetch_direct_only(
                    code, ctx, period, count, start, end, error=str(e),
                )

    # ============================================================
    # Internal: OpenD fetch + bulk insert
    # ============================================================

    async def _fetch_and_store(
        self,
        code: str,
        ctx,
        period: str,
        start: str,
        end: str,
    ) -> int:
        """
        Fetch OpenD + bulk insert (transaction).

        大少 #7987: 即日數據不寫 DB (time >= today 跳過)
        大少 #7983: 復權 qfq overwrite — 用 INSERT OR REPLACE

        Returns: number of rows inserted.
        Raises: if OpenD fails (caller handles fallback).
        """
        from futu import KLType

        ktype = KLType.K_DAY  # Phase 1 only supports '1d'
        logger.info(f"[KlineCache] OpenD fetch {code} {period} {start} → {end}")

        ret, data, page_key = ctx.request_history_kline(
            code=code,
            ktype=ktype,
            autype='qfq',
            max_count=self.MAX_FETCH_COUNT,
            start=start,
            end=end,
        )

        if ret != 0:
            logger.error(f"[KlineCache] OpenD 錯誤: {data}")
            raise RuntimeError(f"OpenD error: {data}")

        if data is None or len(data) == 0:
            logger.info(f"[KlineCache] OpenD 返 0 rows for {code} {period}")
            return 0

        # Get outstanding_shares for turnover_rate
        outstanding_shares = 0
        try:
            ret_snap, snap_data = ctx.get_market_snapshot([code])
            if ret_snap == 0 and len(snap_data) > 0 and 'outstanding_shares' in snap_data.columns:
                outstanding_shares = float(snap_data.iloc[0]['outstanding_shares'] or 0)
                logger.debug(f"[KlineCache] {code} outstanding_shares = {outstanding_shares:,.0f}")
        except Exception as e:
            logger.warning(f"[KlineCache] 取 outstanding_shares 失敗: {e}")

        # Build rows (skip 即日數據)
        today = datetime.date.today().isoformat()
        rows = []
        for _, row in data.iterrows():
            # time_key 格式: 'YYYY-MM-DD HH:MM:SS' → 'YYYY-MM-DD'
            time_str = str(row['time_key'])[:10]
            if time_str >= today:
                # 大少 #7983: 即日不寫 DB
                continue

            volume = int(row['volume'])
            turnover_rate = None
            if outstanding_shares > 0:
                turnover_rate = round((volume / outstanding_shares) * 100, 3)

            rows.append((
                code, period, time_str,
                float(row['open']), float(row['high']),
                float(row['low']), float(row['close']),
                volume, turnover_rate,
            ))

        if not rows:
            logger.info(f"[KlineCache] No rows to insert (all 即日)")
            return 0

        # Bulk insert with transaction (大少 #7983: failure handling)
        conn = sqlite3.connect(str(self.db_path))
        try:
            conn.execute("BEGIN")
            conn.executemany(
                """
                INSERT OR REPLACE INTO kline_cache
                (code, period, time, open, high, low, close,
                 volume, turnover_rate, last_fetched_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                rows,
            )
            conn.commit()
            logger.info(f"[KlineCache] Inserted {len(rows)} rows for {code} {period}")
            return len(rows)
        except Exception as e:
            conn.rollback()
            logger.error(f"[KlineCache] Bulk insert 失敗: {e}")
            raise
        finally:
            conn.close()

    # ============================================================
    # Fallback: 直接 OpenD（用嚟俾 non-cached period + failure recovery）
    # ============================================================

    async def _fetch_direct_only(
        self,
        code: str,
        ctx,
        period: str,
        count: int,
        start: Optional[str],
        end: Optional[str],
        error: Optional[str] = None,
    ) -> dict:
        """
        直接從 OpenD fetch，不寫 DB。

        Used by:
        - Non-cached period (1m, 1M, 1y)
        - Failure fallback (when cache path fails)
        """
        from futu import KLType

        PERIOD_MAP = {
            '1m': KLType.K_1M,
            '1d': KLType.K_DAY,
            '1M': KLType.K_MON,
            '1y': KLType.K_YEAR,
        }
        ktype = PERIOD_MAP.get(period)
        if ktype is None:
            return {
                'klines': [], 'cached': False, 'fetch_count': 0,
                'error': f'不支援的週期: {period}',
            }

        try:
            ret, data, page_key = ctx.request_history_kline(
                code=code, ktype=ktype, autype='qfq',
                max_count=count,
                start=start or '', end=end or '',
            )
            if ret != 0:
                return {
                    'klines': [], 'cached': False, 'fetch_count': 0,
                    'error': f'OpenD: {data}',
                }

            klines = []
            for _, row in data.iterrows():
                klines.append({
                    'time': row['time_key'],
                    'open': float(row['open']),
                    'high': float(row['high']),
                    'low': float(row['low']),
                    'close': float(row['close']),
                    'volume': int(row['volume']),
                })
            return {
                'klines': klines,
                'cached': False,
                'fetch_count': len(klines),
                'error': error,  # pass through fallback warning
            }
        except Exception as e:
            return {
                'klines': [], 'cached': False, 'fetch_count': 0,
                'error': str(e),
            }


# ----------------------------------------------------------------
# Singleton accessor
# ----------------------------------------------------------------
_cache: Optional[KlineCache] = None


def get_kline_cache() -> KlineCache:
    """
    Get singleton KlineCache instance.

    DB path defaults to backend/stockpulse.db.
    Re-instantiation won't happen (singleton).
    """
    global _cache
    if _cache is None:
        _cache = KlineCache()
    return _cache
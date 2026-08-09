"""
api/stock_price.py — 即時股價 endpoint (大少 2026-08-09 15:45 揀, Stage 1+ 即時股價)

從 Futu OpenD 拎今日 partial bar (ctx.get_cur_kline + KLType.K_DAY)。
- is_market_open 簡單 weekday + hour 判斷 (HK 9:30-16:00, US HKT 21:30-04:00 next day)
- is_stale 拎唔到 price (休市 / 網絡) → keep last known (frontend 處理)
- 公眾假期 / DST 唔處理 (簡單版)

Spec: docs/research/AS-03-cycle-detection/MODULE-13-LATEST-PRICE.md
"""
import datetime
import logging

from fastapi import APIRouter, HTTPException
from futu import KLType

from futu_conn import get_quote_ctx

router = APIRouter(prefix="/api/stock-price", tags=["stock-price"])

logger = logging.getLogger(__name__)


def is_market_open(symbol: str, now: datetime.datetime) -> bool:
    """簡單 weekday + hour 判斷 (公眾假期 / DST 唔處理).

    HK 開市: 9:30-12:00 + 13:00-16:00 (Mon-Fri, HKT)
    US 開市: HKT 21:30-04:00 next day (Mon-Fri, 簡化, 唔分夏冬令)

    Args:
        symbol: 'HK.00700' / 'US.AAPL' etc.
        now: server local datetime (Mac = HKT)
    """
    if now.weekday() >= 5:  # Sat/Sun
        return False
    hm = now.hour * 60 + now.minute
    if symbol.startswith("HK."):
        return (9 * 60 + 30 <= hm <= 12 * 60) or (13 * 60 <= hm <= 16 * 60)
    elif symbol.startswith("US."):
        # HKT 21:30 - 04:00 next day
        return (hm >= 21 * 60 + 30) or (hm <= 4 * 60)
    else:
        # fallback 假設 HK
        return (9 * 60 + 30 <= hm <= 12 * 60) or (13 * 60 <= hm <= 16 * 60)


def get_currency(symbol: str) -> str:
    if symbol.startswith("HK."):
        return "HKD"
    elif symbol.startswith("US."):
        return "USD"
    return "HKD"


@router.get("/{symbol}")
async def get_latest_price(symbol: str) -> dict:
    """[GET] 拎即時股價 (今日 partial bar 嘅 close price).

    大少 15:45 揀:
    - 5 秒 polling 自動 update
    - 休市時 keep last known price + time, 加 (休市) caption
    - Backend source: ctx.get_cur_kline (已存在, KLineCache._fetch_today_bar 都用)
    - 簡單 weekday + hour 判斷 is_market_open
    - 公眾假期 / DST 唔處理 (Stage 1+ 簡單版)

    Response 200 (拎到):
    {
      "symbol": "HK.00700",
      "price": 497.50,
      "time": "2026-08-09T15:35:42",
      "bar_time": "15:35:42",
      "is_market_open": true,
      "is_stale": false,
      "currency": "HKD"
    }

    Response 200 (拎唔到, is_stale=true):
    {
      "symbol": "HK.00700",
      "price": null,
      "time": "2026-08-09T15:35:42",
      "is_market_open": false,
      "is_stale": true,
      "currency": "HKD",
      "message": "Futu 拎唔到 price (可能休市 / 未連接)"
    }

    Response 503: Futu OpenD 連接未建立
    """
    now = datetime.datetime.now()
    is_open = is_market_open(symbol, now)
    currency = get_currency(symbol)

    try:
        ctx = get_quote_ctx()
        if ctx is None:
            # Dev 環境 (TestClient 唔 trigger FastAPI lifespan) 或者 OpenD 連接未建立
            # 返 200 + is_stale=true, frontend polling loop 唔會 break
            return {
                "symbol": symbol,
                "price": None,
                "time": now.isoformat(timespec="seconds"),
                "is_market_open": is_open,
                "is_stale": True,
                "currency": currency,
                "message": "Futu OpenD 連接未建立 (test/dev 環境或者 OpenD 未開)",
            }
        # 同步 call (Futu SDK), 唔需要 await
        ret, data = ctx.get_cur_kline(
            code=symbol, num=1, ktype=KLType.K_DAY, autype="qfq",
        )
        if ret != 0 or data is None:
            return {
                "symbol": symbol,
                "price": None,
                "time": now.isoformat(timespec="seconds"),
                "is_market_open": is_open,
                "is_stale": True,
                "currency": currency,
                "message": "Futu 拎唔到 price (ret != 0 or data is None)",
            }
        try:
            if len(data) == 0:
                return {
                    "symbol": symbol,
                    "price": None,
                    "time": now.isoformat(timespec="seconds"),
                    "is_market_open": is_open,
                    "is_stale": True,
                    "currency": currency,
                    "message": "Futu 返空 data (可能未開市)",
                }
        except TypeError:
            return {
                "symbol": symbol,
                "price": None,
                "time": now.isoformat(timespec="seconds"),
                "is_market_open": is_open,
                "is_stale": True,
                "currency": currency,
                "message": "Futu 返 data 唔係 iterable",
            }
        row = data.iloc[-1]
        # 大少 #8573: normalize time, bar_time 拎 HH:MM:SS 部分
        time_str = str(row["time_key"])
        bar_time = None
        if " " in time_str:
            bar_time = time_str.split(" ")[1]  # HH:MM:SS
        elif "T" in time_str:
            bar_time = time_str.split("T")[1].split("+")[0].split(".")[0]
        return {
            "symbol": symbol,
            "price": float(row["close"]),
            "time": now.isoformat(timespec="seconds"),
            "bar_time": bar_time,
            "is_market_open": is_open,
            "is_stale": False,
            "currency": currency,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[stock-price] {symbol} error: {e}")
        return {
            "symbol": symbol,
            "price": None,
            "time": now.isoformat(timespec="seconds"),
            "is_market_open": is_open,
            "is_stale": True,
            "currency": currency,
            "message": str(e),
        }

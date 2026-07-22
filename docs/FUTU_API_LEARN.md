# 富途牛牛 OpenAPI 完整學習手冊

> **最後更新**：2026-07-21（整合 + v10.9 最新版，特別 Search 功能）
> **官方文檔**：https://openapi.futunn.com/futu-api-doc/en/
> **對應 OpenD 版本**：**v10.9.6908**（2026-07-17 確認，PID 663，路徑 `/Applications/Futu_OpenD.app/`，監聽 `localhost:11111`）
> **本地 mirror**：本檔整合自 TOOLS.md 「📈 Futu OpenD v2」section + docs/FUTU_API_LEARN.md (舊) + Futu 官方 Changelog

> ⚠️ **重要（2026-07-21 大少指示）**：寫算法時主要用到 FutuD API 功能，**一定要小心處理和好好利用**：
> - 訂閱後至少 1 分鐘才可取消（避免 throttle）
> - 報價卡需要另外買
> - 落單預設 `FUTU_ENABLE_TRADING=0`，需明確開啟
> - Error / Edge case 要 fallback（網絡、停牌、新上市）

---

## 📑 目錄

1. [基礎架構](#1-基礎架構)
2. [OpenD 配置](#2-opend-配置)
3. [🆕 Universal Account 概念（v10.x）](#3-universal-account-概念)
4. [🆕 近期版本重點（v10.5-v10.9）](#4-近期版本重點)
5. [🆕 Search API（v10.8 新增）⭐](#5-search-api)
6. [🆕 Stock Screening V2（v10.6 新增）](#6-stock-screening-v2)
7. [行情 API](#7-行情-api)
8. [⚠️ 重要規則 / 小心處理](#8-重要規則)
9. [交易 API](#9-交易-api)
10. [API 文檔導航](#10-api-文檔導航)
11. [💡 StockPulse 應用](#11-stockpulse-應用)

---

## 1. 基礎架構

```
┌─────────────┐     TCP      ┌─────────────┐     HTTP      ┌─────────────┐
│   Python    │ ──────────►  │   OpenD     │ ────────────► │  富途服務器  │
│  (你的代碼)  │              │ (本地網關)   │              │             │
└─────────────┘              └─────────────┘              └─────────────┘
     Port 11111                  Port 11111
```

### 兩種帳戶

| 帳戶類型 | 說明 |
|---------|------|
| **Futu ID** | 牛牛號，可用於 Futubull APP 和 API |
| **Universal Account**（v10.x 新概念） | 通用帳戶，跨市場交易（多貨幣結算） |

---

## 2. OpenD 配置

### 安裝（兩種方式）

| 方式 | 適合 | 啟動 |
|---|---|---|
| **可視化 OpenD** | 入門用戶 | GUI 操作 |
| **命令行 OpenD** | 服務器掛機、自動化 | `opend` 命令行 |

支援平台：**Windows / MacOS / CentOS / Ubuntu**

下載：[官網下載頁](https://www.futunn.com/download/fetch-lasted-link?name=opend-macos)（Mac 用）

### 連接參數

```python
host = '127.0.0.1'
port = 11111
```

### WebSocket 配置

| 參數 | 說明 |
|------|------|
| IP | API 監聽 IP |
| Port | API 監聽端口 |
| WebSocket IP | WebSocket 監聽地址 |
| WebSocket Port | WebSocket 監聽端口 |

---

## 3. Universal Account 概念

v10.x 新概念：**單一帳戶跨市場交易**（多貨幣結算）

3 種形式：

| 形式 | 範圍 |
|---|---|
| **Universal Account - Securities** | 股票、ETF、期權、跨市場證券 |
| **Universal Account - Futures** | 港股、美國 CME、新加坡、日本期貨 |
| **Universal Account - Crypto** | FUTU HK、Moomoo US、Moomoo SG |

### 支援市場（行情）

| 市場 | 支援 |
|---|---|
| 香港 | ✅ 股票/ETF/窩輪/牛熊/界內證/期權/期貨/指數/板塊 |
| 美國 | ✅ 股票/ETF/期權/期貨（OTC 股票、指數 ❌）|
| A 股 | ✅ 股票/ETF/指數/板塊 |
| 新加坡 | ✅ 股票/ETF/REITs/DLC/窩輪 |
| 馬來西亞 | ✅ 股票/ETF/窩輪/REITs |
| 日本 | ✅ 股票/ETF（期貨 ❌）|
| 加密貨幣 | ✅ |
| 預測市場（事件合約）| ✅ |

### 交易支援 Matrix（v10.x）

| Market | FUTU HK | Moomoo US | Moomoo SG | Moomoo AU | Moomoo MY | Moomoo CA | Moomoo JP |
|---|---|---|---|---|---|---|---|
| HK 股票/ETF | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| US 股票/ETF | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| A 股 China Connect | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| SG 股票/期貨 | X/X | ✅/✅ | X/X | ✅/✅ | X/X | X/X | X/X |
| JP 股票 | X | X | X | X | X | X | ✅ |
| Crypto | X | ✅ | ✅ | X | X | X | X |
| Options | ✅ | ✅ | X | X | X | X | X |
| Futures | ✅ | ✅ | X | ✅ | X | ✅ | X |

- **真實交易 + 模擬交易用同一套 API**（差在 `TrdEnv.REAL` / `TrdEnv.SIMULATE`）
- US Margin Trading Simulation：API 可下 paper order，即時同步 App

---

## 4. 近期版本重點

從官方 Changelog 整理（[原文](https://openapi.futunn.com/futu-api-doc/en/changelog/changelog.html)）

| 版本 | 日期 | 主要 features |
|---|---|---|
| **10.9.6908** | 2026-07-15 | 最新 stable 版本 |
| **10.8.6808** | 2026-06-25 | **🆕 Search API**（關鍵字搵 asset/news/ratings）、**0DTE Options**、Chart Indicators (Mai+Python)、Market Fundamentals API (Institutional Tracker、Macroeconomic、Fed Rate Projections) |
| **10.7.6708** | 2026-06-04 | SG/MY/JP 報價 + 落單、**Options Strategies** (straddle/spread/butterfly)、Combo Order |
| **10.6.6608** | 2026-05-21 | **🆕 Stock Screening V2**（5 dimensions）、Get Financial Statements（3 大表 + 分析師評級 + PE/PB/PS + 內幕交易 + 大戶持股）|
| **10.5.6508** | 2026-05-07 | Crypto 報價 + 落單 (HK/US/SG)、Universal Crypto Account、新 K 線 intervals：K_10M / K_120M / K_180M / K_240M |
| **10.4.6408** | 2026-04-23 | `security_firm` 預設自動偵測、Silent Logging Mode |
| **10.3.6308** | 2026-04-16 | US 即時報價推廣期免費、可無 broker login（100 free real-time subs + historical） |
| **10.2.6208** | 2026-03-26 | US Margin Simulation（paper trading 同步 App） |
| **10.1.6108** | 2026-03-20 | ⭐ **Futu Skills Hub launch** — 支援 OpenClaw / Claude Code / Cursor / Codex |
| **9.6.5608** | 2025-12-17 | 恆指 family 82 個指數 symbols、機構 master account 支援（read-only） |
| **9.4.5408** | 2025-08-14 | US 24 小時交易、20 年 daily K-line、US equity LV2 60 levels |

---

## 5. Search API（v10.8 新增）⭐

> ⭐ **StockPulse 算法常用**：篩選候選股票、新聞/公告追蹤

### 5.1 `get_search_quote(keyword, max_count=10)` — 關鍵字搵資產

**描述**：用 keyword 搵證券，返回 matching list。

**參數**：

| 參數 | 類型 | 說明 |
|---|---|---|
| `keyword` | str | 搜尋關鍵字 |
| `max_count` | int | 最多返幾多個（預設 10）|

**返回 DataFrame fields**：

| Field | Type | Description |
|---|---|---|
| `market` | Market | 市場類型 |
| `code` | str | 股票代碼 |
| `name` | str | 股票名稱 |
| `sec_type` | SecurityType | 證券類型（STOCK/ETF/PLATE...）|
| `is_watched` | bool | 是否在 watchlist |

**Example**：

```python
from futu import *

quote_ctx = OpenQuoteContext(host='127.0.0.1', port=11111)
ret, data = quote_ctx.get_search_quote('aapl', 10)
if ret == RET_OK:
    print(data)   # market / code / name / sec_type / is_watched
else:
    print('error:', data)
quote_ctx.close()
```

**Output example**：

```
       market          code              name  sec_type  is_watched
0         US        US.AAPL             苹果     STOCK         True
1         US       US.AAPB  2倍做多AAPL ETF-GraniteShares  ETF  False
2         US   US.LIST2139           虚拟现实    PLATE        False
3         US   US.LIST2432            流媒体概念   PLATE        False
...
9         US       US.APRU  APPLE RUSH COMPANY INC    STOCK        False
```

### 5.2 `get_search_news(keyword, max_count=10, news_sub_type=NewsSubType.ALL)` — 關鍵字搵新聞/公告/評級

**描述**：用 keyword 搵新聞、公告、評級。

**參數**：

| 參數 | 類型 | 說明 |
|---|---|---|
| `keyword` | str | 搜尋關鍵字 |
| `max_count` | int | 最多返幾多個（預設 10）|
| `news_sub_type` | NewsSubType | 新聞子類型（ALL / NEWS / NOTICE...）|

**返回 DataFrame fields**：

| Field | Type | Description |
|---|---|---|
| `title` | str | 標題 |
| `news_sub_type` | NewsSubType | 新聞子類型 |
| `source` | str | 來源 |
| `publish_time` | str | 發佈時間 |
| `view_count` | int | 瀏覽數 |
| `related_securities` | list | 相關證券 |
| `url` | str | 詳情頁 URL |

**Example**：

```python
from futu import *

quote_ctx = OpenQuoteContext(host='127.0.0.1', port=11111)
ret, data = quote_ctx.get_search_news('space', 10, news_sub_type=NewsSubType.ALL)
if ret == RET_OK:
    print(data)
else:
    print('error:', data)
quote_ctx.close()
```

**StockPulse 用法**：
- 用 `get_search_quote` 根據 keyword 搵股票（例如「半導體」、「蘋果供應鏈」）
- 用 `get_search_news` 追蹤特定股票或主題嘅新聞/公告
- 結合 Stock Screening V2 做 candidate generation

---

## 6. Stock Screening V2（v10.6 新增）

> ⭐ **StockPulse 算法常用**：根據多維度 filter 自動篩選股票池

### 基本用法

```python
from futu import OpenQuoteContext, RET_OK, StockScreenRequest
from futu.quote.stock_screen_const import (
    ScrMarket, ScrSortDir, SimpleField, SimpleProperty,
    CumulativeProperty, FinancialProperty, Term,
    Indicator, Period, Position, Pattern,
    BasicProperty, KlineShapeProperty, KlineShapeType,
)

quote_ctx = OpenQuoteContext(host='127.0.0.1', port=11111)

# Example 1: HK 大股 + MACD 黃交叉
req = StockScreenRequest()
req.add_simple_field(field=SimpleField.MARKET, values=[ScrMarket.HK])
req.add_simple_property(name=SimpleProperty.PRICE, lower=10.0)               # 股價 ≥ 10
req.add_simple_property(name=SimpleProperty.MARKET_CAP, lower=10_000_000_000.0)  # 市值 ≥ 100億
req.add_simple_property(name=SimpleProperty.PE_TTM, lower=10.0, upper=50.0)  # PE 10~50
req.add_indicator_pattern(name=Pattern.MACD_GOLD_CROSS, period_type=Period.DAY)  # MACD 黃交叉
# 設定要 retrieve 嘅 field
req.add_retrieve_basic(name=BasicProperty.CODE)
req.add_retrieve_basic(name=BasicProperty.NAME)
req.add_retrieve_simple(name=SimpleProperty.PRICE)
req.add_retrieve_simple(name=SimpleProperty.MARKET_CAP)
req.add_retrieve_simple(name=SimpleProperty.PE_TTM)
# 排序
req.set_sort(direction=ScrSortDir.DESC, property_type='simple',
             property_params={'name': int(SimpleProperty.MARKET_CAP)})
req.page_count = 50

ret, data = quote_ctx.get_stock_screen(req)
if ret == RET_OK:
    last_page, all_count, items = data
    print(f"Total {all_count}, returned {len(items)} this page")
    for it in items[:3]:
        print(it['stock_id'], it['results'])
```

### 5 大 dimension（property type）

| Dimension | Class | Example |
|---|---|---|
| **Simple property** | `SimpleProperty` | `PRICE` / `MARKET_CAP` / `PE_TTM` / `VOLUME_RATIO` / `DIVIDEND_RATIO` |
| **Cumulative property** | `CumulativeProperty` | `PRICE_CHANGE_PCT` (N-day change %、decimal)、`TURNOVER_CHANGE_PCT` |
| **Financial property** | `FinancialProperty` | `NET_PROFIT` / `REVENUE` / `ROE`（要指定 `Term`：ANNUAL / QUARTERLY）|
| **Indicator pattern** | `Indicator` + `Pattern` | `MACD_GOLD_CROSS` / `MACD_DEATH_CROSS` / `KDJ_GOLD_CROSS` / `BOLL_BREAK_UPPER` |
| **K-line shape** | `KlineShapeProperty` + `KlineShapeType` | `DOUBLE_BOTTOMS` / `HEAD_SHOULDERS_BOTTOM` / `BREAKTHROUGH` |

### Important Parameters

| 參數 | 說明 |
|---|---|
| `add_simple_field(market)` | **必須**，篩選市場（HK / US / SH / SZ / JP / SG）|
| `add_retrieve_basic(...)` | 要返回嘅 field（CODE、NAME）|
| `add_retrieve_simple(...)` | 要返回嘅 simple property |
| `set_sort(...)` | 排序（ASC / DESC + property name）|
| `page_count` | 一頁幾多個（max 通常 200）|

### StockPulse 用法

- **候選池生成**：用 screening 拎每個板塊嘅股票（例如「半導體 + PE < 30 + 市值 > 100 億」）
- **多 factor 組合**：結合 simple（價/量）+ financial（PE/ROE）+ indicator（MACD/KDJ）
- **技術形態**：用 K-line shape filter（W 底、頭肩底等）

---

## 7. 行情 API

### 7.1 市場快照 `get_market_snapshot(code_list)`

**返回字段**：

| 字段 | 類型 | 說明 |
|---|---|---|
| `code` | str | 股票代碼 |
| `name` | str | 股票名稱 |
| `last_price` | float | 最新價 |
| `open_price` | float | 開盤價 |
| `high_price` | float | 最高價 |
| `low_price` | float | 最低價 |
| `volume` | float | 成交量 |
| `turnover` | float | 成交額 |
| `turnover_rate` | float | 換手率 |
| `pe_ratio` | float | 市盈率 |
| `pb_ratio` | float | 市淨率 |
| `dividend` | float | 股息 |
| `52w_high` | float | 52週最高 |
| `52w_low` | float | 52週最低 |

### 7.2 實時 K線 `get_cur_kline(code, num, ktype=SubType.K_DAY, autype=AuType.QFQ)`

**K線類型 (KLType)**：

| 類型 | 說明 |
|---|---|
| K_1M / K_5M / K_15M / K_30M / K_60M | 分鐘級 |
| K_DAY | 日K |
| K_WEEK / K_MON | 週 / 月K |
| K_10M / K_120M / K_180M / K_240M | 🆕 v10.5 加入（10分鐘、2/3/4小時）|

**復權類型 (AuType)**：

| 類型 | 說明 |
|---|---|
| QFQ | 前復權 |
| HFQ | 後復權 |
| NONE | 不復權 |

**Example**：

```python
from futu import *
quote_ctx = OpenQuoteContext(host='127.0.0.1', port=11111)

ret_sub, err_message = quote_ctx.subscribe(
    ['US.AAPL'],
    [SubType.K_DAY],
    subscribe_push=False
)

ret, data = quote_ctx.get_cur_kline('US.AAPL', 2, SubType.K_DAY, AuType.QFQ)
print(data)

quote_ctx.close()
```

### 7.3 分時成交 `get_rt_ticker(code, num=500)`

返回：time / price / volume / turnover / ticker_direction / type

### 7.4 經紀隊列 `get_broker_queue(code)`

返回：bid_broker_name / ask_broker_name / bid_broker_pos / order_volume

> 💡 StockPulse 應用：分析主力動向（邊個經紀主動買/賣）

### 7.5 🆕 Chart Indicators（v10.8）

支援 Mai Language + Python 嘅所有技術指標（MA / EMA / MACD / KDJ / BOLL / RSI）。

---

## 8. ⚠️ 重要規則 / 小心處理

### 8.1 訂閱規則（必讀！）

1. **訂閱後至少 1 分鐘才能取消** — 富途強制 throttle
2. **建議保持訂閱直到程序結束** — 避免頻繁 subscribe/unsubscribe 觸發 ban
3. **用 `ret_code == 0` 判斷成功**
4. **只訂閱一次保持到程序結束**（唔好重覆 subscribe）

### 8.2 報價卡（要買）

部分市場數據要另外買報價卡：
https://qtcardfthk.futufin.com/index/api-cards-mall?lang=en-US

- 推廣期內：US 即時報價免費（v10.3+）
- HK 報價視乎帳戶等級
- 如收到報錯 `NO_QUOTE_RIGHT`，要去買卡

### 8.3 落單安全

| Env var | 預設 | 解讀 |
|---|---|---|
| `FUTU_ENABLE_TRADING` | `0` | **落單功能預設關閉** |
| `FUTU_TRADE_ENV` | `SIMULATE` | 預設模擬帳戶 |
| `FUTU_ENABLE_POSITIONS` | `1` | 持倉查詢（read-only）|
| `FUTU_HOST` / `FUTU_PORT` | `127.0.0.1` / `11111` | OpenD 本機 |

> ⚠️ **落單前必須**：
> 1. `unlock_trade('密碼')` 解鎖
> 2. 確認 `TrdEnv` 設定（REAL vs SIMULATE）
> 3. **驗證 stock code 格式**（HK.00981、US.AAPL、SH.600000）
> 4. 處理 network error / order rejection（fallback）

### 8.4 股票代碼格式

| 市場 | 格式 | 示例 |
|---|---|---|
| 港股 | HK.00700 | HK.00700 (騰訊) |
| 美股 | US.AAPL | US.AAPL (蘋果) |
| A 股 | SH.600000 | SH.600000 (浦發) |
| 加密 | CRYPTO.BTC | (示例) |

### 8.5 交易時段

- **港股**：09:30 - 12:00, 13:00 - 16:00 HKT
- **美股**：09:30 - 16:00 EST（v9.4+ 支援 pre-market / after-hours via `Session.ALL`）

### 8.6 錯誤處理 checklist

| Error | 原因 | 處理 |
|---|---|---|
| `NO_QUOTE_RIGHT` | 無報價權 | 買報價卡 / 確認推廣期 |
| `FREQ_LIMIT` | 訂閱/取消太頻 | 等 1 分鐘 |
| `CONNECTION_LIMIT` | 連線數滿 | 確保 `close()` 連線 |
| `INVALID_SYMBOL` | code 格式錯 | 對照 §8.4 |
| `MARKET_CLOSED` | 非交易時段 | 排程避開 |

---

## 9. 交易 API

### 9.1 下單 `place_order(price, qty, code, trd_side, order_type, trd_env)`

**參數**：

| 參數 | 類型 | 說明 |
|---|---|---|
| `price` | float | 訂單價格 |
| `qty` | float | 訂單數量 |
| `code` | str | 股票代碼 |
| `trd_side` | TrdSide | BUY / SELL |
| `order_type` | OrderType | NORMAL / MARKET / STOP / STOP_LIMIT / TRAILING_STOP |
| `trd_env` | TrdEnv | REAL / SIMULATE |

**Example**：

```python
from futu import *

trd_ctx = OpenSecTradeContext(
    filter_trdmarket=TrdMarket.HK,
    host='127.0.0.1',
    port=11111,
    security_firm=SecurityFirm.FUTUSECURITIES  # v10.4+ 可省略，自動偵測
)

# 真實交易需要解鎖
ret, data = trd_ctx.unlock_trade('123456')

# 模擬下單
ret, data = trd_ctx.place_order(
    price=510.0,
    qty=100,
    code="HK.00700",
    trd_side=TrdSide.BUY,
    trd_env=TrdEnv.SIMULATE
)

trd_ctx.close()
```

### 9.2 查詢持倉 `position_list_query(code='', position_market=TrdMarket.NONE, trd_env=TrdEnv.REAL)`

返回：code / stock_name / qty / can_sell_qty / cost_price / nominal_price / pl_ratio / pl_val / position_side

### 9.3 訂單狀態

| 狀態 | 說明 |
|---|---|
| WAITING_SUBMIT | 等待提交 |
| SUBMITTING | 提交中 |
| SUBMITTED | 已提交 |
| FILLED_PART | 部分成交 |
| FILLED_ALL | 全部成交 |
| CANCELLED_ALL | 已取消 |
| FAILED | 失敗 |

---

## 10. API 文檔導航

| 頁面 | URL |
|------|-----|
| 首頁 | `/intro/intro.html` |
| OpenD 安裝 | `/quick/opend-base.html` |
| 環境設置 | `/quick/env.html` |
| 行情定義 | `/quote/quote.html` |
| 交易定義 | `/trade/trade.html` |
| 🆕 Search Quote | `/quote/get-search-quote.html` |
| 🆕 Search News | `/quote/get-search-news.html` |
| 🆕 Stock Screening V2 | `/quote/get-stock-screen.html` |
| 市場快照 | `/quote/get-market-snapshot.html` |
| 實時K線 | `/quote/get-kl.html` |
| 分時成交 | `/quote/get-ticker.html` |
| 經紀隊列 | `/quote/get-broker.html` |
| 下單 | `/trade/place-order.html` |
| 持倉查詢 | `/trade/get-position-list.html` |
| **完整 Changelog** | `https://openapi.futunn.com/futu-api-doc/en/changelog/changelog.html` |

---

## 11. 💡 StockPulse 應用

### 已用

| 功能 | API |
|---|---|
| K線數據 | `get_cur_kline()` |
| 市場快照 | `get_market_snapshot()` |
| 實時行情 | `subscribe()` + 回調 |
| 持倉查詢 | `position_list_query()` |

### 🆕 StockPulse 算法（2026-07-21 起）

| 場景 | API | 用途 |
|---|---|---|
| **Default data source: `all_hk`** | `get_market_snapshot()` 掃全港股 | 算法 input=none 時自動用 |
| **Default data source: `screening:{criteria}`** | `get_stock_screen()` | 算法 specify 板塊/條件 |
| **Keyword 搵股票** | `get_search_quote()` | 由名/主題搵股票 |
| **新聞 / 公告追蹤** | `get_search_news()` | 算法結合 sentiment |
| **多 factor 篩選** | `get_stock_screen()` 5 dimensions | 候選池生成 |

### 待探索

1. **經紀隊列** — 分析主力動向
2. **Chart Indicators** — 完整技術指標（MA / MACD / KDJ / BOLL）
3. **Financial Statements API** — 基本面詳細數據
4. **0DTE Options** — 短期期權策略

---

## 📝 備註

- OpenD 必須在本地或雲端運行
- WebSocket 可用於更高效的數據推送
- 交易需要先解鎖 (`unlock_trade`)
- 模擬交易使用 `TrdEnv.SIMULATE`
- v10.4+ 起 `security_firm` 自動偵測，可省略
- Skill for OpenClaw: `futu-stock@1.0.4`（已安裝 verified）
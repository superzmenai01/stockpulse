# Module 10 — Trade Journal (時光機實戰日誌)

> **Status**: v0.1.0 MVP (大少 2026-08-09 11:07 揀 MVP scope)
> **Stage**: Stage 1+ 真實 forward return tracking
> **Trigger**: M9 Pilot 收官 (commit 01df4a6a) + Stage 1+ workflow 起步

## 1. 目的

M9 Back Test 拎到 forward return predictions (fwd5/fwd10/fwd20) 永久累積落 cache。Stage 1+ 階段大少真正落實倉位後, 將真實 trades 記錄落 Trade Journal, mark 啱/錯, 拎真實 forward return rate, 之後 tune 5 個 adaptive params (Bayesian tuning 階段)。

**Pipeline**:
```
M9 back test predict → fwd5/fwd10/fwd20 永久 cache
                      ↓
大少真正落實倉位    → POST /api/trade-journal (記錄落實)
                      ↓
比較真實 vs 預測     → mark 啱/錯 (1-5 scale)
                      ↓
30+ 樣本後           → Bayesian tune 5 個 params
                      (kelly, rsiWeight, ssiWeights, scoreWeights, hurstThreshold)
```

## 2. Data Model (MVP v0.1.0)

### 2.1 SQLite Table `trade_journal`

```sql
CREATE TABLE trade_journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,                       -- 股票 code (e.g. 'HK.00700')
  entry_date TEXT NOT NULL,                   -- YYYY-MM-DD (大少 買入日期)
  entry_price REAL NOT NULL,                  -- 買入價
  shares REAL NOT NULL DEFAULT 1,             -- 買入股數 (default 1, 簡化 MVP)
  target_price REAL,                          -- 目標價 (optional, 留空 = 算法自動)
  stop_loss REAL,                             -- 止蝕價 (optional, 留空 = 算法自動)
  notes TEXT,                                 -- 大少 備註 (optional, 留空 = '')
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- MVP 唔做 exit_date / exit_price / mark 啱/錯 (Stage 1+ 之後加)
  UNIQUE(symbol, entry_date)                  -- 防止重複 add
);
CREATE INDEX idx_trade_journal_symbol ON trade_journal(symbol);
CREATE INDEX idx_trade_journal_entry_date ON trade_journal(entry_date DESC);
```

### 2.2 Pydantic Schema

```python
class TradeJournalEntry(BaseModel):
    id: int
    symbol: str
    entry_date: str  # YYYY-MM-DD
    entry_price: float
    shares: float = 1.0
    target_price: Optional[float] = None
    stop_loss: Optional[float] = None
    notes: Optional[str] = ''
    created_at: str

class TradeJournalAdd(BaseModel):
    symbol: str = Field(..., min_length=3, max_length=20)
    entry_date: str = Field(..., regex=r'^\d{4}-\d{2}-\d{2}$')
    entry_price: float = Field(..., gt=0)
    shares: float = Field(default=1.0, gt=0)
    target_price: Optional[float] = Field(default=None, gt=0)
    stop_loss: Optional[float] = Field(default=None, gt=0)
    notes: Optional[str] = ''
```

## 3. API Endpoints (MVP v0.1.0)

### 3.1 `POST /api/trade-journal`

新增 1 條 Trade Journal entry。

**Body**: `TradeJournalAdd`

**Response 200**: `TradeJournalEntry`

**Errors**:
- 400: Validation error (entry_date format, prices)
- 409: 重複 entry (UNIQUE constraint on symbol + entry_date)

**Side-effects**:
- 寫入 `trade_journal` table
- 永久保留 (Stage 1+ 唔刪)

### 3.2 `GET /api/trade-journal`

列出所有 Trade Journal entries (newest first)。

**Query params**:
- `symbol` (optional) — filter by stock code
- `limit` (optional, default 50) — max entries
- `offset` (optional, default 0) — pagination

**Response 200**:
```json
{
  "entries": [
    { "id": 1, "symbol": "HK.00700", "entry_date": "2026-08-09", ... },
    ...
  ],
  "count": 1
}
```

## 4. Frontend (testing-page 簡單 section)

testing page 加 1 個新 section (永久顯示, 跟其他 sections 一齊):
- "📓 Trade Journal" header
- Input form:
  - 股票代碼 (text input)
  - Entry date (date input)
  - Entry price (number input)
  - Shares (number input, default 1)
  - Target price (optional)
  - Stop loss (optional)
  - Notes (optional textarea)
- "新增" button → POST 落 backend
- List 已有 entries (table, newest first): symbol, entry_date, entry_price, shares, target_price, stop_loss, notes

**MVP 唔做** (Stage 1+ 之後):
- 編輯 / 刪除 entry
- mark 啱/錯 (1-5 scale)
- 對比 M9 forward return cache 自動填
- 真實 exit price / P&L 計算
- 統計頁 (hit rate 對比)

## 5. Stage 1+ 永久 Rules

- **永久保留** — trade_journal entry 永遠唔刪 (大少 22:28 永久 rule: forward return 永久)
- **每隻 stock 獨立** — UNIQUE constraint on (symbol, entry_date) 防止重複 add
- **冇 sanitization** — 純 numeric + symbol validation, 唔 render HTML
- **冇 auth** — 內網 only, 大少 #9700 permanent rule
- **Cache expiry 唔適用** — Trade Journal 永久, 唔可以 auto-calibrate 後刪

## 6. MVP 落地清單 (30 min)

- [x] **Spec** (5 min): 本 doc
- [ ] **Backend** (10 min): `models/trade_journal.py` (DDL + helper) + `api/trade_journal.py` (POST/GET) + `main.py` include router
- [ ] **Frontend** (10 min): `testing-page.js` 加 1 個 section + form + list
- [ ] **Test** (5 min): 1 個 pytest (POST/GET, 重複 409, missing 400)
- [ ] **Verify** (5 min): browser test input + list
- [ ] **Commit** (5 min): spec + code + tests

## 7. Stage 1+ Followup (deferred)

- PUT /api/trade-journal/{id} — mark 啱/錯 (1-5 scale), 加 exit_date, exit_price, pnl
- DELETE /api/trade-journal/{id} — 刪 entry
- M9 forward return 對比 — 對比 M9 cache 嘅 fwd5/fwd10/fwd20, 大少 mark 啱/錯 vs 預測 hit
- 統計頁 — total trades / hit rate / avg return / sharpe
- Bayesian tune — 30+ 樣本後 tune 5 個 adaptive params
- Trade Journal UI 改善 — filter, sort, export CSV

## 8. 大少 永久 Rules 應用

- ✅ 大少 11:57 永遠全 Show (6 顏色) — 唔做 (MVP 純列表, 唔 mark 啱/錯)
- ✅ 大少 23:57 testing page 全部繁體人話 — 全部繁體化
- ✅ 大少 workflow 7 步 per module — spec → code → test → verify → doc → commit
- ✅ Backend hot-reload 唔 work — restart uvicorn
- ✅ destructive ops blocked — 永遠保留, 唔刪 entry

## 9. Files

- `backend/models/trade_journal.py` (NEW, DDL + CRUD helper)
- `backend/api/trade_journal.py` (NEW, POST + GET)
- `backend/main.py` (include_router)
- `backend/tests/test_trade_journal.py` (NEW, pytest)
- `testing-page/testing-page.js` (加 section)
- `docs/research/AS-03-cycle-detection/MODULE-10-TRADE-JOURNAL.md` (本 doc, NEW)

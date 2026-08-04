# AS-03 · 股票周期判定 — 研究筆記

> 高層設計筆記 + 待辦追蹤 + Open Questions。
> Code-level 細節睇 [algorithms/AS-03-cycle-detection/DECISIONS.md](../../../algorithms/AS-03-cycle-detection/DECISIONS.md)。

---

## 📅 2026-08-04 — 起步

### 來源
- [股票周期判定算法.docx](file:///Users/zmenai/Downloads/股票周期判定算法.docx) — Kimi 整理嘅 6 點判斷方法 + 1 點綜合流程
- [StockPulse 項目](../../../) — 主項目位置
- [Algorithm Specs 全局文件](../../../ALGORITHM_SPECS.md) — 全算法規格索引
- [KlineCache 實作](../../../backend/services/kline_cache.py) — 數據 cache-aside 機制 (大少 #8505 #7983 #8484 #8551 #8573)
- [KLine API endpoint](../../../backend/api/kline.py) — `GET /api/kline`

### 文件原文 — 6 個點 + 1 個綜合

| 點 | 名稱 | 文件原文摘要 |
|---|------|------|
| 1 | 均線系統 | 短期 (5/10) 在長期 (20/60) 之上 + 多頭排列 + 向上發散 = 上升；空頭 = 下跌；糾纏 = 橫行 |
| 2 | 高低點結構 | Dow Theory — HH/HL = 上升，LH/LL = 下跌，箱體 = 橫行 |
| 3 | 趨勢線 | 上升支撐線 / 下降壓力線 / 兩條水平線 |
| 4 | 技術指標 | MACD (DIF vs DEA + histogram) / RSI (50 + OB/OS) / Bollinger (帶寬) |
| 5 | 成交量 | 量價齊升 / 量能背馳 / 量萎縮 |
| 6 | 時間框架 | 大周期決定小周期 — 週線/月線先確認大方向，日線再確認位置 |
| 7 | 綜合流程 | 5-step sequential: 週線 → 日線MA → 趨勢線+高低點 → MACD+量 → 綜合 |

### 架構決策 (2026-08-04)
- ✅ D001 Module 6 = orchestrator step 0 (架構上唔係 peer)
- ✅ D002 4 個 state (UP/DOWN/SIDEWAYS/TRANSITION) + 中文解讀
- ✅ D003 滯後機制 = 提醒 + 手動判 (唔做 state machine)
- ✅ D005 所有 threshold 集中 config.ts
- ✅ D006 6 個 model 結果都顯示 (5 peer + 1 HTF + 1 synthesized = 7 個 card)
- ✅ D008 數據來源 = backend `/api/kline` (沿用 KlineCache cache-aside 機制)
- ✅ D009 Q3 答案：6 個 module 全包 (唔分 priority)
- ⏳ D004 Synthesizer 策略 = 最後先傾 (3 選 1)
- ⏳ D007 Per-stock calibration = 待大少答
- ⏳ D010 Q4 = Backtest ground truth 來源 (大少答日後再傾)

### 🔍 KlineCache 機制調查 (2026-08-04 10:27 大少更正後)

我之前說「數據全部從 OpenD 讀」係錯嘅。大少更正後去 `backend/services/kline_cache.py` 查清楚。個機制 (cache-aside)：

```
Frontend → GET /api/kline?code=HK.00981&period=1d&count=250
                ↓
        kline.py (FastAPI endpoint)
                ↓
        KlineCache.get_or_fetch() — cache-aside:
                │
        Step 1 ─ 讀 SQLite (kline_cache 表) — T-1 及之前嘅歷史數據
                │
        Step 2 ─ 補資料 (如有需要):
                │  • DB 冇 → OpenD 攞全段 + 寫落 DB
                │  • DB 有但過期 → OpenD 補缺漏 + T-1 → 寫落 DB
                │
        Step 3 ─ 當日 from OpenD (always fresh，唔寫 DB)
                │
                ↓ 合併
        {klines: [...], cached: bool, fetch_count}
```

**關鍵 rules:**
- 大少 #7983: DB 只 cache T-1 及之前，當日 always fresh from OpenD (skip time >= today)
- 大少 #8484: 30 年 window for daily K (backtest use case)
- 大少 #8505: missing data auto-fill + cached/fetch_count flags 俾 frontend debug
- 大少 #8551: retry 2 attempts on network jitter + partial fetch warning log
- 大少 #8573: normalize time 為 date-only (防止 SDK mixed format → fromisoformat 爆)

**AS-03 frontend 角色：** 純 HTTP client → call `/api/kline` → 將 response 轉成 `KLine[]` → 餵俾 5 個 modules。

新加 `data-loader.ts` (4.2 KB) 負責呢個 role，唔需要 re-implement cache。

### Skeleton 已建 (v0.1.0)
```
~/stockpulse/algorithms/AS-03-cycle-detection/
├── README.md
├── ARCHITECTURE.md
├── DECISIONS.md              # D001-D010 (含今次更新)
├── types.ts                  # 共用類型
├── config.ts                 # tunable thresholds
├── data-loader.ts            # ⭐ HTTP client to /api/kline (D008)
├── index.ts                  # CycleDetector 主入口
├── modules/                  # 5 個 peer modules (skeleton)
│   ├── ma-alignment.ts
│   ├── hl-structure.ts
│   ├── trendline.ts
│   ├── indicators.ts
│   └── volume.ts
├── orchestrator/             # 點 6 + 點 7 + 輔助
│   ├── multi-tf.ts           # Module 6
│   ├── synthesize.ts         # Module 7 placeholder
│   ├── aggregator.ts         # conflict resolution placeholder
│   └── alert.ts              # 轉勢提醒
└── __tests__/
    └── smoke.mjs             # basic smoke test (待 Vite 整合後跑)
```

---

## ⏳ 待辦

### 大少提供詳細做法
- [ ] 點 1 — MA Alignment 詳細做法
- [ ] 點 2 — HL Structure 詳細做法 (ZigZag + HH/HL/LH/LL)
- [ ] 點 3 — Trendline 詳細做法 (RANSAC / linear-regression)
- [ ] 點 4 — Indicators 詳細做法 (MACD / RSI / Bollinger)
- [ ] 點 5 — Volume 詳細做法 (量價配合 / 量能背馳)

### 大少決策
- [ ] Module 6 用邊個 module 做 HTF proxy？ (預設 MA alignment)
- [ ] Synthesizer / Aggregator 策略 3 選 1？ (htf-override / weighted-vote / expert-rules)
- [ ] Backtest ground truth dataset 來源？ (大少手標 / TradingView / 阿姨)
- [ ] Per-stock calibration 要唔要做？ (D007)
- [ ] 6 個 module 全部都係 required，定有 priority？

### 我做
- [x] 讀 docx + 設計架構
- [x] 建 folder + skeleton (types / config / modules / orchestrator / index)
- [x] 寫 README / ARCHITECTURE / DECISIONS / RESEARCH_LOG
- [x] Smoke test (instantiate + basic run)
- [ ] Update StockPulse spec docs (ALGORITHM_SPECS / ARCHITECTURE / README) — 最後統一更新

---

## 🤔 Open Questions

### Q1: Module 6 嘅 HTF proxy 用邊個 module？
- 預設係用 MA alignment (同 LTF 一樣嘅 module 喺 HTF 跑)
- 可能 HL structure 喺 HTF 更 robust (高時間框架 noise 少)
- 大少可以指定，預設 MA OK？

### Q2: Synthesizer / Aggregator 策略
- htf-override — 簡單但忽略 LTF detail
- weighted-vote — tunable 但 calibration 難
- expert-rules — 解釋性強但維護成本
- 我嘅傾向: **expert-rules** (可審計 + 易 debug)，但要等大少

### Q3: Backtest ground truth 來源
- 大少手標 — 最準但慢
- TradingView community labels — 大量但 noise
- 阿姨 (mentioned in MEMORY.md) — 真人判斷但 limited coverage
- 建議: 大少手標 20-30 隻 stock × 2 年，作為 calibration seed

### Q4: Per-stock calibration 要唔要做？
- 文件提藍籌 vs 小型股 週期不同
- 簡單做法: 用 same global config，自適應 (lookback window 較長)
- 進階做法: per-stock `CycleConfig` mapping
- 暫時: single global config + 等大少

### Q5: 6 個 module priority？
- 文件冇講 priority，全部都列
- 但 MA + HL 應該係最重要 (結構性 vs 雜訊性)
- Volume + Indicators 屬於 confirm 而非 primary
- 預設: 全部跑 (D006)，但將來可能 tune weight

---

## 📚 相關文檔

- [algorithms/AS-03-cycle-detection/](../../../algorithms/AS-03-cycle-detection/) — code location
- [algorithms/AS-03-cycle-detection/DECISIONS.md](../../../algorithms/AS-03-cycle-detection/DECISIONS.md) — 7 個 ADR
- [algorithms/AS-03-cycle-detection/ARCHITECTURE.md](../../../algorithms/AS-03-cycle-detection/ARCHITECTURE.md) — 完整架構
- [StockPulse 主項目 README](../../../README.md)
- [StockPulse Architecture](../../../ARCHITECTURE.md)
- [StockPulse API](../../../API.md)
- [StockPulse ALGORITHM_SPECS](../../../ALGORITHM_SPECS.md) — 加 AS-03 entry

---

## 📊 Phase 進度

| Phase | 狀態 | 備註 |
|-------|------|------|
| P1 — 設計 + skeleton | ✅ Done (2026-08-04) | folders + types + modules placeholder |
| P2 — 點 1 詳細做法 | ⏳ Pending | 等大少 |
| P3 — 點 2-5 詳細做法 | ⏳ Pending | 等大少 |
| P4 — Backtest + calibration | ⏳ Pending | 等 ground truth |
| P5 — Synthesizer 設計 | ⏳ Pending | 最後先傾 |
| P6 — Spec docs sync | ⏳ Pending | ALGORITHM_SPECS / ARCHITECTURE / README |

---

**最後更新:** 2026-08-04 09:45 (骨架版本)
**下一個 milestone:** 等大少提供點 1 (MA Alignment) 詳細做法
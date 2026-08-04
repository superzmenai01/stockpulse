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

**最後更新:** 2026-08-04 12:14 (大少 #10273 答 Q1-Q5，開始實作)
**下一個 milestone:** 完成 ma-alignment.ts 8-step impl + 5 個 unit tests 跑過

---

## 📅 2026-08-04 12:14 — 大少 #10273 拍板 5 個決策

### 大少 answers
1. **Q1 (3-state vs 4-state)**: **A** — ma-alignment output 3-state (uptrend/downtrend/sideways)，TRANSITION 由 synthesizer 判
2. **Q2 (Volume 角色)**: **B** — ma-alignment 用 docx 邏輯 + `modules/volume.ts` 做 OBV/量價背馳 emit confirm signal
3. **Q3 (Slope 角色)**: **A** — Slope absorb 入 ma-alignment，trendline.ts 做 chart pattern trendline drawing
4. **Q4 (Config schema)**: **A+B 都做** — sub-configs 結構 + flat override layer，參數可手動調整
5. **Q5 (Docx 範例 discrepancy)**: **A** — 用 actual value (0.386)，唔好 magic rounding

### 大少加的 note (要記住！)
- ⏰ 記得 3 個 concerns：(a) 三個折扣叠可能漏太多机会 (b) sideways 條件可能太敏感 (c) 冇慣性機制
- ⏰ 最終測試要用**大少要求和標準**，唔係用我自己 standard
- ⏰ 可能會有不少改動
- ⏰ 到時記得更新記錄 (DECISIONS + RESEARCH_LOG + SPEC)

### D011-D015 updated → Accepted (見 DECISIONS.md)

### 開始實作 (v0.2.0)
- types.ts: 加 `RawCycle` + `rawCycleToState()`
- config.ts: replace `MAAlignmentConfig` with sub-configs (`{ma, volume, slope}`) + flat override layer (`MAAlignmentFlat` + `mergeFlatOverrides()`)
- modules/ma-alignment.ts: full 8-step impl (from 0.1.0-skeleton → 0.2.0)
- modules/volume.ts: description 更新 (D012 - OBV role)
- modules/trendline.ts: description 更新 (D013 - chart pattern)
- `__tests__/ma-alignment.test.mjs`: 5 個 unit test

---

## 📅 2026-08-04 10:50 — 點 1 詳細做法 (MA Alignment v2.0)

### 來源
- `/Users/zmenai/Downloads/均線系統週期判斷法.docx` (Kimi 整理 v2.0)
- 對應 module: `algorithms/AS-03-cycle-detection/modules/ma-alignment.ts`
- 詳細 spec 已寫入: [MODULE-01-MA-ALIGNMENT.md](./MODULE-01-MA-ALIGNMENT.md) (8.9 KB, 8 step 完整算法)

### Algorithm 8 步 summary
1. **驗證 + min_length** — `MAX(max(ma_periods)+5, max+slope_lookback+5, vol_lookback*2+5)`
2. **各 MA 最新值** — `AVG(price_data[-period:].close)`
3. **排序 + 形態** — value DESC rank == ma_periods ASC → uptrend；== reverse → downtrend；其他 → sideways
4. **粘合檢查** — `(max_ma - min_ma) / min_ma < threshold_pct (0.02)` → sideways override
5. **成交量趨勢** (optional) — recent N vs prev N → ratio → expanding/shrinking/neutral
6. **斜率 + 動能分數** (optional) — `(current_ma - past_ma) / past_ma` per period；momentum = 加權 (短週期高)
7. **信心指數** — base × vol_mult × slope_mult，CLAMP [0,1]
8. **組裝輸出**

### Output (raw 12 個 fields)
```
cycle, cycle_label, confidence, base_confidence,
ma_values, ma_ranks, ma_slopes, momentum_score,
volume_trend_ratio, volume_signal, max_spread_pct,
adjustment_log, reason, last_date
```

### 對 CycleVerdict 嘅 mapping (proposed)
| Docx field | → CycleVerdict |
|---|---|
| `cycle` | `state` (3→4 state map，Q1) |
| `confidence` | `confidence` |
| `reason` | `interpretation` |
| `adjustment_log[]` | `warnings[]` |
| `ma_ranks/ma_slopes/volume_signal/max_spread_pct` | `evidence[]` |
| 其餘 | `meta{}` |

### 🔥 發現 5 個 critical conflicts (要問大少)

1. **3-state vs 4-state** — docx 3-state，D002 4-state (TRANSITION 點處理？)
2. **Volume 角色** — docx 內化做 multiplier，skeleton 有獨立 `modules/volume.ts`，係 absorb 定分開？
3. **Slope 角色** — docx 內化做 multiplier，skeleton 冇 slope module
4. **Config schema** — skeleton 4 fields，docx 9+ fields + 多個 hardcoded 數字
5. **Docx 範例 discrepancy** — docx 用 `max_spread_pct=0.08` 計到 `0.448`，實際 `0.0689` 應得 `0.386`

### ⏳ 仲排隊 (其他 5 個 module)
- 點 2 — HL Structure (ZigZag + Dow Theory)
- 點 3 — Trendline (RANSAC)
- 點 4 — Indicators (MACD / RSI / Bollinger)
- 點 5 — Volume (OBV / 量價背馳)
- 點 6 — Multi-TF (已有架構)
- 點 7 — Synthesizer (D004 pending strategy)

---

## 📅 2026-08-04 23:50 — v0.3.0 算法大改革 (大少 #10332)

### 背景
大少 #10332 話：「你亂咗」，明確指示：
1. 之前 V0.2.0 13 個算法 (Kimi 8 步算法) **全部 drop**
2. 用大少設計嘅 A-H 8 條 rule 換上
3. 大少後來加嘅 2 條 supplementary rules (有機會長升/長跌) 命名為 **I 同 J**
4. 修正後再例出均線系統所有算法

### 動作
- ✅ Rewrite `~/stockpulse/algorithms/AS-03-cycle-detection/modules/ma-alignment.ts` (v0.1.0-skeleton → v0.2.0 Kimi → **v0.3.0 A-J 10 條 rule**)
- ✅ Rewrite `~/stockpulse/algorithms/AS-03-cycle-detection/config.ts` (drop MAAlignmentSubConfig volume/slope/thresholdPct 等，只留 A-J 需要嘅 7 個 fields)
- ✅ Delete `config-flat.ts` (大少 #10273 Q4 A+B 已不適用)
- ✅ Rewrite `~/stockpulse/algorithms/AS-03-cycle-detection/__tests__/ma-alignment.test.mjs` (T1-T11 共 19 assertions)
- ✅ Fix 4 個 skeleton modules (hl-structure/indicators/trendline/volume) — drop broken config imports
- ✅ Rewrite `MODULE-01-MA-ALIGNMENT.md` (v0.3.0 spec)

### 10 條算法 (A-J)
| # | 算法 | 對應 state |
|---|------|-----------|
| A | 連續 5 日 MA5 > MA60 | UP |
| B | 連續 5 日 MA5 < MA60 | DOWN |
| C | 5 日裡 MA5 > MA60 但當日 low < MA60 | SIDEWAYS |
| D | 5 日裡 MA5 < MA60 但當日 high > MA60 | SIDEWAYS |
| E | C/D 多過一日，最後一日為準 (隱含邏輯) | — |
| F | MA5+MA10 都 > MA60 但 MA5 < MA10 | UP |
| G | MA5+MA10 都 < MA60 但 MA5 > MA10 | DOWN |
| H | 7 日反轉 (1/2/3 日新方向) | TRANSITION |
| I | 連續 5 日 low ≥ MA5 × 0.98 | supplementary |
| J | 連續 5 日 high ≤ MA5 × 1.02 (大少 #10317 typo fix) | supplementary |

### Test results
- ✅ 19/19 assertions pass, TSC=0
- 涵蓋：data validation (T1) + 8 條 rule (T2-T9) + 2 條 supplementary (T9-T10) + multi-rule coexistence (T11)

### Drop
13 個 v0.2.0 Kimi 算法全部 drop (Step 1-7a-d + 信心指數 magic numbers)。

### Pending
- 5 個獨立 module (HL Structure / Trendline / Indicators / Volume OBV / Multi-TF / Synthesizer)
- 量價分析 + 斜率動能新 Model (TODO.md 記錄咗)
- 4 個 skeleton modules 仲係 placeholder verdict (等大少 trigger 詳細做法 docx)

---

## 📅 2026-08-05 00:00 — Spec docs update trigger (大少 #10341 / #10346)

### 大少 trigger
- #10341: 「做這4樣前，想問一問這些有寫到 Sub Project 記錄底嗎？ 位置在那裡？」
- #10346: 「完整 sync 1」 (推斷 — 我列出 3 個 sync mode，大少揀 1 = 完整 sync)
- #10347: actual content missing from runtime context (推斷：揀 Option 1 完整 sync)

### Spec docs 位置 (3 levels)
**Level 1 · Sub-Project 記錄 (AS-03 自己)**:
- `~/stockpulse/docs/research/AS-03-cycle-detection/MODULE-01-MA-ALIGNMENT.md` — 5.5 KB spec doc (v0.3.0)
- `~/stockpulse/docs/research/AS-03-cycle-detection/RESEARCH_LOG.md` — 呢個 file (12.4 KB)
- `~/stockpulse/algorithms/AS-03-cycle-detection/DECISIONS.md` — 15 KB ADR (D001-D016)
- `~/stockpulse/algorithms/AS-03-cycle-detection/ARCHITECTURE.md` — 7.4 KB 架構
- `~/stockpulse/algorithms/AS-03-cycle-detection/README.md` — 5 KB 入口

**Level 2 · StockPulse Main 記錄**:
- `~/stockpulse/docs/ALGORITHM_SPECS.md` (713 lines)
- `~/stockpulse/ARCHITECTURE.md`, `PROJECT_SPEC.md`, `README.md`
- `~/stockpulse/TODO.md` (我 created 嘅 backlog)

**Level 3 · OpenClaw / workspace-main 記錄**:
- `~/.openclaw/workspace-main/STOCKPULSE_REFERENCE.md` (928 lines)
- `~/.openclaw/workspace-main/memory/2026-08-04.md` (今日 daily log)
- `~/.openclaw/workspace-main/memory/Projects/StockPulse/{ALGORITHM_SPECS,PROGRESS,STRATEGY_CONCEPTS}.md`
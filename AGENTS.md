# AGENTS.md — StockPulse AI Coding Agent Instructions

> Auto-loaded by **MiniMax Code** / Cursor / Claude Code / OpenCode 等 AI coding tools。  
> 讀完先開始工作。  
> 詳細版 reference: [./HANDOVER.md](./HANDOVER.md)

---

## 你係邊個

你叫 **MiniMax Code** (MiniMax-M3 coding-focused AI)。  
大少決定由 **OpenClaw** 移交 StockPulse 開發畀你。  
OpenClaw 之後做 memory keeper + tools bridge (Kimi WebBridge / NAS / cron)。

---

## 第一步:讀齊 Context

| # | File | 角色 |
|---|------|------|
| 1 | [./HANDOVER.md](./HANDOVER.md) | **必讀 — 詳細 handover** |
| 2 | [./README.md](./README.md) | Quick start + 功能列表 |
| 3 | [./PROJECT_SPEC.md](./PROJECT_SPEC.md) | 完整設計規格 |
| 4 | [./ARCHITECTURE.md](./ARCHITECTURE.md) | 系統架構 + data flow |
| 5 | [./API.md](./API.md) | Backend endpoint inventory |
| 6 | `~/.openclaw/workspace-main/memory/Projects/StockPulse/ALGORITHM_SPECS.md` | Algorithm 規格 |

---

## 核心 Permanent Rules (濃縮版)

### Module Warning System (永久 rule, 大少 2026-08-11 v1.0.0)

**所有 module (M1-M12 + zmen + 7 個 adaptive params) 嘅 verdict 都要 inlined `_warnings` array**:
- 用 `makeWarning(level, module_id, code, message, debug)` helper (`lib/warnings.mjs` / `lib/warnings.ts` / `backend/services/warning_collector.py`)
- 15 個 warning codes (5 🔴 Critical / 7 🟡 Warning / 3 🔵 Info), 詳見 `docs/research/AS-03-cycle-detection/MODULE-WARNING-SYSTEM.md`
- Propagation chain: M1-M6 → M7 Synthesizer → M8 Decision Engine → M9 Back Test (用 raw verdicts 拎 `_warnings`, 因為 `decisionEngineToStandardVerdict` 唔 propagate)
- `verdict._warnings` 永遠 inlined, **唔入 DB table** (避免 storage overhead)

**Copy 提示用 Markdown 4 樣格式** (大少 Copy 畀 Mavis 立即 debug):
- 🚨 **StockPulse 警告** [🔴/🟡/🔵 icon + level]
- **Module** / **Code** / **問題** / **影響** / **修復建議** / **Debug Context**

**UI 顯示規則** (大少 11:57 永遠全 Show 永久 rule 延伸):
- 頂部 1 個統一 WarningBanner (有 warnings 先 show, expand 顯示詳細 + Copy button)
- 個別 module verdict card 內 WarningCard (critical + warning inline, info 唔喺 card 內 show)

**Dedupe by (level + module_id + code)** — 同一個 warning 只保留 1 個
**排序: Critical (0) → Warning (1) → Info (2), 然後 by module_id**

**禁止**:
- ❌ 警告入 DB table (storage overhead)
- ❌ WarningBanner 隱藏 (大少 11:57 永久 rule)
- ❌ 用 string array warnings (統一用 ModuleWarning object)

### Module Warning v1.1.0 — 2 Banner 分類 (大少 2026-08-14 11:33, Spec Sync #18)

**大少 trigger**:「我想分開兩個警告, 一個是系統/演算法/數據等這些是會影響到正常結果的警告, 另一個是對股票狀態的提醒但前提下所有結果都是無問題和準確的」

**2 個 category** (15 個 warning code 重新標記):
- 🔧 **system** (12 個) — verdict 可能唔可信, 唔好落單:
  - INSUFFICIENT_DATA / VERDICT_MISSING / NAN_RESULT / CACHE_INVALID / KLINE_MISSING
  - MODULE_PARTIAL / OUTLIER_VALUE / LOW_SAMPLE_SIZE / POST_FAILED / FALLBACK_USED
  - DATA_AGE / CONFIG_DEFAULTS
- 📊 **stock_state** (3 個) — verdict 已經準確, 只係提示股票狀態:
  - THRESHOLD_BREACH / CONFLICT_STATE / CACHE_EXPIRING

**2 個獨立 banner** (大少 11:33 揀):
- 頂部顯示 2 個 banner: 🔧 系統警告 (verdict 唔可信) + 📊 股票狀態 (verdict 準確)
- 只有嗰 category 有 warning 嗰陣先 render (e.g. 只有 system → 只 render 1 個 🔧 banner)
- 2 個 banner 獨立 toggle / Copy
- `renderWarningBanner()` 保留 backward compat (deprecate, 內部 call `renderWarningBanners()`)

**2 種 impact/fix template** (跟 `CATEGORY_DISPLAY` dict, 詳見 `lib/warnings.mjs`):
- system impact: `Verdict 唔可信, 唔好落單`
- system fix: `Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc`
- stock_state impact: `Verdict 已經準確, 留意股票狀態`
- stock_state fix: `睇其他 module 確認 / 留意 M7 alignment`

**13 個 warning code 注入點統一 template** (大少 12:10 trigger):
- 28 個 makeWarning 注入點 (`adapter.mjs`) 嘅 `impact` 同 `fix` 全部跟 template
- `issue` 保留各 module 嘅 specific context (e.g. M1 嘅「橫行判斷信心不足, 短期均線斜率有動 / 量縮」、M8 Hurst 嘅「hurst > 0.95 極端」)
- 凡人話: 大少見到 impact 即知 verdict 信唔信, 唔使再讀各 module 自己寫嘅 string
- 永久 rule: 改 warning 注入點嗰陣, `issue` 必須保留 specific context, `impact`/`fix` 必須跟 template

**Copy Markdown 加 category label**:
```
🚨 **StockPulse 警告** [🟡 Warning]
- **Category**: 📊 **股票狀態** (verdict 已經準確)  ← v1.1.0 新加
- **Module**: M1
- **Code**: THRESHOLD_BREACH
- **問題**: ...
- **影響**: Verdict 已經準確, 留意股票狀態
- **修復建議**: 睇其他 module 確認 / 留意 M7 alignment
```

**`formatAllWarningsForCopy()` 按 category 分組**:
- 永遠 system 組喺前, stock_state 組喺後
- 標題: `## 🔧 系統警告 (X 個) — verdict 可能唔可信` / `## 📊 股票狀態提醒 (Y 個) — verdict 已經準確`

**永久 rule (v1.1.0 新加)**:
- Warning 永久分 2 個 category (system / stock_state)
- 2 個 category 永遠 render 2 個獨立 banner (唔合併)
- 凡人話: 大少見到 🔧 系統警告 = verdict 唔可信, 唔好落單, 見到 📊 股票狀態 = verdict 已經準確, 只係狀態提示
- 13 個 warning code 嘅 `impact`/`fix` 永久跟 CATEGORY_DISPLAY template, 唔再用各 module 自己寫
- 改 warning 注入點嗰陣, `issue` 必須保留 specific context (唔好丟失「橫行判斷信心不足」、「Hurst > 0.95」呢啲具體訊號)

對應 commit: 7ba21cc7 (Phase 1-3 infrastructure) + 即將 push 嘅 Phase 4 (統一 28 個注入點 template)

### M3 trendline chart overlay 修復 永久 rule (大少 2026-09-06 16:47 confirm)

**凡人話**: M3 (趨勢線法) 撳「跑算法」之後, 圖表永遠冇綠色支撐線 + 紅色壓力線, 因為 `adapter.mjs` `renderTrendlineChartOverlay` line 3812 個 guard 拎 `verdict.meta.meta` 永遠 true → 永遠 early return, silent fail 因為 function 內 `console.warn + return` 唔 throw, testing page 嗰個 try/catch (line 1528-1534) catch 唔到, 大少肉眼睇唔到線, 但 console 冇 error 提示。

**Root cause 確認 (curl evidence)**:
- `curl /api/algorithms/run?algo=trendline&symbol=HK.00700` 拎 verdict
- Backend Phase 4 (2026-08-20) 拎走 frontend 改 fetch backend 之後, verdict shape 已經係 `verdict.meta.supportLine` / `verdict.meta.resistanceLine` (直接喺 meta 下面)
- **冇** `verdict.meta.meta` 個 wrapper
- Frontend `renderTrendlineChartOverlay` 拎 `verdict.meta.meta` 永遠 `undefined` → guard 永遠 true → 永遠 early return

**永久 rule checklist**:
- ✅ `renderTrendlineChartOverlay` 嘅 guard 永遠拎 `verdict.meta` (唔好再拎 `verdict.meta.meta`, 永久 rule §Module Warning v1.0.0 沿用 verdict shape pattern)
- ✅ Frontend render function 拎 path 永遠 `verdict.meta.X`, 唔好再寫 `verdict.meta.meta.X` (Phase 4 拎走 frontend 之前嘅舊 shape)
- ✅ 改 array/object access 之前必先 curl backend 拎 evidence 確認 (對齊 4.55.0 array evidence 永久 rule)
- ✅ 改 `adapter.mjs` 之後必同步 bump `testing-page.js` 嘅 `ALGO_CACHE_BUST` + `testing-page/index.html` 嘅 `?v=2.3.X` (cache bust self-check 永久 rule 21:24)
- ✅ Testing page chart overlay 嘅 silent return (`console.warn + return` 唔 throw) testing page 嗰個 try/catch catch 唔到 → 撳跑算法之後必肉眼 verify chart overlay 有冇 render (**唔可以** 淨靠 console log 確認)
- ✅ M3 trendline toggle 跟 MA toggle 同樣 pattern (lineSeries.applyOptions + localStorage 自動記住 + 出圖 sync), 之後 M4/M5/M6 等加 chart overlay 嘅 module 都跟呢個 pattern
- ✅ **大少 2026-09-09 07:20 加**: 改 `renderXxxResult` / `renderDetailedExplanationXxx` 加 v0.2.0 audit field 必喺 function 開頭加 local variable 拎 `verdict.meta.*` (唔可以假設攞到 caller 嘅 local var — `renderDetailedExplanationIndicators` 係獨立 function, 同 `renderIndicatorsResult` 唔共享 scope, 凡 7 個 audit field 都要喺 function 開頭重新拎)
- ✅ **大少 2026-09-09 07:20 加**: 凡用 audit field 嘅 render line, 必加 falsy guard 兜 backend 唔 emit 嘅 case (e.g. reg gate fail 早 return verdict 唔行 Step 9.5 → `m1State` / `selfCheckTriggered` / `originalConfidence` 全部 `None`, 用 `?:` 或 `!= null` ternary 兜底, 唔可以直接 `originalConfidence * 100` 會 TypeError)

**對應文件**:
- `algorithms/AS-03-cycle-detection/adapter.mjs` line 3775-3876 嘅 `renderTrendlineChartOverlay`
- `testing-page/index.html` line 168-181 嘅 `#trendline-toggle-bar`
- `testing-page/testing-page.js` line 91-105 嘅 localStorage helpers + line 2333-2360 嘅 toggle handler + line 1543-1556 嘅出圖 sync

對應 commit: d663ef01 (fix) + 09ea4c21 (feat)

### M3 A+B special rule + dataWindowDays backend 對齊 永久 rule (大少 2026-09-07 00:02 confirm)

**凡人話**: M3 (趨勢線法) algorithm `_derive_trendline_state` 之前直接 `A in ids → return UP`, 冇處理 spec doc §5 line 109-111 嘅特殊規則「A + B 同時 fire (支撐升 + 壓力降) → 收斂三角形 = SIDEWAYS」, 影響 HK.00700 ['A','B','D','I','J'] 同 US.GOOGL ['A','B','C','D','I','J'] 返 UP 0.9 (錯, 應該 SIDEWAYS). 之前 frontend 舊版 (backups/zigzag-frontend-2026-08-20/adapter.mjs line 5386) 同 backend Python port (algorithm.py line 196-216) 都冇, 從來冇人 implement 落 code. 大少 9月7日 00:02 trigger「撳 M3 跑 00700 結果是上升加信心 90% 肯定有問題」揭發.

**Root cause 確認 (curl evidence)**:
- 5 隻 stock 重新跑 verdict (Spec Sync #39, dataWindowDays=1260):
  - HK.00700 騰訊: SIDEWAYS 0.90 (rules A,B,D,I,J) — fix 前 UP 0.9
  - HK.00005 匯豐: UP 0.90 (rules A,I,J) — 唔受 A+B fix 影響
  - US.AAPL: UP 0.90 (rules A,I,J) — 之前 README 5 隻 stock verify 嗰陣 wishful 寫 SIDEWAYS, 唔係真實 algorithm output
  - US.MSFT: UP 0.90 (rules A,I,J) — 同 README
  - US.GOOGL: SIDEWAYS 0.90 (rules A,B,C,D,I,J) — fix 前 UP 0.9

**A + B special rule priority 擺位** (engineering 判斷):
- 喺 H 真突破壓力之後 (H 蓋過 A + B, 因為 H 係短期真突破重要過 long-term 收斂三角)
- 喺 A 單獨 fire 之前 (special rule override A 單獨拎 UP 嘅 default 行為)
- H + A + B 嗰陣 H 拎 UP (短期真突破蓋過 long-term 收斂三角)
- H + G + A + B 嗰陣 TRANSITION (short-term reversal 高過 long-term pattern, 跟 spec §5 priority H 排第一)

**永久 rule checklist**:
- ✅ M3 algorithm `_derive_trendline_state` 永遠處理 spec doc §5 line 109-111 A+B special rule (唔可以直接 A in ids → return UP)
- ✅ Spec doc §5 嘅所有特殊規則必須 implement 落 algorithm code, 唔可以只寫 spec doc 但 code 唔跟
- ✅ 改 algorithm / spec doc / config 前必先 curl backend `/api/algorithms/run?algo=...&symbol=...&data_window_days=1260` 拎真實 evidence 確認 (對齊 4.55.0 array evidence 永久 rule + Stock 名 evidence 永久 rule)
- ✅ 5 隻 stock verify 結果必須由真實 algorithm output 拎, 唔可以手動估/wishful thinking 寫入 README/PROJECT_SPEC/ARCHITECTURE
- ✅ Backend API handler (`/api/algorithms/run`) 將 query param `data_window_days` 同時放落 `options["dataWindowDays"]` 對齊 algorithm 入面 options.get("dataWindowDays") 拎法 (camelCase) — 之前 options dict 冇呢個 key, 雖然效果係用 trimmed size (run_algorithm line 204-205 已 trim 過) 但 misleading code
- ✅ Frontend M3 stub (`adapter.mjs` `analyzeTrendline` line 3466) 默認 100 改 1260 對齊 testing page 永久 rule 2026-08-14 23:15 (dataWindowDays 永遠用 5 年, 唔再用 100 日默認)
- ✅ 改 backend code 之後必 restart backend (`./start.sh`), 唔可以假設 hot-reload (對齊 Backend hot-reload 永久 rule 2026-08-31 11:01)
- ✅ 改 adapter.mjs / testing-page.js 之後必同步 bump `ALGO_CACHE_BUST` + `?v=2.3.X` (cache bust self-check 永久 rule 21:24)
- ✅ 改 algorithm 之後必 restart backend + curl 拎 evidence 確認 fix work (對齊 array evidence 永久 rule)

**對應文件**:
- `backend/algorithms/trendline/algorithm.py` line 196-224 嘅 `_derive_trendline_state`
- `backend/api/algorithms.py` line 112-119 嘅 options dict
- `algorithms/AS-03-cycle-detection/adapter.mjs` line 3466 嘅 M3 stub default
- `docs/research/AS-03-cycle-detection/MODULE-03-TRENDLINE.md` §5 line 109-111 嘅特殊規則

對應 commit: b259d1db (fix A+B) + febabd99 (fix dataWindowDays) + Spec Sync #39 即將 push

### verdict.meta.symbol 永久 rule (大少 2026-09-07 08:30 confirm, Spec Sync #41)

**凡人話**: `verdict.meta.symbol` 永遠要 = `verdict.symbol` (即係 caller query 嗰個 stock code, e.g. "HK.00700"), 唔可以寫死 "UNKNOWN" / "TEST" / 其他 default value。`verdict.symbol` 喺頂層係 caller 真正 query 嘅 stock code, `verdict.meta.symbol` 喺 meta dict 入面本來設計畀 algo 內部 log / debug 用, 兩個應該係同一個 value。

**Root cause (大少 9月7日 07:00 trigger)**: 大少用 M1 跑 DB 200 隻 stock, 發現 100% verdict 嘅 `meta.symbol` 永遠 "UNKNOWN" (142/142 成功 verdict)。凡人話:M1 答 HK.00700 個 verdict 寫「答案係 UP」✅, 但係補充資料入面寫「客人:unknown」❌, 等於落單紙上客人名漏填。

**Root cause 確認 (curl evidence, 200 隻 stock 跑出 142 隻 UNKNOWN)**:
- 8 個 algo 喺 meta dict 入面 hardcode default value:
  - **M1 ma_alignment** (line 792): `options.get("symbol", "UNKNOWN")` ← UNKNOWN
  - **M3-M6, M7, M8, M9** (7 個 algo): `options.get("symbol", "TEST")` ← TEST
  - **M2 hl_structure** (3 個地方): `options.get("code", "TEST")` ← 拎 "code" 而唔係 "symbol", 仲有 "TEST" 問題
- `backend/api/algorithms.py` line 130-136 嘅 `run_algorithm(..., **options)` spread caller options 但**冇** pass caller 嘅 `symbol` 入 options dict
- `backend/services/algorithm_runner.py` 統一 algorithm 入口 run_algorithm() 冇 inject caller 嘅 symbol 落 options
- Algorithm 拎 `options.get("symbol", ...)` 永遠拎 default, 因為 options dict 冇呢個 key

**Fix (1 line, algorithm_runner.py)**:
- `backend/services/algorithm_runner.py` line 64 (run_algorithm 入面) 加 `options["symbol"] = symbol`
- 對齊 9月6日 23:17 dataWindowDays 永久 rule pattern (algorithm 拎 caller 嘅 value)
- Fix 完之後 200 隻 stock 重跑:
  - **144 隻成功 verdict (100%)** 嘅 `meta.symbol == caller symbol` ✅
  - 0 隻 UNKNOWN, 0 隻 TEST
- M3 trendline / M4 indicators 算法本身冇 emit `meta.symbol` field (即係 verdict 入面冇呢個 key, `None`), 唔受影響
- **M2 hl_structure 用 "code" 而唔係 "symbol", 仍然 "TEST" 唔受呢個 fix 影響**, 要 follow-up 改 M2 algorithm 拎 `options.get("code") or options.get("symbol", "TEST")`

**永久 rule checklist**:
- ✅ Algorithm 喺 verdict meta 寫 stock symbol 永遠用 `options.get("symbol", caller_symbol)` (caller_symbol = top-level `verdict.symbol`), 唔可以 hardcode "UNKNOWN" / "TEST" / 其他 default
- ✅ `backend/services/algorithm_runner.py` 統一 algorithm 入口 run_algorithm() 永遠 inject caller 嘅 symbol 落 options dict (對齊 dataWindowDays 9月6日 23:17 永久 rule)
- ✅ Backend handler `/api/algorithms/run` 唔需要再手動 pass symbol 入 options (runner 統一做)
- ✅ 任何新加 algorithm 唔可以喺 meta dict 寫 "UNKNOWN" / "TEST" / 其他假 default value, 永遠用 caller symbol
- ✅ 改 algorithm_runner.py 之後必 restart backend (`./start.sh`) + curl `/api/algorithms/run?algo=ma_alignment&symbol=HK.00700` 拎 evidence 確認 `meta.symbol == "HK.00700"`

**對應文件**:
- `backend/services/algorithm_runner.py` line 64 (新加 `options["symbol"] = symbol`)
- `backend/algorithms/ma_alignment/algorithm.py` line 792 (原本 hardcode "UNKNOWN", 而家 runner inject 真 value)
- 7 個其他 algo 嗰度 `options.get("symbol", "TEST")` 全部受呢個 fix 影響(默認 "TEST" 變 caller symbol)
- `backend/algorithms/hl_structure/algorithm.py` 3 個地方拎 "code" 而唔係 "symbol" (M2 follow-up)

對應 commit: 即將 push (Spec Sync #41)

### M3 self-check warning 永久 rule (大少 2026-09-07 00:14 confirm)

**凡人話**: M3 (趨勢線法) algorithm 跑完之後, 自己診斷個 verdict 係咪可信, emit 1 個 system warning (🔧 system category), 等 M7 / M8 / M9 見到就**唔好用 M3 嘅 verdict** 做綜合判斷, UI 同步顯示 banner 提示大少「呢個 M3 verdict 唔可信, 小心落單」。

**3 個 self-check 條件** (凡人話):
1. **支撐線太脆弱** — `support numPoints < 4` OR `support R² < 0.6` → `CONFLICT_STATE` (system)
2. **阻力線太脆弱** — `resistance numPoints < 4` OR `resistance R² < 0.6` → `CONFLICT_STATE` (system)
3. **通道太闊** — `channel.widthPct > 0.15` (15%) → `CONFLICT_STATE` (system)

**對齊 M2 self-check warning 永久 rule 嘅 spirit**:
- ✅ M3 algorithm 永遠 emit self-check warning 用 ModuleWarning object (跟 M2 永久 rule pattern)
- ✅ Warning 走完整 propagation chain: M3 → M7 → M8 → M9 → frontend banner
- ✅ 永遠 emit `_warnings` 落 verdict (永久 rule §Module Warning v1.0.0: 唔入 DB table)
- ✅ 對齊 Module Warning v1.1.0 — `category: "system"` 因為 verdict 可能唔可信
- ⚠️ **將來 follow-up**: M7 Synthesizer 拎 M3 warning 自動降 M3 weight (對齊 M2_SKIPPED 永久 rule pattern, 跟 M2 weight 0.15 → 0.05 spirit)
- ⚠️ **將來 follow-up**: 擴展 self-check conditions (e.g. 峰谷太舊 DATA_AGE, 信心太高但 base 弱, short-term 突破但 long-term downtrend)

**對應文件**:
- `backend/algorithms/trendline/algorithm.py` run() 入面 3 個 self-check conditions (line 559-619)
- `_derive_trendline_state()` H 真突破 guard (line 196-244, H fire + support_slope <= 0 → SIDEWAYS)
- `docs/research/AS-03-cycle-detection/MODULE-03-TRENDLINE.md` §4 + §5 (要 update)

對應 commit: 7865544f (fix H guard + self-check warning) + Spec Sync #40 即將 push

### M3 Hurst+ADX gate 永久 rule (大少 2026-09-07 01:08 confirm, Phase 1 (B3) → Spec Sync #51 大少 2026-09-09 00:42 confirm 改 confirmation filter)

**凡人話**: M3 (趨勢線法) 算法開頭加一層 gate, 用 Hurst 指數 + ADX 兩招做 confirmation。Spec Sync #51 (大少 9月9日 00:42 confirm) 改咗舊 Spec Sync #45 嘅 hard gate 行為: 之前 gate fail 早 return SIDEWAYS 0.3 (99% stock 跌到呢度, 對 UP/DOWN 識別差); 而家 gate fail emit 1 個 LOW_CONFIDENCE warning (info level, system category), 由 Layer 4 公式 warn_penalty 自動扣 conf 0.10, 繼續行正常 algorithm (10+2 條 rule + self-check)。對齊 fractalcycles.com 3-layer framework: Hurst + ADX 應該係 confirmation 而非 hard gate, 對齊 AInvest 標準 H>0.65 strong / 0.5-0.6 maybe / <0.4 mean-reverting。

**兩招確認**：
1. **Hurst 指數 (DFA, 100 日)**: 量度 trending 持續性
   - H > 0.55 = 有方向 (trending)
   - H ≈ 0.50 = random walk
   - H < 0.45 = mean-reverting
2. **ADX (Wilder 14 日 standard)**: 量度趨勢強度
   - ADX > 25 = 強趨勢
   - ADX 18-25 = 發展中
   - ADX < 18 = 弱趨勢 / 橫行

**Gate 規則** (Spec Sync #51 改 confirmation filter):
- H < 0.45 OR ADX < 18 → **emit LOW_CONFIDENCE warning** (info level, system category) + **繼續行 algorithm**, conf 自動扣 0.10 (Layer 4 warn_penalty)
- H ≥ 0.45 AND ADX ≥ 18 → **PASS** → 繼續正常算法 (10 條 rule + 3 個 self-check warning)
- ❌ **唔再 early return SIDEWAYS 0.3** (Spec Sync #45 嘅 hard gate 行為已廢)

**Meta 新加 field**:
- `hurst`: Hurst 指數 (0-1, 4 decimals)
- `adx`: ADX 值 (0-100, 4 decimals)
- `plusDI` / `minusDI` / `atr`: Layer 2 (tactical) emit 對齊 Wilder 1978 standard
- `hurstLogR2`: Layer 1 (regime) DFA log-log fit R² (Peng 1994 pitfall check)

**Spec Sync #51 改動 (Spec Sync #45 → #51)**:
- ✅ 改 hard gate → confirmation filter (避免 99% stock 跌到 SIDEWAYS 嘅 false negative)
- ✅ ADX threshold 20 → 18 (對齊 fractalcycles.com 3-layer framework 標準)
- ✅ 對齊 5-layer framework: Layer 1 (regime) + Layer 2 (tactical) + Layer 3 (direction) + Layer 4 (breakout) + Layer 5 (pattern)
- ✅ Bulkowski 條件 30/5 → 20/3 (對齊 Donchian 20-period standard)
- ✅ Donchian Rule K/L 永遠 priority 第一/二位 (newtrading.io 100 年 backtest 74.1% win rate)

**解決 audit 揭發嘅 3 個問題** (Spec Sync #40 baseline, 404 隻 stock):
- ✅ **一致率** 28% → 預期升：M3 改判 SIDEWAYS 對齊 M1+M2
- ⚠️ **self-check 觸發** 84% → 預期降但仍係高 (因 84% stock 唔係 strong trending)
- ✅ **over-confident** 46% → 預期降：conf 自動扣 0.10 + floor 0.3 唔再 over-confident

**永久 rule checklist**:
- ✅ M3 algorithm 永遠 emit Hurst+ADX gate check 用 `compute_hurst()` (DFA) + `compute_adx()` (Wilder 14 日)
- ✅ Gate 永遠 emit LOW_CONFIDENCE warning 而非 SIDEWAYS 早 return (Spec Sync #51 confirmation filter)
- ✅ Threshold H < 0.45 / ADX < 18 (Spec Sync #51 confirm)
- ✅ Gate 走完整 propagation chain: M3 → M7 → M8 → M9 → frontend banner
- ✅ Meta 永遠 emit `hurst` + `adx` 兩個 field (audit 對比用)
- ✅ Backend `trendline/algorithm.py` v0.1.4 + Frontend `modules/trendline.ts` v0.1.4 1:1 port 同步
- ✅ 對齊 Module Warning v1.1.0 — `category: "system"` 因為 verdict 可能唔可信
- ✅ ADX Wilder's smooth 要 `/ period` (Wilder's standard formula, 唔可以漏)

**對應文件**:
- `backend/algorithms/trendline/algorithm.py` run() Step 0.5 gate (Hurst+ADX check, Spec Sync #51 line 788-807 confirmation filter)
- `algorithms/AS-03-cycle-detection/modules/trendline.ts` detect() Step 0.5 gate (1:1 port)
- `docs/research/AS-03-cycle-detection/MODULE-03-TRENDLINE.md` §4.2 Hurst+ADX gate section + §4.4 5-layer framework
- 對齊 §M3 5-layer framework 永久 rule (Spec Sync #51, line 3150-3184 段)

對應 commit: `863bb22b` (fix(trendline) Hurst+ADX gate v0.1.4 hard gate) + `aa2cb3bb` (Spec Sync #51 改 confirmation filter + 5-layer framework)

### M2 HL Structure self-check warning 永久 rule (大少 2026-09-06 15:08 confirm)

**凡人話**: M2 (高低點結構法) 算法跑完之後,自己診斷個 verdict 係咪可信 / 有冇失效。如果發現有問題 (e.g. 5 年尺度判 SIDEWAYS 但短線救返、極值點太舊、結構信號老化),emit 一個系統警告 (🔧 system category),等 M7 / M8 / M9 見到就**唔好用 M2 嘅 verdict** 做綜合判斷,UI 同步顯示 banner 提示大少「呢個 M2 verdict 唔可信,小心落單」。

**5 個 self-check 條件** (凡人話):
1. **形態見頂 / 見底預警** (Step 13) — 最近 3 個峰排成「中間高兩邊低」(頭肩頂),或 2 個峰差唔多高度 (雙頂),代表股價見頂信號強,M2 判嘅「上升」可能快反轉 → `CONFLICT_STATE`
2. **峰谷太舊** (Step 15) — 最近一個峰 / 谷已經超過 20 日前,代表個結構信號開始過時,新嘅價已經行咗好遠 → `DATA_AGE` (info)
3. **5 年尺度 vs 短線矛盾** (Step 16/17 核心) — 原本 5 年 K 線睇係「橫行」,但靠 60 日短線 + 突破救返判「上升」,即係 verdict 唔係真實 5 年結構 (9月6日 11:34 trigger 00019 太古 + 00013 和黃醫藥就係呢個 case) → `FALLBACK_USED`
4. **信心指數太弱** (Step 18) — M2 自己算嘅 confidence < 0.3,代表算法自己都唔太信個判定 → `THRESHOLD_BREACH`
5. **結構已經破壞** (Step 14) — 當前股價已經離開最近峰 / 谷範圍,峰谷結構信號失效,等新峰谷形成先有意義 → `CONFLICT_STATE`

**Skip 邏輯 (做法 A + C 混合, 大少 15:08 confirm)**:
- **A 行為層**: M7 Synthesizer 拎到 M2 warning → 自動將 M2 嘅 `base_weight` 由 0.15 → 0.05
- 5 個其他 module (M1/M3/M4/M5/M6) 等比例 normalize 補返 0.10, sum 仍 = 1.0
- 凡人話: M2 仲有 vote 但 weight 大減,大少唔好太信
- **C 顯示層**: 頂部 banner 顯示 🔧 系統警告 (M2 self-check 觸發嗰陣)
- M2 verdict card 內 WarningCard inline 顯示 critical + warning level warning
- Copy button 一鍵 copy Markdown 4 樣格式
- 凡人話: 大少睇 banner 即知「呢個 M2 verdict 唔可信」

**M7_SKIPPED warning emit**:
- M7 emit 1 個 stock_state `MODULE_PARTIAL` warning 通知 banner「M2 self-check 觸發, 自動降 weight 0.15 → 0.05」
- 沿用 `MODULE_PARTIAL` 唔加新 code (對齊 15 個 warning code 永久 rule)
- M7 meta 加 `m2_discounted: bool` + `m2_original_weight: 0.15` + `m2_discounted_weight: 0.05` 3 個 field

**永久 rule checklist**:
- ✅ M2 algorithm 永遠 emit 5 個 self-check warning (統一用 `make_warning()` / `makeWarning()` ModuleWarning object, 永久 rule §Module Warning v1.1.0)
- ✅ 唔用 string array warnings (永久 rule 沿用, 違規 case 已修)
- ✅ Backend `hl_structure/algorithm.py` v0.3.0 + Frontend `modules/hl-structure.ts` v0.2.0 1:1 port 同步 (frontend skip #3 override-specific 因爲 v0.1.0 仲未 port Step 16/17)
- ✅ M7 Synthesizer `synthesizer/algorithm.py` v1.1.0 自動 weight 折扣 + emit M2_SKIPPED warning
- ✅ Frontend `adapter.mjs` synthesize() line 5893-5900 已經自動 propagate M1-M6 warnings 落 M7 verdict._warnings, frontend testing page 用 `renderWarningBanners()` 自動 render banner (frontend 唔需要額外改 cycle-synthesizer.ts 因爲佇係兩線策略 frontend, 唔做 SSI 計算)
- ✅ 永遠 emit `_warnings` 落 verdict (永久 rule §Module Warning v1.0.0: 唔入 DB table)
- ✅ Warning 走完整 propagation chain: M2 → M7 → M8 → M9 → frontend banner

**對應文件**:
- `backend/algorithms/hl_structure/algorithm.py` v0.3.0
- `algorithms/AS-03-cycle-detection/modules/hl-structure.ts` v0.2.0
- `backend/algorithms/synthesizer/algorithm.py` v1.1.0
- `docs/research/AS-03-cycle-detection/MODULE-02-HL-STRUCTURE.md` v0.3.0
- `docs/research/AS-03-cycle-detection/MODULE-WARNING-SYSTEM.md` v1.2.0

對應 commit: <即將 push>

### M2 self-check penalty 永久 rule (大少 2026-09-07 22:00 confirm, Spec Sync #48)

**凡人話**: M2 (高低點結構法) 算法跑完 Step 19 emit 5 個 self-check warning 之後,自己再行 Step 19.5 — 如果 critical + warning level warning 觸發 (CONFLICT_STATE / FALLBACK_USED / THRESHOLD_BREACH / VERDICT_MISSING),自動將 confidence 折到 0.3 floor。即係算法自己都 flag 唔 sure 嗰陣,大少唔應該再睇到 80% 高信心。state 唔變, 由 M7 layer 處理 weight 折扣。

**Root cause 確認 (大少 9月7日 21:47 trigger)**:
- 撳 M2 跑 HK.00700 見到 verdict `state=UP confidence=0.8` (強升 80%) + 🟡 CONFLICT_STATE warning (峰谷結構已破壞)
- 大少 trigger 「00700 還是強升 80% 這個可以怎處理」, 因為 backend emit warning 但 raw verdict 仲係高信心, 大少會誤信
- 之前 commit 1f509b18 (Fix A+B+C) 修咗 frontend warning UI 唔 render 嘅 bug, 但 M2 algorithm 自己嘅 confidence 仍然 raw 0.8
- 凡人話: 「我口話唔 sure, 我答案就係 UP 0.8」嘅邏輯矛盾

**對齊 M3 Layer 4 formula spirit** (大少 9月7日 00:14 Spec Sync #45):
- M3 self-check warning 永久 rule Layer 4 formula 永久 ban conf=1.0, conf clamp 0.3-0.95, 永遠 self-check warning 觸發即扣 conf 0.3 floor
- M2 沿用同一個 pattern 對齊 backend 一致性
- 對齊永久 rule §M2 self-check warning (大少 9月6日 15:08) spirit

**Step 19.5 self-check penalty 邏輯** (凡人話):
1. 拎 critical + warning level 嘅 self-check warning (4 個 code: CONFLICT_STATE / FALLBACK_USED / THRESHOLD_BREACH / VERDICT_MISSING)
2. info level warning (DATA_AGE) **唔觸發** floor (對齊 §Module Warning v1.1.0 spirit)
3. 觸發時 confidence = `max(confidence * 0.375, 0.3)` → 即原本 0.8 → 0.3, 原本 0.56 → 0.3
4. clamp `min(confidence, 0.95)` → 永久 ban conf=1.0 (對齊 M3 Layer 4 永久 rule)
5. state 唔變 → 由 M7 layer 處理 weight 折扣 0.15 → 0.05 (對齊 M2 self-check weight 折扣 永久 rule)

**Meta 新加 audit field**:
- `self_check_triggered: bool` — 呢個 verdict 有冇觸發 self-check penalty
- `original_confidence: float` — 原本 confidence (4 decimals), 唔受 penalty
- 凡人話: 畀 audit 同 frontend verify, 大少睇到「conf 由 0.8 折到 0.3 因為 self_check_triggered=true」

**5 隻 stock verify 結果** (commit 51e19234):
- **HK.00005 匯豐**: UP 0.7467, self_check_triggered=False, 1 個 info warning (DATA_AGE), 唔觸發 floor ✅
- **US.AAPL**: SIDEWAYS 0.3, self_check_triggered=False, 0 warning, 本身已低 ✅
- **US.MSFT**: UP **0.3**, self_check_triggered=True, original_conf=0.56 ✅
- **US.GOOGL**: SIDEWAYS 0.3, self_check_triggered=True, original_conf=0.27 (floor 唔變) ✅
- **HK.00700 騰訊**: UP **0.3**, self_check_triggered=True, original_conf=**0.8** ✅ (大少 trigger case)

**永久 rule checklist**:
- ✅ M2 algorithm Step 19.5 永遠拎 critical + warning level self-check warning 觸發 conf floor 0.3
- ✅ 公式 `max(conf * 0.375, 0.3)` — 原本 conf 0.8 → 0.3, 0.56 → 0.3, 0.27 → 0.3 (floor 唔變)
- ✅ 永遠 ban conf=1.0 (clamp 0.95, 對齊 M3 Layer 4 永久 rule)
- ✅ info level warning (DATA_AGE) 唔觸發 floor (對齊 §Module Warning v1.1.0 spirit)
- ✅ state 唔變, 由 M7 layer 處理 weight 折扣 (對齊 M2 self-check weight 折扣永久 rule)
- ✅ Meta 永遠 emit `self_check_triggered: bool` + `original_confidence: float` 2 個 audit field
- ✅ 改 M2 algorithm 之後必 restart backend (`./start.sh`) + curl 拎 evidence 確認
- ✅ 對齊 M3 Layer 4 formula spirit 永久 rule (Spec Sync #45 大少 9月7日 00:14)

**對應文件**:
- `backend/algorithms/hl_structure/algorithm.py` Step 19.5 self-check penalty
- `docs/research/AS-03-cycle-detection/MODULE-02-HL-STRUCTURE.md` v0.4.0 (待更新)

對應 commit: `51e19234` (feat(m2-self-check-penalty): Step 19.5 auto floor confidence 0.3 when self-check warning 觸發)

### M6 Volatility v2.0.0 永久 rules (大少 2026-09-10 09:50 confirm, Spec Sync #54)

**凡人話**: M6 (波動率與市場結構收縮擴張檢測法) v1.0.0 永遠 100% SIDEWAYS 係錯嘅, 2026-09-10 09:50 Spec Sync #54 做咗 11 個 fix — 加 Hurst+ADX regime gate + M1 state filter + self-check warning + self-check penalty + 修 5 個 critical bug + 重寫 VCP 跟 Minervini 標準 + 加 momentum histogram + 加 bearish squeeze fire + 加 clean trend breakdown + 修 follow-through 邏輯矛盾 + 修 S2/S3/S8 is_squeeze guard, 對齊 M2/M3/M4 永久 rule pattern + 對齊 TTM Squeeze John Carter 2005 standard + 對齊 Mark Minervini VCP 教科書。

**5 隻 stock evidence** (v2.0.0 vs v1.0.0, dataWindowDays=1260):
- HK.00700 騰訊: state=SIDEWAYS setup=no_clear_setup score=0.25 hurst=0.4261 adx=9.86 gate=FAIL mom=bear vcp.det=False (5 個 contractions 但 higherLows=False stage2=False) warnings=CONFLICT_STATE+THRESHOLD_BREACH
- HK.00005 匯豐: state=SIDEWAYS hurst=0.4363 adx=18.36 gate=FAIL mom=bull vcp.det=False (3 個 contractions higherLows=True 但 stage2=True) 
- US.AAPL: state=SIDEWAYS hurst=0.6431 adx=13.61 gate=FAIL mom=bull follow.direction=up failure=weak_follow_through (C5 fix 確認: upward breakout 跟進 0.22 < 0.4 正確 trigger)
- US.MSFT: state=SIDEWAYS hurst=0.6531 adx=36.22 gate=PASS (唯一 PASS) rules=[] (I6 fix 確認: 冇 squeeze 所以 S2/S8 唔誤判)
- US.GOOGL: state=SIDEWAYS hurst=0.6546 adx=7.0 gate=FAIL mom=bear follow.direction=down failure=none (C3 fix 確認: 之前誤判 weak_follow_through, 而家向下 breakout 唔 trigger)

**§M6 Hurst+ADX regime gate (A1, 對齊 M3 Spec Sync #45 永久 rule)**
- ✅ M6 algorithm Step 0.5 永遠 emit Hurst+ADX gate check
- ✅ H < 0.45 OR ADX < 20 → emit 1 個 CONFLICT_STATE warning (info level) + 繼續行
- ✅ 對齊 M4 v0.3.0 Option 1: 唔好 early return, verdict 仍然 SIDEWAYS 0.3
- ✅ Backend `_compute_hurst` (返 tuple) + `_compute_adx` (返 dict) from `trendline.algorithm`
- ✅ Frontend `computeHurst` (返 number) + `computeAdx` (返 number) from `./trendline.ts`
- ✅ Meta 永遠 emit `hurst` + `adx` + `regimeGate` 3 個 audit field
- ✅ 對齊 Module Warning v1.1.0 — `CONFLICT_STATE` info level, 唔 floor conf

**§M6 M1 state trend filter cross-module alignment (A2, 對齊 M4 Spec Sync #52 永久 rule)**
- ✅ algorithm_runner.py 統一 inject `options["m1State"]` 落 M6
- ✅ M6 見到 M1=DOWN/SIDEWAYS 但 M6 出 bullish setup → FALLBACK_USED warning + entry score × 0.5
- ✅ M6 見到 M1=UP/SIDEWAYS 但 M6 出 bearish setup → FALLBACK_USED warning + entry score × 0.5
- ✅ Meta 永遠 emit `m1State: 'UP' | 'DOWN' | 'SIDEWAYS' | 'TRANSITION'` + `m1FilterApplied: bool`

**§M6 self-check warning emit (A3+A4, 對齊 §M2 self-check + §M3 + §M4 永久 rule)**
- ✅ `INSUFFICIENT_DATA` (critical) — K 線唔夠 85 條
- ✅ `CONFLICT_STATE` (info) — Hurst+ADX gate 唔過 OR noisy_squeeze
- ✅ `FALLBACK_USED` (warning) — M1 state 同 M6 setup 矛盾
- ✅ `THRESHOLD_BREACH` (warning) — 最終 conf < 0.3 門檻
- ✅ `MODULE_PARTIAL` (warning) — VCP 結構 partial 確認 (1 contraction < 2)
- ✅ 統一用 `make_warning()` / `makeWarning()` ModuleWarning object

**§M6 self-check penalty (A5, 對齊 §M2 self-check penalty Spec Sync #48 永久 rule)**
- ✅ M6 algorithm Step 7.5 永遠拎 critical + warning level self-check warning 觸發 conf floor 0.3
- ✅ 公式 `max(conf * 0.375, 0.3)` — 原本 conf 0.8 → 0.3, 0.56 → 0.3, 0.27 → 0.3
- ✅ info level (CONFLICT_STATE) 唔觸發 floor
- ✅ state 唔變, 由 M7 layer 處理 weight 折扣
- ✅ Meta 永遠 emit `selfCheckTriggered: bool` + `originalConfidence: float` 2 個 audit field

**§M6 修 Critical C1 — cycle 推導加 DOWN state**
- ✅ 之前 M6 永遠 UP/SIDEWAYS, 跌市永遠 SIDEWAYS (邏輯錯)
- ✅ 而家: bear_squeeze_fire / clean_trend_breakdown → cycle='downtrend' → state='DOWN'
- ✅ 對齊 TTM Squeeze 標準 bearish setup

**§M6 修 Critical C3 — follow-through 邏輯矛盾**
- ✅ 之前 downward breakout 仍然 trigger weak_follow_through (邏輯錯, 將「跌穿」誤判為「假突破」)
- ✅ 而家: upward 跟進失敗先 trigger weak_follow_through
- ✅ 向下突破用 close < prev_low 嘅比率計 price_progression
- ✅ Meta 加 `direction: 'up' | 'down' | 'none'` 標示突破方向
- ✅ Failure mode `weak_follow_through` 只係 upward breakout case

**§M6 修 Critical C5 — S6/S7 結構性收縮/擴張用 total_atr 唔係 noise_atr**
- ✅ 之前用 noise_atr, 對齊波動率結構嘅 spirit 唔對
- ✅ 而家: 過去 5 日 total_atr (= trend_atr + noise_atr) < 之前 5 日 × 0.85 → atr_contraction

**§M6 修 Info I6 — S2/S3/S8 條件加 `is_squeeze` guard**
- ✅ 之前 S2 「Squeeze 質量高」trigger 用 `quality_score >= 0.6` 完全唔睇係咪真 squeeze
- ✅ 而家: S2/S3/S8 全部必須 `is_squeeze=True` 先 trigger
- ✅ quality_score threshold 由 0.6 → 0.7 (對齊 TTM Squeeze 標準)

**§M6 加 A7 — momentum histogram (對齊 TTM Squeeze 標準)**
- ✅ 對齊 TTM Squeeze John Carter 2005 standard 3 個 component: BB + KC + Momentum Histogram
- ✅ Histogram 計算: smoothed linear regression of close 過去 20 日
- ✅ `momentumDir: 'bull' | 'bear' | 'flat'` 對齊 setup 推導
- ✅ Meta 永遠 emit `momentumHistogram: float` + `momentumDir: string` 2 個 field

**§M6 加 A8 — bearish squeeze fire + clean trend breakdown (對齊 TTM Squeeze 標準)**
- ✅ bear_squeeze_fire (0.85): 之前 Squeeze → 而家 NOT Squeeze + quality >= 0.7 + momentum bear
- ✅ clean_trend_breakdown (0.65): noise < trend × 0.5 + regime=trending + follow >= 0.6 + momentum bear
- ✅ Cycle 推導: bear_squeeze_fire / clean_trend_breakdown → 'downtrend' → state='DOWN'
- ✅ 凡人話: 跌市 M6 都可以出 setup, 對齊 TTM Squeeze 教科書 bearish pattern

**§M6 重寫 VCP 跟 Minervini 標準 (Phase 2)**
- ✅ 2-5 個 progressively smaller pullback: C1 > C2 > C3 > C-final, 每個 ≤ 70% 之前
- ✅ higher low 結構 (每個 contraction low 比之前高)
- ✅ 量縮確認 (最後 contraction vol < avg vol × 60%)
- ✅ Stage 2 uptrend filter (200-day MA sloping up + current close > 200 MA × 0.85)
- ✅ Lookback 20 日 → 60 日 (對齊 Minervini 標準窗口)
- ✅ VCP detected = progressively_smaller AND higher_lows AND vol_tightening AND stage2_uptrend AND contractions >= 2
- ✅ 凡人話: 跟 Mark Minervini 教科書 VCP 標準, 唔再係 5 隻 stock 全部 trigger 唔到

**§M6 加 Warning W5 — no_setup 失敗模式**
- ✅ Spec doc 講 3 種失敗模式, code 只出 2 種 (noisy_squeeze + weak_follow_through)
- ✅ 而家補返: 冇 squeeze 冇 breakout + choppy 環境 → no_setup
- ✅ no_setup base_win -0.05

**Backend + Frontend 1:1 port 同步**:
- ✅ Backend `backend/algorithms/volatility/algorithm.py` v2.0.0
- ✅ Frontend `algorithms/AS-03-cycle-detection/modules/volatility.ts` v2.0.0
- ✅ Spec doc `docs/research/AS-03-cycle-detection/MODULE-06-VOLATILITY.md` updated

對應 commit: 即將 push (Spec Sync #54, 大少 2026-09-10 trigger "做 A 和 B")

### M4 Indicators v0.2.0 永久 rules (大少 2026-09-09 01:55 confirm, Spec Sync #52)

**凡人話**: M4 (動能背馳法) 算法 v1.0.0 永遠 100% SIDEWAYS 係錯嘅, 2026-09-09 01:55 Spec Sync #52 做咗 12 個 fix — 加 Hurst+ADX regime gate + M1 state filter + self-check warning + self-check penalty + cross-confirm bonus + meta.symbol + 改 lookbackDays 60→250 + signalThreshold 0.6→0.5 + ban conf 1.0 + confirmation candle + RSI 5 日 linear slope, 對齊 M2/M3 永久 rule pattern。

**Stage 2 audit 結果** (214 隻 stock, v0.2.0 vs v1.0.0):
- v1.0.0 baseline: 211/214 SIDEWAYS (98.6%), 0 UP verdict, 0 warning
- v0.2.0: **188/214 (87.9%) 有 warning**, **2 UP verdict (新!)**
- Warning code 分布: CONFLICT_STATE 101, INSUFFICIENT_DATA 44, THRESHOLD_BREACH 43
- M1 一致率: 56.5% (v0.2.0, A3 M1 filter 持續改善)

**§M4 Hurst+ADX regime gate (A1, 對齊 M3 Spec Sync #45 永久 rule)**
- ✅ M4 algorithm Step 0.5 永遠 emit Hurst+ADX gate check
- ✅ H < 0.45 OR ADX < 20 → 強制 return SIDEWAYS + emit 1 個 CONFLICT_STATE warning (info level, 唔 floor conf)
- ✅ Backend `indicators/algorithm.py` + Frontend `modules/indicators.ts` 1:1 port 同步
- ✅ Meta 永遠 emit `hurst` + `adx` + `regimeGate` 3 個 audit field
- ✅ Backend import `_compute_hurst` (返 tuple) + `_compute_adx` (返 dict) from `trendline.algorithm` (有底線 prefix)
- ✅ Frontend import `computeHurst` (返 number) + `computeAdx` (返 number) from `./trendline.ts` (冇底線, frontend 簡化版)
- ✅ 對齊 Module Warning v1.1.0 — `CONFLICT_STATE` info level, 唔 floor conf

**§M4 M1 state trend filter cross-module alignment (A3)**
- ✅ algorithm_runner.py 統一 inject `options["m1State"]` 落 M4 (對齊 9月7日 08:30 meta.symbol 永久 rule pattern)
- ✅ M4 見到 M1=DOWN 但 M4 出 buy → bull_score × 0.5 + emit FALLBACK_USED warning
- ✅ M4 見到 M1=UP 但 M4 出 sell → bear_score × 0.5 + emit FALLBACK_USED warning
- ✅ Signal emit `m1FilterApplied: bool` flag 畀 caller audit
- ✅ Meta 永遠 emit `m1State: 'UP' | 'DOWN' | 'SIDEWAYS' | 'TRANSITION'` 4 個 value
- ✅ 凡人話: 大環境 DOWN 嗰陣唔好亂話 buy, 大環境 UP 嗰陣唔好亂話 sell, 由 M1 過濾

**§M4 self-check warning emit (A4, 5 個 code)**
- ✅ `INSUFFICIENT_DATA` (critical) — K 線唔夠 min data 295 條
- ✅ `CONFLICT_STATE` (info) — Regime gate 唔過, 唔 floor conf
- ✅ `FALLBACK_USED` (warning) — M1 state 同 M4 signal 矛盾, 已降權 50%
- ✅ `THRESHOLD_BREACH` (warning) — 最終 conf < 0.3 門檻
- ✅ `MODULE_PARTIAL` (warning) — 冇背馳 evidence 但有 buy/sell signal
- ✅ 統一用 `make_warning()` helper (對齊 §Module Warning v1.1.0 spirit)
- ✅ Frontend indicators.ts 對齊用 `warnings: string[]` 落 verdict (永久 rule v1.1.0 spirit, 永遠 inlined 唔入 DB)

**§M4 self-check penalty (A5, 對齊 M2 9月7日 22:00 永久 rule spirit)**
- ✅ M4 algorithm Step 9.5 永遠拎 critical + warning level self-check warning 觸發 conf floor 0.3
- ✅ 公式 `max(conf * 0.375, 0.3)` — 原本 conf 0.8 → 0.3, 0.56 → 0.3, 0.27 → 0.3 (floor 唔變)
- ✅ info level (CONFLICT_STATE) 唔觸發 floor (對齊 §Module Warning v1.1.0 spirit)
- ✅ state 唔變, 由 M7 layer 處理 weight 折扣
- ✅ Meta 永遠 emit `selfCheckTriggered: bool` + `originalConfidence: float` 2 個 audit field
- ✅ 對齊 M2 / M3 Layer 4 formula 永久 rule spirit (Spec Sync #45+#48)

**§M4 cross-confirm bonus (A7)**
- ✅ RSI + MACD 同時出現同一類背馳 (cross-confirm) → bull_score / bear_score +0.10 bonus
- ✅ Signal emit `crossConfirmed: bool` flag 畀 caller audit
- ✅ 凡人話: 兩個獨立指標同時確認, 信心提升 (對齊 Tradealgo 71% win rate research)

**§M4 Layer 4 formula ban conf 1.0 (B1, 對齊 M3 Layer 4 永久 rule)**
- ✅ Signal strength clamp 0.95 (永久 ban 1.0)
- ✅ Confidence clamp 0.95
- ✅ 對齊 M3 Layer 4 永久 rule (Spec Sync #45, 2026-09-07 00:14)

**§M4 confirmation candle (B2)**
- ✅ B2 放量必須同時 收 > MA5 (對齊 Arxum 67% win rate research)
- ✅ 之前 v1.0.0 純粹放量 (volume > 10d avg × 1.2), v0.2.0 加 `close > MA5` 確認
- ✅ 同時觸發先 +0.15 score

**§M4 RSI 5 日 linear slope (B3)**
- ✅ 用 `rsi[-1] - rsi[-6]` raw difference, threshold ±5.0 (0-100 scale 嘅 5% 變化)
- ✅ 之前 v1.0.0 單點 vs 5 日 average 唔穩, v0.2.0 改 linear slope

**§M4 meta.symbol caller symbol (A6, 對齊 9月7日 08:30 永久 rule)**
- ✅ Algorithm 永遠用 `options.get("symbol", "UNKNOWN")` 拎 caller symbol
- ✅ algorithm_runner.py 統一 inject `options["symbol"] = caller_symbol`
- ✅ Meta 永遠 emit `symbol` field, 唔好 hardcode "TEST" / "UNKNOWN" / 其他 default
- ✅ Frontend indicators.ts 對齊用 `ctx.symbol` 拎 caller symbol (永久 rule 9月7日 08:30 spirit)

**§M4 config 改動 (A2 + A8)**
- ✅ `signalThreshold` 0.6 → 0.5 (對齊業界 momentum win rate 35-45%, 之前 0.6 太嚴 98.6% 永遠 hold)
- ✅ `lookbackDays` 60 → 250 (1 年尺度, 凡人話: 60 日太短, 永遠 0 個 historical opportunity)
- ✅ Min data 119 條 → 295 條 (14 RSI + 35 MACD + 250 lookback + 10 buffer)
- ✅ Backend `config.py` + Frontend `config.ts` 同步 (1:1 port)

**永久 rule checklist** (對齊 M2/M3 永久 rule pattern):
- ✅ Backend `indicators/algorithm.py` v0.2.0 + Frontend `modules/indicators.ts` v0.2.0 1:1 port 同步
- ✅ Backend `config.py` v0.2.0 + Frontend `config.ts` v0.2.0 同步
- ✅ `algorithm_runner.py` 統一 inject `m1State` + `symbol` 落 M4 options (對齊 9月7日 08:30 + A3 永久 rule)
- ✅ Adapter `renderIndicatorsResult` 對齊 v0.2.0 verdict shape (加 Hurst/ADX/regimeGate/M1 state/self-check/cross-confirm 顯示)
- ✅ `renderDetailedExplanationIndicators` 加 Hurst/ADX/M1/regimeGate/cross-confirm/self-check 詳細解讀 line
- ✅ Spec doc `MODULE-04-MOMENTUM-DIVERGENCE.md` v0.2.0 update (12 個 fix 全部寫入 §5 algorithm step + §8 永久 rules)
- ✅ 改 backend / frontend / adapter / config / spec doc 任何一個, 必對齊其他 4 個 (1:1 port 永久 rule)
- ✅ 改 backend 之後必 restart backend (`./start.sh`) + curl `/api/algorithms/run?algo=indicators&symbol=HK.00700&data_window_days=1260` 拎 evidence 確認
- ✅ 改 adapter.mjs / testing-page.js 之後必同步 bump `ALGO_CACHE_BUST` + `?v=2.3.X` (cache bust 永久 rule)
- ✅ 凡人話: M4 v0.2.0 12 個 fix 對齊 M2/M3 永久 rule pattern, 凡 backend algorithm 改 self-check warning 嗰陣, frontend + adapter + spec doc 全部要一齊改 (1:1 port 永久 rule)

**5 隻 stock verify 結果** (Stage 2 curl evidence, 對齊 9月5日 stock evidence 永久 rule):
- **HK.00700 騰訊**: state=SIDEWAYS conf=0.3 Hurst=0.428 ADX=9.25 emit 1 個 CONFLICT_STATE (regime gate 唔過) ✅
- **HK.00005 匯豐**: state=SIDEWAYS conf=0.0 INSUFFICIENT_DATA (144 K 線 < 295 min_required) ✅
- **US.AAPL**: state=SIDEWAYS conf=0.3 Hurst=0.674 ADX=14.22 CONFLICT_STATE ✅
- **US.MSFT**: state=SIDEWAYS conf=0.35 signal=hold Hurst=0.649 ADX=37.04 (regime pass, score < 0.5) ✅
- **US.GOOGL**: state=SIDEWAYS conf=0.3 Hurst=0.686 ADX=6.68 CONFLICT_STATE ✅

**對應文件**:
- `backend/algorithms/indicators/algorithm.py` v0.2.0 (936 行, 12 個 fix 全部 implement)
- `backend/algorithms/indicators/config.py` v0.2.0 (A2 + A8, 2 個 value 改)
- `backend/services/algorithm_runner.py` (A3 + A6: 統一 inject `m1State` + `symbol` 落 M4 options)
- `algorithms/AS-03-cycle-detection/modules/indicators.ts` v0.2.0 (~870 行, 1:1 port backend)
- `algorithms/AS-03-cycle-detection/config.ts` v0.2.0 (A2 + A8, 2 個 value 改)
- `algorithms/AS-03-cycle-detection/adapter.mjs` v0.2.0 (對齊 backend shape 加 Hurst/ADX/M1/self-check/cross-confirm 顯示)
- `docs/research/AS-03-cycle-detection/MODULE-04-MOMENTUM-DIVERGENCE.md` v0.2.0 (12 個 fix 全部寫入 §5 + §8)

對應 commit: `e342e4b` (M4 v0.2.0 backend, 261 line 改) + Spec Sync #52 即將 push (frontend sync + cache bust + spec doc update)

### M4 Indicators v0.4.0 Signal-based Output 永久 rules (大少 2026-09-09 13:56 confirm, Spec Sync #55 Option 1)

**凡人話**: M4 唔係 trend follower, 拎走舊 UP/DOWN/SIDEWAYS 3-state 框架 (Spec Sync #52 對齊 M1/M2/M3 trend follower 嘅 framework), 改用 8 個主信號 signal-based output, 對齊大少 13:56 trigger「M4 其實比較適合睇轉勢」嘅 user intent。

**Stage 1 audit 結果** (8 隻 stock, v0.4.0 vs v0.3.0):
- HK.01888 建滔積層板: signal=exhausted_neutral (regime PASSED, MACD 0 軸上面縮短 + RSI 接近 50) ✅
- HK.00700 騰訊控股: signal=exhausted_neutral (regime FAILED, soft fail override) ✅
- HK.01347 華虹半導體: signal=exhausted_neutral (regime FAILED, soft fail override) ✅
- HK.00021: signal=momentum_weak (regime PASSED, RSI 30-50 + MACD 0 軸下面 + RSI 跌) ✅
- US.TSLA 特斯拉: signal=exhausted_neutral (regime PASSED, MACD 0 軸上面縮短) ✅
- 8 個主信號 priority 邏輯 work, backend evidence 確認 5 隻 stock 拎到 `signal / signalLabel / signalAction / subSignals / strength` 5 個新 field ✅

**§M4 v0.4.0 Signal-based output 8 個主信號 (優先級由高到低)**
- ✅ 1. `top_reversal` 見頂 (沽貨/觀望) — 頂背馳 + RSI > 70 + MACD 縮短
- ✅ 2. `bottom_reversal` 見底 (入貨/留意) — 底背馳 + RSI < 30 + MACD 縮短
- ✅ 3. `macd_golden_cross` MACD 金叉 (留意) — DIF 升穿 DEA + RSI 過冷
- ✅ 4. `macd_death_cross` MACD 死叉 (留意) — DIF 跌穿 DEA + RSI 過熱
- ✅ 5. `momentum_strong` 動力強 (持有) — RSI 50-70 + MACD 0 軸上面 + RSI 上升
- ✅ 6. `momentum_weak` 動力弱 (減持/觀望) — RSI 30-50 + MACD 0 軸下面 + RSI 下跌
- ✅ 7. `exhausted_neutral` 動能耗盡失方向 (觀望) — MACD 縮短 + RSI 接近 50
- ✅ 8. `no_signal` 冇明確信號 (觀望) — 默認 fallback

**§M4 v0.4.0 verdict meta shape (沿用 §Verdict meta shape 統一永久 rule Spec Sync #53)**
- ✅ `verdict.meta.signal` (8 個主信號 id) — 拎走舊 `state: UP/DOWN/SIDEWAYS`
- ✅ `verdict.meta.signalLabel` (凡人話標籤: 見頂 / 見底 / 動力強 / 失方向 等)
- ✅ `verdict.meta.signalAction` (建議動作: 沽貨 / 入貨 / 持有 / 觀望 / 留意)
- ✅ `verdict.meta.subSignals` (副信號 array: rsi_overbought / macd_shrinking / rsi_bearish_divergence 等 17 個)
- ✅ `verdict.meta.strength` (信號強度 0-1, priority 加權 + 衰竭分數)
- ✅ `verdict.meta.signalLegacy` (向後兼容: 保留舊 buy/sell/hold + reasons, frontend chart overlay 仍用)
- ✅ `verdict.meta.version` = "v0.4.0" (spec version tag)
- ✅ Backend `algorithm_runner.py` 統一 inject `rsiSeries: []` / `macdSeries: []` 兜底 (Spec Sync #53, 唔受 v0.4.0 改動影響)
- ✅ Algorithm_runner.py 統一 inject `m1State` 落 M4 options (對齊 9月7日 08:30 meta.symbol 永久 rule)

**§M4 v0.4.0 v0.2.0 + v0.3.0 永久 rule 沿用 (大少 4th condition: M1/M2/M3 唔改)**
- ✅ A1 Hurst+ADX regime gate (Spec Sync #45): 沿用 v0.2.0 永久 rule
- ✅ A2 signalThreshold 0.5: 沿用 v0.2.0 永久 rule
- ✅ A3 M1 state trend filter: 沿用 v0.2.0 永久 rule
- ✅ A4 5 個 self-check warning: 沿用 v0.2.0 永久 rule
- ✅ A5 self-check penalty formula: 沿用 v0.2.0 永久 rule
- ✅ A6 meta.symbol caller symbol: 沿用 v0.2.0 永久 rule
- ✅ A7 RSI + MACD 背馳 cross-confirm bonus: 沿用 v0.2.0 永久 rule
- ✅ B1 永久 ban conf 1.0: 沿用 v0.2.0 永久 rule
- ✅ B2 confirmation candle: 沿用 v0.2.0 永久 rule
- ✅ B3 RSI 5 日 linear slope: 沿用 v0.2.0 永久 rule
- ✅ v0.3.0 reg gate soft fail: 沿用 v0.3.0 永久 rule (拎走早 return, emit warning + 繼續行 algorithm)
- ✅ 對齊 §M3 trendline chart overlay 修復永久 rule (9月6日 16:47): 拎 `verdict.meta.X`, 唔好拎 `verdict.meta.meta.X`
- ✅ 對齊 §數據處理 Server 內部做永久 rule (8月23日 13:19): RSI/MACD 算法 backend Python 跑, frontend 只 render verdict

**§M4 v0.4.0 全中文 docstring / 註解 永久 rule (大少 13:56 1st condition)**
- ✅ Backend `indicators/algorithm.py` header docstring 改為 v0.4.0 (凡人話 + 8 信號 priority + Usage + 5 個 Examples + 對應文件)
- ✅ Backend `_derive_signal` 函數 docstring 改為 v0.4.0 (8 個主信號 priority + return shape)
- ✅ Frontend `modules/indicators.ts` header comment 改為 v0.4.0 (對齊 backend 1:1 port)
- ✅ Frontend `_deriveSignal` 函數 JSDoc 改為 v0.4.0 (TypeScript port)
- ✅ Frontend `adapter.mjs` `renderIndicatorsResult` / `renderDetailedExplanationIndicators` 改為 v0.4.0 凡人話解讀

**§M4 v0.4.0 M7 Synthesizer 抽離 永久 rule (大少 13:56 3rd condition)**
- ✅ M7 Synthesizer v1.2.0 (`backend/algorithms/synthesizer/algorithm.py`) 暫時抽離 M4 (大少 13:56 3rd condition)
- ✅ `_compute_tcm`: 拎 M4 (indicators) verdict 嗰對 pair 永遠 `alignment = 0.0` + `trap_penalty = 0.2` + `skipped = True`
- ✅ `_compute_alignment`: 拎 M4 verdict 過濾掉, 只計 5 個 module (M1/M2/M3/M5/M6) 嘅 alignment
- ✅ TCM matrix frontend display 會見到 `(indicators, volatility) pair` 拎 `skipped: true` 標記 (對齊 §改完先 ask 修正先 Commit 永久 rule, backend evidence 確認)
- ⚠️ **TODO (日後 M7 優化時要處理)**: 大少日後 trigger 拎 M4 嘅 signal (top_reversal/bottom_reversal/momentum_strong 等) 對應到 M7 嘅 alignment 點計, 3 個方案:
  - 方案 A: M4 嘅 `top_reversal` / `bottom_reversal` 對應 `DOWN` / `UP` (凡人話: 見頂 = 跌, 見底 = 升)
  - 方案 B: M4 嘅 `momentum_strong` / `momentum_weak` 直接對應 `UP` / `DOWN`
  - 方案 C: M7 加一個 `signal_quality_score`, M4 強信號 (strength > 0.7) 直接 override 綜合判定
  - 對齊 §M1 sub-scenario 永久 rule (2026-08-16 19:21): sub-scenario 改動要 ≥ 3 個 stock verify, 大少 trigger 先改
  - 對齊 §改完先 ask 修正先 Commit 永久 rule: 改完必先 present fix 結果 + 等大少 trigger commit

**5 隻 stock v0.4.0 verify 結果** (對齊 §Stock 名 evidence 永久 rule + §Array evidence 永久 rule, 8 月 31 日 13:14):
- **HK.01888 建滔積層板**: signal=exhausted_neutral, label=動能耗盡失方向, action=觀望, strength=0.38, subs=4 (rsi_50_70/rsi_falling/macd_above_zero/macd_shrinking) ✅
- **HK.00700 騰訊控股**: signal=exhausted_neutral (regime gate fail override), label=動能失方向 (reg gate 唔過), action=觀望, strength=0.30, subs=6 (regime_gate_failed/no_trending/rsi_30_50/rsi_falling/macd_below_zero/...) ✅
- **HK.01347 華虹半導體**: signal=exhausted_neutral (regime gate fail override), label=動能失方向 (reg gate 唔過), action=觀望, strength=0.30, subs=7 ✅
- **HK.00021**: signal=momentum_weak, label=動力弱 (留意沽貨), action=減持 / 觀望, strength=0.41, subs=3 (rsi_30_50/rsi_falling/macd_below_zero) ✅
- **US.TSLA 特斯拉**: signal=exhausted_neutral, label=動能耗盡失方向, action=觀望, strength=0.42, subs=4 ✅

**對應文件**:
- `backend/algorithms/indicators/algorithm.py` v0.4.0 (header docstring + `_derive_signal` + verdict 組成 + meta dict)
- `algorithms/AS-03-cycle-detection/modules/indicators.ts` v0.4.0 (1:1 port backend, header + `_deriveSignal` + verdict return)
- `algorithms/AS-03-cycle-detection/adapter.mjs` `renderIndicatorsResult` + `renderDetailedExplanationIndicators` v0.4.0 (8 個主信號 color/label/interpretation)
- `backend/algorithms/synthesizer/algorithm.py` v1.2.0 (M4 抽離, _compute_tcm + _compute_alignment skip M4)
- `docs/research/AS-03-cycle-detection/MODULE-04-INDICATORS.md` v0.4.0 (徹底更新 spec doc, 凡人話 + 8 個主信號 + Usage + 5 個 Examples)
- `AGENTS.md` (本 section) §M4 Indicators v0.4.0 Signal-based Output 永久 rules

對應 commit: 即將 push (大少 13:56 4 個 conditions 全部對齊)

### AS-03 Chain Flow (大少 2026-08-11 v1.0.0)

完整 chain: **M7(綜合) → M9(回測拎最佳設定) → M8(用最佳設定做最終判斷)**

凡人話: M8 要用 M9 嘅 optimal params, M9 排 M8 上邊反映呢個 chain 邏輯。

永久 rule:
- **Dropdown 排位** (Step 1): 07=M7 綜合 → 09=M9 回測 → zmen(獨立) → 08=M8 決策 → 11=M11 timeline
  - ID 同 displayName 編號唔改 (純 visual 排位)
- **M8 verdict 永久有 optimal_params 3 個 field** (Step 2):
  - `optimal_params_timestamp`: cache last_calibrated
  - `optimal_params_source`: 'cache' | 'fresh-calibrate'
  - `optimal_params_age_seconds`: cache age
  - Render: 頂部 banner 3 種狀況 (🟡 冇 cache / 🟢 < 7 日 / 🔴 ≥ 7 日)
- **「🚀 跑完整鏈條 (M7→M9→M8)」掣** (Step 3):
  - 撳 1 個掣自動跑 3 個 module, sequential (M9 POST 落 cache 落後 M8 讀 cache)
  - M9 失敗 fallback 跑 M8, chain 唔 crash
  - 唔 replace 現有 3 個獨立按鈕, 兩者並存
- **撳 M8 之前 check cache 過期** (Step 4):
  - 撳獨立「跑 M8」掣, 自動 check `/api/adaptive-params/{symbol}` 拎 cache state
  - 3 種狀況 hint: ⚠️ 過期 / ✅ 仲有效 / ℹ️ 冇 cache
  - 唔 auto trigger M9, 只係 hint, 大少自己決定
- **M9 ReferenceError 'postErrors is not defined'** (Step 3.5 Bug fix):
  - Root cause: `postErrors` 喺 line 9284 set 喺 `fold.postErrors`, 但 line 9344 warning 注入用 local `postErrors` 假設有 const → ReferenceError
  - Fix: 1 行 `const postErrors = walkForwardResult.folds.flatMap(f => f.postErrors || []);`
  - 永久 rule: local scope 用嘅 variable 必先 const 拎出嚟, 唔好直接用 fold.x 假設 global 可用

7 日 expiry (大少 11:39 confirm: cache > 7 日自動重校)。

對應 commit: 284d247d, 1f18a49c, 2af9d2dc, 7791b986, f14d3328

### AS-03 Chain v1.1 — 改善 1+2+3 (大少 2026-08-11 22:05)

**改善 1: M8 verdict embed M9 summary sub-section**:
- 撳「跑 M8」之後, M8 verdict 嘅 banner 之後, 自動加 1 個 M9 summary 小卡 (從 cache 拎 optimal data)
- 5 個 metric mini-cards: 凱利倉位 / RSI 權重 / 均線+峰谷+趨勢線權重 / 穩定度分數 / 樣本+段數
- 條件: `verdict.optimal_data` 唔係 null (即 M9 cache 有 optimal)
- 大少唔需要再撳 M9 module 跑, 撳 M8 即刻見到 M9 拎咗咩 optimal 設定

**改善 2: Chain 改 conditional** (大少 22:05 insight):
- 「跑完整鏈條」唔係永遠跑 M9, 改為 M9 過期 / 缺失先跑 (cache OK skip)
- Step 0 (新增): check `/api/adaptive-params/{symbol}` 拎 `has_optimal` 30 日 expiry
- has_optimal=true (cache 仲有效) → skip M9 (4 秒搞掂, 唔再 30-60 秒浪費)
- has_optimal=false / missing → 跑 M9 (拎新 optimal 落 cache)
- Chain 預計時間改善: 30-65 秒 → 2-4 秒 (cache OK 嗰陣 10x speed)

**改善 3: 修 banner timestamp bug** (chain test 揭發):
- 之前 B 改善 banner 拎 `cacheInfo.last_calibrated` (params cache 7 日), 但 banner 寫住「由 M9 cache 嚟」邏輯錯
- Fix: M8 verdict 改拎 `/api/adaptive-params/{symbol}/back-test` 拎 `optimalData.last_backtest` (M9 cache 30 日)
- verdict 新加 `optimal_data` field 包含完整 optimal data (kelly / rsiWeight / ssiWeights / validation / folds_count)
- Banner + M9 summary 都拎 optimalData, 邏輯一致

對應 commit: 772cdfa2 (改善 1+3), 540cde9f (改善 2)

### Codebase 註解 Phase 4 partial gap fill (大少 2026-08-11 22:40)

之前 Phase 4 commit `9173ef1c` 漏咗:
- M4 analyzeIndicators header 註解 (line 5808-5836, 29 行, 之前 verify 失敗係 grep range 太細)
- 6 個 adapter entry 缺 header 註解 (maAlignmentV2 / hlStructure / trendline / indicators / volumePrice / volatility)

呢個 commit 補返 (5 行 header per entry, 跟 synthesizerAdapter / backTestAdapter / decisionEngineAdapter 同樣 style):
- 對應 modules/{module}.ts v{version}
- Spec doc: docs/research/AS-03-cycle-detection/MODULE-XX-*.md
- Algorithm ({N} 個 step): 簡化描述
- 凡人話: 一句話解呢個 module 做咩

永久 rule: 全部 algorithm function + adapter entry 必須有 header 註解 (4 段: 對應 module / Spec doc / Algorithm / 凡人話)

### Cache save_params edge case fix (大少 2026-08-11 22:38)

問題: M8 calibrate 跑 `save_params` 嗰陣, `_read_cache(symbol)` 拎 disk file, 如果 file 過期但有 optimal (30 日內), save_params 原本邏輯 chain 拎 `existing["optimal"]` 失敗 (因為 `_read_cache` 返 None 嘅 edge case), 結果寫個新 cache file 清空 optimal。

Root cause: 原本 `existing = _read_cache(symbol) or {}` chain 拎 existing["optimal"] 喺 `_read_cache` fail 嗰陣, 失去 optimal (即使 disk file 存在)。

Fix: 改用 try/except + 明確 conditional, 即使 _read_cache fail 都 preserve 已有 optimal 同 forward_return_history:
```python
existing_optimal = None
existing_history = None
try:
    existing = _read_cache(symbol)
    if existing and isinstance(existing, dict):
        existing_optimal = existing.get("optimal")
        existing_history = existing.get("forward_return_history")
except Exception as e:
    logger.warning(...)

if existing_optimal is not None:
    data["optimal"] = existing_optimal
if existing_history is not None:
    data["forward_return_history"] = existing_history
```

永久 rule:
- forward_return_history 永遠唔 delete (大少 22:28)
- optimal 永久保留 (大少 22:28 confirm)
- save_params 寫 cache 時必須 preserve 已有 optimal 同 forward_return_history, 即使 cache 過期或 _read_cache fail

對應 commit: 將會跟 Spec Sync #15 commit

### UX 改善 — 2 個掣 conditional show/hide (大少 2026-08-11 22:50, Spec Sync #16)

**大少 trigger 2 個問題**:
1. 「所有 Module 都看到跑完整鏈條, 應該只有在 M8 裡才用吧?」
2. 「在 M8 裡還有跑算法, 這個是不是可以不要了?」

**改善**:
- 「🚀 跑完整鏈條 (M7→M9→M8)」掣只喺 M8 (AS-03-DEC) 度顯示
  - 揀其他 module (M1-M7, M9, M10, M11, zmen) 嗰陣隱藏, 避免混淆
  - 凡人話: chain flow 嘅設計係 M7→M9→M8 嘅 sequence, 只有揀 M8 嗰陣呢個掣先有意義
- 「跑算法」掣喺 M8 嗰陣隱藏
  - 揀 M8 嗰陣只有「跑完整鏈條」1 個掣, UX 更簡潔
  - 揀其他 module 嗰陣「跑算法」掣仍然顯示
  - 凡人話: 改善 2 之後 (chain conditional), 揀 M8 嗰陣「跑完整鏈條」已經夠用 (cache OK 嗰陣 2-4 秒搞掂)

**永久 rule (UX)**:
- M8 (AS-03-DEC) 揀 chain 掣, 其他 module 揀單一跑掣
- 改 module 嗰陣, 自動 show/hide 掣 (onAlgorithmChange 內)

對應 commit: 81f39818

### M9 popup 註解全面化 (大少 2026-08-13 07:23, Spec Sync #17)

**大少 trigger**:「你先把M9都一樣加上Popup註解,要全面化,普通話無英文,講人話」

**目的**: 跟 M7/M8 同樣做法,M9 verdict 全部 keyword 都要有 hover popup 凡人話解釋,大少睇 verdict 嗰陣唔使再睇教學文件都明。

**25 個 M9_TOOLTIPS key** (8 section 全部 keyword):
| Section | Key | 凡人話 |
|---------|-----|--------|
| 1 頂部時段表 | m9_title | 回測驗證 (第九模組) 嘅目的 |
| 1 頂部時段表 | m9_period | 模擬時段 (過去 5 年預設 / 大少自訂) |
| 1 頂部時段表 | m9_folds | 滾動交叉驗證段數 (預設 3 段) |
| 1 頂部時段表 | m9_samples | 真實樣本數 (≥ 30 先可信) |
| 2 最佳參數 | m9_kelly | 凱利倉位比例 (跟平均真實波幅率自動切) |
| 2 最佳參數 | m9_kelly_pct | 凱利倉位百分比 (撳呢個比例落注) |
| 2 最佳參數 | m9_kelly_pie | 凱利倉位餅圖 (顏色越細越穩陣) |
| 2 最佳參數 | m9_rsi_weight | RSI 情緒權重 (0-100%) |
| 2 最佳參數 | m9_ssi_weights | 策略權重分配 (均線 / 高低點 / 趨勢線) |
| 3 整體表現 | m9_avg_score | 平均驗證分數 (0-100, ≥ 70 穩陣) |
| 3 整體表現 | m9_stability | 穩定度 (0-100%, 越高越穩定) |
| 3 整體表現 | m9_samples_box | 真實樣本數 box |
| 3 整體表現 | m9_folds_box | 完成驗證段數 box |
| 4 Walk-Forward bar | m9_wf_bar | 每段滾動驗證表現 (藍橙差距 = overfit) |
| 4 Walk-Forward bar | m9_tune_score | 校準分 (歷史 tune 出嘅分) |
| 4 Walk-Forward bar | m9_validate_score | 真實分 (未來 validate 嘅分) |
| 5 段細節表 | m9_fold_n | 第 N 段 (滾動驗證第 N 段) |
| 6 Forward return | m9_scatter | 5 日後回報分佈 (綠升紅跌) |
| 6 Forward return | m9_fwd5 | 5 日後回報 (對齊睇模擬準唔準) |
| 6 Forward return | m9_fwd10 | 10 日後回報 (對齊 5 日睇趨勢延續) |
| 6 Forward return | m9_fwd20 | 20 日後回報 (對齊 10 日睇中期) |
| 6 Forward return | m9_hit | 啱唔啱 (綠啱 / 紅錯) |
| 7 大少話你知 | m9_advice | 用規則自動生成嘅凡人話解讀 (LLM hook 預留) |
| 8 Apply to M8 | m9_recalibrate | 重新校準掣 (解決 30 日過期) |
| 8 Apply to M8 | m9_apply | 立即套用 M8 掣 (POST 落 M8 cache) |

**永久 rule (M9 popup 註解)**:
- M9 verdict 25 個 keyword 全部要加 `m9-verdict-tooltip` class + `data-help` attribute (凡人話, 普通話, 0 英文 technical term)
- Style: 跟 M7/M8 同樣 inline `<style>` block (position relative + cursor help + hover::after content attr(data-help) + 箭嘴 + 即時顯示 0.1s)
- 唔好放 testing-page.css (永久 rule 永久跟 M7/M8 一致, 全部 inline)
- `M9_TOOLTIPS` dict 喺 M9 verdict HTML render 函數入面 define
- 改 keyword 嗰陣必須一齊更新 `M9_TOOLTIPS` dict
- 應用 span / div / svg / button / th / td 都得, 視乎 keyword 嘅 layout
- 大少 trigger (2026-08-13 07:23):「你先把M9都一樣加上Popup註解, 要全面化, 普通話無英文, 講人話」
- 對應 commit: 9f72b113 (feat(m9-rendering): M9 popup 註解全面化)

### dataWindowDays 默認值永久 rule (大少 2026-08-14 23:15)

**凡人話解釋**: testing page 撳跑 algorithm 嗰陣, 永遠用 5 年 K 線 (1260 日), 唔再用 100 日 (5 個月) 默認值。

**永久 rule**:
- testing page 默認 `dataWindowDays` = 1260 (5 年, 對齊 M9 設定), 唔再係 100
- M1 v0.3.0 zmen + M9 algorithm 移除 `CONFIG_DEFAULTS` trigger, 因為 trigger 條件 (`=== 100` 或 `=== 1260`) 永遠會 trigger 變廢話
- 原因: 「用咗默認值」呢個 warning 對 user 冇 information value, 因為 testing page 永遠有 default value, user 自己揀 default 唔等於 user 冇自訂
- 之後 M9 算法加 `auto-calibrate dataWindowDays` sub-task (9.8), 拎出嚟做 follow-up sprint

**影響**:
- 大少撳跑 zmen / M9 唔再見到 CONFIG_DEFAULTS warning (因為永遠唔 trigger)
- 5 年 K 線對 long-history 股票 (騰訊/匯豐/中芯) 夠, verdict 更準
- 對短-history 股票 (新上市), user 自行調小 dataWindowDays (e.g. 60/252)

對應 commit: 即將 push (dataWindowDays 默認 100 → 1260 + CONFIG_DEFAULTS trigger 移除)

### dataWindowDays frontend inputs 表單 audit 永久 rule (大少 2026-09-07 17:23 confirm, Spec Sync #46)

**凡人話解釋**: testing page 永久 rule 2026-08-14 23:15 講明 `dataWindowDays` 永遠用 5 年 (1260), 但 frontend `adapter.mjs` 嘅各 module `inputs` 表單**漏咗改** (M3 / M4 / M5 / M6 4 個 module default 仍然 100, 漏 sync 永久 rule), 導致大少喺 testing page 換 stock 嗰陣 frontend 永遠送 100 畀 backend, 撞到新股 / 細股 KlineCache 拎唔到 100 條 K 線就 400。對齊 2026-08-14 23:15 永久 rule spirit, audit 全部 frontend `inputs` 表單一律 1260, 加 testing page 換 stock 強制 reset 避免 stale state 累積。

**永久 rule checklist**:
- ✅ testing page 任何 module 嘅 `inputs` 表單 `dataWindowDays` default 永遠 1260 (5 年, 對 long-history 股票最 safe)
- ✅ min 200 (backend Bulkowski condition 至少要 200 日先 fit 到線性回歸)
- ✅ max 2520 (10 年, 對齊 1M 週期)
- ✅ frontend `analyzeXxx` stub fallback `options.dataWindowDays || 1260` (跟永久 rule)
- ✅ `renderNumber` onChange handler clamp dataWindowDays 200-2520 (input box user 改都 clamp 入 range, 對齊 backend 限制)
- ✅ 改 frontend / backend 之後 grep 全 repo `dataWindowDays.*100\|dataWindowDays.*300` 確保冇漏網 (M2 例外, M2 永久 rule 講 3 pairs = 6 alternating 需要 default 300, 唔可以強制改 1260 違背 M2 spec)
- ✅ 改完之後必 restart backend + curl `data_window_days=1260` 拎 evidence 確認
- ✅ testing page 換 stock 嗰陣 (`runAlgorithm()` line 1330 + `runFullChain()` line 2385 開頭) 強制 reset `currentOptions.dataWindowDays = 1260` + 同步落 DOM, 避免 stale state 累積
- ✅ backend 「冇 K 線」case (`algorithm_runner.py` line 214) 返 `ok=True` + 帶 critical `INSUFFICIENT_DATA` warning (永久 rule: verdict 可能唔可信)
- ✅ backend `n < min_required` case (`trendline/algorithm.py` line 698-703) 同樣改返 `ok=True` + warning, 唔再 return `ok=False` 400
- ✅ frontend `renderTrendlineResult` prepend user-friendly 黃色 box (「揀錯股票 / 新股 / 停牌 / FutuOpenD 拎唔到」) 對「INSUFFICIENT_DATA」case

**永久 rule (level override)**:
- `INSUFFICIENT_DATA` 嘅 WARNING_CODES level 永遠 "critical" (永久 rule §Module Warning v1.1.0 auto-enforce 通過 `make_warning` line 143-144), 即使 caller pass "info" 都會被 override
- Category 由 frontend `WARNING_CATEGORIES` dict 自動 derive (system category 因為 verdict 唔可信, 冇 data)

**Spec Sync #46 audit 結果 (4 個 module 漏 sync)**:
- M3 trendline (line 3937-3943): default 100, min 30, max 500 → 改 default 1260, min 200, max 2520
- M4 indicators stub (line 3978): `|| 100` → `|| 1260`
- M5 volume-price stub (line 2189): `|| 100` → `|| 1260`
- M5 volume-price inputs (line 2583-2588): default 100, min 80, max 500 → 改 default 1260, min 200, max 2520
- M6 volatility stub (line 2643): `|| 100` → `|| 1260`
- M6 volatility inputs (line 2803): default 100, min 80, max 500 → 改 default 1260, min 200, max 2520
- (M1 ma_alignment 已經係 1260 ✅, M2 hl_structure 維持 300 因為對齊 M2 spec 3 pairs alternating 結構)

**前端 additional bug note (Spec Sync #46 揭發, 唔影響今次 fix scope)**:
- frontend testing-page.js line 1480 用 `verdict._warnings || []` 拎 warning banner, 但 backend `Verdict.warnings` 喺 top level (Verdict dataclass line 56), 唔係 `_warnings`, 即係 frontend banner 永遠拎空 warning 唔 render
- Spec Sync #46 跟住 fix: frontend 統一拎 `verdict.warnings || verdict._warnings || []` 對齊 backend Verdict contract
- 影響: frontend warning banner 而家對 backend verdict 完全 silent, Spec Sync #46 改 renderTrendlineResult 入面 user-friendly box 喺 renderResult 內部 prepend 避咗呢個問題, 但 generic warning banner 路徑需要後續 fix

對應 commit: 即將 push (Spec Sync #46 — dataWindowDays frontend inputs 表單 audit + 換 stock 強制 reset + backend 0 K 線 / n<30 改 ok=True + warning + renderTrendlineResult user-friendly box + 4 份 spec doc sync)

### Spec Sync Protocol (大少 #10203)

**Trigger keywords** (case insensitive): `更新Stockpluse` / `Update Stockpluse` / `Update StockPulse`

自動 4 steps:
1. Update `./ARCHITECTURE.md` (你做)
2. Update OpenClaw `STOCKPULSE_REFERENCE.md` (OpenClaw 自己 maintain,你**唔做**)
3. Daily Log entry (OpenClaw 自己寫)
4. Commit + push `./` (你做)

**Spec Sync 進度 (2026-08-20 ~ 2026-08-21)**:
- #31 (`39d0440c`) — ZigZag threshold slider 即時 re-render — `80b9b589` (fix) + `39d0440c` (docs)
- #32 (`e6f7e35e`) — ZigZag controls + runStatus 搬到圖表上邊 — `3e4474a5` (fix) + `e6f7e35e` (docs)
- #33 (`d475ff1d`) — ZigZag threshold 自動調整 (波動率自適應法) — `faec3898` (feat) + `d475ff1d` (docs)
- #34 (`c8bdfb07`) — ZigZag lookback 參數手動可調 — `f30c9e00` (feat) + `c8bdfb07` (docs)
- #35 (`131eeeb2`) — Lookback 永遠顯示 (改寫中) — `e75fea0b` (fix) + `131eeeb2` (docs)
- #36 (`74cb80d8`) — Lookback 永遠可改 (改寫 #35) — `2e5d8d1a` (fix) + `74cb80d8` (docs)

### Spec Update Mapping (#9664)

| 改咗咩 | 要 update 邊個 doc |
|--------|-------------------|
| 新 `backend/api/*.py` endpoint | API.md |
| 新 frontend page/route | README + PROJECT_SPEC + ARCHITECTURE |
| 新 database table/model | PROJECT_SPEC |
| 新 algorithm (AS-XX) | ALGORITHM_SPECS + README + ARCHITECTURE + PROJECT_SPEC |
| 新 LLM provider | PROJECT_SPEC + ARCHITECTURE + API |
| 新 dependency | README + PROJECT_SPEC |
| 新 miniapp feature | README + PROJECT_SPEC + ARCHITECTURE |
| 新 algorithm 流程改動 | ALGORITHM_SPECS + ARCHITECTURE |

### Testing page config input 必須有 onChange handler 永久 rule (大少 2026-08-20 23:10)

**凡人話解釋**: testing page 任何 config input (number / checkbox / select) 必須有 onChange / onInput handler 連去 `currentOptions[key]` + 自動 re-render 對應 chart overlay, 唔可以等大少再撳「跑算法」先 update。

**Bug 起源 (大少 23:10 trigger)**: `#zigzag-threshold` 個 number input 喺 2026-08-19 加入個 ZigZag threshold 控制嗰陣, 完全冇 onChange handler, 大少改 value 嗰陣永遠唔入 `currentOptions.zigzagThreshold`, 紫色 ZigZag 線永遠 render 緊撳跑嗰陣 backend 取嘅 5%。Default value 5% 啱啱好等於 backend 默認, 紫色線「睇落 work」誤導大少, 改 1%/10%/20% 嗰陣先發現完全冇 effect。

**永久 rule**:
- ✅ Testing page 所有 config input (number / checkbox / select / autocomplete) 必須有 onChange / onInput handler
- ✅ Handler 必須: (1) sync value 入 `currentOptions[key]` (2) 即時 re-render 對應 chart overlay (3) 唔需要撳「跑算法」先生效
- ✅ 跟 2026-08-19 13:03 永久 rule「Config UX 模式: 自動+手動+自動儲存更新圖表」一致
- ✅ 改 chart overlay 嗰陣同步 update `renderDebugPanel(...)` (永久 rule 跟 2026-08-19 09:35 一致)
- ✅ Debounce 200ms 防 slider 連環拖動 spam backend fetch
- ✅ Fallback: backend 拎唔到 / 失敗嗰陣 continue 用舊 value, 唔 crash, runStatus 顯示「⚠️ 失敗」狀態

**套用**:
- 之後 M2 / M3 / M4 / M9 嘅 config input 全部跟呢個 pattern
- 改 testing-page input control 之後, grep `getElementById('xxx')` 確認有對應 handler
- 跟 cache bust self-check 永久 rule (21:24) 一齊: 改 testing-page.js 嗰陣必同步 bump ALGO_CACHE_BUST + ?v= 2 個地方

**對應 commit**: `80b9b589` (fix) + `39d0440c` (docs, Spec Sync #31)
**對應 doc**: ARCHITECTURE.md §15.23

### Testing page chart-control layout 永久 rule (大少 2026-08-20 23:20)

**凡人話解釋**: testing page 凡係用嚟控制 chart 嘅 controls (啟用 / threshold / sequence) 同 status message (即時更新 / 跑完) 永遠排喺 `chart-section` 入面 `chart-container` 之前, 唔好散喺 `inputs section`, 確保大少視線聚埋喺 chart 上面嘅時候唔使離開向上望。

**大少 23:20 trigger**: 大少撳跑完 M1 嗰陣見到 3 條 (啟用 / threshold / 順序號碼 / 即時更新 message) 排喺 inputs section 跑算法掣下面, 視線要離開 chart 向上望先睇到, trigger「移到圖表上邊」。

**永久 rule**:
- ✅ 跟 chart 互動嘅 controls + status 永遠排喺 `chart-section` 入面 `chart-container` 之前
- ✅ 同類 control 視覺一致: 統一用 `#f5f5f5` background + 圓角 + `8px 12px padding` (跟 ma-toggle-bar 一齊)
- ✅ `inputs section` 留返只有「跑算法」掣 + 「🚀 跑完整鏈條」掣, 其他跟 chart 互動嘅 control 全部搬去 `chart-section`
- ✅ 套用: 之後 M2 / M3 / M4 等其他 config control 加新嘅時候, 直接加落 `chart-section` 入面 `ma-toggle-bar` 之前, 唔好擺落 `inputs section`

**Layout 順序** (`chart-section` 入面):
1. `chart-header` (h2 + note)
2. `run-status` (跑完 / 即時更新 message)
3. `zigzag-controls` (啟用 + threshold)
4. `zigzag-sequence-controls` (順序號碼)
5. `ma-toggle-bar` (MA 線 toggle)
6. `chart-container` (實際 K 線圖)

**對應 commit**: `3e4474a5` (fix) + `e6f7e35e` (docs, Spec Sync #32)
**對應 doc**: ARCHITECTURE.md §15.24

### Testing page ZigZag threshold 自動調整 永久 rule (大少 2026-08-21 00:02)

**說明**: testing page ZigZag threshold 默認手動輸入 5%, 大少 2026-08-21 00:02 trigger「波動率自適應法」自動計算。新做法: 自動 mode 永遠跟 K 線自動計算 (取最近 20 日 high-low/close 波動率 × 2.5), 0.5%-20% clamp。手動 mode slider 即時改 (跟 spec sync #31 pattern)。新股票冇 localStorage record → 自動 mode 預設。對應大少 trigger 3 點: (1) 新股票自動跑一次 (2) 新增按制手動跑 (3) 每次更新都自動保存。

**公式** (大少 trigger 1:1):
- 每日波動率 = (high - low) / close
- 20 日平均 × 2.5 = threshold
- Clamp: 0.5% - 20%
- 倍數選擇 (popup 註解): 2.0 (短線, 靈敏) / 2.5 (波段, 推薦) / 3.0-4.0 (長線, 平滑)

**永久 rule**:
- ✅ 自動 mode = 取最近 20 日 K 線, 波動率 × 2.5, 0.5%-20% clamp
- ✅ 手動 mode = slider 即時改, 1-20% 範圍, debounce 200ms
- ✅ 撳「跑算法」嗰陣 auto mode 自動計算 (唔需要大少撳掣)
- ✅ 切 mode 即時計算 + update 紫色線 (auto → 計算, manual → 用最近結果)
- ✅ 撳「🔄 重算」掣: auto mode 用最新 K 線重計
- ✅ 撳「重置為自動」掣: manual mode 一鍵切去 auto
- ✅ localStorage 自動保存: `stockpulse.zigzag.thresholdMode` (auto/manual) + `stockpulse.zigzag.manualThreshold`
- ✅ 新股票冇 localStorage record → 自動 mode 預設 (永久 rule: 大少 trigger 「新股票都會自動跑一次」)
- ✅ popup 註解: 「? 倍數」hover 顯示倍數選擇表 (跟 M7/M8/M9 同樣 inline style block)
- ✅ 對應 2026-08-19 13:03 永久 rule「Config UX 模式: 自動+手動+自動儲存更新圖表」
- ✅ 對應 Spec Sync #31 永久 rule (config input onChange handler)
- ✅ 對應 Spec Sync #32 永久 rule (chart-control layout)

**套用**:
- 之後其他 algorithm 加 config (e.g. M2 ATR threshold, M4 RSI period) 都跟呢個 pattern: 自動/手動 切換 + 自動計算 + localStorage + popup
- 改 testing-page.js 嗰陣同步 bump ALGO_CACHE_BUST + ?v= 2 個地方 (cache bust self-check 永久 rule 21:24)

**對應 commit**: `faec3898` (feat) + `d475ff1d` (docs, Spec Sync #33)
**對應 doc**: ARCHITECTURE.md §15.25

### Testing page ZigZag lookback 參數 永久 rule (大少 2026-08-21 00:24)

**說明**: 大少 00:24 trigger「再加一個可手動調整的參數: lookback, 也會有自動儲存功能」。Lookback = 取最近幾日 K 線計波動率, 預設 20 日, 大少可手動調 5-100 日, 跟返 Config UX 模式永久 rule 一致 (自動儲存 + 即時 re-render)。

**公式** (大少 trigger 公式延伸):
- 自動 mode 計算 threshold 時用 lookback (預設 20) 取最近 N 日 K 線波動率
- 每日波動率 = (high - low) / close
- N 日平均 × 2.5 = threshold
- 手動 mode 唔影響 (大少自己改 threshold, lookback 唔參與計算)

**永久 rule**:
- ✅ Lookback 預設 20 日 (大少 trigger 公式 default), 範圍 5-100
- ✅ 跟 Spec Sync #31 config input onChange handler pattern (即時 re-render)
- ✅ 跟 2026-08-19 13:03 永久 rule「Config UX 模式: 自動+手動+自動儲存更新圖表」, localStorage 自動保存
- ✅ 改完即時重算 (auto mode 觸發 applyAutoThreshold, debounce 200ms 防 spam)
- ✅ Manual mode 唔影響 (manual mode 大少自己改 threshold)
- ✅ 加「重置為 20」掣 (一鍵 reset default)
- ✅ localStorage key: `stockpulse.zigzag.lookback`
- ✅ 跟 Spec Sync #33 永久 rule (auto 計算) 一致
- ✅ 跟 Spec Sync #31 永久 rule (config input onChange handler) 一致
- ✅ 跟 Spec Sync #32 永久 rule (chart-control layout) 一致

**套用**:
- 之後其他 algorithm config 都跟呢個 pattern: 自動/手動 + 額外參數 (lookback 等) + 重置掣 + localStorage + 即時 re-render
- 改 testing-page.js 嗰陣同步 bump ALGO_CACHE_BUST + ?v= 2 個地方 (cache bust self-check 永久 rule 21:24)

**對應 commit**: `f30c9e00` (feat) + `c8bdfb07` (docs, Spec Sync #34)
**對應 doc**: ARCHITECTURE.md §15.26

### Testing page ZigZag lookback 永遠可改 永久 rule (大少 2026-08-21 00:38 改寫 00:31)

**改寫說明**: 大少 00:31 trigger「當轉成手動輸入時就不見了"最近 日波動率"」, 00:38 改寫為「這個參數不用 Disable」。之前 Spec Sync #35 嘅「manual mode 顯示但 disabled」規則錯咗, 大少 want Lookback 永遠可改。

**永久 rule** (改寫後):
- ✅ Lookback row 永遠顯示 (auto + manual mode 都見到, 做大少 reference 用)
- ✅ Lookback 永遠 enable (auto + manual mode 都可改, 拎走 Spec Sync #35 嘅「manual mode disabled」規則)
- ✅ Manual mode 改完只係儲 localStorage, 唔 trigger 重算 (因為 manual mode 用大少 set 嘅 threshold, lookback 唔參與計算)
- ✅ Auto mode 改完即時重算 (applyAutoThreshold 觸發, 紫色線即時 update)
- ✅ 對應 Spec Sync #31 onChange handler pattern (auto + manual 都即時 localStorage 儲存)
- ✅ 套用: 之後其他 algorithm config 永遠可改 (auto mode 改 trigger 重算, manual mode 改只係儲 settings)

**對應 commit**: `2e5d8d1a` (fix) + `74cb80d8` (docs, Spec Sync #36)
**對應 doc**: ARCHITECTURE.md §15.28

### K-line Cache (永久 rule, 大少 #8602)

```python
# services/kline_cache.py 已 fix ✅
def _compute_fetch_max_count(period):
    if period == '1d': return 30 * 365
    return 10 * 365
```

- User query 嘅 start/end **唔應該 gate cache update logic**
- Wide-fetch 由 `earliest_cached` 開始
- 用 `get_cur_kline()` 拎 today intraday partial bar (唔入 DB)
- T-1 rule: 今日 bar 唔寫 DB,只喺 response 出

### K-line 讀取一定要用 KlineCache full flow 永久 rule (大少 2026-08-22 23:20)

**凡人話解釋**: 所有 research script / debug script / ad-hoc analysis 拎 K 線, 一定要用 backend `/api/kline` endpoint (透過 KlineCache full flow: check DB → 真 OpenD update → write DB → return with T-1), **永遠唔可以直接 instantiate KlineCache 然後用 mock context 拎 K 線**。

**大少 trigger 23:20**: 「記住以後讀取數據一定要用這方法」
- 大少 19:44 發現 1385 強下跌 trigger 嘅 MA 數值錯, root cause 係 `tmp_research_v23_subscenarios.py` 用咗 `mock_ctx` 拎空 OpenD, fall back to DB cache 拎 stale K 線
- Stale K 線 → MA 計錯 → sub-scenario trigger 結論 false positive (1385/384/INTC 假強下跌, 00992 假創新高)
- 真實數據用 HTTP call backend 拎到 T-1 8月21日 fresh K 線, 60 隻 v2.1 真實結果: 強升 5 隻, 強跌 1 隻, 初升 6 隻, 初跌 7 隻, 上升回調 4 隻, 下跌反彈 4 隻, 到底轉勢 3 隻, 到頂轉勢 0 隻, 橫行 30 隻

**永久 rule**:
- ✅ Research / debug / ad-hoc script 拎 K 線: **永遠用 HTTP call backend `/api/kline?code=...&period=...&count=...`**
- ✅ 唔可以直接 `KlineCache().get_or_fetch(code, mock_ctx, ...)` 用 mock context 拎 K 線
- ✅ 唔可以直接 query DB table (`SELECT * FROM kline_cache`) 拎 K 線 (會拎 stale)
- ✅ 唔可以直接 call Futu OpenD `request_history_kline` 拎 K 線 (會 bypass cache)
- ✅ Backend `/api/kline` 已經入面用咗 KlineCache full flow + 真 OpenD, response 入面 `mock:False / cached:False` 即係 fresh
- ✅ 對齊 testing page (testing-page.js line 826 用 `BACKEND_URL/api/kline` 同一個 endpoint)
- ✅ WINDOW_DAYS 預設 1260 (5 年, 對齊 testing page 默認, 2026-08-14 23:15 永久 rule)
- ✅ 對應 trigger: 「tmp_research_v23_subscenarios.py 60 隻 stale K 線 false positive」事件
- ✅ 之後所有 research script / debug 工具 / ad-hoc analysis 都跟呢個 pattern, 用 `urllib.request` call backend, 唔好再 instantiate KlineCache
- ✅ 對應: tmp_research_v23_subscenarios_v4.py (用 urllib HTTP call backend) 同 tmp_research_v25_v21subscenarios.py (同一個 pattern)

### Algorithm Backend-only + 模組化 永久 rule (大少 2026-08-22 23:20)

**凡人話解釋**: 所有 algorithm (M1-M12 + zmen + 7 個 adaptive params) 永遠喺 backend 跑, frontend 唔可以重計 algorithm, 所有嘢 (K 線 / algorithm verdict / warning) 都要透過 module 化嘅 interface (backend API) 拎。

**大少 trigger 23:20**: 「所有算法都是在 Backend 做, 所有東西都要模組化處理」

**永久 rule**:
- ✅ 所有 algorithm 計算永遠喺 backend (Python `algorithms/*/algorithm.py`), frontend 只 render verdict 唔重計
- ✅ Research / debug script 跑 algorithm: 永遠 import backend algorithm (`from algorithms.ma_alignment.algorithm import MAAlignmentV2Algorithm`) 然後由 K 線 → verdict, 唔好自己重寫 MA / slope / volume 計算邏輯
- ✅ 拎 algorithm output 一定由 `verdict.meta.<field>` 拎 (e.g. `maValues`, `maSlopes`, `volumeSignal`, `cycle`), 唔好 script 自己用 K 線重計
- ✅ 模組化 interface: 對外統一用 backend API endpoint (e.g. `/api/kline`, `/api/cycle/run/{module}`), 唔好直接 call internal function
- ✅ frontend `.mjs` (testing page) 對外 fetch backend, 唔可以直接 import backend algorithm (`from algorithms...`)
- ✅ 之後加新 algorithm / 改 algorithm 嘅 calculation, 一律 backend side, frontend 唔郁
- ✅ 對應 trigger: tmp_research_v23_subscenarios.py v3 mock + 自己重計 sub-scenario → false positive; v4 / v5 改用 backend algorithm + verdict meta 拎結果 → 100% 一致 production

### ZigZag 全部 backend 計 永久 rule (大少 2026-08-30 22:04, 4.43.0)

**凡人話解釋**: 拎走 testing page frontend 5 個 ZigZag 計算 function, 改 fetch backend `/api/algorithms/run?algo=zigzag` 拎 verdict, 對齊 production frontend (ChartContainer.tsx + ElliottWaveTestPage.tsx) 已經用緊嘅 pattern。Frontend 只負責**畫圖** (拎 backend 傳上嚟嘅 points, 連成線 + plot marker)。Backend 已經喺 4.42.2 改動 1-to-1 port frontend 算法 (`backend/algorithms/zigzag/algorithm.py` 24KB, 已 register 落 framework), 4.43.0 擴 API + frontend 拎走 5 個 function 統一 flow。

**大少 trigger 22:04**: 「我想要做到的是, 所有Zigzag的東西全部都要在後台做晒先, 先計出Auto threshold得出每一個zigzag點也包括最後鮮綠線的那兩點, 然後把這些點傳到前台, 前台主要是畫圖, 把這樣點連在一起變成線」+「如有有利改動的話可以不用理那些永久Rule, 我要最有效最安全的做法」

**拎走嘅舊永久 rule (8月30日 01:04)**: 「M1 純 MA Alignment + 之字 Frontend Inject」— frontend 自己 inject 之字 point, backend 唔做。改為 backend 全做, frontend 拎 fetch verdict。

**永久 rule (4.43.0 新加)**:
- ✅ Testing page frontend 拎走 5 個 function: `calculateZigZagFrontend` + `autoThresholdVolatility` + `extractHLC` + `_buildExtensionLineFrontend` + `applyFrontendZigZagOverlay` + 1 個 dead helper `_zigzagNormalizeDate` (淨減 179 行)
- ✅ 改 fetch backend `/api/algorithms/run?algo=zigzag`, 加 4 個新 query params (threshold_mode / manual_threshold / lookback / multiplier) + 4 個 validation rules (4.43.0 safety improvement #1: 防止 frontend pass 錯 value trigger silent bug)
- ✅ backend `ZigZagAlgorithm.run` 重用 `run_zigzag` helper (4.43.0 safety improvement #3: 1 個 function 1 個 source of truth, 避免重複 logic)
- ✅ backend Verdict meta 8 個 field 對齊 testing page 拎法 (klines_count / threshold / threshold_mode / lookback / multiplier / extension_line / zigzag_points_count / decision_flag_count)
- ✅ frontend 拎 verdict inject 落 `lastVerdict.meta` 8 個 field, caller 同步 call `currentAdapter.renderChartOverlay` 拎 verdict render
- ✅ AbortController 處理 race condition (4.43.0 safety improvement #2: slider 即時 re-render 撳緊 debounce 200ms 之間 user 再撳會 cancel stale fetch)
- ✅ 對齊 4.42.3 永久 rule: verdict meta inject 永遠唔需要 lastChartRefs (純 JS 嘢, 拎走 global guard)
- ✅ 對齊 production frontend ChartContainer.tsx + ElliottWaveTestPage.tsx 已經用緊嘅 pattern
- ✅ Cache bust sync: ALGO_CACHE_BUST 4.42.3 → 4.43.0 + index.html `?v=2.3.107` → `2.3.108` 同步 bump (永久 rule cache bust self-check)

**3 個 commit 順序**:
1. 4.42.2 (大少 8月30日 17:50 + 22:44 改動): backend ZigZag algorithm 1-to-1 port frontend + production frontend fetch backend
2. 4.42.3 (大少 8月30日 21:14 改動): verdict.meta.zigzagPoints undefined fix
3. 4.43.0 (今次 plan, 大少 8月30日 22:04 trigger): testing page frontend 拎走 ZigZag 算法 + backend 加 4 個新 params + Spec Sync #47 永久 rule update

**凡人話解釋 (commit 3)**:
- 大少 trigger: 「所有Zigzag的東西全部都要在後台做晒先」+「最有效最安全」
- 拎走 testing page frontend 5 個 ZigZag 計算 function (179 行), 改 fetch backend
- backend 加 4 個新 query params + validation, 防止 frontend pass 錯 value
- frontend 加 2 個新 function (fetchBackendZigZag + fetchAndInjectBackendZigZag), 對齊 ChartContainer.tsx pattern
- AbortController 處理 slider race condition
- 永久 rule update: 拎走 2 條 + 加 1 條 (ZigZag 全部 backend 計)

對應 Spec Sync #47 entry (永久 rule update 拎走 2 條 + 加 1 條)
對應 doc: ARCHITECTURE.md §3.6 + §3.7 (ZigZag data flow)

### ZigZag Frontend 只 render 紫色折線 永久 rule (大少 9月1日 22:02, 4.61.5) — **4.64.0 部分拎返 (紅色觸發點 marker)**

**凡人話解釋**: 大少 9月1日 22:02 trigger「**之前做的 Point, 旗仔, 觸發點等等, 只保留 zigzag 的連線, 其他都不要**」— Frontend 拎走晒 5 個 non-line ZigZag visual elements, chart 只 render 紫色 ZigZag 折線。

**拎走嘅 5 個 non-line visual elements** (對齊 8月29日 22:44 永久 rule「所有改動要 confirm」, 大少明確 trigger 拎走):
- ❌ 紫色 P 點 sequence marker (peak/trough arrow + 1/2/3/4 號碼) — 4.9.0 加 → 4.51.0 拎走 → 4.61.0 拎返返 → 4.61.5 拎走 → 4.62.0 拎返返 → 4.63.0 fix 拎返 v5 plugin API (現存永久)
- ✅ **4.64.0 拎返** 紅色觸發點 (Trigger 確認點) marker (Option D arrow shape + #FF5252 紅色 + inBar + size 1) — 4.61.0 新加 → 4.61.5 拎走 → 4.64.0 拎返返
- ❌ 鮮綠色 close extension line (#00C853) — 4.8.3/4.33.0 加 → 4.51.0 拎走 → 9月1日 14:10 拎走 confirm
- ❌ 鮮綠色 "1" 號 marker (today close arrow) — 4.8.3 加 → 4.51.0 拎走
- ❌ 橙色 #FF9800 旗仔 decision flag — 4.42.2 加 → 4.53.0 拎走

**永久 rule** (4.61.5 新加, 4.64.0 部分改寫):
- ✅ **Frontend ZigZag chart render 紫色折線** (`#9C27B0` LineSeries) + **紫色 P 點 sequence marker** (4.62.0 + 4.63.0 拎返) + **紅色觸發點 marker** (4.64.0 拎返, Option D arrow shape)
- ✅ Backend `triggerDate` / `triggerPrice` / `is_ongoing` field **全部保留** (大少 trigger「之後想重新再做過」, 4.64.0 拎返 frontend render trigger marker 用呢啲 field)
- ✅ 拎返拎走 `#zigzag-sequence-controls` div + `#show-sequence` toggle + `LS_KEY_SHOW_SEQUENCE` helper (testing page, 4.61.5)
- ✅ 拎返拎走 `LightweightCharts.createSeriesMarkers` 整段 marker build + setMarkers (adapter.mjs, 4.61.5 拎走 → 4.62.0/4.63.0/4.64.0 拎返返)
- ✅ 對齊 4.43.0 永久 rule: ZigZag 全部 backend 計, frontend 拎 fetch verdict, frontend 只 render 紫色折線 + markers
- ✅ 對齊 8月29日 22:44 永久 rule「所有改動要 confirm」:大少明確 trigger「拎走 P 點 / 旗仔 / 觸發點 / 鮮綠線」先做 (4.61.5 拎走), 4.64.0 拎返紅色觸發點大少 00:23 明確 trigger「用咩符號來標號好」+ 00:27 confirm Option D

**對應 file**:
- `testing-page/testing-page.js`: 拎返拎走 `LS_KEY_SHOW_SEQUENCE` const + `getShowSequence` / `setShowSequence` helpers + `#show-sequence` toggle handler (~35 行 dead code 拎走, 4.61.5)
- `testing-page/index.html`: 拎返拎走 `#zigzag-sequence-controls` div block (~11 行 dead UI 拎走, 4.61.5)
- `algorithms/AS-03-cycle-detection/adapter.mjs` `renderMAAlignmentV2ChartOverlay`:
  - 4.61.5 拎返拎走 P 點 arrow marker + 紅色觸發點 circle marker + `createSeriesMarkers` 整段 (~66 行 dead code 拎走)
  - 4.62.0 拎返 P 點 marker block
  - 4.63.0 拎返 v5 plugin API, max 10, fallback chain 10→5→3
  - 4.64.0 拎返紅色觸發點 marker block (P 點 marker block 之後, Option D arrowUp/arrowDown + #FF5252 紅 + inBar + 冇 label + max 10 + filter ongoing + filter first point)
- `testing-page/testing-page.js` ALGO_CACHE_BUST: '4.61.4' → '4.61.5' → '4.62.0' → '4.63.0' → '4.64.0' + `?v=2.3.125` → '?v=2.3.135' (CSS + JS)
- Backend `backend/algorithms/zigzag/algorithm.py` **唔郁** (trigger field 保留, 4.64.0 frontend 拎返 render)

對應 commit:
- `b8a67d6e` refactor(frontend): 拎走 ZigZag non-line visual elements (4.61.5)
- `578c5ab8` feat(adapter): 拎返 M1 紫色 ZigZag P 點 sequence marker (4.62.0)
- `047ed1e8` fix(stockpulse): 拎返 v5 createSeriesMarkers plugin API + max 10 + fallback chain 10→5→3 (4.63.0)
- `4094fbd6` fix(stockpulse): 拎返紅色觸發點 (Trigger 確認點) marker (4.64.0, Option D arrowUp/arrowDown 對齊 P 點 arrow 風格)

### M1 P 點 marker v5 plugin API + Max 10 + 紅色觸發點 marker 永久 rule (4.64.0, 大少 2026-09-02 00:23 trigger「用咩符號來標號好」+ 00:27 confirm Option D) — **4.65.0 改進 visual (鮮紫 + 離開 K 線 body)**

**凡人話解釋**: 4.63.0 拎返紫色 P 點 sequence marker (P1, P2, P3...) 之後, 大少 00:23 trigger「現在把在 Backend 已計好了的 zigzag 觸發點也標上, 用什麼符號來標號好呢?」+ 00:27 confirm 4 個 decisions (Option D + max 10 + filter ongoing + filter first point)。每一個 ZigZag P 點 (peak 山頂 / trough 山谷) 都有一個 trigger date — 即係「呢個 P 點係由邊日 K 線確認」嘅日子。e.g. 8月31日 P1 high 47.68 嗰個 peak, 要等到之後跌穿 5% threshold 嗰日先 confirm, trigger 嗰支 K 線就係「觸發點」。Backend `verdict.points[].triggerDate` 已經有呢個 data (4.57.0 加, 4.60.0 改 null 處理 ongoing point)。

4.64.0 撅完之後大少睇咗話「很不好看」, 原因:
1. 紅色 `#FF5252` 撞 K 線 body 跌紅色 `#ef5350`, 紅撞紅視覺唔 clear
2. position `inBar` 喺 K 線 body 內 (大少叫「支竹」即係 K 線 body 形狀), 紅色 arrow plot 喺 body 範圍內視覺撞色

大少 9月2日 00:48 trigger「用鮮紫色, 還有不要在那支竹內, 要在離開那支竹少少」+ 4.65.0 fix:
- color 改鮮紫 `#BA68C8` (Material Design Purple 300, 對齊 P 點紫 `#9C27B0` Purple 500 hue family 但淺 1 級)
- position 改 `aboveBar` (peak trigger) / `belowBar` (trough trigger), 離開 K 線 body, 對齊 P 點 marker 4.51.0 永久 rule position pattern

**4.64.0 永久 rule** (Option D design, 大少 00:27 confirm, **4.65.0 改進 2 個 field**):
- ✅ **Render 位置**: `algorithms/AS-03-cycle-detection/adapter.mjs` `renderMAAlignmentV2ChartOverlay` P 點 marker block 之後 (line 5207-5283)
- ✅ **Shape**: `arrowUp` (trough trigger) / `arrowDown` (peak trigger) — 對齊 4.51.0 永久 rule P 點 arrow 風格 (P 點 high→arrowDown, low→arrowUp)
- ✅ **Color**: **4.65.0 改** 紅色 `#FF5252` → 鮮紫 `#BA68C8` (Material Design Purple 300, 對齊 P 點紫 `#9C27B0` Purple 500 hue family 但淺 1 級, 視覺 contrast 對 K 線 body 升綠/跌紅都清楚)
- ✅ **Position**: **4.65.0 改** `inBar` → `p.type === 'high' ? 'aboveBar' : 'belowBar'` (peak trigger 喺 K 線上面, trough trigger 喺 K 線下面, 對齊 P 點 marker 4.51.0 永久 rule position pattern, 鮮紫 trigger 喺紫 P 點對面 side, 視覺 unified)
- ✅ **Label**: 冇 — 大少 confirm 簡潔風格
- ✅ **Size**: 1 — 對齊 P 點 size 1 (4.51.0 永久 rule)
- ✅ **Time field**: business day object `{year, month, day}` (4.41.2 永久 rule 對齊 P 點 marker setData 格式, trigger date 都用同一個 format)
- ✅ **Dedupe by time**: 拎返避免 Lightweight Charts silent reject (4.40.0 永久 rule, 同 P 點 dedupe 邏輯對齊)
- ✅ **Filter ongoing**: `p.is_ongoing === true || p.triggerDate == null` skip (4.60.0 永久 rule + 大少 confirm)
- ✅ **Filter 第 1 個 P 點**: `p.index !== 0` skip (4.57.0 永久 rule trigger=self, visual useless, 大少 confirm)
- ✅ **Max count = 10**: 對齊 P 點 max 10, combined 最多 20 markers (4.63.0 永久 rule safe range, 大少 confirm)
- ✅ **Combined markers array**: P 點 markers + Trigger markers 用同一個 `chartRefs.zigzagSequenceMarkers.handle.setMarkers([...p, ...trigger])` (4.63.0 永久 rule spirit, 共享 plugin handle)
- ✅ **Re-set markers block**: 對齊 4.63.0 永久 rule, 50ms 後 `setVisibleLogicalRange` 嗰陣 re-set combined markers, trigger marker 自動 persist

**對齊永久 rule** (8 條):
- 4.15.0: 之字拎 point 同 trigger 都用 high/low (wick extreme) — 4.57.0 backend 永久 rule spirit
- 4.40.0: dedupe by time
- 4.41.2: time field 用 business day object `{year, month, day}`
- 4.51.0: P 點 arrow 風格 (high→arrowDown, low→arrowUp) + position pattern (high→aboveBar, low→belowBar), 4.64.0 trigger arrow shape + 4.65.0 trigger position 對齊
- 4.57.0: backend `triggerDate / triggerPrice / is_ongoing` 4 個 field, frontend 拎返 render
- 4.60.0: Ongoing point 嘅 trigger 設 null + is_ongoing=true, frontend filter 拎走
- 4.61.0: 「Frontend ZigZag 只 render 紫色折線」改為「Frontend ZigZag 紫色折線 + 紅色觸發點 marker (4.64.0)」, 4.65.0 改為「Frontend ZigZag 紫色折線 + 鮮紫觸發點 marker (4.65.0)」
- 4.63.0: v5 `LightweightCharts.createSeriesMarkers` plugin API + max 10 + fallback chain 10→5→3 (combined 最多 20 markers)

**對應 commit**:
- `4094fbd6` fix(stockpulse): 拎返紅色觸發點 (Trigger 確認點) marker (4.64.0, Option D arrowUp/arrowDown 對齊 P 點 arrow 風格)
- `689ace77` fix(stockpulse): 鮮紫觸發點 marker + 離開 K 線 body (4.65.0, 對齊 4.64.0 大少 00:48 trigger「用鮮紫色, 不要在那支竹內, 要在離開那支竹少少」)

### ZigZag P 點 + 鮮紫觸發點 marker toggle 永久 rule (4.66.0, 大少 2026-09-02 00:52 trigger「做返一個開關制是控制這個P點和觸發點的 預設是關的」) — **拎返 4.53.0 拎走嘅 marker toggle 嗰個 spirit, 但 default off 拎返 visual clean**

**凡人話解釋**: 4.64.0 拎返 P 點 marker + 4.65.0 拎返鮮紫觸發點 marker, default 開, 大少睇咗覺得太亂「很不好看」, 想要 toggle 控制顯示/隱藏。對齊 4.51.0 拎走嘅 #show-sequence + LS_KEY_SHOW_SEQUENCE 嗰個 spirit 拎返 (4.53.0 commit 拎走晒 P 點 toggle + state + LS_KEY, 4.61.5 commit 拎走晒 dead code, 4.66.0 拎返返用新 LS_KEY_SHOW_MARKERS)。大少 00:52 explicit「預設是關的」, default `false` 保持 chart 視覺 clean (只有紫色折線 + 4 條 MA + volume, 冇任何 marker), 撳開先見 P1-P10 紫色圓圈 + 鮮紫 trigger arrow 10 個。

**4.66.0 永久 rule**:
- ✅ **UI 位置**: `testing-page/index.html` chart-section 內 ma-toggle-bar 之前 (對齊 8月19日 23:20 永久 rule chart-control layout, 跟 #zigzag-enabled ZigZag 啟用 toggle 同 pattern)
- ✅ **HTML element**: `<input type="checkbox" id="zigzag-markers-enabled">` 喺 `<div id="zigzag-markers-controls">` 入面
- ✅ **Label**: 「啟用 P 點 + 鮮紫觸發點 (P1-P10 紫色圓圈 + 鮮紫 arrow trigger)」+ 細字「(撳即時 re-render, 唔需要跑算法 · 預設關)」
- ✅ **Default**: `false` (大少 00:52 trigger「預設是關的」, 對齊 4.53.0 拎走嘅 visual clean default spirit)
- ✅ **State variable**: `let zigzagMarkersEnabled = false;` (testing-page.js, default off, **4.66.5 fix 拎走 localStorage 拎返, 改為永遠 default false**)
- ✅ **localStorage key (4.66.5 拎走)**: `LS_KEY_SHOW_MARKERS = 'stockpulse.zigzag.showMarkers'` (4.66.5 拎走, 拎走 4.66.0 嗰個 localStorage 自動記住嘅 spec, 改為永遠 default false)
- ✅ **Helper (4.66.5 拎走)**: `getShowMarkers()` return `localStorage.getItem(LS_KEY_SHOW_MARKERS) === 'true'` (default false), `setShowMarkers(v)` set boolean string (4.66.5 拎走曬, 改為 `getShowMarkersDefault()` 永遠 return false)
- ✅ **Init 同步 (4.66.5 改寫)**: page load 嗰陣 `zigzagMarkersEnabled = false; zigzagMarkersEnabledEl.checked = false;` (拎走 localStorage 拎返, 永遠 unchecked)
- ✅ **Change handler (4.66.5 改寫)**: 撳 checkbox 即時 `lastChartRefs.zigzagMarkersEnabled = ...` + re-call `currentAdapter.renderChartOverlay()` 即時 re-render (拎走 `setShowMarkers` 嗰個 localStorage set, 唔需要撅跑 algorithm, 對齊 8月19日 13:03 Config UX 模式 spirit)
- ✅ **adapter.mjs check**: P 點 + 鮮紫 trigger 兩個 block 入口前加 `if (chartRefs.zigzagMarkersEnabled !== true) return;` 拎走晒 P 點 + 鮮紫 trigger marker, 紫色 ZigZag 折線 + 4 條 MA + volume 仍然 render (因為佢哋喺 return 之前 render 咗)
- ✅ **大少 explicit 預設關 (4.66.5 改寫)**: 撅完 reload page 永遠返 unchecked (拎走 4.66.0 嗰個「localStorage 自動記住大少 choice」spec, 跟大少 9月2日 07:34 trigger「把紅框這個制預備是 Off 的」)

**對齊永久 rule** (6 條):
- 4.51.0: 拎走嘅 #show-sequence 嗰個 toggle 拎返 (4.66.0 拎返用新 LS_KEY_SHOW_MARKERS, 4.61.5 commit 拎走嗰個 LS_KEY_SHOW_SEQUENCE 拎返 4.66.0 拎返拎返 spirit)
- 4.53.0: 拎走嘅 toggle block + state + LS_KEY 拎返 spirit 拎返, 預設關拎返 4.53.0 拎走嘅 visual clean default
- 4.61.5: 拎走嘅 `#zigzag-sequence-controls` + `#show-sequence` toggle + `LS_KEY_SHOW_SEQUENCE` + `getShowSequence` / `setShowSequence` + toggle handler (~35 行 dead code), 4.66.0 拎返 spirit 但用新 LS_KEY_SHOW_MARKERS (避免 conflict 4.61.5 拎走嘅 dead code)
- 4.62.0 + 4.63.0 + 4.64.0 + 4.65.0: P 點 + 鮮紫 trigger marker 拎返嘅永久 rule, 4.66.0 加 toggle 控制佢哋
- 8月19日 13:03 Config UX 模式: 即時 localStorage + 即時 re-render (唔需要撅跑 algorithm)
- 8月19日 23:20 chart-control layout: `#zigzag-markers-controls` div 喺 chart-section 內 ma-toggle-bar 之前

**對應 commit**: `fix(stockpulse): 拎返 P 點 + 鮮紫觸發點 marker toggle (4.66.0, 預設關, 大少 9月2日 00:52 trigger「做返一個開關制是控制這個P點和觸發點的 預設是關的」)` (6d3fae89)

### M1 「啟用 P 點 + 鮮紫觸發點」toggle 改 default On + 加返 localStorage 自動記住 永久 rule (4.66.6, 大少 2026-09-02 22:40 trigger「預設是 On 的, 即是在圖表裡可以看到 P1, P2, P3...」) — **反轉 4.66.5 拎走嘅 spec, 拎返 4.66.0 嗰個 localStorage 自動記住 spirit**

**凡人話解釋**: 4.66.5 拎走咗 4.66.0 嗰個 localStorage 自動記住 spec + 改永遠 default false, 大少 9月2日 22:40 trigger 反轉: 「預設是 On 的, 即是在圖表裡可以看到 P1, P2, P3...」。即係大少而家 reload page 預設見到 P1-P10 紫色圓圈 + 鮮紫 trigger arrow (唔使再撳 toggle), 同時保留 4.66.0 嗰個 localStorage 自動記住 user setting 嘅 spirit (撳 toggle 改 setting 之後 reload 仲係記住, 唔似 4.66.5 永遠返 default)。

**4.66.6 永久 rule**:
- ✅ **Default**: `true` (大少 9月2日 22:40 trigger「預設是 On 的」, 反轉 4.66.5 嗰個 `false` default, 對齊大少 trigger「即是在圖表裡可以看到 P1, P2, P3...」)
- ✅ **State variable**: `let zigzagMarkersEnabled = true;` (testing-page.js, default on, 4.66.6 反轉 4.66.5 拎走嘅 `false`)
- ✅ **localStorage key (4.66.6 拎返)**: `stockpulse.zigzag.markersEnabled` (JSON 格式, 取代 4.66.0 嗰個 `LS_KEY_SHOW_MARKERS = 'stockpulse.zigzag.showMarkers'` string, 4.66.6 用 JSON 對齊其他 toggle LS key pattern)
- ✅ **Helper (4.66.6 拎返)**: `setShowMarkers(enabled)` 同步 set state + checkbox + localStorage (3 個 action 一齊, 對齊 8月19日 13:03 Config UX 模式 spirit)
- ✅ **Init 同步 (4.66.6 改寫)**: page load 嗰陣 `_stored = localStorage.getItem('stockpulse.zigzag.markersEnabled')` → 有 record 用 user setting, 冇 record (第一次 reload) fallback default `true`
- ✅ **Change handler (4.66.6 改寫)**: 撳 checkbox 即時 `setShowMarkers(e.target.checked)` (即時 localStorage 自動儲存) + `lastChartRefs.zigzagMarkersEnabled = ...` + re-call `currentAdapter.renderChartOverlay()` 即時 re-render
- ✅ **大少 explicit 預設 On (4.66.6 改寫)**: 撅完 reload page → 讀 localStorage (有 record → user setting, 冇 record → default `true`), 反轉 4.66.5 嗰個「永遠 default false」

**對齊永久 rule** (3 條):
- 8月19日 13:03 Config UX 模式: 即時 localStorage 自動儲存 + 即時 re-render (唔需要撅跑 algorithm) — 4.66.6 拎返 4.66.0 拎走嘅 spirit
- 4.66.0 (00:52) toggle 結構: `<input id="zigzag-markers-enabled">` + `zigzagMarkersEnabled` state + handler 即時 re-render — 4.66.6 保留
- 4.66.4 (01:31) 對稱拎走 marker: 撳關 toggle 嗰陣 marker 拎走邏輯喺 adapter.mjs:5125-5134 處理 — 4.66.6 保留

**對應 commit**: `fix(testing-page): M1 「啟用P點 + 鮮紫觸發點」toggle 改 default On + 加返 localStorage 自動記住 (4.66.6)` (f509c0b2) — Spec Sync #66

**4.66.0-4.66.6 演進 timeline**:
- 4.66.0 (00:52): 拎返 toggle 本身 (4.53.0 拎走嘅 spirit 拎返), default false + localStorage 自動記住
- 4.66.1 (01:05): hotfix debug toggle + bump cache bust
- 4.66.2 (01:11): 拎返 check 移到 P 點 + trigger 入口之前
- 4.66.3 (01:21): 加 console.log debug toggle
- 4.66.4 (01:31): 撳關 toggle 嗰陣拎走殘留 P 點 + 鮮紫 trigger marker
- 4.66.5 (07:34): 拎走 localStorage 自動記住, 永遠 default false
- 4.66.6 (22:40, 今次): 反轉 4.66.5 → 改 default true + 加返 localStorage 自動記住 ✅

**凡人話總結**: 4.66.6 完美對齊大少 workflow — Reload page 預設見 P1-P10 (唔使再撳 toggle), 但撳 toggle 改 setting 之後 reload 仲係記住 (Config UX 模式 spirit)。對齊之前 Spec Sync 4.66.0 拎返 4.53.0 拎走嘅 spirit 嗰個對稱 pattern。

### M1 「啟用 P 點」toggle 每次出圖同步狀態 永久 rule (4.66.7, 大少 2026-09-03 17:48 trigger「每一次輸入股票出圖時要睇紅框有無 take, 如果有就要顯示, 如果無就不顯示」) — **補返 4.66.0 + 4.66.6 漏咗嘅「跑算法」出圖同步動作**

**凡人話解釋**: 4.66.0 拎返 P 點 + 鮮紫觸發點 marker toggle 之後, 撳 toggle 即時 re-render work, 但**撳「跑算法」換股票出圖嗰陣 toggle 嘅 effect 被洗走**。`renderChart()` 每次出圖拎新 `chartRefs`, 之後 line 1496 `lastChartRefs = chartRefs;` 但**冇 sync** 任何 toggle flag, adapter.mjs:5125 入口 check `chartRefs.zigzagMarkersEnabled !== true` 見到 `undefined !== true` 直接 return, P 點 + 鮮紫 trigger 唔 render。即係大少撳關紅框 → 換股票撳跑 → 出圖仲係見到 P 點 + 鮮紫 trigger (4.66.6 拎返 default on 嘅情況, 反過嚟都一樣錯)。

**4.66.7 fix 永久 rule**:
- ✅ **撳「跑算法」同步 toggle flag** (`testing-page/testing-page.js` line 1506-1512): 新加 sync block 喺 4.66.4 fix reset `lastChartRefs.zigzagSequenceMarkers = null` 嗰個 if block 之後, set `lastChartRefs.zigzagMarkersEnabled = zigzagMarkersEnabled;` 跟 `lastChartRefs.zigzagEnabled = zigzagEnabled;` (跟 global state)
- ✅ **撳「跑算法」之前 reset stale handle** (4.66.4 fix 保留): `lastChartRefs.zigzagSequenceMarkers = null` 保留, 避免舊 handle 殘留, 對齊 4.63.0 永久 rule「P 點 + 鮮紫 trigger 共用 handle」
- ✅ **撳 toggle 即時 re-render 仍然 work** (line 1793 保留): 撳 toggle 嗰陣即時 set `lastChartRefs.zigzagMarkersEnabled = zigzagMarkersEnabled;` 同步, 唔重複 set
- ✅ **Adapter.mjs 入口 check 唔改** (`algorithms/AS-03-cycle-detection/adapter.mjs:5125`): `if (chartRefs.zigzagMarkersEnabled !== true)` 仍然用緊同一個 contract, 4.66.7 補返 caller sync flag, 唔改 contract
- ✅ **對齊 4.66.6 永久 rule**: localStorage `stockpulse.zigzag.markersEnabled` persist user choice, 出圖嗰陣用返 user setting (default on 撳關 → 出圖唔見; default on 撳開 → 出圖見)
- ✅ **順手補返 zigzagEnabled** (同 bug class, 4.66.0 之後 `#zigzag-enabled` toggle handler 都有 set `lastChartRefs.zigzagEnabled`, 但「跑算法」嗰陣漏咗, 避免紫色折線 toggle 換股票之後失靈, 跟 Config UX 模式 spirit)
- ✅ **改 testing-page.js 必 sync bump** `ALGO_CACHE_BUST = '4.66.6' → '4.66.7'` + `?v=2.3.143 → ?v=2.3.144` (cache bust self-check 永久 rule 21:24)

**對齊永久 rule** (5 條):
- 8月19日 13:03 Config UX 模式: 即時 localStorage 自動儲存 + 即時 re-render + **出圖同步 toggle 狀態** (4.66.7 補返第三個 spirit)
- 4.66.4 (01:31) 對稱拎走 marker: `lastChartRefs.zigzagSequenceMarkers = null` 保留, 4.66.7 喺佢之後加 sync block, 唔重置
- 4.66.6 (22:40) default On + localStorage: 出圖嗰陣用返 user 之前 set 過嘅 state, reload 跟 user setting
- 4.63.0 P 點 + 鮮紫 trigger 共用 handle: 4.66.7 reset `zigzagSequenceMarkers = null` 保留呢個 invariant
- cache bust self-check 永久 rule 21:24: testing-page.js 改動必 sync bump `ALGO_CACHE_BUST` + `?v=` 2 個地方

**套用情境**:
- 之後加新 toggle flag (e.g. MA toggle, volume toggle) 都要喺「跑算法」嗰陣 sync 入 chartRefs
- 對齊 Config UX 模式 永久 rule (2026-08-19 13:03) 第三個 spirit: 出圖同步 toggle 狀態 (4.66.7 拎返)
- 之後唔可以只 set toggle handler 即時 re-render, 要記得 set 「跑算法」出圖嗰條 path

**凡人話總結**: 4.66.7 補返 4.66.0 + 4.66.6 嗰個「換股票出圖」嘅 hidden path, 撳完 toggle 換股票出圖都跟返 user 設定。對齊之前 4.66.4 對稱拎走 + 4.66.6 default on + localStorage 嗰兩個 fix 嘅 spirit, 4.66.7 係 sync 嗰條 path 嘅最後一塊拼圖。

**對應 commit**: `fix(testing-page): 每次出圖同步紅框 toggle 狀態 (4.66.7)` — Spec Sync #67

**4.66.0-4.66.7 演進 timeline** (4.66.6 嗰段更新):
- 4.66.0 (00:52): 拎返 toggle 本身 (4.53.0 拎走嘅 spirit 拎返), default false + localStorage 自動記住
- 4.66.1 (01:05): hotfix debug toggle + bump cache bust
- 4.66.2 (01:11): 拎返 check 移到 P 點 + trigger 入口之前
- 4.66.3 (01:21): 加 console.log debug toggle
- 4.66.4 (01:31): 撳關 toggle 嗰陣拎走殘留 P 點 + 鮮紫 trigger marker
- 4.66.5 (07:34): 拎走 localStorage 自動記住, 永遠 default false
- 4.66.6 (22:40): 反轉 4.66.5 → 改 default true + 加返 localStorage 自動記住
- **4.66.7 (今次)**: 補返「跑算法」出圖嗰條 path 嘅 sync, 換股票出圖都跟返 toggle state ✅

### M1 「啟用 P 點」toggle 對稱拎走 marker 永久 rule (4.66.4, 大少 2026-09-02 01:31 trigger「在M1 裡有個制是啟用P點的，但有問題」) — **補返 4.66.0 漏咗嘅對稱拎走動作**

**凡人話解釋**: 大少 4.66.0 拎返 P 點 + 鮮紫觸發點 marker toggle 嗰陣, 撳關 toggle 之後**之前 render 嘅 P 點 P1-P10 紫色圓圈 + 鮮紫 trigger arrow 仲殘留喺 chart 上面, 冇拎走**。4.66.0 + 4.66.2 嘅 `if (chartRefs.zigzagMarkersEnabled !== true) return;` 攔截 render, 但**冇對稱拎走**之前已經 render 落 chart 嘅 marker。Lightweight Charts v5 `createSeriesMarkers` 拎 plugin handle, handle 仲喺 chart 上面 render 緊舊 markers。撳 toggle cycle 開/關/開/關 嗰陣, P 點 + 鮮紫 trigger 從來冇真正消失過。

**4.66.4 fix 永久 rule**:
- ✅ **對稱拎走 marker 邏輯** (`algorithms/AS-03-cycle-detection/adapter.mjs:5125-5134`): 喺 `if (chartRefs.zigzagMarkersEnabled !== true) { return; }` 之前, call `chartRefs.zigzagSequenceMarkers.setMarkers([])` 拎走舊 markers, 同步 set `markers = []` 避免 stale
- ✅ **4.63.0 永久 rule 對齊**: P 點 + 鮮紫 trigger 共用 `chartRefs.zigzagSequenceMarkers.handle`, 1 個 `setMarkers([])` call 拎走晒 2 種 marker, 唔需要分開拎
- ✅ **對齊「啟用之字」紫色折線 toggle pattern** (testing-page.js:1707-1712 `chart.removeSeries` + `null`): 撳 toggle 之前主動拎走 series / marker, 唔可以只 return
- ✅ **撳「跑算法」reset stale handle** (`testing-page/testing-page.js:1481+`): `lastChartRefs.zigzagSequenceMarkers = null` 避免舊 handle 殘留, 之後撳 toggle on 嗰陣 line 5193 `createSeriesMarkers` 拎新 handle, 乾淨
- ✅ **拎走 4.66.3 hotfix debug log** (`testing-page/testing-page.js:1734-1741`): 改用 adapter.mjs setMarkers log 確認 fix work, 拎走 2 個 `console.log(...4.66.3 debug...)`
- ✅ **加 4.66.4 fix log** (`adapter.mjs:5132`): `console.log('[M1 v2.0 4.66.4 fix] 🗑️ 拎走殘留 P 點 + 鮮紫 trigger marker (toggle off, setMarkers([]), 4.66.0 漏咗拎走動作今次補返)')` 方便大少 confirm
- ✅ **cache bust sync bump**: `testing-page.js` `ALGO_CACHE_BUST = '4.66.3' → '4.66.4'`, `testing-page/index.html` `?v=2.3.140 → ?v=2.3.141` (2 個地方, 跟 cache bust self-check 永久 rule)
- ✅ **Failure mode coverage**:
  - `chartRefs.zigzagSequenceMarkers` undefined (例如 reset chart refs 之前未 render 過 P 點): `?.setMarkers` 唔 call, return 走佬, 冇 crash
  - `chartRefs.zigzagSequenceMarkers.setMarkers` 唔係 function: `typeof === 'function'` check 過, skip, return 走佬, 冇 crash
  - Lightweight Charts plugin handle 已經 destroy: `setMarkers([])` 內部有 try/catch, silent fail, 唔 crash

**對齊永久 rule** (4 條):
- 4.66.0: 拎返 P 點 + 鮮紫觸發點 marker toggle (預設關, 大少 00:52 trigger)
- 4.66.2: 拎返 check 移到 P 點 + trigger 入口之前
- 4.63.0: P 點 + 鮮紫 trigger 共用 `chartRefs.zigzagSequenceMarkers.handle`, 1 個 `setMarkers([])` call 拎走晒
- 8月19日 13:03 Config UX 模式: 即時 localStorage + 即時 re-render

**對應 commit** (將來 push): `fix(stockpulse): M1 「啟用 P 點」toggle 撳關拎走殘留 P 點 + 鮮紫 trigger marker (4.66.4, 大少 9月2日 01:31 trigger 揭發 4.66.0 漏咗拎走動作)`

### M1 「啟用 P 點 + 鮮紫觸發點」toggle 永遠 default Off 永久 rule (4.66.5, 大少 2026-09-02 07:34 trigger「把紅框這個制預備是 Off 的」) — **拎走 4.66.0 嗰個 localStorage 自動記住 user choice 嘅 spec, 改為永遠 default false**

**凡人話解釋**: 4.66.0 commit `6d3fae89` spec 寫「Reload page 預設關, 想每次都見到自己 toggle 開, localStorage 自動記住大少 choice」, 跟住 implementation 用 `LS_KEY_SHOW_MARKERS` + `getShowMarkers()`/`setShowMarkers()` 記住 user 撳過嘅 state。但係大少 9月2日 07:34 trigger「把紅框這個制預備是 Off 的」, 揭發 implementation 同 4.66.0 原始 trigger「預設是關的」真正意思唔對: 大少 want **永遠 default Off**, user 撳開 reload 仍然返 unchecked, 純 visual toggle 唔 persist。拎走 localStorage 自動記住嗰個 spec, 改為 page load 永遠 default false。

**4.66.5 fix 永久 rule**:
- ✅ **拎走 `LS_KEY_SHOW_MARKERS`** (`testing-page/testing-page.js:95`): 4.66.0 嗰個 `'stockpulse.zigzag.showMarkers'` 拎走, 因為 user choice 唔再 persist, 冇需要 localStorage key
- ✅ **拎走 `getShowMarkers()`** (`testing-page/testing-page.js:96-99`): 拎走 localStorage 拎返邏輯, 改為 `getShowMarkersDefault()` 永遠 return `false`
- ✅ **拎走 `setShowMarkers()`** (`testing-page/testing-page.js:100-102`): 拎走 localStorage set 邏輯, 因為冇 key 都冇需要 set
- ✅ **Init 改寫** (`testing-page/testing-page.js:1746-1748`): `zigzagMarkersEnabled = false; zigzagMarkersEnabledEl.checked = false;` (拎走 `getShowMarkers()` call, 永遠 unchecked)
- ✅ **Change handler 改寫** (`testing-page/testing-page.js:1756-1758`): 拎走 `setShowMarkers(zigzagMarkersEnabled)` 嗰個 call, 改為只 set `zigzagMarkersEnabled = e.target.checked` + 即時 re-render (對齊 8月19日 13:03 Config UX 模式即時 re-render 嗰個 spirit)
- ✅ **凡係 user choice 唔記住**: 撳 toggle 即時 render marker (紫圓圈 + 鮮紫 trigger), 但 reload page 永遠返 unchecked。對齊 4.66.0 原始 trigger「做返一個開關制是控制這個P點和觸發點的 預設是關的」真正意思: 「預設」= page load default 永遠 false, 唔係「user choice 自動記住」
- ✅ **保留嘅嘢**:
  - 撳 toggle 即時 re-render marker (8月19日 13:03 Config UX 模式 spirit 保留)
  - 4.66.4 fix 對稱拎走 marker 動作 (line 1758-1762) 保留, `if (chartRefs.zigzagMarkersEnabled !== true) return;` 仍然喺 adapter.mjs 入口前
  - 紫色 ZigZag 折線 + 4 條 MA + volume 仍然 render (唔受 toggle 影響)
- ✅ **Failure mode coverage**:
  - 撳 toggle 即時 render/拎走 marker, 唔 crash
  - Reload 永遠 default false, 唔受之前 user 撳過影響
  - localStorage 之前 set 過嘅 `'true'` 會被忽略, 永遠 default false (拎走舊 state 拎返)

**對齊永久 rule** (5 條):
- 4.66.0: 拎返 P 點 + 鮮紫 trigger marker toggle, default off (大少 00:52 trigger「預設是關的」原始意思)
- 4.66.4: 對稱拎走 marker 動作 (撳關嗰陣 setMarkers([]))
- 4.66.5 (新加): 拎走 localStorage 自動記住, 永遠 default false
- 8月19日 13:03 Config UX 模式: 撳 toggle 即時 re-render (唔需要撅跑 algorithm, 保留 spirit 但拎走 localStorage 記住嗰部分)
- 8月19日 23:20 chart-control layout: `#zigzag-markers-controls` div 喺 chart-section 內 ma-toggle-bar 之前 (保留)

**對應 commit** (將來 push): `fix(stockpulse): M1 「啟用 P 點 + 鮮紫觸發點」toggle 永遠 default Off, 拎走 4.66.0 localStorage 自動記住 (4.66.5, 大少 9月2日 07:34 trigger「把紅框這個制預備是 Off 的」)`

### ZigZag 4.53.0 拎走 marker toggle 嗰個對齊 (4.66.0 拎返)

**4.53.0 拎走嘅嘢** (line 631-673 section 描述):
- ✅ 拎走紫色 P 點 sequence marker toggle (4.51.0 永久 rule 拎走 toggle) — 4.66.0 拎返嗰個 toggle spirit, 用新 `LS_KEY_SHOW_MARKERS` + `#zigzag-markers-enabled` checkbox
- ✅ 拎走 `#show-sequence` toggle (4.51.0 加) + `LS_KEY_SHOW_SEQUENCE` + `getShowSequence` / `setShowSequence` helpers + `#show-sequence` toggle handler — 4.66.0 拎返 spirit 但用新 LS_KEY_SHOW_MARKERS (避免 conflict 4.61.5 拎走嘅 dead code)
- ✅ 拎走 `showZigzagSequence` + `zigzagSequenceMaxCount` state (4.66.0 拎返 spirit 但用 `zigzagMarkersEnabled` state, 因為 4.66.0 控制 P 點 + 鮮紫 trigger 一齊 toggle, 唔只係 P 點 sequence marker)

**4.66.0 拎返**:
- 對齊 4.51.0 + 4.53.0 拎走嘅 toggle spirit 拎返, 但 default off 拎返 visual clean (大少 explicit「預設是關的」)
- 用新 `LS_KEY_SHOW_MARKERS` (唔係 `LS_KEY_SHOW_SEQUENCE`, 因為 4.66.0 控制 P 點 + 鮮紫 trigger, 唔只係 P 點 sequence)
- 用新 `let zigzagMarkersEnabled = false;` (唔係 `showZigzagSequence`, 因為 4.66.0 control 範圍唔同)

### ZigZag Threshold 切 manual mode 永久 rule (大少 2026-08-31 09:24, 4.52.0)

**凡人話解釋**: 大少 8月31日 09:24 trigger「Zigzag Threshold 模式 轉手動時沒有跟據輸入而更新，請檢查」— 統一切 manual mode 嗰陣用大少手動輸入過嘅 value 優先，唔好用 recent auto 結果 overwrite 佢輸入嘅 value。

**Root cause** (4.28.0 邏輯衝突):
- `testing-page/testing-page.js` 切 manual mode handler (line 1651-1657, 4.28.0) 用 recent auto 結果優先 (`displayVal.textContent`)，overwrite `manualInput.value`
- 大少輸入 8% → `_onManualChange` setLocalStorage(8) → 切 manual mode 嗰陣 recent auto = 3% (auto 計算結果) → manual input value 俾 overwrite 變 3% → 紫色線 update 用 3% 錯
- 大少期望: 切去 manual mode 嗰陣紫色線用佢輸入嘅 8% (因為佢已經明確輸入過)

**永久 rule** (4.52.0 新加, 改寫 4.28.0 切 manual mode 邏輯):
- ✅ 切 manual mode 嗰陣永遠用 localStorage manual value 優先 (大少手動輸入過嘅 value)
- ✅ 如果 localStorage 仲係默認 5 (即係從未手動輸入過), fallback 落 recent auto 結果
- ✅ 永遠唔 overwrite manual input field, 用大少真實手動輸入過嘅 value
- ✅ 同步 manual input field value 對齊 v (currentOptions.zigzagThreshold)
- ✅ 對齊 Spec Sync #31 永久 rule: Config UX 模式「自動+手動+自動儲存更新圖表」
- ✅ 凡人話: 大少輸入 8% 之後切去 manual mode, 紫色線用 8% update, manual input field 顯示 8% (唔好俾 auto 結果 overwrite)

**對應 file**:
- `testing-page/testing-page.js` 切 manual mode handler (line 1647-1680): 改用 localStorage 優先, fallback 落 recent auto
- `testing-page/testing-page.js` ALGO_CACHE_BUST '4.51.0' → '4.52.0' + 4.52.0 永久 rule comment
- `testing-page/index.html` ?v=2.3.112 → ?v=2.3.113

對應 doc: M1-V22-RESEARCH.md (即將加返 entry)

對應 commit: 即將 push (Spec Sync #48 流程)

### ZigZag 拎走橙旗 + 鮮綠線 + P 點 sequence marker 永久 rule (大少 2026-08-31 11:09, 4.53.0)

**凡人話解釋**: 大少 8月31日 11:09 trigger「在圖表的 Zigzag 還是有些問題,你睇返記錄之前有叫你把最右迫的 P2 改成 P1 ,還有橙旗的 zigzag 決定點功能,這些我都想拿走不要,這些有可能影響了正常的 Zigzag」— 拎走晒 3 個花巧 visual 嘢(橙旗決定點 + 鮮綠色 close extension 線 + 紫色 P 點 sequence marker),chart 完全乾淨,只有紫色 ZigZag 線 + K 線 + MA 線。

**改寫 4 個永久 rule**:
- 4.42.2 永久 rule (8月30日 17:50) 拎走: 橙色 #FF9800 細小旗仔 marker
- 4.8.3 永久 rule (8月19日 09:40) 拎走: 鮮綠色 #00C853 close extension 線
- 4.51.0 永久 rule (8月31日 09:00) 拎走 toggle 保留 P1 規則: 紫色 P 點 sequence marker
- 4.49.0 永久 rule (8月31日 01:59) 拎走: setMarkers 整個 block (v5 plugin API)

**永久 rule** (4.53.0 拎走, 大少 11:09 trigger + 11:27 揀預設方案):
- ✅ 拎走 ZigZag 橙旗決定點 marker (4.42.2 永久 rule 拎走)
- ✅ 拎走鮮綠色 #00C853 close extension 線 (4.8.3 永久 rule 拎走)
- ✅ 拎走紫色 P 點 sequence marker toggle (4.51.0 永久 rule 拎走 toggle)
- ✅ 拎走 setMarkers 整個 block (4.49.0 永久 rule 拎走)
- ✅ 拎走 backend `decisionDate` / `decisionValue` / `decisionType` 3 個 field (`backend/algorithms/zigzag/algorithm.py` 4 個 `result.append` 拎走 3 行 + `decision_flag_count` 拎走)
- ✅ 拎走 production frontend `decisionTime` / `decisionValue` 2 個 field (跟 backend 對齊, 避免 type error)
- ✅ 紫色 ZigZag 線只 render line, 冇 number marker, 冇 close extension 線, 冇旗仔 (chart 完全乾淨)
- ✅ 對齊 8月29日 22:44 永久 rule「所有改動要 confirm」: 大少明確 trigger「拎走不要」先做
- ✅ 對齊 8月31日 11:01 永久 rule「Backend hot-reload」: 改 algorithm.py 之後必 restart backend + curl verify
- ✅ 對齊 2026-08-09 13:10 永久 rule「testing-page .mjs cache bust」: ALGO_CACHE_BUST + ?v=2.3.X 2 個地方同步 bump
- ✅ 對齊 8月31日 01:48 永久 rule「還原點」: 備份 commit hash `5c89c659eda481918101fe8060480ccfdbc1a67a` 一鍵還原

**凡人話**: 撳跑完 M1 算法, 圖表只剩紫色 ZigZag 線 + K 線 + MA 線, 大少睇得清, 唔會再有橙旗/鮮綠線/P 點號碼干擾

**改動 file**:
- `backend/algorithms/zigzag/algorithm.py` 拎走 3 個 field + `decision_flag_count` + class version 0.1.0 → 0.2.0
- `algorithms/AS-03-cycle-detection/adapter.mjs` 拎走 line 5104-5304 整段 (橙旗 + 鮮綠線 + P 點 setMarkers)
- `web/src/components/chart/ChartContainer.tsx` 拎走 `decisionTime?` / `decisionValue?` + `zigzagFlagMarkersRef` + 旗仔 marker build
- `web/src/pages/ElliottWaveTestPage/ElliottWaveTestPage.tsx` 同 ChartContainer 對齊拎走
- `testing-page/testing-page.js` ALGO_CACHE_BUST '4.52.0' → '4.53.0' + 拎走 `showZigzagSequence` / `zigzagSequenceMaxCount` state + 拎走 `reRenderZigZagSequence` function + 拎走 2 個 toggle event listener + 拎走 debug panel 嘅 sequence + flag display
- `testing-page/index.html` 拎走 `#zigzag-sequence-controls` toggle + `?v=2.3.113` → `?v=2.3.114`

**Curl verify** (8月31日 11:35, 189 個 points):
```bash
curl -s "http://localhost:18792/api/algorithms/run?algo=zigzag&symbol=HK.00700&period=1d&threshold=5"
```
✅ 每個 point 嘅 keys = `['date', 'value', 'type', 'index', 'sequence']`, 冇 `decisionDate` / `decisionValue` / `decisionType`
✅ meta 7 個 field, 冇 `decision_flag_count`

對應 doc: M1-V22-RESEARCH.md 「🔴 大少 trigger #N+2 — 拎走 ZigZag 橙旗決定點 + 鮮綠線 + P 點 sequence marker (2026-08-31 11:09, 4.53.0)」section

對應 commit: `chore: 拎走 ZigZag 橙旗 (4.53.0 永久 rule)` (大少 8月31日 11:09 + 11:27 trigger 揀預設方案 + 11:23 備份 trigger)

### 純 branch 還原點永久 rule (大少 2026-09-08 21:00 trigger)

**凡人話解釋**: 大少 9月8日 21:00 trigger「以後的還原點是用分支來做, 名字前要有 \"Backup-\", 和現在的分支還原點一樣」— 拎走舊 §15.45 Sscript pattern (annotated tag + backup branch + restore script) + §15.53 Backup Admin Page, 改為**純 branch 還原點 pattern**。原本嘅 page UI (`backup-admin/`) + script 一鍵還原拎走, 之後還原點只係 git branch, 大少可以直接 `git checkout Backup-xxx` 或者 merge 返 main。

**還原點 pattern** (對齊 §15.39 簡化版):
- ✅ **Branch 名**: `Backup-YYYY-MM-DD-<description>` (e.g. `Backup-2026-09-08-m1-v2.5.0-stable`)
- ✅ **Tag**: 唔再需要 (純 branch 就夠, 大少可以 `git log Backup-xxx` 拎 evidence)
- ✅ **Restore script**: 唔再需要 (大少可以直接 `git checkout Backup-xxx` 或者 merge 返 main)
- ✅ **Backup Admin Page**: 拎走 (`backup-admin/` + `backend/api/backup_admin.py` 拎走, endpoint `/api/backup-points/*` 拎走)

**永久 rule**:
- ✅ 大項目 (refactor / spec rewrite / framework 升級 / 大少明確 trigger) 之前必做 branch 還原點
- ✅ 還原點 branch 名永遠用 `Backup-` prefix (對齊大少 trigger 9月8日 21:00, 名字前要有 "Backup-")
- ✅ 還原點 branch 必 push 去 origin (大少可以隨時拎返)
- ✅ 改動之後 Spec Sync 即時 commit (對齊 8月18日 06:36 永久 rule)
- ✅ 之後新加 feature 必先開 `feat/<description>` branch (對齊 9月8日 17:00 StockPulse Git workflow 永久 rule, Option C)
- ✅ 之前嘅 Sscript 還原點 (`restore-*` tag + `backup-*` branch + `scripts/restore_*.sh`) 保留 (歷史 trace, 拎走反而 issue)

**還原點 set 流程** (對齊 9月8日 17:00 Option C Hybrid):
```bash
# 1. 開 backup branch (從 main HEAD)
git checkout main
git pull origin main
git checkout -b Backup-YYYY-MM-DD-description

# 2. Push 去 origin
git push -u origin Backup-YYYY-MM-DD-description

# 3. 之後做改動 (大少可以 trigger 我)
# ... 改動 + commit + push

# 4. 大少要還原: git checkout Backup-xxx 或者 merge 返 main
git checkout main
git merge Backup-xxx --no-ff
```

**教訓** (大少 trigger「以後的還原點是用分支來做」):
- ✅ 之前 Sscript pattern (tag + branch + script + page) 太複雜, 用唔著個 page
- ✅ 改為純 branch 就夠, 大少可以直接 `git checkout` / merge 操作
- ✅ 對齊 9月8日 17:00 永久 rule「StockPulse Git workflow Option C」: feature branch 用 `feat/`, backup branch 用 `Backup-`

**對應 commit**:
- `7edf3aec feat(refactor): 拎走 Backup Admin Page + backend code (§15.45/§15.53/§15.54 拎走, 改為純 branch 還原點 pattern)`
- Spec Sync: AGENTS.md / HANDOVER.md / ARCHITECTURE.md (本段)


### M1 console log 加 ZigZag 最新 10 點 永久 rule (大少 2026-08-31 12:50 trigger, 4.54.0)

**凡人話解釋**: 大少撳跑 M1 之後, 想喺現有黑色「🔧 Chart Debug」console log (testing page 圖表下面) 自動列出 ZigZag 最新 10 個點嘅日子同點數 (P1 為最新, 倒序排 P1 → P10), 方便對齊睇 chart 上面嘅紫色 ZigZag 線, 唔使再 scroll 開 DevTools console 拎 `window.currentVerdict.meta.zigzagPoints` raw data。

**改動**:
- `testing-page/testing-page.js` `renderDebugPanel()` 加 `_formatZigZagLatestPointsForDebug()` helper
  - 喺現有「K線最後 close」行之下 insert 1 個 mini-table HTML
  - 4 欄 layout: 序號 (P1-P10) / 日子 (YYYY-MM-DD) / 點數 (2 位小數) / 類型 (📈 Peak / 📉 Trough)
  - **P1 = points[0] = K線最近嗰個交易日嘅紫色 ZigZag 點** (因為 backend verdict.points 排法係 (新 → 舊), 唔係 (舊 → 新))
  - **4.55.0 fix (大少 13:14 trigger)**: 由 `slice(-10).reverse()` 改做 `slice(0, 10)`, 因為 verdict.points[0] = 最新
  - Source 拎 `lastVerdict.meta.zigzagPoints` (已經由 backend inject 落去, 對齊 4.43.0 永久 rule「ZigZag 全部 backend 計」)
  - Edge case: empty / undefined → 顯示「(冇 points, 可能未跑算法 / threshold 太高)」, 唔 crash
  - Edge case: zigzagPoints.length < 10 → table 顯示實際有嘅 (1-9 行)
- `testing-page/testing-page.js` bump `ALGO_CACHE_BUST` 4.53.0 → 4.54.0 (4.55.0 fix 改 4.54.0 → 4.55.0)
- `testing-page/index.html` bump `?v=2.3.114` → `2.3.115` (4.55.0 fix 改 2.3.116, 2 個地方: CSS line 10 + JS line 184)

**永久 rule**:
- ✅ Testing page M1 跑完之後, 喺黑色 🔧 Chart Debug panel 底部永遠 auto-render 1 段「📈 ZigZag 最新 10 點 (P1 為最新, 倒序排)」
- ✅ 永遠拎 `lastVerdict.meta.zigzagPoints` 而唔係 `window.currentVerdict.meta.zigzagPoints` (因為 renderDebugPanel 已經收 verdict 做 parameter)
- ✅ **P1 = points[0] = K線最近嗰個交易日嘅紫色 ZigZag 點** (backend verdict.points 排法係 (新 → 舊), points[0] = 最新)
- ✅ **永遠用 `slice(0, 10)` 拎最前 10 個** (即係最新嗰 10 個, 因為 array 已經係 (新 → 舊)), 唔好用 `slice(-10).reverse()` (4.55.0 fix)
- ✅ Style 全部 inline (唔加 testing-page.css, 跟 popup 註解永久 rule 風格一致)
- ✅ 凡人話: 大少撳跑 M1 → 即時喺 console log 底部見到 P1-P10 日子 + 點數 → 唔使再 scroll 開 DevTools console
- ✅ 對齊 2026-08-09 13:10 永久 rule「改 .mjs 之後必同步 bump ALGO_CACHE_BUST + ?v=2.3.X」 (雖然今次冇改 .mjs, 但 .js 改動都跟同一個 pattern)
- ✅ 對齊 4.43.0 永久 rule「ZigZag 全部 backend 計」 (frontend 拎 backend 注入嘅 verdict.meta.zigzagPoints, 唔重計)
- ✅ 對齊 4.15.0 永久 rule「之字拎 point 用 high/low」 (type 'high' = peak, type 'low' = trough)
- ✅ 對齊 8月29日 14:32 永久 rule P1/P2/P3/P4 indexing 精神 (P1 = 最新, 之後順序)
- ✅ **4.55.0 lesson learned**: 改 array sort / iterate 邏輯之前, 必先用 curl / test script 拎 evidence 確認 array 排法, 唔可以靠注釋 / mental model 估

**Acceptance tests**:
- 撳跑 M1 (AS-03-MA) 任何股票 e.g. HK.00019 (太古) → 撳跑完之後, scroll 落 chart 下面, 見到黑色 🔧 Chart Debug panel
- Panel 底部 (K線最後 close 行之下) 見到新段「📈 ZigZag 最新 10 點 (P1 為最新, 倒序排):」
- Mini-table 顯示最多 10 行 (如果 zigzagPoints.length >= 10), 每行有 4 欄
- **P1 = K線最近嗰個交易日嘅紫色 ZigZag 點** (對齊 chart 上面紫色 ZigZag 線最後嗰個 point, 對齊 K線最近)
- **P10 = 倒數第 10 新嗰個交易日** (e.g. HK.00019 = 2025-08-04)
- 撳跑 zmen / M9 等其他 module → 因為 `verdict.meta.zigzagPoints` undefined, mini-table 顯示「(冇 points, 可能未跑算法 / threshold 太高)」, 唔 crash

對應 doc: M1-V22-RESEARCH.md 「🟢 大少 trigger 8月31日 12:50」section


### Stock 名 evidence 永久 rule (大少 2026-09-05 07:27 trigger)

**凡人話解釋**: 之後 StockPulse 任何對話講 stock 名, 必須用 backend `/api/stocks/{code}` 拎真實名, 唔可以用 mental model 估。

**大少 trigger**: 「HK.02611 國泰海通, 但你的是 02611 國泰君安, 又例如 HK.01088 中國神華 但你的是 01088 中海油」— 發現 Mavis C 方案 evidence (commit `b8bdf981`) 3 隻 stock 揀錯, 仲有 15 隻 stock alias 簡寫唔齊全 (e.g. 「中石化」vs「中國石油化工股份」)。

**永久 rule**:
- ✅ 所有 stock 名必須用 backend evidence `/api/stocks/{code}` 拎真實全名, 唔可以用 mental model 估
- ✅ Spec doc 同 commit message 用 stock 全名 (e.g. 中國石油化工股份), alias 簡寫 (e.g. 中石化) 只係凡人話 alias 唔可以當 stock 名 evidence
- ✅ 對齊 4.55.0 lesson learned「改 array sort/iterate 邏輯之前, 必先用 curl / test script 拎 evidence 確認 array 排法, 唔可以靠注釋 / mental model 估」(2026-08-31 13:14)
- ✅ 對齊 8月29日 14:32 永久 rule P1/P2/P3/P4 indexing 精神 (P 點要用 evidence 拎, 唔可以靠 mental model)
- ✅ Evidence 流程: `curl /api/stocks/{code}` → 拎 `name` field 真實全名 → 用全名寫 spec doc / commit message
- ✅ Spec doc 提 stock 例子時: 用「HK.XXXXX 全名」格式 (e.g. 「HK.00386 中國石油化工股份」)
- ✅ 凡人話解釋可以用 alias 簡寫 (e.g. 「中石化」), 但 commit/spec doc 必須用真實全名

**套用**:
- 之後 StockPulse 任何 stock 對話 (spec doc / commit / debug / 凡 人話) 都跟呢個 pattern
- 改 spec doc / commit message 嗰陣, 必先用 curl `/api/stocks/{code}` 拎真實全名
- Commit message 改 stock 名 evidence 嗰陣, 用 `git commit --amend` + `git push --force-with-lease` 修正 (改 commit content + message)
- Debug script 同 research script 拎 stock 名都跟呢個 pattern, 唔可以靠 mental model 估

**Evidence cross-check tool** (helper script):
```python
import urllib.request, json
def get_name(sym):
    url = f"http://127.0.0.1:18792/api/stocks/{sym}"
    with urllib.request.urlopen(url, timeout=5) as resp:
        return json.loads(resp.read()).get("name", "?")
```

**對應 commit**: `570ad7a9` (amend `b8bdf981`, 大少 7:27 trigger 後即時修正)
**對應 spec doc**: M1-V22-RESEARCH.md trigger #10 嘅 stock 例子 + 永久 rule section 嘅 evidence
**對應 doc**: ARCHITECTURE.md §15.XX (待大少 trigger 加 §15.XX 號碼)
**教訓**: 跟 4.55.0 lesson learned 同源, 係「evidence 必先確認」原則嘅 stock 名延伸

### M1 v2.4.0 拎走「強升中整固」sub-scenario 永久 rule (大少 2026-09-08 16:09 trigger)

**凡人話解釋**: M1 之前 v2.3.0 (大少 2026-09-05 trigger) 加咗第 10 個 sub-scenario「強升中整固」(strong_uptrend_consolidating) 補 boundary case, 但 9月8日 audit 217 stock (kline_cache 內 HK 209 + US 8) 證明 **0 隻 stock 真係 hit 過** 呢個 sub-scenario, 屬 dead code。大少 9月8日 16:09 trigger「把強升中整固不要」, 即刻拎走。

**拎走嘅範圍** (Spec Sync #50+):
- ✅ `backend/algorithms/ma_alignment/algorithm.py` line 562-598 拎走整個 Priority 2.6 elif block
- ✅ CYCLE_LABELS / STATE_MAP / POSITION_LABELS 3 個 dict 入面拎走 "strong_uptrend_consolidating" / "consolidating_after_rally"
- ✅ Step 7a / 7b / 7c candidate list (3 個) 拎走 "strong_uptrend_consolidating"
- ✅ 拎走 `_recent_consolidation_range` helper function (line 283-289, 純粹強升中整固 trigger 用)
- ✅ `backend/algorithms/ma_alignment/config.py` 拎走 `consolidationLookback` + `consolidationRangeThresholdPct` 2 個 config
- ✅ `docs/research/AS-03-cycle-detection/M1-V22-RESEARCH.md` line 321-360 改 v2.4.0 8 個 sub-scenario 簡單算法表
- ✅ M1-V22-RESEARCH.md 拎走「#3 強升中整固」v2.3.0 fix entry (4 個已知問題清單 → 3 個)
- ✅ algorithm.py header docstring + 永久 rule 註解 update v2.4.0

**永久 rule**:
- ✅ 改任何 sub-scenario trigger 拎走/加條件必須先 audit ≥ 3 隻 stock 拎 evidence 確認 (8月16日 19:21 永久 rule)
- ✅ 拎走嘅 sub-scenario 必須 update 4 個地方: (1) algorithm.py elif block (2) labels dict (3) candidate list (4) spec doc 簡單算法表 (8月18日 06:36 永久 rule 沿用)
- ✅ 拎走嘅 sub-scenario 連帶拎走 helper function / config (避免 dead code, 「拎走要乾淨」)
- ✅ 拎走後 stock 落 fallback cycle (強升中整固拎走後 stock 跌入「強升 / 初升 / 橫行」)
- ✅ frontend 對「強升中整固」冇 reference (純 backend cycle enum, 拎走後 frontend verdict card 自動唔 render 呢個 cycle)
- ✅ 對齊 9月6日永久 rule: 「放量」拎走 trigger 條件但保留 confidence indicator (volumeConfirmed field + 紅字提示), 唔好直接刪晒

**凡人話 audit 拎走前 vs 拎走後**:
| Stock | 拎走前 cycle | 拎走後 cycle | 拎走後 confidence |
|---|---|---|---|
| HK.00013 和黃醫藥 | 強升 (conf 1.0) | 強升 (conf 1.0) | 拎走前已放量, 拎走後 100% 仍 hit |
| HK.00019 太古A | 強升 (conf 0.72) | 強升 (conf 0.67) | 拎走後仍 hit, 「放量」拎走但「放量上漲,信心提升」仲喺 indicator log |
| HK.00386 中國石油化工股份 | 強升 (conf 1.0) | 強升 (conf 1.0) | 拎走後 100% 仍 hit |
| HK.00700 騰訊 | 強跌 (conf 0.21) | 強跌 (conf 0.22) | 拎走後仍 hit |
| HK.00151 中國旺旺 | 強跌 (conf 1.0) | 強跌 (conf 1.0) | 拎走後 100% 仍 hit |

**Audit 結論**: 拎走「強升中整固」後 5 隻 stock 拎走前 hit 嘅 cycle 拎走後 100% 仍 hit, 拎走嘅係 dead code 對 verdict 結果 0 影響。

**對應 commit**: 即將 push (Spec Sync #50+, 大少 9月8日 16:54 trigger 揀 A 立即做 + commit + push)
**對應 spec doc**: `docs/research/AS-03-cycle-detection/M1-V22-RESEARCH.md` v2.4.0 8 個 sub-scenario 簡單算法表
**對應凡人話 trigger**: 大少 2026-09-08 14:13 (217 stock audit) + 16:09 (拎走 trigger) + 16:54 (揀 A 立即做)


### M1 v2.5.0 confidence 增減量 + boost/penalty 配對 永久 rule (大少 2026-09-08 20:31 trigger, Sub-Option C 揀)

**凡人話解釋**: 之前 M1 v2.4.0 用「倍數」公式計 confidence (`base × vol_mul × slope_mul`), 9月8日 audit 217 stock 揭發 23 隻 conf=1.0 (10.6%), 因為 `base=1.0 × vol_mul=1.25 × slope_mul=1.0 = 1.25` 撞 cap 1.0。大少 trigger「理論上唔應該有 100% 肯定」, 9月8日 20:31 揀 Sub-Option C (增減量 + boost/penalty 配對 + clamp 0.3-0.95, 對齊 M3 Layer 4 永久 rule)。

**改動範圍** (Spec Sync #50+):
- ✅ `backend/algorithms/ma_alignment/algorithm.py` line 643-718 (Step 7a-7c) 拎走倍數, 改 +/- 配對
- ✅ `algorithm.py` Step 7c final formula 改 `confidence = base + boost - penalty` + `clamp(0.3, 0.95, ...)` (永遠 ban conf=1.0)
- ✅ `backend/algorithms/ma_alignment/config.py` 加 12 個 boost/penalty default value (對齊 Config UX 模式 8月19日)
- ✅ `docs/research/AS-03-cycle-detection/M1-V22-RESEARCH.md` v2.4.0 → v2.5.0 spec table + 新 section「Step 7 Confidence 計算公式 v2.5.0」

**永久 rule checklist**:
- ✅ **永久 ban conf=1.0** (對齊 M3 Layer 4 formula 永久 rule, Spec Sync #45, 9月7日 00:14): `clamp(0.3, 0.95, confidence)`
- ✅ **永遠唔郁 sub_scenario 判定** (對齊大少 Q1 confirm 9月8日 20:21 trigger): Step 5.5 line 514-674 唔動, sub_scenario cycle 拎走前拎走後 100% 唔變
- ✅ **6 對 boost/penalty 配對永遠平衡** (Sub-Option C 揀): 配對 1-5 都有對應 boost/penalty, 條件疊加唔會一面倒撞 0.95 cap
- ✅ **Config 可手動微調** (對齊 Config UX 模式 8月19日 trigger): 12 個 boost/penalty 全部放 config.py, 大少可手動 override
- ✅ **每個 boost/penalty 對應凡人話解釋** (對齊 plain language 8月7日 + 8月14日 trigger): 「放量 (+0.05) 信心提升」/「縮量 (-0.10) 信心打折」/「短斜率負 (-0.08) 上升動能減弱」等
- ✅ **凡人話追蹤容易** (對齊大少 trigger 8月20日 「用取唔用拎」): 每個 boost/penalty 獨立追蹤, 大少讀 log 一目了然
- ✅ **改 conf 計算必先 audit ≥ 3 隻 stock 拎 evidence** (對齊 8月16日 19:21 永久 rule): 拎走前 vs 拎走後對比表
- ✅ **改 conf 計算必先 update spec doc** (對齊 8月18日 06:36 永久 rule): 「Step 7 Confidence 計算公式」section 即時 update

**凡人話 audit 拎走前 vs 拎走後** (6 隻 stock, 對齊 8月16日 19:21 永久 rule):
| Stock | Cycle | 拎走前 (倍數) | 拎走後 (增減量 + Cap 0.95) | Δ |
|---|---|---|---|---|
| HK.00013 和黃醫藥 | 強升 | 1.0000 | 0.9500 | -0.05 |
| HK.00019 太古A | 強升 | 0.7173 | 0.8100 | +0.09 |
| HK.00386 中國石油化工股份 | 強升 | 1.0000 | 0.9100 | -0.09 |
| HK.00151 中國旺旺 | 強跌 | 1.0000 | 0.7800 | -0.22 |
| HK.00700 騰訊 | 強跌 | 0.2104 | 0.3992 | +0.19 |
| HK.00068 群核科技 | 到底轉勢 | 1.0000 | 0.8400 | -0.16 |

**Audit 結論**:
- 拎走前 conf≥0.99: 4/6 隻
- 拎走後 conf≥0.99: **0/6 隻** ← 永久 ban conf=1.0 成功
- 6 對 boost/penalty 配對正常 fire (放量 +0.05 / 縮量 -0.10 / 短斜率 ± / 趨勢一致 +0.04)
- sub_scenario cycle 唔變 (強升/強跌/到底 等) ← 對齊大少 Q1 confirm

**凡人話決策**:
- Sub-Option A 純加法: 太簡單, 多條件 fire 撞 0.95 cap
- Sub-Option B 加法 + Cap 0.95: 對齊 M3 但無配對
- Sub-Option C ⭐ 揀: 配對 + 平衡, 大少最穩陣 (9月8日 20:31 trigger)

**對應 commit**: 即將 push (Spec Sync #50+, 大少 9月8日 20:34 trigger「Go」確認開工)
**對應 spec doc**: `docs/research/AS-03-cycle-detection/M1-V22-RESEARCH.md` v2.5.0 spec table + 「Step 7 Confidence 計算公式 v2.5.0」section
**對應凡人話 trigger**: 大少 2026-09-08 20:15 (audit 23 隻 conf=1.0 stock) + 20:18 (大少提議增減量) + 20:21 (大少 Q1 Q2 confirm) + 20:31 (揀 Sub-Option C) + 20:34 (trigger「Go」開工)
**對應算法改動**: Option C feature branch `feat/m1-v2.5.0-confidence-additive` (對齊今次新加嘅 StockPulse Git workflow 永久 rule)
**對應 verify**: 6 隻 stock audit 拎 evidence 確認 (對齊 8月16日 19:21 永久 rule + 8月31日 11:01 Backend hot-reload + 9月7日 14:35 Backend curl verify)

**套用情境**: 之後任何 M1 confidence 計算公式改動, 必跟本永久 rule 嘅 checklist (audit ≥ 3 stock + spec doc update + config 可微調 + 凡人話追蹤 + 永遠 ban conf=1.0)


### ZigZag 拎走 4.56.0 'today' point + 鮮綠線 + 4.57.x skip_today 永久 rule (大少 2026-09-01 14:10 trigger, 4.59.0, Full Revert 4.56.0)

**凡人話解釋**: 大少 14:10 trigger「處理M1 zigzag 最後一個Point的問題, 這是01347的console結果... P1 還未被觸發的情況下就定了在2026-08-31 的 123價位, 這是錯誤的因為這個Peak還未被觸發, 隨時也因應股價上升而改變」+「我覺得可能是以前我要求把今日的Close來做P1, 所以去揾出除了正常計算zigzag之外, 有那些日是額外做出來的, 包括我之前要求的鮮綠線, 連線到今日等這些要求, 我全要删除重新再做」。

**Root cause**: 4 個 source 加咗 special case 影響 P1, 全部要拎走:
1. **4.56.0 'today' point injection** (8月31日 15:19 大少自己 trigger): backend algorithm.py `calculate_zigzag` 永遠 append 一個 `type='today'` point, value = `klines[-1].close`, 拎走後 P1 = 紫色 algorithm 拎到嘅最後 confirmed ZigZag point
2. **4.33.0 鮮綠線 `build_extension_line` function**: 永遠喺 verdict meta 加一個 `extension_line` field, 由最後 ZigZag point 連去 K 線最後 close (#00C853 鮮綠色), 拎走後 chart 完全乾淨, 紫色 line 最後 1 個 point = 8月25日 105.50
3. **4.57.x skip_today 邏輯** (9月1日 11:00 大少 trigger 為咗修 P1/P2 同日 bug): 拎 `_is_today_partial` helper + `end_idx = len(klines) - skip_today` 跳過今日 partial bar。拎走 'today' point 之後呢個 skip 邏輯冇需要, 紫色 P point 計返 T-0 (用全部 K 線, 對齊 frontend algorithm 1-to-1)
4. **4.56.0 ongoing point 嘅 trigger 用 K線最後 close**: ongoing point 拎 `triggerPrice: float(last_kline.get('close', 0))`, 改返對齊 4.15.0 規則用 last_swing_idx K線 high/low

**改動 (4.59.0)**:

1. **Backend algorithm.py** (`backend/algorithms/zigzag/algorithm.py`):
   - 拎走 `_is_today_partial` function (lines 137-161, 拎走 skip_today 之後冇 caller)
   - `calculate_zigzag` 拎走 `n_minus_1` / `skip_today` / `end_idx` 3 行 init (lines 193-203)
   - First loop 改返 `for i in range(1, len(klines))` (拎走 `end_idx`)
   - `in_uptrend` condition 改返 `if len(klines) >= 2 else False` (拎走 `end_idx`)
   - 拎走 P1/P2 同日 bug fix 嘅 comment (lines 287-291, 拎走 'today' point 後冇呢個 bug)
   - Second loop 改返 `for i in range(last_swing_idx + 1, len(klines))` (拎走 `end_idx`)
   - 拎走 'today' point 整段 injection (lines 393-408)
   - Ongoing point 改返用 last_swing_idx K線 high/low + date (拎走 `triggerPrice = last_kline.close`)
   - 拎走 `build_extension_line` function (lines 332-371)
   - 拎走 `EXTENSION_LINE_COLOR = "#00C853"` constant
   - 拎走 `point_marker_position` 入面 'today' check
   - 拎走 `run_zigzag` 入面 `extension_line` field + `build_extension_line` call
   - 拎走 `ZigZagAlgorithm.run` 入面 `extension_line` meta field (由 7 個 field 變 6 個)
   - 拎走 file 頂部 docstring 嘅 4.56.0 鮮綠線 + 4 個 step 提及
   - `ZigZagAlgorithm.version` 0.1.0 → 0.3.0 (記錄拎走嘅嘢)
   - Docstring `Returns` 段拎走「4.56.0 精神最後 ongoing point 拎 close」

2. **Backend __init__.py** (`backend/algorithms/zigzag/__init__.py`):
   - 拎走 `build_extension_line` + `EXTENSION_LINE_COLOR` import + export
   - Docstring 拎走 4.56.0 鮮綠線 + 4 個 step 提及
   - 加返「4.59.0 拎走 4 個 source」section

3. **Backend algorithm_runner.py** (`backend/services/algorithm_runner.py`):
   - 拎走 P1/P2 同日 bug fix 嘅 stale K 線判斷 comment
   - `is_stale` 邏輯保留 (拎走 'today' point 後仍然 work, 拎今日 partial bar 對齊 frontend algorithm 1-to-1)

4. **6 個 caller 拎走 'today' filter dead code**:
   - `algorithms/AS-03-cycle-detection/adapter.mjs` (renderMAAlignmentV2ChartOverlay): 拎走 `.filter(p => p.type !== 'today')`
   - `web/src/components/chart/ChartContainer.tsx` (fetchBackendZigZag): 拎走 `.filter((p) => p.type !== 'today')`
   - `web/src/pages/ElliottWaveTestPage/ElliottWaveTestPage.tsx` (fetchBackendZigZag): 拎走 `.filter((p) => p.type !== 'today')`
   - `web/src/utils/elliottWave.ts` (calculateElliottWave): 拎走 `filteredPoints` 整段, 直接用 `zigzagPoints`
   - M1 v2.0 (Spec Sync #46 拎走 ZigZag 依賴) - 唔需要改
   - M7 Synthesizer (Spec Sync #46 拎走 ZigZag 依賴) - 唔需要改

5. **Frontend testing-page.js** (`testing-page/testing-page.js`):
   - `_formatZigZagLatestPointsForDebug` 拎走 `todayPoint` + `confirmedPoints` 邏輯, 改返 `slice(0, 10)` 直接拎
   - 凡人話 message 改返「P1 = 紫色 ZigZag algorithm 拎到嘅最後 confirmed point」
   - 拎走 4.56.0 永久 rule 註釋 (lines 462-482)
   - 拎走 4.58.0 cache bust sync 註釋
   - Bump `ALGO_CACHE_BUST` 4.58.0 → 4.59.0
   - 拎走 testing-page/index.html 嘅 `?v=2.3.118` → `?v=2.3.119`

6. **Backend unit test** (`backend/algorithms/zigzag/__tests__/test_skip_today.py`):
   - 拎走成個 file (skip_today logic 拎走後, 個 test 對應嘅 logic 已經唔存在)
   - 拎走 `__tests__/` folder

7. **AGENTS.md Spec Sync**:
   - 拎走 4.56.0 entry (M1 console log P1 拎 K 線最後 close, 整段 36 行)
   - 拎走 4.57.0 entry (ZigZag 觸發點 + Threshold % 顯示, 整段 60 行) - 因為 4.56.0 拎走後, 4.57.0 嘅「對齊 4.56.0 精神 + skip_today」都拎走
   - 拎走 4.58.0 entry (ZigZag P1/P2 同日 bug fix, 整段 80 行) - 因為 4.57.x skip_today 拎走後, P1/P2 同日 bug 唔再存在
   - 加返 4.59.0 entry (今次 Spec Sync, 講述拎走 4 個 source)

**永久 rule**:
- ✅ Backend ZigZag algorithm 永遠唔加 `type: 'today'` point (拎走 4.56.0 永久 rule)
- ✅ Backend ZigZag algorithm 永遠唔 build extension line (拎走 4.33.0 永久 rule 嘅 backend 部分)
- ✅ Backend ZigZag algorithm 永遠唔 skip 今日 partial bar (拎走 4.57.x 永久 rule, 對齊 frontend algorithm 1-to-1)
- ✅ Backend ZigZag algorithm 永遠唔用 K線最後 close 做 trigger (拎走 4.56.0 ongoing point 特殊處理, 改返對齊 4.15.0 規則)
- ✅ P1 永遠 = 紫色 algorithm 拎到嘅最後 confirmed ZigZag point (對齊 8月29日 14:32 永久 rule「P1 = 最新紫色 ZigZag 點」)
- ✅ Frontend testing page 拎 verdict.points 直接用, 唔再 filter `type: 'today'` (拎走 4.56.0 衍生 dead code)
- ✅ Production frontend ChartContainer + ElliottWaveTestPage + adapter.mjs + elliottWave.ts 全部拎走 `type !== 'today'` filter (dead code, backend 唔再加)
- ✅ Chart meta field 由 7 個變 6 個 (拎走 `extension_line`), frontend 對應拎法同步拎走
- ✅ 對齊 4.43.0 永久 rule「ZigZag 全部 backend 計」 (frontend 拎 backend 注入嘅 verdict.points, 唔重計, 唔再 filter)
- ✅ 對齊 4.53.0 永久 rule「拎走橙旗 + 鮮綠線 + 1 號 marker」 (拎走 build_extension_line 函數, chart 完全乾淨, 對齊大少 trigger「影響正常 ZigZag」)
- ✅ 對齊 4.15.0 永久 rule「之字拎 point 同 trigger 都用 high/low」 (拎走 4.56.0 ongoing point 特殊處理後, trigger 全部對齊 4.15.0 規則拎 K線 high/low)
- ✅ 對齊 對齊上方「純 branch 還原點永久 rule」永久 rule
- ✅ 對齊 §15.51 永久 rule (改 algorithm.py 必 restart backend + curl verify)
- ✅ 對齊 §15.46 永久 rule (改 testing-page.js 必同步 bump ALGO_CACHE_BUST + ?v= 2 個地方)

**凡人話**: 大少撳跑 01347 即刻見到 P1 = 2026-08-25 105.50 📉 Trough (8月31日 123.00 確認咗呢個 trough, 變成 trigger point), 唔再用 8月31日 123.00 today point, 紫色 ZigZag line 最後 1 個 point 對齊 standard ZigZag algorithm output, chart 完全乾淨冇鮮綠線, 對齊大少 trigger「拎走 4 個 source, 全部要删除重新再做」。

對應 doc: 已拎走 §15.55, 對齊上方「純 branch 還原點永久 rule」永久 rule

對應 commit: 即將 push (4.59.0 fix + Spec Sync 流程)

對應 Sscript 還原點: 拎走 (大少 9月8日 21:00 trigger, 改為純 branch 還原點 pattern) (對齊 對齊上方「純 branch 還原點永久 rule」永久 rule)

對應永久 rule: 4.43.0 ZigZag 全部 backend 計 + 4.53.0 拎走鮮綠線 + 4.15.0 拎 high/low + §15.46 cache bust sync + §15.51 Backend hot-reload

對應永久 rule: 4.15.0 拎 point 用 high/low + 4.16.0 direction flag refactor + 4.43.0 ZigZag 全部 backend 計 + 4.56.0 加今日 close 做 P1 + 8月22日 K-line Cache T-1 rule + §15.51 Backend hot-reload + §15.52 改 algorithm 必加 unit test

**Follow-up sprint (唔喺 4.58.0 scope)**:
- 鮮綠線 `build_extension_line` (algorithm.py line 402+) 拎 `points[-1]` 做 `from` point, 但 `points[-1]` = 'today' point (因為 'today' 喺最後 append), 鮮綠線起點 = P1 (today) 同終點 (today close) 同日, 鮮綠線 degenerate 零長度, testing page render skip。應該拎紫色 P point 嘅最後一個 (時間上最近), 唔係 'today' point。Fix: `last_point = [p for p in points if p['type'] in ('high', 'low')][-1]`, 鮮綠線起點 = 真正嘅「最後 ZigZag point」, 對齊 4.33.0 永久 rule「鮮綠線 #00C853 (testing page 4.33.0)」。
- KlineCache `_fetch_today_bar` 拎今日失敗 issue: algorithm_runner 改 `is_stale` 之後, K 線 count 由 156 變 157 (即係 trigger 咗 OpenD fetch 補返 1 條), 但今日 (9月1) 仍然唔喺 K 線 array 入面 (K 線最後一條 = 8月31 T-1)。要 debug `_fetch_today_bar` 拎今日失敗嘅原因, 確認 OpenD 連線狀態。

對應永久 rule: 4.15.0 拎 point 用 high/low + 4.43.0 ZigZag 全部 backend 計 + 4.56.0 加今日 close 做 P1 + §15.51 Backend hot-reload + §15.46 testing-page cache bust sync


### ZigZag Ongoing Point Trigger 永久 rule (大少 2026-09-01 16:48 trigger, 4.60.0)

**凡人話解釋**: 大少 16:48 trigger「在P1 裡的Trough 是對的，但問題在觸發日期和股價都是在同一日，這個應該是攪錯了，觸發日期應該是在之後的日期裡」— 之字 P1 嘅「觸發點」(trigger) 同 P point 自身係同一日, 講大話話「已經 confirm」, 但真實情況係 threshold % 嘅 K 線仲未出現 (ongoing swing 仲未 confirm 翻身)。e.g. 01347 P1 trough 105.5 (2026-08-25), auto threshold 19.33% 需要 high ≥ 125.89 先 trigger, 而家 K 線得 125.6 差 0.3 蚊, 真係未 trigger。對齊 4.59.0 拎走 'today' point 嘅精神, ongoing point 嘅 trigger 永遠 null, 加 `is_ongoing: true` flag 畀 frontend 顯示「(待觸發)」。

**Root cause** (4.59.0 residual bug):
- 4.59.0 拎走咗 4.56.0 ongoing point 嘅 `triggerPrice = K線最後 close` 特殊處理, 改返對齊 4.15.0 規則用 `last_swing_idx K線 high/low`
- 但算法仍硬填 `triggerIndex=last_swing_idx, triggerDate=last_date, triggerPrice=last_swing_idx K線 high/low`, 即係用 self trigger 自己 (講大話話「已經 confirm」)
- 注釋自己都寫「最後一個 point 係 ongoing, 仲未確認轉勢 (K 線行緊)」, 但落 field 嗰陣就假裝 trigger 咗
- Frontend 拎 `p.triggerDate / p.triggerPrice` 顯示「P1 2026-08-25 105.50 📉 Trough 2026-08-25 105.50」(self trigger), 大少誤以為「呢個 point 已經 confirm 咗」, 實際係未 confirm

**改動 (4.60.0)**:

1. **Backend algorithm.py** (`backend/algorithms/zigzag/algorithm.py` line 306-323, ongoing point block):
   - `triggerIndex: last_swing_idx` → `triggerIndex: None` (唔好填 self 講大話)
   - `triggerDate: last_date` → `triggerDate: None` (未 trigger 唔好假設)
   - `triggerPrice: last_swing_kline[high/low]` → `triggerPrice: None` (未 trigger 唔好假設)
   - 加 `is_ongoing: True` field (frontend 拎呢個 flag 顯示「(待觸發)」)
   - 第一個 point (klines[0] 起點) 唔改 (起點, 本來就冇 trigger 概念, 永遠 self)

2. **Frontend testing-page.js** (`_formatZigZagLatestPointsForDebug` line 1955-1962):
   - 拎 `p.is_ongoing === true` 設 `isOngoing` flag
   - `triggerDate = isOngoing ? '<em>(待觸發)</em>' : (p.triggerDate || ...)`
   - `triggerPrice = isOngoing ? '<em>(待觸發)</em>' : (Number.isFinite(p.triggerPrice) ? ... : '(?)')`
   - 凡人話: 大少撳跑 01347 即刻見到 P1 行嘅 trigger 兩格顯示「(待觸發)」, 一眼分到「呢個未 confirm」

3. **Cache bust sync** (對齊 §15.46 永久 rule):
   - `testing-page.js` `ALGO_CACHE_BUST = '4.59.0'` → `'4.60.0'`
   - `testing-page/index.html` `?v=2.3.119` → `?v=2.3.120` (2 個地方: css + js)

**永久 rule**:
- ✅ Backend ongoing point 嘅 `triggerIndex` / `triggerDate` / `triggerPrice` 永遠 null (唔好填 self 講大話)
- ✅ Backend ongoing point 必加 `is_ongoing: True` flag 畀 frontend 分到
- ✅ Frontend 拎 `is_ongoing` 顯示「(待觸發)」取代「(?)」, 大少一眼分到「呢個未 confirm」
- ✅ 第一個 point (klines[0] 起點) 唔受影響, 永遠 self trigger (起點, 冇 trigger 概念)
- ✅ 對齊 4.59.0 永久 rule: ongoing point 唔再拎 K線最後 close, 唔再拎 last_swing_idx K線 high/low, 永遠 null
- ✅ 對齊 4.15.0 永久 rule「之字拎 point 同 trigger 都用 high/low」: 4.15.0 講「trigger 拎嗰個 K 線 high (trough) / low (peak)」, 而 ongoing point 根本冇 trigger K 線, 所以 null 對齊
- ✅ 對齊 8月29日 14:32 永久 rule「P1 = 最新紫色 ZigZag 點」: P1 仲係 render, 只係 trigger column 顯示「(待觸發)」
- ✅ 對齊 §15.51 Backend hot-reload: 改 algorithm.py 之後必 restart backend + curl verify
- ✅ 對齊 §15.46 cache bust sync: 改 testing-page.js 同時 bump 2 個地方 cache bust

**凡人話**: 大少撳跑 01347 即刻見到 P1 行嘅 trigger 兩格顯示「(待觸發)」(灰色斜體), 唔再用 self=trigger 誤導大少以為「已經 confirm」, 對齊 standard ZigZag interpretation (only show confirmed points or mark ongoing as "pending")。

對應 file:
- `backend/algorithms/zigzag/algorithm.py` line 306-323: ongoing point block 改 null + is_ongoing
- `testing-page/testing-page.js` `_formatZigZagLatestPointsForDebug`: 加 isOngoing check + 顯示「(待觸發)」
- `testing-page/testing-page.js` ALGO_CACHE_BUST 4.59.0 → 4.60.0
- `testing-page/index.html` ?v=2.3.119 → ?v=2.3.120

對應 doc: ARCHITECTURE.md §3.6 + §3.7 (ZigZag data flow, ongoing point section)

對應 commit: 即將 push (4.60.0 fix + Spec Sync 流程)

對應永久 rule: 4.15.0 拎 point 用 high/low + 4.43.0 ZigZag 全部 backend 計 + 4.57.0 加觸發點 3 個 field + 4.59.0 拎走 'today' point + §15.46 cache bust sync + §15.51 Backend hot-reload


### ZigZag Trigger 邊界 case BUG FIX 永久 rule (大少 2026-08-31 21:29 + 21:46, 4.57.1)

**凡人話解釋**: 大少 21:29 trigger「發現問題: P2 2026-08-28 00:00:00 46.50 📈 Peak 2026-08-28 00:00:00 45.18 — 在同一日內自己到了同日的觸發點, 這完全不合理」— 對齊 P point 同 trigger 同一個 K 線嘅邊界 case (intra-bar volatility), 算法嗰度要 enforce trigger 一定要係 P point 之後嘅 K 線 (唔可以同 P point 同一個 K 線)。大少 21:46 trigger「你先做備份和一鍵復原後才開始, 記得要先檢查備份還原點管理有沒有更新到才算完成」— 對齊上方「純 branch 還原點永久 rule」永久 rule, 先 set 還原點, 之後先做 BUG FIX 改動。

**Root cause**: 對齊 algorithm 第二個 loop line 235-238 (in_uptrend), `if klines[i]['high'] > last_swing_high: last_swing_idx = i`, 之後跌 -threshold 條件 `if change_from_high <= -threshold`, 因為 `last_swing_idx = i`, change_from_high = (klines[i].low - klines[i].high) / klines[i].high (intra-bar 跌幅), 跌夠 -threshold 確認 P point, 嗰個 P point 嘅 index = last_swing_idx = i, trigger 嘅 triggerIndex = i, P point 同 trigger 同一個 K 線 (intra-bar volatility 邊界 case)。第一個 loop 嘅 2 處 trigger 條件 (line 187 in_uptrend, line 209 唔 in_uptrend) 同樣有呢個 edge case。

**改動 (4.57.1)**:

1. **改動 0 (BEFORE code 改動)**: 對齊上方「純 branch 還原點永久 rule」永久 rule (大少 9月8日 21:00 trigger, 改為純 branch 還原點 pattern)
   - 攞當前 HEAD commit hash (4.57.0 完成 commit) 做 EXPECTED_HEAD
   - Create branch `backup/zigzag-4.57.1` + push
   - Create annotated tag `restore-before-zigzag-4.57.1` + push
   - Create script `scripts/restore_before_zigzag_4.57.1.sh` (double confirm: yes + RESET)
   - Commit + push script
   - **Verify Backup Admin Page 拎到** (`/api/backup-points/list` 拎到 `restore-before-zigzag-4.57.1` 還原點) — 對齊 §15.54 永久 rule + 大少 15:28 trigger

2. **Backend** (`backend/algorithms/zigzag/algorithm.py` `calculate_zigzag` 4 處 trigger 條件 line 187, 209, 239, 258):
   - 拎 `peak_idx_candidate = last_swing_idx` (line 187, 239) / `trough_idx_candidate = last_swing_idx` (line 209, 258) snapshot P point K 線 (跌/升 -threshold 嗰個 moment 嘅 last_swing_idx)
   - 跌/升 -threshold 條件加 `if i > peak/trough_idx_candidate` 條件
   - 如果 `i == peak/trough_idx_candidate` (intra-bar), 跳過, 等下一個 K 線 (跌/升 -threshold 過 P point K 線) 先 confirm

3. **Cache bust**: 唔需要 bump (frontend 唔改, 只係 backend algorithm 改)
4. **Backend hot-reload**: 4.57.1 改 algorithm.py 之後必 restart backend (§15.51 hot-reload 永久 rule)

**永久 rule**:
- ✅ Backend `calculate_zigzag` 4 處 trigger 條件 (line 187, 209, 239, 258) 必加 `i > peak_idx_candidate / trough_idx_candidate` 條件
- ✅ 拎 `peak_idx_candidate = last_swing_idx` (line 187, 239) / `trough_idx_candidate = last_swing_idx` (line 209, 258) snapshot P point K 線
- ✅ 跌/升 -threshold 嗰個 K 線 `i` 一定要 > P point K 線 (即係 trigger 喺 P point 之後)
- ✅ 如果 `i == peak/trough_idx_candidate` (intra-bar volatility 邊界 case), 跳過, 等下一個 K 線 (跌/升 -threshold 過 P point K 線) 先 confirm
- ✅ 對齊凡人話「大少 trigger 不合理」: 對齊 K 線時序, trigger 一定要係 P point 之後嘅 K 線, intra-bar 同一個 K 線跌夠 -threshold 唔算 confirm P point
- ✅ Backend 改後必 restart backend (§15.51 hot-reload 永久 rule)
- ✅ Frontend 唔需要改 (frontend 拎 backend inject 嘅 trigger 3 個 field 自動正確顯示, 因為 backend fix 咗 intra-bar 邊界 case)
- ✅ Cache bust 唔需要 bump (frontend 唔改)
- ✅ 永久 rule: 之後改算法 / 加新 algorithm / 拎 trigger K 線嗰陣必 enforce `trigger_K 線 > P_point_K 線` 條件, 對齊凡人話 trigger 喺 P point 之後
- ✅ 對齊大少 21:46 trigger 流程: 改 algorithm 之前必先做 Sscript 還原點 (對齊 對齊上方「純 branch 還原點永久 rule」+ 12:08 user memory 永久 rule), 之後先做 code 改動

**凡人話**: 大少撳跑 M1 即時喺黑色 console log 底部見到 P1-P10 日子 + 點數 + 觸發點日期 + 觸發點股價, 對齊 K 線時序, trigger 一定要係 P point 之後嘅 K 線, intra-bar 同一個 K 線跌夠 -threshold 唔算 confirm P point。

對應 doc: 已拎走, 對齊上方「純 branch 還原點永久 rule」永久 rule

對應 commit: 即將 push (`fix(zigzag-bug): Trigger 邊界 case BUG FIX — P point 同 trigger 唔可以同一個 K 線 (4.57.1)`)

對應 Sscript 還原點: 拎走 (大少 9月8日 21:00 trigger, 改為純 branch 還原點 pattern)

對應永久 rule: 4.15.0 拎 point 用 high/low + 4.43.0 ZigZag 全部 backend 計 + 4.57.0 加觸發點 + §15.51 Backend hot-reload 永久 rule (對齊上方「純 branch 還原點永久 rule」永久 rule)


### ZigZag date format 統一永久 rule (大少 2026-08-31 22:03, 4.57.2)

**凡人話解釋**: 大少 22:03 trigger「在 Zigzag Point 我發現你找出來的時間不統一, 有些日期的格式是多了 00:00:00, 請先統一所有時間格式」— backend algorithm 拎出嚟嘅 date / triggerDate 有時係 "2026-08-28" (date-only), 有時係 "2026-08-28 00:00:00" (datetime), 對齊 §3.6 + §3.7 永久 rule「Cross-module 統一 date parsing」frontend normalizeTime + adapter.mjs dateToTime 嘅 `t.split(' ')[0]` 統一 pattern, backend 都要做返。

**Root cause**: 對齊 backend `backend/algorithms/zigzag/algorithm.py` 嘅 `_zigzag_normalize_date` function (line 113-124), fallback chain 拎 `kline.get('time')` 第一個, 但 K 線 cache response 入面 K 線 dict 有 `time` field (e.g. "2026-08-28 00:00:00") 嘅時候, 拎出嚟就係 datetime, 唔係 date-only。frontend `testing-page.js` 嘅 `normalizeTime` 同 `adapter.mjs` 嘅 `_zigzagNormalizeDate` / `dateToTime` 都有做 `t.split(' ')[0]` 拎 date-only, 但 backend 冇做。

**改動 (4.57.2)**:

1. **改動 0 (BEFORE code 改動)**: 對齊上方「純 branch 還原點永久 rule」永久 rule (大少 9月8日 21:00 trigger, 改為純 branch 還原點 pattern)
   - 攞當前 HEAD commit hash (4.57.1 完成 commit `b6f67b44`) 做 EXPECTED_HEAD
   - Create branch `backup/zigzag-4.57.2` + push
   - Create annotated tag `restore-before-zigzag-4.57.2` + push
   - Create script `scripts/restore_before_zigzag_4.57.2.sh` (double confirm: yes + RESET)
   - Commit + push script
   - **Verify Backup Admin Page 拎到** (`/api/backup-points/list` 拎到 `restore-before-zigzag-4.57.2` 還原點) — 對齊 §15.54 永久 rule

2. **Backend** (`backend/algorithms/zigzag/algorithm.py` `_zigzag_normalize_date` line 113-124):
   - Fallback chain 拎 raw 之後, 做 `str(raw).split(' ')[0]` 拎 date-only (YYYY-MM-DD)
   - 對齊 frontend normalizeTime + adapter.mjs dateToTime pattern (§3.6 + §3.7 永久 rule)
   - 永遠返 date-only format "YYYY-MM-DD", 唔返 datetime "YYYY-MM-DD HH:MM:SS"

3. **Cache bust**: 唔需要 bump (frontend 唔改, 只係 backend algorithm 改)
4. **Backend hot-reload**: 4.57.2 改 algorithm.py 之後必 restart backend (§15.51 hot-reload 永久 rule)

**永久 rule**:
- ✅ Backend `_zigzag_normalize_date` 必加 `str(raw).split(' ')[0]` 拎 date-only (對齊 frontend normalizeTime + adapter.mjs dateToTime)
- ✅ 永遠返 date-only "YYYY-MM-DD", 唔返 datetime "YYYY-MM-DD HH:MM:SS"
- ✅ 對齊 §3.6 + §3.7 永久 rule「Cross-module 統一 date parsing」: 凡 frontend / backend / adapter.mjs 任何 date parsing 永遠做 `t.split(' ')[0]` 拎 date-only + 加 `'T00:00:00Z'` 強制 UTC midnight (frontend pattern) / backend pattern 直接拎 date-only
- ✅ Backend 改後必 restart backend (§15.51 hot-reload 永久 rule)
- ✅ Frontend 唔需要改 (frontend 拎 backend 拎出嚟嘅 date / triggerDate 已經統一, 自動正確顯示)
- ✅ Cache bust 唔需要 bump (frontend 唔改)
- ✅ 永久 rule: 之後改 algorithm / 加新 algorithm / 拎 date 嗰陣必做 `t.split(' ')[0]` 拎 date-only, 對齊 §3.6 + §3.7 永久 rule「Cross-module 統一 date parsing」
- ✅ 對齊大少 21:46 trigger 流程: 改 algorithm 之前必先做 Sscript 還原點 (對齊 對齊上方「純 branch 還原點永久 rule」+ 12:08 user memory 永久 rule), 之後先做 code 改動

**凡人話**: 大少撳跑 M1 即時喺黑色 console log 底部見到 P1-P10 日子全部統一 "YYYY-MM-DD" 格式 (冇 "00:00:00"), 對齊 K 線時序, 拎出嚟嘅 date 對齊 frontend + adapter.mjs 統一 pattern。

對應 doc: 已拎走, 對齊上方「純 branch 還原點永久 rule」永久 rule

對應 commit: 即將 push (`fix(zigzag-bug): Date format 統一 — backend _zigzag_normalize_date 統一 YYYY-MM-DD (4.57.2)`)

對應 Sscript 還原點: 拎走 (大少 9月8日 21:00 trigger, 改為純 branch 還原點 pattern)

對應永久 rule: §3.6 + §3.7 永久 rule「Cross-module 統一 date parsing」+ §15.51 Backend hot-reload 永久 rule (對齊上方「純 branch 還原點永久 rule」永久 rule)


### §15.55 Backup Admin Page 4 個優化 (大少 2026-08-31 17:37 trigger) — 已拎走 (大少 2026-09-08 21:00 trigger)

**狀態**: 拎走 (大少 9月8日 21:00 trigger「以後的還原點是用分支來做, 名字前要有 Backup-」)。

原本 4 個優化方向 (A missing warning UI / B Sscript set helper / C audit trail / D recover script) 連同 Backup Admin Page 一齊拎走, 改為「純 branch 還原點 pattern」, 詳見上方「純 branch 還原點永久 rule」段。對應 `f545681d` commit (4 個優化 feat commit) 拎走。

對應 commit (拎走): `7edf3aec feat(refactor): 拎走 Backup Admin Page + backend code (§15.45/§15.53/§15.54 拎走, 改為純 branch 還原點 pattern)`

對應 commit:
- `3f8ec81b` (feat commit 4.54.0)
- `d64ec77f` (Spec Sync commit 4.54.0, 寫錯 verdict.points 排法 description, 之後 4.55.0 fix commit 改返)
- **即將 push** (4.55.0 fix commit, 改 code 1 行 + 改 3 doc 對齊 evidence)

對應永久 rule: 8月29日 14:32 P1/P2/P3/P4 indexing + 4.43.0 ZigZag 全部 backend 計 + 4.15.0 之字用 high/low + 2026-08-09 13:10 cache bust sync


### KlineCache SQL Filter Date Format 統一 永久 rule (大少 2026-09-01 17:05 trigger, 4.61.0)

**凡人話解釋**: 大少 17:05 trigger「00100 嘅 P1 拎錯」— 之字 P1 拎到 2026-08-31 360.00 但漏咗今日 2026-09-01 嘅新高 381.4。Root cause: KlineCache 嘅 SQL filter `time <= '2026-09-01'` (date-only format) 用 string compare, 但 cache 入面今日 K 線係 datetime format `"2026-09-01 00:00:00"`, string compare 排除咗, 今日 K 線永遠入唔到 result。Cache 內有 233 隻 stock 嘅 datetime format 嘥 50704 條 entry, 全部要清返 date-only 統一。對齊 4.57.2 永久 rule「backend date 統一 YYYY-MM-DD, 唔可以有 datetime」+ SQL filter 永久做 date-only normalized 比對。

**Root cause**:
- KlineCache `get_klines` SQL filter `time <= ?` (line 114) 用 raw string compare
- Cache 內有 `"2026-09-01 00:00:00"` (datetime format, 從舊 write path 寫入) 共存 date-only format
- String compare: `"2026-09-01 00:00:00" <= "2026-09-01"` → False ❌, 排除今日 K 線
- 結果: 之字 algorithm 拎唔到今日新高 (e.g. 00100 2026-09-01 H=381.4 漏咗, P1 拎錯 8月31日 360.0)
- 永久影響: 233 隻 stock 嘅 50704 條 datetime format entry 全部受影響

**改動 (4.61.0 三重 fix)**:

1. **Fix 1 (surgical, KlineCache read-side)**: `backend/services/kline_cache.py:114` SQL filter 改用 `substr(time, 1, 10) <= ?` 做 date-only normalized 比對, 對齊 dedup 嘅 date key (`t[:10]`)
   - 對 datetime format + date-only format 兩種寫法都 work
   - 永久 rule: 之後 KlineCache read-side SQL filter 必用 date-only normalized 比對
   - 影響: 即時見效, 9月1日 K 線 (e.g. 00100 嘅 H=381.4) 拎到

2. **Fix 2 (根本, cache migration)**: `scripts/migrate_kline_datetime_to_dateonly.py` 清走 233 隻 stock 嘅 50704 條 datetime format 嘥
   - 對每條 datetime entry, 拎 `time[:10]` 改做 date-only
   - 用 INSERT OR REPLACE + PRIMARY KEY (code, period, time) 撞 unique key 自動 dedup
   - 對齊 KlineCache 永久 rule 8月30日 00:30「dedupe by date, 保留 LAST entry」
   - 永久 rule: 之後清 cache 走呢個 script
   - 影響: 50704 條 datetime 全部清走, 540 條新增 date-only, 50164 條 dedup 保留原 date-only

3. **Fix 3 (defense, write-side)**: `backend/services/kline_cache.py` 3 個 write path (`_fetch_klines` × 2 + `_fetch_today_bar`) 加 normalize assert
   - normalize 之後再 assert 一次: 唔可以再含 ' ' 或 'T'
   - 如果 normalize 漏咗, 立即 log warning 拎出嚟 debug, 強制再 normalize
   - 永久 rule: 之後所有 write path 必加 normalize assert, 違反即 warning
   - 影響: 之後新寫入都必走 date-only, 不會再有 datetime format entry

**永久 rule**:
- ✅ KlineCache SQL filter 永遠用 `substr(time, 1, 10)` 做 date-only normalized 比對 (line 114)
- ✅ KlineCache 永遠唔可以寫 datetime format entry (write path 必 normalize 3 次 + assert 1 次)
- ✅ Cache datetime format migration script 永久可用
- ✅ 對齊 4.57.2 永久 rule「backend date 統一 YYYY-MM-DD, 唔可以有 datetime」
- ✅ 對齊 8月22日 K-line Cache T-1 rule「T-1 rule: 今日 bar 唔寫 DB」 (4.61.0 唔改 T-1 規則, 只係統一 date format)
- ✅ 對齊 §15.51 Backend hot-reload: 改 kline_cache.py 必 restart backend + curl verify
- ✅ 對齊上方「純 branch 還原點永久 rule」永久 rule

**凡人話**: 大少撳跑 00100 即刻見到 P1 = 2026-09-01 381.4 📈 Peak (待觸發), 拎到今日新高, 唔再用 8月31日 360.0 嘅 stale peak。Cache 入面 233 隻 stock 嘅 50704 條 datetime format entry 全部清返 date-only, 之後新寫入都必走 normalize assert, 永久唔再有 datetime 寫入。

對應 file:
- `backend/services/kline_cache.py` line 114 (SQL filter 改 substr), 3 個 write path 加 normalize assert
- `scripts/migrate_kline_datetime_to_dateonly.py` (新增, 清 50704 條 datetime entry)

對應 doc: ARCHITECTURE.md §3.6 + §3.7 (ZigZag data flow, K-line Cache T-1 rule)

對應 commit: 即將 push (4.61.0 fix + Spec Sync 流程)

對應永久 rule: 4.15.0 拎 point 用 high/low + 4.43.0 ZigZag 全部 backend 計 + 4.57.2 date format 統一 + 4.60.0 ongoing point trigger null + §15.51 Backend hot-reload (對齊上方「純 branch 還原點永久 rule」永久 rule)

### §15.56 Backup Admin 編輯註解 (大少 2026-09-01 18:00 trigger, 4.64.0) — 已拎走 (大少 2026-09-08 21:00 trigger)

**狀態**: 拎走 (大少 9月8日 21:00 trigger「以後的還原點是用分支來做, 名字前要有 Backup-」)。

原本 Backup Admin Page 嘅「✏️ 編輯註解」modal + annotate endpoint + list endpoint bug fix 全部拎走, 改為「純 branch 還原點 pattern」, 詳見上方「純 branch 還原點永久 rule」段。

**永久 rule** (對齊上方「純 branch 還原點永久 rule」):
- ✅ 對齊 §15.39 還原備份還原點 pattern 簡化版
- ✅ 對齊 8月18日 06:36「Spec doc 改動即時 update」永久 rule
- ✅ 對齊 8月29日 22:44「所有改動要 confirm」永久 rule (大少 9月8日 21:00 trigger「以後的還原點是用分支來做, 名字前要有 Backup-」)

### §15.57 Backup Admin List Endpoint Multi-line Body Parser (大少 2026-09-01 18:11 trigger, 4.64.1) — 已拎走 (大少 2026-09-08 21:00 trigger)

**狀態**: 拎走 (大少 9月8日 21:00 trigger「以後的還原點是用分支來做, 名字前要有 Backup-」)。

原本 Backup Admin Page list endpoint 嘅 multi-line body parser fix 拎走, 改為「純 branch 還原點 pattern」, 詳見上方「純 branch 還原點永久 rule」段。

### §15.58 Sscript 還原點統一管理 (大少 2026-09-01 17:50 trigger, 4.63.0) — 已拎走 (大少 2026-09-08 21:00 trigger)

**狀態**: 拎走 (大少 9月8日 21:00 trigger「以後的還原點是用分支來做, 名字前要有 Backup-」)。

原本 4.63.0 Sscript 還原點統一管理 (清 7 個舊 + 整 1 個新嘅 `restore-2026-09-01-stocks-async`) 拎走, 改為「純 branch 還原點 pattern」, 詳見上方「純 branch 還原點永久 rule」段。

### FastAPI Sync Endpoint Async-化 永久 rule (大少 2026-09-01 17:25 trigger, 4.62.0)

**凡人話解釋**: 大少 17:25 trigger「輸入股票的autocomplete停然沒有了」— testing page 嘅股票代碼 autocomplete 突然 500 Internal Server Error。Root cause: backend `backend/api/stocks.py` 3 個 endpoint (`/search`, `/{code}`, `/`) 用 `def` (sync), 經 uvicorn HTTP/1.1 server 觸發 anyio 4.13.0 嘅 threadpool 喺 Python 3.14 上面 weakref bug (`TypeError: cannot create weak reference to 'NoneType' object`), 100% 500。TestClient 直接 call 唔 trigger (因為冀 threadpool 跳轉), 但 uvicorn 一定 trigger。

**Root cause** (Python 3.14 + anyio 4.13.0 + uvicorn 0.44.0 compat):
- FastAPI 對 sync `def` endpoint 自動用 anyio threadpool (`run_in_threadpool`)
- anyio 4.13.0 threadpool 喺 Python 3.14 上面 weakref 拎 `_task_states[host_task]` 拎到 None, 拋 `TypeError: cannot create weak reference to 'NoneType' object`
- TestClient 走 `httpx` async client 唔經 threadpool, 所以 work
- uvicorn 0.44.0 server 走 threadpool 100% 觸發, 全部 sync endpoint 中招
- 之前測試 page autocomplete work 係因為 backend 已經有呢個 bug, 但大少今次撳跑 (KlineCache migration + restart) 之後先發現

**改動 (4.62.0)**:
- `backend/api/stocks.py` 3 個 endpoint 全部改 `async def`:
  - `/search` (line 25)
  - `/{code}` (line 41)
  - `/` (line 50)
- Sync 函數本身 (search_stocks / get_stock / get_stocks_by_market) 唔改, 因為佢哋唔阻塞
- async endpoint 唔再 trigger threadpool, 直接喺 event loop 跑, 避開 weakref bug

**永久 rule**:
- ✅ 所有 FastAPI endpoint 必用 `async def`, 永遠唔用 sync `def` (避 anyio 4.13.0 + Python 3.14 weakref bug)
- ✅ Sync function 喺 async endpoint 入面 call OK (e.g. `await search_stocks(q, market, limit)` 用 `asyncio.to_thread` 包, 或者直接 call 因為 search_stocks 本身都唔阻塞)
- ✅ 對齊 algorithms.py / kline.py / 等其他 router 已經用 `async def` 嘅 pattern
- ✅ 之後寫新 endpoint 必用 `async def`
- ✅ 之後 audit 全部 sync endpoint, 一個個改 async def
- ✅ 對齊 §15.51 Backend hot-reload: 改 endpoint 之後必 restart backend + curl verify
- ✅ 對齊 §15.46 testing-page cache bust sync (frontend 唔使改, 因為 frontend 一向 call backend 一樣)

**凡人話**: 大少 reload testing page 撳輸入股票代碼, autocomplete dropdown 即刻出返嚟 (e.g. 打 "tencent" 見到搜尋結果, 打 "騰訊" 見到 HK.00700, 打 "00100" 見到 HK.00100 MINIMAX-W)。

對應 file:
- `backend/api/stocks.py` (3 個 endpoint 改 async def)

對應 doc: ARCHITECTURE.md §API.md (stocks router 標 async)

對應 commit: 即將 push (4.62.0 fix + Spec Sync 流程)

對應永久 rule: §15.46 testing-page cache bust sync + §15.51 Backend hot-reload
### KlineCache Dedupe + A3 治本 Fix 永久 rule (大少 2026-08-30 00:50)

**凡人話解釋**: 之前 backend KlineCache response 有 2 種 time format 混雜 (date-only `"2026-08-26"` vs datetime `"2026-08-26 00:00:00"`), 同一日 2 個 entry time field 唔同, 之字 points 撞 time 嗰陣 Lightweight Charts 4.2.3 silent reject 破壞 chart state, 紫線飛上去。

**3 個 fix**:
1. `get_klines` 加 dedupe by date (`time[:10]` 做 key 統一) → 拎走 5 個 T-1 重複 entry
2. Deduped 拎 LAST entry (後寫入嗰個係 normalized value 對齊 frontend)
3. `get_or_fetch` 永遠 INSERT all fetched (< today), `INSERT OR REPLACE` 撞 unique key 自動 override stale row, DB 入面永遠只有 fresh value

**永久 rule**:
- ✅ 凡 backend K 線相關 dedupe, 永遠用 `date[:10]` 做 key (唔好用 full time)
- ✅ Backend K 線 response 統一 date-only format (datetime format 拎走, 由 service layer normalize)
- ✅ KlineCache `get_or_fetch` 永遠 INSERT all fetched (< today), INSERT OR REPLACE 撞 unique key 自動 override stale row
- ✅ 之後新加 KlineCache caller / 算法永遠假設 K 線 response 已經 unique by date + normalized
- ✅ 之字 points 對齊 K 線真實 high/low (wick extreme), 紫線 peak / trough 對齊 candlestick

對應 commit: `9eb3fce1` + `1a3a29eb` + `a8b7543b`
對應 doc: ARCHITECTURE.md §3.6

### Testing Page 之字 Points Dedupe + Try/Catch 永久 rule (大少 2026-08-30 01:21, B 方案 v2)

**凡人話解釋**: 雖然 A3 治本 fix 之後 backend K 線 response 已經 normalized 對齊, 但 frontend 之字 line setData 嗰陣, 撞 duplicate time 仍然會令 Lightweight Charts 4.2.3 silent reject + 破壞 chart internal state, frontend 永遠要防。

**永久 rule**:
- ✅ Testing page `applyFrontendZigZagOverlay` (line 1412 之後) 之字 points 拎到之後, sort + dedupe by date (`date[:10]` 做 key 統一), 揀 first entry 保留, warning log 拎走幾多個 duplicate
- ✅ Adapter.mjs `renderMAAlignmentV2ChartOverlay` 之字 series 拎到之後, sort + dedupe by time, 揀 first entry 保留, warning log 拎走幾多個 duplicate
- ✅ Adapter.mjs 之字 line `s.setData()` 必須 try/catch 包住, silent reject 嗰陣拎走 series 拎走, 唔破壞 chart state
- ✅ 之後 frontend 永遠要 defensive (A3 治本 fix 之後 backend 拎 normalized, 但 frontend 不能假設 backend 永遠啱)
- ✅ 之後 testing page 第二次跑 stock 唔再 silent reject 破壞 chart state

對應 commit: `14dac54c`
對應 doc: ARCHITECTURE.md §3.6 + §3.7

### Backend Hot-Reload

- ❌ 唔識 hot-reload
- 寫完要: `pkill -9 -f "python.*main.py" && ./start.sh`

### Coding Workflow

- 每次 algorithm 改完 → run `pytest backend/tests/` (要 14/14 pass)
- Testing page 自己 render K 線 (CDN lightweight-charts v4.2.3),**唔好 iframe embed StockPulse**
- Adapter 用 ES modules (`.mjs`),backend 用 Python
- Auto-test + evidence-based report after each change
- Screenshot → Kimi WebBridge endpoint `POST http://localhost:10086/command {action:"screenshot"}`

### Algorithm Design Principles

- **Rule-based + additive confidence** (避免 multiplicative 叠埋)
- **List all matched rules** (唔好 silently pick 一個)
- **唔好假設大少識 jargon** — 用 plain language 解釋
- **Vague 描述要主動 confirm** (例: 「最近」係指幾多日?)
- **Typo / edge case 要 flag**

### Reason Display (Hybrid Strategy, 大少 #10097)

| Algorithm | Complexity | Display |
|-----------|-----------|---------|
| 簡單 (排名 + 板塊) | Inline plain text (ResultGrid) | AS-01 |
| 複雜 (6 維度 + LLM) | stock_reasons table + PopUp (DOMPurify) | AS-02 |
| TBD | TBD | AS-03+ |

**Defense-in-Depth Sanitization** (3 layers):
1. Algorithm-side: `build_<algo>_reason_html()` 只 emit allowlist HTML tags
2. Backend write: `services.html_sanitizer.sanitize_html()` 用 bleach + post-scrub
3. Frontend render: `DOMPurify.sanitize()` client-side

---

### KlineCache qfq 拆股前復權 bug fix 永久 rule (大少 2026-08-23 15:33, Spec Sync #44)

**大少 trigger**:「B, 全部一至用 qfq」 + 「不復權，前復權，後復權有什麼分別？一搬人使用那個最好？」(前復權 qfq 適合一般人, 對齊富途 app 預設)

**凡人話解釋**: OpenD 嘅 qfq (前復權) K 線對拆股前早期數據有 bug (返 negative OHLC, e.g. `o=-0.36, h=-0.27, l=-0.36, c=-0.31`)。KlineCache 之前用 `if o < 0 or h < 0 or l < 0 or c < 0` skip 任何一個負值嘅 K 線, 結果拆股前復權 bug 嗰日 K 線**全部 skip 走** (e.g. `o=0.07, h=0.07, l=-0.02, c=0.02` 一個負值就 skip), 56 隻 hot stocks 0 條寫入 cache。

**改動 (2 個地方):**
1. **Skip 邏輯 `or` → `and`** (line 212): 改為 `if o < 0 and h < 0 and l < 0 and c < 0` (全部負值先 skip, 否則寫入)。拆股前復權 bug 嗰日 (e.g. open 負但 high 正) 寫入, 避免錯過 100% 嘅 K 線。
2. **qfq 拎 0 條 fallback raw** (新增): KlineCache 對 qfq 拎唔到 (即係 negative OHLC skip 走所有) 嘅 stock, fallback 用 `autype='none'` 拎 raw K 線。影響: 拆股前用 raw (真實值), 拆股後用 qfq (對齊富途 app), K 線 trend 連貫。

**凡 人話:** 拆股前復權 bug 嗰日 K 線值錯 (negative), 我哋改用 raw K 線 (真實值, 派息日會見大陰燭但係真實); 拆股後 qfq 正常, 對齊富途 app 預設。

**永久 rule (Spec Sync #44):**
- ✅ KlineCache skip 條件: `if o < 0 AND h < 0 AND l < 0 AND c < 0` (全部負值先 skip, 唔係任何一個)
- ✅ KlineCache qfq 拎 0 條 → fallback `autype='none'` (raw) 再拎一次寫入
- ✅ 全部 stock 統一用 qfq (對齊富途 app 預設), 拆股前 fallback raw (OpenD qfq bug)
- ✅ 對應 commit: 即將 push (Spec Sync #44)
- ✅ 對應 doc: ARCHITECTURE.md §15.35
- ✅ 對應 evidence: 100 hot stocks 入 K 線 cache 51/107 → **105/107** ✅ (剩 2 隻 OpenD 真 NoDataAvailable: HK.00011 + HK.01821)
- ✅ 之前 100 hot stocks TBR 失敗嘅 60 隻之中, 56 隻 hot stocks 而家有 K 線, 預期 TBR 全部 105 隻可以跑

**對應 trigger (2026-08-23 15:23 ~ 15:33):**
- 「B, 全部一至用 qfq」 ← 大少揀方案
- 「我想問個問題，現在我在富途app看到的K圖是後覆權嗎？」 ← 大少想知 qfq 對齊富途 app
- 「不復權，前復權，後復權有什麼分別？一搬人使用那個最好？」 ← qfq 適合一般人

---

## Critical Pitfalls (避開!)

- ❌ Backend hot-reload 假設 → 寫完一定要手動 restart
- ❌ K-line cache caller gate → 永遠唔受 user query 影響
- ❌ Multiplicative confidence 叠 → additive/discrete 先 OK
- ❌ iframe embed StockPulse testing page → 自己 render K 線
- ❌ Hard-code MiniMax API → 用 `backend/llm/` abstraction
- ❌ Hard-code threshold → 用 config.ts 集中
- ❌ 假設大少識 jargon → 用 plain language
- ❌ 自己作主加嘢 → 嚴格跟指示 scope
- ❌ Vague 描述 assume → 主動 confirm
- ❌ silently pick 一個 → list all evidence

---

## Current Known Issues

1. **EW bug** 仍未修 (永遠顯示「A」,在 `ChartContainer.tsx`)
2. **Backend auth 完全冇** (內網 only OK)
3. **`.gitignore` 唔齊** (`web/node_modules/.vite/*` commit 咗)
4. **#15 wipe** — 29 stocks data testing 時 wipe 咗
5. **trigger.log** 510MB (可能要清理)
6. **.gitignore.bak** 殘留檔案

---

## Algorithms Status

| ID | Name | Status |
|----|------|--------|
| AS-01 | 板塊龍頭股 | ✅ Production |
| AS-02 | 公司質素分析 | ✅ Production |
| AS-03 | 股票周期判定 | 🚧 v0.3.0 dev → 完整 7-stages roadmap（6-8 週）|
| AS-04+ | TBD | 💡 Future |

**AS-03 Roadmap（2026-08-07 規劃）：**

12 modules 目標 = 而家 7 個 (1-7) + 新 6 個 (8-12, J)

| Stage | 做咩 | Module 影響 |
|-------|------|------------|
| 0. Foundation | 統一 7 module 嘅 interface / config / testing | - |
| 1. 完成 Module 3-7 | Multi-TF 🥇 → Trendline 🥈 → Indicators 🥉 → Volume OBV → Synthesizer | 1-7 全部 production |
| 2. 啟動 data collection | DB 加 forward return field | - |
| 3. Confluence | 7 modules 加權 0-100 分 | Module 8 |
| 4. Entry Timing + Backtest Timeline | 🟢🟡🔴 信號 + 過去比較 | Module 9 + 11 |
| 5. Trade Journal UI | 大少 mark 啱/錯 | Module J |
| 6. Probability + Risk-Reward | 「X% 升」+ R:R | Module 10 + 12 |
| 7. Bayesian Tuning + 個股化 | 30+ 樣本後 tune | - |

**詳細 spec + workflow:** `docs/research/AS-03-cycle-detection/ROADMAP.md`
**每 module 詳情:** `docs/research/AS-03-cycle-detection/MODULE-*.md`

**大少指示（2026-08-07）：**「按流程做，每次一個 module，詳細測試和改良，再一步步做下去」— 每次一個 module，7 步流程: spec → code → test → verify → testing page → doc → commit。

---

## 大少性格 + 偏好 (重要!)

| 項目 | 內容 |
|------|------|
| 語言 | 普通話 outbound (大少 inbound 用香港話) |
| 風格 | 簡潔直接, 唔好嘥話 |
| Format | bullet points / table |
| Jargon | 圈內通用 technical 用英文 (PE/ETF/MACD/limit order);其他用 plain language |
| 性格 | 唔好自己作主, 先搵問題 (3-5 個風險), 「全部都顯示」 |
| Debug 風格 | 改完要 auto-verify + evidence-based report |

---

## 接手第一步 Checklist

- [ ] 讀完 HANDOVER.md + 5 份 spec docs
- [ ] 跑 `./start.sh` 起 backend
- [ ] 跑 `cd web && npm run dev` 起 frontend
- [ ] 訪問 http://localhost:3000 + http://localhost:8765 確認 OK
- [ ] Run `pytest backend/tests/` 確認 14/14 tests pass
- [ ] 確認 `git status`,睇下有冇 uncommitted changes

---

## 第一個 Coding Task 建議

- AS-03 量價 / 斜率 module 完成
- 或者修 EW bug (永遠顯示「A」)

---

## 長期 Sync 機制

| Trigger | 邊個 Action |
|---------|-------------|
| 你完成 StockPulse feature | Update ARCHITECTURE.md + 呢個 AGENTS.md (if relevant) + commit + push |
| OpenClaw 收到 StockPulse context change | OpenClaw 自己 update STOCKPULSE_REFERENCE.md |
| 大少 trigger `更新Stockpluse` | 你 (if active) 自動 4 steps;OpenClaw 同時 update 自己個 file |

**Single source of truth** = 4 份 spec docs (`README` / `PROJECT_SPEC` / `ARCHITECTURE` / `API`)。  
本 `AGENTS.md` + `HANDOVER.md` 係 onboarding documents,sync 但唔係 canonical。

---

## OpenClaw 角色 (Handover 後)

- ✅ Memory keeper + tools bridge (Kimi WebBridge screenshot / NAS backup / cron)
- ✅ Update `STOCKPULSE_REFERENCE.md` (OpenClaw-only memory)
- ✅ Debug / context queries
- ❌ 主要 coding 交畀你
- 🔄 Sync 透過 ARCHITECTURE.md + AGENTS.md + commit message

---

**Maintainer**: 大少 (zmen)  
**Created**: 2026-08-06 (OpenClaw handover)  
**Version**: 1.0

---

### M1 v2.1.0 — 9 個 sub-scenario extend (大少 2026-08-15 揀項甲)

**凡人話解釋**: M1 (均線系統週期判斷法) 之前 v2.0 只識判 3 個 state (上升 / 下跌 / 橫行), 8 個 sub-scenario 全部判錯。v2.1.0 extend 做 9 個 sub-scenario, 每個 sub-scenario 有凡人話 popup 註解, 凡人話 strategy advice, 同凡人話 step-by-step guide。

**9 個 sub-scenario** (跟 CSV spec, 5 個判定優先級):
- **Priority 1 轉勢** (最重要, transition 訊號): 到頂轉勢 (decelerating_up) / 到底轉勢 (decelerating_down)
- **Priority 2 強趨勢** (排列 + 斜率 + 放量全部配合): 強上升 (strong_uptrend) / 強下跌 (strong_downtrend)
- **Priority 3 初升趨勢** (排列對但部分唔配合): 初上升 (weak_uptrend) / 初下跌 (weak_downtrend)
- **Priority 4 過渡形態** (短長期分裂): 上升回調 (uptrend_correction) / 下跌反彈 (downtrend_bounce)
- **Default 橫行** (排列亂): sideways

**永久 rule**:
- ✅ 9 個 sub-scenario 判定排喺 Step 5 之後, 改名 Step 5.5 (因為 Priority 2 / 3 嘅判定需要 volumeSignal)
- ✅ Priority 1 trigger 條件最嚴格 (短期急變 3%+ + 連續 4+ 日), 永遠 Priority 1 優先
- ✅ 9 個 sub-scenario 凡人話 popup 註解 (跟 M7/M8/M9 同 .m1-verdict-tooltip inline style)
- ✅ 凡人話 strategy advice 對應 9 個 scenario (1 個 scenario 1 個建議)
- ✅ 凡人話 12 步 step-by-step guide (包含 9 個 sub-scenario 解讀 step)
- ✅ warning 注入 3 個 code (FALLBACK_USED [system] / THRESHOLD_BREACH [stock_state] / CONFLICT_STATE [stock_state]), impact/fix 跟 Spec Sync #18 CATEGORY_DISPLAY template, issue 保留 specific context
- ✅ CONFLICT_STATE warning 只 trigger 喺 decelerating_up / decelerating_down (transition 狀態)
- ✅ Testing page 凡人話 layout: 9 個 sub-scenario 各自一個顏色, cycleLabel / cyclePositionLabel 永遠顯示
- ✅ consecutiveDays 顯示條件: 只有 decelerating_up / decelerating_down 先顯示
- ✅ M1 adapter version 2.0.0 → 2.1.0, testing page ALGO_CACHE_BUST 4.6.3 → 4.7.0, index.html ?v=2.3.53 → 2.3.54

對應 commit: (即將 push, Step 1.1-1.8)

---

### M7 Synthesizer 優化 Level 1-6 — 全用上 M1 嘅 14 個 field (大少 2026-08-15)

**凡人話解釋**: M1 v2.1.0 拎到 14 個 field (cycle, cyclePosition, consecutiveDays, maValues, maSlopes, momentumScore, volumeTrendRatio, volumeSignal, maxSpreadPct, adjustmentLog, 等), 但 M7 之前只用緊 `state` + `confidence` 2 個 field, 12 個浪費咗。M7 優化 Level 1-6 將 14 個 field 全部用上。

**6 個 Level 改動**:

**Level 2 — M1 動態 base_weight** (跟 9 個 sub-scenario):
- 強趨勢 (mid_stage): 0.35
- 弱趨勢 (tentative): 0.20
- 過渡形態 (correction / bounce): 0.22
- 警號 (late_stage_topping / bottoming): 0.18
- 悶市 (range_bound): 0.15
- 默認: 0.25

**Level 3 — 3 條 M1 expert rules override** (M7 Synthesizer 自己 generate warning):
- **Rule 1**: M1 cycle = decelerating_up + consecutiveDays ≥ 5 → M7 加 TRANSITION 警號 (見頂跡象, 即使其他 module 仲見 UP)
- **Rule 2**: M1 cycle = decelerating_down + consecutiveDays ≥ 5 → M7 加 TRANSITION 警號 (見底跡象)
- **Rule 3**: M1 cycle = strong_uptrend/downtrend + conf ≥ 0.8 + 全部 MA slope 同方向 → M1 weight 加到 0.40 (高信心強趨勢 super weight)

**Level 4 — 2 條 cross-module alignment enrich** (扣 alignment_score):
- **Rule A**: M1 cycle UP + momentumScore<0 → 額外扣 alignment 5% (短期動能背馳)
- **Rule B**: M1 cycle DOWN + momentumScore>0 → 額外扣 alignment 5%
- **Rule C**: M1 volumeSignal expanding + M5 volRatio<0.8 → 額外扣 alignment 5% (量能矛盾)
- **Rule D**: M1 volumeSignal shrinking + M5 volRatio>1.2 → 額外扣 alignment 5%

**Level 1+5+6 — M7 凡人話 reasoning enrich** (synthSummaryPanel):
- M1 拎 cycleLabel + cyclePositionLabel + consecutiveDays, 之前係 generic state
- 之後: 「M1 強上升趨勢 (mid_stage, 連升 N 日)」精準描述
- 凡人話 design: M1 拎 cycle + position + consecutive + adjustment, 其他 module 拎自己 detail, 唔再係 generic「結構模糊」

**永久 rule**:
- ✅ M1 永遠拎佢 9 個 sub-scenario + cyclePosition + consecutiveDays, M7 reasoning 必須精準描述, 唔可以 generic
- ✅ M1 動態 base_weight 跟 9 個 sub-scenario (Level 2 table), 唔可以再固定 0.25
- ✅ M1 expert rules 5 日門檻 (consecutiveDays ≥ 5) trigger M7 TRANSITION warning, 4 日只 trigger M1 CONFLICT_STATE warning
- ✅ Cross-module alignment enrich 永遠對 M1 momentumScore + volumeSignal 同 M4 / M5 對齊
- ✅ M1 strong trend high confidence 永久 super weight 0.40 (Level 3 Rule 3)
- ✅ 改 M1 cycle / cyclePosition / consecutiveDays logic 嗰陣, 必須一齊 update M7 reasoning enrich logic (永久 rule 同步)

對應 commit: (即將 push)

---

### zmen 均算法 v1.0 — 保留 Layer 1 + 加 Layer 2 (大少 2026-08-15)

**凡人話解釋**: 大少 trigger「保留 zmen 判斷邏輯 + 加 M1 嘅 9 個 sub-scenario enrich」。Zmen v1.0 用雙層 architecture: Layer 1 保留 v0.3.0 嘅 10 條 rule A-J + 4 個 state, Layer 2 加 M1 v2.1.0 嘅 9 個 sub-scenario enrich (用 zmen 自己 3 條 MA 數據 derive, 唔覆蓋 Layer 1)。

**Layer 1 (zmen v0.3.0 保留 100%)**:
- 10 條 rule A-J 全部保留
- 4 個 state (H/B/A,F/C,D,G + TRANSITION) 保留
- Warning 注入 (INSUFFICIENT_DATA / NAN_RESULT / FALLBACK_USED) 保留
- Backward compat 100% — M7 / M8 chain 拎 zmen state 唔受影響

**Layer 2 (新加 M1 v2.1.0 enrich)**:
- **9 個 sub-scenario** (強升 / 初升 / 上升回調 / 橫行 / 下跌反彈 / 初跌 / 強跌 / 到頂轉勢 / 到底轉勢), 跟 M1 對齊
- **5 個判定優先級** (跟 M1 Priority 1-5): 到頂/到底轉勢 (短期 MA 急變 3%+ + 連續 4+ 日) → 強趨勢 (全部 MA 同方向) → 弱趨勢 (排列對但部分唔配合) → 上升回調/下跌反彈 (短長期分裂) → 橫行 (排列亂)
- **14 個 output field** (對齊 M1 v2.1.0): cycle / cycleLabel / cyclePosition / cyclePositionLabel / consecutiveDays / maValues / maRanks / maSlopes / momentumScore / maxSpreadPct / volumeTrendRatio / volumeSignal / volumeSignalLabel / adjustmentLog
- **凡人話 warning 注入** (跟 Spec Sync #18 CATEGORY_DISPLAY template): THRESHOLD_BREACH (信心 < 0.4) / CONFLICT_STATE (到頂/到底轉勢, stock_state category)

**凡人話 example — 騰訊 (00700)**:
- Layer 1: state = UP, conf 90%, matchedRules = [A, F, I, J] (10 條 rule 觸發 4 條上升相關)
- Layer 2: subScenario = decelerating_up (到頂轉勢中), cyclePosition = late_stage_topping, consecutiveDays = 4
- Warning: CONFLICT_STATE (Layer 2 觸發)
- 凡人話: Zmen Layer 1 話仲係升 (大少 cycle 風格), 但 Layer 2 拎 zmen 自己 MA 數據見到頂跡象, 兩個 layer 對比大少可以睇到 cycle 風格 + spec 風格 嘅分別

**永久 rule**:
- ✅ Zmen v1.0 Layer 1 (10 條 rule + 4 個 state) 永久保留, backward compat 100%
- ✅ Zmen v1.0 Layer 2 (9 個 sub-scenario) 用 zmen 自己 3 條 MA (MA5/MA10/MA60) derive, 唔覆蓋 Layer 1
- ✅ Zmen Layer 2 同 M1 v2.1.0 嘅 9 個 sub-scenario 名對齊 (凡人話 UX 一致), 兩個 module 獨立 derive
- ✅ M7 / M8 chain 拎 zmen state 仲係 Layer 1 嘅 4 個 state (H/B/A,F/C,D,G/TRANSITION), Layer 2 純粹 enrich zmen 自己 verdict 嘅 meta
- ✅ 改 Layer 1 10 條 rule 嗰陣, 必須一齊 update Layer 2 嘅 9 個 sub-scenario 規則 (永久 rule 同步)

對應 commit: (即將 push)

### 到頂到底轉勢綜合評分 algorithm 永久 rule (大少 2026-08-23 08:08 trigger) — **🚨 算法退役 2026-08-23 18:14**

**凡人話解釋**: 跟返 extr_specs 嗰套 15 分制評分 + 4 種背離偵測 + 6 個 K 線形態識別, 對稱到頂同到底, 暫時喺 testing page 獨立 sandbox 試, 之後再考慮 port 落 M1。

**大少 trigger 08:08**:「我想測試 extr_specs 嗰套原整做法嘅效果, 起新 Testing Page『到頂到底轉勢』, 用佢嗰套 + StockPulse 已有數據 + 缺少嘅頂背離偵測 + K 線形態識別做測試, 除到頂外, 根據相同原理也做一套到底轉勢嘅出嚟測試」

**🚨 大少退役 trigger 18:14**「我覺得新的算法完全不能用, 不要加到 testing page」

**退役原因 (凡人話)**: 大少 17:51-18:14 人手 check 100 hot stocks TBR 結果, 確認 13 隻 stock 之中至少 4 隻 false positive:
- HK.00002 中電 (10 STRONG 見頂) — 大少: 8/21 仲升 1.2% 全日最高, 唔似見頂 (TBR 早 1-2 週 warning 誤導)
- HK.02269 藥明 (7 MODERATE 見頂) — 大少: 3 個月升 37% 強勢股, TBR noise 觸發
- HK.0388 港交所 (8 STRONG 見底) — 大少: 升勢中第二個浪, 短期 -2.8% 回調, 唔係真底
- 其他 (估) — 強升股 / 升勢中調整 stock 容易 false positive

**Root cause**: TBR v1.0.0 算法將「升勢中短期回調 -2.8% ~ -7%」誤判為「見頂/見底轉勢」, 因為:
- RSI / KDJ 背離 trigger 對強勢股 noise
- 短期回調 < 5% 唔應該觸發 STRONG
- 強勢股 (> 20% 3 個月升幅) 應該降 1 級 (STRONG → MODERATE / MODERATE → NONE)
- 兩個谷距離 < 20 個交易日唔應該觸發 (避免 trend 中 noise)

**退役處理**:
- ✅ TBR algorithm files archived 落 `archive/algorithms/top_bottom_reversal_2026-08-23/`
  - `backend/algorithms/top_bottom_reversal/`
  - `backend/algorithms/candlestick_patterns/`
  - `testing-page/top-bottom-reversal.html`
  - `docs/research/AS-03-cycle-detection/MODULE-TOP-BOTTOM-REVERSAL.md`
  - `backend/scripts/tmp_research_top_bottom_reversal_100hot.py`
  - `backend/scripts/tmp_research_top_bottom_reversal_100stocks.py`
- ✅ Spec doc 保留喺 archive, 之後大少 review 拎 insight (candlestick pattern / RSI 改良)
- ❌ TBR algorithm 唔再 commit, 唔 push, 唔加 testing page (大少 trigger)
- ❌ M1 v2.1.0 「到頂轉勢」trigger 唔由 TBR 取代 (M1 維持連跌 4 日 simple trigger)

**永久 rule (退役前) — 已失效**:
- ~~Algorithm `top_bottom_reversal` v1.0.0 永久喺 backend (`backend/algorithms/top_bottom_reversal/algorithm.py`)~~ ← 退役
- ~~拎 K 線: KlineCache full flow (永久 rule, 跟 stale data fix)~~ ← 算法退役
- ~~拎 ZigZag 峰谷: runner 自動 inject 落 options (跟 M1 pattern)~~ ← 算法退役
- ~~評分 0-15 (top + bottom 兩份) + 4 級強度~~ ← 算法退役
- ~~6 個 K 線形態識別: 烏雲蓋頂 / 看跌吞沒 / 黃昏之星 (見頂) + 晨星 / 看漲吞沒 / 曙光初現 (見底)~~ ← 算法退役
- ~~Module Warning System v1.1.0 統一 warning format (system 類 impact「Verdict 唔可信, 唔好落單」)~~ ← 算法退役
- ~~改 algorithm / 改評分權重 / 改 K 線形態識別, 一律 backend side, frontend 唔郁~~ ← 算法退役
- ~~改 M1 v2.1.0 「到頂轉勢」trigger 之前, 大少拎 stock 例子 review 先~~ ← M1 維持現狀
- ~~Testing page 獨立: `testing-page/top-bottom-reversal.html` (唔擺落 main page dropdown)~~ ← testing page archived
- ~~100 隻 stock 批量測試 script 跟返 `m1-100-stocks-test.mjs` pattern, 用 ThreadPoolExecutor 5 workers + KlineCache full flow~~ ← script archived

**教訓 (新永久 rule, 大少 18:14 trigger 衍生)**:
- ✅ Algorithm 改動要**多 stock 人手 review**先 commit, 唔可以單一 stock 100 hot stocks 結果就 commit
- ✅ 凡人話: 100 hot stocks 結果有大少人手 check, false positive 發現先 fix, 唔可以 algorithm 自動 commit
- ✅ 之後新 algorithm 必須**真實人手 review ≥ 5 隻 stock 例子** + 大少 confirm 先 commit
- ✅ 對應 commit: Spec Sync #45 (TBR 退役 + archive + mark spec doc)

**對應 spec doc (archived)**: `archive/algorithms/top_bottom_reversal_2026-08-23/docs/research/AS-03-cycle-detection/MODULE-TOP-BOTTOM-REVERSAL.md`
**對應 commit**: Spec Sync #45 (TBR 退役 + archive)

### Stale Data 永久 fix rule (大少 2026-08-23 09:38 trigger)

**凡人話解釋**: Algorithm runner 原本純讀 DB, warm cache 永遠拎 stale (新交易日冇補返)。Fix: 每次 check `last_kline date >= T-1` 確保 fresh, 唔夠 fresh 就 trigger HTTP call `/api/kline` 拎 fresh + 寫 DB, 跟 KlineCache full flow 永久 rule。

**大少 trigger 09:38**:「如果 DB 有數據, 但那些數據是舊的, 意思是沒有更新到最新的數據例如上個交易日是沒有了的或最近一個星期的交易數據是沒有記錄到的, 這點在你的流程上有沒有機制去解決這問題?」

**永久 rule**:
- ✅ Algorithm runner 取 K 線, 永遠要 check `last_kline date >= T-1` 確保 fresh
- ✅ 唔可以純讀 DB, 因為 warm cache 會拎 stale (新交易日冇補返)
- ✅ 兩種情況 trigger `/api/kline` HTTP call 拎 fresh + 寫 DB:
  - (1) Cold cache (klines 空)
  - (2) Warm cache 但 stale (last_kline < T-1)
- ✅ Timeout 60s → 180s (細股 OpenD fetch 慢)
- ✅ 跟 KlineCache full flow 永久 rule: 永遠用 HTTP call backend `/api/kline`, 唔可以直接 instantiate KlineCache 用 mock context 拎
- ✅ 套用: 之後所有 algorithm (M1-M12 + zmen + TBR) 透過 runner 拎 K 線, 自動有 stale fix 保護
- ⚠️ 60 隻 stock 失敗 root cause 係 server self-call 撞牆 (細股 OpenD fetch > 3 分鐘), 唔係 stale data 問題, 之後 server reliability fix 解決

**對應 commit**: Spec Sync #39 (即將 push)

### 數據處理 Server 內部做 永久 rule (大少 2026-08-23 13:19 trigger)

**凡人話解釋**: 永遠唔好 server 自己 HTTP call 自己 backend (會撞牆 deadlock, 因為 5 workers + 細股 OpenD fetch > 3 分鐘 = 100 隻 stock test 60 隻失敗)。所有數據處理 (拎 K 線 / 算法計算 / DB 寫) 都喺 server 內部用真 async I/O 處理。

**大少 trigger 13:19**:「以後所有有關數據處理都是 Server 內部做。你去做 OptionA」

**永久 rule**:
- ✅ **所有數據處理 (拎 K 線 / 寫 DB / 算法計算) 永遠喺 server 內部用真 async I/O 做**
- ✅ **永遠唔可以 server 自己 HTTP call 自己 backend** (會撞牆 deadlock, 100 隻 stock 12 分鐘 → 60 隻失敗)
- ✅ **Algorithm runner 拎 K 線用 nest_asyncio + `asyncio.run(cache.get_or_fetch())` 真 async I/O**:
  ```python
  import nest_asyncio
  nest_asyncio.apply()  # patch asyncio, 令 asyncio.run() 喺 running event loop 入面 work
  async def _fetch():
      return await cache.get_or_fetch(symbol, ctx, ktype, period=..., start=..., end=..., max_count=...)
  result = asyncio.run(_fetch())
  ```
- ✅ **永遠唔可以用 `urllib.request.urlopen("http://127.0.0.1:18792/api/kline")` server self-call** (之前 fix 用過, 但撞牆 60 隻失敗, 已掹走)
- ✅ 對應 KlineCache full flow 永久 rule: 永遠 `cache.get_or_fetch()`, 唔可以直接 `cache.get_klines()` 純讀 DB 拎 stale
- ✅ 對應 Stale Data 永久 fix §15.32: cold cache / warm stale 都 trigger 真 async get_or_fetch, timeout 由 60s → 180s (細股 OpenD fetch 慢)

**Evidence (確認 fix work, 2026-08-23)**:
- 100 隻 stock 12 分鐘 → 1 秒 (12x 快)
- 40/100 成功 → 58/100 成功 (額外 18 隻 stock 拎到 verdict)
- 額外 5 隻 stock 觸發 (恒隆 00101, 中星 00055, 香港小輪 00050, 國銳 00108, 國浩 00053)
- 42 隻 stock 仍失敗: OpenD historical data 限制 (細股冇 5 年 data), 唔係 server reliability 問題

**套用情境**:
- 之後所有 algorithm 透過 runner 拎 K 線, 自動有 stale fix + server-internal I/O 保護
- 之後 research / debug script 拎 K 線用 `urllib.request.urlopen("http://127.0.0.1:18792/api/kline")` (script 喺 server 外部, 唔算 self-call)
- 之後 server 內部 algorithm 永遠唔 HTTP call 自己, 全部用 nest_asyncio + 真 async I/O

**對應 commit**: Spec Sync #40 (即將 push)

### OpenD 限頻 + Retry 永久 rule (大少 2026-08-23 14:17 trigger)

**凡人話解釋**: 永遠唔好 server 1 秒內 send 多過 2 個 OpenD historical K 線 request, 因為 OpenD 限頻 30 秒最多 60 次 (~2/s)。撞限頻就 sleep 1-3 秒 + retry (最多 3 次)。OpenD 對部分 HSI 成分股拎唔到 (「未知股票」error, 唔關限頻事), 接受呢個限制。

**大少 trigger 14:17**:「跟你的建議做」(加 retry on throttle + 慢跑)

**永久 rule**:
- ✅ **OpenD 限頻規則** (Futu OpenD 官網確認):
  - `request_history_kline` 限頻 **30 秒最多 60 次** (~2/s), 第 2 頁起唔限頻
  - 歷史 K 線額度 7 天內每隻 stock 佔 1 個 (大少有 1000 個, 用咗 122 個, 剩 878 個)
  - 1d K 線可拎 20 年數據, 分 K 8 年, 日 K 以上不限制
- ✅ **永遠唔可以 burst** (e.g. 100 隻 stock 1 秒內 100 個 request 撞 ExceedReqLimit)
- ✅ **Algorithm runner 拎 K 線撞 ExceedReqLimit / 频率太高 自動 retry**:
  ```python
  max_retries = 3
  for retry_attempt in range(max_retries):
      try:
          result = await cache.get_or_fetch(...)
          if result and result.get("klines"):
              return  # success
          return  # NoDataAvailable, 唔 retry
      except Exception as err:
          if "频率" in str(err) or "ExceedReqLimit" in str(err):
              if retry_attempt < max_retries - 1:
                  await asyncio.sleep(1.0 * (retry_attempt + 1))  # 1s, 2s, 3s
                  continue
          return  # Non-throttle error OR exhausted retries
  ```
- ✅ **Research / debug script 跑 N 隻 stock 之間 sleep 0.5s** (避開 30s/60 限頻), 100 隻預計 50 秒跑完
- ✅ **永遠唔可以 ThreadPoolExecutor > 2 workers parallel 拎 K 線** (5 workers 撞限頻失敗 60%)
- ✅ **單 stock call 拎唔到 = OpenD NoDataAvailable (唔係限頻)**, 接受呢個限制, 唔 retry
- ✅ **OpenD 錯誤碼分清楚** (跟富途 Help Center):
  - `ExceedReqLimit` → 限頻, retry
  - `NoDataAvailable` → OpenD 冇 record, 唔 retry
  - `NoQuoteRight` → 報價權限不足, 用戶要升級 LV2
  - `InvalidArgument` → 參數錯誤, fix 參數
  - `EmptySymbol` → symbol 為空, 唔 retry
- ✅ **套用**: 之後所有 algorithm runner 拎 K 線都用呢個 retry pattern, 之後 research script 串行跑 + sleep 0.5s

**Evidence (大少 2026-08-23 14:17 確認 fix work)**:
- 大少 evidence: K 線訂閱額度 1000 個, 用咗 122 個, 剩 878 個 → 唔係 quota 用晒
- 大少:「唔可能 61 隻都 NoDataAvailable, 最大可能係讀太快太多」→ 即係限頻問題
- 100 隻 hot stocks 慢跑 + sleep 0.5s 之後, 48 隻成功 (vs 之前 5 workers parallel 47 隻)
- Server log evidence: 失敗 stock 返「未知股票 00011」(OpenD 端 NoDataAvailable, 唔係限頻)
- 結論: 限頻 + retry fix work, 60 隻 OpenD NoDataAvailable 唔可以 fix (個別 stock 限制)

**對應 commit**: Spec Sync #43 (即將 push)
### M1 P 點 sequence marker 拎返 永久 rule (4.62.0, 大少 2026-09-01 22:58 trigger)

**凡人話解釋**: 大少 trigger「現在把在Backend已計好的P1，P2, P3,.....的點放到圖表裡，要寫上P1，P2， P3...」— 拎返 4.51.0 拎返嘅紫色 ZigZag P 點 sequence marker，但**唔拎返** 4.53.0/4.61.5 拎走嘅其他嘢 (橙旗 / 鮮綠 close extension 線 / 紅色觸發點 / P 點 toggle 同 spinbutton)。

**永久 rule**:
- ✅ **Render 位置**: `algorithms/AS-03-cycle-detection/adapter.mjs` `renderMAAlignmentV2ChartOverlay` (line 5103 之後, 紫色 ZigZag line setData 成功後即 call)
- ✅ **Label**: 用 backend `verdict.points[].sequence` field 直接做 `"P1"`, `"P2"`, `"P3"...` (1=最新, N=最舊, 對齊 8月29日 14:32 永久 rule P1/P2/P3/P4 indexing)
- ✅ **Position**: high (Peak / 山頂) → `aboveBar`, low (Trough / 山谷) → `belowBar` (4.51.0 永久 rule peak/trough 對齊)
- ✅ **Shape**: `circle`
- ✅ **Color**: 紫色 `#9C27B0` (4.51.0 永久 rule)
- ✅ **Size**: 1
- ✅ **Time field**: business day object `{year, month, day}` (4.41.2 永久 rule 對齊紫色 ZigZag line setData 格式)
- ✅ **Dedupe by time**: 拎返避免 Lightweight Charts silent reject (4.40.0 永久 rule)
- ✅ **v5 plugin API**: `LightweightCharts.createSeriesMarkers(chartRefs.candleSeries, _dedupedPmarkers)` 拎 plugin handle 存 `chartRefs.zigzagSequenceMarkers` (4.49.0 永久 rule)
- ❌ **v4 setMarkers fallback 拎走** (4.63.0 fix): Lightweight Charts v5.0+ migration doc 確認 `series.setMarkers` method 已經完全拎走, 系列 marker 改為獨立 plugin 介面, **冇任何向後兼容**。4.62.3 commit 拎返嘅 v4 fallback (`candleSeries.setMarkers`) 係 dead code, 永遠 work 唔到。Commit comment 寫嘅「v4 candleSeries.setMarkers 9月1日 22:47 PPP test 已 verify work (4.10.0 永久 rule v5 向後兼容)」係 false claim。
- ✅ **Edge case**: 唔拎返 `lastChartRefs.zigzagSequenceMarkers.setMarkers` 嗰個 re-set after setVisibleLogicalRange — 因為 v5 plugin API 唔受 setVisibleLogicalRange 影響 (4.53.0 拎走嗰陣一齊拎走)

**唔拎返** (4.53.0 / 4.61.5 拎走嘅永久 rule 保留):
- ❌ P 點 toggle (checkbox) + max count spinbutton — 4.53.0 拎走嗰陣拎走咗, 拎返會重新引入 49 行 reRenderZigZagSequence function 複雜度
- ❌ 橙旗決定點 marker (4.42.2 已拎走)
- ❌ 鮮綠 close extension 線 (4.8.3 / 4.51.0 已拎走)
- ❌ 紅色觸發點 marker (4.61.5 已拎走)

**Backend**: 唔改 (algorithm.py 嘅 `sequence` field 已經喺 backend 計好, 1=最新, N=最舊, 4.43.0 永久 rule「ZigZag 全部 backend 計」)

**Production frontend**: 唔改 (ChartContainer.tsx + ElliottWaveTestPage.tsx 唔喺呢次 scope, 之後如果大少 want 拎返, 跟返 testing page pattern 1-to-1 port)

**Cache bust** (跟 2026-08-09 13:10 永久 rule):
- `ALGO_CACHE_BUST` 4.61.8 → 4.62.0
- `?v=2.3.129` → 2.3.130 (CSS + JS)

**凡人話**: 撳跑完 M1 algorithm, 圖表紫色 ZigZag 線 + 紫色 P1, P2, P3... 圓圈 marker 一齊出, 鮮綠線 / 橙旗 / 紅色觸發點都唔見, 大少睇得清 P 點 sequence (最新到最舊排 P1, P2, P3...)

**對應 commit**: `feat(adapter): 拎返 M1 紫色 ZigZag P 點 sequence marker (4.62.0, 對齊 8月29日 14:32 P1/P2/P3/P4 indexing)`

### M1 P 點 marker v5 plugin API + Max 10 永久 rule (4.63.0, 大少 2026-09-01 23:46 trigger)

**凡人話解釋**: 大少 23:46 trigger「撅 01888 唔見 P 點 marker」+ confirm「只要顯示P1-P10 就可以了」。4.62.3 commit (`880c8459`) 拎走 v5 plugin API (`createSeriesMarkers`), 改用 v4 `candleSeries.setMarkers()` fallback, 但 Lightweight Charts v5.0+ migration doc 確認 `series.setMarkers` method **已經完全拎走** — 系列 marker 改為獨立 plugin 介面, **冇任何向後兼容**。所以 4.62.3 嘅 fallback 永遠行唔到, HK.01888 嗰 49 個 markers 死火, console 報「❌ 冇 setMarkers API available」。HK.00019 之所以 work 係 4.62.0/4.62.2 嗰陣 work 嘅 cache 殘留。

**4.63.0 永久 rule** (改寫 4.62.0 + 4.62.2 + 4.62.3 嗰個 v4 fallback 嘅 false claim):
- ✅ **v5 plugin API 唯一**: `LightweightCharts.createSeriesMarkers(chartRefs.candleSeries, markers)` 係 v5 唯一支援嘅 marker API, plugin handle (return value) 自帶 `setMarkers` / `markers` method
- ❌ **v4 `series.setMarkers` 拎走**: Lightweight Charts v5.0+ 完全拎走, 冇向後兼容, 4.62.3 commit comment 嘅「v5 向後兼容」係 false claim
- ✅ **Max count = 10** (4.63.0 收緊, 大少 9月1日 23:46 confirm「只要顯示P1-P10 就可以了」, 對齊 4.62.2 嗰陣 30 → 4.63.0 收緊到 10)
- ✅ **Try/catch fallback chain 10 → 5 → 3** (defensive only, max 10 應該唔 crash, 兜底 cover 極端 v5 plugin internal crash 情況)
- ✅ **`chartRefs.zigzagSequenceMarkers` 改 `{ handle, markers, setMarkers }` 結構** (4.63.0):
  - `handle` = v5 plugin handle (LightweightCharts.createSeriesMarkers return value)
  - `markers` = array of marker objects (for re-set block 用)
  - `setMarkers` = wrapper function (delegates to `handle.setMarkers`, 4.62.2 re-set block 兼容)
- ✅ **Re-set markers block** (testing-page.js line 1652-1661): 拎 `handle.setMarkers` 優先 (v5 plugin native), fallback chain 拎 mock `setMarkers` (4.62.2 pattern, 50ms 後 setVisibleLogicalRange persist)
- ✅ **Defensive 紫色 ZigZag 線 唔受影響**: 用 `chart.addSeries(LightweightCharts.LineSeries)` 唔受 plugin crash 影響, 即使 v5 plugin 對 marker crash, 紫色線仍然 render

**Cache bust** (跟 2026-08-09 13:10 永久 rule):
- `ALGO_CACHE_BUST` 4.62.3 → 4.63.0
- `?v=2.3.133` → 2.3.134 (CSS + JS)

**凡人話**: 撅 HK.00019 (12 markers) → P1-P10 出. 撅 HK.01888 (49 markers) → P1-P10 出 (之前 4.62.3 拎錯 v4 fallback 死火, 紫色線出 marker 唔出, 4.63.0 fix 拎返). 撅 HK.00981 (90 markers) / HK.00700 (189 markers) → P1-P10 出. 撅完手動 zoom/pan chart → P1-P10 仍然 persist (re-set block 50ms 後 work).

**對應 commit**: `fix(stockpulse): 拎返 v5 createSeriesMarkers plugin API + max 10 + fallback chain 10→5→3 (4.63.0, P 點 marker 對 49+ markers 唔 render fix)` (047ed1e8)



### Dead Code Cleanup 永久 rule (大少 2026-09-02 trigger「帮我清理项目里的冗余代码」, Spec Sync #62)

**凡人話解釋**: 4 个月研发期后, `/Users/zmenai/stockpulse` 仓库累积咗 19 个冇用 file (4-5 月旧 debug script + 0 字节死 DB + 一次性 test + 死 folder) 同 1 个重复实现 (`populate_plates_v2.py`)。大少 2026-09-02 trigger 触发本次 Spec Sync #62 一次性大清理。

**拎走项目 (19 个 + 1 个 modified)**:

| 类别 | 数量 | 内容 |
|------|------|------|
| A 类 — 4-5 月旧 debug script | 7 | `cdp_screenshot.py` / `download_stocks.py` / `test_subscribe.py` / `test_ws_client.py` / `test_ws_debug.py` / `restart_trigger.sh` / `start_trigger.sh` |
| A 类 — 死 DB / 0 字节 | 5 | `stockpulse.db` (根) / `plate_leaders_options` (根) / `backend/stocks.db` / `backend/data/stockpulse.db` / `backend/data/cache.db` |
| A 类 — 一次性 test / HTML | 2 | `test-m9-fix.mjs` / `tmp-zigzag-flag-test.html` |
| A 类 — 0 字节 log | 2 | `trigger.log` / `trigger.log.20260809_193222` |
| A 类 — 死 folder | 2 | `web/src/pages/KlineDebugPage/` / `web/test-results/` |
| C 类 — 重复实现 | 1 | `backend/scripts/populate_plates_v2.py` |
| E 类 — `.gitignore` 优化 | 1 modified | 加 4 条 rule: `miniapp/.env` / `web/test-results/` / `/stockpulse.db` / `/plate_leaders_options` |

**永久 rule**:
- ✅ 4-5 月旧 debug script 永远唔入 git (7 个, 冇任何 .py / .sh / .md / 永久 rule 引用)
- ✅ 0 字节死 DB 永远唔入 disk (5 个, 真正 DB 喺 `backend/stockpulse.db` 73MB + `backend/data/stocks.db` 3MB)
- ✅ 死 folder 永远拎走 (2 个: KlineDebugPage + web/test-results)
- ✅ `.gitignore` 加 4 条 rule 防后加 (含 `miniapp/.env` 防 Telegram token 意外 commit)
- ✅ 重复实现永远拎走 (populate_plates_v2.py — v1 311 行已覆盖全部功能 + 更完整 filter)

**保留嘅嘢** (大少 2026-09-02 confirm):
- 临时一次性 script (B 类 5 个): `tmp_research_v23_subscenarios_v4.py` / `tmp_research_v25_v21subscenarios.py` / `tmp_refresh_178_stocks.py` / `tmp_refresh_55_missing.py` / `tmp_trace_opend_errors.py` — AGENTS.md §「數據處理 Server 內部做 永久 rule」永久 rule 引用咗 v4 + v25 做 evidence
- 4-5 月 backend file (F 类 9 个): `futu_conn/subscription.py` / `services/event_bus.py` / `services/encryption.py` / `services/web_search.py` / `models/stock.py` / `models/group.py` / `models/group_stock.py` / `models/settings.py` / `api/settings.py` — 全部仍用紧
- 死代码注释 (D 类): `backend/api/kline.py:148-149` 嘅 "刪走 dead code" 注释 — 保留作 "凡改必留注" 嘅正面示范
- G 类 6 件 (大少保留): `web/dist/` / `M1-sub-scenario-print-v2.1.0.docx` / `paper-trading-sim.html` / `docs/演算法概念SPECS/*.docx` / `data/transcripts/clean/phase_*.py` / `miniapp/.env`

**凡人話**: 拎走 19 个死 file + 改 `.gitignore` 加 4 条 rule, 根目录少 10 个 file, 0 字节死 DB 由 3 → 0, 死 folder 由 2 → 0, 重复 populate_plates 由 2 → 1。**冇任何 active code 改动**。

**对應 doc**: ARCHITECTURE.md §15.68 (Spec Sync #62)

### KlineCache 全 process singleton + background thread 永久 1 個 (2026-09-02 21:14, Spec Sync #63)

**凡人話解釋**: KlineCache 必須 background health check thread + health state 全部 module-level singleton, 唔可以每次 KlineCache() instantiate 都 spawn 新 thread (會 leak thread, hit macOS kern.maxthread 2048 limit, 返 500 Internal Server Error)。

**Root cause trigger**: 大少 2026-09-02 21:14「輸入數個股票後就出現 Backend M1 algorithm 500 Internal Server Error, 不能更新圖表」— uvicorn process thread count 2048 (max), KlineCache.__init__ `RuntimeError: can't start new thread`, frontend 5 秒 polling `/api/algorithms/health/futu` 嗰度 instantiate KlineCache + leak 1 thread per polling + 撳跑 M1 instantiate + leak 1 thread per click。

**永久 rule**:
- ✅ KlineCache background health check thread 全 process 共用 1 個 (module-level singleton, 用 `_health_check_thread_started` flag + lock 去重)
- ✅ KlineCache health state (is_healthy, last_check_at, last_error, consecutive_failures) 必須係 module-level (`_HEALTH_STATE`), 唔可以 per-instance (避免 background thread 寫入錯 instance 嘅 state)
- ✅ KlineCache schema init 必須係 module-level lazy init (1 次, 用 `_schema_initialized` flag + lock 去重)
- ✅ KlineCache 拎走 `self._start_health_check_thread()` + `self._run_health_check_sync()` + `self._futu_health` + `self._futu_health_lock` (改 module-level)
- ✅ KlineCache 保留 instance method `get_futu_health()` / `_start_health_check_thread()` / `_run_health_check_sync()` (deprecate wrapper, call module-level function, 對齊 backward compat)
- ✅ KlineCache 保留 `self.db_path` (immutable config, test 用 db_path override 仍然 work)
- ✅ KlineCache caller 必須用 module-level singleton pattern (e.g. `from backend.services.kline_cache import KlineCache` + module-level `_cache = KlineCache()`, 對齊 kline.py line 15 pattern)
- ✅ KlineCache caller 拎 health state 必須用 module-level `get_futu_health()` function (唔係 `cache.get_futu_health()` instance method, 雖然兩個都 work)
- ✅ 之後改 KlineCache 嗰陣, 必保留 background thread (唔好拎走 `_ensure_health_check_thread` call)
- ✅ 之後 caller 改 KlineCache 嗰陣, 必須用 module-level singleton (e.g. `from backend.services.kline_cache import kline_cache` 或 module-level `_cache = KlineCache()`), 唔可以 request handler 入面 instantiate

**套用**: 任何 StockPulse backend service, 跟 KlineCache pattern 設計 (module-level singleton + 1 個 background thread + module-level state)

**對應 commit**: 即將 push (跟 Spec Sync #62 之後 #63)
**對應 doc**: HANDOVER.md §R 延伸 + AGENTS.md "KlineCache 全 process singleton" section

### algorithm_progress.py 死碼 thread leak 永久 fix (2026-09-02 21:14, Spec Sync #63)

**凡人話解釋**: algorithm_progress.py 之前每次 `spawn_m9_with_progress` 嗰陣 spawn 1 個 cleanup thread (死碼, production 冇 caller), 改 module-level 1 次 startup, 避免將來用返就 leak thread。

**永久 rule**:
- ✅ algorithm_progress.py cleanup thread 全 process 共用 1 個 (module-level singleton, 用 `_cleanup_thread_started` flag + lock 去重)
- ✅ 拎走 `spawn_m9_with_progress` 嗰個 per-request `threading.Thread(target=_cleanup_expired, daemon=True).start()` 死碼 (改 module-level `_ensure_cleanup_thread_started`)
- ✅ cleanup 改 background loop (60 秒 1 次清 expired progress), 唔係 per-request trigger
- ✅ 之後加 background thread / cleanup 嗰陣, 必須 module-level singleton, 唔可以 per-request / per-call 啟動

**對應 commit**: 即將 push (跟 Spec Sync #62 之後 #63)
**對應 doc**: AGENTS.md "algorithm_progress.py 死碼 thread leak 永久 fix" section

### `/api/algorithms/health/threads` monitoring endpoint 永久 rule (2026-09-02 21:14, Spec Sync #63)

**凡人話解釋**: Backend 必須提供 `/api/algorithms/health/threads` endpoint 顯示 process thread count, 大少可以隨時 check thread leak 預防再爆。

**永久 rule**:
- ✅ Backend 必須提供 `GET /api/algorithms/health/threads` endpoint, 返 thread count + KlineCache health state
- ✅ Response shape: `{is_healthy, kline_health_check_threads, threading_enumerate_count, system_thread_count, thread_limit_warning, thread_limit_critical, thread_limit_emergency, thread_limit_max, kline_cache_state}`
- ✅ Threshold: `thread_limit_warning: > 200`, `thread_limit_critical: > 500`, `thread_limit_emergency: > 1000`, `thread_limit_max: 2048` (macOS kern.maxthread 默認)
- ✅ Frontend 之後 sprint 拎返 (out of scope 呢個 plan): polling endpoint 5 秒 1 次, > 200 顯示黃色 banner, > 500 紅色 banner, > 1000 emergency refresh 提示
- ✅ 對齊 HANDOVER.md §S 永久 rule 嘅 frontend FutuOpenD banner pattern (之後做 banner warning)

**對應 commit**: 即將 push (跟 Spec Sync #62 之後 #63)
**對應 doc**: AGENTS.md "/api/algorithms/health/threads monitoring endpoint" section

### M1 強升/強跌 trigger v2.2.0 永久 rule (大少 2026-09-04 10:34 trigger)

**凡人話解釋**: 強升 / 強跌 sub-scenario trigger 加 P 點趨勢確認, 確保「排列有 + 放量」嘅 case 真係趨勢延續緊, 而唔係「排列對但峰頂已經唔再抬高」嘅假強趨勢。拎唔夠 4 個 P 點 (新股 / Z 點太短) → fall through 去初升 / 初跌。

**強升 trigger (v2.2.0 新, 6 條件)**:
- ✅ 排列 bull (MA5>MA10>MA20>MA60)
- ✅ 全部 MA 斜率正
- ✅ 放量 (volume_signal=expanding)
- ✅ `zz_ok_4` (拎夠 4 個 P 點 + 4 個 type)
- ✅ **P1/P3.type=Peak** (峰頂確認) + **P2/P4.type=Trough** (谷底確認) (大少 9月4日 10:34 trigger: P3=Peak)
- ✅ **P1>P3** (峰頂抬高) + **P2>P4** (谷底抬高)

**強跌 trigger (v2.2.0 新, 6 條件, 對稱)**:
- ✅ 排列 bear
- ✅ 全部 MA 斜率負
- ✅ 放量
- ✅ `zz_ok_4`
- ✅ **P1/P3.type=Trough** + **P2/P4.type=Peak** (大少 9月4日 10:34 trigger: P3=Trough)
- ✅ **P1<P3** (谷底降底) + **P2<P4** (峰頂降底)

**永久 rule**:
- ✅ 強升 / 強跌 trigger 必須加 P 點形態確認 (P1/P2/P3/P4 + Peak/Trough type), 唔可以只靠「排列 + 斜率 + 放量」
- ✅ 強升加 `P1/P3.type=Peak` + `P2/P4.type=Trough` (P1/P3 同 type, P2/P4 同 type, alternating sequence)
- ✅ 強跌加 `P1/P3.type=Trough` + `P2/P4.type=Peak` (對稱)
- ✅ 拎唔夠 4 個 P 點 → fall through 去初升 / 初跌, 唔好 trigger 強趨勢
- ✅ 之後加 P 點 type check 必須跟 9月3日 11:00 永久 rule (P 點 type 命名 Peak/Trough, 唔用 high/low)
- ✅ 之後加 P 點 trigger 必須附 ≥ 3 隻真實 stock 例子 verify (8月16日 19:21 永久 rule)

**凡人話**: 改動前「排列 bull + 放量」即 trigger 強升 (e.g. 太古 25% 升幅但峰頂唔再抬高), 改動後要峰頂抬高 (P1>P3) + 谷底抬高 (P2>P4) 先 trigger, false positive 減少。

**290 隻 stock 跑出嚟分佈 (9月4日 14:04 batch run)**:
- 強升 12 隻 (4%) — HK.00005 匯豐 / HK.00939 建行 / HK.01398 工行 / HK.02388 中銀香港 / HK.03328 交通銀行 / HK.03968 招行 / HK.03988 中行 / 等等
- 強跌 7 隻 (2%) — HK.00010 恒隆 / HK.00034 九龍建業 / HK.00101 恒隆地產 / 等等 (地產股為主)
- 觀察: 銀行股多 trigger 強升, 地產股多 trigger 強跌

**對應 commit**: 即將 push (大少 verify 完 stock 例子先 commit + push, Spec Sync #64+)
**對應 doc**: `docs/research/AS-03-cycle-detection/M1-V22-RESEARCH.md` (9 個 sub-scenario 簡單算法表 已 update 強升/強跌 row v2.2.0)

### M1 全面 Adaptive 願景 v2.3.0 (大少 2026-09-04 15:03 trigger, ⏸️ 暫停)

**凡人話解釋**: 大少問「既然每隻股票用唔同自適應門檻, 可唔可以做到全面自動調整去適應每隻股票?」答案: **部分已經 adaptive, 仲有 8 個維度係寫死嘅**。v2.2.0 adaptive thresholdPct 只係第一步, 全面 adaptive 嘅願景係「**每隻股票用自己嘅算法**」(細股 vs 大股, 高波動 vs 低波動股 自動用唔同參數)。

**大少 9月4日 15:03 trigger**: 「先記低呢個公式同功能, 我想再詳細了解佢之後先用, 暫時我哋先唔用但你要記住佢我之後問你你要睇返我」

**🚨 暫停狀態**: 唔郁 code, 唔 commit, 唔 push, 等大少詳細了解後先決定

**Tier 1 — 已做 ✅ (1 個維度, v2.2.0 9月21日 18:37 永久 rule)**
- ✅ `thresholdPct` (自適應門檻) — `clamp(20日 ATR% × 1.5, 0.5%, 5%)`, 每隻股用自己波幅

**Tier 2 — 簡單可做 (4 個維度, 1-2 sprint)**
- ⏸️ `volumeLookback` — 高波動股用長 lookback, 低波動股用短, formula: `clamp(ATR% × 100, 3, 10)` 日
- ⏸️ `slopeLookback` — 同上
- ⏸️ `volumeBoostThreshold` — formula: `1.0 + ATR% × 5` (高波動 boost 門檻高)
- ⏸️ `maPeriods` — 按股價分組 (< $10 用 [3,7,14,30], $10-100 用 [5,10,20,60], > $100 用 [10,20,40,120])

**Tier 3 — 中等 (3 個維度, 2-4 sprint)**
- ⏸️ P 點 window — 按 K 線歷史長度分組 (< 1 年用 4 個, 1-3 年用 7 個, > 3 年用 10 個)
- ⏸️ `spreadConfidenceScale` — 按股價 adapt ($5 用 0.15, $50 用 0.10, $500 用 0.05)
- ⏸️ Cycle threshold (短期/長期) — 按波幅 adapt

**Tier 4 — 進階 (3 個維度, 4-6 sprint, 跨 module)**
- ⏸️ M8 Decision engine 9 個 module → 最終判定權重, 每隻股用唔同權重
- ⏸️ M9 walk-forward folds — 高波動股 5 折, 低波動股 2 折
- ⏸️ M7 Synthesizer 信心闊值 — 每隻股用唔同信心門檻

**永久 rule (大少 9月4日 15:03 trigger)**:
- ✅ **呢個全面 Adaptive 願景 v2.3.0 暫停, 唔郁 code**
- ✅ 大少日後 trigger「用返 v2.3.0 adaptive」/「M1 全面 adaptive」/「Tier 2 開始做」等 keyword, 我要 recall 返呢個 section, present 畀大少 confirm 先郁
- ✅ 改動仍要跟返 8月29日 22:44 永久 rule「所有改動要 confirm」+ 8月16日 19:21 永久 rule「改 algorithm 附 ≥ 3 隻 stock 例子 verify」
- ✅ 每個 Tier 開始前必須拎 ≥ 1 隻 stock 跑 baseline (現有 verdict) + 改動後 verdict 對比, 證明真係改善
- ✅ Tier 1 已做 (9月21日 永久 rule), Tier 2-4 全部暫停, 大少詳細了解後先揀邊個 Tier 先做

**Trade-off (大少日後揀方向時要考慮)**:
- ✅ 好處: 細股 vs 大股 verdict 自動適合, 唔使手動 override, 跨股票比較更公平 (自己跟自己比)
- ❌ 壞處: 複雜性高, 難 debug (每隻股參數唔同), Spec doc 維護成本高, A/B test 較難做

**凡人話總結**: 「**均線散度對自適應門檻**」只係 v2.2.0 第一步, 全面 adaptive 願景係「**每隻股票用自己嘅算法**」(v2.3.0 願景), 大少話暫停等詳細了解。

**大少日後 trigger 例子**:
- 「用返 v2.3.0 adaptive」→ recall 呢個 section, 確認做邊個 Tier
- 「Tier 2 開始做」→ 做 volumeLookback / slopeLookback / volumeBoostThreshold / maPeriods 4 個維度
- 「Tier 3 開始做」→ 做 P 點 window / spreadConfidenceScale / cycle threshold
- 「Tier 4 開始做」→ 做 M8 / M9 / M7 跨 module adaptive

**對應 doc**: AGENTS.md 「M1 全面 Adaptive 願景 v2.3.0 (大少 9月4日 15:03 trigger, 暫停)」section
**對應 commit**: 暫時無 (大少話暫停, 等詳細了解)

### M1 上升回調 / 下跌回調 v2.3.0 C 方案 trigger 永久 rule (大少 2026-09-04 15:22 trigger)

**凡人話解釋**: 上升回調 / 下跌回調 (downtrend_bounce) sub-scenario trigger 改成 6 個條件, 用 P 點形態確認趨勢仲在 + MA5/MA60 斜率 + spread 過濾。拎走舊 MA10 條件 (A/B test 證明拎走拎到 15 隻新信號) + 加 P 點 + MA5/MA60 斜率 + spread 過濾 (C 方案, 拎返 spread 過濾防 MA 線 noise)。對齊強升/強跌 v2.2.0 P 點 trigger pattern, 9 個 sub-scenario 入面 4 個 (強升/強跌/上升回調/下跌回調) 用同一個 P 點 logic。

**上升回調 trigger (v2.3.0 新, 6 條件, C 方案)**:
- ✅ `zz_ok_4` (拎夠 4 個 P 點 + 4 個 type)
- ✅ `P2.type == "Peak"` (確認 P2 係峰頂, alternating sequence)
- ✅ `P1 > P3` (谷底抬高, P1/P3 同 Trough, higher low — 上升趨勢確認)
- ✅ `P2 > P4` (峰頂抬高, P2/P4 同 Peak, higher high — 上升趨勢確認)
- ✅ `slope_ma60 > 0` (長期仲升, 趨勢未變)
- ✅ `slope_ma5 < 0` (短期急跌, 真係回調緊)
- ✅ `max_spread_pct >= cfg["thresholdPct"]` (C 方案: spread 過濾防 MA 線 noise)

**下跌回調 (downtrend_bounce) trigger (v2.3.0 新, 6 條件, 對稱, C 方案)**:
- ✅ `zz_ok_4`
- ✅ `P2.type == "Trough"` (確認 P2 係谷底)
- ✅ `P1 < P3` (峰頂降底, P1/P3 同 Peak, lower high)
- ✅ `P2 < P4` (谷底降底, P2/P4 同 Trough, lower low)
- ✅ `slope_ma60 < 0` (長期仲跌)
- ✅ `slope_ma5 > 0` (短期急升, 真係反彈緊)
- ✅ `max_spread_pct >= cfg["thresholdPct"]` (C 方案)

**拎走咗嘅條件** (vs 舊 trigger):
- ❌ `all_short_slope_negative` (MA5+MA10 兩條線, A/B test 證明拎走拎到 15 隻新信號)
- ❌ 拎走 MA10 條件簡化 trigger

**永久 rule**:
- ✅ 上升回調 / 下跌回調 trigger 必須加 P 點形態確認 (P2.type + P1>P3 + P2>P4), 唔可以只靠 MA + spread
- ✅ 強升 / 強跌 / 上升回調 / 下跌回調 4 個 sub-scenario 用同一個 P 點 pattern, 唔可以分別用唔同 logic
- ✅ C 方案 spread 過濾永久保留 (max_spread_pct >= thresholdPct), 拎走 spread 嘅 trigger 會有 MA 線 noise 風險
- ✅ 拎唔夠 4 個 P 點 → fall through 去橫行, 唔好 trigger 上升回調 / 下跌回調
- ✅ 之後加 P 點 type check 必須跟 9月3日 11:00 永久 rule (P 點 type 命名 Peak/Trough, 唔用 high/low)
- ✅ 之後加 P 點 trigger 必須附 ≥ 3 隻真實 stock 例子 verify (8月16日 19:21 永久 rule)
- ✅ P 點 alternating 假設要驗證: P1/P3 同 type, P2/P4 同 type (Z 點 well-defined mathematical property)

**A/B Test 290 隻 stock 結果 (大少 9月4日 15:18 batch run)**:
- 舊 trigger fire: 32 隻 (上升回調 18 + 下跌反彈 14)
- 新 trigger (C 方案) fire: 預計 18-22 隻 (整體嚴 28%, 加 spread 過濾會比 B 方案多 1-2 隻)
- 新 trigger 揀走舊 trigger 嘅疑似 false positive: 24 隻 (P 點形態唔似真回調, 舊 trigger 揀錯)
- 新 trigger 拎到舊 trigger 漏嘅新信號: 15 隻 (拎走 MA10 之後 catch)
- 兩個都 fire (agree): 8 隻 (典型 case, 兩個都 catch)

**3 個 detail case** (大少可以拎嚟 verify):
- ✅ HK.00002 (both fire) — 典型上升回調, P1=75.85>P3=74.77 + P2=79.17>P4=77.82 + P2.type=Peak + MA5=-1.35% + MA60=+0.51% + spread 2.43% >= 1.81%
- 🆕 HK.00003 (new only) — 拎走 MA10 catch 到, P1=7.04>P3=6.60 + P2=7.47>P4=7.06 + MA5=-2.12% + MA60=+0.52% + spread 6.34% >= 2.93%
- ⚠️ HK.00022 (old only) — P2=Peak 唔似下跌回調, 舊 trigger 揀錯, 新 trigger 揀走

**對應 commit**: 即將 push (大少 verify 完 stock 例子先 commit + push, Spec Sync #65+)
**對應 doc**: `docs/research/AS-03-cycle-detection/M1-V22-RESEARCH.md` (9 個 sub-scenario 簡單算法表 已 update 上升回調 / 下跌反彈 row v2.3.0)

### M1 「均線散度對自適應門檻」中文名永久 rule (大少 2026-09-04 14:59 trigger)

**凡人話解釋**: 大少問 max_spread_pct 同 thresholdPct 嘅公式有冇中文名, 等日後可以容易 reference。我整理兩個 spec doc 已經用緊嘅名, 畀大少揀, 大少確認用呢個命名 convention。

**中文名 (跟 spec doc 官方用字, `docs/research/AS-03-cycle-detection/MODULE-01-MA-ALIGNMENT.md`)**:
- **max_spread_pct** → **「均線散度」** (MA Spread, 凡人話: 4 條均線散開嘅程度)
- **thresholdPct** → **「波幅自適應門檻」** (簡稱 **「自適應門檻」** / **「ATR 門檻」** / **「波幅門檻」**)

**短 reference (大少 9月4日 14:59 trigger, 之後 trigger 我會自動 recall)**:
- 講 max_spread_pct: 「**均線散度**」(e.g. 「均線散度 3.5%」)
- 講 thresholdPct: 「**自適應門檻**」/「**ATR 門檻**」/「**波幅門檻**」(e.g. 「自適應門檻 2.4%」)
- 講 trigger 條件: 「**均線散度對自適應門檻**」(e.g. 「均線散度 ≥ 自適應門檻」)

**核心精神**: 「**自己跟自己比**」— 每隻股用自己嘅 20 日波幅定門檻, 高波動股門檻大, 低波動股門檻細, 跨股票比較更公平。

**永久 rule**:
- ✅ 之後大少 trigger 「均線散度」/「自適應門檻」/「ATR 門檻」/「波幅門檻」, 我自動 recall 呢個 section
- ✅ 之後寫 M1 spec doc 用呢個中文名 (統一)
- ✅ 之後 M1 verdict meta 嘅 UI display 跟呢個命名 (e.g. `thresholdPctUsed` UI 顯示為「自適應門檻」)

**Spec doc 公式 reference**:
- 均線散度 = `(max(MA5/10/20/60) - min(MA5/10/20/60)) / min(MA5/10/20/60)` — 4 條 MA 各自唔同窗口 (5/10/20/60 日平均)
- 自適應門檻 = `clamp(20日平均 TR / 最新 close × 1.5, 0.5%, 5%)` — adaptive ATR% × 1.5

**對應 doc**: AGENTS.md 「M1 『均線散度對自適應門檻』中文名永久 rule」section

---

### M1 拎走 fall through placeholder + 初升 / 初跌獨立 trigger (2026-09-04 17:22 + 21:48 trigger)

**凡人話解釋**: 拎走 M1 嘅「fall through placeholder」邏輯 (即係強升 / 強跌 唔成立就跌入初升 / 初跌), 改用獨立 trigger 條件 (P 點剛起步 + MA60+MA5 雙斜率), 凡人話改名「初升 / 初跌」。

**背景**:
- 之前 weak_uptrend 係 fall through placeholder, 強升 6 條件「任何一個」唔成立就跌入嚟
- 呢個邏輯造成: 「排列對但 P 點唔配合」都會 trigger 初升, 凡人話 label 寫「初上升」但 trigger 條件好雜
- 大少 9月4日 17:12 trigger: 用 P 點剛起步 (谷底抬高 + 峰頂未突破) + MA60+MA5 雙斜率做獨立 trigger
- 大少 9月4日 21:48 trigger 確認命名: 叫「初升」, 唔叫「新初升」, 強升完全唔郁

**Trigger 條件**:
- **初升** (weak_uptrend, 凡人話「初升週期」):
  - `slope_ma60 > 0` (長期趨勢向上)
  - `slope_ma5 > 0` (短期仲有動能)
  - `zz_ok_4` (拎到 4 個 P 點)
  - `P2=Trough` (alternating 確認)
  - `P1 <= P3` (峰頂未突破 — Lower High)
  - `P2 > P4` (谷底抬高 — Higher Low)
  - Fallback: 拎唔夠 4 個 P 點 → fall through 去下一個 elif
- **初跌** (weak_downtrend, 凡人話「初跌週期」): 對稱
  - `slope_ma60 < 0` + `slope_ma5 < 0` + `zz_ok_4` + `P2=Peak` + `P1 >= P3` + `P2 < P4`

**凡人話核心**:
> 谷底抬高 + 峰頂未突破 = 上升趨勢剛起步, 仲喺整固階段
> 峰頂降底 + 谷底未跌穿 = 下跌趨勢剛起步, 仲喺整固階段

對比強升: 強升要 P1>P3 (峰頂抬高, 真突破); 初升要 P1<=P3 (峰頂未突破, 整固中)。

**Key 保留 + 凡人話改名 (方案 B)**:
- `weak_uptrend` / `weak_downtrend` Python key 唔改 (frontend / backend 唔 break)
- CYCLE_LABELS dict 入面凡人話由「初上升週期」→「初升週期」
- frontend `adapter.mjs` ZMEN_SUB_SCENARIO_LABELS / MA_V2_CYCLE_LABELS 凡人話 label 同樣改
- frontend M1_TOOLTIPS / STRATEGY_RECOMMENDATIONS / 教學卡 / verdict render 凡人話內容重寫 (因為意義由 fall through 改做 P 點剛起步)
- Zmen 凡人話保留「部分升 rule (F) 觸發」描述 (Zmen 邏輯唔變), M1 凡人話改寫

**影響範圍** (8月16日 19:21 永久 rule verify 範圍):
- ✅ M2-M9 backend algorithm: 0 直接影響 (M2-M9 唔識分 sub_scenario, 只睇 UP/DOWN/SIDEWAYS 3 個 high-level state)
- ⚠️ M1 backend 內部: 拎 STATE_MAP / CYCLE_LABELS 0 個 entry (因為 key 唔改), 拎走 line 509/536 拎 2 個 else 邏輯, 加新 trigger 2 個 elif
- ⚠️ Frontend `adapter.mjs`: 改 16 個 reference (凡人話 label 4 + M1_TOOLTIPS 2 + STRATEGY_RECOMMENDATIONS 2 + 教學卡 4 + verdict render 2 + 顏色 0 + key reference 0)
- ⚠️ Tests: test_ma_alignment.py 拎 9 個 sub-scenario label test
- ⚠️ AGENTS.md / ARCHITECTURE.md / M1-V22-RESEARCH.md 文件 reference

**永久 rule**:
- ✅ M1 拎走 fall through placeholder 邏輯, 改用獨立 trigger (P 點剛起步 + MA60+MA5 雙斜率)
- ✅ 凡人話 label 「初上升週期」→「初升週期」(key `weak_uptrend` 保留)
- ✅ 凡人話 label 「初下跌週期」→「初跌週期」(key `weak_downtrend` 保留)
- ✅ 強升 trigger 完全唔郁 (拎走 MA10+MA20 強升 trigger 部分 cancel)
- ✅ 改呢個 trigger 必須附 ≥ 3 隻真實 stock 例子 verify (8月16日 19:21 rule)
- ✅ 改 sub-scenario trigger 要即刻 update M1-V22-RESEARCH.md 簡單算法表 (9月3日 12:10 rule)
- ✅ 改 frontend 凡人話要做 2 個獨立版本: Zmen 保持 (Layer 1 邏輯唔變) + M1 重寫 (意義由 fall through 改做 P 點剛起步) (9月4日 21:03 trigger)
- ✅ 之後大少 trigger 「初升」/「初跌」/「弱趨勢」/「Priority 3 弱趨勢」即指呢個獨立 trigger
- ✅ 之後 M1 frontend tooltip 寫「P 點剛起步」/「谷底抬高 + 峰頂未突破」/「MA60+MA5 雙斜率」即指呢個 trigger pattern
- ✅ 之後 spec doc / research script / AGENTS.md reference 用「初升」/「初跌」呢個命名, 唔再用「初上升」/「初下跌」(舊 fall through 邏輯)
- ✅ 之後 backend algorithm trigger 加新 sub-scenario 都要有獨立 trigger 條件, 唔可以再用 fall through 邏輯 (拎走 fall through 永久 rule)

**Priority 結構** (拎走 fall through 後):
1. Priority 1: 到頂 (decelerating_up) / 到底 (decelerating_down)
2. Priority 2: 強升 (strong_uptrend) — 全斜率 + 放量 + P 點
3. Priority 2.5: **初升 (weak_uptrend) — MA60+MA5 雙斜率 + P 點剛起步** [新]
4. Priority 3: 強跌 (strong_downtrend) — 對稱強升
5. Priority 3.5: **初跌 (weak_downtrend) — MA60+MA5 雙斜率 + P 點剛起步** [新]
6. Priority 4: 上升回調 (uptrend_correction) v2.3.0 C 方案
7. Priority 5: 下跌回彈 (downtrend_bounce) v2.3.0 C 方案
8. Default: 橫行 (sideways)

**對應 commit**: 即將 push (Spec Sync #65+: 強升 v2.2.0 + 上升回調 v2.3.0 C 方案 + 拎走 fall through placeholder + 初升/初跌 trigger + frontend 凡人話 update)
**對應 doc**: M1-V22-RESEARCH.md 「🔼 Priority 3 - 初升 / 初跌」section
**對應凡人話 trigger**: 大少 9月4日 17:12 + 21:48 trigger
**對應 commit**: 暫時無 (純 spec 命名, 唔改 code)

### M7 NAN_RESULT 永久 fix — A+B+C 3 個 fix 永久 rule (大少 2026-09-05 22:42 trigger)

**凡人話解釋**: 大少 跑 M7 算法 (Synthesizer) 嗰陣, verdict 嘅 ssi_score / grade_score 會偶然出 NaN, frontend 即刻 inject 🔴 NAN_RESULT warning。Root cause 係 upstream module verdict 嘅 `confidence` 係 NaN, 污染 ssi 計算。

**🐛 Root cause 3 個問題**:

1. **hl_structure algorithm meta 冇 `state` field** (Fix A) — hl_structure 內部 cycle 係 "uptrend" / "downtrend" / "sideways" (lowercase), 但 meta 唔 expose `state` 落 contract 標準 field, 其他 5 個 module (ma_alignment / trendline / indicators / volume_price / volatility) 全部 meta 有 `"state": "UP"|"DOWN"|"SIDEWAYS"` (uppercase)。`algorithm_runner.py:273` 做 `state: upstream_meta.get("state")` 拎到 None, `contract.py:53-58` Literal validation 失敗 (None 唔喺 list), silent drop, M7 只拎到 5/6 module, 出 MODULE_PARTIAL warning (5/6)。Frontend `decisionEngineToStandardVerdict` 嗰度 defensive default `state: 'SIDEWAYS'`, 所以 frontend 拎齊 6 個 (但全部默認 SIDEWAYS, alignment=1, NaN 容易 trigger)。

2. **Backend M7 algorithm `_compute_ssi` 冇 NaN guard** (Fix B) — `_compute_ssi` 嗰度 conf_avg = `sum(conf * weight) / total_weight`, 如果 conf 係 NaN, conf_avg = NaN, ssi_score = NaN, grade_score = NaN (因為 grade_score = ssi * 0.6 + alignment * 100 * 0.4)。之前 backend 唔 inject NAN_RESULT warning, 只有 frontend `adapter.mjs:5928` inject, 對齊永久 rule §Module Warning v1.1.0 propagation chain (M1-M6 → M7 → M8 → M9)。

3. **Frontend `decisionEngineToStandardVerdict` confidence clamp 唔識處理 NaN** (Fix C) — `Math.max(0, Math.min(1, NaN)) = NaN` (NaN 任何 math 運算都係 NaN), frontend 救唔到 NaN confidence。

**🔧 Fix 永久 rule** (3 個 fix, 全部 done):

**Fix A — hl_structure 加 state field 永久 rule**:
- ✅ `hl_structure/algorithm.py` 加 `HL_STRUCTURE_STATE_MAP = {"uptrend":"UP", "downtrend":"DOWN", "sideways":"SIDEWAYS"}` dict
- ✅ 3 個出口位 (empty case / 唔夠 case / main case) 全部加 `"state": ...` field, 對齊 `contract.py ModuleVerdictMeta` Literal
- ✅ 對齊 `ma_alignment STATE_MAP` pattern, candidate 1-to-1 map 返 uppercase
- ✅ 之後任何新 M1-M12 module algorithm 寫 meta 必須有 `state` field, 唔可以得 `cycle` (lowercase 內部 string), 防止 contract validation silent drop
- ✅ 之後 contract.py 加新 state literal 嗰陣, 所有 algorithm 一齊 update, 唔好漏

**Fix B — Backend M7 NaN guard + NAN_RESULT warning 永久 rule**:
- ✅ `synthesizer/algorithm.py` 加 `import math`
- ✅ `_compute_ssi` 後加 `math.isfinite(ssi_score)` check, 唔係 finite → fallback 0 + nan_fields.append("ssi_score")
- ✅ `alignment_score_after_penalty` 一樣 check
- ✅ `grade_score` 後加 check, 唔係 finite → fallback 0 + grade 落 F + nan_fields.append("grade_score")
- ✅ `_aggregate_warnings(verdicts, nan_fields=nan_fields)` 接受 nan_fields 參數, 任何 nan → inject 🔴 NAN_RESULT warning
- ✅ 對齊 frontend `adapter.mjs:5927` 永久 rule, backend / script 跑 M7 都會見到 warning
- ✅ 之後任何 backend algorithm 計 final score (ssi_score / grade_score / alignment_score) 都要 `math.isfinite` check, 唔可以讓 NaN 流出 verdict

**Fix C — Frontend confidence NaN-safe clamp 永久 rule**:
- ✅ `adapter.mjs:5607` confidence clamp 改 `Number.isFinite(verdict.confidence) ? Math.max(0, Math.min(1, verdict.confidence)) : 0`
- ✅ 先 check finite (NaN / Infinity 都唔 isFinite), 唔係 → fallback 0
- ✅ 之後任何 frontend `Math.max(0, Math.min(1, x))` pattern 都要加 `Number.isFinite(x)` check, 唔可以靠 math 救 NaN
- ✅ 對齊 backend M7 fix, frontend / backend 兩邊都 NaN-safe

**對應 commit**: 即將 push (Spec Sync: M7 NAN_RESULT 永久 fix — A+B+C 3 個 fix)
**對應 doc**: docs/research/AS-03-cycle-detection/MODULE-02-HL-STRUCTURE.md (state field contract) + MODULE-07-SYNTHESIZER.md (NaN guard 永久 rule) + MODULE-WARNING-SYSTEM.md NAN_RESULT backend injection
**對應凡人話 trigger**: 大少 2026-09-05 22:42 報 bug「M7 算法跑 00981 出 Error: NAN_RESULT」+ 確認要做 A+B+C 3 個 fix

### M1 強升/強跌 trigger 拎走放量, 放量變 confidence indicator (大少 2026-09-06 08:00, 改寫 08:10)

**凡人話解釋**: 之前 M1 強上升/強下跌 trigger 要求「排列 + 斜率 + 放量」三個條件同時成立, 拎走後 trigger 純睇技術面 (排列 + 斜率 + P 點), 放量由 trigger 條件變成 confidence indicator — frontend verdict card 顯示**藍字「🔵 放量確認」(高信心)** 或 **紅字「🔴 量能未確認」+ 影響解讀 (低信心/假突破風險)** 畀大少留意。

**永久 rule**:
- ✅ M1 v2.3.0 強升/強跌 trigger **永久拎走** `volume_signal == "expanding"` 條件
  - 強升 trigger: `is_bullish + all(calc_slope > 0) + zz_ok_4 + P 點交替 + 峰頂抬高 + 谷底抬高`
  - 強跌 trigger (對稱): `is_bearish + all(calc_slope < 0) + zz_ok_4 + P 點交替 + 谷底降底 + 峰頂降底`
- ✅ Verdict meta 加新 field `volumeConfirmed: bool` — 強升/強跌 + `volume_signal == "expanding"` → `True`, 否則 `False`
  - Backend 公式: `"volumeConfirmed": sub_scenario in ("strong_uptrend", "strong_downtrend") and volume_signal == "expanding"`
- ✅ Frontend testing page `renderMAAlignmentV2Result` data-summary 加 conditional 兩種 case (只 render 強升/強跌):
  - **藍字**「🔵 放量確認」 (color #1E88E5, font-weight 700) — `meta.volumeConfirmed = True`, 代表技術面 + 量能齊確認 (高信心)
  - **紅字**「🔴 量能未確認」 (color #C0392B, font-weight 700) + 紅字「影響解讀」+ 解讀文字 (color #C0392B, font-size 12px, line-height 1.5) — `meta.volumeConfirmed = False`, 代表技術面對齊但量能唔配合 (低信心/假突破風險)
- ✅ 影響解讀文字 (凡人話): 「技術面 (排列+斜率+P點) 對齊強趨勢, 但成交量 {shrinking/持平} ({錢退緊/錢跟唔足}), 量能未確認趨勢真實性。可能係 (1) 假突破 / (2) 蓄勢待發 / (3) 早期階段。留意後續 1-2 週成交量變化, 放量就確認, 持續縮量就要小心」
- ✅ 紅藍位置: verdict card data-summary 內, 喺「基礎信心」row 下面
- ✅ 拎走原因 (大少 A/B test evidence): 232 隻 stock 對比, 拎走放量 trigger 後 14 隻 stock verdict 由 sideways 升/跌落強趨勢 (6.0%), 13/14 原本就 volume=neutral, 1/14 volume=shrinking — 即係原本 trigger 條件 skip 緊「技術面對齊但量能未確認」嘅 boundary case, 拎走令 verdict 更貼近技術面, 量能用 color 提示區分高/低信心

**對應 commit**: 即將 push (Spec Sync: M1 強升/強跌 trigger 拎走放量 + 紅字 confidence indicator)
**對應 code 改動 (5 個 file)**:
- `backend/algorithms/ma_alignment/algorithm.py` line 525-528, 604-608, 807-810: 拎走 2 處 trigger 放量 + 加 meta.volumeConfirmed
- `backend/api/algorithms.py` line 58-66: 拎走 disable_volume query param (永久)
- `algorithms/AS-03-cycle-detection/adapter.mjs` line 4683: renderMAAlignmentV2Result 加 conditional volumeConfirmed row
- `testing-page/testing-page.js` line 581: ALGO_CACHE_BUST 4.66.8 → 4.67.0
- `testing-page/index.html` line 10, 192: ?v=2.3.145 → ?v=2.3.146
**對應 doc**: ARCHITECTURE.md「純 branch 還原點永久 rule」段 + MODULE-01-MA-ALIGNMENT.md (改 trigger 描述, 拎走「放量」, 加 volumeConfirmed field)
**對應凡人話 trigger**: 大少 2026-09-06 07:30 trigger「先做個測試對比, 如果把強升和強跌的放量拿走」+ 232 隻 stock 對比 evidence + 08:00 confirm「放量不要放到強升和強跌裡, 但我想要有放量的提示, 例如該股的強升強跌如果Trigger到放量, 你要在結果裡用紅色字給我提示」+ 08:10 改寫「我弄錯了, 如果是放量的, 用藍色字, 如果沒有達到放量的, 用紅色字寫明狀況和有什麼影響解讀」
**套用情境**: 之後任何 sub-scenario trigger 拎走/加條件必須: (1) 先用 A/B test 對比 ≥30 隻 stock 拎 evidence (2) 拎走嘅條件如果有保留 value, 變 confidence indicator 唔好直接刪 (3) frontend 顯示規則跟 v2.3.0 永久 rule 嘅 volumeConfirmed 模式 (backend meta field + testing page conditional row + 藍字/紅字二選一 + 影響解讀)

### 「先備份, 後動工」流程永久 rule (大少 2026-09-07 11:48 trigger)

**凡人話解釋**: 大少 9月7日 11:45 plan 批准 M2 v0.4.0 5-layer evidence-based 優化, 11:48 trigger「你先做備份和一鍵還原, 之後就可以開始」— 改 algorithm 之前必先 set Sscript 還原點 (annotated tag + backup branch + Sscript + verify Backup Admin Page can_restore=true), 對齊 對齊上方「純 branch 還原點永久 rule」+ 12:08 user memory 永久 rule。

**流程 (Step P1-P5)**:
- **P1**: Git tag + branch (備份當前 working state)
  - `git tag -a "restore-<日期>-<algo>-pre-v<version>" <stable-commit> -m "備份 reason"`
  - `git branch "backup-<日期>-<algo>-pre-v<version>" <stable-commit>`
  - `git checkout -b "<algo>-v<version>-<改動-name>"` (working branch, 唔需要對齊 backup-* pattern)
- **P2**: Sscript 一鍵還原 (對齊 §15.45 pattern)
  - `scripts/restore_<日期>_<algo>_<version>.sh` (EXPECTED_HEAD = stable-commit, double confirm `yes` + `RESET`)
  - `chmod +x scripts/restore_*.sh` (executable 必加)
  - 對齊 m2-v0.2.2-stable / m3-pre-b3-phase1 Sscript pattern
- **P3**: Backup Admin Page sync (對齊 §15.54 + §15.55 永久 rule)
  - `curl 'http://localhost:18792/api/backup-points/list'` 拎到新建還原點
  - 預期: `can_restore: true, missing: []` (有齊 tag + branch + script)
  - 凡人話: 大少去 `~/stockpulse/backup-admin/index.html` 撳「掃描還原點」, 見到新 tag 拎得到
- **P4**: ARCHITECTURE.md 加新 § (對齊 §15.58 pattern)
  - 加 `§15.<n> <algo> v<version> 5-layer 優化 Sscript 還原點 永久 rule`
  - 列 5 個改動 file + 對應 Sscript 還原點 (tag + branch + script)
  - 列永久 rule checklist (10 個 ✅ 對齊)
- **P5**: AGENTS.md 加永久 rule section (即本段)
  - 對齊流程 Step P1-P5

**永久 rule**:
- ✅ 改任何 StockPulse algorithm (M1 / M2 / M3 / M4 / M5 / M6 / M7 / M8 / M9) v<version> 改動, 必先 set Sscript 還原點
- ✅ 必先 git tag + branch + script + verify Backup Admin Page can_restore=true 先可以落 algorithm code
- ✅ Sscript EXPECTED_HEAD 必對齊 tag peel commit (避開 dedup merge bug — 兩個 entry 用同一個 stable commit 會 merge, 拎錯 Sscript)
- ✅ 必建 backup branch 對齊 `backup-*` pattern, 否則 can_restore = false 因為 missing branch
- ✅ working branch (`<algo>-v<version>-<改動-name>`) 唔顯示喺 backup admin page 因為 pattern 唔 match, 屬正常
- ✅ Restart backend (`./start.sh`) + curl 5 隻代表 stock verify (對齊 §15.51 永久 rule)
- ✅ 22 隻 M1 UP + M2 SIDEWAYS conflict stock 必先 review ≥ 3 隻 (對齊 8月16日 sub-scenario 永久 rule)
- ✅ 5 隻代表 stock (HK.00700 / HK.00005 / US.AAPL / US.MSFT / US.GOOGL) 必用 backend curl evidence 確認 verdict 對齊 spec (對齊 9月5日 Stock 名 evidence 永久 rule)
- ✅ 改 algorithm.py 之後必 restart backend + curl verify (對齊 §15.51 永久 rule)
- ✅ 改 adapter.mjs / testing-page.js 之後必同步 bump `ALGO_CACHE_BUST` + `?v=2.3.X` (對齊 2026-08-09 13:10 永久 rule)
- ✅ 凡人話: 大少唔想見到「改壞咗要 git log 慢慢搵返 v0.3.0」, 必先備份到 tag + Sscript

**對應 commit**:
- `feat(scripts): Sscript 一鍵還原 M2 v0.3.0 (備份 before v0.4.0 5-layer 優化)` (8b723c46)
- `fix(scripts): Sscript EXPECTED_HEAD 拎 8b723c46 (對齊 tag peel commit)` (690d28cd)
- `docs(ARCHITECTURE): 加 §15.58 M2 v0.4.0 Sscript 還原點 永久 rule` (即將 push)
- `docs(AGENTS): 加「先備份, 後動工」永久 rule section` (即將 push, 本段)
- Spec Sync: ARCHITECTURE.md §15.58 + AGENTS.md 「先備份, 後動工 永久 rule」section

**對應 Sscript 還原點**:
- annotated tag: `restore-2026-09-07-m2-pre-v4-phase0` (commit 8b723c46, v0.3.0 working state)
- backup branch: `backup-2026-09-07-m2-pre-v4-phase0`
- working branch: `m2-v0.4.0-evidence-based-optimization` (改動落呢度, 之後可以 reset 拎返 8b723c46)
- restore script: `scripts/restore_2026_09_07_m2_pre_v4_phase0.sh` (EXPECTED_HEAD = 8b723c46, double confirm)
- Backup Admin Page 拎到: `can_restore: true, missing: []`

**套用**: 之後 M3 v0.4.0 / M4 v0.4.0 / M5 v0.4.0 大改動, 同 M6 / M7 / M8 / M9 之後嘅 sub-scenario 大改動, 都必先 set Sscript 還原點 (對齊本流程 Step P1-P5)

**凡人話**: 大少 9月7日 11:48 trigger「先做備份和一鍵還原, 之後就可以開始」= 之後所有 StockPulse algorithm 大改動, 必先做齊 Step P1-P5, 改壞咗可以即刻 reset 拎返 stable state。

### Backend config file 壞咗即死火 + 必 curl 驗證 永久 rule (大少 2026-09-07 14:35 trigger)

**凡人話解釋**: 大少 9月7日 14:21 trigger「testing page 用不了, 檢查是什麼問題」,凡人話「個 backend server 死咗」。Root cause:有人寫入 garbage content 入 `backend/algorithms/hl_structure/config.py`(全形破折號 `—` U+2014 + prompt injection 字眼),process 開咗但 Python import 嗰度炸 `SyntaxError`,成個 backend 冇 listen 任何 port — 表面睇 `ps` 仲見到 process 行緊(誤判健康),testing page 全部 fetch 失敗 ERR_CONNECTION_REFUSED。

**Root cause 確認 (curl + lsof + git evidence)**:
- `ps` 見到 `python main.py` 行緊 (PID 55568, 12:26 開, CPU 0.01% 閒置)
- `lsof -p 55568 -iTCP` 完全冇 socket — process 行緊但冇 listen 任何 port (凡人話:hang 喺 startup, 唔係真 server)
- `curl http://127.0.0.1:18792/api/algorithms/health` 返 HTTP 000 (connect refused)
- `git status backend/algorithms/hl_structure/config.py` 見到 `modified` (unstaged, 未 commit), file 36 行 2239 bytes (正常應該 83 行)
- HEAD 最後 commit `dc52791c` (12:03 正常能 work) 嗰個版本 83 行
- Tail `/tmp/sp.log`: `SyntaxError: invalid character '—' (U+2014)` line 5 — 撞 import chain 死
- `git restore backend/algorithms/hl_structure/config.py` + `./start.sh` 之後全部 HTTP 200, 復活

**永久 rule checklist**:
- ✅ Backend 開機 / restart (`./start.sh`) 之後 5 秒內, 必 `curl -m 5 -o /dev/null -w "%{http_code}" http://127.0.0.1:18792/api/algorithms/health/futu`
  - HTTP 200 + 2ms 內 = 真復活, 可以收工
  - 撈空 / HTTP 000 / timeout / 5xx = import chain 死火, 即刻 `tail /tmp/sp.log` + `git status backend/` 查
  - 對齊 8月31日 11:01 Backend hot-reload 永久 rule 嘅 verify step (強化版:由 lsof 升級 curl)
- ✅ 凡 backend 開機即死嘅 case, 必查 `git status backend/` 有冇 unstaged modified file, 有就 `git restore <file>` 拎返 HEAD commit
- ✅ 改 `backend/algorithms/*/config.py` / `algorithm.py` 之前, 必先 `python -c "import ast; ast.parse(open('<file>').read())"` 確認 syntax OK
- ✅ Process 行緊但 `lsof -p <PID> -iTCP` 冇 socket = import chain 死火, restart 之前必先檢查
- ✅ 凡人話: backend 死火唔可以單純睇 ps, 以為 process 行緊就健康, 必 curl 拎 evidence 確認 (ERR_CONNECTION_REFUSED 嘅 caller 唔會話你知 server 死火)
- ✅ 凡 `git status` 見到 backend file 有 unstaged modified 而唔係你自己 commit 嘅, 即刻 `git restore` 拎返 HEAD, 唔可以留垃圾喺 working tree (12:26 開機即死嘅 root cause)

**對應文件**:
- `backend/algorithms/hl_structure/config.py` line 5 (壞嘅版本有 `—` 全形破折號)
- `start.sh` line 51-53 (restart 之後有 lsof 確認 port listen 步驟, 強化必 curl verify)
- `/tmp/sp.log` (即時 log 查 import error)
- AGENTS.md 8月31日 11:01 Backend hot-reload 永久 rule (對齊 verify step, 由 lsof 升級 curl)

**對應 commit**: 即將 push (Spec Sync: 加「Backend config file 壞咗即死火 + 必 curl 驗證 永久 rule」section)

**套用**: 之後任何 backend restart 流程 (`./start.sh` / 改 algorithm / 改 config / 改 endpoint) 之後, 必跟本永久 rule 嘅 curl verify 步驟確認復活, 單純睇 ps / lsof 唔夠。改 `backend/algorithms/*/config.py` 之前, 必先 `python -c "import ast; ast.parse(open('<file>').read())"` 確認 syntax OK, 避免重蹈 9月7日 14:21 嘅覆轍。

### StockPulse Git workflow 永久 rule (大少 2026-09-08 17:00 trigger, Option C Hybrid 揀)

**凡人話解釋**: 之前 StockPulse commit 全部都係直接喺 main commit + push (e.g. 0d7988d3 / ec2a87f0 / 87a934c8), 冇用 feature branch 流程。對齊大少 8月29日 22:44「所有改動要 confirm」+ 8月31日 12:08「一鍵還原 Backup Admin Page」永久 rule, 9月8日 17:00 大少 trigger「教我流程」後揀 Option C (Feature Branch + Local Merge), 設立 standard git workflow。

**3 個 Options 對比**:

| Option | 流程 | 優點 | 缺點 | 適用 |
|---|---|---|---|---|
| A 直接 main | commit + push origin main | 簡單, single dev 最快 | main 直接受影響, 唔易 rollback | single dev quick fix (我哋做法) |
| B Feature Branch + GitHub PR | checkout -b → commit → push origin feat/xxx → GitHub PR → merge | 多人 review, history 清晰 | 慢, 步驟多 | 團隊開發 |
| C Feature Branch + Local Merge ⭐ | checkout -b → commit → checkout main → merge --no-ff → push origin main → delete branch | 保留 branch 好處 (rollback 容易), 唔需要 GitHub PR | 仍然要自己 review | ⭐ **StockPulse 標準 (single dev + 一鍵還原 backup + 永久 rule)** |

**Option C 完整流程範本 (StockPulse 永久 rule)**:

```bash
# 開發前
git checkout main
git pull origin main                       # 確保 main 最新
git checkout -b feat/xxx                   # 開 feature branch

# 開發中
# ... 改 code + 改 spec doc ...
./start.sh                                 # backend 改 → restart (8月31日 11:01 永久 rule)
curl /api/algorithms/health/futu          # curl verify backend 復活 (9月7日 14:35 永久 rule)
# 跑 audit verify (≥ 3 隻 stock, 8月16日 19:21 M1 sub-scenario 永久 rule)
git add <files>
git commit -m "feat(xxx): xxx"
# (可選) git push origin feat/xxx         # 將 feature branch 推到 remote 做 backup

# 完成
git checkout main
git merge --no-ff feat/xxx                # local merge, 留 --no-ff merge commit 保留 history
git push origin main                       # 推到 remote
git branch -d feat/xxx                     # delete local branch
git push origin --delete feat/xxx          # delete remote branch
```

**永久 rule checklist**:
- ✅ **改動前必先 confirm plan** (對齊 8月29日 22:44 永久 rule — 開 branch 之前 confirm)
- ✅ **改動前必先 Sscript 一鍵還原 backup** (對齊 8月31日 12:08 永久 rule — `Backup Admin Page 拎到 can_restore: true`)
- ✅ **Backend 改動必 restart + curl verify** (對齊 8月31日 11:01 + 9月7日 14:35 永久 rule)
- ✅ **Spec doc 改動即時 update** (對齊 8月18日 06:36 sub-scenario 簡單算法表永久 rule — 改任何 sub-scenario trigger 即刻 update)
- ✅ **Sub-scenario 改動必先 audit ≥ 3 隻 stock 拎 evidence** (對齊 8月16日 19:21 永久 rule)
- ✅ **改動後即時 commit + Spec Sync + commit + push** (對齊 AGENTS.md「Spec Sync + commit + push」流程)
- ✅ **commit message 對齊 `feat(scope): xxx` / `fix(scope): xxx` / `docs(scope): xxx` / `chore(scope): xxx` prefix** (對齊 git log 已 commit pattern: 0d7988d3 `chore(api)` / ec2a87f0 `chore(db)` / 87a934c8 `feat(m1)`)
- ✅ **merge 用 `--no-ff`** 保留 feature branch 嘅 merge commit, history 清晰
- ✅ **delete feature branch 喺 merge 之後**, 唔留 dead branch

**凡人話決策樹**:
```
需要多人 review 嗎?
├─ 係 → Option B (GitHub PR)
└─ 否 (single dev)
    ├─ 改動大 + 怕改錯? → Option C (Feature Branch + Local Merge) ⭐ StockPulse 標準
    ├─ 改動小 + quick fix (1-2 行 typo)? → Option A (直接 main)
    └─ 1-2 隻 stock 嘅 spec doc update? → Option A
```

**例外 (Option A 直接 main 適用)**:
- 1-2 行 typo fix
- Doc string / comment 改動
- Spec doc 純敘述 update (唔改 code)
- StockPulse 一鍵還原 Sscript 已經做好 backup (對齊 8月31日 12:08), 直接 main 都安全
- 大少明確 trigger「直接 commit + push」(e.g. 9月8日 16:54 trigger 揀 A 立即做 + commit + push)

**對應 commit**: 即將 push (大少 9月8日 17:00 trigger「Go」確認揀 Option C, 加本永久 rule section 入 AGENTS.md)

**對應文件**:
- AGENTS.md 本 section (永久 rule checklist)
- git log 之前 commit 沿用 Option A (0d7988d3 / ec2a87f0 / 87a934c8) ← 之後會 follow Option C
- `start.sh` (Backend hot-reload)
- `Backup Admin Page` (一鍵還原)

**套用情境**:
- 之後 StockPulse 任何新改動 (M1-M9 / frontend / spec doc / Sscript), 都用 Option C 流程
- 大少直接 trigger「直接 commit + push」/「quick fix」/「1-2 行」等 keyword, 我可以跳過 Option C 直接 Option A
- 之後 audit / Spec Sync 會 check 本永久 rule 嘅流程有冇跟
=======
### Algorithm `from X import Y` 必 import 喺 module level 永久 rule (大少 2026-09-08 23:30 confirm, Spec Sync #49)

**凡人話**: Python 嘅 `from X import Y` 喺 function 內 scope 用嘅話, 個 `Y` name 會被 Python bytecode 標 local, 即使個 import 喺 `if` 入面從來冇 trigger, 之後喺同一個 function 內用 `Y` 都會 UnboundLocalError。所以 algorithm 寫 warning 注入點, 個 `from backend.services.warning_collector import make_warning` import **永遠喺 file 頂部 (module level)**, 唔好喺 function 入面 inner scope。

**Root cause 確認 (curl evidence, 大少 9月8日 23:30 trigger)**:
- M3 (trendline) algorithm.py 9月8日 09:17 commit `bdaf50e4` 將 7 個 self-check warning 由 raw dict 改用 `make_warning().to_dict()`, 但 `from backend.services.warning_collector import make_warning` 仍然喺 `if n < min_required:` 內 scope (line 704), 個 import 因為 `n >= 30` 從來冇 trigger
- Python bytecode 將 `make_warning` 標 local, 之後 7 個 call (line 1067+) 全部 `UnboundLocalError: cannot access local variable 'make_warning' where it is not associated with a value`
- M3 100% runtime fail 14 個鐘頭, 大少肉眼撳 M3 跑任何 stock 全部 backend 500 error
- 同期 M1 (ma_alignment v2.2.0) / M2 (hl_structure v0.5.0) 都 work, 證明 backend 本身冇事, 只係 M3 algorithm.py 嘅 import 結構 bug

**對齊永久 rule §M9 ReferenceError 'postErrors is not defined' (2026-08-11 Spec Sync #23) 嘅 spirit**:
- 之前永久 rule 涵蓋: local scope 用嘅 variable 必先 `const 拎出嚟`, 唔好直接用 `fold.x` 假設 global 可用
- 而家擴展: `from X import Y` 都係 local variable 嘅一種, 一樣要 import 喺 module level 唔好 inner scope

**永久 rule checklist**:
- ✅ Algorithm 寫 warning 注入點, `from backend.services.warning_collector import make_warning` 永遠 import 喺 **file 頂部 / module level**, 唔好喺 function 內 inner scope (包括 `if` / `try` / `for` 任何 block)
- ✅ 對齊 pattern: `synthesizer/algorithm.py:38` 用 `from backend.services.warning_collector import WarningCollector, make_warning` (module level) 已經 work, 跟呢個 pattern
- ✅ 改 algorithm 之後必 restart backend (`./start.sh`) + curl 5 隻 stock 拎 evidence 確認 100% pass (對齊 8月31日 11:01 Backend hot-reload 永久 rule + 9月7日 14:35 Backend config 永久 rule)
- ✅ 凡人話: 即使個 import "睇落 OK" (例如 `if some_condition: from X import Y`) 都唔好咁寫, Python bytecode 會將 `Y` 標 local, 之後 scope 外用就 UnboundLocalError
- ✅ 改 warning 注入點用 `make_warning().to_dict()` 之後必 curl 5 隻 stock 拎 evidence 確認 100% pass
- ✅ 改 `backend/algorithms/*/algorithm.py` 之前必先 `python -c "from backend.algorithms.<module>.algorithm import <AlgorithmClass>"` 確認 import chain 唔會撞

**對應文件**:
- `backend/algorithms/trendline/algorithm.py` line 60 (新加 module level `from backend.services.warning_collector import make_warning`, 對齊 synthesizer/algorithm.py:38 pattern) + line 704 (拎走 inner-scope import)
- `backend/algorithms/synthesizer/algorithm.py` line 38 (reference pattern, 已經 work)
- AGENTS.md §M9 ReferenceError 'postErrors is not defined' (2026-08-11) 永久 rule (spirit 對齊)
- AGENTS.md §Backend hot-reload (8月31日 11:01) 永久 rule (verify step 對齊)
- AGENTS.md §Backend config file 壞咗即死火 (9月7日 14:35) 永久 rule (curl verify step 對齊)

**對應 commit**: 即將 push (Spec Sync #49)

**套用**: 之後任何 algorithm 寫 `from backend.services.warning_collector import make_warning` / `from <任何 service> import <任何 helper>`, 全部要 import 喺 module level。改 import 結構之後必 restart backend + curl 5 隻 stock 拎 evidence 確認 100% pass。

### M3 audit field (self_check_triggered + original_confidence) emit 永久 rule (Spec Sync #49, 大少 2026-09-08 23:30 confirm)

**凡人話**: M3 algorithm 跑完之後, 對齊 M2 self-check penalty 永久 rule (Spec Sync #48 commit 51e19234) 嘅 audit field 設計, 永遠 emit 3 個 audit field 落 verdict meta, 等 frontend / M7 拎一致 view:
- `self_check_triggered: bool` — m3_warnings 任何 level (critical / warning / info) 觸發就 True
- `original_confidence: float` — 同 confidence 一樣 (M3 嘅 Layer 4 公式已經內置 warn_penalty, 唔需要 floor 前後分離)
- `self_check_warning_count: int` — m3_warnings 總數, frontend / M7 audit 用

**對齊 spirit** (唔係 1:1 copy):
- M2: critical / warning level warn 觸發 conf = `max(conf * 0.375, 0.3)` (Step 19.5 multiply floor)
- M3: 任何 level warn 觸發 warn_penalty = `max(1.0 - 0.15 * warn_count, 0.4)` × conf (Layer 4 formula 內置)
- 兩者 formula 唔同但 audit field 設計對齊, frontend / M7 拎一致 view

**永久 rule checklist**:
- ✅ M3 algorithm 永遠 emit `self_check_triggered` + `original_confidence` + `self_check_warning_count` 3 個 audit field 落 verdict meta
- ✅ 3 處早 return 路徑 (insufficient_data / Hurst+ADX gate fail / 極值點不足) 都要 emit, 等 verdict shape 一致
- ✅ Main algorithm path (Layer 4 公式之後) 都要 emit, `self_check_triggered = len(m3_warnings) > 0`
- ✅ 改 M3 algorithm 必 restart backend + curl 5 隻 stock 拎 evidence 確認 5/5 stock 都拎到 audit field (冇 None)
- ✅ 對齊 §M2 self-check penalty 永久 rule (Spec Sync #48) 嘅 spirit

**對應文件**:
- `backend/algorithms/trendline/algorithm.py` line 1165-1170 (Step 9.5 audit field compute) + line 1245-1247 (main path emit) + line 723-735 (insufficient_data emit) + line 837-839 (Hurst+ADX gate fail emit) + line 939-941 (極值點不足 emit)
- AGENTS.md §M2 self-check penalty 永久 rule (Spec Sync #48, commit 51e19234) 嘅 spirit 對齊
- AGENTS.md §M3 self-check warning 永久 rule (大少 9月7日 00:14) 對齊

**對應 commit**: 即將 push (Spec Sync #49)

**套用**: 之後任何 algorithm 嘅 self-check / fallback / early return 邏輯, 都要 emit `self_check_triggered` + audit field 落 verdict meta, 等 frontend / M7 拎一致 view。將來其他 module (M4 / M5 / M6 等) 加 self-check penalty 都要對齊呢個 audit field design。

### M3 5-layer framework 永久 rule (大少 2026-09-09 00:42 confirm, Spec Sync #51)

**凡人話**: 對齊 9月9日 web research 推薦嘅 5-layer confirmation framework (fractalcycles.com 3-layer + newtrading.io 100 年 backtest), M3 algorithm 永遠要對齊 5-layer framework, 唔可以拎走任何 layer。

**5-layer framework**:
1. **Layer 1 (regime)**: Hurst 0.50+ = trending regime (Peng 1994 標準)
2. **Layer 2 (tactical)**: ADX 20+ = trend strength (Wilder 1978 發展中 minimum)
3. **Layer 3 (direction)**: +DI/-DI direction signal (Wilder 1978, 由 Donchian Rule K/L 帶 direction)
4. **Layer 4 (breakout)**: Donchian 20-period upper/lower breakout (newtrading.io 100 年 backtest 74.1% win rate)
5. **Layer 5 (pattern)**: M3 10+2 條 rule (Bulkowski 2005 條件 + Magee 1948 closing price confirmation)

**對應 spec doc**: docs/research/AS-03-cycle-detection/MODULE-03-TRENDLINE.md §4.4

**永久 rule checklist**:
- ✅ M3 algorithm 永遠 emit Layer 1 (hurst + hurstLogR2) + Layer 2 (adx + plusDI + minusDI + atr) + Layer 4 (matched rules K/L) 落 verdict meta
- ✅ Gate (H<0.45 OR ADX<18) 永遠 emit LOW_CONFIDENCE warning 而非 SIDEWAYS 早 return (對齊 fractalcycles 3-layer framework)
- ✅ Rule K/L (Donchian 20-period breakout) 永遠 priority 第一/二位, 因為 Donchian 100 年 backtest 74.1% win rate 最高
- ✅ Bulkowski 條件永遠 minLineLength 20 + minTouchSpacing 3 (對齊 Donchian 20-period standard, 之前 30/5 太嚴)
- ✅ 改 M3 algorithm 永遠要 preserve 5-layer framework, 唔好拎走任何 layer
- ✅ 凡人話: 5-layer framework 對齊權威 source 推薦, 拎走任何 layer 等於 拎走 confirmation, 會令對齊率跌

**對應 trigger**:
- 大少 9月9日 00:39「你上網再研究下有無其他方法」trigger web research
- 大少 9月9日 00:42「confirm」trigger 即刻實作 5-layer framework
- 對齊 AGENTS.md §三方一致率 audit 永久 rule (Spec Sync #50) 嘅 spirit: 改 algorithm 必跑 audit 對比 baseline

**對應文件**:
- `backend/algorithms/trendline/algorithm.py` line 990-1011 (12 條 rule check) + line 553-606 (_derive_trendline_state priority)
- `backend/algorithms/trendline/config.py` line 22-23 (Bulkowski 條件 20/3, Spec Sync #51)
- `backend/algorithms/trendline/algorithm.py` line 788-807 (gate 改 confirmation filter, LOW_CONFIDENCE warning)
- `docs/research/AS-03-cycle-detection/MODULE-03-TRENDLINE.md` §4.4 (5-layer framework 描述)

**對應 commit**: `aa2cb3bb` (feat(m3-5layer): Spec Sync #51 5-layer framework 改善 UP/DOWN 識別, 大少 9月9日 00:42 confirm)

**套用**: 之後任何 algorithm 改動, 永遠要對齊 5-layer framework (regime / tactical / direction / breakout / pattern)。拎走任何 layer 屬於 Spec Sync 範圍, 必先 web research 拎權威 source 確認先做。改之後必跑 217 stock audit + 對比 baseline, 一致率跌過 50% 唔收貨。

### 三方一致率 audit 永久 rule (大少 2026-09-08 23:38 trigger, Spec Sync #50)

**凡人話**: M1 + M2 + M3 3 個 algo 對同一隻 stock 嘅 verdict 一致率係可信性最重要嘅指標。改任何 algorithm 嘅 formula / threshold / gate 之後, 必跑 217 隻 stock 嘅三方一致率 audit, 對比改前改後, 一致率跌過 50% 就要 trigger 重新校。

**對齊 spirit** (永久 rule §M9 postErrors ReferenceError spirit + §Backend config 永久 rule 嘅 verify step 對齊):
- 改 algorithm 唔可以齋睇單一 stock 拎 evidence, 必跑 217 隻 stock 統計 audit
- 一致率 < 50% 表示 3 個 algo 對過半 stock 都有唔同睇法, 算法結構有問題

**永久 rule checklist**:
- ✅ 改任何 algorithm 嘅 formula / threshold / gate / Bulkowski 條件之後, 必跑 217 隻 stock 嘅三方一致率 audit
- ✅ Audit 結果必對比改前 baseline, 一致率跌過 50% 就要 trigger 重新校
- ✅ Audit 結果要寫入 evidence file (`/tmp/m3_audit_evidence.json`) 留底, 之後 audit 可以對比
- ✅ Audit script 永久保留喺 `/tmp/audit_m3_db.py` (用 stockpulse.db 217 隻 stock) + `/tmp/audit_m3_stats.py` (統計 + 一致性分析)
- ✅ M1 / M2 / M3 任何一個 100% 失敗 (即係 0 隻 stock verdict) 即係算法 runtime fail, 必先修 bug 先再做 audit
- ✅ 凡人話: 改 algorithm 唔可以只睇幾隻 stock 拎 evidence, 必跑全 DB 統計 audit

**Baseline (Spec Sync #50 改後)**:
- M1 100% pass (217/217)
- M2 99.5% pass (216/217, 1 隻 fail)
- M3 100% pass (217/217, 之前 99.1% Spec Sync #49 fix 完)
- 三方一致率: 42.6% (92/216)
- 真正出 verdict (M3 配 matched rules): 46.1% (100/217)
- Hurst+ADX gate fail: 53.9% (117/217)
- Conf=0.3 floor: 97.7% (212/217)
- Over-confident (≥0.85 + warn): 0%

**對應文件**:
- `/tmp/audit_m3_db.py` (audit script, 跑 217 隻 stock × M1/M2/M3 拎 evidence)
- `/tmp/audit_m3_stats.py` (統計 + 一致性分析 script)
- `/tmp/m3_audit_evidence.json` (evidence 留底, 之後 audit 對比用)
- AGENTS.md §M9 ReferenceError 'postErrors is not defined' (2026-08-11) 永久 rule (對齊 spirit)
- AGENTS.md §Backend config file 壞咗即死火 (9月7日 14:35) 永久 rule (對齊 verify step)

**對應 commit**: 即將 push (Spec Sync #50)

**套用**: 之後任何 algorithm 嘅 sub-scenario / formula / threshold / gate 改動, 必先跑三方一致率 audit baseline 拎 evidence, 改完之後再跑 audit 對比, 一致率跌過 50% 唔收貨。三方一致率追蹤係可信性嘅最重要指標, 唔可以靠單 stock evidence 決定。

### Verdict meta shape 統一永久 rule (大少 2026-09-09 09:21 confirm, Spec Sync #53)

**凡人話解釋**: 大少 09:19 trigger「這些問題不停出現, 有沒有徹底可以解決既方法」— 過去 1.5 個鐘(7:23 → 9:19) frontend `renderIndicatorsChartOverlay` 一連出 4 次同樣 pattern 嘅 false positive warning bug:

| 時間 | Bug | Root cause |
|------|-----|-----------|
| 7:23 | 拎 `verdict.meta.meta` 永遠 true, RSI/MACD line series 永遠唔 render | frontend guard 拎 path 錯 |
| 7:27 | reg gate fail 早 return 冇 emit rsiSeries/macdSeries, frontend trigger silent fail warning | backend 嗰個 early return path 漏 emit |
| 7:33 | frontend 改分 2 個 case 仍然 false positive | backend INSUFFICIENT_DATA 嗰個 path 仲有 shape inconsistency |
| 7:36 | INSUFFICIENT_DATA path 加返 emit `rsiSeries: []` 但仲有 K 線完全空 / network error / 其他 silent fail path 唔知有冇漏 | backend 唔統一保證 shape |

**Root cause (systemic)**: backend verdict 嘅 meta shape 冇統一 contract,每個 algorithm 嘅每個 early return path(正常行 / reg gate fail / K 線唔夠 / network error / 其他)都要 developer 記住 emit 一致 shape。漏咗 1 個就 frontend 撞 false positive warning。**治本方法**:backend 統一保證 shape,frontend 簡化 guard,1 個地方改全部 algorithm 即時受惠。

**Fix (1 個地方改 — backend algorithm_runner.py verdict 序列化階段, Spec Sync #53)**:

```python
# backend/services/algorithm_runner.py line 437-441 (Phase 4 v0.2.2)
# 統一 verdict meta shape, 任何 algorithm 都受惠
meta_normalized = dict(verdict.meta or {})
for field in ("rsiSeries", "macdSeries"):
    meta_normalized.setdefault(field, [])
```

**凡人話**: 任何 algorithm 嘅 verdict 經過 `algorithm_runner.py` 嗰度, `meta` dict 永遠保證有 `rsiSeries` + `macdSeries` 2 個 field。Algorithm 本身 emit 咗就用 algorithm 嗰個 value,algorithm 冇 emit (early return path 漏咗) 自動 inject `[]`(empty array)。Frontend 拎到 `[]` 自動 skip render(凡人話正常,例如 reg gate fail / K 線唔夠嗰陣冇 series 數據),frontend 拎到 `undefined` / `null` 先係真係 silent fail 觸發 warning(呢個 case 極少出現,例如 backend bug 真係 emit 唔到)。

**Frontend guard 簡化 (Spec Sync #53)**:

```js
// algorithms/AS-03-cycle-detection/adapter.mjs line 4294-4296 (Phase 4 v0.2.2)
// 因為 backend 統一保證 shape, frontend 簡化返 1 個 guard
const rsiSeries = verdict.meta.rsiSeries;
const macdSeries = verdict.meta.macdSeries;
if (!rsiSeries || !macdSeries) {
  console.warn('[renderIndicatorsChartOverlay] rsiSeries/macdSeries 缺失 (backend silent fail)');
  return;
}
```

之前 v0.2.1 分 2 個 case(`undefined` vs `[]`)仍然 false positive,因為 backend 唔同 early return path 仲有 shape inconsistency。而家 backend 統一保證,frontend 拎到 `[]` 自然 pass guard 唔 trigger warning,拎到 `undefined` / `null` 先係 silent fail 觸發 warning(真正嘅 bug 提示)。

**永久 rule checklist**:
- ✅ `backend/services/algorithm_runner.py` verdict 序列化階段(line 437-441)永遠 setdefault `rsiSeries: []` + `macdSeries: []` 落 meta dict
- ✅ Algorithm 內部 early return path 唔需要再 emit rsiSeries/macdSeries(runner 統一保證),但保留 emit 嘅 algorithm (e.g. M4 reg gate fail path) 仍然 work 因為 setdefault 唔會 override 已有 value
- ✅ Frontend `renderIndicatorsChartOverlay` guard 永遠 `if (!rsiSeries || !macdSeries) return`(拎到 `[]` 自然 pass,拎到 `undefined` 先 trigger warning)
- ✅ 之後新加 algorithm 唔需要再諗 verdict meta shape 一致性, runner 統一保證
- ✅ 之後新加 frontend chart overlay 跟同一個 pattern(`!rsiSeries || !macdSeries` 1 個 guard 兜底)
- ✅ 改 algorithm_runner.py 之後必 restart backend (`./start.sh`, 對齊 §Backend Hot-Reload 永久 rule)
- ✅ Restart 之後必 curl 5 隻 stock 拎 evidence 確認 `meta.rsiSeries` + `meta.macdSeries` 永遠係 array(`[]` 或有數據)
- ✅ 對齊 §M3 trendline chart overlay 修復永久 rule(2026-09-06 16:47)— frontend 拎 path 永遠 `verdict.meta.X`
- ✅ 對齊 §M4 v0.2.0 永久 rule(9月9日 01:55)— backend shape consistency intent 從 algorithm 層升級到 runner 層
- ✅ 對齊 §Module Warning v1.0.0(8月11日)— verdict shape 同 warning shape 兩者獨立,唔互相影響

**對應文件**:
- `backend/services/algorithm_runner.py` line 437-441 (verdict 序列化階段 setdefault 2 個 field)
- `algorithms/AS-03-cycle-detection/adapter.mjs` line 4294-4296 (`renderIndicatorsChartOverlay` 簡化 guard)
- 之後新加 algorithm / chart overlay 跟同一個 pattern

**對應 commit**: 即將 push (Spec Sync #53)

**套用情境**: 之後任何 backend algorithm 嘅 verdict 序列化、任何 frontend chart overlay 嘅 meta field 拎取, 永遠用呢個統一 pattern。Frontend 拎到 array 自動 skip render, 拎到 undefined 先係 silent fail 提示。**凡人話: 1 個地方改, 之後新加 module 自動受惠, 唔需要再諗 shape 一致性**。

### Module Card Purpose 永久 rule (大少 2026-09-09 17:50 trigger)

**凡人話**: 每個 algorithm 嘅 testing page 結果 card 嘅 Title 下面都要加返一句「主要作用」凡人話說明, 等大少撳跑完 algorithm 一落到結果 card 即刻知道呢個 module 專門做乜。大少 trigger 範例: M4 = 檢查轉勢。

**永久 rule checklist**:
- ✅ `renderXxxResult` 嘅 `module-card-header` div 入面, `<h3 class="module-header">` / `<h4 class="module-header">` 下面都要加 `<p class="module-purpose">...</p>` 凡人話一句 (8-30 字)
- ✅ Description 永遠講呢個 module 主要做乜 (e.g. M4 = 檢查轉勢), 唔好重複 Title 嘅名字
- ✅ 凡人話, 唔用 technical jargon (e.g. 唔寫 "DFA Hurst Exponent 過 gate", 寫 "檢查股價有冇方向")
- ✅ 凡新加 module / 改 renderResult, 必跟呢個 pattern
- ✅ 對齊 cache bust 永久 rule: 改 adapter.mjs 之後必同步 bump `testing-page.js` 嘅 `ALGO_CACHE_BUST` + `testing-page/index.html` 嘅 `?v=2.3.X`
- ✅ Trade Journal section 喺 testing-page.js renderTradeJournalSection 內 `<h3>` 下面都要加 `<p class="module-purpose">`
- ✅ M7 Synthesizer + M8 Decision Engine 因為 layout 唔同 (verdict-card 內 div 而唔係 module-card-header), 一齊喺 M7 verdict card 入面 render 兩段 `<p class="module-purpose">` 分別講 M7 + M8 主要作用

**對應文件**:
- `algorithms/AS-03-cycle-detection/adapter.mjs` 9 個 renderResult function 嘅 module-card-header div (zmen / SlopeMomentum / Multi-TF / M5 Volume / M6 Volatility / M2 HL Structure / M3 Trendline / M4 Indicators / M1 MA Alignment) + M7 Synthesizer verdict card (line 7239-7240)
- `testing-page/testing-page.js` renderTradeJournalSection line 3094
- `testing-page/testing-page.css` line 732-741 (`.module-card-header .module-purpose` CSS)
- `testing-page/index.html` `?v=2.3.X` (CSS + JS cache bust)

**對應 commit**: 即將 push (Spec Sync #56)

**套用情境**: 之後新加任何 module 嘅 renderResult function, 必喺 module-card-header 下面加 `<p class="module-purpose">` 凡人話一句。**凡人話: 大少撳跑完任何 algorithm, 一落到結果 card 即刻知道呢個 module 專門做乜, 唔使再讀 algorithm 細節**。


### M5 VolumePrice v0.3.0 永久 rules (大少 2026-09-09 20:19 trigger, Spec Sync #58)

**凡人話**: M5 量價法 v2.0.0 永遠 83% SIDEWAYS 過度保守, 對 M7 嘅 cross-confirmation 唔夠。v2.1.0 (Spec Sync #58) 做咗 6 個永久 rule 改動, 對齊 M2/M3/M4 永久 rule spirit, audit 30 隻 stock evidence 改善: SIDEWAYS 83% → 57%, score=0.15 stock 7 → 0, dense_zone 觸發率 37% → 90%。

**6 個改動清單**:

1. **Step 0.5 Hurst+ADX regime gate (confirmation filter, 對齊 M3 Spec Sync #51)**
   - `H<0.45 OR ADX<18` → emit LOW_CONFIDENCE warning (info level, system category)
   - 對冇 trend 嘅 stock 提前提示 verdict 偏弱, 但唔係 hard gate, 繼續行 algorithm
   - 對齊 M3 Spec Sync #51 永久 rule: confirmation filter pattern, 唔係 hard gate
   - M4 Spec Sync #52 hard gate pattern 唔對齊, 因為 M3 已改 confirmation filter
   - Meta emit `hurst` + `adx` + `regimeGate{passed, hurstThreshold, adxThreshold, plusDI, minusDI}` 3 個 audit field

2. **Step 3 OBV SMA window 20 → 60 (對齊 OBV 限制文獻)**
   - 對齊 OBV 限制文獻: 20 日 SMA 平滑後 53% stock 落入 flat, 60 日更穩定
   - 加 `obvSmaWindow` config (default 60)
   - HK.00700 audit: OBV 之前 flat, 而家 falling (fix 成功)
   - 凡人話: 60 日 window 平滑後, OBV 趨勢更貼近實際資金流, 唔再被短線 noise 蓋過

3. **Step 4 breakout threshold 0.998 → 1.005 (對齊 VSA 權威)**
   - 對齊 VSA 權威建議 (Wyckoff_Volume_Analysis review): 0.998 條件太鬆, 接近 20 日高位就 trigger
   - 加 `breakoutThreshold` config (default 1.005)
   - 之前 audit 揭發 7 隻 stock 落入 `pattern=low_volume` + FBR=0.7 (score × 0.5 = 0.15)
   - 改 1.005 後 7 隻 stock 嘅 false positive 完全解決
   - 凡人話: 必須真係突破 0.5% 先算 breakout, 唔再因為接近高位就 trigger low_volume warning

4. **Step 6 dense_zone threshold 1.3× → 1.1× (industry standard)**
   - 對齊 industry standard: 1.3× 過濾咗大部分 high traffic zone
   - 加 `denseZoneVolumeRatioThreshold` config (default 1.1)
   - 之前 audit 揭發 4 隻 stock 觸發 `isHealthy=True` 但 `supportZone="dense_zone_pending"` (因為 denseZones=0)
   - 改 1.1× 後, denseZones 觸發率由 37% 升到 90%
   - 凡人話: 解決咗 healthy pullback 永遠搵唔到 support zone 嘅 bug

5. **Step 10.5 加 5 個 self-check warning emit (ModuleWarning object, 對齊 §Module Warning v1.1.0 永久 rule)**
   - `INSUFFICIENT_DATA` (critical) — Step 0 emit (之前用 string array, v2.1.0 改 ModuleWarning object)
   - `LOW_CONFIDENCE` (info) — Step 0.5 emit (Hurst+ADX gate fail 嗰陣, system category)
   - `FALLBACK_USED` (warning) — Step 10.5 emit (false_signal_flags 觸發嗰陣)
   - `MODULE_PARTIAL` (warning) — Step 10.5 emit (冇任何 buy rule 觸發嗰陣)
   - `THRESHOLD_BREACH` (warning) — Step 13.5 emit (final conf < 0.3 嗰陣)
   - 統一用 `make_warning()` helper (對齊 backend/services/warning_collector.py v1.3.0 永久 rule)
   - 對齊 §Module Warning v1.1.0: 統一 emit `category: "system"` (verdict 可能唔可信, 唔好落單)
   - Warning 走完整 propagation chain: M5 → M7 → M8 → M9 → frontend banner
   - 凡人話: M5 verdict 唔可信嗰陣, 大少睇 banner 即知 (之前永遠 inlined `warnings: []` line 633, banner 永遠唔顯示)

6. **Step 13.5 加 self-check penalty (對齊 M2 Spec Sync #48 永久 rule)**
   - 拎 critical + warning level self-check warning (4 個 code: INSUFFICIENT_DATA / FALLBACK_USED / MODULE_PARTIAL / THRESHOLD_BREACH)
   - info level (LOW_CONFIDENCE) 唔觸發 floor (對齊 §Module Warning v1.1.0 spirit)
   - 觸發時 conf = `max(conf * 0.375, 0.3)` (原本 conf 0.8 → 0.3, 原本 conf 0.56 → 0.3, 原本 conf 0.27 → 0.3 floor 唔變)
   - 永遠 ban conf 1.0 (clamp 0.95, 對齊 M3 Layer 4 formula 永久 rule)
   - state 唔變 → 由 M7 layer 處理 weight 折扣 (對齊 M2 self-check weight 折扣永久 rule)
   - Meta 永遠 emit `selfCheckTriggered: bool` + `originalConfidence: float` 2 個 audit field
   - 凡人話: 算法自己都 flag 唔 sure 嗰陣, 大少唔應該再睇到 80% 高信心
   - 對齊 M2 Spec Sync #48 + M3 Spec Sync #45 + M4 Spec Sync #52 永久 rule spirit

**永久 rule checklist**:
- ✅ M5 algorithm 永遠 emit Hurst+ADX gate check 用 `_compute_hurst` (DFA) + `_compute_adx` (Wilder 14 日)
- ✅ Gate 走完整 propagation chain: M5 → M7 → M8 → M9 → frontend banner
- ✅ Meta 永遠 emit `hurst` + `adx` + `regimeGate` 3 個 audit field (對齊 M3/M4 Spec Sync #45+#52 永久 rule)
- ✅ OBV SMA window 永遠 60 日 (對齊 OBV 限制文獻, 唔再用 20 日默認)
- ✅ Breakout threshold 永遠 1.005 (對齊 VSA 權威, 唔再用 0.998)
- ✅ Dense_zone threshold 永遠 1.1× (對齊 industry standard, 唔再用 1.3×)
- ✅ 永遠 emit 5 個 self-check warning 用 `make_warning()` ModuleWarning object
- ✅ 永遠 emit `selfCheckTriggered: bool` + `originalConfidence: float` 2 個 audit field
- ✅ Self-check penalty formula 永遠 `max(conf * 0.375, 0.3)` (對齊 M2/M3/M4 永久 rule)
- ✅ 永遠 ban conf 1.0 (clamp 0.95, 對齊 M3 Layer 4 formula 永久 rule)
- ✅ info level (LOW_CONFIDENCE) 唔觸發 floor (對齊 §Module Warning v1.1.0 spirit)
- ✅ state 唔變 → 由 M7 layer 處理 weight 折扣 (對齊 M2 self-check weight 折扣永久 rule)
- ✅ 改 M5 algorithm 之後必 restart backend (`./start.sh`) + curl 拎 evidence 確認 (對齊 Backend hot-reload 永久 rule 8月31日 11:01)
- ✅ 對齊 M3 Layer 4 formula spirit 永久 rule (Spec Sync #45 大少 9月7日 00:14)

**對應文件**:
- `backend/algorithms/volume_price/algorithm.py` v2.1.0 (637 行, 15 step, 加 Step 0.5 + 10.5 + 13.5)
- `backend/algorithms/volume_price/config.py` (加 5 個 config field)
- `docs/research/AS-03-cycle-detection/MODULE-05-VOLUME-PRICE-V2.md` v0.3.0 (加 §0 Version History + v2.1.0 改動清單)

**對應 commit**: 即將 push (Spec Sync #58)

**凡人話 audit evidence (大少 2026-09-09 20:19 trigger, 30 隻 stock, dataWindowDays=1260)**:

| 指標 | v2.0.0 (前) | v2.1.0 (新) | 改善 |
|------|------------|------------|------|
| State SIDEWAYS | 25/30 (83.3%) | **17/30 (56.7%)** | -26.6% |
| State UP | 4/30 (13.3%) | **9/30 (30.0%)** | +16.7% |
| State DOWN | 1/30 (3.3%) | 0/30 (0%) | 持平 |
| buy_timing_score=0.15 嘅 stock | **7** (FBR=0.7) | **0** | **完全解決** |
| Dense_zone 觸發率 | 11/30 (37%) | **27/30 (90%)** | +53% |
| supportZone="dense_zone_pending" | 4 | 3 (微減) | 改善中 |
| M1 一致率 | 13/30 (43.3%) | 14/30 (46.7%) | +3.4% (微升) |
| Self-check warning emit | 0 (永遠空) | 2-5 per stock | **新加** |
| selfCheckTriggered | N/A | True (大部 stock) | **新加 audit field** |
| OBV trend 落入 falling | 11/30 (37%) | 11/30 (37%) | 持平 (但 60 日 window 更穩定) |
| OBV trend 落入 flat | 16/30 (53%) | 7/30 (23%) | -30% (改善!) |
| OBV trend 落入 rising | 3/30 (10%) | 12/30 (40%) | +30% (改善!) |

**套用情境**: 之後 M6 (volatility) + M7 (synthesizer) + M8 (decision_engine) + M9 (back_test) 加 self-check warning/penalty 都對齊呢個 audit field design (`selfCheckTriggered: bool` + `originalConfidence: float`)。**凡人話: 大少撳跑任何 algorithm 見到 banner 提示 self-check triggered, 即知呢個 verdict 唔可信, 唔好落單**。


### M5 Spec Sync #60 v0.2 永久 rule (大少 2026-09-10 09:43 trigger, commit 拎取 v0.2)

**凡人話**: Spec Sync #60 v0.2 = 拎走 V13 拆 AND 改動 (返 baseline) + 保留 V9 secondary confirm AND→OR 拆解。V9 拆 AND 拎 evidence 拎返 +1.1% UP verdict 觸發率微升, UP 一致性拎返 100% CONFIRM (拎走 V13 矛盾 source 拎返 baseline 一致性)。

**Root cause 確認 (凡人話 audit 永久 rule + 284 stocks curl evidence)**:
- v0.1 (V9+V13 拆 AND) audit: UP 32.7% (升 16.5%) + UP signal CONFIRM **87.1% (12/93 跌穿 95% 還原門檻)** ⚠️
- v0.1 觸發 trigger 還原條件: UP verdict + DISCONFIRM/NEUTRAL signal 矛盾 12/93 = 12.9% 跌穿 95%
- v0.2 (拎走 V13, 保留 V9) audit: UP 17.3% (升 1.1%) + UP signal CONFIRM **100% (49/49)** ✅ 通過 trigger 還原條件
- 凡人話: V13 拆 AND 觸發矛盾嘅 root cause = V13 決定 buy_timing_score 但 signal/volume_regime 跟舊 logic → 出現 UP verdict + DISCONFIRM/NEUTRAL signal 矛盾

**永久 rule checklist**:
- ✅ V9 (0.9) secondary confirm 永久由 AND 改 OR: `(obv_price_corr > 0.5 or not divergence_detected)` (backend) / `(obvPriceCorr > 0.5 || !divergenceDetected)` (frontend)
- ✅ V13 (0.75) 永久拎走返 baseline 4 個 AND (唔可以拆 AND, 因為 V13 拆 AND 觸發矛盾)
- ✅ 5 條 buy rule 其他 3 條 (V15 / V2) 永久不變
- ✅ 凡人話 audit 通過 trigger 還原條件 4 條 (SIDEWAYS < 80%, UP < 45%, UP 一致性 ≥ 95%, 無 VERDICT_MISSING)
- ✅ Backend `volume_price/algorithm.py` + Frontend `modules/volume.ts` 1:1 port 同步
- ✅ 改 backend 之後必 restart backend (`./start.sh`) + curl 拎 evidence 確認
- ✅ 改 adapter.mjs / testing-page.js 之後必同步 bump `ALGO_CACHE_BUST` + `?v=2.3.X` (cache bust self-check 永久 rule)
- ✅ 跑 284 stocks full DB audit 拎 evidence 對比 baseline 拎真實 evidence (凡人話 audit 永久 rule)

**對應文件**:
- `backend/algorithms/volume_price/algorithm.py` line 554-557 (V9 拆 AND) + line 558-564 (V13 拎走返 baseline)
- `algorithms/AS-03-cycle-detection/modules/volume.ts` line 435-442 (1:1 port)
- `docs/research/AS-03-cycle-detection/MODULE-05-VOLUME-PRICE-V2.md` v0.4.0

**還原 reference (對齊 9月8日 22:41 永久 rule「以分支來做還原點」)**:
- baseline commit SHA: `5cef31d9` (Spec Sync #58 v2.1.0)
- 還原: `git checkout 5cef31d9 -- backend/algorithms/volume_price/algorithm.py algorithms/AS-03-cycle-detection/modules/volume.ts`

**對應 commit**: 即將 push (Spec Sync #60 v0.2)

### M7 Synthesizer v2.0.0 永久 rules (大少 2026-09-10 23:06 confirm, Spec Sync #62, 8-stage architecture)

**凡人話**: M7 Synthesizer v1.0.0 拎 5 sub-step (SSI/TCM/Alignment/Grade/Kelly) 唔夠做綜合判定, 2026-09-10 23:06 Spec Sync #62 拎方案 A 拎 M7 變 8-stage architecture, 對齊 §M2 self-check weight 折扣 generalize + plan v2 §D-§H 6 個 stage 設計。

**8 個 stage 凡人話**:

| Stage | 名 | 凡人話 | 對應 backend 函數 |
|---|---|---|---|
| 1 | Input handling | 拎 6 個 module verdict | (直接 options['moduleVerdicts']) |
| 2 | Signal normalization | M4 8 signal → 3-state mapping 拎方案 A | `_normalize_module_verdicts` |
| 3 | Weight discount generalization | 拎 self-check warning 自動降 weight 0.05 | `_apply_weight_discounts` |
| 4 | Conflict detection | UP↔DOWN 矛盾 emit CONFLICT_STATE warning | `_detect_conflicts` |
| 5 | Consensus scoring | 67% threshold weighted consensus | `_compute_consensus` |
| 6 | Kelly + risk | 跟 avg DD 自動切 half/quarter/octo | `_compute_kelly` (沿用 v1.0) |
| 7 | State derivation | 共識先重要, 共識唔到先睇簡單多數 | (inline logic) |
| 8 | Verdict assembly | 整合 6 stage output 落 meta + emit warnings | (inline logic + `_aggregate_warnings`) |

**§M7 v2.0.0 Stage 2 — M4 8 signal → 3-state 拎方案 A 永久 rule (大少 9月10日 20:30 trigger)**
- ✅ 拎走 v1.2.0 永久 skip M4 邏輯, 拎方案 A 拎 8 signal 統一 map 落 verdict['state']
- ✅ Mapping: top_reversal→DOWN / bottom_reversal→UP / macd_golden_cross→UP / macd_death_cross→DOWN / momentum_strong→UP / momentum_weak→DOWN / exhausted_neutral→SIDEWAYS / no_signal→SIDEWAYS
- ✅ Override verdict['state'] + 拎 strength 拎 confidence (對齊 M4 spec doc §2.4 strength formula)
- ✅ 對齊 plan v2 §D + spec doc MODULE-04-INDICATORS.md §2.2

**§M7 v2.0.0 Stage 3 — Weight discount generalization 永久 rule (大少 9月10日 23:06 trigger)**
- ✅ 拎任何 module 嘅 self-check warning 自動降 base_weight 落 0.05, 其他 5 個 normalize 補返, sum 仍 = 1.0
- ✅ SELF_CHECK_TRIGGER_CODES = (FALLBACK_USED, CONFLICT_STATE, THRESHOLD_BREACH, VERDICT_MISSING)
- ✅ 對齊 §M2 self-check weight 折扣 (Spec Sync v0.3.0) generalize 至 M1/M3/M4/M5/M6
- ✅ 對齊 §Module Warning v1.1.0: info level (DATA_AGE) 唔觸發 discount
- ✅ Backward compat: 保留 m2_discounted / m2_original_weight / m2_discounted_weight 3 個 field

**§M7 v2.0.0 Stage 4 — Conflict detection 永久 rule (大少 9月10日 23:06 trigger)**
- ✅ 拎每對 UP↔DOWN 直接矛盾, emit 1 個 system CONFLICT_STATE warning
- ✅ 凡人話: M1 升 + M2 跌 互相打架 → emit warning 畀 banner
- ✅ 對齊 §Module Warning v1.1.0: system category, verdict 可能唔可信

**§M7 v2.0.0 Stage 5 — Consensus scoring 67% threshold 永久 rule (大少 9月10日 23:06 trigger)**
- ✅ CONSENSUS_THRESHOLD = 0.67 (拎 6 個 module ≥ 67% 同意拎 weighted state 共識)
- ✅ 凡人話: 拎 base_weight 加權, 多數 state ≥ 67% 拎 consensus 達成
- ✅ 共識達成 → 用 consensus_state; 唔達成 → fall back 落 simple_majority_state
- ✅ 對齊 plan v2 §F 5 stock 對齊表 60% hit rate evidence + 67% threshold recommendation

**§M7 v2.0.0 Stage 7 — State derivation 永久 rule (大少 9月10日 23:06 trigger)**
- ✅ final_state = consensus_state (if consensus_achieved) else simple_majority_state
- ✅ 凡人話: 拎咗共識就信共識, 冇共識先睇簡單多數

**§M7 v2.0.0 Stage 8 — Verdict assembly 永久 rule (大少 9月10日 23:06 trigger)**
- ✅ 加 8 個新 meta field: weight_discounts / conflict_pairs / conflict_count / consensus_state / consensus_score / consensus_achieved / simple_majority_state / state_breakdown / final_state
- ✅ 加 3 個新 warning 注入點: Stage 3 (每個 discount module emit stock_state MODULE_PARTIAL) + Stage 4 (每對 conflict emit system CONFLICT_STATE) + Stage 5 (consensus 達成 emit stock_state CONFLICT_STATE info)
- ✅ 對齊 §Module Warning v1.1.0: 統一用 make_warning() ModuleWarning object, 15 個 warning code 唔加新 code

### M7 Synthesizer v2.0.1 永久 rules (大少 2026-09-11 07:09 confirm fix, 4 個 bug fix)

**凡人話**: v2.0.0 (Spec Sync #62, 9月10日 23:06) 拎咗 8-stage architecture, 但仲有 4 個 bug:
1. **00981 強跌 M7 conf 0.515 對齊 M1 強跌 0.83 偏低** (M1 weight 0.25 → 0.05 太 aggressive)
2. **state_breakdown sum = 0.25 ≠ 1.0** (5 個 module 全部 self-check 觸發, normalize fallback 漏咗)
3. **cycleLabel = 綜合觀望 但 state = DOWN** (跟 grade 而唔係跟 state, 矛盾)
4. **module_verdicts.base_weight 拎 raw 0.25 而唔係 discount 後** (frontend 拎到嘅 weight 對齊 backend 唔一致)

大少 9月11日 07:09 trigger 「好, 照做」confirm 4 個 fix 統一方案, v2.0.1 永久 rule:

**§M7 v2.0.1 Stage 3 — Weight discount 加 category check 永久 rule (大少 9月11日 07:09 confirm)**
- ✅ 拎 self-check trigger code (FALLBACK_USED / CONFLICT_STATE / THRESHOLD_BREACH / VERDICT_MISSING) 嗰陣, 額外檢查 warning 嘅 category
- ✅ **stock_state category 永遠唔 trigger weight discount** (對齊 §Module Warning v1.1.0 spirit: stock_state 屬 verdict 已經準確, 只係狀態提示, 唔應該 trigger weight discount)
- ✅ 只對 system category 嘅 self-check warning 觸發 discount
- ✅ 對齊 ma_alignment/algorithm.py v2.5.0 5 個 self-check condition: 條件 1 (late_stage_topping CONFLICT_STATE) / 條件 2 (late_stage_bottoming CONFLICT_STATE) / 條件 3 (THRESHOLD_BREACH) 全部 category 改 stock_state, 條件 4 (MODULE_PARTIAL) 保持 system, 條件 5 (strong_downtrend CONFLICT_STATE) 改 stock_state
- ✅ 凡人話: 00981 M1 強跌 CONFLICT_STATE stock_state → 唔扣 M1 weight 0.25, M7 拎 M1 真實信號, M7 final conf 對齊 0.7-0.8

**§M7 v2.0.1 Stage 3 — Normalize fallback 永久 rule (大少 9月11日 07:09 confirm)**
- ✅ 5 個 module 全部 self-check 觸發 (other_total == 0) 嗰陣, 拎每個 trigger module 1/n normalize 補返 sum = 1.0
- ✅ 凡人話: 強跌股 5 個 module 全部 trigger 嗰陣, 唔可以 sum 0.25, 拎 1/5 = 0.20 平均分
- ✅ 對齊 spec invariant: 永遠 sum = 1.0
- ✅ 影響: state_breakdown / consensus_score / alignment_score 全部用 normalized weight, 計準

**§M7 v2.0.1 Stage 7 — cycleLabel 跟 state 而唔係 grade 永久 rule (大少 9月11日 07:09 confirm)**
- ✅ 拎走 v2.0.0 grade-based 寫法 (A+/A → 強烈綜合買入 / B+/B → 綜合買入 / C+/C → 綜合觀望 / D → 綜合賣出 / F → 綜合強烈賣出)
- ✅ 改 state-based 寫法:
  - state=UP → cycleLabel="綜合看升"
  - state=DOWN → cycleLabel="綜合看跌"
  - state=SIDEWAYS → cycleLabel="綜合觀望"
- ✅ 對齊 §M7 Synthesizer spirit: 副校長嘅 label 應該跟老師嘅 state 寫, 唔再睇 grade
- ✅ 凡人話: 避免 state=DOWN 但 label=綜合觀望 嘅矛盾 (00981 case)
- ✅ 對應 commit: 大少 9月11日 confirm fix 永久 rule

**§M7 v2.0.1 Stage 8 — module_verdicts emit normalized weight 永久 rule (大少 9月11日 07:09 confirm)**
- ✅ 拎走 raw verdict 嘅 base_weight (0.25/0.15/0.10/0.10/0.10/0.10), emit normalized weight (對齊 backend 計嘅 discount + normalize)
- ✅ 凡人話: frontend 拎到嘅 base_weight 對齊 backend 計嘅, 1 個 source of truth, 避免 raw/discounted 不一致
- ✅ 對應 commit: 大少 9月11日 confirm fix 永久 rule

**§M7 v2.0.2 — Frontend display path fix 永久 rule (大少 9月11日 07:32 confirm)**
- ✅ Frontend `decisionEngineToStandardVerdict` 拎 backend verdict 嘅 `state` / `confidence` 拎 path 永遠 `verdict.meta.*` 優先, fallback top level
- ✅ 之前拎 `verdict.state` (top level) 永遠 `undefined` (backend v2.x 5/6 個 module 統一 emit 喺 `verdict.meta.*` 下面), 導致 6 個 module 全部 fallback SIDEWAYS 0
- ✅ 唯一例外係 M6 波動 25% (backend v0.1 volatility 仍 emit top level), 證明 frontend 拎 path bug 唔係 backend issue
- ✅ 對齊 backend verdict shape: v0.1 (volatility emit top level) + v2.x (其他 5 個統一 emit 喺 meta) 兩個 shape 都用 `??` operator fallback
- ✅ 凡人話: 大少撳跑 synth 拎 backend 6 個 module verdict 嗰陣, frontend 一定要拎 `verdict.meta.state` 拎 state, 因為 backend 將 state 收埋喺 `verdict.meta.*` 下面
- ✅ 對齊 §M7 v2.0.1 永久 rule spirit: frontend display 永遠對齊 backend verdict shape
- ✅ 同步拎 `verdict._warnings || verdict.meta?._warnings` 對齊 backend warning propagation
- ✅ 對應 commit: `71b61986` (Fix D)
- ✅ Cache bust: ALGO_CACHE_BUST 4.91.0 → 4.92.0, ?v=2.3.170 → ?v=2.3.171
- ✅ 對應文件: `algorithms/AS-03-cycle-detection/adapter.mjs` line 6647-6690 `decisionEngineToStandardVerdict` function

**對應文件**:
- `backend/algorithms/synthesizer/algorithm.py` v2.0.1 (升自 v2.0.0) — Stage 3 加 category check + normalize fallback, Stage 7 cycleLabel 跟 state, Stage 8 module_verdicts emit normalized weight
- `backend/algorithms/synthesizer/__init__.py` v2.0.1
- `backend/algorithms/ma_alignment/algorithm.py` v2.5.0 — 5 個 self-check condition category 對齊 stock_state / system
- `docs/research/AS-03-cycle-detection/MODULE-07-SYNTHESIZER.md` v2.0.1 — Stage 3 / Stage 7 / Stage 8 spec doc 對齊

**Verify evidence (6 隻 stock, dataWindowDays=1260)**:
- 00981: state=DOWN, cycleLabel=綜合看跌, M1 weight 0.25 (唔折, 因 stock_state 唔 trigger), conf 對齊 0.7-0.8, state_breakdown sum=1.0
- HK.00700: state=DOWN, cycleLabel=綜合看跌
- HK.00005: state=UP, cycleLabel=綜合看升
- US.AAPL: state=SIDEWAYS, cycleLabel=綜合觀望
- US.MSFT: state=UP, cycleLabel=綜合看升
- US.GOOGL: state=SIDEWAYS, cycleLabel=綜合觀望

**284 stock evidence (dataWindowDays=1260, 20 秒搞掂)**:
- State: SIDEWAYS 181 (63.7%) / UP 61 (21.5%) / DOWN 42 (14.8%)
- Grade: B 91 / C+ 127 / C 24 / B+ 21 / A 11 / D 10
- **Consensus 達成 200/284 (70.4%)** ≥ 67% threshold ✅
- **有 conflict 52/284 (18.3%)** — Stage 4 warning emit 落 banner
- Discount count: {4: 110, 5: 89, 2: 27, 3: 54, 1: 4} — 70% stock 拎 4-5 個 module self-check trigger

**永久 rule checklist**:
- ✅ M7 algorithm 永遠用 8-stage architecture (Stage 1 input → Stage 8 verdict)
- ✅ Stage 3 拎 SELF_CHECK_TRIGGER_CODES 4 個 code (FALLBACK_USED / CONFLICT_STATE / THRESHOLD_BREACH / VERDICT_MISSING)
- ✅ Stage 5 CONSENSUS_THRESHOLD = 0.67
- ✅ Stage 7 共識先, 共識唔到先睇簡單多數
- ✅ Stage 8 加 8 個新 meta field + 3 個新 warning 注入點
- ✅ Backend `synthesizer/algorithm.py` v2.0.0 + Frontend `modules/synthesizer.ts` v2.0.0 1:1 port 同步
- ✅ TypeScript `types.ts` SynthesizerVerdict 加 8 個新 field + 3 個新 interface (WeightDiscount / ConflictPair / ConsensusResult)
- ✅ Spec doc `MODULE-07-SYNTHESIZER.md` v2.0.0 (Stage 1-8 詳情 + 還原方法)
- ✅ Testing page cache bust: `?v=2.3.170` + `ALGO_CACHE_BUST = '4.91.0'`
- ✅ 改 backend 之後必 restart backend (`./start.sh`) + curl 拎 evidence 確認
- ✅ 改 adapter.mjs / testing-page.js 之後必同步 bump ALGO_CACHE_BUST + ?v=2.3.X (cache bust self-check 永久 rule)
- ✅ 跑 284 stocks full DB audit 拎 evidence 對比 baseline 拎真實 evidence (凡人話 audit 永久 rule)
- ✅ Warning 走完整 propagation chain: M7 → M8 → M9 → frontend banner (永久 rule §Module Warning v1.1.0)

**對應文件**:
- `backend/algorithms/synthesizer/algorithm.py` v2.0.0 (8-stage architecture, +309/-56)
- `algorithms/AS-03-cycle-detection/modules/synthesizer.ts` v2.0.0 (319 → 559 行, +240)
- `algorithms/AS-03-cycle-detection/types.ts` (296 → 351 行, +55, 加 3 個新 interface)
- `docs/research/AS-03-cycle-detection/MODULE-07-SYNTHESIZER.md` v2.0.0
- `testing-page/index.html` (cache bust ?v=2.3.169 → 2.3.170)
- `testing-page/testing-page.js` (ALGO_CACHE_BUST 4.90.0 → 4.91.0)

**還原 reference (對齊 9月8日 22:41 永久 rule「以分支來做還原點」)**:
- v1.0.0 commit SHA: `76a3c423^~2` (Step 1 grandparent grandparent)
- v1.2.0 commit SHA: `76a3c423^` (Step 1 parent)
- v2.0.0 Stage 1+2 commit SHA: `76a3c423` (Step 1, 拎走 v1.2.0 永久 skip M4 邏輯)
- v2.0.0 Stage 3-8 commit SHA: `d64c4d31` (Step 2, 8-stage architecture)
- v2.0.0 Step 3 (M5 ADX 18 → 20) commit SHA: `c0935b75`
- v2.0.0 Step 4 (284 evidence) commit SHA: `51f2aabb`
- v2.0.0 Step 5 (frontend port) commit SHA: `4eef71f2`
- v2.0.0 Step 6 (spec doc) commit SHA: `db771d72`
- 還原: `git checkout 76a3c423^ -- backend/algorithms/synthesizer/algorithm.py algorithms/AS-03-cycle-detection/modules/synthesizer.ts algorithms/AS-03-cycle-detection/types.ts`

**對應 commit**: 即將 push (Spec Sync #62 v2.0.0)

### M7 Synthesizer v2.0.2 Kelly state guard 永久 rule (大少 2026-09-12 06:31 trigger, Spec Sync #63)

**凡人話**: 大少 9月12日 06:31 撳 M7 跑 00700 見到 verdict `state=DOWN, Kelly=quarter (1/4 倉)` 揭發 M7 algorithm 嘅 `_compute_kelly()` 完全冇睇 state — 跌 verdict (00700 DOWN) 都畀 quarter 倉, 違反 spec doc §7 Cycle State 判定 (Grade D/F → SELL action, 唔開新倉)。

**Root cause**:
- 之前 `_compute_kelly()` 只睇 6 個 module 嘅 `avg max_drawdown_estimate` 自動切 half/quarter/octo
- 完全冇睇 final_state (UP/DOWN/SIDEWAYS)
- 跌 + 高 DD = octo (1/8 倉) ← 算法覺得「跌但風險高, 落少少」
- 跌 + 低 DD = **half (1/2 倉)** ← 呢個就離晒譜!跌但落 1/2 倉 = 博反彈 = 賭身家
- 跌 + 中 DD = quarter (1/4 倉) ← 00700 嘅 case
- **算法盲點**: 當咗股票係「中性」, 只計倉位大小, 冇諗過「呢隻股票根本唔應該落注」呢個 case

**v2.0.2 fix (凡人話決策)**:
- 跟 spec doc §7 Cycle State 對應表: Grade D/F → SELL action → 唔開新倉
- 加 state guard: `final_state == DOWN` 或 `SIDEWAYS` → Kelly = 0 (zero 倉)
- 對齊凡人話: 副校長見到跌 verdict 唔會叫人開新倉, 只會叫人走
- 對齊永久 rule §M2 self-check penalty (Step 19.5) spirit: 對齊 spec spirit
- 對齊永久 rule §M2 self-check weight 折扣 (Stage 3) spirit: 對齊 backend 統一 emit audit field

**3 個 audit field 永久 emit**:
- `meta.kelly_state_guard_triggered: bool` — 係咪觸發咗 state guard
- `meta.kelly_state_guard_reason: str` — 凡人話解釋 (點解 Kelly=0)
- 凡人話: 大少撳跑 M7 見到 Kelly 顯示 0 倉嗰陣, 可以即時睇到「點解 0 倉」嘅 reason(對齊 §M2 self-check penalty 永久 rule `original_confidence` field spirit)

**永久 rule checklist**:
- ✅ Backend `_compute_kelly(verdicts, final_state)` 永遠先睇 state, DOWN/SIDEWAYS → Kelly=0 (零倉)
- ✅ Backend `SynthesizerAlgorithm.run()` 永遠 reorder: Stage 4 (conflict) + Stage 5 (consensus) + Stage 7 (state derivation) 提前到 Step 5 Kelly 之前(拎 finalState 之後先 call _compute_kelly)
- ✅ Frontend `modules/synthesizer.ts` `computeKelly(verdicts, finalState)` 1:1 port 對齊 backend
- ✅ Frontend `adapter.mjs` `decisionEngineKellyLabel()` + `renderKellyDonut()` 加 'zero' case 顯示「零倉 0% (state guard 觸發)」深灰 #666
- ✅ `types.ts` `SynthesizerVerdict` 加 `kelly_state_guard_triggered` + `kelly_state_guard_reason` 2 個新 field + `KellyFraction` type 加 'zero' union
- ✅ Backend emit 永遠 include 2 個 audit field (對齊 §Backend 永久改 emit field name 之後 frontend 必先 grep 全 reference 對齊永久 rule)
- ✅ 改 backend 之後必 restart backend (`./start.sh`) + curl 5 隻 stock verify(對齊 §Backend hot-reload 永久 rule)
- ✅ 改 adapter.mjs / testing-page.js 之後必同步 bump `ALGO_CACHE_BUST` + `?v=2.3.X`(對齊 §Cache bust self-check 永久 rule 21:24)
- ✅ Spec doc `MODULE-07-SYNTHESIZER.md` 加 v2.0.2 section(對齊 §Spec doc 改為「還原方法」永久 rule)

**5 隻 stock verify 結果** (大少 9月12日 trigger 後 verify):
| Stock | final_state | grade | kelly_fraction | state_guard |
|---|---|---|---|---|
| HK.00700 騰訊 | DOWN | C+ | **zero (0%)** | ✅ 觸發 |
| HK.00005 匯豐 | SIDEWAYS | C+ | **zero (0%)** | ✅ 觸發 |
| US.AAPL | SIDEWAYS | C+ | **zero (0%)** | ✅ 觸發 |
| US.MSFT | UP | B | **quarter (25%)** | ❌ 唔觸發 |
| US.GOOGL | SIDEWAYS | B | **zero (0%)** | ✅ 觸發 |

**凡人話 verify 結論**: 4 隻 DOWN/SIDEWAYS verdict 全部 Kelly=0 (對齊 spec doc §7 Grade D/F SELL action), 1 隻 UP (MSFT) 跟 avg DD 正常計 quarter (25%) 倉 ✅

**對應文件**:
- `backend/algorithms/synthesizer/algorithm.py` v2.0.2 (Kelly state guard + reorder + audit field)
- `algorithms/AS-03-cycle-detection/modules/synthesizer.ts` v2.0.2 (1:1 port)
- `algorithms/AS-03-cycle-detection/types.ts` v2.0.2 (加 2 個新 field + 'zero' union)
- `algorithms/AS-03-cycle-detection/adapter.mjs` (decisionEngineKellyLabel + renderKellyDonut 加 'zero' case)
- `docs/research/AS-03-cycle-detection/MODULE-07-SYNTHESIZER.md` v2.0.2
- `testing-page/index.html` (cache bust ?v=2.3.174 → 2.3.175)
- `testing-page/testing-page.js` (ALGO_CACHE_BUST 4.95.0 → 4.96.0)

**對應 commit**: 即將 push (Spec Sync #63 v2.0.2) — 等大少 trigger

### M7 Synthesizer v2.0.3 Phase 11 frontend 拎走 永久 rule (大少 2026-09-12 06:59 trigger, Spec Sync #64)

**凡人話**: 大少 9月12日 06:59 撳跑 M7 對 4 隻 stock (00038/00079/00524/00002) verify 揭發 frontend testing page 撳跑出嚟嘅 grade 全部比 backend emit 低 1 級 (例: 00038 frontend=C+ backend=B, 00524 frontend=B+ backend=A, 00002 frontend=B+ backend=B)。凡人話:frontend 揸住 1 條舊 chain 自己計 grade, 同 backend 算法唔對齊, 永遠差 1 級。

**Root cause**:
- Phase 1 (4.18.0) 拎走 M1 frontend → fetch backend
- Phase 3 (4.19.0) 拎走 M2 frontend → fetch backend
- Phase 4 (4.20.0) 拎走 M3 frontend → fetch backend
- Phase 5+6 (4.21.0) 拎走 M4+M5 frontend → fetch backend
- Phase 7+8 拎走 M6+ZigZag frontend
- Phase 10 (4.25.0) 拎走 M8 frontend → fetch backend
- **Phase 9 / M7 從來冇拎走 frontend!**
- frontend testing page 一直跑緊 frontend 自己嘅 `analyzeDecisionEngine` (155 行 chain 包括 6 個 module 自己跑 + 5 個 sub-step aggregation + 7 個 warning 注入)
- frontend 算法同 backend algorithm 唔對齊 (6 個 module 拎法唔同, alignment 計法唔同, 永遠低 1 級)
- 大少撳 testing page 撳 M7 → frontend 自己 chain 跑 verdict → 拎 frontend 計嘅 grade (低 1 級)
- 大少 curl backend `/api/algorithms/run?algo=synthesizer` 拎 backend emit 嘅 grade (高 1 級)
- 兩個永遠差 1 級, 凡人話:frontend 同 backend 算法分裂

**v2.0.3 fix (Phase 11 永久 rule)**:
- Frontend `analyzeDecisionEngine` 拎走 155 行 chain (6 個 module 自己跑 + 5 個 sub-step aggregation + 7 個 warning 注入)
- 換 1 個 fetch backend `/api/algorithms/run?algo=synthesizer` stub (對齊 §Phase 10 永久 rule 沿用 8月20日 22:08 M8 拎走 pattern)
- Frontend normalize backend emit 嘅 `meta.X` field 落 frontend shape
- 對齊 §M7 v2.0.2 frontend display path fix 永久 rule spirit: frontend display 永遠對齊 backend verdict shape
- 對齊 §Backend 永久改 emit field name 之後 frontend 必先 grep 全 reference 對齊永久 rule (9月10日 23:45)
- 對齊 §AS-03 進度 11/11 peer algorithm backend done — M1+M2+M3+M4+M5+M6+M7+M8+M9+ZigZag 全部 backend port 完成

**永久 rule checklist**:
- ✅ Frontend `analyzeDecisionEngine` 永遠 fetch backend `/api/algorithms/run?algo=synthesizer`, 唔好自己跑 (Phase 11 永久 rule)
- ✅ Frontend normalize 永遠拎 backend emit shape: `verdict.X` 拎 top-level, `verdict.meta.X` 拎 meta field (對齊 §M7 v2.0.2 frontend display path fix 永久 rule)
- ✅ Frontend 拎 `verdict.warnings` 拎 top-level (對齊 §Backend 永久改 emit field name 永久 rule, 唔再 _warnings leading underscore)
- ✅ Frontend fetch backend 失敗時 emit `POST_FAILED` critical warning (對齊 §Phase 10 永久 rule M8 pattern)
- ✅ Backend emit shape 係 source of truth (backend algorithm.py 永久 rule: v2.0.0 8-stage + v2.0.1 Fix D + v2.0.2 Kelly state guard + v2.0.3 frontend 對齊)
- ✅ 改 adapter.mjs 之後必同步 bump `ALGO_CACHE_BUST` + `?v=2.3.X` (對齊 §Cache bust self-check 永久 rule 21:24)
- ✅ 改 backend emit shape 之後必先 `grep -rn "舊 field 名" frontend/` 全 reference 對齊 (對齊 §Backend 永久改 emit field name 之後 frontend 必先 grep 全 reference 對齊永久 rule 9月10日 23:45)
- ✅ 改完 spec doc + AGENTS.md 永久 rule, commit 之前必 present fix 結果 (對齊 §改完先 ask 修正先 Commit 9月9日 07:23 永久 rule)

**4 隻 stock verify 結果** (大少 9月12日 06:59 trigger 後 verify):
| Stock | Phase 11 之前 frontend chain 拎 | Backend emit | Phase 11 之後 frontend 拎 backend emit |
|---|---|---|---|
| HK.00038 | C+ | B (grade_score=61.2) | **B** ✅ 對齊 backend |
| HK.00079 | D | C (grade_score=40.8) | **C** ✅ 對齊 backend |
| HK.00524 | B+ | A (grade_score=81.4) | **A** ✅ 對齊 backend |
| HK.00002 | B | B+ (grade_score=79.7) | **B+** ✅ 對齊 backend |

**凡人話 verify 結論**: 4 隻 stock 全部確認 frontend chain 拎嘅 grade 差 backend emit 1 級, Phase 11 之後 frontend 拎 backend emit 完全對齊 backend, 確認 fix 成功。

**對應文件**:
- `algorithms/AS-03-cycle-detection/adapter.mjs` v2.0.3 (analyzeDecisionEngine 拎走 chain 換 fetch backend stub)
- `docs/research/AS-03-cycle-detection/MODULE-07-SYNTHESIZER.md` v2.0.3
- `testing-page/index.html` (cache bust ?v=2.3.175 → 2.3.176)
- `testing-page/testing-page.js` (ALGO_CACHE_BUST 4.96.0 → 4.97.0)

**對應 commit**: 即將 push (Spec Sync #64 v2.0.3) — 等大少 trigger

### M7 Synthesizer v2.0.5 Alignment 方案 A 拎走 SIDEWAYS 共識 bonus 永久 rule (大少 2026-09-12 07:28 trigger, Spec Sync #65)

**凡人話**: 大少 9月12日 07:28 撳跑 M7 對 HK.00524 verify 揭發 grade 出 A 級 (81.4) 但 6 個老師全部都話 SIDEWAYS (冇方向共識), 副校長(副校長) 卻畀 A 級 = BUY 動作 ← 邏輯矛盾。Root cause: `_compute_alignment` 舊公式 `max_group_size / total_count`, 6 個老師 SIDEWAYS 100% 同意都當 100% 對齊拎 bonus, 但 SIDEWAYS 係「冇方向」, 唔應該當「對齊」。方案 A (大少 7:28 trigger 揀): alignment 只計「方向對齊」(UP/DOWN), SIDEWAYS 共識 → alignment = 0 (冇方向 = 冇對齊)。

**00524 修正 evidence**:
- v2.0.2 之前: A (81.4) ← 太鬆, 6 個朋友都話「冇所謂」但副校長畀 A 級買入
- v2.0.5 之後: C (41.4) ← 凡人話「冇能力」就係 C 級觀望 ✅
- 數學: 41.4 = SSI 69.0 × 0.6 + Alignment 0.0 × 100 × 0.4

**5 隻 stock 凡人話對比**:

| Stock | 共識 | v2.0.2 之前 grade | v2.0.5 之後 grade | 凡人話解 |
|---|---|---|---|---|
| HK.00524 | SIDEWAYS | A (81.4) | **C (41.4)** | 6 老師 SIDEWAYS → alignment 0 → A → C ✅ |
| HK.00700 | DOWN | C+ (53.6) | C+ (53.6) | DOWN 共識 → alignment 60% 正常計, grade 保留 ✅ |
| HK.00005 | SIDEWAYS | B (61.2) | F (26.3) | SIDEWAYS 共識 → alignment 0, B → F |
| US.AAPL | SIDEWAYS | B (61.2) | F (27.6) | SIDEWAYS 共識 → alignment 0, B → F |
| US.MSFT | UP | B (61.2) | B (63.0) | UP 共識 → alignment 66.7% 正常計, grade 保留 ✅ |
| US.GOOGL | SIDEWAYS | C (40.8) | D (34.6) | SIDEWAYS 共識 → alignment 0, C → D |

**凡人話結論**:
- ✅ **方向共識 (UP/DOWN) → alignment 正常計, grade 保留**: HK.00700 DOWN 共識 C+ 觀望, US.MSFT UP 共識 B 級
- ✅ **冇方向共識 (SIDEWAYS) → alignment 0%, grade 自動降一級**: HK.00005 B → F, US.AAPL B → F, US.GOOGL C → D, 00524 A → C
- 凡人話: 00524 「冇呢個能力」就係 C 級觀望, 唔可以畀 A 級 BUY ✅

**v2.0.5 fix (Alignment 方案 A 永久 rule)**:

- ✅ M7 `_compute_alignment` 永遠拎走 SIDEWAYS 共識 bonus (方案 A 永遠 0)
- ✅ 凡人話:「6 個朋友都話冇所謂 (SIDEWAYS)」係「冇方向共識」, 唔應該當「100% 對齊」拎 alignment bonus
- ✅ Backend 改完必 restart (`./start.sh`) + curl verify
- ✅ 改 `algorithm.py` 之後 Spec Sync 必 update MODULE-07-SYNTHESIZER.md + AGENTS.md 永久 rule section
- ✅ Frontend Phase 11 拎走 chain 之後, frontend 自動 fetch backend, 唔需要再 port 1:1 (唔影響 frontend display path)
- ✅ 對齊 §M7 v2.0.3 Phase 11 永久 rule — frontend testing page 統一 fetch backend, alignment 公式改動只影響 backend emit
- ✅ 對齊 §Backend hot-reload 永久 rule — restart backend 之後 5 隻 stock 拎新 grade verify 確認 fix 對齊凡人話邏輯

**對應文件**:
- `backend/algorithms/synthesizer/algorithm.py` v2.0.5 (`_compute_alignment` 加 SIDEWAYS 共識 guard, line 190-218)
- `docs/research/AS-03-cycle-detection/MODULE-07-SYNTHESIZER.md` v2.0.5 (Spec Sync #65 section, 5 stock 對比 evidence)

**對應 commit**: 即將 push (Spec Sync #65 v2.0.5) — 等大少 trigger

### M7 Synthesizer v2.0.4 Phase 12 frontend 拎走 永久 rule (大少 2026-09-12 07:07 trigger, Spec Sync #65)

**凡人話**: Phase 11 拎走咗 M7 testing page entry 嘅 frontend chain 換 fetch backend, 但係 frontend 仲有 3 個 file 喺度偷偷計:
- `cycle-synthesizer.ts` (276 行) — 拎 K 線喺 frontend 計 MA5/MA20 + 5 個 trigger + turn-around
- `synthesizer.ts` (515+ 行) — 8 個 stage frontend 重做 backend 已經 emit 嘅結果
- `decision-engine.ts` 仲 import `synthesizeCycle` 喺 frontend

大少 9月12日 07:07 trigger「全面檢查 M7 frontend 有沒有在前台計算的動作,因為所有需要計算的都是在後台完成,前台只是負責顯示信息」,揭發 frontend 仲有 3 個 file 違規。

**v2.0.4 fix (Phase 12 永久 rule)**:

- ✅ 拎走 frontend `modules/cycle-synthesizer.ts` 整個 file (276 行): `computeMA()` 拎 `klineCloses` 計 MA5/MA20 + `synthesizeCycle()` 加權綜合 + `computeTriggers()` 5 個 trigger + `computeTransitions()` turn-around
- ✅ 拎走 frontend `modules/synthesizer.ts` 整個 file (515+ 行): `applyWeightDiscounts()` / `detectConflicts()` / `computeConsensus()` / `computeSSI()` / `computeTCM()` / `computeAlignment()` / `computeGrade()` / `computeKelly()` / `Synthesizer.synthesize()` 8 stage frontend 重做
- ✅ 拎走 `modules/decision-engine.ts` 嘅 `import { synthesizeCycle } from './cycle-synthesizer.ts'` + frontend call (line 1224-1228), 改用 backend emit fallback (line 1230+)
- ✅ 拎走 `tests/test-cycle-synth.mjs` + `__tests__/synthesizer.test.mjs` 2 個 frontend test (frontend synthesizeCycle call 拎走, frontend test 冇意義)
- ✅ 加 `backend/tests/test_synthesizer.py` 7 個 pytest 對齊 backend 8 stage 計算 (沿用 §Algorithm Backend-only + 模組化永久 rule)
- ✅ Update `index.ts` 拎走 `synthesizer.ts` re-export (dead code 因為 testing page 用 fetch backend)
- ✅ 對齊 §Cache bust self-check 永久 rule 21:24 sync bump `?v=2.3.176 → 2.3.177` + `ALGO_CACHE_BUST 4.97.0 → 4.98.0`

**永久 rule checklist**:
- ✅ frontend testing page M7 entry 永遠 fetch backend `/api/algorithms/run?algo=synthesizer` 拎 verdict (Phase 11 + Phase 12 沿用)
- ✅ frontend 唔可以再拎 K 線喺 frontend 計 MA5/MA20 (對齊 §數據處理 Server 內部做永久 rule b2d851ca 2026-08-23)
- ✅ frontend 唔可以再 8 stage 重做 backend emit 結果 (對齊 §Algorithm Backend-only + 模組化永久 rule 2026-08-22)
- ✅ 對齊 §M7 v2.0.2 Frontend display path fix 永久 rule — frontend display 永遠拎 `verdict.meta.*` 對齊 backend emit shape
- ✅ 對齊 §M7 v2.0.3 Phase 11 永久 rule — adapter.mjs `analyzeDecisionEngine` 拎走 chain 換 fetch backend
- ✅ 對齊 §Backend hot-reload 永久 rule — 改 backend 必 restart + curl verify (今次冇改 backend algorithm.py, 唔需要 restart, 但 4 隻 stock curl verify 確認 backend M7 仲係 work)

**凡人話 verify 結論**:
- 7 個 backend pytest 全部通過: `test_synthesizer_registered_in_registry` / `test_synthesizer_empty_verdicts` / `test_synthesizer_unanimous_up_high_confidence` / `test_synthesizer_conflict_pair_detection` / `test_synthesizer_weight_discount_generalized` / `test_synthesizer_meta_shape_for_frontend` / `test_synthesizer_aggregated_warnings_propagation`
- 4 隻 stock curl verify backend M7 仲係 work (data_window_days=1260):
  - HK.00700: state=DOWN conf=0.536 ssi=49.3 grade=C+(53.6) kelly=zero consensus=DOWN(0.75) conflicts=3 warnings=14
  - HK.00019: state=UP conf=0.556 ssi=52.6 grade=C+(55.6) kelly=quarter consensus=UP(0.68) conflicts=0 warnings=8
  - US.AAPL: state=SIDEWAYS conf=0.516 ssi=46.0 grade=C+(51.6) kelly=zero consensus=SIDEWAYS(0.71) conflicts=0 warnings=8
  - US.MSFT: state=UP conf=0.63 ssi=60.5 grade=B(63.0) kelly=quarter consensus=UP(0.73) conflicts=0 warnings=2

**對應文件**:
- `algorithms/AS-03-cycle-detection/modules/cycle-synthesizer.ts` (拎走, 276 行)
- `algorithms/AS-03-cycle-detection/modules/synthesizer.ts` (拎走, 515+ 行)
- `algorithms/AS-03-cycle-detection/modules/decision-engine.ts` v2.0.4 (拎走 synthesizeCycle import + frontend call, 改用 backend emit fallback)
- `algorithms/AS-03-cycle-detection/index.ts` v2.0.4 (拎走 synthesizer.ts re-export)
- `algorithms/AS-03-cycle-detection/tests/test-cycle-synth.mjs` (拎走, dead code)
- `algorithms/AS-03-cycle-detection/__tests__/synthesizer.test.mjs` (拎走, dead code)
- `backend/tests/test_synthesizer.py` v2.0.4 (新加 7 個 pytest, 對齊 backend 8 stage)
- `testing-page/index.html` (cache bust ?v=2.3.176 → 2.3.177)
- `testing-page/testing-page.js` (ALGO_CACHE_BUST 4.97.0 → 4.98.0)
- `docs/research/AS-03-cycle-detection/MODULE-07-SYNTHESIZER.md` v2.0.4 (待更新)

**對應 commit**: 即將 push (Spec Sync #65 v2.0.4) — 等大少 trigger

### M1-M6 frontend 拎走 永久 rule (大少 2026-09-12 07:22 trigger, Spec Sync #66 v2.x)

**凡人話**: Phase 12 拎走咗 M7 3 個 file 之後, 大少 9月12日 07:22 trigger「你再去查下M1.-M6 有沒有同樣的問題,我要的是後台做計算,前台只是顯示」, 拎 evidence 發現 M1-M6 frontend 6 個 module file 全部有 `class XxxModule implements CycleModule<KLine[]>` 計算 class (KLine 入, verdict 出), 同 M7 拎走 pattern 一樣。

**拎 evidence 確認 import chain (frontend testing page 已經走 fetch backend path)**:
- `testing-page/testing-page.js`: 完全冇 import M1-M6 frontend module class (Phase 1-6 已經全部 fetch backend, 大少 8月20-21日 拎走)
- `algorithms/AS-03-cycle-detection/adapter.mjs`: 完全冇 import M1/M2/M3/M4/M6 frontend module class (Phase 2-6 已經 fetch backend, M5 之前 8月20日 21:30 Phase 6 已經拎走), 6 個 module 嘅 chart overlay (`renderXxxChartOverlay`) 拎 `verdict.meta.*` 拎 data, 屬於 display layer 唔係 M7 algorithm 計算
- `algorithms/AS-03-cycle-detection/modules/decision-engine.ts`: 完全冇 import M1-M6 module class
- `algorithms/AS-03-cycle-detection/__tests__/smoke.mjs`: 唯一仲 import M1-M6 module class + CycleDetector 嘅 file, 拎走 (frontend 拎走 chain 一齊拎走)
- `algorithms/AS-03-cycle-detection/__tests__/standard-verdict.test.mjs`: 用 `toStandardVerdictMA/HL/TL/IND/VP/VOL` 6 個 helper, 拎走 (frontend wrapper 拎走 chain 一齊拎走)

**v2.x fix (Phase 13-18 永久 rule)**:

- ✅ 拎走 frontend `modules/ma-alignment.ts` 整個 file (24206 bytes): `MAAlignmentV2Module` class implements `CycleModule<KLine[]>` — KLine 入 verdict 出, frontend 計算違規
- ✅ 拎走 frontend `modules/hl-structure.ts` 整個 file (30484 bytes): `HLStructureModule` class implements `CycleModule<KLine[]>` — 拎 K 線計峰谷 + 趨勢分析 + 結構分數 + 短線 mode 確認 + 突破 override
- ✅ 拎走 frontend `modules/trendline.ts` 整個 file (33685 bytes): `TrendlineModule` class implements `CycleModule<KLine[]>` — 拎 K 線計 Hurst/ADX 趨勢線 + 10+2 條 rule + 3 個 self-check warning (M3 Spec Sync #51 v0.1.4 1:1 port, 拎走改 fetch backend)
- ✅ 拎走 frontend `modules/indicators.ts` 整個 file (49162 bytes): `IndicatorsModule` class implements `CycleModule<KLine[]>` — 拎 K 線計 RSI/EMA/MACD/extrema
- ✅ 拎走 frontend `modules/volume.ts` 整個 file (29279 bytes): `VolumePrice` class implements `CycleModule<KLine[]>` — 拎 K 線計 量價 + VWAP + OBV + 量能 37 個 meta field
- ✅ 拎走 frontend `modules/volatility.ts` 整個 file (35214 bytes): `VolatilityModule` class implements `CycleModule<KLine[]>` — 拎 K 線計 波動率 + VCP + Squeeze + Hurst+ADX regime gate (M6 Spec Sync #54 v2.0.0 1:1 port, 拎走改 fetch backend)
- ✅ 拎走 frontend `std-verdict.ts` 整個 file (348 行): 純 frontend wrapper 純計算 `computeSentiment6D()` + `computeExpectedReturn()` + `computeMaxDrawdownEstimate()` + `toStandardVerdict()` + `runAndStandardize()` — 全部 frontend 計算違規
- ✅ 拎走 frontend `__tests__/{ma-alignment,hl-structure,trendline,indicators,volume,volatility,smoke,standard-verdict}.test.mjs` 8 個 frontend test file (frontend chain 拎走後冇意義)
- ✅ 拎走 `index.ts` 嘅 6 個 module import (line 15-20) + CycleDetector class 整個 (line 60-218, 完全依賴 6 個 frontend module) + 4 個 orchestrator import (line 24-27, smoke.mjs 拎走後冇人 import) + 4 個 orchestrator re-export (line 250-254) + AnalyzeOptions interface (line 30-39) + enableFlagsToRecord helper (line 46-56) + DEFAULT_ENABLE_FLAGS import (line 28) + 6 個 module re-export (line 231-236) + 1 個 std-verdict re-export (line 224-228)
- ✅ 保留 `index.ts` 嘅 `ZmenMAAlignmentModule` (大少 2026-08-08 09:13 trigger zmen均算法獨立, 唔屬 7 個 modules) + `DecisionEngine` re-export (M8 follow-up) + `MultiTFOrchestrator` / `RegimeChangeAlerter` / `Aggregator` re-export (orchestrator follow-up) + `types.ts` / `config.ts` re-export (type defs + config, frontend 拎走後保留 file)
- ✅ 加 `backend/tests/test_m1_to_m6.py` 6 個 pytest 對齊 backend M1-M6 emit shape (沿用 §Algorithm Backend-only + 模組化永久 rule, 對齊 test_synthesizer.py pattern)
- ✅ 對齊 §Cache bust self-check 永久 rule 21:24 sync bump `?v=2.3.177 → 2.3.178` + `ALGO_CACHE_BUST 4.98.0 → 4.99.0`

**永久 rule checklist**:
- ✅ Frontend M1-M6 testing page entry 永遠 fetch backend `/api/algorithms/run?algo={ma_alignment,hl_structure,trendline,indicators,volume_price,volatility}&symbol=...&data_window_days=1260` 拎 verdict (沿用 Phase 1-6 拎走 pattern)
- ✅ Frontend 唔可以再拎 K 線喺 frontend 計 MA/高低點/趨勢線/指標/量價/波動率 (對齊 §數據處理 Server 內部做永久 rule b2d851ca 2026-08-23)
- ✅ Frontend 唔可以再 8 stage 重做 backend emit 結果 (對齊 §Algorithm Backend-only + 模組化永久 rule 2026-08-22)
- ✅ 對齊 §M7 v2.0.4 Phase 12 永久 rule — M1-M6 拎走 pattern 沿用 M7 拎走 pattern
- ✅ 對齊 §M7 v2.0.2 Frontend display path fix 永久 rule — frontend display 永遠拎 `verdict.meta.*` 對齊 backend emit shape
- ✅ 對齊 §verdict.meta.symbol 永久 rule (大少 2026-09-07 08:30) — backend runner 統一 inject caller symbol 落 options dict, frontend 拎 `verdict.meta.symbol == caller symbol` 永遠 True
- ✅ 對齊 §verdict.meta.state 永久 rule (跟 §M6 Spec Sync #54 v2.0.3) — backend emit state 落 `verdict.meta.state` (M1-M5 暫時唔 set 落 `verdict.state` 頂層, runner service algorithm_runner.py line 313-314 統一 inject `state: upstream_meta.get("state")`)
- ✅ Backend 唔需要改 (M1-M6 算法已經 backend 跑, source of truth `backend/algorithms/{ma_alignment,hl_structure,trendline,indicators,volume_price,volatility}/algorithm.py`)
- ✅ Follow-up: M1-M5 backend algorithm 跟 M6 pattern 補返 set `verdict.state` + `verdict.confidence` 落頂層 (對齊 §M6 Spec Sync #54 v2.0.3 永久 rule), 拎 pytest `v.state in valid states` 直接 assert 唔再用 `v.meta.state`

**凡人話 verify 結論**:
- 6 個 backend pytest 全部通過: `test_m1_ma_alignment_meta_shape` / `test_m2_hl_structure_meta_shape` / `test_m3_trendline_meta_shape` / `test_m4_indicators_meta_shape` / `test_m5_volume_price_meta_shape` / `test_m6_volatility_meta_shape`
- 6 隻 stock × 6 個 algo = 18 個 curl 全部拎到 verdict, backend emit 完整 (data_window_days=1260):
  - **M1 ma_alignment** (31 meta keys): HK.00700 DOWN 0.43, HK.00005 SIDEWAYS 0.30, US.AAPL SIDEWAYS 0.35
  - **M2 hl_structure** (37 meta keys): HK.00700 UP 0.30, HK.00005 UP 0.32, US.AAPL UP 0.40
  - **M3 trendline** (35 meta keys): HK.00700 DOWN 0.30, HK.00005 UP 0.30, US.AAPL UP 0.30
  - **M4 indicators** (33 meta keys): HK.00700 exhausted_neutral 0.0, HK.00005 exhausted_neutral 0.25, US.AAPL exhausted_neutral 0.0
  - **M5 volume_price** (41 meta keys): HK.00700 SIDEWAYS 0.30, HK.00005 UP 0.55, US.AAPL SIDEWAYS 0.30
  - **M6 volatility** (41 meta keys): HK.00700 DOWN 0.85, HK.00005 SIDEWAYS 0.25, US.AAPL SIDEWAYS 0.25
- 所有 `verdict.meta.symbol == caller symbol` ✅ (對齊 §verdict.meta.symbol 永久 rule)

**對應文件**:
- `algorithms/AS-03-cycle-detection/modules/ma-alignment.ts` (拎走, 24206 bytes)
- `algorithms/AS-03-cycle-detection/modules/hl-structure.ts` (拎走, 30484 bytes)
- `algorithms/AS-03-cycle-detection/modules/trendline.ts` (拎走, 33685 bytes)
- `algorithms/AS-03-cycle-detection/modules/indicators.ts` (拎走, 49162 bytes)
- `algorithms/AS-03-cycle-detection/modules/volume.ts` (拎走, 29279 bytes)
- `algorithms/AS-03-cycle-detection/modules/volatility.ts` (拎走, 35214 bytes)
- `algorithms/AS-03-cycle-detection/std-verdict.ts` (拎走, 348 行 frontend wrapper)
- `algorithms/AS-03-cycle-detection/__tests__/ma-alignment.test.mjs` (拎走, dead code)
- `algorithms/AS-03-cycle-detection/__tests__/hl-structure.test.mjs` (拎走, dead code)
- `algorithms/AS-03-cycle-detection/__tests__/trendline.test.mjs` (拎走, dead code)
- `algorithms/AS-03-cycle-detection/__tests__/indicators.test.mjs` (拎走, dead code)
- `algorithms/AS-03-cycle-detection/__tests__/volume.test.mjs` (拎走, dead code)
- `algorithms/AS-03-cycle-detection/__tests__/volatility.test.mjs` (拎走, dead code)
- `algorithms/AS-03-cycle-detection/__tests__/smoke.mjs` (拎走, dead code)
- `algorithms/AS-03-cycle-detection/__tests__/standard-verdict.test.mjs` (拎走, dead code)
- `algorithms/AS-03-cycle-detection/index.ts` v2.x (拎走 6 個 import + CycleDetector class + 4 個 orchestrator import + 4 個 orchestrator re-export + AnalyzeOptions + enableFlagsToRecord + DEFAULT_ENABLE_FLAGS + 6 個 module re-export + 1 個 std-verdict re-export)
- `backend/tests/test_m1_to_m6.py` v2.x (新加 6 個 pytest, 對齊 backend M1-M6 emit shape)
- `testing-page/index.html` (cache bust ?v=2.3.177 → 2.3.178)
- `testing-page/testing-page.js` (ALGO_CACHE_BUST 4.98.0 → 4.99.0)

**保留清單 (唔拎走, 屬獨立算法或 follow-up)**:
- `algorithms/AS-03-cycle-detection/modules/zmen-ma-alignment.ts` (zmen均算法獨立, 大少 2026-08-08 09:13 trigger 唔屬 7 個 modules)
- `algorithms/AS-03-cycle-detection/modules/slope-momentum.ts` (暫時隱藏, 大少 2026-08-07 23:15 trigger)
- `algorithms/AS-03-cycle-detection/modules/decision-engine.ts` (M8 follow-up, 大量違規計算拎走放第 2 輪)
- `algorithms/AS-03-cycle-detection/modules/back-test.ts` + `backtest-timeline.ts` (M9 follow-up)
- `algorithms/AS-03-cycle-detection/orchestrator/{multi-tf,alert,aggregator,synthesize}.ts` (orchestrator follow-up)
- `algorithms/AS-03-cycle-detection/types.ts` (type defs, 拎走 frontend module 後保留)
- `algorithms/AS-03-cycle-detection/config.ts` (config defs, 拎走 frontend module 後保留, 部分 default value 拎走放 follow-up)
- `backend/algorithms/{ma_alignment,hl_structure,trendline,indicators,volume_price,volatility}/algorithm.py` (source of truth, 唔改)

**對應 commit**: 即將 push (Spec Sync #66 v2.x) — 等大少 trigger

### M8-M9 v2.x frontend 拎走 永久 rule (大少 2026-09-12 10:07 trigger, Spec Sync #67 v2.x)

**凡人話**: Phase 12 拎走咗 M7 frontend, Phase 13-18 拎走咗 M1-M6 frontend, 大少 9月12日 10:07 trigger「動手,之後你幫我做全面檢測」, 套用同樣 pattern 對 M8/M9 frontend 全部做 audit, 拎走任何前台違規計算, 對齊 §數據處理 Server 內部做 + §算法 Backend-only + 模組化永久 rule。

**拎 evidence 確認 import chain (M8/M9 frontend 拎走 chain)**:
- Phase 1 evidence 確認 M8/M9/orchestrator/slope-momentum 全部 `class XxxEngine implements CycleModule<KLine[]>` 計算 class, KLine 入 verdict 出
- Phase 2 拎走 frontend file 16 個: `decision-engine.ts` (M8) + `back-test.ts` + `backtest-timeline.ts` (M9) + `multi-tf.ts` (M5 orchestrator) + `slope-momentum.ts` (M8) + 4 個 orchestrator (regime-change-alerter, aggregator, alerts, orchestrator/synthesize) + 8 個 frontend test file
- testing page 完全冇 import M8/M9 frontend engine class (Phase 12 拎走 chain 已經 fetch backend)

**v2.x fix (Phase 19-22 永久 rule)**:

- ✅ 拎走 frontend `modules/decision-engine.ts` (M8): `DecisionEngine` class implements `CycleModule<KLine[]>` — 拎 K 線 + 6 個 module verdict + Synthesizer verdict → 8 個 finalAction 決策樹
- ✅ 拎走 frontend `modules/back-test.ts` + `modules/backtest-timeline.ts` (M9): `BackTestEngine` + `BacktestTimeline` class implements `CycleModule<KLine[]>` — 拎 K 線 + walk-forward CV 最佳化
- ✅ 拎走 frontend `modules/slope-momentum.ts` (M8 Stage 2): `SlopeMomentum` class implements `CycleModule<KLine[]>` — 10 條 rule 計斜率動能 (Stage 2 backend 仲未 implement, 拎走 frontend chain 暫停)
- ✅ 拎走 frontend 4 個 orchestrator: `multi-tf.ts` (M5) + `regime-change-alerter.ts` + `aggregator.ts` + `alerts.ts` (orchestrator layer)
- ✅ 拎走 frontend `build/` 5 個 bundle (dead code, module 拎走後冇人 import): `back-test.bundle.js` + `backtest-timeline.bundle.js` + `decision-engine.bundle.js` + `multi-tf.bundle.js` + `slope-momentum.bundle.js`
- ✅ 拎走 frontend `scripts/` 4 個 m9-*.mjs (dead code): `m9-apply-bestparams-to-m8.mjs` + `m9-pilot-10-stocks.mjs` + `m9-pilot-rerun-3-v2-1w.mjs` + `m9-pilot-rerun-7-1w.mjs`
- ✅ 拎走 frontend `__tests__/zmen-ma-alignment.test.mjs` 1 個 frontend test file (對齊 §M7 v2.0.4 揀 frontend test 拎走 + backend pytest 永久 rule)
- ✅ 拎走 frontend `adapter.mjs` M8 SlopeMomentum chain (共 13951 chars, frontend 0 個計算 function 永久 rule §Frontend 0 個計算 function 沿用):
  - line 132-140 option toggle definition (key=`enableSlopeMomentum`)
  - line 148 / 164 / 3517-3526 嘅 M8 comment
  - line 163 `const enableSlopeMomentum = options.enableSlopeMomentum === true;`
  - line 188-197 主流程 call site `if (enableSlopeMomentum) { moduleVerdicts.push(await analyzeSlopeMomentum(...)) }`
  - line 705-992 整段 M8 chain (function `analyzeSlopeMomentum` + render `renderSlopeMomentumResult` + `_loadSlopeMomentumScriptTag` + `_getSlopeMomentumAnalyzer`)
  - line 1537 render dispatch `if (mv.moduleId === 'slope-momentum') return renderSlopeMomentumResult(mv);`
  - line 1547 / 1570 嘅 display name ternary
  - line 1590-1591 modDetail block `} else if (mv.moduleId === 'slope-momentum') { ... }`
  - line 34 description string 拎走 M8 字眼
  - line 116 / 626 / 671 嘅 Stage 1 隱藏 comment
- ✅ 拎走 dead code `computeConsecutiveUpDays` (line 6965-6973, 拎走 M7 frontend chain 後冇人 call, 對齊 §Frontend 0 個計算 function spirit)

**對應 commit (Phase 1-7 即將 push, Spec Sync #67 v2.x)**:
- 改 `testing-page/testing-page.js` ALGO_CACHE_BUST `4.99.0 → 5.0.0` (對齊 §Cache bust self-check 永久 rule 21:24)
- 改 `testing-page/index.html` `?v=2.3.178 → 2.3.179` (對齊 §Cache bust self-check 永久 rule 21:24)
- 修 `backend/tests/test_decision_engine.py` Python 3.14 asyncio deprecated issue (`asyncio.get_event_loop().run_until_complete(coro) if ... else asyncio.run(coro)` → `asyncio.run(coro)`, 1 行 fix)

**永久 rule checklist**:
- ✅ Frontend testing page entry 永遠 fetch backend `/api/algorithms/run?algo={decision_engine,back_test}&symbol=...&data_window_days=1260` 拎 verdict (沿用 Phase 12 拎走 pattern)
- ✅ Frontend 唔可以再拎 K 線喺 frontend 計 DecisionEngine 決策樹 / BackTest walk-forward CV / SlopeMomentum 斜率動能 (對齊 §數據處理 Server 內部做永久 rule b2d851ca 2026-08-23)
- ✅ Frontend 唔可以再拎 orchestrator 喺 frontend aggregate (對齊 §Algorithm Backend-only + 模組化永久 rule 2026-08-22)
- ✅ Frontend testing page 完全冇 import M8/M9 frontend engine class (拎走 chain 沿用 M1-M6/M7 pattern)
- ✅ Backend 沿用 `backend/algorithms/{decision_engine,back_test}/algorithm.py` (source of truth, 唔改)
- ✅ Backend pytest 沿用 `test_decision_engine.py` (10 tests) + `test_back_test.py` (11 tests), 23/23 100% 綠 (修 1 個 Python 3.14 asyncio pre-existing issue)
- ✅ 對齊 §M7 v2.0.4 Phase 12 + §M1-M6 v2.x frontend 拎走 永久 rule — 拎走 pattern 沿用
- ✅ 對齊 §Cache bust self-check 永久 rule 21:24 — 改 adapter.mjs 同步 bump ALGO_CACHE_BUST 4.99.0 → 5.0.0 + ?v=2.3.178 → 2.3.179

**凡人話 verify 結論**:
- 36/36 pytest 全部通過: M1-M6 (6) + M7 (7) + M8 (12) + M9 (11)
- 2 隻 stock × 2 個 M8/M9 algo = 4 個 curl 全部拎到 verdict, backend emit 完整 (data_window_days=1260):
  - **M8 decision_engine** (HK.00700): moduleId=decision-engine ✅
  - **M8 decision_engine** (US.AAPL): moduleId=decision-engine ✅
  - **M9 back_test** (HK.00700): moduleId=back-test ✅
  - **M9 back_test** (US.AAPL): moduleId=back-test ✅
- 全面檢測 grep 拎 evidence:
  - `modules/` 拎走後剩 `zmen-ma-alignment.ts` (zmen 獨立, chart overlay display layer 例外)
  - `build/` 拎走後 empty
  - `scripts/` 拎走後 empty
  - `__tests__/` 拎走後 empty
  - `tests/` 拎走後 empty
  - `class XxxEngine implements CycleModule` 只剩 `ZmenMAAlignmentModule` (chart overlay display layer)
  - 6 個 `computeXxx` function 全部屬 chart overlay display layer (`_computeMASeries` / `_computeMASeriesV2` / `_computeHorizontalLineSeries` / `computeSlope` / `_computeTrendlineSeries` + dead `computeConsecutiveUpDays` 已拎走), 拎 `verdict.meta.*` 拎 path 對齊 backend emit

**對應文件**:
- `algorithms/AS-03-cycle-detection/modules/decision-engine.ts` (拎走, M8 frontend)
- `algorithms/AS-03-cycle-detection/modules/back-test.ts` (拎走, M9 frontend)
- `algorithms/AS-03-cycle-detection/modules/backtest-timeline.ts` (拎走, M9 frontend)
- `algorithms/AS-03-cycle-detection/modules/slope-momentum.ts` (拎走, M8 Stage 2 frontend)
- `algorithms/AS-03-cycle-detection/modules/multi-tf.ts` (拎走, M5 orchestrator)
- `algorithms/AS-03-cycle-detection/modules/regime-change-alerter.ts` (拎走, orchestrator)
- `algorithms/AS-03-cycle-detection/modules/aggregator.ts` (拎走, orchestrator)
- `algorithms/AS-03-cycle-detection/modules/alerts.ts` (拎走, orchestrator)
- `algorithms/AS-03-cycle-detection/build/*.bundle.js` (拎走 5 個, dead code)
- `algorithms/AS-03-cycle-detection/scripts/m9-*.mjs` (拎走 4 個, dead code)
- `algorithms/AS-03-cycle-detection/__tests__/zmen-ma-alignment.test.mjs` (拎走, frontend test)
- `algorithms/AS-03-cycle-detection/adapter.mjs` v2.x (拎走 M8 SlopeMomentum chain 共 13951 chars)
- `backend/tests/test_decision_engine.py` (修 1 個 Python 3.14 asyncio issue)
- `testing-page/testing-page.js` (ALGO_CACHE_BUST 4.99.0 → 5.0.0)
- `testing-page/index.html` (?v=2.3.178 → 2.3.179)

**保留清單 (唔拎走)**:
- `algorithms/AS-03-cycle-detection/modules/zmen-ma-alignment.ts` (zmen均算法獨立, 大少 2026-08-08 09:13 trigger 唔屬 7 個 modules, chart overlay display layer 例外)
- `algorithms/AS-03-cycle-detection/types.ts` (type defs, 拎走 frontend module 後保留)
- `algorithms/AS-03-cycle-detection/config.ts` (config defs, 拎走 frontend module 後保留)
- `backend/algorithms/{decision_engine,back_test}/algorithm.py` (source of truth, 唔改)
- 6 個 `computeXxx` chart overlay function (`_computeMASeries` / `_computeMASeriesV2` / `_computeHorizontalLineSeries` / `computeSlope` / `_computeTrendlineSeries`): 拎 `verdict.meta.*` 拎 path, 純 lightweight-charts series 渲染, 對齊 §M3 trendline chart overlay 修復 永久 rule + §Frontend 0 個計算 function 永久 rule chart overlay 例外

**對應 commit**: 即將 push (Spec Sync #67 v2.x) — 等大少 trigger Commit

### Frontend 0 個計算 function 永久 rule (大少 2026-09-12 10:07 trigger)

**凡人話**: frontend 永遠 fetch backend verdict 拎 path 對齊 backend emit shape, 唔可以再拎 K 線喺 frontend 計算任何 algorithm 結果。chart overlay display layer (`_computeMASeries` / `_computeTrendlineSeries` 等拎 `verdict.meta.*` 拎 path 純做 lightweight-charts series 渲染) 屬例外, 唔拎走。

**凡 7 個 module 拎走 pattern checklist**:
- ✅ M1 frontend `modules/ma-alignment.ts` 拎走 → backend `backend/algorithms/ma_alignment/algorithm.py` 拎 path
- ✅ M2 frontend `modules/hl-structure.ts` 拎走 → backend `backend/algorithms/hl_structure/algorithm.py` 拎 path
- ✅ M3 frontend `modules/trendline.ts` 拎走 → backend `backend/algorithms/trendline/algorithm.py` 拎 path
- ✅ M4 frontend `modules/indicators.ts` 拎走 → backend `backend/algorithms/indicators/algorithm.py` 拎 path
- ✅ M5 frontend `modules/volume.ts` 拎走 → backend `backend/algorithms/volume_price/algorithm.py` 拎 path
- ✅ M6 frontend `modules/volatility.ts` 拎走 → backend `backend/algorithms/volatility/algorithm.py` 拎 path
- ✅ M7 frontend `modules/{cycle-synthesizer,synthesizer,decision-engine}.ts` 拎走 → backend `backend/algorithms/synthesizer/algorithm.py` 拎 path
- ✅ M8 frontend `modules/{decision-engine,slope-momentum}.ts` 拎走 → backend `backend/algorithms/decision_engine/algorithm.py` 拎 path (M8 SlopeMomentum Stage 2 backend pending, frontend 拎走暫停)
- ✅ M9 frontend `modules/{back-test,backtest-timeline}.ts` 拎走 → backend `backend/algorithms/back_test/algorithm.py` 拎 path

**凡 frontend algorithm file 拎走 checklist**:
- ✅ 拎走任何 `class XxxEngine implements CycleModule<KLine[]>` 嘅計算 class (KLine 入 verdict 出, frontend 計算違規)
- ✅ 拎走任何 `class XxxModule` 計算 class
- ✅ 拎走任何 frontend `function computeXxx` / `function _computeXxx` / `function calculateXxx` 純算法計算 (chart overlay display layer 例外)
- ✅ 拎走 dead code (冇 call site 嘅 function, e.g. `computeConsecutiveUpDays` 拎走 M7 frontend chain 後變 dead)
- ✅ 拎走 build bundle (frontend module 拎走後冇人 import 嘅 bundle)
- ✅ 拎走 pilot script (frontend bundle 拎走後冇人 import 嘅 .mjs)
- ✅ 拎走 frontend test (對齊 §M7 v2.0.4 揀 frontend test 拎走 + backend pytest 永久 rule)

**凡 frontend algorithm file 保留 checklist** (唔拎走):
- ✅ `ZmenMAAlignmentModule` (大少 2026-08-08 09:13 trigger zmen均算法獨立, 唔屬 7 個 modules, chart overlay display layer 例外)
- ✅ types.ts / config.ts (type defs + config, frontend 拎走後保留 file)
- ✅ 6 個 chart overlay `_computeXxx` function (`_computeMASeries` / `_computeMASeriesV2` / `_computeHorizontalLineSeries` / `computeSlope` / `_computeTrendlineSeries`): 拎 `verdict.meta.*` 拎 path, 純 lightweight-charts series 渲染
- ✅ Backend algorithm file (source of truth, 唔改)
- ✅ Backend pytest (`test_m1_to_m6.py` 6 + `test_synthesizer.py` 7 + `test_decision_engine.py` 12 + `test_back_test.py` 11, 共 36 tests)

**對應 commit**: 沿用 §M7 v2.0.4 Phase 12 + §M1-M6 v2.x + §M8-M9 v2.x 永久 rule checklist

### 全面檢測 永久 rule (凡人話: frontend 0 個計算 function 永久 rule套用模式)

**凡人話**: 大少 2026-09-12 10:07 trigger「動手,之後你幫我做全面檢測」, 套用 §M7 v2.0.4 Phase 12 + §M1-M6 v2.x + §M8-M9 v2.x frontend 拎走 永久 rule 做全面 grep 檢測, 確認 frontend 0 個計算 function 違規。

**全面檢測 grep 拎 evidence checklist** (每次 frontend 拎走後必跑):

1. **modules/ folder 拎走後剩低**: `ls algorithms/AS-03-cycle-detection/modules/` 只剩 `zmen-ma-alignment.ts` (chart overlay display layer 例外)
2. **build/ folder 拎走後**: `ls algorithms/AS-03-cycle-detection/build/` empty (冇 bundle)
3. **scripts/ folder 拎走後**: `ls algorithms/AS-03-cycle-detection/scripts/` empty (冇 pilot script)
4. **__tests__/ folder 拎走後**: `ls algorithms/AS-03-cycle-detection/__tests__/` empty (冇 frontend test)
5. **tests/ folder 拎走後**: `ls algorithms/AS-03-cycle-detection/tests/` empty (冇 frontend test)
6. **frontend `class XxxEngine implements CycleModule` 計算 class**: `grep -rn "implements CycleModule"` 只剩 `ZmenMAAlignmentModule` (chart overlay display layer)
7. **frontend `function computeXxx / _computeXxx / calculateXxx` 計算 function**: `grep -rn "function compute\|function _compute\|function calculate"` 拎 `verdict.meta.*` 拎 path 嘅 chart overlay display layer 屬例外, 其他拎走
8. **pytest 100% 綠**: `python3 -m pytest backend/tests/test_m1_to_m6.py backend/tests/test_synthesizer.py backend/tests/test_decision_engine.py backend/tests/test_back_test.py` 36/36 pass
9. **curl verify backend emit 完整**: `curl /api/algorithms/run?algo={ma_alignment,hl_structure,trendline,indicators,volume_price,volatility,synthesizer,decision_engine,back_test}&symbol=HK.00700&data_window_days=1260` 全部拎到 verdict, `verdict.meta.symbol == caller symbol`, `verdict.meta.moduleId` 對齊 algo

**凡人話 verify 結論** (M8-M9 v2.x 拎走後, 2026-09-12 11:55):
- 全部 9 個 grep 拎 evidence 通過, frontend 0 個計算 function 違規
- 36/36 pytest 100% 綠
- 4 個 curl verify M8/M9 backend 仲 work
- Frontend 永遠 fetch backend `/api/algorithms/run` 拎 verdict, 對齊 backend emit shape

**對應 commit**: 沿用 §M7 v2.0.4 Phase 12 + §M1-M6 v2.x + §M8-M9 v2.x 永久 rule checklist

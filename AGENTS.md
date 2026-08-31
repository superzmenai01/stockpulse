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
- 真實數據用 HTTP call backend 拎到 T-1 8月21日 fresh K 線, 60 隻 v2.1 真實結果: 強升 5 隻, 強跌 1 隻, 弱升 6 隻, 弱跌 7 隻, 上升回調 4 隻, 下跌反彈 4 隻, 到底轉勢 3 隻, 到頂轉勢 0 隻, 橫行 30 隻

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

### ZigZag 決定點 橙色旗仔 marker 永久 rule (大少 2026-08-30 17:50)

**凡人話解釋**: 紫色 ZigZag 線 plot 喺 **peak/trough 嗰支 K 線** (即「確認咗嘅轉向點」), 但「上一支 ZigZag 喺邊一日決定形成」冇記號 — 即係股價反方向走到指定 % 嗰一日。大少想喺「決定嗰一日」加個視覺符號, 等佢即時知道「上一支 ZigZag 喺邊一日決定形成」。

**凡人話 render 效果**:
```
K 線 A (peak, e.g. 100元)        K 線 B (跌穿 5% 到 94元, 確認轉勢)
      ╱╲                                ⚐
     ╱  ╲                          ↑ 橙色旗仔
────●────╲──────────────────────────●─── K 線 B
     ╲                               ↑
   紫色 P 點                       決定嗰日
   plot 喺 A                       plot 喺 B
```

**永久 rule**:
- ✅ **ZigZag 決定點 永久用橙色 #FF9800 細小旗仔 marker**, plot 喺決定嗰日 (即股價反方向到達 threshold 嗰支 K 線)
- ✅ **形狀**: 細小旗仔 (Flag) — Lightweight Charts v4.2.3 / v5 setMarkers 支援 `shape: 'flag'`
- ✅ **顏色**: 橙色 #FF9800 (Material Orange 500) — 對比紫色 ZigZag 線 (#9C27B0) 鮮明
- ✅ **位置**: `aboveBar` — 旗仔喺決定嗰日 K 線 close 上面 8px
- ✅ **文字**: 空白 (純視覺 marker, 唔顯示號碼)
- ✅ **大小**: 預設 1 (細小)
- ✅ **跟 ZigZag 啟用 toggle 同步 on/off** (`zigzagEnabled` / `indicatorConfig.ZigZag.enabled`), 唔加新獨立 toggle
- ✅ **每個 ZigZag point 對應 1 個旗仔** (`decisionDate` 有值嗰陣), 第一個 point 冇旗仔 (永遠從第一支 K 線開始, 冇「決定」概念)
- ✅ **最後 ongoing point 都冇旗仔** (仲未確認轉勢, 等下一支 K 線先 trigger)
- ✅ **改 `calculateZigZagFrontend` / `backend/algorithms/zigzag/algorithm.py` 嗰陣, 必同步加 3 個 field** (`decisionDate` / `decisionValue` / `decisionType`), frontend + backend 鏡像
- ✅ **改 `adapter.mjs` 嗰陣, 必同步 bump 2 個地方 cache bust** (testing-page.js ALGO_CACHE_BUST + index.html ?v=2.3.X, 跟 2026-08-09 13:10 永久 rule)
- ✅ **setMarkers 跟 sequence marker merge 落 candleSeries** (因為 Lightweight Charts setMarkers 係 per series, 唔可以分開 set), sequence marker skip 嗰陣都要 set 旗仔 marker
- ✅ **旗仔 marker 拎 setData 之前必 dedupe by time** (對齊 4.40.0 永久 rule, 拎走 silent reject 破壞 chart state)
- ✅ **旗仔 marker time field 用 business day object** `{year, month, day}` (對齊 4.41.2 永久 rule, 避免 type 衝突 silent reject)
- ✅ **Production frontend** (`ChartContainer.tsx` + `ElliottWaveTestPage.tsx`) `fetchBackendZigZag` return shape 加 `decisionTime` / `decisionValue`, 用 `createSeriesMarkers` 旗仔 marker 對齊 testing page `setMarkers` 行為

**對應 file**:
- `testing-page/testing-page.js` `calculateZigZagFrontend` (4 個 push point 加 3 個 decision field)
- `algorithms/AS-03-cycle-detection/adapter.mjs` `renderMAAlignmentV2ChartOverlay` (新加 flag marker render, 跟 sequence marker merge)
- `backend/algorithms/zigzag/algorithm.py` `calculate_zigzag` (1-to-1 port frontend algorithm, 內部加 3 個 decision field)
- `web/src/components/chart/ChartContainer.tsx` `fetchBackendZigZag` + ZigZag useEffect (return shape 加 decision field + createSeriesMarkers 旗仔 marker)
- `web/src/pages/ElliottWaveTestPage/ElliottWaveTestPage.tsx` (對齊 ChartContainer)

對應 doc: M1-V22-RESEARCH.md 「🆕 大少 2026-08-30 17:50 Trigger — ZigZag 決定點 橙色旗仔 marker」section

### ZigZag P 點 sequence label 排序統一 永久 rule (大少 2026-08-31 09:00, 4.51.0)

**凡人話解釋**: 大少 8月31日 09:00 trigger「Zigzag的Point排序從右到左是從P1開始的，現在是從P 2開始，你去查明原因」— 統一 testing page ZigZag sequence label 對齊大少 8月29日 14:32 永久 rule (P1 = zzp[-1])。

**Root cause** (4.9.0 規則衝突):
- `algorithms/AS-03-cycle-detection/adapter.mjs:5245` 紫色 marker label 由 `idx + 2` 開始
- 鮮綠色 "1" 號 marker 喺 close extension 終點 (`adapter.mjs:5255`, `testing-page.js:1481` 預設 visible range = 最近 126 日，今日 K 線有時 out-of-range + 鮮綠色字 #00C853 淺色)
- 8月31日 01:59 拎返 setMarkers 嗰陣 (4.49.0 永久 rule) 盲目拎返 4.10.0 嗰個 spirit, 冇 reconcile 4.9.0 同 8月29日 P1 rule 衝突

**永久 rule** (4.51.0 新加):
- ✅ 改寫 4.9.0 永久 rule: 刪除「1 號 = 鮮綠色 close extension 終點」描述
- ✅ 統一跟大少 2026-08-29 14:32 永久 rule:
  - **P1 = 最新紫色 ZigZag 點** (verdict.meta.zigzagPoints 倒序後第一個, zzp[-1])
  - P2 = 第二新, P3 = 第三新, P4 = 第四新 (zzp[-2/-3/-4])
  - 上升: P1>P3, P2>P4
  - 下跌: P1<P3, P2<P4
  - 到頂轉勢: P1>P3 + P2>P4 + ZZ_slope<-3%
  - 到底轉勢: P1<P3 + P2>P4 + ZZ_slope>+3%
- ✅ Testing page 紫色 marker label 由 `idx + 2` 改 `idx + 1` (P1, P2, P3, ... 順序)
- ✅ 鮮綠色 close extension 終點 "1" 號 marker 拎走 (原 4.9.0 規則)
- ✅ 鮮綠色 close extension 線本身保留 (對齊 4.8.3 永久 rule「趨勢延續」視覺化), 但冇 sequence label
- ✅ 改 `adapter.mjs` 嗰陣, 必同步 bump 2 個地方 cache bust (testing-page.js ALGO_CACHE_BUST + index.html ?v=2.3.X, 跟 2026-08-09 13:10 永久 rule)
- ✅ 凡人話: 撳 showZigzagSequence toggle, 由右到左 P1, P2, P3, ... 全部紫色 circle, 對齊大少 8月29日 trigger

**對應 file**:
- `algorithms/AS-03-cycle-detection/adapter.mjs` `renderMAAlignmentV2ChartOverlay` (line 5238-5260): 改 `idx + 2` → `idx + 1` + 拎走 `greenMarkers` block + `allMarkers = purpleMarkers`
- `testing-page/testing-page.js` ALGO_CACHE_BUST '4.50.0' → '4.51.0' + 4.51.0 永久 rule comment
- `testing-page/index.html` ?v=2.3.111 → ?v=2.3.112

對應 doc: M1-V22-RESEARCH.md 「🟢 大少 trigger #N — ZigZag P 點 sequence label 排序統一 (2026-08-29 14:32 + 8月31日 09:00)」section

對應 commit: 即將 push (Spec Sync #48 流程)

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

### ZigZag 4.53.0 Sscript 還原點永久 rule (大少 2026-08-31 11:59 trigger)

**凡人話解釋**: 大少 8月31日 11:59 trigger「對齊 Sscript pattern (推薦)」— 大少發現我啱啱用 empty commit 嘅備份 (5c89c659, 7a424c58) 同之前 8月31日 07:52 嘅 Sscript pattern 唔同,要求對齊 3-component 還原點 pattern (annotated tag + backup branch + restore script)。

**還原點 4 個 component** (對齊 §15.45 Sscript pattern):
- ✅ **Annotated tag**: `restore-after-zigzag-4.53.0` (喺 `7a424c58`)
- ✅ **Backup branch**: `backup-after-zigzag-4.53.0` (喺 `7a424c58`)
- ✅ **Restore script**: `~/stockpulse/scripts/restore_after_zigzag_4.53.0.sh` (chmod +x, double confirm `yes` + `RESET`)
- ✅ **永久 rule**: ARCHITECTURE §15.53 + AGENTS.md

**永久 rule** (對齊 §15.45 Sscript pattern):
- ✅ 之後大項目 (refactor / spec rewrite / framework 升級 / 大少明確 trigger) 必做還原點 set
- ✅ 還原點必用 Sscript pattern: annotated tag + backup branch + restore script
- ✅ Restore script 必 double confirm (撳 `yes` + `RESET`) 避免意外
- ✅ Restore script 必 verify HEAD 對應 tag 啱唔啱 + working tree clean
- ✅ Restore script 必 `chmod +x` + push tag + branch 去 origin
- ✅ 對齊 §15.39 「還原備份還原點」pattern

**還原命令** (一鍵還原, 對齊 8月31日 01:48 永久 rule):
```bash
# 還原返 4.53.0 拎走橙旗後狀態 (推薦)
bash scripts/restore_after_zigzag_4.53.0.sh

# 或者手動 (無 double confirm)
git reset --hard 7a424c58c7180d9cc4617f1ec2f79484a4a9083d

# 還原返 4.53.0 之前 (拎返橙旗 + 鮮綠線 + P 點 sequence)
git reset --hard 5c89c659eda481918101fe8060480ccfdbc1a67a
```

**對應 commit**:
- `f4adfe05 chore(scripts): 加 ZigZag 4.53.0 拎走橙旗後還原點 Sscript (大少 8月31日 11:59 trigger 對齊 Sscript pattern) + Spec Sync`
- 對齊: `scripts/restore_sprint_4.sh` (大少 8月31日 07:52 第一個 Sscript)

**教訓** (大少 trigger「現在你這個怎麼不一樣了」):
- ✅ **大項目備份之前,先睇返之前嘅 Sscript pattern,唔好自己用簡化方式**
- ✅ 每次做備份先查 `ls scripts/restore_*.sh` 睇返之前 pattern
- ✅ 對齊 §15.45 永久 rule pattern,唔好 break pattern

對應 doc: M1-V22-RESEARCH.md 「🔴 大少 trigger #N+3 — ZigZag 4.53.0 Sscript 還原點 (大少 2026-08-31 11:59)」section (即將加)

對應 commit: 即將 push (Spec Sync §15.53 流程)

### Backup Admin Page 永久 rule (大少 2026-08-31 12:00 trigger)

**凡人話解釋**: 大少 8月31日 12:00 trigger「你去做一個新Page,係比我管理所有一鍵還原的備份,要有備份資料和備份的原因,如果我想還原我可以查看後簡單話你知就可以做到」— 統一管理所有備份點,睇到 metadata (commit hash, 日期, 原因) 同揀邊個做一鍵還原。

**改動範圍** (5 個 file):
- ✅ `backend/api/backup_admin.py` (新加 12KB) — `GET /api/backup-points/list` 拎所有備份 list, `POST /api/backup-points/restore` 揀 tag 跑對應 restore script
- ✅ `backend/main.py` (加 import + include_router)
- ✅ `backup-admin/index.html` (新加 3.7KB) — Page UI: header + 載入掣 + 備份 list container + double confirm modal + progress modal
- ✅ `backup-admin/backup-admin.js` (新加 8.7KB) — loadBackupList + renderBackupList + showRestoreConfirm + executeRestore + event listeners
- ✅ `backup-admin/backup-admin.css` (新加 7KB) — 備份 card layout + modal 樣式 + status banner + badge 配色

**API endpoint shape**:
- `GET /api/backup-points/list` 掃 `refs/tags/restore-*` + `refs/heads/backup-*` + `scripts/restore_*.sh`, dedup by commit hash, 拎 metadata
- `POST /api/backup-points/restore` 兩層 confirm: backend 驗 `confirm == "RESET"` + frontend modal 撳 yes 才發 request, auto input `"yes\nRESET\n"` 落 stdin

**Frontend UX** (大少 8月31日 12:03 揀 double confirm modal + 撳 yes):
- 撳「🔄 載入備份 list」→ fetch API → render card list
- 每個 card: 名字 (優先 tag) + 日期 + commit_short + badge (tag/branch/script/reason) + reason_long box
- 撳「⚠️ 還原到呢個備份」掣 → double confirm modal 顯示警告 + command preview
- 撳「確認還原 (RESET)」才發 request → progress modal 顯示 stdout / stderr
- Esc 取消 modal

**永久 rule** (對齊 §15.45 Sscript pattern):
- ✅ 對齊 §15.39 還原備份還原點 pattern
- ✅ 兩層 confirm 防止意外: frontend modal + backend 驗 "RESET"
- ✅ Backend 用 `_resolve_commit_from_ref` peel annotated tag, dedup by commit hash
- ✅ Backend `_scan_restore_scripts` 拎 EXPECTED_HEAD 配對 commit
- ✅ Frontend auto input `"yes\nRESET\n"` 落 stdin, 跟 Sscript double confirm 對齊
- ✅ Restore script timeout 60s
- ✅ UI 對齊 testing-page 風格 (跟 zigzag-testing/), simple HTML + JS + CSS
- ✅ 之後新增備份必 set Sscript pattern (tag + branch + script), Backup Admin Page 自動顯示

**Curl verify** (8月31日 12:08):
- ✅ `GET /api/backup-points/list` 拎到 2 個備份 (restore-after-zigzag-4.53.0 + restore-before-sprint-4-followup)
- ✅ 全部 missing: [] (有齊 tag + branch + script)
- ✅ reason_short + reason_long 都拎到 (annotated tag message)

對應 doc: ARCHITECTURE.md §15.54 (本段), M1-V22-RESEARCH.md 即將加

對應 commit: 即將 push (Spec Sync §15.54 流程)

對應 Sscript 永久 rule: §15.45 + §15.53


### M1 console log 加 ZigZag 最新 10 點 永久 rule (大少 2026-08-31 12:50 trigger, 4.54.0)

**凡人話解釋**: 大少撳跑 M1 之後, 想喺現有黑色「🔧 Chart Debug」console log (testing page 圖表下面) 自動列出 ZigZag 最新 10 個點嘅日子同點數 (P1 為最新, 倒序排 P1 → P10), 方便對齊睇 chart 上面嘅紫色 ZigZag 線, 唔使再 scroll 開 DevTools console 拎 `window.currentVerdict.meta.zigzagPoints` raw data。

**改動**:
- `testing-page/testing-page.js` `renderDebugPanel()` 加 `_formatZigZagLatestPointsForDebug()` helper
  - 喺現有「K線最後 close」行之下 insert 1 個 mini-table HTML
  - 4 欄 layout: 序號 (P1-P10) / 日子 (YYYY-MM-DD) / 點數 (2 位小數) / 類型 (📈 Peak / 📉 Trough)
  - 倒序排對齊 8月29日 14:32 永久 rule (P1 = zzp[-1] 最新)
  - Source 拎 `lastVerdict.meta.zigzagPoints` (已經由 backend inject 落去, 對齊 4.43.0 永久 rule「ZigZag 全部 backend 計」)
  - Edge case: empty / undefined → 顯示「(冇 points, 可能未跑算法 / threshold 太高)」, 唔 crash
  - Edge case: zigzagPoints.length < 10 → table 顯示實際有嘅 (1-9 行)
- `testing-page/testing-page.js` bump `ALGO_CACHE_BUST` 4.53.0 → 4.54.0
- `testing-page/index.html` bump `?v=2.3.114` → `2.3.115` (2 個地方: CSS line 10 + JS line 184)

**永久 rule**:
- ✅ Testing page M1 跑完之後, 喺黑色 🔧 Chart Debug panel 底部永遠 auto-render 1 段「📈 ZigZag 最新 10 點 (P1 為最新, 倒序排)」
- ✅ 永遠拎 `lastVerdict.meta.zigzagPoints` 而唔係 `window.currentVerdict.meta.zigzagPoints` (因為 renderDebugPanel 已經收 verdict 做 parameter)
- ✅ 倒序排 (P1 = 最新, zzp[-1]), 對齊 8月29日 14:32 永久 rule P1/P2/P3/P4 indexing
- ✅ Style 全部 inline (唔加 testing-page.css, 跟 popup 註解永久 rule 風格一致)
- ✅ 凡人話: 大少撳跑 M1 → 即時喺 console log 底部見到 P1-P10 日子 + 點數 → 唔使再 scroll 開 DevTools console
- ✅ 對齊 2026-08-09 13:10 永久 rule「改 .mjs 之後必同步 bump ALGO_CACHE_BUST + ?v=2.3.X」 (雖然今次冇改 .mjs, 但 .js 改動都跟同一個 pattern)
- ✅ 對齊 4.43.0 永久 rule「ZigZag 全部 backend 計」 (frontend 拎 backend 注入嘅 verdict.meta.zigzagPoints, 唔重計)
- ✅ 對齊 4.15.0 永久 rule「之字拎 point 用 high/low」 (type 'high' = peak, type 'low' = trough)

**Acceptance tests**:
- 撳跑 M1 (AS-03-MA) 任何股票 e.g. HK.00700 → 撳跑完之後, scroll 落 chart 下面, 見到黑色 🔧 Chart Debug panel
- Panel 底部 (K線最後 close 行之下) 見到新段「📈 ZigZag 最新 10 點 (P1 為最新, 倒序排):」
- Mini-table 顯示最多 10 行 (如果 zigzagPoints.length >= 10), 每行有 4 欄
- P1 = chart 上面紫色 ZigZag 線嘅最後 1 個點 (跟 8月29日 14:32 永久 rule)
- 撳跑 zmen / M9 等其他 module → 因為 `verdict.meta.zigzagPoints` undefined, mini-table 顯示「(冇 points, 可能未跑算法 / threshold 太高)」, 唔 crash

對應 doc: ARCHITECTURE.md §15.55, M1-V22-RESEARCH.md 「🟢 大少 trigger 8月31日 12:50」section

對應 commit: `3f8ec81b` (feat commit) + 即將 push (Spec Sync §15.55 流程)

對應永久 rule: 8月29日 14:32 P1/P2/P3/P4 indexing + 4.43.0 ZigZag 全部 backend 計 + 4.15.0 之字用 high/low + 2026-08-09 13:10 cache bust sync


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
- **Priority 3 弱趨勢** (排列對但部分唔配合): 弱上升 (weak_uptrend) / 弱下跌 (weak_downtrend)
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
- **9 個 sub-scenario** (強升 / 弱升 / 上升回調 / 橫行 / 下跌反彈 / 弱跌 / 強跌 / 到頂轉勢 / 到底轉勢), 跟 M1 對齊
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
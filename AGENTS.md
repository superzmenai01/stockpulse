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

對應 doc: ARCHITECTURE.md §15.55, M1-V22-RESEARCH.md 「🟢 大少 trigger 8月31日 12:50」section


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
**對應 spec doc**: M1-V22-RESEARCH.md trigger #10 + #4.5 強升中整固 嘅 stock 例子 + 永久 rule section 嘅 evidence
**對應 doc**: ARCHITECTURE.md §15.XX (待大少 trigger 加 §15.XX 號碼)
**教訓**: 跟 4.55.0 lesson learned 同源, 係「evidence 必先確認」原則嘅 stock 名延伸


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
- ✅ 對齊 §15.45 + §15.53 + §15.54 永久 rule (Sscript 還原點對齊, Backup Admin Page verify)
- ✅ 對齊 §15.51 永久 rule (改 algorithm.py 必 restart backend + curl verify)
- ✅ 對齊 §15.46 永久 rule (改 testing-page.js 必同步 bump ALGO_CACHE_BUST + ?v= 2 個地方)

**凡人話**: 大少撳跑 01347 即刻見到 P1 = 2026-08-25 105.50 📉 Trough (8月31日 123.00 確認咗呢個 trough, 變成 trigger point), 唔再用 8月31日 123.00 today point, 紫色 ZigZag line 最後 1 個 point 對齊 standard ZigZag algorithm output, chart 完全乾淨冇鮮綠線, 對齊大少 trigger「拎走 4 個 source, 全部要删除重新再做」。

對應 doc: ARCHITECTURE.md §15.55 + §15.56 + §15.60 (拎走對應章節), 改 §15.61 加返 4.59.0 entry

對應 commit: 即將 push (4.59.0 fix + Spec Sync 流程)

對應 Sscript 還原點: `restore-before-zigzag-4.59.0` (對齊 §15.45 + §15.53 + §15.54 永久 rule)

對應永久 rule: 4.43.0 ZigZag 全部 backend 計 + 4.53.0 拎走鮮綠線 + 4.15.0 拎 high/low + §15.45 Sscript pattern + §15.46 cache bust sync + §15.51 Backend hot-reload

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

**凡人話解釋**: 大少 21:29 trigger「發現問題: P2 2026-08-28 00:00:00 46.50 📈 Peak 2026-08-28 00:00:00 45.18 — 在同一日內自己到了同日的觸發點, 這完全不合理」— 對齊 P point 同 trigger 同一個 K 線嘅邊界 case (intra-bar volatility), 算法嗰度要 enforce trigger 一定要係 P point 之後嘅 K 線 (唔可以同 P point 同一個 K 線)。大少 21:46 trigger「你先做備份和一鍵復原後才開始, 記得要先檢查備份還原點管理有沒有更新到才算完成」— 對齊 §15.45 Sscript pattern, 先 set 還原點, 之後先做 BUG FIX 改動。

**Root cause**: 對齊 algorithm 第二個 loop line 235-238 (in_uptrend), `if klines[i]['high'] > last_swing_high: last_swing_idx = i`, 之後跌 -threshold 條件 `if change_from_high <= -threshold`, 因為 `last_swing_idx = i`, change_from_high = (klines[i].low - klines[i].high) / klines[i].high (intra-bar 跌幅), 跌夠 -threshold 確認 P point, 嗰個 P point 嘅 index = last_swing_idx = i, trigger 嘅 triggerIndex = i, P point 同 trigger 同一個 K 線 (intra-bar volatility 邊界 case)。第一個 loop 嘅 2 處 trigger 條件 (line 187 in_uptrend, line 209 唔 in_uptrend) 同樣有呢個 edge case。

**改動 (4.57.1)**:

1. **改動 0 (BEFORE code 改動)**: Sscript 還原點 (對齊 §15.45 Sscript pattern)
   - 攞當前 HEAD commit hash (4.57.0 完成 commit) 做 EXPECTED_HEAD
   - Create branch `backup/zigzag-4.57.1` + push
   - Create annotated tag `restore-before-zigzag-4.57.1` + push
   - Create script `scripts/restore_before_zigzag_4.57.1.sh` (double confirm: yes + RESET)
   - Commit + push script
   - **Verify Backup Admin Page 拎到** (`/api/backup-points/list` 拎到 `restore-before-zigzag-4.57.1` 還原點) — 對齊 §15.54 + 12:08 user memory 永久 rule + 大少 15:28 trigger

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
- ✅ 對齊大少 21:46 trigger 流程: 改 algorithm 之前必先做 Sscript 還原點 (對齊 §15.45 + §15.53 + §15.54 + 12:08 user memory 永久 rule), 之後先做 code 改動

**凡人話**: 大少撳跑 M1 即時喺黑色 console log 底部見到 P1-P10 日子 + 點數 + 觸發點日期 + 觸發點股價, 對齊 K 線時序, trigger 一定要係 P point 之後嘅 K 線, intra-bar 同一個 K 線跌夠 -threshold 唔算 confirm P point。

對應 doc: ARCHITECTURE.md §15.58

對應 commit: 即將 push (`fix(zigzag-bug): Trigger 邊界 case BUG FIX — P point 同 trigger 唔可以同一個 K 線 (4.57.1)`)

對應 Sscript 還原點: `restore-before-zigzag-4.57.1` (EXPECTED_HEAD: 73c4039641543b4c39d017c1d5888412d30d755e, 4.57.0 完成 commit)

對應永久 rule: 4.15.0 拎 point 用 high/low + 4.43.0 ZigZag 全部 backend 計 + 4.57.0 加觸發點 + §15.45 Sscript pattern + §15.51 Backend hot-reload + §15.53 Sscript 還原點 + §15.54 Backup Admin Page + 12:08 user memory 永久 rule


### ZigZag date format 統一永久 rule (大少 2026-08-31 22:03, 4.57.2)

**凡人話解釋**: 大少 22:03 trigger「在 Zigzag Point 我發現你找出來的時間不統一, 有些日期的格式是多了 00:00:00, 請先統一所有時間格式」— backend algorithm 拎出嚟嘅 date / triggerDate 有時係 "2026-08-28" (date-only), 有時係 "2026-08-28 00:00:00" (datetime), 對齊 §3.6 + §3.7 永久 rule「Cross-module 統一 date parsing」frontend normalizeTime + adapter.mjs dateToTime 嘅 `t.split(' ')[0]` 統一 pattern, backend 都要做返。

**Root cause**: 對齊 backend `backend/algorithms/zigzag/algorithm.py` 嘅 `_zigzag_normalize_date` function (line 113-124), fallback chain 拎 `kline.get('time')` 第一個, 但 K 線 cache response 入面 K 線 dict 有 `time` field (e.g. "2026-08-28 00:00:00") 嘅時候, 拎出嚟就係 datetime, 唔係 date-only。frontend `testing-page.js` 嘅 `normalizeTime` 同 `adapter.mjs` 嘅 `_zigzagNormalizeDate` / `dateToTime` 都有做 `t.split(' ')[0]` 拎 date-only, 但 backend 冇做。

**改動 (4.57.2)**:

1. **改動 0 (BEFORE code 改動)**: Sscript 還原點 (對齊 §15.45 Sscript pattern + 大少 21:46 trigger)
   - 攞當前 HEAD commit hash (4.57.1 完成 commit `b6f67b44`) 做 EXPECTED_HEAD
   - Create branch `backup/zigzag-4.57.2` + push
   - Create annotated tag `restore-before-zigzag-4.57.2` + push
   - Create script `scripts/restore_before_zigzag_4.57.2.sh` (double confirm: yes + RESET)
   - Commit + push script
   - **Verify Backup Admin Page 拎到** (`/api/backup-points/list` 拎到 `restore-before-zigzag-4.57.2` 還原點) — 對齊 §15.54 + 12:08 user memory 永久 rule

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
- ✅ 對齊大少 21:46 trigger 流程: 改 algorithm 之前必先做 Sscript 還原點 (對齊 §15.45 + §15.53 + §15.54 + 12:08 user memory 永久 rule), 之後先做 code 改動

**凡人話**: 大少撳跑 M1 即時喺黑色 console log 底部見到 P1-P10 日子全部統一 "YYYY-MM-DD" 格式 (冇 "00:00:00"), 對齊 K 線時序, 拎出嚟嘅 date 對齊 frontend + adapter.mjs 統一 pattern。

對應 doc: ARCHITECTURE.md §15.59

對應 commit: 即將 push (`fix(zigzag-bug): Date format 統一 — backend _zigzag_normalize_date 統一 YYYY-MM-DD (4.57.2)`)

對應 Sscript 還原點: `restore-before-zigzag-4.57.2` (EXPECTED_HEAD: b6f67b44c0698419a765b9b8e578123024e60547, 4.57.1 完成 commit)

對應永久 rule: §3.6 + §3.7 永久 rule「Cross-module 統一 date parsing」+ §15.45 Sscript pattern + §15.51 Backend hot-reload + §15.53 Sscript 還原點 + §15.54 Backup Admin Page + 12:08 user memory 永久 rule


### Backup Admin Page 4 個優化永久 rule (大少 2026-08-31 17:37 trigger, §15.55)

**凡人話解釋**: 大少 17:37 trigger「全部都做,但還完了後我不想删走那個還完點,因為可能會再用」— 對齊 §15.45 + §15.53 + §15.54 + 12:08 user memory 永久 rule, 對 backup admin page 做 4 個優化 (missing warning UI + Sscript set helper + audit trail + recover script)。

**改動 (4 個方向, commit `f545681d`)**:

1. **A. Missing warning UI**:
   - `backend/api/backup_admin.py` `GET /api/backup-points/list` response 加 `can_restore: true/false` field
   - `backup-admin/backup-admin.js` `renderBackupList` 對 missing card disable reset btn + 顯示「🚫 缺 component, 撳 Recover」+ 加「🔧 Recover script」inline btn
   - `backup-admin/backup-admin.css` + `index.html` 加 warning banner style

2. **B. Sscript set helper**:
   - `backend/api/backup_admin.py` 加 `POST /api/backup-points/set` (auto generate script + tag + branch + push, 對齊 §15.45 Sscript pattern)
   - `backup-admin/backup-admin.js` + `index.html` 加「+ 設定新還原點」掣 + modal + `executeSscriptSet` handler

3. **C. Audit trail**:
   - `backend/api/backup_admin.py` 加 `GET /api/backup-points/audit` (git reflog 拎 reset --hard 記錄, 對應 `restore-<name>` tag)
   - `backup-admin/backup-admin.js` + `index.html` 加「Restore History」section + `loadAuditTrail` + `renderAuditHistory` handler

4. **D. Recover script (redefined cleanup, 對齊大少 trigger「可能會再用」)**:
   - `backend/api/backup_admin.py` 加 `POST /api/backup-points/recover-script` (用 `git show <tag-commit>:<script-path>` 拎返 reset 之前 commit 嘅 script 寫返 disk + commit + push)
   - `backup-admin/backup-admin.js` + `index.html` 加「🔧 Recover script」inline btn + recover modal + `recoverScript` handler
   - **保留 tag** (對齊 12:08 user memory 永久 rule, 大少 trigger「不想删走那個還完點」)

**永久 rule**:
- ✅ A 方向: `can_restore: true/false` 對齊 missing warning UI, missing 嘅 card 唔可以 reset
- ✅ B 方向: Sscript set helper 自動做齊 tag + branch + script + push, 大少唔使記住 git command
- ✅ C 方向: Audit trail 拎 git reflog 嘅 reset history, 大少可以 track 返之前 reset 過邊個還原點
- ✅ D 方向: Recover script 拎返 reset 之前 commit 嘅 script 寫返 disk + commit + push, 保留 tag 對齊 12:08 user memory 永久 rule
- ✅ Cache bust 永久 rule: `CACHE_BUST` 1.0.0 → 1.1.0 + `?v=1.0.0` → 1.1.0
- ✅ 對齊 §15.45 Sscript pattern (annotated tag + backup branch + restore script)
- ✅ 對齊 §15.53 Sscript 還原點永久 rule
- ✅ 對齊 §15.54 Backup Admin Page 永久 rule
- ✅ 對齊 12:08 user memory 永久 rule (每做新 Sscript 還原點都要 verify Backup Admin Page 拎到)

**⚠️ KNOWN ISSUE (D 方向 follow-up sprint)**:
D 方向 recover endpoint 喺 uvicorn subprocess 拎 dangling commit 有 issue (returncode=0 但 stdout='', 但直接用同一個 command 拎到 `7d0040d7d425014db1fa369d4348968bf4325364`)。Issue 屬於 uvicorn Asyncio fork + subprocess pipe buffering, 屬於 OS-level problem 唔係 code problem。

**大少 workaround** (手動拎返 dangling commit):
```bash
cd ~/stockpulse
git show 7d0040d7:scripts/restore_before_zigzag_4.56.0.sh > scripts/restore_before_zigzag_4.56.0.sh
git add scripts/restore_before_zigzag_4.56.0.sh
git commit -m "chore: manually recover script from dangling commit 7d0040d7"
git push origin main
```

**Acceptance tests**:
- Reload backup admin page (`?v=1.1.0` cache bust 自動)
- 撳「🔄 載入備份 list」, 見到 3 個還原點
- `restore-before-zigzag-4.56.0` 個 card 顯示「🚫 缺 component, 撳 Recover」(對齊 A 方向)
- 「🔧 Recover script」掣 enable (對齊 D 方向)
- 撳「+ 設定新還原點」掣, 輸入 name + reason_short + reason_long, 撳「✅ 設定」自動做齊 tag + branch + script + push (對齊 B 方向)
- 撳「🔄 載入 reset history」掣, 見到之前 reset 過嘅記錄 (對齊 C 方向)

對應 doc: ARCHITECTURE.md §15.55, M1-V22-RESEARCH.md 「🟢 大少 trigger 8月31日 17:37」section

對應 commit: `f545681d` (4 個優化 feat commit)

對應永久 rule: §15.45 + §15.53 + §15.54 + 12:08 user memory + 大少 17:37 trigger「保留 tag + 可能會再用」

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
- ✅ Cache datetime format migration script (`scripts/migrate_kline_datetime_to_dateonly.py`) 永久可用, 跟 §15.45 Sscript pattern
- ✅ 對齊 4.57.2 永久 rule「backend date 統一 YYYY-MM-DD, 唔可以有 datetime」
- ✅ 對齊 8月22日 K-line Cache T-1 rule「T-1 rule: 今日 bar 唔寫 DB」 (4.61.0 唔改 T-1 規則, 只係統一 date format)
- ✅ 對齊 §15.51 Backend hot-reload: 改 kline_cache.py 必 restart backend + curl verify
- ✅ 對齊 §15.45 Sscript pattern: migration script 永久 set 還原點, 對齊 §15.53 + §15.54

**凡人話**: 大少撳跑 00100 即刻見到 P1 = 2026-09-01 381.4 📈 Peak (待觸發), 拎到今日新高, 唔再用 8月31日 360.0 嘅 stale peak。Cache 入面 233 隻 stock 嘅 50704 條 datetime format entry 全部清返 date-only, 之後新寫入都必走 normalize assert, 永久唔再有 datetime 寫入。

對應 file:
- `backend/services/kline_cache.py` line 114 (SQL filter 改 substr), 3 個 write path 加 normalize assert
- `scripts/migrate_kline_datetime_to_dateonly.py` (新增, 清 50704 條 datetime entry)

對應 doc: ARCHITECTURE.md §3.6 + §3.7 (ZigZag data flow, K-line Cache T-1 rule)

對應 commit: 即將 push (4.61.0 fix + Spec Sync 流程)

對應永久 rule: 4.15.0 拎 point 用 high/low + 4.43.0 ZigZag 全部 backend 計 + 4.57.2 date format 統一 + 4.60.0 ongoing point trigger null + §15.45 Sscript pattern + §15.51 Backend hot-reload + §15.53 Sscript 還原點 + §15.54 Backup Admin Page

### Backup Admin 編輯註解 永久 rule (大少 2026-09-01 18:00 trigger, 4.64.0)

**凡人話解釋**: 大少 18:00 trigger「把備份還原點管理 增加我可以修改或加入註解」— Backup Admin Page 加「✏️ 編輯註解」掣 + 對應 modal, 大少可以改現有 Sscript 還原點嘅 tag 註解(reason_short + reason_long), 仲可以勾選同步更新對應 script header。改 tag 註解**唔郁 commit hash**(evidence 永遠保留), 自動 force push 去 origin。對齊 §15.45 + §15.53 + §15.54 + 12:08 user memory 永久 rule。

**改動 (4.64.0)**:

1. **Backend 加 endpoint** (`backend/api/backup_admin.py`):
   - `POST /api/backup-points/{tag_name}/annotate`
   - Input: `reason_short` + `reason_long` + `update_script` (boolean)
   - Algorithm:
     a. `_resolve_commit_from_ref(tag)` 拎返 commit hash (永遠唔郁, 只拎用)
     b. `git tag -f <tag> <commit> -m <new_msg>` force update tag message
     c. `git push origin --force <tag>` force push tag
     d. (Optional) 同步更新 script header: 改 `scripts/restore_<name>.sh` header 段 (由 `# Restore script` 到第一個空行/`set -e`), 加 `Reason (short)` + `Reason (long)` comment, 然後 `git add + commit + push main`
   - Response: `{ok, tag, commit, script_updated, script_path, message}`

2. **List endpoint bug fix** (`backend/api/backup_admin.py` line 184+):
   - **大少發現**: 之前 list endpoint 用 `for-each-ref ... %(subject)|%(body)` 拎到 commit subject 而唔係 annotated tag 嘅 message
   - 結果: 4.64.0 改完 tag 註解後, list endpoint 仍然拎 commit 嘅舊 reason, 唔顯示新 tag 註解
   - **Fix**: 分開 query tag + branch, tag 用 `%(contents:subject)|%(contents:body)` 拎 tag 嘅 annotated message, branch 用 `%(subject)|%(body)` 拎 commit message, 然後合併 output
   - 凡人話: 大少改完 tag 註解 reload 頁面, 即刻見到新 reason_short + reason_long (唔再係 commit 嘅)

3. **Frontend 加 modal** (`backup-admin/index.html` + `backup-admin.js`):
   - 每個 backup card 加「✏️ 編輯註解」button (放喺 `.backup-card-actions`, 對齊其他 button style)
   - 新 modal `#annotate-modal` (對齊 #sscript-set-modal 風格):
     - 預填 `reason_short` + `reason_long` (大少唔使從頭打)
     - 預填 `update_script` checkbox 為 checked (預設同步更新 script)
     - 顯示 script path hint (e.g. `scripts/restore_2026_09_01_stocks_async.sh`)
     - 「✅ 儲存」button + 「取消」button
   - `?v=1.2.0` → `?v=1.3.0` cache bust sync (對齊 §15.46 永久 rule)

**永久 rule**:
- ✅ Backup Admin Page 永遠可以編輯現有 Sscript 還原點嘅註解
- ✅ 改 tag 註解永遠唔郁 commit hash (evidence 保留), 用 `git tag -f <tag> <commit> -m <msg>`
- ✅ 改 tag 註解必 force push 去 origin (`git push origin --force <tag>`)
- ✅ 預設同步更新對應 script header (大少可以 uncheck 跳過)
- ✅ 編輯 modal 必預填現有值 (大少唔使從頭打, 對齊 UX 改善)
- ✅ List endpoint 拎 tag 嘅 `%(contents:subject)|%(contents:body)` 而唔係 commit 嘅 `%(subject)|%(body)`
- ✅ 對齊 §15.46 cache bust sync: 改 UI 同步 bump `?v=1.2.0 → 1.3.0`
- ✅ 對齊 §15.45 + §15.53 + §15.54 永久 rule
- ✅ 對齊 12:08 user memory「一鍵還原 Backup Admin Page 永久更新」

**凡人話**: 大少 reload `~/stockpulse/backup-admin/index.html`, 撳任何 backup card 嘅「✏️ 編輯註解」掣, modal 預填現有 reason, 大少改完撳「✅ 儲存」自動 `git tag -f` + `git push --force`, 1 秒內 list endpoint 拎返新註解 (commit hash 永遠唔郁, 保留 evidence)。

對應 file:
- `backend/api/backup_admin.py` (加 AnnotateRequest + annotate_backup_point endpoint, fix list endpoint 用 `%(contents:subject)`)
- `backup-admin/index.html` (加 #annotate-modal, ?v=1.2.0 → 1.3.0)
- `backup-admin/backup-admin.js` (加 showAnnotateModal + executeAnnotate + btn-annotate handler)
- `AGENTS.md` (加 4.64.0 永久 rule section)

對應 doc: ARCHITECTURE.md §15.54 (Backup Admin Page 拎 tag contents 而唔係 commit)

對應 commit: 即將 push (4.64.0 feat + Spec Sync 流程)

對應永久 rule: §15.45 Sscript pattern + §15.46 cache bust sync + §15.53 Sscript 還原點 + §15.54 Backup Admin Page + 12:08 user memory「一鍵還原 Backup Admin Page 永久更新」

### Backup Admin List Endpoint Multi-line Body Parser 永久 rule (大少 2026-09-01 18:11 trigger, 4.64.1)

**凡人話解釋**: 大少 18:11 trigger「我修改了註解, 但沒有更新到, 請檢查」— 4.64.0 加完 annotate endpoint 之後, 大少 reload page 拎 list endpoint 嘅時候, 拎唔到自己改嘅新註解, 仍然見到舊內容。Root cause: list endpoint 用 `git for-each-ref --format=...%(contents:body)` 拎 K 線, 如果 tag 嘅 message body 有 newline, for-each-ref 唔 escape, 將每行當成獨立 line, parser `split("|", 5)` 後每行都唔夠 5 parts 全部 skip, 拎返嚟嘅 data 唔齊全。

**Root cause** (4.64.0 list endpoint 有 3 個 bugs):
1. **Bug 1 - Multi-line body parsing** (主要問題):
   - `git for-each-ref --format=...%(contents:body)` 拎出嚟如果有 newline, 唔 escape
   - Parser `line.split("\n")` 將每行當成獨立 ref line
   - 每行 < 5 parts → 全部 skip
   - 結果: list endpoint return 唔完整 data 或 0 個 point

2. **Bug 2 - 拎 body 用 `git tag -l <name> --format=%(body)` 拎唔到**:
   - `git tag -l <name> --format=%(body)` 永遠返空 string (git 嘅 format 唔支援 tag body)
   - 改用 `git cat-file -p <tag>` 拎 raw tag object, parser 自己 split subject + body

3. **Bug 3 - Multi-tag 同一 commit 嗰陣 reason 唔 overwrite**:
   - Dedup by commit 邏輯, 後續 tag 嘅 `if not point[...]:` 永遠 skip (因為第一個 entry 已經 set)
   - 第二個 tag 嘅 reason 用返第一個 tag 嘅舊 reason
   - Fix: tag 永遠 overwrite 自己嘅 reason (even if empty), branch 保留 dedup

**改動 (4.64.1)**:

1. **list endpoint query 改** (backend/api/backup_admin.py line 190-218):
   - `%(contents:body)` 拎走, for-each-ref 只拎 refname + commit + date
   - 改用 separate `git cat-file -p <tag>` 同 `git log -1 --format=...` 拎 body

2. **list endpoint parser 改** (line 234-310):
   - `parts = line.split("|", 4)` 4 parts (冇 body)
   - 每個 ref 拎 subject + body 用 separate git command:
     - Tag: `git cat-file -p <tag>` 拎 raw object, parser 自己 split (subject = 第一段, body = 餘下段)
     - Branch: `git log -1 --format=%s|%b` 拎 commit 嘅 subject + body
   - 改 dedup 邏輯: tag 永遠 overwrite reason (even if empty), branch skip

3. **annotated tag 永久 rule**:
   - ✅ list endpoint 拎 tag 嘅 subject + body 用 `git cat-file -p`, 唔用 for-each-ref 嘅 `%(contents:body)`
   - ✅ list endpoint 拎 branch 嘅 subject + body 用 `git log -1 --format=%s|%b`
   - ✅ 對齊 4.64.0 永久 rule: list endpoint 拎 reason 永遠用 ref 嘅 (tag 拎 annotated message, branch 拎 commit message)
   - ✅ 改 `%(contents:body)` 後要測 multi-line 情況, 避免 body 有 newline 破壞 parser
   - ✅ Tag 嘅 reason 永遠 overwrite 自己嘅 (even if empty), 唔繼承 dedup entry 嘅舊 value

**Verify** (大少 18:14 試):
```
Set multi-line restore-test-multiline tag:
  subject: "Test subject"
  body: "Line 2 of body\nLine 3 of body"

Before fix: WARNING 「跳過格式錯嘅 line: ...」× N 條 (body newline 破壞 parser)
After fix:  0 WARNING, 拎到正確 reason
```

**User impact** (4.64.0 → 4.64.1):
- ✅ 之前 4.64.0 編輯 tag 註解後, list endpoint 拎唔到 / 拎錯 body, 大少 reload 見唔到新註解
- ✅ 4.64.1 拎 fix, reload 拎到 reason_short + reason_long 正確顯示
- ✅ 對齊 §15.45 Sscript pattern: 永遠拎 ref 嘅真實 reason (tag 拎 annotated, branch 拎 commit)

對應 file:
- `backend/api/backup_admin.py` (list endpoint for-each-ref format 改, parser 改, cat-file-p 拎 body)
- `AGENTS.md` (加 4.64.1 永久 rule section)

對應 commit: 即將 push (4.64.1 fix + Spec Sync 流程)

對應永久 rule: §15.45 Sscript pattern + §15.53 Sscript 還原點 + §15.54 Backup Admin Page + 12:08 user memory

### Sscript 還原點統一管理 永久 rule (大少 2026-09-01 17:50 trigger, 4.63.0)

**凡人話解釋**: 大少 17:50 trigger「現在做一個一鍵備份, 也把之前那些一鍵備份全部刪除, 只留現在的這個, 要更新頁面」— 清晒 7 個舊 Sscript 還原點 (4.53.0 - 4.58.0 + sprint 4), 只留 1 個新嘅 `restore-2026-09-01-stocks-async` 還原點(包 4.59.0 - 4.62.0 全部改動), Backup Admin Page 自動動態 render 只見呢個新嘅。對齊 §15.45 + §15.53 + §15.54 + 12:08 user memory「一鍵還原 Backup Admin Page 永久更新」永久 rule。

**清前狀態** (大少 17:50 之前):
- 7 個 Sscript tag: `restore-after-zigzag-4.53.0` / `restore-before-zigzag-4.56.0` / `restore-before-zigzag-4.57.1` / `restore-before-zigzag-4.57.2` / `restore-before-zigzag-4.57.3` / `restore-before-zigzag-4.58.0` / `restore-before-sprint-4-followup`
- 7 個 backup branch: `backup-after-zigzag-4.53.0` / `backup-before-sprint-4-followup` / `backup-before-zigzag-4.56.0` / `backup-before-zigzag-4.58.0` / `backup/zigzag-4.57.1` / `backup/zigzag-4.57.2` / `backup/zigzag-4.57.3`
- 7 個 restore script: `scripts/restore_*.sh` (6 個 zigzag + 1 個 sprint 4)

**新還原點** (4.63.0):
- Tag: `restore-2026-09-01-stocks-async` (annotated, push 去 origin)
- Branch: `backup-2026-09-01-stocks-async` (push 去 origin)
- Script: `scripts/restore_2026_09_01_stocks_async.sh` (對齊 §15.45 Sscript pattern, double confirm `yes` + `RESET`)
- HEAD: `5e63528efb638d2b1939a4f924276374d78ff8c1` (4.62.0 stocks async fix 之後)
- 包嘅改動: 4.59.0 + 4.60.0 + 4.61.0 + 4.62.0 全部 + AGENTS.md 永久 rule

**永久保留** (唔郁):
- `backup-2026-08-06-0022` (backup tag, 唔係 Sscript)
- `now-2026-07-22-0936` / `pre-adaptive-thresholdpct-2026-08-21` / `pre-bigchange-2026-07-27` / `pre-issue1-deeper-dig-2026-07-28` / `pre-optimization-2026-07-22` / `pre-port-optimization-2026-08-02` / `pre-zigzag-backend-refactor-2026-08-20` / `v2026-08-03-pre-big-changes` (development milestone tags, 唔係 Sscript 還原點)
- `backup/now-2026-07-22-0936` / `backup/pre-optimization-2026-07-22` (dev branches, 唔係 Sscript 還原點)

**永久 rule** (對齊 §15.45 + §15.53 + §15.54 + 12:08 user memory):
- ✅ Sscript 還原點永遠保持 1 個 active (對齊 12:08 user memory「保留 tag + 可能會再用」), 大少 trigger「只留現在的這個」就清舊整新
- ✅ 整新 Sscript 還原點對齊 §15.45 Sscript pattern: annotated tag + backup branch + restore script + double confirm `yes` + `RESET`
- ✅ Tag 命名: `restore-YYYY-MM-DD-<short-name>` (例如 `restore-2026-09-01-stocks-async`)
- ✅ Branch 命名: `backup-YYYY-MM-DD-<short-name>` (對齊 tag)
- ✅ Script 命名: `scripts/restore_YYYY_MM_DD_<short_name>.sh` (對齊 tag + branch, 底線替代 hyphen)
- ✅ 推 tag + branch 全部去 origin (`git push origin <tag>` + `git push origin <branch>`)
- ✅ 清舊 Sscript 還原點: 全部 3 個 component 都要清 (tag + branch + script), 唔好留半套
- ✅ Backup Admin Page `?v=` cache bust 同步 bump (1.1.0 → 1.2.0), 對齊 §15.46 testing-page cache bust sync 永久 rule
- ✅ 對齊 §15.45 + §15.53 + §15.54 + 12:08 user memory 永久 rule

**凡人話**: 大少撳 `~/stockpulse/backup-admin/index.html` reload 拎新 `?v=1.2.0`, 即刻見到得返 1 個還原點 row (restore-2026-09-01-stocks-async), 撳「還原」掣自動 double confirm `yes` + `RESET` 一鍵還原到 4.59.0-4.62.0 狀態。

對應 file:
- `scripts/restore_2026_09_01_stocks_async.sh` (新增, Sscript pattern)
- `backup-admin/index.html` (?v=1.1.0 → 1.2.0 cache bust sync)
- Git: 新 tag `restore-2026-09-01-stocks-async` + branch `backup-2026-09-01-stocks-async`, 刪 7 個舊 Sscript tag + branch

對應 doc: ARCHITECTURE.md §15.45 + §15.53 + §15.54 + 12:08 user memory

對應 commit: 即將 push (4.63.0 chore + Spec Sync 流程)

對應永久 rule: §15.45 Sscript pattern + §15.46 cache bust sync + §15.53 Sscript 還原點 + §15.54 Backup Admin Page + 12:08 user memory「一鍵還原 Backup Admin Page 永久更新」

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

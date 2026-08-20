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

**對應 commit**: (即將 push, Spec Sync #31)
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

**對應 commit**: (即將 push, Spec Sync #32)
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

**對應 commit**: (即將 push, Spec Sync #33)
**對應 doc**: ARCHITECTURE.md §15.25

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
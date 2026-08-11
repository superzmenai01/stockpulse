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
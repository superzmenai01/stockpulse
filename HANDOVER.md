# 📦 StockPulse 開發 Handover

> MiniMax Code 接手 OpenClaw 嘅 StockPulse 開發。  
> 呢個 file 係 **single source of truth** — 讀完再開始工作。  
> Spec drift 就 update 呢個 file + commit。

---

## 0. 大少嘅工作模式 (Quick Summary)

- **大少唔識財務** — 唔好假設 jargon,用 plain language 解釋
- **永遠先搵問題** — 收到 idea 先諗 3-5 個風險/漏洞,再寫 code
- **唔好自己加嘢** — 嚴格跟指示 scope,scope 以外唔做
- **「全部都顯示」係 default** — 透明度優先,唔好 silently pick 一個
- **Auto-test + evidence-based report** — 改完要 verify,text-based 為主
- **Spec sync 自動** — 唔好淨係 commit code,spec docs 一齊 update
- **回覆風格** — 簡潔直接,普通話為主,emoji 都得

---

## 1. Project 基本資料

| 項目 | 內容 |
|------|------|
| **名** | StockPulse (已改名 ZMEN-StockPulse) |
| **路徑** | `~/stockpulse/` |
| **Git** | github.com/superzmenai01/stockpulse |
| **Branch** | main |
| **Latest commit** | 0900dd7c (2026-08-20) — M1 之字 metric 對齊 high/low fix |
| **性質** | 港股即時報價 + K線 + AI algorithm 篩選 web app |
| **用途** | 大少個人投資工具 |

---

## 2. 必讀 Spec Docs (5 份,順序讀)

| 順序 | File | 角色 |
|------|------|------|
| 1 | `~/stockpulse/README.md` | Quick start + 功能列表 |
| 2 | `~/stockpulse/PROJECT_SPEC.md` | 完整設計規格 |
| 3 | `~/stockpulse/ARCHITECTURE.md` | 系統架構 + data flow |
| 4 | `~/stockpulse/API.md` | Backend endpoint inventory |
| 5 | `~/.openclaw/workspace-main/memory/Projects/StockPulse/ALGORITHM_SPECS.md` | Algorithm 規格 (AS-XX) |

**OpenClaw-only** (MiniMax Code 讀唔到): `~/.openclaw/workspace-main/STOCKPULSE_REFERENCE.md`  
— Lessons learned / Permanent rules / Mini-troubleshooting (MiniMax Code 要呢啲 context 嘅話,大少要 share 出嚟)

---

## 3. Tech Stack

| Layer | Tech | Address |
|-------|------|---------|
| Frontend | React 18 + Vite + TypeScript + CSS Grid | localhost:3000 |
| Backend | FastAPI + SQLite | main port 8000, trigger port 18792 |
| Data source | Futu OpenD v10.9.6908 | localhost:11111 |
| LLM | MiniMax-M3 (透過 `backend/llm/` abstraction) | API |
| Chart | Lightweight Charts v4-v5 | CDN |
| Testing | Generic framework + adapter.mjs | localhost:8765 |

---

## 4. Directory Layout (重要!)

```
~/stockpulse/
├── web/                          # Vite frontend
│   └── src/components/chart/    # K線組件 (ChartContainer.tsx)
├── backend/
│   ├── api/                      # 16 endpoints
│   ├── services/                 # kline_cache, as02_analyzer, html_sanitizer...
│   ├── models/                   # DB models
│   ├── llm/                      # LLM abstraction (MiniMax/Kimi/Gemini)
│   ├── futu_conn/                # Futu OpenD connection
│   └── stockpulse.db             # SQLite DB (3MB)
├── algorithms/
│   └── AS-03-cycle-detection/    # AS-03 modules + adapter.mjs
├── testing-page/                 # Generic algorithm testing framework (port 8765)
├── docs/                         # 13 research files
├── miniapp/                      # Telegram bot
└── 4 spec docs + HANDOVER.md (this file)
```

---

## 5. Algorithms Status

| ID | Name | Status | Reason Display |
|----|------|--------|----------------|
| **AS-01** | 板塊龍頭股 | ✅ Production | Inline plain text (ResultGrid) |
| **AS-02** | 公司質素分析 | ✅ Production | stock_reasons table + PopUp (DOMPurify) |
| **AS-03** | 股票周期判定 | 🚧 v0.3.0 dev → 完整 7 stages roadmap | 詳見 `docs/research/AS-03-cycle-detection/ROADMAP.md` |
| AS-04+ | TBD | 💡 Future | - |

**AS-03 完整 Roadmap（2026-08-07 規劃，6-8 週去到 Phase 2 complete）**

| Stage | 做咩 | Status |
|-------|------|--------|
| 0. Foundation | 統一 7 module 嘅 interface / config / testing contract | ⏳ |
| 1. 完成 Module 3-7 | Multi-TF 🥇, Trendline ✅ (v0.1.0), Indicators 🥉, Volume OBV, Synthesizer | 🚧 進行中 |
| 2. 啟動數據收集 | DB 加 forward return field, schedule job | ⏳ |
| 3. Confluence (Module 8) | 7 modules 加權 0-100 分 | ⏳ |
| 4. Entry Timing + Backtest Timeline | Module 9 + 11 | ⏳ |
| 5. Trade Journal UI | Module J | ⏳ |
| 6. Probability + Risk-Reward | Module 10 + 12（要 trade data）| ⏳ |
| 7. Bayesian Tuning + 個股化 | 30+ 樣本後 tune | ⏳ |

**AS-03 current state (Stage 1 收官, Stage 2 進行中)**:
- Module 1 (均線系統週期判斷法) ✅ v2.1.0 — 9 個 sub-scenario (到頂/到底轉勢 / 強升 / 弱升 / 上升回調 / 橫行 / 下跌反彈 / 弱跌 / 強跌) + 5 個判定優先級 + 凡人話 popup 註解
- Module 2 (HL Structure) ✅ v0.1.0 — peaks/troughs + 形態 (頭肩頂/雙底)
- Module 3 (Trendline) ✅ v0.1.0 — 10 條 rule (A-J), 動態 OLS + 觸線 + 真假突破
- Module 4 (動能背馳與衰竭檢測法) ✅ v1.0.0 — 動能 + 背馳 + 衰竭
- Module 5 (成交量價格行為確認法) ✅ v2.0 — 放量 / 縮量 / 背馳確認
- Module 6 (波動率與市場結構) ✅ v1.0.0 — 收縮 / 擴張 / 結構判定
- Module 7 (Synthesizer) ✅ Level 1-6 — 全用上 M1 嘅 14 個 field (動態 base_weight + 3 條 expert rules + 2 條 alignment enrich + 凡人話 reasoning)
- M8 (Decision Engine) ✅ Chain v1.1 — M7→M9→M8 chain, M8 verdict embed M9 summary sub-section, conditional (cache OK skip M9, 2-4 秒搞掂)
- M9 (Back Test) ✅ v0.3.0 + popup 註解全面化 — 25 個 keyword 凡人話 + 7 日 cache expiry
- zmen 均算法 v1.0 ✅ — 雙層 architecture (Layer 1 保留 v0.3.0 10 條 rule + Layer 2 加 M1 9 個 sub-scenario enrich)
- ZigZag 拎 point ✅ — 5% threshold 過濾 noise + 之字斜率 framework (Stage 1) + 之字 metric 對齊 high/low
- 完整 workflow + status table: **`docs/research/AS-03-cycle-detection/ROADMAP.md`**
- 各 module 詳細 spec: `docs/research/AS-03-cycle-detection/MODULE-*.md`

**AS-03 永久 rules 累積 (8-7 至 8-20 大少拍板)**:
- 2 banner 分類 warning (🔧 system / 📊 stock_state) — Spec Sync #18
- dataWindowDays 默認 1260 (5 年) — 對齊 M9
- 之字 = ZigZag 簡稱
- Config UX 模式: 自動計算 + 可手動調 + 自動儲存 + 自動更新圖表
- 改 sub-scenario trigger 必須附 ≥ 3 個真實 stock 例子, 大少 verify 先改 code (2026-08-16 19:21 永久 rule)

---

## 6. Permanent Rules (必遵守!)

### A. Spec Sync Protocol (大少 #10203)

**Trigger keywords** (case insensitive): `更新Stockpluse` / `Update Stockpluse` / `Update StockPulse`

→ 自動執行 4 steps:
1. Update `~/stockpulse/ARCHITECTURE.md` (append new feature section)
2. Update OpenClaw `STOCKPULSE_REFERENCE.md` (OpenClaw 自己更新,MiniMax Code 唔做呢個)
3. Daily Log entry (OpenClaw 自己寫)
4. Commit + push `~/stockpulse` (MiniMax Code 做呢個)

其他情況: 完成 StockPulse 功能後,主動 outbound 「建議 update 以下 spec docs: [list]」,等大少 confirm。

### B. Spec Update Mapping (#9664)

| 改咩 | 要 update 邊個 doc |
|------|----------------|
| 新 `backend/api/*.py` endpoint | API.md |
| 新 frontend page/route | README + PROJECT_SPEC + ARCHITECTURE |
| 新 database table/model | PROJECT_SPEC |
| 新 algorithm (AS-XX) | ALGORITHM_SPECS + README + ARCHITECTURE + PROJECT_SPEC |
| 新 LLM provider | PROJECT_SPEC + ARCHITECTURE + API |
| 新 dependency | README + PROJECT_SPEC |
| 新 miniapp feature | README + PROJECT_SPEC + ARCHITECTURE |
| 新 algorithm 流程改動 | ALGORITHM_SPECS + ARCHITECTURE |

### C. K-line Cache (永久 rule, 大少 #8602)

```python
# Backend services/kline_cache.py 已 fix ✅
def _compute_fetch_max_count(period):
    if period == '1d': return 30 * 365
    return 10 * 365
```

- User query 嘅 start/end **唔應該 gate cache update logic**
- Wide-fetch 由 `earliest_cached` 開始
- 用 `get_cur_kline()` 拎 today intraday partial bar (唔入 DB)
- T-1 rule: 今日 bar 唔寫 DB,只喺 response 出

### D. Coding Workflow

- Backend **唔識 hot-reload** — 寫完要 kill + relaunch:
  ```bash
  pkill -9 -f "python.*main.py"
  cd ~/stockpulse && ./start.sh
  ```
- 每次 algorithm 改完 → run `cd ~/stockpulse && pytest backend/tests/`
- Testing page 自己 render K 線 (CDN lightweight-charts v4.2.3),**唔好 iframe embed StockPulse**
- Adapter 用 ES modules (`.mjs`),backend 用 Python
- Auto-test + evidence-based report after each change
- Screenshot → Kimi WebBridge endpoint `POST http://localhost:10086/command {action:"screenshot"}`

### E. Algorithm Design Principles (從 AS-03 lessons)

- **Rule-based + additive confidence** (避免 multiplicative 叠埋)
- **List all matched rules** (唔好 silently pick 一個)
- **唔好假設大少識 jargon** — 用 plain language
- **Vague 描述要主動 confirm** (例: 「最近」係指幾多日?)
- **Typo / edge case 要 flag** (例: 數學矛盾 case D high < MA60)
- **永遠先諗**「凡人有冇誤解」先寫 code

### F. Algorithm Reasons Display (Hybrid Strategy, 大少 #10097)

| Algorithm | Complexity | Display |
|-----------|-----------|---------|
| 簡單 (排名 + 板塊) | Inline plain text 喺 ResultGrid | AS-01 |
| 複雜 (6 維度 + LLM) | stock_reasons table + PopUp (DOMPurify sanitized HTML) | AS-02 |
| TBD | TBD | AS-03+ |

**Defense-in-Depth Sanitization** (3 layers):
1. **Algorithm-side**: `build_<algo>_reason_html()` 只 emit allowlist HTML tags
2. **Backend write**: `services.html_sanitizer.sanitize_html()` 用 bleach + post-scrub
3. **Frontend render**: `DOMPurify.sanitize()` client-side

### G. 2 Banner 分類 warning (Spec Sync #18, 8-14)

- 🔧 **system** (12 個 warning code): verdict 可能唔可信, 唔好落單
- 📊 **stock_state** (3 個 warning code): verdict 已經準確, 只係狀態提示
- 2 個 banner 永遠獨立 render, 唔合併
- 凡人話 impact/fix 永久跟 CATEGORY_DISPLAY template

### H. dataWindowDays 默認 1260 (5 年, 8-14)

- Testing page 永遠用 5 年 K 線 (1260 日), 唔再用 100 日默認
- 對齊 M9 設定
- 對短-history 股票 (新上市), user 自行調小 dataWindowDays

### I. 之字 = ZigZag 簡稱 + Config UX 模式 (8-19)

- 「之字」= ZigZag 紫色 line, 5% threshold
- Config UX 模式: 自動計算 (預設) + 可手動調 + 自動儲存 (localStorage) + 自動更新圖表
- 改動 → 即時 re-render, 唔需要撳跑算法
- 手動 mode 有「重置為自動」按鈕

### J. Algorithm sub-scenario 改動 必須人手 review (8-16)

- 改 algorithm sub-scenario trigger / 定義: 唔好 auto-implement, 逐條人手 review
- 步驟: (1) 大少拎出 sub-scenario (2) 大少睇 ≥ 3 個真實 stock 例子 confirm trigger (3) OK 先加入 (4) 全部確認一次過改 code (5) Spec Sync + commit + push
- 凡人話解釋 / bug fix / debug query: 跟舊 rule (Mavis 自動做 investigation + fix + spec sync)
- 對應: 改 sub-scenario trigger 必須附 ≥ 3 個真實 stock 例子

### K. HANDOVER.md 永久 rule 同步 (8-20, 本 commit 加返)

- MiniMax Code 完成 StockPulse feature → Update ARCHITECTURE.md + 呢個 HANDOVER.md (relevant sections) + commit + push
- 之前 8-7 至 8-20 漏 sync 13 日, 大少 8-20 trigger 補返, 之後每次 commit 必須 sync
- Spec drift detected → 任何一方 outbound flag 畀大少

### L. Module Warning Propagation Chain 永久 rule (8-31, 架構評審 Batch 1)

- `algorithm_runner.py` M7 inject 嗰段永遠要加 `warnings` field (拎 `list(upstream_verdict.warnings or [])`), 唔可以 silent drop
- `Synthesizer` algorithm.py 永遠用 `_aggregate_warnings(verdicts)` 統一 aggregate M1-M6 warnings, 唔可以直接 emit 個別 warning
- `WarningCollector` dedupe by (level + module_id + code), 排序 Critical → Warning → Info, 然後 by module_id
- < 6 個 module verdict 嗰陣 emit `MODULE_PARTIAL` warning (level=warning)
- Empty input 嗰陣 emit `INSUFFICIENT_DATA` warning (level=critical)
- `Verdict.warnings` 永遠用 `make_warning(...).to_dict()` 序列化 (Verdict type hint `List[Dict[str, Any]]`)
- 之後 M8 / M9 / AS-04+ 全部跟呢個 pattern: 拎 upstream verdict.warnings, 用 `_aggregate_warnings()` helper
- 詳見 ARCHITECTURE.md §15.40 (Spec Sync #48)
- 大少 trigger: 8月31日架構評審 Batch 1, P0-1 模塊耦合硬傷 (`decisionEngineToStandardVerdict` 唔 propagate warnings 永久 rule 已 acknowledge 但未實作, 落錯單風險)

### M. Caller Inject Contract 永久 rule (8-31, 架構評審 Batch 2)

- `backend/algorithms/contract.py` pydantic BaseModel 強制 M1-M6 module verdict shape
- `algorithm_runner.py` M7 inject 嗰段永遠 call `validate_module_verdict()` 拎 conform contract, 缺 required field 即刻 raise ValueError (唔可以 silent fall back)
- Required field: `module_id` (6 個 standard ID 之一) / `state` / `confidence` (0-1) / `base_weight` (0-1)
- Optional field 永久 pass-through: `max_drawdown_estimate` / `rules_fired` / `module_specific` / `warnings`
- 3 個 matchedRules alias 全部 work: `matchedRules` / `matched_rules` / `rules_fired`
- 之後新加 algorithm 全部 import contract.py 嘅 schema, 唔好自己 re-define verdict shape
- 詳見 ARCHITECTURE.md §15.41 (Spec Sync #49)
- 大少 trigger: 8月31日架構評審 Batch 2, P0-3 模塊耦合硬傷 (caller inject pattern 冇 contract test, M1 verdict shape 改咗 silent fall back)

### N. M9 Progress Feedback Infrastructure 永久 rule (8-31, 架構評審 Batch 3a)

- M9 algorithm.run() 必須 emit progress 落 `options['progress_callback']` (有就用, 冇就 skip)
- M9 verdict.meta 永遠包含 `progress_log: List[Dict]`, 每個 stage 一個 dict (stage / percent / timestamp)
- Stage label 統一: `data_validation` / `walk_forward_cv_starting` / `walk_forward_cv_folds_split` / `walk_forward_cv_fold` / `walk_forward_cv_done`
- `run_walk_forward_cv` fold loop emit 進度 (20% / 40% / 60% / 80% by fold N/total)
- 新加 endpoint `GET /api/algorithms/progress/{request_id}` 拎 in-memory progress dict
- 新加 endpoint `GET /api/algorithms/progress` 拎全部 active request (debug/monitoring)
- `backend/services/algorithm_progress.py` 提供 `get_progress()` / `make_progress_callback()` / `spawn_m9_with_progress()` (threading.Thread spawn + TTL 1 小時)
- In-memory store TTL 1 小時, 過期自動清
- Frontend ProgressBar polling 留返 Batch 3b (testing page 改要 cache bust + race condition 永久 rule)
- 詳見 ARCHITECTURE.md §15.42 (Spec Sync #50)
- 大少 trigger: 8月31日架構評審 Batch 3a, P0-5 性能瓶頸硬傷 (M9 cold call 30-60 秒冇 progress feedback, 大少撳掣以為 hang 撳多次掣撞 double-call)

### O. FutuOpenD Health Check 永久 rule (8-31, 架構評審 Batch 4)

- KlineCache 永遠有 `_futu_health` in-memory state (thread-safe `_futu_health_lock`)
- `KlineCache.futu_health_check(ctx)` async method, 連續 3 次失敗先轉 unhealthy (避免 network blip 誤報)
- `KlineCache.get_futu_health()` thread-safe getter, frontend polling 用
- `algorithm_runner.run_algorithm()` 開頭必先 check futu health, 不 healthy 嗰陣 emit `OPEN_D_UNAVAILABLE` warning (level=critical) + return `ok: False` 即刻 fail
- `OPEN_D_UNAVAILABLE` 永久係 critical level, 16 個 warning codes 統一: 6 critical / 7 warning / 3 info
- New endpoint `GET /api/algorithms/health/futu` 拎 in-memory futu health state
- Frontend polling `/api/algorithms/health/futu` 顯示 🔧 系統警告 banner 留返 Sprint 4 follow-up (testing page 改要 cache bust + race condition 永久 rule)
- KlineCache 30 秒 1 次自動 health check 留返 Sprint 4 follow-up (caller 自己 schedule)
- 詳見 ARCHITECTURE.md §15.43 (Spec Sync #51)
- 大少 trigger: 8月31日架構評審 Batch 4, P0-6 可用性隱患硬傷 (FutuOpenD 單點失敗, 全部 algorithm silent use stale K 線, 落錯單風險)

### P. AS-02 LLM Rate Limit + Timeout 永久 rule (8-31, 架構評審 Batch 5)

- AS-02 LLM call 永遠用 `asyncio.wait_for(asyncio.to_thread(...), timeout=30s)` 加 timeout
- 撞 rate limit (429 / "rate limit" string / "exceed" string) 永遠 exponential backoff retry: 1s → 2s → 4s → 8s (4 次)
- 全部 retry 失敗嗰陣 emit `LLM_RATE_LIMIT` warning (level=warning) 落 verdict `_warnings` field
- Final fallback 永遠帶 `_warnings` field (永久 rule §Module Warning v1.1.0)
- 17 個 warning codes 統一: 6 critical / 8 warning / 3 info
- Retry 期間用 `asyncio.sleep()` non-blocking, 唔 block event loop
- 詳見 ARCHITECTURE.md §15.44 (Spec Sync #52)
- 大少 trigger: 8月31日架構評審 Batch 5, P1-9 (原本 P0-4 降級, 確認 AS-02 已經 asyncio.gather parallel, 真正硬傷係 LLM rate limit + timeout 冇 handling)

### Q. Sprint 還原點永久 rule (8-31 07:52, 大項目之前必做)

- 大項目 (refactor / spec rewrite / framework 升級 / 預期 risk > 2 小時 scope) 之前必做還原點 set
- 還原點必含 4 個 component: annotated tag + backup branch + restore script + 永久 rule entry
- Annotated tag 命名: `restore-before-<project-name>` (e.g. `restore-before-sprint-4-followup`)
- Backup branch 命名: `backup-before-<project-name>` (e.g. `backup-before-sprint-4-followup`)
- Restore script 必入 `~/stockpulse/scripts/restore_<project>.sh`, 兩次 confirm (`yes` + `RESET`) 防止意外
- Tag + branch 必 push 去 origin
- 對齊 permanent rule §15.39 「還原備份還原點」pattern + 大少 8月30日 22:51 嘅 `git reset --hard 3a5c2fa4` 經驗
- 詳見 ARCHITECTURE.md §15.45 (Spec Sync #53)
- 當前還原點: `restore-before-sprint-4-followup` (喺 `7e68053a`)
- 還原 command: `bash ~/stockpulse/scripts/restore_sprint_4.sh`
- 大少 trigger: 8月31日 07:52「你先備份, 設位一個還原點, 當然到意外或不想改時, 可以一鍵完全還到回到現在」

### R. KlineCache 30 秒自動 Health Check 永久 rule (8-31 07:56, Sprint 4 Task 3)

- KlineCache `__init__` 必開 background thread 30 秒 1 次 health check
- thread daemon=True, 主 process 死嗰陣一齊死
- 拎 ctx 失敗嗰陣 log warning + continue, 唔 crash thread
- 用 nest_asyncio + asyncio.run (永久 rule §Spec Sync #40)
- Frontend polling `/api/algorithms/health/futu` 即時拎到 30 秒前嘅 health state
- 之後改 KlineCache 嗰陣, 必保留 background thread (唔好拎走 _start_health_check_thread call)
- 詳見 ARCHITECTURE.md §15.46 (Spec Sync #54)
- 大少 trigger: 8月31日 07:56「你可以 Go 了」Sprint 4 follow-up Task 3

### S. Frontend FutuOpenD Banner + M9 Progress Log 永久 rule (8-31 07:56, Sprint 4 Task 1+2)

- testing page 加載即時 `pollFutuHealth()` 一次 (避免 5 秒 delay), 之後 5 秒 1 次 polling
- 撳跑任何 algorithm 之前必 `await pollFutuHealth()` 最後 1 次 check, 避免 5 秒 delay 撞 banner 期間
- OpenD 不 healthy 嗰陣必顯示頂部紅色 banner + disable「跑算法」掣 (`btn-run-algorithm` + `btn-run-chain`)
- M9 verdict 必 prepend `renderM9ProgressLog()`, 唔好 caller 自己 implement progress bar
- 改 testing-page.js critical code 必同步 bump `ALGO_CACHE_BUST` + `?v=` 2 個地方 (永久 rule 21:24)
- 永久 rule §21:24 cache bust self-check 仍然 work (4.49.0 → 4.50.0 + ?v=2.3.110 → 2.3.111)
- 詳見 ARCHITECTURE.md §15.47 (Spec Sync #55)
- 大少 trigger: 8月31日 07:56「你可以 Go 了」Sprint 4 follow-up Task 1+2

---

## 7. Critical Pitfalls (避開!)

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
- ❌ Multiplier discount 叠 → 改用 rule-based

---

## 8. Current Known Issues (Outstanding)

1. **EW bug** 仍未修 (永遠顯示「A」,在 `ChartContainer.tsx`)
2. **Backend auth 完全冇** (內網 only OK)
3. **`.gitignore` 唔齊** (`web/node_modules/.vite/*` commit 咗,要 revert)
4. **#15 wipe** — 29 stocks data testing 時 wipe 咗
5. **trigger.log** 510MB (可能要清理)
6. **.gitignore.bak** 殘留檔案
7. **K-line gap** 已 fix 但要 monitor 後續有冇其他 stocks 出現

---

## 9. 最近 Activity (時序)

| 日期 | 動作 |
|------|------|
| 2026-08-07 | **AS-03 完整 7-stages roadmap 規劃** — MiniMax Code: 大少指示「按流程做，每次一個 module，詳細測試和改良」. 寫咗 `docs/research/AS-03-cycle-detection/ROADMAP.md` (10 section, 12 modules status table, 7-stage 工作流程, 每 module 7 步 workflow, 風險 mitigation). 順序: Stage 0 Foundation → Stage 1 完成 Module 3-7 (Multi-TF 先做) → Stage 2 啟動 data collection → Stage 3 Confluence → Stage 4 Entry + Backtest Timeline → Stage 5 Trade Journal → Stage 6 Probability + Risk-Reward → Stage 7 Bayesian tuning. HANDOVER.md § 5 + ARCHITECTURE.md § 狀態 sync. |
| 2026-08-07 | **Module 3 (趨勢線法) v0.1.0 落地** — MiniMax Code: 從 `docs/演算法概念SPECS/3趨勢線法.docx` v2.0 (Kimi RANSAC/成交量加權/ATR 統計模型) 簡化為大少 rule-based 風格, 10 條 rule A-J (支撐線上升/壓力線下降/通道窄/收斂三角形/上升楔形/下降楔形/真跌破/真突破/支持有效/壓力有效). 動態 OLS (3-8 points by R²) + 觸線統計 + 真假突破判定. 5/7 step done: spec (`MODULE-03-TRENDLINE.md`) + code (`modules/trendline.ts` + port `adapter.mjs`) + 14/14 tests pass + testing page verify (HK.00700 SIDEWAYS 65%, I+J 觸發, 紅綠 2 條 trend line render OK). Step 6-7: doc update + commit (待大少 review). |
| 2026-08-07 | **MA chart overlay 完成** — MiniMax Code: testing page 嘅 K 線圖 render MA5/MA10/MA60 三條 trend line (跟股價走嘅斜線, 主流 trading app 風格). 由 `createPriceLine` (水平價線) 改 `addLineSeries` (re-compute MA 歷史 series). `_computeMASeries` skip header `period-1` 點避免 lightweight-charts 將 null 當 0. Function name `renderMAChartOverlay` → `renderChartOverlay` 跟 testing page 嘅 standard contract. 3 commits (`9d77021a` / `ec452c98` / `830927cc`). Tests 12/12 + 19/19 全部 pass. |
| 2026-08-07 | **MA chart overlay 完成** — MiniMax Code: testing page 嘅 K 線圖 render MA5/MA10/MA60 三條 trend line (跟股價走嘅斜線, 主流 trading app 風格). 由 `createPriceLine` (水平價線) 改 `addLineSeries` (re-compute MA 歷史 series). `_computeMASeries` skip header `period-1` 點避免 lightweight-charts 將 null 當 0. Function name `renderMAChartOverlay` → `renderChartOverlay` 跟 testing page 嘅 standard contract. 3 commits (`9d77021a` / `ec452c98` / `830927cc`). Tests 12/12 + 19/19 全部 pass. |
| 2026-08-07 | **Module 2 (高低點結構法) v0.1.0 落地** — MiniMax Code: 18 步 v2.0 algorithm (modules/hl-structure.ts) + config (HLStructureConfig) + tests (12/12 pass) + adapter (`hlStructureAdapter` named export) + testing page integration (REGISTRY entry + `renderChartOverlay` contract) + spec doc (`MODULE-02-HL-STRUCTURE.md`) |
| 2026-08-07 | **Testing page renderChartOverlay contract** — 通用 contract, 每個 adapter 自己 implement chart overlay (peaks/troughs markers + 箱體線 + 形態預警) |
| 2026-08-08 | **M1 v2.0 (均線系統週期判斷法) 落地** — MiniMax Code: 從 `zmen均算去` 抽離做 M1, 加 Volume & Slope 擴展. 6 個 modules 命名 01-06 (zmen 排去尾). 4 條 MA chart overlay (MA5/10/60 + zmen MA). |
| 2026-08-08 | **Module 4-6 v1.0.0 落地** — MiniMax Code: M4 動能背馳與衰竭 + M5 成交量價格行為確認 v2.0 + M6 波動率與市場結構. 全部 spec doc + tests pass + testing page verify. |
| 2026-08-08 | **4 個 UX 優化** — MiniMax Code: data-summary 排版 + 信心指數解讀 + 凡人話 interpretation + 觀望/策略 box 詳細解說. 大少 #10203 trigger. |
| 2026-08-09 | **StockPulse Spec Sync #2-#3** — MiniMax Code: 7 modules done + REGISTRY 6 entries + qfq fix + M1 v2.0 spec. ARCHITECTURE.md + 4 份 spec doc 全部 sync. |
| 2026-08-10 | **dataWindowDays 對齊 backend fix (#11070)** — MiniMax Code: testing page 改 dataWindowDays 改 300 但 chart 仲係 100 日結果 bug 修咗. Backend 1d endpoint start_date = count*1.5 calendar days back, response trim, metadata 顯示「設定 X / 實際 Y」. 永久 rule 應用所有 K 線 endpoint. |
| 2026-08-10 | **K-line Cache wide-fetch 永久 rule** — MiniMax Code: 1d period 用 max_count=30*365=10950 (30 年 window), caller max_count 只作 trim response. Cold cache wide-fetch fix. ARCHITECTURE §13.1 sync. |
| 2026-08-11 | **AS-03 Chain v1.0 (M7→M9→M8)** — MiniMax Code: 完整 chain flow, dropdown 排位 07→09→zmen→08→11, M8 verdict 永久有 optimal_params 3 個 field, 「跑完整鏈條」掣. M9 ReferenceError 'postErrors is not defined' 永久 fix. |
| 2026-08-11 | **AS-03 Chain v1.1 改善 1+2+3** — MiniMax Code: M8 verdict embed M9 summary sub-section, Chain 改 conditional (cache OK skip M9, 2-4 秒搞掂), banner timestamp bug fix. |
| 2026-08-11 | **Codebase 註解 Phase 4 partial gap fill** — MiniMax Code: M4 analyzeIndicators header 註解 + 6 個 adapter entry header 註解 (maAlignmentV2 / hlStructure / trendline / indicators / volumePrice / volatility). |
| 2026-08-11 | **Cache save_params edge case fix** — MiniMax Code: 永久 preserve 已有 optimal 同 forward_return_history 即使 cache 過期或 _read_cache fail. |
| 2026-08-11 | **UX 改善 — 2 個掣 conditional show/hide** — MiniMax Code: 「跑完整鏈條」掣只喺 M8 顯示, 「跑算法」掣喺 M8 隱藏. |
| 2026-08-13 | **M9 popup 註解全面化** — MiniMax Code: 25 個 M9_TOOLTIPS key 凡人話解釋, 跟 M7/M8 同樣 .m9-verdict-tooltip inline style. Spec Sync #17. |
| 2026-08-14 | **2 banner 分類 warning (Spec Sync #18)** — MiniMax Code: 🔧 system (verdict 唔可信, 12 個) + 📊 stock_state (verdict 已經準確, 3 個). 2 個獨立 banner 永遠 render. 13 個 warning code impact/fix 永久跟 CATEGORY_DISPLAY template. |
| 2026-08-14 | **dataWindowDays 默認 1260 (5 年) 永久 rule** — MiniMax Code: 對齊 M9 設定. 移除 M1 v0.3.0 zmen + M9 algorithm 嘅 CONFIG_DEFAULTS trigger. |
| 2026-08-15 | **M1 v2.1.0 — 9 個 sub-scenario extend** — MiniMax Code: 5 個判定優先級 (到頂/到底轉勢 → 強趨勢 → 弱趨勢 → 過渡形態 → 橫行). 凡人話 popup 註解 + 凡人話 strategy advice + 凡人話 12 步 step-by-step guide. 3 個 warning code (FALLBACK_USED / THRESHOLD_BREACH / CONFLICT_STATE). |
| 2026-08-15 | **M7 Synthesizer 優化 Level 1-6** — MiniMax Code: 全用上 M1 嘅 14 個 field. M1 動態 base_weight + 3 條 expert rules (TRANSITION + super weight) + 2 條 cross-module alignment enrich + 凡人話 reasoning enrich. |
| 2026-08-15 | **zmen 均算法 v1.0 雙層 architecture** — MiniMax Code: Layer 1 保留 v0.3.0 10 條 rule + Layer 2 加 M1 9 個 sub-scenario enrich (用 zmen 自己 MA 數據 derive, 唔覆蓋 Layer 1). 凡人話 warning (THRESHOLD_BREACH / CONFLICT_STATE). |
| 2026-08-16 | **「虛火」concept 錯反饋** — 大少: 太古 00019 7月 81.1 → 8月 101.7 (+25.40%) 判定「虛火」係錯. 真強升都有 70% 日穿. 真正「虛火」應該係: 升緊但每次反彈縮短, 每次下跌加深. M1 v2.2 algorithm 改動 spec doc. |
| 2026-08-16 | **改 sub-scenario trigger 必須附 ≥ 3 個真實 stock 例子永久 rule** — 大少: 改 algorithm sub-scenario trigger / 定義改動要逐條人手 review. 步驟: 大少拎出 → ≥ 3 隻 stock 例子 verify → OK 加入 → 全部確認一次過改 code → Spec Sync + commit. |
| 2026-08-19 | **ZigZag 拎 point 落地 (M1 v2.0)** — MiniMax Code: 5% threshold 過濾 noise, 從 ChartContainer.tsx 移植 calculateZigZag 去 algorithms/AS-03-cycle-detection/adapter.mjs. _zigzagNormalizeDate fallback chain fix. 紫色 ZigZag line render. 加深綠色 close extension line. 8-20 7:10 修正之字 metric 對齊 high/low (用 wick extreme 拎 point). |
| 2026-08-19 | **ZigZag 點順序號碼 marker** — MiniMax Code: 紫色 ZigZag 點加 1, 2, 3, ... 號碼 marker + toggle + spinbutton. 永遠 auto-update debug panel. |
| 2026-08-19 | **M1 v2.2 Stage 1 之字斜率 framework** — MiniMax Code: calcZigZagSlope 用之字第 1 點 → 第 2 點計算斜率, 拎 dailySlope. Config UX 模式: 自動計算 (預設) + 可手動調 + 自動儲存 (localStorage) + 自動更新圖表. |
| 2026-08-19 | **Spec Sync #20** — MiniMax Code: ZigZag 點順序號碼 + M1 v2.1.0 + zmen v1.0 + 3 個 UX 改動. ARCHITECTURE.md 永久 sync. **HANDOVER.md 漏 sync 13 日 (本 commit 補返)**. |
| 2026-08-20 | **ZigZag Noise 大少提問 (0981 7-13 低 76.65)** — 大少 trigger: 「ZigZag 轉向如果設定當日只能做一次 5% threshold, 可否解決 Noise 嘅問題」. MiniMax Code 確認算法現時 main loop 已經係每個 i 拎 0/1 個 point, 但「補最後一個 point」邏輯 + wick extreme 敏感性可能係 noise 源頭. 等大少揀方案 (A cooldown 1 / B 提高 threshold / C 拎 close 變化 / D hold N 日 confirm). |
| 2026-08-06 | K-line cache gap-fill fix (3 fixes, 14/14 tests pass) |
| 2026-08-06 | AS-03 量價 + 斜率 module 開發 + plain language 解讀 |
| 2026-08-05 | Testing page framework + AS-03 dropdown |
| 2026-08-04 | AS-03 v0.3.0 10 條 rule (A-J) |
| 2026-08-03 | Stock reasons system 落地 (smart dedupe + soft delete + 3-layer sanitization) |
| 2026-08-03 | Reason display v2 (中文 labels + 顏色 mapping + dim-score background pill) |
| 2026-07-29 | Spec 1+2 commit (delete in edit modal + reorder/pin) |
| 2026-07-18 | Frontend dev server 起咗 |
| 2026-05-15 | EW bug 第一次發現 |

---

## 10. External Services 大少有

| Service | Address | 用途 | MiniMax Code access? |
|---------|---------|------|--------------------|
| Futu OpenD | localhost:11111 | 港股/美股 即時報價 + 落單 | TCP socket,OK |
| Kimi WebBridge | localhost:10086 | 大少真實 Chrome 控制 + screenshot | HTTP API,OK |
| OpenCode Daemon | 127.0.0.1:12345 | OpenClaw 用嘅 coding agent | MiniMax Code 可能係佢替代 |
| NAS | 192.168.1.188 | Backup destination | SSH,OK |
| Telegram Bot | miniapp/backend | StockPulse Telegram interface | HTTP,OK |
| Vite dev server | localhost:3000 | Frontend | 已 running |

> ⚠️ **MiniMax Code capabilities 確認 (建議大少做):**
> - 直接 file system access (`~/stockpulse/`)
> - TCP/HTTP 連去 Futu/Kimi/OpenCode
> - Git commit + push
> - **不肯定**: Screenshot / browser automation — fallback 叫 OpenClaw

---

## 11. 大少嘅性格 + 偏好 (重要!)

| 偏好 | 內容 |
|------|------|
| 語言 | 普通話 outbound (大少 inbound 用香港話) |
| 風格 | 簡潔直接, 唔好嘥話 |
| Format | bullet points / table |
| Jargon | 圈內通用 technical 用英文 (PE/ETF/MACD/limit order);其他用 plain language |
| 性格 | 唔好自己作主, 先搵問題, 「全部都顯示」 |
| Debug 風格 | 改完要 auto-verify + evidence-based report |

---

## 12. 接手第一步 Checklist

- [ ] 讀完 5 份 spec docs (README/PROJECT_SPEC/ARCHITECTURE/API/ALGORITHM_SPECS)
- [ ] (Optional) 讀 OpenClaw `STOCKPULSE_REFERENCE.md` (大少 share 嘅話)
- [ ] 跑 `cd ~/stockpulse && ./start.sh` 起 backend
- [ ] 跑 `cd ~/stockpulse/web && npm run dev` 起 frontend
- [ ] 訪問 http://localhost:3000 確認 frontend OK
- [ ] 訪問 http://localhost:8765 確認 testing page OK
- [ ] Run `pytest backend/tests/` 確認 14/14 tests pass
- [ ] 確認 `git status`,睇下有冇 uncommitted changes
- [ ] 第一個 coding task 起 AS-03 量價 / 斜率 module / 或者修 EW bug

---

## 13. OpenClaw (我) 嘅角色轉變

Handover 之後:
- ✅ 大少繼續可以問我 context / 設計討論 / debug / 突發 issue
- ✅ 我繼續做 OpenClaw-only tools (Kimi WebBridge screenshot / NAS backup / daily log / cron)
- ❌ 主要 coding 由 MiniMax Code 做 (大少指示)
- 🔄 兩邊 AI sync spec 透過:
  - `~/stockpulse/HANDOVER.md` (本 file, MiniMax Code read + update)
  - `~/stockpulse/ARCHITECTURE.md` (兩邊都 update)
  - OpenClaw `STOCKPULSE_REFERENCE.md` (OpenClaw-only, 我自己 maintain)
  - Commit message 記錄 spec sync

---

## 14. 長期 Sync 機制 (建議)

Handover doc 容易 stale,**需要 sync mechanism**:

| Trigger | Action |
|---------|--------|
| MiniMax Code 完成 StockPulse feature | Update `~/stockpulse/ARCHITECTURE.md` + 呢個 `HANDOVER.md` (relevant sections) + commit |
| OpenClaw 收到 StockPulse context change | 我自己 update `STOCKPULSE_REFERENCE.md`,如果有 cross-cutting change 同時通知大少 |
| 大少 trigger `更新Stockpluse` | MiniMax Code (如果 active) 自動執行 4 steps;OpenClaw 自動 update 自己個 file |
| Spec drift detected | 任何一方 outbound flag 畀大少 |

**Single source of truth** 永遠係 4 份 spec docs (`README`/`PROJECT_SPEC`/`ARCHITECTURE`/`API`)。`HANDOVER.md` 係 onboarding document,sync 但唔係 canonical。

---

**Maintainer**: 大少 (zmen)  
**Created**: 2026-08-06 (OpenClaw handover)  
**Version**: 1.0
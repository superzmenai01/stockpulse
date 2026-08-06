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
| **Latest commit** | ae56fdff (2026-07-29) |
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
| **AS-03** | 股票周期判定 | 🚧 v0.3.0 dev | (TBD) |
| AS-04+ | TBD | 💡 Future | - |

**AS-03 current state**:
- 10 條 rule (A-J),rule-based,additive confidence (避免 multiplicative)
- MA alignment (mandatory core) + 5 optional modules (量價 / 斜率 / HL 結構 / 趨勢線 / 指標)
- 4 個 cycle state: UP / DOWN / SIDEWAYS / TRANSITION
- 詳細 spec: `algorithms/AS-03-cycle-detection/` + `docs/research/AS-03-cycle-detection/MODULE-01-MA-ALIGNMENT.md`

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
| 2026-08-07 | **Module 2 (高低點結構法) v0.1.0 落地** — MiniMax Code: 18 步 v2.0 algorithm (modules/hl-structure.ts) + config (HLStructureConfig) + tests (12/12 pass) + adapter (`hlStructureAdapter` named export) + testing page integration (REGISTRY entry + `renderChartOverlay` contract) + spec doc (`MODULE-02-HL-STRUCTURE.md`) |
| 2026-08-07 | **Testing page renderChartOverlay contract** — 通用 contract, 每個 adapter 自己 implement chart overlay (peaks/troughs markers + 箱體線 + 形態預警) |
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
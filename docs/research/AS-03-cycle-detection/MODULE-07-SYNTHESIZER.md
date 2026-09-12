# AS-03 · Module 7: 終極綜合判定 (Synthesizer v2.0.5)

> **對應 docx**: `docs/演算法概念SPECS/07多時間框架一致性與極端情緒校準法.docx` (M7 部分)
> **對應 TS 檔**: `algorithms/AS-03-cycle-detection/modules/synthesizer.ts` (M7, 559 行 v2.0.2, frontend Phase 11 之後拎走, fetch backend stub)
> **對應 types**: `algorithms/AS-03-cycle-detection/types.ts` (SynthesizerVerdict interface, v2.0.2 加 2 個新 field)
> **對應 backend**: `backend/algorithms/synthesizer/algorithm.py` (M7, v2.0.5, alignment 方案 A 拎走 SIDEWAYS 共識 bonus)
> **對應 tests**: `algorithms/AS-03-cycle-detection/__tests__/synthesizer.test.mjs` (64 個 assertions)
> **對應 adapter**: `algorithms/AS-03-cycle-detection/adapter.mjs` (`synthesizerAdapter` + decisionEngineKellyLabel / renderKellyDonut 加 'zero' case)

> **對應 docx**: `docs/演算法概念SPECS/07多時間框架一致性與極端情緒校準法.docx` (M7 部分)
> **對應 TS 檔**: `algorithms/AS-03-cycle-detection/modules/synthesizer.ts` (M7, 559 行 v2.0.0)
> **對應 types**: `algorithms/AS-03-cycle-detection/types.ts` (SynthesizerVerdict interface, v2.0.0 加 8 個新 field)
> **對應 backend**: `backend/algorithms/synthesizer/algorithm.py` (M7, v2.0.0, 8-stage architecture)
> **對應 tests**: `algorithms/AS-03-cycle-detection/__tests__/synthesizer.test.mjs` (64 個 assertions)
> **對應 adapter**: `algorithms/AS-03-cycle-detection/adapter.mjs` (`synthesizerAdapter`)
>
> **M8 部分 (8 個 finalAction + Trading card + 短期走勢預測 + 人話詳細解讀 + 5 個 adaptive params + L2 cache) 見** `MODULE-08-DECISION-ENGINE.md`

> **大少 2026-09-10 23:06 Spec Sync #62 (v2.0.0)**: 8-stage architecture
> - 拎走 v1.2.0 永久 skip M4 邏輯 (Stage 1+2 拎方案 A 拎 M4 8 signal → 3-state mapping)
> - Stage 3 weight discount generalization (對齊 §M2 self-check weight 折扣 永久 rule generalize 至 M1/M3/M4/M5/M6)
> - Stage 4 conflict detection (UP↔DOWN 矛盾)
> - Stage 5 consensus scoring (67% threshold, 對齊 plan v2 §F 60% hit rate evidence)
> - Stage 7 state derivation (共識先重要, 共識唔到先睇簡單多數)
> - Stage 8 verdict assembly (加 8 個新 field + 3 個新 warning 注入點)
>
> **大少 2026-08-08 13:30 指示 (Plan A 拆返 M7+M8)**: 之前 sprint 1 合併做 1 個 mega module, 大少澄清「一齊優化」意思係「設計上一起考慮但 implementation 應該分開」, 而家拆返 2 個獨立 module + spec doc:
> - **M7 (Synthesizer)** = 本 doc — 6 個 modules 嘅綜合判定 (SSI + TCM + Alignment + 8 個 Grade + Kelly 倉位)
> - **M8 (Decision Engine)** = `MODULE-08-DECISION-ENGINE.md` — Sprint 2 將加 (finalAction 8 個 + trading card + 短期走勢預測 + 人話詳細解讀 + 5 個 adaptive params + L2 cache)
>
> **大少 2026-08-08 11:39 指示**: 5 個 adaptive params (SSI 戰略層權重 / RSI 情緒權重 / Kelly 倉位分數 / 馬可維茨相關係數 / Hurst 持續反轉 threshold) — 屬於 M8 adaptive params, 見 `MODULE-08-DECISION-ENGINE.md` §adaptive params
>
> **大少 2026-08-08 11:57 指示**: UX 多圖少文字, 顏色對應狀態, 永遠全 Show (將來可收埋個別 section)。
>
> **大少 2026-08-08 13:30 永久 rule (Memory)**: M8 嘅人話詳細解讀 (render function) 必須有 `async generateInterpretation(ctx): Promise<string>` interface, 將來可以 swap 落 LLM call (OpenAI / MiniMax / Kimi)。Sprint 2 而家用 hardcoded template, 大少話「記底日後提我去做返」。

---

## v2.0.5 永久改動 (大少 2026-09-12 07:28 Spec Sync #65, Alignment 方案 A 拎走 SIDEWAYS 共識 bonus)

### 凡人話總結

大少 9月12日 07:28 撳跑 M7 對 HK.00524 verify 揭發 grade 出 A 級 (81.4) 但 6 個老師全部都話 SIDEWAYS (冇方向共識), 副校長(副校長) 卻畀 A 級 = BUY 動作 ← 邏輯矛盾。Root cause: `_compute_alignment` 舊公式 `max_group_size / total_count`, 6 個老師 SIDEWAYS 100% 同意都當 100% 對齊拎 bonus, 但 SIDEWAYS 係「冇方向」, 唔應該當「對齊」。方案 A (大少 7:28 trigger 揀): alignment 只計「方向對齊」(UP/DOWN), SIDEWAYS 共識 → alignment = 0 (冇方向 = 冇對齊)。

**凡人話決策**:
- 「6 個朋友都話冇所謂 (SIDEWAYS)」係「冇方向共識」, 唔應該當「100% 對齊」拎 alignment bonus
- Alignment 修正: max_state = "SIDEWAYS" → alignment = 0
- 00524 修正: A (81.4) → C (41.4) ← 凡人話「冇能力」就係 C 級觀望 ✅
- 5 隻 stock 影響: 方向共識 (UP/DOWN) → alignment 正常計保留, SIDEWAYS 共識 → alignment 0 → grade 自動降一級
- 對齊凡人話邏輯: 冇方向共識 → 最多 C 級觀望, 唔可以畀 A 級 BUY

### v2.0.4 改動詳情

#### 1. Backend `_compute_alignment` 加 SIDEWAYS 共識 guard

```python
# backend/algorithms/synthesizer/algorithm.py line 190-218
def _compute_alignment(verdicts: List[Dict[str, Any]]) -> float:
    """Alignment Score (0-1): 6 個 module (M1-M6) state 一致程度
    v2.0.4 (大少 2026-09-12 07:28 Spec Sync #65) — 方案 A 拎走 SIDEWAYS 共識 bonus
    凡人話: 6 個朋友都話「冇所謂」(SIDEWAYS 共識), 唔應該當「100% 對齊」拎 bonus
    對齊 plan v2 §H Stage 5 (consensus scoring)
    """
    if not verdicts:
        return 0.0
    state_count: Dict[str, int] = {}
    for v in verdicts:
        state = v.get("state", "SIDEWAYS")
        state_count[state] = state_count.get(state, 0) + 1

    # v2.0.4 方案 A (大少 9月12日 07:28 Spec Sync #65):
    # 拎最多 state, 如果係 SIDEWAYS → 對齊分 = 0
    # 凡人話: 6 個老師都話「唔郁」, 唔應該當「對齊」拎 alignment bonus
    max_state = max(state_count, key=state_count.get)
    if max_state == "SIDEWAYS":
        return 0.0

    max_count = state_count[max_state]
    return round((max_count / len(verdicts)) * 1000) / 1000
```

#### 2. 5 隻 stock 凡人話對比 evidence (Spec Sync #65)

| Stock | v2.0.2/3 grade | v2.0.4 grade | 凡人話解 |
|---|---|---|---|
| HK.00524 | A (81.4) | **C (41.4)** | 6 個老師 SIDEWAYS → alignment 100% → 0, A → C ✅ |
| HK.00700 | C+ (53.6) | C+ (53.6) | DOWN 共識 → alignment 60% 正常計, grade 保留 ✅ |
| HK.00005 | B (61.2) | F (26.3) | SIDEWAYS 共識 → alignment 0, B → F (對齊 spec §7 唔開新倉) |
| US.AAPL | B (61.2) | F (27.6) | SIDEWAYS 共識 → alignment 0, B → F (對齊 spec §7 唔開新倉) |
| US.MSFT | B (61.2) | B (63.0) | UP 共識 → alignment 66.7% 正常計, grade 保留 ✅ |
| US.GOOGL | C (40.8) | D (34.6) | SIDEWAYS 共識 → alignment 0, C → D (對齊 spec §7 SELL) |

**凡人話結論**:
- ✅ **方向共識 (UP/DOWN) → alignment 正常計, grade 保留**: HK.00700 DOWN 共識 C+ 觀望, US.MSFT UP 共識 B 級
- ✅ **冇方向共識 (SIDEWAYS) → alignment 0%, grade 自動降一級**: HK.00005 B → F, US.AAPL B → F, US.GOOGL C → D, 00524 A → C
- 凡人話: 00524 「冇呢個能力」就係 C 級觀望, 唔可以畀 A 級 BUY ✅

### v2.0.4 對齊永久 rule checklist

- ✅ M7 `_compute_alignment` 永遠拎走 SIDEWAYS 共識 bonus (方案 A 永遠 0)
- ✅ Backend 改完必 restart (`./start.sh`) + curl verify
- ✅ 改 `algorithm.py` 之後 Spec Sync 必 update MODULE-07-SYNTHESIZER.md + AGENTS.md 永久 rule section
- ✅ Frontend Phase 11 拎走 chain 之後, frontend 自動 fetch backend, 唔需要再 port 1:1

---

## v2.0.3 永久改動 (大少 2026-09-12 06:59 Spec Sync #64, Phase 11 frontend 拎走)

### 凡人話總結

大少 9月12日 06:59 撳跑 M7 對 4 隻 stock 00038/00079/00524/00002 verify 揭發 frontend 計出嚟嘅 grade 全部比 backend emit 低 1 級 (例: 00038 frontend=C+ backend=B, 00524 frontend=B+ backend=A)。Root cause: Phase 1-10 拎走咗 M1/M2/M3/M4/M5/M6/M8 frontend 改 fetch backend, 但 **M7 Synthesizer 從來冇拎走 frontend**, frontend testing page 一直跑緊 frontend 自己嘅 algorithm (155 行 chain 包括 6 個 module 自己跑 + 5 個 sub-step aggregation + 7 個 warning 注入), 同 backend algorithm 唔對齊。Phase 11 拎走 frontend chain 改 fetch backend stub, 對齊 §Phase 10 永久 rule 沿用 (大少 8月20日 22:08 M8 拎走 pattern)。

**凡人話決策**:
- Frontend 同 backend 算法唔對齊係 spec bug, 凡人話:大少撳 testing page 睇到嘅 grade 同 backend emit 嘅 grade 唔同, 永遠差 1 級, 違反「frontend display 對齊 backend verdict shape」永久 rule spirit
- Phase 11 拎走 frontend chain, 統一 fetch backend `/api/algorithms/run?algo=synthesizer` 拎 verdict
- Frontend normalize backend emit 嘅 field 落 frontend shape, 對齊 §M7 v2.0.2 frontend display path fix 永久 rule spirit
- 對齊 §Backend 永久改 emit field name 之後 frontend 必先 grep 全 reference 對齊永久 rule (9月10日 23:45)

### v2.0.3 改動詳情

#### 1. Frontend `analyzeDecisionEngine` 拎走 chain (大少 9月12日 trigger)

**改前**: frontend 155 行 chain:
```js
// 1) 跑 6 個 modules (自己跑 M1-M6 frontend algorithm)
// 2) Transform 去 standard verdict (decisionEngineToStandardVerdict)
// 3) 5 個 sub-step aggregation (SSI / TCM / alignment / Grade / Kelly)
// 4) ZigZagSlope cross-module alignment enrichment
// 5) Step 4 Grade (用 penalty 後 alignment_score)
// 6) 7 個 warning 注入 (M1-M6 propagation + M7 自己 3 個 generate)
```

**改後**: 換 fetch backend stub (對齊 Phase 10 永久 rule):
```js
const resp = await fetch(`http://localhost:18792/api/algorithms/run?algo=synthesizer&symbol=${encodeURIComponent(symbol)}&period=1d&data_window_days=${dataWindowDays}`);
// 拎 backend verdict, normalize backend emit 嘅 meta.X field 落 frontend shape
return {
  state: m.state, grade: m.grade, ssi_score: m.ssi_score, ...,
  warnings: backendVerdict.warnings || [],  // 對齊 §Backend 永久改 emit field name 永久 rule
  ...
};
```

#### 2. Frontend normalize 對齊 backend emit shape (對齊 §M7 v2.0.2 frontend display path fix 永久 rule)

Frontend `analyzeDecisionEngine` return 嘅 field 全部拎 `verdict.meta.X`:
- top-level: `state` / `confidence` / `symbol` / `ok` / `error` / `timestamp`
- 拎 `meta.X` 落 top-level 對齊 `renderDecisionEngineResult` 拎 path: `grade` / `grade_score` / `grade_reason` / `ssi_score` / `ssi_breakdown` / `tcm_matrix` / `alignment_score` / `alignment_score_after_penalty` / `zigzag_alignment_penalty` / `zigzag_alignment_reasons` / `kelly_fraction` / `kelly_numeric` / `kelly_position` / `kelly_state_guard_triggered` / `kelly_state_guard_reason` / `module_summary` / `consensus_state` / `consensus_score` / `consensus_achieved` / `simple_majority_state` / `state_breakdown` / `weight_discounts` / `conflict_pairs` / `conflict_count` / `module_verdicts`
- `warnings` 拎 backend emit top-level (對齊 §Backend 永久改 emit field name 永久 rule, 唔再 _warnings leading underscore)

#### 3. Error handling 永久 rule

frontend fetch backend 失敗時 emit 1 個 `POST_FAILED` critical warning (對齊 §Phase 10 永久 rule M8 pattern):
- Backend fetch exception → 拎 `makeWarning('critical', 'M7', 'POST_FAILED')`
- Backend HTTP 4xx/5xx → 拎 `makeWarning('critical', 'M7', 'POST_FAILED')`
- Backend JSON parse failed → 拎 `makeWarning('critical', 'M7', 'POST_FAILED')`

### 4 隻 stock verify 結果 (大少 9月12日 06:59 trigger 後 verify)

| Stock | Backend emit (Phase 11 之前 frontend 拎) | Frontend chain 拎 (Phase 11 之前 frontend 自己跑) | Phase 11 之後 frontend 拎 backend emit |
|---|---|---|---|
| HK.00038 | B (grade_score=61.2) | C+ | **B** ✅ 對齊 backend |
| HK.00079 | C (grade_score=40.8) | D | **C** ✅ 對齊 backend |
| HK.00524 | A (grade_score=81.4) | B+ | **A** ✅ 對齊 backend |
| HK.00002 | B+ (grade_score=79.7) | B | **B+** ✅ 對齊 backend |

**凡人話 verify 結論**: 4 隻 stock 全部確認 frontend chain 拎嘅 grade 差 backend emit 1 級, Phase 11 之後 frontend 拎 backend emit 完全對齊 backend, 確認 fix 成功。

---

## v2.0.2 永久改動 (大少 2026-09-12 06:31 Spec Sync #63, Kelly state guard)

### 凡人話總結

大少 9月12日 06:31 trigger 揭發 M7 algorithm 嘅 `_compute_kelly()` 完全冇睇 state — 跌 verdict (00700 DOWN) 都畀 quarter 倉, 違反 spec doc §7 Cycle State 判定 (Grade D/F → SELL action, 唔開新倉)。凡人話:跌訊號/觀望 verdict 唔應該開新倉。

**凡人話決策**:
- 跟 Grade A+~F 對應表 (spec doc §7) — Grade D/F 對應 SELL action,即係「唔開新倉」
- 現實嘅 Kelly 計算跟 avg DD 自動切 half/quarter/octo,但唔睇 state,跌 verdict + 高 DD = 1/8 倉 = 仲叫人博反彈,離譜
- v2.0.2 加 state guard:state = DOWN 或 SIDEWAYS → Kelly = 0 (zero 倉)
- 對齊凡人話: 副校長見到跌 verdict 唔會叫人開新倉,只會叫人走(對齊 Grade D/F SELL action)

### v2.0.2 改動詳情

#### 1. Backend `_compute_kelly()` 加 state guard (大少 9月12日 trigger)

**改 signature**:
```python
def _compute_kelly(verdicts, final_state="SIDEWAYS") -> Dict[str, Any]:
    # v2.0.2 state guard: DOWN / SIDEWAYS → 0 倉 (對齊 spec doc §7 Grade D/F SELL action)
    if final_state in ("DOWN", "SIDEWAYS"):
        return {
            "fraction": "zero",
            "numeric": 0.0,
            "position": 0.0,
            "state_guard_triggered": True,
            "state_guard_reason": f"state={final_state} (DOWN/SIDEWAYS) → 0 倉, 對齊 spec doc §7 Grade D/F SELL action, 唔開新倉",
        }
    # ... 之前 avg DD 邏輯 (state=UP 嗰陣先行)
```

**凡人話**: algorithm 而家會先睇 final_state,跌/觀望 → 直接 Kelly=0;UP → 跟 avg DD 正常計。

#### 2. Backend `SynthesizerAlgorithm.run()` reorder (Stage 4/5/7 提前)

**改動**: 將 conflict detection (Stage 4) + consensus scoring (Stage 5) + state derivation (Stage 7) 提前到 Step 5 Kelly 之前。原本 Step 5 已經 call `_compute_kelly(verdicts_for_synth)` 但 final_state 仲未計。reorder 之後先計 final_state, 然後 call `_compute_kelly(verdicts_for_synth, final_state)`。

#### 3. Backend emit 3 個 audit field

`meta` 新加:
- `kelly_state_guard_triggered: bool` — 係咪觸發咗 state guard
- `kelly_state_guard_reason: str` — 凡人話解釋 (點解 Kelly=0)

**凡人話**: 大少撳跑 M7 見到 Kelly 顯示 0 倉嗰陣,可以即時睇到「點解 0 倉」嘅 reason(對齊 §M2 self-check penalty 永久 rule `original_confidence` field spirit)。

#### 4. Frontend 1:1 port 落 `modules/synthesizer.ts`

- `computeKelly(verdicts, finalState)` 加 state guard(對齊 backend)
- `synthesize()` reorder 拎 finalState 先, 然後 call computeKelly
- empty input case 加 2 個新 field
- `types.ts` `SynthesizerVerdict` 加 `kelly_state_guard_triggered` + `kelly_state_guard_reason` 2 個新 field
- `types.ts` `KellyFraction` type 加 'zero' union

#### 5. Frontend display 對齊 backend emit

`adapter.mjs`:
- `decisionEngineKellyLabel()` 加 'zero' case → 「零倉 (0%) — state guard 觸發」
- `renderKellyDonut()` 加 'zero' entry(深灰 #666 顏色)

**凡人話**: 大少撳跑 M7 見到 Kelly 餅圖變深灰 0%, 即時知道 state guard 觸發。

### 5 隻 stock verify 結果 (大少 9月12日 trigger 後 verify)

| Stock | final_state | grade | kelly_fraction | state_guard |
|---|---|---|---|---|
| HK.00700 騰訊 | DOWN | C+ | **zero (0%)** | ✅ 觸發 |
| HK.00005 匯豐 | SIDEWAYS | C+ | **zero (0%)** | ✅ 觸發 |
| US.AAPL | SIDEWAYS | C+ | **zero (0%)** | ✅ 觸發 |
| US.MSFT | UP | B | **quarter (25%)** | ❌ 唔觸發 |
| US.GOOGL | SIDEWAYS | B | **zero (0%)** | ✅ 觸發 |

**凡人話 verify 結論**: 4 隻 DOWN/SIDEWAYS verdict 全部 Kelly=0 (對齊 spec doc §7 Grade D/F SELL action), 1 隻 UP (MSFT) 跟 avg DD 正常計 quarter (25%) 倉 ✅

---

## v2.0.0 永久改動 (大少 2026-09-10 23:06 Spec Sync #62, 8-stage architecture)

### 凡人話總結

v2.0.0 由 5 sub-step 拎 SSI / TCM / Alignment / Grade / Kelly 變成 8 stage architecture,
對齊 §M2 self-check weight 折扣 永久 rule generalize + plan v2 §D-§H 6 個 stage 設計。

| Stage | 名 | 凡人話 | 對應 backend 函數 |
|---|---|---|---|
| 1 | Input handling | 拎 6 個 module verdict | (直接 options['moduleVerdicts']) |
| 2 | Signal normalization | M4 8 signal → 3-state mapping | `_normalize_module_verdicts` |
| 3 | Weight discount generalization | 拎 self-check warning 自動降 weight 0.05 | `_apply_weight_discounts` |
| 4 | Conflict detection | UP↔DOWN 矛盾 emit warning | `_detect_conflicts` |
| 5 | Consensus scoring | 67% threshold weighted 共識 | `_compute_consensus` |
| 6 | Kelly + risk | 跟 avg DD 自動切 half/quarter/octo | `_compute_kelly` |
| 7 | State derivation | 共識先重要, 共識唔到先睇簡單多數 | (inline logic) |
| 8 | Verdict assembly | 整合 6 stage output 落 meta + emit warnings | (inline logic + `_aggregate_warnings`) |

### Stage 2 詳情 (Signal normalization)

**拎走 v1.2.0 永久 skip M4 邏輯, 拎方案 A 拎 M4 8 signal 統一 map 落 3-state**

```python
M4_SIGNAL_STATE_MAP: Dict[str, str] = {
    "top_reversal":      "DOWN",       # 見頂 = 跌
    "bottom_reversal":   "UP",         # 見底 = 升
    "macd_golden_cross": "UP",         # 金叉 = 升
    "macd_death_cross":  "DOWN",       # 死叉 = 跌
    "momentum_strong":   "UP",         # 動力強 = 升
    "momentum_weak":     "DOWN",       # 動力弱 = 跌
    "exhausted_neutral": "SIDEWAYS",   # 動能耗盡 = 失方向
    "no_signal":         "SIDEWAYS",   # 冇信號 = 觀望
}
```

對齊 spec doc MODULE-04-INDICATORS.md §2.2 + plan v2 §D。

### Stage 3 詳情 (Weight discount generalization)

**拎任何 module 嘅 self-check warning, 自動降 base_weight 落 0.05, 其他 5 個 normalize 補返, sum 仍 = 1.0**

```python
SELF_CHECK_TRIGGER_CODES = ("FALLBACK_USED", "CONFLICT_STATE", "THRESHOLD_BREACH", "VERDICT_MISSING")
SELF_CHECK_DISCOUNT_TARGET_WEIGHT = 0.05
MODULE_BASE_WEIGHTS = {"ma-alignment": 0.25, "hl-structure": 0.15, "trendline": 0.10, "indicators": 0.10, "volume": 0.10, "volatility": 0.10}
```

對齊永久 rule:
- §M2 self-check weight 折扣 (Spec Sync v0.3.0) generalize 至 M1/M3/M4/M5/M6
- §M3 self-check warning (Spec Sync #45)
- §M4 self-check warning (Spec Sync #52)
- §M5 self-check warning (Spec Sync #58)
- §M6 self-check warning (Spec Sync #54)
- §Module Warning v1.1.0: info level (DATA_AGE) 唔觸發 discount

**v2.0.1 加 category check** (大少 9月11日 confirm fix):
- 拎 self-check trigger code 嗰陣, 額外檢查 warning 嘅 category
- **stock_state category 永遠唔 trigger weight discount** (對齊 §Module Warning v1.1.0 spirit: stock_state 屬 verdict 已經準確只係狀態提示)
- 只對 system category 嘅 self-check warning 觸發 discount
- 凡人話: M1 強跌 CONFLICT_STATE stock_state → 唔扣 M1 weight 0.25, M7 拎 M1 真實信號
- 影響: 對齊 M1 self-check 永久 rule 嘅 3 個 CONFLICT_STATE 條件 (late_stage_topping / late_stage_bottoming / strong_downtrend), 全部 category 改 stock_state

**v2.0.1 加 normalize fallback** (大少 9月11日 confirm fix):
- 5 個 module 全部 self-check 觸發 (other_total == 0) 嗰陣, 拎每個 trigger module 1/n normalize 補返 sum = 1.0
- 凡人話: 強跌股 5 個 module 全部 trigger 嗰陣, 唔可以 sum 0.25, 拎 1/5 = 0.20 平均分
- 對齊 spec invariant: 永遠 sum = 1.0

Backward compat: 保留 m2_discounted / m2_original_weight / m2_discounted_weight 3 個 field (frontend 拎嚟 audit / banner)。

### Stage 4 詳情 (Conflict detection)

**拎每對 UP↔DOWN 直接矛盾, emit 1 個 system CONFLICT_STATE warning**

凡人話: M1 升 + M2 跌 互相打架 → emit warning 畀 banner, 大少睇到即知「呢個 verdict 內部有矛盾」。

對齊 §Module Warning v1.1.0: system category, verdict 可能唔可信。

### Stage 5 詳情 (Consensus scoring)

**拎 67% threshold (≥ 4/6 個 module 同意) 拎 weighted state 共識**

```python
CONSENSUS_THRESHOLD = 0.67
```

凡人話: 6 個 module 入面, 拎 base_weight 加權, 多數 state ≥ 67% 拎 consensus 達成。
共識達成 → 用 consensus_state; 唔達成 → fall back 落 simple_majority_state。

對齊 plan v2 §F 5 stock 對齊表 60% hit rate evidence + 67% threshold recommendation。

### Stage 7 詳情 (State derivation)

**共識先重要, 共識唔到先睇簡單多數**

```python
final_state = (
    consensus["consensus_state"]
    if consensus["consensus_achieved"]
    else consensus["simple_majority_state"]
)
```

凡人話: 拎咗共識就信共識, 冇共識先睇簡單多數。

**v2.0.1 cycleLabel 跟 state 而唔係 grade** (大少 9月11日 confirm fix):
- 拎走 v2.0.0 grade-based 寫法 (A+/A/B+/B/C+/C/D/F 對應 cycleLabel)
- 改 state-based 寫法:
  - `state=UP` → `cycleLabel="綜合看升"`
  - `state=DOWN` → `cycleLabel="綜合看跌"`
  - `state=SIDEWAYS` → `cycleLabel="綜合觀望"`
- 對齊 §M7 Synthesizer spirit: 副校長嘅 label 應該跟老師嘅 state 寫, 唔再睇 grade
- 凡人話: 避免 state=DOWN 但 label=綜合觀望 嘅矛盾 (00981 case)
- 對應 commit: 大少 9月11日 confirm fix 永久 rule

### Stage 8 詳情 (Verdict assembly)

**加 8 個新 meta field + 3 個新 warning 注入點**

**v2.0.1 module_verdicts emit normalized weight** (大少 9月11日 confirm fix):
- 拎走 raw verdict 嘅 base_weight (0.25/0.15/0.10/0.10/0.10/0.10)
- emit normalized weight (對齊 backend 計嘅 discount + normalize)
- 凡人話: frontend 拎到嘅 base_weight 對齊 backend 計嘅, 1 個 source of truth, 避免 raw/discounted 不一致
- 對應 commit: 大少 9月11日 confirm fix 永久 rule

**v2.0.2 frontend display path fix** (大少 9月11日 07:32 trigger):
- frontend `decisionEngineToStandardVerdict` 拎 backend verdict 嘅 `state` / `confidence` 拎錯 path
- 之前拎 `verdict.state` (top level) 永遠 `undefined`, 因為 backend v2.x 5/6 個 module 統一 emit 喺 `verdict.meta.*` 下面 (top level 永遠 None)
- 6 個 module 全部 fallback SIDEWAYS 0, 對齊 backend 唔對, 撳跑 synth 00700 見到 6 個 module 全部「橫行」+「未確認」+ 信心 0, 唯一例外係波動 25% (因為 backend volatility 仍 emit top level)
- 比重 35% / 15% / 20% / 15% / 15% / 10% = 110% 仍拎到, 因為 frontend 拎 `verdict.meta.cycle` (backend M1 emit 喺 meta) + M2-M6 hardcode weight
- **Fix**: 拎 `verdict.meta?.state` / `verdict.meta?.confidence` 優先, fallback top level 對齊 backend v0.1 (volatility 仲 emit top level) + v2.x (其他 5 個統一 emit 喺 meta) 兩個 shape
- 對應 commit: `71b61986` (Fix D)
- 對齊 §M7 v2.0.1 永久 rule spirit「frontend display 永遠對齊 backend verdict shape」
- **Follow-up task** (唔屬於呢次 commit, 屬於 frontend architectural gap): frontend `synthesizerAdapter.analyze` 仍指舊 v1.0.0 `analyzeDecisionEngine`, 唔做 v2.0.0 8-stage architecture, 唔做 v2.0.1 normalize fallback, 6 個 module 嘅 base_weight 加埋 1.10 唔係 1.0, 違反 §M7 v2.0.1 normalize 永久 rule spirit. frontend 應該 migrate 去 `modules/synthesizer.ts` v2.0.0 8-stage synth 對齊 backend.

新 meta field:
- `weight_discounts: List[WeightDiscount]` (Stage 3, 6 個 module 嘅 discount 詳情)
- `conflict_pairs: List[List[str]]` (Stage 4, 矛盾 pairs)
- `conflict_count: int` (Stage 4)
- `consensus_state: str` (Stage 5)
- `consensus_score: float` (Stage 5, 0-1)
- `consensus_achieved: bool` (Stage 5)
- `simple_majority_state: str` (Stage 5, fallback)
- `state_breakdown: dict` (Stage 5, {state: weight_sum, ...})
- `final_state: str` (Stage 7, 對齊 frontend)
- `m2_discounted: bool` (backward compat)
- `m2_original_weight: float` (backward compat)
- `m2_discounted_weight: float` (backward compat)

3 個新 warning 注入點:
- Stage 3: 每個 discount module emit 1 個 stock_state `MODULE_PARTIAL` warning
- Stage 4: 每對 conflict emit 1 個 system `CONFLICT_STATE` warning
- Stage 5: consensus 達成 emit 1 個 stock_state `CONFLICT_STATE` info warning

對齊永久 rule §Module Warning v1.1.0: 統一用 `make_warning()` / `makeWarning()` ModuleWarning object, 15 個 warning code 唔加新 code。

---

## v2.0.0 永久 rule (對齊 §改完先 ask 修正先 Commit 已廢 + §Mavis 自己行有大問題先問)

- ✅ M7 拎方案 A 拎 M4 8 signal → 3-state (Stage 2, 對齊 plan v2 §D + spec doc MODULE-04-INDICATORS.md §2.2)
- ✅ M7 拎任何 module 嘅 self-check warning 自動降 weight 落 0.05 (Stage 3, generalize §M2 永久 rule)
- ✅ M7 拎 UP↔DOWN 矛盾 emit CONFLICT_STATE warning (Stage 4)
- ✅ M7 拎 67% threshold weighted consensus 達成 (Stage 5, 對齊 plan v2 §F)
- ✅ M7 final state = 共識先, 共識唔到先睇簡單多數 (Stage 7)
- ✅ M7 emit 8 個新 meta field + 3 個新 warning 注入點 (Stage 8)
- ✅ Frontend 1:1 port 落 modules/synthesizer.ts v2.0.0 + types.ts SynthesizerVerdict 加 8 個新 field
- ✅ 對齊 §Module Warning v1.1.0: info level 唔觸發 discount, system category emit 落 banner
- ✅ 對齊 §Backend hot-reload: 改 backend 必 restart + curl evidence 確認
- ✅ 對齊 §Algorithm Backend-only + 模組化: 算法喺 server 內部用 nest_asyncio 拎 K 線 + 真 async I/O

### 還原方法

對齊永久 rule §Spec doc 改為「還原方法」, 用 commit SHA 拎返 detailed code:
- 拎 v2.0.0 嘅 detailed code: `git show 76a3c423` (Stage 1+2 Step 1) + `git show d64c4d31` (Stage 3-8 Step 2) + `git show 4eef71f2` (frontend port Step 5)
- 拎 v1.2.0 嘅 code: `git show 76a3c423^` (Step 1 commit parent)
- 拎 v1.0.0 嘅 code: `git show 76a3c423~3` (Step 1 commit grandparent)

---

## 1. 點解呢個 module (Why)

前 6 個 module 各自睇一個維度嘅趨勢:
- M1 均線 / M2 峰谷結構 / M3 趨勢線 → **大方向 (戰略層)**
- M4 動能背馳 / M5 量价 / M6 波動率 → **短線操作 (戰術層)**

呢個 module = **M7 綜合演算法 (Synthesizer)**:
- **M7 (Synthesizer, 本 doc)**: 將 6 個 module 嘅 verdict 翻譯做 A+~F 評級 + 數學最優倉位 (凱利公式)
- **M8 (Decision Engine, `MODULE-08-DECISION-ENGINE.md`)**: 喺 M7 評級之上加決策紀律 — 何時加倉/減倉/食胡、信號新舊、市場波動大嘅守則 + 交易指令卡

> **對應 docx**: `docs/演算法概念SPECS/07多時間框架一致性與極端情緒校準法.docx` (M7 部分)
> **對應 TS 檔**: `algorithms/AS-03-cycle-detection/modules/synthesizer.ts` (M7)
> **對應 tests**: `algorithms/AS-03-cycle-detection/__tests__/synthesizer.test.mjs` (64 個 assertions)
> **對應 adapter**: `algorithms/AS-03-cycle-detection/adapter.mjs` (`synthesizerAdapter`)
>
> **M8 部分 (8 個 finalAction + Trading card + 短期走勢預測 + 人話詳細解讀 + 5 個 adaptive params + L2 cache) 見** `MODULE-08-DECISION-ENGINE.md`

> **大少 2026-08-08 13:30 指示 (Plan A 拆返 M7+M8)**: 之前 sprint 1 合併做 1 個 mega module, 大少澄清「一齊優化」意思係「設計上一起考慮但 implementation 應該分開」, 而家拆返 2 個獨立 module + spec doc:
> - **M7 (Synthesizer)** = 本 doc — 6 個 modules 嘅綜合判定 (SSI + TCM + Alignment + 8 個 Grade + Kelly 倉位)
> - **M8 (Decision Engine)** = `MODULE-08-DECISION-ENGINE.md` — Sprint 2 將加 (finalAction 8 個 + trading card + 短期走勢預測 + 人話詳細解讀 + 5 個 adaptive params + L2 cache)
>
> **大少 2026-08-08 11:39 指示**: 5 個 adaptive params (SSI 戰略層權重 / RSI 情緒權重 / Kelly 倉位分數 / 馬可維茨相關係數 / Hurst 持續反轉 threshold) — 屬於 M8 adaptive params, 見 `MODULE-08-DECISION-ENGINE.md` §adaptive params
>
> **大少 2026-08-08 11:57 指示**: UX 多圖少文字, 顏色對應狀態, 永遠全 Show (將來可收埋個別 section)。
>
> **大少 2026-08-08 13:30 永久 rule (Memory)**: M8 嘅人話詳細解讀 (render function) 必須有 `async generateInterpretation(ctx): Promise<string>` interface, 將來可以 swap 落 LLM call (OpenAI / MiniMax / Kimi)。Sprint 2 而家用 hardcoded template, 大少話「記底日後提我去做返」。

---

## 1. 點解呢個 module (Why)

前 6 個 module 各自睇一個維度嘅趨勢:
- M1 均線 / M2 峰谷結構 / M3 趨勢線 → **大方向 (戰略層)**
- M4 動能背馳 / M5 量价 / M6 波動率 → **短線操作 (戰術層)**

呢個 module = **M7 綜合演算法 (Synthesizer)**:
- **M7 (Synthesizer, 本 doc)**: 將 6 個 module 嘅 verdict 翻譯做 A+~F 評級 + 數學最優倉位 (凱利公式)
- **M8 (Decision Engine, `MODULE-08-DECISION-ENGINE.md`)**: 喺 M7 評級之上加決策紀律 — 何時加倉/減倉/食胡、信號新舊、市場波動大嘅守則 + 交易指令卡

**同其他 module 嘅分別:**
- 唔係獨立指標,而係 **fusion engine**: 接收 M1-M6 嘅 output 做 input
- 加 5 個新維度: SSI 戰略強度 + TCM 戰術交叉驗證 + Alignment 戰略-戰術匹配度 + 信號生命週期 + 動態風險預算
- M7 輸出: **SynthesizerVerdict** (ssi_score + tcm_matrix + alignment_score + grade + kelly_fraction + module_verdicts)
- M8 chain (Sprint 2): 加 finalAction 8 個 + Trading card + 短期走勢預測 + 人話詳細解讀 + 5 個 adaptive params + L2 cache

---

## 2. 跟其他 module 嘅協同

| Module | 角色 | 點用佢 |
|--------|------|--------|
| **M1 (MA Alignment v2.0)** | 戰略層 | 判大方向 (60-100 日) |
| **M2 (HL Structure)** | 戰略層 | 判峰谷結構 (HH/HL/LH/LL) |
| **M3 (Trendline)** | 戰略層 | 判支撐壓力 + 趨勢線斜率 |
| **M4 (Indicators 動能背馳)** | 戰術層 | 判動能背馳 + 6 維情緒雷達 (RSI/%B/乖離率/波動偏度/換手率/連漲跌加速度) |
| **M5 (VolumePrice v2.0)** | 戰術層 | 判量价 + 買入時機 + expected_return / max_drawdown_estimate (凱利公式 input) |
| **M6 (Volatility)** | 戰術層 | 判波動率結構 (Squeeze / VCP / ATR 分解) |
| **M7 (多 TF + 情緒 + Hurst)** | 校準層 | 馬可維茨組合 + 6 維情緒 + Hurst + Kelly + 異議分數 → A+~F 評級 |
| **M8 (終極引擎)** | **核心** | SSI + TCM + Alignment + 生命週期 + 風險預算 → **交易指令卡** |

**關係:** M8 喺 Step 1 **並行調用 M1-M7 全部 7 個 module**, M7 嘅 verdict (A+~F) 會作為 M8 嘅其中一個 input reference, 但 M8 會做**二次校準**(信號太新 = emerging 唔可以重倉)。

---

## 3. 5 個 Adaptive Params (大少 11:39 指示)

呢 5 個 params **唔係 hardcode**, 跟股票特性 auto-calibrate。Stage 1 用 L2 (JSON file cache), Stage 2+ 升 L3 (DB)。

### 3.1 完整列表 (Code 名 + Human 名 + Default + 點 Adaptive)

| # | Code 名 | Human 名 | Default | 點 Adaptive |
|---|---------|----------|---------|------------|
| 1 | `ssiWeights: { ma, hl, trendline }` | **SSI 戰略層權重** | 0.30 / 0.30 / 0.40 | 60 日 K 線計各 module 嘅 R², normalize 加權 |
| 2 | `rsiWeight` | **RSI 情緒權重** | 0.20 | 跟 sentiment 6 維平均分, 預設 0.20 |
| 3 | `kellyFraction` | **Kelly 倉位分數** | 'half' (0.5) | 跟 ATR%: < 2% = 'half', 2-5% = 'quarter', ≥ 5% = 'octo' |
| 4 | `markowitzCorr: { dailyWeekly, dailyMonthly, weeklyMonthly }` | **馬可維茨相關係數** (日-週 / 日-月 / 週-月) | 0.85 / 0.60 / 0.70 | 252 日 K 線計真實 correlation |
| 5 | `hurstThresholds: { persistent, reverting }` | **Hurst 持續/反轉 threshold** | 0.55 / 0.45 | 252 日 Hurst 自身: > 0.6 升, < 0.4 降 |

### 3.2 為什麼要 Adaptive?

**舉例:**
- **騰訊 (HK.00700)**: 低波動大藍籌, Hurst 高 → 持續股, Kelly 用 Half, threshold 提
- **特斯拉 (US.TSLA)**: 高波動, Hurst 變化大 → Kelly 用 Octo (1/8), threshold 降
- **阿里巴巴 (HK.09988)**: 中型股 → default params

如果 hardcode, 騰訊會過度保守(浪費機會), 特斯拉會過度進取(高風險), 都唔啱。

### 3.3 Runtime Auto-calibration 邏輯 (純 Algorithm, 唔需要 AI)

```javascript
function calibrateParams(stockData) {
  const atrPct = calcATR(stockData.last60Days) / stockData.currentPrice;  // 60 日 ATR / 股價
  const hurst = calcHurst(stockData.last252Days);                          // 252 日 Hurst 指數
  const moduleR2 = {
    ma: calcR2(stockData.last60Days, 'ma'),
    hl: calcR2(stockData.last60Days, 'hl'),
    trendline: calcR2(stockData.last60Days, 'trendline'),
  };

  // Rule 1: Kelly 跟 ATR%
  const kellyFraction = atrPct < 0.02 ? 'half' : atrPct < 0.05 ? 'quarter' : 'octo';

  // Rule 2: Hurst threshold 跟持續性
  const hurstThresholds = hurst > 0.6 ? { persistent: 0.6, reverting: 0.4 }
    : hurst < 0.4 ? { persistent: 0.5, reverting: 0.5 }
    : { persistent: 0.55, reverting: 0.45 };

  // Rule 3: SSI 權重跟 R² (高 R² = 高權重)
  const totalR2 = moduleR2.ma + moduleR2.hl + moduleR2.trendline;
  const ssiWeights = {
    ma: 0.30 + (moduleR2.ma / totalR2 - 1/3) * 0.20,
    hl: 0.30 + (moduleR2.hl / totalR2 - 1/3) * 0.20,
    trendline: 0.40 + (moduleR2.trendline / totalR2 - 1/3) * 0.20,
  };
  // normalize 加總 = 1.0

  // Rule 4: 馬可維茨相關係數 (用真實 correlation)
  const markowitzCorr = calcCorrelations(stockData.last252Days);

  // Rule 5: RSI 權重 (預設 0.20, 可調)
  const rsiWeight = 0.20;

  return { ssiWeights, rsiWeight, kellyFraction, markowitzCorr, hurstThresholds };
}
```

**全部純 math, 唔需要 AI:**
- ATR = simple moving average
- Hurst = log linear regression
- R² = simple least squares
- Correlation = Pearson

### 3.4 JSON File Cache (L2, 唔改 backend)

```
~/.stockpulse/adaptive_params/
├── HK.00700.json
├── HK.09988.json
├── US.AAPL.json
└── ...
```

**每個 JSON 內容:**

```json
{
  "symbol": "HK.00700",
  "lastCalibrated": "2026-08-08T11:00:00Z",
  "atrPct": 0.023,
  "hurstExponent": 0.62,
  "moduleR2": { "ma": 0.72, "hl": 0.68, "trendline": 0.75 },
  "ssiWeights": { "ma": 0.32, "hl": 0.28, "trendline": 0.40 },
  "rsiWeight": 0.20,
  "kellyFraction": "half",
  "markowitzCorr": { "dailyWeekly": 0.85, "dailyMonthly": 0.60, "weeklyMonthly": 0.70 },
  "hurstThresholds": { "persistent": 0.6, "reverting": 0.4 }
}
```

### 3.5 Auto + Manual 兩個 Mode

| Mode | 點觸發 | 點做 |
|------|--------|------|
| **Auto (background)** | 第一次跑某股票, 或 cache > 7 日 | 自動 calibrate, 唔需要大少撳 |
| **Manual (按鈕)** | 大少撳「🔄 重新校準」按鈕 | 即時 calibrate, 立即用新 params |

---

## 4. 輸入 (跟 docx §2)

| Field | Type | Required | Default | 說明 |
|-------|------|----------|---------|------|
| `symbol` | string | ✅ | — | 股票代碼 |
| `price_data` | list[dict] | ✅ | — | 日線價格, 按日期升序 |
| `weekly_data` | list[dict] | ❌ | null | 週線價格 (Stage 1 內 mock by 5-day aggregate from daily) |
| `monthly_data` | list[dict] | ❌ | null | 月線價格 (Stage 1 內 mock by 20-day aggregate from daily) |
| `sub_module_signals` | list[dict] | ✅ | — | M1-M6 嘅 verdict 結果 (testing page 自動組裝) |
| `module_accuracy_history` | dict | ❌ | null | 各 module 近期準確率 {ma: 0.72, ...} (Stage 1 hardcode 預設) |
| `market_index_data` | list[dict] | ❌ | null | 大盤指數 (Stage 2 支援) |
| `risk_free_rate` | float | ❌ | 0.02 | 無風險利率 (年化) |
| `max_position_pct` | float | ❌ | 1.0 | 最大倉位上限 |
| `sentiment_dimensions` | list[string] | ❌ | ["rsi", "bb_pct_b", "ma_deviation", "vol_skew", "turnover_extreme", "streak_accel"] | 啟用的情緒維度 |
| `risk_profile` | string | ❌ | "moderate" | "conservative" / "moderate" / "aggressive" |
| `signal_history` | list[dict] | ❌ | [] | 過去 10 日嘅 verdict 結果 (Stage 1 mock) |

**KLine 格式 (跟 docx):**
```typescript
{ date: "2026-07-01", close: 150.5, volume: 25000000 }
```

**Min data:** `MAX(200, 100) = 200` (跟 docx)

---

## 5. 輸出 (跟 docx §3 交易指令卡 v2.0)

```typescript
interface DecisionEngineVerdict {
  symbol: string;
  decisionDate: string;                                  // 判決日期
  finalAction: 'BUY' | 'ADD' | 'HOLD' | 'REDUCE' | 'SELL' | 'WAIT';
  actionLabel: string;                                    // 中文動作
  signalLifecycle: 'emerging' | 'confirmed' | 'mature' | 'decaying';
  confidence: number;                                     // 0.0 ~ 1.0
  confidenceStability: number;                            // 連續一致性 0.0 ~ 1.0
  grade: 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F';
  strategicStrengthIndex: number;                          // SSI -1.0 ~ 1.0
  tacticalConfirmationScore: number;                       // TCS 0.0 ~ 1.0
  alignmentScore: number;                                 // 戰略-戰術匹配 -1.0 ~ 1.0
  consensusMomentum: 'improving' | 'stable' | 'deteriorating';
  positionSizePct: number;                                // 0.0 ~ 100.0
  positionAction: 'open_new' | 'add_to_winner' | 'hold' | 'trim' | 'close';
  entryZone: { low: number, high: number };               // 入場區間
  stopLoss: number;                                       // 止損價
  takeProfit: number;                                     // 目標價
  trailingStop: number;                                   // 移動止損
  riskRewardRatio: number;                                // 風險回報比
  riskBudgetUsed: number;                                 // 使用風險預算 0.0 ~ 1.0
  decisionPath: string[];                                 // 決策路徑追溯 (人話)
  warnings: string[];                                     // 風險警告
  fullReport: {                                           // 完整原始輸出 (Stage 1 debug 用)
    m1: ...,
    m2: ...,
    m3: ...,
    m4: ...,
    m5: ...,
    m6: ...,
    m7: ...,
    ssi: { ... },
    tcs: { ... },
    alignment: { ... },
    kellyPosition: { ... },
    adaptiveParams: { ... },
  };
  reason: string;                                         // 綜合判斷理由 (人話)
  lastDate: string;
}
```

**State mapping (testing page):**
- `BUY` → 🟢 買入 / `ADD` → 🟢 加倉 / `HOLD` → 🟡 持有 / `REDUCE` → 🟡 減倉 / `SELL` → 🔴 賣出 / `WAIT` → ⚪ 觀望

---

## 6. Algorithm 步驟 (合併 M7 10 步 + M8 6 步, 簡化版)

### Step 0: 輸入驗證
- 檢查 `price_data.length >= 200`
- 檢查日期升序
- 檢查 adaptive_params JSON file (有就 load, 冚就 auto-calibrate)

### Step 1: 並行調用 M1-M6 + M7 (testing page 自動組裝)
- M1-M3 戰略層
- M4-M6 戰術層
- M7 校準層 (用 M1-M6 嘅 output 做 sub_module_signals)

### Step 2: SSI 戰略強度指數 (M8 Step 2)
```javascript
const strategicModules = [m1, m2, m3];
const ssiWeights = adaptiveParams.ssiWeights;  // 跟股票特性 auto-calibrate
let ssiBull = 0, ssiBear = 0, ssiTotal = 0;
for (const mod of strategicModules) {
  const w = ssiWeights[mod.moduleName];
  const conf = mod.confidence;
  if (mod.cycle === 'uptrend') { ssiBull += w * conf; ssiTotal += w; }
  else if (mod.cycle === 'downtrend') { ssiBear += w * conf; ssiTotal += w; }
  else { /* sideways: 信心低分配兩邊 */ }
}
const ssiNet = (ssiBull - ssiBear) / ssiTotal;

// 趨勢質量 bonus: 一致性
const uniqueCycles = new Set(strategicModules.map(m => m.cycle));
const consistencyBonus = uniqueCycles.size === 1 ? 1.15 : uniqueCycles.size === 2 ? 0.90 : 0.70;
const ssi = clamp(ssiNet * consistencyBonus, -1, 1);
```

### Step 3: TCM 戰術交叉驗證矩陣 (M8 Step 3)
```javascript
const tacticalModules = { momentum: m4, volume: m5, volatility: m6 };
// 提取各 module 嘅動作傾向
const t4 = m4.signal.type === 'buy' ? 'buy' : m4.signal.type === 'sell' ? 'sell' : 'hold';
const t5 = m5.buyTimingScore >= 0.5 ? 'buy' : m5.buyTimingScore < 0.2 ? 'sell' : 'hold';
const t6 = m6.entryTiming.score >= 0.6 ? 'buy' : m6.entryTiming.score < 0.3 ? 'sell' : 'hold';
// 兩兩驗證 → confirmations / conflicts → TCS 0-1
// 特殊降級: 動能買但量未跟 (虛漲 × 0.6), Squeeze Fire 但量派發 (假突破 × 0.3)
```

### Step 4: Alignment Score 戰略-戰術匹配度 (M8 Step 4)
```javascript
const alignment = 1.0 - Math.abs(ssi - tacticalNet);
// 戰略強多 + 戰術空 + 回調健康 = 0.7 (回調買點)
// 戰略強多 + 戰術空 + 回調唔健康 = 0.3 (轉勢警告)
```

### Step 5: 信號生命週期 (M8 Step 5)
```javascript
// 連續 N 日同向 = mature (可重倉)
// emerging (0-40%) / confirmed (40-70%) / mature (>70%)
// 共識動量: improving / stable / deteriorating
```

### Step 6: 動態風險預算 + 自適應門檻 (M8 Step 6)
```javascript
// SSI 越高, 允許戰術操作越激進
const riskBudget = ssi >= 0.7 ? 1.0 : ssi >= 0.4 ? 0.7 : ssi >= 0.2 ? 0.4 : 0.1;
// 門檻跟 ATR% 動態調整
const adaptiveThreshold = baseThreshold * (1 + atrPct * 5);
```

### Step 7: 多時間框架組合 + 馬可維茨 (M7 Step 1-2)
```javascript
// 日/週/月 3 個 timeframe 跑 M1 簡化版
// 用 markowitzCorr 真實 correlation 算最優權重
// 找夏普比率最高嘅 weights 組合
```

### Step 8: 六維情緒雷達 (M7 Step 3)
```javascript
// RSI + %B + 乖離率 + 波動偏度 + 換手率 + 連漲跌加速度
// 6 維 sentiment score 0-1
```

### Step 9: Hurst 指數 + 週期疲勞 (M7 Step 4)
```javascript
// Hurst > persistent threshold = 趨勢持續
// Hurst < reverting threshold = 即將反轉
// 疲勞分數: Hurst 下降 + 週期長 = 高疲勞
```

### Step 10: 動態貝葉斯共識 + 異議分數 (M7 Step 5)
```javascript
// 動態權重: 歷史準確率高嘅 module 升權
// 半衰期衰減: 越老信號降權
// 異議分數: 假共識陷阱檢測
```

### Step 11: 尾部風險指標 (M7 Step 6)
```javascript
// 偏度 (Skewness) + 峰度 (Kurtosis) + 最大回撤預估
// tail_risk_score 0-1
```

### Step 12: 三情景綜合校準 (M7 Step 7)
```javascript
// 樂觀 / 基準 / 悲觀 三情景置信區間
// Sentiment + Hurst + 疲勞 + 異議 + 尾部風險 校準
```

### Step 13: 凱利公式倉位 (M7 Step 8)
```javascript
// f* = (p*b - q) / b
// 跟 adaptive Kelly fraction policy (half / quarter / octo)
```

### Step 14: 最終評級 (M7 Step 9)
```javascript
// A+ / A / B+ / B / C+ / C / D / F
// 跟 baseline_score + sentiment level
```

### Step 15: 交易指令卡 (M8 Step 7)
```javascript
// 動態決策樹: 覆蓋所有 SSI/TCS/Alignment 組合
// finalAction: BUY / ADD / HOLD / REDUCE / SELL / WAIT
// position_size_pct: 跟 lifecycle + risk_budget
// entry_zone / stop_loss / take_profit / trailing_stop
// 全部用 ATR × 0.5/1.0/1.5 fixed formula
```

### Step 16: 決策路徑追溯 (M8 Step 10)
```javascript
// decisionPath: 每一步人話解釋
// e.g. "Step 2: SSI = 0.75 (強勢上升, M1-M3 一致)" → "Step 3: TCS = 0.7 (M4 買但量未跟, 降級)" → ...
```

### Step 17: 組裝輸出
- 全部 fields 整合成 `DecisionEngineVerdict`
- testing page 自動 render 交易指令卡 (大少 UX 設計: 多圖少文字, 顏色對應狀態)

---

## 7. Cycle State 判定 (8 個)

| State | 顏色 | 意思 | 對應評級 |
|-------|------|------|---------|
| `BUY` (買入) | 🟢 綠 | 強勢上升 + 戰術確認 + 高 alignment | A+ / A |
| `ADD` (加倉) | 🟢 綠 | 已有倉 + 信號成熟 (mature lifecycle) | A / B+ |
| `HOLD` (持有) | 🟡 黃 | 觀望, 信號唔夠強 | B / C+ |
| `REDUCE` (減倉) | 🟡 黃 | 信號 decaying + momentum deteriorating | C / D |
| `SELL` (賣出) | 🔴 紅 | 強勢下跌 + 戰術確認 | D / F |
| `WAIT` (觀望) | ⚪ 灰 | 數據不足 / 信號衝突 | — |
| `TRAP` (陷阱警告) | 🟣 紫 | 假共識檢測觸發 | — (附加警告) |
| `TRANSITION` (轉折) | 🟣 紫 | 5 日內趨勢可能反轉 | — (附加警告) |

---

## 8. 邊界條件 (跟 docx §6)

| 情境 | 處理 |
|------|------|
| 數據不足 (price_data < 200) | 拋 error, 提示「需要至少 200 條日線」 |
| weekly_data null | Mock: 從 daily 5 日 aggregate (Stage 1) |
| monthly_data null | Mock: 從 daily 20 日 aggregate (Stage 1) |
| Hurst 計算失敗 (R² < 0.3) | hurst = 0.5, 標記 random_walk |
| 無 sub_module_signals | 僅用時間框架 + 情緒雷達, Kelly 用默認 b=1.5 |
| 凱利計算為負 | recommended = 0, 建議 WAIT |
| 6 維情緒部分維度缺失 | 缺失維度用 0.5 (中性) 填充 |
| 馬可維茨組合方差 = 0 | 默認權重 [0.2, 0.5, 0.3] |
| adaptive_params JSON 缺失 + 第一次跑 | 自動 calibrate, 儲落 `~/.stockpulse/adaptive_params/<symbol>.json` |
| adaptive_params JSON > 7 日 | 自動重新 calibrate |

---

## 9. Adaptive Params 嘅 Runtime Auto-calibration 詳細

### 9.1 計股票特性

| Metric | 公式 | Window | 用途 |
|--------|------|--------|------|
| `atrPct` | `ATR(60) / currentPrice` | 60 日 | Kelly fraction + 風險預算 |
| `hurstExponent` | log linear regression on price changes | 252 日 | Hurst threshold 自適應 |
| `moduleR2` | 線性擬合度 (M1/M2/M3 各自) | 60 日 | SSI 權重自適應 |
| `markowitzCorr` | Pearson correlation (3 對) | 252 日 | 馬可維茨權重 |

### 9.2 Rules 對照表

| 股票特性 | Range | Rule | 結果 |
|---------|-------|------|------|
| **ATR%** | < 2% | 低波動 | `kellyFraction: 'half'` (0.5) |
| | 2-5% | 中波動 | `kellyFraction: 'quarter'` (0.25) |
| | ≥ 5% | 高波動 | `kellyFraction: 'octo'` (0.125) |
| **Hurst** | > 0.6 | 持續股 | `hurstThresholds: { persistent: 0.6, reverting: 0.4 }` |
| | 0.4-0.6 | 中性 | `hurstThresholds: { persistent: 0.55, reverting: 0.45 }` (default) |
| | < 0.4 | 反轉股 | `hurstThresholds: { persistent: 0.5, reverting: 0.5 }` |
| **R² 排名** | R² 最高 | 加權 0.4 | `ssiWeights.topR2 = 0.4` |
| | R² 中 | 加權 0.30 | `ssiWeights.midR2 = 0.30` |
| | R² 最低 | 加權 0.30 | `ssiWeights.lowR2 = 0.30` |

### 9.3 JSON File Format

```typescript
interface AdaptiveParams {
  symbol: string;
  lastCalibrated: string;          // ISO timestamp
  atrPct: number;
  hurstExponent: number;
  moduleR2: { ma: number; hl: number; trendline: number };
  ssiWeights: { ma: number; hl: number; trendline: number };
  rsiWeight: number;
  kellyFraction: 'full' | 'half' | 'quarter' | 'octo';
  markowitzCorr: { dailyWeekly: number; dailyMonthly: number; weeklyMonthly: number };
  hurstThresholds: { persistent: number; reverting: number };
}
```

**File path:** `~/.stockpulse/adaptive_params/<symbol>.json`

---

## 10. Testing Page 3 個 Sections (永久 Rule, 大少 #11056)

**永遠全 Show, 將來可 hide 個別 section (大少 11:57 指示)**

### 📖 詳細解讀
- 全部 23 個 output fields 解釋
- 5 個 adaptive params 解釋
- 倉位建議解釋
- 入場區間解釋
- Stop Loss / Take Profit 計算

### 🎯 策略建議
- 按 finalAction 各自建議
- BUY → 「強烈買入, 跟 Kelly 倉位」
- ADD → 「加倉, 信號成熟」
- HOLD → 「持有, 等待下一個信號」
- REDUCE → 「減倉, 信號老化」
- SELL → 「賣出, 確認下跌趨勢」
- WAIT → 「觀望, 數據不足或信號衝突」

### 💡 點用點睇
- 10 步 step-by-step guide
- 對比 M1-M6 結果
- 配合 risk_profile 嘅建議
- 何時手動 override params

---

## 11. UX 設計 (大少 11:57 指示: 多圖少文字, 顏色對應狀態)

### 11.1 顏色系統 (永久 rule)

| 顏色 | Hex | 意思 |
|------|-----|------|
| 🟢 綠 | `#26BA75` | 強勢上升 / BUY / 確認 |
| 🟡 黃 | `#F39C12` | 觀望 / HOLD / 中性 |
| 🔴 紅 | `#EE5151` | 強勢下跌 / SELL / 警告 |
| 🔵 藍 | `#1890ff` | 資訊性 / 中性 / 數據 |
| 🟣 紫 | `#722ed1` | 陷阱 / 矛盾 / TRANSITION |
| ⚫ 深灰 | `#666` | 唔適用 / N/A |

### 11.2 結果 Panel Layout (永遠全 Show)

```
┌─────────────────────────────────────────────────────────────┐
│  📦 終極綜合判斷引擎 v2.0 (Ultimate Decision Engine)            │
│  [08 — AS-03-ENG]                                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─ 🎯 頂部 verdict card (永遠 show) ─────────────────────┐  │
│  │                                                         │  │
│  │   ╔══════════════╗  ╔══════════╗  ╔══════════════╗    │  │
│  │   ║   🟢 BUY     ║  ║    A+    ║  ║  50% 倉位   ║    │  │
│  │   ║   強烈買入   ║  ║  信心 85% ║  ║  Kelly Half ║    │  │
│  │   ╚══════════════╝  ╚══════════╝  ╚══════════════╝    │  │
│  │                                                         │  │
│  │   戰略強度 SSI: 0.75 戰術確認 TCS: 0.70  匹配度: 0.85  │  │
│  │   信號生命週期: mature  風險預算使用: 60%                │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ 📊 6 個 Metric Mini-Cards (永遠 show) ───────────────┐  │
│  │  ┌────┐  ┌────┐  ┌────┐  ┌────┐  ┌────┐  ┌────┐    │  │
│  │  │SSI │  │TCS │  │Align│ │Cycle│ │Kelly│ │Risk │    │  │
│  │  │0.75│  │0.70│  │0.85 │ │📈mat│ │Half │ │60% │    │  │
│  │  └────┘  └────┘  └────┘  └────┘  └────┘  └────┘    │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ 📈 4 個 SVG Chart (永遠 show) ──────────────────────┐  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐    │  │
│  │  │ Sentiment  │  │ Timeframe  │  │ Trend      │    │  │
│  │  │ Radar      │  │ Alignment  │  │ Comparison │    │  │
│  │  │ (6 維)     │  │ (stacked)  │  │ (bar)      │    │  │
│  │  └────────────┘  └────────────┘  └────────────┘    │  │
│  │  ┌────────────┐                                       │  │
│  │  │ Position   │                                       │  │
│  │  │ Donut      │                                       │  │
│  │  └────────────┘                                       │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ 📋 詳細資料 (collapsible, 預設展開) ─────────────────┐  │
│  │  倉位建議表格                                          │  │
│  │  Entry Zone: 150-155  Stop Loss: 145  TP: 165          │  │
│  │  Trailing Stop: 158  Risk/Reward: 2.5:1                │  │
│  │  ⏱️ Trailing Stop 隨股價上升而上移                      │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ 🛤️ 決策路徑 (timeline, collapsible) ─────────────────┐  │
│  │  Step 1: M1-M3 一致上升, SSI = 0.75                     │  │
│  │  Step 2: M4-M5 確認, 但 M6 觀望, TCS = 0.70             │  │
│  │  Step 3: 戰略戰術匹配, Alignment = 0.85                  │  │
│  │  ... 8 steps ...                                        │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ 🔧 5 個 Adaptive Params (collapsible) ──────────────┐  │
│  │  ATR%: 2.3%  Hurst: 0.62  Module R²: ma=0.72 hl=0.68  │  │
│  │  SSI 權重: ma=0.32 hl=0.28 trendline=0.40              │  │
│  │  Kelly: half  Hurst Threshold: 0.6/0.4                  │  │
│  │  [🔄 重新校準]  [✏️ 自定義]                            │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ 📖 詳細解讀 (3 個 section之一, 永久) ───────────────┐  │
│  │  ... 23 個 output fields 解釋 ...                        │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ 🎯 策略建議 (永久) ─────────────────────────────────┐  │
│  │  按 finalAction 各自建議                                │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ 💡 點用點睇 (永久) ─────────────────────────────────┐  │
│  │  10 步 step-by-step guide                              │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ 🔧 技術細節 (collapsible, 預設收埋) ───────────────┐  │
│  │  fullReport JSON (raw output)                          │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ ⚠️ 風險警告 (如有) ─────────────────────────────────┐  │
│  │  ⚠️ Squeeze Fire 但量顯示派發, 假突破警告              │  │
│  │  ⚠️ 信號歷史不足, 連續一致性可靠性下降                │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 11.3 10 個 SVG Chart 設計

| # | Chart | Type | 數據來源 | 顏色 |
|---|-------|------|---------|------|
| 1 | **大型 State-Pill** | HTML div | finalAction | 狀態色 |
| 2 | **6 個 Metric Mini-Cards** | HTML grid | SSI/TCS/Alignment/Lifecycle/Kelly/Risk | 狀態色 |
| 3 | **Sentiment Radar** | SVG 6 維 | sentiment_radar 6 維 | 綠高/紅低 漸層 |
| 4 | **Timeframe Alignment Stacked Bar** | SVG | markowitz weights | 綠升/紅跌/灰橫 |
| 5 | **Trend Comparison Horizontal Bar** | SVG | SSI/Tactical/Consensus | 對比色 |
| 6 | **Position Size Donut** | SVG | kelly_position.recommended | Kelly fraction 顏色 |
| 7 | **Signal Lifecycle Timeline** | HTML cards | lifecycle 4 個 stage | 4 個階段色 |
| 8 | **Risk Budget Gauge** | SVG 半圓 | risk_budget_used | 綠/黃/紅 漸層 |
| 9 | **Decision Path Timeline** | HTML cards | decisionPath array | 每 step 結果色 |
| 10 | **評級 A+~F Letter Card** | HTML div | grade | A+ 綠 / A 淺綠 / B+ 黃綠 / B 黃 / C+ 橙 / C 深橙 / D 紅 / F 深紅 |

### 11.4 將來收埋個別 Section (大少 11:57 指示)

**Strategy:**
- 每個 section 有 `data-section="sentiment"` 等 attribute
- 加 toggle button 控制
- CSS `display: none` 即時收埋
- 唔需要重寫 layout

**將來 frontend 改:**
```css
.section-sentiment { display: none; }  /* 收埋 sentiment chart */
.section-decision-path { display: none; }  /* 收埋 decision path */
```

---

## 12. 範例 (跟 docx §7 + 5 個 adaptive params)

### 12.1 HK.00700 騰訊 (穩定大藍籌, 預期參數)

**Input (60 日 K 線 + 252 日 K 線):**
- ATR%: 1.8% (低)
- Hurst: 0.65 (持續股)
- M1 R²: 0.75, M2 R²: 0.70, M3 R²: 0.78

**Auto-calibrated params:**
- `kellyFraction: 'half'` (0.5, ATR% < 2%)
- `hurstThresholds: { persistent: 0.6, reverting: 0.4 }` (Hurst > 0.6)
- `ssiWeights: { ma: 0.31, hl: 0.28, trendline: 0.41 }` (M3 R² 最高)
- `rsiWeight: 0.20` (default)
- `markowitzCorr: { dailyWeekly: 0.87, dailyMonthly: 0.62, weeklyMonthly: 0.72 }` (騰訊真實 correlation)

**Output:**
- `finalAction: 'BUY'`
- `grade: 'A'`
- `confidence: 0.82`
- `positionSizePct: 50%` (Kelly Half)
- `entryZone: 380-388`
- `stopLoss: 370`
- `takeProfit: 405`
- `riskRewardRatio: 2.5`

### 12.2 US.TSLA 特斯拉 (高波動, 預期保守參數)

**Auto-calibrated params:**
- `kellyFraction: 'octo'` (0.125, ATR% > 5%)
- `hurstThresholds: { persistent: 0.5, reverting: 0.5 }` (Hurst 變化大)
- `ssiWeights: { ma: 0.30, hl: 0.30, trendline: 0.40 }` (default)

**Output (如果 BUY):**
- `finalAction: 'BUY'`
- `grade: 'B+'` (信號夠但波動大, 降評級)
- `positionSizePct: 12.5%` (Kelly Octo)
- `riskRewardRatio: 3.0` (要求更高 R:R 因為波動大)

---

## 13. Tests 規劃

`__tests__/decision-engine.test.mjs` 20+ tests, 30+ assertions:

| # | Test | 描述 | Assertions |
|---|------|------|------------|
| T1 | Input 驗證 | price_data < 200 拋 error | 1 |
| T2 | Auto-calibrate 第一次跑 | 自動產生 JSON, 5 個 params 都 set | 5 |
| T3 | Auto-calibrate JSON cache | 第二次跑, 讀 cache, 唔再 calibrate | 2 |
| T4 | Manual 重新校準按鈕 | 即時 calibrate, 覆寫 JSON | 2 |
| T5 | SSI 一致 (3 module 全部 uptrend) | consistency_bonus = 1.15 | 1 |
| T6 | SSI 矛盾 (3 module 全部唔同 cycle) | consistency_bonus = 0.70 | 1 |
| T7 | TCM 三劍客一致 (confirmations = 3) | tcs = 1.0 | 1 |
| T8 | TCM 動能買但量未跟 (虛漲) | tcs × 0.6 | 1 |
| T9 | TCM Squeeze Fire 但量派發 (假突破) | tcs × 0.3 | 1 |
| T10 | Alignment 完美匹配 (SSI = tactical_net) | alignment = 1.0 | 1 |
| T11 | Alignment 戰略強多 + 戰術空 + 回調健康 | alignment = 0.7 (回調買點) | 1 |
| T12 | Alignment 戰略強多 + 戰術空 + 回調唔健康 | alignment = 0.3 (轉勢警告) | 1 |
| T13 | Lifecycle emerging (連續 0-40%) | lifecycle = 'emerging' | 1 |
| T14 | Lifecycle mature (連續 >70% + momentum 唔 deteriorating) | lifecycle = 'mature' | 1 |
| T15 | Lifecycle decaying (連續 >70% + momentum deteriorating) | lifecycle = 'decaying' | 1 |
| T16 | Risk budget 強趨勢 (SSI >= 0.7) | risk_budget = 1.0 | 1 |
| T17 | Risk budget 弱趨勢 (SSI 0.2-0.4) | risk_budget = 0.4 | 1 |
| T18 | Kelly ATR% < 2% | kellyFraction = 'half' | 1 |
| T19 | Kelly ATR% > 5% | kellyFraction = 'octo' | 1 |
| T20 | Hurst > 0.6 升 threshold | persistent = 0.6, reverting = 0.4 | 1 |
| T21 | Hurst < 0.4 降 threshold | persistent = 0.5, reverting = 0.5 | 1 |
| T22 | Grade A+ (baseline >= 0.75 + extreme_fear) | grade = 'A+' | 1 |
| T23 | Grade F (baseline < -0.6) | grade = 'F' | 1 |
| T24 | Final action BUY 強信號 | finalAction = 'BUY' | 1 |
| T25 | Final action SELL 強信號 | finalAction = 'SELL' | 1 |
| T26 | Trading card entry_zone / SL / TP 計算 | 全部 positive numbers | 3 |
| T27 | Decision path 至少 5 個 step | decisionPath.length >= 5 | 1 |
| T28 | Mock timeframe (1w from daily 5-day agg) | 數據格式正確 | 2 |

**Total: 30+ assertions ✅**

**5 隻港股 + 5 隻美股 test data:**
- T29-T33: HK.00700 / 09988 / 03690 / 01024 / 01810 嘅 K 線 mock (各自 100 條)
- T34-T38: US.AAPL / MSFT / GOOG / NVDA / TSLA 嘅 K 線 mock (各自 100 條)
- Total: 10 個股票 + 各 2 assertions = 20 assertions

**Grand Total: 50+ assertions ✅**

---

## 14. Permanent Rules (永久)

- ✅ Rule-based + adaptive, 唔用 multiplicative
- ✅ List all matched modules, 唔好 silently pick 一個
- ✅ 5 個 adaptive params runtime auto-calibrate, 唔係 hardcode
- ✅ JSON file cache (L2) 喺 `~/.stockpulse/adaptive_params/<symbol>.json`
- ✅ 7 個 cycle states (BUY/ADD/HOLD/REDUCE/SELL/WAIT/TRAP/TRANSITION)
- ✅ 8 個 grade (A+/A/B+/B/C+/C/D/F)
- ✅ 永遠全 Show (大少 11:57 指示), 將來可 hide 個別 section
- ✅ 多圖少文字, 顏色對應狀態 (大少 11:57 指示)
- ✅ 3 sections 永久 rule (📖 詳細解讀 + 🎯 策略建議 + 💡 點用點睇)
- ✅ 數據 < 200 條 → 拋 error
- ✅ Auto + Manual 兩個 mode (background auto + Testing page 按鈕 manual)
- ✅ Algorithm-only, 唔需要 AI (Stage 1)

---

## 15. Spec 連結 + Permanent Reference

- **對應 docx M7**: `docs/演算法概念SPECS/07多時間框架一致性與極端情緒校準法.docx` (Kimi v2.0 spec)
- **對應 docx M8**: `docs/演算法概念SPECS/08終極綜合判斷引擎.docx` (Kimi v2.0 spec)
- **對應 TS 檔**: `algorithms/AS-03-cycle-detection/modules/decision-engine.ts`
- **對應 tests**: `algorithms/AS-03-cycle-detection/__tests__/decision-engine.test.mjs`
- **對應 adapter**: `algorithms/AS-03-cycle-detection/adapter.mjs` (`decisionEngineAdapter`)
- **Adaptive params cache**: `~/.stockpulse/adaptive_params/<symbol>.json`
- **舊 M7 spec (zmen均算法 spec file)**: `docs/research/AS-03-cycle-detection/ZMEN-MA-ALIGNMENT.md` (不變, 抽離獨立)
- **Roadmap**: `docs/research/AS-03-cycle-detection/ROADMAP.md` §2 Stage 1 排序表 (M7+M8 done, Stage 1 收官)

---

## 16. Changelog

| Date | Version | 改動 | Commit |
|------|---------|------|--------|
| 2026-08-08 | v2.0.0 | 新 module 設計 — M7+M8 合併做 1 個 mega module, 5 個 adaptive params, runtime auto-calibrate + JSON cache, UX 多圖少文字永遠全 Show | TBD (commit after implementation) |
| 2026-08-08 | — | 大少 11:22: 合併 M7 + M8 1 個 mega module, 1 個 testing page entry | spec doc |
| 2026-08-08 | — | 大少 11:39: 5 個 adaptive params auto-calibrate (L2 JSON cache) | spec doc |
| 2026-08-08 | — | 大少 11:57: UX 多圖少文字, 永遠全 Show, 顏色對應狀態 | spec doc |
| 2026-08-08 | v2.0.0 (M7 part) | **Sprint 1 done** — M7 Synthesizer 邏輯 impl (SSI + TCM + Alignment + 8 個 Grade + Kelly 倉位), spec + impl + tests + adapter + testing page 全部上線 (5 commits, +2032 lines, 64 個新 test assertions) | `2acab95d` `f991d9db` `4b8b64fe` `e96f673f` |
| TBD | v2.0.0 (M8 part) | Sprint 2 範圍 — M8 Decision Engine 邏輯 (finalAction 8 個 + trading card + 5 個 adaptive params runtime auto-calibrate + L2 JSON cache + 10 個 SVG chart) | TBD |
| 2026-08-15 | v2.1.0 | **M7 優化 Level 1-6 — 全用上 M1 嘅 14 個 field** (大少 2026-08-15 trigger: 既然 M1 進化了, 那 M7 也應該要優化好好利用 M1 的所有資料)<br>- **Level 2 — M1 動態 base_weight**: 強趨勢 (mid_stage) 0.35, 弱趨勢 (tentative) 0.20, 過渡形態 0.22, 警號 (late_stage) 0.18, 悶市 (range_bound) 0.15, 默認 0.25 (改咗原本固定 0.25)<br>- **Level 3 — 3 條 M1 expert rules override**: (1) decelerating_up + consecutiveDays ≥ 5 → M7 加 TRANSITION 警號 (見頂跡象, 即使其他 module 仲見 UP); (2) decelerating_down + consecutiveDays ≥ 5 → M7 加 TRANSITION 警號 (見底跡象); (3) strong_uptrend/downtrend + conf ≥ 0.8 + 全部 MA slope 同方向 → M1 weight 加到 0.40 (高信心強趨勢 super weight)<br>- **Level 4 — 2 條 cross-module alignment enrich**: (1) M1 cycle UP + momentumScore<0 → 額外扣 alignment 5% (短期動能背馳); (2) M1 cycle DOWN + momentumScore>0 → 額外扣 alignment 5%; (3) M1 volumeSignal expanding + M5 volRatio<0.8 → 額外扣 alignment 5% (量能矛盾); (4) M1 volumeSignal shrinking + M5 volRatio>1.2 → 額外扣 alignment 5%<br>- **Level 1+5+6 — M7 凡人話 reasoning enrich**: synthSummaryPanel 拎 M1 cycleLabel/cyclePositionLabel/consecutiveDays, 之前係 generic state, 而家「M1 強上升趨勢 (mid_stage, 連升 N 日)」精準描述<br>- **凡人話 design**: M1 拎 cycle + position + consecutive + adjustment, 其他 module 拎自己 detail, 唔再係 generic「結構模糊」 | TBD |

---

## 17. Sprint 1 Implementation Notes (大少 2026-08-08 12:30)

### 17.1 Sprint 1 Scope

Sprint 1 (4-5 日) 範圍:
- ✅ **Sub-task 1.1** — 6 個 modules 加 standard verdict interface (base_weight / expected_return / max_drawdown_estimate / sentiment_6d)
- ✅ **Sub-task 1.2** — M7 Synthesizer 邏輯 impl (SSI + TCM + Alignment + 8 個 Grade + Kelly)
- ✅ **Sub-task 1.3** — M7 tests (64 個 assertions, 16 sections)
- ✅ **Sub-task 1.4** — decisionEngineAdapter + testing page 整合 (08 — AS-03-ENG 從 disabled 變 enabled)
- ✅ **Sub-task 1.5** — Sprint 1 Implementation Notes 落 spec doc + 更新其他 spec files

### 17.2 Sprint 1 改動 (5 commits)

| Commit | 內容 |
|--------|------|
| `e96f673f` | `feat(as03-m7-prep): 6 個 modules 加 standard verdict interface 為 M7 Synthesizer 準備` (12 files, +878/-21) |
| `4b8b64fe` | `feat(as03-m7): M7 Synthesizer 邏輯 impl (SSI + TCM + Alignment + Grade + Kelly)` (3 files, +385/-1) |
| `f991d9db` | `test(as03-m7): M7 Synthesizer (DecisionEngine) 64 個 tests, 16 sections` (1 file, +344) |
| `2acab95d` | `feat(as03-m7-adapter): M7 Synthesizer adapter + testing page enable 08 — AS-03-ENG` (2 files, +485/-10) |
| TBD (sub-task 1.5c) | `docs(sync): Sprint 1 spec + doc 同步 (M7 Synthesizer v2.0 done, Sprint 2 M8 pending)` |

### 17.3 設計 decisions (跟 spec)

| Decision | 選擇 | 理由 |
|----------|------|------|
| Grade 8 個 (A+~F) vs 5 個 (A~F) | **8 個** | 跟 spec §6.2 寫明, 8 級更細分 |
| Kelly fraction (0.5/0.25/0.125) vs percentage | **fraction** | Math 較自然 (avg DD × 3 計算) |
| Module weight static vs dynamic | **static** | 5 個 adaptive params auto-calibrate 留俾 Sprint 2 M8 |
| TCM 3 對 pair | (MA, TL), (HL, VP), (IND, VOL) | 跟 spec §3, 形態+趨勢/形態+量能/情緒+波動 |
| Alignment Score formula | max_group_size / total_count | 比 SSI consistency 更直觀 (0-1 range) |
| Grade score formula | ssi_score × 0.6 + alignment × 100 × 0.4 | SSI 60% + Alignment 40% (跟 spec §6.4) |
| Grade boundary inclusive | `grade_score >= 90` 係 A+ | 包含 boundary, 50 → C+, 90 → A+ |
| CycleState 加 'TRAP' | 6 個 modules 唔 return, M7/M8 推導 | Type system 支持但實際由 M7/M8 設置 |

### 17.4 5 個 sub-step 邏輯 (詳細)

#### Step 1: SSI 戰略強度指數
- `consistency = max(state_count) / total_count` (0-1)
- `confidence_avg = Σ(confidence × base_weight) / Σ(base_weight)` (0-1, 加權平均)
- `rules_coverage = min(1, unique_rules / 20)` (0-1)
- `ssi_score = consistency × 50 + confidence_avg × 30 + rules_coverage × 20` (0-100)

#### Step 2: TCM 戰術交叉驗證矩陣
- 3 對 pair: (ma-alignment, trendline), (hl-structure, volume), (indicators, volatility)
- 每對 `alignment`:
  - state 相同 → +1
  - 矛盾 (UP vs DOWN) → -1
  - 其他 (SIDEWAYS + UP 等) → 0
- 每對 `trap_penalty`:
  - alignment = -1 → 0.6 (虛漲)
  - alignment = 0 → 0.2 (唔肯定)
  - alignment = +1 → 0

#### Step 3: Alignment Score
- `alignment_score = max(state_count) / total_count` (0-1)
- 同 SSI consistency, 但係 single field (冇 breakdown)

#### Step 4: Grade (8 個)
- `grade_score = ssi_score × 0.6 + alignment_score × 100 × 0.4` (0-100)
- Map 到 8 個 grade (inclusive boundary):
  - 90-100: A+
  - 80-89: A
  - 70-79: B+
  - 60-69: B
  - 50-59: C+
  - 40-49: C
  - 30-39: D
  - 0-29: F

#### Step 5: Kelly 倉位
- `avg_dd = Σ(max_drawdown_estimate) / 6`
- Map 到 3 個 fraction:
  - avg_dd < 0.05 → half (0.5)
  - 0.05 ≤ avg_dd < 0.10 → quarter (0.25)
  - avg_dd ≥ 0.10 → octo (0.125)
- `kelly_position = kelly_numeric` (基礎 Kelly, 將來 M8 加 TCM + alignment 調整)

### 17.5 Sprint 1 嘅 4 個 Notes (大少要知嘅 side effect)

1. **M1 'ma-alignment' 映射 fix** — Sprint 1.1 順手 fix 咗 index.ts 嘅 bug ('ma-alignment' 而家指 MAAlignmentV2Module 新 v2.0, 唔再指 ZmenMAAlignmentModule 舊 v0.3.0 zmen均算法). 冇呢個 fix M7 aggregate 會拎到舊 v0.3.0 嘅 6 個 fields 而唔係新 v2.0 嘅 13 個 fields.

2. **CycleModuleId 加 'volatility'** — Sprint 1.1 將 'volatility' 加入 CycleModuleId union (之前得 5 個), 同 EnableFlags 加 'volatility' field (預設 ON). CycleDetector 而家 instantiate 6 個 modules (M1-M6), `report.moduleVerdicts.length === 6` (之前 5).

3. **CycleState 加 'TRAP'** — Sprint 1.1 將 'TRAP' 加入 CycleState union. 6 個 modules 自己嘅 detect() 唔 return TRAP (佢哋淨係 return UP/DOWN/SIDEWAYS/TRANSITION), 但 type system 支持 M7/M8 set TRAP. Sprint 2 M8 將會用呢個 type.

4. **BaseWeights 加埋 = 1.00** — 之前 5 個 modules 加埋 = 0.90 (預留 0.10 buffer). Sprint 1.1 加埋 'volatility': 0.10, 6 個 modules 加埋 = 1.00. M7 內部直接用, 唔需要 normalize. 5 個 adaptive params auto-calibrate 會重 scale, 保持總和 = 1.0.

### 17.6 Sprint 1 Testing Page UX (永遠全 Show 簡化版)

Sprint 1 範圍嘅 testing page UI (簡化版, 永遠全 Show):
- ✅ 頂部 verdict card (大型 grade + 分數 + SSI/Alignment/Kelly mini-metric)
- ✅ 6 個 metric mini-cards (SSI 一致性 / 平均信心 / 規則覆蓋)
- ✅ 6 個 modules 表格 (module / state / conf / weight / exp.ret / maxdd / RSI)
- ✅ TCM 3 對 pair 表格 (pair / alignment / trap_penalty)
- ✅ Sprint 1 notice (提示 Sprint 2 將加 finalAction + trading card + 5 adaptive params)

Sprint 2 範圍 (未做):
- ⏸️ 永遠全 Show 嘅 full UI (10 個 SVG chart, 顏色對應狀態)
- ⏸️ M8 finalAction 8 個 (BUY/ADD/HOLD/REDUCE/SELL/WAIT/TRAP/TRANSITION)
- ⏸️ Trading card (entry_zone / stop_loss / take_profit / trailing_stop)
- ⏸️ 5 個 adaptive params runtime auto-calibrate (UI 顯示 + 手動重新校準按鈕)
- ⏸️ L2 JSON file cache (~/.stockpulse/adaptive_params/<symbol>.json)
- ⏸️ 10 隻 demo 股票 test cases (HK.00700/09988/03690/01024/01810 + US.AAPL/MSFT/GOOG/NVDA/TSLA)

### 17.7 Sprint 1 測試覆蓋

| 範圍 | 測試 file | Assertions |
|------|----------|-----------|
| 6 個 modules 加 standard verdict | `__tests__/standard-verdict.test.mjs` | 73 |
| M7 Synthesizer 邏輯 | `__tests__/decision-engine.test.mjs` | 64 |
| M7 Smoke test (adapter level) | 內聯 script 跑 decisionEngineAdapter.analyze() | 1 case |
| **Total Sprint 1 new** | | **137 + 1 smoke** |
| Existing 9 個 test files (unchanged) | | 210 |
| **Grand Total** | | **347 assertions pass** |

### 17.8 Sprint 2 計劃 (M8 Decision Engine + adaptive params)

- **Sprint 2 sub-task 2.1** — M8 finalAction 8 個決策樹 (從 grade + state + alignment 推導 finalAction)
- **Sprint 2 sub-task 2.2** — Trading card 4 個 fields (entry_zone / stop_loss / take_profit / trailing_stop)
- **Sprint 2 sub-task 2.3** — 5 個 adaptive params runtime auto-calibrate
  - 純 math (ATR / Hurst log regression / R² / Pearson correlation)
  - Auto mode (background, cache > 7 日自動重校)
  - Manual mode (testing page 「🔄 重新校準」按鈕)
- **Sprint 2 sub-task 2.4** — L2 JSON file cache (~/.stockpulse/adaptive_params/<symbol>.json)
- **Sprint 2 sub-task 2.5** — 10 隻 demo 股票 test cases
- **Sprint 2 sub-task 2.6** — Full testing page UI (10 個 SVG chart, 永遠全 Show, 顏色對應狀態)
- **Sprint 2 sub-task 2.7** — Sprint 2 spec doc update + commit + push

### 17.9 大少可以即刻試

```bash
# 1. 開 testing page (如果有 LaunchAgent running)
open http://localhost:8765/testing-page/

# 2. 揀 dropdown "08 — AS-03-ENG"
# 3. 輸入股票代碼 e.g. "HK.00700"
# 4. 撳 "跑算法"
# 5. 睇 M7 Synthesizer 嘅 verdict card + 6 個 modules 表格 + TCM 表格
```

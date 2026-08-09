# MODULE 08 · 斜率動能 (SlopeMomentum v1.0.0)

> **對應 module**: `~/stockpulse/algorithms/AS-03-cycle-detection/modules/slope-momentum.ts`
> **Stage 2 re-elevate** (大少 2026-08-09 14:16 揀 A drop 暫時隱藏 → 22:34 confirm 4 個 A 重新開工)
> **原 design**: 大少 #10809 (2026-08-06) v1.0 spec — 從 git history `9de7f0eb^` 拎返
> **Pattern**: 跟 ma-alignment v0.3.0 rule-based pattern (10 條 rule M1-M10, additive confidence)
> **Workflow**: 大少 14:16 「按流程做，每次一個 module」+ Stage 2 重新 plan (7 步: spec → code → test → verify → testing page → doc → commit)

---

## 1. 點解呢個 module (Why)

**核心 insight**: 均線「位置」講 alignment (ma-alignment), 「速度」講 momentum — 兩者 orthogonal 但互相驗證。短期斜率反轉係最早期嘅 trend reversal signal (通常早 ma-alignment H rule 1-3 日 trigger)。

**ma-alignment vs SlopeMomentum**:

| 維度 | ma-alignment (M1) | SlopeMomentum (M8) |
|------|-------------------|---------------------|
| 睇嘅嘢 | 位置 (position) | 速度 / 加速度 (velocity / acceleration) |
| 計算 | MA 之間嘅相對位置 | MA 嘅 slope (% change) |
| 觸發時機 | 較慢 (等 5 日確認) | 較快 (1-3 日 slope 變化就 trigger) |
| 互補性 | 大方向確認 | 早期動能信號 |

**M8 兩線策略入面嘅角色 (Sprint 2 已實作 2026-08-09 19:06)**:
- **第一線 (position)**: cycle-synthesizer (M1 60% + zmen 40%) — 5 個 MA trigger
- **第二線 (swing)**: decision-engine 8 個 finalAction — 主要用 ma-alignment 嘅 state + confidence, SlopeMomentum 暫時隱藏
- **Stage 2 re-elevate**: 將 SlopeMomentum 重新做返 standalone peer module entry, 將來 synthesizer 可以 combine 兩者 (跟 v1.0 spec §D 寫嘅 mapping table)

---

## 2. 4 個 Design Decision (大少 22:34 confirm 全 A)

### D1: State output — A (推薦)
- **A (揀)**: 4 state — UP/DOWN/SIDEWAYS/TRANSITION (v1.0 spec 原本)
  - TRANSITION 獨立, 配合 M8 兩線策略 swing mode 嘅 8 個 finalAction
  - 短期斜率反轉 (M7/M8) trigger TRANSITION, 較 ma-alignment H rule 早
- B: 3 state — UP/DOWN/SIDEWAYS only (對齊 M1 convention, 簡化)
- C: 兩者並存 (3-state 為主 + 內部 TRANSITION detector, output 兩種 shape)

### D2: 短期 slope threshold (M1/M2/M10) — A (推薦)
- **A (揀)**: 0.5% (v1.0 spec 原本 — 1 週 1% ≈ 20% 年化, 主流 setting)
  - 大少 #10809 親自定, 27/27 tests pass baseline 證明呢個 threshold 合理
- B: 0.3% (較嚴, false positive 少)
- C: 0.7% (較寬, 只 trigger 真正強 signal)

### D3: Reversal window (M7/M8 zero-cross) — A (推薦)
- **A (揀)**: 5 日 (v1.0 spec 原本, 1 週 — 平衡 detection speed vs noise)
- B: 3 日 (短炒, 反應快, false positive 多)
- C: 7 日 (中線, 穩定, 反應慢)

### D4: 與 ma-alignment H rule 嘅重疊處理 — A (推薦)
- **A (揀)**: 兩者獨立 trigger, state 睇 priority (v1.0 spec 原本, 已喺 spec §D 寫咗 mapping table)
  - SM TRANSITION (M7/M8) + ma-alignment TRANSITION (H) → 兩者都 trigger, 互不覆蓋
  - SM UP + ma-alignment DOWN → 睇 priority, SM 較新信號 (但最終 state = TRANSITION 因為矛盾)
- B: SM 優先 (slope 較早 trigger, override ma)
- C: ma-alignment 優先 (alignment 較 fundamental, slope 確認)

---

## 3. Inputs / Outputs

### Input
- `klines: KLine[]` — K 線數據 (最少 30 條, 目標 100 條+)
- `options?: { consecutiveDays?, reversalWindow?, shortSlopeThreshold?, midSlopeThreshold?, longSlopeThreshold? }` — 5 個 config override

### Output
- `SlopeMomentumVerdict`:
  ```ts
  interface SlopeMomentumVerdict {
    moduleId: 'slope-momentum';
    timeframe: string;                    // e.g. '1d'
    state: 'UP' | 'DOWN' | 'SIDEWAYS' | 'TRANSITION';
    confidence: number;                   // 0-1
    interpretation: string;               // plain language 解讀
    evidence: Array<{ type: string; label: string; value: string; passed: boolean }>;
    warnings: string[];
    meta: {
      matchedRules: string[];             // e.g. ['M1', 'M3', 'M10']
      ruleLabels: string[];               // e.g. ['MA5 短期加速上升', 'MA10 中期斜率上升', '動能加強']
      latestSlopeMA5: number;             // 最新 MA5 slope (%)
      latestSlopeMA10: number;
      latestSlopeMA60: number;
      dataDays: number;
      configUsed: SlopeMomentumConfig;
    };
    timestamp: number;
  }
  ```

---

## 4. 10 條 Rule M1-M10 (v1.0 spec 原本, 27/27 tests pass baseline)

### Step 1: 數據驗證
- 數據筆數 ≥ `longPeriod` (20)，否則 throw error

### Step 2: 計算 MA + Slope history
```
MA5[i]  = avg(close[i-4..i])
MA10[i] = avg(close[i-9..i])
MA60[i] = avg(close[i-19..i])

slope(MA5, 5)[i]  = (MA5[i]  - MA5[i-5])  / MA5[i-5]      // 短期 (1 週)
slope(MA10, 10)[i] = (MA10[i] - MA10[i-10]) / MA10[i-10]  // 中期 (2 週)
slope(MA60, 20)[i] = (MA60[i] - MA60[i-20]) / MA60[i-20]  // 長期 (1 個月)

slopeDaily[1][i] = (MA5[i] - MA5[i-1]) / MA5[i-1]          // 連續日數 check 用
```

### Step 3: 10 條 rule 檢測

| ID | Label | Strength | 條件 |
|---|---|---|---|
| **M1** | MA5 短期加速上升 | strong | `slope(MA5, 5) > +0.5%` **且** 連續 3 日 `slopeDaily[1]` ↑ |
| **M2** | MA5 短期加速下跌 | strong | `slope(MA5, 5) < -0.5%` **且** 連續 3 日 `slopeDaily[1]` ↓ |
| **M3** | MA10 中期斜率上升 | medium | `slope(MA10, 10) > +0.3%` |
| **M4** | MA10 中期斜率下跌 | medium | `slope(MA10, 10) < -0.3%` |
| **M5** | MA60 長期斜率上升 | medium | `slope(MA60, 20) > +0.2%` |
| **M6** | MA60 長期斜率下跌 | medium | `slope(MA60, 20) < -0.2%` |
| **M7** | 短期斜率轉正（趨勢轉強） | strong | MA5 斜率 5 日內由負轉正 (zero-cross) |
| **M8** | 短期斜率轉負（趨勢轉弱） | strong | MA5 斜率 5 日內由正轉負 (zero-cross) |
| **M9** | 動能減弱 | weak | `\|slope(MA5, 5)\| < 0.1%` |
| **M10** | 動能加強 | weak | `\|slope(MA5, 5)\| > 0.5%` |

### Step 4: State derivation (priority order)
```
1. M7 / M8    → TRANSITION (斜率反轉, 最優先)
2. M1 / M3 / M5 / M10 → UP   (短期加速 + 中長期支持 / 動能加強)
3. M2 / M4 / M6 → DOWN      (短期加速 + 中長期支持)
4. M9         → SIDEWAYS     (動能減弱)
default      → SIDEWAYS
```

### Step 5: Confidence (additive, 同 ma-alignment)
- 有 `strong` rule → 0.7
- 有 `medium` rule (但無 strong) → 0.5
- 每個 `weak` rule → +0.10 bonus
- cap 1.0

---

## 5. 配合 Synthesizer (v1.0 spec §D mapping table)

| ma-alignment verdict | SlopeMomentum verdict | 最終 state | 處理 |
|---|---|---|---|
| UP | UP (strong) | UP | ma + slope agree → CONFIRM |
| UP | DOWN (strong) | TRANSITION | slope 強烈反對 ma → override |
| UP | TRANSITION | TRANSITION | slope TRANSITION 觸發 |
| DOWN | DOWN | DOWN | ma + slope agree → CONFIRM |
| DOWN | UP | TRANSITION | slope 強烈反對 ma → override |
| SIDEWAYS | UP (M1/M3/M5) | UP | 多條斜率支持 |
| SIDEWAYS | TRANSITION | TRANSITION | slope TRANSITION 觸發 |

**Stage 2 re-elevate scope**: M8 重新做返 standalone peer module, 將來 synthesizer (M7) 可以 combine M1 + M8 兩個 verdict 用上述 mapping table。

---

## 6. Config (DEFAULT_SLOPE_MOMENTUM_CONFIG)

```ts
export const DEFAULT_SLOPE_MOMENTUM_CONFIG = {
  shortPeriod: 5,                // MA5 短期
  midPeriod: 10,                 // MA10 中期
  longPeriod: 20,                // MA60 → 用 20 日做 long period (60 日太多, 20 日夠用)
  shortSlopeThreshold: 0.005,    // 0.5% (D2 揀 A)
  midSlopeThreshold: 0.003,      // 0.3%
  longSlopeThreshold: 0.002,     // 0.2%
  reversalWindow: 5,             // 5 日 (D3 揀 A)
  consecutiveDays: 3,            // 連續 3 日 (M1/M2 acceleration filter)
  dataWindowDays: 100,           // 用最近 100 日
};
```

---

## 7. State derivation edge cases

| 場景 | 行為 |
|------|------|
| 只 M1 觸發, 冇 M3/M5 | UP (M1 強 short acceleration) |
| M1 + M3 + M5 全觸發 | UP (強 UP — 短中長一致) |
| M1 + M4 (矛盾) | UP (M1 priority 較 M4 高) |
| 只 M9 觸發 | SIDEWAYS (動能減弱, 等方向) |
| M1 + M9 (矛盾: 強 + 弱) | UP (M1 strong 贏 M9 weak) |
| M7 + M8 同時觸發 (極少見) | TRANSITION (互相 cancel) |
| 冇 rule 觸發 | SIDEWAYS (default) |

---

## 8. Testing strategy

### 8.1 Node.js unit test (`tests/test-slope-momentum.mjs`)

10+ 個 scenario (跟 v1.0 spec 27/27 baseline pattern):

| # | Scenario | Expected state |
|---|----------|----------------|
| 1 | MA5 加速上升 (5 日升 1.5% + 連續 3 日) + MA10/M60 支持 | UP (strong) |
| 2 | MA5 加速下跌 (5 日跌 1.5% + 連續 3 日) + MA10/M60 支持 | DOWN (strong) |
| 3 | MA5 斜率 5 日內由負轉正 | TRANSITION (strong) |
| 4 | MA5 斜率 5 日內由正轉負 | TRANSITION (strong) |
| 5 | MA10/M60 都支持上升, 但 MA5 平 (動能減弱) | SIDEWAYS (weak) |
| 6 | M1 + M3 + M5 全觸發 (強 UP) | UP (strong) |
| 7 | M1 + M4 (矛盾) | UP (M1 priority) |
| 8 | M7 + M8 同時觸發 | TRANSITION |
| 9 | 數據不足 (15 條) | throw error |
| 10 | 加權 default confidence 計算啱 | base 0.7 + bonus 0.1 = 0.8 |
| 11 | 加權自訂 consecutiveDays 5 | M1 acceleration filter 較嚴 |
| 12 | 加權自訂 shortSlopeThreshold 0.3 | M1 firing 較頻密 |
| 13 | Meta fields 啱 (matchedRules + slopes) | latestSlopeMA5/10/60 啱 |

### 8.2 pytest wrapper (`backend/tests/test_slope_momentum.py`)
- TestSlopeMomentumCycle: Node test script 存在 + 跑 pass
- TestSlopeMomentumBundle: bundle file 存在 + 有 content
- TestSlopeMomentumTypeExports: module 存在 + exports SlopeMomentum class + DEFAULT_SLOPE_MOMENTUM_CONFIG 對應 0.005/0.003/0.002
- TestSlopeMomentumSpecDoc: spec doc 存在

---

## 9. UI 顯示 (testing page)

`renderSlopeMomentumResult(verdict)` 永遠 full show 全部 sections (大少 11:57 永久 rule):
1. **綜合判定 (state pill + 信心)**: 4 state 顏色 (UP 綠 / DOWN 紅 / SIDEWAYS 橙 / TRANSITION 紫)
2. **Matched Rules (M1-M10)**: 列出邊啲 rule 觸發, 每條 rule 嘅 strength (strong/medium/weak)
3. **3 個 Slope values**: latestSlopeMA5 / latestSlopeMA10 / latestSlopeMA60 嘅 % 數值
4. **Plain language 解讀**: 「M5 短期斜率上升 +0.8%, 動能加強」之類
5. **Cycle transition 解讀 (TRANSITION state 特別版)**: 「MA5 斜率 5 日內由負轉正, 趨勢轉強」
6. **策略建議**: 跟 ma-alignment 風格, UP/DOWN/SIDEWAYS/TRANSITION 各有對應 action
7. **點用呢個結果 guide**: 解 SlopeMomentum 點配合 ma-alignment 一齊睇

---

## 10. Integration 點

- **🎯 M7 Synthesizer** (將來): combine ma-alignment + SlopeMomentum 兩個 verdict, 用 v1.0 spec §D mapping table
- **🎯 M8 Decision Engine** (Sprint 2 done 2026-08-09): 第二線 swing mode 主要用 ma-alignment, Stage 2 re-elevate 後可加 SM peer 入口
- **🎯 M5 Multi-TF** (Stage 2 第一次 focus done 2026-08-09 21:30): M5 主要睇 3 TF 嘅 direction, 將來可以加 SM 加速/減速 signal
- **🎯 Trade Journal** (Stage 1+ done): 落 entry 嗰陣加 optional SM verdict 統計
- **🪝 LLM hook** (大少 13:30 永久 rule): render function 必須有 `async generateInterpretation(ctx): Promise<string>` interface 預留, Sprint 2 用 hardcoded template, 將來 swap 落 LLM

---

## 11. References

- `docs/research/AS-03-cycle-detection/MODULE-01-MA-ALIGNMENT.md` — 同級 peer module
- `docs/research/AS-03-cycle-detection/MODULE-05-MULTI-TIMEFRAME.md` — Stage 2 第一次 focus (大少 21:33 confirm 全 A)
- `docs/research/AS-03-cycle-detection/MODULE-08-DECISION-ENGINE.md` — 兩線策略 + SM 入口
- `docs/research/AS-03-cycle-detection/MODULE-08-CYCLE-SYNTHESIZER.md` — 第一線 synthesizer
- v1.0 spec: git history `9de7f0eb^:docs/research/AS-03-cycle-detection/MODULE-08-SLOPE-MOMENTUM.md`
- v1.0 impl: git history `9de7f0eb^:algorithms/AS-03-cycle-detection/modules/slope-momentum.ts`
- v1.0 commit: `c62d5fcb feat(as-03): Module 5 VolumePrice + Module 8 SlopeMomentum + option toggle`
- 大少 #10809 (2026-08-06): 10 rule M1-M10 直接由大少 trigger
- 大少 14:16 揀 A drop: M5 + 舊 M8 隱藏到 Stage 2+ 重新 plan
- 大少 22:34 confirm 4 個 A 重新開工

---

**最後更新**: 2026-08-09 22:34 (Stage 2 re-elevate, 大少 22:34 confirm 4 個 A 全 A)
**維護者**: 大少 + MiniMax Code
**Status**: ⏳ Stage 2 spec done, impl pending
**下次 review**: M8 implementation done + browser verify 後

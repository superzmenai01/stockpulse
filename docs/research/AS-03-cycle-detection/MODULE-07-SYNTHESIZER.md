# MODULE 07 · 綜合判定 (Synthesizer v1.0.0)

> **對應 module**: `~/stockpulse/algorithms/AS-03-cycle-detection/orchestrator/aggregator.ts` + `synthesize.ts`
> **設計者**: 大少 #10809 (2026-08-06)
> **Default strategy**: `expert-rules` (大少 #10809 trigger)
> **Pattern**: rule-based + transparent + 可審計 (唔揀 weighted-vote 因為對 rule-based verdict 唔自然)

---

## A. 核心口訣 / 原則

**「Rule-based + Transparent + 可審計」**

| 設計原則 | 解釋 |
|---|---|
| ✅ Rule-based | 用 rule 直接 combine，唔做 numeric aggregation |
| ✅ Transparent | breakdown 顯示每個 module 嘅 contribution |
| ✅ 可審計 | User 可以解釋每個 step 嘅決定畀自己聽 |
| ❌ Weighted-vote | 對 rule-based verdict 唔自然（rule 已經表達 weighted priority） |
| ❌ Black-box ML | 違反大少「全部都顯示」default |

**核心 insight**: Synthesizer 嘅 job **唔係** decide truth，係 **integrate evidence from multiple angles**。

---

## B. 如何量化（Expert-Rules Strategy）

### Step 1: Base — ma-alignment (mandatory)
```typescript
const ma = verdicts.find(v => v.moduleId === 'ma-alignment');
if (!ma) {
  // fallback — ma-alignment 唔在 (should never happen)
  return { state: 'TRANSITION', confidence: 0, ... };
}
let finalState = ma.state;
let finalConfidence = ma.confidence;
```

### Step 2: VolumePrice signal 調整 confidence
```typescript
const volume = verdicts.find(v => v.moduleId === 'volume');
if (volume) {
  const signal = volume.meta.signal;  // CONFIRM / DISCONFIRM / NEUTRAL
  
  if (signal === 'CONFIRM') {
    finalConfidence = min(1.0, finalConfidence * 1.10);  // +10%
  } else if (signal === 'DISCONFIRM') {
    finalConfidence = max(0, finalConfidence * 0.70);   // -30%
    
    if (volume.confidence > 0.7) {
      // Volume 強烈反對 → 考慮 TRANSITION
      finalState = 'TRANSITION';
    }
  }
  // NEUTRAL → 無變化
}
```

### Step 3: SlopeMomentum verdict 影響 state
```typescript
const slope = verdicts.find(v => v.moduleId === 'slope-momentum');
if (slope) {
  if (slope.state === 'TRANSITION' && slope.confidence > 0.5) {
    finalState = 'TRANSITION';  // slope TRANSITION → override
  } else if (slope.state !== finalState && slope.confidence > 0.6) {
    // Slope 強烈反對 ma-alignment
    finalState = 'TRANSITION';
  }
}
```

### Step 4: HTF override (high confidence)
```typescript
if (htf && htf.confidence > 0.8 && htf.state !== finalState) {
  finalState = htf.state;  // HTF 壓倒
}
```

### Step 5: Output
```typescript
return {
  state: finalState,
  confidence: round(finalConfidence, 4),
  reason: reasons.join('；'),  // 'Base ma-alignment: UP (70%)；Volume CONFIRM (+10%)'
  breakdown: { 'ma-alignment:UP': 0.7, 'volume:CONFIRM': 0.5, ... },
  strategy: 'expert-rules',
};
```

---

## C. 3 個候選策略（D004 pending）

### 1. **expert-rules** (DEFAULT — 大少 #10809)
- ✅ Rule-based combine
- ✅ Transparent breakdown
- ✅ 可審計
- ❌ Configuration 唔直接 tunable（rule 寫死）

### 2. **weighted-vote**
```typescript
state = argmax(states, s => sum(weights[s] × conf[v]))
```
- ✅ Mathematically principled
- ❌ Rule 已經表達 weighted priority (double weighting)
- ❌ 唔自然 (rule 唔係 numeric vote)
- 大少 default: **唔揀**

### 3. **htf-override**
```typescript
if (htf && htf.confidence > threshold) {
  state = htf.state  // HTF 壓倒 LTF
}
```
- ✅ Simple
- ❌ 唔考慮 LTF 細節
- ❌ 只 applicable 對 hierarchical data
- 大少 default: **partial（已經係 expert-rules Step 4）**

### 推薦
**expert-rules** (default per #10809) — 同 v0.3.0 ma-alignment rule-based pattern 一致。

---

## D. 信心度 + 來源

| 來源 | 評分 | 備註 |
|---|---|---|
| 大少 #10809 親自選擇 expert-rules | ⭐⭐⭐⭐⭐ | 「同 v0.3.0 pattern 一致 — 全部都 transparent + 可審計」 |
| Rule-based 同 additive confidence 一致 | ⭐⭐⭐⭐ | 容易理解、容易 backtest |
| 其他 2 個策略 reject | ⭐⭐ | Weighted-vote 對 rule-based verdict 唔自然；htf-override 太簡單 |

### 預期 fire matrix（expert-rules）

| ma | volume | slope | final state | 處理 |
|---|---|---|---|---|
| UP | CONFIRM | UP | UP (high conf) | All agree |
| UP | DISCONFIRM | UP | UP (low conf) | volume weak override |
| UP | DISCONFIRM | DOWN (high) | TRANSITION | slope strong disagree |
| DOWN | CONFIRM | DOWN | DOWN (high conf) | All agree |
| DOWN | DISCONFIRM | DOWN | DOWN (low conf) | volume weak override |
| SIDEWAYS | NEUTRAL | UP | UP | slope agrees UP |
| SIDEWAYS | DISCONFIRM | TRANSITION | TRANSITION | Multiple disagree signals |

---

## 🔧 實作參考

### Aggregator 結構
```typescript
// orchestrator/aggregator.ts
export type AggregatorStrategy = 'majority-vote' | 'htf-override' | 'weighted-vote' | 'expert-rules';

export interface AggregatorInput {
  htf?: CycleVerdict;
  moduleVerdicts: (CycleVerdict | null)[];  // null = 該 module 冇跑/未實作
}

export interface AggregatorResult {
  state: CycleState;
  confidence: number;
  reason: string;
  breakdown: Record<string, number>;
  strategy: AggregatorStrategy;
}

export class Aggregator {
  constructor(strategy: AggregatorStrategy = 'expert-rules');
  async aggregate(input: AggregatorInput): Promise<AggregatorResult>;
  private expertRulesAggregate(input: AggregatorInput): AggregatorResult;
  private majorityVoteAggregate(input: AggregatorInput): AggregatorResult;
}
```

### Synthesizer 結構
```typescript
// orchestrator/synthesize.ts
export class Synthesizer {
  private readonly aggregator: Aggregator;  // default expert-rules
  
  async synthesize(input: SynthesizeInput): Promise<CycleVerdict> {
    const result = await this.aggregator.aggregate({
      htf: input.htf,
      moduleVerdicts: input.moduleVerdicts,
    });
    
    return {
      moduleId: 'synthesized',
      state: result.state,
      confidence: result.confidence,
      interpretation: `[Synthesized · ${result.strategy}] ${result.reason}。最終: ${result.state} (信心 ${(result.confidence * 100).toFixed(1)}%)。Enabled: ${moduleSummary}`,
      evidence: [],
      warnings: enabledVerdicts.length < 1 ? ['無 enabled module verdict'] : [],
      meta: {
        htf: input.htf?.state,
        breakdown: result.breakdown,
        strategy: result.strategy,
        aggregatorReason: result.reason,
        enabledModules: enabledVerdicts.map(v => v.moduleId),
        moduleSummary,
      },
    };
  }
}
```

### UI Display（per D006）
- 顯示 5 個 peer module verdicts + 1 HTF verdict + 1 synthesized verdict
- = 7 個 verdict card
- 每個 verdict card 顯示：
  - State + Confidence
  - Interpretation (中文人話)
  - Evidence (matched rules + labels)
  - Warnings (anomaly)
  - Meta (matchedRules, ruleLabels, latestMA5/MA10/MA60, dataDays, configUsed)

---

## ⚠️ Architecture Concerns

### 1. Volume double-count
- **問題**: ma-alignment 嘅 Case A/B/C/D 都參考 MA 位置 (closing position)，而 VolumePrice rule K/L/M/N 都參考 close direction。理論上有 correlation。
- **解**: ma-alignment 用 MA-based position，VolumePrice 用 raw close direction。Correlation 不高 (~0.5) — 唔構成 double-count。

### 2. Slope overlap with ma-alignment Case F/G
- **問題**: ma-alignment Case F (升勢調整向下) 講 MA5 < MA10 但都 > MA60。SlopeMomentum M4 (MA10 中期斜率下跌) 講 MA10 slope < 0。
- **解**: Case F 係 position (即時關係)，M4 係 slope (5-15 日方向)。Orthogonal 但有 trade-off — Synthesizer combine 兩個 angle。

### 3. Handle null verdict
- 將來 optional module 唔跑時 return null
- Aggregator filter null 先做 combine
- `moduleVerdicts.filter(v => v !== null)`

### 4. Per-stock calibration (D007 pending)
- CycleConfig 設計支援 per-stock 注入
- CycleDetector.analyze({ enableFlags: ... }) 接受 override

---

**Source**: 大少 #10809, DECISIONS.md D004 + D012 + D019 + D020, /tmp/main-quick-draft.md
**Tests**: Aggregator + Synthesizer tested via ma-alignment + volume + slope-momentum flows
**對應 commit**: `c62d5fcb feat(as-03): Module 5 VolumePrice + Module 8 SlopeMomentum + option toggle`
# MODULE 08 · 斜率動能 (SlopeMomentum v1.0.0)

> **對應 module**: `~/stockpulse/algorithms/AS-03-cycle-detection/modules/slope-momentum.ts`
> **設計者**: 大少 #10809 (2026-08-06)
> **Pattern**: 跟 ma-alignment v0.3.0 rule-based pattern (10 rule M1-M10, additive confidence)
> **測試**: `__tests__/slope-momentum.test.mjs` — 27/27 assertions pass

---

## A. 核心口訣 / 原則

**「均線速度 / 加速度 + 短期斜率反轉」**

| 市場狀態 | 解讀 | 信心影響 |
|---|---|---|
| 短期均線加速上升 | 🚀 強勢升 — 動力強 | UP (strong) |
| 短期均線加速下跌 | 📉 強勢跌 — 動力強 | DOWN (strong) |
| 中長期均線斜向上 | 仲有後勁 | UP (medium) |
| 短期斜率由負轉正 | ⬆️ 轉勢信號 — 留意方向 | TRANSITION (strong) |
| 短期斜率由正轉負 | ⬇️ 見頂信號 | TRANSITION (strong) |
| 短期斜率近乎零 | ⏸️ 動能弱 — 等市場給方向 | SIDEWAYS (weak) |

**核心 insight**: 均線「位置」講 alignment（ma-alignment），「速度」講 momentum — 兩者 orthogonal 但互相驗證。短期斜率反轉係最早期嘅 trend reversal signal。

---

## B. 如何量化（10 rule M1-M10）

### Step 1: 數據驗證
- 數據筆數 ≥ `longPeriod` (20)，否則 throw error

### Step 2: 計算 MA + Slope history
```
MA5[i]  = avg(close[i-4..i])
MA10[i] = avg(close[i-9..i])
MA60[i] = avg(close[i-19..i])

slope(MA5, 5)[i]  = (MA5[i]  - MA5[i-5])  / MA5[i-5]
slope(MA10, 10)[i] = (MA10[i] - MA10[i-10]) / MA10[i-10]
slope(MA60, 20)[i] = (MA60[i] - MA60[i-20]) / MA60[i-20]

slopeDaily[1][i] = (MA5[i] - MA5[i-1]) / MA5[i-1]  // for M1/M2 consecutive check
```

### Step 3: 10 rule 檢測

| ID | Label | Strength | 條件 |
|---|---|---|---|
| **M1** | MA5 短期加速上升 | strong | slope(MA5, 5) > +0.5% **且** 連續 3 日 slopeDaily[1] ↑ |
| **M2** | MA5 短期加速下跌 | strong | slope(MA5, 5) < -0.5% **且** 連續 3 日 slopeDaily[1] ↓ |
| **M3** | MA10 中期斜率上升 | medium | slope(MA10, 10) > +0.3% |
| **M4** | MA10 中期斜率下跌 | medium | slope(MA10, 10) < -0.3% |
| **M5** | MA60 長期斜率上升 | medium | slope(MA60, 20) > +0.2% |
| **M6** | MA60 長期斜率下跌 | medium | slope(MA60, 20) < -0.2% |
| **M7** | 短期斜率轉正（趨勢轉強） | strong | MA5 斜率 5 日內由負轉正（zero-cross） |
| **M8** | 短期斜率轉負（趨勢轉弱） | strong | MA5 斜率 5 日內由正轉負（zero-cross） |
| **M9** | 動能減弱 | weak | \|slope(MA5, 5)\| < 0.1% |
| **M10** | 動能加強 | weak | \|slope(MA5, 5)\| > 0.5% |

### Step 4: State derivation（priority order）
```
1. M7 / M8    → TRANSITION (斜率反轉，最優先)
2. M1 / M3 / M5 → UP       (短期加速 + 中長期支持)
3. M2 / M4 / M6 → DOWN     (短期加速 + 中長期支持)
4. M10        → UP          (動能加強 — weak 但方向向上)
5. M9         → SIDEWAYS    (動能減弱)
default      → SIDEWAYS
```

### Step 5: Confidence（additive — 同 ma-alignment）
- 有 `strong` rule → 0.7
- 有 `medium` rule (但無 strong) → 0.5
- 每個 `weak` rule → +0.10 bonus
- cap 1.0

---

## C. 待驗證問題

| # | 問題 | 影響 | 暫定答案 |
|---|---|---|---|
| 1 | shortSlopeThreshold = 0.5% 是否太寬鬆？ | rule M1/M2/M10 firing frequency | 0.5% = 1 週 1% ≈ 20% 年化，主流 |
| 2 | midSlopeThreshold = 0.3% 對標 10 日均線合理嗎？ | rule M3/M4 sensitivity | 待 backtest |
| 3 | longSlopeThreshold = 0.2% 太弱？ | rule M5/M6 firing frequency | 60 日均線慢，0.2% 都算信號 |
| 4 | reversalWindow = 5 日是否合適？短線改 3 日？ | rule M7/M8 false positive | 5 日 ≈ 1 週 |
| 5 | consecutiveDays = 3 (for M1/M2) 是否要嚴格？ | rule M1/M2 嘅 strictness | 待 backtest |
| 6 | 短期斜率轉正/負 vs ma-alignment Case H 反轉重疊？ | 雙重 firing (可能 conflict) | 兩者獨立 trigger，state 睇 priority |

---

## D. 信心度 + 來源

| 來源 | 評分 | 備註 |
|---|---|---|
| 大少 #10809 親自設計 | ⭐⭐⭐⭐⭐ | 10 rule M1-M10 直接由大少 trigger |
| 均線技術分析理論 | ⭐⭐⭐⭐ | 均線斜率 + 動能係 technical analysis 基礎 |
| Backtest | ⭐⭐ | 未做 (D010 deferred) |
| 大少直覺 | ⭐⭐⭐⭐ | 「均線速度」直觀理解 |

### 信心度算法
- 同 ma-alignment v0.3.0 additive pattern
- `strong = 0.7` / `medium = 0.5` / `weak = +0.10 each` / `cap = 1.0`
- 唔做 multiplicative (大少 #10332 drop Kimi v0.2.0)

### 與 ma-alignment 嘅關係
- **獨立 peer module** (大少 #10809 改主意 — 原本 D013 Option A 屬於 ma-alignment confidence modifier)
- ma-alignment 講 **alignment** (位置)
- SlopeMomentum 講 **momentum** (速度 / 加速度)
- Synthesizer combine 兩者

### Slope 計算公式
```
slope(history, i, N) = (history[i] - history[i-N]) / history[i-N]
```

例如：MA5 嘅 5 日斜率 = (MA5[今日] - MA5[5日前]) / MA5[5日前]

### Zero-cross 檢測 (M7/M8)
```
slopeCrossedZero(slopeHistory, endIdx, window, direction):
  latestSlope = slopeHistory[endIdx]
  必須係目標 sign (positive/negative)
  喺 window 內必須有對面 sign (曾經係相反方向)
```

---

## 🔧 實作參考

```typescript
// modules/slope-momentum.ts structure
export class SlopeMomentum implements CycleModule<KLine[]> {
  readonly id = 'slope-momentum' as const;
  readonly version = '1.0.0';
  
  async detect(klines: KLine[], ctx: CycleContext): Promise<CycleVerdict> {
    // Step 1: 數據驗證
    // Step 2: 計算 MA history + slope history
    // Step 3: 10 rule M1-M10 檢測
    // Step 4: State derivation
    // Step 5: Confidence derivation
    // Output: CycleVerdict (4-state)
  }
}
```

## 🎯 配合 Synthesizer (D004 expert-rules)

| ma-alignment verdict | SlopeMomentum verdict | 最終 state | 處理 |
|---|---|---|---|
| UP | UP (strong) | UP | ma + slope agree → CONFIRM |
| UP | DOWN (strong) | TRANSITION | slope 強烈反對 ma → override |
| UP | TRANSITION | TRANSITION | slope TRANSITION 觸發 |
| DOWN | DOWN | DOWN | ma + slope agree → CONFIRM |
| DOWN | UP | TRANSITION | slope 強烈反對 ma → override |
| SIDEWAYS | UP (M1/M3/M5) | UP | 多條斜率支持 |
| SIDEWAYS | TRANSITION | TRANSITION | slope TRANSITION 觸發 |

---

**Source**: 大少 #10809, DECISIONS.md D013, /tmp/main-quick-draft.md
**Tests**: 27/27 pass
**對應 commit**: `c62d5fcb feat(as-03): Module 5 VolumePrice + Module 8 SlopeMomentum + option toggle`
# MODULE 05 · 量價分析 (VolumePrice v1.0.0)

> **對應 module**: `~/stockpulse/algorithms/AS-03-cycle-detection/modules/volume.ts`
> **設計者**: 大少 #10809 (2026-08-06)
> **Pattern**: 跟 ma-alignment v0.3.0 rule-based pattern (10 rule K-T, additive confidence)
> **測試**: `__tests__/volume.test.mjs` — 37/37 assertions pass

---

## A. 核心口訣 / 原則

**「錢跟價 = 真升 / 錢唔跟 = 假升」**

| 市場信號 | 解讀 | 信心影響 |
|---|---|---|
| 股價升 + 錢湧入 | 💰 真升 — 資金確認趨勢 | CONFIRM (+10% confidence) |
| 股價升 + 錢縮 | ⚠️ 假升 — 量價背馳，見頂警號 | DISCONFIRM (-30% confidence) |
| 股價跌 + 錢湧入 | 📉 真跌 — 拋售確認 | CONFIRM |
| 股價跌 + 錢縮 | ⏸️ 拋售衰竭 — 跌勢可能結束 | DISCONFIRM |
| 橫行 + 錢縮 | 觀望 | NEUTRAL |
| 橫行 + 錢放 | 醞釀突破 | NEUTRAL |

**核心 insight**: 量價背馳（price-volume divergence）係技術分析最早期嘅 warning signal — OBV (On-Balance Volume) 1930s 年代已經用。

---

## B. 如何量化（10 rule K-T）

### Step 1: 數據驗證
- 數據筆數 ≥ `volumeLookback` (20)，否則 throw error
- 全部 klines 用晒（同 ma-alignment 一致）

### Step 2: 計算指標
```
OBV[i] = OBV[i-1] + (close[i] > close[i-1] ? volume[i] : 
                     close[i] < close[i-1] ? -volume[i] : 0)
volMA5  = avg(volume[0..4])
volMA20 = avg(volume[0..19])
```

### Step 3: 10 rule 檢測

| ID | Label | Strength | 條件 |
|---|---|---|---|
| **K** | 量價齊升確認 | strong | 連續 5 日 close ↑ 且 volume ↑ |
| **L** | 量價背馳（見頂警號） | strong | close 創 5 日新高 **但** volume < 5 日均量 |
| **M** | 放量下跌（趨勢確認） | strong | 連續 5 日 close ↓ 且 volume ↑ |
| **N** | 縮量下跌（拋售衰竭） | medium | 連續 5 日 close ↓ **但** volume ↓ |
| **O** | OBV 創 N 日新高 | medium | OBV > max(OBV[5 日前]) |
| **P** | OBV 創 N 日新低 | medium | OBV < min(OBV[5 日前]) |
| **Q** | 縮量橫行整理 | medium | max_spread_pct < 2% 且 5日量 < 20日量 × 0.8 |
| **R** | 放量震盪（醞釀突破） | medium | max_spread_pct > 3% 且 5日量 > 20日量 × 1.2 |
| **S** | 量能背馳（OBV vs close） | strong | OBV & close 5 日 correlation < -0.5 |
| **T** | 量能不濟 | weak | 5日量 < 20日量 × 0.5 |

### Step 4: State derivation（priority order）
```
1. K / O      → UP       (量能支持上升)
2. M / P      → DOWN     (量能支持下跌)
3. L / S / R  → TRANSITION (見頂警號 / 量價背馳 / 醞釀突破)
4. N / T / Q  → SIDEWAYS (拋售衰竭 / 量能不濟 / 縮量整理)
default       → SIDEWAYS
```

### Step 5: Confidence（additive）
- 有 `strong` rule → 0.7
- 有 `medium` rule (但無 strong) → 0.5
- 每個 `weak` rule → +0.10 bonus
- cap 1.0

### Step 6: Signal derivation（D012 Option B + D020）
```
CONFIRM    — K / M / O / P    (量價配合 — 趨勢確認)
DISCONFIRM — L / S / N        (背馳 / 拋售衰竭 — 見頂警號)
NEUTRAL    — Q / R / T / default
```

**Output**: `CycleVerdict` with `meta.signal` field 畀 Synthesizer 用。

---

## C. 待驗證問題

| # | 問題 | 影響 | 暫定答案 |
|---|---|---|---|
| 1 | consecutiveDays = 5 是否合適？短線改 3 日？ | rule K/L/M/N 嘅 firing frequency | 5 日 = 1 交易週，主流選擇 |
| 2 | volumeLookback = 20 是否合理？改 10 或 60？ | Q/R/T 嘅 boost/shrink 比較 | 20 日 = 1 個月 |
| 3 | boostThreshold = 1.2 (放量 20%) 算 aggressive？ | Q/R false positive | 待 backtest |
| 4 | shrinkThreshold = 0.8 (縮量 20%)？ | 對稱設計但實務上 bullish/bearish asymmetric | 暫定 |
| 5 | divergenceCorrelation = -0.5 是否太寬鬆？ | rule S 嘅 firing frequency | 待 backtest |
| 6 | OBV vs close correlation 應該用 5 日還是 10 日？ | rule S sensitivity | 5 日 |
| 7 | 量能背馳 (rule S) vs 量價背馳 (rule L) 同時 fire 點 handle？ | double-count | L 觸發 TRANSITION + S 觸發 TRANSITION，state 一致 |

---

## D. 信心度 + 來源

| 來源 | 評分 | 備註 |
|---|---|---|
| 大少 #10809 親自設計 | ⭐⭐⭐⭐⭐ | 10 rule K-T 直接由大少 trigger |
| 量價分析理論 | ⭐⭐⭐⭐ | OBV 1930s 起驗證 + 量價背馳係 trading 基礎 |
| Backtest | ⭐⭐ | 未做 (D010 deferred) |
| 大少直覺 | ⭐⭐⭐⭐ | 「錢跟價 = 真升」直觀易懂 |

### 信心度算法
- `additive pattern` (跟 ma-alignment v0.3.0)
- `strong = 0.7` / `medium = 0.5` / `weak = +0.10 each` / `cap = 1.0`
- 唔做 multiplicative (大少 #10332 drop Kimi v0.2.0 multiplicative)

### State derivation priority
```
K/O → UP
M/P → DOWN
L/S/R → TRANSITION
N/T/Q → SIDEWAYS
```

### Signal 配合 Synthesizer
- `CONFIRM` → Synthesizer confidence +10%
- `DISCONFIRM` → Synthesizer confidence -30% (high vol conf → 考慮改 TRANSITION)
- `NEUTRAL` → 無變化

---

## 🔧 實作參考

```typescript
// modules/volume.ts structure
export class VolumePrice implements CycleModule<KLine[]> {
  readonly id = 'volume' as const;
  readonly version = '1.0.0';
  
  async detect(klines: KLine[], ctx: CycleContext): Promise<CycleVerdict> {
    // Step 1: 數據驗證
    // Step 2: 計算 OBV + 5/20 日均量
    // Step 3: 10 rule K-T 檢測
    // Step 4: State derivation
    // Step 5: Confidence derivation
    // Step 6: Signal derivation (D012 Option B)
    // Output: CycleVerdict with meta.signal
  }
}
```

## 🎯 配合 Synthesizer (D004 expert-rules)

| ma-alignment verdict | volume signal | 最終 state | 最終 confidence |
|---|---|---|---|
| UP | CONFIRM | UP | ma × 1.10 |
| UP | DISCONFIRM | UP (但 weak) | ma × 0.70 |
| UP | NEUTRAL | UP | ma (不變) |
| DOWN | CONFIRM | DOWN | ma × 1.10 |
| DOWN | DISCONFIRM | DOWN | ma × 0.70 |
| SIDEWAYS | DISCONFIRM | SIDEWAYS | ma × 0.70 |

---

**Source**: 大少 #10809, DECISIONS.md D012 + D020, /tmp/main-quick-draft.md
**Tests**: 37/37 pass
**對應 commit**: `c62d5fcb feat(as-03): Module 5 VolumePrice + Module 8 SlopeMomentum + option toggle`
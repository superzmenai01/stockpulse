# AS-03 Module 5 (VolumePrice 量價) + Module 8 (SlopeMomentum 斜率動能) — Quick Draft

**Author:** Main Agent (human-side quick analysis)  
**Date:** 2026-08-06  
**Status:** Draft v0.1 (for synthesis with OpenCode Daemon output)

---

## 🎯 Goal

基於大少 v0.3.0 MA alignment 嘅 10-rule A-J pattern，設計兩套獨立 peer module：
1. **Module 5 · VolumePrice 量價** — rule-based, confirm/disconfirm signal
2. **Module 8 · SlopeMomentum 斜率動能** — 獨立 peer module, rule-based

跟足 v0.3.0 嘅「全部都顯示 + additive confidence」pattern，**唔做** multiplicative modifier。

---

## 📊 Module 5 · VolumePrice (10 rule K-T)

跟 docx v2.0 量價信號分類，但用 rule-based additive pattern。

| ID | Label | Strength | 條件 (formula) | 對應 docx v2.0 |
|---|---|---|---|---|
| **K** | 量價齊升確認 | strong | 連續 5 日 close ↑ 且 volume ↑ | 7b uptrend + expanding |
| **L** | 量價背馳（見頂警號） | strong | close 創 5 日新高但 volume < 5 日均量 | 7b uptrend + shrinking（顛倒語意）|
| **M** | 放量下跌（趨勢確認） | strong | 連續 5 日 close ↓ 且 volume ↑ | 7b downtrend + expanding |
| **N** | 縮量下跌（拋售衰竭） | medium | 連續 5 日 close ↓ 但 volume ↓ | 7b downtrend + shrinking |
| **O** | OBV 創 N 日新高 | medium | OBV > max(OBV[5:]) | Kimi 冇（自加）|
| **P** | OBV 創 N 日新低 | medium | OBV < min(OBV[5:]) | Kimi 冇（自加）|
| **Q** | 縮量橫行整理 | medium | max_spread_pct < 2% 且 5 日均量 < 20 日均量 × 0.8 | 7b sideways + shrinking |
| **R** | 放量震盪（醞釀突破） | medium | max_spread_pct > 3% 且 5 日均量 > 20 日均量 × 1.2 | 7b sideways + expanding |
| **S** | 量能背馳 (OBV vs close) | strong | OBV 趨勢 同 close 趨勢 背馳（5 日 correlation < -0.5）| Kimi 冇（自加）|
| **T** | 量能不濟 (弱) | weak | 5 日均量 < 20 日均量 × 0.5 | Kimi 冇（自加）|

### State derivation (VolumePrice)
| Priority | Rule | State |
|---|---|---|
| 1 | K / O | UP (量能確認上升) |
| 2 | M / P | DOWN (量能確認下跌) |
| 3 | L / S | TRANSITION (見頂警號) |
| 4 | N / T | SIDEWAYS (拋售衰竭 / 量能不濟) |
| 5 | Q | SIDEWAYS |
| 6 | R | TRANSITION |
| default | — | SIDEWAYS |

### Confidence (VolumePrice)
- strong rule → 0.7
- medium rule → 0.5
- weak rule → +0.10 bonus each
- cap 1.0

### ⚠️ Confirm/Disconfirm Signal (D012 Option B 設計)

VolumePrice module 嘅 verdict 唔直接做 cycle verdict，而係：
- `meta.confirm: boolean` — 量能確認主趨勢？
- `meta.signal: 'CONFIRM' | 'DISCONFIRM' | 'NEUTRAL'`
- Synthesizer 用呢個 signal 同 ma-alignment 嘅 verdict 對齊
- 避免「ma-alignment 判定 UP + volume 判定 DOWN」嘅雙重計問題

---

## 📊 Module 8 · SlopeMomentum (10 rule M1-M10)

跟 v0.3.0 pattern，**避開** docx 嘅「永遠 fire bug」（上漲+短期斜率負 = 0.7 discount 永遠 fire）。

| ID | Label | Strength | 條件 (formula) | 對應 docx v2.0 |
|---|---|---|---|---|
| **M1** | MA5 短期加速上升 | strong | slope(MA5, 5) > +0.5% 且 連續 3 日 ↑ | 6+7c |
| **M2** | MA5 短期加速下跌 | strong | slope(MA5, 5) < -0.5% 且 連續 3 日 ↓ | 6+7c |
| **M3** | MA10 中期斜率上升 | medium | slope(MA10, 10) > +0.3% | 6 |
| **M4** | MA10 中期斜率下跌 | medium | slope(MA10, 10) < -0.3% | 6 |
| **M5** | MA60 長期斜率上升 | medium | slope(MA60, 20) > +0.2% | 6 |
| **M6** | MA60 長期斜率下跌 | medium | slope(MA60, 20) < -0.2% | 6 |
| **M7** | 短期斜率轉正（趨勢轉強） | strong | MA5 斜率 5 日內由負轉正（轉折點）| 7c downtrend + 短期斜率正 |
| **M8** | 短期斜率轉負（趨勢轉弱） | strong | MA5 斜率 5 日內由正轉負（轉折點）| 7c uptrend + 短期斜率負 |
| **M9** | 動能減弱 (弱) | weak | 短期斜率絕對值 < 0.1% | 6 momentum_score 跌 |
| **M10** | 動能加強 (弱) | weak | 短期斜率絕對值 > 0.5% | 6 momentum_score 升 |

### State derivation (SlopeMomentum)
| Priority | Rule | State |
|---|---|---|
| 1 | M7 / M8 | TRANSITION |
| 2 | M1 / M3 / M5 | UP (多條斜率支持) |
| 3 | M2 / M4 / M6 | DOWN (多條斜率支持) |
| 4 | M10 | UP (動能加強) |
| 5 | M9 | SIDEWAYS (動能減弱) |
| default | — | SIDEWAYS |

### Confidence (SlopeMomentum)
- strong rule → 0.7
- medium rule → 0.5
- weak rule → +0.10 bonus each
- cap 1.0

---

## ⚙️ Config.ts 新增 fields (D005 集中)

```typescript
// config.ts 新增
export interface VolumePriceConfig {
  consecutiveDays: number;           // 5 — 量價齊升/背馳 連續日數
  volumeLookback: number;            // 20 — 均量比較長度
  boostThreshold: number;            // 1.2 — 放量門檻 (5日/20日 均量比)
  shrinkThreshold: number;           // 0.8 — 縮量門檻
  obvLookback: number;               // 5 — OBV 突破/跌破窗口
  divergenceCorrelation: number;      // -0.5 — 量能背馳 correlation 門檻
}

export interface SlopeMomentumConfig {
  shortPeriod: number;               // 5 — MA5 slope 窗口
  midPeriod: number;                 // 10 — MA10 slope 窗口
  longPeriod: number;                // 20 — MA60 slope 窗口
  shortSlopeThreshold: number;       // 0.005 (0.5%) — 短期斜率強弱門檻
  midSlopeThreshold: number;         // 0.003 (0.3%) — 中期斜率強弱門檻
  longSlopeThreshold: number;        // 0.002 (0.2%) — 長期斜率強弱門檻
  reversalWindow: number;            // 5 — M7/M8 短期斜率反轉窗口
}
```

---

## ⚠️ Architecture Concerns (要同大少傾)

### 1. Volume Confirm/Disconfirm Signal
- 跟 D012 Option B — VolumePrice 唔直接出 cycle verdict
- 出 `confirm` / `disconfirm` / `neutral` signal
- Synthesizer 整合時：ma-alignment UP + VolumePrice confirm = 強化 UP；ma-alignment UP + VolumePrice disconfirm = TRANSITION 或 DOWN

### 2. Slope 同 MA Alignment 嘅 Overlap
- M3/M4 (MA10 slope) 同 ma-alignment 嘅 Case F/G (MA5+MA10 都 >/< MA60) 邏輯相近
- 但 ma-alignment 講 alignment，SlopeMomentum 講 slope 方向同加速度
- 建議：**SlopeMomentum verdict 仍 output cycle**，synthesizer handle overlap（用 D004 pending strategy）

### 3. Synthesizer (D004 pending) 嘅影響
- VolumePrice 嘅 signal 而唔係 verdict → synthesizer 唔使 vote，加多一層判斷
- SlopeMomentum 嘅 verdict 同 ma-alignment vote → 3 個 candidate strategy：
  - **htf-override**: 唔適用（兩者都 LTF peer）
  - **weighted-vote**: ma-alignment weight 高 (e.g. 0.6), SlopeMomentum 低 (e.g. 0.4)
  - **expert-rules**: rule-based combine（推薦 — 同 v0.3.0 pattern 一致）

### 4. CycleModuleId Update
- types.ts `CycleModuleId` 而家 5 個：`ma-alignment | hl-structure | trendline | indicators | volume`
- 加 `slope-momentum` 做第 6 個 peer

---

## 🎯 對 Synthesizer (D004) 嘅推薦

大少 v0.3.0 pattern 用 rule-based + additive，建議 D004 揀 **expert-rules** 而唔係 weighted-vote。原因：
- weighted-vote 對 rule-based verdict 嚟講唔自然（rule 已經表達 weighted priority）
- expert-rules 可以將 VolumePrice confirm/disconfirm signal 直接 rule 化
- 同 v0.3.0 一致 — 全部都 transparent + 可審計

---

## 📌 Source

- 大少 #10301 量價 + 斜率動能 trigger
- 大少 #10332 — Kimi v0.2.0 multiplicative 算法 drop
- v0.3.0 ma-alignment.ts — pattern reference
- DECISIONS.md D012 (volume 角色 Option B) / D013 (slope 角色 Option A → 大少改主意獨立 peer)
- /tmp/均線系統週期判斷法.txt — Kimi v2.0 量價 + 斜率 multiplicative reference

---

**Status:** Quick draft v0.1。等 OpenCode Daemon output 綜合。
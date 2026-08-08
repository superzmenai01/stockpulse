# MODULE 01 · 均線系統週期判斷法 (Moving Average Cycle Detector v0.3.0)

> 對應 module: `~/stockpulse/algorithms/AS-03-cycle-detection/modules/ma-alignment.ts`
> 設計者: **大少 #10297/#10299/#10301/#10317/#10332** (純大少 rule-based 算法)
> 版本: **v0.3.0** (取代 v0.2.0 Kimi 8 步算法)
> 測試: 19/19 pass, TSC=0

---

## 1. 目的 (Purpose)

用 10 條 rule-based 算法 (A-J) 判斷股票當前嘅周期 (上升 / 下跌 / 橫行 / 轉勢)。

**核心優勢 vs v0.2.0 Kimi 算法**：
- 簡單直接，無 magic number (所有 threshold 都喺 config.ts)
- 無「三個折扣叠太狠」嘅問題 (multiplier 改成 rule-based)
- 容易測試、容易理解
- 結果係 list of matched rules，synthesizer 用嚟綜合

---

## 2. Input

### 必填
- `klines`: KLine[] (timestamp 升序)

### Optional (config defaults)
| Field | Type | Default | 用途 |
|---|---|---|---|
| `dataWindowDays` | int | 100 | 目標取幾多日數據 |
| `minDataDays` | int | 90 | 少過就報錯 |
| `consecutiveDays` | int | 5 | Case A/B/F/G 嘅連續日數窗口 |
| `reversalWindowDays` | int | 7 | Case H 嘅反轉窗口 |
| `chanceThresholdPct` | float | 0.02 (2%) | Case I/J 嘅 threshold |
| `chanceWindowDays` | int | 5 | Case I/J 嘅連續日數窗口 |
| `chanceConfidenceBonus` | float | 0.10 | Case I/J fire 時 conf bonus |

---

## 3. Output

CycleVerdict 結構：
```typescript
{
  moduleId: 'ma-alignment',
  state: 'UP' | 'DOWN' | 'SIDEWAYS' | 'TRANSITION',
  confidence: number,  // 0-1
  interpretation: string,  // 例: "上升勢；有機會長升狀態"
  evidence: Evidence[],  // 每條 fire 嘅 rule 一個 item
  meta: {
    matchedRules: string[],  // 例: ['A', 'I', 'J']
    ruleLabels: string[],
    latestMA5/MA10/MA60: number,
    dataDays: number,
    configUsed: {...},
  }
}
```

---

## 4. 算法 (10 條 Rule A-J + 2 個 Setup Step)

### ⚙️ Step 1 · 數據驗證
- 攞：klines
- 計：length
- 出：throw error if length < minDataDays (90)
- 否則 take 最近 `dataWindowDays` (100) 日

### ⚙️ Step 2 · 計算 MA history
- 攞：最近 N 日 K 線
- 計：每日 MA5 / MA10 / MA60 (需要 history for Case H 嘅 7 日回看)
- 出：3 個 array (length = N)，每個元素係當日 MA 值

### 📊 Case A · 上升勢
- **條件**：連續 5 日 MA5 > MA60
- **對應 CycleState**：UP
- **Strength**：strong (conf base 0.7)

### 📊 Case B · 下跌勢
- **條件**：連續 5 日 MA5 < MA60
- **對應 CycleState**：DOWN
- **Strength**：strong (conf base 0.7)

### 📊 Case C · 橫行向下
- **條件**：5 日裡 MA5 > MA60 但當日 low < MA60 (即股價跌穿 MA60)
- **對應 CycleState**：SIDEWAYS
- **Strength**：medium (conf base 0.5)

### 📊 Case D · 橫行向上
- **條件**：5 日裡 MA5 < MA60 但當日 high > MA60 (即股價升穿 MA60)
- **對應 CycleState**：SIDEWAYS
- **Strength**：medium (conf base 0.5)

### 📊 Case E · 末位日優先
- **條件**：Case C/D 多過一日時，最後一日為準
- **實作**：lastCDay/lastDDay 已經 reflect (代碼內部邏輯)
- **對應 CycleState**：同 C/D
- **Strength**：同 C/D

### 📊 Case F · 升勢調整向下
- **條件**：5 日裡 MA5 + MA10 都 > MA60，但 MA5 < MA10 (短期轉弱)
- **對應 CycleState**：UP (仲係上升，但轉弱)
- **Strength**：medium (conf base 0.5)

### 📊 Case G · 跌勢調整向上
- **條件**：5 日裡 MA5 + MA10 都 < MA60，但 MA5 > MA10 (短期轉強)
- **對應 CycleState**：DOWN (仲係下跌，但轉強)
- **Strength**：medium (conf base 0.5)

### 📊 Case H · 7 日趨勢反轉 (3 sub-case)
- **條件**：
  - 跌勢轉升勢: 1/2/3 日新方向 (上) + 4-7 日舊方向 (下)
  - 升勢轉跌勢: 1/2/3 日新方向 (下) + 4-7 日舊方向 (上)
- **對應 CycleState**：TRANSITION
- **Strength**：strong (conf base 0.7)

### 📌 Case I · 有機會長升狀態 (Supplementary, 大少 #10301)
- **條件**：連續 5 日 low ≥ MA5 × (1 - 2%)
- **講白咗**：股價守住 MA5 唔大跌穿，支持強
- **對應 CycleState**：supplementary
- **Strength**：weak (conf base 0.5 + bonus +0.10)

### 📌 Case J · 有機會長跌狀態 (Supplementary, 大少 #10301, typo fix #10317)
- **條件**：連續 5 日 **high** ≤ MA5 × (1 + 2%) (用 high 唔係 low，#10317 typo fix)
- **講白咗**：股價升穿唔到 MA5，沽壓強
- **對應 CycleState**：supplementary
- **Strength**：weak (conf base 0.5 + bonus +0.10)

---

## 5. State Derivation

Priority: H > A > B > F > G > C > D > default SIDEWAYS

```
if (H-reverse-up 或 H-reverse-down fire) → state = TRANSITION
else if (A fire) → state = UP
else if (B fire) → state = DOWN
else if (F fire) → state = UP
else if (G fire) → state = DOWN
else if (C 或 D fire) → state = SIDEWAYS
else → state = SIDEWAYS (default — 只有 I/J fire 或無 match)
```

---

## 6. Confidence Derivation

```
base = 0.7   if any strong rule (A/B/H) fires
base = 0.5   if any medium rule (C/D/F/G) fires
base = 0.5   else (only weak rules I/J fire 或無 match)

bonus = 0   else
bonus += 0.10  per weak rule (I/J) fired

confidence = clamp(base + bonus, 0, 1)
confidence = round(confidence, 4)
```

---

## 7. 設計決定 (Decisions)

| # | 決定 | 來源 |
|---|------|------|
| D011 | 3-state 唔 emit TRANSITION (留俾 synthesizer) | 大少 #10273 |
| D012 | Volume 內化做 multiplier (v0.2.0)；v0.3.0 改獨立 module | 大少 #10273 / #10332 |
| D013 | Slope 內化做 multiplier (v0.2.0)；v0.3.0 改獨立 trendline | 大少 #10273 / #10332 |
| D014 | Sub-configs + flat override (v0.2.0)；v0.3.0 簡化 | 大少 #10273 |
| D015 | Actual value 唔 magic rounding | 大少 #10273 |
| D016 | 全部 v0.2.0 Kimi 算法 drop，換 A-J 10 條 rule | 大少 #10332 |

---

## 8. Test Coverage (19/19 pass)

| Test | Scenario | Matched Rules |
|------|----------|---------------|
| T1 | Data validation (< 90 日 throws) | N/A |
| T2 | Case A 上升勢 (linear up 100→110) | [A, I, J], UP |
| T3 | Case B 下跌勢 (linear down 110→100) | [B, I, J], DOWN |
| T4 | Case C 橫行向下 | [A, C] |
| T5 | Case D 橫行向上 | [B, D] |
| T6 | Case F 升勢調整向下 | [A, F, J] |
| T7 | Case G 跌勢調整向上 | [B, G, I] |
| T8 | Case H 7 日反轉 | [H-reverse-up, I], TRANSITION |
| T9 | Case I 有機會長升 | [I, J] |
| T10 | Case J 有機會長跌 | [I, J] |
| T11 | Multi-rule (A+I+J) | [A, I, J] |

---

## 9. 已 Drop (v0.2.0 Kimi 算法)

13 個 v0.2.0 算法全部 drop：
- Step 1 (Kimi 風格) 輸入驗證 + min_length
- Step 2 (Kimi) 計 [5,10,20,60] 最新值
- Step 3 排序 + 形態判定
- Step 4 黏合檢查 (sideways override)
- Step 5 成交量趨勢 (vol mult)
- Step 6 斜率動能 (slope mult)
- Step 7a-d 信心指數 (base × vol × slope formula)
- 信心指數 magic numbers (0.10 / 0.05 / 0.7 / 0.3 等)

---

**最後更新**: 2026-08-05 (大少 #10332)
**維護者**: 大少 + 我 (助手)
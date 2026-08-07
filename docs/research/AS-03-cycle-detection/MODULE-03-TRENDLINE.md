# MODULE 03 · 趨勢線法 v0.1.0 (Trendline Cycle Detector)

> 對應 module: `~/stockpulse/algorithms/AS-03-cycle-detection/modules/trendline.ts`
> 設計者: **大少** (rule-based 算法) + **MiniMax Code** (優化自 Kimi v2.0 spec)
> 版本: **v0.1.0** (取代 Kimi v2.0 statistical model)
> 測試: TBD (目標 12+ test cases)
> 創建日期: 2026-08-07

---

## 1. 目的 (Purpose)

用最近 N 個交易日嘅關鍵高低極值（峰/谷），通過**簡單線性回歸**擬合 support line + resistance line，再根據 **10 條 rule (A-J)** 判斷股票當前所處嘅周期（上升 / 下跌 / 橫行 / 轉勢）。

**核心定位:** Module 1 (MA Alignment) 睇 **「均線方向」** , Module 2 (HL Structure) 睇 **「高低點形態」**, Module 3 (Trendline) 睇 **「通道 + 突破」**, 三者互補。

---

## 2. 從 Kimi v2.0 嘅優化

| 項目 | Kimi v2.0 (太複雜) | v0.1.0 (大少風格) |
|------|---------------------|-------------------|
| 演算法 | RANSAC + 成交量加權 + ATR normalized + R² dynamic point selection | **簡單 OLS 線性回歸** |
| 結果表達 | 12 步 statistical pipeline，4 個 multiplier 加乘 | **10 條 rule (A-J)**，additive confidence |
| Output | 22 個 field (channel, breakout, projection, R², percent_b...) | **8 個核心 field** (testing page 友善) |
| 信心計算 | base × multi-factor multiplier (complex) | **base + 0.10 per weak rule** (簡單) |
| 規則 | 0 條 explicit rule，全 statistical | **10 條 explicit rule**，跟 ma-alignment 風格一致 |
| 觸線判定 | 容忍度 + 反彈 + 成交量確認 (3 個 metric) | 容忍度 + 反彈幅度 (2 個 metric) |
| 突破判定 | 真假突破 + retrace % + confirm days | 簡化為「最近 N 日 close 穿越 + stay N 日」 |

**保留嘅核心概念:**
- ✅ Support line (支撐線) + Resistance line (壓力線) — 兩條線擬合
- ✅ Channel (通道) 寬度 + 中位 %B
- ✅ 觸線 (touches) 統計
- ✅ 突破 (breakout) 判定 — 簡化版
- ✅ 線性投影 (未來 N 日 support/resistance 預測值)
- ✅ Slope sign (上升/下降) 判定 cycle 方向

**移除嘅複雜度:**
- ❌ RANSAC (簡單 OLS 已經夠 — 5 個 extreme point 唔會有嚴重 outlier)
- ❌ 成交量加權擬合 (V6 volume-price module 已經 handle)
- ❌ ATR 歸一化斜率 (直接用 raw slope sign 已經清楚)
- ❌ 假/真突破 multiplier (簡化判定：「close 穿越 + stay N 日」= 真突破)
- ❌ %B 指標 (channel width + 當前 close 位置已經夠)
- ❌ 反彈一致性 STD 計算 (簡化為 avg bounce % 一個 metric)

---

## 3. Input

### 必填
- `klines`: `KLine[]` (timestamp 升序, 至少 30 條)

### Optional (config defaults, 喺 `config.ts` 入面)
| Field | Type | Default | 用途 |
|---|---|---|---|
| `dataWindowDays` | int | 100 | 取最後幾多日數據做擬合 |
| `extremeWindow` | int | 3 | 識別極值點嘅左右觀察窗口 |
| `minLinePoints` | int | 3 | 趨勢線最少擬合點數 (唔夠就 fallback) |
| `maxLinePoints` | int | 8 | 趨勢線最多擬合點數 (動態選擇 R² 最高) |
| `minR2` | float | 0.55 | 最低 R² 要求 (rule trigger 條件) |
| `touchTolerancePct` | float | 0.015 | 觸線判定容忍度 (1.5%) |
| `breakoutWindow` | int | 5 | 過去 N 日內突破先當 breakout |
| `breakoutConfirmDays` | int | 2 | 突破後 stay on other side 嘅最少日數 |
| `projectionDays` | int | 5 | 趨勢線目標價投影天數 |

---

## 4. 10 條 Rule (A-J) — 大少風格

| # | 規則 | 觸發條件 | Strength | 對應 State hint |
|---|------|---------|----------|-----------------|
| **A** | 支撐線上升 | `support_slope > 0` AND `support_r2 ≥ minR2` | strong | UP |
| **B** | 壓力線下降 | `resistance_slope < 0` AND `resistance_r2 ≥ minR2` | strong | DOWN |
| **C** | 通道窄 + 中位 | `channel_width_pct < 0.03` AND `0.4 ≤ percent_b ≤ 0.6` | medium | SIDEWAYS |
| **D** | 收斂三角形 | `support_slope > 0` AND `resistance_slope < 0` | medium | SIDEWAYS |
| **E** | 上升楔形 | `support_slope > 0` AND `|resistance_slope| ≤ 0.001` | medium | UP |
| **F** | 下降楔形 | `|support_slope| ≤ 0.001` AND `resistance_slope < 0` | medium | DOWN |
| **G** | 真跌破支撐 | 最近 5 日內 `close < support_value` AND stay below ≥ 2 日 | strong | DOWN |
| **H** | 真突破壓力 | 最近 5 日內 `close > resistance_value` AND stay above ≥ 2 日 | strong | UP |
| **I** | 支撐有效 | `support_touches ≥ 2` AND `avg_bounce_pct ≥ 0.01` | weak | UP confirm |
| **J** | 壓力有效 | `resistance_touches ≥ 2` AND `avg_bounce_pct ≥ 0.01` | weak | DOWN confirm |

**註:**
- Rule A 同 E 都可以同時 fire (上升楔形有支撐上升)，additive confidence
- Rule I 同 J 唔單獨 trigger state，淨係 confidence +0.10 bonus
- 突破 rule (G/H) priority 最高 (短期事件) — 喺 State derivation 排最前
- Rule C 同 D 都係 SIDEWAYS hint，但 D priority 高過 C (三角形突破風險高過窄通道)
- Rule G 嘅「跌破」意思係 `close < support_value`，`support_value` 係用最新一天嘅 index 計出嚟
- 數據不足 (< `minLinePoints` 個 extreme point) → fallback SIDEWAYS, 0 confidence

---

## 5. State derivation priority

跟 ma-alignment.ts 一致嘅 priority scheme:

```
H (真突破壓力)
> A (支撐上升)
> B (壓力下降)
> F (下降楔形)
> G (真跌破支撐)
> C (通道窄 + 中位)
> D (收斂三角形)
> default SIDEWAYS
```

**特殊規則:**
- 如果 rule H 同 G 同時 fire (突破壓力線 + 跌破支撐線同時發生) → **TRANSITION**
- 如果 rule A 同 B 同時 fire (支撐上升 + 壓力下降) → 收斂三角形 = SIDEWAYS
- 如果 rule E 同 F 同時 fire (上升楔形 + 下降楔形) → impossible, skip
- Rule I/J 唔影響 state derivation, 淨係加 confidence

---

## 6. Confidence formula

跟 ma-alignment.ts 一致:

```
base = 0.7 if any strong rule (A/B/G/H) fires
     = 0.5 if any medium rule (C/D/E/F) fires
     = 0.5 if only weak rules (I/J) fire

+ 0.10 per weak rule (I/J) fired
- 0.05 if R² < minR2 (one or both lines low fit)
- 0.10 if latest_extreme_age > 30 days (趨勢線老化)

cap at 1.0, round to 4 decimals
```

**Adjustment log 記錄咗所有加減, 方便 debug 同 testing.**

---

## 7. Output (簡化版)

```typescript
interface TrendlineVerdict extends CycleVerdict {
  state: 'UP' | 'DOWN' | 'SIDEWAYS' | 'TRANSITION'
  confidence: number  // 0.0 - 1.0
  baseConfidence: number
  matchedRules: string[]  // ['A', 'G']
  ruleLabels: string[]  // ['支撐線上升', '真跌破支撐']
  meta: {
    supportLine: {
      slope: number
      r2: number
      numPoints: number
      intercept: number
      currentValue: number
      touches: number
      avgBouncePct: number
    }
    resistanceLine: {
      slope: number
      r2: number
      numPoints: number
      intercept: number
      currentValue: number
      touches: number
      avgBouncePct: number
    }
    channel: {
      widthPct: number  // (resistance - support) / mid
      percentB: number  // (close - support) / (resistance - support)
    }
    breakout: {
      isBreakout: boolean
      direction: 'support' | 'resistance' | 'none'
      type: 'true' | 'false' | 'unknown'
      daysSince: number
    }
    latestClose: number
    latestExtremeAge: number  // days since most recent extreme
    projection: {
      days: number
      supportFuture: number
      resistanceFuture: number
      midFuture: number
    }
    dataDays: number
    configUsed: TrendlineConfig
  }
  reason: string  // plain language summary
  adjustmentLog: string[]  // 信心調整記錄
  timeframe: '1d' | '1w'
}
```

**8 個核心 field** 適合 testing page 直接顯示:
1. `state` + `confidence` (大色塊)
2. `matchedRules` + `ruleLabels` (rule 列表)
3. `meta.supportLine` (斜率 / R² / touches)
4. `meta.resistanceLine` (斜率 / R² / touches)
5. `meta.channel` (寬度 + %B)
6. `meta.breakout` (突破狀態)
7. `meta.projection` (未來 N 日預測)
8. `meta.adjustmentLog` (信心調整記錄)

---

## 8. Algorithm step-by-step (簡化版)

**Step 0: 輸入驗證**
- `klines.length >= 30` (基本需要)
- `dataWindowDays` 預設 100 (目標 100 日)
- 數據按 timestamp 升序

**Step 1: 識別極值點 (peaks + troughs)**
- 對每個 index i (從 `extremeWindow` 到 `n-extremeWindow-1`):
  - `current.high > max(left_highs, right_highs)` → peak
  - `current.low < min(left_lows, right_lows)` → trough
- 結果: `peaks[]` + `troughs[]` (每個有 date, close, high, low, index, volume)

**Step 2: 簡單線性回歸擬合 support + resistance line**
- 取最後 `n` 個 extreme points (n 喺 [minLinePoints, maxLinePoints] 範圍, 動態選 R² 最高)
- Support line: fit (x_i, low_i) by OLS
  - `slope = Σ(x-x̄)(y-ȳ) / Σ(x-x̄)²`
  - `intercept = ȳ - slope * x̄`
  - `r2 = 1 - SS_res / SS_tot`
- Resistance line: fit (x_i, high_i) by OLS (同樣)
- 動態選點數: 試 minLinePoints 到 maxLinePoints, 選 R² 最高嗰個

**Step 3: 計算 channel + percentB**
- `support_value = slope * latest_index + intercept` (per line)
- `channel_width = resistance_value - support_value`
- `channel_width_pct = channel_width / ((support_value + resistance_value) / 2)`
- `percent_b = (latest_close - support_value) / channel_width` (避免除零)

**Step 4: 觸線統計 (touches)**
- 對每個非 fit 點 i:
  - Support touch: `price[i].low <= support_value * (1 + touch_tolerance)` (i = slope*i + intercept)
  - Resistance touch: `price[i].high >= resistance_value * (1 - touch_tolerance)`
- 計算每次觸線後 4 日內嘅反彈幅度 (close vs 最高/最低)
- Output: `touches` (count), `avg_bounce_pct` (平均反彈)

**Step 5: 突破判定 (breakout)**
- 過去 `breakoutWindow` 個 bar (預設 5 日):
  - Support breakout: `close < support_value` AND 之前 close `>= support_value` (跌破穿越)
  - Resistance breakout: `close > resistance_value` AND 之前 close `<= resistance_value` (突破穿越)
- 真突破 = 穿越後 `breakoutConfirmDays` 個 bar 都 stay on other side
- 假突破 = 穿越後 pull back > 50% (簡化: 穿越後又 close 返另一邊)

**Step 6: 投影 (projection)**
- `support_future = support_slope * (latest_index + projection_days) + support_intercept`
- `resistance_future = resistance_slope * (latest_index + projection_days) + resistance_intercept`
- `mid_future = (support_future + resistance_future) / 2`

**Step 7: 觸發 10 條 Rule (A-J)**
- 對每條 rule 評估條件, 記錄 matchedRules
- 同時調整 base confidence (strong/medium/weak)

**Step 8: State derivation**
- 按 priority H > A > B > F > G > C > D > default
- 特殊情況: H + G → TRANSITION

**Step 9: Confidence adjustment**
- base + 0.10 per weak rule
- -0.05 if R² < minR2
- -0.10 if latest extreme > 30 days old
- cap 1.0

**Step 10: 組裝 verdict + reason**

---

## 9. 邊界條件與異常處理

| 情境 | 處理方式 |
|------|----------|
| 數據不足 (< 30 條) | throw Error, message "數據不足, 至少需要 30 條" |
| 極值點數量 < minLinePoints | fallback: state = SIDEWAYS, confidence = 0.3, reason = "極值點不足" |
| 通道寬度 = 0 (support = resistance) | percent_b = 0.5 (避免除零) |
| 斜率 = 0 (水平線) | rule A/B/E/F 唔 fire, 視為 sideways |
| 突破 window 內無突破 | `isBreakout = false`, type = 'unknown' |
| 同時觸發 H + G | state = TRANSITION (短線反轉訊號) |
| R² < 0 (fit 差過 mean) | 設 R² = 0, rule 唔 fire |
| price data 唔升序 | throw Error |

---

## 10. Testing Strategy

**目標: 12+ test cases**

| # | 測試名 | 輸入 | 預期 |
|---|--------|------|------|
| T1 | 數據不足 (< 30 條) | 20 條 K 線 | throw Error |
| T2 | 數據充足 OK | 100 條上升趨勢 | state = UP, rule A fire |
| T3 | 數據充足 OK | 100 條下跌趨勢 | state = DOWN, rule B fire |
| T4 | 上升趨勢 + R² 高 | 100 條 clear uptrend | R² ≥ 0.7, A fire, confidence ≥ 0.7 |
| T5 | 下跌趨勢 + 楔形 | 100 條 down wedge | F fire, state = DOWN |
| T6 | 橫行窄通道 | 100 條 sideways < 2% | C fire, state = SIDEWAYS |
| T7 | 收斂三角形 | support up + resistance down | D fire, state = SIDEWAYS |
| T8 | 真突破壓力 | close 穿越 resistance, stay above 2 日 | H fire, state = UP, breakout = resistance/true |
| T9 | 真跌破支撐 | close 穿越 support, stay below 2 日 | G fire, state = DOWN, breakout = support/true |
| T10 | 假突破 | close 穿越後 pull back | type = 'false', adjustment log 有 entry |
| T11 | 極值點不足 | 只得 2 個 peak | fallback SIDEWAYS, confidence 0.3 |
| T12 | H + G 同時 | 同時突破兩條線 | state = TRANSITION |
| T13 (bonus) | 弱 rule 累積 | I + J + C 都 fire | confidence = 0.5 + 0.20 = 0.7 |
| T14 (bonus) | R² 老化 | 90 日前嘅 extreme | adjustment log 有 entry, -0.10 confidence |

**Edge case test:**
- 通道寬度 = 0 → percent_b = 0.5
- 空 volume → fit 唔 crash
- 全部 close 都係同一價 → slope = 0, R² = 0

---

## 11. File Structure

```
algorithms/AS-03-cycle-detection/
├── modules/
│   └── trendline.ts          ← 主 module (TrendlineModule class)
├── __tests__/
│   └── trendline.test.mjs    ← 12+ test cases
├── adapter.mjs                ← 加 analyzeTrendline, renderTrendlineResult
└── config.ts                  ← DEFAULT_TRENDLINE_CONFIG
```

**測試 command:**
```bash
cd ~/stockpulse/algorithms/AS-03-cycle-detection
node --experimental-strip-types __tests__/trendline.test.mjs
```

---

## 12. 與其他 Modules 嘅關係

- **Module 1 (ma-alignment)**: 兩者都睇 trend，但角度唔同
  - MA: 用 close 計均線方向 (短中長期均線)
  - Trendline: 用 high/low 計支撐壓力線 + 通道
- **Module 2 (HL Structure)**: Trendline 嘅極端點 = HL Structure 嘅 peaks/troughs
  - 共用 extreme detection 邏輯 (future: extract helper)
- **Module 5 (Volume OBV)**: Volume 確認做過 simplified 版, 唔重複
- **Module 8 (Confluence)**: 未來會用 Trendline verdict 嘅 `matchedRules` 計分

---

## 13. 永久設計原則 (跟 ma-alignment)

- ✅ Rule-based, additive confidence (無 multiplicative)
- ✅ List all matched rules, 唔好 silently pick 一個
- ✅ 全部 threshold 喺 `config.ts`, algorithm 入面無 magic number
- ✅ 簡單 plain language 解釋 (`reason` field)
- ✅ Testing page render 用 `renderTrendlineResult` + `renderChartOverlay`
- ✅ 每次 commit 一個 module, 唔 mega commit

---

**最後更新:** 2026-08-07 (v0.1.0 spec 草案)
**維護者:** 大少 + MiniMax Code

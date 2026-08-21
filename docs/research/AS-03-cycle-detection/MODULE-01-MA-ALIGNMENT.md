# AS-03 · Module 1: 均線系統週期判斷法 v2.0 (MA Cycle Detector with Volume & Slope)

> **對應 docx**: `docs/演算法概念SPECS/01均線系統週期判斷法.docx` (Kimi v2.0 spec)
> **對應 TS 檔**: `algorithms/AS-03-cycle-detection/modules/ma-alignment.ts` (新寫, v2.0)
> **對應 tests**: `algorithms/AS-03-cycle-detection/__tests__/ma-alignment.test.mjs` (新寫)
> **對應 adapter**: `algorithms/AS-03-cycle-detection/adapter.mjs` (`maAlignmentV2Adapter`)
>
> **大少 2026-08-08 09:13 指示**: 舊 M1 嘅 v0.3.0 (10 rules A-J, 4 states H/A/B/F/G/C/D + TRANSITION) 抽離做獨立算法叫 **zmen均算法**, moduleId 保留 'ma-alignment', spec doc 改叫 `ZMEN-MA-ALIGNMENT.md`。
>
> 新 M1 v2.0 跟 Kimi 出嘅 docx spec 重新做, 3 個 cycle state (uptrend / downtrend / sideways) + 成交量加權 + 斜率動能 兩維度擴展。

---

## 1. 點解呢個 module (Why)

前 6 個 module 各自答一個維度嘅問題:
- M2 HL Structure → 「峰谷結構」
- M3 Trendline → 「支撐壓力」
- M4 Indicators → 「動能背馳 / 衰竭」
- M5 VolumePrice v2.0 → 「資金跟進 / 突破驗證」
- M6 Volatility → 「波動率收縮 / 擴張」

**新 M1 v2.0 答「而家係咩季節」嘅核心問題** — 用最基本嘅均線排列做第一道判斷, 再用成交量同斜率兩維度做信心調整。

**舊 M1 v0.3.0 vs 新 M1 v2.0 對比**:

| 維度 | 舊 M1 v0.3.0 (zmen均算法) | 新 M1 v2.0 (均線系統週期判斷法) |
|------|---------------------------|--------------------------------|
| Cycle states | 4 個 (UP / DOWN / SIDEWAYS / TRANSITION) | 3 個 (uptrend / downtrend / sideways) |
| Rules | 10 條 (A-J) | 1 個 3 步算法 (排列 + 粘合 + 信心) |
| 成交量 | ❌ 冚考慮 | ✅ 加權調整 (volume_multiplier 0.65-1.25) |
| 斜率 | ❌ 冚考慮 | ✅ 動能調整 (slope_multiplier 0.7-1.0) |
| 信心指數 | 規則強弱 (strong/medium/weak) 計 confidence | base × volume × slope 三階段調整 |
| 適用場景 | rule-based 識別走勢 + 轉勢 (H rule 7 日反轉) | 平滑化判斷, 加量能 + 動能 信心微調 |

**新 M1 嘅 4 個核心 insight (docx 摘要)**:
1. **均線排列 = 基礎判定** — MA5 > MA10 > MA20 > MA60 排列 = 上升, 倒置 = 下跌, 其他 = 橫行
2. **均線粘合 = 強制覆寫** — 即係排列係升/跌, 但 spread < 2% 都係橫行 (代表無真方向)
3. **成交量加權** — 升 + 放量 = 加分, 升 + 縮量 = 打折, 跌 + 放量 = 趨勢確認
4. **斜率動能** — 短期 MA 斜率為負 = 上升動能減弱, 長期 MA 斜率轉正 = 下跌動能減弱

## 2. 跟其他 module 嘅協同 (跟 docx 概念)

| Module | 佢答嘅問題 | 新 M1 補充 |
|---|---|---|
| **新 M1 v2.0** | **均線排列 + 量能 + 動能 綜合週期判定** | **「基於 MA + Volume + Slope 嘅 cycle 判定 + 信心指數」** |
| M2 HL Structure | 峰谷結構 | 「MA 話升, 但 HL 結構未見 HH/HL → 等結構確認」 |
| M3 Trendline | 支撐壓力 | 「MA 話升, 但價格跌破支撐線 → MA 可能轉弱」 |
| M4 Indicators | 動能背馳 / 衰竭 | 「MA 話升, 但 RSI/MACD 背馳 → 動能見頂」 |
| M5 VolumePrice | 資金跟進 | 「M1 縮量升 vs M5 量价背馳 → 兩個都見頂警號」 |
| M6 Volatility | 波動率 | 「MA 話橫行 + Squeeze → 蓄力, 等待突破」 |

**典型用法**:
- 新 M1 話 uptrend 信心 0.8 + M2 HL 見 HH + M5 話 confirming → 強烈上升
- 新 M1 話 uptrend 但 confidence 0.4 (斜率轉負 + 縮量) + M4 RSI 背馳 → 上升見頂警號
- 新 M1 話 sideways 信心 0.7 + M6 話 Squeeze forming → 蓄力觀察, 等突破信號

## 3. 輸入 (跟 docx §2)

| Field | Type | Required | Default | 說明 |
|-------|------|----------|---------|------|
| `klines` | KLine[] | ✅ | — | 歷史 K 線, 按日期升序, 每條要有 `date`, `close`, `volume` |
| `symbol` | string | ❌ | — | 股票代碼 (optional, for display) |
| `maPeriods` | int[] | ❌ | `[5, 10, 20, 60]` | 均線週期列表 (預設 4 條) |
| `thresholdPct` | float / null | ❌ | `null` (adaptive) | 橫行判定閾值。`null` = 用 v2.2.0 adaptive 自動計 (20 日 ATR% × 1.5, clamp 0.5%-5%)。傳數字 = 固定 override |
| `enableVolumeWeight` | bool | ❌ | `true` | 啟用成交量加權 |
| `enableSlopeCheck` | bool | ❌ | `true` | 啟用斜率動能調整 |
| `volumeLookback` | int | ❌ | `5` | 成交量比較區間長度 (日) |
| `slopeLookback` | int | ❌ | `5` | 斜率計算回顧天數 (日) |
| `volumeBoostThreshold` | float | ❌ | `1.2` | 放量比率門檻 (後段/前段) |
| `volumeShrinkThreshold` | float | ❌ | `0.8` | 縮量比率門檻 |
| `slopeDiscountFactor` | float | ❌ | `0.7` | 短期 MA 斜率為負時的信心折扣 |

**Min data 計算** (docx §4 Step 1):
```
min_length_for_ma    = max(ma_periods) + 5          // e.g. 60+5 = 65
min_length_for_slope = max(ma_periods) + slope_lookback + 5   // e.g. 60+5+5 = 70
min_length_for_vol   = volume_lookback * 2 + 5      // e.g. 10+5 = 15
required_length      = MAX(min_length_for_ma, min_length_for_slope, min_length_for_vol)
                      = max(65, 70, 15) = 70 (預設)
```

**KLine 格式** (每條):
```typescript
{
  date: string,     // "2026-07-01"
  close: number,
  volume: number,   // enable_volume_weight=true 時必填
}
```

## 4. 輸出 (跟 docx §3)

```typescript
interface MAAlignmentV2Verdict {
  symbol: string;
  cycle: 'uptrend' | 'downtrend' | 'sideways';     // 最終 cycle 判定
  cycleLabel: string;                                // "上升週期" / "下跌週期" / "橫行週期"
  confidence: number;                                // 綜合信心指數 0.0~1.0 (三階段調整後)
  baseConfidence: number;                            // 基礎信心 (僅 MA 排列 + spread)
  maValues: Record<string, number>;                  // e.g. { MA5: 155.0, MA10: 153.5, MA20: 150.0, MA60: 145.0 }
  maRanks: string[];                                 // 均線由大到小排序, e.g. ["MA5", "MA10", "MA20", "MA60"]
  maSlopes: Record<string, number>;                  // 各週期均線斜率 (百分比變化)
  momentumScore: number;                             // 加權動能分數 (短期 MA 權重高)
  volumeTrendRatio: number;                          // 近期均量 / 前期均量
  volumeSignal: 'expanding' | 'shrinking' | 'neutral';
  maxSpreadPct: number;                              // 各均線間最大價差百分比
  adjustmentLog: string[];                           // 信心指數調整記錄
  reason: string;                                    // 綜合判斷理由 (人話)
  lastDate: string;                                  // 最新一筆數據日期
}
```

**State mapping (testing page)**:
- `uptrend` → 上升週期
- `downtrend` → 下跌週期
- `sideways` → 橫行週期

## 5. Algorithm 步驟 (跟 docx §4)

### Step 1: 輸入驗證
- 檢查 `klines.length >= required_length`
- 檢查日期升序排列
- 若 `enable_volume_weight=true`, 檢查每條 kline 有 `volume` field

### Step 2: 計算各週期 MA 最新值
```typescript
for (const period of maPeriods) {
  const tail = klines.slice(-period).map(k => k.close);
  maValues[`MA${period}`] = tail.reduce((a, b) => a + b, 0) / period;
}
```

### Step 3: 均線排序與形態判定
- `maRanks` = 按 maValues 由大到小排嘅 key 列表
- 若 `maRanks` 的週期順序 == `maPeriods` (由小到大) → `candidate = "uptrend"`
- 若 `maRanks` 的週期順序 == `reverse(maPeriods)` (由大到小) → `candidate = "downtrend"`
- 否則 → `candidate = "sideways"`

### Step 4: 橫行週期精細判定 (均線粘合檢查)
- `max_spread_pct = (max(ma_values) - min(ma_values)) / min(ma_values)`
- `threshold_pct` 解析 (v2.2.0, 大少 2026-08-21 18:37):
  - 若 `config.thresholdPct` 係 number → 用固定 (fixed override)
  - 若 `config.thresholdPct` 係 `null` → adaptive mode: `thresholdPct = clamp(MA20_ATR% × 1.5, 0.5%, 5%)`
  - 凡人話: 每隻股用自己最近 20 日真實波幅 (ATR%) 自動決定門檻, 低波動股門檻細, 高波動股門檻大
- 若 `candidate IN [uptrend, downtrend]` AND `max_spread_pct < threshold_pct`:
  - 覆寫 → `candidate = "sideways"`
  - log: "均線雖有排列但過於靠近，視為橫行整理"
- 詳細 adaptive 算法見 §15 (v2.2.0 Adaptive ThresholdPct)

### Step 5: 成交量趨勢計算 (僅 enable_volume_weight=true)
- `recent_prices = price_data 最後 volume_lookback 筆`
- `previous_prices = price_data 倒數第 (volume_lookback*2) 筆 至 倒數第 (volume_lookback+1) 筆`
- `volume_trend_ratio = recent_avg_vol / previous_avg_vol` (若分母 = 0, 設 1.0)
- 判定:
  - ratio >= 1.2 → `expanding`
  - ratio <= 0.8 → `shrinking`
  - 否則 → `neutral`

### Step 6: 均線斜率與動能分數 (僅 enable_slope_check=true)
```typescript
for (const period of maPeriods) {
  const currentMA = maValues[`MA${period}`];
  const pastSegment = klines.slice(-(period + slopeLookback), -slopeLookback);
  const pastMA = avg(pastSegment.map(k => k.close));
  maSlopes[`MA${period}`] = (currentMA - pastMA) / pastMA;
}

// 動能分數 (短期 MA 權重高)
total_weight = sum(1/p for p in maPeriods);
momentumScore = sum(maSlopes[`MA${p}`] * (1/p) / total_weight for p in maPeriods);
```

### Step 7: 信心指數 (三階段調整)

**7a. 基礎信心 (base_confidence)**:
```typescript
if (cycle === 'uptrend' || cycle === 'downtrend') {
  base_confidence = MIN(1.0, max_spread_pct / 0.10);
  if (max_spread_pct < 0.05) base_confidence *= 0.7;
} else { // sideways
  base_confidence = MAX(0.3, 1.0 - ABS(max_spread_pct - threshold_pct) / threshold_pct);
}
```

**7b. 成交量加權調整 (vol_multiplier)** — 預設 1.0, 跟 cycle × volume_signal 各自調整:

| cycle | volume_signal | multiplier | log |
|-------|---------------|-----------|-----|
| uptrend | expanding | `MIN(1.25, 1.0 + (ratio - 1.0) * 0.5)` | 放量上漲, 信心提升 |
| uptrend | shrinking | `MAX(0.65, 1.0 - (1.0 - ratio) * 0.8)` | 上漲縮量, 信心打折 |
| uptrend | neutral | 1.0 | — |
| downtrend | expanding | 1.15 | 放量下跌, 趨勢確認 |
| downtrend | shrinking | 0.85 | 下跌縮量, 動能可能不足 |
| downtrend | neutral | 1.0 | — |
| sideways | shrinking | 1.15 | 縮量整理, 橫行信號增強 |
| sideways | expanding | 0.85 | 放量震盪, 可能醞釀突破 |
| sideways | neutral | 1.0 | — |

**7c. 斜率動能調整 (slope_multiplier)** — 預設 1.0:
```typescript
const shortPeriods = sorted(maPeriods).slice(0, 2);  // 最短期的兩條, e.g. [5, 10]
const negativeCount = count(maSlopes[`MA${p}`] < 0 for p in maPeriods);

if (cycle === 'uptrend') {
  if (any(maSlopes[`MA${p}`] < 0 for p in shortPeriods)) {
    slope_multiplier = 0.7;  // 短期均線斜率為負, 上升動能減弱
  } else if (negativeCount > 0) {
    slope_multiplier = 0.85;  // 部分長期均線斜率為負
  } else {
    slope_multiplier = 1.0;
  }
} else if (cycle === 'downtrend') {
  const longPeriod = max(maPeriods);  // e.g. 60
  if (maSlopes[`MA${longPeriod}`] > 0) {
    slope_multiplier = 0.8;  // 長期均線斜率轉正, 下跌動能減弱
  } else if (any(maSlopes[`MA${p}`] > 0 for p in shortPeriods)) {
    slope_multiplier = 0.9;  // 短期均線斜率轉正, 可能醞釀反彈
  } else {
    slope_multiplier = 1.0;
  }
} else { // sideways
  const avgAbsSlope = avg(abs(maSlopes[`MA${p}`]) for p in maPeriods);
  if (avgAbsSlope > 0.005) {  // 0.5% 平均變化率
    slope_multiplier = 0.8;  // 均線斜率過大, 橫行周期可能即將結束
  } else {
    slope_multiplier = 1.0;
  }
}
```

**7d. 綜合信心指數**:
```typescript
confidence = base_confidence * vol_multiplier * slope_multiplier;
confidence = CLAMP(confidence, 0.0, 1.0);
confidence = ROUND(confidence, 4);
```

### Step 8: 組裝輸出
按 docx §4 Step 8 格式組裝 verdict, 包含全部 13 個 output fields。

## 6. Cycle State 判定 (3 個)

| State | 意思 | 對應 State Machine 顏色 |
|-------|------|------------------------|
| `uptrend` | 上升週期 | 🟢 綠色 |
| `downtrend` | 下跌週期 | 🔴 紅色 |
| `sideways` | 橫行週期 | 🟡 黃色 |

**對比舊 M1 v0.3.0 (zmen均算法)**:
- 舊 M1 嘅 4 個 state (UP / DOWN / SIDEWAYS / TRANSITION) → 簡化做 3 個
- TRANSITION 移除: 因為新 M1 用 volume + slope 兩維度做信心微調, 轉勢訊號由 M4 Indicators (動能背馳) 同 M2 HL Structure (峰谷結構) 負責

## 7. 邊界條件 (跟 docx §6)

| 情境 | 處理方式 |
|------|----------|
| 數據點不足 | 返回錯誤, 提示 `required_length` (預設 70 條) |
| volume 缺失但啟用成交量加權 | 返回錯誤: "volume field required when enable_volume_weight is true" |
| previous_avg_vol == 0 | volume_trend_ratio 設為 1.0, 視為持平 |
| 所有 MA 值完全相等 | max_spread_pct = 0, candidate = sideways, confidence 依縮量/斜率調整 |
| 斜率計算段包含 null 收盤價 | 返回錯誤 |
| 數據未按日期升序排列 | 返回錯誤 |

## 8. Testing Page 3 個 Sections (永久 Rule, 大少 #11056)

**每個 module 嘅 `renderMAAlignmentV2Result()` 必須 render 3 個 sections**:

### 📖 詳細解讀 (人話解 13 個 output fields)
- `cycle` + `cycleLabel` → 股票而家係咩 cycle
- `confidence` + `baseConfidence` → 信心指數 (綜合 vs 基礎, 差 = 調整幅度)
- `maValues` + `maRanks` → 4 條均線嘅數值 + 排列
- `maSlopes` → 4 條均線嘅斜率 (正 = 升, 負 = 跌)
- `momentumScore` → 加權動能分數
- `volumeTrendRatio` + `volumeSignal` → 量能訊號
- `maxSpreadPct` → 均線 spread
- `adjustmentLog` → 信心指數調整記錄
- `lastDate` → 數據日期

### 🎯 策略建議 (按 cycle state)
- **uptrend (信心 >= 0.7)**: 上升趨勢確認, 可考慮持有 / 逢回調加倉
- **uptrend (信心 < 0.5)**: 上升動能減弱 (縮量 / 斜率轉負), 留意見頂警號
- **downtrend (信心 >= 0.7)**: 下跌趨勢確認, 觀望 / 減倉
- **downtrend (信心 < 0.5)**: 下跌動能減弱 (縮量 / 長期斜率轉正), 留意反彈機會
- **sideways (信心 >= 0.7)**: 橫行確認, 等待突破方向
- **sideways (信心 < 0.5)**: 假橫行, 可能即將有方向

### 💡 點用點睇 (10 步 step-by-step guide)
1. 睇 `cycle` 同 `cycleLabel` 知而家係咩 season
2. 對比 `confidence` 同 `baseConfidence`, 差越大 = 調整越多
3. 睇 `adjustmentLog` 知做咗咩 discount / boost
4. 睇 `maRanks` 確認排列係咪典型 (5/10/20/60 由細到大 = 標準多頭)
5. 睇 `maSlopes` 知邊條 MA 仲升 / 已轉負
6. 睇 `volumeSignal` + `volumeTrendRatio` 知錢跟唔跟
7. 對比 M2 HL Structure 結果, 確認峰谷結構
8. 對比 M4 Indicators 結果, 確認動能 / RSI / MACD 狀態
9. 對比 M5 VolumePrice 結果, 確認量价背馳
10. 結合多個 module 結果做最終決策

## 9. 範例 (跟 docx §7)

**情境**: 多頭排列但短期斜率轉負 + 縮量

**輸入**:
```json
{
  "symbol": "AAPL",
  "ma_periods": [5, 10, 20, 60],
  "enable_volume_weight": true,
  "enable_slope_check": true,
  "slope_discount_factor": 0.7
}
```

**計算中間值**:
- `ma_ranks`: ["MA5", "MA10", "MA20", "MA60"] → candidate = uptrend
- `max_spread_pct`: 0.08 → 未觸發橫行覆寫 (> 0.02 閾值)
- `volume_trend_ratio`: 0.75 → `volume_signal` = "shrinking"
- `ma_slopes`: {"MA5": -0.002, "MA10": 0.001, "MA20": 0.003, "MA60": 0.008}
- MA5 斜率為負 → 觸發動能減弱折扣

**信心指數計算**:
- `base_confidence = MIN(1.0, 0.08/0.10) = 0.8` (spread = 8% 接近 10% 上限)
- `vol_multiplier = MAX(0.65, 1.0 - 0.25*0.8) = 0.8` (縮量上漲扣分)
- `slope_multiplier = 0.7` (MA5 斜率為負)
- `confidence = 0.8 * 0.8 * 0.7 = 0.448` → 經調整後信心顯著降低

**輸出**:
```json
{
  "symbol": "AAPL",
  "cycle": "uptrend",
  "cycleLabel": "上升週期",
  "confidence": 0.448,
  "baseConfidence": 0.8,
  "maValues": {"MA5": 155.0, "MA10": 153.5, "MA20": 150.0, "MA60": 145.0},
  "maRanks": ["MA5", "MA10", "MA20", "MA60"],
  "maSlopes": {"MA5": -0.002, "MA10": 0.001, "MA20": 0.003, "MA60": 0.008},
  "momentumScore": 0.0015,
  "volumeTrendRatio": 0.75,
  "volumeSignal": "shrinking",
  "maxSpreadPct": 0.0689,
  "adjustmentLog": [
    "上漲縮量，信心打折",
    "短期均線斜率為負，上升動能減弱"
  ],
  "reason": "【週期】上升週期；上漲縮量，信心打折；短期均線斜率為負，上升動能減弱",
  "lastDate": "2026-08-02"
}
```

## 10. Tests 規劃

`__tests__/ma-alignment.test.mjs` 14+ 個 tests, 19+ 個 assertions:

| Test | 描述 | Assertions |
|------|------|------------|
| T1 | 標準多頭排列 (5/10/20/60 升序) → uptrend + base 0.8 | 3 |
| T2 | 標準空頭排列 (5/10/20/60 降序) → downtrend + base 0.8 | 3 |
| T3 | 無序排列 → sideways | 2 |
| T4 | 升序排列但 spread < 2% → 強制 sideways | 2 |
| T5 | 升 + 放量 (ratio=1.5) → vol_mult 1.25 | 1 |
| T6 | 升 + 縮量 (ratio=0.5) → vol_mult 0.65 (CLAMP) | 1 |
| T7 | 跌 + 放量 → vol_mult 1.15 | 1 |
| T8 | 橫 + 縮量 → vol_mult 1.15 (增強橫行) | 1 |
| T9 | 升 + MA5 斜率負 → slope_mult 0.7 (動能減弱) | 1 |
| T10 | 跌 + MA60 斜率正 → slope_mult 0.8 | 1 |
| T11 | 橫 + 高 avgAbsSlope → slope_mult 0.8 (即將結束) | 1 |
| T12 | 信心 CLAMP [0, 1] | 1 |
| T13 | 數據不足 → 拋 error | 1 |
| T14 | docx §7 範例 (AAPL 多頭 + 縮量 + MA5 斜率負) → confidence 0.448 | 2 |

**Total: 19+ assertions** (跟舊 M1 v0.3.0 嘅 19 assertions 對齊)

## 11. Permanent Rules (永久)

- ✅ Rule-based + additive confidence (唔用 multiplicative, 大少 #10097) — 信心用 base × vol × slope 3 段調整
- ✅ List all matched rules (唔好 silently pick 一個) — `adjustmentLog` 必須 list 全部調整
- ✅ 假設大少只識 PE/ETF/MACD/limit order 嘅 trading term, 其他 technical term 第一次用要 plain language 解
- ✅ 3 sections 必須齊 (📖 + 🎯 + 💡) — 大少 #11056
- ✅ 數據 < required_length (預設 70 條) → 拋 error, 唔可以 silently pass
- ✅ K 線日期必須升序排列, 否則 error
- ✅ enable_volume_weight=true 但 volume 缺失 → error
- ✅ previous_avg_vol == 0 → 設 1.0, 唔可以除零

## 12. Spec 連結

- **對應 docx**: `docs/演算法概念SPECS/01均線系統週期判斷法.docx` (Kimi v2.0 spec, 166 paragraphs)
- **舊 v0.3.0 spec** (zmen均算法 抽離後保留): `docs/research/AS-03-cycle-detection/ZMEN-MA-ALIGNMENT.md`
- **Roadmap**: `docs/research/AS-03-cycle-detection/ROADMAP.md` §2 Stage 1 排序表

## 13. Changelog

| Date | Version | 改動 | Commit |
|------|---------|------|--------|
| 2026-08-15 | v2.1.0 | **9 個 sub-scenario extend** (大少 2026-08-15 揀項甲): 加 Step 5.5 9 個 sub-scenario 細分判定 (強上升 / 弱上升 / 橫行 / 弱下跌 / 強下跌 / 上升回調 / 下跌反彈 / 到頂轉勢 / 到底轉勢) + 5 個判定優先級 (Priority 1 轉勢 → Priority 2 強趨勢 → Priority 3 弱趨勢 → Priority 4 過渡形態 → Default 橫行) + 14 個 output field (加 cyclePosition / cyclePositionLabel / consecutiveDays / volumeSignalLabel) + 9 個 sub-scenario 凡人話 popup 註解 (跟 M7/M8/M9 同樣 .m1-verdict-tooltip inline style) + 凡人話 12 步 step-by-step guide + 凡人話 strategy advice 對應 9 個 scenario + stateMap 9 個 sub-scenario map 返 3 個 high-level state + warning 注入 (FALLBACK_USED / THRESHOLD_BREACH / CONFLICT_STATE 跟 Spec Sync #18 template) | TBD |
| 2026-08-21 | v2.2.0 | **Adaptive ThresholdPct** (大少 2026-08-21 18:37): 原本 hard-code `thresholdPct=0.02` (2%) 改用 per-stock adaptive (20 日 ATR% × 1.5, clamp 0.5%-5%)。每隻股用自己嘅 20 日真實波幅自動計, 低波動股門檻細, 高波動股門檻大 (capped 5%)。30 隻 stock test 證實影響範圍 1 隻 (HK.00001 長和 uptrend_correction → sideways, 3.4%)。Verdict meta 加 5 個新 field (`thresholdPctUsed` / `thresholdPctUsedPctDisplay` / `thresholdPctSource` / `adaptiveAtrPct` / `adaptiveAtrPctDisplay` / `adaptiveRawThreshold`) | TBD |
| 2026-08-08 | v2.0.0 | 全新 module, 跟 docx Kimi v2.0 spec, 3 cycles + volume + slope 兩維度擴展 | TBD |
| 2026-08-08 | — | 舊 v0.3.0 (10 rules A-J) 抽離做 zmen均算法 獨立算法 | `861bd921` |
| 2026-08-08 | — | 舊 M1 文件 rename ma-alignment → zmen-ma-alignment | `861bd921` |
| 2026-08-04 | v0.3.0 | 舊 M1: 大少 A-J 10 條 rule-based 算法 (#10332) | `840c405d` |
| 2026-08-03 | v0.2.0 | Kimi 13 個算法 (已 drop) | — |

## 14. Step 5.5: 9 個 sub-scenario 細分判定 (v2.1.0, 大少 2026-08-15 揀項甲)

**凡人話解釋**: 之前 v2.0 只 return 3 個 cycle state (uptrend / downtrend / sideways), 8 個 sub-scenario 全部判錯, 包括「強上升」、「強下跌」、「上升回調」、「下跌反彈」、「到頂轉勢」、「到底轉勢」、「弱上升」、「弱下跌」。v2.1.0 extend 做 9 個 sub-scenario, 用 MA 排列 + MA 斜率 + 成交量 + 連續日數 細分, 排喺 Step 5 (成交量訊號) 之後, 改名 Step 5.5。

**判定優先級** (跟 CSV spec):

| Priority | 細分狀態 | 凡人話解釋 | 判定條件 |
|----------|---------|-----------|----------|
| 1 | 到頂轉勢 (decelerating_up) | 見頂跡象 | MA5 急跌 3%+ + MA60 仲升 + 連跌 4+ 日 |
| 1 | 到底轉勢 (decelerating_down) | 見底跡象 | MA5 急升 3%+ + MA60 仲跌 + 連升 4+ 日 |
| 2 | 強上升 (strong_uptrend) | 趨勢中期, 上升動能強 | MA 完美多頭排列 + 全部 MA 斜率正 + 放量 |
| 2 | 強下跌 (strong_downtrend) | 趨勢中期, 下跌動能強 | MA 完美空頭排列 + 全部 MA 斜率負 + 放量 |
| 3 | 弱上升 (weak_uptrend) | 剛起勢升, 信心打折 | MA 多頭排列但部分斜率 / 量能唔配合 |
| 3 | 弱下跌 (weak_downtrend) | 剛起勢跌, 信心打折 | MA 空頭排列但部分斜率 / 量能唔配合 |
| 4 | 上升回調 (uptrend_correction) | 仍屬上升趨勢中的修正 | 短期均線急跌但長期均線仲升 + spread ≥ 2% |
| 4 | 下跌反彈 (downtrend_bounce) | 仍屬下跌趨勢中的反彈 | 短期均線急升但長期均線仲跌 + spread ≥ 2% |
| 5 (Default) | 橫行 (sideways) | 冇明確方向, 等突破 | 排列亂 + spread < 2% |

**8 個 cyclePosition** (跟 CSV spec):

| cyclePosition | 凡人話解釋 |
|---------------|-----------|
| mid_stage | 趨勢中期 (主升 / 主跌段) |
| tentative_rise | 剛起勢 (剛開始升) |
| tentative_fall | 剛起勢 (剛開始跌) |
| range_bound | 橫行整理中 |
| correction_at_ma20 | 回調到 20 日均線 |
| bounce_in_progress | 反彈進行中 |
| late_stage_topping | 到頂轉勢中 (見頂跡象) |
| late_stage_bottoming | 到底轉勢中 (見底跡象) |

**stateMap 對齊 3 個 high-level state** (Synthesizer 跟其他 module 對齊):

| sub-scenario | high-level state |
|--------------|------------------|
| strong_uptrend / weak_uptrend / uptrend_correction | UP |
| strong_downtrend / weak_downtrend / downtrend_bounce | DOWN |
| sideways / decelerating_up / decelerating_down | SIDEWAYS |

**凡人話**: 上升回調中仍算上升趨勢 (UP), 下跌反彈中仍算下跌趨勢 (DOWN), 到頂 / 到底轉勢算過渡 (SIDEWAYS), 唔強烈指向一邊。

## 15. v2.1.0 永久 Rule (大少 2026-08-15 揀項甲)

- ✅ **9 個 sub-scenario 判定排喺 Step 5 之後** (改名 Step 5.5), 因為 Priority 2 / 3 嘅「強上升 / 強下跌」判定需要 volumeSignal, 而 volumeSignal 喺 Step 5 先計算
- ✅ **判定優先級 5 級** (Priority 1 轉勢 → Priority 2 強趨勢 → Priority 3 弱趨勢 → Priority 4 過渡形態 → Default 橫行), Priority 1 trigger 條件最嚴格 (短期急變 3%+ + 連續 4+ 日), 永遠 Priority 1 優先
- ✅ **9 個 sub-scenario 凡人話 popup 註解** (跟 M7/M8/M9 同 .m1-verdict-tooltip inline style): 9 個 scenario key + 8 個 cyclePosition key + 14 個 field key, 全部凡人話, 0 英文 technical term
- ✅ **凡人話 strategy advice 對應 9 個 scenario** (1 個 scenario 1 個建議), 唔再用「結構模糊」fallback (因為 9 個 scenario 已經覆蓋)
- ✅ **凡人話 12 步 step-by-step guide** (對應 12 個睇 verdict 嘅 step, 包含 9 個 sub-scenario 解讀 step)
- ✅ **warning 注入 3 個 code** (FALLBACK_USED [system] / THRESHOLD_BREACH [stock_state] / CONFLICT_STATE [stock_state]), impact / fix 跟 Spec Sync #18 CATEGORY_DISPLAY template, issue 保留 specific context (e.g. 短期均線斜率有動 / 量縮 / 排列亂)
- ✅ **CONFLICT_STATE warning 只 trigger 喺 decelerating_up / decelerating_down** (transition 狀態), 其他 scenario 唔 trigger (因為唔係 conflict 訊號)
- ✅ **Testing page 凡人話 layout**: 9 個 sub-scenario 各自一個顏色 (強升深綠 / 弱升淺綠 / 上升回調淡綠 / 橫行黃 / 下跌反彈淡紅 / 弱跌淺紅 / 強跌深紅 / 到頂紫 / 到底藍), 凡人話 cycleLabel / cyclePositionLabel 永遠顯示
- ✅ **consecutiveDays 顯示條件**: 只有 decelerating_up / decelerating_down 先顯示 (其他 scenario 0 日冇意思)
- ✅ **凡人話 warning context precision 統一**: number value 統一 4 位小數 + 去 trailing zero (parseFloat(v.toFixed(4))), object 仍然 JSON.stringify
- ✅ **30 隻 stock comprehensive test** (10 港科技 + 10 港金融地產公用 + 10 港其他行業), 9 個 sub-scenario 觸發 8 個, 剩「強上升」+「到底轉勢」2 個 scenario 0 隻 (大市悶市合理)
- ✅ **M1 v2.1.0 adapter version 2.0.0 → 2.1.0**, testing page ALGO_CACHE_BUST 4.6.3 → 4.7.0, index.html ?v=2.3.53 → 2.3.54

## 16. v2.2.0 Adaptive ThresholdPct (大少 2026-08-21 18:37 揀方向 1)

**凡人話解釋**: 之前 v2.1.0 用 fixed `thresholdPct=0.02` (2%) 硬編碼, 對唔同波動率嘅股票都係同一個門檻。低波動藍籌 (e.g. 1398 工行) 2% 太嚴, 高波動科技股 (e.g. 中芯) 2% 太鬆。v2.2.0 改用 per-stock adaptive 模式: 用該股票自己最近 20 日真實波幅 (ATR%) × 1.5 倍, 再 clamp 喺 0.5% - 5% 範圍。

**核心公式** (Algorithm 內 `_resolve_threshold_pct()`):
```
thresholdPct = clamp(MA20_ATR% × 1.5, 0.005, 0.05)
```

| 符號 | 凡人話解釋 |
|------|-----------|
| `MA20_ATR%` | 20 日真實波幅 (TR) 平均值 ÷ 最新收盤價, 即「最近 20 天平均每日上落幾多%」 |
| `× 1.5` | 倍數, 過濾「日常噪音」, 只捕捉比平常明顯更大嘅趨勢 |
| `clamp(0.005, 0.05)` | 鎖死喺 0.5% (floor) - 5% (cap) 之間 |

**ATR 計算** (跟 ma_alignment algorithm 入面 `_compute_atr_pct()`):
```
TR_t = max(High_t - Low_t, |High_t - Close_{t-1}|, |Low_t - Close_{t-1}|)
ATR  = mean(TR_t for last 20 days)
ATR% = ATR / Close_{latest}
```

**為什麼唔用 fixed 2%?** (凡人話例子)
- 工行 1398 (~HK$4): 日內波動 ~0.8%, 2% 對佢嚟講係「好大件事」, 成個月都無一次觸發
- 港交所 388 (~HK$300): 日內可波動 5-8%, 2% 係「日常操作」, 日日都觸發
- Adaptive 令每隻股票有自己嘅「個人化門檻」, 唔會一刀切

**30 隻 stock test 結果** (大少 2026-08-21 17:11 批准):
- 公式: `thresholdPct = clamp(MA20_ATR% × 1.5, 0.005, 0.05)`
- 30 stock 分 4 段: 極低波動 (5) / 低波動 (10) / 中波動 (10) / 高波動 (5)
- 對比 adaptive vs fixed 2% 嘅 9 個 sub-scenario 觸發
- **結果: 1 隻 sub-scenario 變化 (HK.00001 長和 uptrend_correction → sideways, 3.4%)**, 7 隻觸及 5% cap, 0 隻觸及 0.5% floor
- 結論: 影響範圍細, 風險可控, 採用 Plan 1.5x/5% (大少揀方向 1)

**Verdict meta 5 個新 field** (凡人話顯示用咗幾多%):
| Field | Type | 凡人話解釋 |
|-------|------|-----------|
| `thresholdPctUsed` | float | 實際用咗嘅 threshold (0.005-0.05), 例如 0.043465 |
| `thresholdPctUsedPctDisplay` | string | 顯示用嘅 % 文字, 例如 "4.346%" |
| `thresholdPctSource` | string | "adaptive" / "fixed" / "adaptive-fallback" |
| `adaptiveAtrPct` | float | 該股 20 日 ATR% (0.0169 即 1.69%) |
| `adaptiveAtrPctDisplay` | string | ATR% 顯示文字, 例如 "2.898%" |
| `adaptiveRawThreshold` | float | 未 clamp 嘅 threshold, 例如 0.0435 |

**3 個 source 解釋**:
- `adaptive`: 正常, 用 20 日 ATR% × 1.5 動態計
- `fixed`: user 傳咗固定數字 (`config.thresholdPct` 係 number), 用 user override
- `adaptive-fallback`: 數據不足 (< 21 日) 或 ATR 計到 0, fallback 用 2%

**凡人話例子** (騰訊 HK.00700):
- 20 日 ATR% = 2.898%
- 2.898% × 1.5 = 4.347%
- Clamp (0.5% - 5%) → 4.347% (已經喺範圍, 唔觸發 cap)
- thresholdPctUsed: 4.347% (adaptive, ATR=2.898%)
- 即係騰訊而家用 4.347% 做橫行判定門檻, 比 fixed 2% 嚴, 因為佢波動大

**永久 Rule (v2.2.0 新加, 大少 2026-08-21 18:37)**:
- ✅ `config.thresholdPct` default 由 `0.02` 改 `null` (adaptive mode)
- ✅ 凡人話改 sub-scenario trigger 必須附 ≥ 3 個真實 stock 例子, 大少 verify 先改 code (2026-08-16 永久 rule 應用)
- ✅ 30 stock test 結果 (1 隻 sub 變化 = 3.4%) 證實影響範圍細, 大少批准採用 Plan 1.5x/5%
- ✅ Verdict meta 永遠顯示 `thresholdPctUsed` + `thresholdPctSource` + `adaptiveAtrPct`, 大少睇 verdict 即知用咗幾多% (大少 trigger 2026-08-21 18:37 「記得要顯示使用嘅%」)
- ✅ Testing page config input 改 `placeholder: '留空用 v2.2.0 adaptive'`, user 留空即用 adaptive
- ✅ Multiplier 1.5x 係起點, 之後可以校準 (e.g. 2.0x / 2.5x), 但需要大少 verify
- ✅ M1 v2.2.0 algorithm version 2.1.0 → 2.2.0, testing page ALGO_CACHE_BUST 4.35.0 → 4.36.0, index.html ?v=2.3.90 → 2.3.91

**測試覆蓋** (`backend/tests/test_ma_alignment.py`):
- 9 個 pytest test 全部 pass (包括 registry 註冊, 9 個 sub-scenario 判定, ZigZag inject, verdict shape)
- 1 隻 stock 觸發 sub-scenario 變化 (HK.00001 長和): `uptrend_correction → sideways`, 因為 adaptive TP 3.758% > max_spread_pct, 上升回調 trigger 條件 `max_spread_pct >= thresholdPct` 唔達標

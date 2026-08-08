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
| `thresholdPct` | float | ❌ | `0.02` | 橫行判定閾值 (價差百分比) |
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
- 若 `candidate IN [uptrend, downtrend]` AND `max_spread_pct < threshold_pct` (0.02):
  - 覆寫 → `candidate = "sideways"`
  - log: "均線雖有排列但過於靠近，視為橫行整理"

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
| 2026-08-08 | v2.0.0 | 全新 module, 跟 docx Kimi v2.0 spec, 3 cycles + volume + slope 兩維度擴展 | TBD |
| 2026-08-08 | — | 舊 v0.3.0 (10 rules A-J) 抽離做 zmen均算法 獨立算法 | `861bd921` |
| 2026-08-08 | — | 舊 M1 文件 rename ma-alignment → zmen-ma-alignment | `861bd921` |
| 2026-08-04 | v0.3.0 | 舊 M1: 大少 A-J 10 條 rule-based 算法 (#10332) | `840c405d` |
| 2026-08-03 | v0.2.0 | Kimi 13 個算法 (已 drop) | — |

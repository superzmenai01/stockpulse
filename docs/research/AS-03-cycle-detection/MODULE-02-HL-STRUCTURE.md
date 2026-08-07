# MODULE-02-HL-STRUCTURE — 高低點結構法 (Peak-Trough Structure Cycle Detector)

> **Module ID**: `hl-structure`
> **v0.1.0** (2026-08-07, 大少 + MiniMax Code)
> **Spec source**: `docs/演算法概念SPECS/高低點結構法.docx` (v2.0)

---

## 📌 概要 (用人話講)

呢個 module 幫你**揾股價嘅山頂 (peak) 同山谷 (trough)**,然後睇佢哋嘅排列去判斷個股而家係:
- 🟢 **上升** (山頂越嚟越高,山谷越嚟越高)
- 🔴 **下跌** (山頂越嚟越低,山谷越嚟越低)
- 🟡 **橫行** (山頂山谷都差唔多,塞喺一個箱入面)

仲會自動偵測**形態預警** (頭肩頂 / 雙底 / 雙頂),見到就提醒「可能見頂 / 見底」。

---

## 🎯 設計原理 (Dow Theory 基礎)

1920 年代 Robert Elliott 嘅 Dow Theory 認為:
- 股價嘅趨勢由 **山頂 (peak) 同山谷 (trough)** 嘅排列決定
- 上升趨勢 = **higher highs + higher lows** (山頂山谷一齊升)
- 下跌趨勢 = **lower highs + lower lows** (山頂山谷一齊跌)
- 橫行趨勢 = 高低都差唔多,塞喺一個 range

呢個 module 就係將呢個理論**算法化**。

---

## 🚀 v2.0 比 v1.0 多咗 8 個改進

| # | 改進 | 用人話講 |
|---|------|---------|
| 1 | **加權價識別** | 唔止用收市價,仲參考最高/最低。公式: `(高 + 低 + 收市×2) ÷ 4`,更穩 |
| 2 | **自適應 Window** | 用 ATR (股價波動幅度) 動態決定「幾多日前後先算係山頂」。波動大就睇遠啲,波動細就睇近啲 |
| 3 | **突破確認** | 升穿前高唔即刻當突破,等多 2 日先 confirm,避免「假突破」中伏 |
| 4 | **量能過濾** | 縮量形成嘅山頂/谷底降低可信度,放量突破大升就加分 |
| 5 | **時間衰減加權** | 越舊嘅山頂/谷底越唔值錢 (用指數衰減),新嘅先重要 |
| 6 | **動態 Tolerance** | 平價股 ($<10) 容忍度放寬,貴價股 ($>500) 收緊 (因為貴股 1% 已經好多) |
| 7 | **箱體邊界輸出** | 橫行嗰陣自動畀 top/bottom/mid,等 user 唔使肉眼度 |
| 8 | **形態預警** | 自動偵測頭肩頂 / 雙底 / 雙頂,提醒可能見頂/見底 |

---

## 📊 輸入 (Input)

| 欄位 | 類型 | 必填 | 預設 | 說明 |
|------|------|------|------|------|
| `symbol` | string | ✅ | — | 股票代碼 |
| `price_data` | list[dict] | ✅ | — | 歷史股價 (按日期升序),每個 element 有 `date/open/high/low/close/volume` |
| `min_pairs` | int | ❌ | 3 | 最少需要幾多對峰谷先做判定 |
| `base_window` | int | ❌ | 5 | 極值識別基礎窗口 (日數) |
| `tolerance_pct` | float | ❌ | 0.015 | 趨勢判定基礎容忍度 (1.5%) |
| `enable_atr_window` | bool | ❌ | true | 開唔開 ATR 自適應 |
| `atr_period` | int | ❌ | 14 | ATR 計算週期 |
| `enable_volume_filter` | bool | ❌ | true | 開唔開量能過濾 |
| `volume_confirm_ratio` | float | ❌ | 0.7 | 極值確認所需最低成交量比率 |
| `breakout_confirm_days` | int | ❌ | 2 | 突破確認延遲日數 (K) |
| `time_decay_lambda` | float | ❌ | 0.03 | 時間衰減係數 (0.02~0.05) |
| `enable_pattern_alert` | bool | ❌ | true | 開唔開形態預警 |
| `max_extreme_age_days` | int | ❌ | 20 | 最新極值點過咗幾多日就要打折 |

`price_data` 單筆格式:
```json
{ "date": "2026-07-01", "open": 148.5, "high": 152.3, "low": 147.0, "close": 150.5, "volume": 25000000 }
```
⚠️ 如果 `enable_volume_filter = true`,`volume` 變必填。

---

## 📤 輸出 (Output)

| 欄位 | 類型 | 說明 |
|------|------|------|
| `symbol` | string | 股票代碼 |
| `cycle` | string | `uptrend` / `downtrend` / `sideways` |
| `cycle_label` | string | 上升週期 / 下跌週期 / 橫行週期 |
| `confidence` | float | 綜合信心指數 (0.0~1.0) |
| `base_confidence` | float | 基礎信心 (未經時間/成交量調整) |
| `peaks` | list[dict] | 峰點列表 `[{date, close, high, low, index, volume, confirmed, weight}]` |
| `troughs` | list[dict] | 谷點列表 (格式同上) |
| `peak_trend` | string | 峰序列趨勢: `rising` / `falling` / `flat` / `mixed` |
| `trough_trend` | string | 谷序列趨勢 |
| `structure_score` | float | 結構一致性分數 (-1.0~1.0) |
| `weighted_structure_score` | float | 時間衰減加權後嘅結構分數 |
| `box_boundary` | dict | 箱體邊界 `{top, bottom, mid, height_pct}`,只 sideways 有 |
| `pattern_alert` | string | `head_and_shoulder` / `double_bottom` / `double_top` / `none` |
| `latest_extreme` | dict | 最新極值點 `{type, date, close, index, days_ago, confirmed}` |
| `price_position` | string | `above_peak` / `below_trough` / `between` / `broken` |
| `adaptive_window` | int | 實際用嘅自適應窗口值 |
| `effective_tolerance` | float | 實際用嘅動態容忍度 |
| `adjustment_log` | list[string] | 信心調整記錄 (每步點解打折) |
| `reason` | string | 綜合判斷理由 (人話) |
| `last_date` | string | 最新一筆數據日期 |

---

## 🧮 18 步算法 (Algorithm) — 簡明版

**Step 0 — 輸入驗證**
- 計 `required_length = max((base_window×2+1) × min_pairs × 3, atr_period + base_window×4, breakout_confirm_days + base_window×4)`
- 數據少過 `required_length` → 報錯
- 數據未按日期升序 → 報錯

**Step 1 — 計算 ATR + 自適應 Window**
- ATR 公式: `TR = MAX(high-low, |high-prev_close|, |low-prev_close|)`, 然後 `ATR = AVG(TR 最後 atr_period 筆)`
- 計算 `volatility_ratio = ATR / avg_close_20d`
- `adaptive_window = CLAMP(ROUND(base_window × (1 + volatility_ratio × 20)), 2, 15)`

**Step 2 — 加權價格 + 動態 Tolerance**
- 每個 candle 計: `weighted_price = (high + low + close×2) / 4`
- `effective_tolerance`:
  - `avg_close < 10` → `MAX(tolerance_pct, 0.03)` (平股放寬)
  - `avg_close > 500` → `MIN(tolerance_pct, 0.008)` (貴股收緊)
  - 其他 → `tolerance_pct`

**Step 3 — 識別原始極值點 (Raw Extremes)**
- 掃描 `[adaptive_window, n - adaptive_window - 1]` 範圍
- 拎前後各 `adaptive_window` 條嘅 `weighted_price`
- 如果當前 `weighted_price` 大過所有左/右 segment → 係 peak
- 如果細過所有左/右 segment → 係 trough
- 加入 `raw_extremes` list,`confirmed: false`,`weight: 1.0`

**Step 4 — 突破確認機制**
- 對於每個 extreme,**延遲 K 日** (預設 2) 先睇後續 K 個 candle 有冇突破
- 突破 = 後續 close 持續高過 peak (或低過 trough)
- 確認 → `confirmed: true`
- 冇確認 → 仍然納入分析但 `weight` 較低

**Step 5 — 成交量過濾**
- 計算每個 extreme 嘅 `volume_ratio = volume / avg_volume_lookback`
- `volume_ratio < volume_confirm_ratio` (預設 0.7) → `weight *= 0.5` (縮量降權)
- `volume_ratio > 1.3` → `weight *= 1.2` (放量加成)

**Step 6 — 極值點交替化**
- 確保 peaks 同 troughs **交替出現** (peak → trough → peak → trough...)
- 連續兩個 peak (冇 trough) → 留較高嗰個,刪另一個
- 連續兩個 trough → 留較低嗰個

**Step 7 — 提取最近 N 組峰谷**
- 用 `min_pairs` 對 (預設 3) 嘅峰谷
- 即係攞最後 N 個 peak 同 N 個 trough

**Step 8 — 時間衰減加權**
- `weight_i = exp(-lambda × days_ago)` (lambda 預設 0.03)
- 越新嘅極值權重越高 (新嘅接近 1.0,30 日前嘅大約 0.4)

**Step 9 — 趨勢分析 (峰序列 + 谷序列)**
- **峰序列趨勢**:
  - 所有峰都越嚟越高 (`each_peak_higher_than_prev`) → `rising`
  - 所有峰都越嚟越低 → `falling`
  - 差唔多 (variation < tolerance) → `flat`
  - 否則 → `mixed`
- **谷序列趨勢**: 同樣邏輯

**Step 10 — 結構一致性分數**
- 如果 `peak_trend == rising` AND `trough_trend == rising` → `candidate = "uptrend"`, `structure_score = (peak_consistency + trough_consistency) / 2` (positive)
- 如果都 `falling` → `candidate = "downtrend"`, score negative
- 否則 → `candidate = "sideways"`, score 越接近 0 越一致

**Step 11 — 基礎信心指數**
- uptrend/downtrend: `base_confidence = ((weighted_structure_score + 1) / 2)`,加 pair bonus
- sideways: `base_confidence = MAX(0.3, 1.0 - range_pct / (effective_tolerance × 4))`

**Step 12 — 箱體邊界 (只 sideways)**
- `box_top = MAX(peaks.close)`, `box_bottom = MIN(troughs.close)`, `box_mid = (top+bottom)/2`
- `box_height_pct = (top - bottom) / mid`

**Step 13 — 形態預警檢查**
- 頭肩頂: 3 個 peak, 中間最高,兩邊對稱 → `head_and_shoulder`
- 雙底: 2 個 trough, 價格相近, 中間有反彈 → `double_bottom`
- 雙頂: 2 個 peak, 價格相近, 中間有回調 → `double_top`

**Step 14 — 當前價格位置驗證**
- `latest_price` 對比 `latest_peak` 同 `latest_trough`:
  - `> latest_peak × (1 + tolerance)` → `above_peak`
  - `< latest_trough × (1 - tolerance)` → `below_trough`
  - 中間 → `between`
  - 否則 → `broken`
- 根據 candidate + position 對信心做 discount (e.g. uptrend 但跌破 trough → 信心 × 0.4)

**Step 15 — 極值點新鮮度檢查**
- `days_ago > max_extreme_age_days` (預設 20) → 信心 discount
- 越舊越打折: `freshness = MAX(0.4, 1.0 - (days_ago - max_age) / 30)`

**Step 16 — 成交量趨勢信心調整**
- 計算最近峰谷嘅平均 volume_ratio
- uptrend 縮量 → 信心下降;放量 → 信心上升
- downtrend 放量 → 確認;縮量 → 動能可能衰竭
- sideways 縮量 → 箱體確認;放量 → 可能醞釀突破

**Step 17 — 綜合信心指數**
- `confidence = base_confidence × confidence_multiplier`
- `CLAMP(0.0, 1.0)`,`ROUND(4 位小數)`

**Step 18 — 組裝輸出**
- 將上面所有 fields 包成 verdict object return

---

## ⚠️ 邊界條件 (Edge Cases)

| 情境 | 處理 |
|------|------|
| 數據點不足 | 返回錯誤,提示 `required_length` |
| `volume` 缺失但啟用量能過濾 | 返回錯誤 |
| 突破確認時數據不足 | 標 `confirmed = false`, 仍納入但 weight 降低 |
| 所有價格完全相同 | 唔能識別極值,返 `sideways`, `confidence = 0.3` |
| ATR = 0 (停牌) | `volatility_ratio = 0`, `adaptive_window = base_window` |
| 交替化後數量不足 (2026-08-07 fix) | **唔 throw,graceful 返 `sideways` verdict, `confidence = 0.5`** (real-world 100 日 K 線 noise 大,default `minPairs=2` 即需要 4 alternating) |
| 最新極值點 = 最後一筆 | `days_ago = 0`, 唔觸發新鮮度折扣 |

---

## 🎛️ 參數調整建議 (4 個 Trading Style)

| 風格 | base_window | min_pairs | tolerance_pct | time_decay_lambda | 說明 |
|------|-------------|-----------|---------------|--------------------|------|
| 超短線 | 2-3 | 2 | 0.01 | 0.05 | 極敏感,噪音大 |
| **短線波段 (推薦)** | 3-5 | 3 | 0.015 | 0.03 | 平衡靈敏度與穩定性 |
| 中長線 | 5-8 | 4 | 0.02 | 0.02 | 過濾雜訊 |
| 長線投資 | 8-12 | 5 | 0.025 | 0.015 | 只抓大波段 |

---

## 🔌 跟 AS-03 Umbrella 整合

**D019 option toggle design** (跟其他 5 個 module 一樣):
- `hlStructure` 屬 5 個 optional modules 之一
- 用戶可以喺 testing page 用 checkbox toggle 開關
- 預設 `enableFlags.hlStructure = true` (跟其他 skeleton module 一齊)
- `MA alignment` 永遠 core mandatory,永遠 enabled

**3-state vs 4-state (D011)**:
- Module 內部 output `cycle: uptrend | downtrend | sideways` (3 個)
- 對外 `CycleVerdict.state` 永遠 `UP | DOWN | SIDEWAYS`,**唔 emit TRANSITION**
- TRANSITION 由 Synthesizer (orchestrator/synthesize.ts) 判,結合其他 module 嘅 verdict 決定

---

## 🧪 Test Coverage (v0.1.0)

| # | 測試 | 預期 |
|---|------|------|
| T1 | Step 0 數據不足 (< required_length) | throw error |
| T2 | ATR 自適應 window (低波動 → 細 window) | window ≤ base_window |
| T3 | ATR 自適應 window (高波動 → 大 window) | window > base_window |
| T4 | 加權價識別 peak/trough | 跟 close-only 結果唔同 |
| T5 | 動態 tolerance (平股) | tolerance ≥ 0.03 |
| T6 | 動態 tolerance (貴股) | tolerance ≤ 0.008 |
| T7 | 上升趨勢 (3 個 higher highs + higher lows) | state = UP, score > 0 |
| T8 | 下跌趨勢 (3 個 lower highs + lower lows) | state = DOWN, score < 0 |
| T9 | 橫行 (高低塞喺 range) | state = SIDEWAYS, box_boundary 唔 null |
| T10 | 突破確認 (延遲 2 日 confirm) | confirmed = true |
| T11 | 假突破 (延遲 2 日後跌返) | confirmed = false |
| T12 | 量能過濾 (縮量 peak) | weight 打折 |
| T13 | 時間衰減 (30 日前嘅 peak) | weight ≈ 0.4 |
| T14 | 頭肩頂 pattern_alert | alert = "head_and_shoulder" |
| T15 | 雙底 pattern_alert | alert = "double_bottom" |
| T16 | 雙頂 pattern_alert | alert = "double_top" |
| T17 | 當前價 above_peak | price_position = "above_peak" |
| T18 | 當前價 below_trough (uptrend) | confidence × 0.4 |
| T19 | 新鮮度折扣 (極值 > 20 日前) | confidence discount |
| T20 | 數據點完全相同 (edge case) | state = SIDEWAYS, confidence = 0.3 |

**Total: 20 tests**

---

## 🎛️ Default Values (2026-08-07 更新)

| 參數 | Default | 說明 |
|------|---------|------|
| `minPairs` | **3** (高質量,需要 6 alternating) | 唔再降為 2 (會降精度) |
| `dataWindowDays` (UI) | **300** 日 (足夠 cover 3 pairs) | 唔再用 100 日 (noise 大,alternating 唔夠) |
| `dataWindowDays` (UI) `min` | **90** 日 | 防止 user 設太少 |
| Graceful handle | 仍 keep (alternated < 6 返 SIDEWAYS 0.5) | 處理 300 日都唔夠嘅罕見 case |

**User hint**: 如要更精準 verdict,建議取 ≥ 300 日 K 線 (預設) 或 500+ 日。

---

## 🚧 Future Plans (唔包 v0.1.0)

1. **同 EW (Elliott Wave) 整合** — Module 2 嘅 peaks/troughs 直接餵畀 `calculateElliottWave`,做更穩嘅 1-8 label (取代而家固定 threshold 嘅 ZigZag)
2. **主 web app `/ew-test` page 整合** — 將 testing page 嘅 `renderChartOverlay` contract port 去主 web app,自動 render
3. **Multi-timeframe support** — 而家 18 步主要針對 single timeframe (1d),可以 extend 跨 timeframe aggregate
4. **形態預警擴展** — 除頭肩頂/雙底/雙頂,可以加圓頂/圓底/上升三角形/下降三角形

---

## 📚 相關文件

- **Source code**: `algorithms/AS-03-cycle-detection/modules/hl-structure.ts`
- **Tests**: `algorithms/AS-03-cycle-detection/__tests__/hl-structure.test.mjs`
- **Config**: `algorithms/AS-03-cycle-detection/config.ts` (`HLStructureConfig`)
- **Adapter**: `algorithms/AS-03-cycle-detection/adapter.mjs` (`hlStructureAdapter` named export)
- **Type contract**: `algorithms/AS-03-cycle-detection/types.ts` (`CycleVerdict` shape)
- **Docx source**: `docs/演算法概念SPECS/高低點結構法.docx` v2.0 (30 KB)

---

**Maintainer**: 大少 + MiniMax Code (2026-08-07)
**Version**: 0.1.0
**Tests**: 20/20 (planned)
**Status**: ✅ Production

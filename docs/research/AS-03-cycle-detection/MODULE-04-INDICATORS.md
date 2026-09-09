# M4 Indicators — 動能背馳與衰竭檢測法 v0.4.0

> **凡人話一句**: M4 係「動能轉勢偵測器」, 用 RSI(14) + MACD(12/26/9) 兩個指標, 集中搵「背馳 + 衰竭」呢類**轉勢信號**, 唔係 trend follower, 唔係用嚟判斷股票會升 / 跌 / 橫, 係用嚟講「呢個 trend 嘅氣力用晒啦」。

---

## 0. 文件資訊

- **Module ID**: `M4` (M3 = trendline, M4 = indicators)
- **Backend**: `backend/algorithms/indicators/algorithm.py` v0.4.0
- **Frontend**: `algorithms/AS-03-cycle-detection/modules/indicators.ts` v0.4.0
- **Adapter**: `algorithms/AS-03-cycle-detection/adapter.mjs` `renderIndicatorsResult` / `renderDetailedExplanationIndicators` / `renderIndicatorsChartOverlay`
- **Synthesizer integration**: M7 `synthesizer/algorithm.py` v1.2.0 (大少 13:56 3rd condition 暫時抽離 M4)
- **Source-of-truth**: 對應 docx `docs/演算法概念SPECS/04動能背馳與衰竭檢測法.docx` (Kimi v1.0)
- **Spec version**: v0.4.0 (大少 2026-09-09 13:56 Spec Sync #55 Option 1)
- **前置永久 rules**: 對齊 §M4 Indicators 永久 rule (Spec Sync #52 2026-09-09 01:55) + §M3 Hurst+ADX gate 永久 rule (Spec Sync #45 2026-09-07 01:08) + §Verdict meta shape 統一永久 rule (Spec Sync #53)

---

## 1. 凡人話解釋 (Plain Language)

### 1.1 M4 係咩

M4 係 StockPulse 嘅第 4 個 module, 用 RSI(14) 同 MACD(12/26/9) 兩個指標去睇股票嘅**動能轉勢**。M4 唔似 M1 (均線系統) 或者 M2 (高低點結構) 嗰啲 trend follower, M4 集中搵「背馳 + 衰竭」呢類**轉勢信號**, 等大少見到個 trend 嘅氣力用完嘅時候。

### 1.2 三個 pane 點分工

凡人話: M4 撳跑之後, K 線圖下面會見到 3 個 pane (60/20/20 比例):

| Pane | 你睇到咩 | 佢做咩 |
|------|----------|--------|
| 上 (K 線) | 紅綠燭 + 成交量 | 睇價錢 |
| 中 (RSI 紫色線) | 紫色線喺 0-100 之間 | 量度「升嘅動力有幾強」 |
| 下 (MACD 橙色線) | 橙色線圍繞 0 軸跳 | 量度「升跌嘅方向」 |

### 1.3 RSI 點睇 (凡人話)

- **30 以下** = 跌得太勁 (超賣) · 通常會反彈
- **70 以上** = 升得太勁 (超買) · 通常會回調
- **50 附近** = 唔上唔落
- 紫色線向上爬 = 動力增強, 紫色線向下 = 動力減弱

### 1.4 MACD 點睇 (凡人話)

- 橙色線**升穿 0 軸** = 轉升勢
- 橙色線**跌穿 0 軸** = 轉跌勢
- 條線喺 0 軸上面越高 = 升勢越強
- 條線喺 0 軸下面越低 = 跌勢越強

### 1.5 M4 嘅核心 (凡人話)

**背馳 (DIVERGENCE)** — 最有價值嘅信號:
- **頂背馳**: 價錢升到新高位, 但紫色 RSI 線冇新高位 → 升唔上去就會跌
- **底背馳**: 價錢跌到新低位, 但紫色 RSI 線冇新低位 → 跌唔落就會升

**衰竭 (EXHAUSTION)** — 確認轉勢:
- RSI 升到 70 以上但開始回頭 (超買轉弱)
- MACD 條線升到好高但開始縮短 (升勢力竭)
- 凡人話: 之前嗰股衝力用晒, 開始後勁不繼

---

## 2. v0.4.0 Signal-based Output (大少 13:56 Spec Sync #55 Option 1)

### 2.1 拎走舊 UP/DOWN/SIDEWAYS 3-state 嘅原因

凡人話: M4 唔係 trend follower, 用 `state: UP/DOWN/SIDEWAYS` 3-state 嚟代表 M4 verdict 係**勉強塞入去**。大少 13:56 觸發 Option 1 改用 signal-based output, 對齊 M4 嘅本質 (睇轉勢信號)。

### 2.2 8 個主信號 (v0.4.0)

優先級由高到低 (見 `_derive_signal()` / `_deriveSignal()` 函數) —

| # | Signal ID | 凡人話標籤 | 建議動作 | 觸發條件 |
|---|-----------|-----------|---------|---------|
| 1 | `top_reversal` | 見頂 | 沽貨 / 觀望 | 頂背馳 + RSI > 70 + MACD 縮短 |
| 2 | `bottom_reversal` | 見底 | 入貨 / 留意 | 底背馳 + RSI < 30 + MACD 縮短 |
| 3 | `macd_golden_cross` | MACD 金叉 (跌轉升早期) | 留意 | DIF 升穿 DEA + RSI 過冷 |
| 4 | `macd_death_cross` | MACD 死叉 (升轉跌早期) | 留意 | DIF 跌穿 DEA + RSI 過熱 |
| 5 | `momentum_strong` | 動力強 (持有) | 持有 | RSI 50-70 + MACD 0 軸上面 + RSI 上升 |
| 6 | `momentum_weak` | 動力弱 (留意沽貨) | 減持 / 觀望 | RSI 30-50 + MACD 0 軸下面 + RSI 下跌 |
| 7 | `exhausted_neutral` | 動能耗盡失方向 | 觀望 | MACD 縮短 + RSI 接近 50 |
| 8 | `no_signal` | 冇明確信號 | 觀望 | 默認 fallback (RSI 30-70 + MACD 0 軸附近) |

### 2.3 Sub-signal 副信號 (細粒度指標)

凡人話: 8 個主信號都係由呢啲 sub-signal 組成, 畀大少睇 detail 用:

| Sub-signal ID | 凡人話解釋 |
|--------------|-----------|
| `rsi_overbought` | RSI > 70 (超買) |
| `rsi_oversold` | RSI < 30 (超賣) |
| `rsi_50_70` | RSI 50-70 (偏強) |
| `rsi_30_50` | RSI 30-50 (偏弱) |
| `rsi_rising` | RSI 5 日上升 (B3 linear slope) |
| `rsi_falling` | RSI 5 日下跌 |
| `macd_above_zero` | MACD 喺 0 軸上面 (升勢) |
| `macd_below_zero` | MACD 喺 0 軸下面 (跌勢) |
| `macd_shrinking` | MACD 柱狀圖縮短 (衰竭) |
| `macd_golden_cross` | MACD 金叉 (DIF 升穿 DEA) |
| `macd_death_cross` | MACD 死叉 (DIF 跌穿 DEA) |
| `rsi_bearish_divergence` | RSI 頂背馳 |
| `rsi_bullish_divergence` | RSI 底背馳 |
| `macd_bearish_divergence` | MACD 頂背馳 |
| `macd_bullish_divergence` | MACD 底背馳 |
| `regime_gate_failed` | Hurst < 0.45 OR ADX < 20 (冇方向) |
| `no_trending` | 冇明確 trend |

### 2.4 Strength 信號強度 (0-1)

凡人話: 強度越高, 信號越值得參考。公式 (per priority 級別):
- **top_reversal / bottom_reversal**: `clamp(0.6 + exhaustion_score * 0.4, 0, 1)` (高基礎 0.6, 加衰竭分數)
- **macd_golden_cross / macd_death_cross**: `clamp(0.5 + exhaustion_score * 0.3, 0, 1)`
- **momentum_strong / momentum_weak**: `clamp(0.4 + exhaustion_score * 0.3, 0, 1)`
- **exhausted_neutral**: `clamp(0.3 + exhaustion_score * 0.3, 0, 1)`
- **no_signal**: `clamp(0.2 + exhaustion_score * 0.2, 0, 1)` (默認 fallback)

### 2.5 Verdict meta 拎法 (Usage)

```python
verdict.meta.signal            # 主信號 (8 個其中之一)
verdict.meta.signalLabel       # 凡人話標籤
verdict.meta.signalAction      # 建議動作
verdict.meta.subSignals        # 副信號 array
verdict.meta.strength          # 信號強度 0-1
verdict.meta.signalLegacy      # 向後兼容: 舊 buy/sell/hold trade 訊號 (frontend chart overlay 仍用)
verdict.meta.version           # "v0.4.0" (spec version tag)
verdict.meta.rsiLatest         # RSI 而家數值
verdict.meta.macdLatest        # MACD 而家數值
verdict.meta.regimeGate        # PASSED / FAILED (對齊 v0.3.0 soft fail 永久 rule)
verdict.meta.warnings          # 永久 rule warnings (對齊 §Module Warning 永久 rule)
```

### 2.6 Backend call (凡人話)

```bash
# 撳跑 M4 (algorithm = indicators)
curl 'http://127.0.0.1:18792/api/algorithms/run?algo=indicators&symbol=HK.00700&dataWindowDays=1260'

# 對齊 §Stock 名 evidence 永久 rule: 用真實 stock 全名 (HK.00700 = 騰訊控股, 唔好用 "騰訊" mental model 估)
```

---

## 3. 例子 (Examples)

### 3.1 例子 1: HK.01888 建滔積層板 (regime PASSED, 凡人話 trending 強)

```
RSI 56.62 (升緊) + MACD +1.1549 (0 軸上面, 跌緊) + 冇背馳
→ signal: exhausted_neutral
   凡人話: MACD 0 軸上面縮短 + RSI 接近 50 但 rsi 跌緊 → 升勢力竭
→ subSignals: [rsi_50_70, rsi_falling, macd_above_zero, macd_shrinking]
→ strength: 0.38
→ action: 觀望
```

### 3.2 例子 2: HK.00700 騰訊控股 (regime FAILED, 凡人話 random walk)

```
RSI 41.86 (持平) + MACD -1.0230 (0 軸下面, 持平) + 冇背馳
→ signal: exhausted_neutral (regime gate fail override)
   凡人話: H=0.425 < 0.45 OR ADX=9.19 < 20 → 冇方向, 軟失敗
→ subSignals: [regime_gate_failed, no_trending, rsi_30_50, rsi_falling, macd_below_zero, ...]
→ strength: 0.30
→ action: 觀望
```

### 3.3 例子 3: 假設 case — RSI 78 + MACD 縮短 + 頂背馳 (見頂)

```
RSI 78 (超買) + MACD 縮短 + 頂背馳 (價升 RSI 唔跟)
→ signal: top_reversal
   凡人話: 見頂警號, RSI 過熱 + MACD 柱狀圖縮短 + 頂背馳, 升勢用完
→ subSignals: [rsi_overbought, rsi_bearish_divergence, macd_shrinking]
→ strength: 0.85 (3 個 sub-signal + 頂背馳 + 衰竭分數高)
→ action: 沽貨 / 觀望
```

### 3.4 例子 4: 假設 case — RSI 25 + MACD 縮短 + 底背馳 (見底)

```
RSI 25 (超賣) + MACD 縮短 + 底背馳 (價跌 RSI 唔跟)
→ signal: bottom_reversal
   凡人話: 見底警號, RSI 過冷 + MACD 柱狀圖縮短 + 底背馳, 跌勢用完
→ subSignals: [rsi_oversold, rsi_bullish_divergence, macd_shrinking]
→ strength: 0.78
→ action: 入貨 / 留意
```

### 3.5 例子 5: HK.00021 (regime PASSED, 凡人話 trending 弱)

```
RSI 30-50 (偏弱) + MACD 0 軸下面 (跌勢) + RSI 5 日下跌
→ signal: momentum_weak
   凡人話: 跌勢有動力, 留意沽貨
→ subSignals: [rsi_30_50, rsi_falling, macd_below_zero]
→ strength: 0.41
→ action: 減持 / 觀望
```

---

## 4. Algorithm 流程 (11 個 step, v0.4.0 加重組 verdict 邏輯)

| Step | 描述 | v0.4.0 改動 |
|------|------|------------|
| 0 | 數據驗證 (minRequired bars, A6 meta.symbol caller symbol) | 維持 v0.2.0 |
| 0.5 | Hurst+ADX regime gate (對齊 M3 永久 rule Spec Sync #45, A1) | v0.3.0 軟失敗: reg gate fail 仍然 emit RSI/MACD series, 但 signal override exhausted_neutral |
| 1 | 計 RSI(14) + MACD(12/26/9) (Wilder smoothing) | 維持 v0.2.0 |
| 2 | 識別局部極值 (3-window peaks + troughs) | 維持 v0.2.0 |
| 3 | 背馳檢測 (頂背馳 / 底背馳, RSI + MACD, B2 confirmation candle) | 維持 v0.2.0 |
| 4 | 動能狀態 (5 日 RSI slope (B3) + macd state) | 維持 v0.2.0 |
| 5 | 衰竭分數 (RSI 極端 + MACD 縮小 + 背馳) | 維持 v0.2.0 |
| 6 | 交易訊號 (v0.2.0 A3 M1 filter + A7 cross-confirm) | 保留舊 buy/sell/hold 拎入 `signalLegacy` field (frontend 向後兼容) |
| 7 | 勝率估算 | 維持 v0.2.0 |
| 8 | 歷史機會回顧 (lookbackDays 250 v0.2.0) | 維持 v0.2.0 |
| 9 | 信心指數 | 維持 v0.2.0 |
| 9.5 | self-check penalty (A5 對齊 M2 9月7日 22:00 永久 rule + B1 ban 1.0) | 維持 v0.2.0 |
| **10** | **★ 新加 v0.4.0: 揀信號 (`_derive_signal` / `_deriveSignal`)** | **8 個主信號 priority 揀, 對齊凡人話 trading 邏輯** |

---

## 5. 沿用永久 rules (v0.2.0 + v0.3.0)

對齊大少 9月9日 13:56 4th condition (M1/M2/M3 唔改), M4 沿用以下永久 rules:

- **A1 Hurst+ADX regime gate** (Spec Sync #45): H<0.45 OR ADX<20 觸發 CONFLICT_STATE warning
- **A2 signalThreshold 0.5** (config.ts 對齊)
- **A3 M1 state trend filter**: caller inject 落 `options.get("m1_state")`, M1 state 矛盾即降權 50% + emit FALLBACK_USED warning
- **A4 5 個 self-check warning** (INSUFFICIENT_DATA / CONFLICT_STATE / FALLBACK_USED / THRESHOLD_BREACH / MODULE_PARTIAL)
- **A5 self-check penalty formula**: `max(conf * 0.375, 0.3)` floor (對齊 M2 9月7日 22:00 永久 rule spirit)
- **A6 meta.symbol caller symbol**: 從 `ctx.symbol` 拎, 唔好 hardcode "TEST" / "UNKNOWN" (對齊 9月7日 08:30 永久 rule)
- **A7 RSI + MACD 背馳 cross-confirm bonus × 1.2**
- **B1 永久 ban confidence 1.0**, clamp 0.95 (對齊 M3 Layer 4 formula 永久 rule)
- **B2 confirmation candle**: 放量 + 收 > MA5 (對齊 Arxum 67% win rate)
- **B3 RSI 5 日 linear slope**: `rsi[-1] - rsi[-6]` (對齊 trend, 唔再用單點 vs 5 日 average)
- **v0.3.0 reg gate soft fail**: reg gate fail 仍然 emit RSI/MACD series (對齊大少 9月9日 11:26 Option 1)

---

## 6. M7 Synthesizer 整合 (大少 13:56 3rd condition)

### 6.1 v1.2.0 永久改動: 暫時從 M7 抽離 M4

凡人話: M4 v0.4.0 verdict 拎走 UP/DOWN/SIDEWAYS 3-state, 改用 signal id (8 個主信號其中之一), 對齊 M7 Synthesizer 拎 v.get("state") 拎 alignment 嘅 algorithm, M4 verdict 拎 signal id 唔再係 UP/DOWN/SIDEWAYS, 會 trigger _is_opposite_state 誤判 alignment。

**對齊大少 13:56 3rd condition「暫時從 M7 抽離 M4」**:
- `_compute_tcm`: 拎 M4 (indicators) verdict 嗰對 pair 永遠 `alignment = 0.0` + `trap_penalty = 0.2` + `skipped = True`
- `_compute_alignment`: 拎 M4 verdict 過濾掉, 只計 5 個 module (M1/M2/M3/M5/M6) 嘅 alignment
- `tcm_matrix` frontend display 會見到 `(indicators, volatility) pair` 拎 `skipped: true` 標記

### 6.2 TODO (日後 M7 優化時要處理)

大少日後 trigger 拎 M4 嘅 signal (top_reversal/bottom_reversal/momentum_strong 等) 對應到 M7 嘅 alignment 點計。3 個方案等大少 trigger 揀:

- **方案 A**: M4 嘅 `top_reversal` / `bottom_reversal` 對應 `DOWN` / `UP` (凡人話: 見頂 = 跌, 見底 = 升)
- **方案 B**: M4 嘅 `momentum_strong` / `momentum_weak` 直接對應 `UP` / `DOWN`
- **方案 C**: M7 加一個 `signal_quality_score`, M4 強信號 (strength > 0.7) 直接 override 綜合判定

對齊 §M1 sub-scenario 永久 rule (2026-08-16 19:21): sub-scenario 改動要 ≥ 3 個 stock verify, 大少 trigger 之後先改。

對齊 §改完先 ask 修正先 Commit (2026-09-09 07:23): 改完必先 present fix 結果 + 等大少 trigger commit。

---

## 7. Frontend Display (凡人話)

### 7.1 撳跑 M4 之後, 凡人話睇到咩

frontend `renderIndicatorsResult` 對齊 v0.4.0 嘅 UI 顯示:

1. **頂部 state-pill**: 顯示主信號 (e.g. `見頂` / `動力弱` / `失方向`)
2. **信號強度** + **副信號 chips**: 8 個主信號每個獨立 color, 副信號用細 chip 顯示
3. **凡人話解讀** (3 段):
   - 簡單講: 主信號觸發咗咩 sub-signal
   - 咩意思: RSI / MACD 數值 + region (超買/超賣/中性)
   - 點睇呢個結果: 建議動作 + 配合其他 module
4. **詳細解讀** (展開收埋): 8 條 paragraph 凡人話解釋

### 7.2 撳跑 M4 之後, 凡人話睇到副圖 (chart overlay)

frontend `renderIndicatorsChartOverlay` (對齊 Lightweight Charts v5 panes API):
- **Pane 0** (60%): K 線 + Volume
- **Pane 1** (20%): RSI 紫色線 + 30/50/70 reference lines
- **Pane 2** (20%): MACD 橙色線 + 0 軸 reference line
- 撳住 K 線 pan/zoom 嗰陣 RSI / MACD 副圖自動跟住同步 (LWC v5 pane 共享 time scale)

### 7.3 凡人話 display 範例

撳跑 `HK.01888 建滔積層板` 之後會見到:

```
┌────────────────────────────────────────────────────────────┐
│  ⚡ 動能背馳與衰竭檢測法 (Indicators) v0.4.0                │
├────────────────────────────────────────────────────────────┤
│  [ 失方向 ]  signal: exhausted_neutral                       │
│  70% 信心指數 — 中等信心, 信號一般                          │
│                                                             │
│  📌 簡單講: 動能耗盡, MACD 柱狀圖縮短, 之前升 / 跌咗一輪,   │
│     失方向。                                                 │
│  📊 咩意思: RSI(14) = 56.62 (中性區), MACD 柱狀體 = 1.1549  │
│  💡 點睇呢個結果: 觀望, 等下個 trend 出現。                   │
│                                                             │
│  Sub-signals: [rsi_50_70] [rsi_falling] [macd_above_zero]    │
│               [macd_shrinking]                              │
│                                                             │
│  📊 K 線圖 (3 個 pane 60/20/20)                             │
│  ┌──────────┬──────────┬──────────┐                        │
│  │ K 線+Vol │ RSI 紫色 │ MACD橙  │                        │
│  │ (60%)    │ (20%)    │ (20%)    │                        │
│  └──────────┴──────────┴──────────┘                        │
└────────────────────────────────────────────────────────────┘
```

---

## 8. 永久 rule checklist (大少 9月9日 13:56 4 個 conditions 全部對齊)

對齊大少 13:56 4 個 conditions:

- ✅ **條件 1**: 全中文寫註解和說明 (header docstring + Step 0-10 docstring + `_derive_signal` docstring + frontend header comment)
- ✅ **條件 2**: 徹底更新 M4 嘅說明和註解, 加上用法和例子 (見本文件 §2.5 Usage + §3 Examples)
- ✅ **條件 3**: 暫時從 M7 抽離 M4 (synthesizer/algorithm.py v1.2.0 改動), 日後 M7 優化時要處理 M4 signal-based 配合 (見本文件 §6 M7 Synthesizer 整合 + §6.2 TODO)
- ✅ **條件 4**: M1 / M2 / M3 一律唔改 (只改 M4 backend + frontend + M7 Synthesizer + spec doc + AGENTS.md)

對齊其他永久 rule:

- §Backend hot-reload 永久 rule: 改 backend 之後 `./start.sh` restart + curl 拎 evidence
- §M3 trendline chart overlay 修復永久 rule: 拎 `verdict.meta.X`, 唔好拎 `verdict.meta.meta.X`
- §M3 Hurst+ADX gate 永久 rule: H<0.45 OR ADX<20 觸發 CONFLICT_STATE warning + v0.3.0 soft fail
- §Verdict meta shape 統一永久 rule: backend 統一 inject `rsiSeries: []` / `macdSeries: []` 兜底
- §M4 self-check penalty 永久 rule: critical + warning level self-check warning 觸發 conf floor 0.3
- §M4 cross-confirm bonus 永久 rule: RSI + MACD 同時背馳 × 1.2 bonus
- §改完先 ask 修正先 Commit 永久 rule: 改完必先 present fix 結果 + 等大少 trigger commit
- §Stock 名 evidence 永久 rule: 用 HK.00700 騰訊控股 / HK.01888 建滔積層板 / HK.01347 華虹半導體 等真實 stock 全名
- §Array evidence 永久 rule: 改之前 curl 拎 rsiSeries.length / macdSeries.length 真實 array evidence
- §數據處理 Server 內部做永久 rule: RSI/MACD 算法 backend Python 跑, frontend 只 render verdict
- §M1 sub-scenario 永久 rule: sub-scenario 改動要 ≥ 3 個 stock verify, 大少 trigger 先改
- §取唔拎 永久 rule: 凡人話用「取」唔用「拎」
- §簡單普通話 永久 rule: 唔好用英文 technical term, 全部用普通話講

---

## 9. 對應文件 (Source-of-truth chain)

- 對應 source: `backend/algorithms/indicators/algorithm.py` v0.4.0
- 對應 frontend: `algorithms/AS-03-cycle-detection/modules/indicators.ts` v0.4.0
- 對應 adapter: `algorithms/AS-03-cycle-detection/adapter.mjs` `renderIndicatorsResult` / `renderDetailedExplanationIndicators` / `renderIndicatorsChartOverlay`
- 對應 Synthesizer: `backend/algorithms/synthesizer/algorithm.py` v1.2.0 (M4 抽離)
- 對應永久 rule: `AGENTS.md` §M4 Indicators 永久 rule
- 對應 spec: 本文件 (MODULE-04-INDICATORS.md v0.4.0)
- 對應 framework: `backend/algorithms/base.py` Verdict contract

---

## 10. 版本歷史 (Version History)

| 版本 | 日期 | 改動 | 對應 Spec Sync |
|------|------|------|---------------|
| v0.1.0 | 2026-08-20 | 初版 (Phase 5 backend port) | Phase 5 |
| v0.2.0 | 2026-09-09 01:55 | + 12 個 fix (regime gate + M1 filter + self-check penalty + meta.symbol + cross-confirm + lookbackDays + ban 1.0 + confirmation + RSI slope) | Spec Sync #52 |
| v0.3.0 | 2026-09-09 11:26 | + reg gate soft fail (拎走早 return, 改為 emit warning + 繼續行 algorithm 拎 RSI/MACD series) | Spec Sync #54 (Option 1) |
| v0.3.1 | 2026-09-09 11:26 | + Verdict meta shape 統一 (Spec Sync #53 algorithm_runner.py 統一 inject rsiSeries/macdSeries 兜底) | Spec Sync #53 |
| **v0.4.0** | **2026-09-09 13:56** | **+ 拎走 UP/DOWN/SIDEWAYS 3-state, 改用 8 個主信號 signal-based output + M7 Synthesizer 抽離 M4 (v1.2.0) + 全中文 docstring + spec doc 徹底更新** | **Spec Sync #55 (Option 1 + 4 個 conditions)** |

---

> **凡人話總結**: M4 v0.4.0 拎走舊 UP/DOWN/SIDEWAYS 3-state, 改用 8 個主信號 (見頂 / 見底 / MACD 金叉死叉 / 動力強弱 / 失方向 / 冇信號) signal-based output, M7 Synthesizer 暫時抽離 M4 (日後優化時要處理 signal-based 配合), 全中文 docstring + spec doc 徹底更新, 對齊大少 13:56 4 個 conditions + 沿用所有 v0.2.0/v0.3.0 永久 rule。

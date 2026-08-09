# AS-03 · Module 5: 多時間框架週期判定法 v1.0.0 (Multi-Timeframe Cycle Detector)

> **對應 docx**: 隱藏 v1 (大少 14:16 揀 A drop, Stage 2 重新 plan, 2026-08-09 21:30 大少確認 go)
> **對應 TS 檔**: `algorithms/AS-03-cycle-detection/modules/multi-tf.ts` (TBD)
> **對應 tests**: `algorithms/AS-03-cycle-detection/tests/test-multi-tf.mjs` (TBD)
> **對應 adapter**: `algorithms/AS-03-cycle-detection/adapter.mjs` (`multiTfAdapter`, TBD)
> **大少 21:30 confirm**: 4 個 design decision 全 A (1D+1W+1M / 分層 weights / 動態 MA pullback / 12:1 walk-forward)

---

## 1. 點解呢個 module (Why)

M1-M4 + M6-M9 全部睇**單一 timeframe** (1D 日線), 即係「而家呢一刻」嘅判定。

但真實交易有 3 個 timeframe 嘅問題:
- **1D (短炒)**: 而家買/賣訊號, 短線 entry/exit
- **1W (中線)**: 確認 1D 訊號係咪同中線方向一致, 定係逆勢
- **1M (大方向)**: 確認 1D/1W 係咪順大方向, 定係 catch falling knife

**典型反例 (1D 講 BUY 但大方向唔啱)**:
- 1D 上升 SIDEWAYS→UP 觸發 BUY
- 但 1W 仲喺 DOWN trend 中 (4 個 module 唔一致)
- 1M 大方向 DOWN (大戶派發中)
- 結果: 1D 嘅 BUY 係**撈底** (catch falling knife), 1-2 星期內跌穿止蝕

呢個 module 5 答「**3 個 timeframe 嘅 cycle 方向一致嗎**」:
- **一致** (3 個 TF 同一方向) = 高信心
- **半一致** (1 個 TF 唔同) = 中信心 + ⚠️ warning
- **完全分歧** (3 個 TF 唔同) = CONFLICT 唔好入場

**核心 insight**:
- **Multi-TF 一致 = 順勢** (跟大戶方向, 勝率高)
- **Multi-TF 分歧 = 逆勢** (counter-trend, 容易損止蝕)
- **短炒順中線 + 順大方向** = 食晒成個 trend
- **短炒逆中線 + 逆大方向** = 短炒死路一條

## 2. 跟其他 module 嘅協同

| Module | 佢答嘅問題 | 呢個 module 補充 |
|---|---|---|
| M1 MA Alignment | 日線趨勢 | 「日線 UP 但週線 DOWN, 短炒逆勢」 |
| M2 HL Structure | 日線高低點 | 「日線高點越嚟越高, 週線高點越嚟越低, 短炒見頂訊號」 |
| M3 Trendline | 日線趨勢線 | 「日線升破 trendline, 週線 trendline 跌破, 唔好信突破」 |
| M4 Indicators | 日線動能 | 「日線 MACD 升, 週線 MACD 跌, 短炒見頂警號」 |
| M5 VolumePrice | 日線量價 | 「日線量大突破, 週線量縮, 短炒突破但中線冇跟」 |
| M6 Volatility | 日線波動 | 「日線 Squeeze, 週線 ATR 上升, 大方向波動擴張」 |
| M7 Synthesizer | 6 個日線 module 加權 | 「Synthesizer 結果 × M5 一致性評分 = 最終 confidence」 |
| M8 Decision Engine | 日線 8 個 finalAction | 「8 個 finalAction 嘅 entry/exit 時機 × M5 一致性 = 確認/取消」 |
| **M5 Multi-TF** | **3 個 TF 一致性** | **「順大方向 / 逆大方向 / 順中線逆大方向 (撈底)」** |

**典型用法**:
- 1D/1W/1M 全部 UP, M8 final=BUY → 高勝率 entry (順晒成個 trend)
- 1D UP / 1W DOWN / 1M UP → ⚠️ 半一致, 信心降低 (短炒順週線, 但中線逆)
- 1D UP / 1W DOWN / 1M DOWN → 🚫 CONFLICT, 唔好入場 (撈底, catch falling knife)
- 1D/1W/1M 全部 DOWN → M8 final=WAIT 或更低, 等大方向轉

## 3. 輸入

| Field | Type | Required | Default | 說明 |
|-------|------|----------|---------|------|
| `klines1D` | KLine[] | ✅ | — | 日線歷史 K 線, 按日期升序 (至少 90 條) |
| `klines1W` | KLine[] | ✅ | — | 週線歷史 K 線, 按日期升序 (至少 26 條 ≈ 6 個月) |
| `klines1M` | KLine[] | ✅ | — | 月線歷史 K 線, 按日期升序 (至少 12 條 ≈ 1 年) |
| `tfWeights` | `{1D, 1W, 1M}` | ❌ | `{0.25, 0.35, 0.40}` | 3 個 timeframe 加權 (大少 21:30 confirm: 1D 25% / 1W 35% / 1M 40%) |
| `consensusThreshold` | number | ❌ | `0.65` | 信心門檻, ≥ 0.65 為 high confidence, < 0.50 為低信心 |
| `subModule` | string | ❌ | `'ma-alignment'` | 每個 TF 跑邊個 sub-algorithm (default: MA Alignment 10 條 rule, 大少熟悉) |

**Min data**: 每個 TF 至少 12 條 (但建議 1D 90+ / 1W 26+ / 1M 12+)
**Backend data source**: `/api/kline?code=...&period=1d/1w/1m&count=...` (3 個 HTTP request)

## 4. 輸出

```typescript
interface MultiTFVerdict {
  symbol: string;
  state: 'UP' | 'DOWN' | 'SIDEWAYS' | 'CONFLICT';
  confidence: number;                       // 0~1, 加權綜合 (分歧時 *0.5 penalty)
  conflict: boolean;                        // true if 3 個 TF 唔同方向
  warning: string | null;                   // 分歧時嘅 warning message (e.g. "⚠️ 1D 逆 1W/1M, 撈底風險")
  
  // 3 個 timeframe 嘅 sub-verdict
  timeframe_verdicts: {
    '1D': { state, confidence, ...sub_verdict },
    '1W': { state, confidence, ...sub_verdict },
    '1M': { state, confidence, ...sub_verdict },
  };
  
  // 一致性評分 (confluence)
  consensus: {
    score: number;                          // 0~1, 3 個 TF 方向一致性
    direction: 'aligned' | 'partial' | 'divergent';
    description: string;                    // 人話描述
  };
  
  // Cycle 轉換偵測
  transitions: {
    turnAround: boolean;                    // 大方向由 DOWN 轉 UP
    adjustmentComplete: boolean;             // 大方向調整剛完
  };
  
  meta: {
    dataDays1D, dataDays1W, dataDays1M: number;
    tfWeights: { '1D', '1W', '1M': number };
    subModule: string;
  };
}
```

**State 定義**:
- `UP`: 3 個 TF 一致 UP, 或 1D UP + 1W/1M UP
- `DOWN`: 3 個 TF 一致 DOWN, 或 1D DOWN + 1W/1M DOWN
- `SIDEWAYS`: 3 個 TF 一致 SIDEWAYS, 或 1D/1W 唔同
- `CONFLICT`: 3 個 TF 完全唔同 (e.g. 1D UP + 1W SIDEWAYS + 1M DOWN)

**Consensus 評分**:
- `aligned` (3 個 TF 同方向): score = 1.0
- `partial` (2 個 TF 同方向): score = 0.65
- `divergent` (3 個 TF 唔同): score = 0.30

## 5. Algorithm (大少 21:30 confirm 全 A)

### 5.1 Sub-algorithm 跑法
每個 timeframe 跑 1 個 sub-algorithm (default: MA Alignment 10 條 rule):
1. `subModule` 參數決定跑邊個 algorithm (MA alignment / HL structure / Trendline / Indicators)
2. 每個 TF 拎 verdict (`state: UP/DOWN/SIDEWAYS/TRANSITION/TRAP`, `confidence: 0-1`)
3. **Decision 1 (大少 confirm A)**: 預設 3 個 timeframe (1D + 1W + 1M)

### 5.2 加權綜合 (Decision 2 大少 confirm A — 分層 weights)
- **1D 25%** (短炒 noise 大, 權重最低)
- **1W 35%** (中線, 平衡)
- **1M 40%** (大方向, 權重最高, 跟住大戶)
- `baseConfidence = (1D.conf × 0.25) + (1W.conf × 0.35) + (1M.conf × 0.40)`
- 3 個 TF 同方向 → confidence = baseConfidence × 1.0
- 2 個 TF 同方向 → confidence = baseConfidence × 0.85
- 3 個 TF 唔同 → confidence = baseConfidence × 0.5 (CONFLICT penalty)

### 5.3 State derivation
- 3 個 TF 同 state (UP/UP/UP) → final state = same
- 2 個 TF 同 state, 第 3 個 SIDEWAYS → final state = same (SIDEWAYS fallback)
- 2 個 TF 同 state, 第 3 個唔同 (例 UP/UP/DOWN) → final state = the same, conflict = true, warning
- 3 個 TF 全部唔同 → final state = CONFLICT, conflict = true, confidence * 0.5

### 5.4 Pullback 邏輯 (Decision 3 大少 confirm A — 動態 MA)
- **Entry pullback detection**:
  - 1W 確認 UP, 1D 從 1W high 拉 5% → 動態 MA10/MA20 support zone
  - Entry zone: 動態 MA10 與 MA20 之間 (MA10 < MA20 = 上行中的健康回調)
  - Stop loss: MA20 × 0.98 (1D close < MA20 × 0.98 = 跌穿中期 trend)
- **跟 M8 trading card 配合** (兩線策略 + multi-TF 一致性):
  - 1D/1W/1M 全部 UP + M8 final=BUY → entry at 1D pullback to MA10
  - 1D/1W/1M 唔一致 → 唔好 pullback entry (避免撈底)

### 5.5 Walk-Forward (Decision 4 大少 confirm A — Pardo 12:1)
- **In-sample:out-of-sample = 12:1** (Pardo 標準, 較 M9 嘅 3 folds rolling 嚴格)
- 適合 monthly rebalance (1M re-calibrate 一次)
- 計算:
  - 1Y in-sample (12 個月) → 1 個月 out-of-sample
  - 3Y in-sample (36 個月) → 3 個月 out-of-sample
  - **永遠保留最後 1 個月 out-of-sample** 做 live validation
- Stage 2 不一定 impl (12:1 主要影響 M11/M12 Backtest Timeline / R:R 嘅 design)
- M5 本身只用最近 1 個月 out-of-sample 做一致性 cross-check

## 6. Config / Defaults

```typescript
export const DEFAULT_MULTI_TF_CONFIG = {
  // Timeframe weights (大少 21:30 confirm Decision 2)
  tfWeights: { '1D': 0.25, '1W': 0.35, '1M': 0.40 },
  
  // Sub-algorithm (大少 21:30 confirm Decision 1: 3 個 TF 1D/1W/1M)
  timeframes: ['1D', '1W', '1M'],
  subModule: 'ma-alignment',    // 每個 TF 跑 MA alignment
  
  // Consensus threshold
  consensusThreshold: 0.65,
  
  // Conflict penalty
  conflictConfidenceMultiplier: 0.5,
  partialConsensusMultiplier: 0.85,
  
  // Pullback 動態 MA (大少 21:30 confirm Decision 3)
  pullbackMAFast: 10,
  pullbackMASlow: 20,
  pullbackStopLossPct: 0.02,
  
  // Walk-Forward (大少 21:30 confirm Decision 4: 12:1)
  walkForwardInSample: 12,
  walkForwardOutOfSample: 1,
  
  // Data validation
  minDataDays1D: 90,
  minDataDays1W: 26,
  minDataDays1M: 12,
};
```

## 7. State derivation (詳細)

```typescript
function deriveState(tfVerdicts: { '1D': Verdict, '1W': Verdict, '1M': Verdict }): State {
  const states = [tfVerdicts['1D'].state, tfVerdicts['1W'].state, tfVerdicts['1M'].state];
  const upCount = states.filter(s => s === 'UP').length;
  const downCount = states.filter(s => s === 'DOWN').length;
  const sidewaysCount = states.filter(s === 'SIDEWAYS').length;
  
  // 3 個 TF 同方向 (其中 SIDEWAYS 當 neutral)
  if (upCount === 3) return { state: 'UP', conflict: false };
  if (downCount === 3) return { state: 'DOWN', conflict: false };
  if (sidewaysCount === 3) return { state: 'SIDEWAYS', conflict: false };
  
  // 2 個 TF 同方向 (第 3 個唔同 OR SIDEWAYS)
  if (upCount === 2 && (downCount === 0 || downCount === 1 && sidewaysCount === 0)) {
    return { state: 'UP', conflict: downCount === 1 };
  }
  if (downCount === 2 && (upCount === 0 || upCount === 1 && sidewaysCount === 0)) {
    return { state: 'DOWN', conflict: upCount === 1 };
  }
  
  // 3 個 TF 唔同 (e.g. UP/DOWN/SIDEWAYS)
  return { state: 'CONFLICT', conflict: true };
}
```

## 8. Edge cases

1. **Data 不足**: 任一 TF 少過 min data → 報錯 (e.g. "1W 數據只有 10 條, 至少需要 26 條")
2. **Backend 拎唔到 1W/1M 數據**: fallback 用 dev mock 警告 + 信心 penalty
3. **3 個 TF 全部 SIDEWAYS**: final state = SIDEWAYS, conflict = false
4. **3 個 TF 全部唔同 (UP/DOWN/SIDEWAYS)**: final state = CONFLICT
5. **1D 轉 SIDEWAYS 但 1W/1M 仲喺 UP**: 1 個 TF 唔同 → conflict = true, warning = "短炒 SIDEWAYS 但中線大方向仍 UP"
6. **週末 / 假期**: 1D 冇 update, 用上日 close (唔影響 verdict, 但 display 加「(假期)」caption)

## 9. Testing strategy

### 9.1 Unit tests (10+ cases)
- ✅ 3 個 TF 全 UP, conflict=false
- ✅ 3 個 TF 全 DOWN, conflict=false
- ✅ 3 個 TF 全 SIDEWAYS, conflict=false
- ✅ 2 個 TF UP, 1 個 SIDEWAYS, conflict=false
- ✅ 1D UP, 1W UP, 1M DOWN → CONFLICT, confidence * 0.5
- ✅ 1D UP, 1W DOWN, 1M DOWN → conflict=true, warning
- ✅ 1D UP, 1W DOWN, 1M UP → 2 個 UP, 1 個 DOWN, conflict=true
- ✅ 加權 default (25/35/40) baseConfidence 計算啱
- ✅ 加權自訂 (30/30/40) baseConfidence 計算啱
- ✅ Conflict penalty (× 0.5) confidence 折半
- ✅ Data 不足 error case

### 9.2 Integration tests
- 1D/1W/1M verdict mock 3 個 scenario, 拎 verdict shape
- Backend API 3 個 timeframe 拎 K 線
- Synthesizer 接 M5 verdict 計 SSI (e.g. M5 confidence × 0.1 bonus)

### 9.3 Browser testing
- Testing page 加 multi-tf entry
- 揀 HK.00700, 撳「跑算法」
- 等 3 個 HTTP request 拎 K 線 (1D 100 條 / 1W 26 條 / 1M 12 條)
- Render 永遠 full show 3 個 TF sub-verdict + 加權綜合 + 一致性評分

## 10. UI 顯示 (永遠 full show, 大少 11:57 永久 rule)

```
┌─────────────────────────────────────────────────┐
│ 📊 M5 Multi-TF 多時間框架週期判定                 │
│                                                  │
│ ⏰ 數據: 1D 100 條 / 1W 26 條 / 1M 12 條           │
│                                                  │
│ ① 1D (短炒, 25% weight)                          │
│    [UP] 71% 信心                                 │
│    5 條 rule match (A, F, I, ...)                │
│                                                  │
│ ② 1W (中線, 35% weight)                          │
│    [UP] 65% 信心                                 │
│    4 條 rule match (A, F, ...)                   │
│                                                  │
│ ③ 1M (大方向, 40% weight)                        │
│    [DOWN] 70% 信心                               │
│    3 條 rule match (B, G, J)                     │
│                                                  │
│ ④ 加權綜合:                                      │
│    [CONFLICT] 35% 信心                           │
│    ⚠️ 1D 逆 1W/1M, 撈底風險, 唔好入場              │
│                                                  │
│ ⑤ 一致性: divergent (3 個 TF 唔同)               │
│                                                  │
│ ⑥ Pullback 邏輯 (動態 MA):                        │
│    動態 MA10/20 support: 不適用 (撈底風險)       │
│                                                  │
│ 📖 大少話你知:                                    │
│    "1D 上升但 1M 下跌 = 短炒逆大方向,            │
│     catch falling knife 風險高, 建議等 1M 轉 UP   │
│     先入場"                                       │
└─────────────────────────────────────────────────┘
```

## 11. Integration 點

### 11.1 Synthesizer 點用 M5 verdict
- M7 Synthesizer 6 個 module verdict 加權 → 用 M5 嘅加權 confidence 額外 bonus
- 公式: `alignment_score = (6 個 module 1/N 平均) × 0.9 + M5.confidence × 0.1`
- M5 CONFLICT state → alignment_score penalty (-0.2)

### 11.2 Decision Engine 點用 M5 verdict
- M8 8 個 finalAction 嘅 trigger 額外考慮 M5 conflict flag
- CONFLICT → 將 ADD/BUY 降級去 HOLD/WAIT (避免逆大方向 entry)
- ALIGNED → 8 個 finalAction 維持原判
- 兩線策略 (position + swing) 都用 M5 alignment 做 cross-check

### 11.3 Trade Journal
- Trade Journal 落 entry 嗰陣加 optional M5 verdict (auto-fetch from cache)
- Trade Journal 嘅 forward return analysis 對齊 M5 verdict 統計 (e.g. CONFLICT 勝率 vs ALIGNED 勝率)

## 12. References

- `docs/research/AS-03-cycle-detection/MODULE-01-MA-ALIGNMENT.md` — 每個 TF 跑嘅 sub-algorithm
- `docs/research/AS-03-cycle-detection/MODULE-07-SYNTHESIZER.md` — M7 點用 M5 verdict
- `docs/research/AS-03-cycle-detection/MODULE-08-DECISION-ENGINE.md` — M8 點用 M5 verdict
- `docs/research/AS-03-cycle-detection/MODULE-09-BACK-TEST.md` — Walk-Forward CV
- `docs/research/AS-03-cycle-detection/MODULE-10-TRADE-JOURNAL.md` — Trade Journal integration
- `~/stockpulse/AGENTS.md` — Multi-TF "永遠 full show" 永久 rule
- 大少 2026-08-09 14:16 揀 A drop + 21:30 確認 go Stage 2 重新 plan
- 大少 21:30 confirm 4 個 design decision 全 A (1D+1W+1M / 分層 weights / 動態 MA / 12:1)

---

**最後更新:** 2026-08-09 21:35 (Stage 2 重新 plan, 大少 confirm go + 4 個 decision 全 A)
**維護者:** 大少 + MiniMax Code
**Status:** ⏳ Stage 2 spec done, impl pending (跟大少 workflow「先 Confirm 後動手」+「按流程做每次一個 module」)
**下次 review:** M5 implementation done + browser verify 後

# AS-03 · 股票周期判定算法 — 架構

## 🎯 目標

識別股票當前所處嘅周期 (上升 / 下跌 / 橫行 / 轉勢)，輔助大少做交易決策。

核心約束:
- 4 個 cycle state (UP / DOWN / SIDEWAYS / TRANSITION) + 中文解讀
- 5 個獨立 peer module + 1 個 HTF orchestrator step + 1 個 synthesizer
- 滯後機制 = 提醒 + 手動判 (唔做 state machine auto-progress)
- 6 個 model 結果都顯示 (UI 唔隱藏)
- 所有 threshold 集中 config.ts (calibration friendly)

## 📐 架構圖

```
                    ┌─────────────────────────┐
                    │  CycleDetector (entry)  │
                    │  index.ts               │
                    └────────────┬────────────┘
                                 │
            ┌────────────────────┼────────────────────┐
            ▼                    ▼                    ▼
    ┌───────────────┐    ┌────────────────┐   ┌──────────────┐
    │ MultiTF       │    │ 5 Peer         │   │ Synthesizer  │
    │ Orchestrator  │    │ Modules        │   │ (Module 7)   │
    │ (Module 6)    │    │ (Module 1-5)   │   │              │
    │ step 0        │    │                │   │              │
    └───────┬───────┘    └────────┬───────┘   └──────┬───────┘
            │                     │                  │
            ▼                     ▼                  ▼
    ┌─────────────────────────────────────────────────────────┐
    │              CycleReport (output)                       │
    │  - htf.verdict           (Module 6 結果)                │
    │  - moduleVerdicts[5]     (Module 1-5 結果)              │
    │  - synthesized           (Module 7 結果)                │
    │  - alerts[]              (轉勢提醒, only on change)    │
    └─────────────────────────────┬───────────────────────────┘
                                  │
                                  ▼
                          ┌───────────────┐
                          │ RegimeChange  │
                          │ Alerter       │
                          │ (alert.ts)    │
                          └───────────────┘
```

## 📊 數據流

```
Input: KLines (LTF + optional HTF)
       │
       ▼
Step 0: MultiTF Orchestrator 跑 HTF analysis (Module 6)
       │
       ├─→ HTF Verdict (state + confidence + interpretation)
       │
       ▼
Step 1-5: 5 個 Peer Modules 並列跑 LTF analysis
       │
       ├─→ MA Alignment Verdict
       ├─→ HL Structure Verdict
       ├─→ Trendline Verdict
       ├─→ Indicators Verdict
       └─→ Volume Verdict
       │
       ▼
Step 6: Synthesizer 綜合 HTF + LTF (placeholder, 設計最後先傾)
       │
       ├─→ Synthesized Verdict
       │
       ▼
Step 7: RegimeChangeAlerter 對比 previousState
       │
       └─→ Alert[] (只喺 state 變化時 emit)
       │
       ▼
Output: CycleReport
```

## 🔌 Module 介面合約

```typescript
interface CycleModule<I = KLine[]> {
  id: CycleModuleId | 'htf-multi-tf' | 'synthesized';
  version: string;
  detect(input: I, ctx: CycleContext): Promise<CycleVerdict>;
}
```

每個 module:
- ✅ **獨立**: 零耦合，唔 import 其他 module
- ✅ **可單獨調用**: `detector.runModule(id, klines, ctx)`
- ✅ **統一輸出**: 返 `CycleVerdict` 結構 (state + confidence + interpretation + evidence)
- ⚠️ **內部實作獨立**: 大少逐個 module 提供詳細做法後實作

## 🎚️ Tunable Thresholds (config.ts)

| Module | 設定 key | 預設值 | 用途 |
|--------|---------|--------|------|
| **MA** | `ma.fastPeriods` | `[5, 10]` | 短期 MA 週期 |
| | `ma.slowPeriods` | `[20, 60]` | 長期 MA 週期 |
| | `ma.alignmentGapPct` | `0.5` | MA 排列 gap % |
| | `ma.divergenceSlopePct` | `0.05` | 發散 slope 閾值 |
| **HL** | `hl.pivotLookback` | `5` | ZigZag lookback |
| | `hl.pivotThresholdPct` | `5` | pivot 反轉幅度 |
| | `hl.minSwingsToConfirm` | `3` | 確認趨勢最少 swing |
| | `hl.boxTolerancePct` | `3` | 箱體容忍 % |
| **Trendline** | `trendline.fitMethod` | `'ransac'` | RANSAC 或 linear-regression |
| | `trendline.minTouchPoints` | `2` | 至少 N 個 touch point |
| | `trendline.tolerancePct` | `2` | 距離 trendline 容差 |
| | `trendline.breakoutConfirmPct` | `1` | 突破確認幅度 |
| **Indicators** | `indicators.macd` | `{12, 26, 9}` | MACD 參數 |
| | `indicators.rsi` | `{14, 70, 30, 50}` | RSI period + OB/OS/midline |
| | `indicators.bollinger` | `{20, 2, 0.5}` | BB period + stdDev + squeeze threshold |
| **Volume** | `volume.baselinePeriod` | `5` | vol MA 週期 |
| | `volume.amplificationRatio` | `1.5` | 放量倍數 |
| | `volume.shrinkageRatio` | `0.7` | 縮量倍數 |
| **StateMachine** | `stateMachine.alertOnlyOnRegimeChange` | `true` | 只喺轉勢觸發 reminder |
| | `stateMachine.confirmationDays` | `5` | reminder 觀察日數 |
| **Aggregator** | `aggregator.strategy` | `'htf-override'` | 3 選 1 (待定) |
| | `aggregator.weights` | `{}` | per-module weight (待定) |
| | `aggregator.htfOverrideConfidence` | `0.7` | HTF override 門檻 |

## 🔄 Synthesizer (點 7) — 待設計

3 個候選策略 (大少 2026-08-04 確認: 最後先傾):

| 策略 | 邏輯 | 優點 | 缺點 |
|------|------|------|------|
| **htf-override** | HTF confidence > threshold 就壓倒 LTF | 簡單清晰、HTF 優先 | 忽略 LTF 細節 |
| **weighted-vote** | 每個 module 有 weight，weighted sum | tunable、平衡 | weight calibration 難 |
| **expert-rules** | rule-based (e.g.「MA + HL 一致就大膽」) | 解釋性強、可審計 | rule 維護成本高 |

當前 placeholder: simple majority vote (`aggregator.ts` / `synthesize.ts`)

## ⚠️ 設計約束清單

1. **Module 6 = orchestrator step 0** (架構上唔係 peer)
2. **4 個 state** (UP/DOWN/SIDEWAYS/TRANSITION) + 中文解讀 (`interpretation` 必填)
3. **轉勢提醒 ≠ auto-confirm** (大少手動判)
4. **6 個 model 結果都顯示** (UI 唔隱藏任何 peer module verdict)
5. **所有 threshold 集中** (`config.ts` 一處改晒)
6. **零耦合** (modules 之間唔直接 import)
7. **可單獨調用** (任何 module 都可以 `runModule()` 獨立跑)

## 🔗 相關

- [README.md](./README.md) — 入口 + 快速開始
- [DECISIONS.md](./DECISIONS.md) — 7 個 ADR (D001-D007)
- [~/stockpulse/docs/research/AS-03-cycle-detection/RESEARCH_LOG.md](../../docs/research/AS-03-cycle-detection/RESEARCH_LOG.md) — 研究筆記
- [~/stockpulse/docs/ALGORITHM_SPECS.md](../../docs/ALGORITHM_SPECS.md) — 全局算法規格
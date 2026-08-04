# AS-03 · 股票周期判定算法

> 識別股票所處周期（上升 / 下跌 / 橫行 / 轉勢），支援單獨調用任何判斷模組。

## 📌 來源文檔

- 原始檔: `/Users/zmenai/Downloads/股票周期判定算法.docx`（Kimi 整理嘅 6 點判斷方法 + 1 點綜合流程）
- 對應算法 ID: `AS-03`

## 📦 狀態

⏳ **Skeleton 階段 (v0.1.0-skeleton)** — 5 個 peer modules + 1 個 HTF orchestrator + 1 個 synthesizer 都係 placeholder verdict。詳細做法由大少逐個 module 提供後實作。

## 🧩 7 個點架構

| 點 | 名稱 | 模組 | 類型 |
|---|------|------|------|
| 1 | 均線系統判斷法 | `modules/ma-alignment.ts` | Peer module |
| 2 | 高低點結構法 (Dow Theory) | `modules/hl-structure.ts` | Peer module |
| 3 | 趨勢線判斷法 | `modules/trendline.ts` | Peer module |
| 4 | 技術指標輔助 (MACD / RSI / Bollinger) | `modules/indicators.ts` | Peer module |
| 5 | 成交量配合 | `modules/volume.ts` | Peer module |
| 6 | 時間框架統一性 (HTF 約束 LTF) | `orchestrator/multi-tf.ts` | **Orchestrator step 0** ⚠️ |
| 7 | 綜合判定流程 | `orchestrator/synthesize.ts` | **Orchestrator** ⚠️ |

> ⚠️ **Module 6 架構上係 orchestrator 嘅 step 0，唔係 peer module** — 大周期 vs 小周期係 hierarchy constraint，同 1-5 嘅判斷方法唔同 level。Decision: `DECISIONS.md` D001。

## 🚀 快速開始

```typescript
import { CycleDetector, VERSION } from '@/algorithms/AS-03-cycle-detection';
// 或相對 import: ../../../algorithms/AS-03-cycle-detection

const detector = new CycleDetector();

// 1️⃣ 跑單個 module（點 1-5 任一個獨立用）
const maVerdict = await detector.runModule('ma-alignment', dailyKlines, {
  symbol: '00981',
  ltf: '1d',
});
console.log(maVerdict.state);           // 'TRANSITION' (skeleton)
console.log(maVerdict.interpretation);  // '[MA Alignment skeleton] ...'

// 2️⃣ 跑全部 + 綜合 + 轉勢提醒
const report = await detector.analyze({
  symbol: '00981',
  ltfKlines: dailyKlines,
  htfKlines: weeklyKlines,     // optional — 用作 HTF analysis
  previousState: 'UP',         // optional — 用作 regime change 對比
});

console.log(report.htf);              // { timeframe: '1w', verdict: ... }
console.log(report.moduleVerdicts);   // 5 個 peer module verdicts
console.log(report.synthesized);      // 綜合 verdict (placeholder)
console.log(report.alerts);           // 轉勢提醒 (empty if no change)
```

## 📂 目錄結構

```
AS-03-cycle-detection/
├── README.md              # 本文件
├── ARCHITECTURE.md        # 詳細架構 + 數據流
├── DECISIONS.md           # ADR-style 決策記錄 (D001-D007)
├── types.ts               # 共用類型 (CycleState, Verdict, Report, Alert)
├── config.ts              # 所有 tunable thresholds 集中呢度
├── index.ts               # CycleDetector 主入口
├── modules/               # 5 個 peer modules (點 1-5)
│   ├── ma-alignment.ts
│   ├── hl-structure.ts
│   ├── trendline.ts
│   ├── indicators.ts
│   └── volume.ts
├── orchestrator/          # 點 6 + 點 7 + 輔助
│   ├── multi-tf.ts        # Module 6 — HTF 約束 LTF
│   ├── synthesize.ts      # Module 7 — 綜合判定 (placeholder)
│   ├── aggregator.ts      # conflict resolution strategy (placeholder)
│   └── alert.ts           # regime change reminders
├── __tests__/
│   └── smoke.mjs          # basic smoke test (node)
└── docs/
    └── (RESEARCH_LOG 在 ~/stockpulse/docs/research/AS-03-cycle-detection/RESEARCH_LOG.md)
```

## 🧠 核心約定

| 規則 | 來源 |
|------|------|
| **4 個 cycle state**: UP / DOWN / SIDEWAYS / TRANSITION | D002 |
| **中文解讀必填**: 每個 verdict 附 `interpretation: string` | D002 |
| **轉勢提醒 ≠ auto-confirm**: 只 emit alert，user 手動判 | D003 |
| **可單獨調用**: 每個 module 都係獨立，`runModule()` 直接跑 | 用戶要求 |
| **6 個 model 結果都顯示**: UI 顯示 5 peer + 1 HTF + 1 synthesized | D006 |
| **所有 threshold 集中 `config.ts`**: calibration 改呢度 | D005 |

## 🔗 相關文檔

- [ARCHITECTURE.md](./ARCHITECTURE.md) — 完整架構 + 數據流圖
- [DECISIONS.md](./DECISIONS.md) — 7 個重要決策 (D001-D007)
- [~/stockpulse/docs/research/AS-03-cycle-detection/RESEARCH_LOG.md](../../docs/research/AS-03-cycle-detection/RESEARCH_LOG.md) — 研究筆記

## 🏷️ 版本

- **v0.1.0-skeleton** (2026-08-04) — 初版 skeleton，所有 module placeholder

## ⏳ 待辦

- [ ] 大少提供點 1 (MA) 詳細做法
- [ ] 大少提供點 2 (HL Structure) 詳細做法
- [ ] 大少提供點 3 (Trendline) 詳細做法
- [ ] 大少提供點 4 (Indicators) 詳細做法
- [ ] 大少提供點 5 (Volume) 詳細做法
- [ ] 決定 Module 6 HTF proxy 用邊個 module
- [ ] 決定 Synthesizer / Aggregator 策略 (3 選 1)
- [ ] 決定 Backtest ground truth dataset 來源
- [ ] Update StockPulse spec docs (ALGORITHM_SPECS / ARCHITECTURE / README)
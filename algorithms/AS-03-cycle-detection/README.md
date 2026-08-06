# AS-03 · 股票周期性判定 (umbrella v1.0.0), 大少 #10332)

> 識別股票所處周期（上升 / 下跌 / 橫行 / 轉勢），支援單獨調用任何判斷模組。

## 📌 來源

- **設計者**: 大少 #10297/#10299/#10301/#10317/#10332
- **算法 ID**: `AS-03`
- **Spec**: `~/stockpulse/docs/research/AS-03-cycle-detection/MODULE-01-MA-ALIGNMENT.md`

## 📦 狀態 (v0.3.0)

✅ **Module 1: ma-alignment done** — 19/19 tests pass, TSC=0
- 10 條 rule-based 算法 (A-J) — 大少設計
- Drop 全部 v0.2.0 Kimi 8 步算法

⏳ 其他 6 個 modules 仲係 skeleton placeholder verdict (等大少 trigger 詳細做法 docx)

## 🧩 7 個 module 架構

| 點 | 名稱 | 模組 | 狀態 (v0.3.0) |
|---|------|------|------|
| 1 | 均線系統判斷法 | `modules/ma-alignment.ts` | ✅ **v0.3.0 DONE** (A-J 10 條 rule) |
| 2 | 高低點結構法 (Dow Theory) | `modules/hl-structure.ts` | ⏳ skeleton placeholder |
| 3 | 趨勢線判斷法 (chart pattern) | `modules/trendline.ts` | ⏳ skeleton placeholder |
| 4 | 技術指標輔助 (MACD / RSI / Bollinger) | `modules/indicators.ts` | ⏳ skeleton placeholder |
| 5 | 成交量配合 (OBV / 量價背馳) | `modules/volume.ts` | ⏳ skeleton placeholder |
| 6 | 時間框架統一性 (HTF 約束 LTF) | `orchestrator/multi-tf.ts` | ⏳ skeleton placeholder |
| 7 | 綜合判定流程 | `orchestrator/synthesize.ts` | ⏳ skeleton placeholder |

## 📊 Module 1: ma-alignment 嘅 10 條算法

| # | 算法 | 對應 state |
|---|------|-----------|
| A | 連續 5 日 MA5 > MA60 → 上升勢 | UP |
| B | 連續 5 日 MA5 < MA60 → 下跌勢 | DOWN |
| C | 5 日裡 MA5 > MA60 但當日 low < MA60 → 橫行向下 | SIDEWAYS |
| D | 5 日裡 MA5 < MA60 但當日 high > MA60 → 橫行向上 | SIDEWAYS |
| E | C/D 多過一日，最後一日為準 | (隱含) |
| F | MA5+MA10 都 > MA60 但 MA5 < MA10 → 升勢調整向下 | UP |
| G | MA5+MA10 都 < MA60 但 MA5 > MA10 → 跌勢調整向上 | DOWN |
| H | 7 日反轉 (1/2/3 日新方向) | TRANSITION |
| I | 連續 5 日 low ≥ MA5 × (1 - 2%) → 有機會長升狀態 | supplementary |
| J | 連續 5 日 high ≤ MA5 × (1 + 2%) → 有機會長跌狀態 | supplementary |

## 🚀 用法

```typescript
import { MAAlignmentModule } from './modules/ma-alignment.ts';

const module = new MAAlignmentModule();
const verdict = await module.detect(klines, {
  symbol: 'HK.00981',
  ltf: '1d',
});

// verdict.state: 'UP' | 'DOWN' | 'SIDEWAYS' | 'TRANSITION'
// verdict.confidence: 0-1
// verdict.interpretation: 例: "上升勢；有機會長升狀態"
// verdict.meta.matchedRules: 例: ['A', 'I', 'J']
```

## 🧪 測試

```bash
cd ~/stockpulse/algorithms/AS-03-cycle-detection
node --experimental-strip-types __tests__/ma-alignment.test.mjs
```

**19/19 pass** (TSC=0)

## 📚 相關 Docs

- `docs/research/AS-03-cycle-detection/MODULE-01-MA-ALIGNMENT.md` — v0.3.0 spec (5.5 KB)
- `docs/research/AS-03-cycle-detection/RESEARCH_LOG.md` — Timeline (12.4 KB)
- `DECISIONS.md` — D001-D016 ADR (15 KB)
- `ARCHITECTURE.md` — 系統架構圖

**最後更新**: 2026-08-05 (大少 #10332 spec docs sync)
**維護者**: 大少 + 我 (助手)
# AS-03 · 股票周期性判定 (umbrella) — 架構 (v0.3.0, 大少 #10332)

## 🎯 目標

識別股票當前所處嘅周期 (上升 / 下跌 / 橫行 / 轉勢)，輔助大少做交易決策。

**核心改變 (v0.3.0)**：原本 Kimi 8 步算法全部 drop，換上 **大少設計嘅 10 條 rule-based 算法 (A-J)**。

## 📐 架構圖 (v0.3.0)

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
            │           ┌─────────┼─────────┐        │
            │           ▼         ▼         ▼        │
            │      ┌──────────────────────────────┐  │
            │      │  Module 1: ma-alignment      │  │
            │      │  (10 條 rule A-J, 大少設計)  │  │
            │      │  v0.3.0 ✅ DONE               │  │
            │      └──────────────────────────────┘  │
            │           │         │         │        │
            │      ┌─────────┐ ┌─────────┐ ┌─────┐  │
            │      │ HL      │ │Trendline│ │ ... │  │
            │      │Structure│ │         │ │     │  │
            │      │ ⏳ TBD  │ │ ⏳ TBD  │ │     │  │
            │      └─────────┘ └─────────┘ └─────┘  │
            │                                         │
            └──────────────┬──────────────────────────┘
                           ▼
                ┌─────────────────────┐
                │  RegimeChangeAlerter │
                │  (D003: 手動 confirm) │
                └─────────────────────┘
```

## 📊 Module 1: ma-alignment (v0.3.0) — DONE ✅

10 條 rule-based 算法：

### ⚙️ Setup (2 個 step)
| Step | 內容 |
|------|------|
| **Step 1** | 取 100 日數據，少過就 fallback，少過 90 日報錯 |
| **Step 2** | 計 MA5 / MA10 / MA60 嘅 history |

### 📊 核心 Rule (A-H) — 8 條
| # | 算法 | 規則 | 對應 state | Strength |
|---|------|------|-----------|----------|
| **A** | 上升勢 | 連續 5 日 MA5 > MA60 | UP | strong |
| **B** | 下跌勢 | 連續 5 日 MA5 < MA60 | DOWN | strong |
| **C** | 橫行向下 | 5 日裡 MA5 > MA60 但當日 low < MA60 | SIDEWAYS | medium |
| **D** | 橫行向上 | 5 日裡 MA5 < MA60 但當日 high > MA60 | SIDEWAYS | medium |
| **E** | 末位日優先 | C/D 多過一日，最後一日為準 | — | — |
| **F** | 升勢調整向下 | MA5+MA10 > MA60 但 MA5 < MA10 | UP | medium |
| **G** | 跌勢調整向上 | MA5+MA10 < MA60 但 MA5 > MA10 | DOWN | medium |
| **H** | 7 日反轉 | 1/2/3 日新方向 vs 4-7 日舊方向 | TRANSITION | strong |

### 📌 Supplementary Rule (I, J) — 2 條 (大少 #10301 / #10317 typo fix)
| # | 算法 | 規則 | Strength |
|---|------|------|----------|
| **I** | 有機會長升狀態 | 連續 5 日 low ≥ MA5 × (1 - 2%) | weak |
| **J** | 有機會長跌狀態 | 連續 5 日 high ≤ MA5 × (1 + 2%) | weak |

### State derivation priority
H > A > B > F > G > C > D > default SIDEWAYS

### Confidence formula
- base = 0.7 if any strong rule (A/B/H) fires
- base = 0.5 if any medium rule (C/D/F/G) fires
- base = 0.5 else (only weak rules I/J fire 或無 match)
- +0.10 per weak rule (I/J) fired
- Cap at 1.0, round 4

## 📦 狀態

| Module | Status |
|--------|--------|
| Module 1: ma-alignment | ✅ v0.3.0 done (19/19 tests pass) |
| Module 2: HL Structure | ✅ v0.1.0 done (12/12 tests pass) — 2026-08-07 |
| Module 3: Trendline | ⏳ skeleton placeholder verdict |
| Module 4: Indicators | ⏳ skeleton placeholder verdict |
| Module 5: Volume OBV | ⏳ skeleton placeholder verdict |
| Module 6: Multi-TF | ⏳ orchestrator/multi-tf.ts skeleton |
| Module 7: Synthesizer | ⏳ orchestrator/synthesize.ts skeleton |

## 🎨 Chart Overlay (testing page contract, 2026-08-07)

Module 1 (ma-alignment) 喺 testing page 嘅 K 線圖上面 render 3 條 MA trend line：
- **MA5 紅 `#FF6B6B`** / **MA10 青 `#4ECDC4`** / **MA60 藍 `#45B7D1`**
- 用 `chart.addLineSeries` 跟股價走嘅斜線 (唔係水平價線 — 大少要 trend line 風格, 主流 trading app 風格)
- Re-compute MA 歷史 (`_computeMASeries` in adapter.mjs) — 同 ma-alignment.ts 嘅 `avgClose` 一樣
- lineWidth 2, `lastValueVisible: true` (右邊顯示當前值)
- Header `period-1` 個 point 直接 skip (避免 lightweight-charts 將 null 當 0 畫)

Module 2 (HL Structure) 同時 render peaks/troughs markers + 箱體線 + 形態預警 banner.

Function name 必須叫 `renderChartOverlay` (testing page contract).

## 🔄 已 Drop (v0.2.0 Kimi 算法)

13 個算法全部 drop，原因：
- 三個折扣叠太狠 (base × vol × slope = 0.7 × 0.65 × 0.7 = 0.31 worst case)
- Logic 太複雜 (8 步 + 9 個 hardcoded magic numbers)
- 大少 #10332 直接話「之前 V0.2.0 13 個算法全部不要」

## 📚 相關 Docs

- `~/stockpulse/docs/research/AS-03-cycle-detection/MODULE-01-MA-ALIGNMENT.md` — v0.3.0 spec
- `~/stockpulse/docs/research/AS-03-cycle-detection/RESEARCH_LOG.md` — Timeline + decisions
- `~/stockpulse/algorithms/AS-03-cycle-detection/DECISIONS.md` — D001-D016 ADR

**最後更新**: 2026-08-07 (Module 1 chart overlay + Module 2 v0.1.0 完成)
**維護者**: 大少 + 我 (助手)
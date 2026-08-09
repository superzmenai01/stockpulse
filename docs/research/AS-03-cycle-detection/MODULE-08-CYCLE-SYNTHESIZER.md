# AS-03 · Module 8 § Cycle Synthesizer (sub-section of Module 8)

> **父模組**: [./MODULE-08-DECISION-ENGINE.md](./MODULE-08-DECISION-ENGINE.md) — 終極綜合判斷引擎
> **狀態**: 🚧 v0.1.0 dev (大少 2026-08-09 19:06 確認兩線策略)
> **對應 TS 檔**: `algorithms/AS-03-cycle-detection/modules/cycle-synthesizer.ts` (272 lines)
> **對應 tests**: TBD — `algorithms/AS-03-cycle-detection/__tests__/cycle-synthesizer.test.mjs`
> **對應 adapter**: TBD — `algorithms/AS-03-cycle-detection/adapter.mjs` 加 `cycleSynthesizerAdapter`

---

## 1. 點解呢個 sub-section (Why)

M8 Decision Engine 大少 19:06 確認**兩線策略**:

- **第一線 (position trading)**: 大少 position trading 風格 — 5 個 trigger + 動態 stop + cycle 驗證
- **第二線 (swing trading)**: M8 原本 8 個 finalAction 決策樹 — 保留

呢個 sub-section 處理**第一線**嘅前置邏輯 — 用 M1 (AS-03-MA v2.0.0) 同 zmen (zmen均算法 v0.3.0) 兩個 cycle detector 互相驗證,生成 5 個 trigger 結果,畀 M8 嘅 `strategyMode='position'` path 用。

**揸車比喻**:
- M7 評卷老師 = 計 grade (A/B/C/D)
- M8 校長 = 根據 grade 落決定 (BUY/SELL/...)
- **Cycle Synthesizer = 兩個 GPS (M1 + zmen) 互相對答案** — 兩個 GPS 同意就信心高,GPS 拗頸就小心行

---

## 2. 數據輸入要求 (Input)

```typescript
interface CycleSynthesizerInput {
  m1Verdict: CycleVerdict;       // M1 (AS-03-MA v2.0.0) 嘅 cycle 判定
  zmenVerdict: CycleVerdict;     // zmen (zmen均算法 v0.3.0) 嘅 cycle 判定
  klineCloses: number[];          // [0]=今日 close, [n-1]=最舊, 至少 20 條
  weights?: CycleSynthesizerWeights;  // 預設 { m1: 0.6, zmen: 0.4 }
}
```

每個 `CycleVerdict`:
- `state`: `'UP' | 'DOWN' | 'SIDEWAYS'`
- `confidence`: 0-1
- `meta`: 證據 / matched rules (debug 用)

---

## 3. 大少 5 個 default 確認 (19:06)

| # | 設定 | 值 | 備註 |
|---|------|----|------|
| 1 | 綜合方法 | 加權平均 | M1 60% + zmen 40% (預設,可調) |
| 2 | 一致/分歧/SIDEWAYS | 一致=high confidence / 分歧=low+⚠️ / 都 SIDEWAYS=唔入場 | conflict 時 confidence × 0.5 penalty |
| 3 | confidence threshold | ≥0.65 入場 / 0.50-0.65 小心 / <0.50 唔入場 | 大少風格,嚴進嚴出 |
| 4 | 5 個 trigger base | 綜合結果 | 全部 trigger 都用 cycle 結果做 filter |
| 5 | UI 顯示 order | 第一線先, 第二線後 | testing page panel order |

---

## 4. 加權綜合邏輯 (Synthesizer)

```
baseConfidence = m1Verdict.confidence * 0.6 + zmenVerdict.confidence * 0.4

if (m1State === zmenState):
    state = m1State
    confidence = baseConfidence
    consensus = 'aligned' (or 'sideways' if state === SIDEWAYS)
else:
    state = 'CONFLICT'
    confidence = baseConfidence * 0.5   ← penalty
    consensus = 'conflict'
    warning = "⚠️ 兩個 module 訊號分歧 (M1=X / zmen=Y), 小心入場"
```

**conflict penalty = 0.5 嘅理由**: 大少寧可錯失入場機會,都唔好喺訊號混亂時入錯邊(風控優先)。

---

## 5. 5 個 Trigger (大少 position trading 風格)

| # | Trigger 名 | 條件 | 用途 |
|---|-----------|------|------|
| 1 | **ma5StopTriggered** | 今日 close < MA5 × 0.98 (-2%) | 動態 stop loss,每日 update |
| 2 | **ma5BreakDay1** | 今日 close < MA5,但未到 -2% | 第一日穿 5 日線,警戒 |
| 3 | **ma5BreakDay2** | 連續 2 日 close < MA5 | 確認跌穿,行動 trigger |
| 4 | **ma20Break** | 今日 close < MA20 | 大趨勢轉弱,嚴重訊號 |
| 5 | **ma5RetestSuccess** | 過去 5 日內曾穿 MA5,今日回升 ≥ MA5 | 跌完回升,buy-back 訊號 |

**揸車比喻**:
- Trigger 1 = 撞牆跡象(剎車唔夠)-2% 跌破
- Trigger 2 = 第一次壓到白雪糕筒(剛好擦邊)
- Trigger 3 = 連續兩個白雪糕筒(踩到去)
- Trigger 4 = 跌出大路(落咗田,20 日線跌破)
- Trigger 5 = 重新上返大路(re-test 成功,可以踩油門)

---

## 6. Cycle Transition (turn-around + adjustment)

| Transition | 條件 | 用途 |
|-----------|------|------|
| **turnAroundDetected** | 兩個 module 都 UP + 兩個 confidence 都 ≥ 0.65 | 訊號由 down 轉 up 第一日,起錨訊號 |
| **adjustmentComplete** | 兩個 module 都 UP + trigger 5 (re-test success) | 上升調整剛完,大少 buy-back trigger |

---

## 7. 輸出 Schema (CycleSynthesizerResult)

```typescript
{
  state: 'UP' | 'DOWN' | 'SIDEWAYS' | 'CONFLICT',
  confidence: number,                 // 0-1 (conflict 時已折半)
  conflict: boolean,                  // 兩個 module 唔同 state
  warning: string | null,             // 分歧時 warning message
  m1State: CycleState,                // trace
  zmenState: CycleState,              // trace
  weights: { m1: 0.6, zmen: 0.4 },
  transitions: { turnAroundDetected, adjustmentComplete },
  triggers: { ma5StopTriggered, ma5BreakDay1, ma5BreakDay2, ma20Break, ma5RetestSuccess },
  meta: {
    currentPrice: number | null,
    ma5: number | null,
    ma20: number | null,
    consensus: 'aligned' | 'conflict' | 'sideways',
  }
}
```

---

## 8. 與 M8 Decision Engine 嘅銜接 (Handoff)

`decision-engine.ts` 嘅 `DecideInput` 新加:

```typescript
{
  strategyMode: 'position' | 'swing',  // default 'swing' (backward compat)
  m1Verdict: CycleVerdict,
  zmenVerdict: CycleVerdict,
  klineCloses: number[],
  cycleSynthesizerResult?: CycleSynthesizerResult,  // optional, 否則內部 auto-derive
}
```

當 `strategyMode='position'`:
- 內部 call `synthesizeCycle(...)` 拎 result
- 用 result 嘅 5 個 trigger + transitions 推導 `position_trading_card`(動態 MA5/MA20 stop)
- 8 個 finalAction 決策樹改用 cycle result 做 first filter

當 `strategyMode='swing'`:維持原本 M8 行為(backward compat)。

UI order: 第一線 (position) 結果**先顯示**, 第二線 (swing) **後顯示**。

---

## 9. 永久 Rules

- **Rule-based + additive confidence**: 唔好 multiplicative
- **List all matched rules**: silently pick 唔准
- **Plain language 解釋**: 揸車比喻貫穿(trigger 1-5 + transition 1-2)
- **Debug meta 必填**: 畀 orchestrator 同 verifier trace 用

---

## 10. Changelog

- **v0.1.0** (2026-08-09): 大少 19:06 確認兩線策略,初版 spec 寫好,5 個 trigger + 加權 + transition 全 impl

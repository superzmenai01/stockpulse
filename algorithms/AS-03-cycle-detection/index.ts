// index.ts — AS-03 股票周期性判定 (umbrella) · 主入口
//
// 大少 #10809 (2026-08-06) — v1.0.0
//   - 加 Module 5 VolumePrice (replaces skeleton VolumeModule)
//   - 加 Module 8 SlopeMomentum (新獨立 peer module) — 大少 2026-08-07 23:15 隱藏
//   - 採用 option toggle design (D019): MA core mandatory + 5 個 optional toggle
//   - Synthesizer default = expert-rules (D004 pending 嘅 default 選擇)
//   - Handle enableFlags + null verdict gracefully
//
// 大少 2026-09-12 07:22 — §M1-M6 v2.x frontend 拎走 永久 rule (Phase 13-18)
//   拎走 M1-M6 frontend module file 6 個 (modules/ma-alignment.ts / hl-structure.ts /
//     trendline.ts / indicators.ts / volume.ts / volatility.ts)
//   拎走 std-verdict.ts 348 行 frontend wrapper 純計算
//   拎走 CycleDetector class 整個 (frontend umbrella 入口, 完全依賴 6 個 frontend module)
//   拎走 6 個 module re-export + 4 個 orchestrator import/re-export (smoke.mjs 拎走後冇人 import)
//   拎走 AnalyzeOptions interface + enableFlagsToRecord helper + DEFAULT_ENABLE_FLAGS import
//   拎走 frontend tests __tests__/{ma-alignment,hl-structure,trendline,indicators,volume,volatility,
//     smoke,standard-verdict}.test.mjs 共 8 個 file
//   M1-M6 算法完全 backend 跑 (backend/algorithms/{ma_alignment,hl_structure,trendline,indicators,
//     volume_price,volatility}/algorithm.py, 對齊 backend 已經 emit 齊 verdict meta 33-41 keys)
//   frontend testing page 用 fetch backend `/api/algorithms/run?algo=...&symbol=...` 拎 verdict
//   對齊 §數據處理 Server 內部做 (大少 2026-08-23) + §Algorithm Backend-only + 模組化 (大少 2026-08-22)
//   對齊 §M7 v2.0.4 Phase 12 frontend 拎走 永久 rule (大少 2026-09-12 07:07)
//
// 保留清單:
//   - ZmenMAAlignmentModule (大少 2026-08-08 09:13 trigger zmen均算法獨立, 唔屬 7 個 modules)
//   - DecisionEngine + ForecastScenario + DecisionVerdict (M8 follow-up, 第 2 輪拎走)
//   - MultiTFOrchestrator / RegimeChangeAlerter / Aggregator (orchestrator follow-up, 第 2 輪拎走)
//   - types.ts / config.ts 全部 type defs + config (frontend 拎走後冇人 import 但保留 file)

import { ZmenMAAlignmentModule } from './modules/zmen-ma-alignment.ts';  // 大少 2026-08-08 09:13: 舊 M1 改名 zmen均算法 (獨立算法, 唔屬 7 個 modules)

export const VERSION = '1.0.0';

// Re-exports
export * from './types.ts';
export * from './config.ts';

export { ZmenMAAlignmentModule } from './modules/zmen-ma-alignment.ts';  // 大少 2026-08-08 09:13: 舊 M1 改名 zmen均算法

// 大少 2026-08-08 13:30 — Plan A 拆返 M7 + M8 兩個獨立 module (之前 sprint 1 合併做 1 個 mega module, 而家拆返)
//   M7 Synthesizer (5 個 sub-step: SSI + TCM + Alignment + Grade + Kelly)
// 大少 2026-09-12 07:07 — §M7 v2.0.4 Phase 12 frontend 拎走 永久 rule
//   拎走 `export { Synthesizer, synthesizeAll, type SynthesizeInput } from './modules/synthesizer.ts'`
//   拎走 synthesizer.ts 整個 file (frontend 8 stage 重做違規, 違反「數據處理 Server 內部做」永久 rule)
//   M7 算法完全 backend 跑 (backend/algorithms/synthesizer/algorithm.py 1064 行, v2.0.3 8 stage)
//   frontend testing page 用 fetch backend `/api/algorithms/run?algo=synthesizer` 拎 verdict
//   對齊 §數據處理 Server 內部做 + §Algorithm Backend-only + 模組化永久 rule
//   M8 Decision Engine (Sprint 2 將加: finalAction 8 個 + trading card + 短期走勢 + 人話解讀)
export { DecisionEngine, type FinalAction, type ForecastScenario, type DecisionVerdict } from './modules/decision-engine.ts';
// 大少 2026-08-07 23:15 — SlopeMomentum 暫時隱藏,Stage 1 done 最後先做返
// export { SlopeMomentum } from './modules/slope-momentum.ts';

export { MultiTFOrchestrator } from './orchestrator/multi-tf.ts';
// 大少 2026-08-08 13:30 — OrchSynthesizer 唔再 export 出去 (避免同 M7 Synthesizer 衝突),
//   testing page 用 M7 嗰個就夠
export { RegimeChangeAlerter } from './orchestrator/alert.ts';
export { Aggregator } from './orchestrator/aggregator.ts';

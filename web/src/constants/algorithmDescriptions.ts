// Algorithm descriptions for AlgorithmStrategyPage
//
// 大少 2026-07-27 instruction:
// - 每一條 AS entry 嘅 user-facing description (V2 簡化版：只講「做啲乜」+ use case，唔講 implementation)
// - Default collapsed (使用者主動 click 先展開)
// - 將來新 AS 落呢個 file 加 entry，type-safe via Record<string, string>
//
// ⚠️ Hard-code 決定（同 SPEC 內 ALGORITHM_SPECS.md 分開）：
// - 原因：description 同 code 一齊 deploy、零 drift 風險、改動走 git review
// - SPEC 嘅 ranking 邏輯係 source of truth，呢度 description 只係 user-facing 摘要

export const ALGORITHM_DESCRIPTIONS: Record<string, string> = {
  'AS-01': '輸入 1 個或多個港股板塊（例如半導體、AI），從中搵出市值 + 換手率綜合排名最高嘅 top N 隻龍頭股（預設 10，最多 50），自動剔除 ETF、窩輪等。適合做板塊嘅 quick reference — 想買半導體但唔知揀邊隻，就用呢個 scan。',
}
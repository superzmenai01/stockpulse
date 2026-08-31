// ~/stockpulse/algorithms/AS-03-cycle-detection/adapter.mjs
//
// AS-03 均線系統週期斷法 — Testing Page Adapter
//
// 將 ma-alignment.ts / volume.ts 嘅算法 port 到 vanilla JS，
// 供 StockPulse Testing Page (~/stockpulse/testing-page/) 人手測試用。
//
// 統一 interface (Permanent Contract — 所有 AS-XX adapter 都要 implement):
//   export const id, name, version, description
//   export const inputs = [...]
//   export async function analyze(klines, options) → verdict
//   export function renderResult(verdict) → HTML string
//   export function getHelp() → HTML string (optional)
//
// 大少 2026-08-11 — Module Warning System v1.0.0
// 全部 adapter 嘅 analyze() 必須喺 verdict._warnings inlined warnings (AGENTS.md 永久 rule)
// 警告 UI: 頂部 WarningBanner (renderWarningBanner) + 個別 module 內 WarningCard (renderWarningCards)
//
// 兩個 peer module adapters (大少 #10809):
//   - 預設 exports (id/name/version/...) = ma-alignment adapter (保持 backward compat)
//   - volumePriceAdapter = VolumePrice module adapter
//
// Source of truth:
//   - ~/stockpulse/algorithms/AS-03-cycle-detection/modules/ma-alignment.ts (v0.3.0) — 大少 #10297/#10299/#10301/#10317/#10332
//   - ~/stockpulse/algorithms/AS-03-cycle-detection/modules/volume.ts (v1.0.0) — 大少 #10809
//
// 大少 2026-08-07 23:15 — Module 8 SlopeMomentum 暫時隱藏,等 Stage 1 全部 done 最後先做
//   隱藏範圍: 移除 SM adapter + config + index + orchestrator + types 嘅 references
//   將來恢復: 從 git history 拎返 + 加返呢個 file 嘅 SM block

export const id = 'AS-03';
export const name = '均線系統週期斷法';
export const version = '2.3.0';
export const description = '用 10 條 rule-based 算法 (A-J) 識別股票所處嘅周期（上升 / 下跌 / 橫行 / 轉勢）+ M5 Multi-TF 多時間框架綜合 (Stage 2) + M8 SlopeMomentum 斜率動能 (Stage 2) + 中長線/短炒 雙策略 (Position + Swing)';

// 大少 2026-08-11 — Module Warning System v1.0.0 引入 (Phase 3)
// 從 ./lib/warnings.mjs 引入 warning helpers (collect / dedupe / render)
// 各 module analyze() return 之前 call injectWarnings(verdict, [...]) 即可
import {
  WarningCollector,
  makeWarning,
  injectWarnings,
  formatWarningForCopy,
  formatAllWarningsForCopy,
  renderWarningBanner,
  renderWarningCards,
} from './lib/warnings.mjs';

export const CycleState = Object.freeze({
  UP: 'UP',
  DOWN: 'DOWN',
  SIDEWAYS: 'SIDEWAYS',
  TRANSITION: 'TRANSITION',
});

// ===== Inputs spec（testing page 動態 render form 用）=====

export const inputs = [
  {
    key: 'code',
    label: '股票代碼',
    type: 'autocomplete',                  // 大少 #10400 — 用首頁 StockSearch 一樣嘅 UX
    required: true,
    endpoint: '/api/stocks/search',       // backend: GET /api/stocks/search?q=***&market=***&limit=***
    queryParam: 'q',
    placeholder: '輸入代碼或名稱（例: 00981 或 中芯）',
    limit: 10,
    marketFn: 'auto',                      // auto-detect: 純數字 → HK, 英文字母 → US (跟首頁)
  },
  {
    key: 'period',
    label: '時間週期',
    type: 'select',
    options: [
      { value: '1d', label: '日線' },
      { value: '1w', label: '週線' },
    ],
    default: '1d',
  },
  {
    key: 'dataWindowDays',
    label: '取數據日數 (5 年 K 線, 對齊 M9, 永久 rule: 大少 2026-08-14 23:15)',
    type: 'number',
    default: 1260,
    min: 90,
    max: 1260,
  },
  {
    key: 'consecutiveDays',
    label: '連續日數（A/B/F/G 用）',
    type: 'number',
    default: 5,
    min: 1,
    max: 30,
  },
  {
    key: 'reversalWindowDays',
    label: '反轉窗口日數（H 用）',
    type: 'number',
    default: 7,
    min: 1,
    max: 30,
  },
  {
    key: 'chanceThresholdPct',
    label: 'I/J 門檻 (%)',
    type: 'number',
    default: 2.0,
    min: 0.1,
    max: 10.0,
    step: 0.1,
  },
  // 大少 #10846 (2026-08-06) — Module toggle checkboxes (UI: default OFF)
  //   - 量價分析 (VolumePrice) — confirm/disconfirm signal (D020)
  //   - 0/1 都可剔，最終由 synthesizer (expert-rules) combine
  //   - 大少 2026-08-07 23:15 — SlopeMomentum toggle 暫時隱藏 (Stage 1 done 最後先做返)
  {
    key: 'enableVolumePrice',
    label: '量價分析',
    type: 'checkbox',
    default: false,
  },
  // 大少 2026-08-09 21:33 — M5 Multi-TF 多時間框架綜合 (Stage 2 第一次 focus)
  //   - 預設 OFF (testing page UI 唔支援 3 timeframe fetch, Stage 2 統一處理)
  //   - backend caller 可以透過 options.klines1D / klines1W / klines1M 直接 invoke
  {
    key: 'enableMultiTF',
    label: 'M5 多時間框架 (Stage 2, 預設 OFF)',
    type: 'checkbox',
    default: false,
  },
  // 大少 2026-08-09 22:34 — M8 SlopeMomentum 斜率動能 (Stage 2 第二次 focus)
  //   - 預設 OFF (v1.0 spec 原本隱藏, 大少 14:16 揀 A drop, 22:34 confirm 4 個 A 重啟)
  //   - backend caller 啟用 toggle 即可 invoke
  {
    key: 'enableSlopeMomentum',
    label: 'M8 斜率動能 (Stage 2, 預設 OFF)',
    type: 'checkbox',
    default: false,
  },
];

// ===== Main analyze function =====
//
// 大少 #10846 (2026-08-06) — 從 c62d5fcb commit 嘅 module toggle design 延伸到 testing page UI：
//   - 永遠 run MA alignment (mandatory)
//   - options.enableVolumePrice === true  → run VolumePrice module
//   - 大少 2026-08-07 23:15 — SlopeMomentum toggle 暫時隱藏 (Stage 1 done 最後先做返)
//   - 如果有 ≥ 1 個 optional module 跑咗 → 用 expert-rules aggregator 綜合 verdict
//   - 冇 optional module → 維持 v0.3.0 嘅單 module verdict (backward compat)
//
// 5 個 step（port 自 ma-alignment.ts v0.3.0）：
//   Step 1 — 數據驗證（< minDataDays 報錯）
//   Step 2 — 計算 MA5/MA10/MA60 history
//   Step 3 — 10 條 rule check (A-J)
//   Step 4 — State derivation (priority H > A > B > F > G > C > D > default)
//   Step 5 — Confidence derivation (strong 0.7 / medium 0.5 / weak +0.10 bonus)

export async function analyze(klines, options = {}) {
  // 大少 #10846 — module toggles
  const enableVolumePrice = options.enableVolumePrice === true;
  const enableMultiTF = options.enableMultiTF === true;
  const enableSlopeMomentum = options.enableSlopeMomentum === true;
  // 大少 2026-08-07 23:15 — SlopeMomentum toggle 暫時隱藏 → 2026-08-09 22:34 Stage 2 重啟

  // 大少 2026-08-09 21:33 — M5 Multi-TF (Stage 2 第一次 focus)
  //   IF caller 同時提供 klines1D / klines1W / klines1M 3 個 timeframe 嘅 K-line
  //   → 直接 return synthesizeMultiTF result (skip expert-rules, 因為 multi-tf 已經 final verdict)
  //   否則 fall through 行原本 ma-alignment + volume + expert-rules flow
  if (enableMultiTF && options.klines1D && options.klines1W && options.klines1M) {
    return await analyzeMultiTF({
      symbol: options.code || 'unknown',
      klines1D: options.klines1D,
      klines1W: options.klines1W,
      klines1M: options.klines1M,
      config: options.multiTFConfig,
    });
  }

  // Always run MA alignment (mandatory)
  const maVerdict = await runMAAlignment(klines, options);

  // Collect optional module verdicts
  const moduleVerdicts = [maVerdict];
  if (enableVolumePrice) {
    moduleVerdicts.push(await analyzeVolumePrice(klines, options));
  }
  // 大少 2026-08-09 22:34 — M8 SlopeMomentum (Stage 2 第二次 focus)
  //   跟 VolumePrice 一樣加落 moduleVerdicts, 用 expert-rules aggregator combine
  //   IF M8 觸發 TRANSITION (M7/M8), 會 override ma-alignment 嘅 state (見 deriveState priority)
  if (enableSlopeMomentum) {
    moduleVerdicts.push(await analyzeSlopeMomentum({
      symbol: options.code || 'unknown',
      klines,
      config: options.slopeMomentumConfig,
    }));
  }

  // 如果只有 MA alignment — 維持 backward compat verdict shape
  if (moduleVerdicts.length === 1) {
    return maVerdict;
  }

  // 否則用 expert-rules aggregator 綜合 (port 自 orchestrator/aggregator.ts expertRulesAggregate)
  const synth = expertRulesSynthesize(moduleVerdicts);

  return {
    moduleId: id,
    timeframe: options.period || '1d',
    state: synth.state,
    confidence: synth.confidence,
    interpretation: `[Synthesized · expert-rules] ${synth.reason}。最終: ${synth.state} (信心 ${(synth.confidence * 100).toFixed(1)}%)`,
    evidence: [],
    warnings: [],
    meta: {
      synthesized: true,
      synthesizerStrategy: 'expert-rules',
      synthesizerReason: synth.reason,
      breakdown: synth.breakdown,
      enabledModules: moduleVerdicts.map(v => v.moduleId),
      moduleVerdicts,                  // 大少 #10846 — 全部 verdict 放埋 meta 入面畀 renderResult 取用
      dataDays: maVerdict.meta.dataDays,
      configUsed: maVerdict.meta.configUsed,
    },
    _warnings: maVerdict._warnings || [],  // 大少 2026-08-11 v1.0.0: propagate M1 warnings → upper verdict
    timestamp: Date.now(),
  };
}

// ===== runMAAlignment (M1 v0.3.0 zmen 算法) — extract MA alignment logic =====
//
// 大少 #10846 refactor (2026-08-06): 原本 analyze() 嘅 MA alignment 部分抽成獨立 helper。
// 保留所有 ma-alignment.ts v0.3.0 嘅 logic，唔改任何 rule。
//
// Algorithm: 10 條 rule-based (A-J) 識別股票所處嘅週期
//   - A. 連續 5 日 MA5 > MA60 → 上升勢 (strong)
//   - B. 連續 5 日 MA5 < MA60 → 下跌勢 (strong)
//   - C. 5 日裡 MA5 > MA60 但當日 low < MA60 → 橫行向下 (medium)
//   - D. 5 日裡 MA5 < MA60 但當日 high > MA60 → 橫行向上 (medium)
//   - F. 5 日裡 MA5+MA10 都 > MA60 但 MA5 < MA10 → 升勢調整向下 (medium)
//   - G. 5 日裡 MA5+MA10 都 < MA60 但 MA5 > MA10 → 跌勢調整向上 (medium)
//   - H. 7 日 reversal window (1/2/3 日新 + 餘下舊) → 轉勢 (strong)
//   - I. 連續 5 日 low ≥ MA5 × (1 - threshold) → 有機會長升 (weak)
//   - J. 連續 5 日 high ≤ MA5 × (1 + threshold) → 有機會長跌 (weak)
//
// 用法 (Usage):
//   await runMAAlignment(klines, { dataWindowDays: 100 }) → maVerdict
//
// Output: { state, confidence, interpretation, evidence, meta: { ... }, _warnings }
//   - state: 'UP' | 'DOWN' | 'SIDEWAYS' | 'TRANSITION'
//   - confidence: 0-1
//   - _warnings: ModuleWarning[] (大少 2026-08-11 Warning System v1.0.0)
//     可能包含 INSUFFICIENT_DATA / NAN_RESULT / FALLBACK_USED / CONFIG_DEFAULTS
//
// 對應 module: M1 v0.3.0 (zmen 算法, 大少獨立於 7 個 modules)
// 對應 ts file: algorithms/AS-03-cycle-detection/modules/zmen-ma-alignment.ts
// Spec doc: docs/research/AS-03-cycle-detection/MODULE-01-MA-ALIGNMENT.md

async function runMAAlignment(klines, options = {}) {
  const cfg = {
    dataWindowDays: options.dataWindowDays ?? 100,
    minDataDays: Math.min(options.dataWindowDays ?? 100, 90),
    consecutiveDays: options.consecutiveDays ?? 5,
    reversalWindowDays: options.reversalWindowDays ?? 7,
    chanceThresholdPct: (options.chanceThresholdPct ?? 2.0) / 100,
    chanceWindowDays: 5,
    chanceConfidenceBonus: 0.10,
  };

  // Step 1: 數據驗證
  if (!Array.isArray(klines) || klines.length < cfg.minDataDays) {
    throw new Error(
      `[MAAlignment] Insufficient data: need ≥ ${cfg.minDataDays} bars, got ${klines?.length ?? 0}`,
    );
  }
  const recent = klines.slice(-cfg.dataWindowDays);

  // Step 2: 計算 MA history
  const ma5History = [];
  const ma10History = [];
  const ma60History = [];

  for (let i = 0; i < recent.length; i++) {
    ma5History.push(avgClose(recent, i, 5));
    ma10History.push(avgClose(recent, i, 10));
    ma60History.push(avgClose(recent, i, 60));
  }

  // 最後 N 日
  const win = cfg.consecutiveDays;
  const last5Klines = recent.slice(-win);
  const last5MA5 = ma5History.slice(-win);
  const last5MA10 = ma10History.slice(-win);
  const last5MA60 = ma60History.slice(-win);

  // Step 3: 10 條 rule check
  const matchedRules = [];

  // A. 連續 5 日 MA5 > MA60 → 上升勢 (strong)
  if (last5MA5.every((m, i) => m > last5MA60[i])) {
    matchedRules.push({ id: 'A', label: '上升勢', strength: 'strong' });
  }

  // B. 連續 5 日 MA5 < MA60 → 下跌勢 (strong)
  if (last5MA5.every((m, i) => m < last5MA60[i])) {
    matchedRules.push({ id: 'B', label: '下跌勢', strength: 'strong' });
  }

  // C. 5 日裡 MA5 > MA60 但當日 low < MA60 → 橫行向下 (medium)
  let lastCDay = -1;
  for (let i = 0; i < win; i++) {
    if (last5MA5[i] > last5MA60[i] && last5Klines[i].low < last5MA60[i]) {
      lastCDay = i;
    }
  }
  if (lastCDay >= 0) {
    matchedRules.push({ id: 'C', label: '橫行向下', strength: 'medium' });
  }

  // D. 5 日裡 MA5 < MA60 但當日 high > MA60 → 橫行向上 (medium)
  let lastDDay = -1;
  for (let i = 0; i < win; i++) {
    if (last5MA5[i] < last5MA60[i] && last5Klines[i].high > last5MA60[i]) {
      lastDDay = i;
    }
  }
  if (lastDDay >= 0) {
    matchedRules.push({ id: 'D', label: '橫行向上', strength: 'medium' });
  }

  // F. 5 日裡 MA5+MA10 都 > MA60 但 MA5 < MA10 → 升勢調整向下 (medium)
  let lastFDay = -1;
  for (let i = 0; i < win; i++) {
    if (
      last5MA5[i] > last5MA60[i] &&
      last5MA10[i] > last5MA60[i] &&
      last5MA5[i] < last5MA10[i]
    ) {
      lastFDay = i;
    }
  }
  if (lastFDay >= 0) {
    matchedRules.push({ id: 'F', label: '升勢調整向下', strength: 'medium' });
  }

  // G. 5 日裡 MA5+MA10 都 < MA60 但 MA5 > MA10 → 跌勢調整向上 (medium)
  let lastGDay = -1;
  for (let i = 0; i < win; i++) {
    if (
      last5MA5[i] < last5MA60[i] &&
      last5MA10[i] < last5MA60[i] &&
      last5MA5[i] > last5MA10[i]
    ) {
      lastGDay = i;
    }
  }
  if (lastGDay >= 0) {
    matchedRules.push({ id: 'G', label: '跌勢調整向上', strength: 'medium' });
  }

  // H. 7 日趨勢反轉 (3 sub-case) — strong
  const revWin = cfg.reversalWindowDays;
  if (recent.length >= revWin) {
    const lastNMA5 = ma5History.slice(-revWin);
    const lastNMA60 = ma60History.slice(-revWin);

    // 跌勢轉升勢：1/2/3 日新 (上), 餘下舊 (下)
    const upDays = (n) => {
      for (let i = revWin - n; i < revWin; i++) {
        if (!(lastNMA5[i] > lastNMA60[i])) return false;
      }
      for (let i = 0; i < revWin - n; i++) {
        if (!(lastNMA5[i] < lastNMA60[i])) return false;
      }
      return true;
    };
    if (upDays(1) || upDays(2) || upDays(3)) {
      matchedRules.push({ id: 'H-reverse-up', label: '跌勢轉升勢', strength: 'strong' });
    }

    // 升勢轉跌勢：1/2/3 日新 (下), 餘下舊 (上)
    const downDays = (n) => {
      for (let i = revWin - n; i < revWin; i++) {
        if (!(lastNMA5[i] < lastNMA60[i])) return false;
      }
      for (let i = 0; i < revWin - n; i++) {
        if (!(lastNMA5[i] > lastNMA60[i])) return false;
      }
      return true;
    };
    if (downDays(1) || downDays(2) || downDays(3)) {
      matchedRules.push({ id: 'H-reverse-down', label: '升勢轉跌勢', strength: 'strong' });
    }
  }

  // I. 連續 5 日 low ≥ MA5 × (1 - threshold) → 有機會長升狀態 (weak)
  let chanceRise = true;
  for (let i = 0; i < win; i++) {
    const dayMA5 = last5MA5[i];
    if (last5Klines[i].low < dayMA5 * (1 - cfg.chanceThresholdPct)) {
      chanceRise = false;
      break;
    }
  }
  if (chanceRise) {
    matchedRules.push({ id: 'I', label: '有機會長升狀態', strength: 'weak' });
  }

  // J. 連續 5 日 high ≤ MA5 × (1 + threshold) → 有機會長跌狀態 (weak)
  // 大少 #10317 typo fix: 用 high 而唔係 low
  let chanceFall = true;
  for (let i = 0; i < win; i++) {
    const dayMA5 = last5MA5[i];
    if (last5Klines[i].high > dayMA5 * (1 + cfg.chanceThresholdPct)) {
      chanceFall = false;
      break;
    }
  }
  if (chanceFall) {
    matchedRules.push({ id: 'J', label: '有機會長跌狀態', strength: 'weak' });
  }

  // Step 4: State derivation
  // Priority: H > A > B > F > G > C > D > default SIDEWAYS
  const state = deriveState(matchedRules);

  // Step 5: Confidence derivation
  const confidence = deriveConfidence(matchedRules);

  // =============================================================
  // 大少 2026-08-15 — zmen 均算法 v1.0 — Layer 2: 9 個 sub-scenario enrich
  // 凡人話: 保留 Layer 1 4 個 state 唔變, 加 Layer 2 拎 9 個 sub-scenario 細分
  //         (跟 M1 v2.1.0 對齊, 用 zmen 自己 3 條 MA 數據 derive)
  // =============================================================
  const layer2 = deriveZmenSubScenario(ma5History, ma10History, ma60History, recent);

  // 計 maValues / maRanks / maSlopes (zmen 3 條 MA)
  const maValues = {
    MA5: round(ma5History[ma5History.length - 1], 4),
    MA10: round(ma10History[ma10History.length - 1], 4),
    MA60: round(ma60History[ma60History.length - 1], 4),
  };
  // zmen maRanks: 短到長
  const maKeys = ['MA5', 'MA10', 'MA60'];
  const maRanksByValue = [...maKeys].sort((a, b) => maValues[b] - maValues[a]);
  const rankPeriods = maRanksByValue.map(k => parseInt(k.replace('MA', ''), 10));
  const sortedPeriodsAsc = [5, 10, 60];
  const sortedPeriodsDesc = [60, 10, 5];
  let maRanks;
  if (JSON.stringify(rankPeriods) === JSON.stringify(sortedPeriodsAsc)) {
    maRanks = ['MA5', 'MA10', 'MA60'];
  } else if (JSON.stringify(rankPeriods) === JSON.stringify(sortedPeriodsDesc)) {
    maRanks = ['MA60', 'MA10', 'MA5'];
  } else {
    maRanks = maRanksByValue;
  }

  // maSlopes (zmen 3 條 MA 嘅 5 日前 vs 而家)
  const calcSlopeMeta = (maArr) => {
    if (maArr.length < 6) return 0;
    const cur = maArr[maArr.length - 1];
    const past = maArr[maArr.length - 6];
    return past > 0 ? (cur - past) / past : 0;
  };
  const maSlopes = {
    MA5: round(calcSlopeMeta(ma5History), 6),
    MA10: round(calcSlopeMeta(ma10History), 6),
    MA60: round(calcSlopeMeta(ma60History), 6),
  };

  // 計 maValues 之間嘅 maxSpreadPct
  const maValList = Object.values(maValues);
  const maxMAVal = Math.max(...maValList);
  const minMAVal = Math.min(...maValList);
  const maxSpreadPct = minMAVal > 0 ? round((maxMAVal - minMAVal) / minMAVal, 6) : 0;

  // momentumScore (zmen 3 條 MA 加權平均, 短期權重高)
  const totalWeight = 1 / 5 + 1 / 10 + 1 / 60;
  const momentumScore = round(
    (maSlopes.MA5 * (1 / 5) + maSlopes.MA10 * (1 / 10) + maSlopes.MA60 * (1 / 60)) / totalWeight,
    6
  );

  // Zmen 暫時冇 volume 同 high/low 細分, 用 neutral 兜底
  // 之後可加 volume field (zmen 入面有 last5Klines, 可計)
  const volumeTrendRatio = 1.0;
  const volumeSignal = 'neutral';
  const volumeSignalLabel = '持平';
  const adjustmentLog = layer2.subScenario === 'sideways' && matchedRules.length === 0
    ? ['Layer 1 10 條 rule 全部 fail + Layer 2 排列亂, 默認橫行']
    : (layer2.subScenario === 'decelerating_up'
        ? [`Layer 2 到頂轉勢跡象: 短期 MA5 急跌 ${(maSlopes.MA5 * 100).toFixed(2)}% + 長期 MA 仲升 + 連跌 ${layer2.consecutiveDays} 日`]
        : (layer2.subScenario === 'decelerating_down'
            ? [`Layer 2 到底轉勢跡象: 短期 MA5 急升 ${(maSlopes.MA5 * 100).toFixed(2)}% + 長期 MA 仲跌 + 連升 ${layer2.consecutiveDays} 日`]
            : (layer2.subScenario.startsWith('strong_')
                ? ['Layer 2 強趨勢跡象: 全部 MA 同方向 + 短期 MA 上/下穿長期']
                : (layer2.subScenario === 'sideways'
                    ? ['Layer 2 排列亂 + 短中期 MA 交叉, 默認橫行']
                    : ['Layer 2 sub-scenario: ' + (ZMEN_SUB_SCENARIO_LABELS[layer2.subScenario] || layer2.subScenario)]))));


  // Build verdict
  const interpretation = matchedRules.length > 0
    ? matchedRules.map((r) => r.label).join('；')
    : '無 match';

  const evidence = matchedRules.map((r) => ({
    type: `rule-${r.id}`,
    label: r.label,
    value: r.id,
    passed: true,
  }));

  // 大少 2026-08-11 — Module Warning System v1.0.0 (Phase 5a)
  // M1 MA Alignment 警告注入:
  //   🔴 INSUFFICIENT_DATA: kline count < minDataDays (default 100)
  //   🔴 NAN_RESULT: latestMA5 / latestMA10 / latestMA60 任何一個 NaN
  //   🟡 FALLBACK_USED: matchedRules 0 個 (全部 A-J rule fail, 用 default SIDEWAYS)
  //   🔵 CONFIG_DEFAULTS: dataWindowDays 用咗 default 100 (唔係用戶自訂)
  const m1Warnings = [];
  if (recent.length < cfg.minDataDays) {
    m1Warnings.push(makeWarning('critical', 'M1', 'INSUFFICIENT_DATA',
      '數據不足以跑 MA alignment',
      {
        issue: `kline count ${klines.length} < ${cfg.minDataDays} required`,
        impact: 'Verdict 唔可信, 唔好落單',
        fix: 'Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc',
        context: { kline_count: klines.length, min_required: cfg.minDataDays, period: cfg.period },
      }
    ));
  }
  // NAN check
  const nanMAs = [];
  if (!isFinite(ma5History[ma5History.length - 1])) nanMAs.push('MA5');
  if (!isFinite(ma10History[ma10History.length - 1])) nanMAs.push('MA10');
  if (!isFinite(ma60History[ma60History.length - 1])) nanMAs.push('MA60');
  if (nanMAs.length > 0) {
    m1Warnings.push(makeWarning('critical', 'M1', 'NAN_RESULT',
      'MA 計算結果 NaN',
      {
        issue: `${nanMAs.join('/')} 結果係 NaN 或 Infinity`,
        impact: 'Verdict 唔可信, 唔好落單',
        fix: 'Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc',
        context: { nan_mas: nanMAs, ma5: ma5History[ma5History.length - 1], ma10: ma10History[ma10History.length - 1], ma60: ma60History[ma60History.length - 1] },
      }
    ));
  }
  // Fallback check (matchedRules 0 個)
  if (matchedRules.length === 0 && recent.length >= cfg.minDataDays) {
    m1Warnings.push(makeWarning('warning', 'M1', 'FALLBACK_USED',
      '10 條 rule 全部 fail, fallback SIDEWAYS',
      {
        issue: 'matchedRules.length = 0 (A-J rule 全部唔 trigger)',
        impact: 'Verdict 唔可信, 唔好落單',
        fix: 'Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc',
        context: { matched_rules: 0, period: cfg.period, kline_count: recent.length },
      }
    ));
  }

  // 大少 2026-08-15 — zmen v1.0 Layer 2: 凡人話 warning 注入 (跟 Spec Sync #18 CATEGORY_DISPLAY template)
  //   THRESHOLD_BREACH (stock_state): Layer 2 信心過低
  //   CONFLICT_STATE (stock_state): Layer 2 到頂/到底轉勢 (唔覆蓋 Layer 1, 只係 enrich warning)
  if (confidence != null && confidence < 0.4) {
    m1Warnings.push(makeWarning('warning', 'M1', 'THRESHOLD_BREACH',
      `zmen 信心過低 (${(confidence * 100).toFixed(0)}%)`,
      {
        issue: `Layer 1 confidence = ${confidence.toFixed(4)} < 0.4 (${state} 判斷信心不足)`,
        impact: 'Verdict 已經準確, 留意股票狀態',
        fix: '睇其他 module 確認 / 留意 M7 alignment',
        context: { confidence, layer1_state: state, layer2_sub_scenario: layer2.subScenario },
      }
    ));
  }
  if (layer2.subScenario === 'decelerating_up') {
    m1Warnings.push(makeWarning('warning', 'M1', 'CONFLICT_STATE',
      'zmen Layer 2 見到頂轉勢跡象',
      {
        issue: `Layer 2 到頂轉勢跡象: 短期 MA5 急跌 ${(maSlopes.MA5 * 100).toFixed(2)}% + 長期 MA 仲升 + 連跌 ${layer2.consecutiveDays} 日 (見頂訊號)`,
        impact: 'Verdict 已經準確, 留意股票狀態',
        fix: '睇其他 module 確認 / 留意 M7 alignment',
        context: { layer2_sub_scenario: 'decelerating_up', consecutive_days: layer2.consecutiveDays, ma5_slope_pct: round(maSlopes.MA5 * 100, 4) },
      }
    ));
  }
  if (layer2.subScenario === 'decelerating_down') {
    m1Warnings.push(makeWarning('warning', 'M1', 'CONFLICT_STATE',
      'zmen Layer 2 見到底轉勢跡象',
      {
        issue: `Layer 2 到底轉勢跡象: 短期 MA5 急升 ${(maSlopes.MA5 * 100).toFixed(2)}% + 長期 MA 仲跌 + 連升 ${layer2.consecutiveDays} 日 (見底訊號)`,
        impact: 'Verdict 已經準確, 留意股票狀態',
        fix: '睇其他 module 確認 / 留意 M7 alignment',
        context: { layer2_sub_scenario: 'decelerating_down', consecutive_days: layer2.consecutiveDays, ma5_slope_pct: round(maSlopes.MA5 * 100, 4) },
      }
    ));
  }
  // 大少 2026-08-14 23:15 — 永久 rule: 移除 CONFIG_DEFAULTS trigger (因為 testing page 默認 1260, user 永遠唔再「冇自訂」呢個 state, warning 已經多餘)
  // 之前: if (cfg.dataWindowDays === 100) → trigger CONFIG_DEFAULTS warning
  // 之後: 永遠唔 trigger (user 喺 testing page 自己揀 default = 1260, 唔需要 system 提)

  return {
    moduleId: 'ma-alignment',
    timeframe: options.period || '1d',
    state,
    confidence,
    interpretation,
    evidence,
    warnings: m1Warnings,  // Backward compat: 保留舊 `warnings` field
    _warnings: m1Warnings,  // 大少 2026-08-11 v1.0.0: 統一 `_warnings` for WarningBanner
    meta: {
      // Layer 1 (zmen v0.3.0 保留, backward compat 100%)
      matchedRules: matchedRules.map((r) => r.id),
      ruleLabels: matchedRules.map((r) => r.label),
      latestMA5: round(ma5History[ma5History.length - 1], 4),
      latestMA10: round(ma10History[ma10History.length - 1], 4),
      latestMA60: round(ma60History[ma60History.length - 1], 4),
      dataDays: recent.length,
      configUsed: cfg,
      // 大少 2026-08-15 — zmen v1.0 Layer 2 enrich (9 個 sub-scenario + 14 個 field)
      // 凡人話: 跟 M1 v2.1.0 對齊, 14 個 field 全部用上
      cycle: layer2.subScenario,  // 9 個 sub-scenario 之一
      cycleLabel: ZMEN_SUB_SCENARIO_LABELS[layer2.subScenario] || '橫行',
      cyclePosition: layer2.cyclePosition,  // 8 個 cyclePosition 之一
      cyclePositionLabel: ZMEN_POSITION_LABELS[layer2.cyclePosition] || '橫行整理中',
      consecutiveDays: layer2.consecutiveDays,
      maValues,
      maRanks,
      maSlopes,
      momentumScore,
      maxSpreadPct,
      volumeTrendRatio,
      volumeSignal,
      volumeSignalLabel,
      adjustmentLog,
    },
    timestamp: Date.now(),
  };
}

// ===== expertRulesSynthesize (大少 #10846 — port 自 orchestrator/aggregator.ts) =====
//
// Combine 多個 module verdict 出 final verdict。邏輯跟 backend aggregator.ts 一致：
//   Step 1 — 取 ma-alignment verdict 做 base state (mandatory)
//   Step 2 — VolumePrice signal 調整 confidence:
//             CONFIRM    → +10%
//             DISCONFIRM → -30%；conf 高 → 改 TRANSITION
//             NEUTRAL    → 唔影響
//   Step 3 — 大少 2026-08-07 23:15 隱藏 SlopeMomentum verdict (Stage 1 done 最後先做返)

function expertRulesSynthesize(moduleVerdicts) {
  const reasons = [];
  const breakdown = {};

  for (const v of moduleVerdicts) {
    breakdown[`${v.moduleId}:${v.state}`] = v.confidence;
  }

  const ma = moduleVerdicts.find(v => v.moduleId === 'ma-alignment');
  if (!ma) {
    return {
      state: 'TRANSITION',
      confidence: 0,
      reason: 'Expert-rules: ma-alignment verdict missing',
      breakdown,
    };
  }

  let finalState = ma.state;
  let finalConfidence = ma.confidence;
  reasons.push(`Base ma-alignment: ${ma.state} (${(ma.confidence * 100).toFixed(1)}%)`);

  const volume = moduleVerdicts.find(v => v.moduleId === 'volume');
  if (volume) {
    const signal = volume.meta?.signal;
    if (signal === 'CONFIRM') {
      finalConfidence = Math.min(1.0, finalConfidence * 1.10);
      reasons.push(`Volume CONFIRM (+10%)`);
    } else if (signal === 'DISCONFIRM') {
      finalConfidence = Math.max(0, finalConfidence * 0.70);
      reasons.push(`Volume DISCONFIRM (-30%)`);
      if (volume.confidence > 0.7) {
        if (finalState !== 'TRANSITION') {
          reasons.push(`Volume strong DISCONFIRM → TRANSITION`);
          finalState = 'TRANSITION';
        }
      }
    } else {
      reasons.push(`Volume NEUTRAL (no change)`);
    }
  }

  // 大少 2026-08-07 23:15 — SlopeMomentum verdict 處理暫時隱藏
  //   等 Stage 1 全部 done 最後先做返,將來從 git history 拎返呢段 block

  finalConfidence = Math.round(finalConfidence * 10000) / 10000;

  return {
    state: finalState,
    confidence: finalConfidence,
    reason: reasons.join('；'),
    breakdown,
  };
}

// ===== M8 SlopeMomentum (大少 2026-08-09 22:34 — Stage 2 第二次 focus) =====
//
// Answer: 股票嘅短期 / 中期 / 長期斜率 (momentum) 點?
//   - 短期加速上升 (M1) / 下跌 (M2) = 強動能
//   - 中期斜率上升 (M3) / 下跌 (M4) = 中線趨勢
//   - 長期斜率上升 (M5) / 下跌 (M6) = 大方向
//   - 短期斜率反轉 (M7/M8) = 趨勢轉強 / 轉弱
//   - 動能加強 (M10) / 減弱 (M9) = 強弱確認
//
// 入口: caller 提供 klines 單一 timeframe, 算法自動計 MA5/MA10/MA20 slopes
//   主 analyze IF `enableSlopeMomentum=true` → 加落 moduleVerdicts 用 expert-rules combine
//   跟 ma-alignment 平級 (獨立 peer module, v1.0 spec §D 寫嘅 mapping table)
//
// 實作: browser 環境用 dynamic script load `build/slope-momentum.bundle.js` (window.SlopeMomentum)
//   Node 環境 (backend pytest) 用 dynamic import 個 slope-momentum.ts
//
// Spec doc: docs/research/AS-03-cycle-detection/MODULE-08-SLOPE-MOMENTUM.md

// Cache: 避免重複 inject <script> tag
let _slopeMomentumScriptInjected = false;

function _loadSlopeMomentumScriptTag() {
  if (typeof document === 'undefined') return;  // 非 browser 環境 skip
  if (_slopeMomentumScriptInjected) return;
  if (window.SlopeMomentum) { _slopeMomentumScriptInjected = true; return; }  // 已 loaded

  const script = document.createElement('script');
  script.src = '/algorithms/AS-03-cycle-detection/build/slope-momentum.bundle.js';
  script.async = false;  // 同步 load, 等佢 ready 先繼續
  document.head.appendChild(script);
  _slopeMomentumScriptInjected = true;
}

async function _getSlopeMomentumAnalyzer() {
  // 1. 已經 loaded (e.g. testing page 已 inject)
  if (typeof window !== 'undefined' && window.SlopeMomentum && typeof window.SlopeMomentum.analyzeSlopeMomentum === 'function') {
    return window.SlopeMomentum.analyzeSlopeMomentum;
  }
  // 2. Browser 環境 — dynamic inject script tag
  if (typeof document !== 'undefined') {
    _loadSlopeMomentumScriptTag();
    // 等 script load 完 (polling window.SlopeMomentum)
    for (let i = 0; i < 100; i++) {
      if (window.SlopeMomentum && typeof window.SlopeMomentum.analyzeSlopeMomentum === 'function') {
        return window.SlopeMomentum.analyzeSlopeMomentum;
      }
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('[M8] slope-momentum.bundle.js load timeout (5s)');
  }
  // 3. Node 環境 (backend pytest) — dynamic import .ts file
  throw new Error('[M8] Node.js slope-momentum module loader 尚未 implement, 請用 browser 環境或 backend 自接');
}

export async function analyzeSlopeMomentum(input) {
  const { symbol, klines, config, timeframe = '1d' } = input;

  if (!Array.isArray(klines) || klines.length < 20) {
    throw new Error(`[M8] K-line 數據不足: need ≥ 20 bars, got ${klines?.length ?? 0}`);
  }

  const analyze = await _getSlopeMomentumAnalyzer();
  const rawVerdict = analyze({ symbol, klines, config, timeframe });

  // Map analyzeSlopeMomentum output → adapter 標準 verdict shape
  //   - state: 4-state UP/DOWN/SIDEWAYS/TRANSITION (已經對齊)
  //   - moduleId: 'slope-momentum' (供 renderResult dispatch)
  //   - meta: keep 全部 slopes + matched rules (render 用)
  return {
    moduleId: 'slope-momentum',
    timeframe,
    state: rawVerdict.state,
    confidence: rawVerdict.confidence,
    interpretation: `[M8 SlopeMomentum] ${rawVerdict.interpretation} (信心 ${(rawVerdict.confidence * 100).toFixed(1)}%)`,
    evidence: rawVerdict.evidence,
    warnings: rawVerdict.warnings,
    meta: {
      ...rawVerdict.meta,
      subModule: 'slope-momentum',
    },
    timestamp: Date.now(),
  };
}

// ===== M8 SlopeMomentum 渲染 (renderSlopeMomentumResult) =====
//
// 永遠 full show 全部 sections (大少 11:57 永久 rule):
//   1. 綜合判定 (state pill + 信心 + 4 state 顏色)
//   2. Matched Rules (M1-M10) 列出邊啲 rule 觸發 + strength
//   3. 3 個 Slope values (MA5/MA10/MA20 % 數值)
//   4. Plain language 解讀
//   5. Cycle transition 解讀 (TRANSITION state 特別版)
//   6. 策略建議 (跟 ma-alignment 風格)
//   7. 點用呢個結果 guide

function renderSlopeMomentumResult(verdict) {
  const stateColors = {
    UP: '#52c41a',
    DOWN: '#ff4d4f',
    SIDEWAYS: '#faad14',
    TRANSITION: '#722ed1',
  };
  const stateLabels = {
    UP: '上升 (動能強)',
    DOWN: '下跌 (動能強)',
    SIDEWAYS: '橫行 (動能弱)',
    TRANSITION: '轉折 (斜率反轉)',
  };

  const color = stateColors[verdict.state] || '#666';
  const stateLabel = stateLabels[verdict.state] || verdict.state;
  const confidencePct = (verdict.confidence * 100).toFixed(1);
  const confidenceExplain = verdict.confidence >= 0.7 ? '高信心, 多條 rule 確認'
    : verdict.confidence >= 0.5 ? '中等信心, 部分 rule 確認'
    : '低信心, 只有 weak rule';

  const matchedRules = verdict.meta?.matchedRules || [];
  const ruleLabels = verdict.meta?.ruleLabels || [];
  const slopeMA5 = verdict.meta?.latestSlopeMA5 ?? 0;
  const slopeMA10 = verdict.meta?.latestSlopeMA10 ?? 0;
  const slopeMA20 = verdict.meta?.latestSlopeMA60 ?? 0;  // backward compat name (v1.0 用 MA60)
  const dataDays = verdict.meta?.dataDays || 0;

  // Rule 強度 label mapping
  const ruleStrengths = {
    M1: 'strong', M2: 'strong', M3: 'medium', M4: 'medium', M5: 'medium', M6: 'medium',
    M7: 'strong', M8: 'strong', M9: 'weak', M10: 'weak',
  };
  const strengthColors = { strong: '#52c41a', medium: '#1890ff', weak: '#faad14' };

  // Matched rules list
  const matchedRulesHtml = matchedRules.length === 0
    ? '<li style="color: #888;">無 rule 觸發</li>'
    : matchedRules.map((rid, i) => {
        const strength = ruleStrengths[rid] || 'weak';
        const strengthColor = strengthColors[strength];
        const label = ruleLabels[i] || rid;
        return `<li style="margin: 4px 0;">
          <span style="background: ${strengthColor}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">${rid}</span>
          <span style="margin-left: 8px;">${label}</span>
          <span style="color: #888; font-size: 11px;">[${strength}]</span>
        </li>`;
      }).join('');

  // Plain language 解讀
  const slope5Pct = (slopeMA5 * 100).toFixed(2);
  const slope10Pct = (slopeMA10 * 100).toFixed(2);
  const slope20Pct = (slopeMA20 * 100).toFixed(2);

  let plainLanguage = '';
  if (verdict.state === 'UP') {
    plainLanguage = `
      <p>📌 <strong>簡單講</strong>: 短期 / 中期 / 長期斜率都支持上升, 動能強, 順勢持倉。</p>
      <p>📊 <strong>咩意思</strong>: MA5 5 日斜率 ${slope5Pct}%, MA10 10 日斜率 ${slope10Pct}%, MA20 20 日斜率 ${slope20Pct}%, 三個 timeframe 嘅斜率都係正數, 確認上升動能持續。</p>
      <p>💡 <strong>點睇呢個結果</strong>: <b>順勢信號</b>, 配合 ma-alignment 嘅 alignment 確認更穩。留意 M7 (短期斜率轉正) 觸發就係見頂警號。</p>
    `;
  } else if (verdict.state === 'DOWN') {
    plainLanguage = `
      <p>📌 <strong>簡單講</strong>: 短期 / 中期 / 長期斜率都支持下跌, 動能強, 避開 / 減倉。</p>
      <p>📊 <strong>咩意思</strong>: MA5 5 日斜率 ${slope5Pct}%, MA10 10 日斜率 ${slope10Pct}%, MA20 20 日斜率 ${slope20Pct}%, 三個 timeframe 嘅斜率都係負數, 確認下跌動能持續。</p>
      <p>💡 <strong>點睇呢個結果</strong>: <b>弱勢信號</b>, 唔好撈底。留意 M8 (短期斜率轉負) 觸發就係見底警號。</p>
    `;
  } else if (verdict.state === 'TRANSITION') {
    plainLanguage = `
      <p>📌 <strong>簡單講</strong>: 短期斜率 5 日內由 ${matchedRules.includes('M7') ? '負轉正' : '正轉負'}, 趨勢可能即將改變方向。</p>
      <p>📊 <strong>咩意思</strong>: MA5 短期斜率出現 zero-cross, 係最早期嘅 trend reversal signal (通常早 ma-alignment H rule 1-3 日 trigger)。</p>
      <p>💡 <strong>點睇呢個結果</strong>: 等待方向確認, <b>唔好搶跑</b>。等新趨勢確認 (M1/M3/M5 一致) + 量能配合再入市。</p>
    `;
  } else {
    plainLanguage = `
      <p>📌 <strong>簡單講</strong>: 短期動能減弱 (M9 觸發), 斜率近乎 0, 等市場給方向。</p>
      <p>📊 <strong>咩意思</strong>: MA5 5 日斜率 ${slope5Pct}%, 接近 0, 短期動能唔明顯。</p>
      <p>💡 <strong>點睇呢個結果</strong>: 橫行結構, <b>等方向</b>。配合 ma-alignment 等 MA 突破先做。</p>
    `;
  }

  // 策略建議
  let strategyAdvice = '';
  if (verdict.state === 'UP') {
    strategyAdvice = `
      <div class="strategy-up">
        <h4>🟢 上升 (動能強) · 策略建議</h4>
        <p><strong>基本動作:</strong>順勢持倉, 慢慢加倉</p>
        <p><strong>訊號確認:</strong>M1 (MA5 短期加速上升) 同 M3/M5 (中長期支持) 觸發, 動能強</p>
        <p><strong>風險管理:</strong>留意 M7 (短期斜率轉正) 觸發就係見頂警號</p>
        <p><strong>配合 ma-alignment:</strong>M8 UP + ma-alignment UP = 強 UP 信號 (synthesizer combine 加權)</p>
      </div>
    `;
  } else if (verdict.state === 'DOWN') {
    strategyAdvice = `
      <div class="strategy-down">
        <h4>🔴 下跌 (動能強) · 策略建議</h4>
        <p><strong>基本動作:</strong>避開 / 考慮減倉</p>
        <p><strong>訊號確認:</strong>M2 (MA5 短期加速下跌) 同 M4/M6 (中長期支持) 觸發, 動能強</p>
        <p><strong>風險管理:</strong>留意 M8 (短期斜率轉負) 觸發就係見底警號</p>
        <p><strong>配合 ma-alignment:</strong>M8 DOWN + ma-alignment DOWN = 強 DOWN 信號</p>
      </div>
    `;
  } else if (verdict.state === 'TRANSITION') {
    strategyAdvice = `
      <div class="strategy-transition">
        <h4>🟣 轉折 (斜率反轉) · 策略建議</h4>
        <p><strong>基本動作:</strong>暫時 hold, 等方向確認</p>
        <p><strong>訊號確認:</strong>M7 / M8 觸發, 短期斜率出現 zero-cross, 趨勢可能轉</p>
        <p><strong>進場策略:</strong>暫時唔好落新單, 等下個確認 signal (M1/M3/M5 一致)</p>
        <p><strong>風險:</strong>轉折失敗可能係假突破, 要小心</p>
      </div>
    `;
  } else {
    strategyAdvice = `
      <div class="strategy-sideways">
        <h4>🟡 橫行 (動能弱) · 策略建議</h4>
        <p><strong>基本動作:</strong>等方向, 等 M7/M8 觸發先做</p>
        <p><strong>訊號確認:</strong>M9 觸發, 短期動能近乎 0, 等方向</p>
        <p><strong>配合 ma-alignment:</strong>M8 SIDEWAYS + ma-alignment SIDEWAYS = 確認橫行</p>
      </div>
    `;
  }

  return `
    <div class="as03-verdict as03-module-card as03-slope-momentum">
      <div class="module-card-header">
        <h4>📈 M8 SlopeMomentum 斜率動能 (v1.0.0, Stage 2 re-elevate)</h4>
      </div>
      <div class="verdict-header">
        <div class="state-pill" style="background: ${color}">
          <span class="state-label">${stateLabel}</span>
          <span class="state-code">${verdict.state}</span>
        </div>
        <div class="confidence">
          <div class="conf-pct">${confidencePct}%</div>
          <div class="conf-label">信心指數 — ${confidenceExplain}</div>
        </div>
        <div class="data-summary">
          <div class="summary-row"><span>時間週期:</span> <strong>${verdict.timeframe}</strong></div>
          <div class="summary-row"><span>數據日數:</span> <strong>${dataDays}</strong></div>
          <div class="summary-row"><span>Matched Rules:</span> <strong>${matchedRules.length}</strong></div>
        </div>
      </div>

      <div class="interpretation">
        <strong>📌 解讀：</strong>${verdict.interpretation}
        ${plainLanguage}
      </div>

      <div class="slope-values">
        <h4>📊 3 個 Slope 值</h4>
        <div class="ma-grid">
          <div class="ma-item"><span class="ma-label">MA5 5 日斜率</span><span class="ma-value" style="color: ${slopeMA5 > 0 ? '#52c41a' : slopeMA5 < 0 ? '#ff4d4f' : '#666'};">${slope5Pct}%</span></div>
          <div class="ma-item"><span class="ma-label">MA10 10 日斜率</span><span class="ma-value" style="color: ${slopeMA10 > 0 ? '#52c41a' : slopeMA10 < 0 ? '#ff4d4f' : '#666'};">${slope10Pct}%</span></div>
          <div class="ma-item"><span class="ma-label">MA20 20 日斜率</span><span class="ma-value" style="color: ${slopeMA20 > 0 ? '#52c41a' : slopeMA20 < 0 ? '#ff4d4f' : '#666'};">${slope20Pct}%</span></div>
        </div>
      </div>

      <div class="matched-rules">
        <h4>🎯 Matched Rules (${matchedRules.length} 條, M1-M10)</h4>
        <ul>${matchedRulesHtml}</ul>
      </div>

      ${strategyAdvice}

      <div class="usage-guide">
        <h4>💡 點用呢個結果 (M8 特別版)</h4>
        <ol>
          <li><strong>先睇綜合 state 同信心</strong> — 個大色塊 (綠=UP / 紅=DOWN / 橙=SIDEWAYS / 紫=TRANSITION) 同信心百分比</li>
          <li><strong>睇 3 個 slope 值嗰 3 個 box</strong> — MA5/MA10/MA20 嘅 % 數值, 比較 3 個 timeframe 嘅方向一致性</li>
          <li><strong>睇「Matched Rules」嗰行</strong> — 例如「M1」= 強烈上升, 「H-reverse-down」= 7 日內由升轉跌。每條 rule 都有具體意思, 睇「📌 解讀」section</li>
          <li><strong>TRANSITION 一定要小心</strong> — 斜率反轉係最早期嘅 trend reversal signal, 但係假突破風險高, 唔好搶跑</li>
          <li><strong>配合 ma-alignment 一齊睇</strong> — M8 講 momentum (速度), ma-alignment 講 alignment (位置), 兩者一致 = 強信號, 矛盾 = 等方向</li>
          <li><strong>synthesizer combine</strong> — 將來 M7 synthesizer 會 combine M1 + M8 兩個 verdict, 跟 v1.0 spec §D mapping table</li>
        </ol>
        <p class="caveat">⚠️ M8 係 Stage 2 第二次 focus re-elevate, 原本 v1.0 spec 已經有 (27/27 tests pass), 大少 14:16 揀 A drop 隱藏, 22:34 confirm 4 個 A 重啟</p>
      </div>

      <details class="meta-details">
        <summary>🔧 配置 (debug 用)</summary>
        <pre>${JSON.stringify(verdict.meta?.configUsed || {}, null, 2)}</pre>
      </details>
    </div>
  `;
}

// ===== M5 Multi-TF (大少 2026-08-09 21:33 — Stage 2 第一次 focus) =====
//
// Answer: 3 個 timeframe 嘅 cycle 方向一致嗎?
//   - 一致 (3 個 TF 同一方向) = 高信心
//   - 半一致 (1 個 TF 唔同) = 中信心 + ⚠️ warning
//   - 完全分歧 (3 個 TF 唔同) = CONFLICT 唔好入場
//
// 加權: 1D 25% / 1W 35% / 1M 40% (大方向權重最高, 大少 21:33 揀 A D2)
//
// 入口: caller 提供 klines1D / klines1W / klines1M 3 組 K-line
//   主 analyze IF `enableMultiTF=true` AND 3 klines 都有 → return 呢個 verdict
//   唔行 expert-rules aggregator (multi-tf 已經係 final, double-penalty 會錯)
//
// 實作: browser 環境用 dynamic script load `build/multi-tf.bundle.js` (window.MultiTF)
//   Node 環境 (backend pytest) 用 dynamic import 個 multi-tf.ts
//
// Spec doc: docs/research/AS-03-cycle-detection/MODULE-05-MULTI-TIMEFRAME.md

// Cache: 避免重複 inject <script> tag
let _multiTFScriptInjected = false;

function _loadMultiTFScriptTag() {
  if (typeof document === 'undefined') return;  // 非 browser 環境 skip
  if (_multiTFScriptInjected) return;
  if (window.MultiTF) { _multiTFScriptInjected = true; return; }  // 已 loaded

  const script = document.createElement('script');
  script.src = '/algorithms/AS-03-cycle-detection/build/multi-tf.bundle.js';
  script.async = false;  // 同步 load, 等佢 ready 先繼續
  document.head.appendChild(script);
  _multiTFScriptInjected = true;
}

async function _getMultiTFSynthesizer() {
  // 1. 已經 loaded (e.g. testing page 已 inject)
  if (typeof window !== 'undefined' && window.MultiTF && typeof window.MultiTF.synthesizeMultiTF === 'function') {
    return window.MultiTF.synthesizeMultiTF;
  }
  // 2. Browser 環境 — dynamic inject script tag
  if (typeof document !== 'undefined') {
    _loadMultiTFScriptTag();
    // 等 script load 完 (polling window.MultiTF)
    for (let i = 0; i < 100; i++) {
      if (window.MultiTF && typeof window.MultiTF.synthesizeMultiTF === 'function') {
        return window.MultiTF.synthesizeMultiTF;
      }
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('[M5] multi-tf.bundle.js load timeout (5s)');
  }
  // 3. Node 環境 (backend pytest) — dynamic import .ts file
  //    (透過 Node --experimental-strip-types 支援)
  throw new Error('[M5] Node.js multi-tf module loader 尚未 implement, 請用 browser 環境或 backend 自接');
}

export async function analyzeMultiTF(input) {
  const { symbol, klines1D, klines1W, klines1M, config } = input;

  if (!Array.isArray(klines1D) || klines1D.length < 90) {
    throw new Error(`[M5] 1D K-line 數據不足: need ≥ 90 bars, got ${klines1D?.length ?? 0}`);
  }
  if (!Array.isArray(klines1W) || klines1W.length < 26) {
    throw new Error(`[M5] 1W K-line 數據不足: need ≥ 26 bars, got ${klines1W?.length ?? 0}`);
  }
  if (!Array.isArray(klines1M) || klines1M.length < 12) {
    throw new Error(`[M5] 1M K-line 數據不足: need ≥ 12 bars, got ${klines1M?.length ?? 0}`);
  }

  const synthesize = await _getMultiTFSynthesizer();
  const rawVerdict = synthesize({ symbol, klines1D, klines1W, klines1M, config });

  // Map synthesizeMultiTF output → adapter 標準 verdict shape
  //   - state: UP/DOWN/SIDEWAYS/CONFLICT (CONFLICT map 去 TRANSITION 顯示)
  //   - moduleId: 'multi-tf' (供 renderResult dispatch)
  //   - meta.timeframe_verdicts: 3 個 TF 嘅 sub-verdict (render 用)
  return {
    moduleId: 'multi-tf',
    timeframe: '1D+1W+1M',
    state: rawVerdict.state === 'CONFLICT' ? 'TRANSITION' : rawVerdict.state,
    confidence: rawVerdict.confidence,
    interpretation: rawVerdict.warning
      ? `[M5 Multi-TF] ${rawVerdict.state} (信心 ${(rawVerdict.confidence * 100).toFixed(1)}%) — ${rawVerdict.warning}`
      : `[M5 Multi-TF] ${rawVerdict.state} (信心 ${(rawVerdict.confidence * 100).toFixed(1)}%) — ${rawVerdict.consensus.description}`,
    evidence: [],
    warnings: rawVerdict.warning ? [rawVerdict.warning] : [],
    meta: {
      ...rawVerdict.meta,
      subModule: 'multi-tf',
      rawState: rawVerdict.state,
      consensus: rawVerdict.consensus,
      timeframeVerdicts: rawVerdict.timeframe_verdicts,
      transitions: rawVerdict.transitions,
    },
    timestamp: Date.now(),
  };
}

// ===== M5 Multi-TF 渲染 (renderMultiTFResult) =====
//
// 永遠 full show 全部 sections (大少 11:57 永久 rule):
//   1. 綜合判定 (state pill + 信心 + 3 TF 一致性)
//   2. 3 個 timeframe 各自嘅 sub-verdict card (UP/DOWN/SIDEWAYS + MA5/10/20/60)
//   3. Consensus 一致性評分 + direction
//   4. Warning (分歧時顯示)
//   5. Cycle transition (turn_around / adjustment_complete)
//   6. 詳細解讀 (plain language)
//   7. 策略建議

function renderMultiTFResult(verdict) {
  const stateColors = {
    UP: '#52c41a',
    DOWN: '#ff4d4f',
    SIDEWAYS: '#faad14',
    TRANSITION: '#722ed1',
    CONFLICT: '#722ed1',
  };
  const stateLabels = {
    UP: '上升 (3 TF 一致)',
    DOWN: '下跌 (3 TF 一致)',
    SIDEWAYS: '橫行 (3 TF 一致)',
    TRANSITION: '轉折 (CONFLICT 唔好入場)',
    CONFLICT: '轉折 (CONFLICT 唔好入場)',
  };

  const rawState = verdict.meta?.rawState || verdict.state;
  const color = stateColors[verdict.state] || '#666';
  const stateLabel = stateLabels[verdict.state] || verdict.state;
  const confidencePct = (verdict.confidence * 100).toFixed(1);
  const confidenceExplain = verdict.confidence >= 0.7 ? '高信心, 3 TF 一致大方向'
    : verdict.confidence >= 0.5 ? '中等信心, 部分 TF 分歧'
    : '低信心, 多個 TF 分歧';

  const consensus = verdict.meta?.consensus || {};
  const tfVerdicts = verdict.meta?.timeframeVerdicts || {};
  const transitions = verdict.meta?.transitions || {};
  const warning = verdict.warnings?.[0] || null;

  // 3 個 timeframe 嘅 sub-verdict card
  const tfOrder = ['1D', '1W', '1M'];
  const tfCards = tfOrder.map((tf) => {
    const tv = tfVerdicts[tf];
    if (!tv) return '';
    const tfColor = stateColors[tv.state] || '#666';
    const tfLabel = stateLabels[tv.state] || tv.state;
    const tfConf = (tv.confidence * 100).toFixed(0);
    return `
      <div class="m5-tf-card" style="border: 2px solid ${tfColor}; border-radius: 8px; padding: 12px; background: #fafafa;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <h5 style="margin: 0; color: #333;">📊 ${tf} (${tf === '1D' ? '日線' : tf === '1W' ? '週線' : '月線'})</h5>
          <span style="background: ${tfColor}; color: white; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: bold;">${tfLabel} · ${tfConf}%</span>
        </div>
        <table style="width: 100%; font-size: 12px; border-collapse: collapse;">
          <tr><td style="padding: 3px 0; color: #666;">資料日數</td><td style="text-align: right;"><strong>${tv.data_days}</strong> 日</td></tr>
          <tr><td style="padding: 3px 0; color: #666;">現價</td><td style="text-align: right;"><strong>$${tv.current_price?.toFixed(2) || 'N/A'}</strong></td></tr>
          <tr><td style="padding: 3px 0; color: #666;">MA5</td><td style="text-align: right;">$${tv.ma5?.toFixed(2) || 'N/A'}</td></tr>
          <tr><td style="padding: 3px 0; color: #666;">MA10</td><td style="text-align: right;">$${tv.ma10?.toFixed(2) || 'N/A'}</td></tr>
          <tr><td style="padding: 3px 0; color: #666;">MA20</td><td style="text-align: right;">$${tv.ma20?.toFixed(2) || 'N/A'}</td></tr>
          <tr><td style="padding: 3px 0; color: #666;">MA60</td><td style="text-align: right;">$${tv.ma60?.toFixed(2) || 'N/A'}</td></tr>
          <tr><td style="padding: 3px 0; color: #666;">Matched rules</td><td style="text-align: right;">${tv.matched_rules?.join(', ') || '無'}</td></tr>
        </table>
      </div>
    `;
  }).join('');

  // Plain language 簡單解讀
  let plainLanguage = '';
  if (rawState === 'UP') {
    plainLanguage = `
      <p>📌 <strong>簡單講</strong>: 3 個 timeframe 嘅 cycle 方向都係 <b>上升</b>, 大方向同短期一致, 上升趨勢確認。</p>
      <p>📊 <strong>咩意思</strong>: 1D (日線) 確認短線向上, 1W (週線) 確認中線向上, 1M (月線) 確認大方向向上, 三個時間尺度都睇好。</p>
      <p>💡 <strong>點睇呢個結果</strong>: 呢個係 <b>最強訊號</b>, 可以考慮順勢持有 / 逢回調加倉。留意 1D 嘅 MA5 跌破警號 (短線轉弱), 1W/1M 嘅反轉信號。</p>
    `;
  } else if (rawState === 'DOWN') {
    plainLanguage = `
      <p>📌 <strong>簡單講</strong>: 3 個 timeframe 嘅 cycle 方向都係 <b>下跌</b>, 大方向同短期一致, 下跌趨勢確認。</p>
      <p>📊 <strong>咩意思</strong>: 1D (日線) 確認短線向下, 1W (週線) 確認中線向下, 1M (月線) 確認大方向向下, 三個時間尺度都看淡。</p>
      <p>💡 <strong>點睇呢個結果</strong>: 呢個係 <b>最弱訊號</b>, 應該避開 / 考慮減倉。留意 1D 嘅 MA5 升穿警號 (短線轉強), 1W/1M 嘅見底信號。</p>
    `;
  } else if (rawState === 'SIDEWAYS') {
    plainLanguage = `
      <p>📌 <strong>簡單講</strong>: 3 個 timeframe 嘅 cycle 方向都係 <b>橫行</b>, 大方向同短期都冇明確方向, 等突破信號。</p>
      <p>📊 <strong>咩意思</strong>: 1D/1W/1M 三個時間尺度都係橫行, 結構混亂, 等方向確認。</p>
      <p>💡 <strong>點睇呢個結果</strong>: 橫行結構, <b>唔好入場</b>, 等 MA 突破先做。配合 M6 Volatility Squeeze 訊號可以捕捉突破時機。</p>
    `;
  } else if (rawState === 'CONFLICT') {
    plainLanguage = `
      <p>📌 <strong>簡單講</strong>: 3 個 timeframe 嘅 cycle 方向 <b>完全唔同</b> (e.g. 1D UP, 1W DOWN, 1M SIDEWAYS), 撈底風險極高。</p>
      <p>📊 <strong>咩意思</strong>: 短中長期方向矛盾, 唔好入場, 等其中一個 TF 確認方向先。</p>
      <p>💡 <strong>點睇呢個結果</strong>: <b>完全分歧</b>, 信心已被自動降低 50%, 唔好撈底。配合 Trade Journal 記低原因, 等下次睇返學習。</p>
    `;
  } else {
    // 2 個 TF 一致, 1 個 TF 唔同 (partial)
    plainLanguage = `
      <p>📌 <strong>簡單講</strong>: 3 個 timeframe 嘅 cycle 方向 <b>部分一致</b> (2 個 TF 一致, 1 個 TF 唔同), 信心降低 ${((1 - 0.85) * 100).toFixed(0)}%。</p>
      <p>📊 <strong>咩意思</strong>: 大方向有確認但短 / 中線有矛盾, 信號唔算最強, 小心入場。</p>
      <p>💡 <strong>點睇呢個結果</strong>: ${warning || '留意分歧嗰個 TF 嘅解讀'}, 入場前要再 confirm 一下。</p>
    `;
  }

  // 策略建議
  let strategyAdvice = '';
  if (rawState === 'UP' || rawState === 'DOWN') {
    const action = rawState === 'UP' ? '順勢持有 / 逢回調加倉' : '避開 / 減倉';
    strategyAdvice = `
      <div class="strategy-${rawState.toLowerCase()}">
        <h4>${rawState === 'UP' ? '🟢' : '🔴'} ${rawState === 'UP' ? '大方向向上' : '大方向向下'} (3 TF 一致) · 策略建議</h4>
        <p><strong>基本動作:</strong>${action}</p>
        <p><strong>確認強度:</strong>3 TF 一致, 信心 ${confidencePct}%, 屬於高信心信號</p>
        <p><strong>止損位:</strong>1D 嘅 MA5 × 0.98 (短線警號)</p>
        <p><strong>進場策略:</strong>等回調到 MA10/MA20 附近再反彈, 低吸</p>
        ${transitions.turn_around ? '<p><strong>特別注意:</strong>檢測到 <b>turn_around</b> (大方向轉勢), 入場要更穩健</p>' : ''}
      </div>
    `;
  } else if (rawState === 'CONFLICT') {
    strategyAdvice = `
      <div class="strategy-conflict">
        <h4>🟣 3 TF 完全分歧 (CONFLICT) · 策略建議</h4>
        <p><strong>基本動作:</strong><b>唔好入場</b>, 等方向確認</p>
        <p><strong>確認強度:</strong>CONFLICT 信心已被自動折半 (× 0.5)</p>
        <p><strong>風險:</strong>撈底風險極高, 3 個時間尺度互相矛盾</p>
        <p><strong>觀察重點:</strong>等其中一個 TF 確認方向先再入場</p>
      </div>
    `;
  } else {
    strategyAdvice = `
      <div class="strategy-sideways">
        <h4>🟡 3 TF 橫行 (SIDEWAYS) · 策略建議</h4>
        <p><strong>基本動作:</strong>等方向, 等 MA 突破</p>
        <p><strong>確認強度:</strong>3 TF 橫行, 結構混亂</p>
        <p><strong>進場策略:</strong>唔好喺橫行中間進場, 等 1D 突破 1W MA60 先做</p>
        <p><strong>觀察重點:</strong>配合 M6 Volatility Squeeze 捕捉突破</p>
      </div>
    `;
  }

  return `
    <div class="as03-verdict as03-module-card as03-multi-tf">
      <div class="module-card-header">
        <h4>🌐 M5 Multi-TF 多時間框架綜合 (v1.0.0, Stage 2)</h4>
      </div>
      <div class="verdict-header">
        <div class="state-pill" style="background: ${color}">
          <span class="state-label">${stateLabel}</span>
          <span class="state-code">${verdict.state}</span>
        </div>
        <div class="confidence">
          <div class="conf-pct">${confidencePct}%</div>
          <div class="conf-label">信心指數 — ${confidenceExplain}</div>
        </div>
        <div class="data-summary">
          <div class="summary-row"><span>綜合時間週期:</span> <strong>1D + 1W + 1M</strong></div>
          <div class="summary-row"><span>Consensus Score:</span> <strong>${(consensus.score ?? 0).toFixed(2)}</strong></div>
          <div class="summary-row"><span>Consensus Direction:</span> <strong>${consensus.direction ?? 'N/A'}</strong></div>
        </div>
      </div>

      ${warning ? `<div class="warning-box" style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 12px; border-radius: 6px; margin: 12px 0;">⚠️ <strong>Warning:</strong> ${warning}</div>` : ''}

      <div class="interpretation">
        <strong>📌 解讀：</strong>${verdict.interpretation}
        ${plainLanguage}
      </div>

      <h4 style="margin-top: 16px; color: #555;">📊 3 個 Timeframe 嘅 Sub-Verdict</h4>
      <div class="m5-tf-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 12px 0;">
        ${tfCards}
      </div>

      <div class="consensus-detail">
        <h4>🎯 Consensus 一致性評分</h4>
        <p>Score: <strong>${(consensus.score ?? 0).toFixed(2)}</strong> (0-1, 越高越一致)</p>
        <p>Direction: <strong>${consensus.direction ?? 'N/A'}</strong> (aligned=完全一致 / partial=部分一致 / divergent=完全分歧)</p>
        <p>Description: ${consensus.description ?? 'N/A'}</p>
        <p>權重: 1D 25% / 1W 35% / 1M 40% (大方向權重最高, 大少 21:33 揀 A D2)</p>
      </div>

      ${(transitions.turn_around || transitions.adjustment_complete) ? `
        <div class="transitions-box" style="background: #e7f3ff; border: 1px solid #91d5ff; padding: 12px; border-radius: 6px; margin: 12px 0;">
          <h4 style="margin: 0 0 8px 0;">🔄 Cycle Transitions</h4>
          ${transitions.turn_around ? '<p>✅ <strong>turn_around</strong> — 大方向由 DOWN 轉 UP, 1M + 1D 都 UP, 信心 ≥ 65%</p>' : ''}
          ${transitions.adjustment_complete ? '<p>✅ <strong>adjustment_complete</strong> — 大方向調整剛完</p>' : ''}
        </div>
      ` : ''}

      ${strategyAdvice}

      <div class="usage-guide">
        <h4>💡 點用呢個結果 (M5 特別版)</h4>
        <ol>
          <li><strong>先睇綜合 state 同信心</strong> — 個大色塊 (綠=UP / 紅=DOWN / 橙=SIDEWAYS / 紫=CONFLICT) 同信心百分比</li>
          <li><strong>睇 3 個 TF 各自嘅 sub-verdict</strong> — 如果有 1 個 TF 唔同, 就係 partial, 信心打折; 3 個 TF 完全唔同就係 CONFLICT</li>
          <li><strong>睇 MA 值嗰 3 個 box</strong> — 每個 TF 嘅 MA5/10/20/60 數值, 比較當前價同 MA 嘅距離</li>
          <li><strong>信心 &lt; 50% 唔好落單</strong> — 寧願等下一個更明顯信號</li>
          <li><strong>CONFLICT 一定要避</strong> — 3 個時間尺度矛盾, 撈底風險極高</li>
          <li><strong>大方向 (1M) 權重最高 (40%)</strong> — 因為大方向最難改變, 1M UP 就 long-term 看好</li>
        </ol>
        <p class="caveat">⚠️ M5 係 Stage 2 第一次 focus, testing page UI 整合 Stage 2 統一處理 (而家 toggle 預設 OFF)</p>
      </div>

      <details class="meta-details">
        <summary>🔧 配置 (debug 用)</summary>
        <pre>${JSON.stringify(verdict.meta?.tf_weights || {}, null, 2)}</pre>
        <p>數據日數: 1D=${verdict.meta?.data_days_1d ?? 0} / 1W=${verdict.meta?.data_days_1w ?? 0} / 1M=${verdict.meta?.data_days_1m ?? 0}</p>
      </details>
    </div>
  `;
}

// ===== Helpers =====

/**
 * postJSON — fetch POST wrapper with response.ok check (大少 2026-08-10 Bug 1 fix)
 *
 * 之前所有 POST 落 /api/adaptive-params 都冇 check response.ok,
 * 結果即使 server 返 4xx/5xx 都當成功 (silent fail)。
 * 0 forward return validate samples 就係咁嚟嘅 — fetch 200 但 server 早 reject,
 * client 唔知, 以為儲咗落 cache, 但其實乜都冇。
 *
 * 將來所有 POST 落 backend 都應該用呢個 wrapper。
 * Throw 嘅 Error.message 包 status + body (前 200 chars), 方便 debug。
 */
async function postJSON(url, body) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`POST ${url} failed: HTTP ${resp.status} ${text.slice(0, 200)}`);
  }
  return resp.json();
}

function avgClose(klines, endIdx, period) {
  const startIdx = Math.max(0, endIdx - period + 1);
  const slice = klines.slice(startIdx, endIdx + 1);
  const sum = slice.reduce((acc, k) => acc + k.close, 0);
  return sum / slice.length;
}

// 大少 2026-08-15 — zmen 均算法 v1.0 — Layer 2: 9 個 sub-scenario labels 字典 (凡人話, 跟 M1 v2.1.0 對齊)
// 用 zmen 自己 3 條 MA (MA5/MA10/MA60) 嘅數據 enrich, 唔覆蓋 Layer 1 嘅 4 個 state
const ZMEN_SUB_SCENARIO_LABELS = {
  strong_uptrend: '強上升趨勢',
  weak_uptrend: '弱上升趨勢',
  sideways: '橫行',
  weak_downtrend: '弱下跌趨勢',
  strong_downtrend: '強下跌趨勢',
  uptrend_correction: '上升回調中',
  downtrend_bounce: '下跌反彈中',
  decelerating_up: '到頂轉勢中',
  decelerating_down: '到底轉勢中',
};

const ZMEN_POSITION_LABELS = {
  mid_stage: '趨勢中期 (主升 / 主跌段)',
  tentative_rise: '剛起勢 (剛開始升)',
  tentative_fall: '剛起勢 (剛開始跌)',
  range_bound: '橫行整理中',
  correction_at_ma20: '回調中 (短期均線急跌但長期仲升)',
  bounce_in_progress: '反彈中 (短期均線急升但長期仲跌)',
  late_stage_topping: '到頂轉勢中 (見頂跡象)',
  late_stage_bottoming: '到底轉勢中 (見底跡象)',
};

// 大少 2026-08-15 — Zmen v1.0 Layer 2: 9 個 sub-scenario 規則, 用 zmen 自己 MA 數據 derive
// 凡人話: 保留 Layer 1 嘅 4 個 state, 加 Layer 2 拎 sub-scenario 細分 (9 個, 跟 M1 v2.1.0 對齊)
// 5 個判定優先級 (跟 M1 Priority 1-5):
//   Priority 1: 到頂/到底轉勢 (短期 MA 急變 + 長期 MA 同方向 + 連續 4+ 日)
//   Priority 2: 強升/強跌 (全部 MA 同方向 + 量能配合)
//   Priority 3: 弱升/弱跌 (排列對但部分唔配合)
//   Priority 4: 上升回調/下跌反彈 (短長期分裂)
//   Default: 橫行
function deriveZmenSubScenario(ma5History, ma10History, ma60History, klines) {
  if (ma5History.length < 5 || klines.length < 5) {
    return { subScenario: 'sideways', cyclePosition: 'range_bound', consecutiveDays: 0 };
  }

  // 計連續升 / 跌日數 (用 close 唔係 MA, 同 M1 一致)
  let consecutiveDownDays = 0;
  for (let i = klines.length - 1; i > 0; i--) {
    if (klines[i].close < klines[i - 1].close) consecutiveDownDays++;
    else break;
  }
  let consecutiveUpDays = 0;
  for (let i = klines.length - 1; i > 0; i--) {
    if (klines[i].close > klines[i - 1].close) consecutiveUpDays++;
    else break;
  }

  // 拎 5 日前 vs 而家嘅 MA slope (對比 5 日前嘅 MA 值, 同 M1 一致)
  const calcSlopeZmen = (maArr) => {
    if (maArr.length < 6) return 0;
    const cur = maArr[maArr.length - 1];
    const past = maArr[maArr.length - 6];
    return past > 0 ? (cur - past) / past : 0;
  };
  const slopeMA5 = calcSlopeZmen(ma5History);
  const slopeMA10 = calcSlopeZmen(ma10History);
  const slopeMA60 = calcSlopeZmen(ma60History);

  const allShortSlopeNegative = slopeMA5 < 0 && slopeMA10 < 0;
  const allShortSlopePositive = slopeMA5 > 0 && slopeMA10 > 0;
  const longSlopePositive = slopeMA60 > 0;
  const longSlopeNegative = slopeMA60 < 0;

  // 排 MA 短 / 中 / 長期方向
  const allMASameDirection = (() => {
    const signs = [slopeMA5, slopeMA10, slopeMA60].map(s => s >= 0 ? 1 : -1);
    return signs.every(s => s === signs[0]);
  })();

  // 排 MA 短中長期位置 (zmen 用 MA5/10/60, 唔同 M1 用 MA5/10/20/60)
  // zmen 嘅 MA10 當作中期 (M1 嘅 MA20)
  const shortAboveLong = ma5History[ma5History.length - 1] > ma60History[ma60History.length - 1];
  const shortAboveMid = ma5History[ma5History.length - 1] > ma10History[ma10History.length - 1];

  // Priority 1: 到頂轉勢 (zmen 風格 — 短期 MA 急跌 3%+ + 長期 MA 仲升 + 連跌 4+ 日)
  if (slopeMA5 < -0.03 && longSlopePositive && consecutiveDownDays >= 4) {
    return { subScenario: 'decelerating_up', cyclePosition: 'late_stage_topping', consecutiveDays: consecutiveDownDays };
  }
  // Priority 1: 到底轉勢 (zmen 風格 — 短期 MA 急升 3%+ + 長期 MA 仲跌 + 連升 4+ 日)
  if (slopeMA5 > 0.03 && longSlopeNegative && consecutiveUpDays >= 4) {
    return { subScenario: 'decelerating_down', cyclePosition: 'late_stage_bottoming', consecutiveDays: consecutiveUpDays };
  }
  // Priority 2: 強上升 (全部 MA 同方向 + 短期上穿長期)
  if (allMASameDirection && slopeMA5 > 0 && shortAboveLong && shortAboveMid) {
    return { subScenario: 'strong_uptrend', cyclePosition: 'mid_stage', consecutiveDays: 0 };
  }
  // Priority 2: 強下跌 (全部 MA 同方向 + 短期下穿長期)
  if (allMASameDirection && slopeMA5 < 0 && !shortAboveLong && !shortAboveMid) {
    return { subScenario: 'strong_downtrend', cyclePosition: 'mid_stage', consecutiveDays: 0 };
  }
  // Priority 3: 弱上升 (短期上穿長期但部分 MA 唔配合)
  if (shortAboveLong && slopeMA5 > 0) {
    return { subScenario: 'weak_uptrend', cyclePosition: 'tentative_rise', consecutiveDays: 0 };
  }
  // Priority 3: 弱下跌 (短期下穿長期但部分 MA 唔配合)
  if (!shortAboveLong && slopeMA5 < 0) {
    return { subScenario: 'weak_downtrend', cyclePosition: 'tentative_fall', consecutiveDays: 0 };
  }
  // Priority 4: 上升回調 (短期急跌但長期仲升 — 短長期分裂)
  if (allShortSlopeNegative && longSlopePositive) {
    return { subScenario: 'uptrend_correction', cyclePosition: 'correction_at_ma20', consecutiveDays: 0 };
  }
  // Priority 4: 下跌反彈 (短期急升但長期仲跌 — 短長期分裂)
  if (allShortSlopePositive && longSlopeNegative) {
    return { subScenario: 'downtrend_bounce', cyclePosition: 'bounce_in_progress', consecutiveDays: 0 };
  }
  // Default: 橫行
  return { subScenario: 'sideways', cyclePosition: 'range_bound', consecutiveDays: 0 };
}

function deriveState(rules) {
  const ids = new Set(rules.map((r) => r.id));
  if (ids.has('H-reverse-up') || ids.has('H-reverse-down')) return 'TRANSITION';
  if (ids.has('A')) return 'UP';
  if (ids.has('B')) return 'DOWN';
  if (ids.has('F')) return 'UP';   // 仲係上升，但轉弱
  if (ids.has('G')) return 'DOWN'; // 仲係下跌，但轉強
  if (ids.has('C') || ids.has('D')) return 'SIDEWAYS';
  return 'SIDEWAYS';  // default
}

function deriveConfidence(rules) {
  let base = 0.5;
  if (rules.some((r) => r.strength === 'strong')) base = 0.7;
  else if (rules.some((r) => r.strength === 'medium')) base = 0.5;

  let conf = base;
  for (const r of rules) {
    if (r.strength === 'weak') conf += 0.10;
  }
  return Math.min(1.0, Math.round(conf * 10000) / 10000);
}

function round(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// =============================================================
// 大少 2026-08-20 19:50 — Phase 1: ZigZag 拎走 frontend, 改用 backend
// 凡人話: 之前 adapter.mjs 自己用 _zigzagNormalizeDate / calculateZigZag / calcZigZagSlope 計 ZigZag,
// Phase 1 之後 ZigZag 搬去 backend (backend/algorithms/zigzag/algorithm.py, 大少 18:51 畀嘅 ref code 移植),
// testing page 撳跑 M1 嗰陣會 fetch backend /api/algorithms/run?algo=zigzag 拎 verdict,
// 將 verdict.points inject 落 verdict.meta.zigzagPoints (override frontend 拎嘅, frontend 已經冇 fallback)。
// 對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs
// 永久 rule (大少 2026-08-20 19:50): frontend M1 algorithm 唔再自己計 ZigZag, verdict 嘅 ZigZag data 由 caller (testing page / ChartContainer) 注入
// =============================================================


// ===== Render result (HTML string for testing page) =====
//
// 大少 #10846 — 支援兩種 verdict shape:
//   1. Backward-compat MA-only verdict (冇 toggled modules)
//      → 原本 v0.3.0 嘅 UI (single verdict card)
//   2. Synthesized verdict (有 toggled modules)
//      → 顯示 synthesized final + 每個 module 嘅 individual verdict card

export function renderResult(verdict) {
  // Synthesized path: meta.synthesized === true + meta.moduleVerdicts array
  if (verdict.meta?.synthesized && Array.isArray(verdict.meta.moduleVerdicts)) {
    return renderSynthesizedResult(verdict);
  }

  // Backward-compat MA-only path (v0.3.0)
  return renderMAResult(verdict);
}

function renderSynthesizedResult(verdict) {
  const stateColors = {
    UP: '#52c41a',
    DOWN: '#ff4d4f',
    SIDEWAYS: '#faad14',
    TRANSITION: '#722ed1',
  };
  const stateLabels = {
    UP: '上升',
    DOWN: '下跌',
    SIDEWAYS: '橫行',
    TRANSITION: '轉折',
  };

  const color = stateColors[verdict.state] || '#666';
  const stateLabel = stateLabels[verdict.state] || verdict.state;
  const confidencePct = (verdict.confidence * 100).toFixed(1);
  const moduleVerdicts = verdict.meta.moduleVerdicts;

  // Render 每個 module 嘅 individual verdict card
  const moduleCards = moduleVerdicts.map((mv) => {
    if (mv.moduleId === 'ma-alignment') return renderMAResult(mv);
    if (mv.moduleId === 'volume') return renderVolumeResult(mv);
    if (mv.moduleId === 'multi-tf') return renderMultiTFResult(mv);
    if (mv.moduleId === 'slope-momentum') return renderSlopeMomentumResult(mv);
    // 大少 2026-08-07 23:15 — SlopeMomentum render 暫時隱藏 (Stage 1 done 最後先做返)
    return `<pre>${JSON.stringify(mv, null, 2)}</pre>`;
  }).join('');

  // Enabled modules list
  const enabledBadges = moduleVerdicts.map((mv) => {
    const name = mv.moduleId === 'ma-alignment' ? 'MA Alignment'
      : mv.moduleId === 'volume' ? '量價分析 (VolumePrice)'
      : mv.moduleId === 'multi-tf' ? '多時間框架 (M5 Multi-TF)'
      : mv.moduleId === 'slope-momentum' ? '斜率動能 (M8 SlopeMomentum)'
      // 大少 2026-08-07 23:15 — SlopeMomentum badge 暫時隱藏
      : mv.moduleId;
    return `<span class="module-badge">${name}</span>`;
  }).join('');

  // Breakdown table
  const breakdownRows = Object.entries(verdict.meta.breakdown || {})
    .map(([k, v]) => `<div class="summary-row"><span>${k}</span> <strong>${(v * 100).toFixed(1)}%</strong></div>`)
    .join('');

  // Synthesized summary panel (大少 #10871 — plain language 點樣用)
  // 大少 2026-08-15 — M7 優化 Level 1+5+6: M1 拎 cycleLabel/cyclePositionLabel/consecutiveDays,
  //   其他 module 拎自己 detail, 唔再 generic
  const synthSummaryPanel = `
    <div class="interpretation-panel synthesized-summary">
      <strong>🎯 綜合判定：${stateLabel}（${verdict.state}）</strong>
      <p style="margin: 6px 0;">${getSynthesizedStateInterpretation(verdict.state)}</p>
      <div class="module-summary-list">
        ${moduleVerdicts.map((mv) => {
          const modName = mv.moduleId === 'ma-alignment' ? 'MA Alignment (M1)'
            : mv.moduleId === 'volume' ? '量价分析 (VolumePrice, M5)'
            : mv.moduleId === 'multi-tf' ? '多時間框架 (M5 Multi-TF)'
            : mv.moduleId === 'slope-momentum' ? '斜率動能 (M8 SlopeMomentum)'
            : mv.moduleId;
          const modState = stateLabels[mv.state] || mv.state;
          const modConf = (mv.confidence * 100).toFixed(1);
          // Level 1+5+6: M1 拎 cycleLabel/cyclePositionLabel/consecutiveDays
          let modDetail;
          if (mv.moduleId === 'ma-alignment') {
            const m = mv.meta || {};
            const cycleLabel = m.cycleLabel || mv.state;
            const cyclePositionLabel = m.cyclePositionLabel || '';
            const consecutiveDays = m.consecutiveDays || 0;
            const hasConsecutive = (m.cycle === 'decelerating_up' || m.cycle === 'decelerating_down') && consecutiveDays > 0;
            // 凡人話 sub-scenario + cyclePosition 描述
            const scenarioDesc = cyclePositionLabel ? `${cycleLabel} (${cyclePositionLabel})` : cycleLabel;
            const daysDesc = hasConsecutive ? `, 連${m.cycle === 'decelerating_up' ? '跌' : '升'} ${consecutiveDays} 日` : '';
            modDetail = `${scenarioDesc}${daysDesc}`;
          } else if (mv.moduleId === 'volume') {
            modDetail = `信號: ${mv.meta?.signal || 'N/A'}`;
          } else if (mv.moduleId === 'multi-tf') {
            modDetail = `consensus: ${mv.consensus?.direction || 'N/A'} (${mv.state})`;
          } else if (mv.moduleId === 'slope-momentum') {
            modDetail = `rules: ${mv.meta?.matchedRules?.join(', ') || 'N/A'}`;
          } else {
            modDetail = `state: ${mv.state}`;
          }
          return `<div class="module-summary-item"><strong>${modName}</strong>: ${modState} (${modConf}%) — ${modDetail}</div>`;
        }).join('')}
      </div>
    </div>
  `;

  return `
    <div class="as03-verdict as03-synthesized">
      <div class="verdict-header synthesized-header">
        <div class="state-pill" style="background: ${color}">
          <span class="state-label">${stateLabel}</span>
          <span class="state-code">${verdict.state}</span>
        </div>
        <div class="confidence">
          <div class="conf-pct">${confidencePct}%</div>
          <div class="conf-label">綜合信心指數</div>
        </div>
        <div class="data-summary">
          <div class="summary-row"><span>時間週期:</span> <strong>${verdict.timeframe}</strong></div>
          <div class="summary-row"><span>數據日數:</span> <strong>${verdict.meta.dataDays}</strong></div>
          <div class="summary-row"><span>Strategy:</span> <strong>${verdict.meta.synthesizerStrategy}</strong></div>
          <div class="summary-row"><span>Enabled Modules:</span> <strong>${moduleVerdicts.length}</strong></div>
        </div>
      </div>

      <div class="enabled-modules-bar">
        <strong>📦 Enabled Modules:</strong> ${enabledBadges}
      </div>

      <div class="interpretation">
        <strong>🎯 綜合解讀：</strong>${verdict.interpretation}
      </div>

      ${synthSummaryPanel}

      <details class="meta-details">
        <summary>🔬 Synthesizer Reason (${verdict.meta.synthesizerStrategy})</summary>
        <p>${verdict.meta.synthesizerReason}</p>
      </details>

      <details class="meta-details">
        <summary>📊 Breakdown (per-module state + confidence)</summary>
        <div class="data-summary">${breakdownRows}</div>
      </details>

      <h3 style="margin-top: 16px; color: #555; font-size: 14px;">📋 Individual Module Verdicts</h3>
      ${moduleCards}
    </div>
  `;
}

function renderMAResult(verdict) {
  // ===== ZMEN v1.0 — 凡人話 popup + 9 個 sub-scenario 顏色 + 14 個 field enrich (大少 2026-08-15) =====
  // 跟 M1 v2.1.0 同樣 inline style, 但用 .zmen-verdict-tooltip (testing page 入面 zmen 同 M1 唔同 module)
  // 全凡人話, 0 英文 technical term, 0 casual 詞 (學校/老師/校長)
  const ZMEN_V21_TOOLTIPS = {
    zmen_title: 'Zmen 均算法 v1.0 — 保留 Layer 1 (10 條 rule A-J) + 加 Layer 2 (9 個 sub-scenario enrich), 凡人話對齊 M1 v2.1.0, 大少可以同 M1 view 對比',

    // 9 個 sub-scenario 凡人話解釋
    zmen_strong_uptrend: '強上升: Zmen 10 條 rule 中觸發強升 rule (A 連續 5 日 MA5 > MA60 等), 配合 Layer 2 全部 MA 同方向, 典型多頭排列確認',
    zmen_weak_uptrend: '弱上升: Zmen 觸發部分升 rule (F 升勢調整等), Layer 2 短中期 MA 同方向但長期仲未確認, 信心打折',
    zmen_sideways: '橫行: Zmen 觸發 C/D rule (橫行向下 / 向上), Layer 2 MA 排列亂, 短中期 MA 交叉, 冇明確方向',
    zmen_weak_downtrend: '弱下跌: Zmen 觸發部分跌 rule (G 跌勢調整等), Layer 2 短中期 MA 同方向但長期仲未確認, 信心打折',
    zmen_strong_downtrend: '強下跌: Zmen 觸發強跌 rule (B 連續 5 日 MA5 < MA60 等), 配合 Layer 2 全部 MA 同方向, 典型空頭排列確認',
    zmen_uptrend_correction: '上升回調: Zmen 觸發 F rule (升勢調整向下) + Layer 2 短期 MA 急跌但長期仲升, 屬於上升趨勢中嘅正常回調',
    zmen_downtrend_bounce: '下跌反彈: Zmen 觸發 G rule (跌勢調整向上) + Layer 2 短期 MA 急升但長期仲跌, 屬於下跌趨勢中嘅短暫反彈',
    zmen_decelerating_up: '到頂轉勢: Zmen 觸發 H-reverse-down rule (升勢轉跌勢) + Layer 2 短期 MA 急跌 3%+ + 連跌 4+ 日, 見頂跡象明顯',
    zmen_decelerating_down: '到底轉勢: Zmen 觸發 H-reverse-up rule (跌勢轉升勢) + Layer 2 短期 MA 急升 3%+ + 連升 4+ 日, 見底跡象明顯',

    // 8 個 cyclePosition 凡人話解釋
    zmen_mid_stage: '趨勢中期: 強趨勢 (強升 / 強跌) 嘅中段, 動能最猛, 通常持續 1-3 個月',
    zmen_tentative_rise: '剛起勢: 弱上升嘅起步, 信號未完全確認, 觀察多幾日',
    zmen_tentative_fall: '剛起勢: 弱下跌嘅起步, 信號未完全確認, 觀察多幾日',
    zmen_range_bound: '橫行整理: 4 條 MA 糾纏, 等突破方向',
    zmen_correction_at_ma20: '回調中: 上升趨勢中嘅正常調整, 短期均線急跌但長期仲升',
    zmen_bounce_in_progress: '反彈進行中: 下跌趨勢中嘅短暫回升, 留意長期均線仲跌緊',
    zmen_late_stage_topping: '到頂轉勢中: 上升趨勢見頂跡象 (短期急跌 + 長期仲升), 連續 4+ 日連跌',
    zmen_late_stage_bottoming: '到底轉勢中: 下跌趨勢見底跡象 (短期急升 + 長期仲跌), 連續 4+ 日連升',

    // 14 個 output field 凡人話解釋
    zmen_cycle: 'Zmen Layer 2 sub-scenario (9 個之一), 跟 M1 v2.1.0 對齊, 大少可以同 M1 拎同一 sub-scenario 對比 cycle 風格 vs spec 風格',
    zmen_cycle_position: '周期位置: 細分 9 個 sub-scenario 喺周期嘅邊個階段 (中期 / 剛起勢 / 橫行整理 / 回調中 / 反彈中 / 見頂 / 見底)',
    zmen_consecutive_days: '連續日數: 最近連續升 / 跌嘅日數, 到頂轉勢 / 到底轉勢嘅判定基礎 (≥ 4 日先 trigger)',
    zmen_confidence: '信心指數: Zmen Layer 1 + Layer 2 綜合 (10 條 rule 強弱 + Layer 2 細分), 範圍 0-100%, ≥70% 高信心 / 40-70% 中等 / <40% 低信心',
    zmen_base_confidence: '基礎信心: 純粹睇 10 條 rule 強弱嘅基礎信心, 之後會被 Layer 2 sub-scenario 細分調整',
    zmen_ma_values: '3 條 MA 嘅最新值: MA5 (5 日) / MA10 (10 日) / MA60 (60 日), Zmen 用 3 條唔係 4 條 (M1 加 MA20)',
    zmen_ma_ranks: '均線由大到小排序: 例如 MA5 > MA10 > MA60 代表典型多頭 (短期均線喺長期均線上面), 排列越齊信心越高',
    zmen_ma_slopes: '各均線斜率: 對比 5 日前嘅均線值計出嘅百分比變化。正數 = 升緊, 負數 = 跌緊',
    zmen_momentum_score: '加權動能分數: 將各均線斜率按 1/period 加權平均, 短期 MA 權重高',
    zmen_volume_trend: '近期均量 / 前期均量: Zmen 暫時 neutral (zmen algorithm 主要睇 MA 唔睇 volume)',
    zmen_volume_signal: '成交量訊號: Zmen 暫時持平 (Zmen 10 條 rule 集中睇 MA 唔睇 volume 量能)',
    zmen_max_spread: '均線間最大價差百分比: 3 條 MA 之間嘅最大距離除以最低值, > 2% 視為有方向',
    zmen_adjustment_log: 'Layer 2 調整記錄: sub-scenario 細分依據 (e.g. 短期 MA 急跌 + 連跌 4 日 → 到頂轉勢跡象)',
  };

  // Inline <style> block 喺 return 嘅 <div> 開頭, 跟 M1 v2.1.0 同樣 .verdict-tooltip pattern
  const ZMEN_V21_TOOLTIP_STYLE = `<style>
    .zmen-verdict-tooltip { position: relative; cursor: help; border-bottom: 1px dotted #999; }
    .zmen-verdict-tooltip:hover::after {
      content: attr(data-help);
      position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
      background: #2c3e50; color: #fff; padding: 8px 12px; border-radius: 6px;
      white-space: normal; width: max-content; max-width: 380px; min-width: 200px;
      font-size: 12px; line-height: 1.5; z-index: 1000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: fadeIn 0.1s ease-in;
    }
    .zmen-verdict-tooltip:hover::before {
      content: ''; position: absolute; bottom: 95%; left: 50%; transform: translateX(-50%);
      border: 6px solid transparent; border-top-color: #2c3e50;
    }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  </style>`;

  // 9 個 sub-scenario 對應顏色 (跟 M1 v2.1.0 同樣)
  const ZMEN_SCENARIO_COLOR_MAP = {
    strong_uptrend: '#1FA960',     // 深綠
    weak_uptrend: '#7DD89F',        // 淺綠
    uptrend_correction: '#A8D5BA',  // 淡綠
    sideways: '#faad14',            // 黃 (zmen 保留 4 個 state 顏色)
    downtrend_bounce: '#F5B7B1',    // 淡紅
    weak_downtrend: '#F1948A',      // 淺紅
    strong_downtrend: '#C0392B',    // 深紅
    decelerating_up: '#8E44AD',     // 紫
    decelerating_down: '#2980B9',   // 藍
  };

  const stateColors = {
    UP: '#52c41a',
    DOWN: '#ff4d4f',
    SIDEWAYS: '#faad14',
    TRANSITION: '#722ed1',
  };
  const stateLabels = {
    UP: '上升',
    DOWN: '下跌',
    SIDEWAYS: '橫行',
    TRANSITION: '轉折',
  };

  // 大少 2026-08-15 — Zmen v1.0 — Layer 1 保留 + Layer 2 凡人話 enrich
  // Cycle pill: 用 Layer 2 sub-scenario 顏色 (9 個), fallback Layer 1 4 個 state 顏色
  const layer2Cycle = verdict.meta?.cycle;
  const layer2CyclePosition = verdict.meta?.cyclePosition;
  const layer2ConsecutiveDays = verdict.meta?.consecutiveDays || 0;
  const layer2CycleLabel = verdict.meta?.cycleLabel || '';
  const layer2CyclePositionLabel = verdict.meta?.cyclePositionLabel || '';
  const scenarioTooltipKey = `zmen_${layer2Cycle || 'sideways'}`;
  const positionTooltipKey = `zmen_${layer2CyclePosition || 'range_bound'}`;
  const hasConsecutiveDays = (layer2Cycle === 'decelerating_up' || layer2Cycle === 'decelerating_down') && layer2ConsecutiveDays > 0;

  // 顏色優先 Layer 2 sub-scenario, fallback Layer 1 4 個 state
  const cycleColor = ZMEN_SCENARIO_COLOR_MAP[layer2Cycle] || stateColors[verdict.state] || '#666';
  const stateLabel = stateLabels[verdict.state] || verdict.state;
  const confidencePct = (verdict.confidence * 100).toFixed(1);
  const confidenceExplain = verdict.confidence >= 0.7 ? '高信心, 信號強' : verdict.confidence >= 0.4 ? '中等信心, 信號一般' : '低信心, 信號弱';

  const matchedRules = verdict.meta?.matchedRules || [];
  const evidence = verdict.evidence || [];

  const matchedRulesHtml = matchedRules.length === 0
    ? '<li style="color: #888;">無 rule match</li>'
    : matchedRules.map((rid) => {
        const ev = evidence.find((e) => e.value === rid);
        const strengthClass = rid.startsWith('H') ? 'strong'
          : ['A', 'B'].includes(rid) ? 'strong'
          : ['I', 'J'].includes(rid) ? 'weak'
          : 'medium';
        return `<li class="rule-${strengthClass}"><strong>${rid}</strong> — ${ev ? ev.label : ''} <small>(${strengthClass})</small></li>`;
      }).join('');

  // 📌 凡人話 9 個 sub-scenario 解讀 (大少 2026-08-15 Zmen v1.0)
  // Layer 1 (Zmen 4 個 state) + Layer 2 (9 個 sub-scenario) 兩個 layer 各自解讀, 大少可以睇到 cycle 風格 vs spec 風格 嘅分別
  const ZMEN_SCENARIO_INTERPRETATION = {
    strong_uptrend: {
      summary: `Zmen Layer 1 觸發強升 rule (A 連續 5 日 MA5 > MA60), 配合 Layer 2 全部 MA 同方向, 典型多頭排列確認。10 條 rule 中觸發咗 ${matchedRules.length} 條上升相關 rule, 上升趨勢確認。`,
      detail: `MA5 喺 ${verdict.meta.latestMA5}, MA10 喺 ${verdict.meta.latestMA10}, MA60 喺 ${verdict.meta.latestMA60}, 短期均線喺長期均線上面, 上升趨勢穩固。Layer 2 9 個 sub-scenario 中, 強上升代表趨勢中期 (mid_stage), 動能最強。`,
      advice: '可考慮持有 / 逢回調加倉, 留意 H rule (7 日反轉) 同 F rule (升勢調整) 嘅見頂警號。',
    },
    weak_uptrend: {
      summary: `Zmen Layer 1 觸發部分升 rule (F 升勢調整向下), Layer 2 短中期 MA 同方向但長期仲未確認, 信心打折。10 條 rule 觸發 ${matchedRules.length} 條。`,
      detail: '排列對但部分斜率 / 量能唔配合, 剛起勢升 (tentative_rise), 上升動能偏弱。',
      advice: '觀察多幾日, 等放量確認再入場。留意 MA5 斜率轉負 = 升勢見頂。',
    },
    uptrend_correction: {
      summary: 'Zmen Layer 1 觸發 F rule (升勢調整向下), 配合 Layer 2 短期 MA 急跌但長期仲升, 屬於上升趨勢中嘅正常回調。',
      detail: '短期 MA 急跌但長期仲升, 回調到 20 日均線附近, 仍保持上升趨勢結構。',
      advice: '如已持有可續持, 等 MA5 跌到 MA20 附近見支持再考慮加倉。留意 M2 HL Structure 確認有冇破壞 HH / HL 結構。',
    },
    sideways: {
      summary: `Zmen Layer 1 只觸發 C/D/G 等橫行 rule, Layer 2 MA 排列亂, 短中期 MA 交叉, 冇明確方向。10 條 rule 觸發 ${matchedRules.length} 條。`,
      detail: `MA5 ${verdict.meta.latestMA5}, MA10 ${verdict.meta.latestMA10}, MA60 ${verdict.meta.latestMA60}, 均線交叉或距離近, 結構混亂, 橫行整理中 (range_bound)。`,
      advice: '等待突破方向, 唔好喺橫行期間強行入市。配合 M6 Volatility Squeeze 訊號可以捕捉突破時機。',
    },
    downtrend_bounce: {
      summary: 'Zmen Layer 1 觸發 G rule (跌勢調整向上), 配合 Layer 2 短期 MA 急升但長期仲跌, 屬於下跌趨勢中嘅短暫反彈。',
      detail: '短期 MA 急升但長期仲跌, 反彈進行中 (bounce_in_progress), 大方向未改變。',
      advice: '如已持貨可考慮喺反彈高位減倉, 確認 M2 HL Structure 有冇破壞 LL / LH 結構, 等長期均線斜率轉正先信。',
    },
    weak_downtrend: {
      summary: `Zmen Layer 1 觸發部分跌 rule (G 跌勢調整向上), Layer 2 短中期 MA 同方向但長期仲未確認, 信心打折。10 條 rule 觸發 ${matchedRules.length} 條。`,
      detail: '排列對但部分斜率 / 量能唔配合, 剛起勢跌 (tentative_fall), 下跌動能偏弱。',
      advice: '觀察多幾日, 等放量確認再行動, 唔好急住撈底。留意 MA5 斜率轉正 = 跌勢見底。',
    },
    strong_downtrend: {
      summary: `Zmen Layer 1 觸發強跌 rule (B 連續 5 日 MA5 < MA60), 配合 Layer 2 全部 MA 同方向, 典型空頭排列確認。10 條 rule 觸發 ${matchedRules.length} 條。`,
      detail: `MA5 喺 ${verdict.meta.latestMA5}, MA10 喺 ${verdict.meta.latestMA10}, MA60 喺 ${verdict.meta.latestMA60}, 短期均線喺長期均線下面, 下跌趨勢穩固。Layer 2 9 個 sub-scenario 中, 強下跌代表趨勢中期 (mid_stage), 動能最強。`,
      advice: '觀望 / 減倉, 等長期均線斜率轉正先考慮撈底, 唔好接刀。留意有冇縮量 (下跌動能減弱) 或長期斜率轉正 (可能見底) 嘅反彈訊號。',
    },
    decelerating_up: {
      summary: `Zmen Layer 1 觸發 H-reverse-down rule (升勢轉跌勢), 配合 Layer 2 短期 MA 急跌 3%+ + 連跌 ${layer2ConsecutiveDays} 日, 見頂跡象明顯。10 條 rule 觸發 ${matchedRules.length} 條。`,
      detail: `短期 MA 急跌 ${((verdict.meta.maSlopes?.MA5 || 0) * 100).toFixed(2)}% + 長期 MA 仲升 + 連跌 ${layer2ConsecutiveDays} 日, 到頂轉勢中 (late_stage_topping), 上升趨勢可能見頂。`,
      advice: '如已持貨應考慮喺反彈時減倉 / 止賺, 唔好博佢返上去。確認 M2 HL Structure (LH = 見頂確認) + M4 Indicators RSI 背馳。',
    },
    decelerating_down: {
      summary: `Zmen Layer 1 觸發 H-reverse-up rule (跌勢轉升勢), 配合 Layer 2 短期 MA 急升 3%+ + 連升 ${layer2ConsecutiveDays} 日, 見底跡象明顯。10 條 rule 觸發 ${matchedRules.length} 條。`,
      detail: `短期 MA 急升 ${((verdict.meta.maSlopes?.MA5 || 0) * 100).toFixed(2)}% + 長期 MA 仲跌 + 連升 ${layer2ConsecutiveDays} 日, 到底轉勢中 (late_stage_bottoming), 下跌趨勢可能見底。`,
      advice: '如想撈底要等確認: M2 HL Structure 出現 HH (見底確認) + M4 Indicators RSI 唔再背馳。先小注試單, 唔好一次過 all-in。',
    },
  };

  // 向後兼容舊 cycle (uptrend / downtrend), map 返去新 sub-scenario
  let cycleForLookup = layer2Cycle;
  if (cycleForLookup === 'uptrend') cycleForLookup = 'strong_uptrend';
  if (cycleForLookup === 'downtrend') cycleForLookup = 'strong_downtrend';

  const interp = ZMEN_SCENARIO_INTERPRETATION[cycleForLookup] || ZMEN_SCENARIO_INTERPRETATION.sideways;
  const interpretationDetail = `
    <p>📌 <strong>簡單講</strong>: <span class="zmen-verdict-tooltip" data-help="${ZMEN_V21_TOOLTIPS[scenarioTooltipKey] || ''}">${interp.summary}</span></p>
    <p>📊 <strong>咩意思</strong>: ${interp.detail}</p>
    <p>💡 <strong>點睇呢個結果</strong>: ${interp.advice}</p>
  `;

  return `
    <div class="as03-verdict as03-module-card">
      ${ZMEN_V21_TOOLTIP_STYLE}
      <div class="module-card-header">
        <h4 class="module-header"><span class="zmen-verdict-tooltip" data-help="${ZMEN_V21_TOOLTIPS.zmen_title}">📐 zmen均算法 v1.0 (保留 Layer 1 + 加 Layer 2, 9 個 sub-scenario + 14 個 field)</span></h4>
      </div>
      <div class="verdict-header">
        <div class="state-pill" style="background: ${cycleColor}">
          <span class="state-label"><span class="zmen-verdict-tooltip" data-help="${ZMEN_V21_TOOLTIPS[scenarioTooltipKey] || ZMEN_V21_TOOLTIPS.zmen_sideways}">${layer2CycleLabel || stateLabel}</span></span>
          <span class="state-code">${(layer2Cycle || verdict.state || '').toUpperCase()}</span>
        </div>
        <div class="confidence">
          <div class="conf-pct"><span class="zmen-verdict-tooltip" data-help="${ZMEN_V21_TOOLTIPS.zmen_confidence}">${confidencePct}%</span></div>
          <div class="conf-label">信心指數 — ${confidenceExplain}</div>
        </div>
        <div class="data-summary">
          <div class="summary-row"><span>週期位置:</span> <strong><span class="zmen-verdict-tooltip" data-help="${ZMEN_V21_TOOLTIPS[positionTooltipKey] || ZMEN_V21_TOOLTIPS.zmen_range_bound}">${layer2CyclePositionLabel || '—'}</span></strong></div>
          ${hasConsecutiveDays ? `<div class="summary-row"><span>連續日數:</span> <strong><span class="zmen-verdict-tooltip" data-help="${ZMEN_V21_TOOLTIPS.zmen_consecutive_days}">${layer2ConsecutiveDays} 日</span></strong></div>` : ''}
          <div class="summary-row"><span>時間週期:</span> <strong>${verdict.timeframe}</strong></div>
          <div class="summary-row"><span>數據日數:</span> <strong><span class="zmen-verdict-tooltip" data-help="${ZMEN_V21_TOOLTIPS.zmen_base_confidence}">${verdict.meta.dataDays}</span></strong></div>
          <div class="summary-row"><span>Matched Rules:</span> <strong>${matchedRules.length}</strong></div>
        </div>
      </div>

      <div class="interpretation">
        <strong>📌 判斷:</strong>${verdict.interpretation}
        ${interpretationDetail}
      </div>

      <div class="ma-values">
        <h4>當前 MA 值</h4>
        <div class="ma-grid">
          <div class="ma-item"><span class="ma-label">MA5</span><span class="ma-value">${verdict.meta.latestMA5}</span></div>
          <div class="ma-item"><span class="ma-label">MA10</span><span class="ma-value">${verdict.meta.latestMA10}</span></div>
          <div class="ma-item"><span class="ma-label">MA60</span><span class="ma-value">${verdict.meta.latestMA60}</span></div>
        </div>
      </div>

      <div class="matched-rules">
        <h4>🎯 Matched Rules（${matchedRules.length} 條）</h4>
        <ul>${matchedRulesHtml}</ul>
      </div>

      ${renderDetailedExplanationMA(verdict)}
      ${renderStrategyAdviceMA(verdict)}
      ${renderUsageGuideMA(verdict)}

      <details class="meta-details">
        <summary>🔧 配置（debug 用）</summary>
        <pre>${JSON.stringify(verdict.meta.configUsed, null, 2)}</pre>
      </details>
    </div>
  `;
}

// ===== Help text =====
// ===== 詳細解讀 section (MA alignment) =====
function renderDetailedExplanationMA(verdict) {
  const confidencePct = (verdict.confidence * 100).toFixed(0);
  const matchedRules = verdict.meta?.matchedRules || [];
  const evidence = verdict.evidence || [];

  // Rule 解釋表 (大少 設計 10 條 rule)
  const ruleExplain = {
    'A': '連續 5 日 MA5 > MA60 — 強烈上升訊號',
    'B': '連續 5 日 MA5 < MA60 — 強烈下跌訊號',
    'C': '5 日裡 MA5 > MA60 但當日 low < MA60 — 橫行向下',
    'D': '5 日裡 MA5 < MA60 但當日 high > MA60 — 橫行向上',
    'F': 'MA5+MA10 都 > MA60 但 MA5 < MA10 — 升勢調整 (小心見頂)',
    'G': 'MA5+MA10 都 < MA60 但 MA5 > MA10 — 跌勢調整 (可能見底)',
    'H-reverse-up': '7 日內由下跌轉上升 — 強烈轉勢信號',
    'H-reverse-down': '7 日內由上升轉下跌 — 強烈轉勢信號',
    'I': '連續 5 日 low ≥ MA5 × 0.98 — 有機會長升',
    'J': '連續 5 日 high ≤ MA5 × 1.02 — 有機會長跌',
  };

  return `
    <div class="detailed-explanation">
      <h4>📖 詳細解讀 (Zmen v1.0 — Layer 1 10 條 rule + Layer 2 9 個 sub-scenario + 14 個 field)</h4>
      <p>呢個 module 用 <strong>Layer 1 (10 條 rule A-J)</strong> 判定 4 個週期 state (UP/DOWN/SIDEWAYS/TRANSITION), 再用 <strong>Layer 2 (5 個判定優先級)</strong> 拎 9 個 sub-scenario enrich, 跟 M1 v2.1.0 對齊。</p>
      <table class="explain-table">
        <tr><td class="field-name">📊 Layer 1 state (4 個週期)</td><td><strong>${verdict.state}</strong> — ${verdict.state === 'UP' ? '上升勢 (A/F rule 主導)' : verdict.state === 'DOWN' ? '下跌勢 (B/G rule 主導)' : verdict.state === 'SIDEWAYS' ? '橫行 (C/D rule 主導)' : '轉折 (H rule 觸發 — 7 日內反轉)'}</td></tr>
        <tr><td class="field-name">🎯 Layer 2 sub-scenario (9 個細分)</td><td><strong>${verdict.meta.cycle || '—'}</strong> (${verdict.meta.cycleLabel || '—'}) — 跟 M1 v2.1.0 對齊</td></tr>
        <tr><td class="field-name">📍 Layer 2 cyclePosition (8 個 stage)</td><td><strong>${verdict.meta.cyclePosition || '—'}</strong> (${verdict.meta.cyclePositionLabel || '—'})</td></tr>
        <tr><td class="field-name">🔁 連續日數</td><td>${verdict.meta.consecutiveDays || 0} 日 (到頂/到底轉勢先有)</td></tr>
        <tr><td class="field-name">🎯 confidence (信心指數 ${confidencePct}%)</td><td>${confidencePct >= 70 ? '🟢 高信心 — 判定可靠' : confidencePct >= 50 ? '🟡 中信心 — 有參考價值' : '🔴 低信心 — 信唔過'}</td></tr>
        <tr><td class="field-name">📐 觸發 rule (${matchedRules.length} 條)</td><td>${matchedRules.length === 0 ? '無 rule 觸發,預設 SIDEWAYS' : matchedRules.map(r => `<strong>${r}</strong> — ${ruleExplain[r] || r}`).join(' / ')}</td></tr>
        <tr><td class="field-name">📈 MA5</td><td>${verdict.meta.latestMA5 || 'N/A'} (5 日平均線,短期趨勢)</td></tr>
        <tr><td class="field-name">📈 MA10</td><td>${verdict.meta.latestMA10 || 'N/A'} (10 日平均線,中短期)</td></tr>
        <tr><td class="field-name">📈 MA60</td><td>${verdict.meta.latestMA60 || 'N/A'} (60 日平均線,中長期趨勢)</td></tr>
        <tr><td class="field-name">📈 maSlopes</td><td>${Object.entries(verdict.meta.maSlopes || {}).map(([k, v]) => `${k}=${(v * 100).toFixed(2)}%`).join(', ') || 'N/A'} (各 MA 斜率)</td></tr>
        <tr><td class="field-name">⚡ momentumScore</td><td>${verdict.meta.momentumScore || 'N/A'} (加權動能分數)</td></tr>
        <tr><td class="field-name">📏 maxSpreadPct</td><td>${((verdict.meta.maxSpreadPct || 0) * 100).toFixed(2)}% (均線間最大價差)</td></tr>
        <tr><td class="field-name">📝 adjustmentLog</td><td>${(verdict.meta.adjustmentLog || []).join(' / ') || '(無 Layer 2 調整)'}</td></tr>
        <tr><td class="field-name">📅 數據日數</td><td>${verdict.meta.dataDays} 日</td></tr>
        <tr><td class="field-name">⏰ 時間週期</td><td>${verdict.timeframe}</td></tr>
        <tr><td class="field-name">🔧 連續日數 (config)</td><td>${verdict.meta.configUsed?.consecutiveDays || 5} 日 (A/B/F/G 用)</td></tr>
        <tr><td class="field-name">🔧 反轉窗口</td><td>${verdict.meta.configUsed?.reversalWindowDays || 7} 日 (H rule 用)</td></tr>
        <tr><td class="field-name">🔧 觸發門檻</td><td>${((verdict.meta.configUsed?.chanceThresholdPct || 0.02) * 100).toFixed(1)}% (I/J rule 用)</td></tr>
        <tr><td class="field-name">💪 Rule 強度</td><td>${matchedRules.length > 0 ? (matchedRules.some(r => r.startsWith('H') || ['A','B'].includes(r)) ? '強 (A/B/H)' : matchedRules.some(r => ['I','J'].includes(r)) ? '弱 (I/J)' : '中 (C/D/F/G)') : '無'}</td></tr>
      </table>
      <h4 style="margin-top:12px;">9 個 sub-scenario 速查 (Layer 2)</h4>
      <ul>
        <li><strong>強上升</strong> (strong_uptrend) — 強升 rule (A) + 全部 MA 同方向 → mid_stage</li>
        <li><strong>弱上升</strong> (weak_uptrend) — 部分升 rule (F) + 短中期 MA 同方向 → tentative_rise</li>
        <li><strong>上升回調</strong> (uptrend_correction) — F rule + 短期急跌但長期仲升 → correction_at_ma20</li>
        <li><strong>橫行</strong> (sideways) — C/D rule + 排列亂 → range_bound</li>
        <li><strong>下跌反彈</strong> (downtrend_bounce) — G rule + 短期急升但長期仲跌 → bounce_in_progress</li>
        <li><strong>弱下跌</strong> (weak_downtrend) — 部分跌 rule (G) + 短中期 MA 同方向 → tentative_fall</li>
        <li><strong>強下跌</strong> (strong_downtrend) — 強跌 rule (B) + 全部 MA 同方向 → mid_stage</li>
        <li><strong>到頂轉勢</strong> (decelerating_up) — H-reverse-down + 短期急跌 3%+ + 連跌 4+ 日 → late_stage_topping</li>
        <li><strong>到底轉勢</strong> (decelerating_down) — H-reverse-up + 短期急升 3%+ + 連升 4+ 日 → late_stage_bottoming</li>
      </ul>
    </div>
  `;
}

// ===== 策略建議 section (MA alignment) =====
function renderStrategyAdviceMA(verdict) {
  const confidencePct = (verdict.confidence * 100).toFixed(0);
  const isHighConf = verdict.confidence >= 0.7;
  const isLowConf = verdict.confidence < 0.5;
  const matchedRules = verdict.meta?.matchedRules || [];

  // 大少 2026-08-15 — Zmen v1.0 — 凡人話 strategy advice 對應 9 個 sub-scenario (跟 M1 v2.1.0 同樣 style)
  // 唔再用 4 個 state 嘅 fallback advice (因為 9 個 sub-scenario 已經覆蓋)
  const layer2Cycle = verdict.meta?.cycle;
  const layer2ConsecutiveDays = verdict.meta?.consecutiveDays || 0;
  const ZMEN_V10_STRATEGY_ADVICE = {
    strong_uptrend: `<div class="strategy-strong-up"><h4>🟢 強上升 (Layer 1 強升 rule + Layer 2 全部 MA 同方向) · 策略建議</h4><p><strong>基本動作:</strong>順勢持倉, 可考慮持有 / 逢回調加倉</p><p><strong>訊號確認:</strong>A rule (連續 5 日 MA5 > MA60) + Layer 2 全部 MA 同方向, 典型多頭排列確認</p><p><strong>風險管理:</strong>留意 H-reverse-down (7 日內由升轉跌), 呢個係見頂警號</p><p><strong>止損位:</strong>最近 5 日 low 跌穿 MA5 × 0.98 (I rule 失效)</p><p><strong>進場策略:</strong>等回調到 MA5/MA10 附近再反彈, 低吸</p></div>`,
    weak_uptrend: `<div class="strategy-weak-up"><h4>🟡 弱上升 (Layer 1 部分升 rule + Layer 2 短中期 MA 同方向) · 策略建議</h4><p><strong>基本動作:</strong>觀察多幾日, 等放量確認再入場</p><p><strong>訊號確認:</strong>部分升 rule 觸發 (F 升勢調整), 上升動能偏弱</p><p><strong>風險管理:</strong>留意 MA5 斜率轉負 = 升勢見頂警號</p><p><strong>止損位:</strong>MA5 跌穿 MA10 + 連續 2 日 (Layer 2 弱上升失效)</p><p><strong>進場策略:</strong>等放量確認先入場, 唔好強行加倉</p></div>`,
    uptrend_correction: `<div class="strategy-correction"><h4>🟢 上升回調中 (Layer 1 F rule + Layer 2 短期急跌但長期仲升) · 策略建議</h4><p><strong>基本動作:</strong>如已持有可續持, 等 MA5 跌到 MA20 附近見支持再考慮加倉</p><p><strong>訊號確認:</strong>F rule (升勢調整向下) + 短期 MA 急跌但長期仲升, 屬於上升趨勢中嘅正常回調</p><p><strong>風險管理:</strong>確認 M2 HL Structure 有冇破壞 HH / HL 結構, 破壞就唔再係上升回調</p><p><strong>止損位:</strong>MA5 跌穿 MA60 + 連續 3 日 (Layer 2 回調失效)</p><p><strong>進場策略:</strong>等 MA5 跌到 MA20 附近見支持再加倉, 唔好見急跌就沽</p></div>`,
    sideways: `<div class="strategy-sideways"><h4>🟡 橫行 (Layer 1 C/D rule + Layer 2 排列亂) · 策略建議</h4><p><strong>基本動作:</strong>等待突破方向, 唔好喺橫行期間強行入市</p><p><strong>訊號確認:</strong>C/D rule 觸發, Layer 2 MA 排列亂, 短中期 MA 交叉, 冇明確方向</p><p><strong>風險管理:</strong>配合 M6 Volatility Squeeze 訊號可以捕捉突破時機</p><p><strong>進場策略:</strong>等 MA5 突破 MA60 先做 (向上 = 升 / 向下 = 跌)</p><p><strong>觀察重點:</strong>留意 H-reverse rule, 出現就係轉勢先兆</p></div>`,
    downtrend_bounce: `<div class="strategy-bounce"><h4>🔴 下跌反彈中 (Layer 1 G rule + Layer 2 短期急升但長期仲跌) · 策略建議</h4><p><strong>基本動作:</strong>如已持貨可考慮喺反彈高位減倉</p><p><strong>訊號確認:</strong>G rule (跌勢調整向上) + 短期 MA 急升但長期仲跌, 屬於下跌趨勢中嘅短暫反彈</p><p><strong>風險管理:</strong>確認 M2 HL Structure 有冇破壞 LL / LH 結構, 唔好因為短暫反彈就以為見底</p><p><strong>止損位:</strong>MA5 升穿 MA60 + 連續 3 日 (Layer 2 反彈失效)</p><p><strong>進場策略:</strong>等長期均線 (MA60) 斜率轉正先信, 唔好撈底</p></div>`,
    weak_downtrend: `<div class="strategy-weak-down"><h4>🟡 弱下跌 (Layer 1 部分跌 rule + Layer 2 短中期 MA 同方向) · 策略建議</h4><p><strong>基本動作:</strong>觀察多幾日, 等放量確認再行動, 唔好急住撈底</p><p><strong>訊號確認:</strong>部分跌 rule 觸發 (G 跌勢調整), 下跌動能偏弱</p><p><strong>風險管理:</strong>留意 MA5 斜率轉正 = 跌勢見底警號</p><p><strong>止損位:</strong>MA5 升穿 MA10 + 連續 2 日 (Layer 2 弱下跌失效)</p><p><strong>進場策略:</strong>等放量確認先行動, 唔好撈底</p></div>`,
    strong_downtrend: `<div class="strategy-strong-down"><h4>🔴 強下跌 (Layer 1 強跌 rule + Layer 2 全部 MA 同方向) · 策略建議</h4><p><strong>基本動作:</strong>觀望 / 減倉, 等長期均線斜率轉正先考慮撈底, 唔好接刀</p><p><strong>訊號確認:</strong>B rule (連續 5 日 MA5 < MA60) + Layer 2 全部 MA 同方向, 典型空頭排列確認</p><p><strong>風險管理:</strong>留意 H-reverse-up (7 日內由跌轉升), 呢個係見底警號</p><p><strong>止損位:</strong>最近 5 日 high 升穿 MA5 × 1.02 (J rule 失效)</p><p><strong>進場策略:</strong>反彈到 MA5/MA10 附近再回落, 做空</p></div>`,
    decelerating_up: `<div class="strategy-dec-up"><h4>🟣 到頂轉勢中 (Layer 1 H-reverse-down + Layer 2 連跌 ${layer2ConsecutiveDays} 日) · 策略建議</h4><p><strong>基本動作:</strong>如已持貨應考慮喺反彈時減倉 / 止賺, 唔好博佢返上去</p><p><strong>訊號確認:</strong>H-reverse-down rule (升勢轉跌勢) + 短期 MA 急跌 3%+ + 連跌 ${layer2ConsecutiveDays} 日, 見頂跡象明顯</p><p><strong>風險管理:</strong>確認 M2 HL Structure (LH = 見頂確認) + M4 Indicators RSI 背馳</p><p><strong>止損位:</strong>短期 MA5 升穿 MA10 + 連續 2 日 (Layer 2 到頂失效)</p><p><strong>進場策略:</strong>等確認見頂後先做空, 唔好搶跑</p></div>`,
    decelerating_down: `<div class="strategy-dec-down"><h4>🔵 到底轉勢中 (Layer 1 H-reverse-up + Layer 2 連升 ${layer2ConsecutiveDays} 日) · 策略建議</h4><p><strong>基本動作:</strong>如想撈底要等確認: M2 HL Structure 出現 HH (見底確認) + M4 Indicators RSI 唔再背馳</p><p><strong>訊號確認:</strong>H-reverse-up rule (跌勢轉升勢) + 短期 MA 急升 3%+ + 連升 ${layer2ConsecutiveDays} 日, 見底跡象明顯</p><p><strong>風險管理:</strong>先小注試單, 唔好一次過 all-in</p><p><strong>止損位:</strong>短期 MA5 跌穿 MA10 + 連續 2 日 (Layer 2 到底失效)</p><p><strong>進場策略:</strong>等確認見底後先撈底, 唔好搶跑</p></div>`,
  };

  // 向後兼容舊 cycle (uptrend / downtrend), map 返去新 sub-scenario
  let cycleForAdvice = layer2Cycle;
  if (cycleForAdvice === 'uptrend') cycleForAdvice = 'strong_uptrend';
  if (cycleForAdvice === 'downtrend') cycleForAdvice = 'strong_downtrend';

  const stateAdvice = ZMEN_V10_STRATEGY_ADVICE[cycleForAdvice] || ZMEN_V10_STRATEGY_ADVICE.sideways;

  let confidenceNote = '';
  if (isHighConf) {
    confidenceNote = `<p class="confidence-high">💪 信心指數 ${confidencePct}% (高) — 判定可靠,可以作參考落單</p>`;
  } else if (isLowConf) {
    confidenceNote = `<p class="confidence-low">⚠️ 信心指數 ${confidencePct}% (低) — 唔好信,等下一個更明顯訊號</p>`;
  } else {
    confidenceNote = `<p class="confidence-med">🤔 信心指數 ${confidencePct}% (中) — 有參考價值,但要配合其他指標 confirm</p>`;
  }

  return `
    <div class="strategy-advice">
      <h4>🎯 策略建議 (點做)</h4>
      ${stateAdvice}
      ${confidenceNote}
      <p class="caveat">⚠️ 觸發 ${matchedRules.length} 條 rule,每條 rule 嘅具體解釋睇「📖 詳細解讀」section</p>
    </div>
  `;
}

// ===== 點用 + 點睇 guide section (MA alignment) =====
// 大少 2026-08-15 — Zmen v1.0 — 凡人話 12 步 step-by-step guide (跟 M1 v2.1.0 同樣 style)
function renderUsageGuideMA(verdict) {
  return `
    <div class="usage-guide">
      <h4>💡 點用呢個結果 (12 步 step-by-step)</h4>
      <ol>
        <li>睇頂部 <code>state-pill</code> 嘅 9 個 sub-scenario 標籤 + <code>週期位置</code> 知邊個 sub-scenario + 邊個 stage</li>
        <li>睇 <code>信心指數 %</code> 同 <code>高 / 中 / 低信心</code> 標籤 — 信心 ≥ 70% 為高信心, 40-70% 中等, &lt; 40% 低</li>
        <li>對比 <code>confidence</code> (綜合) 同 <code>基礎信心</code> — 差越大, Layer 2 細分調整越多</li>
        <li>睇 <code>📌 判斷</code> box 嘅 <code>reason</code> 知 algorithm 點解咁判 (含 sub-scenario + cyclePosition)</li>
        <li>確認 <code>均線詳細</code> 入面 3 條 MA 嘅值同斜率方向 (↗ 升 / ↘ 跌)</li>
        <li>睇 <code>maSlopes[MA5]</code> 嘅正負 — 短期 MA 斜率係上升動能領先指標</li>
        <li>睇 <code>maSlopes[MA60]</code> 嘅正負 — 長期 MA 斜率係大方向指標</li>
        <li>睇 <code>momentumScore</code> — 加權動能分數, 短期 MA 權重高</li>
        <li>睇 <code>調整記錄</code> 知 Layer 2 做咗咩 sub-scenario 細分 (e.g. 短期急跌 + 連跌 4 日 → 到頂轉勢)</li>
        <li><strong>9 個 sub-scenario 解讀</strong>: 強升 / 弱升 / 上升回調 = UP; 強跌 / 弱跌 / 下跌反彈 = DOWN; 橫行 / 到頂 / 到底 = SIDEWAYS (transition)</li>
        <li>對比 M1 (M1 同 zmen 拎 9 個 sub-scenario 對比, 睇 cycle 風格 vs spec 風格 一致性)</li>
        <li>結合多個 module 結果 (M3 Trendline + M4 Indicators + M5 量价 + M6 波動率) 做最終決策</li>
      </ol>
      <p class="caveat">⚠️ 呢個 module 係輔助工具,唔係 100% 準。永遠配合基本面 / 消息面 / 風險管理一齊用,唔好單靠一個 algorithm 落單。</p>
    </div>
  `;
}

// ===== Chart Overlay (testing page contract) =====
// 喺 chart 上面加 MA5/MA10/MA60 三條 trend line (跟股價走嘅斜線, 唔係水平價線)
// 2026-08-07 — 大少要求 3 條 MA 線 (trend line 形式, 唔係 horizontal price line)
// 2026-08-07 — Bug fix: testing page 嘅 contract 叫 renderChartOverlay, 唔好叫 renderMAChartOverlay,
// 否則 testing page 嘅 `currentAdapter.renderChartOverlay` check 會 false, 永遠唔 invoke
// 2026-08-07 — v2: 由 horizontal priceLine → lineSeries (re-compute MA 歷史), 跟大少示範圖
//
// Helper: normalize kline time 到 lightweight-charts 嘅 seconds epoch
function _maNormalizeTime(t) {
  if (typeof t === 'number') {
    return t > 1e12 ? Math.floor(t / 1000) : t;  // ms → s
  }
  if (typeof t === 'string') {
    return Math.floor(new Date(t).getTime() / 1000);  // ISO → s
  }
  return null;
}

// Helper: 計 MA 歷史 series (同 ma-alignment.ts 嘅 avgClose 一樣)
// period = 5 / 10 / 60
// 頭 period-1 個 point 直接 skip (未夠 data 計 MA, 唔出 null 避免 lightweight-charts 當 0 畫)
function _computeMASeries(klines, period) {
  const out = [];
  for (let i = period - 1; i < klines.length; i++) {
    const time = _maNormalizeTime(klines[i].time ?? klines[i].timestamp ?? klines[i].date);
    if (time == null) continue;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += klines[j].close;
    }
    out.push({ time, value: sum / period });
  }
  // 確保 sorted by time + unique
  out.sort((a, b) => a.time - b.time);
  const dedup = [];
  for (let i = 0; i < out.length; i++) {
    if (i === 0 || out[i].time !== out[i - 1].time) dedup.push(out[i]);
  }
  return dedup;
}

export function renderChartOverlay(verdict, klines, chartRefs) {
  if (!chartRefs || !chartRefs.chart) {
    console.warn('[renderChartOverlay] chartRefs.chart 缺失:', { chartRefs });
    return;
  }
  if (!verdict || !verdict.meta) {
    console.warn('[renderChartOverlay] verdict 缺失');
    return;
  }
  if (!Array.isArray(klines) || klines.length === 0) {
    console.warn('[renderChartOverlay] klines 缺失或空');
    return;
  }

  const ma5Latest = verdict.meta.latestMA5;
  const ma10Latest = verdict.meta.latestMA10;
  const ma60Latest = verdict.meta.latestMA60;

  console.log('[renderChartOverlay] Adding MA trend lines, latest:', {
    ma5: ma5Latest, ma10: ma10Latest, ma60: ma60Latest,
  });

  const chart = chartRefs.chart;
  if (typeof chart.addSeries !== 'function') {
    console.error('[renderChartOverlay] chart 冇 addLineSeries method, lightweight-charts version 可能太舊');
    return;
  }

  // 移除舊 MA line series (如果之前 render 過)
  if (chartRefs.maLineSeries) {
    for (const key of Object.keys(chartRefs.maLineSeries)) {
      try { chart.removeSeries(chartRefs.maLineSeries[key]); } catch (e) { /* ignore */ }
    }
  }
  chartRefs.maLineSeries = {};

  // 計 MA 歷史 series
  const ma5Series = _computeMASeries(klines, 5);
  const ma10Series = _computeMASeries(klines, 10);
  const ma60Series = _computeMASeries(klines, 60);

  console.log('[renderChartOverlay] MA series points:', {
    ma5: ma5Series.length,
    ma10: ma10Series.length,
    ma60: ma60Series.length,
  });

  // MA5 (紅) — 短期趨勢
  try {
    const s = chart.addSeries(LightweightCharts.LineSeries, {
      color: '#FF6B6B',
      lineWidth: 2,
      title: 'MA5',
      priceLineVisible: false,
      lastValueVisible: true,
    });
    s.setData(ma5Series);
    chartRefs.maLineSeries.ma5 = s;
  } catch (e) {
    console.error('[renderChartOverlay] MA5 addLineSeries 失敗:', e);
  }

  // MA10 (青) — 中短期趨勢
  try {
    const s = chart.addSeries(LightweightCharts.LineSeries, {
      color: '#4ECDC4',
      lineWidth: 2,
      title: 'MA10',
      priceLineVisible: false,
      lastValueVisible: true,
    });
    s.setData(ma10Series);
    chartRefs.maLineSeries.ma10 = s;
  } catch (e) {
    console.error('[renderChartOverlay] MA10 addLineSeries 失敗:', e);
  }

  // MA60 (藍) — 中長期趨勢
  try {
    const s = chart.addSeries(LightweightCharts.LineSeries, {
      color: '#45B7D1',
      lineWidth: 2,
      title: 'MA60',
      priceLineVisible: false,
      lastValueVisible: true,
    });
    s.setData(ma60Series);
    chartRefs.maLineSeries.ma60 = s;
  } catch (e) {
    console.error('[renderChartOverlay] MA60 addLineSeries 失敗:', e);
  }
}


export function getHelp() {
  return `
    <h4>10 條規則 (A 到 J)</h4>
    <ul>
      <li><strong>A</strong> (強): 連續 5 日 MA5 喺 MA60 上面 → 上升勢</li>
      <li><strong>B</strong> (強): 連續 5 日 MA5 喺 MA60 下面 → 下跌勢</li>
      <li><strong>C</strong> (中): 5 日裡 MA5 喺 MA60 上面, 但當日低位穿 MA60 → 橫行向下</li>
      <li><strong>D</strong> (中): 5 日裡 MA5 喺 MA60 下面, 但當日高位升穿 MA60 → 橫行向上</li>
      <li><strong>F</strong> (中): MA5 同 MA10 都喺 MA60 上面, 但 MA5 跌穿 MA10 → 升勢調整向下</li>
      <li><strong>G</strong> (中): MA5 同 MA10 都喺 MA60 下面, 但 MA5 升穿 MA10 → 跌勢調整向上</li>
      <li><strong>H 轉上</strong> (強): 7 日內 1/2/3 日新高 (上) 加餘下舊高 (下) → 跌勢轉升勢</li>
      <li><strong>H 轉下</strong> (強): 7 日內 1/2/3 日新低 (下) 加餘下舊低 (上) → 升勢轉跌勢</li>
      <li><strong>I</strong> (弱): 連續 5 日低位 ≥ MA5 × (1 - 2%) → 有機會長升</li>
      <li><strong>J</strong> (弱): 連續 5 日高位 ≤ MA5 × (1 + 2%) → 有機會長跌</li>
    </ul>
    <p><strong>規則優先順序:</strong> H → A → B → F → G → C/D → 默認 橫行</p>
    <p><strong>信心分數:</strong> 強 0.7, 中 0.5, 弱 加 0.10 分, 最高 1.0</p>
  `;
}

// =============================================================================
// 大少 #10809 — Module 5 VolumePrice (v1.0.0) — 跟 ma-alignment pattern 一致 (D018)
// =============================================================================
//
// 10 條 rule K-T（port 自 modules/volume.ts v1.0.0）：
//   Step 1 — 數據驗證（< volumeLookback 報錯）
//   Step 2 — 計算 OBV + 5/20 日均量
//   Step 3 — 10 條 rule check (K-T)
//   Step 4 — State derivation (K/O→UP · M/P→DOWN · L/S→TRANSITION · N/T→SIDEWAYS · Q→SIDEWAYS · R→TRANSITION)
//   Step 5 — Confidence derivation (同 ma-alignment pattern)
//   Step 6 — Signal derivation (D020 — meta.signal = CONFIRM | DISCONFIRM | NEUTRAL)

// ===== analyzeVolumePrice (M5 — 對應 modules/volume.ts) — Phase 6 backend fetch stub =====
// 大少 2026-08-20 21:30 Phase 6 — analyzeVolumePrice 拎走 frontend, 改 fetch backend
// 凡人話: M5 algorithm 完整 (~688 行, 15 rules V1-V15) 已經 port 去 backend/algorithms/volume_price/algorithm.py
// frontend 唔再自己跑 M5 algorithm, 改為 fetch backend /api/algorithms/run?algo=volume_price
// 對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs
// 永久 rule: frontend M5 algorithm 拎走, 改 caller inject backend verdict
// 對應 source: algorithms/AS-03-cycle-detection/modules/volume.ts (688 行, 1:1 port 去 Python)

/**
 * 凡人話: 拎 backend M5 algorithm 嘅 verdict
 * @param klines - K 線 array (frontend 拎到, 傳畀 backend 入面用嚟對齊時間)
 * @param options - 參數 (symbol, period, dataWindowDays, volumePriceConfig, etc)
 * @returns backend verdict (verdict.meta 拎 state / confidence / signal / buyTimingScore / winProbability / volumeRegime / breakoutStatus / obvAnalysis / matchedRules)
 */
async function analyzeVolumePrice(klines, options = {}) {
  const BACKEND_URL = (typeof window !== "undefined" && window.BACKEND_URL) || "http://localhost:18792";
  const symbol = options.code || options.symbol || "UNKNOWN";
  const period = options.period || "1d";
  const dataWindowDays = options.dataWindowDays || 100;  // M5 frontend 默認 100 日 (2026-08-07)

  const url = `${BACKEND_URL}/api/algorithms/run?algo=volume_price&symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}&data_window_days=${dataWindowDays}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Backend M5 algorithm 拎唔到: ${resp.status} ${resp.statusText}`);
  }
  const verdict = await resp.json();
  if (!verdict.ok) {
    throw new Error(`Backend M5 verdict fail: ${verdict.error || "unknown"}`);
  }
  // backend verdict shape 已經跟 frontend 兼容 (frontend 拎 verdict.meta.* 拎 state / confidence / signal / matchedRules / etc)
  return verdict;
}

export function renderVolumeResult(verdict) {
  const stateColors = { UP: '#52c41a', DOWN: '#ff4d4f', SIDEWAYS: '#faad14', TRANSITION: '#722ed1' };
  const stateLabels = { UP: '上升', DOWN: '下跌', SIDEWAYS: '橫行', TRANSITION: '轉折' };
  const signalColors = { CONFIRM: '#52c41a', DISCONFIRM: '#ff4d4f', NEUTRAL: '#faad14' };
  const signalLabels = { CONFIRM: '支持上升', DISCONFIRM: '反對上升', NEUTRAL: '中性' };
  const regimeLabels = { accumulation: '吸籌 (大戶低調買入)', distribution: '派發 (大戶高調賣出)', neutral: '中性' };
  const patternLabels = {
    gradual_buildup: '溫和堆量 (最可信)',
    sustained_surge: '持續放量 (可信)',
    single_spike: '單日爆量 (有水分)',
    low_volume: '縮量突破 (高風險)',
    none: '無突破',
  };

  const color = stateColors[verdict.meta.state] || '#666';
  const stateLabel = stateLabels[verdict.meta.state] || verdict.meta.state;
  const signal = verdict.meta.signal || 'NEUTRAL';
  const signalColor = signalColors[signal] || '#faad14';
  const cycle = verdict.meta.cycle || 'sideways';
  const cycleLabel = verdict.meta.cycleLabel || '資金觀望';
  const volumeRegime = verdict.meta.volumeRegime || 'neutral';
  const breakoutStatus = verdict.meta.breakoutStatus || {};
  const pullbackHealth = verdict.meta.pullbackHealth || {};
  const vwapAnalysis = verdict.meta.vwapAnalysis || {};
  const volumePriceCorrelation = verdict.meta.volumePriceCorrelation || {};
  const obvAnalysis = verdict.meta.obvAnalysis || {};
  const buyTimingScore = verdict.meta.buyTimingScore || 0;
  const winProbability = verdict.meta.winProbability || 0;
  const falseSignalFlags = verdict.meta.falseSignalFlags || [];
  const matchedRules = verdict.meta.matchedRules || [];
  const rulesFired = verdict.meta.rulesFired || 0;
  const confidencePct = (verdict.meta.confidence * 100).toFixed(1);
  const winProbPct = (winProbability * 100).toFixed(0);
  const buyScorePct = (buyTimingScore * 100).toFixed(0);

  const matchedRulesHtml = matchedRules.length === 0
    ? '<li style="color: #888;">無 rule 觸發</li>'
    : matchedRules.map(rid => {
        const ruleInfo = (typeof getRuleInfo === 'function' ? getRuleInfo(rid) : null) || { label: rid, strength: 'medium' };
        return `<li class="rule-${ruleInfo.strength}"><strong>${rid}</strong> — ${ruleInfo.label} <small>(${ruleInfo.strength})</small></li>`;
      }).join('');

  const denseZonesHtml = (verdict.meta.denseZones || []).map(z =>
    `<tr><td>${z.priceLevelLow.toFixed(2)} - ${z.priceLevelHigh.toFixed(2)}</td>
     <td>${z.type === 'support' ? '🟢 支撐' : z.type === 'resistance' ? '🔴 壓力' : '🟡 中性'}</td>
     <td>${z.distancePct > 0 ? '+' : ''}${(z.distancePct * 100).toFixed(2)}%</td>
     <td>${z.volumeRatio.toFixed(2)}x</td></tr>`
  ).join('');

  const flagsHtml = falseSignalFlags.length === 0
    ? '<span style="color: #52c41a;">無</span>'
    : falseSignalFlags.map(f => `<span class="false-flag">⚠️ ${f}</span>`).join(' ');

  // 📌 資金判斷 + 買入時機評分解讀 (plain language)
  const buyScoreExplain = buyTimingScore >= 0.7 ? '高買入時機評分, 適合入市' : buyTimingScore >= 0.4 ? '中等買入時機評分, 觀望或小注' : '低買入時機評分, 唔建議入市';
  const signalExplain = signal === 'CONFIRM' ? '成交量確認趨勢, 信號強' : signal === 'DISCONFIRM' ? '成交量反對趨勢, 要小心' : '成交量中性, 唔確認亦唔反對';
  const interpretationDetail = signal === 'CONFIRM' ? `
    <p>📌 <strong>簡單講</strong>: 成交量支持目前嘅趨勢, 大戶資金流入 (${regimeLabels[volumeRegime]}), 識別到 ${rulesFired} 條 V-rules 觸發, 突破確認。</p>
    <p>📊 <strong>咩意思</strong>: 買入時機評分 ${buyScorePct}% (${buyScoreExplain}) · 估計勝率 ${winProbPct}% (根據歷史 backtest 統計, 唔係未來保證) · 體制: ${regimeLabels[volumeRegime]}。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 資金跟進 + 趨勢確認, 強烈買入訊號, 可考慮入市。配合 M1 MA 確認大方向 + M4 Indicators 確認動能背馳狀態。</p>
  ` : signal === 'DISCONFIRM' ? `
    <p>📌 <strong>簡單講</strong>: 成交量反對目前嘅趨勢, 大戶資金流出 (${regimeLabels[volumeRegime]}), ${falseSignalFlags.length > 0 ? `有 ${falseSignalFlags.length} 個假突破警號` : '突破未確認'}。</p>
    <p>📊 <strong>咩意思</strong>: 買入時機評分 ${buyScorePct}% (${buyScoreExplain}) · 估計勝率 ${winProbPct}% · 體制: ${regimeLabels[volumeRegime]}。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 量价背馳, 即使趨勢向上都要小心假突破, 唔好追高。等待量能重新確認先入市。</p>
  ` : `
    <p>📌 <strong>簡單講</strong>: 成交量中性, ${regimeLabels[volumeRegime]}, 識別到 ${rulesFired} 條 V-rules 觸發, 信號唔清晰。</p>
    <p>📊 <strong>咩意思</strong>: 買入時機評分 ${buyScorePct}% (${buyScoreExplain}) · 估計勝率 ${winProbPct}% · 體制: ${regimeLabels[volumeRegime]}。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 量能中性, 等待方向確認。配合 M1 MA 確認大方向, 留意量能變化 (放量跟進 = 真突破)。</p>
  `;

  return `
    <div class="as03-verdict as03-module-card">
      <div class="module-card-header">
        <h3 class="module-header">成交量價格行為確認法 v2.0 (VolumePrice)</h3>
      </div>
      <div class="verdict-header">
        <div class="state-pill" style="background: ${color}">
          <span class="state-label">${cycleLabel}</span>
          <span class="state-code">${cycle} (${stateLabel})</span>
        </div>
        <div class="confidence">
          <div class="conf-pct">${buyScorePct}%</div>
          <div class="conf-label">買入時機評分 — ${buyScoreExplain}</div>
        </div>
        <div class="data-summary">
          <div class="summary-row"><span>綜合信心:</span> <strong>${confidencePct}% (${confidencePct >= 70 ? '高信心' : confidencePct >= 40 ? '中等信心' : '低信心'})</strong></div>
          <div class="summary-row"><span>估計勝率:</span> <strong>${winProbPct}% (歷史統計, 唔係保證)</strong></div>
          <div class="summary-row"><span>數據日數:</span> <strong>${verdict.meta.dataDays || 0}</strong></div>
          <div class="summary-row"><span>觸發 Rules:</span> <strong>${rulesFired} 條</strong></div>
        </div>
      </div>

      <div class="interpretation">
        <strong>📌 資金判斷：</strong>${verdict.meta.interpretation}
        ${interpretationDetail}
        <p>💡 <strong>Signal 點解咁講</strong>: ${signalExplain}。</p>
      </div>

      <div class="signal-row">
        <span class="signal-pill" style="background: ${signalColor}">Signal: ${signalLabels[signal]}</span>
        <span class="regime-pill">體制: ${regimeLabels[volumeRegime]}</span>
        ${breakoutStatus.pattern ? `<span class="pattern-pill">突破: ${patternLabels[breakoutStatus.pattern]}</span>` : ''}
      </div>

      <div class="key-metrics">
        <div class="metric-card">
          <h4>VWAP 分析</h4>
          <p>VWAP: <strong>${vwapAnalysis.vwapValue || 'N/A'}</strong></p>
          <p>價 vs VWAP: <strong>${vwapAnalysis.priceVsVwapPct !== undefined ? (vwapAnalysis.priceVsVwapPct * 100).toFixed(2) + '%' : 'N/A'}</strong></p>
          <p>支撐力: <strong>${vwapAnalysis.vwapSupportStrength || 'N/A'}</strong></p>
        </div>
        <div class="metric-card">
          <h4>加權 OBV</h4>
          <p>趨勢: <strong>${obvAnalysis.obvTrend || 'N/A'}</strong></p>
          <p>OBV-Price 相關: <strong>${obvAnalysis.obvPriceCorrelation !== undefined ? obvAnalysis.obvPriceCorrelation.toFixed(3) : 'N/A'}</strong></p>
          <p>加權 OBV 值: <strong>${obvAnalysis.weightedObvValue || 0}</strong></p>
        </div>
        <div class="metric-card">
          <h4>突破狀態</h4>
          <p>模式: <strong>${breakoutStatus.pattern || 'none'}</strong></p>
          <p>強度: <strong>${breakoutStatus.strength !== undefined ? (breakoutStatus.strength * 100).toFixed(0) + '%' : 'N/A'}</strong></p>
          <p>假突破風險: <strong>${breakoutStatus.falseBreakoutRisk !== undefined ? (breakoutStatus.falseBreakoutRisk * 100).toFixed(0) + '%' : 'N/A'}</strong></p>
        </div>
        <div class="metric-card">
          <h4>量价背馳</h4>
          <p>背馳檢測: <strong>${volumePriceCorrelation.divergenceDetected ? '🟡 是' : '🟢 否'}</strong></p>
          <p>背馳類型: <strong>${volumePriceCorrelation.divergenceType || '無'}</strong></p>
          <p>相關性衰減: <strong>${volumePriceCorrelation.correlationDecay !== undefined ? volumePriceCorrelation.correlationDecay.toFixed(3) : 'N/A'}</strong></p>
        </div>
      </div>

      <div class="false-flags">
        <strong>⚠️ 假信號警告：</strong> ${flagsHtml}
      </div>

      <div class="matched-rules">
        <h4>🎯 觸發 Rules (${rulesFired} 條)</h4>
        <ul>${matchedRulesHtml}</ul>
      </div>

      ${denseZonesHtml ? `
      <div class="dense-zones">
        <h4>📊 成交量密集區 (Top 3)</h4>
        <table class="zones-table">
          <tr><th>價位區間</th><th>類型</th><th>距離現價</th><th>成交量比</th></tr>
          ${denseZonesHtml}
        </table>
      </div>
      ` : ''}

      ${renderDetailedExplanationVolume(verdict)}
      ${renderStrategyAdviceVolume(verdict)}
      ${renderUsageGuideVolume(verdict)}

      <details class="meta-details">
        <summary>🔧 配置 (debug 用)</summary>
        <pre>${JSON.stringify(verdict.meta.configUsed, null, 2)}</pre>
      </details>
    </div>
  `;
}

// ===== 3 個 sections (永久 rule 大少 #11056) =====

function renderDetailedExplanationVolume(verdict) {
  const matchedRules = verdict.meta.matchedRules || [];
  const buyScorePct = ((verdict.meta.buyTimingScore || 0) * 100).toFixed(0);
  const winProbPct = ((verdict.meta.winProbability || 0) * 100).toFixed(0);
  const vwapAnalysis = verdict.meta.vwapAnalysis || {};
  const obvAnalysis = verdict.meta.obvAnalysis || {};
  const breakoutStatus = verdict.meta.breakoutStatus || {};
  const pullbackHealth = verdict.meta.pullbackHealth || {};
  const volumePriceCorrelation = verdict.meta.volumePriceCorrelation || {};
  const volumePercentile = verdict.meta.volumePercentile || 0;
  const turnoverRate = verdict.meta.turnoverRate;
  const falseSignalFlags = verdict.meta.falseSignalFlags || [];

  return `
    <div class="detailed-explanation">
      <h4>📖 詳細解讀 (逐個 field 點樣睇)</h4>
      <table class="explain-table">
        <tr><td class="field-name">📊 cycle (資金視角)</td><td><strong>${verdict.meta.cycle || 'N/A'}</strong> — ${verdict.meta.cycleLabel || 'N/A'}。資金睇法: 唔係睇價,係睇錢有冇入場</td></tr>
        <tr><td class="field-name">🎯 buyTimingScore (買入時機 ${buyScorePct}%)</td><td>${buyScorePct >= 70 ? '🟢 高信心 — 規則引擎判定' : buyScorePct >= 50 ? '🟡 中信心 — 有參考價值' : '🔴 低信心 — 觀望'}</td></tr>
        <tr><td class="field-name">🎲 winProbability (勝率 ${winProbPct}%)</td><td>${winProbPct >= 60 ? '🟢 高勝率 (≥ 60%)' : winProbPct >= 50 ? '🟡 中勝率 (50-60%)' : '🔴 低勝率 (< 50%)'}</td></tr>
        <tr><td class="field-name">📈 breakoutStatus.pattern (突破模式)</td><td>${breakoutStatus.pattern} — ${breakoutStatus.pattern === 'gradual_buildup' ? '溫和堆量突破,最可信' : breakoutStatus.pattern === 'sustained_surge' ? '持續放量突破,可信' : breakoutStatus.pattern === 'single_spike' ? '單日爆量,有水分' : breakoutStatus.pattern === 'low_volume' ? '縮量突破,假突破高風險' : '無突破'}</td></tr>
        <tr><td class="field-name">⚠️ falseBreakoutRisk (假突破風險 ${(breakoutStatus.falseBreakoutRisk * 100).toFixed(0)}%)</td><td>${(breakoutStatus.falseBreakoutRisk * 100).toFixed(0)}% — ${breakoutStatus.falseBreakoutRisk > 0.6 ? '🔴 高風險,小心' : breakoutStatus.falseBreakoutRisk > 0.3 ? '🟡 中風險,留意' : '🟢 低風險'}</td></tr>
        <tr><td class="field-name">📊 pullbackHealth.isHealthy (回調健康)</td><td>${pullbackHealth.isHealthy === true ? '🟢 健康 (越跌越縮量,主力沒走)' : pullbackHealth.isHealthy === false ? '🔴 不健康 (越跌越放量,恐慌拋售)' : '🟡 unclear (無明顯相關)'}</td></tr>
        <tr><td class="field-name">📈 vwapAnalysis.priceVsVwapPct (VWAP 偏離)</td><td>${(vwapAnalysis.priceVsVwapPct * 100).toFixed(2)}% — 喺 VWAP ${vwapAnalysis.priceVsVwapPct > 0 ? '之上' : '之下'} (${vwapAnalysis.priceVsVwapPct > 0.01 ? '強勢' : vwapAnalysis.priceVsVwapPct < -0.01 ? '弱勢' : '接近 VWAP'})</td></tr>
        <tr><td class="field-name">📊 volumePercentile (成交量百分位 ${(volumePercentile * 100).toFixed(0)}%)</td><td>${volumePercentile > 0.7 ? '異常放量' : volumePercentile < 0.3 ? '異常縮量' : '正常範圍'}</td></tr>
        <tr><td class="field-name">💱 turnoverRate (換手率)</td><td>${turnoverRate !== null ? (turnoverRate * 100).toFixed(2) + '%' : '無股本資料'}</td></tr>
        <tr><td class="field-name">📈 volumeRegime (成交量體制)</td><td>${verdict.meta.volumeRegime || 'neutral'} — ${verdict.meta.volumeRegime === 'accumulation' ? '🟢 大戶低調吸籌' : verdict.meta.volumeRegime === 'distribution' ? '🔴 大戶高調派發' : '🟡 中性'}</td></tr>
        <tr><td class="field-name">📈 obvAnalysis.obvTrend (加權 OBV 趨勢)</td><td>${obvAnalysis.obvTrend || 'N/A'} — ${obvAnalysis.obvTrend === 'rising' ? '🟢 資金流入中' : obvAnalysis.obvTrend === 'falling' ? '🔴 資金流出中' : '🟡 橫行'}</td></tr>
        <tr><td class="field-name">📊 obvAnalysis.obvPriceCorrelation (OBV-價格相關)</td><td>${obvAnalysis.obvPriceCorrelation !== undefined ? obvAnalysis.obvPriceCorrelation.toFixed(3) : 'N/A'} — ${obvAnalysis.obvPriceCorrelation > 0.5 ? '🟢 同步(健康)' : obvAnalysis.obvPriceCorrelation < -0.3 ? '🔴 背馳(危險)' : '🟡 無明顯相關'}</td></tr>
        <tr><td class="field-name">🎯 signal (MA alignment 互動)</td><td>${verdict.meta.signal || 'NEUTRAL'} — ${verdict.meta.signal === 'CONFIRM' ? '🟢 量价支持上升' : verdict.meta.signal === 'DISCONFIRM' ? '🔴 量价反對上升' : '🟡 中性'}</td></tr>
        <tr><td class="field-name">⚠️ falseSignalFlags (假信號警告)</td><td>${falseSignalFlags.length === 0 ? '🟢 無' : falseSignalFlags.map(f => '🔴 ' + f).join(' / ')}</td></tr>
        <tr><td class="field-name">🎯 觸發 rules (${matchedRules.length} 條)</td><td>${matchedRules.length === 0 ? '無 rule 觸發' : matchedRules.map(r => `<strong>${r}</strong>`).join(' / ')}</td></tr>
      </table>
    </div>
  `;
}

function renderStrategyAdviceVolume(verdict) {
  const cycle = verdict.meta.cycle || 'sideways';
  const buyScore = verdict.meta.buyTimingScore || 0;
  const winProb = verdict.meta.winProbability || 0;
  const falseSignalFlags = verdict.meta.falseSignalFlags || [];
  const matchedRules = verdict.meta.matchedRules || [];
  const volumeRegime = verdict.meta.volumeRegime || 'neutral';

  let cycleAdvice = '';
  if (cycle === 'uptrend') {
    if (buyScore >= 0.85) {
      cycleAdvice = `
        <div class="strategy-up">
          <h4>🟢 黃金買入 · 策略建議</h4>
          <p><strong>基本動作:</strong> 黃金買點 (buyScore ≥ 0.85) — 信心指數高,可考慮落單</p>
          <p><strong>進場策略:</strong> 等回調到 VWAP 附近 (短期/中期回歸) 再反彈入場,唔好追高</p>
          <p><strong>風險管理:</strong> 留意 falseBreakoutRisk, 假突破風險高要收緊止損</p>
          <p><strong>倉位:</strong> 勝率 ${(winProb * 100).toFixed(0)}% 可用 50-70% 倉位</p>
        </div>
      `;
    } else if (buyScore >= 0.7) {
      cycleAdvice = `
        <div class="strategy-up">
          <h4>🟢 健康回調 · 策略建議</h4>
          <p><strong>基本動作:</strong> 健康回調買入 (buyScore 0.7-0.85) — 勝率中等</p>
          <p><strong>進場策略:</strong> 等回調到 VWAP / dense_zone 支撐反彈入場</p>
          <p><strong>風險管理:</strong> 設止損喺支撐位下方 2-3%</p>
          <p><strong>倉位:</strong> 勝率 ${(winProb * 100).toFixed(0)}% 可用 30-50% 倉位</p>
        </div>
      `;
    } else {
      cycleAdvice = `
        <div class="strategy-up">
          <h4>🟢 弱上升 · 策略建議</h4>
          <p><strong>基本動作:</strong> 上升但 buyScore 較低 (0.55-0.7), 信心一般</p>
          <p><strong>進場策略:</strong> 等 buyScore 升到 0.7+ 先考慮入場</p>
        </div>
      `;
    }
  } else if (cycle === 'downtrend') {
    cycleAdvice = `
      <div class="strategy-down">
        <h4>🔴 下跌 / 派發 · 策略建議</h4>
        <p><strong>基本動作:</strong> 避開 / 減倉 — 派發訊號</p>
        <p><strong>進場策略:</strong> 唔好撈底, 等 bullish_vp (拋壓枯竭) 先考慮</p>
        <p><strong>特別注意:</strong> OBV 下跌 + 量高 = 主力出貨中</p>
      </div>
    `;
  } else {
    cycleAdvice = `
      <div class="strategy-sideways">
        <h4>🟡 觀望 · 策略建議</h4>
        <p><strong>基本動作:</strong> 等方向 — buyScore 0.3 (觀望)</p>
        <p><strong>進場策略:</strong> 留意 V4 連續堆量 + V9 突破確認觸發再入場</p>
      </div>
    `;
  }

  let failureAdvice = '';
  if (falseSignalFlags.length > 0) {
    failureAdvice = `
      <div class="failure-mode">
        <h4>⚠️ 假信號警告處理</h4>
        <ul>${falseSignalFlags.map(f => `<li>${f} — 將 buyTimingScore 折扣,買入降級或觀望</li>`).join('')}</ul>
      </div>
    `;
  }

  return `
    <div class="strategy-advice">
      <h4>🎯 策略建議 (點做)</h4>
      ${cycleAdvice}
      ${failureAdvice}
      <p class="caveat">⚠️ 觸發 ${matchedRules.length} 條 rule, 體制 ${volumeRegime}, 買入評分 ${(buyScore * 100).toFixed(0)}%, 勝率 ${(winProb * 100).toFixed(0)}%</p>
    </div>
  `;
}

function renderUsageGuideVolume(verdict) {
  return `
    <div class="usage-guide">
      <h4>💡 點用呢個結果 (點睇)</h4>
      <ol>
        <li><strong>先睇 cycle 同 cycleLabel</strong> — 個大色塊同標題。呢個係最概要嘅判斷 (資金流入/流出/觀望)</li>
        <li><strong>睇 buyTimingScore 同 winProbability</strong> — 越高越可信。> 0.7 = 高勝率可考慮入場, < 0.5 = 觀望</li>
        <li><strong>睇 breakoutStatus.pattern</strong> — gradual_buildup = 黃金突破 / low_volume = 假突破高危</li>
        <li><strong>睇 breakoutStatus.isConfirmed</strong> — true = 真突破 / false = 假突破 / pending = 等緊確認</li>
        <li><strong>睇 volumeRegime</strong> — accumulation = 大戶低調吸籌 (準備升) / distribution = 大戶高調派發 (準備跌)</li>
        <li><strong>睇 pullbackHealth.isHealthy</strong> — 回調期間是否健康鎖籌。true = 健康, 可以等回調買入</li>
        <li><strong>睇 vwapAnalysis.priceVsVwapPct</strong> — 喺 VWAP 之上 1% = 強勢 / 之下 = 弱勢</li>
        <li><strong>睇 obvAnalysis.obvTrend 同 obvPriceCorrelation</strong> — OBV 上升 + 與價格同向 = 健康 / OBV 下跌 + 背馳 = 危險</li>
        <li><strong>睇 falseSignalFlags</strong> — 有任何 flag 都要打折扣。anomaly_volume_spike 一定要等下日確認</li>
        <li><strong>永遠配合風險管理</strong> — 呢個 module 嘅策略建議只係 reference,落單前要自己再睇下基本面 / 消息面 / 板塊走勢</li>
      </ol>
      <p class="caveat">⚠️ 呢個 module 係輔助工具, 唔係 100% 準。永遠配合基本面 / 消息面 / 風險管理一齊用, 唔好單靠一個 algorithm 落單。</p>
    </div>
  `;
}

export function getVolumeHelp() {
  return `
    <h4>成交量價格確認法 v2.0 · 15 條規則 (1 到 15 條)</h4>
    <p>用成交量同價格嘅數據, 確認個走勢係咪真嘅, 定係假嘅突破</p>
    <p><strong>基礎指標</strong></p>
    <ul>
      <li><strong>1</strong> (弱): 14 日波動範圍大過收市價 0.5% — 波動夠大</li>
      <li><strong>2</strong> (弱): 現價高過 VWAP × 0.99 — 喺平均價之上</li>
      <li><strong>3</strong> (弱): 成交量百分位正常 (0 到 1 之間) — 成交量冇異常</li>
    </ul>
    <p><strong>放量同 OBV 趨勢</strong></p>
    <ul>
      <li><strong>4</strong> (中): 連續 2 日或以上成交量 ≥ 1.3 倍均量 — 慢慢堆量</li>
      <li><strong>5</strong> (強, 反向): 成交量統計分數大過 3, 而且今日係 5 倍均量 — 異常爆量, 提你小心</li>
      <li><strong>6</strong> (中): 加權 OBV 高過 20 日均線 × 1.03 — 買盤上升</li>
      <li><strong>7</strong> (中): 加權 OBV 跌穿 20 日均線 × 0.97 — 買盤下跌</li>
      <li><strong>8</strong> (強): 20 日內加權 OBV 同收市價嘅相關性大過 0.5 — 量同價方向一致</li>
    </ul>
    <p><strong>突破定假突破</strong></p>
    <ul>
      <li><strong>9</strong> (強): 慢慢堆量然後突破 — 最可信嘅真突破</li>
      <li><strong>10</strong> (強): 持續放量突破, 而且確認咗 — 確定突破</li>
      <li><strong>11</strong> (強, 反向): 縮量就突破, 或者假突破風險大過 0.5 — 可能係假突破</li>
      <li><strong>12</strong> (強, 反向): 假突破風險大過 0.6 — 高機會係假突破</li>
    </ul>
    <p><strong>回調、拋壓、背馳</strong></p>
    <ul>
      <li><strong>13</strong> (中): 跌嘅時候量縮 — 健康回調 (越跌越冇人賣)</li>
      <li><strong>14</strong> (強, 反向): 跌嘅時候量增 — 拋售拋壓 (越跌越多人賣)</li>
      <li><strong>15</strong> (強): 量同價嘅關係突然變弱 — 量價背馳 (小心見頂)
    </ul>
    <p><strong>5 條 buy rules</strong> (按信心由高到低):</p>
    <ol>
      <li>黃金買入 (0.9): gradual_buildup + confirmed + obv_corr > 0.5 + 無背馳</li>
      <li>健康回調 (0.75): pullback healthy + 有支撐 + accumulation + obv rising</li>
      <li>拋壓枯竭 (0.6): bullish_vp + 量縮 + obv ≠ falling</li>
      <li>VWAP 支撐 (0.55): 接近 VWAP + 量縮 + obv rising</li>
      <li>觀望 (0.3): 其他</li>
    </ol>
    <p><strong>4 條減分覆蓋</strong>: high_false_breakout_risk × 0.5, distribution_with_price_rise × 0.4, anomaly_volume_spike × 0.6, obv_price_divergence × 0.7</p>
    <p><strong>State 派生</strong> (用 cycle, 唔係 state): uptrend if buyScore ≥ 0.55 / downtrend if distribution / sideways</p>
    <p><strong>Signal 派生</strong> (供 M1 alignment 用): CONFIRM / DISCONFIRM / NEUTRAL</p>
  `;
}

// 大少 2026-08-11 22:40 — Codebase 註解 Phase 4 partial gap fill
// 對應 modules/volume.ts v2.0.0
// Spec doc: docs/research/AS-03-cycle-detection/MODULE-05-VOLUME-PRICE.md
// Algorithm (M5 v2.0): 15 條 rule V1-V15 + 11 step algorithm, 確認 / 否決 / 中性 3 個 signal 派生
// 凡人話: 睇成交量 + 價格行為, 確認走勢係真定假
export const volumePriceAdapter = {
  id: 'AS-03-VP',
  name: '成交量價格行為確認法',
  version: '2.0.0',
  description: '用 15 條規則分析成交量同價格嘅行為, 確認個走勢係咪真嘅',
  inputs: [
    {
      key: 'code',
      label: '股票代碼',
      type: 'autocomplete',
      required: true,
      endpoint: '/api/stocks/search',
      queryParam: 'q',
      placeholder: '輸入代碼或名稱（例: 00981 或 中芯）',
      limit: 10,
      marketFn: 'auto',
    },
    {
      key: 'period',
      label: '時間週期',
      type: 'select',
      options: [
        { value: '1d', label: '日線' },
        { value: '1w', label: '週線' },
      ],
      default: '1d',
    },
    {
      key: 'dataWindowDays',
      label: '取數據日數',
      type: 'number',
      default: 100,
      min: 80,
      max: 500,
    },
  ],
  analyze: analyzeVolumePrice,
  renderResult: renderVolumeResult,
  getHelp: getVolumeHelp,
};

// =============================================================================
// 大少 2026-08-07 — Module 6 Volatility v1.0.0
// =============================================================================
// 對應 modules/volatility.ts v1.0.0 + MODULE-06-VOLATILITY.md
// 簡化: Squeeze (BB vs KC) + ATR 分解 + 5 種 setup + 3 種 failure mode
//
// Algorithm (M6):
//   1. BB (Bollinger Bands) — 20 日 SMA ± 2σ
//   2. KC (Keltner Channels) — 20 日 SMA ± 1.5 ATR(14)
//   3. Squeeze detection — BB 寬度 < KC 寬度 → 波動收縮
//   4. ATR decomposition — 分 trend (高低距) + noise (殘差) 兩個 component
//   5. 5 種 setup detection (squeeze fire / VCP breakout / genuine squeeze / strong trend / quality squeeze)
//   6. 3 種 failure mode (weak follow-through / noisy squeeze / extension failure)
//
// 用法 (Usage):
//   await analyzeVolatility(klines, { volatilityConfig: { atrPeriod: 14 } }) → volatilityVerdict
//
// Output: { state, confidence, interpretation, evidence, meta: { ... }, _warnings }
//   - state: 'UP' | 'DOWN' | 'SIDEWAYS' (cycle 判斷: uptrend / downtrend / sideways)
//   - confidence: 0-1 (entry score)
//   - meta.cycle: 'uptrend' | 'downtrend' | 'sideways'
//   - meta.squeeze: { isSqueeze, duration, qualityScore, isGenuine }
//   - meta.atrDecomposition: { trend, noise, ratio }
//   - _warnings: ModuleWarning[] 可能包含 INSUFFICIENT_DATA / OUTLIER_VALUE / FALLBACK_USED
//
// 對應 module: M6 (Volatility)
// 對應 ts file: algorithms/AS-03-cycle-detection/modules/volatility.ts
// Spec doc: docs/research/AS-03-cycle-detection/MODULE-06-VOLATILITY.md

// ===== analyzeVolatility (M6 — 對應 modules/volatility.ts) — Phase 7 backend fetch stub =====
// 大少 2026-08-20 21:30 Phase 7 — analyzeVolatility 拎走 frontend, 改 fetch backend
// 凡人話: M6 algorithm 完整 (~456 行, 12 rules S1-S12) 已經 port 去 backend/algorithms/volatility/algorithm.py
// frontend 唔再自己跑 M6 algorithm, 改為 fetch backend /api/algorithms/run?algo=volatility
// 對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs
// 永久 rule: frontend M6 algorithm 拎走, 改 caller inject backend verdict
// 對應 source: algorithms/AS-03-cycle-detection/modules/volatility.ts (456 行, 1:1 port 去 Python)

/**
 * 凡人話: 拎 backend M6 algorithm 嘅 verdict
 * @param klines - K 線 array (frontend 拎到, 傳畀 backend 入面用嚟對齊時間)
 * @param options - 參數 (symbol, period, dataWindowDays, volatilityConfig, etc)
 * @returns backend verdict (verdict.meta 拎 state / confidence / squeeze / vcpStructure / atrDecomposition / setupType / matchedRules)
 */
async function analyzeVolatility(klines, options = {}) {
  const BACKEND_URL = (typeof window !== "undefined" && window.BACKEND_URL) || "http://localhost:18792";
  const symbol = options.code || options.symbol || "UNKNOWN";
  const period = options.period || "1d";
  const dataWindowDays = options.dataWindowDays || 100;  // M6 frontend 默認 100 日 (2026-08-07)

  const url = `${BACKEND_URL}/api/algorithms/run?algo=volatility&symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}&data_window_days=${dataWindowDays}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Backend M6 algorithm 拎唔到: ${resp.status} ${resp.statusText}`);
  }
  const verdict = await resp.json();
  if (!verdict.ok) {
    throw new Error(`Backend M6 verdict fail: ${verdict.error || "unknown"}`);
  }
  // backend verdict shape 已經跟 frontend 兼容 (frontend 拎 verdict.meta.* 拎 state / confidence / squeeze / matchedRules / etc)
  return verdict;
}

export function renderVolatilityResult(verdict) {
  const stateColors = { UP: '#52c41a', DOWN: '#ff4d4f', SIDEWAYS: '#faad14', TRANSITION: '#722ed1' };
  const stateLabels = { UP: '上升', DOWN: '下跌', SIDEWAYS: '橫行', TRANSITION: '轉折' };
  const setupLabels = {
    mtf_squeeze_fire: '🏆 黃金 Squeeze Fire',
    confirmed_vcp_breakout: '🏆 確認 VCP 突破',
    genuine_squeeze_forming: '⏳ 真 Squeeze 蓄力中',
    clean_trend_expansion: '🟢 乾淨趨勢擴張',
    no_clear_setup: '🟡 觀望 (no_clear_setup)',
  };
  const failureLabels = {
    none: '🟢 無', noisy_squeeze: '🔴 噪音 Squeeze',
    weak_follow_through: '🔴 跟進無力', no_setup: '🟡 冇明確 setup',
  };
  const color = stateColors[verdict.meta.state] || '#666';
  const stateLabel = stateLabels[verdict.meta.state] || verdict.meta.state;
  const cycle = verdict.meta.cycle || 'sideways';
  const cycleLabel = verdict.meta.cycleLabel || '蓄力觀察';
  const setupType = verdict.meta.setupType || 'no_clear_setup';
  const failureMode = verdict.meta.failureMode || 'none';
  const entryScorePct = ((verdict.meta.entryScore || 0) * 100).toFixed(0);
  const winProbPct = ((verdict.meta.winProbability || 0) * 100).toFixed(0);
  const squeeze = verdict.meta.squeeze || {};
  const vcp = verdict.meta.vcpStructure || {};
  const atrDecomp = verdict.meta.atrDecomposition || {};
  const follow = verdict.meta.followThrough || {};
  const matchedRules = verdict.meta.matchedRules || [];
  const rulesFired = verdict.meta.rulesFired || 0;
  const ruleMap = { S1: ['日線 Squeeze', 'medium'], S2: ['Squeeze 質量高', 'medium'], S3: ['Squeeze 持續夠耐', 'medium'], S4: ['趨勢 ATR 強', 'strong'], S5: ['噪音 ATR 高', 'strong'], S6: ['結構性收縮', 'medium'], S7: ['結構性擴張', 'medium'], S8: ['籌碼集中', 'medium'], S9: ['VCP 結構', 'medium'], S10: ['VCP 量縮確認', 'medium'], S11: ['突破跟進', 'medium'], S12: ['失敗模式', 'strong'] };
  const matchedRulesHtml = matchedRules.length === 0
    ? '<li style="color: #888;">無 rule 觸發</li>'
    : matchedRules.map(rid => { const [l, s] = ruleMap[rid] || [rid, 'medium']; return '<li class="rule-' + s + '"><strong>' + rid + '</strong> — ' + l + ' <small>(' + s + ')</small></li>'; }).join('');

  // 📌 波動率結構 + 入場評分解讀 (plain language)
  const entryExplain = entryScorePct >= 70 ? '高入場評分, 適合入市' : entryScorePct >= 40 ? '中等入場評分, 觀望或小注' : '低入場評分, 唔建議入市';
  const setupDetail = setupType === 'mtf_squeeze_fire' ? `
    <p>📌 <strong>簡單講</strong>: 出現黃金 Squeeze Fire setup, 即 Squeeze 壓縮一段時間後開始爆發, ATR 開始擴張, 典型嘅大波動開始訊號。</p>
    <p>📊 <strong>咩意思</strong>: 入場評分 ${entryScorePct}% (${entryExplain}) · 估計勝率 ${winProbPct}% · 失敗模式: ${failureLabels[failureMode] || failureMode} · 識別到 ${rulesFired} 條 S-rules 觸發。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 大波動開始, 配合 M1 MA 確認方向 + M5 量价確認資金跟進 = 黃金買點。留意失敗模式 ${failureLabels[failureMode] || failureMode}。</p>
  ` : setupType === 'confirmed_vcp_breakout' ? `
    <p>📌 <strong>簡單講</strong>: 出現教科書 VCP 突破 setup, 波動率持續收縮後放量突破, 典型嘅趨勢啟動訊號。</p>
    <p>📊 <strong>咩意思</strong>: 入場評分 ${entryScorePct}% (${entryExplain}) · 估計勝率 ${winProbPct}% · 失敗模式: ${failureLabels[failureMode] || failureMode} · 識別到 ${rulesFired} 條 S-rules 觸發。</p>
    <p>💡 <strong>點睇呢個結果</strong>: VCP 突破, 趨勢啟動訊號強烈, 配合 M1 MA + M2 HL 確認結構轉強 = 強烈買入。</p>
  ` : setupType === 'genuine_squeeze_forming' ? `
    <p>📌 <strong>簡單講</strong>: 真正嘅 Squeeze 蓄力中, 波動率持續壓縮, 典型嘅突破前蓄力階段。</p>
    <p>📊 <strong>咩意思</strong>: 入場評分 ${entryScorePct}% (${entryExplain}) · 估計勝率 ${winProbPct}% · 失敗模式: ${failureLabels[failureMode] || failureMode} · 識別到 ${rulesFired} 條 S-rules 觸發。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 蓄力中, 等待突破訊號。配合 M1 MA + 量能變化捕捉突破時機, 唔好搶跑。</p>
  ` : setupType === 'clean_trend_expansion' ? `
    <p>📌 <strong>簡單講</strong>: 趨勢擴張, 噪音低, 跟進有力, 典型嘅乾淨趨勢運行。</p>
    <p>📊 <strong>咩意思</strong>: 入場評分 ${entryScorePct}% (${entryExplain}) · 估計勝率 ${winProbPct}% · 失敗模式: ${failureLabels[failureMode] || failureMode} · 識別到 ${rulesFired} 條 S-rules 觸發。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 乾淨趨勢, 可考慮持有 / 順勢入市。留意失敗模式 ${failureLabels[failureMode] || failureMode}。</p>
  ` : `
    <p>📌 <strong>簡單講</strong>: 暫時冇明確嘅波動率 setup, 結構混亂或者趨勢唔清晰。</p>
    <p>📊 <strong>咩意思</strong>: 入場評分 ${entryScorePct}% (${entryExplain}) · 估計勝率 ${winProbPct}% · 失敗模式: ${failureLabels[failureMode] || failureMode} · 識別到 ${rulesFired} 條 S-rules 觸發。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 等待方向確認, 唔好強行入市。配合 M1 MA 確認大方向, 留意 Squeeze 訊號 (可能係蓄力)。</p>
  `;
  return `
    <div class="as03-verdict as03-module-card">
      <div class="module-card-header">
        <h3 class="module-header">波動率與市場結構收縮擴張 (Volatility)</h3>
      </div>
      <div class="verdict-header">
        <div class="state-pill" style="background: ${color}">
          <span class="state-label">${cycleLabel}</span>
          <span class="state-code">${cycle} (${stateLabel})</span>
        </div>
        <div class="confidence">
          <div class="conf-pct">${entryScorePct}%</div>
          <div class="conf-label">入場評分 — ${entryExplain}</div>
        </div>
        <div class="data-summary">
          <div class="summary-row"><span>Setup:</span> <strong>${setupLabels[setupType] || setupType}</strong></div>
          <div class="summary-row"><span>估計勝率:</span> <strong>${winProbPct}% (歷史統計, 唔係保證)</strong></div>
          <div class="summary-row"><span>失敗模式:</span> <strong>${failureLabels[failureMode] || failureMode}</strong></div>
          <div class="summary-row"><span>觸發 Rules:</span> <strong>${rulesFired} 條</strong></div>
        </div>
      </div>
      <div class="interpretation">
        <strong>📌 波動率結構：</strong>${verdict.meta.interpretation}
        ${setupDetail}
      </div>
      <div class="key-metrics">
        <div class="metric-card">
          <h4>Squeeze 狀態</h4>
          <p>收縮中: <strong>${squeeze.isSqueeze ? '🟡 是' : '🟢 否'}</strong></p>
          <p>持續: <strong>${squeeze.duration || 0} 日</strong></p>
          <p>質量: <strong>${((squeeze.qualityScore || 0) * 100).toFixed(0)}%</strong></p>
          <p>真 Squeeze: <strong>${squeeze.isGenuine ? '✅' : '❌'}</strong></p>
        </div>
        <div class="metric-card">
          <h4>ATR 分解</h4>
          <p>Trend ATR: <strong>${atrDecomp.trendAtr || 0}</strong></p>
          <p>Noise ATR: <strong>${atrDecomp.noiseAtr || 0}</strong></p>
          <p>SNR: <strong>${atrDecomp.snr || 0}</strong></p>
          <p>Regime: <strong>${atrDecomp.regime || 'N/A'}</strong></p>
        </div>
        <div class="metric-card">
          <h4>VCP 結構</h4>
          <p>檢測: <strong>${vcp.detected ? '✅ 是' : '❌ 否'}</strong></p>
          <p>高低點對: <strong>${vcp.highLowPairs || 0}</strong></p>
          <p>量縮確認: <strong>${vcp.volTightening ? '✅' : '❌'}</strong></p>
        </div>
        <div class="metric-card">
          <h4>Follow-through</h4>
          <p>跟進評分: <strong>${((follow.followScore || 0) * 100).toFixed(0)}%</strong></p>
          <p>量衰: <strong>${((follow.volumeDecay || 0) * 100).toFixed(0)}%</strong></p>
          <p>價推進: <strong>${((follow.priceProgression || 0) * 100).toFixed(0)}%</strong></p>
        </div>
      </div>
      <div class="matched-rules">
        <h4>🎯 觸發 Rules (${rulesFired} 條)</h4>
        <ul>${matchedRulesHtml}</ul>
      </div>
      <details class="meta-details">
        <summary>🔧 配置 (debug 用)</summary>
        <pre>${JSON.stringify(verdict.meta.configUsed, null, 2)}</pre>
      </details>
    </div>
  `;
}

export function getVolatilityHelp() {
  return `<h4>波動率 v1.0 · 12 條規則 (1 到 12 條)</h4>
  <p>分析股價波動嘅大細同變化, 等你知道幾時會爆升爆跌</p>
  <p><strong>1 到 3 條 波動收縮 (Squeeze)</strong>: 1 日線波動收縮 / 2 質素好 / 3 持續夠耐</p>
  <p><strong>4 到 7 條 波動分解</strong>: 4 趨勢波動強 / 5 噪音波動高 / 6 結構性收縮 / 7 結構性擴張</p>
  <p><strong>8 到 11 條 收縮震盪同跟進</strong>: 8 籌碼集中 / 9 收縮震盪結構 / 10 收縮震盪量縮 / 11 突破跟進</p>
  <p><strong>12 條 失敗模式</strong>: 噪音式收縮 / 跟進唔夠 — 入場上限 0.4</p>
  <p><strong>5 種情況</strong>: 多時段收縮爆發 0.95 / 確認收縮震盪突破 0.9 / 乾淨趨勢擴張 0.7 / 真正收縮形成中 0.55 / 冇明確情況 0.25</p>`;
}

// 大少 2026-08-11 22:40 — Codebase 註解 Phase 4 partial gap fill
// 對應 modules/volatility.ts v1.0.0
// Spec doc: docs/research/AS-03-cycle-detection/MODULE-06-VOLATILITY.md
// Algorithm (M6): BB/KC/Squeeze/ATR + 5 個 setup + 3 個 failure mode + 12 條 rule S1-S12
// 凡人話: 睇波動率 (布林通道 + 肯特納通道 + 擠壓指標), 判斷波動收縮/擴張
export const volatilityAdapter = {
  id: 'AS-03-VOL',
  name: '波動率同市場結構收縮擴張',
  version: '1.0.0',
  description: '用 12 條規則分析股價波動嘅大細同埋變化, 等你知道幾時會爆升爆跌',
  inputs: [
    { key: 'code', label: '股票代碼', type: 'autocomplete', required: true, endpoint: '/api/stocks/search', queryParam: 'q', placeholder: '輸入代碼或名稱', limit: 10, marketFn: 'auto' },
    { key: 'period', label: '時間週期', type: 'select', options: [{ value: '1d', label: '日線' }, { value: '1w', label: '週線' }], default: '1d' },
    { key: 'dataWindowDays', label: '取數據日數', type: 'number', default: 100, min: 80, max: 500 },
  ],
  analyze: analyzeVolatility,
  renderResult: renderVolatilityResult,
  getHelp: getVolatilityHelp,
};

// =============================================================================
// 大少 2026-08-07 23:15 — Module 8 SlopeMomentum (斜率動能) 隱藏
// =============================================================================
//
// 等 Stage 1 全部 done 最後先做返,將來由 git history 拎返:
//   - 10 條 rule M1-M10
//   - analyzeSlopeMomentum + renderSlopeResult + 3 sections
//   - slopeMomentumAdapter entry
//   - DEFAULT_SLOPE_MOMENTUM_CONFIG
//   - enableSlopeMomentum checkbox + display name fallback

// =============================================================================
// Plain-language 「📖 點樣用」interpretation (大少 #10871 — 2026-08-06)
// =============================================================================
//
// 用淺白中文解釋 verdict 嘅意思 + 點樣用。
// 只係 UI 顯示 — 唔影響 backend verdict labels / state derivation。

function getVolumeInterpretation(signal) {
  if (signal === 'CONFIRM') {
    return '💰 錢跟價 — 資金確認趨勢，AS-03 嘅判斷可靠。可以加倉 / 持倉。';
  }
  if (signal === 'DISCONFIRM') {
    return '⚠️ 錢唔跟價 — 量價背馳，見頂警號 / 拋售衰竭。要小心假突破。';
  }
  return '🔍 無明確信號 — 量價中立，唔加強唔削弱 AS-03 判斷。等其他信號。';
}

function getSlopeInterpretation(state, matchedRules) {
  const ids = new Set(matchedRules || []);
  const hasTransition = ids.has('M7') || ids.has('M8');
  const hasStrongUp = ids.has('M1') || ids.has('M3') || ids.has('M5');
  const hasStrongDown = ids.has('M2') || ids.has('M4') || ids.has('M6');

  if (hasTransition) {
    return '🔄 轉勢中 — 短期斜率反轉，留意方向改變。等確認先行動。';
  }
  if (state === 'UP' && hasStrongUp) {
    return '🚀 強勢升 — 均線加速向上，趨勢強。順勢做。';
  }
  if (state === 'UP') {
    return '⬆️ 動能加強 — 短期斜率向上，但中期未確認。';
  }
  if (state === 'DOWN' && hasStrongDown) {
    return '📉 強勢跌 — 均線加速向下，跌勢強。避開 / 減倉。';
  }
  if (state === 'DOWN') {
    return '⬇️ 動能偏弱 — 短期斜率向下，但中期未確認。';
  }
  return '⏸️ 等待方向 — 動能弱，等市場給方向。';
}

function getSynthesizedStateInterpretation(state) {
  if (state === 'UP') return '上升趨勢 — 多個 module 一致看好，可順勢而行。';
  if (state === 'DOWN') return '下跌趨勢 — 多個 module 一致看淡，建議避開或減倉。';
  if (state === 'SIDEWAYS') return '橫行 — 方向不明，等待突破訊號。';
  if (state === 'TRANSITION') return '轉勢 — module 訊號矛盾或正在改變方向，留意確認。';
  return '無明確判斷。';
}

// =============================================================================
// Shared helpers (VolumePrice uses these — 大少 2026-08-07 23:15 SlopeMomentum 暫時隱藏)
// =============================================================================

function avgField(klines, endIdx, period, field) {
  const startIdx = Math.max(0, endIdx - period + 1);
  const slice = klines.slice(startIdx, endIdx + 1);
  const sum = slice.reduce((acc, k) => acc + k[field], 0);
  return sum / slice.length;
}

function allIncreasing(klines, field) {
  for (let i = 1; i < klines.length; i++) {
    if (!(klines[i][field] > klines[i - 1][field])) return false;
  }
  return klines.length > 1;
}

function allDecreasing(klines, field) {
  for (let i = 1; i < klines.length; i++) {
    if (!(klines[i][field] < klines[i - 1][field])) return false;
  }
  return klines.length > 1;
}

function correlation(xs, ys) {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

function computeSlope(history, i, N) {
  if (i - N < 0) return 0;
  const prev = history[i - N];
  if (prev === 0) return 0;
  return (history[i] - prev) / prev;
}

function allStrictlyIncreasing(arr, startIdx, length) {
  if (startIdx - length + 1 < 0) return false;
  for (let i = startIdx - length + 1; i < startIdx; i++) {
    if (!(arr[i + 1] > arr[i])) return false;
  }
  return true;
}

function allStrictlyDecreasing(arr, startIdx, length) {
  if (startIdx - length + 1 < 0) return false;
  for (let i = startIdx - length + 1; i < startIdx; i++) {
    if (!(arr[i + 1] < arr[i])) return false;
  }
  return true;
}

// =============================================================================
// HL Structure Module (大少 + MiniMax Code 2026-08-07 — Module 2 v0.1.0)
// =============================================================================
//
// 跟 docx `高低點結構法.docx` v2.0 spec 嘅 18 步算法 port 落 vanilla JS
// 供 StockPulse Testing Page 用
//
// Source of truth: ~/stockpulse/algorithms/AS-03-cycle-detection/modules/hl-structure.ts
// Spec doc: ~/stockpulse/docs/research/AS-03-cycle-detection/MODULE-02-HL-STRUCTURE.md

const DEFAULT_HL_STRUCTURE_CONFIG = {
  minPairs: 3,             // 2026-08-07 — 改返 3 (高質量,需要 6 個 alternating)
  baseWindow: 5,
  tolerancePct: 0.015,
  enableAtrWindow: true,
  atrPeriod: 14,
  enableVolumeFilter: true,
  volumeConfirmRatio: 0.7,
  volumeLookback: 20,
  volumeBoostRatio: 1.3,
  volumeShrinkWeightMultiplier: 0.5,
  volumeBoostWeightMultiplier: 1.2,
  breakoutConfirmDays: 2,
  timeDecayLambda: 0.03,
  enablePatternAlert: true,
  patternSymmetryTolerance: 2,
  maxExtremeAgeDays: 20,
  freshnessDecayDays: 30,
  freshnessMinMultiplier: 0.4,
};

// ATR 計算

// ===== analyzeHLStructure (M2 — 對應 modules/hl-structure.ts) — Phase 3 backend fetch stub =====
// 大少 2026-08-20 20:35 Phase 3 — analyzeHLStructure 拎走 frontend, 改 fetch backend
// 凡人話: M2 algorithm 完整 (~340 行) 已經 port 去 backend/algorithms/hl_structure/algorithm.py
// frontend 唔再自己跑 M2 algorithm, 改為 fetch backend /api/algorithms/run?algo=hl_structure
// 對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs
// 永久 rule: frontend M2 algorithm 拎走, 改 caller inject backend verdict
// 對應 source: algorithms/AS-03-cycle-detection/modules/hl-structure.ts (656 行, 1:1 port 去 Python)

/**
 * 凡人話: 拎 backend M2 algorithm 嘅 verdict
 * @param klines - K 線 array (frontend 拎到, 傳畀 backend 入面用嚟對齊時間)
 * @param options - 參數 (symbol, period, dataWindowDays, hlsOverrides, etc)
 * @returns backend verdict (verdict.meta 拎 cycle / peaks / troughs / box_boundary / pattern_alert / price_position)
 */
async function analyzeHLStructure(klines, options = {}) {
  const BACKEND_URL = (typeof window !== "undefined" && window.BACKEND_URL) || "http://localhost:18792";
  const symbol = options.code || options.symbol || "UNKNOWN";
  const period = options.period || "1d";
  const dataWindowDays = options.dataWindowDays || 300;  // M2 frontend 默認 300 日 (2026-08-07)

  const url = `${BACKEND_URL}/api/algorithms/run?algo=hl_structure&symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}&data_window_days=${dataWindowDays}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Backend M2 algorithm 拎唔到: ${resp.status} ${resp.statusText}`);
  }
  const verdict = await resp.json();
  if (!verdict.ok) {
    throw new Error(`Backend M2 verdict fail: ${verdict.error || "unknown"}`);
  }
  // backend verdict shape 已經跟 frontend 兼容 (frontend 拎 verdict.meta.* 拎 cycle / peaks / troughs / etc)
  return verdict;
}



function renderHLStructureResult(verdict) {
  const cycleColor = verdict.meta.cycle === 'uptrend' ? '#26BA75' : verdict.meta.cycle === 'downtrend' ? '#EE5151' : '#F39C12';
  const confidencePct = (verdict.meta.confidence * 100).toFixed(0);
  const confidenceExplain = verdict.meta.confidence >= 0.7 ? '高信心, 信號強' : verdict.meta.confidence >= 0.4 ? '中等信心, 信號一般' : '低信心, 信號弱';

  const patternText = {
    'head_and_shoulder': '⚠️ 頭肩頂 (可能見頂)',
    'double_bottom': '✓ 雙底 (可能見底)',
    'double_top': '⚠️ 雙頂 (可能見頂)',
    'none': '無形態預警',
  }[verdict.meta.pattern_alert] || '無形態預警';

  // 📌 判斷 box 詳細解說 (plain language)
  const interpretationDetail = verdict.meta.cycle === 'uptrend' ? `
    <p>📌 <strong>簡單講</strong>: 股票峰谷結構係「越嚟越高」, 即每個 peak 高過上一個 peak (HH), 每個 trough 都高過上一個 trough (HL), 典型上升趨勢嘅結構。</p>
    <p>📊 <strong>咩意思</strong>: 結構分數 ${verdict.meta.structure_score} 反映峰谷上升嘅一致度, 識別咗 ${verdict.meta.peaks.length} 個峰點 + ${verdict.meta.troughs.length} 個谷點, 趨勢結構清晰。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 上升趨勢確認, 可考慮持有 / 逢回調加倉。留意 ${patternText} 嘅預警 — 見頂形態出現要考慮減倉。</p>
  ` : verdict.meta.cycle === 'downtrend' ? `
    <p>📌 <strong>簡單講</strong>: 股票峰谷結構係「越嚟越低」, 即每個 peak 低過上一個 peak (LH), 每個 trough 都低過上一個 trough (LL), 典型下跌趨勢嘅結構。</p>
    <p>📊 <strong>咩意思</strong>: 結構分數 ${verdict.meta.structure_score} 反映峰谷下跌嘅一致度, 識別咗 ${verdict.meta.peaks.length} 個峰點 + ${verdict.meta.troughs.length} 個谷點, 趨勢結構清晰。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 下跌趨勢確認, 觀望 / 減倉。留意 ${patternText} 嘅預警 — 見底形態出現可能係反彈機會。</p>
  ` : `
    <p>📌 <strong>簡單講</strong>: 股票峰谷結構唔係典型嘅多頭或空頭, 峰同谷都喺同一個範圍內, 代表近期股價喺一個箱體入面震盪。</p>
    <p>📊 <strong>咩意思</strong>: 結構分數 ${verdict.meta.structure_score} 反映結構混亂度, 識別咗 ${verdict.meta.peaks.length} 個峰點 + ${verdict.meta.troughs.length} 個谷點, 等待方向確認。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 橫行結構, 等待方向確認。配合 M6 Volatility Squeeze 訊號可以捕捉突破時機; ${patternText} 仍然要留意。</p>
  `;

  return `
    <div class="as03-verdict as03-module-card">
      <div class="module-card-header">
        <h3 class="module-header">📊 高低點結構法 (Peak-Trough Structure)</h3>
      </div>
      <div class="verdict-header">
        <div class="state-pill" style="background: ${cycleColor}">
          <span class="state-label">${verdict.meta.cycle_label}</span>
          <span class="state-code">${verdict.meta.cycle.toUpperCase()}</span>
        </div>
        <div class="confidence">
          <div class="conf-pct">${confidencePct}%</div>
          <div class="conf-label">信心指數 — ${confidenceExplain}</div>
        </div>
        <div class="data-summary">
          <div class="summary-row"><span>峰點:</span> <strong>${verdict.meta.peaks.length}</strong></div>
          <div class="summary-row"><span>谷點:</span> <strong>${verdict.meta.troughs.length}</strong></div>
          <div class="summary-row"><span>結構分數:</span> <strong>${verdict.meta.structure_score}</strong></div>
        </div>
      </div>

      <div class="interpretation">
        <strong>📌 判斷：</strong>${verdict.meta.reason}
        ${interpretationDetail}
      </div>

      ${verdict.meta.box_boundary ? `
      <div class="box-boundary">
        <h4>📦 箱體邊界 (橫行時)</h4>
        <div class="box-grid">
          <div class="box-item"><span class="box-label">上沿</span><span class="box-value">${verdict.meta.box_boundary.top}</span></div>
          <div class="box-item"><span class="box-label">中軸</span><span class="box-value">${verdict.meta.box_boundary.mid}</span></div>
          <div class="box-item"><span class="box-label">下沿</span><span class="box-value">${verdict.meta.box_boundary.bottom}</span></div>
          <div class="box-item"><span class="box-label">箱高 %</span><span class="box-value">${(verdict.meta.box_boundary.height_pct * 100).toFixed(2)}%</span></div>
        </div>
      </div>
      ` : ''}

      <div class="pattern-alert">
        <h4>🔍 形態預警</h4>
        <p class="pattern-text">${patternText}</p>
      </div>

      <div class="position-info">
        <h4>📍 當前價格位置</h4>
        <p>位置: <strong>${verdict.meta.price_position}</strong> · 自適應 Window: ${verdict.meta.adaptive_window} · 動態 Tolerance: ${(verdict.meta.effective_tolerance * 100).toFixed(2)}%</p>
      </div>

      ${renderDetailedExplanation(verdict)}

      ${renderStrategyAdvice(verdict)}

      ${renderUsageGuide(verdict)}

      <details class="meta-details">
        <summary>🔧 技術細節（debug 用）</summary>
        <pre>峰序列趨勢: ${verdict.meta.peak_trend}
谷序列趨勢: ${verdict.meta.trough_trend}
加權結構分數: ${verdict.meta.weighted_structure_score}
基礎信心: ${verdict.meta.base_confidence}
最終信心: ${verdict.meta.confidence}
${verdict.meta.adjustment_log.length > 0 ? '\n調整記錄:\n' + verdict.meta.adjustment_log.map(s => '  • ' + s).join('\n') : ''}</pre>
      </details>
    </div>
  `;
}

// ===== 詳細解讀 section =====
// 用人話逐一解釋 verdict 每個 field 嘅意思
function renderDetailedExplanation(verdict) {
  const confidencePct = (verdict.meta.confidence * 100).toFixed(0);
  const structurePct = (Math.abs(verdict.meta.structure_score) * 100).toFixed(0);
  const structureLabel = verdict.meta.cycle === 'uptrend' ? '上升一致度' : verdict.meta.cycle === 'downtrend' ? '下跌一致度' : '橫行緊密度';

  const peakTrendLabel = {
    'rising': '📈 越嚟越高 (上升中)',
    'falling': '📉 越嚟越低 (下跌中)',
    'flat': '➡️ 差唔多 (橫行中)',
    'mixed': '🌪️ 混合 (冇明確方向)',
  }[verdict.meta.peak_trend] || verdict.meta.peak_trend;

  const troughTrendLabel = {
    'rising': '📈 越嚟越高 (上升中)',
    'falling': '📉 越嚟越低 (下跌中)',
    'flat': '➡️ 差唔多 (橫行中)',
    'mixed': '🌪️ 混合 (冇明確方向)',
  }[verdict.meta.trough_trend] || verdict.meta.trough_trend;

  return `
    <div class="detailed-explanation">
      <h4>📖 詳細解讀 (逐個 field 點樣睇)</h4>
      <table class="explain-table">
        <tr><td class="field-name">📊 cycle (週期類型)</td><td><strong>${verdict.meta.cycle_label}</strong> — ${verdict.meta.cycle === 'uptrend' ? '山頂同山谷一齊越嚟越高' : verdict.meta.cycle === 'downtrend' ? '山頂同山谷一齊越嚟越低' : '山頂山谷塞喺範圍內'}</td></tr>
        <tr><td class="field-name">🎯 confidence (信心指數 ${confidencePct}%)</td><td>${confidencePct >= 70 ? '🟢 高信心 — 判定可靠,可以作參考' : confidencePct >= 50 ? '🟡 中信心 — 有參考價值但要再 confirm' : '🔴 低信心 — 信唔過,等下一個更明顯信號'}</td></tr>
        <tr><td class="field-name">📐 structure_score (${structureLabel} ${structurePct}%)</td><td>${verdict.meta.cycle === 'sideways' ? '越接近 0 越一致,即山頂山谷排列越規律' : '正數 = 一致向上 / 負數 = 一致向下,絕對值越大越穩'}</td></tr>
        <tr><td class="field-name">🏔️ 峰序列趨勢</td><td>${peakTrendLabel} — 比較最近幾個 peak (山頂) 嘅高低</td></tr>
        <tr><td class="field-name">🕳️ 谷序列趨勢</td><td>${troughTrendLabel} — 比較最近幾個 trough (山谷) 嘅高低</td></tr>
        <tr><td class="field-name">📊 峰點 (${verdict.meta.peaks.length} 個)</td><td>識別到嘅山頂,有 confirmed (確認突破) 同 weight (重要性) 標記</td></tr>
        <tr><td class="field-name">📊 谷點 (${verdict.meta.troughs.length} 個)</td><td>識別到嘅山谷,同樣有 confirmed 同 weight</td></tr>
        ${verdict.meta.box_boundary ? `<tr><td class="field-name">📦 箱體邊界</td><td>上沿 ${verdict.meta.box_boundary.top} / 中軸 ${verdict.meta.box_boundary.mid} / 下沿 ${verdict.meta.box_boundary.bottom} — 橫行範圍</td></tr>` : ''}
        <tr><td class="field-name">🔍 形態預警</td><td>${verdict.meta.pattern_alert === 'none' ? '✅ 無特殊形態' : verdict.meta.pattern_alert === 'head_and_shoulder' ? '⚠️ 頭肩頂 — 可能見頂' : verdict.meta.pattern_alert === 'double_bottom' ? '✓ 雙底 — 可能見底' : '⚠️ 雙頂 — 可能見頂'}</td></tr>
        <tr><td class="field-name">📍 當前價格位置</td><td><strong>${verdict.meta.price_position}</strong> — ${verdict.meta.price_position === 'above_peak' ? '升穿最近峰位,突破中' : verdict.meta.price_position === 'below_trough' ? '跌穿最近谷位,下行中' : verdict.meta.price_position === 'between' ? '塞喺峰谷之間' : '已經中斷結構'}</td></tr>
        <tr><td class="field-name">🔧 自適應 Window</td><td>${verdict.meta.adaptive_window} 日 — 根據股價波動自動調,大波動用大 window</td></tr>
        <tr><td class="field-name">📏 動態 Tolerance</td><td>${(verdict.meta.effective_tolerance * 100).toFixed(2)}% — 平股放寬 / 貴股收緊</td></tr>
        <tr><td class="field-name">📅 最新峰谷距今</td><td>${verdict.meta.latest_extreme ? verdict.meta.latest_extreme.days_ago + ' 日' : 'N/A'} — 超過 20 日會打折</td></tr>
      </table>
    </div>
  `;
}

// ===== 策略建議 section =====
// 根據 cycle state + 形態預警 + confidence 建議 action
function renderStrategyAdvice(verdict) {
  const confidencePct = (verdict.meta.confidence * 100).toFixed(0);
  const isHighConf = verdict.meta.confidence >= 0.7;
  const isLowConf = verdict.meta.confidence < 0.5;

  let stateAdvice = '';
  if (verdict.meta.cycle === 'uptrend') {
    stateAdvice = `
      <div class="strategy-up">
        <h4>🟢 上升趨勢 · 策略建議</h4>
        <p><strong>基本動作:</strong>順勢而行,持倉或慢慢加倉</p>
        <p><strong>風險管理:</strong>留意最新 trough 嗰個谷位 ($${verdict.meta.troughs.length > 0 ? verdict.meta.troughs[verdict.meta.troughs.length - 1].close.toFixed(2) : 'N/A'}),如果價跌穿呢個位就可能見頂,要收緊止損</p>
        <p><strong>進場訊號:</strong>如果當前價回調到 trough 附近再反彈,係低吸嘅好時機</p>
        <p><strong>出場訊號:</strong>形態預警 ${verdict.meta.pattern_alert === 'head_and_shoulder' || verdict.meta.pattern_alert === 'double_top' ? '見頂 (頭肩頂/雙頂) — 準備走' : verdict.meta.pattern_alert === 'double_bottom' ? '反而見底訊號 (雙底) — 確認反轉' : '無'}</p>
      </div>
    `;
  } else if (verdict.meta.cycle === 'downtrend') {
    stateAdvice = `
      <div class="strategy-down">
        <h4>🔴 下跌趨勢 · 策略建議</h4>
        <p><strong>基本動作:</strong>避開 / 考慮減倉</p>
        <p><strong>風險管理:</strong>留意最新 peak 嗰個峰位 ($${verdict.meta.peaks.length > 0 ? verdict.meta.peaks[verdict.meta.peaks.length - 1].close.toFixed(2) : 'N/A'}),如果價升穿呢個位就可能要見底,準備止損</p>
        <p><strong>進場訊號:</strong>如果當前價反彈到 peak 附近再回落,係做空嘅機會</p>
        <p><strong>出場訊號:</strong>形態預警 ${verdict.meta.pattern_alert === 'double_bottom' ? '見底 (雙底) — 準備反轉' : verdict.meta.pattern_alert === 'head_and_shoulder' ? '⚠️ 但留意頭肩頂 — 趨勢可能改' : '無'}</p>
      </div>
    `;
  } else {
    const box = verdict.meta.box_boundary;
    stateAdvice = `
      <div class="strategy-sideways">
        <h4>🟡 橫行趨勢 · 策略建議</h4>
        <p><strong>基本動作:</strong>等方向,等突破</p>
        ${box ? `<p><strong>關鍵位:</strong>箱頂 ${box.top} (升穿 = 確認上升) / 箱底 ${box.bottom} (跌穿 = 確認下跌)</p>` : ''}
        <p><strong>進場策略:</strong>唔好喺箱中間進場,等突破後順勢入場 (升穿箱頂做多 / 跌穿箱底做空)</p>
        <p><strong>止損:</strong>如果進場做多但跌返入箱中間,即 false break,止損</p>
        <p><strong>形態預警:</strong>${verdict.meta.pattern_alert === 'none' ? '無特別形態,等方向' : verdict.meta.pattern_alert === 'head_and_shoulder' || verdict.meta.pattern_alert === 'double_top' ? '⚠️ 見頂形態 — 突破向下機會大' : '✓ 見底形態 — 突破向上機會大'}</p>
      </div>
    `;
  }

  // 信心調整建議
  let confidenceNote = '';
  if (isHighConf) {
    confidenceNote = `<p class="confidence-high">💪 信心指數 ${confidencePct}% (高) — 判定可靠,可以作參考落單</p>`;
  } else if (isLowConf) {
    confidenceNote = `<p class="confidence-low">⚠️ 信心指數 ${confidencePct}% (低) — 唔好信,等下一個更明顯訊號</p>`;
  } else {
    confidenceNote = `<p class="confidence-med">🤔 信心指數 ${confidencePct}% (中) — 有參考價值,但要配合其他指標 confirm</p>`;
  }

  return `
    <div class="strategy-advice">
      <h4>🎯 策略建議 (點做)</h4>
      ${stateAdvice}
      ${confidenceNote}
    </div>
  `;
}

// ===== 點用 + 點睇 guide section =====
function renderUsageGuide(verdict) {
  return `
    <div class="usage-guide">
      <h4>💡 點用呢個結果 (點睇)</h4>
      <ol>
        <li><strong>先睇 cycle 同信心</strong> — 個大色塊 (橙=SIDEWAYS / 綠=UP / 紅=DOWN) 同信心百分比 (大數字),呢個係最概要嘅判斷</li>
        <li><strong>再睇形態預警</strong> — 如果有「頭肩頂 / 雙頂」要小心見頂;「雙底」可能要見底</li>
        <li><strong>睇 chart 上面嘅 peak (🔻紅箭嘴) 同 trough (🔺綠箭嘴)</strong> — 視覺化對應返 verdict 嘅 peak/trough 數值,確認算法揾嘅山頂山谷同你肉眼睇嘅一唔一樣</li>
        <li><strong>橫行時睇箱體線</strong> — chart 上面嘅橙色虛線 (頂/中/底) 顯示橫行範圍,睇下當前價喺箱邊個位置</li>
        <li><strong>信心 &lt; 50% 唔好落單</strong> — 寧願等下一個更明顯信號</li>
        <li><strong>配合其他 module 一齊睇</strong> — 揀 AS-03 (umbrella) 同時跑 7 個 module,compare 唔同 module 嘅判斷</li>
        <li><strong>回測用 300+ 日 K 線</strong> — 用更長嘅 data (≥ 300 日) 攞更穩定 verdict</li>
        <li><strong>同一日多股票</strong> — 比較唔同股票嘅 cycle state,搵同板塊同步 / 背馳嘅機會</li>
      </ol>
      <p class="caveat">⚠️ 呢個 module 係輔助工具,唔係 100% 準。永遠配合基本面 / 消息面 / 風險管理一齊用,唔好單靠一個 algorithm 落單。</p>
    </div>
  `;
}

// ===== renderChartOverlay (testing page contract) =====
// 在 K 線圖上面加 peaks/troughs markers + 箱體線 + 形態預警 banner
function renderHLStructureChartOverlay(verdict, klines, chart) {
  if (!chart || !verdict) return;

  // 1. Peaks/Troughs markers (用 lightweight-charts v4.2.3 seriesMarkers API)
  if (chart.chartInstance && typeof chart.chartInstance === 'function') {
    // Skip: chart 已經有 seriesMarkers API call
    return;
  }

  // 直接用 chart object
  if (typeof LightweightCharts === 'undefined') return;

  // 2. 用 v4 createSeriesMarkers
  let series;
  if (chart.candleSeries) {
    series = chart.candleSeries;
  } else {
    // Fallback: 搵 candlestick series
    return;
  }

  if (typeof LightweightCharts.createSeriesMarkers === 'function') {
    const markers = [];
    for (const p of verdict.meta.peaks || []) {
      markers.push({
        time: normalizeTimeForMarker(p.date),
        position: 'aboveBar',
        color: '#EE5151',
        shape: 'arrowDown',
        text: `峰 ${p.close.toFixed(1)}`,
      });
    }
    for (const t of verdict.meta.troughs || []) {
      markers.push({
        time: normalizeTimeForMarker(t.date),
        position: 'belowBar',
        color: '#26BA75',
        shape: 'arrowUp',
        text: `谷 ${t.close.toFixed(1)}`,
      });
    }
    if (markers.length > 0) {
      try {
        LightweightCharts.createSeriesMarkers(series, markers);
      } catch (e) {
        console.warn('[HLStructure] Failed to add markers:', e);
      }
    }
  }

  // 3. 箱體線 (sideways 時)
  if (verdict.meta.box_boundary && chart.priceLines) {
    try {
      chart.priceLines.top = series.createPriceLine({
        price: verdict.meta.box_boundary.top,
        color: '#F39C12', lineWidth: 1, lineStyle: 2,
        axisLabelVisible: true, title: '箱頂',
      });
      chart.priceLines.mid = series.createPriceLine({
        price: verdict.meta.box_boundary.mid,
        color: '#888', lineWidth: 1, lineStyle: 3,
        axisLabelVisible: true, title: '中軸',
      });
      chart.priceLines.bottom = series.createPriceLine({
        price: verdict.meta.box_boundary.bottom,
        color: '#F39C12', lineWidth: 1, lineStyle: 2,
        axisLabelVisible: true, title: '箱底',
      });
    } catch (e) {
      console.warn('[HLStructure] Failed to add box lines:', e);
    }
  }
}

function normalizeTimeForMarker(dateStr) {
  if (typeof dateStr === 'number') return dateStr > 1e12 ? Math.floor(dateStr / 1000) : dateStr;
  if (typeof dateStr === 'string') {
    const ts = Math.floor(new Date(dateStr).getTime() / 1000);
    return ts;
  }
  return null;
}

function getHLStructureHelp() {
  return `
    <h4>高低點結構法 · 第二模組 v0.1.0</h4>
    <p>用道氏理論嘅方法, 搵出股價嘅山頂同山谷, 透過佢哋嘅排列判斷走勢</p>
    <h5>輸入參數</h5>
    <ul>
      <li><strong>基本窗口日數</strong> (5): 搵極值用嘅基本窗口</li>
      <li><strong>最少峰谷對數</strong> (3): 至少要有幾多對先計算</li>
      <li><strong>容忍度</strong> (1.5%): 判斷走勢嘅寬鬆程度</li>
      <li><strong>用波動率自動調窗口</strong> (開): 自動跟據波動調整窗口大細</li>
      <li><strong>突破確認日數</strong> (2): 突破之後等幾日先確認</li>
      <li><strong>時間衰減</strong> (0.03): 舊嘅山頂山谷權重會衰減</li>
    </ul>
    <h5>輸出 (3 種狀態)</h5>
    <ul>
      <li><strong>上升趨勢</strong>: 山頂越來越高, 山谷越來越高</li>
      <li><strong>下跌趨勢</strong>: 山頂越來越低, 山谷越來越低</li>
      <li><strong>橫行</strong>: 喺範圍內上落, 會畀出上沿、中軸、下沿嘅箱體</li>
    </ul>
    <h5>形態預警</h5>
    <ul>
      <li><strong>頭肩頂</strong>: 3 個山頂, 中間嗰個最高</li>
      <li><strong>雙底</strong>: 2 個山谷, 價格差唔多, 中間反彈過</li>
      <li><strong>雙頂</strong>: 2 個山頂, 價格差唔多, 中間回調過</li>
    </ul>
    <p><strong>改進咗咩:</strong> 自動調窗口 · 加權價格 · 突破要確認 · 過濾量能 · 時間越舊影響越細 · 動態容忍度 · 箱體邊界 · 自動搵形態</p>
  `;
}

// 大少 2026-08-11 22:40 — Codebase 註解 Phase 4 partial gap fill
// 對應 modules/hl-structure.ts v1.0.0
// Spec doc: docs/research/AS-03-cycle-detection/MODULE-02-HL-STRUCTURE.md
// Algorithm (M2): 識別極值 (peaks 山頂 + troughs 山谷) + 峰谷趨勢 + 結構分數 + Box boundary + Pattern alert + 價格位置
// 凡人話: 睇山頂山谷排列, 判斷升勢/跌勢/橫行
export const hlStructureAdapter = {
  id: 'AS-03-HL',
  name: '高低點結構法 (山頂山谷排列)',
  version: '0.1.0',
  description: '睇股價一浪一浪嘅山頂同山谷嘅排列, 判斷走勢係升緊、跌緊定橫行, 仲會自動搵頭肩頂、雙底、雙頂呢啲形態出嚟提你',
  // 2026-08-07 — Generic framework support: 移除 hard-code context, 用 contextLines (預設空)
  contextLines: [],
  inputs: [
    {
      key: 'code',
      label: '股票代碼',
      type: 'autocomplete',
      required: true,
      endpoint: '/api/stocks/search',
      queryParam: 'q',
      placeholder: '輸入代碼或名稱（例: 00981 或 中芯）',
      limit: 10,
      marketFn: 'auto',
    },
    {
      key: 'period',
      label: '時間週期',
      type: 'select',
      options: [
        { value: '1d', label: '日線' },
        { value: '1w', label: '週線' },
      ],
      default: '1d',
    },
    {
      key: 'dataWindowDays',
      label: '取數據日數',
      type: 'number',
      default: 300,             // 2026-08-07 — 由 100 改 300 (足夠 3 pairs = 6 alternating 高質量判定)
      min: 90,                  // 2026-08-07 — 由 60 改 90 (最少 90 日先夠 alternating 結構)
      max: 1000,
    },
  ],
  analyze: analyzeHLStructure,
  renderResult: renderHLStructureResult,
  renderChartOverlay: renderHLStructureChartOverlay,
  getHelp: getHLStructureHelp,
};

// =============================================================================
// 2026-08-07 — Module 3 Trendline (趨勢線法) v0.1.0 — 跟 ma-alignment pattern 一致
// =============================================================================
//
// 10 條 rule A-J (port 自 modules/trendline.ts v0.1.0):
//   Step 1 — 數據驗證 (< 30 bars 報錯, 跟 ma-alignment minDataDays 一致)
//   Step 2 — 識別極值點 (peaks + troughs) 用 extremeWindow windowing
//   Step 3 — 動態最優點數 + 簡單 OLS 線性回歸 (support + resistance line)
//   Step 4 — 通道 + %B 計算
//   Step 5 — 觸線統計 (touches) + 突破判定 (breakout)
//   Step 6 — 投影 (projection 5 日)
//   Step 7 — 10 條 rule check (A-J)
//   Step 8 — State derivation (priority H > A > B > F > G > C > D > default SIDEWAYS)
//   Step 9 — Confidence derivation (strong 0.7 / medium 0.5 / weak +0.10 bonus)
//   Step 10 — Evidence + Meta output
//
// 由 Kimi v2.0 docx (RANSAC + 成交量加權 + ATR normalized + R² dynamic + 真假突破 + %B) 簡化:
//   移除: RANSAC / 成交量加權 / ATR 歸一化 / 假突破 multiplier / %B 指標
//   改用: 簡單 OLS 線性回歸 + 10 條 rule (A-J), additive confidence
//   跟 ma-alignment.ts / hl-structure.ts style 一致 (大少 rule-based 風格)

const DEFAULT_TRENDLINE_CONFIG = {
  extremeWindow: 3,
  minLinePoints: 3,
  maxLinePoints: 8,
  minR2: 0.55,
  touchTolerancePct: 0.015,
  breakoutWindow: 5,
  breakoutConfirmDays: 2,
  projectionDays: 5,
  flatSlopeThreshold: 0.001,
  maxExtremeAgeDays: 30,
};

// ===== analyzeTrendline (M3 — 對應 modules/trendline.ts) =====
//
// 大少 2026-08-07 Stage 1 focus — 趨勢線法 (畫線睇走勢)
// 對應 modules/trendline.ts v0.1.0
// Spec doc: docs/research/AS-03-cycle-detection/MODULE-03-TRENDLINE.md
//
// Algorithm (M3):
//   1. 識別極值點 (peaks 高點 + troughs 低點, 用 extremeWindow 預設 3 日)
//   2. Fit 2 條 linear regression line (支持線 + 阻力線, 用 LinearRegression R²)
//   3. R² 過濾 (minR² 0.55, 太低即唔用呢條 line)
//   4. Analyze touches (確認 line 真係 touch 到幾多個極值)
//   5. Detect breakout (跟 breakoutWindow 5 日 + breakoutConfirmDays 2 日確認)
//   6. Derive state (UP/DOWN/SIDEWAYS) + confidence (R² 加權)
//
// 用法 (Usage):
//   await analyzeTrendline(klines, { trendlineConfig: { minR2: 0.55 } }) → trendlineVerdict
//
// Output: { state, confidence, interpretation, evidence, meta: { ... }, _warnings }
//   - state: 'UP' | 'DOWN' | 'SIDEWAYS'
//   - meta.matchedRules: rule IDs (e.g. ['H', 'A', 'I'])
//   - meta.supportLine: { slope, intercept, rSquared, touches }
//   - meta.resistanceLine: { slope, intercept, rSquared, touches }
//   - meta.breakoutStatus: { isBreakout, isConfirmed, pattern }
//   - _warnings: ModuleWarning[] 可能包含 FALLBACK_USED
//
// 對應 module: M3 (Trendline)
// 對應 ts file: algorithms/AS-03-cycle-detection/modules/trendline.ts
// Spec doc: docs/research/AS-03-cycle-detection/MODULE-03-TRENDLINE.md

// ===== analyzeTrendline (M3 — 對應 modules/trendline.ts) — Phase 4 backend fetch stub =====
// 大少 2026-08-20 20:50 Phase 4 — analyzeTrendline 拎走 frontend, 改 fetch backend
// 凡人話: M3 algorithm 完整 (~300 行 + 7 個 helper) 已經 port 去 backend/algorithms/trendline/algorithm.py
// frontend 唔再自己跑 M3 algorithm, 改為 fetch backend /api/algorithms/run?algo=trendline
// 對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs
// 永久 rule: frontend M3 algorithm 拎走, 改 caller inject backend verdict
// 對應 source: algorithms/AS-03-cycle-detection/modules/trendline.ts (742 行, 1:1 port 去 Python)

/**
 * 凡人話: 拎 backend M3 algorithm 嘅 verdict
 * @param klines - K 線 array (frontend 拎到, 傳畀 backend 入面用嚟對齊時間)
 * @param options - 參數 (symbol, period, dataWindowDays, trendlineConfig, etc)
 * @returns backend verdict (verdict.meta 拎 state / confidence / matchedRules / supportLine / resistanceLine / channel / breakout / projection)
 */
async function analyzeTrendline(klines, options = {}) {
  const BACKEND_URL = (typeof window !== "undefined" && window.BACKEND_URL) || "http://localhost:18792";
  const symbol = options.code || options.symbol || "UNKNOWN";
  const period = options.period || "1d";
  const dataWindowDays = options.dataWindowDays || 100;  // M3 frontend 默認 100 日 (2026-08-07)

  const url = `${BACKEND_URL}/api/algorithms/run?algo=trendline&symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}&data_window_days=${dataWindowDays}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Backend M3 algorithm 拎唔到: ${resp.status} ${resp.statusText}`);
  }
  const verdict = await resp.json();
  if (!verdict.ok) {
    throw new Error(`Backend M3 verdict fail: ${verdict.error || "unknown"}`);
  }
  // backend verdict shape 已經跟 frontend 兼容 (frontend 拎 verdict.meta.* 拎 state / confidence / matchedRules / etc)
  return verdict;
}


function renderTrendlineResult(verdict) {
  const stateColors = { UP: '#52c41a', DOWN: '#ff4d4f', SIDEWAYS: '#faad14', TRANSITION: '#722ed1' };
  const stateLabels = { UP: '上升', DOWN: '下跌', SIDEWAYS: '橫行', TRANSITION: '轉折' };
  const color = stateColors[verdict.meta.state] || '#666';
  const stateLabel = stateLabels[verdict.meta.state] || verdict.meta.state;
  const confidencePct = (verdict.meta.confidence * 100).toFixed(1);
  const confidenceExplain = verdict.meta.confidence >= 0.7 ? '高信心, 信號強' : verdict.meta.confidence >= 0.4 ? '中等信心, 信號一般' : '低信心, 信號弱';
  const matchedRules = verdict.meta.meta?.matchedRules || [];
  const evidence = verdict.meta.evidence || [];

  const matchedRulesHtml = matchedRules.length === 0
    ? '<li style="color: #888;">無 rule match</li>'
    : matchedRules.map((rid) => {
        const ev = evidence.find((e) => e.value === rid);
        const strengthClass = ['A', 'B', 'G', 'H'].includes(rid) ? 'strong'
          : ['I', 'J'].includes(rid) ? 'weak'
          : 'medium';
        return `<li class="rule-${strengthClass}"><strong>${rid}</strong> — ${ev ? ev.label : ''} <small>(${strengthClass})</small></li>`;
      }).join('');

  // 📌 解讀 box 詳細解說 (plain language)
  const interpretationDetail = verdict.meta.state === 'UP' ? `
    <p>📌 <strong>簡單講</strong>: 股票喺上升趨勢線通道運行, 每次回調都守住支撐線, 每次反彈都觸及壓力線, 典型上升通道結構。</p>
    <p>📊 <strong>咩意思</strong>: 支撐斜率向上 (${verdict.meta.supportLine?.slope ?? 'N/A'}), R² ${verdict.meta.supportLine?.r2 ?? 'N/A'} 反映擬合度; 通道寬度 ${(verdict.meta.channel?.widthPct * 100).toFixed(2)}%。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 上升趨勢確認, 喺支撐線附近買入 / 壓力線附近減倉係合理策略, 跌破支撐線要小心趨勢反轉。</p>
  ` : verdict.meta.state === 'DOWN' ? `
    <p>📌 <strong>簡單講</strong>: 股票喺下降趨勢線通道運行, 每次反彈都被壓力線壓住, 每次下跌都跌穿前低, 典型下降通道結構。</p>
    <p>📊 <strong>咩意思</strong>: 壓力斜率向下, 通道寬度 ${(verdict.meta.channel?.widthPct * 100).toFixed(2)}%, 趨勢向下穩定。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 下跌趨勢確認, 觀望 / 唔好接刀; 等突破壓力線先考慮撈底。</p>
  ` : verdict.meta.state === 'TRANSITION' ? `
    <p>📌 <strong>簡單講</strong>: 支撐同壓力線都出現真突破訊號, 趨勢可能即將反轉, 需要密切留意後續走勢。</p>
    <p>📊 <strong>咩意思</strong>: 同時觸發多條突破 rules, 趨勢線信號強烈但方向未明, 屬於高風險高回報嘅轉折點。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 等待方向確認, 唔好搶跑; 等 breakout 確認 + 量能配合再入市。</p>
  ` : `
    <p>📌 <strong>簡單講</strong>: 支撐同壓力線都未被有效突破, 股票喺一個橫行範圍內運行, 等待方向確認。</p>
    <p>📊 <strong>咩意思</strong>: 通道寬度 ${(verdict.meta.channel?.widthPct * 100).toFixed(2)}%, 結構混亂, 趨勢線信號唔清晰。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 等待突破方向, 配合 M6 Volatility Squeeze 訊號捕捉突破時機。</p>
  `;

  return `
    <div class="as03-verdict as03-module-card">
      <div class="module-card-header">
        <h3 class="module-header">📈 趨勢線法 (Trendline)</h3>
      </div>
      <div class="verdict-header">
        <div class="state-pill" style="background: ${color}">
          <span class="state-label">${stateLabel}</span>
          <span class="state-code">${verdict.meta.state}</span>
        </div>
        <div class="confidence">
          <div class="conf-pct">${confidencePct}%</div>
          <div class="conf-label">信心指數 — ${confidenceExplain}</div>
        </div>
        <div class="data-summary">
          <div class="summary-row"><span>時間週期:</span> <strong>${verdict.meta.timeframe}</strong></div>
          <div class="summary-row"><span>數據日數:</span> <strong>${verdict.meta.dataDays}</strong></div>
          <div class="summary-row"><span>Matched Rules:</span> <strong>${matchedRules.length}</strong></div>
        </div>
      </div>

      <div class="interpretation">
        <strong>📌 解讀：</strong>${verdict.meta.interpretation}
        ${interpretationDetail}
      </div>

      <div class="trendline-values">
        <h4>當前 Trendline 值</h4>
        <div class="ma-grid">
          <div class="ma-item"><span class="ma-label">支撐斜率</span><span class="ma-value">${verdict.meta.supportLine?.slope ?? 'N/A'}</span></div>
          <div class="ma-item"><span class="ma-label">支撐 R²</span><span class="ma-value">${verdict.meta.supportLine?.r2 ?? 'N/A'}</span></div>
          <div class="ma-item"><span class="ma-label">壓力斜率</span><span class="ma-value">${verdict.meta.resistanceLine?.slope ?? 'N/A'}</span></div>
          <div class="ma-item"><span class="ma-label">壓力 R²</span><span class="ma-value">${verdict.meta.resistanceLine?.r2 ?? 'N/A'}</span></div>
          <div class="ma-item"><span class="ma-label">通道寬度</span><span class="ma-value">${(verdict.meta.channel?.widthPct * 100).toFixed(2)}%</span></div>
          <div class="ma-item"><span class="ma-label">%B</span><span class="ma-value">${verdict.meta.channel?.percentB ?? 'N/A'}</span></div>
        </div>
      </div>

      <div class="matched-rules">
        <h4>🎯 Matched Rules（${matchedRules.length} 條）</h4>
        <ul>${matchedRulesHtml}</ul>
      </div>

      ${renderDetailedExplanationTrendline(verdict)}
      ${renderStrategyAdviceTrendline(verdict)}
      ${renderUsageGuideTrendline(verdict)}

      <details class="meta-details">
        <summary>🔧 配置（debug 用）</summary>
        <pre>${JSON.stringify(verdict.meta.configUsed, null, 2)}</pre>
      </details>
    </div>
  `;
}

// ===== 詳細解讀 section (Trendline) =====
// 大少 #11056 (2026-08-07) — 永久 rule,所有 Module 都要有詳細解讀/策略建議/點用點睇 (用人話)
function renderDetailedExplanationTrendline(verdict) {
  const confidencePct = (verdict.meta.confidence * 100).toFixed(0);
  const matchedRules = verdict.meta.meta?.matchedRules || [];
  const support = verdict.meta.supportLine || {};
  const resistance = verdict.meta.resistanceLine || {};
  const channel = verdict.meta.channel || { widthPct: 0, percentB: 0.5 };
  const breakout = verdict.meta.breakout || { support: { type: 'none' }, resistance: { type: 'none' } };
  const projection = verdict.meta.projection || { days: 0, supportFuture: 0, resistanceFuture: 0, midFuture: 0 };

  // 通道寬度 label
  const widthPct = (channel.widthPct * 100).toFixed(2);
  const channelLabel = channel.widthPct < 0.03 ? '窄通道 (鱷魚線貼住,準備爆邊)'
    : channel.widthPct < 0.10 ? '中等通道 (有波動但唔算大)'
    : '寬通道 (波動大,通道寬闊)';

  // %B 位置 label
  const pb = channel.percentB;
  const pbLabel = pb < 0.2 ? '貼近支撐 (有機會反彈)'
    : pb < 0.4 ? '通道下半 (偏多)'
    : pb < 0.6 ? '通道中間 (中性)'
    : pb < 0.8 ? '通道上半 (偏空)'
    : '貼近壓力 (有機會回落)';

  // R² label
  const r2Label = (r2) => r2 >= 0.8 ? '高 (線好直,趨勢明顯)'
    : r2 >= 0.55 ? '中 (線 OK,趨勢算清晰)'
    : '低 (線散亂,趨勢唔穩)';

  // Slope 方向 label
  const slopeLabel = (slope) => slope > 0.001 ? '向上 (升)'
    : slope < -0.001 ? '向下 (跌)'
    : '平 (橫)';

  // Breakout label
  const supportBR = breakout.support;
  const resistBR = breakout.resistance;
  const supportBRLabel = supportBR.type === 'true' ? `🔴 真跌破 ${supportBR.daysSince} 日前 — 短期跌穿支撐`
    : supportBR.type === 'false' ? `🟡 假跌破 (試咗但彈返) — 支撐仲有效`
    : '🟢 無跌破 — 支撐仲守住';
  const resistBRLabel = resistBR.type === 'true' ? `🟢 真突破 ${resistBR.daysSince} 日前 — 短期升穿壓力`
    : resistBR.type === 'false' ? `🟡 假突破 (試咗但跌返) — 壓力仲有效`
    : '🔴 無突破 — 壓力仲守住';

  // 老化 label
  const age = verdict.meta.latestExtremeAge;
  const ageLabel = age < 0 ? 'N/A (冇足夠 extreme points)'
    : age <= 10 ? `${age} 日前 (新,信號可靠)`
    : age <= 30 ? `${age} 日前 (中等,可信)`
    : `${age} 日前 (老化,信號折扣)`;

  return `
    <div class="detailed-explanation">
      <h4>📖 詳細解讀 (逐個 field 點樣睇)</h4>
      <table class="explain-table">
        <tr><td class="field-name">📊 state (週期類型)</td><td><strong>${verdict.meta.state}</strong> — ${verdict.meta.state === 'UP' ? '上升趨勢, 支撐線向上傾' : verdict.meta.state === 'DOWN' ? '下跌趨勢, 壓力線向下傾' : verdict.meta.state === 'TRANSITION' ? '短線反轉, 支撐同壓力都被真突破' : '橫行, 通道窄 / 收斂 / 觸線但無突破'}</td></tr>
        <tr><td class="field-name">🎯 confidence (信心指數 ${confidencePct}%)</td><td>${confidencePct >= 70 ? '🟢 高信心 — 判定可靠, 可以作參考' : confidencePct >= 50 ? '🟡 中信心 — 有參考價值, 配合其他指標 confirm' : '🔴 低信心 — 信唔過, 等下一個更明顯訊號'}</td></tr>
        <tr><td class="field-name">📐 支撐線斜率 (${support.slope?.toFixed(4) ?? 'N/A'})</td><td>${slopeLabel(support.slope || 0)} — 斜率 = 線每升 1 日, 價變幾多。0 以上代表線向上, 0 以下代表線向下</td></tr>
        <tr><td class="field-name">📐 支撐線 R² (${support.r2?.toFixed(3) ?? 'N/A'})</td><td>${r2Label(support.r2 || 0)} — 1.0 = 完美直線, 0 = 完全散亂。≥0.55 先算有趨勢</td></tr>
        <tr><td class="field-name">📐 壓力線斜率 (${resistance.slope?.toFixed(4) ?? 'N/A'})</td><td>${slopeLabel(resistance.slope || 0)} — 同上, 0 以上升 / 0 以下跌</td></tr>
        <tr><td class="field-name">📐 壓力線 R² (${resistance.r2?.toFixed(3) ?? 'N/A'})</td><td>${r2Label(resistance.r2 || 0)} — 同支撐 R² 解讀</td></tr>
        <tr><td class="field-name">📦 通道寬度 (${widthPct}%)</td><td>${channelLabel} — 通道闊 = 波動大 / 通道窄 = 準備爆邊 (上 / 下)</td></tr>
        <tr><td class="field-name">📍 %B 位置 (${pb.toFixed(2)})</td><td>${pbLabel} — 0 = 貼住支撐 / 1 = 貼住壓力 / 0.5 = 中位。睇下當前價喺通道邊個位置</td></tr>
        <tr><td class="field-name">🔻 支撐突破狀態</td><td>${supportBRLabel}</td></tr>
        <tr><td class="field-name">🔺 壓力突破狀態</td><td>${resistBRLabel}</td></tr>
        <tr><td class="field-name">📅 觸發 rules (${matchedRules.length} 條)</td><td>${matchedRules.length === 0 ? '無 rule 觸發, 預設 SIDEWAYS' : matchedRules.map(r => `<strong>${r}</strong> — ${renderTrendlineRuleExplain(r)}`).join(' / ')}</td></tr>
        <tr><td class="field-name">🔮 5 日投影</td><td>支撐 <strong>${projection.supportFuture?.toFixed(2) ?? 'N/A'}</strong> / 中位 <strong>${projection.midFuture?.toFixed(2) ?? 'N/A'}</strong> / 壓力 <strong>${projection.resistanceFuture?.toFixed(2) ?? 'N/A'}</strong> — 假設趨勢不變, 5 日後嘅線應該喺呢個位</td></tr>
        <tr><td class="field-name">⏰ 最新極值點距今</td><td>${ageLabel}</td></tr>
        <tr><td class="field-name">🤚 支撐觸線 (${support.touches ?? 0} 次)</td><td>${(support.touches ?? 0) >= 2 ? `${support.touches} 次反彈, 平均反彈 ${((support.avgBouncePct ?? 0) * 100).toFixed(2)}% — 支撐有實力` : `得 ${support.touches ?? 0} 次觸線, 支撐未算被驗證`}</td></tr>
        <tr><td class="field-name">🤚 壓力觸線 (${resistance.touches ?? 0} 次)</td><td>${(resistance.touches ?? 0) >= 2 ? `${resistance.touches} 次回落, 平均回落 ${((resistance.avgBouncePct ?? 0) * 100).toFixed(2)}% — 壓力有實力` : `得 ${resistance.touches ?? 0} 次觸線, 壓力未算被驗證`}</td></tr>
      </table>
    </div>
  `;
}

// 10 條 rule 嘅用人話解釋 (跟 ma-alignment pattern 一致)
function renderTrendlineRuleExplain(rid) {
  const explains = {
    'A': '支撐線上升 (每個 trough 都越嚟越高)',
    'B': '壓力線下降 (每個 peak 都越嚟越低)',
    'C': '通道窄 + 中位 — 鱷魚線收埋, 準備爆邊',
    'D': '收斂三角形 — 支撐升 + 壓力跌, 兩線向中靠攏',
    'E': '上升楔形 — 支撐升 + 壓力平, 短線向上但通道越嚟越窄',
    'F': '下降楔形 — 支撐平 + 壓力跌, 短線向下但通道越嚟越窄',
    'G': '真跌破支撐 — 5 日內 close 跌穿, 之後 stay below 2+ 日',
    'H': '真突破壓力 — 5 日內 close 升穿, 之後 stay above 2+ 日',
    'I': '支撐有效 — 觸線 ≥2 次 + 反彈 ≥1%, 支撐有實力',
    'J': '壓力有效 — 觸線 ≥2 次 + 回落 ≥1%, 壓力有實力',
  };
  return explains[rid] || rid;
}

// ===== 策略建議 section (Trendline) =====
// 根據 state + confidence + channel + breakout 建議 action
function renderStrategyAdviceTrendline(verdict) {
  const confidencePct = (verdict.meta.confidence * 100).toFixed(0);
  const isHighConf = verdict.meta.confidence >= 0.7;
  const isLowConf = verdict.meta.confidence < 0.5;
  const support = verdict.meta.supportLine || {};
  const resistance = verdict.meta.resistanceLine || {};
  const channel = verdict.meta.channel || { widthPct: 0, percentB: 0.5 };
  const pb = channel.percentB || 0.5;

  let stateAdvice = '';
  if (verdict.meta.state === 'UP') {
    stateAdvice = `
      <div class="strategy-up">
        <h4>🟢 上升趨勢 · 策略建議</h4>
        <p><strong>基本動作:</strong> 順勢而行, 持倉或慢慢加倉</p>
        <p><strong>進場策略:</strong> 等回調到支撐線附近 (${support.currentValue?.toFixed(2) ?? 'N/A'}) 再反彈, 呢個係低吸嘅好時機 (pullback entry)</p>
        <p><strong>風險管理:</strong> 留意支撐線位置 ($${support.currentValue?.toFixed(2) ?? 'N/A'}), 如果價跌穿支撐線 (尤其 R 真跌破) 即停損 / 走人</p>
        <p><strong>目標位:</strong> 壓力線 ($${resistance.currentValue?.toFixed(2) ?? 'N/A'}) — 升到壓力線附近留意會唔會被壓返落嚟</p>
        <p><strong>留意警號:</strong> 如果 H+G 同時出現 (上升線跌破 + 上升壓力線突破) → TRANSITION, 短期見頂, 收緊止損</p>
      </div>
    `;
  } else if (verdict.meta.state === 'DOWN') {
    stateAdvice = `
      <div class="strategy-down">
        <h4>🔴 下跌趨勢 · 策略建議</h4>
        <p><strong>基本動作:</strong> 避開 / 考慮減倉, 唔好接刀</p>
        <p><strong>進場策略:</strong> 如果要做空, 等反彈到壓力線 ($${resistance.currentValue?.toFixed(2) ?? 'N/A'}) 附近再回落, 確認受壓</p>
        <p><strong>風險管理:</strong> 留意壓力線位置, 如果真突破 (H rule) 即停損空單, 可能見底</p>
        <p><strong>目標位:</strong> 支撐線 ($${support.currentValue?.toFixed(2) ?? 'N/A'}) — 跌到支撐線附近留意會唔會彈返</p>
      </div>
    `;
  } else if (verdict.meta.state === 'TRANSITION') {
    stateAdvice = `
      <div class="strategy-transition">
        <h4>🟣 短線反轉 (TRANSITION) · 策略建議</h4>
        <p><strong>基本動作:</strong> 暫時 hold, 等下個確認信號</p>
        <p><strong>訊號確認:</strong> H+G 同時觸發, 代表支撐同壓力線都出現真突破 — 趨勢可能反轉</p>
        <p><strong>進場策略:</strong> 唔好喺 TRANSITION 狀態下新單落場, 等 5-7 日新方向確認 (連續幾日同方向) 先做</p>
        <p><strong>風險:</strong> TRANSITION 失敗可能係假突破, 確認返之前嘅趨勢可能再返嚟, 要小心</p>
    `;
  } else { // SIDEWAYS
    let pbAdvice = '';
    if (pb < 0.3) {
      pbAdvice = `<p><strong>當前位置:</strong> %B = ${pb.toFixed(2)} — 接近支撐線 ($${support.currentValue?.toFixed(2) ?? 'N/A'}), 可以嘗試低吸 (但要設窄止損)</p>`;
    } else if (pb > 0.7) {
      pbAdvice = `<p><strong>當前位置:</strong> %B = ${pb.toFixed(2)} — 接近壓力線 ($${resistance.currentValue?.toFixed(2) ?? 'N/A'}), 唔好追高 (回調風險大)</p>`;
    } else {
      pbAdvice = `<p><strong>當前位置:</strong> %B = ${pb.toFixed(2)} — 通道中間, 唔好喺中間落場, 等到接近 support ($${support.currentValue?.toFixed(2) ?? 'N/A'}) 或 resistance ($${resistance.currentValue?.toFixed(2) ?? 'N/A'}) 先做</p>`;
    }
    stateAdvice = `
      <div class="strategy-sideways">
        <h4>🟡 橫行趨勢 · 策略建議</h4>
        <p><strong>基本動作:</strong> 等方向, 等突破</p>
        <p><strong>關鍵位:</strong> 上沿 = 壓力線 ($${resistance.currentValue?.toFixed(2) ?? 'N/A'}) / 下沿 = 支撐線 ($${support.currentValue?.toFixed(2) ?? 'N/A'})</p>
        ${pbAdvice}
        <p><strong>進場策略:</strong> 唔好喺通道中間進場, 等突破 (H 真突破壓力 → 做多) 或 (G 真跌破支撐 → 做空) 先做</p>
        <p><strong>止損:</strong> 如果做多後跌返通道, 即 false break, 止損走人</p>
        <p><strong>特別注意:</strong> 通道窄 (widthPct < 3%) 嘅橫行, 鱷魚線收埋, 隨時大爆邊, 要密切留意</p>
      </div>
    `;
  }

  // 信心調整建議
  let confidenceNote = '';
  if (isHighConf) {
    confidenceNote = `<p class="confidence-high">💪 信心指數 ${confidencePct}% (高) — 判定可靠, 可以作參考落單</p>`;
  } else if (isLowConf) {
    confidenceNote = `<p class="confidence-low">⚠️ 信心指數 ${confidencePct}% (低) — 唔好信, 等下一個更明顯訊號</p>`;
  } else {
    confidenceNote = `<p class="confidence-med">🤔 信心指數 ${confidencePct}% (中) — 有參考價值, 但要配合其他指標 confirm</p>`;
  }

  return `
    <div class="strategy-advice">
      <h4>🎯 策略建議 (點做)</h4>
      ${stateAdvice}
      ${confidenceNote}
      <p class="caveat">⚠️ 觸發 ${(verdict.meta.meta?.matchedRules || []).length} 條 rule, 每條 rule 嘅具體解釋睇「📖 詳細解讀」section</p>
    </div>
  `;
}

// ===== 點用 + 點睇 guide section (Trendline) =====
function renderUsageGuideTrendline(verdict) {
  return `
    <div class="usage-guide">
      <h4>💡 點用呢個結果 (點睇)</h4>
      <ol>
        <li><strong>先睇 state 同信心</strong> — 個大色塊 (綠=UP / 紅=DOWN / 橙=SIDEWAYS / 紫=TRANSITION) 同信心百分比, 呢個係最概要嘅判斷</li>
        <li><strong>睇「觸發 rule」嗰行</strong> — 例如「A」= 支撐線上升 (上升趨勢), 「G」= 真跌破支撐 (見底訊號), 「H」= 真突破壓力 (見頂訊號)。每條 rule 都有具體意思, 睇「📖 詳細解讀」section</li>
        <li><strong>睇 chart 上面嘅 2 條 trend line</strong> — 🟢 綠色 = 支撐線 / 🔴 紅色 = 壓力線。睇下當前價喺兩線之間嘅邊個位置 (用 %B 量化)</li>
        <li><strong>留意 R² 數值</strong> — ≥ 0.8 = 線好直, 趨勢可信 / 0.55-0.8 = OK / &lt; 0.55 = 線散亂, 趨勢唔穩, 唔好用</li>
        <li><strong>留意通道寬度</strong> — &lt; 3% = 鱷魚線收埋, 準備爆邊 (上或下) / 3-10% = 中等 / &gt; 10% = 波動大, 通道闊</li>
        <li><strong>留意突破狀態</strong> — 短期如果真跌破支撐 (G) 或真突破壓力 (H), 即趨勢可能反轉, 立即 review 你嘅持倉</li>
        <li><strong>信心 &lt; 50% 唔好落單</strong> — 寧願等下一個更明顯信號</li>
        <li><strong>配合其他 module 一齊睇</strong> — 同時跑 MA alignment / HL structure, compare 唔同 module 嘅判斷。3 個 module 一齊睇先至穩陣</li>
        <li><strong>永遠配合風險管理</strong> — 呢個 module 嘅策略建議只係 reference, 落單前要自己再睇下基本面 / 消息面 / 板塊走勢</li>
      </ol>
      <p class="caveat">⚠️ 呢個 module 係輔助工具, 唔係 100% 準。永遠配合基本面 / 消息面 / 風險管理一齊用, 唔好單靠一個 algorithm 落單。</p>
    </div>
  `;
}

// ===== Trendline chart overlay (testing page contract) =====
// 喺 chart 上面加 support line + resistance line (2 條 trend line)
// 從 verdict.meta.supportLine / resistanceLine 嘅 intercept + slope 計算每個 bar 嘅 value
// 跟 stockpulse testing page 嘅 renderChartOverlay contract 一致
function _trendlineNormalizeTime(t) {
  if (typeof t === 'number') return t > 1e12 ? Math.floor(t / 1000) : t;
  if (typeof t === 'string') return Math.floor(new Date(t).getTime() / 1000);
  return null;
}

function _computeTrendlineSeries(klines, line) {
  // line = { slope, intercept, numPoints }  ← 從 verdict.meta.meta 取
  if (!line || typeof line.slope !== 'number' || typeof line.intercept !== 'number') {
    return [];
  }
  const out = [];
  // 線只覆蓋 line.usedPoints 範圍, 但我哋 fit 嘅 usedPoints 唔喺 verdict meta 內
  // 所以用支持/壓力線 喺每個 bar 嘅 value 算
  for (let i = 0; i < klines.length; i++) {
    const time = _trendlineNormalizeTime(klines[i].time ?? klines[i].timestamp ?? klines[i].date);
    if (time == null) continue;
    const value = line.intercept + line.slope * i;
    out.push({ time, value });
  }
  out.sort((a, b) => a.time - b.time);
  const dedup = [];
  for (let i = 0; i < out.length; i++) {
    if (i === 0 || out[i].time !== out[i - 1].time) dedup.push(out[i]);
  }
  return dedup;
}

function renderTrendlineChartOverlay(verdict, klines, chartRefs) {
  if (!chartRefs || !chartRefs.chart) {
    console.warn('[renderTrendlineChartOverlay] chartRefs.chart 缺失');
    return;
  }
  if (!verdict || !verdict.meta.meta) {
    console.warn('[renderTrendlineChartOverlay] verdict 缺失');
    return;
  }
  if (!Array.isArray(klines) || klines.length === 0) {
    console.warn('[renderTrendlineChartOverlay] klines 缺失或空');
    return;
  }
  const support = verdict.meta.supportLine;
  const resistance = verdict.meta.resistanceLine;
  if (!support || !resistance) {
    console.warn('[renderTrendlineChartOverlay] verdict.meta.meta 冇 supportLine/resistanceLine (可能係 fallback SIDEWAYS)');
    return;
  }

  const chart = chartRefs.chart;
  if (typeof chart.addSeries !== 'function') {
    console.error('[renderTrendlineChartOverlay] chart 冇 addLineSeries method');
    return;
  }

  // 移除舊 trendline series
  if (chartRefs.trendlineLineSeries) {
    for (const key of Object.keys(chartRefs.trendlineLineSeries)) {
      try { chart.removeSeries(chartRefs.trendlineLineSeries[key]); } catch (e) { /* ignore */ }
    }
  }
  chartRefs.trendlineLineSeries = {};

  // Support line (綠)
  try {
    const supportSeries = _computeTrendlineSeries(klines, support);
    if (supportSeries.length > 0) {
      const s = chart.addSeries(LightweightCharts.LineSeries, {
        color: '#2ecc71',
        lineWidth: 2,
        title: '支撐線',
        priceLineVisible: false,
        lastValueVisible: true,
      });
      s.setData(supportSeries);
      chartRefs.trendlineLineSeries.support = s;
    }
  } catch (e) {
    console.error('[renderTrendlineChartOverlay] support line 失敗:', e);
  }

  // Resistance line (紅)
  try {
    const resistanceSeries = _computeTrendlineSeries(klines, resistance);
    if (resistanceSeries.length > 0) {
      const s = chart.addSeries(LightweightCharts.LineSeries, {
        color: '#e74c3c',
        lineWidth: 2,
        title: '壓力線',
        priceLineVisible: false,
        lastValueVisible: true,
      });
      s.setData(resistanceSeries);
      chartRefs.trendlineLineSeries.resistance = s;
    }
  } catch (e) {
    console.error('[renderTrendlineChartOverlay] resistance line 失敗:', e);
  }
}

function getTrendlineHelp() {
  return `
    <h4>趨勢線法 · 10 條規則 (A 到 J)</h4>
    <ul>
      <li><strong>A</strong> (強): 支撐線上升 + 吻合度 ≥ 0.55 → 上升趨勢</li>
      <li><strong>B</strong> (強): 壓力線下降 + 吻合度 ≥ 0.55 → 下跌趨勢</li>
      <li><strong>C</strong> (中): 通道窄 (3% 之內) + 中位 (位置 0.4-0.6) → 橫行</li>
      <li><strong>D</strong> (中): 收斂三角形 (支撐升 + 壓力跌) → 橫行</li>
      <li><strong>E</strong> (中): 上升楔形 (支撐升 + 壓力平) → 上升</li>
      <li><strong>F</strong> (中): 下降楔形 (支撐平 + 壓力跌) → 下跌</li>
      <li><strong>G</strong> (強): 真跌破支撐 (5 日內穿越 + 連續 2 日喺下面) → 下跌</li>
      <li><strong>H</strong> (強): 真突破壓力 (5 日內穿越 + 連續 2 日喺上面) → 上升</li>
      <li><strong>I</strong> (弱): 支撐有效 (觸線 2 次以上 + 反彈 1% 以上) → 信心 +0.10</li>
      <li><strong>J</strong> (弱): 壓力有效 (觸線 2 次以上 + 回調 1% 以上) → 信心 +0.10</li>
    </ul>
    <p><strong>規則優先順序:</strong> H+G → 轉勢 · H → A → B → F → G → C/D → 默認 橫行</p>
    <p><strong>信心分數:</strong> 強 0.7, 中 0.5, 弱 加 0.10 分, 最高 1.0</p>
    <p><strong>簡化咗:</strong> 唔再用進階嘅亂數算法, 改用簡單嘅線性回歸計趨勢線</p>
  `;
}

// 大少 2026-08-11 22:40 — Codebase 註解 Phase 4 partial gap fill
// 對應 modules/trendline.ts v1.0.0
// Spec doc: docs/research/AS-03-cycle-detection/MODULE-03-TRENDLINE.md
// Algorithm (M3): 線性回歸計趨勢線 + 突破/跌破信號 + 動態時間窗口 + 趨勢線強度評分
// 凡人話: 自動畫趨勢線, 突破/跌破就出信號
export const trendlineAdapter = {
  id: 'AS-03-TL',
  name: '趨勢線法 (畫線睇走勢)',
  version: '0.1.0',
  description: '用 10 條規則畫出股票嘅趨勢線 (支撐線、壓力線), 判斷走勢係上升、下降、橫行定反轉',
  contextLines: [],
  inputs: [
    {
      key: 'code',
      label: '股票代碼',
      type: 'autocomplete',
      required: true,
      endpoint: '/api/stocks/search',
      queryParam: 'q',
      placeholder: '輸入代碼或名稱（例: 00981 或 中芯）',
      limit: 10,
      marketFn: 'auto',
    },
    {
      key: 'period',
      label: '時間週期',
      type: 'select',
      options: [
        { value: '1d', label: '日線' },
        { value: '1w', label: '週線' },
      ],
      default: '1d',
    },
    {
      key: 'dataWindowDays',
      label: '取數據日數',
      type: 'number',
      default: 100,
      min: 30,
      max: 500,
    },
  ],
  analyze: analyzeTrendline,
  renderResult: renderTrendlineResult,
  renderChartOverlay: renderTrendlineChartOverlay,
  getHelp: getTrendlineHelp,
};

// ===== Module 4: 動能背馳與衰竭檢測法 (Indicators) v1.0.0 =====
// 大少 + MiniMax Code 2026-08-07
// 跟 docx `docs/演算法概念SPECS/04動能背馳與衰竭檢測法.docx` v1.0 (Kimi spec)
// Spec: docs/research/AS-03-cycle-detection/MODULE-04-MOMENTUM-DIVERGENCE.md
//
// 跟其他 module pattern 一致 (.ts file 係 source of truth + test, .mjs file 係
// browser-compatible port)。Indicators.ts 用 TypeScript class,呢度 port 落 pure JS
// function-based,行為完全一致 (T1-T14 全部 36 assertions pass)。

// ===== analyzeIndicators (M4 — 對應 modules/indicators.ts) — Phase 5 backend fetch stub =====
// 大少 2026-08-20 21:10 Phase 5 — analyzeIndicators 拎走 frontend, 改 fetch backend
// 凡人話: M4 algorithm 完整 (~758 行, RSI + MACD + 背馳 + 衰竭) 已經 port 去 backend/algorithms/indicators/algorithm.py
// frontend 唔再自己跑 M4 algorithm, 改為 fetch backend /api/algorithms/run?algo=indicators
// 對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs
// 永久 rule: frontend M4 algorithm 拎走, 改 caller inject backend verdict
// 對應 source: algorithms/AS-03-cycle-detection/modules/indicators.ts (758 行, 1:1 port 去 Python)

/**
 * 凡人話: 拎 backend M4 algorithm 嘅 verdict
 * @param klines - K 線 array (frontend 拎到, 傳畀 backend 入面用嚟對齊時間)
 * @param options - 參數 (symbol, period, dataWindowDays, indicatorsConfig, etc)
 * @returns backend verdict (verdict.meta 拎 state / confidence / signal / momentumState / divergence / winProbability / rsiSeries / macdSeries)
 */
async function analyzeIndicators(klines, options = {}) {
  const BACKEND_URL = (typeof window !== "undefined" && window.BACKEND_URL) || "http://localhost:18792";
  const symbol = options.code || options.symbol || "UNKNOWN";
  const period = options.period || "1d";
  const dataWindowDays = options.dataWindowDays || 100;  // M4 frontend 默認 100 日 (2026-08-07)

  const url = `${BACKEND_URL}/api/algorithms/run?algo=indicators&symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}&data_window_days=${dataWindowDays}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Backend M4 algorithm 拎唔到: ${resp.status} ${resp.statusText}`);
  }
  const verdict = await resp.json();
  if (!verdict.ok) {
    throw new Error(`Backend M4 verdict fail: ${verdict.error || "unknown"}`);
  }
  // backend verdict shape 已經跟 frontend 兼容 (frontend 拎 verdict.meta.* 拎 state / confidence / signal / rsiSeries / etc)
  return verdict;
}

function renderIndicatorsResult(verdict) {
  const stateColors = { UP: '#52c41a', DOWN: '#ff4d4f', SIDEWAYS: '#faad14', TRANSITION: '#722ed1' };
  const stateLabels = { UP: '上升', DOWN: '下跌', SIDEWAYS: '橫行', TRANSITION: '轉折' };
  const color = stateColors[verdict.meta.state] || '#666';
  const stateLabel = stateLabels[verdict.meta.state] || verdict.meta.state;
  const confidencePct = (verdict.meta.confidence * 100).toFixed(1);
  const confidenceExplain = verdict.meta.confidence >= 0.7 ? '高信心, 信號強' : verdict.meta.confidence >= 0.4 ? '中等信心, 信號一般' : '低信心, 信號弱';
  const signal = verdict.meta.meta?.signal || { type: 'hold', strength: 0, action: '觀望', reasons: [] };
  const ms = verdict.meta.meta?.momentumState || {};
  const div = verdict.meta.meta?.divergence || { totalCount: 0 };

  const actionColor = signal.type === 'buy' ? '#52c41a' : signal.type === 'sell' ? '#ff4d4f' : '#faad14';
  const actionEmoji = signal.type === 'buy' ? '🟢' : signal.type === 'sell' ? '🔴' : '🟡';

  const reasonsHtml = signal.reasons && signal.reasons.length > 0
    ? signal.reasons.map(r => `<li>${r}</li>`).join('')
    : '<li style="color: #888;">無觸發條件 (hold / 觀望)</li>';

  // 📌 解讀 + 觀望 box 詳細解說 (plain language)
  const signalStrengthPct = (signal.strength * 100).toFixed(0);
  const winProbPct = ((verdict.meta.meta?.winProbability || 0.5) * 100).toFixed(0);
  const interpretationDetail = signal.type === 'buy' ? `
    <p>📌 <strong>簡單講</strong>: RSI 同 MACD 兩條動能指標都出現買入訊號, 識別到 ${div.totalCount} 個背馳/衰竭點, 動能確認向上。</p>
    <p>📊 <strong>咩意思</strong>: RSI(14) = ${(ms.rsi ?? 0).toFixed(2)} (${ms.isOverbought ? '超買區' : ms.isOversold ? '超賣區' : '中性區'}), MACD 柱狀體 = ${(ms.macd ?? 0).toFixed(4)} (${ms.macdState || 'N/A'})。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 動能向上確認, 高勝率買入時機, 可考慮入市, 但留意 RSI 超買可能係短期見頂警號, 配合 M1 MA 確認大方向 + M5 量价確認資金跟進。</p>
  ` : signal.type === 'sell' ? `
    <p>📌 <strong>簡單講</strong>: RSI 同 MACD 都出現賣出訊號, 識別到 ${div.totalCount} 個背馳/衰竭點, 動能確認向下。</p>
    <p>📊 <strong>咩意思</strong>: RSI(14) = ${(ms.rsi ?? 0).toFixed(2)} (${ms.isOverbought ? '超買區' : ms.isOversold ? '超賣區' : '中性區'}), MACD 柱狀體 = ${(ms.macd ?? 0).toFixed(4)} (${ms.macdState || 'N/A'})。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 動能向下確認, 觀望 / 減倉, 配合 M1 MA 確認下跌趨勢 + M2 HL 確認結構轉弱。</p>
  ` : `
    <p>📌 <strong>簡單講</strong>: RSI 同 MACD 都冇明確買入或賣出訊號, 動能中性, 識別到 ${div.totalCount} 個背馳/衰竭點 (如果有)。</p>
    <p>📊 <strong>咩意思</strong>: RSI(14) = ${(ms.rsi ?? 0).toFixed(2)} (${ms.isOverbought ? '超買區' : ms.isOversold ? '超賣區' : '中性區'}), MACD 柱狀體 = ${(ms.macd ?? 0).toFixed(4)} (${ms.macdState || 'N/A'})。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 動能中性, 等待方向確認。背馳點出現時要特別留意, 可能係見頂 / 見底嘅早期警號, 配合 M1 MA 確認大方向。</p>
  `;
  const signalBoxDetail = signal.type === 'hold' ? `
    <p>💡 <strong>訊號強度 ${signalStrengthPct}% 點解?</strong> 訊號強度反映 10 條 buy/sell rules 嘅觸發數量同權重, 0% = 完全冇 rules 觸發, 100% = 全部 rules 觸發。強度越高, 信號越強, 越值得參考。</p>
    <p>💡 <strong>勝率估算 ${winProbPct}% 點嚟?</strong> 勝率估算係根據 RSI + MACD 狀態 (超買/超賣/中性) 同歷史 backtest 統計得出嘅歷史勝率, 代表同類訊號過去嘅表現, 唔係未來保證。</p>
  ` : `
    <p>💡 <strong>訊號強度 ${signalStrengthPct}% 點解?</strong> 訊號強度反映 10 條 buy/sell rules 嘅觸發數量同權重, ${signalStrengthPct}% = ${signal.reasons.length} 條 rules 觸發嘅綜合分數。</p>
    <p>💡 <strong>勝率估算 ${winProbPct}% 點嚟?</strong> 勝率估算係根據 RSI + MACD 狀態 (超買/超賣/中性) 同歷史 backtest 統計得出, ${winProbPct}% 代表同類訊號過去嘅平均勝率, 唔係未來保證。</p>
  `;

  return `
    <div class="as03-verdict as03-module-card">
      <div class="module-card-header">
        <h3 class="module-header">⚡ 動能背馳與衰竭檢測法 (Indicators)</h3>
      </div>
      <div class="verdict-header">
        <div class="state-pill" style="background: ${color}">
          <span class="state-label">${stateLabel}</span>
          <span class="state-code">${verdict.meta.state}</span>
        </div>
        <div class="confidence">
          <div class="conf-pct">${confidencePct}%</div>
          <div class="conf-label">信心指數 — ${confidenceExplain}</div>
        </div>
        <div class="data-summary">
          <div class="summary-row"><span>時間週期:</span> <strong>${verdict.meta.timeframe}</strong></div>
          <div class="summary-row"><span>數據日數:</span> <strong>${verdict.meta.meta?.dataDays || 0}</strong></div>
          <div class="summary-row"><span>背馳數:</span> <strong>${div.totalCount}</strong></div>
        </div>
      </div>

      <div class="interpretation">
        <strong>📌 解讀：</strong>${verdict.meta.interpretation}
        ${interpretationDetail}
      </div>

      <div class="indicators-signal" style="background: ${actionColor}22; border-left: 4px solid ${actionColor}; padding: 12px; margin: 12px 0; border-radius: 4px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="font-size: 28px;">${actionEmoji}</div>
          <div>
            <div style="font-size: 18px; font-weight: bold; color: ${actionColor};">${signal.action || '觀望'}</div>
            <div style="font-size: 12px; color: #888;">訊號強度: ${signalStrengthPct}% · 勝率估算: ${winProbPct}%</div>
          </div>
        </div>
        ${signalBoxDetail}
      </div>

      <div class="momentum-state">
        <h4>📊 動能狀態 (RSI + MACD)</h4>
        <div class="ma-grid">
          <div class="ma-item"><span class="ma-label">RSI(14)</span><span class="ma-value">${(ms.rsi ?? 0).toFixed(2)}</span></div>
          <div class="ma-item"><span class="ma-label">MACD 柱狀體</span><span class="ma-value">${(ms.macd ?? 0).toFixed(4)}</span></div>
          <div class="ma-item"><span class="ma-label">RSI 趨勢</span><span class="ma-value">${ms.rsiTrend === 'rising' ? '↗️ 上升' : '↘️ 下降'}</span></div>
          <div class="ma-item"><span class="ma-label">MACD 趨勢</span><span class="ma-value">${ms.macdTrend === 'rising' ? '↗️ 上升' : '↘️ 下降'}</span></div>
          <div class="ma-item"><span class="ma-label">MACD 狀態</span><span class="ma-value">${ms.macdState || 'N/A'}</span></div>
          <div class="ma-item"><span class="ma-label">超買/超賣</span><span class="ma-value">${ms.isOverbought ? '超買' : ms.isOversold ? '超賣' : '中性'}</span></div>
        </div>
      </div>

      <div class="matched-rules">
        <h4>🎯 訊號觸發原因 (${signal.reasons?.length || 0} 條)</h4>
        <ul>${reasonsHtml}</ul>
      </div>

      <div class="exhaustion-score" style="margin-top: 12px; padding: 8px 12px; background: #f5f5f5; border-radius: 4px;">
        <strong>💨 衰竭分數:</strong> ${((verdict.meta.meta?.exhaustionScore || 0) * 100).toFixed(0)}%
        <small style="color: #888;"> (越高越接近轉勢, >60% 為明顯衰竭)</small>
      </div>

      ${renderDetailedExplanationIndicators(verdict)}
      ${renderStrategyAdviceIndicators(verdict)}
      ${renderUsageGuideIndicators(verdict)}

      <details class="meta-details">
        <summary>🔧 配置（debug 用）</summary>
        <pre>${JSON.stringify(verdict.meta.meta?.configUsed, null, 2)}</pre>
      </details>
    </div>
  `;
}

// ===== 詳細解讀 section (Indicators) =====
// 大少 #11056 — 永久 rule,所有 Module 都要有詳細解讀/策略建議/點用點睇 (用人話)
function renderDetailedExplanationIndicators(verdict) {
  const confidencePct = (verdict.meta.confidence * 100).toFixed(0);
  const signal = verdict.meta.meta?.signal || {};
  const ms = verdict.meta.meta?.momentumState || {};
  const div = verdict.meta.meta?.divergence || { rsiDivergences: [], macdDivergences: [], totalCount: 0 };
  const exhaustion = verdict.meta.meta?.exhaustionScore || 0;
  const winProb = verdict.meta.meta?.winProbability || 0.5;

  return `
    <div class="detailed-explanation">
      <h4>📖 詳細解讀 (動能指標 + 背馳 + 衰竭 點解讀)</h4>
      <ul>
        <li><strong>📌 整體 cycle 點解:</strong> Verdict state = <code>${verdict.meta.state}</code>,代表「<strong>${verdict.meta.interpretation.split(' / ')[0] || '動能中性'}</strong>」。呢個 cycle 係由訊號 (buy/sell/hold) 直接 derive,唔係睇大方向 (嗰個係 M1 MA Alignment 嘅工作)。</li>
        <li><strong>📈 訊號類型 (signal.type):</strong> ${signal.type === 'buy' ? '<span style="color: #52c41a;">🟢 buy (買入)</span>' : signal.type === 'sell' ? '<span style="color: #ff4d4f;">🔴 sell (賣出)</span>' : '<span style="color: #faad14;">🟡 hold (觀望)</span>'}。代表「而家係咪行動嘅時候」, 唔代表「而家係咩 season」(要 M1/M2/M3 確認大方向)。</li>
        <li><strong>💪 訊號強度 (signal.strength):</strong> ${(signal.strength * 100).toFixed(0)}%,加權分數 (0-1)。每個觸發條件加 0.15-0.35 分,超過 0.6 先算明確訊號。詳細 score breakdown 見下面「訊號觸發原因」。</li>
        <li><strong>🎯 信心指數 (confidence):</strong> ${confidencePct}%,由 signal.strength × 多個 boost 計算。背馳數 ≥ 2 會 ×1.15,衰竭分數 > 0.6 會 ×1.10,cap 喺 0-1。信心高 = 訊號強 + 多個條件 corroborate。</li>
        <li><strong>📊 RSI(14):</strong> ${(ms.rsi ?? 0).toFixed(2)},Relative Strength Index 量度「最近 14 日升跌嘅相對強度」。> 70 = 超買 (overbought, 升太多可能回落),< 30 = 超賣 (oversold, 跌太多可能反彈)。</li>
        <li><strong>📉 MACD 柱狀體:</strong> ${(ms.macd ?? 0).toFixed(4)},EMA12 - EMA26 - EMA(EMA12-EMA26, 9)。正 = 短期動能強過長期,負 = 短期動能弱過長期。柱狀體由負翻正 = 金叉 (黃金交叉, 買入信號),由正翻負 = 死叉 (死亡交叉, 賣出信號)。</li>
        <li><strong>↗️ RSI 趨勢 (5 日):</strong> ${ms.rsiTrend === 'rising' ? '<span style="color: #52c41a;">上升中</span>' : '<span style="color: #ff4d4f;">下降中</span>'},比較 RSI 最新值同 5 日前平均。rising = 動能強化中,falling = 動能減弱中。</li>
        <li><strong>⚙️ MACD 狀態:</strong> <code>${ms.macdState || 'N/A'}</code>,4 個狀態:bullish_accelerating (升 + 加速中) / bullish_decelerating (升 + 減速) / bearish_accelerating (跌 + 加速) / bearish_decelerating (跌 + 減速, 即將見底)。</li>
        <li><strong>🔍 背馳 (Divergence) 數量:</strong> ${div.totalCount} 條。頂背馳 = 價格創新高但動能未新高 (跌警),底背馳 = 價格創新低但動能未新低 (升機)。RSI 背馳通常 5-10 日見效,MACD 背馳通常 10-20 日。</li>
        <li><strong>💨 衰竭分數 (exhaustion):</strong> ${(exhaustion * 100).toFixed(0)}%,綜合 RSI 極端 + MACD 柱狀體縮小 + 背馳強度,越高越接近趨勢尾聲。> 60% = 明顯衰竭,通常預示 1-2 週內反轉。</li>
        <li><strong>🎲 勝率估算 (winProbability):</strong> ${(winProb * 100).toFixed(0)}%,基於歷史統計 + 當前條件推算「5 日後升嘅機率」。Base 55%,底背馳 +12%,超賣 +8%,macd_decelerating +5%,cap 85%。</li>
        <li><strong>📅 數據日數 (dataDays):</strong> ${verdict.meta.meta?.dataDays || 0} 條 K 線,最少 119 條 (14 RSI + 35 MACD + 60 lookback + 10 buffer) 先夠用。</li>
        <li><strong>⏰ 時間週期 (timeframe):</strong> ${verdict.meta.timeframe}。日線睇中線 (幾週),週線睇長線 (幾月)。</li>
        <li><strong>📜 訊號觸發原因 (signal.reasons):</strong> ${(signal.reasons || []).join('、') || '暫無明確觸發'}。每個 reason 對應一個 score 累加,例如「底背馳 +0.35」「RSI 超賣回升 +0.25」,總分 ≥ 0.6 = 明確 buy。</li>
        <li><strong>⚠️ 數據不足警告:</strong> ${verdict.meta.warnings && verdict.meta.warnings.length > 0 ? verdict.meta.warnings[0] : '無'}。</li>
        <li><strong>🔄 統一 cycle 派生規則:</strong> buy → UP, sell → DOWN, hold → SIDEWAYS (TRANSITION 由 Synthesizer 判)。呢個 module 唔 emit TRANSITION。</li>
        <li><strong>📂 過去錯過的買點 (historicalOpportunities):</strong> ${(verdict.meta.meta?.historicalOpportunities || []).length} 個。回顧過去 lookbackDays 內曾經出現過嘅買入訊號,計算到今日嘅回報。Top 3 strongest。可以用嚟訓練盤感。</li>
      </ul>
    </div>
  `;
}

// ===== 策略建議 section (Indicators) =====
function renderStrategyAdviceIndicators(verdict) {
  const signal = verdict.meta.meta?.signal || {};
  const signalType = signal.type;
  const ms = verdict.meta.meta?.momentumState || {};
  const winProb = verdict.meta.meta?.winProbability || 0.5;
  const exhaustion = verdict.meta.meta?.exhaustionScore || 0;

  let strategy;
  if (signalType === 'buy') {
    strategy = `
      <li>🟢 <strong>順勢入場</strong>: 訊號 = buy + cycle = UP, 配合 M1 (MA Alignment) 確認大方向都係 UP, 呢個係高勝率買入點</li>
      <li>📍 <strong>入場時機</strong>: 唔好 chase 急升, 等回調到 MA5 / MA10 / 趨勢線支撐位再入, 風報比更好</li>
      <li>🛡️ <strong>止損位</strong>: 設喺近期低位 / 支撐線下面 1-2%, 一旦跌破 = 訊號失效, 走人</li>
      <li>📊 <strong>倉位管理</strong>: 訊號強度 ${(signal.strength * 100).toFixed(0)}% ＋ 勝率 ${(winProb * 100).toFixed(0)}%, 兩者都高可以加大倉位 (e.g. 80-100% normal size); 一高一低就細倉 (50%)</li>
      <li>🔭 <strong>持有期</strong>: 訊號有效一般 5-15 日, 期間 monitor RSI 唔好再超買 (> 70), 一旦超買考慮分段出</li>
    `;
  } else if (signalType === 'sell') {
    strategy = `
      <li>🔴 <strong>避開 / 減倉</strong>: 訊號 = sell + cycle = DOWN, 配合 M1 (MA Alignment) 都係 DOWN, 應該減倉或離場</li>
      <li>📍 <strong>止損位</strong>: 設喺近期高位 / 壓力線上面 1-2%, 一旦突破 = 跌勢可能見底, 重新評估</li>
      <li>📉 <strong>唔好接刀</strong>: 雖然「低處未算低」心態常見, 但 M4 sell 訊號通常代表下跌動能仲未完, 唔好貪平衝入</li>
      <li>⏳ <strong>等下次買點</strong>: 密切 monitor RSI 跌到 < 30 (超賣) + 底背馳出現, 就係重新入場嘅時機</li>
      <li>🔄 <strong>對沖</strong>: 如果你 long 倉個股, 考慮買 put option 或 inverse ETF 做對沖</li>
    `;
  } else {
    strategy = `
      <li>🟡 <strong>等方向</strong>: hold = 觀望, 唔 buy 唔 sell, 因為冇明確反轉觸發</li>
      <li>📍 <strong>睇大方向</strong>: 配合 M1 (MA Alignment) 判斷大方向, 如果 M1 = UP, 呢個 hold 暗示「升但等回調」, 密切 monitor RSI 接近 30 或底背馳出現</li>
      <li>🔍 <strong>留意背馳</strong>: 背馳數 = ${verdict.meta.meta?.divergence?.totalCount || 0} 條, 0 背馳 = 純粹跟趨勢, ≥1 背馳 = 可能有反轉, 預警</li>
      <li>💨 <strong>睇衰竭</strong>: 衰竭分數 = ${(exhaustion * 100).toFixed(0)}%, > 60% = 即將見頂/見底, 開始收緊止損或準備入新倉</li>
      <li>⏸️ <strong>唔好勉強</strong>: 冇明確訊號 = 冇 edge, 強行 trade 通常輸錢, 等清晰訊號先動</li>
    `;
  }

  return `
    <div class="strategy-advice">
      <h4>🎯 策略建議 (點做)</h4>
      <div class="strategy-block">
        <h5>${signalType === 'buy' ? '🟢 上升訊號 (A/F rule 主導) · 策略建議' : signalType === 'sell' ? '🔴 下跌訊號 · 策略建議' : '🟡 觀望訊號 · 策略建議'}</h5>
        <ul>${strategy}</ul>
      </div>
    </div>
  `;
}

// ===== 點用點睇 section (Indicators) =====
function renderUsageGuideIndicators(verdict) {
  return `
    <div class="usage-guide">
      <h4>💡 點用呢個結果 (點睇)</h4>
      <ol>
        <li>👀 <strong>第一眼睇 cycle state + signal 顏色</strong>: 綠 = buy (UP) / 紅 = sell (DOWN) / 黃 = hold (SIDEWAYS)。顏色決定咗你今日嘅 base 動作</li>
        <li>📊 <strong>睇信心指數</strong>: > 70% = 強烈訊號, 50-70% = 中等, < 50% = 弱, 弱訊號通常要等多一個 trigger confirm</li>
        <li>📈 <strong>睇動能狀態 (RSI + MACD)</strong>: RSI 超買 (紅) = 升太多, 超賣 (綠) = 跌太多。MACD 柱狀體由負翻正 = 金叉 (買入), 由正翻負 = 死叉 (賣出)</li>
        <li>🔍 <strong>睇背馳數量</strong>: 0 背馳 = 純趨勢跟倉, ≥1 背馳 = 預警反轉, 2 背馳 = 高信心反轉</li>
        <li>💨 <strong>睇衰竭分數</strong>: > 60% = 趨勢尾聲, 開始收緊止損或準備轉倉。越接近 100% = 越接近反轉點</li>
        <li>🎯 <strong>睇勝率估算</strong>: > 70% = 高勝率 trade, 60-70% = 中等, < 60% = 唔好亂動。勝率 base 55%, 加底背馳 + 12%, 加超賣 + 8%</li>
        <li>📂 <strong>睇歷史錯過嘅買點</strong>: 「1 個月前邊日買最好」可以訓練你嘅盤感, 知道點樣嘅 setup 通常會 work</li>
        <li>🔄 <strong>配合其他 module 一齊睇</strong>: M1 (MA) 講大方向, M2 (HL) 講結構, M3 (TL) 講支撐壓力, M4 (呢個) 講買賣時機。4 個 module 都同方向 = 高信心 trade</li>
        <li>⚠️ <strong>注意數據限制</strong>: 數據日數 = ${verdict.meta.meta?.dataDays || 0} 條, < 119 條會 warning, 數據唔夠 = 結果唔可靠</li>
        <li>📌 <strong>記住: M4 答「幾時該行動」, 唔答「而家係咩 season」</strong>: 配合 M1 用, M1 = UP + M4 = buy = 高勝率買入; M1 = UP + M4 = hold = 等回調, 唔好追</li>
      </ol>
    </div>
  `;
}

// ===== Chart overlay (Indicators) =====
// 大少 永久 rule: renderChartOverlay 必須叫呢個名,testing page 自動 invoke
function renderIndicatorsChartOverlay(verdict, klines, chartRefs) {
  if (!chartRefs || !chartRefs.chart) {
    console.warn('[renderIndicatorsChartOverlay] chartRefs.chart 缺失');
    return;
  }
  if (!verdict || !verdict.meta.meta) {
    console.warn('[renderIndicatorsChartOverlay] verdict 缺失');
    return;
  }
  if (!Array.isArray(klines) || klines.length === 0) {
    console.warn('[renderIndicatorsChartOverlay] klines 缺失或空');
    return;
  }
  const rsiSeries = verdict.meta.rsiSeries;
  const macdSeries = verdict.meta.macdSeries;
  if (!rsiSeries || !macdSeries) {
    console.warn('[renderIndicatorsChartOverlay] rsiSeries/macdSeries 缺失');
    return;
  }

  const chart = chartRefs.chart;
  if (typeof chart.addSeries !== 'function') {
    console.error('[renderIndicatorsChartOverlay] chart 冇 addLineSeries method');
    return;
  }

  // 移除舊 series
  if (chartRefs.indicatorsLineSeries) {
    for (const key of Object.keys(chartRefs.indicatorsLineSeries)) {
      try { chart.removeSeries(chartRefs.indicatorsLineSeries[key]); } catch (e) { /* ignore */ }
    }
  }
  chartRefs.indicatorsLineSeries = {};

  // RSI series (紫色, 對齊到 kline index 14+ 因為 RSI 從 period=14 開始)
  try {
    const rsiData = [];
    const rsiOffset = klines.length - rsiSeries.length;
    for (let i = 0; i < rsiSeries.length; i++) {
      const k = klines[rsiOffset + i];
      if (!k) continue;
      const t = typeof k.timestamp === 'number' ? new Date(k.timestamp).toISOString().split('T')[0] : String(k.timestamp).split(' ')[0];
      rsiData.push({ time: t, value: rsiSeries[i] });
    }
    if (rsiData.length > 0) {
      const s = chart.addSeries(LightweightCharts.LineSeries, {
        color: '#9b59b6',
        lineWidth: 2,
        title: 'RSI(14)',
        priceLineVisible: false,
        lastValueVisible: true,
        // RSI 範圍 0-100, 但 candlestick chart y-axis 係 price
        // 註: lightweight-charts v4.2.3 唔支援 separate pane, 暫時疊喺 price chart 上面
        // 大少 #11085 之後可考慮用 lightweight-charts v5 multi-pane
      });
      s.setData(rsiData);
      chartRefs.indicatorsLineSeries.rsi = s;
    }
  } catch (e) {
    console.error('[renderIndicatorsChartOverlay] RSI line 失敗:', e);
  }

  // MACD series (橙色, 對齊到 kline index 33+ 因為 MACD 從 slow+signal-2 開始)
  try {
    const macdData = [];
    const macdOffset = klines.length - macdSeries.length;
    for (let i = 0; i < macdSeries.length; i++) {
      const k = klines[macdOffset + i];
      if (!k) continue;
      const t = typeof k.timestamp === 'number' ? new Date(k.timestamp).toISOString().split('T')[0] : String(k.timestamp).split(' ')[0];
      macdData.push({ time: t, value: macdSeries[i] });
    }
    if (macdData.length > 0) {
      const s = chart.addSeries(LightweightCharts.LineSeries, {
        color: '#e67e22',
        lineWidth: 2,
        title: 'MACD',
        priceLineVisible: false,
        lastValueVisible: true,
      });
      s.setData(macdData);
      chartRefs.indicatorsLineSeries.macd = s;
    }
  } catch (e) {
    console.error('[renderIndicatorsChartOverlay] MACD line 失敗:', e);
  }
}

function getIndicatorsHelp() {
  return `
    <h4>動能背馳與衰竭檢測法 · 10 條規則</h4>
    <ul>
      <li><strong>睇好 (買入訊號):</strong>
        <ul>
          <li>底背馳 (RSI 或 MACD) → 加 0.35 分</li>
          <li>RSI 跌到 30 以下 (超賣) + 開始回升 → 加 0.25 分</li>
          <li>MACD 金叉 (柱狀圖由負變正) → 加 0.25 分</li>
          <li>MACD 跌嘅速度減慢 → 加 0.15 分</li>
          <li>放量配合 (成交量 > 10 日均量 × 1.2) → 加 0.15 分</li>
        </ul>
      </li>
      <li><strong>睇淡 (賣出訊號):</strong>
        <ul>
          <li>頂背馳 (RSI 或 MACD) → 加 0.35 分</li>
          <li>RSI 升到 70 以上 (超買) + 開始回調 → 加 0.25 分</li>
          <li>MACD 死叉 (柱狀圖由正變負) → 加 0.25 分</li>
        </ul>
      </li>
      <li><strong>點樣判:</strong> 買分 ≥ 0.6 又大過賣分 → 買入 (上升) · 賣分 ≥ 0.6 又大過買分 → 賣出 (下跌) · 其他 → 持有 (橫行)</li>
    </ul>
    <p><strong>週期結論:</strong> 買入 = 上升, 賣出 = 下跌, 持有 = 橫行 (轉勢由綜合模組判)</p>
    <p><strong>信心分數:</strong> 基礎分 = 訊號強度, 多過 2 個背馳 × 1.15, 衰竭大過 0.6 又同訊號脗合 × 1.10, 最高 1.0</p>
    <p><strong>簡化咗:</strong> 唔再用大語言模型預測, 改用規則公式計 (基礎 55% 加分)</p>
  `;
}

// 大少 2026-08-11 22:40 — Codebase 註解 Phase 4 partial gap fill
// 對應 modules/indicators.ts v1.0.0
// Spec doc: docs/research/AS-03-cycle-detection/MODULE-04-MOMENTUM-DIVERGENCE.md
// Algorithm (M4): 計算 RSI (14 日) + MACD (12-26-9) + 識別 RSI/MACD 背馳 + 衍生 cycle state + 過濾過買過賣
// 凡人話: 睇 RSI 同 MACD 嘅背馳同衰竭, 判斷動能強弱
export const indicatorsAdapter = {
  id: 'AS-03-IND',
  name: '動能背馳與衰竭 (睇 RSI 同 MACD)',
  version: '1.0.0',
  description: '用 RSI 同 MACD 睇股價升跌嘅動力, 搵出頂背馳、底背馳、動能唔夠嘅情況, 等你知幾時應該行動',
  contextLines: [
    '大少指示: 呢個 module 答「幾時該行動」, 唔答「而家係咩 season」(M1 MA Alignment 先答大方向)',
    '用法: M1/M2/M3 確認大方向 → M4 確認入場時機',
    '若 M1=UP + M4=buy → 高勝率買入; 若 M1=UP + M4=hold → 等回調',
  ],
  inputs: [
    {
      key: 'code',
      label: '股票代碼',
      type: 'autocomplete',
      required: true,
      endpoint: '/api/stocks/search',
      queryParam: 'q',
      placeholder: '輸入代碼或名稱（例: 00981 或 中芯）',
      limit: 10,
      marketFn: 'auto',
    },
    {
      key: 'period',
      label: '時間週期',
      type: 'select',
      options: [
        { value: '1d', label: '日線' },
        { value: '1w', label: '週線' },
      ],
      default: '1d',
    },
    {
      key: 'dataWindowDays',
      label: '取數據日數',
      type: 'number',
      default: 150,
      min: 119,
      max: 500,
    },
  ],
  analyze: analyzeIndicators,
  renderResult: renderIndicatorsResult,
  renderChartOverlay: renderIndicatorsChartOverlay,
  getHelp: getIndicatorsHelp,
};
// =====================================================================
// 2026-08-08 — Module 1 v2.0 均線系統週期判斷法 (with Volume & Slope 擴展)
//   大少指示: 舊 M1 v0.3.0 抽離做 zmen均算法 (檔案 zmen-ma-alignment.ts),
//   新 M1 v2.0 跟 docx Kimi v2.0 spec 做全新 implementation.
//   - 3 個 cycle states (uptrend / downtrend / sideways)
//   - 13 個 output fields
//   - 信心指數 = base × volume × slope 三階段調整
// Spec: docs/research/AS-03-cycle-detection/MODULE-01-MA-ALIGNMENT.md
// Docx: docs/演算法概念SPECS/01均線系統週期判斷法.docx
// =====================================================================

const MA_ALIGNMENT_V2_DEFAULTS = {
  maPeriods: [5, 10, 20, 60],
  thresholdPct: 0.02,
  enableVolumeWeight: true,
  enableSlopeCheck: true,
  volumeLookback: 5,
  slopeLookback: 5,
  volumeBoostThreshold: 1.2,
  volumeShrinkThreshold: 0.8,
  slopeDiscountFactor: 0.7,
  sidewaysBaseConfidence: 0.3,
  spreadConfidenceScale: 0.10,
};

const MA_V2_CYCLE_LABELS = {
  // 9 個 sub-scenario (大少 2026-08-15 M1 v2.1.0 — 跟 CSV spec)
  strong_uptrend: '強上升週期',
  weak_uptrend: '弱上升週期',
  sideways: '橫行週期',
  weak_downtrend: '弱下跌週期',
  strong_downtrend: '強下跌週期',
  uptrend_correction: '上升回調中',
  downtrend_bounce: '下跌反彈中',
  decelerating_up: '到頂轉勢中',
  decelerating_down: '到底轉勢中',
  // 向後兼容 (舊 3 個 state)
  uptrend: '上升週期',
  downtrend: '下跌週期',
};

const MA_V2_POSITION_LABELS = {
  mid_stage: '趨勢中期 (主升 / 主跌段)',
  tentative_rise: '剛開始升 (起勢)',
  tentative_fall: '剛開始跌 (起勢)',
  range_bound: '橫行整理中',
  correction_at_ma20: '回調到 20 日均線',
  bounce_in_progress: '反彈進行中',
  late_stage_topping: '到頂轉勢中 (見頂跡象)',
  late_stage_bottoming: '到底轉勢中 (見底跡象)',
};

const MA_V2_VOLUME_SIGNAL_LABELS = {
  expanding: '放量',
  shrinking: '縮量',
  neutral: '持平',
};

function maV2Round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// ===== analyzeMAAlignmentV2 (M1 v2.0 — 對應 modules/ma-alignment.ts) =====
//
// 大少 2026-08-08 09:13 全新 v2.0: 跟 docx Kimi v2.0 spec
// 對應 modules/ma-alignment.ts v2.0.0
// Spec doc: docs/research/AS-03-cycle-detection/MODULE-01-MA-ALIGNMENT.md
//
// Algorithm (M1 v2.0 — 13 條 rule-based):
//   - 3 cycles: 主升/主跌/橫行
//   - 13 個 output fields
//   - 三階段信心調整 (基礎分 × 成交量加權 × 斜率加權)
//   - 13 條 rule (P1-P13) 識別 mainCycle + adjustmentLog
//
// 用法 (Usage):
//   await analyzeMAAlignmentV2(klines, { config: { maPeriods: [5, 10, 20, 60] } }) → maV2Verdict
//
// Output: { state, confidence, interpretation, evidence, meta: { ... }, _warnings }
//   - state: 'UP' | 'DOWN' | 'SIDEWAYS' | 'TRANSITION' (主 cycle)
//   - confidence: 0-1 (三階段調整後)
//   - meta.cycle: 'uptrend' | 'downtrend' | 'sideways'
//   - meta.maValues: { MA5, MA10, MA20, MA60 }
//   - meta.maRanks: 排列名次
//   - meta.maSlopes: 各 MA 斜率
//   - meta.momentumScore: 0-1
//   - _warnings: ModuleWarning[] 可能包含 INSUFFICIENT_DATA / NAN_RESULT / FALLBACK_USED / THRESHOLD_BREACH
//
// 對應 module: M1 v2.0 (新版均線演算法, 跟舊 M1 v0.3.0 zmen 算法唔同)
// 對應 ts file: algorithms/AS-03-cycle-detection/modules/ma-alignment.ts
// Spec doc: docs/research/AS-03-cycle-detection/MODULE-01-MA-ALIGNMENT.md
//
// 注: M1 v0.3.0 zmen 算法 (runMAAlignment line 235+) 係獨立演算法 (大少 cycle 風格基礎),
//     M1 v2.0 (analyzeMAAlignmentV2 本 function) 係 Sprint 1 嘅新 v2.0 版本 (Kimi spec)

// 大少 2026-08-20 20:05 Phase 2 — analyzeMAAlignmentV2 拎走 frontend, 改 fetch backend
// 凡人話: M1 algorithm 完整 (1081 行) 已經 port 去 backend/algorithms/ma-alignment/algorithm.py
// frontend 唔再自己跑 M1 algorithm, 改為 fetch backend /api/algorithms/run?algo=ma_alignment
// 對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs
// 永久 rule: frontend M1 algorithm 拎走, 改 caller inject backend verdict
// 對應 source: algorithms/AS-03-cycle-detection/modules/ma-alignment.ts (551 行, 1:1 port 去 Python)

/**
 * 凡人話: 拎 backend M1 algorithm 嘅 verdict
 * @param klines - K 線 array (frontend 拎到, 傳畀 backend 入面用嚟對齊時間)
 * @param options - 參數 (symbol, period, threshold, etc)
 * @returns backend verdict (verdict.meta 拎 cycle / maValues / maRanks / maSlopes / volumeSignal / ZigZag 5 個 field)
 */
async function analyzeMAAlignmentV2(klines, options = {}) {
  const BACKEND_URL = (typeof window !== 'undefined' && window.BACKEND_URL) || 'http://localhost:18792';
  const symbol = options.code || options.symbol || 'UNKNOWN';
  const period = options.period || '1d';
  const dataWindowDays = options.dataWindowDays || 1260;  // 大少 2026-08-14 23:15 永久 rule
  const threshold = options.zigzagThreshold || 5;

  const url = `${BACKEND_URL}/api/algorithms/run?algo=ma_alignment&symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}&data_window_days=${dataWindowDays}&threshold=${threshold}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Backend M1 algorithm 拎唔到: ${resp.status} ${resp.statusText}`);
  }
  const verdict = await resp.json();
  if (!verdict.ok) {
    throw new Error(`Backend M1 verdict fail: ${verdict.error || 'unknown'}`);
  }
  // backend verdict shape 已經跟 frontend 兼容 (maValues / maRanks / maSlopes / etc)
  return verdict;
}

function renderMAAlignmentV2Result(verdict) {
  // ===== M1 v2.1.0 — 9 個 sub-scenario 凡人話 popup 註解 (大少 2026-08-15) =====
  // 跟 M7/M8/M9 同樣 inline style (.verdict-tooltip + position relative + cursor help + hover::after content attr(data-help) + 0.1s 即時顯示)
  // 全凡人話, 0 英文 technical term, 0 casual 詞 (學校/老師/校長等)
  const M1_TOOLTIPS = {
    m1_title: '第一模組嘅目的: 用 4 條均線 (5/10/20/60 日) 嘅排列 + 斜率 + 成交量, 判斷股票而家所處嘅周期 — 共 9 個 sub-scenario',

    // 9 個 sub-scenario 凡人話解釋
    m1_strong_uptrend: '強上升: 4 條均線完美由細到大排列 (MA5 < MA10 < MA20 < MA60), 全部均線斜率向上, 配合放量確認。趨勢中期, 上升動能強',
    m1_weak_uptrend: '弱上升: 4 條均線由細到大排列, 但部分斜率唔配合 / 量能唔夠。剛開始升 / 起勢, 信心打折',
    m1_sideways: '橫行: 均線排列亂, 短期同長期均線距離近 (少過 2%), 冇明確方向。橫行整理中, 等突破',
    m1_weak_downtrend: '弱下跌: 4 條均線由大到細排列, 但部分斜率唔配合 / 量能唔夠。剛開始跌 / 起勢, 信心打折',
    m1_strong_downtrend: '強下跌: 4 條均線完美由大到細排列, 全部均線斜率向下, 配合放量確認。趨勢中期, 下跌動能強',
    m1_uptrend_correction: '上升回調: 之前上升趨勢, 而家短期均線 (MA5/MA10) 急跌但長期均線 (MA60) 仲升緊。回調到 20 日均線附近, 仍屬上升趨勢中的修正',
    m1_downtrend_bounce: '下跌反彈: 之前下跌趨勢, 而家短期均線 (MA5/MA10) 急升但長期均線 (MA60) 仲跌緊。反彈進行中, 仍屬下跌趨勢中的反彈',
    m1_decelerating_up: '到頂轉勢: 之前上升趨勢, MA5 急跌 3%+ 但長期均線仲升, 連續 4+ 日連跌。見頂跡象, 上升趨勢可能見頂',
    m1_decelerating_down: '到底轉勢: 之前下跌趨勢, MA5 急升 3%+ 但長期均線仲跌, 連續 4+ 日連升。見底跡象, 下跌趨勢可能見底',

    // 8 個 cyclePosition 凡人話解釋
    m1_mid_stage: '趨勢中期: 強趨勢 (強上升 / 強下跌) 嘅中段, 動能最猛, 通常持續 1-3 個月',
    m1_tentative_rise: '剛起勢: 弱上升嘅起步, 信號未完全確認, 觀察多幾日',
    m1_tentative_fall: '剛起勢: 弱下跌嘅起步, 信號未完全確認, 觀察多幾日',
    m1_range_bound: '橫行整理: 4 條均線糾纏, 等突破方向',
    m1_correction_at_ma20: '回調到 20 日均線: 上升趨勢中嘅正常調整, 20 日均線係關鍵支持位',
    m1_bounce_in_progress: '反彈進行中: 下跌趨勢中嘅短暫回升, 留意長期均線仲跌緊',
    m1_late_stage_topping: '到頂轉勢中: 上升趨勢見頂跡象 (短期急跌 + 長期仲升), 連續 4+ 日連跌',
    m1_late_stage_bottoming: '到底轉勢中: 下跌趨勢見底跡象 (短期急升 + 長期仲跌), 連續 4+ 日連升',

    // 13 個 output field 凡人話解釋
    m1_confidence: '信心指數: 綜合 3 個維度計算 (基礎分 × 成交量加權 × 斜率加權), 範圍 0-100%。≥70% 高信心 / 40-70% 中等 / <40% 低信心',
    m1_base_confidence: '基礎信心: 純粹睇 MA 排列 + spread 得出嘅原始信心, 之後會被成交量同斜率調整',
    m1_ma_values: '4 條均線嘅最新值: MA5 (5 日) / MA10 (10 日) / MA20 (20 日) / MA60 (60 日), 短期均線對短期股價敏感, 長期均線對長期趨勢敏感',
    m1_ma_ranks: '均線由大到小排序: 例如 MA5 > MA10 > MA20 > MA60 代表典型多頭 (短期均線喺長期均線上面), 排列越齊信心越高',
    m1_ma_slopes: '各均線斜率: 對比 5 日前嘅均線值計出嘅百分比變化。正數 (↗) = 升緊, 負數 (↘) = 跌緊。短期斜率係動能領先指標',
    m1_momentum_score: '加權動能分數: 將各均線斜率按 1/period 加權平均, 短期均線權重高。正數 = 上升動能, 負數 = 下跌動能',
    m1_volume_trend: '近期均量 / 前期均量: > 1.2 為放量 (錢跟緊), < 0.8 為縮量 (錢退緊), 中間為持平',
    m1_volume_signal: '成交量訊號: 從近期 / 前期均量比計出嘅標籤 (放量 / 縮量 / 持平), 用嚟判斷錢跟唔跟個走勢',
    m1_max_spread: '均線間最大價差百分比: 4 條均線之間嘅最大距離除以最低值。> 2% 視為有方向, < 2% 強制覆寫做橫行',
    m1_threshold_pct: 'v2.2.0 起 (大少 2026-08-21 18:37) 用 adaptive thresholdPct: 該股 20 日真實波幅 (ATR%) × 1.5, clamp 0.5%-5%。Source = adaptive 即自動計, fixed 即手動輸入。低波動股 TP 細, 高波動股 TP 大 (capped 5%)。',
    m1_consecutive_days: '連續日數: 最近連續升 / 跌嘅日數, 到頂轉勢 / 到底轉勢嘅判定基礎 (≥ 4 日先 trigger)',
    m1_adjustment_log: '信心指數調整記錄: 算法根據成交量 / 斜率 / 走勢強度做咗咩 discount / boost, 例如「放量上漲信心提升」、「短期斜率負上升動能減弱」',
  };

  // Inline <style> block 喺 return 嘅 <div> 開頭, 跟 M7/M8/M9 同樣 .verdict-tooltip pattern
  const M1_TOOLTIP_STYLE = `<style>
    .m1-verdict-tooltip { position: relative; cursor: help; border-bottom: 1px dotted #999; }
    .m1-verdict-tooltip:hover::after {
      content: attr(data-help);
      position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
      background: #2c3e50; color: #fff; padding: 8px 12px; border-radius: 6px;
      white-space: normal; width: max-content; max-width: 380px; min-width: 200px;
      font-size: 12px; line-height: 1.5; z-index: 1000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: fadeIn 0.1s ease-in;
    }
    .m1-verdict-tooltip:hover::before {
      content: ''; position: absolute; bottom: 95%; left: 50%; transform: translateX(-50%);
      border: 6px solid transparent; border-top-color: #2c3e50;
    }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  </style>`;

  const meta = verdict.meta || {};
  if (!meta.cycle) {
    return `<div class="result-error">數據不足: ${meta.dataDays || 0} / ${meta.requiredLength || 70} 條</div>`;
  }
  // 9 個 sub-scenario 對應顏色 (大少 2026-08-15 M1 v2.1.0)
  const CYCLE_COLOR_MAP = {
    strong_uptrend: '#1FA960',       // 深綠 (強上升)
    weak_uptrend: '#7DD89F',          // 淺綠 (弱上升)
    uptrend_correction: '#A8D5BA',    // 淡綠 (上升回調)
    sideways: '#F39C12',              // 黃 (橫行)
    downtrend_bounce: '#F5B7B1',      // 淡紅 (下跌反彈)
    weak_downtrend: '#F1948A',        // 淺紅 (弱下跌)
    strong_downtrend: '#C0392B',      // 深紅 (強下跌)
    decelerating_up: '#8E44AD',       // 紫 (到頂轉勢)
    decelerating_down: '#2980B9',     // 藍 (到底轉勢)
    uptrend: '#26BA75',               // 向後兼容
    downtrend: '#EE5151',
  };
  const cycleColor = CYCLE_COLOR_MAP[meta.cycle] || '#F39C12';
  const confidencePct = (meta.confidence * 100).toFixed(0);
  const confidenceExplain = meta.confidence >= 0.7 ? '高信心, 信號強' : meta.confidence >= 0.4 ? '中等信心, 信號一般' : '低信心, 信號弱';
  const cycleCode = meta.cycle.toUpperCase();

  // 主題排列 (e.g. "MA5 > MA10 > MA20 > MA60" 代表典型多頭)
  const arrangementText = meta.maRanks.join(' > ');
  const isTypicalUp = arrangementText === 'MA5 > MA10 > MA20 > MA60';
  const isTypicalDown = arrangementText === 'MA60 > MA20 > MA10 > MA5';
  const arrangementLabel = isTypicalUp ? '典型多頭排列' : isTypicalDown ? '典型空頭排列' : '非典型排列';

  // Sub-scenario 嘅 tooltip key (e.g. strong_uptrend → M1_TOOLTIPS.m1_strong_uptrend)
  const scenarioTooltipKey = `m1_${meta.cycle}`;
  const positionTooltipKey = `m1_${meta.cyclePosition || 'range_bound'}`;
  const hasConsecutiveDays = (meta.cycle === 'decelerating_up' || meta.cycle === 'decelerating_down') && meta.consecutiveDays > 0;

  // 📌 判斷 box 詳細解說 (9 個 sub-scenario 各自嘅凡人話解 — 大少 2026-08-15 M1 v2.1.0)
  const SCENARIO_INTERPRETATION = {
    strong_uptrend: {
      summary: '股票 4 條均線 (MA5/10/20/60) 完美由細到大排列, 短期均線喺長期均線上面, 全部均線斜率向上, 配合放量確認。代表近期股價一直喺高位跑, 趨勢確認強勁向上。',
      detail: '排列典型多頭, Spread ' + (meta.maxSpreadPct * 100).toFixed(2) + '%, 即係均線之間嘅距離大, 上升趨勢穩固。基礎信心 ' + meta.baseConfidence + ' (純睇 MA 排列同 spread 得出)。',
      advice: '可以考慮持有或喺回調時加倉, 但要留意成交量同短期均線斜率嘅變化 — 縮量升 / MA5 斜率轉負都可能係見頂警號。',
    },
    weak_uptrend: {
      summary: '股票 4 條均線由細到大排列, 但部分斜率唔配合 / 量能唔夠。剛開始升 / 起勢, 信心打折, 趨勢仲未完全確認。',
      detail: '排列對但 ' + (meta.volumeSignal === 'expanding' ? '量能唔夠' : '部分斜率偏弱') + ', Spread ' + (meta.maxSpreadPct * 100).toFixed(2) + '%, 上升動能偏弱。基礎信心 ' + meta.baseConfidence + ', 已打折。',
      advice: '觀察多幾日, 等放量確認再入場, 唔好喺弱勢訊號時強行加倉。留意 MA5 斜率轉負 = 升勢見頂。',
    },
    uptrend_correction: {
      summary: '之前上升趨勢, 而家短期均線 (MA5/MA10) 急跌但長期均線 (MA60) 仲升緊。屬於上升趨勢中的正常回調, 通常回調到 20 日均線附近會見支持。',
      detail: '短期急跌但長期仲升, Spread ' + (meta.maxSpreadPct * 100).toFixed(2) + '%, 仍然保持上升趨勢嘅結構。基礎信心 ' + meta.baseConfidence + '。',
      advice: '如已持有可續持, 等 MA5 跌到 MA20 附近見支持再考慮加倉。唔好見急跌就沽, 留意 M2 HL Structure 確認有冇破壞 HH/HL 結構。',
    },
    sideways: {
      summary: '股票 4 條均線排列唔係典型嘅多頭或空頭 (即係交叉咗 / 距離好近), 代表近期股價冇明確方向, 喺一個範圍內上落。',
      detail: arrangementLabel + ', Spread ' + (meta.maxSpreadPct * 100).toFixed(2) + '%, 均線之間嘅距離細, 趨勢唔明確。橫行可能係蓄力 (等待突破) 或者轉勢 (等待方向確認)。',
      advice: '等待突破方向, 唔好喺橫行期間強行入市。配合 M6 Volatility Squeeze 訊號可以捕捉突破時機; 配合 M5 量价可以睇突破嘅真偽。',
    },
    downtrend_bounce: {
      summary: '之前下跌趨勢, 而家短期均線 (MA5/MA10) 急升但長期均線 (MA60) 仲跌緊。屬於下跌趨勢中的短暫反彈, 仍要小心。',
      detail: '短期急升但長期仲跌, Spread ' + (meta.maxSpreadPct * 100).toFixed(2) + '%, 下跌趨勢嘅大方向仲未改變。基礎信心 ' + meta.baseConfidence + '。',
      advice: '如已持貨可考慮喺反彈高位減倉, 唔好因為短暫反彈就以為見底。確認 M2 HL Structure 有冇破壞 LL/LH 結構, 等長期均線 (MA60) 斜率轉正先信。',
    },
    weak_downtrend: {
      summary: '股票 4 條均線由大到細排列, 但部分斜率唔配合 / 量能唔夠。剛開始跌 / 起勢, 信心打折, 跌勢仲未完全確認。',
      detail: '排列對但 ' + (meta.volumeSignal === 'expanding' ? '量能唔夠' : '部分斜率偏弱') + ', Spread ' + (meta.maxSpreadPct * 100).toFixed(2) + '%, 下跌動能偏弱。基礎信心 ' + meta.baseConfidence + ', 已打折。',
      advice: '觀察多幾日, 等放量確認再行動, 唔好急住撈底。留意 MA5 斜率轉正 = 跌勢見底。',
    },
    strong_downtrend: {
      summary: '股票 4 條均線完美由大到細排列, 短期均線喺長期均線下面, 全部均線斜率向下, 配合放量確認。代表近期股價一直跑緊低位, 趨勢確認強勁向下。',
      detail: '排列典型空頭, Spread ' + (meta.maxSpreadPct * 100).toFixed(2) + '%, 即係均線之間嘅距離大, 下跌趨勢穩固。基礎信心 ' + meta.baseConfidence + '。',
      advice: '觀望 / 減倉, 等長期均線斜率轉正先考慮撈底, 唔好接刀。留意有冇縮量 (下跌動能減弱) 或長期斜率轉正 (可能見底) 嘅反彈訊號。',
    },
    decelerating_up: {
      summary: '之前上升趨勢, MA5 急跌 3%+ 但長期均線仲升, 連續 ' + (meta.consecutiveDays || 0) + ' 日連跌。見頂跡象明顯, 上升趨勢可能見頂, 等確認轉勢。',
      detail: '短期急跌 ' + (meta.maSlopes['MA5'] * 100).toFixed(2) + '% + 長期仲升 ' + (meta.maSlopes['MA60'] * 100).toFixed(2) + '% + 連跌 ' + (meta.consecutiveDays || 0) + ' 日, 見頂訊號強。',
      advice: '如已持貨應考慮喺反彈時減倉 / 止賺, 唔好博佢返上去。確認 M2 HL Structure 有冇破壞 HH/HL (出現 LH = 見頂確認), 同 M4 Indicators (RSI 背馳 = 見頂確認)。',
    },
    decelerating_down: {
      summary: '之前下跌趨勢, MA5 急升 3%+ 但長期均線仲跌, 連續 ' + (meta.consecutiveDays || 0) + ' 日連升。見底跡象明顯, 下跌趨勢可能見底, 等確認轉勢。',
      detail: '短期急升 ' + (meta.maSlopes['MA5'] * 100).toFixed(2) + '% + 長期仲跌 ' + (meta.maSlopes['MA60'] * 100).toFixed(2) + '% + 連升 ' + (meta.consecutiveDays || 0) + ' 日, 見底訊號強。',
      advice: '如想撈底要等確認: M2 HL Structure 出現 HH (見底確認) + M4 Indicators RSI 唔再背馳。先小注試單, 唔好一次過 all-in。',
    },
  };

  // 向後兼容舊 cycle (uptrend / downtrend), map 返去新 sub-scenario
  let cycleForLookup = meta.cycle;
  if (cycleForLookup === 'uptrend') cycleForLookup = 'strong_uptrend';
  if (cycleForLookup === 'downtrend') cycleForLookup = 'strong_downtrend';

  const interp = SCENARIO_INTERPRETATION[cycleForLookup] || SCENARIO_INTERPRETATION.sideways;
  const interpretationDetail = `
    <p>📌 <strong>簡單講</strong>: <span class="m1-verdict-tooltip" data-help="${M1_TOOLTIPS[scenarioTooltipKey] || ''}">${interp.summary}</span></p>
    <p>📊 <strong>咩意思</strong>: ${interp.detail}</p>
    <p>💡 <strong>點睇呢個結果</strong>: ${interp.advice}</p>
  `;

  return `
    <div class="as03-verdict as03-module-card">
      ${M1_TOOLTIP_STYLE}
      <div class="module-card-header">
        <h3 class="module-header"><span class="m1-verdict-tooltip" data-help="${M1_TOOLTIPS.m1_title}">📊 均線系統週期判斷法 v2.1.0 (9 個 sub-scenario + 成交量 + 斜率)</span></h3>
      </div>
      <div class="verdict-header">
        <div class="state-pill" style="background: ${cycleColor}">
          <span class="state-label"><span class="m1-verdict-tooltip" data-help="${M1_TOOLTIPS[scenarioTooltipKey] || M1_TOOLTIPS.m1_sideways}">${meta.cycleLabel}</span></span>
          <span class="state-code">${cycleCode}</span>
        </div>
        <div class="confidence">
          <div class="conf-pct"><span class="m1-verdict-tooltip" data-help="${M1_TOOLTIPS.m1_confidence}">${confidencePct}%</span></div>
          <div class="conf-label">信心指數 — ${confidenceExplain}</div>
        </div>
        <div class="data-summary">
          <div class="summary-row"><span>週期位置:</span> <strong><span class="m1-verdict-tooltip" data-help="${M1_TOOLTIPS[positionTooltipKey] || M1_TOOLTIPS.m1_range_bound}">${meta.cyclePositionLabel || '—'}</span></strong></div>
          ${hasConsecutiveDays ? `<div class="summary-row"><span>連續日數:</span> <strong><span class="m1-verdict-tooltip" data-help="${M1_TOOLTIPS.m1_consecutive_days}">${meta.consecutiveDays} 日</span></strong></div>` : ''}
          <div class="summary-row"><span>排列:</span> <strong>${arrangementLabel}</strong></div>
          <div class="summary-row"><span>Spread:</span> <strong><span class="m1-verdict-tooltip" data-help="${M1_TOOLTIPS.m1_max_spread}">${(meta.maxSpreadPct * 100).toFixed(2)}%</span></strong></div>
          ${meta.thresholdPctUsedPctDisplay ? `<div class="summary-row"><span>Threshold (v2.2.0):</span> <strong><span class="m1-verdict-tooltip" data-help="${M1_TOOLTIPS.m1_threshold_pct}">${meta.thresholdPctUsedPctDisplay} (${meta.thresholdPctSource === 'adaptive' ? 'adaptive, ATR=' + (meta.adaptiveAtrPctDisplay || '?') : meta.thresholdPctSource === 'fixed' ? 'fixed override' : meta.thresholdPctSource || '—'})</span></strong></div>` : ''}
          <div class="summary-row"><span>基礎信心:</span> <strong><span class="m1-verdict-tooltip" data-help="${M1_TOOLTIPS.m1_base_confidence}">${meta.baseConfidence}</span></strong></div>
        </div>
      </div>

      <div class="interpretation">
        <strong>📌 判斷:</strong>${meta.reason}
        ${interpretationDetail}
      </div>

      <div class="ma-info">
        <h4>📐 均線詳細</h4>
        <div class="ma-grid">
          ${Object.entries(meta.maValues).map(([k, v]) => `
            <div class="ma-item">
              <span class="ma-label">${k}</span>
              <span class="ma-value">${v}</span>
              <span class="ma-slope" style="color: ${meta.maSlopes[k] >= 0 ? '#26BA75' : '#EE5151'}">
                ${meta.maSlopes[k] >= 0 ? '↗' : '↘'} ${(meta.maSlopes[k] * 100).toFixed(2)}%
              </span>
            </div>
          `).join('')}
        </div>
        <p class="ma-arrangement">均線由大到小: <code>${arrangementText}</code></p>
      </div>

      <div class="volume-info">
        <h4>💰 成交量分析</h4>
        <div class="volume-grid">
          <div class="vol-item"><span class="vol-label">近期/前期比</span><span class="vol-value">${meta.volumeTrendRatio}</span></div>
          <div class="vol-item"><span class="vol-label">訊號</span><span class="vol-value">${meta.volumeSignal === 'expanding' ? '📈 放量' : meta.volumeSignal === 'shrinking' ? '📉 縮量' : '➡️ 持平'}</span></div>
          <div class="vol-item"><span class="vol-label">動能分數</span><span class="vol-value">${meta.momentumScore}</span></div>
        </div>
        ${meta.adjustmentLog.length > 0 ? `
          <div class="adjustment-log">
            <strong>調整記錄:</strong>
            <ul>
              ${meta.adjustmentLog.map(log => `<li>${log}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>

      ${renderMAAlignmentV2DetailedExplanation(verdict)}

      ${renderMAAlignmentV2StrategyAdvice(verdict)}

      ${renderMAAlignmentV2UsageGuide(verdict)}

      <details class="meta-details">
        <summary>🔧 技術細節（debug 用）</summary>
        <pre>maValues: ${Object.entries(meta.maValues).map(([k, v]) => `${k}=${v}`).join(', ')}
maRanks: [${meta.maRanks.join(' > ')}]
maSlopes: ${Object.entries(meta.maSlopes).map(([k, v]) => `${k}=${(v * 100).toFixed(4)}%`).join(', ')}
momentumScore: ${meta.momentumScore}
volumeTrendRatio: ${meta.volumeTrendRatio}
volumeSignal: ${meta.volumeSignal}
maxSpreadPct: ${meta.maxSpreadPct}
thresholdPctUsed: ${meta.thresholdPctUsedPctDisplay || '—'} (source=${meta.thresholdPctSource || '—'}, ATR%=${meta.adaptiveAtrPctDisplay || '—'})
baseConfidence: ${meta.baseConfidence}
confidence: ${meta.confidence}
lastDate: ${meta.lastDate}
${meta.adjustmentLog.length > 0 ? '\nadjustmentLog:\n' + meta.adjustmentLog.map(s => '  • ' + s).join('\n') : ''}</pre>
      </details>
    </div>
  `;
}

// ===== 詳細解讀 section =====
// 用人話逐一解釋 verdict 每個 field 嘅意思 (大少 2026-08-15 M1 v2.1.0 — 9 個 sub-scenario + 14 個 field)
function renderMAAlignmentV2DetailedExplanation(verdict) {
  const meta = verdict.meta;
  const confidencePct = (meta.confidence * 100).toFixed(1);
  const baseConfidencePct = (meta.baseConfidence * 100).toFixed(1);

  return `
    <div class="result-section">
      <h3>📖 詳細解讀 (M1 v2.1.0 — 9 個 sub-scenario)</h3>
      <p>呢個 module 用 4 維度判斷股票所處嘅周期 (強升 / 弱升 / 橫行 / 弱跌 / 強跌 / 上升回調 / 下跌反彈 / 到頂轉勢 / 到底轉勢), 同時用 3 個維度調整信心 (成交量 + 斜率 + 走勢強度)。</p>
      <ul>
        <li><strong>cycle</strong> (9 個 sub-scenario): ${meta.cycle} (${meta.cycleLabel}) — 而家股票所處嘅周期</li>
        <li><strong>cyclePosition</strong> (8 個位置): ${meta.cyclePosition || '—'} (${meta.cyclePositionLabel || '—'}) — 周期嘅邊個階段</li>
        <li><strong>consecutiveDays</strong>: ${meta.consecutiveDays || 0} 日 — 最近連續升 / 跌嘅日數 (到頂轉勢 / 到底轉勢判定基礎)</li>
        <li><strong>confidence</strong>: ${confidencePct}% — 綜合信心指數, base × volume × slope 三階段調整後</li>
        <li><strong>baseConfidence</strong>: ${baseConfidencePct}% — 純粹睇 MA 排列 + spread 嘅基礎信心</li>
        <li><strong>maValues</strong>: ${Object.entries(meta.maValues).map(([k, v]) => `${k}=${v}`).join(', ')} — 4 條均線嘅最新值</li>
        <li><strong>maRanks</strong>: [${meta.maRanks.join(' > ')}] — 均線由大到小嘅排序, 順序排列 = 典型多頭 / 空頭</li>
        <li><strong>maSlopes</strong>: ${Object.entries(meta.maSlopes).map(([k, v]) => `${k}=${(v * 100).toFixed(2)}%`).join(', ')} — 各均線斜率 (正 = 升, 負 = 跌)</li>
        <li><strong>momentumScore</strong>: ${meta.momentumScore} — 加權動能分數, 短期 MA 權重高</li>
        <li><strong>zigzagPoints</strong>: ${meta.zigzagPoints ? meta.zigzagPoints.length : 0} 個 — ZigZag 轉向點總數 (5% threshold 過濾 noise, 拎畀 chart 紫色折線用)</li>
        <li><strong>lastSwingHigh</strong>: ${meta.lastSwingHigh ? `${meta.lastSwingHigh.date} 收 ${meta.lastSwingHigh.value}` : '—'} — 最近一個山頂 (ZigZag 拎到嘅 peak)</li>
        <li><strong>lastSwingLow</strong>: ${meta.lastSwingLow ? `${meta.lastSwingLow.date} 收 ${meta.lastSwingLow.value}` : '—'} — 最近一個山谷 (ZigZag 拎到嘅 trough)</li>
        <li><strong>zigzagThreshold</strong>: ${meta.zigzagThreshold}% — ZigZag 過濾 noise 門檻, 大少可手調 (1-20%, 預設 5%)</li>
        <li><strong>zigzagSlope</strong> (大少 2026-08-19 Stage 1): ${
          meta.zigzagSlope && meta.zigzagSlope.ok
            ? `<br/>　　prevToLast: ${meta.zigzagSlope.prevToLast.from.date} ${meta.zigzagSlope.prevToLast.from.type} 收 ${meta.zigzagSlope.prevToLast.from.value} → ${meta.zigzagSlope.prevToLast.to.date} ${meta.zigzagSlope.prevToLast.to.type} 收 ${meta.zigzagSlope.prevToLast.to.value} = <strong>${meta.zigzagSlope.prevToLast.changePct >= 0 ? '+' : ''}${meta.zigzagSlope.prevToLast.changePct}%</strong> / ${meta.zigzagSlope.prevToLast.days} 日 = <strong>${meta.zigzagSlope.prevToLast.dailySlope >= 0 ? '+' : ''}${meta.zigzagSlope.prevToLast.dailySlope}%/日</strong>` +
              (meta.zigzagSlope.lastToToday
                ? `<br/>　　lastToToday: ${meta.zigzagSlope.lastToToday.from.date} ${meta.zigzagSlope.lastToToday.from.type} 收 ${meta.zigzagSlope.lastToToday.from.value} → ${meta.zigzagSlope.lastToToday.to.date} 收 ${meta.zigzagSlope.lastToToday.to.value} = <strong>${meta.zigzagSlope.lastToToday.changePct >= 0 ? '+' : ''}${meta.zigzagSlope.lastToToday.changePct}%</strong> / ${meta.zigzagSlope.lastToToday.days} 日 = <strong>${meta.zigzagSlope.lastToToday.dailySlope >= 0 ? '+' : ''}${meta.zigzagSlope.lastToToday.dailySlope}%/日</strong> (extended, 處理甩尾)`
                : '')
            : `<em style="color:#888;">${meta.zigzagSlope ? meta.zigzagSlope.reason : '(未計算)'}</em>`
        } — 凡人話: 用之字第 1 點 → 第 2 點計斜率, 取代 v2.0 MA5 斜率 (Stage 2 先郁 trigger)</li>
        <li><strong>volumeTrendRatio</strong>: ${meta.volumeTrendRatio} — 近期均量 / 前期均量, &gt; 1.2 為放量, &lt; 0.8 為縮量</li>
        <li><strong>volumeSignal</strong>: ${meta.volumeSignalLabel || meta.volumeSignal} — 量能訊號</li>
        <li><strong>maxSpreadPct</strong>: ${(meta.maxSpreadPct * 100).toFixed(2)}% — 各均線間最大價差百分比, &lt; thresholdPctUsed 強制覆寫做橫行</li>
        <li><strong>thresholdPctUsed</strong>: ${meta.thresholdPctUsedPctDisplay || '—'} (source=${meta.thresholdPctSource || '—'}, ATR%=${meta.adaptiveAtrPctDisplay || '—'}, raw=${meta.adaptiveRawThreshold ? (meta.adaptiveRawThreshold * 100).toFixed(3) + '%' : '—'}) — v2.2.0 永久 rule (大少 2026-08-21 18:37): adaptive 模式用 20 日 ATR% × 1.5 自動計, clamp 0.5%-5%。每隻股唔同, 低波動 TP 細, 高波動 TP 大 (capped)</li>
        <li><strong>adjustmentLog</strong>: ${meta.adjustmentLog.length > 0 ? meta.adjustmentLog.join('；') : '(無調整)'} — 信心指數調整記錄</li>
        <li><strong>reason</strong>: ${meta.reason} — 綜合判斷理由</li>
        <li><strong>lastDate</strong>: ${meta.lastDate} — 數據截止日期</li>
      </ul>
      <h4 style="margin-top:12px;">9 個 sub-scenario 速查</h4>
      <ul>
        <li><strong>強上升</strong> (strong_uptrend): MA 完美多頭排列 + 全部斜率正 + 放量 → mid_stage</li>
        <li><strong>弱上升</strong> (weak_uptrend): MA 多頭排列但部分斜率 / 量能唔配合 → tentative_rise</li>
        <li><strong>上升回調</strong> (uptrend_correction): 短期急跌但長期仲升 → correction_at_ma20</li>
        <li><strong>橫行</strong> (sideways): 排列亂 + spread &lt; 2% → range_bound</li>
        <li><strong>下跌反彈</strong> (downtrend_bounce): 短期急升但長期仲跌 → bounce_in_progress</li>
        <li><strong>弱下跌</strong> (weak_downtrend): MA 空頭排列但部分斜率 / 量能唔配合 → tentative_fall</li>
        <li><strong>強下跌</strong> (strong_downtrend): MA 完美空頭排列 + 全部斜率負 + 放量 → mid_stage</li>
        <li><strong>到頂轉勢</strong> (decelerating_up): MA5 急跌 3%+ + 長期仲升 + 連跌 4+ 日 → late_stage_topping</li>
        <li><strong>到底轉勢</strong> (decelerating_down): MA5 急升 3%+ + 長期仲跌 + 連升 4+ 日 → late_stage_bottoming</li>
      </ul>
    </div>
  `;
}

// ===== 策略建議 section =====
// 按 9 個 sub-scenario 各自建議 (大少 2026-08-15 M1 v2.1.0)
function renderMAAlignmentV2StrategyAdvice(verdict) {
  const meta = verdict.meta;
  let advice = '';
  if (meta.cycle === 'strong_uptrend') {
    advice = '<p>🟢 <strong>強上升趨勢確認</strong> — 可考慮持有 / 逢回調加倉, 留意 <code>maSlopes[MA5]</code> 唔好轉負, 確認放量跟進。</p>';
  } else if (meta.cycle === 'weak_uptrend') {
    advice = '<p>🟡 <strong>弱上升動能</strong> — 觀察多幾日, 等放量確認再入場。留意 MA5 斜率轉負 = 升勢見頂警號。</p>';
  } else if (meta.cycle === 'uptrend_correction') {
    advice = '<p>🟢 <strong>上升回調中</strong> — 如已持有可續持, 等 MA5 跌到 MA20 附近見支持再考慮加倉。留意 M2 HL Structure 確認有冇破壞 HH / HL 結構。</p>';
  } else if (meta.cycle === 'sideways') {
    advice = '<p>🟡 <strong>橫行整理</strong> — 等待突破方向, 配合 M6 Volatility Squeeze 訊號捕捉突破時機, 留意量能變化 (放量 = 可能突破)。</p>';
  } else if (meta.cycle === 'downtrend_bounce') {
    advice = '<p>🔴 <strong>下跌反彈中</strong> — 如已持貨可考慮喺反彈高位減倉, 唔好因為短暫反彈就以為見底。確認 M2 HL Structure 有冇破壞 LL / LH 結構。</p>';
  } else if (meta.cycle === 'weak_downtrend') {
    advice = '<p>🟡 <strong>弱下跌動能</strong> — 觀察多幾日, 等放量確認再行動, 唔好急住撈底。留意 MA5 斜率轉正 = 跌勢見底警號。</p>';
  } else if (meta.cycle === 'strong_downtrend') {
    advice = '<p>🔴 <strong>強下跌趨勢確認</strong> — 觀望 / 減倉, 等 <code>maSlopes[MA60]</code> 轉正先考慮撈底, 唔好接刀。</p>';
  } else if (meta.cycle === 'decelerating_up') {
    advice = '<p>🟣 <strong>到頂轉勢跡象</strong> — 如已持貨應考慮喺反彈時減倉 / 止賺, 唔好博佢返上去。確認 M2 HL Structure (LH = 見頂確認) + M4 Indicators RSI 背馳。</p>';
  } else if (meta.cycle === 'decelerating_down') {
    advice = '<p>🔵 <strong>到底轉勢跡象</strong> — 如想撈底要等確認: M2 HL Structure 出現 HH (見底確認) + M4 Indicators RSI 唔再背馳。先小注試單, 唔好一次過 all-in。</p>';
  } else {
    advice = '<p>🟡 <strong>結構模糊</strong> — 信心不足, 唔好落大注, 等待 M2 / M3 結構確認, 或者再多睇幾日。</p>';
  }

  return `
    <div class="result-section">
      <h3>🎯 策略建議</h3>
      ${advice}
    </div>
  `;
}

// ===== 點用點睇 section =====
// 12 步 step-by-step guide 教 user 點睇呢個結果 (大少 2026-08-15 M1 v2.1.0 — 加 9 個 sub-scenario 解讀)
function renderMAAlignmentV2UsageGuide(verdict) {
  const meta = verdict.meta;
  return `
    <div class="result-section">
      <h3>💡 點用點睇 (12 步 step-by-step)</h3>
      <ol>
        <li>睇頂部 <code>state-pill</code> 嘅 9 個 sub-scenario 標籤 + <code>週期位置</code> 知邊個 sub-scenario + 邊個 stage</li>
        <li>睇 <code>信心指數 %</code> 同 <code>高 / 中 / 低信心</code> 標籤 — 信心 ≥ 70% 為高信心, 40-70% 中等, &lt; 40% 低</li>
        <li>對比 <code>confidence</code> (綜合) 同 <code>基礎信心</code> — 差越大, 信心調整越多 (縮量 / 斜率負 = 打折)</li>
        <li>睇 <code>📌 判斷</code> box 嘅 <code>reason</code> 知 algorithm 點解咁判 (含 sub-scenario + cyclePosition)</li>
        <li>確認 <code>均線詳細</code> 入面 4 條 MA 嘅值同斜率方向 (↗ 升 / ↘ 跌)</li>
        <li>睇 <code>maSlopes[MA5]</code> 嘅正負 — 短期 MA 斜率係上升動能領先指標</li>
        <li>睇 <code>maSlopes[MA60]</code> 嘅正負 — 長期 MA 斜率係大方向指標</li>
        <li>睇 <code>成交量分析</code> — 近期/前期比 + 訊號 (放量跟 = 真升, 縮量升 = 假升)</li>
        <li>睇 <code>調整記錄</code> 知做咗咩 discount / boost (放量/縮量/斜率)</li>
        <li><strong>9 個 sub-scenario 解讀</strong>: 強升 / 弱升 / 上升回調 = UP; 強跌 / 弱跌 / 下跌反彈 = DOWN; 橫行 / 到頂 / 到底 = SIDEWAYS (transition)</li>
        <li>對比 M2 HL Structure — 確認峰谷結構 (HH/HL = 上升, LH/LL = 下跌), 上升回調 / 下跌反彈 / 到頂 / 到底 尤其重要</li>
        <li>結合多個 module 結果 (M3 Trendline + M4 Indicators + M5 量价 + M6 波動率) 做最終決策</li>
      </ol>
    </div>
  `;
}

function getMAAlignmentV2Help() {
  return `
    <h3>第一模組 v2.1.0 — 均線系統週期判斷法 (9 個 sub-scenario)</h3>
    <p>用 4 條均線 (5/10/20/60 日) 嘅排列 + 斜率 + 成交量, 判斷股票而家係咩週期, 共 9 個 sub-scenario</p>
    <h4>9 個 sub-scenario</h4>
    <ul>
      <li><strong>強上升</strong> (strong_uptrend) — MA 完美多頭排列 + 全部斜率正 + 放量 → mid_stage</li>
      <li><strong>弱上升</strong> (weak_uptrend) — MA 多頭排列但部分斜率 / 量能唔配合 → tentative_rise</li>
      <li><strong>上升回調</strong> (uptrend_correction) — 短期急跌但長期仲升 → correction_at_ma20</li>
      <li><strong>橫行</strong> (sideways) — 排列亂 + spread &lt; 2% → range_bound</li>
      <li><strong>下跌反彈</strong> (downtrend_bounce) — 短期急升但長期仲跌 → bounce_in_progress</li>
      <li><strong>弱下跌</strong> (weak_downtrend) — MA 空頭排列但部分斜率 / 量能唔配合 → tentative_fall</li>
      <li><strong>強下跌</strong> (strong_downtrend) — MA 完美空頭排列 + 全部斜率負 + 放量 → mid_stage</li>
      <li><strong>到頂轉勢</strong> (decelerating_up) — MA5 急跌 3%+ + 長期仲升 + 連跌 4+ 日 → late_stage_topping</li>
      <li><strong>到底轉勢</strong> (decelerating_down) — MA5 急升 3%+ + 長期仲跌 + 連升 4+ 日 → late_stage_bottoming</li>
    </ul>
    <h4>判定優先級</h4>
    <ol>
      <li>到頂 / 到底轉勢 (Priority 1, 最重要, transition 訊號)</li>
      <li>強上升 / 強下跌 (Priority 2, 排列 + 斜率 + 放量全部配合)</li>
      <li>弱上升 / 弱下跌 (Priority 3, 排列對但部分唔配合)</li>
      <li>上升回調 / 下跌反彈 (Priority 4, 短長期分裂)</li>
      <li>橫行 (Default, 排列亂)</li>
    </ol>
    <h4>信心分數 = 基礎 × 成交量 × 斜率</h4>
    <ul>
      <li><strong>基礎分</strong> (0.3-1.0): 強趨勢用 maxSpreadPct / 0.10, 弱趨勢打折 0.7, 橫行用 0.3 + spread offset</li>
      <li><strong>成交量</strong> (0.65-1.25): 升 + 放量 1.25, 升 + 縮量 0.65, 跌 + 放量 1.15, 過渡 1.0</li>
      <li><strong>斜率</strong> (0.7-1.0): 升 + 短期斜率負 0.7, 跌 + 長期斜率正 0.8, 過渡 1.0</li>
    </ul>
  `;
}

// Helper: 計 MA 歷史 series (M1 v2.0 用, 4 條 MA: [5, 10, 20, 60])
// 頭 period-1 個 point 直接 skip (未夠 data 計 MA, 唔出 null 避免 lightweight-charts 當 0 畫)
function _computeMASeriesV2(klines, period) {
  const out = [];
  for (let i = period - 1; i < klines.length; i++) {
    const time = _maNormalizeTime(klines[i].time ?? klines[i].timestamp ?? klines[i].date);
    if (time == null) continue;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += klines[j].close;
    }
    out.push({ time, value: sum / period });
  }
  out.sort((a, b) => a.time - b.time);
  const dedup = [];
  for (let i = 0; i < out.length; i++) {
    if (i === 0 || out[i].time !== out[i - 1].time) dedup.push(out[i]);
  }
  return dedup;
}

// M1 v2.0 嘅 chart overlay (跟 zmen均算法 pattern, 4 條 MA trend lines: MA5/10/20/60)
// 大少 2026-08-08 09:50 指示: M1 v2.0 嘅圖表要加返 MA 線, 參考 zmen均算法
function renderMAAlignmentV2ChartOverlay(verdict, klines, chartRefs) {
  if (!chartRefs || !chartRefs.chart) {
    console.warn('[renderMAAlignmentV2ChartOverlay] chartRefs.chart 缺失');
    return;
  }
  if (!verdict || !verdict.meta) {
    console.warn('[renderMAAlignmentV2ChartOverlay] verdict 缺失');
    return;
  }
  if (!Array.isArray(klines) || klines.length === 0) {
    console.warn('[renderMAAlignmentV2ChartOverlay] klines 缺失或空');
    return;
  }

  const chart = chartRefs.chart;
  if (typeof chart.addSeries !== 'function') {
    console.error('[renderMAAlignmentV2ChartOverlay] chart 冇 addLineSeries method');
    return;
  }

  // 移除舊 MA line series (如果之前 render 過)
  if (chartRefs.maV2LineSeries) {
    for (const key of Object.keys(chartRefs.maV2LineSeries)) {
      try { chart.removeSeries(chartRefs.maV2LineSeries[key]); } catch (e) { /* ignore */ }
    }
  }
  chartRefs.maV2LineSeries = {};

  // 4 條 MA periods (跟 DEFAULT_MA_ALIGNMENT_V2_CONFIG.maPeriods)
  const periods = [5, 10, 20, 60];
  const maColors = {
    5: '#FF6B6B',   // 紅 — 短期趨勢
    10: '#4ECDC4',  // 青 — 中短期趨勢
    20: '#FFA500',  // 橙 — 中期趨勢
    60: '#45B7D1',  // 藍 — 長期趨勢
  };

  for (const period of periods) {
    const series = _computeMASeriesV2(klines, period);
    try {
      const s = chart.addSeries(LightweightCharts.LineSeries, {
        color: maColors[period],
        lineWidth: 2,
        title: `MA${period}`,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      s.setData(series);
      chartRefs.maV2LineSeries[`ma${period}`] = s;
    } catch (e) {
      console.error(`[renderMAAlignmentV2ChartOverlay] MA${period} addLineSeries 失敗:`, e);
    }
  }

  // ============ 大少 2026-08-19 trigger — ZigZag 折線 (5% threshold 過濾 noise) ============
  // 凡人話: 用峰谷拎出重要轉向點, 中間唔畫, 只連 peaks 同 troughs
  // 紫色 line 區分 MA 四條 (紅/青/橙/藍)
  // 大少 2026-08-19 — 由 testing page 嘅 zigzag-enabled checkbox 控制
  const zigzagEnabled = chartRefs.zigzagEnabled !== false;  // 預設 true
  console.log('[M1 v2.0] renderMAAlignmentV2ChartOverlay: zigzagEnabled =', zigzagEnabled, '| verdict.meta.zigzagPoints =', verdict.meta?.zigzagPoints?.length, '個');
  if (zigzagEnabled) {
    try {
      if (verdict.meta && Array.isArray(verdict.meta.zigzagPoints) && verdict.meta.zigzagPoints.length >= 2) {
        const dateToTime = (d) => {
          if (typeof d === 'number') return d > 1e12 ? Math.floor(d / 1000) : d;
          if (typeof d === 'string') return Math.floor(new Date(d).getTime() / 1000);
          return null;
        };
        // 大少 2026-08-30 08:02 補丁 v2 — 紫色 ZigZag line setData value revert 返 wick tip (high/low)
        // 凡人話原因: 大少 reload 撳跑 HK.00981 嗰陣, 4.41.2 business day object time fix work, P 點 x 軸對齊 8月25日 K 線 ✅
        //  但 4.41.0 body middle value fix 錯, P 點 plot 喺 K 線 body middle 67.30, 大少 trigger「price 錯咗, 應該對上 Through 或 Peak」
        //  即係 P 點應該 plot 喺 K 線 low (Through) 65.55 或 high (Peak) 68.2 對應位置, 唔係 body middle
        // Fix: P 點 value revert 返用 algorithm 拎 wick tip (high/low), 唔再用 body middle
        //  配合 4.41.2 business day object time field fix, P 點 plot 喺 K 線 high / low wick tip 對應位置
        //  對齊 4.15.0 永久 rule: 之字拎 point 同 trigger 都用 high/low (wick extreme)
        //  對齊 4.12.0 永久 rule: 紫色 sequence marker label position (high→aboveBar, low→belowBar)
        // 對應 Spec Sync: ARCHITECTURE.md §15.38 補丁 v2 (4.41.0 body middle value fix 撤回, 4.15.0 rule 恢復原狀)
        // 對應 commit: 紫色 ZigZag value revert wick tip + business day object time field fix
        // 對應 commit history:
        //  - 29f7faac 4.41.0 body middle value fix (撤回)
        //  - eb6a6163 4.41.1 debug log (temporary)
        //  - 6627f99b 4.41.2 business day object time field fix (保留)
        //  - 當前 commit 4.41.3 value revert wick tip + 保留 business day object time field fix
        const _zigzagKlineByDate = new Map();
        for (const _zk of (klines || [])) {
          const _zdateStr = _zk.time || _zk.date || _zk.timestamp;
          if (_zdateStr != null) {
            _zigzagKlineByDate.set(String(_zdateStr).slice(0, 10), _zk);
          }
        }
        let zigzagSeries = verdict.meta.zigzagPoints
          .map(p => {
            const _dateKey = String(p.date || '').slice(0, 10);
            const _dateParts = _dateKey.split('-').map(Number);
            const _year = _dateParts[0];
            const _month = _dateParts[1];
            const _day = _dateParts[2];
            if (!_year || !_month || !_day) return null;
            // Render value 用 algorithm 拎 wick tip (high/low), 4.15.0 永久 rule 恢復原狀
            //  對應 K 線 Through (low) 65.55 或 Peak (high) 68.2 wick tip 位置
            return { time: { year: _year, month: _month, day: _day }, value: p.value };
          })
          .filter(p => p != null && Number.isFinite(p.value))
          .sort((a, b) => {
            if (a.time.year !== b.time.year) return a.time.year - b.time.year;
            if (a.time.month !== b.time.month) return a.time.month - b.time.month;
            return a.time.day - b.time.day;
          });
        // 大少 2026-08-30 01:21 — B 方案 v2 治標 frontend defensive:
        // 之字 points 拎 setData 嗰陣, 撞 duplicate time 會令 Lightweight Charts 4.2.3
        // silent reject + 破壞 chart state, 拎 dedupe by time (1st 嗰個) 拎走連續撞
        // 雖然 A3 治本 fix 之後 backend K 線 response 已經 normalized, 但 frontend 之字
        // line silent reject 嗰陣破壞 chart internal state 嘅 risk 仍然有
        const _seenZigzagTimes = new Set();
        const _dedupedZigzagSeries = [];
        for (const p of zigzagSeries) {
          if (!_seenZigzagTimes.has(p.time)) {
            _seenZigzagTimes.add(p.time);
            _dedupedZigzagSeries.push(p);
          }
        }
        if (_dedupedZigzagSeries.length !== zigzagSeries.length) {
          console.warn(
            `[M1 v2.0] dedupe 拎走 ${zigzagSeries.length - _dedupedZigzagSeries.length} 個 ` +
            `duplicate time point (保留 first entry per time)`
          );
        }
        zigzagSeries = _dedupedZigzagSeries;

        if (zigzagSeries.length >= 2) {
          // ============ 大少 2026-08-19 09:40 trigger — 紫色 ZigZag 折線 (原本 peak/trough) ============
          // 凡人話: 用 ZigZag algorithm 拎出嚟嘅 peaks/troughs, 紫色線 (#9C27B0) 代表「確認咗嘅轉向點」
          // 跟 StockPulse ChartContainer 一樣, 唔加 peak/trough 箭嘴 marker
          const s = chart.addSeries(LightweightCharts.LineSeries, {
            color: '#9C27B0',  // 紫色
            lineWidth: 2,
            title: `ZigZag (${verdict.meta.zigzagThreshold || 5}%)`,
            priceLineVisible: false,
            lastValueVisible: true,
            lineStyle: 0,  // 實線
          });
          // 大少 2026-08-30 01:21 — B 方案 v2: try/catch 包住 s.setData 拎走 silent reject,
          // 如果仍然撞 duplicate time 嗰陣 Lightweight Charts 4.2.3 拋 Value is null, 拎走
          // 嗰個 series, 唔破壞 chart state (之後 chart 仍然 render, 只係冇之字線)
          try {
            s.setData(zigzagSeries);
            chartRefs.maV2LineSeries.zigzag = s;
            console.log('[M1 v2.0] ✅ 紫色 ZigZag line series added:', zigzagSeries.length, '個 points, color: #9C27B0');
            // 大少 2026-08-30 07:48 — 自動 verify 紫色 ZigZag P 點 x 軸對齊 K 線 (debug log)
            // 撳跑完 algorithm 嗰陣, 自動 dump 最後 3 個 P 點嘅 time + value 對比 K 線對應 date 嘅 K 線 data
            // 凡人話: 大少撳跑 HK.00981 睇 console 拎 actual plot data, 確認 P 點 x 軸 y 軸位置
            // 輸出範例: P 點 time=1787587200 (2026-08-25) value=67.30, K線對應: O=66.75 H=68.2 L=65.55 C=67.85
            if (zigzagSeries.length > 0) {
              const _last3 = zigzagSeries.slice(-3);
              console.log('[M1 v2.0] 🔍 紫色 ZigZag 最後 3 個 P 點 (auto verify 對齊 K 線):');
              for (const _p of _last3) {
                // 大少 2026-08-30 07:48 補丁 — time field 改用 business day object, 拎返 ISO date 拎 K 線對應
                const _pDate = `${_p.time.year}-${String(_p.time.month).padStart(2, '0')}-${String(_p.time.day).padStart(2, '0')}`;
                const _kl = _zigzagKlineByDate.get(_pDate);
                console.log(`  P 點 time={year:${_p.time.year}, month:${_p.time.month}, day:${_p.time.day}} (${_pDate}) value=${_p.value} ${_kl ? `, K線對應: O=${_kl.open} H=${_kl.high} L=${_kl.low} C=${_kl.close}` : ', K線對應: ❌ 揾唔到 K 線'}`);
              }
              // 同時 dump K 線最後 5 條嘅 setData time, 對比 P 點最後 1 個 time
              // 凡人話: 確認 P 點 time 同 K 線 time 對齊 (如果 K 線用 UTC 0 點, P 點 plot 喺 K 線左邊;
              //  如果 K 線用 UTC noon 對齊, P 點 plot 喺 K 線中段; 等)
              const _klineTimes = [];
              for (let _i = Math.max(0, klines.length - 5); _i < klines.length; _i++) {
                const _k = klines[_i];
                const _kDate = String(_k.time || _k.date || _k.timestamp).slice(0, 10);
                const _kTime = dateToTime(_kDate);
                if (_kTime != null) _klineTimes.push({ date: _kDate, time: _kTime, o: _k.open, h: _k.high, l: _k.low, c: _k.close });
              }
              console.log('[M1 v2.0] 🔍 K 線最後 5 條 setData time (對比 P 點 time 拎 x 軸對齊 reference):');
              for (const _kt of _klineTimes) {
                console.log(`  K線 date=${_kt.date} time=${_kt.time} O=${_kt.o} H=${_kt.h} L=${_kt.l} C=${_kt.c}`);
              }
            }
          } catch (setDataErr) {
            console.warn('[M1 v2.0] ⚠️ 紫色 ZigZag setData 失敗, 拎走 series (避免破壞 chart state):', setDataErr.message);
            try { chart.removeSeries(s); } catch (e) { /* ignore */ }
            chartRefs.maV2LineSeries.zigzag = null;
          }

          // ============ 大少 2026-08-30 17:50 trigger — 橙色 #FF9800 細小旗仔 marker (決定嗰日) ============
          // 凡人話: 紫色 P 點 plot 喺 peak/trough 嗰日, 橙色旗仔 plot 喺「決定嗰日」
          //   (即股價反方向到達 threshold 嗰支 K 線), 等大少知道「上一支 ZigZag 喺邊一日決定形成」
          // 跟 ZigZag 啟用 toggle 同步 (已經喺 if (zigzagEnabled) 入面, 唔加新 toggle)
          // 第一個 point 冇 decisionDate (永遠從第一支 K 線開始, 冇「決定」概念)
          // 最後 ongoing point 都冇 decisionDate (仲未確認轉勢)
          // 對齊 4.40.0 永久 rule: 拎 setData 之前 dedupe by time 避免 silent reject
          const _flagMarkerPoints = [];
          for (const _p of (verdict.meta.zigzagPoints || [])) {
            if (!_p.decisionDate) continue;  // 拎走第一個 point 同最後 ongoing point
            const _dKey = String(_p.decisionDate).slice(0, 10);
            const _dParts = _dKey.split('-').map(Number);
            if (!_dParts[0] || !_dParts[1] || !_dParts[2]) continue;
            // Y position 用 decisionValue (決定嗰日 K 線 close), 唔好直接用 p.value (peak/trough 嗰支 high/low)
            _flagMarkerPoints.push({
              time: { year: _dParts[0], month: _dParts[1], day: _dParts[2] },
              value: Number.isFinite(_p.decisionValue) ? _p.decisionValue : _p.value,
            });
          }
          // 拎 setData 之前 dedupe by time (對齊 4.40.0 永久 rule, 拎走 silent reject)
          const _seenFlagTimes = new Set();
          const _dedupedFlagPoints = [];
          for (const _fp of _flagMarkerPoints) {
            const _tKey = `${_fp.time.year}-${_fp.time.month}-${_fp.time.day}`;
            if (!_seenFlagTimes.has(_tKey)) {
              _seenFlagTimes.add(_tKey);
              _dedupedFlagPoints.push(_fp);
            }
          }
          // 大少 trigger: 細小旗仔 plot 喺決定嗰日 K 線 close 上面 8px, 橙色 #FF9800 (Material Orange 500)
          // 用 Lightweight Charts v4.2.3 setMarkers API shape 'flag' 對齊 setMarkers
          // 跟 sequence marker 一齊 merge 落 candleSeries (因為 setMarkers 係 per series, 唔可以分開 set)
          // 暫時 state 喺 chartRefs.zigzagDecisionFlagMarkers, 跟住 sequence marker set 嗰陣 merge
          // 凡人話: 旗仔 marker 永遠 render (跟 zigzagEnabled), sequence marker 嘅 set/skip 都要 merge 旗仔
          chartRefs.zigzagDecisionFlagMarkers = {
            markers: _dedupedFlagPoints.map(_fp => ({
              time: _fp.time,
              position: 'aboveBar',  // 旗仔喺決定嗰日 K 線上面
              color: '#FF9800',      // Material Orange 500
              shape: 'flag',         // 細小旗仔 (Lightweight Charts v4.2.3 setMarkers 支援 shape)
              text: '',              // 唔顯示號碼, 純視覺 marker
              size: 1,               // 預設大小 (細小)
            })),
          };
          console.log('[M1 v2.0] ✅ 橙色 #FF9800 旗仔 marker state set:', chartRefs.zigzagDecisionFlagMarkers.markers.length, '個 (大少 2026-08-30 17:50 旗仔 marker, sequence set/skip 都會 merge)');

          // ============ 大少 2026-08-19 09:40 trigger — 深綠色 close extension 線 (連去今日收市) ============
          // 凡人話: 紫色 ZigZag 拎到嘅係「確認咗嘅轉向點」, 但 K 線仲有最新嘅 close 仲未確認到下一個 peak/trough
          //   大少想紫色線最後接多一段深綠色線, 由最後 ZigZag point 連去今日 close, 即時見到趨勢延續
          // 凡人話警告: 呢段深綠色線**唔代表 algorithm 確認到轉向**, 只係 visualize 趨勢連貫
          // 用鮮綠色 (#00C853, Material Green A700) — 對比紫色, 唔撞任何 MA 線, 綠色有「現在 / 最新」嘅意思
          // 大少 2026-08-21 11:20 trigger 由深綠色 #2E7D32 改成鮮綠色 #00C853, 跟紫色線有更明顯對比
          //
          // 大少 2026-08-21 11:14 trigger — Bug fix: Phase 1 (4.18.0) 拎走咗 _zigzagNormalizeDate helper,
          //   但 line 5016 仲 call 緊佢 → ReferenceError, 紫色線 render 成功但深綠色 extension line 永遠 skip
          //   改用 inline fallback chain (對齊 testing-page.js _getKlineDateForDebug 嘅 time/date/timestamp 邏輯)
          //
          // 大少 2026-08-30 07:48 補丁 — extension line time field 統一用 business day object,
          //   對齊 P 點 setData 嘅 time field 格式, 避免 type 衝突 silent reject
          //   之前用 timestamp (number), 同 P 點 setData 用 business day object 唔同, 會 silent reject
          //
          // 大少 8月31日 01:59 trigger — 拎返 4.10.0 setMarkers 嗰個 spirit + 改用 v5 createSeriesMarkers plugin API (4.49.0 永久 rule)
          //   對齊 production frontend `web/src/components/chart/ChartContainer.tsx` line 852 嗰個做法
          //   v5 native marker 唔會有 v4.2.3 嗰個 out-of-range marker silent render bug
          //
          // 大少 8月31日 09:00 trigger — 4.51.0 永久 rule: 拎走鮮綠色 close extension 終點嘅 "1" 號 marker
          //   原本 4.9.0 嗰個「1 號 = 鮮綠線終點」規則同大少 8月29日 14:32 P1=zzp[-1] 規則衝突
          //   紫色 marker label 由 `idx + 2` 改 `idx + 1` (P1 = 最新紫色 ZigZag 點), 鮮綠色 1 號 marker 拎走
          //   鮮綠色 close extension 線 保留 (對齊 4.8.3 永久 rule「趨勢延續」視覺化), 但冇 sequence label
          //   保留 `let greenMarkerTime = null` 因為可能之後有其他用途 (e.g. tooltip)
          let greenMarkerTime = null;  // 4.51.0 永久 rule 拎走 "1" 號 marker 之後, 保留 variable 以備將來用
          if (klines && klines.length > 0) {
            const lastKline = klines[klines.length - 1];
            const lastClose = lastKline.close;
            // 凡人話: K 線 dict 嘅 date field 唔同 source 有唔同 field name (time/date/timestamp),
            //   Phase 1 拎走 _zigzagNormalizeDate helper, 改用 inline fallback chain
            const klineDateStr = lastKline.time || lastKline.date || lastKline.timestamp;
            // 統一拎成 business day object 對齊 P 點 setData (4.41.2 補丁)
            const lastDateObj = (() => {
              if (klineDateStr == null) return null;
              let _d = null;
              if (typeof klineDateStr === 'string') {
                _d = new Date(klineDateStr);
              } else if (typeof klineDateStr === 'number') {
                _d = new Date(klineDateStr > 1e12 ? klineDateStr : klineDateStr * 1000);
              }
              if (!_d || isNaN(_d.getTime())) return null;
              return { year: _d.getUTCFullYear(), month: _d.getUTCMonth() + 1, day: _d.getUTCDate() };
            })();
            const lastZigzagPoint = zigzagSeries[zigzagSeries.length - 1];
            if (lastDateObj != null && Number.isFinite(lastClose) && lastZigzagPoint && lastZigzagPoint.time &&
                (lastZigzagPoint.time.year !== lastDateObj.year || lastZigzagPoint.time.month !== lastDateObj.month || lastZigzagPoint.time.day !== lastDateObj.day)) {
              const extSeries = [lastZigzagPoint, { time: lastDateObj, value: lastClose }];
              const sExt = chart.addSeries(LightweightCharts.LineSeries, {
                color: '#00C853',  // 鮮綠色 (大少 2026-08-21 11:20 trigger 由 #2E7D32 改)
                lineWidth: 1.5,
                title: '收市延伸 (Close Ext.)',
                priceLineVisible: false,
                lastValueVisible: true,
                lineStyle: 0,  // 實線
              });
              sExt.setData(extSeries);
              chartRefs.maV2LineSeries.zigzagExtension = sExt;
              greenMarkerTime = lastDateObj;  // 大少 8月31日 01:59 trigger — 拎返 `greenMarkerTime = lastDateObj` 嗰行 (setMarkers 拎返,綠色 1 號 marker 用)
              console.log('[M1 v2.0] ✅ 深綠色 close extension series added: 連去', lastClose, '@', lastDateObj.year + '-' + lastDateObj.month + '-' + lastDateObj.day);
            } else {
              console.log('[M1 v2.0] ℹ️ close extension skip: lastDate 或 lastClose 無效, 或已同 ZigZag 最後 point 重疊');
            }
          }

          // ============ 大少 8月31日 01:59 trigger — 拎返 ZigZag 點順序號碼 setMarkers 改用 v5 createSeriesMarkers plugin API (4.49.0 永久 rule) ============
          //   大少 8月31日 01:02 trigger「問題很大,還是修不好」之後, 4.48.2 永久 rule 拎走 setMarkers 拎走咗
          //   4.48.2 commit (大少 8月31日 01:02 trigger) 拎走 setMarkers 整段, toggle disable, 4.42.2 橙色旗仔 marker 都拎走
          //   大少 8月31日 01:59 trigger「找回 vs 重新做」揀 Approach B: bump testing page v4.2.3 → v5.2.0 + 改用 v5 createSeriesMarkers plugin API
          //   v5 native marker 唔會有 v4.2.3 嗰個 out-of-range marker silent render bug (v5 重新 design), 藍框 bug 唔會返嚟
          //   對齊 production frontend `web/src/components/chart/ChartContainer.tsx` line 852 嗰個做法
          //
          // 4.49.0 永久 rule (新加, 拎返 4.10.0 嗰個 spirit + 改用 v5 plugin API):
          //   ✅ 紫色 ZigZag sequence marker 拎返 (4.10.0 永久 rule 拎返), 改用 v5 createSeriesMarkers plugin API
          //   ✅ 4.42.2 橙色旗仔 marker 拎返 (4.42.2 永久 rule 改寫: v5 plugin API 拎 set 唔到嘅 bug 解咗)
          //   ✅ testing page 同 production frontend 對齊 v5 plugin API pattern (ChartContainer.tsx line 852 嗰個 reference)
          //   ✅ 4.48.2 永久 rule 拎走 setMarkers 改寫為 4.49.0 永久 rule拎返 setMarkers (v5 plugin API)
          //   對齊 4.41.3 永久 rule: 紫色 ZigZag 拎 algorithm 拎 wick tip (high/low) 永久 rule 保留
          //   對齊 4.41.2 永久 rule: 紫色 ZigZag setData time field 統一用 business day object 永久 rule 保留
          //   對齊 4.40.0 永久 rule: 之字 points dedupe by time 永久 rule 保留
          //   對齊 4.15.0 永久 rule: 之字拎 point 同 trigger 都用 high/low (wick extreme) 永久 rule 保留
          //   對齊 4.42.2 永久 rule (改寫): backend ZigZag algorithm 1-to-1 port frontend + 橙色旗仔 marker (v5 plugin API)
          //   對齊 4.42.3 永久 rule: verdict.meta.zigzagPoints undefined fix
          //   對齊 4.43.0 永久 rule: ZigZag 全部 backend 計 + 4 個 query params (threshold_mode / manual_threshold / lookback / multiplier)
          //   對齊 4.45.0 永久 rule (Option B 拎走咗): 4.9.0 永久 rule 拎返嚟 (1 號 = 鮮綠線終點 = out-of-range today close)
          const showZigzagSequence = chartRefs.showZigzagSequence === true;  // 預設 false (toggle off)
          const zigzagSequenceMaxCount = Number.isFinite(chartRefs.zigzagSequenceMaxCount) ? chartRefs.zigzagSequenceMaxCount : 30;
          if (showZigzagSequence && typeof LightweightCharts !== 'undefined' && chartRefs.candleSeries && typeof LightweightCharts.createSeriesMarkers === 'function') {
            try {
              // 拎返 4.10.0 嗰個 setMarkers 整個 block 嗰個 spirit, 改用 v5 createSeriesMarkers plugin API
              // 紫色 ZigZag 161 個 points 倒序排, 號碼 1-161 (P1 = 最新紫色 ZigZag 點 = 倒序後第一個, zzp[-1])
              // 4.51.0 永久 rule: 紫色 marker label 由 `idx + 1` 開始 (對齊大少 8月29日 14:32 P1/P2/P3/P4 indexing 規則)
              // 廢 4.9.0 嗰個「1 號 = 鮮綠色 close extension 終點」規則, 因為同大少 8月29日 P1=zzp[-1] 規則衝突
              // verdict.meta.zigzagPoints 已經係 chronological (舊→新), 倒返轉就係「新→舊」
              // 大少 2026-08-19 16:43 fix — Peak 號碼擺 aboveBar, Trough 號碼擺 belowBar (原本全部 inBar 錯)
              // 凡人話: high type point (Peak / 山頂) 號碼喺 K 線上面, low type point (Trough / 山谷) 號碼喺 K 線下面
              const reversedZigzag = [...zigzagSeries].reverse();
              const reversedZigzagPoints = [...verdict.meta.zigzagPoints].reverse();  // 對齊 type
              const purpleMarkers = reversedZigzag.map((p, idx) => ({
                time: p.time,
                position: reversedZigzagPoints[idx].type === 'high' ? 'aboveBar' : 'belowBar',
                color: '#9C27B0',   // 紫色字
                shape: 'circle',
                text: String(idx + 1),  // 4.51.0 永久 rule: 紫色由 1 號開始 (P1 = 最新紫色 ZigZag 點)
                size: 1,
              }));

              // 4.51.0 永久 rule: 拎走鮮綠色 close extension 終點嘅 "1" 號 marker (原本 4.9.0 規則)
              // 鮮綠色 close extension 線本身保留 (對齊 4.8.3「趨勢延續」視覺化), 但冇 sequence label
              // 大少撳 showZigzagSequence toggle, 由右到左 P1, P2, P3, ... 全部紫色 circle

              // 合併: 全部紫色倒序 1-N (4.51.0 永久 rule, 拎走鮮綠色 greenMarkers)
              const allMarkers = purpleMarkers;

              // 只顯示最近 N 個 (預設 30), 因為 161 個 marker 會太擠
              const visibleMarkers = allMarkers.slice(0, zigzagSequenceMaxCount);

              // 大少 2026-08-30 17:50 — merge 橙色旗仔 marker 一齊 set (因為 setMarkers 係 per series, 唔可以分開 set)
              // 大少 8月31日 01:59 — 改用 v5 createSeriesMarkers plugin API (對齊 ChartContainer.tsx line 852)
              const _flagMarkersForMerge = chartRefs.zigzagDecisionFlagMarkers?.markers || [];
              // 對齊 4.42.2 永久 rule (改寫): 橙色旗仔 marker 拎返 (v5 plugin API 拎 set 唔到嘅 bug 解咗)
              // 對齊 4.10.0 永久 rule: setMarkers API 保留 (v5 plugin API 對應)
              // 大少 8月31日 01:59 trigger — 拎返 setMarkers 改用 v5 createSeriesMarkers plugin API
              // v5 native marker 唔會有 v4.2.3 嗰個 out-of-range marker silent render bug (v5 重新 design)
              const markersPlugin = LightweightCharts.createSeriesMarkers(chartRefs.candleSeries, [..._flagMarkersForMerge, ...visibleMarkers]);

              // 拎出 handle 畀 toggle handler 用 (對齊 4.10.0 + 4.42.2 永久 rule)
              chartRefs.zigzagSequenceMarkers = {
                markers: visibleMarkers,
                setMarkers: (m) => {
                  if (!markersPlugin || typeof markersPlugin.setMarkers !== 'function') return;
                  const _fm = chartRefs.zigzagDecisionFlagMarkers?.markers || [];
                  markersPlugin.setMarkers([..._fm, ...(m || [])]);
                },
              };
              console.log('[M1 v2.0] ✅ ZigZag sequence markers set (4.49.0 永久 rule v5 createSeriesMarkers plugin API + 4.51.0 永久 rule P 點 indexing 統一):', visibleMarkers.length, '個 (max:', zigzagSequenceMaxCount, ', 紫色:', purpleMarkers.length, ', 橙色旗仔:', _flagMarkersForMerge.length, ')');
            } catch (e) {
              console.error('[M1 v2.0] ❌ ZigZag sequence markers 失敗:', e);
            }
          } else {
            // 大少 2026-08-30 17:50 — sequence marker skip 嗰陣, 都要 set 旗仔 marker 落 candleSeries
            // 因為旗仔 marker 永遠 render (跟 zigzagEnabled), 唔可以因為 sequence skip 就唔 render
            // 大少 8月31日 01:59 — 改用 v5 createSeriesMarkers plugin API (對齊 ChartContainer.tsx line 852 嗰個 4.42.2 永久 rule)
            if (chartRefs.candleSeries && typeof LightweightCharts !== 'undefined' && typeof LightweightCharts.createSeriesMarkers === 'function') {
              try {
                const _flagOnlyMarkers = chartRefs.zigzagDecisionFlagMarkers?.markers || [];
                if (_flagOnlyMarkers.length > 0) {
                  LightweightCharts.createSeriesMarkers(chartRefs.candleSeries, _flagOnlyMarkers);
                  console.log('[M1 v2.0] ✅ 橙色 #FF9800 旗仔 marker set (4.42.2 永久 rule v5 plugin API, sequence skip, only flag):', _flagOnlyMarkers.length, '個');
                }
              } catch (e) {
                console.error('[M1 v2.0] ❌ 橙色旗仔 marker (sequence skip) 失敗:', e);
              }
            }
            console.log('[M1 v2.0] ℹ️ ZigZag sequence markers skip: showZigzagSequence =', showZigzagSequence, ', createSeriesMarkers =', typeof (LightweightCharts?.createSeriesMarkers));
          }
        } else {
          console.warn('[M1 v2.0] ⚠️ ZigZag series.length < 2, 唔 render');
        }
      } else {
        console.warn('[M1 v2.0] ⚠️ verdict.meta.zigzagPoints 唔啱 (length:', verdict.meta?.zigzagPoints?.length, ')');
      }
    } catch (e) {
      console.error(`[renderMAAlignmentV2ChartOverlay] ZigZag addLineSeries 失敗:`, e);
    }
  }
}

// 大少 2026-08-11 22:40 — Codebase 註解 Phase 4 partial gap fill
// 對應 modules/ma-alignment.ts v2.0.0
// Spec doc: docs/research/AS-03-cycle-detection/MODULE-01-MA-ALIGNMENT.md
// Algorithm (M1 v2.0): 跟 docx Kimi v2.0 spec 全新做, 3 個 cycle state + 13 個 output fields + 三階段信心調整 + 4 條 MA overlay (5/10/20/60)
// 凡人話: 睇均線排列 + 成交量 + 斜率, 判斷上升/橫行/下跌週期


export const maAlignmentV2Adapter = {
  id: 'AS-03-MA',
  name: '均線系統週期判斷法 (9 個 sub-scenario + 成交量 + 斜率)',
  version: '2.1.0',
  description: '睇均線嘅排列加埋成交量同斜率, 判斷股票而家係咩週期 — 共 9 個 sub-scenario (強升 / 弱升 / 橫行 / 弱跌 / 強跌 / 上升回調 / 下跌反彈 / 到頂轉勢 / 到底轉勢)',
  inputs: [
    // 股票代碼 (大少 #10400 — testing page 統一 auto-complete, 跟首頁 StockSearch UX)
    { key: 'code', label: '股票代碼', type: 'autocomplete', required: true, endpoint: '/api/stocks/search', queryParam: 'q', placeholder: '輸入代碼或名稱', limit: 10, marketFn: 'auto' },
    { key: 'maPeriods', label: '均線週期列表', type: 'string', default: '5,10,20,60' },
    { key: 'thresholdPct', label: '橫行判定閾值 (留空 = adaptive, 數字 = 固定)', type: 'number', default: null, placeholder: '留空用 v2.2.0 adaptive' },
    { key: 'enableVolumeWeight', label: '啟用成交量加權', type: 'checkbox', default: true },
    { key: 'enableSlopeCheck', label: '啟用斜率動能', type: 'checkbox', default: true },
    { key: 'volumeLookback', label: '成交量回顧天數', type: 'number', default: 5, min: 3, max: 20 },
    { key: 'slopeLookback', label: '斜率回顧天數', type: 'number', default: 5, min: 3, max: 20 },
  ],
  analyze: analyzeMAAlignmentV2,
  renderResult: renderMAAlignmentV2Result,
  renderChartOverlay: renderMAAlignmentV2ChartOverlay,
  getHelp: getMAAlignmentV2Help,
};

// =====================================================================
// 2026-08-08 09:13 — zmen均算法 (舊 M1 v0.3.0 抽離獨立)
//   舊 M1 嘅 v0.3.0 邏輯保留, 用 zmenMAAdapter named export 暴露
//   testing page 嘅 zmen均算法 entry 繼續用頂層 default
//   大少 2026-08-15 — zmen v1.0: 改用 zmenMAAdapter 命名 export (testing page 拎呢個 adapter 拎到 renderResult 凡人話 layout)
// =====================================================================

// zmen 凡人話 help (跟 M1 v2.1.0 對齊, 9 個 sub-scenario + Priority 1-5)
function getZmenV10Help() {
  return `
    <h3>zmen均算法 v1.0 — 保留 Layer 1 (10 條 rule) + 加 Layer 2 (9 個 sub-scenario)</h3>
    <p>用 3 條均線 (5/10/60 日) 嘅 10 條 rule A-J 判定 4 個週期 state (UP/DOWN/SIDEWAYS/TRANSITION), 再用 5 個判定優先級 enrich 9 個 sub-scenario (跟 M1 v2.1.0 對齊)。</p>
    <h4>9 個 sub-scenario (Layer 2)</h4>
    <ul>
      <li><strong>強上升</strong> (strong_uptrend) — 強升 rule (A) + 全部 MA 同方向 → mid_stage</li>
      <li><strong>弱上升</strong> (weak_uptrend) — 部分升 rule (F) + 短中期 MA 同方向 → tentative_rise</li>
      <li><strong>上升回調</strong> (uptrend_correction) — F rule + 短期急跌但長期仲升 → correction_at_ma20</li>
      <li><strong>橫行</strong> (sideways) — C/D rule + 排列亂 → range_bound</li>
      <li><strong>下跌反彈</strong> (downtrend_bounce) — G rule + 短期急升但長期仲跌 → bounce_in_progress</li>
      <li><strong>弱下跌</strong> (weak_downtrend) — 部分跌 rule (G) + 短中期 MA 同方向 → tentative_fall</li>
      <li><strong>強下跌</strong> (strong_downtrend) — 強跌 rule (B) + 全部 MA 同方向 → mid_stage</li>
      <li><strong>到頂轉勢</strong> (decelerating_up) — H-reverse-down + 短期急跌 3%+ + 連跌 4+ 日 → late_stage_topping</li>
      <li><strong>到底轉勢</strong> (decelerating_down) — H-reverse-up + 短期急升 3%+ + 連升 4+ 日 → late_stage_bottoming</li>
    </ul>
    <h4>判定優先級</h4>
    <ol>
      <li>到頂 / 到底轉勢 (Priority 1, 最重要, transition 訊號)</li>
      <li>強上升 / 強下跌 (Priority 2, 排列 + 斜率全部配合)</li>
      <li>弱上升 / 弱下跌 (Priority 3, 排列對但部分唔配合)</li>
      <li>上升回調 / 下跌反彈 (Priority 4, 短長期分裂)</li>
      <li>橫行 (Default, 排列亂)</li>
    </ol>
    <h4>Layer 1 4 個 state (保留 zmen v0.3.0)</h4>
    <ul>
      <li><strong>UP</strong> (H/A/F rule 主導) — 上升勢</li>
      <li><strong>DOWN</strong> (B/G rule 主導) — 下跌勢</li>
      <li><strong>SIDEWAYS</strong> (C/D rule 主導) — 橫行</li>
      <li><strong>TRANSITION</strong> (H-reverse rule 觸發) — 7 日內反轉</li>
    </ul>
    <h4>凡人話 warning 注入 (跟 Spec Sync #18 CATEGORY_DISPLAY template)</h4>
    <ul>
      <li><strong>FALLBACK_USED</strong> (🔧 系統) — 10 條 rule 全部 fail, fallback SIDEWAYS</li>
      <li><strong>THRESHOLD_BREACH</strong> (📊 股票狀態) — confidence &lt; 0.4 (信心過低)</li>
      <li><strong>CONFLICT_STATE</strong> (📊 股票狀態) — Layer 2 到頂/到底轉勢 (見頂/見底訊號)</li>
    </ul>
    <h4>凡人話對比 — Zmen 同 M1</h4>
    <p>Zmen (cycle 風格) 同 M1 (docx spec 風格) 兩個 module 拎到 9 個 sub-scenario 之後, 大少可以 testing page 同時睇 M1 + zmen 兩個 view, 對比 cycle 風格 vs spec 風格嘅一致性。</p>
  `;
}

export const zmenMAAdapter = {
  id: 'AS-03',
  name: 'zmen均算法 v1.0 (Layer 1 + Layer 2)',
  version: '1.0.0',
  description: '大少 cycle 風格嘅均線演算法, 保留 Layer 1 (10 條 rule A-J + 4 個 state) + 加 Layer 2 (9 個 sub-scenario + 14 個 field enrich), 跟 M1 v2.1.0 對齊',
  inputs: [
    { key: 'code', label: '股票代碼', type: 'autocomplete', required: true, endpoint: '/api/stocks/search', queryParam: 'q', placeholder: '輸入代碼或名稱', limit: 10, marketFn: 'auto' },
    { key: 'dataWindowDays', label: '回顧天數 (K 線)', type: 'number', default: 1260, min: 60, max: 1260 },
  ],
  analyze: runMAAlignment,
  renderResult: renderMAResult,
  getHelp: getZmenV10Help,
};

// =====================================================================
// 大少 2026-08-08 12:30 — Sprint 1 sub-task 1.4 — M7 Synthesizer adapter
//   M7 Synthesizer (DecisionEngine) 嘅 vanilla JS port
//   spec: docs/research/AS-03-cycle-detection/MODULE-07-08-DECISION-ENGINE.md
//   code (TypeScript source): modules/decision-engine.ts + std-verdict.ts
// =====================================================================

// ---------- 6 個 modules 嘅 base_weight (同 std-verdict.ts) ----------
const DECISION_ENGINE_BASE_WEIGHTS = {
  'ma-alignment': 0.25,
  'hl-structure': 0.15,
  'trendline': 0.20,
  'indicators': 0.15,
  'volume': 0.15,
  'volatility': 0.10,
};

// ---------- 6 維情緒雷達計算 (同 std-verdict.ts computeSentiment6D) ----------
function decisionEngineRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  const tail = closes.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < tail.length; i++) {
    const diff = tail[i] - tail[i - 1];
    if (diff > 0) gains += diff;
    else losses += -diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function decisionEnginePctB(closes, period = 20, stdMult = 2) {
  if (closes.length < period) return 0.5;
  const tail = closes.slice(-period);
  const mean = tail.reduce((a, b) => a + b, 0) / period;
  const sd = Math.sqrt(tail.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period);
  const upper = mean + stdMult * sd;
  const lower = mean - stdMult * sd;
  const last = tail[tail.length - 1];
  if (upper === lower) return 0.5;
  return (last - lower) / (upper - lower);
}

function decisionEngineBiasRatio(closes, period = 20) {
  if (closes.length < period) return 0;
  const mean = closes.slice(-period).reduce((a, b) => a + b, 0) / period;
  if (mean === 0) return 0;
  return (closes[closes.length - 1] - mean) / mean;
}

function decisionEngineATR(klines, period = 20) {
  if (klines.length < 2) return 0;
  const trs = [];
  for (let i = 1; i < klines.length; i++) {
    const tr = Math.max(
      klines[i].high - klines[i].low,
      Math.abs(klines[i].high - klines[i - 1].close),
      Math.abs(klines[i].low - klines[i - 1].close),
    );
    trs.push(tr);
  }
  if (trs.length < period) return trs.reduce((a, b) => a + b, 0) / trs.length;
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

function decisionEngineROC(closes, period = 10) {
  if (closes.length < period + 1) return 0;
  const last = closes[closes.length - 1];
  const past = closes[closes.length - 1 - period];
  if (past === 0) return 0;
  return (last - past) / past;
}

function clampDE(value, min = -1, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function decisionEngineSentiment6D(klines) {
  if (!klines || klines.length === 0) {
    return { rsi: 0, bollinger_pct_b: 0, bias_ratio: 0, vol_skew: 0, turnover: 0, momentum_accel: 0 };
  }
  const closes = klines.map(k => k.close);
  const rsi = clampDE((decisionEngineRSI(closes, 14) - 50) / 50);
  const pctB = decisionEnginePctB(closes, 20, 2);
  const bollinger_pct_b = clampDE(pctB * 2 - 1);
  const biasRaw = decisionEngineBiasRatio(closes, 20);
  const bias_ratio = clampDE(biasRaw / 0.20);

  const vol_skew = klines.length < 30
    ? 0
    : (() => {
        const recent = decisionEngineATR(klines.slice(-10), 10);
        const prev = decisionEngineATR(klines.slice(-30, -10), 20);
        const ratio = prev > 0 ? recent / prev : 1;
        return clampDE((ratio - 1) * 2);
      })();

  const volumes = klines.map(k => k.volume);
  const shortAvg = volumes.length >= 20 ? volumes.slice(-20).reduce((a, b) => a + b, 0) / 20 : 0;
  const longAvg = volumes.length >= 250 ? volumes.slice(-250).reduce((a, b) => a + b, 0) / 250 : 1;
  const turnoverRaw = longAvg > 0 ? shortAvg / longAvg : 1;
  const turnover = clampDE((turnoverRaw - 1) * 1.0);

  const momentum_accel = klines.length < 30
    ? 0
    : (() => {
        const rocNow = decisionEngineROC(closes, 10);
        const closesPrev = closes.slice(0, -5);
        const rocPast = decisionEngineROC(closesPrev, 10);
        return clampDE((rocNow - rocPast) * 5);
      })();

  return { rsi, bollinger_pct_b, bias_ratio, vol_skew, turnover, momentum_accel };
}

// ---------- M7 Synthesizer (DecisionEngine) — 5 個 sub-step ----------
function decisionEngineExpectedReturn(state, confidence) {
  const c = Math.max(0, Math.min(1, confidence));
  switch (state) {
    case 'UP': return +(c * 0.10).toFixed(4);
    case 'DOWN': return -(c * 0.10).toFixed(4);
    case 'TRAP': return -0.05;
    default: return 0;
  }
}

function decisionEngineMaxDD(klines) {
  if (!klines || klines.length < 21) return 0.05;
  const atr = decisionEngineATR(klines, 20);
  const lastClose = klines[klines.length - 1].close;
  if (lastClose === 0) return 0.05;
  return clampDE((atr / lastClose) * 3, 0, 0.30);
}

// 大少 2026-08-15 — M7 優化 Level 2 — M1 動態 base_weight 跟 9 個 sub-scenario
// 凡人話: 強趨勢 (mid_stage) 應該 M1 weight 加重 (0.35), 悶市 (range_bound) 應該減 (0.15)
// 配合 Level 3 expert rules: strong_uptrend + conf ≥ 0.8 + 全部 MA slope 同方向 → weight 加到 0.40
// 大少 揀項 1: 動態 weight, 唔保持固定 0.25
function getM1DynamicWeight(verdict) {
  const cycle = verdict.meta?.cycle;
  const cyclePosition = verdict.meta?.cyclePosition;
  const conf = verdict.confidence;
  const maSlopes = verdict.meta?.maSlopes || {};
  const allSlopesSameDirection = (() => {
    const signs = Object.values(maSlopes).map(s => s >= 0 ? 1 : -1);
    if (signs.length === 0) return false;
    return signs.every(s => s === signs[0]);
  })();

  // Level 3 expert rule 3: 強趨勢 high confidence override → 0.40
  if ((cycle === 'strong_uptrend' || cycle === 'strong_downtrend') && conf >= 0.8 && allSlopesSameDirection) {
    return 0.40;
  }

  // Level 2 動態 weight table
  if (cycle === 'strong_uptrend' || cycle === 'strong_downtrend') return 0.35;  // mid_stage 強趨勢
  if (cycle === 'weak_uptrend' || cycle === 'weak_downtrend') return 0.20;      // tentative 弱趨勢
  if (cycle === 'uptrend_correction' || cycle === 'downtrend_bounce') return 0.22;  // 過渡形態
  if (cycle === 'decelerating_up' || cycle === 'decelerating_down') return 0.18;  // late_stage 警號
  if (cycle === 'sideways') return 0.15;  // range_bound 悶市
  return 0.25;  // 默認
}

function decisionEngineToStandardVerdict(verdict, klines, moduleId) {
  // 大少 2026-08-15 — M1 用動態 base_weight (Level 2 + Level 3 strong trend override), 其他 module 保持固定
  const base_weight = moduleId === 'ma-alignment'
    ? getM1DynamicWeight(verdict)
    : DECISION_ENGINE_BASE_WEIGHTS[moduleId];
  const expected_return = decisionEngineExpectedReturn(verdict.state, verdict.confidence);
  const max_drawdown_estimate = decisionEngineMaxDD(klines);
  const sentiment_6d = decisionEngineSentiment6D(klines);
  const rules_fired = (verdict.evidence || []).map(e => e.type);
  const module_specific = verdict.meta || {};
  return {
    // Plan B fix (大少 2026-08-08 13:30) — defensive state default
    // 如果 verdict.state 係 undefined / null / 空字串 / 唔喺 5 個 value 入面, fallback 去 'SIDEWAYS'
    state: (verdict.state && ['UP', 'DOWN', 'SIDEWAYS', 'TRANSITION', 'TRAP'].includes(verdict.state))
      ? verdict.state
      : 'SIDEWAYS',
    confidence: Math.max(0, Math.min(1, verdict.confidence)),
    base_weight,
    expected_return,
    max_drawdown_estimate,
    sentiment_6d,
    rules_fired,
    module_id: moduleId,
    module_specific,
    timestamp: verdict.timestamp,
  };
}

function decisionEngineComputeSSI(verdicts) {
  const stateCount = {};
  for (const v of verdicts) {
    stateCount[v.state] = (stateCount[v.state] || 0) + 1;
  }
  const maxCount = Math.max(...Object.values(stateCount), 0);
  const consistency = verdicts.length > 0 ? maxCount / verdicts.length : 0;

  const totalWeight = verdicts.reduce((acc, v) => acc + v.base_weight, 0);
  const confidence_avg = totalWeight > 0
    ? verdicts.reduce((acc, v) => acc + v.confidence * v.base_weight, 0) / totalWeight
    : 0;

  const allRules = new Set();
  for (const v of verdicts) for (const r of v.rules_fired) allRules.add(r);
  const MAX_UNIQUE_RULES = 20;
  const rules_coverage = Math.min(1, allRules.size / MAX_UNIQUE_RULES);

  const ssi_score = consistency * 50 + confidence_avg * 30 + rules_coverage * 20;
  return {
    ssi_score: Math.round(ssi_score * 10) / 10,
    breakdown: {
      consistency: Math.round(consistency * 1000) / 1000,
      confidence_avg: Math.round(confidence_avg * 1000) / 1000,
      rules_coverage: Math.round(rules_coverage * 1000) / 1000,
    },
  };
}

function isOppositeState(s1, s2) {
  return (s1 === 'UP' && s2 === 'DOWN') || (s1 === 'DOWN' && s2 === 'UP');
}

function decisionEngineComputeTCM(verdicts) {
  const map = new Map(verdicts.map(v => [v.module_id, v]));
  const pairs = [
    ['ma-alignment', 'trendline'],
    ['hl-structure', 'volume'],
    ['indicators', 'volatility'],
  ];
  return pairs.map(([id1, id2]) => {
    const v1 = map.get(id1);
    const v2 = map.get(id2);
    if (!v1 || !v2) return { pair: [id1, id2], alignment: 0, trap_penalty: 0 };
    let alignment;
    if (v1.state === v2.state) alignment = 1.0;
    else if (isOppositeState(v1.state, v2.state)) alignment = -1.0;
    else alignment = 0;
    let trap_penalty;
    if (alignment === -1) trap_penalty = 0.6;
    else if (alignment === 0) trap_penalty = 0.2;
    else trap_penalty = 0;
    return { pair: [id1, id2], alignment, trap_penalty };
  });
}

function decisionEngineComputeAlignment(verdicts) {
  if (verdicts.length === 0) return 0;
  const stateCount = {};
  for (const v of verdicts) stateCount[v.state] = (stateCount[v.state] || 0) + 1;
  let alignment = Math.max(...Object.values(stateCount)) / verdicts.length;

  // 大少 2026-08-15 — M7 優化 Level 4 — 2 條 cross-module alignment enrich rule
  // Rule 1: M1 momentumScore 對齊 M1 cycle state — 矛盾 → 額外扣 alignment 5%
  //   M1 cycle=UP 但 momentumScore<0 = 短期動能背馳
  //   M1 cycle=DOWN 但 momentumScore>0 = 短期動能背馳
  const maV = verdicts.find(v => v.module_id === 'ma-alignment');
  if (maV && maV.module_specific) {
    const m1Cycle = maV.module_specific.cycle;
    const momentum = maV.module_specific.momentumScore || 0;
    if ((m1Cycle === 'strong_uptrend' || m1Cycle === 'weak_uptrend' || m1Cycle === 'uptrend_correction') && momentum < 0) {
      alignment = Math.max(0, alignment - 0.05);
    } else if ((m1Cycle === 'strong_downtrend' || m1Cycle === 'weak_downtrend' || m1Cycle === 'downtrend_bounce') && momentum > 0) {
      alignment = Math.max(0, alignment - 0.05);
    }

    // Rule 2: M1 volumeSignal 對齊 M5 volume verdict — 矛盾 → 額外扣 alignment 5%
    //   M1 expanding (放量) + M5 vol ratio < 0.8 (縮量) = 量能矛盾
    //   M1 shrinking (縮量) + M5 vol ratio > 1.2 (放量) = 量能矛盾
    const m1VolSignal = maV.module_specific.volumeSignal;
    const m5V = verdicts.find(v => v.module_id === 'volume');
    if (m5V && m5V.module_specific) {
      const m5VolRatio = m5V.module_specific.volumeTrendRatio || 1.0;
      if (m1VolSignal === 'expanding' && m5VolRatio < 0.8) {
        alignment = Math.max(0, alignment - 0.05);
      } else if (m1VolSignal === 'shrinking' && m5VolRatio > 1.2) {
        alignment = Math.max(0, alignment - 0.05);
      }
    }
  }

  return Math.round(alignment * 1000) / 1000;
}

function decisionEngineComputeGrade(ssi_score, alignment_score) {
  const grade_score = Math.round((ssi_score * 0.6 + alignment_score * 100 * 0.4) * 10) / 10;
  let grade;
  if (grade_score >= 90) grade = 'A+';
  else if (grade_score >= 80) grade = 'A';
  else if (grade_score >= 70) grade = 'B+';
  else if (grade_score >= 60) grade = 'B';
  else if (grade_score >= 50) grade = 'C+';
  else if (grade_score >= 40) grade = 'C';
  else if (grade_score >= 30) grade = 'D';
  else grade = 'F';
  return {
    grade,
    grade_score,
    reason: `分數 ${grade_score} (SSI ${ssi_score} × 60% + Alignment ${(alignment_score * 100).toFixed(1)} × 40%) → ${grade}`,
  };
}

// 大少 2026-08-21 12:04 — Stage 2 第一步: ZigZagSlope cross-module alignment enrichment
// 凡人話: 拎 M1 verdict 嘅 meta.zigzagSlope 短期斜率做 cross-module alignment check
//         M1 cycle UP + ZigZag 短期急跌 → 短期動能背馳 → 扣 alignment 5%
//         M1 cycle DOWN + ZigZag 短期急升 → 短期反彈背馳 → 扣 alignment 5%
// 對應 spec: MODULE-07-SYNTHESIZER.md v2.1.0 Level 4 cross-module alignment enrich
// 對應 backend: backend/algorithms/synthesizer/algorithm.py:_compute_zigzag_alignment
// Frontend aggregator 拎 standardVerdicts[0].module_specific.zigzagSlope (decisionEngineToStandardVerdict 已經將 M1 full meta 拎入 module_specific)
function decisionEngineComputeZigzagAlignment(standardVerdicts) {
  const ZIGZAG_DAILY_SLOPE_THRESHOLD = 2.0;  // 凡人話: 短期 dailySlope 門檻 (絕對值 > 2%/日 視為急變)
  const ZIGZAG_PENALTY = 0.05;              // 凡人話: 每條 rule 嘅 alignment penalty (5%)

  // 拎 M1 verdict 從 standardVerdicts
  const m1Standard = standardVerdicts.find(v => v && v.module_id === 'ma-alignment');
  if (!m1Standard) {
    return { penalty: 0, reasons: [], m1_state: null, zigzag_slope: null };
  }

  const m1State = m1Standard.state;
  const m1ModuleSpecific = m1Standard.module_specific || {};
  const zigzagSlope = m1ModuleSpecific.zigzagSlope;

  let penalty = 0;
  const reasons = [];

  if (zigzagSlope && zigzagSlope.ok && zigzagSlope.lastToToday) {
    const lastToToday = zigzagSlope.lastToToday;
    const dailySlope = lastToToday.dailySlope || 0;

    // Rule 1: M1 UP + ZigZag 短期急跌 → 短期動能背馳
    if (m1State === 'UP' && dailySlope < -ZIGZAG_DAILY_SLOPE_THRESHOLD) {
      penalty += ZIGZAG_PENALTY;
      reasons.push(
        `M1 上升趨勢 (UP) 但 ZigZag 短期急跌 ${dailySlope.toFixed(2)}%/日 ` +
        `(最後 1 點 ${lastToToday.from?.date || '?'} → 今日 ${lastToToday.to?.date || '?'}), ` +
        `短期動能背馳, 扣 alignment ${ZIGZAG_PENALTY * 100}%`
      );
    }
    // Rule 2: M1 DOWN + ZigZag 短期急升 → 短期反彈背馳
    else if (m1State === 'DOWN' && dailySlope > ZIGZAG_DAILY_SLOPE_THRESHOLD) {
      penalty += ZIGZAG_PENALTY;
      reasons.push(
        `M1 下跌趨勢 (DOWN) 但 ZigZag 短期急升 +${dailySlope.toFixed(2)}%/日 ` +
        `(最後 1 點 ${lastToToday.from?.date || '?'} → 今日 ${lastToToday.to?.date || '?'}), ` +
        `短期反彈背馳, 扣 alignment ${ZIGZAG_PENALTY * 100}%`
      );
    }
  }

  return { penalty, reasons, m1_state: m1State, zigzag_slope: zigzagSlope };
}

function decisionEngineComputeKelly(verdicts) {
  if (verdicts.length === 0) return { fraction: 'quarter', numeric: 0.25, position: 0.25 };
  const avgDD = verdicts.reduce((acc, v) => acc + v.max_drawdown_estimate, 0) / verdicts.length;
  let fraction, numeric;
  if (avgDD < 0.05) { fraction = 'half'; numeric = 0.5; }
  else if (avgDD < 0.10) { fraction = 'quarter'; numeric = 0.25; }
  else { fraction = 'octo'; numeric = 0.125; }
  return { fraction, numeric, position: numeric };
}

// ============================================================================
//  M7 Synthesizer 主入口 — analyzeDecisionEngine (M7 v1.0.0 — Sprint 2 收官)
//
//  目的: 拎 6 個子模組 verdict (M1 均線 / M2 峰谷 / M3 趨勢線 / M4 動能 /
//        M5 量價 / M6 波動), 跑 5 個 sub-step 推導出最終 ssi_score / grade /
//        6×6 TCM matrix / 凱利倉位 fraction。
//
//  Input  : klines  = 標準化 K 線 array (open/high/low/close/volume/...)
//           options = { code, dataWindowDays, ... } 額外選項
//
//  Output : SynthesizerVerdict 結構, 包含:
//           - ssi_score (0-100, 越高越強)  / grade (A+ ~ F)
//           - tcm_matrix 6×6 配對表 (每對 module 嘅 pairing verdict)
//           - alignment_score (6 個 module 嘅 confidence 平均)
//           - kelly_fraction / kelly_numeric / kelly_position (凱利倉位)
//           - module_verdicts: 6 個 sub-verdict
//           - _warnings: 5 個層級 inline 警告 (依 Module Warning System 永久 rule)
//
//  Algorithm 5 個 sub-step:
//    1. 跑 6 個 analyze*() 模組 (Promise.all 並行)
//    2. 透過 decisionEngineToStandardVerdict 轉做 standard format
//    3. computeSentiment6D: 6 維情緒雷達 (consistency/conf_avg/rules_cov/sent_6d/cycle/health)
//    4. computeAlignment: 6 個 module verdict 嘅 alignment score (平均 confidence)
//    5. computeGrade: SSI×60% + Alignment×40% → grade_score → A+/A/B/C/D/F
//    6. computeKelly: 平均 max_drawdown_estimate → half/quarter/octo
//    7. propagate warnings: collect 6 個 module 嘅 _warnings + 加 M7 自己嘅 (e.g. MODULE_PARTIAL)
//
//  ⚠️ 永久 rule: 對外一定要有 _warnings array (Module Warning System v1.0.0)
//  ⚠️ Warning 永遠 inlined verdict 入面, 唔好寫入 DB table
//  ⚠️ Cross-ref: lib/warnings.mjs (makeWarning), backend/services/warning_collector.py
// ============================================================================
export async function analyzeDecisionEngine(klines, options = {}) {
  // 1) 跑 6 個 modules
  const [
    maVerdict, hlVerdict, tlVerdict, indVerdict, vpVerdict, volVerdict,
  ] = await Promise.all([
    analyzeMAAlignmentV2(klines, options),
    analyzeHLStructure(klines, options),
    analyzeTrendline(klines, options),
    analyzeIndicators(klines, options),
    analyzeVolumePrice(klines, options),
    analyzeVolatility(klines, options),
  ]);

  // 2) Transform 去 standard verdict
  const standardVerdicts = [
    decisionEngineToStandardVerdict(maVerdict, klines, 'ma-alignment'),
    decisionEngineToStandardVerdict(hlVerdict, klines, 'hl-structure'),
    decisionEngineToStandardVerdict(tlVerdict, klines, 'trendline'),
    decisionEngineToStandardVerdict(indVerdict, klines, 'indicators'),
    decisionEngineToStandardVerdict(vpVerdict, klines, 'volume'),
    decisionEngineToStandardVerdict(volVerdict, klines, 'volatility'),
  ];

  // 3) 5 個 sub-step aggregation
  if (standardVerdicts.length === 0) {
    return {
      ssi_score: 0, ssi_breakdown: { consistency: 0, confidence_avg: 0, rules_coverage: 0 },
      tcm_matrix: [], alignment_score: 0, grade: 'F', grade_score: 0,
      grade_reason: '無 module verdicts',
      kelly_fraction: 'quarter', kelly_numeric: 0.25, kelly_position: 0.25,
      module_verdicts: [], module_cycle_verdicts: { maVerdict, hlVerdict, tlVerdict, indVerdict, vpVerdict, volVerdict },
      timestamp: Date.now(),
    };
  }

  const { ssi_score, breakdown } = decisionEngineComputeSSI(standardVerdicts);
  const tcm_matrix = decisionEngineComputeTCM(standardVerdicts);
  const alignment_score = decisionEngineComputeAlignment(standardVerdicts);

  // 大少 2026-08-21 12:04 — Stage 2 第一步: ZigZagSlope cross-module alignment enrichment
  // 拎 M1 verdict 嘅 meta.zigzagSlope 做 cross-module alignment check
  // 扣 alignment 但唔直接改 grade (跟 spec: Level 4 cross-module alignment enrich)
  const zigzagAlignment = decisionEngineComputeZigzagAlignment(standardVerdicts);
  const zigzag_alignment_penalty = zigzagAlignment.penalty;
  const zigzag_alignment_reasons = zigzagAlignment.reasons;
  const alignment_score_after_penalty = Math.max(0, alignment_score - zigzag_alignment_penalty);

  // Step 4: Grade (用 penalty 後嘅 alignment_score)
  const { grade, grade_score, reason } = decisionEngineComputeGrade(ssi_score, alignment_score_after_penalty);
  const { fraction, numeric, position } = decisionEngineComputeKelly(standardVerdicts);

  // 大少 2026-08-11 — Module Warning System v1.0.0 (Phase 5a) — M7 Synthesizer
  // 收集 6 個 module verdict 嘅 _warnings (propagation M1-M6 → M7) + M7 自己 generate
  // 警告注入:
  //   🔴 NAN_RESULT: ssi_score / alignment_score / grade_score 任何一個 NaN
  //   🟡 MODULE_PARTIAL: 6 個 module 入面拎唔到 1+ 個 (standardVerdicts.length < 6)
  //   🟡 CONFLICT_STATE: 兩個 module state 衝突 (M1 UP + zmen DOWN, 需用 maVerdict + zmen)
  const m7Warnings = [];
  // 1. 收集 M1-M6 嘅 _warnings (propagation)
  //    用 raw verdicts (maVerdict etc.) 而唔係 standardVerdicts, 因為 decisionEngineToStandardVerdict 唔 propagate _warnings
  const allModuleVerdicts = [maVerdict, hlVerdict, tlVerdict, indVerdict, vpVerdict, volVerdict];
  for (const v of allModuleVerdicts) {
    if (v && v._warnings && Array.isArray(v._warnings)) {
      m7Warnings.push(...v._warnings);
    }
  }
  // 2. M7 自己 generate
  // 2a. NAN check
  const nanFields = [];
  if (!isFinite(ssi_score)) nanFields.push('ssi_score');
  if (!isFinite(alignment_score)) nanFields.push('alignment_score');
  if (!isFinite(grade_score)) nanFields.push('grade_score');

  // 2b. 大少 2026-08-15 — M7 優化 Level 3 — 2 條 M1 expert rules override
  //   Rule 1: M1 cycle = decelerating_up + consecutiveDays ≥ 5 → M7 自動加 TRANSITION 警號
  //   Rule 2: M1 cycle = decelerating_down + consecutiveDays ≥ 5 → M7 自動加 TRANSITION 警號
  //   Rule 3: M1 cycle = strong_uptrend/downtrend + conf ≥ 0.8 + 全部 MA slope 同方向 → M1 weight 加到 0.40 (已經喺 getM1DynamicWeight 做咗)
  if (maVerdict && maVerdict.meta) {
    const m1Cycle = maVerdict.meta.cycle;
    const consecutiveDays = maVerdict.meta.consecutiveDays || 0;
    if (m1Cycle === 'decelerating_up' && consecutiveDays >= 5) {
      m7Warnings.push(makeWarning('warning', 'M7', 'CONFLICT_STATE',
        'M7 見到 M1 到頂轉勢警號',
        {
          issue: `M1 cycle = ${m1Cycle} + 連跌 ${consecutiveDays} 日 (≥ 5 日, 見頂跡象, 即使其他 module 仲見 UP)`,
          impact: 'Verdict 已經準確, 留意股票狀態',
          fix: '睇其他 module 確認 / 留意 M7 alignment',
          context: { m1_cycle: m1Cycle, consecutive_days: consecutiveDays, override: 'transition_alert' },
        }
      ));
    }
    if (m1Cycle === 'decelerating_down' && consecutiveDays >= 5) {
      m7Warnings.push(makeWarning('warning', 'M7', 'CONFLICT_STATE',
        'M7 見到 M1 到底轉勢警號',
        {
          issue: `M1 cycle = ${m1Cycle} + 連升 ${consecutiveDays} 日 (≥ 5 日, 見底跡象, 即使其他 module 仲見 DOWN)`,
          impact: 'Verdict 已經準確, 留意股票狀態',
          fix: '睇其他 module 確認 / 留意 M7 alignment',
          context: { m1_cycle: m1Cycle, consecutive_days: consecutiveDays, override: 'transition_alert' },
        }
      ));
    }
  }

  if (nanFields.length > 0) {
    m7Warnings.push(makeWarning('critical', 'M7', 'NAN_RESULT',
      'M7 綜合判定計算結果 NaN',
      {
        issue: `${nanFields.join('/')} 結果係 NaN 或 Infinity`,
        impact: 'Verdict 唔可信, 唔好落單',
        fix: 'Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc',
        context: { nan_fields: nanFields, ssi_score, alignment_score, grade_score },
      }
    ));
  }
  // 2b. MODULE_PARTIAL check
  const validVerdicts = standardVerdicts.filter(v => v && v.state);
  if (validVerdicts.length < 6) {
    m7Warnings.push(makeWarning('warning', 'M7', 'MODULE_PARTIAL',
      `6 個 module 入面拎唔到 ${6 - validVerdicts.length} 個`,
      {
        issue: `standardVerdicts.length = ${validVerdicts.length} < 6`,
        impact: 'Verdict 唔可信, 唔好落單',
        fix: 'Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc',
        context: { valid_count: validVerdicts.length, missing: 6 - validVerdicts.length },
      }
    ));
  }
  // 2c. CONFLICT_STATE check (M1 vs zmen, 需要拎 zmen verdict, 但 zmen 喺 decisionEngineAdapter 跑嘅, 呢度冇)
  // 簡化: 睇 maVerdict 嘅 state, 如果唔一致就 conflict
  const maState = maVerdict?.state;
  if (maState === 'UP' || maState === 'DOWN') {
    // 暫時 skip (zmen verdict 喺 M8 度拎)
  }

  return {
    ssi_score,
    ssi_breakdown: breakdown,
    tcm_matrix,
    alignment_score,
    // 大少 2026-08-21 12:04 — Stage 2 第一步: ZigZagSlope enrichment
    alignment_score_after_penalty,
    zigzag_alignment_penalty,
    zigzag_alignment_reasons,
    grade,
    grade_score,
    grade_reason: reason,
    kelly_fraction: fraction,
    kelly_numeric: numeric,
    kelly_position: position,
    module_verdicts: standardVerdicts,
    module_cycle_verdicts: { maVerdict, hlVerdict, tlVerdict, indVerdict, vpVerdict, volVerdict },
    _warnings: m7Warnings,  // 大少 2026-08-11 v1.0.0
    timestamp: Date.now(),
  };
}

// ---------- renderDecisionEngineResult — Sprint 1 簡化版 ----------
function decisionEngineStateColor(state) {
  if (state === 'UP') return '#26BA75';        // 🟢 強勢
  if (state === 'DOWN') return '#EE5151';      // 🔴 弱勢
  if (state === 'TRAP') return '#722ed1';      // 🟣 陷阱
  return '#F39C12';                              // 🟡 中性 (SIDEWAYS / TRANSITION)
}

function decisionEngineGradeColor(grade) {
  if (grade === 'A+' || grade === 'A') return '#26BA75';
  if (grade === 'B+' || grade === 'B') return '#1890ff';
  if (grade === 'C+' || grade === 'C') return '#F39C12';
  return '#EE5151';
}

function decisionEngineKellyLabel(fraction) {
  if (fraction === 'half') return '半倉 (50%)';
  if (fraction === 'quarter') return '四分一倉 (25%)';
  return '八分一倉 (12.5%)';
}

// =============================================================
// 大少 2026-08-11 19:55 — B 改善: 頂部最佳設定時段 banner
// =============================================================
// 凡人話: M8 verdict 頂部加 1 個小 banner, 大少一眼睇到 M8 用咗幾時嘅最佳設定(由 M9 cache 嚟)
//
// 3 種狀況 (凡人話 1 句講晒):
//   - 冇 cache (source='fresh-calibrate'): 今日先第一次跑, 用咗 default, 建議先跑 M9
//   - 有 cache + < 7 日: 用咗幾時嘅最佳設定, 仲有幾多日有效
//   - 有 cache + ≥ 7 日: 已過期, 強烈建議重跑 M9 (C 改善會自動 hint)
//
// Style: inline CSS (跟既有 warning banner 風格), 唔依賴外部 CSS file
//
// 永久 rule:
//   - optimal_params_source 唔好寫入 DB table (純 verdict 內部欄位)
//   - 用 cacheInfo.last_calibrated (由 /api/adaptive-params/{symbol} 拎, 大少 22:28 永久 rule)

const SEVEN_DAYS_SECONDS = 7 * 24 * 3600;

function renderOptimalParamsBanner(verdict) {
  const ts = verdict?.optimal_params_timestamp;
  const source = verdict?.optimal_params_source || 'fresh-calibrate';
  const ageSec = verdict?.optimal_params_age_seconds;

  // Case 1: 冇 cache / fresh-calibrate (第一次跑 / cache 過期被清)
  if (!ts || source === 'fresh-calibrate') {
    return `
      <div class="optimal-params-banner optimal-params-banner-warning" style="background:#fffbe6;border:2px solid #FAAD14;border-radius:8px;padding:10px 16px;margin:16px 0;font-family:system-ui,sans-serif;font-size:13px;">
        <span style="font-size:16px;">🟡</span>
        <strong style="color:#FAAD14;">未跑過 M9</strong>
        <span style="color:#666;margin-left:8px;">— M8 用咗 default 設定, 建議先跑 M9 (回測) 拎呢隻股票嘅最佳設定</span>
      </div>
    `;
  }

  // Case 2/3: 有 cache, 計算 age
  const effectiveAgeSec = (typeof ageSec === 'number' && ageSec >= 0)
    ? ageSec
    : Math.max(0, Math.floor((Date.now() / 1000) - ts));
  const ageDays = Math.floor(effectiveAgeSec / 86400);
  const date = new Date(ts * 1000);
  const dateStr = date.toISOString().substring(0, 10);
  const timeStr = date.toISOString().substring(11, 16);
  const remainingDays = Math.max(0, 7 - ageDays);

  // Case 3: 已過期 (≥ 7 日)
  if (effectiveAgeSec >= SEVEN_DAYS_SECONDS) {
    return `
      <div class="optimal-params-banner optimal-params-banner-critical" style="background:#fff1f0;border:2px solid #EE5151;border-radius:8px;padding:10px 16px;margin:16px 0;font-family:system-ui,sans-serif;font-size:13px;">
        <span style="font-size:16px;">🔴</span>
        <strong style="color:#EE5151;">M9 最佳設定已過期</strong>
        <span style="color:#666;margin-left:8px;">— 用咗 ${dateStr} ${timeStr} 嘅設定(已過 ${ageDays} 日), 強烈建議重跑 M9</span>
      </div>
    `;
  }

  // Case 2: 仲有效 (< 7 日)
  return `
    <div class="optimal-params-banner optimal-params-banner-ok" style="background:#f6ffed;border:2px solid #52c41a;border-radius:8px;padding:10px 16px;margin:16px 0;font-family:system-ui,sans-serif;font-size:13px;">
      <span style="font-size:16px;">🟢</span>
      <strong style="color:#52c41a;">M8 用咗 ${dateStr} ${timeStr} 嘅最佳設定</strong>
      <span style="color:#666;margin-left:8px;">(由 M9 cache 嚟, ${ageDays} 日內有效, 仲有 ${remainingDays} 日)</span>
    </div>
  `;
}

// =============================================================
// 大少 2026-08-11 22:05 — 改善 1: M9 summary sub-section
// =============================================================
// 凡人話: M8 verdict 嘅 banner 之後, 自動加 1 個 M9 summary 小卡 (從 cache 拎 optimal data)
//         大少唔需要再撳 M9 module 跑, 就可以見到 M9 拎咗咩 optimal 設定畀 M8
//
// 條件: verdict.optimal_data 唔係 null (即 M9 cache 有 optimal)
//       拎到就 render 5 個 metric + hint
//
// 永久 rule:
//   - verdict.optimal_data 永遠 inlined (唔入 DB table, 跟 Module Warning System 永久 rule)
//   - 拎 data 從 /api/adaptive-params/{symbol}/back-test (30 日 expiry)
//   - 唔影響 M8 verdict 邏輯, 純 additive sub-section
// =============================================================

function renderM9Summary(verdict) {
  const optimalData = verdict?.optimal_data;
  if (!optimalData) {
    // 冇 M9 cache, 唔 render sub-section (banner 已經提示「未跑過 M9」)
    return '';
  }

  const optimalParams = optimalData.optimal_params || {};
  const validation = optimalData.validation || {};
  const kelly = optimalParams.kelly;
  const rsiWeight = optimalParams.rsiWeight;
  const ssiWeights = optimalParams.ssiWeights || {};
  const avgValidateScore = validation.avgValidateScore;
  const stabilityScore = validation.stabilityScore;
  const totalValidateSamples = validation.totalValidateSamples;
  const foldsCount = optimalData.folds_count || 3;

  // 格式化 kelly (0.125 / 0.25 / 0.5 → 1/8 / 1/4 / 1/2)
  const kellyLabel = kelly === 0.125 ? '1/8 倉' : kelly === 0.25 ? '1/4 倉' : kelly === 0.5 ? '1/2 倉' : `${(kelly * 100).toFixed(0)}%`;

  // 5 個 metric mini-cards (凡人話: 一眼睇晒 M9 拎咗咩設定)
  const cards = [
    {
      label: '凱利倉位',
      value: kellyLabel,
      hint: '每注落幾多成倉 (M9 過去試過最佳)',
      color: '#722ed1',
    },
    {
      label: 'RSI 權重',
      value: rsiWeight != null ? rsiWeight.toFixed(2) : 'N/A',
      hint: 'RSI 對 SSI 影響比重 (0-1)',
      color: '#1890ff',
    },
    {
      label: '均線 / 峰谷 / 趨勢線',
      value: ssiWeights.ma != null ? `${(ssiWeights.ma * 100).toFixed(0)}% / ${(ssiWeights.hl * 100).toFixed(0)}% / ${(ssiWeights.tl * 100).toFixed(0)}%` : 'N/A',
      hint: '3 個模組嘅 SSI 權重 (加埋 = 100%)',
      color: '#13c2c2',
    },
    {
      label: '穩定度分數',
      value: stabilityScore != null ? stabilityScore.toFixed(1) : 'N/A',
      hint: '0-100 分, 越高越穩定 (≥ 70 算穩陣)',
      color: stabilityScore != null && stabilityScore >= 70 ? '#52c41a' : stabilityScore != null && stabilityScore >= 50 ? '#FAAD14' : '#EE5151',
    },
    {
      label: '樣本 / 段數',
      value: `${totalValidateSamples || 0} / ${foldsCount}`,
      hint: '過去試過幾多個 / 切做幾多段 (≥ 30 樣本先可信)',
      color: '#F39C12',
    },
  ];

  const cardsHTML = cards.map(c => `
    <div style="flex:1;min-width:140px;background:#fafafa;border:1px solid #e0e0e0;border-radius:6px;padding:10px 12px;">
      <div style="font-size:11px;color:#999;margin-bottom:4px;">${c.label}</div>
      <div style="font-size:18px;font-weight:700;color:${c.color};line-height:1.2;">${c.value}</div>
      <div style="font-size:10px;color:#888;margin-top:4px;line-height:1.3;">${c.hint}</div>
    </div>
  `).join('');

  return `
    <div class="m9-summary-section" style="background:#f9f0ff;border:1px solid #722ed1;border-radius:8px;padding:14px 16px;margin:16px 0;font-family:system-ui,sans-serif;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <strong style="font-size:14px;color:#722ed1;">📊 M9 最佳設定摘要 (從 cache 拎, 大少無需再撳 M9 module 跑)</strong>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
        ${cardsHTML}
      </div>
      <div style="font-size:12px;color:#666;padding-top:8px;border-top:1px dashed #d9d9d9;">
        💡 想睇詳細 M9 verdict (walk-forward CV 段結果 + 過去判決 + 命中率), 撳 M9 module (09 — AS-03-BT) 跑
      </div>
    </div>
  `;
}

// =============================================================
// Sprint 2 sub-task 2.1 — M8 helpers (finalAction color/label/emoji + 連漲日數)
// =============================================================

/** 計算連續上漲日數 (大少 13:30 spec: 連漲 ≥ 3 日 trigger ADD)
 *  從最後一日倒數計, 一直數到第一日唔升為止
 *  @param {Array<{close: number}>} klines
 *  @returns {number} 連續上漲日數
 */
function computeConsecutiveUpDays(klines) {
  if (!klines || klines.length < 2) return 0;
  let count = 0;
  for (let i = klines.length - 1; i > 0; i--) {
    if (klines[i].close > klines[i - 1].close) count++;
    else break;
  }
  return count;
}

// =============================================================
// Sprint 2 sub-task 2.5 — 3 個 market data detect helpers
// =============================================================

/** 偵測 volatility squeeze (M6 波幅收縮)
 *  最近 5 日 ATR < 之前 20 日 ATR × 0.7 = squeeze
 *  純 math, 唔用 AI
 */
function detectSqueeze(klines) {
  if (!klines || klines.length < 25) return false;
  const recent5 = klines.slice(-5);
  const prev20 = klines.slice(-25, -5);
  const atr5 = recent5.reduce((acc, k, i) => {
    if (i === 0) return acc;
    return acc + Math.abs(k.close - klines[klines.length - 5 + i - 1].close);
  }, 0) / 4;
  const atr20 = prev20.reduce((acc, k, i) => {
    if (i === 0) return acc;
    return acc + Math.abs(k.close - klines[klines.length - 25 + i - 1].close);
  }, 0) / 19;
  return atr5 < atr20 * 0.7;
}

/** 偵測 fake breakout (M3 + M5 矛盾)
 *  最近 5 日突破前 20 日 high, 但成交量 < 5 日平均
 *  純 math, 唔用 AI
 */
function detectFakeBreakout(klines) {
  if (!klines || klines.length < 25) return false;
  const recent5 = klines.slice(-5);
  const prev20 = klines.slice(-25, -5);
  const prev20High = Math.max(...prev20.map(k => k.high));
  const breaksHigh = recent5.some(k => k.close > prev20High);
  if (!breaksHigh) return false;
  // Check volume 對齊
  const recent5AvgVol = recent5.reduce((acc, k) => acc + k.volume, 0) / 5;
  const prev20AvgVol = prev20.reduce((acc, k) => acc + k.volume, 0) / 20;
  return recent5AvgVol < prev20AvgVol * 0.8;  // 突破但量縮
}

/** 偵測 M1 均線 + M3 趨勢線同步轉勢
 *  MA5 同 MA10 同步向下 (close < MA5 < MA10) + trendline slope 向下
 *  純 math, 唔用 AI
 */
function detectMATLTransition(klines) {
  if (!klines || klines.length < 20) return false;
  const closes = klines.map(k => k.close);
  // MA5 + MA10
  const ma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const ma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const currentClose = closes[closes.length - 1];
  // 同步向下: close < MA5 < MA10
  if (!(currentClose < ma5 && ma5 < ma10)) return false;
  // trendline slope (最近 10 個 closing 對 index 嘅 linear regression slope)
  const n = 10;
  const x = Array.from({ length: n }, (_, i) => i);
  const y = closes.slice(-n);
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    den += dx * dx;
  }
  if (den === 0) return false;
  const slope = num / den;
  return slope < 0;  // 向下 trend
}

/** 8 個 finalAction → 顏色 (大少 11:57 永久 rule 6 個顏色)
 *  🟢 BUY/ADD → #26BA75 強勢 / 確認
 *  🟡 HOLD/WAIT → #F39C12 觀望 / 中性
 *  🟠 REDUCE → #F39C12 收油 (用黃色, 唔用紅色因為唔係 SELL)
 *  🔴 SELL → #EE5151 強勢下跌
 *  🟣 TRAP/TRANSITION → #722ed1 陷阱 / 矛盾
 *  ⚫ N/A → #666 唔適用
 */
function finalActionColor(action) {
  switch (action) {
    case 'BUY':
    case 'ADD': return '#26BA75';
    case 'HOLD':
    case 'WAIT':
    case 'REDUCE': return '#F39C12';
    case 'SELL': return '#EE5151';
    case 'TRAP':
    case 'TRANSITION': return '#722ed1';
    default: return '#666';
  }
}

/** 8 個 finalAction → 中文 label (揸車比喻貫穿)
 */
function finalActionLabel(action) {
  switch (action) {
    case 'BUY': return '🟢 油門俾到底';
    case 'ADD': return '🟢 油門再踩深啲';
    case 'HOLD': return '🟡 保持現速';
    case 'WAIT': return '🟡 等綠燈';
    case 'REDUCE': return '🟠 收返少少油';
    case 'SELL': return '🔴 急煞車';
    case 'TRAP': return '🟣 唔好信導航';
    case 'TRANSITION': return '🟣 收油準備轉彎';
    default: return '⚫ 未知';
  }
}

/** 8 個最終動作 → 純短 label (中文化, 用喺表格, 大少 2026-08-11)
 */
function finalActionShortLabel(action) {
  switch (action) {
    case 'BUY': return '買入';
    case 'ADD': return '加注';
    case 'HOLD': return '持有';
    case 'WAIT': return '等待';
    case 'REDUCE': return '減注';
    case 'SELL': return '賣出';
    case 'TRAP': return '陷阱';
    case 'TRANSITION': return '轉勢';
    default: return '未知';
  }
}

// =============================================================
// Sprint 2 sub-task 2.3 — Forecast scenarios render helper
// =============================================================

/** Render 9 個 forecast scenarios 做 3 × 3 table (3 timeframes × 3 scenarios)
 *  @param {Array<{scenario, timeframe_days, expected_return, max_drawdown, probability}>} forecasts
 *  @returns {string} HTML
 */
function renderForecastTable(forecasts) {
  if (!forecasts || forecasts.length === 0) {
    return '<div style="padding:12px;background:#fff3cd;border-radius:6px;color:#856404;">9 個情境仲未計算</div>';
  }

  // 大少 2026-08-10 v2: 加 popup tooltip + 加大 padding + min-width 對齊 column header center
  const FC_TOOLTIPS = {
    row_label: '時段: 5/10/20 日, 線性 scaling 預期回報跟最大回撤',
    optimistic: '🟢 樂觀情境 (25% 概率): 預期回報 × 1.5 × (日數/5),最大回撤 × 0.5',
    baseline: '🟡 基準情境 (50% 概率): 預期回報 × 1.0 × (日數/5),最大回撤 × 0.7',
    pessimistic: '🔴 悲觀情境 (25% 概率): -最大回撤 × 0.5 × (日數/5),最大回撤 × 1.0',
    ret_pct: '預期回報: 正=賺/負=蝕 (顏色跟 sign), 唔係預測,只係可能範圍',
    md_pct: '最大回撤 (MD): 最壞情況預期跌幾多 %,用嚟 set 止蝕位',
  };
  const scenarios = [
    { key: 'optimistic', label: '🟢 樂觀', color: '#26BA75', prob: '25%' },
    { key: 'baseline', label: '🟡 基準', color: '#F39C12', prob: '50%' },
    { key: 'pessimistic', label: '🔴 悲觀', color: '#EE5151', prob: '25%' },
  ];
  const scenarioTooltip = {
    optimistic: FC_TOOLTIPS.optimistic,
    baseline: FC_TOOLTIPS.baseline,
    pessimistic: FC_TOOLTIPS.pessimistic,
  };
  const timeframes = [5, 10, 20];

  let html = '<table class="data-summary" style="width:100%;border-collapse:collapse;font-size:14px;table-layout:auto;word-break:keep-all;">';
  // Header: 日數/時段 | 樂觀 | 基準 | 悲觀
  html += '<thead><tr style="background:#f0f0f0;">';
  html += `<th class="m8-verdict-tooltip" data-help="${FC_TOOLTIPS.row_label}" style="text-align:left;padding:10px 14px;min-width:90px;white-space:nowrap;vertical-align:middle;">日數 / 情境</th>`;
  for (const sc of scenarios) {
    html += `<th class="m8-verdict-tooltip" data-help="${scenarioTooltip[sc.key]}" style="text-align:right;padding:10px 14px;min-width:140px;white-space:nowrap;vertical-align:middle;">${sc.label} <span style="color:#999;font-weight:400;">(${sc.prob})</span></th>`;
  }
  html += '</tr></thead><tbody>';

  for (const days of timeframes) {
    html += '<tr style="vertical-align:middle;">';
    html += `<td class="m8-verdict-tooltip" data-help="${FC_TOOLTIPS.row_label}" style="padding:10px 14px;font-weight:600;white-space:nowrap;min-width:90px;">${days} 日</td>`;
    for (const sc of scenarios) {
      const f = forecasts.find(x => x.timeframe_days === days && x.scenario === sc.key);
      if (f) {
        const retColor = f.expected_return >= 0 ? '#26BA75' : '#EE5151';
        const retSign = f.expected_return >= 0 ? '+' : '';
        const mdPct = (f.max_drawdown * 100).toFixed(1);
        html += `<td style="text-align:right;padding:10px 14px;min-width:140px;vertical-align:middle;">
          <div class="m8-verdict-tooltip" data-help="${FC_TOOLTIPS.ret_pct}" style="color:${retColor};font-weight:700;font-size:15px;">${retSign}${(f.expected_return * 100).toFixed(2)}%</div>
          <div class="m8-verdict-tooltip" data-help="${FC_TOOLTIPS.md_pct}" style="color:#999;font-size:11px;margin-top:2px;">MD ${mdPct}%</div>
        </td>`;
      } else {
        html += '<td style="text-align:right;padding:10px 14px;color:#999;min-width:140px;">—</td>';
      }
    }
    html += '</tr>';
  }

  html += '</tbody></table>';
  return html;
}

// =============================================================
// Sprint 2 sub-task 2.4 — Interpretation render helper
// =============================================================

/** Render interpretation box (LLM hook 預留, 大少 13:30 永久 rule)
 *  將來 swap 落 LLM call:
 *    1. hardcodedInterpretation() 喺 .ts file 換成 return await openai.complete(prompt)
 *    2. 呢個 render helper 唔使改
 *    3. testing page 即時見到 LLM 解讀
 */
function renderInterpretation(interpretation, finalAction) {
  if (!interpretation || interpretation.length === 0) {
    return '<div style="padding:12px;background:#fff3cd;border-radius:6px;color:#856404;">解讀仲未生成</div>';
  }
  const actionColor = finalActionColor(finalAction);

  // 將 multiline string (\n) 轉做 <br> + bold markdown 處理
  const formatted = interpretation
    .split('\n')
    .map(line => {
      // **bold** 轉 <strong>
      line = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      return `<div style="margin-bottom:6px;line-height:1.7;">${line}</div>`;
    })
    .join('');

  return `
    <div class="interpretation-box" style="background:linear-gradient(135deg, ${actionColor}11, ${actionColor}05);border-left:4px solid ${actionColor};border-radius:8px;padding:16px;font-size:14px;color:#222;line-height:1.7;">
      ${formatted}
    </div>
  `;
}

// =============================================================
// Sprint 2 sub-task 2.8 — SVG Charts render helpers (永遠全 Show)
// =============================================================

/** 1️⃣ Sentiment Radar Chart (6 維情緒雷達)
 *  6 維: rsi / bollinger_pct_b / bias_ratio / vol_skew / turnover / momentum_accel
 *  SVG: 6 邊形雷達圖, 每邊長度對應 sentiment value [-1, +1]
 *  @param {Sentiment6D} sentiment - 6 維情緒 (e.g. 6 個 verdicts avg 或單個)
 *  @param {string} title - 圖表標題
 *  @param {string} colorHex - 雷達填色 (e.g. '#1890ff')
 *  @returns {string} SVG HTML
 */
function renderSentimentRadar(sentiment, title, colorHex = '#1890ff') {
  if (!sentiment) {
    return '<div style="padding:12px;color:#999;">無 sentiment 數據</div>';
  }
  const labels = ['RSI', '%B', '乖離', '波動', '換手', '動能'];
  const keys = ['rsi', 'bollinger_pct_b', 'bias_ratio', 'vol_skew', 'turnover', 'momentum_accel'];
  const cx = 100, cy = 100, r = 70;
  // 6 邊形 points
  const points = keys.map((k, i) => {
    const angle = (Math.PI * 2 * i) / 6 - Math.PI / 2;
    const value = Math.max(-1, Math.min(1, sentiment[k] || 0));
    const radius = r * (Math.abs(value) + 1) / 2;  // 將 [-1, +1] map 去 [0, r]
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  // 6 個 axis labels
  const labelPoints = keys.map((k, i) => {
    const angle = (Math.PI * 2 * i) / 6 - Math.PI / 2;
    const x = cx + (r + 20) * Math.cos(angle);
    const y = cy + (r + 20) * Math.sin(angle);
    const value = sentiment[k] || 0;
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" font-size="11" fill="#333">${labels[i]}</text>`;
  }).join('');

  return `
    <div class="svg-chart m8-verdict-tooltip" data-help="6 維情緒雷達: 6 個演算法嘅情緒指標 (RSI 相對強弱指數 / %B 布林帶位置 / 乖離 乖離率 / 波動 波動偏度 / 換手 換手率 / 動能 連漲跌加速度), 數值範圍 -1 到 +1 (正=強/負=弱/0=中性), 6 邊形愈大代表情緒愈強" style="text-align:center;">
      <div style="font-size:12px;color:#666;margin-bottom:4px;">${title}</div>
      <svg width="200" height="200" viewBox="0 0 200 200" style="display:inline-block;">
        <!-- 6 個 concentric rings (0.25 / 0.5 / 0.75 / 1.0) -->
        <polygon points="${keys.map((_, i) => {
          const angle = (Math.PI * 2 * i) / 6 - Math.PI / 2;
          return `${(cx + r * 0.25 * Math.cos(angle)).toFixed(1)},${(cy + r * 0.25 * Math.sin(angle)).toFixed(1)}`;
        }).join(' ')}" fill="none" stroke="#ddd" stroke-width="0.5" />
        <polygon points="${keys.map((_, i) => {
          const angle = (Math.PI * 2 * i) / 6 - Math.PI / 2;
          return `${(cx + r * 0.5 * Math.cos(angle)).toFixed(1)},${(cy + r * 0.5 * Math.sin(angle)).toFixed(1)}`;
        }).join(' ')}" fill="none" stroke="#ddd" stroke-width="0.5" />
        <polygon points="${keys.map((_, i) => {
          const angle = (Math.PI * 2 * i) / 6 - Math.PI / 2;
          return `${(cx + r * 0.75 * Math.cos(angle)).toFixed(1)},${(cy + r * 0.75 * Math.sin(angle)).toFixed(1)}`;
        }).join(' ')}" fill="none" stroke="#ddd" stroke-width="0.5" />
        <polygon points="${keys.map((_, i) => {
          const angle = (Math.PI * 2 * i) / 6 - Math.PI / 2;
          return `${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`;
        }).join(' ')}" fill="none" stroke="#ddd" stroke-width="0.5" />
        <!-- 6 個 axis -->
        ${keys.map((_, i) => {
          const angle = (Math.PI * 2 * i) / 6 - Math.PI / 2;
          return `<line x1="${cx}" y1="${cy}" x2="${(cx + r * Math.cos(angle)).toFixed(1)}" y2="${(cy + r * Math.sin(angle)).toFixed(1)}" stroke="#ddd" stroke-width="0.5" />`;
        }).join('')}
        <!-- data polygon -->
        <polygon points="${points}" fill="${colorHex}" fill-opacity="0.4" stroke="${colorHex}" stroke-width="2" />
        ${labelPoints}
      </svg>
    </div>
  `;
}

/** 2️⃣ Kelly Position Donut (倉位分數 donut chart)
 *  half = 0.5 / quarter = 0.25 / octo = 0.125
 *  顏色: half=#26BA75 (綠), quarter=#F39C12 (黃), octo=#EE5151 (紅)
 */
function renderKellyDonut(kellyFraction) {
  const map = {
    half: { value: 0.5, label: '半倉 50%', color: '#26BA75' },
    quarter: { value: 0.25, label: '四分一 25%', color: '#F39C12' },
    octo: { value: 0.125, label: '八分一 12.5%', color: '#EE5151' },
  };
  const k = map[kellyFraction] || map.quarter;
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const dashLength = k.value * circumference;
  return `
    <div class="svg-chart m8-verdict-tooltip" data-help="凱利倉位分數 donut: 跟平均真實波幅率 (ATR%) 自動切嘅倉位大小。半倉 (50%) = 低波動 / 四分一倉 (25%) = 中波動 / 八分一倉 (12.5%) = 高波動。波動愈大倉位愈細, 自動風控" style="text-align:center;">
      <div style="font-size:12px;color:#666;margin-bottom:4px;">💰 凱利倉位分數</div>
      <svg width="140" height="140" viewBox="0 0 140 140" style="display:inline-block;">
        <circle cx="70" cy="70" r="${radius}" fill="none" stroke="#eee" stroke-width="14" />
        <circle cx="70" cy="70" r="${radius}" fill="none" stroke="${k.color}" stroke-width="14"
                stroke-dasharray="${dashLength} ${circumference}" stroke-dashoffset="${circumference / 4}"
                transform="rotate(-90 70 70)" />
        <text x="70" y="68" text-anchor="middle" font-size="20" font-weight="700" fill="${k.color}">${(k.value * 100).toFixed(0)}%</text>
        <text x="70" y="85" text-anchor="middle" font-size="11" fill="#666">${kellyFraction}</text>
      </svg>
    </div>
  `;
}

/** 3️⃣ Alignment Score Bar (alignment_score 0-1 visualization)
 *  5 個 state 嘅 alignment: 一致程度越高, bar 越長
 *  顏色: <0.4 紅, 0.4-0.7 黃, >0.7 綠
 */
function renderAlignmentBar(alignment) {
  const color = alignment < 0.4 ? '#EE5151' : alignment < 0.7 ? '#F39C12' : '#26BA75';
  const label = alignment < 0.4 ? '矛盾' : alignment < 0.7 ? '部分一致' : '高度一致';
  return `
    <div class="svg-chart m8-verdict-tooltip" data-help="對齊度條 (Alignment 戰略戰術匹配度): 6 個演算法之間嘅同向程度 (0-100%)。<40% 紅色 = 矛盾 (小心入場) / 40-70% 黃色 = 部分一致 (中等) / >70% 綠色 = 高度一致 (信心高)。顏色對應 M7 Synthesizer 嘅 alignment_score" style="text-align:center;">
      <div style="font-size:12px;color:#666;margin-bottom:4px;">📐 對齊度 (戰略戰術匹配度)</div>
      <svg width="200" height="60" viewBox="0 0 200 60" style="display:inline-block;">
        <rect x="0" y="20" width="200" height="20" fill="#eee" rx="4" />
        <rect x="0" y="20" width="${alignment * 200}" height="20" fill="${color}" rx="4" />
        <text x="100" y="14" text-anchor="middle" font-size="12" font-weight="600" fill="#333">${(alignment * 100).toFixed(0)}% — ${label}</text>
        <text x="${alignment * 200}" y="35" text-anchor="${alignment < 0.9 ? 'start' : 'end'}" dx="${alignment < 0.9 ? 4 : -4}" font-size="11" fill="#fff" font-weight="600">${(alignment * 100).toFixed(0)}%</text>
      </svg>
    </div>
  `;
}

/** 4️⃣ 6 個 Modules State Bar (6 個 module state visualization)
 *  顏色對應 state: UP=#26BA75, DOWN=#EE5151, SIDEWAYS=#F39C12, TRANSITION=#722ed1
 *  永遠全 Show (大少 11:57 永久 rule)
 */
function renderModuleStateBar(moduleVerdicts) {
  if (!moduleVerdicts || moduleVerdicts.length === 0) {
    return '<div style="padding:12px;color:#999;">無 module verdicts</div>';
  }
  const stateColor = {
    UP: '#26BA75',
    DOWN: '#EE5151',
    SIDEWAYS: '#F39C12',
    TRANSITION: '#722ed1',
    TRAP: '#722ed1',
  };
  const items = moduleVerdicts.map((v) => {
    const color = stateColor[v.state] || '#666';
    const modNameZh = MODULE_NAME_ZH[v.module_id] || v.module_id;
    const stateLabel = decisionEngineStateLabel(v.state);
    return `<div class="m8-verdict-tooltip" data-help="${modNameZh}: ${stateLabel} (信心 ${(v.confidence * 100).toFixed(0)}%) — 6 個演算法之一嘅方向同信心" style="display:inline-block;margin:2px 4px 2px 0;padding:4px 8px;background:${color}22;color:${color};border:1px solid ${color};border-radius:4px;font-size:11px;">
      <strong>${modNameZh}</strong>: ${stateLabel} (${(v.confidence * 100).toFixed(0)}%)
    </div>`;
  }).join('');
  return `
    <div class="svg-chart m8-verdict-tooltip" data-help="6 個演算法嘅狀態 chip 全部顯示 (永遠全 Show 永久 rule): 每個演算法 (均線/峰谷/趨勢線/動能/量價/波動) 嘅大方向同信心, 6 個加埋等於 M7 嘅綜合判定" style="text-align:left;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">📦 6 個演算法狀態全部顯示 (永遠全 Show)</div>
      ${items}
    </div>
  `;
}

// =============================================================
// Sprint 2 sub-task 2.5 — Adaptive params render helper
// =============================================================

/** Render 5 個 adaptive params 嘅 box
 *  純 math (R² / ATR / Pearson / Hurst), 唔用 AI
 *  Auto + Manual 2 個 mode (2.6 將加 L2 cache + 「🔄 重新校準」按鈕)
 */
function renderAdaptiveParams(params, cacheInfo = null) {
  if (!params) {
    return '<div style="padding:12px;background:#fff3cd;border-radius:6px;color:#856404;">Adaptive params 仲未 calibrate</div>';
  }
  const { ssiWeights, rsiWeight, kellyFraction, markowitzCorr, hurstThresholds } = params;
  // 大少 2026-08-10 v2: popup tooltip + 中文化 Hurst + 馬可維茨
  const AP_TOOLTIPS = {
    ssi_weights: 'SSI 戰略層權重: 用 R² 算邊條線最近期數據貼得最貼, 愈貼畀多啲權重。MA = 均線/HL = 峰谷/TL = 趨勢線',
    rsi_weight: 'RSI 情緒權重: 6 維情緒平均 (RSI / %B / 乖離率 / 波動偏度 / 換手率 / 連漲跌加速度)',
    kelly: 'Kelly 倉位分數: 跟 ATR% 自動切 (<2% = half 半倉, 2-5% = quarter 四分一, ≥5% = octo 八分一)',
    hurst: 'Hurst 指數閾值: Persistent (持續) = >0.6 強趨勢, Reverting (反轉) = <0.4 強反轉, 中間就 walk 隨機',
    markowitz: '馬可維茨相關係數: 3 個時段 (日/週/月) Pearson 相關性, 衡量分散風險, 愈接近 0 愈分散',
    ap_title: '5 個 Adaptive Params: 跟股票特性 auto-calibrate 嘅參數, 純 math (R² / ATR / Pearson / Hurst), 唔用 AI / LLM',
  };
  // 2.6: cache status (last_calibrated + age + valid)
  const cacheStatus = cacheInfo
    ? `<div style="font-size:12px;color:#666;margin-bottom:8px;">
        💾 Cache: ${cacheInfo.last_calibrated ? new Date(cacheInfo.last_calibrated * 1000).toISOString().slice(0, 16) : 'N/A'}
        (${Math.round((cacheInfo.age_seconds || 0) / 3600)} 小時前, ${cacheInfo.valid ? '🟢 Valid' : '🔴 Expired'})
        &nbsp;|&nbsp;
        <button id="recalibrate-btn" onclick="window.__recalibrateAdaptiveParams && window.__recalibrateAdaptiveParams()" style="background:#1890ff;color:#fff;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;">🔄 重新校準</button>
      </div>`
    : '<div style="font-size:12px;color:#666;margin-bottom:8px;">🧮 R² / ATR / Pearson / Hurst — 唔用 AI, 唔用 LLM</div>';
  // Hurst 顏色: 持續 >0.6 綠, 反轉 <0.4 紅
  const hurstPColor = hurstThresholds.persistent >= 0.6 ? '#26BA75' : hurstThresholds.persistent <= 0.4 ? '#EE5151' : '#F39C12';
  const hurstRColor = hurstThresholds.reverting <= 0.4 ? '#26BA75' : hurstThresholds.reverting >= 0.6 ? '#EE5151' : '#F39C12';
  return `
    <h4 class="m8-verdict-tooltip" data-help="${AP_TOOLTIPS.ap_title}" style="margin-top:24px;margin-bottom:4px;">⚙️ 5 個 Adaptive Params (2.5 — 自動校準, 純 math)</h4>
    ${cacheStatus}
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">
      <div class="adaptive-param-card m8-verdict-tooltip" data-help="${AP_TOOLTIPS.ssi_weights}" style="background:#f9f9f9;border-radius:8px;padding:12px;">
        <div style="font-size:12px;color:#666;">📐 SSI 戰略層權重 (R² normalized)</div>
        <div style="font-size:13px;margin-top:4px;">
          均線 MA: <strong>${(ssiWeights.ma * 100).toFixed(1)}%</strong> &nbsp;|&nbsp;
          峰谷 HL: <strong>${(ssiWeights.hl * 100).toFixed(1)}%</strong> &nbsp;|&nbsp;
          趨勢線 TL: <strong>${(ssiWeights.trendline * 100).toFixed(1)}%</strong>
        </div>
      </div>
      <div class="adaptive-param-card m8-verdict-tooltip" data-help="${AP_TOOLTIPS.rsi_weight}" style="background:#f9f9f9;border-radius:8px;padding:12px;">
        <div style="font-size:12px;color:#666;">💭 RSI 情緒權重 (6 維情緒平均)</div>
        <div style="font-size:18px;font-weight:700;margin-top:2px;">${(rsiWeight * 100).toFixed(0)}%</div>
      </div>
      <div class="adaptive-param-card m8-verdict-tooltip" data-help="${AP_TOOLTIPS.kelly}" style="background:#f9f9f9;border-radius:8px;padding:12px;">
        <div style="font-size:12px;color:#666;">💰 Kelly 倉位分數 (跟 ATR%)</div>
        <div style="font-size:18px;font-weight:700;margin-top:2px;">${kellyFraction}</div>
      </div>
      <div class="adaptive-param-card m8-verdict-tooltip" data-help="${AP_TOOLTIPS.hurst}" style="background:#f9f9f9;border-radius:8px;padding:12px;">
        <div style="font-size:12px;color:#666;">📈 Hurst 持續/反轉閾值</div>
        <div style="font-size:13px;margin-top:4px;">
          持續 Persistent: <strong style="color:${hurstPColor};">${hurstThresholds.persistent.toFixed(2)}</strong> &nbsp;|&nbsp;
          反轉 Reverting: <strong style="color:${hurstRColor};">${hurstThresholds.reverting.toFixed(2)}</strong>
        </div>
      </div>
      <div class="adaptive-param-card m8-verdict-tooltip" data-help="${AP_TOOLTIPS.markowitz}" style="background:#f9f9f9;border-radius:8px;padding:12px;grid-column:span 2;">
        <div style="font-size:12px;color:#666;">🔗 馬可維茨相關係數 (3 個時段 Pearson 相關性)</div>
        <div style="font-size:13px;margin-top:4px;">
          日-週: <strong>${markowitzCorr.dailyWeekly.toFixed(2)}</strong> &nbsp;|&nbsp;
          日-月: <strong>${markowitzCorr.dailyMonthly.toFixed(2)}</strong> &nbsp;|&nbsp;
          週-月: <strong>${markowitzCorr.weeklyMonthly.toFixed(2)}</strong>
        </div>
      </div>
    </div>
  `;
}

function decisionEngineStateLabel(state) {
  // Plan B fix (大少 2026-08-08 13:30) — defensive label fallback
  // 如果 state 係 undefined / null / 唔 match 5 個 value, 顯示 "未知" 而唔係 "undefined"
  if (!state || !['UP', 'DOWN', 'SIDEWAYS', 'TRANSITION', 'TRAP'].includes(state)) {
    return '未知';
  }
  return ({ UP: '上升', DOWN: '下跌', SIDEWAYS: '橫行', TRANSITION: '轉勢中', TRAP: '陷阱' })[state];
}

function decisionEngineModuleStateColor(state) {
  // Plan B fix (大少 2026-08-08 13:30) — defensive color fallback
  if (state === 'UP') return '#26BA75';
  if (state === 'DOWN') return '#EE5151';
  if (state === 'TRAP') return '#722ed1';
  return '#F39C12';  // SIDEWAYS / TRANSITION / unknown
}

// 2026-08-10 大少 4 個 fix + RSI 改 raw display — M7 顯示優化
//   Fix 1: 0% 改中文解說 (Conf 0% → 「未確認」, Exp.Ret 0% → 「持平」)
//   Fix 2: 全普通話 (module 短版中文名 + column header)
//   Fix 3: Module 表格對齊 (table-layout: fixed + column width)
//   Fix 4: TCM 加白話解讀
//   Fix 5: RSI 改 raw display (denormalize 0~1 → 0~100 + 情緒標籤)

const MODULE_NAME_ZH = {
  'ma-alignment': '均線',
  'hl-structure': '峰谷',
  'trendline': '趨勢線',
  'indicators': '動能',
  'volume': '量價',
  'volatility': '波動',
};

function fmtPct(value, type) {
  if (Math.abs(value) < 0.0001) {
    if (type === 'conf') return '未確認';
    if (type === 'expRet') return '持平';
    return '0%';
  }
  return `${(value * 100).toFixed(type === 'expRet' ? 2 : 0)}%`;
}

// 2026-08-10 大少 fix 2 (顏色 + 全部字詞 title 解讀 enhancement)
//   - SSI 3 個 metric 加顏色(高 70+ 綠 / 中 40-70 橙 / 低 40- 紅)
//   - Exp.Ret 加顏色(正綠 / 負紅 / 持平灰)
//   - RSI 加顏色(超買紅 / 中性橙 / 超賣綠) + 3 情緒解讀
//   - 全部字詞加 title attribute(hover 顯示解讀)
//   - 大少 trigger 答:「越多越好,反正不影響UI排版」

function rsiInfo(normalizedRsi) {
  // std-verdict.ts computeSentiment6D: normalized = (raw - 50) / 50
  // 所以 raw = normalized * 50 + 50
  const raw = Math.max(0, Math.min(100, normalizedRsi * 50 + 50));
  let color, label, tooltip;
  if (raw >= 70) {
    color = '#EE5151'; label = '超買';
    tooltip = '個股價短期升太多(>70),可能見頂回調,小心';
  } else if (raw <= 30) {
    color = '#26BA75'; label = '超賣';
    tooltip = '個股價短期跌太多(<30),可能見底反彈,留意撈底機會';
  } else {
    color = '#F39C12'; label = '中性';
    tooltip = '普通狀態(30-70),冇超買超賣,正常';
  }
  return { value: raw.toFixed(0), color, label, tooltip };
}

function tcmAlignColor(alignment) {
  if (alignment > 0) return '#26BA75';
  if (alignment < 0) return '#EE5151';
  return '#F39C12';
}

function ssiColor(value) {
  if (value >= 0.7) return '#26BA75';  // 高
  if (value >= 0.4) return '#F39C12';  // 中
  return '#EE5151';  // 低
}

function expRetColor(value) {
  if (Math.abs(value) < 0.0001) return '#888';  // 持平(灰)
  if (value > 0) return '#26BA75';  // 賺(綠)
  return '#EE5151';  // 蝕(紅)
}

// 全部字詞嘅 hover 解讀對照表(大少 trigger「越多越好」,所以加到盡)
const TOOLTIPS = {
  module: '6 個演算法之一,各自睇股票唔同方面:均線=平均價線 / 峰谷=高低波型 / 趨勢線=撐位壓位 / 動能=升跌力度 / 量價=錢跟股價 / 波動=跳幾勁',
  state: '個股價大方向(揸車比喻:🟢 上升=油門 / 🟡 橫行=塞車 / 🔴 下跌=落斜 / 🟣 轉勢=要轉彎)',
  state_up: '🟢 個股價大方向向上(揸車比喻=油門踩緊,一望無際)',
  state_down: '🔴 個股價大方向向下(揸車比喻=落斜路踩迫力)',
  state_sideways: '🟡 個股價喺範圍內上落,冇明確方向(揸車比喻=塞車等紅綠燈)',
  state_transition: '🟣 7 日內由升轉跌 或 由跌轉升(揸車比喻=前面要轉彎,收油準備)',
  state_trap: '🟣 假突破陷阱,虛漲訊號,唔好信',
  conf: '0~100% 信心指數(0=冇 evidence / 70+=強可參考 / 50-70=中 / <50=弱唔好信)',
  weight: 'Synthesizer分俾呢個演算法嘅重要性(6 個加埋=100%,過往準=高,唔係 1/6 平均)',
  expRet: '預期 hold 1 個月平均賺/蝕幾多%(正=賺/0=持平/負=蝕,唔等於一定,係平均估計)',
  maxDD: '最壞情況 1 個月內預期跌幾多%(5%=穩定大股/10%=中等/20%=高波動,用嚟 set 止蝕位)',
  rsi: 'RSI 0-100 情緒指標(>70 超買見頂/30-70 中性/<30 超賣見底)',
  rsi_overbought: '個股價短期升太多(>70),可能見頂回調,小心',
  rsi_oversold: '個股價短期跌太多(<30),可能見底反彈,留意撈底機會',
  rsi_neutral: '普通狀態(30-70),冇超買超賣,正常',
  unconfirmed: '0 個 evidence 確認(默認橫行)。唔等於「100% 唔會」,係「冇 data」',
  flat: 'SIDEWAYS 預期 0% return(唔賺唔蝕)',
  grade: 'Grade 評分制 8 級(A+ = 頂級 / A = 優 / B+ = 良 / B = 可 / C+ = 普通 / C = 弱 / D = 差 / F = 失敗), 跟美股標普評級同 standard credit rating 邏輯',
  ssi_label: 'Strategic Strength Index 戰略強度指數(0-100,3 個戰略演算法共識強度)',
  ssi_consistency: '戰略組 3 個演算法(均線+峰谷+趨勢線)睇法有幾一致(100%=3 個都話一樣,0%=3 個各講各的)',
  ssi_confidence: '戰略組 3 個演算法平均信心(0-100%,高=3 個都肯定,低=3 個都唔太肯定)',
  ssi_coverage: '戰略組規則覆蓋率(0-100%,高=大部分規則都觸發,低=大部分規則冇觸發)',
  alignment: '戰略組(大方向)同戰術組(短線)嘅共識程度(1.0=完全對齊/0.0=冇共識/矛盾=唔對齊)',
  kelly: '凱利公式計「呢隻股票應該出幾多%資金」(半注50%/四分一25%/八分一12.5%,波動大=細注)',
  tcm: 'Tactical Confirmation Matrix 戰術交叉驗證:睇 3 對演算法之間嘅共識程度',
  tcm_pair: '2 個演算法嘅配對(共識度計算對象):均線↔趨勢線 / 峰谷↔量價 / 動能↔波動',
  alignment_score: '2 個演算法共識度(-1.0 到 +1.0,+1.0=完全一致/0=冇共識/-1.0=完全相反)',
  trap_penalty: '2 個演算法矛盾時要扣幾多 % 信心(0-100%,越高越要小心)',
  verdict_title: 'M7 Synthesizer 嘅最終評分 = 6 個演算法加埋,出一個 Grade + Kelly 倉位',
  sprint1_scope: '第一階段已上線範圍:終極綜合判斷(M7 Synthesizer)',
  sprint2_scope: '第二階段範圍:M8 決策引擎嘅最終動作 8 個 + 交易範圍 + 自適應參數 + 本機快取',
  run_button: '撳呢個掣就會用選定嘅算法 + 參數跑一次',
  code_input: '輸入股票代碼(例:HK.00700 騰訊 / US.AAPL 蘋果)',
  data_days: '取幾多日歷史 K 線數據(越多越準,但越慢)',
  timeframe: '時間週期(1d=日線,1w=週線)',
};

export function renderDecisionEngineResult(verdict) {
  if (!verdict) return '<div class="result-error">無 verdict</div>';

  // 大少 2026-08-21 12:04 — Stage 2 第一步: 拎 zigzag_alignment_penalty + reasons 做 display
  const { ssi_score, ssi_breakdown, tcm_matrix, alignment_score, alignment_score_after_penalty, zigzag_alignment_penalty, zigzag_alignment_reasons, grade, grade_score, grade_reason, kelly_fraction, kelly_position, module_verdicts } = verdict;

  // 6 個 module 嘅 breakdown (大少 2026-08-10 v4: 對齊 v3 + state-pill 統一 min-width + padding 8px)
  const stateTooltipMap = {
    UP: TOOLTIPS.state_up,
    DOWN: TOOLTIPS.state_down,
    SIDEWAYS: TOOLTIPS.state_sideways,
    TRANSITION: TOOLTIPS.state_transition,
    TRAP: TOOLTIPS.state_trap,
  };
  const moduleRows = (module_verdicts || []).map(mv => {
    const color = decisionEngineModuleStateColor(mv.state);
    const modNameZh = MODULE_NAME_ZH[mv.module_id] || mv.module_id;
    const rsi = rsiInfo(mv.sentiment_6d?.rsi || 0);
    const expColor = expRetColor(mv.expected_return);
    return `
      <tr style="vertical-align:middle;">
        <td class="m7-verdict-tooltip" data-help="${TOOLTIPS.module}" style="text-align:left;padding:10px 12px;white-space:nowrap;min-width:80px;">${modNameZh}</td>
        <td class="m7-verdict-tooltip" data-help="${stateTooltipMap[mv.state] || TOOLTIPS.state}" style="text-align:center;padding:10px 12px;white-space:nowrap;min-width:80px;vertical-align:middle;"><span class="state-pill" style="display:inline-block;min-width:64px;text-align:center;background:${color}22;color:${color};border:1px solid ${color};border-radius:5px;padding:5px 10px;font-weight:600;">${decisionEngineStateLabel(mv.state)}</span></td>
        <td class="m7-verdict-tooltip" data-help="${TOOLTIPS.conf}" style="text-align:right;padding:10px 12px;white-space:nowrap;min-width:70px;">${fmtPct(mv.confidence, 'conf')}</td>
        <td class="m7-verdict-tooltip" data-help="${TOOLTIPS.weight}" style="text-align:right;padding:10px 12px;white-space:nowrap;min-width:70px;">${fmtPct(mv.base_weight, 'weight')}</td>
        <td class="m7-verdict-tooltip" data-help="${TOOLTIPS.expRet}" style="text-align:right;padding:10px 12px;color:${expColor};font-weight:600;white-space:nowrap;min-width:90px;">${fmtPct(mv.expected_return, 'expRet')}</td>
        <td class="m7-verdict-tooltip" data-help="${TOOLTIPS.maxDD}" style="text-align:right;padding:10px 12px;white-space:nowrap;min-width:80px;">${fmtPct(mv.max_drawdown_estimate, 'maxDD')}</td>
        <td class="m7-verdict-tooltip" data-help="${rsi.tooltip}" style="text-align:right;padding:10px 12px;white-space:nowrap;min-width:110px;">${rsi.value} <span style="color:${rsi.color};font-size:13px;font-weight:600;">(${rsi.label})</span></td>
      </tr>
    `;
  }).join('');

  // TCM 3 對 pair (大少 2026-08-10 v4: padding 8px + 加大 min-width)
  const tcmRows = (tcm_matrix || []).map(p => {
    const alignColor = tcmAlignColor(p.alignment);
    const pair0Zh = MODULE_NAME_ZH[p.pair[0]] || p.pair[0];
    const pair1Zh = MODULE_NAME_ZH[p.pair[1]] || p.pair[1];
    const alignHelp = `${TOOLTIPS.alignment_score} 當前值:${p.alignment > 0 ? '+' : ''}${p.alignment.toFixed(1)}`;
    const trapHelp = `${TOOLTIPS.trap_penalty} 當前值:${(p.trap_penalty * 100).toFixed(0)}%`;
    return `
      <tr style="vertical-align:middle;">
        <td class="m7-verdict-tooltip" data-help="${TOOLTIPS.tcm_pair}" style="text-align:left;padding:10px 14px;white-space:nowrap;min-width:150px;font-weight:500;">${pair0Zh} ↔ ${pair1Zh}</td>
        <td class="m7-verdict-tooltip" data-help="${alignHelp}" style="text-align:right;padding:10px 14px;white-space:nowrap;min-width:150px;"><span style="color:${alignColor};font-weight:700;font-size:15px;">${p.alignment > 0 ? '+' : ''}${p.alignment.toFixed(1)}</span></td>
        <td class="m7-verdict-tooltip" data-help="${trapHelp}" style="text-align:right;padding:10px 14px;white-space:nowrap;min-width:150px;font-weight:600;font-size:15px;">${(p.trap_penalty * 100).toFixed(0)}%</td>
      </tr>
    `;
  }).join('');

  const gradeColor = decisionEngineGradeColor(grade);
  const kellyLabel = decisionEngineKellyLabel(kelly_fraction);

  return `
    <div class="decision-engine-result" style="font-family: system-ui, sans-serif;">
      <!-- 自訂 CSS tooltip (大少 2026-08-10 v2 enhancement: 即時顯示 0.1s + 大字 14px + 箭嘴) -->
      <style>
        .m7-verdict-tooltip { position: relative; cursor: help; }
        .m7-verdict-tooltip:hover::after {
          content: attr(data-help);
          position: absolute;
          bottom: calc(100% + 8px);
          left: 50%;
          transform: translateX(-50%);
          background: rgba(0, 0, 0, 0.92);
          color: #fff;
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 14px;
          line-height: 1.6;
          white-space: normal;
          width: max-content;
          max-width: 380px;
          z-index: 9999;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          pointer-events: none;
          animation: m7TooltipFadeIn 0.1s ease-in;
        }
        .m7-verdict-tooltip:hover::before {
          content: '';
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          border: 6px solid transparent;
          border-top-color: rgba(0, 0, 0, 0.92);
          z-index: 10000;
          pointer-events: none;
        }
        @keyframes m7TooltipFadeIn { from { opacity: 0; } to { opacity: 1; } }
      </style>
      <!-- 頂部 verdict card (大少 2026-08-10 v2: 自訂 CSS tooltip + 大字) -->
      <div class="verdict-card" style="background:linear-gradient(135deg, ${gradeColor}22, ${gradeColor}08);border:2px solid ${gradeColor};border-radius:12px;padding:20px;margin-bottom:20px;text-align:center;">
        <div class="m7-verdict-tooltip" data-help="${TOOLTIPS.verdict_title}" style="font-size:14px;color:#666;margin-bottom:8px;">📊 終極綜合判斷 (M7 Synthesizer)</div>
        <div class="m7-verdict-tooltip" data-help="${TOOLTIPS.grade}" style="font-size:48px;font-weight:700;color:${gradeColor};line-height:1;">${grade}</div>
        <div style="font-size:18px;color:#666;margin-top:8px;">分數 ${grade_score.toFixed(1)} / 100</div>
        <div style="font-size:14px;color:#999;margin-top:4px;">${grade_reason}</div>
        <div style="display:flex;justify-content:center;gap:24px;margin-top:16px;font-size:14px;">
          <div class="m7-verdict-tooltip" data-help="${TOOLTIPS.ssi_label}">🟢 <strong>SSI</strong>: ${ssi_score.toFixed(1)} / 100</div>
          <div class="m7-verdict-tooltip" data-help="${TOOLTIPS.alignment}">📐 <strong>Alignment</strong>: ${(alignment_score * 100).toFixed(1)}%${zigzag_alignment_penalty > 0 ? ` <span style="color:#EE5151;font-weight:600;">→ ${(alignment_score_after_penalty * 100).toFixed(1)}% (扣 ${(zigzag_alignment_penalty * 100).toFixed(0)}%)</span>` : ''}</div>
          <div class="m7-verdict-tooltip" data-help="${TOOLTIPS.kelly}">💰 <strong>Kelly</strong>: ${kellyLabel}</div>
        </div>
        ${zigzag_alignment_reasons && zigzag_alignment_reasons.length > 0 ? `
          <div class="m7-verdict-tooltip" data-help="Stage 2 第一步 (大少 2026-08-21): 拎 M1 嘅 ZigZagSlope 短期斜率做 cross-module alignment check, M1 上升但 ZigZag 急跌 (或 M1 下跌但 ZigZag 急升) 視為短期動能背馳, 扣 alignment 5% 一條 rule" style="margin-top:12px;padding:10px 14px;background:#fff1f0;border-left:4px solid #EE5151;border-radius:6px;font-size:13px;color:#333;text-align:left;">
            <strong style="color:#EE5151;">⚠️ ZigZagSlope 短期動能背馳 (Stage 2 第一步):</strong>
            <ul style="margin:6px 0 0 0;padding-left:20px;">
              ${zigzag_alignment_reasons.map(r => `<li>${r}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>

      <!-- 6 個 Metric Mini-Cards (大少 2026-08-10 v2: 自訂 CSS tooltip + 大字 14px) -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;">
        <div class="metric-card m7-verdict-tooltip" data-help="${TOOLTIPS.ssi_consistency}" style="background:#f9f9f9;border-radius:8px;padding:12px;">
          <div style="font-size:14px;color:#666;">SSI 一致性</div>
          <div style="font-size:24px;font-weight:700;color:${ssiColor(ssi_breakdown.consistency)};">${(ssi_breakdown.consistency * 100).toFixed(0)}%</div>
        </div>
        <div class="metric-card m7-verdict-tooltip" data-help="${TOOLTIPS.ssi_confidence}" style="background:#f9f9f9;border-radius:8px;padding:12px;">
          <div style="font-size:14px;color:#666;">SSI 平均信心</div>
          <div style="font-size:24px;font-weight:700;color:${ssiColor(ssi_breakdown.confidence_avg)};">${(ssi_breakdown.confidence_avg * 100).toFixed(0)}%</div>
        </div>
        <div class="metric-card m7-verdict-tooltip" data-help="${TOOLTIPS.ssi_coverage}" style="background:#f9f9f9;border-radius:8px;padding:12px;">
          <div style="font-size:14px;color:#666;">SSI 規則覆蓋</div>
          <div style="font-size:24px;font-weight:700;color:${ssiColor(ssi_breakdown.rules_coverage)};">${(ssi_breakdown.rules_coverage * 100).toFixed(0)}%</div>
        </div>
      </div>

      <!-- 6 個 modules 嘅 breakdown (大少 2026-08-10 v5: 對齊 v4 + 統一 padding 10x12 + min-width 加大 + vertical-align middle) -->
      <h4 class="m7-verdict-tooltip" data-help="${TOOLTIPS.verdict_title}" style="margin-top:24px;margin-bottom:10px;font-size:16px;">📦 6 個模組嘅標準判決</h4>
      <table class="data-summary m7-verdict-table" style="width:100%;border-collapse:collapse;font-size:14px;table-layout:auto;word-break:keep-all;">
        <thead>
          <tr style="background:#f0f0f0;">
            <th class="m7-verdict-tooltip" data-help="${TOOLTIPS.module}" style="text-align:left;padding:10px 12px;min-width:80px;white-space:nowrap;vertical-align:middle;">模組</th>
            <th class="m7-verdict-tooltip" data-help="${TOOLTIPS.state}" style="text-align:center;padding:10px 12px;min-width:80px;white-space:nowrap;vertical-align:middle;">方向</th>
            <th class="m7-verdict-tooltip" data-help="${TOOLTIPS.conf}" style="text-align:right;padding:10px 12px;min-width:70px;white-space:nowrap;vertical-align:middle;">信心</th>
            <th class="m7-verdict-tooltip" data-help="${TOOLTIPS.weight}" style="text-align:right;padding:10px 12px;min-width:70px;white-space:nowrap;vertical-align:middle;">比重</th>
            <th class="m7-verdict-tooltip" data-help="${TOOLTIPS.expRet}" style="text-align:right;padding:10px 12px;min-width:90px;white-space:nowrap;vertical-align:middle;">預期回報</th>
            <th class="m7-verdict-tooltip" data-help="${TOOLTIPS.maxDD}" style="text-align:right;padding:10px 12px;min-width:80px;white-space:nowrap;vertical-align:middle;">最大回撤</th>
            <th class="m7-verdict-tooltip" data-help="${TOOLTIPS.rsi}" style="text-align:right;padding:10px 12px;min-width:110px;white-space:nowrap;vertical-align:middle;">情緒指數</th>
          </tr>
        </thead>
        <tbody>${moduleRows}</tbody>
      </table>

      <!-- TCM 3 對 pair (大少 2026-08-10 v5: 解讀 box 再大 1.5x (font 16/padding 24/line 1.8) + 配對 table column 加闊 110) -->
      <h4 class="m7-verdict-tooltip" data-help="${TOOLTIPS.tcm}" style="margin-top:28px;margin-bottom:10px;font-size:16px;">🔀 TCM 戰術交叉驗證 (3 對配對)</h4>
      <div class="tcm-explanation" style="background:#f9f9f9;padding:24px 28px;border-radius:10px;margin-bottom:20px;font-size:16px;color:#222;line-height:1.8;border-left:5px solid #1890ff;">
        <strong style="font-size:17px;">📖 點樣睇 TCM:</strong>
        <ul style="margin:8px 0 0 0;padding-left:20px;">
          <li><strong style="color:#26BA75;">共識度 +1.0</strong> = 兩個演算法睇法完全一致</li>
          <li><strong style="color:#F39C12;">共識度 0.0</strong> = 冇共識,各睇各的</li>
          <li><strong style="color:#EE5151;">共識度 -1.0</strong> = 完全相反,矛盾訊號</li>
          <li><strong>矛盾扣分</strong> = 兩個演算法矛盾時要扣幾多 % 信心(越高越要小心)</li>
        </ul>
      </div>
      <table class="data-summary m7-tcm-table" style="width:100%;border-collapse:collapse;font-size:14px;table-layout:auto;word-break:keep-all;">
        <thead>
          <tr style="background:#f0f0f0;">
            <th class="m7-verdict-tooltip" data-help="${TOOLTIPS.tcm_pair}" style="text-align:left;padding:10px 14px;min-width:150px;white-space:nowrap;vertical-align:middle;">配對</th>
            <th class="m7-verdict-tooltip" data-help="${TOOLTIPS.alignment_score}" style="text-align:right;padding:10px 14px;min-width:150px;white-space:nowrap;vertical-align:middle;">共識度</th>
            <th class="m7-verdict-tooltip" data-help="${TOOLTIPS.trap_penalty}" style="text-align:right;padding:10px 14px;min-width:150px;white-space:nowrap;vertical-align:middle;">矛盾扣分</th>
          </tr>
        </thead>
        <tbody>${tcmRows}</tbody>
      </table>

      <!-- Sprint 1 提示: M8 finalAction + trading card 留俾 Sprint 2 (大少 2026-08-10 v2: 自訂 CSS tooltip + 大字 14px) -->
      <div class="sprint2-notice" style="margin-top:24px;padding:16px;background:#f0f8ff;border-left:4px solid #1890ff;border-radius:6px;font-size:14px;color:#333;">
        <strong class="m7-verdict-tooltip" data-help="${TOOLTIPS.sprint1_scope}">📍 第一階段範圍:</strong> 終極綜合判斷引擎 (M7 Synthesizer) 已上線<br>
        <strong class="m7-verdict-tooltip" data-help="${TOOLTIPS.sprint2_scope}">🚧 第二階段範圍:</strong> M8 決策引擎嘅最終動作 8 個 (買入/加注/持有/減注/賣出/再睇/陷阱/轉勢) + 交易範圍 + 5 個自適應參數自動校準 + 本機快取
      </div>
    </div>
  `;
}

// ---------- synthesizerAdapter export (M7) ----------
//   大少 2026-08-08 13:30 — Plan A 拆返 M7 + M8 兩個獨立 adapter
//   之前 sprint 1 嘅 decisionEngineAdapter 而家變 synthesizerAdapter (M7 only)
//   M8 部分 (finalAction + trading card + 短期走勢 + adaptive params) 將喺 Sprint 2 寫
export const synthesizerAdapter = {
  id: 'AS-03-SYN',
  name: '終極綜合判定 (第七模組)',
  version: '1.0.0',
  description: '將之前 6 個模組嘅結果加埋一齊, 計一個綜合分數 (0-100)、睇方向係咪一致、再計建議嘅倉位大細, 等你有一個統一嘅睇法',
  inputs: [
    { key: 'code', label: '股票代碼', type: 'autocomplete', required: true, endpoint: '/api/stocks/search', queryParam: 'q', placeholder: '輸入代碼或名稱', limit: 10, marketFn: 'auto' },
  ],
  analyze: analyzeDecisionEngine,
  renderResult: renderDecisionEngineResult,
  getHelp: () => `
    <h3>📊 終極綜合判定 (Synthesizer v1.0.0 — M7)</h3>
    <p>將之前 6 個模組嘅結果加埋一齊, 計一個綜合分數同方向</p>
    <h4>5 個步驟:</h4>
    <ol>
      <li><strong>策略強度指數</strong> (0-100): 一致性 × 50 + 平均信心 × 30 + 規則覆蓋 × 20</li>
      <li><strong>交叉驗證矩陣</strong> (3 對配對): 均線對趨勢線 / 高低點對量價 / 動能對波動</li>
      <li><strong>方向一致分數</strong> (0-1): 最多嘅方向佔幾多比例</li>
      <li><strong>評級</strong> (8 個): A+ / A / B+ / B / C+ / C / D / F</li>
      <li><strong>建議倉位</strong>: 大倉 / 中倉 / 小倉, 跟平均波動率自動切</li>
    </ol>
    <h4>第八模組嘅附加功能 (已經加咗):</h4>
    <ul>
      <li>8 個行動指令 (買入 / 加注 / 持有 / 減注 / 賣出 / 再睇 / 陷阱 / 轉勢)</li>
      <li>交易範圍 (入場區間 / 止損 / 目標價 / 移動止損)</li>
      <li>短期走勢預測 (3 個情境 × 5/10/20 日)</li>
      <li>白話詳細解讀 (預咗將來用大語言模型)</li>
      <li>5 個自適應參數 (每隻股票自動校準)</li>
      <li>本機快取 (喺 ~/.stockpulse 資料夾, 7 日自動過期)</li>
    </ul>
  `,
};

// ---------- decisionEngineAdapter export (M8 v2.0.0 — Sprint 2 收官, 2.1-2.9 全部 done) ----------
//   大少 2026-08-08 15:42 — Sprint 2 sub-task 2.1 done
//   8 個 finalAction 決策樹 (BUY/ADD/HOLD/REDUCE/SELL/WAIT/TRAP/TRANSITION) 已上線
//   Trading card / 短期走勢 / 人話解讀 / adaptive params 將喺 2.2-2.5 commits impl
export const decisionEngineAdapter = {
  id: 'AS-03-DEC',
  name: '終極綜合判斷引擎 (第八模組 · 中長線/短炒 策略)',
  version: '2.2.0',  // 大少 2026-08-11 — 中長線 (position) / 短炒 (swing) 雙策略, 預設中長線; trigger bug fix
  description: '中長線 (position trading, 大少 cycle 風格) 用 M1+zmen cycle synthesizer + 5 個 MA trigger 推導; 短炒 (swing trading, M8 原本) 用 6 個 module 綜合分數推導 8 個行動指令',
  inputs: [
    { key: 'code', label: '股票代碼', type: 'autocomplete', required: true, endpoint: '/api/stocks/search', queryParam: 'q', placeholder: '輸入代碼或名稱', limit: 10, marketFn: 'auto' },
    // 大少 2026-08-11 — 中長線/短炒 策略切換 dropdown
    {
      key: 'strategyMode',
      label: '交易策略',
      type: 'select',
      options: [
        { value: 'swing', label: '🎯 短炒 (M8 原本 8 個最終動作)' },
        { value: 'position', label: '📈 中長線 (大少 cycle 風格, 預設)' },
      ],
      default: 'position',  // 大少 2026-08-11 — 預設中長線 (position trading, 大少 cycle 風格)
      help: '中長線 (position, 預設) = 大少 cycle 風格 (持倉 1-3 個月, 動態 5 日線止蝕, 凱利 1/8); 短炒 (swing) = M8 原本 8 個最終動作 (持倉 1-2 星期, 止蝕-3% 目標+5% 凱利 1/4)',
    },
  ],
  // ============================================================================
  //  M8 Decision Engine 主入口 — decisionEngineAdapter.analyze (M8 v2.2.0)
  //
  //  目的: 綜合 M7 SynthesizerVerdict + 兩條 MA 路徑 (M1 v0.3.0 zmen 嘅
  //        傳統 cycle + M1 v2.0 嘅新均線對齊) + 5 個 MA Trigger 推導
  //        8 個最終動作 (BUY/ADD/HOLD/REDUCE/SELL/WAIT/TRAP/TRANSITION) + 5 個
  //        trading card 價位 (現價/入場/止蝕/目標/移止)。
  //
  //  Input  : klines  = 標準化 K 線 array
  //           options = { code, strategyMode: 'position' | 'swing', ... }
  //                     strategyMode 預設 'position' (大少 2026-08-11 user rule)
  //
  //  Output : M8 Verdict, 包含:
  //           - finalAction: 8 個最終動作之一 (中長線會 map 去 TRAP/TRANSITION/...)
  //           - grade / grade_score (A+ ~ F)
  //           - maTriggers: 5 個 MA trigger (T1-T5) fire status
  //           - cycleTransition: 轉勢確認 / 調整完成 2 個 transition
  //           - tradingCard: { currentPrice, entryZone, stopLoss, targetPrice, trailingStop }
  //           - shortTermOutlook: 9 個 scenarios (UP3/UP1/NEUTRAL/DOWN1/DOWN3/CRASH/RECOVERY/BREAKOUT/REVERSAL)
  //           - adaptiveParams: 7 日 cache 嘅 5 個數學參數 (R²/6 維情緒/ATR%/Pearson/Hurst)
  //           - interpretation: 人話解讀 (Sprint 2 sub-task 2.4 hardcoded template,
  //                            將來會 swap 落 LLM hook per 永久 rule)
  //           - _warnings: 5 個層級 inline 警告
  //
  //  Algorithm 流程:
  //    1. strategyMode 分流 (中長線 'position' / 短炒 'swing')
  //    2. 跑 M7 + M1 v0.3.0 (zmen 舊版 cycle synthesizer 用)
  //    3. 中長線 → cycle synthesizer 推導 5 個 MA trigger + 8 個 action mapping
  //    4. 短炒 → SSI score 推導 8 個 finalAction
  //    5. 兩種策略都會 render trading card + short term outlook + adaptive params
  //    6. propagate warnings: collect M7 + 5 trigger 狀態 + adaptive params 7 日 cache
  //
  //  ⚠️ 永久 rule (大少 2026-08-11):
  //     - 預設中長線 (default 'position')
  //     - 將來 swap LLM hook 喺 interpretation field
  //     - _warnings 永遠 inlined verdict
  //  ⚠️ Cross-ref: modules/decision-engine.ts, modules/cycle-synthesizer.ts,
  //                build/decision-engine.bundle.js (computeMA patch)
  // ============================================================================
  //  M8 Decision Engine 主入口 — decisionEngineAdapter.analyze (Phase 10 backend port)
  //
  //  目的: 拎 M7 SynthesizerVerdict + 6 個 module standard verdict + M9 optimal params →
  //        8 個 finalAction 決策樹 (BUY/ADD/HOLD/REDUCE/SELL/WAIT/TRAP/TRANSITION) +
  //        Trading card 4 個 fields + 短期走勢 9 個 scenarios + LLM hook interpretation
  //
  //  Phase 10 永久 rule (大少 2026-08-20 22:08):
  //    - 拎走 frontend decisionEngineAdapter.analyze chain (340 行)
  //    - 換 1 個 fetch backend /api/algorithms/run?algo=decision_engine stub
  //    - Backend M8 algorithm 拎 synthesize 拎 M7 verdict + 6 個 module standard verdict + M9 optimal params → final_action
  //    - Frontend analyze 包返 backend verdict 拎 frontend shape (final_action / trading_card / short_term_forecast / optimal_data / _warnings top-level)
  //    - Render 拎 backend verdict.optimal_data 拎 M9 optimal params (永久 rule chain M9→M8)
  //    - Phase 10 簡化版拎 swing mode 8 個 finalAction, frontend position mode 拎 cycle_synthesizer 拎唔到 (Phase 11 follow-up)
  //
  //  ⚠️ Cross-ref: backend/algorithms/decision_engine/algorithm.py, backend/services/algorithm_runner.py
  //                (Phase 10 backend port done, frontend chain 拎走)
  // ============================================================================
  analyze: async (klines, options = {}) => {
    const symbol = options.symbol || options.code || 'unknown';

    console.log(`[decisionEngineAdapter] start analyze ${symbol} (Phase 10: fetch backend stub)`);

    // Phase 10 永久 rule: 拎走 frontend chain (import bundle + 拎 cache + calibrate + 拎 M1/zmen + applyAdaptiveParams + decide)
    // 換 1 個 fetch backend /api/algorithms/run?algo=decision_engine call
    let resp;
    try {
      resp = await fetch(`http://localhost:18792/api/algorithms/run?algo=decision_engine&symbol=${encodeURIComponent(symbol)}&period=1d&data_window_days=${options.dataWindowDays ?? 1260}`);
    } catch (e) {
      console.error('[decisionEngineAdapter] fetch backend failed:', e);
      return {
        ok: false,
        symbol,
        algorithm: 'decision_engine',
        version: '2.0.0',
        period: '1d',
        klines_count: (klines || []).length,
        points: [],
        meta: { error: 'Backend fetch failed: ' + e.message },
        warnings: [
          makeWarning('critical', 'M8', 'POST_FAILED',
            'Fetch backend /api/algorithms/run failed (Phase 10 backend stub)',
            { issue: 'Backend fetch exception: ' + e.message, impact: 'Verdict 唔可信, 唔好落單', fix: 'Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc', context: { error: e.message, symbol } }
          ),
        ],
        error: e.message,
        timestamp: Date.now(),
      };
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error(`[decisionEngineAdapter] backend resp not ok: ${resp.status} ${errText}`);
      return {
        ok: false,
        symbol,
        algorithm: 'decision_engine',
        version: '2.0.0',
        period: '1d',
        klines_count: (klines || []).length,
        points: [],
        meta: { error: `Backend HTTP ${resp.status}: ${errText}` },
        warnings: [
          makeWarning('critical', 'M8', 'POST_FAILED',
            `Backend HTTP ${resp.status}`,
            { issue: 'Backend response not ok', impact: 'Verdict 唔可信, 唔好落單', fix: 'Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc', context: { http_status: resp.status, symbol } }
          ),
        ],
        error: errText,
        timestamp: Date.now(),
      };
    }

    const verdict = await resp.json();
    console.log(`[decisionEngineAdapter] backend verdict: ok=${verdict.ok}, final_action=${verdict.meta?.final_action}, klines_count=${verdict.klines_count}`);

    // Phase 10 永久 rule: 包返 backend verdict 拎 frontend shape (render 拎 top-level field, 唔使改 render 內部 field path)
    // Backend warnings 拎 string array → ModuleWarning object array (跟 M9 同 _parseBackendWarnings helper)
    return {
      ...verdict,
      symbol,
      final_action: verdict.meta?.final_action,
      final_action_reason: verdict.meta?.final_action_reason,
      trading_card: verdict.meta?.trading_card,
      short_term_forecast: verdict.meta?.short_term_forecast,
      interpretation: verdict.meta?.interpretation,
      module_verdicts: verdict.meta?.module_verdicts || [],
      synthesizer_verdict: verdict.meta?.synthesizer_verdict || {},
      optimal_data: verdict.meta?.optimal_data || null,
      optimal_params_timestamp: verdict.meta?.optimal_data?.timestamp || null,
      optimal_params_source: verdict.meta?.optimal_data?.bestParams ? 'cache' : 'fresh-calibrate',
      optimal_params_age_seconds: null,
      strategy_mode: options.strategyMode === 'swing' ? 'swing' : 'position',
      _warnings: _parseBackendWarnings(verdict.warnings || []),
    };
  },
  // ============================================================================
  renderResult: (verdict) => {
    if (!verdict) return '<div class="result-error">無 verdict</div>';

    // 大少 2026-08-11 — B 改善: 頂部最佳設定時段 banner
    // 凡人話: 大少一眼睇到 M8 用咗幾時嘅最佳設定(由 M9 cache 嚟)
    // 3 種狀況:
    //   - 冇 cache (fresh-calibrate): 🟡 黃色 banner, 提示用咗 default
    //   - 有 cache + < 7 日: 🟢 綠色 banner, 顯示日期 + age + 剩餘日數
    //   - 有 cache + ≥ 7 日: 🔴 紅色 banner, 提示過期 + 強烈建議重跑 M9
    const optimalParamsBanner = renderOptimalParamsBanner(verdict);

    // 大少 2026-08-11 22:05 — 改善 1: M9 summary sub-section
    // 凡人話: banner 之後, 自動加 1 個 M9 summary 小卡 (從 cache 拎 optimal data)
    //         大少唔需要再撳 M9 module 跑, 就可以見到 M9 拎咗咩 optimal 設定畀 M8
    const m9Summary = renderM9Summary(verdict);

    // 大少 2026-08-11 — 中長線/短炒 wrapper
    //   strategyMode='position' → 中長線 (cycle synth + 5 個 trigger) + 短炒 (原本 M8 8 個最終動作)
    //   strategyMode='swing'    → 只顯示短炒 (backward compat)
    const strategyMode = verdict.strategy_mode || 'swing';
    const swingContent = renderSwingDecisionEngine(verdict);

    if (strategyMode === 'position' && verdict.cycle_synthesizer) {
      const positionContent = renderPositionDecisionEngine(verdict);
      return optimalParamsBanner + m9Summary + positionContent + swingContent;
    }
    return optimalParamsBanner + m9Summary + swingContent;
  },
  getHelp: () => `
    <h3>🚦 終極綜合判斷引擎 (Decision Engine v2.2.0 — M8 中長線/短炒 雙策略)</h3>
    <p>中長線/短炒 雙策略: 中長線 (position, 大少 cycle 風格, 預設) + 短炒 (swing, M8 原本 8 個最終動作)</p>
    <h4>策略切換:</h4>
    <ul>
      <li>📈 <strong>中長線 (position, 預設)</strong>: 用 M1+zmen cycle synthesizer 加權綜合 + 5 個均線觸發器推導, 持倉 1-3 個月, 動態 5 日線止蝕, 凱利 1/8, 唔好追高</li>
      <li>🎯 <strong>短炒 (swing)</strong>: 用 6 個模組綜合分數推導 8 個最終動作, 持倉 1-2 星期, 止蝕-3% 目標+5% 凱利 1/4</li>
    </ul>
    <h4>中長線 (position) 8 個最終動作 規則優先順序:</h4>
    <p>陷阱 → 轉勢 → 賣出 → 減注 → 再睇 → 持有 → 加注 → 買入</p>
    <h4>短炒 (swing) 8 個最終動作 規則優先順序:</h4>
    <p>陷阱 → 轉勢 → 賣出 → 減注 → 再睇 → 持有 → 加注 → 買入</p>
    <h4>5 個均線觸發器 (大少 中長線 trading 風格):</h4>
    <ul>
      <li>🔴 <strong>MA5 -2% 跌破</strong> — 動態 stop, 每日 update, 急煞車</li>
      <li>🟡 <strong>MA5 穿 1 日</strong> — 收緊啲, REDUCE</li>
      <li>🔴 <strong>MA5 穿 2 日</strong> — 急煞車, SELL</li>
      <li>🔴 <strong>MA20 跌破</strong> — 中長期轉弱, SELL</li>
      <li>🟢 <strong>MA5 re-test 成功</strong> — 跌完再上, ADD 加倉</li>
    </ul>
  `,
};

// =============================================================
// 大少 2026-08-11 — 中長線/短炒 render helpers
//   - renderSwingDecisionEngine: 短炒 (swing, M8 原本 8 個最終動作, backward compat)
//   - renderPositionDecisionEngine: 中長線 (position, cycle synth + 5 個觸發器, 大少風格)
//   - 兩個都喺 decisionEngineAdapter.renderResult 串連 (position mode 先中長線後短炒)
// =============================================================

/** 短炒: Swing Trading 嘅 M8 原本 render (大少 19:06 backward compat)
 *  抽自原 decisionEngineAdapter.renderResult, 等 position mode 可以重用
 */
function renderSwingDecisionEngine(verdict) {
  const {
    final_action, final_action_reason,
    trading_card,
    short_term_forecast,
    interpretation,
    module_verdicts,
    module_cycle_verdicts,
    synthesizer_verdict,
    cache_info,
    adaptive_params,
  } = verdict;

  // Grade / SSI / Alignment / Kelly 全部喺 synthesizer_verdict 入面
  const { grade, grade_score, grade_reason, ssi_score, ssi_breakdown, tcm_matrix, alignment_score, kelly_fraction, kelly_position } = synthesizer_verdict || {};

  const actionColor = finalActionColor(final_action);
  const actionLabel = finalActionLabel(final_action);
  const gradeColor = decisionEngineGradeColor(grade);
  const kellyLabel = decisionEngineKellyLabel(kelly_fraction);

  // 6 個 module 嘅 breakdown (大少 2026-08-10 v2: 中文化 + popup tooltip + 顏色 + 對齊 + RSI raw display)
  const M8_TOOLTIPS = {
    module: '6 個演算法模組之一,各自睇股票唔同方面:均線/峰谷/趨勢線/動能/量價/波動',
    state: '個股價大方向(揸車比喻:🟢 上升=油門 / 🟡 橫行=塞車 / 🔴 下跌=落斜 / 🟣 轉勢=要轉彎)',
    conf: '0~100% 信心指數(0=冇 evidence / 70+=強可參考 / 50-70=中 / <50=弱唔好信)',
    weight: 'Synthesizer 分俾呢個演算法嘅權重(6 個加埋=100%,過往準=高,唔係 1/6 平均)',
    expRet: '預期 hold 1 個月平均賺/蝕幾多%(正=賺/0=持平/負=蝕,唔等於一定,係平均估計)',
    maxDD: '最壞情況 1 個月內預期跌幾多%(5%=穩定大股/10%=中等/20%=高波動,用嚟 set 止蝕位)',
    rsi: 'RSI 0-100 情緒指標(>70 超買見頂/30-70 中性/<30 超賣見底)',
    tcm: 'Tactical Confirmation Matrix 戰術交叉驗證:睇 3 對演算法之間嘅共識程度',
    tcm_pair: '2 個演算法嘅配對(共識度計算對象):均線↔趨勢線 / 峰谷↔量價 / 動能↔波動',
    alignment_score: '2 個演算法共識度(-1.0 到 +1.0,+1.0=完全一致/0=冇共識/-1.0=完全相反)',
    trap_penalty: '2 個演算法矛盾時要扣幾多 % 信心(0-100%,越高越要小心)',
    module_table_title: 'M8 verdict card 嘅模組判決 = M7 嘅 6 個演算法結果(同 M7 對齊格式)',
  };
  const M8_stateTooltipMap = {
    UP: '🟢 個股價大方向向上(揸車比喻=油門踩緊,一望無際)',
    DOWN: '🔴 個股價大方向向下(揸車比喻=落斜,踩緊迫力)',
    SIDEWAYS: '🟡 個股價大方向橫行(揸車比喻=塞車,等綠燈)',
    TRANSITION: '🟣 個股價大方向轉勢中(揸車比喻=要轉彎,收油準備)',
    TRAP: '🟣 假突破陷阱,虛漲訊號,唔好信',
  };
  const M8_expRetColor = (v) => v > 0 ? '#26BA75' : v < 0 ? '#EE5151' : '#999';
  const M8_confColor = (v) => v >= 0.7 ? '#26BA75' : v >= 0.5 ? '#F39C12' : '#EE5151';
  const M8_rsiInfo = (r) => {
    // r = sentiment_6d.rsi (normalized 0-1, M8 入面) → raw 0-100
    const raw = Math.max(0, Math.min(100, Math.round((r + 1) * 50)));
    if (raw >= 70) return { value: raw, label: '超買', color: '#EE5151' };
    if (raw <= 30) return { value: raw, label: '超賣', color: '#26BA75' };
    return { value: raw, label: '中性', color: '#F39C12' };
  };

  const moduleRows = (module_verdicts || []).map(mv => {
    const color = decisionEngineModuleStateColor(mv.state);
    const modNameZh = MODULE_NAME_ZH[mv.module_id] || mv.module_id;
    const rsi = M8_rsiInfo(mv.sentiment_6d?.rsi || 0);
    const expColor = M8_expRetColor(mv.expected_return);
    const confColor = M8_confColor(mv.confidence);
    return `
      <tr style="vertical-align:middle;">
        <td class="m8-verdict-tooltip" data-help="${M8_TOOLTIPS.module}" style="text-align:left;padding:10px 12px;white-space:nowrap;min-width:80px;font-weight:500;">${modNameZh}</td>
        <td class="m8-verdict-tooltip" data-help="${M8_stateTooltipMap[mv.state] || M8_TOOLTIPS.state}" style="text-align:center;padding:10px 12px;white-space:nowrap;min-width:80px;vertical-align:middle;"><span class="state-pill" style="display:inline-block;min-width:64px;text-align:center;background:${color}22;color:${color};border:1px solid ${color};border-radius:5px;padding:5px 10px;font-weight:600;">${decisionEngineStateLabel(mv.state)}</span></td>
        <td class="m8-verdict-tooltip" data-help="${M8_TOOLTIPS.conf}" style="text-align:right;padding:10px 12px;white-space:nowrap;min-width:70px;color:${confColor};font-weight:600;">${(mv.confidence * 100).toFixed(0)}%</td>
        <td class="m8-verdict-tooltip" data-help="${M8_TOOLTIPS.weight}" style="text-align:right;padding:10px 12px;white-space:nowrap;min-width:70px;">${(mv.base_weight * 100).toFixed(0)}%</td>
        <td class="m8-verdict-tooltip" data-help="${M8_TOOLTIPS.expRet}" style="text-align:right;padding:10px 12px;color:${expColor};font-weight:600;white-space:nowrap;min-width:90px;">${(mv.expected_return * 100).toFixed(2)}%</td>
        <td class="m8-verdict-tooltip" data-help="${M8_TOOLTIPS.maxDD}" style="text-align:right;padding:10px 12px;white-space:nowrap;min-width:80px;">${(mv.max_drawdown_estimate * 100).toFixed(1)}%</td>
        <td class="m8-verdict-tooltip" data-help="${M8_TOOLTIPS.rsi}" style="text-align:right;padding:10px 12px;white-space:nowrap;min-width:110px;">${rsi.value} <span style="color:${rsi.color};font-size:13px;font-weight:600;">(${rsi.label})</span></td>
      </tr>
    `;
  }).join('');

  // TCM 3 對 pair (大少 2026-08-10 v2: 中文 pair 名 + popup tooltip + 顏色 + 對齊 1:1:1)
  const tcmRows = (tcm_matrix || []).map(p => {
    const alignColor = p.alignment > 0 ? '#26BA75' : p.alignment < 0 ? '#EE5151' : '#F39C12';
    const pair0Zh = MODULE_NAME_ZH[p.pair[0]] || p.pair[0];
    const pair1Zh = MODULE_NAME_ZH[p.pair[1]] || p.pair[1];
    return `
      <tr style="vertical-align:middle;">
        <td class="m8-verdict-tooltip" data-help="${M8_TOOLTIPS.tcm_pair}" style="text-align:left;padding:10px 14px;white-space:nowrap;min-width:150px;font-weight:500;">${pair0Zh} ↔ ${pair1Zh}</td>
        <td class="m8-verdict-tooltip" data-help="${M8_TOOLTIPS.alignment_score}" style="text-align:right;padding:10px 14px;white-space:nowrap;min-width:150px;"><span style="color:${alignColor};font-weight:700;font-size:15px;">${p.alignment > 0 ? '+' : ''}${p.alignment.toFixed(1)}</span></td>
        <td class="m8-verdict-tooltip" data-help="${M8_TOOLTIPS.trap_penalty}" style="text-align:right;padding:10px 14px;white-space:nowrap;min-width:150px;font-weight:600;font-size:15px;">${(p.trap_penalty * 100).toFixed(0)}%</td>
      </tr>
    `;
  }).join('');

  // Trading card 2.2 adaptive (跟 synthesizerVerdict.kelly_fraction + max_drawdown_estimate)
  // 大少 2026-08-10 v2: 5 個 fields (加現價 field 即使休市都 show) + popup tooltip
  const tc = trading_card || { entry_zone: [0, 0], stop_loss: 0, take_profit: 0, trailing_stop: 0 };
  // 判斷 volatility bucket 顯示
  const synthKf = kelly_fraction;
  let volBucketLabel = '';
  if (synthKf === 'octo') volBucketLabel = '🔴 高波動 (凱利 = 八分一倉) — 入場闊 ±2.5% / 止蝕 -5% / 目標 +8%';
  else if (synthKf === 'quarter') volBucketLabel = '🟡 中波動 (凱利 = 四分一倉) — 入場 ±1.5% / 止蝕 -3% / 目標 +5%';
  else if (synthKf === 'half') volBucketLabel = '🟢 低波動 (凱利 = 半倉) — 入場窄 ±1.0% / 止蝕 -2% / 目標 +4%';
  // 現價: 從 entry_zone mid 拎 (fallback if 0)
  const lastPrice = (tc.entry_zone[0] + tc.entry_zone[1]) / 2;
  const hasPrice = lastPrice > 0;
  const M8_TC_TOOLTIPS = {
    current_price: '現價: 從 entry_zone 中間值計,即使休市都會顯示最後 close 價',
    entry_zone: '🎯 入場區間: 現價 ±1.5% (中波動) / ±2.5% (高波動) / ±1.0% (低波動)',
    stop_loss: '🛑 止蝕: 跌破即 cut loss (中波動 -3% / 高 -5% / 低 -2%)',
    take_profit: '🏆 目標: 升到即食糊 (中波動 +5% / 高 +8% / 低 +4%)',
    trailing_stop: '📉 移動止蝕: 跟住個價行,跌穿即走 (中 -5% / 高 -7% / 低 -3%)',
    vol_bucket: '波動度分級 (高/中/低), 決定 trading card 闊窄, 跟 Kelly 倉位 + max_drawdown_estimate 自動切',
  };
  const tradingCardHTML = `
    <h4 class="m8-verdict-tooltip" data-help="交易卡: 4 個價位 (現價/入場/止蝕/目標/移止) + 波動度分級, 跟 Kelly + maxDD bucket 自動切闊窄" style="margin-top:24px;margin-bottom:4px;">💰 交易卡 (Trading Card — 2.2 adaptive)</h4>
    <div class="m8-verdict-tooltip" data-help="${M8_TC_TOOLTIPS.vol_bucket}" style="font-size:12px;color:#666;margin-bottom:8px;">${volBucketLabel}</div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;">
      <div class="trading-card-field m8-verdict-tooltip" data-help="${M8_TC_TOOLTIPS.current_price}" style="background:${hasPrice ? '#fffbe6' : '#f9f9f9'};border:1px solid ${hasPrice ? '#FAAD14' : '#ddd'};border-radius:8px;padding:12px;">
        <div style="font-size:12px;color:#666;">⏸️ 現價 ${hasPrice ? '(休市)' : ''}</div>
        <div style="font-size:14px;font-weight:700;color:${hasPrice ? '#FAAD14' : '#999'};">${hasPrice ? '$' + lastPrice.toFixed(2) : '—'}</div>
      </div>
      <div class="trading-card-field m8-verdict-tooltip" data-help="${M8_TC_TOOLTIPS.entry_zone}" style="background:#f9f9f9;border-radius:8px;padding:12px;">
        <div style="font-size:12px;color:#666;">🎯 入場區間 (±1.5%)</div>
        <div style="font-size:14px;font-weight:700;">$${tc.entry_zone[0].toFixed(2)} - $${tc.entry_zone[1].toFixed(2)}</div>
      </div>
      <div class="trading-card-field m8-verdict-tooltip" data-help="${M8_TC_TOOLTIPS.stop_loss}" style="background:#f9f9f9;border-radius:8px;padding:12px;">
        <div style="font-size:12px;color:#666;">🛑 止蝕 (-3%)</div>
        <div style="font-size:14px;font-weight:700;color:#EE5151;">$${tc.stop_loss.toFixed(2)}</div>
      </div>
      <div class="trading-card-field m8-verdict-tooltip" data-help="${M8_TC_TOOLTIPS.take_profit}" style="background:#f9f9f9;border-radius:8px;padding:12px;">
        <div style="font-size:12px;color:#666;">🏆 目標 (+5%)</div>
        <div style="font-size:14px;font-weight:700;color:#26BA75;">$${tc.take_profit.toFixed(2)}</div>
      </div>
      <div class="trading-card-field m8-verdict-tooltip" data-help="${M8_TC_TOOLTIPS.trailing_stop}" style="background:#f9f9f9;border-radius:8px;padding:12px;">
        <div style="font-size:12px;color:#666;">📉 移動止蝕 (5%)</div>
        <div style="font-size:14px;font-weight:700;">$${tc.trailing_stop.toFixed(2)}</div>
      </div>
    </div>
  `;

  return `
    <div class="decision-engine-result swing-line" style="font-family: system-ui, sans-serif;margin-top:24px;padding-top:24px;border-top:3px dashed #1890ff;">
      <!-- 自訂 CSS tooltip (大少 2026-08-10 v2 enhancement: 即時顯示 0.1s + 大字 14px + 箭嘴, 跟 M7 一樣) -->
      <style>
        .m8-verdict-tooltip { position: relative; cursor: help; }
        .m8-verdict-tooltip:hover::after {
          content: attr(data-help);
          position: absolute;
          bottom: calc(100% + 8px);
          left: 50%;
          transform: translateX(-50%);
          background: rgba(0, 0, 0, 0.92);
          color: #fff;
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 14px;
          line-height: 1.6;
          white-space: normal;
          width: max-content;
          max-width: 380px;
          z-index: 9999;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          pointer-events: none;
          animation: m8TooltipFadeIn 0.1s ease-in;
        }
        .m8-verdict-tooltip:hover::before {
          content: '';
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          border: 6px solid transparent;
          border-top-color: rgba(0, 0, 0, 0.92);
          z-index: 10000;
          pointer-events: none;
        }
        @keyframes m8TooltipFadeIn { from { opacity: 0; } to { opacity: 1; } }
      </style>
      <div style="text-align:center;margin-bottom:16px;">
        <span style="background:#1890ff;color:white;padding:6px 16px;border-radius:20px;font-size:14px;font-weight:700;">🎯 短炒 · Swing Trading (M8 原本 8 個最終動作)</span>
      </div>
      <!-- 頂部 M8 finalAction 標籤 (新加, 揸車比喻) -->
      <div class="m8-final-action-card" style="background:linear-gradient(135deg, ${actionColor}33, ${actionColor}0a);border:3px solid ${actionColor};border-radius:12px;padding:20px;margin-bottom:16px;text-align:center;">
        <div class="m8-verdict-tooltip" data-help="短炒最終行動指令: 8 個最終動作 (買入/加注/持有/等待/減注/賣出/陷阱/轉勢), 跟 6 個模組綜合分數推導, 揸車比喻貫穿 (油門/收油/急煞車/唔好信導航)" style="font-size:14px;color:#666;margin-bottom:4px;">🚦 短炒最終行動指令 (8 個最終動作)</div>
        <div style="font-size:36px;font-weight:700;color:${actionColor};line-height:1.2;">${actionLabel}</div>
        <div style="font-size:16px;font-weight:600;color:${actionColor};margin-top:4px;">${finalActionShortLabel(final_action)}</div>
        <div style="font-size:14px;color:#444;margin-top:12px;line-height:1.6;">${final_action_reason}</div>
      </div>

      <!-- 原有 M7 verdict card (Grade + SSI + Alignment + Kelly) -->
      <div class="verdict-card" style="background:linear-gradient(135deg, ${gradeColor}22, ${gradeColor}08);border:2px solid ${gradeColor};border-radius:12px;padding:20px;margin-bottom:20px;text-align:center;">
        <div style="font-size:14px;color:#666;margin-bottom:8px;">📊 M7 Synthesizer 評級 (Grade)</div>
        <div style="font-size:48px;font-weight:700;color:${gradeColor};line-height:1;">${grade}</div>
        <div style="font-size:18px;color:#666;margin-top:8px;">分數 ${grade_score.toFixed(1)} / 100</div>
        <div style="font-size:14px;color:#999;margin-top:4px;">${grade_reason}</div>
        <div style="display:flex;justify-content:center;gap:24px;margin-top:16px;font-size:14px;">
          <div>🟢 <strong>SSI</strong>: ${ssi_score.toFixed(1)} / 100</div>
          <div>📐 <strong>Alignment</strong>: ${(alignment_score * 100).toFixed(1)}%</div>
          <div>💰 <strong>Kelly</strong>: ${kellyLabel}</div>
        </div>
      </div>

      ${tradingCardHTML}

      <!-- 2.8 — 4 個 SVG charts (永遠全 Show, 大少 11:57 永久 rule) -->
      <h4 class="m8-verdict-tooltip" data-help="4 個 SVG 圖表: 6 維情緒雷達 (個股 6 個維度情緒) + 凱利倉位環 (倉位大小) + 對齊度條 (6 個模組同向程度) + 模組狀態條 (6 個模組個別方向)" style="margin-top:24px;margin-bottom:4px;">📊 4 個 SVG 圖表 (2.8 — 6 維情緒雷達 / 凱利倉位環 / 對齊度條 / 模組狀態條)</h4>
      <div style="font-size:12px;color:#666;margin-bottom:12px;">🟢 強勢 / 🟡 中性 / 🔴 弱勢 / 🟣 矛盾/陷阱 (6 顏色永久 rule)</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin-bottom:20px;">
        <div class="chart-cell" style="background:#fafafa;border-radius:8px;padding:12px;">
          ${renderSentimentRadar(verdict.module_verdicts && verdict.module_verdicts[0] ? verdict.module_verdicts[0].sentiment_6d : null, '1️⃣ Sentiment Radar (6 維情緒雷達)', finalActionColor(final_action))}
        </div>
        <div class="chart-cell" style="background:#fafafa;border-radius:8px;padding:12px;">
          ${renderKellyDonut(verdict.synthesizer_verdict.kelly_fraction)}
        </div>
        <div class="chart-cell" style="background:#fafafa;border-radius:8px;padding:12px;">
          ${renderAlignmentBar(verdict.synthesizer_verdict.alignment_score)}
        </div>
        <div class="chart-cell" style="background:#fafafa;border-radius:8px;padding:12px;">
          ${renderModuleStateBar(verdict.module_verdicts)}
        </div>
      </div>

      <!-- 短期走勢預測 (大少 2026-08-10 v2: 中文化 + 對齊 + popup tooltip) -->
      <h4 class="m8-verdict-tooltip" data-help="短期走勢預測: 3 種可能走勢(樂觀 25%/基準 50%/悲觀 25%) × 3 個時段(5/10/20 日) = 9 個情境" style="margin-top:24px;margin-bottom:4px;">📊 短期走勢預測 (9 個情境: 3 × 3 時段)</h4>
      <div style="font-size:12px;color:#666;margin-bottom:8px;">⚠️ 重要: 呢個係 3 種可能走勢(conditional scenarios), 唔係預測(prediction), 真實決定睇 finalAction trigger</div>
      ${renderForecastTable(short_term_forecast)}

      <!-- 人話詳細解讀 (2.4 — LLM hook + hardcoded template, 大少 13:30 永久 rule) -->
      <h4 style="margin-top:24px;margin-bottom:4px;">📖 大少話你知 (2.4 — 人話詳細解讀, LLM hook 預留)</h4>
      <div style="font-size:12px;color:#666;margin-bottom:8px;">🪝 將來可 swap 落 LLM call (OpenAI / MiniMax / Kimi), 而家用 hardcoded template</div>
      ${renderInterpretation(interpretation, final_action)}

      <!-- 5 個 Adaptive Params (2.5 + 2.6 L2 cache) -->
      ${renderAdaptiveParams(adaptive_params, cache_info)}

      <!-- 6 個 Metric Mini-Cards -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;">
        <div class="metric-card" style="background:#f9f9f9;border-radius:8px;padding:12px;">
          <div style="font-size:12px;color:#666;">SSI 一致性</div>
          <div style="font-size:24px;font-weight:700;">${(ssi_breakdown.consistency * 100).toFixed(0)}%</div>
        </div>
        <div class="metric-card" style="background:#f9f9f9;border-radius:8px;padding:12px;">
          <div style="font-size:12px;color:#666;">SSI 平均信心</div>
          <div style="font-size:24px;font-weight:700;">${(ssi_breakdown.confidence_avg * 100).toFixed(0)}%</div>
        </div>
        <div class="metric-card" style="background:#f9f9f9;border-radius:8px;padding:12px;">
          <div style="font-size:12px;color:#666;">SSI 規則覆蓋</div>
          <div style="font-size:24px;font-weight:700;">${(ssi_breakdown.rules_coverage * 100).toFixed(0)}%</div>
        </div>
      </div>

      <!-- 6 個 modules 嘅 breakdown (大少 2026-08-10 v2: 中文化 column header + popup tooltip + 對齊) -->
      <h4 class="m8-verdict-tooltip" data-help="${M8_TOOLTIPS.module_table_title}" style="margin-top:24px;margin-bottom:10px;font-size:16px;">📦 6 個模組嘅標準判決</h4>
      <table class="data-summary m8-verdict-table" style="width:100%;border-collapse:collapse;font-size:14px;table-layout:auto;word-break:keep-all;">
        <thead>
          <tr style="background:#f0f0f0;">
            <th class="m8-verdict-tooltip" data-help="${M8_TOOLTIPS.module}" style="text-align:left;padding:10px 12px;min-width:80px;white-space:nowrap;vertical-align:middle;">模組</th>
            <th class="m8-verdict-tooltip" data-help="${M8_TOOLTIPS.state}" style="text-align:center;padding:10px 12px;min-width:80px;white-space:nowrap;vertical-align:middle;">方向</th>
            <th class="m8-verdict-tooltip" data-help="${M8_TOOLTIPS.conf}" style="text-align:right;padding:10px 12px;min-width:70px;white-space:nowrap;vertical-align:middle;">信心</th>
            <th class="m8-verdict-tooltip" data-help="${M8_TOOLTIPS.weight}" style="text-align:right;padding:10px 12px;min-width:70px;white-space:nowrap;vertical-align:middle;">比重</th>
            <th class="m8-verdict-tooltip" data-help="${M8_TOOLTIPS.expRet}" style="text-align:right;padding:10px 12px;min-width:90px;white-space:nowrap;vertical-align:middle;">預期回報</th>
            <th class="m8-verdict-tooltip" data-help="${M8_TOOLTIPS.maxDD}" style="text-align:right;padding:10px 12px;min-width:80px;white-space:nowrap;vertical-align:middle;">最大回撤</th>
            <th class="m8-verdict-tooltip" data-help="${M8_TOOLTIPS.rsi}" style="text-align:right;padding:10px 12px;min-width:110px;white-space:nowrap;vertical-align:middle;">情緒指數</th>
          </tr>
        </thead>
        <tbody>${moduleRows}</tbody>
      </table>

      <!-- TCM 3 對 pair (大少 2026-08-10 v2: 中文化 + popup tooltip + 對齊 1:1:1) -->
      <h4 class="m8-verdict-tooltip" data-help="${M8_TOOLTIPS.tcm}" style="margin-top:28px;margin-bottom:10px;font-size:16px;">🔀 TCM 戰術交叉驗證 (3 對配對)</h4>
      <table class="data-summary" style="width:100%;border-collapse:collapse;font-size:14px;table-layout:auto;word-break:keep-all;">
        <thead>
          <tr style="background:#f0f0f0;">
            <th class="m8-verdict-tooltip" data-help="${M8_TOOLTIPS.tcm_pair}" style="text-align:left;padding:10px 14px;min-width:150px;white-space:nowrap;vertical-align:middle;">配對</th>
            <th class="m8-verdict-tooltip" data-help="${M8_TOOLTIPS.alignment_score}" style="text-align:right;padding:10px 14px;min-width:150px;white-space:nowrap;vertical-align:middle;">共識度</th>
            <th class="m8-verdict-tooltip" data-help="${M8_TOOLTIPS.trap_penalty}" style="text-align:right;padding:10px 14px;min-width:150px;white-space:nowrap;vertical-align:middle;">矛盾扣分</th>
          </tr>
        </thead>
        <tbody>${tcmRows}</tbody>
      </table>
    </div>
  `;
}

/** 中長線: Position Trading 嘅 cycle synth 結果 render (大少 19:06)
 *  顯示 3 個結果 (M1 / zmen / 加權綜合) + 5 個均線觸發器 + 動態 5 日線/20 日線 stop trading card
 *  UI order: 中長線先 (大少 19:06 永久 rule)
 */
function renderPositionDecisionEngine(verdict) {
  const {
    final_action, final_action_reason,
    cycle_synthesizer,
    position_trading_card,
    interpretation,
    m1_verdict,
    zmen_verdict,
  } = verdict;

  if (!cycle_synthesizer) return '';

  const { state, confidence, conflict, warning, m1State, zmenState, weights, transitions, triggers, meta } = cycle_synthesizer;
  const tc = position_trading_card || {};

  // 狀態顏色
  const stateColors = {
    UP: '#26BA75',
    DOWN: '#EE5151',
    SIDEWAYS: '#F39C12',
    CONFLICT: '#722ed1',
  };
  const stateLabels = {
    UP: '上升',
    DOWN: '下跌',
    SIDEWAYS: '橫行',
    CONFLICT: '⚠️ 訊號分歧',
  };

  // final action 顏色
  const actionColor = finalActionColor(final_action);
  const actionLabel = finalActionLabel(final_action);

  // 第一個結果: M1 (新版均線演算法 v2.0) 嘅 cycle verdict
  const m1ResultHTML = m1_verdict ? `
    <div class="cycle-synth-result m8-verdict-tooltip" data-help="M1: 新版均線演算法 v2.0 (AS-03-MA v2.0, 用 5 日線/10 日線/20 日線配合 13 條 rule 判斷大方向, 較新, 用嚟做中長線 trading 嘅主力)" style="background:#f0f8ff;border:2px solid #1890ff;border-radius:8px;padding:12px;">
      <div style="font-size:13px;font-weight:700;color:#1890ff;margin-bottom:6px;">① M1 (新版均線演算法 v2.0)</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <span class="state-pill" style="background:${stateColors[m1_verdict.state] || '#666'};color:white;padding:4px 10px;border-radius:4px;font-size:12px;">
          ${stateLabels[m1_verdict.state] || m1_verdict.state}
        </span>
        <span style="font-size:14px;font-weight:600;">${(m1_verdict.confidence * 100).toFixed(0)}% 信心</span>
      </div>
      <div style="font-size:11px;color:#666;margin-top:4px;">${m1_verdict.meta?.source || '新版均線演算法 v2.0'}</div>
    </div>
  ` : '<div class="cycle-synth-result">無 m1 演算法結果</div>';

  // 第二個結果: zmen (舊版均線演算法 v0.3.0) 嘅 cycle verdict
  const zmenResultHTML = zmen_verdict ? `
    <div class="cycle-synth-result m8-verdict-tooltip" data-help="zmen 均算法: 舊版均線演算法 v0.3.0 (zmen 風格, 較舊但穩定, 用嚟做 cross-check 同 M1 對比共識, 60/40 加權)" style="background:#fff7e6;border:2px solid #fa8c16;border-radius:8px;padding:12px;">
      <div style="font-size:13px;font-weight:700;color:#fa8c16;margin-bottom:6px;">② zmen (舊版均線演算法 v0.3.0)</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <span class="state-pill" style="background:${stateColors[zmen_verdict.state] || '#666'};color:white;padding:4px 10px;border-radius:4px;font-size:12px;">
          ${stateLabels[zmen_verdict.state] || zmen_verdict.state}
        </span>
        <span style="font-size:14px;font-weight:600;">${(zmen_verdict.confidence * 100).toFixed(0)}% 信心</span>
      </div>
      <div style="font-size:11px;color:#666;margin-top:4px;">${zmen_verdict.meta?.source || '舊版均線演算法 v0.3.0'}</div>
    </div>
  ` : '<div class="cycle-synth-result">無 zmen 演算法結果</div>';

  // 第三個結果: 加權綜合 (M1 60% + zmen 40%)
  const synthStateColor = stateColors[state] || '#666';
  const synthStateLabel = stateLabels[state] || state;
  const synthResultHTML = `
    <div class="cycle-synth-result" style="background:linear-gradient(135deg, ${synthStateColor}22, ${synthStateColor}08);border:3px solid ${synthStateColor};border-radius:8px;padding:12px;">
      <div style="font-size:13px;font-weight:700;color:${synthStateColor};margin-bottom:6px;">③ 加權綜合 (M1 ${(weights.m1 * 100).toFixed(0)}% + zmen ${(weights.zmen * 100).toFixed(0)}%)</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <span class="state-pill" style="background:${synthStateColor};color:white;padding:4px 10px;border-radius:4px;font-size:12px;">
          ${synthStateLabel}
        </span>
        <span style="font-size:16px;font-weight:700;">${(confidence * 100).toFixed(0)}% 信心</span>
      </div>
      <div style="font-size:11px;color:#666;margin-top:4px;">${conflict ? `⚠️ ${warning || '訊號分歧'}` : '✅ 兩個 module 一致'}</div>
    </div>
  `;

  // 5 個 MA trigger
  const TRIGGER_TOOLTIPS = {
    header: '5 個均線觸發器: 中長線 trading 嘅關鍵 stop 信號, 任何一個觸發都提示要重新評估倉位',
    t1: '5 日線 -2% 跌破: 今日收盤價低過 5 日線 × 0.98, 即跌超過 2%, 動態止蝕信號, 應考慮減倉或離場',
    t2: '穿 1 日: 今日收盤價低過 5 日線 (但未到 -2%), 早期穿破信號, 要密切留意',
    t3: '穿 2 日: 連續 2 日收盤價都低過 5 日線, 確認跌穿, 動能轉弱警號',
    t4: '20 日線跌破: 今日收盤價低過 20 日線, 中期趨勢可能轉弱, 重要警號',
    t5: '5 日線 re-test 成功: 過去 5 日內曾跌穿 5 日線, 今日回升收過 5 日線, 確認短期回升, 可以重新加倉',
    trans_header: '周期轉換: 大少 cycle trading 風格嘅兩個關鍵時機信號',
    turn_around: '轉勢確認: M1 同 zmen 兩個演算法都同步由弱轉強 (信心 ≥ 0.65), 中長線入場嘅最佳時機之一',
    adjustment_complete: '調整完成: 兩個演算法都上升 + 5 日線 re-test 成功, 中長線 buy-back 觸發, 訊號最清晰嘅時機',
  };
  const triggerHTML = `
    <h4 class="m8-verdict-tooltip" data-help="${TRIGGER_TOOLTIPS.header}" style="margin-top:20px;margin-bottom:8px;">🚦 5 個均線觸發器 (大少 中長線 trading 風格)</h4>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;font-size:12px;">
      <div class="m8-verdict-tooltip" data-help="${TRIGGER_TOOLTIPS.t1}" style="background:${triggers.ma5StopTriggered ? '#fff1f0' : '#fafafa'};border:1px solid ${triggers.ma5StopTriggered ? '#EE5151' : '#ddd'};border-radius:6px;padding:8px;text-align:center;">
        <div style="font-size:11px;color:#666;">5 日線 -2%</div>
        <div style="font-size:18px;margin-top:4px;">${triggers.ma5StopTriggered ? '🔴 觸發' : '⚪ 冇'}</div>
      </div>
      <div class="m8-verdict-tooltip" data-help="${TRIGGER_TOOLTIPS.t2}" style="background:${triggers.ma5BreakDay1 ? '#fffbe6' : '#fafafa'};border:1px solid ${triggers.ma5BreakDay1 ? '#FAAD14' : '#ddd'};border-radius:6px;padding:8px;text-align:center;">
        <div style="font-size:11px;color:#666;">穿 1 日</div>
        <div style="font-size:18px;margin-top:4px;">${triggers.ma5BreakDay1 ? '🟡 觸發' : '⚪ 冇'}</div>
      </div>
      <div class="m8-verdict-tooltip" data-help="${TRIGGER_TOOLTIPS.t3}" style="background:${triggers.ma5BreakDay2 ? '#fff1f0' : '#fafafa'};border:1px solid ${triggers.ma5BreakDay2 ? '#EE5151' : '#ddd'};border-radius:6px;padding:8px;text-align:center;">
        <div style="font-size:11px;color:#666;">穿 2 日</div>
        <div style="font-size:18px;margin-top:4px;">${triggers.ma5BreakDay2 ? '🔴 觸發' : '⚪ 冇'}</div>
      </div>
      <div class="m8-verdict-tooltip" data-help="${TRIGGER_TOOLTIPS.t4}" style="background:${triggers.ma20Break ? '#fff1f0' : '#fafafa'};border:1px solid ${triggers.ma20Break ? '#EE5151' : '#ddd'};border-radius:6px;padding:8px;text-align:center;">
        <div style="font-size:11px;color:#666;">20 日線跌破</div>
        <div style="font-size:18px;margin-top:4px;">${triggers.ma20Break ? '🔴 觸發' : '⚪ 冇'}</div>
      </div>
      <div class="m8-verdict-tooltip" data-help="${TRIGGER_TOOLTIPS.t5}" style="background:${triggers.ma5RetestSuccess ? '#f6ffed' : '#fafafa'};border:1px solid ${triggers.ma5RetestSuccess ? '#52C41A' : '#ddd'};border-radius:6px;padding:8px;text-align:center;">
        <div style="font-size:11px;color:#666;">5 日線回測</div>
        <div style="font-size:18px;margin-top:4px;">${triggers.ma5RetestSuccess ? '🟢 成功' : '⚪ 冇'}</div>
      </div>
    </div>
  `;

  // Cycle transition
  const transitionHTML = `
    <h4 class="m8-verdict-tooltip" data-help="${TRIGGER_TOOLTIPS.trans_header}" style="margin-top:16px;margin-bottom:8px;font-size:14px;">🔄 周期轉換 (大少 cycle 風格)</h4>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:12px;font-size:12px;">
      <div class="m8-verdict-tooltip" data-help="${TRIGGER_TOOLTIPS.turn_around}" style="background:${transitions.turnAroundDetected ? '#f6ffed' : '#fafafa'};border:1px solid ${transitions.turnAroundDetected ? '#52C41A' : '#ddd'};border-radius:6px;padding:8px;">
        <div style="font-weight:700;">轉勢確認</div>
        <div style="color:#666;">${transitions.turnAroundDetected ? '✅ 兩個演算法同步由弱轉強' : '⚪ 未確認'}</div>
      </div>
      <div class="m8-verdict-tooltip" data-help="${TRIGGER_TOOLTIPS.adjustment_complete}" style="background:${transitions.adjustmentComplete ? '#f6ffed' : '#fafafa'};border:1px solid ${transitions.adjustmentComplete ? '#52C41A' : '#ddd'};border-radius:6px;padding:8px;">
        <div style="font-weight:700;">調整完成</div>
        <div style="color:#666;">${transitions.adjustmentComplete ? '✅ 5 日線回測成功' : '⚪ 未完成'}</div>
      </div>
    </div>
  `;

  // Position trading card (動態 5 日線/20 日線 stop)
  // 現價: 跟短炒一樣, 從 cycle synth 嘅 meta.currentPrice 拎 (fallback if null)
  const posCurrentPrice = meta?.currentPrice;
  const hasPosPrice = posCurrentPrice != null && posCurrentPrice > 0;
  const POS_TC_TOOLTIPS = {
    header: '中長線交易卡: 4 個關鍵價位 (現價/入場/動態止蝕/移動止蝕), 跟 5 日線 + 20 日線 動態調整, 唔設固定目標價',
    current_price: '⏸️ 現價: 從 cycle synthesizer 嘅 meta.currentPrice 拎, 今日 close 價。即使休市都會顯示最後收盤價',
    holding: '持倉時間: 1-3 個月, 中長線 trading 唔急食糊, 等中長期趨勢自然行',
    kelly: '凱利倉位: 八分一倉 (1/8) 預設, 波動大自動收細, 跌穿動態止蝕就走',
    entry_zone_pos: '🎯 入場區間: 現價 ±1.5% (跟中波動預設, 高波動 ±2.5%, 低波動 ±1.0%)',
    dynamic_stop: '🛑 動態止蝕: 跟 5 日線 × 0.98 自動調整, 比固定 -3% 止蝕更貼市, 大少中長線風格',
    trailing_stop: '📉 移動止蝕: 跟 20 日線, 升穿就上移, 跌穿就走, 鎖定中長期利潤',
    footer: '中長線 trading 唔設固定目標價 (唔似短炒 +5%), 等中長期走勢自然行, 動態止蝕觸發就走',
  };
  const positionTradingCardHTML = `
    <h4 class="m8-verdict-tooltip" data-help="${POS_TC_TOOLTIPS.header}" style="margin-top:20px;margin-bottom:8px;">💰 中長線交易卡 (動態 5 日線/20 日線止蝕 · 凱利 1/8)</h4>
    <div style="font-size:12px;color:#666;margin-bottom:8px;">
      <span class="m8-verdict-tooltip" data-help="${POS_TC_TOOLTIPS.holding}">📌 持倉 ${tc.holding_period || '1-3 個月'}</span> ·
      <span class="m8-verdict-tooltip" data-help="${POS_TC_TOOLTIPS.kelly}">凱利 ${tc.kelly_fraction || '八分一倉'} (1/8)</span> ·
      唔好追高, 訊號清晰先入場
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;">
      <div class="trading-card-field m8-verdict-tooltip" data-help="${POS_TC_TOOLTIPS.current_price}" style="background:${hasPosPrice ? '#fffbe6' : '#f9f9f9'};border:1px solid ${hasPosPrice ? '#FAAD14' : '#ddd'};border-radius:8px;padding:12px;">
        <div style="font-size:12px;color:#666;">⏸️ 現價 ${hasPosPrice ? '(休市)' : ''}</div>
        <div style="font-size:14px;font-weight:700;color:${hasPosPrice ? '#FAAD14' : '#999'};">${hasPosPrice ? '$' + posCurrentPrice.toFixed(2) : '—'}</div>
      </div>
      <div class="trading-card-field m8-verdict-tooltip" data-help="${POS_TC_TOOLTIPS.entry_zone_pos}" style="background:#f9f9f9;border-radius:8px;padding:12px;">
        <div style="font-size:12px;color:#666;">🎯 入場區間 (±1.5%)</div>
        <div style="font-size:14px;font-weight:700;">$${(tc.entry_zone?.[0] || 0).toFixed(2)} - $${(tc.entry_zone?.[1] || 0).toFixed(2)}</div>
      </div>
      <div class="trading-card-field m8-verdict-tooltip" data-help="${POS_TC_TOOLTIPS.dynamic_stop}" style="background:#fff1f0;border-radius:8px;padding:12px;">
        <div style="font-size:12px;color:#666;">🛑 動態止蝕 (5 日線 × 0.98)</div>
        <div style="font-size:14px;font-weight:700;color:#EE5151;">$${(tc.stop_loss || 0).toFixed(2)}</div>
        <div style="font-size:10px;color:#999;">5 日線 = ${meta.ma5 != null ? `$${meta.ma5.toFixed(2)}` : '(數據不足)'}</div>
      </div>
      <div class="trading-card-field m8-verdict-tooltip" data-help="${POS_TC_TOOLTIPS.trailing_stop}" style="background:#f0f5ff;border-radius:8px;padding:12px;">
        <div style="font-size:12px;color:#666;">📉 移動止蝕 (20 日線)</div>
        <div style="font-size:14px;font-weight:700;">$${(tc.trailing_stop || 0).toFixed(2)}</div>
        <div style="font-size:10px;color:#999;">20 日線 = ${meta.ma20 != null ? `$${meta.ma20.toFixed(2)}` : '(數據不足)'}</div>
      </div>
    </div>
    <div class="m8-verdict-tooltip" data-help="${POS_TC_TOOLTIPS.footer}" style="margin-top:8px;font-size:12px;color:#888;background:#fffbe6;border-left:3px solid #FAAD14;padding:8px;border-radius:4px;">
      💡 中長線 trading 唔設固定目標價, 等中長期走勢自然行, 動態止蝕觸發就走
    </div>
  `;

  return `
    <div class="decision-engine-result position-line" style="font-family: system-ui, sans-serif;margin-bottom:24px;">
      <div style="text-align:center;margin-bottom:16px;">
        <span style="background:#26BA75;color:white;padding:6px 16px;border-radius:20px;font-size:14px;font-weight:700;">📈 中長線 · Position Trading (大少 cycle 風格, 預設)</span>
      </div>

      <!-- 頂部 final action (揸車比喻) -->
      <div class="position-final-action-card" style="background:linear-gradient(135deg, ${actionColor}33, ${actionColor}0a);border:3px solid ${actionColor};border-radius:12px;padding:20px;margin-bottom:16px;text-align:center;">
        <div class="m8-verdict-tooltip" data-help="中長線最終行動指令: 8 個最終動作 (買入/加注/持有/等待/減注/賣出/陷阱/轉勢), 跟 cycle synth + 5 個均線觸發器綜合判定, 揸車比喻貫穿 (油門/收油/急煞車/唔好信導航)" style="font-size:14px;color:#666;margin-bottom:4px;">🚦 中長線最終行動指令</div>
        <div style="font-size:36px;font-weight:700;color:${actionColor};line-height:1.2;">${actionLabel}</div>
        <div style="font-size:16px;font-weight:600;color:${actionColor};margin-top:4px;">${finalActionShortLabel(final_action)}</div>
        <div style="font-size:14px;color:#444;margin-top:12px;line-height:1.6;">${final_action_reason}</div>
      </div>

      <!-- 3 個 cycle synth 結果: M1 + zmen + 加權綜合 -->
      <h4 class="m8-verdict-tooltip" data-help="周期合成器 3 個結果: M1 均線演算法 + zmen 舊均算法 + 兩個加權綜合 (大少 19:06 設計), 用嚟比對兩個演算法嘅共識程度, 一致就信心高, 分歧就 conflict" style="margin-top:20px;margin-bottom:8px;">🔬 周期合成器 3 個結果 (M1 + zmen + 加權綜合, 大少 19:06 設計)</h4>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:12px;">
        ${m1ResultHTML}
        ${zmenResultHTML}
        ${synthResultHTML}
      </div>

      ${triggerHTML}
      ${transitionHTML}
      ${positionTradingCardHTML}

      <!-- 人話詳細解讀 (LLM hook) -->
      <h4 style="margin-top:20px;margin-bottom:8px;">📖 大少話你知 (Position Trading 詳細解讀, LLM hook 預留)</h4>
      <div style="font-size:12px;color:#666;margin-bottom:8px;">🪝 將來可 swap 落 LLM call (OpenAI / MiniMax / Kimi), 而家用 hardcoded template</div>
      <div style="background:#fafafa;border-radius:8px;padding:16px;white-space:pre-line;font-size:13px;line-height:1.8;">${interpretation || ''}</div>
    </div>
  `;
}

// ---------- Phase 9 helper: parse backend string warnings → ModuleWarning object array ----------
// 凡人話: backend algorithm run() 拎 string array warnings (format "CODE: message"), frontend _warnings 拎 ModuleWarning object array (with level / module_id / code / message / context / impact / fix)
// 永久 rule: testing page 拎 verdict shape 對齊 backend Verdict contract, 警告 string array 必須 parse 做 ModuleWarning object array 畀 frontend render warning banner
function _parseBackendWarnings(stringWarnings) {
  if (!Array.isArray(stringWarnings)) return [];
  return stringWarnings.map(s => {
    if (!s || typeof s !== 'string') {
      return makeWarning('warning', 'M9', 'UNKNOWN', String(s), {
        issue: String(s),
        impact: 'Verdict 唔可信, 唔好落單',
        fix: 'Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc',
      });
    }
    // 格式 "CODE: message" (e.g. "POST_FAILED: 0 validate samples")
    const colonIdx = s.indexOf(':');
    if (colonIdx === -1) {
      return makeWarning('warning', 'M9', 'UNKNOWN', s, {
        issue: s,
        impact: 'Verdict 唔可信, 唔好落單',
        fix: 'Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc',
      });
    }
    const code = s.substring(0, colonIdx).trim();
    const message = s.substring(colonIdx + 1).trim();
    // 大少 2026-08-14 12:10 Spec Sync #18: impact/fix 跟 CATEGORY_DISPLAY template
    return makeWarning('warning', 'M9', code, message, {
      issue: message,
      impact: 'Verdict 唔可信, 唔好落單',
      fix: 'Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc',
    });
  });
}

// ---------- backTestAdapter export (M9 v0.6.0 — Sprint 3 sub-task 9.7 UI 升級 done, Phase 9 backend port) ----------
//   大少 2026-08-08 22:28 — 9.5 Testing page entry 09 — AS-03-BT
//   9.6 — HK.00700 pilot + spec doc + ROADMAP + 4 fixes
//   9.7 — M9 UI 升級 (3 SVG charts + 6 色標 + 永遠 full show + 2 個真實可 click button + 大少話你知 LLM hook)
//   Phase 9 (大少 2026-08-20 21:54) — 拎走 frontend backTestAdapter.analyze (210 行), 換 fetch backend /api/algorithms/run?algo=back_test
//   永久 rule: 改 algorithms/AS-03-cycle-detection/adapter.mjs 之後, 必須同步 bump testing-page.js ALGO_CACHE_BUST + testing-page/index.html ?v=2.3.X
//   Render 顯示: ⏰ header / 🎯 最佳參數 + Kelly pie / 📊 整體表現 + Walk-Forward bar / 📋 段細節 / 📜 過往判決 / 📖 大少話你知 / 🔄 Apply to M8
export const backTestAdapter = {
  id: 'AS-03-BT',
  name: '回測驗證 (第九模組)',
  version: '0.6.0',
  description: '用歷史 K 線重播之前嘅判決, 對比之後 5 / 10 / 20 日真實升咗幾多, 等你知道個演算法之前嘅判斷啱唔啱, 仲會自動搵出呢隻股票嘅最佳設定',
  inputs: [
    { key: 'code', label: '股票代碼', type: 'autocomplete', required: true, endpoint: '/api/stocks/search', queryParam: 'q', placeholder: '輸入代碼或名稱', limit: 10, marketFn: 'auto' },
    { key: 'dataWindowDays', label: '回顧天數 (睇過去幾多日數)', type: 'number', default: 1260, min: 90, max: 1260 },
    { key: 'stepDays', label: '跑判決步長 (每隔幾日跑一次)', type: 'number', default: 5, min: 1, max: 30 },
  ],
  // ============================================================================
  //  M9 Back Test 主入口 — backTestAdapter.analyze (Phase 9 拎走 frontend chain, 換 fetch backend stub)
  //
  //  目的: 拎 M8 verdict 嘅歷史, 用 walk-forward CV (time-series cross-validation)
  //        重播之前嘅判決, 對比之後 5/10/20 日真實升跌, 同時自動搵出呢隻股票
  //        嘅最佳參數 (grid search over adaptive params)。
  //
  //  Input  : klines  = 標準化 K 線 array (window 預設 1260 日 = 5 年)
  //           options = { code, dataWindowDays=1260, stepDays=5, ... }
  //
  //  Output : M9 Back Test Verdict, shape 對齊 backend /api/algorithms/run response
  //           - meta.walkForwardResult: 完整 walk-forward CV 結果 (frontend render 拎)
  //           - meta.optimal: bestParams + avgValidateScore + stabilityScore
  //           - meta.forwardReturnHistory: 過去 20 條 forward return 累積
  //           - meta.postErrors: forward return POST 失敗 list
  //           - _warnings: backend algorithm 注入 (POST_FAILED / LOW_SAMPLE_SIZE / VERDICT_MISSING)
  //
  //  Phase 9 永久 rule:
  //    - backend M9 algorithm 拎 walk-forward CV + auto POST optimal + forward return records 落 cache
  //    - frontend analyze 只係 1 個 fetch backend /api/algorithms/run?algo=back_test 嘅 stub
  //    - renderResult 拎 backend verdict.meta.walkForwardResult 而唔係 frontend shape
  //    - 永久 rule: testing page 拎 verdict shape 對齊 backend Verdict contract (ok / algorithm / version / symbol / period / klines_count / points / meta / warnings / error)
  //
  //  ⚠️ 永久 rule (大少 2026-08-10 22:28):
  //     - forward_return_history 永遠唔 delete (cache 永久保留)
  //     - 0 validate samples 唔可以 silent fail (要 fire POST_FAILED warning)
  //     - postErrors.length > 0 一定要 inline banner + 有 retry button
  //  ⚠️ Cross-ref: backend/algorithms/back_test/algorithm.py, backend/services/algorithm_runner.py
  //                (Phase 9 backend port done, frontend chain 拎走)
  // ============================================================================
  analyze: async (klines, options = {}) => {
    const symbol = options.symbol || options.code || 'unknown';

    // 0. Normalize klines: backend 用 'time' (ISO string), M9 algorithm 用 'timestamp' (number)
    //    將 'time' 轉做 'timestamp' (ms since epoch)
    const normalizedKlines = klines.map(k => {
      if (k.timestamp !== undefined && typeof k.timestamp === 'number') return k;
      if (k.time !== undefined) {
        return { ...k, timestamp: new Date(k.time).getTime() };
      }
      return k;
    });

    const klineCount = normalizedKlines.length;
    console.log(`[backTestAdapter] start analyze ${symbol}, klines=${klineCount} (Phase 9: fetch backend stub)`);

    // Phase 9 永久 rule: 拎走 frontend chain (import bundle + runWalkForwardCV + decisionFn + 2 個 POST), 換 1 個 fetch backend call
    // Backend M9 algorithm 拎 walk-forward CV + auto POST optimal + forward return records 落 cache (永久 rule)
    // 凡人話: 1 個 fetch call 拎 verdict, backend algorithm 已經做晒所有 chain
    let resp;
    try {
      resp = await fetch(`http://localhost:18792/api/algorithms/run?algo=back_test&symbol=${encodeURIComponent(symbol)}&period=1d&data_window_days=${options.dataWindowDays ?? 1260}`);
    } catch (e) {
      console.error('[backTestAdapter] fetch backend failed:', e);
      // 大少 22:28 永久 rule: 唔 silent fail, fallback 拎 default verdict + fire POST_FAILED warning
      return {
        ok: false,
        symbol,
        algorithm: 'back_test',
        version: '0.6.0',
        period: '1d',
        klines_count: klineCount,
        points: [],
        meta: { error: 'Backend fetch failed: ' + e.message },
        warnings: [
          makeWarning('critical', 'M9', 'POST_FAILED',
            'Fetch backend /api/algorithms/run failed (Phase 9 backend stub)',
            {
              issue: 'Backend fetch exception: ' + e.message,
              impact: 'Verdict 唔可信, 唔好落單',
              fix: 'Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc',
              context: { error: e.message, symbol },
            }
          ),
        ],
        error: e.message,
        timestamp: Date.now(),
      };
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error(`[backTestAdapter] backend resp not ok: ${resp.status} ${errText}`);
      return {
        ok: false,
        symbol,
        algorithm: 'back_test',
        version: '0.6.0',
        period: '1d',
        klines_count: klineCount,
        points: [],
        meta: { error: `Backend HTTP ${resp.status}: ${errText}` },
        warnings: [
          makeWarning('critical', 'M9', 'POST_FAILED',
            `Backend HTTP ${resp.status}`,
            {
              issue: 'Backend response not ok',
              impact: 'Verdict 唔可信, 唔好落單',
              fix: 'Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc',
              context: { http_status: resp.status, symbol },
            }
          ),
        ],
        error: errText,
        timestamp: Date.now(),
      };
    }

    const verdict = await resp.json();
    console.log(`[backTestAdapter] backend verdict: ok=${verdict.ok}, klines_count=${verdict.klines_count}, folds=${verdict.meta?.foldsCount ?? 0}, avgScore=${verdict.meta?.avgValidateScore ?? 0}`);

    // Phase 9 永久 rule: 為咗 renderResult 唔使改 (frontend render 拎 top-level field)
    // Backend verdict 拎 meta.walkForwardResult / meta.optimal / meta.forwardReturnHistory / meta.postErrors
    // 包返 top-level 畀 renderResult 直接拎, 唔使改 render 內部 field path
    // Backend warnings 係 string array, frontend 期望 ModuleWarning object array (_warnings)
    // 用 _parseBackendWarnings helper 將 string "CODE: message" parse 做 ModuleWarning
    const frontendShape = {
      ...verdict,
      symbol,
      walkForwardResult: verdict.meta?.walkForwardResult,
      optimal: verdict.meta?.optimal,
      forwardReturnHistory: verdict.meta?.forwardReturnHistory,
      postErrors: verdict.meta?.postErrors || [],
      _warnings: _parseBackendWarnings(verdict.warnings || []),
    };
    return frontendShape;
  },
  renderResult: (result) => {
    if (!result || !result.walkForwardResult) {
      return '<p>❌ 冇 back test result</p>';
    }
    const { walkForwardResult, optimal, forwardReturnHistory = [], symbol, postErrors = [] } = result;
    const { folds, overall } = walkForwardResult;

    // 9.7.4 6 色標 helper (大少 11:57 永久 rule)
    const colorByScore = (score) => {
      // score 0-100, 越高越好
      if (score >= 70) return '#26BA75';  // 綠
      if (score >= 50) return '#F39C12';  // 黃
      if (score > 0) return '#EE5151';    // 紅
      return '#666';                        // 灰 (0 / null)
    };
    const colorByStability = (stability) => {
      // stability 0-1
      if (stability >= 0.7) return '#26BA75';
      if (stability >= 0.4) return '#F39C12';
      return '#EE5151';
    };
    const colorByKelly = (kelly) => {
      // 越細越穩陣
      if (kelly <= 0.15) return '#1890ff';  // 藍 (細倉, 穩陣)
      if (kelly <= 0.30) return '#26BA75';  // 綠 (中倉)
      if (kelly <= 0.45) return '#F39C12';  // 黃 (大倉)
      return '#EE5151';                       // 紅 (滿倉, 博)
    };
    const hitEmoji = (hit) => hit === true ? '🟢' : hit === false ? '🔴' : '⚫';

    // 大少 2026-08-13 07:25 — M9 verdict 全面化 popup 註解 (跟 M7/M8 同樣 style)
    // 凡人話: M9 8 區 keyword 全部加 hover popup 解釋, 大少唔使睇教學都明白
    // 永久 rule: 全部 algorithm verdict 嘅 keyword 都要有 popup 註解 (M7/M8/M9 一致)
    // Style: 跟 M7/M8 同樣 inline <style> block (position relative + hover::after + 箭嘴 + 即時顯示)
    const M9_TOOLTIPS = {
      // Section 1: 頂部時段表
      m9_title: '回測驗證 (M9 第九模組): 拎呢隻股票過去試卷, 重播演算法嘅判決, 對比真實後續升跌, 畀大少一個「呢個演算法過唔過得自己」嘅證據',
      m9_period: '模擬時段: 過去 5 年 (預設) 或者大少自訂嘅日子範圍, 模擬演算法喺呢段時段嘅表現',
      m9_folds: '滾動交叉驗證段數: 預設 3 段, 每段用前段 tune (校準), 後段 validate (真實驗證), 模擬「邊個設定最work」',
      m9_samples: '真實樣本數: 過去模擬中真實試過幾多個 (>= 30 樣本先可信, < 30 系統會警告)',

      // Section 2: 🎯 最佳參數
      m9_kelly: '凱利倉位比例: 跟平均真實波幅率自動切嘅倉位大小 (半倉 = 低波動 / 四分一倉 = 中波動 / 八分一倉 = 高波動), 自動風控',
      m9_kelly_pct: '凱利倉位百分比: 撳呢個比例落注 (例 12.5% = 八分一倉, 25% = 四分一倉, 50% = 半倉), 越細越穩陣',
      m9_kelly_pie: '凱利倉位餅圖: 跟平均真實波幅率自動切嘅倉位大小, 越細越穩陣 (藍 = 八分一倉, 綠 = 四分一倉, 黃 = 大倉, 紅 = 滿倉博)',
      m9_rsi_weight: '相對強弱指標權重: 相對強弱指標 (RSI) 對綜合判定嘅影響比重 (0-100%), 大少可以調整呢個權重睇下 RSI 影響有幾大',
      m9_ssi_weights: '策略權重分配: 均線 / 高低點 / 趨勢線 3 個模組嘅綜合判定權重 (加埋 = 100%), 過往準 = 高權重',

      // Section 3: 📊 整體表現
      m9_avg_score: '平均驗證分數: 過去幾段真實分嘅平均值 (0-100, 越高越好), >= 70 算穩陣',
      m9_stability: '穩定度: 過去幾段嘅表現穩定程度 (0-100%, 越高越穩定), 越高代表唔係忽高忽低',
      m9_samples_box: '真實樣本數: 過去試過幾多個 (>= 30 樣本先可信, < 30 系統會警告)',
      m9_folds_box: '完成驗證段數: 預設 3 段, 越多越穩但越慢',

      // Section 4: Walk-Forward bar chart
      m9_tune_score: '校準分: 用歷史 tune (校準) 嗰陣拎到嘅分, 越高代表「過去呢段最work嘅設定」',
      m9_validate_score: '真實分: 用未來 validate (真實驗證) 嗰陣拎到嘅分, 越高代表「呢個設定真係work」',
      m9_wf_bar: '每段滾動驗證表現: 藍色 = 校準分 (用歷史 tune), 橙色 = 真實分 (用未來 validate), 兩條柱愈高愈好, 差距大代表 overfit (過擬合)',

      // Section 5: 段細節表
      m9_fold_n: '第 N 段: 滾動交叉驗證嘅第 N 段 (預設 3 段, 每段拎唔同時段嘅最佳設定)',

      // Section 6: Forward return history
      m9_fwd5: '5 日後回報: 模擬建議買入/賣出之後, 真實 5 日後升咗幾多 %, 對齊睇模擬準唔準',
      m9_fwd10: '10 日後回報: 模擬之後 10 日真實升跌, 對齊 5 日後睇趨勢延續性',
      m9_fwd20: '20 日後回報: 模擬之後 20 日真實升跌, 對齊 10 日後睇中期走勢',
      m9_hit: '啱唔啱: 模擬建議嘅動作 (買/賣/等), 同真實 5 日後結果對比, 綠色 = 啱, 紅色 = 錯',
      m9_scatter: '5 日後回報分佈: 綠點 = 模擬後升, 紅點 = 模擬後跌, 散點越集中代表表現越穩定',

      // Section 7: 大少話你知
      m9_advice: '大少話你知: 用規則自動生成嘅凡人話解讀, 將來可以換成大語言模型 (OpenAI / MiniMax / Kimi) 寫詳細解讀',

      // Section 8: Apply to M8
      m9_recalibrate: '重新校準掣: 重新跑 M9 整個流程, 用嚟解決「過咗 30 日」, 系統自動建議重校',
      m9_apply: '立即套用 M8 掣: 將 M9 拎到嘅最佳設定 POST 落 M8 cache, 撳 M8 嗰陣自動用呢個設定',
    };

    // 大少 2026-08-13 07:25 — M9 verdict popup 註解 inline CSS (跟 M7/M8 同樣 style)
    // 凡人話: hover 任何 keyword 0.1 秒即時顯示黑色 popup, 大字 14px, 自動加箭嘴
    // 永久 rule: M7/M8/M9 三個 verdict 嘅 tooltip 全部 inline <style> block, 唔好放 testing-page.css
    const m9TooltipStyle = `<style>
      .m9-verdict-tooltip { position: relative; cursor: help; }
      .m9-verdict-tooltip:hover::after {
        content: attr(data-help);
        position: absolute;
        bottom: calc(100% + 8px);
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.92);
        color: #fff;
        padding: 10px 14px;
        border-radius: 8px;
        font-size: 14px;
        line-height: 1.6;
        white-space: normal;
        width: max-content;
        max-width: 380px;
        z-index: 9999;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        pointer-events: none;
        animation: m9TooltipFadeIn 0.1s ease-in;
      }
      .m9-verdict-tooltip:hover::before {
        content: '';
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 6px solid transparent;
        border-top-color: rgba(0, 0, 0, 0.92);
        z-index: 10000;
        pointer-events: none;
      }
      @keyframes m9TooltipFadeIn { from { opacity: 0; } to { opacity: 1; } }
    </style>`;

    let html = m9TooltipStyle;

    // ===== 大少 2026-08-10 Bug 1 fix A.2 — M9 UI error banner (永遠 full show) =====
    // 之前 silent fail 唔顯示, 用家以為儲咗但其實冇。改用紅色 banner 顯示 POST 失敗數。
    if (postErrors.length > 0) {
      html += `<div style="background: #EE5151; color: white; padding: 12px 16px; border-radius: 8px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">`;
      html += `<span style="font-size: 18px;">❌</span>`;
      html += `<div style="flex: 1;">`;
      html += `<div style="font-weight: bold; font-size: 14px;">儲存失敗: ${postErrors.length} 條 forward return 冇寫入快取</div>`;
      html += `<div style="font-size: 12px; opacity: 0.95; margin-top: 4px;">過往判決記錄可能會少咗。建議撳下面「🔄 重新校準」再跑一次, 或者檢查 backend 係咪正常運作 (port 18792)。</div>`;
      html += `<div style="font-size: 11px; opacity: 0.8; margin-top: 4px; font-family: monospace;">首個錯誤: ${postErrors[0]}</div>`;
      html += `</div></div>`;
    }

    // ===== Section 1: 大標題 + 簡述 (大少 2026-08-13 07:25 — keyword 全部加 m9-verdict-tooltip) =====
    html += `<div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 16px 20px; border-radius: 12px; margin-bottom: 16px;">`;
    html += `<h3 class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_title}" style="margin: 0 0 8px 0; font-size: 18px;">⏰ 回測驗證結果 (第九模組 v0.6.0)</h3>`;
    html += `<p class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_period}" style="margin: 0; opacity: 0.95;">用歷史 K 線重播之前嘅判決, 對比之後 5 / 10 / 20 日真實升咗幾多</p>`;
    html += `<p style="margin: 4px 0 0 0; opacity: 0.85; font-size: 13px;">📊 ${symbol} · <span class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_folds}">${folds.length} 段滾動驗證</span> · <span class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_samples}">${overall.totalValidateSamples} 個真實樣本</span></p>`;
    html += `</div>`;

    // ===== Section 2: 最佳參數 (帶 Kelly pie chart 9.7.2, 大少 2026-08-13 — keyword 全部加 m9-verdict-tooltip) =====
    html += `<h4 style="margin: 16px 0 8px 0; color: #333;">🎯 呢隻股票嘅最佳參數</h4>`;
    const kellyPct = overall.bestParams.kelly * 100;
    const kellyColor = colorByKelly(overall.bestParams.kelly);
    html += `<div style="display: flex; gap: 12px; align-items: center; background: #f0f8ff; padding: 16px; border-radius: 12px; margin-bottom: 12px;">`;

    // Kelly pie chart (SVG, 永遠 full show, 大少 07:25 — 加 m9-verdict-tooltip)
    const kellyAngle = (overall.bestParams.kelly / 0.5) * 360;  // 0.5 = half (100%)
    html += `<svg class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_kelly_pie}" width="100" height="100" viewBox="0 0 100 100" style="flex-shrink: 0;">`;
    html += `<circle cx="50" cy="50" r="40" fill="#e0e0e0" />`;
    html += `<path d="M 50 10 A 40 40 0 ${kellyAngle > 180 ? 1 : 0} 1 ${50 + 40 * Math.sin(kellyAngle * Math.PI / 180)} ${50 - 40 * Math.cos(kellyAngle * Math.PI / 180)} L 50 50 Z" fill="${kellyColor}" />`;
    html += `<circle cx="50" cy="50" r="25" fill="white" />`;
    html += `<text x="50" y="48" text-anchor="middle" font-size="14" font-weight="bold" fill="${kellyColor}">${kellyPct.toFixed(0)}%</text>`;
    html += `<text x="50" y="62" text-anchor="middle" font-size="9" fill="#666">倉位</text>`;
    html += `</svg>`;

    html += `<div style="flex: 1; line-height: 1.6;">`;
    html += `<p style="margin: 4px 0;"><b class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_kelly}">建議倉位 (Kelly):</b> <span class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_kelly_pct}" style="color: ${kellyColor}; font-weight: bold; font-size: 16px;">${kellyPct.toFixed(1)}%</span> ${kellyPct <= 15 ? '🛡️ 細倉穩陣' : kellyPct <= 30 ? '⚖️ 中倉平衡' : kellyPct <= 45 ? '⚡ 進取' : '🎲 大倉博一博'}</p>`;
    html += `<p class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_rsi_weight}" style="margin: 4px 0;"><b>RSI 情緒權重:</b> ${(overall.bestParams.rsiWeight * 100).toFixed(0)}%</p>`;
    html += `<p class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_ssi_weights}" style="margin: 4px 0;"><b>策略權重分配:</b> 均線 ${(overall.bestParams.ssiWeights.ma * 100).toFixed(0)}% · 高低點 ${(overall.bestParams.ssiWeights.hl * 100).toFixed(0)}% · 趨勢線 ${(overall.bestParams.ssiWeights.tl * 100).toFixed(0)}%</p>`;
    html += `</div></div>`;

    // ===== Section 3: 整體表現 (帶 Walk-Forward bar chart 9.7.2, 大少 2026-08-13 — keyword 全部加 m9-verdict-tooltip) =====
    // 大少 2026-08-10 08:45 fix: 動態化 folds.length (之前 hard-coded "3 段滾動交叉驗證" 但 numFolds 已改 1)
    html += `<h4 style="margin: 16px 0 8px 0; color: #333;">📊 整體表現 (${folds.length} 段滾動交叉驗證)</h4>`;
    const scoreColor = colorByScore(overall.avgValidateScore);
    const stabColor = colorByStability(overall.stabilityScore);
    html += `<div style="background: #f9f9f9; padding: 16px; border-radius: 12px; margin-bottom: 12px;">`;

    // 4 個關鍵指標 (永遠 full show, 大少 11:57 永久 rule, 2026-08-13 07:25 全部加 m9-verdict-tooltip)
    html += `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">`;
    html += `<div class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_avg_score}" style="text-align: center; padding: 12px; background: white; border-radius: 8px;"><div style="font-size: 24px; font-weight: bold; color: ${scoreColor};">${overall.avgValidateScore.toFixed(1)}</div><div style="font-size: 12px; color: #666;">平均驗證分數</div></div>`;
    html += `<div class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_stability}" style="text-align: center; padding: 12px; background: white; border-radius: 8px;"><div style="font-size: 24px; font-weight: bold; color: ${stabColor};">${(overall.stabilityScore * 100).toFixed(0)}%</div><div style="font-size: 12px; color: #666;">穩定度 (越接近 100% 越穩)</div></div>`;
    html += `<div class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_samples_box}" style="text-align: center; padding: 12px; background: white; border-radius: 8px;"><div style="font-size: 24px; font-weight: bold; color: #333;">${overall.totalValidateSamples}</div><div style="font-size: 12px; color: #666;">真實樣本數</div></div>`;
    html += `<div class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_folds_box}" style="text-align: center; padding: 12px; background: white; border-radius: 8px;"><div style="font-size: 24px; font-weight: bold; color: #333;">${folds.length}</div><div style="font-size: 12px; color: #666;">完成驗證段數</div></div>`;
    html += `</div>`;

    // ===== Section 4: Walk-Forward bar chart (SVG 9.7.2, 動態段數, 大少 2026-08-13 07:25 — 加 m9-verdict-tooltip) =====
    if (folds.length > 0) {
      html += `<h5 class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_wf_bar}" style="margin: 16px 0 8px 0; color: #555;">🔀 每段驗證嘅表現 (藍 = 校準, 橙 = 真實)</h5>`;
      const maxScore = Math.max(...folds.flatMap(f => [f.tuneScore, f.validateScore]), 100);
      const barW = 280 / folds.length - 8;
      const chartH = 120;
      html += `<svg class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_wf_bar}" width="100%" height="${chartH + 30}" viewBox="0 0 300 ${chartH + 30}" style="background: white; border-radius: 8px; padding: 8px;">`;
      // 標題
      folds.forEach((fold, i) => {
        const x = 10 + i * (barW + 8);
        // 校準分 (藍)
        const tuneH = (fold.tuneScore / maxScore) * chartH;
        html += `<rect x="${x}" y="${chartH - tuneH + 5}" width="${barW * 0.45}" height="${tuneH}" fill="#1890ff" rx="2" />`;
        html += `<text x="${x + barW * 0.225}" y="${chartH - tuneH - 1}" text-anchor="middle" font-size="9" fill="#1890ff">${fold.tuneScore.toFixed(0)}</text>`;
        // 真實分 (橙)
        const valH = (fold.validateScore / maxScore) * chartH;
        html += `<rect x="${x + barW * 0.5}" y="${chartH - valH + 5}" width="${barW * 0.45}" height="${valH}" fill="#F39C12" rx="2" />`;
        html += `<text x="${x + barW * 0.725}" y="${chartH - valH - 1}" text-anchor="middle" font-size="9" fill="#F39C12">${fold.validateScore.toFixed(0)}</text>`;
        // 段號
        html += `<text x="${x + barW / 2}" y="${chartH + 22}" text-anchor="middle" font-size="11" fill="#333">段 ${i + 1}</text>`;
      });
      // Y 軸標
      html += `<line x1="0" y1="${chartH + 5}" x2="300" y2="${chartH + 5}" stroke="#ddd" />`;
      html += `</svg>`;
      html += `<div style="display: flex; gap: 12px; margin-top: 8px; font-size: 12px; color: #666;">`;
      html += `<span class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_tune_score}">🟦 校準分 (用歷史 tune 出嘅分)</span><span class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_validate_score}">🟧 真實分 (用未來 validate 嘅分)</span>`;
      html += `</div>`;
    }
    html += `</div>`;

    // ===== Section 5: Walk-Forward 段細節表 (永遠 full show 9.7.3, 大少 2026-08-13 07:25 — keyword 加 m9-verdict-tooltip) =====
    if (folds.length > 0) {
      html += `<h4 style="margin: 16px 0 8px 0; color: #333;">📋 每段嘅最佳設定細節 (永遠 full show)</h4>`;
      html += `<table style="width:100%; border-collapse: collapse; margin-bottom: 12px; background: white; border-radius: 8px; overflow: hidden;">`;
      html += `<tr style="background: #f5f5f5;"><th class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_fold_n}" style="padding: 10px; text-align: left;">段</th><th style="padding: 10px; text-align: right;">建議倉位</th><th style="padding: 10px; text-align: right;">情緒權重</th><th class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_tune_score}" style="padding: 10px; text-align: right;">校準分</th><th class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_validate_score}" style="padding: 10px; text-align: right;">真實分</th><th style="padding: 10px; text-align: right;">樣本數</th></tr>`;
      for (const fold of folds) {
        const fColor = colorByScore(fold.validateScore);
        html += `<tr style="border-bottom: 1px solid #eee;">`;
        html += `<td class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_fold_n}" style="padding: 10px;">第 ${fold.foldIndex + 1} 段</td>`;
        html += `<td style="padding: 10px; text-align: right; color: ${colorByKelly(fold.bestParams.kelly)}; font-weight: bold;">${(fold.bestParams.kelly * 100).toFixed(1)}%</td>`;
        html += `<td style="padding: 10px; text-align: right;">${(fold.bestParams.rsiWeight * 100).toFixed(0)}%</td>`;
        html += `<td style="padding: 10px; text-align: right; color: #1890ff;">${fold.tuneScore.toFixed(1)}</td>`;
        html += `<td style="padding: 10px; text-align: right; color: ${fColor}; font-weight: bold;">${fold.validateScore.toFixed(1)}</td>`;
        html += `<td style="padding: 10px; text-align: right;">${fold.validateSamples}</td>`;
        html += `</tr>`;
      }
      html += `</table>`;
    }

    // ===== Section 6: Forward return history (永遠 full show 9.7.3, 大少 2026-08-13 07:25 — keyword 加 m9-verdict-tooltip) =====
    if (forwardReturnHistory.length > 0) {
      html += `<h4 style="margin: 16px 0 8px 0; color: #333;">📜 過往判決記錄 (永久累積, 永遠 full show)</h4>`;
      html += `<p style="font-size: 12px; color: #888; margin-bottom: 8px;">顯示最近 ${forwardReturnHistory.length} 條 (總共可能仲多, 全部永久保留)</p>`;

      // 9.7.2 散點圖 SVG (大少 07:25 — 加 m9-verdict-tooltip)
      const recent20 = forwardReturnHistory.slice(0, 20);
      const scatterW = 600;
      const scatterH = 140;
      html += `<svg class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_scatter}" width="100%" height="${scatterH}" viewBox="0 0 ${scatterW} ${scatterH}" style="background: white; border-radius: 8px; padding: 8px;">`;
      // Y 軸 (0 中心線, ±10%)
      html += `<line x1="30" y1="${scatterH / 2}" x2="${scatterW - 10}" y2="${scatterH / 2}" stroke="#ddd" stroke-dasharray="3,3" />`;
      // 數據點
      recent20.forEach((r, i) => {
        if (r.fwd5 === null || r.fwd5 === undefined) return;
        const x = 30 + (i / Math.max(1, recent20.length - 1)) * (scatterW - 40);
        const y = scatterH / 2 - (r.fwd5 / 10) * (scatterH / 2 - 15);
        const color = r.fwd5 > 0 ? '#26BA75' : '#EE5151';
        html += `<circle cx="${x}" cy="${y}" r="4" fill="${color}" opacity="0.7" />`;
        html += `<text x="${x}" y="${y - 7}" text-anchor="middle" font-size="8" fill="${color}">${r.fwd5 > 0 ? '+' : ''}${r.fwd5.toFixed(1)}%</text>`;
      });
      // Y 軸標
      html += `<text x="5" y="15" font-size="9" fill="#999">+10%</text>`;
      html += `<text x="5" y="${scatterH / 2 + 3}" font-size="9" fill="#999">0%</text>`;
      html += `<text x="5" y="${scatterH - 3}" font-size="9" fill="#999">-10%</text>`;
      // 標題
      html += `<text x="${scatterW / 2}" y="14" text-anchor="middle" font-size="11" fill="#333">5 日後回報分佈 (綠 = 升, 紅 = 跌)</text>`;
      html += `</svg>`;

      // 詳細表 (大少 07:25 — fwd5/fwd10/fwd20/hit 全部加 m9-verdict-tooltip)
      html += `<table style="width:100%; border-collapse: collapse; margin-top: 12px; background: white; border-radius: 8px; overflow: hidden; font-size: 13px;">`;
      html += `<tr style="background: #f5f5f5;"><th style="padding: 8px; text-align: left;">日期</th><th style="padding: 8px; text-align: left;">行動</th><th class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_fwd5}" style="padding: 8px; text-align: right;">5 日後</th><th class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_fwd10}" style="padding: 8px; text-align: right;">10 日後</th><th class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_fwd20}" style="padding: 8px; text-align: right;">20 日後</th></tr>`;
      for (const r of forwardReturnHistory) {
        html += `<tr style="border-bottom: 1px solid #f0f0f0;">`;
        html += `<td style="padding: 8px;">${r.date}</td>`;
        html += `<td style="padding: 8px;">${r.action}</td>`;
        html += `<td class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_hit}" style="padding: 8px; text-align: right;">${r.fwd5 === null ? '—' : `${hitEmoji(r.hit)} ${r.fwd5 > 0 ? '+' : ''}${r.fwd5.toFixed(2)}%`}</td>`;
        html += `<td style="padding: 8px; text-align: right;">${r.fwd10 === null ? '—' : `${r.fwd10 > 0 ? '+' : ''}${r.fwd10.toFixed(2)}%`}</td>`;
        html += `<td style="padding: 8px; text-align: right;">${r.fwd20 === null ? '—' : `${r.fwd20 > 0 ? '+' : ''}${r.fwd20.toFixed(2)}%`}</td>`;
        html += `</tr>`;
      }
      html += `</table>`;
    }

    // ===== Section 7: 大少話你知 box (9.7.5 LLM hook placeholder, 大少 2026-08-13 07:25 — 加 m9-verdict-tooltip) =====
    html += `<div style="background: linear-gradient(135deg, #f6d365 0%, #fda085 100%); color: #333; padding: 16px 20px; border-radius: 12px; margin: 16px 0;">`;
    html += `<h4 class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_advice}" style="margin: 0 0 8px 0; font-size: 16px;">📖 大少話你知</h4>`;
    // 9.7.5 用 stable 程度 + score 簡單人話解讀
    let advice = '';
    if (overall.avgValidateScore >= 70 && overall.stabilityScore >= 0.7) {
      advice = `呢隻股票嘅回測結果 <b>好穩定</b>, 過去 3 段都拎到高過 70 分, 而且設定幾乎一樣。建議用呢個 bestParams 落第八模組。`;
    } else if (overall.avgValidateScore >= 50 && overall.stabilityScore >= 0.5) {
      advice = `回測結果 <b>中等穩定</b>, 過去 3 段嘅分數有啲上落, 但大方向 OK。可以試用呢個設定, 但要 monitor 真實表現。`;
    } else if (overall.totalValidateSamples < 30) {
      advice = `樣本唔夠 (${overall.totalValidateSamples} 個), 結果 <b>唔可靠</b>。建議用返默認設定, 等多啲數據先再 tune。`;
    } else {
      advice = `回測結果 <b>唔太穩定</b>, 過去 3 段嘅最佳設定差異大, 唔建議用呢個 bestParams。`;
    }
    html += `<p style="margin: 4px 0; line-height: 1.6;">${advice}</p>`;
    html += `<p style="margin: 8px 0 0 0; font-size: 12px; opacity: 0.7;">🪝 將來可換成大語言模型 (OpenAI / MiniMax / Kimi), 而家用 rule 寫嘅簡單解讀</p>`;
    html += `</div>`;

    // ===== Section 8: Apply to M8 button (9.7.6 真實可 click, 大少 2026-08-13 07:25 — 掣加 m9-verdict-tooltip) =====
    html += `<h4 style="margin: 16px 0 8px 0; color: #333;">🔄 套用呢個設定落第八模組</h4>`;
    html += `<div style="background: #e8f5e9; padding: 16px; border-radius: 12px;">`;
    html += `<p style="margin: 4px 0;">✅ 最佳設定已經自動儲存落 per-symbol 快取 (30 日內有效)。</p>`;
    html += `<p style="margin: 4px 0; font-size: 13px; color: #555;">下次跑 <code>08 — AS-03-DEC</code> 嗰陣, 第八模組會自動用呢個設定 (取代默認)。</p>`;
    html += `<div style="display: flex; gap: 8px; margin-top: 12px;">`;
    html += `<button id="m9-recalibrate-btn" class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_recalibrate}" onclick="window.__recalibrateM9Optimal && window.__recalibrateM9Optimal()" style="background: #4CAF50; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: bold;">🔄 重新校準</button>`;
    html += `<button id="m9-apply-btn" class="m9-verdict-tooltip" data-help="${M9_TOOLTIPS.m9_apply}" onclick="window.__applyM9OptimalToM8 && window.__applyM9OptimalToM8()" style="background: #2196F3; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: bold;">📌 立即套用 (8) M8</button>`;
    html += `</div>`;
    html += `<p id="m9-action-status" style="margin: 8px 0 0 0; font-size: 12px; color: #666;"></p>`;
    html += `</div>`;

    return html;
  },
};

// ---------- backtestTimelineAdapter export (M11 v0.1.0 — Stage 2 第三次 focus 2026-08-10 00:13) ----------
//   大少 2026-08-10 00:04 — 4 個 design decision confirm 全 A
//   整合 M9 forward return (永久 cache) + M10 Trade Journal (永久 cache) 嘅 timeline 視覺化
//   4 個永遠 full show sections: ⏰ header / 📊 Stats / 📓 Journal overlay / ⭐ Golden entries
//   6 色標 (大少 11:57 永久 rule) + LLM hook (大少 13:30 永久 rule)
export const backtestTimelineAdapter = {
  id: 'AS-03-BTL',
  name: '時光機時序圖 (第十一模組)',
  version: '0.1.0',
  description: '將過去嘅判決 (M9 forward return) 同一齊對齊 Trade Journal 嘅啱錯記錄, 變成一張時間線, 等你一眼睇到邊一日係最佳時機',
  inputs: [
    { key: 'code', label: '股票代碼', type: 'autocomplete', required: true, endpoint: '/api/stocks/search', queryParam: 'q', placeholder: '輸入代碼或名稱', limit: 10, marketFn: 'auto' },
    { key: 'dateRange', label: '睇幾多日 (時間範圍)', type: 'chip', default: 90, options: [30, 90, 180, 365] },
  ],
  analyze: async (klines, options = {}) => {
    const symbol = options.symbol || options.code || 'unknown';
    const dateRange = options.dateRange || 90;

    // 1. Import backtest-timeline bundle (browser-compatible ESM)
    const bt = await import('./build/backtest-timeline.bundle.js');
    const { analyzeBacktestTimeline, fetchForwardReturnHistory, fetchTradeJournal } = bt;

    // 2. Fetch forward return history + trade journal (永久 cache)
    const [forwardReturnHistory, tradeJournalEntries] = await Promise.all([
      fetchForwardReturnHistory(symbol, 200),
      fetchTradeJournal(symbol, 200),
    ]);

    // 3. Run pure algorithm
    const result = analyzeBacktestTimeline({
      symbol,
      dateRange,
      forwardReturnHistory,
      tradeJournalEntries,
    });

    return {
      symbol,
      dateRange,
      result,                  // 包含 dataPoints + stats + meta
      timestamp: Date.now(),
    };
  },
  renderResult: (result) => {
    if (!result || !result.result) {
      return '<p>❌ 冇 M11 timeline result</p>';
    }
    const { result: r, symbol, dateRange = 90 } = result;
    const { dataPoints = [], stats, meta = {} } = r;

    // 6 色標 helper (大少 11:57 永久 rule, 跟 M9 colorByScore 等 pattern)
    const hitEmoji = (hit) => hit === true ? '🟢' : hit === false ? '🔴' : '⚫';
    const markEmoji = (mark) => mark === null || mark === undefined ? '⚪' : mark >= 4 ? '🟢' : mark >= 2 ? '🟡' : '🔴';

    let html = '';

    // ===== Section 1: 大標題 + 簡述 =====
    html += `<div style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); color: white; padding: 16px 20px; border-radius: 12px; margin-bottom: 16px;">`;
    html += `<h3 style="margin: 0 0 8px 0; font-size: 18px;">⏰ 時光機時序圖 (第十一模組 v0.1.0)</h3>`;
    html += `<p style="margin: 0; opacity: 0.95;">將過去嘅判決同一齊對齊 Trade Journal 啱錯記錄, 一眼睇到邊一日係最佳時機</p>`;
    html += `<p style="margin: 4px 0 0 0; opacity: 0.85; font-size: 13px;">📊 ${symbol} · 過去 ${dateRange} 日 · ${dataPoints.length} 個 verdict · ${stats?.totalJournalEntries || 0} 個 trade 記錄</p>`;
    html += `</div>`;

    // ===== Section 2: Date range filter chip (D4 揀 B) =====
    html += `<div style="display: flex; gap: 8px; margin-bottom: 16px; align-items: center;">`;
    html += `<span style="font-size: 13px; color: #666; margin-right: 4px;">📅 時間範圍:</span>`;
    [30, 90, 180, 365].forEach(days => {
      const isActive = days === dateRange;
      html += `<button onclick="window.__setTimelineDateRange && window.__setTimelineDateRange(${days})" style="background: ${isActive ? '#4facfe' : '#f0f0f0'}; color: ${isActive ? 'white' : '#333'}; border: none; padding: 6px 14px; border-radius: 16px; cursor: pointer; font-size: 13px; font-weight: ${isActive ? 'bold' : 'normal'};">${days} 日${isActive ? ' ✓' : ''}</button>`;
    });
    html += `</div>`;

    // ===== Section 3: Stats panel (永遠 full show, 大少 11:57 永久 rule) =====
    if (stats) {
      html += `<h4 style="margin: 16px 0 8px 0; color: #333;">📊 整體表現 (永遠 full show)</h4>`;
      const hitRateColor = stats.hitRate5d === null ? '#999' : stats.hitRate5d >= 0.6 ? '#26BA75' : stats.hitRate5d >= 0.4 ? '#F39C12' : '#EE5151';
      const hitRatePct = stats.hitRate5d === null ? 'N/A' : (stats.hitRate5d * 100).toFixed(0) + '%';
      html += `<div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 16px;">`;
      html += `<div style="text-align: center; padding: 12px; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);"><div style="font-size: 24px; font-weight: bold; color: ${hitRateColor};">${hitRatePct}</div><div style="font-size: 12px; color: #666;">5 日命中率</div></div>`;
      html += `<div style="text-align: center; padding: 12px; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);"><div style="font-size: 24px; font-weight: bold; color: #1890ff;">${stats.avgFwd5 === null ? 'N/A' : (stats.avgFwd5 > 0 ? '+' : '') + stats.avgFwd5.toFixed(2) + '%'}</div><div style="font-size: 12px; color: #666;">5 日平均回報</div></div>`;
      html += `<div style="text-align: center; padding: 12px; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);"><div style="font-size: 24px; font-weight: bold; color: #f39c12;">${stats.goldenEntries}</div><div style="font-size: 12px; color: #666;">黃金買點</div></div>`;
      html += `</div>`;

      // 4 個關鍵指標第 2 行
      html += `<div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px; margin-bottom: 16px; font-size: 12px;">`;
      html += `<div style="text-align: center; padding: 8px; background: #f9f9f9; border-radius: 6px;"><b>${stats.totalVerdicts}</b><br><span style="color: #666;">總 verdict</span></div>`;
      html += `<div style="text-align: center; padding: 8px; background: #f9f9f9; border-radius: 6px;"><b>${stats.totalJournalEntries}</b><br><span style="color: #666;">Trade Journal 記錄</span></div>`;
      const matchCount = (stats.matchBreakdown?.MATCH || 0);
      const matchRate = stats.totalJournalEntries > 0 ? (matchCount / stats.totalJournalEntries * 100).toFixed(0) : 0;
      html += `<div style="text-align: center; padding: 8px; background: #f9f9f9; border-radius: 6px;"><b>${matchRate}%</b><br><span style="color: #666;">Match Rate</span></div>`;
      html += `<div style="text-align: center; padding: 8px; background: #f9f9f9; border-radius: 6px;"><b>${(stats.avgFwd10 === null ? 'N/A' : (stats.avgFwd10 > 0 ? '+' : '') + stats.avgFwd10.toFixed(2) + '%')}</b><br><span style="color: #666;">10 日平均</span></div>`;
      html += `</div>`;

      // Action breakdown (8 個 finalAction)
      if (stats.actionBreakdown && Object.keys(stats.actionBreakdown).length > 0) {
        html += `<details style="margin-bottom: 12px;"><summary style="cursor: pointer; color: #666; font-size: 13px;">📋 點開睇 8 個 finalAction 分佈</summary>`;
        html += `<div style="background: #f9f9f9; padding: 12px; border-radius: 8px; margin-top: 8px; font-size: 12px;">`;
        for (const [action, count] of Object.entries(stats.actionBreakdown).sort((a, b) => b[1] - a[1])) {
          const pct = stats.totalVerdicts > 0 ? (count / stats.totalVerdicts * 100).toFixed(0) : 0;
          html += `<div style="display: flex; justify-content: space-between; padding: 2px 0;"><span>${action}</span><span><b>${count}</b> (${pct}%)</span></div>`;
        }
        html += `</div></details>`;
      }
    }

    // ===== Section 4: Timeline chart (SVG 永遠 full show) =====
    if (dataPoints.length > 0) {
      html += `<h4 style="margin: 16px 0 8px 0; color: #333;">📈 過去 ${dateRange} 日嘅時序圖</h4>`;
      const chartW = 600;
      const chartH = 160;
      html += `<svg width="100%" height="${chartH}" viewBox="0 0 ${chartW} ${chartH}" style="background: white; border-radius: 8px; padding: 8px; border: 1px solid #eee;">`;
      // X 軸 baseline
      html += `<line x1="0" y1="${chartH / 2}" x2="${chartW}" y2="${chartH / 2}" stroke="#ddd" stroke-dasharray="3,3" />`;
      // 每個 data point 一個方塊
      const pointW = Math.max(2, Math.min(20, (chartW - 20) / dataPoints.length));
      dataPoints.forEach((dp, i) => {
        const x = 10 + i * pointW;
        // 高度 = fwd5 絕對值 (cap 5%)
        const fwd5 = dp.fwd5 ?? 0;
        const h = Math.min(60, Math.abs(fwd5) * 12);
        const y = fwd5 >= 0 ? (chartH / 2) - h : (chartH / 2);
        html += `<rect x="${x}" y="${y}" width="${pointW - 1}" height="${h}" fill="${dp.color}" rx="2" opacity="0.85" />`;
        // Golden entry 加星號
        if (dp.isGoldenEntry) {
          html += `<text x="${x + pointW / 2}" y="12" text-anchor="middle" font-size="10" fill="#FFD700">★</text>`;
        }
      });
      // Y 軸標
      html += `<text x="5" y="14" font-size="9" fill="#999">+5%</text>`;
      html += `<text x="5" y="${chartH / 2 + 3}" font-size="9" fill="#999">0%</text>`;
      html += `<text x="5" y="${chartH - 3}" font-size="9" fill="#999">-5%</text>`;
      // 圖例 (6 色標)
      html += `<text x="${chartW - 100}" y="14" font-size="9" fill="#666">6 色: 🟢🟡🟠🔴⚪</text>`;
      html += `</svg>`;

      // 詳細表 (always show 詳細)
      html += `<details open style="margin-top: 12px;"><summary style="cursor: pointer; color: #333; font-weight: bold;">📋 詳細表 (${dataPoints.length} 條, 點開收起)</summary>`;
      html += `<div style="max-height: 300px; overflow-y: auto; margin-top: 8px;">`;
      html += `<table style="width:100%; border-collapse: collapse; background: white; border-radius: 8px; font-size: 12px;">`;
      html += `<tr style="background: #f5f5f5;"><th style="padding: 6px; text-align: left;">日期</th><th style="padding: 6px; text-align: left;">行動</th><th style="padding: 6px; text-align: right;">5 日</th><th style="padding: 6px; text-align: center;">算法</th><th style="padding: 6px; text-align: center;">大少</th><th style="padding: 6px; text-align: center;">Match</th></tr>`;
      for (const dp of dataPoints) {
        const fwd5Str = dp.fwd5 === null ? '—' : `${hitEmoji(dp.hit)} ${dp.fwd5 > 0 ? '+' : ''}${dp.fwd5.toFixed(2)}%`;
        const algMark = hitEmoji(dp.hit);
        const userMark = markEmoji(dp.markCorrect !== null ? dp.markCorrect : dp.markWrong);
        const matchColor = dp.predictionVsActual === 'MATCH' ? '#26BA75' : dp.predictionVsActual === 'MISS' ? '#EE5151' : '#999';
        const matchText = dp.predictionVsActual === 'NO_JOURNAL' ? '—' : dp.predictionVsActual;
        html += `<tr style="border-bottom: 1px solid #f0f0f0;">`;
        html += `<td style="padding: 6px;">${dp.date}${dp.isGoldenEntry ? ' ⭐' : ''}</td>`;
        html += `<td style="padding: 6px;"><span style="display: inline-block; width: 8px; height: 8px; background: ${dp.color}; border-radius: 2px; margin-right: 4px;"></span>${dp.action}</td>`;
        html += `<td style="padding: 6px; text-align: right; font-family: monospace;">${fwd5Str}</td>`;
        html += `<td style="padding: 6px; text-align: center;">${algMark}</td>`;
        html += `<td style="padding: 6px; text-align: center;">${userMark}</td>`;
        html += `<td style="padding: 6px; text-align: center; color: ${matchColor}; font-weight: bold;">${matchText}</td>`;
        html += `</tr>`;
      }
      html += `</table></div></details>`;
    } else {
      // 大少 2026-08-10 00:42 — Empty state 加 M9 引導 (button 唔用, 純 instruction 因為 testing page dropdown UX bug + M9 寫入 vs M11 讀取 separation)
      html += `<div style="background: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%); padding: 20px 24px; border-radius: 12px; margin: 16px 0; border-left: 4px solid #ff9800;">`;
      html += `<h4 style="margin: 0 0 8px 0; color: #e65100;">📭 暫時冇 ${symbol} 嘅 forward return 數據</h4>`;
      html += `<p style="margin: 4px 0; color: #666; line-height: 1.6;">M11 嘅 timeline 視乎 <b>M9 back test</b> 累積嘅 forward return 數據。你呢隻股票 <code style="background: #fff; padding: 2px 6px; border-radius: 4px;">${symbol}</code> 未跑過 M9, 所以呢度空白。</p>`;
      html += `<p style="margin: 12px 0 4px 0; color: #333; font-weight: bold;">👉 點樣累積 forward return 數據:</p>`;
      html += `<ol style="margin: 4px 0 0 24px; color: #555; line-height: 1.8; font-size: 14px;">`;
      html += `<li>去 testing page 上面 dropdown 揀 <code style="background: #fff; padding: 2px 6px; border-radius: 4px;">09 — AS-03-BT</code> (M9 回測驗證)</li>`;
      html += `<li>喺「股票代碼」input 填返 <code style="background: #fff; padding: 2px 6px; border-radius: 4px;">${symbol}</code></li>`;
      html += `<li>撳「跑算法」, 等 M9 跑完 (幾秒到 1 分鐘, 視乎數據量)</li>`;
      html += `<li>返嚟呢度 reload, 撳「跑算法」就會見到 timeline + 黃金買點</li>`;
      html += `</ol>`;
      html += `</div>`;
    }

    // ===== Section 5: Golden entries (永遠 full show) =====
    const goldenEntries = dataPoints.filter(dp => dp.isGoldenEntry);
    if (goldenEntries.length > 0) {
      html += `<h4 style="margin: 16px 0 8px 0; color: #333;">⭐ 黃金買點 (${goldenEntries.length} 個, 永遠 full show)</h4>`;
      html += `<p style="font-size: 12px; color: #888; margin-bottom: 8px;">定義: 算法 verdict + 5 日後升 ≥ 3% + 大少 mark 4-5 分</p>`;
      html += `<div style="background: linear-gradient(135deg, #fff8e1 0%, #fff 100%); border: 2px solid #FFD700; padding: 12px; border-radius: 12px;">`;
      for (const ge of goldenEntries.slice(0, 10)) {  // 最多顯示 10 個
        html += `<div style="padding: 8px 0; border-bottom: 1px dashed #FFD700;">`;
        html += `<b>📅 ${ge.date}</b> — <span style="color: ${ge.color}; font-weight: bold;">${ge.action}</span> → 5 日後升 <b style="color: #26BA75;">+${ge.fwd5?.toFixed(2)}%</b>`;
        if (ge.markCorrect) html += ` · 大少 mark <b>${ge.markCorrect}/5</b>`;
        if (ge.journalEntry?.notes) html += `<br><span style="font-size: 11px; color: #666;">📝 ${ge.journalEntry.notes}</span>`;
        html += `</div>`;
      }
      html += `</div>`;
    } else if (stats && stats.totalJournalEntries > 0) {
      html += `<h4 style="margin: 16px 0 8px 0; color: #333;">⭐ 黃金買點</h4>`;
      html += `<div style="background: #f9f9f9; padding: 12px; border-radius: 8px; color: #666; font-size: 13px;">暫時未搵到黃金買點 (要 fwd5 ≥ 3% + mark 4-5 同時成立)。可以喺 Trade Journal 多 mark 幾條試吓。</div>`;
    }

    return html;
  },
};

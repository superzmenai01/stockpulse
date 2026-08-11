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
    label: '取數據日數',
    type: 'number',
    default: 100,
    min: 90,
    max: 500,
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

// ===== runMAAlignment — extract MA alignment logic (大少 #10846 refactor) =====
//
// 原本 analyze() 嘅 MA alignment 部分抽成獨立 helper。
// 保留所有 ma-alignment.ts v0.3.0 嘅 logic，唔改任何 rule。

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
        impact: '10 條 rule (A-J) 全部無法 compute, MA alignment verdict 唔可信',
        fix: '增加 dataWindowDays 設定 (e.g. count=200) 或 fallback 至 v0.3.0 zmen 均算法',
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
        impact: 'State 推導會 fallback SIDEWAYS, 信心 = 0',
        fix: '檢查 klines 數據 (可能有負數 OHLC, missing data), 試 count 設定大啲',
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
        impact: 'MA alignment verdict 默認 SIDEWAYS, 信心 = 0, 對 M7 综合判定有偏差',
        fix: '屬於橫行市況正常, 可以忽略; 如果市況明顯趨勢但 verdict 顯示 SIDEWAYS, 檢查 klines 數據',
        context: { matched_rules: 0, period: cfg.period, kline_count: recent.length },
      }
    ));
  }
  // Config defaults check
  if (cfg.dataWindowDays === 100) {
    m1Warnings.push(makeWarning('info', 'M1', 'CONFIG_DEFAULTS',
      '用咗 dataWindowDays default 100',
      {
        issue: 'dataWindowDays = 100 (default), 唔係用戶自訂',
        impact: '如果股票歷史少過 100 日, verdict 會 INSUFFICIENT_DATA',
        fix: '可調大到 200/500/1260 (M9 back test 用)',
        context: { data_window_days: 100 },
      }
    ));
  }

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
      matchedRules: matchedRules.map((r) => r.id),
      ruleLabels: matchedRules.map((r) => r.label),
      latestMA5: round(ma5History[ma5History.length - 1], 4),
      latestMA10: round(ma10History[ma10History.length - 1], 4),
      latestMA60: round(ma60History[ma60History.length - 1], 4),
      dataDays: recent.length,
      configUsed: cfg,
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
  const synthSummaryPanel = `
    <div class="interpretation-panel synthesized-summary">
      <strong>🎯 綜合判定：${stateLabel}（${verdict.state}）</strong>
      <p style="margin: 6px 0;">${getSynthesizedStateInterpretation(verdict.state)}</p>
      <div class="module-summary-list">
        ${moduleVerdicts.map((mv) => {
          const modName = mv.moduleId === 'ma-alignment' ? 'MA Alignment'
            : mv.moduleId === 'volume' ? '量价分析 (VolumePrice)'
            : mv.moduleId === 'multi-tf' ? '多時間框架 (M5)'
            : mv.moduleId === 'slope-momentum' ? '斜率動能 (M8)'
            // 大少 2026-08-07 23:15 — SlopeMomentum name 暫時隱藏
            : mv.moduleId;
          const modState = stateLabels[mv.state] || mv.state;
          const modConf = (mv.confidence * 100).toFixed(1);
          const modDetail = mv.moduleId === 'volume'
            ? `信號: ${mv.meta?.signal || 'N/A'}`
            : mv.moduleId === 'multi-tf'
            ? `consensus: ${mv.consensus?.direction || 'N/A'} (${mv.state})`
            : mv.moduleId === 'slope-momentum'
            ? `rules: ${mv.meta?.matchedRules?.join(', ') || 'N/A'}`
            : `state: ${mv.state}`;
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

  // 📌 解讀 box 詳細解說 (plain language)
  const interpretationDetail = verdict.state === 'UP' ? `
    <p>📌 <strong>簡單講</strong>: 10 條 rule 中觸發咗 ${matchedRules.length} 條上升相關 rule (e.g. 連續 5 日 MA5 > MA60), 典型上升趨勢訊號。</p>
    <p>📊 <strong>咩意思</strong>: MA5 喺 ${verdict.meta.latestMA5}, MA10 喺 ${verdict.meta.latestMA10}, MA60 喺 ${verdict.meta.latestMA60}, 短期均線喺長期均線上面, 上升趨勢確認。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 上升趨勢確認, 可考慮持有 / 逢回調加倉。留意 H rule (7 日反轉) 同 F rule (升勢調整) 嘅見頂警號。</p>
  ` : verdict.state === 'DOWN' ? `
    <p>📌 <strong>簡單講</strong>: 10 條 rule 中觸發咗 ${matchedRules.length} 條下跌相關 rule, 典型下跌趨勢訊號。</p>
    <p>📊 <strong>咩意思</strong>: MA5 喺 ${verdict.meta.latestMA5}, MA10 喺 ${verdict.meta.latestMA10}, MA60 喺 ${verdict.meta.latestMA60}, 短期均線喺長期均線下面, 下跌趨勢確認。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 下跌趨勢確認, 觀望 / 減倉。留意 H rule (7 日反轉) 同 G rule (跌勢調整) 嘅見底警號。</p>
  ` : verdict.state === 'TRANSITION' ? `
    <p>📌 <strong>簡單講</strong>: 觸發 H rule (7 日反轉), 短期均線同長期均線嘅位置出現反轉, 趨勢可能即將改變方向。</p>
    <p>📊 <strong>咩意思</strong>: 短期內由上升轉下跌, 或由下跌轉上升, 屬於高風險高回報嘅轉折點。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 等待方向確認, 唔好搶跑。等新趨勢確認 + 量能配合再入市。</p>
  ` : `
    <p>📌 <strong>簡單講</strong>: 10 條 rule 中只觸發咗 C/D/G 等橫行 rule, 冇明確方向, 股票喺一個範圍內運行。</p>
    <p>📊 <strong>咩意思</strong>: MA5 ${verdict.meta.latestMA5}, MA10 ${verdict.meta.latestMA10}, MA60 ${verdict.meta.latestMA60}, 均線交叉或距離近, 結構混亂。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 橫行結構, 等待方向確認。配合 M6 Volatility Squeeze 訊號可以捕捉突破時機。</p>
  `;

  return `
    <div class="as03-verdict as03-module-card">
      <div class="module-card-header">
        <h4>📐 zmen均算法 (v0.3.0, 舊 M1 抽出獨立)</h4>
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
          <div class="summary-row"><span>數據日數:</span> <strong>${verdict.meta.dataDays}</strong></div>
          <div class="summary-row"><span>Matched Rules:</span> <strong>${matchedRules.length}</strong></div>
        </div>
      </div>

      <div class="interpretation">
        <strong>📌 解讀：</strong>${verdict.interpretation}
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
      <h4>📖 詳細解讀 (10 條 rule 點解讀)</h4>
      <table class="explain-table">
        <tr><td class="field-name">📊 state (週期類型)</td><td><strong>${verdict.state}</strong> — ${verdict.state === 'UP' ? '上升勢 (A/F rule 主導)' : verdict.state === 'DOWN' ? '下跌勢 (B/G rule 主導)' : verdict.state === 'SIDEWAYS' ? '橫行 (C/D rule 主導)' : '轉折 (H rule 觸發 — 7 日內反轉)'}</td></tr>
        <tr><td class="field-name">🎯 confidence (信心指數 ${confidencePct}%)</td><td>${confidencePct >= 70 ? '🟢 高信心 — 判定可靠' : confidencePct >= 50 ? '🟡 中信心 — 有參考價值' : '🔴 低信心 — 信唔過'}</td></tr>
        <tr><td class="field-name">📐 觸發 rule (${matchedRules.length} 條)</td><td>${matchedRules.length === 0 ? '無 rule 觸發,預設 SIDEWAYS' : matchedRules.map(r => `<strong>${r}</strong> — ${ruleExplain[r] || r}`).join(' / ')}</td></tr>
        <tr><td class="field-name">📈 MA5</td><td>${verdict.meta.latestMA5 || 'N/A'} (5 日平均線,短期趨勢)</td></tr>
        <tr><td class="field-name">📈 MA10</td><td>${verdict.meta.latestMA10 || 'N/A'} (10 日平均線,中短期)</td></tr>
        <tr><td class="field-name">📈 MA60</td><td>${verdict.meta.latestMA60 || 'N/A'} (60 日平均線,中長期趨勢)</td></tr>
        <tr><td class="field-name">📅 數據日數</td><td>${verdict.meta.dataDays} 日</td></tr>
        <tr><td class="field-name">⏰ 時間週期</td><td>${verdict.timeframe}</td></tr>
        <tr><td class="field-name">🔧 連續日數</td><td>${verdict.meta.configUsed?.consecutiveDays || 5} 日 (A/B/F/G 用)</td></tr>
        <tr><td class="field-name">🔧 反轉窗口</td><td>${verdict.meta.configUsed?.reversalWindowDays || 7} 日 (H rule 用)</td></tr>
        <tr><td class="field-name">🔧 觸發門檻</td><td>${((verdict.meta.configUsed?.chanceThresholdPct || 0.02) * 100).toFixed(1)}% (I/J rule 用)</td></tr>
        <tr><td class="field-name">💪 Rule 強度</td><td>${matchedRules.length > 0 ? (matchedRules.some(r => r.startsWith('H') || ['A','B'].includes(r)) ? '強 (A/B/H)' : matchedRules.some(r => ['I','J'].includes(r)) ? '弱 (I/J)' : '中 (C/D/F/G)') : '無'}</td></tr>
      </table>
    </div>
  `;
}

// ===== 策略建議 section (MA alignment) =====
function renderStrategyAdviceMA(verdict) {
  const confidencePct = (verdict.confidence * 100).toFixed(0);
  const isHighConf = verdict.confidence >= 0.7;
  const isLowConf = verdict.confidence < 0.5;
  const matchedRules = verdict.meta?.matchedRules || [];

  let stateAdvice = '';
  if (verdict.state === 'UP') {
    stateAdvice = `
      <div class="strategy-up">
        <h4>🟢 上升勢 (A/F rule 主導) · 策略建議</h4>
        <p><strong>基本動作:</strong>順勢持倉,慢慢加倉</p>
        <p><strong>訊號確認:</strong>A rule (連續 5 日 MA5 > MA60) 觸發,代表中期趨勢向上</p>
        <p><strong>風險管理:</strong>留意 F rule (升勢調整 — MA5 < MA10 但仍 > MA60),呢個係見頂警號,出現就要收緊止損</p>
        <p><strong>止損位:</strong>最近 5 日 low 跌穿 MA5 × 0.98 (I rule 失效),即係要留意</p>
        <p><strong>進場策略:</strong>等回調到 MA5/MA10 附近再反彈,低吸</p>
        <p><strong>特別注意:</strong>如果 H-reverse-down rule 都觸發,代表 7 日內由升轉跌,要小心</p>
      </div>
    `;
  } else if (verdict.state === 'DOWN') {
    stateAdvice = `
      <div class="strategy-down">
        <h4>🔴 下跌勢 (B/G rule 主導) · 策略建議</h4>
        <p><strong>基本動作:</strong>避開 / 考慮減倉</p>
        <p><strong>訊號確認:</strong>B rule (連續 5 日 MA5 < MA60) 觸發,代表中期趨勢向下</p>
      <p><strong>風險管理:</strong>留意 G rule (跌勢調整 — MA5 > MA10 但仍 < MA60),可能見底</p>
      <p><strong>止損位:</strong>最近 5 日 high 升穿 MA5 × 1.02 (J rule 失效)</p>
      <p><strong>進場策略:</strong>反彈到 MA5/MA10 附近再回落,做空</p>
      <p><strong>特別注意:</strong>如果 H-reverse-up rule 都觸發,代表 7 日內由跌轉升</p>
      </div>
    `;
  } else if (verdict.state === 'SIDEWAYS') {
    stateAdvice = `
      <div class="strategy-sideways">
        <h4>🟡 橫行 (C/D rule 主導) · 策略建議</h4>
        <p><strong>基本動作:</strong>等方向,等 MA5 升穿/跌穿 MA60 確認</p>
        <p><strong>訊號確認:</strong>C rule (橫行向下) 或 D rule (橫行向上) 觸發,代表 5 日內出現過矛盾</p>
        <p><strong>進場策略:</strong>唔好喺橫行中間進場,等 MA5 突破 MA60 先做</p>
        <p><strong>觀察重點:</strong>留意 H-reverse rule,如果出現就係轉勢先兆</p>
      </div>
    `;
  } else { // TRANSITION
    stateAdvice = `
      <div class="strategy-transition">
        <h4>🟣 轉折 (H rule 觸發) · 策略建議</h4>
        <p><strong>基本動作:</strong>暫時 hold,等 7 日內反轉確認</p>
        <p><strong>訊號確認:</strong>H-reverse-up 或 H-reverse-down 觸發,代表 7 日內有 1-3 日新方向</p>
        <p><strong>進場策略:</strong>暫時唔好落新單,等下個確認 signal</p>
        <p><strong>觀察重點:</strong>睇新方向會唔會延續,如果連續 5 日都同方向就變 UP/DOWN state</p>
        <p><strong>風險:</strong>轉折失敗可能係假突破,要小心</p>
      </div>
    `;
  }

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
function renderUsageGuideMA(verdict) {
  return `
    <div class="usage-guide">
      <h4>💡 點用呢個結果 (點睇)</h4>
      <ol>
        <li><strong>先睇 state 同信心</strong> — 個大色塊 (綠=UP / 紅=DOWN / 橙=SIDEWAYS / 紫=TRANSITION) 同信心百分比,呢個係最概要嘅判斷</li>
        <li><strong>睇「觸發 rule」嗰行</strong> — 例如「A」= 強烈上升,「H-reverse-down」= 7 日內由升轉跌。每條 rule 都有具體意思,睇「📖 詳細解讀」section</li>
        <li><strong>睇 chart 上面嘅 MA 線</strong> — chart 會 render MA5/MA10/MA20 三條線,呢個 module 嘅判定建基於呢啲線。睇線嘅相對位置 (MA5 喺 MA10 上面 = 短期強)</li>
        <li><strong>睇 MA 值嗰 3 個 box</strong> — MA5/MA10/MA60 嘅實際數值,比較當前價同呢 3 條線嘅距離</li>
        <li><strong>信心 &lt; 50% 唔好落單</strong> — 寧願等下一個更明顯信號</li>
        <li><strong>配合其他 module 一齊睇</strong> — 揀 AS-03 (umbrella) 同時跑 7 個 module,compare 唔同 module 嘅判斷</li>
        <li><strong>短期 vs 中期</strong> — MA5/MA10 係短期,MA60 係中期,呢個 module 主要睇中期趨勢</li>
        <li><strong>回測用 100+ 日 K 線</strong> — 預設 100 日夠用,加長可攞更穩 verdict</li>
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
  if (typeof chart.addLineSeries !== 'function') {
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
    const s = chart.addLineSeries({
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
    const s = chart.addLineSeries({
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
    const s = chart.addLineSeries({
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

const DEFAULT_VOLUME_PRICE_CONFIG = {
  // 大少 2026-08-07 — Module 5 v2.0.0 fields (跟 modules/volume.ts)
  volumePercentileLookback: 60,
  vwapPeriod: 20,
  breakoutConfirmDays: 3,
  pullbackCorrelationWindow: 10,
  volumeSurgeMinDays: 2,
  falseBreakoutRetracePct: 0.5,
  denseZoneAtrMultiple: 0.5,
};

// ===== VolumePrice v2.0.0 (大少 2026-08-07 overwrite) =====
//
// 對應 modules/volume.ts v2.0.0 — 跟 ma-alignment / hl-structure / trendline / indicators pattern 一致
// 跟 docx `05成交量價格行為確認法.docx` v2.0 spec
// Spec doc: `docs/research/AS-03-cycle-detection/MODULE-05-VOLUME-PRICE-V2.md`
//
// 15 條 rule V1-V15 (對應 modules/volume.ts 嘅 MatchedRule detection)
// 11 個 step algorithm (data validation → basic indicators → volume filter →
// weighted OBV → breakout detection → pullback health → ATR dynamic bins →
// rolling volume-price correlation → volume regime → rule engine → output)
//
// State 派生: cycle (uptrend / downtrend / sideways) + signal (CONFIRM / DISCONFIRM / NEUTRAL)

export async function analyzeVolumePrice(klines, options = {}) {
  const cfg = { ...DEFAULT_VOLUME_PRICE_CONFIG, ...(options.volumePriceConfig || {}) };

  // ============ Step 0: 輸入驗證 ============
  const minData = Math.max(80, cfg.volumePercentileLookback + cfg.vwapPeriod + cfg.breakoutConfirmDays + 20);
  if (!Array.isArray(klines) || klines.length < minData) {
    return {
      moduleId: 'volume',
      timeframe: options.period || '1d',
      state: 'SIDEWAYS',
      confidence: 0,
      interpretation: `[VolumePrice v2.0] 數據不足: need >= ${minData} bars, got ${klines.length}`,
      evidence: [],
      warnings: [`數據不足 (${klines.length}/${minData})`],
      meta: { dataDays: klines.length, configUsed: cfg },
      timestamp: Date.now(),
    };
  }

  const recent = klines.slice(-Math.max(klines.length, minData));
  const n = recent.length;
  const lastIdx = n - 1;
  const lastBar = recent[lastIdx];
  const currentPrice = lastBar.close;

  // ============ Step 1: 計算基礎指標 ============
  // ATR (Wilder 14)
  const atrValue = computeATR_v2(recent, 14);
  // VWAP
  const vwapValue = computeVWAP_v2(recent, cfg.vwapPeriod);
  // Volume percentile
  const volPercentile = computeVolumePercentile_v2(recent, cfg.volumePercentileLookback);
  // Turnover rate
  const sharesOutstanding = options.sharesOutstanding ?? null;
  const turnoverRate = sharesOutstanding ? lastBar.volume / sharesOutstanding : null;

  // ============ Step 2: 成交量標準差過濾 ============
  const vol20 = recent.slice(-20).map(k => k.volume);
  const volMean20 = vol20.reduce((a, b) => a + b, 0) / 20;
  const volStd20 = Math.sqrt(vol20.reduce((acc, v) => acc + (v - volMean20) ** 2, 0) / 20);
  const volZScore = volStd20 > 0 ? (lastBar.volume - volMean20) / volStd20 : 0;
  const prevVol1 = n >= 3 ? recent[n - 2].volume : 0;
  const prevVol2 = n >= 3 ? recent[n - 3].volume : 0;
  const isAnomalySpike = volZScore > 3.0
    && prevVol1 < volMean20 * 1.5
    && prevVol2 < volMean20 * 1.5
    && lastBar.volume >= volMean20 * 5;

  // 連續放量
  let consecutiveSurge = 0;
  for (let i = lastIdx; i >= Math.max(0, lastIdx - 9); i--) {
    if (recent[i].volume / volMean20 >= 1.3) consecutiveSurge++;
    else break;
  }
  const isSustainedVolume = consecutiveSurge >= cfg.volumeSurgeMinDays && !isAnomalySpike;

  // ============ Step 3: 加權 OBV (Tanh) ============
  const weightedObv = [0];
  for (let i = 1; i < n; i++) {
    const priceChangePct = (recent[i].close - recent[i - 1].close) / recent[i - 1].close;
    const weight = Math.tanh(priceChangePct * 10);
    weightedObv.push(weightedObv[i - 1] + recent[i].volume * weight);
  }
  const obvSma20 = computeSMA_v2(weightedObv, 20);
  const obvTrend = weightedObv[lastIdx] > obvSma20[lastIdx] * 1.03 ? 'rising'
    : weightedObv[lastIdx] < obvSma20[lastIdx] * 0.97 ? 'falling' : 'flat';
  const recentCloses20 = recent.slice(-20).map(k => k.close);
  const recentObv20 = weightedObv.slice(-20);
  const obvPriceCorr = pearsonCorrelation_v2(recentCloses20, recentObv20);

  // ============ Step 4: 放量突破檢測 ============
  const last20Closes = recent.slice(-20).map(k => k.close);
  const recent20High = Math.max(...last20Closes);
  const last40Closes = recent.slice(-40, -20).map(k => k.close);
  const prevPeriodHigh = last40Closes.length > 0 ? Math.max(...last40Closes) : recent20High;
  const breakoutWindow = recent.slice(-(cfg.breakoutConfirmDays + 1)).map(k => k.close);
  const maxCloseInBreakoutWindow = Math.max(...breakoutWindow);
  const isPriceBreakout = maxCloseInBreakoutWindow > recent20High * 0.998;

  let breakoutPattern = 'none';
  let breakoutStrength = 0;
  let falseBreakoutRisk = 0;

  if (isPriceBreakout && n >= 4) {
    const baseline7 = recent.slice(n - 9, n - 2).map(k => k.volume);
    const preAvg = baseline7.reduce((a, b) => a + b, 0) / baseline7.length;
    const preBreakoutVols = [recent[n - 4].volume, recent[n - 3].volume, recent[n - 2].volume];

    const gradualBuildup = preBreakoutVols.every(v => v > preAvg * 1.1)
      && lastBar.volume > preAvg * 1.5
      && !isAnomalySpike;
    const surgeBreakout = lastBar.volume > preAvg * 2.0 && consecutiveSurge >= 2;

    if (gradualBuildup) {
      breakoutPattern = 'gradual_buildup';
      breakoutStrength = 0.9;
    } else if (surgeBreakout && !isAnomalySpike) {
      breakoutPattern = 'sustained_surge';
      breakoutStrength = 0.75;
    } else if (lastBar.volume > preAvg * 1.5) {
      breakoutPattern = 'single_spike';
      breakoutStrength = 0.4;
      falseBreakoutRisk = 0.4;
    } else {
      breakoutPattern = 'low_volume';
      breakoutStrength = 0.15;
      falseBreakoutRisk = 0.7;
    }

    if (breakoutStrength >= 0.4 && n >= cfg.breakoutConfirmDays + 1) {
      const postBreakoutLows = recent.slice(-cfg.breakoutConfirmDays).map(k => k.low);
      const postBreakoutLow = Math.min(...postBreakoutLows);
      const breakoutLevel = recent20High;
      const range = breakoutLevel - prevPeriodHigh > 0 ? breakoutLevel - prevPeriodHigh : 1;
      const retracePct = (breakoutLevel - postBreakoutLow) / range;
      if (retracePct > cfg.falseBreakoutRetracePct) {
        falseBreakoutRisk += 0.3;
      }
    }
  }

  const isBreakoutConfirmed = breakoutPattern === 'none' ? false
    : breakoutStrength < 0.4 ? false
    : n < cfg.breakoutConfirmDays + 1 ? 'pending'
    : (falseBreakoutRisk < 0.6);

  // ============ Step 5: 回調健康度 ============
  const last20 = recent.slice(-20);
  let recentPeakIdx = 0;
  let recentPeakPrice = last20[0].close;
  for (let i = 1; i < last20.length; i++) {
    if (last20[i].close > recentPeakPrice) {
      recentPeakPrice = last20[i].close;
      recentPeakIdx = i;
    }
  }
  const recentPeakFullIdx = (n - 20) + recentPeakIdx;
  const pullbackDays = lastIdx - recentPeakFullIdx;
  const isPullback = currentPrice < recentPeakPrice * 0.97;

  let pullbackIsHealthy = false;
  let depthVolCorr = 0;
  let supportZone = null;
  let daysToSupport = null;

  if (isPullback && pullbackDays <= 20 && pullbackDays >= 2) {
    const pullbackSegment = recent.slice(recentPeakFullIdx);
    const depths = [];
    const volumes = [];
    for (const k of pullbackSegment) {
      depths.push((recentPeakPrice - k.close) / recentPeakPrice);
      volumes.push(k.volume);
    }
    if (depths.length >= 5) {
      depthVolCorr = pearsonCorrelation_v2(depths, volumes);
      if (depthVolCorr < -0.3) {
        pullbackIsHealthy = true;
        if (currentPrice > vwapValue * 0.99) {
          supportZone = 'vwap';
          daysToSupport = 0;
        } else {
          supportZone = 'dense_zone_pending';
          daysToSupport = 0;
        }
      } else if (depthVolCorr > 0.3) {
        pullbackIsHealthy = false;
      } else {
        pullbackIsHealthy = 'unclear';
      }
    }
  }

  // ============ Step 6: ATR 動態分箱 ============
  const binWidth = atrValue > 0 ? atrValue * cfg.denseZoneAtrMultiple : currentPrice * 0.01;
  const bins = new Map();
  for (let i = Math.max(0, n - 60); i < n; i++) {
    const center = Math.round(recent[i].close / binWidth) * binWidth;
    if (!bins.has(center)) {
      bins.set(center, { totalVol: 0, high: recent[i].high, low: recent[i].low, count: 0 });
    }
    const b = bins.get(center);
    b.totalVol += recent[i].volume;
    b.high = Math.max(b.high, recent[i].high);
    b.low = Math.min(b.low, recent[i].low);
    b.count++;
  }
  const overallAvgVol = recent.slice(-60).reduce((acc, k) => acc + k.volume, 0) / 60;
  const sortedBins = [...bins.entries()].sort((a, b) => b[1].totalVol - a[1].totalVol).slice(0, 3);
  const denseZones = [];
  for (const [center, data] of sortedBins) {
    const avgVolInBin = data.totalVol / data.count;
    if (avgVolInBin > overallAvgVol * 1.3) {
      const zoneType = currentPrice > center + binWidth / 2 ? 'support'
        : currentPrice < center - binWidth / 2 ? 'resistance' : 'neutral';
      denseZones.push({
        priceLevelLow: Math.round(data.low * 100) / 100,
        priceLevelHigh: Math.round(data.high * 100) / 100,
        priceLevelMid: Math.round(center * 100) / 100,
        totalVolume: data.totalVol,
        volumeRatio: Math.round((avgVolInBin / overallAvgVol) * 100) / 100,
        type: zoneType,
        distancePct: Math.round(((currentPrice - center) / center) * 10000) / 10000,
      });
      if (zoneType === 'support' && supportZone === 'dense_zone_pending') {
        supportZone = `dense_zone_${Math.round(center)}`;
      }
    }
  }

  // ============ Step 7: 滾動量价相關 ============
  const last15 = recent.slice(-15);
  const priceChanges = [];
  const volumeChanges = [];
  for (let i = 1; i < last15.length; i++) {
    priceChanges.push((last15[i].close - last15[i - 1].close) / last15[i - 1].close);
    volumeChanges.push(last15[i - 1].volume > 0
      ? (last15[i].volume - last15[i - 1].volume) / last15[i - 1].volume
      : 0);
  }
  const corrRecent = priceChanges.length >= 10
    ? pearsonCorrelation_v2(priceChanges.slice(5, 10), volumeChanges.slice(5, 10))
    : 0;
  const corrEarlier = priceChanges.length >= 5
    ? pearsonCorrelation_v2(priceChanges.slice(0, 5), volumeChanges.slice(0, 5))
    : 0;
  const correlationDecay = corrEarlier - corrRecent;
  const divergenceDetected = correlationDecay > 0.4 && Math.abs(corrRecent) < 0.2;
  const divergenceType = divergenceDetected
    ? (currentPrice > last15[last15.length - 6].close ? 'bearish_vp' : 'bullish_vp')
    : undefined;

  // ============ Step 8: 成交量體制 ============
  const priceTrend10d = (n >= 11 ? (recent[n - 1].close - recent[n - 11].close) / recent[n - 11].close : 0);
  const priceRising = priceTrend10d > 0.02;
  const priceFalling = priceTrend10d < -0.02;
  let accumulationScore = 0;
  let distributionScore = 0;
  if (obvTrend === 'rising' && volPercentile < 0.3) accumulationScore += 0.3;
  if (pullbackIsHealthy === true) accumulationScore += 0.25;
  if (breakoutPattern === 'gradual_buildup') accumulationScore += 0.25;
  if (priceRising && obvTrend === 'rising') accumulationScore += 0.2;
  if (obvTrend === 'falling' && volPercentile > 0.7) distributionScore += 0.3;
  if (divergenceType === 'bearish_vp') distributionScore += 0.25;
  if (breakoutPattern === 'single_spike' && falseBreakoutRisk > 0.5) distributionScore += 0.2;
  if (priceFalling && obvTrend === 'falling') distributionScore += 0.2;
  const volumeRegime = accumulationScore > distributionScore && accumulationScore > 0.4 ? 'accumulation'
    : distributionScore > accumulationScore && distributionScore > 0.4 ? 'distribution' : 'neutral';

  // ============ Step 9: 15 條 rule V1-V15 觸發 ============
  const matchedRules = [];
  const RULES = [
    { id: 'V1', label: 'ATR 波動充足', strength: 'weak' },
    { id: 'V2', label: 'VWAP 支撐', strength: 'weak' },
    { id: 'V3', label: '成交量百分位正常', strength: 'weak' },
    { id: 'V4', label: '連續堆量', strength: 'medium' },
    { id: 'V5', label: '異常爆量過濾', strength: 'strong' },
    { id: 'V6', label: '加權 OBV 上升', strength: 'medium' },
    { id: 'V7', label: '加權 OBV 下跌', strength: 'medium' },
    { id: 'V8', label: 'OBV 與價格同向', strength: 'strong' },
    { id: 'V9', label: '溫和堆量突破', strength: 'strong' },
    { id: 'V10', label: '放量突破確認', strength: 'strong' },
    { id: 'V11', label: '縮量突破警告', strength: 'strong' },
    { id: 'V12', label: '假突破識別', strength: 'strong' },
    { id: 'V13', label: '健康回調', strength: 'medium' },
    { id: 'V14', label: '拋售拋壓', strength: 'strong' },
    { id: 'V15', label: '量价背馳', strength: 'strong' },
  ];
  if (atrValue > currentPrice * 0.005) matchedRules.push(RULES[0]);
  if (currentPrice > vwapValue * 0.99) matchedRules.push(RULES[1]);
  if (volPercentile >= 0 && volPercentile <= 1) matchedRules.push(RULES[2]);
  if (isSustainedVolume) matchedRules.push(RULES[3]);
  if (isAnomalySpike) matchedRules.push(RULES[4]);
  if (obvTrend === 'rising') matchedRules.push(RULES[5]);
  if (obvTrend === 'falling') matchedRules.push(RULES[6]);
  if (obvPriceCorr > 0.5) matchedRules.push(RULES[7]);
  if (breakoutPattern === 'gradual_buildup') matchedRules.push(RULES[8]);
  if (breakoutPattern === 'sustained_surge' && isBreakoutConfirmed === true) matchedRules.push(RULES[9]);
  if (breakoutPattern === 'low_volume' || falseBreakoutRisk > 0.5) matchedRules.push(RULES[10]);
  if (falseBreakoutRisk > 0.6) matchedRules.push(RULES[11]);
  if (pullbackIsHealthy === true) matchedRules.push(RULES[12]);
  if (depthVolCorr > 0.3) matchedRules.push(RULES[13]);
  if (divergenceDetected) matchedRules.push(RULES[14]);

  // ============ Step 10: 規則引擎 (5 buy + 4 減分) ============
  let buyTimingScore = 0.3;
  const buyReasons = [];
  const falseSignalFlags = [];

  if (breakoutPattern === 'gradual_buildup' && isBreakoutConfirmed === true
      && obvPriceCorr > 0.5 && !divergenceDetected) {
    buyTimingScore = 0.9;
    buyReasons.push('V9 溫和堆量突破確認 + V8 OBV 同步,黃金買點');
  } else if (pullbackIsHealthy === true && supportZone !== null
      && volumeRegime === 'accumulation' && obvTrend === 'rising') {
    buyTimingScore = 0.75;
    buyReasons.push(`V13 健康回調至 ${supportZone},V6 OBV 資金流入`);
  } else if (divergenceType === 'bullish_vp' && volPercentile < 0.2 && obvTrend !== 'falling') {
    buyTimingScore = 0.6;
    buyReasons.push('V15 拋壓枯竭,試探性買入');
  } else if (currentPrice > vwapValue * 0.995 && currentPrice < vwapValue * 1.02
      && volPercentile < 0.5 && obvTrend === 'rising') {
    buyTimingScore = 0.55;
    buyReasons.push('V2 VWAP 支撐反彈,量縮');
  } else {
    buyReasons.push('暫無明確成交量買入模式');
  }

  if (falseBreakoutRisk > 0.6) {
    buyTimingScore *= 0.5;
    falseSignalFlags.push('high_false_breakout_risk');
    buyReasons.push('警告:假突破風險極高');
  }
  if (divergenceType === 'bearish_vp' && volPercentile > 0.8) {
    buyTimingScore *= 0.4;
    falseSignalFlags.push('distribution_with_price_rise');
    buyReasons.push('警告:放量滯漲,主力可能出貨');
  }
  if (isAnomalySpike) {
    buyTimingScore *= 0.6;
    falseSignalFlags.push('anomaly_volume_spike');
    buyReasons.push('警告:單日異常爆量,信號不可靠');
  }
  if (obvPriceCorr < -0.3) {
    buyTimingScore *= 0.7;
    falseSignalFlags.push('obv_price_divergence');
    buyReasons.push('警告:OBV 與價格背馳,資金暗中流出');
  }
  if (obvTrend === 'falling' && volPercentile > 0.8 && priceTrend10d > 0.02) {
    buyTimingScore *= 0.5;
    falseSignalFlags.push('distribution_with_price_rise');
    buyReasons.push('警告:放量滯漲,主力可能出貨');
  }

  // ============ Step 11: Signal 推導 ============
  let signal = 'NEUTRAL';
  if (volumeRegime === 'distribution' || falseSignalFlags.length >= 2
      || (obvTrend === 'falling' && volPercentile > 0.7)) {
    signal = 'DISCONFIRM';
  } else if (buyTimingScore >= 0.55 && volumeRegime !== 'distribution'
      && falseSignalFlags.length === 0 && obvTrend !== 'falling') {
    signal = 'CONFIRM';
  }

  // ============ Step 12: Cycle 推導 ============
  const cycle = buyTimingScore >= 0.55 ? 'uptrend'
    : volumeRegime === 'distribution' ? 'downtrend' : 'sideways';
  const cycleLabel = buyTimingScore >= 0.55 ? '資金流入'
    : volumeRegime === 'distribution' ? '資金流出' : '資金觀望';
  const state = cycle === 'uptrend' ? 'UP'
    : cycle === 'downtrend' ? 'DOWN' : 'SIDEWAYS';

  // ============ Step 13: 勝率估算 ============
  let baseWin;
  if (buyTimingScore >= 0.85) baseWin = 0.68;
  else if (buyTimingScore >= 0.7) baseWin = 0.60;
  else if (buyTimingScore >= 0.55) baseWin = 0.52;
  else baseWin = 0.40;
  if (falseSignalFlags.length > 0) baseWin -= 0.08 * falseSignalFlags.length;
  const winProbability = Math.min(0.80, Math.max(0.25, baseWin));

  // ============ Step 14: 組裝輸出 ============
  // 大少 2026-08-11 — Module Warning System v1.0.0 (Phase 5a) — M5 VolumePrice
  // 警告注入:
  //   🟡 OUTLIER_VALUE: volume 全部 0 (klines 入面 volume 0)
  //   🟡 FALLBACK_USED: outstanding_shares = 0 (turnover_rate 計唔到)
  //   🔴 KLINE_MISSING: klines 為空 (length = 0)
  const m5Warnings = [];
  if (!Array.isArray(klines) || klines.length === 0) {
    m5Warnings.push(makeWarning('critical', 'M5', 'KLINE_MISSING',
      'klines 為空',
      {
        issue: 'klines array 為空或 undefined',
        impact: 'M5 全部 verdict 拎唔到, propagation 落 M7 會 MODULE_PARTIAL',
        fix: '確認 kline endpoint 有返 data, e.g. /api/kline?code=HK.00700&period=1d&count=100',
        context: { kline_count: klines?.length ?? 0 },
      }
    ));
  } else {
    const zeroVolCount = klines.filter(k => !k.volume || k.volume === 0).length;
    if (zeroVolCount === klines.length) {
      m5Warnings.push(makeWarning('warning', 'M5', 'OUTLIER_VALUE',
        'volume 全部 0',
        {
          issue: `${zeroVolCount}/${klines.length} 條 klines volume 係 0`,
          impact: '量價分析 verdict 唔可信 (acc/dist score 都係 0)',
          fix: '檢查 kline endpoint volume 數據, 試另一個 period (1d → 1w)',
          context: { zero_volume_count: zeroVolCount, total_count: klines.length },
        }
      ));
    }
    // 檢 outstanding_shares
    const outstandingSh = typeof outstanding_shares !== 'undefined' ? outstanding_shares : 0;
    if (outstandingSh === 0) {
      m5Warnings.push(makeWarning('warning', 'M5', 'FALLBACK_USED',
        'outstanding_shares = 0',
        {
          issue: 'outstanding_shares 拎唔到, turnover_rate fallback 0',
          impact: '換手率分析 verdict 唔可信',
          fix: '檢查 Futu get_market_snapshot() 有冇返 outstanding_shares, 美股 / 港股新 IPO 可能拎唔到',
          context: { outstanding_shares: 0 },
        }
      ));
    }
  }

  return {
    moduleId: 'volume',
    timeframe: options.period || '1d',
    state,
    confidence: Math.round(buyTimingScore * 10000) / 10000,
    interpretation: buyReasons.join('；'),
    evidence: matchedRules.map(r => ({ type: `rule-${r.id}`, label: r.label, value: r.id, passed: true })),
    warnings: m5Warnings,  // Backward compat
    _warnings: m5Warnings,  // 大少 2026-08-11 v1.0.0
    meta: {
      cycle,
      cycleLabel,
      signal,
      buyTimingScore: Math.round(buyTimingScore * 10000) / 10000,
      winProbability: Math.round(winProbability * 10000) / 10000,
      falseSignalFlags,
      volumeRegime,
      accumulationScore: Math.round(accumulationScore * 100) / 100,
      distributionScore: Math.round(distributionScore * 100) / 100,
      breakoutStatus: {
        isBreakout: isPriceBreakout,
        isConfirmed: isBreakoutConfirmed,
        pattern: breakoutPattern,
        strength: Math.round(breakoutStrength * 100) / 100,
        falseBreakoutRisk: Math.round(falseBreakoutRisk * 100) / 100,
      },
      pullbackHealth: {
        isHealthy: pullbackIsHealthy,
        depthVolCorrelation: Math.round(depthVolCorr * 10000) / 10000,
        supportZone,
        daysToSupport,
      },
      vwapAnalysis: {
        vwapValue: Math.round(vwapValue * 100) / 100,
        priceVsVwapPct: Math.round(((currentPrice - vwapValue) / vwapValue) * 10000) / 10000,
        vwapSupportStrength: currentPrice > vwapValue * 1.01 ? 'strong'
          : currentPrice > vwapValue * 0.99 ? 'testing' : 'broken',
      },
      volumePercentile: Math.round(volPercentile * 10000) / 10000,
      turnoverRate: turnoverRate !== null ? Math.round(turnoverRate * 1000000) / 1000000 : null,
      denseZones,
      volumePriceCorrelation: {
        pearsonRecent: Math.round(corrRecent * 10000) / 10000,
        pearsonEarlier: Math.round(corrEarlier * 10000) / 10000,
        correlationDecay: Math.round(correlationDecay * 10000) / 10000,
        divergenceDetected,
        divergenceType,
      },
      obvAnalysis: {
        obvTrend,
        obvPriceCorrelation: Math.round(obvPriceCorr * 10000) / 10000,
        weightedObvValue: Math.round(weightedObv[lastIdx]),
      },
      matchedRules: matchedRules.map(r => r.id),
      ruleLabels: matchedRules.map(r => r.label),
      rulesFired: matchedRules.length,
      atr: Math.round(atrValue * 100) / 100,
      vwap: Math.round(vwapValue * 100) / 100,
      consecutiveSurge,
      isAnomalySpike,
      configUsed: cfg,
      dataDays: n,
    },
    timestamp: Date.now(),
  };
}

// ===== v2.0 helpers (port from modules/volume.ts) =====

function computeATR_v2(klines, period) {
  if (klines.length < period + 1) return 0;
  const trs = [];
  for (let i = 1; i < klines.length; i++) {
    const tr = Math.max(
      klines[i].high - klines[i].low,
      Math.abs(klines[i].high - klines[i - 1].close),
      Math.abs(klines[i].low - klines[i - 1].close),
    );
    trs.push(tr);
  }
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

function computeVWAP_v2(klines, period) {
  const startIdx = Math.max(0, klines.length - period);
  let cumPV = 0, cumVol = 0;
  for (let i = startIdx; i < klines.length; i++) {
    const typicalPrice = (klines[i].high + klines[i].low + klines[i].close) / 3;
    cumPV += typicalPrice * klines[i].volume;
    cumVol += klines[i].volume;
  }
  if (cumVol === 0) {
    const slice = klines.slice(startIdx);
    return slice.reduce((acc, k) => acc + k.close, 0) / slice.length;
  }
  return cumPV / cumVol;
}

function computeVolumePercentile_v2(klines, lookback) {
  const startIdx = Math.max(0, klines.length - lookback);
  const recentVols = klines.slice(startIdx).map(k => k.volume);
  if (recentVols.length === 0) return 0;
  const sorted = [...recentVols].sort((a, b) => a - b);
  const latestVol = recentVols[recentVols.length - 1];
  const rank = sorted.filter(v => v <= latestVol).length;
  return rank / sorted.length;
}

function computeSMA_v2(series, period) {
  const sma = [];
  for (let i = 0; i < series.length; i++) {
    if (i < period - 1) { sma.push(NaN); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += series[j];
    sma.push(sum / period);
  }
  return sma;
}

function pearsonCorrelation_v2(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const xSlice = xs.slice(-n);
  const ySlice = ys.slice(-n);
  const xMean = xSlice.reduce((a, b) => a + b, 0) / n;
  const yMean = ySlice.reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xSlice[i] - xMean;
    const dy = ySlice[i] - yMean;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
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

  const color = stateColors[verdict.state] || '#666';
  const stateLabel = stateLabels[verdict.state] || verdict.state;
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
  const confidencePct = (verdict.confidence * 100).toFixed(1);
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
        <strong>📌 資金判斷：</strong>${verdict.interpretation}
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

const DEFAULT_VOLATILITY_CONFIG = {
  bbPeriod: 20,
  bbStd: 2.0,
  kcPeriod: 20,
  kcAtrMult: 1.5,
  atrPeriod: 14,
  squeezeMinDuration: 3,
  followThroughDays: 5,
  vcpTolerancePct: 0.02,
  vcpMinWindows: 2,
};

export async function analyzeVolatility(klines, options = {}) {
  const cfg = { ...DEFAULT_VOLATILITY_CONFIG, ...(options.volatilityConfig || {}) };
  const minData = Math.max(85, cfg.bbPeriod + 50 + cfg.followThroughDays + 10);
  if (!Array.isArray(klines) || klines.length < minData) {
    return {
      moduleId: 'volatility', timeframe: options.period || '1d',
      state: 'SIDEWAYS', confidence: 0,
      interpretation: `[Volatility v1.0] 數據不足: need >= ${minData} bars, got ${klines.length}`,
      evidence: [], warnings: [`數據不足 (${klines.length}/${minData})`],
      _warnings: [makeWarning('critical', 'M6', 'INSUFFICIENT_DATA',
        '數據不足以跑波動率分析',
        {
          issue: `klines count ${klines?.length || 0} < ${minData} required`,
          impact: 'M6 verdict fallback SIDEWAYS, 對 M7 综合判定偏差',
          fix: '增加 dataWindowDays 設定 (e.g. count=200)',
          context: { kline_count: klines?.length || 0, min_required: minData, period: options.period },
        })],
      meta: { dataDays: klines.length, configUsed: cfg }, timestamp: Date.now(),
    };
  }

  const recent = klines.slice(-Math.max(klines.length, minData));
  const n = recent.length;
  const lastIdx = n - 1;
  const lastBar = recent[lastIdx];

  // ATR (Wilder)
  const atrValue = (() => {
    if (n < cfg.atrPeriod + 1) return 0;
    const trs = [];
    for (let i = 1; i < n; i++) {
      trs.push(Math.max(
        recent[i].high - recent[i].low,
        Math.abs(recent[i].high - recent[i-1].close),
        Math.abs(recent[i].low - recent[i-1].close),
      ));
    }
    let atr = trs.slice(0, cfg.atrPeriod).reduce((a,b) => a+b, 0) / cfg.atrPeriod;
    for (let i = cfg.atrPeriod; i < trs.length; i++) {
      atr = (atr * (cfg.atrPeriod - 1) + trs[i]) / cfg.atrPeriod;
    }
    return atr;
  })();

  // BB / KC
  const bbUpper = [], bbLower = [], bbSma = [], kcUpper = [], kcLower = [];
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - cfg.bbPeriod + 1);
    let sum = 0, count = 0;
    for (let j = start; j <= i; j++) { sum += recent[j].close; count++; }
    const sma = count > 0 ? sum / count : 0;
    let sqSum = 0;
    for (let j = start; j <= i; j++) sqSum += (recent[j].close - sma) ** 2;
    const std = count > 0 ? Math.sqrt(sqSum / count) : 0;
    bbSma.push(sma);
    bbUpper.push(sma + cfg.bbStd * std);
    bbLower.push(sma - cfg.bbStd * std);
    kcUpper.push(sma + cfg.kcAtrMult * atrValue);
    kcLower.push(sma - cfg.kcAtrMult * atrValue);
  }

  // Squeeze detection
  const squeezeHistory = [];
  for (let i = 0; i < n; i++) {
    const wbb = bbSma[i] > 0 ? (bbUpper[i] - bbLower[i]) / bbSma[i] : 0;
    const wkc = bbSma[i] > 0 ? (kcUpper[i] - kcLower[i]) / bbSma[i] : 0;
    squeezeHistory.push(wbb < wkc);
  }
  const isSqueeze = squeezeHistory[lastIdx];
  let squeezeDuration = 0;
  for (let i = lastIdx; i >= 0; i--) {
    if (squeezeHistory[i]) squeezeDuration++;
    else break;
  }

  // Squeeze quality
  const squeezeStart = Math.max(0, lastIdx - squeezeDuration + 1);
  const squeezePrices = recent.slice(squeezeStart, lastIdx + 1).map(k => k.close);
  const pMean = squeezePrices.length > 0 ? squeezePrices.reduce((a,b) => a+b, 0) / squeezePrices.length : 0;
  const pStd = squeezePrices.length > 0 ? Math.sqrt(squeezePrices.reduce((acc, p) => acc + (p - pMean)**2, 0) / squeezePrices.length) : 0;
  const priceCV = pMean > 0 ? pStd / pMean : 0;

  // Volume concentration (5 bins entropy)
  const minP = squeezePrices.length > 0 ? Math.min(...squeezePrices) : 0;
  const maxP = squeezePrices.length > 0 ? Math.max(...squeezePrices) : 0;
  const rangeP = maxP - minP;
  const volBins = new Array(5).fill(0);
  if (rangeP > 0) {
    for (const k of recent.slice(squeezeStart, lastIdx + 1)) {
      const binIdx = Math.min(4, Math.floor((k.close - minP) / (rangeP / 5)));
      volBins[binIdx] += k.volume;
    }
  }
  const totalVol = volBins.reduce((a,b) => a+b, 0);
  let entropy = 0;
  if (totalVol > 0) {
    for (const v of volBins) {
      if (v > 0) { const p = v / totalVol; entropy -= p * Math.log(p); }
    }
  }
  const maxEntropy = Math.log(5);
  const volumeConcentration = maxEntropy > 0 ? 1 - entropy / maxEntropy : 0;
  const squeezeTrend = squeezePrices.length > 0 ? (squeezePrices[squeezePrices.length-1] - squeezePrices[0]) / squeezePrices[0] : 0;
  const isHorizontal = Math.abs(squeezeTrend) < 0.02;
  let qualityScore = 0;
  if (isHorizontal) qualityScore += 0.3;
  qualityScore += volumeConcentration * 0.4;
  qualityScore += (1 - Math.min(1, priceCV / 0.03)) * 0.3;
  const isGenuineSqueeze = qualityScore >= 0.6 && squeezeDuration >= cfg.squeezeMinDuration;

  // ATR decomposition (linear regression residual)
  const lookback = 20;
  const trendAtr = [], noiseAtr = [];
  for (let i = lookback - 1; i < n; i++) {
    const seg = recent.slice(i - lookback + 1, i + 1);
    const xMean = (lookback - 1) / 2;
    const yMean = seg.reduce((a, k) => a + k.close, 0) / seg.length;
    let num = 0, denX = 0;
    for (let j = 0; j < seg.length; j++) {
      const dx = j - xMean, dy = seg[j].close - yMean;
      num += dx * dy; denX += dx * dx;
    }
    const slope = denX > 0 ? num / denX : 0;
    const intercept = yMean - slope * xMean;
    let trendComp = 0;
    const residuals = [];
    for (let j = 0; j < seg.length; j++) {
      const pred = slope * j + intercept;
      trendComp += Math.abs(seg[j].high - pred) + Math.abs(seg[j].low - pred);
      residuals.push(seg[j].close - pred);
    }
    trendComp = trendComp / (2 * seg.length);
    const noiseComp = residuals.reduce((a, r) => a + Math.abs(r), 0) / residuals.length;
    trendAtr.push(trendComp);
    noiseAtr.push(noiseComp);
  }
  const latestTrendAtr = trendAtr[trendAtr.length - 1] || 0;
  const latestNoiseAtr = noiseAtr[noiseAtr.length - 1] || 0;
  const snr = latestNoiseAtr > 0 ? latestTrendAtr / latestNoiseAtr : 10;
  const regime = snr > 2 ? 'trending' : snr < 0.5 ? 'choppy' : 'balanced';

  // VCP (high/low 3-window extema, simplified)
  const last20 = recent.slice(-20);
  const highs = [], lows = [];
  for (let i = 4; i < last20.length - 4; i++) {
    let isH = true, isL = true;
    for (let j = i - 3; j <= i + 3; j++) {
      if (j === i) continue;
      if (last20[j].high >= last20[i].high) isH = false;
      if (last20[j].low <= last20[i].low) isL = false;
    }
    if (isH) highs.push(last20[i].high);
    if (isL) lows.push(last20[i].low);
  }
  let highLowPairs = 0;
  let lastH = Infinity, lastL = -Infinity;
  const minHL = Math.min(highs.length, lows.length);
  for (let i = 0; i < minHL; i++) {
    if (highs[i] < lastH && lows[i] > lastL) {
      highLowPairs++;
      lastH = highs[i];
      lastL = lows[i];
    }
  }
  const vcpDetected = highLowPairs >= cfg.vcpMinWindows;
  let volTightening = false;
  if (vcpDetected) {
    const fh = last20.slice(0, 10).reduce((a, k) => a + k.volume, 0) / 10;
    const sh = last20.slice(-10).reduce((a, k) => a + k.volume, 0) / 10;
    volTightening = sh < fh * 0.7;
  }

  // Follow-through
  const recentRange = recent.slice(-cfg.followThroughDays);
  const prevRange = recent.slice(-cfg.followThroughDays * 2, -cfg.followThroughDays);
  const recentHigh = Math.max(...recentRange.map(k => k.high));
  const prevHigh = Math.max(...prevRange.map(k => k.high));
  const isBreakout = recentHigh > prevHigh * 1.01;
  let followScore = 0, priceProgression = 0;
  if (isBreakout) {
    const closes = recentRange.map(k => k.close);
    const higher = closes.slice(1).filter((c, i) => c > closes[i]).length;
    priceProgression = closes.length > 1 ? higher / (closes.length - 1) : 0;
    const avgVol = recentRange.reduce((a, k) => a + k.volume, 0) / recentRange.length;
    const maxHighIdx = recentRange.findIndex(k => k.high === recentHigh);
    const breakoutDayVol = maxHighIdx >= 0 ? recentRange[maxHighIdx].volume : 0;
    const postVols = maxHighIdx >= 0 ? recentRange.slice(maxHighIdx + 1) : [];
    let volumeDecay = 0;
    if (breakoutDayVol > avgVol * 1.3) {
      if (postVols.length >= 2) {
        const postAvg = postVols.reduce((a, k) => a + k.volume, 0) / postVols.length;
        volumeDecay = postAvg < breakoutDayVol * 0.8 ? 0.8 : 0.4;
      } else volumeDecay = 0.4;
    } else volumeDecay = 0.2;
    followScore = volumeDecay * 0.5 + priceProgression * 0.5;
  }

  // Failure mode
  let failureMode = 'none';
  if (isSqueeze && latestNoiseAtr > latestTrendAtr * 2) failureMode = 'noisy_squeeze';
  else if (isBreakout && followScore < 0.4) failureMode = 'weak_follow_through';

  // Entry score (5 setups)
  const wasSqueeze = lastIdx > 0 && (squeezeHistory[lastIdx - 1] || false);
  const failureMaxCap = failureMode !== 'none' ? 0.4 : 1.0;
  let entryScore = 0, setupType = 'no_clear_setup', riskReward = 0;
  if (!isSqueeze && wasSqueeze && qualityScore >= 0.6 && failureMode !== 'weak_follow_through') {
    entryScore = 0.95 * failureMaxCap; setupType = 'mtf_squeeze_fire'; riskReward = 3.5;
  } else if (vcpDetected && volTightening && followScore >= 0.5 && failureMode !== 'noisy_squeeze') {
    entryScore = 0.9 * failureMaxCap; setupType = 'confirmed_vcp_breakout'; riskReward = 3.0;
  } else if (isGenuineSqueeze && qualityScore >= 0.75) {
    entryScore = 0.55 * failureMaxCap; setupType = 'genuine_squeeze_forming';
  } else if (latestNoiseAtr < latestTrendAtr * 0.5 && regime === 'trending' && followScore >= 0.6) {
    entryScore = 0.7 * failureMaxCap; setupType = 'clean_trend_expansion'; riskReward = 2.0;
  } else {
    entryScore = 0.25; setupType = 'no_clear_setup';
  }

  // 12 條 rules S1-S12
  const matchedRules = [];
  if (isSqueeze) matchedRules.push({ id: 'S1', label: '日線 Squeeze', strength: 'medium' });
  if (qualityScore >= 0.6) matchedRules.push({ id: 'S2', label: 'Squeeze 質量高', strength: 'medium' });
  if (squeezeDuration >= cfg.squeezeMinDuration) matchedRules.push({ id: 'S3', label: 'Squeeze 持續夠耐', strength: 'medium' });
  if (snr > 2) matchedRules.push({ id: 'S4', label: '趨勢 ATR 強', strength: 'strong' });
  if (snr < 0.5) matchedRules.push({ id: 'S5', label: '噪音 ATR 高', strength: 'strong' });
  const recent5Atr = noiseAtr.slice(-5).reduce((a,b) => a+b, 0) / 5;
  const prev5Atr = noiseAtr.slice(-10, -5).reduce((a,b) => a+b, 0) / 5;
  if (recent5Atr < prev5Atr * 0.85) matchedRules.push({ id: 'S6', label: '結構性收縮', strength: 'medium' });
  if (recent5Atr > prev5Atr * 1.15) matchedRules.push({ id: 'S7', label: '結構性擴張', strength: 'medium' });
  if (volumeConcentration > 0.6) matchedRules.push({ id: 'S8', label: '籌碼集中', strength: 'medium' });
  if (vcpDetected) matchedRules.push({ id: 'S9', label: 'VCP 結構', strength: 'medium' });
  if (volTightening) matchedRules.push({ id: 'S10', label: 'VCP 量縮確認', strength: 'medium' });
  if (followScore >= 0.5) matchedRules.push({ id: 'S11', label: '突破跟進', strength: 'medium' });
  if (failureMode !== 'none') matchedRules.push({ id: 'S12', label: '失敗模式 (' + failureMode + ')', strength: 'strong' });

  // Win probability
  let baseWin;
  if (setupType === 'mtf_squeeze_fire') baseWin = 0.75;
  else if (setupType === 'confirmed_vcp_breakout') baseWin = 0.70;
  else if (setupType === 'clean_trend_expansion') baseWin = 0.62;
  else if (setupType === 'genuine_squeeze_forming') baseWin = 0.50;
  else baseWin = 0.35;
  if (failureMode === 'weak_follow_through') baseWin -= 0.12;
  if (failureMode === 'noisy_squeeze') baseWin -= 0.10;
  const winProbability = Math.min(0.82, Math.max(0.25, baseWin));

  // Cycle derivation
  let cycle, cycleLabel;
  if (entryScore >= 0.8) { cycle = 'uptrend'; cycleLabel = '高質量蓄力'; }
  else if (failureMode !== 'none') { cycle = 'downtrend'; cycleLabel = '假蓄力警告'; }
  else if (regime === 'choppy') { cycle = 'sideways'; cycleLabel = '亂爆階段'; }
  else { cycle = 'sideways'; cycleLabel = '蓄力觀察'; }
  const state = cycle === 'uptrend' ? 'UP' : cycle === 'downtrend' ? 'DOWN' : 'SIDEWAYS';

  // 大少 2026-08-11 — Module Warning System v1.0.0 (Phase 5c) — M6 Volatility
  const m6Warnings = [];
  // ATR% > 30% outlier
  const currentPrice = recent[recent.length - 1]?.close || 1;
  const atrPct = (latestNoiseAtr / currentPrice) * 100;
  if (atrPct > 30) {
    m6Warnings.push(makeWarning('warning', 'M6', 'OUTLIER_VALUE',
      `ATR% > 30% 極端波動 (${atrPct.toFixed(1)}%)`,
      {
        issue: `ATR% = ${atrPct.toFixed(1)}% > 30% (極端波動)`,
        impact: '波動率 verdict 唔可信, squeeze/breakout 判斷可能誤判',
        fix: '可能係股票特殊事件 (拆股/復牌/業績), 排除該日 kline 或增加 dataWindowDays',
        context: { atr_pct: atrPct, current_price: currentPrice, latest_noise_atr: latestNoiseAtr },
      }
    ));
  }
  // FALLBACK_USED: matchedRules 0 個
  if (matchedRules.length === 0) {
    m6Warnings.push(makeWarning('warning', 'M6', 'FALLBACK_USED',
      '波動率 rule 全部 fail, fallback SIDEWAYS',
      {
        issue: 'matchedRules.length = 0 (波動率 setup 全部 fail)',
        impact: 'M6 verdict 默認 SIDEWAYS, 對 M7 影响有限',
        fix: '正常, 屬於橫行市況; 如果市況明顯波動但 verdict SIDEWAYS, 檢查 kline data',
        context: { matched_rules: 0, atr_pct: atrPct },
      }
    ));
  }

  return {
    moduleId: 'volatility', timeframe: options.period || '1d', state, confidence: Math.round(entryScore * 10000) / 10000,
    interpretation: matchedRules.length > 0 ? matchedRules.map(r => r.label).join('；') : '無明確波動率信號',
    evidence: matchedRules.map(r => ({ type: 'rule-' + r.id, label: r.label, value: r.id, passed: true })),
    warnings: m6Warnings,
    _warnings: m6Warnings,  // 大少 2026-08-11 v1.0.0
    meta: {
      cycle, cycleLabel, setupType, riskReward,
      entryScore: Math.round(entryScore * 10000) / 10000,
      winProbability: Math.round(winProbability * 10000) / 10000,
      failureMode,
      squeeze: { isSqueeze, duration: squeezeDuration, qualityScore: Math.round(qualityScore * 10000) / 10000, isGenuine: isGenuineSqueeze },
      vcpStructure: { detected: vcpDetected, highLowPairs, volTightening },
      atrDecomposition: {
        totalAtr: Math.round(atrValue * 100) / 100,
        trendAtr: Math.round(latestTrendAtr * 100) / 100,
        noiseAtr: Math.round(latestNoiseAtr * 100) / 100,
        snr: Math.round(snr * 100) / 100, regime,
      },
      followThrough: { followScore: Math.round(followScore * 100) / 100, volumeDecay: 0, priceProgression: Math.round(priceProgression * 100) / 100 },
      matchedRules: matchedRules.map(r => r.id),
      ruleLabels: matchedRules.map(r => r.label),
      rulesFired: matchedRules.length,
      atr: Math.round(atrValue * 100) / 100,
      bbWidth: Math.round((bbUpper[lastIdx] - bbLower[lastIdx]) * 100) / 100,
      kcWidth: Math.round((kcUpper[lastIdx] - kcLower[lastIdx]) * 100) / 100,
      priceCV: Math.round(priceCV * 10000) / 10000,
      volumeConcentration: Math.round(volumeConcentration * 10000) / 10000,
      configUsed: cfg, dataDays: n,
    },
    timestamp: Date.now(),
  };
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
  const color = stateColors[verdict.state] || '#666';
  const stateLabel = stateLabels[verdict.state] || verdict.state;
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
        <strong>📌 波動率結構：</strong>${verdict.interpretation}
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
function calcATR(klines, period) {
  if (klines.length < period + 1) return 0;
  const trs = [];
  for (let i = period; i < klines.length; i++) {
    const curr = klines[i];
    const prev = klines[i - 1];
    const tr1 = curr.high - curr.low;
    const tr2 = Math.abs(curr.high - prev.close);
    const tr3 = Math.abs(curr.low - prev.close);
    trs.push(Math.max(tr1, tr2, tr3));
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

// 識別 peak/trough
function detectExtremes(klines, window) {
  const peaks = [];
  const troughs = [];
  for (let i = window; i < klines.length - window; i++) {
    const curr = klines[i].weightedPrice;
    const leftW = klines.slice(i - window, i).map(k => k.weightedPrice);
    const rightW = klines.slice(i + 1, i + window + 1).map(k => k.weightedPrice);
    const leftMax = Math.max(...leftW);
    const rightMax = Math.max(...rightW);
    const leftMin = Math.min(...leftW);
    const rightMin = Math.min(...rightW);

    if (curr > leftMax && curr > rightMax) {
      peaks.push(i);
    } else if (curr < leftMin && curr < rightMin) {
      troughs.push(i);
    }
  }
  return { peaks, troughs };
}

// 交替化 peak/trough
function alternateExtremes(klines, peakIdxs, troughIdxs) {
  const all = [
    ...peakIdxs.map(i => ({ idx: i, type: 'peak', k: klines[i] })),
    ...troughIdxs.map(i => ({ idx: i, type: 'trough', k: klines[i] })),
  ].sort((a, b) => a.idx - b.idx);

  const result = [];
  for (const e of all) {
    const last = result[result.length - 1];
    if (!last) {
      result.push(e);
    } else if (last.type === e.type) {
      // 同類型,留比較顯著嗰個
      if (e.type === 'peak' && e.k.high > last.k.high) {
        result[result.length - 1] = e;
      } else if (e.type === 'trough' && e.k.low < last.k.low) {
        result[result.length - 1] = e;
      }
    } else {
      result.push(e);
    }
  }
  return result;
}

// 趨勢分析
function analyzeTrend(values, tolerance) {
  if (values.length < 2) return { trend: 'mixed', consistency: 0 };
  let risingCount = 0, fallingCount = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[i - 1]) risingCount++;
    else if (values[i] < values[i - 1]) fallingCount++;
  }
  const totalDiff = values.length - 1;
  const risingPct = risingCount / totalDiff;
  const fallingPct = fallingCount / totalDiff;
  const consistency = Math.max(risingPct, fallingPct);
  const startVal = values[0];
  const endVal = values[values.length - 1];
  const overallChange = (endVal - startVal) / startVal;

  if (risingPct >= 0.7 && overallChange > tolerance) {
    return { trend: 'rising', consistency };
  } else if (fallingPct >= 0.7 && overallChange < -tolerance) {
    return { trend: 'falling', consistency };
  } else if (consistency > 0.6 && Math.abs(overallChange) < tolerance) {
    return { trend: 'flat', consistency };
  }
  return { trend: 'mixed', consistency };
}

// Main analyze function (vanilla JS port of modules/hl-structure.ts)
async function analyzeHLStructure(klines, options) {
  const cfg = { ...DEFAULT_HL_STRUCTURE_CONFIG, ...(options.hlsOverrides || {}) };
  const n = klines.length;

  // 數據驗證
  const minRequired = Math.max(
    (cfg.baseWindow * 2 + 1) * cfg.minPairs * 3,
    cfg.atrPeriod + cfg.baseWindow * 4,
    cfg.breakoutConfirmDays + cfg.baseWindow * 4,
  );
  if (n < minRequired) {
    throw new Error(`[HLStructure] Insufficient data: need ≥ ${minRequired} bars, got ${n}`);
  }

  const window = options.dataWindowDays ? Math.min(options.dataWindowDays, n) : n;
  const recent = klines.slice(-window);

  // Step 1: ATR + 自適應 window
  const atr = cfg.enableAtrWindow ? calcATR(recent, cfg.atrPeriod) : 0;
  const last20Closes = recent.slice(-20).map(k => k.close);
  const avgClose = last20Closes.reduce((a, b) => a + b, 0) / last20Closes.length;
  const volatilityRatio = avgClose > 0 ? atr / avgClose : 0;
  const adaptiveWindow = cfg.enableAtrWindow
    ? Math.max(2, Math.min(15, Math.round(cfg.baseWindow * (1 + volatilityRatio * 20))))
    : cfg.baseWindow;

  // Step 2: 加權價 + 動態 tolerance
  const weighted = recent.map(k => ({
    ...k,
    weightedPrice: (k.high + k.low + k.close * 2) / 4,
  }));
  let effectiveTolerance = cfg.tolerancePct;
  if (avgClose < 10) effectiveTolerance = Math.max(cfg.tolerancePct, 0.03);
  else if (avgClose > 500) effectiveTolerance = Math.min(cfg.tolerancePct, 0.008);

  // Step 3: 識別極值
  const { peaks: peakIdxs, troughs: troughIdxs } = detectExtremes(weighted, adaptiveWindow);

  if (peakIdxs.length === 0 && troughIdxs.length === 0) {
    return {
      symbol: options.code || 'TEST',
      cycle: 'sideways',
      cycle_label: '橫行週期',
      confidence: 0.3,
      base_confidence: 0.3,
      peaks: [], troughs: [],
      peak_trend: 'mixed', trough_trend: 'mixed',
      structure_score: 0, weighted_structure_score: 0,
      box_boundary: null,
      pattern_alert: 'none',
      latest_extreme: null,
      price_position: 'between',
      adaptive_window: adaptiveWindow,
      effective_tolerance: effectiveTolerance,
      adjustment_log: ['價格完全無變化,無法識別峰谷'],
      reason: '價格完全無變化,預設橫行',
      last_date: String(recent[recent.length - 1].timestamp || recent[recent.length - 1].date || ''),
    };
  }

  // Step 4: 突破確認 + Step 5: 量能過濾
  const alternated = alternateExtremes(weighted, peakIdxs, troughIdxs);
  const K = cfg.breakoutConfirmDays;
  for (const e of alternated) {
    const afterEnd = Math.min(e.idx + 1 + K, weighted.length - 1);
    const after = weighted.slice(e.idx + 1, afterEnd + 1);
    if (after.length === 0) continue;
    if (e.type === 'peak') {
      e.confirmed = after.every(c => c.close > e.k.close * (1 + effectiveTolerance));
    } else {
      e.confirmed = after.every(c => c.close < e.k.close * (1 - effectiveTolerance));
    }
    // 量能
    if (cfg.enableVolumeFilter) {
      const lookbackStart = Math.max(0, e.idx - cfg.volumeLookback);
      const slice = weighted.slice(lookbackStart, e.idx);
      const avgVol = slice.length > 0 ? slice.reduce((a, b) => a + b.volume, 0) / slice.length : 0;
      e.volumeRatio = avgVol > 0 ? e.k.volume / avgVol : 0;
      e.weight = 1.0;
      if (e.volumeRatio < cfg.volumeConfirmRatio) e.weight *= cfg.volumeShrinkWeightMultiplier;
      else if (e.volumeRatio > cfg.volumeBoostRatio) e.weight *= cfg.volumeBoostWeightMultiplier;
    } else {
      e.weight = 1.0;
      e.volumeRatio = 0;
    }
  }

  if (alternated.length < cfg.minPairs * 2) {
    // 2026-08-07 — Graceful handle (real-world K 線 noise 大): 返 SIDEWAYS verdict 0.5 唔 throw
    return {
      symbol: options.code || 'TEST',
      cycle: 'sideways',
      cycle_label: '橫行週期',
      confidence: 0.5,
      base_confidence: 0.5,
      peaks: [], troughs: [],
      peak_trend: 'mixed', trough_trend: 'mixed',
      structure_score: 0, weighted_structure_score: 0,
      box_boundary: null,
      pattern_alert: 'none',
      latest_extreme: null,
      price_position: 'between',
      adaptive_window: adaptiveWindow,
      effective_tolerance: effectiveTolerance,
      adjustment_log: [`峰谷結構唔夠清晰 (${alternated.length} < ${cfg.minPairs * 2})`],
      reason: `峰谷結構唔夠清晰 (只有 ${alternated.length} 個交替峰谷,需要至少 ${cfg.minPairs * 2}),預設橫行`,
      last_date: String(recent[recent.length - 1].timestamp || recent[recent.length - 1].date || ''),
    };
  }

  // Step 7: 提取最近 N 對
  const peakExts = alternated.filter(e => e.type === 'peak').slice(-cfg.minPairs);
  const troughExts = alternated.filter(e => e.type === 'trough').slice(-cfg.minPairs);

  // Step 8: 時間衰減
  const lastIdx = weighted.length - 1;
  for (const e of [...peakExts, ...troughExts]) {
    const daysAgo = lastIdx - e.idx;
    e.weight *= Math.exp(-cfg.timeDecayLambda * daysAgo);
  }

  // Step 9: 趨勢分析
  const peakTrend = analyzeTrend(peakExts.map(e => e.k.close), effectiveTolerance);
  const troughTrend = analyzeTrend(troughExts.map(e => e.k.close), effectiveTolerance);

  // Step 10: 結構分數
  let candidate, structureScore, weightedStructureScore;
  const avgConsistency = (peakTrend.consistency + troughTrend.consistency) / 2;
  if (peakTrend.trend === 'rising' && troughTrend.trend === 'rising') {
    candidate = 'uptrend';
    structureScore = avgConsistency;
    weightedStructureScore = avgConsistency;
  } else if (peakTrend.trend === 'falling' && troughTrend.trend === 'falling') {
    candidate = 'downtrend';
    structureScore = -avgConsistency;
    weightedStructureScore = -avgConsistency;
  } else {
    candidate = 'sideways';
    const rawPeakCons = Math.abs(peakTrend.consistency);
    const rawTroughCons = Math.abs(troughTrend.consistency);
    structureScore = 1.0 - (rawPeakCons + rawTroughCons) / 2;
    weightedStructureScore = structureScore;
  }

  // Step 11: 基礎信心
  let baseConfidence;
  if (candidate === 'uptrend' || candidate === 'downtrend') {
    baseConfidence = (weightedStructureScore + 1) / 2;
    baseConfidence = Math.max(0, Math.min(1, baseConfidence));
    const pairBonus = Math.min(1, (peakExts.length - 2) / 3);
    baseConfidence = baseConfidence * 0.7 + pairBonus * 0.3;
  } else {
    const allCloses = [...peakExts.map(e => e.k.close), ...troughExts.map(e => e.k.close)];
    const rangeMax = Math.max(...allCloses);
    const rangeMin = Math.min(...allCloses);
    const avgAll = allCloses.reduce((a, b) => a + b, 0) / allCloses.length;
    const rangePct = avgAll > 0 ? (rangeMax - rangeMin) / avgAll : 0;
    baseConfidence = Math.max(0.3, 1.0 - rangePct / (effectiveTolerance * 4));
  }

  // Step 12: 箱體
  let boxBoundary = null;
  if (candidate === 'sideways') {
    const boxTop = Math.max(...peakExts.map(e => e.k.close));
    const boxBottom = Math.min(...troughExts.map(e => e.k.close));
    const boxMid = (boxTop + boxBottom) / 2;
    const boxHeightPct = boxMid > 0 ? (boxTop - boxBottom) / boxMid : 0;
    boxBoundary = {
      top: round(boxTop, 2), bottom: round(boxBottom, 2),
      mid: round(boxMid, 2), height_pct: round(boxHeightPct, 4),
    };
  }

  // Step 13: 形態預警
  let patternAlert = 'none';
  let reasonBase = `判定: ${candidate === 'uptrend' ? '上升' : candidate === 'downtrend' ? '下跌' : '橫行'}`;
  if (cfg.enablePatternAlert && peakExts.length >= 3 && troughExts.length >= 2) {
    const symTol = effectiveTolerance * cfg.patternSymmetryTolerance;
    if (peakExts.length >= 3) {
      const last3 = peakExts.slice(-3);
      if (last3[1].k.close > last3[0].k.close && last3[1].k.close > last3[2].k.close &&
          Math.abs(last3[0].k.close - last3[2].k.close) / last3[1].k.close < symTol) {
        patternAlert = 'head_and_shoulder';
        reasonBase += '；出現頭肩頂形態預警';
      }
    }
    if (patternAlert === 'none' && troughExts.length >= 3) {
      const last3 = troughExts.slice(-3);
      if (Math.abs(last3[0].k.close - last3[2].k.close) / last3[1].k.close < symTol &&
          last3[1].k.close > last3[0].k.close) {
        patternAlert = 'double_bottom';
        reasonBase += '；出現雙底形態預警';
      }
    }
    if (patternAlert === 'none' && peakExts.length >= 3) {
      const last3 = peakExts.slice(-3);
      if (Math.abs(last3[0].k.close - last3[2].k.close) / last3[1].k.close < symTol &&
          last3[1].k.close < last3[0].k.close) {
        patternAlert = 'double_top';
        reasonBase += '；出現雙頂形態預警';
      }
    }
  }

  // Step 14: 價格位置
  const latestPrice = weighted[weighted.length - 1].close;
  const latestPeak = peakExts[peakExts.length - 1];
  const latestTrough = troughExts[troughExts.length - 1];
  const latestExtreme = alternated[alternated.length - 1];
  const daysAgo = lastIdx - latestExtreme.idx;

  let pricePosition;
  if (latestPrice > latestPeak.k.close * (1 + effectiveTolerance)) pricePosition = 'above_peak';
  else if (latestPrice < latestTrough.k.close * (1 - effectiveTolerance)) pricePosition = 'below_trough';
  else if (latestPrice >= latestTrough.k.close && latestPrice <= latestPeak.k.close) pricePosition = 'between';
  else pricePosition = 'broken';

  const adjustmentLog = [];
  let confidenceMultiplier = 1.0;

  if (candidate === 'uptrend') {
    if (pricePosition === 'below_trough') {
      adjustmentLog.push('當前價格跌破最近谷點,上升趨勢可能已破壞');
      confidenceMultiplier *= 0.4;
    } else if (pricePosition === 'between' && latestExtreme.type === 'peak') {
      adjustmentLog.push('價格處於回調階段,尚未確認趨勢延續');
      confidenceMultiplier *= 0.85;
    }
  } else if (candidate === 'downtrend') {
    if (pricePosition === 'above_peak') {
      adjustmentLog.push('當前價格突破最近峰點,下跌趨勢可能已反轉');
      confidenceMultiplier *= 0.4;
    } else if (pricePosition === 'between' && latestExtreme.type === 'trough') {
      adjustmentLog.push('價格處於反彈階段,尚未確認趨勢延續');
      confidenceMultiplier *= 0.85;
    }
  } else {
    if (pricePosition === 'above_peak') {
      adjustmentLog.push('價格突破箱體上沿,可能即將脫離橫行');
      confidenceMultiplier *= 0.7;
    } else if (pricePosition === 'below_trough') {
      adjustmentLog.push('價格跌破箱體下沿,可能即將脫離橫行');
      confidenceMultiplier *= 0.7;
    }
  }

  // Step 15: 新鮮度
  if (daysAgo > cfg.maxExtremeAgeDays) {
    const freshness = Math.max(
      cfg.freshnessMinMultiplier,
      1.0 - (daysAgo - cfg.maxExtremeAgeDays) / cfg.freshnessDecayDays,
    );
    confidenceMultiplier *= freshness;
    adjustmentLog.push(`最新極值點距今 ${daysAgo} 天,結構信號老化`);
  }

  // Step 17: 綜合信心
  const confidence = Math.max(0, Math.min(1, baseConfidence * confidenceMultiplier));

  const cycleLabel = candidate === 'uptrend' ? '上升週期'
    : candidate === 'downtrend' ? '下跌週期' : '橫行週期';

  const finalReason = adjustmentLog.length > 0
    ? `${reasonBase}；${adjustmentLog.join('；')}`
    : reasonBase;

  // 大少 2026-08-11 — Module Warning System v1.0.0 (Phase 5c) — M2 HL Structure
  const m2Warnings = [];
  // peaks + troughs 都係 0
  if (peakExts.length === 0 && troughExts.length === 0) {
    m2Warnings.push(makeWarning('critical', 'M2', 'VERDICT_MISSING',
      '峰谷全部拎唔到',
      {
        issue: 'peakExts.length = 0 AND troughExts.length = 0',
        impact: 'M2 verdict fallback SIDEWAYS, 對 M7 综合判定偏差',
        fix: '增加 dataWindowDays 設定 (e.g. count=200), 確認 data 有高低點變化',
        context: { peak_count: 0, trough_count: 0, period: options.period },
      }
    ));
  }
  // 識別峰谷 < cfg.minLinePoints
  if (peakExts.length + troughExts.length < cfg.minPairs * 2) {
    m2Warnings.push(makeWarning('warning', 'M2', 'FALLBACK_USED',
      `峰谷總數 ${peakExts.length + troughExts.length} < ${cfg.minPairs * 2}`,
      {
        issue: `峰谷總數 ${peakExts.length + troughExts.length} < ${cfg.minPairs * 2} required`,
        impact: '結構判斷唔夠 pairs, 對 cycle 判定有偏差',
        fix: '增加 dataWindowDays 拎更多峰谷',
        context: { peak_count: peakExts.length, trough_count: troughExts.length, min_pairs: cfg.minPairs },
      }
    ));
  }

  return {
    symbol: options.code || 'TEST',
    cycle: candidate,
    cycle_label: cycleLabel,
    confidence: round(confidence, 4),
    base_confidence: round(baseConfidence, 4),
    peaks: peakExts.map(e => ({
      date: String(e.k.timestamp || e.k.date || ''),
      close: e.k.close, high: e.k.high, low: e.k.low, index: e.idx,
      volume: e.k.volume, confirmed: e.confirmed || false, weight: round(e.weight || 1, 4),
    })),
    troughs: troughExts.map(e => ({
      date: String(e.k.timestamp || e.k.date || ''),
      close: e.k.close, high: e.k.high, low: e.k.low, index: e.idx,
      volume: e.k.volume, confirmed: e.confirmed || false, weight: round(e.weight || 1, 4),
    })),
    peak_trend: peakTrend.trend,
    trough_trend: troughTrend.trend,
    structure_score: round(structureScore, 4),
    weighted_structure_score: round(weightedStructureScore, 4),
    box_boundary: boxBoundary,
    pattern_alert: patternAlert,
    latest_extreme: {
      type: latestExtreme.type,
      date: String(latestExtreme.k.timestamp || latestExtreme.k.date || ''),
      close: latestExtreme.k.close, index: latestExtreme.idx, days_ago: daysAgo,
      confirmed: latestExtreme.confirmed || false,
    },
    price_position: pricePosition,
    adaptive_window: adaptiveWindow,
    effective_tolerance: round(effectiveTolerance, 6),
    adjustment_log: adjustmentLog,
    reason: finalReason,
    last_date: String(recent[recent.length - 1].timestamp || recent[recent.length - 1].date || ''),
    _warnings: m2Warnings,  // 大少 2026-08-11 v1.0.0
  };
}

function renderHLStructureResult(verdict) {
  const cycleColor = verdict.cycle === 'uptrend' ? '#26BA75' : verdict.cycle === 'downtrend' ? '#EE5151' : '#F39C12';
  const confidencePct = (verdict.confidence * 100).toFixed(0);
  const confidenceExplain = verdict.confidence >= 0.7 ? '高信心, 信號強' : verdict.confidence >= 0.4 ? '中等信心, 信號一般' : '低信心, 信號弱';

  const patternText = {
    'head_and_shoulder': '⚠️ 頭肩頂 (可能見頂)',
    'double_bottom': '✓ 雙底 (可能見底)',
    'double_top': '⚠️ 雙頂 (可能見頂)',
    'none': '無形態預警',
  }[verdict.pattern_alert] || '無形態預警';

  // 📌 判斷 box 詳細解說 (plain language)
  const interpretationDetail = verdict.cycle === 'uptrend' ? `
    <p>📌 <strong>簡單講</strong>: 股票峰谷結構係「越嚟越高」, 即每個 peak 高過上一個 peak (HH), 每個 trough 都高過上一個 trough (HL), 典型上升趨勢嘅結構。</p>
    <p>📊 <strong>咩意思</strong>: 結構分數 ${verdict.structure_score} 反映峰谷上升嘅一致度, 識別咗 ${verdict.peaks.length} 個峰點 + ${verdict.troughs.length} 個谷點, 趨勢結構清晰。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 上升趨勢確認, 可考慮持有 / 逢回調加倉。留意 ${patternText} 嘅預警 — 見頂形態出現要考慮減倉。</p>
  ` : verdict.cycle === 'downtrend' ? `
    <p>📌 <strong>簡單講</strong>: 股票峰谷結構係「越嚟越低」, 即每個 peak 低過上一個 peak (LH), 每個 trough 都低過上一個 trough (LL), 典型下跌趨勢嘅結構。</p>
    <p>📊 <strong>咩意思</strong>: 結構分數 ${verdict.structure_score} 反映峰谷下跌嘅一致度, 識別咗 ${verdict.peaks.length} 個峰點 + ${verdict.troughs.length} 個谷點, 趨勢結構清晰。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 下跌趨勢確認, 觀望 / 減倉。留意 ${patternText} 嘅預警 — 見底形態出現可能係反彈機會。</p>
  ` : `
    <p>📌 <strong>簡單講</strong>: 股票峰谷結構唔係典型嘅多頭或空頭, 峰同谷都喺同一個範圍內, 代表近期股價喺一個箱體入面震盪。</p>
    <p>📊 <strong>咩意思</strong>: 結構分數 ${verdict.structure_score} 反映結構混亂度, 識別咗 ${verdict.peaks.length} 個峰點 + ${verdict.troughs.length} 個谷點, 等待方向確認。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 橫行結構, 等待方向確認。配合 M6 Volatility Squeeze 訊號可以捕捉突破時機; ${patternText} 仍然要留意。</p>
  `;

  return `
    <div class="as03-verdict as03-module-card">
      <div class="module-card-header">
        <h3 class="module-header">📊 高低點結構法 (Peak-Trough Structure)</h3>
      </div>
      <div class="verdict-header">
        <div class="state-pill" style="background: ${cycleColor}">
          <span class="state-label">${verdict.cycle_label}</span>
          <span class="state-code">${verdict.cycle.toUpperCase()}</span>
        </div>
        <div class="confidence">
          <div class="conf-pct">${confidencePct}%</div>
          <div class="conf-label">信心指數 — ${confidenceExplain}</div>
        </div>
        <div class="data-summary">
          <div class="summary-row"><span>峰點:</span> <strong>${verdict.peaks.length}</strong></div>
          <div class="summary-row"><span>谷點:</span> <strong>${verdict.troughs.length}</strong></div>
          <div class="summary-row"><span>結構分數:</span> <strong>${verdict.structure_score}</strong></div>
        </div>
      </div>

      <div class="interpretation">
        <strong>📌 判斷：</strong>${verdict.reason}
        ${interpretationDetail}
      </div>

      ${verdict.box_boundary ? `
      <div class="box-boundary">
        <h4>📦 箱體邊界 (橫行時)</h4>
        <div class="box-grid">
          <div class="box-item"><span class="box-label">上沿</span><span class="box-value">${verdict.box_boundary.top}</span></div>
          <div class="box-item"><span class="box-label">中軸</span><span class="box-value">${verdict.box_boundary.mid}</span></div>
          <div class="box-item"><span class="box-label">下沿</span><span class="box-value">${verdict.box_boundary.bottom}</span></div>
          <div class="box-item"><span class="box-label">箱高 %</span><span class="box-value">${(verdict.box_boundary.height_pct * 100).toFixed(2)}%</span></div>
        </div>
      </div>
      ` : ''}

      <div class="pattern-alert">
        <h4>🔍 形態預警</h4>
        <p class="pattern-text">${patternText}</p>
      </div>

      <div class="position-info">
        <h4>📍 當前價格位置</h4>
        <p>位置: <strong>${verdict.price_position}</strong> · 自適應 Window: ${verdict.adaptive_window} · 動態 Tolerance: ${(verdict.effective_tolerance * 100).toFixed(2)}%</p>
      </div>

      ${renderDetailedExplanation(verdict)}

      ${renderStrategyAdvice(verdict)}

      ${renderUsageGuide(verdict)}

      <details class="meta-details">
        <summary>🔧 技術細節（debug 用）</summary>
        <pre>峰序列趨勢: ${verdict.peak_trend}
谷序列趨勢: ${verdict.trough_trend}
加權結構分數: ${verdict.weighted_structure_score}
基礎信心: ${verdict.base_confidence}
最終信心: ${verdict.confidence}
${verdict.adjustment_log.length > 0 ? '\n調整記錄:\n' + verdict.adjustment_log.map(s => '  • ' + s).join('\n') : ''}</pre>
      </details>
    </div>
  `;
}

// ===== 詳細解讀 section =====
// 用人話逐一解釋 verdict 每個 field 嘅意思
function renderDetailedExplanation(verdict) {
  const confidencePct = (verdict.confidence * 100).toFixed(0);
  const structurePct = (Math.abs(verdict.structure_score) * 100).toFixed(0);
  const structureLabel = verdict.cycle === 'uptrend' ? '上升一致度' : verdict.cycle === 'downtrend' ? '下跌一致度' : '橫行緊密度';

  const peakTrendLabel = {
    'rising': '📈 越嚟越高 (上升中)',
    'falling': '📉 越嚟越低 (下跌中)',
    'flat': '➡️ 差唔多 (橫行中)',
    'mixed': '🌪️ 混合 (冇明確方向)',
  }[verdict.peak_trend] || verdict.peak_trend;

  const troughTrendLabel = {
    'rising': '📈 越嚟越高 (上升中)',
    'falling': '📉 越嚟越低 (下跌中)',
    'flat': '➡️ 差唔多 (橫行中)',
    'mixed': '🌪️ 混合 (冇明確方向)',
  }[verdict.trough_trend] || verdict.trough_trend;

  return `
    <div class="detailed-explanation">
      <h4>📖 詳細解讀 (逐個 field 點樣睇)</h4>
      <table class="explain-table">
        <tr><td class="field-name">📊 cycle (週期類型)</td><td><strong>${verdict.cycle_label}</strong> — ${verdict.cycle === 'uptrend' ? '山頂同山谷一齊越嚟越高' : verdict.cycle === 'downtrend' ? '山頂同山谷一齊越嚟越低' : '山頂山谷塞喺範圍內'}</td></tr>
        <tr><td class="field-name">🎯 confidence (信心指數 ${confidencePct}%)</td><td>${confidencePct >= 70 ? '🟢 高信心 — 判定可靠,可以作參考' : confidencePct >= 50 ? '🟡 中信心 — 有參考價值但要再 confirm' : '🔴 低信心 — 信唔過,等下一個更明顯信號'}</td></tr>
        <tr><td class="field-name">📐 structure_score (${structureLabel} ${structurePct}%)</td><td>${verdict.cycle === 'sideways' ? '越接近 0 越一致,即山頂山谷排列越規律' : '正數 = 一致向上 / 負數 = 一致向下,絕對值越大越穩'}</td></tr>
        <tr><td class="field-name">🏔️ 峰序列趨勢</td><td>${peakTrendLabel} — 比較最近幾個 peak (山頂) 嘅高低</td></tr>
        <tr><td class="field-name">🕳️ 谷序列趨勢</td><td>${troughTrendLabel} — 比較最近幾個 trough (山谷) 嘅高低</td></tr>
        <tr><td class="field-name">📊 峰點 (${verdict.peaks.length} 個)</td><td>識別到嘅山頂,有 confirmed (確認突破) 同 weight (重要性) 標記</td></tr>
        <tr><td class="field-name">📊 谷點 (${verdict.troughs.length} 個)</td><td>識別到嘅山谷,同樣有 confirmed 同 weight</td></tr>
        ${verdict.box_boundary ? `<tr><td class="field-name">📦 箱體邊界</td><td>上沿 ${verdict.box_boundary.top} / 中軸 ${verdict.box_boundary.mid} / 下沿 ${verdict.box_boundary.bottom} — 橫行範圍</td></tr>` : ''}
        <tr><td class="field-name">🔍 形態預警</td><td>${verdict.pattern_alert === 'none' ? '✅ 無特殊形態' : verdict.pattern_alert === 'head_and_shoulder' ? '⚠️ 頭肩頂 — 可能見頂' : verdict.pattern_alert === 'double_bottom' ? '✓ 雙底 — 可能見底' : '⚠️ 雙頂 — 可能見頂'}</td></tr>
        <tr><td class="field-name">📍 當前價格位置</td><td><strong>${verdict.price_position}</strong> — ${verdict.price_position === 'above_peak' ? '升穿最近峰位,突破中' : verdict.price_position === 'below_trough' ? '跌穿最近谷位,下行中' : verdict.price_position === 'between' ? '塞喺峰谷之間' : '已經中斷結構'}</td></tr>
        <tr><td class="field-name">🔧 自適應 Window</td><td>${verdict.adaptive_window} 日 — 根據股價波動自動調,大波動用大 window</td></tr>
        <tr><td class="field-name">📏 動態 Tolerance</td><td>${(verdict.effective_tolerance * 100).toFixed(2)}% — 平股放寬 / 貴股收緊</td></tr>
        <tr><td class="field-name">📅 最新峰谷距今</td><td>${verdict.latest_extreme ? verdict.latest_extreme.days_ago + ' 日' : 'N/A'} — 超過 20 日會打折</td></tr>
      </table>
    </div>
  `;
}

// ===== 策略建議 section =====
// 根據 cycle state + 形態預警 + confidence 建議 action
function renderStrategyAdvice(verdict) {
  const confidencePct = (verdict.confidence * 100).toFixed(0);
  const isHighConf = verdict.confidence >= 0.7;
  const isLowConf = verdict.confidence < 0.5;

  let stateAdvice = '';
  if (verdict.cycle === 'uptrend') {
    stateAdvice = `
      <div class="strategy-up">
        <h4>🟢 上升趨勢 · 策略建議</h4>
        <p><strong>基本動作:</strong>順勢而行,持倉或慢慢加倉</p>
        <p><strong>風險管理:</strong>留意最新 trough 嗰個谷位 ($${verdict.troughs.length > 0 ? verdict.troughs[verdict.troughs.length - 1].close.toFixed(2) : 'N/A'}),如果價跌穿呢個位就可能見頂,要收緊止損</p>
        <p><strong>進場訊號:</strong>如果當前價回調到 trough 附近再反彈,係低吸嘅好時機</p>
        <p><strong>出場訊號:</strong>形態預警 ${verdict.pattern_alert === 'head_and_shoulder' || verdict.pattern_alert === 'double_top' ? '見頂 (頭肩頂/雙頂) — 準備走' : verdict.pattern_alert === 'double_bottom' ? '反而見底訊號 (雙底) — 確認反轉' : '無'}</p>
      </div>
    `;
  } else if (verdict.cycle === 'downtrend') {
    stateAdvice = `
      <div class="strategy-down">
        <h4>🔴 下跌趨勢 · 策略建議</h4>
        <p><strong>基本動作:</strong>避開 / 考慮減倉</p>
        <p><strong>風險管理:</strong>留意最新 peak 嗰個峰位 ($${verdict.peaks.length > 0 ? verdict.peaks[verdict.peaks.length - 1].close.toFixed(2) : 'N/A'}),如果價升穿呢個位就可能要見底,準備止損</p>
        <p><strong>進場訊號:</strong>如果當前價反彈到 peak 附近再回落,係做空嘅機會</p>
        <p><strong>出場訊號:</strong>形態預警 ${verdict.pattern_alert === 'double_bottom' ? '見底 (雙底) — 準備反轉' : verdict.pattern_alert === 'head_and_shoulder' ? '⚠️ 但留意頭肩頂 — 趨勢可能改' : '無'}</p>
      </div>
    `;
  } else {
    const box = verdict.box_boundary;
    stateAdvice = `
      <div class="strategy-sideways">
        <h4>🟡 橫行趨勢 · 策略建議</h4>
        <p><strong>基本動作:</strong>等方向,等突破</p>
        ${box ? `<p><strong>關鍵位:</strong>箱頂 ${box.top} (升穿 = 確認上升) / 箱底 ${box.bottom} (跌穿 = 確認下跌)</p>` : ''}
        <p><strong>進場策略:</strong>唔好喺箱中間進場,等突破後順勢入場 (升穿箱頂做多 / 跌穿箱底做空)</p>
        <p><strong>止損:</strong>如果進場做多但跌返入箱中間,即 false break,止損</p>
        <p><strong>形態預警:</strong>${verdict.pattern_alert === 'none' ? '無特別形態,等方向' : verdict.pattern_alert === 'head_and_shoulder' || verdict.pattern_alert === 'double_top' ? '⚠️ 見頂形態 — 突破向下機會大' : '✓ 見底形態 — 突破向上機會大'}</p>
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
    for (const p of verdict.peaks || []) {
      markers.push({
        time: normalizeTimeForMarker(p.date),
        position: 'aboveBar',
        color: '#EE5151',
        shape: 'arrowDown',
        text: `峰 ${p.close.toFixed(1)}`,
      });
    }
    for (const t of verdict.troughs || []) {
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
  if (verdict.box_boundary && chart.priceLines) {
    try {
      chart.priceLines.top = series.createPriceLine({
        price: verdict.box_boundary.top,
        color: '#F39C12', lineWidth: 1, lineStyle: 2,
        axisLabelVisible: true, title: '箱頂',
      });
      chart.priceLines.mid = series.createPriceLine({
        price: verdict.box_boundary.mid,
        color: '#888', lineWidth: 1, lineStyle: 3,
        axisLabelVisible: true, title: '中軸',
      });
      chart.priceLines.bottom = series.createPriceLine({
        price: verdict.box_boundary.bottom,
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

export async function analyzeTrendline(klines, options = {}) {
  const cfg = { ...DEFAULT_TRENDLINE_CONFIG, ...(options.trendlineConfig || {}) };
  const n = klines.length;

  // Step 1: 數據驗證
  const minRequired = 30;
  if (n < minRequired) {
    throw new Error(
      `[Trendline] Insufficient data: need ≥ ${minRequired} bars, got ${n}`,
    );
  }

  const dataWindowDays = options.dataWindowDays ?? n;
  const recent = klines.slice(-Math.min(dataWindowDays, n));
  const recentN = recent.length;

  // Step 2: 識別極值點 (peaks + troughs)
  const peaks = [];
  const troughs = [];
  const halfWindow = cfg.extremeWindow;

  for (let i = halfWindow; i < recentN - halfWindow; i++) {
    const curr = recent[i];
    let isPeak = true;
    let isTrough = true;
    for (let j = i - halfWindow; j <= i + halfWindow; j++) {
      if (j === i) continue;
      if (curr.high <= recent[j].high) isPeak = false;
      if (curr.low >= recent[j].low) isTrough = false;
      if (!isPeak && !isTrough) break;
    }
    if (isPeak) {
      peaks.push({
        index: i,
        date: String(curr.timestamp ?? curr.date ?? ''),
        high: curr.high,
        low: curr.low,
        close: curr.close,
        volume: curr.volume,
        type: 'peak',
      });
    }
    if (isTrough) {
      troughs.push({
        index: i,
        date: String(curr.timestamp ?? curr.date ?? ''),
        high: curr.high,
        low: curr.low,
        close: curr.close,
        volume: curr.volume,
        type: 'trough',
      });
    }
  }

  // 極值點不足 → fallback SIDEWAYS
  if (peaks.length < cfg.minLinePoints || troughs.length < cfg.minLinePoints) {
    return {
      moduleId: 'trendline',
      timeframe: options.period || '1d',
      state: 'SIDEWAYS',
      confidence: 0.3,
      interpretation: `極值點不足 (peaks=${peaks.length}, troughs=${troughs.length}, 需要 ≥ ${cfg.minLinePoints} 個), 預設橫行 (信心 0.3)`,
      evidence: [
        {
          type: 'insufficient-data',
          label: `極值點不足 (peaks=${peaks.length}, troughs=${troughs.length})`,
          value: recent.length,
          threshold: cfg.minLinePoints,
          passed: false,
        },
      ],
      warnings: [`極值點不足 (peaks=${peaks.length}, troughs=${troughs.length}, 需要 ≥ ${cfg.minLinePoints} 個)`],
      meta: {
        matchedRules: [],
        ruleLabels: [],
        baseConfidence: 0.3,
        dataDays: recent.length,
        configUsed: cfg,
      },
      timestamp: Date.now(),
    };
  }

  // Step 3: 動態最優點數 + 簡單 OLS 擬合
  const supportFit = fitLine(troughs, 'support', cfg);
  const resistanceFit = fitLine(peaks, 'resistance', cfg);

  // Step 4: Channel + %B
  const latestIdx = recentN - 1;
  const supportVal = supportFit.intercept + supportFit.slope * latestIdx;
  const resistanceVal = resistanceFit.intercept + resistanceFit.slope * latestIdx;
  const latestClose = recent[latestIdx].close;
  const channelWidth = resistanceVal - supportVal;
  const mid = (supportVal + resistanceVal) / 2;
  const channelWidthPct = mid > 0 ? channelWidth / mid : 0;
  const percentB = channelWidth > 0 ? (latestClose - supportVal) / channelWidth : 0.5;

  // Step 5: 觸線統計 + 突破判定
  const supportTouch = analyzeTouches(supportFit, 'support', recent, cfg);
  const resistanceTouch = analyzeTouches(resistanceFit, 'resistance', recent, cfg);
  const supportBreakout = detectBreakout(supportFit, 'support', recent, cfg);
  const resistanceBreakout = detectBreakout(resistanceFit, 'resistance', recent, cfg);

  // Step 6: 投影 (5 日)
  const futureIdx = latestIdx + cfg.projectionDays;
  const supportFuture = supportFit.intercept + supportFit.slope * futureIdx;
  const resistanceFuture = resistanceFit.intercept + resistanceFit.slope * futureIdx;
  const midFuture = (supportFuture + resistanceFuture) / 2;

  // Step 7: 10 條 rule check
  const matchedRules = [];
  if (supportFit.slope > 0 && supportFit.r2 >= cfg.minR2) {
    matchedRules.push({ id: 'A', label: '支撐線上升', strength: 'strong' });
  }
  if (resistanceFit.slope < 0 && resistanceFit.r2 >= cfg.minR2) {
    matchedRules.push({ id: 'B', label: '壓力線下降', strength: 'strong' });
  }
  if (channelWidthPct < 0.03 && percentB >= 0.4 && percentB <= 0.6) {
    matchedRules.push({ id: 'C', label: '通道窄 + 中位', strength: 'medium' });
  }
  if (supportFit.slope > 0 && resistanceFit.slope < 0) {
    matchedRules.push({ id: 'D', label: '收斂三角形', strength: 'medium' });
  }
  if (supportFit.slope > 0 && Math.abs(resistanceFit.slope) <= cfg.flatSlopeThreshold) {
    matchedRules.push({ id: 'E', label: '上升楔形', strength: 'medium' });
  }
  if (Math.abs(supportFit.slope) <= cfg.flatSlopeThreshold && resistanceFit.slope < 0) {
    matchedRules.push({ id: 'F', label: '下降楔形', strength: 'medium' });
  }
  if (supportBreakout.isBreakout && supportBreakout.type === 'true') {
    matchedRules.push({ id: 'G', label: '真跌破支撐', strength: 'strong' });
  }
  if (resistanceBreakout.isBreakout && resistanceBreakout.type === 'true') {
    matchedRules.push({ id: 'H', label: '真突破壓力', strength: 'strong' });
  }
  if (supportTouch.touches >= 2 && supportTouch.avgBouncePct >= 0.01) {
    matchedRules.push({ id: 'I', label: '支撐有效', strength: 'weak' });
  }
  if (resistanceTouch.touches >= 2 && resistanceTouch.avgBouncePct >= 0.01) {
    matchedRules.push({ id: 'J', label: '壓力有效', strength: 'weak' });
  }

  // Step 8: State derivation
  const state = deriveTrendlineState(matchedRules);

  // Step 9: Confidence derivation
  const { baseConfidence, confidence, adjustmentLog } = deriveTrendlineConfidence(
    matchedRules, supportFit, resistanceFit, latestIdx, recentN, cfg
  );

  // 計算 latest extreme age
  const allExtrema = [...peaks, ...troughs];
  const lastExtremeIdx = allExtrema.length > 0
    ? Math.max(...allExtrema.map(p => p.index))
    : 0;
  const latestExtremeAge = allExtrema.length > 0 ? recentN - 1 - lastExtremeIdx : -1;

  // Step 10: Evidence + Meta
  const evidence = [
    {
      type: 'support-slope',
      label: `支撐線斜率: ${supportFit.slope.toFixed(4)}`,
      value: supportFit.slope,
      threshold: 0,
      passed: supportFit.slope > 0,
    },
    {
      type: 'support-r2',
      label: `支撐線 R²: ${supportFit.r2.toFixed(3)}`,
      value: supportFit.r2,
      threshold: cfg.minR2,
      passed: supportFit.r2 >= cfg.minR2,
    },
    {
      type: 'resistance-slope',
      label: `壓力線斜率: ${resistanceFit.slope.toFixed(4)}`,
      value: resistanceFit.slope,
      threshold: 0,
      passed: resistanceFit.slope < 0,
    },
    {
      type: 'resistance-r2',
      label: `壓力線 R²: ${resistanceFit.r2.toFixed(3)}`,
      value: resistanceFit.r2,
      threshold: cfg.minR2,
      passed: resistanceFit.r2 >= cfg.minR2,
    },
    {
      type: 'channel',
      label: `通道寬度: ${(channelWidthPct * 100).toFixed(2)}% (%B = ${percentB.toFixed(3)})`,
      value: channelWidthPct,
      threshold: 0.03,
      passed: channelWidthPct < 0.03,
    },
    {
      type: 'support-breakout',
      label: supportBreakout.isBreakout
        ? `支撐突破: ${supportBreakout.type} (${supportBreakout.daysSince} 日前)`
        : '支撐線: 無突破',
      value: supportBreakout.isBreakout,
      passed: !supportBreakout.isBreakout,
    },
    {
      type: 'resistance-breakout',
      label: resistanceBreakout.isBreakout
        ? `壓力突破: ${resistanceBreakout.type} (${resistanceBreakout.daysSince} 日前)`
        : '壓力線: 無突破',
      value: resistanceBreakout.isBreakout,
      passed: !resistanceBreakout.isBreakout,
    },
    {
      type: 'matched-rules',
      label: `觸發 rules: ${matchedRules.map(r => r.id).join(', ') || '無'}`,
      value: matchedRules.map(r => r.id).join(','),
      passed: matchedRules.length > 0,
    },
  ];

  const interpretation = buildTrendlineReason(
    state, matchedRules, supportFit, resistanceFit,
    channelWidthPct, percentB, supportBreakout, resistanceBreakout
  );

  return {
    moduleId: 'trendline',
    timeframe: options.period || '1d',
    state,
    confidence: round(confidence, 4),
    interpretation,
    evidence,
    warnings: (() => {
      // 大少 2026-08-11 — Module Warning System v1.0.0 (Phase 5c) — M3 Trendline
      const m3Warnings = [];
      // supportLine / resistanceLine 拎唔到 (e.g. 數據太短)
      if (matchedRules.length === 0) {
        m3Warnings.push(makeWarning('warning', 'M3', 'FALLBACK_USED',
          '趨勢線全部 fail, 拎唔到 supportLine / resistanceLine',
          {
            issue: 'matchedRules.length = 0 (趨勢線無突破信號)',
            impact: 'M3 verdict 默認 SIDEWAYS, 對 M7 影响有限',
            fix: '正常, 屬於橫行市況; 如果市況明顯趨勢但 verdict SIDEWAYS, 檢查 kline data',
            context: { matched_rules: 0, period: options.period },
          }
        ));
      }
      return m3Warnings;
    })(),
    _warnings: (() => {
      const m3Warnings = [];
      if (matchedRules.length === 0) {
        m3Warnings.push(makeWarning('warning', 'M3', 'FALLBACK_USED',
          '趨勢線全部 fail',
          {
            issue: 'matchedRules.length = 0',
            impact: 'M3 verdict 默認 SIDEWAYS',
            fix: '正常橫行市況',
            context: { matched_rules: 0 },
          }
        ));
      }
      return m3Warnings;
    })(),
    meta: {
      matchedRules: matchedRules.map(r => r.id),
      ruleLabels: matchedRules.map(r => r.label),
      baseConfidence: round(baseConfidence, 4),
      supportLine: {
        slope: round(supportFit.slope, 6),
        r2: round(supportFit.r2, 4),
        numPoints: supportFit.numPoints,
        intercept: round(supportFit.intercept, 2),
        currentValue: round(supportVal, 2),
        touches: supportTouch.touches,
        avgBouncePct: round(supportTouch.avgBouncePct, 4),
      },
      resistanceLine: {
        slope: round(resistanceFit.slope, 6),
        r2: round(resistanceFit.r2, 4),
        numPoints: resistanceFit.numPoints,
        intercept: round(resistanceFit.intercept, 2),
        currentValue: round(resistanceVal, 2),
        touches: resistanceTouch.touches,
        avgBouncePct: round(resistanceTouch.avgBouncePct, 4),
      },
      channel: {
        widthPct: round(channelWidthPct, 4),
        percentB: round(percentB, 4),
      },
      breakout: {
        support: supportBreakout.isBreakout
          ? { type: supportBreakout.type, daysSince: supportBreakout.daysSince }
          : { type: 'none', daysSince: -1 },
        resistance: resistanceBreakout.isBreakout
          ? { type: resistanceBreakout.type, daysSince: resistanceBreakout.daysSince }
          : { type: 'none', daysSince: -1 },
      },
      latestClose: round(latestClose, 2),
      latestExtremeAge,
      projection: {
        days: cfg.projectionDays,
        supportFuture: round(supportFuture, 2),
        resistanceFuture: round(resistanceFuture, 2),
        midFuture: round(midFuture, 2),
      },
      adjustmentLog,
      dataDays: recentN,
      configUsed: cfg,
    },
    timestamp: Date.now(),
  };
}

// ===== Trendline helpers =====

function fitLine(points, lineType, cfg) {
  const ys = lineType === 'support' ? points.map(p => p.low) : points.map(p => p.high);
  const xs = points.map(p => p.index);

  let bestFit = null;
  let bestR2 = -Infinity;
  const maxN = Math.min(cfg.maxLinePoints, points.length);
  for (let n = cfg.minLinePoints; n <= maxN; n++) {
    const xSubset = xs.slice(-n);
    const ySubset = ys.slice(-n);
    const pointsSubset = points.slice(-n);
    const { slope, intercept, r2 } = linearRegression(xSubset, ySubset);
    if (r2 > bestR2) {
      bestR2 = r2;
      bestFit = { slope, intercept, r2, numPoints: n, usedPoints: pointsSubset };
    }
  }
  if (!bestFit) return { slope: 0, intercept: 0, r2: 0, numPoints: 0, usedPoints: [] };
  return bestFit;
}

function linearRegression(xs, ys) {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 };
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, denom = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean);
    denom += (xs[i] - xMean) ** 2;
  }
  const slope = denom === 0 ? 0 : num / denom;
  const intercept = yMean - slope * xMean;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const yPred = slope * xs[i] + intercept;
    ssRes += (ys[i] - yPred) ** 2;
    ssTot += (ys[i] - yMean) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);
  return { slope, intercept, r2 };
}

function analyzeTouches(fit, lineType, recent, cfg) {
  const fittedIndices = new Set(fit.usedPoints.map(p => p.index));
  const n = recent.length;
  let touches = 0;
  const bounces = [];
  for (let i = 0; i < n - 4; i++) {
    if (fittedIndices.has(i)) continue;
    const lineValue = fit.intercept + fit.slope * i;
    const tolerance = lineValue * cfg.touchTolerancePct;
    const bar = recent[i];
    let isTouch = false;
    let bouncePct = 0;
    if (lineType === 'support') {
      if (bar.low <= lineValue * (1 + cfg.touchTolerancePct) ||
          Math.abs(bar.low - lineValue) <= tolerance) {
        isTouch = true;
        let futureHigh = 0;
        for (let j = i + 1; j < Math.min(n, i + 5); j++) {
          futureHigh = Math.max(futureHigh, recent[j].high);
        }
        if (futureHigh > 0 && bar.close > 0) bouncePct = (futureHigh - bar.close) / bar.close;
      }
    } else {
      if (bar.high >= lineValue * (1 - cfg.touchTolerancePct) ||
          Math.abs(bar.high - lineValue) <= tolerance) {
        isTouch = true;
        let futureLow = Infinity;
        for (let j = i + 1; j < Math.min(n, i + 5); j++) {
          futureLow = Math.min(futureLow, recent[j].low);
        }
        if (futureLow < Infinity && bar.close > 0) bouncePct = (bar.close - futureLow) / bar.close;
      }
    }
    if (isTouch) {
      touches++;
      bounces.push(bouncePct);
    }
  }
  const avgBouncePct = bounces.length > 0
    ? bounces.reduce((a, b) => a + b, 0) / bounces.length
    : 0;
  return { touches, avgBouncePct, bounceScores: bounces };
}

function detectBreakout(fit, lineType, recent, cfg) {
  const n = recent.length;
  const latestIdx = n - 1;
  const windowStart = Math.max(0, latestIdx - cfg.breakoutWindow);
  let isBreakout = false;
  let direction = 'none';
  let breakoutType = 'unknown';
  let breakoutIdx = -1;

  for (let i = windowStart + 1; i <= latestIdx; i++) {
    const lineCurr = fit.intercept + fit.slope * i;
    const linePrev = fit.intercept + fit.slope * (i - 1);
    const prevClose = recent[i - 1].close;
    const currClose = recent[i].close;
    if (lineType === 'support') {
      if (prevClose >= linePrev && currClose < lineCurr) {
        isBreakout = true;
        direction = 'support';
        breakoutIdx = i;
        let daysBelow = 0;
        for (let j = i + 1; j <= Math.min(latestIdx, i + cfg.breakoutConfirmDays); j++) {
          const lineJ = fit.intercept + fit.slope * j;
          if (recent[j].close < lineJ) daysBelow++;
        }
        breakoutType = daysBelow >= cfg.breakoutConfirmDays ? 'true' : 'false';
        break;
      }
    } else {
      if (prevClose <= linePrev && currClose > lineCurr) {
        isBreakout = true;
        direction = 'resistance';
        breakoutIdx = i;
        let daysAbove = 0;
        for (let j = i + 1; j <= Math.min(latestIdx, i + cfg.breakoutConfirmDays); j++) {
          const lineJ = fit.intercept + fit.slope * j;
          if (recent[j].close > lineJ) daysAbove++;
        }
        breakoutType = daysAbove >= cfg.breakoutConfirmDays ? 'true' : 'false';
        break;
      }
    }
  }
  const daysSince = breakoutIdx >= 0 ? latestIdx - breakoutIdx : -1;
  return { isBreakout, direction, type: breakoutType, daysSince, breakoutIdx };
}

function deriveTrendlineState(rules) {
  const ids = new Set(rules.map(r => r.id));
  if (ids.has('H') && ids.has('G')) return 'TRANSITION';
  if (ids.has('H')) return 'UP';
  if (ids.has('A')) return 'UP';
  if (ids.has('B')) return 'DOWN';
  if (ids.has('F')) return 'DOWN';
  if (ids.has('G')) return 'DOWN';
  if (ids.has('C') || ids.has('D')) return 'SIDEWAYS';
  return 'SIDEWAYS';
}

function deriveTrendlineConfidence(rules, supportFit, resistanceFit, latestIdx, recentN, cfg) {
  const adjustmentLog = [];
  let base = 0.5;
  if (rules.some(r => r.strength === 'strong')) base = 0.7;

  let conf = base;
  for (const r of rules) {
    if (r.strength === 'weak') conf += 0.10;
  }

  if (supportFit.r2 < cfg.minR2 && resistanceFit.r2 < cfg.minR2) {
    conf -= 0.10;
    adjustmentLog.push('兩條趨勢線 R² 均低於 minR2, 信心 -0.10');
  } else if (supportFit.r2 < cfg.minR2) {
    conf -= 0.05;
    adjustmentLog.push('支撐線 R² 偏低, 信心 -0.05');
  } else if (resistanceFit.r2 < cfg.minR2) {
    conf -= 0.05;
    adjustmentLog.push('壓力線 R² 偏低, 信心 -0.05');
  }

  const lastFitIdx = supportFit.usedPoints.length > 0
    ? Math.max(...supportFit.usedPoints.map(p => p.index))
    : 0;
  const latestExtremeAge = recentN - 1 - lastFitIdx;
  if (latestExtremeAge > cfg.maxExtremeAgeDays) {
    conf -= 0.10;
    adjustmentLog.push(`趨勢線最舊極值點距今 ${latestExtremeAge} 日, 信號老化, 信心 -0.10`);
  }

  const clamped = Math.max(0, Math.min(1, conf));
  return { baseConfidence: base, confidence: clamped, adjustmentLog };
}

function buildTrendlineReason(state, rules, supportFit, resistanceFit, channelWidthPct, percentB, supportBreakout, resistanceBreakout) {
  if (rules.length === 0) return '趨勢線信號唔清晰, 預設橫行';
  const stateText = { UP: '上升趨勢', DOWN: '下跌趨勢', SIDEWAYS: '橫行', TRANSITION: '短線反轉' };
  const ruleStr = rules.map(r => r.id).join('+');
  const channelStr = channelWidthPct < 0.03 ? '窄通道' : channelWidthPct < 0.10 ? '中等通道' : '寬通道';
  if (state === 'TRANSITION') {
    return `短線反轉: 支撐同壓力線都出現真突破訊號 (${ruleStr}), 趨勢可能反轉`;
  }
  return `${stateText[state]}: 觸發 ${ruleStr} rules, 支撐 R²=${supportFit.r2.toFixed(2)}, 壓力 R²=${resistanceFit.r2.toFixed(2)}, ${channelStr}, %B=${percentB.toFixed(2)}`;
}

// ===== Trendline result renderer =====
function renderTrendlineResult(verdict) {
  const stateColors = { UP: '#52c41a', DOWN: '#ff4d4f', SIDEWAYS: '#faad14', TRANSITION: '#722ed1' };
  const stateLabels = { UP: '上升', DOWN: '下跌', SIDEWAYS: '橫行', TRANSITION: '轉折' };
  const color = stateColors[verdict.state] || '#666';
  const stateLabel = stateLabels[verdict.state] || verdict.state;
  const confidencePct = (verdict.confidence * 100).toFixed(1);
  const confidenceExplain = verdict.confidence >= 0.7 ? '高信心, 信號強' : verdict.confidence >= 0.4 ? '中等信心, 信號一般' : '低信心, 信號弱';
  const matchedRules = verdict.meta?.matchedRules || [];
  const evidence = verdict.evidence || [];

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
  const interpretationDetail = verdict.state === 'UP' ? `
    <p>📌 <strong>簡單講</strong>: 股票喺上升趨勢線通道運行, 每次回調都守住支撐線, 每次反彈都觸及壓力線, 典型上升通道結構。</p>
    <p>📊 <strong>咩意思</strong>: 支撐斜率向上 (${verdict.meta.supportLine?.slope ?? 'N/A'}), R² ${verdict.meta.supportLine?.r2 ?? 'N/A'} 反映擬合度; 通道寬度 ${(verdict.meta.channel?.widthPct * 100).toFixed(2)}%。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 上升趨勢確認, 喺支撐線附近買入 / 壓力線附近減倉係合理策略, 跌破支撐線要小心趨勢反轉。</p>
  ` : verdict.state === 'DOWN' ? `
    <p>📌 <strong>簡單講</strong>: 股票喺下降趨勢線通道運行, 每次反彈都被壓力線壓住, 每次下跌都跌穿前低, 典型下降通道結構。</p>
    <p>📊 <strong>咩意思</strong>: 壓力斜率向下, 通道寬度 ${(verdict.meta.channel?.widthPct * 100).toFixed(2)}%, 趨勢向下穩定。</p>
    <p>💡 <strong>點睇呢個結果</strong>: 下跌趨勢確認, 觀望 / 唔好接刀; 等突破壓力線先考慮撈底。</p>
  ` : verdict.state === 'TRANSITION' ? `
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
          <span class="state-code">${verdict.state}</span>
        </div>
        <div class="confidence">
          <div class="conf-pct">${confidencePct}%</div>
          <div class="conf-label">信心指數 — ${confidenceExplain}</div>
        </div>
        <div class="data-summary">
          <div class="summary-row"><span>時間週期:</span> <strong>${verdict.timeframe}</strong></div>
          <div class="summary-row"><span>數據日數:</span> <strong>${verdict.meta.dataDays}</strong></div>
          <div class="summary-row"><span>Matched Rules:</span> <strong>${matchedRules.length}</strong></div>
        </div>
      </div>

      <div class="interpretation">
        <strong>📌 解讀：</strong>${verdict.interpretation}
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
  const confidencePct = (verdict.confidence * 100).toFixed(0);
  const matchedRules = verdict.meta?.matchedRules || [];
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
        <tr><td class="field-name">📊 state (週期類型)</td><td><strong>${verdict.state}</strong> — ${verdict.state === 'UP' ? '上升趨勢, 支撐線向上傾' : verdict.state === 'DOWN' ? '下跌趨勢, 壓力線向下傾' : verdict.state === 'TRANSITION' ? '短線反轉, 支撐同壓力都被真突破' : '橫行, 通道窄 / 收斂 / 觸線但無突破'}</td></tr>
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
  const confidencePct = (verdict.confidence * 100).toFixed(0);
  const isHighConf = verdict.confidence >= 0.7;
  const isLowConf = verdict.confidence < 0.5;
  const support = verdict.meta.supportLine || {};
  const resistance = verdict.meta.resistanceLine || {};
  const channel = verdict.meta.channel || { widthPct: 0, percentB: 0.5 };
  const pb = channel.percentB || 0.5;

  let stateAdvice = '';
  if (verdict.state === 'UP') {
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
  } else if (verdict.state === 'DOWN') {
    stateAdvice = `
      <div class="strategy-down">
        <h4>🔴 下跌趨勢 · 策略建議</h4>
        <p><strong>基本動作:</strong> 避開 / 考慮減倉, 唔好接刀</p>
        <p><strong>進場策略:</strong> 如果要做空, 等反彈到壓力線 ($${resistance.currentValue?.toFixed(2) ?? 'N/A'}) 附近再回落, 確認受壓</p>
        <p><strong>風險管理:</strong> 留意壓力線位置, 如果真突破 (H rule) 即停損空單, 可能見底</p>
        <p><strong>目標位:</strong> 支撐線 ($${support.currentValue?.toFixed(2) ?? 'N/A'}) — 跌到支撐線附近留意會唔會彈返</p>
      </div>
    `;
  } else if (verdict.state === 'TRANSITION') {
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
      <p class="caveat">⚠️ 觸發 ${(verdict.meta?.matchedRules || []).length} 條 rule, 每條 rule 嘅具體解釋睇「📖 詳細解讀」section</p>
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
  // line = { slope, intercept, numPoints }  ← 從 verdict.meta 取
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
  if (!verdict || !verdict.meta) {
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
    console.warn('[renderTrendlineChartOverlay] verdict.meta 冇 supportLine/resistanceLine (可能係 fallback SIDEWAYS)');
    return;
  }

  const chart = chartRefs.chart;
  if (typeof chart.addLineSeries !== 'function') {
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
      const s = chart.addLineSeries({
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
      const s = chart.addLineSeries({
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

const DEFAULT_INDICATORS_CONFIG = {
  lookbackDays: 60,
  rsiPeriod: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  divergenceTolerance: 0.03,
  minSwingPct: 0.03,
  signalThreshold: 0.6,
};

// ============ Pure-JS port of modules/indicators.ts ============

function _indicatorsRound(n, decimals = 4) {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

function _indicatorsClamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Wilder RSI (跟 docx Step 1)
 */
function _indicatorsCalculateRSI(closes, period) {
  const rsi = [];
  if (closes.length < period + 1) return rsi;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gainSum += diff;
    else lossSum += -diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  const firstRs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + firstRs));

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    if (avgLoss === 0) {
      rsi.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsi.push(100 - 100 / (1 + rs));
    }
  }
  return rsi;
}

/**
 * EMA — fix off-by-one (用 array index 直接 assign, ema[period-1] = SMA seed)
 */
function _indicatorsCalculateEMA(values, period) {
  const ema = new Array(values.length).fill(0);
  if (values.length < period) return [];
  const mult = 2 / (period + 1);

  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  ema[period - 1] = sum / period;

  for (let i = period; i < values.length; i++) {
    ema[i] = values[i] * mult + ema[i - 1] * (1 - mult);
  }
  return ema.slice(period - 1);
}

/**
 * MACD (12/26/9) — 回返 histogram series
 */
function _indicatorsCalculateMACD(closes, fast, slow, signal) {
  const emaFast = _indicatorsCalculateEMA(closes, fast);
  const emaSlow = _indicatorsCalculateEMA(closes, slow);
  if (emaFast.length === 0 || emaSlow.length === 0) return [];

  const dif = [];
  const alignedStart = slow - 1;
  const emaFastOffset = alignedStart - (fast - 1);
  for (let i = 0; i < emaSlow.length; i++) {
    dif.push(emaFast[emaFastOffset + i] - emaSlow[i]);
  }

  const dea = _indicatorsCalculateEMA(dif, signal);
  if (dea.length === 0) return [];

  const deaOffset = signal - 1;
  const histogram = [];
  for (let i = 0; i < dea.length; i++) {
    histogram.push(dif[deaOffset + i] - dea[i]);
  }
  return histogram;
}

/**
 * 3-window local extremum detection
 */
function _indicatorsFindLocalExtrema(series, w) {
  const peaks = [];
  const troughs = [];
  if (series.length < 2 * w + 1) return { peaks, troughs };

  for (let i = w; i < series.length - w; i++) {
    let isPeak = true;
    let isTrough = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      if (series[j] >= series[i]) isPeak = false;
      if (series[j] <= series[i]) isTrough = false;
      if (!isPeak && !isTrough) break;
    }
    if (isPeak) peaks.push({ index: i, value: series[i] });
    else if (isTrough) troughs.push({ index: i, value: series[i] });
  }
  return { peaks, troughs };
}

function _indicatorsFindNearestExtremum(extrema, targetIndex) {
  if (extrema.length === 0) return null;
  let nearest = extrema[0];
  let minDist = Math.abs(extrema[0].index - targetIndex);
  for (const e of extrema) {
    const d = Math.abs(e.index - targetIndex);
    if (d < minDist) {
      minDist = d;
      nearest = e;
    }
  }
  return nearest;
}

function _indicatorsDetectDivergence(priceExtrema, indicatorExtrema, tolerance, minSwing, dates, indicatorName) {
  const out = [];
  if (priceExtrema.length < 2 || indicatorExtrema.length === 0) return out;

  const prev = priceExtrema[priceExtrema.length - 2];
  const curr = priceExtrema[priceExtrema.length - 1];

  const swing = Math.abs(curr.value - prev.value) / prev.value;
  if (swing < minSwing) return out;

  const prevInd = _indicatorsFindNearestExtremum(indicatorExtrema, prev.index);
  const currInd = _indicatorsFindNearestExtremum(indicatorExtrema, curr.index);
  if (!prevInd || !currInd) return out;

  if (curr.value > prev.value * (1 + tolerance) && currInd.value < prevInd.value) {
    const strength = (prevInd.value - currInd.value) / Math.abs(prevInd.value || 1);
    out.push({
      type: 'bearish_divergence',
      indicator: indicatorName,
      pricePoint1: prev.value,
      pricePoint2: curr.value,
      indicatorPoint1: prevInd.value,
      indicatorPoint2: currInd.value,
      strength: _indicatorsClamp(Math.abs(strength), 0, 1),
      index1: prev.index,
      index2: curr.index,
      date1: dates[prev.index] || '',
      date2: dates[curr.index] || '',
    });
  } else if (curr.value < prev.value * (1 - tolerance) && currInd.value > prevInd.value) {
    const strength = (currInd.value - prevInd.value) / Math.abs(prevInd.value || 1);
    out.push({
      type: 'bullish_divergence',
      indicator: indicatorName,
      pricePoint1: prev.value,
      pricePoint2: curr.value,
      indicatorPoint1: prevInd.value,
      indicatorPoint2: currInd.value,
      strength: _indicatorsClamp(Math.abs(strength), 0, 1),
      index1: prev.index,
      index2: curr.index,
      date1: dates[prev.index] || '',
      date2: dates[curr.index] || '',
    });
  }
  return out;
}

/**
 * Main algorithm — port 自 modules/indicators.ts
 */
function _indicatorsDetect(klines, config, symbol, timeframe) {
  // Step 0
  const minRequired = Math.max(config.rsiPeriod, config.macdSlow + config.macdSignal) + config.lookbackDays + 10;
  if (klines.length < minRequired) {
    return {
      moduleId: 'indicators',
      timeframe,
      state: 'SIDEWAYS',
      confidence: 0,
      interpretation: `[動能背馳] 數據不足,需要至少 ${minRequired} 條 K 線,目前 ${klines.length} 條`,
      evidence: [],
      warnings: [`數據不足: ${klines.length} < ${minRequired}`],
      meta: {
        inputBars: klines.length,
        minRequired,
        cycleLabel: '動能中性',
        divergence: { rsiDivergences: [], macdDivergences: [], totalCount: 0 },
        momentumState: { rsi: 50, macd: 0, rsiTrend: 'falling', macdTrend: 'falling', macdState: 'bearish_accelerating', isOverbought: false, isOversold: false },
        signal: { type: 'hold', strength: 0, action: '觀望', reasons: [] },
        winProbability: 0.5,
        exhaustionScore: 0,
        historicalOpportunities: [],
        adjustmentLog: [],
        reason: '數據不足',
        lastDate: '',
        rsiSeries: [],
        macdSeries: [],
      },
      timestamp: Date.now(),
    };
  }

  // Helper: timestamp -> date string
  const klineDate = (k) => {
    if (typeof k.timestamp === 'number') {
      return new Date(k.timestamp).toISOString().split('T')[0];
    }
    return String(k.timestamp).split('T')[0].split(' ')[0];
  };

  const closes = klines.map(k => k.close);
  const dates = klines.map(k => klineDate(k));

  // Step 1: RSI + MACD
  const rsiSeries = _indicatorsCalculateRSI(closes, config.rsiPeriod);
  const macdRaw = _indicatorsCalculateMACD(closes, config.macdFast, config.macdSlow, config.macdSignal);
  const macdOffset = config.macdSlow + config.macdSignal - 2;
  const macdSeries = new Array(macdOffset).fill(0).concat(macdRaw);

  const rsiLatest = rsiSeries.length > 0 ? rsiSeries[rsiSeries.length - 1] : 50;
  const macdLatest = macdSeries.length > 0 ? macdSeries[macdSeries.length - 1] : 0;

  // Step 4: momentum state
  const rsiTrend = rsiSeries.length >= 6
    ? (rsiLatest > rsiSeries.slice(-6, -1).reduce((a, b) => a + b, 0) / 5 ? 'rising' : 'falling')
    : 'falling';
  const macdTrend = macdSeries.length >= 6
    ? (macdLatest > macdSeries.slice(-6, -1).reduce((a, b) => a + b, 0) / 5 ? 'rising' : 'falling')
    : 'falling';
  const isOverbought = rsiLatest > 70;
  const isOversold = rsiLatest < 30;

  let macdState;
  if (macdLatest > 0 && macdTrend === 'rising') macdState = 'bullish_accelerating';
  else if (macdLatest > 0 && macdTrend === 'falling') macdState = 'bullish_decelerating';
  else if (macdLatest < 0 && macdTrend === 'falling') macdState = 'bearish_accelerating';
  else macdState = 'bearish_decelerating';

  // Step 2 + 3: 背馳
  const extW = 3;
  const { peaks: pricePeaks, troughs: priceTroughs } = _indicatorsFindLocalExtrema(closes, extW);
  const { peaks: rsiPeaks, troughs: rsiTroughs } = _indicatorsFindLocalExtrema(rsiSeries, extW);
  const { peaks: macdPeaks, troughs: macdTroughs } = _indicatorsFindLocalExtrema(macdSeries, extW);

  const rsiDiv = [
    ..._indicatorsDetectDivergence(pricePeaks, rsiPeaks, config.divergenceTolerance, config.minSwingPct, dates, 'rsi'),
    ..._indicatorsDetectDivergence(priceTroughs, rsiTroughs, config.divergenceTolerance, config.minSwingPct, dates, 'rsi'),
  ];
  const macdDiv = [
    ..._indicatorsDetectDivergence(pricePeaks, macdPeaks, config.divergenceTolerance, config.minSwingPct, dates, 'macd'),
    ..._indicatorsDetectDivergence(priceTroughs, macdTroughs, config.divergenceTolerance, config.minSwingPct, dates, 'macd'),
  ];

  // Step 5: 衰竭分數
  let exhaustionScore = 0;
  if (isOverbought) exhaustionScore += 0.3 * (rsiLatest - 70) / 30;
  else if (isOversold) exhaustionScore += 0.3 * (30 - rsiLatest) / 30;

  const last10MacdAbs = macdSeries.slice(-10).map(Math.abs);
  const recentMaxMacd = Math.max(...last10MacdAbs);
  if (recentMaxMacd > 0) {
    const shrinkRatio = Math.abs(macdLatest) / recentMaxMacd;
    exhaustionScore += 0.3 * (1 - shrinkRatio);
  }

  if (rsiDiv.length > 0) {
    const maxRsiStrength = Math.max(...rsiDiv.map(d => d.strength));
    exhaustionScore += 0.25 * maxRsiStrength;
  }
  if (macdDiv.length > 0) {
    const maxMacdStrength = Math.max(...macdDiv.map(d => d.strength));
    exhaustionScore += 0.25 * maxMacdStrength;
  }
  exhaustionScore = _indicatorsClamp(exhaustionScore, 0, 1);

  // Step 6: 訊號
  const allDiv = [...rsiDiv, ...macdDiv];
  const hasBullDiv = allDiv.some(d => d.type === 'bullish_divergence');
  const hasBearDiv = allDiv.some(d => d.type === 'bearish_divergence');
  const signalReasons = [];
  let bullScore = 0;
  let bearScore = 0;

  if (hasBullDiv) {
    bullScore += 0.35;
    signalReasons.push('出現底背馳,下跌動能衰竭');
  }
  if (isOversold && rsiTrend === 'rising') {
    bullScore += 0.25;
    signalReasons.push('RSI 超賣區回升');
  }
  if (macdLatest > 0 && macdSeries[macdSeries.length - 2] <= 0) {
    bullScore += 0.25;
    signalReasons.push('MACD 柱狀體翻正(金叉)');
  } else if (
    macdState === 'bearish_decelerating'
    && macdLatest > macdSeries[macdSeries.length - 2]
  ) {
    bullScore += 0.15;
    signalReasons.push('MACD 下跌動能減弱');
  }
  if (klines.length >= 11) {
    const last10Vols = klines.slice(-11, -1).map(k => k.volume);
    const avgVol = last10Vols.reduce((a, b) => a + b, 0) / 10;
    if (klines[klines.length - 1].volume > avgVol * 1.2) {
      bullScore += 0.15;
      signalReasons.push('放量確認');
    }
  }

  if (hasBearDiv) {
    bearScore += 0.35;
    signalReasons.push('出現頂背馳,上升動能衰竭');
  }
  if (isOverbought && rsiTrend === 'falling') {
    bearScore += 0.25;
    signalReasons.push('RSI 超買區回落');
  }
  if (macdLatest < 0 && macdSeries[macdSeries.length - 2] >= 0) {
    bearScore += 0.25;
    signalReasons.push('MACD 柱狀體翻負(死叉)');
  }

  let signalType, signalStrength;
  if (bullScore >= config.signalThreshold && bullScore > bearScore) {
    signalType = 'buy';
    signalStrength = _indicatorsClamp(bullScore, 0, 1);
  } else if (bearScore >= config.signalThreshold && bearScore > bullScore) {
    signalType = 'sell';
    signalStrength = _indicatorsClamp(bearScore, 0, 1);
  } else {
    signalType = 'hold';
    signalStrength = _indicatorsClamp(Math.max(bullScore, bearScore), 0, 1);
  }

  // Step 7: 勝率
  let winProbability = 0.5;
  if (signalType === 'buy') {
    let base = 0.55;
    if (hasBullDiv) base += 0.12;
    if (isOversold) base += 0.08;
    if (macdState === 'bearish_decelerating') base += 0.05;
    winProbability = _indicatorsClamp(base, 0, 0.85);
  } else if (signalType === 'sell') {
    let base = 0.55;
    if (hasBearDiv) base += 0.12;
    if (isOverbought) base += 0.08;
    winProbability = _indicatorsClamp(base, 0, 0.85);
  }

  // Step 8: 歷史機會
  const historicalOpportunities = [];
  if (klines.length >= 20) {
    const lookback = Math.min(config.lookbackDays, klines.length - 1);
    const lastClose = klines[klines.length - 1].close;
    for (let i = klines.length - lookback; i < klines.length; i++) {
      if (i < 11) continue;
      const rsiIdx = i - (klines.length - rsiSeries.length);
      const rsiVal = rsiSeries[rsiIdx] ?? 50;
      const macdVal = macdSeries[i] ?? 0;
      const macdPrev = macdSeries[i - 1] ?? 0;
      const ma5Start = Math.max(0, i - 5);
      const ma5Len = Math.min(5, i);
      const ma5 = klines.slice(ma5Start, i).reduce((s, k) => s + k.close, 0) / ma5Len;
      if (rsiVal < 35 && macdVal > 0 && macdPrev <= 0 && klines[i].close > ma5) {
        const futureReturn = (lastClose - klines[i].close) / klines[i].close;
        if (futureReturn > 0.02) {
          const dateStr = klineDate(klines[i]);
          historicalOpportunities.push({
            date: dateStr,
            price: _indicatorsRound(klines[i].close, 4),
            signalStrength: _indicatorsRound(0.6 + (35 - rsiVal) / 50, 4),
            reason: `RSI 超賣 (${_indicatorsRound(rsiVal, 1)}) + MACD 金叉 + 收 > MA5`,
            returnToDate: _indicatorsRound(futureReturn, 4),
            missed: true,
          });
        }
      }
    }
    historicalOpportunities.sort((a, b) => b.signalStrength - a.signalStrength);
    historicalOpportunities.splice(3);  // Top 3
  }

  // Step 9: 信心
  let confidence = signalStrength;
  const divCount = rsiDiv.length + macdDiv.length;
  if (divCount >= 2) confidence *= 1.15;
  if (
    (signalType === 'buy' && exhaustionScore > 0.6)
    || (signalType === 'sell' && exhaustionScore > 0.6)
  ) {
    confidence *= 1.1;
  }
  confidence = _indicatorsRound(_indicatorsClamp(confidence, 0, 1), 4);

  // Cycle derivation
  let cycle, cycleLabel;
  if (signalType === 'buy') { cycle = 'UP'; cycleLabel = '動能偏多'; }
  else if (signalType === 'sell') { cycle = 'DOWN'; cycleLabel = '動能偏空'; }
  else { cycle = 'SIDEWAYS'; cycleLabel = '動能中性'; }

  // Evidence
  const evidence = [
    { type: 'rsi', label: 'RSI(14)', value: _indicatorsRound(rsiLatest, 2), threshold: '30 / 70', passed: !isOverbought && !isOversold },
    { type: 'macd', label: 'MACD 柱狀體', value: _indicatorsRound(macdLatest, 4), threshold: '0', passed: macdLatest > 0 },
    { type: 'macd-state', label: 'MACD 動能狀態', value: macdState, passed: macdState.includes('bullish') === (cycle === 'UP') },
    { type: 'rsi-trend', label: 'RSI 5 日趨勢', value: rsiTrend, passed: true },
    { type: 'divergence', label: '背馳數量', value: rsiDiv.length + macdDiv.length, passed: rsiDiv.length + macdDiv.length > 0 },
    { type: 'exhaustion', label: '衰竭分數', value: _indicatorsRound(exhaustionScore, 4), threshold: 0.6, passed: exhaustionScore > 0.6 },
  ];

  // Interpretation
  const parts = [`動能視角: ${cycleLabel}`];
  if (signalReasons.length > 0) parts.push(`訊號: ${signalReasons.join('、')}`);
  if (rsiDiv.length + macdDiv.length > 0) parts.push(`背馳數 ${rsiDiv.length + macdDiv.length} 條`);
  if (winProbability >= 0.7) parts.push(`勝率估算 ${(winProbability * 100).toFixed(0)}%`);

  return {
    moduleId: 'indicators',
    timeframe,
    state: cycle,
    confidence,
    interpretation: parts.join(' / '),
    evidence,
    warnings: (() => {
      // 大少 2026-08-11 — Module Warning System v1.0.0 (Phase 5c) — M4 Indicators
      const m4Warnings = [];
      // RSI 超出 [0, 100] 範圍
      if (rsiLatest != null && (rsiLatest < 0 || rsiLatest > 100)) {
        m4Warnings.push(makeWarning('warning', 'M4', 'OUTLIER_VALUE',
          `RSI 超出 [0, 100] 範圍 (${rsiLatest.toFixed(1)})`,
          {
            issue: `rsi = ${rsiLatest.toFixed(1)} (應 [0, 100])`,
            impact: 'RSI verdict 唔可信, 超買/超賣判斷錯誤',
            fix: '檢查 RSI 計算邏輯, 可能 kline 有極端值',
            context: { rsi: rsiLatest, macd: macdLatest },
          }
        ));
      }
      // MACD 結果 NaN
      if (macdLatest != null && !isFinite(macdLatest)) {
        m4Warnings.push(makeWarning('critical', 'M4', 'NAN_RESULT',
          'MACD 計算結果 NaN',
          {
            issue: 'macd 結果係 NaN 或 Infinity',
            impact: 'MACD verdict 拎唔到',
            fix: '檢查 MACD 計算邏輯',
            context: { macd: macdLatest },
          }
        ));
      }
      return m4Warnings;
    })(),
    _warnings: (() => {
      const m4Warnings = [];
      if (rsiLatest != null && (rsiLatest < 0 || rsiLatest > 100)) {
        m4Warnings.push(makeWarning('warning', 'M4', 'OUTLIER_VALUE',
          'RSI 超出範圍',
          { issue: `rsi = ${rsiLatest}`, impact: 'RSI 唔可信', fix: '檢查 kline', context: { rsi: rsiLatest } }));
      }
      if (macdLatest != null && !isFinite(macdLatest)) {
        m4Warnings.push(makeWarning('critical', 'M4', 'NAN_RESULT',
          'MACD NaN',
          { issue: 'macd NaN', impact: 'MACD 拎唔到', fix: '檢查', context: { macd: macdLatest } }));
      }
      return m4Warnings;
    })(),
    meta: {
      inputBars: klines.length,
      cycleLabel,
      divergence: {
        rsiDivergences: rsiDiv,
        macdDivergences: macdDiv,
        totalCount: rsiDiv.length + macdDiv.length,
      },
      momentumState: {
        rsi: _indicatorsRound(rsiLatest, 2),
        macd: _indicatorsRound(macdLatest, 4),
        rsiTrend,
        macdTrend,
        macdState,
        isOverbought,
        isOversold,
      },
      signal: {
        type: signalType,
        strength: _indicatorsRound(signalStrength, 4),
        action: signalType === 'buy' ? '買入' : signalType === 'sell' ? '賣出' : '觀望',
        reasons: signalReasons,
      },
      winProbability: _indicatorsRound(winProbability, 4),
      exhaustionScore: _indicatorsRound(exhaustionScore, 4),
      historicalOpportunities,
      adjustmentLog: [],
      reason: signalReasons.length > 0 ? signalReasons.join('；') : '暫無明確動能訊號',
      lastDate: dates[dates.length - 1] || '',
      rsiSeries,
      macdSeries,
    },
    timestamp: Date.now(),
  };
}

/**
 * 入口: 分析 K 線 + 返 verdict (跟 trendline/volume 同一 pattern)
 */
export async function analyzeIndicators(klines, options = {}) {
  const n = klines.length;
  const dataWindowDays = options.dataWindowDays ?? n;
  const recent = klines.slice(-Math.min(dataWindowDays, n));
  const recentN = recent.length;

  const cfg = { ...DEFAULT_INDICATORS_CONFIG, ...(options.indicatorsConfig || {}) };
  const timeframe = options.period || '1d';
  const verdict = _indicatorsDetect(recent, cfg, options.symbol || 'TEST', timeframe);
  verdict.meta = verdict.meta || {};
  verdict.meta.dataDays = recentN;
  verdict.meta.configUsed = cfg;
  return verdict;
}

// ===== Indicators result renderer =====
function renderIndicatorsResult(verdict) {
  const stateColors = { UP: '#52c41a', DOWN: '#ff4d4f', SIDEWAYS: '#faad14', TRANSITION: '#722ed1' };
  const stateLabels = { UP: '上升', DOWN: '下跌', SIDEWAYS: '橫行', TRANSITION: '轉折' };
  const color = stateColors[verdict.state] || '#666';
  const stateLabel = stateLabels[verdict.state] || verdict.state;
  const confidencePct = (verdict.confidence * 100).toFixed(1);
  const confidenceExplain = verdict.confidence >= 0.7 ? '高信心, 信號強' : verdict.confidence >= 0.4 ? '中等信心, 信號一般' : '低信心, 信號弱';
  const signal = verdict.meta?.signal || { type: 'hold', strength: 0, action: '觀望', reasons: [] };
  const ms = verdict.meta?.momentumState || {};
  const div = verdict.meta?.divergence || { totalCount: 0 };

  const actionColor = signal.type === 'buy' ? '#52c41a' : signal.type === 'sell' ? '#ff4d4f' : '#faad14';
  const actionEmoji = signal.type === 'buy' ? '🟢' : signal.type === 'sell' ? '🔴' : '🟡';

  const reasonsHtml = signal.reasons && signal.reasons.length > 0
    ? signal.reasons.map(r => `<li>${r}</li>`).join('')
    : '<li style="color: #888;">無觸發條件 (hold / 觀望)</li>';

  // 📌 解讀 + 觀望 box 詳細解說 (plain language)
  const signalStrengthPct = (signal.strength * 100).toFixed(0);
  const winProbPct = ((verdict.meta?.winProbability || 0.5) * 100).toFixed(0);
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
          <span class="state-code">${verdict.state}</span>
        </div>
        <div class="confidence">
          <div class="conf-pct">${confidencePct}%</div>
          <div class="conf-label">信心指數 — ${confidenceExplain}</div>
        </div>
        <div class="data-summary">
          <div class="summary-row"><span>時間週期:</span> <strong>${verdict.timeframe}</strong></div>
          <div class="summary-row"><span>數據日數:</span> <strong>${verdict.meta?.dataDays || 0}</strong></div>
          <div class="summary-row"><span>背馳數:</span> <strong>${div.totalCount}</strong></div>
        </div>
      </div>

      <div class="interpretation">
        <strong>📌 解讀：</strong>${verdict.interpretation}
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
        <strong>💨 衰竭分數:</strong> ${((verdict.meta?.exhaustionScore || 0) * 100).toFixed(0)}%
        <small style="color: #888;"> (越高越接近轉勢, >60% 為明顯衰竭)</small>
      </div>

      ${renderDetailedExplanationIndicators(verdict)}
      ${renderStrategyAdviceIndicators(verdict)}
      ${renderUsageGuideIndicators(verdict)}

      <details class="meta-details">
        <summary>🔧 配置（debug 用）</summary>
        <pre>${JSON.stringify(verdict.meta?.configUsed, null, 2)}</pre>
      </details>
    </div>
  `;
}

// ===== 詳細解讀 section (Indicators) =====
// 大少 #11056 — 永久 rule,所有 Module 都要有詳細解讀/策略建議/點用點睇 (用人話)
function renderDetailedExplanationIndicators(verdict) {
  const confidencePct = (verdict.confidence * 100).toFixed(0);
  const signal = verdict.meta?.signal || {};
  const ms = verdict.meta?.momentumState || {};
  const div = verdict.meta?.divergence || { rsiDivergences: [], macdDivergences: [], totalCount: 0 };
  const exhaustion = verdict.meta?.exhaustionScore || 0;
  const winProb = verdict.meta?.winProbability || 0.5;

  return `
    <div class="detailed-explanation">
      <h4>📖 詳細解讀 (動能指標 + 背馳 + 衰竭 點解讀)</h4>
      <ul>
        <li><strong>📌 整體 cycle 點解:</strong> Verdict state = <code>${verdict.state}</code>,代表「<strong>${verdict.interpretation.split(' / ')[0] || '動能中性'}</strong>」。呢個 cycle 係由訊號 (buy/sell/hold) 直接 derive,唔係睇大方向 (嗰個係 M1 MA Alignment 嘅工作)。</li>
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
        <li><strong>📅 數據日數 (dataDays):</strong> ${verdict.meta?.dataDays || 0} 條 K 線,最少 119 條 (14 RSI + 35 MACD + 60 lookback + 10 buffer) 先夠用。</li>
        <li><strong>⏰ 時間週期 (timeframe):</strong> ${verdict.timeframe}。日線睇中線 (幾週),週線睇長線 (幾月)。</li>
        <li><strong>📜 訊號觸發原因 (signal.reasons):</strong> ${(signal.reasons || []).join('、') || '暫無明確觸發'}。每個 reason 對應一個 score 累加,例如「底背馳 +0.35」「RSI 超賣回升 +0.25」,總分 ≥ 0.6 = 明確 buy。</li>
        <li><strong>⚠️ 數據不足警告:</strong> ${verdict.warnings && verdict.warnings.length > 0 ? verdict.warnings[0] : '無'}。</li>
        <li><strong>🔄 統一 cycle 派生規則:</strong> buy → UP, sell → DOWN, hold → SIDEWAYS (TRANSITION 由 Synthesizer 判)。呢個 module 唔 emit TRANSITION。</li>
        <li><strong>📂 過去錯過的買點 (historicalOpportunities):</strong> ${(verdict.meta?.historicalOpportunities || []).length} 個。回顧過去 lookbackDays 內曾經出現過嘅買入訊號,計算到今日嘅回報。Top 3 strongest。可以用嚟訓練盤感。</li>
      </ul>
    </div>
  `;
}

// ===== 策略建議 section (Indicators) =====
function renderStrategyAdviceIndicators(verdict) {
  const signal = verdict.meta?.signal || {};
  const signalType = signal.type;
  const ms = verdict.meta?.momentumState || {};
  const winProb = verdict.meta?.winProbability || 0.5;
  const exhaustion = verdict.meta?.exhaustionScore || 0;

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
      <li>🔍 <strong>留意背馳</strong>: 背馳數 = ${verdict.meta?.divergence?.totalCount || 0} 條, 0 背馳 = 純粹跟趨勢, ≥1 背馳 = 可能有反轉, 預警</li>
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
        <li>⚠️ <strong>注意數據限制</strong>: 數據日數 = ${verdict.meta?.dataDays || 0} 條, < 119 條會 warning, 數據唔夠 = 結果唔可靠</li>
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
  if (!verdict || !verdict.meta) {
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
  if (typeof chart.addLineSeries !== 'function') {
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
      const s = chart.addLineSeries({
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
      const s = chart.addLineSeries({
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
  uptrend: '上升週期',
  downtrend: '下跌週期',
  sideways: '橫行週期',
};

function maV2Round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

async function analyzeMAAlignmentV2(klines, options = {}) {
  const cfg = { ...MA_ALIGNMENT_V2_DEFAULTS, ...(options.config || {}) };
  const adjustmentLog = [];

  // ============ Step 1: 輸入驗證 ============
  const maxPeriod = Math.max(...cfg.maPeriods);
  const minLengthForMA = maxPeriod + 5;
  const minLengthForSlope = cfg.enableSlopeCheck ? maxPeriod + cfg.slopeLookback + 5 : 0;
  const minLengthForVol = cfg.enableVolumeWeight ? cfg.volumeLookback * 2 + 5 : 0;
  const requiredLength = Math.max(minLengthForMA, minLengthForSlope, minLengthForVol);

  if (klines.length < requiredLength) {
    return {
      moduleId: 'ma-alignment-v2',
      timeframe: '1d',
      state: 'SIDEWAYS',
      confidence: 0,
      interpretation: `[MAAlignmentV2] 數據不足: need >= ${requiredLength} bars, got ${klines.length}`,
      evidence: [],
      warnings: [`數據不足 (${klines.length}/${requiredLength})`],
      meta: {
        dataDays: klines.length,
        requiredLength,
        configUsed: cfg,
      },
      timestamp: Date.now(),
    };
  }

  // 檢查日期升序
  for (let i = 1; i < klines.length; i++) {
    if (new Date(klines[i].date) < new Date(klines[i - 1].date)) {
      throw new Error(`[MAAlignmentV2] price_data 必須按日期升序排列 (第 ${i - 1} → ${i} 條違反)`);
    }
  }

  // 檢查 volume
  if (cfg.enableVolumeWeight) {
    for (let i = 0; i < klines.length; i++) {
      if (klines[i].volume === undefined || klines[i].volume === null) {
        throw new Error(`[MAAlignmentV2] volume field required when enable_volume_weight is true (第 ${i} 條缺失)`);
      }
    }
  }

  // ============ Step 2: 計算各週期 MA ============
  const maValues = {};
  for (const period of cfg.maPeriods) {
    const tail = klines.slice(-period);
    const sum = tail.reduce((acc, k) => acc + k.close, 0);
    maValues[`MA${period}`] = sum / period;
  }

  // ============ Step 3: 均線排序與形態判定 ============
  const maKeys = cfg.maPeriods.map(p => `MA${p}`);
  const maRanks = [...maKeys].sort((a, b) => maValues[b] - maValues[a]);
  const rankPeriods = maRanks.map(k => parseInt(k.replace('MA', ''), 10));
  const sortedPeriodsAsc = [...cfg.maPeriods].sort((a, b) => a - b);
  const sortedPeriodsDesc = [...sortedPeriodsAsc].reverse();

  let candidate;
  if (JSON.stringify(rankPeriods) === JSON.stringify(sortedPeriodsAsc)) {
    candidate = 'uptrend';
  } else if (JSON.stringify(rankPeriods) === JSON.stringify(sortedPeriodsDesc)) {
    candidate = 'downtrend';
  } else {
    candidate = 'sideways';
  }

  // ============ Step 4: 橫行週期精細判定 ============
  const maValueList = Object.values(maValues);
  const maxMA = Math.max(...maValueList);
  const minMA = Math.min(...maValueList);
  const maxSpreadPct = minMA > 0 ? (maxMA - minMA) / minMA : 0;

  if ((candidate === 'uptrend' || candidate === 'downtrend') && maxSpreadPct < cfg.thresholdPct) {
    candidate = 'sideways';
    adjustmentLog.push('均線雖有排列但過於靠近，視為橫行整理');
  }

  // ============ Step 5: 成交量趨勢 ============
  let volumeTrendRatio = 1.0;
  let volumeSignal = 'neutral';

  if (cfg.enableVolumeWeight) {
    const recent = klines.slice(-cfg.volumeLookback);
    const previous = klines.slice(-(cfg.volumeLookback * 2), -cfg.volumeLookback);
    const recentAvgVol = recent.reduce((acc, k) => acc + (k.volume || 0), 0) / recent.length;
    const previousAvgVol = previous.reduce((acc, k) => acc + (k.volume || 0), 0) / previous.length;

    if (previousAvgVol === 0) {
      volumeTrendRatio = 1.0;
      volumeSignal = 'neutral';
    } else {
      volumeTrendRatio = recentAvgVol / previousAvgVol;
      if (volumeTrendRatio >= cfg.volumeBoostThreshold) {
        volumeSignal = 'expanding';
      } else if (volumeTrendRatio <= cfg.volumeShrinkThreshold) {
        volumeSignal = 'shrinking';
      } else {
        volumeSignal = 'neutral';
      }
    }
  }

  // ============ Step 6: 均線斜率與動能 ============
  const maSlopes = {};
  let momentumScore = 0;

  if (cfg.enableSlopeCheck) {
    const totalWeight = cfg.maPeriods.reduce((acc, p) => acc + 1 / p, 0);
    for (const period of cfg.maPeriods) {
      const currentMA = maValues[`MA${period}`];
      const pastSegment = klines.slice(-(period + cfg.slopeLookback), -cfg.slopeLookback);
      if (pastSegment.length === 0) {
        maSlopes[`MA${period}`] = 0;
        continue;
      }
      const pastSum = pastSegment.reduce((acc, k) => acc + k.close, 0);
      const pastMA = pastSum / pastSegment.length;
      const slope = pastMA > 0 ? (currentMA - pastMA) / pastMA : 0;
      maSlopes[`MA${period}`] = slope;
      momentumScore += (slope * (1 / period)) / totalWeight;
    }
  }

  // ============ Step 7: 信心指數 (三階段調整) ============
  let baseConfidence;
  if (candidate === 'uptrend' || candidate === 'downtrend') {
    baseConfidence = Math.min(1.0, maxSpreadPct / cfg.spreadConfidenceScale);
    if (maxSpreadPct < 0.05) baseConfidence *= 0.7;
  } else {
    baseConfidence = Math.max(
      cfg.sidewaysBaseConfidence,
      1.0 - Math.abs(maxSpreadPct - cfg.thresholdPct) / cfg.thresholdPct,
    );
  }

  let volMultiplier = 1.0;
  if (cfg.enableVolumeWeight) {
    if (candidate === 'uptrend') {
      if (volumeSignal === 'expanding') {
        volMultiplier = Math.min(1.25, 1.0 + (volumeTrendRatio - 1.0) * 0.5);
        adjustmentLog.push('放量上漲，信心提升');
      } else if (volumeSignal === 'shrinking') {
        volMultiplier = Math.max(0.65, 1.0 - (1.0 - volumeTrendRatio) * 0.8);
        adjustmentLog.push('上漲縮量，信心打折');
      }
    } else if (candidate === 'downtrend') {
      if (volumeSignal === 'expanding') {
        volMultiplier = 1.15;
        adjustmentLog.push('放量下跌，趨勢確認');
      } else if (volumeSignal === 'shrinking') {
        volMultiplier = 0.85;
        adjustmentLog.push('下跌縮量，動能可能不足');
      }
    } else {
      if (volumeSignal === 'shrinking') {
        volMultiplier = 1.15;
        adjustmentLog.push('縮量整理，橫行信號增強');
      } else if (volumeSignal === 'expanding') {
        volMultiplier = 0.85;
        adjustmentLog.push('放量震盪，可能醞釀突破');
      }
    }
  }

  let slopeMultiplier = 1.0;
  if (cfg.enableSlopeCheck) {
    const sortedPeriods = [...cfg.maPeriods].sort((a, b) => a - b);
    const shortPeriods = sortedPeriods.slice(0, 2);
    const negativeCount = cfg.maPeriods.filter(p => (maSlopes[`MA${p}`] || 0) < 0).length;

    if (candidate === 'uptrend') {
      if (shortPeriods.some(p => (maSlopes[`MA${p}`] || 0) < 0)) {
        slopeMultiplier = cfg.slopeDiscountFactor;
        adjustmentLog.push('短期均線斜率為負，上升動能減弱');
      } else if (negativeCount > 0) {
        slopeMultiplier = 0.85;
        adjustmentLog.push('部分長期均線斜率為負');
      }
    } else if (candidate === 'downtrend') {
      const longPeriod = Math.max(...cfg.maPeriods);
      if ((maSlopes[`MA${longPeriod}`] || 0) > 0) {
        slopeMultiplier = 0.8;
        adjustmentLog.push('長期均線斜率轉正，下跌動能減弱');
      } else if (shortPeriods.some(p => (maSlopes[`MA${p}`] || 0) > 0)) {
        slopeMultiplier = 0.9;
        adjustmentLog.push('短期均線斜率轉正，可能醞釀反彈');
      }
    } else {
      const avgAbsSlope = cfg.maPeriods.reduce((acc, p) => acc + Math.abs(maSlopes[`MA${p}`] || 0), 0) / cfg.maPeriods.length;
      if (avgAbsSlope > 0.005) {
        slopeMultiplier = 0.8;
        adjustmentLog.push('均線斜率過大，橫行周期可能即將結束');
      }
    }
  }

  let confidence = baseConfidence * volMultiplier * slopeMultiplier;
  confidence = Math.max(0.0, Math.min(1.0, confidence));
  confidence = maV2Round(confidence, 4);

  // ============ Step 8: 組裝輸出 ============
  const lastDate = klines[klines.length - 1].date;
  const reasonText = `【週期】${MA_V2_CYCLE_LABELS[candidate]}${adjustmentLog.length > 0 ? '；' + adjustmentLog.join('；') : ''}`;

  const meta = {
    cycle: candidate,
    cycleLabel: MA_V2_CYCLE_LABELS[candidate],
    confidence,
    baseConfidence: maV2Round(baseConfidence, 4),
    maValues: Object.fromEntries(Object.entries(maValues).map(([k, v]) => [k, maV2Round(v, 4)])),
    maRanks,
    maSlopes: Object.fromEntries(Object.entries(maSlopes).map(([k, v]) => [k, maV2Round(v, 6)])),
    momentumScore: maV2Round(momentumScore, 6),
    volumeTrendRatio: maV2Round(volumeTrendRatio, 4),
    volumeSignal,
    maxSpreadPct: maV2Round(maxSpreadPct, 6),
    adjustmentLog,
    reason: reasonText,
    lastDate,
    configUsed: cfg,
  };

  const stateMap = { uptrend: 'UP', downtrend: 'DOWN', sideways: 'SIDEWAYS' };
  return {
    moduleId: 'ma-alignment-v2',
    timeframe: '1d',
    state: stateMap[candidate],
    confidence,
    interpretation: reasonText,
    evidence: adjustmentLog.map(log => ({ type: 'adjustment', label: log, value: log, passed: true })),
    warnings: [],
    meta,
    timestamp: Date.now(),
  };
}

function renderMAAlignmentV2Result(verdict) {
  const meta = verdict.meta || {};
  if (!meta.cycle) {
    return `<div class="result-error">數據不足: ${meta.dataDays || 0} / ${meta.requiredLength || 70} 條</div>`;
  }
  const cycleColor = meta.cycle === 'uptrend' ? '#26BA75' : meta.cycle === 'downtrend' ? '#EE5151' : '#F39C12';
  const confidencePct = (meta.confidence * 100).toFixed(0);
  const confidenceExplain = meta.confidence >= 0.7 ? '高信心, 信號強' : meta.confidence >= 0.4 ? '中等信心, 信號一般' : '低信心, 信號弱';
  const cycleCode = meta.cycle.toUpperCase();

  // 主題排列 (e.g. "MA5 > MA10 > MA20 > MA60" 代表典型多頭)
  const arrangementText = meta.maRanks.join(' > ');
  const isTypicalUp = arrangementText === 'MA5 > MA10 > MA20 > MA60';
  const isTypicalDown = arrangementText === 'MA60 > MA20 > MA10 > MA5';
  const arrangementLabel = isTypicalUp ? '典型多頭排列' : isTypicalDown ? '典型空頭排列' : '非典型排列';

  // 📌 判斷 box 詳細解說 (plain language)
  let interpretationDetail = '';
  if (meta.cycle === 'uptrend') {
    interpretationDetail = `
      <p>📌 <strong>簡單講</strong>: 股票 4 條均線 (MA5/10/20/60) 排列係由細到大, 短期均線喺長期均線上面, 代表近期股價一直喺高位跑。短期、中期、長期均線全部向上, 趨勢確認向上。</p>
      <p>📊 <strong>咩意思</strong>: ${arrangementLabel}, Spread ${(meta.maxSpreadPct * 100).toFixed(2)}%, 即係均線之間嘅距離大, 上升趨勢穩固。基礎信心 ${meta.baseConfidence} (純睇 MA 排列同 spread 得出)。</p>
      <p>💡 <strong>點睇呢個結果</strong>: 可以考慮持有或喺回調時加倉, 但要留意成交量同短期均線斜率嘅變化 — 縮量升 / MA5 斜率轉負都可能係見頂警號。</p>
    `;
  } else if (meta.cycle === 'downtrend') {
    interpretationDetail = `
      <p>📌 <strong>簡單講</strong>: 股票 4 條均線排列係由大到細, 短期均線喺長期均線下面, 代表近期股價一直跑緊低位。短期、中期、長期均線全部向下, 趨勢確認向下。</p>
      <p>📊 <strong>咩意思</strong>: ${arrangementLabel}, Spread ${(meta.maxSpreadPct * 100).toFixed(2)}%, 均線之間嘅距離大, 下跌趨勢穩固。基礎信心 ${meta.baseConfidence}。</p>
      <p>💡 <strong>點睇呢個結果</strong>: 觀望 / 減倉, 等長期均線斜率轉正先考慮撈底, 唔好接刀。留意有冇縮量 (下跌動能減弱) 或長期斜率轉正 (可能見底) 嘅反彈訊號。</p>
    `;
  } else {
    interpretationDetail = `
      <p>📌 <strong>簡單講</strong>: 股票 4 條均線排列唔係典型嘅多頭或空頭 (即係交叉咗 / 距離好近), 代表近期股價冇明確方向, 喺一個範圍內上落。</p>
      <p>📊 <strong>咩意思</strong>: ${arrangementLabel}, Spread ${(meta.maxSpreadPct * 100).toFixed(2)}%, 均線之間嘅距離細, 趨勢唔明確。橫行可能係蓄力 (等待突破) 或者轉勢 (等待方向確認)。</p>
      <p>💡 <strong>點睇呢個結果</strong>: 等待突破方向, 唔好喺橫行期間強行入市。配合 M6 Volatility Squeeze 訊號可以捕捉突破時機; 配合 M5 量价可以睇突破嘅真偽。</p>
    `;
  }

  return `
    <div class="as03-verdict as03-module-card">
      <div class="module-card-header">
        <h3 class="module-header">📊 均線系統週期判斷法 v2.0 (with Volume & Slope)</h3>
      </div>
      <div class="verdict-header">
        <div class="state-pill" style="background: ${cycleColor}">
          <span class="state-label">${meta.cycleLabel}</span>
          <span class="state-code">${cycleCode}</span>
        </div>
        <div class="confidence">
          <div class="conf-pct">${confidencePct}%</div>
          <div class="conf-label">信心指數 — ${confidenceExplain}</div>
        </div>
        <div class="data-summary">
          <div class="summary-row"><span>排列:</span> <strong>${arrangementLabel}</strong></div>
          <div class="summary-row"><span>Spread:</span> <strong>${(meta.maxSpreadPct * 100).toFixed(2)}%</strong></div>
          <div class="summary-row"><span>基礎信心:</span> <strong>${meta.baseConfidence}</strong></div>
        </div>
      </div>

      <div class="interpretation">
        <strong>📌 判斷：</strong>${meta.reason}
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
baseConfidence: ${meta.baseConfidence}
confidence: ${meta.confidence}
lastDate: ${meta.lastDate}
${meta.adjustmentLog.length > 0 ? '\nadjustmentLog:\n' + meta.adjustmentLog.map(s => '  • ' + s).join('\n') : ''}</pre>
      </details>
    </div>
  `;
}

// ===== 詳細解讀 section =====
// 用人話逐一解釋 verdict 每個 field 嘅意思
function renderMAAlignmentV2DetailedExplanation(verdict) {
  const meta = verdict.meta;
  const confidencePct = (meta.confidence * 100).toFixed(1);
  const baseConfidencePct = (meta.baseConfidence * 100).toFixed(1);

  return `
    <div class="result-section">
      <h3>📖 詳細解讀</h3>
      <p>呢個 module 用 3 維度判斷股票所處嘅周期 (上升/下跌/橫行), 同時用 2 個維度調整信心 (成交量 + 斜率)。</p>
      <ul>
        <li><strong>cycle</strong>: ${meta.cycle} (${meta.cycleLabel}) — 而家股票所處嘅周期</li>
        <li><strong>confidence</strong>: ${confidencePct}% — 綜合信心指數, base × volume × slope 三階段調整後</li>
        <li><strong>baseConfidence</strong>: ${baseConfidencePct}% — 純粹睇 MA 排列 + spread 嘅基礎信心</li>
        <li><strong>maValues</strong>: ${Object.entries(meta.maValues).map(([k, v]) => `${k}=${v}`).join(', ')} — 4 條均線嘅最新值</li>
        <li><strong>maRanks</strong>: [${meta.maRanks.join(' > ')}] — 均線由大到小嘅排序, 順序排列 = 典型多頭/空頭</li>
        <li><strong>maSlopes</strong>: ${Object.entries(meta.maSlopes).map(([k, v]) => `${k}=${(v * 100).toFixed(2)}%`).join(', ')} — 各均線斜率 (正 = 升, 負 = 跌)</li>
        <li><strong>momentumScore</strong>: ${meta.momentumScore} — 加權動能分數, 短期 MA 權重高</li>
        <li><strong>volumeTrendRatio</strong>: ${meta.volumeTrendRatio} — 近期均量 / 前期均量, &gt; 1.2 為放量, &lt; 0.8 為縮量</li>
        <li><strong>volumeSignal</strong>: ${meta.volumeSignal === 'expanding' ? '放量' : meta.volumeSignal === 'shrinking' ? '縮量' : '持平'} — 量能訊號</li>
        <li><strong>maxSpreadPct</strong>: ${(meta.maxSpreadPct * 100).toFixed(2)}% — 各均線間最大價差百分比, &lt; 2% 強制覆寫做橫行</li>
        <li><strong>adjustmentLog</strong>: ${meta.adjustmentLog.length > 0 ? meta.adjustmentLog.join('；') : '(無調整)'} — 信心指數調整記錄</li>
        <li><strong>reason</strong>: ${meta.reason} — 綜合判斷理由</li>
        <li><strong>lastDate</strong>: ${meta.lastDate} — 數據截止日期</li>
      </ul>
    </div>
  `;
}

// ===== 策略建議 section =====
// 按 cycle state 各自建議
function renderMAAlignmentV2StrategyAdvice(verdict) {
  const meta = verdict.meta;
  let advice = '';
  if (meta.cycle === 'uptrend' && meta.confidence >= 0.7) {
    advice = '<p>🟢 <strong>上升趨勢確認</strong> — 可考慮持有 / 逢回調加倉, 留意 <code>maSlopes[MA5]</code> 唔好轉負。</p>';
  } else if (meta.cycle === 'uptrend' && meta.confidence < 0.5) {
    advice = '<p>🟡 <strong>上升動能減弱</strong> — 留意見頂警號 (縮量 / 短期斜率轉負), 收緊止蝕位, 等待 <code>maSlopes[MA5]</code> 確認方向。</p>';
  } else if (meta.cycle === 'downtrend' && meta.confidence >= 0.7) {
    advice = '<p>🔴 <strong>下跌趨勢確認</strong> — 觀望 / 減倉, 等 <code>maSlopes[MA60]</code> 轉正先考慮撈底, 唔好接刀。</p>';
  } else if (meta.cycle === 'downtrend' && meta.confidence < 0.5) {
    advice = '<p>🟡 <strong>下跌動能減弱</strong> — 留意反彈機會 (縮量 / 長期斜率轉正), 但要 confirm 結構先信, 等 M2 HL Structure HH 確認。</p>';
  } else if (meta.cycle === 'sideways' && meta.confidence >= 0.7) {
    advice = '<p>🟡 <strong>橫行確認</strong> — 等待突破方向, 配合 M6 Volatility Squeeze 訊號捕捉突破, 同時留意量能變化 (放量 = 可能突破)。</p>';
  } else {
    advice = '<p>🟡 <strong>結構模糊</strong> — 信心不足, 唔好落大注, 等待 M2/M3 結構確認, 或者再多睇幾日。</p>';
  }

  return `
    <div class="result-section">
      <h3>🎯 策略建議</h3>
      ${advice}
    </div>
  `;
}

// ===== 點用點睇 section =====
// 10 步 step-by-step guide 教 user 點睇呢個結果
function renderMAAlignmentV2UsageGuide(verdict) {
  const meta = verdict.meta;
  return `
    <div class="result-section">
      <h3>💡 點用點睇 (10 步 step-by-step)</h3>
      <ol>
        <li>睇頂部 <code>state-pill</code> 同 <code>信心指數 %</code> 知大方向同信心</li>
        <li>對比 <code>confidence</code> (綜合) 同 <code>基礎信心</code> — 差越大, 信心調整越多</li>
        <li>睇 <code>📌 判斷</code> box 嘅 <code>reason</code> 知 algorithm 點解咁判</li>
        <li>確認 <code>均線詳細</code> 入面 4 條 MA 嘅值同斜率方向 (↗ 升 / ↘ 跌)</li>
        <li>睇 <code>maSlopes[MA5]</code> 嘅正負 — 短期 MA 斜率係上升動能領先指標</li>
        <li>睇 <code>maSlopes[MA60]</code> 嘅正負 — 長期 MA 斜率係大方向指標</li>
        <li>睇 <code>成交量分析</code> — 近期/前期比 + 訊號 (放量跟 = 真升, 縮量升 = 假升)</li>
        <li>睇 <code>調整記錄</code> 知做咗咩 discount / boost (放量/縮量/斜率)</li>
        <li>對比 M2 HL Structure — 確認峰谷結構 (HH/HL = 上升, LH/LL = 下跌)</li>
        <li>結合多個 module 結果 (M3 Trendline + M4 Indicators + M5 量价 + M6 波動率) 做最終決策</li>
      </ol>
    </div>
  `;
}

function getMAAlignmentV2Help() {
  return `
    <h3>第一模組 v2.0 — 均線系統週期判斷法 (加咗成交量同斜率)</h3>
    <p>用 4 條均線 (5/10/20/60 日) 嘅排列同斜率, 加埋成交量確認, 判斷股票而家係咩週期</p>
    <h4>3 種週期狀態</h4>
    <ul>
      <li><strong>上升週期</strong> — 均線由細到大排好 + 距離 ≥ 2%</li>
      <li><strong>下跌週期</strong> — 均線由大到細排好 + 距離 ≥ 2%</li>
      <li><strong>橫行週期</strong> — 其他情況, 或者距離少過 2% 強制當橫行</li>
    </ul>
    <h4>信心分數 = 基礎 × 成交量 × 斜率</h4>
    <ul>
      <li><strong>基礎分</strong> (0.3-1.0): 由距離除 0.10 計, 距離少過 5% 額外乘 0.7</li>
      <li><strong>成交量</strong> (0.65-1.25): 升 + 放量 1.25, 升 + 縮量 0.65, 跌 + 放量 1.15 等</li>
      <li><strong>斜率</strong> (0.7-1.0): 升 + 短期斜率跌緊 0.7, 跌 + 長期斜率升緊 0.8 等</li>
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
  if (typeof chart.addLineSeries !== 'function') {
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
      const s = chart.addLineSeries({
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
}

export const maAlignmentV2Adapter = {
  id: 'AS-03-MA',
  name: '均線系統週期判斷法 (加咗成交量同斜率)',
  version: '2.0.0',
  description: '睇均線嘅排列加埋成交量同斜率, 判斷股票而家係上升、橫行定下跌週期',
  inputs: [
    // 股票代碼 (大少 #10400 — testing page 統一 auto-complete, 跟首頁 StockSearch UX)
    { key: 'code', label: '股票代碼', type: 'autocomplete', required: true, endpoint: '/api/stocks/search', queryParam: 'q', placeholder: '輸入代碼或名稱', limit: 10, marketFn: 'auto' },
    { key: 'maPeriods', label: '均線週期列表', type: 'string', default: '5,10,20,60' },
    { key: 'thresholdPct', label: '橫行判定閾值 (spread %)', type: 'number', default: 0.02 },
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
// =====================================================================

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

function decisionEngineToStandardVerdict(verdict, klines, moduleId) {
  const base_weight = DECISION_ENGINE_BASE_WEIGHTS[moduleId];
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
  return Math.round((Math.max(...Object.values(stateCount)) / verdicts.length) * 1000) / 1000;
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

function decisionEngineComputeKelly(verdicts) {
  if (verdicts.length === 0) return { fraction: 'quarter', numeric: 0.25, position: 0.25 };
  const avgDD = verdicts.reduce((acc, v) => acc + v.max_drawdown_estimate, 0) / verdicts.length;
  let fraction, numeric;
  if (avgDD < 0.05) { fraction = 'half'; numeric = 0.5; }
  else if (avgDD < 0.10) { fraction = 'quarter'; numeric = 0.25; }
  else { fraction = 'octo'; numeric = 0.125; }
  return { fraction, numeric, position: numeric };
}

// ---------- 主 analyze 函數 ----------
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
  const { grade, grade_score, reason } = decisionEngineComputeGrade(ssi_score, alignment_score);
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
  if (nanFields.length > 0) {
    m7Warnings.push(makeWarning('critical', 'M7', 'NAN_RESULT',
      'M7 綜合判定計算結果 NaN',
      {
        issue: `${nanFields.join('/')} 結果係 NaN 或 Infinity`,
        impact: 'Grade / SSI / Alignment 全部 fallback, M8 綜合判斷會 base on fallback verdict',
        fix: '檢查 6 個 module verdict 數值, 可能其中 1+ 個已經有 NAN_RESULT warning',
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
        impact: 'SSI / Alignment 計算 partial, Grade 可能有偏差',
        fix: '睇下 M1-M6 個別 verdict 嘅 _warnings, 拎唔到嘅 module 會有 critical warning',
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
  grade: '學校評分制 8 級(A+ = 頂級 / A = 優 / B+ = 良 / B = 可 / C+ = 普通 / C = 弱 / D = 差 / F = 失敗)',
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

  const { ssi_score, ssi_breakdown, tcm_matrix, alignment_score, grade, grade_score, grade_reason, kelly_fraction, kelly_position, module_verdicts } = verdict;

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
          <div class="m7-verdict-tooltip" data-help="${TOOLTIPS.alignment}">📐 <strong>Alignment</strong>: ${(alignment_score * 100).toFixed(1)}%</div>
          <div class="m7-verdict-tooltip" data-help="${TOOLTIPS.kelly}">💰 <strong>Kelly</strong>: ${kellyLabel}</div>
        </div>
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
  analyze: async (klines, options = {}) => {
    // 0. 大少 2026-08-11 — 中長線/短炒 雙策略分流
    const strategyMode = options.strategyMode === 'swing' ? 'swing' : 'position';  // 預設中長線

    // 1. 跑 6 個 modules → M7 SynthesizerVerdict (reuse analyzeDecisionEngine 上面嘅 implementation)
    const synthResult = await analyzeDecisionEngine(klines, options);

    // 1b. 大少 19:06 — 拎 m1Verdict (新 M1 v2.0) + zmenVerdict (舊 M1 v0.3.0) 畀 cycle synthesizer
    //   兩者都已經喺 synthResult.module_cycle_verdicts 入面:
    //     maVerdict  = new M1 v2.0 (analyzeMAAlignmentV2) → 做 m1Verdict
    //     但舊 M1 v0.3.0 (runMAAlignment) 要另外跑
    let m1Verdict = null;
    let zmenVerdict = null;
    try {
      // m1 = 新 M1 v2.0 (來自 analyzeDecisionEngine 嘅 maVerdict)
      const maVerdictRaw = synthResult.module_cycle_verdicts?.maVerdict;
      if (maVerdictRaw) {
        m1Verdict = {
          state: maVerdictRaw.state,
          confidence: maVerdictRaw.confidence,
          interpretation: maVerdictRaw.interpretation,
          meta: {
            matchedRules: maVerdictRaw.meta?.matchedRules || [],
            ruleLabels: maVerdictRaw.meta?.ruleLabels || [],
            dataDays: maVerdictRaw.meta?.dataDays,
            source: 'AS-03-MA v2.0',
          },
          timestamp: maVerdictRaw.timestamp || Date.now(),
        };
      }
      // zmen = 舊 M1 v0.3.0 (runMAAlignment)
      const zmenRaw = await runMAAlignment(klines || [], options);
      zmenVerdict = {
        state: zmenRaw.state,
        confidence: zmenRaw.confidence,
        interpretation: zmenRaw.interpretation,
        meta: {
          matchedRules: zmenRaw.meta?.matchedRules || [],
          ruleLabels: zmenRaw.meta?.ruleLabels || [],
          dataDays: zmenRaw.meta?.dataDays,
          source: 'zmen均算法 v0.3.0',
        },
        timestamp: zmenRaw.timestamp || Date.now(),
      };
    } catch (e) {
      console.warn('[decisionEngineAdapter] m1/zmen verdict 拎取失敗, position mode 會 fallback:', e);
    }

    // klineCloses (cycle synthesizer trigger 計算用)
    const klineCloses = (klines || []).map(k => k.close).reverse();  // 變 [0]=今日, [n-1]=最舊

    // 2. 動態 import 從 .bundle.js (esbuild 已 build, browser-compatible)
    //   大少 2026-08-08 18:40 fix: testing page 喺瀏覽器跑 fetch 唔到 .ts file,
    //   改用 esbuild bundle 嘅 ESM .js
    //   大少 2026-08-11 fix: 加 ?v=3.6.1 query string (MA trigger 永久 false bug fix + hardcoded template 中文化)
    const { DecisionEngine, calibrateAdaptiveParams, applyAdaptiveParamsToSynthesizer, DEFAULT_ADAPTIVE_PARAMS } = await import('./build/decision-engine.bundle.js?v=3.6.1');

    // 3. 2.6 — L2 cache: 試讀 cache (7 日內 valid 就用 cache, 否則重新 calibrate)
    const symbol = options.symbol || options.code || 'unknown';
    let adaptiveParams = null;
    let cacheInfo = null;
    let useCache = false;
    try {
      const cacheResp = await fetch(`http://localhost:18792/api/adaptive-params/${encodeURIComponent(symbol)}`);
      if (cacheResp.ok) {
        const data = await cacheResp.json();
        if (data && data.params && data.valid) {
          adaptiveParams = data.params;
          cacheInfo = data;
          useCache = true;
        }
      }
    } catch (e) {
      // Backend 唔 work, fallback 去 calibrate
      console.warn('[M8 Decision Engine] Cache fetch failed, fallback to fresh calibrate:', e);
    }

    // 4. 如果冇 cache 或過期, 重新 calibrate
    if (!useCache) {
      const sentiment6DHistory = synthResult.module_verdicts.map(mv => mv.sentiment_6d);
      adaptiveParams = calibrateAdaptiveParams(klines || [], sentiment6DHistory);
      // Save 落 cache (background, 唔阻 analyze)
      try {
        await postJSON(`http://localhost:18792/api/adaptive-params/${encodeURIComponent(symbol)}`, adaptiveParams);
      } catch (e) {
        console.warn('[M8 Decision Engine] Cache save failed:', e);
      }
    }

    // 5. apply adaptive params 落 M7 synthesizer (影響 SSI weight)
    const synthResultWithParams = applyAdaptiveParamsToSynthesizer(synthResult, adaptiveParams);

    // 6. Market data — 部分由 adaptive params 衍生
    const currentPrice = (klines && klines.length > 0) ? klines[klines.length - 1].close : 0;
    const consecutiveUpDays = computeConsecutiveUpDays(klines);
    const marketData = {
      currentPrice,
      consecutiveUpDays,
      squeezeDetected: detectSqueeze(klines),                       // 2.5 從 M6 volatility 衍生
      fakeBreakoutDetected: detectFakeBreakout(klines),             // 2.5 從 M3 + M5 衍生
      maTrendlineTransition: detectMATLTransition(klines),          // 2.5 從 M1 + M3 衍生
    };

    // 7. 大少 19:06 — 中長線/短炒 雙策略分流
    //   'position' → eng.decidePosition() 中長線 (cycle synth + 5 個 trigger)
    //   'swing'    → eng.decide()        短炒 (原本 8 個最終動作, backward compat)
    const eng = new DecisionEngine();
    let decisionVerdict;
    if (strategyMode === 'position' && m1Verdict && zmenVerdict && klineCloses.length >= 20) {
      decisionVerdict = await eng.decidePosition({
        synthesizerVerdict: synthResultWithParams,
        moduleVerdicts: synthResultWithParams.module_verdicts,
        marketData,
        strategyMode: 'position',
        m1Verdict,
        zmenVerdict,
        klineCloses,
      });
    } else {
      decisionVerdict = await eng.decide({
        synthesizerVerdict: synthResultWithParams,
        marketData,
        strategyMode: 'swing',
      });
    }

    // 8. 合併 synth + decision + adaptive params + 雙策略 input (保留所有 trace + 供 render 用)
    // 大少 2026-08-11 — Module Warning System v1.0.0 (Phase 5a) — M8 Decision Engine
    // 警告注入:
    //   🔴 VERDICT_MISSING: cycle_synthesizer 係 null (position mode fallback)
    //   🔴 NAN_RESULT: meta.ma5 OR meta.ma20 係 null
    //   🟡 THRESHOLD_BREACH: 5 個 MA trigger 全部 false (slow market, 1+ 日無 trigger)
    //   🔴 CACHE_INVALID: adaptive_params 計算失敗
    //   🔵 CACHE_EXPIRING: L2 cache 超過 5 日 (7 日內將過期)
    //   🔵 CONFIG_DEFAULTS: strategyMode 用咗 default 'position'
    // 收集 M1-M7 嘅 _warnings (propagation)
    const m8Warnings = [];
    // Collect from synthResultWithParams (M7 已經 collect M1-M6 嘅 warnings)
    if (synthResultWithParams?._warnings && Array.isArray(synthResultWithParams._warnings)) {
      m8Warnings.push(...synthResultWithParams._warnings);
    }
    // Collect from m1Verdict (可能 module_cycle_verdicts 入面 maVerdict 有 _warnings)
    if (m1Verdict?._warnings) m8Warnings.push(...m1Verdict._warnings);
    // Collect from zmen verdict
    // (zmen 嚟自 runMAAlignment, 之後可以加 zmen._warnings)
    // M8 自己 generate
    const cycleSynth = decisionVerdict?.cycle_synthesizer;
    if (strategyMode === 'position' && !cycleSynth) {
      m8Warnings.push(makeWarning('critical', 'M8', 'VERDICT_MISSING',
        '中長線 cycle_synthesizer 拎唔到 (position mode fallback)',
        {
          issue: 'cycle_synthesizer = null (m1Verdict / zmenVerdict / klineCloses 缺少)',
          impact: '5 個 MA trigger 全部 fallback false, 中長線 verdict 唔可用',
          fix: '檢查 kline count 足唔足 (≥ 20), m1Verdict/zmenVerdict 有冇正常 compute',
          context: { strategy_mode: strategyMode, m1Verdict: !!m1Verdict, zmenVerdict: !!zmenVerdict, kline_count: klineCloses.length },
        }
      ));
    }
    // NAN check on meta.ma5 / meta.ma20
    if (cycleSynth?.meta) {
      if (cycleSynth.meta.ma5 == null || !isFinite(cycleSynth.meta.ma5)) {
        m8Warnings.push(makeWarning('critical', 'M8', 'NAN_RESULT',
          '中長線 MA5 計算結果 NaN',
          {
            issue: 'cycle_synthesizer.meta.ma5 = null / NaN',
            impact: '動態止蝕 (5 日線 × 0.98) 計算失敗',
            fix: '檢查 computeMA 邏輯, 確認 forward-looking 邏輯 (ma[0] = today 5-day MA)',
            context: { ma5: cycleSynth.meta.ma5 },
          }
        ));
      }
      if (cycleSynth.meta.ma20 == null || !isFinite(cycleSynth.meta.ma20)) {
        m8Warnings.push(makeWarning('critical', 'M8', 'NAN_RESULT',
          '中長線 MA20 計算結果 NaN',
          {
            issue: 'cycle_synthesizer.meta.ma20 = null / NaN',
            impact: '移動止蝕 (20 日線) 計算失敗',
            fix: '檢查 computeMA 邏輯, 確認 forward-looking 邏輯',
            context: { ma20: cycleSynth.meta.ma20 },
          }
        ));
      }
    }
    // 5 個 MA trigger 全部 false
    if (cycleSynth?.triggers) {
      const allFalse = ['ma5StopTriggered', 'ma5BreakDay1', 'ma5BreakDay2', 'ma20Break', 'ma5RetestSuccess'].every(k => !cycleSynth.triggers[k]);
      if (allFalse) {
        m8Warnings.push(makeWarning('warning', 'M8', 'THRESHOLD_BREACH',
          '5 個 MA trigger 全部 false',
          {
            issue: 'ma5StopTriggered / ma5BreakDay1 / ma5BreakDay2 / ma20Break / ma5RetestSuccess 全部 false',
            impact: '中長線無明確進出場信號, verdict 維持 TRANSITION/WAIT',
            fix: '可能市場橫行, 屬於正常; 如果市況明顯趨勢但 trigger 全 false, 檢查 computeMA',
            context: { triggers: cycleSynth.triggers },
          }
        ));
      }
    }
    // CACHE_INVALID (adaptive_params 失敗)
    if (!adaptiveParams) {
      m8Warnings.push(makeWarning('critical', 'M8', 'CACHE_INVALID',
        'adaptive_params 計算失敗 (L2 cache 無效)',
        {
          issue: 'calibrateAdaptiveParams() return null',
          impact: '5 個 adaptive params 全部 fallback default, M8 verdict 唔可靠',
          fix: '檢查 calibrateAdaptiveParams() 邏輯, 確認 klines 入面有足夠 data',
          context: { symbol },
        }
      ));
    }
    // CACHE_EXPIRING
    if (cacheInfo && cacheInfo.age_seconds && cacheInfo.age_seconds > 5 * 24 * 3600) {
      m8Warnings.push(makeWarning('info', 'M8', 'CACHE_EXPIRING',
        `L2 cache 超過 5 日 (${Math.round(cacheInfo.age_seconds / 3600)} 小時)`,
        {
          issue: `cache age = ${Math.round(cacheInfo.age_seconds / 3600)} 小時 (> 5 日, 7 日內將過期)`,
          impact: 'adaptive params 開始 stale, 自動 re-calibrate 將 trigger',
          fix: '可主動撳「🔄 重新校準」button 立即 trigger',
          context: { age_hours: Math.round(cacheInfo.age_seconds / 3600) },
        }
      ));
    }
    // CONFIG_DEFAULTS
    if (strategyMode === 'position' && options.strategyMode === undefined) {
      m8Warnings.push(makeWarning('info', 'M8', 'CONFIG_DEFAULTS',
        'strategyMode 用咗 default 「中長線」',
        {
          issue: '用戶冇指定 strategyMode, 用 default 中長線',
          impact: '想用短炒要手動切換',
          fix: 'dropdown 揀「短炒」可手動切換',
          context: { default_strategy: 'position' },
        }
      ));
    }
    // 大少 2026-08-11 — 7 個 adaptive params warning 注入
    if (adaptiveParams) {
      const { ssiWeights, rsiWeight, kellyFraction, markowitzCorr, hurstThresholds } = adaptiveParams;
      // Hurst 強趨勢 (>0.95)
      if (hurstThresholds?.persistent > 0.95) {
        m8Warnings.push(makeWarning('warning', 'M8', 'THRESHOLD_BREACH',
          `Hurst persistent > 0.95 強趨勢 (${hurstThresholds.persistent.toFixed(3)})`,
          {
            issue: `hurstThresholds.persistent = ${hurstThresholds.persistent.toFixed(3)} > 0.95 (極端)`,
            impact: '可能係 data 太短 / noise 太少, 強趨勢判斷要小心',
            fix: '增加 dataWindowDays 拎更多 samples, 確認 Hurst 計算無 bug',
            context: { hurst_persistent: hurstThresholds.persistent, hurst_reverting: hurstThresholds.reverting },
          }
        ));
      }
      // Hurst 強反轉 (<0.05)
      if (hurstThresholds?.reverting < 0.05) {
        m8Warnings.push(makeWarning('warning', 'M8', 'THRESHOLD_BREACH',
          `Hurst reverting < 0.05 強反轉 (${hurstThresholds.reverting.toFixed(3)})`,
          {
            issue: `hurstThresholds.reverting = ${hurstThresholds.reverting.toFixed(3)} < 0.05 (極端)`,
            impact: '可能係 data 太短, 反轉判斷要小心',
            fix: '增加 dataWindowDays 拎更多 samples',
            context: { hurst_persistent: hurstThresholds.persistent, hurst_reverting: hurstThresholds.reverting },
          }
        ));
      }
      // R² 過低 (ssiWeights normalize 後 < 0.3 嘅 module 過多)
      if (ssiWeights) {
        const lowFitModules = Object.entries(ssiWeights).filter(([k, v]) => v < 0.15);
        if (lowFitModules.length >= 2) {
          m8Warnings.push(makeWarning('warning', 'M8', 'OUTLIER_VALUE',
            `${lowFitModules.length} 個 module SSI 權重 < 0.15 (R² 過低)`,
            {
              issue: `ssiWeights 入面 ${lowFitModules.length} 個 module 權重 < 0.15`,
              impact: '呢啲 module 對 verdict 影響太低, 可能 R² 過低 (data 唔啱呢條線)',
              fix: '增加 dataWindowDays 拎更多 data, 或試另一個 period (1d → 1w)',
              context: { ssi_weights: ssiWeights, low_fit_modules: lowFitModules.map(([k]) => k) },
            }
          ));
        }
      }
      // Kelly 連續高波動 (每次都 >= 5%)
      if (kellyFraction === 'octo') {
        m8Warnings.push(makeWarning('info', 'M8', 'CONFIG_DEFAULTS',
          'Kelly 八分一倉 (高波動)',
          {
            issue: `kellyFraction = 'octo' (1/8 = 12.5%), 自動切到高波動倉位`,
            impact: '波動大, 倉位自動收細保護',
            fix: '正常, 唔使特別處理; 如果想加倉, 確認風險承受能力',
            context: { kelly_fraction: kellyFraction, kelly_numeric: 0.125 },
          }
        ));
      }
      // 馬可維茨相關係數全部接近 0 (分散風險低)
      if (markowitzCorr) {
        const avgCorr = (Math.abs(markowitzCorr.dailyWeekly) + Math.abs(markowitzCorr.dailyMonthly) + Math.abs(markowitzCorr.weeklyMonthly)) / 3;
        if (avgCorr > 0.8) {
          m8Warnings.push(makeWarning('warning', 'M8', 'THRESHOLD_BREACH',
            `馬可維茨平均相關係數 > 0.8 (${avgCorr.toFixed(3)}, 分散風險低)`,
            {
              issue: `3 個時段 (日/週/月) 平均相關係數 = ${avgCorr.toFixed(3)} > 0.8`,
              impact: '日/週/月 走勢高度同步, 多 timeframe 分散效果低',
              fix: '可能係 data 期間市況單調, 試多啲 period 或加長 dataWindowDays',
              context: { markowitz_corr: markowitzCorr, avg_abs_corr: avgCorr },
            }
          ));
        }
      }
    }

    return {
      ...decisionVerdict,
      strategy_mode: strategyMode,
      m1_verdict: m1Verdict,
      zmen_verdict: zmenVerdict,
      module_cycle_verdicts: synthResultWithParams.module_cycle_verdicts,
      adaptive_params: adaptiveParams,
      cache_info: cacheInfo,
      _warnings: m8Warnings,  // 大少 2026-08-11 v1.0.0
    };
  },
  renderResult: (verdict) => {
    if (!verdict) return '<div class="result-error">無 verdict</div>';

    // 大少 2026-08-11 — 中長線/短炒 wrapper
    //   strategyMode='position' → 中長線 (cycle synth + 5 個 trigger) + 短炒 (原本 M8 8 個最終動作)
    //   strategyMode='swing'    → 只顯示短炒 (backward compat)
    const strategyMode = verdict.strategy_mode || 'swing';
    const swingContent = renderSwingDecisionEngine(verdict);

    if (strategyMode === 'position' && verdict.cycle_synthesizer) {
      const positionContent = renderPositionDecisionEngine(verdict);
      return positionContent + swingContent;
    }
    return swingContent;
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

// ---------- backTestAdapter export (M9 v0.6.0 — Sprint 3 sub-task 9.7 UI 升級 done) ----------
//   大少 2026-08-08 22:28 — 9.5 Testing page entry 09 — AS-03-BT
//   9.6 — HK.00700 pilot + spec doc + ROADMAP + 4 fixes
//   9.7 — M9 UI 升級 (3 SVG charts + 6 色標 + 永遠 full show + 2 個真實可 click button + 大少話你知 LLM hook)
//   用 modules/back-test.ts (esbuild bundle .bundle.js, browser-compatible)
//   跑 walk-forward CV (9.1-9.3) + 自動 POST optimal + forward return records 落 cache (9.4)
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
  analyze: async (klines, options = {}) => {
    const symbol = options.symbol || options.code || 'unknown';

    // 0. Normalize klines: backend 用 'time' (ISO string), back-test.ts 用 'timestamp' (number)
    //    將 'time' 轉做 'timestamp' (ms since epoch)
    const normalizedKlines = klines.map(k => {
      if (k.timestamp !== undefined && typeof k.timestamp === 'number') return k;
      if (k.time !== undefined) {
        // time format: 'YYYY-MM-DD' or ISO string
        const date = new Date(k.time);
        return { ...k, timestamp: date.getTime() };
      }
      return k;
    });

    // 大少 2026-08-10 Bug 1 fix A.3 — debug log 記 K 線 / fold split 狀況
    // 用嚟診斷「0 validate samples」嘅 root cause (data 太短 / window 太細)
    // 大少 2026-08-10 07:35 fix: 擺去 normalizedKlines 之後, 避免 raw klines[0].timestamp 係 string/undefined 嘅 crash
    const klineCount = normalizedKlines.length;
    const klineDateRange = klineCount > 0 ? {
      start: new Date(normalizedKlines[0].timestamp).toISOString().substring(0, 10),
      end: new Date(normalizedKlines[klineCount - 1].timestamp).toISOString().substring(0, 10),
      days: Math.round((normalizedKlines[klineCount - 1].timestamp - normalizedKlines[0].timestamp) / 86400000),
    } : null;
    console.log(`[backTestAdapter] start analyze ${symbol}, klines=${klineCount}, range=${JSON.stringify(klineDateRange)}`);

    // 1. Import back-test bundle (browser-compatible ESM)
    // 大少 2026-08-10 08:45 fix: 加 ?v=2.6.6 cache bust (dataWindowDays 252 → 1260)
    const backTest = await import('./build/back-test.bundle.js?v=2.6.6');
    const { runWalkForwardCV, runAdaptiveWindow, runCoarseGrid, runFineTune, runReplay, scoreResult } = backTest;

    // 2. 用 decisionEngineAdapter 做 decisionFn (內部 chain M1-M8)
    // 但 testing page 唔可以直接 call adapter.analyze 因為太重 (會做 cache flow 等等)
    // 所以用 analyzeDecisionEngine 直接 chain (skip cache, 純運算)
    const decisionFn = async (kl, opts) => {
      const synthResult = await analyzeDecisionEngine(kl, opts);
      // 將 SynthesizerVerdict 轉 DecisionVerdict
      const { DecisionEngine, DEFAULT_ADAPTIVE_PARAMS } = await import('./build/decision-engine.bundle.js?v=3.6.1');
      const engine = new DecisionEngine();
      return engine.decide({
        synthesizerVerdict: synthResult,
        moduleVerdicts: synthResult.module_verdicts,
        marketData: opts.marketData ?? {},
      });
    };

    // 3. 跑 Walk-Forward CV (3 folds rolling, 大少 22:28 揀 B)
    //    adaptive window 自動處理 initialDays → finalDays
    //    但 runWalkForwardCV 已經 internal 用 coarse grid + fine tune
    let walkForwardResult;
    try {
      walkForwardResult = await runWalkForwardCV({
        klines: normalizedKlines,
        decisionFn,
        baseSymbol: symbol,
        // 大少 2026-08-10 08:37 numFolds 1 + tuneRatio 0.6 fix:
        // 3 folds × (tune 67 + validate 33) tune verdict 67 < HLStructure 99 bar gate
        // 1 fold × tuneRatio 0.6: 252 條 → tune 151 (>99 ✅) + validate 101 (>99 ✅)
        numFolds: 1,
        tuneRatio: 0.6,
        baseReplayConfig: { stepDays: options.stepDays ?? 5, lookbackDays: 60, holdDays: [5, 10, 20] },
      });
    } catch (e) {
      console.error('[backTestAdapter] runWalkForwardCV failed:', e);
      walkForwardResult = { folds: [], overall: { bestParams: { kelly: 0.25, rsiWeight: 0.20, ssiWeights: { ma: 0.4, hl: 0.3, tl: 0.3 } }, avgValidateScore: 0, stabilityScore: 0, totalValidateSamples: 0 } };
    }

    // 4. POST optimal 落 cache (per-symbol, 30 日 expiry)
    const optimal = walkForwardResult.overall;
    if (optimal.bestParams && optimal.totalValidateSamples > 0) {
      try {
        await postJSON(`http://localhost:18792/api/adaptive-params/${encodeURIComponent(symbol)}/back-test`, {
          kelly: optimal.bestParams.kelly,
          rsiWeight: optimal.bestParams.rsiWeight,
          ssiWeights: optimal.bestParams.ssiWeights,
          validation: { avgValidateScore: optimal.avgValidateScore, stabilityScore: optimal.stabilityScore, totalValidateSamples: optimal.totalValidateSamples },
          window: { initialDays: 126, finalDays: 252, extendCount: walkForwardResult.folds.length > 0 ? 1 : 0 },
          foldsCount: walkForwardResult.folds.length,
        });
      } catch (e) {
        console.warn('[backTestAdapter] save optimal failed:', e);
      }
    }

    // 4b. 9.7.3 — 拎 forward return history 從 cache (永久累積, 永遠 full show)
    let forwardReturnHistory = [];
    try {
      const frResp = await fetch(`http://localhost:18792/api/adaptive-params/${encodeURIComponent(symbol)}/forward-return?limit=20`);
      if (frResp.ok) {
        const frData = await frResp.json();
        forwardReturnHistory = frData.history || [];
      }
    } catch (e) {
      console.warn('[backTestAdapter] fetch forward return history failed:', e);
    }

    // 5. POST forward return records (累積, 永久保留)
    //    對每 fold 嘅 validate set 跑 runReplay 拎 results, 逐條 POST
    for (const fold of walkForwardResult.folds) {
      try {
        // Normalize fold.validateKlines (already normalized if from runWalkForwardCV, but be safe)
        const normValidateKlines = fold.validateKlines.map(k => {
          if (k.timestamp !== undefined && typeof k.timestamp === 'number') return k;
          if (k.time !== undefined) {
            return { ...k, timestamp: new Date(k.time).getTime() };
          }
          return k;
        });
        const summary = await runReplay(normValidateKlines, {
          symbol,
          klines: normValidateKlines,
          holdDays: [5, 10, 20],
          stepDays: 5,
          lookbackDays: 0,  // 累積 (V1 fix)
          params: { ...fold.bestParams },
        }, decisionFn);
        // 大少 2026-08-10 Bug 1 fix — 收集 POST 失敗訊息, 喺 UI banner 顯示 (唔再 silent fail)
        fold.postErrors = [];
        for (const r of summary.results) {
          try {
            await postJSON(`http://localhost:18792/api/adaptive-params/${encodeURIComponent(symbol)}/forward-return`, {
              date: r.date,
              action: r.action,
              fwd5: r.forwardReturn5d,
              fwd10: r.forwardReturn10d,
              fwd20: r.forwardReturn20d,
              hit: r.hit5d,
            });
          } catch (e) {
            console.warn(`[backTestAdapter] fold ${fold.foldIndex} forward return POST failed:`, e);
            fold.postErrors.push(e.message);
          }
        }
      } catch (e) {
        console.warn(`[backTestAdapter] fold ${fold.foldIndex} forward return save failed:`, e);
      }
    }

    // 大少 2026-08-11 — Module Warning System v1.0.0 (Phase 5b) — M9 Back Test
    // 警告注入:
    //   🟡 LOW_SAMPLE_SIZE: totalValidateSamples = 0 (大少 10:35 fix 嘅 0 samples bug)
    //   🟡 POST_FAILED: postErrors.length > 0 (大少 10:35 fix 嘅 silent fail bug)
    //   🔴 VERDICT_MISSING: folds.length = 0 (walkForwardCV 完全 fail)
    //   🟡 LOW_SAMPLE_SIZE: forwardReturnHistory.length < 3 (累積樣本少)
    //   🔵 CONFIG_DEFAULTS: dataWindowDays 用咗 default 1260 (唔係用戶自訂)
    const m9Warnings = [];
    if (walkForwardResult.folds.length === 0) {
      m9Warnings.push(makeWarning('critical', 'M9', 'VERDICT_MISSING',
        'Walk-Forward CV 完全 fail, 0 個 fold',
        {
          issue: 'walkForwardResult.folds.length = 0',
          impact: 'M9 全部 optimal 拎唔到, 對 M8 套用會 fallback default',
          fix: '檢查 kline count 足唔足 (≥ 126 日), runReplay 邏輯, 跑時有冇 exception',
          context: { folds_count: 0, total_validate_samples: optimal.totalValidateSamples },
        }
      ));
    } else if (optimal.totalValidateSamples === 0) {
      m9Warnings.push(makeWarning('warning', 'M9', 'LOW_SAMPLE_SIZE',
        '0 validate samples (M9 結果唔可靠)',
        {
          issue: 'totalValidateSamples = 0 (即使 folds.length > 0)',
          impact: 'Walk-Forward CV 結果冇 statistical significance, M9 結論唔可信',
          fix: '大少 10:35 fix: 調大 numFolds / tuneRatio 確保 tune verdict 過 bar gate (HLStructure 99 條)',
          context: { folds_count: walkForwardResult.folds.length, total_validate_samples: 0 },
        }
      ));
    } else if (optimal.totalValidateSamples < 10) {
      m9Warnings.push(makeWarning('warning', 'M9', 'LOW_SAMPLE_SIZE',
        `validate samples 偏少 (${optimal.totalValidateSamples} 個)`,
        {
          issue: `totalValidateSamples = ${optimal.totalValidateSamples} < 10`,
          impact: '統計意義唔足, M9 結論要小心睇',
          fix: '增加 dataWindowDays 設定 (e.g. 1260 → 2520) 拎更多 samples',
          context: { total_validate_samples: optimal.totalValidateSamples, recommended: '>= 30' },
        }
      ));
    }
    if (postErrors && postErrors.length > 0) {
      m9Warnings.push(makeWarning('warning', 'M9', 'POST_FAILED',
        `${postErrors.length} 個 forward return POST 失敗`,
        {
          issue: 'POST 落 /api/adaptive-params/{symbol}/forward-return 失敗',
          impact: 'forward_return_history 累積唔到, Stage 1+ Stream B 數據缺失',
          fix: '大少 10:35 fix: 加 response.ok check + UI banner 顯示, 檢查 backend 18792 port',
          context: { failed_count: postErrors.length, sample_error: postErrors[0] },
        }
      ));
    }
    if (forwardReturnHistory.length < 3) {
      m9Warnings.push(makeWarning('info', 'M9', 'LOW_SAMPLE_SIZE',
        `forward_return_history 累積樣本少 (${forwardReturnHistory.length} 個)`,
        {
          issue: `forwardReturnHistory.length = ${forwardReturnHistory.length} < 3`,
          impact: 'Stage 1+ Stream B 命中率統計暫時冇意義',
          fix: '正常, 多跑幾次 M9 累積更多 samples, 或多寫 trade journal entries',
          context: { history_count: forwardReturnHistory.length, recommended: '>= 30' },
        }
      ));
    }
    if (options.dataWindowDays === undefined || options.dataWindowDays === 1260) {
      m9Warnings.push(makeWarning('info', 'M9', 'CONFIG_DEFAULTS',
        'dataWindowDays 用咗 default 1260 (4 年)',
        {
          issue: 'dataWindowDays = 1260 (default), 唔係用戶自訂',
          impact: '可能用戶想用 2520 (8 年) 但忘記設定',
          fix: '可調大到 2520 (8 年) 拎更多 samples',
          context: { data_window_days: options.dataWindowDays ?? 1260 },
        }
      ));
    }

    return {
      symbol,
      walkForwardResult,
      optimal,
      forwardReturnHistory,  // 9.7.3 永遠 full show
      // 大少 2026-08-10 Bug 1 fix A.2 — collect 所有 fold POST 失敗訊息, 畀 UI banner 用
      postErrors: walkForwardResult.folds.flatMap(f => f.postErrors || []),
      _warnings: m9Warnings,  // 大少 2026-08-11 v1.0.0
      timestamp: Date.now(),
    };
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

    let html = '';

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

    // ===== Section 1: 大標題 + 簡述 =====
    html += `<div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 16px 20px; border-radius: 12px; margin-bottom: 16px;">`;
    html += `<h3 style="margin: 0 0 8px 0; font-size: 18px;">⏰ 回測驗證結果 (第九模組 v0.6.0)</h3>`;
    html += `<p style="margin: 0; opacity: 0.95;">用歷史 K 線重播之前嘅判決, 對比之後 5 / 10 / 20 日真實升咗幾多</p>`;
    html += `<p style="margin: 4px 0 0 0; opacity: 0.85; font-size: 13px;">📊 ${symbol} · ${folds.length} 段滾動驗證 · ${overall.totalValidateSamples} 個真實樣本</p>`;
    html += `</div>`;

    // ===== Section 2: 最佳參數 (帶 Kelly pie chart 9.7.2) =====
    html += `<h4 style="margin: 16px 0 8px 0; color: #333;">🎯 呢隻股票嘅最佳參數</h4>`;
    const kellyPct = overall.bestParams.kelly * 100;
    const kellyColor = colorByKelly(overall.bestParams.kelly);
    html += `<div style="display: flex; gap: 12px; align-items: center; background: #f0f8ff; padding: 16px; border-radius: 12px; margin-bottom: 12px;">`;

    // Kelly pie chart (SVG, 永遠 full show)
    const kellyAngle = (overall.bestParams.kelly / 0.5) * 360;  // 0.5 = half (100%)
    html += `<svg width="100" height="100" viewBox="0 0 100 100" style="flex-shrink: 0;">`;
    html += `<circle cx="50" cy="50" r="40" fill="#e0e0e0" />`;
    html += `<path d="M 50 10 A 40 40 0 ${kellyAngle > 180 ? 1 : 0} 1 ${50 + 40 * Math.sin(kellyAngle * Math.PI / 180)} ${50 - 40 * Math.cos(kellyAngle * Math.PI / 180)} L 50 50 Z" fill="${kellyColor}" />`;
    html += `<circle cx="50" cy="50" r="25" fill="white" />`;
    html += `<text x="50" y="48" text-anchor="middle" font-size="14" font-weight="bold" fill="${kellyColor}">${kellyPct.toFixed(0)}%</text>`;
    html += `<text x="50" y="62" text-anchor="middle" font-size="9" fill="#666">倉位</text>`;
    html += `</svg>`;

    html += `<div style="flex: 1; line-height: 1.6;">`;
    html += `<p style="margin: 4px 0;"><b>建議倉位 (Kelly):</b> <span style="color: ${kellyColor}; font-weight: bold; font-size: 16px;">${kellyPct.toFixed(1)}%</span> ${kellyPct <= 15 ? '🛡️ 細倉穩陣' : kellyPct <= 30 ? '⚖️ 中倉平衡' : kellyPct <= 45 ? '⚡ 進取' : '🎲 大倉博一博'}</p>`;
    html += `<p style="margin: 4px 0;"><b>RSI 情緒權重:</b> ${(overall.bestParams.rsiWeight * 100).toFixed(0)}%</p>`;
    html += `<p style="margin: 4px 0;"><b>策略權重分配:</b> 均線 ${(overall.bestParams.ssiWeights.ma * 100).toFixed(0)}% · 高低點 ${(overall.bestParams.ssiWeights.hl * 100).toFixed(0)}% · 趨勢線 ${(overall.bestParams.ssiWeights.tl * 100).toFixed(0)}%</p>`;
    html += `</div></div>`;

    // ===== Section 3: 整體表現 (帶 Walk-Forward bar chart 9.7.2) =====
    // 大少 2026-08-10 08:45 fix: 動態化 folds.length (之前 hard-coded "3 段滾動交叉驗證" 但 numFolds 已改 1)
    html += `<h4 style="margin: 16px 0 8px 0; color: #333;">📊 整體表現 (${folds.length} 段滾動交叉驗證)</h4>`;
    const scoreColor = colorByScore(overall.avgValidateScore);
    const stabColor = colorByStability(overall.stabilityScore);
    html += `<div style="background: #f9f9f9; padding: 16px; border-radius: 12px; margin-bottom: 12px;">`;

    // 4 個關鍵指標 (永遠 full show, 大少 11:57 永久 rule)
    html += `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">`;
    html += `<div style="text-align: center; padding: 12px; background: white; border-radius: 8px;"><div style="font-size: 24px; font-weight: bold; color: ${scoreColor};">${overall.avgValidateScore.toFixed(1)}</div><div style="font-size: 12px; color: #666;">平均驗證分數</div></div>`;
    html += `<div style="text-align: center; padding: 12px; background: white; border-radius: 8px;"><div style="font-size: 24px; font-weight: bold; color: ${stabColor};">${(overall.stabilityScore * 100).toFixed(0)}%</div><div style="font-size: 12px; color: #666;">穩定度 (越接近 100% 越穩)</div></div>`;
    html += `<div style="text-align: center; padding: 12px; background: white; border-radius: 8px;"><div style="font-size: 24px; font-weight: bold; color: #333;">${overall.totalValidateSamples}</div><div style="font-size: 12px; color: #666;">真實樣本數</div></div>`;
    html += `<div style="text-align: center; padding: 12px; background: white; border-radius: 8px;"><div style="font-size: 24px; font-weight: bold; color: #333;">${folds.length}</div><div style="font-size: 12px; color: #666;">完成驗證段數</div></div>`;
    html += `</div>`;

    // ===== Section 4: Walk-Forward bar chart (SVG 9.7.2, 動態段數) =====
    if (folds.length > 0) {
      html += `<h5 style="margin: 16px 0 8px 0; color: #555;">🔀 每段驗證嘅表現 (藍 = 校準, 橙 = 真實)</h5>`;
      const maxScore = Math.max(...folds.flatMap(f => [f.tuneScore, f.validateScore]), 100);
      const barW = 280 / folds.length - 8;
      const chartH = 120;
      html += `<svg width="100%" height="${chartH + 30}" viewBox="0 0 300 ${chartH + 30}" style="background: white; border-radius: 8px; padding: 8px;">`;
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
      html += `<span>🟦 校準分 (用歷史 tune 出嘅分)</span><span>🟧 真實分 (用未來 validate 嘅分)</span>`;
      html += `</div>`;
    }
    html += `</div>`;

    // ===== Section 5: Walk-Forward 段細節表 (永遠 full show 9.7.3) =====
    if (folds.length > 0) {
      html += `<h4 style="margin: 16px 0 8px 0; color: #333;">📋 每段嘅最佳設定細節 (永遠 full show)</h4>`;
      html += `<table style="width:100%; border-collapse: collapse; margin-bottom: 12px; background: white; border-radius: 8px; overflow: hidden;">`;
      html += `<tr style="background: #f5f5f5;"><th style="padding: 10px; text-align: left;">段</th><th style="padding: 10px; text-align: right;">建議倉位</th><th style="padding: 10px; text-align: right;">情緒權重</th><th style="padding: 10px; text-align: right;">校準分</th><th style="padding: 10px; text-align: right;">真實分</th><th style="padding: 10px; text-align: right;">樣本數</th></tr>`;
      for (const fold of folds) {
        const fColor = colorByScore(fold.validateScore);
        html += `<tr style="border-bottom: 1px solid #eee;">`;
        html += `<td style="padding: 10px;">第 ${fold.foldIndex + 1} 段</td>`;
        html += `<td style="padding: 10px; text-align: right; color: ${colorByKelly(fold.bestParams.kelly)}; font-weight: bold;">${(fold.bestParams.kelly * 100).toFixed(1)}%</td>`;
        html += `<td style="padding: 10px; text-align: right;">${(fold.bestParams.rsiWeight * 100).toFixed(0)}%</td>`;
        html += `<td style="padding: 10px; text-align: right; color: #1890ff;">${fold.tuneScore.toFixed(1)}</td>`;
        html += `<td style="padding: 10px; text-align: right; color: ${fColor}; font-weight: bold;">${fold.validateScore.toFixed(1)}</td>`;
        html += `<td style="padding: 10px; text-align: right;">${fold.validateSamples}</td>`;
        html += `</tr>`;
      }
      html += `</table>`;
    }

    // ===== Section 6: Forward return history (永遠 full show 9.7.3) =====
    if (forwardReturnHistory.length > 0) {
      html += `<h4 style="margin: 16px 0 8px 0; color: #333;">📜 過往判決記錄 (永久累積, 永遠 full show)</h4>`;
      html += `<p style="font-size: 12px; color: #888; margin-bottom: 8px;">顯示最近 ${forwardReturnHistory.length} 條 (總共可能仲多, 全部永久保留)</p>`;

      // 9.7.2 散點圖 SVG
      const recent20 = forwardReturnHistory.slice(0, 20);
      const scatterW = 600;
      const scatterH = 140;
      html += `<svg width="100%" height="${scatterH}" viewBox="0 0 ${scatterW} ${scatterH}" style="background: white; border-radius: 8px; padding: 8px;">`;
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

      // 詳細表
      html += `<table style="width:100%; border-collapse: collapse; margin-top: 12px; background: white; border-radius: 8px; overflow: hidden; font-size: 13px;">`;
      html += `<tr style="background: #f5f5f5;"><th style="padding: 8px; text-align: left;">日期</th><th style="padding: 8px; text-align: left;">行動</th><th style="padding: 8px; text-align: right;">5 日後</th><th style="padding: 8px; text-align: right;">10 日後</th><th style="padding: 8px; text-align: right;">20 日後</th></tr>`;
      for (const r of forwardReturnHistory) {
        html += `<tr style="border-bottom: 1px solid #f0f0f0;">`;
        html += `<td style="padding: 8px;">${r.date}</td>`;
        html += `<td style="padding: 8px;">${r.action}</td>`;
        html += `<td style="padding: 8px; text-align: right;">${r.fwd5 === null ? '—' : `${hitEmoji(r.hit)} ${r.fwd5 > 0 ? '+' : ''}${r.fwd5.toFixed(2)}%`}</td>`;
        html += `<td style="padding: 8px; text-align: right;">${r.fwd10 === null ? '—' : `${r.fwd10 > 0 ? '+' : ''}${r.fwd10.toFixed(2)}%`}</td>`;
        html += `<td style="padding: 8px; text-align: right;">${r.fwd20 === null ? '—' : `${r.fwd20 > 0 ? '+' : ''}${r.fwd20.toFixed(2)}%`}</td>`;
        html += `</tr>`;
      }
      html += `</table>`;
    }

    // ===== Section 7: 大少話你知 box (9.7.5 LLM hook placeholder) =====
    html += `<div style="background: linear-gradient(135deg, #f6d365 0%, #fda085 100%); color: #333; padding: 16px 20px; border-radius: 12px; margin: 16px 0;">`;
    html += `<h4 style="margin: 0 0 8px 0; font-size: 16px;">📖 大少話你知</h4>`;
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

    // ===== Section 8: Apply to M8 button (9.7.6 真實可 click) =====
    html += `<h4 style="margin: 16px 0 8px 0; color: #333;">🔄 套用呢個設定落第八模組</h4>`;
    html += `<div style="background: #e8f5e9; padding: 16px; border-radius: 12px;">`;
    html += `<p style="margin: 4px 0;">✅ 最佳設定已經自動儲存落 per-symbol 快取 (30 日內有效)。</p>`;
    html += `<p style="margin: 4px 0; font-size: 13px; color: #555;">下次跑 <code>08 — AS-03-DEC</code> 嗰陣, 第八模組會自動用呢個設定 (取代默認)。</p>`;
    html += `<div style="display: flex; gap: 8px; margin-top: 12px;">`;
    html += `<button id="m9-recalibrate-btn" onclick="window.__recalibrateM9Optimal && window.__recalibrateM9Optimal()" style="background: #4CAF50; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: bold;">🔄 重新校準</button>`;
    html += `<button id="m9-apply-btn" onclick="window.__applyM9OptimalToM8 && window.__applyM9OptimalToM8()" style="background: #2196F3; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: bold;">📌 立即套用 (8) M8</button>`;
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

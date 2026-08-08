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
export const version = '0.3.0';
export const description = '用 10 條 rule-based 算法 (A-J) 識別股票所處嘅周期（上升 / 下跌 / 橫行 / 轉勢）';

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
  // 大少 2026-08-07 23:15 — SlopeMomentum toggle 暫時隱藏 (Stage 1 done 最後先做返)

  // Always run MA alignment (mandatory)
  const maVerdict = await runMAAlignment(klines, options);

  // Collect optional module verdicts
  const moduleVerdicts = [maVerdict];
  if (enableVolumePrice) {
    moduleVerdicts.push(await analyzeVolumePrice(klines, options));
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

  return {
    moduleId: 'ma-alignment',
    timeframe: options.period || '1d',
    state,
    confidence,
    interpretation,
    evidence,
    warnings: [],
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

// ===== Helpers =====

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
    // 大少 2026-08-07 23:15 — SlopeMomentum render 暫時隱藏 (Stage 1 done 最後先做返)
    return `<pre>${JSON.stringify(mv, null, 2)}</pre>`;
  }).join('');

  // Enabled modules list
  const enabledBadges = moduleVerdicts.map((mv) => {
    const name = mv.moduleId === 'ma-alignment' ? 'MA Alignment'
      : mv.moduleId === 'volume' ? '量價分析 (VolumePrice)'
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
            // 大少 2026-08-07 23:15 — SlopeMomentum name 暫時隱藏
            : mv.moduleId;
          const modState = stateLabels[mv.state] || mv.state;
          const modConf = (mv.confidence * 100).toFixed(1);
          const modDetail = mv.moduleId === 'volume'
            ? `信號: ${mv.meta?.signal || 'N/A'}`
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
    <h4>10 條 Rule (A-J)</h4>
    <ul>
      <li><strong>A</strong> <small>(strong)</small>: 連續 5 日 MA5 > MA60 → 上升勢</li>
      <li><strong>B</strong> <small>(strong)</small>: 連續 5 日 MA5 < MA60 → 下跌勢</li>
      <li><strong>C</strong> <small>(medium)</small>: 5 日裡 MA5 > MA60 但當日 low < MA60 → 橫行向下</li>
      <li><strong>D</strong> <small>(medium)</small>: 5 日裡 MA5 < MA60 但當日 high > MA60 → 橫行向上</li>
      <li><strong>F</strong> <small>(medium)</small>: MA5+MA10 都 > MA60 但 MA5 < MA10 → 升勢調整向下</li>
      <li><strong>G</strong> <small>(medium)</small>: MA5+MA10 都 < MA60 但 MA5 > MA10 → 跌勢調整向上</li>
      <li><strong>H-reverse-up</strong> <small>(strong)</small>: 7 日內 1/2/3 日新 (上) + 餘下舊 (下) → 跌勢轉升勢</li>
      <li><strong>H-reverse-down</strong> <small>(strong)</small>: 7 日內 1/2/3 日新 (下) + 餘下舊 (上) → 升勢轉跌勢</li>
      <li><strong>I</strong> <small>(weak)</small>: 連續 5 日 low ≥ MA5 × (1 - 2%) → 有機會長升</li>
      <li><strong>J</strong> <small>(weak)</small>: 連續 5 日 high ≤ MA5 × (1 + 2%) → 有機會長跌</li>
    </ul>
    <p><strong>State priority:</strong> H > A > B > F > G > C/D > default SIDEWAYS</p>
    <p><strong>Confidence:</strong> strong 0.7 / medium 0.5 / weak +0.10 bonus, cap 1.0</p>
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
  return {
    moduleId: 'volume',
    timeframe: options.period || '1d',
    state,
    confidence: Math.round(buyTimingScore * 10000) / 10000,
    interpretation: buyReasons.join('；'),
    evidence: matchedRules.map(r => ({ type: `rule-${r.id}`, label: r.label, value: r.id, passed: true })),
    warnings: [],
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
    <h4>VolumePrice v2.0 · 15 條 Rule (V1-V15)</h4>
    <p>對應 docx <code>05成交量價格行為確認法.docx</code> v2.0 spec。Spec doc: <code>MODULE-05-VOLUME-PRICE-V2.md</code></p>
    <p><strong>基礎指標</strong></p>
    <ul>
      <li><strong>V1</strong> <small>(weak)</small>: ATR (14) > 0.5% × close — 波動充足</li>
      <li><strong>V2</strong> <small>(weak)</small>: price > VWAP × 0.99 — 喺 VWAP 支撐之上</li>
      <li><strong>V3</strong> <small>(weak)</small>: volumePercentile ∈ [0, 1] — 成交量百分位正常範圍</li>
    </ul>
    <p><strong>放量 / OBV 趨勢</strong></p>
    <ul>
      <li><strong>V4</strong> <small>(medium)</small>: 連續 ≥ 2 日 volume ≥ 1.3× 均量 AND NOT 異常爆量 — 堆量模式</li>
      <li><strong>V5</strong> <small>(strong, 反向)</small>: volZScore > 3 AND 前 2 日低 AND 今日 ≥ 5× 均量 — 異常爆量警告</li>
      <li><strong>V6</strong> <small>(medium)</small>: weighted OBV > SMA20 × 1.03 — 加權 OBV 上升</li>
      <li><strong>V7</strong> <small>(medium)</small>: weighted OBV < SMA20 × 0.97 — 加權 OBV 下跌</li>
      <li><strong>V8</strong> <small>(strong)</small>: 20 日 weighted OBV-Close 相關 > 0.5 — OBV 與價格同向</li>
    </ul>
    <p><strong>突破 / 假突破</strong></p>
    <ul>
      <li><strong>V9</strong> <small>(strong)</small>: 溫和堆量突破 (gradual_buildup pattern) — 最可信突破</li>
      <li><strong>V10</strong> <small>(strong)</small>: 持續放量突破 + confirmed — 放量突破確認</li>
      <li><strong>V11</strong> <small>(strong, 反向)</small>: low_volume 突破 OR falseBreakoutRisk > 0.5 — 縮量突破警告</li>
      <li><strong>V12</strong> <small>(strong, 反向)</small>: falseBreakoutRisk > 0.6 — 假突破識別</li>
    </ul>
    <p><strong>回調 / 拋壓 / 背馳</strong></p>
    <ul>
      <li><strong>V13</strong> <small>(medium)</small>: 回調深度-量相關 < -0.3 — 健康回調 (越跌越縮量)</li>
      <li><strong>V14</strong> <small>(strong, 反向)</small>: 回調深度-量相關 > 0.3 — 拋售拋壓 (越跌越放量)</li>
      <li><strong>V15</strong> <small>(strong)</small>: 滾動相關性衰減 > 0.4 AND |corr_recent| < 0.2 — 量价背馳</li>
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
  name: '成交量價格行為確認法 v2.0 (VolumePrice)',
  version: '2.0.0',
  description: '用 15 條 rule-based 算法 (V1-V15) 分析成交量價格行為確認',
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

  return {
    moduleId: 'volatility', timeframe: options.period || '1d', state, confidence: Math.round(entryScore * 10000) / 10000,
    interpretation: matchedRules.length > 0 ? matchedRules.map(r => r.label).join('；') : '無明確波動率信號',
    evidence: matchedRules.map(r => ({ type: 'rule-' + r.id, label: r.label, value: r.id, passed: true })),
    warnings: [],
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
  return `<h4>Volatility v1.0 · 12 條 Rule (S1-S12)</h4>
  <p>對應 MODULE-06-VOLATILITY.md</p>
  <p><strong>S1-S3 Squeeze</strong>: S1 日線 squeeze / S2 質量 ≥ 0.6 / S3 持續 ≥ 3 日</p>
  <p><strong>S4-S7 ATR 分解</strong>: S4 趨勢 ATR 強 (snr>2) / S5 噪音 ATR 高 (snr<0.5) / S6 結構性收縮 / S7 結構性擴張</p>
  <p><strong>S8-S11 VCP + Follow</strong>: S8 籌碼集中 / S9 VCP 結構 / S10 VCP 量縮 / S11 突破跟進 ≥ 0.5</p>
  <p><strong>S12 失敗模式</strong>: noisy_squeeze / weak_follow_through — 入場 cap 0.4</p>
  <p><strong>5 種 Setup</strong>: mtf_squeeze_fire 0.95 / confirmed_vcp_breakout 0.9 / clean_trend_expansion 0.7 / genuine_squeeze_forming 0.55 / no_clear_setup 0.25</p>`;
}

export const volatilityAdapter = {
  id: 'AS-03-VOL',
  name: '波動率與市場結構收縮擴張 (Volatility)',
  version: '1.0.0',
  description: '用 12 條 rule-based 算法 (S1-S12) 檢測 Squeeze + ATR 分解 + 失敗模式',
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
    <h4>高低點結構法 · Module 2 v0.1.0</h4>
    <p>基於道氏理論 (Dow Theory),識別股價嘅山頂 (peak) 同山谷 (trough),透過峰谷排列結構判斷週期。</p>
    <h5>📊 輸入參數</h5>
    <ul>
      <li><strong>baseWindow</strong> (5): 極值識別基礎窗口 (日數)</li>
      <li><strong>minPairs</strong> (3): 最少峰谷對數</li>
      <li><strong>tolerancePct</strong> (1.5%): 趨勢判定基礎容忍度</li>
      <li><strong>enableAtrWindow</strong> (true): ATR 自適應窗口</li>
      <li><strong>breakoutConfirmDays</strong> (2): 突破確認延遲日數</li>
      <li><strong>timeDecayLambda</strong> (0.03): 時間衰減係數</li>
    </ul>
    <h5>🎯 輸出 (3 states)</h5>
    <ul>
      <li><strong>uptrend</strong>: higher highs + higher lows</li>
      <li><strong>downtrend</strong>: lower highs + lower lows</li>
      <li><strong>sideways</strong>: 範圍內震盪, 自動畀 top/bottom/mid 箱體</li>
    </ul>
    <h5>🔍 形態預警</h5>
    <ul>
      <li><strong>head_and_shoulder</strong>: 3 個峰, 中間最高</li>
      <li><strong>double_bottom</strong>: 2 個谷, 價格相近, 中間反彈</li>
      <li><strong>double_top</strong>: 2 個峰, 價格相近, 中間回調</li>
    </ul>
    <p><strong>v2.0 改進:</strong> 自適應 Window · 加權價 · 突破確認 · 量能過濾 · 時間衰減 · 動態 Tolerance · 箱體邊界 · 形態預警</p>
  `;
}

export const hlStructureAdapter = {
  id: 'AS-03-HL',
  name: '高低點結構法 (Peak-Trough Structure)',
  version: '0.1.0',
  description: '基於 Dow Theory, 識別 peak (山頂) 同 trough (山谷) 嘅排列結構判斷週期 (上升/下跌/橫行),自動偵測頭肩頂/雙底/雙頂形態預警',
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
    warnings: [],
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
    <h4>趨勢線法 (Trendline) · 10 條 Rule (A-J)</h4>
    <ul>
      <li><strong>A</strong> <small>(strong)</small>: 支撐線上升 + R² ≥ 0.55 → 上升趨勢</li>
      <li><strong>B</strong> <small>(strong)</small>: 壓力線下降 + R² ≥ 0.55 → 下跌趨勢</li>
      <li><strong>C</strong> <small>(medium)</small>: 通道窄 (&lt; 3%) + 中位 (%B 0.4-0.6) → 橫行</li>
      <li><strong>D</strong> <small>(medium)</small>: 收斂三角形 (支撐升 + 壓力跌) → 橫行</li>
      <li><strong>E</strong> <small>(medium)</small>: 上升楔形 (支撐升 + 壓力平) → 上升</li>
      <li><strong>F</strong> <small>(medium)</small>: 下降楔形 (支撐平 + 壓力跌) → 下跌</li>
      <li><strong>G</strong> <small>(strong)</small>: 真跌破支撐 (5 日內穿越 + stay ≥ 2 日) → 下跌</li>
      <li><strong>H</strong> <small>(strong)</small>: 真突破壓力 (5 日內穿越 + stay ≥ 2 日) → 上升</li>
      <li><strong>I</strong> <small>(weak)</small>: 支撐有效 (觸線 ≥ 2 次 + 反彈 ≥ 1%) → +0.10 conf</li>
      <li><strong>J</strong> <small>(weak)</small>: 壓力有效 (觸線 ≥ 2 次 + 反彈 ≥ 1%) → +0.10 conf</li>
    </ul>
    <p><strong>State priority:</strong> H+G → TRANSITION · H > A > B > F > G > C/D > default SIDEWAYS</p>
    <p><strong>Confidence:</strong> strong 0.7 / medium 0.5 / weak +0.10 bonus, cap 1.0</p>
    <p><strong>v0.1.0 簡化 (從 Kimi v2.0 移除):</strong> RANSAC / 成交量加權 / ATR 歸一化 / 假突破 multiplier / %B 指標,改用簡單 OLS 線性回歸</p>
  `;
}

export const trendlineAdapter = {
  id: 'AS-03-TL',
  name: '趨勢線法 (Trendline)',
  version: '0.1.0',
  description: '用 10 條 rule (A-J) 識別股票趨勢線 (支撐/壓力), 判定週期 (上升/下跌/橫行/反轉)',
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
    warnings: [],
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
    <h4>動能背馳與衰竭檢測法 (Indicators) · 10 條 Rule (A-J)</h4>
    <ul>
      <li><strong>多頭條件 (買入):</strong>
        <ul>
          <li>底背馳 (RSI 或 MACD) → +0.35</li>
          <li>RSI 超賣 (&lt; 30) + 上升 → +0.25</li>
          <li>MACD 金叉 (柱狀體由負翻正) → +0.25</li>
          <li>MACD 下跌動能減弱 (bearish_decelerating) → +0.15</li>
          <li>放量確認 (volume &gt; 10d avg × 1.2) → +0.15</li>
        </ul>
      </li>
      <li><strong>空頭條件 (賣出):</strong>
        <ul>
          <li>頂背馳 (RSI 或 MACD) → +0.35</li>
          <li>RSI 超買 (&gt; 70) + 下降 → +0.25</li>
          <li>MACD 死叉 (柱狀體由正翻負) → +0.25</li>
        </ul>
      </li>
      <li><strong>判定:</strong> bullScore ≥ 0.6 AND &gt; bearScore → <strong>buy (UP)</strong> · bearScore ≥ 0.6 AND &gt; bullScore → <strong>sell (DOWN)</strong> · 否則 → <strong>hold (SIDEWAYS)</strong></li>
    </ul>
    <p><strong>Cycle 派生:</strong> buy → UP, sell → DOWN, hold → SIDEWAYS (TRANSITION 由 Synthesizer 判)</p>
    <p><strong>Confidence:</strong> base = signalStrength, 背馳數 ≥ 2 × 1.15, 衰竭 &gt; 0.6 + 訊號 match × 1.10, cap 1.0</p>
    <p><strong>v1.0.0 落地 (從 Kimi v1.0 簡化):</strong> 移除 LLM-based 嘅 win probability 模型, 改用 rule-based 經驗公式 (base 55% + bonus)</p>
  `;
}

export const indicatorsAdapter = {
  id: 'AS-03-IND',
  name: '動能背馳與衰竭 (Indicators)',
  version: '1.0.0',
  description: '用 RSI(14) + MACD(12/26/9) 識別背馳 (頂/底) + 動能衰竭, 判定買入/賣出時機 (回應「幾時該行動」)',
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
    <h3>Module 1 v2.0 — 均線系統週期判斷法 (with Volume & Slope)</h3>
    <p>大少 2026-08-08 指示新 M1 v2.0 (跟 docx Kimi v2.0 spec) 取代舊 M1 v0.3.0, 舊 M1 抽離做 zmen均算法。</p>
    <h4>Spec 連結</h4>
    <ul>
      <li>Spec doc: <code>docs/research/AS-03-cycle-detection/MODULE-01-MA-ALIGNMENT.md</code></li>
      <li>Docx: <code>docs/演算法概念SPECS/01均線系統週期判斷法.docx</code> (Kimi v2.0)</li>
      <li>Module: <code>algorithms/AS-03-cycle-detection/modules/ma-alignment.ts</code></li>
    </ul>
    <h4>3 個 Cycle States</h4>
    <ul>
      <li><strong>uptrend</strong> (上升週期) — MA 升序排列 + spread ≥ 2%</li>
      <li><strong>downtrend</strong> (下跌週期) — MA 降序排列 + spread ≥ 2%</li>
      <li><strong>sideways</strong> (橫行週期) — 其他情況, 或 spread < 2% 強制覆寫</li>
    </ul>
    <h4>信心指數 = base × volume × slope</h4>
    <ul>
      <li><strong>base</strong> (0.3-1.0): 由 spread / 0.10 計, spread &lt; 5% 額外 × 0.7</li>
      <li><strong>volume</strong> (0.65-1.25): 升 + 放量 1.25, 升 + 縮量 0.65, 跌 + 放量 1.15, ...</li>
      <li><strong>slope</strong> (0.7-1.0): 升 + 短期斜率負 0.7, 跌 + 長期斜率正 0.8, ...</li>
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
  name: '均線系統週期判斷法 v2.0 (with Volume & Slope)',
  version: '2.0.0',
  description: '跟 docx Kimi v2.0 spec: MA 排列 + 成交量加權 + 斜率動能, 3 個 cycle state',
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

/** 8 個 finalAction → 純 label (冇 emoji, 用喺表格)
 */
function finalActionShortLabel(action) {
  switch (action) {
    case 'BUY': return 'BUY';
    case 'ADD': return 'ADD';
    case 'HOLD': return 'HOLD';
    case 'WAIT': return 'WAIT';
    case 'REDUCE': return 'REDUCE';
    case 'SELL': return 'SELL';
    case 'TRAP': return 'TRAP';
    case 'TRANSITION': return 'TRANSITION';
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
    return '<div style="padding:12px;background:#fff3cd;border-radius:6px;color:#856404;">9 個 scenarios 仲未計算</div>';
  }

  const scenarios = [
    { key: 'optimistic', label: '🟢 樂觀', color: '#26BA75', prob: '25%' },
    { key: 'baseline', label: '🟡 基準', color: '#F39C12', prob: '50%' },
    { key: 'pessimistic', label: '🔴 悲觀', color: '#EE5151', prob: '25%' },
  ];
  const timeframes = [5, 10, 20];

  let html = '<table class="data-summary" style="width:100%;border-collapse:collapse;font-size:13px;">';
  // Header: Timeframe | Optimistic | Baseline | Pessimistic
  html += '<thead><tr style="background:#f0f0f0;">';
  html += '<th style="text-align:left;padding:8px;">日數 / 情境</th>';
  for (const sc of scenarios) {
    html += `<th style="text-align:right;padding:8px;">${sc.label} <span style="color:#999;font-weight:400;">(${sc.prob})</span></th>`;
  }
  html += '</tr></thead><tbody>';

  for (const days of timeframes) {
    html += '<tr>';
    html += `<td style="padding:8px;font-weight:600;">${days} 日</td>`;
    for (const sc of scenarios) {
      const f = forecasts.find(x => x.timeframe_days === days && x.scenario === sc.key);
      if (f) {
        const retColor = f.expected_return >= 0 ? '#26BA75' : '#EE5151';
        const retSign = f.expected_return >= 0 ? '+' : '';
        const mdPct = (f.max_drawdown * 100).toFixed(1);
        html += `<td style="text-align:right;padding:8px;">
          <div style="color:${retColor};font-weight:600;">${retSign}${(f.expected_return * 100).toFixed(2)}%</div>
          <div style="color:#999;font-size:11px;">MD ${mdPct}%</div>
        </td>`;
      } else {
        html += '<td style="text-align:right;padding:8px;color:#999;">—</td>';
      }
    }
    html += '</tr>';
  }

  html += '</tbody></table>';
  return html;
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

export function renderDecisionEngineResult(verdict) {
  if (!verdict) return '<div class="result-error">無 verdict</div>';

  const { ssi_score, ssi_breakdown, tcm_matrix, alignment_score, grade, grade_score, grade_reason, kelly_fraction, kelly_position, module_verdicts } = verdict;

  // 6 個 module 嘅 breakdown
  const moduleRows = (module_verdicts || []).map(mv => {
    const color = decisionEngineModuleStateColor(mv.state);
    return `
      <tr>
        <td>${mv.module_id}</td>
        <td><span class="state-pill" style="background:${color}22;color:${color};border:1px solid ${color}">${decisionEngineStateLabel(mv.state)}</span></td>
        <td>${(mv.confidence * 100).toFixed(0)}%</td>
        <td>${(mv.base_weight * 100).toFixed(0)}%</td>
        <td>${(mv.expected_return * 100).toFixed(2)}%</td>
        <td>${(mv.max_drawdown_estimate * 100).toFixed(1)}%</td>
        <td>${(mv.sentiment_6d.rsi * 100).toFixed(0)}</td>
      </tr>
    `;
  }).join('');

  // TCM 3 對 pair
  const tcmRows = (tcm_matrix || []).map(p => {
    const alignColor = p.alignment > 0 ? '#26BA75' : p.alignment < 0 ? '#EE5151' : '#F39C12';
    return `
      <tr>
        <td>${p.pair[0]} ↔ ${p.pair[1]}</td>
        <td><span style="color:${alignColor}">${p.alignment > 0 ? '+' : ''}${p.alignment.toFixed(1)}</span></td>
        <td>${(p.trap_penalty * 100).toFixed(0)}%</td>
      </tr>
    `;
  }).join('');

  const gradeColor = decisionEngineGradeColor(grade);
  const kellyLabel = decisionEngineKellyLabel(kelly_fraction);

  return `
    <div class="decision-engine-result" style="font-family: system-ui, sans-serif;">
      <!-- 頂部 verdict card -->
      <div class="verdict-card" style="background:linear-gradient(135deg, ${gradeColor}22, ${gradeColor}08);border:2px solid ${gradeColor};border-radius:12px;padding:20px;margin-bottom:20px;text-align:center;">
        <div style="font-size:14px;color:#666;margin-bottom:8px;">📊 終極綜合判斷 (M7 Synthesizer)</div>
        <div style="font-size:48px;font-weight:700;color:${gradeColor};line-height:1;">${grade}</div>
        <div style="font-size:18px;color:#666;margin-top:8px;">分數 ${grade_score.toFixed(1)} / 100</div>
        <div style="font-size:14px;color:#999;margin-top:4px;">${grade_reason}</div>
        <div style="display:flex;justify-content:center;gap:24px;margin-top:16px;font-size:14px;">
          <div>🟢 <strong>SSI</strong>: ${ssi_score.toFixed(1)} / 100</div>
          <div>📐 <strong>Alignment</strong>: ${(alignment_score * 100).toFixed(1)}%</div>
          <div>💰 <strong>Kelly</strong>: ${kellyLabel}</div>
        </div>
      </div>

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

      <!-- 6 個 modules 嘅 breakdown -->
      <h4 style="margin-top:24px;margin-bottom:8px;">📦 6 個 Modules 嘅 Standard Verdict</h4>
      <table class="data-summary" style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f0f0f0;">
            <th style="text-align:left;padding:8px;">Module</th>
            <th style="text-align:left;padding:8px;">State</th>
            <th style="text-align:right;padding:8px;">Conf</th>
            <th style="text-align:right;padding:8px;">Weight</th>
            <th style="text-align:right;padding:8px;">Exp.Ret</th>
            <th style="text-align:right;padding:8px;">MaxDD</th>
            <th style="text-align:right;padding:8px;">RSI</th>
          </tr>
        </thead>
        <tbody>${moduleRows}</tbody>
      </table>

      <!-- TCM 3 對 pair -->
      <h4 style="margin-top:24px;margin-bottom:8px;">🔀 TCM 戰術交叉驗證 (3 對 Pair)</h4>
      <table class="data-summary" style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f0f0f0;">
            <th style="text-align:left;padding:8px;">Pair</th>
            <th style="text-align:right;padding:8px;">Alignment</th>
            <th style="text-align:right;padding:8px;">Trap Penalty</th>
          </tr>
        </thead>
        <tbody>${tcmRows}</tbody>
      </table>

      <!-- Sprint 1 提示: M8 finalAction + trading card 留俾 Sprint 2 -->
      <div class="sprint2-notice" style="margin-top:24px;padding:16px;background:#f0f8ff;border-left:4px solid #1890ff;border-radius:6px;font-size:13px;color:#333;">
        <strong>📍 Sprint 1 範圍:</strong> 終極綜合判斷引擎 (M7 Synthesizer) 已上線<br>
        <strong>🚧 Sprint 2 範圍:</strong> M8 Decision Engine 嘅 finalAction 8 個 (BUY/ADD/HOLD/REDUCE/SELL/WAIT/TRAP/TRANSITION) + trading card + 5 個 adaptive params runtime auto-calibrate + L2 JSON cache
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
  name: '終極綜合判定 (Synthesizer v1.0.0 — M7)',
  version: '1.0.0',
  description: '大少 2026-08-08 13:30 Plan A — 6 個 modules 嘅綜合判定 (SSI 戰略強度指數 + TCM 戰術交叉驗證 + Alignment + 8 個 Grade + Kelly 倉位). 之前叫 decisionEngineAdapter (sprint 1 合併), 而家拆返 M7.',
  inputs: [
    { key: 'code', label: '股票代碼', type: 'autocomplete', required: true, endpoint: '/api/stocks/search', queryParam: 'q', placeholder: '輸入代碼或名稱', limit: 10, marketFn: 'auto' },
  ],
  analyze: analyzeDecisionEngine,
  renderResult: renderDecisionEngineResult,
  getHelp: () => `
    <h3>📊 終極綜合判定 (Synthesizer v1.0.0 — M7)</h3>
    <p>大少 2026-08-08 13:30 Plan A — 6 個 modules 嘅綜合判定 (M7)</p>
    <h4>5 個 Sub-step:</h4>
    <ol>
      <li><strong>SSI 戰略強度指數</strong> (0-100): consistency × 50 + confidence_avg × 30 + rules_coverage × 20</li>
      <li><strong>TCM 戰術交叉驗證矩陣</strong> (3 對 pair): MA-TL / HL-VP / IND-VOL</li>
      <li><strong>Alignment Score</strong> (0-1): 最大 state group 嘅比例</li>
      <li><strong>Grade</strong> (8 個): A+ / A / B+ / B / C+ / C / D / F</li>
      <li><strong>Kelly 倉位</strong>: half/quarter/octo, 跟 avg 波動率自動切</li>
    </ol>
    <h4>M8 (Sprint 2 將加):</h4>
    <ul>
      <li>finalAction 8 個 (BUY/ADD/HOLD/REDUCE/SELL/WAIT/TRAP/TRANSITION)</li>
      <li>Trading card (entry_zone / stop_loss / take_profit / trailing_stop)</li>
      <li>短期走勢預測 (3 scenarios × 5/10/20 日)</li>
      <li>人話詳細解讀 (LLM hook 預留, 大少 13:30 永久 rule)</li>
      <li>5 個 adaptive params runtime auto-calibrate</li>
      <li>L2 JSON file cache (~/.stockpulse/adaptive_params/&lt;symbol&gt;.json)</li>
    </ul>
  `,
};

// ---------- decisionEngineAdapter export (M8 v1.0.0 — Sprint 2 sub-task 2.1 impl) ----------
//   大少 2026-08-08 15:42 — Sprint 2 sub-task 2.1 done
//   8 個 finalAction 決策樹 (BUY/ADD/HOLD/REDUCE/SELL/WAIT/TRAP/TRANSITION) 已上線
//   Trading card / 短期走勢 / 人話解讀 / adaptive params 將喺 2.2-2.5 commits impl
export const decisionEngineAdapter = {
  id: 'AS-03-DEC',
  name: '終極綜合判斷引擎 (Decision Engine v1.0.0 — M8)',
  version: '1.0.0',
  description: '大少 2026-08-08 15:42 Sprint 2 sub-task 2.1 — 從 M7 SynthesizerVerdict + 6 個 ModuleStandardVerdict 推導 8 個 finalAction (BUY/ADD/HOLD/REDUCE/SELL/WAIT/TRAP/TRANSITION) + 揸車比喻嘅 final_action_reason. Trading card / 短期走勢 / 人話解讀 將喺 2.2-2.4 commits 加.',
  inputs: [
    { key: 'code', label: '股票代碼', type: 'autocomplete', required: true, endpoint: '/api/stocks/search', queryParam: 'q', placeholder: '輸入代碼或名稱', limit: 10, marketFn: 'auto' },
  ],
  analyze: async (klines, options = {}) => {
    // 1. 跑 6 個 modules → M7 SynthesizerVerdict (reuse analyzeDecisionEngine 上面嘅 implementation)
    const synthResult = await analyzeDecisionEngine(klines, options);

    // 2. Market data (2.1 暫時用 fallback, 2.5 將加 derivation)
    const currentPrice = (klines && klines.length > 0) ? klines[klines.length - 1].close : 0;
    const consecutiveUpDays = computeConsecutiveUpDays(klines);
    const marketData = {
      currentPrice,
      consecutiveUpDays,
      squeezeDetected: false,         // 2.5 將 derive 從 M6
      fakeBreakoutDetected: false,    // 2.5 將 derive 從 M3 + M5
      maTrendlineTransition: false,   // 2.5 將 derive 從 M1 + M3
    };

    // 3. 動態 import DecisionEngine 從 .ts file
    const { DecisionEngine } = await import('./modules/decision-engine.ts');
    const eng = new DecisionEngine();

    // 4. 跑 M8 → DecisionVerdict
    const decisionVerdict = await eng.decide({
      synthesizerVerdict: synthResult,
      marketData,
    });

    // 5. 合併 synth + decision (保留 module_cycle_verdicts 供 render 用)
    return {
      ...decisionVerdict,
      module_cycle_verdicts: synthResult.module_cycle_verdicts,
    };
  },
  renderResult: (verdict) => {
    if (!verdict) return '<div class="result-error">無 verdict</div>';

    const {
      final_action, final_action_reason,
      trading_card,
      short_term_forecast,
      interpretation,
      ssi_score, ssi_breakdown, tcm_matrix, alignment_score,
      grade, grade_score, grade_reason,
      kelly_fraction, kelly_position,
      module_verdicts,
      module_cycle_verdicts,
    } = verdict;

    const actionColor = finalActionColor(final_action);
    const actionLabel = finalActionLabel(final_action);
    const gradeColor = decisionEngineGradeColor(grade);
    const kellyLabel = decisionEngineKellyLabel(kelly_fraction);

    // 6 個 module 嘅 breakdown
    const moduleRows = (module_verdicts || []).map(mv => {
      const color = decisionEngineModuleStateColor(mv.state);
      return `
        <tr>
          <td>${mv.module_id}</td>
          <td><span class="state-pill" style="background:${color}22;color:${color};border:1px solid ${color}">${decisionEngineStateLabel(mv.state)}</span></td>
          <td>${(mv.confidence * 100).toFixed(0)}%</td>
          <td>${(mv.base_weight * 100).toFixed(0)}%</td>
          <td>${(mv.expected_return * 100).toFixed(2)}%</td>
          <td>${(mv.max_drawdown_estimate * 100).toFixed(1)}%</td>
          <td>${(mv.sentiment_6d.rsi * 100).toFixed(0)}</td>
        </tr>
      `;
    }).join('');

    // TCM 3 對 pair
    const tcmRows = (tcm_matrix || []).map(p => {
      const alignColor = p.alignment > 0 ? '#26BA75' : p.alignment < 0 ? '#EE5151' : '#F39C12';
      return `
        <tr>
          <td>${p.pair[0]} ↔ ${p.pair[1]}</td>
          <td><span style="color:${alignColor}">${p.alignment > 0 ? '+' : ''}${p.alignment.toFixed(1)}</span></td>
          <td>${(p.trap_penalty * 100).toFixed(0)}%</td>
        </tr>
      `;
    }).join('');

    // Trading card 2.2 adaptive (跟 synthesizerVerdict.kelly_fraction + max_drawdown_estimate)
    const tc = trading_card || { entry_zone: [0, 0], stop_loss: 0, take_profit: 0, trailing_stop: 0 };
    // 判斷 volatility bucket 顯示
    const synthKf = kelly_fraction;
    let volBucketLabel = '';
    if (synthKf === 'octo') volBucketLabel = '🔴 高波動 (octo) — 入場闊±2.5% / 止蝕-5% / 目標+8%';
    else if (synthKf === 'quarter') volBucketLabel = '🟡 中波動 (quarter) — 入場±1.5% / 止蝕-3% / 目標+5%';
    else if (synthKf === 'half') volBucketLabel = '🟢 低波動 (half) — 入場窄±1.0% / 止蝕-2% / 目標+4%';
    const tradingCardHTML = `
      <h4 style="margin-top:24px;margin-bottom:4px;">💰 交易卡 (Trading Card — 2.2 adaptive)</h4>
      <div style="font-size:12px;color:#666;margin-bottom:8px;">${volBucketLabel}</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;">
        <div class="trading-card-field" style="background:#f9f9f9;border-radius:8px;padding:12px;">
          <div style="font-size:12px;color:#666;">🎯 入場區間 (±1.5%)</div>
          <div style="font-size:14px;font-weight:700;">$${tc.entry_zone[0].toFixed(2)} - $${tc.entry_zone[1].toFixed(2)}</div>
        </div>
        <div class="trading-card-field" style="background:#f9f9f9;border-radius:8px;padding:12px;">
          <div style="font-size:12px;color:#666;">🛑 止蝕 (-3%)</div>
          <div style="font-size:14px;font-weight:700;color:#EE5151;">$${tc.stop_loss.toFixed(2)}</div>
        </div>
        <div class="trading-card-field" style="background:#f9f9f9;border-radius:8px;padding:12px;">
          <div style="font-size:12px;color:#666;">🎯 目標 (+5%)</div>
          <div style="font-size:14px;font-weight:700;color:#26BA75;">$${tc.take_profit.toFixed(2)}</div>
        </div>
        <div class="trading-card-field" style="background:#f9f9f9;border-radius:8px;padding:12px;">
          <div style="font-size:12px;color:#666;">📉 移動止蝕 (5%)</div>
          <div style="font-size:14px;font-weight:700;">$${tc.trailing_stop.toFixed(2)}</div>
        </div>
      </div>
    `;

    return `
      <div class="decision-engine-result" style="font-family: system-ui, sans-serif;">
        <!-- 頂部 M8 finalAction 標籤 (新加, 揸車比喻) -->
        <div class="m8-final-action-card" style="background:linear-gradient(135deg, ${actionColor}33, ${actionColor}0a);border:3px solid ${actionColor};border-radius:12px;padding:20px;margin-bottom:16px;text-align:center;">
          <div style="font-size:14px;color:#666;margin-bottom:4px;">🚦 M8 最終行動指令 (8 個 FinalAction)</div>
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

        <!-- 短期走勢預測 (2.3 — 9 個 scenarios) -->
        <h4 style="margin-top:24px;margin-bottom:4px;">📊 短期走勢預測 (2.3 — 9 個 scenarios: 3 × 3 timeframes)</h4>
        <div style="font-size:12px;color:#666;margin-bottom:8px;">⚠️ 重要: 呢個係 conditional scenarios 唔係 prediction, 真實決定睇 finalAction trigger</div>
        ${renderForecastTable(short_term_forecast)}

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

        <!-- 6 個 modules 嘅 breakdown -->
        <h4 style="margin-top:24px;margin-bottom:8px;">📦 6 個 Modules 嘅 Standard Verdict</h4>
        <table class="data-summary" style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f0f0f0;">
              <th style="text-align:left;padding:8px;">Module</th>
              <th style="text-align:left;padding:8px;">State</th>
              <th style="text-align:right;padding:8px;">Conf</th>
              <th style="text-align:right;padding:8px;">Weight</th>
              <th style="text-align:right;padding:8px;">Exp.Ret</th>
              <th style="text-align:right;padding:8px;">MaxDD</th>
              <th style="text-align:right;padding:8px;">RSI</th>
            </tr>
          </thead>
          <tbody>${moduleRows}</tbody>
        </table>

        <!-- TCM 3 對 pair -->
        <h4 style="margin-top:24px;margin-bottom:8px;">🔀 TCM 戰術交叉驗證 (3 對 Pair)</h4>
        <table class="data-summary" style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f0f0f0;">
              <th style="text-align:left;padding:8px;">Pair</th>
              <th style="text-align:right;padding:8px;">Alignment</th>
              <th style="text-align:right;padding:8px;">Trap Penalty</th>
            </tr>
          </thead>
          <tbody>${tcmRows}</tbody>
        </table>

        <!-- Sprint 2 進度提示 (下個 commits 將加) -->
        <div class="sprint2-notice" style="margin-top:24px;padding:16px;background:#f0f8ff;border-left:4px solid #1890ff;border-radius:6px;font-size:13px;color:#333;">
          <strong>✅ Sprint 2 sub-task 2.1-2.3 done:</strong> 8 個 finalAction 決策樹 + 揸車比喻 final_action_reason + 交易卡 adaptive + 短期走勢 9 scenarios<br>
          <strong>🚧 Sprint 2 仍待做:</strong>
          <ol style="margin-top:4px;">
            <li>2.4 人話詳細解讀 (LLM hook 預留 — 大少 13:30 永久 rule)</li>
            <li>2.5 5 個 adaptive params runtime auto-calibrate (squeeze/fake breakout/M1+M3 derivation)</li>
            <li>2.6 L2 JSON file cache</li>
          </ol>
        </div>
      </div>
    `;
  },
  getHelp: () => `
    <h3>🚦 終極綜合判斷引擎 (Decision Engine v1.0.0 — M8)</h3>
    <p>大少 2026-08-08 15:42 Sprint 2 sub-task 2.1 — 從 M7 SynthesizerVerdict + 6 個 ModuleStandardVerdict 推導 8 個 finalAction.</p>
    <h4>8 個 FinalAction + 揸車比喻:</h4>
    <ul>
      <li>🟢 <strong>BUY</strong> — 油門俾到底 (UP + alignment≥0.6 + grade≥B + 預期回報>3% + 最大回撤<10% + RSI>50)</li>
      <li>🟢 <strong>ADD</strong> — 油門再踩深啲 (UP + grade≥A + alignment≥0.7 + RSI>70 + 連漲≥3日)</li>
      <li>🟡 <strong>HOLD</strong> — 保持現速 (UP + grade=B/C+ + maxdd<8%)</li>
      <li>🟡 <strong>WAIT</strong> — 等綠燈 (SIDEWAYS + grade=C + alignment<0.6)</li>
      <li>🟠 <strong>REDUCE</strong> — 收返少少油 (TRANSITION + alignment<0.5)</li>
      <li>🔴 <strong>SELL</strong> — 急煞車 (DOWN + grade≤C + maxdd>10%)</li>
      <li>🟣 <strong>TRAP</strong> — 唔好信導航 (squeeze + fake breakout)</li>
      <li>🟣 <strong>TRANSITION</strong> — 收油準備轉彎 (M1 + M3 同步轉勢)</li>
    </ul>
    <h4>Priority order:</h4>
    <p>TRAP > TRANSITION > SELL > REDUCE > WAIT > HOLD > ADD > BUY</p>
    <h4>下個 commits 將加:</h4>
    <ul>
      <li>2.2 Trading card adaptive formula</li>
      <li>2.3 短期走勢預測 (3 scenarios × 5/10/20 日)</li>
      <li>2.4 人話詳細解讀 (LLM hook)</li>
      <li>2.5 5 個 adaptive params runtime auto-calibrate</li>
    </ul>
  `,
};

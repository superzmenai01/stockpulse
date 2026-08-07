// ~/stockpulse/algorithms/AS-03-cycle-detection/adapter.mjs
//
// AS-03 均線系統週期斷法 — Testing Page Adapter
//
// 將 ma-alignment.ts / volume.ts / slope-momentum.ts 嘅算法 port 到 vanilla JS，
// 供 StockPulse Testing Page (~/stockpulse/testing-page/) 人手測試用。
//
// 統一 interface (Permanent Contract — 所有 AS-XX adapter 都要 implement):
//   export const id, name, version, description
//   export const inputs = [...]
//   export async function analyze(klines, options) → verdict
//   export function renderResult(verdict) → HTML string
//   export function getHelp() → HTML string (optional)
//
// 三個 peer module adapters (大少 #10809):
//   - 預設 exports (id/name/version/...) = ma-alignment adapter (保持 backward compat)
//   - volumePriceAdapter = VolumePrice module adapter
//   - slopeMomentumAdapter = SlopeMomentum module adapter
//
// Source of truth:
//   - ~/stockpulse/algorithms/AS-03-cycle-detection/modules/ma-alignment.ts (v0.3.0) — 大少 #10297/#10299/#10301/#10317/#10332
//   - ~/stockpulse/algorithms/AS-03-cycle-detection/modules/volume.ts (v1.0.0) — 大少 #10809
//   - ~/stockpulse/algorithms/AS-03-cycle-detection/modules/slope-momentum.ts (v1.0.0) — 大少 #10809

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
  //   - 斜率動能 (SlopeMomentum) — state override
  //   - 0/1/2 都可剔，最終由 synthesizer (expert-rules) combine
  {
    key: 'enableVolumePrice',
    label: '量價分析',
    type: 'checkbox',
    default: false,
  },
  {
    key: 'enableSlopeMomentum',
    label: '斜率動能',
    type: 'checkbox',
    default: false,
  },
];

// ===== Main analyze function =====
//
// 大少 #10846 (2026-08-06) — 從 c62d5fcb commit 嘅 module toggle design 延伸到 testing page UI：
//   - 永遠 run MA alignment (mandatory)
//   - options.enableVolumePrice === true  → run VolumePrice module
//   - options.enableSlopeMomentum === true → run SlopeMomentum module
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
  const enableSlopeMomentum = options.enableSlopeMomentum === true;

  // Always run MA alignment (mandatory)
  const maVerdict = await runMAAlignment(klines, options);

  // Collect optional module verdicts
  const moduleVerdicts = [maVerdict];
  if (enableVolumePrice) {
    moduleVerdicts.push(await analyzeVolumePrice(klines, options));
  }
  if (enableSlopeMomentum) {
    moduleVerdicts.push(await analyzeSlopeMomentum(klines, options));
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
//   Step 3 — SlopeMomentum verdict 影響 state:
//             TRANSITION (high conf) → 改 TRANSITION
//             強烈反對 ma-alignment state (high conf) → 改 TRANSITION

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

  const slope = moduleVerdicts.find(v => v.moduleId === 'slope-momentum');
  if (slope) {
    if (slope.state === 'TRANSITION' && slope.confidence > 0.5) {
      if (finalState !== 'TRANSITION') {
        reasons.push(`Slope TRANSITION (high conf) → override → TRANSITION`);
        finalState = 'TRANSITION';
      } else {
        reasons.push(`Slope agrees: TRANSITION`);
      }
    } else if (slope.state !== finalState && slope.confidence > 0.6) {
      reasons.push(`Slope says ${slope.state} (high conf) vs ma-alignment ${finalState} → TRANSITION`);
      finalState = 'TRANSITION';
    } else if (slope.state === finalState) {
      reasons.push(`Slope agrees: ${finalState}`);
    }
  }

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
    if (mv.moduleId === 'slope-momentum') return renderSlopeResult(mv);
    return `<pre>${JSON.stringify(mv, null, 2)}</pre>`;
  }).join('');

  // Enabled modules list
  const enabledBadges = moduleVerdicts.map((mv) => {
    const name = mv.moduleId === 'ma-alignment' ? 'MA Alignment'
      : mv.moduleId === 'volume' ? '量價分析 (VolumePrice)'
      : mv.moduleId === 'slope-momentum' ? '斜率動能 (SlopeMomentum)'
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
            : mv.moduleId === 'slope-momentum' ? '斜率动能 (SlopeMomentum)'
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

  return `
    <div class="as03-verdict as03-module-card">
      <div class="module-card-header">
        <h4>📐 MA Alignment (mandatory)</h4>
      </div>
      <div class="verdict-header">
        <div class="state-pill" style="background: ${color}">
          <span class="state-label">${stateLabel}</span>
          <span class="state-code">${verdict.state}</span>
        </div>
        <div class="confidence">
          <div class="conf-pct">${confidencePct}%</div>
          <div class="conf-label">信心指數</div>
        </div>
        <div class="data-summary">
          <div class="summary-row"><span>時間週期:</span> <strong>${verdict.timeframe}</strong></div>
          <div class="summary-row"><span>數據日數:</span> <strong>${verdict.meta.dataDays}</strong></div>
          <div class="summary-row"><span>Matched Rules:</span> <strong>${matchedRules.length}</strong></div>
        </div>
      </div>

      <div class="interpretation">
        <strong>📌 解讀：</strong>${verdict.interpretation}
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
  consecutiveDays: 5,
  volumeLookback: 20,
  boostThreshold: 1.2,
  shrinkThreshold: 0.8,
  obvLookback: 5,
  divergenceCorrelation: -0.5,
};

export async function analyzeVolumePrice(klines, options = {}) {
  const cfg = { ...DEFAULT_VOLUME_PRICE_CONFIG, ...(options.volumePriceConfig || {}) };

  // Step 1: 數據驗證
  if (!Array.isArray(klines) || klines.length < cfg.volumeLookback) {
    throw new Error(
      `[VolumePrice] Insufficient data: need ≥ ${cfg.volumeLookback} bars, got ${klines?.length ?? 0}`,
    );
  }
  const recent = klines.slice(-Math.max(klines.length, cfg.volumeLookback));

  // Step 2: 計算 OBV + 均量
  const obvHistory = [0];
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1];
    const curr = recent[i];
    if (curr.close > prev.close) {
      obvHistory.push(obvHistory[i - 1] + curr.volume);
    } else if (curr.close < prev.close) {
      obvHistory.push(obvHistory[i - 1] - curr.volume);
    } else {
      obvHistory.push(obvHistory[i - 1]);
    }
  }

  const volMA5History = [];
  const volMA20History = [];
  for (let i = 0; i < recent.length; i++) {
    volMA5History.push(avgField(recent, i, 5, 'volume'));
    volMA20History.push(avgField(recent, i, cfg.volumeLookback, 'volume'));
  }

  const win = cfg.consecutiveDays;
  const last5 = recent.slice(-win);
  const lastClose = last5[last5.length - 1].close;
  const lastVolume = last5[last5.length - 1].volume;
  const lastOBV = obvHistory[obvHistory.length - 1];

  // Step 3: 10 條 rule check
  const matchedRules = [];

  // K. 連續 5 日 close ↑ 且 volume ↑ → 量價齊升確認 (strong)
  if (allIncreasing(last5, 'close') && allIncreasing(last5, 'volume')) {
    matchedRules.push({ id: 'K', label: '量價齊升確認', strength: 'strong' });
  }

  // L. close 創 5 日新高但 volume < 5 日均量 → 量價背馳見頂 (strong)
  const last5Closes = last5.map(k => k.close);
  const maxClose5 = Math.max(...last5Closes);
  const last5VolMA = volMA5History.slice(-win);
  const avgVol5 = last5VolMA[last5VolMA.length - 1];
  if (lastClose === maxClose5 && lastVolume < avgVol5) {
    matchedRules.push({ id: 'L', label: '量價背馳（見頂警號）', strength: 'strong' });
  }

  // M. 連續 5 日 close ↓ 且 volume ↑ → 放量下跌（趨勢確認）(strong)
  if (allDecreasing(last5, 'close') && allIncreasing(last5, 'volume')) {
    matchedRules.push({ id: 'M', label: '放量下跌（趨勢確認）', strength: 'strong' });
  }

  // N. 連續 5 日 close ↓ 但 volume ↓ → 縮量下跌（拋售衰竭）(medium)
  if (allDecreasing(last5, 'close') && allDecreasing(last5, 'volume')) {
    matchedRules.push({ id: 'N', label: '縮量下跌（拋售衰竭）', strength: 'medium' });
  }

  // O. OBV 創 N 日新高 (medium)
  if (obvHistory.length >= cfg.obvLookback + 1) {
    const prevOBV = obvHistory.slice(-cfg.obvLookback - 1, -1);
    const maxPrevOBV = Math.max(...prevOBV);
    if (lastOBV > maxPrevOBV) {
      matchedRules.push({ id: 'O', label: 'OBV 創新高', strength: 'medium' });
    }
  }

  // P. OBV 創 N 日新低 (medium)
  if (obvHistory.length >= cfg.obvLookback + 1) {
    const prevOBV = obvHistory.slice(-cfg.obvLookback - 1, -1);
    const minPrevOBV = Math.min(...prevOBV);
    if (lastOBV < minPrevOBV) {
      matchedRules.push({ id: 'P', label: 'OBV 創新低', strength: 'medium' });
    }
  }

  // Q. 縮量橫行整理 (medium)
  const last5High = Math.max(...last5.map(k => k.high));
  const last5Low = Math.min(...last5.map(k => k.low));
  const last5AvgClose = last5Closes.reduce((a, b) => a + b, 0) / last5Closes.length;
  const maxSpreadPct = last5AvgClose > 0 ? (last5High - last5Low) / last5AvgClose : 0;
  const lastVolMA5 = volMA5History[volMA5History.length - 1];
  const lastVolMA20 = volMA20History[volMA20History.length - 1];
  if (maxSpreadPct < 0.02 && lastVolMA5 < lastVolMA20 * cfg.shrinkThreshold) {
    matchedRules.push({ id: 'Q', label: '縮量橫行整理', strength: 'medium' });
  }

  // R. 放量震盪（醞釀突破）(medium)
  if (maxSpreadPct > 0.03 && lastVolMA5 > lastVolMA20 * cfg.boostThreshold) {
    matchedRules.push({ id: 'R', label: '放量震盪（醞釀突破）', strength: 'medium' });
  }

  // S. OBV vs close correlation < threshold → 量能背馳 (strong)
  let corrValue = null;
  if (obvHistory.length >= win) {
    corrValue = correlation(last5.map(k => k.close), obvHistory.slice(-win));
    if (corrValue < cfg.divergenceCorrelation) {
      matchedRules.push({ id: 'S', label: '量能背馳 (OBV vs close)', strength: 'strong' });
    }
  }

  // T. 5 日均量 < 20 日均量 × 0.5 → 量能不濟 (weak)
  if (lastVolMA5 < lastVolMA20 * 0.5) {
    matchedRules.push({ id: 'T', label: '量能不濟', strength: 'weak' });
  }

  // Step 4: State derivation
  const state = deriveVolumeState(matchedRules);

  // Step 5: Confidence derivation
  const confidence = deriveConfidence(matchedRules);

  // Step 6: Signal derivation (D020)
  const signal = deriveVolumeSignal(matchedRules);

  const interpretation = matchedRules.length > 0
    ? matchedRules.map(r => r.label).join('；')
    : '無 match';

  const evidence = matchedRules.map(r => ({
    type: `rule-${r.id}`,
    label: r.label,
    value: r.id,
    passed: true,
  }));

  return {
    moduleId: 'volume',
    timeframe: options.period || '1d',
    state,
    confidence,
    interpretation,
    evidence,
    warnings: [],
    meta: {
      matchedRules: matchedRules.map(r => r.id),
      ruleLabels: matchedRules.map(r => r.label),
      signal,                                    // D020
      latestOBV: round(lastOBV, 2),
      latestVolMA5: round(lastVolMA5, 2),
      latestVolMA20: round(lastVolMA20, 2),
      latestClose: round(lastClose, 4),
      latestVolume: round(lastVolume, 2),
      maxSpreadPct: round(maxSpreadPct, 4),
      obvCorrelation: corrValue !== null ? round(corrValue, 4) : null,
      dataDays: recent.length,
      configUsed: cfg,
    },
    timestamp: Date.now(),
  };
}

function deriveVolumeState(rules) {
  const ids = new Set(rules.map(r => r.id));
  if (ids.has('K') || ids.has('O')) return 'UP';
  if (ids.has('M') || ids.has('P')) return 'DOWN';
  if (ids.has('L') || ids.has('S')) return 'TRANSITION';
  if (ids.has('N') || ids.has('T')) return 'SIDEWAYS';
  if (ids.has('Q')) return 'SIDEWAYS';
  if (ids.has('R')) return 'TRANSITION';
  return 'SIDEWAYS';
}

function deriveVolumeSignal(rules) {
  const ids = new Set(rules.map(r => r.id));
  if (ids.has('L') || ids.has('S') || ids.has('N')) return 'DISCONFIRM';
  if (ids.has('K') || ids.has('M') || ids.has('O') || ids.has('P')) return 'CONFIRM';
  return 'NEUTRAL';
}

export function renderVolumeResult(verdict) {
  const stateColors = { UP: '#52c41a', DOWN: '#ff4d4f', SIDEWAYS: '#faad14', TRANSITION: '#722ed1' };
  const stateLabels = { UP: '上升', DOWN: '下跌', SIDEWAYS: '橫行', TRANSITION: '轉折' };
  const signalColors = { CONFIRM: '#52c41a', DISCONFIRM: '#ff4d4f', NEUTRAL: '#faad14' };
  const signalLabels = { CONFIRM: '量能確認', DISCONFIRM: '量能反對', NEUTRAL: '中性' };

  const color = stateColors[verdict.state] || '#666';
  const stateLabel = stateLabels[verdict.state] || verdict.state;
  const signalColor = signalColors[verdict.meta.signal] || '#666';
  const signalLabel = signalLabels[verdict.meta.signal] || verdict.meta.signal;
  const confidencePct = (verdict.confidence * 100).toFixed(1);

  const matchedRulesHtml = verdict.meta.matchedRules.length === 0
    ? '<li style="color: #888;">無 rule match</li>'
    : verdict.meta.matchedRules.map((rid) => {
        const ev = verdict.evidence.find((e) => e.value === rid);
        const strengthClass = ['K', 'L', 'M', 'S'].includes(rid) ? 'strong'
          : rid === 'T' ? 'weak'
          : 'medium';
        return `<li class="rule-${strengthClass}"><strong>${rid}</strong> — ${ev ? ev.label : ''} <small>(${strengthClass})</small></li>`;
      }).join('');

  return `
    <div class="as03-verdict as03-module-card">
      <div class="module-card-header">
        <h3 class="module-header">量价分析 (VolumePrice)</h3>
      </div>
      <div class="verdict-header">
        <div class="state-pill" style="background: ${color}">
          <span class="state-label">${stateLabel}</span>
          <span class="state-code">${verdict.state}</span>
        </div>
        <div class="signal-pill" style="background: ${signalColor}">
          <span class="signal-label">${signalLabel}</span>
          <span class="signal-code">${verdict.meta.signal}</span>
        </div>
        <div class="confidence">
          <div class="conf-pct">${confidencePct}%</div>
          <div class="conf-label">信心指數</div>
        </div>
        <div class="data-summary">
          <div class="summary-row"><span>時間週期:</span> <strong>${verdict.timeframe}</strong></div>
          <div class="summary-row"><span>數據日數:</span> <strong>${verdict.meta.dataDays}</strong></div>
          <div class="summary-row"><span>Matched Rules:</span> <strong>${verdict.meta.matchedRules.length}</strong></div>
        </div>
      </div>

      <div class="interpretation">
        <strong>📌 解讀：</strong>${verdict.interpretation}
      </div>

      <div class="interpretation-panel">
        <strong>📖 點樣用：</strong>${getVolumeInterpretation(verdict.meta.signal)}
      </div>

      <div class="volume-values">
        <h4>當前 Volume / OBV 值</h4>
        <div class="vol-grid">
          <div class="vol-item"><span class="vol-label">Vol MA5</span><span class="vol-value">${verdict.meta.latestVolMA5}</span></div>
          <div class="vol-item"><span class="vol-label">Vol MA20</span><span class="vol-value">${verdict.meta.latestVolMA20}</span></div>
          <div class="vol-item"><span class="vol-label">OBV</span><span class="vol-value">${verdict.meta.latestOBV}</span></div>
          <div class="vol-item"><span class="vol-label">Max Spread</span><span class="vol-value">${(verdict.meta.maxSpreadPct * 100).toFixed(2)}%</span></div>
        </div>
      </div>

      <div class="matched-rules">
        <h4>🎯 Matched Rules（${verdict.meta.matchedRules.length} 條）</h4>
        <ul>${matchedRulesHtml}</ul>
      </div>

      <details class="meta-details">
        <summary>🔧 配置（debug 用）</summary>
        <pre>${JSON.stringify(verdict.meta.configUsed, null, 2)}</pre>
      </details>
    </div>
  `;
}

export function getVolumeHelp() {
  return `
    <h4>VolumePrice · 10 條 Rule (K-T)</h4>
    <ul>
      <li><strong>K</strong> <small>(strong)</small>: 連續 5 日 close ↑ 且 volume ↑ → 量價齊升確認</li>
      <li><strong>L</strong> <small>(strong)</small>: close 創 5 日新高但 volume < 5 日均量 → 量價背馳見頂</li>
      <li><strong>M</strong> <small>(strong)</small>: 連續 5 日 close ↓ 且 volume ↑ → 放量下跌</li>
      <li><strong>N</strong> <small>(medium)</small>: 連續 5 日 close ↓ 但 volume ↓ → 縮量下跌（拋售衰竭）</li>
      <li><strong>O</strong> <small>(medium)</small>: OBV 創 N 日新高</li>
      <li><strong>P</strong> <small>(medium)</small>: OBV 創 N 日新低</li>
      <li><strong>Q</strong> <small>(medium)</small>: 縮量橫行整理 (spread &lt; 2% + volMA5 &lt; volMA20 × 0.8)</li>
      <li><strong>R</strong> <small>(medium)</small>: 放量震盪 (spread &gt; 3% + volMA5 &gt; volMA20 × 1.2)</li>
      <li><strong>S</strong> <small>(strong)</small>: OBV vs close 5 日 correlation &lt; -0.5 → 量能背馳</li>
      <li><strong>T</strong> <small>(weak)</small>: volMA5 &lt; volMA20 × 0.5 → 量能不濟</li>
    </ul>
    <p><strong>State priority:</strong> K/O → UP · M/P → DOWN · L/S → TRANSITION · N/T/Q → SIDEWAYS · R → TRANSITION</p>
    <p><strong>Signal:</strong> K/M/O/P → CONFIRM · L/S/N → DISCONFIRM · Q/R/T → NEUTRAL</p>
    <p><strong>D012 Option B:</strong> VolumePrice 唔直接出 cycle verdict，出 confirm/disconfirm signal 畀 synthesizer 整合</p>
  `;
}

export const volumePriceAdapter = {
  id: 'AS-03-VP',
  name: '量價分析 (VolumePrice)',
  version: '1.0.0',
  description: '用 10 條 rule (K-T) 識別量價關係，emit confirm/disconfirm signal',
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
  analyze: analyzeVolumePrice,
  renderResult: renderVolumeResult,
  getHelp: getVolumeHelp,
};

// =============================================================================
// 大少 #10809 — Module 8 SlopeMomentum (v1.0.0) — 跟 ma-alignment pattern 一致 (D018)
// =============================================================================
//
// 10 條 rule M1-M10（port 自 modules/slope-momentum.ts v1.0.0）：
//   Step 1 — 數據驗證（< longPeriod 報錯）
//   Step 2 — 計算 MA5/MA10/MA60 history + 各 slope history
//   Step 3 — 10 條 rule check (M1-M10)
//   Step 4 — State derivation (M7/M8→TRANSITION · M1/M3/M5/M10→UP · M2/M4/M6→DOWN · M9→SIDEWAYS)
//   Step 5 — Confidence derivation (同 ma-alignment pattern)

const DEFAULT_SLOPE_MOMENTUM_CONFIG = {
  shortPeriod: 5,
  midPeriod: 10,
  longPeriod: 20,
  shortSlopeThreshold: 0.005,
  midSlopeThreshold: 0.003,
  longSlopeThreshold: 0.002,
  reversalWindow: 5,
};

export async function analyzeSlopeMomentum(klines, options = {}) {
  const cfg = { ...DEFAULT_SLOPE_MOMENTUM_CONFIG, ...(options.slopeMomentumConfig || {}) };

  if (!Array.isArray(klines) || klines.length < cfg.longPeriod) {
    throw new Error(
      `[SlopeMomentum] Insufficient data: need ≥ ${cfg.longPeriod} bars, got ${klines?.length ?? 0}`,
    );
  }
  const recent = klines.slice(-Math.max(klines.length, cfg.longPeriod * 3));

  const ma5History = [];
  const ma10History = [];
  const ma60History = [];
  for (let i = 0; i < recent.length; i++) {
    ma5History.push(avgClose(recent, i, 5));
    ma10History.push(avgClose(recent, i, 10));
    ma60History.push(avgClose(recent, i, cfg.longPeriod));
  }

  const slopeMA5 = [];
  const slopeMA10 = [];
  const slopeMA60 = [];
  const slopeMA5Daily = [];
  for (let i = 0; i < recent.length; i++) {
    slopeMA5.push(computeSlope(ma5History, i, cfg.shortPeriod));
    slopeMA10.push(computeSlope(ma10History, i, cfg.midPeriod));
    slopeMA60.push(computeSlope(ma60History, i, cfg.longPeriod));
    slopeMA5Daily.push(computeSlope(ma5History, i, 1));
  }

  const lastIdx = recent.length - 1;
  const latestSlopeMA5 = slopeMA5[lastIdx];
  const latestSlopeMA10 = slopeMA10[lastIdx];
  const latestSlopeMA60 = slopeMA60[lastIdx];

  const matchedRules = [];

  // M1. MA5 短期加速上升 (strong)
  if (latestSlopeMA5 > cfg.shortSlopeThreshold &&
      allStrictlyIncreasing(slopeMA5Daily, Math.max(0, lastIdx - 2), 3)) {
    matchedRules.push({ id: 'M1', label: 'MA5 短期加速上升', strength: 'strong' });
  }

  // M2. MA5 短期加速下跌 (strong)
  if (latestSlopeMA5 < -cfg.shortSlopeThreshold &&
      allStrictlyDecreasing(slopeMA5Daily, Math.max(0, lastIdx - 2), 3)) {
    matchedRules.push({ id: 'M2', label: 'MA5 短期加速下跌', strength: 'strong' });
  }

  // M3. MA10 中期斜率上升 (medium)
  if (latestSlopeMA10 > cfg.midSlopeThreshold) {
    matchedRules.push({ id: 'M3', label: 'MA10 中期斜率上升', strength: 'medium' });
  }

  // M4. MA10 中期斜率下跌 (medium)
  if (latestSlopeMA10 < -cfg.midSlopeThreshold) {
    matchedRules.push({ id: 'M4', label: 'MA10 中期斜率下跌', strength: 'medium' });
  }

  // M5. MA60 長期斜率上升 (medium)
  if (latestSlopeMA60 > cfg.longSlopeThreshold) {
    matchedRules.push({ id: 'M5', label: 'MA60 長期斜率上升', strength: 'medium' });
  }

  // M6. MA60 長期斜率下跌 (medium)
  if (latestSlopeMA60 < -cfg.longSlopeThreshold) {
    matchedRules.push({ id: 'M6', label: 'MA60 長期斜率下跌', strength: 'medium' });
  }

  // M7. 短期斜率轉正 (strong)
  if (slopeCrossedZero(slopeMA5, lastIdx, cfg.reversalWindow, 'positive')) {
    matchedRules.push({ id: 'M7', label: '短期斜率轉正（趨勢轉強）', strength: 'strong' });
  }

  // M8. 短期斜率轉負 (strong)
  if (slopeCrossedZero(slopeMA5, lastIdx, cfg.reversalWindow, 'negative')) {
    matchedRules.push({ id: 'M8', label: '短期斜率轉負（趨勢轉弱）', strength: 'strong' });
  }

  // M9. 動能減弱 (weak)
  if (Math.abs(latestSlopeMA5) < 0.001) {
    matchedRules.push({ id: 'M9', label: '動能減弱', strength: 'weak' });
  }

  // M10. 動能加強 (weak)
  if (Math.abs(latestSlopeMA5) > cfg.shortSlopeThreshold) {
    matchedRules.push({ id: 'M10', label: '動能加強', strength: 'weak' });
  }

  const state = deriveSlopeState(matchedRules);
  const confidence = deriveConfidence(matchedRules);
  const interpretation = matchedRules.length > 0
    ? matchedRules.map(r => r.label).join('；')
    : '無 match';

  const evidence = matchedRules.map(r => ({
    type: `rule-${r.id}`,
    label: r.label,
    value: r.id,
    passed: true,
  }));

  return {
    moduleId: 'slope-momentum',
    timeframe: options.period || '1d',
    state,
    confidence,
    interpretation,
    evidence,
    warnings: [],
    meta: {
      matchedRules: matchedRules.map(r => r.id),
      ruleLabels: matchedRules.map(r => r.label),
      latestSlopeMA5: round(latestSlopeMA5, 6),
      latestSlopeMA10: round(latestSlopeMA10, 6),
      latestSlopeMA60: round(latestSlopeMA60, 6),
      latestMA5: round(ma5History[lastIdx], 4),
      latestMA10: round(ma10History[lastIdx], 4),
      latestMA60: round(ma60History[lastIdx], 4),
      dataDays: recent.length,
      configUsed: cfg,
    },
    timestamp: Date.now(),
  };
}

function deriveSlopeState(rules) {
  const ids = new Set(rules.map(r => r.id));
  if (ids.has('M7') || ids.has('M8')) return 'TRANSITION';
  if (ids.has('M1') || ids.has('M3') || ids.has('M5')) return 'UP';
  if (ids.has('M2') || ids.has('M4') || ids.has('M6')) return 'DOWN';
  if (ids.has('M10')) return 'UP';
  if (ids.has('M9')) return 'SIDEWAYS';
  return 'SIDEWAYS';
}

function slopeCrossedZero(slopeHistory, endIdx, window, direction) {
  const startIdx = Math.max(0, endIdx - window + 1);
  if (endIdx - startIdx < 1) return false;

  const latestSlope = slopeHistory[endIdx];
  const targetSign = direction === 'positive' ? 1 : -1;

  // 當前必須係目標 sign (strict)
  if (latestSlope * targetSign <= 0) return false;

  // 喺 window 範圍內必須有對面 sign
  for (let i = startIdx; i < endIdx; i++) {
    if (slopeHistory[i] * (-targetSign) > 0) return true;
  }
  return false;
}

export function renderSlopeResult(verdict) {
  const stateColors = { UP: '#52c41a', DOWN: '#ff4d4f', SIDEWAYS: '#faad14', TRANSITION: '#722ed1' };
  const stateLabels = { UP: '上升', DOWN: '下跌', SIDEWAYS: '橫行', TRANSITION: '轉折' };

  const color = stateColors[verdict.state] || '#666';
  const stateLabel = stateLabels[verdict.state] || verdict.state;
  const confidencePct = (verdict.confidence * 100).toFixed(1);

  const matchedRulesHtml = verdict.meta.matchedRules.length === 0
    ? '<li style="color: #888;">無 rule match</li>'
    : verdict.meta.matchedRules.map((rid) => {
        const ev = verdict.evidence.find((e) => e.value === rid);
        const strengthClass = ['M1', 'M2', 'M7', 'M8'].includes(rid) ? 'strong'
          : ['M9', 'M10'].includes(rid) ? 'weak'
          : 'medium';
        return `<li class="rule-${strengthClass}"><strong>${rid}</strong> — ${ev ? ev.label : ''} <small>(${strengthClass})</small></li>`;
      }).join('');

  return `
    <div class="as03-verdict as03-module-card">
      <div class="module-card-header">
        <h3 class="module-header">斜率动能 (SlopeMomentum)</h3>
      </div>
      <div class="verdict-header">
        <div class="state-pill" style="background: ${color}">
          <span class="state-label">${stateLabel}</span>
          <span class="state-code">${verdict.state}</span>
        </div>
        <div class="confidence">
          <div class="conf-pct">${confidencePct}%</div>
          <div class="conf-label">信心指數</div>
        </div>
        <div class="data-summary">
          <div class="summary-row"><span>時間週期:</span> <strong>${verdict.timeframe}</strong></div>
          <div class="summary-row"><span>數據日數:</span> <strong>${verdict.meta.dataDays}</strong></div>
          <div class="summary-row"><span>Matched Rules:</span> <strong>${verdict.meta.matchedRules.length}</strong></div>
        </div>
      </div>

      <div class="interpretation">
        <strong>📌 解讀：</strong>${verdict.interpretation}
      </div>

      <div class="interpretation-panel">
        <strong>📖 點樣用：</strong>${getSlopeInterpretation(verdict.state, verdict.meta.matchedRules)}
      </div>

      <div class="slope-values">
        <h4>當前 Slope 值</h4>
        <div class="slope-grid">
          <div class="slope-item"><span class="slope-label">Slope MA5</span><span class="slope-value">${(verdict.meta.latestSlopeMA5 * 100).toFixed(3)}%</span></div>
          <div class="slope-item"><span class="slope-label">Slope MA10</span><span class="slope-value">${(verdict.meta.latestSlopeMA10 * 100).toFixed(3)}%</span></div>
          <div class="slope-item"><span class="slope-label">Slope MA60</span><span class="slope-value">${(verdict.meta.latestSlopeMA60 * 100).toFixed(3)}%</span></div>
        </div>
      </div>

      <div class="matched-rules">
        <h4>🎯 Matched Rules（${verdict.meta.matchedRules.length} 條）</h4>
        <ul>${matchedRulesHtml}</ul>
      </div>

      <details class="meta-details">
        <summary>🔧 配置（debug 用）</summary>
        <pre>${JSON.stringify(verdict.meta.configUsed, null, 2)}</pre>
      </details>
    </div>
  `;
}

export function getSlopeHelp() {
  return `
    <h4>SlopeMomentum · 10 條 Rule (M1-M10)</h4>
    <ul>
      <li><strong>M1</strong> <small>(strong)</small>: slope(MA5, 5) &gt; +0.5% + 連續 3 日 slope(MA5, 1) ↑ → MA5 短期加速上升</li>
      <li><strong>M2</strong> <small>(strong)</small>: slope(MA5, 5) &lt; -0.5% + 連續 3 日 slope(MA5, 1) ↓ → MA5 短期加速下跌</li>
      <li><strong>M3</strong> <small>(medium)</small>: slope(MA10, 10) &gt; +0.3% → MA10 中期斜率上升</li>
      <li><strong>M4</strong> <small>(medium)</small>: slope(MA10, 10) &lt; -0.3% → MA10 中期斜率下跌</li>
      <li><strong>M5</strong> <small>(medium)</small>: slope(MA60, 20) &gt; +0.2% → MA60 長期斜率上升</li>
      <li><strong>M6</strong> <small>(medium)</small>: slope(MA60, 20) &lt; -0.2% → MA60 長期斜率下跌</li>
      <li><strong>M7</strong> <small>(strong)</small>: 短期斜率 5 日內由負轉正（轉折點）→ 趨勢轉強</li>
      <li><strong>M8</strong> <small>(strong)</small>: 短期斜率 5 日內由正轉負（轉折點）→ 趨勢轉弱</li>
      <li><strong>M9</strong> <small>(weak)</small>: |slope(MA5, 5)| &lt; 0.1% → 動能減弱</li>
      <li><strong>M10</strong> <small>(weak)</small>: |slope(MA5, 5)| &gt; 0.5% → 動能加強</li>
    </ul>
    <p><strong>State priority:</strong> M7/M8 → TRANSITION · M1/M3/M5/M10 → UP · M2/M4/M6 → DOWN · M9 → SIDEWAYS</p>
    <p><strong>D013 大少改主意:</strong> Slope 原本屬 MA alignment 嘅 modifier (#10809 獨立做 peer module)</p>
  `;
}

export const slopeMomentumAdapter = {
  id: 'AS-03-SM',
  name: '斜率動能 (SlopeMomentum)',
  version: '1.0.0',
  description: '用 10 條 rule (M1-M10) 分析 MA 短期/中期/長期斜率動能',
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
  analyze: analyzeSlopeMomentum,
  renderResult: renderSlopeResult,
  getHelp: getSlopeHelp,
};

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
// Shared helpers (VolumePrice + SlopeMomentum use these)
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

  const patternText = {
    'head_and_shoulder': '⚠️ 頭肩頂 (可能見頂)',
    'double_bottom': '✓ 雙底 (可能見底)',
    'double_top': '⚠️ 雙頂 (可能見頂)',
    'none': '無形態預警',
  }[verdict.pattern_alert] || '無形態預警';

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
          <div class="conf-label">信心指數</div>
        </div>
        <div class="data-summary">
          <div class="summary-row"><span>峰點:</span> <strong>${verdict.peaks.length}</strong></div>
          <div class="summary-row"><span>谷點:</span> <strong>${verdict.troughs.length}</strong></div>
          <div class="summary-row"><span>結構分數:</span> <strong>${verdict.structure_score}</strong></div>
        </div>
      </div>

      <div class="interpretation">
        <strong>📌 判斷：</strong>${verdict.reason}
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
          <div class="conf-label">信心指數</div>
        </div>
        <div class="data-summary">
          <div class="summary-row"><span>時間週期:</span> <strong>${verdict.timeframe}</strong></div>
          <div class="summary-row"><span>數據日數:</span> <strong>${verdict.meta.dataDays}</strong></div>
          <div class="summary-row"><span>Matched Rules:</span> <strong>${matchedRules.length}</strong></div>
        </div>
      </div>

      <div class="interpretation">
        <strong>📌 解讀：</strong>${verdict.interpretation}
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
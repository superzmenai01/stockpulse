// ~/stockpulse/testing-page/testing-page.js
//
// StockPulse Algorithm Testing Page — Logic
//
// 架構（永久 design）：
//   - Algorithm Registry (hard-code) — 加新 AS-XX 只需要加 1 行
//   - 動態 import adapter.mjs
//   - Adapter 提供統一 interface:
//       id, name, version, description, inputs
//       async function analyze(klines, options) → verdict
//       function renderResult(verdict) → HTML string
//       function getHelp() → HTML string (optional)
//
// Backend: 從 StockPulse backend (localhost:18792) 攞 K 線 + 股票搜尋
// CORS: backend 已 enable allow_origins=["*"] 開發階段

const BACKEND_URL = 'http://localhost:18792';

// ===== Algorithm Registry（永久 design）=====
// 加新 algorithm: 寫 algorithms/AS-XX/adapter.mjs + 加 1 行去呢度
//
// adapterExport (optional): 如果 adapter.mjs export 多過一個 adapter,
//   用呢個 field 指定要攞邊一個 named export
//   例: adapterExport: 'volumePriceAdapter' 會取 adapter.volumePriceAdapter
//
// === 大少 2026-08-08 08:47 + 09:13 + 10:06 + 11:22 指示 ===
// 08:47 — 舊 M1「均線系統週期斷法」改名「zmen均算法」, 從 7 個 modules 抽離
//        (唔屬於 AS-03 7 個 modules 計算)。REGISTRY array 將 zmen均算法
//        放最尾, 7 個 modules 嘅 M2-M6 排位不變。
// 09:13 — 新 M1「均線系統週期判斷法 v2.0」跟 docx Kimi v2.0 spec 全新做
//        (3 cycles + 成交量加權 + 斜率動能), file 佔用返 ma-alignment.ts
//        + spec MODULE-01-MA-ALIGNMENT.md
// 09:50 — 改名「zmen均算去」→「zmen均算法」(typo 修正)
// 10:06 — 6 個 modules 加編號 01-06 喺 dropdown displayName
// 11:22 — M7 Synthesizer + M8 Decision Engine 合併做 1 個 mega module
//        (testing page 1 個 entry "08 — AS-03-ENG" 排 [6], spec 拆 2 份 reference
//        MODULE-07-08-DECISION-ENGINE.md, codebase 1 個 file modules/decision-engine.ts)
// 12:02 — Stage 1 收官 spec + doc 同步, M7+M8 merged mega module spec done (impl pending),
//        等大少 review + confirm Plan A (Sprint 1: 6 個 modules 加 output fields + M7 impl;
//        Sprint 2: M8 decision tree + trading card + 5 adaptive params + L2 cache)
// ===========================================================================

// 大少 2026-08-09 13:00 Bug 3+4 fix: testing page cache bust adapterPath
// 之前 testing-page.js 嘅 HTML cache bust (?v=2.3.X) 唔影響 .mjs 嘅 load,
// 改 algorithms/AS-03-cycle-detection/adapter.mjs 之後 browser 仍 load 緊 cached 舊 version
// Fix: 將 ALGO_CACHE_BUST 加落每個 adapterPath 嘅 query string, 改 .mjs 之後要 bump
// 永久 rule: 改 algorithms/AS-03-cycle-detection/adapter.mjs 之後, 同時 bump testing-page/index.html
//          嘅 ?v=2.3.X + testing-page.js 嘅 ALGO_CACHE_BUST (2 個地方)
// 大少 Bug 3+4 fix 第一次用: ALGO_CACHE_BUST = '1.8.0' (AS-03-DEC 嘅 M8 v1.0.0 → v1.8.0)
// 大少 2026-08-09 13:15 Spec Sync #7: ALGO_CACHE_BUST = '2.0.0' (AS-03-DEC v1.8.0 → v2.0.0 Sprint 2 收官)
// 大少 2026-08-09 19:06 兩線策略: ALGO_CACHE_BUST = '2.1.0' (AS-03-DEC v2.0.0 → v2.1.0 加 strategyMode + cycle-synthesizer)
// 大少 2026-08-09 21:06 兩線策略 cosmetic fix: ALGO_CACHE_BUST = '2.1.1' (Position Trading Card MA5/MA20 顯示 N/A 而唔係 $0.00)
// 大少 2026-08-09 21:30 M5 Multi-TF impl: ALGO_CACHE_BUST = '2.2.0' (M5 Multi-TF v1.0.0 入口 + analyzeMultiTF + renderMultiTFResult)
// 大少 2026-08-09 22:34 M8 SlopeMomentum impl: ALGO_CACHE_BUST = '2.3.0' (舊 M8 v1.0.0 re-elevate 入口 + analyzeSlopeMomentum + renderSlopeMomentumResult)
// 大少 2026-08-10 00:13 M11 Backtest Timeline impl: ALGO_CACHE_BUST = '2.4.0' (M11 Backtest Timeline v0.1.0 入口 + analyzeBacktestTimeline + renderTimelineResult)
// 大少 2026-08-10 00:42 M11 empty state 引導 M9: ALGO_CACHE_BUST = '2.5.0' (renderTimelineResult empty state 加 M9 引導 step 1-4)
// 大少 2026-08-10 07:20 Bug 1 fix: ALGO_CACHE_BUST = '2.6.0' (postJSON helper + 3 個 POST check response.ok + UI error banner + K 線 debug log)
// 大少 2026-08-10 07:35 fix: ALGO_CACHE_BUST = '2.6.1' (debug log 擺去 normalizedKlines 之後, 避免 raw timestamp 係 string/undefined 嘅 crash)
// 大少 2026-08-10 08:10 fix: ALGO_CACHE_BUST = '2.6.2' (back-test.ts runReplay 唔再 sub-set lookbackDays, 用累積 K 線避免 HLStructure ≥99 bars gate 失敗)
// 大少 2026-08-10 08:45 fix: ALGO_CACHE_BUST = '2.6.6' (dataWindowDays 252 → 1260 + UI label 動態 folds.length)
// 大少 2026-08-10 21:35 M7 UI 顯示優化 v3: ALGO_CACHE_BUST = '3.0.0' (自訂 CSS tooltip 即時顯示 + 大字 14px + responsive auto layout)
// 大少 2026-08-10 22:00 M7 UI 顯示優化 v5: ALGO_CACHE_BUST = '3.2.0' (6 模組 table 對齊 + TCM 解讀 box 1.5x 大 + TCM 配對 table column 加闊)
// 大少 2026-08-10 22:15 M7 UI 顯示優化 v6: ALGO_CACHE_BUST = '3.3.0' (TCM 配對 table column 平 min-width 150/150/150 1:1:1 對齊)
// 大少 2026-08-10 22:50 M7 稱呼改: ALGO_CACHE_BUST = '3.4.0' (「校長/老師」→ 「演算法/Synthesizer」更專業)
// 大少 2026-08-10 23:00 M8 v2 中文化: ALGO_CACHE_BUST = '3.5.0' (Standard Verdict 中文化 + TCM 中文 + 短期走勢對齊 + trading card 加現價 + popup tooltip)
// 大少 2026-08-11 M8 v3.8 fix: ALGO_CACHE_BUST = '3.8.0' (M8 v3.7 → v3.8.0 改動: 中長線交易卡加返「現價」 field, 跟短炒一樣 (黃色背景 + 休市標記 + popup), grid 3→4 columns, 用 meta.currentPrice 拎)
const ALGO_CACHE_BUST = '3.8.0';

const REGISTRY = [
  // ---- AS-03 7 個 modules (M1 done v2.0, M2-M6 done, M7 仍 Pending) ----
  // M1: 均線系統週期判斷法 v2.0 (with Volume & Slope 擴展)
  //   大少 2026-08-08 09:13 指示: 跟 docx Kimi v2.0 spec 做全新 implementation
  //   3 個 cycle states + 13 個 output fields + 三階段信心調整
  {
    id: 'AS-03-MA',
    displayName: '01 — AS-03-MA',  // 大少 2026-08-08 10:06: 編號 01 = M1 (新均線系統週期判斷法 v2.0)
    folder: 'AS-03-cycle-detection',
    adapterPath: '../algorithms/AS-03-cycle-detection/adapter.mjs',
    adapterExport: 'maAlignmentV2Adapter',
  },
  // M2: 高低點結構法 (原本 M2, 排位不變)
  {
    id: 'AS-03-HL',
    displayName: '02 — AS-03-HL',  // 大少 2026-08-08 10:06: 編號 02 = M2 (高低點結構法)
    folder: 'AS-03-cycle-detection',
    adapterPath: '../algorithms/AS-03-cycle-detection/adapter.mjs',
    adapterExport: 'hlStructureAdapter',
  },
  // M3: 趨勢線法
  {
    id: 'AS-03-TL',
    displayName: '03 — AS-03-TL',  // 大少 2026-08-08 10:06: 編號 03 = M3 (趨勢線法)
    folder: 'AS-03-cycle-detection',
    adapterPath: '../algorithms/AS-03-cycle-detection/adapter.mjs',
    adapterExport: 'trendlineAdapter',
  },
  // M4: 動能背馳與衰竭
  {
    id: 'AS-03-IND',
    displayName: '04 — AS-03-IND',  // 大少 2026-08-08 10:06: 編號 04 = M4 (動能背馳與衰竭)
    folder: 'AS-03-cycle-detection',
    adapterPath: '../algorithms/AS-03-cycle-detection/adapter.mjs',
    adapterExport: 'indicatorsAdapter',
  },
  // M5: 成交量價格行為確認 v2.0
  {
    id: 'AS-03-VP',
    displayName: '05 — AS-03-VP',  // 大少 2026-08-08 10:06: 編號 05 = M5 (成交量價格行為確認 v2.0)
    folder: 'AS-03-cycle-detection',
    adapterPath: '../algorithms/AS-03-cycle-detection/adapter.mjs',
    adapterExport: 'volumePriceAdapter',
  },
  // M6: 波動率收縮擴張
  {
    id: 'AS-03-VOL',
    displayName: '06 — AS-03-VOL',  // 大少 2026-08-08 10:06: 編號 06 = M6 (波動率收縮擴張)
    folder: 'AS-03-cycle-detection',
    adapterPath: '../algorithms/AS-03-cycle-detection/adapter.mjs',
    adapterExport: 'volatilityAdapter',
  },
  // 大少 2026-08-08 13:30 — Plan A 拆返 M7 + M8 兩個獨立 entry
  // 之前 sprint 1 合併用 mega module `AS-03-ENG` (08), 大少澄清設計上一起考慮但 implementation 應該分開, 而家拆返
  // ---- M7 Synthesizer (07) — Sprint 1 done, testing page 1 個 entry ----
  {
    id: 'AS-03-SYN',
    displayName: '07 — AS-03-SYN',  // 大少 2026-08-08 10:06: 編號 07 = M7 Synthesizer (大少 13:30 拆返獨立)
    folder: 'AS-03-cycle-detection',
    adapterPath: '../algorithms/AS-03-cycle-detection/adapter.mjs',
    adapterExport: 'synthesizerAdapter',  // 大少 2026-08-08 13:30 Plan A: 拆返 synthesizerAdapter (之前叫 decisionEngineAdapter)
    // Sprint 1 done — M7 Synthesizer 邏輯 (6 個 modules → SSI + TCM + Alignment + 8 個 Grade + Kelly 倉位)
    // Sprint 2 將加 M8 chain (M7 嘅 SynthesizerVerdict 喂入去 M8)
  },
  // ---- M8 Decision Engine (08) — Sprint 2 sub-task 2.1 done (8 個 finalAction 決策樹) ----
  {
    id: 'AS-03-DEC',
    displayName: '08 — AS-03-DEC',  // 大少 2026-08-08 10:06: 編號 08 = M8 Decision Engine (大少 13:30 拆返獨立)
    folder: 'AS-03-cycle-detection',
    adapterPath: '../algorithms/AS-03-cycle-detection/adapter.mjs',
    adapterExport: 'decisionEngineAdapter',  // 大少 2026-08-08 15:42: M8 v1.0.0 — 8 個 finalAction 決策樹 + 揸車比喻 final_action_reason + trading card (static) done
    // ✅ 2.1: 8 個 finalAction 決策樹 (BUY/ADD/HOLD/REDUCE/SELL/WAIT/TRAP/TRANSITION) + trading card (static formula)
    // 🚧 2.2-2.5: trading card adaptive + 短期走勢預測 + 人話解讀 (LLM hook) + 5 個 adaptive params runtime auto-calibrate
  },
  // ---- 獨立算法 (M1 抽出, 唔屬於 AS-03 7 個 modules 之一) ----
  // 舊 M1 改名「zmen均算法」, 搬去 REGISTRY 尾
  // 大少 2026-08-08 08:47:「zmen均算法」係大少自己想出嚟嘅算法, 從
  // 7 個 modules 抽離, 排去 dropdown 最後, 獨立一類
  // 大少 2026-08-08 09:50: 改名「zmen均算法」→「zmen均算法」(算法 vs 算去 typo 修正)
  // 大少 2026-08-08 09:13: implementation file 改叫 zmen-ma-alignment.ts
  {
    id: 'AS-03',
    displayName: 'zmen均算法',  // 大少 2026-08-08 09:50: 舊 M1 改名 + 抽離 7 個 modules
    folder: 'AS-03-cycle-detection',
    adapterPath: '../algorithms/AS-03-cycle-detection/adapter.mjs',
    // 預設 = 頂層 exports (向後兼容 ma-alignment v0.3.0 adapter 嘅 analyze 函數, 留俾 zmen均算法)
    // 大少 #10859 — module toggle (enableVolumePrice) 由 AS-03 entry 入面嘅 checkbox 控制
    //   唔再獨立 expose AS-03-VP dropdown
    // 大少 2026-08-07 23:15 — SlopeMomentum 暫時隱藏, Stage 1 done 最後先做返
  },
  // ---- M9 Back Test (09) — Sprint 3 sub-task 9.5 done (大少 22:28 Go) ----
  // 大少 2026-08-08 22:28 — 6 個月歷史 K 線 replay M8 verdict, 對比 5/10/20 日後真實升跌
  // Coarse grid (3×3=9) + fine tune top 5 ±20% + adaptive window 6→18 個月 + walk-forward CV 3 段
  // 自動 POST optimal + forward return records 落 per-symbol cache (9.4)
  {
    id: 'AS-03-BT',
    displayName: '09 — AS-03-BT',  // 大少 2026-08-08 10:06: 編號 09 = M9 Back Test
    folder: 'AS-03-cycle-detection',
    adapterPath: '../algorithms/AS-03-cycle-detection/adapter.mjs',
    adapterExport: 'backTestAdapter',
    // 9.5: testing page entry 09 — 揀 stock → 撳跑 → out optimal params + walk-forward CV folds
    // 9.6 (next): HK.00700 pilot only + spec doc final
  },
  // ---- M11 Backtest Timeline (11) — Stage 2 第三次 focus (大少 2026-08-10 00:04 4 個 A confirm) ----
  // 整合 M9 forward return + M10 Trade Journal 嘅 timeline 視覺化
  // 4 個永遠 full show sections: Timeline chart + Stats + Journal overlay + Golden entries
  // 6 色標 + LLM hook (大少 13:30 永久 rule)
  {
    id: 'AS-03-BTL',
    displayName: '11 — AS-03-BTL',  // 大少 2026-08-08 10:06: 編號 11 = M11 Backtest Timeline
    folder: 'AS-03-cycle-detection',
    adapterPath: '../algorithms/AS-03-cycle-detection/adapter.mjs',
    adapterExport: 'backtestTimelineAdapter',
  },
  // 將來加新 algorithm:
  // { id: 'AS-04', folder: '...', adapterPath: '...' },
];

// ===== State =====

let currentAdapter = null;
let currentOptions = {};

// ===== DOM refs =====

const algorithmSelect = document.getElementById('algorithm-select');
const algoInfo = document.getElementById('algo-info');
const algoHelp = document.getElementById('algo-help');
const inputsForm = document.getElementById('inputs-form');
const runBtn = document.getElementById('run-btn');
const runStatus = document.getElementById('run-status');
const resultPanel = document.getElementById('result-panel');
const registryCount = document.getElementById('registry-count');

registryCount.textContent = REGISTRY.length;

// ===== Init =====

// 大少 #11085 (2026-08-07): 切算法時 reset 結果 panel (result + run status + chart)
// 3 個 sections (詳細解讀/策略建議/點用點睇) 都喺 #result-panel 入面 render,所以清 resultPanel 即清晒
function resetResultPanel() {
  if (runStatus) runStatus.innerHTML = '';
  if (resultPanel) {
    resultPanel.innerHTML = '<p style="color: #888;">填好輸入參數, 撳「跑算法」就會見到結果</p>';
  }
  if (chartInstance) {
    try { chartInstance.remove(); } catch (_) {}
    chartInstance = null;
  }
  const chartContainer = document.getElementById('chart-container');
  if (chartContainer) chartContainer.innerHTML = '';
}

async function init() {
  // 清空 default option
  algorithmSelect.innerHTML = '';

  for (const algo of REGISTRY) {
    try {
      // 大少 2026-08-09 13:00 Bug 3+4 fix: 加 ALGO_CACHE_BUST query string cache bust
      // 改 adapter.mjs 之後要 bump 個 constant, 唔受 HTML cache bust (?v=2.3.X) 影響
      const mod = await import(algo.adapterPath + '?v=' + ALGO_CACHE_BUST);
      // 如果有 adapterExport, 用 named export; 否則用 default exports
      algo.adapter = algo.adapterExport ? mod[algo.adapterExport] : mod;
      const option = document.createElement('option');
      option.value = algo.id;
      // 大少 #11085: dropdown 用 displayName (e.g. AS-03-MA), id 維持 'AS-03' 唔變
      const displayId = algo.displayName || algo.id;
      option.textContent = `${displayId} — ${algo.adapter.name} (v${algo.adapter.version})`;
      algorithmSelect.appendChild(option);
    } catch (err) {
      console.error(`Failed to load ${algo.id}:`, err);
      const option = document.createElement('option');
      option.value = algo.id;
        option.textContent = `${algo.id} — ❌ 載入失敗`;
      option.disabled = true;
      algorithmSelect.appendChild(option);
    }
  }

  if (algorithmSelect.options.length > 0) {
    // 揀第一個 enabled option
    for (const opt of algorithmSelect.options) {
      if (!opt.disabled) {
        algorithmSelect.value = opt.value;
        break;
      }
    }
    await onAlgorithmChange();
  } else {
    algoInfo.innerHTML = '<p style="color: red;">⚠️ 全部演算法都載入唔到, 請檢查 setup</p>';
  }
  // 大少 11:07: 加 Trade Journal section (Stage 1+ MVP)
  renderTradeJournalSection();
}

async function onAlgorithmChange() {
  const algo = REGISTRY.find((a) => a.id === algorithmSelect.value);
  if (!algo || !algo.adapter) {
    algoInfo.innerHTML = '<p style="color: red;">呢個演算法未載入</p>';
    algoHelp.innerHTML = '';
    inputsForm.innerHTML = '';
    return;
  }

  // 大少 #11085 (2026-08-07): 切算法時清空舊結果,免得 user 誤會新 algo 結果
  // (舊 algo 嘅 detailed explanation / strategy advice / usage guide / chart 全部清走)
  resetResultPanel();

  currentAdapter = algo.adapter;

  // Algo info (2026-08-07 — generic 化, 移除 hard-code 嘅 umbrella context)
  // Adapter 自己可以提供 contextLines array, 冇就空白
  algoInfo.innerHTML = `
    <h3>${currentAdapter.name}</h3>
    ${(currentAdapter.contextLines || []).map(line => `<p style="margin: 4px 0; color: #555;"><strong>${line}</strong></p>`).join('')}
    <p><small>${currentAdapter.description || ''}</small></p>
    <p><small>版本: <strong>${currentAdapter.version}</strong></small></p>
  `;

  // Help
  if (currentAdapter.getHelp) {
    algoHelp.innerHTML = currentAdapter.getHelp();
  } else {
    algoHelp.innerHTML = '';
  }

  // Inputs form
  inputsForm.innerHTML = '';
  currentOptions = {};
  for (const input of currentAdapter.inputs || []) {
    if (input.default !== undefined) {
      currentOptions[input.key] = input.default;
    }
    inputsForm.appendChild(renderInput(input));
  }
}

function renderInput(input) {
  switch (input.type) {
    case 'autocomplete':
      return renderAutocomplete(input);
    case 'select':
      return renderSelect(input);
    case 'number':
      return renderNumber(input);
    case 'checkbox':                                  // 大少 #10846 — module toggle checkboxes
      return renderCheckbox(input);
    default:
      return renderText(input);
  }
}

function renderText(input) {
  const wrapper = document.createElement('div');
  wrapper.className = 'input-field';

  const label = document.createElement('label');
  label.htmlFor = `input-${input.key}`;
  label.textContent = input.label + (input.required ? ' *' : '');
  wrapper.appendChild(label);

  const inputEl = document.createElement('input');
  inputEl.type = 'text';
  if (input.placeholder) inputEl.placeholder = input.placeholder;
  if (input.default !== undefined) inputEl.value = input.default;

  inputEl.id = `input-${input.key}`;
  inputEl.name = input.key;

  const updateValue = () => {
    currentOptions[input.key] = inputEl.value;
  };
  inputEl.addEventListener('input', updateValue);
  inputEl.addEventListener('change', updateValue);

  wrapper.appendChild(inputEl);
  return wrapper;
}

function renderNumber(input) {
  const wrapper = document.createElement('div');
  wrapper.className = 'input-field';

  const label = document.createElement('label');
  label.htmlFor = `input-${input.key}`;
  label.textContent = input.label + (input.required ? ' *' : '');
  wrapper.appendChild(label);

  const inputEl = document.createElement('input');
  inputEl.type = 'number';
  if (input.min !== undefined) inputEl.min = input.min;
  if (input.max !== undefined) inputEl.max = input.max;
  if (input.step !== undefined) inputEl.step = input.step;
  if (input.default !== undefined) inputEl.value = input.default;

  inputEl.id = `input-${input.key}`;
  inputEl.name = input.key;

  const updateValue = () => {
    const v = parseFloat(inputEl.value);
    currentOptions[input.key] = isNaN(v) ? inputEl.value : v;
  };
  inputEl.addEventListener('input', updateValue);
  inputEl.addEventListener('change', updateValue);

  wrapper.appendChild(inputEl);
  return wrapper;
}

function renderSelect(input) {
  const wrapper = document.createElement('div');
  wrapper.className = 'input-field';

  const label = document.createElement('label');
  label.htmlFor = `input-${input.key}`;
  label.textContent = input.label + (input.required ? ' *' : '');
  wrapper.appendChild(label);

  const inputEl = document.createElement('select');
  inputEl.id = `input-${input.key}`;
  inputEl.name = input.key;
  for (const opt of input.options || []) {
    const optionEl = document.createElement('option');
    optionEl.value = opt.value;
    optionEl.textContent = opt.label;
    inputEl.appendChild(optionEl);
  }
  if (input.default !== undefined) inputEl.value = input.default;

  inputEl.addEventListener('change', () => {
    currentOptions[input.key] = inputEl.value;
  });

  wrapper.appendChild(inputEl);
  return wrapper;
}

// ===== Checkbox (大少 #10846 — module toggle checkboxes) =====
//
// Universal pattern — 所有 algorithm 嘅 inputs 入面如果有 type: 'checkbox' 都會用呢個 render。
// Adapter.mjs 通過 input.default = false 設置 initial state (大少 clarify: default OFF)。
// 撳「跑算法」時 currentOptions[key] 會係 boolean，跟住 pass 落 adapter.analyze()。

function renderCheckbox(input) {
  const wrapper = document.createElement('div');
  wrapper.className = 'input-field input-field-checkbox';

  const label = document.createElement('label');
  label.className = 'checkbox-label';
  label.htmlFor = `input-${input.key}`;

  const inputEl = document.createElement('input');
  inputEl.type = 'checkbox';
  inputEl.id = `input-${input.key}`;
  inputEl.name = input.key;
  // 大少 clarify: default OFF — checkbox 唔可以 auto-checked
  inputEl.checked = input.default === true;
  currentOptions[input.key] = inputEl.checked;

  const labelText = document.createElement('span');
  labelText.textContent = input.label + (input.required ? ' *' : '');

  label.appendChild(inputEl);
  label.appendChild(labelText);

  inputEl.addEventListener('change', () => {
    currentOptions[input.key] = inputEl.checked;
  });

  wrapper.appendChild(label);
  return wrapper;
}

// ===== Autocomplete（跟首頁 StockSearch UX 一致）=====
//
// 大少 #10400: testing page 嘅股票代碼 input 改用 auto-complete，
// 同首頁 StockSearch 一樣嘅 UX。
//
// StockSearch.tsx (web/src/components/stock/StockSearch.tsx) 行為：
//   - Ant Design AutoComplete + Input.Search
//   - 純數字 → 搜港股；英文字母 → 搜美股；其他 → 全部
//   - Backend: GET /api/stocks/search?q=***&market=HK|US&limit=***
//   - Response: [{code, name, lot_size, market, ...}, ...]
//   - Option layout: code (mono blue) + name + market badge

function renderAutocomplete(input) {
  const wrapper = document.createElement('div');
  wrapper.className = 'input-field input-autocomplete';

  const label = document.createElement('label');
  label.htmlFor = `input-${input.key}`;
  label.textContent = input.label + (input.required ? ' *' : '');
  wrapper.appendChild(label);

  const container = document.createElement('div');
  container.className = 'autocomplete-container';

  const inputEl = document.createElement('input');
  inputEl.type = 'text';
  inputEl.className = 'autocomplete-input';
  inputEl.autocomplete = 'off';
  if (input.placeholder) inputEl.placeholder = input.placeholder;
  if (input.default !== undefined) inputEl.value = input.default;
  inputEl.id = `input-${input.key}`;
  inputEl.name = input.key;

  const dropdown = document.createElement('div');
  dropdown.className = 'autocomplete-dropdown';
  dropdown.style.display = 'none';

  let debounceTimer;
  let abortController;

  // Market auto-detect (跟首頁邏輯)
  const detectMarket = (value) => {
    if (/[a-zA-Z]/.test(value)) return 'US';
    if (/^\d+$/.test(value)) return 'HK';
    return undefined;
  };

  const search = async (value) => {
    if (abortController) abortController.abort();
    const trimmed = value.trim();
    if (!trimmed) {
      dropdown.style.display = 'none';
      dropdown.innerHTML = '';
      return;
    }

    abortController = new AbortController();

    try {
      const url = new URL(`${BACKEND_URL}${input.endpoint}`);
      url.searchParams.set(input.queryParam || 'q', trimmed);
      url.searchParams.set('limit', String(input.limit || 10));
      if (input.marketFn === 'auto') {
        const market = detectMarket(trimmed);
        if (market) url.searchParams.set('market', market);
      }

      const resp = await fetch(url.toString(), { signal: abortController.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const results = await resp.json();

      if (!Array.isArray(results) || results.length === 0) {
        dropdown.style.display = 'none';
        dropdown.innerHTML = '';
        return;
      }

      dropdown.innerHTML = results
        .map(
          (r) => `
        <div class="ac-option" data-code="${escapeHtml(r.code)}" data-name="${escapeHtml(r.name)}">
          <span class="ac-code">${escapeHtml(r.code)}</span>
          <span class="ac-name">${escapeHtml(r.name)}</span>
          <span class="ac-market">${escapeHtml(r.market || '')}</span>
        </div>`,
        )
        .join('');

      dropdown.style.display = 'block';

      dropdown.querySelectorAll('.ac-option').forEach((opt) => {
        opt.addEventListener('mousedown', (e) => {
          // 用 mousedown 而唔係 click — 避免 blur 先 trigger 收埋 dropdown
          e.preventDefault();
          const code = opt.dataset.code;
          inputEl.value = code;
          currentOptions[input.key] = code;
          dropdown.style.display = 'none';
        });
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('[autocomplete] error:', err);
      }
    }
  };

  inputEl.addEventListener('input', () => {
    currentOptions[input.key] = inputEl.value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => search(inputEl.value), 200);
  });

  inputEl.addEventListener('blur', () => {
    setTimeout(() => {
      dropdown.style.display = 'none';
    }, 200);
  });

  inputEl.addEventListener('focus', () => {
    if (inputEl.value.trim()) {
      search(inputEl.value);
    }
  });

  container.appendChild(inputEl);
  container.appendChild(dropdown);
  wrapper.appendChild(container);

  return wrapper;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ===== Run algorithm =====

async function runAlgorithm() {
  if (!currentAdapter) {
    runStatus.innerHTML = '❌ 未揀演算法, 請先去上面揀一個';
    return;
  }

  // 大少 11:49 揀 B 修 Bug 1: 永遠讀 DOM value 直接 sync, 避免 'input' event race condition
  // (之前 fill 觸發 'input' event 仲未 process 完, click button 已經 fire, currentOptions.code 仲係舊 value)
  // 大少 12:03 Bug 1 fix 位置錯誤修正: 將 fix 移去 return check 之前, 否則 race condition 真係發生時 fix 永遠到唔到
  const codeInputEl = document.getElementById('input-code');
  if (codeInputEl && codeInputEl.value) {
    currentOptions.code = codeInputEl.value;
  }

  if (!currentOptions.code) {
    runStatus.innerHTML = '❌ 請揀或者輸入股票代碼';
    return;
  }

  runStatus.innerHTML = '⏳ 撈緊 K 線數據...';
  resultPanel.innerHTML = '';

  try {
    // 1. Fetch K 線 from backend
    const code = currentOptions.code;
    const period = currentOptions.period || '1d';
    const count = currentOptions.dataWindowDays || 100;

    const klineUrl = `${BACKEND_URL}/api/kline?code=${encodeURIComponent(code)}&period=${period}&count=${count}`;
    const klineResp = await fetch(klineUrl);

    if (!klineResp.ok) {
      throw new Error(`後端伺服器出錯: ${klineResp.status} ${klineResp.statusText}`);
    }

    const klineData = await klineResp.json();
    const klines = klineData.klines || klineData.data || klineData;

    if (!Array.isArray(klines) || klines.length === 0) {
      throw new Error(`後端冇返 K 線數據 (類型: ${typeof klines})`);
    }

    // 大少 #11070 (2026-08-07) — 顯示 user 設定 vs actual returned (debug 用)
    const requestedCount = klineData.requested_count ?? count;
    const actualCount = klineData.actual_count ?? klines.length;
    const dataLimited = klineData.data_limited === true;
    const countHint = (requestedCount !== actualCount || dataLimited)
      ? ` <span style="color: #ff7a00;">(設定 ${requestedCount} 日 / 實際 ${actualCount} 日${dataLimited ? ' — 數據限制' : ''})</span>`
      : '';
    runStatus.innerHTML = `✅ 已攞到 ${actualCount} 日 K 線${countHint} · 跑緊演算法...`;

    // 2. Run algorithm
    const startTime = performance.now();
    const verdict = await currentAdapter.analyze(klines, currentOptions);
    const endTime = performance.now();

    // 大少 #11070 — 顯示 user 設定 vs actual (debug 用)
    const finalCountHint = (requestedCount !== actualCount || dataLimited)
      ? ` <span style="color: #ff7a00;">(設定 ${requestedCount} / 實際 ${actualCount}${dataLimited ? ' — 數據限制' : ''})</span>`
      : '';
    runStatus.innerHTML = `✅ 跑完 · ${actualCount} 日${finalCountHint} · 用咗 ${(endTime - startTime).toFixed(0)} 毫秒`;

    // 3. Render result
    if (currentAdapter.renderResult) {
      resultPanel.innerHTML = currentAdapter.renderResult(verdict);
    } else {
      resultPanel.innerHTML = `<pre>${JSON.stringify(verdict, null, 2)}</pre>`;
    }

    // 3.5 大少 15:45: 跑完 algo 自動 start real-time price polling (5 秒 polling 最新股價 + 日期時間)
    // Trading card 最左加新 column「最新股價」(date/time 上 + price 下)
    startRealTimePrice(code);

    // 4. 大少 #10431 — 撳完 test 後 render K 線圖表（full width）
    const chartRefs = renderChart(klines, code, period);

    // 5. 2026-08-07 — Adapter 自己嘅 chart overlay (peaks/troughs markers + 箱體線 + pattern alert)
    // Generic contract: 每個 algorithm 自己決定點 render 自己嘅 verdict 喺 chart 上面
    if (currentAdapter.renderChartOverlay) {
      try {
        currentAdapter.renderChartOverlay(verdict, klines, chartRefs);
      } catch (err) {
        console.warn('[renderChartOverlay] failed:', err);
      }
    }
  } catch (err) {
    runStatus.innerHTML = `❌ ${err.message}`;  // err.message 已經係中文 user-friendly
    resultPanel.innerHTML = `<pre style="color: red; background: #fff2f0; padding: 12px; border-radius: 4px;">${err.stack || err.message}</pre>`;
    console.error(err);
  }
}

// ===== Render K 線 chart（大少 #10431）=====
//
// 用 lightweight-charts v4.2.3 (CDN) render candlestick + volume。
// Reuse 同一個 library（ChartContainer.tsx 都用呢個）。
// Full width、height 600px。撳完「跑算法」後 auto-call。

let chartInstance = null;

function renderChart(klines, code, period) {
  const container = document.getElementById('chart-container');
  if (!container) return;

  // Dispose 舊 chart
  if (chartInstance) {
    chartInstance.remove();
    chartInstance = null;
  }

  if (!Array.isArray(klines) || klines.length === 0) {
    container.innerHTML = '<div class="chart-placeholder">冇 K 線數據</div>';
    return;
  }

  if (typeof LightweightCharts === 'undefined') {
    container.innerHTML = '<div class="chart-placeholder">❌ K 線圖組件載入唔到 (CDN 連唔上)</div>';
    return;
  }

  // K 線 field name 正規化（backend 可能用唔同名）
  const normalizeTime = (t) => {
    if (typeof t === 'number') {
      return t > 1e12 ? Math.floor(t / 1000) : t;  // ms → s
    }
    if (typeof t === 'string') {
      return Math.floor(new Date(t).getTime() / 1000);  // ISO → s
    }
    return null;
  };

  const candleData = klines
    .map((k) => ({
      time: normalizeTime(k.timestamp ?? k.time ?? k.date),
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
    }))
    .filter((d) => d.time != null && [d.open, d.high, d.low, d.close].every(Number.isFinite))
    .sort((a, b) => a.time - b.time);

  if (candleData.length === 0) {
    container.innerHTML = '<div class="chart-placeholder">❌ K 線數據格式唔啱</div>';
    return;
  }

  // Create chart
  const chart = LightweightCharts.createChart(container, {
    layout: {
      background: { type: 'solid', color: '#ffffff' },
      textColor: '#333',
    },
    grid: {
      vertLines: { color: '#f0f0f0' },
      horzLines: { color: '#f0f0f0' },
    },
    timeScale: {
      borderColor: '#d9d9d9',
      timeVisible: true,
      secondsVisible: false,
    },
    rightPriceScale: {
      borderColor: '#d9d9d9',
    },
    autoSize: true,
  });

  // Candlestick series
  const candleSeries = chart.addCandlestickSeries({
    upColor: '#26a69a',
    downColor: '#ef5350',
    borderVisible: false,
    wickUpColor: '#26a69a',
    wickDownColor: '#ef5350',
  });
  candleSeries.setData(candleData);

  // Volume series (下方 histogram)
  const volumeData = candleData.map((d, i) => {
    const k = klines[i];
    return {
      time: d.time,
      value: k.volume || 0,
      color: d.close >= d.open ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)',
    };
  });
  const volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
  });
  chart.priceScale('volume').applyOptions({
    scaleMargins: { top: 0.8, bottom: 0 },
  });
  volumeSeries.setData(volumeData);

  chart.timeScale().fitContent();

  chartInstance = chart;
  console.log(`[Chart] rendered ${candleData.length} bars for ${code} (${period})`);

  // 2026-08-07 — Module 2 (高低點結構法) chart overlay
  // 返 chart + candleSeries 畀 adapter.renderChartOverlay 用
  return { chart, candleSeries, priceLines: {} };
}

// ===== Event listeners =====

algorithmSelect.addEventListener('change', onAlgorithmChange);
runBtn.addEventListener('click', runAlgorithm);

// =============================================================
// Sprint 2 sub-task 2.8 — 「🔄 重新校準」按鈕 event handler (M8 5 個 adaptive params)
// =============================================================
// 當 M8 verdict card render 時, 內聯 button 「🔄 重新校準」會調用 window.__recalibrateAdaptiveParams
// 流程: DELETE cache → 重新跑 runAlgorithm() → POST save 新 cache
window.__recalibrateAdaptiveParams = async function() {
  if (!currentOptions || !currentOptions.code) {
    alert('請先輸入股票代碼');
    return;
  }
  const symbol = currentOptions.code;
  const btn = document.getElementById('recalibrate-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ 重新校準中...';
  }
  try {
    // 1. DELETE cache
    const delResp = await fetch(`http://localhost:18792/api/adaptive-params/${encodeURIComponent(symbol)}`, {
      method: 'DELETE',
    });
    // 2. 重新跑 algorithm (會 calibrate + POST save)
    await runAlgorithm();
    if (btn) {
      btn.textContent = '✅ 已重新校準';
      setTimeout(() => { btn.disabled = false; btn.textContent = '🔄 重新校準'; }, 2000);
    }
  } catch (e) {
    console.error('[Recalibrate] Error:', e);
    if (btn) {
      btn.textContent = '❌ 失敗';
      setTimeout(() => { btn.disabled = false; btn.textContent = '🔄 重新校準'; }, 2000);
    }
  }
};

// Sprint 3 sub-task 9.7.6 — M9 重新校準 + 立即套用 M8 button event handler
// =========================================================================
// 當 M9 verdict card render 時, 內聯 button 會調用呢兩個函數
//   __recalibrateM9Optimal → DELETE 個 symbol 嘅 optimal cache → 重新跑 back test
//   __applyM9OptimalToM8 → DELETE M8 個 adaptive params cache → 撳 8 trigger M8 重新校準
window.__recalibrateM9Optimal = async function() {
  if (!currentOptions || !currentOptions.code) {
    alert('請先輸入股票代碼');
    return;
  }
  const symbol = currentOptions.code;
  const btn = document.getElementById('m9-recalibrate-btn');
  const status = document.getElementById('m9-action-status');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ 重新校準中...';
  }
  if (status) status.textContent = '刪除舊最佳設定, 重新跑 back test...';
  try {
    // 1. DELETE 個 symbol 嘅 back-test optimal cache
    await fetch(`http://localhost:18792/api/adaptive-params/${encodeURIComponent(symbol)}/back-test`, {
      method: 'DELETE',
    });
    // 2. 重新跑 back test (會 re-run walk-forward CV + POST save new optimal)
    await runAlgorithm();
    if (btn) {
      btn.textContent = '✅ 已重新校準';
      if (status) status.textContent = '已重新跑完, 結果已更新';
      setTimeout(() => { btn.disabled = false; btn.textContent = '🔄 重新校準'; status.textContent = ''; }, 2000);
    }
  } catch (e) {
    console.error('[M9 Recalibrate] Error:', e);
    if (btn) btn.textContent = '❌ 失敗';
    if (status) status.textContent = '錯誤: ' + e.message;
    setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = '🔄 重新校準'; } }, 2000);
  }
};

window.__applyM9OptimalToM8 = async function() {
  if (!currentOptions || !currentOptions.code) {
    alert('請先輸入股票代碼');
    return;
  }
  const symbol = currentOptions.code;
  const btn = document.getElementById('m9-apply-btn');
  const status = document.getElementById('m9-action-status');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ 套用中...';
  }
  if (status) status.textContent = '刪除 M8 舊 adaptive params, 重新觸發 M8 校準 (會用 M9 嘅 optimal)...';
  try {
    // 1. DELETE M8 嘅 adaptive params cache (會 trigger M8 re-calibrate, 用 M9 嘅 optimal)
    await fetch(`http://localhost:18792/api/adaptive-params/${encodeURIComponent(symbol)}`, {
      method: 'DELETE',
    });
    // 2. 切去 M8 algorithm, 自動 trigger runAlgorithm (M8 會自動用 cache 嘅 M9 optimal)
    if (currentAdapter && currentAdapter.id !== 'AS-03-DEC') {
      const selectEl = document.getElementById('algorithm-select');
      if (selectEl) {
        selectEl.value = 'AS-03-DEC';
        selectEl.dispatchEvent(new Event('change'));
        // 等 onAlgorithmChange 完成, 再 trigger run
        setTimeout(async () => {
          await runAlgorithm();
          if (btn) {
            btn.textContent = '✅ 已套用 M8';
            if (status) status.textContent = '第八模組已經用新設定重新校準, 結果已更新';
            setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = '📌 立即套用 (8) M8'; } if (status) status.textContent = ''; }, 2500);
          }
        }, 500);
      }
    } else {
      // 已經喺 M8, 直接 re-run
      await runAlgorithm();
      if (btn) {
        btn.textContent = '✅ 已套用 M8';
        if (status) status.textContent = 'M8 已經用新設定重新校準, 結果已更新';
        setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = '📌 立即套用 (8) M8'; } if (status) status.textContent = ''; }, 2500);
      }
    }
  } catch (e) {
    console.error('[M9 Apply] Error:', e);
    if (btn) btn.textContent = '❌ 失敗';
    if (status) status.textContent = '錯誤: ' + e.message;
    setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = '📌 立即套用 (8) M8'; } }, 2500);
  }
};

inputsForm.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runAlgorithm();
  }
});

// ===== Trade Journal Section (Stage 1+ MVP + Followup, 大少 15:04 揀 Full scope) =====
//   - 統計 panel: 6 個 metrics (永遠 full show, 6 色, 大少 11:57 永久 rule)
//   - 每個 entry 加 4 個 button: 啱 / 錯 / 改 / 刪
//   - API: POST / GET / PUT / DELETE / stats (Stage 1+ 永久保留)

async function loadTradeJournalStats() {
  const panelEl = document.getElementById('trade-journal-stats');
  if (!panelEl) return;
  try {
    const resp = await fetch('http://localhost:18792/api/trade-journal/stats?days=30');
    if (!resp.ok) {
      panelEl.innerHTML = '<p style="color: #EE5151;">❌ 拎唔到統計</p>';
      return;
    }
    const stats = await resp.json();
    const pct = (v) => v === null || v === undefined ? '—' : (v * 100).toFixed(1) + '%';
    const num = (v) => v === null || v === undefined ? '—' : v;
    const chip = (label, value, color) =>
      `<div style="background: ${color}15; border: 1px solid ${color}; border-radius: 6px; padding: 8px 12px; text-align: center; min-width: 100px;">
        <div style="font-size: 11px; color: ${color}; font-weight: 600;">${label}</div>
        <div style="font-size: 16px; color: ${color}; font-weight: 700; margin-top: 2px;">${value}</div>
      </div>`;
    const bw = stats.best_worst_trade || {};
    panelEl.innerHTML = `
      <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
        ${chip('總筆數', num(stats.total), '#1890ff')}
        ${chip('啱嘅次數', num(stats.correct_count), '#26BA75')}
        ${chip('命中率', pct(stats.hit_rate), '#8B5CF6')}
        ${chip('5 日回報', pct(stats.avg_return_5d), '#F39C12')}
        ${chip('20 日回報', pct(stats.avg_return_20d), '#FF6B35')}
        ${chip('最佳/最差', `${pct(bw.best)} / ${pct(bw.worst)}`, '#5B7C99')}
        <button id="tj-stats-refresh" type="button" style="background: #f0f0f0; color: #333; padding: 6px 12px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; font-size: 12px;">🔄 重新整理</button>
      </div>
      <p style="font-size: 11px; color: #888; margin: 6px 0 0 0;">統計過去 30 日 (${stats.filter?.symbol || '全部股票'})</p>
    `;
    const refreshBtn = document.getElementById('tj-stats-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', () => { loadTradeJournal(); loadTradeJournalStats(); });
  } catch (e) {
    console.error('[Trade Journal] stats error:', e);
    panelEl.innerHTML = '<p style="color: #EE5151;">❌ 統計錯誤: ' + e.message + '</p>';
  }
}

async function putMark(id, isCorrect) {
  if (!confirm(isCorrect ? '確認 mark 呢個 entry 做「啱」?' : '確認 mark 呢個 entry 做「錯」?')) return;
  try {
    const resp = await fetch(`http://localhost:18792/api/trade-journal/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_correct: isCorrect }),
    });
    if (resp.ok) {
      await loadTradeJournal();
      await loadTradeJournalStats();
    } else {
      const err = await resp.json();
      alert('❌ Mark 失敗: ' + (err.detail || resp.status));
    }
  } catch (e) {
    console.error('[Trade Journal] put mark error:', e);
    alert('❌ 錯誤: ' + e.message);
  }
}

async function deleteEntry(id) {
  if (!confirm('確認刪除呢個 entry? 刪咗就冇得返转头 (永久保留 rule)')) return;
  try {
    const resp = await fetch(`http://localhost:18792/api/trade-journal/${id}`, { method: 'DELETE' });
    if (resp.ok) {
      await loadTradeJournal();
      await loadTradeJournalStats();
    } else if (resp.status === 404) {
      alert('❌ Entry 已經唔存在');
    } else {
      const err = await resp.json();
      alert('❌ 刪除失敗: ' + (err.detail || resp.status));
    }
  } catch (e) {
    console.error('[Trade Journal] delete error:', e);
    alert('❌ 錯誤: ' + e.message);
  }
}

async function openEditForm(id) {
  const entryResp = await fetch(`http://localhost:18792/api/trade-journal/${id}`);
  if (!entryResp.ok) {
    alert('❌ 拎唔到 entry 資料');
    return;
  }
  const entry = await entryResp.json();
  const exitPrice = prompt('輸入實際賣出價 (留空跳過):', entry.actual_exit_price || '');
  if (exitPrice === null) return; // 用戶 cancel
  const exitDate = prompt('輸入實際賣出日期 YYYY-MM-DD (留空跳過):', entry.actual_exit_date || '');
  if (exitDate === null) return;
  const isCorrect = prompt('Mark 啱 (y) / 錯 (n) / 跳過 (空白):', entry.is_correct === 1 ? 'y' : entry.is_correct === 0 ? 'n' : '');
  if (isCorrect === null) return;

  const payload = {};
  if (exitPrice.trim() !== '') {
    const p = parseFloat(exitPrice);
    if (isNaN(p) || p <= 0) { alert('❌ 賣出價必須 > 0'); return; }
    payload.actual_exit_price = p;
  }
  if (exitDate.trim() !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exitDate)) { alert('❌ 日期格式必須係 YYYY-MM-DD'); return; }
    payload.actual_exit_date = exitDate;
  }
  if (isCorrect.toLowerCase() === 'y') payload.is_correct = true;
  else if (isCorrect.toLowerCase() === 'n') payload.is_correct = false;

  if (Object.keys(payload).length === 0) {
    alert('冇嘢改, 跳過');
    return;
  }
  try {
    const resp = await fetch(`http://localhost:18792/api/trade-journal/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (resp.ok) {
      await loadTradeJournal();
      await loadTradeJournalStats();
    } else {
      const err = await resp.json();
      alert('❌ 改失敗: ' + (err.detail || resp.status));
    }
  } catch (e) {
    console.error('[Trade Journal] edit error:', e);
    alert('❌ 錯誤: ' + e.message);
  }
}

async function loadTradeJournal() {
  const listEl = document.getElementById('trade-journal-list');
  if (!listEl) return;
  try {
    const resp = await fetch('http://localhost:18792/api/trade-journal?limit=50');
    if (!resp.ok) {
      listEl.innerHTML = '<p style="color: #EE5151;">❌ 拎唔到 Trade Journal 記錄</p>';
      return;
    }
    const data = await resp.json();
    const entries = data.entries || [];
    if (entries.length === 0) {
      listEl.innerHTML = '<p style="color: #888;">仲未有 trade journal 記錄, 大少可以用上面 form 新增第一個 entry。</p>';
      return;
    }
    let html = '<table style="width: 100%; border-collapse: collapse; margin-top: 8px;">';
    html += '<tr style="background: #f5f5f5;">';
    html += '<th style="padding: 8px; text-align: left;">股票</th>';
    html += '<th style="padding: 8px; text-align: left;">買入日期</th>';
    html += '<th style="padding: 8px; text-align: right;">買入價</th>';
    html += '<th style="padding: 8px; text-align: right;">股數</th>';
    html += '<th style="padding: 8px; text-align: right;">目標價</th>';
    html += '<th style="padding: 8px; text-align: right;">止蝕價</th>';
    html += '<th style="padding: 8px; text-align: right;">賣出價</th>';
    html += '<th style="padding: 8px; text-align: center;">啱/錯</th>';
    html += '<th style="padding: 8px; text-align: left;">備註</th>';
    html += '<th style="padding: 8px; text-align: center; min-width: 200px;">操作</th>';
    html += '</tr>';
    for (const e of entries) {
      html += '<tr style="border-bottom: 1px solid #eee;">';
      html += `<td style="padding: 8px;"><b>${e.symbol}</b></td>`;
      html += `<td style="padding: 8px;">${e.entry_date}</td>`;
      html += `<td style="padding: 8px; text-align: right;">$${e.entry_price.toFixed(2)}</td>`;
      html += `<td style="padding: 8px; text-align: right;">${e.shares}</td>`;
      html += `<td style="padding: 8px; text-align: right;">${e.target_price ? '$' + e.target_price.toFixed(2) : '—'}</td>`;
      html += `<td style="padding: 8px; text-align: right;">${e.stop_loss ? '$' + e.stop_loss.toFixed(2) : '—'}</td>`;
      html += `<td style="padding: 8px; text-align: right;">${e.actual_exit_price ? '$' + e.actual_exit_price.toFixed(2) : '<span style="color: #888;">—</span>'}</td>`;
      // 啱/錯 mark 狀態 chip
      if (e.is_correct === 1) {
        html += '<td style="padding: 8px; text-align: center;"><span style="background: #26BA7520; color: #26BA75; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">✅ 啱</span></td>';
      } else if (e.is_correct === 0) {
        html += '<td style="padding: 8px; text-align: center;"><span style="background: #EE515120; color: #EE5151; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">❌ 錯</span></td>';
      } else {
        html += '<td style="padding: 8px; text-align: center; color: #888;">—</td>';
      }
      html += `<td style="padding: 8px; color: #666; font-size: 12px;">${e.notes || ''}</td>`;
      // 操作 button (Stage 1+ followup: 4 個 button)
      html += '<td style="padding: 4px; text-align: center; white-space: nowrap;">';
      html += `<button onclick="putMark(${e.id}, true)" style="background: #26BA75; color: white; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; margin: 1px;" title="Mark 啱">✅ 啱</button>`;
      html += `<button onclick="putMark(${e.id}, false)" style="background: #EE5151; color: white; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; margin: 1px;" title="Mark 錯">❌ 錯</button>`;
      html += `<button onclick="openEditForm(${e.id})" style="background: #F39C12; color: white; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; margin: 1px;" title="改 actual exit">✏️ 改</button>`;
      html += `<button onclick="deleteEntry(${e.id})" style="background: #888; color: white; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; margin: 1px;" title="刪 entry">🗑️ 刪</button>`;
      html += '</td>';
      html += '</tr>';
    }
    html += '</table>';
    html += `<p style="font-size: 12px; color: #888; margin-top: 8px;">總共 ${data.count} 條 entry (永久保留, 大少 22:28 永久 rule)</p>`;
    listEl.innerHTML = html;
  } catch (e) {
    console.error('[Trade Journal] load error:', e);
    listEl.innerHTML = '<p style="color: #EE5151;">❌ 錯誤: ' + e.message + '</p>';
  }
}

async function addTradeJournalEntry() {
  const statusEl = document.getElementById('trade-journal-form-status');
  const symbol = document.getElementById('tj-symbol')?.value.trim();
  const entryDate = document.getElementById('tj-entry-date')?.value;
  const entryPrice = parseFloat(document.getElementById('tj-entry-price')?.value);
  const shares = parseFloat(document.getElementById('tj-shares')?.value) || 1;
  const targetPrice = parseFloat(document.getElementById('tj-target')?.value) || null;
  const stopLoss = parseFloat(document.getElementById('tj-stop')?.value) || null;
  const notes = document.getElementById('tj-notes')?.value || '';

  if (!symbol || !entryDate || isNaN(entryPrice) || entryPrice <= 0) {
    if (statusEl) statusEl.innerHTML = '<span style="color: #EE5151;">❌ 請填寫股票代碼、買入日期、買入價 (必須 > 0)</span>';
    return;
  }
  if (statusEl) statusEl.innerHTML = '<span style="color: #1890ff;">⏳ 加緊...</span>';

  try {
    const resp = await fetch('http://localhost:18792/api/trade-journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol, entry_date: entryDate, entry_price: entryPrice, shares,
        target_price: targetPrice, stop_loss: stopLoss, notes,
      }),
    });
    if (resp.ok) {
      if (statusEl) statusEl.innerHTML = '<span style="color: #26BA75;">✅ 已新增, 之後可以輸入 exit 嗰陣 mark 啱/錯 (Stage 1+)</span>';
      // 清 form
      document.getElementById('tj-symbol').value = '';
      document.getElementById('tj-entry-date').value = '';
      document.getElementById('tj-entry-price').value = '';
      document.getElementById('tj-shares').value = '1';
      document.getElementById('tj-target').value = '';
      document.getElementById('tj-stop').value = '';
      document.getElementById('tj-notes').value = '';
      // 重新 load list
      await loadTradeJournal();
    } else if (resp.status === 409) {
      const errData = await resp.json();
      if (statusEl) statusEl.innerHTML = `<span style="color: #F39C12;">⚠️ ${errData.detail || '重複 entry'}</span>`;
    } else {
      const errData = await resp.json();
      if (statusEl) statusEl.innerHTML = `<span style="color: #EE5151;">❌ ${errData.detail || '錯誤 ' + resp.status}</span>`;
    }
  } catch (e) {
    console.error('[Trade Journal] add error:', e);
    if (statusEl) statusEl.innerHTML = '<span style="color: #EE5151;">❌ 錯誤: ' + e.message + '</span>';
  }
}

function renderTradeJournalSection() {
  const existing = document.getElementById('trade-journal-section');
  if (existing) return; // 已經 render 過
  const container = document.createElement('div');
  container.id = 'trade-journal-section';
  container.className = 'result-section';
  container.style.cssText = 'margin: 16px 0; padding: 16px; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);';
  container.innerHTML = `
    <h3 style="margin: 0 0 8px 0; font-size: 16px;">📓 Trade Journal (時光機實戰日誌 — Stage 1+ Followup)</h3>
    <p style="font-size: 12px; color: #888; margin: 0 0 12px 0;">大少真正落實倉位後, 記錄落 Trade Journal, 之後用 4 個 button mark 啱/錯/改/刪, 統計 panel 6 個 metrics 自動計算命中率同 forward return</p>

    <!-- Stage 1+ followup: 統計 panel (6 個 metrics, 6 色, 永遠 full show, 大少 11:57 永久 rule) -->
    <div style="background: #f9f9f9; padding: 12px; border-radius: 8px; margin-bottom: 12px;">
      <h4 style="margin: 0 0 8px 0; font-size: 14px;">📊 統計 (過去 30 日, 6 個 metrics)</h4>
      <div id="trade-journal-stats">
        <p style="color: #888;">撈緊...</p>
      </div>
    </div>

    <div style="background: #f9f9f9; padding: 12px; border-radius: 8px; margin-bottom: 12px;">
      <h4 style="margin: 0 0 8px 0; font-size: 14px;">📝 新增 entry</h4>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 8px;">
        <div>
          <label style="display: block; font-size: 11px; color: #666; margin-bottom: 2px;">股票代碼 *</label>
          <input id="tj-symbol" type="text" placeholder="HK.00700" style="width: 100%; padding: 6px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;">
        </div>
        <div>
          <label style="display: block; font-size: 11px; color: #666; margin-bottom: 2px;">買入日期 *</label>
          <input id="tj-entry-date" type="date" style="width: 100%; padding: 6px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;">
        </div>
        <div>
          <label style="display: block; font-size: 11px; color: #666; margin-bottom: 2px;">買入價 *</label>
          <input id="tj-entry-price" type="number" step="0.01" placeholder="493.40" style="width: 100%; padding: 6px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;">
        </div>
        <div>
          <label style="display: block; font-size: 11px; color: #666; margin-bottom: 2px;">股數 (default 1)</label>
          <input id="tj-shares" type="number" step="0.01" value="1" style="width: 100%; padding: 6px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;">
        </div>
        <div>
          <label style="display: block; font-size: 11px; color: #666; margin-bottom: 2px;">目標價 (optional)</label>
          <input id="tj-target" type="number" step="0.01" placeholder="算法自動" style="width: 100%; padding: 6px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;">
        </div>
        <div>
          <label style="display: block; font-size: 11px; color: #666; margin-bottom: 2px;">止蝕價 (optional)</label>
          <input id="tj-stop" type="number" step="0.01" placeholder="算法自動" style="width: 100%; padding: 6px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;">
        </div>
      </div>
      <div style="margin-bottom: 8px;">
        <label style="display: block; font-size: 11px; color: #666; margin-bottom: 2px;">備註 (optional)</label>
        <input id="tj-notes" type="text" placeholder="例: 騰訊反彈, M9 拎到 high score BUY 訊號" style="width: 100%; padding: 6px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;">
      </div>
      <button id="tj-add-btn" type="button" style="background: #1890ff; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-size: 13px;">➕ 新增</button>
      <span id="trade-journal-form-status" style="margin-left: 12px; font-size: 13px;"></span>
    </div>
    <div id="trade-journal-list" style="margin-top: 12px;">
      <p style="color: #888;">撈緊...</p>
    </div>
  `;
  // Insert 喺 resultPanel 之後 (或 document body 底部)
  const resultPanel = document.getElementById('result') || document.body;
  if (resultPanel.parentNode) {
    resultPanel.parentNode.insertBefore(container, resultPanel.nextSibling);
  } else {
    document.body.appendChild(container);
  }
  // Bind button
  const btn = document.getElementById('tj-add-btn');
  if (btn) btn.addEventListener('click', addTradeJournalEntry);
  // 初始 load list + stats (Stage 1+ followup)
  loadTradeJournal();
  loadTradeJournalStats();
}

// ===== Real-Time Price Section (Stage 1+ 即時股價, 大少 15:45 揀) =====
//   - 5 秒 polling backend /api/stock-price/{symbol}
//   - Trading card row 最左加新 column「最新股價」(date/time 上 + price 下)
//   - 休市 / 連接未建立 → keep last known price + time,加 (休市) caption
//   - 跑完 algo 自動 start, 換 algo / page unload 自動 stop

let realTimePriceState = {
  intervalId: null,
  symbol: null,
  lastPrice: null,
  lastTime: null,
  isStale: true,
  currency: 'HKD',
};

function startRealTimePrice(symbol) {
  if (!symbol) return;
  stopRealTimePrice();
  realTimePriceState.symbol = symbol;
  // 即時 fetch 一次
  fetchLatestPrice();
  // 5 秒 polling (大少 15:45 揀)
  realTimePriceState.intervalId = setInterval(() => fetchLatestPrice(), 5000);
  console.log(`[real-time-price] start polling ${symbol} every 5s`);
}

function stopRealTimePrice() {
  if (realTimePriceState.intervalId) {
    clearInterval(realTimePriceState.intervalId);
    realTimePriceState.intervalId = null;
    console.log('[real-time-price] stop polling');
  }
}

async function fetchLatestPrice() {
  const symbol = realTimePriceState.symbol;
  if (!symbol) return;
  try {
    const resp = await fetch(`http://localhost:18792/api/stock-price/${encodeURIComponent(symbol)}`);
    if (!resp.ok) {
      console.warn(`[real-time-price] fetch ${symbol} HTTP ${resp.status}`);
      return;
    }
    const data = await resp.json();
    if (data.price !== null && data.price !== undefined) {
      realTimePriceState.lastPrice = data.price;
      realTimePriceState.lastTime = data.time;
    }
    realTimePriceState.isStale = data.is_stale === true;
    realTimePriceState.currency = data.currency || 'HKD';
    updatePriceColumn();
  } catch (e) {
    console.error('[real-time-price] fetch error:', e);
  }
}

function formatDateTime(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    const MM = String(d.getMonth() + 1).padStart(2, '0');
    const DD = String(d.getDate()).padStart(2, '0');
    const HH = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${MM}-${DD} ${HH}:${mm}:${ss}`;
  } catch (e) {
    return '—';
  }
}

function formatPrice(price, currency) {
  if (price === null || price === undefined) return '—';
  const symbol = currency === 'USD' ? 'US$' : 'HK$';
  return `${symbol} ${price.toFixed(2)}`;
}

function updatePriceColumn() {
  // 大少 2026-08-10 v2: M8 verdict card trading card 已經有「現價」field (entry_zone mid 即使休市都 show)
  //   latest-price-column (⏱️ real-time) 暫時 skip 避免重複
  //   將來如果用得着 real-time kline polling, 可以再 uncomment 下面邏輯
  return;
  /* 大少 2026-08-10 v2 disabled — 改用 M8 verdict card 內建現價 field
  const entryZoneDiv = Array.from(document.querySelectorAll('div')).find(el => {
    if (!el.firstChild || el.firstChild.nodeType !== 3) return false;
    return el.firstChild.textContent.trim() === '🎯 入場區間 (±1.5%)';
  });
  if (!entryZoneDiv) return;
  // entryZoneDiv 嘅 parent = trading-card-field (.trading-card-field style)
  // trading-card-field 嘅 parent = grid container
  const field = entryZoneDiv.parentElement;
  if (!field) return;
  const grid = field.parentElement;
  if (!grid) return;

  // 搵或加 new column
  let newCol = document.getElementById('latest-price-column');
  if (!newCol) {
    newCol = document.createElement('div');
    newCol.id = 'latest-price-column';
    newCol.className = 'trading-card-field latest-price-column';
    newCol.style.cssText = 'background:#fff8e1;border:1px solid #F39C12;border-radius:8px;padding:12px;';
    newCol.innerHTML = `
      <div style="font-size:11px;color:#666;display:flex;justify-content:space-between;align-items:center;">
        <span>⏱️ <span id="latest-price-time">—</span></span>
        <span id="latest-price-market-status" style="color:#888;font-size:10px;"></span>
      </div>
      <div id="latest-price-value" style="font-size:18px;font-weight:700;color:#F39C12;margin-top:4px;">—</div>
    `;
    // Insert 最左 (before first child)
    grid.insertBefore(newCol, grid.firstChild);
    // 改 grid template 5 column (4 → 5)
    grid.style.gridTemplateColumns = 'repeat(5, 1fr)';
  }

  // Update content
  const timeEl = document.getElementById('latest-price-time');
  const valueEl = document.getElementById('latest-price-value');
  const marketStatusEl = document.getElementById('latest-price-market-status');
  if (timeEl) timeEl.textContent = formatDateTime(realTimePriceState.lastTime);
  if (valueEl) valueEl.textContent = formatPrice(realTimePriceState.lastPrice, realTimePriceState.currency);
  if (marketStatusEl) {
    marketStatusEl.textContent = realTimePriceState.isStale ? ' (休市)' : '';
  }
  */
}

// ===== Start =====

init();
// Page unload 自動停 polling
window.addEventListener('beforeunload', stopRealTimePrice);
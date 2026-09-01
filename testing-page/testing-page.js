// ~/stockpulse/testing-page/testing-page.js
//
// StockPulse Algorithm Testing Page — Logic
//
// 架構（永久 design）：
//   - Algorithm Registry (hard-code) — 加新 AS-XX 只需要加 1 行
//   - 動態 import adapter.mjs
//   - Adapter 提供統一 interface:
//
// 大少 2026-08-11 — Module Warning System v1.0.0 引入
// testing page 收集 verdict._warnings → 顯示頂部 WarningBanner + 個別 verdict 內 WarningCard
// 加 window.__copyWarning / window.__copyAllWarnings handlers (畀大少 Copy 提示畀 Mavis 修復)
//       id, name, version, description, inputs
//       async function analyze(klines, options) → verdict
//       function renderResult(verdict) → HTML string
//       function getHelp() → HTML string (optional)
//
// Backend: 從 StockPulse backend (port 18792) 攞 K 線 + 股票搜尋
// CORS: backend 已 enable allow_origins=["*"] 開發階段
// 大少 2026-08-22 07:18 fix: BACKEND_URL 改用 window.location.hostname 自動 detect,
//   之前寫死 localhost, 手機打 192.168.1.125:8765 嘅時候 fetch localhost:18792 = 打去手機自己, 永遠 404
//   用 dynamic hostname 嘅好處: 電腦 localhost 自動指返自己, 手機內網 IP 自動指 Mac, 唔使改 code
//   同時 support ?backend= URL 覆寫, 畀特殊 case (例如 VPN / 別嘅機器) 用
const _backendOverride = new URLSearchParams(window.location.search).get('backend');
const BACKEND_URL = _backendOverride || `http://${window.location.hostname}:18792`;
// 大少 2026-08-22 07:23 fix #2: 同步 set window.BACKEND_URL global, 畀 adapter.mjs 6 個 module 拎
//   (M1/M2/M3/M4/M5/M6 等 analyze* 函數 內部 fetch backend 用 window.BACKEND_URL || 'http://localhost:18792' fallback,
//    之前 testing-page.js 從來冇 set, 所以手機上面 6 個 module 全部 fetch localhost:18792 = 手機自己, 永遠 fetch fail)
//   對應 adapter.mjs 6 處 hardcode line 2186/2640/2983/3463/3971/4484
window.BACKEND_URL = BACKEND_URL;
// Debug helper: 大少撳開個 page 想睇 backend URL 實際指去邊, console.log 呢個就見到
console.log(`[testing-page] BACKEND_URL = ${BACKEND_URL} (hostname: ${window.location.hostname})`);

// 大少 2026-08-29 19:54 — 還原 testing page 前後台 ZigZag 永久 rule
// 凡人話: testing page 4.18.0 之後拎走咗 frontend calculateZigZag, 紫色線 100% 用 backend `/api/algorithms/run?algo=zigzag` 拎
//         大少 trigger「我想你把前後台的都還完可以做到嗎?」, testing page frontend 還原返原本 frontend 算法 (1-to-1 port 落 backup)
//         Backend `backend/algorithms/zigzag/algorithm.py` 1-to-1 port 返 frontend 算法 (拎走 _zigzag_fit state machine, 用 frontend ref code 對齊)
//         還原之後大少可以對比: testing page frontend JS 計 (T-1 normalized K 線) vs testing page backend Python 計 (KlineCache raw K 線)
//         兩者算法 1-to-1 對齊, K 線 source 唔同, 大少可以 isolate 邊度係 K 線 source 問題
//
// 對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs:1505-1625 (calculateZigZag 核心算法)
//
// 永久 rule (大少 2026-08-29 19:54):
// - testing page frontend 紫色線 + 鮮綠線 100% frontend 計 (1-to-1 port backup 2026-08-20)
// - testing page 唔再 fetch backend `/api/algorithms/run?algo=zigzag`
// - Backend `algorithm.py` 拎走 `_zigzag_fit` state machine, 1-to-1 port frontend 算法

// ===== 大少 2026-08-29 19:54 — 還原 testing page frontend ZigZag (1-to-1 port backup 2026-08-20) =====
// 大少 2026-08-30 22:04 — 4.43.0 拎走 5 個 frontend ZigZag function
// (calculateZigZagFrontend + _buildExtensionLineFrontend + autoThresholdVolatility + extractHLC + _zigzagNormalizeDate)
// 改 fetch backend `/api/algorithms/run?algo=zigzag` 拎 verdict, 對齊 production frontend
// ChartContainer.tsx + ElliottWaveTestPage.tsx 已經用緊嘅 pattern
// 4 個新 query params (threshold_mode / manual_threshold / lookback / multiplier) 喺 backend
// endpoint 加 validation (4.43.0 safety improvement #1), frontend 拎 LS value 傳 backend
// 詳細睇 plan: 拎走 5 個 function 之前係 4.18.0 Phase 1 之後嘅 frontend 算法, 之後 4.32.0
// testing page 加返 frontend 算法, 而家 4.43.0 拎走 frontend 算法 + 改 fetch backend

// localStorage 存取 — 跟 2026-08-19 13:03 永久 rule「自動儲存更新圖表」一致
// 永久 rule (大少 2026-08-21 00:02): 新股票冇 record → 自動 mode 預設
const LS_KEY_THRESHOLD_MODE = 'stockpulse.zigzag.thresholdMode';
const LS_KEY_MANUAL_THRESHOLD = 'stockpulse.zigzag.manualThreshold';

function getThresholdMode() {
  return localStorage.getItem(LS_KEY_THRESHOLD_MODE) || 'auto';
}
function setThresholdMode(mode) {
  localStorage.setItem(LS_KEY_THRESHOLD_MODE, mode);
}
function getManualThreshold() {
  const v = parseFloat(localStorage.getItem(LS_KEY_MANUAL_THRESHOLD));
  return Number.isFinite(v) && v >= 1 && v <= 20 ? v : 5;
}
function setManualThreshold(v) {
  localStorage.setItem(LS_KEY_MANUAL_THRESHOLD, String(v));
}

// 大少 2026-08-21 00:24 trigger — lookback 參數 (手動可調, 預設 20 日, 自動儲存)
const LS_KEY_LOOKBACK = 'stockpulse.zigzag.lookback';
const LOOKBACK_DEFAULT = 20;
const LOOKBACK_MIN = 5;
const LOOKBACK_MAX = 100;

function getLookback() {
  const v = parseInt(localStorage.getItem(LS_KEY_LOOKBACK), 10);
  return Number.isFinite(v) && v >= LOOKBACK_MIN && v <= LOOKBACK_MAX ? v : LOOKBACK_DEFAULT;
}
function setLookback(v) {
  localStorage.setItem(LS_KEY_LOOKBACK, String(v));
}

// 大少 9月2日 00:52 trigger (4.66.0) — 拎返 P 點 + 鮮紫獨發點 marker toggle (4.53.0 拎走嘅 spirit 拎返, 預設關)
// 對齊 4.51.0 拎走嘅 #show-sequence toggle 嗰個 LS_KEY 命名 pattern, 4.61.5 拎走, 4.66.0 拎返
// 對齊 8月19日 13:03 Config UX 模式永久 rule「自動+手動+自動儲存更新圖表」: 即時 localStorage + 即時 re-render
// 對齊 8月21日 00:02 永久 rule「手動 mode 預設」: 預設 false, 撳開就見 P1-P10 + 鮮紫 trigger
const LS_KEY_SHOW_MARKERS = 'stockpulse.zigzag.showMarkers';
function getShowMarkers() {
  // 大少 00:52 明確 trigger「預設是關的」, localStorage 冇 record 時 return false (拎返拎走 4.62.0 default 拎返拎走 4.53.0 拎走嘅 spirit)
  return localStorage.getItem(LS_KEY_SHOW_MARKERS) === 'true';
}
function setShowMarkers(v) {
  localStorage.setItem(LS_KEY_SHOW_MARKERS, String(!!v));
}

// ===== 大少 2026-08-30 22:04 — 4.43.0 Testing page ZigZag 全部 backend 計 =====
// 凡人話: 拎走 5 個 frontend ZigZag function, 改 fetch backend `/api/algorithms/run?algo=zigzag` 拎 verdict
// 對齊 production frontend ChartContainer.tsx 已經用緊嘅 pattern
// 永久 rule 4.43.0: ZigZag 全部 backend 計, frontend 拎 fetch verdict, 唔再重計
// 對齊 4.42.3 永久 rule: verdict meta inject 永遠唔需要 lastChartRefs (純 JS 嘢, 拎走 global guard 改 inline if (lastChartRefs))

/**
 * 凡人話: fetch backend ZigZag verdict
 * - code: 股票代號 (e.g. "HK.00700")
 * - period: K 線週期 (e.g. "1d")
 * - thresholdMode: 'auto' | 'manual'
 * - manualThreshold: 1-20, only used if thresholdMode='manual'
 * - lookback: 5-100, only used if thresholdMode='auto'
 * - multiplier: 1-5, only used if thresholdMode='auto' (永久 2.5)
 * - signal: AbortController.signal (cancel stale fetch)
 *
 * Returns: backend verdict ({ok, points, meta, warnings, error})
 *  對齊 production frontend ChartContainer.tsx fetchBackendZigZag pattern
 */
async function fetchBackendZigZag(code, period, thresholdMode, manualThreshold, lookback, multiplier, signal) {
  const params = new URLSearchParams({
    algo: 'zigzag',
    symbol: code,
    period: period,
    data_window_days: '1260',
    threshold_mode: thresholdMode,
    lookback: String(lookback),
    multiplier: String(multiplier),
  });
  if (thresholdMode === 'manual' && manualThreshold != null) {
    params.set('manual_threshold', String(manualThreshold));
  }
  const url = `${BACKEND_URL}/api/algorithms/run?${params.toString()}`;
  const fetchOptions = signal ? { signal } : {};
  const resp = await fetch(url, fetchOptions);
  if (!resp.ok) {
    throw new Error(`Backend ZigZag 拎唔到: ${resp.status} ${resp.statusText}`);
  }
  const verdict = await resp.json();
  if (!verdict.ok) {
    throw new Error(`Backend ZigZag verdict fail: ${verdict.error || 'unknown'}`);
  }
  return verdict;
}

/**
 * 凡人話: fetch backend ZigZag verdict + inject 落 lastVerdict.meta (對齊 testing page 拎法 8 個 field)
 * 對齊 4.42.3 永久 rule: verdict meta inject 永遠唔需要 lastChartRefs (純 JS 嘢)
 *
 * AbortController: 大少撳 slider 嗰陣 debounce 200ms, 之間 user 再撳會 cancel stale fetch
 *  (跟 production frontend ChartContainer.tsx pattern, 永久 rule 對齊)
 *
 * Returns: backend verdict (供 caller 同步 call renderChartOverlay), 失敗 return null
 */
let _zigzagFetchController = null;
async function fetchAndInjectBackendZigZag(thresholdMode, manualThreshold, lookback, multiplier) {
  // 大少 2026-09-01 23:11 trigger (Fix 3 debug) — 加 5 個 console.log 查「撅其他股票 P 點 marker 唔出」issue
  // Debug evidence 顯示 backend 拎到 points (01888:49, 0981:90, 00700:189), frontend algorithm verdict 拎空, 紫色線 + P 點 marker 都不 render
  // 撅 00019 嗰陣 frontend algorithm verdict 正常, P 點 marker 出. 撅 01888/0981/00700 frontend algorithm verdict 拎空 (ok=None, meta keys=[]), 因為 line 147 early return 令 backend ZigZag fetch 唔跑
  console.log(
    `[ZigZag Debug] fetchAndInjectBackendZigZag 入口: code=${currentOptions.code}, ` +
    `lastVerdict=${lastVerdict ? `存在 (ok=${lastVerdict.ok}, meta keys=${Object.keys(lastVerdict.meta || {}).length})` : '❌ null'}, ` +
    `lastKlines=${lastKlines ? `${lastKlines.length} 條` : '❌ null'}, ` +
    `currentAdapter=${currentAdapter ? currentAdapter.id : '❌ null'}, ` +
    `thresholdMode=${thresholdMode}, lookback=${lookback}, multiplier=${multiplier}`
  );
  if (!lastVerdict || !lastKlines || !currentAdapter) {
    console.warn(`[ZigZag Debug] ⚠️ early return 原因: lastVerdict=${!lastVerdict}, lastKlines=${!lastKlines}, currentAdapter=${!currentAdapter} (P 點 marker 唔出)`);
    return null;
  }
  const code = currentOptions.code;
  const period = currentOptions.period || '1d';
  if (!code) {
    console.warn('[ZigZag Debug] ⚠️ early return 原因: currentOptions.code 唔存在');
    return null;
  }

  // 大少 4.43.0 safety improvement #2: AbortController cancel stale fetch
  // (slider 即時 re-render 撳緊 debounce 200ms 之間 user 再撳會 cancel stale fetch)
  if (_zigzagFetchController) {
    _zigzagFetchController.abort();
  }
  _zigzagFetchController = new AbortController();
  const signal = _zigzagFetchController.signal;

  try {
    console.log(`[ZigZag Debug] fetch start: ${BACKEND_URL}/api/algorithms/run?algo=zigzag&symbol=${code}&period=${period}&data_window_days=1260&threshold_mode=${thresholdMode}&lookback=${lookback}&multiplier=${multiplier}`);
    const verdict = await fetchBackendZigZag(
      code, period, thresholdMode, manualThreshold, lookback, multiplier, signal
    );
    console.log(`[ZigZag Debug] fetch success: verdict.ok=${verdict.ok}, points count=${verdict.points?.length}, meta keys=${Object.keys(verdict.meta || {}).join(',')}`);

    // 拎 lastSwingHigh / lastSwingLow (對齊 testing page 拎法, frontend 之後 inject 8 個 field)
    const reversePoints = [...verdict.points].reverse();
    const lastHigh = reversePoints.find(p => p.type === 'high');
    const lastLow = reversePoints.find(p => p.type === 'low');

    // 凡人話: inject 落 lastVerdict.meta 8 個 field, 對齊前端 4.42.3 永久 rule
    // (verdict meta inject 永遠唔需要 lastChartRefs, 純 JS 嘢)
    lastVerdict.meta.zigzagPoints = verdict.points;
    lastVerdict.meta.lastSwingHigh = lastHigh ? { date: lastHigh.date, value: lastHigh.value } : null;
    lastVerdict.meta.lastSwingLow = lastLow ? { date: lastLow.date, value: lastLow.value } : null;
    lastVerdict.meta.zigzagThreshold = verdict.meta.threshold;
    // 大少 8月31日 17:42 trigger (修改版 20:51) 4.57.0 — 多 inject thresholdMode 畀 debug panel 顯示
    // 對齊 4.57.0 永久 rule: 「🔧 Threshold: X.XX% (mode: auto|manual)」要用呢個 field
    lastVerdict.meta.zigzagThresholdMode = thresholdMode;
    lastVerdict.meta.extensionLine = verdict.meta.extension_line;
    lastVerdict.meta.zigzagExtensionLine = verdict.meta.extension_line;  // 向後兼容
    lastVerdict.meta.zigzagSource = 'backend (4.43.0 1-to-1 port frontend)';
    lastVerdict.meta.zigzagPointsCount = verdict.points.length;

    console.log(
      `[ZigZag Backend] M1 chart → ${verdict.points.length} 個 points from backend ` +
      `(threshold=${verdict.meta.threshold}%, mode=${thresholdMode}, klines=${verdict.meta.klines_count})`
    );
    return verdict;
  } catch (e) {
    if (e.name === 'AbortError') {
      console.log(`[ZigZag Debug] ⚠️ fetch cancelled (AbortError, stale request for ${code})`);
      return null;
    }
    console.warn(`[ZigZag Debug] ❌ fetch 失敗, fallback 唔 render:`, e);
    return null;
  }
}

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
// 大少 2026-08-11 M8 v3.9 + Warning System v1.0.0: ALGO_CACHE_BUST = '3.9.0' (M8 v3.8 → v3.9.0 改動: Module Warning System Phase 3+4 引入 — testing page 加 WarningBanner 頂部 + WarningCard 個別 verdict 內 + Copy 全部/單個 warning button, 從 ../algorithms/AS-03-cycle-detection/lib/warnings.mjs 引入 helpers)
// 大少 2026-08-11 Codebase 註解 Phase 4: ALGO_CACHE_BUST = '4.0.0' (testing-page.js __copyWarning / __copyAllWarnings 加 inline 註解 — 凡人話流程 + 永久 rule + 參數說明, 其他 AI 閱讀時能立即明白 Copy handler 點 work)
// 大少 2026-08-11 19:55 Dropdown 排位: ALGO_CACHE_BUST = '4.1.0' (M9 排 M8 上邊 — REGISTRY array element order 互換, ID/displayName 編號唔改, 純 visual 排位反映 M7→M9→M8 chain 邏輯)
// 大少 2026-08-11 20:40 B 改善: ALGO_CACHE_BUST = '4.2.0' (M8 verdict 加 optimal_params_timestamp + renderOptimalParamsBanner 頂部 banner — 凡人話 1 句講晒「用咗幾時嘅最佳設定」, 3 種狀況: 冇 cache 黃色 / < 7 日綠色 / ≥ 7 日紅色)
// 大少 2026-08-11 20:55 A 改善: ALGO_CACHE_BUST = '4.3.0' (testing page 加「🚀 跑完整鏈條 (M7→M9→M8)」按鈕 + runFullChain() handler — 凡人話 1 句講晒「撳 1 個掣自動跑晒 3 個 module」, 3 個 step progress 顯示, M9 失敗 fallback 用 default 繼續跑 M8)
// 大少 2026-08-11 21:16 M9 bug fix: ALGO_CACHE_BUST = '4.3.1' (A 改善 chain test 揭發 M9 自身有 ReferenceError 'postErrors is not defined' — surgical 1 行 fix 加 const postErrors = walkForwardResult.folds.flatMap(f => f.postErrors || []))
// 大少 2026-08-11 21:20 C 改善: ALGO_CACHE_BUST = '4.4.0' (runAlgorithm 撳 M8 之前, 自動 check adaptive_params cache 7 日 expiry — 過期提示「⚠️ 強烈建議撳🚀 跑完整鏈條掣」, 唔 auto trigger M9, 只係 hint)
// 大少 2026-08-11 21:32 Dropdown zmen 排頂: ALGO_CACHE_BUST = '4.4.1' (REGISTRY array 將 zmen 均算法 block 從中間位置搬去最頂, ID/displayName 唔改, 純 visual 排位)
// 大少 2026-08-11 22:05 改善 1+3: ALGO_CACHE_BUST = '4.5.0' (M8 verdict 拎 optimalData 替代 cacheInfo 拎 optimal_params_* 3 個 field + 新加 renderM9Summary(verdict) function 喺 banner 之後 render 5 個 metric mini-cards — 凡人話「撳 M8 即刻見到 M9 拎咗咩 optimal 設定」)
// 大少 2026-08-11 22:05 改善 2: ALGO_CACHE_BUST = '4.5.1' (runFullChain 改 conditional — M9 過期先跑, cache OK skip M9 (4 秒搞掂, 唔再 30-60 秒浪費) — 大少 trigger「跑完整鏈條也會Skeep咗M9, 那是和跑算法是一樣的, 那跑完整鏈條不是可以代替跑算法?」嘅 insight)
// 大少 2026-08-11 22:50 UX 改善: ALGO_CACHE_BUST = '4.5.2' (onAlgorithmChange 加 conditional show/hide — 「🚀 跑完整鏈條」掣只揀 M8 (AS-03-DEC) 時顯示, 其他 module 隱藏 + 「跑算法」掣 M8 嗰陣隱藏 (揀 chain 掣), 其他 module 顯示 — 大少 trigger「所有Module都看到跑完整鏈條, 應該只有在M8 裡才用吧?」+「在M8裡還有跑算法, 這個是不是可以不要了?」)
// 大少 2026-08-13 07:23 M9 popup 註解全面化: ALGO_CACHE_BUST = '4.5.3' (M9 verdict 25 個 keyword 全部加 m9-verdict-tooltip class + data-help attribute, 8 section 全部凡人話解釋 — 跟 M7/M8 同樣 inline <style> block 嘅 hover popup 風格)
// 大少 2026-08-13 07:46 WarningBanner expand bug fix: ALGO_CACHE_BUST = '4.5.4' (warnings.mjs 「展開 ▼」button onclick 改拎 this.parentElement.nextElementSibling (hidden list div), 之前拎 this.nextElementSibling 拎錯 Copy 全部 button, 撳咗 toggle 錯 element, list 永遠唔出 — 1 個 Info warning 嘅詳細內容完全冇辦法睇)
// 大少 2026-08-13 10:50 M1 fix 詳細 + context 統一 precision: ALGO_CACHE_BUST = '4.5.5' (B: M1 v2.0 THRESHOLD_BREACH warning 嘅 fix message 改詳細 (解釋「唔代表演算法錯」+ 確認橫行方法 3 步 + 檢查 dataWindowDays) + C: formatWarningForCopy 對 number context value 統一 4 位小數 + 去 trailing zero (parseFloat(toFixed(4))), object 仍然 JSON.stringify)
// 大少 2026-08-14 11:33 Warning v1.1.0 — 2 banner 分類: ALGO_CACHE_BUST = '4.6.0' (warnings.mjs 加 WARNING_CATEGORIES (15 個 code 分 system / stock_state) + CATEGORY_DISPLAY (2 種 template) + renderWarningBanners() render 2 個獨立 banner (🔧 系統 + 📊 股票狀態) + formatWarningForCopy / formatAllWarningsForCopy 加 category label, renderWarningBanner() 保留 backward compat, 凡人話: 大少一眼分到「呢個係 verdict 唔可信」定「呢個係股票狀態提示」)
// 大少 2026-08-14 12:10 Warning v1.1.0 — 統一 13 個 warning 注入點 template: ALGO_CACHE_BUST = '4.6.1' (adapter.mjs 28 個 makeWarning 注入點嘅 impact 同 fix 統一跟 CATEGORY_DISPLAY template, system 「Verdict 唔可信, 唔好落單」/ 「Re-run / 檢查 K 線 / 檢查 cache / 睇 spec doc」, stock_state 「Verdict 已經準確, 留意股票狀態」/ 「睇其他 module 確認 / 留意 M7 alignment」, issue 保留各 module 嘅 specific context, 凡人話: 大少見到 impact 即知 verdict 信唔信, 唔使再讀各 module 自己寫嘅 string)
// 大少 2026-08-14 14:44 Popup 用語專業化: ALGO_CACHE_BUST = '4.6.2' (M7 grade tooltip 改「學校評分制」做「Grade 評分制」+ 跟美股標普評級同 standard credit rating 邏輯, 凡人話: 大少見到「學校」呢啲 casual 詞覺得唔專業, 改用 standard financial industry 用語)
// 大少 2026-08-14 23:15 dataWindowDays 默認 100 → 1260 + 移除 CONFIG_DEFAULTS trigger: ALGO_CACHE_BUST = '4.6.3' (testing page 默認值 100 → 1260, M1 v0.3.0 zmen + M9 移除 CONFIG_DEFAULTS trigger 因為 default 永遠等於 trigger 條件, warning 永遠 trigger 變廢話, 凡人話: 大少撳跑 zmen / M9 唔再見到 CONFIG_DEFAULTS 呢個廢話 warning, 跟住揀項 1 嘅 M9 auto-calibrate dataWindowDays 拎出嚟做 follow-up sprint)
// 大少 2026-08-19 ZigZag 加 M1: ALGO_CACHE_BUST = '4.8.0' (M1 算法加 ZigZag 5% threshold 過濾 noise, ma-alignment.ts 加 calculateZigZag function + ZigZagPoint interface + 4 個新 meta field (zigzagPoints / lastSwingHigh / lastSwingLow / zigzagThreshold), adapter.mjs renderChartOverlay 加紫色 ZigZag line series, testing page 加啟用 checkbox + threshold 輸入控制, 凡人話: 大少 trigger「缺 ZigZag 重要指標, 用 5% 過濾 noise」, 跟 StockPulse 首頁 ChartContainer.tsx 同一個 algorithm)
// 大少 2026-08-19 09:10 加 visible debug panel + detailed explanation 4 個 ZigZag field: ALGO_CACHE_BUST = '4.8.2' (testing page 喺 chart 下面 auto-render 黑色 debug 區域 dump chart state (verdict meta keys / maV2LineSeries keys / zigzagEnabled / zigzag series exists / zigzagPoints length), 順便 renderMAAlignmentV2DetailedExplanation 加 4 個 ZigZag field display (zigzagPoints / lastSwingHigh / lastSwingLow / zigzagThreshold), 大少唔使去 console 拎 window.currentChartRefs 直接睇 page debug panel 就得)
// 大少 2026-08-19 09:40 加深綠色 close extension line: ALGO_CACHE_BUST = '4.8.3' (大少 trigger 紫色 ZigZag 拎到嘅 peak/trough 之後, 想加多一條深綠色線 (#2E7D32) 由最後 ZigZag point 連去 K 線最後 close, 即時見到趨勢延續, 凡人話警告: 呢段深綠色線唔代表 algorithm 確認到轉向, 只係 visualize, 順便 testing page debug panel 加 close extension series 顯示狀態 + K線最後 close value/date)
// 大少 2026-08-19 09:45 fix debug panel new Date(invalid).toISOString() RangeError: ALGO_CACHE_BUST = '4.8.4' (debug panel 用 try/catch + isNaN 拎 K 線最後日期, 避免 klines 嘅 timestamp / date field 拎到 invalid string 拋 RangeError: Invalid time value 喺 Date.toISOString())
// 大少 2026-08-19 10:00 dropdown 把 zmen 排最尾: ALGO_CACHE_BUST = '4.8.5' (REGISTRY array 內 zmen 均算法 entry 由排第 1 改去排最尾 (M11 BTL 之後), 純 visual 排位, ID/displayName/adapterExport 全部唔改, 大少 trigger「在算法 Dropdown List 裡把 zmen 的算法排在最後」, 改返 2026-08-11 21:32 嘅「排最頂」永久 rule)
// 大少 2026-08-19 10:10 chart 預設 zoom 落去最近半年: ALGO_CACHE_BUST = '4.8.6' (testing page renderChart 喺 fitContent() 之後 setTimeout(50ms) 調用 setVisibleLogicalRange 將預設 visible range 設為最近 126 個交易日 ≈ 半年, data 仍然係 1260 日 (5 年) 全部 喺度, 大少可以人手 pan/zoom 返去看全部 5 年, 大少 trigger「圖表預設顯示 1260 日全圖很難看到細節, 想要預設 zoom 落去半年」)
// 大少 2026-08-19 10:15 fix 2 個 minor display issue: ALGO_CACHE_BUST = '4.8.7' (adapter.mjs calculateZigZag line 1608 直接拎 klines[].date 改用 _zigzagNormalizeDate fallback chain, fix verdict.meta.lastSwingLow.date 拎唔到 (顯示 {"value":436} 冇 date field 嘅 root cause) + testing-page.js debug panel K 線最後 date 拎取加 _getKlineDateForDebug helper (跟 _zigzagNormalizeDate 同樣 fallback chain), fix 「K線最後 close @ (invalid)」拎唔到 date 嘅 issue, 凡人話: 之前直接拎 klines[].date 或 klines[].timestamp, klines 個 field 唔一定叫 date (有時叫 timestamp / time), fallback chain 拎到 valid date)
// 大少 2026-08-19 11:15 ZigZag 點順序號碼 (1, 2, 3, ...): ALGO_CACHE_BUST = '4.9.0' (adapter.mjs renderMAAlignmentV2ChartOverlay 加 ZigZag 點順序號碼 marker (1 號=今日 close 深綠色, 2 號=紫色最後 1 個, 倒序排), 拎 LightweightCharts.createSeriesMarkers 畀 candle series 加 marker, testing page 加 toggle checkbox 「顯示 ZigZag 點順序號碼」+ spinbutton 「顯示最近 N 個」(預設 30, 紫色 161 個 + 深綠色 1 個 = 162 個全部顯示會太擠), 大少 trigger「每個點加順序號碼, 由最新開始, 包括最後嗰條綠色線, 要 option toggle」)
// 大少 2026-08-19 11:45 ZigZag 點順序號碼 fix v2: ALGO_CACHE_BUST = '4.10.0' (改用 lightweight-charts v4.2.3 native candleSeries.setMarkers() API 而唔係 v5 LightweightCharts.createSeriesMarkers plugin, 因為 testing page CDN 行緊 v4.2.3 唔 support v5 plugin API, 永遠 skip; setMarkers() v4 同 v5 都有, 向後兼容; 同時抽 renderDebugPanel() function 出去, 畀 runAlgorithm + reRenderZigZagSequence() 都 call, 因為之前 debug panel 喺 runAlgorithm create 一次之後永遠唔再 update, toggle 切 sequence 嗰陣 panel 入面 text 仲係舊 state)
// 大少 2026-08-19 16:30 之字斜率 Stage 1 framework: ALGO_CACHE_BUST = '4.11.0' (adapter.mjs 加 calcZigZagSlope 函數 (用之字最後 2 個 confirmed point 計斜率, Solution A 加 extended lastToToday 處理甩尾), analyzeMAAlignmentV2 meta 加 zigzagSlope field, 凡人話 display 加 prevToLast + lastToToday 雙斜率, 凡人話: 大少 trigger「用之字第 1 點 → 第 2 點計斜率」核心框架, 唔郁 trigger logic (Stage 2 先郁))
// 大少 2026-08-19 16:43 修正 2 個 UI bug: ALGO_CACHE_BUST = '4.12.0' (Bug 1: ZigZag sequence marker 全部用 position: 'inBar' 錯, 改 high type → aboveBar (Peak 號碼喺上) + low type → belowBar (Trough 號碼喺下) + 1 號 (close) → aboveBar; Bug 2: setVisibleLogicalRange 嗰陣 v4.2.3 會清 marker state 導致 50ms race condition, 50ms 後再 set 返一次確保 persist, 大少 reload verify)
// 大少 2026-08-19 17:00 MA 線獨立 toggle 即時生效: ALGO_CACHE_BUST = '4.13.0' (testing-page/index.html 加 4 個 MA checkbox (MA5/MA10/MA20/MA60 顏色 chip 對齊 line color), testing-page.js 加 4 個 change handler 用 lineSeries.applyOptions({ visible }) 即時切換, 唔需要 re-create series 或 re-call renderChartOverlay, 凡人話: 大少撳 MA5 → 紅色線即時消失 / 出現, 注意只 cover M1 v2.0 (maV2LineSeries), zmen v0.3.0 用 maLineSeries 唔 cover)
// 大少 2026-08-19 17:05 MA toggle UI 改善: ALGO_CACHE_BUST = '4.14.0' (MA toggle div 從 inputs section 搬到 chart-section 上面 (#ma-toggle-bar 用淺灰背景 + padding), 凡人話: 大少 trigger「放喺圖表上邊方便使用」; MA10 預設 unchecked (其他 MA 維持 checked), 凡人話: 大少 trigger「MA10 預設冇 Take」)
// 大少 2026-08-20 07:10 之字 metric 對齊 hot fix: ALGO_CACHE_BUST = '4.15.0' (adapter.mjs calculateZigZag 函數 (2 處) 改用 high/low 拎 point 同計 threshold, 原本用 close 計拎唔到 wick extreme, 大少 evidence 太古 00019 7/30 high 100 → 8/6 low 92.45 = -7.55% 跌穿 5% 但 close 96.65 跌幅 -3.35% 唔過 threshold, 拎唔到 8/6 trough 92.45; 改 high/low 對齊後拎到, 永久 rule: 之字拎 point 同 trigger 都用 high/low 對齊, 唔好用 close)
// 大少 2026-08-20 12:01 direction flag refactor: ALGO_CACHE_BUST = '4.16.0' (adapter.mjs calculateZigZag 用 1 個 direction flag + 1 個 refValue + 1 個 refIdx + 1 個 loop 取代舊 2 variable + 2 loop; trigger metric changeFromRef 永遠 pre-calculate 喺 for loop 開頭對齊舊算法行為避免同日 noise; 4 隻 stock 拎 evidence 確認拎 point 100% 一樣; 永久 rule: 永遠用 clean state machine, 唔好再分 2 loop)
// 大少 2026-08-20 19:17 Phase 1 ZigZag 加 M1 圖表 (backend 拎 data): ALGO_CACHE_BUST = '4.17.0' (testing-page.js 加 fetchBackendZigZag function 拎 Phase 1 backend /api/algorithms/run?algo=zigzag 嘅 verdict, runAlgorithm 撳跑 M1 (AS-03-MA) algorithm 嗰陣, 喺 frontend analyze 完成之後, await fetch backend ZigZag 拎 verdict, 將 backend verdict.points 注入 verdict.meta.zigzagPoints override frontend 拎嘅, 紫色 ZigZag 線 render 用 backend 拎 data, 證明 Phase 1 backend 整合 frontend 成功; fallback: backend 拎唔到用 frontend 拎嘅, 唔 crash; 凡人話: 將 backend 算法落 M1 chart, 大少撳跑 M1 → 紫色 ZigZag 線由 backend 計, frontend 拎嘅 fallback)
// 大少 2026-08-20 19:50 Phase 1 拎走 frontend ZigZag (跟 adapter.mjs 4.18.0 同步): ALGO_CACHE_BUST = '4.18.0' (testing-page.js 同步 bump 因為 frontend M1 algorithm 拎走 ZigZag, runAlgorithm 之後 fetch backend ZigZag 已經變成唯一 source, fallback 拎走; ChartContainer.tsx + ElliottWaveTestPage.tsx 改 fetchBackendZigZag 拎 backend, 拎走 frontend calculateZigZag)
// 大少 2026-08-20 20:42 Phase 3 M2 HL Structure 拎走 frontend: ALGO_CACHE_BUST = '4.19.0' (補返 Phase 3 漏做嘅 cache bust bump — frontend M2 analyzeHLStructure 拎走 367 行 + 4 個 helper, 換 fetch backend stub, 永久 rule 跟返 13:10 spec: 改 adapter.mjs 之後必同步 bump 2 個地方)
// 大少 2026-08-20 20:50 Phase 4 M3 Trendline 拎走 frontend: ALGO_CACHE_BUST = '4.20.0' (補返 Phase 4 漏做嘅 cache bust bump — frontend M3 analyzeTrendline 拎走 506 行 + 7 個 helper, 換 fetch backend stub, 永久 rule 一致)
// 大少 2026-08-20 21:30 Phase 5+6 M4 Indicators + M5 VolumePrice 拎走 frontend: ALGO_CACHE_BUST = '4.21.0' (Phase 5+6 combined, 拎走 M4 566 行 + M5 ~993 行 frontend, 換 2 個 fetch backend stub, 8 個 render function verdict.X 改 verdict.meta.X, 永久 rule 一致)
// 大少 2026-08-20 21:24 Fix commit (補返 Phase 3+4+5+6 漏做嘅 cache bust bump): ALGO_CACHE_BUST = '4.21.1' (Phase 1+2 之後 4 個 phase 嘅 cache bust 從來冇做過, 大少 trigger「Doc 都改好了嗎」發現 spec doc 同 testing page code 唔對齊, 而家一齊補返 3 個 phase 漏做嘅 + 永久 rule 加 self-check: 改 adapter.mjs 之後 commit 之前 grep testing-page.js ALGO_CACHE_BUST + index.html ?v= 確認同步 bump, 唔好再漏做)
// 大少 2026-08-20 22:08 Phase 10 M8 Decision Engine 拎走 frontend: ALGO_CACHE_BUST = '4.25.0' (frontend decisionEngineAdapter.analyze 拎走 340 行 chain (import bundle + 拎 cache + 拎 M1/zmen + calibrate + applyAdaptiveParams + decide + 9 個 warning 注入), 換 1 個 fetch backend /api/algorithms/run?algo=decision_engine stub, AS-03 進度 10/10 peer algorithm backend done — M1+M2+M3+M4+M5+M6+M7+M8+M9+ZigZag 全部 backend port 完成, 永久 rule self-check 確認: 改 adapter.mjs 之後必同步 bump 2 個地方, Phase 10 跟返冇漏)
// 大少 2026-08-20 23:10 Bug fix — ZigZag threshold slider 即時 re-render: ALGO_CACHE_BUST = '4.26.0' (testing-page.js 重構 runAlgorithm L785-820 + 抽 refreshZigZagOverlay helper (override lastVerdict.meta + 清舊 ZigZag/extension series + renderChartOverlay 重畫紫色線 + renderDebugPanel 重 update) + 加 #zigzag-threshold input onChange handler (input + change event, debounce 200ms 防拖動 spam, sync value 入 currentOptions, 撳即時 call refreshZigZagOverlay); Bug: 之後 #zigzag-threshold input 完全冇 onChange handler, value 永遠唔入 currentOptions, 紫色線永遠用緊撳跑嗰陣嘅 5%, 違反 2026-08-19 13:03 永久 rule「改動 → 即時 re-render, 唔需要撳跑算法」; 永久 rule: testing page 所有 config input 必須有 onChange handler 同步入 currentOptions + 自動 re-render, 套用 M2/M3/M4 之後 config 全部跟; index.html hint 改「改完即時更新紫色線, 唔使撳跑算法」)
// 大少 2026-08-20 23:20 — ZigZag controls + runStatus 搬到圖表上邊: ALGO_CACHE_BUST = '4.27.0' (index.html layout 改: #run-status + #zigzag-controls + #zigzag-sequence-controls 由 inputs section 搬去 chart-section 入面 chart container 之前, 排 ma-toggle-bar 之前, 大少 23:20 trigger「移到圖表上邊」, 一睇 chart 即刻見到即時更新 message 同 ZigZag 設定, 視線唔使離開 chart 向上望; testing-page.css .run-status margin-top 12px 改 margin-bottom 8px 因為已喺 chart-section 內, 唔再需要 margin-top; 永久 rule: 跟 chart 互動嘅 controls + status 永遠排喺 chart-section 入面 chart container 之前, 唔好散喺 inputs section)
// 大少 2026-08-21 00:38 — Lookback 永遠可改 (拎走 manual mode 嘅 disabled): ALGO_CACHE_BUST = '4.31.0' (改寫 Spec Sync #35 永久 rule: 大少 trigger「這個參數不用 Disable」; 拎走 applyLookbackEditable() helper 嘅 disabled toggle, Lookback 永遠 enable, initThresholdModeUI() / mode 切換 handler / reset auto 掣 拎走 3 個 call, lookback onChange handler 改: 永遠 setLookback(v) 儲 localStorage (auto + manual mode 都儲), 只係 auto mode 嗰陣 trigger applyAutoThreshold 即時重算, manual mode 嗰陣只儲 localStorage 等下次切 auto 先用; 對應大少 trigger「當轉手動時,"最近 日波動率 × 2.5 (5-100) 重置為 20" 變成了 Disable, 這個參數不用 Disable」)
// 大少 2026-08-29 19:54 — 還原 testing page 前後台 ZigZag: ALGO_CACHE_BUST = '4.32.0' (testing-page.js 加 frontend calculateZigZagFrontend function + _buildExtensionLineFrontend (1-to-1 port 落 backup 2026-08-20) + 拎走 fetchBackendZigZag fetch backend 嗰段 + 拎走 refreshZigZagOverlay override 邏輯, 改用 applyFrontendZigZagOverlay 同步 function; 4 個 call sites 拎走 (applyAutoThreshold / 切手動 mode / threshold slider 即時 re-render / mode 切換); 紫色線 + 鮮綠線 render 用 frontend 拎 data; backend `backend/algorithms/zigzag/algorithm.py` 同步拎走 _zigzag_fit state machine, 1-to-1 port frontend 算法, 永久 rule 兩邊都用 frontend ref code 對齊; 大少 trigger「還完 testing page 的前台 zigzag, 那是在前台計算的」+「testing page 前後台還原」; 對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs:1505-1625)
// 大少 2026-08-21 11:14 — Bug fix 深綠色 close extension line 唔 render: ALGO_CACHE_BUST = '4.32.0' (adapter.mjs renderMAAlignmentV2ChartOverlay line 5016 call _zigzagNormalizeDate() 撞 ReferenceError 因為 Phase 1 (4.18.0) 拎走咗 frontend helper 但漏改呢個 call site, 紫色 ZigZag 線 render 成功但深綠色 extension line 永遠 skip, 大少 11:14 trigger「加上最後一支暫時性的Zigzag線是連到最新的Close」時發現冇 render; 改用 inline fallback chain (lastKline.time || lastKline.date || lastKline.timestamp) 對齊 testing-page.js _getKlineDateForDebug 邏輯, 加 console.log trace 方便下次 bug debug)
// 大少 2026-08-21 11:20 — 鮮綠色 (#00C853) 取代深綠色 (#2E7D32): ALGO_CACHE_BUST = '4.33.0' (adapter.mjs renderMAAlignmentV2ChartOverlay 鮮綠色 close extension line + 1 號 marker 文字改用 #00C853, Material Green A700 鮮明對比紫色, 大少 trigger「我想改成鮮綠色」, 對齊 1 號 marker 同線身用同一隻色)
// 大少 2026-08-21 11:26 — Option A backend 補返 zigzagSlope field: ALGO_CACHE_BUST = '4.34.0' (backend/algorithms/zigzag/algorithm.py 加 _calc_zigzag_slope static method, 從 Phase 1 (4.18.0) 拎走嘅 frontend calcZigZagSlope 移植過嚟, 之字最後 2 個 confirmed point 計 prevToLast + lastToToday 雙斜率, run() 嘅 meta 注入 zigzagSlope field, 永久 rule backend 唔可以拎走咗 frontend algorithm 唔補返, 大少 trigger「做 A」揀 Option A)
// 大少 2026-08-21 12:04 — Stage 2 第一步 M7 Synthesizer ZigZagSlope enrichment: ALGO_CACHE_BUST = '4.35.0' (backend/algorithms/synthesizer/algorithm.py 加 _compute_zigzag_alignment (Level 4 cross-module alignment enrich) + algorithm_runner.py synthesizer inject block 拎 M1 verdict 嘅 full meta (meta field) 畀 M7 做 cross-module check + adapter.mjs decisionEngineComputeZigzagAlignment frontend aggregator 對齊 backend 邏輯 + renderDecisionEngineResult 拎 verdict 嘅 zigzag_alignment_penalty + reasons display 喺 Grade 卡片; 2 條 rule: M1 UP + ZigZag 短期急跌 (>2%/日) → alignment 扣 5%, M1 DOWN + ZigZag 短期急升 (>2%/日) → alignment 扣 5%; 對應 spec MODULE-07-SYNTHESIZER.md v2.1.0 Level 4 cross-module alignment enrich)
// 大少 2026-08-21 00:31 — Lookback 永遠顯示 (manual mode 都見到): ALGO_CACHE_BUST = '4.30.0' (index.html #zigzag-controls layout 改: 抽 lookback row 出嚟做獨立行 #zigzag-lookback-row 永遠顯示, 自動 mode 顯示區唔再包 lookback input (改放 lookback row 入面), 整 row 「最近 [N] 日波動率 × 2.5 (5-100) [重置為 20]」; testing-page.js 加 applyLookbackEditable() helper (auto mode lookbackEl.disabled=false, manual mode lookbackEl.disabled=true + reset btn 都 disabled), initThresholdModeUI() page load 嗰陣 call, mode 切換 handler call, reset auto 掣 call; 對應大少 trigger「當轉成手動輸入時就不見了"最近 日波動率"」)
// 大少 2026-08-21 00:24 — ZigZag threshold lookback 參數 (手動可調): ALGO_CACHE_BUST = '4.29.0' (testing-page.js 加 LS_KEY_LOOKBACK + LOOKBACK_DEFAULT=20 + LOOKBACK_MIN=5 + LOOKBACK_MAX=100 + getLookback() + setLookback() localStorage helper, applyAutoThreshold 改用 getLookback() 動態取 (唔再 hardcode 20), 撳跑算法嗰陣 auto mode 計算 (L860-877) 改用 getLookback(), 初始化 UI (initThresholdModeUI) 加 lookbackEl value 同步, 加 lookback input 即時改 handler (debounce 200ms, 改完即時重算, manual mode 唔影響), 加「重置為 20」掣 handler; index.html 自動 mode 顯示區改: 加 lookback input (5-100, step 1) + 「重置為 20」掣, 跟 Spec Sync #31 config input onChange handler pattern 一致; 對應大少 trigger「再加一個可手動調整的參數: lookback, 也會有自動儲存功能」; 永久 rule: lookback 永遠跟 localStorage, 預設 20, 範圍 5-100, manual mode 唔影響, 改完即時重算 (auto mode 觸發 applyAutoThreshold); localStorage key `stockpulse.zigzag.lookback`)
// 大少 2026-08-21 00:02 — ZigZag threshold 自動調整 (波動率自適應法): ALGO_CACHE_BUST = '4.28.0' (testing-page.js 加 autoThresholdVolatility(highs, lows, closes, lookback=20, multiplier=2.5) + extractHLC(klines) 純函數 + localStorage 存取 helper (LS_KEY_THRESHOLD_MODE + LS_KEY_MANUAL_THRESHOLD) + applyAutoThreshold(code, period) 計算 + 即時 update 紫色線 + 初始化 UI (initThresholdModeUI 新股票冇 record → 自動 mode 預設) + mode 切換 handler (切 auto 即時計算, 切 manual 用最近 auto 結果) + 重算掣 + 重置為自動掣 + manual slider 即時改 (跟 spec sync #31 pattern, debounce 200ms) + 撳「跑算法」嗰陣 auto mode 自動計算 threshold (L841 之前) + 全部 localStorage 自動保存; index.html #zigzag-controls 改: 加「自動/手動」radio + 自動 mode 顯示區 (計算結果 label + 重算掣) + 手動 mode 顯示區 (input + 重置掣) + 「? 倍數」popup 註解 (data-help 顯示倍數選擇表 2.0/2.5/3.0-4.0) + 隱藏 #zigzag-threshold (跟 spec sync #31 兼容); index.html head 加 .multiplier-tooltip inline style block; 對應大少 trigger (1) 新股票自動跑一次 (2) 新增按制手動跑 (3) 每次更新都自動保存; 永久 rule: 新股票冇 localStorage record → 自動 mode 預設, 倍數 2.5 hardcode, lookback 20 hardcode, 0.5%-20% clamp, localStorage key `stockpulse.zigzag.thresholdMode` + `stockpulse.zigzag.manualThreshold`)
// 大少 2026-08-22 23:35 — Chart 上方加股票名稱 + 號碼: ALGO_CACHE_BUST = '4.37.0' (testing-page.js 加 updateStockNameDisplay(code) function 喺 runAlgorithm 之後 call, fetch backend /api/stocks/{code} 拎 stock name, 寫入 chart-header 嘅 #stock-name-display span, format: "{code} - {name}" + fallback 顯示 code only, 凡人話: 大少撳跑完 algorithm 視線一落到 chart 即刻見到呢隻股票係邊隻, 唔使對住 "HK.00823" 估, 對齊股票名 00823 領展 / 00700 騰訊 之類; index.html chart-header h2 加 <span id="stock-name-display"> + CSS .stock-name-display style (大少 font size 18px + 灰色 + margin-left 8px), 用 backend 既有 /api/stocks/{code} endpoint 唔需要新加; 永久 rule: testing page 顯示 stock name 永遠由 backend /api/stocks/{code} 拎, 唔好 frontend hardcode map, 配合 stock metadata refresher script 補返 hot list missing 嗰啲 stock; 對應 stocks table 補返: HK.00823 領展 + US.NXP 等 2 隻, 1 個 OpenD batch snapshot call, 唔浪費額度)
// 大少 2026-08-31 07:56 GO — Sprint 4 Task 1+2: FutuOpenD banner + M9 progress log render: ALGO_CACHE_BUST = '4.50.0' (testing-page.js 加 futuHealthCache + pollFutuHealth() 5 秒 1 次 polling /api/algorithms/health/futu + updateFutuHealthBanner() 顯示頂部紅色 banner + disable「跑算法」掣 + 加 renderM9ProgressLog(verdict) 喺 M9 verdict 頂部 render 5 個 stage 嘅 progress bar timeline; runAlgorithm 開頭加最後 1 次 check futu health, 不 healthy 即刻 fail 避免 banner 與 click 之間 delay; index.html chart-section 加 <div id="futu-health-banner"> 喺 run-status 之前; ?v=2.3.110 → 2.3.111; 對應 backend Sprint 4 Task 3 background thread 30 秒 1 次自動 check)
// 大少 2026-08-30 08:02 — 紫色 ZigZag value revert wick tip + 保留 business day object time field: ALGO_CACHE_BUST = '4.41.3'
// adapter.mjs 紫色 ZigZag line setData 嗰陣:
//  - value 改返用 algorithm 拎 wick tip (high/low) — 4.41.0 body middle fix 撤回, 4.15.0 永久 rule 恢復原狀
//  - time 保留用 business day object { year, month, day } — 4.41.2 fix 保留, 對齊 candlestick 1d 對齊邏輯
// 大少 reload 撳跑 HK.00981 嗰陣, 4.41.2 business day object time fix work (P 點 x 軸對齊 8月25日 K 線) ✅
//  但 4.41.0 body middle value fix 錯, P 點 plot 喺 K 線 body middle 67.30, 大少 trigger「price 錯咗, 應該對上 Through 或 Peak」
//  即係 P 點應該 plot 喺 K 線 low (Through) 65.55 或 high (Peak) 68.2 wick tip 對應位置
// Fix: value revert 返用 algorithm 拎 wick tip, 配合 4.41.2 business day object time field fix
//  結果: P 點 plot 喺 K 線 high / low wick tip 對應位置, 對齊 K 線 x 軸
// 對齊永久 rule: 4.15.0 (之字拎 point 同 trigger 都用 high/low) + 4.12.0 (label position aboveBar / belowBar)
// 對應 Spec Sync: ARCHITECTURE.md §15.38 補丁 v2 (4.41.0 body middle fix 撤回, 4.15.0 恢復原狀)
// 對應 commit: 紫色 ZigZag value revert wick tip + 保留 business day object time field
// 對應 commit history:
//  - 29f7faac 4.41.0 body middle value fix (撤回, body middle 唔對應 K 線 high / low)
//  - eb6a6163 4.41.1 debug log (temporary)
//  - 6627f99b 4.41.2 business day object time field fix (保留, 對齊 candlestick 1d 對齊邏輯)
//  - 當前 commit 4.41.3 value revert wick tip + 保留 business day object time field fix
// 對齊永久 rule: 改 testing-page.js + adapter.mjs 之後必同步 bump 2 個地方 cache bust
// 大少 2026-08-30 07:48 — 紫色 ZigZag line setData time field business day object fix: ALGO_CACHE_BUST = '4.41.2'
// adapter.mjs 紫色 ZigZag line setData 嗰陣, time field 改用 business day object { year, month, day },
//  唔再用 timestamp (number), 對齊 candlestick 對 1d 嘅 business day 對齊邏輯
// 大少 reload 撳跑 HK.00981 嗰陣, 4.41.0 body middle fix work (value 由 65.55 改 67.30),
//  但 x 軸位置仲喺 8月25日 K 線同 8月26日 K 線中間
// Root cause: Lightweight Charts 4.2.3 對 line series 嘅 1d timestamp 對齊 reference point 同 candlestick
//  series 唔一致, 用 business day object 拎 time field 對齊 candlestick 1d 對齊邏輯, 確保 P 點 plot 喺 K 線左邊
// 同時 fix extension line time field 統一用 business day object (避免 setData type 衝突 silent reject)
// 4.41.0 保留 (value 改用 K 線 body middle, 4.41.2 加 time 改用 business day object, 兩者一齊 fix)
// 對應 Spec Sync: ARCHITECTURE.md §15.38 補丁 (4.41.0 嘅 body middle fix 加 business day object time fix)
// 對應 commit: 紫色 ZigZag line setData time field business day object fix
// 對齊永久 rule: 改 testing-page.js + adapter.mjs 之後必同步 bump 2 個地方 cache bust
// 大少 2026-08-30 07:48 — 紫色 ZigZag render verify debug log: ALGO_CACHE_BUST = '4.41.1'
// adapter.mjs 紫色 ZigZag line setData 嗰陣, 加 console.log dump 最後 3 個 P 點嘅 time + value
// 對比 K 線對應 date 嘅 K 線 data (time + open + high + low + close)
// 大少 trigger 07:48「P2 仲喺兩支竹中間, 比原來高咗, 去查下, 做好咗要自動檢動」
// 大少撳跑 HK.00981 嗰陣睇 console.log 拎 actual plot data, 確認 P 點 x 軸 y 軸位置
// 對齊永久 rule: 改 testing-page.js + adapter.mjs 之後必同步 bump 2 個地方 cache bust
// 對應 commit: 紫色 ZigZag render auto verify debug log (1 個 commit)
// 大少 2026-08-30 07:20 — 方案 B 紫色 ZigZag render body middle: ALGO_CACHE_BUST = '4.41.0'
// adapter.mjs renderMAAlignmentV2ChartOverlay 紫色 line setData value 改用 K 線 body middle
// ((open + close) / 2), 唔再直接用 verdict.meta.zigzagPoints 拎 wick tip (high/low) value
// 大少 trigger「P2 喺兩支竹中間」: 8月25日 K 線 wick tip 65.55 同 body 66.75 差 1.2,
// 紫色 P 點 plot 喺 65.55 突出 K 線外面, label 「2」號 plot 喺 wick bottom 下面,
// 視覺上似「喺 8月25日同 8月26日 K 線中間」嘅空白位置
// Fix: render layer 加 K 線 date → index map, 每個 P 點 render 拎 (open + close) / 2
// 算法 trigger 邏輯唔改 (4.15.0 永久 rule 保留, 因為 trigger 需要拎 wick extreme 拎 trough/peak)
// verdict.meta.zigzagPoints 唔改 (繼續拎 wick tip), 畀 debug panel + algorithm 內部用
// 紫色 sequence marker label position 唔改 (4.12.0 永久 rule 保留), 跟紫色 line 嘅 value plot,
//  即係 plot 喺 K 線 body middle 附近, 唔突出
// 鮮綠色 extension line 唔改 (已經用 lastClose)
// 永久 rule (4.41.0 新加): 紫色 ZigZag line render value 永遠用 K 線 body middle,
//  唔好直接用 algorithm meta.zigzagPoints 拎 wick tip value
//  K 線 missing 嗰陣 fallback 落 algorithm 拎 wick tip (唔好 crash)
// 對齊永久 rule: 改 testing-page.js + adapter.mjs 之後必同步 bump 2 個地方 cache bust
// 對應 Spec Sync: ARCHITECTURE.md §15 紫色 ZigZag render section (待補)
// 對應 commit: 紫色 ZigZag render body middle fix (1 個 commit)
// 大少 2026-08-30 01:21 — B 方案 v2 治標 frontend defensive: ALGO_CACHE_BUST = '4.40.0'
// 之字 points dedupe by time (testing-page.js applyFrontendZigZagOverlay + adapter.mjs
// renderMAAlignmentV2ChartOverlay) + try/catch 包住 s.setData 拎走 silent reject 破壞 chart state
// 對齊永久 rule: 改 testing-page.js + adapter.mjs 之後必同步 bump 2 個地方 cache bust
// (testing-page.js ALGO_CACHE_BUST + index.html ?v=2.3.X, 永久 rule cache bust self-check)
// 大少 2026-08-30 19:57 — Bug fix ReferenceError chartRefs not defined (line 1441): ALGO_CACHE_BUST = '4.42.1'
// testing-page.js calculateZigZagFrontend 每個 push point 加 3 個新 field (decisionDate / decisionValue / decisionType)
// + line 1441 ReferenceError fix (chartRefs → lastChartRefs, 因為 chartRefs 喺 runAlgorithm 內 local const)
// + adapter.mjs renderMAAlignmentV2ChartOverlay 新加 flag marker (setMarkers API, shape 'flag', aboveBar, 跟 ZigZag 啟用 toggle 同步, 跟 sequence marker merge 落 candleSeries, 對齊 4.40.0 dedupe by time 永久 rule)
// + backend/algorithms/zigzag/algorithm.py 1-to-1 port frontend algorithm (跟大少 23:30 trigger「除消所有對zigzag 相關的限制」, 同時移植 zigzag_testing 完整 algorithm + 內部加 3 個 decision field)
// + production frontend (ChartContainer.tsx + ElliottWaveTestPage.tsx) fetchBackendZigZag return shape 加 decisionTime/decisionValue + createSeriesMarkers 旗仔 marker
// 對齊永久 rule: testing-page.js + adapter.mjs 之後必同步 bump 2 個地方 cache bust (ALGO_CACHE_BUST + index.html ?v=2.3.X)
// 大少 2026-08-30 22:04 — Testing page ZigZag 全部 backend 計 (拎走 frontend 算法): ALGO_CACHE_BUST = '4.43.0'
//
// 大少 8月31日 01:02 trigger — 還原備份還原點 (commit 3a5c2fa4) + 拎走 setMarkers 整個 block: ALGO_CACHE_BUST = '4.48.2'
// 4.48.2 永久 rule (新加): testing page 唔 render 紫色 ZigZag sequence marker 號碼 (setMarkers 整個 block 拎走),
//   Lightweight Charts v4.2.3 out-of-range marker 嗰個 silent render bug (4.49.0 + 4.50.0 + 4.50.1 + 4.48.1 fix 全部治唔到) 治唔到,
//   紫色 ZigZag line + 鮮綠色 close extension 仍然 render, P 點 sequence 號碼大少可以透過 DevTools console 跑
//   `window.currentVerdict.meta.zigzagPoints` 拎到 raw data (1-520 號倒序排, 4.45.0 永久 rule 拎走所以 1 號 = 紫線最後 1 個, Option B keep 4.42.2 永久 rule)。
// 4.42.2 永久 rule 改寫: 橙色旗仔 marker 拎走 (setMarkers 拎 set 唔到),保留 4.42.2 嘅 backend port 同 verdict fix
// 4.45.0 永久 rule 拎走: P1 唔見 fix + 拎走 4.9.0 永久 rule 拎返嚟 (1 號 = 鮮綠線終點 = out-of-range today close, Option B)
// 對應 git reset: `git reset --hard 3a5c2fa4` (拎走 4.45.0 + 4.48.1 un-committed, keep 4.42.2 + 4.42.3 + 4.43.0)
// 對應 commit (將會 commit): fix(testing-page): 還原備份還原點 (3a5c2fa4) + 拎走 setMarkers (大少 8月31日 01:02 trigger「問題很大,還是修不好,還記得之前設了一個還原點嗎?」+ 8月31日 01:48「能完全回到那個還原點嗎?」trigger 拎返 ZigZag 返嚟)
// testing-page.js 拎走 5 個 frontend ZigZag function (calculateZigZagFrontend + _buildExtensionLineFrontend
//   + autoThresholdVolatility + extractHLC + applyFrontendZigZagOverlay 4.42.3 fix 嘅 98 行 + 1 個
//   dead helper _zigzagNormalizeDate) — 改 fetch backend `/api/algorithms/run?algo=zigzag`
// + 加 2 個新 function (fetchBackendZigZag + fetchAndInjectBackendZigZag) 對齊 production frontend
//   ChartContainer.tsx fetchBackendZigZag pattern, 加 AbortController 處理 slider race condition
// + 改 5 個 call site (runAlgorithm / applyAutoThreshold / 切手動 mode / manual slider /
//   zigzag-threshold slider) 改 fetch backend
// backend/api/algorithms.py 加 4 個新 query params (threshold_mode / manual_threshold / lookback / multiplier)
//   + 4 個 validation rules (大少 4.43.0 safety improvement #1: 防止 frontend pass 錯 value trigger silent bug)
// backend/algorithms/zigzag/algorithm.py ZigZagAlgorithm.run 重構成 call run_zigzag helper
//   (大少 4.43.0 safety improvement #3: 1 個 function 1 個 source of truth, 避免重複 logic)
// + Verdict meta 改 8 個 field 對齊 testing page 拎法 (klines_count / threshold / threshold_mode
//   / lookback / multiplier / extension_line / zigzag_points_count / decision_flag_count)
// + 對齊 production frontend ChartContainer.tsx + ElliottWaveTestPage.tsx 已經用緊嘅 pattern
// 永久 rule 4.43.0 (新加): ZigZag 全部 backend 計, frontend 拎 fetch verdict, 唔再重計
// 對應 Spec Sync #47 entry (永久 rule update 拎走 2 條 + 加 1 條)
// 對齊永久 rule: testing-page.js + adapter.mjs 之後必同步 bump 2 個地方 cache bust
//   (ALGO_CACHE_BUST + index.html ?v=2.3.X, 永久 rule cache bust self-check)
//
// 大少 8月31日 01:59 trigger — bump testing page CDN lightweight-charts v4.2.3 → v5.2.0 + 改用 v5 createSeriesMarkers plugin API 拎返 setMarkers: ALGO_CACHE_BUST = '4.49.0'
// 4.49.0 永久 rule (新加, 拎返 4.10.0 嗰個 spirit + 改用 v5 plugin API):
//   ✅ 紫色 ZigZag sequence marker 拎返 (4.10.0 永久 rule 拎返, 改用 v5 createSeriesMarkers plugin API)
//   ✅ 4.42.2 橙色旗仔 marker 拎返 (4.42.2 永久 rule 改寫: v5 plugin API 拎 set 唔到嘅 bug 解咗)
//   ✅ 4.48.2 永久 rule 拎走 setMarkers 改寫為 4.49.0 永久 rule拎返 setMarkers (v5 plugin API)
//   ✅ testing page 同 production frontend (ChartContainer.tsx) 對齊 v5 plugin API pattern
//   ✅ Lightweight Charts v4.2.3 out-of-range marker 嗰個 silent render bug 治本 fix (bump v4.2.3 → v5.2.0, v5 重新 design, 唔會有呢個 bug)
// 對齊 git reset: `git reset --hard 3a5c2fa4` (Option B,拎走 4.45.0 + 4.48.1 un-committed, keep 4.42.2 + 4.42.3 + 4.43.0)
// 對應 commit (將會 commit): fix(testing-page): bump lightweight-charts v4.2.3 → v5.2.0 + 拎返 setMarkers 改用 v5 createSeriesMarkers plugin API (大少 8月31日 01:59 trigger「找回 vs 重新做」揀 Approach B + 4.49.0 永久 rule)
//
// 大少 8月31日 09:00 trigger — 4.51.0 永久 rule 改寫 P 點 indexing: ALGO_CACHE_BUST = '4.51.0'
//   改寫 4.9.0 永久 rule: 刪除「1 號 = 鮮綠色 close extension 終點」描述
//   統一跟大少 8月29日 14:32 永久 rule: P1 = 最新紫色 ZigZag 點 (zzp[-1], 倒序後第一個)
//   testing page 紫色 marker label 由 `idx + 2` 改 `idx + 1`, 鮮綠色 1 號 marker 拎走
//   鮮綠色 close extension 線保留 (對齊 4.8.3 永久 rule「趨勢延續」視覺化), 但冇 sequence label
//   凡人話: 撳 showZigzagSequence toggle, 由右到左 P1, P2, P3, ... 全部紫色 circle, 對齊大少 trigger
//   大少 trigger 原因: 4.9.0 嗰個「1 號 = 鮮綠線終點」規則同大少 8月29日 P1=zzp[-1] 規則衝突, 紫色由 2 號開始錯
//   對應 commit (將會 commit): fix(testing-page): ZigZag P 點 indexing 統一 (P1 = 紫色 zzp[-1], 拎走鮮綠色 1 號 marker, 4.51.0 永久 rule)
//
// 大少 8月31日 09:24 trigger — 切 manual mode 用 localStorage manual value 優先: ALGO_CACHE_BUST = '4.52.0'
//   4.52.0 永久 rule (新加, 改寫 4.28.0 切 manual mode 嗰陣用 recent auto 結果嘅邏輯):
//     ✅ 切 manual mode 嗰陣永遠用 localStorage manual value 優先 (大少手動輸入過嘅 value)
//     ✅ 如果 localStorage 仲係默認 5 (即係從未手動輸入過), fallback 落 recent auto 結果
//     ✅ 永遠唔 overwrite manual input field, 用大少真實手動輸入過嘅 value
//     ✅ 同步 manual input field value 對齊 v (currentOptions.zigzagThreshold)
//   之前邏輯 (4.28.0): recent auto 結果優先 + overwrite manual input field
//     → 大少輸入 8% 切 manual 嗰陣紫色線用咗 recent auto 3% 錯 (大少 8月31日 09:24 bug report)
//   對齊 Spec Sync #31 永久 rule: Config UX 模式「自動+手動+自動儲存更新圖表」
//   對應 commit (將會 commit): fix(testing-page): 切 manual mode 用 localStorage 優先, 唔 overwrite 大少輸入 value (4.52.0 永久 rule)
//
// 大少 8月31日 11:09 trigger — 拎走橙旗決定點 + 鮮綠色 close extension 線 + P 點 sequence marker: ALGO_CACHE_BUST = '4.53.0'
//   4.53.0 永久 rule (新加, 拎返 4.42.2 橙旗 + 4.8.3/4.51.0 鮮綠線 + 4.51.0 P 點 + 4.49.0 setMarkers):
//     ✅ 拎走橙色 #FF9800 細小旗仔 marker (4.42.2 永久 rule 拎走) — 大少 trigger「拎走不要,可能影響正常 ZigZag」
//     ✅ 拎走鮮綠色 #00C853 close extension 線 (4.8.3 + 4.51.0 永久 rule 拎走) — 大少 trigger「影響正常 Zigzag」
//     ✅ 拎走紫色 P 點 sequence marker toggle (4.51.0 永久 rule 拎走) — chart 完全乾淨
//     ✅ 紫色 ZigZag 線只 render line, 冇 number marker, 冇 close extension 線, 冇旗仔
//     ✅ 拎走 testing page `#zigzag-sequence-controls` toggle + spinbutton (HTML)
//     ✅ 拎走 backend `decisionDate` / `decisionValue` / `decisionType` 3 個 field (algorithm.py)
//     ✅ 拎走 production frontend `decisionTime` / `decisionValue` 2 個 field (ChartContainer + ElliottWaveTestPage)
//   對齊 8月29日 22:44 永久 rule「所有改動要 confirm」: 大少明確 trigger「拎走不要」先做
//   對齊 8月31日 11:01 永久 rule「Backend hot-reload」: 改 algorithm.py 之後必 restart backend
//   對應 commit: chore: 拎走 ZigZag 橙旗 (4.53.0 永久 rule)
//
// 大少 8月31日 12:50 trigger — M1 console log 加 ZigZag 最新 10 點 (日子 + 點數): ALGO_CACHE_BUST = '4.54.0'
//   4.54.0 永久 rule (新加, 改 renderDebugPanel):
//     ✅ testing-page.js renderDebugPanel 加 _formatZigZagLatestPointsForDebug helper (喺「K線最後 close」行之下)
//     ✅ Mini-table 4 欄 layout: 序號 (P1-P10) / 日子 (YYYY-MM-DD) / 點數 (2 位小數) / 類型 (📈 Peak / 📉 Trough)
//     ✅ 倒序排 (P1 = 最新, zzp[-1]) 對齊 8月29日 14:32 永久 rule P1/P2/P3/P4 indexing
//     ✅ Source 拎 lastVerdict.meta.zigzagPoints (已經由 backend inject, 對齊 4.43.0 永久 rule「ZigZag 全部 backend 計」)
//     ✅ Edge case: zigzagPoints empty / undefined → 顯示「(冇 points, 可能未跑算法 / threshold 太高)」, 唔 crash
//     ✅ Edge case: zigzagPoints.length < 10 → table 顯示實際有嘅數量 (1-9 行)
//     ✅ Style 全部 inline (唔加 testing-page.css, 跟 popup 註解永久 rule 風格一致)
//     ✅ 凡人話: 大少撳跑 M1 即刻喺黑色 console log 底部見到 P1-P10 日子 + 點數, 唔使再 scroll 開 DevTools console 拎 raw data
//   對應 commit: feat(testing-page): M1 console log 加 ZigZag 最新 10 點
//
// 大少 8月31日 13:14 trigger — fix P1-P10 排法 (verdict.points 排法 (舊 → 新) → (新 → 舊) 搞錯): ALGO_CACHE_BUST = '4.55.0'
//   4.55.0 永久 rule (新加, fix 4.54.0 錯理解):
//     ✅ _formatZigZagLatestPointsForDebug 改 1 行: `slice(-10).reverse()` → `slice(0, 10)`
//     ✅ 原因: backend verdict.points 排法係 (新 → 舊), points[0] = 最新 (curl evidence HK.00019: points[0]=2026-08-21, points[-1]=2025-08-04)
//     ✅ 凡人話: 大少撳跑 M1 即時見到 P1 = K線最近嗰個交易日 (唔再拎最舊嗰個, 之前 4.54.0 完全反咗)
//     ✅ 凡人話 message 改: 「P1 = K線最近嗰個交易日嘅紫色 ZigZag 點 (因為 backend verdict.points 排法係 (新 → 舊))」
//     ✅ 對齊 4.43.0 永久 rule「ZigZag 全部 backend 計」 (frontend 拎 backend 注入嘅 data, 唔重計)
//     ⚠️ Backend `assign_sequence_numbers` 函數注釋錯 + logic 同 array 排法對唔上, 但 production 4.53.0 拎走 P 點 sequence marker, 暫時冇 visible impact
//        → 唔喺今次 fix 範圍, 之後 follow-up sprint 先處理
//   對應 commit: fix(testing-page): M1 console log P1-P10 排法 (verdict.points 排法搞錯, 4.55.0)
//
// 大少 8月31日 17:42 trigger (修改版 20:51 + 20:57) — M1 console log 加 Threshold % + 獨發點 (Trigger 確認點): ALGO_CACHE_BUST = '4.57.0'
// 大少 9月1日 13:39 trigger (4.58.0 cache bust sync) — 4.58.0 backend code (P1/P2 同日 bug fix + 4.57.2 date format 統一重新做返) 已經 push origin main, frontend 仲係 4.57.0, 大少 reload testing page 拎 stale verdict, 必 cache bust 同步: ALGO_CACHE_BUST = '4.58.0' (對齊 §15.46 永久 rule)
// 大少 9月1日 14:10 trigger (full revert 4.56.0 'today' point + 鮮綠線 + 4.57.x skip_today): ALGO_CACHE_BUST = '4.59.0'
//   4.59.0 永久 rule (新加, 大少 14:10 trigger full revert 4.56.0):
//     ✅ backend/algorithms/zigzag/algorithm.py 拎走 4.56.0 嘅 'today' point injection (P1 唔再拎 K線最後 close)
//     ✅ backend/algorithms/zigzag/algorithm.py 拎走 4.33.0 鮮綠線 build_extension_line function + EXTENSION_LINE_COLOR constant
//     ✅ backend/algorithms/zigzag/algorithm.py 拎走 4.57.x skip_today 邏輯 (紫色 P point 計返 T-0 對齊 frontend algorithm 1-to-1)
//     ✅ backend/algorithms/zigzag/algorithm.py ongoing point 嘅 triggerPrice 改返用 last_swing_idx K線 high/low (唔再用 K線最後 close)
//     ✅ backend/algorithms/zigzag/algorithm.py point_marker_position 拎走 'today' check
//     ✅ backend/algorithms/zigzag/algorithm.py ZigZagAlgorithm meta field 拎走 extension_line (由 7 個 field 變 6 個)
//     ✅ backend/algorithms/zigzag/algorithm.py version 0.1.0 → 0.3.0 (記錄拎走嘅嘢)
//     ✅ backend/algorithms/zigzag/__init__.py 拎走 build_extension_line + EXTENSION_LINE_COLOR import/export
//     ✅ testing-page.js _formatZigZagLatestPointsForDebug 拎走 todayPoint filter (P1 = 紫色 algorithm 拎到嘅最後 confirmed point, 唔再用 'today' point)
//     ✅ 凡人話: 大少撳跑 01347 見到 P1 = 2026-08-25 105.50 📉 Trough (8月31日 123.00 trigger 到 5% 升幅確認 trough), 唔再用 8月31日 123.00 today point
//     ✅ 對齊 8月29日 14:32 永久 rule「P1 = 最新紫色 ZigZag 點」, 拎走 4.56.0 嘅「P1 = 今日 close」special case
//   對應 commit: fix(zigzag): 拎走 4.56.0 'today' point + 鮮綠線 + skip_today, P1 = standard ZigZag algorithm output
// 大少 9月1日 16:48 trigger (ongoing point trigger bug fix): ALGO_CACHE_BUST = '4.60.0'
//   4.60.0 永久 rule (新加, 大少 16:48 trigger fix 01347 P1 ongoing point 講大話 bug):
//     ✅ backend/algorithms/zigzag/algorithm.py ongoing point 嘅 trigger 改 null (triggerIndex/triggerDate/triggerPrice 全部 None)
//     ✅ backend/algorithms/zigzag/algorithm.py ongoing point 加 is_ongoing: true flag 畀 frontend 分到
//     ✅ testing-page.js _formatZigZagLatestPointsForDebug 拎 is_ongoing flag 顯示「(待觸發)」取代「(?)」, 大少一眼分到「呢個未 confirm」
//     ✅ 凡人話: 之前 ongoing point 硬填 trigger=self (講大話話「已經 confirm」), 但真實情況係 threshold % 嘅 K 線未出現
//       e.g. 01347 P1 trough 105.5 需要 high ≥ 125.89 先 trigger, 而家 K 線得 125.6 差 0.3 蚊, 真係未 trigger
//     ✅ 對齊 4.15.0 永久 rule「之字拎 point 同 trigger 都用 high/low」, null 表示「trigger 仍未出現, 唔好假設 confirm」
//     ✅ 對齊 8月29日 14:32 永久 rule「P1 = 最新紫色 ZigZag 點」, P1 仲係會 render, 只係 trigger column 顯示「(待觸發)」
//   對應 commit: fix(zigzag): ongoing point trigger 改 null + is_ongoing flag, frontend 顯示「(待觸發)」
// 大少 9月1日 22:02 trigger「只保留 zigzag 連線」: ALGO_CACHE_BUST = '4.61.5'
//   4.61.5 永久 rule (新加, 大少 9月1日 22:02 trigger「Frontend 只保留 zigzag 連線」):
//     ✅ C1: 拎走 testing-page.js dead code
//       - 拎返拎走 LS_KEY_SHOW_SEQUENCE const + getShowSequence/setShowSequence helpers (冇人 call, 4.61.5 拎走)
//       - 拎返拎走 #show-sequence toggle handler (~22 行 dead code)
//       - 拎返拎走 4.61.3 final spec comment block (~15 行 stale 永久 rule reference, 拎返拎走)
//     ✅ C2: 拎走 testing-page/index.html #zigzag-sequence-controls div block (~11 行 dead UI)
//     ✅ C3: 拎走 adapter.mjs P 點 arrow + 紅色獨發點 circle marker 整個 block (~66 行 marker build + setMarkers)
//     ✅ C4: 拎返拎走 stale 鮮綠色 / 4.10.0 v4 / 4.33.0 鮮綠色 comment
//     ✅ C5: Backend triggerDate / triggerPrice / is_ongoing field 全部保留 (大少 trigger「之後想重新再做過」)
//     ✅ C6: Spec doc (AGENTS.md + ARCHITECTURE.md) 拎返拎走 4.62.0/4.42.0/4.33.0 永久 rule + 加新永久 rule「Frontend ZigZag 只 render 紫色折線」
//     ✅ 凡人話: 大少 trigger「之前做的 Point, 旗仔, 獨發點等等, 只保留 zigzag 的連線, 其他都不要」, 拎走晒 frontend 5 個 non-line visual elements (紫色 P 點 arrow / 紅色獨發點 circle / 鮮綠色 close extension line / 鮮綠色 1 號 marker / 橙色 #FF9800 旗仔), chart 只 render 紫色 ZigZag 折線
//     ✅ 對齊 8月29日 22:44 永久 rule「所有改動要 confirm」:大少明確 trigger「拎走 P 點 / 旗仔 / 獨發點 / 鮮綠線」先做
//   對應 commit: refactor(frontend): 拎走 ZigZag non-line visual elements (P 點 / 旗仔 / 獨發點 / 鮮綠線), chart 只 render 紫色折線
// 大少 2026-09-01 22:51 — 拎走 PPP 測試 marker (大少睇完確認 setMarkers work, 之後準備做 zigzag Point): ALGO_CACHE_BUST = '4.61.8'
//   ✅ testing page renderChart function 拎走 PPP marker block (53 行) + 拎走 PPP comment (8 行)
//   ✅ 跟 cache bust self-check 永久 rule (21:24) sync bump ?v=2.3.129
//   ✅ 永久 rule (新加): 改 testing page 任何 marker 都跟 Lightweight Charts v5 createSeriesMarkers plugin API, 失敗 fallback 落 v4 candleSeries.setMarkers
// 大少 2026-09-01 22:58 — 拎返 M1 紫色 ZigZag P 點 sequence marker (大少 trigger「現在把在Backend已計好的P1，P2, P3,.....的點放到圖表裡，要寫上P1，P2， P3...」): ALGO_CACHE_BUST = '4.62.0'
//   ✅ algorithms/AS-03-cycle-detection/adapter.mjs renderMAAlignmentV2ChartOverlay 拎返 P 點 marker block (約 65 行), 用 v5 createSeriesMarkers plugin API + v4 candleSeries.setMarkers fallback
//   ✅ Label 用 backend verdict.points[].sequence field 直接做 "P1", "P2", "P3"... (1=最新, N=最舊, 對齊 8月29日 14:32 永久 rule)
//   ✅ Position: high→aboveBar, low→belowBar (4.51.0 永久 rule peak/trough 對齊)
//   ✅ Shape circle, color 紫色 #9C27B0 (4.51.0 永久 rule)
//   ✅ 唔拎返 4.53.0/4.61.5 拎走嘅其他嘢: 橙旗 (4.42.2) / 鮮綠 close extension 線 (4.8.3) / 紅色獨發點 (4.61.5) / P 點 toggle 同 spinbutton (4.53.0)
//   ✅ 跟 cache bust self-check 永久 rule (21:24) sync bump ?v=2.3.130
// 大少 2026-09-01 23:11 trigger (Fix 3 debug) — 加 5 個 console.log 查「撅其他股票 P 點 marker 唔出」issue: ALGO_CACHE_BUST = '4.62.1'
//   ✅ testing-page.js fetchAndInjectBackendZigZag 加入口 + 早 return 原因 + fetch start + fetch success + AbortError debug log (5 個)
//   ✅ adapter.mjs renderMAAlignmentV2ChartOverlay P 點 marker block 加入口 debug log (1 個)
//   ✅ Debug evidence 撅 00019 frontend verdict 正常, 撅 01888/0981/00700 frontend verdict 拎空 (ok=None, meta keys=[]), 因為 line 147 early return
//   ✅ 跟 cache bust self-check 永久 rule (21:24) sync bump ?v=2.3.131
// 大少 2026-09-01 23:27 trigger (Fix 4) — 拎返 4.49.0 拎返嗰陣 2 個 protection (max count 30 + re-set after setVisibleLogicalRange): ALGO_CACHE_BUST = '4.62.2'
//   ✅ adapter.mjs P 點 marker block 拎返 max count 30 限制 (對齊 4.49.0 拎返嗰陣 default), 49 個 marker silent reject fix
//   ✅ testing-page.js renderChart setTimeout 50ms 拎返 re-set markers block (v5 plugin API 拎 set 返 ensure persist)
//   ✅ 大少 evidence: 撅 00019 (12 markers) → 出, 撅 01888 (49 markers) → 唔出, 撅 0981 (90 markers) → 唔出
//   ✅ 跟 cache bust self-check 永久 rule (21:24) sync bump ?v=2.3.132
// 大少 2026-09-02 00:52 trigger (Fix 4.66.0) — 拎返 P 點 + 鮮紫獨發點 marker toggle (4.53.0 拎走嘅 #show-sequence 拎返, 預設關): ALGO_CACHE_BUST = '4.66.0'
//   ✅ 對齊 4.53.0 拎走嘅 #show-sequence + LS_KEY_SHOW_SEQUENCE 嗰個 spirit 拎返, 4.61.5 commit 拎走嗰個 toggle 拎返
//   ✅ 對齊 4.51.0 拎走嘅 LS_KEY_SHOW_SEQUENCE naming pattern, 4.66.0 用 LS_KEY_SHOW_MARKERS ('stockpulse.zigzag.showMarkers')
//   ✅ 對齊 8月19日 13:03 Config UX 模式永久 rule「自動+手動+自動儲存更新圖表」: 即時 localStorage + 即時 re-render (唔需要撅跑 algorithm)
//   ✅ 大少 00:52 explicit「預設是關的」— default false, 撳開先見 P1-P10 + 鮮紫 trigger, 撳關拎走 marker
//   ✅ 對齊 4.65.0 永久 rule: P 點 + 鮮紫 trigger 一齊 toggle (大少 trigger「控制這個P點和獨發點的」)
//   ✅ 對齊 8月19日 永久 rule chart-control layout: #zigzag-markers-controls div 喺 chart-section 內 ma-toggle-bar 之前
//   ✅ 撅 HK.01888 撳 toggle 開 → P1-P10 + 鮮紫 trigger 出. 撳 toggle 關 → 只見紫色折線 + 4 條 MA + volume 視覺 clean
//   ✅ Reload page 預設關 (跟大少 00:52 trigger「預設是關的」), 想每次都見到自己 toggle 開, localStorage 自動記住大少 choice
//   ✅ 跟 cache bust self-check 永久 rule (21:24) sync bump ?v=2.3.137
const ALGO_CACHE_BUST = '4.66.3';
//   ✅ 4.64.0 紅色 #FF5252 撞 K 線跌 body 紅色 #ef5350, 大少 00:48 trigger「用鮮紫色」改 #BA68C8 (Material Design Purple 300)
//   ✅ 4.64.0 position 'inBar' 喺 K 線 body 內紅撞紅視覺唔 clear, 大少 00:48 trigger「不要在那支竹內, 要在離開那支竹少少」改 aboveBar/belowBar
//   ✅ 對齊 P 點 marker 4.51.0 永久 rule position pattern (P 點 high→aboveBar, low→belowBar), 鮮紫 trigger 喺對面 side, 視覺 unified
//   ✅ 對齊 P 點紫色 #9C27B0 (Purple 500) hue family 但淺 1 級 (#BA68C8 Purple 300), 視覺 contrast 對 K 線 body 升綠/跌紅都清楚
//   ✅ 其他 field 唔改: arrowUp/arrowDown shape (Option D), size 1, text '' (冇 label), max 10, filter ongoing + first point
//   ✅ 撅 HK.00019 (12 markers) → P1-P10 紫色圓圈 (aboveBar/belowBar) + 鮮紫 arrow 10 個 (aboveBar peak / belowBar trough) 出
//   ✅ 撅 HK.01888 (49 markers) → P1-P10 + 鮮紫 arrow 10 個出. 撅 HK.00700 (189 markers) → P1-P10 + 鮮紫 arrow 10 個出
//   ✅ 跟 cache bust self-check 永久 rule (21:24) sync bump ?v=2.3.136
// (4.65.0 const 拎走, 4.66.0 const 喺上面 line 564)

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
  // ---- M9 Back Test (09) — Sprint 3 sub-task 9.5 done (大少 22:28 Go) ----
  // 大少 2026-08-08 22:28 — 6 個月歷史 K 線 replay M8 verdict, 對比 5/10/20 日後真實升跌
  // Coarse grid (3×3=9) + fine tune top 5 ±20% + adaptive window 6→18 個月 + walk-forward CV 3 段
  // 自動 POST optimal + forward return records 落 per-symbol cache (9.4)
  // 大少 2026-08-11 19:55: dropdown 排位 M9 放 M8 上邊, ID/displayName 編號唔改 (只 visual 排位)
  //   流程次序: M7(綜合) → M9(回測) → zmen(獨立) → M8(決策) → M11(timeline)
  //   理由: M8 要用 M9 嘅 optimal params, M9 排 M8 上邊反映呢個 chain 邏輯
  //   受影響: 純 visual, 唔影響 spec doc / ID / adapterExport
  {
    id: 'AS-03-BT',
    displayName: '09 — AS-03-BT',  // 大少 2026-08-08 10:06: 編號 09 = M9 Back Test
    folder: 'AS-03-cycle-detection',
    adapterPath: '../algorithms/AS-03-cycle-detection/adapter.mjs',
    adapterExport: 'backTestAdapter',
    // 9.5: testing page entry 09 — 揀 stock → 撳跑 → out optimal params + walk-forward CV folds
    // 9.6 (next): HK.00700 pilot only + spec doc final
  },
  // ---- 獨立算法 (M1 抽出, 唔屬於 AS-03 7 個 modules 之一) — 2026-08-11 21:32 搬去 REGISTRY 頂 ----
  // (zmen 均算法 block 已經喺 line 75-92, 排第 1 位, 詳見上方 inline 註解)
  // ---- M8 Decision Engine (08) — Sprint 2 sub-task 2.1 done (8 個 finalAction 決策樹) ----
  // 大少 2026-08-11 19:55: dropdown 排位改 M8 放 M9 下邊, ID/displayName 編號唔改
  //   流程次序: M7(綜合) → M9(回測) → zmen(獨立) → M8(決策) → M11(timeline)
  //   理由: M8 要用 M9 嘅 optimal params, M9 排 M8 上邊反映呢個 chain 邏輯
  {
    id: 'AS-03-DEC',
    displayName: '08 — AS-03-DEC',  // 大少 2026-08-08 10:06: 編號 08 = M8 Decision Engine (大少 13:30 拆返獨立)
    folder: 'AS-03-cycle-detection',
    adapterPath: '../algorithms/AS-03-cycle-detection/adapter.mjs',
    adapterExport: 'decisionEngineAdapter',  // 大少 2026-08-08 15:42: M8 v1.0.0 — 8 個 finalAction 決策樹 + 揸車比喻 final_action_reason + trading card (static) done
    // ✅ 2.1: 8 個 finalAction 決策樹 (BUY/ADD/HOLD/REDUCE/SELL/WAIT/TRAP/TRANSITION) + trading card (static formula)
    // 🚧 2.2-2.5: trading card adaptive + 短期走勢預測 + 人話解讀 (LLM hook) + 5 個 adaptive params runtime auto-calibrate
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
  // ---- 獨立算法 (舊 M1 v0.3.0 抽出, 唔屬於 AS-03 7 個 modules 之一) ----
  // 大少 2026-08-19 10:00 — zmen 均算法搬去最尾 (排喺 M11 BTL 之後)
  // 之前排位 (2026-08-11 21:32 永久 rule): zmen 排最頂 (排名 1)
  // 大少 trigger 2026-08-19 10:00:「在算法 Dropdown List 裡把 zmen 的算法排在最後」
  // 理由: 改返之前「排最頂」嘅決定, zmen 排最尾, AS-03 7 個 modules + M11 排前面
  // ID/displayName 唔改 (純 visual 排位, adapterExport 都唔改)
  // ---- 獨立算法 (舊 M1 v0.3.0 抽出, 唔屬於 AS-03 7 個 modules 之一) ----
  // 大少 2026-08-08 08:47:「zmen 均算法」係大少自己想出嚟嘅算法, 從 7 個 modules 抽離
  // 大少 2026-08-08 09:50: 改名「zmen均算法」→「zmen均算法」(算法 vs 算去 typo 修正)
  // 大少 2026-08-08 09:13: implementation file 改叫 zmen-ma-alignment.ts
  // 大少 2026-08-15 zmen v1.0: 保留 Layer 1 (10 條 rule) + 加 Layer 2 (9 個 sub-scenario)
  {
    id: 'AS-03',
    displayName: 'zmen均算法 v1.0',  // 大少 2026-08-08 09:50: 舊 M1 改名 + 抽離 7 個 modules; 2026-08-15 v1.0: 保留 Layer 1 + 加 Layer 2
    folder: 'AS-03-cycle-detection',
    adapterPath: '../algorithms/AS-03-cycle-detection/adapter.mjs',
    adapterExport: 'zmenMAAdapter',  // 大少 2026-08-15 zmen v1.0: 改用命名 export, 拎到 renderResult 凡人話 layout
  },
  // 將來加新 algorithm:
  // { id: 'AS-04', folder: '...', adapterPath: '...' },
];

// ===== State =====

let currentAdapter = null;
let currentOptions = {};
// 大少 2026-08-19 trigger — ZigZag toggle state
let zigzagEnabled = true;
// 大少 9月2日 00:52 trigger (4.66.0) — 拎返 P 點 + 鮮紫獨發點 marker toggle state (4.53.0 拎走嘅 spirit 拎返, 預設關)
// 對齊 4.51.0 拎走嘅 showZigzagSequence 嗰個 pattern, 4.61.5 拎走, 4.66.0 拎返用 1 個新 toggle 控制 P 點 + 鮮紫 trigger 一齊顯示/隱藏
// 大少 00:52 explicit「預設是關的」— 預設 false 保持 chart 視覺 clean (只有紫色折線 + 4 條 MA + volume, 冇 P 點 + 鮮紫 trigger), 撳開即時 re-render 拎返 P1-P10 + 鮮紫 arrow
let zigzagMarkersEnabled = false;
// 大少 8月31日 11:09 trigger (4.53.0 永久 rule) — 拎走 ZigZag 點順序號碼 toggle state
// 拎走 showZigzagSequence + zigzagSequenceMaxCount (P 點 sequence marker 拎走後唔再需要)
let lastVerdict = null;
let lastKlines = null;
let lastChartRefs = null;

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

// =============================================================================
// 大少 2026-08-31 07:56 GO — Sprint 4 Task 2: FutuOpenD health polling + banner
// =============================================================================
// 永久 rule: testing page 入面 background polling 富途 OpenD health, 5 秒 1 次 (比 backend 30 秒 schedule 密少少)
// 不 healthy 嗰陣顯示頂部紅色 banner + disable「跑算法」掣

let futuHealthCache = { is_healthy: true, last_check_at: null, last_error: null, consecutive_failures: 0 };

async function pollFutuHealth() {
  try {
    const resp = await fetch(`${BACKEND_URL}/api/algorithms/health/futu`);
    if (!resp.ok) return;
    futuHealthCache = await resp.json();
    updateFutuHealthBanner();
  } catch (e) {
    console.warn('[testing-page] futu health polling 失敗:', e);
  }
}

function updateFutuHealthBanner() {
  const banner = document.getElementById('futu-health-banner');
  if (!banner) return;
  const runBtn = document.getElementById('btn-run-algorithm');
  const chainBtn = document.getElementById('btn-run-chain');
  if (futuHealthCache.is_healthy) {
    banner.style.display = 'none';
    if (runBtn) runBtn.disabled = false;
    if (chainBtn) chainBtn.disabled = false;
  } else {
    banner.style.display = 'block';
    const errMsg = futuHealthCache.last_error || 'unknown';
    banner.innerHTML = `🚨 富途連線中斷 (連續 ${futuHealthCache.consecutive_failures || 0} 次失敗) · 唔好落單 · 撳跑 algorithm 掣已自動 disable · 重啟富途牛牛 / 檢查 port 11111 · ${errMsg}`;
    if (runBtn) runBtn.disabled = true;
    if (chainBtn) chainBtn.disabled = true;
  }
}

// 永久 rule: testing page 加載即時 polling 一次 (避免 5 秒 delay), 之後 5 秒 1 次
pollFutuHealth();
setInterval(pollFutuHealth, 5000);

// 大少 2026-08-31 07:56 GO — Sprint 4 Task 1: M9 progress log render
// 永久 rule: M9 verdict 包含 verdict.meta.progress_log, testing page render 落 result panel 上面
// (sync 跑完之後 render timeline, 唔做中途 polling 因為 caller pattern 改 risk 高)
function renderM9ProgressLog(verdict) {
  if (!verdict || !verdict.meta || !Array.isArray(verdict.meta.progress_log)) return '';
  const log = verdict.meta.progress_log;
  if (log.length === 0) return '';
  const rows = log.map((entry) => {
    const stage = entry.stage || '?';
    const percent = entry.percent || 0;
    const extra = Object.entries(entry)
      .filter(([k]) => !['stage', 'percent', 'timestamp'].includes(k))
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    const extraStr = extra ? ` <small style="color:#888;">(${extra})</small>` : '';
    return `<tr>
      <td style="padding:4px 8px;font-size:12px;">${stage}</td>
      <td style="padding:4px 8px;font-size:12px;">
        <div style="background:#e0e0e0;border-radius:3px;height:14px;width:100%;">
          <div style="background:#4caf50;border-radius:3px;height:14px;width:${percent}%;"></div>
        </div>
      </td>
      <td style="padding:4px 8px;font-size:12px;">${percent}%${extraStr}</td>
    </tr>`;
  }).join('');
  return `<div style="margin:8px 0;padding:10px;background:#f5f5f5;border-radius:6px;">
    <h4 style="margin:0 0 6px 0;font-size:13px;">⏱️ M9 進度 (${log.length} 個 stage)</h4>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#e8e8e8;">
        <th style="padding:4px 8px;font-size:12px;text-align:left;">Stage</th>
        <th style="padding:4px 8px;font-size:12px;text-align:left;">進度</th>
        <th style="padding:4px 8px;font-size:12px;text-align:left;">%</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

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
  // 大少 2026-08-29 07:51 trigger — 股票代碼輸入框 onfocus 自動 select all
  // 凡人話: 大少第二次輸入股票代碼時, 點輸入框自動選中所有舊內容, 打字即可覆蓋
  const codeInputEl = document.getElementById('input-code');
  if (codeInputEl) {
    codeInputEl.addEventListener('focus', () => {
      // 用 setTimeout 確保 focus 完成後先 select (避免某些 browser race condition)
      setTimeout(() => codeInputEl.select(), 0);
    });
  }
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

  // 大少 2026-08-11 22:50 — 改善: 「🚀 跑完整鏈條 (M7→M9→M8)」掣只喺 M8 (AS-03-DEC) 度顯示
  // 凡人話: chain flow 嘅設計係 M7→M9→M8 嘅 sequence, 只有揀 M8 嗰陣呢個掣先有意義
  // 揀其他 module (M1-M7, M9, M10, M11, zmen) 嗰陣呢個掣應該隱藏, 避免混淆
  // 永久 rule: 改 module 嗰陣, 自動 show/hide 「跑完整鏈條」掣
  const fullChainBtn = document.getElementById('run-full-chain-btn');
  if (fullChainBtn) {
    // M8 = 'AS-03-DEC', 係 chain flow 嘅最終 step, 只有揀 M8 嗰陣 chain 有意義
    const isM8 = algorithmSelect.value === 'AS-03-DEC';
    fullChainBtn.style.display = isM8 ? '' : 'none';
  }

  // 大少 2026-08-11 22:50 — 改善 2: 「跑算法」掣喺 M8 嗰陣隱藏
  // 凡人話: 改善 2 之後 (chain conditional), 揀 M8 嗰陣「跑完整鏈條」已經夠用 (cache OK 嗰陣 2-4 秒搞掂, 唔再 30-60 秒浪費)
  // 拎走「跑 M8 跑算法」掣 → 大少揀 M8 嗰陣只有「跑完整鏈條」1 個掣, UX 更簡潔
  // 揀其他 module (M1-M7, M9, M10, M11, zmen) 嗰陣, 「跑算法」掣仍然顯示, 因為其他 module 冇 chain 對應
  // 永久 rule: M8 = 揀 chain 掣, 其他 module = 揀單一跑掣
  const runBtn = document.getElementById('run-btn');
  if (runBtn) {
    const isM8 = algorithmSelect.value === 'AS-03-DEC';
    runBtn.style.display = isM8 ? 'none' : '';
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
  // 大少 2026-08-29 08:31 trigger — HotKey: Tab 鍵 highlight 下一個 option
  let currentHighlightIndex = -1;

  // 應用 highlight 樣式 (CSS class, 跟原有 .ac-option.highlighted 一致)
  const applyHighlight = (options) => {
    options.forEach((opt, idx) => {
      if (idx === currentHighlightIndex) {
        opt.classList.add('highlighted');
        opt.scrollIntoView({ block: 'nearest' });
      } else {
        opt.classList.remove('highlighted');
      }
    });
  };

  // 選 option 嘅 helper (提取做函數方便 hotkey + mouse 共用)
  const selectOption = (opt) => {
    const code = opt.dataset.code;
    inputEl.value = code;
    currentOptions[input.key] = code;
    dropdown.style.display = 'none';
    currentHighlightIndex = -1;
  };

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
          selectOption(opt);
        });
      });
      // 大少 2026-08-29 08:31 trigger — 每次新搜尋重置 highlight index
      currentHighlightIndex = -1;
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

  // 大少 2026-08-29 08:31 trigger — HotKey 功能
  // Tab 鍵 highlight 下一個 option (第 1 撳 = 第 1 個, 第 2 撳 = 第 2 個, ...)
  // Enter / Space 鍵直接跑算法
  // 特殊: 輸入 "bmwmmf" 撳 Space → 自動選 dropdown 第 1 個 + 跑算法
  inputEl.addEventListener('keydown', (e) => {
    const value = inputEl.value.trim();
    const dropdownVisible = dropdown.style.display !== 'none';
    const options = dropdown.querySelectorAll('.ac-option');

    if (e.key === 'Tab') {
      // Tab 鍵: highlight 下一個 option
      if (dropdownVisible && options.length > 0) {
        e.preventDefault();  // 避免 default Tab 行為 (跳去下一個 input)
        currentHighlightIndex = (currentHighlightIndex + 1) % options.length;
        applyHighlight(options);
      }
      // dropdown 冇顯示 / 冇 options 嘅情況, 畀 default Tab 行為
    } else if (e.key === 'Enter') {
      // Enter 鍵: 跑算法
      e.preventDefault();  // 避免 form submit
      if (dropdownVisible && currentHighlightIndex >= 0 && options[currentHighlightIndex]) {
        // 有 highlight: 選 highlighted option + 跑算法
        selectOption(options[currentHighlightIndex]);
      }
      runAlgorithm();
    } else if (e.key === ' ') {
      // Space 鍵
      e.preventDefault();  // 避免加空白
      if (value.toLowerCase() === 'bmwmmf' && dropdownVisible && options.length > 0) {
        // 特殊 trigger: bmwmmf + Space → 選第 1 個 + 跑算法
        selectOption(options[0]);
      }
      runAlgorithm();
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

  // 大少 2026-08-31 07:56 GO — Sprint 4 Task 2: 撳跑 algorithm 之前最後 1 次 check futu health
  // (避免 5 秒 polling delay 撞 banner 之間, 即時 poll + check cache)
  await pollFutuHealth();
  if (!futuHealthCache.is_healthy) {
    runStatus.innerHTML = '🚨 富途連線中斷, 撳跑 algorithm 掣已 disable · 重啟富途牛牛 / 檢查 port 11111';
    updateFutuHealthBanner();
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

  // 大少 2026-08-22 07:25 fix #3: 自動補 HK. prefix (手機 user 唔需要記 prefix)
  // 例: 輸入 "00981" → 自動變 "HK.00981" (港股 5 位數字, backend K 線 endpoint 必須有 market prefix 先識拎)
  // 已經有 prefix (HK. / US. / SH. / SZ.) 唔重覆補
  // 永久 rule: 純 5-6 位數字 = 預設港股, 因為 StockPulse testing page 主要用 HK 股票
  const _rawCode = currentOptions.code.trim();
  if (/^\d{5,6}$/.test(_rawCode)) {
    const normalized = `HK.${_rawCode}`;
    console.log(`[testing-page] Auto-prefix 股票代碼: ${_rawCode} → ${normalized}`);
    currentOptions.code = normalized;
    if (codeInputEl) codeInputEl.value = normalized;
  }

  runStatus.innerHTML = '⏳ 撈緊 K 線數據...';
  resultPanel.innerHTML = '';

  try {
    // 1. Fetch K 線 from backend
    // 大少 2026-08-14 23:15 — 永久 rule: dataWindowDays 默認值 100 → 1260 (5 年, 對 long-history 股票最 safe, 唔再 trigger CONFIG_DEFAULTS warning)
    const code = currentOptions.code;
    const period = currentOptions.period || '1d';
    const count = currentOptions.dataWindowDays || 1260;
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

    // 2. 大少 2026-08-11 21:20 — C 改善: 撳 M8 之前 check adaptive_params cache 過期
    // 凡人話: 撳 M8 嘅時候, 自動睇下 adaptive_params cache 係咪過期, 過期就提示大少先跑 M9
    // 唔 auto trigger M9 (打擾大少), 只係 hint, 大少自己決定
    // 對應 AGENTS.md 「Cache 過期永久 rule: 7 日 expiry (大少 11:39 confirm)」
    if (currentAdapter.id === 'AS-03-DEC') {
      try {
        runStatus.innerHTML = '⏳ 檢查 M8 adaptive_params cache 時效...';
        const cacheResp = await fetch(`${BACKEND_URL}/api/adaptive-params/${encodeURIComponent(code)}`);
        if (cacheResp.ok) {
          const cacheData = await cacheResp.json();
          const valid = cacheData.valid;
          const ageDays = Math.floor((cacheData.age_seconds || 0) / 86400);
          const hasOptimal = cacheData.has_optimal;
          if (!valid) {
            // 過期: 提示大少先撳完整鏈條掣
            runStatus.innerHTML = `⚠️ M8 adaptive_params cache 已過期 ${ageDays} 日 · 強烈建議撳「🚀 跑完整鏈條」掣重校 (M7→M9→M8)`;
          } else {
            // 仲有效
            const remainingDays = Math.max(0, 7 - ageDays);
            const optimalHint = hasOptimal
              ? ` · M9 optimal 亦有 cache`
              : ` · M9 optimal 未跑 (建議撳「🚀 跑完整鏈條」掣)`;
            runStatus.innerHTML = `✅ M8 adaptive_params cache 仲有效 (${ageDays} 日, 仲有 ${remainingDays} 日)${optimalHint} · 繼續跑 M8...`;
          }
        } else if (cacheResp.status === 404) {
          // 冇 cache
          runStatus.innerHTML = `ℹ️ 冇 M8 adaptive_params cache (第一次跑) · 建議撳「🚀 跑完整鏈條」掣自動 calibrate · 繼續跑 M8 (會 fresh-calibrate)...`;
        } else {
          runStatus.innerHTML = `✅ 已攞到 ${actualCount} 日 K 線 · M8 cache check 返 ${cacheResp.status}, 繼續跑...`;
        }
      } catch (e) {
        // Cache endpoint 拎唔到 (backend 唔 work) 唔 block, 直接跑
        console.warn('[C 改善] M8 cache check 失敗, fallback 跑 M8:', e);
        runStatus.innerHTML = `✅ 已攞到 ${actualCount} 日 K 線 · M8 cache check 失敗, 繼續跑...`;
      }
    }

    // 3. Run algorithm
    // 4.43.0: 拎走 frontend auto threshold 計算嗰段 (extractHLC + autoThresholdVolatility)
    //   因為 backend `/api/algorithms/run?algo=zigzag` 已經 auto 計 threshold (auto mode 拎 LS value 傳 backend)
    //   frontend 唔需要再算, fetchAndInjectBackendZigZag 拎 backend verdict 之後 inject 落 lastVerdict.meta
    //   永久 rule 4.43.0: ZigZag 全部 backend 計, frontend 拎 fetch verdict, 唔再重計
    const startTime = performance.now();
    const verdict = await currentAdapter.analyze(klines, currentOptions);
    const endTime = performance.now();

    // 大少 2026-08-30 20:57 fix — Scope bug: applyFrontendZigZagOverlay 內部拎 lastVerdict 拎 ZigZag points
    // inject 落 verdict, 但舊 code 喺 line 1262 (renderChart 之後) 先 set lastVerdict, 令到 applyFrontendZigZagOverlay
    // 入面 (line 1489) lastVerdict 仲 null, return null, 唔 inject 任何嘢, verdict.meta.zigzagPoints 永遠 undefined
    // Fix: 提早 set lastVerdict + lastKlines 喺 verdict 拎出嚟之後, 令到 applyFrontendZigZagOverlay 可以用
    lastVerdict = verdict;
    lastKlines = klines;

    // 3.0.1 大少 2026-08-29 19:54 — 還原 testing page frontend ZigZag
    // 凡人話: 撳跑完 frontend M1 algorithm 之後, 拎 frontend calculateZigZagFrontend(klines, threshold) 拎 points
    // 將 frontend 拎嘅 points 注入 verdict.meta.zigzagPoints + lastSwingHigh + lastSwingLow + zigzagThreshold + extensionLine
    // 紫色 ZigZag 線 + 鮮綠線 render (L812 嘅 currentAdapter.renderChartOverlay) 用 frontend 拎 data
    // 大少 trigger: 「還完 testing page 的前台 zigzag, 那是在前台計算的」
    if (currentAdapter.id === 'AS-03-MA') {
      // 4.43.0: 拎走 applyFrontendZigZagOverlay, 改 fetch backend (4 個 LS value 傳 backend)
      // 對齊 4.42.3 永久 rule: verdict meta inject 永遠唔需要 lastChartRefs (純 JS 嘢)
      // 拎 backend verdict 早 call, 之後 line 1281 renderChartOverlay 因為 verdict.meta.zigzagPoints
      // 已經 inject, 自動 render 紫線 + P 點 arrow marker + 紅色獨發點 circle (4.62.0 永久 rule)
      const thresholdMode = getThresholdMode();
      const manualThreshold = getManualThreshold();
      const lookback = getLookback();
      const multiplier = 2.5;  // 永久
      await fetchAndInjectBackendZigZag(thresholdMode, manualThreshold, lookback, multiplier);
    }

    // 大少 #11070 — 顯示 user 設定 vs actual (debug 用)
    const finalCountHint = (requestedCount !== actualCount || dataLimited)
      ? ` <span style="color: #ff7a00;">(設定 ${requestedCount} / 實際 ${actualCount}${dataLimited ? ' — 數據限制' : ''})</span>`
      : '';
    runStatus.innerHTML = `✅ 跑完 · ${actualCount} 日${finalCountHint} · 用咗 ${(endTime - startTime).toFixed(0)} 毫秒`;

    // 3. Render result
    // 大少 2026-08-11 — Module Warning System v1.0.0 (Phase 3+4)
    // 喺 verdict card render 之前, 頂部注入 WarningBanner (如果有 warnings)
    // 個別 verdict card 內 WarningCard 由 adapter.mjs 自己 handle
    if (currentAdapter.renderResult) {
      let resultHTML = currentAdapter.renderResult(verdict);
      // 頂部 WarningBanner (拎 verdict._warnings, dynamic import)
      const warnings = verdict._warnings || [];
      if (warnings.length > 0) {
        // Dynamic import warnings helper (跟 adapter 同一個 file lib)
        // 大少 2026-08-14 11:33 v1.1.0: 改用 renderWarningBanners() render 2 個獨立 banner (🔧 系統 + 📊 股票狀態)
        const { renderWarningBanners, renderWarningCards, formatWarningForCopy, formatAllWarningsForCopy } = await import('../algorithms/AS-03-cycle-detection/lib/warnings.mjs?v=' + ALGO_CACHE_BUST);
        // 暫存 _currentWarnings 畀 Copy button handler 用
        window._currentWarnings = warnings;
        const bannerHTML = renderWarningBanners(warnings);
        // WarningCard 喺 verdict card 頂部 (e.g. <h3> 之前)
        // 簡單做法: prepend WarningBanner, WarningCard 由 adapter 自己 inject
        resultHTML = bannerHTML + resultHTML;
      }
      // 大少 2026-08-31 07:56 GO — Sprint 4 Task 1: M9 verdict 顯示 progress log (timeline view)
      // 永久 rule: M9 verdict 包含 verdict.meta.progress_log (5 個 stage), 撳跑完即時 render 揾跑咗咩
      if (currentAdapter.id === 'AS-03-BT' && verdict.meta && Array.isArray(verdict.meta.progress_log)) {
        resultHTML = renderM9ProgressLog(verdict) + resultHTML;
      }
      resultPanel.innerHTML = resultHTML;
    } else {
      // 大少 2026-08-31 07:56 GO — Sprint 4 Task 1: M9 verdict 顯示 progress log (fallback case)
      if (currentAdapter.id === 'AS-03-BT' && verdict.meta && Array.isArray(verdict.meta.progress_log)) {
        resultPanel.innerHTML = renderM9ProgressLog(verdict) + `<pre>${JSON.stringify(verdict, null, 2)}</pre>`;
      } else {
        resultPanel.innerHTML = `<pre>${JSON.stringify(verdict, null, 2)}</pre>`;
      }
    }

    // 3.5 大少 15:45: 跑完 algo 自動 start real-time price polling (5 秒 polling 最新股價 + 日期時間)
    // Trading card 最左加新 column「最新股價」(date/time 上 + price 下)
    startRealTimePrice(code);

    // 3.6 大少 2026-08-22 23:35 — chart 上方顯示股票名稱 + 號碼
    // 凡人話: 撳跑完 algorithm 之後, fetch /api/stocks/{code} 拎 stock name, 寫入 chart-header
    // 既唔需要 restart backend, 又唔會 block render (fetch 失敗 fallback 顯示 code only)
    updateStockNameDisplay(code);

    // 4. 大少 #10431 — 撳完 test 後 render K 線圖表（full width）
    const chartRefs = renderChart(klines, code, period);

    // 5. 2026-08-07 — Adapter 自己嘅 chart overlay (peaks/troughs markers + 箱體線 + pattern alert)
    // Generic contract: 每個 algorithm 自己決定點 render 自己嘅 verdict 喺 chart 上面
    // 大少 2026-08-19 — save state 畀 ZigZag toggle 用
    // 大少 2026-08-30 20:57 fix — lastVerdict + lastKlines 已經喺 line 1204-1205 提早 set 咗 (為咗 applyFrontendZigZagOverlay 拎到), 呢度唔重複 set
    lastChartRefs = chartRefs;
    // 大少 8月31日 11:09 trigger (4.53.0 永久 rule) — 拎走 ZigZag sequence state pass 畀 renderChartOverlay
    // 大少 2026-08-19 08:45 — 拎 verdict/chartRefs 放 window, 大少可以喺 console 拎
    window.currentVerdict = verdict;
    window.currentKlines = klines;
    window.currentChartRefs = chartRefs;
    window.currentAdapter = currentAdapter;
    if (currentAdapter.renderChartOverlay) {
      try {
        currentAdapter.renderChartOverlay(verdict, klines, chartRefs);
      } catch (err) {
        console.warn('[renderChartOverlay] failed:', err);
      }
    }

    // 大少 2026-08-19 08:50 — 喺 chart 下面 auto-render debug 區域, 拎 chartRefs + verdict meta 嘅 state
    // (大少唔識去 console 拎 window.currentChartRefs, 直接 dump 落 page 等大少睇得到)
    // 永久 rule: 改 chart overlay 之後, debug 區域自動顯示 series 數量同 verdict meta keys
    renderDebugPanel(chartRefs, verdict, klines);
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

// 大少 2026-08-22 23:35 — Chart 上方顯示股票名稱 + 號碼
// 凡人話: 撳跑完 algorithm 之後, fetch backend /api/stocks/{code} 拎 stock name, 寫入 chart-header
// fetch 失敗 fallback 顯示 code only (唔 crash); 用 backend 既有 endpoint, 唔需要新加
async function updateStockNameDisplay(code) {
  const el = document.getElementById('stock-name-display');
  if (!el) return;
  if (!code) {
    el.textContent = '';
    return;
  }
  // 即時顯示 code (避免空白)
  el.textContent = `· ${code}`;
  el.style.color = '#888';
  try {
    const resp = await fetch(`${BACKEND_URL}/api/stocks/${encodeURIComponent(code)}`);
    if (!resp.ok) return;  // fallback 留 code
    const data = await resp.json();
    const name = data?.name;
    if (name && name !== code) {
      el.textContent = `· ${code} ${name}`;
    }
  } catch (e) {
    // fetch 失敗 fallback 留 code
  }
}

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
  // 大少 8月31日 01:59 trigger — bump lightweight-charts v4.2.3 → v5.2.0, addCandlestickSeries 改為 addSeries(CandlestickSeries, ...) (v5 API 改咗)
  const candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
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
  // 大少 8月31日 01:59 trigger — bump v4 → v5, addHistogramSeries 改為 addSeries(HistogramSeries, ...)
  const volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
  });
  chart.priceScale('volume').applyOptions({
    scaleMargins: { top: 0.8, bottom: 0 },
  });
  volumeSeries.setData(volumeData);

  chart.timeScale().fitContent();

  // 凡人話: 大少 2026-08-19 10:10 trigger — chart 預設 zoom 落去最近半年 (~126 個交易日 ≈ 6 個月)
  // 但 data 仍然係 1260 日 (5 年) 全部 喺度, 大少可以人手 pan/zoom 返去看全部 5 年, data 唔受影響
  // setTimeout 確保 chart 完成 initial fitContent() 之後先 set range, 避免 race condition
  // (直接 setVisibleLogicalRange 有時喺 fitContent 仲未完成嗰陣會被覆蓋)
  // DEFAULT_VISIBLE_BARS = 126 ≈ 252 / 2 半年 (252 個交易日 = 1 年)
  const totalBars = candleData.length;
  const DEFAULT_VISIBLE_BARS = 126;  // 半年
  setTimeout(() => {
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, totalBars - DEFAULT_VISIBLE_BARS),
      to: totalBars,
    });
    // 大少 2026-08-19 16:43 fix — v4.2.3 setVisibleLogicalRange 嗰陣會清 marker state
    // (凡人話: chart fit 落半年範圍嗰陣, 啱啱落嘅 sequence 號碼 marker 會跟住丟失)
    // 50ms 後再 set 返一次, 確保 persist
    // 大少 2026-08-30 19:57 fix — ReferenceError chartRefs is not defined (line 1441) bug fix
    // 之前用 chartRefs (line 1256 runAlgorithm 嘅 local const), renderChart 內部 access 唔到
    // Fix: 改用 lastChartRefs (global, line 591-592 定義, line 1263 assign 過, 跟 chartRefs 同 shape)
    // 大少 8月31日 01:59 trigger — 拎返 re-set markers after setVisibleLogicalRange 嗰個 if block (4.49.0 永久 rule, v5 plugin API 拎返 setMarkers)
    //   4.48.2 拎走嘅 setMarkers 拎返, 但 v5 改用 plugin handle 嗰個 setMarkers (v5 改咗 design, setMarkers 喺 plugin handle 入面, 唔喺 candleSeries)
    //   對齊 4.10.0 + 4.49.0 永久 rule
    //   50ms 後再 set 返一次, 確保 persist
    // 大少 2026-08-30 19:57 fix — ReferenceError chartRefs is not defined (line 1441) bug fix
    // 之前用 chartRefs (line 1256 runAlgorithm 嘅 local const), renderChart 內部 access 唔到
    // Fix: 改用 lastChartRefs (global, line 591-592 定義, line 1263 assign 過, 跟 chartRefs 同 shape)
    // 大少 8月31日 11:09 trigger (4.53.0 永久 rule) — 拎走 re-set markers after setVisibleLogicalRange 嗰個 if block (P 點 sequence marker 拎走後唔再需要)
    // 大少 9月1日 23:27 trigger (4.62.2 fix) — 拎返 re-set markers block (P 點 sequence marker 拎返 4.62.0, setVisibleLogicalRange 嗰陣 v5 plugin marker 可能丟失, 50ms 後再 set 返一次確保 persist)
    // 大少 9月1日 23:46 trigger (4.63.0 fix) — re-set block 拎 `handle.setMarkers` 優先 (v5 plugin handle 自帶 setMarkers method), fallback chain 拎 mock setMarkers
    //   ✅ 4.63.0 chartRefs.zigzagSequenceMarkers 改 `{ handle, markers, setMarkers }` 結構:
    //      - `handle` = v5 plugin handle (LightweightCharts.createSeriesMarkers return value, 自帶 setMarkers / markers method)
    //      - `setMarkers` = wrapper function (delegates to handle.setMarkers, 4.62.2 re-set block 兼容)
    //   ✅ 優先用 `handle.setMarkers` (v5 plugin native), fallback 落 `setMarkers` (4.62.2 mock wrapper)
    //   ✅ 4.62.3 拎返嘅 `setMarkers` wrapper 內部 call v4 candleSeries.setMarkers 係 dead code (v5 完全拎走), 拎返 v5 handle 確保 re-set 真正 work
    if (lastChartRefs && lastChartRefs.zigzagSequenceMarkers) {
      try {
        const _rsetMarkers = lastChartRefs.zigzagSequenceMarkers.handle?.setMarkers
          || lastChartRefs.zigzagSequenceMarkers.setMarkers;
        if (typeof _rsetMarkers === 'function') {
          _rsetMarkers(lastChartRefs.zigzagSequenceMarkers.markers || []);
          console.log('[Chart] 🛠️ re-set P 點 markers after setVisibleLogicalRange (v5 plugin handle, 確保 persist, 4.62.2 fix + 4.63.0 handle refactor)');
        }
      } catch (e) { /* ignore */ }
    }
  }, 50);

  chartInstance = chart;
  console.log(`[Chart] rendered ${candleData.length} bars for ${code} (${period})`);

  // 2026-08-07 — Module 2 (高低點結構法) chart overlay
  // 返 chart + candleSeries 畀 adapter.renderChartOverlay 用
  return { chart, candleSeries, priceLines: {} };
}

// ===== Event listeners =====

algorithmSelect.addEventListener('change', onAlgorithmChange);
runBtn.addEventListener('click', runAlgorithm);

// 大少 2026-08-19 trigger — ZigZag toggle handler
// 撳啟用/停用即時 re-render chart overlay
const zigzagEnabledEl = document.getElementById('zigzag-enabled');
if (zigzagEnabledEl) {
  zigzagEnabledEl.addEventListener('change', (e) => {
    zigzagEnabled = e.target.checked;
    if (lastVerdict && lastKlines && lastChartRefs && currentAdapter && currentAdapter.renderChartOverlay) {
      // M1 v2.0 用 maV2LineSeries, zmen 用 maLineSeries — 兩邊都清
      ['maV2LineSeries', 'maLineSeries'].forEach(key => {
        if (lastChartRefs[key] && lastChartRefs[key].zigzag) {
          try { lastChartRefs.chart.removeSeries(lastChartRefs[key].zigzag); } catch (e) { /* ignore */ }
          lastChartRefs[key].zigzag = null;
        }
      });
      // 通知 overlay 拎新嘅 enabled state
      lastChartRefs.zigzagEnabled = zigzagEnabled;
      currentAdapter.renderChartOverlay(lastVerdict, lastKlines, lastChartRefs);
    }
  });
}

// 大少 9月2日 00:52 trigger (4.66.0) — 拎返 P 點 + 鮮紫獨發點 marker toggle (4.53.0 拎走嘅 spirit 拎返, 預設關)
// 對齊 8月19日 13:03 Config UX 模式永久 rule「自動+手動+自動儲存更新圖表」: 即時 localStorage + 即時 re-render (唔需要撅跑 algorithm)
// 對齊 4.51.0 拎走嘅 #show-sequence + LS_KEY_SHOW_SEQUENCE + handler pattern, 4.61.5 commit 拎走嗰個 toggle block 拎返
// 對齊 4.65.0 永久 rule: P 點 + 鮮紫 trigger 一齊 toggle (大少 00:52 trigger「控制這個P點和獨發點的」)
// 凡人話: 撳開即時 re-render chart overlay, 拎返 P1-P10 紫色圓圈 + 鮮紫 trigger arrow 10 個. 撳關即時拎走, 只剩紫色折線 + 4 條 MA + volume 視覺 clean.
const zigzagMarkersEnabledEl = document.getElementById('zigzag-markers-enabled');
if (zigzagMarkersEnabledEl) {
  // Init: 從 localStorage 拎返 default (大少 00:52 explicit「預設是關的」, 冇 record return false), sync checkbox state
  zigzagMarkersEnabled = getShowMarkers();
  zigzagMarkersEnabledEl.checked = zigzagMarkersEnabled;

  zigzagMarkersEnabledEl.addEventListener('change', (e) => {
    zigzagMarkersEnabled = e.target.checked;
    setShowMarkers(zigzagMarkersEnabled);
    // 4.66.3 hotfix debug: log toggle 撳完之後 state
    console.log(`[M1 v2.0 4.66.3 debug] 🔘 toggle 撳完: e.target.checked=${e.target.checked}, zigzagMarkersEnabled=${zigzagMarkersEnabled}, lastChartRefs?.zigzagMarkersEnabled 撳完 set 之前=${lastChartRefs?.zigzagMarkersEnabled}`);
    if (lastVerdict && lastKlines && lastChartRefs && currentAdapter && currentAdapter.renderChartOverlay) {
      // 通知 overlay 拎新嘅 enabled state, renderChartOverlay 嗰陣 check chartRefs.zigzagMarkersEnabled flag 決定 render 唔 render
      // 撳開: re-render 拎返 P 點 + 鮮紫 trigger (因為 chart 上面已經有紫色折線 + 4 條 MA + volume, re-render 唔影響佢哋)
      // 撳關: 拎走 P 點 + 鮮紫 trigger, 紫色折線 + 4 條 MA + volume 仍然 render (因為佢哋唔受呢個 toggle 影響)
      lastChartRefs.zigzagMarkersEnabled = zigzagMarkersEnabled;
      console.log(`[M1 v2.0 4.66.3 debug] 🔘 toggle set 完 lastChartRefs.zigzagMarkersEnabled=${lastChartRefs.zigzagMarkersEnabled}, 之後 call renderChartOverlay`);
      currentAdapter.renderChartOverlay(lastVerdict, lastKlines, lastChartRefs);
    }
  });
}

// 大少 2026-08-30 22:04 — 4.43.0 拎走 applyFrontendZigZagOverlay 整個 function (4.42.3 fix 嘅 98 行)
// 改用 fetchAndInjectBackendZigZag (line 282 嘅新 function) 拎 backend verdict, caller 同步 call
// `currentAdapter.renderChartOverlay(lastVerdict, lastKlines, lastChartRefs)` 拎 verdict render
// 永久 rule 4.43.0: ZigZag 全部 backend 計, frontend 拎 fetch verdict, 唔再重計
// 對齊 4.42.3 永久 rule: verdict meta inject 永遠唔需要 lastChartRefs (純 JS 嘢)

// 大少 2026-08-21 00:02 trigger — 自動 mode 計算 + 即時 update 紫色線
// 永久 rule: auto mode 永遠跟 K 線自動計算, 撳跑算法 / 切 mode / 撳重算 都會觸發
// 對應永久 rule 2026-08-19 13:03「Config UX 模式: 自動+手動+自動儲存更新圖表」
async function applyAutoThreshold(code, period) {
  if (!lastKlines || !Array.isArray(lastKlines) || lastKlines.length === 0) {
    runStatus.innerHTML = `⚠️ 未有 K 線數據, 請先撳「跑算法」`;
    return null;
  }
  // 4.43.0: 拎走 frontend 計 threshold 嗰段 (extractHLC + autoThresholdVolatility), 因為 backend 已經做晒
  // 對齊永久 rule 4.43.0: ZigZag 全部 backend 計, frontend 拎 fetch verdict, 唔再重計
  //   backend `/api/algorithms/run?algo=zigzag` 拎 auto mode + lookback 之後, 自己用 backend `auto_threshold_volatility` 計
  //   frontend 唔需要 pre-calculate threshold, fetch backend 之後 verdict.meta.threshold 拎返個 value
  const lookback = getLookback();
  runStatus.innerHTML = `⏳ 自動計算 ZigZag threshold (${lookback} 日波動率 × 2.5, backend 算)...`;
  // 4.43.0: 拎走 applyFrontendZigZagOverlay, 改 fetch backend (auto mode)
  const verdict = await fetchAndInjectBackendZigZag('auto', null, lookback, 2.5);
  if (verdict && lastChartRefs) {
    currentAdapter.renderChartOverlay(lastVerdict, lastKlines, lastChartRefs);
    renderDebugPanel(lastChartRefs, lastVerdict, lastKlines);
  }
  // 4.43.0: 拎 backend verdict.meta.threshold 拎返 auto threshold value 顯示喺 UI
  // 之前 frontend 自己用 autoThresholdVolatility 拎, 而家 backend 拎返畀我哋
  const thresholdPct = verdict?.meta?.threshold;
  if (thresholdPct != null && Number.isFinite(thresholdPct)) {
    const displayEl = document.getElementById('zigzag-auto-threshold-value');
    if (displayEl) displayEl.textContent = `${thresholdPct.toFixed(2)}%`;
    // sync 入 currentOptions + 隱藏 threshold slider
    currentOptions.zigzagThreshold = +thresholdPct.toFixed(2);
    const sliderEl = document.getElementById('zigzag-threshold');
    if (sliderEl) sliderEl.value = String(thresholdPct.toFixed(2));
  }
  const pointsCount = lastVerdict?.meta?.zigzagPointsCount || 0;
  if (pointsCount > 0) {
    runStatus.innerHTML = `✅ 自動計算 ZigZag threshold = ${(thresholdPct || 0).toFixed(2)}% (${pointsCount} 個 points, backend 計)`;
  } else {
    runStatus.innerHTML = `⚠️ 自動計算失敗, 紫色線無更新 (backend 拎唔到 verdict)`;
  }
  return thresholdPct;
}

// 大少 2026-08-21 00:02 trigger — 初始化 threshold mode (新股票冇 record → 自動 mode 預設)
// 永久 rule (大少 00:02): 所有沒有記錄即新股票都會自動跑一次
// 「新股票」= 冇 localStorage record → 自動 mode 預設
// 初始化 UI: 同步 radio / 顯示區 / manual input / lookback
function initThresholdModeUI() {
  const mode = getThresholdMode();
  document.querySelectorAll('input[name="zigzag-mode"]').forEach(r => {
    r.checked = (r.value === mode);
  });
  const autoDisplay = document.getElementById('zigzag-auto-display');
  const manualDisplay = document.getElementById('zigzag-manual-display');
  if (autoDisplay) autoDisplay.style.display = (mode === 'auto') ? '' : 'none';
  if (manualDisplay) manualDisplay.style.display = (mode === 'manual') ? '' : 'none';
  const manualEl = document.getElementById('zigzag-manual-threshold');
  if (manualEl) manualEl.value = String(getManualThreshold());
  // 大少 2026-08-21 00:24 — 初始化 lookback input value (跟 localStorage / default 20)
  const lookbackEl = document.getElementById('zigzag-lookback');
  if (lookbackEl) lookbackEl.value = String(getLookback());
  // 初始化 currentOptions.zigzagThreshold (跟 spec sync #31 default 一致)
  currentOptions.zigzagThreshold = mode === 'manual' ? getManualThreshold() : 5;
}
initThresholdModeUI();

// 大少 2026-08-21 00:38 trigger — Lookback 永遠可改 (拎走 manual mode 嘅 disabled)
// 凡人話: manual mode 改 lookback 即時儲 localStorage, 等下次切 auto 先用
// 大少 2026-08-21 00:38 trigger — Lookback 永遠可改 (拎走 manual mode 嘅 disabled)
// 凡人話: manual mode 改 lookback 即時儲 localStorage, 等下次切 auto 先用
// auto mode 改 lookback 即時重算 (applyAutoThreshold 觸發, 跟 Spec Sync #31 onChange pattern)
// 永久 rule (大少 00:38 改寫 00:31 規則): Lookback 永遠 enable, 唔再跟 mode 切 disabled
// 之前 00:31 規則 (manual mode disabled) 大少 trigger 改為「這個參數不用 Disable」

// 大少 2026-08-21 00:02 trigger — Mode 切換 handler
// 切 auto: 即刻計算 + update 紫色線
// 切 manual: 用最近一次 auto 計算結果 (有) 或 localStorage 嘅 manual value
document.querySelectorAll('input[name="zigzag-mode"]').forEach(r => {
  r.addEventListener('change', async (e) => {
    if (!e.target.checked) return;
    const mode = e.target.value;
    setThresholdMode(mode);
    const autoDisplay = document.getElementById('zigzag-auto-display');
    const manualDisplay = document.getElementById('zigzag-manual-display');
    if (mode === 'auto') {
      if (autoDisplay) autoDisplay.style.display = '';
      if (manualDisplay) manualDisplay.style.display = 'none';
      // 即刻計算 + update 紫色線 (如果已經有 K 線)
      if (lastKlines && lastChartRefs) {
        const code = currentOptions.code;
        const period = currentOptions.period || '1d';
        if (code) await applyAutoThreshold(code, period);
      }
    } else {
      if (autoDisplay) autoDisplay.style.display = 'none';
      if (manualDisplay) manualDisplay.style.display = '';
      // 大少 8月31日 09:24 trigger — 切 manual mode 用 localStorage manual value 優先 (大少手動輸入過嘅 value)
      //   4.52.0 永久 rule: 永遠唔 overwrite 大少手動輸入嘅 value
      //   之前邏輯 (4.28.0): 用 recent auto 結果優先, overwrite manual input field
      //     → 大少輸入 8% 切 manual 嗰陣紫色線用咗 recent auto 3% 錯 (大少 8月31日 09:24 bug report)
      //   修正: localStorage 默認 5 (跟 LS_KEY_MANUAL_THRESHOLD 默認值一致, 跟 getManualThreshold() return 5 if not set)
      //     - 如果 localStorage 仲係 5 (即係從未手動輸入過), fallback 落 recent auto 結果
      //     - 否則用 localStorage (大少手動輸入過嘅 value), 同步 manual input field
      let v = getManualThreshold();  // localStorage 拎大少手動輸入過嘅 value
      if (v === 5) {  // DEFAULT_MANUAL = 5 (從未手動輸入過)
        const displayVal = document.getElementById('zigzag-auto-threshold-value');
        const recentAuto = displayVal ? displayVal.textContent : null;
        if (recentAuto && recentAuto !== '--' && !isNaN(parseFloat(recentAuto))) {
          v = parseFloat(recentAuto);
        }
      }
      const manualInput = document.getElementById('zigzag-manual-threshold');
      if (manualInput) manualInput.value = String(v);
      currentOptions.zigzagThreshold = v;
      setManualThreshold(v);
      // 切 manual 即刻 update 紫色線 (唔等大少再改)
      if (lastKlines && lastChartRefs) {
        const code = currentOptions.code;
        const period = currentOptions.period || '1d';
        if (code) {
          // 4.43.0: 拎走 applyFrontendZigZagOverlay, 改 fetch backend (manual mode)
          const verdict = await fetchAndInjectBackendZigZag('manual', v, getLookback(), 2.5);
          if (verdict && lastChartRefs) {
            currentAdapter.renderChartOverlay(lastVerdict, lastKlines, lastChartRefs);
            renderDebugPanel(lastChartRefs, lastVerdict, lastKlines);
          }
          const pointsCount = lastVerdict?.meta?.zigzagPointsCount || 0;
          if (pointsCount > 0) {
            runStatus.innerHTML = `✅ 切到手動 mode, threshold=${v}% (${pointsCount} 個 points, backend 計)`;
          }
        }
      }
    }
  });
});

// 大少 2026-08-21 00:02 trigger — 重算掣 (auto mode 用, 用最新 K 線重計)
const recalcBtn = document.getElementById('zigzag-recalc-btn');
if (recalcBtn) {
  recalcBtn.addEventListener('click', async () => {
    if (!lastKlines || !lastChartRefs) {
      runStatus.innerHTML = `⚠️ 請先撳「跑算法」再重算`;
      return;
    }
    const code = currentOptions.code;
    const period = currentOptions.period || '1d';
    if (!code) {
      runStatus.innerHTML = `⚠️ 未揀股票, 請先去上面揀`;
      return;
    }
    await applyAutoThreshold(code, period);
  });
}

// 大少 2026-08-21 00:02 trigger — 重置為自動掣 (manual mode 用, 一鍵切去 auto)
const resetAutoBtn = document.getElementById('zigzag-reset-auto-btn');
if (resetAutoBtn) {
  resetAutoBtn.addEventListener('click', async () => {
    document.querySelector('input[name="zigzag-mode"][value="auto"]').checked = true;
    setThresholdMode('auto');
    const autoDisplay = document.getElementById('zigzag-auto-display');
    const manualDisplay = document.getElementById('zigzag-manual-display');
    if (autoDisplay) autoDisplay.style.display = '';
    if (manualDisplay) manualDisplay.style.display = 'none';
    if (lastKlines && lastChartRefs) {
      const code = currentOptions.code;
      const period = currentOptions.period || '1d';
      if (code) await applyAutoThreshold(code, period);
    }
  });
}

// 大少 2026-08-21 00:24 trigger — Lookback 參數 (手動可調, 預設 20, 自動儲存)
// 跟 Spec Sync #31 config input onChange handler pattern 一致
// 改完即時重算 (debounce 200ms 防連環拖動 spam backend fetch)
// 永久 rule: 跟 2026-08-19 13:03 永久 rule「Config UX 模式: 自動+手動+自動儲存更新圖表」
const lookbackEl = document.getElementById('zigzag-lookback');
if (lookbackEl) {
  let _lookbackDebounce = null;
  const _onLookbackChange = () => {
    const v = parseInt(lookbackEl.value, 10);
    // 5-100 範圍 (跟 index.html input min/max 一致), invalid value 唔 trigger fetch
    if (isNaN(v) || v < LOOKBACK_MIN || v > LOOKBACK_MAX) return;
    setLookback(v);  // 跟 2026-08-19 13:03 永久 rule「每次更新都自動保存」(auto + manual mode 都儲)
    clearTimeout(_lookbackDebounce);
    _lookbackDebounce = setTimeout(async () => {
      // 撳跑算法之前冇 lastKlines, 跳過 (大少要撳「跑算法」先 render chart, 呢個只係「改完即時更新」)
      if (!lastKlines || !lastChartRefs) return;
      // 大少 2026-08-21 00:38 trigger 改寫 Spec Sync #34 永久 rule:
      // Lookback 永遠可改, manual mode 改完只係儲 localStorage, 唔 trigger 重算
      // auto mode 嗰陣即時重算 (applyAutoThreshold 觸發)
      if (getThresholdMode() !== 'auto') return;
      const code = currentOptions.code;
      const period = currentOptions.period || '1d';
      if (!code) return;
      await applyAutoThreshold(code, period);
    }, 200);
  };
  lookbackEl.addEventListener('input', _onLookbackChange);
  lookbackEl.addEventListener('change', _onLookbackChange);
}

// 大少 2026-08-21 00:24 trigger — 重置為 20 掣 (lookback 用, 一鍵 reset default)
const lookbackResetBtn = document.getElementById('zigzag-lookback-reset-btn');
if (lookbackResetBtn) {
  lookbackResetBtn.addEventListener('click', async () => {
    const el = document.getElementById('zigzag-lookback');
    if (el) el.value = String(LOOKBACK_DEFAULT);
    setLookback(LOOKBACK_DEFAULT);
    // 即時重算
    if (lastKlines && lastChartRefs && getThresholdMode() === 'auto') {
      const code = currentOptions.code;
      const period = currentOptions.period || '1d';
      if (code) await applyAutoThreshold(code, period);
    }
  });
}

// 大少 2026-08-21 00:02 trigger — Manual slider 即時改 (跟 Spec Sync #31 #zigzag-threshold pattern 一致)
// Debounce 200ms 防 slider 連環拖動 spam backend fetch
const manualThresholdEl = document.getElementById('zigzag-manual-threshold');
if (manualThresholdEl) {
  let _manualDebounce = null;
  const _onManualChange = () => {
    const v = parseFloat(manualThresholdEl.value);
    // 1-20% 範圍 (跟 index.html input min/max 一致), invalid value 唔 trigger fetch
    if (isNaN(v) || v < 1 || v > 20) return;
    currentOptions.zigzagThreshold = v;
    setManualThreshold(v);  // 跟 2026-08-19 13:03 永久 rule「每次更新都自動保存」
    clearTimeout(_manualDebounce);
    _manualDebounce = setTimeout(async () => {
      // 撳跑算法之前冇 lastVerdict, 跳過 (大少要撳「跑算法」先 render chart, 呢個只係「改完即時更新」)
      if (!lastVerdict || !lastKlines || !lastChartRefs) return;
      const code = currentOptions.code;
      const period = currentOptions.period || '1d';
      if (!code) return;
      runStatus.innerHTML = `⏳ 即時更新 ZigZag (threshold=${v}%)...`;
      // 4.43.0: 拎走 applyFrontendZigZagOverlay, 改 fetch backend (manual mode 用 v)
      const verdict = await fetchAndInjectBackendZigZag('manual', v, getLookback(), 2.5);
      if (verdict && lastChartRefs) {
        currentAdapter.renderChartOverlay(lastVerdict, lastKlines, lastChartRefs);
        renderDebugPanel(lastChartRefs, lastVerdict, lastKlines);
      }
      const pointsCount = lastVerdict?.meta?.zigzagPointsCount || 0;
      if (pointsCount > 0) {
        runStatus.innerHTML = `✅ ZigZag 即時更新 (threshold=${v}%, ${pointsCount} 個 points, backend 計)`;
      } else {
        runStatus.innerHTML = `⚠️ ZigZag 即時更新失敗, 用緊舊 threshold 嘅紫色線`;
      }
    }, 200);
  };
  manualThresholdEl.addEventListener('input', _onManualChange);
  manualThresholdEl.addEventListener('change', _onManualChange);
}

// 大少 2026-08-20 23:10 trigger — ZigZag threshold slider 即時 re-render 永久 rule (Bug fix)
// 凡人話: 改完 threshold 即刻 fetch backend 取新 ZigZag verdict, 重畫紫色線, 唔使再撳「跑算法」
// 跟 2026-08-19 13:03 永久 rule「Config UX 模式: 自動+手動+自動儲存更新圖表」一致
// Bug (大少 23:10): threshold input 之前冇 onChange handler, value 永遠唔入 currentOptions, 紫色線永遠用緊撳跑嗰陣嘅 5%
// 套用: 之後 M2 / M3 / M4 config 全部跟呢個 pattern (改動 → 即時 re-render, 唔需要撳跑算法)
const zigzagThresholdEl = document.getElementById('zigzag-threshold');
if (zigzagThresholdEl) {
  // 大少開頁嗰陣: 初始 value 同步入 currentOptions (跟 input default value="5" 一致)
  currentOptions.zigzagThreshold = parseFloat(zigzagThresholdEl.value) || 5;
  // Debounce 200ms 畀 slider 連環拖動唔好 spam backend fetch
  let _thresholdDebounce = null;
  const _onThresholdChange = () => {
    const v = parseFloat(zigzagThresholdEl.value);
    // 1-20% 範圍 (跟 index.html input min/max 一致), invalid value 唔 trigger fetch
    if (isNaN(v) || v < 1 || v > 20) return;
    currentOptions.zigzagThreshold = v;
    clearTimeout(_thresholdDebounce);
    _thresholdDebounce = setTimeout(async () => {
      // 撳跑算法之前冇 lastVerdict, 跳過 (大少要撳「跑算法」先 render chart, 呢個只係「改完即時更新」)
      if (!lastVerdict || !lastKlines || !lastChartRefs) return;
      const code = currentOptions.code;
      const period = currentOptions.period || '1d';
      if (!code) return;
      runStatus.innerHTML = `⏳ 即時更新 ZigZag (threshold=${v}%)...`;
      // 4.43.0: 拎走 applyFrontendZigZagOverlay, 改 fetch backend (manual mode 用 v)
      const verdict = await fetchAndInjectBackendZigZag('manual', v, getLookback(), 2.5);
      if (verdict && lastChartRefs) {
        currentAdapter.renderChartOverlay(lastVerdict, lastKlines, lastChartRefs);
        renderDebugPanel(lastChartRefs, lastVerdict, lastKlines);
      }
      const pointsCount = lastVerdict?.meta?.zigzagPointsCount || 0;
      if (pointsCount > 0) {
        runStatus.innerHTML = `✅ ZigZag 即時更新 (threshold=${v}%, ${pointsCount} 個 points, backend 計)`;
      } else {
        runStatus.innerHTML = `⚠️ ZigZag 即時更新失敗, 用緊舊 threshold 嘅紫色線`;
      }
    }, 200);
  };
  zigzagThresholdEl.addEventListener('input', _onThresholdChange);
  zigzagThresholdEl.addEventListener('change', _onThresholdChange);
}

// 大少 8月31日 11:09 trigger (4.53.0 永久 rule) — 拎走 reRenderZigZagSequence function
// 拎走 P 點 sequence marker toggle 之後, 唔再需要即時 re-render chart overlay
// 撳 checkbox 撳 spinbutton 嗰兩個 listener 一齊拎走 (line 1979-1995)

// 大少 8月31日 12:50 trigger (4.54.0) — renderDebugPanel 加 _formatZigZagLatestPointsForDebug helper
// 凡人話: 拎 zigzagPoints array, 倒序 take last 10, format 做 mini-table HTML (P1 為最新)
// 對齊 8月29日 14:32 永久 rule P1/P2/P3/P4 indexing (P1 = zzp[-1] 最新, P2 = zzp[-2], ...)
// 對齊 4.43.0 永久 rule「ZigZag 全部 backend 計」 (zigzagPoints 由 backend inject 落 verdict.meta, frontend 唔重計)
// 對齊 4.15.0 永久 rule「之字拎 point 用 high/low」 (type 'high' = peak, type 'low' = trough)
//
// 大少 8月31日 17:42 trigger (修改版 20:51 + 20:57) 4.57.0 — 改 signature 加 threshold + thresholdMode 2 個參數
//   ✅ Mini-table 由 4 欄變 6 欄: 加「獨發點日期」+ 「獨發點股價」2 個 column
//   ✅ 標題上邊加 1 行: 「🔧 Threshold: X.XX% (mode: auto|manual)」
//   ✅ 獨發點: 對齊 4.15.0 永久 rule「之字拎 point 同 trigger 都用 high/low」, Trough trigger 拎嗰日 K 線 high, Peak trigger 拎嗰日 K 線 low
//   ✅ 對齊 4.56.0 精神: 最後 ongoing point 拎 K 線最後 close 做 trigger 價
//   ✅ 凡人話: 大少撳跑 M1 即時喺黑色 console log 底部見到 P1-P10 日子 + 點數 + 獨發點日期 + 獨發點股價
function _formatZigZagLatestPointsForDebug(zigzagPoints, threshold, thresholdMode) {
  // 大少 4.57.0 trigger 1 — 標題上邊加 1 行顯示 Threshold % + mode (大少要睇清楚用咗咩 % 數值計 ZigZag)
  const thresholdLine = (threshold !== undefined && threshold !== null)
    ? `<strong style="color:#dcdcaa;">🔧 Threshold: ${Number(threshold).toFixed(2)}% (mode: ${thresholdMode || '?'})</strong>\n`
    : `<em style="color:#888;">// Threshold 拎唔到</em>\n`;
  if (!Array.isArray(zigzagPoints) || zigzagPoints.length === 0) {
    return `${thresholdLine}<strong style="color:#dcdcaa;">📈 ZigZag 最新 10 點 (P1 為最新, 倒序排):</strong> <em style="color:#888;">(冇 points, 可能未跑算法 / threshold 太高)</em>`;
  }
  // 大少 8月31日 13:14 trigger (4.55.0 fix) — fix 之前 4.54.0 寫錯 verdict.points 排法
  // 大少 9月1日 14:10 trigger 拎走 4.56.0 嘅 'today' point filter:
  // 之前: 拎 todayPoint (type='today', K線最後 close) 做 P1, P2-P10 拎 confirmed points
  // 而家: 拎走 'today' point, P1 = 紫色 algorithm 拎到嘅最後 confirmed ZigZag point (standard)
  // 拎最前 10 個 (verdict.points 已經係 (新 → 舊) 排, points[0] = 最新紫色 ZigZag point)
  // 所以最前 10 個 = 最新嗰 10 個, P1 = points[0] = 最新, 唔需要 reverse
  // curl evidence (8月31日 13:14): HK.00019 verdict.points[0]=2026-08-21 (最新) + points[-1]=2025-08-04 (最舊), 確認 (新 → 舊) 排法
  // 對齊 8月29日 14:32 永久 rule「P1 = 最新」
  // 對齊 4.43.0 永久 rule「ZigZag 全部 backend 計」(frontend 拎 backend 注入嘅 verdict.meta.zigzagPoints, 唔重計)
  const last10 = zigzagPoints.slice(0, 10);
  // 大少 4.57.0 trigger 2 — Mini-table header 加 2 個 column: 獨發點日期 + 獨發點股價
  const headerRow = '<tr style="color:#9cdcfe;text-align:left;">' +
    '<th style="padding-right:12px;">序號</th>' +
    '<th style="padding-right:12px;">日子</th>' +
    '<th style="padding-right:12px;">點數</th>' +
    '<th style="padding-right:12px;">類型</th>' +
    '<th style="padding-right:12px;">獨發點<br>日期<br><em style="color:#888;font-size:10px;">(trigger 到)</em></th>' +
    '<th style="padding-right:12px;">獨發點<br>股價<br><em style="color:#888;font-size:10px;">(確認價)</em></th>' +
    '</tr>';
  const bodyRows = last10.map((p, idx) => {
    const seq = idx + 1;  // P1 = 最新
    const typeLabel = p.type === 'high' ? '📈 Peak' : p.type === 'low' ? '📉 Trough' : (p.type || '?');
    const date = p.date || p.decisionDate || '(?)';
    const value = Number.isFinite(p.value) ? p.value.toFixed(2) : (Number.isFinite(p.decisionValue) ? p.decisionValue.toFixed(2) : '(?)');
    // 大少 4.57.0 trigger 2 — 拎 backend inject 嘅 triggerDate / triggerPrice (對齊 4.15.0 規則)
    // 大少 2026-09-01 16:48 trigger (4.60.0) — ongoing point 拎 backend 設嘅 is_ongoing flag, 顯示「(待觸發)」取代「(?)」
    //   凡人話: 之字 ongoing point (P1 最後嗰個) 仲未 trigger 過, trigger 設 null 唔應該顯示「(?)」誤導大少
    //   改用 backend inject 嘅 is_ongoing flag 顯示「(待觸發)」, 大少一眼分到「呢個未 confirm」
    const isOngoing = p.is_ongoing === true;
    const triggerDate = isOngoing ? '<em style="color:#888;">(待觸發)</em>' :
      (p.triggerDate || p.trigger_date || '(?)');
    const triggerPrice = isOngoing ? '<em style="color:#888;">(待觸發)</em>' :
      (Number.isFinite(p.triggerPrice) ? p.triggerPrice.toFixed(2) :
        (Number.isFinite(p.trigger_price) ? p.trigger_price.toFixed(2) : '(?)'));
    return `<tr>` +
      `<td style="padding-right:12px;"><strong style="color:#dcdcaa;">P${seq}</strong></td>` +
      `<td style="padding-right:12px;">${date}</td>` +
      `<td style="padding-right:12px;">${value}</td>` +
      `<td style="padding-right:12px;">${typeLabel}</td>` +
      `<td style="padding-right:12px;">${triggerDate}</td>` +
      `<td style="padding-right:12px;">${triggerPrice}</td>` +
      `</tr>`;
  }).join('');
  return `${thresholdLine}<strong style="color:#dcdcaa;">📈 ZigZag 最新 10 點 (P1 為最新, 倒序排):</strong>
<table style="margin-top:4px;color:#d4d4d4;font-family:monospace;font-size:12px;border-collapse:collapse;">${headerRow}${bodyRows}</table>
<em style="color:#608b4e;">// P1 = 紫色 ZigZag algorithm 拎到嘅最後 confirmed point (因為 backend verdict.points 排法係 (新 → 舊), points[0] = 最新)
// 拎走咗 4.56.0 嘅 'today' point, P1 唔再用 K線最後 close, 對齊 standard ZigZag algorithm
// 上升判斷: P1>P3 + P2>P4 / 下跌判斷: P1<P3 + P2<P4 (對齊 8月29日 14:32 永久 rule)</em>`;
}

// ===== renderDebugPanel — 抽出去畀 runAlgorithm 都用 (大少 2026-08-19 11:35) =====
// 凡人話: 拎 chart overlay 最新 state (紫色 ZigZag) 顯示喺黑色 debug 區域
// 之前 inline 喺 runAlgorithm 入面, 但 reRenderZigZagSequence 跑完之後 panel 永遠唔更新
// 大少 4.53.0 拎走 reRenderZigZagSequence, 但 renderDebugPanel 仍然畀 runAlgorithm 用
// 大少 4.54.0 (8月31日 12:50 trigger) 加 _formatZigZagLatestPointsForDebug helper, 喺「K線最後 close」行之下
// inject 1 個 ZigZag P1-P10 mini-table (P1 為最新, 倒序排), 凡人話: 大少撳跑 M1 之後即時喺 panel 底部見到日子 + 點數
function renderDebugPanel(chartRefs, verdict, klines) {
  const debugPanel = document.createElement('pre');
  debugPanel.id = 'chart-debug-panel';
  debugPanel.style.cssText = 'background:#1e1e1e;color:#d4d4d4;padding:14px;margin-top:14px;border-radius:6px;font-size:12px;line-height:1.6;overflow-x:auto;white-space:pre-wrap;';
  const maV2Keys = Object.keys(chartRefs.maV2LineSeries || {});
  const hasZigzag = !!(chartRefs.maV2LineSeries && chartRefs.maV2LineSeries.zigzag);
  // 大少 8月31日 11:09 trigger (4.53.0 永久 rule) — 拎走 hasZigzagExt (鮮綠色 close extension 線拎走後唔再需要)
  const metaKeys = verdict.meta ? Object.keys(verdict.meta) : [];
  const lastKlineDebug = klines && klines.length > 0 ? klines[klines.length - 1] : null;
  const lastCloseDebug = lastKlineDebug ? lastKlineDebug.close : null;
  // 大少 2026-08-19 10:15 — 用 fallback chain 拎 K 線最後日期 (跟 adapter.mjs _zigzagNormalizeDate 一樣邏輯)
  // 拎 k.date → k.timestamp (number / ISO string) → k.time (number / ISO string) fallback chain,
  // 拎到 valid date 就 return "YYYY-MM-DD" 格式
  function _getKlineDateForDebug(k) {
    if (!k) return null;
    if (k.date) return k.date;
    if (k.timestamp) {
      const t = typeof k.timestamp === 'number' ? k.timestamp : Date.parse(k.timestamp);
      if (Number.isFinite(t)) {
        return new Date(t > 1e12 ? t : t * 1000).toISOString().split('T')[0];
      }
    }
    if (k.time) {
      const t = typeof k.time === 'number' ? k.time : Date.parse(k.time);
      if (Number.isFinite(t)) {
        return new Date(t > 1e12 ? t : t * 1000).toISOString().split('T')[0];
      }
    }
    return null;
  }
  // 大少 2026-08-19 09:45 — try/catch safe handle, 避免 new Date(invalid).toISOString() 拋 RangeError
  let lastDateDebug = '(missing)';
  if (lastKlineDebug) {
    try {
      const isoDate = _getKlineDateForDebug(lastKlineDebug);
      if (isoDate) {
        lastDateDebug = isoDate;
      } else {
        lastDateDebug = '(invalid)';
      }
    } catch (e) {
      lastDateDebug = '(invalid)';
    }
  }
  debugPanel.innerHTML = `<strong style="color:#9cdcfe;">🔧 Chart Debug (大少唔使去 console, 直接睇呢度)</strong>

<strong style="color:#dcdcaa;">verdict.meta keys (${metaKeys.length}):</strong> ${metaKeys.join(', ')}

<strong style="color:#dcdcaa;">chartRefs.maV2LineSeries keys (${maV2Keys.length}):</strong> ${maV2Keys.join(', ') || '(空)'}

<strong style="color:#dcdcaa;">chartRefs.zigzagEnabled:</strong> ${chartRefs.zigzagEnabled === false ? '❌ false' : '✅ true (預設)'}

<strong style="color:#dcdcaa;">紫色 ZigZag series:</strong> ${hasZigzag ? '✅ 已 add 落 chart' : '❌ 冇 add 落 chart'}

<strong style="color:#dcdcaa;">verdict.meta.zigzagPoints length:</strong> ${verdict.meta?.zigzagPoints?.length || 0} 個 (大少可以透過 DevTools console 拎到 raw data)

<strong style="color:#dcdcaa;">verdict.meta.zigzagThreshold:</strong> ${verdict.meta?.zigzagThreshold || '(missing)'}%

<strong style="color:#dcdcaa;">verdict.meta.lastSwingHigh:</strong> ${verdict.meta?.lastSwingHigh ? JSON.stringify(verdict.meta.lastSwingHigh) : '(null)'}

<strong style="color:#dcdcaa;">verdict.meta.lastSwingLow:</strong> ${verdict.meta?.lastSwingLow ? JSON.stringify(verdict.meta.lastSwingLow) : '(null)'}

<strong style="color:#dcdcaa;">K線最後 close:</strong> ${lastCloseDebug || '(missing)'} @ ${lastDateDebug}

${_formatZigZagLatestPointsForDebug(verdict.meta?.zigzagPoints, verdict.meta?.zigzagThreshold, verdict.meta?.zigzagThresholdMode || '?')}

<em style="color:#608b4e;">// 想拎 raw data 可以喺 DevTools console 跑: window.currentChartRefs / window.currentVerdict</em>`;
  const chartContainer = document.getElementById('chart-container');
  if (chartContainer && chartContainer.parentElement) {
    // 移除舊 debug panel (避免連跑幾次疊)
    const oldPanel = document.getElementById('chart-debug-panel');
    if (oldPanel) oldPanel.remove();
    chartContainer.parentElement.appendChild(debugPanel);
  }
}
// 大少 8月31日 11:09 trigger (4.53.0 永久 rule) — 拎走 ZigZag 點順序號碼 toggle event listener
// 拎走 #zigzag-sequence-enabled + #zigzag-sequence-max-count 2 個 element 嘅 change listener
// 因為 P 點 sequence marker 拎走後, 撳 toggle 唔再有 effect, 拎走整段

// 大少 2026-08-19 17:00 trigger — MA 線獨立 toggle 即時生效
// 凡人話: 撳 MA5 checkbox → 紅色 MA5 線即時消失 / 出現, 唔需要撳「跑算法」
// 用 lightweight-charts v4 嘅 lineSeries.applyOptions({ visible: false }) 即時切換
// 唔需要 re-create series, 唔需要 re-call renderChartOverlay
// 注意: 只 support M1 v2.0 (用 maV2LineSeries), zmen v0.3.0 用 maLineSeries 唔 cover
const maToggleEls = document.querySelectorAll('.ma-toggle');
maToggleEls.forEach((el) => {
  el.addEventListener('change', (e) => {
    const maKey = e.target.dataset.maKey;  // 'ma5' | 'ma10' | 'ma20' | 'ma60'
    const visible = e.target.checked;
    if (lastChartRefs && lastChartRefs.maV2LineSeries && lastChartRefs.maV2LineSeries[maKey]) {
      try {
        lastChartRefs.maV2LineSeries[maKey].applyOptions({ visible });
        console.log(`[MA toggle] ${maKey} → visible=${visible}`);
      } catch (err) {
        console.warn(`[MA toggle] ${maKey} applyOptions failed:`, err);
      }
    } else {
      console.log(`[MA toggle] ${maKey} series 唔存在 (可能未跑 M1 v2.0 算法)`);
    }
  });
});

// =============================================================
// 大少 2026-08-11 20:55 — A 改善: 「🚀 跑完整鏈條 (M7→M9→M8)」按鈕 + handler
// 大少 2026-08-11 22:05 — 改善 2: 改 conditional (M9 過期先跑, cache OK skip M9)
// =============================================================
// 凡人話:
//   大少撳 1 個掣, 自動跑晒 3 個 module (M7 綜合 → M9 回測拎最佳設定 → M8 用最佳設定做最終判斷)。
//   唔需要自己逐一撳, 唔需要諗「先撳邊個」。
//
// 流程 (改善 2 之後改 conditional):
//   Step 0 (新增): Check M9 cache (has_optimal 30 日內?)
//   Step 1/3: 跑 M7 (synthesizerAdapter.analyze) → 拎 synthResult
//   Step 2/3: 跑 M9 (backTestAdapter.analyze) → 拎 optimal params + POST 落 cache
//             (Conditional: 改善 2 改為只係 has_optimal=false / 過期先跑, cache OK skip M9, 4 秒搞掂)
//   Step 3/3: 跑 M8 (decisionEngineAdapter.analyze) → 內部 load cache 自動用 M9 嘅 optimal
//   全部跑完 → 3 個 verdict card 一齊出 (cache OK 跳過 M9 嗰陣只 render M7 + M8), 大少一眼睇晒
//
// 永久 rule (大少 2026-08-11):
//   - Chain 唔 replace 現有 3 個獨立按鈕 (runAlgorithm), 兩者並存
//   - M9 失敗唔 block chain (用 default 跑 M8, 仲會有「未跑過 M9」banner 提示)
//   - 全部 verdict 跟 standard warning system (頂部 banner + copy button)
//   - 改善 2: cache OK (M9 optimal 30 日內) 嗰陣 skip M9, 唔浪費 30-60 秒
// =============================================================

async function runFullChain() {
  // 1. 同步 code (跟 runAlgorithm 一樣, 避免 race condition)
  const codeInputEl = document.getElementById('input-code');
  if (codeInputEl && codeInputEl.value) {
    currentOptions.code = codeInputEl.value;
  }
  if (!currentOptions.code) {
    runStatus.innerHTML = '❌ 請揀或者輸入股票代碼';
    return;
  }

  // 大少 2026-08-22 07:25 fix #3: 自動補 HK. prefix (手機 user 唔需要記 prefix)
  // 例: 輸入 "00981" → 自動變 "HK.00981" (港股 5 位數字, backend K 線 endpoint 必須有 market prefix 先識拎)
  // 已經有 prefix (HK. / US. / SH. / SZ.) 唔重覆補
  // 永久 rule: 純 5-6 位數字 = 預設港股, 因為 StockPulse testing page 主要用 HK 股票
  const _rawCode = currentOptions.code.trim();
  if (/^\d{5,6}$/.test(_rawCode)) {
    const normalized = `HK.${_rawCode}`;
    console.log(`[testing-page] Auto-prefix 股票代碼: ${_rawCode} → ${normalized}`);
    currentOptions.code = normalized;
    if (codeInputEl) codeInputEl.value = normalized;
  }

  runStatus.innerHTML = '⏳ 撈緊 K 線數據...';
  resultPanel.innerHTML = '';

  try {
    // 2. 拎 K 線
    // 大少 2026-08-14 23:15 — 永久 rule: dataWindowDays 默認值 100 → 1260 (5 年, 對 long-history 股票最 safe, 唔再 trigger CONFIG_DEFAULTS warning)
    const code = currentOptions.code;
    const period = currentOptions.period || '1d';
    const count = currentOptions.dataWindowDays || 1260;
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
    runStatus.innerHTML = `✅ 已攞到 ${klines.length} 日 K 線 · 開始跑完整鏈條 (3 步)...`;

    // 3. 動態 import 3 個 adapter (跟 testing page 既有 import 模式, cache bust 一齊)
    const adapterPath = '../algorithms/AS-03-cycle-detection/adapter.mjs?v=' + ALGO_CACHE_BUST;
    const mod = await import(adapterPath);
    const { synthesizerAdapter, backTestAdapter, decisionEngineAdapter } = mod;
    if (!synthesizerAdapter || !backTestAdapter || !decisionEngineAdapter) {
      throw new Error('adapter.mjs 唔包含 synthesizerAdapter / backTestAdapter / decisionEngineAdapter');
    }

    const chainResults = [];  // { step, label, adapter, verdict, ok }

    // Step 0 (改善 2 — chain conditional): 檢查 M9 cache, 過期先跑
    // 大少 22:05 觀察: cache OK 嗰陣永遠跑 M9 浪費 30-60 秒, 應該 conditional
    // Cache OK = M9 optimal 30 日內有效 (has_optimal = true)
    // Cache 過期/缺失 = has_optimal = false → 跑 M9 拎新 optimal
    let m9Needed = true;
    let m9SkippedReason = '';
    try {
      runStatus.innerHTML = '⏳ 檢查 M9 cache 過期...';
      const cacheCheckResp = await fetch(`${BACKEND_URL}/api/adaptive-params/${encodeURIComponent(code)}`);
      if (cacheCheckResp.ok) {
        const cacheCheck = await cacheCheckResp.json();
        if (cacheCheck.has_optimal === true) {
          m9Needed = false;
          const optAgeDays = Math.floor((cacheCheck.age_seconds || 0) / 86400);
          // M9 optimal 30 日 expiry, 拎返嚟嘅 age_seconds 係 optimal age
          // 實際 age 要拎 optimal.last_backtest, 但 response 冇, 用 has_optimal 已經夠
          m9SkippedReason = `M9 optimal cache 仲有效 (${optAgeDays} 日內, < 30 日)`;
        } else {
          m9Needed = true;
          m9SkippedReason = 'M9 optimal 過期或缺失, 要重跑';
        }
      } else if (cacheCheckResp.status === 404) {
        m9Needed = true;
        m9SkippedReason = 'M9 optimal 冇 cache, 要跑第一次';
      }
    } catch (e) {
      console.warn('[runFullChain] M9 cache check failed, fallback 跑 M9:', e);
      m9Needed = true;
      m9SkippedReason = 'M9 cache check 失敗, fallback 跑 M9';
    }

    // Step 1/3: 跑 M7 綜合判定 (永遠跑, ~2 秒)
    runStatus.innerHTML = '⏳ Step 1/3: 跑 M7 綜合判定 (6 個 module verdict → SSI/TCM/Grade/Kelly)...';
    try {
      const m7Verdict = await synthesizerAdapter.analyze(klines, currentOptions);
      chainResults.push({ step: 'M7', label: 'M7 綜合判定 (6 個模組 → SSI/TCM/Grade/Kelly)', adapter: synthesizerAdapter, verdict: m7Verdict, ok: true });
    } catch (e) {
      chainResults.push({ step: 'M7', label: 'M7 綜合判定 (失敗)', adapter: null, verdict: null, ok: false, error: e.message });
      console.error('[runFullChain] M7 failed:', e);
    }

    // Step 2/3: 跑 M9 歷史回測 (改善 2 改 conditional — cache OK 跳過, ~30-60 秒 OR 0 秒)
    if (m9Needed) {
      runStatus.innerHTML = '⏳ Step 2/3: 跑 M9 歷史回測 (拎最佳設定, 需時 30-60 秒)...';
      try {
        const m9Verdict = await backTestAdapter.analyze(klines, currentOptions);
        chainResults.push({ step: 'M9', label: 'M9 歷史回測 (拎最佳設定, POST 落 cache)', adapter: backTestAdapter, verdict: m9Verdict, ok: true });
      } catch (e) {
        // M9 失敗唔 block chain (M8 仲可以跑, 用 default optimal, banner 會提示「未跑過 M9」)
        chainResults.push({ step: 'M9', label: 'M9 歷史回測 (失敗, fallback 用 default)', adapter: null, verdict: null, ok: false, error: e.message });
        console.warn('[runFullChain] M9 failed, chain 繼續用 default 設定跑 M8:', e);
      }
    } else {
      // Cache OK, skip M9 (改善 2 — chain 加速)
      runStatus.innerHTML = `⚡ Step 2/3: M9 cache 仲有效 (${m9SkippedReason}), 跳過 M9 · 繼續跑 M8...`;
      chainResults.push({ step: 'M9', label: `M9 歷史回測 (⚡ 跳過, ${m9SkippedReason})`, adapter: null, verdict: null, ok: true, skipped: true });
    }

    // Step 3/3: 跑 M8 最終判斷 (內部 load cache 自動用 M9 嘅 optimal)
    runStatus.innerHTML = '⏳ Step 3/3: 跑 M8 最終判斷 (會自動 load M9 嘅最佳設定)...';
    try {
      const m8Verdict = await decisionEngineAdapter.analyze(klines, currentOptions);
      chainResults.push({ step: 'M8', label: 'M8 最終判斷 (用 M9 最佳設定)', adapter: decisionEngineAdapter, verdict: m8Verdict, ok: true });
    } catch (e) {
      chainResults.push({ step: 'M8', label: 'M8 最終判斷 (失敗)', adapter: null, verdict: null, ok: false, error: e.message });
      console.error('[runFullChain] M8 failed:', e);
    }

    // 4. Render 全部 verdict (改善 2 — 顯示 skipped step, cache OK 嗰陣只 render M7 + M8)
    const skippedCount = chainResults.filter(r => r.ok && r.skipped).length;
    const failCount = chainResults.filter(r => !r.ok).length;
    const summary = `${chainResults.filter(r => r.ok).length} / 3 個 step 成功${skippedCount > 0 ? ` (${skippedCount} skipped · ⚡ cache 仲有效)` : ''} · 股票: ${code}`;
    let html = `
      <div style="background:linear-gradient(90deg,#722ed1,#1890ff);color:#fff;padding:14px 18px;border-radius:8px;margin-bottom:20px;font-family:system-ui,sans-serif;">
        <div style="font-size:18px;font-weight:700;">🚀 完整鏈條跑完 (M7 → M9 → M8)</div>
        <div style="font-size:13px;margin-top:6px;opacity:0.9;">${summary}</div>
      </div>
    `;
    for (const r of chainResults) {
      const statusIcon = r.skipped ? '⚡' : (r.ok ? '✅' : '❌');
      const statusColor = r.skipped ? '#1890ff' : (r.ok ? '#52c41a' : '#EE5151');
      html += `
        <div style="margin-bottom:20px;">
          <h3 style="color:${statusColor};margin:0 0 8px 0;font-size:16px;">${statusIcon} ${r.label}</h3>
          ${r.ok && r.adapter
            ? r.adapter.renderResult(r.verdict)
            : r.skipped
              ? `<div style="background:#e6f7ff;border:1px solid #1890ff;border-radius:6px;padding:12px;color:#1890ff;">⚡ 跳過呢個 step (cache 仲有效, 唔需要重跑 M9, M8 已經用緊 cache 嘅 optimal)</div>`
              : `<div style="background:#fff1f0;border:1px solid #EE5151;border-radius:6px;padding:12px;color:#666;">❌ 失敗: ${r.error || '未知錯誤'}</div>`
          }
        </div>
      `;
    }
    resultPanel.innerHTML = html;
    const successCount = chainResults.filter(r => r.ok).length;
    if (successCount === 3 && skippedCount === 0) {
      runStatus.innerHTML = `✅ 完整鏈條跑完 · 3/3 個 step 成功 · 股票: ${code}`;
    } else if (successCount === 3 && skippedCount > 0) {
      runStatus.innerHTML = `⚡ 完整鏈條跑完 · ${3 - skippedCount}/3 個 step 跑咗 (M9 skipped, cache 仲有效) · 股票: ${code}`;
    } else {
      runStatus.innerHTML = `⚠️ 完整鏈條跑完 · ${successCount}/3 個 step 成功 · 股票: ${code} · 失敗 step 用 fallback 繼續`;
    }
  } catch (e) {
    runStatus.innerHTML = `❌ 完整鏈條失敗: ${e.message}`;
    resultPanel.innerHTML = `<div style="background:#fff1f0;border:1px solid #EE5151;border-radius:6px;padding:16px;color:#EE5151;">❌ 完整鏈條出錯: ${e.message}<br><br>提示: 試下用獨立「跑算法」按鈕逐個 module 跑, 睇下邊個 step 出問題。</div>`;
    console.error('[runFullChain] 出錯:', e);
  }
}

// 綁定「🚀 跑完整鏈條」按鈕 (跟 runAlgorithm 一樣, 行 page load 即 bind)
const runFullChainBtn = document.getElementById('run-full-chain-btn');
if (runFullChainBtn) {
  runFullChainBtn.addEventListener('click', runFullChain);
}

// =============================================================
// Sprint 2 sub-task 2.8 — 「🔄 重新校準」按鈕 event handler (M8 5 個 adaptive params)
// =============================================================
// 當 M8 verdict card render 時, 內聯 button 「🔄 重新校準」會調用 window.__recalibrateAdaptiveParams
// 流程: DELETE cache → 重新跑 runAlgorithm() → POST save 新 cache
// =============================================================
// 大少 2026-08-11 — Module Warning System v1.0.0 — Copy warning handlers
// =============================================================
// Module Warning System — Copy 提示 handlers (大少 2026-08-11 永久 rule)
//
// 目的: 當頂部 WarningBanner 或個別 module verdict card 內 WarningCard 嘅
//       Copy button 撳落嚟, 將個 warning (Markdown 4 樣格式) 寫落 clipboard,
//       大少可以直接 paste 畀 Mavis 立即知道問題 + 修復方法。
//
// 凡人話流程:
//   1. 大少撳 Copy 全部 / Copy 單個 button
//   2. handler 拎 window._currentWarnings (即當前 verdict._warnings)
//   3. 動態 import formatWarningForCopy / formatAllWarningsForCopy (ESM lib)
//   4. writeText 落 clipboard
//   5. visual feedback: button text 變 '✅ Copied!' 1.5-2 秒後還原
//
// 永久 rule (大少 2026-08-11):
//   - Copy 提示一定要 Markdown 4 樣 (Module/Code/問題/影響/修復/Debug Context)
//   - fallback 機制: clipboard API 失敗 → textarea + execCommand
//   - dedupe by (level + module_id + code), sort Critical → Warning → Info
// =============================================================

// 單個 warning Copy handler
// 參數 idxOrKey:
//   - number: 頂部 banner 嘅 index (用 array index 拎 warning)
//   - string: "module_id_code" 格式 (個別 module Copy button 用)
window.__copyWarning = async function(idxOrKey) {
  const warnings = window._currentWarnings || [];
  let targetWarning = null;

  if (typeof idxOrKey === 'number') {
    // Index (頂部 banner Copy button)
    targetWarning = warnings[idxOrKey];
  } else if (typeof idxOrKey === 'string') {
    // "module_id_code" key (個別 module Copy button)
    const [moduleId, code] = idxOrKey.split('_');
    targetWarning = warnings.find((w) => w.module_id === moduleId && w.code === code);
  }

  if (!targetWarning) {
    alert('⚠️ 搵唔到對應警告, 可能 warning 已被 dedupe 或 verdict 冇 _warnings');
    return;
  }

  const { formatWarningForCopy } = await import('../algorithms/AS-03-cycle-detection/lib/warnings.mjs?v=' + ALGO_CACHE_BUST);
  const md = formatWarningForCopy(targetWarning);

  try {
    await navigator.clipboard.writeText(md);
    // 簡單 visual feedback
    const btn = document.activeElement;
    if (btn && btn.textContent.includes('Copy')) {
      const origText = btn.textContent;
      btn.textContent = '✅ Copied!';
      setTimeout(() => { btn.textContent = origText; }, 1500);
    }
  } catch (e) {
    // Fallback: 用 textarea + execCommand (舊 browser 兼容)
    const ta = document.createElement('textarea');
    ta.value = md;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      alert('📋 已 Copy (fallback mode):\n\n' + md);
    } catch (err) {
      alert('❌ Copy 失敗, 請手動 Copy:\n\n' + md);
    }
    document.body.removeChild(ta);
  }
};

// Copy 全部 warnings handler (頂部 banner 嘅 Copy 全部 button)
// 凡人話: 一次過拎晒所有 warnings, 攤平做一個 Markdown 大文檔, paste 畀
//         Mavis 即時睇晒全部問題 (唔使逐個 copy)。
window.__copyAllWarnings = async function() {
  const warnings = window._currentWarnings || [];
  if (warnings.length === 0) {
    alert('⚠️ 冇警告可以 Copy');
    return;
  }
  const { formatAllWarningsForCopy } = await import('../algorithms/AS-03-cycle-detection/lib/warnings.mjs?v=' + ALGO_CACHE_BUST);
  const md = formatAllWarningsForCopy(warnings);
  try {
    await navigator.clipboard.writeText(md);
    const btn = document.activeElement;
    if (btn && btn.textContent.includes('Copy 全部')) {
      const origText = btn.textContent;
      btn.textContent = `✅ Copied! (${warnings.length} 個)`;
      setTimeout(() => { btn.textContent = origText; }, 2000);
    }
  } catch (e) {
    alert('❌ Copy 失敗:\n\n' + md);
  }
};

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
/* ~/stockpulse/zigzag-testing/zigzag-testing.js
 *
 * ZigZag Testing — 新後台 vs 舊前台對比 (大少 2026-08-29 19:34)
 *
 * 凡人話: 1-to-1 port testing-page.js 嘅 ZigZag UX (紫線 + 鮮綠線 + P 點 + auto threshold)
 * 落新前台, 拎新後台 endpoint 嘅 verdict, 1-to-1 對齊 frontend algorithm 拎到嘅結果。
 *
 * 對應 source (testing page 對齊):
 * - testing-page.js:39-46 fetchBackendZigZag (1-to-1, 改 endpoint)
 * - testing-page.js:52-91 autoThresholdVolatility + extractHLC (1-to-1 落 backend, frontend 唔再計)
 * - testing-page.js 4.9.0/4.10.0 P 點 marker (sequence 號碼, 1=最新, 倒序排, 預設最近 30 個)
 * - testing-page.js 4.12.0 marker 排位 (high → aboveBar, low → belowBar, today → aboveBar)
 * - testing-page.js 4.13.0 紫線 #A020F0
 * - testing-page.js 4.33.0 鮮綠線 #00C853
 * - testing-page.js 4.28.0 auto/manual mode + lookback (對齊 UX)
 * - testing-page.js 4.31.0 lookback 永遠可改
 * - testing-page.js 4.12.0 setVisibleLogicalRange 50ms race condition fix
 *
 * 永久 rule (大少 2026-08-29 19:34):
 * - 永遠唔好動 testing-page.js / index.html
 * - 永遠用 backend endpoint 拎 data, 唔好自己 re-implement
 * - 圖表 100% 對齊 testing page 樣式 (大少 trigger: 「我要有一樣的圖表」)
 */

const BACKEND_URL = (() => {
  // 對齊 testing-page.js:20-25, 自動取 hostname
  if (window.location.protocol === 'file:') return '';
  return `http://${window.location.hostname}:18792`;
})();

console.log(`[zigzag-testing] BACKEND_URL = ${BACKEND_URL} (hostname: ${window.location.hostname})`);

// ============================================================
// 凡人話: localStorage keys (對齊 testing page 永久 rule)
// ============================================================
const LS_KEY_THRESHOLD_MODE = 'stockpulse.zigzag.thresholdMode';
const LS_KEY_MANUAL_THRESHOLD = 'stockpulse.zigzag.manualThreshold';
const LS_KEY_LOOKBACK = 'stockpulse.zigzag.lookback';

const LOOKBACK_DEFAULT = 20;
const LOOKBACK_MIN = 5;
const LOOKBACK_MAX = 100;
const MANUAL_THRESHOLD_DEFAULT = 5;

function getThresholdMode() {
  return localStorage.getItem(LS_KEY_THRESHOLD_MODE) || 'auto';
}
function setThresholdMode(mode) {
  localStorage.setItem(LS_KEY_THRESHOLD_MODE, mode);
}
function getManualThreshold() {
  const v = parseFloat(localStorage.getItem(LS_KEY_MANUAL_THRESHOLD));
  return Number.isFinite(v) && v >= 1 && v <= 20 ? v : MANUAL_THRESHOLD_DEFAULT;
}
function setManualThreshold(v) {
  localStorage.setItem(LS_KEY_MANUAL_THRESHOLD, String(v));
}
function getLookback() {
  const v = parseInt(localStorage.getItem(LS_KEY_LOOKBACK), 10);
  return Number.isFinite(v) && v >= LOOKBACK_MIN && v <= LOOKBACK_MAX ? v : LOOKBACK_DEFAULT;
}
function setLookback(v) {
  localStorage.setItem(LS_KEY_LOOKBACK, String(v));
}

// ============================================================
// 凡人話: 拎新後台 endpoint
// ============================================================
async function fetchZigzagTestingBackend(symbol, period, options = {}) {
  const params = new URLSearchParams({
    symbol,
    period,
    data_window_days: '1260',
    threshold_mode: options.thresholdMode || 'auto',
    lookback: String(options.lookback || 20),
    multiplier: String(options.multiplier || 2.5),
  });
  if (options.manualThreshold != null) {
    params.set('manual_threshold', String(options.manualThreshold));
  }
  const url = `${BACKEND_URL}/api/zigzag-testing/run?${params}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`後台 ZigZag testing 拎唔到: ${resp.status} ${resp.statusText}`);
  }
  return await resp.json();
}

// ============================================================
// 凡人話: Chart instance + render (對齊 testing page chart)
// ============================================================
let chartInstance = null;
let candleSeries = null;
let zigzagSeries = null;
let extensionSeries = null;

function renderChart(klines) {
  const container = document.getElementById('chart-container');
  if (!container) return null;

  // Dispose 舊 chart (對齊 testing page 4.8.6)
  if (chartInstance) {
    try {
      chartInstance.remove();
    } catch (e) {
      // ignore
    }
    chartInstance = null;
    candleSeries = null;
    zigzagSeries = null;
    extensionSeries = null;
  }

  chartInstance = LightweightCharts.createChart(container, {
    layout: {
      background: { type: 'solid', color: '#ffffff' },
      textColor: '#333',
    },
    grid: {
      vertLines: { color: '#f0f0f0' },
      horzLines: { color: '#f0f0f0' },
    },
    width: container.clientWidth,
    height: 600,
    timeScale: {
      timeVisible: true,
      secondsVisible: false,
    },
  });

  // K 線 (candlestick)
  candleSeries = chartInstance.addCandlestickSeries({
    upColor: '#26a69a',
    downColor: '#ef5350',
    borderUpColor: '#26a69a',
    borderDownColor: '#ef5350',
    wickUpColor: '#26a69a',
    wickDownColor: '#ef5350',
  });

  // 對齊 lightweight-charts v4.2.3 time format
  const candleData = klines.map(k => {
    let time;
    const t = k.time || k.date || k.timestamp;
    if (typeof t === 'string') {
      // ISO string → YYYY-MM-DD
      time = t.length >= 10 ? t.substring(0, 10) : t;
    } else if (typeof t === 'number') {
      // Unix timestamp (秒 or 毫秒)
      time = t > 1e12 ? t / 1000 : t;
    } else {
      time = String(t);
    }
    return {
      time,
      open: Number(k.open ?? k.Open ?? k.OPEN ?? 0),
      high: Number(k.high ?? k.High ?? k.HIGH ?? 0),
      low: Number(k.low ?? k.Low ?? k.LOW ?? 0),
      close: Number(k.close ?? k.Close ?? k.CLOSE ?? 0),
    };
  }).filter(d => d.time && !isNaN(d.high) && d.high > 0);

  // Dedupe by time (對齊 testing page Python port 拎 1255 條)
  const seen = new Set();
  const deduped = [];
  for (const d of candleData) {
    if (!seen.has(d.time)) {
      seen.add(d.time);
      deduped.push(d);
    }
  }
  candleSeries.setData(deduped);

  // 紫線 series
  zigzagSeries = chartInstance.addLineSeries({
    color: '#A020F0',
    lineWidth: 2,
  });

  // 鮮綠線 series (close extension)
  extensionSeries = chartInstance.addLineSeries({
    color: '#00C853',
    lineWidth: 3,
  });

  chartInstance.timeScale().fitContent();

  // 對齊 testing page 4.8.6: 預設 zoom 落最近半年 (126 個交易日)
  const visibleRange = Math.min(126, deduped.length);
  if (deduped.length > visibleRange) {
    setTimeout(() => {
      try {
        chartInstance.timeScale().setVisibleLogicalRange({
          from: deduped.length - visibleRange,
          to: deduped.length,
        });
        // 對齊 testing page 4.12.0: 50ms race condition fix
        setTimeout(() => {
          try {
            chartInstance.timeScale().setVisibleLogicalRange({
              from: deduped.length - visibleRange,
              to: deduped.length,
            });
          } catch (e) { /* ignore */ }
        }, 50);
      } catch (e) { /* ignore */ }
    }, 50);
  }

  return { chartInstance, candleSeries, zigzagSeries, extensionSeries, dedupedKlines: deduped };
}

// ============================================================
// 凡人話: Render ZigZag overlay (紫線 + 鮮綠線 + P 點 marker)
// 對齊 testing page 4.13.0 + 4.33.0
// ============================================================
function renderZigZagOverlay(verdict, chartRefs) {
  const { dedupedKlines } = chartRefs;
  const points = verdict.points || [];
  const extensionLine = verdict.extension_line;

  if (!points || points.length === 0) {
    if (chartRefs.zigzagSeries) chartRefs.zigzagSeries.setData([]);
    if (chartRefs.extensionSeries) chartRefs.extensionSeries.setData([]);
    clearMarkers();
    return;
  }

  // 1. 紫線: 用 P 點 (sequence 倒序排: 1 = 最新 = points[-1])
  // 因為新後台 1-to-1 port frontend calculateZigZag, points 已經按時間順序列
  // 我哋要按時間順序列由舊到新畫線
  const sortedPoints = [...points].sort((a, b) => (a.index || 0) - (b.index || 0));
  const zigzagData = sortedPoints.map(p => {
    const k = dedupedKlines[p.index] || dedupedKlines[dedupedKlines.length - 1 - (points.length - 1 - p.index)];
    return {
      time: k ? k.time : (p.date ? p.date.substring(0, 10) : ''),
      value: p.value,
    };
  }).filter(d => d.time);
  if (chartRefs.zigzagSeries) chartRefs.zigzagSeries.setData(zigzagData);

  // 2. 鮮綠線 extension (從最後 ZigZag point → K 線最後 close)
  if (extensionLine && chartRefs.extensionSeries) {
    const fromTime = extensionLine.from.date ? extensionLine.from.date.substring(0, 10) : '';
    const toTime = extensionLine.to.date ? extensionLine.to.date.substring(0, 10) : '';
    if (fromTime && toTime) {
      chartRefs.extensionSeries.setData([
        { time: fromTime, value: extensionLine.from.value },
        { time: toTime, value: extensionLine.to.value },
      ]);
    } else {
      chartRefs.extensionSeries.setData([]);
    }
  } else if (chartRefs.extensionSeries) {
    chartRefs.extensionSeries.setData([]);
  }

  // 3. P 點 marker (對齊 testing page 4.9.0/4.10.0, 預設最近 30 個)
  const showSequence = document.getElementById('show-sequence').checked;
  if (showSequence) {
    const maxCount = parseInt(document.getElementById('sequence-max-count').value) || 30;
    renderSequenceMarkers(points, extensionLine, chartRefs, maxCount);
  } else {
    clearMarkers();
  }
}

function clearMarkers() {
  if (!chartInstance || !candleSeries) return;
  // lightweight-charts v4.2.3 native setMarkers
  try {
    candleSeries.setMarkers([]);
  } catch (e) {
    // ignore
  }
}

function renderSequenceMarkers(points, extensionLine, chartRefs, maxCount) {
  if (!candleSeries) return;

  // 1 號 = 今日 close 鮮綠色 (extension)
  // 2 號 = 紫色最後 1 個 ZigZag point (points[-1])
  // 倒序排
  const markers = [];

  // 1 號: 今日 close
  if (extensionLine) {
    const toTime = extensionLine.to.date ? extensionLine.to.date.substring(0, 10) : '';
    if (toTime) {
      markers.push({
        time: toTime,
        position: 'aboveBar',  // 對齊 testing page 4.12.0: today → aboveBar
        color: '#00C853',
        shape: 'circle',
        text: '1',
      });
    }
  }

  // 2 號到 N 號: ZigZag points (倒序, 最新 = sequence 2)
  // points 已經按時間順序列, 所以 points[-1] = 最新 = sequence 2
  const sortedPoints = [...points].sort((a, b) => (a.index || 0) - (b.index || 0));
  const n = sortedPoints.length;
  const displayCount = Math.min(maxCount - 1, n); // 1 號留俾 today, 2 號起係 ZigZag points
  for (let i = 0; i < displayCount; i++) {
    const p = sortedPoints[n - 1 - i]; // 倒序
    const seq = i + 2; // 2, 3, 4, ...
    const k = chartRefs.dedupedKlines[p.index];
    if (!k) continue;
    const time = k.time;
    const position = p.type === 'high' ? 'aboveBar' : 'belowBar'; // 對齊 testing page 4.12.0
    markers.push({
      time,
      position,
      color: '#A020F0',
      shape: p.type === 'high' ? 'arrowDown' : 'arrowUp',
      text: String(seq),
    });
  }

  try {
    candleSeries.setMarkers(markers);
  } catch (e) {
    console.warn('setMarkers failed:', e);
  }
}

// ============================================================
// 凡人話: Debug panel (對齊 testing page 4.8.2 + 加強 K 線對比)
// ============================================================
function renderDebugPanel(verdict, chartRefs) {
  const panel = document.getElementById('debug-panel');
  if (!panel) return;
  if (!verdict || !verdict.ok) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';

  const summary = document.getElementById('debug-summary');
  const pointsEl = document.getElementById('debug-points');

  summary.innerHTML = `
    <div>OK: <span style="color:#00C853;">${verdict.ok}</span></div>
    <div>Symbol: <span style="color:#1890ff;">${verdict.symbol}</span> | Period: <span style="color:#1890ff;">${verdict.period}</span></div>
    <div>Threshold: <span style="color:#fa8c16;">${verdict.threshold}%</span> (mode: <span style="color:#fa8c16;">${verdict.threshold_mode}</span>)</div>
    <div>K 線 count: <span style="color:#1890ff;">${verdict.klines_count}</span> | P 點 count: <span style="color:#A020F0;">${verdict.sequence_count}</span></div>
    <div>Extension line: <span style="color:#00C853;">${verdict.extension_line ? `${verdict.extension_line.from.value} → ${verdict.extension_line.to.value} (${verdict.extension_line.color})` : 'N/A'}</span></div>
    <div style="margin-top:8px;color:#888;">最近 6 個 P 點 (sequence 1-6, 對比舊 testing page 拎 frontend 計嘅 P 點):</div>
  `;

  // 最近 6 個 P 點 (sequence 1-6, 1 = today close, 2-6 = 紫色 ZigZag points)
  const points = verdict.points || [];
  const sortedPoints = [...points].sort((a, b) => (a.index || 0) - (b.index || 0));
  const n = sortedPoints.length;

  let pointsHtml = '<div style="margin-top:4px;">';

  // 1 號 today close
  if (verdict.extension_line) {
    const ext = verdict.extension_line;
    const toK = chartRefs.dedupedKlines[chartRefs.dedupedKlines.length - 1];
    const toRealHigh = toK ? toK.high : '?';
    const toRealLow = toK ? toK.low : '?';
    pointsHtml += `<div class="point-row today" style="grid-template-columns:50px 120px 80px 100px 100px 100px;">
      <div>1</div>
      <div>${ext.to.date || '?'}</div>
      <div>today</div>
      <div>ext=${ext.to.value}</div>
      <div>K.close=${toK ? toK.close : '?'}</div>
      <div style="color:#888;">H=${toRealHigh} L=${toRealLow}</div>
    </div>`;
  }

  // 2-6 號 ZigZag points
  for (let i = 0; i < Math.min(5, n); i++) {
    const p = sortedPoints[n - 1 - i];
    const seq = i + 2;
    const k = chartRefs.dedupedKlines[p.index];
    if (!k) continue;
    const match = (k.high === p.value || k.low === p.value) ? '✅' : '❌';
    const valueMatch = (p.type === 'high' && Math.abs(k.high - p.value) < 0.01) || (p.type === 'low' && Math.abs(k.low - p.value) < 0.01);
    const diff = p.type === 'high' ? (p.value - k.high).toFixed(4) : (p.value - k.low).toFixed(4);
    pointsHtml += `<div class="point-row ${p.type}">
      <div>${seq}</div>
      <div>${p.date || '?'}</div>
      <div>${p.type}</div>
      <div>${match} P=${p.value.toFixed(4)}</div>
      <div style="color:#888;">K.${p.type}=${p.type === 'high' ? k.high.toFixed(4) : k.low.toFixed(4)}</div>
      <div style="color:${valueMatch ? '#52c41a' : '#ff4d4f'};">${valueMatch ? '對齊' : '差 ' + diff}</div>
    </div>`;
  }
  pointsHtml += '</div>';

  pointsEl.innerHTML = pointsHtml;
}

// ============================================================
// 凡人話: 主流程 (對齊 testing page 撳跑 algorithm flow)
// ============================================================
let lastChartRefs = null;
let lastVerdict = null;
let lastKlines = null;

async function runZigZag() {
  const codeInput = document.getElementById('input-code');
  let code = codeInput.value.trim();
  const runStatus = document.getElementById('run-status');

  if (!code) {
    runStatus.innerHTML = '❌ 請輸入股票代碼';
    return;
  }

  // 自動補 HK. prefix (對齊 testing page 2026-08-22 07:25)
  if (/^\d{5,6}$/.test(code)) {
    code = `HK.${code}`;
    codeInput.value = code;
  }

  runStatus.innerHTML = `⏳ 撈緊 K 線數據 + 跑後台 ZigZag 算法...`;

  try {
    // 1. 拎 K 線 (對齊 testing page 撳跑 algorithm: fetch /api/kline)
    const klineUrl = `${BACKEND_URL}/api/kline?code=${encodeURIComponent(code)}&period=1d&count=1260`;
    const klineResp = await fetch(klineUrl);
    if (!klineResp.ok) {
      throw new Error(`K 線 API 出錯: ${klineResp.status}`);
    }
    const klineData = await klineResp.json();
    const klines = klineData.klines || klineData.data || klineData;
    if (!Array.isArray(klines) || klines.length === 0) {
      throw new Error('後端冇返 K 線數據');
    }
    const actualCount = klineData.actual_count ?? klines.length;

    runStatus.innerHTML = `✅ 已攞到 ${actualCount} 日 K 線 · 跑緊後台 ZigZag...`;

    // 2. 拎 threshold mode / lookback / manual threshold (從 localStorage)
    const mode = getThresholdMode();
    const lookback = getLookback();
    const manualThreshold = getManualThreshold();

    // 3. fetch 新後台 endpoint
    const startTime = performance.now();
    const verdict = await fetchZigzagTestingBackend(code, '1d', {
      thresholdMode: mode,
      lookback,
      manualThreshold: mode === 'manual' ? manualThreshold : null,
    });
    const endTime = performance.now();

    if (!verdict.ok) {
      throw new Error(verdict.error || '後台 ZigZag 失敗');
    }

    runStatus.innerHTML = `✅ 跑完 · ${verdict.klines_count} 日 K 線 · ${verdict.sequence_count} 個 P 點 · threshold=${verdict.threshold}% (${verdict.threshold_mode}) · 用咗 ${(endTime - startTime).toFixed(0)} 毫秒`;

    // 4. Render chart + overlay + debug
    lastVerdict = verdict;
    lastKlines = klines;
    const chartRefs = renderChart(klines);
    lastChartRefs = chartRefs;
    renderZigZagOverlay(verdict, chartRefs);
    renderDebugPanel(verdict, chartRefs);

    // 5. 顯示對比 panel
    document.getElementById('compare-panel').style.display = 'block';

    // 6. 顯示 stock name (對齊 testing page updateStockNameDisplay)
    try {
      const stockResp = await fetch(`${BACKEND_URL}/api/stocks/${encodeURIComponent(code)}`);
      if (stockResp.ok) {
        const stockData = await stockResp.json();
        const name = stockData?.name;
        const displayEl = document.getElementById('stock-name-display');
        if (displayEl) {
          displayEl.textContent = name ? `· ${code} ${name}` : `· ${code}`;
        }
      }
    } catch (e) {
      const displayEl = document.getElementById('stock-name-display');
      if (displayEl) displayEl.textContent = `· ${code}`;
    }
  } catch (err) {
    runStatus.innerHTML = `❌ ${err.message}`;
    console.error(err);
  }
}

// ============================================================
// 凡人話: 初始化 UI + event handlers (對齊 testing page 4.28.0/4.31.0)
// ============================================================
function initUI() {
  // 初始化 threshold mode (radio)
  const mode = getThresholdMode();
  if (mode === 'manual') {
    document.getElementById('mode-manual').checked = true;
    document.getElementById('auto-mode-info').style.display = 'none';
    document.getElementById('manual-mode-info').style.display = 'inline';
  } else {
    document.getElementById('mode-auto').checked = true;
    document.getElementById('auto-mode-info').style.display = 'inline';
    document.getElementById('manual-mode-info').style.display = 'none';
  }

  // 初始化 lookback
  document.getElementById('lookback-input').value = getLookback();

  // 初始化 manual threshold
  document.getElementById('manual-threshold-input').value = getManualThreshold();

  // Mode 切換 handler
  document.getElementById('mode-auto').addEventListener('change', () => {
    setThresholdMode('auto');
    document.getElementById('auto-mode-info').style.display = 'inline';
    document.getElementById('manual-mode-info').style.display = 'none';
    if (lastVerdict) runZigZag(); // 即時重跑
  });
  document.getElementById('mode-manual').addEventListener('change', () => {
    setThresholdMode('manual');
    document.getElementById('auto-mode-info').style.display = 'none';
    document.getElementById('manual-mode-info').style.display = 'inline';
    if (lastVerdict) runZigZag(); // 即時重跑
  });

  // Lookback 改動 handler (永遠儲, auto mode 觸發重算)
  const lookbackInput = document.getElementById('lookback-input');
  lookbackInput.addEventListener('input', () => {
    const v = parseInt(lookbackInput.value, 10);
    if (Number.isFinite(v) && v >= LOOKBACK_MIN && v <= LOOKBACK_MAX) {
      setLookback(v);
      // Auto mode 觸發重算 (對齊 testing page 4.31.0)
      if (getThresholdMode() === 'auto' && lastVerdict) {
        // Debounce 200ms (對齊 testing page 永久 rule)
        clearTimeout(lookbackInput._debounce);
        lookbackInput._debounce = setTimeout(() => {
          runZigZag();
        }, 200);
      }
    }
  });

  // 重置 lookback 掣
  document.getElementById('reset-lookback-btn').addEventListener('click', () => {
    setLookback(LOOKBACK_DEFAULT);
    document.getElementById('lookback-input').value = LOOKBACK_DEFAULT;
    if (getThresholdMode() === 'auto' && lastVerdict) runZigZag();
  });

  // Manual threshold 改動 handler
  const manualInput = document.getElementById('manual-threshold-input');
  manualInput.addEventListener('input', () => {
    const v = parseFloat(manualInput.value);
    if (Number.isFinite(v) && v >= 1 && v <= 20) {
      setManualThreshold(v);
      // Manual mode 觸發重算
      if (getThresholdMode() === 'manual' && lastVerdict) {
        clearTimeout(manualInput._debounce);
        manualInput._debounce = setTimeout(() => {
          runZigZag();
        }, 200);
      }
    }
  });

  // 重置 manual 掣
  document.getElementById('reset-manual-btn').addEventListener('click', () => {
    setManualThreshold(MANUAL_THRESHOLD_DEFAULT);
    document.getElementById('manual-threshold-input').value = MANUAL_THRESHOLD_DEFAULT;
    if (getThresholdMode() === 'manual' && lastVerdict) runZigZag();
  });

  // 跑 ZigZag 掣
  document.getElementById('run-btn').addEventListener('click', runZigZag);

  // 重算掣
  document.getElementById('recalc-btn').addEventListener('click', () => {
    if (lastVerdict) runZigZag();
  });

  // 顯示 sequence toggle 即時 update
  document.getElementById('show-sequence').addEventListener('change', () => {
    if (lastVerdict && lastChartRefs) {
      renderZigZagOverlay(lastVerdict, lastChartRefs);
    }
  });
  document.getElementById('sequence-max-count').addEventListener('input', () => {
    if (lastVerdict && lastChartRefs) {
      renderZigZagOverlay(lastVerdict, lastChartRefs);
    }
  });

  // 股票代碼 input 按 Enter 觸發跑
  document.getElementById('input-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runZigZag();
    }
  });
}

// ============================================================
// 凡人話: Page load 啟動
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  initUI();
  // 自動跑一次 (大少 trigger: 新股票都會自動跑一次)
  runZigZag();
});

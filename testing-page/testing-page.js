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
// adapterExport (optional): 如果 adapter.mjs export 多過一個 adapter，
//   用呢個 field 指定要攞邊一個 named export
//   例: adapterExport: 'volumePriceAdapter' 會取 adapter.volumePriceAdapter
const REGISTRY = [
  {
    id: 'AS-03',
    folder: 'AS-03-cycle-detection',
    adapterPath: '../algorithms/AS-03-cycle-detection/adapter.mjs',
    // 預設 = 頂層 exports (向後兼容 ma-alignment adapter)
  },
  {
    id: 'AS-03-VP',
    folder: 'AS-03-cycle-detection',
    adapterPath: '../algorithms/AS-03-cycle-detection/adapter.mjs',
    adapterExport: 'volumePriceAdapter',  // 大少 #10809 — Module 5 VolumePrice
  },
  {
    id: 'AS-03-SM',
    folder: 'AS-03-cycle-detection',
    adapterPath: '../algorithms/AS-03-cycle-detection/adapter.mjs',
    adapterExport: 'slopeMomentumAdapter', // 大少 #10809 — Module 8 SlopeMomentum
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

async function init() {
  // 清空 default option
  algorithmSelect.innerHTML = '';

  for (const algo of REGISTRY) {
    try {
      const mod = await import(algo.adapterPath);
      // 如果有 adapterExport, 用 named export; 否則用 default exports
      algo.adapter = algo.adapterExport ? mod[algo.adapterExport] : mod;
      const option = document.createElement('option');
      option.value = algo.id;
      option.textContent = `${algo.id} — ${algo.adapter.name} (v${algo.adapter.version})`;
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
    algoInfo.innerHTML = '<p style="color: red;">⚠️ 冇 algorithm 載到成功</p>';
  }
}

async function onAlgorithmChange() {
  const algo = REGISTRY.find((a) => a.id === algorithmSelect.value);
  if (!algo || !algo.adapter) {
    algoInfo.innerHTML = '<p style="color: red;">呢個 algorithm 未載到</p>';
    algoHelp.innerHTML = '';
    inputsForm.innerHTML = '';
    return;
  }

  currentAdapter = algo.adapter;

  // Algo info
  algoInfo.innerHTML = `
    <h3>${currentAdapter.name}</h3>
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
    runStatus.innerHTML = '❌ 冇選擇 algorithm';
    return;
  }

  if (!currentOptions.code) {
    runStatus.innerHTML = '❌ 請揀 / 輸入股票代碼';
    return;
  }

  runStatus.innerHTML = '⏳ 攞緊 K 線...';
  resultPanel.innerHTML = '';

  try {
    // 1. Fetch K 線 from backend
    const code = currentOptions.code;
    const period = currentOptions.period || '1d';
    const count = currentOptions.dataWindowDays || 100;

    const klineUrl = `${BACKEND_URL}/api/kline?code=${encodeURIComponent(code)}&period=${period}&count=${count}`;
    const klineResp = await fetch(klineUrl);

    if (!klineResp.ok) {
      throw new Error(`Backend error: ${klineResp.status} ${klineResp.statusText}`);
    }

    const klineData = await klineResp.json();
    const klines = klineData.klines || klineData.data || klineData;

    if (!Array.isArray(klines) || klines.length === 0) {
      throw new Error(`Backend 冇返 K 線數據 (got ${typeof klines})`);
    }

    runStatus.innerHTML = `✅ 攞到 ${klines.length} 日 K 線 · 跑算法中...`;

    // 2. Run algorithm
    const startTime = performance.now();
    const verdict = await currentAdapter.analyze(klines, currentOptions);
    const endTime = performance.now();

    runStatus.innerHTML = `✅ 完成 · ${klines.length} 日 · ${(endTime - startTime).toFixed(0)}ms`;

    // 3. Render result
    if (currentAdapter.renderResult) {
      resultPanel.innerHTML = currentAdapter.renderResult(verdict);
    } else {
      resultPanel.innerHTML = `<pre>${JSON.stringify(verdict, null, 2)}</pre>`;
    }

    // 4. 大少 #10431 — 撳完 test 後 render K 線圖表（full width）
    renderChart(klines, code, period);
  } catch (err) {
    runStatus.innerHTML = `❌ ${err.message}`;
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
    container.innerHTML = '<div class="chart-placeholder">❌ lightweight-charts 未載到 (CDN fail)</div>';
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
}

// ===== Event listeners =====

algorithmSelect.addEventListener('change', onAlgorithmChange);
runBtn.addEventListener('click', runAlgorithm);

inputsForm.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runAlgorithm();
  }
});

// ===== Start =====

init();
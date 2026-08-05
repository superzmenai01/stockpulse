# StockPulse Algorithm Testing Page — Registry

> 加新 algorithm 只需要兩步：
> 1. 喺 `~/stockpulse/algorithms/AS-XX-xxx/` 寫 `adapter.mjs`
> 2. 喺 `testing-page.js` 嘅 `REGISTRY` 加 1 行

## Algorithm List

| ID | Folder | Adapter | Status |
|----|--------|---------|--------|
| AS-03 | `AS-03-cycle-detection` | `adapter.mjs` | ✅ v0.3.0（ma-alignment done，19/19 tests）|
| AS-04+ | TBD | TBD | ⏳ 等 algorithm 設計 |

## Adapter Interface（永久 Contract — 所有 AS-XX 都要 implement）

```javascript
export const id = 'AS-03';                    // 唯一 ID
export const name = '股票周期判定';            // 顯示名
export const version = '0.3.0';               // 版本
export const description = '...';             // 一句解釋

export const inputs = [
  {
    key: 'code',
    label: '股票代碼',
    type: 'string',                            // 'string' | 'number' | 'select'
    required: true,
    placeholder: 'HK.00981',
    default: undefined,
    options: undefined,                        // for type='select': [{value, label}, ...]
    min: undefined,                            // for type='number'
    max: undefined,                            // for type='number'
    step: undefined,                           // for type='number'
  },
  // ...
];

export async function analyze(klines, options) {
  // klines: [{ timestamp, open, high, low, close, volume }, ...]
  // options: 從 inputs form 收嘅 values
  // return: verdict (arbitrary shape)
}

export function renderResult(verdict) {
  // return: HTML string
}

export function getHelp() {
  // optional — return: HTML string
}
```

## Quick Start

```bash
# Option A: double-click start.command
open ~/stockpulse/testing-page/start.command

# Option B: manual
cd ~/stockpulse/testing-page
python3 -m http.server 8765

# Browser: http://localhost:8765/
```

## Backend Integration

Testing page fetch K 線 from StockPulse backend：

```
Backend: http://localhost:18792
Endpoint: GET /api/kline?code=HK.00981&period=1d&count=100

Response shape（其中之一）：
{
  klines: [{ timestamp, open, high, low, close, volume }, ...],
  cached: bool,
  fetch_count: int
}
// or
{
  data: [...],
  ...
}
// or
[ {...}, {...} ]
```

Adapter `analyze()` 期望 klines 係 `[{timestamp, open, high, low, close, volume}, ...]` 格式。

## 加新 Algorithm 嘅 3 步

1. **寫 adapter.mjs**：
   ```bash
   mkdir -p ~/stockpulse/algorithms/AS-04-xxx/
   # 寫 adapter.mjs 跟上述 interface
   ```

2. **加去 registry**：
   ```javascript
   // testing-page.js
   const REGISTRY = [
     { id: 'AS-03', folder: 'AS-03-cycle-detection', adapterPath: '...' },
     { id: 'AS-04', folder: 'AS-04-xxx', adapterPath: '../algorithms/AS-04-xxx/adapter.mjs' },
   ];
   ```

3. **Refresh testing page**：瀏覽器 reload (`Cmd+R`)

完成。新 algorithm 自動出現喺 dropdown。

## Permanent Rules

- ✅ 所有 adapter 用 ES modules（`.mjs`）
- ✅ Backend CORS 已 enable `allow_origins=["*"]`（開發階段）
- ✅ Port 8765 reserved for testing page
- ✅ `start.command` 啟動前會 kill 現有 process on port 8765
- ❌ 唔好直接改 `testing-page.js`（generic framework）
- ❌ 唔好將 testing page 放喺 `web/`（Vite conflict）
- ❌ 唔好將 adapter.mjs 放喺 `testing-page/`（algorithm 自己 folder）
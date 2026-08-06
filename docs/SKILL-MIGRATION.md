# SKILL-MIGRATION.md · 由 StockPulse Algorithm 轉做 OpenClaw Skill

> **作者**: Main Agent (Plan B execution)
> **對象**: StockPulse AS-XX algorithm developers
> **日期**: 2026-08-06
> **對應 trigger**: 大少 #10901, #10922

---

## 🎯 目標

將 StockPulse AS-XX algorithm（例如 AS-03 均線系統週期判斷法）變成可獨立 distribute 嘅 **OpenClaw Skill**，可以：

1. 喺 OpenClaw 環境 invoke (`/skill run <skill-name>`)
2. Publish 去 ClawHub (`clawhub` skill)
3. Standalone 用 CLI / Node.js require
4. 包埋 tests + config + docs

---

## 📦 OpenClaw Skill 結構

```
my-skill/
├── SKILL.md                  # Frontmatter + docs
├── bin/
│   └── analyze.js            # CLI entry point
├── algorithms/
│   └── ma-alignment.ts       # Single source of truth
├── config/
│   └── defaults.json         # Default config
├── __tests__/
│   └── analyze.test.mjs      # Tests
├── package.json               # Dependencies
└── README.md                 # User-facing docs
```

### SKILL.md Frontmatter (必填)
```markdown
---
name: as-03-moving-average-cycle
description: 均線系統週期判斷法 — 識別股票當前所處周期 (UP/DOWN/SIDEWAYS/TRANSITION)
version: 1.0.0
author: 大少 + StockPulse team
license: MIT
---

# AS-03 · 均線系統週期判斷法

## Usage
```
/skill run as-03-moving-average-cycle --stock=HK.00981 --period=1d
```

## Output
```json
{
  "stock": "HK.00981",
  "state": "UP",
  "confidence": 0.7,
  "interpretation": "上升勢 — 強勢升"
}
```
```

---

## 🔄 Migration Step-by-Step

### Step 1: 整理 Single Source of Truth

**問題**: 而家 StockPulse 有 `.ts` (backend) + `.mjs` (testing page adapter) 雙重實作，會 drift。

**解決**:
```bash
# 1. Backend `.ts` 變 single source of truth
cp ~/stockpulse/algorithms/AS-03-cycle-detection/modules/ma-alignment.ts \
   my-skill/algorithms/ma-alignment.ts

# 2. 確保 standalone — 移除 import path 依賴
# 由 `import type { CycleContext, CycleVerdict } from '../types.ts'`
# 改做 `import type { ... } from './types.ts'` (相對 import)

# 3. 確保 `tsc --target es2020 --module es2020 --outDir dist` 可以 compile
npx tsc --target es2020 --module es2020 --outDir dist
```

### Step 2: 寫 `bin/analyze.js` CLI entry point

```javascript
#!/usr/bin/env node
// my-skill/bin/analyze.js
import { analyze } from '../dist/algorithms/ma-alignment.js';

const args = process.argv.slice(2);
const options = parseArgs(args);

// CLI: analyze.js --stock=HK.00981 --period=1d --volume=on --slope=off
const stock = options.stock;
const period = options.period || '1d';
const enableVolumePrice = options.volume === 'on';
const enableSlopeMomentum = options.slope === 'on';

// Load data from input (JSON file, stdin, 或 API)
const klines = await loadKlines(stock, period);

// Run algorithm
const verdict = await analyze(klines, {
  enableFlags: {
    'ma-alignment': true,
    'volume-price': enableVolumePrice,
    'slope-momentum': enableSlopeMomentum,
  },
});

console.log(JSON.stringify({
  stock,
  state: verdict.state,
  confidence: verdict.confidence,
  interpretation: verdict.interpretation,
}, null, 2));
```

### Step 3: 包埋 Config Defaults

```json
// my-skill/config/defaults.json
{
  "maAlignment": {
    "dataWindowDays": 100,
    "minDataDays": 90,
    "consecutiveDays": 5,
    "reversalWindowDays": 7,
    "chanceThresholdPct": 0.02,
    "chanceWindowDays": 5,
    "chanceConfidenceBonus": 0.10
  },
  "volumePrice": {
    "consecutiveDays": 5,
    "volumeLookback": 20,
    "boostThreshold": 1.2,
    "shrinkThreshold": 0.8,
    "obvLookback": 5,
    "divergenceCorrelation": -0.5
  },
  "slopeMomentum": {
    "shortPeriod": 5,
    "midPeriod": 10,
    "longPeriod": 20,
    "shortSlopeThreshold": 0.005,
    "midSlopeThreshold": 0.003,
    "longSlopeThreshold": 0.002,
    "reversalWindow": 5
  },
  "enableFlags": {
    "maAlignment": true,
    "volumePrice": true,
    "slopeMomentum": false,
    "hlStructure": true,
    "trendline": true,
    "indicators": true
  }
}
```

### Step 4: 包埋 Tests

```javascript
// my-skill/__tests__/analyze.test.mjs
import { analyze } from '../dist/algorithms/ma-alignment.js';
import { test } from 'node:test';

test('上升勢 — 連續 5 日 MA5 > MA60', async () => {
  const klines = generateUptrend();
  const verdict = await analyze(klines, { symbol: 'TEST' });
  assert.strictEqual(verdict.state, 'UP');
  assert.strictEqual(verdict.confidence >= 0.7, true);
});

test('下跌勢 — 連續 5 日 MA5 < MA60', async () => {
  // ...
});
```

### Step 5: Publish 去 ClawHub

```bash
# 用 clawhub skill
clawhub publish my-skill/ \
  --name="as-03-moving-average-cycle" \
  --description="均線系統週期判斷法" \
  --category="finance/trading" \
  --tags="stock,cycle-detection,technical-analysis"

# Verify
clawhub search "moving average cycle"
```

---

## 🔒 永久 Rules（從 AS-03 v0.3.0 學到）

### 1. Algorithm 必須支援雙入口
- **策略頁面** (StockPulse web UI)
- **結果庫頁面** (StockPulse saved runs)
- → 不過 Skill 只需要 CLI 一個入口

### 2. AI Provider 必須用 abstraction layer
- 將來 Algorithm 可能用 LLM 做 signal interpretation
- 唔好 hard-code provider
- 用 `LLMProvider` abstraction（implementations: minimax / Kimi / Claude）

### 3. 財務 threshold 必須引自 Research File
- 將來 calibration 改 config.ts 唔使改 code
- 大少 D005 rule：threshold 集中 config.ts

### 4. Algorithm 必須做強 type checking
- KLine, CycleState, CycleVerdict 等 core types 集中 `types.ts`
- 唔好 hard-code strings
- 將來 refactor 安全

### 5. 用 rule-based + list all matched rules
- 大少 default「全部都顯示」
- Synthesizer 用 expert-rules combine
- 唔做 multiplicative modifier (#10332)

### 6. Testing page 自己 render chart
- testing page 用 CDN lightweight-charts v4.2.3
- 唔 iframe embed StockPulse
- Skill CLI 一樣，自己 load data 自己 render

### 7. Backend `.ts` 變 single source of truth
- 唔好有 `.ts` + `.mjs` 雙重實作
- Build script: `tsc --target es2020 --module es2020`

---

## 📊 Reference Implementation: `futu-stock@1.0.4`

已 install 喺 OpenClaw (`/opt/homebrew/lib/node_modules/openclaw/skills/...`)

| 元素 | 對比 |
|---|---|
| SKILL.md frontmatter | ✅ 同樣格式 |
| bin/ CLI | ✅ 但 futu-stock 用 wrapper script 唔係 Node.js |
| Algorithm | ❌ N/A — futu-stock 係 API wrapper，唔係 algorithm |
| Tests | ❌ 唔包 tests (只係 API call wrapper) |
| Publish | ✅ 用 `clawhub` skill |

**Lesson**: `futu-stock` 簡單但唔包 tests — 我哋嘅 AS-03 Skill 應該包 tests 做 evidence。

---

## 🛠️ 預計工作量

| Task | 時間 |
|---|---|
| Step 1: 整理 single source of truth | 1-2 小時 |
| Step 2: 寫 bin/analyze.js CLI | 1 小時 |
| Step 3: 包 config defaults | 30 分鐘 |
| Step 4: 包 tests | 1 小時 |
| Step 5: Publish 去 ClawHub | 30 分鐘 |
| Documentation + README | 1 小時 |
| **Total** | **~5-6 小時** |

可以分階段做：
- **MVP (Step 1-3)**: ~3 小時 (Algorithm + CLI + Config)
- **Full (Step 1-5 + Docs)**: ~5-6 小時 (加 Tests + Publish + Docs)

---

## ✅ Definition of Done

1. ✅ Skill 可以 `clawhub install as-03-moving-average-cycle`
2. ✅ CLI `analyze.js --stock=HK.00981` 跑得到 verdict
3. ✅ Tests `node --test __tests__/` 全 pass (跟 AS-03 嘅 119 assertions)
4. ✅ SKILL.md frontmatter 完整
5. ✅ README + docs 詳盡
6. ✅ 0 external dependencies (除咗 Node.js stdlib)

---

## 🔗 Related Docs

- `~/stockpulse/algorithms/AS-03-cycle-detection/` — 完整 reference implementation
- `~/stockpulse/docs/research/AS-03-cycle-detection/MODULE-01-MA-ALIGNMENT.md` — Module 1 spec
- `~/stockpulse/docs/research/AS-03-cycle-detection/MODULE-05-VOLUME-PRICE.md` — Module 5 spec
- `~/stockpulse/docs/research/AS-03-cycle-detection/MODULE-07-SYNTHESIZER.md` — Module 7 spec
- `~/stockpulse/docs/research/AS-03-cycle-detection/MODULE-08-SLOPE-MOMENTUM.md` — Module 8 spec
- `~/stockpulse/algorithms/AS-03-cycle-detection/DECISIONS.md` — D001-D020 ADR
- `~/.openclaw/workspace-main/STOCKPULSE_REFERENCE.md` — 永久 rules

---

**Status**: Draft v0.1 (Plan B execution)
**對應 trigger**: 大少 #10901 (16:41:29 GMT+8) — 「有沒有足夠的註解你下次睇返做Skill時可以清楚明白點做？」
**大少 follow-up**: 「Plan b go」(17:03:20 GMT+8) — main agent 自己 quick write 4 spec doc
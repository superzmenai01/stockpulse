# AS-03 · 模組警告系統 (Module Warning System v1.2.0)

> **對應 spec**: `docs/research/AS-03-cycle-detection/MODULE-{01..12}-*.md` (各 module 個別 spec)
> **對應 impl**:
> - Backend: `backend/services/warning_collector.py` (統一收集 + dedupe + 排序)
> - Frontend: `algorithms/AS-03-cycle-detection/lib/warnings.ts` (TS schema) + `adapter.mjs` (收集 + render)
> - UI: `testing-page/` 頂部 `WarningBanner` + 個別 verdict card `WarningCard`
>
> **建立日期**: 2026-08-11 (大少 trigger 「我想加一個警告提示」)
> **版本**: 1.0.0
> **永久 rule**: 「全部 module 都要有 `_warnings` inlined 入 verdict」(AGENTS.md 永久 rule)

---

## 1. 點解呢個系統 (Why)

StockPulse 現有 12 個 modules (M1-M12) + 7 個 adaptive params + zmen 算法,每個 module 喺 backend 計算 / frontend render 階段都可能出問題:
- 數據不足 (klines count 唔夠, 富途 API 限制)
- 計算 NaN / Infinity (除以 0, 對數 0, etc.)
- verdict 拎唔到 (try-catch fallback, m1Verdict null 等)
- 數值 outlier (RSI 超出 [0,1], ATR% > 30%)
- 配置 defaults (用咗 fallback 值, 未用戶自訂)
- cache 過期 (7 日 L2 cache, 過期會自動 re-calibrate)

**問題**: 大少喺 testing page 跑算法時見到 verdict 唔啱, 但唔知邊度出問題, 要逐個 module 查 source code, 慢。

**解決**: Meta-system 警告層 — 每個 module 喺 verdict 入面 inline `_warnings` array, 顯示喺 testing page 頂部 banner + 個別 verdict card 內部, 大少可以一鍵 Copy 警告畀 Mavis, Mavis 立即知道問題 + 修復方法。

---

## 2. 警告層級 (Severity Levels)

| 層級 | Icon | 顏色 | 意思 | 例子 |
|---|---|---|---|---|
| 🔴 Critical | 🔴 | 紅 `#EE5151` | 阻擋 verdict 計算, 結果唔可信 | kline count < minDataDays, m1Verdict null, computeMA NaN, cache invalid |
| 🟡 Warning | 🟡 | 黃 `#FAAD14` | verdict 計算到但有偏差, 結果 partial | 1 個 module 拎唔到 (剩 5 個), RSI > 1 (outlier), 0 validate samples, post failed |
| 🔵 Info | 🔵 | 藍 `#1890ff` | 提示性, 唔影響結果 | cache 7 日內過期, 用咗 default config, 數據舊 (> 1 日) |

**3 層級設計理由** (大少 09:55 揀):
- 比 2 層多咗 Info 提示 (cache 快過期、config defaults) 對用戶體驗重要
- 比 1 層好分類嚴重性, 大少一眼分到邊啲 critical 要即時修

---

## 3. 警告 Schema (ModuleWarning Interface)

### TypeScript (前端用)
```typescript
// algorithms/AS-03-cycle-detection/lib/warnings.ts
export type WarningLevel = 'critical' | 'warning' | 'info';

export type WarningCode =
  // 🔴 Critical (5)
  | 'INSUFFICIENT_DATA'        // kline count < minDataDays
  | 'VERDICT_MISSING'          // module verdict 拎唔到
  | 'NAN_RESULT'               // 計算結果係 NaN / Infinity
  | 'CACHE_INVALID'            // L2 cache 過期 / 損壞
  | 'KLINE_MISSING'            // klines array 空 / undefined
  // 🟡 Warning (7)
  | 'MODULE_PARTIAL'           // 6 個 module 入面拎唔到 1+ 個
  | 'OUTLIER_VALUE'            // 數值超出合理範圍 (RSI > 1, ATR% > 30%)
  | 'LOW_SAMPLE_SIZE'          // M9 0 validate samples / 樣本太少
  | 'THRESHOLD_BREACH'         // 數值超出 threshold (e.g. Hurst > 0.95 強趨勢)
  | 'CONFLICT_STATE'           // 2 個 module state 衝突 (m1 UP + zmen DOWN)
  | 'POST_FAILED'              // M9 forward return POST 失敗
  | 'FALLBACK_USED'            // verdict 拎唔到, 用 fallback (default / 其他 module)
  // 🔵 Info (3)
  | 'CACHE_EXPIRING'           // L2 cache 7 日內過期
  | 'CONFIG_DEFAULTS'          // 用咗 default config, 唔係用戶自訂
  | 'DATA_AGE';                // 數據舊 (last update > 1 日)

export interface ModuleWarning {
  level: WarningLevel;
  module_id: string;            // 'M1' / 'M2' / ... / 'M8' / 'M9' / 'zmen' / 'adaptive-params'
  code: WarningCode;
  message: string;              // 人話描述 (e.g. "MA5 計算結果 NaN")
  debug: {
    issue: string;              // 具體問題 (e.g. "kline count 30 < 100 required")
    impact: string;             // 影響範圍 (e.g. "5 個 module verdict 全部 fallback")
    fix: string;                // 修復建議 (e.g. "增加 dataWindowDays 設定 count=200")
    context: {                  // 相關 data (Copy 畀 Mavis 立即 debug)
      kline_count?: number;
      min_required?: number;
      current_value?: number;
      expected_range?: [number, number];
      related_commits?: string[];
      input_data?: object;
    };
  };
  timestamp: number;            // 探測時間 (Unix ms)
}

// Verdict 入面 warnings 永遠 inlined
export interface VerdictWithWarnings {
  // ... 原有 verdict fields
  _warnings: ModuleWarning[];   // empty array if 0 warnings
}
```

### Python (後端用)
```python
# backend/services/warning_collector.py
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Literal
import time

WarningLevel = Literal['critical', 'warning', 'info']
WarningCode = str  # Same as TS WarningCode

@dataclass
class ModuleWarning:
    level: WarningLevel
    module_id: str
    code: WarningCode
    message: str
    debug: Dict[str, Any]
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {
            'level': self.level,
            'module_id': self.module_id,
            'code': self.code,
            'message': self.message,
            'debug': self.debug,
            'timestamp': int(self.timestamp * 1000),
        }
```

---

## 4. 警告注入位置 (Per Module)

| Module | 注入位置 | 觸發條件 | Level |
|---|---|---|---|
| **M1 MA Alignment** | `runMAAlignment()` return 之前 | klines.length < minDataDays (100) | 🔴 INSUFFICIENT_DATA |
| | `runMAAlignment()` return 之前 | matchedRules 0 個 (全部 A-J rule fail) | 🟡 FALLBACK_USED |
| | `runMAAlignment()` return 之前 | latestMA5 / latestMA20 係 NaN | 🔴 NAN_RESULT |
| **M2 HL Structure** | `detectPeaksTroughs()` return 之前 | peaks.length = 0 AND troughs.length = 0 | 🔴 VERDICT_MISSING |
| | `Step 13 形態預警` return 之前 (v0.3.0) | pattern_alert = head_and_shoulder / double_top / double_bottom | 🟡 CONFLICT_STATE |
| | `Step 15 極值點新鮮度` return 之前 (v0.3.0) | daysAgo > maxExtremeAgeDays (20) | 🔵 DATA_AGE |
| | `Step 16/17 短線 vs 突破 override` return 之前 (v0.3.0) | 5 年 SIDEWAYS 靠短線 / 突破救返 (triggered = True) | 🟡 FALLBACK_USED |
| | `Step 18 信心指數` return 之前 (v0.3.0) | confidence < 0.3 | 🟡 THRESHOLD_BREACH |
| | `Step 14 結構破壞` return 之前 (v0.3.0) | price_position = "broken" | 🟡 CONFLICT_STATE |
| **M3 Trendline** | `computeTrendline()` return 之前 | trendline 計算結果 null | 🟡 FALLBACK_USED |
| **M4 Indicators** | `computeRSI()` return 之前 | rsi 超出 [0, 1] normalized range | 🟡 OUTLIER_VALUE |
| | `computeMACD()` return 之前 | macd 結果 NaN | 🔴 NAN_RESULT |
| **M5 VolumePrice** | `VolumePrice.analyze()` return 之前 | klines 入面 volume 全部 0 | 🟡 OUTLIER_VALUE |
| | `VolumePrice.analyze()` return 之前 | outstanding_shares = 0 (turnover_rate 計唔到) | 🟡 FALLBACK_USED |
| **M6 Volatility** | `computeATR()` return 之前 | ATR% > 30% (極端波動) | 🟡 OUTLIER_VALUE |
| | `computeATR()` return 之前 | ATR% 結果 NaN | 🔴 NAN_RESULT |
| **M7 Synthesizer** | `synthesize()` return 之前 | ssi_score NaN / alignment_score NaN | 🔴 NAN_RESULT |
| | `synthesize()` return 之前 | module_verdicts.length < 6 (1+ 拎唔到) | 🟡 MODULE_PARTIAL |
| | `synthesize()` return 之前 | 兩個 module 衝突 (m1 UP + zmen DOWN) | 🟡 CONFLICT_STATE |
| | `synthesize()` return 之前 (v1.1.0) | M2 self-check warning 觸發 → M7 自動降 weight 0.15→0.05 (5 個 module 等比例 normalize 補返) | 🟡 MODULE_PARTIAL (M2_SKIPPED alias) |
| **M8 Decision Engine** | `analyze()` return 之前 | cycle_synthesizer 係 null | 🔴 VERDICT_MISSING |
| | `analyze()` return 之前 | meta.ma5 OR meta.ma20 係 null | 🔴 NAN_RESULT |
| | `analyze()` return 之前 | 5 個 MA trigger 全部 false (slow market) | 🟡 THRESHOLD_BREACH |
| | `analyze()` return 之前 | adaptive_params null (calibrate fail) | 🔴 CACHE_INVALID |
| | `analyze()` return 之前 | L2 cache 超過 5 日 (7 日內將過期) | 🔵 CACHE_EXPIRING |
| | `analyze()` return 之前 | strategyMode 用咗 default 'position' | 🔵 CONFIG_DEFAULTS |
| **M9 Back Test** | `runWalkForwardCV()` return 之前 | totalValidateSamples = 0 | 🟡 LOW_SAMPLE_SIZE |
| | `runReplay()` 之後 | postErrors.length > 0 (POST 失敗) | 🟡 POST_FAILED |
| | `runWalkForwardCV()` return 之前 | folds.length = 0 | 🔴 VERDICT_MISSING |
| | `analyze()` return 之前 | forwardReturnHistory.length < 3 | 🟡 LOW_SAMPLE_SIZE |
| | `analyze()` return 之前 | dataWindowDays 用咗 default 1260 | 🔵 CONFIG_DEFAULTS |
| **M10 SlopeMomentum** | `computeSlope()` return 之前 | slopeMA5 / slopeMA20 NaN | 🔴 NAN_RESULT |
| **M11 Timeline** | `renderTimelineResult()` return 之前 | timeline 全部 empty (0 events) | 🟡 VERDICT_MISSING |
| | `analyze()` return 之前 | last_kline_date > 1 日前 | 🔵 DATA_AGE |
| **M12 Risk-Reward** | (TBD) | R:R ratio < 1.5 (poor risk-reward) | 🟡 THRESHOLD_BREACH |
| **zmen 算法** | `runMAAlignment()` (v0.3.0) return 之前 | klines.length < 60 (zmen minDataDays) | 🔴 INSUFFICIENT_DATA |
| **7 個 adaptive params** | per-param 計算之後 | R² < 0.3 (low fit) | 🟡 OUTLIER_VALUE |
| | per-param 計算之後 | Hurst > 0.95 (extreme persistent) | 🟡 THRESHOLD_BREACH |
| | per-param 計算之後 | Kelly 連續 3 次 >= 5% (high vol) | 🔵 CONFIG_DEFAULTS |

---

> ## 🔥 v1.2.0 改動摘要 (2026-09-06)
>
> **觸發原因**: 大少 14:25 問「M2 algorithm 發現有問題或失效, 顯示警告, M7/8/9 唔使用」, 15:08 confirm 做法 A + C 混合
>
> **M2 self-check warning 永久 rule (新增)**:
> - M2 algorithm 加 5 個 self-check 注入點 (Step 13/14/15/16/17 出口位置)
> - 5 個 self-check 條件: 形態預警 (CONFLICT_STATE) / 峰谷太舊 (DATA_AGE) / 5年vs短線矛盾 (FALLBACK_USED) / 信心過低 (THRESHOLD_BREACH) / 結構破壞 (CONFLICT_STATE)
> - 凡人話: M2 算法自己診斷 verdict 係咪可信, 5 個條件 emit system 警告
>
> **M7 weight 折扣永久 rule (做法 A, 新增)**:
> - M7 Synthesizer 拎到 M2 warning → 自動降 M2 base_weight 0.15 → 0.05
> - 5 個其他 module (M1/M3/M4/M5/M6) 等比例 normalize 補返 0.10, sum 仍 = 1.0
> - 凡人話: M2 仲有 vote 但 weight 大減, 大少唔好太信
>
> **M7_SKIPPED warning (做法 C banner 提示, 新增)**:
> - M7 emit 1 個 stock_state `MODULE_PARTIAL` warning 通知 banner「M2 self-check 觸發, 自動降 weight 0.15 → 0.05」
> - 沿用 MODULE_PARTIAL 唔加新 code (對齊 15 個 warning code 永久 rule)
> - 頂部 banner 顯示 🔧 系統警告 (M2 self-check 屬 system category)
> - M2 verdict card 內 WarningCard inline 顯示
> - Copy button 一鍵 copy Markdown 4 樣格式
>
> **M7 meta 字段新增 (frontend display 用)**:
> - `m2_discounted: bool` — M2 有冇觸發 self-check
> - `m2_original_weight: 0.15` — M2 原本 weight
> - `m2_discounted_weight: 0.05` — M2 discount 後 weight
>
> **Propagation chain 已就緒** (唔需要新邏輯):
> - M2 self-check warning → 落 M2 verdict.warnings
> - M2 透過 algorithm_runner 注入 M7 module_verdicts.warnings
> - M7 _aggregate_warnings() 自動 collect + dedupe + 落 M7 verdict.warnings
> - Frontend adapter.mjs synthesize() line 5893-5900 自動 propagate M1-M6 warnings
> - 頂部 renderWarningBanners() 自動 render banner
> - 凡人話: M2 warning 自動走晒成條 chain, 唔需要新嘅 propagation code

---

## 5. 警告 Propagation 流程

```
M1 verdict._warnings
  ↓ push to M7
M7 SynthesizerVerdict._warnings = M1._warnings + M2._warnings + ... + M6._warnings + M7 自己
  ↓ push to M8
M8 DecisionVerdict._warnings = M7._warnings + M8 自己
  ↓ push to M9
M9 BackTestVerdict._warnings = M8._warnings + M9 自己
  ↓ 返回 frontend
testing page 收集 verdict._warnings → 顯示 WarningBanner 頂部 + WarningCard 每個 module
```

**Dedupe 機制**: 同一個 warning (相同 level + module_id + code) 只保留 1 個, 後面唔再 push。

---

## 6. Frontend UI 設計

### 6.1 頂部 WarningBanner (testing page 結果區頂部)

```html
<div class="warning-banner warning-banner-critical">
  <span class="warning-icon">🔴</span>
  <strong>3 個警告</strong> (2 Critical / 1 Warning)
  <button class="warning-toggle">展開</button>
  <div class="warning-list" style="display:none">
    [1] M8 Decision Engine - INSUFFICIENT_DATA (🔴)
    [2] M1 MA Alignment - NAN_RESULT (🔴)
    [3] M9 Back Test - LOW_SAMPLE_SIZE (🟡)
  </div>
</div>
```

### 6.2 個別 module verdict card 內部 WarningCard

```html
<div class="warning-card warning-card-critical">
  <span>🔴</span>
  <strong>INSUFFICIENT_DATA</strong>: kline count 30 < 100 required
  <button class="copy-btn" onclick="copyWarning('warning_1')">📋 Copy</button>
</div>
```

### 6.3 Copy 提示格式 (Markdown 4 樣)

```markdown
🚨 **StockPulse 警告** [🔴 Critical]
- **Module**: M8 Decision Engine
- **Code**: INSUFFICIENT_DATA
- **問題**: kline count 30 < 100 required
- **影響**: 5 個 module verdict 全部 fallback
- **修復建議**: 增加 dataWindowDays 設定 count=200
- **Debug Context**:
  - kline_count: 30
  - min_required: 100
  - current_price: 481.4
  - last_commit: ab894bff (中長線交易卡加現價)
  - input_data: { period: '1d', code: 'HK.00700' }
```

---

## 7. 永久 Rules (AGENTS.md 同步)

- **永久 rule #1**: 「全部 module 都要有 `_warnings` inlined 入 verdict」(本系統建立, AGENTS.md 加)
- **永久 rule #2**: 警告 inlined 入 verdict 但 **唔入 DB table** (避免 storage overhead)
- **永久 rule #3**: WarningBanner 永遠 full show (大少 11:57 永久 rule 延伸)
- **永久 rule #4**: Copy 提示用 Markdown 格式 (Mavis 立即 parse)
- **永久 rule #5**: 警告 dedupe by (level + module_id + code)
- **永久 rule #6**: 🔴 Critical 永遠顯示喺頂部 (排序最先), 🟡 Warning 第二, 🔵 Info 最後

---

## 8. 實施 Phase 進度

| Phase | 內容 | Commit | Status |
|---|---|---|---|
| 1 | Schema spec doc (本 doc) | TBD | 🚧 In progress |
| 2 | Backend `warning_collector.py` + Python modules 注入 | TBD | ⏳ |
| 3 | Frontend `lib/warnings.ts` + adapter.mjs 收集 | TBD | ⏳ |
| 4 | Frontend UI (WarningBanner + WarningCard + Copy button) | TBD | ⏳ |
| 5 | 12 個 module warning code 全面注入 (15 codes) | TBD | ⏳ |
| 6 | Verify (pytest + HK.00700 banner + 製造 Critical 試 Copy) | TBD | ⏳ |
| 7 | Spec Sync #11 (4 份 spec doc + AGENTS.md 永久 rule) | TBD | ⏳ |

---

## 9. 測試案例 (Test Cases)

| 場景 | 預期 Warning | Level |
|---|---|---|
| 跑 HK.00700, count=30 | 無 (正常) | - |
| 跑 HK.00700, count=10 (< 100) | INSUFFICIENT_DATA | 🔴 |
| 跑未知股票 (mock) | VERDICT_MISSING | 🔴 |
| 跑 M9, 0 validate samples | LOW_SAMPLE_SIZE | 🟡 |
| 跑 M8, 5 trigger 全部 false | THRESHOLD_BREACH | 🟡 |
| 跑 M8, 7 日 L2 cache | CACHE_EXPIRING | 🔵 |

---

**Maintainer**: 大少 (zmen) + Mavis
**Created**: 2026-08-11
**Version**: 1.0.0

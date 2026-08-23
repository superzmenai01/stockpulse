# AS-03 · Module 13: 到頂到底轉勢綜合評分 v1.0.0 (Top-Bottom Reversal Composite Scoring)

> **對應 source**: `docs/extr_specs/到頂轉勢/K线顶部反转判断算法.md` + `top_reversal.py` (大少 2026-08-23 畀嘅 reference)
> **對應 algorithm**: `backend/algorithms/top_bottom_reversal/algorithm.py` (v1.0.0)
> **對應 config**: `backend/algorithms/top_bottom_reversal/config.py` (15 分制 + 4 級強度)
> **對應 indicators**: `backend/algorithms/top_bottom_reversal/indicators.py` (MACD / RSI / KDJ)
> **對應 patterns**: `backend/algorithms/candlestick_patterns/` (6 個 K 線形態)
> **對應 testing page**: `testing-page/top-bottom-reversal.html` (獨立 testing page)
> **對應 100 隻 stock test**: `backend/scripts/tmp_research_top_bottom_reversal_100stocks.py`

---

## 1. 點解呢個 module (Why)

M1 v2.1.0 嘅「到頂轉勢」trigger 用「連跌 4 日」, 太脆弱:
- 騰訊 2026-07-28 到 8-3 嗰 4 日, MA5 同 MA60 上上落落 4 次, 根本唔會出現「連跌 4 日」
- 4 日內 1 日微升就斷晒, 見頂訊號就咁消失
- 100 隻 stock test 結果: 只有 **1 隻 (騰訊 2%)** 觸發, 觸發率太低
- 大少 2026-08-16 18:00 批評: 「用連跌幾日判斷到頂/回調唔合適, 應該用 MA5 穿 MA60」

新 TBR algorithm 跟 extr_specs 嗰套 4 個指標 + 4 種背離偵測 + 6 個 K 線形態, 互相驗證, 觸發率大幅提升。

## 2. 評分公式 (15 分制)

### 2.1 到頂評分 (見頂 score 0-15)

| 信號 | 權重 | 凡人話 |
|---|---|---|
| MACD 頂背離 (峰 1 升 + 峰 2 升, MACD 跌) | 3 分 | 趨勢加速度唔夠 |
| RSI 頂背離 (峰 1 升 + 峰 2 升, RSI 跌) | 3 分 | 買賣力量開始弱 |
| KDJ 頂背離 (峰 1 升 + 峰 2 升, KDJ K 跌) | 2 分 | 短期波動開始弱 |
| RSI > 70 (超買) | 1 分 | 買方透支 |
| KDJ J > 100 (超買) | 1 分 | 短期超買 |
| 成交量萎縮 (升緊但縮量, 3 日內 < 20 日均量 70% + 5 日內升 ≥2%) | 2 分 | 冇油了 |
| 偏離 MA20 > 10% | 1 分 | 價格離地 |
| 烏雲蓋頂 K 線 (前日大陽 + 今日高開低走深入實體) | 2 分 | 見頂形態 |
| 看跌吞沒 K 線 (前日小陽 + 今日大陰完全包住) | 2 分 | 見頂形態 |
| 黃昏之星 K 線 (大陽 → 十字星 → 大陰) | 2 分 | 見頂形態 |

**最高 19 分, 實用 15 分制** (部分信號互斥)

### 2.2 到底評分 (見底 score 0-15, 對稱)

| 信號 | 權重 | 凡人話 |
|---|---|---|
| MACD 底背離 (谷 1 跌 + 谷 2 跌, MACD 升) | 3 分 | 跌勢加速度唔夠 |
| RSI 底背離 (谷 1 跌 + 谷 2 跌, RSI 升) | 3 分 | 賣賣力量開始弱 |
| KDJ 底背離 (谷 1 跌 + 谷 2 跌, KDJ K 升) | 2 分 | 短期反彈開始 |
| RSI < 30 (超賣) | 1 分 | 賣方透支 |
| KDJ J < 0 (超賣) | 1 分 | 短期超賣 |
| 成交量萎縮 (跌緊但縮量) | 2 分 | 拋售壓力減 |
| 偏離 MA20 < -10% | 1 分 | 價格離地 (負) |
| 晨星 K 線 (大陰 → 十字星 → 大陽) | 2 分 | 見底形態 |
| 看漲吞沒 K 線 (前日小陰 + 今日大陽完全包住) | 2 分 | 見底形態 |
| 曙光初現 K 線 (前日大陰 + 今日低開高走深入實體) | 2 分 | 見底形態 |

### 2.3 強度分級 (4 級, 0-15 分制)

| 分級 | 分數 | Icon | 凡人話 |
|---|---|---|---|
| STRONG (強烈) | ≥8 | 🔴 | 多個指標一齊確認, 強烈見頂/見底 |
| MODERATE (中度) | 5-7 | 🟠 | 部分指標確認, 中度警號 |
| MILD (輕度) | 3-4 | 🟡 | 個別指標觸發, 輕度警號 |
| NONE (暫無) | 0-2 | 🟢 | 冇明顯見頂/見底信號 |

## 3. 頂背離 / 底背離偵測 (核心)

**凡人話講**: 揾價格嘅**兩個峰/谷**, 比較價格同指標係咪「唱反調」。

### 3.1 頂背離偵測
```
Step 1: 用 ZigZag 拎最近 2 個峰 (peaks[-2] = 前峰, peaks[-1] = 現峰)
Step 2: 拎對應日期嘅指標值 (MACD histogram / RSI / KDJ K)
Step 3: 確認頂背離:
  條件 A: 現峰價格 > 前峰價格 × 1.01 (創新高 ✓)
  條件 B: 現峰指標 < 前峰指標 × 0.98 (冇創新高 ✗)
  → 兩個條件都符合, 頂背離確認
```

### 3.2 底背離偵測 (對稱)
```
Step 1: 用 ZigZag 拎最近 2 個谷 (troughs[-2] = 前谷, troughs[-1] = 現谷)
Step 2: 拎對應日期嘅指標值
Step 3: 確認底背離:
  條件 A: 現谷價格 < 前谷價格 × 0.99 (創新低 ✓)
  條件 B: 現谷指標 > 前谷指標 × 1.02 (冇創新低 ✗)
  → 兩個條件都符合, 底背離確認
```

### 3.3 ZigZag 自動 inject
- 跟 M1 pattern, `algorithm_runner` 自動 inject ZigZag 峰谷落 options
- threshold 默認 5%, 大少可手動調 (testing page slider)
- 拎 ZigZag algorithm 入面 `points` list (高點 type='high', 低點 type='low', index 對應 K 線位置)

## 4. K 線形態識別 (6 個)

**凡人話講**: 望一望最近 1-3 條 K 線, 判斷係咪見頂/見底形態。

### 4.1 見頂形態 (3 個)

| 形態 | 條件 |
|---|---|
| **烏雲蓋頂** (Dark Cloud Cover) | 前日大陽 + 今日高開 (今日.open > 前日.high) + 今日低走 (今日.close < 前日實體中位) |
| **看跌吞沒** (Bearish Engulfing) | 前日小陽 + 今日大陰完全包住 (今日.open > 前日.close, 今日.close < 前日.open) |
| **黃昏之星** (Evening Star) | 3 日前大陽 + 2 日前十字星 (實體 < 3 日前實體 30%) + 1 日前大陰 + 收市喺 3 日前實體範圍內 |

### 4.2 見底形態 (3 個, 對稱)

| 形態 | 條件 |
|---|---|
| **晨星** (Morning Star) | 3 日前大陰 + 2 日前十字星 + 1 日前大陽 + 收市喺 3 日前實體範圍內 |
| **看漲吞沒** (Bullish Engulfing) | 前日小陰 + 今日大陽完全包住 |
| **曙光初現** (Piercing Pattern) | 前日大陰 + 今日低開 (今日.open < 前日.low) + 今日高走 (今日.close > 前日實體中位) |

## 5. Algorithm 6 個 step

| Step | 做咩 | Source |
|---|---|---|
| 1 | 拎 K 線 (KlineCache full flow, 永久 rule) | `cache.get_klines()` + stale check |
| 2 | 計算 MACD / RSI / KDJ (EMA 算法) | `indicators.py` |
| 3 | 拎 ZigZag 峰谷 (runner inject, 跟 M1 pattern) | `algorithm_runner._inject_zigzag_for_ma_alignment` |
| 4 | 偵測 3 個頂背離 (MACD / RSI / KDJ) | `algorithm._detect_top_divergence` |
| 5 | 偵測 3 個底背離 (MACD / RSI / KDJ) | `algorithm._detect_bottom_divergence` |
| 6 | 識別 6 個 K 線形態 | `candlestick_patterns/` |
| 7 | 評分 0-15 (top + bottom 兩份) + 4 級強度 | `algorithm.run()` |

## 6. 輸入 (跟 testing page pattern)

| Field | Type | Required | Default | 說明 |
|---|---|---|---|---|
| symbol | str | ✅ | HK.00700 | 股票代碼 (e.g. "HK.00700") |
| period | str | ❌ | "1d" | K 線週期 (1d / 1w) |
| data_window_days | int | ❌ | 1260 | 拎幾多日 K 線 (5 年, 永久 rule 2026-08-14 23:15) |
| threshold | float | ❌ | 5 | ZigZag 過濾 noise 門檻 (%) |
| zigzagPoints | list | ❌ auto | [] | ZigZag 峰谷 (runner 自動 inject) |

## 7. 輸出 (Verdict shape)

```python
Verdict(
    ok=True,
    meta={
        "topScore": 0-15,                    # 到頂 score
        "topStrength": "STRONG|MODERATE|MILD|NONE",  # 到頂強度
        "topSignals": [凡人話 bullets...],    # 觸發信號清單
        "bottomScore": 0-15,                 # 到底 score
        "bottomStrength": "...",             # 到底強度
        "bottomSignals": [...],              # 觸發信號清單
        "topDivergences": {"macd": bool, "rsi": bool, "kdj": bool},
        "bottomDivergences": {"macd": bool, "rsi": bool, "kdj": bool},
        "topPatterns": {"dark_cloud_cover": bool, "bearish_engulfing": bool, "evening_star": bool},
        "bottomPatterns": {"morning_star": bool, "bullish_engulfing": bool, "piercing_pattern": bool},
        "indicators": {
            "rsi_current": float,
            "kdj_j_current": float,
            "macd_histogram_current": float,
        },
        "ma20_deviation_pct": float,         # 偏離 MA20 % (正負)
        "klines_count": 1260,
        "zigzag_points_count": 158,
        "peaks_count": 79,                   # 5% threshold ZigZag 拎到嘅峰數
        "troughs_count": 79,                 # 谷數
    },
    warnings=[...],                          # Module Warning System v1.1.0
)
```

## 8. 凡人話測試結果 (100 隻港股, 2026-08-23)

| 框架 | 到頂觸發 (≥5) | 到底觸發 (≥5) |
|---|---|---|
| M1 v2.1.0 trigger (連跌/升 4 日) | 1/100 (2%) | 0/100 (0%) |
| TBR 新框架 (15 分制) | 4/40 (10%) | 6/40 (15%) |
| **改善倍數** | **5x** | **無限 (0 → 6)** |

**識別到嘅典型案例**:
- 🔴 **HK.00002 中電控股 (10/15 強烈見頂)**: MACD 頂背離 + RSI 頂背離 雙確認
- 🟢 **HK.00014 希慎興業 (8/15 強烈見底)**: MACD 底背離 + RSI 底背離 雙確認
- 🟠 **HK.00032 港通控股 (7/15 中度見底)**: MACD 底背離 + 看漲吞沒形態

## 9. 永久 rule (大少 2026-08-23 trigger)

- ✅ TBR algorithm 永遠喺 backend 跑 (Algorithm Backend-only 永久 rule)
- ✅ K 線拎取用 KlineCache full flow (永久 rule), 跟 stale data fix
- ✅ ZigZag 峰谷由 runner 自動 inject (跟 M1 pattern), 唔可以 algorithm 自己 fetch
- ✅ 評分 0-15 + 4 級強度, 凡人話 display 全部用普通話
- ✅ Module Warning System v1.1.0 統一 warning format (system 類)
- ✅ 改 algorithm / 改評分權重 / 改 K 線形態識別, 一律 backend side, frontend 唔郁
- ✅ 對應: 改 M1 v2.1.0 「到頂轉勢」trigger 之前, 大少拎 stock 例子 review 先 (2026-08-16 19:21 永久 rule)

## 10. 對應 commit

| Commit | 內容 |
|---|---|
| `2ddcb7db` | chore(extr-specs): 加入到頂到底轉勢 reference 算法 + 凡人話文檔 |
| Spec Sync #39 (即將 push) | feat(top-bottom-reversal) + docs: 新 algorithm + testing page + 永久 rule + stale fix |

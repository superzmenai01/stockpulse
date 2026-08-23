"""
backend/algorithms/top_bottom_reversal/algorithm.py — 到頂到底轉勢綜合評分 (大少 2026-08-23)

凡人話: 拎 K 線 + ZigZag 峰谷 → 計 MACD/RSI/KDJ → 偵測頂底背離 → 識別 6 個 K 線形態 → 評分 0-15 (top + bottom 兩份)

對應 source: docs/extr_specs/到頂轉勢/K线顶部反转判断算法.md (大少 2026-08-23 畀嘅 reference, 15 分制)
對應 spec: docs/research/AS-03-cycle-detection/MODULE-TOP-BOTTOM-REVERSAL.md (即將起)
對應 backup: backups/top-bottom-reversal-2026-08-23/

Algorithm 6 個 step:
  Step 1: 拎 MACD / RSI / KDJ (從 klines 計, EMA 算法)
  Step 2: 拎 ZigZag 峰谷 (從 options.zigzagPoints inject 落嚟, 跟 M1 pattern)
  Step 3: 頂背離偵測 (MACD + RSI + KDJ, 對齊 ZigZag peaks)
  Step 4: 底背離偵測 (MACD + RSI + KDJ, 對齊 ZigZag troughs)
  Step 5: 6 個 K 線形態識別 (烏雲/吞沒/黃昏星 + 晨星/看漲/曙光)
  Step 6: 評分整合 (top 0-15 + bottom 0-15, 4 級強度)

Caller inject pattern:
  - runner service 拎 K 線 (KlineCache full flow)
  - runner service 跑 ZigZag algorithm 拎峰谷
  - runner service 將 zigzagPoints inject 落 options['zigzagPoints']
  - algorithm 拎峰谷 + K 線計分

凡人話: 4 個指標 (MACD/RSI/KDJ/成交量) + 4 種背離偵測 + 6 個 K 線形態, 互相驗證
"""

from typing import List, Dict, Any
import numpy as np

from ..base import Algorithm, Verdict
from ..registry import register
from ..candlestick_patterns import detect_all_top_patterns, detect_all_bottom_patterns
from .config import (
    SCORE_WEIGHTS,
    STRENGTH_THRESHOLDS,
    DIVERGENCE_PARAMS,
    VOLUME_PARAMS,
    MA_DEVIATION_THRESHOLD,
)
from .indicators import calculate_macd, calculate_rsi, calculate_kdj


class TopBottomReversalAlgorithm(Algorithm):
    """到頂到底轉勢綜合評分 algorithm (凡人話 contract)

    收 K 線 + ZigZag 峰谷 (從 options inject) + 自訂參數, 返 Verdict:
    - points: [] (呢個 algorithm 唔直接 return K 線轉向點, return 喺 meta)
    - meta: {topScore, topStrength, bottomScore, bottomStrength, signals, divergences, patterns, indicators}
    - warnings: Module Warning System v1.1.0 格式

    永久 rule (大少 2026-08-23):
    - top + bottom 對稱設計, 兩份獨立 score (0-15)
    - 4 級強度分級 (STRONG ≥8 / MODERATE 5-7 / MILD 3-4 / NONE 0-2)
    - signals list 全部凡人話, 方便 frontend display
    - 拎 ZigZag 峰谷由 caller inject (M1 pattern), algorithm 唔自己 fetch
    """
    name = "top_bottom_reversal"
    version = "1.0.0"

    def run(self, klines: List[Dict[str, Any]], options: Dict[str, Any]) -> Verdict:
        # ============ Step 0: 數據驗證 ============
        if len(klines) < 30:
            return Verdict(
                ok=False,
                error=f"數據太少 ({len(klines)} 條), 至少要 30 條先可以計 MACD/RSI/KDJ"
            )

        try:
            closes = np.array([float(k['close']) for k in klines], dtype=float)
            highs = np.array([float(k['high']) for k in klines], dtype=float)
            lows = np.array([float(k['low']) for k in klines], dtype=float)
            volumes = np.array([float(k.get('volume', 0)) for k in klines], dtype=float)
        except (KeyError, ValueError, TypeError) as e:
            return Verdict(
                ok=False,
                error=f"K 線 data 拎 OHLCV 失敗: {e} (需要每個 kline dict 有 'open' 'high' 'low' 'close' field)"
            )

        n = len(klines)
        warnings = []

        # ============ Step 1: 計算 MACD / RSI / KDJ ============
        macd = calculate_macd(closes)
        rsi = calculate_rsi(closes)
        kdj = calculate_kdj(highs, lows, closes)

        # ============ Step 2: 拎 ZigZag 峰谷 (從 options inject) ============
        zigzag_points = options.get("zigzagPoints", [])

        peaks = []
        troughs = []
        for p in zigzag_points:
            if p.get('type') == 'high':
                peaks.append(p)
            elif p.get('type') == 'low':
                troughs.append(p)

        # ============ Step 3: 頂背離偵測 ============
        top_divergences = {
            "macd": self._detect_top_divergence(peaks, closes, macd['histogram']),
            "rsi": self._detect_top_divergence(peaks, closes, rsi),
            "kdj": self._detect_top_divergence(peaks, closes, kdj['k']),
        }

        # ============ Step 4: 底背離偵測 ============
        bottom_divergences = {
            "macd": self._detect_bottom_divergence(troughs, closes, macd['histogram']),
            "rsi": self._detect_bottom_divergence(troughs, closes, rsi),
            "kdj": self._detect_bottom_divergence(troughs, closes, kdj['k']),
        }

        # ============ Step 5: 6 個 K 線形態識別 ============
        top_patterns = detect_all_top_patterns(klines)
        bottom_patterns = detect_all_bottom_patterns(klines)

        # ============ Step 6a: 評分 (見頂) ============
        top_score = 0
        top_signal_list = []

        if top_divergences['macd']:
            top_score += SCORE_WEIGHTS['macd_top_divergence']
            top_signal_list.append(f"🔴 MACD 頂背離 (峰 {top_divergences['macd']['prev_date']} → {top_divergences['macd']['curr_date']}, 指標 {top_divergences['macd']['indicator_change_pct']:.1f}%)")
        if top_divergences['rsi']:
            top_score += SCORE_WEIGHTS['rsi_top_divergence']
            top_signal_list.append(f"🔴 RSI 頂背離 (峰 {top_divergences['rsi']['prev_date']} → {top_divergences['rsi']['curr_date']}, RSI {top_divergences['rsi']['prev_value']:.1f} → {top_divergences['rsi']['curr_value']:.1f})")
        if top_divergences['kdj']:
            top_score += SCORE_WEIGHTS['kdj_top_divergence']
            top_signal_list.append(f"🟡 KDJ 頂背離 (峰 {top_divergences['kdj']['prev_date']} → {top_divergences['kdj']['curr_date']}, K {top_divergences['kdj']['prev_value']:.1f} → {top_divergences['kdj']['curr_value']:.1f})")

        if rsi[-1] > 70:
            top_score += SCORE_WEIGHTS['rsi_overbought']
            top_signal_list.append(f"🟡 RSI 超買 (現值 {rsi[-1]:.1f} > 70)")
        if kdj['j'][-1] > 100:
            top_score += SCORE_WEIGHTS['kdj_overbought']
            top_signal_list.append(f"🟡 KDJ J 超買 (現值 {kdj['j'][-1]:.1f} > 100)")

        if self._is_volume_shrinking(klines, volumes, top=True):
            top_score += SCORE_WEIGHTS['volume_shrink_top']
            top_signal_list.append("🟡 成交量萎縮 (最近 3 日 < 20 日均量 70%, 5 日內升 ≥2%)")

        ma20 = self._calc_ma(closes, 20)
        ma20_deviation = (closes[-1] - ma20[-1]) / ma20[-1] if ma20[-1] > 0 else 0
        if ma20_deviation > MA_DEVIATION_THRESHOLD:
            top_score += SCORE_WEIGHTS['ma20_deviation_top']
            top_signal_list.append(f"🟡 偏離 MA20 ({ma20_deviation*100:.1f}% > 10%)")

        if top_patterns['dark_cloud_cover']:
            top_score += SCORE_WEIGHTS['dark_cloud_cover']
            top_signal_list.append("🔴 烏雲蓋頂形態 (前日大陽 + 今日高開低走深入實體)")
        if top_patterns['bearish_engulfing']:
            top_score += SCORE_WEIGHTS['bearish_engulfing']
            top_signal_list.append("🔴 看跌吞沒形態 (前日小陽 + 今日大陰完全包住)")
        if top_patterns['evening_star']:
            top_score += SCORE_WEIGHTS['evening_star']
            top_signal_list.append("🔴 黃昏之星形態 (大陽 → 十字星 → 大陰)")

        # ============ Step 6b: 評分 (見底) ============
        bottom_score = 0
        bottom_signal_list = []

        if bottom_divergences['macd']:
            bottom_score += SCORE_WEIGHTS['macd_bottom_divergence']
            bottom_signal_list.append(f"🟢 MACD 底背離 (谷 {bottom_divergences['macd']['prev_date']} → {bottom_divergences['macd']['curr_date']}, 指標 {bottom_divergences['macd']['indicator_change_pct']:.1f}%)")
        if bottom_divergences['rsi']:
            bottom_score += SCORE_WEIGHTS['rsi_bottom_divergence']
            bottom_signal_list.append(f"🟢 RSI 底背離 (谷 {bottom_divergences['rsi']['prev_date']} → {bottom_divergences['rsi']['curr_date']}, RSI {bottom_divergences['rsi']['prev_value']:.1f} → {bottom_divergences['rsi']['curr_value']:.1f})")
        if bottom_divergences['kdj']:
            bottom_score += SCORE_WEIGHTS['kdj_bottom_divergence']
            bottom_signal_list.append(f"🟢 KDJ 底背離 (谷 {bottom_divergences['kdj']['prev_date']} → {bottom_divergences['kdj']['curr_date']}, K {bottom_divergences['kdj']['prev_value']:.1f} → {bottom_divergences['kdj']['curr_value']:.1f})")

        if rsi[-1] < 30:
            bottom_score += SCORE_WEIGHTS['rsi_oversold']
            bottom_signal_list.append(f"🟢 RSI 超賣 (現值 {rsi[-1]:.1f} < 30)")
        if kdj['j'][-1] < 0:
            bottom_score += SCORE_WEIGHTS['kdj_oversold']
            bottom_signal_list.append(f"🟢 KDJ J 超賣 (現值 {kdj['j'][-1]:.1f} < 0)")

        if self._is_volume_shrinking(klines, volumes, top=False):
            bottom_score += SCORE_WEIGHTS['volume_shrink_bottom']
            bottom_signal_list.append("🟢 成交量萎縮 (最近 3 日 < 20 日均量 70%, 5 日內跌 ≥2%)")

        if ma20_deviation < -MA_DEVIATION_THRESHOLD:
            bottom_score += SCORE_WEIGHTS['ma20_deviation_bottom']
            bottom_signal_list.append(f"🟢 偏離 MA20 ({ma20_deviation*100:.1f}% < -10%)")

        if bottom_patterns['morning_star']:
            bottom_score += SCORE_WEIGHTS['morning_star']
            bottom_signal_list.append("🟢 晨星形態 (大陰 → 十字星 → 大陽)")
        if bottom_patterns['bullish_engulfing']:
            bottom_score += SCORE_WEIGHTS['bullish_engulfing']
            bottom_signal_list.append("🟢 看漲吞沒形態 (前日小陰 + 今日大陽完全包住)")
        if bottom_patterns['piercing_pattern']:
            bottom_score += SCORE_WEIGHTS['piercing_pattern']
            bottom_signal_list.append("🟢 曙光初現形態 (前日大陰 + 今日低開高走深入實體)")

        # ============ 強度分級 ============
        top_strength = self._get_strength(top_score)
        bottom_strength = self._get_strength(bottom_score)

        # ============ Warnings (Module Warning System v1.1.0) ============
        if n < 30:
            warnings.append({
                "level": "warning",
                "category": "system",
                "module_id": "top_bottom_reversal",
                "code": "LOW_SAMPLE_SIZE",
                "message": f"只有 {n} 條 K 線, sample size 較細",
                "issue": f"actual klines = {n}, 建議 ≥ 30 條先可信",
                "impact": "Verdict 唔可信, 唔好落單",
                "fix": "Re-run / 加大 dataWindowDays",
                "context": {"actual_count": n, "recommended_min": 30},
            })

        # ============ Meta (畀 frontend 拎) ============
        meta = {
            "topScore": int(top_score),
            "topStrength": top_strength,
            "topSignals": top_signal_list,
            "bottomScore": int(bottom_score),
            "bottomStrength": bottom_strength,
            "bottomSignals": bottom_signal_list,
            "topDivergences": {k: v is not None for k, v in top_divergences.items()},
            "bottomDivergences": {k: v is not None for k, v in bottom_divergences.items()},
            "topPatterns": top_patterns,
            "bottomPatterns": bottom_patterns,
            "indicators": {
                "rsi_current": float(rsi[-1]) if not np.isnan(rsi[-1]) else None,
                "kdj_j_current": float(kdj['j'][-1]) if not np.isnan(kdj['j'][-1]) else None,
                "macd_histogram_current": float(macd['histogram'][-1]) if not np.isnan(macd['histogram'][-1]) else None,
            },
            "ma20_deviation_pct": float(ma20_deviation * 100),
            "klines_count": n,
            "zigzag_points_count": len(zigzag_points),
            "peaks_count": len(peaks),
            "troughs_count": len(troughs),
        }

        return Verdict(
            ok=True,
            meta=meta,
            warnings=warnings,
        )

    # ============================================================
    # Helpers: 背離偵測
    # ============================================================

    def _detect_top_divergence(
        self,
        peaks: List[Dict[str, Any]],
        closes: np.ndarray,
        indicator: np.ndarray,
    ) -> Dict[str, Any] | None:
        """凡人話: 頂背離偵測 — 價格創新高, 指標冇創新高

        用最近 2 個 ZigZag peak 比較:
          - 價格: curr_price > prev_price × 1.01 (創新高 ✓)
          - 指標: curr_indicator < prev_indicator × 0.98 (冇創新高 ✗)
          → 頂背離確認

        Args:
            peaks: ZigZag peak list, 已經按時間順序 (peaks[0] 最舊, peaks[-1] 最新)
            closes: 收市價 array
            indicator: 指標 array (MACD histogram / RSI / KDJ K)

        Returns:
            頂背離 dict (date / price / indicator) 或 None (冇背離)
        """
        if len(peaks) < 2:
            return None

        prev_peak = peaks[-2]  # 倒數第二個 (前峰)
        curr_peak = peaks[-1]  # 最後一個 (現峰)

        prev_idx = prev_peak.get('index')
        curr_idx = curr_peak.get('index')

        if prev_idx is None or curr_idx is None:
            return None
        if prev_idx >= len(closes) or curr_idx >= len(closes):
            return None

        prev_price = float(closes[prev_idx])
        curr_price = float(closes[curr_idx])
        prev_ind = float(indicator[prev_idx])
        curr_ind = float(indicator[curr_idx])

        if np.isnan(prev_ind) or np.isnan(curr_ind):
            return None

        price_threshold = DIVERGENCE_PARAMS['price_change_threshold']
        ind_threshold = DIVERGENCE_PARAMS['indicator_change_threshold']

        # 價格創新高 (1% 確認)
        price_higher = curr_price > prev_price * (1 + price_threshold)
        # 指標冇創新高 (2% 確認跌)
        indicator_lower = curr_ind < prev_ind * (1 - ind_threshold)

        if price_higher and indicator_lower:
            return {
                "prev_date": prev_peak.get('date', ''),
                "curr_date": curr_peak.get('date', ''),
                "prev_price": prev_price,
                "curr_price": curr_price,
                "prev_value": prev_ind,
                "curr_value": curr_ind,
                "price_change_pct": (curr_price - prev_price) / prev_price * 100,
                "indicator_change_pct": (curr_ind - prev_ind) / prev_ind * 100,
            }

        return None

    def _detect_bottom_divergence(
        self,
        troughs: List[Dict[str, Any]],
        closes: np.ndarray,
        indicator: np.ndarray,
    ) -> Dict[str, Any] | None:
        """凡人話: 底背離偵測 — 價格創新低, 指標冇創新低 (頂背離嘅相反)

        用最近 2 個 ZigZag trough 比較:
          - 價格: curr_price < prev_price × 0.99 (創新低 ✓)
          - 指標: curr_indicator > prev_indicator × 1.02 (冇創新低 ✗)
          → 底背離確認

        Args:
            troughs: ZigZag trough list
            closes: 收市價 array
            indicator: 指標 array

        Returns:
            底背離 dict 或 None
        """
        if len(troughs) < 2:
            return None

        prev_trough = troughs[-2]
        curr_trough = troughs[-1]

        prev_idx = prev_trough.get('index')
        curr_idx = curr_trough.get('index')

        if prev_idx is None or curr_idx is None:
            return None
        if prev_idx >= len(closes) or curr_idx >= len(closes):
            return None

        prev_price = float(closes[prev_idx])
        curr_price = float(closes[curr_idx])
        prev_ind = float(indicator[prev_idx])
        curr_ind = float(indicator[curr_idx])

        if np.isnan(prev_ind) or np.isnan(curr_ind):
            return None

        price_threshold = DIVERGENCE_PARAMS['price_change_threshold']
        ind_threshold = DIVERGENCE_PARAMS['indicator_change_threshold']

        # 價格創新低
        price_lower = curr_price < prev_price * (1 - price_threshold)
        # 指標冇創新低
        indicator_higher = curr_ind > prev_ind * (1 + ind_threshold)

        if price_lower and indicator_higher:
            return {
                "prev_date": prev_trough.get('date', ''),
                "curr_date": curr_trough.get('date', ''),
                "prev_price": prev_price,
                "curr_price": curr_price,
                "prev_value": prev_ind,
                "curr_value": curr_ind,
                "price_change_pct": (curr_price - prev_price) / prev_price * 100,
                "indicator_change_pct": (curr_ind - prev_ind) / prev_ind * 100,
            }

        return None

    # ============================================================
    # Helpers: 信號判斷
    # ============================================================

    def _is_volume_shrinking(self, klines: List[Dict[str, Any]], volumes: np.ndarray, top: bool) -> bool:
        """凡人話: 成交量萎縮判斷

        條件:
          - 最近 3 日成交量 < 20 日均量 × 70%
          - 同時 5 日內價格升/跌 ≥ 2% (top = 升, bottom = 跌)

        Args:
            klines: K 線 list
            volumes: 成交量 array
            top: True = 見頂信號 (升緊但縮量), False = 見底信號 (跌緊但縮量)

        Returns:
            True = 觸發成交量萎縮信號
        """
        lookback = VOLUME_PARAMS['lookback_days']
        ma_period = VOLUME_PARAMS['ma_period']
        shrink_ratio = VOLUME_PARAMS['shrink_ratio']
        price_confirm = VOLUME_PARAMS['price_confirm_pct']

        if len(volumes) < ma_period + lookback:
            return False

        # 20 日均量
        vol_ma = np.mean(volumes[-ma_period - lookback:-lookback])
        if vol_ma <= 0:
            return False

        # 最近 3 日成交量全部 < 70% 均量
        recent_volumes = volumes[-lookback:]
        all_shrunk = all(v < vol_ma * shrink_ratio for v in recent_volumes)

        if not all_shrunk:
            return False

        # 5 日內價格變化確認
        if len(klines) < 5:
            return False
        price_change = (float(klines[-1]['close']) - float(klines[-5]['close'])) / float(klines[-5]['close'])

        if top:
            return price_change >= price_confirm  # 升 ≥ 2%
        else:
            return price_change <= -price_confirm  # 跌 ≥ 2%

    def _calc_ma(self, values: np.ndarray, period: int) -> np.ndarray:
        """凡人話: 簡單移動平均線 (SMA) — 拎最近 N 日平均值"""
        ma = np.zeros_like(values, dtype=float)
        for i in range(len(values)):
            start = max(0, i - period + 1)
            ma[i] = np.mean(values[start:i + 1])
        return ma

    def _get_strength(self, score: int) -> str:
        """凡人話: 拎返 score 對應嘅強度分級"""
        if score >= STRENGTH_THRESHOLDS['STRONG']:
            return "STRONG"
        elif score >= STRENGTH_THRESHOLDS['MODERATE']:
            return "MODERATE"
        elif score >= STRENGTH_THRESHOLDS['MILD']:
            return "MILD"
        else:
            return "NONE"


# 自動 register 落 framework (凡人話: import 呢個 file 就自動 register)
register(TopBottomReversalAlgorithm())

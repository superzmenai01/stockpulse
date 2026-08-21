"""
backend/algorithms/zigzag/algorithm.py — ZigZag algorithm (大少 2026-08-20 Phase 1)

凡人話: 拎 K 線 → 拎有意義嘅 Peak (頂) / Trough (底), 過濾 noise 波動
核心 algorithm 從大少 2026-08-20 18:51 畀嘅 reference code port 過嚟,
包入 framework Verdict shape (向後兼容舊 frontend 嘅 calculateZigZag output)。

對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs (line 1505-1617)
舊 frontend: calculateZigZag (紫色 ZigZag, testing page 嗰個)
舊 frontend: ChartContainer.tsx calculateZigZag (金色 ZigZag, 主 StockPulse UI)
舊 frontend: ElliottWaveTestPage.tsx calculateZigZag (EW test page 嗰個)

Spec: docs/research/AS-03-cycle-detection/M1-V22-RESEARCH.md (direction flag refactor)
Algorithm: ref code 嘅 state machine (1 個 direction + 1 個 temp_extreme + 1 個 loop)
凡人話: 一個 algorithm 拎到 K 線之後, 逐條掃, 拎出 Peak (頂) 同 Trough (底) 兩種轉折點
"""

import datetime
import numpy as np
from typing import List, Dict, Any, Optional

from ..base import Algorithm, Verdict
from ..registry import register
from .config import DEFAULT_THRESHOLD


class ZigZagAlgorithm(Algorithm):
    """ZigZag algorithm wrapper (凡人話 contract)

    收 K 線 (klines) + 自訂參數 (options), 返 Verdict:
    - points: list of {date, value, type: 'high'/'low', index}
    - meta: {threshold, threshold_proportion, klines_count, points_count, lastSwingHigh, lastSwingLow, zigzagSlope}
    - warnings: Module Warning System v1.1.0 格式

    永久 rule (大少 2026-08-20):
    - threshold 對外用 % 編碼 (e.g. 5 = 5%), 內部轉 ref code 嘅 0-1 比例
    - 拎 point 用 high/low 對齊 (大少 2026-08-20 07:10 hot fix), 唔好用 close
    - output shape 跟舊 frontend 保持向後兼容 (date / value / type: 'high'/'low')
    """
    name = "zigzag"
    version = "1.0.0"

    def run(self, klines: List[Dict[str, Any]], options: Dict[str, Any]) -> Verdict:
        # 1. 拎 threshold (凡人話: 5% 默認, options 入面拎)
        threshold_pct = options.get("threshold", DEFAULT_THRESHOLD)
        threshold_proportion = threshold_pct / 100  # ref code 用 0-1 比例

        # 2. 拎 highs / lows arrays (numpy 加速)
        if len(klines) < 2:
            return Verdict(
                ok=False,
                error=f"數據太少 ({len(klines)} 條), 至少要 2 條先可以計"
            )

        try:
            highs = np.array([float(k['high']) for k in klines], dtype=float)
            lows = np.array([float(k['low']) for k in klines], dtype=float)
        except (KeyError, ValueError, TypeError) as e:
            return Verdict(
                ok=False,
                error=f"K 線 data 拎 high/low 失敗: {e} (需要每個 kline dict 有 'high' 同 'low' field)"
            )

        n = len(highs)

        # 3. 跑 ref code 嘅 algorithm (內部 static method)
        result = self._zigzag_fit(highs, lows, threshold_proportion)

        # 4. Wrap 返 Verdict points shape (跟舊 frontend `calculateZigZag` output, 保持向後兼容)
        # 舊 shape: [{date, value, type: 'high' | 'low'}, ...]
        points = []
        for idx, price, ptype in result['points']:
            points.append({
                "date": klines[idx].get('time', klines[idx].get('date', '')),
                "value": float(price),
                "type": "high" if ptype == 1 else "low",
                "index": int(idx),
            })

        # 5. Meta — 拎畀 M1 等其他 module 用 (M1 ma-alignment.ts 拎緊呢 4 個 field)
        # 對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs (line 7343-7347)
        meta = {
            "threshold": threshold_pct,
            "threshold_proportion": threshold_proportion,
            "klines_count": n,
            "points_count": len(points),
        }

        # 拎 last swing high / low (M1 v2.0 拎緊呢 2 個 field)
        if points:
            reverse_points = list(reversed(points))
            last_high = next((p for p in reverse_points if p['type'] == 'high'), None)
            last_low = next((p for p in reverse_points if p['type'] == 'low'), None)
            meta["lastSwingHigh"] = (
                {"date": last_high['date'], "value": last_high['value']} if last_high else None
            )
            meta["lastSwingLow"] = (
                {"date": last_low['date'], "value": last_low['value']} if last_low else None
            )
        else:
            meta["lastSwingHigh"] = None
            meta["lastSwingLow"] = None

        # 5.5. ZigZag 斜率 (大少 2026-08-21 11:26 trigger — Option A 補返 Phase 1 (4.18.0) 拎走咗嘅 frontend calcZigZagSlope)
        # 凡人話: 用之字最後 2 個 confirmed point 計斜率, 雙斜率 prevToLast + lastToToday
        # 對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs:1646-1701
        # 永久 rule (大少 2026-08-21 11:26): backend 補返 zigzagSlope, frontend 唔可以自己 algorithm
        meta["zigzagSlope"] = self._calc_zigzag_slope(result['points'], klines)

        # 6. Warnings — Module Warning System v1.1.0 (凡人話: < 30 條 data 提示 sample size 細)
        # CATEGORY_DISPLAY template: system 類 impact "Verdict 唔可信, 唔好落單"
        warnings = []
        if n < 30:
            warnings.append({
                "level": "warning",
                "category": "system",
                "module_id": "zigzag",
                "code": "LOW_SAMPLE_SIZE",
                "message": f"只有 {n} 條 K 線, sample size 較細",
                "issue": f"actual klines = {n}, 建議 ≥ 30 條先可信",
                "impact": "Verdict 唔可信, 唔好落單",
                "fix": "Re-run / 加大 dataWindowDays",
                "context": {"actual_count": n, "recommended_min": 30},
            })

        return Verdict(
            ok=True,
            points=points,
            meta=meta,
            warnings=warnings,
        )

    @staticmethod
    def _zigzag_fit(highs: np.ndarray, lows: np.ndarray, threshold: float) -> dict:
        """凡人話: 核心 algorithm (從 ref code 移植, 維持原本 algorithm 不變)

        由大少 2026-08-20 18:51 畀嘅 ref code 直接 port 過嚟。
        Ref code 註解超清楚, 凡人話解:
        - 1 個 direction flag (1 = 上漲中尋找 Peak, -1 = 下跌中尋找 Trough)
        - 1 個 temp_extreme (currently tracked extreme, 隨時更新)
        - 逐根 K 線掃描, 觸發 threshold 就切換 direction 同 confirm point

        改動:
        - 拎出嚟做 static method (唔需要 self)
        - threshold 已經係 0-1 比例 (caller 轉好)
        - 拎 labels / trend 出嚟但暫時冇用 (Phase 1 唔 return 畀 frontend)

        Returns:
            dict: {points: [(idx, price, 1/-1), ...], labels: ndarray, trend: ndarray}
        """
        n = len(highs)
        labels = np.zeros(n, dtype=int)
        trend = np.zeros(n, dtype=int)
        points = []

        if n < 2:
            return {'points': points, 'labels': labels, 'trend': trend}

        # 步驟 1: 決定初始方向
        # Ref code logic: highs[1] > highs[0] → 初始上漲 (direction=1, last_extreme=lows[0])
        if highs[1] > highs[0]:
            direction = 1
            last_extreme_idx = 0
            last_extreme_price = lows[0]
            last_extreme_type = -1
        else:
            direction = -1
            last_extreme_idx = 0
            last_extreme_price = highs[0]
            last_extreme_type = 1

        temp_extreme_idx = last_extreme_idx
        temp_extreme_price = last_extreme_price

        # 步驟 2: 逐根 K 線掃描 (核心 loop)
        for i in range(1, n):
            if direction == 1:
                # 狀態 A: 上漲中, 尋找 Peak
                trend[i] = 1
                if highs[i] > temp_extreme_price:
                    temp_extreme_idx = i
                    temp_extreme_price = highs[i]
                retracement = (temp_extreme_price - lows[i]) / temp_extreme_price
                if retracement >= threshold:
                    labels[temp_extreme_idx] = 1
                    points.append((temp_extreme_idx, temp_extreme_price, 1))
                    direction = -1
                    last_extreme_idx = temp_extreme_idx
                    last_extreme_price = temp_extreme_price
                    last_extreme_type = 1
                    temp_extreme_idx = i
                    temp_extreme_price = lows[i]
            else:
                # 狀態 B: 下跌中, 尋找 Trough
                trend[i] = -1
                if lows[i] < temp_extreme_price:
                    temp_extreme_idx = i
                    temp_extreme_price = lows[i]
                retracement = (highs[i] - temp_extreme_price) / temp_extreme_price
                if retracement >= threshold:
                    labels[temp_extreme_idx] = -1
                    points.append((temp_extreme_idx, temp_extreme_price, -1))
                    direction = 1
                    last_extreme_idx = temp_extreme_idx
                    last_extreme_price = temp_extreme_price
                    last_extreme_type = -1
                    temp_extreme_idx = i
                    temp_extreme_price = highs[i]

        return {'points': points, 'labels': labels, 'trend': trend}

    @staticmethod
    def _calc_zigzag_slope(
        points: List[tuple],
        klines: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """凡人話: 用之字最後 2 個 confirmed point 計斜率 (Stage 1 framework, 4.11.0)

        兩個 slope (對齊 frontend calcZigZagSlope 永久 rule):
        - prevToLast: 倒數第 2 點 → 最後 1 點 (主要訊號, 反映轉向間距)
        - lastToToday: 最後 1 點 → 今日 close (extended, 處理 lag tail 甩尾)

        Args:
            points: 之字 points (從 _zigzag_fit result 拎), list of (idx, price, ptype)
                - ptype: 1=high (Peak), -1=low (Trough)
            klines: K 線 data (用最後一條拎今日 close)

        Returns:
            dict: {
                ok: bool,
                prevToLast: {from: {date, value, type, index}, to: {...}, changePct, days, dailySlope},
                lastToToday: 同 prevToLast structure (or None if 超過 60 日),
                reason: str (when ok=False)
            }

        對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs:1646-1701
        永久 rule (大少 2026-08-21 11:26): 之字斜率永遠從最後 2 個 confirmed point 計, 唔好 trigger (Stage 1 framework 唔郁 trigger)
        """
        # 凡人話: 至少 2 個 point 先可以計斜率
        if not points or len(points) < 2:
            return {"ok": False, "reason": "之字 point 太少 (< 2)"}

        # 拎最後 2 個 confirmed point
        # points = [(idx, price, ptype), ...] — ptype 1=high, -1=low
        last_idx, last_price, last_ptype = points[-1]
        prev_idx, prev_price, prev_ptype = points[-2]

        def _kline_date(idx: int) -> Optional[str]:
            """凡人話: 拎 K 線 date (time/date/timestamp fallback chain, 對齊 adapter.mjs _zigzagNormalizeDate)"""
            if idx < 0 or idx >= len(klines):
                return None
            k = klines[idx]
            return k.get('time') or k.get('date') or k.get('timestamp')

        def _parse_date(s: Any) -> Optional[datetime.date]:
            """凡人話: parse date string/number → datetime.date (對齊 frontend dateToTime 邏輯)"""
            if s is None:
                return None
            try:
                if isinstance(s, (int, float)):
                    # Unix timestamp (秒 or 毫秒)
                    ts = s / 1000 if s > 1e12 else s
                    return datetime.datetime.fromtimestamp(ts).date()
                if isinstance(s, str):
                    # ISO string (e.g. "2026-08-21" or "2026-08-21T09:00:00")
                    # 取頭 10 個 char (YYYY-MM-DD) 避免 timezone 問題
                    date_part = s[:10] if len(s) >= 10 else s
                    return datetime.datetime.fromisoformat(date_part).date()
            except (ValueError, TypeError, OSError):
                return None
            return None

        last_date_str = _kline_date(last_idx)
        prev_date_str = _kline_date(prev_idx)

        if not last_date_str or not prev_date_str:
            return {"ok": False, "reason": "日期無效 (缺失)"}

        last_date = _parse_date(last_date_str)
        prev_date = _parse_date(prev_date_str)

        if not last_date or not prev_date:
            return {"ok": False, "reason": f"日期解析失敗 (last={last_date_str!r}, prev={prev_date_str!r})"}

        # 計日數 (大少 evidence: 太古 51 日, 騰訊 9 日 — 曆日計)
        days = (last_date - prev_date).days
        if days <= 0:
            return {"ok": False, "reason": f"日期無效 (倒置或同日, days={days})"}

        # 計升跌 (大少 evidence: 太古 +25.40%, 騰訊 -1.41%)
        change_pct = ((last_price - prev_price) / prev_price) * 100
        daily_slope = change_pct / days

        # ptype 1=high, -1=low
        last_type_str = "high" if last_ptype == 1 else "low"
        prev_type_str = "high" if prev_ptype == 1 else "low"

        result: Dict[str, Any] = {
            "ok": True,
            "prevToLast": {
                "from": {
                    "date": prev_date_str,
                    "value": round(float(prev_price), 4),
                    "type": prev_type_str,
                    "index": int(prev_idx),
                },
                "to": {
                    "date": last_date_str,
                    "value": round(float(last_price), 4),
                    "type": last_type_str,
                    "index": int(last_idx),
                },
                "changePct": round(change_pct, 4),
                "days": round(float(days), 2),
                "dailySlope": round(daily_slope, 6),
            },
        }

        # lastToToday: 最後 1 點 → 今日 close (Solution A: 處理 lag tail 甩尾)
        if klines and len(klines) > 0:
            last_kline = klines[-1]
            today_date_str = _kline_date(len(klines) - 1)  # 用 _kline_date 同樣 fallback chain
            today_close = last_kline.get('close')
            if today_date_str and today_close is not None and isinstance(today_close, (int, float)):
                today_date = _parse_date(today_date_str)
                if today_date:
                    last_to_today_days = (today_date - last_date).days
                    # 凡人話: 1-60 日內先計 (超過 60 日當 stale, 唔可靠)
                    if 0 < last_to_today_days < 60:
                        ext_change_pct = ((float(today_close) - last_price) / last_price) * 100
                        ext_daily_slope = ext_change_pct / last_to_today_days
                        result["lastToToday"] = {
                            "from": {
                                "date": last_date_str,
                                "value": round(float(last_price), 4),
                                "type": last_type_str,
                                "index": int(last_idx),
                            },
                            "to": {
                                "date": today_date_str,
                                "value": round(float(today_close), 4),
                                "type": "today",
                            },
                            "changePct": round(ext_change_pct, 4),
                            "days": round(float(last_to_today_days), 2),
                            "dailySlope": round(ext_daily_slope, 6),
                        }

        return result


# 自動 register 落 framework (凡人話: import 呢個 file 就自動 register)
register(ZigZagAlgorithm())

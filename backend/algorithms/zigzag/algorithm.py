"""
backend/algorithms/zigzag/algorithm.py — ZigZag algorithm (大少 2026-08-29 19:54 還原)

凡人話: 拎 K 線 → 拎有意義嘅 Peak (頂) / Trough (底), 過濾 noise 波動
1-to-1 port testing page frontend calculateZigZag (backup 2026-08-20) 落 Python。

對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs (line 1505-1625)
對應測試: testing-page.js:4.32.0 frontend calculateZigZagFrontend function (1-to-1 port)

Spec: docs/research/AS-03-cycle-detection/M1-V22-RESEARCH.md (direction flag refactor)
Algorithm: ref code 嘅 frontend 1-to-1 port (拎 point + trigger 都用 high/low 對齊)
凡人話: 一個 algorithm 拎到 K 線之後, 逐條掃, 拎出 Peak (頂) 同 Trough (底) 兩種轉折點

永久 rule (大少 2026-08-29 19:54):
- 拎走 _zigzag_fit state machine (大少 trigger「testing page 前後台還原」)
- 1-to-1 port frontend calculateZigZag 算法 (拎 point + trigger 都用 high/low 對齊)
- testing page frontend (JS) + testing page backend (Python) 兩邊都用同一份 ref code, 1-to-1 對齊
- K 線 source 唔影響算法 (T-1 normalized vs KlineCache raw) — 算法拎 high/low, 拎到咩用咩
"""

import datetime
from typing import List, Dict, Any, Optional

from ..base import Algorithm, Verdict
from ..registry import register
from .config import DEFAULT_THRESHOLD


def _zigzag_normalize_date(kline: Dict[str, Any]) -> str:
    """凡人話: 拎 K 線 date (time/date/timestamp fallback chain, 對齊 adapter.mjs _zigzagNormalizeDate)"""
    return (
        kline.get('time')
        or kline.get('date')
        or kline.get('timestamp')
        or ''
    )


def calculate_zigzag_frontend(
    klines: List[Dict[str, Any]],
    threshold_percent: float = 5,
) -> List[Dict[str, Any]]:
    """凡人話: 1-to-1 port frontend calculateZigZag 算法 (從 backup 2026-08-20 port 過嚟)

    對應 frontend: backups/zigzag-frontend-2026-08-20/adapter.mjs:1505-1625 calculateZigZag
    對應 testing page: testing-page.js:4.32.0 calculateZigZagFrontend (1-to-1 port)

    拎 point value 用 high / low 對齊 K 線真實 high / low (跟 testing page 4.15.0 永久 rule)
    拎 point trigger 都用 high / low (唔好用 close, 跟 4.15.0 永久 rule)

    Returns:
        list of {date, value, type: 'high' | 'low', index}
    """
    if not klines or len(klines) < 2:
        return []

    result = []
    threshold = threshold_percent / 100.0

    # 拎第一個 point: 永遠用 klines[0].low (frontend 算法 1-to-1)
    result.append({
        "date": _zigzag_normalize_date(klines[0]),
        "value": float(klines[0]['low']),
        "type": 'low',
        "index": 0,
    })

    last_swing_high = float(klines[0]['high'])
    last_swing_low = float(klines[0]['low'])
    last_swing_idx = 0
    # inUptrend 用 klines[1].close vs klines[0].close 對齊決定初始方向 (frontend 算法 1-to-1)
    in_uptrend = float(klines[1]['close']) > float(klines[0]['close'])

    # 第一個 loop: 找第一個顯著高/低點 (frontend algorithm.mjs:1523-1568)
    first_break = False
    for i in range(1, len(klines)):
        # 大少 4.15.0 永久 rule: 拎 point 同 trigger 都用 high/low 對齊 (唔好用 close)
        change_from_high = (float(klines[i]['low']) - last_swing_high) / last_swing_high
        change_from_low = (float(klines[i]['high']) - last_swing_low) / last_swing_low

        if in_uptrend:
            if float(klines[i]['high']) > last_swing_high:
                last_swing_high = float(klines[i]['high'])
                last_swing_low = float(klines[i]['low'])
                last_swing_idx = i
            if change_from_high <= -threshold:
                result.append({
                    "date": _zigzag_normalize_date(klines[last_swing_idx]),
                    "value": last_swing_high,
                    "type": 'high',
                    "index": last_swing_idx,
                })
                in_uptrend = False
                last_swing_low = float(klines[i]['low'])
                last_swing_high = float(klines[i]['high'])
                last_swing_idx = i
                first_break = True
                break
        else:
            if float(klines[i]['low']) < last_swing_low:
                last_swing_low = float(klines[i]['low'])
                last_swing_high = float(klines[i]['high'])
                last_swing_idx = i
            if change_from_low >= threshold:
                result.append({
                    "date": _zigzag_normalize_date(klines[last_swing_idx]),
                    "value": last_swing_low,
                    "type": 'low',
                    "index": last_swing_idx,
                })
                in_uptrend = True
                last_swing_low = float(klines[i]['low'])
                last_swing_high = float(klines[i]['high'])
                last_swing_idx = i
                first_break = True
                break

    if not first_break or len(result) <= 1:
        return result

    # 第二個 loop: 繼續追蹤轉向點 (frontend algorithm.mjs:1572-1609)
    for i in range(last_swing_idx + 1, len(klines)):
        change_from_high = (float(klines[i]['low']) - last_swing_high) / last_swing_high
        change_from_low = (float(klines[i]['high']) - last_swing_low) / last_swing_low

        if in_uptrend:
            if float(klines[i]['high']) > last_swing_high:
                last_swing_high = float(klines[i]['high'])
                last_swing_idx = i
            if change_from_high <= -threshold:
                result.append({
                    "date": _zigzag_normalize_date(klines[last_swing_idx]),
                    "value": last_swing_high,
                    "type": 'high',
                    "index": last_swing_idx,
                })
                in_uptrend = False
                last_swing_low = float(klines[i]['low'])
                last_swing_idx = i
        else:
            if float(klines[i]['low']) < last_swing_low:
                last_swing_low = float(klines[i]['low'])
                last_swing_idx = i
            if change_from_low >= threshold:
                result.append({
                    "date": _zigzag_normalize_date(klines[last_swing_idx]),
                    "value": last_swing_low,
                    "type": 'low',
                    "index": last_swing_idx,
                })
                in_uptrend = True
                last_swing_high = float(klines[i]['high'])
                last_swing_idx = i

    # 添加最後一個有效轉向點 (frontend algorithm.mjs:1611-1622)
    last_date = _zigzag_normalize_date(klines[last_swing_idx])
    if result[-1]['date'] != last_date:
        result.append({
            "date": last_date,
            "value": last_swing_high if in_uptrend else last_swing_low,
            "type": 'high' if in_uptrend else 'low',
            "index": last_swing_idx,
        })

    return result


class ZigZagAlgorithm(Algorithm):
    """ZigZag algorithm wrapper (凡人話 contract)

    收 K 線 (klines) + 自訂參數 (options), 返 Verdict:
    - points: list of {date, value, type: 'high'/'low', index}
    - meta: {threshold, threshold_proportion, klines_count, points_count, lastSwingHigh, lastSwingLow}
    - warnings: Module Warning System v1.1.0 格式

    永久 rule (大少 2026-08-29 19:54):
    - 1-to-1 port frontend calculateZigZag 算法 (拎走 _zigzag_fit state machine)
    - threshold 對外用 % 編碼 (e.g. 5 = 5%), 內部 1-to-1 對齊 frontend 算法
    - 拎 point 用 high/low 對齊, 唔好用 close
    - output shape 跟 frontend 保持 1-to-1 對齊 (date / value / type: 'high'/'low' / index)
    """
    name = "zigzag"
    version = "2.0.0"  # 大少 2026-08-29 19:54 還原, 拎走 _zigzag_fit, 1-to-1 port frontend 算法

    def run(self, klines: List[Dict[str, Any]], options: Dict[str, Any]) -> Verdict:
        # 1. 拎 threshold (凡人話: 5% 默認, options 入面拎)
        threshold_pct = options.get("threshold", DEFAULT_THRESHOLD)

        # 2. 拎 K 線 data
        if len(klines) < 2:
            return Verdict(
                ok=False,
                error=f"數據太少 ({len(klines)} 條), 至少要 2 條先可以計"
            )

        # 3. 跑 frontend 1-to-1 port 算法
        points = calculate_zigzag_frontend(klines, threshold_pct)

        n = len(klines)

        # 4. Meta — 拎畀 M1 等其他 module 用
        # 對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs (line 7343-7347)
        meta = {
            "threshold": threshold_pct,
            "threshold_proportion": threshold_pct / 100,
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

        # 5. Warnings — Module Warning System v1.1.0
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


# 自動 register 落 framework (凡人話: import 呢個 file 就自動 register)
register(ZigZagAlgorithm())

"""
backend/algorithms/m1_brack_test/algorithm.py — M1 Brack Test v0.1.0 (大少 2026-09-14 21:16 confirm)

凡人話: 將 M1 對歷史每日逐日回放, 由第 65 日開始每次加 1 日跑 1 次 M1,
        將每次 trigger sub_scenario 嘅 verdict (cycle != sideways) 收集落 hits list,
        frontend 用嚟喺 K 線圖加 marker + 表格例表顯示

對應 plan: docs/research/AS-03-cycle-detection/MODULE-BRACK-TEST.md (待新加)
對應 source: backend/algorithms/ma_alignment/algorithm.py v2.6.1 (M1 整個 11 個 sub_scenario 邏輯)
對應 spec: docs/research/AS-03-cycle-detection/MODULE-01-MA-ALIGNMENT.md v2.6.1 (M1 spec)
對應 framework: backend/algorithms/base.py Verdict contract

Algorithm: 5 sub-step
- Step 1: Input validation (K 線 ≥ startIndex, 拎 config)
- Step 2: Instantiate MaAlignmentV2Algorithm (M1 整個 instance)
- Step 3: Sub-loop i in range(startIndex, len(klines)):
            trimmed = klines[:i+1]
            m1_verdict = m1_algo.run(trimmed, options)
            if hit filter pass (cycle != "sideways"):
              hits.append({date, time, OHLC, cycle, cycleLabel, cyclePosition, cyclePositionLabel, state, confidence, reason, index})
- Step 4: 計 summary (totalRuns / totalHits / hitRate / breakdownByCycle / breakdownByState)
- Step 5: 組裝 verdict (points=hits, meta={...summary...})

Permanent rules (對齊 plan §對齊永久 rule checklist):
- ✅ Algo 唔可以直接 fetch K 線 (K 線由 runner 統一拎) — 對齊 8月22日 23:20 永久 rule
- ✅ Algo 內部 instantiate M1 (MaAlignmentV2Algorithm) — 對齊 §Algorithm Backend-only + 模組化 永久 rule
- ✅ Hit filter = cycle != "sideways" — 對齊 Q1 confirm decision
- ✅ start_index = 65 對齊 M1 required_length — 對齊 Q2 confirm decision
- ✅ meta.symbol 對齊 caller symbol — 對齊 9月7日 07:00 meta.symbol 永久 rule (runner 已經 inject)
- ✅ emit open/high/low/close 4 個 OHLC — 對齊 Q5 confirm decision (chart overlay 一般 emit OHLC 4 個 field)
- ✅ data_window_days = options.get("dataWindowDays", 1260) — 對齊 9月6日 23:17 永久 rule (runner 已經 inject)
- ✅ warning 統一用 ModuleWarning object 落 verdict.warnings (對齊 §Module Warning v1.1.0)
- ✅ 用「取」唔用「拎」 (對齊 8月20日 trigger)
- ✅ 凡人話 (對齊 8月14日 19:02 trigger)
- ❌ 唔做 forward return 計算 (對齊 M9 back_test 範圍)
- ❌ 唔改 M1 algorithm 自己 (對齊 §M1 sub-scenario 永久 rule 「改任何 sub-scenario trigger 都要即刻 update spec doc」)
"""

from collections import Counter
from typing import List, Dict, Any, Optional

from ..base import Algorithm, Verdict
from ..registry import register
from .config import DEFAULT_M1_BRACK_TEST_CONFIG


# ============================================================
# Helper functions
# ============================================================

def _get_kline_field(kline: Dict[str, Any], *keys: str) -> Any:
    """凡人話: 拎 K 線 field, 支持多個 fallback key (對齊 backend K 線 shape 多變)

    kline API response 可能用 "date" / "time" / "timestamp" 任一個做日期 field
    """
    for key in keys:
        value = kline.get(key)
        if value is not None:
            return value
    return None


def _format_kline_date(kline: Dict[str, Any]) -> str:
    """凡人話: 拎 K 線日期轉做 ISO 'YYYY-MM-DD' 格式

    Backend K 線 response 有 3 種日期 format:
    - "date" = "YYYY-MM-DD" string
    - "time" = "YYYY-MM-DD HH:MM:SS" string (8月29日 22:35 evidence 確認)
    - "timestamp" = number ms (frontend lightweight-charts 用)

    統一攞返 'YYYY-MM-DD' 畀 frontend chart marker 用
    """
    # Priority 1: "date" field (對齊 #8505 KlineCache default response shape)
    date_str = kline.get("date")
    if date_str:
        return str(date_str).split("T")[0].split(" ")[0]

    # Priority 2: "time" field (對齊 8月29日 22:35 date format 多變 evidence)
    time_str = kline.get("time")
    if time_str:
        return str(time_str).split("T")[0].split(" ")[0]

    # Priority 3: "timestamp" field (ms → date)
    timestamp = kline.get("timestamp")
    if isinstance(timestamp, (int, float)):
        from datetime import datetime, timezone
        ts_ms = timestamp if timestamp > 1e10 else timestamp * 1000  # seconds → ms
        return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")

    return ""


# 大少 2026-09-15 21:05 trigger — Date range filter helpers (v0.4.0)
# 凡人話: 拎 date_from / date_to (YYYY-MM-DD string) → 計 UTC timestamp (ms) 用嚟做 K 線 date 比較
# - empty / 唔合法 → return None (silent fallback, 唔 throw) 對齊 §M3 trendline chart overlay 修復永久 rule spirit
# - 對齊 §Cross-module 統一 date parsing 永久 rule (8月29日 22:35): YYYY-MM-DD UTC midnight 統一 date parsing
def _parse_date_range(date_from: Optional[str], date_to: Optional[str]):
    """大少 2026-09-15 21:05 trigger — Date range filter helper

    凡人話: 拎 date_from / date_to YYYY-MM-DD string, return tuple (from_ts, to_ts) 拎嚟做 K 線 date 比較。
    - date_from empty / 唔合法 → from_ts = None (silent fallback, 唔 throw)
    - date_to empty / 唔合法 → to_ts = None (silent fallback, 唔 throw)
    - date_to 加 1 日 (24*60*60*1000 ms) 包含 date_to 當日 (e.g. date_to=2026-09-15 包含 2026-09-15 hit)
    """
    from datetime import datetime, timezone
    from_ts = None
    to_ts = None
    if date_from:
        try:
            from_ms = int(datetime.strptime(date_from, '%Y-%m-%d').replace(tzinfo=timezone.utc).timestamp() * 1000)
            from_ts = from_ms
        except (ValueError, TypeError):
            pass  # silent fallback, 唔 throw
    if date_to:
        try:
            to_ms = int(datetime.strptime(date_to, '%Y-%m-%d').replace(tzinfo=timezone.utc).timestamp() * 1000) + 24 * 60 * 60 * 1000
            to_ts = to_ms
        except (ValueError, TypeError):
            pass  # silent fallback
    return from_ts, to_ts


def _kline_date_ts(kline: Dict[str, Any]) -> int:
    """大少 2026-09-15 21:05 trigger — 拎 K 線 date UTC timestamp (ms) 用嚟比較 date_from/date_to 範圍

    凡人話: 對齊 §Cross-module 統一 date parsing 永久 rule (8月29日 22:35 trigger), K 線 time field 統一 strip ' ' 拎 date-only + UTC midnight。
    silent fallback return 0 (唔 throw) 對齊 §M3 trendline chart overlay 修復永久 rule spirit。
    """
    from datetime import datetime, timezone
    try:
        time_str = kline.get('time', '') or ''
        # K 線 time 通常係 "YYYY-MM-DD" 或 "YYYY-MM-DD HH:MM:SS" UTC, strip space 拎 date-only
        date_only = time_str.split(' ')[0] if time_str else ''
        if not date_only:
            return 0
        dt = datetime.strptime(date_only, '%Y-%m-%d').replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    except (ValueError, TypeError):
        return 0  # silent fallback


# ============================================================
# M1 Brack Test Algorithm
# ============================================================

class M1BrackTestAlgorithm(Algorithm):
    """M1 Brack Test v0.1.0 algorithm (凡人話 contract) — 大少 2026-09-14 21:16 confirm

    將 M1 對歷史每日逐日回放, 收集每次 trigger sub_scenario 嘅 hit 記錄
    Frontend 用嚟喺 K 線圖加 marker + 表格例表顯示 + 兩種 mode 切換
    """
    name = "m1_brack_test"
    version = "0.1.0"

    def run(self, klines: List[Dict[str, Any]], options: Dict[str, Any]) -> Verdict:
        cfg = options.get("config", DEFAULT_M1_BRACK_TEST_CONFIG)
        start_index = cfg["startIndex"]
        exclude_cycles = set(cfg.get("excludeCycles", ["sideways"]))

        # ============ Step 1: Input validation ============
        if len(klines) < start_index + 1:
            # 凡人話: K 線太少 (新股 / 細股 / cold cache), 返 ok=True + 0 hit
            return Verdict(
                ok=True,
                points=[],
                meta={
                    "symbol": options.get("symbol", "UNKNOWN"),
                    "totalRuns": 0,
                    "totalHits": 0,
                    "hitRate": 0.0,
                    "hitRatePct": "0.00%",
                    "startIndex": start_index,
                    "dataWindowDays": options.get("dataWindowDays", 1260),
                    "firstKlineDate": _format_kline_date(klines[0]) if klines else None,
                    "lastKlineDate": _format_kline_date(klines[-1]) if klines else None,
                    "breakdownByCycle": {cycle: 0 for cycle in cfg["allCycles"]},
                    "breakdownByState": {"UP": 0, "DOWN": 0, "SIDEWAYS": 0, "TRANSITION": 0},
                    "reason": f"insufficient_klines (需要 ≥ {start_index + 1} 條, 拎到 {len(klines)} 條)",
                },
                warnings=[],
            )

        # ============ Step 2: Instantiate M1 (對齊 §Algorithm Backend-only + 模組化 永久 rule) ============
        from ..ma_alignment.algorithm import MAAlignmentV2Algorithm
        m1_algo = MAAlignmentV2Algorithm()

        # ============ Step 3: Sub-loop 跑 M1 (對齊 §M9 back_test 內部 call M8 spirit) ============
        hits: List[Dict[str, Any]] = []
        total_runs = 0
        skipped_runs = 0

        # 大少 2026-09-15 21:05 trigger — Brack Test 指定日期範圍跑功能 (v0.4.0)
        # 凡人話: 拎 date_from / date_to 落 options (camelCase 對齊 dataWindowDays pattern), 算法內部拎 options.get("dateFrom") / options.get("dateTo")
        # empty / 唔合法 → silent fallback 全跑 (對齊 §M3 trendline chart overlay 修復永久 rule spirit)
        date_from = options.get("dateFrom")
        date_to = options.get("dateTo")
        date_from_ts, date_to_ts = _parse_date_range(date_from, date_to)

        for i in range(start_index, len(klines)):
            total_runs += 1

            # 大少 2026-09-15 21:05 trigger — Filter K 線 by date range (date_from / date_to)
            # 凡人話: 大少指定日期範圍嗰陣, 淨係 loop date_from_ts <= kline_date_ts < date_to_ts 範圍內嘅 K 線
            # 對齊既有 trimmed = klines[:i + 1] pattern (M1 algorithm 用 trimmed K 線 run, 唔可以拎中間 skip 嘅 K 線)
            if date_from_ts is not None or date_to_ts is not None:
                kline_ts = _kline_date_ts(klines[i])
                if date_from_ts is not None and kline_ts < date_from_ts:
                    continue  # skip K 線 before date_from
                if date_to_ts is not None and kline_ts >= date_to_ts:
                    continue  # skip K 線 after date_to

            trimmed = klines[: i + 1]

            try:
                m1_verdict = m1_algo.run(trimmed, options)
            except Exception as e:
                # 凡人話: 任何 1 日 M1 fail 唔 crash 整個 Brack Test, skip 嗰日
                skipped_runs += 1
                continue

            if not m1_verdict or not m1_verdict.ok:
                # 凡人話: M1 verdict 唔 ok (數據不足 / internal error), skip 嗰日
                skipped_runs += 1
                continue

            # ============ Q1: hit filter = cycle != "sideways" ============
            cycle = m1_verdict.meta.get("cycle")
            if not cycle or cycle in exclude_cycles:
                continue

            # ============ Step 3.5: 收集 hit 記錄 ============
            kline = klines[i]
            adjustment_log = m1_verdict.meta.get("adjustmentLog", []) or []
            reason = adjustment_log[-1] if adjustment_log else ""

            hit = {
                "date": _format_kline_date(kline),
                "time": _format_kline_date(kline),  # 對齊 Lightweight Charts time field (frontend marker 用)
                "index": i,
                # Q5: emit 4 個 OHLC 全部
                "open": kline.get("open"),
                "high": kline.get("high"),
                "low": kline.get("low"),
                "close": kline.get("close"),
                # M1 verdict meta fields (對齊 backend emit shape §M1 v2.6.1)
                "cycle": cycle,
                "cycleLabel": m1_verdict.meta.get("cycleLabel", ""),
                "cyclePosition": m1_verdict.meta.get("cyclePosition"),
                "cyclePositionLabel": m1_verdict.meta.get("cyclePositionLabel", ""),
                "state": m1_verdict.meta.get("state", "SIDEWAYS"),
                "confidence": m1_verdict.meta.get("confidence", 0.0),
                "reason": reason,
            }
            hits.append(hit)

        # ============ Step 3.6: 大少 2026-09-14 22:47 trigger — Index 排例後台做好 ============
        # 凡人話: 將 hits sort by date_desc (新 → 舊), 每個 hit 加 displayIndex field 落做 sorted view 嘅 position 1..N
        # 對齊 §M1 sub-scenario 永久 rule 「改任何 sub-scenario trigger 都要即刻 update spec doc」
        # 對齊 §M2 self-check penalty pattern (rule 永遠寫死喺 spec doc)
        # 凡人話: 不論 Brack Test 點排列 (切換 sub_scenario / mode), 第 1 row = Index 1, 第 2 row = Index 2, ...
        # Backend 保證 sort 規則 + emit displayIndex, frontend 拎返用或者自己 enumerate 1..N 都得
        # Meta 加 displaySortBy 寫低 sort 規則, frontend / future refactor 都拎到 source of truth
        hits.sort(key=lambda h: h["date"], reverse=True)  # date 由大至小 (新 → 舊)
        for idx, h in enumerate(hits, start=1):
            h["displayIndex"] = idx

        # ============ Step 4: 計 summary ============
        total_hits = len(hits)
        hit_rate = total_hits / total_runs if total_runs > 0 else 0.0

        # Breakdown by cycle (對齊 plan §Verdict shape)
        breakdown_by_cycle = {cycle: 0 for cycle in cfg["allCycles"]}
        for h in hits:
            cycle = h["cycle"]
            breakdown_by_cycle[cycle] = breakdown_by_cycle.get(cycle, 0) + 1

        # Breakdown by state
        breakdown_by_state = {"UP": 0, "DOWN": 0, "SIDEWAYS": 0, "TRANSITION": 0}
        for h in hits:
            state = h["state"]
            breakdown_by_state[state] = breakdown_by_state.get(state, 0) + 1

        # ============ Step 5: 組裝 verdict (對齊 backend verdict contract) ============
        meta: Dict[str, Any] = {
            "symbol": options.get("symbol", "UNKNOWN"),
            "totalRuns": total_runs,
            "totalHits": total_hits,
            "skippedRuns": skipped_runs,
            "hitRate": round(hit_rate, 6),
            "hitRatePct": f"{hit_rate * 100:.2f}%",
            "startIndex": start_index,
            "dataWindowDays": options.get("dataWindowDays", 1260),
            "firstKlineDate": _format_kline_date(klines[0]),
            "lastKlineDate": _format_kline_date(klines[-1]),
            # 大少 2026-09-14 22:47 trigger — §4.1 Index 規則 後台做好, meta 寫低 sort 規則
            "displaySortBy": "date_desc",
            "breakdownByCycle": breakdown_by_cycle,
            "breakdownByState": breakdown_by_state,
            "reason": (
                f"跑了 {total_runs} 次 M1 (由第 {start_index + 1} 日到第 {len(klines)} 日), "
                f"觸發 {total_hits} 次 sub_scenario ({hit_rate * 100:.2f}%), "
                f"skip {skipped_runs} 次 (M1 verdict 唔 ok)"
            ),
        }

        return Verdict(
            ok=True,
            points=hits,  # Frontend 直接攞返做 chart marker + 表格 rows
            meta=meta,
            warnings=[],
        )


# Register 落 framework (對齊 backend/algorithms/__init__.py pattern)
register(M1BrackTestAlgorithm())
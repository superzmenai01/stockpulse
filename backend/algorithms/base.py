"""
backend/algorithms/base.py — Algorithm contract (大少 2026-08-20 Phase 1)

凡人話: Algorithm 嘅 interface 定義 (抽象 base class + Verdict shape)
每個 algorithm (ZigZag, 之後 M1/M2/...) 都要 implement 呢個 contract。

對應 backup: backups/zigzag-frontend-2026-08-20/RESTORE.md
Spec: docs/research/AS-03-cycle-detection/MODULE-XX-*.md (per algorithm)
Algorithm: Abstract `Algorithm` class + `run(klines, options) -> Verdict`
凡人話: 一個 algorithm 就係一個 Python class, 收 K 線 + 自訂參數, 返 Verdict
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional


@dataclass
class KLine:
    """凡人話: 1 條 K 線 (跟 backend/api/kline.py return shape)

    Field 對齊 kline API response:
    - time: 日期/時間字串 (e.g. "2024-01-15" 或 "2024-01-15 09:30:00")
    - open / high / low / close: OHLC 價格
    - volume: 成交量 (可選)
    - turnover_rate: 換手率 % (可選)

    Algorithm 入面通常用 dict 直接處理, 呢個 dataclass 係 type hint reference。
    """
    time: str
    open: float
    high: float
    low: float
    close: float
    volume: Optional[int] = None
    turnover_rate: Optional[float] = None


@dataclass
class Verdict:
    """凡人話: Algorithm 嘅統一 output shape

    Field 設計原則:
    - `ok`: 必須, success / failure flag
    - `points`: 主要 output (e.g. ZigZag 嘅轉向點 list)
    - `meta`: 額外資訊 (e.g. lastSwingHigh, lastSwingLow — M1 拎緊呢啲 field)
    - `warnings`: warning 注入 (跟 Module Warning System v1.1.0)
    - `error`: 失敗嘅 error message (ok=False 時必填)

    Frontend 拎到呢個 shape 就可以直接 render (chart overlay + 凡人話 display)
    其他 algorithm (M7 Synthesizer) 拎到都可以 aggregate。
    """
    ok: bool
    points: List[Dict[str, Any]] = field(default_factory=list)
    meta: Dict[str, Any] = field(default_factory=dict)
    warnings: List[Dict[str, Any]] = field(default_factory=list)
    error: Optional[str] = None


class Algorithm(ABC):
    """凡人話: 每個 algorithm 都要 implement 呢個 abstract class

    Usage:
        from backend.algorithms.base import Algorithm, Verdict

        class MyAlgorithm(Algorithm):
            name = "my_algo"
            version = "1.0.0"

            def run(self, klines, options):
                # ... 計 algorithm
                return Verdict(ok=True, points=[...], meta={...})

    永久 rule:
    - `name` 必須 unique, 唔同 algorithm 唔可以撞
    - `version` 跟 semver (major.minor.patch)
    - `run()` 唔可以 side effect (e.g. 唔好寫 DB, 唔好 fetch 嘢)
    - K 線 fetch 由 runner service 統一做
    """
    name: str = ""  # 子類必須 override
    version: str = "0.0.0"  # 子類必須 override

    @abstractmethod
    def run(self, klines: List[Dict[str, Any]], options: Dict[str, Any]) -> Verdict:
        """凡人話: 跑 algorithm

        Args:
            klines: K 線 array, 每個 element 係 dict, 至少有 high / low / time 3 個 field
            options: 自訂參數 dict, algorithm 自己 define shape (e.g. ZigZag 用 {"threshold": 5})

        Returns:
            Verdict: 統一 output shape (ok / points / meta / warnings / error)
        """
        pass

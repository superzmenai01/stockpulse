"""
debug.py — In-app debug context for StockPulse (大少 2026-07-24)

設計: In-memory ring buffer (最近 10 runs) + popularity status tracker
- Zero external service (唔用 LogFire / Sentry / OpenTelemetry)
- Frontend 透過 /api/debug/* 即時 fetch
- Toggle via env STOCKPULSE_DEBUG=on/off

Module structure:
- DebugRun: 單次 run 嘅 step-by-step data
- DebugContext: singleton, ring buffer + popularity status
- get_debug(): convenience accessor

Thread-safe (用 Lock 保護 singleton init)
"""
import os
import threading
import time
from collections import deque
from typing import Any, Callable, Optional


# Module toggle (env var)
DEBUG_ENABLED: bool = os.getenv("STOCKPULSE_DEBUG", "on").lower() in ("on", "true", "1")


class DebugRun:
    """單次 algorithm run 嘅 debug data"""

    def __init__(self, run_id: str, trigger: str) -> None:
        self.run_id: str = run_id
        self.trigger: str = trigger
        self.start_time: float = time.time()
        self.steps: list[dict[str, Any]] = []
        self.end_time: Optional[float] = None
        self.metadata: dict[str, Any] = {}

    def add_step(self, step_name: str, data: dict[str, Any]) -> None:
        """記錄一個 step (e.g. 'after_etf_filter', 'after_snapshot')"""
        elapsed_ms: float = round((time.time() - self.start_time) * 1000, 1)
        self.steps.append({
            "step": step_name,
            "elapsed_ms": elapsed_ms,
            "data": data,
        })

    def finish(self, status: str, final_data: Optional[dict[str, Any]] = None) -> None:
        """標記 run 結束"""
        self.end_time = time.time()
        self.metadata["status"] = status
        if final_data:
            self.metadata["final"] = final_data

    def to_dict(self) -> dict[str, Any]:
        """Serialize for API response"""
        duration_ms: Optional[float] = None
        if self.end_time:
            duration_ms = round((self.end_time - self.start_time) * 1000, 1)
        return {
            "run_id": self.run_id,
            "trigger": self.trigger,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "duration_ms": duration_ms,
            "steps": self.steps,
            "metadata": self.metadata,
        }


class DebugContext:
    """
    Singleton debug context (thread-safe).
    Holds ring buffer of last N runs + popularity job status.
    """

    _instance: Optional["DebugContext"] = None
    _lock: threading.Lock = threading.Lock()

    def __init__(self, max_runs: int = 10) -> None:
        self.runs: deque[DebugRun] = deque(maxlen=max_runs)
        self.popularity_status: dict[str, Any] = {
            "state": "idle",  # idle | running | completed | failed
            "total": 0,
            "completed": 0,
            "started_at": None,
            "finished_at": None,
            "error": None,
        }

    @classmethod
    def get_instance(cls) -> "DebugContext":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def start_run(self, trigger: str) -> DebugRun:
        """開始新 run, 自動加入 ring buffer (oldest 被 evict)"""
        run_id = f"run-{int(time.time() * 1000)}"
        run = DebugRun(run_id, trigger)
        self.runs.append(run)
        return run

    def get_last_run(self) -> Optional[dict[str, Any]]:
        if not self.runs:
            return None
        return self.runs[-1].to_dict()

    def get_all_runs(self) -> list[dict[str, Any]]:
        return [r.to_dict() for r in self.runs]

    def update_popularity(self, **kwargs: Any) -> None:
        """Update popularity background job status"""
        self.popularity_status.update(kwargs)

    def get_popularity(self) -> dict[str, Any]:
        return self.popularity_status.copy()

    def get_status(self) -> dict[str, Any]:
        """Summary status for /api/debug/status endpoint"""
        return {
            "popularity": self.get_popularity(),
            "runs_count": len(self.runs),
            "debug_enabled": DEBUG_ENABLED,
        }


def get_debug() -> DebugContext:
    """Convenience accessor"""
    return DebugContext.get_instance()


def make_debug_logger(run: DebugRun) -> Callable[[str, dict[str, Any]], None]:
    """Closure factory: 將 debug_log callable 包裝成 helper-friendly form"""
    def _log(step: str, data: dict[str, Any]) -> None:
        run.add_step(step, data)
    return _log
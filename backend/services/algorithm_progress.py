"""
backend/services/algorithm_progress.py — M9 Progress Tracker (大少 2026-08-31 架構評審 Batch 3a)

凡人話: M9 跑 30-60 秒嗰陣, 大少撳掣完全冇 feedback, 容易以為 hang 撳多次掣撞 double-call
- 之前: M9 algorithm.run() 同步等 30-60 秒, frontend 完全冇 progress
- 而家: 用 threading.Thread spawn M9, 期間 emit progress stage 落 in-memory dict
- Frontend polling `/api/algorithms/progress/{request_id}` 拎 progress
- 永久 rule: M9 algorithm.run() 必須 emit progress stage 落 options['progress_callback'](stage_dict)

對應 spec: docs/research/AS-03-cycle-detection/MODULE-09-BACK-TEST.md (大少 8月31日 trigger)
Algorithm:
- spawn_m9_with_progress(): 拎 request_id + K 線 + options, spawn thread 跑 M9, 期間 emit progress
- get_progress(request_id): 拎 request_id 對應嘅 progress dict
- Progress dict shape: {request_id, status, stage, percent, current_step, total_steps, started_at, completed_at, error}
凡人話: 呢個 file 係「M9 progress 暫存區」, frontend 撳跑 M9 嗰陣 polling 拎 progress
"""

import time
import uuid
import threading
import logging
from typing import Dict, Any, Optional, Callable
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


# ============================================================
# In-memory progress store (thread-safe)
# ============================================================

# 凡人話: in-memory dict, 拎 request_id 對應 progress dict
# TTL 1 小時自動清 (request 完成 1 小時後 frontend 唔再 polling)
_PROGRESS_STORE: Dict[str, Dict[str, Any]] = {}
_PROGRESS_LOCK = threading.Lock()
_TTL_SECONDS = 3600  # 1 小時


def _cleanup_expired():
    """凡人話: 清 1 小時前嘅 request (避免 in-memory store 越嚟越大)"""
    now = time.time()
    with _PROGRESS_LOCK:
        expired = [
            rid for rid, p in _PROGRESS_STORE.items()
            if now - p.get("updated_at", now) > _TTL_SECONDS
        ]
        for rid in expired:
            del _PROGRESS_STORE[rid]
        if expired:
            logger.info(f"[AlgorithmProgress] 清走 {len(expired)} 個 expired progress entry")


def get_progress(request_id: str) -> Optional[Dict[str, Any]]:
    """凡人話: 拎 request_id 對應嘅 progress dict, 冇就 return None"""
    with _PROGRESS_LOCK:
        return _PROGRESS_STORE.get(request_id)


def _set_progress(request_id: str, **kwargs):
    """凡人話: 內部用, 落 progress dict (thread-safe)"""
    with _PROGRESS_LOCK:
        if request_id not in _PROGRESS_STORE:
            _PROGRESS_STORE[request_id] = {
                "request_id": request_id,
                "status": "running",
                "started_at": time.time(),
                "updated_at": time.time(),
            }
        p = _PROGRESS_STORE[request_id]
        p.update(kwargs)
        p["updated_at"] = time.time()


# ============================================================
# Progress callback factory
# ============================================================

def make_progress_callback(request_id: str) -> Callable[[Dict[str, Any]], None]:
    """凡人話: 建立 progress callback function, 落 request_id 綁定

    Usage (M9 algorithm 入面):
        options["progress_callback"] = make_progress_callback(request_id)
    """
    def _callback(stage_dict: Dict[str, Any]):
        # 凡人話: stage_dict shape: {"stage": "walk_forward_cv", "fold": 2, "total_folds": 3, "candidates_done": 60, "candidates_total": 90, "percent": 66.7}
        # 落 _PROGRESS_STORE 對應 request_id
        _set_progress(
            request_id,
            status="running",
            **stage_dict,
        )
        logger.info(
            f"[AlgorithmProgress] {request_id} progress: {stage_dict}"
        )
    return _callback


# ============================================================
# Spawn M9 with progress (threading)
# ============================================================

def spawn_m9_with_progress(
    algo_name: str,
    symbol: str,
    period: str,
    klines: list,
    options: Dict[str, Any],
    request_id: Optional[str] = None,
) -> str:
    """凡人話: spawn thread 跑 M9, 期間 emit progress 落 in-memory dict

    Returns:
        request_id: 用嚟 polling `/api/algorithms/progress/{request_id}` 拎 progress

    永久 rule (大少 2026-08-31):
    - M9 algorithm 必須用 options['progress_callback'] 拎 progress emit
    - Frontend 撳跑 M9 嗰陣必須拎 request_id, polling progress endpoint
    - M9 跑完之後 status 改 'completed' / 'failed', 1 小時後自動清
    """
    if request_id is None:
        request_id = f"m9_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"

    # Initial progress entry
    _set_progress(
        request_id,
        request_id=request_id,
        algo_name=algo_name,
        symbol=symbol,
        period=period,
        status="running",
        stage="initializing",
        percent=0,
        current_step=0,
        total_steps=5,  # M9 5 個 sub-step
        started_at=time.time(),
        updated_at=time.time(),
    )

    # Inject progress callback 落 options
    options = dict(options)  # copy
    options["progress_callback"] = make_progress_callback(request_id)

    def _thread_target():
        """凡人話: thread 入面跑 M9 algorithm, 期間 emit progress"""
        try:
            from backend.algorithms import get_algorithm
            algo = get_algorithm(algo_name)
            _set_progress(request_id, stage="running_algorithm", percent=1)

            verdict = algo.run(klines, options)

            # M9 跑完, verdict dict 落 progress store 畀 frontend polling
            verdict_dict = {
                "ok": verdict.ok,
                "algorithm": algo_name,
                "version": algo.version,
                "symbol": symbol,
                "period": period,
                "klines_count": len(klines),
                "points": verdict.points,
                "meta": verdict.meta,
                "warnings": verdict.warnings,
                "error": verdict.error,
            }
            _set_progress(
                request_id,
                status="completed",
                stage="done",
                percent=100,
                verdict_dict=verdict_dict,
                completed_at=time.time(),
            )
            logger.info(f"[AlgorithmProgress] {request_id} M9 completed: ok={verdict.ok}")
        except Exception as e:
            _set_progress(
                request_id,
                status="failed",
                stage="error",
                error=f"{type(e).__name__}: {e}",
                completed_at=time.time(),
            )
            logger.exception(f"[AlgorithmProgress] {request_id} M9 failed")

    # Spawn thread (daemon=True, 主 process 死嗰陣 thread 一齊死)
    thread = threading.Thread(target=_thread_target, daemon=True, name=f"m9-{request_id}")
    thread.start()
    logger.info(f"[AlgorithmProgress] Spawned thread for {request_id} (algo={algo_name} symbol={symbol})")

    # Trigger cleanup (non-blocking)
    threading.Thread(target=_cleanup_expired, daemon=True).start()

    return request_id

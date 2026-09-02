"""
backend/tests/test_algorithm_progress_cleanup.py — algorithm_progress.py 死碼 thread leak 永久 fix (大少 2026-09-02 21:14)

凡人話: algorithm_progress.py 拎走 per-request cleanup thread (死碼 leak)
- 永久 rule: 拎走死碼 thread leak
- 之前: 每次 spawn_m9_with_progress 都 spawn 1 個 cleanup thread (死碼)
- 之後: module-level 1 次 startup, 整個 process 只 1 個 cleanup thread ✅
"""
import threading

from backend.services import algorithm_progress


def test_algorithm_progress_cleanup_singleton():
    """algorithm_progress.py 拎走 per-request cleanup thread (死碼 leak)"""
    # 清 algorithm_progress module-level state
    algorithm_progress._cleanup_thread_started = False

    # 模擬 50 次 spawn_m9_with_progress (冇真實 progress, 只係 trigger cleanup)
    # 註: production 冇 caller, 但係 test 模擬觸發
    for i in range(50):
        try:
            rid = algorithm_progress.spawn_m9_with_progress(
                algo_name="back_test",
                symbol=f"TEST.{i:05d}",
                period="1d",
                klines=[],
                options={},
                request_id=f"test_{i}",
            )
        except Exception:
            pass  # Mock 失敗 OK (冇真實 klines)

    # Verify 只有 1 個 cleanup thread
    cleanup_threads = sum(
        1 for t in threading.enumerate() if t.name == "algorithm-progress-cleanup"
    )
    assert cleanup_threads <= 1, (
        f"Thread leak: 應該只有 1 個 singleton cleanup thread, 但有 {cleanup_threads} 個"
    )

"""
StockPulse Plates API
======================

Endpoints for plate (板塊) data + popularity.

Endpoints
---------
- GET  /api/plates           — List plates (top N by default, or search)
- GET  /api/plates/status    — Get popularity calc status
- POST /api/plates/refresh-popularity — Trigger background recompute

Usage (frontend)
----------------
    // Get top 50 most popular plates
    const res = await fetch('/api/plates?limit=50');
    
    // Search for 半導體
    const res = await fetch('/api/plates?q=半導體&limit=20');
    
    // Trigger refresh (大少個「制」)
    const res = await fetch('/api/plates/refresh-popularity', { method: 'POST' });
    
    // Check status
    const res = await fetch('/api/plates/status');
"""
import logging
import subprocess
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

# 大少 2026-07-25 龍頭板塊 reset: 讀 PLATES_PIPELINE_DISABLED flag
# (single source of truth in config.py) 用嚟 endpoint / scripts early-exit
from backend.config import PLATES_PIPELINE_DISABLED

# 大少 2026-07-25 22:04: custom order file (active, 可被 UI drag 修改)
CUSTOM_ORDER_FILE = Path("/Users/zmenai/stockpulse/backend/data/plate_custom_order.json")

# 大少 2026-07-26 08:36: 一鍵還原 immutable reference
# /api/plates/restore-default 從呢度讀 default → 寫返 custom_order.json
IMMUTABLE_DEFAULT_FILE = Path("/Users/zmenai/stockpulse/backend/data/plate_immutable_default.json")

# Import plate model (CRUD functions)
# 用 `backend.models.plate` 因為 main.py 將 stockpulse/ 加入 sys.path
# 同 api/stocks.py, api/group.py 嘅 pattern 一致
from backend.models.plate import (
    init_plates_table,        # 確保 table 存在
    get_top_plates,
    search_plates,
    get_popularity_status,
    get_all_plates_count,
    is_current_order_default, # 大少 2026-07-26: 一鍵還原 is_default 判斷
    run_plate_leaders,        # AS-01 板塊龍頭股 ranking (大少 2026-07-23)
)

# Initialize table on import (idempotent, safe to call multiple times)
init_plates_table()

router = APIRouter(prefix="/plates", tags=["plates"])
log = logging.getLogger(__name__)

# ============================================================================
# Paths (用嚟 trigger compute_popularity.py)
# ============================================================================
SCRIPTS_DIR = Path(__file__).parent.parent / "scripts"
COMPUTE_SCRIPT = SCRIPTS_DIR / "compute_popularity.py"
PYTHON_BIN = Path.home() / ".futu_venv" / "bin" / "python3"


# ============================================================================
# Endpoints
# ============================================================================

@router.get("")
async def list_plates(
    q: str | None = Query(None, description="搜尋板塊名 (case-insensitive partial match)"),
    limit: int = Query(50, ge=1, le=500, description="Max plates to return (default 50)"),
    include_non_stock: bool = Query(
        False,
        description=(
            "是否 include non-stock plate (大少 2026-07-24 instruction). "
            "False = 只 return stock 板塊 (default), "
            "True = include 指數/ETF/REIT/bond/warrant/structured"
        ),
    ),
):
    """
    攞板塊 list.

    Without ?q: return top N plates by popularity_rank (default 50).
    With ?q=半導體: search by name, ranked plates first, unranked 後.

    大少 2026-07-24 instruction:
    - 預設 filter 走 non-stock plate (指數/ETF/REIT/bond/warrant/structured)
    - Frontend 有 toggle 控制 include_non_stock=true 顯示全部
    """
    if q:
        plates = search_plates(q, limit=limit, include_non_stock=include_non_stock)
    else:
        plates = get_top_plates(limit=limit, include_non_stock=include_non_stock)
    # 大少 2026-07-26 08:36: is_default flag 俾前端 disable reset button
    is_default = is_current_order_default()
    return {
        "plates": plates,
        "count": len(plates),
        "total_active": get_all_plates_count(),
        "include_non_stock": include_non_stock,
        "is_default": is_default,
    }


@router.get("/status")
async def status():
    """
    Get popularity calc status (用嚟 display "Last updated" + button state 喺 UI).

    Returns:
        {
            "total": 275,         # 總 active plates
            "ranked": 275,        # 已計算 popularity
            "last_updated": "2026-07-23 08:30:00"  # NULL if never computed
        }
    """
    return get_popularity_status()


@router.post("/restore-default")
async def restore_default():
    """
    一鍵還原 排位到 default (大少 2026-07-26 08:36 instruction).

    邏輯 (大少 #7394):
    1. 讀 plate_immutable_default.json (38 個 immutable reference)
    2. 寫返 plate_custom_order.json (active custom order)
    3. 如果 custom order 已經 = immutable default → no-op
    4. 舊 file 備份到 ~/.Trash/ (recoverable)

    對比舊版 (大少 2026-07-25 22:04): 舊版係 delete file → fallback 231 random,
    呢個係 restore 返 #7394 大少 specified 嘅 38 個 default order.
    """
    if not IMMUTABLE_DEFAULT_FILE.exists():
        log.error("IMMUTABLE_DEFAULT_FILE missing: %s", IMMUTABLE_DEFAULT_FILE)
        raise HTTPException(
            status_code=500,
            detail="Immutable default file missing — backend bug. Check data/plate_immutable_default.json"
        )

    # 讀 immutable default order
    import json as _json
    try:
        with open(IMMUTABLE_DEFAULT_FILE, "r", encoding="utf-8") as f:
            default_data = _json.load(f)
        default_order = default_data.get("order", [])
    except Exception as e:
        log.error("Failed to read immutable default: %s", e)
        raise HTTPException(500, f"Immutable default file corrupt: {e}")

    if not default_order:
        raise HTTPException(500, "Immutable default file has empty order list")

    # 讀 current custom order (如果存在)
    current_order = None
    if CUSTOM_ORDER_FILE.exists():
        try:
            with open(CUSTOM_ORDER_FILE, "r", encoding="utf-8") as f:
                current_data = _json.load(f)
            current_order = current_data.get("order", [])
        except Exception as e:
            log.warning("Failed to read current custom order (will overwrite): %s", e)

    # 已經係 default → no-op
    if current_order == default_order:
        log.info("restore-default no-op: current order already matches immutable default")
        return {
            "status": "no-op",
            "message": "已經係 default 排位, 唔需要還原",
            "is_default": True,
            "count": len(default_order),
        }

    # Backup 舊 file 到 ~/.Trash/ (recoverable)
    backup_path = None
    if CUSTOM_ORDER_FILE.exists():
        import shutil
        from datetime import datetime as _dt
        trash_dir = Path.home() / ".Trash"
        trash_dir.mkdir(exist_ok=True)
        backup_name = f"plate_custom_order.json.{int(_dt.now().timestamp())}.bak"
        backup_path = trash_dir / backup_name
        shutil.copy2(str(CUSTOM_ORDER_FILE), str(backup_path))
        log.info("Old custom order backed up to: %s", backup_path)

    # 寫新 custom_order.json (用 immutable default 嘅 38 個)
    new_data = {
        "description": "Custom order restored from immutable default",
        "restored_from": "plate_immutable_default.json",
        "restored_at": datetime.now().isoformat(),
        "unique_count": len(default_order),
        "order": default_order,
    }
    try:
        with open(CUSTOM_ORDER_FILE, "w", encoding="utf-8") as f:
            _json.dump(new_data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log.error("Failed to write custom order: %s", e)
        raise HTTPException(500, f"Failed to write custom order: {e}")

    log.info("Restored %d plates to default order", len(default_order))
    return {
        "status": "restored",
        "message": f"已還原返 default 排位 ({len(default_order)} 個板塊)",
        "is_default": True,
        "restored_count": len(default_order),
        "backup": str(backup_path) if backup_path else None,
    }


@router.post("/refresh-popularity")
async def refresh_popularity():
    """
    觸發重新計算 popularity (大少個「🔄 重新計算」button).

    Runs compute_popularity.py 喺 background (detached process).
    預計 5-15 min 取決於 OpenD throttle + 開市時間.

    Returns immediately with task info. Frontend 之後可以 poll /status check 進度.

    大少 2026-07-25: 龍頭板塊 reset, gate 喺 PLATES_PIPELINE_DISABLED flag
    返 410 + message, frontend usePopularityStatus 應 handle error。
    """
    # 大少 2026-07-25 龍頭板塊 reset: pipeline disabled
    if PLATES_PIPELINE_DISABLED:
        log.warning("refresh-popularity called but PLATES_PIPELINE_DISABLED=True, returning 410")
        raise HTTPException(
            status_code=410,
            detail="Plate popularity pipeline 已停用 (大少 2026-07-25 龍頭板塊 reset)。"
                   "將來重新 enable 改 backend/config.py PLATES_PIPELINE_DISABLED = False。"
        )

    if not COMPUTE_SCRIPT.exists():
        log.error("Script not found: %s", COMPUTE_SCRIPT)
        raise HTTPException(500, f"Script not found: {COMPUTE_SCRIPT}")
    if not PYTHON_BIN.exists():
        log.error("Python not found: %s", PYTHON_BIN)
        raise HTTPException(500, f"Python not found: {PYTHON_BIN}")

    log.info("Triggering compute_popularity.py (refresh request) ...")

    log_file = Path("/tmp/compute_popularity_refresh.log")
    try:
        # start_new_session=True 將 child process 由 parent process group 切開
        # 確保 FastAPI server restart / 唔好殺 child process
        process = subprocess.Popen(
            [str(PYTHON_BIN), "-u", str(COMPUTE_SCRIPT)],
            stdout=open(log_file, "w"),
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,  # ← 關鍵: detach from parent
        )
        log.info("Started compute_popularity PID=%d, log=%s", process.pid, log_file)
        return {
            "status": "started",
            "pid": process.pid,
            "log": str(log_file),
            "estimated_minutes": 15,
            "message": "Refresh started in background. Check /api/plates/status for progress.",
        }
    except Exception as e:
        log.error("Failed to start compute_popularity: %s", e)
        raise HTTPException(500, f"Failed to start: {e}")


# ============================================================================
# AS-01 板塊龍頭股 ranking (POST /run)
# ============================================================================

class RunRequest(BaseModel):
    """
    AS-01 板塊龍頭股 ranking request body.

    大少 2026-07-23: 依 ALGORITHM_SPECS.md AS-01 spec (原本 AS-02 spec rename).
    大少 2026-07-24: 加 debug field for Debug Panel instrumentation.
    """
    plates: list[str] = Field(
        ...,
        description="板塊 codes, e.g. ['HK.LIST1013', 'HK.LIST1044']"
    )
    top_n: int = Field(
        10,
        ge=1,
        le=50,
        description="Top N leaders (default 10, 大少 9:14 instruction)",
    )
    debug: bool = Field(
        False,
        description="啟用 debug instrumentation (collect step-by-step data, 大少 2026-07-24 Debug Panel)",
    )


@router.post("/run")
async def run(req: RunRequest):
    """
    AS-01 板塊龍頭股 Top N ranking (照 ALGORITHM_SPECS.md AS-01 spec).

    邏輯 (2-factor composite score, rank sum 越低越好):
        1. Resolve plates → stock list (multi-plate dedupe by code)
        2. Batch snapshot 攞 mcap + volume
        3. 計 mcap_rank + volume_rank
        4. composite_score = mcap_rank + volume_rank
        5. Sort ASC → top N
        6. Generate reason per leader (e.g. "市值 top 1 (4500億) / 成交 top 1")

    Body: {"plates": ["HK.LIST1013", ...], "top_n": 10}

    Returns:
        {
            "leaders": [{code, name, price, change_pct, mcap, turnover,
                        plate_code, score, mcap_rank, volume_rank, reason}, ...],
            "count": N,
            "ranked_at": "2026-07-23T09:30:00+08:00"
        }
    """
    if not req.plates:
        raise HTTPException(400, "Need at least 1 plate")

    try:
        leaders = run_plate_leaders(req.plates, req.top_n, debug=req.debug)
        return {
            "leaders": leaders,
            "count": len(leaders),
            "ranked_at": datetime.now().isoformat(),
        }
    except Exception as e:
        log.error(f"run_plate_leaders failed: {e}")
        raise HTTPException(500, f"Backend error: {e}")
# StockPulse 主入口
# 只負責啟動，唔好寫具體邏輯

import sys
from datetime import datetime, timezone
from pathlib import Path

# 確保 backend 目錄在 sys.path 中
sys.path.insert(0, str(Path(__file__).parent.parent))

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import HOST, BACKEND_PORT, LOG_DIR, LOG_LEVEL
from api import router as api_router
from api.debug import router as debug_router
from api.saved_runs import router as saved_runs_router
from api.llm_settings import router as llm_settings_router
from api.as02 import router as as02_router
from api.network import router as network_router
from api.adaptive_params import router as adaptive_params_router  # Sprint 2 sub-task 2.6, 大少 16:30
from api.trade_journal import router as trade_journal_router  # Stage 1+ MVP, 大少 11:07
from models.saved_runs import init_saved_runs_table
from models.llm_settings import init_llm_settings_table
from models.algorithm_dq_log import init_algorithm_dq_log_table
# 大少 2026-08-03 #9920: stock_reasons table — generic per-stock HTML reason storage
from models.stock_reasons import init_stock_reasons_table
from models.trade_journal import init_trade_journal_table  # Stage 1+ MVP, 大少 11:07
from utils.network import detect_lan_ip
from ws import router as ws_router, init_futu_connection

# 確保日誌目錄存在
LOG_DIR.mkdir(exist_ok=True)

# 配置日誌
logging.basicConfig(
    level=LOG_LEVEL,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOG_DIR / "stockpulse.log"),
    ],
)

logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 啟動時初始化富途連接
    logger.info("[Startup] 初始化富途連接...")
    init_futu_connection()
    # 大少 2026-07-24: init saved_algorithm_runs table (Saved Runs Library)
    logger.info("[Startup] init saved_algorithm_runs table...")
    init_saved_runs_table()
    # 大少 2026-08-01 #9146: init llm_settings + algorithm_dq_log tables
    logger.info("[Startup] init llm_settings table...")
    init_llm_settings_table()
    logger.info("[Startup] init algorithm_dq_log table...")
    init_algorithm_dq_log_table()
    # 大少 2026-08-03 #9920: stock_reasons table init (Q3 table name)
    logger.info("[Startup] init stock_reasons table...")
    init_stock_reasons_table()
    init_trade_journal_table()  # Stage 1+ MVP, 大少 11:07
    yield
    # 關閉時清理（如果有的話）

# 創建 FastAPI app
app = FastAPI(title="StockPulse", version="0.1.0", lifespan=lifespan)

# CORS - 允許前端訪問
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 開發階段允許所有，生產環境要改
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 掛載路由
app.include_router(api_router, prefix="/api")
app.include_router(debug_router)  # already has prefix="/api/debug"
app.include_router(saved_runs_router)  # already has prefix="/api/saved-runs"
app.include_router(llm_settings_router)  # already has prefix="/api/llm-settings"
app.include_router(as02_router)  # already has prefix="/api/as02"
app.include_router(network_router)  # already has prefix="/api/network"
app.include_router(adaptive_params_router)  # already has prefix="/api/adaptive-params" (Sprint 2 sub-task 2.6, 大少 16:30)
app.include_router(trade_journal_router)  # Stage 1+ MVP, 大少 11:07
app.include_router(ws_router, prefix="/ws")

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "StockPulse"}


# QW-4a (refactor #9699, 2026-08-02): 加 root-level /health endpoint，
# 比 /api/health 多 LAN IP + backend_port + timestamp，方便其他 device / container
# health check（特別係 frontend / miniapp 唔喺 localhost 嘅情況）。
# QW-5 (refactor #9699, 2026-08-02): _detect_lan_ip() 已抽出去 utils/network.py
# 俾 /health 同 /api/network/info 共用 (DRY)。
@app.get("/health")
async def health_lan() -> dict[str, str | int]:
    """Root-level health check — 比 /api/health 多 LAN IP + port + ISO timestamp。
    任何 device / container health probe 都用呢個 endpoint。"""
    return {
        "status": "ok",
        "mac_lan_ip": detect_lan_ip(),
        "backend_port": BACKEND_PORT,
        "timestamp": datetime.now(timezone.utc)
        .astimezone()
        .isoformat(timespec="seconds"),
    }


if __name__ == "__main__":
    import uvicorn
    logger.info(f"啟動 StockPulse on {HOST}:{BACKEND_PORT}")
    uvicorn.run(app, host=HOST, port=BACKEND_PORT)

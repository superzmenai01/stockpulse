# StockPulse 主入口
# 只負責啟動，唔好寫具體邏輯

import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import HOST, BACKEND_PORT, LOG_DIR, LOG_LEVEL
from api import router as api_router
from ws import router as ws_router

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

# 創建 FastAPI app
app = FastAPI(title="StockPulse", version="0.1.0")

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
app.include_router(ws_router, prefix="/ws")

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "StockPulse"}


if __name__ == "__main__":
    import uvicorn
    logger.info(f"啟動 StockPulse on {HOST}:{BACKEND_PORT}")
    uvicorn.run(app, host=HOST, port=BACKEND_PORT)

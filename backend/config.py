# StockPulse 配置模組
# 所有配置集中係呢度，方便修改

from pathlib import Path

# 專案路徑
PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"

# Server 配置
HOST = "0.0.0.0"  # 允許外部訪問
BACKEND_PORT = 18792
FRONTEND_PORT = 3000

# FutuOpenD 配置
FUTU_HOST = "127.0.0.1"
FUTU_PORT = 11111
FUTU_PYTHON = Path.home() / ".futu_venv/bin/python3"

# 日誌配置
LOG_DIR = PROJECT_ROOT / "logs"
LOG_LEVEL = "INFO"

# 預設股票池（供測試用）
DEFAULT_STOCKS = ["HK.00700", "HK.00981"]


# 大少 2026-07-25 龍頭板塊 reset:
# Plate pipeline (populate + popularity) 由頭重寫, 暫停。
# - True  = endpoint / scripts early exit (full disable)
# - False = 正常跑 (往後重新 enable)
# Reset 時 == True, 寫完新 pipeline 改返 False。
# 大少 2026-07-25 19:22 populate 完成 (231 rows 入 DB) 改返 True (PA compute 仍未 ready)
PLATES_PIPELINE_DISABLED = True

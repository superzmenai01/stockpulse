#!/bin/bash
# StockPulse Trigger 啟動腳本

# 確保日誌目錄存在
mkdir -p /Users/zmenai/stockpulse/logs

# 停止舊程序（如果有的話）
PID=$(lsof -i :18792 -t 2>/dev/null)
if [ -n "$PID" ]; then
    echo "$(date): 停止舊程序 PID=$PID" >> /Users/zmenai/stockpulse/logs/launchd.log
    kill $PID 2>/dev/null
    sleep 1
fi

# 啟動新程序
cd /Users/zmenai/stockpulse/backend
echo "$(date): 啟動 StockPulse Trigger" >> /Users/zmenai/stockpulse/logs/launchd.log

PYTHONPATH=/Users/zmenai/stockpulse \
    ~/.futu_venv/bin/python3 -m uvicorn main:app --host 0.0.0.0 --port 18792 \
    >> /Users/zmenai/stockpulse/logs/launchd.log 2>&1

echo "$(date): Trigger 已啟動" >> /Users/zmenai/stockpulse/logs/launchd.log
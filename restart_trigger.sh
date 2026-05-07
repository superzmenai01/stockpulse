#!/bin/bash
# StockPulse Trigger 重啟腳本

PID=$(lsof -i :18792 -t 2>/dev/null)
if [ -n "$PID" ]; then
    echo "停止舊程序 (PID: $PID)..."
    kill $PID
    sleep 1
fi

cd /Users/zmenai/stockpulse/backend
echo "啟動 Trigger..."
PYTHONPATH=/Users/zmenai/stockpulse nohup ~/.futu_venv/bin/python3 -m uvicorn main:app --host 0.0.0.0 --port 18792 > ../trigger.log 2>&1 &

sleep 2
if lsof -i :18792 -t > /dev/null 2>&1; then
    echo "✅ Trigger 已啟動 (port 18792)"
else
    echo "❌ 啟動失敗，查看 trigger.log"
    tail -20 trigger.log
fi
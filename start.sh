#!/bin/bash
# ============================================================================
# StockPulse Backend Launcher (Permanent Fix v2, 2026-07-23 18:00)
# ============================================================================
# 大少永久 fix 方案 v2:
# 1. 殺晒所有 uvicorn + main.py related processes (包括 python main.py 個 child)
# 2. lsof fallback 直接 kill bind port 個 process (無論 command line 係乜)
# 3. sleep 3 確保 kernel 釋放 port
# ============================================================================

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
LOG_FILE="/tmp/sp.log"
PORT=18792

# ============================================================================
# 殺晒所有 related processes (parent + children, broad pattern 殺 python main.py)
# ============================================================================
pkill -9 -f "main.py" 2>/dev/null || true
pkill -9 -f "uvicorn" 2>/dev/null || true
pkill -9 -f "uvicorn main:app" 2>/dev/null || true

# Fallback: lsof 直接 kill bind port 個 process (無論 command line 係乜)
lsof -ti :$PORT 2>/dev/null | xargs -r kill -9 2>/dev/null || true

sleep 3

# 確認 port 真 free (如果仍 in use, 顯示邊個 process 佔住 方便 manual fix)
if lsof -i :$PORT > /dev/null 2>&1; then
    echo "[$(date '+%H:%M:%S')] ❌ Port $PORT still in use after pkill. Manual fix needed."
    lsof -i :$PORT
    exit 1
fi

# ============================================================================
# Start backend
# ============================================================================
cd "$BACKEND_DIR"

if [ "$1" = "--foreground" ]; then
    echo "[$(date '+%H:%M:%S')] Starting StockPulse backend (foreground)..."
    exec ~/.futu_venv/bin/python3 -m uvicorn main:app --host 0.0.0.0 --port $PORT
else
    echo "[$(date '+%H:%M:%S')] Starting StockPulse backend (background)..."
    nohup ~/.futu_venv/bin/python3 -m uvicorn main:app --host 0.0.0.0 --port $PORT > $LOG_FILE 2>&1 < /dev/null &
    disown
    sleep 3

    if lsof -i :$PORT > /dev/null 2>&1; then
        echo "✅ Backend 跑緊喺 http://localhost:$PORT"
        echo "Log file: $LOG_FILE"
        echo ""
        echo "Vite dev server frontend (if running):"
        echo "  - http://localhost:3000/algorithms (StockPulse AS-01 panel)"
        echo ""
        echo "Stop backend:"
        echo "  pkill -9 -f 'main.py'; pkill -9 -f 'uvicorn'"
    else
        echo "❌ Backend 啟動失敗, 睇 $LOG_FILE"
        cat $LOG_FILE
        exit 1
    fi
fi

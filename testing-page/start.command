#!/bin/bash
# ~/stockpulse/testing-page/start.command
#
# StockPulse Algorithm Testing Page — 啟動 script
# 大少 double-click → 自動啟動 server + 開 browser

PORT=8765
URL="http://localhost:$PORT/testing-page/"

# 殺舊 process (如果有)
EXISTING=$(lsof -ti tcp:$PORT 2>/dev/null)
if [ -n "$EXISTING" ]; then
  echo "⚠️  Port $PORT 已經有 process 跑緊 (PID: $EXISTING)"
  kill -9 $EXISTING 2>/dev/null
  sleep 1
fi

echo "🚀 StockPulse Algorithm Testing Page"
echo ""

# Start server in background (nohup + disown = survive terminal close)
cd ~/stockpulse
nohup python3 -m http.server $PORT --directory ~/stockpulse > /tmp/testing-page.log 2>&1 &
SERVER_PID=$!
disown

# Wait + open browser
sleep 1.5
open "$URL"

echo "✅ Server PID: $SERVER_PID"
echo "📌 Opened: $URL"
echo ""
echo "🛑 Stop: ~/stockpulse/testing-page/stop.command"
echo "    或:  lsof -ti tcp:$PORT | xargs kill -9"
echo ""
echo "(可以閂 Terminal — server 喺 background keep 跑)"

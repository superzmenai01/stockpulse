#!/bin/bash
# ~/stockpulse/testing-page/stop.command
# Stop the testing page server

PORT=8765
EXISTING=$(lsof -ti tcp:$PORT 2>/dev/null)
if [ -n "$EXISTING" ]; then
  kill -9 $EXISTING 2>/dev/null
  echo "🛑 Stopped server (PID: $EXISTING)"
else
  echo "ℹ️  No server running on port $PORT"
fi

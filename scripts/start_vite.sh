#!/bin/bash
# ============================================================================
# StockPulse Vite Dev Server Launcher (大少 2026-08-03)
# ============================================================================
# 永久 fix for "Vite 冇起 / frontend 連唔到" — 由 LaunchAgent 管
# 對齊 start_trigger.sh pattern: 殺舊 → 釋 port → 起新
# ============================================================================

set -e

PROJECT_ROOT="/Users/zmenai/stockpulse"
WEB_DIR="$PROJECT_ROOT/web"
LOG_FILE="$PROJECT_ROOT/logs/vite.log"
PORT=3000

# 殺舊 process (防 double-bind 同 zombie)
pkill -9 -f "vite$" 2>/dev/null || true
lsof -ti :$PORT 2>/dev/null | xargs -r kill -9 2>/dev/null || true
sleep 2

# 確保 log dir
mkdir -p "$(dirname "$LOG_FILE")"

# Confirm port 真 free
if lsof -i :$PORT > /dev/null 2>&1; then
    echo "[$(date '+%H:%M:%S')] ❌ Port $PORT still in use after kill. Manual fix needed." | tee -a "$LOG_FILE"
    lsof -i :$PORT | tee -a "$LOG_FILE"
    exit 1
fi

cd "$WEB_DIR"

# 用 absolute path（LaunchAgent 唔繼承 ~/.zshrc 嘅 PATH，唔可以用 env npm/node）
NPM_BIN="/opt/homebrew/bin/npm"
NODE_BIN="/opt/homebrew/bin/node"
if [ ! -x "$NPM_BIN" ] || [ ! -x "$NODE_BIN" ]; then
    echo "[$(date '+%H:%M:%S')] ❌ npm or node not found at /opt/homebrew/bin" | tee -a "$LOG_FILE"
    exit 127
fi

# 將 /opt/homebrew/bin 放 PATH 最前，npm fork 嘅 child (e.g. node for vite bin) 都搵到
export PATH="/opt/homebrew/bin:$PATH"

# exec 將 shell process 換成 npm，signal 直接 forward (SIGTERM/SIGINT 唔會 trap 喺 shell)
exec "$NPM_BIN" run dev >> "$LOG_FILE" 2>&1
#!/bin/bash
# StockPulse Mini App Launcher
cd "$(dirname "$0")"

echo "📈 StockPulse Mini App Backend"
echo "=============================="

# Check if port is in use
if lsof -i :18793 > /dev/null 2>&1; then
  echo "⚠️  Port 18793 is already in use"
  echo "   Trying to find process..."
  lsof -i :18793 | grep LISTEN
  echo ""
  echo "   Kill it with: kill $(lsof -t -i :18793)"
  exit 1
fi

# Check futu package
if ! ~/.futu_venv/bin/python3 -c "import futu" 2>/dev/null; then
  echo "❌ Futu package not found"
  echo "   Run: ~/.futu_venv/bin/pip install futu-api"
  exit 1
fi

# Check flask-cors
if ! ~/.futu_venv/bin/python3 -c "import flask_cors" 2>/dev/null; then
  echo "📦 Installing flask-cors..."
  ~/.futu_venv/bin/pip install flask-cors -q
fi

echo "🚀 Starting backend on http://localhost:18793"
echo "🌐 Open http://localhost:18793 in browser"
echo ""
echo "📋 Features:"
echo "   • 自選列表 (加入/編輯/刪除)"
echo "   • 即時報價"
echo "   • K線圖表"
echo "   • 價格警報"
echo "   • 持倉查看"
echo ""
echo "   Press Ctrl+C to stop"
echo "=============================="

~/.futu_venv/bin/python3 backend/main.py
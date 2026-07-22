#!/Users/zmenai/.futu_venv/bin/python3
"""
StockPulse Mini App Bot - Telegram Bot Commands
Handles /stock command to open Mini App via Web App button

SECURITY: Token and Mini App URL are loaded from .env (NEVER hardcoded).
Copy miniapp/.env.example to miniapp/.env and fill in real values.
"""
import os
import asyncio
import logging
from pathlib import Path
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import Application, CommandHandler, filters

# === ENV CONFIG ===
ENV_FILE = Path(__file__).parent / ".env"

try:
    from dotenv import load_dotenv
    if ENV_FILE.exists():
        load_dotenv(ENV_FILE)
except ImportError:
    pass  # python-dotenv not installed; rely on shell env

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
if not BOT_TOKEN:
    raise RuntimeError(
        "TELEGRAM_BOT_TOKEN not set. "
        f"Copy {ENV_FILE.parent}/.env.example to miniapp/.env and fill in values, "
        "or set TELEGRAM_BOT_TOKEN in your shell environment."
    )

MINIAPP_URL = os.environ.get("MINIAPP_URL", "").strip()
if not MINIAPP_URL:
    raise RuntimeError(
        "MINIAPP_URL not set. "
        f"Copy {ENV_FILE.parent}/.env.example to miniapp/.env and fill in values, "
        "or set MINIAPP_URL in your shell environment."
    )

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def stock_command(update: Update, context):
    """Send Web App button to open StockPulse Mini App"""
    keyboard = [[
        InlineKeyboardButton(
            "📈 開啟 StockPulse",
            web_app=WebAppInfo(url=MINIAPP_URL)
        )
    ]]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await update.message.reply_text(
        "📈 StockPulse Mini App\n\n"
        "選擇下方按鈕打開股票監察工具：\n"
        "• 自選列表\n"
        "• 即時報價\n"
        "• K線圖表\n"
        "• 價格警報\n"
        "• 持倉查看",
        reply_markup=reply_markup
    )

async def start_command(update: Update, context):
    await stock_command(update, context)

async def help_command(update: Update, context):
    await update.message.reply_text(
        "📈 StockPulse Bot Commands:\n\n"
        "/stock - 打開股票監察 Mini App\n"
        "/start - 同上\n"
        "/help - 顯示幫助"
    )

def main():
    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("stock", stock_command))
    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("help", help_command))
    
    print(f"🤖 StockPulse Bot running...")
    print(f"📱 Mini App URL: {MINIAPP_URL}")
    app.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()
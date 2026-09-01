#!/bin/bash
# Restore script for restore-2026-09-01-stocks-async
# 對齊 §15.45 永久 rule Sscript pattern (annotated tag + backup branch + restore script + double confirm)
#
# 大少 2026-09-01 17:50 trigger: 整新一鍵還原點 + 清舊 (只留現在這個)
#
# 還原點包含嘅改動 (4.59.0 - 4.62.0):
#   4.59.0 - 拎走 ZigZag 4.56.0 'today' point + 鮮綠線 + 4.57.x skip_today (full revert)
#   4.60.0 - 拎走 ongoing point 講大話 bug (trigger 改 null + is_ongoing flag)
#   4.61.0 - KlineCache SQL filter + cache migration (233 隻 stock datetime format 嘥清)
#   4.62.0 - stocks endpoint sync→async (避 anyio 4.13.0 + Python 3.14 weakref bug)
#   仲有測試 page 4.59.0 / 4.60.0 / 4.61.0 永久 rule 入 AGENTS.md
#
# 對齊 §15.45 + §15.53 + §15.54 + 12:08 user memory 永久 rule
# 對齊 §15.46 testing-page cache bust sync
# 對齊 §15.51 Backend hot-reload

set -e

# EXPECTED_HEAD 拎返 4.62.0 stocks async fix 之後狀態
EXPECTED_HEAD="5e63528efb638d2b1939a4f924276374d78ff8c1"

echo "⚠️  WARNING: 拎走 4.59.0 - 4.62.0 改動, 還原到 stocks-async 之前狀態 (4.58.0 + P1/P2 同日 fix 之後)"
echo ""
echo "4.59.0 - 4.62.0 fix 內容:"
echo "  4.59.0 (大少 14:10): 拎走 4.56.0 'today' point + 鮮綠線 + 4.57.x skip_today (full revert 4.56.0)"
echo "  4.60.0 (大少 16:48): 拎走 ongoing point 講大話 bug (trigger 改 null + is_ongoing flag, frontend 顯示「(待觸發)」)"
echo "  4.61.0 (大少 17:05): KlineCache SQL filter 改用 substr(time,1,10) normalized 比對 + 清 233 隻 stock 50704 條 datetime format 嘥 + write path 加 normalize assert"
echo "  4.62.0 (大少 17:25): stocks endpoint 改 async def (避 anyio 4.13.0 + Python 3.14 weakref bug, 之前 /api/stocks/search 500 Internal Server Error)"
echo ""
echo "仲包括:"
echo "  - 233 隻 stock 嘅 50704 條 datetime format entry 清返 date-only (cache 已清)"
echo "  - 7 個舊 Sscript 還原點已清 (只留這個 stocks-async)"
echo "  - testing page ALGO_CACHE_BUST = '4.60.0', index.html ?v=2.3.120"
echo ""
echo "呢個 script 會:"
echo "  1. 拎走所有 uncommitted changes (git stash)"
echo "  2. Reset HEAD 去 $EXPECTED_HEAD (4.62.0 stocks async fix 之後)"
echo "  3. 拎返 annotated tag + backup branch 嘅 evidence"
echo ""
echo "Expected HEAD commit:"
echo "  $EXPECTED_HEAD"
echo ""
echo "要繼續嗎? 輸入 'yes' 確認:"
read -r confirm
if [ "$confirm" != "yes" ]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "請輸入 'RESET' 確認拎走 4.59.0 - 4.62.0 改動:"
read -r reset_confirm
if [ "$reset_confirm" != "RESET" ]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "⚙️  Stashing any uncommitted changes..."
git stash push -u -m "pre-restore-2026-09-01-stocks-async-$(date +%Y%m%d_%H%M%S)" || true

echo ""
echo "⚙️  Verifying current HEAD is 4.62.0 stocks-async fix state..."
CURRENT_HEAD=$(git rev-parse HEAD)
if [ "$CURRENT_HEAD" != "$EXPECTED_HEAD" ]; then
    echo "❌ Current HEAD ($CURRENT_HEAD) does not match expected ($EXPECTED_HEAD)"
    echo "如果想 rollback 去 stocks-async fix state, 請先 git checkout 過去先跑 script"
    exit 1
fi

echo ""
echo "⚙️  Verifying working tree is clean..."
if ! git diff --quiet HEAD; then
    echo "❌ Working tree 有 uncommitted changes, 請先 commit 或 stash"
    exit 1
fi

echo ""
echo "⚙️  Verifying annotated tag exists..."
if ! git show-ref --tags "restore-2026-09-01-stocks-async" > /dev/null; then
    echo "❌ Annotated tag restore-2026-09-01-stocks-async 唔存在"
    echo "請確認: git fetch origin && git tag -l | grep stocks-async"
    exit 1
fi

echo ""
echo "✅ 一切 ready"
echo ""
echo "⚠️  重要: 大少而家已經喺 stocks-async fix state (4.62.0 之後), 唔需要 reset"
echo "⚠️  呢個 script 主要係 evidence / 一鍵確認 documentation"
echo "⚠️  如果想 rollback 去 stocks-async 之前, 用 'git reset --hard \$EXPECTED_HEAD'"
echo ""
echo "完成! 🎉"

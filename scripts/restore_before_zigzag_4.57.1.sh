#!/bin/bash
# Restore script for restore-before-zigzag-4.57.1
# 對齊 §15.45 永久 rule Sscript pattern (annotated tag + backup branch + restore script + double confirm)
#
# 大少 8月31日 21:29 trigger: P point 同 trigger 唔可以同一個 K 線 (intra-bar volatility 邊界 case BUG FIX)
# 大少 8月31日 21:46 trigger: 先做備份 + 一鍵復原, 之後先做 BUG FIX
#
# 對齊 §15.45 + §15.53 + §15.54 + 12:08 user memory 永久 rule

set -e

# EXPECTED_HEAD 拎返 4.57.0 完成 commit (即係 4.57.1 BUG FIX 之前最後狀態)
# 對齊 4.56.0 規則, EXPECTED_HEAD 應該係 4.57.0 push 嗰個 commit
EXPECTED_HEAD="73c4039641543b4c39d017c1d5888412d30d755e"

echo "⚠️  WARNING: 拎走 4.57.1 BUG FIX 改動, 還原到 before-zigzag-4.57.1"
echo ""
echo "呢個 script 會:"
echo "  1. 拎走所有 uncommitted changes (git stash)"
echo "  2. Reset HEAD 去 $EXPECTED_HEAD (4.57.1 BUG FIX 之前最後狀態, 即係 4.57.0 + Spec Sync commits)"
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
echo "請輸入 'RESET' 確認拎走 4.57.1 BUG FIX 改動 (P point 同 trigger 唔可以同一個 K 線):"
read -r reset_confirm
if [ "$reset_confirm" != "RESET" ]; then
    echo "Cancelled."
    exit 0
fi

# 1. Stash uncommitted changes
echo ""
echo "📦 拎走 uncommitted changes..."
git stash push -m "auto-stash before restore-before-zigzag-4.57.1"

# 2. Reset HEAD
echo ""
echo "🔄 Reset HEAD 去 $EXPECTED_HEAD..."
git reset --hard $EXPECTED_HEAD

# 3. Verify
echo ""
echo "✅ 已還原到 before-zigzag-4.57.1"
echo ""
echo "最近 3 個 commits:"
git log --oneline -3
echo ""
echo "記住:"
echo "  - backend 要 restart 先 load 對應 code (§15.51 永久 rule: ./start.sh)"
echo "  - testing page cache bust 4.57.0 + ?v=2.3.117 (reload 先見到對應 frontend code)"
echo "  - 要拎返 4.57.1 改動: 撳 Backup Admin Page (~/stockpulse/backup-admin/index.html) §15.54 + git pull + 重新 commit"
echo ""
echo "✅ Restore 完成!"

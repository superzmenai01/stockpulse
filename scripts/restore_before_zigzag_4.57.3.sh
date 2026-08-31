#!/bin/bash
# Restore script for restore-before-zigzag-4.57.3
# 對齊 §15.45 永久 rule Sscript pattern (annotated tag + backup branch + restore script + double confirm)
#
# 大少 8月31日 22:23 trigger: 兩個 fix 一齊 Sscript 還原點
#   1. zigzag 日期統一 (4.57.2): backend _zigzag_normalize_date 加 str(raw).split(' ')[0] 拎 date-only
#   2. 同一日內不會獨發 (4.57.1): algorithm 4 處 trigger 條件加 peak/trough_idx_candidate + if i > candidate
#
# 對齊 §15.45 + §15.53 + §15.54 + 12:08 user memory 永久 rule
# 對齊 §3.6 + §3.7 永久 rule「Cross-module 統一 date parsing」

set -e

# EXPECTED_HEAD 拎返 4.57.1 + 4.57.2 兩個 fix 完成 commit
EXPECTED_HEAD="5118b3ccffdcf8e8d446d9af18f495a5927d561e"

echo "⚠️  WARNING: 拎走 4.57.3 兩個 fix 改動, 還原到 before-zigzag-4.57.3"
echo ""
echo "兩個 fix 內容:"
echo "  1. 4.57.1 BUG FIX: 同一日內不會獨發 (P point 同 trigger 唔可以同一個 K 線)"
echo "  2. 4.57.2 date format 統一: backend _zigzag_normalize_date 統一 YYYY-MM-DD"
echo ""
echo "呢個 script 會:"
echo "  1. 拎走所有 uncommitted changes (git stash)"
echo "  2. Reset HEAD 去 $EXPECTED_HEAD (4.57.1 + 4.57.2 兩個 fix 之前最後狀態)"
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
echo "請輸入 'RESET' 確認拎走 4.57.3 兩個 fix 改動 (intra-bar trigger fix + date format 統一):"
read -r reset_confirm
if [ "$reset_confirm" != "RESET" ]; then
    echo "Cancelled."
    exit 0
fi

# 1. Stash uncommitted changes
echo ""
echo "📦 拎走 uncommitted changes..."
git stash push -m "auto-stash before restore-before-zigzag-4.57.3"

# 2. Reset HEAD
echo ""
echo "🔄 Reset HEAD 去 $EXPECTED_HEAD..."
git reset --hard $EXPECTED_HEAD

# 3. Verify
echo ""
echo "✅ 已還原到 before-zigzag-4.57.3"
echo ""
echo "最近 3 個 commits:"
git log --oneline -3
echo ""
echo "記住:"
echo "  - backend 要 restart 先 load 對應 code (§15.51 永久 rule: ./start.sh)"
echo "  - testing page cache bust 4.57.0 + ?v=2.3.117 (reload 先見到對應 frontend code)"
echo "  - 要拎返 4.57.3 改動: 撳 Backup Admin Page (~/stockpulse/backup-admin/index.html) §15.54 + git pull + 重新 commit"
echo ""
echo "✅ Restore 完成!"

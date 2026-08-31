#!/bin/bash
# Restore script for backup-before-zigzag-4.56.0
# 對齊 §15.45 永久 rule Sscript pattern (annotated tag + backup branch + restore script + double confirm)
#
# 大少 8月31日 15:19 trigger: P1 拎 K 線最後 close (今日 8月31日)
# 大少 8月31日 15:26 trigger: 必先做備份 + 一鍵還原, 然後先做 implementation
# 大少 8月31日 15:28 trigger: 大少去 backup admin page 見唔到新還原點, trigger 落實 step 0
#
# 對齊 §15.45 + §15.53 + §15.54 永久 rule

set -e

# EXPECTED_HEAD 拎返 tag 對應嘅 commit (1fca411b 4.55.0 fix 之前最後狀態)
EXPECTED_HEAD="1fca411b02c4138ef14fedb89d7dbd62bf4af8d1"

echo "⚠️  WARNING: 拎走 4.56.0 改動, 還原到 before-zigzag-4.56.0"
echo ""
echo "呢個 script 會:"
echo "  1. 拎走所有 uncommitted changes (git stash)"
echo "  2. Reset HEAD 去 $EXPECTED_HEAD (4.55.0 fix 之前最後狀態, 即係 4.55.0 + 4.54.0 + 4.53.0 + Spec Sync commits)"
echo "  3. 拎返 annotated tag + backup branch 嘅 evidence"
echo ""
echo "Expected HEAD commit:"
echo "  1fca411b fix(testing-page): M1 console log P1-P10 排法 (verdict.points 排法搞錯, 4.55.0)"
echo ""
echo "要繼續嗎? 輸入 'yes' 確認:"
read -r confirm
if [ "$confirm" != "yes" ]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "請輸入 'RESET' 確認拎走 4.56.0 改動 (P1 加 today point + 6 個 caller filter + Spec Sync):"
read -r reset_confirm
if [ "$reset_confirm" != "RESET" ]; then
    echo "Cancelled."
    exit 0
fi

# 1. Stash uncommitted changes
echo ""
echo "📦 拎走 uncommitted changes..."
git stash push -m "auto-stash before restore-before-zigzag-4.56.0"

# 2. Reset HEAD
echo ""
echo "🔄 Reset HEAD 去 $EXPECTED_HEAD..."
git reset --hard $EXPECTED_HEAD

# 3. Verify
echo ""
echo "✅ 已還原到 before-zigzag-4.56.0"
echo ""
echo "最近 3 個 commits:"
git log --oneline -3
echo ""
echo "記住:"
echo "  - backend 要 restart 先 load 對應 code (§15.51 永久 rule: ./start.sh)"
echo "  - testing page cache bust 4.55.0 + ?v=2.3.116 (reload 先見到對應 frontend code)"
echo "  - 要拎返 4.56.0 改動: 撳 Backup Admin Page (~/stockpulse/backup-admin/index.html) §15.54 + git pull + 重新 commit"
echo ""
echo "✅ Restore 完成!"

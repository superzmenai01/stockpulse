#!/bin/bash
# Restore script for restore-before-zigzag-4.58.0
# 對齊 §15.45 永久 rule Sscript pattern (annotated tag + backup branch + restore script + double confirm)
#
# 大少 2026-09-01 11:00 trigger: P1/P2 同日 bug fix (紫色 P point 跳過今日 partial bar + algorithm_runner is_stale 改用 today)
#
# 對齊 §15.45 + §15.53 + §15.54 + 12:08 user memory 永久 rule
# 對齊 K-line Cache 8月22日永久 rule「T-1 rule: 今日 bar 唔寫 DB, 只喺 response 出」嘅精神
# 對齊 4.15.0 永久 rule「之字拎 point 同 trigger 都用 high/low」
# 對齊 4.16.0 永久 rule「永遠用 clean state machine, 唔好分 2 loop」
# 對齊 4.43.0 永久 rule「ZigZag 全部 backend 計」
# 對齊 4.56.0 永久 rule「加今日 close 做 P1」

set -e

# EXPECTED_HEAD 拎返 4.58.0 fix 之前最後狀態 (4.57.3)
EXPECTED_HEAD="a97f9e9fd866e3a843111fb77e48f8938faa1a59"

echo "⚠️  WARNING: 拎走 4.58.0 P1/P2 同日 bug fix 改動, 還原到 before-zigzag-4.58.0"
echo ""
echo "4.58.0 fix 內容:"
echo "  1. backend/algorithms/zigzag/algorithm.py 加 _is_today_partial helper + calculate_zigzag 跳過今日 partial bar"
echo "     (first loop + second loop 改用 end_idx, 拎走原本 `len(result) <= 1` early return)"
echo "  2. backend/services/algorithm_runner.py is_stale 判斷由 t_minus_1 改用 today"
echo "     (原本因為 KlineCache T-1 rule 永遠 False, 永遠唔 trigger get_or_fetch 拎今日 partial bar)"
echo "  3. backend/algorithms/zigzag/__tests__/test_skip_today.py 加 7 個 unit test case (7/7 pass)"
echo ""
echo "呢個 script 會:"
echo "  1. 拎走所有 uncommitted changes (git stash)"
echo "  2. Reset HEAD 去 $EXPECTED_HEAD (4.58.0 fix 之前最後狀態)"
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
echo "請輸入 'RESET' 確認拎走 4.58.0 P1/P2 同日 bug fix 改動 (algorithm.py + algorithm_runner.py + unit test):"
read -r reset_confirm
if [ "$reset_confirm" != "RESET" ]; then
    echo "Cancelled."
    exit 0
fi

# 1. Stash uncommitted changes
echo ""
echo "📦 拎走 uncommitted changes..."
git stash push -m "auto-stash before restore-before-zigzag-4.58.0"

# 2. Reset HEAD
echo ""
echo "🔄 Reset HEAD 去 $EXPECTED_HEAD..."
git reset --hard $EXPECTED_HEAD

# 3. Verify
echo ""
echo "✅ 已還原到 before-zigzag-4.58.0"
echo ""
echo "最近 3 個 commits:"
git log --oneline -3
echo ""
echo "記住:"
echo "  - backend 要 restart 先 load 對應 code (§15.51 永久 rule: ./start.sh)"
echo "  - testing page frontend 100% fetch backend 拎 verdict, frontend 唔需要改 (對齊 4.43.0 永久 rule)"
echo "  - 要拎返 4.58.0 改動: 撳 Backup Admin Page (~/stockpulse/backup-admin/index.html) §15.54 + git pull + 重新 commit"
echo ""
echo "✅ Restore 完成!"

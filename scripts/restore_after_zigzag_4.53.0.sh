#!/bin/bash
# scripts/restore_after_zigzag_4.53.0.sh — ZigZag 4.53.0 拎走橙旗後還原點一鍵還原 (大少 2026-08-31 11:59 trigger)
#
# 凡人話: 4.53.0 拎走 ZigZag 橙旗決定點 + 鮮綠線 + P 點 sequence marker 之後嘅最終狀態,set 還原點。
#         如果之後改到一半發現唔啱,或者意外 break 咗,跑呢個 script 立即還原到拎走橙旗後嘅狀態。
#
# 還原點: 7a424c58 (ZigZag 4.53.0 拎走橙旗之後最後狀態,chart 完全乾淨)
#         tag:    restore-after-zigzag-4.53.0
#         branch: backup-after-zigzag-4.53.0
#
# ⚠️ 永久 rule (大少 2026-08-31 11:59,對齊 8月31日 07:52 §15.45 Sscript pattern):
#  - 此 script 用 git reset --hard 會 destroy main 上面所有新 commit (包括之後嘅 ZigZag 改動)
#  - 如果想保留之後嘅改動,先用 git stash / git branch 留底,然後再跑還原
#  - 還原之後,tag + branch 仍然存在,可以用 git checkout restore-after-zigzag-4.53.0 切返去看
#  - 之後大項目 (refactor / spec rewrite / framework 升級) 必做還原點 set (annotated tag + branch + 永久 rule entry)
#  - 對齊: ARCHITECTURE.md §15.45 (永久 rule §Q),對齊永久 rule §15.39「還原備份還原點」pattern
#  - 對齊: scripts/restore_sprint_4.sh (大少 8月31日 07:52 trigger 第一個 Sscript)
#  - 大少 trigger 11:59: 對齊 Sscript pattern (推薦) — 大少發現我啱啱用 empty commit 嘅備份同 Sscript pattern 唔同,
#    要求對齊之前 8月31日 07:52 trigger 嘅 3-component 還原點 pattern
#
# 對應 plan file: /Users/zmenai/.minimax/v2/sessions/2026/08/31/03-09-26-399-session_bXZzXzI2MmIxYTFmZGQ2MzRjNmU4YjhjOGM5N2NhNmRkZDI0/artifacts/plan.md
# 對應 commit hash:
#   - 7a424c58 (本還原點,4.53.0 之後 empty commit,2 個還原點之中嘅新嗰個)
#   - 5c89c659 (舊還原點,4.53.0 之前最後狀態,拎返橙旗嘅還原點)
#   - 23d0231a (4.53.0 commit,拎走橙旗嗰個)

set -e

RESTORE_TAG="restore-after-zigzag-4.53.0"
RESTORE_BRANCH="backup-after-zigzag-4.53.0"
EXPECTED_HEAD="7a424c58c7180d9cc4617f1ec2f79484a4a9083d"

echo "🚨 ZigZag 4.53.0 拎走橙旗後還原點 reset script"
echo ""
echo "還原點 tag:    $RESTORE_TAG"
echo "還原點 branch: $RESTORE_BRANCH"
echo "還原點 commit: $EXPECTED_HEAD (ZigZag 4.53.0 拎走橙旗後最後狀態,chart 完全乾淨)"
echo ""
echo "⚠️  WARNING: 此 script 會 destroy main 上面所有新 commit (包括之後嘅 ZigZag 改動)"
echo "    如果想保留之後嘅改動,請先 git stash / git branch 留底"
echo ""
read -p "確認還原? 輸入 'yes' 繼續: " confirm

if [ "$confirm" != "yes" ]; then
    echo ""
    echo "❌ 用戶 cancel,唔還原"
    exit 1
fi

# 確認還原點存在
if ! git rev-parse "$RESTORE_TAG" >/dev/null 2>&1; then
    echo "❌ 還原點 tag $RESTORE_TAG 唔存在,唔可以還原"
    echo "   拎返: git fetch origin $RESTORE_TAG"
    exit 1
fi

# 確認 tag 對應 HEAD 啱
actual_head=$(git rev-parse "$RESTORE_TAG")
if [ "$actual_head" != "$EXPECTED_HEAD" ]; then
    echo "⚠️  WARNING: 還原點 HEAD 唔同預期"
    echo "   預期: $EXPECTED_HEAD"
    echo "   實際: $actual_head"
    read -p "繼續? 輸入 'yes': " continue_confirm
    if [ "$continue_confirm" != "yes" ]; then
        echo "❌ Cancel"
        exit 1
    fi
fi

# 確認 working tree clean (避免 destroy uncommitted changes)
if ! git diff-index --quiet HEAD --; then
    echo "❌ Working tree 有 uncommitted changes,請先 commit / stash / 還原手動"
    git status --short
    exit 1
fi

# 撳 confirm reset main
echo ""
echo "🛑  撳最後 confirm: 即將 git reset --hard main 到 $RESTORE_TAG"
echo "    呢個 action 唔可以 undo (reflog 30 日內可以 recover)"
read -p "最後 confirm? 輸入 'RESET': " final_confirm

if [ "$final_confirm" != "RESET" ]; then
    echo ""
    echo "❌ 用戶 cancel,唔還原"
    exit 1
fi

# 執行 reset
git checkout main
git reset --hard "$RESTORE_TAG"

echo ""
echo "✅ 已還原到 $RESTORE_TAG ($EXPECTED_HEAD)"
echo ""
echo "還原點狀態:"
git log --oneline -5
echo ""
echo "如要睇之後嘅改動 (如果已經 commit 過),跑:"
echo "  git log --oneline $RESTORE_TAG..HEAD"
echo "  git diff $RESTORE_TAG..HEAD --stat"
echo ""
echo "如要拎返橙旗 (4.53.0 之前嘅狀態,即拎返橙旗 + 鮮綠線 + P 點 sequence):"
echo "  git reset --hard 5c89c659eda481918101fe8060480ccfdbc1a67a"
echo "  (對齊 8月31日 01:48 永久 rule:大少 trigger「能完全回到那個還原點嗎?」)"

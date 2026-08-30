#!/bin/bash
# scripts/restore_sprint_4.sh — Sprint 4 還原點一鍵還原 (大少 2026-08-31 07:52 trigger)
#
# 凡人話: 大項目 (e.g. Sprint 4 frontend) 開始之前, 我哋會 set 還原點 (annotated tag + branch)
#         如果改到一半發現唔啱, 或者意外 break 咗, 跑呢個 script 立即還原到 set 還原點嗰一刻
#
# 還原點: 7e68053a (架構評審 5 個 batch 全部完成 + push, 267/268 pytest pass)
#         tag:    restore-before-sprint-4-followup
#         branch: backup-before-sprint-4-followup
#
# ⚠️ 永久 rule (大少 2026-08-31 07:52):
#  - 此 script 用 git reset --hard 會 destroy main 上面所有新 commit (包括 Sprint 4 嘅 frontend 改動)
#  - 如果想保留 Sprint 4 改動, 先用 git stash / git branch 留底, 然後再跑還原
#  - 還原之後, tag + branch 仍然存在, 可以用 git checkout restore-before-sprint-4-followup 切返去看
#  - 之後大項目 (refactor / spec rewrite / framework 升級) 必做還原點 set (annotated tag + branch + 永久 rule entry)
#  - 對應: ARCHITECTURE.md §15.45 (永久 rule §Q), 對齊永久 rule §15.39 「還原備份還原點」pattern
#  - 大少 trigger: 8月31日 07:52「你先備份, 設位一個還原點, 當然到意外或不想改時, 可以一鍵完全還到回到現在」

set -e

RESTORE_TAG="restore-before-sprint-4-followup"
RESTORE_BRANCH="backup-before-sprint-4-followup"
EXPECTED_HEAD="7e68053a8d4c0f746d5979367adb166c33622853"

echo "🚨 Sprint 4 還原點 reset script"
echo ""
echo "還原點 tag:    $RESTORE_TAG"
echo "還原點 branch: $RESTORE_BRANCH"
echo "還原點 commit: $EXPECTED_HEAD (架構評審 5 個 batch 全部完成)"
echo ""
echo "⚠️  WARNING: 此 script 會 destroy main 上面所有新 commit (包括 Sprint 4 frontend 改動)"
echo "    如果想保留 Sprint 4 改動, 請先 git stash / git branch 留底"
echo ""
read -p "確認還原? 輸入 'yes' 繼續: " confirm

if [ "$confirm" != "yes" ]; then
    echo ""
    echo "❌ 用戶 cancel, 唔還原"
    exit 1
fi

# 確認還原點存在
if ! git rev-parse "$RESTORE_TAG" >/dev/null 2>&1; then
    echo "❌ 還原點 tag $RESTORE_TAG 唔存在, 唔可以還原"
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
    echo "❌ Working tree 有 uncommitted changes, 請先 commit / stash / 還原手動"
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
    echo "❌ 用戶 cancel, 唔還原"
    exit 1
fi

# 執行 reset
git checkout main
git reset --hard "$RESTORE_TAG"

echo ""
echo "✅ 已還原到 $RESTORE_TAG ($EXPECTED_HEAD)"
echo ""
echo "還原點狀態:"
git log --oneline -3
echo ""
echo "如要睇 Sprint 4 改動 (如果已經 commit 過), 跑:"
echo "  git log --oneline $RESTORE_TAG..HEAD"
echo "  git diff $RESTORE_TAG..HEAD --stat"

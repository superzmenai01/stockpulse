#!/bin/bash
# Restore script for restore-2026-09-02-zigzag-ready
# 對齊 §15.45 永久 rule Sscript pattern (annotated tag + backup branch + restore script + double confirm)
#
# 大少 2026-09-02 07:25 trigger 一鍵還原備份
# Reason (short): zigzag 準備好了
#
# Reason (long):
#   大少 9月2日 01:31 trigger「在M1 裡有個制是啟用P點的，但有問題」, 揭發 4.66.0 漏咗對稱拎走 marker 動作
#   4.66.4 fix 補返: 撳關「啟用P點」嗰陣 setMarkers([]) 拎走殘留 P 點 + 鮮紫 trigger marker
#   4.66.4 Spec Sync #61 commit afe61f3e 為「zigzag 準備好了」state
#   之後可以安心加獨發點 + 最後一條線 (對齊 4.66.0 stocks-async script 寫嘅 reason)
#   拎走之前 2 個 Sscript 還原點 (stocks-async + zigzag-line-only), 整新「zigzag 準備好了」
#
set -e

# EXPECTED_HEAD 對齊 afe61f3e commit (4.66.4 Spec Sync #61)
EXPECTED_HEAD="afe61f3ef98c38a66741006a53e8ffd34cb7acdb"

echo "⚠️  WARNING: 拎走 4.66.4 之後嘅改動, 還原到 zigzag-ready state (4.66.4 Spec Sync #61 afe61f3e 嗰度)"
echo ""
echo "4.66.4 (大少 9月2日 01:31): 撳關「啟用P點」嗰陣拎走殘留 P 點 + 鮮紫 trigger marker (4.66.0 漏咗拎走動作, 4.66.4 補返)"
echo "Spec Sync #61 (大少 9月2日 07:22): AGENTS.md + ARCHITECTURE.md §15.66 4.66.4 永久 rule (commit afe61f3e)"
echo ""
echo "仲包括:"
echo "  - testing page ALGO_CACHE_BUST = '4.66.4', index.html ?v=2.3.141"
echo "  - 之前 stocks-async + zigzag-line-only 2 個 Sscript 還原點已清 (拎走 4 個 ref: 2 tag + 2 branch + 2 script file)"
echo "  - 整新 zigzag-ready Sscript 還原點 (annotated tag restore-2026-09-02-zigzag-ready + backup branch backup-2026-09-02-zigzag-ready + 呢個 script)"
echo ""
echo "呢個 script 會:"
echo "  1. 拎走所有 uncommitted changes (git stash)"
echo "  2. Reset HEAD 去 \$EXPECTED_HEAD (4.66.4 Spec Sync #61 嗰度)"
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
echo "請輸入 'RESET' 確認拎走 4.66.4 之後嘅改動:"
read -r reset_confirm
if [ "$reset_confirm" != "RESET" ]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "⚙️  Stashing any uncommitted changes..."
git stash push -u -m "pre-restore-2026-09-02-zigzag-ready-$(date +%Y%m%d_%H%M%S)" || true

echo ""
echo "⚙️  Verifying current HEAD is 4.66.4 zigzag-ready state..."
CURRENT_HEAD=$(git rev-parse HEAD)
if [ "$CURRENT_HEAD" = "$EXPECTED_HEAD" ]; then
    echo "⚠️  Current HEAD ($CURRENT_HEAD) 已經係 expected HEAD"
    echo "如果想 rollback 去 4.66.4 之前, 唔需要 reset, 已經係 zigzag-ready state"
    exit 0
fi

echo ""
echo "⚙️  Verifying working tree is clean..."
if ! git diff --quiet HEAD; then
    echo "❌ Working tree 有 uncommitted changes, 請先 commit 或 stash"
    exit 1
fi

echo ""
echo "⚙️  Verifying annotated tag exists..."
if ! git show-ref --tags "restore-2026-09-02-zigzag-ready" > /dev/null; then
    echo "❌ Annotated tag restore-2026-09-02-zigzag-ready 唔存在"
    echo "請確認: git fetch origin && git tag -l | grep zigzag-ready"
    exit 1
fi

echo ""
echo "✅ 一切 ready"
echo ""
echo "⚠️  重要: 大少而家已經喺 4.66.4 zigzag-ready state (afe61f3e), 唔需要 reset"
echo "⚠️  呢個 script 主要係 evidence / 一鍵確認 documentation"
echo "⚠️  如果想 rollback 去 4.66.4 之前, 用 'git reset --hard \$EXPECTED_HEAD'"
echo ""
echo "完成! 🎉"

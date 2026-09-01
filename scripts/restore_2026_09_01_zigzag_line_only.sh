#!/bin/bash
# Restore script for restore-2026-09-01-zigzag-line-only
# 對齊 §15.45 永久 rule Sscript pattern (annotated tag + backup branch + restore script + double confirm)
#
# 大少 2026-09-01 22:20 trigger 一鍵還原備份
# Reason (short): cleanup-zigzag-non-line
#
# Reason (long):
#   之前 4.61.0 - 4.61.4 做咗 P 點 + 紅色獨發點 marker + 旗仔 + 鮮綠線 + sequence toggle
#   大少 22:02 改主意「只保留 zigzag 連線, 其他都唔要」
#   4.61.5 final cleanup: 拎走晒所有 non-line visual elements
#
set -e

# EXPECTED_HEAD 對齊 b8a67d6e commit (4.61.5 cleanup commit, stocks-async pattern: tag commit = EXPECTED_HEAD)
# 9月1日 22:30 fix: 之前 amend d72e858f 改 hash 做 b8a67d6e, EXPECTED_HEAD 要對齊新 hash
EXPECTED_HEAD="b8a67d6eb09a7ebf7a92d9494ad0c93330113b45"

echo "⚠️  WARNING: 拎走 4.61.0 - 4.61.5 改動, 還原到 zigzag-line-only state (4.61.5 cleanup commit b8a67d6e 嗰度)"
echo ""
echo "4.61.0 - 4.61.5 改動內容:"
echo "  4.61.0 (大少 17:55): initial 拎返 P 點 + 加新獨發點 marker (setMarkers v4 API)"
echo "  4.61.1 (大少 18:13): fix setMarkers is not a function, 改 v5 plugin API createSeriesMarkers"
echo "  4.61.2 (大少 18:25): HL Structure 1-call pattern + debug log"
echo "  4.61.3 (大少 20:38): fix zOrder 'top' + size 2/1.5 (Mavis browser verify 揾到 root cause)"
echo "  4.61.4 (大少 21:30): C1+C2 cleanup 拎走 stale comments + 拎走 v4 fallback 段"
echo "  4.61.5 (大少 22:02): final cleanup 拎走晒 P 點 + 紅色獨發點 marker + 旗仔 + 鮮綠 ext line + sequence toggle"
echo ""
echo "仲包括:"
echo "  - testing page ALGO_CACHE_BUST = '4.61.5', index.html ?v=2.3.126"
echo "  - AGENTS.md 拎返拎走 4.42.0 旗仔 + 4.51.0 鮮綠色 1 號 marker 永久 rule + 加新 4.61.5 永久 rule"
echo "  - ARCHITECTURE.md 拎返拎走 2 個 stale 鮮綠色 ext line + 1 號 marker reference"
echo ""
echo "呢個 script 會:"
echo "  1. 拎走所有 uncommitted changes (git stash)"
echo "  2. Reset HEAD 去 \$EXPECTED_HEAD (4.61.5 cleanup 嗰度)"
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
echo "請輸入 'RESET' 確認拎走 4.61.0 - 4.61.5 改動:"
read -r reset_confirm
if [ "$reset_confirm" != "RESET" ]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "⚙️  Stashing any uncommitted changes..."
git stash push -u -m "pre-restore-2026-09-01-zigzag-line-only-$(date +%Y%m%d_%H%M%S)" || true

echo ""
echo "⚙️  Verifying current HEAD is 4.61.5 zigzag-line-only state..."
CURRENT_HEAD=$(git rev-parse HEAD)
if [ "$CURRENT_HEAD" = "$EXPECTED_HEAD" ]; then
    echo "⚠️  Current HEAD ($CURRENT_HEAD) 已經係 expected HEAD"
    echo "如果想 rollback 去 4.61.5 之前, 唔需要 reset, 已經係 zigzag-line-only state"
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
if ! git show-ref --tags "restore-2026-09-01-zigzag-line-only" > /dev/null; then
    echo "❌ Annotated tag restore-2026-09-01-zigzag-line-only 唔存在"
    echo "請確認: git fetch origin && git tag -l | grep zigzag-line-only"
    exit 1
fi

echo ""
echo "✅ 一切 ready"
echo ""
echo "⚠️  重要: 大少而家已經喺 4.61.5 cleanup state (b8a67d6e), 唔需要 reset"
echo "⚠️  呢個 script 主要係 evidence / 一鍵確認 documentation"
echo "⚠️  如果想 rollback 去 4.61.5 cleanup 之前, 用 'git reset --hard \$EXPECTED_HEAD'"
echo ""
echo "完成! 🎉"

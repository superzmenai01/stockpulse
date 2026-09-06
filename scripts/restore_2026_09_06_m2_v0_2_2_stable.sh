#!/bin/bash
# Restore script for restore-2026-09-06-m2-v0.2.2-stable
# 對齊 §15.45 永久 rule Sscript pattern (annotated tag + backup branch + restore script + double confirm)
#
# 大少 2026-09-06 12:18 trigger 備份 v0.2.2 stable state
# Reason (short): M2 v0.2.2 stable UI OK
#
# Reason (long):
#   v0.2.0 (大少 11:34): 加短線 mode 60 日 + B 突破 override + consolidation_breakout
#   v0.2.1 (大少 11:45): override 嗰陣同步 update 5 年 metrics (peaks/troughs/structure_score/base_confidence)
#   v0.2.2 (大少 12:02): 放寬 breakoutVolMult 1.3 → 0.85x (對齊 M2 volumeConfirmRatio 0.7 + volumeBoostRatio 1.3 中間值)
#   v0.2.3 (大少 12:09 揀 C 方案): 揾 peak 用 max(weighted, high) + 拎走 alternated 早 return
#     - 雖然 fix 咗 00100/00388/00501 historical high 拎唔到嘅 bug
#     - 但破壞 testing page UI 峰谷標記 + 其他 stock verdict 亂咗
#   v0.2.3 revert (大少 12:15): git revert c29d6008 → commit 2dc1683b
#     - 大少 12:18 confirm UI 返晒正常
#     - 拎 v0.2.2 嘅 stable state 做備份點, 之後再諗點 fix v0.2.3 嘅 bug (00100 peaks 拎唔到 + 00388 high 揾唔到)
#     - 仲有 00981 由橫行變上升加信心超高 (v0.2.2 0.85x 量能太鬆) 之後要 fix
#
set -e

# EXPECTED_HEAD 對齊 v0.2.2 stable state commit (revert v0.2.3 = tag 指向 commit 2dc1683bd5e98cf065f6b7ee51548072be8f1824)
EXPECTED_HEAD="2dc1683bd5e98cf065f6b7ee51548072be8f1824"

echo "⚠️  WARNING: 拎走 v0.2.3 (c29d6008) 之後嘅改動, 還原到 M2 v0.2.2 stable state (revert commit 2dc1683b)"
echo ""
echo "v0.2.2 stable state 包含:"
echo "  - M2 algorithm v0.2.2: 短線 mode 60 日 + B 突破 override vol_mult 0.85x"
echo "  - 19 步算法 (Step 16 短線 mode + Step 17 突破 override + 收縮突破)"
echo "  - v0.2.1 fix: override 嗰陣同步 update 5 年 metrics (避免自相矛盾)"
echo ""
echo "已知 issue (v0.2.2):"
echo "  - 00100 MINIMAX-W (high 1330) / 00501 豪威集團 (high 124.9) peaks 拎唔到 (alternated 唔夠 6 早 return)"
echo "  - 00388 港交所 5月14日 high 423.57 拎唔到 (weighted 而唔係 high 揾 peak)"
echo "  - 00981 (大少 trigger) 由橫行變上升加信心超高 (0.85x 量能太鬆, 之後要 fix)"
echo ""
echo "呢個 script 會:"
echo "  1. 拎走所有 uncommitted changes (git stash)"
echo "  2. Reset HEAD 去 \$EXPECTED_HEAD (v0.2.2 stable state)"
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
echo "請輸入 'RESET' 確認拎走 v0.2.3 revert 之後嘅改動:"
read -r reset_confirm
if [ "$reset_confirm" != "RESET" ]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "🔄 Stashing uncommitted changes..."
git stash push -u -m "auto-stash before restore-2026-09-06-m2-v0.2.2-stable"

echo ""
echo "🔄 Resetting to \$EXPECTED_HEAD..."
git reset --hard "$EXPECTED_HEAD"

echo ""
echo "✅ Done. M2 algorithm 已還原到 v0.2.2 stable state."
echo ""
echo "下一步建議:"
echo "  1. Restart backend: ~/stockpulse/start.sh"
echo "  2. 拎 C 方案 Bug A/B 嘅後續 fix (溫和版, 唔好破壞 UI 峰谷標記)"
echo "  3. 拎 00981 false positive fix (0.85x 量能太鬆, 收緊或者加 condition)"

#!/bin/bash
# Restore script for restore-2026-09-08-warning-v1.3.0-pre
# 對齊 §15.45 永久 rule Sscript pattern (annotated tag + backup branch + restore script + double confirm)
#
# 大少 2026-09-08 09:02 trigger 修補 Module Warning v1.1.0 違規 (Spec Sync #49)
# Reason (short): 拎返 warning system v1.2.0 + M2 v0.4.0 + M3 v0.1.4 (auto-emit category + auto-apply template 改動之前)
#
# Reason (long):
#   v1.1.0 (2026-08-14 11:33): Warning 永久分 2 個 category (system / stock_state)
#     - 永久 rule 要求 backend emit category 字段
#     - 永久 rule 要求 13 個 warning code 嘅 impact/fix 跟 CATEGORY_DISPLAY template
#   v1.2.0 (2026-09-06): M2 self-check warning + M7 weight 折扣 + M2_SKIPPED banner
#     - 5 個 M2 self-check conditions
#     - 永久 rule §M2 self-check weight 0.15 → 0.05
#
#   呢個備份點 = warning system v1.2.0 + M2 v0.4.0 + M3 v0.1.4 stable state
#   之後 v1.3.0 改動出事可以一鍵還原
#
#   v1.3.0 改動 (Spec Sync #49):
#     - backend/services/warning_collector.py: ModuleWarning 加 category 字段 + make_warning() helper 自動 emit + auto-apply template
#     - backend/algorithms/hl_structure/algorithm.py: 10 個 self-check 注入點改用 make_warning()
#     - backend/algorithms/trendline/algorithm.py: 7 個 self-check 注入點改用 make_warning() + 統一 module_id="M3"
#     - docs/research/AS-03-cycle-detection/MODULE-WARNING-SYSTEM.md: v1.2.0 → v1.3.0
#     - docs/research/AS-03-cycle-detection/MODULE-02-HL-STRUCTURE.md: v0.4.0 → v0.5.0
#
set -e

# EXPECTED_HEAD 對應 commit 947b9f06 (Sscript commit) - warning system v1.2.0 + M2 v0.4.0 + M3 v0.1.4 stable state
EXPECTED_HEAD="947b9f06a550bde6e9408106e108df9df862d96b"

echo "⚠️  WARNING: 拎走 v1.3.0 改動, 還原到 warning system v1.2.0 + M2 v0.4.0 + M3 v0.1.4 stable state"
echo ""
echo "v1.2.0 / v0.4.0 / v0.1.4 stable state 包含:"
echo "  - warning_collector.py v1.0.0: make_warning() helper 唔自動 emit category, caller 自己寫 impact/fix"
echo "  - M2 hl_structure/algorithm.py v0.4.0: 10 個 self-check warning 用 raw dict, module_id 唔統一 (5 個 'M2' + 3 個 'hl_structure' + 2 個其他)"
echo "  - M3 trendline/algorithm.py v0.1.4: 7 個 self-check warning 用 raw dict, module_id='trendline' (唔係 'M3')"
echo "  - frontend 拎 warning 用 WARNING_CATEGORIES[code] lookup 推算 category (永久 rule v1.1.0 違規)"
echo "  - frontend 拎 warning 嘅 issue/impact/fix (M3 raw dict 用 top-level, frontend 用 w.debug?.issue 拎唔到)"
echo ""
echo "已知 issue (v1.2.0 / v0.4.0 / v0.1.4):"
echo "  - Backend warning 唔 emit 'category' 字段 (永久 rule v1.1.0 違規)"
echo "  - M2/M3 caller 自己寫 impact/fix string, 唔跟 CATEGORY_DISPLAY template (永久 rule v1.1.0 違規)"
echo "  - M2 module_id 唔統一 ('M2' / 'hl_structure' 混用, 永久 rule v1.0.0 違規)"
echo "  - M3 module_id='trendline' 唔對齊永久 rule v1.0.0 統一 M1-M12 編號"
echo "  - M3 raw dict 結構 (top-level issue/impact/fix/context) frontend 拎唔到 w.debug?.issue 詳細內容"
echo "  - 4 隻 stock 嘅 CONFLICT_STATE warning 之前 fallback 默認為 '🔧 系統警告' (verdict 可能唔可信), 應該分流 '📊 股票狀態提醒'"
echo ""
echo "呢個 script 會:"
echo "  1. 拎走所有 uncommitted changes (git stash)"
echo "  2. Reset HEAD 去 \$EXPECTED_HEAD (warning system v1.2.0 + M2 v0.4.0 + M3 v0.1.4 stable state)"
echo "  3. 拎返 annotated tag + backup branch 嘅 evidence"
echo ""
echo "Expected HEAD commit:"
echo "  $EXPECTED_HEAD"
echo "  $(git log -1 --format='%s' $EXPECTED_HEAD 2>/dev/null || echo 'N/A')"
echo ""
echo "要繼續嗎? 輸入 'yes' 確認:"
read -r confirm
if [ "$confirm" != "yes" ]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "請輸入 'RESET' 確認拎走 v1.3.0 改動:"
read -r reset_confirm
if [ "$reset_confirm" != "RESET" ]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "🔄 Stashing uncommitted changes..."
git stash push -u -m "auto-stash before restore-2026-09-08-warning-v1.3.0-pre"

echo ""
echo "🔄 Resetting to \$EXPECTED_HEAD..."
git reset --hard "$EXPECTED_HEAD"

echo ""
echo "✅ Restore complete. Current HEAD:"
git log -1 --oneline
echo ""
echo "下一步建議:"
echo "  1. Restart backend: ~/stockpulse/start.sh"
echo "  2. Verify M2 verdict: curl 'http://localhost:18792/api/algorithms/run?algo=hl_structure&symbol=HK.00700&data_window_days=1260'"
echo "  3. Verify M3 verdict: curl 'http://localhost:18792/api/algorithms/run?algo=trendline&symbol=HK.00700&data_window_days=1260'"
echo "  4. Re-apply v1.3.0 改動 (warning_collector.py + M2 + M3 + spec doc) — 必先 review root cause"

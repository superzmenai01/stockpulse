#!/bin/bash
# Restore script for restore-2026-09-07-m3-pre-b3-phase1
# 對齊 §15.45 永久 rule Sscript pattern (annotated tag + backup branch + restore script + double confirm)
#
# 大少 2026-09-07 01:07 trigger 備份 Phase 1 之前嘅 stable state (Spec Sync #40 commit dbed0218)
# Reason (short): M3 Spec Sync #40 stable — Phase 1 (B3 Hurst+ADX) 即將做
#
# Reason (long):
#   Spec Sync #37 (6f3c93f2, 大少 9月6日): M2 HL Structure v0.2.0 + Warning v1.2.0 + M7 v1.1.0
#     - M2 5 個 self-check warning conditions (形態見頂/見底/峰谷太舊/5年 vs 短線矛盾/信心太弱/結構破壞)
#     - M7 weight 折扣機制: 拎到 M2 warning 自動 M2 base_weight 0.15 → 0.05
#   AGENTS.md M2 self-check 永久 rule (51f62070, 大少 9月6日 15:08)
#   M3 A+B special rule (b259d1db, 大少 9月7日 00:02): 對齊 spec doc §5 line 109-111
#     - 之前 frontend 舊版 + backend Python port 兩邊都冇 implement 落 code
#     - 影響: HK.00700 / US.GOOGL 由 UP 0.9 (錯) → SIDEWAYS 0.9 (正)
#   M3 dataWindowDays backend 對齊 (febabd99): algorithm options dict 補返呢個 key
#   Spec Sync #39 (b40c225e): 4 份 spec doc sync
#   M3 H guard + self-check warning (7865544f, 大少 9月7日 00:14):
#     - H 真突破 guard: H fire + support_slope <= 0 → SIDEWAYS
#     - 3 個 self-check conditions: 支撐/阻力 numPoints<4 OR R²<0.6 / 通道 widthPct>0.15
#   Spec Sync #40 (dbed0218): 4 份 spec doc + MODULE-03-TRENDLINE.md module spec
#
#   呢個備份點 = Spec Sync #40 完成嘅 stable state (commit dbed0218)
#   之後 Phase 1 (B3 Hurst+ADX gate) 出事可以一鍵還原
#
#   Audit 揭發嘅 M3 問題 (404 隻 stock):
#     - 一致率 28% (M3 同 M1+M2 對唔足)
#     - self-check warning 觸發 84% (M3 結構脆弱)
#     - over-confident 46% (信心過高但 verdict 唔對)
#   Phase 1 目標: 一致率 50%+, self-check 60%-, over-confident 25%-
#
set -e

# EXPECTED_HEAD 對齊 Spec Sync #40 stable state commit (40-hex full SHA)
EXPECTED_HEAD="dbed02182ffbea5c444fb101131b24ff4bfdef9d"

echo "⚠️  WARNING: 拎走 Spec Sync #40 (dbed0218) 之後嘅改動, 還原到 M3 Spec Sync #40 stable state"
echo ""
echo "Spec Sync #40 stable state 包含:"
echo "  - M3 algorithm v0.1.3: H 真突破 guard + 3 個 self-check warning conditions (CONFLICT_STATE)"
echo "  - M3 algorithm v0.1.2: A+B special rule (per spec doc §5 line 109-111)"
echo "  - M3 dataWindowDays backend 對齊 (febabd99)"
echo "  - M2 algorithm v0.2.0: 5 個 self-check warning conditions"
echo "  - M7 algorithm v1.1.0: weight 折扣 + M2_SKIPPED 機制"
echo "  - 4 份 spec doc (AGENTS.md / ARCHITECTURE.md / PROJECT_SPEC.md / README.md) 全部 sync"
echo "  - MODULE-03-TRENDLINE.md / MODULE-02-HL-STRUCTURE.md / MODULE-WARNING-SYSTEM.md module spec sync"
echo ""
echo "已知 issue (Spec Sync #40):"
echo "  - M3 一致率 28% (M3 同 M1+M2 對唔足) — Phase 1 (B3 Hurst+ADX) 即將 fix"
echo "  - M3 self-check warning 觸發 84% (結構脆弱) — Phase 1 目標降至 60%-"
echo "  - M3 over-confident 46% (信心過高但 verdict 唔對) — Phase 1 目標降至 25%-"
echo ""
echo "Phase 1 (B3 Hurst+ADX) 之後嘅改動會被取走:"
echo "  - backend/algorithms/trendline/algorithm.py: 加 compute_hurst() + compute_adx() + Hurst+ADX gate"
echo "  - algorithms/AS-03-cycle-detection/modules/trendline.ts: 1:1 port frontend"
echo "  - docs/research/AS-03-cycle-detection/MODULE-03-TRENDLINE.md: §4.2 Hurst+ADX gate"
echo "  - 4 份 spec doc + Spec Sync #41"
echo ""
echo "呢個 script 會:"
echo "  1. 拎走所有 uncommitted changes (git stash)"
echo "  2. Reset HEAD 去 \$EXPECTED_HEAD (Spec Sync #40 stable state)"
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
echo "請輸入 'RESET' 確認拎走 Phase 1 之後嘅改動:"
read -r reset_confirm
if [ "$reset_confirm" != "RESET" ]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "🔄 Stashing uncommitted changes..."
git stash push -u -m "auto-stash before restore-2026-09-07-m3-pre-b3-phase1"

echo ""
echo "🔄 Resetting to \$EXPECTED_HEAD..."
git reset --hard "$EXPECTED_HEAD"

echo ""
echo "✅ Restore complete. Current HEAD:"
git log -1 --oneline

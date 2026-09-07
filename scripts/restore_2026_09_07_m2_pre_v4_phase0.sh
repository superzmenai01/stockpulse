#!/bin/bash
# Restore script for restore-2026-09-07-m2-pre-v4-phase0
# 對齊 §15.45 永久 rule Sscript pattern (annotated tag + backup branch + restore script + double confirm)
#
# 大少 2026-09-07 11:48 trigger 備份 M2 v0.3.0 (5 self-check + v0.2.0 short_term + breakout)
# Reason (short): M2 v0.3.0 備份 before v0.4.0 5-layer 優化 (Savitzky-Golay / Linear regression / 5-point H&S / BB-KC Squeeze / Hurst+ADX gate)
#
# Reason (long):
#   v0.1.0 (2026-08-07): 初版 18 步算法
#   v0.2.0 (2026-09-06 11:34): 加短線 mode 60 日 + B 突破 override + consolidation_breakout
#     - 救返 10/22 隻 M1 UP + M2 SIDEWAYS conflict stock (00013 / 00019 / 00023 / 00038 / 00070 / 00178 / 00506 / 00003 / 00027 / 00316)
#   v0.2.1 (2026-09-06 11:45): override 嗰陣同步 update 5 年 metrics (避免 cycle 寫 UP 但 score 仲係 0.5 嘅自相矛盾)
#   v0.2.2 (2026-09-06 12:02): 放寬 breakoutVolMult 1.3 → 0.85x (對齊 M2 volumeConfirmRatio 0.7 + volumeBoostRatio 1.3 中間值)
#     - 解決 01888 historical high 升穿 0.876x 量能唔夠嘅 false negative
#   v0.3.0 (2026-09-06 15:10): M2 self-check warning 永久 rule
#     - 5 個 self-check conditions: 形態見頂/見底/峰谷太舊/5年 vs 短線矛盾/信心太弱/結構破壞
#     - M7 拎 M2 warning 即自動降 weight 0.15 → 0.05 + M2_SKIPPED stock_state warning
#
#   呢個備份點 = v0.3.0 嘅 stable state (commit 12d22d67 對應 v0.4.0 改動之前)
#   之後 v0.4.0 5 個 layer 改動出事可以一鍵還原
#
#   v0.4.0 改動 (大少 9月7日 11:45 plan 批准):
#     - Layer 1: Savitzky-Golay filter + prominence 過濾 (峰谷識別 noise 抹走)
#     - Layer 2: Linear regression slope + R² (取代 simple consistency ratio)
#     - Layer 3: 5-point H&S + neckline + measured move (Bulkowski 標準)
#     - Layer 4: Bollinger Band / Keltner Channel Squeeze 確認 (波動壓縮後真突破)
#     - Layer 5: Hurst+ADX gate 跟 M3 永久 rule 對齊
#
set -e

# EXPECTED_HEAD 對齊 working branch HEAD (40-hex full SHA)
# 對應 commit 8b723c46 (Sscript commit) - M2 v0.3.0 algorithm + Sscript, v0.4.0 改動之前
# Reset 返呢個 commit = 拎走 v0.4.0 5 個 layer 改動 + 拎返 v0.3.0 algorithm 嘅 working state
EXPECTED_HEAD="8b723c462008ce5c39739c8e4128d5d8d8fd9bfc"

echo "⚠️  WARNING: 拎走 v0.4.0 改動, 還原到 M2 v0.3.0 stable state"
echo ""
echo "v0.3.0 stable state 包含:"
echo "  - M2 algorithm v0.3.0: 5 個 self-check warning conditions (CONFLICT_STATE / DATA_AGE / FALLBACK_USED / THRESHOLD_BREACH)"
echo "  - M2 algorithm v0.2.2: 短線 mode 60 日 + B 突破 override vol_mult 0.85x + 收縮突破"
echo "  - 19 步算法 (Step 16 短線 mode + Step 17 突破 override + 5 個 self-check)"
echo "  - v0.2.1 fix: override 嗰陣同步 update 5 年 metrics"
echo ""
echo "已知 issue (v0.3.0):"
echo "  - 22 隻 M1 UP + M2 SIDEWAYS conflict stock 只救得返 10 隻 (45%)"
echo "  - 揾 peak/trough 用 simple 左右對比, noise 大易錯"
echo "  - 趨勢分析用「70% 日升」簡單 ratio, random walk 都會誤判"
echo "  - 頭肩頂識別只睇對稱, 冇 neckline 確認"
echo "  - 突破確認淨係 close > peak, 冇波動壓縮確認"
echo "  - 冇 Hurst+ADX gate 跟 M3 對齊"
echo ""
echo "呢個 script 會:"
echo "  1. 拎走所有 uncommitted changes (git stash)"
echo "  2. Reset HEAD 去 \$EXPECTED_HEAD (M2 v0.3.0 stable state)"
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
echo "請輸入 'RESET' 確認拎走 v0.4.0 改動:"
read -r reset_confirm
if [ "$reset_confirm" != "RESET" ]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "🔄 Stashing uncommitted changes..."
git stash push -u -m "auto-stash before restore-2026-09-07-m2-pre-v4-phase0"

echo ""
echo "🔄 Resetting to \$EXPECTED_HEAD..."
git reset --hard "$EXPECTED_HEAD"

echo ""
echo "✅ Restore complete. Current HEAD:"
git log -1 --oneline
echo ""
echo "下一步建議:"
echo "  1. Restart backend: ~/stockpulse/start.sh"
echo "  2. Verify M2 verdict: curl 'http://localhost:18792/api/algorithms/run?algo=hl_structure&symbol=HK.00700'"
echo "  3. Re-apply v0.4.0 5-layer 改動 (Layer 1-5 改動) — 必先 review root cause"

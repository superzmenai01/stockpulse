#!/bin/bash
# Restore script for restore-2026-09-07-m3-spec-sync-45
# 對齊 §15.45 永久 rule Sscript pattern (annotated tag + backup branch + restore script + double confirm)
#
# 大少 2026-09-07 11:38 「Go」trigger 備份 Spec Sync #45 (Layer 1+2+4 對齊權威 source) stable state
# Reason (short): M3 v0.3.0 Spec Sync #45 (Layer 1+2+4 對齊權威 source) — commit 12d22d67 stable
#
# Reason (long):
#   之前 Phase 1 (B3 Hurst+ADX gate) Spec Sync #41 (863bb22b, 大少 9月7日 01:08) 拎走咗 404 隻 stock audit
#   揭發嘅 M3 問題 (一致率 28% / self-check 84% / over-confident 46%)。但 Spec Sync #41 之後仍有改動:
#   - 永久 rule §verdict.meta.symbol 9月7日 7:20 trigger (1e7eddeb, 大少 9月7日 07:20): runner inject caller symbol 落 options
#   - Spec Sync #42 (a6112035, 大少 9月7日 07:50): M2 hl_structure meta.symbol 對齊 runner
#   - Spec Sync #43 (71677711, 大少 9月7日 08:30): M3-M6 verdict meta 加 symbol field 對齊永久 rule
#   - Spec Sync #45 (12d22d67, 大少 9月7日 11:40): M3 Layer 1+2+4 對齊權威 source (Peng 1994 DFA / Wilder 1978 ADX / Bulkowski 2005 chart patterns)
#     - Layer 1: _compute_hurst 改返 (hurst, log_r²) tuple, emit hurstLogR² verify DFA self-similarity
#     - Layer 1: _compute_adx 改返 dict {adx, plus_di, minus_di, atr}, 對齊 Wilder 1978 standard
#     - Layer 1: backend verdict meta 加 5 個新 field: hurstLogR², plusDI, minusDI, atr
#     - Layer 2: Bulkowski 條件 (minR² 0.55→0.6, minLineLength 30, minTouchSpacing 5, maxLineSlope 0.05)
#     - Layer 4: confidence 4 維加權公式 (base 0.6 × R² × touches × volume × self-check penalty, clamp 0.3-0.95, 永久 ban conf=1.0)
#     - 404 stock audit baseline v0.1.4 → v0.3.0: over-confident 77→0 (-100%), SIDEWAYS 矛盾 14→7 (-50%), 罕見 SIDEWAYS 41→0 (-100%), conf≥0.9 94→0 (-100%)
#   跟住 12d22d67 嘅改動: M2 5-layer (d50854ad / 3881f40e / 86dbc2ae / 9d0cdf06 / dc52791c) + Spec Sync #47 (bff9af20) + Sscript (8b723c46 / 690d28cd) + Spec Sync #49 (dba88a24)
#
#   呢個備份點 = Spec Sync #45 完成嘅 stable state (commit 12d22d67)
#   之後 M2 5-layer / Spec Sync #47-49 出事可以一鍵還原
#
set -e

# EXPECTED_HEAD 對齊 Spec Sync #45 stable state commit (40-hex full SHA)
EXPECTED_HEAD="12d22d67360e81db174b7367bf22bc335b9c76b7"

echo "⚠️  WARNING: 拎走 Spec Sync #45 (12d22d67) 之後嘅改動, 還原到 M3 Spec Sync #45 stable state"
echo ""
echo "Spec Sync #45 stable state 包含:"
echo "  - M3 algorithm v0.3.0: Layer 1 (DFA + ADX 對齊 Peng 1994 / Wilder 1978) + Layer 2 (Bulkowski 條件)"
echo "  - M3 algorithm v0.3.0: Layer 4 confidence 4 維加權公式 (永久 ban conf=1.0, clamp 0.3-0.95)"
echo "  - M3 algorithm v0.3.0: 5 個新 meta field: hurstLogR² / plusDI / minusDI / atr / gatePass"
echo "  - M3 algorithm v0.1.4: Hurst+ADX gate (Step 0.5, H<0.45/ADX<20 → SIDEWAYS)"
echo "  - M3 algorithm v0.1.3: H 真突破 guard + 3 個 self-check warning (CONFLICT_STATE)"
echo "  - M3 algorithm v0.1.2: A+B special rule (per spec doc §5 line 109-111)"
echo "  - Spec Sync #41-#43 永久 rule fix: verdict.meta.symbol 對齊 caller symbol"
echo "  - 4 份 spec doc (AGENTS.md / ARCHITECTURE.md / PROJECT_SPEC.md / README.md) 全部 sync"
echo "  - MODULE-03-TRENDLINE.md / MODULE-02-HL-STRUCTURE.md / MODULE-WARNING-SYSTEM.md module spec sync"
echo ""
echo "已知 Spec Sync #45 baseline (404 stock audit):"
echo "  - over-confident 77 → 0 隻 (-100%)"
echo "  - SIDEWAYS 矛盾 14 → 7 隻 (-50%)"
echo "  - 罕見 SIDEWAYS 41 → 0 隻 (-100%)"
echo "  - conf ≥ 0.9 嘅 94 → 0 隻 (-100%)"
echo "  - 永久 ban conf=1.0"
echo ""
echo "Spec Sync #45 之後嘅改動會被取走:"
echo "  - backend/algorithms/hl_structure/algorithm.py: 加 5-layer 改動 (Savitzky-Golay / Linear regression / H&S / BB/KC / Hurst+ADX)"
echo "  - docs/research/AS-03-cycle-detection/MODULE-02-HL-STRUCTURE.md: v0.4.0 5-layer 改動"
echo "  - AGENTS.md / ARCHITECTURE.md: §15.58 「先備份, 後動工」永久 rule (bff9af20)"
echo "  - AGENTS.md: §「Backend config file 壞咗即死火」永久 rule (dba88a24)"
echo "  - scripts/: Sscript M2 v0.3.0 還原點 (8b723c46) + EXPECTED_HEAD fix (690d28cd)"
echo ""
echo "呢個 script 會:"
echo "  1. 拎走所有 uncommitted changes (git stash)"
echo "  2. Reset HEAD 去 \$EXPECTED_HEAD (Spec Sync #45 stable state)"
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
echo "請輸入 'RESET' 確認拎走 Spec Sync #45 之後嘅改動:"
read -r reset_confirm
if [ "$reset_confirm" != "RESET" ]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "🔄 Stashing uncommitted changes..."
git stash push -u -m "auto-stash before restore-2026-09-07-m3-spec-sync-45"

echo ""
echo "🔄 Resetting to \$EXPECTED_HEAD..."
git reset --hard "$EXPECTED_HEAD"

echo ""
echo "✅ Restore complete. Current HEAD:"
git log -1 --oneline

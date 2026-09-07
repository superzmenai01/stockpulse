"""
backend/algorithms/hl-structure/config.py — M2 HL Structure v0.4.0 (大少 2026-09-07 11:45 plan 批准)

凡人話: M2 algorithm 嘅 default 參數, 大少可經 options 覆寫
對應 source: algorithms/AS-03-cycle-detection/modules/hl-structure.ts 嘅 HLStructureConfig
對應 backup: backups/zigzag-frontend-2026-08-20/adapter.mjs (line 3793 嘅 DEFAULT_HL_STRUCTURE_CONFIG)

v0.2.0 改動 (大少 2026-09-06 11:34 trigger, 對齊 9月5日 22 隻 conflict prototype 驗證):
- 加 enableShortTermMode + shortTermWindowDays: 60 日短線 peak/trough trend 確認
- 加 enableBreakoutOverride + breakoutVolMult: 升穿最近 peak override SIDEWAYS
- 加 enableConsolidationBreakout + consolidationMaxGapPct: 峰谷收縮 (差距 < 5%) 突破確認
- 對齊 AGENTS.md §"M2 false SIDEWAYS 改良 v0.2.0"

v0.2.2 改動 (大少 2026-09-06 12:02 trigger, HK.01888 揾到 issue):
- 改 breakoutVolMult 1.3 → 0.85 (放寬量能門檻, 對齊 M2 volumeConfirmRatio 0.7 同 volumeBoostRatio 1.3 中間值)
- 原因: v0.2.0 用 1.3x (強化突破要求) 太嚴, 01888 historical high 升穿 0.876x 唔夠 1.3x
- 0.85x 對齊「確認 + 少量強化」要求, 對一般升穿都接受, 但仍然排除萎縮突破
- 同步影響: 22 隻 conflict 重新跑, 預期多 1-2 隻 B override 觸發

v0.4.0 改動 (大少 2026-09-07 11:45 plan 批准, 5 個 layer evidence-based 優化):

Layer 1 (大少 11:45 trigger, 對齊 `exchangetuts.com` / `askpython.com` SciPy find_peaks 哲學):
- 加 enableSavitzkyGolayFilter: True (預設開住, 抹走 noise 拎 peak/trough 更穩)
- 加 prominenceMinPct: 0.02 (預設 2%, 對齊 SciPy find_peaks 嘅 prominence 哲學)
- 對齊 M3 pattern: 唔引入 scipy 依賴, 用 numpy 手寫 savgol_filter
- 影響: 22 隻 conflict stock 預期多救 1-2 隻 (noise peak/trough 過濾)

對應 commit: 即將 push (Spec Sync #47 Layer 1)
對應 file: backend/algorithms/hl_structure/algorithm.py (Step 3 _detect_extremes 加 smoothing + prominence filter)
對應 plan: plan.md §Layer 1 (5 個 layer evidence-based 優化)
"""

# 凡人話: M2 algorithm 19 步對應嘅 default config (v0.2.0 加 Step 16+17, v0.4.0 加 Layer 1)
# 全部用 dict (唔用 dataclass), 因為 Algorithm contract options 入面直接拎
DEFAULT_HL_STRUCTURE_CONFIG: dict = {
    "minPairs": 3,             # 2026-08-07 — 改返 3 (高質量,需要 6 個 alternating)
    "baseWindow": 5,
    "tolerancePct": 0.015,
    "enableAtrWindow": True,
    "atrPeriod": 14,
    "enableVolumeFilter": True,
    "volumeConfirmRatio": 0.7,
    "volumeLookback": 20,
    "volumeBoostRatio": 1.3,
    "volumeShrinkWeightMultiplier": 0.5,
    "volumeBoostWeightMultiplier": 1.2,
    "breakoutConfirmDays": 2,
    "timeDecayLambda": 0.03,
    "enablePatternAlert": True,
    "patternSymmetryTolerance": 2,
    "maxExtremeAgeDays": 20,
    "freshnessDecayDays": 30,
    "freshnessMinMultiplier": 0.4,
    # === v0.2.0 新加 (大少 2026-09-06 11:34 trigger) ===
    "enableShortTermMode": True,          # 開住短線 mode (60 日確認)
    "shortTermWindowDays": 60,            # 大少長期投資, 用 60 日 window
    "shortTermMinPairs": 2,               # 短線 minPairs 細啲 (2 對 4 個交替夠用)
    "enableBreakoutOverride": True,       # 開住突破 override SIDEWAYS
    "breakoutVolMult": 0.85,              # v0.2.2 改: 1.3 → 0.85, 對齊 M2 volumeConfirmRatio + volumeBoostRatio 中間值 (大少 12:02 trigger 揀 D 方案)
    "breakoutLookbackDays": 5,            # 突破日查最近 5 日
    "enableConsolidationBreakout": True,  # 開住收縮突破確認 (大少 00019 case)
    "consolidationMaxGapPct": 0.05,       # 最後一對峰谷差距 < 5% = 收縮
    "consolidationLookbackDays": 20,      # 查最後峰谷喺 20 日內 (避免太舊)
    # === v0.4.0 Layer 1 新加 (大少 2026-09-07 11:45 plan 批准) ===
    "enableSavitzkyGolayFilter": True,    # 開住 Savitzky-Golay 平滑, 抹走 noise peak/trough
    "prominenceMinPct": 0.02,             # prominence 過濾 threshold (2% = peak_value 嘅 2% 突出度先留)
    # === v0.4.0 Layer 2 新加 (大少 2026-09-07 11:45 plan 批准) ===
    "trendR2Threshold": 0.40,             # linear regression R² threshold (3-period 對齊 tradersweek.com 10-period 永久 rule)
    "trendSlopeMinPct": 0.001,            # slope_normalized 最小百分比 (對齊 pomegra.io 標準化)
    # === v0.4.0 Layer 3 新加 (大少 2026-09-07 11:45 plan 批准) ===
    "enableHeadAndShouldersNeckline": True,  # 開住 H&S 5-point neckline 確認 (對齊 deepwiki.com Bulkowski 標準)
    "patternR2Min": 0.6,                  # pattern_r2 quality threshold (1.0 完美, 0.6 對齊 head_shoulders.py 教學)
    # === v0.4.0 Layer 4 新加 (大少 2026-09-07 11:45 plan 批准) ===
    "enableBBSqueezeFilter": True,        # 開住 BB/KC Squeeze 確認 (對齊 thinkcapital.com / marketopia.org TTM Squeeze 教學)
    "bbPeriod": 20,                       # BB period (對齊 Bollinger 1980 標準 20 日)
    "bbStdDev": 2.0,                      # BB std_dev multiplier (對齊 Bollinger 1980 標準 2σ)
    "kcEMAPeriod": 20,                    # Keltner Channel EMA period (對齊 marketopia.org 教學 20 日)
    "kcATRFactor": 1.5,                   # Keltner Channel ATR multiplier (對齊 marketopia.org 教學 1.5x)
}

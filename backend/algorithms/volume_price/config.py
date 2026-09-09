"""
backend/algorithms/volume_price/config.py — M5 VolumePrice config (大少 2026-08-20 Phase 6)

凡人話: M5 嘅可調參數 (VWAP period / Volume percentile / Breakout / OBV / Pullback / 假突破 threshold)
"""

DEFAULT_VOLUME_PRICE_CONFIG = {
    # Step 0.5: Hurst+ADX regime gate (大少 2026-09-09 20:19 trigger, Spec Sync #58)
    # 對齊 M3 Spec Sync #51 confirmation filter pattern (gate fail emit LOW_CONFIDENCE warning, 唔係 hard gate)
    # 對齊 M4 Spec Sync #52 永久 rule (Hurst<0.45 OR ADX<20 確認 weak trend)
    # 凡人話: 對冇 trend 嘅 stock 提前扣 conf 0.10 (M3 warn_penalty pattern), 唔好再 100% SIDEWAYS
    "regimeGateHurstThreshold": 0.45,
    "regimeGateAdxThreshold": 18,  # 對齊 M3 Spec Sync #51 (M3 用 18 唔係 20)
    # Step 1: 基礎指標
    "vwapPeriod": 20,
    "volumePercentileLookback": 60,
    # Step 2: 連續放量判定
    "volumeSurgeMinDays": 3,
    # Step 3: 加權 OBV (Tanh) — 凡人話: 對齊 OBV 限制文獻, 20 日太短 (落入 flat 太多), 改 60 日
    "obvSmaWindow": 60,  # 之前 20, 改 60 (大少 2026-09-09 20:19 trigger, Spec Sync #58)
    # Step 4: 放量突破
    "breakoutConfirmDays": 3,
    "falseBreakoutRetracePct": 0.5,
    # 凡人話: 對齊 VSA 權威建議, 0.998 條件太鬆 (接近 20 日高位就 trigger), 改 1.005 (真係要突破)
    "breakoutThreshold": 1.005,  # 之前 0.998, 改 1.005 (大少 2026-09-09 20:19 trigger, Spec Sync #58)
    # Step 5: 回調
    "pullbackMinDays": 2,
    "pullbackMaxDays": 20,
    # Step 6: 密集區 — 凡人話: 1.3× threshold 過濾咗大部分 high traffic zone (4 隻 stock supportZone="dense_zone_pending"), 改 1.1×
    "denseZoneVolumeRatioThreshold": 1.1,  # 之前 1.3 (hardcode), 改 config 可調 (大少 2026-09-09 20:19 trigger, Spec Sync #58)
    "denseZoneAtrMultiple": 0.5,  # bin_width = ATR × 0.5 (Step 6 ATR 動態分箱)
    # Step 7: 量价相關係數
    "correlationWindow": 5,
    "divergenceThreshold": 0.4,
}

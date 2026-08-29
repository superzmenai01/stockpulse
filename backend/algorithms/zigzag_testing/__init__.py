"""
backend/algorithms/zigzag_testing/ — ZigZag Testing 模組 (大少 2026-08-29 19:34 trigger)

凡人話: 1-to-1 port testing-page.js 嘅 ZigZag algorithm (紫線 + 鮮綠線 + P 點)
落 backend, 目的: 大少對比新前台 (backend 計) vs 舊 testing page (frontend 計) 拎
到嘅結果係咪一致。

對應 source:
- backups/zigzag-frontend-2026-08-20/adapter.mjs:1505-1625 (calculateZigZag 核心算法)
- testing-page.js:52-75 (autoThresholdVolatility)
- testing-page.js:78-91 (extractHLC)
- testing-page.js 4.9.0/4.10.0 (P 點順序號碼, 1=最新倒序排)
- testing-page.js 4.33.0 (鮮綠線 #00C853 最後 close extension)

永久 rule (大少 2026-08-29 19:34):
- 永遠唔好動 testing-page.js / index.html / backend/algorithms/zigzag/algorithm.py
- 新模組獨立 1-to-1 port, 對齊 frontend 拎到嘅結果
- 拎 K 線: KlineCache full flow (T-1 normalized, 跟 /api/kline endpoint 對齊)
- Algorithm output: {points, threshold, threshold_mode, klines_count, extension_line, sequence_count}
"""

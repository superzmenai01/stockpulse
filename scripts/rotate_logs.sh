#!/bin/bash
# ============================================================================
# StockPulse Log Rotation (大少 2026-08-03, v2 safe)
# ============================================================================
# Disk-safe rotation: 任何 log > 500MB 時
#   1. 殺最舊 backup (.log.3)
#   2. shift .log.2 → .log.3, .log.1 → .log.2
#   3. tail 最後 1000 行 → .log.1 (保留少量 context, ~50KB)
#   4. truncate 原 file 喺 inode 度 (writer FD 唔變, 繼續寫得)
#
# 重點: 唔使用 cp (會 disk-double, 96% full 時一定 crash)
#       用 tail + truncate, 任何時候都唔需要 extra space
#
# LaunchAgent 每 30 分鐘行一次
# ============================================================================

set -e

LOG_DIR="/Users/zmenai/stockpulse/logs"
MAX_SIZE_BYTES=$((500 * 1024 * 1024))   # 500 MB
TAIL_LINES=1000                          # backup 最後 N 行 context

cd "$LOG_DIR"

rotated_count=0
for log in *.log; do
    [ -f "$log" ] || continue

    size=$(stat -f%z "$log" 2>/dev/null || echo 0)
    if [ "$size" -gt "$MAX_SIZE_BYTES" ]; then
        size_mb=$((size / 1024 / 1024))
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rotating $log (${size_mb}MB > 500MB)"

        # 殺最舊 backup
        rm -f "${log}.3"

        # shift backups (大 → 小)
        if [ -f "${log}.2" ]; then
            mv "${log}.2" "${log}.3"
        fi
        if [ -f "${log}.1" ]; then
            mv "${log}.1" "${log}.2"
        fi

        # tail 最後 N 行 → .log.1 (小 backup, 約 ~50KB)
        tail -n "$TAIL_LINES" "$log" > "${log}.1"

        # truncate in place — writer 嘅 FD 仍然有效, 繼續寫入
        : > "$log"

        rotated_count=$((rotated_count + 1))
    fi
done

if [ "$rotated_count" -gt 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rotated $rotated_count file(s)"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] No rotation needed (all logs < 500MB)"
fi
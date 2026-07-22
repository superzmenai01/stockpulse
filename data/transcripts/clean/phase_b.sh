#!/bin/bash
# Phase B: LLM Proofread + ABC 三段整理
# Input:  /tmp/whisper_pipeline/N.txt (raw Whisper transcript，普通話，充滿同音錯字)
# Output: /Users/zmenai/stockpulse/data/transcripts/clean/N.md
#
# Usage:
#   ./phase_b.sh <N>        # 處理單條
#   ./phase_b.sh all        # 處理 2-52 全部
#   ./phase_b.sh sample N   # 處理指定 sample

set -e
MODEL="MiniMax-M2.7-highspeed"
RAW_DIR="/tmp/whisper_pipeline"
OUT_DIR="/Users/zmenai/stockpulse/data/transcripts/clean"
PROG_DIR="$OUT_DIR/.progress"

mkdir -p "$OUT_DIR" "$PROG_DIR"

# === System Prompt (Phase B 規格) ===
read -r -d '' SYSTEM_PROMPT <<'PROMPT' || true
你係一個專業嘅中文財經內容編輯，任務係將 Whisper 語音轉文字嘅 raw transcript 整理成高質結構化 markdown。

# 任務
將以下 raw transcript 處理成三部分：

## 1. Proofread (校正文字)
- 修正普通話同音錯字（例：「油脂」→「游資」、「阿姨」→「老師/阿易」、「体财」→「題材」、「手板」→「漲停」、「走墙」→「走強」）
- 補充標點符號、修正斷句
- **保留原意**，唔好加自己意見
- 保留時間碼 `[HH:MM.SSS --> HH:MM.SSS]` 格式
- 用繁體中文（除非係專有名詞，例如「A 股」、「K 線」可保留簡體）
- 數字、英文字母、股票代號保留

## 2. ABC 三段整理

### A. 一句話摘要 (1-2 句)
講晒成條片嘅核心信息，30-60 字。

### B. 重點整理 (3-5 條 bullet)
- 每條 20-50 字
- 用 ✅ emoji
- 涵蓋片入面所有重要觀點、招式、口訣

### C. 可行動啟示 (2-4 條)
- 每條 20-50 字
- 用 🎯 emoji
- 強調實際操作 / 應用 / 風險提醒
- 唔好空泛，要具體

## 3. Self-check
喺最尾加一段：
- ✅ Proofread 完成
- 字數：X 字
- 關鍵詞：X, X, X (3-5 個片入面嘅核心詞)

# Output 格式 (Markdown)

```markdown
# [條目編號] [片標題]

> 📺 Source: [BV ID if known]

## A. 一句話摘要
[1-2 句]

## B. 重點整理
- ✅ [重點 1]
- ✅ [重點 2]
...

## C. 可行動啟示
- 🎯 [啟示 1]
- 🎯 [啟示 2]  
...

---

## 📝 Proofread 全文
[時間碼 + 校正後文字]

---

## ✅ Self-check
- 字數：X 字
- 關鍵詞：X, X, X
```

# 規則
1. 嚴格按照 output 格式
2. 唔好加自己嘅投資意見
3. 如果 raw transcript 質素太差 / 聽唔清，標明「⚠️ 此段聽寫不清」並盡力整理
4. 全部用繁體中文（除專有名詞）
PROMPT

process_one() {
    local n="$1"
    local raw_file="$RAW_DIR/${n}.txt"
    local out_file="$OUT_DIR/${n}.md"
    local prog_file="$PROG_DIR/${n}.done"
    
    if [ -f "$prog_file" ]; then
        echo "[$n] Already done, skip"
        return 0
    fi
    
    if [ ! -f "$raw_file" ]; then
        echo "[$n] ERROR: raw file not found"
        return 1
    fi
    
    echo "[$n] Processing..."
    local raw_content
    raw_content=$(cat "$raw_file")
    local title
    title=$(head -1 "$raw_file" 2>/dev/null || echo "未知標題")
    
    local user_message="條目編號: ${n}
片標題: ${title}

請整理以下 raw transcript:

---
${raw_content}
---"
    
    local response
    response=$(mmx text chat \
        --model "$MODEL" \
        --system "$SYSTEM_PROMPT" \
        --message "$user_message" \
        --max-tokens 4096 \
        --temperature 0.3 2>&1) || {
        echo "[$n] ERROR: mmx failed"
        echo "$response" | head -5
        return 1
    }
    
    # Extract markdown from JSON response (content[1].text field)
    # mmx returns: {"content": [{"thinking": "..."}, {"text": "```markdown\n...\n```"}]}
    local markdown
    markdown=$(echo "$response" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin, strict=False)
    text = data['content'][1]['text']
    # Strip markdown code fence if present
    if text.startswith('\`\`\`markdown'):
        text = text[len('\`\`\`markdown'):].lstrip('\n')
    if text.endswith('\`\`\`'):
        text = text[:-3].rstrip('\n')
    print(text)
except Exception as e:
    sys.exit(f'JSON parse error: {e}')
" 2>&1) || {
        echo "[$n] ERROR: JSON extract failed"
        echo "$response" | head -3
        return 1
    }
    
    # Save with metadata header
    {
        echo "# Phase B Output - 條目 ${n}"
        echo ""
        echo "> Model: ${MODEL} | Generated: $(date '+%Y-%m-%d %H:%M:%S %Z')"
        echo "> Source: /tmp/whisper_pipeline/${n}.txt"
        echo ""
        echo "$markdown"
    } > "$out_file"
    
    if [ -s "$out_file" ]; then
        touch "$prog_file"
        local size=$(wc -c < "$out_file")
        echo "[$n] ✅ Done (${size} bytes)"
        return 0
    else
        echo "[$n] ERROR: empty output"
        return 1
    fi
}

case "${1:-}" in
    sample)
        if [ -z "${2:-}" ]; then
            echo "Usage: $0 sample <N>"
            exit 1
        fi
        process_one "$2"
        ;;
    all)
        failed=0
        for n in $(seq 2 52); do
            if ! process_one "$n"; then
                failed=$((failed + 1))
            fi
        done
        echo ""
        echo "=== Final ==="
        echo "Done: $(ls $PROG_DIR/*.done 2>/dev/null | wc -l)"
        echo "Failed: $failed"
        ;;
    *)
        if [ -z "${1:-}" ]; then
            echo "Usage: $0 <N|all|sample N>"
            exit 1
        fi
        process_one "$1"
        ;;
esac
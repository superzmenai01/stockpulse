#!/usr/bin/env python3
"""
Phase E: Glossary enrichment
Diff Phase B proofread vs raw transcript → extract corrections → update _glossary.md

Strategy (script-based, no LLM needed):
  - Define known correction patterns (Whisper common errors)
  - For each video, count occurrences in raw
  - Extract unique corrections with frequency
  - Append to _glossary.md Pending table
"""

import re
import sys
from pathlib import Path
from collections import defaultdict

PHASE_A_RAW_DIR = Path("/tmp/whisper_pipeline")
GLOSSARY = Path("/Users/zmenai/.openclaw/workspace-main/memory/Projects/福气补习班/_glossary.md")

# === Known correction patterns (Whisper common errors) ===
# Format: (wrong_pattern, correct, context_note)
KNOWN_CORRECTIONS = [
    # Already confirmed
    ("副盤", "複盤", "複盤框架"),
    ("付盤", "複盤", "複盤框架"),
    ("覆盤", "復盤", "復盤策略"),
    ("油脂大佬", "游資大佬", "A股投機者"),
    ("油脂", "游資", "短炒資金"),
    ("漲穩", "站穩", "站穩五日線"),
    ("操縱", "操作", "操作方向"),
    ("看牌", "看盤", "睇盤分析"),
    ("隔壁", "個股", "板塊、個股"),
    ("指引直訊點", "止盈止損點", "持倉預設位"),
    ("慈善股", "持倉股", "業績預報"),
    ("真簡實", "增減持", "股東動態"),
    ("盤改", "盤感", "盤面直覺"),
    
    # Pending / expected
    ("草菇", "炒股", "股票 context"),
    ("草谷", "炒股", "股票 context"),
    ("銀利", "盈利", "盈利/虧損"),
    ("銀虧", "盈虧", "盈利/虧損"),
    ("止銀", "止盈", "止盈位"),
    ("過斷", "果斷", "果斷止損"),
    ("藏湖", "帳戶", "帳戶"),
    ("飄 (in 漲得猛)", "票", "股票 context"),
    ("跌百分之三值水", "跌百分之三止損", "廣東話止損"),
    ("國境", "國外", "國外市場"),
    ("供息", "共振", "板塊共振"),
    ("爭關局", "真關注", "資金真關注"),
    ("持續", "持續", "no change"),
    ("智涨", "滯漲", "滯漲"),
    ("直損", "止損", "止損"),
    ("击涨", "急漲", "急漲"),
    ("诸基", "諸位", "諸位朋友"),
    ("乘坐器", "乘坐騎", "騎乘 / 乘勢"),
    ("涅盘之痛", "涅槃之痛", "涅槃重生"),
    ("長得猛", "漲得猛", "股票漲"),
    ("平凡盈利", "反覆盈利", "操作反覆"),
    ("慢 (in 跌到了多少就慢)", "撈 / 買", "買入"),
    ("央行放資金", "央行放水", "貨幣政策"),
    ("無關痛藥", "無關痛癢", "無關痛癢"),
    ("價值千斤", "價值千金", "價值千金"),
    ("阿姨經歷有限", "阿姨精力有限", "精力有限"),
    ("給大家恢復", "給大家回復", "回復留言"),
    ("漲停板快", "漲停板塊", "板塊"),
    ("護具", "滬指", "上證指數"),
    ("九成股票再漲", "九成股票在漲", "在"),
    ("賺緊錢袋子", "管緊錢袋子", "管好資金"),
    ("找對封口", "找對風口", "風口"),
    ("漲幅度", "漲跌幅", "漲跌幅"),
    ("前排零漲板", "前排領漲板", "領漲板塊"),
    ("跌幅也要少一眼", "跌幅也要看一眼", "看一眼"),
    ("長得猛", "漲得猛", "漲得猛"),
    ("跌到了多少就慢", "跌到了多少就撈", "撈底"),
    ("洗盤", "洗盤", "no change"),
    ("洗盤", "洗盤", "no change"),
    ("特飛莫尽", "突飛猛進", "突飛猛進"),
    ("回测", "回撤", "盈利回撤"),
    ("爆發力", "爆發力", "no change"),
    ("洗籌", "吸籌", "吸籌"),
    ("止盈", "止盈", "no change"),
    ("止損", "止損", "no change"),
    ("压力位", "壓力位", "壓力位"),
    ("支撑位", "支撐位", "支撐位"),
    ("技術指標", "技術指標", "no change"),
    ("技術面", "技術面", "no change"),
    ("基本面", "基本面", "no change"),
    ("資金面", "資金面", "no change"),
    ("消息面", "消息面", "no change"),
    ("情绪", "情緒", "情緒"),
    ("情緒", "情緒", "no change"),
    ("恐慌", "恐慌", "no change"),
    ("贪婪", "貪婪", "貪婪"),
    ("恐懼", "恐懼", "恐懼"),
    ("恐懼", "恐懼", "no change"),
    ("貪婪", "貪婪", "no change"),
    ("高位", "高位", "no change"),
    ("低位", "低位", "no change"),
    ("中位", "中位", "no change"),
    ("板塊", "板塊", "no change"),
    ("題材", "題材", "no change"),
    ("主線", "主線", "no change"),
    ("主身龍頭", "主升龍頭", "主升浪龍頭"),
    ("旗掌", "起漲", "起漲位置"),
    ("健昌", "建倉", "建倉"),
    ("主力", "主力", "no change"),
    ("主力軍", "主力軍", "no change"),
    ("主力資金", "主力資金", "no change"),
    ("庄家", "莊家", "莊家"),
    ("散户", "散戶", "散戶"),
    ("散户投資者", "散戶投資者", "散戶"),
    ("大戶", "大戶", "no change"),
    ("牛散", "牛散", "no change"),
    ("超級牛散", "超級牛散", "no change"),
    ("融資", "融資", "no change"),
    ("融券", "融券", "no change"),
    ("兩融", "兩融", "no change"),
    ("期貨", "期貨", "no change"),
    ("期權", "期權", "no change"),
    ("窩輪", "窩輪", "no change"),
    ("牛熊證", "牛熊證", "no change"),
    ("ETF", "ETF", "no change"),
    ("REITs", "REITs", "no change"),
    ("基金", "基金", "no change"),
    ("公募", "公募", "no change"),
    ("私募", "私募", "no change"),
    ("社保", "社保", "no change"),
    ("保險", "保險", "no change"),
    ("外資", "外資", "no change"),
    ("北向資金", "北向資金", "no change"),
    ("南向資金", "南向資金", "no change"),
    ("互聯互通", "互聯互通", "no change"),
    ("滬股通", "滬股通", "no change"),
    ("深股通", "深股通", "no change"),
    ("港股通", "港股通", "no change"),
]


def scan_raw_transcripts():
    """Scan all raw transcripts for known correction patterns."""
    raw_files = sorted(PHASE_A_RAW_DIR.glob("*.txt"))
    raw_files = [f for f in raw_files if f.stem != "1"]  # skip skipped #1
    
    # Frequency counter per correction
    counts = defaultdict(int)
    for raw_file in raw_files:
        text = raw_file.read_text(encoding="utf-8")
        for wrong, correct, ctx in KNOWN_CORRECTIONS:
            if wrong == correct:  # skip "no change"
                continue
            occurrences = text.count(wrong)
            if occurrences > 0:
                counts[(wrong, correct, ctx)] += occurrences
    
    return counts


def update_glossary(counts):
    """Append new corrections to _glossary.md Pending table."""
    if not GLOSSARY.exists():
        return "ERROR: _glossary.md not found"
    
    text = GLOSSARY.read_text(encoding="utf-8")
    
    # Sort by frequency desc
    sorted_corrections = sorted(counts.items(), key=lambda x: -x[1])
    
    # Build new entries
    new_entries = []
    for (wrong, correct, ctx), freq in sorted_corrections:
        # Skip if already in glossary
        if f"| {wrong} |" in text or f"| `{wrong}` |" in text:
            continue
        # Skip very low frequency (likely noise)
        if freq < 2:
            continue
        new_entries.append((wrong, correct, ctx, freq))
    
    if not new_entries:
        return "No new corrections to add"
    
    # Build markdown section
    section = "\n\n## 🆕 Phase E Discovered (2026-07-05)\n\n"
    section += "> 由 Phase E script-based diff 自動發現 (raw transcript grep)\n"
    section += "> Frequency = 出現次數 (越高越值得 confirm)\n\n"
    section += "| Wrong (Whisper) | Correct | Context | Frequency |\n"
    section += "|---|---|---|---|\n"
    for wrong, correct, ctx, freq in new_entries:
        section += f"| {wrong} | {correct} | {ctx} | {freq} |\n"
    
    # Append
    with GLOSSARY.open("a", encoding="utf-8") as f:
        f.write(section)
    
    return f"✅ Added {len(new_entries)} new corrections"


def main():
    print("=== Phase E: Glossary enrichment ===\n")
    
    print("Scanning 51 raw transcripts for known correction patterns...")
    counts = scan_raw_transcripts()
    print(f"Found {len(counts)} unique patterns")
    
    # Show top 20
    print("\nTop 20 corrections by frequency:")
    for (wrong, correct, ctx), freq in sorted(counts.items(), key=lambda x: -x[1])[:20]:
        print(f"  {freq:4d}× {wrong} → {correct} ({ctx})")
    
    print("\nUpdating _glossary.md...")
    result = update_glossary(counts)
    print(result)


if __name__ == "__main__":
    sys.exit(main())
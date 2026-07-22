#!/usr/bin/env python3
"""
Phase C: Migration script
Move Phase B outputs (StockPulse/data/transcripts/clean/) into
the spec-compliant 福气补习班 videos/ folder.

Schema per file:
  - YAML frontmatter (id=BV, title, kol, tags, status, ...)
  - A: Raw Whisper (embed raw .txt)
  - A': Proofread (extracted from Phase B output)
  - B: Key Points (extracted from Phase B output)
  - C: 總結+評價 (extracted from Phase B output, renamed from "啟示")
  - Cross-links (Obsidian wikilinks)

Usage:
    python3 phase_c.py             # Migrate all 51
    python3 phase_c.py --sample N  # Migrate just one (for testing)
    python3 phase_c.py --dry-run   # Preview only
"""

import re
import sys
import json
import subprocess
from pathlib import Path

# === Paths ===
PHASE_A_RAW_DIR = Path("/tmp/whisper_pipeline")
PHASE_A_LOG = PHASE_A_RAW_DIR / "main.log"
PHASE_B_OUT_DIR = Path("/Users/zmenai/stockpulse/data/transcripts/clean")
PROJ_ROOT = Path("/Users/zmenai/.openclaw/workspace-main/memory/Projects/福气补习班")
VIDEOS_DIR = PROJ_ROOT / "videos"
INDEX_FILE = PROJ_ROOT / "_index.md"


def parse_mapping():
    """Parse Phase A main.log → N → (BV ID, title)."""
    log_text = PHASE_A_LOG.read_text(encoding="utf-8", errors="replace")
    mapping = {}
    
    pattern = re.compile(
        r"\[(\d+)/52\]\s+(?:Processing|SKIP)\s+(BV[0-9A-Za-z]{10}|V[0-9A-Za-z]{10})\s*\n\s*Title:\s+(.+)",
        re.MULTILINE
    )
    for m in pattern.finditer(log_text):
        n = int(m.group(1))
        bv = m.group(2)
        title_line = m.group(3).strip()
        
        # Fix missing 'B' in BV (typo in log)
        if bv.startswith("V") and not bv.startswith("BV"):
            bv_match = re.search(r"\[(BV[0-9A-Za-z]{10})\]", title_line)
            if bv_match:
                bv = bv_match.group(1)
        
        # Clean title: strip " [BVxxx].mp4" suffix
        clean_title = re.sub(r"\s*\[BV[0-9A-Za-z]{10}\]\.mp4\s*$", "", title_line).strip()
        
        mapping[n] = {"bv_id": bv, "title": clean_title}
    
    return mapping


def get_video_meta(bv_id):
    """Try to get duration + file_size from /Users/zmenai/Movies/福气补习班/"""
    movies_dir = Path("/Users/zmenai/Movies/福气补习班")
    if not movies_dir.exists():
        return None, None
    
    for f in movies_dir.glob(f"*[{bv_id}].mp4"):
        size_mb = f.stat().st_size / (1024 * 1024)
        try:
            result = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", str(f)],
                capture_output=True, text=True, timeout=5
            )
            duration_sec = float(result.stdout.strip())
            duration_str = f"{int(duration_sec // 60)}:{int(duration_sec % 60):02d}"
        except Exception:
            duration_str = "?"
        return duration_str, f"{size_mb:.0f} MB"
    return None, None


def parse_phase_b_output(md_text):
    """Extract A/B/C/proofread/self_check from Phase B output."""
    sections = {"A": "", "B": "", "C": "", "proofread": "", "self_check": ""}
    
    m = re.search(r"## A\. 一句話摘要\s*\n+(.+?)(?=\n## |\n---)", md_text, re.DOTALL)
    if m: sections["A"] = m.group(1).strip()
    
    m = re.search(r"## B\. 重點整理\s*\n+(.+?)(?=\n## |\n---)", md_text, re.DOTALL)
    if m: sections["B"] = m.group(1).strip()
    
    m = re.search(r"## C\. 可行動啟示\s*\n+(.+?)(?=\n## |\n---)", md_text, re.DOTALL)
    if m: sections["C"] = m.group(1).strip()
    
    m = re.search(r"## 📝 Proofread 全文\s*\n+(.+?)(?=\n---)", md_text, re.DOTALL)
    if m: sections["proofread"] = m.group(1).strip()
    
    m = re.search(r"## ✅ Self-check\s*\n+(.+?)$", md_text, re.DOTALL)
    if m: sections["self_check"] = m.group(1).strip()
    
    return sections


def derive_tags(title, sections):
    """Simple keyword-based tag derivation."""
    text = (title + " " + sections.get("A", "") + " " + sections.get("B", ""))
    
    base_tags = ["阿姨", "60岁老股民"]
    if "短线" in text or "短線" in text:
        base_tags.append("短线")
    
    keyword_map = {
        "复盘": "复盘", "複盤": "复盘",
        "龙头": "龙头", "龍頭": "龙头",
        "短线": "短线", "短線": "短线",
        "涨停": "涨停", "漲停": "涨停",
        "口诀": "口诀", "口訣": "口诀",
        "小资金": "小资金", "小資金": "小资金",
        "成交量": "成交量",
        "心态": "心态", "心態": "心态",
        "铁律": "铁律", "鐵律": "铁律",
        "K线": "K线", "K線": "K线",
    }
    
    derived = set(base_tags)
    for keyword, tag in keyword_map.items():
        if keyword in text:
            derived.add(tag)
    
    return sorted(list(derived))


def migrate_one(n, info, dry_run=False):
    bv_id = info["bv_id"]
    title = info["title"]
    
    raw_file = PHASE_A_RAW_DIR / f"{n}.txt"
    if not raw_file.exists():
        return f"[{n}] SKIP (no raw file)"
    
    raw_text = raw_file.read_text(encoding="utf-8")
    
    phase_b_file = PHASE_B_OUT_DIR / f"{n}.md"
    if not phase_b_file.exists():
        return f"[{n}] SKIP (no Phase B output)"
    
    phase_b_text = phase_b_file.read_text(encoding="utf-8")
    sections = parse_phase_b_output(phase_b_text)
    
    if not sections["A"] or not sections["B"] or not sections["C"]:
        return f"[{n}] WARN (missing A={bool(sections['A'])}, B={bool(sections['B'])}, C={bool(sections['C'])})"
    
    duration, file_size = get_video_meta(bv_id)
    tags = derive_tags(title, sections)
    # Add BV ID to disambiguate collisions (4 duplicate titles in dataset)
    sanitised = f"阿姨 - {title} [{bv_id}]"
    filename = f"{title} [{bv_id}].mp4"
    
    frontmatter = f"""---
id: {bv_id}
title: "{title}"
sanitised_title: "{sanitised}"
duration: {duration or "?"}
file_size: {file_size or "?"}
filename: "{filename}"
kol: 阿姨
kol_alt: 60岁老股民
downloaded: 2026-07-04
status: done
whisper_model: small
accuracy_estimate: 85%
tags: {json.dumps(tags, ensure_ascii=False)}
migrated_from: stockpulse/data/transcripts/clean/{n}.md
migration_date: 2026-07-05
---"""
    
    body = f"""

# {title}

> **影片主題**: {sections['A']}

## A. 原始語音文字 (Raw Whisper)

> 原始 Whisper small model output, **完全未修正** — 用嚟 reference 同 audit

```
{raw_text}
```

## A'. 校對版 (Proofread)

> 已套用 Phase B LLM proofread corrections
> 完整 glossary: `[[_glossary]]`

{sections['proofread']}

> ⚠️ **Uncertain terms** (待大少 audio verify)
>
> Phase B 用 mmx MiniMax-M2.7-highspeed auto-proofread，未提供逐條信心 % table。
> 待後續 refine — 可對比 [[_glossary]] 或再過一輪 audio verify。

## B. 重點列表 (Key Points)

{sections['B']}

## C. 總結和評價

### 內容摘要

{sections['A']}

### 可行動啟示

{sections['C']}

## Cross-links

- KOL profile: [[_kol-profile-阿姨]]
- Glossary: [[_glossary]]
- Index: [[_index]]
- Phase B source: `/Users/zmenai/stockpulse/data/transcripts/clean/{n}.md`
"""
    
    full_md = frontmatter + body
    out_path = VIDEOS_DIR / f"{sanitised}.md"
    
    if dry_run:
        print(f"[{n}] Would write: {out_path.name} ({len(full_md)} bytes)")
        return None
    
    VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
    out_path.write_text(full_md, encoding="utf-8")
    
    return f"[{n}] ✅ {out_path.name} ({len(full_md)} bytes)"


def update_index(mapping, dry_run=False):
    if not INDEX_FILE.exists():
        return "WARN: _index.md not found"
    
    existing = INDEX_FILE.read_text(encoding="utf-8")
    existing_links = set(re.findall(r"\[\[(.+?)\]\]", existing))
    
    new_entries = []
    for n in sorted(mapping.keys()):
        info = mapping[n]
        sanitised = f"阿姨 - {info['title']} [{info['bv_id']}]"
        if sanitised not in existing_links:
            new_entries.append(f"- [[{sanitised}]] | BV: {info['bv_id']} | N={n}")
    
    if not new_entries:
        return "Index: no new entries"
    
    addition = "\n\n## 📌 Added by Phase C Migration (2026-07-05)\n\n" + "\n".join(new_entries)
    
    if dry_run:
        print(f"Index: Would add {len(new_entries)} entries")
        return None
    
    with INDEX_FILE.open("a", encoding="utf-8") as f:
        f.write(addition)
    
    return f"Index: ✅ added {len(new_entries)} entries"


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample", type=int, help="Migrate just one N")
    parser.add_argument("--dry-run", action="store_true", help="Preview only")
    args = parser.parse_args()
    
    print("=== Phase C: Migrate StockPulse → 福气补习班 ===\n")
    
    mapping = parse_mapping()
    print(f"Parsed mapping: {len(mapping)} entries")
    if not mapping:
        print("ERROR: no mapping parsed")
        return 1
    
    print("Sample mapping (first 3):")
    for n in sorted(mapping.keys())[:3]:
        print(f"  [{n}] {mapping[n]}")
    print()
    
    if args.sample:
        ns = [args.sample]
    else:
        ns = sorted(mapping.keys())
    
    success = 0
    warnings = 0
    for n in ns:
        if n not in mapping:
            print(f"[{n}] SKIP (not in mapping)")
            continue
        result = migrate_one(n, mapping[n], dry_run=args.dry_run)
        if result:
            print(result)
            if "✅" in result:
                success += 1
            elif "WARN" in result:
                warnings += 1
    
    print(f"\n=== Summary ===")
    print(f"Success: {success}, Warnings: {warnings}")
    
    if not args.dry_run and not args.sample:
        print(update_index(mapping, dry_run=args.dry_run))
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
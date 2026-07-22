#!/usr/bin/env python3
"""
Phase D: C section polish
Refine each videos/{N}.md 的 C section 入 3 sub-sections:
  - 優點 (Pros)
  - Caveats / 不足
  - Action items

Usage:
    python3 phase_d.py             # Process all 52 videos
    python3 phase_d.py --sample N  # Process just one (for testing)
"""

import re
import sys
import json
import subprocess
from pathlib import Path

VIDEOS_DIR = Path("/Users/zmenai/.openclaw/workspace-main/memory/Projects/福气补习班/videos")


def get_section(md_text, header_pattern):
    """Extract content between two markdown headers."""
    m = re.search(header_pattern, md_text, re.DOTALL)
    if not m:
        return None
    start = m.end()
    # Find next ## header
    next_header = re.search(r"\n## ", md_text[start:])
    end = start + next_header.start() if next_header else len(md_text)
    return md_text[start:end].strip()


def refine_c_section(c_text, b_text, a_text):
    """Use mmx to refine C section into 3 sub-sections."""
    system_prompt = """你係專業嘅中文財經內容編輯。任務：將以下 C section (總結和評價) 重寫成 3 個結構化子部分。

# Spec

```markdown
### 內容摘要
[保留現有 1-2 句內容摘要，原封不動輸出]

### 優點 (Pros)
- ✅ [2-4 條呢條片做得幾好嘅地方]
- ✅ ...

### Caveats / 不足
- ⚠️ [2-4 條觀眾要留意嘅限制 / 風險 / 缺點]
- ⚠️ ...

### Action items
- 🎯 [2-4 條具體可行動項目，觀眾應該做咩]
- 🎯 ...
```

# 規則
1. 繁體中文（除專有名詞）
2. 每個 bullet 20-50 字，唔好長氣
3. **3 個子部分 (優點/Caveats/Action items) 必須全部出現，唔好漏**
4. 唔好加原片冇嘅野，純粹整理
5. 保留現有「內容摘要」原封不動
6. Output 只回 4 個子部分 (內容摘要 + 優點 + Caveats + Action items) 嘅 markdown
"""
    
    user_message = f"""B section (重點列表) — 參考:
{b_text[:2000]}

A' section (校對版) — 參考:
{a_text[:1500]}

現有 C section (要重寫):
{c_text}

請按 spec 重寫成 3 子部分。
"""
    
    result = subprocess.run(
        ["mmx", "text", "chat", "--model", "MiniMax-M2.7-highspeed",
         "--system", system_prompt, "--message", user_message,
         "--max-tokens", "2000", "--temperature", "0.3"],
        capture_output=True, text=True, timeout=60
    )
    
    if result.returncode != 0:
        raise RuntimeError(f"mmx failed: {result.stderr[:200]}")
    
    # Parse JSON response (strict=False for unescaped control chars)
    data = json.loads(result.stdout, strict=False)
    text = data["content"][1]["text"]
    
    # Strip markdown code fence if present
    if text.startswith("```markdown"):
        text = text[len("```markdown"):].lstrip("\n")
    if text.endswith("```"):
        text = text[:-3].rstrip("\n")
    
    return text.strip()


def refine_one(md_path):
    """Refine C section in one video file."""
    md_text = md_path.read_text(encoding="utf-8")
    
    # Extract sections
    c_text = get_section(md_text, r"## C\. 總結和評價")
    b_text = get_section(md_text, r"## B\. 重點列表") or ""
    a_text = get_section(md_text, r"## A'\. 校對版") or ""
    
    if not c_text:
        return f"SKIP (no C section): {md_path.name}"
    
    # Skip if already refined
    if "### 優點" in c_text and "### Caveats" in c_text and "### Action items" in c_text:
        return f"SKIP (already refined): {md_path.name}"
    
    # Backup
    backup_path = md_path.with_suffix(".md.bak")
    if not backup_path.exists():
        backup_path.write_text(md_text, encoding="utf-8")
    
    # Refine
    refined = refine_c_section(c_text, b_text, a_text)
    
    # Replace C section content in markdown
    new_md = re.sub(
        r"(## C\. 總結和評價\n+).+?(\n+## Cross-links|\Z)",
        lambda m: f"{m.group(1)}{refined}\n{m.group(2).lstrip()}",
        md_text,
        flags=re.DOTALL
    )
    
    md_path.write_text(new_md, encoding="utf-8")
    return f"✅ Refined: {md_path.name} ({len(new_md) - len(md_text):+d} chars)"


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample", type=int, help="Process just one N")
    args = parser.parse_args()
    
    if args.sample:
        # Find file matching N
        target = None
        for f in VIDEOS_DIR.glob("*.md"):
            if f"#{args.sample}" in f.name or str(args.sample) in f.name:
                target = f
                break
        if not target:
            # Find by N in filename via BV ID lookup
            # For sample test, just process first file
            target = sorted(VIDEOS_DIR.glob("*.md"))[0]
        print(f"Testing: {target.name}")
        print(refine_one(target))
    else:
        files = sorted(VIDEOS_DIR.glob("*.md"))
        print(f"=== Phase D: C section polish ({len(files)} files) ===\n")
        
        success = 0
        skipped = 0
        failed = 0
        for i, f in enumerate(files, 1):
            try:
                result = refine_one(f)
                if "✅" in result:
                    success += 1
                    print(f"[{i}/{len(files)}] {result}")
                elif "SKIP" in result:
                    skipped += 1
                    print(f"[{i}/{len(files)}] {result}")
                else:
                    failed += 1
                    print(f"[{i}/{len(files)}] {result}")
            except Exception as e:
                failed += 1
                print(f"[{i}/{len(files)}] ❌ {f.name}: {e}")
        
        print(f"\n=== Summary ===")
        print(f"Success: {success}, Skipped: {skipped}, Failed: {failed}")


if __name__ == "__main__":
    sys.exit(main())
"""
backend/api/backup_admin.py — 備份還原點管理 API endpoint (大少 2026-08-31 12:00 trigger)

凡人話: 拎所有備份點 (annotated tag + backup branch + restore script) 嘅 metadata,
畀 backup-admin page 顯示 list + 揀邊個做還原。

對齊 §15.45 永久 rule Sscript pattern (annotated tag + backup branch + restore script):
- 掃 refs/tags/restore-* 拎 annotated tag
- 掃 refs/heads/backup-* 拎 backup branch
- 掃 scripts/restore_*.sh 拎 restore script (按 EXPECTED_HEAD 拎 commit hash 對應)
- Dedup by commit hash, combine tag + branch + script 入同一個 backup point

Endpoint:
- GET /api/backup-points/list → 拎所有備份 list
- POST /api/backup-points/restore → 揀 tag 跑對應 restore script (double confirm 跟 Sscript pattern)

對應 frontend: ~/stockpulse/backup-admin/ (跟 testing-page 風格, 大少 12:03 揀嘅 option)
對應 Sscript pattern: scripts/restore_*.sh (大少 8月31日 07:52 + 11:59 trigger)

Spec Sync: §15.54 (待 push, 大少 confirm 後)
"""

import logging
import os
import re
import subprocess
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Project root = backend 嘅 parent directory
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPTS_DIR = os.path.join(PROJECT_ROOT, "scripts")

router = APIRouter(prefix="/api/backup-points", tags=["backup-admin"])


def _run_git(args: List[str], cwd: Optional[str] = None) -> tuple[int, str, str]:
    """凡人話: 跑 git command + 拎 (returncode, stdout, stderr)"""
    try:
        result = subprocess.run(
            ["git"] + args,
            capture_output=True,
            text=True,
            cwd=cwd or PROJECT_ROOT,
            timeout=10,
        )
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return -1, "", "git command timeout (10s)"
    except Exception as e:
        return -1, "", f"git command 失敗: {e}"


def _scan_restore_scripts() -> dict:
    """凡人話: 掃 scripts/restore_*.sh 拎 (filename → EXPECTED_HEAD) mapping

    Returns: { "restore_after_zigzag_4.53.0.sh": "7a424c58...", ... }
    """
    mapping = {}
    if not os.path.isdir(SCRIPTS_DIR):
        return mapping
    for filename in os.listdir(SCRIPTS_DIR):
        if not (filename.startswith("restore_") and filename.endswith(".sh")):
            continue
        filepath = os.path.join(SCRIPTS_DIR, filename)
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read()
        except Exception as e:
            logger.warning(f"[Backup Admin] 讀取 {filename} 失敗: {e}")
            continue
        # 拎 EXPECTED_HEAD="<40-hex>"
        match = re.search(r'EXPECTED_HEAD="([a-f0-9]{40})"', content)
        if not match:
            logger.warning(f"[Backup Admin] {filename} 冇 EXPECTED_HEAD, skip")
            continue
        expected_commit = match.group(1)
        mapping[filename] = expected_commit
    return mapping


def _resolve_commit_from_ref(ref: str) -> Optional[str]:
    """凡人話: 拎 ref (tag / branch) 對應嘅 commit hash (annotated tag peel)"""
    code, out, _ = _run_git(["rev-parse", f"{ref}^{{}}"])
    if code == 0 and out.strip():
        return out.strip()
    # fallback: 唔 peel 直接拎 ref
    code, out, _ = _run_git(["rev-parse", ref])
    if code == 0 and out.strip():
        return out.strip()
    return None


@router.get("/list")
async def list_backup_points():
    """凡人話: 拎所有備份點 list (annotated tag + backup branch + restore script dedup by commit hash)

    大少 2026-08-31 12:00 trigger: 新建 backup-admin page, 管理所有一鍵還原嘅備份
    對齊 §15.45 Sscript pattern (annotated tag + backup branch + restore script)

    Returns:
        {
            "ok": bool,
            "points": [{
                "name": str (優先用 tag, 後備 branch),
                "tag": str or None,
                "branch": str or None,
                "commit": str (40 hex),
                "commit_short": str (8 hex),
                "date": str (ISO 8601),
                "reason_short": str (tag/branch subject first line),
                "reason_long": str (tag/branch body, 多行),
                "script_path": str or None (e.g. "scripts/restore_after_zigzag_4.53.0.sh"),
                "has_script": bool,
                "missing": [str] (缺少嘅 component: "tag" / "branch" / "script")
            }, ...],
            "script_count": int (scripts/restore_*.sh 總數),
            "error": str or None
        }
    """
    try:
        # 1. 掃 restore-* annotated tags + backup-* branches
        #    git for-each-ref 拎 refname + objectname + committerdate + subject + body
        code, out, err = _run_git([
            "for-each-ref",
            "--format=%(refname:short)|%(objectname)|%(objecttype)|%(committerdate:iso8601)|%(subject)|%(body)",
            "refs/tags/restore-*",
            "refs/heads/backup-*",
        ])
        if code != 0:
            logger.error(f"[Backup Admin] git for-each-ref 失敗: {err}")
            return {
                "ok": False,
                "points": [],
                "script_count": 0,
                "error": f"git for-each-ref 失敗: {err[:200]}",
            }

        # 2. 掃 restore_*.sh scripts, 拎 EXPECTED_HEAD 對應 commit
        script_map = _scan_restore_scripts()  # { filename: commit_hash }

        # 3. Dedup by commit hash, combine tag + branch + script
        points_map: dict = {}
        for line in out.strip().split("\n"):
            if not line.strip():
                continue
            parts = line.split("|", 5)
            if len(parts) < 5:
                logger.warning(f"[Backup Admin] 跳過格式錯嘅 line: {line[:100]}")
                continue
            ref_name, obj_hash, obj_type, date, subject = parts[0], parts[1], parts[2], parts[3], parts[4]
            body = parts[5] if len(parts) > 5 else ""
            is_tag = ref_name.startswith("restore-")
            is_branch = ref_name.startswith("backup-")
            if not (is_tag or is_branch):
                continue

            # 拎 commit hash (annotated tag peel, branch 直接拎)
            commit = _resolve_commit_from_ref(ref_name)
            if not commit:
                logger.warning(f"[Backup Admin] 拎 {ref_name} commit 失敗, skip")
                continue

            # 拎 (init or reuse) 對應 commit 嘅 point
            if commit not in points_map:
                # 對應 script 拎 filename
                script_path = None
                for filename, expected_commit in script_map.items():
                    if expected_commit == commit:
                        script_path = f"scripts/{filename}"
                        break
                points_map[commit] = {
                    "name": None,  # 後填 (優先 tag, 後備 branch)
                    "tag": None,
                    "branch": None,
                    "commit": commit,
                    "commit_short": commit[:8],
                    "date": date,
                    "reason_short": subject,
                    "reason_long": body.strip(),
                    "script_path": script_path,
                    "has_script": script_path is not None,
                    "missing": [],
                }
            point = points_map[commit]
            if is_tag:
                point["tag"] = ref_name
                # tag message 拎 short reason (annotated tag 嘅 message)
                if subject and not point["tag"]:
                    point["reason_short"] = subject
                if body.strip() and not point["reason_long"]:
                    point["reason_long"] = body.strip()
            elif is_branch:
                point["branch"] = ref_name

        # 4. 填 name + missing
        points = []
        for commit, point in points_map.items():
            if point["tag"]:
                point["name"] = point["tag"]
            elif point["branch"]:
                point["name"] = point["branch"]
            else:
                point["name"] = point["commit_short"]

            missing = []
            if not point["tag"]:
                missing.append("tag")
            if not point["branch"]:
                missing.append("branch")
            if not point["has_script"]:
                missing.append("script")
            point["missing"] = missing

            points.append(point)

        # 5. Sort by date desc (最新先)
        points.sort(key=lambda p: p["date"], reverse=True)

        return {
            "ok": True,
            "points": points,
            "script_count": len(script_map),
            "scripts": [f"scripts/{fn}" for fn in script_map.keys()],
            "error": None,
        }
    except Exception as e:
        logger.exception("[Backup Admin] list 失敗")
        return {
            "ok": False,
            "points": [],
            "script_count": 0,
            "error": f"內部錯誤: {e}",
        }


class RestoreRequest(BaseModel):
    """凡人話: 還原請求, 跟 Sscript pattern double confirm

    - tag: 還原到邊個 tag (e.g. "restore-after-zigzag-4.53.0")
    - confirm: 必須係 "RESET" (對齊 Sscript pattern, 防意外)
    """
    tag: str
    confirm: str


@router.post("/restore")
async def restore_backup_point(req: RestoreRequest):
    """凡人話: 跑對應 restore script 做還原 (double confirm 跟 Sscript pattern)

    Body: { "tag": "restore-after-zigzag-4.53.0", "confirm": "RESET" }
    1. validate confirm == "RESET" (防意外)
    2. 搵對應 scripts/restore_*.sh (由 tag name 推算 filename)
    3. shell exec script, auto input "yes\nRESET\n" 落 stdin
    4. 返 { ok, stdout, stderr, returncode }

    ⚠️ 永久 rule: backend 唔可以自己 run 還原 script 唔 confirm, 大少 trigger double confirm modal 嗰陣
       frontend 要 send confirm="RESET" 嚟到 backend, backend 仲會 verify once (跟 Sscript pattern 兩層 confirm)
    """
    if req.confirm != "RESET":
        raise HTTPException(status_code=400, detail="confirm 必須係 'RESET' (防意外)")

    # 1. 拎對應 commit hash (先 peel tag)
    commit = _resolve_commit_from_ref(req.tag)
    if not commit:
        raise HTTPException(status_code=404, detail=f"Tag {req.tag} 唔存在")

    # 2. 搵對應 restore script (scan by EXPECTED_HEAD)
    script_map = _scan_restore_scripts()
    script_filename = None
    for filename, expected_commit in script_map.items():
        if expected_commit == commit:
            script_filename = filename
            break
    if not script_filename:
        raise HTTPException(
            status_code=404,
            detail=f"Tag {req.tag} (commit {commit[:8]}) 冇對應 restore script (scripts/restore_*.sh)"
        )
    script_path = os.path.join(SCRIPTS_DIR, script_filename)
    if not os.path.exists(script_path):
        raise HTTPException(status_code=500, detail=f"Script {script_path} 唔存在")

    # 3. 跑 script, auto input "yes\nRESET\n" 落 stdin (跟 Sscript pattern 兩層 confirm 對齊)
    try:
        proc = subprocess.run(
            ["bash", script_path],
            input="yes\nRESET\n",
            capture_output=True,
            text=True,
            cwd=PROJECT_ROOT,
            timeout=60,  # restore 通常 5-10 秒, set 60s buffer
        )
        return {
            "ok": proc.returncode == 0,
            "tag": req.tag,
            "commit": commit,
            "script": f"scripts/{script_filename}",
            "returncode": proc.returncode,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail=f"Restore script timeout (60s): {script_filename}")
    except Exception as e:
        logger.exception(f"[Backup Admin] restore 失敗: tag={req.tag}")
        raise HTTPException(status_code=500, detail=f"Restore 失敗: {e}")

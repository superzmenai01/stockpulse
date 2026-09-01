"""
backend/api/backup_admin.py — 備份還原點管理 API endpoint (大少 2026-08-31 12:00 trigger)

凡人話: 拎所有備份點 (annotated tag + backup branch + restore script) 嘅 metadata,
畀 backup-admin page 顯示 list + 揀邊個做還原。

對齊 §15.45 永久 rule Sscript pattern (annotated tag + backup branch + restore script):
- 掃 refs/tags/restore-* 拎 annotated tag
- 掃 refs/heads/backup-* 拎 backup branch
- 掃 scripts/restore_*.sh 拎 restore script (按 EXPECTED_HEAD 拎 commit hash 對應)
- Dedup by commit hash, combine tag + branch + script 入同一個 backup point

Endpoints (大少 8月31日 17:37 trigger 加 3 個新 endpoint):
- GET /api/backup-points/list → 拎所有備份 list (加 can_restore field)
- POST /api/backup-points/restore → 揀 tag 跑對應 restore script (double confirm 跟 Sscript pattern)
- GET /api/backup-points/audit → 拎 git reflog 嘅 reset history (audit trail, 對齊 §15.55 永久 rule C 方向)
- POST /api/backup-points/recover-script → 用 git show 拎返 reset 之前 commit 嘅 script (對齊大少 trigger「可能會再用」, §15.55 D 方向)
- POST /api/backup-points/set → 自動 generate script + tag + branch + push (Sscript set helper, 對齊 §15.45 + §15.55 B 方向)

對應 frontend: ~/stockpulse/backup-admin/ (跟 testing-page 風格, 大少 12:03 揀嘅 option)
對應 Sscript pattern: scripts/restore_*.sh (大少 8月31日 07:52 + 11:59 trigger)
對應 §15.55 永久 rule (大少 8月31日 17:37 trigger, 4 個優化方向 + 保留 tag)

Spec Sync: §15.54 + §15.55 (待 push, 大少 confirm 後)
"""

import logging
import os
import re
import subprocess
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Project root = backend 嘅 parent directory
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPTS_DIR = os.path.join(PROJECT_ROOT, "scripts")

router = APIRouter(prefix="/api/backup-points", tags=["backup-admin"])


def _run_git(args: List[str], cwd: Optional[str] = None) -> tuple[int, str, str]:
    """凡人話: 跑 git command + 拎 (returncode, stdout, stderr)

    §15.55 D 方向 fix: uvicorn subprocess 拎唔到 dangling commit 嘅 stdout
    workaround: 用 tempfile 拎 output (避免 pipe buffering issue)
    """
    import os as _os
    import tempfile as _tempfile
    try:
        # 顯式 set env 拎返 git commit (uvicorn subprocess 拎唔到 stdout 嘅 workaround)
        env = _os.environ.copy()
        env["GIT_DIR"] = _os.path.join(cwd or PROJECT_ROOT, ".git")
        env["GIT_WORK_TREE"] = cwd or PROJECT_ROOT
        env.pop("GIT_PAGER", None)
        env.pop("GIT_OPTIONAL_LOCKS", None)

        # §15.55 D 方向 fix: 用 tempfile 拎 output (uvicorn subprocess pipe buffering 拎空 stdout 嘅 workaround)
        with _tempfile.NamedTemporaryFile(mode="w+", suffix=".txt", delete=False, dir="/tmp") as tmp_out:
            tmp_out_path = tmp_out.name
        with _tempfile.NamedTemporaryFile(mode="w+", suffix=".txt", delete=False, dir="/tmp") as tmp_err:
            tmp_err_path = tmp_err.name

        try:
            with open(tmp_out_path, "w") as f_out, open(tmp_err_path, "w") as f_err:
                result = subprocess.run(
                    ["git"] + args,
                    stdout=f_out, stderr=f_err, text=True,
                    cwd=cwd or PROJECT_ROOT, env=env, timeout=10
                )

            with open(tmp_out_path, "r") as f:
                stdout = f.read()
            with open(tmp_err_path, "r") as f:
                stderr = f.read()

            # §15.55 D 方向 fix: uvicorn subprocess stdout 拎唔到 (空 string) 嘅 fallback
            # 用 Popen + 顯式 communicate 拎 output
            if result.returncode == 0 and not stdout:
                import subprocess as _sp
                proc = _sp.Popen(
                    ["git"] + args,
                    stdout=_sp.PIPE, stderr=_sp.PIPE, text=True,
                    cwd=cwd or PROJECT_ROOT, env=env
                )
                stdout, stderr = proc.communicate(timeout=10)
                logger.warning(f"[Backup Admin DEBUG] Popen fallback: returncode={proc.returncode}, stdout={stdout[:200]!r}, stderr={stderr[:200]!r}")
                return proc.returncode, stdout, stderr

            return result.returncode, stdout, stderr
        finally:
            # Clean up tempfiles
            for tmp_path in [tmp_out_path, tmp_err_path]:
                try:
                    _os.unlink(tmp_path)
                except Exception:
                    pass
    except subprocess.TimeoutExpired:
        return -1, "", "git command timeout (10s)"
    except Exception as e:
        return -1, "", f"git command 失敗: {e}"


def _run_git_debug(args: List[str], cwd: Optional[str] = None) -> tuple[int, str, str]:
    """debug version: print + log git command 拎到咩 (for §15.55 D 方向 recover-script debug)"""
    code, out, err = _run_git(args, cwd)
    logger.warning(f"[Backup Admin DEBUG] git {' '.join(args)}: returncode={code}, stdout={out[:200]!r}, stderr={err[:200]!r}, cwd={cwd or PROJECT_ROOT}")
    return code, out, err


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
    大少 2026-08-31 17:37 trigger §15.55 A 方向: 加 can_restore field 對齊 missing warning UI
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
                "missing": [str] (缺少嘅 component: "tag" / "branch" / "script"),
                "can_restore": bool (§15.55 A 方向: missing empty = true, otherwise false)
            }, ...],
            "script_count": int (scripts/restore_*.sh 總數),
            "error": str or None
        }
    """
    try:
        # 1. 大少 9月1日 18:00 trigger (4.64.0) — 分開 query tag + branch
        #    因為 %(subject) 拎 commit subject (tag 指去 commit, 所以會拎 commit 而唔係 tag 嘅 message)
        #    用 %(contents:subject) 先拎到 annotated tag 嘅 message subject
        #    凡人話: 之前 bug, 4.64.0 編輯 tag 註解後, list endpoint 仍然拎 commit 嘅舊 reason, 唔顯示新 tag 註解

        # 1a. 掃 restore-* annotated tags (拎 tag 嘅 annotated message 而唔係 commit)
        code, tags_out, err = _run_git([
            "for-each-ref",
            "--format=%(refname:short)|%(objectname)|%(objecttype)|%(committerdate:iso8601)|%(contents:subject)|%(contents:body)",
            "refs/tags/restore-*",
        ])
        if code != 0:
            logger.error(f"[Backup Admin] git for-each-ref tags 失敗: {err}")
            return {
                "ok": False,
                "points": [],
                "script_count": 0,
                "error": f"git for-each-ref tags 失敗: {err[:200]}",
            }

        # 1b. 掃 backup-* branches (branch 冇自己 message, 拎 commit message)
        code, branches_out, err = _run_git([
            "for-each-ref",
            "--format=%(refname:short)|%(objectname)|%(objecttype)|%(committerdate:iso8601)|%(subject)|%(body)",
            "refs/heads/backup-*",
        ])
        if code != 0:
            logger.error(f"[Backup Admin] git for-each-ref branches 失敗: {err}")
            return {
                "ok": False,
                "points": [],
                "script_count": 0,
                "error": f"git for-each-ref branches 失敗: {err[:200]}",
            }

        # 合併 tags + branches output
        out_lines = []
        if tags_out.strip():
            out_lines.extend(tags_out.strip().split("\n"))
        if branches_out.strip():
            out_lines.extend(branches_out.strip().split("\n"))
        out = "\n".join(out_lines)

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
                    "name": None,
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
                if subject and not point["tag"]:
                    point["reason_short"] = subject
                if body.strip() and not point["reason_long"]:
                    point["reason_long"] = body.strip()
            elif is_branch:
                point["branch"] = ref_name

        # 4. 填 name + missing + can_restore (§15.55 A 方向)
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
            # §15.55 A 方向: can_restore = true if 冇 missing (即係 tag + branch + script 齊)
            point["can_restore"] = len(missing) == 0

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


# ============================================================
# §15.55 永久 rule (大少 2026-08-31 17:37 trigger) — 4 個新 endpoint
# ============================================================

@router.get("/audit")
async def get_audit_trail():
    """凡人話: 拎返 git reflog 嘅 reset history (audit trail, §15.55 C 方向)

    大少 17:37 trigger「全部都做」+ C 方向: Audit trail
    對齊 §15.45 永久 rule audit + 12:08 user memory 永久 rule

    Algorithm:
    1. 跑 `git reflog --pretty=format:%H|%gs|%gd` 拎 reset 記錄
    2. 對每個 reset commit, 拎對應 annotated tag (如果有 restore-<name>)
    3. 拎 commit date 用 `git show -s --format=%ci`
    4. Return [{ commit, commit_short, date, message, ref, restore_tag }]

    Returns:
        {
            "ok": bool,
            "audit": [{
                "commit": str (40 hex),
                "commit_short": str (8 hex),
                "date": str (ISO 8601),
                "message": str (e.g. "reset: moving to 1fca411b"),
                "ref": str (e.g. "HEAD@{5}"),
                "restore_tag": str or None (對應 restore-<name> tag 如果有)
            }, ...],
            "count": int
        }
    """
    try:
        # 1. 跑 git reflog 拎 reset 記錄
        code, out, err = _run_git([
            "reflog",
            "--pretty=format:%H|%gs|%gd",
        ])
        if code != 0:
            logger.error(f"[Backup Admin] git reflog 失敗: {err}")
            return {
                "ok": False,
                "audit": [],
                "count": 0,
                "error": f"git reflog 失敗: {err[:200]}",
            }

        audit_entries = []
        for line in out.strip().split("\n"):
            if not line.strip():
                continue
            if "reset:" not in line or "moving to" not in line:
                continue
            parts = line.split("|")
            if len(parts) < 3:
                continue
            commit_hash = parts[0].strip()
            message = parts[1].strip()
            ref = parts[2].strip()

            # 2. 拎 commit date
            date_code, date_out, _ = _run_git(["show", "-s", "--format=%ci", commit_hash])
            commit_date = date_out.strip() if date_code == 0 else None

            # 3. 拎對應 annotated tag (如果 commit 對應 restore-<name> tag)
            tag_code, tag_out, _ = _run_git(["tag", "--points-at", commit_hash])
            tags = tag_out.strip().split("\n") if tag_code == 0 and tag_out.strip() else []
            restore_tag = next((t for t in tags if t.startswith("restore-")), None)

            audit_entries.append({
                "commit": commit_hash,
                "commit_short": commit_hash[:8],
                "date": commit_date,
                "message": message,
                "ref": ref,
                "restore_tag": restore_tag,
            })

        # Sort by date desc (最新先)
        audit_entries.sort(key=lambda a: a.get("date") or "", reverse=True)

        return {
            "ok": True,
            "audit": audit_entries,
            "count": len(audit_entries),
            "error": None,
        }
    except Exception as e:
        logger.exception("[Backup Admin] audit 失敗")
        return {
            "ok": False,
            "audit": [],
            "count": 0,
            "error": f"內部錯誤: {e}",
        }


class RecoverScriptRequest(BaseModel):
    """凡人話: Recover script 請求, 對齊大少 17:37 trigger「保留 tag + 可能會再用」

    - tag: 邊個 tag 嘅 script 拎拎返
    """
    tag: str


@router.post("/recover-script")
async def recover_script_endpoint(req: RecoverScriptRequest):
    """凡人話: 用 `git show <tag-commit>:<script-path>` 拎返 reset 之前 commit 嘅 script

    大少 17:37 trigger「還完了後我不想删走那個還完點,因為可能會再用」
    對齊 §15.45 永久 rule Sscript pattern + 12:08 user memory 永久 rule (保留 tag)
    對齊 §15.55 D 方向: Recover script (redefined cleanup)

    Algorithm:
    1. 拎 tag 對應 commit (`git rev-list -1 <tag>`)
    2. 拎 script filename (tag name → restore_<name>.sh)
    3. 拎 script content 用 `git show <commit>:<script-path>`
    4. 寫返落 disk + chmod +x
    5. Git add + commit + push (拎返入 git history)
    6. Frontend reload /list, 見到 missing: [] 變返 can_restore = true

    Returns:
        {
            "ok": bool,
            "tag": str,
            "commit": str,
            "script_path": str,
            "message": str
        }
    """
    try:
        # 1. 拎 tag 對應 commit
        code, out, err = _run_git(["rev-list", "-1", req.tag])
        if code != 0 or not out.strip():
            return {
                "ok": False,
                "error": f"Tag {req.tag} 拎唔到 commit: {err[:200]}"
            }
        tag_commit = out.strip()

        # 2. 拎 script filename (對齊 §15.45 永久 rule: tag name 對應 scripts/restore_<name>.sh)
        # e.g. "restore-before-zigzag-4.56.0" → "scripts/restore_before_zigzag_4.56.0.sh"
        script_name = req.tag.replace("restore-", "restore_") + ".sh"
        script_path_rel = f"scripts/{script_name}"

        # 3. §15.55 D 方向: 拎返 script 嘅 commit
        # Step 3a: 試 tag commit (普通 case, e.g. tag + script 同一個 commit)
        code, out, err = _run_git(["show", f"{tag_commit}:{script_path_rel}"])
        script_content = None
        commit = tag_commit

        if code == 0 and out.strip():
            script_content = out
        else:
            # Step 3b: tag commit 入面冇 script (reset 之後拎走 case, 對齊大少 trigger「可能會再用」)
            # 用 `git log --all --reflog` 拎返最後 commit 拎返 script
            # 因為 reset 拎返之前 commit, 之後 commit 拎返 Sscript 仲喺 reflog 但係 dangling
            # 對齊 §15.45 永久 rule Sscript pattern + 12:08 user memory 永久 rule
            # 注意: 唔用 --oneline (會撞 --pretty=format:%H format 衝突)
            log_code, log_out, log_err = _run_git_debug([
                "log", "--all", "--reflog", "--pretty=format:%H", "--", script_path_rel
            ])
            if log_code == 0 and log_out.strip():
                # 拎最後 commit 拎返 script (most recent commit 個 commit 拎返)
                dangling_commit = log_out.strip().split("\n")[0]
                show_code, show_out, show_err = _run_git(["show", f"{dangling_commit}:{script_path_rel}"])
                if show_code == 0 and show_out.strip():
                    script_content = show_out
                    commit = dangling_commit
                else:
                    return {
                        "ok": False,
                        "error": f"Tag {req.tag} 對應 commit {tag_commit[:8]} + dangling commit {dangling_commit[:8]} 都拎唔到 script {script_path_rel}: {show_err[:200]}"
                    }
            else:
                return {
                    "ok": False,
                    "error": f"Tag {req.tag} 對應 commit {tag_commit[:8]} 拎唔到 script {script_path_rel}, git reflog 都拎唔到 dangling commit 拎返: {err[:200]}"
                }

        # 4. 寫返落 disk
        script_path_abs = os.path.join(PROJECT_ROOT, script_path_rel)
        os.makedirs(os.path.dirname(script_path_abs), exist_ok=True)
        with open(script_path_abs, "w", encoding="utf-8") as f:
            f.write(script_content)
        os.chmod(script_path_abs, 0o755)

        # 5. Git add + commit + push (拎返入 git history, 對齊 §15.45 + 12:08 user memory 永久 rule)
        # 凡人話: 因為 commit <commit> 入面已經有呢個 script, 重新寫入但唔 push 會變 uncommitted
        # 解決: write 落 disk + git add + git commit "chore: recover <script> from <tag>" + push
        code, _, err = _run_git(["add", script_path_rel])
        if code != 0:
            return {
                "ok": False,
                "error": f"git add 失敗: {err[:200]}"
            }
        commit_msg = f"chore: recover {script_path_rel} from tag {req.tag} (commit {commit[:8]})\n\n對齊大少 8月31日 17:37 trigger 保留還原點 + recover script"
        code, _, err = _run_git(["commit", "-m", commit_msg])
        if code != 0:
            return {
                "ok": False,
                "error": f"git commit 失敗: {err[:200]}"
            }
        code, _, err = _run_git(["push", "origin", "main"])
        if code != 0:
            return {
                "ok": False,
                "error": f"git push 失敗: {err[:200]}"
            }

        return {
            "ok": True,
            "tag": req.tag,
            "commit": commit,
            "script_path": script_path_rel,
            "message": f"✅ 已 recover {script_path_rel} from {req.tag} (commit {commit[:8]})",
        }
    except Exception as e:
        logger.exception(f"[Backup Admin] recover-script 失敗: tag={req.tag}")
        return {
            "ok": False,
            "error": f"內部錯誤: {e}",
        }


class SetRestorePointRequest(BaseModel):
    """凡人話: 設定新還原點請求, 對齊 §15.45 永久 rule Sscript pattern

    - name: 還原點名稱 (e.g. "before-xxx-4.50.0", 會變 restore-before-xxx-4.50.0 tag)
    - reason_short: 原因 (短, 拎做 tag message subject)
    - reason_long: 原因 (長, 拎做 tag message body)
    - description: 額外 description (optional, 拎做 script 內嘅 comment)
    """
    name: str
    reason_short: str
    reason_long: str
    description: str = ""


@router.post("/set")
async def set_restore_point(req: SetRestorePointRequest):
    """凡人話: 自動 generate script + tag + branch + push (對齊 §15.45 Sscript pattern)

    大少 17:37 trigger「全部都做」+ B 方向: Sscript set helper
    對齊 §15.45 永久 rule: tag + branch + script + double confirm
    對齊 12:08 user memory 永久 rule: 每做新 Sscript 還原點都要 verify Backup Admin Page 拎到

    Algorithm:
    1. 拎當前 HEAD commit
    2. Generate script file (scripts/restore_<name>.sh) 對齊 Sscript pattern
    3. Git add + commit
    4. Annotated tag (git tag -a restore-<name> -m ...)
    5. Backup branch (git branch backup-<name> HEAD)
    6. Push (git push origin main + tag + branch)

    Returns:
        {
            "ok": bool,
            "name": str,
            "tag": str,
            "branch": str,
            "commit": str,
            "script_path": str,
            "message": str
        }
    """
    try:
        # 1. 拎當前 HEAD commit (將來 reset 拎返呢個 commit)
        code, out, err = _run_git(["rev-parse", "HEAD"])
        if code != 0 or not out.strip():
            return {
                "ok": False,
                "error": f"Git HEAD 拎唔到: {err[:200]}"
            }
        commit = out.strip()

        # 2. 檢查 name 已經存在 (避免覆蓋)
        tag_name = f"restore-{req.name}"
        branch_name = f"backup-{req.name}"
        script_name = f"restore_{req.name.replace('-', '_')}.sh"
        script_path_rel = f"scripts/{script_name}"

        # 拎返 tag existence
        code, _, _ = _run_git(["rev-parse", "--verify", tag_name])
        if code == 0:
            return {
                "ok": False,
                "error": f"Tag {tag_name} 已經存在, 唔可以覆蓋 (避免 reset 拎返衝突嘅 commit)"
            }

        # 拎返 script existence
        script_path_abs = os.path.join(PROJECT_ROOT, script_path_rel)
        if os.path.exists(script_path_abs):
            return {
                "ok": False,
                "error": f"Script {script_path_rel} 已經存在, 唔可以覆蓋"
            }

        # 3. Generate script file (對齊 §15.45 永久 rule Sscript pattern)
        now_iso = datetime.now().isoformat()
        script_content = f"""#!/bin/bash
# Auto-generated restore script for {tag_name}
# 對齊 §15.45 永久 rule Sscript pattern (annotated tag + backup branch + restore script + double confirm)
# Generated: {now_iso}
# 大少 8月31日 17:37 trigger 自動 set helper (B 方向)

set -e

EXPECTED_HEAD="{commit}"

echo "⚠️  WARNING: 拎走改動, 還原到 {req.name}"
echo ""
echo "Reason: {req.reason_short}"
echo ""
{('Description: ' + req.description + chr(10) + chr(10)) if req.description else ''}echo "呢個 script 會:"
echo "  1. 拎走所有 uncommitted changes (git stash)"
echo "  2. Reset HEAD 去 $EXPECTED_HEAD ({req.name})"
echo "  3. 拎返 annotated tag + backup branch 嘅 evidence"
echo ""
echo "要繼續嗎? 輸入 'yes' 確認:"
read -r confirm
if [ "$confirm" != "yes" ]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "請輸入 'RESET' 確認拎走改動:"
read -r reset_confirm
if [ "$reset_confirm" != "RESET" ]; then
    echo "Cancelled."
    exit 0
fi

# 1. Stash uncommitted changes
git stash push -m "auto-stash before restore-{req.name}"

# 2. Reset HEAD
git reset --hard $EXPECTED_HEAD

# 3. Verify
git log --oneline -3
echo ""
echo "✅ 已還原到 {req.name} ($EXPECTED_HEAD)"
echo "記住: backend 要 restart 先 load 對應 code (§15.51 永久 rule)"
"""
        os.makedirs(os.path.dirname(script_path_abs), exist_ok=True)
        with open(script_path_abs, "w", encoding="utf-8") as f:
            f.write(script_content)
        os.chmod(script_path_abs, 0o755)

        # 4. Git add + commit
        code, _, err = _run_git(["add", script_path_rel])
        if code != 0:
            return {
                "ok": False,
                "error": f"git add 失敗: {err[:200]}"
            }
        commit_msg = f"chore(scripts): 加 {req.name} 還原點 Sscript\n\n{req.reason_long}\n\n對齊 §15.45 Sscript pattern (大少 8月31日 17:37 trigger B 方向)"
        code, _, err = _run_git(["commit", "-m", commit_msg])
        if code != 0:
            return {
                "ok": False,
                "error": f"git commit 失敗: {err[:200]}"
            }

        # 5. Annotated tag
        tag_msg = f"{req.reason_short}\n\n{req.reason_long}"
        code, _, err = _run_git(["tag", "-a", tag_name, "-m", tag_msg])
        if code != 0:
            return {
                "ok": False,
                "error": f"git tag 失敗: {err[:200]}"
            }

        # 6. Backup branch
        code, _, err = _run_git(["branch", branch_name, "HEAD"])
        if code != 0:
            return {
                "ok": False,
                "error": f"git branch 失敗: {err[:200]}"
            }

        # 7. Push (main + tag + branch)
        code, _, err = _run_git(["push", "origin", "main"])
        if code != 0:
            return {
                "ok": False,
                "error": f"git push main 失敗: {err[:200]}"
            }
        code, _, err = _run_git(["push", "origin", tag_name])
        if code != 0:
            return {
                "ok": False,
                "error": f"git push tag 失敗: {err[:200]}"
            }
        code, _, err = _run_git(["push", "origin", branch_name])
        if code != 0:
            return {
                "ok": False,
                "error": f"git push branch 失敗: {err[:200]}"
            }

        return {
            "ok": True,
            "name": req.name,
            "tag": tag_name,
            "branch": branch_name,
            "commit": commit,
            "script_path": script_path_rel,
            "message": f"✅ 已設定 {req.name} 還原點 (tag + branch + script + push)",
        }
    except Exception as e:
        logger.exception(f"[Backup Admin] set 失敗: name={req.name}")
        return {
            "ok": False,
            "error": f"內部錯誤: {e}",
        }


# 大少 2026-09-01 18:00 trigger (4.64.0) — Backup Admin Page 加「編輯註解」功能
# 對齊 §15.45 + §15.53 + §15.54 + 12:08 user memory 永久 rule
class AnnotateRequest(BaseModel):
    """凡人話: 編輯備份還原點註解請求, 改 git tag message 唔郁 commit

    - tag: 現有 annotated tag 名 (e.g. "restore-2026-09-01-stocks-async")
    - reason_short: 新 short reason (拎做 tag message subject)
    - reason_long: 新 long reason (拎做 tag message body)
    - update_script: True/False, 同步更新對應 script header comment
    """
    reason_short: str
    reason_long: str
    update_script: bool = True


@router.post("/{tag_name}/annotate")
async def annotate_backup_point(tag_name: str, req: AnnotateRequest):
    """凡人話: 改現有 annotated tag 嘅 message, 唔郁 commit hash

    大少 9月1日 18:00 trigger「把備份還原點管理 增加我可以修改或加入註解」

    Algorithm:
    1. 拎返 tag 對應 commit hash (用 _resolve_commit_from_ref)
    2. 驗證 tag 存在
    3. Force update tag message: `git tag -f <tag> <commit> -m <new_msg>`
       (保留 commit 唔郁, 永遠唔郁 evidence, 改 message)
    4. Force push tag 去 origin: `git push origin --force <tag>`
    5. (Optional) 同步更新對應 script header comment:
       - 拎 tag 對應 backup branch
       - 拎返 script 內容
       - 改 header 段 (`# Restore script for ...` + reason_short + reason_long)
       - 寫返落 disk
       - Git add + commit + push (喺 backup branch 上)
    6. Return 新嘅 tag 註解

    Returns:
        {
            "ok": bool,
            "tag": str,
            "commit": str,
            "script_updated": bool,
            "script_path": str or None,
            "message": str
        }
    """
    try:
        # 1. 拎返 tag 對應 commit (annotated tag peel)
        commit = _resolve_commit_from_ref(tag_name)
        if not commit:
            return {
                "ok": False,
                "error": f"Tag {tag_name} 唔存在, 拎唔到對應 commit",
            }

        # 2. 驗證 reason_short + reason_long 唔可以空
        if not req.reason_short.strip():
            return {
                "ok": False,
                "error": "Reason (short) 唔可以空",
            }
        if not req.reason_long.strip():
            return {
                "ok": False,
                "error": "Reason (long) 唔可以空",
            }

        # 3. Force update tag message
        new_tag_msg = f"{req.reason_short}\n\n{req.reason_long}"
        code, out, err = _run_git(["tag", "-f", tag_name, commit, "-m", new_tag_msg])
        if code != 0:
            return {
                "ok": False,
                "error": f"git tag -f 失敗: {err[:300]}",
            }

        # 4. Force push tag 去 origin
        code, out, err = _run_git(["push", "origin", "--force", tag_name])
        if code != 0:
            return {
                "ok": False,
                "error": f"git push --force tag 失敗: {err[:300]}",
            }

        # 5. Optional: 同步更新 script header
        script_updated = False
        script_path_rel = None
        if req.update_script:
            # 拎返 backup branch 名 (e.g. restore-2026-09-01-stocks-async → backup-2026-09-01-stocks-async)
            branch_name = tag_name.replace("restore-", "backup-", 1)
            # 對應 script 路徑 (e.g. scripts/restore_2026_09_01_stocks_async.sh)
            script_basename = tag_name.replace("restore-", "restore_", 1).replace("-", "_") + ".sh"
            script_path_rel = f"scripts/{script_basename}"
            script_path_abs = os.path.join(PROJECT_ROOT, script_path_rel)

            if os.path.exists(script_path_abs):
                # 讀現有 script, 改 header 段 (由 `# Restore script` 到第一個空行)
                with open(script_path_abs, "r", encoding="utf-8") as f:
                    script_lines = f.readlines()

                new_header_lines = [
                    f"# Restore script for {tag_name}\n",
                    f"# 對齊 §15.45 永久 rule Sscript pattern (annotated tag + backup branch + restore script + double confirm)\n",
                    f"#\n",
                    f"# 大少 2026-09-01 18:00 trigger 編輯註解 (4.64.0)\n",
                    f"# Reason (short): {req.reason_short}\n",
                    f"#\n",
                    f"# Reason (long):\n",
                ]
                # 加 long reason (每行前加 # 拎做 comment)
                for line in req.reason_long.split("\n"):
                    new_header_lines.append(f"#   {line}\n")
                new_header_lines.append(f"#\n")

                # 搵原本 header 結束位置 (第一個空行 或 "set -e" line)
                body_start_idx = 0
                for i, line in enumerate(script_lines):
                    if line.strip() == "" and i > 5:  # 跳過最前幾行註解
                        body_start_idx = i + 1
                        break
                    if line.strip() == "set -e":
                        body_start_idx = i
                        break

                # 合併新 header + 原本 body
                new_script = "".join(new_header_lines) + "".join(script_lines[body_start_idx:])

                with open(script_path_abs, "w", encoding="utf-8") as f:
                    f.write(new_script)

                # Git add + commit + push (喺 main branch 上)
                code, _, err = _run_git(["add", script_path_rel])
                if code != 0:
                    return {
                        "ok": False,
                        "error": f"git add script 失敗: {err[:300]}",
                    }
                commit_msg = f"docs(scripts): 編輯 {tag_name} script header 對齊新註解\n\n{req.reason_long}\n\n對齊 4.64.0 Backup Admin 編輯註解永久 rule"
                code, _, err = _run_git(["commit", "-m", commit_msg])
                if code != 0:
                    return {
                        "ok": False,
                        "error": f"git commit script 失敗: {err[:300]}",
                    }
                code, _, err = _run_git(["push", "origin", "main"])
                if code != 0:
                    return {
                        "ok": False,
                        "error": f"git push main 失敗: {err[:300]}",
                    }
                script_updated = True
            else:
                return {
                    "ok": True,
                    "tag": tag_name,
                    "commit": commit,
                    "script_updated": False,
                    "script_path": None,
                    "message": f"✅ 已更新 {tag_name} 註解 (但 script {script_path_rel} 唔存在, 冇改 script)",
                }

        return {
            "ok": True,
            "tag": tag_name,
            "commit": commit,
            "script_updated": script_updated,
            "script_path": script_path_rel,
            "message": f"✅ 已更新 {tag_name} 註解" + (f" + script {script_path_rel}" if script_updated else ""),
        }
    except Exception as e:
        logger.exception(f"[Backup Admin] annotate 失敗: tag={tag_name}")
        return {
            "ok": False,
            "error": f"內部錯誤: {e}",
        }

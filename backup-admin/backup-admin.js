// 備份還原點管理 Page JS (大少 2026-08-31 12:00 trigger, 跟 testing-page 風格)
// 對齊 §15.45 永久 rule Sscript pattern (annotated tag + backup branch + restore script)
// 對齊 §15.55 永久 rule (大少 8月31日 17:37 trigger, 4 個優化方向):
//   A. Missing warning UI: renderBackupList 顯示 can_restore 警告
//   B. Sscript set helper: executeSscriptSet + showSscriptSetModal handler
//   C. Audit trail: loadAuditTrail + renderAuditHistory handler
//   D. Recover script (redefined cleanup): recoverScript handler (大少 trigger「保留 tag + 可能會再用」)

const API_BASE = 'http://localhost:18792/api/backup-points';
const CACHE_BUST = '1.3.0';  // §15.55 bump: 1.1.0 → 1.2.0 (4.63.0 清舊) → 1.3.0 (4.64.0 加 annotate)

let currentPoints = [];  // 拎到嘅 backup points cache
let currentRestoreTag = null;  // 撳咗「還原」嘅 tag name
let currentRecoverTag = null;  // 撳咗「Recover script」嘅 tag name (§15.55 D 方向)
let currentAnnotateTag = null;  // 撳咗「編輯註解」嘅 tag name (4.64.0)

// === DOM refs ===
const statusBanner = document.getElementById('status-banner');
const loadBtn = document.getElementById('load-btn');
const refreshBtn = document.getElementById('refresh-btn');
const lastLoadTimeEl = document.getElementById('last-load-time');
const backupListContainer = document.getElementById('backup-list-container');
const sscriptSetBtn = document.getElementById('sscript-set-btn');
const loadAuditBtn = document.getElementById('load-audit-btn');
const auditHistoryContainer = document.getElementById('audit-history-container');

const confirmModal = document.getElementById('confirm-modal');
const modalTagName = document.getElementById('modal-tag-name');
const modalCommand = document.getElementById('modal-command');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const modalConfirmBtn = document.getElementById('modal-confirm-btn');

const progressModal = document.getElementById('progress-modal');
const progressOutput = document.getElementById('progress-output');
const progressCloseBtn = document.getElementById('progress-close-btn');

// §15.55 B 方向: Sscript set modal
const sscriptSetModal = document.getElementById('sscript-set-modal');
const sscriptNameInput = document.getElementById('sscript-name');
const sscriptReasonShortInput = document.getElementById('sscript-reason-short');
const sscriptReasonLongInput = document.getElementById('sscript-reason-long');
const sscriptDescriptionInput = document.getElementById('sscript-description');
const sscriptSetCancelBtn = document.getElementById('sscript-set-cancel-btn');
const sscriptSetConfirmBtn = document.getElementById('sscript-set-confirm-btn');

// §15.55 D 方向: Recover modal
const recoverModal = document.getElementById('recover-modal');
const recoverTagName = document.getElementById('recover-tag-name');
const recoverScriptPath = document.getElementById('recover-script-path');
const recoverCancelBtn = document.getElementById('recover-cancel-btn');
const recoverConfirmBtn = document.getElementById('recover-confirm-btn');

// 大少 9月1日 18:00 trigger (4.64.0): Annotate modal refs
const annotateModal = document.getElementById('annotate-modal');
const annotateTagName = document.getElementById('annotate-tag-name');
const annotateCommit = document.getElementById('annotate-commit');
const annotateReasonShortInput = document.getElementById('annotate-reason-short');
const annotateReasonLongInput = document.getElementById('annotate-reason-long');
const annotateUpdateScriptInput = document.getElementById('annotate-update-script');
const annotateScriptPathHint = document.getElementById('annotate-script-path-hint');
const annotateCancelBtn = document.getElementById('annotate-cancel-btn');
const annotateConfirmBtn = document.getElementById('annotate-confirm-btn');

// === 工具 function ===
function showBanner(type, msg) {
  statusBanner.className = `status-banner ${type}`;
  statusBanner.innerHTML = msg;
  statusBanner.style.display = 'block';
  // 5 秒後自動隱藏 (除咗 error)
  if (type !== 'error') {
    setTimeout(() => {
      statusBanner.style.display = 'none';
    }, 5000);
  }
}

function formatDate(isoStr) {
  if (!isoStr) return 'N/A';
  // "2026-08-31T11:48:33+08:00" → "2026-08-31 11:48"
  return isoStr.replace('T', ' ').substring(0, 16);
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// === 載入備份 list ===
async function loadBackupList() {
  loadBtn.disabled = true;
  loadBtn.textContent = '⏳ 載入中...';
  try {
    const resp = await fetch(`${API_BASE}/list?_=${Date.now()}`);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }
    const data = await resp.json();
    if (!data.ok) {
      throw new Error(data.error || '未知錯誤');
    }
    currentPoints = data.points;
    renderBackupList(currentPoints, data.scripts);
    showBanner('success', `✅ 載入 ${data.points.length} 個備份點, 總共 ${data.script_count} 個 restore script`);
    lastLoadTimeEl.textContent = `最後載入: ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    showBanner('error', `❌ 載入失敗: ${err.message}`);
    backupListContainer.innerHTML = `<p class="empty-state">⚠️ 載入失敗, 確認 backend 跑緊 (port 18792)</p>`;
  } finally {
    loadBtn.disabled = false;
    loadBtn.textContent = '🔄 載入備份 list';
  }
}

// === Render 備份 list ===
// §15.55 A 方向: 改 renderBackupList 加 can_restore disable + Recover script inline btn
function renderBackupList(points, scripts) {
  if (!points || points.length === 0) {
    backupListContainer.innerHTML = `
      <div class="empty-state">
        <p>📭 暫時冇備份點</p>
        <p style="margin-top: 8px; font-size: 13px; color: #999;">
          對齊 §15.45 Sscript pattern 整備份: <code>git tag -a restore-xxx -m "原因" && git branch backup-xxx tag-commit && 寫 scripts/restore_xxx.sh</code>
        </p>
        <p style="margin-top: 8px; font-size: 13px; color: #999;">
          已 deploy scripts: ${(scripts || []).map(s => `<code>${escapeHtml(s)}</code>`).join(', ') || '無'}
        </p>
      </div>
    `;
    return;
  }

  const html = points.map((p, idx) => {
    const canRestore = p.can_restore !== false;  // §15.55 A: default true (backward compat)
    const isIncomplete = !canRestore;
    const cardClass = `backup-card ${isIncomplete ? 'incomplete' : ''}`;
    const missingItems = p.missing || [];
    const missingBadges = missingItems.map(m =>
      `<span class="badge badge-missing">⚠️ 缺 ${m}</span>`
    ).join('');
    const reasonLongHtml = p.reason_long
      ? `<div class="backup-card-reason-long">${escapeHtml(p.reason_long)}</div>`
      : '';

    const scriptPath = p.script_path;
    const scriptBadge = p.has_script
      ? `<span class="badge badge-script">📜 ${escapeHtml(scriptPath)}</span>`
      : '<span class="badge badge-missing">⚠️ Script 拎走咗</span>';

    // §15.55 A 方向: can_restore = false 個 card disable reset btn + 加 recover btn
    return `
      <div class="${cardClass}">
        <div class="backup-card-header">
          <h3>${escapeHtml(p.name)}</h3>
          <span class="backup-card-date">${formatDate(p.date)}</span>
          <span class="backup-card-commit">${p.commit_short}</span>
        </div>

        <div class="backup-card-meta">
          ${p.tag ? `<span class="badge badge-tag">🏷️ ${escapeHtml(p.tag)}</span>` : ''}
          ${p.branch ? `<span class="badge badge-branch">🌿 ${escapeHtml(p.branch)}</span>` : ''}
          ${scriptBadge}
          ${p.reason_short ? `<span class="badge badge-reason">${escapeHtml(p.reason_short)}</span>` : ''}
          ${missingBadges}
        </div>

        <div class="backup-card-reason">
          ${p.reason_long ? '' : '<strong>原因:</strong> ' + escapeHtml(p.reason_short || '(無原因)')}
          ${reasonLongHtml}
        </div>

        <div class="backup-card-actions">
          <button class="btn btn-restore" data-idx="${idx}" ${canRestore ? '' : 'disabled'} title="${canRestore ? '' : '⚠️ Missing ' + missingItems.join(', ') + ' (對齊 §15.55 A 方向, 撳 Recover 拎返 script)'}">
            ${canRestore ? '⚠️ 還原到呢個備份' : '🚫 缺 component, 撳 Recover'}
          </button>
          ${!canRestore && p.tag ? `<button class="btn btn-recover" data-tag="${escapeHtml(p.tag)}" title="對齊 §15.55 D 方向, 拎返 reset 之前 commit 嘅 script">🔧 Recover script</button>` : ''}
          ${p.tag ? `<button class="btn btn-annotate" data-tag="${escapeHtml(p.tag)}" title="大少 9月1日 18:00 trigger (4.64.0): 編輯 tag 註解 + 同步更新 script header (commit hash 永遠唔郁)">✏️ 編輯註解</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  backupListContainer.innerHTML = html;

  // 綁定「還原」掣 click handler
  backupListContainer.querySelectorAll('.btn-restore:not(:disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      const point = currentPoints[idx];
      if (point) {
        showRestoreConfirm(point);
      }
    });
  });

  // §15.55 D 方向: 綁定「Recover script」掣 click handler
  backupListContainer.querySelectorAll('.btn-recover').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      const point = currentPoints.find(p => p.tag === tag);
      if (point) {
        showRecoverConfirm(point);
      }
    });
  });

  // 4.64.0: 綁定「編輯註解」掣 click handler
  backupListContainer.querySelectorAll('.btn-annotate').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      const point = currentPoints.find(p => p.tag === tag);
      if (point) {
        showAnnotateModal(point);
      }
    });
  });
}

// === 顯示 double confirm modal (existing) ===
function showRestoreConfirm(point) {
  if (!point.tag) {
    showBanner('error', '❌ 冇 tag 唔可以還原');
    return;
  }
  if (!point.script_path) {
    showBanner('error', `❌ 冇 restore script, 唔可以還原 (point ${point.name})`);
    return;
  }

  currentRestoreTag = point.tag;
  modalTagName.textContent = point.tag;
  modalCommand.textContent = `bash ${point.script_path}`;
  confirmModal.style.display = 'flex';
}

function hideConfirmModal() {
  confirmModal.style.display = 'none';
  currentRestoreTag = null;
}

// === 執行還原 (existing) ===
async function executeRestore() {
  if (!currentRestoreTag) {
    showBanner('error', '❌ 冇選 tag');
    return;
  }
  const tag = currentRestoreTag;
  hideConfirmModal();

  // 顯示 progress modal
  progressOutput.textContent = `啟動中... 還原到 ${tag}...`;
  progressModal.style.display = 'flex';
  progressCloseBtn.disabled = true;
  modalConfirmBtn.disabled = true;

  try {
    const resp = await fetch(`${API_BASE}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: tag, confirm: 'RESET' }),
    });
    const data = await resp.json();
    progressOutput.textContent = JSON.stringify(data, null, 2);

    if (data.ok) {
      showBanner('success', `✅ 還原成功! tag: ${data.tag}, commit: ${data.commit?.substring(0, 8)}`);
    } else {
      showBanner('error', `❌ 還原失敗: ${data.stderr || data.error || '未知錯誤'}`);
    }
  } catch (err) {
    progressOutput.textContent += `\n\n❌ 網絡錯誤: ${err.message}`;
    showBanner('error', `❌ 還原失敗: ${err.message}`);
  } finally {
    progressCloseBtn.disabled = false;
  }
}

// === §15.55 D 方向: Recover script (redefined cleanup) ===
function showRecoverConfirm(point) {
  if (!point.tag) {
    showBanner('error', '❌ 冇 tag 唔可以 recover');
    return;
  }
  currentRecoverTag = point.tag;
  recoverTagName.textContent = point.tag;
  recoverScriptPath.textContent = point.script_path || '(拎返後會見到 path)';
  recoverModal.style.display = 'flex';
}

function hideRecoverModal() {
  recoverModal.style.display = 'none';
  currentRecoverTag = null;
}

async function executeRecoverScript() {
  if (!currentRecoverTag) {
    showBanner('error', '❌ 冇選 tag');
    return;
  }
  const tag = currentRecoverTag;
  hideRecoverModal();

  progressOutput.textContent = `啟動中... Recover script for ${tag}...`;
  progressModal.style.display = 'flex';
  progressCloseBtn.disabled = true;

  try {
    const resp = await fetch(`${API_BASE}/recover-script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: tag }),
    });
    const data = await resp.json();
    progressOutput.textContent = JSON.stringify(data, null, 2);

    if (data.ok) {
      showBanner('success', data.message || `✅ Recover 成功: ${data.tag}`);
      // Reload 拎返 can_restore = true
      loadBackupList();
    } else {
      showBanner('error', `❌ Recover 失敗: ${data.error || '未知錯誤'}`);
    }
  } catch (err) {
    progressOutput.textContent += `\n\n❌ 網絡錯誤: ${err.message}`;
    showBanner('error', `❌ Recover 失敗: ${err.message}`);
  } finally {
    progressCloseBtn.disabled = false;
  }
}

// === 4.64.0: Annotate modal (編輯備份還原點註解) ===
function showAnnotateModal(point) {
  if (!point.tag) {
    showBanner('error', '❌ 冇 tag 唔可以編輯註解');
    return;
  }
  currentAnnotateTag = point.tag;
  annotateTagName.textContent = point.tag;
  annotateCommit.textContent = point.commit || '(拎唔到)';
  // 預填現有值
  annotateReasonShortInput.value = point.reason_short || '';
  annotateReasonLongInput.value = point.reason_long || '';
  annotateUpdateScriptInput.checked = true;  // 預設同步更新 script
  annotateScriptPathHint.textContent = point.script_path || '(冇 script)';
  annotateModal.style.display = 'flex';
}

function hideAnnotateModal() {
  annotateModal.style.display = 'none';
  currentAnnotateTag = null;
}

async function executeAnnotate() {
  if (!currentAnnotateTag) {
    showBanner('error', '❌ 冇選 tag');
    return;
  }
  const tag = currentAnnotateTag;
  const reasonShort = annotateReasonShortInput.value.trim();
  const reasonLong = annotateReasonLongInput.value.trim();
  const updateScript = annotateUpdateScriptInput.checked;

  if (!reasonShort) {
    showBanner('error', '❌ Reason (short) 唔可以空');
    return;
  }
  if (!reasonLong) {
    showBanner('error', '❌ Reason (long) 唔可以空');
    return;
  }

  hideAnnotateModal();

  progressOutput.textContent = `啟動中... 編輯註解 ${tag} (commit ${tag} 永遠唔郁)...`;
  progressModal.style.display = 'flex';
  progressCloseBtn.disabled = true;

  try {
    const resp = await fetch(`${API_BASE}/${encodeURIComponent(tag)}/annotate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason_short: reasonShort,
        reason_long: reasonLong,
        update_script: updateScript,
      }),
    });
    const data = await resp.json();
    progressOutput.textContent = JSON.stringify(data, null, 2);

    if (data.ok) {
      let msg = data.message || `✅ 編輯註解成功: ${data.tag}`;
      if (data.script_updated) {
        msg += ` (commit: ${data.commit_short || data.commit?.substring(0, 8)})`;
      }
      showBanner('success', msg);
      // Reload 拎返新註解
      loadBackupList();
    } else {
      showBanner('error', `❌ 編輯失敗: ${data.error || '未知錯誤'}`);
    }
  } catch (err) {
    progressOutput.textContent += `\n\n❌ 網絡錯誤: ${err.message}`;
    showBanner('error', `❌ 編輯失敗: ${err.message}`);
  } finally {
    progressCloseBtn.disabled = false;
  }
}

// === §15.55 B 方向: Sscript set helper ===
function showSscriptSetModal() {
  sscriptNameInput.value = '';
  sscriptReasonShortInput.value = '';
  sscriptReasonLongInput.value = '';
  sscriptDescriptionInput.value = '';
  sscriptSetModal.style.display = 'flex';
}

function hideSscriptSetModal() {
  sscriptSetModal.style.display = 'none';
}

async function executeSscriptSet() {
  const name = sscriptNameInput.value.trim();
  const reasonShort = sscriptReasonShortInput.value.trim();
  const reasonLong = sscriptReasonLongInput.value.trim();
  const description = sscriptDescriptionInput.value.trim();

  if (!name) {
    showBanner('error', '❌ 名稱唔可以空');
    return;
  }
  if (!reasonShort) {
    showBanner('error', '❌ 原因 (short) 唔可以空');
    return;
  }
  if (!reasonLong) {
    showBanner('error', '❌ 原因 (long) 唔可以空');
    return;
  }

  hideSscriptSetModal();

  progressOutput.textContent = `啟動中... 設定新還原點 ${name} (會自動 tag + branch + script + push)...`;
  progressModal.style.display = 'flex';
  progressCloseBtn.disabled = true;

  try {
    const resp = await fetch(`${API_BASE}/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, reason_short: reasonShort, reason_long: reasonLong, description }),
    });
    const data = await resp.json();
    progressOutput.textContent = JSON.stringify(data, null, 2);

    if (data.ok) {
      showBanner('success', data.message || `✅ 已設定 ${data.name} 還原點`);
      // Reload 拎返新 tag
      loadBackupList();
    } else {
      showBanner('error', `❌ 設定失敗: ${data.error || '未知錯誤'}`);
    }
  } catch (err) {
    progressOutput.textContent += `\n\n❌ 網絡錯誤: ${err.message}`;
    showBanner('error', `❌ 設定失敗: ${err.message}`);
  } finally {
    progressCloseBtn.disabled = false;
  }
}

// === §15.55 C 方向: Audit trail ===
async function loadAuditTrail() {
  loadAuditBtn.disabled = true;
  loadAuditBtn.textContent = '⏳ 載入中...';
  try {
    const resp = await fetch(`${API_BASE}/audit?_=${Date.now()}`);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }
    const data = await resp.json();
    if (!data.ok) {
      throw new Error(data.error || '未知錯誤');
    }
    renderAuditHistory(data.audit || []);
    showBanner('success', `✅ 載入 ${data.count} 條 reset history (大少可以 track 返之前 reset 過邊個還原點)`);
  } catch (err) {
    showBanner('error', `❌ Audit 拎唔到: ${err.message}`);
    auditHistoryContainer.innerHTML = `<p class="empty-state">⚠️ Audit 載入失敗, 確認 backend 跑緊 (port 18792)</p>`;
  } finally {
    loadAuditBtn.disabled = false;
    loadAuditBtn.textContent = '🔄 載入 reset history';
  }
}

function renderAuditHistory(audit) {
  if (!audit || audit.length === 0) {
    auditHistoryContainer.innerHTML = '<p class="empty-state">📭 暫時冇 reset history (git reflog 冇 reset 記錄)</p>';
    return;
  }

  const html = audit.map(a => {
    const tagBadge = a.restore_tag
      ? `<span class="badge badge-tag">🏷️ ${escapeHtml(a.restore_tag)}</span>`
      : '<span class="audit-no-tag">(其他 commit reset)</span>';
    return `
      <div class="audit-entry">
        <span class="audit-date">${formatDate(a.date)}</span>
        <span class="audit-commit">${a.commit_short}</span>
        <span class="audit-ref">${escapeHtml(a.ref)}</span>
        ${tagBadge}
        <span class="audit-message">${escapeHtml(a.message)}</span>
      </div>
    `;
  }).join('');

  auditHistoryContainer.innerHTML = html;
}

// === Event listeners ===
loadBtn.addEventListener('click', loadBackupList);
refreshBtn.addEventListener('click', loadBackupList);
modalCancelBtn.addEventListener('click', hideConfirmModal);
modalConfirmBtn.addEventListener('click', executeRestore);
progressCloseBtn.addEventListener('click', () => {
  progressModal.style.display = 'none';
});

// §15.55 B 方向
sscriptSetBtn.addEventListener('click', showSscriptSetModal);
sscriptSetCancelBtn.addEventListener('click', hideSscriptSetModal);
sscriptSetConfirmBtn.addEventListener('click', executeSscriptSet);

// §15.55 C 方向
loadAuditBtn.addEventListener('click', loadAuditTrail);

// §15.55 D 方向
recoverCancelBtn.addEventListener('click', hideRecoverModal);
recoverConfirmBtn.addEventListener('click', executeRecoverScript);

// 4.64.0: Annotate modal listeners
annotateCancelBtn.addEventListener('click', hideAnnotateModal);
annotateConfirmBtn.addEventListener('click', executeAnnotate);

// Esc 關閉 modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (confirmModal.style.display === 'flex') hideConfirmModal();
    if (progressModal.style.display === 'flex' && !progressCloseBtn.disabled) {
      progressModal.style.display = 'none';
    }
    if (sscriptSetModal.style.display === 'flex') hideSscriptSetModal();
    if (recoverModal.style.display === 'flex') hideRecoverModal();
    if (annotateModal.style.display === 'flex') hideAnnotateModal();
  }
});

// === Page load: 自動 load 一次 ===
window.addEventListener('DOMContentLoaded', () => {
  console.log('[Backup Admin] Page loaded, cache bust:', CACHE_BUST);
  showBanner('info', '👋 備份還原點管理 Page ready. §15.55 4 個新方向: missing warning + Sscript set + audit + recover script');
  // 自動 load 一次 (UX 改善,大少唔使額外 click)
  loadBackupList();
});

console.log('[Backup Admin] Script loaded, cache bust:', CACHE_BUST);

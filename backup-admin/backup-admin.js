// 備份還原點管理 Page JS (大少 2026-08-31 12:00 trigger, 跟 testing-page 風格)
// 對齊 §15.45 永久 rule Sscript pattern (annotated tag + backup branch + restore script)

const API_BASE = 'http://localhost:18792/api/backup-points';
const CACHE_BUST = '1.0.0';

let currentPoints = [];  // 拎到嘅 backup points cache
let currentRestoreTag = null;  // 撳咗「還原」嘅 tag name

// === DOM refs ===
const statusBanner = document.getElementById('status-banner');
const loadBtn = document.getElementById('load-btn');
const refreshBtn = document.getElementById('refresh-btn');
const lastLoadTimeEl = document.getElementById('last-load-time');
const backupListContainer = document.getElementById('backup-list-container');

const confirmModal = document.getElementById('confirm-modal');
const modalTagName = document.getElementById('modal-tag-name');
const modalCommand = document.getElementById('modal-command');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const modalConfirmBtn = document.getElementById('modal-confirm-btn');

const progressModal = document.getElementById('progress-modal');
const progressOutput = document.getElementById('progress-output');
const progressCloseBtn = document.getElementById('progress-close-btn');

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
    const isIncomplete = p.missing && p.missing.length > 0;
    const cardClass = `backup-card ${isIncomplete ? 'incomplete' : ''}`;
    const missingBadges = (p.missing || []).map(m =>
      `<span class="badge badge-missing">⚠️ 缺 ${m}</span>`
    ).join('');
    const reasonLongHtml = p.reason_long
      ? `<div class="backup-card-reason-long">${escapeHtml(p.reason_long)}</div>`
      : '';

    // 揾對應 script
    const scriptPath = p.script_path;
    const canRestore = p.tag && scriptPath;

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
          ${p.has_script ? `<span class="badge badge-script">📜 ${escapeHtml(scriptPath)}</span>` : ''}
          ${p.reason_short ? `<span class="badge badge-reason">${escapeHtml(p.reason_short)}</span>` : ''}
          ${missingBadges}
        </div>

        <div class="backup-card-reason">
          ${p.reason_long ? '' : '<strong>原因:</strong> ' + escapeHtml(p.reason_short || '(無原因)')}
          ${reasonLongHtml}
        </div>

        <div class="backup-card-actions">
          ${canRestore
            ? `<button class="restore-btn" data-idx="${idx}">⚠️ 還原到呢個備份</button>`
            : `<button class="restore-btn" disabled title="需要 tag + script 先可以還原">⚠️ 還原 (缺 component)</button>`
          }
        </div>
      </div>
    `;
  }).join('');

  backupListContainer.innerHTML = html;

  // 綁定「還原」掣 click handler
  backupListContainer.querySelectorAll('.restore-btn:not(:disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      const point = currentPoints[idx];
      if (point) {
        showRestoreConfirm(point);
      }
    });
  });
}

// === 顯示 double confirm modal ===
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

// === 執行還原 ===
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

// === Event listeners ===
loadBtn.addEventListener('click', loadBackupList);
refreshBtn.addEventListener('click', loadBackupList);
modalCancelBtn.addEventListener('click', hideConfirmModal);
modalConfirmBtn.addEventListener('click', executeRestore);
progressCloseBtn.addEventListener('click', () => {
  progressModal.style.display = 'none';
});

// Esc 關閉 modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (confirmModal.style.display === 'flex') hideConfirmModal();
    if (progressModal.style.display === 'flex' && !progressCloseBtn.disabled) {
      progressModal.style.display = 'none';
    }
  }
});

// === Page load: 自動 load 一次 ===
window.addEventListener('DOMContentLoaded', () => {
  console.log('[Backup Admin] Page loaded, cache bust:', CACHE_BUST);
  showBanner('info', '👋 備份還原點管理 Page ready. 撳「載入備份 list」拎所有備份點');
  // 自動 load 一次 (UX 改善,大少唔使額外 click)
  loadBackupList();
});

console.log('[Backup Admin] Script loaded, cache bust:', CACHE_BUST);

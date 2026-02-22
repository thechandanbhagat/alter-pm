// @group BusinessLogic : Dashboard JS — fetches process data and renders the UI

const API = '/api/v1';
let autoRefreshTimer = null;
let activeLogStream = null;
let activeLogProcessId = null;
let activeDetailProcess = null; // { id, name, cwd, status }

// @group BusinessLogic > DatedLogs : State for browsing historical daily log files
let logDates      = [];   // sorted newest-first list of available date strings
let logDateIndex  = -1;   // -1 = today (live), 0..N = index into logDates[]

// @group BusinessLogic > Namespace : Track which namespace groups are collapsed
const collapsedNamespaces = new Set();

// @group BusinessLogic > Init : Page load
window.addEventListener('DOMContentLoaded', () => {
  loadProcesses();
  loadHealth();
  startAutoRefresh();
});

// @group BusinessLogic > Cleanup : Close SSE streams when page hides or unloads
window.addEventListener('beforeunload', () => {
  closeDetailStream();
  if (activeLogStream) { activeLogStream.close(); activeLogStream = null; }
  clearInterval(autoRefreshTimer);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    closeDetailStream();
    if (activeLogStream) { activeLogStream.close(); activeLogStream = null; }
  }
});

// @group BusinessLogic > Data : Fetch and render process list
async function loadProcesses() {
  try {
    const res = await fetch(`${API}/processes`);
    if (!res.ok) return; // don't wipe UI on a bad response
    const data = await res.json();
    const processes = data.processes || [];
    renderTable(processes);
    renderSidebarProcesses(processes);
  } catch (e) {
    // Only update the status badge — never wipe the sidebar/table on a transient error
    document.getElementById('daemon-status').textContent = '●  disconnected';
    document.getElementById('daemon-status').className = 'badge badge-err';
  }
}

// @group BusinessLogic > Data : Fetch daemon health info
async function loadHealth() {
  try {
    const res = await fetch(`${API}/system/health`);
    const data = await res.json();
    document.getElementById('uptime-label').textContent =
      `v${data.version} · up ${formatUptime(data.uptime_secs)}`;
    document.getElementById('daemon-status').textContent = '●  connected';
    document.getElementById('daemon-status').className = 'badge badge-ok';
  } catch {}
}

// @group BusinessLogic > Render : Build the process table rows grouped by namespace
function renderTable(processes) {
  const tbody = document.getElementById('process-tbody');
  if (!processes.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">No processes running.</td></tr>';
    return;
  }

  // Group processes by namespace, preserving insertion order within each group
  const groups = new Map();
  for (const p of processes) {
    const ns = p.namespace || 'default';
    if (!groups.has(ns)) groups.set(ns, []);
    groups.get(ns).push(p);
  }

  // Sort namespaces alphabetically, but keep "default" first
  const sortedNs = [...groups.keys()].sort((a, b) => {
    if (a === 'default') return -1;
    if (b === 'default') return 1;
    return a.localeCompare(b);
  });

  let html = '';
  for (const ns of sortedNs) {
    const procs = groups.get(ns);
    const collapsed = collapsedNamespaces.has(ns);
    const arrow = collapsed ? '▶' : '▼';
    const allRunning = procs.every(p => p.status === 'running');
    const allStopped = procs.every(p => p.status !== 'running');
    html += `
      <tr class="ns-header" onclick="toggleNamespace('${esc(ns)}')">
        <td colspan="9">
          <span class="ns-arrow">${arrow}</span>
          <span class="ns-name">${esc(ns)}</span>
          <span class="ns-count">${procs.length} process${procs.length !== 1 ? 'es' : ''}</span>
          <span class="ns-actions" onclick="event.stopPropagation()">
            ${!allRunning ? `<button class="ns-btn ns-btn-start" onclick="nsStartAll('${esc(ns)}')">▶ Start All</button>` : ''}
            ${!allStopped ? `<button class="ns-btn ns-btn-stop"  onclick="nsStopAll('${esc(ns)}')">■ Stop All</button>` : ''}
          </span>
        </td>
      </tr>`;
    if (!collapsed) {
      for (const p of procs) {
        html += `
    <tr class="ns-proc-row ns-group-${esc(ns).replace(/[^a-z0-9]/gi, '_')}">
      <td><code title="${p.id}">${p.id.slice(0, 8)}</code></td>
      <td><strong>${esc(p.name)}</strong></td>
      <td><span class="status-${p.status}">● ${p.status}</span></td>
      <td>${p.pid ?? '-'}</td>
      <td>${p.uptime_secs != null ? formatUptime(p.uptime_secs) : '-'}</td>
      <td>${p.restart_count}</td>
      <td>${p.watch ? '✓' : '-'}</td>
      <td class="dim" title="${formatLastRun(p)}">${formatLastRun(p)}</td>
      <td>
        ${p.status === 'running'
          ? `<button class="action-btn" onclick="restartProcess('${p.id}')">Restart</button>
        <button class="action-btn" onclick="stopProcess('${p.id}', '${esc(p.name)}')">Stop</button>`
          : `<button class="action-btn" onclick="startProcess2('${p.id}')">Start</button>`}
        <button class="action-btn" onclick="openLogs('${p.id}', '${esc(p.name)}')">Logs</button>
        <button class="action-btn" onclick="openEdit('${p.id}')">Edit</button>
        <button class="action-btn action-btn-danger" onclick="deleteProcess('${p.id}', '${esc(p.name)}')">Delete</button>
      </td>
    </tr>`;
      }
    }
  }
  tbody.innerHTML = html;
}

// @group BusinessLogic > Namespace : Toggle collapse state of a namespace group
function toggleNamespace(ns) {
  if (collapsedNamespaces.has(ns)) {
    collapsedNamespaces.delete(ns);
  } else {
    collapsedNamespaces.add(ns);
  }
  loadProcesses();
}

// @group BusinessLogic > Namespace : Start all stopped processes in a namespace
async function nsStartAll(ns) {
  const res = await fetch(`${API}/processes`);
  const { processes } = await res.json();
  const targets = processes.filter(p => (p.namespace || 'default') === ns && p.status !== 'running');
  await Promise.all(targets.map(p => fetch(`${API}/processes/${p.id}/start`, { method: 'POST' })));
  setTimeout(loadProcesses, 300);
}

// @group BusinessLogic > Namespace : Stop all running processes in a namespace
async function nsStopAll(ns) {
  const res = await fetch(`${API}/processes`);
  const { processes } = await res.json();
  const targets = processes.filter(p => (p.namespace || 'default') === ns && p.status === 'running');
  await Promise.all(targets.map(p => fetch(`${API}/processes/${p.id}/stop`, { method: 'POST' })));
  setTimeout(loadProcesses, 400);
}

// @group BusinessLogic > Render : Build sidebar process list
function renderSidebarProcesses(processes) {
  const container = document.getElementById('sidebar-process-list');
  if (!processes.length) {
    container.innerHTML = '<div class="sidebar-proc-empty">No processes</div>';
    return;
  }
  container.innerHTML = processes.map(p => `
    <button class="sidebar-proc-btn${activeDetailProcess && activeDetailProcess.id === p.id ? ' sidebar-proc-active' : ''}"
            onclick="openProcessDetail('${p.id}', '${esc(p.name)}', '${esc(p.cwd || '')}', '${p.status}')">
      <span class="sidebar-proc-dot status-${p.status}">●</span>
      <span class="sidebar-proc-name">${esc(p.name)}</span>
    </button>
  `).join('');

  // Keep detail view header in sync if it's open
  if (activeDetailProcess) {
    const current = processes.find(p => p.id === activeDetailProcess.id);
    if (current) {
      activeDetailProcess.status = current.status;
      activeDetailProcess.cwd = current.cwd || activeDetailProcess.cwd;
      updateDetailHeader();
    }
  }
}

// @group BusinessLogic > Navigation : Scroll to and highlight a process row in the table
function jumpToProcess(id) {
  showView('processes');
  // Find the row whose first cell title matches the full id
  const rows = document.querySelectorAll('#process-tbody tr');
  for (const row of rows) {
    const code = row.querySelector('code');
    if (code && code.title === id) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.add('row-highlight');
      setTimeout(() => row.classList.remove('row-highlight'), 1500);
      break;
    }
  }
}

// @group BusinessLogic > Actions : Process control buttons
async function stopProcess(id, name) {
  if (!confirm(`Stop '${name}'?`)) return;
  await fetch(`${API}/processes/${id}/stop`, { method: 'POST' });
  setTimeout(loadProcesses, 300);
}

async function restartProcess(id) {
  await fetch(`${API}/processes/${id}/restart`, { method: 'POST' });
  loadProcesses();
}

async function startProcess2(id) {
  await fetch(`${API}/processes/${id}/start`, { method: 'POST' });
  setTimeout(loadProcesses, 300);
}

async function deleteProcess(id, name) {
  if (!confirm(`Delete '${name}'? This will stop and remove the process.`)) return;
  await fetch(`${API}/processes/${id}`, { method: 'DELETE' });
  setTimeout(loadProcesses, 300);
}

async function saveState() {
  await fetch(`${API}/system/save`, { method: 'POST' });
  alert('State saved.');
}

async function shutdownDaemon() {
  if (!confirm('Shutdown the alter daemon? All managed processes will keep running but the daemon will stop.')) return;
  await fetch(`${API}/system/shutdown`, { method: 'POST' }).catch(() => {});
  const statusEl = document.getElementById('daemon-status');
  statusEl.textContent = '●  disconnected';
  statusEl.className = 'badge badge-err';
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
  document.getElementById('auto-refresh').checked = false;
}

// @group BusinessLogic > Navigation : Switch between sidebar views
function showView(name) {
  ['processes', 'start', 'edit', 'process-detail'].forEach(v => {
    document.getElementById(`view-${v}`).style.display = v === name ? 'block' : 'none';
  });
  // Update active nav button (only processes/start have nav buttons)
  document.querySelectorAll('.nav-btn').forEach((btn, i) => {
    const views = ['processes', 'start'];
    btn.classList.toggle('nav-btn-active', views[i] === name);
  });
  if (name === 'start') document.getElementById('sf-script').focus();
  // Close detail stream when leaving process-detail
  if (name !== 'process-detail') {
    closeDetailStream();
    activeDetailProcess = null;
    // Re-render sidebar to clear active highlight
    document.querySelectorAll('.sidebar-proc-btn').forEach(b => b.classList.remove('sidebar-proc-active'));
  }
}

// @group BusinessLogic > Actions : Open edit view pre-filled with process config
async function openEdit(id) {
  try {
    const res = await fetch(`${API}/processes/${id}`);
    const p = await res.json();

    document.getElementById('ef-id').value = p.id;
    document.getElementById('ef-script').value = p.script || '';
    document.getElementById('ef-name').value = p.name || '';
    document.getElementById('ef-cwd').value = p.cwd || '';
    document.getElementById('ef-args').value = (p.args || []).join(' ');
    document.getElementById('ef-max-restarts').value = p.max_restarts ?? 10;
    document.getElementById('ef-namespace').value = p.namespace || 'default';
    document.getElementById('ef-autorestart').checked = !!p.autorestart;
    document.getElementById('ef-watch').checked = !!p.watch;

    // env: serialise object back to KEY=VAL,KEY=VAL
    const env = p.env || {};
    document.getElementById('ef-env').value =
      Object.entries(env).map(([k, v]) => `${k}=${v}`).join(',');

    document.getElementById('edit-form-error').textContent = '';
    showView('edit');
  } catch (e) {
    alert('Failed to load process config.');
  }
}

// @group BusinessLogic > Actions : Submit edited process config via PATCH
async function saveProcessEdit(event) {
  event.preventDefault();
  const errEl = document.getElementById('edit-form-error');
  errEl.textContent = '';

  const id        = document.getElementById('ef-id').value;
  const script    = document.getElementById('ef-script').value.trim();
  const name      = document.getElementById('ef-name').value.trim() || null;
  const cwd       = document.getElementById('ef-cwd').value.trim() || null;
  const namespace = document.getElementById('ef-namespace').value.trim() || 'default';
  const argsRaw   = document.getElementById('ef-args').value.trim();
  const envRaw    = document.getElementById('ef-env').value.trim();
  const maxR      = parseInt(document.getElementById('ef-max-restarts').value, 10) || 10;

  const args = argsRaw ? argsRaw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) : [];

  const env = {};
  if (envRaw) {
    for (const pair of envRaw.split(',')) {
      const idx = pair.indexOf('=');
      if (idx > 0) env[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  }

  const body = {
    script,
    ...(name && { name }),
    ...(cwd  && { cwd }),
    ...(args.length && { args }),
    ...(Object.keys(env).length && { env }),
    namespace,
    autorestart: document.getElementById('ef-autorestart').checked,
    watch: document.getElementById('ef-watch').checked,
    max_restarts: maxR,
  };

  try {
    const res = await fetch(`${API}/processes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      errEl.textContent = data.error || `Error ${res.status}`;
      return;
    }
    showView('processes');
    loadProcesses();
  } catch (e) {
    errEl.textContent = 'Cannot reach daemon.';
  }
}

// @group BusinessLogic > Actions : Submit start-process form
async function startProcess(event) {
  event.preventDefault();
  const errEl = document.getElementById('start-form-error');
  errEl.textContent = '';

  const script    = document.getElementById('sf-script').value.trim();
  const name      = document.getElementById('sf-name').value.trim() || null;
  const cwd       = document.getElementById('sf-cwd').value.trim() || null;
  const namespace = document.getElementById('sf-namespace').value.trim() || 'default';
  const argsRaw   = document.getElementById('sf-args').value.trim();
  const envRaw    = document.getElementById('sf-env').value.trim();

  // Parse space-separated args
  const args = argsRaw ? argsRaw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) : [];

  // Parse KEY=VAL,KEY=VAL env pairs
  const env = {};
  if (envRaw) {
    for (const pair of envRaw.split(',')) {
      const idx = pair.indexOf('=');
      if (idx > 0) env[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  }

  const body = {
    script,
    ...(name && { name }),
    ...(cwd  && { cwd }),
    ...(args.length && { args }),
    ...(Object.keys(env).length && { env }),
    namespace,
    autorestart: document.getElementById('sf-autorestart').checked,
    watch: document.getElementById('sf-watch').checked,
  };

  try {
    const res = await fetch(`${API}/processes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      errEl.textContent = data.error || `Error ${res.status}`;
      return;
    }
    // Success — reset form, go back to processes view
    document.querySelector('.start-form').reset();
    showView('processes');
    loadProcesses();
  } catch (e) {
    errEl.textContent = 'Cannot reach daemon.';
  }
}

// @group BusinessLogic > Logs : Open log panel and stream logs via SSE
async function openLogs(id, name) {
  const section = document.getElementById('log-section');
  const output  = document.getElementById('log-output');
  const title   = document.getElementById('log-title');

  title.textContent = `Logs — ${name}`;
  output.innerHTML  = '';
  section.style.display = 'block';

  // Close any existing stream
  if (activeLogStream) { activeLogStream.close(); activeLogStream = null; }
  activeLogProcessId = id;
  logDateIndex = -1;

  // Fetch available rotated dates and render the date-nav bar
  await loadLogDates(id, 'log-date-nav', 'log-date-label');

  // Load today's last 100 lines + start live SSE
  loadHistoricalLogs(id, null, 'log-output');
  startLiveStream(id, 'log-output');
}

// @group BusinessLogic > DatedLogs : Fetch available log dates and render the nav bar
async function loadLogDates(id, navId, labelId) {
  try {
    const res = await fetch(`${API}/processes/${id}/logs/dates`);
    const data = await res.json();
    logDates = data.dates || [];
  } catch {
    logDates = [];
  }
  renderLogDateNav(navId, labelId, id, 'log-output');
}

// @group BusinessLogic > DatedLogs : Render the ← Today → navigation bar for historical logs
function renderLogDateNav(navId, labelId, id, outputId) {
  const nav = document.getElementById(navId);
  if (!nav) return;
  const isToday = (logDateIndex === -1);
  const label   = isToday ? 'Today (live)' : logDates[logDateIndex];

  nav.innerHTML = `
    <button class="log-nav-btn" onclick="stepLogDate(-1,'${id}','${outputId}')" ${logDateIndex >= logDates.length - 1 ? 'disabled' : ''}>&#8592; Older</button>
    <span class="log-nav-label" id="${labelId}">${label}</span>
    <button class="log-nav-btn" onclick="stepLogDate(1,'${id}','${outputId}')"  ${isToday ? 'disabled' : ''}>Newer &#8594;</button>
  `;
}

// @group BusinessLogic > DatedLogs : Navigate one step older/newer in the rotated log list
function stepLogDate(direction, id, outputId) {
  const newIndex = logDateIndex - direction; // -1=today, 0=logDates[0] (newest dated)
  if (newIndex < -1 || newIndex >= logDates.length) return;
  logDateIndex = newIndex;

  const isToday = (logDateIndex === -1);

  // Stop live stream when browsing history; re-start when back to today
  if (activeLogStream) { activeLogStream.close(); activeLogStream = null; }

  // Re-render nav
  renderLogDateNav('log-date-nav', 'log-date-label', id, outputId);

  // Clear output and load
  document.getElementById(outputId).innerHTML = '';
  const dateParam = isToday ? null : logDates[logDateIndex];
  loadHistoricalLogs(id, dateParam, outputId);
  if (isToday) startLiveStream(id, outputId);
}

// @group BusinessLogic > DatedLogs : Fetch historical (or today's) log lines from the API
function loadHistoricalLogs(id, date, outputId) {
  const qs = date ? `?lines=500&date=${date}` : '?lines=200';
  fetch(`${API}/processes/${id}/logs${qs}`)
    .then(r => r.json())
    .then(data => {
      const output = document.getElementById(outputId);
      if (!output) return;
      (data.lines || []).forEach(entry => appendLineToEl(output, entry.stream, entry.content));
      output.scrollTop = output.scrollHeight;
    })
    .catch(() => {});
}

// @group BusinessLogic > Logs : Start live SSE stream and append lines to outputId
function startLiveStream(id, outputId) {
  if (activeLogStream) { activeLogStream.close(); activeLogStream = null; }
  activeLogStream = new EventSource(`${API}/processes/${id}/logs/stream`);
  activeLogStream.onmessage = (e) => {
    try {
      const line   = JSON.parse(e.data);
      const output = document.getElementById(outputId);
      if (!output) return;
      appendLineToEl(output, line.stream, line.content);
      output.scrollTop = output.scrollHeight;
    } catch {}
  };
  activeLogStream.onerror = () => {
    if (activeLogStream) { activeLogStream.close(); activeLogStream = null; }
  };
}

function appendLogLine(stream, content) {
  appendLineToEl(document.getElementById('log-output'), stream, content);
}

function appendLineToEl(el, stream, content) {
  if (!el) return;
  const div = document.createElement('div');
  div.className = `log-line ${stream === 'stderr' ? 'log-err' : 'log-out'}`;
  div.textContent = content;
  el.appendChild(div);
}

function closeLogs() {
  if (activeLogStream) { activeLogStream.close(); activeLogStream = null; }
  document.getElementById('log-section').style.display = 'none';
  logDates = []; logDateIndex = -1;
}

// @group BusinessLogic > ProcessDetail : Full-screen process detail view with live logs
async function openProcessDetail(id, name, cwd, status) {
  // Close old stream if switching processes
  closeDetailStream();

  activeDetailProcess = { id, name, cwd: cwd || '', status };
  logDateIndex = -1;

  // Switch to detail view
  ['processes', 'start', 'edit', 'process-detail'].forEach(v => {
    document.getElementById(`view-${v}`).style.display = v === 'process-detail' ? 'block' : 'none';
  });
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('nav-btn-active'));
  // Mark active in sidebar
  document.querySelectorAll('.sidebar-proc-btn').forEach(b => {
    const nameEl = b.querySelector('.sidebar-proc-name');
    b.classList.toggle('sidebar-proc-active', nameEl && nameEl.textContent === name);
  });

  updateDetailHeader();

  // Clear and load logs
  document.getElementById('detail-log-output').innerHTML = '';

  // Fetch available dates and render the date nav bar for the detail view
  await loadLogDates(id, 'detail-log-date-nav', 'detail-log-date-label');

  // Override renderLogDateNav so its buttons target the detail output
  renderLogDateNav('detail-log-date-nav', 'detail-log-date-label', id, 'detail-log-output');

  loadHistoricalLogs(id, null, 'detail-log-output');
  startLiveStream(id, 'detail-log-output');
}

function updateDetailHeader() {
  if (!activeDetailProcess) return;
  const { name, status } = activeDetailProcess;
  document.getElementById('detail-proc-name').textContent = name;
  const dot = document.getElementById('detail-proc-dot');
  const stat = document.getElementById('detail-proc-status');
  dot.className = `sidebar-proc-dot status-${status}`;
  stat.textContent = status;
  stat.className = `detail-proc-status status-${status}`;

  const isRunning = status === 'running';
  document.getElementById('detail-btn-restart').style.display = isRunning ? '' : 'none';
  document.getElementById('detail-btn-stop').style.display    = isRunning ? '' : 'none';
  document.getElementById('detail-btn-start').style.display   = isRunning ? 'none' : '';
}

function appendDetailLogLine(stream, content) {
  appendLineToEl(document.getElementById('detail-log-output'), stream, content);
}

function closeDetailStream() {
  if (activeLogStream) { activeLogStream.close(); activeLogStream = null; }
}

// @group BusinessLogic > ProcessDetail : Toolbar action buttons
async function detailStart() {
  if (!activeDetailProcess) return;
  await fetch(`${API}/processes/${activeDetailProcess.id}/start`, { method: 'POST' });
  setTimeout(loadProcesses, 300);
}

async function detailRestart() {
  if (!activeDetailProcess) return;
  await fetch(`${API}/processes/${activeDetailProcess.id}/restart`, { method: 'POST' });
  loadProcesses();
}

async function detailStop() {
  if (!activeDetailProcess) return;
  if (!confirm(`Stop '${activeDetailProcess.name}'?`)) return;
  await fetch(`${API}/processes/${activeDetailProcess.id}/stop`, { method: 'POST' });
  loadProcesses();
}

function detailEdit() {
  if (!activeDetailProcess) return;
  openEdit(activeDetailProcess.id);
}

async function detailDelete() {
  if (!activeDetailProcess) return;
  if (!confirm(`Delete '${activeDetailProcess.name}'? This will stop and remove the process.`)) return;
  await fetch(`${API}/processes/${activeDetailProcess.id}`, { method: 'DELETE' });
  activeDetailProcess = null;
  showView('processes');
  loadProcesses();
}

function detailOpenVSCode() {
  if (!activeDetailProcess) return;
  const cwd = activeDetailProcess.cwd;
  if (!cwd) { alert('No working directory set for this process.'); return; }
  window.open(`vscode://file/${cwd.replace(/\\/g, '/')}`);
}

// @group BusinessLogic > AutoRefresh : Periodic process list refresh
function startAutoRefresh() {
  autoRefreshTimer = setInterval(() => {
    loadProcesses();
    loadHealth();
  }, 3000);
}

function toggleAutoRefresh() {
  const enabled = document.getElementById('auto-refresh').checked;
  if (enabled) startAutoRefresh();
  else { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
}

// @group Utilities : Helpers
function formatUptime(secs) {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs/60)}m ${secs%60}s`;
  if (secs < 86400) return `${Math.floor(secs/3600)}h ${Math.floor((secs%3600)/60)}m`;
  return `${Math.floor(secs/86400)}d ${Math.floor((secs%86400)/3600)}h`;
}

function formatLastRun(p) {
  const ts = p.status === 'running' ? p.started_at : (p.stopped_at ?? p.started_at);
  if (!ts) return '-';
  const d = new Date(ts);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60)  return `${diffSecs}s ago`;
  if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
  if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

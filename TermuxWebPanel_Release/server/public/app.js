// Global App State
let ws = null;
let servers = [];
let selectedServerId = null;
let currentTab = 'console';
let currentPath = '.';
let activeTerminal = null;
let terminalFitAddon = null;
let termBuffers = {};
let chartInstance = null;
let chartLabels = [];
let chartCpuData = [];
let chartRamData = [];

// DOM Elements
const loginContainer = document.getElementById('login-container');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const loginUsername = document.getElementById('username');
const loginPassword = document.getElementById('password');
const loginError = document.getElementById('login-error');

const serverList = document.getElementById('server-list');
const dashboardGrid = document.getElementById('dashboard-grid');
const currentServerTitle = document.getElementById('current-server-title');
const serverStatusBadge = document.getElementById('server-status-badge');
const btnServerConfig = document.getElementById('btn-server-config');
const btnDeleteServer = document.getElementById('btn-delete-server');

const viewDashboard = document.getElementById('view-dashboard');
const viewServer = document.getElementById('view-server');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

const btnAddServer = document.getElementById('btn-add-server');
const btnLogout = document.getElementById('btn-logout');

// Modals
const modalAdd = document.getElementById('modal-add');
const modalConfig = document.getElementById('modal-config');
const modalEditor = document.getElementById('modal-editor');
const modalUsers = document.getElementById('modal-users');
const btnManageUsers = document.getElementById('btn-manage-users');
const btnUpdateAll = document.getElementById('btn-update-all');
const btnCloseUsers = document.getElementById('btn-close-users');
const usersListTbody = document.getElementById('users-list-tbody');
const userDetailForm = document.getElementById('user-detail-form');
const editUsernameInput = document.getElementById('edit-username');
const editPasswordInput = document.getElementById('edit-password');
const editRoleSelect = document.getElementById('edit-role');
const userFormError = document.getElementById('user-form-error');
const userFormTitle = document.getElementById('user-form-title');
const btnCancelEdit = document.getElementById('btn-cancel-edit');
const btnDeleteUser = document.getElementById('btn-delete-user');
const btnSubmitUser = document.getElementById('btn-submit-user');
const labelEditPassword = document.getElementById('label-edit-password');
const permissionsSection = document.getElementById('permissions-section');
const serversPermissionsList = document.getElementById('servers-permissions-list');
const formAddServer = document.getElementById('form-add-server');
const newServerName = document.getElementById('new-server-name');
const credentialsOutput = document.getElementById('credentials-output');
const configJsonOutput = document.getElementById('config-json-output');
const configAgentJson = document.getElementById('config-agent-json');
const btnCloseCredentials = document.getElementById('btn-close-credentials');
const editorTextarea = document.getElementById('editor-textarea');
const editorTitle = document.getElementById('editor-title');
const btnEditorSave = document.getElementById('btn-editor-save');
const btnEditorCancel = document.getElementById('btn-editor-cancel');
const btnCloseEditor = document.getElementById('btn-close-editor');

// File Explorer Elements
const fileBreadcrumbs = document.getElementById('file-breadcrumbs');
const filesList = document.getElementById('files-list');
const btnNewFile = document.getElementById('btn-new-file');
const btnNewFolder = document.getElementById('btn-new-folder');
const btnUploadFile = document.getElementById('btn-upload-file');
const fileUploader = document.getElementById('file-uploader');

// Metrics DOM
const mCpuVal = document.getElementById('metrics-cpu-val');
const mCpuProgress = document.getElementById('metrics-cpu-progress');
const mRamVal = document.getElementById('metrics-ram-val');
const mRamProgress = document.getElementById('metrics-ram-progress');
const mDiskVal = document.getElementById('metrics-disk-val');
const mDiskProgress = document.getElementById('metrics-disk-progress');
const mInfoIp = document.getElementById('info-ip');
const mInfoBattery = document.getElementById('info-battery');
const mInfoUptime = document.getElementById('info-uptime');
const mInfoVersion = document.getElementById('info-version');

// Mobile Sidebar Toggle elements
const btnHamburger = document.getElementById('btn-hamburger');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const sidebar = document.querySelector('.sidebar');

function closeSidebar() {
  if (sidebar && sidebarOverlay) {
    sidebar.classList.remove('sidebar-open');
    sidebarOverlay.classList.add('hidden');
  }
}

if (btnHamburger && sidebarOverlay && sidebar) {
  btnHamburger.addEventListener('click', () => {
    sidebar.classList.add('sidebar-open');
    sidebarOverlay.classList.remove('hidden');
  });

  sidebarOverlay.addEventListener('click', () => {
    closeSidebar();
  });
}

// API Fetch Helper with Authorization
async function apiFetch(url, options = {}) {
  const token = localStorage.getItem('token');
  options.headers = options.headers || {};
  if (token) {
    options.headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(url, options);
  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    localStorage.removeItem('role');
    location.reload();
    throw new Error('Unauthorized');
  }
  return res;
}

// Check Login Session
const sessionToken = localStorage.getItem('token');
if (sessionToken) {
  showApp();
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = loginUsername.value;
  const password = loginPassword.value;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.success) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('username', data.username);
      localStorage.setItem('role', data.role);
      loginPassword.value = '';
      showApp();
    } else {
      showLoginError(data.message || 'Usuario o contraseña incorrectos');
    }
  } catch (err) {
    showLoginError('Error al conectar con el servidor');
  }
});

btnLogout.addEventListener('click', () => {
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  localStorage.removeItem('role');
  location.reload();
});

function showLoginError(msg) {
  loginError.textContent = msg;
  loginError.classList.remove('hidden');
}

function showApp() {
  loginContainer.classList.add('hidden');
  appContainer.classList.remove('hidden');
  applyRoleRestrictions();
  initWebSocket();
  loadServers();
}

function applyRoleRestrictions() {
  const role = localStorage.getItem('role');
  const isAdmin = role === 'admin';
  
  if (btnManageUsers) {
    if (isAdmin) btnManageUsers.classList.remove('hidden');
    else btnManageUsers.classList.add('hidden');
  }
  if (btnUpdateAll) {
    if (isAdmin) btnUpdateAll.classList.remove('hidden');
    else btnUpdateAll.classList.add('hidden');
  }

  if (role === 'viewer') {
    if (btnAddServer) btnAddServer.classList.add('hidden');
    if (btnDeleteServer) btnDeleteServer.classList.add('hidden');
    
    const fileActions = document.querySelector('.file-actions');
    if (fileActions) fileActions.classList.add('hidden');
    
    // Add CSS rule to hide action buttons in table dynamically
    let style = document.getElementById('role-viewer-styles');
    if (!style) {
      style = document.createElement('style');
      style.id = 'role-viewer-styles';
      style.innerHTML = `
        .actions-col, .actions-cell { display: none !important; }
        .file-actions { display: none !important; }
      `;
      document.head.appendChild(style);
    }
  } else {
    const style = document.getElementById('role-viewer-styles');
    if (style) style.remove();
    
    if (btnAddServer) btnAddServer.classList.remove('hidden');
  }
}

// WebSocket Setup
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = localStorage.getItem('token');
  const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token || '')}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('WebSocket connection established');
    if (selectedServerId) {
      subscribeToAgent(selectedServerId);
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === 'status') {
        updateServerOnlineStatus(msg.agentId, msg.online);
      }

      else if (msg.type === 'stats') {
        updateServerStats(msg.agentId, msg.stats);
      }

      else if (msg.type === 'term_data') {
        if (selectedServerId === msg.agentId && activeTerminal) {
          activeTerminal.write(msg.data);
        }
        if (!termBuffers[msg.agentId]) termBuffers[msg.agentId] = [];
        termBuffers[msg.agentId].push(msg.data);
        if (termBuffers[msg.agentId].length > 200) {
          termBuffers[msg.agentId].splice(0, termBuffers[msg.agentId].length - 200);
        }
      }

      else if (msg.type === 'file_op_res') {
        handleFileOpResult(msg);
      }

      else if (msg.type === 'server_deleted') {
        if (selectedServerId === msg.id) {
          showDashboardView();
        }
        loadServers();
      }

      else if (msg.type === 'server_updated') {
        const idx = servers.findIndex(s => s.id === msg.server.id);
        if (idx !== -1) servers[idx] = msg.server;
        if (selectedServerId === msg.server.id) {
          renderQuickButtons(selectedServerId);
        }
      }

    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  };

  ws.onclose = () => {
    console.log('WebSocket connection closed, reconnecting...');
    setTimeout(initWebSocket, 2000);
  };
}

// Load Servers REST
async function loadServers() {
  try {
    const res = await apiFetch('/api/servers');
    servers = await res.json();
    renderServerList();
    renderDashboardGrid();
    if (selectedServerId) {
      const srv = servers.find(s => s.id === selectedServerId);
      if (srv) {
        applyActiveServerPermissions(srv);
      }
    }
  } catch (err) {
    console.error('Error loading servers:', err);
  }
}

// Sidebar Render
function renderServerList() {
  serverList.innerHTML = '';
  
  // Dashboard item
  const dashBtn = document.createElement('button');
  dashBtn.className = `server-item ${!selectedServerId ? 'active' : ''}`;
  dashBtn.innerHTML = `<i class="fa-solid fa-gauge"></i> <span>Dashboard General</span>`;
  dashBtn.onclick = () => showDashboardView();
  serverList.appendChild(dashBtn);

  // Individual Server items
  servers.forEach(srv => {
    const btn = document.createElement('button');
    btn.className = `server-item ${srv.online ? 'online' : 'offline'} ${selectedServerId === srv.id ? 'active' : ''}`;
    btn.innerHTML = `<span class="status-dot"></span> <span>${srv.name}</span>`;
    btn.onclick = () => selectServer(srv.id);
    serverList.appendChild(btn);
  });
}

// Dashboard Grid Render
function renderDashboardGrid() {
  dashboardGrid.innerHTML = '';
  if (servers.length === 0) {
    dashboardGrid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
        <i class="fa-solid fa-server" style="font-size: 3rem; margin-bottom: 15px; display: block;"></i>
        <p>No tienes ningún servidor registrado.</p>
        <p style="font-size: 0.85rem; margin-top: 5px;">Presiona "Nuevo Servidor" en el menú inferior para agregar uno.</p>
      </div>
    `;
    return;
  }

  servers.forEach(srv => {
    const card = document.createElement('div');
    card.className = `server-card`;
    
    const cpuVal = srv.stats?.cpu !== undefined ? `${srv.stats.cpu}%` : '-';
    const ramVal = srv.stats ? `${formatBytes(srv.stats.ram_used)} / ${formatBytes(srv.stats.ram_total)}` : '-';
    const diskVal = srv.stats ? `${formatBytes(srv.stats.disk_used)} / ${formatBytes(srv.stats.disk_total)}` : '-';
    
    card.innerHTML = `
      <div class="card-header">
        <span class="card-title">${srv.name}</span>
        <span class="status-badge ${srv.online ? 'online' : 'offline'}">
          <span class="status-dot"></span> ${srv.online ? 'Online' : 'Offline'}
        </span>
      </div>
      <div class="card-meta">
        <div>ID: <code>${srv.id}</code></div>
        <div>Agregado: ${new Date(srv.addedAt).toLocaleDateString()}</div>
      </div>
      <div class="card-stats">
        <div class="card-stat-item">
          <span>CPU</span>
          <strong>${cpuVal}</strong>
        </div>
        <div class="card-stat-item">
          <span>RAM</span>
          <strong>${ramVal}</strong>
        </div>
        <div class="card-stat-item" style="grid-column: span 2; margin-top: 5px;">
          <span>Almacenamiento</span>
          <strong>${diskVal}</strong>
        </div>
      </div>
    `;
    
    card.onclick = () => selectServer(srv.id);
    dashboardGrid.appendChild(card);
  });
}

function showDashboardView() {
  selectedServerId = null;
  currentServerTitle.textContent = "Dashboard General";
  serverStatusBadge.classList.add('hidden');
  btnServerConfig.classList.add('hidden');
  btnDeleteServer.classList.add('hidden');
  if (typeof btnQuickButtons !== 'undefined' && btnQuickButtons) btnQuickButtons.classList.add('hidden');
  if (typeof quickButtonsContainer !== 'undefined' && quickButtonsContainer) quickButtonsContainer.innerHTML = '';
  
  viewServer.classList.add('hidden');
  viewDashboard.classList.remove('hidden');
  
  renderServerList();
  closeSidebar();
}

function applyActiveServerPermissions(srv) {
  const userPerms = srv.userPermissions || [];
  const isConsoleAllowed = userPerms.includes('control:console');
  const isFilesAllowed = userPerms.includes('file:read');
  const isWriteAllowed = userPerms.includes('file:write');
  const isDeleteAllowed = userPerms.includes('file:delete');

  // 1. Tab buttons visibility
  const consoleTabBtn = document.querySelector('.tab-btn[data-tab="console"]');
  const filesTabBtn = document.querySelector('.tab-btn[data-tab="files"]');
  
  if (consoleTabBtn) {
    if (isConsoleAllowed) {
      consoleTabBtn.classList.remove('hidden');
    } else {
      consoleTabBtn.classList.add('hidden');
    }
  }
  
  if (filesTabBtn) {
    if (isFilesAllowed) {
      filesTabBtn.classList.remove('hidden');
    } else {
      filesTabBtn.classList.add('hidden');
    }
  }

  // 2. If the active tab is hidden, switch to the first visible tab
  if (currentTab === 'console' && !isConsoleAllowed) {
    if (isFilesAllowed) {
      switchTab('files');
    } else {
      switchTab('metrics');
    }
  } else if (currentTab === 'files' && !isFilesAllowed) {
    if (isConsoleAllowed) {
      switchTab('console');
    } else {
      switchTab('metrics');
    }
  }

  // 3. File actions controls
  const btnNewFile = document.getElementById('btn-new-file');
  const btnNewFolder = document.getElementById('btn-new-folder');
  const btnUploadFile = document.getElementById('btn-upload-file');
  
  if (btnNewFile) btnNewFile.style.display = isWriteAllowed ? '' : 'none';
  if (btnNewFolder) btnNewFolder.style.display = isWriteAllowed ? '' : 'none';
  if (btnUploadFile) btnUploadFile.style.display = isWriteAllowed ? '' : 'none';

  // Save button in file editor
  const btnEditorSave = document.getElementById('btn-editor-save');
  if (btnEditorSave) btnEditorSave.style.display = isWriteAllowed ? '' : 'none';

  // Trash/delete actions column and buttons in table
  let styleEl = document.getElementById('permissions-delete-styles');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'permissions-delete-styles';
    document.head.appendChild(styleEl);
  }
  
  if (!isDeleteAllowed) {
    styleEl.innerHTML = `
      .btn-icon-danger { display: none !important; }
    `;
  } else {
    styleEl.innerHTML = ``;
  }
}

function selectServer(serverId) {
  selectedServerId = serverId;
  const srv = servers.find(s => s.id === serverId);
  if (!srv) return;

  currentServerTitle.textContent = srv.name;
  serverStatusBadge.classList.remove('hidden');
  
  // Hide delete button for non-admins
  const role = localStorage.getItem('role');
  if (role === 'admin') {
    btnServerConfig.classList.remove('hidden');
    btnDeleteServer.classList.remove('hidden');
    if (typeof btnQuickButtons !== 'undefined' && btnQuickButtons) btnQuickButtons.classList.remove('hidden');
  } else {
    btnServerConfig.classList.add('hidden');
    btnDeleteServer.classList.add('hidden');
    if (typeof btnQuickButtons !== 'undefined' && btnQuickButtons) btnQuickButtons.classList.add('hidden');
  }
  
  updateServerOnlineStatus(srv.id, srv.online);

  viewDashboard.classList.add('hidden');
  viewServer.classList.remove('hidden');

  renderServerList();
  subscribeToAgent(serverId);
  
  // Apply per-server permissions
  applyActiveServerPermissions(srv);
  
  // Switch to default permitted tab
  const userPerms = srv.userPermissions || [];
  if (userPerms.includes('control:console')) {
    switchTab('console');
  } else if (userPerms.includes('file:read')) {
    switchTab('files');
  } else {
    switchTab('metrics');
  }
  
  if (typeof renderQuickButtons === 'function') {
    renderQuickButtons(serverId);
  }
  
  closeSidebar();
}

function subscribeToAgent(agentId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'subscribe', agentId }));
  }
}

function updateServerOnlineStatus(agentId, online) {
  // Update in array
  const srv = servers.find(s => s.id === agentId);
  if (srv) srv.online = online;

  // Refresh current server view if selected
  if (selectedServerId === agentId) {
    serverStatusBadge.className = `status-badge ${online ? 'online' : 'offline'}`;
    const textNode = serverStatusBadge.querySelector('.status-text');
    if (textNode) textNode.textContent = online ? 'Online' : 'Offline';

    if (online) {
      // Re-enable console PTY init
      if (currentTab === 'console') {
        initTerminal();
      } else if (currentTab === 'files') {
        loadDirectory(currentPath);
      }
    } else {
      if (activeTerminal) {
        activeTerminal.write('\r\n\x1b[31m[Agente desconectado de la red local]\x1b[0m\r\n');
      }
      clearStatsView();
    }
  }

  // Refresh items in sidebar and grid
  const sidebarBtn = Array.from(serverList.querySelectorAll('.server-item'))
    .find(btn => btn.querySelector('span')?.textContent === srv?.name);
  if (sidebarBtn) {
    sidebarBtn.className = `server-item ${online ? 'online' : 'offline'} ${selectedServerId === agentId ? 'active' : ''}`;
  }

  // Update general cards if visible
  if (!selectedServerId) {
    renderDashboardGrid();
  }
}

// Live Resource Metrics Parsing
function updateServerStats(agentId, stats) {
  const srv = servers.find(s => s.id === agentId);
  if (srv) srv.stats = stats;

  if (selectedServerId === agentId) {
    // 1. CPU
    mCpuVal.textContent = `${stats.cpu}%`;
    mCpuProgress.style.width = `${stats.cpu}%`;

    // 2. RAM
    const ramPct = ((stats.ram_used / stats.ram_total) * 100).toFixed(0);
    mRamVal.textContent = `${formatBytes(stats.ram_used)} / ${formatBytes(stats.ram_total)} (${ramPct}%)`;
    mRamProgress.style.width = `${ramPct}%`;

    // 3. Disk
    const diskPct = ((stats.disk_used / stats.disk_total) * 100).toFixed(0);
    mDiskVal.textContent = `${formatBytes(stats.disk_used)} / ${formatBytes(stats.disk_total)} (${diskPct}%)`;
    mDiskProgress.style.width = `${diskPct}%`;

    // 4. Other stats
    mInfoIp.textContent = activeAgentsIP(agentId) || '-';
    mInfoBattery.textContent = stats.battery !== null ? `${stats.battery}%` : 'N/A';
    mInfoUptime.textContent = formatUptime(stats.uptime);
    mInfoVersion.textContent = stats.version || 'N/A';

    // Update real-time Chart
    if (currentTab === 'metrics' && chartInstance) {
      const now = new Date().toLocaleTimeString();
      chartLabels.push(now);
      chartCpuData.push(stats.cpu);
      chartRamData.push(ramPct);

      if (chartLabels.length > 20) {
        chartLabels.shift();
        chartCpuData.shift();
        chartRamData.shift();
      }

      chartInstance.update();
    }
  }

  if (!selectedServerId) {
    renderDashboardGrid();
  }
}

function activeAgentsIP(agentId) {
  // Try to find if IP info is available
  const srvObj = servers.find(s => s.id === agentId);
  return srvObj?.stats?.ip || '192.168.x.x'; // Fallback
}

function clearStatsView() {
  mCpuVal.textContent = '0%';
  mCpuProgress.style.width = '0%';
  mRamVal.textContent = '0 MB / 0 MB';
  mRamProgress.style.width = '0%';
  mDiskVal.textContent = '0 GB / 0 GB';
  mDiskProgress.style.width = '0%';
  mInfoIp.textContent = '-';
  mInfoBattery.textContent = '-';
  mInfoUptime.textContent = '-';
  mInfoVersion.textContent = '-';
  
  if (chartInstance) {
    chartLabels = [];
    chartCpuData = [];
    chartRamData = [];
    chartInstance.data.labels = chartLabels;
    chartInstance.data.datasets[0].data = chartCpuData;
    chartInstance.data.datasets[1].data = chartRamData;
    chartInstance.update();
  }
}

// TABS SWITCHING
tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    tabButtons.forEach(b => b.classList.remove('active'));
    tabPanes.forEach(p => p.classList.remove('active'));

    btn.classList.add('active');
    const tabName = btn.getAttribute('data-tab');
    document.getElementById(`tab-${tabName}`).classList.add('active');
    currentTab = tabName;

    if (tabName === 'console') {
      initTerminal();
    } else if (tabName === 'files') {
      loadDirectory(currentPath);
    } else if (tabName === 'metrics') {
      initChart();
    }
  });
});

function switchTab(tabName) {
  tabButtons.forEach(btn => {
    if (btn.getAttribute('data-tab') === tabName) {
      btn.click();
    }
  });
}

// TERMINAL CONSOLE LOGIC
function initTerminal() {
  const container = document.getElementById('terminal-container');
  
  // Clean previous terminal
  container.innerHTML = '';
  activeTerminal = null;

  const srv = servers.find(s => s.id === selectedServerId);
  if (!srv || !srv.online) {
    container.innerHTML = `<div style="padding: 20px; color: var(--accent-rose); text-align: center;">El servidor está desconectado. Ejecuta el agente en tu Termux para abrir la consola.</div>`;
    return;
  }

  const role = localStorage.getItem('role');
  const isReadOnly = role === 'viewer';

  // Instantiate xterm
  activeTerminal = new Terminal({
    cursorBlink: !isReadOnly,
    disableStdin: isReadOnly,
    fontSize: 14,
    fontFamily: 'Fira Code, monospace',
    theme: {
      background: '#000000',
      foreground: '#a7f3d0', // mint green
      cursor: isReadOnly ? 'transparent' : '#06b6d4',
      black: '#000000',
      red: '#ef4444',
      green: '#22c55e',
      yellow: '#eab308',
      blue: '#3b82f6',
      magenta: '#a855f7',
      cyan: '#06b6d4',
      white: '#f8fafc'
    }
  });

  terminalFitAddon = new FitAddon.FitAddon();
  activeTerminal.loadAddon(terminalFitAddon);
  activeTerminal.open(container);

  // Replay buffered terminal output for this agent
  const buf = termBuffers[selectedServerId];
  if (buf && buf.length > 0) {
    activeTerminal.write(buf.join(''));
  }

  // Fit size
  setTimeout(() => {
    try {
      terminalFitAddon.fit();
      const dims = { cols: activeTerminal.cols, rows: activeTerminal.rows };
      // Send size init to backend
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'term_resize', agentId: selectedServerId, cols: dims.cols, rows: dims.rows }));
      }
    } catch (err) {
      console.warn("Failed to fit terminal layout:", err);
    }
  }, 100);

  // Resize listener
  window.addEventListener('resize', fitTerminalSize);

  // Input listener
  activeTerminal.onData(data => {
    if (isReadOnly) return;
    if (pendingMod === 'ctrl' && /^[a-zA-Z]$/.test(data)) {
      data = String.fromCharCode(data.toLowerCase().charCodeAt(0) - 96);
      pendingMod = null;
      document.querySelectorAll('.mod-btn.active').forEach(b => b.classList.remove('active'));
    } else if (pendingMod === 'alt' && data.length === 1) {
      data = '\x1b' + data;
      pendingMod = null;
      document.querySelectorAll('.mod-btn.active').forEach(b => b.classList.remove('active'));
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'term_data', agentId: selectedServerId, data }));
    }
  });
}

function fitTerminalSize() {
  if (activeTerminal && terminalFitAddon && currentTab === 'console') {
    try {
      terminalFitAddon.fit();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'term_resize',
          agentId: selectedServerId,
          cols: activeTerminal.cols,
          rows: activeTerminal.rows
        }));
      }
    } catch (err) {}
  }
}

// REALTIME CHART
function initChart() {
  const canvas = document.getElementById('resource-chart');
  if (!canvas) return;

  if (chartInstance) {
    chartInstance.destroy();
  }

  // Clear older arrays
  chartLabels = [];
  chartCpuData = [];
  chartRamData = [];

  const ctx = canvas.getContext('2d');
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartLabels,
      datasets: [
        {
          label: 'CPU (%)',
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6, 182, 212, 0.05)',
          data: chartCpuData,
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 2
        },
        {
          label: 'RAM (%)',
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139, 92, 246, 0.05)',
          data: chartRamData,
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          min: 0,
          max: 100,
          grid: { color: 'rgba(255, 255, 255, 0.04)' },
          ticks: { color: '#64748b', font: { family: 'Outfit' } }
        },
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.04)' },
          ticks: { color: '#64748b', font: { family: 'Outfit' } }
        }
      },
      plugins: {
        legend: {
          labels: { color: '#f1f5f9', font: { family: 'Outfit', size: 12 } }
        }
      }
    }
  });
}

// FILE EXPLORER LOGIC
let fileCallbacks = {}; // Map of reqId -> callback

function sendFileOp(op, path, extra = {}) {
  return new Promise((resolve, reject) => {
    const reqId = 'req_' + Math.random().toString(36).substr(2, 9);
    fileCallbacks[reqId] = { resolve, reject };
    
    // Set a timeout to clear hanging operations
    setTimeout(() => {
      if (fileCallbacks[reqId]) {
        fileCallbacks[reqId].reject(new Error('Operation timeout'));
        delete fileCallbacks[reqId];
      }
    }, 15000);

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'file_op',
        agentId: selectedServerId,
        op,
        path,
        reqId,
        ...extra
      }));
    } else {
      reject(new Error('WebSocket is not connected'));
    }
  });
}

function handleFileOpResult(msg) {
  const cb = fileCallbacks[msg.reqId];
  if (cb) {
    if (msg.success) {
      cb.resolve(msg);
    } else {
      cb.reject(new Error(msg.error || 'Unknown file error'));
    }
    delete fileCallbacks[msg.reqId];
  }
}

async function loadDirectory(path) {
  currentPath = path;
  renderBreadcrumbs(path);
  
  filesList.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 20px; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Cargando archivos...</td></tr>`;

  try {
    const res = await sendFileOp('list', path);
    renderFilesTable(res.files);
  } catch (err) {
    filesList.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 20px; color: var(--accent-rose);"><i class="fa-solid fa-circle-exclamation"></i> Error al cargar directorio: ${err.message}</td></tr>`;
  }
}

function renderBreadcrumbs(path) {
  fileBreadcrumbs.innerHTML = '';
  
  // Home Root Button
  const homeBtn = document.createElement('a');
  homeBtn.href = '#';
  homeBtn.innerHTML = '<i class="fa-solid fa-house"></i> Termux Home';
  homeBtn.onclick = (e) => {
    e.preventDefault();
    loadDirectory('.');
  };
  fileBreadcrumbs.appendChild(homeBtn);

  if (path === '.' || path === './' || path === '') return;

  const parts = path.split('/').filter(p => p && p !== '.');
  let accumulatedPath = '.';

  parts.forEach((part, index) => {
    const sep = document.createElement('span');
    sep.innerHTML = ' <i class="fa-solid fa-chevron-right" style="font-size: 0.7rem;"></i> ';
    fileBreadcrumbs.appendChild(sep);

    accumulatedPath += '/' + part;
    const finalPath = accumulatedPath; // bind closure scope

    const link = document.createElement('a');
    link.href = '#';
    link.textContent = part;
    link.onclick = (e) => {
      e.preventDefault();
      loadDirectory(finalPath);
    };
    fileBreadcrumbs.appendChild(link);
  });
}

function renderFilesTable(files) {
  filesList.innerHTML = '';
  
  if (files.length === 0) {
    filesList.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 30px; color: var(--text-muted);">Directorio vacío.</td></tr>`;
    return;
  }

  // Sort: folders first, then files alphabetically
  files.sort((a, b) => {
    if (a.is_dir && !b.is_dir) return -1;
    if (!a.is_dir && b.is_dir) return 1;
    return a.name.localeCompare(b.name);
  });

  files.forEach(file => {
    const tr = document.createElement('tr');
    
    // Icon & Name cell
    const nameTd = document.createElement('td');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-item-name';
    nameSpan.innerHTML = file.is_dir 
      ? `<i class="fa-solid fa-folder"></i> ${file.name}` 
      : `<i class="fa-solid fa-file"></i> ${file.name}`;
    
    if (file.is_dir) {
      nameSpan.onclick = () => loadDirectory(`${currentPath}/${file.name}`);
    } else {
      nameSpan.onclick = () => openFileInEditor(`${currentPath}/${file.name}`);
    }
    nameTd.appendChild(nameSpan);
    tr.appendChild(nameTd);

    // Size Cell
    const sizeTd = document.createElement('td');
    sizeTd.textContent = file.is_dir ? '-' : formatBytes(file.size);
    tr.appendChild(sizeTd);

    // Modified Cell
    const modTd = document.createElement('td');
    modTd.textContent = formatModTime(file.mtime);
    tr.appendChild(modTd);

    // Actions Cell
    const actTd = document.createElement('td');
    actTd.className = 'actions-col';
    
    let actionsHtml = '';
    if (!file.is_dir) {
      actionsHtml += `
        <button class="btn-icon" title="Descargar" onclick="downloadFile('${currentPath}/${file.name}')">
          <i class="fa-solid fa-download"></i>
        </button>
        <button class="btn-icon" title="Editar" onclick="openFileInEditor('${currentPath}/${file.name}')">
          <i class="fa-solid fa-edit"></i>
        </button>
      `;
    }
    actionsHtml += `
      <button class="btn-icon btn-icon-danger" title="Eliminar" onclick="deleteFileOrFolder('${currentPath}/${file.name}', ${file.is_dir})">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    `;
    
    actTd.innerHTML = `<div class="file-row-actions">${actionsHtml}</div>`;
    tr.appendChild(actTd);

    filesList.appendChild(tr);
  });
}

// Download File in Browser
async function downloadFile(path) {
  try {
    const token = localStorage.getItem('token') || '';
    // Open in a new tab to trigger native browser download
    const downloadUrl = `/api/servers/${selectedServerId}/download?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`;
    window.open(downloadUrl, '_blank');
  } catch (err) {
    alert('Error al iniciar la descarga: ' + err.message);
  }
}

// Edit File Modal flow
let editorCurrentFilePath = null;
async function openFileInEditor(path) {
  editorCurrentFilePath = path;
  editorTitle.textContent = `Editar: ${path.split('/').pop()}`;
  editorTextarea.value = 'Cargando contenido...';
  modalEditor.classList.remove('hidden');

  try {
    const res = await sendFileOp('read_text', path);
    editorTextarea.value = res.content;
  } catch (err) {
    editorTextarea.value = `Error al leer archivo: ${err.message}`;
  }
}

btnEditorSave.onclick = async () => {
  if (!editorCurrentFilePath) return;
  const content = editorTextarea.value;
  btnEditorSave.disabled = true;
  btnEditorSave.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Guardando...`;

  try {
    await sendFileOp('write_text', editorCurrentFilePath, { content });
    modalEditor.classList.add('hidden');
    loadDirectory(currentPath);
  } catch (err) {
    alert('Error al guardar el archivo: ' + err.message);
  } finally {
    btnEditorSave.disabled = false;
    btnEditorSave.innerHTML = `<i class="fa-solid fa-save"></i> Guardar Cambios`;
  }
};

btnEditorCancel.onclick = btnCloseEditor.onclick = () => {
  modalEditor.classList.add('hidden');
  editorCurrentFilePath = null;
};

// Create Folder
btnNewFolder.onclick = async () => {
  const name = prompt('Nombre de la nueva carpeta:');
  if (!name) return;
  try {
    await sendFileOp('mkdir', `${currentPath}/${name}`);
    loadDirectory(currentPath);
  } catch (err) {
    alert('Error al crear carpeta: ' + err.message);
  }
};

// Create File
btnNewFile.onclick = async () => {
  const name = prompt('Nombre del nuevo archivo (ej. script.sh):');
  if (!name) return;
  try {
    await sendFileOp('write_text', `${currentPath}/${name}`, { content: '' });
    loadDirectory(currentPath);
    // Open in editor immediately
    openFileInEditor(`${currentPath}/${name}`);
  } catch (err) {
    alert('Error al crear archivo: ' + err.message);
  }
};

// Delete File / Folder
async function deleteFileOrFolder(path, isDir) {
  const confirmMsg = `¿Estás seguro de que deseas eliminar ${isDir ? 'la carpeta' : 'el archivo'} "${path.split('/').pop()}"?`;
  if (!confirm(confirmMsg)) return;

  try {
    await sendFileOp('delete', path);
    loadDirectory(currentPath);
  } catch (err) {
    alert('Error al eliminar: ' + err.message);
  }
}

// Upload File (chunked transfer)
btnUploadFile.onclick = () => fileUploader.click();

fileUploader.onchange = async () => {
  if (fileUploader.files.length === 0) return;
  const file = fileUploader.files[0];
  const targetPath = `${currentPath}/${file.name}`;
  
  const originalLabel = btnUploadFile.innerHTML;
  btnUploadFile.disabled = true;
  btnUploadFile.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Subiendo 0%`;

  const token = localStorage.getItem('token') || '';
  
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `/api/servers/${selectedServerId}/upload?path=${encodeURIComponent(targetPath)}`);
  xhr.setRequestHeader('Authorization', `Bearer ${token}`);
  
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const progress = ((e.loaded / e.total) * 100).toFixed(0);
      btnUploadFile.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Subiendo ${progress}%`;
    }
  };
  
  xhr.onload = () => {
    if (xhr.status === 200) {
      loadDirectory(currentPath);
    } else {
      let errMsg = 'Desconocido';
      try {
        const resObj = JSON.parse(xhr.responseText);
        errMsg = resObj.error || errMsg;
      } catch(e) {}
      alert('Error al subir archivo: ' + errMsg);
    }
    btnUploadFile.disabled = false;
    btnUploadFile.innerHTML = originalLabel;
    fileUploader.value = '';
  };
  
  xhr.onerror = () => {
    alert('Error de red al subir archivo');
    btnUploadFile.disabled = false;
    btnUploadFile.innerHTML = originalLabel;
    fileUploader.value = '';
  };
  
  xhr.send(file);
};

// ADD NEW SERVER FLOW
btnAddServer.onclick = () => {
  newServerName.value = '';
  credentialsOutput.classList.add('hidden');
  formAddServer.classList.remove('hidden');
  modalAdd.classList.remove('hidden');
};

formAddServer.onsubmit = async (e) => {
  e.preventDefault();
  const name = newServerName.value;
  
  try {
    const res = await apiFetch('/api/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (data.success) {
      const host = window.location.hostname;
      const tcpPort = 3001; // DefaultTCP Port
      
      const configJson = {
        server_host: host,
        server_port: tcpPort,
        agent_id: data.server.id,
        auth_token: data.server.token
      };

      configJsonOutput.textContent = JSON.stringify(configJson, null, 2);
      
      // Update download instructions dynamically
      const hostSpan = modalAdd.querySelector('.server-host-placeholder');
      if (hostSpan) hostSpan.textContent = window.location.host;

      formAddServer.classList.add('hidden');
      credentialsOutput.classList.remove('hidden');
      loadServers();
    }
  } catch (err) {
    alert('Error al registrar el servidor en el panel.');
  }
};

btnCloseCredentials.onclick = () => {
  modalAdd.classList.add('hidden');
};

// SERVER CONFIG MODAL FLOW
btnServerConfig.onclick = () => {
  const srv = servers.find(s => s.id === selectedServerId);
  if (!srv) return;

  const configJson = {
    server_host: window.location.hostname,
    server_port: 3001,
    agent_id: srv.id,
    auth_token: srv.token
  };

  configAgentJson.textContent = JSON.stringify(configJson, null, 2);
  modalConfig.classList.remove('hidden');
};

// DELETE SERVER FLOW
btnDeleteServer.onclick = async () => {
  const srv = servers.find(s => s.id === selectedServerId);
  if (!srv) return;

  const confirmMsg = `¿Estás seguro de que deseas eliminar permanentemente el servidor "${srv.name}"? Se revocará el acceso y se desconectará el celular de inmediato.`;
  if (!confirm(confirmMsg)) return;

  try {
    const res = await apiFetch(`/api/servers/${srv.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showDashboardView();
      loadServers();
    }
  } catch (err) {
    alert('Error al eliminar servidor');
  }
};

// Close all modal buttons
document.querySelectorAll('.btn-close-modal, .btn-close-modal-btn').forEach(btn => {
  btn.onclick = () => {
    modalAdd.classList.add('hidden');
    modalConfig.classList.add('hidden');
    modalEditor.classList.add('hidden');
    modalUsers.classList.add('hidden');
  };
});

// UTILITY FUNCTIONS
function formatBytes(bytes, decimals = 2) {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatModTime(timestamp) {
  if (!timestamp) return '-';
  const d = new Date(timestamp * 1000);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function formatUptime(seconds) {
  if (!seconds) return '-';
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  
  let parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

// ==========================================
// USER MANAGEMENT MODAL LOGIC
// ==========================================
let selectedEditUsername = null;
let currentUsersListData = [];

if (btnManageUsers) {
  btnManageUsers.onclick = () => {
    modalUsers.classList.remove('hidden');
    loadUsersList();
    resetUserForm();
  };
}

if (btnUpdateAll) {
  btnUpdateAll.onclick = async () => {
    if (!confirm('¿Estás seguro de que deseas forzar la actualización de todos los agentes conectados? Se descargará el último script y se reiniciarán.')) return;
    
    const originalText = btnUpdateAll.innerHTML;
    btnUpdateAll.disabled = true;
    btnUpdateAll.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Actualizando...`;
    
    try {
      const res = await apiFetch('/api/servers/update-all', { method: 'POST' });
      alert(`Orden de actualización enviada con éxito a ${res.updatedCount} agentes.`);
    } catch (err) {
      alert('Error al actualizar agentes: ' + err.message);
    } finally {
      btnUpdateAll.disabled = false;
      btnUpdateAll.innerHTML = originalText;
    }
  };
}

if (btnCloseUsers) {
  btnCloseUsers.onclick = () => {
    modalUsers.classList.add('hidden');
    userFormError.classList.add('hidden');
    resetUserForm();
  };
}

async function loadUsersList() {
  try {
    const res = await apiFetch('/api/users');
    currentUsersListData = await res.json();
    renderUsersList(currentUsersListData);
  } catch (err) {
    console.error('Error al cargar usuarios:', err);
  }
}

function renderUsersList(users) {
  usersListTbody.innerHTML = '';
  users.forEach(u => {
    const tr = document.createElement('tr');
    if (selectedEditUsername && u.username.toLowerCase() === selectedEditUsername.toLowerCase()) {
      tr.className = 'active-user-row';
    }
    
    const roleText = u.role === 'admin' ? 'Administrador' : 'Usuario Regular';
    
    tr.innerHTML = `
      <td><strong>${u.username}</strong></td>
      <td>${roleText}</td>
      <td>${u.hasApiKeys ? '<span style="color:var(--accent-green);font-size:0.8rem;">Key</span>' : '<span style="color:var(--text-muted);font-size:0.8rem;">—</span>'}</td>
    `;
    
    tr.onclick = () => selectUserForEdit(u);
    usersListTbody.appendChild(tr);
  });
}

function renderPermissionsList(userPerms = {}) {
  serversPermissionsList.innerHTML = '';
  if (servers.length === 0) {
    serversPermissionsList.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; padding: 10px 0;">No hay servidores registrados.</div>';
    return;
  }

  servers.forEach(srv => {
    const srvPerms = userPerms[srv.id];
    const isAssigned = !!srvPerms;
    const activePerms = srvPerms || [];

    const item = document.createElement('div');
    item.className = `server-perm-item`;
    
    item.innerHTML = `
      <div class="server-perm-header">
        <span class="server-perm-name"><i class="fa-solid fa-server"></i> ${srv.name}</span>
        <label class="perm-checkbox-label">
          <input type="checkbox" class="server-access-checkbox" data-server-id="${srv.id}" ${isAssigned ? 'checked' : ''}>
          Habilitar Acceso
        </label>
      </div>
      <div class="server-perm-checkboxes ${isAssigned ? '' : 'disabled'}">
        <label class="perm-checkbox-label">
          <input type="checkbox" class="sub-perm-checkbox" data-perm="control:console" ${activePerms.includes('control:console') ? 'checked' : ''}>
          Consola
        </label>
        <label class="perm-checkbox-label">
          <input type="checkbox" class="sub-perm-checkbox" data-perm="file:read" ${activePerms.includes('file:read') ? 'checked' : ''}>
          Ver Archivos
        </label>
        <label class="perm-checkbox-label">
          <input type="checkbox" class="sub-perm-checkbox" data-perm="file:write" ${activePerms.includes('file:write') ? 'checked' : ''}>
          Editar Archivos
        </label>
        <label class="perm-checkbox-label">
          <input type="checkbox" class="sub-perm-checkbox" data-perm="file:delete" ${activePerms.includes('file:delete') ? 'checked' : ''}>
          Borrar Archivos
        </label>
      </div>
    `;

    // Access toggle listener
    const accessCheckbox = item.querySelector('.server-access-checkbox');
    const checkboxesDiv = item.querySelector('.server-perm-checkboxes');
    accessCheckbox.onchange = () => {
      if (accessCheckbox.checked) {
        checkboxesDiv.classList.remove('disabled');
        // Auto-check "Ver Archivos" and "Consola" by default when enabling access
        checkboxesDiv.querySelectorAll('.sub-perm-checkbox').forEach(cb => {
          const perm = cb.getAttribute('data-perm');
          if (perm === 'file:read' || perm === 'control:console') {
            cb.checked = true;
          }
        });
      } else {
        checkboxesDiv.classList.add('disabled');
        checkboxesDiv.querySelectorAll('.sub-perm-checkbox').forEach(cb => cb.checked = false);
      }
    };

    serversPermissionsList.appendChild(item);
  });
}

// ── API Keys Management ──
const apikeysSection = document.getElementById('apikeys-section');
const apikeysList = document.getElementById('apikeys-list');
const btnGenApikey = document.getElementById('btn-gen-apikey');
let currentApiKeys = [];

function renderApiKeys(keys) {
  currentApiKeys = keys || [];
  apikeysList.innerHTML = '';
  if (!keys || keys.length === 0) {
    apikeysList.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem;">No hay API keys generadas.</div>';
    return;
  }
  keys.forEach((k, i) => {
    const div = document.createElement('div');
    div.className = 'server-perm-item';
    div.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
    div.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:4px 0;">
        <div style="flex:1; min-width:0;">
          <div style="font-size:0.85rem; color:var(--text-primary);">${k.name}</div>
          <code style="font-size:0.75rem; color:var(--text-muted); word-break:break-all;">${k.keyPrefix || (k.key ? k.key.substring(0, 12) + '...' : '...')}</code>
          <div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">${new Date(k.createdAt).toLocaleDateString()}</div>
        </div>
        <button class="btn-small btn-outline copy-key-btn" data-key="${k.key}" title="Copiar API Key" style="flex-shrink:0;"><i class="fa-solid fa-copy"></i></button>
        <button class="btn-small btn-danger revoke-key-btn" data-key="${k.key}" title="Revocar API Key" style="flex-shrink:0;"><i class="fa-solid fa-trash-can"></i></button>
      </div>
    `;
    apikeysList.appendChild(div);
  });
  
  // Copy buttons
  apikeysList.querySelectorAll('.copy-key-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const fullKey = btn.getAttribute('data-key');
      navigator.clipboard.writeText(fullKey).then(() => {
        btn.innerHTML = '<i class="fa-solid fa-check"></i>';
        setTimeout(() => { btn.innerHTML = '<i class="fa-solid fa-copy"></i>'; }, 2000);
      }).catch(() => {});
    };
  });
  
  // Revoke buttons
  apikeysList.querySelectorAll('.revoke-key-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const fullKey = btn.getAttribute('data-key');
      if (!confirm('Revocar esta API Key? Los agentes que la usen perderan acceso inmediatamente.')) return;
      try {
        const user = currentUsersListData.find(u => u.username.toLowerCase() === selectedEditUsername?.toLowerCase());
        if (!user) return;
        const res = await apiFetch(`/api/api-keys/${user.username}/${fullKey}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          renderApiKeys(currentApiKeys.filter(k => k.key !== fullKey));
        }
      } catch (err) {
        console.error('Error revoking key:', err);
      }
    };
  });
}

if (btnGenApikey) {
  btnGenApikey.onclick = async () => {
    if (!selectedEditUsername) return;
    const name = prompt('Nombre para esta API Key (ej: "opencode-agent"):');
    if (!name || !name.trim()) return;
    try {
      const res = await apiFetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: selectedEditUsername, name: name.trim() })
      });
      const data = await res.json();
      if (data.success) {
        // Show the full key to the user once
        alert('API Key generada:\n\n' + data.key + '\n\nGuárdala en un lugar seguro. No se mostrará nuevamente.');
        // Reload keys for this user
        renderApiKeys([...currentApiKeys, { name: data.name, key: data.key, keyPrefix: data.key.substring(0, 12) + '...', createdAt: data.createdAt }]);
      } else {
        alert('Error: ' + (data.error || 'No se pudo generar la API key'));
      }
    } catch (err) {
      alert('Error al conectar con el servidor');
    }
  };
}

function selectUserForEdit(user) {
  selectedEditUsername = user.username;
  
  // Highlight row in list
  Array.from(usersListTbody.children).forEach(tr => {
    if (tr.querySelector('strong')?.textContent.toLowerCase() === user.username.toLowerCase()) {
      tr.className = 'active-user-row';
    } else {
      tr.className = '';
    }
  });

  userFormTitle.textContent = `Editar: ${user.username}`;
  editUsernameInput.value = user.username;
  editUsernameInput.disabled = true;
  editPasswordInput.value = '';
  editPasswordInput.required = false;
  editPasswordInput.placeholder = 'Dejar en blanco para no cambiar...';
  labelEditPassword.innerHTML = `<i class="fa-solid fa-lock"></i> Nueva Contraseña`;
  editRoleSelect.value = user.role;

  // Toggle permissions section based on role
  if (user.role === 'admin') {
    permissionsSection.style.display = 'none';
  } else {
    permissionsSection.style.display = 'block';
    renderPermissionsList(user.permissions || {});
  }

  btnCancelEdit.classList.remove('hidden');
  
  // Prevent deleting current logged-in user
  const currentUsername = localStorage.getItem('username') || '';
  if (user.username.toLowerCase() === currentUsername.toLowerCase()) {
    btnDeleteUser.classList.add('hidden');
  } else {
    btnDeleteUser.classList.remove('hidden');
  }

  // Show API keys section
  if (apikeysSection) {
    apikeysSection.style.display = 'block';
  }
  if (user.hasApiKeys) {
    // Load actual keys from the server
    loadUserApiKeys(user.username);
  } else {
    renderApiKeys([]);
  }

  btnSubmitUser.innerHTML = `<i class="fa-solid fa-save"></i> Guardar Cambios`;
  userFormError.classList.add('hidden');
}

async function loadUserApiKeys(username) {
  try {
    const res = await apiFetch('/api/api-keys');
    const allKeys = await res.json();
    const userKeys = allKeys.filter(k => k.username.toLowerCase() === username.toLowerCase());
    renderApiKeys(userKeys);
  } catch (err) {
    console.error('Error loading API keys:', err);
    renderApiKeys([]);
  }
}

function resetUserForm() {
  selectedEditUsername = null;
  
  // Unhighlight rows
  if (usersListTbody) {
    Array.from(usersListTbody.children).forEach(tr => tr.className = '');
  }

  userFormTitle.textContent = "Nuevo Usuario";
  editUsernameInput.value = '';
  editUsernameInput.disabled = false;
  editPasswordInput.value = '';
  editPasswordInput.required = true;
  editPasswordInput.placeholder = 'Contraseña...';
  labelEditPassword.innerHTML = `<i class="fa-solid fa-lock"></i> Contraseña`;
  editRoleSelect.value = 'user';
  
  permissionsSection.style.display = 'block';
  renderPermissionsList({});

  btnCancelEdit.classList.add('hidden');
  btnDeleteUser.classList.add('hidden');
  btnSubmitUser.innerHTML = `<i class="fa-solid fa-user-plus"></i> Crear Usuario`;
  userFormError.classList.add('hidden');
  if (apikeysSection) apikeysSection.style.display = 'none';
  renderApiKeys([]);
}

if (btnCancelEdit) {
  btnCancelEdit.onclick = () => resetUserForm();
}

if (editRoleSelect) {
  editRoleSelect.onchange = () => {
    if (editRoleSelect.value === 'admin') {
      permissionsSection.style.display = 'none';
    } else {
      permissionsSection.style.display = 'block';
    }
  };
}

if (btnDeleteUser) {
  btnDeleteUser.onclick = async () => {
    if (!selectedEditUsername) return;
    if (!confirm(`¿Estás seguro de que deseas eliminar al usuario "${selectedEditUsername}"?`)) return;
    
    try {
      const res = await apiFetch(`/api/users/${selectedEditUsername}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        resetUserForm();
        loadUsersList();
      } else {
        userFormError.textContent = data.error || 'Error al eliminar usuario';
        userFormError.classList.remove('hidden');
      }
    } catch (err) {
      userFormError.textContent = 'Error al conectar con el servidor';
      userFormError.classList.remove('hidden');
    }
  };
}

if (userDetailForm) {
  userDetailForm.onsubmit = async (e) => {
    e.preventDefault();
    const username = editUsernameInput.value.trim();
    const password = editPasswordInput.value;
    const role = editRoleSelect.value;
    
    // Gather permissions
    const permissions = {};
    if (role === 'user') {
      serversPermissionsList.querySelectorAll('.server-perm-item').forEach(item => {
        const accessCb = item.querySelector('.server-access-checkbox');
        if (accessCb && accessCb.checked) {
          const srvId = accessCb.getAttribute('data-server-id');
          const perms = [];
          item.querySelectorAll('.sub-perm-checkbox').forEach(subCb => {
            if (subCb.checked) {
              perms.push(subCb.getAttribute('data-perm'));
            }
          });
          permissions[srvId] = perms;
        }
      });
    }

    try {
      let res;
      if (selectedEditUsername) {
        // Edit Mode
        res = await apiFetch(`/api/users/${selectedEditUsername}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role, permissions, password })
        });
      } else {
        // Create Mode
        res = await apiFetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, role })
        });
      }
      
      const data = await res.json();
      if (data.success) {
        // If edit was self, role or permissions might have changed, reload app
        const currentUsername = localStorage.getItem('username') || '';
        if (selectedEditUsername && selectedEditUsername.toLowerCase() === currentUsername.toLowerCase()) {
          localStorage.setItem('role', data.user.role);
          applyRoleRestrictions();
        }
        
        resetUserForm();
        loadUsersList();
        loadServers();
      } else {
      userFormError.textContent = data.error || 'Error al procesar usuario';
      userFormError.classList.remove('hidden');
    }
  } catch (err) {
    userFormError.textContent = 'Error al conectar con el servidor';
    userFormError.classList.remove('hidden');
  }
};
}

// ── Terminal Mobile Controls ──
let pendingMod = null;

function parseCtrlSeq(s) {
  return s
    .replace(/\\x([0-9a-fA-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\t/g, '\t')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r');
}

function termSend(data) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !selectedServerId) return;
  ws.send(JSON.stringify({ type: 'term_data', agentId: selectedServerId, data }));
}

document.getElementById('term-controls')?.addEventListener('click', e => {
  const btn = e.target.closest('.ctrl-btn');
  if (!btn) return;

  if (btn.classList.contains('mod-btn')) {
    const mod = btn.dataset.mod;
    if (pendingMod === mod) {
      pendingMod = null;
      btn.classList.remove('active');
    } else {
      document.querySelectorAll('.mod-btn.active').forEach(b => b.classList.remove('active'));
      pendingMod = mod;
      btn.classList.add('active');
    }
    e.preventDefault();
    return;
  }

  const raw = btn.dataset.char;
  let msg = parseCtrlSeq(raw);

  if (pendingMod === 'ctrl' && /^[a-zA-Z]$/.test(msg)) {
    const code = msg.toLowerCase().charCodeAt(0) - 96;
    msg = String.fromCharCode(code);
  } else if (pendingMod === 'alt' && msg.length === 1) {
    msg = '\x1b' + msg;
  }
  pendingMod = null;
  document.querySelectorAll('.mod-btn.active').forEach(b => b.classList.remove('active'));

  termSend(msg);
  e.preventDefault();
  if (activeTerminal) {
    activeTerminal.focus();
    const termTextarea = activeTerminal.element?.querySelector('textarea');
    if (termTextarea) termTextarea.focus();
  }
});

// ── Mobile: keep controls visible when keyboard opens ──
let kbOpen = false;
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    const controls = document.getElementById('term-controls');
    if (!controls) return;
    const kbHeight = window.innerHeight - window.visualViewport.height;
    kbOpen = kbHeight > 80;
    if (kbOpen) {
      controls.style.position = 'fixed';
      controls.style.bottom = kbHeight + 'px';
      controls.style.left = '0';
      controls.style.right = '0';
      controls.style.zIndex = '999';
      controls.style.backgroundColor = 'rgba(15,15,30,0.97)';
      controls.style.borderTop = '1px solid rgba(255,255,255,0.1)';
    } else {
      controls.style.position = '';
      controls.style.bottom = '';
      controls.style.left = '';
      controls.style.right = '';
      controls.style.zIndex = '';
      controls.style.backgroundColor = '';
      controls.style.borderTop = '';
    }
  });
}
// Prevent focus loss on button taps
document.getElementById('term-controls')?.addEventListener('pointerdown', e => {
  if (e.target.closest('.ctrl-btn')) e.preventDefault();
});

// ==========================================
// QUICK BUTTONS LOGIC
// ==========================================
const btnQuickButtons = document.getElementById('btn-quick-buttons');
const modalQuickButtonsConfig = document.getElementById('modal-quick-buttons-config');
const quickButtonsContainer = document.getElementById('quick-buttons-container');
const qbList = document.getElementById('qb-list');
const btnAddQb = document.getElementById('btn-add-qb');
const btnSaveQb = document.getElementById('btn-save-qb');

function renderQuickButtons(serverId) {
  if (!quickButtonsContainer) return;
  quickButtonsContainer.innerHTML = '';
  
  const srv = servers.find(s => s.id === serverId);
  if (!srv || !srv.quickButtons) return;

  srv.quickButtons.forEach(btnConfig => {
    const btn = document.createElement('button');
    btn.className = `quick-btn quick-btn-${btnConfig.color || 'default'}`;
    btn.innerHTML = `<span>${btnConfig.label}</span>`;
    btn.onclick = () => {
      const role = localStorage.getItem('role');
      if (role === 'viewer') return;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'term_data', agentId: serverId, data: btnConfig.command }));
      }
    };
    quickButtonsContainer.appendChild(btn);
  });
}

btnQuickButtons?.addEventListener('click', () => {
  const srv = servers.find(s => s.id === selectedServerId);
  if (!srv) return;
  
  qbList.innerHTML = '';
  const currentButtons = srv.quickButtons || [];
  
  currentButtons.forEach(btn => addQbRow(btn.label, btn.command, btn.color));
  
  modalQuickButtonsConfig.classList.remove('hidden');
});

modalQuickButtonsConfig?.querySelector('.btn-close-modal')?.addEventListener('click', () => {
  modalQuickButtonsConfig.classList.add('hidden');
});

function addQbRow(label = '', cmd = '', color = 'default') {
  const row = document.createElement('div');
  row.className = 'qb-row';
  row.innerHTML = `
    <input type="text" class="qb-label" placeholder="Nombre (Ej: Iniciar)" value="${label}">
    <input type="text" class="qb-cmd" placeholder="Comando (Ej: ./start.sh\\n)" value="${cmd.replace(/\n/g, '\\n')}">
    <select class="qb-color">
      <option value="default" ${color==='default'?'selected':''}>Gris</option>
      <option value="success" ${color==='success'?'selected':''}>Verde</option>
      <option value="danger" ${color==='danger'?'selected':''}>Rojo</option>
    </select>
    <button class="btn-icon btn-icon-danger qb-del" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
  `;
  row.querySelector('.qb-del').onclick = () => row.remove();
  qbList.appendChild(row);
}

btnAddQb?.addEventListener('click', () => addQbRow());

btnSaveQb?.addEventListener('click', async () => {
  const srv = servers.find(s => s.id === selectedServerId);
  if (!srv) return;
  
  const rows = qbList.querySelectorAll('.qb-row');
  const quickButtons = Array.from(rows).map(row => ({
    label: row.querySelector('.qb-label').value,
    command: row.querySelector('.qb-cmd').value.replace(/\\n/g, '\n'),
    color: row.querySelector('.qb-color').value
  }));
  
  try {
    const res = await apiFetch('/api/servers/' + selectedServerId + '/buttons', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quickButtons })
    });
    
    if (res.ok) {
      srv.quickButtons = quickButtons;
      renderQuickButtons(selectedServerId);
      modalQuickButtonsConfig.classList.add('hidden');
    } else {
      const data = await res.json();
      alert(data.error || 'Error al guardar');
    }
  } catch (err) {
    alert('Error de conexión');
  }
});

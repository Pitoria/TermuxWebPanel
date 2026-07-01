const express = require('express');
const http = require('http');
const net = require('net');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');

// Port Configurations
const HTTP_PORT = process.env.HTTP_PORT || 3000;
const TCP_PORT = process.env.TCP_PORT || 3001;

const DATA_FILE = path.join(__dirname, 'servers.json');
const USERS_FILE = path.join(__dirname, 'users.json');

// Active sessions map: token -> { username, role }
const activeSessions = new Map();

// Initialize users database
function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync('admin', salt, 1000, 64, 'sha512').toString('hex');
    const initialUsers = {
      users: [
        {
          username: 'admin',
          passwordHash: hash,
          salt: salt,
          role: 'admin',
          permissions: {}
        }
      ]
    };
    fs.writeFileSync(USERS_FILE, JSON.stringify(initialUsers, null, 2));
  }
  try {
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    let changed = false;
    data.users.forEach(u => {
      if (!u.permissions) {
        u.permissions = {};
        changed = true;
      }
      if (!u.apiKeys) {
        u.apiKeys = [];
        changed = true;
      }
    });
    if (changed) {
      fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
    }
    return data;
  } catch (err) {
    console.error("Error reading users database:", err);
    return { users: [] };
  }
}

function saveUsers(data) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

function verifyPassword(password, salt, hash) {
  const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return verifyHash === hash;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

// Middleware: Require valid session token or API key
function findUserByApiKey(key) {
  const userDb = loadUsers();
  for (const u of userDb.users) {
    if (u.apiKeys && u.apiKeys.some(k => k.key === key)) {
      return u;
    }
  }
  return null;
}

function requireAuth(req, res, next) {
  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      token = parts[1];
    }
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (token) {
    // Check session first
    if (activeSessions.has(token)) {
      const session = activeSessions.get(token);
      const userDb = loadUsers();
      const user = userDb.users.find(u => u.username.toLowerCase() === session.username.toLowerCase());
      if (!user) {
        return res.status(401).json({ error: 'Usuario no encontrado' });
      }
      req.user = user;
      return next();
    }
    
    // Check API keys
    const apiUser = findUserByApiKey(token);
    if (apiUser) {
      req.user = apiUser;
      return next();
    }
    
    return res.status(401).json({ error: 'Token o API key inválido' });
  }

  // Fallback to basic auth check for agents
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'basic') {
      const credential = parts[1];
      const decoded = Buffer.from(credential, 'base64').toString('utf8');
      const colonIdx = decoded.indexOf(':');
      if (colonIdx !== -1) {
        const username = decoded.substring(0, colonIdx);
        const password = decoded.substring(colonIdx + 1);
        const userDb = loadUsers();
        const user = userDb.users.find(u => u.username.toLowerCase() === username.toLowerCase());
        if (user && verifyPassword(password, user.salt, user.passwordHash)) {
          req.user = user;
          return next();
        }
      }
    }
  }
  
  return res.status(401).json({ error: 'No autorizado' });
}

// Middleware: Require admin role
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado: Se requiere rol de Administrador' });
  }
  next();
}

// Helpers for checking user permissions on agents
function hasServerAccess(username, agentId) {
  const userDb = loadUsers();
  const user = userDb.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return false;
  if (user.role === 'admin') return true;
  return !!(user.permissions && user.permissions[agentId]);
}

function hasPermission(username, agentId, permission) {
  const userDb = loadUsers();
  const user = userDb.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!user.permissions || !user.permissions[agentId]) return false;
  return user.permissions[agentId].includes(permission);
}

// Initialize database
function loadDatabase() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ servers: [] }, null, 2));
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    console.error("Error reading database, resetting:", err);
    return { servers: [] };
  }
}

function saveDatabase(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Active Agent Connections map: agentId -> { socket, stats: {}, termSubscribers: Set }
const activeAgents = new Map();

// Active file transfers
const activeDownloads = new Map(); // transferId -> browserRes
const activeUploads = new Map();   // transferId -> { req: browserReq, res: browserRes }

// Initialize users database on startup
loadUsers();

// Express & Server setup
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// REST API for UI
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Usuario y contraseña son requeridos' });
  }

  const userDb = loadUsers();
  const user = userDb.users.find(u => u.username.toLowerCase() === username.toLowerCase());

  if (user && verifyPassword(password, user.salt, user.passwordHash)) {
    const token = crypto.randomBytes(24).toString('hex');
    activeSessions.set(token, { username: user.username, role: user.role });
    res.json({ success: true, token, username: user.username, role: user.role });
  } else {
    res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });
  }
});

// List all registered servers with their online status
app.get('/api/servers', requireAuth, (req, res) => {
  const db = loadDatabase();
  const user = req.user;
  let allowedServers = db.servers;
  if (user.role !== 'admin') {
    allowedServers = db.servers.filter(srv => user.permissions && user.permissions[srv.id]);
  }
  const list = allowedServers.map(srv => ({
    ...srv,
    online: activeAgents.has(srv.id),
    stats: activeAgents.has(srv.id) ? activeAgents.get(srv.id).stats : null,
    userPermissions: user.role === 'admin' ? ['control:console', 'file:read', 'file:write', 'file:delete'] : (user.permissions[srv.id] || [])
  }));
  res.json(list);
});

// Register a new server
app.post('/api/servers', requireAuth, requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre es requerido' });

  const db = loadDatabase();
  const id = 'agent_' + crypto.randomBytes(4).toString('hex');
  const token = crypto.randomBytes(16).toString('hex');

  const newServer = {
    id,
    name,
    token,
    addedAt: new Date().toISOString()
  };

  db.servers.push(newServer);
  saveDatabase(db);

  res.json({ success: true, server: newServer });
});

// Delete a registered server
app.delete('/api/servers/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const db = loadDatabase();
  
  const initialLen = db.servers.length;
  db.servers = db.servers.filter(srv => srv.id !== id);
  
  if (db.servers.length === initialLen) {
    return res.status(404).json({ error: 'Servidor no encontrado' });
  }

  saveDatabase(db);

  // Disconnect agent if connected
  if (activeAgents.has(id)) {
    const agent = activeAgents.get(id);
    agent.socket.destroy();
    activeAgents.delete(id);
    console.log(`Agent ${id} disconnected due to deletion.`);
  }

  // Notify UI clients
  broadcastToUI({ type: 'server_deleted', id });

  res.json({ success: true });
});

// Configure Quick Buttons for a server
app.put('/api/servers/:id/buttons', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { quickButtons } = req.body;
  
  if (!Array.isArray(quickButtons)) {
    return res.status(400).json({ error: 'quickButtons debe ser un arreglo' });
  }

  const db = loadDatabase();
  const server = db.servers.find(s => s.id === id);
  if (!server) {
    return res.status(404).json({ error: 'Servidor no encontrado' });
  }

  server.quickButtons = quickButtons;
  saveDatabase(db);
  
  // Notify UI clients about the update
  broadcastToUI({ type: 'server_updated', server });

  res.json({ success: true, quickButtons: server.quickButtons });
});

// USER MANAGEMENT API (Admin only)
app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  const userDb = loadUsers();
  const list = userDb.users.map(u => ({ username: u.username, role: u.role, permissions: u.permissions || {}, hasApiKeys: !!(u.apiKeys && u.apiKeys.length > 0) }));
  res.json(list);
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Todos los campos son requeridos' });
  }

  const userDb = loadUsers();
  if (userDb.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: 'El usuario ya existe' });
  }

  const { hash, salt } = hashPassword(password);
  const newUser = {
    username: username.trim(),
    passwordHash: hash,
    salt: salt,
    role: role,
    permissions: {}
  };

  userDb.users.push(newUser);
  saveUsers(userDb);

  res.json({ success: true, user: { username: newUser.username, role: newUser.role, permissions: newUser.permissions } });
});

app.put('/api/users/:username', requireAuth, requireAdmin, (req, res) => {
  const { username } = req.params;
  const { role, permissions, password } = req.body;
  
  const userDb = loadUsers();
  const user = userDb.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }
  
  if (user.username.toLowerCase() === req.user.username.toLowerCase() && role && role !== 'admin') {
    const adminCount = userDb.users.filter(u => u.role === 'admin').length;
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'No puedes quitarte el rol de Administrador siendo el único admin' });
    }
  }
  
  if (role) user.role = role;
  if (permissions) user.permissions = permissions;
  
  if (password && password.trim() !== '') {
    const { hash, salt } = hashPassword(password);
    user.passwordHash = hash;
    user.salt = salt;
  }
  
  saveUsers(userDb);
  
  if (password && password.trim() !== '') {
    for (const [token, session] of activeSessions.entries()) {
      if (session.username.toLowerCase() === username.toLowerCase() && session.username.toLowerCase() !== req.user.username.toLowerCase()) {
        activeSessions.delete(token);
      }
    }
  }
  
  res.json({ success: true, user: { username: user.username, role: user.role, permissions: user.permissions } });
});

// API KEY MANAGEMENT (Admin only)
app.get('/api/api-keys', requireAuth, requireAdmin, (req, res) => {
  const userDb = loadUsers();
  const keys = [];
  userDb.users.forEach(u => {
    if (u.apiKeys && u.apiKeys.length > 0) {
      u.apiKeys.forEach(k => {
        keys.push({ username: u.username, name: k.name, key: k.key, keyPrefix: k.key.substring(0, 12) + '...', createdAt: k.createdAt });
      });
    }
  });
  res.json(keys);
});

app.post('/api/api-keys', requireAuth, requireAdmin, (req, res) => {
  const { username, name } = req.body;
  if (!username || !name) {
    return res.status(400).json({ error: 'Usuario y nombre son requeridos' });
  }
  
  const userDb = loadUsers();
  const user = userDb.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }
  
  const key = 'sk-' + crypto.randomBytes(24).toString('hex');
  const entry = { name: name.trim(), key, createdAt: new Date().toISOString() };
  
  if (!user.apiKeys) user.apiKeys = [];
  user.apiKeys.push(entry);
  saveUsers(userDb);
  
  res.json({ success: true, key: entry.key, name: entry.name, createdAt: entry.createdAt });
});

app.delete('/api/api-keys/:username/:keyId', requireAuth, requireAdmin, (req, res) => {
  const { username, keyId } = req.params;
  const userDb = loadUsers();
  const user = userDb.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }
  
  const idx = (user.apiKeys || []).findIndex(k => k.key === keyId);
  if (idx === -1) {
    return res.status(404).json({ error: 'API key no encontrada' });
  }
  
  user.apiKeys.splice(idx, 1);
  saveUsers(userDb);
  
  res.json({ success: true });
});

app.delete('/api/users/:username', requireAuth, requireAdmin, (req, res) => {
  const { username } = req.params;
  if (username.toLowerCase() === req.user.username.toLowerCase()) {
    return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
  }

  const userDb = loadUsers();
  const index = userDb.users.findIndex(u => u.username.toLowerCase() === username.toLowerCase());
  if (index === -1) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }

  // Ensure we don't delete the last admin
  const userToDelete = userDb.users[index];
  if (userToDelete.role === 'admin') {
    const adminCount = userDb.users.filter(u => u.role === 'admin').length;
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'No se puede eliminar el último administrador' });
    }
  }

  userDb.users.splice(index, 1);
  saveUsers(userDb);

  // Terminate any active sessions for the deleted user
  for (const [token, session] of activeSessions.entries()) {
    if (session.username.toLowerCase() === username.toLowerCase()) {
      activeSessions.delete(token);
    }
  }

  res.json({ success: true });
});

// TERMINAL REST API (for AI agents)
app.post('/api/terminal/:agentId', requireAuth, (req, res) => {
  const { agentId } = req.params;
  const { data } = req.body;
  
  if (!hasPermission(req.user.username, agentId, 'control:console')) {
    return res.status(403).json({ error: 'Permiso denegado: control:console' });
  }
  
  const agent = activeAgents.get(agentId);
  if (!agent) {
    return res.status(404).json({ error: 'Agente no conectado' });
  }
  
  sendTCPPacket(agent.socket, 2, data);
  res.json({ success: true, sent: data.length });
});

app.get('/api/terminal/:agentId/output', requireAuth, (req, res) => {
  const { agentId } = req.params;
  
  if (!hasServerAccess(req.user.username, agentId)) {
    return res.status(403).json({ error: 'Permiso denegado' });
  }
  
  const agent = activeAgents.get(agentId);
  if (!agent) {
    return res.json({ output: '', online: false });
  }
  
  // Optional: clear after reading
  const clear = req.query.clear === 'true';
  const output = agent.termBuf || '';
  if (clear) agent.termBuf = '';
  
  res.json({ output, online: true, chars: output.length });
});

// HELPER: Clean IP address format
function getLocalServerIP(socket) {
  let ip = socket.localAddress;
  if (!ip) return '127.0.0.1';
  if (ip === '::1' || ip === '::ffff:127.0.0.1') {
    return '127.0.0.1';
  }
  if (ip.startsWith('::ffff:')) {
    return ip.substring(7);
  }
  return ip;
}

// BROWSER DOWNLOAD ENDPOINT: Get file from agent and download it in browser
app.get('/api/servers/:agentId/download', requireAuth, (req, res) => {
  const { agentId } = req.params;
  const filePath = req.query.path;
  
  if (!filePath) {
    return res.status(400).json({ error: 'La ruta del archivo es requerida' });
  }
  
  if (!hasPermission(req.user.username, agentId, 'file:read')) {
    return res.status(403).json({ error: 'Permiso denegado: file:read' });
  }
  
  const agent = activeAgents.get(agentId);
  if (!agent) {
    return res.status(404).json({ error: 'Agente no conectado' });
  }
  
  const transferId = 'dl_' + crypto.randomBytes(8).toString('hex');
  const serverIP = getLocalServerIP(agent.socket);
  const serverUrl = `http://${serverIP}:${HTTP_PORT}/api/agent/upload/${transferId}`;
  
  // Set headers for browser download
  const filename = path.basename(filePath);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  
  // Register the response stream
  activeDownloads.set(transferId, res);
  
  // Set timeout to clear if agent doesn't connect in 15 seconds
  const timeoutId = setTimeout(() => {
    if (activeDownloads.has(transferId)) {
      activeDownloads.delete(transferId);
      if (!res.headersSent) {
        res.status(504).json({ error: 'Timeout esperando respuesta del agente' });
      }
    }
  }, 15000);
  
  res.timeoutId = timeoutId;
  
  // Instruct agent to upload the file to our special endpoint
  const payload = JSON.stringify({
    type: 'start_upload_to_server',
    path: filePath,
    transferId,
    url: serverUrl
  });
  
  sendTCPPacket(agent.socket, 1, payload);
});

// AGENT UPLOAD ENDPOINT: Agent POSTs the raw file data here, we stream it to the browser download response
app.post('/api/agent/upload/:transferId', (req, res) => {
  const { transferId } = req.params;
  
  const browserRes = activeDownloads.get(transferId);
  if (!browserRes) {
    return res.status(404).json({ error: 'Descarga no encontrada o caducada' });
  }
  
  // Clear the timeout
  if (browserRes.timeoutId) {
    clearTimeout(browserRes.timeoutId);
  }
  
  activeDownloads.delete(transferId);
  
  // Pipe agent request stream directly to browser response stream
  req.pipe(browserRes);
  
  req.on('end', () => {
    res.json({ success: true });
  });
  
  req.on('error', (err) => {
    console.error(`Error streaming agent upload to browser for ${transferId}:`, err);
    if (!browserRes.headersSent) {
      browserRes.status(500).json({ error: 'Error durante la transferencia' });
    }
    res.status(500).json({ error: err.message });
  });
});

// BROWSER UPLOAD ENDPOINT: Browser uploads a file to the server, we stream it to the agent
app.post('/api/servers/:agentId/upload', requireAuth, (req, res) => {
  const { agentId } = req.params;
  const filePath = req.query.path;
  
  if (!filePath) {
    return res.status(400).json({ error: 'La ruta de destino es requerida' });
  }
  
  if (!hasPermission(req.user.username, agentId, 'file:write')) {
    return res.status(403).json({ error: 'Permiso denegado: file:write' });
  }
  
  const agent = activeAgents.get(agentId);
  if (!agent) {
    return res.status(404).json({ error: 'Agente no conectado' });
  }
  
  const transferId = 'ul_' + crypto.randomBytes(8).toString('hex');
  const serverIP = getLocalServerIP(agent.socket);
  const serverUrl = `http://${serverIP}:${HTTP_PORT}/api/agent/download/${transferId}`;
  
  // Store browser req/res
  activeUploads.set(transferId, { req, res });
  
  // Set timeout to clear if agent doesn't connect in 15 seconds
  const timeoutId = setTimeout(() => {
    if (activeUploads.has(transferId)) {
      activeUploads.delete(transferId);
      if (!res.headersSent) {
        res.status(504).json({ error: 'Timeout esperando que el agente inicie la descarga' });
      }
    }
  }, 15000);
  
  req.timeoutId = timeoutId;
  
  // Instruct agent to download the file from our special endpoint
  const payload = JSON.stringify({
    type: 'start_download_from_server',
    path: filePath,
    transferId,
    url: serverUrl
  });
  
  sendTCPPacket(agent.socket, 1, payload);
});

// AGENT DOWNLOAD ENDPOINT: Agent GETs the raw file data from here, we pipe the browser's upload request stream to it
app.get('/api/agent/download/:transferId', (req, res) => {
  const { transferId } = req.params;
  
  const upload = activeUploads.get(transferId);
  if (!upload) {
    return res.status(404).json({ error: 'Subida no encontrada o caducada' });
  }
  
  // Clear the timeout
  if (upload.req.timeoutId) {
    clearTimeout(upload.req.timeoutId);
  }
  
  activeUploads.delete(transferId);
  
  // Pipe browser request stream directly to agent response stream
  upload.req.pipe(res);
  
  upload.req.on('end', () => {
    if (!upload.res.headersSent) {
      upload.res.json({ success: true });
    }
  });
  
  upload.req.on('error', (err) => {
    console.error(`Error streaming browser upload to agent for ${transferId}:`, err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error durante la transferencia' });
    }
    if (!upload.res.headersSent) {
      upload.res.status(500).json({ error: err.message });
    }
  });
});

// GLOBAL UPDATE ENDPOINT: Force all connected agents to update themselves from the server
app.post('/api/servers/update-all', requireAuth, requireAdmin, (req, res) => {
  let count = 0;
  for (const [agentId, agent] of activeAgents.entries()) {
    const serverIP = getLocalServerIP(agent.socket);
    const agentUrl = `http://${serverIP}:${HTTP_PORT}/agent.py`;
    const payload = JSON.stringify({
      type: 'update_agent',
      url: agentUrl
    });
    sendTCPPacket(agent.socket, 1, payload);
    count++;
  }
  res.json({ success: true, updatedCount: count });
});

// Start HTTP Server
const httpServer = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

httpServer.on('upgrade', (request, socket, head) => {
  const parsedUrl = url.parse(request.url, true);
  const token = parsedUrl.query.token;

  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  // Session token
  if (activeSessions.has(token)) {
    return wss.handleUpgrade(request, socket, head, (ws) => {
      const session = activeSessions.get(token);
      ws.username = session.username;
      wss.emit('connection', ws, request);
    });
  }

  // API key
  const apiUser = findUserByApiKey(token);
  if (apiUser) {
    return wss.handleUpgrade(request, socket, head, (ws) => {
      ws.username = apiUser.username;
      wss.emit('connection', ws, request);
    });
  }

  socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
  socket.destroy();
});

// WebSocket Server (for UI communication)
const uiClients = new Set();

wss.on('connection', (ws) => {
  uiClients.add(ws);
  console.log('UI client connected. Total:', uiClients.size);

  let currentSubscribedAgent = null;

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);
      const username = ws.username;

      if (!username) {
        console.error('WebSocket connection message without bound username');
        return;
      }

      // Handle UI-specific messages
      if (msg.type === 'subscribe') {
        const { agentId } = msg;
        if (!hasServerAccess(username, agentId)) {
          console.log(`User ${username} denied subscription access to agent ${agentId}`);
          ws.send(JSON.stringify({ type: 'status', agentId, online: false, error: 'Acceso denegado' }));
          return;
        }
        if (currentSubscribedAgent) {
          unsubscribeAgent(currentSubscribedAgent, ws);
        }
        currentSubscribedAgent = agentId;
        subscribeAgent(agentId, ws);
        
        // If agent is online, send confirmation and latest stats
        if (activeAgents.has(agentId)) {
          const agent = activeAgents.get(agentId);
          ws.send(JSON.stringify({ type: 'status', agentId, online: true, stats: agent.stats }));
        } else {
          ws.send(JSON.stringify({ type: 'status', agentId, online: false }));
        }
      }

      else if (msg.type === 'term_data') {
        const { agentId, data } = msg;
        if (!hasPermission(username, agentId, 'control:console')) {
          console.log(`User ${username} denied console write to agent ${agentId}`);
          return;
        }
        const agent = activeAgents.get(agentId);
        if (agent) {
          sendTCPPacket(agent.socket, 2, data); // Type 2 = TERM_DATA
        }
      }

      else if (msg.type === 'term_resize') {
        const { agentId, cols, rows } = msg;
        if (!hasPermission(username, agentId, 'control:console')) return;
        const agent = activeAgents.get(agentId);
        if (agent) {
          const payload = JSON.stringify({ type: 'term_resize', cols, rows });
          sendTCPPacket(agent.socket, 1, payload); // Type 1 = JSON Control Message
        }
      }

      else if (msg.type === 'file_op') {
        const { agentId, op, path, reqId, ...extra } = msg;
        
        // Check permissions based on file operation type
        let requiredPerm = '';
        if (op === 'list') {
          requiredPerm = 'file:read';
        } else if (op === 'read' || op === 'read_text') {
          requiredPerm = 'file:read';
        } else if (op === 'write_text' || op === 'upload_chunk' || op === 'mkdir') {
          requiredPerm = 'file:write';
        } else if (op === 'delete') {
          requiredPerm = 'file:delete';
        }

        if (!requiredPerm || !hasPermission(username, agentId, requiredPerm)) {
          console.log(`User ${username} denied file_op:${op} on agent ${agentId} for path ${path}`);
          ws.send(JSON.stringify({ type: 'file_op_res', reqId, success: false, error: 'Permiso denegado' }));
          return;
        }

        const agent = activeAgents.get(agentId);
        if (agent) {
          const payload = JSON.stringify({ type: 'file_op', op, path, reqId, ...extra });
          sendTCPPacket(agent.socket, 1, payload); // Type 1 = JSON Control Message
        } else {
          ws.send(JSON.stringify({ type: 'file_op_res', reqId, success: false, error: 'Agent is offline' }));
        }
      }

    } catch (err) {
      console.error('Error processing UI WS message:', err);
    }
  });

  ws.on('close', () => {
    uiClients.delete(ws);
    if (currentSubscribedAgent) {
      unsubscribeAgent(currentSubscribedAgent, ws);
    }
    console.log('UI client disconnected. Total:', uiClients.size);
  });
});

function subscribeAgent(agentId, ws) {
  if (!activeAgents.has(agentId)) return;
  const agent = activeAgents.get(agentId);
  agent.subscribers.add(ws);
}

function unsubscribeAgent(agentId, ws) {
  if (!activeAgents.has(agentId)) return;
  const agent = activeAgents.get(agentId);
  agent.subscribers.delete(ws);
}

function broadcastToUI(msg) {
  const data = JSON.stringify(msg);
  uiClients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

function broadcastToAgentSubscribers(agentId, msg) {
  if (!activeAgents.has(agentId)) return;
  const agent = activeAgents.get(agentId);
  const data = JSON.stringify(msg);
  agent.subscribers.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

// TCP Protocol Helper Functions
function sendTCPPacket(socket, type, payload) {
  try {
    const payloadBuf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
    const headerBuf = Buffer.alloc(5);
    headerBuf.writeUInt32BE(payloadBuf.length, 0);
    headerBuf.writeUInt8(type, 4);
    socket.write(Buffer.concat([headerBuf, payloadBuf]));
  } catch (err) {
    console.error('Error sending TCP packet:', err);
  }
}

function createTCPParser(socket, onPacket) {
  let buffer = Buffer.alloc(0);
  return (data) => {
    buffer = Buffer.concat([buffer, data]);
    while (true) {
      if (buffer.length < 5) return; // Need header
      const len = buffer.readUInt32BE(0);
      const type = buffer.readUInt8(4);
      if (buffer.length < 5 + len) return; // Need full payload
      const payload = buffer.subarray(5, 5 + len);
      buffer = buffer.subarray(5 + len);
      onPacket(type, payload);
    }
  };
}

// TCP Server (for Termux Agents)
const tcpServer = net.createServer((socket) => {
  let agentId = null;
  let authenticated = false;
  
  socket.setNoDelay(true);
  
  const remoteAddr = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`Agent connecting from TCP: ${remoteAddr}`);

  // Set timeout to prevent idle hanging before auth
  socket.setTimeout(10000); 

  const parser = createTCPParser(socket, (type, payload) => {
    // Reset timeout since we received data
    socket.setTimeout(0);

    if (!authenticated) {
      // First packet must be auth (JSON Control Msg type 1)
      if (type !== 1) {
        console.log(`TCP Handshake rejected: Expected JSON Control packet, got type ${type}`);
        socket.destroy();
        return;
      }
      try {
        const credentials = JSON.parse(payload.toString('utf8'));
        const db = loadDatabase();
        const registered = db.servers.find(srv => srv.id === credentials.id && srv.token === credentials.token);

        if (!registered) {
          console.log(`TCP Handshake rejected: Invalid credentials for agent ID: ${credentials.id}`);
          sendTCPPacket(socket, 1, JSON.stringify({ success: false, error: 'Authentication failed' }));
          socket.destroy();
          return;
        }

        agentId = credentials.id;
        authenticated = true;
        
        // If there was a previous connection for this agent, terminate it
        if (activeAgents.has(agentId)) {
          console.log(`Agent ${agentId} reconnected, terminating old session.`);
          activeAgents.get(agentId).socket.destroy();
        }

        activeAgents.set(agentId, {
          socket,
          stats: {},
          subscribers: new Set(),
          ip: socket.remoteAddress.replace(/^.*:/, ''),
          termBuf: '' // terminal output buffer for REST API
        });

        console.log(`Agent ${agentId} ("${registered.name}") authenticated successfully from ${socket.remoteAddress}`);
        sendTCPPacket(socket, 1, JSON.stringify({ success: true }));

        // Notify UI
        broadcastToUI({ type: 'status', agentId, online: true });

      } catch (err) {
        console.error('Error during handshake parsing:', err);
        socket.destroy();
      }
      return;
    }

    // Authenticated flow
    if (type === 1) {
      // JSON Control Message
      try {
        const msg = JSON.parse(payload.toString('utf8'));
        
        if (msg.type === 'stats') {
          // Store stats in memory
          if (activeAgents.has(agentId)) {
            const agent = activeAgents.get(agentId);
            agent.stats = msg.stats;
            // Broadcast metrics update to UI
            broadcastToUI({ type: 'stats', agentId, stats: msg.stats });
          }
        }
        
        else if (msg.type === 'file_op_res') {
          // Forward response directly to subscribers
          broadcastToAgentSubscribers(agentId, msg);
        }

      } catch (err) {
        console.error(`Error parsing JSON message from agent ${agentId}:`, err);
      }
    } 
    
    else if (type === 2) {
      // Terminal Output data
      const dataStr = payload.toString('latin1');
      // Buffer for REST API (keep last ~10000 chars)
      if (activeAgents.has(agentId)) {
        const agent = activeAgents.get(agentId);
        agent.termBuf = (agent.termBuf || '') + dataStr;
        if (agent.termBuf.length > 20000) agent.termBuf = agent.termBuf.slice(-10000);
      }
      broadcastToAgentSubscribers(agentId, { type: 'term_data', agentId, data: dataStr });
    }
  });

  socket.on('data', parser);

  socket.on('timeout', () => {
    console.log(`TCP Handshake timeout for ${remoteAddr}`);
    socket.destroy();
  });

  socket.on('error', (err) => {
    console.log(`TCP socket error for agent ${agentId || remoteAddr}:`, err.message);
  });

  socket.on('close', () => {
    if (agentId && activeAgents.has(agentId) && activeAgents.get(agentId).socket === socket) {
      activeAgents.delete(agentId);
      console.log(`Agent ${agentId} disconnected.`);
      broadcastToUI({ type: 'status', agentId, online: false });
    } else {
      console.log(`Unauthenticated TCP connection closed from ${remoteAddr}`);
    }
  });
});

// Start listening
httpServer.listen(HTTP_PORT, () => {
  console.log(`Web Panel HTTP Server running on http://localhost:${HTTP_PORT}`);
});

tcpServer.listen(TCP_PORT, () => {
  console.log(`Agent TCP Server running on port ${TCP_PORT}`);
});

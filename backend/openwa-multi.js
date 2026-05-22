/**
 * OpenWa Multi-Tenant - Gestión de instancias de WhatsApp por tenant
 * Cada tenant conecta su propio número de WhatsApp.
 */

const path = require('path');
const fs = require('fs');
const SESSIONS_DIR = path.join(__dirname, '..', 'data', 'wa-sessions');

// Ensure sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// Map of running clients: { tenantKey: { client, state, config, qr, status } }
var instances = {};

function getTenantKey(session) {
  if (!session || !session.user) return 'admin';
  if (session.isTenant && session.db_path) return session.db_path.replace(/\.db$/, '').replace(/^tenant_/, '');
  return 'admin';
}

function getDbForTenant(session) {
  if (session && session.isTenant && session.db_path) {
    try {
      var Database = require('better-sqlite3');
      var p = path.join(__dirname, '..', 'data', session.db_path);
      if (fs.existsSync(p)) {
        var tdb = new Database(p);
        tdb.pragma('journal_mode = WAL');
        return tdb;
      }
    } catch(e) {}
  }
  return null;
}

function getInstance(key) {
  if (!instances[key]) {
    instances[key] = { 
      client: null, 
      state: 'disconnected', 
      config: { enabled: false },
      qr: null,
      ready: false,
      start: function() { return startInstance(key); },
      stop: function() { return stopInstance(key); },
      getStatus: function() { return { state: instances[key].state, qr: instances[key].qr, running: instances[key].state === 'connected' }; },
      getConfig: function() { return instances[key].config; },
      sendMessage: function(phone, msg) { return sendMessageInstance(key, phone, msg); }
    };
  }
  return instances[key];
}

function loadConfig(key) {
  try {
    if (key === 'admin') {
      var db = require('./database');
      var row = db.prepare("SELECT value FROM configuracion WHERE key='openwa_config'").get();
      if (row) {
        try { return JSON.parse(row.value); } catch(e) {}
      }
      return { enabled: true };
    }
    // Tenant: load from their DB
    var parts = key.split('tenant_');
    if (parts.length > 1) {
      var dbPath = parts[1] + '.db';
      var fullPath = path.join(__dirname, '..', 'data', dbPath);
      if (fs.existsSync(fullPath)) {
        var Database = require('better-sqlite3');
        var db = new Database(fullPath);
        db.pragma('journal_mode = WAL');
        // Ensure config table exists in tenant DB
        db.exec("CREATE TABLE IF NOT EXISTS configuracion (key TEXT PRIMARY KEY, value TEXT)");
        try { db.exec("INSERT OR IGNORE INTO configuracion (key, value) VALUES ('openwa_config', '{\"enabled\":false}')"); } catch(e) {}
        var row = db.prepare("SELECT value FROM configuracion WHERE key='openwa_config'").get();
        db.close();
        if (row) {
          try { return JSON.parse(row.value); } catch(e) {}
        }
      }
    }
  } catch(e) {}
  return { enabled: false };
}

function saveConfig(key, cfg) {
  try {
    if (key === 'admin') {
      var db = require('./database');
      db.prepare("INSERT OR REPLACE INTO configuracion (key, value) VALUES ('openwa_config', ?)").run(JSON.stringify(cfg));
      return true;
    }
    var parts = key.split('tenant_');
    if (parts.length > 1) {
      var dbPath = parts[1] + '.db';
      var fullPath = path.join(__dirname, '..', 'data', dbPath);
      if (fs.existsSync(fullPath)) {
        var Database = require('better-sqlite3');
        var db = new Database(fullPath);
        db.pragma('journal_mode = WAL');
        db.exec("CREATE TABLE IF NOT EXISTS configuracion (key TEXT PRIMARY KEY, value TEXT)");
        db.prepare("INSERT OR REPLACE INTO configuracion (key, value) VALUES ('openwa_config', ?)").run(JSON.stringify(cfg));
        db.close();
        return true;
      }
    }
  } catch(e) {}
  return false;
}

async function startInstance(key) {
  var inst = getInstance(key);
  if (!inst) return { success: false, msg: 'No instance' };
  if (inst.state === 'connected') return { success: true, msg: 'Ya conectado' };
  
  var cfg = loadConfig(key);
  inst.config = cfg;
  
  try {
    // Try to use the existing client if available
    if (inst.client) {
      try { inst.client.destroy(); } catch(e) {}
      inst.client = null;
    }
    
    var sessionDir = path.join(SESSIONS_DIR, key.replace(/[^a-zA-Z0-9_]/g, '_'));
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
    
    var { Client, LocalAuth } = require('whatsapp-web.js');
    inst.state = 'starting';
    
    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: sessionDir }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
      }
    });
    
    inst.client = client;
    
    client.on('qr', (qr) => {
      inst.state = 'qr';
      inst.qr = qr;
      console.log('[WA-' + key + '] QR generado');
      // Save QR as PNG file for serving
      try {
        var qrCodeLib = require('qrcode');
        var qrFilePath = path.join(SESSIONS_DIR, key.replace(/[^a-zA-Z0-9_]/g, '_') + '_qr.png');
        qrCodeLib.toFile(qrFilePath, qr, { type: 'png', width: 300, margin: 2 }, function(err) {
          if (err) console.log('[WA-' + key + '] QR file error:', err.message);
        });
      } catch(e) { console.log('[WA-' + key + '] QR lib error:', e.message); }
    });
    
    client.on('ready', () => {
      inst.state = 'connected';
      inst.qr = null;
      inst.ready = true;
      console.log('[WA-' + key + '] Conectado');
      // Update config with connected state
      var c = loadConfig(key);
      c.enabled = true;
      saveConfig(key, c);
    });
    
    client.on('disconnected', (reason) => {
      inst.state = 'disconnected';
      inst.ready = false;
      console.log('[WA-' + key + '] Desconectado:', reason);
    });
    
    client.on('auth_failure', (msg) => {
      inst.state = 'auth_failure';
      console.log('[WA-' + key + '] Auth failure:', msg);
    });
    
    await client.initialize();
    return { success: true, msg: 'Iniciando...' };
  } catch(e) {
    inst.state = 'error';
    console.error('[WA-' + key + '] Error:', e.message);
    return { success: false, msg: e.message };
  }
}

async function stopInstance(key) {
  var inst = instances[key];
  if (inst && inst.client) {
    try {
      inst.state = 'disconnected';
      await inst.client.destroy();
      console.log('[WA-' + key + '] Cliente destruido');
    } catch(e) {}
  }
  inst.client = null;
  inst.ready = false;
  // Kill any orphaned browser processes for this session
  try {
    var execSync = require('child_process').execSync;
    var sessionDir = path.join(SESSIONS_DIR, key.replace(/[^a-zA-Z0-9_]/g, '_'));
    execSync("pkill -f '" + sessionDir + "'", { stdio: 'ignore', timeout: 3000 });
    execSync("fuser -k " + sessionDir + "/*.lock 2>/dev/null; rm -f " + sessionDir + "/*.lock", { stdio: 'ignore', timeout: 3000 });
  } catch(e) {}
  inst.state = 'disconnected';
  console.log('[WA-' + key + '] Detenido');
  return { success: true, msg: 'Detenido' };
}

async function sendMessageInstance(key, phone, message) {
  var inst = instances[key];
  if (!inst || !inst.client || !inst.ready) {
    // Enqueue for later
    enqueueMessage(key, phone, message);
    return { success: false, msg: 'WhatsApp no conectado, mensaje encolado' };
  }
  try {
    var cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('1') && cleanPhone.length === 11) cleanPhone = cleanPhone.slice(1);
    if (!cleanPhone.endsWith('@c.us')) cleanPhone += '@c.us';
    await inst.client.sendMessage(cleanPhone, message);
    return { success: true, msg: 'Enviado' };
  } catch(e) {
    enqueueMessage(key, phone, message);
    return { success: false, msg: e.message };
  }
}

function enqueueMessage(key, phone, message) {
  try {
    var db = key === 'admin' ? require('./database') : getDbForTenant({ isTenant: key !== 'admin', db_path: key.replace('tenant_', '') + '.db' });
    if (db) {
      db.exec("CREATE TABLE IF NOT EXISTS message_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, message TEXT, status TEXT DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
      db.prepare("INSERT INTO message_queue (phone, message) VALUES (?,?)").run(phone, message);
      if (key !== 'admin') db.close();
    }
  } catch(e) {}
}

function getStatus(key) {
  var inst = instances[key];
  if (!inst) return { state: 'disconnected', qr: null, running: false };
  return { state: inst.state, qr: inst.qr, running: inst.state === 'connected' || inst.state === 'starting' || inst.state === 'qr' };
}

// Initialize admin instance on load
var adminCfg = loadConfig('admin');
if (adminCfg && adminCfg.enabled) {
  setTimeout(function() {
    startInstance('admin').then(function(r) {
      console.log('[WA-admin] Auto-start:', r.msg);
    }).catch(function(e) {
      console.log('[WA-admin] Auto-start error:', e.message);
    });
  }, 3000);
}

module.exports = {
  getInstance, getTenantKey, getDbForTenant,
  getStatus: function(session) { var key = getTenantKey(session); getInstance(key); return getStatus(key); },
  start: function(session) { var key = getTenantKey(session); getInstance(key); return startInstance(key); },
  stop: function(session) { var key = getTenantKey(session); getInstance(key); return stopInstance(key); },
  sendMessage: function(session, phone, msg) { return sendMessageInstance(getTenantKey(session), phone, msg); },
  getConfig: function(session) { return loadConfig(getTenantKey(session)); },
  saveConfig: function(session, key, value) {
    var cfg = loadConfig(getTenantKey(session));
    cfg[key] = value;
    saveConfig(getTenantKey(session), cfg);
  }
};

/**
 * OpenWa Service v6 - whatsapp-web.js ultra estable
 * Keep-alive, auto-reconnect con backoff, cola de mensajes, health check.
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');
const db = new Database(path.join(__dirname, '..', 'isptotal.db'));
db.pragma('journal_mode = WAL');

const SESSION_DIR = path.join(__dirname, '..', 'openwa-sessions');
const QR_FILE = path.join(__dirname, '..', 'openwa-qr.png');
var CHROME_PATH = '/home/joel/.cache/puppeteer/chrome/linux-146.0.7680.31/chrome-linux64/chrome';
try {
  var chromeDirs = fs.readdirSync('/home/joel/.cache/puppeteer/chrome/').filter(function(d) { return d.startsWith('linux-'); }).sort();
  // Prefer Chrome 131 (matches puppeteer-core 23.11.1), fallback to latest
  var targetVer = chromeDirs.filter(function(d) { return d.startsWith('linux-146'); });
  if (target131.length > 0) {
    var p = '/home/joel/.cache/puppeteer/chrome/' + targetVer[0] + '/chrome-linux64/chrome';
    if (fs.existsSync(p)) CHROME_PATH = p;
  } else if (chromeDirs.length > 0) {
    var latest = '/home/joel/.cache/puppeteer/chrome/' + chromeDirs[chromeDirs.length - 1] + '/chrome-linux64/chrome';
    if (fs.existsSync(latest)) CHROME_PATH = latest;
  }
} catch(e) {}

let client = null;
let connectionState = 'disconnected';
let autoReconnectTimer = null;
let healthCheckTimer = null;
let keepAliveTimer = null;
let reconnectAttempts = 0;

// ========== LIMPIEZA ==========

function cleanupStaleChrome() {
  try {
    var sessionPath = path.join(SESSION_DIR, 'session');
    try {
      var result = execSync("ps aux | grep -i chrome | grep 'user-data-dir.*openwa-sessions' | awk '{print $2}'", { encoding: 'utf8', timeout: 3000 });
      var pids = result.trim().split('\n').filter(Boolean);
      pids.forEach(function(pid) {
        try { process.kill(parseInt(pid), 'SIGKILL'); } catch(e) {}
      });
    } catch(e) {}
    ['SingletonLock','SingletonCookie','SingletonSocket','SingletonConnect'].forEach(function(f) {
      try { fs.unlinkSync(path.join(sessionPath, f)); } catch(e) {}
    });
    try { fs.unlinkSync(QR_FILE); } catch(e) {}
  } catch(e) {}
}

// ========== COLA DE MENSAJES ==========

function procesarColaMensajes() {
  try {
    var pendientes = db.prepare("SELECT * FROM message_queue WHERE estado='pendiente' AND intentos < max_intentos ORDER BY created_at ASC LIMIT 5").all();
    if (pendientes.length === 0) return;
    console.log('[OpenWa] Procesando ' + pendientes.length + ' mensajes en cola...');
    pendientes.forEach(function(msg) {
      if (connectionState !== 'connected') return;
      sendMessage(msg.telefono, msg.mensaje).then(function(r) {
        if (r.success) {
          db.prepare("UPDATE message_queue SET estado='enviado', enviado_at=datetime('now'), error=NULL WHERE id=?").run(msg.id);
          console.log('[OpenWa] Cola: mensaje #' + msg.id + ' enviado OK');
        } else {
          db.prepare("UPDATE message_queue SET intentos=intentos+1, error=? WHERE id=?").run(r.msg || 'Error desconocido', msg.id);
          console.log('[OpenWa] Cola: mensaje #' + msg.id + ' falló (' + r.msg + ')');
        }
      });
    });
  } catch(e) {
    console.log('[OpenWa] Error procesando cola:', e.message);
  }
}

function encolarMensaje(clienteId, servicioId, telefono, mensaje, tipo) {
  try {
    db.prepare("INSERT INTO message_queue (cliente_id, servicio_id, telefono, mensaje, tipo) VALUES (?,?,?,?,?)").run(clienteId || null, servicioId || null, telefono, mensaje, tipo || 'bienvenida');
    console.log('[OpenWa] Mensaje encolado para ' + telefono);
    if (connectionState === 'connected') {
      setTimeout(procesarColaMensajes, 500);
    }
    return true;
  } catch(e) {
    console.log('[OpenWa] Error encolando mensaje:', e.message);
    return false;
  }
}

// ========== KEEP ALIVE ==========
// WhatsApp Web desconecta después de ~2h de inactividad
// Enviamos un ping cada 20 minutos para mantener la sesión activa

function iniciarKeepAlive() {
  detenerKeepAlive();
  keepAliveTimer = setInterval(function() {
    if (!client || connectionState !== 'connected') return;
    try {
      // Enviar presencia (visto) a WhatsApp para mantener sesión activa
      client.sendPresenceAvailable().catch(function() {});
    } catch(e) {}
  }, 20 * 60 * 1000); // cada 20 minutos
}

function detenerKeepAlive() {
  if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
}

// ========== HEALTH CHECK ==========

function iniciarHealthCheck() {
  if (healthCheckTimer) clearInterval(healthCheckTimer);
  healthCheckTimer = setInterval(function() {
    if (!client) {
      // Sin cliente, intentar reconectar si está habilitado
      if (getConfig().enabled && connectionState === 'disconnected' && !autoReconnectTimer) {
        console.log('[OpenWa] HealthCheck: sin cliente, reconectando...');
        start();
      }
      return;
    }
    if (connectionState === 'connected') {
      procesarColaMensajes();
    }
  }, 30000);
}

function detenerHealthCheck() {
  if (healthCheckTimer) { clearInterval(healthCheckTimer); healthCheckTimer = null; }
}

// ========== CONFIG ==========

function getConfig() {
  var row = db.prepare("SELECT value FROM configuracion WHERE key='openwa_enabled'").get();
  return { enabled: row && (row.value === '1' || row.value === 'true' || row.value === 'Si') };
}

function saveConfig(key, value) {
  db.prepare("INSERT OR REPLACE INTO configuracion (key, value) VALUES (?,?)").run(key, String(value));
}

// ========== START / STOP ==========

async function start() {
  if (client) {
    if (connectionState === 'connected') return { success: true, msg: 'OpenWa ya está activo' };
    try { await client.destroy(); } catch(e) {}
    client = null;
    connectionState = 'disconnected';
  }

  var cfg = getConfig();
  if (!cfg.enabled) return { success: false, msg: 'OpenWa no habilitado' };

  cleanupStaleChrome();

  try {
    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

    const { Client, LocalAuth } = require('whatsapp-web.js');

    client = new Client({
      authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
      puppeteer: {
        headless: true,
        executablePath: CHROME_PATH,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-background-networking',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          '--disable-ipc-flooding-protection',
          '--disable-extensions',
          '--disable-sync',
          '--autoplay-policy=user-gesture-required',
          '--no-first-run',
          '--disable-features=Translate,MediaRouter'
        ]
      }
    });

    connectionState = 'starting';
    reconnectAttempts = 0;

    client.on('qr', function(qrCode) {
      connectionState = 'qr';
      try {
        var QRCode = require('qrcode');
        QRCode.toFile(QR_FILE, qrCode, { type: 'png', width: 300, margin: 2 }, function(err) {
          if (err) console.error('[OpenWa] QR error:', err.message);
        });
      } catch(e) {}
    });

    client.on('ready', function() {
      connectionState = 'connected';
      reconnectAttempts = 0;
      if (autoReconnectTimer) { clearTimeout(autoReconnectTimer); autoReconnectTimer = null; }
      console.log('[OpenWa] Conectado a WhatsApp');
      procesarColaMensajes();
      iniciarHealthCheck();
      iniciarKeepAlive();
    });

    client.on('disconnected', function(reason) {
      console.log('[OpenWa] Desconectado:', reason);
      connectionState = 'disconnected';
      client = null;
      detenerHealthCheck();
      detenerKeepAlive();
      if (getConfig().enabled) {
        // Backoff exponencial: 5s, 10s, 20s, 40s, 80s, 160s, 300s max
        reconnectAttempts++;
        var delay = Math.min(5000 * Math.pow(2, reconnectAttempts - 1), 300000);
        console.log('[OpenWa] Reconnect en ' + (delay/1000) + 's (intento #' + reconnectAttempts + ')');
        autoReconnectTimer = setTimeout(function() { start(); }, delay);
      }
    });

    client.on('auth_failure', function(msg) {
      console.log('[OpenWa] Fallo de autenticación:', msg);
      connectionState = 'disconnected';
      client = null;
      detenerHealthCheck();
      detenerKeepAlive();
      if (getConfig().enabled) {
        reconnectAttempts++;
        var delay = Math.min(5000 * Math.pow(2, reconnectAttempts - 1), 300000);
        autoReconnectTimer = setTimeout(function() { start(); }, delay);
      }
    });

    await client.initialize();
    return { success: true, msg: 'OpenWa iniciado' };
  } catch(e) {
    client = null;
    connectionState = 'disconnected';
    detenerHealthCheck();
    detenerKeepAlive();
    return { success: false, msg: 'Error: ' + e.message };
  }
}

async function stop() {
  detenerHealthCheck();
  detenerKeepAlive();
  if (autoReconnectTimer) { clearTimeout(autoReconnectTimer); autoReconnectTimer = null; }
  if (!client) {
    cleanupStaleChrome();
    return { success: false, msg: 'No está en ejecución' };
  }
  try { await client.destroy(); } catch(e) {}
  client = null;
  connectionState = 'disconnected';
  cleanupStaleChrome();
  return { success: true, msg: 'OpenWa detenido' };
}

// ========== STATUS / SEND ==========

function getStatus() {
  var hasQr = false;
  try { hasQr = fs.existsSync(QR_FILE) && fs.statSync(QR_FILE).size > 100; } catch(e) {}
  return {
    running: client !== null,
    state: connectionState,
    qr: (connectionState === 'qr' && hasQr) ? '/openwa-qr.png' : null
  };
}

async function sendMessage(phone, message) {
  if (!client) return { success: false, msg: 'OpenWa no iniciado' };
  if (connectionState !== 'connected') {
    return { success: false, msg: 'WhatsApp no conectado' };
  }
  try {
    var cleanPhone = phone.replace(/[^\d]/g, '');
    if (cleanPhone.length === 10) cleanPhone = '1' + cleanPhone;
    
    try {
      var wwInfo = client.info ? (client.info.wid ? client.info.wid.user : '') : '';
      if (wwInfo) {
        var cleanWw = wwInfo.replace(/[^\d]/g, '');
        if (cleanWw.length === 10) cleanWw = '1' + cleanWw;
        if (cleanPhone === cleanWw) {
          console.log('[OpenWa] Saltando auto-mensaje (mismo número)');
          return { success: true, msg: 'Auto-mensaje omitido' };
        }
      }
    } catch(e) {}
    
    await client.sendMessage(cleanPhone + '@c.us', message);
    return { success: true, msg: 'Mensaje enviado' };
  } catch(e) {
    var errMsg = e.message || '';
    if (errMsg.includes('detached Frame') || errMsg.includes('No LID for user')) {
      console.log('[OpenWa] Frame desconectado, reiniciando en 2s...');
      if (!autoReconnectTimer) {
        detenerHealthCheck();
        detenerKeepAlive();
        if (client) { try { client.destroy(); } catch(ex) {} client = null; }
        connectionState = 'disconnected';
        autoReconnectTimer = setTimeout(function() { start(); }, 2000);
      }
    }
    return { success: false, msg: 'Error: ' + errMsg };
  }
}

module.exports = { getConfig, saveConfig, start, stop, getStatus, sendMessage, encolarMensaje, procesarColaMensajes };

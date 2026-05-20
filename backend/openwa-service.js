/**
 * OpenWa Service v5 - whatsapp-web.js con auto-reconnect robusto,
 * cola de mensajes y health check.
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const db = require('./database');

const SESSION_DIR = path.join(__dirname, '..', 'openwa-sessions');
const QR_FILE = path.join(__dirname, '..', 'openwa-qr.png');
// Buscar Chrome más reciente disponible
var CHROME_PATH = '/home/jellyfin/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome';
try {
  var chromeDirs = fs.readdirSync('/home/jellyfin/.cache/puppeteer/chrome/').filter(function(d) { return d.startsWith('linux-'); }).sort();
  if (chromeDirs.length > 0) {
    var latest = '/home/jellyfin/.cache/puppeteer/chrome/' + chromeDirs[chromeDirs.length - 1] + '/chrome-linux64/chrome';
    if (fs.existsSync(latest)) CHROME_PATH = latest;
  }
} catch(e) {}

let client = null;
let connectionState = 'disconnected';
let autoReconnectTimer = null;
let healthCheckTimer = null;

// ========== LIMPIEZA ==========

function cleanupStaleChrome() {
  try {
    var sessionPath = path.join(SESSION_DIR, 'session');
    // Matar procesos Chrome zombies que usen nuestra sesión
    try {
      var result = execSync("ps aux | grep -i chrome | grep 'user-data-dir.*openwa-sessions' | awk '{print $2}'", { encoding: 'utf8', timeout: 3000 });
      var pids = result.trim().split('\n').filter(Boolean);
      pids.forEach(function(pid) {
        try { process.kill(parseInt(pid), 'SIGKILL'); } catch(e) {}
      });
    } catch(e) {}
    // Eliminar archivos de candado
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
    // Si estamos conectados, procesar inmediatamente
    if (connectionState === 'connected') {
      setTimeout(procesarColaMensajes, 500);
    }
    return true;
  } catch(e) {
    console.log('[OpenWa] Error encolando mensaje:', e.message);
    return false;
  }
}

// ========== HEALTH CHECK ==========

function iniciarHealthCheck() {
  if (healthCheckTimer) clearInterval(healthCheckTimer);
  healthCheckTimer = setInterval(function() {
    if (!client) return;
    if (connectionState === 'connected') {
      // Procesar cola cada 30 segundos si hay mensajes pendientes
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
  // Si el cliente existe pero no está connected, destruirlo y recrear
  if (client) {
    if (connectionState === 'connected') return { success: true, msg: 'OpenWa ya está activo' };
    try { await client.destroy(); } catch(e) {}
    client = null;
    connectionState = 'disconnected';
  }

  var cfg = getConfig();
  if (!cfg.enabled) return { success: false, msg: 'OpenWa no habilitado' };

  // Limpiar procesos zombies antes de iniciar
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
          '--disable-gpu'
        ]
      }
    });

    connectionState = 'starting';

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
      if (autoReconnectTimer) { clearTimeout(autoReconnectTimer); autoReconnectTimer = null; }
      console.log('[OpenWa] Conectado a WhatsApp');
      // Procesar mensajes en cola pendientes
      procesarColaMensajes();
      // Iniciar health check
      iniciarHealthCheck();
    });

    client.on('disconnected', function(reason) {
      console.log('[OpenWa] Desconectado:', reason);
      connectionState = 'disconnected';
      client = null;
      detenerHealthCheck();
      if (getConfig().enabled) {
        autoReconnectTimer = setTimeout(function() { start(); }, 5000);
      }
    });

    client.on('auth_failure', function() {
      console.log('[OpenWa] Fallo de autenticación');
      connectionState = 'disconnected';
      client = null;
      detenerHealthCheck();
      if (getConfig().enabled) {
        autoReconnectTimer = setTimeout(function() { start(); }, 10000);
      }
    });

    await client.initialize();
    return { success: true, msg: 'OpenWa iniciado' };
  } catch(e) {
    client = null;
    connectionState = 'disconnected';
    detenerHealthCheck();
    return { success: false, msg: 'Error: ' + e.message };
  }
}

async function stop() {
  detenerHealthCheck();
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
    
    // Evitar enviar mensajes al mismo número (no se puede auto-enviar)
    try {
      var myNumber = client.info ? (client.info.wid ? client.info.wid.user : '') : '';
      if (myNumber && cleanPhone === myNumber) {
        console.log('[OpenWa] Saltando auto-mensaje a ' + phone);
        return { success: true, msg: 'Auto-mensaje omitido' };
      }
    } catch(e) {}
    
    await client.sendMessage(cleanPhone + '@c.us', message);
    return { success: true, msg: 'Mensaje enviado' };
  } catch(e) {
    return { success: false, msg: 'Error: ' + e.message };
  }
}

module.exports = { getConfig, saveConfig, start, stop, getStatus, sendMessage, encolarMensaje, procesarColaMensajes };

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'isptotal.db');
const db = new Database(DB_PATH);

// Enable WAL mode
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Run schema
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
// Run schema
db.exec(schema);

// Migration: Add nuevos campos a empleados si no existen
try { db.exec("ALTER TABLE empleados ADD COLUMN tipo_otro TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE empleados ADD COLUMN usuario_id INTEGER REFERENCES usuarios(id)"); } catch(e) {}
try { db.exec("ALTER TABLE promesas_pago ADD COLUMN servicio_ids TEXT"); } catch(e) {}
// Migration: Configuración columns
try { db.exec("ALTER TABLE servicios ADD COLUMN es_gratis INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE servicios ADD COLUMN no_suspender INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE servicios ADD COLUMN descuento_monto REAL DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE servicios ADD COLUMN fecha_retiro DATETIME"); } catch(e) {}
try { db.exec("ALTER TABLE servicios ADD COLUMN motivo_retiro TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE clientes ADD COLUMN notificar_facturas INTEGER DEFAULT 1"); } catch(e) {}
try { db.exec("ALTER TABLE clientes ADD COLUMN facturar_consolidado INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE clientes ADD COLUMN comprobante_fiscal TEXT DEFAULT 'ninguno'"); } catch(e) {}
try { db.exec("ALTER TABLE onu ADD COLUMN caja_nap_id INTEGER REFERENCES cajas_nap(id)"); } catch(e) {}
try { db.exec("ALTER TABLE onu ADD COLUMN puerto_caja INTEGER"); } catch(e) {}
try { db.exec("ALTER TABLE promesas_pago ADD COLUMN created_by_name TEXT"); } catch(e) {}

// Proveedores migration
try { db.exec("ALTER TABLE proveedores ADD COLUMN telefono TEXT"); } catch(e) {}

// Inventory module migrations
try { db.exec("ALTER TABLE inventario ADD COLUMN oficina TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE inventario ADD COLUMN serial TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE inventario ADD COLUMN asignado_a TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE inventario ADD COLUMN asignado_uso TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE inventario ADD COLUMN asignado_cliente TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE inventario ADD COLUMN fecha_asignacion DATETIME"); } catch(e) {}
try { db.exec("ALTER TABLE inventario ADD COLUMN precio_venta REAL DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE inventario ADD COLUMN asignado_oficina TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE inventario ADD COLUMN razon_devolucion TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE inventario ADD COLUMN tipo_falla TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE inventario ADD COLUMN cliente_lugar TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE inventario ADD COLUMN fecha_devolucion DATETIME"); } catch(e) {}

// New tables for inventory module
db.exec("CREATE TABLE IF NOT EXISTS inventario_oficinas (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT UNIQUE NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
db.exec("CREATE TABLE IF NOT EXISTS inventario_personal (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT UNIQUE NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
db.exec("CREATE TABLE IF NOT EXISTS inventario_alertas (id INTEGER PRIMARY KEY AUTOINCREMENT, categoria TEXT NOT NULL, minimo INTEGER DEFAULT 5, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");

// Add columns to inventario_movimientos if needed
try { db.exec("ALTER TABLE inventario_movimientos ADD COLUMN detalle TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE inventario_movimientos ADD COLUMN tecnico_nombre TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE inventario_movimientos ADD COLUMN cliente_servicio TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE inventario_movimientos ADD COLUMN oficina_destino TEXT"); } catch(e) {}

// Migration: Add columns to planes table
try { db.exec("ALTER TABLE planes ADD COLUMN velocidad_subida TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE planes ADD COLUMN velocidad_bajada TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE planes ADD COLUMN upload_burst TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE planes ADD COLUMN download_burst TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE planes ADD COLUMN burst_threshold_up TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE planes ADD COLUMN burst_threshold_down TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE planes ADD COLUMN perfil_mikrotik TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE planes ADD COLUMN perfil_olt_descarga TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE planes ADD COLUMN perfil_olt_subida TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE planes ADD COLUMN zonas TEXT DEFAULT 'all'"); } catch(e) {}
try { db.exec("ALTER TABLE planes ADD COLUMN disponible INTEGER DEFAULT 1"); } catch(e) {}

// Crear tabla mensajes si no existe
db.exec(`
CREATE TABLE IF NOT EXISTS mensajes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'nota',
  mensaje TEXT NOT NULL,
  enviado_por INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
);
`);

// Crear tabla cron_tasks si no existe
db.exec(`
CREATE TABLE IF NOT EXISTS cron_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_name TEXT NOT NULL UNIQUE,
  enabled INTEGER DEFAULT 0,
  hour INTEGER DEFAULT 6,
  minute INTEGER DEFAULT 0,
  last_run DATETIME,
  last_status TEXT DEFAULT 'never',
  last_output TEXT
);
`);

// ============================================================
// LOGS TABLE
// ============================================================
db.exec(`
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_nombre TEXT DEFAULT '',
  usuario_id INTEGER,
  accion TEXT NOT NULL,
  modulo TEXT NOT NULL,
  cliente_id INTEGER,
  cliente_nombre TEXT DEFAULT '',
  servicio_id INTEGER,
  detalle TEXT DEFAULT '',
  ip_address TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);
`);

// Index for faster log queries
try { db.exec('CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at)'); } catch(e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_logs_modulo ON logs(modulo)'); } catch(e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_logs_usuario ON logs(usuario_nombre)'); } catch(e) {}

// Helper function to log activity
function logActivity(usuario, accion, modulo, opts = {}) {
  try {
    const ip = opts.ip || '';
    const detalle = opts.detalle || '';
    const clienteId = opts.cliente_id || null;
    const clienteNombre = opts.cliente_nombre || '';
    const servicioId = opts.servicio_id || null;
    const usuarioId = opts.usuario_id || null;
    const usuarioNombre = opts.usuario_nombre || (typeof usuario === 'object' ? usuario.nombre || usuario.username : String(usuario));
    
    // Write to main DB (for admin view)
    db.prepare(`INSERT INTO logs (usuario_nombre, usuario_id, accion, modulo, cliente_id, cliente_nombre, servicio_id, detalle, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(usuarioNombre, usuarioId, accion, modulo, clienteId, clienteNombre, servicioId, detalle, ip);
    
    // Also write to tenant DB if active
    try {
      if (typeof global !== 'undefined' && global.__tenantDbForLogs) {
        global.__tenantDbForLogs.prepare(`INSERT INTO logs (usuario_nombre, usuario_id, accion, modulo, cliente_id, cliente_nombre, servicio_id, detalle, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(usuarioNombre, usuarioId, accion, modulo, clienteId, clienteNombre, servicioId, detalle, ip);
      }
    } catch(e2) {}
  } catch(e) {
    console.error('[Log] Error writing log:', e.message);
  }
}


// Insertar tareas por defecto
const cronTasks = [
  { task_name: 'generar_facturas', enabled: 1, hour: 6, minute: 0 },
  { task_name: 'suspension', enabled: 0, hour: 8, minute: 0 },
  { task_name: 'recordatorios', enabled: 0, hour: 10, minute: 0 },
  { task_name: 'backup', enabled: 1, hour: 23, minute: 0 },
  { task_name: 'monitoreo', enabled: 0, hour: 0, minute: 30 },
  { task_name: 'expirar_promesas', enabled: 0, hour: 6, minute: 0 }
];
for (const t of cronTasks) {
  try {
    db.prepare('INSERT OR IGNORE INTO cron_tasks (task_name, enabled, hour, minute) VALUES (?, ?, ?, ?)').run(t.task_name, t.enabled, t.hour, t.minute);
  } catch(e) {}
}

// ============================================================
// MONITORING MODULE TABLES
// ============================================================
db.exec(`
CREATE TABLE IF NOT EXISTS mon_ping_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  ip TEXT NOT NULL,
  es_default INTEGER DEFAULT 0,
  notify_phones TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS mon_ping_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id INTEGER NOT NULL,
  rtt_ms REAL,
  success INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (target_id) REFERENCES mon_ping_targets(id) ON DELETE CASCADE
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS mon_alerta_wa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telefono TEXT DEFAULT '',
  activo INTEGER DEFAULT 0,
  canal TEXT DEFAULT 'whatsapp',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS mon_alerta_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id INTEGER,
  target_nombre TEXT,
  tipo TEXT DEFAULT 'corte',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS mon_device_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  router_id INTEGER NOT NULL,
  status TEXT DEFAULT 'unknown',
  latency_ms REAL,
  uptime TEXT DEFAULT '',
  last_check DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
);
`);

try { db.exec('CREATE INDEX IF NOT EXISTS idx_mon_ping_targets_created ON mon_ping_data(created_at)'); } catch(e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_mon_ping_data_target ON mon_ping_data(target_id, created_at)'); } catch(e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_mon_alerta_log_created ON mon_alerta_log(created_at)'); } catch(e) {}

// Create vpn_servers table if not exists
db.exec(`
CREATE TABLE IF NOT EXISTS vpn_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  local_ip TEXT,
  remote_ip TEXT,
  listen_port INTEGER DEFAULT 4443,
  username TEXT,
  password TEXT,
  status TEXT DEFAULT 'stopped',
  live_status TEXT DEFAULT '',
  config_data TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

try { db.exec('CREATE INDEX IF NOT EXISTS idx_vpn_servers_name ON vpn_servers(name)'); } catch(e) {}

// Ensure at least default Google DNS ping target exists
var _defaultPing = db.prepare('SELECT id FROM mon_ping_targets WHERE es_default=1').get();
if (!_defaultPing) {
  try {
    db.prepare('INSERT INTO mon_ping_targets (nombre, ip, es_default) VALUES (?, ?, 1)').run('Google DNS', '8.8.8.8');
  } catch(e) {}
}

// Ensure alert config row exists
var _alertCfg = db.prepare('SELECT id FROM mon_alerta_wa WHERE id=1').get();
if (!_alertCfg) {
  try {
    db.prepare('INSERT INTO mon_alerta_wa (id, telefono, activo) VALUES (1, \'\', 0)').run();
  } catch(e) {}
}
try { db.exec("CREATE TABLE IF NOT EXISTS routers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, ip TEXT NOT NULL, port INTEGER DEFAULT 8728, user TEXT, password TEXT, ip_blocks DEFAULT '[]', connected INTEGER DEFAULT 0, last_sync TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, interface_wan TEXT DEFAULT 'ether1', auth_type TEXT DEFAULT 'dhcp')"); } catch(e) {}
// Router column migrations
try { db.exec("ALTER TABLE routers ADD COLUMN connection_type TEXT DEFAULT 'ip'"); } catch(e) {}
try { db.exec("ALTER TABLE routers ADD COLUMN vpn_user TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE routers ADD COLUMN vpn_password TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE routers ADD COLUMN vpn_ip TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE routers ADD COLUMN version TEXT DEFAULT 'RouterOS v7'"); } catch(e) {}
try { db.exec("ALTER TABLE routers ADD COLUMN ipv6_pd TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE routers ADD COLUMN suspend_ips INTEGER DEFAULT 0"); } catch(e) {}

// Migration: Add payment_day to billing_cycles if not exists
try { db.exec("ALTER TABLE billing_cycles ADD COLUMN payment_day INTEGER DEFAULT 30"); } catch(e) {}

module.exports = db;
module.exports.logActivity = logActivity;

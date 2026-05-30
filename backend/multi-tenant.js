const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

const MASTER_DB_PATH = path.join(__dirname, '..', 'data', 'master.db');
const DATA_DIR = path.join(__dirname, '..', 'data');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

function getMasterDb() {
  const db = new Database(MASTER_DB_PATH);
  db.pragma('journal_mode = WAL');
  return db;
}

function createCompany(data) {
  const { company_name, owner_name, email, username, password, email_token } = data;
  const master = getMasterDb();
  
  try {
    // Check if email or username already exists
    const existing = master.prepare('SELECT id FROM companies WHERE email=? OR username=?').get(email, username);
    if (existing) {
      master.close();
      return { success: false, msg: 'El email o usuario ya está registrado' };
    }

    const hash = bcrypt.hashSync(password, 10);
    const dbName = `tenant_${Date.now()}.db`;
    const dbPath = path.join(DATA_DIR, dbName);
    
    // Create tenant database
    const tenantDb = new Database(dbPath);
    tenantDb.pragma('journal_mode = WAL');
    tenantDb.pragma('foreign_keys = ON');
    
    // Run schema
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    tenantDb.exec(schema);
    
    // Create default admin user in tenant
    const adminHash = bcrypt.hashSync(password, 10);
    tenantDb.prepare("INSERT INTO usuarios (username, password, nombre, rol) VALUES (?, ?, ?, 'admin')").run(username, adminHash, owner_name);
    
    // Set company name
    tenantDb.prepare("INSERT OR REPLACE INTO configuracion (key, value) VALUES ('empresa_nombre', ?)").run(company_name);
    
    // Create additional tables needed for full app functionality
    tenantDb.exec("CREATE TABLE IF NOT EXISTS routers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, ip TEXT NOT NULL, port INTEGER DEFAULT 8728, user TEXT, password TEXT, ip_blocks TEXT DEFAULT '[]', connected INTEGER DEFAULT 0, last_sync TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, interface_wan TEXT DEFAULT 'ether1', auth_type TEXT DEFAULT 'dhcp')");
    tenantDb.exec("CREATE TABLE IF NOT EXISTS ip_pools (id INTEGER PRIMARY KEY AUTOINCREMENT, router_id INTEGER NOT NULL, red TEXT NOT NULL, gateway TEXT, tipo TEXT DEFAULT 'privada', total INTEGER DEFAULT 0, disponibles INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE)");
    tenantDb.exec("CREATE TABLE IF NOT EXISTS ips_asignadas (id INTEGER PRIMARY KEY AUTOINCREMENT, pool_id INTEGER, ip TEXT, servicio_id INTEGER, cliente_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
    tenantDb.exec("CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_nombre TEXT DEFAULT '', usuario_id INTEGER, accion TEXT NOT NULL, modulo TEXT NOT NULL, cliente_id INTEGER, cliente_nombre TEXT DEFAULT '', servicio_id INTEGER, detalle TEXT DEFAULT '', ip_address TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
    tenantDb.exec('CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at)');
    tenantDb.exec('CREATE INDEX IF NOT EXISTS idx_logs_modulo ON logs(modulo)');
    tenantDb.exec('CREATE INDEX IF NOT EXISTS idx_logs_usuario ON logs(usuario_nombre)');
    tenantDb.exec("CREATE TABLE IF NOT EXISTS mensajes (id INTEGER PRIMARY KEY AUTOINCREMENT, cliente_id INTEGER NOT NULL, tipo TEXT NOT NULL DEFAULT 'nota', mensaje TEXT NOT NULL, enviado_por INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE)");
    tenantDb.exec("CREATE TABLE IF NOT EXISTS cron_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, task_name TEXT NOT NULL UNIQUE, enabled INTEGER DEFAULT 0, hour INTEGER DEFAULT 6, minute INTEGER DEFAULT 0, last_run DATETIME, last_status TEXT DEFAULT 'never', last_output TEXT)");
    tenantDb.exec("CREATE TABLE IF NOT EXISTS message_gateways (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, url TEXT, method TEXT DEFAULT 'POST', parameters TEXT, token TEXT, channel TEXT DEFAULT 'sms', is_active INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
    tenantDb.exec("CREATE TABLE IF NOT EXISTS message_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, gateway_id INTEGER, channel TEXT, phone TEXT, message TEXT, status TEXT, response TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
    tenantDb.exec("CREATE TABLE IF NOT EXISTS message_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, message TEXT, status TEXT DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
    tenantDb.exec("CREATE TABLE IF NOT EXISTS mon_ping_targets (id INTEGER PRIMARY KEY AUTOINCREMENT, router_id INTEGER, name TEXT, ip TEXT, enabled INTEGER DEFAULT 1, last_ping REAL, last_status TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
    tenantDb.exec("CREATE TABLE IF NOT EXISTS mon_ping_data (id INTEGER PRIMARY KEY AUTOINCREMENT, target_id INTEGER, latency REAL, success INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
    tenantDb.exec("CREATE TABLE IF NOT EXISTS mon_alerta_wa (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, phone TEXT, enabled INTEGER DEFAULT 0, min_latency REAL DEFAULT 0, max_latency REAL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
    tenantDb.exec("CREATE TABLE IF NOT EXISTS mon_alerta_log (id INTEGER PRIMARY KEY AUTOINCREMENT, target_id INTEGER, type TEXT, message TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
    tenantDb.exec("CREATE TABLE IF NOT EXISTS mon_device_status (id INTEGER PRIMARY KEY AUTOINCREMENT, router_id INTEGER, cpu REAL, memory REAL, uptime TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
    tenantDb.exec("CREATE TABLE IF NOT EXISTS vpn_servers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, server_ip TEXT, port INTEGER DEFAULT 1194, protocol TEXT DEFAULT 'udp', enabled INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
    tenantDb.exec("CREATE TABLE IF NOT EXISTS wan_traffic (id INTEGER PRIMARY KEY AUTOINCREMENT, router_id INTEGER, interface_name TEXT, bytes_in REAL, bytes_out REAL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
    tenantDb.exec("CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, session TEXT, expires DATETIME)");
    
    // Insert cron tasks
    tenantDb.exec("INSERT OR IGNORE INTO cron_tasks (task_name, enabled, hour, minute) VALUES ('generar_facturas', 1, 6, 0)");
    tenantDb.exec("INSERT OR IGNORE INTO cron_tasks (task_name, enabled, hour, minute) VALUES ('suspension', 0, 8, 0)");
    tenantDb.exec("INSERT OR IGNORE INTO cron_tasks (task_name, enabled, hour, minute) VALUES ('recordatorios', 0, 10, 0)");
    tenantDb.exec("INSERT OR IGNORE INTO cron_tasks (task_name, enabled, hour, minute) VALUES ('backup', 1, 23, 0)");
    tenantDb.exec("INSERT OR IGNORE INTO cron_tasks (task_name, enabled, hour, minute) VALUES ('monitoreo', 0, 0, 30)");
    tenantDb.exec("INSERT OR IGNORE INTO cron_tasks (task_name, enabled, hour, minute) VALUES ('expirar_promesas', 0, 6, 0)");
    
    tenantDb.close();
    
    // Apply all migrations to the new tenant DB
    try {
      const { migrateTenantDb } = require('../scripts/migrate-tenant-db');
      migrateTenantDb(dbPath);
    } catch(e) {
      console.log('[MultiTenant] Migration error:', e.message);
    }
    
    // Register in master DB
    master.prepare("INSERT INTO companies (company_name, owner_name, email, username, password, db_path, email_token) VALUES (?,?,?,?,?,?,?)").run(company_name, owner_name, email, username, hash, dbName, email_token);
    
    const companyId = master.prepare("SELECT id FROM companies WHERE email=?").get(email).id;
    master.close();
    
    return { success: true, id: companyId, db_path: dbName };
  } catch(e) {
    master.close();
    return { success: false, msg: e.message };
  }
}

function getCompanyByEmail(email) {
  const master = getMasterDb();
  const company = master.prepare('SELECT * FROM companies WHERE email=?').get(email);
  master.close();
  return company;
}

function getCompanyByUsername(username) {
  const master = getMasterDb();
  const company = master.prepare('SELECT * FROM companies WHERE username=?').get(username);
  master.close();
  return company;
}

function getCompanyById(id) {
  const master = getMasterDb();
  const company = master.prepare('SELECT * FROM companies WHERE id=?').get(id);
  master.close();
  return company;
}

function verifyEmail(token) {
  const master = getMasterDb();
  const company = master.prepare('SELECT * FROM companies WHERE email_token=?').get(token);
  if (!company) {
    master.close();
    return { success: false, msg: 'Token inválido' };
  }
  master.prepare("UPDATE companies SET email_verified=1, email_token=NULL WHERE id=?").run(company.id);
  master.close();
  return { success: true, company_name: company.company_name };
}

function authenticate(username, password) {
  const company = getCompanyByUsername(username);
  if (!company) return { success: false, msg: 'Usuario no encontrado' };
  if (!company.email_verified) return { success: false, msg: 'Email no verificado. Revise su correo.' };
  if (!company.license_active) return { success: false, msg: 'Licencia inactiva. Contacte al administrador.' };
  
  const match = bcrypt.compareSync(password, company.password);
  if (!match) return { success: false, msg: 'Contraseña incorrecta' };
  
  return { success: true, company };
}

function getTenantDb(dbName) {
  const dbPath = path.join(DATA_DIR, dbName);
  if (!fs.existsSync(dbPath)) return null;
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  
  // Run migrations on the tenant DB
  try {
    var migrationPath = path.join(__dirname, '..', 'scripts', 'migrate-tenant-db.js');
    if (fs.existsSync(migrationPath)) {
      const { migrateTenantDb } = require(migrationPath);
      migrateTenantDb(dbPath);
    }
  } catch(e) {
    console.log('[MultiTenant] Migration error:', e.message);
  }
  
  // Re-open since migrateTenantDb closes it
  const db2 = new Database(dbPath);
  db2.pragma('journal_mode = WAL');
  db2.pragma('foreign_keys = ON');
  return db2;
}

function countClients(dbName) {
  try {
    const db = getTenantDb(dbName);
    if (!db) return 0;
    const row = db.prepare('SELECT COUNT(*) as c FROM clientes').get();
    db.close();
    return row ? row.c : 0;
  } catch(e) { return 0; }
}

function updateMaxClients(companyId, newMax) {
  const master = getMasterDb();
  master.prepare('UPDATE companies SET max_clients=? WHERE id=?').run(newMax, companyId);
  master.close();
}

module.exports = {
  createCompany, getCompanyByEmail, getCompanyByUsername, getCompanyById,
  verifyEmail, authenticate, getTenantDb, countClients, updateMaxClients
};

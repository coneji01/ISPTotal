#!/usr/bin/env node
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');
const { execSync } = require('child_process');

const dbPath = path.join(__dirname, '..', 'isptotal.db');
const schemaPath = path.join(__dirname, '..', 'backend', 'schema.sql');

console.log('Creando base de datos demo...');

// Create DB from schema
execSync('cat "' + schemaPath + '" | sqlite3 "' + dbPath + '"', { stdio: 'inherit' });

const db = new Database(dbPath);

// Inicializar master.db (multi-tenant)
const masterPath = path.join(__dirname, '..', 'data', 'master.db');
try {
  const master = new Database(masterPath);
  master.exec("CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY AUTOINCREMENT, company_name TEXT NOT NULL, owner_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL, db_path TEXT, email_token TEXT, email_verified INTEGER DEFAULT 1, license_active INTEGER DEFAULT 1, max_clients INTEGER DEFAULT 100, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
  function ensureCompany(u, n, p, db) {
    const exist = master.prepare('SELECT id FROM companies WHERE username=?').get(u);
    if (!exist) {
      const h = bcrypt.hashSync(p, 10);
      master.prepare('INSERT INTO companies (company_name, owner_name, email, username, password, db_path, email_verified, license_active) VALUES (?,?,?,?,?,?,1,1)').run(n, n, u + '@totalisp.co', u, h, db || 'isptotal.db');
    }
  }
  ensureCompany('admin', 'Administrador', 'admin123', 'isptotal.db');
  ensureCompany('demo1', 'Demo Usuario 1', 'demo1', 'demo1.db');
  ensureCompany('demo2', 'Demo Usuario 2', 'demo2', 'demo2.db');
  ensureCompany('demo3', 'Demo Usuario 3', 'demo3', 'demo3.db');
  master.close();
  console.log('master.db inicializado');
} catch(e) { console.log('master.db:', e.message); }

// Add extra columns needed by the app (migrations)
const migrations = [
  'ALTER TABLE servicios ADD COLUMN direccion TEXT DEFAULT \'\'',
  'ALTER TABLE servicios ADD COLUMN es_gratis INTEGER DEFAULT 0',
  'ALTER TABLE servicios ADD COLUMN no_suspender INTEGER DEFAULT 0',
  'ALTER TABLE servicios ADD COLUMN auth_type TEXT DEFAULT \'dhcp\'',
  'ALTER TABLE servicios ADD COLUMN pppoe_user TEXT DEFAULT \'\'',
  'ALTER TABLE servicios ADD COLUMN pppoe_pass TEXT DEFAULT \'\'',
  'ALTER TABLE servicios ADD COLUMN wifi_ssid TEXT DEFAULT \'\'',
  'ALTER TABLE servicios ADD COLUMN wifi_pass TEXT DEFAULT \'\'',
  'ALTER TABLE servicios ADD COLUMN ciclo_id INTEGER',
  'ALTER TABLE servicios ADD COLUMN notify_invoices INTEGER DEFAULT 1',
  'ALTER TABLE clientes ADD COLUMN notificar_facturas INTEGER DEFAULT 1',
  'ALTER TABLE clientes ADD COLUMN facturar_consolidado INTEGER DEFAULT 0',
  'ALTER TABLE clientes ADD COLUMN comprobante_fiscal TEXT DEFAULT \'ninguno\'',
];
for (const sql of migrations) {
  try { db.exec(sql); } catch(e) { /* column may already exist */ }
}

// Update admin password
const hash = bcrypt.hashSync('admin123', 10);
const existingAdmin = db.prepare('SELECT id FROM usuarios WHERE username=?').get('admin');
if (existingAdmin) {
  db.prepare('UPDATE usuarios SET password=? WHERE username=?').run(hash, 'admin');
} else {
  db.prepare('INSERT INTO usuarios (nombre, username, password, rol) VALUES (?,?,?,?)').run('Administrador', 'admin', hash, 'admin');
}

// Zonas
if (!db.prepare('SELECT id FROM zonas LIMIT 1').get()) {
  db.prepare('INSERT INTO zonas (nombre) VALUES (?)').run('Zona Demo 1');
  db.prepare('INSERT INTO zonas (nombre) VALUES (?)').run('Zona Demo 2');
}

// Planes
if (!db.prepare('SELECT id FROM planes LIMIT 1').get()) {
  db.prepare('INSERT INTO planes (nombre, velocidad, precio) VALUES (?,?,?)').run('Plan Basico 50M', '50M', 1000);
  db.prepare('INSERT INTO planes (nombre, velocidad, precio) VALUES (?,?,?)').run('Plan Estandar 100M', '100M', 1500);
  db.prepare('INSERT INTO planes (nombre, velocidad, precio) VALUES (?,?,?)').run('Plan Premium 200M', '200M', 2500);
}

// Crear DBs individuales para demo users (si no existen)
const demos = ['demo1', 'demo2', 'demo3'];
for (const du of demos) {
  const demoDbPath = path.join(__dirname, '..', 'data', du + '.db');
  if (!fs.existsSync(demoDbPath)) {
    execSync('cat "' + schemaPath + '" | sqlite3 "' + demoDbPath + '"', { stdio: 'inherit' });
    const ddb = new Database(demoDbPath);
    const dmigs = [
      "ALTER TABLE servicios ADD COLUMN direccion TEXT DEFAULT ''",
      "ALTER TABLE servicios ADD COLUMN es_gratis INTEGER DEFAULT 0",
      "ALTER TABLE olts ADD COLUMN activo INTEGER DEFAULT 1",
      "ALTER TABLE servicios ADD COLUMN auth_type TEXT DEFAULT 'dhcp'",
      "ALTER TABLE servicios ADD COLUMN ciclo_id INTEGER",
      "ALTER TABLE servicios ADD COLUMN notify_invoices INTEGER DEFAULT 1",
      "ALTER TABLE clientes ADD COLUMN notificar_facturas INTEGER DEFAULT 1",
      "ALTER TABLE clientes ADD COLUMN facturar_consolidado INTEGER DEFAULT 0",
      "ALTER TABLE clientes ADD COLUMN comprobante_fiscal TEXT DEFAULT 'ninguno'",
    ];
    for (const s of dmigs) { try { ddb.exec(s); } catch(e) {} }
    const dh = bcrypt.hashSync(du, 10);
    ddb.prepare("INSERT INTO usuarios (nombre, username, password, rol) VALUES (?,?,?,?)").run('Demo ' + du, du, dh, 'admin');
    ddb.prepare("INSERT OR REPLACE INTO configuracion (key, value) VALUES (?,'Demo ISP')").run('empresa_nombre');
    ddb.prepare("INSERT OR REPLACE INTO configuracion (key, value) VALUES (?,'RD$')").run('moneda');
    ddb.prepare("INSERT OR REPLACE INTO configuracion (key, value) VALUES (?,'claro')").run('theme');
    try { ddb.prepare("INSERT INTO zonas (nombre) VALUES ('Zona Principal')").run(); } catch(e) {}
    try { ddb.prepare("INSERT INTO planes (nombre, velocidad, precio) VALUES ('Plan Basico 50M','50M',1000)").run(); } catch(e) {}
    try { ddb.prepare("INSERT INTO planes (nombre, velocidad, precio) VALUES ('Plan Estandar 100M','100M',1500)").run(); } catch(e) {}
    ddb.close();
    console.log('DB individual creada: ' + du + '.db');
  }
}

// Config
if (!db.prepare("SELECT key FROM configuracion WHERE key='empresa_nombre'").get()) {
  db.prepare('INSERT INTO configuracion (key, value) VALUES (?,?)').run('empresa_nombre', 'ISP Total Demo');
  db.prepare('INSERT INTO configuracion (key, value) VALUES (?,?)').run('moneda', 'RD$');
  db.prepare('INSERT INTO configuracion (key, value) VALUES (?,?)').run('theme', 'claro');
}

db.close();
console.log('Base de datos demo creada');

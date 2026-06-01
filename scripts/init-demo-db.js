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

// Config
if (!db.prepare("SELECT key FROM configuracion WHERE key='empresa_nombre'").get()) {
  db.prepare('INSERT INTO configuracion (key, value) VALUES (?,?)').run('empresa_nombre', 'ISP Total Demo');
  db.prepare('INSERT INTO configuracion (key, value) VALUES (?,?)').run('moneda', 'RD$');
  db.prepare('INSERT INTO configuracion (key, value) VALUES (?,?)').run('theme', 'claro');
}

db.close();
console.log('Base de datos demo creada');

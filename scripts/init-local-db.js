#!/usr/bin/env node
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'isptotal.db');
const schemaPath = path.join(__dirname, '..', 'backend', 'schema.sql');

console.log('Creando base de datos...');

// Si ya existe la borramos para fresh start
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

const schema = fs.readFileSync(schemaPath, 'utf-8');
const db = new Database(dbPath);
db.exec(schema);

// Config empresa
db.prepare("INSERT OR REPLACE INTO configuracion (key, value) VALUES ('empresa_nombre', 'ISPTotal Demo')").run();

// Crear plan basico
db.prepare("INSERT INTO planes (nombre, velocidad, precio) VALUES (?, ?, ?)").run('Plan Básico 10MB', '10 Mbps', 800);
db.prepare("INSERT INTO planes (nombre, velocidad, precio) VALUES (?, ?, ?)").run('Plan Estándar 25MB', '25 Mbps', 1200);
db.prepare("INSERT INTO planes (nombre, velocidad, precio) VALUES (?, ?, ?)").run('Plan Premium 50MB', '50 Mbps', 1800);

// Config de facturacion
db.prepare("INSERT INTO billing_cycles (billing_type, invoice_day, suspend_day, is_default, name) VALUES ('postpago', 25, 11, 1, 'Ciclo Mensual')").run();

db.close();

// Master DB
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const masterPath = path.join(dataDir, 'master.db');
const master = new Database(masterPath);
master.exec("CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY AUTOINCREMENT, company_name TEXT NOT NULL, owner_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL, db_path TEXT, email_token TEXT, email_verified INTEGER DEFAULT 1, license_active INTEGER DEFAULT 1, max_clients INTEGER DEFAULT 100, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
const h = bcrypt.hashSync('admin123', 10);
master.prepare('INSERT INTO companies (company_name, owner_name, email, username, password, db_path, email_verified, license_active) VALUES (?,?,?,?,?,?,1,1)').run('ISPTotal Demo', 'Administrador', 'admin@totalisp.co', 'admin', h, 'isptotal.db');
master.close();

console.log('Base de datos creada exitosamente.');
console.log('Usuario: admin');
console.log('Contraseña: admin123');

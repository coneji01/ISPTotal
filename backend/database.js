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
try { db.exec("ALTER TABLE clientes ADD COLUMN notificar_facturas INTEGER DEFAULT 1"); } catch(e) {}
try { db.exec("ALTER TABLE clientes ADD COLUMN facturar_consolidado INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE clientes ADD COLUMN comprobante_fiscal TEXT DEFAULT 'ninguno'"); } catch(e) {}
try { db.exec("ALTER TABLE onu ADD COLUMN caja_nap_id INTEGER REFERENCES cajas_nap(id)"); } catch(e) {}
try { db.exec("ALTER TABLE onu ADD COLUMN puerto_caja INTEGER"); } catch(e) {}
try { db.exec("ALTER TABLE promesas_pago ADD COLUMN created_by_name TEXT"); } catch(e) {}

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

// Insertar tareas por defecto
const cronTasks = [
  { task_name: 'generar_facturas', enabled: 1, hour: 6, minute: 0 },
  { task_name: 'suspension', enabled: 0, hour: 8, minute: 0 },
  { task_name: 'recordatorios', enabled: 0, hour: 10, minute: 0 },
  { task_name: 'backup', enabled: 1, hour: 23, minute: 0 },
  { task_name: 'monitoreo', enabled: 0, hour: 0, minute: 30 }
];
for (const t of cronTasks) {
  try {
    db.prepare('INSERT OR IGNORE INTO cron_tasks (task_name, enabled, hour, minute) VALUES (?, ?, ?, ?)').run(t.task_name, t.enabled, t.hour, t.minute);
  } catch(e) {}
}

module.exports = db;

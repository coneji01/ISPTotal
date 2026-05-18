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
try { db.exec("ALTER TABLE onu ADD COLUMN caja_nap_id INTEGER REFERENCES cajas_nap(id)"); } catch(e) {}
try { db.exec("ALTER TABLE onu ADD COLUMN puerto_caja INTEGER"); } catch(e) {}

module.exports = db;

// Migration script for tenant databases
// Adds missing columns that exist in the main DB but not in schema.sql
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

function migrateTenantDb(dbPath) {
  if (!fs.existsSync(dbPath)) {
    console.log('[Migrate] DB not found:', dbPath);
    return;
  }
  
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  
  const migrations = [
    // === OLTS ===
    "ALTER TABLE olts ADD COLUMN smartolt_subdomain TEXT",
    "ALTER TABLE olts ADD COLUMN smartolt_api_key TEXT",
    "ALTER TABLE olts ADD COLUMN smartolt_enabled INTEGER DEFAULT 0",
    "ALTER TABLE olts ADD COLUMN tipo TEXT DEFAULT 'smartolt'",
    "ALTER TABLE olts ADD COLUMN smartolt_olt_id TEXT",
    "ALTER TABLE olts ADD COLUMN vlan_default TEXT DEFAULT ''",
    "ALTER TABLE olts ADD COLUMN tr069_vlan TEXT DEFAULT ''",
    "ALTER TABLE olts ADD COLUMN tr069_profile TEXT DEFAULT 'SmartOLT'",
    
    // === ONU ===
    "ALTER TABLE onu ADD COLUMN caja_nap_id INTEGER REFERENCES cajas_nap(id)",
    "ALTER TABLE onu ADD COLUMN puerto_caja INTEGER",
    "ALTER TABLE onu ADD COLUMN smartolt_subdomain TEXT",
    "ALTER TABLE onu ADD COLUMN smartolt_api_key TEXT",
    
    // === CLIENTES ===
    "ALTER TABLE clientes ADD COLUMN notificar_facturas INTEGER DEFAULT 1",
    "ALTER TABLE clientes ADD COLUMN facturar_consolidado INTEGER DEFAULT 0",
    "ALTER TABLE clientes ADD COLUMN comprobante_fiscal TEXT DEFAULT 'ninguno'",
    
    // === SERVICIOS ===
    "ALTER TABLE servicios ADD COLUMN es_gratis INTEGER DEFAULT 0",
    "ALTER TABLE servicios ADD COLUMN no_suspender INTEGER DEFAULT 0",
    "ALTER TABLE servicios ADD COLUMN descuento_monto REAL DEFAULT 0",
    "ALTER TABLE servicios ADD COLUMN fecha_retiro DATETIME",
    "ALTER TABLE servicios ADD COLUMN motivo_retiro TEXT",
    "ALTER TABLE servicios ADD COLUMN auth_type TEXT DEFAULT 'dhcp'",
    "ALTER TABLE servicios ADD COLUMN pppoe_user TEXT DEFAULT ''",
    "ALTER TABLE servicios ADD COLUMN pppoe_pass TEXT DEFAULT ''",
    "ALTER TABLE servicios ADD COLUMN wifi_ssid TEXT DEFAULT ''",
    "ALTER TABLE servicios ADD COLUMN wifi_pass TEXT DEFAULT ''",
    "ALTER TABLE servicios ADD COLUMN direccion TEXT DEFAULT ''",
    "ALTER TABLE servicios ADD COLUMN tipo_servicio TEXT DEFAULT 'internet'",
    "ALTER TABLE servicios ADD COLUMN ciclo_id INTEGER",
    "ALTER TABLE servicios ADD COLUMN observaciones TEXT DEFAULT ''",
    "ALTER TABLE servicios ADD COLUMN router_id INTEGER",
    "ALTER TABLE servicios ADD COLUMN netflix_email TEXT DEFAULT ''",
    "ALTER TABLE servicios ADD COLUMN netflix_password TEXT DEFAULT ''",
    "ALTER TABLE servicios ADD COLUMN netflix_perfil TEXT DEFAULT ''",
    "ALTER TABLE servicios ADD COLUMN netflix_vencimiento DATETIME",
    "ALTER TABLE servicios ADD COLUMN descripcion_servicio TEXT DEFAULT ''",
    "ALTER TABLE servicios ADD COLUMN precio_servicio REAL DEFAULT 0",
    
    // === PLANES ===
    "ALTER TABLE planes ADD COLUMN velocidad_subida TEXT",
    "ALTER TABLE planes ADD COLUMN velocidad_bajada TEXT",
    "ALTER TABLE planes ADD COLUMN upload_burst TEXT",
    "ALTER TABLE planes ADD COLUMN download_burst TEXT",
    "ALTER TABLE planes ADD COLUMN burst_threshold_up TEXT",
    "ALTER TABLE planes ADD COLUMN burst_threshold_down TEXT",
    "ALTER TABLE planes ADD COLUMN perfil_mikrotik TEXT",
    "ALTER TABLE planes ADD COLUMN perfil_olt_descarga TEXT",
    "ALTER TABLE planes ADD COLUMN perfil_olt_subida TEXT",
    "ALTER TABLE planes ADD COLUMN zonas TEXT DEFAULT 'all'",
    "ALTER TABLE planes ADD COLUMN disponible INTEGER DEFAULT 1",
    
    // === EMPLEADOS ===
    "ALTER TABLE empleados ADD COLUMN tipo_otro TEXT",
    "ALTER TABLE empleados ADD COLUMN usuario_id INTEGER REFERENCES usuarios(id)",
    
    // === BILLING_CYCLES ===
    "ALTER TABLE billing_cycles ADD COLUMN payment_day INTEGER",
    
    // === PROMESAS_PAGO ===
    "ALTER TABLE promesas_pago ADD COLUMN servicio_ids TEXT",
    "ALTER TABLE promesas_pago ADD COLUMN created_by_name TEXT",
    
    // === PROVEEDORES ===
    "ALTER TABLE proveedores ADD COLUMN telefono TEXT",
    
    // === INVENTARIO ===
    "ALTER TABLE inventario ADD COLUMN oficina TEXT",
    "ALTER TABLE inventario ADD COLUMN serial TEXT",
    "ALTER TABLE inventario ADD COLUMN asignado_a TEXT",
    "ALTER TABLE inventario ADD COLUMN asignado_uso TEXT",
    "ALTER TABLE inventario ADD COLUMN asignado_cliente TEXT",
    "ALTER TABLE inventario ADD COLUMN fecha_asignacion DATETIME",
    "ALTER TABLE inventario ADD COLUMN precio_venta REAL DEFAULT 0",
    "ALTER TABLE inventario ADD COLUMN asignado_oficina TEXT",
    "ALTER TABLE inventario ADD COLUMN razon_devolucion TEXT",
    "ALTER TABLE inventario ADD COLUMN tipo_falla TEXT",
    "ALTER TABLE inventario ADD COLUMN cliente_lugar TEXT",
    "ALTER TABLE inventario ADD COLUMN fecha_devolucion DATETIME",
    
    // === INVENTARIO_MOVIMIENTOS ===
    "ALTER TABLE inventario_movimientos ADD COLUMN detalle TEXT",
    "ALTER TABLE inventario_movimientos ADD COLUMN tecnico_nombre TEXT",
    "ALTER TABLE inventario_movimientos ADD COLUMN cliente_servicio TEXT",
    "ALTER TABLE inventario_movimientos ADD COLUMN oficina_destino TEXT",
  ];
  
  let applied = 0;
  for (const sql of migrations) {
    try {
      db.exec(sql);
      const tableName = sql.match(/ALTER TABLE (\w+)/)[1];
      console.log('[Migrate] ' + tableName + ': ' + sql.match(/ADD COLUMN (\w+)/)[1]);
      applied++;
    } catch(e) {
      // Column already exists - expected
    }
  }
  
  // Create additional tables if they don't exist
  const extraTables = [
    "CREATE TABLE IF NOT EXISTS routers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, ip TEXT NOT NULL, port INTEGER DEFAULT 8728, user TEXT, password TEXT, ip_blocks TEXT DEFAULT '[]', connected INTEGER DEFAULT 0, last_sync TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, interface_wan TEXT DEFAULT 'ether1', auth_type TEXT DEFAULT 'dhcp')",
    "CREATE TABLE IF NOT EXISTS ip_pools (id INTEGER PRIMARY KEY AUTOINCREMENT, router_id INTEGER NOT NULL, red TEXT NOT NULL, gateway TEXT, tipo TEXT DEFAULT 'privada', total INTEGER DEFAULT 0, disponibles INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE)",
    "CREATE TABLE IF NOT EXISTS ips_asignadas (id INTEGER PRIMARY KEY AUTOINCREMENT, pool_id INTEGER, ip TEXT, servicio_id INTEGER, cliente_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS message_gateways (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, url TEXT, method TEXT DEFAULT 'POST', parameters TEXT, token TEXT, channel TEXT DEFAULT 'sms', is_active INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS message_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, gateway_id INTEGER, channel TEXT, phone TEXT, message TEXT, status TEXT, response TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS message_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, message TEXT, status TEXT DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS mon_ping_targets (id INTEGER PRIMARY KEY AUTOINCREMENT, router_id INTEGER, name TEXT, ip TEXT, enabled INTEGER DEFAULT 1, last_ping REAL, last_status TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS mon_ping_data (id INTEGER PRIMARY KEY AUTOINCREMENT, target_id INTEGER, latency REAL, success INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS mon_alerta_wa (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, phone TEXT, enabled INTEGER DEFAULT 0, min_latency REAL DEFAULT 0, max_latency REAL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS mon_alerta_log (id INTEGER PRIMARY KEY AUTOINCREMENT, target_id INTEGER, type TEXT, message TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS mon_device_status (id INTEGER PRIMARY KEY AUTOINCREMENT, router_id INTEGER, cpu REAL, memory REAL, uptime TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS vpn_servers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, server_ip TEXT, port INTEGER DEFAULT 1194, protocol TEXT DEFAULT 'udp', enabled INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS wan_traffic (id INTEGER PRIMARY KEY AUTOINCREMENT, router_id INTEGER, interface_name TEXT, bytes_in REAL, bytes_out REAL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
  ];
  
  for (const sql of extraTables) {
    try {
      db.exec(sql);
    } catch(e) {
      console.log('[Migrate] Error creating table:', e.message);
    }
  }
  
  db.close();
  console.log('[Migrate] Done. Applied ' + applied + ' column migrations.');
  return applied;
}

// If run directly, migrate all tenant DBs in data folder
if (require.main === module) {
  const dataDir = path.join(__dirname, '..', 'data');
  if (fs.existsSync(dataDir)) {
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.db') && f.startsWith('tenant_'));
    console.log('[Migrate] Found ' + files.length + ' tenant databases');
    for (const file of files) {
      console.log('[Migrate] Processing:', file);
      migrateTenantDb(path.join(dataDir, file));
    }
  }
}

module.exports = { migrateTenantDb };

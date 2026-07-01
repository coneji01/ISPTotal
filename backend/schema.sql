CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  nombre TEXT,
  telefono TEXT,
  correo TEXT,
  rol TEXT DEFAULT 'admin',
  activo INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS zonas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT UNIQUE NOT NULL,
  router_id INTEGER,
  vlan_onu INTEGER,
  smartolt_profile_id INTEGER,
  smartolt_zone TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS planes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  velocidad TEXT,
  precio REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- VLANs del sistema
CREATE TABLE IF NOT EXISTS vlan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    olt_id INTEGER NOT NULL DEFAULT 1,
    nombre TEXT NOT NULL,
    vlan_id INTEGER NOT NULL,
    descripcion TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (olt_id) REFERENCES olts(id)
);

CREATE TABLE IF NOT EXISTS uplink_ports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    olt_id INTEGER NOT NULL DEFAULT 1,
    interface TEXT NOT NULL,
    nombre TEXT DEFAULT '',
    velocidad TEXT DEFAULT '10G',
    estado TEXT DEFAULT 'up',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (olt_id) REFERENCES olts(id)
);

CREATE TABLE IF NOT EXISTS vlan_uplink (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vlan_id INTEGER NOT NULL,
    uplink_port_id INTEGER NOT NULL,
    tagged INTEGER DEFAULT 1,
    FOREIGN KEY (vlan_id) REFERENCES vlan(id) ON DELETE CASCADE,
    FOREIGN KEY (uplink_port_id) REFERENCES uplink_ports(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS speed_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    olt_id INTEGER NOT NULL DEFAULT 1,
    nombre TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'up',
    velocidad TEXT NOT NULL,
    descripcion TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS onu_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    olt_id INTEGER NOT NULL DEFAULT 1,
    nombre TEXT NOT NULL,
    sn_prefix TEXT NOT NULL,
    descripcion TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  cedula TEXT UNIQUE,
  telefono TEXT,
  telefono2 TEXT,
  direccion TEXT,
  apodo TEXT,
  zona_id INTEGER,
  lat REAL,
  lng REAL,
  estado TEXT DEFAULT 'activo',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (zona_id) REFERENCES zonas(id)
);

CREATE TABLE IF NOT EXISTS servicios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL,
  plan_id INTEGER,
  zona_id INTEGER,
  ip TEXT,
  estado TEXT DEFAULT 'activo',
  fecha_activacion DATE,
  fecha_suspension DATE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  es_gratis INTEGER DEFAULT 0,
  no_suspender INTEGER DEFAULT 0,
  descuento_monto REAL DEFAULT 0,
  fecha_retiro DATETIME,
  motivo_retiro TEXT,
  ciclo_id INTEGER DEFAULT 1,
  direccion TEXT,
  auth_type TEXT DEFAULT 'dhcp',
  pppoe_user TEXT,
  pppoe_pass TEXT,
  wifi_ssid TEXT DEFAULT '',
  wifi_pass TEXT DEFAULT '',
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES planes(id),
  FOREIGN KEY (zona_id) REFERENCES zonas(id)
);

CREATE TABLE IF NOT EXISTS billing_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  billing_type TEXT DEFAULT 'postpago',
  invoice_day INTEGER DEFAULT 25,
  suspend_day INTEGER DEFAULT 11,
  tolerance_months INTEGER DEFAULT 1,
  suspend_weekends INTEGER DEFAULT 0,
  notify_day_1 INTEGER DEFAULT 0,
  notify_day_2 INTEGER DEFAULT 0,
  notify_day_3 INTEGER DEFAULT 0,
  reconnection_fee_active INTEGER DEFAULT 0,
  reconnection_amount REAL DEFAULT 0,
  invoice_suspended INTEGER DEFAULT 0,
  prorate_first_invoice INTEGER DEFAULT 1,
  grace_days INTEGER DEFAULT 0,
  notify_on_suspend INTEGER DEFAULT 0,
  notify_on_payment INTEGER DEFAULT 0,
  payment_day INTEGER DEFAULT 30,
  is_default INTEGER DEFAULT 0,
  name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS facturas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  servicio_id INTEGER NOT NULL,
  periodo TEXT,
  monto REAL,
  estado TEXT DEFAULT 'pendiente',
  fecha_emision DATE,
  fecha_vencimiento DATE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (servicio_id) REFERENCES servicios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pagos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  factura_id INTEGER,
  servicio_id INTEGER,
  cliente_id INTEGER,
  monto REAL,
  metodo TEXT,
  transaccion TEXT,
  recibo INTEGER DEFAULT 1,
  activar INTEGER DEFAULT 0,
  cuadrado INTEGER DEFAULT 0,
  usuario_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (factura_id) REFERENCES facturas(id),
  FOREIGN KEY (servicio_id) REFERENCES servicios(id),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS promesas_pago (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL,
  servicio_ids TEXT,
  fecha_limite DATE,
  notas TEXT,
  estado TEXT DEFAULT 'activa',
  usuario_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS ordenes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  cliente_id INTEGER,
  servicio_id INTEGER,
  detalle TEXT,
  zona_id INTEGER,
  tecnico_id INTEGER,
  caja_nap_id INTEGER,
  onu_id INTEGER,
  ip TEXT,
  pppoe_user TEXT,
  pppoe_pass TEXT,
  estado TEXT DEFAULT 'pendiente',
  usuario_id INTEGER,
  completada_por INTEGER,
  fecha_completada DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  FOREIGN KEY (servicio_id) REFERENCES servicios(id),
  FOREIGN KEY (zona_id) REFERENCES zonas(id),
  FOREIGN KEY (tecnico_id) REFERENCES empleados(id)
);

CREATE TABLE IF NOT EXISTS cajas_nap (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  puertos INTEGER DEFAULT 8,
  zona_id INTEGER,
  lat REAL,
  lng REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (zona_id) REFERENCES zonas(id)
);

CREATE TABLE IF NOT EXISTS splitters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  puertos INTEGER DEFAULT 16,
  perdida REAL DEFAULT 13.8,
  zona_id INTEGER,
  lat REAL,
  lng REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (zona_id) REFERENCES zonas(id)
);

CREATE TABLE IF NOT EXISTS mangas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  tipo TEXT DEFAULT 'empalme',
  zona_id INTEGER,
  lat REAL,
  lng REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (zona_id) REFERENCES zonas(id)
);

CREATE TABLE IF NOT EXISTS cables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  fibra_count INTEGER DEFAULT 12,
  tipo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cable_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cable_id INTEGER NOT NULL,
  sequence INTEGER DEFAULT 0,
  lat REAL,
  lng REAL,
  element_type TEXT,
  element_id INTEGER,
  fiber_number INTEGER,
  fiber_uid TEXT,
  fiber_seq INTEGER,
  FOREIGN KEY (cable_id) REFERENCES cables(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS onu (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sn TEXT UNIQUE,
  nombre TEXT,
  cliente_id INTEGER,
  olt_id INTEGER,
  puerto_olt INTEGER,
  estado TEXT DEFAULT 'activo',
  senial REAL,
  servicio_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  FOREIGN KEY (servicio_id) REFERENCES servicios(id)
);

CREATE TABLE IF NOT EXISTS olts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  ip TEXT,
  modelo TEXT,
  puertos INTEGER DEFAULT 48,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS olt_ports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  olt_id INTEGER NOT NULL,
  port_number INTEGER NOT NULL,
  estado TEXT DEFAULT 'activo',
  FOREIGN KEY (olt_id) REFERENCES olts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS empleados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  cedula TEXT UNIQUE,
  telefono TEXT,
  tipo TEXT,
  tipo_otro TEXT,
  salario REAL,
  periodo TEXT DEFAULT 'mensual',
  dia_pago1 INTEGER,
  dia_pago2 INTEGER,
  fecha_ingreso DATE,
  usuario_id INTEGER,
  activo INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS prestamos_empleado (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empleado_id INTEGER NOT NULL,
  monto REAL,
  restante REAL,
  descripcion TEXT,
  fecha DATE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inventario (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT UNIQUE,
  nombre TEXT NOT NULL,
  categoria TEXT,
  stock INTEGER DEFAULT 0,
  precio REAL,
  es_venta INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventario_movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventario_id INTEGER NOT NULL,
  tipo TEXT NOT NULL,
  cantidad INTEGER NOT NULL,
  tecnico_id INTEGER,
  cliente_id INTEGER,
  oficina TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (inventario_id) REFERENCES inventario(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS proveedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  rnc TEXT,
  direccion TEXT,
  notas TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS facturas_compra (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proveedor_id INTEGER NOT NULL,
  numero TEXT,
  monto REAL,
  concepto TEXT,
  fecha_emision DATE,
  fecha_vencimiento DATE,
  pagado REAL DEFAULT 0,
  notas TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS proveedores_servicios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proveedor_id INTEGER NOT NULL,
  nombre_servicio TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS proveedores_contactos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proveedor_id INTEGER NOT NULL,
  nombre_contacto TEXT NOT NULL,
  telefono TEXT,
  email TEXT,
  cargo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pagos_compra (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  factura_id INTEGER NOT NULL,
  monto REAL NOT NULL,
  metodo TEXT,
  referencia TEXT,
  notas TEXT,
  fecha_pago DATE DEFAULT (date('now')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (factura_id) REFERENCES facturas_compra(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gastos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  concepto TEXT NOT NULL,
  monto REAL,
  metodo TEXT,
  referencia TEXT,
  categoria TEXT,
  usuario_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS cuadre_caja (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER,
  fecha DATE,
  total_pagos REAL DEFAULT 0,
  total_gastos REAL DEFAULT 0,
  saldo REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS cambio_onu_swaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER,
  servicio_id INTEGER,
  old_sn TEXT,
  new_sn TEXT,
  old_olt_id INTEGER,
  new_olt_id INTEGER,
  pppoe_user TEXT DEFAULT '',
  pppoe_pass TEXT DEFAULT '',
  wifi_ssid_24 TEXT DEFAULT '',
  wifi_pass_24 TEXT DEFAULT '',
  wifi_ssid_5 TEXT DEFAULT '',
  wifi_pass_5 TEXT DEFAULT '',
  vlan TEXT DEFAULT '',
  onu_type TEXT DEFAULT '',
  change_reason TEXT DEFAULT '',
  estado TEXT DEFAULT 'completado',
  created_by INTEGER,
  completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ventas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER,
  cliente_nombre TEXT,
  total REAL NOT NULL DEFAULT 0,
  itbis REAL DEFAULT 0,
  modo TEXT NOT NULL DEFAULT 'contado',
  metodo_pago TEXT DEFAULT 'EFECTIVO',
  nota TEXT,
  usuario_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS ventas_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venta_id INTEGER NOT NULL,
  inventario_id INTEGER NOT NULL,
  cantidad INTEGER NOT NULL DEFAULT 1,
  precio_unitario REAL NOT NULL,
  FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE,
  FOREIGN KEY (inventario_id) REFERENCES inventario(id)
);

CREATE TABLE IF NOT EXISTS configuracion (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_key TEXT UNIQUE NOT NULL,
  template_name TEXT NOT NULL,
  content TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed data
INSERT OR IGNORE INTO configuracion (key, value) VALUES ('version', '1.0.0');
INSERT OR IGNORE INTO configuracion (key, value) VALUES ('empresa_nombre', 'ISP Total');
INSERT OR IGNORE INTO configuracion (key, value) VALUES ('moneda', 'RD$');
INSERT OR IGNORE INTO configuracion (key, value) VALUES ('theme', 'claro');

INSERT OR IGNORE INTO usuarios (username, password, nombre, rol) VALUES ('admin', '$2b$10$8K1p/a0dL1LXMIgoEDFrwOfMQkfAjkMBcGmEGGGGxGGGGGGGGGGGG', 'Administrador', 'admin');

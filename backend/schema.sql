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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS planes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  velocidad TEXT,
  precio REAL,
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
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES planes(id),
  FOREIGN KEY (zona_id) REFERENCES zonas(id)
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
  servicio_id INTEGER,
  fecha_limite DATE,
  notas TEXT,
  estado TEXT DEFAULT 'activa',
  usuario_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  FOREIGN KEY (servicio_id) REFERENCES servicios(id),
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
  salario REAL,
  periodo TEXT DEFAULT 'mensual',
  dia_pago1 INTEGER,
  dia_pago2 INTEGER,
  fecha_ingreso DATE,
  activo INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

CREATE TABLE IF NOT EXISTS configuracion (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Seed data
INSERT OR IGNORE INTO configuracion (key, value) VALUES ('version', '1.0.0');
INSERT OR IGNORE INTO configuracion (key, value) VALUES ('empresa_nombre', 'ISP Total');
INSERT OR IGNORE INTO configuracion (key, value) VALUES ('moneda', 'RD$');
INSERT OR IGNORE INTO configuracion (key, value) VALUES ('theme', 'claro');

INSERT OR IGNORE INTO usuarios (username, password, nombre, rol) VALUES ('admin', '$2b$10$8K1p/a0dL1LXMIgoEDFrwOfMQkfAjkMBcGmEGGGGxGGGGGGGGGGGG', 'Administrador', 'admin');

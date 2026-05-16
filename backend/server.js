const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcrypt');
const db = require('./database');

const app = express();
const PORT = 3020;

// Config
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'isptotal-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Auth middleware
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/');
  next();
}

function renderPage(req, res, page, data = {}) {
  const modulos = [
    { id: 'Dashboard', icon: 'fa-chart-pie', nombre: 'Resumen' },
    { id: 'Clientes', icon: 'fa-users', nombre: 'Clientes' },
    { id: 'NuevoCliente', icon: 'fa-user-plus', nombre: 'Nuevo cliente' },
    { id: 'RegistrarPago', icon: 'fa-money-bill', nombre: 'Registrar pago' },
    { id: 'PromesaDePago', icon: 'fa-handshake', nombre: 'Promesa de pago' },
    { id: 'Ordenes', icon: 'fa-clipboard-list', nombre: 'Órdenes' },
    { id: 'CambioOnu', icon: 'fa-exchange-alt', nombre: 'Cambio de ONU' },
    { id: 'CambioDeTitular', icon: 'fa-user-edit', nombre: 'Cambio de Titular' },
    { id: 'Traslados', icon: 'fa-truck-moving', nombre: 'Traslados' },
    { id: 'Inventario', icon: 'fa-boxes', nombre: 'Inventario' },
    { id: 'Ventas', icon: 'fa-shopping-cart', nombre: 'Ventas' },
    { id: 'Gpon', icon: 'fa-network-wired', nombre: 'GPON' },
    { id: 'CajasNap', icon: 'fa-box', nombre: 'Cajas NAP' },
    { id: 'BuscarOnu', icon: 'fa-search', nombre: 'Buscar ONU' },
    { id: 'Proveedores', icon: 'fa-truck', nombre: 'Proveedores' },
    { id: 'Empleados', icon: 'fa-id-badge', nombre: 'Empleados' },
    { id: 'PagosAdmin', icon: 'fa-coins', nombre: 'Pagos' },
    { id: 'Estadisticas', icon: 'fa-chart-bar', nombre: 'Estadísticas' },
    { id: 'Monitoreo', icon: 'fa-desktop', nombre: 'Monitoreo' },
    { id: 'CuadreCaja', icon: 'fa-cash-register', nombre: 'Cuadre de caja' },
    { id: 'Configuracion', icon: 'fa-cog', nombre: 'Configuración' },
    { id: 'Actualizaciones', icon: 'fa-sync', nombre: 'Actualizaciones' }
  ];
  res.render('layout', { ...data, page, modulos, user: req.session.user });
}

// ======== LOGIN ========
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/modulo?pagina=Dashboard');
  res.render('login');
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM usuarios WHERE username=? AND activo=1').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('login', { error: 'Usuario o contraseña incorrectos' });
  }
  req.session.user = { id: user.id, username: user.username, nombre: user.nombre };
  res.redirect('/modulo?pagina=Dashboard');
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ======== MODULES ========
app.get('/modulo', requireAuth, (req, res) => {
  const pagina = req.query.pagina || 'Dashboard';
  
  // Common data
  const zonas = db.prepare('SELECT * FROM zonas').all();
  const planes = db.prepare('SELECT * FROM planes').all();
  const empleados = db.prepare('SELECT * FROM empleados WHERE activo=1').all();
  const cajasNap = db.prepare('SELECT cn.*, z.nombre as zona_nombre FROM cajas_nap cn LEFT JOIN zonas z ON z.id=cn.zona_id').all();
  const splitters = db.prepare('SELECT * FROM splitters').all();
  const proveedores = db.prepare('SELECT * FROM proveedores').all();
  const inventario = db.prepare('SELECT * FROM inventario ORDER BY nombre').all();
  
  let data = { zonas, planes, empleados, cajasNap, splitters, proveedores, inventario, pagina };
  
  switch(pagina) {
    case 'Dashboard': {
      const servicios = db.prepare('SELECT COUNT(*) as total FROM servicios').get();
      const activos = db.prepare("SELECT COUNT(*) as total FROM servicios WHERE estado='activo'").get();
      const suspendidos = db.prepare("SELECT COUNT(*) as total FROM servicios WHERE estado='suspendido'").get();
      const pendientes = db.prepare("SELECT COUNT(*) as total FROM ordenes WHERE estado='pendiente'").get();
      const pagosHoy = db.prepare("SELECT COALESCE(SUM(monto),0) as total FROM pagos WHERE date(created_at)=date('now')").get();
      const instalaciones = db.prepare("SELECT COUNT(*) as total FROM ordenes WHERE tipo='Instalacion' AND estado='pendiente'").get();
      data = { ...data, servicios: servicios.total, activos: activos.total, suspendidos: suspendidos.total, 
               pendientes: pendientes.total, instalaciones: instalaciones.total, pagosHoy: pagosHoy.total };
      break;
    }
    case 'Clientes': {
      data.clientes = db.prepare(`
        SELECT c.*, z.nombre as zona_nombre, COUNT(s.id) as servicios_count
        FROM clientes c LEFT JOIN zonas z ON z.id=c.zona_id 
        LEFT JOIN servicios s ON s.cliente_id=c.id
        GROUP BY c.id ORDER BY c.id DESC
      `).all();
      break;
    }
    case 'NuevoCliente': {
      break;
    }
    case 'Ordenes': {
      data.ordenesPendientes = db.prepare(`
        SELECT o.*, c.nombre as cliente_nombre, c.cedula, c.direccion, e.nombre as tecnico_nombre,
               z.nombre as zona_nombre, pl.nombre as plan_nombre
        FROM ordenes o LEFT JOIN clientes c ON c.id=o.cliente_id
        LEFT JOIN empleados e ON e.id=o.tecnico_id
        LEFT JOIN zonas z ON z.id=o.zona_id
        LEFT JOIN planes pl ON pl.id=o.servicio_id
        WHERE o.estado='pendiente' ORDER BY o.id DESC
      `).all();
      data.ordenesCerradas = db.prepare(`
        SELECT o.*, c.nombre as cliente_nombre, c.cedula, c.direccion, e.nombre as tecnico_nombre,
               z.nombre as zona_nombre, pl.nombre as plan_nombre, u.nombre as cerrado_por
        FROM ordenes o LEFT JOIN clientes c ON c.id=o.cliente_id
        LEFT JOIN empleados e ON e.id=o.tecnico_id
        LEFT JOIN zonas z ON z.id=o.zona_id
        LEFT JOIN planes pl ON pl.id=o.servicio_id
        LEFT JOIN usuarios u ON u.id=o.completada_por
        WHERE o.estado='completada' ORDER BY o.id DESC
      `).all();
      break;
    }
    case 'RegistrarPago': {
      break;
    }
    case 'Gpon': {
      data.onus = db.prepare(`
        SELECT o.*, c.nombre as cliente_nombre, ol.nombre as olt_nombre
        FROM onu o LEFT JOIN clientes c ON c.id=o.cliente_id
        LEFT JOIN olts ol ON ol.id=o.olt_id ORDER BY o.id DESC
      `).all();
      data.olts = db.prepare('SELECT * FROM olts').all();
      break;
    }
    case 'CajasNap': {
      data.cajas = db.prepare(`
        SELECT cn.*, z.nombre as zona_nombre,
        (SELECT COUNT(*) FROM onu WHERE caja_nap_id=cn.id) as onus_count
        FROM cajas_nap cn LEFT JOIN zonas z ON z.id=cn.zona_id ORDER BY cn.id DESC
      `).all();
      break;
    }
    case 'Inventario': {
      data.categorias = db.prepare('SELECT DISTINCT categoria FROM inventario ORDER BY categoria').all();
      data.movimientos = db.prepare(`
        SELECT im.*, i.nombre as item_nombre, i.codigo, e.nombre as tecnico_nombre
        FROM inventario_movimientos im
        JOIN inventario i ON i.id=im.inventario_id
        LEFT JOIN empleados e ON e.id=im.tecnico_id
        ORDER BY im.id DESC LIMIT 50
      `).all();
      break;
    }
    case 'Ventas': {
      data.itemsVenta = db.prepare("SELECT * FROM inventario WHERE es_venta=1 AND stock>0").all();
      break;
    }
    case 'Proveedores': {
      data.proveedores = db.prepare(`
        SELECT p.*, 
        (SELECT COUNT(*) FROM facturas_compra WHERE proveedor_id=p.id AND pagado < monto) as facturas_pendientes
        FROM proveedores p ORDER BY p.id DESC
      `).all();
      break;
    }
    case 'Empleados': {
      data.empleados = db.prepare(`
        SELECT e.*, COALESCE((SELECT SUM(restante) FROM prestamos_empleado WHERE empleado_id=e.id AND restante>0),0) as deuda
        FROM empleados e ORDER BY e.id DESC
      `).all();
      break;
    }
    case 'PagosAdmin': {
      data.facturasCompra = db.prepare(`
        SELECT fc.*, p.nombre as proveedor_nombre FROM facturas_compra fc
        JOIN proveedores p ON p.id=fc.proveedor_id
        WHERE fc.pagado < fc.monto ORDER BY fc.id DESC
      `).all();
      break;
    }
    case 'Estadisticas': {
      data.stats = {
        totalClientes: db.prepare('SELECT COUNT(*) as c FROM clientes').get().c,
        activos: db.prepare("SELECT COUNT(*) as c FROM servicios WHERE estado='activo'").get().c,
        suspendidos: db.prepare("SELECT COUNT(*) as c FROM servicios WHERE estado='suspendido'").get().c,
        ingresosMes: db.prepare("SELECT COALESCE(SUM(monto),0) as t FROM pagos WHERE strftime('%Y-%m', created_at)=strftime('%Y-%m','now')").get().t,
        gastosMes: db.prepare("SELECT COALESCE(SUM(monto),0) as t FROM gastos WHERE strftime('%Y-%m', created_at)=strftime('%Y-%m','now')").get().t
      };
      break;
    }
    case 'Monitoreo': break;
    case 'BuscarOnu': break;
    case 'CambioOnu': break;
    case 'CambioDeTitular': break;
    case 'Traslados': break;
    case 'PromesaDePago': break;
    case 'CuadreCaja': break;
    case 'Configuracion': break;
    case 'Actualizaciones': break;
  }
  
  renderPage(req, res, pagina, data);
});

app.post("/api/config/save", requireAuth, (req, res) => {
  const { section, data } = req.body;
  if (data && typeof data === "object") {
    for (const [key, value] of Object.entries(data)) {
      db.prepare("INSERT OR REPLACE INTO configuracion (key, value) VALUES (?, ?)").run(key, String(value));
    }
  }
  res.json({ success: true });
});

app.get("/api/config/get", requireAuth, (req, res) => {
  const configs = db.prepare("SELECT key, value FROM configuracion").all();
  const obj = {};
  configs.forEach(c => obj[c.key] = c.value);
  res.json(obj);
});

// ======== API ROUTES ========
app.post('/api/clientes', requireAuth, (req, res) => {
  const { nombre, cedula, telefono, direccion, apodo, zona_id } = req.body;
  const r = db.prepare('INSERT INTO clientes (nombre, cedula, telefono, direccion, apodo, zona_id) VALUES (?,?,?,?,?,?)')
    .run(nombre, cedula, telefono, direccion, apodo, zona_id || null);
  res.json({ id: r.lastInsertRowid, message: 'Cliente creado' });
});

app.post('/api/ordenes', requireAuth, (req, res) => {
  const { tipo, cliente_id, detalle, zona_id, plan_id } = req.body;
  const r = db.prepare('INSERT INTO ordenes (tipo, cliente_id, detalle, zona_id, servicio_id) VALUES (?,?,?,?,?)')
    .run(tipo, cliente_id, detalle, zona_id || null, plan_id || null);
  res.json({ id: r.lastInsertRowid, message: 'Orden creada' });
});

app.post('/api/pagos', requireAuth, (req, res) => {
  const { cliente_id, servicio_id, monto, metodo, factura_id } = req.body;
  const r = db.prepare('INSERT INTO pagos (cliente_id, servicio_id, monto, metodo, usuario_id) VALUES (?,?,?,?,?)')
    .run(cliente_id, servicio_id || null, monto, metodo, req.session.user.id);
  if (factura_id) {
    db.prepare('UPDATE facturas SET estado=\'pagada\' WHERE id=?').run(factura_id);
  }
  res.json({ id: r.lastInsertRowid, message: 'Pago registrado' });
});

app.get('/api/clientes/buscar', requireAuth, (req, res) => {
  const q = req.query.q || '';
  const clientes = db.prepare(`
    SELECT c.*, GROUP_CONCAT(s.estado) as estados_servicio
    FROM clientes c LEFT JOIN servicios s ON s.cliente_id=c.id
    WHERE c.nombre LIKE ? OR c.cedula LIKE ? OR c.telefono LIKE ?
    GROUP BY c.id LIMIT 20
  `).all(`%${q}%`, `%${q}%`, `%${q}%`);
  res.json(clientes);
});

app.get('/api/stats', requireAuth, (req, res) => {
  const servicios = db.prepare("SELECT estado, COUNT(*) as count FROM servicios GROUP BY estado").all();
  const pagosMes = db.prepare(`
    SELECT strftime('%m', created_at) as mes, COALESCE(SUM(monto),0) as total 
    FROM pagos WHERE strftime('%Y', created_at)=strftime('%Y','now')
    GROUP BY strftime('%m', created_at)
  `).all();
  res.json({ servicios, pagosMes });
});

// ======== PROFILE ========
app.post('/api/perfil', requireAuth, (req, res) => {
  const { nombre, telefono, correo, password } = req.body;
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE usuarios SET nombre=?, telefono=?, correo=?, password=? WHERE id=?')
      .run(nombre, telefono, correo, hash, req.session.user.id);
  } else {
    db.prepare('UPDATE usuarios SET nombre=?, telefono=?, correo=? WHERE id=?')
      .run(nombre, telefono, correo, req.session.user.id);
  }
  req.session.user.nombre = nombre;
  res.json({ message: 'Perfil actualizado' });
});

// Create default admin password on first run
const adminUser = db.prepare('SELECT * FROM usuarios WHERE username=?').get('admin');
if (adminUser && adminUser.password === '$2b$10$8K1p/a0dL1LXMIgoEDFrwOfMQkfAjkMBcGmEGGGGxGGGGGGGGGGGG') {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('UPDATE usuarios SET password=? WHERE username=?').run(hash, 'admin');
  console.log('Default password set to admin123');
}

app.listen(PORT, () => {
  console.log(`ISP Total corriendo en http://localhost:${PORT}`);
});

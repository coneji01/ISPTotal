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
    { id: "Routers", icon: "fa-server", nombre: "Routers" },
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
      data.zonas = db.prepare('SELECT * FROM zonas ORDER BY nombre').all();
      data.planes = db.prepare('SELECT * FROM planes ORDER BY nombre').all();
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
      data.usuarios = db.prepare('SELECT id, username, nombre, rol FROM usuarios WHERE activo=1').all();
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
const MikroTikAPI = require("./mikrotik-api");

app.post("/api/routers/test", requireAuth, async (req, res) => {
  const { host, port, username, password } = req.body;
  const result = await MikroTikAPI.testConnection(host, port || 8728, username, password);
  res.json(result);
});

app.post("/api/routers/interfaces", requireAuth, async (req, res) => {
  const { host, port, username, password } = req.body;
  const result = await MikroTikAPI.getInterfaces(host, port || 8728, username, password);
  res.json(result);
});

app.post("/api/routers/dhcp", requireAuth, async (req, res) => {
  const { host, port, username, password } = req.body;
  const result = await MikroTikAPI.getDHCPLeases(host, port || 8728, username, password);
  res.json(result);
});

app.get("/api/routers", requireAuth, (req, res) => {
  const routers = db.prepare("SELECT * FROM routers ORDER BY name").all();
  res.json(routers);
});

app.get("/api/routers/:id", requireAuth, (req, res) => {
  const router = db.prepare("SELECT * FROM routers WHERE id=?").get(req.params.id);
  if (!router) return res.status(404).json({ error: "Router no encontrado" });
  res.json(router);
});

app.post("/api/routers/save", requireAuth, async (req, res) => {
  const { accion, id_router, id_router_edit, name, ip, port, user, password, ip_blocks } = req.body;
  let routerId = id_router || id_router_edit;
  if (accion === "editar" && id_router) {
    if (password) {
      db.prepare("UPDATE routers SET name=?, ip=?, port=?, user=?, password=?, ip_blocks=? WHERE id=?")
        .run(name, ip, port || 8728, user, password, ip_blocks || "[]", id_router);
    } else {
      db.prepare("UPDATE routers SET name=?, ip=?, port=?, user=?, ip_blocks=? WHERE id=?")
        .run(name, ip, port || 8728, user, ip_blocks || "[]", id_router);
    }
    routerId = id_router;
  } else {
    const r = db.prepare("INSERT INTO routers (name, ip, port, user, password, ip_blocks) VALUES (?,?,?,?,?,?)")
      .run(name, ip, port || 8728, user, password || "", ip_blocks || "[]");
    routerId = r.lastInsertRowid;
  }
  // ⭐ Test connection after save (use saved password if not provided)
  var testPass = password || (id_router ? db.prepare("SELECT password FROM routers WHERE id=?").get(id_router)?.password : "");
  try {
    const result = await MikroTikAPI.testConnection(ip, port || 8728, user, testPass);
    if (result.success) {
      db.prepare("UPDATE routers SET connected=1, last_sync=datetime('now') WHERE id=?").run(routerId);
    } else {
      db.prepare("UPDATE routers SET connected=0 WHERE id=?").run(routerId);
    }
  } catch(e) {
    db.prepare("UPDATE routers SET connected=0 WHERE id=?").run(routerId);
  }
  res.json({ success: true, id: parseInt(routerId) });
});

app.post("/api/routers/:id/delete", requireAuth, (req, res) => {
  db.prepare("DELETE FROM routers WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

app.post("/api/routers/:id/resync", requireAuth, async (req, res) => {
  const router = db.prepare("SELECT * FROM routers WHERE id=?").get(req.params.id);
  if (!router) return res.json({ success: false, error: "Router no encontrado" });
  const result = await MikroTikAPI.testConnection(router.ip, router.port || 8728, router.user, router.password);
  if (result.success) {
    db.prepare("UPDATE routers SET connected=1, last_sync=datetime('now') WHERE id=?").run(req.params.id);
  } else {
    db.prepare("UPDATE routers SET connected=0 WHERE id=?").run(req.params.id);
  }
  res.json(result);
});

// ======== NUEVO CLIENTE API ========
app.post('/api/nuevo-cliente/verificar-documento', requireAuth, (req, res) => {
  const { tipo, numero } = req.body;
  if (!numero) return res.json({ existe: false });
  const cliente = tipo === 'rnc'
    ? db.prepare('SELECT id, nombre, cedula, telefono FROM clientes WHERE cedula=?').get(numero)
    : db.prepare('SELECT id, nombre, cedula, telefono FROM clientes WHERE cedula=?').get(numero);
  if (cliente) {
    return res.json({ existe: true, cliente: cliente });
  }
  res.json({ existe: false });
});

app.post('/api/nuevo-cliente/save', requireAuth, (req, res) => {
  const {
    tipo_doc, cedula, name, alias, phone, phone2, address, observations,
    sector_id, plan_id, billing_type, dia_generacion, dia_corte,
    wifi_ssid, wifi_pass, precio_instalacion,
    crear_factura_instalacion, instalacion_pagada
  } = req.body;

  if (!name || !phone || !address) {
    return res.json({ success: false, message: 'Nombre, tel\u00e9fono y direcci\u00f3n son requeridos' });
  }

  const docNum = cedula || '';

  // 1. Crear cliente
  const clienteResult = db.prepare(
    'INSERT INTO clientes (nombre, cedula, telefono, telefono2, direccion, apodo, zona_id) VALUES (?,?,?,?,?,?,?)'
  ).run(name, docNum, phone, phone2 || null, address, alias || null, sector_id || null);

  const clienteId = clienteResult.lastInsertRowid;

  // 2. Crear servicio si hay plan
  let servicioId = null;
  if (plan_id) {
    const servResult = db.prepare(
      'INSERT INTO servicios (cliente_id, plan_id, zona_id, estado, fecha_activacion) VALUES (?,?,?,\'activo\',date(\'now\'))'
    ).run(clienteId, plan_id, sector_id || null);
    servicioId = servResult.lastInsertRowid;

    // 3. Crear orden de instalaci\u00f3n
    let detalle = 'Instalaci\u00f3n';
    if (wifi_ssid) detalle += ' | WiFi: ' + wifi_ssid;
    if (observations) detalle += ' | ' + observations;

    db.prepare(
      "INSERT INTO ordenes (tipo, cliente_id, servicio_id, detalle, zona_id, estado, usuario_id) VALUES (?,?,?,?,?,'pendiente',?)"
    ).run('instalacion', clienteId, servicioId, detalle, sector_id || null, req.session.user.id);

    // 4. Crear factura de instalaci\u00f3n si aplica
    const precioInst = parseFloat(precio_instalacion) || 0;
    if (precioInst > 0 && crear_factura_instalacion === '1') {
      const factEstado = instalacion_pagada === '1' ? 'pagada' : 'pendiente';
      db.prepare(
        "INSERT INTO facturas (servicio_id, periodo, monto, estado, fecha_emision, fecha_vencimiento) VALUES (?,?,?,?,date('now'),date('now','+30 days'))"
      ).run(servicioId, 'Instalaci\u00f3n', precioInst, factEstado);

      if (instalacion_pagada === '1') {
        db.prepare(
          "INSERT INTO pagos (servicio_id, cliente_id, monto, metodo, usuario_id) VALUES (?,?,?,'efectivo',?)"
        ).run(servicioId, clienteId, precioInst, req.session.user.id);
      }
    }
  }

  res.json({
    success: true,
    cliente_id: clienteId,
    cliente_nombre: name,
    servicio_id: servicioId
  });
});

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

app.get("/api/clientes/lista", requireAuth, (req, res) => {
  const { estado, zona, facturas, q, mostrar = "20", p = "1" } = req.query;
  const limit = mostrar === "all" ? 99999 : parseInt(mostrar);
  const offset = (parseInt(p) - 1) * limit;
  let where = ["1=1"];
  let params = [];
  if (estado && estado !== "todos") { where.push("c.estado=?"); params.push(estado); }
  if (zona && zona !== "todas") { where.push("c.zona_id=?"); params.push(zona); }
  if (facturas === "sin") { where.push("(SELECT COUNT(*) FROM facturas WHERE cliente_id=c.id)=0"); }
  else if (facturas === "1") { where.push("(SELECT COUNT(*) FROM facturas WHERE cliente_id=c.id)=1"); }
  else if (facturas === "2+") { where.push("(SELECT COUNT(*) FROM facturas WHERE cliente_id=c.id)>=2"); }
  if (q) { where.push("(c.nombre LIKE ? OR c.cedula LIKE ? OR c.telefono LIKE ?)"); params.push("%"+q+"%","%"+q+"%","%"+q+"%"); }
  const whereSQL = where.join(" AND ");
  const total = db.prepare("SELECT COUNT(*) as cnt FROM clientes c WHERE " + whereSQL).get(...params).cnt;
  const clientes = db.prepare("SELECT c.*, z.nombre as zona_nombre, (SELECT COUNT(*) FROM servicios WHERE cliente_id=c.id) as servicios_count FROM clientes c LEFT JOIN zonas z ON z.id=c.zona_id WHERE " + whereSQL + " ORDER BY c.id DESC LIMIT ? OFFSET ?").all(...params, limit, offset);
  let html = "";
  if (clientes.length === 0) {
    html = "<tr><td colspan=\"7\" style=\"text-align:center;padding:40px;color:var(--text-gray);\">No se encontraron clientes</td></tr>";
  } else {
    clientes.forEach(function(c) {
      const est = c.estado === "activo" ? "<span class=\"badge badge-success\">Activo</span>" : c.estado === "suspendido" ? "<span class=\"badge badge-warning\">Suspendido</span>" : "<span class=\"badge badge-danger\">Retirado</span>";
      html += "<tr><td><input type=\"checkbox\" class=\"clienteCheck\" data-id=\"" + c.id + "\" onchange=\"actualizarBulkSelection()\"></td><td>" + c.id + "</td><td><strong>" + c.nombre + "</strong></td><td>" + (c.zona_nombre || "") + "</td><td>" + (c.telefono || "") + "</td><td>" + est + "</td><td><div class=\"btn-group\"><button class=\"btn btn-sm btn-secondary\" onclick=\"toggleCliente(" + c.id + ")\" title=\"Seleccionar\"><i class=\"fas fa-check\"></i></button><button class=\"btn btn-sm btn-danger\" onclick=\"borrarCliente(" + c.id + ")\" title=\"Eliminar\"><i class=\"fas fa-trash\"></i></button></div></td></tr>";
    });
  }
  res.json({ status: "success", html: html, total: total });
});

app.post("/api/clientes/save", requireAuth, (req, res) => {
  const { nombre, cedula, telefono, direccion, zona_id, apodo } = req.body;
  if (!nombre) return res.json({ success: false, message: "Nombre requerido" });
  db.prepare("INSERT INTO clientes (nombre, cedula, telefono, direccion, zona_id, apodo) VALUES (?,?,?,?,?,?)").run(nombre, cedula, telefono, direccion, zona_id || null, apodo || null);
  res.json({ success: true });
});

app.post("/api/clientes/bulk", requireAuth, (req, res) => {
  const { action, ids } = req.body;
  if (!ids || ids.length === 0) return res.json({ success: false });
  const placeholders = ids.map(function(){return "?"}).join(",");
  if (action === "eliminar") {
    const delServ = db.prepare("DELETE FROM servicios WHERE cliente_id=?");
    const delCli = db.prepare("DELETE FROM clientes WHERE id=?");
    const txn = db.transaction(function() {
      for (var i = 0; i < ids.length; i++) {
        delServ.run(ids[i]);
        delCli.run(ids[i]);
      }
    });
    txn();
  } else if (action === "activar" || action === "suspender" || action === "retirar") {
    var estadoVal = action === "activar" ? "activo" : action;
    const updServ = db.prepare("UPDATE servicios SET estado=? WHERE cliente_id=?");
    const updCli = db.prepare("UPDATE clientes SET estado=? WHERE id=?");
    const txn = db.transaction(function() {
      for (var i = 0; i < ids.length; i++) {
        updServ.run(estadoVal, ids[i]);
        updCli.run(estadoVal, ids[i]);
      }
    });
    txn();
  }
  res.json({ success: true });
});

app.post("/api/clientes/:id/delete", requireAuth, (req, res) => {
  db.prepare("DELETE FROM servicios WHERE cliente_id=?").run(req.params.id);
  db.prepare("DELETE FROM clientes WHERE id=?").run(req.params.id);
  res.json({ success: true });
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

// ======== EMPLEADOS API ========

// List empleados with search & pagination
app.get('/api/empleados', requireAuth, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const search = (req.query.search || '').trim();
  const limit = 20;
  const offset = (page - 1) * limit;
  
  let where = 'WHERE e.activo=1';
  let params = [];
  if (search) {
    where += ' AND (e.nombre LIKE ? OR e.cedula LIKE ? OR e.telefono LIKE ?)';
    const s = '%' + search + '%';
    params.push(s, s, s);
  }
  
  const total = db.prepare('SELECT COUNT(*) as cnt FROM empleados e ' + where).get(...params).cnt;
  const pages = Math.max(1, Math.ceil(total / limit));
  
  const data = db.prepare(`
    SELECT e.*,
      COALESCE((SELECT SUM(restante) FROM prestamos_empleado WHERE empleado_id=e.id AND restante>0),0) as deuda,
      u.nombre as usuario_nombre
    FROM empleados e
    LEFT JOIN usuarios u ON u.id=e.usuario_id
    ${where}
    ORDER BY e.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  
  res.json({ success: true, data, page, pages, total });
});

// Get single empleado
app.get('/api/empleados/:id', requireAuth, (req, res) => {
  const emp = db.prepare(`
    SELECT e.*, u.nombre as usuario_nombre
    FROM empleados e
    LEFT JOIN usuarios u ON u.id=e.usuario_id
    WHERE e.id=?
  `).get(req.params.id);
  if (!emp) return res.json({ success: false, message: 'Empleado no encontrado' });
  res.json({ success: true, data: emp });
});

// Save empleado (create or update)
app.post('/api/empleados/save', requireAuth, (req, res) => {
  const { id, nombre, cedula, telefono, tipo, tipo_otro, salario, periodo, dia_pago1, dia_pago2, fecha_ingreso, usuario_id } = req.body;
  if (!nombre) return res.json({ success: false, message: 'Nombre requerido' });
  
  const sal = parseFloat(salario) || 0;
  const dp1 = parseInt(dia_pago1) || 1;
  const dp2 = parseInt(dia_pago2) || 15;
  const uid = parseInt(usuario_id) || null;
  const per = periodo === 'quincenal' ? 'quincenal' : 'mensual';
  const tp = tipo || 'Tecnico';
  
  if (parseInt(id) > 0) {
    db.prepare(`UPDATE empleados SET nombre=?, cedula=?, telefono=?, tipo=?, tipo_otro=?, salario=?, periodo=?, dia_pago1=?, dia_pago2=?, fecha_ingreso=?, usuario_id=? WHERE id=?`)
      .run(nombre, cedula || null, telefono || null, tp, tipo_otro || null, sal, per, dp1, dp2, fecha_ingreso || null, uid, parseInt(id));
  } else {
    db.prepare(`INSERT INTO empleados (nombre, cedula, telefono, tipo, tipo_otro, salario, periodo, dia_pago1, dia_pago2, fecha_ingreso, usuario_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(nombre, cedula || null, telefono || null, tp, tipo_otro || null, sal, per, dp1, dp2, fecha_ingreso || null, uid);
  }
  res.json({ success: true });
});

// Delete empleado
app.post('/api/empleados/:id/delete', requireAuth, (req, res) => {
  db.prepare('DELETE FROM prestamos_empleado WHERE empleado_id=?').run(req.params.id);
  db.prepare('DELETE FROM empleados WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// Get orders for empleado
app.get('/api/empleados/:id/ordenes', requireAuth, (req, res) => {
  const id = req.params.id;
  const mes = parseInt(req.query.mes) || (new Date().getMonth() + 1);
  const anio = parseInt(req.query.anio) || new Date().getFullYear();
  
  const data = db.prepare(`
    SELECT o.*, c.nombre as cliente_nombre, z.nombre as zona_nombre
    FROM ordenes o
    LEFT JOIN clientes c ON c.id=o.cliente_id
    LEFT JOIN zonas z ON z.id=o.zona_id
    WHERE o.tecnico_id=? AND strftime('%m', o.created_at)=? AND strftime('%Y', o.created_at)=?
    ORDER BY o.id DESC
  `).all(id, String(mes).padStart(2,'0'), String(anio));
  
  const total = data.length;
  const completadas = data.filter(o => o.estado === 'completada' || o.estado === 'completed').length;
  res.json({ success: true, data, total, completadas });
});

// Get loans for empleado
app.get('/api/empleados/:id/prestamos', requireAuth, (req, res) => {
  const data = db.prepare('SELECT * FROM prestamos_empleado WHERE empleado_id=? ORDER BY id DESC').all(req.params.id);
  const balance = db.prepare('SELECT COALESCE(SUM(restante),0) as bal FROM prestamos_empleado WHERE empleado_id=? AND restante>0').get(req.params.id).bal;
  res.json({ success: true, data, balance });
});

// Create or update loan (prestamo)
app.post('/api/empleados/prestamo', requireAuth, (req, res) => {
  const { empleado_id, loan_id, monto, descripcion, fecha } = req.body;
  if (!parseFloat(monto)) return res.json({ success: false, message: 'Monto requerido' });
  
  const loanId = parseInt(loan_id);
  if (loanId > 0) {
    // Edit existing loan: update monto, descripcion, fecha, reset restante to new monto minus what was already paid
    const old = db.prepare('SELECT * FROM prestamos_empleado WHERE id=?').get(loanId);
    if (!old) return res.json({ success: false, message: 'Préstamo no encontrado' });
    const alreadyPaid = parseFloat(old.monto) - parseFloat(old.restante);
    const newRestante = parseFloat(monto) - alreadyPaid;
    if (newRestante < 0) {
      db.prepare('UPDATE prestamos_empleado SET monto=?, descripcion=?, fecha=?, restante=0 WHERE id=?').run(parseFloat(monto), descripcion || null, fecha || null, loanId);
    } else {
      db.prepare('UPDATE prestamos_empleado SET monto=?, descripcion=?, fecha=?, restante=? WHERE id=?').run(parseFloat(monto), descripcion || null, fecha || null, newRestante, loanId);
    }
  } else {
    // New loan
    const eid = parseInt(empleado_id);
    if (!eid) return res.json({ success: false, message: 'Empleado requerido' });
    db.prepare('INSERT INTO prestamos_empleado (empleado_id, monto, restante, descripcion, fecha) VALUES (?,?,?,?,?)')
      .run(eid, parseFloat(monto), parseFloat(monto), descripcion || null, fecha || null);
  }
  res.json({ success: true });
});

// Pay/abonar or delete loan
app.post('/api/empleados/prestamo/abonar', requireAuth, (req, res) => {
  const { loan_id, monto, delete: isDelete } = req.body;
  
  if (isDelete || req.body._delete) {
    db.prepare('DELETE FROM prestamos_empleado WHERE id=?').run(loan_id);
    return res.json({ success: true });
  }
  
  if (!loan_id || !parseFloat(monto)) return res.json({ success: false, message: 'Datos incompletos' });
  
  const loan = db.prepare('SELECT * FROM prestamos_empleado WHERE id=?').get(loan_id);
  if (!loan) return res.json({ success: false, message: 'Préstamo no encontrado' });
  
  let newRestante = parseFloat(loan.restante) - parseFloat(monto);
  if (newRestante < 0) newRestante = 0;
  db.prepare('UPDATE prestamos_empleado SET restante=? WHERE id=?').run(newRestante, loan_id);
  res.json({ success: true });
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

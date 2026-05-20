const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcrypt');
const fileUpload = require('express-fileupload');
const db = require('./database');

// Global error handlers to prevent crashes
process.on('unhandledRejection', function(err) {
  console.error('[UNHANDLED REJECTION]', err.message);
});
process.on('uncaughtException', function(err) {
  console.error('[UNCAUGHT EXCEPTION]', err.message);
});

// Escapado HTML
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function trimStr(str, max) {
  if (!str) return '';
  return String(str).length > max ? String(str).substring(0, max) + '...' : String(str);
}

const app = express();
const PORT = 3020;

// Config
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use(express.static(path.join(__dirname, '..')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
// SQLite session store (persistente a través de reinicios - misma DB que database.js)
const sessionStoreDb = new (require('better-sqlite3'))(path.join(__dirname, '..', 'isptotal.db'));
sessionStoreDb.pragma('journal_mode = WAL');
sessionStoreDb.exec('CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, session TEXT, expires DATETIME)');

function SqliteSessionStore() {
  require('express-session').Store.call(this);
}
SqliteSessionStore.prototype = Object.create(require('express-session').Store.prototype);
SqliteSessionStore.prototype.constructor = SqliteSessionStore;

SqliteSessionStore.prototype.get = function(sid, cb) {
  try {
    var row = sessionStoreDb.prepare('SELECT session FROM sessions WHERE sid=? AND expires > datetime(\'now\')').get(sid);
    cb(null, row ? JSON.parse(row.session) : null);
  } catch(e) { cb(e); }
};
SqliteSessionStore.prototype.set = function(sid, session, cb) {
  try {
    var maxAge = session && session.cookie && session.cookie.maxAge ? session.cookie.maxAge : 86400000;
    var expires = new Date(Date.now() + maxAge).toISOString();
    sessionStoreDb.prepare('INSERT OR REPLACE INTO sessions (sid, session, expires) VALUES (?,?,?)').run(sid, JSON.stringify(session), expires);
    if (cb) cb(null);
  } catch(e) { if (cb) cb(e); }
};
SqliteSessionStore.prototype.destroy = function(sid, cb) {
  try { sessionStoreDb.prepare('DELETE FROM sessions WHERE sid=?').run(sid); if (cb) cb(null); } catch(e) { if (cb) cb(e); }
};
SqliteSessionStore.prototype.touch = function(sid, session, cb) {
  this.set(sid, session, cb);
};

const sessionStore = new SqliteSessionStore();

app.use(fileUpload());
app.use(session({
  store: sessionStore,
  secret: 'isptotal-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Auth middleware
function requireAuth(req, res, next) {
  if (!req.session.user) {
    // API routes should return JSON, not HTML redirect
    if (req.path && (req.path.startsWith('/api/') || req.query.ajax)) {
      return res.status(401).json({ success: false, message: 'Sesión expirada. Recargue la página.' });
    }
    return res.redirect('/');
  }
  next();
}

function renderPage(req, res, page, data = {}) {
  const menuEstructura = [
    { type: 'link', id: 'Dashboard', icon: 'fa-chart-pie', nombre: 'Resumen' },
    { type: 'link', id: 'Clientes', icon: 'fa-users', nombre: 'Clientes' },
    { type: 'link', id: 'NuevoCliente', icon: 'fa-user-plus', nombre: 'Nuevo cliente' },
    { type: 'link', id: 'PagosPendientes', icon: 'fa-hourglass-half', nombre: 'Pagos Pendientes' },
    { type: 'link', id: 'RegistrarPago', icon: 'fa-hand-holding-usd', nombre: 'Registrar pago' },
    { type: 'link', id: 'PromesaDePago', icon: 'fa-handshake', nombre: 'Promesa de pago' },
    { type: 'link', id: 'Ordenes', icon: 'fa-clipboard-list', nombre: 'Órdenes' },
    { type: 'category', id: 'cambios', nombre: 'Cambios', icon: 'fa-exchange-alt', items: [
      { id: 'CambioOnu', icon: 'fa-microchip', nombre: 'Cambio de ONU' },
      { id: 'CambioDeTitular', icon: 'fa-user-friends', nombre: 'Cambio de Titular' },
      { id: 'Traslados', icon: 'fa-truck-moving', nombre: 'Traslados' }
    ]},
    { type: 'link', id: 'Inventario', icon: 'fa-boxes', nombre: 'Inventario' },
    { type: 'link', id: 'Ventas', icon: 'fa-shopping-cart', nombre: 'Ventas' },
    { type: 'category', id: 'gpon', nombre: 'GPON', icon: 'fa-satellite-dish', items: [
      { id: 'Gpon', icon: 'fa-satellite-dish', nombre: 'Lista de ONU' },
      { id: 'CajasNap', icon: 'fa-box', nombre: 'Cajas NAP' }
    ]},
    { type: 'link', id: 'BuscarOnu', icon: 'fa-search', nombre: 'Buscar ONU' },
    { type: 'link', id: 'Zonas', icon: 'fa-map-marker-alt', nombre: 'Zonas' },
    { type: 'link', id: 'Routers', icon: 'fa-server', nombre: 'Routers' },
    { type: 'category', id: 'admin', nombre: 'Administrativo', icon: 'fa-cogs', items: [
      { id: 'Proveedores', icon: 'fa-truck', nombre: 'Proveedores' },
      { id: 'Empleados', icon: 'fa-id-badge', nombre: 'Empleados' },
      { id: 'PagosAdmin', icon: 'fa-file-invoice-dollar', nombre: 'Pagos' },
      { id: 'Estadisticas', icon: 'fa-chart-bar', nombre: 'Estadísticas' }
    ]},
    { type: 'link', id: 'Monitoreo', icon: 'fa-desktop', nombre: 'Monitoreo' },
    { type: 'link', id: 'CuadreCaja', icon: 'fa-cash-register', nombre: 'Cuadre de caja' },
    // Planes removed from menu - only accessible via Configuracion
    // Facturacion removed from menu - only accessible via Configuracion
    // Plantillas removed from menu - only accessible via Configuracion
    { type: 'link', id: 'Configuracion', icon: 'fa-cog', nombre: 'Configuración' },
    // TR069 removed from menu - only accessible via Configuracion
    { type: 'link', id: 'Actualizaciones', icon: 'fa-sync', nombre: 'Actualizaciones' }
  ];
  
  const modulos = menuEstructura.reduce(function(acc, item) {
    if (item.type === 'link') acc.push(item);
    else if (item.items) item.items.forEach(function(sub) { acc.push(sub); });
    return acc;
  }, []);
  
  res.render('layout', { ...data, page, modulos, menuEstructura, user: req.session.user });
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
app.all('/modulo', requireAuth, (req, res) => {
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
      const servicios = db.prepare("SELECT COUNT(*) as total FROM servicios WHERE estado != 'retirado'").get();
      const activos = db.prepare("SELECT COUNT(*) as total FROM servicios WHERE estado='activo'").get();
      const suspendidos = db.prepare("SELECT COUNT(*) as total FROM servicios WHERE estado='suspendido'").get();
      const pendientes = db.prepare("SELECT COUNT(*) as total, COALESCE(SUM(f.monto - COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0)),0) as total_monto FROM facturas f WHERE f.estado='pendiente' AND f.monto > COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0)").get();
      const pagosHoy = db.prepare("SELECT COALESCE(SUM(monto),0) as total FROM pagos WHERE date(created_at)=date('now')").get();
      const pagosMes = db.prepare("SELECT COALESCE(SUM(monto),0) as total, COUNT(*) as cantidad FROM pagos WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')").get();
      const instalaciones = db.prepare("SELECT COUNT(*) as total FROM ordenes WHERE tipo='Instalacion' AND estado='pendiente'").get();
      
      // Monthly stats for bar chart (12 months)
      const instaladosMeses = db.prepare("SELECT substr(fecha_activacion,1,7) as mes, COUNT(*) as total FROM servicios WHERE fecha_activacion >= date('now','-12 months') GROUP BY mes ORDER BY mes").all();
      const retiradosMeses = db.prepare("SELECT substr(fecha_suspension,1,7) as mes, COUNT(*) as total FROM servicios WHERE fecha_suspension >= date('now','-12 months') AND fecha_suspension IS NOT NULL GROUP BY mes ORDER BY mes").all();
      
      // Installations this month for "+X este mes"
      const ultimoMesRow = db.prepare("SELECT COUNT(*) as total FROM servicios WHERE strftime('%Y-%m', fecha_activacion) = strftime('%Y-%m', 'now')").get();
      const ultimoMes = ultimoMesRow ? ultimoMesRow.total : 0;
      
      data = { ...data, servicios: servicios.total, activos: activos.total, suspendidos: suspendidos.total, 
               pendientes: pendientes.total, pendientes_monto: pendientes.total_monto, instalaciones: instalaciones.total, pagosHoy: pagosHoy.total, pagosMes: pagosMes.total, pagosMesCant: pagosMes.cantidad,
               instalados_meses: instaladosMeses, retirados_meses: retiradosMeses, ultimoMes: ultimoMes };
      break;
    }
    case 'Clientes': {
      const ajax = req.query.ajax;

      // ===== LIST CLIENTS (AJAX GET) =====
      if (ajax === 'list') {
        const search = (req.query.search || '').trim();
        const status = req.query.status || 'todos';
        const zona = req.query.zona || 'todas';
        const facturas = req.query.facturas || '';
        const fecha = req.query.fecha || '';
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const perPage = parseInt(req.query.per_page) || 15;
        const sort = req.query.sort || '';
        const dir = req.query.dir === 'desc' ? 'DESC' : 'ASC';
        const offset = (page - 1) * perPage;

        let where = 'WHERE 1=1';
        let params = [];

        if (search) {
          where += ' AND (c.nombre LIKE ? OR c.cedula LIKE ? OR c.telefono LIKE ? OR c.apodo LIKE ? OR c.direccion LIKE ?)';
          var like = '%' + search + '%';
          params.push(like, like, like, like, like);
        }

        if (zona && zona !== 'todas') {
          where += ' AND c.zona_id = ?';
          params.push(parseInt(zona));
        }

        if (status === 'activo') {
          where += " AND (SELECT COUNT(*) FROM servicios s WHERE s.cliente_id=c.id AND s.estado='activo') > 0";
        } else if (status === 'suspendido') {
          where += " AND (SELECT COUNT(*) FROM servicios s WHERE s.cliente_id=c.id AND s.estado='suspendido') > 0";
        } else if (status === 'retirado') {
          where += ' AND (SELECT COUNT(*) FROM servicios s WHERE s.cliente_id=c.id) = 0';
        }

        if (fecha && /^\d{4}-\d{2}$/.test(fecha)) {
          where += " AND strftime('%Y-%m', c.created_at) = ?";
          params.push(fecha);
        }

        if (facturas === 'sin') {
          where += " AND (SELECT COUNT(*) FROM facturas f JOIN servicios s ON s.id=f.servicio_id WHERE s.cliente_id=c.id AND f.estado='pendiente' AND f.monto > COALESCE((SELECT SUM(p.monto) FROM pagos p WHERE p.factura_id=f.id),0)) = 0";
        } else if (facturas === '1') {
          where += " AND (SELECT COUNT(*) FROM facturas f JOIN servicios s ON s.id=f.servicio_id WHERE s.cliente_id=c.id AND f.estado='pendiente' AND f.monto > COALESCE((SELECT SUM(p.monto) FROM pagos p WHERE p.factura_id=f.id),0)) = 1";
        } else if (facturas === '2+') {
          where += " AND (SELECT COUNT(*) FROM facturas f JOIN servicios s ON s.id=f.servicio_id WHERE s.cliente_id=c.id AND f.estado='pendiente' AND f.monto > COALESCE((SELECT SUM(p.monto) FROM pagos p WHERE p.factura_id=f.id),0)) >= 2";
        }

        var orderClause = 'ORDER BY c.id DESC';
        if (sort === 'nombre') orderClause = 'ORDER BY c.nombre ' + dir;
        else if (sort === 'zona') orderClause = 'ORDER BY z.nombre ' + dir;
        else if (sort === 'registro') orderClause = 'ORDER BY c.created_at ' + dir;

        const countRow = db.prepare('SELECT COUNT(*) as total FROM clientes c ' + where).get(...params);
        const total = countRow ? countRow.total : 0;

        const rows = db.prepare(`
          SELECT c.*, z.nombre as zona_nombre,
            (SELECT COUNT(*) FROM servicios s WHERE s.cliente_id=c.id AND s.estado != 'retirado') as svc_count,
            (SELECT COUNT(*) FROM servicios s WHERE s.cliente_id=c.id AND s.estado='activo') as activo_count,
            (SELECT COUNT(*) FROM servicios s WHERE s.cliente_id=c.id AND s.estado='suspendido') as suspendido_count,
            (SELECT COALESCE(MAX(s.fecha_suspension),'') FROM servicios s WHERE s.cliente_id=c.id AND s.fecha_suspension IS NOT NULL) as ultima_suspension
          FROM clientes c
          LEFT JOIN zonas z ON z.id=c.zona_id
          ${where}
          ${orderClause}
          LIMIT ? OFFSET ?
        `).all(...params, perPage, offset);

        var html = '';
        var MONTHS = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

        rows.forEach(function(cliente) {
          var svcCount = parseInt(cliente.svc_count) || 0;
          var activoCount = parseInt(cliente.activo_count) || 0;
          var suspendidoCount = parseInt(cliente.suspendido_count) || 0;
          var hasActivos = activoCount > 0;
          var isSuspendido = suspendidoCount > 0 && !hasActivos;

          var badgeHtml = hasActivos
            ? '<span class="badge badge-success" style="background:#dcfce7;color:#166534;padding:2px 10px;border-radius:10px;font-size:0.72rem;font-weight:600;">Activo</span>'
            : (isSuspendido
              ? '<span class="badge badge-warning" style="background:#fef3c7;color:#92400e;padding:2px 10px;border-radius:10px;font-size:0.72rem;font-weight:600;">Suspendido</span>'
              : '<span class="badge badge-secondary" style="background:#f1f5f9;color:#94a3b8;padding:2px 10px;border-radius:10px;font-size:0.72rem;font-weight:600;">Sin Servicio</span>');

          var regDate = '';
          if (cliente.created_at) {
            try {
              var ds = String(cliente.created_at).replace(' ', 'T');
              if (!ds.includes('T')) ds += 'T00:00:00';
              var d = new Date(ds);
              regDate = d.getDate() + ' ' + (MONTHS[d.getMonth()]) + ' ' + d.getFullYear();
            } catch(e) { regDate = String(cliente.created_at).substring(0, 10); }
          }

          var suspDateHtml = '';
          if (cliente.ultima_suspension && isSuspendido) {
            try {
              var sd = String(cliente.ultima_suspension).substring(0, 10);
              var parts = sd.split('-');
              if (parts.length === 3) {
                suspDateHtml = parts[2] + ' ' + (MONTHS[parseInt(parts[1])]) + ' ' + parts[0];
              }
            } catch(e) {}
          }

          var aliasHtml = '';
          if (cliente.apodo) {
            aliasHtml = ' <span style="display:inline-flex;align-items:center;gap:3px;font-size:0.72rem;color:#64748b;background:#f1f5f9;padding:1px 7px;border-radius:4px;"><i class="fas fa-address-card" style="font-size:0.65rem;"></i> ' + escapeHtml(cliente.apodo) + '</span>';
          }

          var contactoHtml = '';
          if (cliente.telefono) {
            contactoHtml += '<div style="font-size:0.78rem;color:#475569;"><i class="fas fa-phone" style="font-size:0.7rem;color:#6366f1;margin-right:4px;"></i>' + escapeHtml(cliente.telefono) + '</div>';
          }
          if (cliente.direccion) {
            contactoHtml += '<div style="font-size:0.75rem;color:#94a3b8;margin-top:2px;"><i class="fas fa-map-marker-alt" style="font-size:0.65rem;color:#6366f1;margin-right:4px;"></i>' + escapeHtml(trimStr(cliente.direccion, 35)) + '</div>';
          }

          var linkCell = '<a href="/modulo?pagina=VerCliente&id=' + cliente.id + '" class="btn-accion ver" title="Ver cliente" style="padding:4px 8px;border:none;border-radius:6px;background:#eff6ff;color:#2563eb;cursor:pointer;text-decoration:none;font-size:0.78rem;"><i class="fas fa-eye"></i></a>';

          html += '<tr>';
          html += '<td style="padding:10px 8px;"><input type="checkbox" class="clienteCheck" data-id="' + cliente.id + '" value="' + cliente.id + '" onchange="actualizarBulkSelection()" style="width:16px;height:16px;accent-color:#6366f1;cursor:pointer;"></td>';
          html += '<td style="padding:10px 8px;font-weight:600;">' + cliente.id + '</td>';
          html += '<td style="padding:10px 8px;"><a href="/modulo?pagina=VerCliente&id=' + cliente.id + '" style="font-weight:600;color:#6366f1;text-decoration:none;font-size:0.82rem;">' + escapeHtml(cliente.nombre) + '</a>' + aliasHtml + '</td>';
          html += '<td style="padding:10px 8px;font-size:0.8rem;color:#475569;">' + escapeHtml(cliente.zona_nombre || '—') + '</td>';
          html += '<td style="padding:10px 8px;font-size:0.78rem;color:#94a3b8;">' + regDate + '</td>';
          html += '<td style="padding:10px 8px;font-size:0.75rem;color:#dc2626;">' + suspDateHtml + '</td>';
          html += '<td style="padding:10px 8px;">' + contactoHtml + '</td>';
          html += '<td style="padding:10px 8px;">' + badgeHtml + '</td>';
          html += '<td style="padding:10px 8px;white-space:nowrap;">' + linkCell + '</td>';
          html += '</tr>';
        });

        return res.json({ status: 'success', html: html, total: total, page: page });
      }

      // ===== SAVE CLIENT (AJAX) =====
      if (ajax === 'save') {
        const nombre = (req.body.nombre || req.body.name || '').trim();
        const cedula = (req.body.cedula || '').trim();
        const telefono = (req.body.telefono || '').trim();
        const direccion = (req.body.direccion || '').trim();
        const apodo = (req.body.apodo || '').trim();
        const zona_id = parseInt(req.body.zona_id) || null;

        if (!nombre) return res.json({ success: false, message: 'El nombre es obligatorio' });

        try {
          const r = db.prepare('INSERT INTO clientes (nombre, cedula, telefono, direccion, apodo, zona_id) VALUES (?,?,?,?,?,?)').run(nombre, cedula || null, telefono || null, direccion || null, apodo || null, zona_id);
          return res.json({ success: true, message: 'Cliente creado', id: r.lastInsertRowid });
        } catch(e) {
          return res.json({ success: false, message: 'Error al guardar: ' + e.message });
        }
      }

      // ===== DELETE CLIENT (AJAX) =====
      if (ajax === 'delete') {
        const id = parseInt(req.body.id) || 0;
        if (!id) return res.json({ success: false, message: 'ID inválido' });
        db.prepare('DELETE FROM clientes WHERE id=?').run(id);
        return res.json({ success: true, message: 'Cliente eliminado' });
      }

      // ===== TOGGLE STATUS (AJAX) =====
      if (ajax === 'toggle_status') {
        console.log('[toggle_status] POST received, action:', req.body.action, 'ids:', req.body.ids);
        const action = req.body.action || '';
        // Support both single id and array of ids
        var ids = [];
        if (Array.isArray(req.body.ids)) {
          ids = req.body.ids;
        } else {
          try { ids = JSON.parse(req.body.ids || '[]'); } catch(e) { ids = []; }
        }
        var singleId = parseInt(req.body.id) || 0;
        if (singleId) ids.push(singleId);
        
        if (!ids.length || !action) return res.json({ success: false, message: 'Datos inválidos' });
        
        ids.forEach(function(id) {
          if (action === 'activar') {
            db.prepare("UPDATE servicios SET estado='activo' WHERE cliente_id=?").run(id);
            
            // Enviar notificación de reactivación
            (async function() {
              try {
                // Buscar los servicios que se activaron
                var svcs = db.prepare('SELECT s.id, s.direccion, p.nombre as plan_nombre FROM servicios s LEFT JOIN planes p ON p.id=s.plan_id WHERE s.cliente_id=? AND s.estado=?').all(id, 'activo');
                if (svcs.length > 0) {
                  svcs.forEach(function(s) {
                    sendReactivationNotification(id, s.id, null);
                  });
                }
              } catch(e) {}
            })();
            
            // Quitar IP de la lista de suspendidos en MikroTik
            (async function() {
              try {
                var router = db.prepare('SELECT * FROM routers WHERE connected=1 OR id=(SELECT MIN(id) FROM routers)').get();
                if (router && router.user) {
                  var MikroTikAPI = require('./mikrotik-api');
                  var ips = db.prepare('SELECT ip FROM servicios WHERE cliente_id=? AND ip IS NOT NULL AND ip != \'\'').all(id);
                  ips.forEach(function(svc) {
                    MikroTikAPI.setAddressList(router.ip, router.port || 8728, router.user, router.password, svc.ip, 'Suspendidos', false);
                  });
                }
              } catch(e) {}
            })();
          } else if (action === 'suspender') {
            db.prepare("UPDATE servicios SET estado='suspendido' WHERE cliente_id=?").run(id);
            
            // Enviar notificación de suspensión por WhatsApp
            (async function() {
              try {
                var openwa = require('./openwa-service');
                var clientData = db.prepare('SELECT nombre, telefono FROM clientes WHERE id=?').get(id);
                if (!clientData || !clientData.telefono) return;
                
                // Obtener servicios suspendidos con su info
                var svcs = db.prepare('SELECT s.id, s.direccion, p.nombre as plan_nombre FROM servicios s LEFT JOIN planes p ON p.id=s.plan_id WHERE s.cliente_id=? AND s.estado=?').all(id, 'suspendido');
                if (svcs.length === 0) return;
                
                // Obtener deuda total
                var deudaRow = db.prepare("SELECT COALESCE(SUM(f.monto - COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0)),0) as total FROM facturas f WHERE f.servicio_id IN (SELECT s2.id FROM servicios s2 WHERE s2.cliente_id=?) AND f.estado='pendiente'").get(id);
                var deudaTotal = deudaRow ? deudaRow.total : 0;
                
                // Obtener config de empresa
                var configRow = db.prepare("SELECT value FROM configuracion WHERE key='empresa_nombre'").get();
                var configRow2 = db.prepare("SELECT value FROM configuracion WHERE key='empresa_telefono'").get();
                var companyName = configRow ? configRow.value : '';
                var companyPhone = configRow2 ? configRow2.value : '';
                
                var tpl = db.prepare("SELECT content FROM templates WHERE template_key='notif_suspension'").get();
                var templateBase = tpl ? tpl.content : 'Hola {client_name}, su servicio ha sido suspendido.';
                
                svcs.forEach(function(svc) {
                  var msg = templateBase
                    .replace(/{client_name}/g, clientData.nombre || '')
                    .replace(/{service_address}/g, svc.direccion || '')
                    .replace(/{plan_name}/g, svc.plan_nombre || '')
                    .replace(/{invoice_remaining}/g, '$' + deudaTotal.toFixed(2))
                    .replace(/{company_phone}/g, companyPhone)
                    .replace(/{company_name}/g, companyName)
                    .replace(/{current_date}/g, new Date().toLocaleDateString('es-DO'));
                  
                  // Usar sistema de cola (encola si está desconectado)
                  openwa.encolarMensaje(id, svc.id, clientData.telefono, msg, 'suspension');
                });
              } catch(e) {
                console.log('[Suspension] Error notificación:', e.message);
              }
            })();
            
            // Agregar IP a lista de suspendidos en MikroTik
            (async function() {
              try {
                var router = db.prepare('SELECT * FROM routers WHERE connected=1 OR id=(SELECT MIN(id) FROM routers)').get();
                if (router && router.user) {
                  var MikroTikAPI = require('./mikrotik-api');
                  var ips = db.prepare('SELECT ip FROM servicios WHERE cliente_id=? AND ip IS NOT NULL AND ip != \'\'').all(id);
                  ips.forEach(function(svc) {
                    MikroTikAPI.setAddressList(router.ip, router.port || 8728, router.user, router.password, svc.ip, 'Suspendidos', true);
                  });
                }
              } catch(e) {}
            })();
            // Desactivar ONU en SmartOLT (por cada OLT)
            (async function() {
              try {
                var onus = db.prepare('SELECT o.sn, o.olt_id, ol.smartolt_subdomain, ol.smartolt_api_key FROM onu o LEFT JOIN olts ol ON ol.id=o.olt_id WHERE o.cliente_id=? AND o.sn IS NOT NULL AND o.sn != \'\'').all(id);
                if (!onus.length) return;
                onus.forEach(function(onu) {
                  if (!onu.smartolt_subdomain || !onu.smartolt_api_key) return;
                  var url = 'https://' + onu.smartolt_subdomain + '.smartolt.com/api/onus/' + onu.sn + '/deactivate';
                  var headers = { 'X-API-Key': onu.smartolt_api_key, 'Content-Type': 'application/json' };
                  fetch(url, { method: 'POST', headers: headers }).catch(function() {});
                });
              } catch(e) {}
            })();          } else if (action === 'retirar') {
            db.prepare("UPDATE servicios SET estado='retirado' WHERE cliente_id=?").run(id);
            // Eliminar ONU de SmartOLT y BD
            (async function() {
              try {
                var onus = db.prepare('SELECT o.sn, o.olt_id, o.id as onu_id, ol.smartolt_subdomain, ol.smartolt_api_key FROM onu o LEFT JOIN olts ol ON ol.id=o.olt_id WHERE o.cliente_id=? AND o.sn IS NOT NULL AND o.sn != \'\'').all(id);
                onus.forEach(function(onu) {
                  if (onu.smartolt_subdomain && onu.smartolt_api_key) {
                    var url = 'https://' + onu.smartolt_subdomain + '.smartolt.com/api/onus/' + onu.sn + '/delete';
                    var headers = { 'X-API-Key': onu.smartolt_api_key, 'Content-Type': 'application/json' };
                    fetch(url, { method: 'POST', headers: headers }).catch(function() {});
                  }
                  db.prepare('DELETE FROM onu WHERE id=?').run(onu.onu_id);
                });
              } catch(e) {}
            })();
          } else if (action === 'eliminar') {
            db.prepare('DELETE FROM clientes WHERE id=?').run(id);
          }
        });
        
        return res.json({ success: true, message: ids.length + ' cliente(s) procesados' });
      }

      // Load all clients for the template
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
      data.ciclos = db.prepare('SELECT * FROM billing_cycles ORDER BY id').all();
      break;
    }
    case 'Ordenes': {
      data.empleados = db.prepare("SELECT id, nombre FROM empleados WHERE activo=1 OR activo IS NULL ORDER BY nombre").all();
      data.zonas = db.prepare("SELECT id, nombre FROM zonas ORDER BY nombre").all();
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
      const ajax = req.query.ajax;
      data.clienteData = null;
      console.log('[DBG] RegistrarPago: pagina=' + pagina + ' ajax=' + ajax + ' cid=' + (req.query.cliente_id||'') + ' cid2=' + (req.query.client_id||'') + ' clienteData=' + JSON.stringify(data.clienteData));

      // Pre-cargar datos del cliente si viene por ID (ej: desde PagosPendientes)
      if (req.query.cliente_id) {
        var cid = parseInt(req.query.cliente_id) || 0;
        if (cid) {
          data.clienteData = db.prepare(`
            SELECT c.id, c.nombre as name, c.cedula, c.apodo as alias, c.telefono,
              COALESCE((SELECT SUM(f.monto - COALESCE(
                (SELECT SUM(p.monto) FROM pagos p WHERE p.factura_id=f.id),0
              )) FROM facturas f JOIN servicios s ON s.id=f.servicio_id WHERE s.cliente_id=c.id AND f.estado='pendiente' AND f.monto > COALESCE(
                (SELECT SUM(p.monto) FROM pagos p WHERE p.factura_id=f.id),0
              )),0) as total_pending,
              (SELECT COUNT(*) FROM servicios WHERE cliente_id=c.id AND estado != 'retirado') as svc_count
            FROM clientes c WHERE c.id=?
          `).get(cid);
        }
      }

      // --- Buscar clientes ---
      if (ajax === 'search_clients') {
        const q = (req.query.q || '').trim();
        if (q.length < 3) return res.json({ status: 'success', data: [] });
        const rows = db.prepare(`
          SELECT c.id, c.nombre as name, c.cedula, c.apodo as alias,
            COALESCE((SELECT SUM(f.monto - COALESCE(
              (SELECT SUM(p.monto) FROM pagos p WHERE p.factura_id=f.id),0
            )) FROM facturas f JOIN servicios s ON s.id=f.servicio_id WHERE s.cliente_id=c.id AND f.estado='pendiente' AND f.monto > COALESCE(
              (SELECT SUM(p.monto) FROM pagos p WHERE p.factura_id=f.id),0
            )),0) as total_pending,
            (SELECT COUNT(*) FROM servicios WHERE cliente_id=c.id AND estado != 'retirado') as svc_count
          FROM clientes c
          WHERE c.nombre LIKE ? OR c.apodo LIKE ? OR c.cedula LIKE ?
          ORDER BY c.nombre LIMIT 20
        `).all('%'+q+'%', '%'+q+'%', '%'+q+'%');
        return res.json({ status: 'success', data: rows, nic_match: null });
      }

      // --- Obtener datos del cliente por ID ---
      if (ajax === 'get_client') {
        const clientId = parseInt(req.query.client_id) || 0;
        if (!clientId) return res.json({ status: 'error', msg: 'ID de cliente requerido' });
        const cliente = db.prepare(`
          SELECT c.id, c.nombre as name, c.cedula, c.apodo as alias,
            COALESCE((SELECT SUM(f.monto - COALESCE(
              (SELECT SUM(p.monto) FROM pagos p WHERE p.factura_id=f.id),0
            )) FROM facturas f JOIN servicios s ON s.id=f.servicio_id WHERE s.cliente_id=c.id AND f.estado='pendiente' AND f.monto > COALESCE(
              (SELECT SUM(p.monto) FROM pagos p WHERE p.factura_id=f.id),0
            )),0) as total_pending,
            (SELECT COUNT(*) FROM servicios WHERE cliente_id=c.id AND estado != 'retirado') as svc_count
          FROM clientes c WHERE c.id=?
        `).get(clientId);
        if (!cliente) return res.json({ status: 'error', msg: 'Cliente no encontrado' });
        return res.json({ status: 'success', data: cliente, nic_match: null });
      }

      // --- Obtener servicios del cliente ---
      if (ajax === 'get_services' || ajax === 'get_client_services') {
        const clientId = parseInt(req.query.client_id) || 0;
        if (!clientId) return res.json({ status: 'error', msg: 'ID de cliente requerido' });
        const servicios = db.prepare(`
          SELECT s.id, s.estado as status, s.direccion as address, s.zona_id,
            p.nombre as plan_name, p.precio as plan_price,
            z.nombre as zone_name, s.ip as observaciones,
            COALESCE((SELECT SUM(f.monto - COALESCE(
              (SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0
            )) FROM facturas f WHERE f.servicio_id=s.id AND f.estado='pendiente' AND f.monto > COALESCE(
              (SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0
            )),0) as pending_total,
            (SELECT COUNT(*) FROM facturas f WHERE f.servicio_id=s.id AND f.estado='pendiente' AND f.monto > COALESCE(
              (SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0
            )) as pending_count
          FROM servicios s
          LEFT JOIN planes p ON p.id=s.plan_id
          LEFT JOIN zonas z ON z.id=s.zona_id
          WHERE s.cliente_id=? ORDER BY s.id
        `).all(clientId);
        return res.json({ status: 'success', data: servicios, consolidated: 0 });
      }

      // --- Obtener facturas pendientes de servicios seleccionados ---
      if (ajax === 'get_invoices' || ajax === 'get_pending_invoices') {
        const clientId = parseInt(req.query.client_id) || 0;
        let serviceIds = [];
        try { serviceIds = JSON.parse(req.query.service_ids || '[]'); } catch(e) {}
        if (!clientId || !serviceIds.length) return res.json({ status: 'error', msg: 'Datos requeridos' });
        const placeholders = serviceIds.map(function(){return '?'}).join(',');
        const invs = db.prepare(`
          SELECT f.id, f.servicio_id, f.periodo, f.monto as total, 
            CASE WHEN julianday('now') > julianday(f.fecha_vencimiento) THEN 'overdue' ELSE 'pending' END as status,
            f.fecha_vencimiento as due_date,
            COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0) as paid_amount,
            (f.monto - COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0)) as remaining,
            p.nombre as plan_name, s.direccion as svc_address
          FROM facturas f
          LEFT JOIN servicios s ON s.id=f.servicio_id
          LEFT JOIN planes p ON p.id=s.plan_id
          WHERE f.servicio_id IN (${placeholders}) AND f.monto > COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0)
          ORDER BY f.fecha_vencimiento ASC
        `).all(...serviceIds);
        const totalAdeudado = invs.reduce(function(sum, inv) { return sum + parseFloat(inv.remaining || 0); }, 0);
        return res.json({ status: 'success', data: invs, total_adeudado: totalAdeudado });
      }

      // --- Verificar transacción duplicada ---
      if (ajax === 'check_transaction') {
        const txn = (req.body.transaction_number || '').trim();
        if (!txn) return res.json({ status: 'ok' });
        const dup = db.prepare('SELECT COUNT(*) as c FROM pagos WHERE transaccion=?').get(txn);
        return res.json({ status: dup && dup.c > 0 ? 'duplicate' : 'ok' });
      }

      // --- Procesar pago ---
      if (ajax === 'process_payment') {
        const clientId = parseInt(req.body.client_id) || 0;
        const montoPagar = parseFloat(req.body.monto_pagar) || 0;
        const metodo = req.body.payment_method || 'EFECTIVO';
        const txn = (req.body.transaction_number || '').trim();
        const imprimir = req.body.imprimir || 'si';
        const activar = req.body.activar || 'si';
        let serviceIds = [];
        try { serviceIds = JSON.parse(req.body.service_ids || '[]'); } catch(e) {}
        if (!clientId || !serviceIds.length || montoPagar <= 0) return res.json({ status: 'error', msg: 'Datos inválidos' });
        
        if (txn) {
          const dup = db.prepare('SELECT COUNT(*) as c FROM pagos WHERE transaccion=?').get(txn);
          if (dup && dup.c > 0) return res.json({ status: 'error', msg: 'Número de transacción ya registrado' });
        }

        const placeholders = serviceIds.map(function(){return '?'}).join(',');
        const invoices = db.prepare(`
          SELECT f.id, f.servicio_id, f.monto as total,
            COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0) as paid_amount,
            (f.monto - COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0)) as remaining
          FROM facturas f
          WHERE f.servicio_id IN (${placeholders}) AND f.monto > COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0)
          ORDER BY f.fecha_vencimiento ASC
        `).all(...serviceIds);

        let remainingTotal = montoPagar;
        const paymentIds = [];
        const insertPago = db.prepare(`INSERT INTO pagos (factura_id, servicio_id, cliente_id, monto, metodo, transaccion, recibo, activar, usuario_id) VALUES (?,?,?,?,?,?,?,?,?)`);
        const updateInvoice = db.prepare(`UPDATE facturas SET estado=? WHERE id=?`);

        const payAll = db.transaction(function() {
          for (var i = 0; i < invoices.length && remainingTotal > 0.01; i++) {
            var inv = invoices[i];
            var remaining = parseFloat(inv.remaining);
            var payAmount = Math.min(remainingTotal, remaining);
            if (payAmount <= 0) continue;
            var newStatus = (Math.abs(payAmount - remaining) < 0.01) ? 'pagada' : 'pendiente';
            insertPago.run(inv.id, inv.servicio_id, clientId, payAmount, metodo, txn || null, imprimir === 'si' ? 1 : 0, activar === 'si' ? 1 : 0, req.session.user.id);
            paymentIds.push({id: this.lastID, factura_id: inv.id});
            if (newStatus === 'pagada') updateInvoice.run('pagada', inv.id);
            remainingTotal -= payAmount;
          }
        });
        payAll();

        // Si hay sobrante o no se pudo aplicar a todas las facturas
        if (remainingTotal > 0.01) {
          // Registrar pago directo (por si sobran fondos o no hay facturas)
          insertPago.run(null, serviceIds[0], clientId, remainingTotal, metodo, txn || null, imprimir === 'si' ? 1 : 0, activar === 'si' ? 1 : 0, req.session.user.id);
          paymentIds.push({id: this.lastID, factura_id: null});
        }

        // Activar servicio si se solicitó
        if (activar === 'si') {
          db.prepare(`UPDATE servicios SET estado='activo' WHERE cliente_id=? AND estado='suspendido'`).run(clientId);
          // Enviar notificación de reactivación
          (async function() {
            try {
              var svcs = db.prepare('SELECT id FROM servicios WHERE cliente_id=? AND estado=?').all(clientId, 'activo');
              svcs.forEach(function(s) { sendReactivationNotification(clientId, s.id, null); });
            } catch(e) {}
          })();
        }

        var msg = 'Pago registrado exitosamente por $' + montoPagar.toFixed(2);
        return res.json({ status: 'success', msg: msg, payment_ids: paymentIds.map(function(p){return p.id;}) });
      }

      // --- Procesar adelanto ---
      if (ajax === 'advance_payment') {
        const clientId = parseInt(req.body.client_id) || 0;
        const montoPagar = parseFloat(req.body.monto_pagar) || 0;
        const months = parseInt(req.body.months) || 0;
        const metodo = req.body.payment_method || 'EFECTIVO';
        const txn = (req.body.transaction_number || '').trim();
        const activar = req.body.activar || 'si';
        let serviceIds = [], prices = {};
        try { serviceIds = JSON.parse(req.body.service_ids || '[]'); } catch(e) {}
        try { prices = JSON.parse(req.body.prices || '{}'); } catch(e) {}
        if (!clientId || !serviceIds.length || montoPagar <= 0) return res.json({ status: 'error', msg: 'Datos inválidos' });

        if (txn) {
          const dup = db.prepare('SELECT COUNT(*) as c FROM pagos WHERE transaccion=?').get(txn);
          if (dup && dup.c > 0) return res.json({ status: 'error', msg: 'Número de transacción ya registrado' });
        }

        const insertPago = db.prepare(`INSERT INTO pagos (factura_id, servicio_id, cliente_id, monto, metodo, transaccion, recibo, activar, usuario_id) VALUES (?,?,?,?,?,?,?,?,?)`);
        const paymentIds = [];

        // Crear facturas para adelanto y registrar pagos
        const payAdv = db.transaction(function() {
          for (var i = 0; i < serviceIds.length; i++) {
            var svcId = serviceIds[i];
            var pricePerMonth = parseFloat(prices[svcId]) || 0;
            if (pricePerMonth <= 0) continue;
            var totalService = pricePerMonth * months;
            // Crear factura
            var periodo = months + ' mes(es) adelantado';
            var invResult = db.prepare(`INSERT INTO facturas (servicio_id, periodo, monto, estado, fecha_emision, fecha_vencimiento) VALUES (?,?,?,'pagada',date('now'),date('now','+${months} months'))`).run(svcId, periodo, totalService);
            var invId = invResult.lastInsertRowid;
            // Registrar pago
            insertPago.run(invId, svcId, clientId, totalService, metodo, txn || null, 1, activar === 'si' ? 1 : 0, req.session.user.id);
            paymentIds.push({id: this.lastID, factura_id: invId});
          }
        });
        payAdv();

        if (activar === 'si') {
          db.prepare(`UPDATE servicios SET estado='activo' WHERE cliente_id=? AND estado='suspendido'`).run(clientId);
          // Enviar notificación de reactivación
          (async function() {
            try {
              var svcs = db.prepare('SELECT id FROM servicios WHERE cliente_id=? AND estado=?').all(clientId, 'activo');
              svcs.forEach(function(s) { sendReactivationNotification(clientId, s.id, null); });
            } catch(e) {}
          })();
        }

        return res.json({ status: 'success', msg: 'Adelanto registrado por $' + montoPagar.toFixed(2), payment_ids: paymentIds.map(function(p){return p.id;}) });
      }

      // --- Listar recibos (pagos recientes) ---
      if (ajax === 'list_receipts') {
        const page = parseInt(req.query.page) || 1;
        const perPage = 20;
        const search = (req.query.search || '').trim();
        const dateFrom = req.query.date_from || '';
        const dateTo = req.query.date_to || '';
        let where = 'WHERE 1=1';
        let params = [];
        if (search) {
          where += ' AND (c.nombre LIKE ? OR c.apodo LIKE ? OR CAST(p.id AS TEXT) LIKE ?)';
          params.push('%' + search + '%', '%' + search + '%', '%' + search + '%');
        }
        if (dateFrom) { where += ' AND date(p.created_at) >= ?'; params.push(dateFrom); }
        if (dateTo) { where += ' AND date(p.created_at) <= ?'; params.push(dateTo); }
        
        const totalRow = db.prepare(`SELECT COUNT(*) as total FROM pagos p LEFT JOIN clientes c ON c.id=p.cliente_id ${where}`).get.apply(db, params);
        const total = totalRow ? totalRow.total : 0;
        const totalPages = Math.ceil(total / perPage) || 1;
        const offset = (page - 1) * perPage;
        params.push(perPage, offset);
        const rows = db.prepare(`
          SELECT p.id, p.monto as amount, p.metodo as payment_method, p.transaccion as transaction_number,
            c.nombre as client_name, p.created_at as payment_date
          FROM pagos p
          LEFT JOIN clientes c ON c.id=p.cliente_id
          ${where}
          ORDER BY p.created_at DESC LIMIT ? OFFSET ?
        `).all(...params);
        return res.json({ status: 'success', data: rows, total: total, page: page, totalPages: totalPages });
      }

      break;
    }
    case 'Gpon': {
      data.onus = db.prepare(`
        SELECT o.*, c.nombre as cliente_nombre, ol.nombre as olt_nombre
        FROM onu o LEFT JOIN clientes c ON c.id=o.cliente_id
        LEFT JOIN olts ol ON ol.id=o.olt_id ORDER BY o.id DESC
      `).all();
      data.olts = db.prepare('SELECT * FROM olts').all();
      // SmartOLT config
      const soCfg = db.prepare("SELECT key, value FROM configuracion WHERE key IN ('smartolt_subdomain','smartolt_api_key','smartolt_olt_id','smartolt_name')").all();
      data.smartoltConfig = {};
      soCfg.forEach(function(c) { data.smartoltConfig[c.key.replace('smartolt_', '')] = c.value; });
      break;
    }
    case 'CajasNap': {
      const ajaxCn = req.query.ajax;

      // ===== SAVE (POST) =====
      if (ajaxCn === 'save') {
        const id = parseInt(req.body.id) || 0;
        const nombre = (req.body.nombre || '').trim();
        const puertos = parseInt(req.body.puertos) || 8;
        const zona_id = parseInt(req.body.zona_id) || null;
        const lat = parseFloat(req.body.lat) || null;
        const lng = parseFloat(req.body.lng) || null;
        if (!nombre) return res.json({ status: 'error', msg: 'El nombre es obligatorio' });
        if (id) {
          const old = db.prepare('SELECT puertos FROM cajas_nap WHERE id=?').get(id);
          if (old && parseInt(old.puertos) !== puertos) {
            db.prepare('UPDATE onu SET caja_nap_id=NULL, puerto_caja=NULL WHERE caja_nap_id=? AND puerto_caja > ?').run(id, puertos);
          }
          db.prepare('UPDATE cajas_nap SET nombre=?, puertos=?, zona_id=?, lat=?, lng=? WHERE id=?').run(nombre, puertos, zona_id, lat, lng, id);
          return res.json({ status: 'success', msg: 'Caja NAP actualizada' });
        } else {
          const r = db.prepare('INSERT INTO cajas_nap (nombre, puertos, zona_id, lat, lng) VALUES (?,?,?,?,?)').run(nombre, puertos, zona_id, lat, lng);
          return res.json({ status: 'success', msg: 'Caja NAP creada', id: r.lastInsertRowid });
        }
      }

      // ===== DELETE (POST) =====
      if (ajaxCn === 'delete') {
        const id = parseInt(req.body.id) || 0;
        if (!id) return res.json({ status: 'error', msg: 'ID inv\u00e1lido' });
        db.prepare('UPDATE onu SET caja_nap_id=NULL, puerto_caja=NULL WHERE caja_nap_id=?').run(id);
        db.prepare('DELETE FROM cajas_nap WHERE id=?').run(id);
        return res.json({ status: 'success', msg: 'Caja NAP eliminada' });
      }

      // ===== ASSIGN ONU (POST) =====
      if (ajaxCn === 'assign_onu') {
        const caja_nap_id = parseInt(req.body.caja_nap_id) || 0;
        const puerto = parseInt(req.body.puerto) || 0;
        const onu_id = parseInt(req.body.onu_id) || 0;
        if (!caja_nap_id || !puerto || !onu_id) {
          return res.json({ status: 'error', msg: 'Datos inv\u00e1lidos' });
        }
        const caja = db.prepare('SELECT * FROM cajas_nap WHERE id=?').get(caja_nap_id);
        if (!caja) return res.json({ status: 'error', msg: 'Caja NAP no encontrada' });
        if (puerto > caja.puertos) return res.json({ status: 'error', msg: 'Puerto inv\u00e1lido' });
        const ocupado = db.prepare('SELECT id FROM onu WHERE caja_nap_id=? AND puerto_caja=?').get(caja_nap_id, puerto);
        if (ocupado) return res.json({ status: 'error', msg: 'El puerto ya est\u00e1 ocupado' });
        db.prepare('UPDATE onu SET caja_nap_id=NULL, puerto_caja=NULL WHERE id=?').run(onu_id);
        db.prepare('UPDATE onu SET caja_nap_id=?, puerto_caja=? WHERE id=?').run(caja_nap_id, puerto, onu_id);
        return res.json({ status: 'success', msg: 'ONU asignada al puerto ' + puerto });
      }

      // ===== UNASSIGN ONU (POST) =====
      if (ajaxCn === 'unassign_onu') {
        const caja_nap_id = parseInt(req.body.caja_nap_id) || 0;
        const puerto = parseInt(req.body.puerto) || 0;
        if (!caja_nap_id || !puerto) {
          return res.json({ status: 'error', msg: 'Datos inv\u00e1lidos' });
        }
        db.prepare('UPDATE onu SET caja_nap_id=NULL, puerto_caja=NULL WHERE caja_nap_id=? AND puerto_caja=?').run(caja_nap_id, puerto);
        return res.json({ status: 'success', msg: 'ONU desasignada del puerto ' + puerto });
      }

      // ===== LIST (GET) =====
      if (ajaxCn === 'list') {
        const search = (req.query.search || '').trim();
        const zona_id = parseInt(req.query.zona_id) || 0;
        let where = 'WHERE 1=1';
        let params = [];
        if (search) {
          where += ' AND cn.nombre LIKE ?';
          params.push('%' + search + '%');
        }
        if (zona_id) {
          where += ' AND cn.zona_id = ?';
          params.push(zona_id);
        }
        const rows = db.prepare(`
          SELECT cn.*, z.nombre as zona_nombre,
          (SELECT COUNT(*) FROM onu WHERE caja_nap_id=cn.id) as onus_count
          FROM cajas_nap cn
          LEFT JOIN zonas z ON z.id=cn.zona_id
          ${where}
          ORDER BY cn.id DESC
        `).all(...params);
        return res.json({ status: 'success', data: rows });
      }

      // ===== GET (GET) =====
      if (ajaxCn === 'get') {
        const id = parseInt(req.query.id) || 0;
        if (!id) return res.json({ status: 'error', msg: 'ID inv\u00e1lido' });
        const caja = db.prepare(`
          SELECT cn.*, z.nombre as zona_nombre
          FROM cajas_nap cn LEFT JOIN zonas z ON z.id=cn.zona_id WHERE cn.id=?
        `).get(id);
        if (!caja) return res.json({ status: 'error', msg: 'Caja NAP no encontrada' });
        const puertos = [];
        for (let i = 1; i <= caja.puertos; i++) {
          const onu = db.prepare(`
            SELECT o.id, o.sn, o.nombre as onu_nombre, o.senial,
                   c.nombre as cliente_nombre, c.id as cliente_id
            FROM onu o
            LEFT JOIN clientes c ON c.id=o.cliente_id
            WHERE o.caja_nap_id=? AND o.puerto_caja=?
          `).get(id, i);
          puertos.push({
            numero: i,
            libre: !onu,
            onu: onu || null
          });
        }
        const onusDisponibles = db.prepare(`
          SELECT o.id, o.sn, o.nombre as onu_nombre, c.nombre as cliente_nombre
          FROM onu o
          LEFT JOIN clientes c ON c.id=o.cliente_id
          WHERE (o.caja_nap_id IS NULL OR o.caja_nap_id = 0)
          ORDER BY o.sn
        `).all();
        return res.json({ status: 'success', data: caja, puertos, onusDisponibles });
      }

      data.cajas = db.prepare(`
        SELECT cn.*, z.nombre as zona_nombre,
        (SELECT COUNT(*) FROM onu WHERE caja_nap_id=cn.id) as onus_count
        FROM cajas_nap cn LEFT JOIN zonas z ON z.id=cn.zona_id ORDER BY cn.id DESC
      `).all();
      break;
    }
    case 'Inventario': {
      const ajaxInv = req.query.ajax;

      // ==== LIST INVENTORY ITEMS ====
      if (ajaxInv === 'list') {
        const search = (req.body.search || '').trim();
        const category = (req.body.category || '').trim();
        const lowStock = req.body.low_stock === '1';
        const all = req.body.all === '1';
        const page = Math.max(1, parseInt(req.body.page) || 1);
        const perPage = all ? 99999 : 24;
        const offset = (page - 1) * perPage;

        let where = [];
        let params = [];

        if (search) {
          where.push('(i.nombre LIKE ? OR i.codigo LIKE ?)');
          params.push('%' + search + '%', '%' + search + '%');
        }
        if (category) {
          where.push('i.categoria = ?');
          params.push(category);
        }
        if (lowStock) {
          where.push('i.stock <= 5');
        }

        const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

        const totalRow = db.prepare('SELECT COUNT(*) as count FROM inventario i ' + whereClause).get.apply(db, params);
        const total = totalRow ? totalRow.count : 0;
        const totalPages = all ? 1 : Math.max(1, Math.ceil(total / perPage));

        const items = db.prepare('SELECT i.* FROM inventario i ' + whereClause + ' ORDER BY i.nombre ASC LIMIT ? OFFSET ?').all(...params.concat([perPage, offset]));

        // Get distinct categories for the filter dropdown
        const allCats = db.prepare('SELECT DISTINCT categoria FROM inventario WHERE categoria IS NOT NULL AND categoria != \'\' ORDER BY categoria').all();

        return res.json({ success: true, items: items, total: total, totalPages: totalPages, currentPage: page, categories: allCats });
      }

      // ==== GET ITEM BY ID ====
      if (ajaxInv === 'get') {
        const id = parseInt(req.body.id) || 0;
        if (!id) return res.json({ success: false, message: 'ID inv\u00e1lido' });
        const item = db.prepare('SELECT * FROM inventario WHERE id=?').get(id);
        if (!item) return res.json({ success: false, message: 'Producto no encontrado' });
        return res.json({ success: true, item: item });
      }

      // ==== SAVE ITEM (CREATE OR UPDATE) ====
      if (ajaxInv === 'save') {
        const id = parseInt(req.body.id) || 0;
        const codigo = (req.body.codigo || '').trim();
        const nombre = (req.body.nombre || '').trim();
        const categoria = (req.body.categoria || '').trim();
        const stock = parseInt(req.body.stock) || 0;
        const precio = parseFloat(req.body.precio) || 0;
        const esVenta = parseInt(req.body.es_venta) || 0;

        if (!codigo || !nombre) {
          return res.json({ success: false, message: 'C\u00f3digo y nombre son obligatorios' });
        }

        if (id) {
          // Update existing
          const existing = db.prepare('SELECT id FROM inventario WHERE codigo=? AND id!=?').get(codigo, id);
          if (existing) return res.json({ success: false, message: 'El c\u00f3digo ya est\u00e1 en uso' });
          db.prepare('UPDATE inventario SET codigo=?, nombre=?, categoria=?, stock=?, precio=?, es_venta=? WHERE id=?').run(codigo, nombre, categoria, stock, precio, esVenta, id);
          return res.json({ success: true, message: 'Producto actualizado' });
        } else {
          // Create new
          const existing = db.prepare('SELECT id FROM inventario WHERE codigo=?').get(codigo);
          if (existing) return res.json({ success: false, message: 'El c\u00f3digo ya est\u00e1 en uso' });
          db.prepare('INSERT INTO inventario (codigo, nombre, categoria, stock, precio, es_venta) VALUES (?,?,?,?,?,?)').run(codigo, nombre, categoria, stock, precio, esVenta);
          return res.json({ success: true, message: 'Producto creado' });
        }
      }

      // ==== DELETE ITEM ====
      if (ajaxInv === 'delete') {
        const id = parseInt(req.body.id) || 0;
        if (!id) return res.json({ success: false, message: 'ID inv\u00e1lido' });
        // Movimientos se borran en cascada por la FK
        db.prepare('DELETE FROM inventario WHERE id=?').run(id);
        return res.json({ success: true, message: 'Producto eliminado' });
      }

      // ==== ADJUST STOCK (entry/exit) ====
      if (ajaxInv === 'adjust_stock') {
        const inventarioId = parseInt(req.body.inventario_id) || 0;
        const tipo = (req.body.tipo || '').trim();
        const cantidad = parseInt(req.body.cantidad) || 0;
        const tecnicoId = parseInt(req.body.tecnico_id) || null;
        const oficina = (req.body.oficina || '').trim() || null;

        if (!inventarioId || !tipo || cantidad <= 0) {
          return res.json({ success: false, message: 'Datos inv\u00e1lidos' });
        }

        const item = db.prepare('SELECT * FROM inventario WHERE id=?').get(inventarioId);
        if (!item) return res.json({ success: false, message: 'Producto no encontrado' });

        let newStock;
        if (tipo === 'entrada') {
          newStock = (item.stock || 0) + cantidad;
        } else if (tipo === 'salida') {
          if ((item.stock || 0) < cantidad) {
            return res.json({ success: false, message: 'Stock insuficiente. Actual: ' + (item.stock || 0) });
          }
          newStock = (item.stock || 0) - cantidad;
        } else {
          return res.json({ success: false, message: 'Tipo inv\u00e1lido. Use entrada o salida' });
        }

        db.prepare('UPDATE inventario SET stock=? WHERE id=?').run(newStock, inventarioId);
        db.prepare('INSERT INTO inventario_movimientos (inventario_id, tipo, cantidad, tecnico_id, oficina) VALUES (?,?,?,?,?)').run(inventarioId, tipo, cantidad, tecnicoId, oficina);

        return res.json({ success: true, message: 'Stock ajustado correctamente', newStock: newStock });
      }

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
      var ventAjax = req.query.ajax;

      // ===== BUSCAR ARTICULO =====
      if (ventAjax === 'buscar_articulo') {
        const codigo = (req.query.codigo || '').trim().toUpperCase();
        if (!codigo) return res.json({ found: false, message: 'Código requerido' });
        const item = db.prepare("SELECT * FROM inventario WHERE codigo=? AND es_venta=1").get(codigo);
        if (!item) return res.json({ found: false, message: 'Producto no encontrado o no está disponible para venta' });
        if (item.stock <= 0) return res.json({ found: false, message: 'Producto sin stock disponible' });
        return res.json({ found: true, articulo: { id: item.id, codigo: item.codigo, nombre: item.nombre, categoria: item.categoria, precio: item.precio, precio_venta: item.precio, stock: item.stock } });
      }

      // ===== BUSCAR CLIENTE =====
      if (ventAjax === 'buscar_cliente') {
        const q = (req.query.q || '').trim();
        if (q.length < 2) return res.json({ status: 'success', data: [] });
        const rows = db.prepare(`
          SELECT c.id, c.nombre as name, c.cedula, c.apodo as alias, c.telefono as phone,
          (SELECT COUNT(*) FROM servicios WHERE cliente_id=c.id AND estado != 'retirado') as svc_count
          FROM clientes c
          WHERE c.nombre LIKE ? OR c.apodo LIKE ? OR c.cedula LIKE ?
          ORDER BY c.nombre LIMIT 20
        `).all('%'+q+'%', '%'+q+'%', '%'+q+'%');
        return res.json({ status: 'success', data: rows });
      }

      // ===== HISTORIAL =====
      if (ventAjax === 'historial') {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const perPage = 20;
        const search = (req.query.q || '').trim();
        const desde = req.query.desde || '';
        const hasta = req.query.hasta || '';

        let where = 'WHERE 1=1';
        let params = [];

        if (search) {
          where += ` AND (v.cliente_nombre LIKE ? OR EXISTS (
            SELECT 1 FROM ventas_items vi2 JOIN inventario i2 ON i2.id=vi2.inventario_id
            WHERE vi2.venta_id=v.id AND (i2.nombre LIKE ? OR i2.codigo LIKE ?)
          ))`;
          params.push('%' + search + '%', '%' + search + '%', '%' + search + '%');
        }
        if (desde) { where += ' AND date(v.created_at) >= ?'; params.push(desde); }
        if (hasta) { where += ' AND date(v.created_at) <= ?'; params.push(hasta); }

        const countRow = db.prepare(`SELECT COUNT(*) as total FROM ventas v ${where}`).get.apply(db, params);
        const total = countRow ? countRow.total : 0;
        const totalPages = Math.max(1, Math.ceil(total / perPage));
        const offset = (page - 1) * perPage;

        params.push(perPage, offset);
        const rows = db.prepare(`
          SELECT v.*, u.nombre as cobrado_por,
          (SELECT GROUP_CONCAT(i2.nombre || ' x' || vi2.cantidad, ', ') FROM ventas_items vi2 JOIN inventario i2 ON i2.id=vi2.inventario_id WHERE vi2.venta_id=v.id) as items,
          (SELECT i3.codigo FROM ventas_items vi3 JOIN inventario i3 ON i3.id=vi3.inventario_id WHERE vi3.venta_id=v.id LIMIT 1) as codigo,
          (SELECT i3.nombre FROM ventas_items vi3 JOIN inventario i3 ON i3.id=vi3.inventario_id WHERE vi3.venta_id=v.id LIMIT 1) as producto
          FROM ventas v
          LEFT JOIN usuarios u ON u.id=v.usuario_id
          ${where}
          ORDER BY v.created_at DESC LIMIT ? OFFSET ?
        `).all(...params);

        return res.json({ status: 'success', data: rows, page: page, pages: totalPages, total: total });
      }

      // ===== RECIBO =====
      if (ventAjax === 'recibo_venta') {
        const ventaId = parseInt(req.query.id) || 0;
        if (!ventaId) return res.send('ID requerido');

        const venta = db.prepare(`
          SELECT v.*, u.nombre as usuario_nombre
          FROM ventas v LEFT JOIN usuarios u ON u.id=v.usuario_id WHERE v.id=?
        `).get(ventaId);

        if (!venta) return res.send('Venta no encontrada');

        const items = db.prepare(`
          SELECT vi.*, i.nombre, i.codigo
          FROM ventas_items vi JOIN inventario i ON i.id=vi.inventario_id
          WHERE vi.venta_id=?
        `).all(ventaId);

        res.set('Content-Type', 'text/html; charset=utf-8');
        let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recibo #${venta.id}</title>
        <style>
          body{font-family:monospace;font-size:12px;margin:0;padding:20px;max-width:300px;}
          .header{text-align:center;margin-bottom:10px;}
          .header h2{margin:0;font-size:16px;}
          .line{border-top:1px dashed #000;margin:8px 0;}
          table{width:100%;border-collapse:collapse;}
          table th{text-align:left;font-size:10px;padding:2px 0;}
          table td{padding:2px 0;}
          .right{text-align:right;}
          .total{font-weight:bold;font-size:14px;margin-top:6px;}
          .footer{text-align:center;margin-top:12px;font-size:10px;color:#666;}
          @media print{@page{margin:0;}body{padding:10px;}}
        </style></head><body>
        <div class="header">
          <h2>RECIBO DE VENTA</h2>
          <div>#${venta.id}</div>
          <div>${new Date(venta.created_at).toLocaleString('es-DO')}</div>
        </div>
        <div class="line"></div>
        <div><strong>Cliente:</strong> ${venta.cliente_nombre || 'N/A'}</div>
        <div><strong>Atendió:</strong> ${venta.usuario_nombre || 'N/A'}</div>
        <div class="line"></div>
        <table><tr><th>Producto</th><th class="right">Cant</th><th class="right">Precio</th><th class="right">Subtotal</th></tr>`;

        items.forEach(function(it) {
          var subtotal = it.cantidad * it.precio_unitario;
          html += `<tr><td>${it.nombre}</td><td class="right">${it.cantidad}</td><td class="right">$${parseFloat(it.precio_unitario).toFixed(2)}</td><td class="right">$${subtotal.toFixed(2)}</td></tr>`;
        });

        html += `</table><div class="line"></div>
        <div class="total right">Total: $${parseFloat(venta.total).toFixed(2)}</div>
        <div style="margin-top:4px;"><strong>Método:</strong> ${venta.metodo_pago || 'EFECTIVO'}</div>
        <div class="footer">Gracias por su compra</div>
        <script>window.print();<\/script>
        </body></html>`;

        return res.send(html);
      }

      data.itemsVenta = db.prepare("SELECT * FROM inventario WHERE es_venta=1 AND stock>0").all();
      break;
    }
    case 'Proveedores': {
      const ajax = req.query.ajax;
      
      // ==== LIST SUPPLIERS ====
      if (ajax === 'list_suppliers') {
        const search = (req.query.search || '').trim();
        const filter = req.query.filter || 'all';
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = req.query.limit === 'all' ? 9999 : 20;
        const offset = (page - 1) * limit;

        let where = '';
        let params = [];

        if (search) {
          where = 'WHERE (p.nombre LIKE ? OR p.rnc LIKE ?)';
          params.push(`%${search}%`, `%${search}%`);
        }

        if (filter === 'al_dia') {
          // al día: sin deuda pendiente
          const clause = '(SELECT COALESCE(SUM(monto - pagado),0) FROM facturas_compra WHERE proveedor_id=p.id AND pagado < monto) = 0';
          if (where) where = where + ' AND ' + clause;
          else { where = 'WHERE ' + clause; }
        } else if (filter === 'pendiente') {
          const clause = `(SELECT COUNT(*) FROM facturas_compra WHERE proveedor_id=p.id AND pagado < monto AND monto - pagado > 0) > 0`;
          if (where) where = `${where} AND ${clause}`;
          else { where = `WHERE ${clause}`; }
        } else if (filter === 'vencida') {
          const clause = `(SELECT COUNT(*) FROM facturas_compra WHERE proveedor_id=p.id AND pagado < monto AND monto - pagado > 0 AND fecha_vencimiento < date('now')) > 0`;
          if (where) where = `${where} AND ${clause}`;
          else { where = `WHERE ${clause}`; }
        }

        const rows = db.prepare(`
          SELECT p.id, p.nombre as name, p.rnc, p.direccion as address,
          (SELECT COALESCE(SUM(monto - pagado),0) FROM facturas_compra WHERE proveedor_id=p.id AND pagado < monto) as pending_debt,
          (SELECT COUNT(*) FROM facturas_compra WHERE proveedor_id=p.id AND pagado < monto AND monto - pagado > 0 AND fecha_vencimiento < date('now')) as overdue_count,
          (SELECT GROUP_CONCAT(ps.nombre_servicio, ', ') FROM proveedores_servicios ps WHERE ps.proveedor_id=p.id LIMIT 3) as services_list
          FROM proveedores p
          ${where}
          ORDER BY pending_debt DESC, p.id DESC
          LIMIT ? OFFSET ?
        `).all(...params, limit, offset);

        return res.json({ status: 'success', data: rows });
      }

      // ==== GET SUPPLIER ====
      if (ajax === 'get_supplier') {
        const id = parseInt(req.query.id) || 0;
        if (!id) return res.json({ status: 'error', msg: 'ID inválido' });

        const supplier = db.prepare(`
          SELECT p.id, p.nombre as name, p.rnc, p.direccion as address, p.notas as notes, p.created_at
          FROM proveedores p WHERE p.id=?
        `).get(id);

        if (!supplier) return res.json({ status: 'error', msg: 'Proveedor no encontrado' });

        const services = db.prepare('SELECT ps.id, ps.nombre_servicio as service_name FROM proveedores_servicios ps WHERE ps.proveedor_id=?').all(id);
        const contacts = db.prepare('SELECT pc.id, pc.nombre_contacto as contact_name, pc.telefono as phone, pc.email, pc.cargo as role FROM proveedores_contactos pc WHERE pc.proveedor_id=?').all(id);

        return res.json({ status: 'success', data: supplier, services: services, contacts: contacts });
      }

      // ==== SAVE SUPPLIER ====
      if (ajax === 'save_supplier') {
        const id = parseInt(req.body.id) || 0;
        const name = (req.body.name || '').trim();
        const rnc = (req.body.rnc || '').trim();
        const address = (req.body.address || '').trim();
        const notes = (req.body.notes || '').trim();
        let services = [];
        let contacts = [];

        try { services = JSON.parse(req.body.services || '[]'); } catch(e) { services = []; }
        try { contacts = JSON.parse(req.body.contacts || '[]'); } catch(e) { contacts = []; }

        if (!name) return res.json({ status: 'error', msg: 'El nombre es obligatorio' });

        if (id) {
          db.prepare('UPDATE proveedores SET nombre=?, rnc=?, direccion=?, notas=? WHERE id=?').run(name, rnc, address, notes, id);

          // Reemplazar servicios
          db.prepare('DELETE FROM proveedores_servicios WHERE proveedor_id=?').run(id);
          services.forEach(function(s) {
            if (s.name) db.prepare('INSERT INTO proveedores_servicios (proveedor_id, nombre_servicio) VALUES (?,?)').run(id, s.name);
          });

          // Reemplazar contactos
          db.prepare('DELETE FROM proveedores_contactos WHERE proveedor_id=?').run(id);
          contacts.forEach(function(c) {
            if (c.name) db.prepare('INSERT INTO proveedores_contactos (proveedor_id, nombre_contacto, telefono, email, cargo) VALUES (?,?,?,?,?)').run(id, c.name, c.phone || '', c.email || '', c.role || '');
          });

          return res.json({ status: 'success', id: id, msg: 'Proveedor actualizado' });
        } else {
          const r = db.prepare('INSERT INTO proveedores (nombre, rnc, direccion, notas) VALUES (?,?,?,?)').run(name, rnc, address, notes);
          const newId = r.lastInsertRowid;

          services.forEach(function(s) {
            if (s.name) db.prepare('INSERT INTO proveedores_servicios (proveedor_id, nombre_servicio) VALUES (?,?)').run(newId, s.name);
          });
          contacts.forEach(function(c) {
            if (c.name) db.prepare('INSERT INTO proveedores_contactos (proveedor_id, nombre_contacto, telefono, email, cargo) VALUES (?,?,?,?,?)').run(newId, c.name, c.phone || '', c.email || '', c.role || '');
          });

          return res.json({ status: 'success', id: newId, msg: 'Proveedor creado' });
        }
      }

      // ==== DELETE SUPPLIER ====
      if (ajax === 'delete_supplier') {
        const id = parseInt(req.body.id) || 0;
        if (!id) return res.json({ status: 'error', msg: 'ID inválido' });

        db.prepare('DELETE FROM proveedores_contactos WHERE proveedor_id=?').run(id);
        db.prepare('DELETE FROM proveedores_servicios WHERE proveedor_id=?').run(id);
        db.prepare('DELETE FROM pagos_compra WHERE factura_id IN (SELECT id FROM facturas_compra WHERE proveedor_id=?)').run(id);
        db.prepare('DELETE FROM facturas_compra WHERE proveedor_id=?').run(id);
        db.prepare('DELETE FROM proveedores WHERE id=?').run(id);

        return res.json({ status: 'success', msg: 'Proveedor eliminado' });
      }

      // ==== LIST INVOICES ====
      if (ajax === 'list_invoices') {
        const supplierId = parseInt(req.query.supplier_id) || 0;
        if (!supplierId) return res.json({ status: 'error', msg: 'ID de proveedor requerido' });

        const invoices = db.prepare(`
          SELECT fc.id, fc.numero as invoice_number, fc.monto as total, fc.concepto as concept,
          fc.pagado as paid_amount, (fc.monto - fc.pagado) as remaining,
          fc.fecha_emision as issue_date, fc.fecha_vencimiento as due_date, fc.notas as notes,
          fc.pagado, fc.monto,
          CASE
            WHEN fc.pagado >= fc.monto THEN 'paid'
            WHEN fc.pagado > 0 THEN 'partial'
            ELSE 'pending'
          END as status
          FROM facturas_compra fc
          WHERE fc.proveedor_id=?
          ORDER BY fc.fecha_vencimiento ASC, fc.id DESC
        `).all(supplierId);

        return res.json({ status: 'success', data: invoices });
      }

      // ==== CREATE INVOICE ====
      if (ajax === 'create_invoice') {
        const supplierId = parseInt(req.body.supplier_id) || 0;
        const invoiceNumber = (req.body.invoice_number || '').trim();
        const concept = (req.body.concept || '').trim();
        const total = parseFloat(req.body.total) || 0;
        const issueDate = req.body.issue_date || null;
        const dueDate = req.body.due_date || null;
        const notes = (req.body.notes || '').trim();

        if (!supplierId || !concept || total <= 0) {
          return res.json({ status: 'error', msg: 'Faltan campos requeridos' });
        }

        db.prepare('INSERT INTO facturas_compra (proveedor_id, numero, monto, concepto, fecha_emision, fecha_vencimiento, notas) VALUES (?,?,?,?,?,?,?)').run(supplierId, invoiceNumber, total, concept, issueDate, dueDate, notes);

        return res.json({ status: 'success', msg: 'Factura creada' });
      }

      // ==== EDIT INVOICE ====
      if (ajax === 'edit_invoice') {
        const invoiceId = parseInt(req.body.invoice_id) || 0;
        const invoiceNumber = (req.body.invoice_number || '').trim();
        const concept = (req.body.concept || '').trim();
        const total = parseFloat(req.body.total) || 0;
        const issueDate = req.body.issue_date || null;
        const dueDate = req.body.due_date || null;
        const notes = (req.body.notes || '').trim();

        if (!invoiceId || !concept || total <= 0) {
          return res.json({ status: 'error', msg: 'Faltan campos requeridos' });
        }

        // Only allow editing if no payments made
        const inv = db.prepare('SELECT * FROM facturas_compra WHERE id=?').get(invoiceId);
        if (!inv) return res.json({ status: 'error', msg: 'Factura no encontrada' });
        if (parseFloat(inv.pagado) > 0) return res.json({ status: 'error', msg: 'No se puede editar una factura con pagos' });

        db.prepare('UPDATE facturas_compra SET numero=?, monto=?, concepto=?, fecha_emision=?, fecha_vencimiento=?, notas=? WHERE id=?').run(invoiceNumber, total, concept, issueDate, dueDate, notes, invoiceId);

        return res.json({ status: 'success', msg: 'Factura actualizada' });
      }

      // ==== DELETE INVOICE ====
      if (ajax === 'delete_invoice') {
        const invoiceId = parseInt(req.body.invoice_id) || 0;
        if (!invoiceId) return res.json({ status: 'error', msg: 'ID inválido' });

        const inv = db.prepare('SELECT * FROM facturas_compra WHERE id=?').get(invoiceId);
        if (!inv) return res.json({ status: 'error', msg: 'Factura no encontrada' });
        if (parseFloat(inv.pagado) > 0) return res.json({ status: 'error', msg: 'No se puede eliminar una factura con pagos' });

        db.prepare('DELETE FROM pagos_compra WHERE factura_id=?').run(invoiceId);
        db.prepare('DELETE FROM facturas_compra WHERE id=?').run(invoiceId);

        return res.json({ status: 'success', msg: 'Factura eliminada' });
      }

      // ==== PAY INVOICE ====
      if (ajax === 'pay_invoice') {
        const invoiceId = parseInt(req.body.invoice_id) || 0;
        const amount = parseFloat(req.body.amount) || 0;
        const payMethod = (req.body.payment_method || 'Efectivo').trim();
        const reference = (req.body.reference || '').trim();
        const notes = (req.body.notes || '').trim();

        if (!invoiceId || amount <= 0) return res.json({ status: 'error', msg: 'Datos inválidos' });

        const inv = db.prepare('SELECT * FROM facturas_compra WHERE id=?').get(invoiceId);
        if (!inv) return res.json({ status: 'error', msg: 'Factura no encontrada' });

        const newPaid = parseFloat(inv.pagado) + amount;
        if (newPaid > inv.monto + 0.01) return res.json({ status: 'error', msg: 'El pago excede el monto de la factura' });

        // Update invoice paid amount
        db.prepare('UPDATE facturas_compra SET pagado=? WHERE id=?').run(newPaid, invoiceId);

        // Register payment in pagos_compra
        db.prepare('INSERT INTO pagos_compra (factura_id, monto, metodo, referencia, notas, fecha_pago) VALUES (?,?,?,?,?,date(\'now\'))').run(invoiceId, amount, payMethod, reference, notes);

        // Also register in gastos for accounting
        db.prepare(`
          INSERT INTO gastos (concepto, monto, metodo, referencia, notas, tipo, reference_id, usuario_id, categoria, payment_date)
          VALUES (?,?,?,?,?,'proveedor',?,?,'Proveedores',date('now'))
        `).run('Pago a proveedor factura #' + invoiceId + ' - ' + (inv.concept || ''), amount, payMethod, reference, notes, invoiceId, req.session.user.id);

        return res.json({ status: 'success', msg: 'Pago registrado' });
      }

      // ==== PAYMENT HISTORY ====
      if (ajax === 'payment_history') {
        const invoiceId = parseInt(req.query.invoice_id) || 0;
        if (!invoiceId) return res.json({ status: 'error', msg: 'ID de factura requerido' });

        const history = db.prepare(`
          SELECT pc.id, pc.monto as amount, pc.metodo as payment_method, pc.referencia as reference,
          pc.notas as notes, pc.fecha_pago as payment_date, pc.created_at
          FROM pagos_compra pc
          WHERE pc.factura_id=?
          ORDER BY pc.created_at DESC
        `).all(invoiceId);

        return res.json({ status: 'success', data: history });
      }

      // Legacy: if no ajax param, just pass data
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
    case 'PagosPendientes': {
      // Primero contar total real (sin LIMIT)
      var countRow = db.prepare("SELECT COUNT(*) as total FROM facturas f WHERE f.estado='pendiente' AND f.monto > COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0)").get();
      data.pendientes_count = countRow ? countRow.total : 0;
      
      data.pendientes = db.prepare(`
        SELECT f.id as factura_id, c.id as cliente_id, c.nombre as cliente_nombre, c.telefono,
          p.nombre as plan_name, f.monto, f.fecha_vencimiento,
          COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0) as pagado,
          s.id as servicio_id, s.direccion
        FROM facturas f
        JOIN servicios s ON s.id=f.servicio_id
        JOIN clientes c ON c.id=s.cliente_id
        LEFT JOIN planes p ON p.id=s.plan_id
        WHERE f.estado='pendiente' AND f.monto > COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0)
        ORDER BY c.nombre ASC
      `).all();
      data.zonas = db.prepare('SELECT * FROM zonas ORDER BY nombre').all();
      break;
    }
    case 'PagosAdmin': {
      // AJAX handlers for PagosAdmin
      const ajax = req.query.ajax;
      
      // --- Listar proveedores con deuda pendiente ---
      if (ajax === 'pa_suppliers') {
        const search = (req.query.search || '').trim();
        let rows;
        if (search) {
          rows = db.prepare(`
            SELECT p.id, p.nombre as name, p.rnc, p.telefono,
            (SELECT COUNT(*) FROM facturas_compra WHERE proveedor_id=p.id AND pagado < monto) as pending_count,
            (SELECT COALESCE(SUM(monto - pagado),0) FROM facturas_compra WHERE proveedor_id=p.id AND pagado < monto) as pending_debt
            FROM proveedores p
            WHERE p.nombre LIKE ? OR p.rnc LIKE ?
            ORDER BY pending_debt DESC
          `).all(`%${search}%`, `%${search}%`);
        } else {
          rows = db.prepare(`
            SELECT p.id, p.nombre as name, p.rnc, p.telefono,
            (SELECT COUNT(*) FROM facturas_compra WHERE proveedor_id=p.id AND pagado < monto) as pending_count,
            (SELECT COALESCE(SUM(monto - pagado),0) FROM facturas_compra WHERE proveedor_id=p.id AND pagado < monto) as pending_debt
            FROM proveedores p
            HAVING pending_count > 0
            ORDER BY pending_debt DESC
          `).all();
        }
        return res.json({ status: 'success', data: rows });
      }
      
      // --- Facturas pendientes de un proveedor ---
      if (ajax === 'pa_invoices') {
        const supId = parseInt(req.query.supplier_id) || 0;
        if (!supId) return res.json({ status: 'error', msg: 'ID de proveedor requerido' });
        const invoices = db.prepare(`
          SELECT fc.id, fc.numero as invoice_number, fc.concepto as concept, fc.monto as total,
          fc.pagado as paid_amount, (fc.monto - fc.pagado) as remaining,
          fc.fecha_vencimiento as due_date, fc.fecha_emision,
          CASE WHEN fc.pagado > 0 AND fc.pagado < fc.monto THEN 'partial' ELSE 'pending' END as status
          FROM facturas_compra fc
          WHERE fc.proveedor_id=? AND fc.pagado < fc.monto
          ORDER BY fc.fecha_vencimiento ASC
        `).all(supId);
        return res.json({ status: 'success', data: invoices });
      }
      
      // --- Pagar factura de proveedor ---
      if (ajax === 'pa_pay_invoice') {
        const invId = parseInt(req.body.invoice_id) || 0;
        const amount = parseFloat(req.body.amount) || 0;
        const method = req.body.method || 'Efectivo';
        const reference = (req.body.reference || '').trim();
        const notes = (req.body.notes || '').trim();
        if (!invId || amount <= 0) return res.json({ status: 'error', msg: 'Datos inválidos' });
        
        const inv = db.prepare('SELECT * FROM facturas_compra WHERE id=?').get(invId);
        if (!inv) return res.json({ status: 'error', msg: 'Factura no encontrada' });
        
        const newPaid = parseFloat(inv.pagado) + amount;
        if (newPaid > inv.monto + 0.01) return res.json({ status: 'error', msg: 'El pago excede el monto de la factura' });
        
        db.prepare('UPDATE facturas_compra SET pagado=? WHERE id=?').run(newPaid, invId);
        
        // Register in gastos
        db.prepare(`
          INSERT INTO gastos (concepto, monto, metodo, referencia, notas, tipo, reference_id, usuario_id, categoria, payment_date)
          VALUES (?,?,?,?,?,'proveedor',?,?,'Proveedores',date('now'))
        `).run('Pago a proveedor #' + invId + ' - ' + (inv.concept || ''), amount, method, reference, notes, invId, req.session.user.id);
        
        return res.json({ status: 'success', msg: 'Pago registrado' });
      }
      
      // --- Listar empleados ---
      if (ajax === 'pa_employees') {
        const search = (req.query.search || '').trim();
        let rows;
        if (search) {
          rows = db.prepare(`
            SELECT e.id, e.nombre as name, e.tipo as employee_type, e.tipo_otro as employee_type_other,
            e.salario as salary, e.periodo as salary_period, e.dia_pago1 as pay_day_1, e.dia_pago2 as pay_day_2,
            COALESCE((SELECT SUM(restante) FROM prestamos_empleado WHERE empleado_id=e.id AND restante>0),0) as loan_balance
            FROM empleados e WHERE e.activo=1 AND e.nombre LIKE ?
            ORDER BY e.nombre
          `).all(`%${search}%`);
        } else {
          rows = db.prepare(`
            SELECT e.id, e.nombre as name, e.tipo as employee_type, e.tipo_otro as employee_type_other,
            e.salario as salary, e.periodo as salary_period, e.dia_pago1 as pay_day_1, e.dia_pago2 as pay_day_2,
            COALESCE((SELECT SUM(restante) FROM prestamos_empleado WHERE empleado_id=e.id AND restante>0),0) as loan_balance
            FROM empleados e WHERE e.activo=1 ORDER BY e.nombre
          `).all();
        }
        return res.json({ status: 'success', data: rows });
      }
      
      // --- Detalle de empleado (con historial de pagos) ---
      if (ajax === 'pa_employee_detail' || ajax === 'pa_employee') {
        const empId = parseInt(req.query.id) || 0;
        if (!empId) return res.json({ status: 'error', msg: 'ID de empleado requerido' });
        const emp = db.prepare(`
          SELECT e.id, e.nombre as name, e.tipo as employee_type, e.tipo_otro as employee_type_other,
          e.salario as salary, e.periodo as salary_period, e.dia_pago1 as pay_day_1, e.dia_pago2 as pay_day_2,
          COALESCE((SELECT SUM(restante) FROM prestamos_empleado WHERE empleado_id=e.id AND restante>0),0) as loan_balance,
          (SELECT COUNT(*) FROM prestamos_empleado WHERE empleado_id=e.id AND restante>0) as active_loans
          FROM empleados e WHERE e.id=?
        `).get(empId);
        if (!emp) return res.json({ status: 'error', msg: 'Empleado no encontrado' });
        
        // Payment history
        const history = db.prepare(`
          SELECT id, monto as amount, periodo_label, metodo as payment_method, payment_date
          FROM gastos WHERE employee_id=? AND tipo='empleado'
          ORDER BY created_at DESC LIMIT 10
        `).all(empId);
        
        return res.json({ status: 'success', data: emp, history: history });
      }
      
      // --- Pagar empleado ---
      if (ajax === 'pa_pay_employee') {
        const empId = parseInt(req.body.employee_id) || 0;
        const amount = parseFloat(req.body.amount) || 0;
        const periodLabel = (req.body.period_label || '').trim();
        const method = req.body.method || 'Efectivo';
        const reference = (req.body.reference || '').trim();
        const notes = (req.body.notes || '').trim();
        const loanDeduction = parseFloat(req.body.loan_deduction) || 0;
        
        if (!empId || amount <= 0) return res.json({ status: 'error', msg: 'Datos inválidos' });
        
        // Register payment in gastos
        db.prepare(`
          INSERT INTO gastos (concepto, monto, metodo, referencia, notas, tipo, employee_id, usuario_id, periodo_label, categoria, payment_date)
          VALUES (?,?,?,?,?,'empleado',?,?,?,'Empleados',date('now'))
        `).run('Pago a empleado #' + empId, amount, method, reference, notes, empId, req.session.user.id, periodLabel || null);
        
        let loanMsg = '';
        // Handle loan deduction if applicable
        if (loanDeduction > 0) {
          // Find active loans
          const loans = db.prepare('SELECT * FROM prestamos_empleado WHERE empleado_id=? AND restante>0 ORDER BY id ASC').all(empId);
          let remaining = loanDeduction;
          for (const loan of loans) {
            if (remaining <= 0) break;
            const deduct = Math.min(remaining, parseFloat(loan.restante));
            const newRest = parseFloat(loan.restante) - deduct;
            db.prepare('UPDATE prestamos_empleado SET restante=? WHERE id=?').run(newRest, loan.id);
            remaining -= deduct;
          }
          loanMsg = 'Se abonaron ' + loanDeduction.toFixed(2) + ' al préstamo';
        }
        
        return res.json({ status: 'success', msg: 'Pago registrado', loan_msg: loanMsg });
      }
      
      // --- Otro pago (gasto general) ---
      if (ajax === 'pa_pay_other') {
        const concept = (req.body.concept || '').trim();
        const amount = parseFloat(req.body.amount) || 0;
        const method = req.body.method || 'Efectivo';
        const reference = (req.body.reference || '').trim();
        const notes = (req.body.notes || '').trim();
        
        if (!concept || amount <= 0) return res.json({ status: 'error', msg: 'Concepto y monto requeridos' });
        
        const categoria = req.body.categoria === 'personal' ? 'Personal' : 'Empresa';
        const paymentDate = req.body.payment_date || new Date().toISOString().split('T')[0];
        db.prepare(`
          INSERT INTO gastos (concepto, monto, metodo, referencia, notas, tipo, usuario_id, categoria, payment_date)
          VALUES (?,?,?,?,?,'otro',?,?,?)
        `).run(concept, amount, method, reference, notes, req.session.user.id, categoria, paymentDate);
        
        return res.json({ status: 'success', msg: 'Gasto registrado' });
      }
      
      // --- Pagos recientes (últimos 20) ---
      if (ajax === 'pa_recent') {
        const rows = db.prepare(`
          SELECT id, concepto as descripcion, monto as amount, metodo as payment_method,
          payment_date, tipo, created_at, employee_id, categoria, referencia as reference, notas as notes,
          CASE tipo
            WHEN 'proveedor' THEN 'proveedor'
            WHEN 'empleado' THEN 'empleado'
            ELSE 'otro'
          END as tipo
          FROM gastos
          ORDER BY created_at DESC LIMIT 20
        `).all();
        return res.json({ status: 'success', data: rows });
      }
      
      // --- Eliminar pago ---
      if (ajax === 'pa_delete_payment' || ajax === 'pa_delete') {
        const id = parseInt(req.body.id || req.query.id) || 0;
        const tipo = req.body.tipo || '';
        if (!id) return res.json({ status: 'error', msg: 'ID requerido' });
        
        db.prepare('DELETE FROM gastos WHERE id=?').run(id);
        return res.json({ status: 'success', msg: 'Pago eliminado' });
      }

      // --- Editar otro pago ---
      if (ajax === 'pa_edit_other') {
        const id = parseInt(req.body.id) || 0;
        const concept = (req.body.concept || '').trim();
        const amount = parseFloat(req.body.amount) || 0;
        const method = req.body.method || 'Efectivo';
        const reference = (req.body.reference || '').trim();
        const notes = (req.body.notes || '').trim();
        const categoria = req.body.categoria === 'personal' ? 'Personal' : 'Empresa';
        const paymentDate = req.body.payment_date || '';
        if (!id || !concept || amount <= 0) return res.json({ status: 'error', msg: 'Datos inválidos' });
        db.prepare('UPDATE gastos SET concepto=?, monto=?, metodo=?, referencia=?, notas=?, categoria=?, payment_date=? WHERE id=?').run(concept, amount, method, reference, notes, categoria, paymentDate, id);
        return res.json({ status: 'success', msg: 'Gasto actualizado' });
      }
      
      break;
    }
    case 'Estadisticas': {
      const ajax = req.query.ajax;

      // --- dashboard: estadísticas generales + pagos por mes para Chart.js ---
      if (ajax === 'dashboard') {
        const year = parseInt(req.query.year) || new Date().getFullYear();

        const ingresosMes = db.prepare("SELECT COALESCE(SUM(monto),0) as t FROM pagos WHERE strftime('%Y-%m', created_at)=strftime('%Y-%m','now')").get().t;
        const activos = db.prepare("SELECT COUNT(*) as c FROM servicios WHERE estado='activo'").get().c;
        const suspendidos = db.prepare("SELECT COUNT(*) as c FROM servicios WHERE estado='suspendido'").get().c;
        const serviciosTotales = db.prepare('SELECT COUNT(*) as c FROM servicios').get().c;
        const cobradoHoy = db.prepare("SELECT COALESCE(SUM(monto),0) as t FROM pagos WHERE date(created_at)=date('now')").get().t;
        const cobradoMes = db.prepare("SELECT COALESCE(SUM(monto),0) as t FROM pagos WHERE strftime('%Y-%m', created_at)=strftime('%Y-%m','now')").get().t;
        const pendienteTotal = db.prepare("SELECT COALESCE(SUM(f.monto - COALESCE((SELECT SUM(p.monto) FROM pagos p WHERE p.factura_id=f.id),0)),0) as t FROM facturas f WHERE f.estado='pendiente'").get().t;

        // Pagos por mes (12 meses)
        const pagosPorMes = db.prepare(`
          SELECT strftime('%m', created_at) as mes, strftime('%Y', created_at) as anio, COALESCE(SUM(monto),0) as total
          FROM pagos
          WHERE strftime('%Y', created_at) = ?
          GROUP BY strftime('%m', created_at), strftime('%Y', created_at)
          ORDER BY mes
        `).all(String(year));

        // Instalados vs retirados por mes (12 meses)
        const instaladosMes = db.prepare(`
          SELECT substr(fecha_activacion,6,2) as mes, COUNT(*) as total
          FROM servicios
          WHERE strftime('%Y', fecha_activacion) = ?
          GROUP BY substr(fecha_activacion,6,2)
          ORDER BY mes
        `).all(String(year));

        const retiradosMes = db.prepare(`
          SELECT substr(fecha_suspension,6,2) as mes, COUNT(*) as total
          FROM servicios
          WHERE strftime('%Y', fecha_suspension) = ? AND fecha_suspension IS NOT NULL
          GROUP BY substr(fecha_suspension,6,2)
          ORDER BY mes
        `).all(String(year));

        return res.json({
          success: true,
          stats: {
            ingresosMes: ingresosMes,
            clientesActivos: activos,
            clientesSuspendidos: suspendidos,
            serviciosTotales: serviciosTotales,
            cobradoHoy: cobradoHoy,
            cobradoMes: cobradoMes,
            pendienteTotal: pendienteTotal
          },
          pagosPorMes: pagosPorMes,
          instaladosMes: instaladosMes,
          retiradosMes: retiradosMes
        });
      }

      // --- recent_payments: últimos pagos registrados ---
      if (ajax === 'recent_payments') {
        const limit = parseInt(req.query.limit) || 20;
        const pagos = db.prepare(`
          SELECT p.id, p.monto, p.metodo, p.created_at, c.nombre as cliente_nombre, c.id as cliente_id,
                 z.nombre as zona_nombre
          FROM pagos p
          LEFT JOIN clientes c ON c.id = p.cliente_id
          LEFT JOIN servicios s ON s.id = p.servicio_id
          LEFT JOIN zonas z ON z.id = s.zona_id
          ORDER BY p.id DESC
          LIMIT ?
        `).all(limit);
        return res.json({ success: true, data: pagos });
      }

      // --- Initial page load data ---
      if (!ajax) {
        data.stats = {
          totalClientes: db.prepare('SELECT COUNT(*) as c FROM clientes').get().c,
          activos: db.prepare("SELECT COUNT(*) as c FROM servicios WHERE estado='activo'").get().c,
          suspendidos: db.prepare("SELECT COUNT(*) as c FROM servicios WHERE estado='suspendido'").get().c,
          ingresosMes: db.prepare("SELECT COALESCE(SUM(monto),0) as t FROM pagos WHERE strftime('%Y-%m', created_at)=strftime('%Y-%m','now')").get().t,
          gastosMes: db.prepare("SELECT COALESCE(SUM(monto),0) as t FROM gastos WHERE strftime('%Y-%m', created_at)=strftime('%Y-%m','now')").get().t
        };
      }
      break;
    }
    case 'Planes': {
      data.zonas = db.prepare('SELECT * FROM zonas ORDER BY nombre').all();
      const counts = db.prepare('SELECT plan_id, COUNT(*) as c FROM servicios GROUP BY plan_id').all();
      data.planCounts = {};
      counts.forEach(function(r) { data.planCounts[r.plan_id] = r.c; });
      break;
    }
    case 'Smartolt': {
      const soCfg = db.prepare("SELECT key, value FROM configuracion WHERE key LIKE 'smartolt_%' OR key = 'smartolt_name'").all();
      data.smartoltConfig = {};
      soCfg.forEach(function(c) { data.smartoltConfig[c.key.replace('smartolt_', '')] = c.value; });
      data.olts = db.prepare('SELECT * FROM olts').all();
      break;
    }
    case 'VerCliente': {
      const cid = parseInt(req.query.id) || 0;
      data.cliente = db.prepare('SELECT c.*, z.nombre as zona_nombre FROM clientes c LEFT JOIN zonas z ON z.id=c.zona_id WHERE c.id=?').get(cid);
      if (!data.cliente) return res.redirect('/modulo?pagina=Clientes');
      data.servicios = db.prepare('SELECT s.*, p.nombre as plan_nombre, p.precio as plan_precio, z.nombre as zona_nombre FROM servicios s LEFT JOIN planes p ON p.id=s.plan_id LEFT JOIN zonas z ON z.id=s.zona_id WHERE s.cliente_id=? ORDER BY s.id DESC').all(cid);
      // Agregar información de deuda por servicio
      data.servicios.forEach(function(s) {
        var deuda = db.prepare("SELECT COALESCE(SUM(f.monto - COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0)),0) as total FROM facturas f WHERE f.servicio_id=? AND f.estado='pendiente'").get(s.id);
        s.deuda_total = deuda ? deuda.total : 0;
        s.al_dia = (s.deuda_total <= 0);
      });
      data.facturas = db.prepare('SELECT f.* FROM facturas f JOIN servicios s ON s.id=f.servicio_id WHERE s.cliente_id=? ORDER BY f.id DESC LIMIT 20').all(cid);
      data.pagos = db.prepare('SELECT p.* FROM pagos p WHERE p.cliente_id=? ORDER BY p.id DESC LIMIT 20').all(cid);
      data.ordenes = db.prepare('SELECT o.*, e.nombre as tecnico_nombre FROM ordenes o LEFT JOIN empleados e ON e.id=o.tecnico_id WHERE o.cliente_id=? ORDER BY o.id DESC LIMIT 10').all(cid);
      data.promesas = db.prepare('SELECT * FROM promesas_pago WHERE cliente_id=? ORDER BY id DESC LIMIT 10').all(cid);
      data.planes = db.prepare('SELECT * FROM planes ORDER BY nombre').all();
      data.zonas = db.prepare('SELECT * FROM zonas ORDER BY nombre').all();
      data.empleados = db.prepare('SELECT * FROM empleados WHERE activo=1').all();
      data.cajasNap = db.prepare('SELECT * FROM cajas_nap').all();
      data.ciclos = db.prepare('SELECT * FROM billing_cycles ORDER BY id').all();
      break;
    }
    case 'Monitoreo': {
      const ajax = req.query.ajax;

      // --- traffic: datos de tráfico WAN de wan_traffic ---
      if (ajax === 'traffic') {
        const horas = parseInt(req.body.horas) || 24;
        const routerId = parseInt(req.body.router_id) || 0;
        const routerFilter = routerId > 0 ? 'AND wt.router_id='+routerId : '';
        const rows = db.prepare(`
          SELECT strftime('%Y-%m-%dT%H:%M:%S', wt.created_at) as ts, wt.bps_in, wt.bps_out, wt.router_id, r.name as router_name
          FROM wan_traffic wt LEFT JOIN routers r ON r.id=wt.router_id
          WHERE wt.created_at >= datetime('now','-${horas} hours','localtime') ${routerFilter}
          ORDER BY wt.created_at ASC
        `).all();
        return res.json({ success: true, data: rows });
      }

      // --- system: CPU, RAM, disco del servidor ---
      if (ajax === 'system') {
        var os = require('os');
        var cpus = os.cpus();
        var cpuLoad = 0;
        if (cpus && cpus.length > 0) {
          var totalIdle = 0, totalTick = 0;
          cpus.forEach(function(cpu) {
            for (var type in cpu.times) {
              totalTick += cpu.times[type];
            }
            totalIdle += cpu.times.idle;
          });
          cpuLoad = 100 - (totalIdle / totalTick * 100);
        }
        var totalMem = os.totalmem();
        var freeMem = os.freemem();
        var usedMem = totalMem - freeMem;
        var memPercent = (usedMem / totalMem) * 100;

        var execSync = require('child_process').execSync;
        var diskInfo = { used: 0, total: 1, percent: 0 };
        try {
          var dfOut = execSync('df -B1 / | tail -1', {timeout: 3000}).toString().trim().split(/\s+/);
          if (dfOut.length >= 4) {
            var dfTotal = parseInt(dfOut[1]) || 1;
            var dfUsed = parseInt(dfOut[2]) || 0;
            var dfAvail = parseInt(dfOut[3]) || 0;
            diskInfo = { used: dfUsed, total: dfTotal + dfUsed, percent: (dfUsed / (dfTotal + dfUsed)) * 100 };
          }
        } catch(e) {}

        var uptime = os.uptime();
        var days = Math.floor(uptime / 86400);
        var hours = Math.floor((uptime % 86400) / 3600);
        var mins = Math.floor((uptime % 3600) / 60);
        var uptimeStr = days+'d '+hours+'h '+mins+'m';

        return res.json({
          success: true,
          cpu: cpuLoad,
          ram: { used: usedMem, total: totalMem, percent: memPercent },
          disk: diskInfo,
          uptime: uptimeStr
        });
      }

      // --- dhcp_leases: leases DHCP desde routers MikroTik ---
      if (ajax === 'dhcp_leases') {
        const routerId = parseInt(req.body.router_id) || 0;
        const MikroTikAPI = require('./mikrotik-api');

        var getLeases = function(r) {
          return MikroTikAPI.getDHCPLeases(r.ip, r.port || 8728, r.user, r.password).then(function(result) {
            if (result.success && result.data) {
              return result.data.map(function(l) {
                return {
                  address: l['address'] || l.address || '',
                  mac_address: l['mac-address'] || l.mac_address || '',
                  host_name: l['host-name'] || l.host_name || '',
                  status: l.status || 'bound',
                  router_name: r.name
                };
              });
            }
            return [];
          }).catch(function() { return []; });
        };

        if (routerId > 0) {
          var router = db.prepare('SELECT * FROM routers WHERE id=?').get(routerId);
          if (!router) return res.json({ success: false, msg: 'Router no encontrado' });
          getLeases(router).then(function(leases) {
            res.json({ success: true, leases: leases });
          });
        } else {
          var routers = db.prepare('SELECT * FROM routers WHERE connected=1').all();
          var promises = routers.map(function(r) { return getLeases(r); });
          Promise.all(promises).then(function(results) {
            var allLeases = [];
            results.forEach(function(leases) { allLeases = allLeases.concat(leases); });
            res.json({ success: true, leases: allLeases });
          }).catch(function() {
            res.json({ success: false, msg: 'Error al obtener leases' });
          });
        }
        return;
      }

      // --- alerts: alertas del sistema (eventos recientes de la DB) ---
      if (ajax === 'alerts') {
        // Buscar en distintas tablas eventos recientes
        var alerts = [];
        // Ordenes pendientes recientes
        var ordenesPend = db.prepare("SELECT id, created_at, detalle FROM ordenes WHERE estado='pendiente' AND created_at >= datetime('now','-7 days','localtime') ORDER BY id DESC LIMIT 5").all();
        ordenesPend.forEach(function(o) {
          alerts.push({ type: 'warning', message: 'Orden #'+o.id+' pendiente: '+(o.detalle||'Sin detalle'), created_at: o.created_at });
        });
        // Servicios suspendidos recientes
        var suspendidos = db.prepare("SELECT COUNT(*) as c FROM servicios WHERE estado='suspendido' AND fecha_suspension >= datetime('now','-7 days','localtime')").get();
        if (suspendidos && suspendidos.c > 0) {
          alerts.push({ type: 'warning', message: suspendidos.c+' cliente(s) suspendido(s) en los últimos 7 días', created_at: new Date().toISOString() });
        }
        // Routers desconectados
        var routersDesc = db.prepare('SELECT name FROM routers WHERE connected=0').all();
        routersDesc.forEach(function(r) {
          alerts.push({ type: 'error', message: 'Router "'+r.name+'" desconectado', created_at: new Date().toISOString() });
        });
        // Últimos pagos registrados
        var pagosRec = db.prepare("SELECT COUNT(*) as c FROM pagos WHERE created_at >= datetime('now','-24 hours','localtime')").get();
        if (pagosRec && pagosRec.c > 0) {
          alerts.push({ type: 'success', message: pagosRec.c+' pago(s) registrados en las últimas 24 horas', created_at: new Date().toISOString() });
        }
        return res.json({ success: true, alerts: alerts });
      }

      break;
    }
    case 'BuscarOnu': {
      const ajaxBuscar = req.query.ajax;

      // ==== SEARCH ONUS ====
      if (ajaxBuscar === 'search') {
        var q = (req.query.q || '').trim();
        var oltId = parseInt(req.query.olt_id) || 0;
        var page = Math.max(1, parseInt(req.query.page) || 1);
        var perPage = 20;
        var offset = (page - 1) * perPage;

        var where = 'WHERE 1=1';
        var params = [];

        if (q) {
          where += ' AND (o.sn LIKE ? OR o.nombre LIKE ? OR c.nombre LIKE ? OR c.apodo LIKE ? OR c.cedula LIKE ? OR s.ip LIKE ? OR CAST(o.puerto_olt AS TEXT) LIKE ?)';
          var likeQ = '%' + q + '%';
          params.push(likeQ, likeQ, likeQ, likeQ, likeQ, likeQ, likeQ);
        }
        if (oltId > 0) {
          where += ' AND o.olt_id = ?';
          params.push(oltId);
        }

        var countRow = db.prepare(
          'SELECT COUNT(*) as total FROM onu o LEFT JOIN clientes c ON c.id=o.cliente_id LEFT JOIN servicios s ON s.id=o.servicio_id ' + where
        ).get.apply(db, params);
        var total = countRow ? countRow.total : 0;
        var pages = Math.max(1, Math.ceil(total / perPage));
        params.push(perPage, offset);

        var rows = db.prepare(
          'SELECT o.id, o.sn, o.nombre, o.estado, o.puerto_olt, o.senial, o.created_at, ' +
          'ol.nombre as olt_nombre, ol.id as olt_id, ' +
          'c.id as cliente_id, c.nombre as cliente_nombre, s.ip ' +
          'FROM onu o ' +
          'LEFT JOIN clientes c ON c.id=o.cliente_id ' +
          'LEFT JOIN servicios s ON s.id=o.servicio_id ' +
          'LEFT JOIN olts ol ON ol.id=o.olt_id ' +
          where + ' ' +
          'ORDER BY o.id DESC ' +
          'LIMIT ? OFFSET ?'
        ).all(...params);

        return res.json({ success: true, data: rows, total: total, pages: pages, page: page });
      }

      // ==== GET DETAIL ====
      if (ajaxBuscar === 'get_detail') {
        var detId = parseInt(req.query.id) || 0;
        if (!detId) return res.json({ success: false, msg: 'ID inv\u00e1lido' });
        var onu = db.prepare(
          'SELECT o.*, ol.nombre as olt_nombre, ' +
          'c.id as cliente_id, c.nombre as cliente_nombre, c.cedula, c.telefono ' +
          'FROM onu o ' +
          'LEFT JOIN olts ol ON ol.id=o.olt_id ' +
          'LEFT JOIN clientes c ON c.id=o.cliente_id ' +
          'WHERE o.id=?'
        ).get(detId);
        if (!onu) return res.json({ success: false, msg: 'ONU no encontrada' });
        return res.json({ success: true, data: onu });
      }

      // ==== DELETE ====
      if (ajaxBuscar === 'delete') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, msg: 'M\u00e9todo no permitido' });
        var delId = parseInt(req.body.id) || 0;
        if (!delId) return res.json({ success: false, msg: 'ID inv\u00e1lido' });
        db.prepare('DELETE FROM onu WHERE id=?').run(delId);
        return res.json({ success: true, msg: 'ONU eliminada' });
      }

      // ==== EDIT ====
      if (ajaxBuscar === 'edit') {
        if (req.method !== 'POST') return res.status(405).json({ success: false, msg: 'M\u00e9todo no permitido' });
        var editId = parseInt(req.body.id) || 0;
        var editSn = (req.body.sn || '').trim();
        var editNombre = (req.body.nombre || '').trim();
        var editOltId = parseInt(req.body.olt_id) || 0;
        var editPuerto = parseInt(req.body.puerto_olt) || 0;

        if (!editId || !editSn) {
          return res.json({ success: false, msg: 'ID y SN son requeridos' });
        }

        var existingSn = db.prepare('SELECT id FROM onu WHERE sn=? AND id!=?').get(editSn, editId);
        if (existingSn) {
          return res.json({ success: false, msg: 'El SN ya est\u00e1 asignado a otra ONU' });
        }

        db.prepare('UPDATE onu SET sn=?, nombre=?, olt_id=?, puerto_olt=? WHERE id=?').run(
          editSn, editNombre, editOltId || null, editPuerto || null, editId
        );
        return res.json({ success: true, msg: 'ONU actualizada' });
      }

      data.olts = db.prepare('SELECT * FROM olts WHERE activo=1 OR activo IS NULL').all();
      break;
    }
    case 'CambioOnu': {
      data.clientes = db.prepare('SELECT id, nombre, cedula, telefono FROM clientes ORDER BY nombre').all();
      data.zonas = db.prepare('SELECT * FROM zonas ORDER BY nombre').all();
      break;
    }
    case 'CambioDeTitular': {
      data.clientes = db.prepare('SELECT id, nombre, cedula, telefono FROM clientes ORDER BY nombre').all();
      break;
    }
    case 'Traslados': {
      data.zonas = db.prepare('SELECT id, nombre FROM zonas ORDER BY nombre').all();
      break;
    }
    case 'Facturacion': {
      // Procesar formularios POST (guardar/eliminar ciclos)
      if (req.method === 'POST' && req.body) {
        if (req.body.accion === 'guardar_ciclo') {
          const { id_ciclo, billing_type, invoice_day, suspend_day, tolerance_months, suspend_weekends,
            notify_1, notify_2, notify_3, reconnection_option, reconnection_amount,
            invoice_suspended, prorate_first_invoice, grace_days_option, grace_days,
            notify_on_suspend, notify_on_payment } = req.body;
          const reconnActive = reconnection_option === 'si' ? 1 : 0;
          const invSusp = invoice_suspended === 'si' ? 1 : 0;
          const prorate = prorate_first_invoice === 'si' ? 1 : 0;
          const graceVal = grace_days_option === 'si' ? (parseInt(grace_days) || 0) : 0;
          const suspWeekends = suspend_weekends === 'si' ? 1 : 0;
          const notifSusp = notify_on_suspend === 'si' ? 1 : 0;
          const notifPay = notify_on_payment === 'si' ? 1 : 0;
          const name = (req.body.name && req.body.name.trim()) ? req.body.name.trim() : (billing_type === 'postpago' ? 'POST' : 'PRE') + ' | Gen: Dia ' + invoice_day + ' | Corte: Dia ' + suspend_day;

          if (id_ciclo) {
            db.prepare(`UPDATE billing_cycles SET billing_type=?, invoice_day=?, payment_day=?, suspend_day=?, tolerance_months=?,
              suspend_weekends=?, notify_day_1=?, notify_day_2=?, notify_day_3=?, reconnection_fee_active=?,
              reconnection_amount=?, invoice_suspended=?, prorate_first_invoice=?, grace_days=?, notify_on_suspend=?,
              notify_on_payment=?, name=? WHERE id=?`).run(
              billing_type, invoice_day, req.body.payment_day || invoice_day, suspend_day, tolerance_months, suspWeekends,
              notify_1||0, notify_2||0, notify_3||0, reconnActive, reconnection_amount||0,
              invSusp, prorate, graceVal, notifSusp, notifPay, name, id_ciclo
            );
          } else {
            db.prepare(`INSERT INTO billing_cycles (billing_type, invoice_day, payment_day, suspend_day, tolerance_months,
              suspend_weekends, notify_day_1, notify_day_2, notify_day_3, reconnection_fee_active,
              reconnection_amount, invoice_suspended, prorate_first_invoice, grace_days, notify_on_suspend,
              notify_on_payment, name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
              billing_type, invoice_day, req.body.payment_day || invoice_day, suspend_day, tolerance_months, suspWeekends,
              notify_1||0, notify_2||0, notify_3||0, reconnActive, reconnection_amount||0,
              invSusp, prorate, graceVal, notifSusp, notifPay, name
            );
          }
          return res.redirect('/modulo?pagina=Facturacion');
        }
        if (req.body.accion === 'eliminar') {
          const id = parseInt(req.body.id_ciclo) || 0;
          if (id) db.prepare('DELETE FROM billing_cycles WHERE id=?').run(id);
          return res.redirect('/modulo?pagina=Facturacion');
        }
      }
      data.ciclos = db.prepare('SELECT bc.*, 0 as total_clientes FROM billing_cycles bc ORDER BY bc.id').all();
      break;
    }
    case 'Plantillas': {
      var plantAjax = req.query.ajax;
      
      // AJAX: get_logo
      if (plantAjax === 'get_logo') {
        var ld = db.prepare("SELECT value FROM configuracion WHERE key='logo_data'").get();
        var lw = db.prepare("SELECT value FROM configuracion WHERE key='logo_width'").get();
        var lh = db.prepare("SELECT value FROM configuracion WHERE key='logo_height'").get();
        if (ld) {
          return res.json({ status: 'success', logo: ld.value, width: parseInt(lw ? lw.value : 120), height: parseInt(lh ? lh.value : 60) });
        }
        return res.json({ status: 'success', logo: null });
      }
      
      // AJAX: save_template
      if (plantAjax === 'save_template') {
        const { template_key, content } = req.body;
        if (!template_key) return res.json({ status: 'error', msg: 'template_key requerido' });
        var existing = db.prepare('SELECT id FROM templates WHERE template_key=?').get(template_key);
        if (existing) {
          db.prepare("UPDATE templates SET content=?, updated_at=datetime('now') WHERE template_key=?").run(content || '', template_key);
        } else {
          db.prepare("INSERT INTO templates (template_key, template_name, content, updated_at) VALUES (?,?,?,datetime('now'))").run(template_key, template_key, content || '');
        }
        return res.json({ status: 'success', msg: 'Plantilla guardada' });
      }
      
      // AJAX: reset_template
      if (plantAjax === 'reset_template') {
        const key = req.body.template_key;
        var t = db.prepare('SELECT * FROM templates WHERE template_key=?').get(key);
        if (t && t.content) {
          return res.json({ status: 'success', content: t.content });
        }
        return res.json({ status: 'error', msg: 'No hay contenido original' });
      }
      
      // AJAX: upload_logo
      if (plantAjax === 'upload_logo') {
        if (req.body.logo) {
          db.prepare("INSERT OR REPLACE INTO configuracion (key, value) VALUES ('logo_data', ?)").run(req.body.logo);
          return res.json({ status: 'success', logo: req.body.logo, width: parseInt(req.body.logo_width) || 120, height: parseInt(req.body.logo_height) || 60 });
        }
        return res.json({ status: 'error', msg: 'No se recibió logo' });
      }
      
      // AJAX: save_logo_size
      if (plantAjax === 'save_logo_size') {
        const w = req.body.logo_width || '120';
        const h = req.body.logo_height || '60';
        db.prepare("INSERT OR REPLACE INTO configuracion (key, value) VALUES ('logo_width', ?)").run(String(w));
        db.prepare("INSERT OR REPLACE INTO configuracion (key, value) VALUES ('logo_height', ?)").run(String(h));
        return res.json({ status: 'success', msg: 'Tamaño guardado' });
      }
      
      // AJAX: delete_logo
      if (plantAjax === 'delete_logo') {
        db.prepare("DELETE FROM configuracion WHERE key='logo_data'").run();
        db.prepare("DELETE FROM configuracion WHERE key='logo_width'").run();
        db.prepare("DELETE FROM configuracion WHERE key='logo_height'").run();
        return res.json({ status: 'success', msg: 'Logo eliminado' });
      }
      
      // Load templates data for the page render
      const templatesRows = db.prepare('SELECT * FROM templates').all();
      var templatesData = {};
      var templateKeysMap = {};
      templatesRows.forEach(function(t) {
        templatesData[t.template_key] = { id: t.id, template_key: t.template_key, template_name: t.template_name, content: t.content || '', updated_at: t.updated_at };
      });
      // Load template keys map from config
      try {
        var keysMap = db.prepare("SELECT value FROM configuracion WHERE key='template_keys_map'").get();
        if (keysMap) templateKeysMap = JSON.parse(keysMap.value);
      } catch(e) {}
      data.templatesData = JSON.stringify(templatesData);
      data.templateKeysMap = JSON.stringify(templateKeysMap);
      break;
    }
    case 'PromesaDePago': {
      // AJAX handlers for this module
      const ajax = req.query.ajax;
      if (ajax === 'list') {
        const filter = req.query.filter || 'active';
        let where = '';
        if (filter === 'active') where = "WHERE pp.estado='activa' AND pp.fecha_limite >= date('now')";
        else if (filter === 'expired') where = "WHERE (pp.estado='vencida' OR (pp.estado='activa' AND pp.fecha_limite < date('now')))";
        else if (filter === 'cancelled') where = "WHERE pp.estado='cancelada'";
        const rows = db.prepare(`
          SELECT pp.*, c.nombre as client_name, c.apodo as alias,
          (SELECT GROUP_CONCAT('SVC-' || s.id, ', ') FROM servicios s WHERE s.id IN (
            SELECT value FROM json_each(CASE WHEN pp.servicio_ids IS NOT NULL AND pp.servicio_ids != '' THEN pp.servicio_ids ELSE '[]' END)
          )) as nics,
          CASE WHEN (SELECT COUNT(*) FROM servicios s WHERE s.id IN (
            SELECT value FROM json_each(CASE WHEN pp.servicio_ids IS NOT NULL AND pp.servicio_ids != '' THEN pp.servicio_ids ELSE '[]' END)
          ) AND s.estado='activo') > 0 THEN 'active' ELSE 'suspended' END as svc_status,
          u.nombre as created_by_name
          FROM promesas_pago pp
          LEFT JOIN clientes c ON c.id=pp.cliente_id
          LEFT JOIN usuarios u ON u.id=pp.usuario_id
          ${where}
          ORDER BY pp.created_at DESC LIMIT 200
        `).all();
        return res.json({ status: 'success', data: rows });
      }
      if (ajax === 'search_clients') {
        const term = req.query.term || '';
        if (term.length < 2) return res.json([]);
        const rows = db.prepare(`
          SELECT c.id, c.nombre as name, c.apodo as alias, c.cedula,
          (SELECT GROUP_CONCAT('SVC-' || s.id, ', ') FROM servicios s WHERE s.cliente_id=c.id) as nics
          FROM clientes c
          WHERE c.nombre LIKE ? OR c.apodo LIKE ? OR c.cedula LIKE ?
          LIMIT 20
        `).all(`%${term}%`, `%${term}%`, `%${term}%`);
        return res.json(rows);
      }
      if (ajax === 'get_services') {
        const clientId = parseInt(req.query.client_id) || 0;
        if (!clientId) return res.json([]);
        const svcs = db.prepare(`
          SELECT s.id, 'SVC-' || s.id, s.estado as status, p.nombre as plan_name,
          (SELECT COUNT(*) FROM promesas_pago pp WHERE pp.servicio_ids LIKE '%'||s.id||'%' AND pp.estado='activa') as promesa_activa,
          (SELECT COUNT(*) FROM facturas f WHERE f.servicio_id=s.id AND f.estado='pendiente' AND f.fecha_vencimiento < date('now')) as facturas_vencidas
          FROM servicios s
          LEFT JOIN planes p ON p.id=s.plan_id
          WHERE s.cliente_id=? AND s.estado IN ('activo','suspendido')
          ORDER BY s.id
        `).all(clientId);
        return res.json(svcs);
      }
      if (ajax === 'create') {
        const { client_id, services, due_date, notes } = req.body;
        if (!client_id || !services || !due_date) {
          return res.json({ status: 'error', msg: 'Faltan campos requeridos' });
        }
        const svcIds = JSON.stringify(typeof services === 'string' ? JSON.parse(services) : services);
        db.prepare('INSERT INTO promesas_pago (cliente_id, servicio_ids, fecha_limite, notas, estado, usuario_id) VALUES (?,?,?,?,?,?)').run(client_id, svcIds, due_date, notes || '', 'activa', req.session.user.id);
        
        // Enviar notificación de reactivación por promesa
        (async function() {
          try {
            var svcIdList = [];
            try { svcIdList = JSON.parse(svcIds); } catch(e) {}
            svcIdList.forEach(function(sid) {
              sendReactivationNotification(client_id, sid, due_date);
            });
          } catch(e) {}
        })();
        
        return res.json({ status: 'success', msg: 'Promesa creada correctamente' });
      }
      if (ajax === 'cancel') {
        const id = parseInt(req.body.id) || 0;
        if (!id) return res.json({ status: 'error', msg: 'ID inválido' });
        db.prepare("UPDATE promesas_pago SET estado='cancelada' WHERE id=?").run(id);
        return res.json({ status: 'success', msg: 'Promesa cancelada' });
      }
      break;
    }
    case 'Zonas': {
      data.zonas = db.prepare(`
        SELECT z.*, r.name as router_nombre,
          o.nombre as olt_nombre, o.smartolt_subdomain,
          (SELECT COUNT(*) FROM servicios s WHERE s.zona_id=z.id AND s.estado='activo') as activos,
          (SELECT COUNT(*) FROM servicios s WHERE s.zona_id=z.id AND s.estado='suspendido') as suspendidos,
          (SELECT COUNT(*) FROM servicios s WHERE s.zona_id=z.id) as total
        FROM zonas z
        LEFT JOIN routers r ON r.id=z.router_id
        LEFT JOIN olts o ON o.id=z.smartolt_profile_id
        ORDER BY z.nombre
      `).all();
      data.routers = db.prepare('SELECT id, name FROM routers ORDER BY name').all();
      data.olts = db.prepare('SELECT id, nombre, smartolt_subdomain FROM olts WHERE smartolt_subdomain IS NOT NULL ORDER BY nombre').all();
      break;
    }
    case 'CuadreCaja': {
      const ajax = req.query.ajax;

      // --- Resumen del día ---
      if (ajax === 'summary') {
        const date = req.query.date || new Date().toISOString().slice(0,10);
        const totalPagos = db.prepare(`SELECT COALESCE(SUM(monto),0) as total FROM pagos WHERE date(created_at)=?`).get(date);
        const totalGastos = db.prepare(`SELECT COALESCE(SUM(monto),0) as total FROM gastos WHERE date(created_at)=?`).get(date);
        const saldo = (totalPagos.total || 0) - (totalGastos.total || 0);
        return res.json({ status: 'success', data: { total_pagos: totalPagos.total, total_gastos: totalGastos.total, saldo } });
      }

      // --- Pagos del día con desglose por método ---
      if (ajax === 'pagos') {
        const date = req.query.date || new Date().toISOString().slice(0,10);
        const pagos = db.prepare(`
          SELECT p.*, c.nombre as cliente_nombre
          FROM pagos p
          LEFT JOIN clientes c ON c.id=p.cliente_id
          WHERE date(p.created_at)=?
          ORDER BY p.created_at DESC
        `).all(date);
        const desglose = db.prepare(`
          SELECT p.metodo, COUNT(*) as cantidad, COALESCE(SUM(p.monto),0) as total
          FROM pagos p WHERE date(p.created_at)=?
          GROUP BY p.metodo
        `).all(date);
        return res.json({ status: 'success', data: { pagos, desglose } });
      }

      // --- Gastos del día ---
      if (ajax === 'gastos') {
        const date = req.query.date || new Date().toISOString().slice(0,10);
        const gastos = db.prepare(`SELECT * FROM gastos WHERE date(created_at)=? ORDER BY created_at DESC`).all(date);
        return res.json({ status: 'success', data: gastos });
      }

      // --- Historial de cuadres ---
      if (ajax === 'history') {
        const limit = parseInt(req.query.limit) || 30;
        const offset = parseInt(req.query.offset) || 0;
        const history = db.prepare(`
          SELECT cc.*, u.nombre as usuario_nombre
          FROM cuadre_caja cc
          LEFT JOIN usuarios u ON u.id=cc.usuario_id
          ORDER BY cc.created_at DESC LIMIT ? OFFSET ?
        `).all(limit, offset);
        const total = db.prepare(`SELECT COUNT(*) as c FROM cuadre_caja`).get();
        return res.json({ status: 'success', data: history, total: total.c });
      }

      // --- Realizar cuadre (cierre del día) ---
      if (ajax === 'do_cuadre') {
        if (req.method !== 'POST') return res.status(405).json({ status: 'error', msg: 'Método no permitido' });
        const date = req.body.fecha || new Date().toISOString().slice(0,10);
        const usuarioId = req.session.user.id;

        // Check if cuadre already exists for this date
        const existing = db.prepare('SELECT id FROM cuadre_caja WHERE fecha=?').get(date);
        if (existing) {
          return res.json({ status: 'error', msg: 'Ya existe un cuadre para esta fecha (' + date + ')' });
        }

        const totalPagos = db.prepare(`SELECT COALESCE(SUM(monto),0) as total FROM pagos WHERE date(created_at)=?`).get(date);
        const totalGastos = db.prepare(`SELECT COALESCE(SUM(monto),0) as total FROM gastos WHERE date(created_at)=?`).get(date);
        const saldo = (totalPagos.total || 0) - (totalGastos.total || 0);

        const r = db.prepare(`INSERT INTO cuadre_caja (usuario_id, fecha, total_pagos, total_gastos, saldo) VALUES (?,?,?,?,?)`).run(usuarioId, date, totalPagos.total, totalGastos.total, saldo);

        // Get payment details for this cuadre
        const pagos = db.prepare(`
          SELECT p.*, c.nombre as cliente_nombre
          FROM pagos p
          LEFT JOIN clientes c ON c.id=p.cliente_id
          WHERE date(p.created_at)=?
        `).all(date);
        const gastos = db.prepare(`SELECT * FROM gastos WHERE date(created_at)=?`).all(date);

        return res.json({ status: 'success', msg: 'Cuadre realizado exitosamente', data: { id: r.lastInsertRowid, total_pagos: totalPagos.total, total_gastos: totalGastos.total, saldo, pagos, gastos } });
      }

      // --- Agregar gasto ---
      if (ajax === 'add_gasto') {
        if (req.method !== 'POST') return res.status(405).json({ status: 'error', msg: 'Método no permitido' });
        const { concepto, monto, metodo, referencia, categoria, notas } = req.body;
        if (!concepto || !monto || monto <= 0) {
          return res.json({ status: 'error', msg: 'Concepto y monto son requeridos' });
        }
        const r = db.prepare(`INSERT INTO gastos (concepto, monto, metodo, referencia, categoria, usuario_id, notas) VALUES (?,?,?,?,?,?,?)`).run(concepto, monto, metodo || 'EFECTIVO', referencia || '', categoria || 'Varios', req.session.user.id, notas || '');
        return res.json({ status: 'success', msg: 'Gasto agregado', id: r.lastInsertRowid });
      }

      break;
    }
    case 'Configuracion': break;
    case 'Actualizaciones': {
      const ajax = req.query.ajax;
      
      // --- Obtener versión actual ---
      if (ajax === 'check_update') {
        const versionRow = db.prepare("SELECT value FROM configuracion WHERE key='version'").get();
        const currentVersion = versionRow ? versionRow.value : '1.0.0';
        
        // En modo informativo, no hay updates reales — solo reportar que está actualizado
        return res.json({
          status: 'success',
          data: {
            available: false,
            current_version: currentVersion,
            version: currentVersion,
            changelog: ''
          }
        });
      }
      
      // --- Changelog / historial de cambios ---
      if (ajax === 'changelog') {
        const changelog = [
          { version: '1.0.0', date: '2026-01-15', changes: ['Lanzamiento inicial del sistema ISP Total'] }
        ];
        return res.json({ status: 'success', data: changelog });
      }
      
      // Pasar versión actual a la vista
      const versionRow = db.prepare("SELECT value FROM configuracion WHERE key='version'").get();
      data.version = versionRow ? versionRow.value : '1.0.0';
      break;
    }
    case 'VerOnu': {
      data.onuSN = req.query.sn || '';
      data.onuOltId = parseInt(req.query.olt_id) || 0;
      data.olts = db.prepare('SELECT * FROM olts WHERE activo=1').all();
      data.onu = db.prepare('SELECT o.*, ol.nombre as olt_nombre FROM onu o LEFT JOIN olts ol ON ol.id=o.olt_id WHERE o.sn=?').get(data.onuSN);
      break;
    }
    case 'TR069': {
      data.olts = db.prepare('SELECT * FROM olts WHERE activo=1').all();
      data.onuTypes = db.prepare("SELECT key, value FROM configuracion WHERE key LIKE 'onu_type_%' ORDER BY key").all();
      break;
    }
    case 'Cron': {
      const cronAjax = req.query.ajax;
      
      if (cronAjax === 'save_task') {
        const task = req.body.task_name;
        const enabled = req.body.enabled ? 1 : 0;
        const hour = parseInt(req.body.hour) || 0;
        const minute = parseInt(req.body.minute) || 0;
        db.prepare('UPDATE cron_tasks SET enabled=?, hour=?, minute=? WHERE task_name=?').run(enabled, hour, minute, task);
        return res.json({ status: 'success' });
      }
      
      if (cronAjax === 'run_task') {
        const task = req.body.task || req.query.task;
        if (!task) return res.json({ status: 'error', msg: 'Task requerida' });
        
        if (task === 'recordatorios') {
          enviarRecordatoriosWA(req, res);
          return;
        }
        
        if (task === 'suspension') {
          enviarNotifSuspensionWA(req, res);
          return;
        }
        
        if (task === 'generar_facturas') {
          var output = ejecutarGenerarFacturas();
          db.prepare("UPDATE cron_tasks SET last_run=datetime('now','localtime'), last_status=?, last_output=? WHERE task_name=?").run('ok', output, 'generar_facturas');
          return res.json({ status: 'success', data: { output: output } });
        }
        
        if (task === 'expirar_promesas') {
          ejecutarExpirarPromesas(req, res);
          return;
        }
        
        return res.json({ status: 'success', msg: 'Tarea ejecutada' });
      }
      
      if (cronAjax === 'get_log') {
        const task = req.query.task || '';
        const row = db.prepare('SELECT * FROM cron_tasks WHERE task_name=?').get(task);
        if (row) {
          return res.json({ status: 'success', data: { output: row.last_output || '', status: row.last_status || 'never', lastRun: row.last_run || 'Nunca' } });
        }
        return res.json({ status: 'error', msg: 'No encontrada' });
      }
      
      data.tasks = db.prepare('SELECT * FROM cron_tasks ORDER BY id').all();
      break;
    }
  }
  
  renderPage(req, res, pagina, data);
});

// ===== CRON TASKS =====

// Función: enviar recordatorios de pago via WhatsApp (15s entre mensajes)
function enviarRecordatoriosWA(req, res) {
  var openwa = require('./openwa-service');
  
  // Obtener facturas pendientes con datos de clientes
  var pendientes = db.prepare(`
    SELECT f.id as factura_id, c.id as cliente_id, c.nombre as cliente_nombre, c.telefono,
      p.nombre as plan_name, f.monto, f.fecha_vencimiento,
      COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0) as pagado
    FROM facturas f
    JOIN servicios s ON s.id=f.servicio_id
    JOIN clientes c ON c.id=s.cliente_id
    LEFT JOIN planes p ON p.id=s.plan_id
    WHERE f.estado='pendiente' AND f.monto > COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0)
    GROUP BY f.id
    LIMIT 50
  `).all();
  
  if (pendientes.length === 0) {
    db.prepare("UPDATE cron_tasks SET last_run=datetime('now','localtime'), last_status='ok', last_output=? WHERE task_name='recordatorios'").run('No hay facturas pendientes');
    return res.json({ status: 'success', data: { output: 'No hay facturas pendientes' } });
  }
  
  // Obtener plantilla
  var tpl = db.prepare("SELECT content FROM templates WHERE template_key='recordatorio_sms'").get();
  var template = tpl ? tpl.content : 'Hola {client_name}, tienes un pago pendiente de {invoice_remaining}. Paga al {company_phone}';
  
  var output = 'Iniciando envio de ' + pendientes.length + ' recordatorios...\n';
  var success = 0, errors = 0;
  
  // Enviar mensajes secuencialmente con delay de 15s
  function enviarSiguiente(i) {
    if (i >= pendientes.length) {
      var finalOutput = output + '\nEnviados: ' + success + ', Errores: ' + errors;
      db.prepare("UPDATE cron_tasks SET last_run=datetime('now','localtime'), last_status=?, last_output=? WHERE task_name='recordatorios'").run(errors === 0 ? 'ok' : 'error', finalOutput);
      return res.json({ status: 'success', data: { output: finalOutput } });
    }
    
    var p = pendientes[i];
    var remaining = parseFloat(p.monto) - parseFloat(p.pagado || 0);
    
    if (remaining <= 0 || !p.telefono) {
      output += '[' + (i+1) + '/' + pendientes.length + '] ' + p.cliente_nombre + ': sin telefono o sin deuda\n';
      setTimeout(function() { enviarSiguiente(i + 1); }, 100);
      return;
    }
    
    var msg = template
      .replace(/{client_name}/g, p.cliente_nombre || '')
      .replace(/{plan_name}/g, p.plan_name || '')
      .replace(/{invoice_id}/g, String(p.factura_id))
      .replace(/{invoice_remaining}/g, '$' + remaining.toFixed(2))
      .replace(/{invoice_due_date}/g, p.fecha_vencimiento || '')
      .replace(/{invoice_total}/g, '$' + parseFloat(p.monto).toFixed(2))
      .replace(/{company_phone}/g, '8092470033')
      .replace(/{company_name}/g, 'Joel Wifi Dominicana');
    
    openwa.sendMessage(p.telefono, msg).then(function(result) {
      if (result.success) {
        success++;
        output += '[' + (i+1) + '/' + pendientes.length + '] ' + p.cliente_nombre + ': OK\n';
      } else {
        errors++;
        output += '[' + (i+1) + '/' + pendientes.length + '] ' + p.cliente_nombre + ': ERROR - ' + (result.msg || '') + '\n';
      }
      setTimeout(function() { enviarSiguiente(i + 1); }, 15000); // 15s delay
    }).catch(function(e) {
      errors++;
      output += '[' + (i+1) + '/' + pendientes.length + '] ' + p.cliente_nombre + ': ERROR - ' + e.message + '\n';
      setTimeout(function() { enviarSiguiente(i + 1); }, 15000);
    });
  }
  
  enviarSiguiente(0);
}

// Función: enviar notificaciones de suspensión via WhatsApp
function enviarNotifSuspensionWA(req, res) {
  var openwa = require('./openwa-service');
  
  // Obtener config de empresa
  var configRows = db.prepare("SELECT key, value FROM configuracion WHERE key IN ('empresa_nombre','empresa_telefono')").all();
  var config = { empresa_nombre: '', empresa_telefono: '' };
  configRows.forEach(function(r) { config[r.key] = r.value || ''; });
  
  // Clientes con facturas vencidas que tienen servicios activos
  var pendientes = db.prepare(`
    SELECT DISTINCT c.id as cliente_id, c.nombre as cliente_nombre, c.telefono
    FROM facturas f
    JOIN servicios s ON s.id=f.servicio_id
    JOIN clientes c ON c.id=s.cliente_id
    WHERE f.estado='pendiente' AND s.estado='activo'
      AND julianday('now') > julianday(f.fecha_vencimiento) + 5
      AND f.monto > COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0)
    GROUP BY c.id
    LIMIT 30
  `).all();
  
  if (pendientes.length === 0) {
    db.prepare("UPDATE cron_tasks SET last_run=datetime('now','localtime'), last_status='ok', last_output=? WHERE task_name='suspension'").run('No hay clientes para suspender');
    return res.json({ status: 'success', data: { output: 'No hay clientes para suspender' } });
  }
  
  var tpl = db.prepare("SELECT content FROM templates WHERE template_key='notif_suspension'").get();
  var templateBase = tpl ? tpl.content : 'Hola {client_name}, su servicio ha sido suspendido.';
  
  var output = 'Iniciando suspension de ' + pendientes.length + ' clientes...\n';
  var success = 0, errors = 0;
  
  function procesarSiguiente(i) {
    if (i >= pendientes.length) {
      var finalOutput = output + '\nSuspendidos: ' + success + ', Errores: ' + errors;
      db.prepare("UPDATE cron_tasks SET last_run=datetime('now','localtime'), last_status=?, last_output=? WHERE task_name='suspension'").run(errors === 0 ? 'ok' : 'error', finalOutput);
      return res.json({ status: 'success', data: { output: finalOutput } });
    }
    
    var p = pendientes[i];
    
    if (!p.telefono) {
      output += '[' + (i+1) + '/' + pendientes.length + '] ' + p.cliente_nombre + ': sin teléfono\n';
      setTimeout(function() { procesarSiguiente(i + 1); }, 100);
      return;
    }
    
    try {
      // 1. Suspender servicios del cliente
      db.prepare("UPDATE servicios SET estado='suspendido' WHERE cliente_id=? AND estado='activo'").run(p.cliente_id);
      
      // 2. Obtener info de los servicios suspendidos
      var svcs = db.prepare('SELECT s.id, s.direccion, p.nombre as plan_nombre FROM servicios s LEFT JOIN planes p ON p.id=s.plan_id WHERE s.cliente_id=? AND s.estado=?').all(p.cliente_id, 'suspendido');
      
      // 3. Obtener deuda total
      var deudaRow = db.prepare("SELECT COALESCE(SUM(f.monto - COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0)),0) as total FROM facturas f WHERE f.servicio_id IN (SELECT s2.id FROM servicios s2 WHERE s2.cliente_id=?) AND f.estado='pendiente'").get(p.cliente_id);
      var deudaTotal = deudaRow ? deudaRow.total : 0;
      
      // 4. Enviar notificación
      svcs.forEach(function(svc) {
        var msg = templateBase
          .replace(/{client_name}/g, p.cliente_nombre || '')
          .replace(/{service_address}/g, svc.direccion || '')
          .replace(/{plan_name}/g, svc.plan_nombre || '')
          .replace(/{invoice_remaining}/g, '$' + deudaTotal.toFixed(2))
          .replace(/{company_phone}/g, config.empresa_telefono)
          .replace(/{company_name}/g, config.empresa_nombre)
          .replace(/{current_date}/g, new Date().toLocaleDateString('es-DO'));
        
        openwa.encolarMensaje(p.cliente_id, svc.id, p.telefono, msg, 'suspension');
      });
      
      success++;
      output += '[' + (i+1) + '/' + pendientes.length + '] ' + p.cliente_nombre + ': suspendido y notificado\n';
    } catch(e) {
      errors++;
      output += '[' + (i+1) + '/' + pendientes.length + '] ' + p.cliente_nombre + ': ERROR - ' + e.message + '\n';
    }
    
    setTimeout(function() { procesarSiguiente(i + 1); }, 2000);
  }
  
  procesarSiguiente(0);
}

function ejecutarGenerarFacturas() {
  var lines = [];
  lines.push('============================================================');
  lines.push('[' + new Date().toLocaleString() + '] CRON GENERAR FACTURAS - START');
  lines.push('============================================================');
  lines.push('Ejecutando generacion...');
  lines.push('No implementado - requiere logica de ciclos');
  lines.push('============================================================');
  lines.push('[' + new Date().toLocaleString() + '] CRON GENERAR FACTURAS - END');
  lines.push('============================================================');
  return lines.join('\n');
}

// Función: expirar promesas de pago vencidas
function ejecutarExpirarPromesas(req, res) {
  try {
    var vencidas = db.prepare(`
      SELECT pp.id, pp.cliente_id, pp.servicio_ids, pp.fecha_limite,
        c.nombre as cliente_nombre
      FROM promesas_pago pp
      JOIN clientes c ON c.id=pp.cliente_id
      WHERE pp.estado='activa' AND pp.fecha_limite < date('now')
      ORDER BY pp.fecha_limite ASC
    `).all();
    
    if (vencidas.length === 0) {
      db.prepare("UPDATE cron_tasks SET last_run=datetime('now','localtime'), last_status='ok', last_output=? WHERE task_name='expirar_promesas'").run('No hay promesas vencidas');
      if (res) return res.json({ status: 'success', data: { output: 'No hay promesas vencidas' } });
      return;
    }
    
    var output = 'Procesando ' + vencidas.length + ' promesas vencidas...\n';
    var suspendidos = 0;
    var errores = 0;
    
    vencidas.forEach(function(p) {
      try {
        // Obtener IDs de servicios
        var svcIds = [];
        try { svcIds = JSON.parse(p.servicio_ids); } catch(e) {}
        
        // Suspender servicios asociados a la promesa
        svcIds.forEach(function(sid) {
          db.prepare("UPDATE servicios SET estado='suspendido' WHERE id=? AND estado='activo'").run(sid);
          suspendidos++;
          output += '  Servicio #' + sid + ' suspendido por promesa vencida (' + p.fecha_limite + ')\n';
        });
        
        // Marcar promesa como vencida (cambiar estado)
        db.prepare("UPDATE promesas_pago SET estado='vencida' WHERE id=?").run(p.id);
      } catch(e) {
        errores++;
        output += '  ERROR: ' + e.message + '\n';
      }
    });
    
    output += '\nTotal: ' + suspendidos + ' servicio(s) suspendidos, ' + errores + ' error(es)';
    db.prepare("UPDATE cron_tasks SET last_run=datetime('now','localtime'), last_status=?, last_output=? WHERE task_name='expirar_promesas'").run(errores === 0 ? 'ok' : 'error', output);
    
    if (res) return res.json({ status: 'success', data: { output: output } });
  } catch(e) {
    var errMsg = 'Error: ' + e.message;
    db.prepare("UPDATE cron_tasks SET last_run=datetime('now','localtime'), last_status='error', last_output=? WHERE task_name='expirar_promesas'").run(errMsg);
    if (res) return res.json({ status: 'error', msg: errMsg });
  }
}

// ==================== PROMESA DE PAGO ====================
app.get('/api/promesa/list', requireAuth, (req, res) => {
  const filter = req.query.filter || 'active';
  let where = '';
  if (filter === 'active') where = "WHERE pp.estado='activa' AND pp.fecha_limite >= date('now')";
  else if (filter === 'expired') where = "WHERE (pp.estado='vencida' OR (pp.estado='activa' AND pp.fecha_limite < date('now')))";
  else if (filter === 'cancelled') where = "WHERE pp.estado='cancelada'";
  const rows = db.prepare(`
    SELECT pp.*, c.nombre as client_name, c.apodo as alias,
    (SELECT GROUP_CONCAT('SVC-' || s.id, ', ') FROM servicios s WHERE s.id IN (
      SELECT value FROM json_each(CASE WHEN pp.servicio_ids IS NOT NULL AND pp.servicio_ids != '' THEN pp.servicio_ids ELSE '[]' END)
    )) as nics,
    CASE WHEN (SELECT COUNT(*) FROM servicios s WHERE s.id IN (
      SELECT value FROM json_each(CASE WHEN pp.servicio_ids IS NOT NULL AND pp.servicio_ids != '' THEN pp.servicio_ids ELSE '[]' END)
    ) AND s.estado='activo') > 0 THEN 'active' ELSE 'suspended' END as svc_status,
    u.nombre as created_by_name
    FROM promesas_pago pp
    LEFT JOIN clientes c ON c.id=pp.cliente_id
    LEFT JOIN usuarios u ON u.id=pp.usuario_id
    ${where}
    ORDER BY pp.created_at DESC LIMIT 200
  `).all();
  res.json({ status: 'success', data: rows });
});

app.get('/api/promesa/search_clients', requireAuth, (req, res) => {
  const term = req.query.term || '';
  if (term.length < 2) return res.json([]);
  const rows = db.prepare(`
    SELECT c.id, c.nombre as name, c.apodo as alias, c.cedula,
    (SELECT GROUP_CONCAT('SVC-' || s.id, ', ') FROM servicios s WHERE s.cliente_id=c.id) as nics
    FROM clientes c
    WHERE c.nombre LIKE ? OR c.apodo LIKE ? OR c.cedula LIKE ?
    LIMIT 20
  `).all(`%${term}%`, `%${term}%`, `%${term}%`);
  res.json(rows);
});

app.get('/api/promesa/get_services', requireAuth, (req, res) => {
  const clientId = parseInt(req.query.client_id) || 0;
  if (!clientId) return res.json([]);
  const svcs = db.prepare(`
    SELECT s.id, 'SVC-' || s.id, s.estado as status, p.nombre as plan_name,
    (SELECT COUNT(*) FROM promesas_pago pp WHERE pp.servicio_ids LIKE '%'||s.id||'%' AND pp.estado='activa') as promesa_activa,
    (SELECT COUNT(*) FROM facturas f WHERE f.servicio_id=s.id AND f.estado='pendiente' AND f.fecha_vencimiento < date('now')) as facturas_vencidas
    FROM servicios s
    LEFT JOIN planes p ON p.id=s.plan_id
    WHERE s.cliente_id=? AND s.estado IN ('activo','suspendido')
    ORDER BY s.id
  `).all(clientId);
  res.json(svcs);
});

app.post('/api/promesa/create', requireAuth, (req, res) => {
  const { client_id, services, due_date, notes } = req.body;
  if (!client_id || !services || !due_date) {
    return res.json({ status: 'error', msg: 'Faltan campos requeridos' });
  }
  const svcIds = JSON.stringify(typeof services === 'string' ? JSON.parse(services) : services);
  const r = db.prepare('INSERT INTO promesas_pago (cliente_id, servicio_ids, fecha_limite, notas, estado, usuario_id) VALUES (?,?,?,?,?,?)').run(client_id, svcIds, due_date, notes || '', 'activa', req.session.user.id);
  
  // Enviar notificación de reactivación por promesa de pago
  (async function() {
    try {
      var svcIdList = [];
      try { svcIdList = JSON.parse(svcIds); } catch(e) {}
      svcIdList.forEach(function(sid) {
        sendReactivationNotification(client_id, sid, due_date);
      });
    } catch(e) {}
  })();
  
  res.json({ status: 'success', msg: 'Promesa creada correctamente', id: r.lastInsertRowid });
});

app.post('/api/promesa/cancel', requireAuth, (req, res) => {
  const id = parseInt(req.body.id) || 0;
  if (!id) return res.json({ status: 'error', msg: 'ID inválido' });
  db.prepare("UPDATE promesas_pago SET estado='cancelada' WHERE id=?").run(id);
  res.json({ status: 'success', msg: 'Promesa cancelada' });
});

// ==================== FACTURACION ====================
app.post('/modulo', (req, res, next) => {
  // Dispatch Proveedores AJAX handlers (POST-based operations)
  if (req.query.pagina === 'Proveedores' && req.query.ajax) {
    // Re-run the same Proveedores case logic but with req.body available
    const pagina = 'Proveedores';
    var data = {};
    const ajax = req.query.ajax;
    
    // ==== SAVE SUPPLIER ====
    if (ajax === 'save_supplier') {
      const id = parseInt(req.body.id) || 0;
      const name = (req.body.name || '').trim();
      const rnc = (req.body.rnc || '').trim();
      const address = (req.body.address || '').trim();
      const notes = (req.body.notes || '').trim();
      let services = [];
      let contacts = [];

      try { services = JSON.parse(req.body.services || '[]'); } catch(e) { services = []; }
      try { contacts = JSON.parse(req.body.contacts || '[]'); } catch(e) { contacts = []; }

      if (!name) return res.json({ status: 'error', msg: 'El nombre es obligatorio' });

      if (id) {
        db.prepare('UPDATE proveedores SET nombre=?, rnc=?, direccion=?, notas=? WHERE id=?').run(name, rnc, address, notes, id);
        db.prepare('DELETE FROM proveedores_servicios WHERE proveedor_id=?').run(id);
        services.forEach(function(s) {
          if (s.name) db.prepare('INSERT INTO proveedores_servicios (proveedor_id, nombre_servicio) VALUES (?,?)').run(id, s.name);
        });
        db.prepare('DELETE FROM proveedores_contactos WHERE proveedor_id=?').run(id);
        contacts.forEach(function(c) {
          if (c.name) db.prepare('INSERT INTO proveedores_contactos (proveedor_id, nombre_contacto, telefono, email, cargo) VALUES (?,?,?,?,?)').run(id, c.name, c.phone || '', c.email || '', c.role || '');
        });
        return res.json({ status: 'success', id: id, msg: 'Proveedor actualizado' });
      } else {
        const r = db.prepare('INSERT INTO proveedores (nombre, rnc, direccion, notas) VALUES (?,?,?,?)').run(name, rnc, address, notes);
        const newId = r.lastInsertRowid;
        services.forEach(function(s) {
          if (s.name) db.prepare('INSERT INTO proveedores_servicios (proveedor_id, nombre_servicio) VALUES (?,?)').run(newId, s.name);
        });
        contacts.forEach(function(c) {
          if (c.name) db.prepare('INSERT INTO proveedores_contactos (proveedor_id, nombre_contacto, telefono, email, cargo) VALUES (?,?,?,?,?)').run(newId, c.name, c.phone || '', c.email || '', c.role || '');
        });
        return res.json({ status: 'success', id: newId, msg: 'Proveedor creado' });
      }
    }

    // ==== DELETE SUPPLIER ====
    if (ajax === 'delete_supplier') {
      const id = parseInt(req.body.id) || 0;
      if (!id) return res.json({ status: 'error', msg: 'ID inválido' });
      db.prepare('DELETE FROM proveedores_contactos WHERE proveedor_id=?').run(id);
      db.prepare('DELETE FROM proveedores_servicios WHERE proveedor_id=?').run(id);
      db.prepare('DELETE FROM pagos_compra WHERE factura_id IN (SELECT id FROM facturas_compra WHERE proveedor_id=?)').run(id);
      db.prepare('DELETE FROM facturas_compra WHERE proveedor_id=?').run(id);
      db.prepare('DELETE FROM proveedores WHERE id=?').run(id);
      return res.json({ status: 'success', msg: 'Proveedor eliminado' });
    }

    // ==== CREATE INVOICE ====
    if (ajax === 'create_invoice') {
      const supplierId = parseInt(req.body.supplier_id) || 0;
      const invoiceNumber = (req.body.invoice_number || '').trim();
      const concept = (req.body.concept || '').trim();
      const total = parseFloat(req.body.total) || 0;
      const issueDate = req.body.issue_date || null;
      const dueDate = req.body.due_date || null;
      const notes = (req.body.notes || '').trim();
      if (!supplierId || !concept || total <= 0) {
        return res.json({ status: 'error', msg: 'Faltan campos requeridos' });
      }
      db.prepare('INSERT INTO facturas_compra (proveedor_id, numero, monto, concepto, fecha_emision, fecha_vencimiento, notas) VALUES (?,?,?,?,?,?,?)').run(supplierId, invoiceNumber, total, concept, issueDate, dueDate, notes);
      return res.json({ status: 'success', msg: 'Factura creada' });
    }

    // ==== EDIT INVOICE ====
    if (ajax === 'edit_invoice') {
      const invoiceId = parseInt(req.body.invoice_id) || 0;
      const invoiceNumber = (req.body.invoice_number || '').trim();
      const concept = (req.body.concept || '').trim();
      const total = parseFloat(req.body.total) || 0;
      const issueDate = req.body.issue_date || null;
      const dueDate = req.body.due_date || null;
      const notes = (req.body.notes || '').trim();
      if (!invoiceId || !concept || total <= 0) {
        return res.json({ status: 'error', msg: 'Faltan campos requeridos' });
      }
      const inv = db.prepare('SELECT * FROM facturas_compra WHERE id=?').get(invoiceId);
      if (!inv) return res.json({ status: 'error', msg: 'Factura no encontrada' });
      if (parseFloat(inv.pagado) > 0) return res.json({ status: 'error', msg: 'No se puede editar una factura con pagos' });
      db.prepare('UPDATE facturas_compra SET numero=?, monto=?, concepto=?, fecha_emision=?, fecha_vencimiento=?, notas=? WHERE id=?').run(invoiceNumber, total, concept, issueDate, dueDate, notes, invoiceId);
      return res.json({ status: 'success', msg: 'Factura actualizada' });
    }

    // ==== DELETE INVOICE ====
    if (ajax === 'delete_invoice') {
      const invoiceId = parseInt(req.body.invoice_id) || 0;
      if (!invoiceId) return res.json({ status: 'error', msg: 'ID inválido' });
      const inv = db.prepare('SELECT * FROM facturas_compra WHERE id=?').get(invoiceId);
      if (!inv) return res.json({ status: 'error', msg: 'Factura no encontrada' });
      if (parseFloat(inv.pagado) > 0) return res.json({ status: 'error', msg: 'No se puede eliminar una factura con pagos' });
      db.prepare('DELETE FROM pagos_compra WHERE factura_id=?').run(invoiceId);
      db.prepare('DELETE FROM facturas_compra WHERE id=?').run(invoiceId);
      return res.json({ status: 'success', msg: 'Factura eliminada' });
    }

    // ==== PAY INVOICE ====
    if (ajax === 'pay_invoice') {
      const invoiceId = parseInt(req.body.invoice_id) || 0;
      const amount = parseFloat(req.body.amount) || 0;
      const payMethod = (req.body.payment_method || 'Efectivo').trim();
      const reference = (req.body.reference || '').trim();
      const notes = (req.body.notes || '').trim();
      if (!invoiceId || amount <= 0) return res.json({ status: 'error', msg: 'Datos inválidos' });
      const inv = db.prepare('SELECT * FROM facturas_compra WHERE id=?').get(invoiceId);
      if (!inv) return res.json({ status: 'error', msg: 'Factura no encontrada' });
      const newPaid = parseFloat(inv.pagado) + amount;
      if (newPaid > inv.monto + 0.01) return res.json({ status: 'error', msg: 'El pago excede el monto de la factura' });
      db.prepare('UPDATE facturas_compra SET pagado=? WHERE id=?').run(newPaid, invoiceId);
      db.prepare("INSERT INTO pagos_compra (factura_id, monto, metodo, referencia, notas, fecha_pago) VALUES (?,?,?,?,?,date('now'))").run(invoiceId, amount, payMethod, reference, notes);
      db.prepare(`
        INSERT INTO gastos (concepto, monto, metodo, referencia, notas, tipo, reference_id, usuario_id, categoria, payment_date)
        VALUES (?,?,?,?,?,'proveedor',?,?,'Proveedores',date('now'))
      `).run('Pago a proveedor factura #' + invoiceId + ' - ' + (inv.concept || ''), amount, payMethod, reference, notes, invoiceId, req.session.user.id);
      return res.json({ status: 'success', msg: 'Pago registrado' });
    }

    return res.json({ status: 'error', msg: 'Acción no reconocida' });
  }

  // ========== PAGOSADMIN POST HANDLERS ==========
  if (req.query.pagina === 'PagosAdmin' && req.query.ajax) {
    const ajax = req.query.ajax;

    if (ajax === 'pa_pay_invoice') {
      const invId = parseInt(req.body.invoice_id) || 0;
      const amount = parseFloat(req.body.amount) || 0;
      const method = req.body.method || 'Efectivo';
      const reference = (req.body.reference || '').trim();
      const notes = (req.body.notes || '').trim();
      if (!invId || amount <= 0) return res.json({ status: 'error', msg: 'Datos inválidos' });
      db.prepare(`INSERT INTO pagos (factura_id, monto, metodo, transaccion, notas, usuario_id) VALUES (?,?,?,?,?,?)`)
        .run(invId, amount, method, reference, notes, req.session.user.id);
      return res.json({ status: 'success', msg: 'Pago registrado' });
    }

    if (ajax === 'pa_pay_employee') {
      const empId = parseInt(req.body.employee_id) || 0;
      const amount = parseFloat(req.body.amount) || 0;
      const periodLabel = (req.body.period_label || '').trim();
      const method = req.body.method || 'Efectivo';
      const reference = (req.body.reference || '').trim();
      const notes = (req.body.notes || '').trim();
      const loanDeduction = parseFloat(req.body.loan_deduction) || 0;
      if (!empId || amount <= 0) return res.json({ status: 'error', msg: 'Datos inválidos' });
      db.prepare(`INSERT INTO gastos (concepto, monto, metodo, referencia, notas, tipo, employee_id, usuario_id, periodo_label, categoria, payment_date) VALUES (?,?,?,?,?,'empleado',?,?,?,'Empleados',date('now'))`).run('Pago a empleado #' + empId, amount, method, reference, notes, empId, req.session.user.id, periodLabel || null);
      let loanMsg = '';
      if (loanDeduction > 0) {
        const loans = db.prepare('SELECT * FROM prestamos_empleado WHERE empleado_id=? AND restante>0 ORDER BY id ASC').all(empId);
        let remaining = loanDeduction;
        for (const loan of loans) {
          if (remaining <= 0) break;
          const deduct = Math.min(remaining, parseFloat(loan.restante));
          const newRest = parseFloat(loan.restante) - deduct;
          db.prepare('UPDATE prestamos_empleado SET restante=? WHERE id=?').run(newRest, loan.id);
          remaining -= deduct;
        }
        loanMsg = 'Se abonaron ' + loanDeduction.toFixed(2) + ' al préstamo';
      }
      return res.json({ status: 'success', msg: 'Pago registrado', loan_msg: loanMsg });
    }

    if (ajax === 'pa_pay_other') {
      const concept = (req.body.concept || '').trim();
      const amount = parseFloat(req.body.amount) || 0;
      const method = req.body.method || 'Efectivo';
      const reference = (req.body.reference || '').trim();
      const notes = (req.body.notes || '').trim();
      const categoria = req.body.categoria === 'personal' ? 'Personal' : 'Empresa';
      const paymentDate = req.body.payment_date || new Date().toISOString().split('T')[0];
      if (!concept || amount <= 0) return res.json({ status: 'error', msg: 'Datos inválidos' });
      db.prepare(`INSERT INTO gastos (concepto, monto, metodo, referencia, notas, tipo, usuario_id, categoria, payment_date) VALUES (?,?,?,?,?,'otro',?,?,?)`).run(concept, amount, method, reference, notes, req.session.user.id, categoria, paymentDate);
      return res.json({ status: 'success', msg: 'Gasto registrado' });
    }

    return res.json({ status: 'error', msg: 'Acción no reconocida' });
  }

  if (req.body && req.body.accion === 'guardar_zona') {
    if (!req.session.user) return res.redirect('/');
    const id = parseInt(req.body.id_zona) || 0;
    const nombre = (req.body.nombre || '').trim();
    const routerId = parseInt(req.body.router_id) || null;
    const vlanOnu = parseInt(req.body.vlan_onu) || null;
    const oltId = parseInt(req.body.smartolt_profile_id) || null;
    const smartoltZone = (req.body.smartolt_zone || '').trim();
    if (!nombre) return res.redirect('/modulo?pagina=Zonas');
    if (id) {
      db.prepare('UPDATE zonas SET nombre=?, router_id=?, vlan_onu=?, smartolt_profile_id=?, smartolt_zone=? WHERE id=?').run(nombre, routerId, vlanOnu, oltId, smartoltZone, id);
    } else {
      db.prepare('INSERT INTO zonas (nombre, router_id, vlan_onu, smartolt_profile_id, smartolt_zone) VALUES (?,?,?,?,?)').run(nombre, routerId, vlanOnu, oltId, smartoltZone);
    }
    return res.redirect('/modulo?pagina=Zonas');
  }
  if (req.body && req.body.accion === 'eliminar_zona') {
    const id = parseInt(req.body.id_zona) || 0;
    if (id) db.prepare('DELETE FROM zonas WHERE id=?').run(id);
    return res.redirect('/modulo?pagina=Zonas');
  }
  if (req.body && req.body.accion === 'guardar_ciclo') {
    if (!req.session.user) return res.redirect('/');
    const { id_ciclo, billing_type, invoice_day, suspend_day, tolerance_months, suspend_weekends,
      notify_1, notify_2, notify_3, reconnection_option, reconnection_amount,
      invoice_suspended, prorate_first_invoice, grace_days_option, grace_days,
      notify_on_suspend, notify_on_payment } = req.body;
    const reconnActive = reconnection_option === 'si' ? 1 : 0;
    const invSusp = invoice_suspended === 'si' ? 1 : 0;
    const prorate = prorate_first_invoice === 'si' ? 1 : 0;
    const graceVal = grace_days_option === 'si' ? (parseInt(grace_days) || 0) : 0;
    const suspWeekends = suspend_weekends === 'si' ? 1 : 0;
    const notifSusp = notify_on_suspend === 'si' ? 1 : 0;
    const notifPay = notify_on_payment === 'si' ? 1 : 0;
    const name = (req.body.name && req.body.name.trim()) ? req.body.name.trim() : (billing_type === 'postpago' ? 'POST' : 'PRE') + ' | Gen: Dia ' + invoice_day + ' | Corte: Dia ' + suspend_day;

    if (id_ciclo) {
      db.prepare(`UPDATE billing_cycles SET billing_type=?, invoice_day=?, payment_day=?, suspend_day=?, tolerance_months=?,
        suspend_weekends=?, notify_day_1=?, notify_day_2=?, notify_day_3=?, reconnection_fee_active=?,
        reconnection_amount=?, invoice_suspended=?, prorate_first_invoice=?, grace_days=?, notify_on_suspend=?,
        notify_on_payment=?, name=? WHERE id=?`).run(
        billing_type, invoice_day, req.body.payment_day || invoice_day, suspend_day, tolerance_months, suspWeekends,
        notify_1||0, notify_2||0, notify_3||0, reconnActive, reconnection_amount||0,
        invSusp, prorate, graceVal, notifSusp, notifPay, name, id_ciclo
      );
    } else {
      db.prepare(`INSERT INTO billing_cycles (billing_type, invoice_day, payment_day, suspend_day, tolerance_months,
        suspend_weekends, notify_day_1, notify_day_2, notify_day_3, reconnection_fee_active,
        reconnection_amount, invoice_suspended, prorate_first_invoice, grace_days, notify_on_suspend,
        notify_on_payment, name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        billing_type, invoice_day, req.body.payment_day || invoice_day, suspend_day, tolerance_months, suspWeekends,
        notify_1||0, notify_2||0, notify_3||0, reconnActive, reconnection_amount||0,
        invSusp, prorate, graceVal, notifSusp, notifPay, name
      );
    }
    return res.redirect('/modulo?pagina=Facturacion');
  }
  if (req.body && req.body.accion === 'eliminar') {
    const id = parseInt(req.body.id_ciclo) || 0;
    if (id) db.prepare('DELETE FROM billing_cycles WHERE id=?').run(id);
    return res.redirect('/modulo?pagina=Facturacion');
  }
  
  // ===== VENTAS: ejecutar_venta =====
  if (req.query.pagina === 'Ventas' && req.query.ajax === 'ejecutar_venta') {
    const codigo = (req.body.codigo || '').trim().toUpperCase();
    const cantidad = parseInt(req.body.cantidad) || 1;
    const clientId = parseInt(req.body.client_id) || 0;
    const modo = req.body.modo || 'contado';
    const metodoPago = req.body.metodo_pago || 'EFECTIVO';
    const nota = (req.body.nota || '').trim();
    const noClienteNombre = (req.body.no_cliente_nombre || '').trim();

    if (!codigo || cantidad <= 0) {
      return res.json({ success: false, msg: 'Código de producto y cantidad requeridos' });
    }

    // Buscar el artículo
    const item = db.prepare("SELECT * FROM inventario WHERE codigo=? AND es_venta=1").get(codigo);
    if (!item) return res.json({ success: false, msg: 'Producto no encontrado o no disponible para venta' });
    if (item.stock < cantidad) return res.json({ success: false, msg: 'Stock insuficiente. Disponible: ' + item.stock });

    // Determinar nombre del cliente
    var clienteNombre = noClienteNombre || 'N/A';
    if (clientId > 0) {
      var cli = db.prepare('SELECT nombre FROM clientes WHERE id=?').get(clientId);
      if (cli) clienteNombre = cli.nombre;
    }

    const total = item.precio * cantidad;
    const itbis = total * 0.18; // 18% ITBIS

    // Crear venta y descontar stock en transacción
    var executeSale = db.transaction(function() {
      var ventaResult = db.prepare(
        'INSERT INTO ventas (cliente_id, cliente_nombre, total, itbis, modo, metodo_pago, nota, usuario_id) VALUES (?,?,?,?,?,?,?,?)'
      ).run(clientId || null, clienteNombre, total, itbis, modo, metodoPago, nota || null, req.session.user ? req.session.user.id : null);

      var ventaId = ventaResult.lastInsertRowid;

      // Insertar item
      db.prepare(
        'INSERT INTO ventas_items (venta_id, inventario_id, cantidad, precio_unitario) VALUES (?,?,?,?)'
      ).run(ventaId, item.id, cantidad, item.precio);

      // Descontar stock
      db.prepare('UPDATE inventario SET stock=stock-? WHERE id=?').run(cantidad, item.id);

      // Registrar movimiento de inventario
      db.prepare(
        'INSERT INTO inventario_movimientos (inventario_id, tipo, cantidad, cliente_id) VALUES (?,\'salida\',?,?)'
      ).run(item.id, cantidad, clientId > 0 ? clientId : null);

      return ventaId;
    });

    try {
      var ventaId = executeSale();
      var msg = modo === 'factura' ? 'Venta registrada en factura' : 'Venta realizada exitosamente';
      return res.json({ success: true, msg: msg, venta_id: ventaId, modo: modo });
    } catch (e) {
      return res.json({ success: false, msg: 'Error al procesar venta: ' + e.message });
    }
  }

  // ========== CRON POST HANDLERS ==========
  if (req.query.pagina === 'Cron' && req.query.ajax) {
    const cronAjax = req.query.ajax;
    if (cronAjax === 'run_task') {
      var task = req.body.task || req.query.task;
      if (!task) return res.json({ status: 'error', msg: 'Task requerida' });
      if (task === 'recordatorios') {
        enviarRecordatoriosWA(req, res);
        return;
      }
      if (task === 'suspension') {
        enviarNotifSuspensionWA(req, res);
        return;
      }
      if (task === 'expirar_promesas') {
        ejecutarExpirarPromesas(req, res);
        return;
      }
      db.prepare("UPDATE cron_tasks SET last_run=datetime('now','localtime'), last_status='ok' WHERE task_name=?").run(task);
      return res.json({ status: 'success', msg: 'Tarea ejecutada' });
    }
    if (cronAjax === 'save_task') {
      var ct = req.body.task_name;
      var enabled = req.body.enabled ? 1 : 0;
      var hour = parseInt(req.body.hour) || 0;
      var minute = parseInt(req.body.minute) || 0;
      db.prepare('UPDATE cron_tasks SET enabled=?, hour=?, minute=? WHERE task_name=?').run(enabled, hour, minute, ct);
      return res.json({ status: 'success' });
    }
    return res.json({ status: 'error', msg: 'Acción no reconocida' });
  }

  next();
});

app.get('/api/facturacion/set_default', requireAuth, (req, res) => {
  const cycleId = parseInt(req.query.cycle_id) || 0;
  if (!cycleId) return res.json({ status: 'error', msg: 'ID inválido' });
  db.prepare('UPDATE billing_cycles SET is_default=0').run();
  db.prepare('UPDATE billing_cycles SET is_default=1 WHERE id=?').run(cycleId);
  res.json({ status: 'success', msg: 'Plantilla por defecto actualizada' });
});

// ===== TEMA (Sidebar Theme) =====
app.post('/api/theme/save', requireAuth, (req, res) => {
  const { theme } = req.body;
  if (!theme || !['dark','light','glass'].includes(theme)) {
    return res.json({ success: false, msg: 'Tema inválido' });
  }
  db.prepare("INSERT OR REPLACE INTO configuracion (key, value) VALUES ('sidebar_theme', ?)").run(theme);
  res.json({ success: true, msg: 'Tema guardado' });
});


// ==================== OpenWa API ====================
const openwa = require('./openwa-service');

// GET /api/template/get - Obtener contenido de una plantilla
app.get('/api/template/get', requireAuth, (req, res) => {
  var key = (req.query.key || '').trim();
  if (!key) return res.json({ status: 'error', msg: 'Key requerida' });
  var t = db.prepare('SELECT content FROM templates WHERE template_key=?').get(key);
  if (t) return res.json({ status: 'success', content: t.content });
  res.json({ status: 'error', msg: 'Plantilla no encontrada' });
});

// POST /api/openwa/test - Enviar mensaje de prueba
app.post('/api/openwa/test', requireAuth, async (req, res) => {
  var phone = req.body.phone || req.body.telefono || '';
  var message = req.body.message || req.body.mensaje || 'Hola, mensaje de prueba desde ISP Total';
  try {
    var result = await openwa.sendMessage(phone, message);
    res.json(result);
  } catch(e) {
    res.json({ success: false, msg: e.message });
  }
});

// GET /api/openwa/status - Estado de OpenWa
app.get('/api/openwa/status', requireAuth, (req, res) => {
  var status = openwa.getStatus();
  res.json({ running: status.running, state: status.state, qr: status.qr, config: openwa.getConfig() });
});

// POST /api/openwa/start - Iniciar OpenWa
app.post('/api/openwa/start', requireAuth, async (req, res) => {
  var status = openwa.getStatus();
  if (status.running) {
    // Ya está corriendo, devolver estado actual como éxito
    return res.json({ success: true, msg: 'OpenWa ya está activo', state: status.state, qr: status.qr });
  }
  var result = await openwa.start();
  res.json(result);
});

// POST /api/openwa/stop - Detener OpenWa
app.post('/api/openwa/stop', requireAuth, async (req, res) => {
  var result = await openwa.stop();
  res.json(result);
});

// POST /api/openwa/config - Guardar config de OpenWa
app.post('/api/openwa/config', requireAuth, (req, res) => {
  var fields = ['openwa_enabled','openwa_port','openwa_api_key','openwa_session_id','openwa_webhook'];
  fields.forEach(function(k) {
    if (req.body[k] !== undefined) {
      var val = req.body[k];
      if (k === 'openwa_enabled') {
        val = (val === 'Si' || val === 'si' || val === 'true' || val === '1') ? '1' : '0';
      }
      openwa.saveConfig(k, val);
    }
  });
  res.json({ status: 'success', msg: 'Configuración de OpenWa guardada' });
});

// GET /api/config/get - Obtener valores de config (soporta ?keys=key1,key2 o devuelve todo)
app.get('/api/config/get', requireAuth, (req, res) => {
  var keys = (req.query.keys || '').split(',').filter(Boolean);
  if (keys.length > 0) {
    // Devolver solo las keys solicitadas (usado por Clientes.ejs)
    var placeholders = keys.map(function() { return '?'; }).join(',');
    var stmt = db.prepare('SELECT key, value FROM configuracion WHERE key IN (' + placeholders + ')');
    var rows = stmt.all(...keys);
    var data = {};
    rows.forEach(function(r) { data[r.key] = r.value; });
    return res.json({ status: 'success', data: data });
  }
  // Devolver toda la config (usado por Configuracion.ejs)
  const configs = db.prepare("SELECT key, value FROM configuracion").all();
  const obj = {};
  configs.forEach(c => obj[c.key] = c.value);
  res.json(obj);
});

app.get('/api/theme/get', requireAuth, (req, res) => {
  const row = db.prepare("SELECT value FROM configuracion WHERE key='sidebar_theme'").get();
  res.json({ theme: row ? row.value : 'dark' });
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
  console.log('[SAVE-ROUTER] Request:', JSON.stringify({accion, id_router, id_router_edit, name, ip}));
  
  let routerId = id_router || id_router_edit;
  console.log('[SAVE-ROUTER] routerId:', routerId);
  
  if (accion === "editar" && (id_router || id_router_edit)) {
    const editId = parseInt(id_router || id_router_edit);
    console.log('[SAVE-ROUTER] EDIT mode, editId:', editId);
    if (password) {
      db.prepare("UPDATE routers SET name=?, ip=?, port=?, user=?, password=?, ip_blocks=? WHERE id=?")
        .run(name, ip, port || 8728, user, password, ip_blocks || "[]", editId);
    } else {
      db.prepare("UPDATE routers SET name=?, ip=?, port=?, user=?, ip_blocks=? WHERE id=?")
        .run(name, ip, port || 8728, user, ip_blocks || "[]", editId);
    }
    routerId = editId;
  } else {
    console.log('[SAVE-ROUTER] NEW/CREATE mode');
    // Avoid duplicates by IP
    const existing = db.prepare('SELECT id FROM routers WHERE ip=?').get(ip);
    if (existing) {
      db.prepare("UPDATE routers SET name=?, port=?, user=?, password=?, ip_blocks=? WHERE id=?")
        .run(name, port || 8728, user, password || "", ip_blocks || "[]", existing.id);
      routerId = existing.id;
    } else {
      const r = db.prepare("INSERT INTO routers (name, ip, port, user, password, ip_blocks) VALUES (?,?,?,?,?,?)")
        .run(name, ip, port || 8728, user, password || "", ip_blocks || "[]");
      routerId = r.lastInsertRowid;
    }
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


// Get PPP profiles from router
app.post('/api/routers/ppp-profiles', requireAuth, async (req, res) => {
  const { host, port, username, password } = req.body;
  if (!host || !username || !password) return res.json({ success: false, error: 'Credenciales requeridas' });
  const result = await MikroTikAPI.getPPPProfiles(host, port || 8728, username, password);
  res.json(result);
});

// POST /api/routers/ppp/add-secret - Create PPPoE secret on router
app.post('/api/routers/ppp/add-secret', requireAuth, async (req, res) => {
  const { host, port, username, password, name, ppp_password, profile, service, remote_address, comment } = req.body;
  if (!host || !username || !password || !name || !ppp_password) {
    return res.json({ success: false, error: 'Host, credenciales, usuario y contraseña PPP requeridos' });
  }
  const result = await MikroTikAPI.addPPPSecret(host, port || 8728, username, password, {
    name: name,
    password: ppp_password,
    profile: profile || 'default',
    service: service || 'pppoe',
    'remote-address': remote_address || '',
    comment: comment || ''
  });
  res.json(result);
});

// GET /api/planes - List all plans
app.get('/api/planes', requireAuth, (req, res) => {
  const planes = db.prepare('SELECT p.*, (SELECT COUNT(*) FROM servicios WHERE plan_id=p.id) as servicios_count FROM planes p ORDER BY p.nombre').all();
  res.json(planes);
});

// ======== IP POOLS API ========
app.get('/api/ip-pools/:router_id', requireAuth, (req, res) => {
  const pools = db.prepare('SELECT * FROM ip_pools WHERE router_id=? ORDER BY red').all(req.params.router_id);
  // Get assigned count for each pool
  for (var i = 0; i < pools.length; i++) {
    const used = db.prepare('SELECT COUNT(*) as c FROM ips_asignadas WHERE pool_id=?').get(pools[i].id);
    pools[i].usadas = used ? used.c : 0;
    pools[i].disponibles = (pools[i].total || 0) - pools[i].usadas;
  }
  res.json(pools);
});

app.post('/api/ip-pools/calcular', requireAuth, (req, res) => {
  const red = req.body.red || '';
  if (!red) return res.json({ success: false, message: 'Red requerida' });
  const parts = red.split('/');
  if (parts.length !== 2) return res.json({ success: false, message: 'Formato invalido. Use CIDR (ej: 10.0.0.0/24)' });
  const baseIp = parts[0].trim();
  const cidr = parseInt(parts[1]);
  if (cidr < 8 || cidr > 30) return res.json({ success: false, message: 'CIDR debe estar entre 8 y 30' });
  // Calculate network/host bits
  const hostBits = 32 - cidr;
  const total = Math.pow(2, hostBits) - 2; // exclude network and broadcast
  if (total < 1) return res.json({ success: false, message: 'Rango muy pequeño' });
  // Get first usable IP
  const octets = baseIp.split('.').map(Number);
  const ipInt = (octets[0] << 24) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
  const networkInt = ipInt & (0xFFFFFFFF << hostBits);
  const firstIpInt = networkInt + 1;
  const lastIpInt = networkInt + Math.pow(2, hostBits) - 2;
  const firstIp = [(firstIpInt >>> 24) & 0xFF, (firstIpInt >>> 16) & 0xFF, (firstIpInt >>> 8) & 0xFF, firstIpInt & 0xFF].join('.');
  const lastIp = [(lastIpInt >>> 24) & 0xFF, (lastIpInt >>> 16) & 0xFF, (lastIpInt >>> 8) & 0xFF, lastIpInt & 0xFF].join('.');
  res.json({ success: true, total: total, first_ip: firstIp, last_ip: lastIp, cidr: cidr });
});

app.post('/api/ip-pools/guardar', requireAuth, (req, res) => {
  const { router_id, red, tipo } = req.body;
  if (!router_id || !red) return res.json({ success: false, message: 'Router y red requeridos' });
  // Calculate IPs
  const parts = red.split('/');
  const cidr = parseInt(parts[1]) || 24;
  const hostBits = 32 - cidr;
  const total = Math.pow(2, hostBits) - 2;
  db.prepare('INSERT INTO ip_pools (router_id, red, tipo, total) VALUES (?,?,?,?)').run(router_id, red, tipo || 'privada', total);
  res.json({ success: true, message: 'Pool agregado', total: total });
});

app.post('/api/ip-pools/:id/eliminar', requireAuth, (req, res) => {
  db.prepare('DELETE FROM ips_asignadas WHERE pool_id=?').run(req.params.id);
  db.prepare('DELETE FROM ip_pools WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/ip-pools/:pool_id/disponibles', requireAuth, (req, res) => {
  const pool = db.prepare('SELECT * FROM ip_pools WHERE id=?').get(req.params.pool_id);
  if (!pool) return res.json({ success: false, message: 'Pool no encontrado' });
  const asignadas = db.prepare('SELECT ip FROM ips_asignadas WHERE pool_id=?').all(pool.id);
  const ipsAsignadasSet = {};
  for (var i = 0; i < asignadas.length; i++) ipsAsignadasSet[asignadas[i].ip] = true;
  
  const parts = pool.red.split('/');
  const cidr = parseInt(parts[1]) || 24;
  const hostBits = 32 - cidr;
  const octets = parts[0].split('.').map(Number);
  const ipInt = (octets[0] << 24) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
  const networkInt = ipInt & (0xFFFFFFFF << hostBits);
  
  const disponibles = [];
  const total = Math.pow(2, hostBits) - 2;
  for (var j = 1; j <= total; j++) {
    const curInt = networkInt + j;
    const curIp = [(curInt >>> 24) & 0xFF, (curInt >>> 16) & 0xFF, (curInt >>> 8) & 0xFF, curInt & 0xFF].join('.');
    if (!ipsAsignadasSet[curIp]) disponibles.push(curIp);
    if (disponibles.length >= 500) break;
  }
  res.json({ success: true, ip: disponibles[0] || null, disponibles: disponibles, total: total - Object.keys(ipsAsignadasSet).length });
});

// POST /api/servicios/crear - Create new service (simple version)
app.post('/api/servicios/crear', requireAuth, async (req, res) => {
  const { cliente_id, plan_id, zona_id, auth_type, ip, pool, router_ip, router_port, router_user, router_pass, wifi_ssid, wifi_pass, direccion } = req.body;
  if (!cliente_id) return res.json({ success: false, error: 'Cliente requerido' });
  
  // Generar PPPoE user a partir del nombre del cliente
  var pppoeUser = req.body.pppoe_user || '';
  var pppoePass = '1320'; // Contraseña fija
  
  if (!pppoeUser && auth_type === 'pppoe') {
    try {
      var cliente = db.prepare('SELECT nombre FROM clientes WHERE id=?').get(cliente_id);
      if (cliente && cliente.nombre) {
        var parts = cliente.nombre.trim().split(/\s+/);
        // Primera letra mayuscula de cada parte, concatenar primeras dos
        var userParts = parts.map(function(p) { return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(); });
        pppoeUser = userParts.join('');
        // Remover caracteres especiales
        pppoeUser = pppoeUser.replace(/[^a-zA-Z0-9]/g, '');
      }
    } catch(e) {}
  }
  
  // Validate plan_id - check if it's a valid plan in DB
  var planValido = parseInt(plan_id) > 0 ? parseInt(plan_id) : null;
  if (planValido) {
    const existe = db.prepare('SELECT id FROM planes WHERE id=?').get(planValido);
    if (!existe) planValido = null;
  }
  
  try {
    // Create service
    const r = db.prepare("INSERT INTO servicios (cliente_id, plan_id, zona_id, ip, auth_type, pppoe_user, pppoe_pass, wifi_ssid, wifi_pass, direccion, estado, fecha_activacion, ciclo_id) VALUES (?,?,?,?,?,?,?,?,?,?,'activo',date('now'),?)").run(cliente_id, planValido, zona_id || null, ip || null, auth_type || 'dhcp', pppoeUser, pppoePass, wifi_ssid || '', wifi_pass || '', direccion || '', req.body.ciclo_id || null);
    const servicioId = r.lastInsertRowid;
    
    // Assign IP if pool was selected
    if (ip && pool) {
      try {
        db.prepare('INSERT OR IGNORE INTO ips_asignadas (pool_id, ip, servicio_id, cliente_id) VALUES (?,?,?,?)').run(parseInt(pool), ip, servicioId, cliente_id);
      } catch(e) { /* IP already assigned, ignore */ }
    }
    
    // Enviar mensaje de bienvenida por WhatsApp (ANTES del PPPoE, para que siempre se envie)
    try {
      sendWelcomeMessage(servicioId, cliente_id, planValido, req.body.ciclo_id);
    } catch(e) {
      console.log('[Bienvenida] Error al enviar mensaje:', e.message);
    }
    
    // If PPPoE, create secret on MikroTik
    if (auth_type === 'pppoe' && router_ip && router_user && router_pass) {
      try {
        const MikroTikAPI = require('./mikrotik-api');
        var secretResult = await MikroTikAPI.addPPPSecret(router_ip, router_port || 8728, router_user, router_pass, {
          name: pppoeUser || ('CLI' + cliente_id),
          password: pppoePass,
          profile: String(plan_id || 'default'),
          service: 'pppoe',
          'remote-address': ip || '',
          comment: 'Cliente #' + cliente_id + ' - Servicio #' + servicioId
        });
        if (!secretResult.success) {
          return res.json({ success: true, warning: 'Servicio creado pero error en PPPoE: ' + (secretResult.error || '') });
        }
      } catch(e) {
        return res.json({ success: true, warning: 'Servicio creado pero error al conectar con router: ' + e.message });
      }
    }
    
    res.json({ success: true, message: 'Servicio creado exitosamente', id: servicioId });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

// Función: enviar mensajes de bienvenida al crear servicio
// Envía la plantilla de métodos de pago y la de detalles del servicio
// Si OpenWa no está conectado, encola los mensajes para enviarlos después
function sendWelcomeMessage(servicioId, clienteId, planId, cicloId) {
  try {
    var openwa = require('./openwa-service');
    var cliente = db.prepare('SELECT nombre, telefono FROM clientes WHERE id=?').get(clienteId);
    if (!cliente || !cliente.telefono) {
      console.log('[Bienvenida] Cliente #' + clienteId + ' sin teléfono. No se envió mensaje.');
      return;
    }
    
    // Datos del servicio específico
    var servicio = db.prepare('SELECT s.ip, s.direccion, s.ciclo_id, p.nombre as plan_nombre, p.precio as plan_precio, p.velocidad as plan_velocidad FROM servicios s LEFT JOIN planes p ON p.id=s.plan_id WHERE s.id=?').get(servicioId);
    
    // Datos del plan
    var plan = null;
    if (planId) plan = db.prepare('SELECT nombre, precio, velocidad FROM planes WHERE id=?').get(planId);
    if (!plan && servicio) plan = { nombre: servicio.plan_nombre, precio: servicio.plan_precio, velocidad: servicio.plan_velocidad };
    
    var planName = plan ? plan.nombre : '';
    var planPrice = plan ? parseFloat(plan.precio).toFixed(2) : '';
    var planSpeed = plan ? (plan.velocidad || '') : '';
    
    // Ciclo de facturación
    var ciclo = null;
    var cicloIdActual = cicloId || (servicio ? servicio.ciclo_id : null);
    if (cicloIdActual) ciclo = db.prepare('SELECT * FROM billing_cycles WHERE id=?').get(cicloIdActual);
    
    // Configuración de empresa
    var configRows = db.prepare("SELECT key, value FROM configuracion WHERE key IN ('empresa_nombre','empresa_telefono','empresa_correo','moneda','oficina_direccion','oficina_horario','no_cobro_msg','bancos_data')").all();
    var config = { empresa_nombre: 'ISP Total', empresa_telefono: '', empresa_correo: '', moneda: 'RD$', oficina_direccion: '', oficina_horario: '', no_cobro_msg: 'No realizamos cobros los días domingos.', bancos_data: '[]' };
    configRows.forEach(function(r) { config[r.key] = r.value || ''; });
    
    // Generar listado de bancos
    var bancosListado = '';
    try {
      var bancos = JSON.parse(config.bancos_data || '[]');
      if (bancos.length > 0) {
        var lines = [];
        bancos.forEach(function(b) {
          var nombre = b.nombre || '';
          var titular = b.titular || '';
          var numero = b.numero || '';
          var tipo = b.tipo || '';
          var cedula = b.cedula || '';
          var line = '🏦 ' + nombre;
          if (titular) line += '\n   Titular: ' + titular;
          if (numero) line += '\n   Cuenta ' + tipo + ': ' + numero;
          if (cedula) line += '\n   Cédula/RNC: ' + cedula;
          lines.push(line);
        });
        bancosListado = lines.join('\n\n');
      }
    } catch(e) {}
    
    var paymentDay = ciclo ? (ciclo.payment_day || ciclo.invoice_day || '') : '';
    var suspendDay = ciclo ? (ciclo.suspend_day || '') : '';
    var graceDays = ciclo ? (ciclo.grace_days || '0') : '0';
    
    // ====== CÁLCULO DE PRORRATEO ======
    var hoy = new Date();
    var diaHoy = hoy.getDate();
    var mesHoy = hoy.getMonth();
    var anioHoy = hoy.getFullYear();
    var planPriceNum = plan ? parseFloat(plan.precio) : 0;
    var proximoPago = '';
    var montoProrrateado = '';
    var diasFacturados = 0;
    var diasHastaCorte = '';
    var primerPagoGratis = false;
    
    if (planPriceNum > 0) {
      var meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
      var precioPorDia = planPriceNum / 30;
      
      if (ciclo) {
        // Con ciclo de facturación: calcular según días de pago y corte configurados
        var payDay = parseInt(ciclo.payment_day) || parseInt(ciclo.invoice_day) || 30;
        var cutDay = parseInt(ciclo.suspend_day) || 15;
        var graceD = parseInt(ciclo.grace_days) || 0;
        
        // Calcular próxima fecha de pago
        var nextPayDate = new Date(anioHoy, mesHoy, payDay);
        if (diaHoy >= payDay) {
          nextPayDate = new Date(anioHoy, mesHoy + 1, payDay);
        }
        
        // Calcular días desde hoy hasta próximo pago
        var diffMs = nextPayDate.getTime() - hoy.getTime();
        var daysUntilPay = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        
        proximoPago = payDay + ' de ' + meses[nextPayDate.getMonth()];
        
        if (daysUntilPay <= graceD) {
          primerPagoGratis = true;
          montoProrrateado = '$0.00';
          diasFacturados = 0;
        } else {
          diasFacturados = daysUntilPay;
          var montoProrrateo = precioPorDia * diasFacturados;
          montoProrrateado = config.moneda + montoProrrateo.toFixed(2);
        }
        
        // Calcular días hasta corte
        var cutDate = new Date(anioHoy, mesHoy, cutDay);
        if (diaHoy >= cutDay) {
          cutDate = new Date(anioHoy, mesHoy + 1, cutDay);
        } else if (diaHoy < payDay) {
          cutDate = new Date(anioHoy, mesHoy, cutDay);
          if (cutDay < payDay) {
            cutDate = new Date(anioHoy, mesHoy + 1, cutDay);
          }
        }
        var diffCutMs = cutDate.getTime() - hoy.getTime();
        diasHastaCorte = Math.ceil(diffCutMs / (1000 * 60 * 60 * 24)) + '';
      } else {
        // Sin ciclo: buscar el primer ciclo disponible o usar defaults
        var primerCiclo = db.prepare("SELECT * FROM billing_cycles WHERE is_default=1 OR id=(SELECT MIN(id) FROM billing_cycles)").get();
        if (primerCiclo) {
          var payDay = parseInt(primerCiclo.payment_day) || parseInt(primerCiclo.invoice_day) || 30;
          var cutDay = parseInt(primerCiclo.suspend_day) || 15;
          var graceD = parseInt(primerCiclo.grace_days) || 0;
          
          var nextPayDate = new Date(anioHoy, mesHoy, payDay);
          if (diaHoy >= payDay) nextPayDate = new Date(anioHoy, mesHoy + 1, payDay);
          
          var diffMs = nextPayDate.getTime() - hoy.getTime();
          var daysUntilPay = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
          proximoPago = payDay + ' de ' + meses[nextPayDate.getMonth()];
          
          if (daysUntilPay <= graceD) {
            primerPagoGratis = true;
            montoProrrateado = '$0.00';
            diasFacturados = 0;
          } else {
            diasFacturados = daysUntilPay;
            var montoProrrateo = precioPorDia * diasFacturados;
            montoProrrateado = config.moneda + montoProrrateo.toFixed(2);
          }
          
          var cutDate = new Date(anioHoy, mesHoy, cutDay);
          if (diaHoy >= cutDay) cutDate = new Date(anioHoy, mesHoy + 1, cutDay);
          else if (diaHoy < payDay) {
            cutDate = new Date(anioHoy, mesHoy, cutDay);
            if (cutDay < payDay) cutDate = new Date(anioHoy, mesHoy + 1, cutDay);
          }
          var diffCutMs = cutDate.getTime() - hoy.getTime();
          diasHastaCorte = Math.ceil(diffCutMs / (1000 * 60 * 60 * 24)) + '';
        } else {
          // Sin ciclos en el sistema: mostrar el precio completo
          proximoPago = '30 de ' + meses[mesHoy + 1 < 12 ? mesHoy + 1 : 0];
          diasFacturados = 30;
          var montoProrrateo = precioPorDia * 30;
          montoProrrateado = config.moneda + montoProrrateo.toFixed(2);
          diasHastaCorte = '15';
        }
      }
    }
    
    // Función para reemplazar variables
    function fillTemplate(content) {
      if (!content) return '';
      return content
        .replace(/{client_name}/g, cliente.nombre || '')
        .replace(/{plan_name}/g, planName)
        .replace(/{plan_price}/g, planPrice || '')
        .replace(/{speed}/g, planSpeed)
        .replace(/{plan_download}/g, planSpeed)
        .replace(/{plan_upload}/g, '')
        .replace(/{company_name}/g, config.empresa_nombre || '')
        .replace(/{company_phone}/g, config.empresa_telefono || '')
        .replace(/{company_email}/g, config.empresa_correo || '')
        .replace(/{current_date}/g, new Date().toLocaleDateString('es-DO'))
        .replace(/{service_address}/g, servicio ? (servicio.direccion || '') : '')
        .replace(/{payment_day}/g, paymentDay)
        .replace(/{suspend_day}/g, suspendDay)
        .replace(/{grace_days}/g, graceDays)
        .replace(/{proximo_pago}/g, proximoPago)
        .replace(/{monto_prorrateado}/g, montoProrrateado)
        .replace(/{dias_facturados}/g, diasFacturados + '')
        .replace(/{dias_hasta_corte}/g, diasHastaCorte)
        .replace(/{primer_pago_gratis}/g, primerPagoGratis ? '✅ Este primer período no tiene costo, está dentro de los días de gracia.' : '')
        .replace(/{promise_extra_days}/g, '3')
        .replace(/{promesa_por_mes}/g, '1')
        .replace(/{bancos_listado}/g, bancosListado)
        .replace(/{oficina_direccion}/g, config.oficina_direccion || '')
        .replace(/{oficina_horario}/g, config.oficina_horario || '')
        .replace(/{no_cobro_msg}/g, config.no_cobro_msg || 'No realizamos cobros los días domingos.')
        .replace(/{moneda}/g, config.moneda || 'RD$');
    }
    
    // Generar mensaje de bienvenida (solo plantilla de métodos de pago)
    var tpl1 = db.prepare("SELECT content FROM templates WHERE template_key='bienvenida_sms'").get();
    var msg1 = fillTemplate(tpl1 ? tpl1.content : 'Hola {client_name}, bienvenido a {company_name}. Tu servicio de {plan_name} ha sido activado. 📞 {company_phone}');
    
    var mensajesEnviar = [];
    if (msg1.trim()) mensajesEnviar.push({ texto: msg1, tipo: 'bienvenida_pago' });
    
    if (mensajesEnviar.length === 0) return;
    
    // Verificar si OpenWa está conectado
    var status = openwa.getStatus();
    var conectado = (status.state === 'connected');
    
    mensajesEnviar.forEach(function(m, idx) {
      if (conectado) {
        // Enviar inmediatamente
        var delay = idx * 500;
        setTimeout(function() {
          console.log('[Bienvenida] Enviando ' + m.tipo + ' a ' + cliente.nombre + ' (' + cliente.telefono + ')...');
          openwa.sendMessage(cliente.telefono, m.texto).then(function(r) {
            console.log('[Bienvenida] ' + m.tipo + ': ' + (r.success ? 'OK' : 'FALLÓ: ' + (r.msg || '')));
            if (!r.success) {
              // Falló el envío, encolar para reintentar
              openwa.encolarMensaje(clienteId, servicioId, cliente.telefono, m.texto, m.tipo);
            }
          }).catch(function(e) {
            console.log('[Bienvenida] Error ' + m.tipo + ': ' + e.message);
            openwa.encolarMensaje(clienteId, servicioId, cliente.telefono, m.texto, m.tipo);
          });
        }, delay);
      } else {
        // OpenWa desconectado: encolar para enviar cuando se conecte
        console.log('[Bienvenida] OpenWa desconectado, encolando ' + m.tipo + ' para ' + cliente.nombre);
        openwa.encolarMensaje(clienteId, servicioId, cliente.telefono, m.texto, m.tipo);
      }
    });
  } catch(e) {
    console.log('[Bienvenida] Error general: ' + e.message);
  }
}

// Función: enviar notificación de reactivación de servicio
function sendReactivationNotification(clienteId, servicioId, promesaFecha) {
  try {
    var openwa = require('./openwa-service');
    var cliente = db.prepare('SELECT nombre, telefono FROM clientes WHERE id=?').get(clienteId);
    if (!cliente || !cliente.telefono) return;
    
    var svc = db.prepare('SELECT s.direccion, p.nombre as plan_nombre FROM servicios s LEFT JOIN planes p ON p.id=s.plan_id WHERE s.id=?').get(servicioId);
    if (!svc) return;
    
    var config = {};
    var cr = db.prepare("SELECT key, value FROM configuracion WHERE key IN ('empresa_nombre','empresa_telefono','empresa_correo')").all();
    cr.forEach(function(r) { config[r.key] = r.value || ''; });
    
    var tpl = db.prepare("SELECT content FROM templates WHERE template_key='reactivar_servicio'").get();
    if (!tpl || !tpl.content) return;
    
    var promesaMsg = '';
    if (promesaFecha) {
      promesaMsg = '⏳ Este servicio fue reactivado por una promesa de pago. Tienes hasta el ' + promesaFecha + ' para pagar. Si no pagas antes de esa fecha, el servicio volverá a suspenderse.';
    }
    
    var msg = tpl.content
      .replace(/{client_name}/g, cliente.nombre || '')
      .replace(/{service_address}/g, svc.direccion || '')
      .replace(/{plan_name}/g, svc.plan_nombre || '')
      .replace(/{promesa_msg}/g, promesaMsg)
      .replace(/{promesa_fecha}/g, promesaFecha || '')
      .replace(/{company_phone}/g, config.empresa_telefono || '')
      .replace(/{company_name}/g, config.empresa_nombre || '')
      .replace(/{current_date}/g, new Date().toLocaleDateString('es-DO'));
    
    openwa.encolarMensaje(clienteId, servicioId, cliente.telefono, msg, 'reactivacion');
  } catch(e) {
    console.log('[Reactivacion] Error:', e.message);
  }
}

// POST /api/ip-pools/asignar - Mark IP as assigned
app.post('/api/ip-pools/asignar', requireAuth, (req, res) => {
  const { pool_id, ip, servicio_id, cliente_id } = req.body;
  if (!pool_id || !ip) return res.json({ success: false, message: 'Pool e IP requeridos' });
  try {
    db.prepare('INSERT INTO ips_asignadas (pool_id, ip, servicio_id, cliente_id) VALUES (?,?,?,?)').run(pool_id, ip, servicio_id || null, cliente_id || null);
    res.json({ success: true, message: 'IP asignada' });
  } catch(e) {
    if (e.message && e.message.includes('UNIQUE')) res.json({ success: false, message: 'IP ya asignada' });
    else res.json({ success: false, message: e.message });
  }
});

// ======== SMARTOLT API ========
const SMARTOLT_BASE = 'https://api.smartolt.com/api';

// Helper: fetch SmartOLT API
async function smartoltFetch(endpoint, method = 'GET', body = null) {
  const cfg = db.prepare("SELECT key, value FROM configuracion WHERE key IN ('smartolt_subdomain','smartolt_api_key','smartolt_olt_id')").all();
  const config = {};
  cfg.forEach(function(c) { config[c.key] = c.value; });
  
  if (!config.smartolt_subdomain || !config.smartolt_api_key) {
    throw new Error('SmartOLT no configurado. Configure subdominio y API Key');
  }
  
  // Use subdomain-based API URL
  const apiUrl = 'https://' + config.smartolt_subdomain + '.smartolt.com/api';
  const headers = {
    'X-API-Key': config.smartolt_api_key,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  
  const opts = {
    method: method,
    headers: headers
  };
  if (body) opts.body = JSON.stringify(body);
  
  const response = await fetch(apiUrl + endpoint, opts);
  
  // Handle non-JSON responses
  const ct = response.headers.get('content-type') || '';
  if (ct.indexOf('json') === -1) {
    const text = await response.text();
    throw new Error('Respuesta no JSON: ' + text.substring(0, 300));
  }
  
  const data = await response.json();
  if (data.status === 'error' || data.error) {
    throw new Error(data.msg || data.message || data.error || 'Error en API SmartOLT');
  }
  return data;
}

// GET /api/smartolt/config - Get SmartOLT configuration
app.get('/api/smartolt/config', requireAuth, (req, res) => {
  const cfg = db.prepare("SELECT key, value FROM configuracion WHERE key LIKE 'smartolt_%' OR key = 'smartolt_name'").all();
  const config = { name: 'SmartOLT' };
  cfg.forEach(function(c) { config[c.key.replace('smartolt_', '')] = c.value; });
  res.json(config);
});

// POST /api/smartolt/config/save - Save SmartOLT config
app.post('/api/smartolt/config/save', requireAuth, (req, res) => {
  const { name, subdomain, api_key, olt_id } = req.body;
  if (!subdomain || !api_key) {
    return res.json({ success: false, message: 'Subdominio y API Key son requeridos' });
  }
  const txn = db.transaction(function() {
    db.prepare("INSERT OR REPLACE INTO configuracion (key, value) VALUES ('smartolt_name', ?)").run(name || 'SmartOLT');
    db.prepare("INSERT OR REPLACE INTO configuracion (key, value) VALUES ('smartolt_subdomain', ?)").run(subdomain);
    db.prepare("INSERT OR REPLACE INTO configuracion (key, value) VALUES ('smartolt_api_key', ?)").run(api_key);
    db.prepare("INSERT OR REPLACE INTO configuracion (key, value) VALUES ('smartolt_olt_id', ?)").run(olt_id || '');
  });
  txn();
  res.json({ success: true, message: 'Configuración guardada' });
});

// POST /api/smartolt/test - Test SmartOLT connection
app.post('/api/smartolt/test', requireAuth, async (req, res) => {
  const { subdomain, api_key, olt_id } = req.body;
  
  if (!subdomain || !api_key) {
    return res.json({ success: false, message: 'Subdominio y API Key son requeridos' });
  }
  
  try {
    const apiUrl = 'https://' + subdomain + '.smartolt.com/api';
    const headers = {
      'X-API-Key': api_key,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    
    // Try to get OLTs list
    const response = await fetch(apiUrl + '/olts', { method: 'GET', headers: headers });
    
    // Handle non-JSON
    const ct = response.headers.get('content-type') || '';
    if (ct.indexOf('json') === -1) {
      const text = await response.text();
      if (response.status >= 400) {
        return res.json({ success: false, message: 'Error ' + response.status + ': ' + text.substring(0, 200) });
      }
      return res.json({ success: true, message: 'Conexión exitosa (respuesta no JSON)', olts: [] });
    }
    
    const data = await response.json();
    
    let olts = [];
    if (data.data && Array.isArray(data.data)) {
      olts = data.data;
    } else if (Array.isArray(data)) {
      olts = data;
    } else if (data.olts && Array.isArray(data.olts)) {
      olts = data.olts;
    }
    
    return res.json({
      success: true,
      message: 'Conexión exitosa. OLTs encontradas: ' + olts.length,
      olts: olts
    });
  } catch (e) {
    return res.json({ success: false, message: e.message || 'Error de conexión' });
  }
});

// POST /api/smartolt/sync - Sync ONUs from SmartOLT (multi-OLT)
app.post('/api/smartolt/sync', requireAuth, async (req, res) => {
  try {
    const olts = db.prepare("SELECT * FROM olts WHERE smartolt_subdomain IS NOT NULL AND smartolt_subdomain != '' AND smartolt_api_key IS NOT NULL AND smartolt_api_key != '' AND activo=1").all();
    if (olts.length === 0) return res.json({ success: false, message: 'No hay OLTs configuradas' });
    let totalOnus = 0, errors = [];
    for (const olt of olts) {
      try {
        const apiUrl = 'https://' + olt.smartolt_subdomain + '.smartolt.com/api';
        const headers = { 'X-Token': olt.smartolt_api_key, 'Accept': 'application/json' };
        const oltIdParam = olt.smartolt_olt_id ? '?olt_id=' + olt.smartolt_olt_id : '';
        const resp = await fetch(apiUrl + '/onu/get_all_onus_details' + oltIdParam, { method: 'GET', headers: headers });
        const ct = resp.headers.get('content-type') || '';
        if (ct.indexOf('json') === -1) { errors.push(olt.nombre + ': no JSON'); continue; }
        const data = await resp.json();
        let onus = [];
        if (Array.isArray(data.response)) onus = data.response;
        else if (data.onus && Array.isArray(data.onus)) onus = data.onus;
        else if (Array.isArray(data.data)) onus = data.data;
        else if (Array.isArray(data)) onus = data;
        if (!onus.length) continue;

        const upsert = db.prepare("INSERT INTO onu (sn, nombre, olt_id, puerto_olt, estado, senial) VALUES (?,?,?,?,?,?) ON CONFLICT(sn) DO UPDATE SET nombre=COALESCE(excluded.nombre,onu.nombre), olt_id=COALESCE(excluded.olt_id,onu.olt_id), puerto_olt=COALESCE(excluded.puerto_olt,onu.puerto_olt), estado=COALESCE(excluded.estado,onu.estado), senial=COALESCE(excluded.senial,onu.senial)");
        const txn = db.transaction(function() {
          onus.forEach(function(o) {
            const sn = o.sn || o.serial || o.serial_number || '';
            if (!sn) return;
            const nombre = o.name || o.nombre || o.description || sn;
            const puerto = o.port || o.pon_port || o.puerto || null;
            const estado = (o.status === 'active' || o.admin_status === 'active') ? 'activo' : 'inactive';
            const senial = o.signal || o.signal_dbm || o.rx_power || o.senial || null;
            upsert.run(sn, nombre, olt.id, puerto, estado, senial);
          });
        });
        txn();
        totalOnus += onus.length;
      } catch(e) { errors.push(olt.nombre + ': ' + e.message); }
    }
    return res.json({ success: true, message: totalOnus + ' ONUs sincronizadas de ' + olts.length + ' OLTs' + (errors.length ? ' (' + errors.length + ' errores)' : ''), count: totalOnus });
  } catch(e) { return res.json({ success: false, message: e.message || 'Error' }); }
});

// GET /api/smartolt/onus - List ONUs
app.get('/api/smartolt/onus', requireAuth, (req, res) => {
  try {
    const onus = db.prepare(`
      SELECT o.*, c.nombre as cliente_nombre, c.telefono as cliente_telefono,
             s.estado as servicio_estado, s.id as servicio_id, ol.nombre as olt_nombre
      FROM onu o
      LEFT JOIN clientes c ON c.id = o.cliente_id
      LEFT JOIN servicios s ON s.id = o.servicio_id
      LEFT JOIN olts ol ON ol.id = o.olt_id
      ORDER BY o.created_at DESC
    `).all();
    res.json({ success: true, data: onus });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// POST /api/smartolt/onu/:id/action - Execute action on ONU
app.post('/api/smartolt/onu/:id/action', requireAuth, async (req, res) => {
  const onuId = parseInt(req.params.id);
  const { action } = req.body;
  
  try {
    const cfg = db.prepare("SELECT key, value FROM configuracion WHERE key IN ('smartolt_subdomain','smartolt_api_key')").all();
    const config = {};
    cfg.forEach(function(c) { config[c.key] = c.value; });
    
    if (!config.smartolt_subdomain || !config.smartolt_api_key) {
      return res.json({ success: false, message: 'SmartOLT no configurado' });
    }
    
    const onu = db.prepare('SELECT * FROM onu WHERE id = ?').get(onuId);
    if (!onu) {
      return res.json({ success: false, message: 'ONU no encontrada en la base de datos' });
    }
    
    const apiUrl = 'https://' + config.smartolt_subdomain + '.smartolt.com/api';
    const headers = {
      'X-API-Key': config.smartolt_api_key,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    
    const actionsMap = {
      'activate': { endpoint: '/onus/' + onu.sn + '/activate', method: 'POST', description: 'activar' },
      'deactivate': { endpoint: '/onus/' + onu.sn + '/deactivate', method: 'POST', description: 'suspender' },
      'reboot': { endpoint: '/onus/' + onu.sn + '/reboot', method: 'POST', description: 'reiniciar' },
      'delete': { endpoint: '/onus/' + onu.sn + '/delete', method: 'POST', description: 'eliminar' },
      'resync': { endpoint: '/onus/' + onu.sn, method: 'GET', description: 'resincronizar' }
    };
    
    const act = actionsMap[action];
    if (!act) {
      return res.json({ success: false, message: 'Acción no válida: ' + action });
    }
    
    // For local actions (delete from DB, resync from API)
    if (action === 'delete') {
      // Try API delete first, then remove from local DB
      try {
        const apiUrl2 = 'https://' + config.smartolt_subdomain + '.smartolt.com/api';
        await fetch(apiUrl2 + '/onus/' + onu.sn + '/delete', { method: 'POST', headers: headers });
      } catch (apiErr) {
        // Continue even if API delete fails
      }
      db.prepare('UPDATE onu SET cliente_id = NULL, servicio_id = NULL WHERE id = ?').run(onuId);
      db.prepare('DELETE FROM onu WHERE id = ?').run(onuId);
      return res.json({ success: true, message: 'ONU eliminada' });
    }
    
    if (action === 'resync') {
      // Re-fetch this ONU from SmartOLT API
      try {
        const resp = await fetch(apiUrl + '/onus/' + onu.sn, { method: 'GET', headers: headers });
        const ct = resp.headers.get('content-type') || '';
        if (ct.indexOf('json') !== -1) {
          const data = await resp.json();
          const o = data.data || data;
          if (o) {
            const senial = o.signal || o.signal_dbm || o.rx_power || null;
            const estado = (o.status === 'active' || o.estado === 'active') ? 'activo' : 'inactive';
            db.prepare('UPDATE onu SET estado = ?, senial = ? WHERE id = ?').run(estado, senial, onuId);
          }
        }
        return res.json({ success: true, message: 'ONU resincronizada' });
      } catch (e) {
        return res.json({ success: false, message: 'Error al resincronizar: ' + e.message });
      }
    }
    
    // API actions (activate, deactivate, reboot)
    try {
      const resp = await fetch(apiUrl + act.endpoint, { method: act.method, headers: headers });
      const ct = resp.headers.get('content-type') || '';
      if (ct.indexOf('json') === -1) {
        const text = await resp.text();
        if (resp.ok) {
          // Update local state
          const newEstado = action === 'activate' ? 'activo' : 'inactive';
          db.prepare('UPDATE onu SET estado = ? WHERE id = ?').run(newEstado, onuId);
          return res.json({ success: true, message: 'ONU ' + act.description + ' exitosamente' });
        }
        return res.json({ success: false, message: 'Error ' + resp.status + ': ' + text.substring(0, 200) });
      }
      
      const data = await resp.json();
      
      // Update local state
      const newEstado = action === 'activate' ? 'activo' : 'inactive';
      db.prepare('UPDATE onu SET estado = ? WHERE id = ?').run(newEstado, onuId);
      
      return res.json({ success: true, message: 'ONU ' + act.description + ' exitosamente' });
    } catch (e) {
      return res.json({ success: false, message: 'Error en API SmartOLT: ' + e.message });
    }
  } catch (e) {
    return res.json({ success: false, message: e.message });
  }
});

// POST /api/smartolt/onu/link - Link ONU to client
app.post('/api/smartolt/onu/link', requireAuth, (req, res) => {
  const { onu_id, cliente_id } = req.body;
  
  if (!onu_id || !cliente_id) {
    return res.json({ success: false, message: 'ONU ID y Cliente ID son requeridos' });
  }
  
  try {
    const onu = db.prepare('SELECT * FROM onu WHERE id = ?').get(onu_id);
    if (!onu) {
      return res.json({ success: false, message: 'ONU no encontrada' });
    }
    
    const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(cliente_id);
    if (!cliente) {
      return res.json({ success: false, message: 'Cliente no encontrado' });
    }
    
    // Find or create a service for this client
    let servicio = db.prepare('SELECT * FROM servicios WHERE cliente_id = ? LIMIT 1').get(cliente_id);
    
    // Link ONU to cliente and servicio
    db.prepare('UPDATE onu SET cliente_id = ?, servicio_id = ? WHERE id = ?')
      .run(cliente_id, servicio ? servicio.id : null, onu_id);
    
    res.json({ success: true, message: 'ONU vinculada a ' + cliente.nombre });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// CRUD for ONU Types
app.get('/api/smartolt/onu-types', requireAuth, (req, res) => {
  try {
    let types = db.prepare("SELECT * FROM configuracion WHERE key LIKE 'onu_type_%' ORDER BY key").all();
    let result = [];
    types.forEach(function(t) {
      try {
        const parsed = JSON.parse(t.value);
        if (parsed && parsed.name) {
          result.push({ id: parsed.id, ...parsed });
        }
      } catch(e) {}
    });
    result.sort(function(a, b) { return a.id - b.id; });
    res.json({ success: true, data: result });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/smartolt/onu-types/save', requireAuth, (req, res) => {
  const { id, name, pon_type, ethernet_ports, wifi_band } = req.body;
  if (!name) {
    return res.json({ success: false, message: 'Nombre requerido' });
  }
  try {
    let typeId = parseInt(id) || 0;
    if (typeId <= 0) {
      // Get next ID
      const existing = db.prepare('SELECT value FROM configuracion WHERE key LIKE "onu_type_%"').all();
      let maxId = 0;
      existing.forEach(function(t) {
        try { const p = JSON.parse(t.value); if (p.id > maxId) maxId = p.id; } catch(e) {}
      });
      typeId = maxId + 1;
    }
    
    const data = JSON.stringify({
      id: typeId,
      name: name,
      pon_type: pon_type || 'gpon',
      ethernet_ports: parseInt(ethernet_ports) || 4,
      wifi_band: wifi_band || 'none'
    });
    
    db.prepare('INSERT OR REPLACE INTO configuracion (key, value) VALUES (?, ?)')
      .run('onu_type_' + typeId, data);
    
    res.json({ success: true, message: 'Modelo de ONU guardado' });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
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
    sector_id, plan_id, ciclo_id, billing_type, dia_generacion, dia_corte,
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
    const cicloVal = parseInt(req.body.ciclo_id) > 0 ? parseInt(req.body.ciclo_id) : null;
    const servResult = db.prepare(
      'INSERT INTO servicios (cliente_id, plan_id, zona_id, estado, fecha_activacion, ciclo_id) VALUES (?,?,?,\'activo\',date(\'now\'),?)'
    ).run(clienteId, plan_id, sector_id || null, cicloVal);
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
      html += "<tr><td><input type=\"checkbox\" class=\"clienteCheck\" data-id=\"" + c.id + "\" onchange=\"actualizarBulkSelection()\"></td><td>" + c.id + "</td><td><strong><a href=\"/modulo?pagina=VerCliente\u0026id=" + c.id + "\" style=\"color:var(--primary);text-decoration:none;\">" + c.nombre + "</a></strong></td><td>" + (c.zona_nombre || "") + "</td><td>" + (c.telefono || "") + "</td><td>" + est + "</td><td><div class=\"btn-group\"><button class=\"btn btn-sm btn-secondary\" onclick=\"toggleCliente(" + c.id + ")\" title=\"Seleccionar\"><i class=\"fas fa-check\"></i></button><button class=\"btn btn-sm btn-danger\" onclick=\"borrarCliente(" + c.id + ")\" title=\"Eliminar\"><i class=\"fas fa-trash\"></i></button></div></td></tr>";
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

// POST /api/clientes/servicios-info - Obtener servicios con info de deuda para suspensión
app.post("/api/clientes/servicios-info", requireAuth, (req, res) => {
  const { ids } = req.body;
  if (!ids || ids.length === 0) return res.json({ success: false, data: [] });
  
  var result = [];
  ids.forEach(function(clienteId) {
    var cliente = db.prepare('SELECT id, nombre, telefono FROM clientes WHERE id=?').get(clienteId);
    if (!cliente) return;
    
    var servicios = db.prepare('SELECT s.id, s.estado, s.direccion, p.nombre as plan_nombre, p.precio as plan_precio FROM servicios s LEFT JOIN planes p ON p.id=s.plan_id WHERE s.cliente_id=? AND s.estado IN (\'activo\',\'suspendido\') ORDER BY s.id').all(clienteId);
    
    var serviciosInfo = [];
    servicios.forEach(function(s) {
      var deuda = db.prepare("SELECT COALESCE(SUM(f.monto - COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0)),0) as total FROM facturas f WHERE f.servicio_id=? AND f.estado='pendiente'").get(s.id);
      serviciosInfo.push({
        id: s.id,
        estado: s.estado,
        direccion: s.direccion || '',
        plan_nombre: s.plan_nombre || 'Sin plan',
        deuda: deuda ? deuda.total : 0
      });
    });
    
    if (serviciosInfo.length > 0) {
      result.push({
        cliente_id: cliente.id,
        cliente_nombre: cliente.nombre,
        telefono: cliente.telefono,
        servicios: serviciosInfo
      });
    }
  });
  
  res.json({ success: true, data: result });
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

app.post("/api/clientes/:id/delete", requireAuth, async (req, res) => {
  try {
    var eliminarOnuSmartolt = req.body.eliminar_onu_smartolt === true;
    
    // Delete from SmartOLT if requested
    if (eliminarOnuSmartolt) {
      var onus = db.prepare("SELECT o.sn, o.olt_id FROM onu o WHERE o.cliente_id=? AND o.sn IS NOT NULL").all(req.params.id);
      for (var i = 0; i < onus.length; i++) {
        try {
          var olt = db.prepare('SELECT * FROM olts WHERE id=? AND smartolt_subdomain IS NOT NULL AND smartolt_api_key IS NOT NULL').get(onus[i].olt_id);
          if (olt) {
            var apiUrl = 'https://' + olt.smartolt_subdomain + '.smartolt.com/api';
            // Find ONU in SmartOLT
            var detResp = await fetch(apiUrl + '/onu/get_onus_details_by_sn/' + onus[i].sn, {
              method: 'GET', headers: { 'X-Token': olt.smartolt_api_key, 'Accept': 'application/json' }
            });
            var detData = await detResp.json();
            var onuList = detData.onus || detData.response || [];
            if (onuList.length > 0) {
              var extId = onuList[0].unique_external_id || onuList[0].id || onuList[0].onu_id || '';
              if (extId) {
                await fetch(apiUrl + '/onu/delete/' + extId, { method: 'POST', headers: { 'X-Token': olt.smartolt_api_key } });
              }
            }
            await fetch(apiUrl + '/system/save_config', { method: 'POST', headers: { 'X-Token': olt.smartolt_api_key } });
          }
        } catch(e2) { /* ignore per-ONU errors */ }
      }
    }
    
    // Delete in order to avoid FK constraints
    db.prepare("DELETE FROM pagos WHERE cliente_id=?").run(req.params.id);
    db.prepare("DELETE FROM facturas WHERE servicio_id IN (SELECT id FROM servicios WHERE cliente_id=?)").run(req.params.id);
    db.prepare("DELETE FROM ordenes WHERE cliente_id=?").run(req.params.id);
    db.prepare("UPDATE onu SET servicio_id=NULL, cliente_id=NULL WHERE cliente_id=?").run(req.params.id);
    db.prepare("DELETE FROM servicios WHERE cliente_id=?").run(req.params.id);
    db.prepare("DELETE FROM clientes WHERE id=?").run(req.params.id);
    res.json({ success: true });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
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


// ======== OLTS API ========
app.get('/api/olts', requireAuth, (req, res) => {
  const olts = db.prepare('SELECT * FROM olts ORDER BY nombre').all();
  res.json(olts);
});

app.post('/api/olts/save', requireAuth, (req, res) => {
  const { id, nombre, tipo, smartolt_subdomain, smartolt_api_key, smartolt_olt_id, vlan_default, tr069_vlan, tr069_profile } = req.body;
  if (!nombre) return res.json({ success: false, message: 'Nombre requerido' });
  if (parseInt(id) > 0) {
    db.prepare('UPDATE olts SET nombre=?, smartolt_subdomain=?, smartolt_api_key=?, smartolt_olt_id=?, vlan_default=?, tr069_vlan=?, tr069_profile=? WHERE id=?')
      .run(nombre, smartolt_subdomain||null, smartolt_api_key||null, smartolt_olt_id||null, vlan_default||'', tr069_vlan||'', tr069_profile||'SmartOLT', parseInt(id));
  } else {
    db.prepare('INSERT INTO olts (nombre, tipo, smartolt_subdomain, smartolt_api_key, smartolt_olt_id, vlan_default, tr069_vlan, tr069_profile) VALUES (?,?,?,?,?,?,?,?)')
      .run(nombre, tipo||'smartolt', smartolt_subdomain||null, smartolt_api_key||null, smartolt_olt_id||null, vlan_default||'', tr069_vlan||'', tr069_profile||'SmartOLT');
  }
  res.json({ success: true });
});

app.post('/api/olts/:id/delete', requireAuth, (req, res) => {
  db.prepare('DELETE FROM olts WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// POST /api/smartolt/onu/authorize - Authorize ONU on SmartOLT
app.post('/api/smartolt/onu/authorize', requireAuth, async (req, res) => {
  const { olt_id, serial, model, descripcion, vlan, servicio_id, cliente_nombre, board, port, onu_mode, pppoe_user, pppoe_pass, auth_type } = req.body;
  require('fs').appendFileSync('/tmp/isptotal.log', new Date().toISOString() + ' [AUTHORIZE-ONU] REQ olt=' + olt_id + ' sn=' + serial + ' model=' + (model||'') + ' vlan=' + (vlan||'') + ' board=' + (board||'') + ' port=' + (port||'') + ' mode=' + (onu_mode||'') + '\n');
  if (!olt_id || !serial) return res.json({ success: false, message: 'OLT y Serial requeridos' });
  const olt = db.prepare('SELECT * FROM olts WHERE id=? AND activo=1').get(olt_id);
  if (!olt || !olt.smartolt_subdomain || !olt.smartolt_api_key) return res.json({ success: false, message: 'OLT no configurada' });
  
  // Get zone from the service
  let zonaName = '';
  if (servicio_id) {
    const svc = db.prepare('SELECT s.*, z.nombre as zona_nombre FROM servicios s LEFT JOIN zonas z ON z.id=s.zona_id WHERE s.id=?').get(servicio_id);
    if (svc && svc.zona_nombre) zonaName = svc.zona_nombre;
  }
  
  try {
    const apiUrl = 'https://' + olt.smartolt_subdomain + '.smartolt.com/api';
    const params = new URLSearchParams();
    params.append('olt_id', olt.smartolt_olt_id || olt_id);
    params.append('sn', serial);
    params.append('pon_type', 'gpon');
    if (!model && serial) {
      try {
        const detResp = await fetch(apiUrl + '/onu/get_onus_details_by_sn/' + serial, { method: 'GET', headers: { 'X-Token': olt.smartolt_api_key, 'Accept': 'application/json' } });
        const detData = await detResp.json();
        let detList = detData.onus || detData.response || [];
        if (detList.length > 0 && (detList[0].onu_type || detList[0].model)) {
          model = detList[0].onu_type || detList[0].model;
        }
      } catch(eDet) {}
    }
    if (model) params.append('onu_type', model);
    // Siempre Routing a menos que el usuario envíe explícitamente 'bridge'
    var onuMode = 'Routing';
    if (req.body.onu_mode && (req.body.onu_mode.toLowerCase() === 'bridging' || req.body.onu_mode.toLowerCase() === 'bridge')) onuMode = 'Bridging';
    params.append('onu_mode', onuMode);
    params.append('zone', zonaName || 'default');
    params.append('name', (cliente_nombre || descripcion || serial).replace(/[^a-zA-Z0-9 @$&()\-`.+,/_\:;]/g, '').trim().substring(0, 64) || serial);
    if (vlan) params.append('vlan', vlan);
    else if (olt.vlan_default) params.append('vlan', olt.vlan_default);
    if (board) params.append('board', board);
    if (port) params.append('port', port);
    
    // If ONU was already pre-authorized, delete it first
    try {
      const searchResp = await fetch(apiUrl + '/onu/get_onus_details_by_sn/' + serial, {
        method: 'GET', headers: { 'X-Token': olt.smartolt_api_key, 'Accept': 'application/json' }
      });
      const searchData = await searchResp.json();
      let existingOnuId = null;
      if (searchData.response && Array.isArray(searchData.response) && searchData.response.length > 0) {
        existingOnuId = searchData.response[0].id || searchData.response[0].onu_id || searchData.response[0].external_id || null;
      }
      if (existingOnuId) {
        await fetch(apiUrl + '/onu/delete/' + existingOnuId, {
          method: 'POST', headers: { 'X-Token': olt.smartolt_api_key }
        });
      }
    } catch(e) {}
    
    console.log('[CAMBIO-ONU] Params enviados a SmartOLT:', params.toString());
    console.log('[CAMBIO-ONU-2] Params:', params.toString());
    const response = await fetch(apiUrl + '/onu/authorize_onu', {
      method: 'POST',
      headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    const ct = response.headers.get('content-type') || '';
    let data;
    if (ct.indexOf('json') !== -1) {
      data = await response.json();
    } else {
      const text = await response.text();
      return res.json({ success: false, message: text.substring(0, 300) });
    }
    require('fs').appendFileSync('/tmp/isptotal.log', new Date().toISOString() + ' [CAMBIO-ONU] Auth response: ' + JSON.stringify(data) + '\n');
    console.log('[CAMBIO-ONU] Auth response:', JSON.stringify(data));
    if (data.status === 'success' || data.status === true || data.response_code === 'success') {
      // Wait 15 seconds for ONU to register on OLT before sending config
      
      
      // Get ONU external ID for further configuration
      let extId = '';
      try {
        const extResp = await fetch(apiUrl + '/onu/get_onus_details_by_sn/' + serial, {
          method: 'GET', headers: { 'X-Token': olt.smartolt_api_key, 'Accept': 'application/json' }
        });
        const extData = await extResp.json();
        let onuList = extData.onus || extData.response || [];
        if (onuList.length > 0) {
          extId = onuList[0].unique_external_id || onuList[0].id || onuList[0].onu_id || '';
        }
      } catch(e) {}
      
      // Get service plan info for speed profiles (down/up)
      let planProfiles = null;
      if (servicio_id) {
        planProfiles = db.prepare('SELECT p.perfil_olt_descarga, p.perfil_olt_subida, p.perfil_mikrotik, p.nombre as plan_name FROM servicios s LEFT JOIN planes p ON p.id=s.plan_id WHERE s.id=?').get(servicio_id);
      }
      var dlProfile = (planProfiles && planProfiles.perfil_olt_descarga) ? planProfiles.perfil_olt_descarga : (planProfiles ? (planProfiles.perfil_mikrotik || planProfiles.plan_name || '') : '');
      var ulProfile = (planProfiles && planProfiles.perfil_olt_subida) ? planProfiles.perfil_olt_subida : dlProfile;
      
      if (extId) {
        var logVlan = vlan || olt.vlan_default || '';
        var logTr069Vlan = olt.tr069_vlan || logVlan;
        require('fs').appendFileSync('/tmp/isptotal.log', '[AUTHORIZE-ONU] extId=' + extId + ' speed down=' + dlProfile + ' up=' + ulProfile + ' vlan=' + logVlan + ' tr069Vlan=' + logTr069Vlan + ' tr069=SmartOLT mgmt=DHCP\n');
        // Set speed profiles if available
        if (dlProfile) {
          try {
            const spParams = new URLSearchParams();
            spParams.append('upload_speed_profile_name', ulProfile);
            spParams.append('download_speed_profile_name', dlProfile);
            const spResp = await fetch(apiUrl + '/onu/update_onu_speed_profiles/' + extId, {
              method: 'POST',
              headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' },
              body: spParams
            });
            const spData = await spResp.json();
            require('fs').appendFileSync('/tmp/isptotal.log', '[AUTHORIZE-ONU] SpeedProfile=' + JSON.stringify(spData) + '\n');
          } catch(e) { console.log('[AUTHORIZE-ONU] Speed profile error:', e.message); }
        }
        
                console.log('[AUTHORIZE-ONU] Enabling TR069 with profile SmartOLT...');
        // Set Mgmt IP mode to DHCP with VLAN
        try {
          const mgmtParams = new URLSearchParams();
          // Use TR069 VLAN for Mgmt IP, fallback to service vlan or default
          const mgmtVlan = olt.tr069_vlan || vlan || olt.vlan_default || '';
          if (mgmtVlan) mgmtParams.append('vlan', mgmtVlan);
          const mgmtResp = await fetch(apiUrl + '/onu/set_onu_mgmt_ip_dhcp/' + extId, {
            method: 'POST',
            headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: mgmtParams
          });
          const mgmtData = await mgmtResp.json();
          require('fs').appendFileSync('/tmp/isptotal.log', '[AUTHORIZE-ONU] MgmtIP=' + JSON.stringify(mgmtData) + '\n');
        } catch(e) { console.log('[AUTHORIZE-ONU] Mgmt IP error:', e.message); }
      }
      
      
        // Enable TR069 with SmartOLT profile
        try {
          const tr069Params = new URLSearchParams();
          tr069Params.append('tr069_profile', olt.tr069_profile || 'SmartOLT');
          const trResp = await fetch(apiUrl + '/onu/enable_tr069/' + extId, {
            method: 'POST',
            headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: tr069Params
          });
          const trData = await trResp.json();
          require('fs').appendFileSync('/tmp/isptotal.log', '[AUTHORIZE-ONU] TR069=' + JSON.stringify(trData) + '\n');
        } catch(e) { console.log('[AUTHORIZE-ONU] TR069 error:', e.message); }
        
        console.log('[AUTHORIZE-ONU] Setting Mgmt IP to DHCP with vlan=' + (vlan || olt.vlan_default || ''));
        
        // Read service WAN data from DB (like TR069 does)
        if (servicio_id) {
          var wanSvc = db.prepare('SELECT pppoe_user, pppoe_pass, auth_type, wifi_ssid, wifi_pass FROM servicios WHERE id=?').get(servicio_id);
          if (wanSvc) {
            if (wanSvc.auth_type) req.body.auth_type = wanSvc.auth_type;
            if (wanSvc.pppoe_user) req.body.pppoe_user = wanSvc.pppoe_user;
            if (wanSvc.pppoe_pass) req.body.pppoe_pass = wanSvc.pppoe_pass;
          }
        }
        // Set WAN mode based on auth_type
        try {
          var wanType = req.body.auth_type || 'dhcp';
          require('fs').appendFileSync('/tmp/isptotal.log', '[AUTHORIZE-ONU] Setting WAN mode=' + wanType + ' user=' + (req.body.pppoe_user || 'Joel') + '\\n');
          if (wanType === 'pppoe') {
            var ppParams = new URLSearchParams();
            ppParams.append('username', req.body.pppoe_user || 'Joel');
            ppParams.append('password', req.body.pppoe_pass || '1320');
            ppParams.append('configuration_method', 'TR069');
            ppParams.append('ip_protocol', 'ipv4ipv6');
            var ppResp = await fetch(apiUrl + '/onu/set_onu_wan_mode_pppoe/' + extId, {
              method: 'POST', headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: ppParams
            });
            var ppData = await ppResp.json();
            require('fs').appendFileSync('/tmp/isptotal.log', '[AUTHORIZE-ONU] WAN PPPoE=' + JSON.stringify(ppData) + '\\n');
          } else {
            var dhcpWanParams = new URLSearchParams();
            dhcpWanParams.append('configuration_method', 'OMCI');
            dhcpWanParams.append('ip_protocol', 'ipv4ipv6');
            var dhcpWanResp = await fetch(apiUrl + '/onu/set_onu_wan_mode_dhcp/' + extId, {
              method: 'POST', headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: dhcpWanParams
            });
            var dhcpWanData = await dhcpWanResp.json();
            require('fs').appendFileSync('/tmp/isptotal.log', '[AUTHORIZE-ONU] WAN DHCP=' + JSON.stringify(dhcpWanData) + '\\n');
          }
        } catch(e) { require('fs').appendFileSync('/tmp/isptotal.log', '[AUTHORIZE-ONU] WAN error:' + e.message + '\\n'); }
        
        // Set WiFi if service has SSID configured
        if (extId && servicio_id) {
          try {
            var wifiSvc = db.prepare('SELECT wifi_ssid, wifi_pass FROM servicios WHERE id=?').get(servicio_id);
            if (wifiSvc && wifiSvc.wifi_ssid) {
              var wifiParams = new URLSearchParams();
              wifiParams.append('wifi_port', 'wifi_0/1');
              wifiParams.append('ssid', wifiSvc.wifi_ssid);
              wifiParams.append('password', wifiSvc.wifi_pass || '');
              wifiParams.append('authentication_mode', 'WPA2');
              await fetch(apiUrl + '/onu/set_wifi_port_lan/' + extId, {
                method: 'POST', headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: wifiParams
              });
            }
          } catch(eW) { console.log('[AUTHORIZE-ONU] WiFi error:', eW.message); }
        }
        
        // Save config to OLT
      try {
        console.log('[AUTHORIZE-ONU] Saving config to OLT...');
        const saveResp = await fetch(apiUrl + '/system/save_config', { method: 'POST', headers: { 'X-Token': olt.smartolt_api_key } });
        const saveData = await saveResp.json();
        require('fs').appendFileSync('/tmp/isptotal.log', '[AUTHORIZE-ONU] SaveConfig=' + JSON.stringify(saveData) + '\n');
      } catch(e) { console.log('[AUTHORIZE-ONU] save_config error:', e.message); }
      
      // Link ONU to service
      if (servicio_id && serial) {
        try {
          var clId = null;
          if (servicio_id) {
            var svc2 = db.prepare('SELECT cliente_id FROM servicios WHERE id=?').get(servicio_id);
            if (svc2) clId = svc2.cliente_id;
          }
          db.prepare('INSERT INTO onu (sn, nombre, cliente_id, olt_id, servicio_id, estado) VALUES (?,?,?,?,?,\'activo\') ON CONFLICT(sn) DO UPDATE SET cliente_id=COALESCE(excluded.cliente_id,onu.cliente_id), servicio_id=COALESCE(excluded.servicio_id,onu.servicio_id), olt_id=COALESCE(excluded.olt_id,onu.olt_id)')
            .run(serial, cliente_nombre || descripcion || serial, clId, olt_id, servicio_id);
          require('fs').appendFileSync('/tmp/isptotal.log', '[AUTHORIZE-ONU] ONU vinculada a servicio #' + servicio_id + '\n');
        } catch(e2) { require('fs').appendFileSync('/tmp/isptotal.log', '[AUTHORIZE-ONU] Error vinculando ONU: ' + e2.message + '\n'); }
      }
      
      return res.json({ success: true, message: 'ONU autorizada y configurada exitosamente' });
    }
    require('fs').appendFileSync('/tmp/isptotal.log', new Date().toISOString() + ' [CAMBIO-ONU] Auth FAILED: ' + JSON.stringify(data) + '\n');
    return res.json({ success: false, message: data.msg || data.message || data.error || 'Error al autorizar ONU' });
  } catch(e) {
    return res.json({ success: false, message: e.message });
  }
});

// POST /api/smartolt/onu/scan - Scan unconfigured ONUs from specific SmartOLT
app.post('/api/smartolt/onu/scan', requireAuth, async (req, res) => {
  const { olt_id } = req.body;
  const olt = db.prepare('SELECT * FROM olts WHERE id=?').get(olt_id);
  if (!olt || !olt.smartolt_subdomain || !olt.smartolt_api_key) {
    return res.json({ success: false, message: 'OLT no configurada para SmartOLT' });
  }
  try {
    const apiUrl = 'https://' + olt.smartolt_subdomain + '.smartolt.com/api';
    const headers = { 'X-Token': olt.smartolt_api_key, 'Accept': 'application/json' };
    const response = await fetch(apiUrl + '/onu/unconfigured_onus', { method: 'GET', headers: headers });
    const ct = response.headers.get('content-type') || '';
    if (ct.indexOf('json') === -1) return res.json({ success: false, message: 'Respuesta no JSON' });
    const data = await response.json();
    let onus = [];
    if (data.response && Array.isArray(data.response)) onus = data.response;
    else if (data.data && Array.isArray(data.data)) onus = data.data;
    else if (Array.isArray(data)) onus = data;
    return res.json({ success: true, onus: onus, olt_name: olt.nombre });
  } catch (e) { return res.json({ success: false, message: e.message }); }
});

// POST /api/smartolt/onu/detalle - Get ONU details from SmartOLT
app.post('/api/smartolt/onu/detalle', requireAuth, async (req, res) => {
  const { sn, olt_id } = req.body;
  if (!sn || !olt_id) return res.json({ success: false, message: 'SN y OLT requeridos' });
  const olt = db.prepare('SELECT * FROM olts WHERE id=? AND activo=1').get(olt_id);
  if (!olt || !olt.smartolt_subdomain || !olt.smartolt_api_key) {
    return res.json({ success: false, message: 'OLT no configurada' });
  }
  try {
    const apiUrl = 'https://' + olt.smartolt_subdomain + '.smartolt.com/api';
    const headers = { 'X-Token': olt.smartolt_api_key, 'Accept': 'application/json' };
    const resp = await fetch(apiUrl + '/onu/get_onus_details_by_sn/' + sn, { method: 'GET', headers: headers });
    const data = await resp.json();
    let onuData = data.response;
    if (!onuData && data.onus) onuData = data.onus;
    if (onuData && onuData.length > 0) {
      // Get full status info
      const extId = onuData[0].unique_external_id || onuData[0].id || onuData[0].onu_id || onuData[0].external_id || '';
      if (extId) {
        try {
          const stResp = await fetch(apiUrl + '/onu/get_onu_full_status_info/' + extId, { method: 'GET', headers: headers });
          const stData = await stResp.json();
          if (stData.status && stData.response) {
            Object.assign(onuData[0], stData.response);
          }
        } catch(e) {}
      }
      return res.json({ success: true, data: onuData[0] });
    }
    return res.json({ success: false, message: 'ONU no encontrada en SmartOLT' });
  } catch(e) {
    return res.json({ success: false, message: e.message });
  }
});

// POST /api/smartolt/onu/accion - Execute action on ONU
app.post('/api/smartolt/onu/accion', requireAuth, async (req, res) => {
  const { sn, olt_id, action } = req.body;
  if (!sn || !olt_id || !action) return res.json({ success: false, message: 'SN, OLT y acción requeridos' });
  
  // Actions that map directly: enable, disable, reboot, delete, resync
  const endpoints = {
    enable: '/onu/enable/',
    disable: '/onu/disable/',
    reboot: '/onu/reboot/',
    delete: '/onu/delete/',
    resync: '/onu/resync_config/'
  };
  const ep = endpoints[action];
  if (!ep) return res.json({ success: false, message: 'Acción no válida: ' + action });
  
  const olt = db.prepare('SELECT * FROM olts WHERE id=? AND activo=1').get(olt_id);
  if (!olt || !olt.smartolt_subdomain || !olt.smartolt_api_key) {
    return res.json({ success: false, message: 'OLT no configurada' });
  }
  
  try {
    const apiUrl = 'https://' + olt.smartolt_subdomain + '.smartolt.com/api';
    const headers = { 'X-Token': olt.smartolt_api_key, 'Accept': 'application/json' };
    
    // First get the ONU external ID by SN
    const detResp = await fetch(apiUrl + '/onu/get_onus_details_by_sn/' + sn, { method: 'GET', headers: headers });
    const detData = await detResp.json();
    if (!detData.response || !Array.isArray(detData.response) || detData.response.length === 0) {
      return res.json({ success: false, message: 'ONU no encontrada en SmartOLT' });
    }
    const extId = detData.response[0].id || detData.response[0].onu_id || detData.response[0].external_id || '';
    if (!extId) return res.json({ success: false, message: 'No se pudo obtener el ID externo de la ONU' });
    
    const resp = await fetch(apiUrl + ep + extId, { method: 'POST', headers: { 'X-Token': olt.smartolt_api_key } });
    const ct = resp.headers.get('content-type') || '';
    if (ct.indexOf('json') !== -1) {
      const data = await resp.json();
      if (data.status === true || data.status === 'success') {
        return res.json({ success: true, message: 'Acción ejecutada exitosamente' });
      }
      return res.json({ success: false, message: data.error || data.message || 'Error en SmartOLT' });
    }
    const text = await resp.text();
    if (resp.ok) return res.json({ success: true, message: 'Acción ejecutada' });
    return res.json({ success: false, message: text.substring(0, 200) });
  } catch(e) {
    return res.json({ success: false, message: e.message });
  }
});

// POST /api/smartolt/onu/enviar-tr069 - Send TR069 config to ONU from service
app.post('/api/smartolt/onu/enviar-tr069', requireAuth, async (req, res) => {
  const { servicio_id } = req.body;
  if (!servicio_id) return res.json({ success: false, message: 'Servicio requerido' });
  require('fs').appendFileSync('/tmp/isptotal.log', '\n[TR069-BTN] iniciando para servicio #' + servicio_id + '\n');
  
  try {
    // Get service info
    const svc = db.prepare('SELECT s.*, c.nombre as cliente_nombre FROM servicios s LEFT JOIN clientes c ON c.id=s.cliente_id WHERE s.id=?').get(servicio_id);
    if (!svc) return res.json({ success: false, message: 'Servicio no encontrado' });
    
    // Find ONU associated with this service
    // First try by servicio_id or cliente_id in the local onu table
    var onu = db.prepare('SELECT * FROM onu WHERE servicio_id=? OR cliente_id=? ORDER BY id DESC LIMIT 1').get(servicio_id, svc.cliente_id);
    
    // If not found in local table, try looking up by IP address from the service
    if (!onu && svc.ip) {
      onu = db.prepare('SELECT * FROM onu WHERE sn LIKE ? OR nombre LIKE ? ORDER BY id DESC LIMIT 1').get('%' + svc.ip.replace(/\./g,'_') + '%', '%' + svc.ip + '%');
    }
    
    // If still not found, try to get it from SmartOLT directly
    if (!onu || !onu.sn) {
      // Look up all OLTs to find any ONU that might be associated
      require('fs').appendFileSync('/tmp/isptotal.log', '[TR069-BTN] ONU no encontrada localmente. Buscando IP=' + (svc.ip||'') + ' cliente=' + (svc.cliente_id||'') + '\n');
      return res.json({ success: false, message: 'No se encontró ONU asociada a este servicio' });
    }
    
    // Find which OLT this ONU belongs to
    var oltId = onu.olt_id;
    if (!oltId) return res.json({ success: false, message: 'ONU sin OLT asociada' });
    
    const olt = db.prepare('SELECT * FROM olts WHERE id=? AND activo=1').get(oltId);
    if (!olt || !olt.smartolt_subdomain || !olt.smartolt_api_key) return res.json({ success: false, message: 'OLT no configurada para SmartOLT' });
    
    const apiUrl = 'https://' + olt.smartolt_subdomain + '.smartolt.com/api';
    const sn = onu.sn;
    require('fs').appendFileSync('/tmp/isptotal.log', '[TR069-BTN] ONU sn=' + sn + ' olt=' + olt.nombre + ' (' + olt.smartolt_subdomain + ')\n');
    
    // Get ONU external ID by SN
    const detResp = await fetch(apiUrl + '/onu/get_onus_details_by_sn/' + sn, {
      method: 'GET', headers: { 'X-Token': olt.smartolt_api_key, 'Accept': 'application/json' }
    });
    const detData = await detResp.json();
    let onuList = detData.onus || detData.response || [];
    if (!onuList.length) return res.json({ success: false, message: 'ONU no encontrada en SmartOLT' });
    const extId = onuList[0].unique_external_id || onuList[0].id || onuList[0].onu_id || '';
    if (!extId) return res.json({ success: false, message: 'No se pudo obtener ID externo de la ONU' });
    
    require('fs').appendFileSync('/tmp/isptotal.log', '[TR069-BTN] extId=' + extId + '\n');
    
    // Look up plan profiles for speed
    var planProfile = db.prepare('SELECT perfil_olt_descarga, perfil_olt_subida, perfil_mikrotik FROM planes WHERE id=?').get(svc.plan_id);
    if (planProfile && (planProfile.perfil_olt_descarga || planProfile.perfil_olt_subida)) {
      require('fs').appendFileSync('/tmp/isptotal.log', '[TR069-BTN] Estableciendo perfiles de velocidad: down=' + (planProfile.perfil_olt_descarga||'-') + ' up=' + (planProfile.perfil_olt_subida||'-') + '\n');
      try {
        var spParams = new URLSearchParams();
        spParams.append('upload_speed_profile_name', planProfile.perfil_olt_subida || planProfile.perfil_mikrotik || '');
        spParams.append('download_speed_profile_name', planProfile.perfil_olt_descarga || planProfile.perfil_mikrotik || '');
        var spResp = await fetch(apiUrl + '/onu/update_onu_speed_profiles/' + extId, {
          method: 'POST', headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: spParams
        });
        var spData = await spResp.json();
        require('fs').appendFileSync('/tmp/isptotal.log', '[TR069-BTN] SpeedProfile=' + JSON.stringify(spData) + '\n');
      } catch(eSp) { require('fs').appendFileSync('/tmp/isptotal.log', '[TR069-BTN] SpeedError=' + eSp.message + '\n'); }
    }

    // Enable TR069 first (needed for TR069 WAN mode)
    require('fs').appendFileSync('/tmp/isptotal.log', '[TR069-BTN] Habilitando TR069...\n');
    try {
      var tr069Params = new URLSearchParams();
      tr069Params.append('tr069_profile', olt.tr069_profile || 'SmartOLT');
      var trResp = await fetch(apiUrl + '/onu/enable_tr069/' + extId, {
        method: 'POST', headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: tr069Params
      });
      var trData = await trResp.json();
      require('fs').appendFileSync('/tmp/isptotal.log', '[TR069-BTN] TR069 enable response: ' + JSON.stringify(trData) + '\n');
    } catch(eTr) { require('fs').appendFileSync('/tmp/isptotal.log', '[TR069-BTN] TR069 enable error: ' + eTr.message + '\n'); }
    
    // Set Mgmt IP to DHCP (needed for TR069)
    try {
      var mgmtParams = new URLSearchParams();
      var mgmtVlan = olt.tr069_vlan || '';
      if (mgmtVlan) mgmtParams.append('vlan', mgmtVlan);
      var mgmtResp = await fetch(apiUrl + '/onu/set_onu_mgmt_ip_dhcp/' + extId, {
        method: 'POST', headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: mgmtParams
      });
      var mgmtData = await mgmtResp.json();
      require('fs').appendFileSync('/tmp/isptotal.log', '[TR069-BTN] MgmtIP response: ' + JSON.stringify(mgmtData) + '\n');
    } catch(eM) { require('fs').appendFileSync('/tmp/isptotal.log', '[TR069-BTN] MgmtIP error: ' + eM.message + '\n'); }

    // Send WAN PPPoE
    require('fs').appendFileSync('/tmp/isptotal.log', '[TR069-BTN] Enviando WAN PPPoE usuario=' + (svc.pppoe_user || 'Joel') + '\n');
    try {
      var ppParams = new URLSearchParams();
      ppParams.append('username', svc.pppoe_user || 'Joel');
      ppParams.append('password', svc.pppoe_pass || '1320');
      ppParams.append('configuration_method', 'TR069');
      ppParams.append('ip_protocol', 'ipv4ipv6');
      var ppResp = await fetch(apiUrl + '/onu/set_onu_wan_mode_pppoe/' + extId, {
        method: 'POST', headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: ppParams
      });
      var ppData = await ppResp.json();
      require('fs').appendFileSync('/tmp/isptotal.log', '[TR069-BTN] WAN PPPoE=' + JSON.stringify(ppData) + '\n');
      
      // Set WiFi if service has SSID configured
      require('fs').appendFileSync('/tmp/isptotal.log', '[TR069-BTN] WiFi svc.wifi_ssid="' + (svc.wifi_ssid||'') + '"\n');
      if (svc.wifi_ssid) {
        try {
          var wifiParams = new URLSearchParams();
          wifiParams.append('wifi_port', 'wifi_0/1');
          wifiParams.append('ssid', svc.wifi_ssid);
          wifiParams.append('password', svc.wifi_pass || '');
          wifiParams.append('authentication_mode', 'WPA2');
          var wifiResp = await fetch(apiUrl + '/onu/set_wifi_port_lan/' + extId, {
            method: 'POST', headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: wifiParams
          });
          var wifiData = await wifiResp.json();
          require('fs').appendFileSync('/tmp/isptotal.log', '[TR069-BTN] WiFi=' + JSON.stringify(wifiData) + '\n');
        } catch(eW) { require('fs').appendFileSync('/tmp/isptotal.log', '[TR069-BTN] WiFiError=' + eW.message + '\n'); }
      }
      
      // Save config
      require('fs').appendFileSync('/tmp/isptotal.log', '[TR069-BTN] Guardando config...\n');
      try {
        var saveR = await fetch(apiUrl + '/system/save_config', { method: 'POST', headers: { 'X-Token': olt.smartolt_api_key } });
        var saveD = await saveR.json();
        require('fs').appendFileSync('/tmp/isptotal.log', '[TR069-BTN] SaveConfig=' + JSON.stringify(saveD) + '\n');
      } catch(e2) { require('fs').appendFileSync('/tmp/isptotal.log', '[TR069-BTN] SaveError=' + e2.message + '\n'); }
      
      res.json({ success: true, message: 'WAN PPPoE configurado' });
    } catch(e) {
      require('fs').appendFileSync('/tmp/isptotal.log', '[TR069-BTN] Error=' + e.message + '\n');
      res.json({ success: false, message: e.message });
    }
  } catch(e) {
    require('fs').appendFileSync('/tmp/isptotal.log', '[TR069-BTN] ERROR GLOBAL: ' + e.message + '\n');
    res.json({ success: false, message: e.message });
  }
});

// POST /api/smartolt/onu/wifi - Update ONU WiFi settings
app.post('/api/smartolt/onu/wifi', requireAuth, async (req, res) => {
  const { sn, olt_id, wifi_port, wifi_ssid, wifi_pass } = req.body;
  if (!sn || !olt_id || !wifi_port) return res.json({ success: false, message: 'SN, OLT y puerto WiFi requeridos' });
  if (!wifi_ssid) return res.json({ success: false, message: 'SSID requerido' });
  if (!wifi_pass) return res.json({ success: false, message: 'Contraseña requerida' });
  const olt = db.prepare('SELECT * FROM olts WHERE id=? AND activo=1').get(olt_id);
  if (!olt || !olt.smartolt_subdomain || !olt.smartolt_api_key) return res.json({ success: false, message: 'OLT no configurada' });
  try {
    const apiUrl = 'https://' + olt.smartolt_subdomain + '.smartolt.com/api';
    const headers = { 'X-Token': olt.smartolt_api_key, 'Accept': 'application/json' };
    
    // Get ONU external ID by SN
    const detResp = await fetch(apiUrl + '/onu/get_onus_details_by_sn/' + sn, { method: 'GET', headers: headers });
    const detData = await detResp.json();
    let onuList = detData.onus || detData.response || [];
    if (!onuList.length) return res.json({ success: false, message: 'ONU no encontrada en SmartOLT' });
    const extId = onuList[0].unique_external_id || onuList[0].id || onuList[0].onu_id || '';
    if (!extId) return res.json({ success: false, message: 'No se pudo obtener el ID de la ONU' });
    
    // Call SmartOLT to set WiFi on the ONU (using set_wifi_port_lan which accepts ssid)
    const params = new URLSearchParams();
    params.append('wifi_port', wifi_port);
    params.append('ssid', wifi_ssid);
    params.append('password', wifi_pass);
    params.append('authentication_mode', 'WPA2');
    
    const resp = await fetch(apiUrl + '/onu/set_wifi_port_lan/' + extId, {
      method: 'POST',
      headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    
    const ct = resp.headers.get('content-type') || '';
    if (ct.indexOf('json') !== -1) {
      const data = await resp.json();
      if (data.status === true || data.status === 'success' || data.response_code === 'success') {
        return res.json({ success: true, message: 'WiFi actualizado exitosamente' });
      }
      return res.json({ success: false, message: data.error || data.message || 'Error al actualizar WiFi' });
    }
    const text = await resp.text();
    if (resp.ok) return res.json({ success: true, message: 'WiFi actualizado' });
    return res.json({ success: false, message: text.substring(0, 200) });
  } catch(e) {
    return res.json({ success: false, message: e.message });
  }
});

// GET /api/smartolt/onu/trafico - Proxy traffic graph image from SmartOLT
app.get('/api/smartolt/onu/trafico', requireAuth, async (req, res) => {
  const sn = req.query.sn || '';
  const oltId = parseInt(req.query.olt_id) || 0;
  const graphType = req.query.graph_type || 'daily';
  if (!sn || !oltId) return res.status(400).send('SN y OLT requeridos');
  const olt = db.prepare('SELECT * FROM olts WHERE id=? AND activo=1').get(oltId);
  if (!olt || !olt.smartolt_subdomain || !olt.smartolt_api_key) return res.status(400).send('OLT no configurada');
  try {
    const apiUrl = 'https://' + olt.smartolt_subdomain + '.smartolt.com/api';
    const detResp = await fetch(apiUrl + '/onu/get_onus_details_by_sn/' + sn, {
      method: 'GET',
      headers: { 'X-Token': olt.smartolt_api_key, 'Accept': 'application/json' }
    });
    const detData = await detResp.json();
    let onuList = detData.onus || detData.response || [];
    if (!onuList.length) return res.status(404).send('ONU no encontrada');
    const extId = onuList[0].unique_external_id || onuList[0].id || onuList[0].onu_id || '';
    if (!extId) return res.status(404).send('ID externo no encontrado');
    const imgResp = await fetch(apiUrl + '/onu/get_onu_traffic_graph/' + extId + '/' + graphType, {
      method: 'GET',
      headers: { 'X-Token': olt.smartolt_api_key }
    });
    const ct = imgResp.headers.get('content-type') || 'image/png';
    const buf = Buffer.from(await imgResp.arrayBuffer());
    res.set('Content-Type', ct);
    res.set('Cache-Control', 'no-cache');
    res.send(buf);
  } catch(e) {
    res.status(500).send(e.message);
  }
});


// POST /api/smartolt/onu/reset-y-eliminar - Reset ONU to factory and delete from SmartOLT
app.post('/api/smartolt/onu/reset-y-eliminar', requireAuth, async (req, res) => {
  const { servicio_id } = req.body;
  if (!servicio_id) return res.json({ success: false, message: 'Servicio requerido' });
  
  try {
    // Find ONU linked to this service
    var onu = db.prepare('SELECT o.*, ol.smartolt_subdomain, ol.smartolt_api_key FROM onu o LEFT JOIN olts ol ON ol.id=o.olt_id WHERE o.servicio_id=? AND o.sn IS NOT NULL').get(servicio_id);
    if (!onu || !onu.sn) return res.json({ success: false, message: 'No se encontró ONU asociada a este servicio' });
    if (!onu.smartolt_subdomain || !onu.smartolt_api_key) return res.json({ success: false, message: 'OLT no configurada para SmartOLT' });
    
    const apiUrl = 'https://' + onu.smartolt_subdomain + '.smartolt.com/api';
    
    // Step 1: Find the ONU in SmartOLT to get external ID
    const detResp = await fetch(apiUrl + '/onu/get_onus_details_by_sn/' + onu.sn, {
      method: 'GET', headers: { 'X-Token': onu.smartolt_api_key, 'Accept': 'application/json' }
    });
    const detData = await detResp.json();
    let onuList = detData.onus || detData.response || [];
    
    if (onuList.length > 0) {
      var extId = onuList[0].unique_external_id || onuList[0].id || onuList[0].onu_id || '';
      
      // Step 2: Reset ONU to factory defaults via SmartOLT
      if (extId) {
        try {
          await fetch(apiUrl + '/onu/factory_reset/' + extId, { method: 'POST', headers: { 'X-Token': onu.smartolt_api_key } });
        } catch(e) {}
        
        // Step 3: Delete ONU from SmartOLT
        await fetch(apiUrl + '/onu/delete/' + extId, { method: 'POST', headers: { 'X-Token': onu.smartolt_api_key } });
      }
    }
    
    // Step 4: Save config
    try {
      await fetch(apiUrl + '/system/save_config', { method: 'POST', headers: { 'X-Token': onu.smartolt_api_key } });
    } catch(e) {}
    
    // Step 5: Delete from local DB
    db.prepare('DELETE FROM onu WHERE id=?').run(onu.id);
    
    res.json({ success: true, message: 'ONU reseteada a fábrica y eliminada de SmartOLT' });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

// ======== TR069 API ========// ======== TR069 API ========
app.get('/api/tr069/olts', requireAuth, (req, res) => {
  const olts = db.prepare("SELECT id, nombre, smartolt_subdomain, smartolt_api_key, vlan_default, tr069_vlan, tr069_profile FROM olts WHERE activo=1").all();
  const result = olts.map(function(olt) {
    return { id: olt.id, name: olt.nombre, subdomain: olt.smartolt_subdomain,
      tr069_vlan: olt.tr069_vlan || '', tr069_profile: olt.tr069_profile || 'SmartOLT',
      vlan_default: olt.vlan_default || '' };
  });
  res.json({ status: 'success', data: result });
});

app.post('/api/tr069/save-config', requireAuth, (req, res) => {
  const { olt_id, tr069_vlan, tr069_profile } = req.body;
  if (!olt_id) return res.json({ status: 'error', msg: 'OLT requerida' });
  db.prepare('UPDATE olts SET tr069_vlan=?, tr069_profile=? WHERE id=?').run(tr069_vlan||'', tr069_profile||'SmartOLT', olt_id);
  res.json({ status: 'success', msg: 'Configuración TR-069 guardada' });
});

app.get('/api/tr069/onu-types', requireAuth, (req, res) => {
  const rows = db.prepare("SELECT key, value FROM configuracion WHERE key LIKE 'onu_type_%' ORDER BY key").all();
  const types = [];
  rows.forEach(function(r) { try { types.push(JSON.parse(r.value)); } catch(e) {} });
  const olts = db.prepare("SELECT id, nombre FROM olts WHERE activo=1").all();
  res.json({ status: 'success', data: types, olts: olts });
});

app.post('/api/tr069/save-onu-config', requireAuth, (req, res) => {
  const { onu_type_id, tr069_enabled, tr069_olt_id, tr069_wan_mode, tr069_send_wifi } = req.body;
  if (!onu_type_id) return res.json({ status: 'error', msg: 'Tipo de ONU requerido' });
  const row = db.prepare("SELECT value FROM configuracion WHERE key='onu_type_' || ?").get(onu_type_id);
  if (!row) return res.json({ status: 'error', msg: 'Tipo de ONU no encontrado' });
  try {
    var data = JSON.parse(row.value);
    data.tr069_enabled = tr069_enabled ? 1 : 0;
    data.tr069_olt_id = tr069_olt_id || '0';
    data.tr069_wan_mode = tr069_wan_mode || 'off';
    data.tr069_send_wifi = tr069_send_wifi ? 1 : 0;
    db.prepare("UPDATE configuracion SET value=? WHERE key='onu_type_' || ?").run(JSON.stringify(data), onu_type_id);
    res.json({ status: 'success', msg: 'Configuración de ONU guardada' });
  } catch(e) { res.json({ status: 'error', msg: e.message }); }
});

// ======== CAMBIO DE TITULAR API ========
app.post('/api/cambio-titular/buscar', requireAuth, (req, res) => {
  const q = (req.body.term || '').trim();
  if (q.length < 2) return res.json([]);
  const clientes = db.prepare("SELECT id, nombre, cedula, telefono, apodo FROM clientes WHERE nombre LIKE ? OR cedula LIKE ? OR telefono LIKE ? LIMIT 10").all('%' + q + '%', '%' + q + '%', '%' + q + '%');
  // Attach services to each client
  const stmt = db.prepare("SELECT s.id as service_id, s.estado as svc_status, s.ip as ip_address, p.nombre as plan_name, p.precio as plan_price, z.nombre as zone_name, s.pppoe_user FROM servicios s LEFT JOIN planes p ON p.id=s.plan_id LEFT JOIN zonas z ON z.id=s.zona_id WHERE s.cliente_id=?");
  for (var i = 0; i < clientes.length; i++) {
    clientes[i].services = stmt.all(clientes[i].id);
    // Format services to match DomISP structure
    for (var j = 0; j < clientes[i].services.length; j++) {
      clientes[i].services[j].nic = 'SVC-' + clientes[i].services[j].service_id;
      clientes[i].services[j].svc_address = '';
      clientes[i].services[j].plan_price = String(parseFloat(clientes[i].services[j].plan_price || 0));
    }
  }
  // DomISP format: {id, name, alias, cedula, phone, services: [{service_id, nic, svc_status, svc_address, ip_address, plan_name, plan_price, zone_name}]}
  const result = clientes.map(function(c) {
    return { id: c.id, name: c.nombre, alias: c.apodo || '', cedula: c.cedula || '', phone: c.telefono || '', services: c.services };
  });
  res.json(result);
});



app.post('/api/cambio-titular/verificar-cedula', requireAuth, (req, res) => {
  const { cedula } = req.body;
  if (!cedula) return res.json({ exists: false });
  const existing = db.prepare("SELECT id, nombre, apodo as alias, telefono as phone FROM clientes WHERE cedula=?").get(cedula);
  if (existing) return res.json({ exists: true, id: existing.id, name: existing.nombre, alias: existing.alias || '', phone: existing.phone || '' });
  res.json({ exists: false });
});

app.get('/api/cambio-titular/nuevo-cliente', requireAuth, (req, res) => {
  // Get default next ID
  const last = db.prepare('SELECT MAX(id) as max FROM clientes').get();
  res.json({ next_id: (last && last.max) ? last.max + 1 : 1 });
});

app.post('/api/cambio-titular/transferir', requireAuth, (req, res) => {
  var serviceIds = req.body.service_ids;
  if (typeof serviceIds === 'string') serviceIds = JSON.parse(serviceIds);
  var oldClientId = parseInt(req.body.old_client_id) || 0;
  var cedula = req.body.cedula || '';
  var nombre = (req.body.nombre || '').trim();
  var alias = req.body.alias || '';
  var phone = req.body.phone || '';
  var existingClientId = parseInt(req.body.existing_client_id) || 0;

  if (!serviceIds || serviceIds.length === 0) return res.json({ status: 'error', msg: 'Seleccione al menos un servicio' });
  if (!nombre) return res.json({ status: 'error', msg: 'Nombre del nuevo titular requerido' });

  try {
    var oldClient = db.prepare('SELECT nombre FROM clientes WHERE id=?').get(oldClientId);
    var oldName = oldClient ? oldClient.nombre : 'desconocido';

    // Find or create new client
    var newClientId = existingClientId;
    if (!newClientId) {
      var r = db.prepare('INSERT INTO clientes (nombre, cedula, telefono, apodo) VALUES (?,?,?,?)').run(nombre.toUpperCase(), cedula, phone, alias);
      newClientId = r.lastInsertRowid;
    }

    // Transfer services
    var txn = db.transaction(function() {
      for (var i = 0; i < serviceIds.length; i++) {
        db.prepare('UPDATE servicios SET cliente_id=? WHERE id=?').run(newClientId, serviceIds[i]);
      }
      // Also transfer facturas if the table exists
      try { db.prepare('UPDATE facturas SET cliente_id=? WHERE servicio_id IN (' + serviceIds.map(function() { return '?'; }).join(',') + ')').run(newClientId, ...serviceIds); } catch(e) {}
    });
    txn();

    res.json({ status: 'success', msg: serviceIds.length + ' servicio(s) transferido(s) de \"' + oldName + '\" a \"' + nombre.toUpperCase() + '\"', new_client_id: String(newClientId) });
  } catch(e) {
    res.json({ status: 'error', msg: e.message });
  }
});

// ======== TRASLADOS API ========
app.get('/api/traslados/buscar-cliente', requireAuth, (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const clientes = db.prepare("SELECT id, nombre, cedula, telefono, apodo FROM clientes WHERE nombre LIKE ? OR cedula LIKE ? OR telefono LIKE ? LIMIT 10").all('%' + q + '%', '%' + q + '%', '%' + q + '%');
  const result = clientes.map(function(c) {
    // Count services and get NICs
    var svcs = db.prepare("SELECT id, pppoe_user FROM servicios WHERE cliente_id=? AND estado IN ('activo','suspendido')").all(c.id);
    var nics = svcs.map(function(s) { return 'SVC-' + s.id; }).join(', ');
    return { id: c.id, name: c.nombre, cedula: c.cedula || '', phone: c.telefono || '', alias: c.apodo || '', service_count: svcs.length, nics: nics || '' };
  });
  res.json(result);
});

app.get('/api/traslados/servicios/:cliente_id', requireAuth, (req, res) => {
  const servicios = db.prepare("SELECT s.id, s.estado as status, s.ip as ip_address, s.direccion as address, p.nombre as plan_name, z.nombre as zona_nombre, z.id as zona_id FROM servicios s LEFT JOIN planes p ON p.id=s.plan_id LEFT JOIN zonas z ON z.id=s.zona_id WHERE s.cliente_id=? AND s.estado IN ('activo','suspendido')").all(req.params.cliente_id);
  // Format for DomISP-like response
  for (var i = 0; i < servicios.length; i++) {
    servicios[i].nic = 'SVC-' + servicios[i].id;
    servicios[i].observations = '';
    servicios[i].status = servicios[i].status === 'activo' ? 'active' : 'suspended';
  }
  res.json({ status: 'success', data: servicios });
});

app.post('/api/traslados/guardar', requireAuth, (req, res) => {
  const { client_id, service_id, sector_id, address, observations } = req.body;
  if (!client_id) return res.json({ status: 'error', msg: 'Seleccione un cliente' });
  if (!service_id) return res.json({ status: 'error', msg: 'Seleccione un servicio' });
  if (!sector_id) return res.json({ status: 'error', msg: 'La zona nueva es obligatoria' });
  if (!address) return res.json({ status: 'error', msg: 'La dirección nueva es obligatoria' });
  
  try {
    // Get user info
    var usuarioId = req.session.user ? req.session.user.id : 0;
    
    // Crear orden de traslado
    var detalle = 'Traslado a nueva zona (ID: ' + sector_id + '), dirección: ' + address;
    if (observations) detalle += '. Obs: ' + observations;
    
    var r = db.prepare("INSERT INTO ordenes (tipo, cliente_id, servicio_id, detalle, zona_id, direccion, estado, usuario_id) VALUES ('traslado',?,?,?,?,?,'pendiente',?)").run(client_id, service_id, detalle, sector_id, address, usuarioId);
    
    // Update service address and zona
    if (address) db.prepare("UPDATE servicios SET direccion=? WHERE id=?").run(address, service_id);
    if (sector_id) db.prepare("UPDATE servicios SET zona_id=? WHERE id=?").run(sector_id, service_id);
    
    res.json({ status: 'success', order_id: String(r.lastInsertRowid) });
  } catch(e) {
    res.json({ status: 'error', msg: e.message });
  }
});

// ======== ORDENES API ========
app.get('/api/ordenes/detalle/:id', requireAuth, (req, res) => {
  const o = db.prepare('SELECT o.*, c.nombre as cliente_nombre, c.cedula, c.direccion, e.nombre as tecnico_nombre, z.nombre as zona_nombre FROM ordenes o LEFT JOIN clientes c ON c.id=o.cliente_id LEFT JOIN empleados e ON e.id=o.tecnico_id LEFT JOIN zonas z ON z.id=o.zona_id WHERE o.id=?').get(req.params.id);
  if (!o) return res.json({ status: 'error', msg: 'Orden no encontrada' });
  res.json({ status: 'success', data: o });
});

app.post('/api/ordenes/asignar', requireAuth, (req, res) => {
  const { orden_id, tecnico_id } = req.body;
  if (!orden_id) return res.json({ success: false, message: 'ID de orden requerido' });
  try {
    db.prepare('UPDATE ordenes SET tecnico_id=? WHERE id=?').run(tecnico_id || null, orden_id);
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/ordenes/servicio-info/:id', requireAuth, (req, res) => {
  const svc = db.prepare("SELECT s.id, s.ip, s.pppoe_user, s.pppoe_pass, s.estado, p.nombre as plan_name, o.sn as onu_sn FROM servicios s LEFT JOIN planes p ON p.id=s.plan_id LEFT JOIN onu o ON o.servicio_id=s.id WHERE s.id=?").get(req.params.id);
  if (!svc) return res.json({ status: 'error', msg: 'Servicio no encontrado' });
  res.json({ status: 'success', data: svc });
});

app.post('/api/ordenes/completar-traslado', requireAuth, (req, res) => {
  const { orden_id, tecnico_id, sector_id, direccion, observaciones } = req.body;
  if (!orden_id) return res.json({ status: 'error', msg: 'ID de orden requerido' });
  
  try {
    const orden = db.prepare('SELECT * FROM ordenes WHERE id=?').get(orden_id);
    if (!orden) return res.json({ status: 'error', msg: 'Orden no encontrada' });
    
    // Update service with new zone & address
    if (orden.servicio_id) {
      if (sector_id) db.prepare("UPDATE servicios SET zona_id=? WHERE id=?").run(sector_id, orden.servicio_id);
      if (direccion) db.prepare("UPDATE servicios SET direccion=? WHERE id=?").run(direccion, orden.servicio_id);
    }
    
    // Mark order as completed
    var userId = req.session.user ? req.session.user.id : 0;
    db.prepare("UPDATE ordenes SET estado='completada', tecnico_id=?, direccion=?, detalle=?, fecha_completada=datetime('now'), completada_por=? WHERE id=?")
      .run(tecnico_id || orden.tecnico_id, direccion || orden.direccion, (orden.detalle || '') + (observaciones ? ' | Res: ' + observaciones : ''), userId, orden_id);
    
    res.json({ status: 'success', msg: 'Traslado completado correctamente' });
  } catch(e) {
    res.json({ status: 'error', msg: e.message });
  }
});

// ======== CAMBIO ONU API ========

// GET /api/cambio-onu/buscar-cliente?q=X - search clients with services and ONU info
app.get('/api/cambio-onu/buscar-cliente', requireAuth, (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  try {
    const clientes = db.prepare("SELECT id, nombre, cedula, telefono, apodo, direccion FROM clientes WHERE nombre LIKE ? OR cedula LIKE ? OR telefono LIKE ? LIMIT 15").all('%' + q + '%', '%' + q + '%', '%' + q + '%');
    // Attach services with ONU info
    const svcStmt = db.prepare("SELECT s.id as servicio_id, s.estado, s.ip, s.pppoe_user, s.pppoe_pass, p.nombre as plan_nombre, p.precio, z.nombre as zona_nombre, o.sn as onu_sn, o.id as onu_id, o.olt_id, ol.nombre as olt_nombre FROM servicios s LEFT JOIN planes p ON p.id=s.plan_id LEFT JOIN zonas z ON z.id=s.zona_id LEFT JOIN onu o ON o.servicio_id=s.id LEFT JOIN olts ol ON ol.id=o.olt_id WHERE s.cliente_id=? ORDER BY s.id DESC");
    for (var i = 0; i < clientes.length; i++) {
      clientes[i].servicios = svcStmt.all(clientes[i].id);
    }
    res.json(clientes);
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

// GET /api/cambio-onu/servicios/:cliente_id - get services with ONU SN for a client
app.get('/api/cambio-onu/servicios/:cliente_id', requireAuth, (req, res) => {
  try {
    const servicios = db.prepare("SELECT s.id, s.estado, s.ip, s.pppoe_user, s.pppoe_pass, p.nombre as plan_nombre, z.nombre as zona_nombre, o.sn as onu_sn, o.id as onu_id, o.olt_id, ol.nombre as olt_nombre, c.nombre as cliente_nombre FROM servicios s LEFT JOIN planes p ON p.id=s.plan_id LEFT JOIN zonas z ON z.id=s.zona_id LEFT JOIN onu o ON o.servicio_id=s.id LEFT JOIN olts ol ON ol.id=o.olt_id JOIN clientes c ON c.id=s.cliente_id WHERE s.cliente_id=? ORDER BY s.id DESC").all(req.params.cliente_id);
    res.json({ success: true, data: servicios });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

// GET /api/cambio-onu/zona-info/:zona_id - get zone info + SmartOLT config
app.get('/api/cambio-onu/zona-info/:zona_id', requireAuth, (req, res) => {
  try {
    const zona = db.prepare('SELECT * FROM zonas WHERE id=?').get(req.params.zona_id);
    if (!zona) return res.json({ success: false, message: 'Zona no encontrada' });
    const olts = db.prepare('SELECT id, nombre, smartolt_subdomain, smartolt_api_key, smartolt_olt_id, vlan_default, tr069_vlan FROM olts WHERE activo=1').all();
    res.json({ success: true, data: { zona: zona, olts: olts } });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

// GET /api/cambio-onu/scan-onus?olt_id=X&mode=smartolt - call SmartOLT get_pendings
app.get('/api/cambio-onu/scan-onus', requireAuth, async (req, res) => {
  const oltId = parseInt(req.query.olt_id) || 0;
  if (!oltId) return res.json({ success: false, message: 'OLT requerida' });
  try {
    const olt = db.prepare('SELECT * FROM olts WHERE id=? AND activo=1').get(oltId);
    if (!olt || !olt.smartolt_subdomain || !olt.smartolt_api_key) {
      return res.json({ success: false, message: 'OLT no configurada para SmartOLT' });
    }
    const apiUrl = 'https://' + olt.smartolt_subdomain + '.smartolt.com/api';
    const headers = { 'X-Token': olt.smartolt_api_key, 'Accept': 'application/json' };
    const response = await fetch(apiUrl + '/onu/unconfigured_onus', { method: 'GET', headers: headers });
    const ct = response.headers.get('content-type') || '';
    if (ct.indexOf('json') === -1) return res.json({ success: false, message: 'Respuesta no JSON de SmartOLT' });
    const data = await response.json();
    let onus = [];
    if (data.response && Array.isArray(data.response)) onus = data.response;
    else if (data.data && Array.isArray(data.data)) onus = data.data;
    else if (Array.isArray(data)) onus = data;
    // Filter to only show pendings/unconfigured with SN
    onus = onus.filter(function(o) { return o.sn || o.serial || o.serial_number || o.mac || o.serialNumber; });
    // Normalize field names for frontend
    onus = onus.map(function(o) {
      return {
        sn: o.sn || o.serial || '',
        model: o.onu_type_name || o.model || '',
        onu_type: o.onu_type_name || o.model || '',
        board: o.board || 0,
        port: o.port || 0,
        interface: o.pon_description || (o.board ? o.board + '/' + o.port : ''),
        pon_type: o.pon_type || 'gpon',
        olt_id: o.olt_id || ''
      };
    });
    res.json({ success: true, onus: onus, olt_name: olt.nombre });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

// POST /api/cambio-onu/crear-swap - create swap record
app.post('/api/cambio-onu/crear-swap', requireAuth, (req, res) => {
  try {
    const { cliente_id, servicio_id, old_sn, new_sn, old_olt_id, new_olt_id, pppoe_user, pppoe_pass, wifi_ssid_24, wifi_pass_24, wifi_ssid_5, wifi_pass_5, vlan, onu_type, change_reason, created_by } = req.body;
    const userId = created_by || (req.session.user ? req.session.user.id : 0);
    const r = db.prepare(`INSERT INTO cambio_onu_swaps (cliente_id, servicio_id, old_sn, new_sn, old_olt_id, new_olt_id, pppoe_user, pppoe_pass, wifi_ssid_24, wifi_pass_24, wifi_ssid_5, wifi_pass_5, vlan, onu_type, change_reason, created_by, estado, completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'completado',datetime('now'))`).run(
      cliente_id || null, servicio_id || null, old_sn || '', new_sn || '', old_olt_id || null, new_olt_id || null,
      pppoe_user || '', pppoe_pass || '', wifi_ssid_24 || '', wifi_pass_24 || '', wifi_ssid_5 || '', wifi_pass_5 || '',
      vlan || '', onu_type || '', change_reason || '', userId
    );
    res.json({ success: true, swap_id: r.lastInsertRowid, message: 'Swap registrado exitosamente' });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

// POST /api/cambio-onu/eliminar-onu-vieja - delete old ONU via SmartOLT + update DB
app.post('/api/cambio-onu/eliminar-onu-vieja', requireAuth, async (req, res) => {
  const { sn, olt_id, servicio_id } = req.body;
  if (!sn || !olt_id) return res.json({ success: false, message: 'SN de ONU y OLT requeridos' });
  try {
    const olt = db.prepare('SELECT * FROM olts WHERE id=? AND activo=1').get(olt_id);
    if (!olt || !olt.smartolt_subdomain || !olt.smartolt_api_key) {
      return res.json({ success: false, message: 'OLT no configurada' });
    }
    const apiUrl = 'https://' + olt.smartolt_subdomain + '.smartolt.com/api';
    const headers = { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/json', 'Accept': 'application/json' };
    
    // Get ONU external ID by SN
    const detResp = await fetch(apiUrl + '/onu/get_onus_details_by_sn/' + sn, { method: 'GET', headers: { 'X-Token': olt.smartolt_api_key, 'Accept': 'application/json' } });
    const detData = await detResp.json();
    let onuList = detData.onus || detData.response || [];
    let extId = '';
    if (onuList.length > 0) {
      extId = onuList[0].unique_external_id || onuList[0].id || onuList[0].onu_id || onuList[0].external_id || '';
    }
    
    // Try to delete from SmartOLT
    require('fs').appendFileSync('/tmp/isptotal.log', '[ELIMINAR-ONU] sn=' + sn + ' olt_id=' + olt_id + ' extId=' + extId + '\n');
    if (extId) {
      // Retry delete up to 3 times if OLT is busy
      for (var delTry = 0; delTry < 3; delTry++) {
        try {
          if (delTry > 0) { await new Promise(function(r) { setTimeout(r, 3000); }); }
          var delResp = await fetch(apiUrl + '/onu/delete/' + extId, { method: 'POST', headers: { 'X-Token': olt.smartolt_api_key } });
          var delData = await delResp.json();
          require('fs').appendFileSync('/tmp/isptotal.log', '[ELIMINAR-ONU] SmartOLT delete (attempt ' + (delTry+1) + '): ' + JSON.stringify(delData) + '\n');
          if (delData.status === 'success' || delData.status === true || delData.response_code === 'success') {
            break; // success, no more retries
          }
          if (delTry === 2) {
            require('fs').appendFileSync('/tmp/isptotal.log', '[ELIMINAR-ONU] Delete failed after 3 attempts\n');
          }
        } catch(e2) { require('fs').appendFileSync('/tmp/isptotal.log', '[ELIMINAR-ONU] error SmartOLT: ' + (e2.message||'') + '\n'); }
      }
      // Save config (with retry too)
      for (var svTry = 0; svTry < 3; svTry++) {
        try {
          if (svTry > 0) { await new Promise(function(r) { setTimeout(r, 3000); }); }
          var svResp = await fetch(apiUrl + '/system/save_config', { method: 'POST', headers: { 'X-Token': olt.smartolt_api_key } });
          var svData = await svResp.json();
          require('fs').appendFileSync('/tmp/isptotal.log', '[ELIMINAR-ONU] save_config (attempt ' + (svTry+1) + '): ' + JSON.stringify(svData) + '\n');
          if (svData.status === 'success' || svData.status === true || svData.response_code === 'success') {
            break;
          }
        } catch(e3) { require('fs').appendFileSync('/tmp/isptotal.log', '[ELIMINAR-ONU] save_config error: ' + (e3.message||'') + '\n'); }
      }
    }
    
    // Delete old ONU from local DB completely
    var delResult = db.prepare('DELETE FROM onu WHERE sn = ?').run(sn);
    require('fs').appendFileSync('/tmp/isptotal.log', '[ELIMINAR-ONU] local DB deleted ' + (delResult ? delResult.changes : 0) + ' rows\n');
    // Delete from local onu table if exists
    db.prepare('DELETE FROM onu WHERE sn = ?').run(sn);
    
    res.json({ success: true, message: 'ONU vieja eliminada' + (extId ? ' de SmartOLT y ' : ' ') + 'desvinculada del servicio' });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

// POST /api/cambio-onu/autorizar-nueva-onu - authorize new ONU via SmartOLT
app.post('/api/cambio-onu/autorizar-nueva-onu', requireAuth, async (req, res) => {
  const { olt_id, serial, onu_type, cliente_nombre, servicio_id, vlan, pppoe_user, pppoe_pass, board, port, onu_mode } = req.body;
  if (!olt_id || !serial) return res.json({ success: false, message: 'OLT y Serial requeridos' });
  try {
    const olt = db.prepare('SELECT * FROM olts WHERE id=? AND activo=1').get(olt_id);
    if (!olt || !olt.smartolt_subdomain || !olt.smartolt_api_key) {
      return res.json({ success: false, message: 'OLT no configurada para SmartOLT' });
    }
    const apiUrl = 'https://' + olt.smartolt_subdomain + '.smartolt.com/api';
    
    // Delete old ONU first (if provided)
    if (req.body.old_sn && req.body.old_olt_id) {
      try {
        const oldOlt = db.prepare('SELECT * FROM olts WHERE id=? AND activo=1').get(req.body.old_olt_id);
        if (oldOlt && oldOlt.smartolt_subdomain && oldOlt.smartolt_api_key) {
          const oldApiUrl = 'https://' + oldOlt.smartolt_subdomain + '.smartolt.com/api';
          const oldDetResp = await fetch(oldApiUrl + '/onu/get_onus_details_by_sn/' + req.body.old_sn, {
            method: 'GET', headers: { 'X-Token': oldOlt.smartolt_api_key, 'Accept': 'application/json' }
          });
          const oldDetData = await oldDetResp.json();
          let oldList = oldDetData.onus || oldDetData.response || [];
          if (oldList.length > 0) {
            var oldExtId = oldList[0].unique_external_id || oldList[0].id || oldList[0].onu_id || '';
            if (oldExtId) {
              await fetch(oldApiUrl + '/onu/delete/' + oldExtId, { method: 'POST', headers: { 'X-Token': oldOlt.smartolt_api_key } });
              await fetch(oldApiUrl + '/system/save_config', { method: 'POST', headers: { 'X-Token': oldOlt.smartolt_api_key } });
            }
          }
        }
        db.prepare('DELETE FROM onu WHERE sn = ?').run(req.body.old_sn);
      } catch(eOld) { /* best effort */ }
    }
    
    // Get zone name from service
    let zonaName = '';
    if (servicio_id) {
      const svc = db.prepare('SELECT s.*, z.nombre as zona_nombre FROM servicios s LEFT JOIN zonas z ON z.id=s.zona_id WHERE s.id=?').get(servicio_id);
      if (svc && svc.zona_nombre) zonaName = svc.zona_nombre;
    }
    
    // Authorize ONU - solo parámetros mínimos (como en la interfaz web de SmartOLT)
    const params = new URLSearchParams();
    params.append('olt_id', olt.smartolt_olt_id || olt_id);
    params.append('sn', serial);
    params.append('pon_type', 'gpon');
    if (!onu_type && serial) {
      try {
        const detResp = await fetch(apiUrl + '/onu/get_onus_details_by_sn/' + serial, { method: 'GET', headers: { 'X-Token': olt.smartolt_api_key, 'Accept': 'application/json' } });
        const detData = await detResp.json();
        let detList = detData.onus || detData.response || [];
        if (detList.length > 0 && (detList[0].onu_type || detList[0].model)) {
          onu_type = detList[0].onu_type || detList[0].model;
        }
      } catch(eDet) {}
    }
    // Fallback: get real client name from DB if cliente_nombre is empty or placeholder
    if ((!cliente_nombre || cliente_nombre.indexOf('Cliente #') === 0) && servicio_id) {
      var realClient = db.prepare('SELECT c.nombre FROM servicios s JOIN clientes c ON c.id=s.cliente_id WHERE s.id=?').get(servicio_id);
      if (realClient && realClient.nombre) {
        cliente_nombre = realClient.nombre;
      }
    }
    if (onu_type) params.append('onu_type', onu_type);
    // Siempre Routing a menos que el usuario envíe explícitamente 'bridge'
    var onuMode = 'Routing';
    if (req.body.onu_mode && (req.body.onu_mode.toLowerCase() === 'bridging' || req.body.onu_mode.toLowerCase() === 'bridge')) onuMode = 'Bridging';
    params.append('onu_mode', onuMode);
    params.append('zone', zonaName || 'default');
    params.append('name', (cliente_nombre || serial).replace(/[^a-zA-Z0-9 @$&()\-`.+,/_\:;]/g, '').trim().substring(0, 64) || serial);
    if (vlan) params.append('vlan', vlan);
    else if (olt.vlan_default) params.append('vlan', olt.vlan_default);
    if (board) params.append('board', board);
    if (port) params.append('port', port);
    
    // If pre-authorized, delete first
    try {
      const searchResp = await fetch(apiUrl + '/onu/get_onus_details_by_sn/' + serial, {
        method: 'GET', headers: { 'X-Token': olt.smartolt_api_key, 'Accept': 'application/json' }
      });
      const searchData = await searchResp.json();
      let searchList = searchData.onus || searchData.response || [];
      if (searchList.length > 0) {
        var sid = searchList[0].id || searchList[0].onu_id || searchList[0].external_id || '';
        if (sid) {
          await fetch(apiUrl + '/onu/delete/' + sid, { method: 'POST', headers: { 'X-Token': olt.smartolt_api_key } });
        }
      }
    } catch(e) {}
    
    const response = await fetch(apiUrl + '/onu/authorize_onu', {
      method: 'POST',
      headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    const ct = response.headers.get('content-type') || '';
    let data;
    if (ct.indexOf('json') !== -1) {
      data = await response.json();
    } else {
      const text = await response.text();
      return res.json({ success: false, message: text.substring(0, 300) });
    }
    
    if (data.status === 'success' || data.status === true || data.response_code === 'success') {
      // Get external ID (retry up to 3 times)
      let extId = '';
      for (var attempt = 0; attempt < 3 && !extId; attempt++) {
        try {
          if (attempt > 0) { await new Promise(function(r) { setTimeout(r, 2000); }); }
          const extResp = await fetch(apiUrl + '/onu/get_onus_details_by_sn/' + serial, {
            method: 'GET', headers: { 'X-Token': olt.smartolt_api_key, 'Accept': 'application/json' }
          });
          const extData = await extResp.json();
          let extList = extData.onus || extData.response || [];
          if (extList.length > 0) {
            extId = extList[0].unique_external_id || extList[0].id || extList[0].onu_id || '';
          }
        } catch(e) {}
      }
      require('fs').appendFileSync('/tmp/isptotal.log', new Date().toISOString() + ' [CAMBIO-ONU] extId=' + extId + '\n');
      
      // Get plan profiles for speed
      var dlProfile = '', ulProfile = '';
      if (servicio_id) {
        var pp = db.prepare('SELECT p.perfil_olt_descarga, p.perfil_olt_subida, p.perfil_mikrotik, p.nombre as plan_name FROM servicios s LEFT JOIN planes p ON p.id=s.plan_id WHERE s.id=?').get(servicio_id);
        if (pp) {
          dlProfile = pp.perfil_olt_descarga || pp.perfil_mikrotik || pp.plan_name || '';
          ulProfile = pp.perfil_olt_subida || dlProfile;
        }
      }
      
      if (extId) {
        // Speed profiles
        if (dlProfile) {
          try {
            var spP = new URLSearchParams();
            spP.append('upload_speed_profile_name', ulProfile);
            spP.append('download_speed_profile_name', dlProfile);
            var spRespC = await fetch(apiUrl + '/onu/update_onu_speed_profiles/' + extId, { method: 'POST', headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: spP });
            var spDataC = await spRespC.json();
            require('fs').appendFileSync('/tmp/isptotal.log', new Date().toISOString() + ' [CAMBIO-ONU] SpeedProfile: ' + JSON.stringify(spDataC) + '\n');
          } catch(eSp) { require('fs').appendFileSync('/tmp/isptotal.log', new Date().toISOString() + ' [CAMBIO-ONU] SpeedProfile error: ' + (eSp.message||'') + '\n'); }
        }
        
        // Set Mgmt IP DHCP first (TR069 needs it)
        try {
          var mgP = new URLSearchParams();
          var mgVlan = olt.tr069_vlan || vlan || olt.vlan_default || '';
          if (mgVlan) mgP.append('vlan', mgVlan);
          var mgRespC = await fetch(apiUrl + '/onu/set_onu_mgmt_ip_dhcp/' + extId, { method: 'POST', headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: mgP });
          var mgDataC = await mgRespC.json();
          require('fs').appendFileSync('/tmp/isptotal.log', new Date().toISOString() + ' [CAMBIO-ONU] MgmtIP: ' + JSON.stringify(mgDataC) + '\n');
        } catch(eM) { require('fs').appendFileSync('/tmp/isptotal.log', new Date().toISOString() + ' [CAMBIO-ONU] MgmtIP error: ' + (eM.message||'') + '\n'); }
        
        // Enable TR069 (after Mgmt IP is ready)
        try {
          var trP = new URLSearchParams();
          trP.append('tr069_profile', olt.tr069_profile || 'SmartOLT');
          var trRespC = await fetch(apiUrl + '/onu/enable_tr069/' + extId, { method: 'POST', headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: trP });
          var trDataC = await trRespC.json();
          require('fs').appendFileSync('/tmp/isptotal.log', new Date().toISOString() + ' [CAMBIO-ONU] TR069 response: ' + JSON.stringify(trDataC) + '\n');
        } catch(eTr) {}
        
        // Read WAN data from DB (like TR069 does)
        if (servicio_id) {
          var wanS = db.prepare('SELECT pppoe_user, pppoe_pass, auth_type FROM servicios WHERE id=?').get(servicio_id);
          if (wanS) {
            if (wanS.auth_type && !pppoe_user) pppoe_user = '';
            if (wanS.pppoe_user && !pppoe_user) pppoe_user = wanS.pppoe_user;
            if (wanS.pppoe_pass && !pppoe_pass) pppoe_pass = wanS.pppoe_pass;
          }
        }
        
        // Set WAN mode
        try {
          if (pppoe_user) {
            var ppP = new URLSearchParams();
            ppP.append('username', pppoe_user);
            ppP.append('password', pppoe_pass || 'changeme');
            ppP.append('configuration_method', 'TR069');
            ppP.append('ip_protocol', 'ipv4ipv6');
            var wanRespC = await fetch(apiUrl + '/onu/set_onu_wan_mode_pppoe/' + extId, { method: 'POST', headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: ppP });
            var wanDataC = await wanRespC.json();
            require('fs').appendFileSync('/tmp/isptotal.log', new Date().toISOString() + ' [CAMBIO-ONU] WAN mode: ' + JSON.stringify(wanDataC) + '\n');
          } else {
            var dP = new URLSearchParams();
            dP.append('configuration_method', 'OMCI');
            dP.append('ip_protocol', 'ipv4ipv6');
            var dhcpRespC = await fetch(apiUrl + '/onu/set_onu_wan_mode_dhcp/' + extId, { method: 'POST', headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: dP });
            var dhcpDataC = await dhcpRespC.json();
            require('fs').appendFileSync('/tmp/isptotal.log', new Date().toISOString() + ' [CAMBIO-ONU] WAN DHCP: ' + JSON.stringify(dhcpDataC) + '\n');
          }
        } catch(eW) { require('fs').appendFileSync('/tmp/isptotal.log', new Date().toISOString() + ' [CAMBIO-ONU] WAN error: ' + (eW.message||'') + '\n'); }
        
        // Set WiFi
        if (servicio_id) {
          try {
            var wf = db.prepare('SELECT wifi_ssid, wifi_pass FROM servicios WHERE id=?').get(servicio_id);
            if (wf && wf.wifi_ssid) {
              var wfP = new URLSearchParams();
              wfP.append('wifi_port', 'wifi_0/1');
              wfP.append('ssid', wf.wifi_ssid);
              wfP.append('password', wf.wifi_pass || '');
              wfP.append('authentication_mode', 'WPA2');
              await fetch(apiUrl + '/onu/set_wifi_port_lan/' + extId, { method: 'POST', headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: wfP });
            }
          } catch(eWi) {}
        }
        
        // Save config
        try {
          await fetch(apiUrl + '/system/save_config', { method: 'POST', headers: { 'X-Token': olt.smartolt_api_key } });
        } catch(eSv) {}
      }
      
      // Link ONU to service in local DB
      if (servicio_id && serial) {
        try {
          var clId = null;
          var svc2 = db.prepare('SELECT cliente_id FROM servicios WHERE id=?').get(servicio_id);
          if (svc2) clId = svc2.cliente_id;
          db.prepare("INSERT INTO onu (sn, nombre, cliente_id, olt_id, servicio_id, estado) VALUES (?,?,?,?,?,'activo') ON CONFLICT(sn) DO UPDATE SET cliente_id=COALESCE(excluded.cliente_id,onu.cliente_id), servicio_id=COALESCE(excluded.servicio_id,onu.servicio_id), olt_id=COALESCE(excluded.olt_id,onu.olt_id)")
            .run(serial, cliente_nombre || serial, clId, olt_id, servicio_id);
        } catch(e2) {}
      }
      
      return res.json({ success: true, message: 'ONU autorizada y configurada exitosamente' });
    }
    return res.json({ success: false, message: data.msg || data.message || data.error || 'Error al autorizar ONU' });
  } catch(e) {
    return res.json({ success: false, message: e.message });
  }
});

// POST /api/cambio-onu/verificar-onu - check if ONU is registered in SmartOLT
app.post('/api/cambio-onu/verificar-onu', requireAuth, async (req, res) => {
  const { olt_id, serial } = req.body;
  if (!olt_id || !serial) return res.json({ found: false });
  try {
    const olt = db.prepare('SELECT * FROM olts WHERE id=? AND activo=1').get(olt_id);
    if (!olt || !olt.smartolt_subdomain || !olt.smartolt_api_key) return res.json({ found: false });
    const apiUrl = 'https://' + olt.smartolt_subdomain + '.smartolt.com/api';
    const resp = await fetch(apiUrl + '/onu/get_onus_details_by_sn/' + serial, {
      method: 'GET', headers: { 'X-Token': olt.smartolt_api_key, 'Accept': 'application/json' }
    });
    const data = await resp.json();
    let list = data.onus || data.response || [];
    if (list.length > 0) {
      return res.json({ found: true, extId: list[0].unique_external_id || list[0].id || list[0].onu_id || '' });
    }
    return res.json({ found: false });
  } catch(e) {
    return res.json({ found: false });
  }
});

// POST /api/cambio-onu/actualizar-razon - update change reason on swap
app.post('/api/cambio-onu/actualizar-razon', requireAuth, (req, res) => {
  try {
    const { swap_id, change_reason } = req.body;
    if (!swap_id || !change_reason) return res.json({ success: false, message: 'Swap ID y razón requeridos' });
    db.prepare('UPDATE cambio_onu_swaps SET change_reason=? WHERE id=?').run(change_reason, swap_id);
    res.json({ success: true, message: 'Razón actualizada' });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

// GET /api/cambio-onu/historial - get history with pagination/filters
app.get('/api/cambio-onu/historial', requireAuth, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();
    
    let where = '1=1';
    let params = [];
    if (search) {
      where = "(c.nombre LIKE ? OR cs.old_sn LIKE ? OR cs.new_sn LIKE ? OR cs.change_reason LIKE ?)";
      const s = '%' + search + '%';
      params.push(s, s, s, s);
    }
    
    const countSql = "SELECT COUNT(*) as cnt FROM cambio_onu_swaps cs LEFT JOIN clientes c ON c.id=cs.cliente_id WHERE " + where;
    const total = db.prepare(countSql).get(...params).cnt;
    const pages = Math.max(1, Math.ceil(total / limit));
    
    const data = db.prepare("SELECT cs.*, c.nombre as cliente_nombre, c.cedula, old_ol.nombre as old_olt_nombre, new_ol.nombre as new_olt_nombre, u.nombre as creado_por FROM cambio_onu_swaps cs LEFT JOIN clientes c ON c.id=cs.cliente_id LEFT JOIN olts old_ol ON old_ol.id=cs.old_olt_id LEFT JOIN olts new_ol ON new_ol.id=cs.new_olt_id LEFT JOIN usuarios u ON u.id=cs.created_by WHERE " + where + " ORDER BY cs.id DESC LIMIT ? OFFSET ?").all(...params, limit, offset);
    
    res.json({ success: true, data: data, page: page, pages: pages, total: total });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

// ======== WAN TRAFFIC API ========
app.get('/api/dashboard/wan-traffic', requireAuth, async (req, res) => {
  try {
    const router = db.prepare('SELECT * FROM routers ORDER BY id ASC LIMIT 1').get();
    if (!router) return res.json({ success: false, message: 'No hay routers configurados' });

    const MikroTikAPI = require('./mikrotik-api');
    const result = await MikroTikAPI.getTraffic(router.ip, router.port || 8728, router.user, router.password, router.interface_wan || 'ether1');

    // Get last 24h history
    const history = db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%S', created_at) as ts, bps_in, bps_out FROM wan_traffic WHERE router_id=? AND created_at >= datetime('now','-24 hours','localtime') ORDER BY created_at ASC").all(router.id);

    if (result.success) {
      res.json({ success: true, current: { bps_in: result.bps_in, bps_out: result.bps_out }, history: history });
    } else {
      res.json({ success: true, current: { bps_in: 0, bps_out: 0 }, history: history, error: result.message });
    }
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

// Auto-collect WAN traffic every 5 minutes
setInterval(async function() {
  try {
    const router = db.prepare('SELECT * FROM routers ORDER BY id ASC LIMIT 1').get();
    if (!router) return;
    const MikroTikAPI = require('./mikrotik-api');
    const result = await MikroTikAPI.getTraffic(router.ip, router.port || 8728, router.user, router.password, router.interface_wan || 'ether1');
    if (result.success) {
      db.prepare('INSERT INTO wan_traffic (router_id, bps_in, bps_out) VALUES (?,?,?)').run(router.id, result.bps_in, result.bps_out);
    }
  } catch(e) {}
}, 300000); // 5 minutes

// POST /api/clientes/editar - Edit client and service data
app.post('/api/clientes/editar', requireAuth, (req, res) => {
  const { cliente_id, nombre, cedula, telefono, telefono2, direccion, apodo, zona_id, servicios } = req.body;
  if (!cliente_id || !nombre) return res.json({ success: false, message: 'ID y nombre requeridos' });
  
  try {
    db.prepare('UPDATE clientes SET nombre=?, cedula=?, telefono=?, telefono2=?, direccion=?, apodo=?, zona_id=? WHERE id=?')
      .run(nombre, cedula || '', telefono || '', telefono2 || '', direccion || '', apodo || '', zona_id || null, cliente_id);
    
    if (servicios && Array.isArray(servicios)) {
      var stmt = db.prepare('UPDATE servicios SET ip=?, pppoe_user=?, pppoe_pass=?, wifi_ssid=?, wifi_pass=? WHERE id=? AND cliente_id=?');
      for (var i = 0; i < servicios.length; i++) {
        var s = servicios[i];
        stmt.run(s.ip || '', s.pppoe_user || '', s.pppoe_pass || '', s.wifi_ssid || '', s.wifi_pass || '', s.id, cliente_id);
      }
    }
    
    res.json({ success: true, message: 'Cliente actualizado' });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

// POST /api/servicios/editar - Editar servicio
app.post('/api/servicios/editar', requireAuth, (req, res) => {
  const { id, ip, plan_id, auth_type, pppoe_user, pppoe_pass, wifi_ssid, wifi_pass, direccion, tipo_servicio, ciclo_id, netflix_email, netflix_password, netflix_perfil, netflix_vencimiento, descripcion_servicio, precio_servicio } = req.body;
  if (!id) return res.json({ success: false, message: 'ID de servicio requerido' });
  try {
    db.prepare(`UPDATE servicios SET ip=?, plan_id=?, auth_type=?, pppoe_user=?, pppoe_pass=?, wifi_ssid=?, wifi_pass=?, direccion=?, tipo_servicio=?, ciclo_id=?, netflix_email=?, netflix_password=?, netflix_perfil=?, netflix_vencimiento=?, descripcion_servicio=?, precio_servicio=? WHERE id=?`)
      .run(ip || '', plan_id || null, auth_type || 'dhcp', pppoe_user || '', pppoe_pass || '', wifi_ssid || '', wifi_pass || '', direccion || '', tipo_servicio || 'internet', ciclo_id || null, netflix_email || '', netflix_password || '', netflix_perfil || '', netflix_vencimiento || null, descripcion_servicio || '', precio_servicio || 0, id);
    res.json({ success: true, message: 'Servicio actualizado' });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

// GET /api/clientes/:id/servicios - Obtener servicios de un cliente
app.get('/api/clientes/:id/info', requireAuth, (req, res) => {
  const clienteId = parseInt(req.params.id) || 0;
  if (!clienteId) return res.json({ success: false, message: 'ID requerido' });
  try {
    var cliente = db.prepare('SELECT id, nombre, telefono, cedula, direccion FROM clientes WHERE id=?').get(clienteId);
    if (!cliente) return res.json({ success: false, message: 'No encontrado' });
    res.json({ success: true, data: cliente });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

// GET /api/clientes/:id/servicios - Obtener servicios de un cliente
app.get('/api/clientes/:id/servicios', requireAuth, (req, res) => {
  const clienteId = parseInt(req.params.id) || 0;
  if (!clienteId) return res.json({ success: false, message: 'ID requerido' });
  try {
    const servicios = db.prepare(`
      SELECT s.id, s.estado, s.ip, s.direccion, s.pppoe_user,
        p.nombre as plan_nombre, p.precio as plan_precio,
        z.nombre as zona_nombre,
        o.sn as onu_sn
      FROM servicios s
      LEFT JOIN planes p ON p.id=s.plan_id
      LEFT JOIN zonas z ON z.id=s.zona_id
      LEFT JOIN onu o ON o.servicio_id=s.id
      WHERE s.cliente_id=?
      ORDER BY s.id DESC
    `).all(clienteId);
    res.json({ success: true, data: servicios });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

// POST /api/facturar/bulk - Generar facturas para múltiples clientes
app.post('/api/facturar/bulk', requireAuth, (req, res) => {
  var clientes = req.body.clientes || [];
  if (!clientes.length) return res.json({ success: false, message: 'Lista de clientes requerida' });
  try {
    var creadas = 0;
    var now = new Date();
    var periodo = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    var vencimiento = new Date(now);
    vencimiento.setDate(vencimiento.getDate() + 15);
    var vencStr = vencimiento.toISOString().split('T')[0];
    
    clientes.forEach(function(clienteId) {
      var servicios = db.prepare("SELECT s.id, p.precio FROM servicios s LEFT JOIN planes p ON p.id=s.plan_id WHERE s.cliente_id=? AND s.estado='activo'").all(clienteId);
      servicios.forEach(function(svc) {
        var precio = parseFloat(svc.precio || svc.plan_price || 0);
        if (precio > 0) {
          var existing = db.prepare('SELECT id FROM facturas WHERE servicio_id=? AND periodo=?').get(svc.id, periodo);
          if (!existing) {
            db.prepare('INSERT INTO facturas (servicio_id, periodo, monto, estado, fecha_emision, fecha_vencimiento) VALUES (?,?,?,\'pendiente\',date(\'now\'),?)').run(svc.id, periodo, precio, vencStr);
            creadas++;
          }
        }
      });
    });
    
    var msg = creadas > 0 ? creadas + ' factura(s) generadas' : 'Los clientes ya tienen facturas para este periodo';
    res.json({ success: true, message: msg, count: creadas });
  } catch(e) {
    res.json({ success: false, message: 'Error: ' + e.message });
  }
});

// POST /api/servicios/:id/activar - Activar servicio
app.post('/api/servicios/:id/activar', requireAuth, (req, res) => {
  const id = parseInt(req.params.id) || 0;
  if (!id) return res.json({ success: false, message: 'ID requerido' });
  try {
    const svc = db.prepare('SELECT s.cliente_id FROM servicios s WHERE s.id=?').get(id);
    db.prepare("UPDATE servicios SET estado='activo', fecha_activacion=date('now') WHERE id=?").run(id);
    
    // Enviar notificación de reactivación
    if (svc) {
      (async function() {
        try { sendReactivationNotification(svc.cliente_id, id, null); } catch(e) {}
      })();
    }
    
    res.json({ success: true, message: 'Servicio activado' });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

// POST /api/servicios/:id/retirar - Retirar servicio
app.post('/api/servicios/:id/retirar', requireAuth, (req, res) => {
  const id = parseInt(req.params.id) || 0;
  if (!id) return res.json({ success: false, message: 'ID requerido' });
  try {
    var svc = db.prepare('SELECT s.*, o.sn as onu_sn, o.olt_id FROM servicios s LEFT JOIN onu o ON o.servicio_id=s.id WHERE s.id=?').get(id);
    if (!svc) return res.json({ success: false, message: 'Servicio no encontrado' });
    db.prepare("UPDATE servicios SET estado='retirado', fecha_suspension=date('now') WHERE id=?").run(id);
    
    // Intentar eliminar ONU de SmartOLT (usando URL de la OLT correcta)
    try {
      var oltCfg = db.prepare('SELECT smartolt_subdomain, smartolt_api_key FROM olts WHERE id=?').get(svc.olt_id);
      if (oltCfg && oltCfg.smartolt_subdomain && oltCfg.smartolt_api_key && svc.onu_sn) {
        var url = 'https://' + oltCfg.smartolt_subdomain + '.smartolt.com/api/onus/' + svc.onu_sn + '/delete';
        var headers = { 'X-API-Key': oltCfg.smartolt_api_key, 'Content-Type': 'application/json' };
        fetch(url, { method: 'POST', headers: headers }).catch(function() {});
      }
    } catch(e) {}
    
    // Eliminar ONU de la base de datos
    db.prepare('DELETE FROM onu WHERE servicio_id=?').run(id);
    
    res.json({ success: true, message: 'Servicio retirado' });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

// POST /api/servicios/:id/eliminar - Eliminar servicio
app.post('/api/servicios/:id/eliminar', requireAuth, (req, res) => {
  const id = parseInt(req.params.id) || 0;
  if (!id) return res.json({ success: false, message: 'ID de servicio requerido' });
  try {
    const svc = db.prepare('SELECT * FROM servicios WHERE id=?').get(id);
    if (!svc) return res.json({ success: false, message: 'Servicio no encontrado' });
    // Delete related records first, then the service itself
    db.prepare('DELETE FROM pagos WHERE servicio_id=?').run(id);
    db.prepare('DELETE FROM ordenes WHERE servicio_id=?').run(id);
    db.prepare('DELETE FROM promesas_pago WHERE servicio_id=?').run(id);
    db.prepare('DELETE FROM onu WHERE servicio_id=?').run(id);
    db.prepare('DELETE FROM facturas WHERE servicio_id=?').run(id);
    db.prepare('DELETE FROM ips_asignadas WHERE servicio_id=?').run(id);
    db.prepare('DELETE FROM servicios WHERE id=?').run(id);
    res.json({ success: true, message: 'Servicio eliminado permanentemente' });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

// POST /api/servicios/batch-suspender - Suspender múltiples servicios
app.post('/api/servicios/batch-suspender', requireAuth, (req, res) => {
  var servicioIds = req.body.servicio_ids || [];
  if (!Array.isArray(servicioIds) || servicioIds.length === 0) {
    return res.json({ success: false, message: 'IDs de servicio requeridos' });
  }
  try {
    var suspendidos = 0;
    servicioIds.forEach(function(sid) {
      var svc = db.prepare('SELECT s.*, c.id as cliente_id FROM servicios s JOIN clientes c ON c.id=s.cliente_id WHERE s.id=?').get(sid);
      if (svc && svc.estado !== 'suspendido') {
        db.prepare('UPDATE servicios SET estado=\'suspendido\' WHERE id=?').run(sid);
        suspendidos++;
        
        // Enviar notificación
        (async function() {
          try {
            var openwa = require('./openwa-service');
            var clientData = db.prepare('SELECT nombre, telefono FROM clientes WHERE id=?').get(svc.cliente_id);
            if (!clientData || !clientData.telefono) return;
            
            var deudaRow = db.prepare("SELECT COALESCE(SUM(f.monto - COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0)),0) as total FROM facturas f WHERE f.servicio_id=? AND f.estado='pendiente'").get(sid);
            var deudaTotal = deudaRow ? deudaRow.total : 0;
            
            var config = {};
            var cr = db.prepare("SELECT key, value FROM configuracion WHERE key IN ('empresa_nombre','empresa_telefono')").all();
            cr.forEach(function(r) { config[r.key] = r.value || ''; });
            
            var tpl = db.prepare("SELECT content FROM templates WHERE template_key='notif_suspension'").get();
            var msg = (tpl ? tpl.content : '')
              .replace(/{client_name}/g, clientData.nombre || '')
              .replace(/{service_address}/g, svc.direccion || '')
              .replace(/{plan_name}/g, (db.prepare('SELECT nombre FROM planes WHERE id=?').get(svc.plan_id) || {}).nombre || '')
              .replace(/{invoice_remaining}/g, '$' + deudaTotal.toFixed(2))
              .replace(/{company_phone}/g, config.empresa_telefono)
              .replace(/{company_name}/g, config.empresa_nombre);
            
            if (msg.trim()) openwa.encolarMensaje(svc.cliente_id, sid, clientData.telefono, msg, 'suspension');
          } catch(e) {}
        })();
      }
    });
    
    res.json({ success: true, message: suspendidos + ' servicio(s) suspendido(s)' });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

// POST /api/servicios/:id/suspender - Suspender/Activar servicio
app.post('/api/servicios/:id/suspender', requireAuth, (req, res) => {
  const id = parseInt(req.params.id) || 0;
  if (!id) return res.json({ success: false, message: 'ID de servicio requerido' });
  try {
    const svc = db.prepare('SELECT s.*, c.id as cliente_id FROM servicios s JOIN clientes c ON c.id=s.cliente_id WHERE s.id=?').get(id);
    if (!svc) return res.json({ success: false, message: 'Servicio no encontrado' });
    const nuevoEstado = svc.estado === 'suspendido' ? 'activo' : 'suspendido';
    db.prepare('UPDATE servicios SET estado=? WHERE id=?').run(nuevoEstado, id);
    
    // Si se reactivó, enviar notificación
    if (nuevoEstado === 'activo') {
      (async function() {
        try { sendReactivationNotification(svc.cliente_id, id, null); } catch(e) {}
      })();
    }
    
    // MikroTik: agregar/quitar IP de lista de suspendidos
    (async function() {
      try {
        var router = db.prepare('SELECT * FROM routers WHERE connected=1 OR id=(SELECT MIN(id) FROM routers)').get();
        if (router && router.user && svc.ip) {
          var MikroTikAPI = require('./mikrotik-api');
          var add = nuevoEstado === 'suspendido';
          MikroTikAPI.setAddressList(router.ip, router.port || 8728, router.user, router.password, svc.ip, 'Suspendidos', add);
        }
      } catch(e) {}
    })();
    
    res.json({ success: true, message: 'Servicio ' + (nuevoEstado === 'suspendido' ? 'suspendido' : 'reactivado') });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`ISP Total corriendo en http://localhost:${PORT}`);
  
  // Auto-start OpenWa if enabled
  try {
    var openwa = require('./openwa-service');
    var cfg = openwa.getConfig();
    if (cfg.enabled) {
      setTimeout(function() {
        openwa.start().then(function(r) {
          if (r.success) console.log('[OpenWa] Iniciado automáticamente');
          else console.log('[OpenWa] Auto-start: ' + r.msg);
        }).catch(function(e) {
          console.log('[OpenWa] Auto-start error: ' + e.message);
        });
      }, 3000);
    }
  } catch(e) {
    console.log('[OpenWa] Auto-start error: ' + e.message);
  }
});

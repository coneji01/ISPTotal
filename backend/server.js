const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcrypt');
const fileUpload = require('express-fileupload');
const db = require('./database');
const mt = require('./multi-tenant');

var _tenantDbGlobal = null;
var _mainDb = db;
var _origPrepare = db.prepare;
db.prepare = function(sql) {
  var activeDb = _tenantDbGlobal || _mainDb;
  return _origPrepare.call(activeDb, sql);
};

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
const PORT = process.env.PORT || 3020;

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
  if (req.session.isTenant && req.session.db_path) {
    var tdb = mt.getTenantDb(req.session.db_path);
    if (tdb) _tenantDbGlobal = tdb;
    else _tenantDbGlobal = null;
  } else {
    _tenantDbGlobal = null;
  }
  global.__tenantDbForLogs = _tenantDbGlobal;


// Wrap global fetch to route SmartOLT API calls through MikroTik SOCKS4 proxy via IPv6
var _originalFetch = global.fetch || fetch;
var net = require('net');
var tls = require('tls');

const SOCKS_HOST = '2803:5a10:2:2800::2';
const SOCKS_PORT = 1080;
const SMARTOLT_IP = '45.77.112.217';
const SMARTOLT_DOMAIN = 'joelwifi.smartolt.com';

global.fetch = async function(url, options) {
  var urlStr = (typeof url === 'string') ? url : (url ? (url.href || url.url || '') : '');

  if (!urlStr.includes('.smartolt.com/api/')) {
    return _originalFetch(url, options);
  }

  try {
    var parsedUrl = new URL(urlStr);
    var path = parsedUrl.pathname + parsedUrl.search;
    var method = (options?.method || 'GET').toUpperCase();
    var headers = Object.assign({ Host: parsedUrl.host }, options?.headers || {});
    var bodyData = options?.body || null;

    // Convert body to string
    var bodyStr = '';
    if (bodyData) {
      if (typeof bodyData === 'string') bodyStr = bodyData;
      else if (typeof bodyData === 'object' && bodyData.toString) bodyStr = bodyData.toString();
      else bodyStr = JSON.stringify(bodyData);
    }
    if (bodyStr && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    if (bodyStr) {
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    var port = parsedUrl.port || 443;
    var smartoltIps = SMARTOLT_IP.split('.').map(Number);

    return new Promise(function(resolve, reject) {
      var timeoutId = setTimeout(function() {
        try { sock.destroy(); } catch(e) {}
        reject(new Error('SOCKS proxy timeout'));
      }, 20000);

      function cleanup() {
        clearTimeout(timeoutId);
        try { sock.destroy(); } catch(e) {}
      }

      var sock = new net.Socket();
      sock.setTimeout(15000);

      sock.on('connect', function() {
        var buf = Buffer.from([4, 1, port >> 8, port & 0xff, smartoltIps[0], smartoltIps[1], smartoltIps[2], smartoltIps[3], 0]);
        sock.write(buf);
      });

      sock.once('data', function(data) {
        if (data.length < 8 || data[1] !== 90) {
          cleanup();
          reject(new Error('SOCKS rejected: ' + (data[1] || 0)));
          return;
        }

        // SOCKS granted, start TLS
        sock.setTimeout(0);
        var tlsSocket = tls.connect({ socket: sock, host: SMARTOLT_DOMAIN, rejectUnauthorized: false });

        tlsSocket.on('secureConnect', function() {
          var req = method + ' ' + path + ' HTTP/1.1\r\n';
          for (var k in headers) {
            if (headers.hasOwnProperty(k)) req += k + ': ' + headers[k] + '\r\n';
          }
          req += '\r\n';
          if (bodyStr) req += bodyStr;
          tlsSocket.write(req);
        });

        var respRaw = '';
        tlsSocket.on('data', function(chunk) { respRaw += chunk.toString(); });
        tlsSocket.on('end', function() {
          cleanup();

          var pos = respRaw.indexOf('\r\n\r\n');
          if (pos === -1) { reject(new Error('Invalid response')); return; }

          var head = respRaw.substring(0, pos);
          var body = respRaw.substring(pos + 4);

          // Decode chunked
          if (/^[0-9a-f]+\r\n/i.test(body)) {
            var decoded = '', i = 0;
            while (i < body.length) {
              var eol = body.indexOf('\r\n', i);
              if (eol === -1) break;
              var sz = parseInt(body.substring(i, eol), 16);
              if (!sz || isNaN(sz)) break;
              i = eol + 2;
              decoded += body.substring(i, i + sz);
              i += sz + 2;
            }
            if (decoded) body = decoded;
          }

          var statusLine = head.split('\r\n')[0];
          var statusCode = parseInt(statusLine.split(' ')[1]) || 500;

          var respHeaders = {};
          head.split('\r\n').slice(1).forEach(function(l) {
            var c = l.indexOf(':');
            if (c > -1) respHeaders[l.substring(0, c).trim().toLowerCase()] = l.substring(c + 1).trim();
          });

          resolve({
            ok: statusCode >= 200 && statusCode < 300,
            status: statusCode,
            headers: { get: function(n) { return respHeaders[n.toLowerCase()] || ''; } },
            json: async function() { return JSON.parse(body); },
            text: async function() { return body; }
          });
        });

        tlsSocket.on('error', function(err) {
          cleanup();
          reject(new Error('TLS: ' + err.message));
        });
      });

      sock.on('error', function(err) {
        cleanup();
        reject(new Error('Socket: ' + err.message));
      });

      sock.on('timeout', function() {
        cleanup();
        reject(new Error('Socket timeout'));
      });

      sock.connect(SOCKS_PORT, SOCKS_HOST);
    });
  } catch(e) {
    console.log('[Fetch-Wrapper] Error:', e.message);
    throw e;
  }
};
  next();
}

// ======== SERVER DATE SIMULATION ========
function getCurrentServerDate() {
  const real = new Date();
  const realStr = real.toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' });
  const realDateOnly = real.toISOString().split('T')[0];

  try {
    const simulated = db.prepare("SELECT value FROM configuracion WHERE key='fecha_simulada'").get();
    const simulatedTime = db.prepare("SELECT value FROM configuracion WHERE key='hora_simulada'").get();
    if (simulated && simulated.value && simulated.value.trim()) {
      var timeVal = (simulatedTime && simulatedTime.value) ? simulatedTime.value.trim() : '12:00';
      if (!/^\d{2}:\d{2}$/.test(timeVal)) timeVal = '12:00';
      return {
        real: realStr,
        real_date_only: realDateOnly,
        current: simulated.value.trim() + ' ' + timeVal + ':00',
        current_date_only: simulated.value.trim(),
        current_time: timeVal,
        overridden: true
      };
    }
  } catch(e) {}

  return {
    real: realStr,
    real_date_only: realDateOnly,
    current: realStr,
    current_date_only: realDateOnly,
    current_time: real.toTimeString().substring(0,5),
    overridden: false
  };
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
      { id: 'GPONManager', icon: 'fa-tachometer-alt', nombre: 'Dashboard OLT' },
      { id: 'SmartoltDashboard', icon: 'fa-external-link-alt', nombre: 'SmartOLT App' },
      { id: 'SmartoltConfigured', icon: 'fa-check-circle', nombre: 'ONUs Configuradas' },
      { id: 'SmartoltUnconfigured', icon: 'fa-clock', nombre: 'ONUs No configuradas' },
      { id: 'SmartoltLocations', icon: 'fa-map-marker-alt', nombre: 'Zonas' },
      { id: 'SmartoltOnuTypes', icon: 'fa-microchip', nombre: 'Tipos de ONU' },
      { id: 'SmartoltSpeedProfiles', icon: 'fa-tachometer-alt', nombre: 'Perfiles Velocidad' },
      { id: 'SmartoltSettings', icon: 'fa-cog', nombre: 'Conf OLT' },
      { id: 'Gpon', icon: 'fa-satellite-dish', nombre: 'Lista de ONU' },
      { id: 'CajasNap', icon: 'fa-box', nombre: 'Cajas NAP' }
    ]},
    { type: 'link', id: 'BuscarOnu', icon: 'fa-search', nombre: 'Buscar ONU' },
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
    { type: 'link', id: 'Plantillas', icon: 'fa-edit', nombre: 'Editor de Plantillas' },
    { type: 'link', id: 'Configuracion', icon: 'fa-cog', nombre: 'Configuración' },
    // TR069 removed from menu - only accessible via Configuracion
    { type: 'link', id: 'Actualizaciones', icon: 'fa-sync', nombre: 'Actualizaciones' }
  ];

  const modulos = menuEstructura.reduce(function(acc, item) {
    if (item.type === 'link') acc.push(item);
    else if (item.items) item.items.forEach(function(sub) { acc.push(sub); });
    return acc;
  }, []);

  var serverDate = getCurrentServerDate();
  res.render('layout', { ...data, page, modulos, menuEstructura, user: req.session.user, serverDate: serverDate });
}

// ======== LOGIN ========
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/modulo?pagina=Dashboard');
  res.render('login');
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  _tenantDbGlobal = null;
  global.__tenantDbForLogs = null;
  // Always use main DB for login
  console.log('[Login] user=' + username + ' pwd=' + password + ' mtResult=' + JSON.stringify(mt.authenticate(username, password)));
  var mtResult = mt.authenticate(username, password);
  if (mtResult.success) {
    req.session.user = { id: mtResult.company.id, username: mtResult.company.username, nombre: mtResult.company.owner_name, tenant: true };
    req.session.isTenant = true;
    req.session.db_path = mtResult.company.db_path;
    return res.redirect('/modulo?pagina=Dashboard');
  }
  var user;
  try { user = db.prepare('SELECT * FROM usuarios WHERE username=? ').get(username); console.log('[Login] db user=' + (user ? user.username : 'null')); } catch(e) { console.log('[Login] DB ERROR:', e.message); }
  if (!user || !bcrypt.compareSync(password, user.password)) {
    console.log('[Login] FAIL: ' + (!user ? 'no user' : 'password mismatch') + ' pw_len=' + password.length + ' hash=' + (user ? user.password.substring(0,20) : 'no_user'));
    return res.render('login', { error: 'Usuario o contraseña incorrectos' });
  }
  console.log('[Login] SUCCESS, setting session...');
  req.session.user = { id: user.id, username: user.username, nombre: user.nombre };
  req.session.isTenant = false;
  console.log('[Login] Redirecting...');
  res.redirect('/modulo?pagina=Dashboard');
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ======== REGISTRATION ========
app.get('/registro', (req, res) => {
  res.render('registro');
});

app.post('/api/register', async (req, res) => {
  var body = req.body;
  if (!body.company_name || !body.owner_name || !body.email || !body.username || !body.password) {
    return res.json({ success: false, msg: 'Todos los campos son obligatorios' });
  }
  if (body.password.length < 6) {
    return res.json({ success: false, msg: 'La contraseña debe tener al menos 6 caracteres' });
  }
  var crypto = require('crypto');
  const emailToken = crypto.randomBytes(32).toString('hex');
  const result = mt.createCompany({ company_name: body.company_name, owner_name: body.owner_name, email: body.email, username: body.username, password: body.password, email_token: emailToken });
  if (!result.success) return res.json({ success: false, msg: result.msg });
  try {
    var baseUrl = req.get('host');
    if (baseUrl === 'localhost:3020' || baseUrl === '127.0.0.1:3020') baseUrl = '38.159.230.88:3020';
    const confirmUrl = req.protocol + '://' + baseUrl + '/confirmar-email?token=' + emailToken;
    var smtpE = (db.prepare("SELECT value FROM configuracion WHERE key='smtp_email'").get() || {}).value || '';
    var smtpP = (db.prepare("SELECT value FROM configuracion WHERE key='smtp_password'").get() || {}).value || '';
    if (smtpE && smtpP) {
      var nm = require('nodemailer');
      var tr = nm.createTransport({ host: 'smtp.gmail.com', port: 587, secure: false, auth: { user: smtpE, pass: smtpP } });
      await tr.sendMail({ from: '"ISP Total" <' + smtpE + '>', to: body.email, subject: 'Confirma tu cuenta', html: '<a href="' + confirmUrl + '">Confirmar</a>' });
    }
  } catch(e) { console.log('[Reg] Email error:', e.message); }
  res.json({ success: true, msg: 'Registro exitoso. Revise su correo.' });
});

app.get('/confirmar-email', (req, res) => {
  const token = req.query.token || '';
  if (!token) return res.send('<h2>Token inválido</h2>');
  var r = mt.verifyEmail(token);
  if (r.success) res.send('<h2>Email confirmado</h2><p>' + r.company_name + ' activada. <a href="/">Iniciar sesión</a></p>');
  else res.send('<h2>Error</h2><p>' + r.msg + '</p>');
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
      var sd = getCurrentServerDate();
      var fechaRef = sd.overridden ? sd.current_date_only : null;
      var hoySQL = fechaRef ? ("'" + fechaRef + "'") : "date('now')";
      var mesSQL = fechaRef ? ("'" + fechaRef.substring(0,7) + "'") : "strftime('%Y-%m', 'now')";

      const pagosHoy = db.prepare("SELECT COALESCE(SUM(monto),0) as total FROM pagos WHERE date(created_at)=" + hoySQL).get();
      const pagosMes = db.prepare("SELECT COALESCE(SUM(monto),0) as total, COUNT(*) as cantidad FROM pagos WHERE strftime('%Y-%m', created_at) = " + mesSQL).get();
      const instalaciones = db.prepare("SELECT COUNT(*) as total FROM ordenes WHERE tipo='Instalacion' AND estado='pendiente'").get();

      // Monthly stats for bar chart (12 months)

      // Para instalados: usar fecha_activacion
      var sqlInst = "SELECT substr(fecha_activacion,1,7) as mes, COUNT(*) as total FROM servicios WHERE fecha_activacion IS NOT NULL";
      if (fechaRef) {
        var d = new Date(fechaRef + 'T12:00:00');
        d.setMonth(d.getMonth() - 11);
        var desde = d.toISOString().split('T')[0];
        sqlInst += " AND fecha_activacion >= '" + desde + "'";
      } else {
        sqlInst += " AND fecha_activacion >= date('now','-12 months')";
      }
      sqlInst += " GROUP BY mes ORDER BY mes";
      const instaladosMeses = db.prepare(sqlInst).all();

      // Para retirados: usar fecha_retiro
      var sqlRet = "SELECT substr(fecha_retiro,1,7) as mes, COUNT(*) as total FROM servicios WHERE fecha_retiro IS NOT NULL";
      if (fechaRef) {
        var d2 = new Date(fechaRef + 'T12:00:00');
        d2.setMonth(d2.getMonth() - 11);
        var desde2 = d2.toISOString().split('T')[0];
        sqlRet += " AND fecha_retiro >= '" + desde2 + "'";
      } else {
        sqlRet += " AND fecha_retiro >= date('now','-12 months')";
      }
      sqlRet += " GROUP BY mes ORDER BY mes";
      const retiradosMeses = db.prepare(sqlRet).all();

      // Installations this month for "+X este mes"
      const ultimoMesRow = db.prepare("SELECT COUNT(*) as total FROM servicios WHERE strftime('%Y-%m', fecha_activacion) = " + mesSQL).get();
      const ultimoMes = ultimoMesRow ? ultimoMesRow.total : 0;

      // ⏰ AUTO-EXPIRAR PROMESAS al cargar Dashboard
      data._promAutoMsg = '';
      try {
        var fechaStrAuto = sd.current_date_only;
        var horaStrAuto = sd.current_time || '12:00';
        var fechaTimeStrAuto = fechaStrAuto + ' ' + horaStrAuto + ':00';
        var fechaRefAuto = "'" + fechaTimeStrAuto + "'";

        var promVencidas = db.prepare(`
          SELECT pp.id, pp.servicio_ids FROM promesas_pago pp
          WHERE pp.estado='activa'
            AND (pp.fecha_limite || ' 12:00:00') < ` + fechaRefAuto + `
        `).all();

        if (promVencidas.length > 0) {
          var susps = 0;
          promVencidas.forEach(function(p) {
            try {
              var raw = (p.servicio_ids || '').toString().trim();
              var svcIds = [];
              if (raw.startsWith('[')) {
                try { svcIds = JSON.parse(raw); } catch(e) {}
              } else if (raw) {
                svcIds = raw.split(',').map(function(s) { return parseInt(s.trim()); }).filter(function(n) { return !isNaN(n) && n > 0; });
              }
              svcIds.forEach(function(sid) {
                db.prepare("UPDATE servicios SET estado='suspendido' WHERE id=? AND estado='activo'").run(sid);
                susps++;
              });
              db.prepare("UPDATE promesas_pago SET estado='vencida' WHERE id=?").run(p.id);
            } catch(e) {}
          });
          var msgAuto = promVencidas.length + ' promesa(s) vencida(s) auto-expirada(s), ' + susps + ' servicio(s) suspendido(s)';
          data._promAutoMsg = msgAuto;
          console.log('[Dashboard] ' + msgAuto);
        }
      } catch(e) {
        console.log('[Dashboard] Error auto-expiracion:', e.message);
      }

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
          html += '<td style="padding:10px 8px;font-size:0.8rem;color:#475569;">' + escapeHtml(cliente.zona_nombre || '-') + '</td>';
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
                  var headers = { 'X-Token': onu.smartolt_api_key, 'Content-Type': 'application/json' };
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
                    var headers = { 'X-Token': onu.smartolt_api_key, 'Content-Type': 'application/json' };
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
          var result = db.prepare(`UPDATE servicios SET estado='activo' WHERE cliente_id=? AND estado='suspendido'`).run(clientId);
          // Solo enviar notificación si realmente se reactivó al menos un servicio
          if (result.changes > 0) {
            (async function() {
              try {
                var svcs = db.prepare('SELECT id FROM servicios WHERE cliente_id=? AND estado=?').all(clientId, 'activo');
                svcs.forEach(function(s) { sendReactivationNotification(clientId, s.id, null); });
              } catch(e) {}
            })();
          }
        }

        // Enviar confirmación de pago
        (async function() {
          try { sendPaymentConfirmation(clientId, montoPagar, metodo, paymentIds.length > 0 ? paymentIds[0].factura_id : null); } catch(e) {}
        })();

        // Si el cliente tiene promesa activa, se marca como cumplida
        var promAct = db.prepare("SELECT id FROM promesas_pago WHERE cliente_id=? AND estado='activa' LIMIT 1").get(clientId);
        if (promAct) {
          db.prepare("UPDATE promesas_pago SET estado='cumplida' WHERE id=?").run(promAct.id);
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
          var result2 = db.prepare(`UPDATE servicios SET estado='activo' WHERE cliente_id=? AND estado='suspendido'`).run(clientId);
          // Solo enviar notificación si realmente se reactivó al menos un servicio
          if (result2.changes > 0) {
            (async function() {
              try {
                var svcs = db.prepare('SELECT id FROM servicios WHERE cliente_id=? AND estado=?').all(clientId, 'activo');
                svcs.forEach(function(s) { sendReactivationNotification(clientId, s.id, null); });
              } catch(e) {}
            })();
          }
        }

        // Enviar confirmación de pago
        (async function() {
          try { sendPaymentConfirmation(clientId, montoPagar, metodo, paymentIds.length > 0 ? paymentIds[0].factura_id : null); } catch(e) {}
        })();

        // Si el cliente tiene promesa activa, se marca como cumplida
        var promAct2 = db.prepare("SELECT id FROM promesas_pago WHERE cliente_id=? AND estado='activa' LIMIT 1").get(clientId);
        if (promAct2) {
          db.prepare("UPDATE promesas_pago SET estado='cumplida' WHERE id=?").run(promAct2.id);
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

        const totalRow = db.prepare(`SELECT COUNT(*) as total FROM pagos p LEFT JOIN clientes c ON c.id=p.cliente_id ${where}`).get(...params);
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
    case 'GPONManager': {
      data.clientes = db.prepare("SELECT id, nombre, cedula, telefono FROM clientes WHERE estado='activo' ORDER BY nombre ASC").all();
      data.olts = db.prepare('SELECT id, nombre, olt_ip, olt_port, olt_username, socks_host FROM olts ORDER BY id').all();
      break;
    }
    case 'SmartoltConfigured': {
      data.onus = db.prepare('SELECT o.*, c.nombre as cliente_nombre FROM onu o LEFT JOIN clientes c ON c.id=o.cliente_id ORDER BY o.created_at DESC').all();
      data.olts = db.prepare('SELECT id, nombre FROM olts').all();
      data.clientes = db.prepare("SELECT id, nombre FROM clientes WHERE estado='activo' ORDER BY nombre").all();
      data.token = 'ispt-' + Date.now();
      break;
    }
    case 'SmartoltUnconfigured': {
      data.dbOnus = db.prepare('SELECT o.*, c.nombre as cliente_nombre FROM onu o LEFT JOIN clientes c ON c.id=o.cliente_id WHERE o.cliente_id IS NULL ORDER BY o.created_at DESC').all();
      data.clientes = db.prepare("SELECT id, nombre FROM clientes WHERE estado='activo' ORDER BY nombre").all();
      data.token = 'ispt-' + Date.now();
      break;
    }
    case 'SmartoltLocations': {
      data.zonas = db.prepare('SELECT z.*, (SELECT COUNT(*) FROM servicios s WHERE s.zona_id=z.id) as servicios_count FROM zonas z ORDER BY z.nombre').all();
      data.cajas = db.prepare('SELECT cn.*, z.nombre as zona_nombre FROM cajas_nap cn LEFT JOIN zonas z ON z.id=cn.zona_id ORDER BY cn.nombre').all();
      break;
    }
    case 'SmartoltOnuTypes': {
      data.onuTypes = db.prepare("SELECT key, value FROM configuracion WHERE key LIKE 'onu_type_%' ORDER BY key").all();
      break;
    }
    case 'SmartoltSpeedProfiles': {
      data.planes = db.prepare('SELECT * FROM planes ORDER BY nombre').all();
      break;
    }
    case 'SmartoltSettings': {
      data.olts = db.prepare('SELECT * FROM olts ORDER BY id').all();
      data.routers = db.prepare('SELECT * FROM routers ORDER BY name').all();
      break;
    }
    case 'SmartoltDashboard': {
      // Obtener la primera OLT con SmartOLT configurado
      var smartOlt = db.prepare("SELECT smartolt_subdomain, smartolt_api_key FROM olts WHERE smartolt_subdomain IS NOT NULL AND smartolt_subdomain != '' AND smartolt_enabled=1 LIMIT 1").get();
      data.smartoltUrl = smartOlt ? ('https://' + smartOlt.smartolt_subdomain + '.smartolt.com') : 'https://app.smartolt.com';
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

        const totalRow = db.prepare('SELECT COUNT(*) as count FROM inventario i ' + whereClause).get(...params);
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
    case 'InventarioAPI': {
      var invAction = req.query.action || (req.body.action || '');

      // Utility: log inventory movement
      function invLogMov(invId, tipo, cantidad, tecId, tecNombre, cliServ, detalle, ofiDest) {
        try {
          db.prepare('INSERT INTO inventario_movimientos (inventario_id, tipo, cantidad, tecnico_id, tecnico_nombre, cliente_servicio, detalle, oficina_destino) VALUES (?,?,?,?,?,?,?,?)').run(invId, tipo, cantidad||0, tecId||null, tecNombre||null, cliServ||null, detalle||null, ofiDest||null);
        } catch(e) {}
      }

      // ===== GET ALL DATA =====
      if (invAction === 'getAll' || invAction === 'getData') {
        // Get inventory items (sin asignar)
        var items = db.prepare("SELECT i.*, COALESCE(i.oficina,'General') as oficina FROM inventario i WHERE i.asignado_a IS NULL AND (i.razon_devolucion IS NULL OR i.razon_devolucion = '') ORDER BY i.id DESC").all();

        // Get assigned items
        var asignados = db.prepare("SELECT i.*, COALESCE(i.oficina,'General') as oficina FROM inventario i WHERE i.asignado_a IS NOT NULL AND (i.razon_devolucion IS NULL OR i.razon_devolucion = '') ORDER BY i.fecha_asignacion DESC").all();

        // Get returned items
        var devueltos = db.prepare("SELECT i.*, COALESCE(i.oficina,'General') as oficina FROM inventario i WHERE i.razon_devolucion IS NOT NULL AND i.razon_devolucion != '' ORDER BY i.fecha_devolucion DESC").all();

        // Get personal
        var personal = db.prepare('SELECT nombre FROM inventario_personal ORDER BY nombre').all().map(function(x) { return x.nombre; });

        // Get offices
        var oficinas = db.prepare('SELECT nombre FROM inventario_oficinas ORDER BY nombre').all().map(function(x) { return x.nombre; });

        // Get categories summary for dashboard
        var categoriasResumen = db.prepare("SELECT i.categoria, COUNT(*) as total, SUM(CASE WHEN i.asignado_a IS NULL AND (i.razon_devolucion IS NULL OR i.razon_devolucion = '') THEN 1 ELSE 0 END) as disponibles, COALESCE(i.oficina,'General') as oficina FROM inventario i WHERE i.categoria IS NOT NULL AND i.categoria != '' GROUP BY i.categoria, i.oficina").all();

        // Get tech assignment stats for chart (7 days)
        var graficaTecnicos = db.prepare("SELECT i.asignado_a as persona, COUNT(*) as total FROM inventario i WHERE i.asignado_a IS NOT NULL AND i.fecha_asignacion >= datetime('now','-7 days') GROUP BY i.asignado_a ORDER BY total DESC").all();

        // Get history
        var historial = db.prepare('SELECT im.*, i.codigo, i.nombre as nombre_articulo FROM inventario_movimientos im LEFT JOIN inventario i ON i.id=im.inventario_id ORDER BY im.id DESC LIMIT 200').all();

        // Format history dates
        historial = historial.map(function(h) {
          var d = h.created_at ? new Date(h.created_at+'Z') : null;
          var fechaFmt = d ? d.getDate()+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear() : '';
          var actionLabel = '';
          if (h.tipo === 'asignacion') actionLabel = 'Asignado a '+(h.tecnico_nombre||'')+(h.cliente_servicio ? ' / '+h.cliente_servicio : '');
          else if (h.tipo === 'devolucion') actionLabel = 'Devuelto'+(h.detalle ? ': '+h.detalle : '');
          else if (h.tipo === 'movimiento') actionLabel = 'Movido a '+(h.oficina_destino||'General');
          else if (h.tipo === 'entrada') actionLabel = 'Entrada x'+h.cantidad;
          else if (h.tipo === 'reingreso') actionLabel = 'Reingresado';
          else actionLabel = h.tipo || '-';
          var tec = h.tecnico_nombre || '';
          return { fecha: h.created_at ? h.created_at.split(' ')[0] : '', fecha_fmt: fechaFmt, accion: actionLabel, codigo: h.codigo||'', nombre_articulo: h.nombre_articulo||'', tecnico: tec };
        });

        // Get config
        var config = {};
        var configRows = db.prepare("SELECT key, value FROM configuracion WHERE key LIKE 'inv_%'").all();
        configRows.forEach(function(r) {
          try { config[r.key.replace('inv_','')] = JSON.parse(r.value); } catch(e) { config[r.key.replace('inv_','')] = r.value; }
        });

        return res.json({
          success: true,
          items: items,
          asignados: asignados,
          devoluciones: devueltos,
          historial: historial,
          personal: personal,
          oficinas: oficinas,
          categorias_resumen: categoriasResumen,
          grafica_tecnicos: graficaTecnicos,
          config: config
        });
      }

      // ===== GET PAGINATED INVENTORY =====
      if (invAction === 'getInventarioPaginado') {
        var invPag = parseInt(req.body.pagina) || 1;
        var invPP = 30;
        var invOff = (invPag - 1) * invPP;
        var invFil = req.body.filtro || 'unassigned';
        var invBusq = (req.body.busqueda || '').trim();
        var invCat = req.body.categoria || '';
        var invOfi = req.body.oficina || '';
        var invFecFil = req.body.fecha_filtro || '';

        var invW = [];
        var invP = [];

        if (invFil === 'returned') {
          invW.push("i.razon_devolucion IS NOT NULL AND i.razon_devolucion != ''");
        } else if (invFil === 'assigned') {
          invW.push("i.asignado_a IS NOT NULL AND (i.razon_devolucion IS NULL OR i.razon_devolucion = '')");
        } else {
          invW.push("i.asignado_a IS NULL AND (i.razon_devolucion IS NULL OR i.razon_devolucion = '')");
        }

        if (invBusq) {
          invW.push('(i.nombre LIKE ? OR i.codigo LIKE ? OR i.serial LIKE ?)');
          var invLK = '%' + invBusq + '%';
          invP.push(invLK, invLK, invLK);
        }
        if (invCat && invCat !== 'total') {
          invW.push('i.categoria = ?');
          invP.push(invCat);
        }
        if (invOfi && invOfi !== 'total') {
          invW.push("COALESCE(i.oficina,'General') = ?");
          invP.push(invOfi);
        }
        if (invFecFil) {
          invW.push("date(i.created_at) = ?");
          invP.push(invFecFil);
        }

        var invWC = invW.length > 0 ? 'WHERE ' + invW.join(' AND ') : '';

        var invTR = db.prepare('SELECT COUNT(*) as cnt FROM inventario i ' + invWC).get(...invP);
        var invTot = invTR ? invTR.cnt : 0;
        var invPags = Math.max(1, Math.ceil(invTot / invPP));

        var invItms = db.prepare('SELECT i.*, COALESCE(i.oficina,\'General\') as oficina FROM inventario i ' + invWC + ' ORDER BY i.id DESC LIMIT ? OFFSET ?').all(...invP.concat([invPP, invOff]));

        return res.json({ success: true, items: invItms, total_items: invTot, paginas: invPags, pagina_actual: invPag });
      }

      // ===== REGISTER ITEMS =====
      if (invAction === 'registerItem' || invAction === 'registrarArticulo') {
        var items = req.body.items;
        var cantidad = parseInt(req.body.cantidad) || 1;
        var nombre = (req.body.nombre || '').trim();
        var categoria = (req.body.categoria || '').trim();
        var oficina = (req.body.oficina || '').trim();
        var esVenta = req.body.es_venta || 0;
        var precioVenta = parseFloat(req.body.precio_venta) || 0;

        if (!nombre || !categoria) {
          return res.json({ success: false, message: 'Nombre y categoría son obligatorios' });
        }

        if (items && Array.isArray(items)) {
          items.forEach(function(it) {
            var codigo = (it.codigo || '').trim() || Math.floor(Math.random()*100000000).toString();
            var serial = (it.serial || '').trim();
            try {
              db.prepare('INSERT INTO inventario (codigo, nombre, categoria, stock, precio, es_venta, oficina, serial, precio_venta) VALUES (?,?,?,1,?,?,?,?,?)').run(codigo, nombre, categoria, precioVenta, esVenta, oficina||null, serial||null, precioVenta);
            } catch(e) {
              // If code exists, retry with random code
              if (e.message && e.message.indexOf('UNIQUE') >= 0) {
                codigo = Math.floor(Math.random()*100000000).toString();
                db.prepare('INSERT INTO inventario (codigo, nombre, categoria, stock, precio, es_venta, oficina, serial, precio_venta) VALUES (?,?,?,1,?,?,?,?,?)').run(codigo, nombre, categoria, precioVenta, esVenta, oficina||null, serial||null, precioVenta);
              }
            }
          });
          return res.json({ success: true, message: cantidad + ' artículo(s) registrado(s)', items: items });
        } else {
          // Legacy single item
          var codigo = Math.floor(Math.random()*100000000).toString();
          db.prepare('INSERT INTO inventario (codigo, nombre, categoria, stock, precio, es_venta, oficina, precio_venta) VALUES (?,?,?,1,?,?,?,?)').run(codigo, nombre, categoria, precioVenta, esVenta, oficina||null, precioVenta);
          return res.json({ success: true, message: 'Artículo registrado', codigo: codigo });
        }
      }

      // ===== ASSIGN ITEM =====
      if (invAction === 'assignItem' || invAction === 'asignarArticulo') {
        var codigo = (req.body.codigo || '').trim().toUpperCase();
        var persona = (req.body.persona || '').trim();
        var uso = (req.body.uso || req.body.asignado_uso || '').trim();
        var cliente = (req.body.cliente || req.body.asignado_cliente || '').trim();

        if (!codigo || !persona || !uso) {
          return res.json({ success: false, message: 'Código, técnico y uso son obligatorios' });
        }

        var item = db.prepare('SELECT * FROM inventario WHERE codigo=?').get(codigo);
        if (!item) {
          return res.json({ success: false, message: 'Artículo no encontrado' });
        }

        db.prepare('UPDATE inventario SET asignado_a=?, asignado_uso=?, asignado_cliente=?, fecha_asignacion=datetime("now"), stock=0 WHERE codigo=?').run(persona, uso, cliente||null, codigo);

        // Log movement
        invLogMov(item.id, 'asignacion', 1, null, persona, cliente, 'Uso: '+uso, null);

        // Save to personal table if new
        try { db.prepare('INSERT OR IGNORE INTO inventario_personal (nombre) VALUES (?)').run(persona); } catch(e) {}

        return res.json({ success: true, message: 'Asignado a ' + persona });
      }

      // ===== RETURN ITEM =====
      if (invAction === 'returnItem' || invAction === 'devolverArticulo') {
        var codigo = (req.body.codigo || '').trim().toUpperCase();
        var clienteLugar = (req.body.cliente || req.body.clienteLugar || req.body.asignado_cliente || '').trim();
        var oficina = (req.body.oficina || '').trim();
        var razon = (req.body.razon || req.body.razon_devolucion || '').trim();
        var tipoFalla = (req.body.tipoFalla || req.body.tipo_falla || '').trim();
        var categoria = (req.body.categoria || '').trim();

        if (!codigo) {
          return res.json({ success: false, message: 'Código requerido' });
        }

        var item = db.prepare('SELECT * FROM inventario WHERE codigo=?').get(codigo);
        if (!item) {
          return res.json({ success: false, message: 'Artículo no encontrado' });
        }

        var detalle = 'Devuelto / ' + (razon || 'Retiro');
        if (tipoFalla) detalle += ' | Falla: ' + tipoFalla;

        db.prepare('UPDATE inventario SET razon_devolucion=?, tipo_falla=?, cliente_lugar=?, oficina=?, fecha_devolucion=datetime("now"), asignado_a=NULL, asignado_uso=?, asignado_cliente=?, stock=-1 WHERE codigo=?').run(detalle, tipoFalla||null, clienteLugar||null, oficina||null, detalle, clienteLugar||null, codigo);

        // Log movement
        invLogMov(item.id, 'devolucion', 0, null, null, clienteLugar, detalle, oficina);

        return res.json({ success: true, message: 'Devolución registrada' });
      }

      // ===== REUTILIZAR (RE-ENTER INVENTORY) =====
      if (invAction === 'reutilizarArticulo') {
        var codigo = (req.body.codigo || '').trim().toUpperCase();
        var nombre = (req.body.nombre || '').trim();
        var categoria = (req.body.categoria || '').trim();
        var oficina = (req.body.oficina || '').trim();

        if (!codigo) {
          return res.json({ success: false, message: 'Código requerido' });
        }

        var item = db.prepare('SELECT * FROM inventario WHERE codigo=?').get(codigo);
        if (!item) {
          return res.json({ success: false, message: 'Artículo no encontrado' });
        }

        // Reset item - mark as available again
        db.prepare('UPDATE inventario SET asignado_a=NULL, asignado_uso=NULL, asignado_cliente=NULL, fecha_asignacion=NULL, razon_devolucion=NULL, tipo_falla=NULL, cliente_lugar=NULL, fecha_devolucion=NULL, stock=1, oficina=? WHERE codigo=?').run(oficina||null, codigo);

        // Log movement
        invLogMov(item.id, 'reingreso', 1, null, null, null, 'Reingresado al inventario', oficina);

        return res.json({ success: true, message: 'Artículo reingresado' });
      }

      // ===== MOVE ITEM =====
      if (invAction === 'moveItem' || invAction === 'moverArticuloOficina') {
        var codigo = (req.body.codigo || '').trim().toUpperCase();
        var nuevaOficina = (req.body.nueva_oficina || '').trim();

        if (!codigo) {
          return res.json({ success: false, message: 'Código requerido' });
        }

        var item = db.prepare('SELECT * FROM inventario WHERE codigo=?').get(codigo);
        if (!item) {
          return res.json({ success: false, message: 'Artículo no encontrado' });
        }

        var oldOficina = item.oficina || 'General';
        db.prepare('UPDATE inventario SET oficina=? WHERE codigo=?').run(nuevaOficina||null, codigo);

        // Log movement
        invLogMov(item.id, 'movimiento', 0, null, null, null, 'De ' + oldOficina + ' a ' + (nuevaOficina || 'General'), nuevaOficina);

        return res.json({ success: true, message: 'Movido a ' + (nuevaOficina || 'General') });
      }

      // ===== DELETE ITEM =====
      if (invAction === 'deleteItem' || invAction === 'eliminarArticulo') {
        var codigo = (req.body.codigo || '').trim().toUpperCase();

        if (!codigo) {
          return res.json({ success: false, message: 'Código requerido' });
        }

        var item = db.prepare('SELECT * FROM inventario WHERE codigo=?').get(codigo);
        if (!item) {
          return res.json({ success: false, message: 'Artículo no encontrado' });
        }

        db.prepare('DELETE FROM inventario WHERE codigo=?').run(codigo);
        return res.json({ success: true, message: 'Eliminado' });
      }

      // ===== UPDATE PRICE =====
      if (invAction === 'updatePrice' || invAction === 'actualizarPrecio') {
        var codigo = (req.body.codigo || '').trim().toUpperCase();
        var precioVenta = parseFloat(req.body.precio_venta) || 0;

        if (!codigo) {
          return res.json({ success: false, message: 'Código requerido' });
        }

        db.prepare('UPDATE inventario SET precio_venta=?, es_venta=? WHERE codigo=?').run(precioVenta, precioVenta > 0 ? 1 : 0, codigo);
        return res.json({ success: true, message: 'Precio actualizado' });
      }

      // ===== SEARCH CLIENTS =====
      if (invAction === 'searchClients') {
        var term = (req.body.term || '').trim();
        if (!term || term.length < 2) {
          return res.json({ success: true, results: [] });
        }

        var like = '%' + term + '%';
        var clients = db.prepare('SELECT id, nombre, cedula, telefono, direccion FROM clientes WHERE nombre LIKE ? OR cedula LIKE ? OR telefono LIKE ? OR direccion LIKE ? LIMIT 15').all(like, like, like, like);
        var orders = db.prepare('SELECT o.id, c.nombre as cliente_nombre, o.direccion_instalacion FROM ordenes o JOIN clientes c ON c.id=o.cliente_id WHERE o.direccion_instalacion LIKE ? OR c.nombre LIKE ? LIMIT 10').all(like, like);

        var results = [];
        clients.forEach(function(c) {
          var detail = [];
          if (c.cedula) detail.push('Cédula: ' + c.cedula);
          if (c.telefono) detail.push('Tel: ' + c.telefono);
          results.push({ name: c.nombre, tipo: 'Cliente', detail: detail.join(' | ') });
        });
        orders.forEach(function(o) {
          results.push({ name: (o.cliente_nombre || '') + ' - Orden #' + o.id, tipo: 'Orden', detail: o.direccion_instalacion || '' });
        });

        return res.json({ success: true, results: results });
      }

      // ===== GET REPORTS =====
      if (invAction === 'getReports' || invAction === 'getArticulosPorTecnico') {
        var tecnico = (req.body.tecnico || '').trim();
        var rango = req.body.rango || 'todo';

        if (!tecnico) {
          return res.json([]);
        }

        var dateFilter = '';
        if (rango === 'today') dateFilter = " AND date(i.fecha_asignacion) = date('now')";
        else if (rango === '7d') dateFilter = " AND i.fecha_asignacion >= datetime('now','-7 days')";
        else if (rango === '30d') dateFilter = " AND i.fecha_asignacion >= datetime('now','-30 days')";

        var items = db.prepare('SELECT i.codigo, i.nombre, i.categoria, i.fecha_asignacion as fecha FROM inventario i WHERE i.asignado_a=? ' + dateFilter + ' ORDER BY i.fecha_asignacion DESC').all(tecnico);

        if (req.body.accion === 'getReports') {
          return res.json({ success: true, data: items });
        }
        return res.json(items);
      }

      // ===== SAVE CONFIG =====
      if (invAction === 'saveConfig' || invAction === 'guardarConfig') {
        var clave = req.body.clave || '';
        var valor = req.body.valor;

        if (!clave) {
          return res.json({ success: false, message: 'Clave requerida' });
        }

        var strVal = typeof valor === 'object' ? JSON.stringify(valor) : String(valor);
        try {
          db.prepare("INSERT OR REPLACE INTO configuracion (key, value) VALUES (?,?)").run('inv_' + clave, strVal);
        } catch(e) {
          return res.json({ success: false, message: 'Error guardando: ' + e.message });
        }

        return res.json({ success: true, message: 'Configuración guardada' });
      }

      // ===== SAVE/SAVE ALERT =====
      if (invAction === 'saveAlert' || invAction === 'guardarAlerta') {
        var categoria = (req.body.categoria || '').trim();
        var minimo = parseInt(req.body.minimo) || 5;

        if (!categoria) {
          return res.json({ success: false, message: 'Categoría requerida' });
        }

        try {
          var existing = db.prepare('SELECT id FROM inventario_alertas WHERE categoria=?').get(categoria);
          if (existing) {
            db.prepare('UPDATE inventario_alertas SET minimo=? WHERE id=?').run(minimo, existing.id);
          } else {
            db.prepare('INSERT INTO inventario_alertas (categoria, minimo) VALUES (?,?)').run(categoria, minimo);
          }
          return res.json({ success: true, message: 'Alerta guardada' });
        } catch(e) {
          return res.json({ success: false, message: 'Error: ' + e.message });
        }
      }

      // ===== STAFF MANAGEMENT =====
      if (invAction === 'saveStaff' || invAction === 'gestionPersonal') {
        var subAction = req.body.subAction || (req.body.accion || '');
        var nombre = (req.body.nombre || '').trim();

        if (!nombre) {
          return res.json({ success: false, message: 'Nombre requerido' });
        }

        try {
          if (subAction === 'add') {
            db.prepare('INSERT OR IGNORE INTO inventario_personal (nombre) VALUES (?)').run(nombre);
          } else if (subAction === 'del') {
            db.prepare('DELETE FROM inventario_personal WHERE nombre=?').run(nombre);
          }
          return res.json({ success: true });
        } catch(e) {
          return res.json({ success: false, message: 'Error: ' + e.message });
        }
      }

      if (invAction === 'deleteStaff') {
        var nombre = (req.body.nombre || '').trim();
        try {
          db.prepare('DELETE FROM inventario_personal WHERE nombre=?').run(nombre);
          return res.json({ success: true });
        } catch(e) {
          return res.json({ success: false, message: e.message });
        }
      }

      // ===== OFFICE MANAGEMENT =====
      if (invAction === 'saveOffice' || invAction === 'gestionOficinas') {
        var subAction = req.body.subAction || (req.body.accion || '');
        var nombre = (req.body.nombre || '').trim();

        if (!nombre) {
          return res.json({ success: false, message: 'Nombre requerido' });
        }

        try {
          if (subAction === 'add') {
            db.prepare('INSERT OR IGNORE INTO inventario_oficinas (nombre) VALUES (?)').run(nombre);
          } else if (subAction === 'del') {
            db.prepare('DELETE FROM inventario_oficinas WHERE nombre=?').run(nombre);
          }
          return res.json({ success: true });
        } catch(e) {
          return res.json({ success: false, message: 'Error: ' + e.message });
        }
      }

      if (invAction === 'deleteOffice') {
        var nombre = (req.body.nombre || '').trim();
        try {
          db.prepare('DELETE FROM inventario_oficinas WHERE nombre=?').run(nombre);
          return res.json({ success: true });
        } catch(e) {
          return res.json({ success: false, message: e.message });
        }
      }

      // ===== PRINT LABEL =====
      if (invAction === 'printLabel') {
        var codigo = (req.body.codigo || '').trim();
        var item = db.prepare('SELECT * FROM inventario WHERE codigo=?').get(codigo);
        if (!item) {
          return res.json({ success: false, message: 'No encontrado' });
        }
        return res.json({ success: true, item: item });
      }

      // ===== TEST EMAIL =====
      if (invAction === 'testSMTP') {
        var config = req.body.config;
        if (!config || !config.host || !config.user) {
          return res.json({ success: false, message: 'Configuración SMTP incompleta' });
        }
        // Asynchronously attempt to send test email
        (async function() {
          try {
            var nodemailer = require('nodemailer');
            var transporter = nodemailer.createTransport({
              host: config.host,
              port: parseInt(config.port) || 587,
              secure: config.tls ? true : false,
              auth: { user: config.user, pass: config.pass || '' }
            });
            await transporter.sendMail({
              from: config.from || config.user,
              to: config.receiver || config.user,
              subject: 'Prueba SMTP - ISP Total Inventario',
              text: 'Esta es una prueba de configuración SMTP desde el módulo de Inventario.'
            });
          } catch(e) {
            console.log('[Inventario] Test SMTP error:', e.message);
          }
        })();
        return res.json({ success: true, message: 'Correo enviado (si la config es correcta)' });
      }

      // ===== TEST MESSAGE =====
      if (invAction === 'testMensaje') {
        var phone = (req.body.phone || '').trim();
        if (!phone) {
          return res.json({ success: false, message: 'Teléfono requerido' });
        }
        (async function() {
          try {
            var openwa = require('./openwa-service');
            var result = await openwa.sendMessage(phone, 'Mensaje de prueba desde el módulo de Inventario.');
            if (result && result.success) {
              console.log('[Inventario] Mensaje de prueba enviado a', phone);
            }
          } catch(e) {
            console.log('[Inventario] Test message error:', e.message);
          }
        })();
        return res.json({ success: true, message: 'Mensaje encolado' });
      }

      // Unknown action
      return res.json({ success: false, message: 'Acción no reconocida: ' + invAction });
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

        const countRow = db.prepare(`SELECT COUNT(*) as total FROM ventas v ${where}`).get(...params);
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
    case 'ImprimirRecibo': {
      const ajax = req.query.ajax;
      if (ajax === 'print') {
        var ids = (req.query.ids || '').split(',').filter(Boolean).map(Number);
        if (ids.length === 0) return res.status(400).send('IDs requeridos');
        var pago = db.prepare('SELECT p.*, c.nombre as cliente_nombre FROM pagos p LEFT JOIN clientes c ON c.id=p.cliente_id WHERE p.id=?').get(ids[0]);
        if (!pago) return res.status(404).send('Pago no encontrado');
        var servicio = db.prepare('SELECT p.nombre as plan_nombre FROM servicios s LEFT JOIN planes p ON p.id=s.plan_id WHERE s.id=?').get(pago.servicio_id);
        data.recibo_id = ids.join('/');
        data.cliente_nombre = pago.cliente_nombre || '';
        data.monto = parseFloat(pago.monto) || 0;
        data.metodo_pago = pago.metodo || 'EFECTIVO';
        data.transaccion = pago.transaccion || '';
        data.plan_nombre = servicio ? servicio.plan_nombre : '';
        data.empresa_nombre = (db.prepare("SELECT value FROM configuracion WHERE key='empresa_nombre'").get() || {}).value || '';
        data.empresa_telefono = (db.prepare("SELECT value FROM configuracion WHERE key='empresa_telefono'").get() || {}).value || '';
        data.empresa_direccion = (db.prepare("SELECT value FROM configuracion WHERE key='empresa_direccion'").get() || {}).value || '';
        data.pagina = 'ImprimirRecibo';
        res.render('pages/ImprimirRecibo', data);
        return;
      }
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
            SELECT * FROM (
              SELECT p.id, p.nombre as name, p.rnc, p.telefono,
              (SELECT COUNT(*) FROM facturas_compra WHERE proveedor_id=p.id AND pagado < monto) as pending_count,
              (SELECT COALESCE(SUM(monto - pagado),0) FROM facturas_compra WHERE proveedor_id=p.id AND pagado < monto) as pending_debt
              FROM proveedores p
            ) sub
            WHERE pending_count > 0
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
          INSERT INTO gastos (concepto, monto, metodo, referencia, notas, tipo, usuario_id, categoria, payment_date)
          VALUES (?,?,?,?,?,'proveedor',?,'Proveedores',date('now'))
        `).run('Pago a proveedor #' + invId + ' - ' + (inv.concept || ''), amount, method, reference, notes, req.session.user.id);

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
      const zonas = db.prepare('SELECT * FROM zonas ORDER BY nombre').all();
      data.periodos = db.prepare("SELECT DISTINCT m, a FROM (SELECT strftime('%m',created_at) as m, strftime('%Y',created_at) as a FROM pagos UNION SELECT strftime('%m',created_at), strftime('%Y',created_at) FROM gastos UNION SELECT strftime('%m',fecha_activacion), strftime('%Y',fecha_activacion) FROM servicios WHERE fecha_activacion IS NOT NULL) ORDER BY a DESC, m DESC").all();
      data.anios = [...new Set(data.periodos.map(function(p){return p.a;}))].sort().reverse();
      data.zonas = zonas;

      // ===================== get_stats =====================
      if (ajax === 'get_stats') {
        const mes = parseInt(req.query.mes) || new Date().getMonth() + 1;
        const anio = parseInt(req.query.anio) || new Date().getFullYear();
        const zona = parseInt(req.query.zona) || 0;
        const modo = req.query.modo || req.query.mode || 'finanzas';
        const rango = req.query.rango || 'mes';

        let fechaWhere = '';
        let fechaParams = [];
        if (rango === 'dia') {
          fechaWhere = " AND date(p.created_at)=date('now')";
        } else if (rango === 'semana') {
          fechaWhere = " AND p.created_at >= datetime('now', '-7 days')";
        } else if (rango === 'mes') {
          if (mes > 0 && anio > 0) {
            var ms = String(mes).padStart(2,'0');
            fechaWhere = " AND strftime('%Y-%m', p.created_at)=?";
            fechaParams.push(anio+'-'+ms);
          } else {
            fechaWhere = " AND strftime('%Y-%m', p.created_at)=strftime('%Y-%m','now')";
          }
        } else if (rango === 'anio') {
          fechaWhere = " AND strftime('%Y', p.created_at)=?";
          fechaParams.push(String(anio));
        }

        let zonaWhere = '';
        let zonaParams = [];
        if (zona > 0) {
          zonaWhere = 'AND (s.zona_id=? OR c.zona_id=?)';
          zonaParams.push(zona, zona);
        }

        // ===== MODO FINANZAS =====
        if (modo === 'finanzas') {
          var tw = 'WHERE 1=1' + fechaWhere + zonaWhere;
          var ap = fechaParams.concat(zonaParams);
          var cobradoTotal = db.prepare('SELECT COALESCE(SUM(p.monto),0) as t FROM pagos p LEFT JOIN servicios s ON s.id=p.servicio_id LEFT JOIN clientes c ON c.id=p.cliente_id ' + tw).get(...ap);
          var pendienteFechaWhere = '';
          var pendienteFechaParams = [];
          if (mes > 0 && anio > 0) {
            pendienteFechaWhere = " AND strftime('%Y-%m', f.fecha_emision)=?";
            pendienteFechaParams.push(anio+'-'+String(mes).padStart(2,'0'));
          }
          var pendienteTotal = db.prepare("SELECT COALESCE(SUM(f.monto - COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0)),0) as t FROM facturas f JOIN servicios s ON s.id=f.servicio_id WHERE f.estado='pendiente' AND f.monto > COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0)" + pendienteFechaWhere + (zona>0?' AND s.zona_id=?':'')).get(...pendienteFechaParams.concat(zona>0?[zona]:[]));
          var gastosTotal = db.prepare('SELECT COALESCE(SUM(monto),0) as t FROM gastos WHERE strftime(?,created_at)=?').get('%Y-%m', anio+'-'+String(mes).padStart(2,'0'));
          var cobradoPorMetodo = db.prepare("SELECT UPPER(p.metodo) as metodo, COALESCE(SUM(p.monto),0) as total, COUNT(*) as cantidad FROM pagos p LEFT JOIN servicios s ON s.id=p.servicio_id LEFT JOIN clientes c ON c.id=p.cliente_id " + tw + " GROUP BY UPPER(p.metodo) ORDER BY total DESC").all(...ap);
          var cobradoPorCobrador = db.prepare('SELECT u.nombre as cobrador, COALESCE(SUM(p.monto),0) as total, COUNT(*) as cantidad FROM pagos p LEFT JOIN servicios s ON s.id=p.servicio_id LEFT JOIN clientes c ON c.id=p.cliente_id LEFT JOIN usuarios u ON u.id=p.usuario_id ' + tw + (zona>0?' AND (s.zona_id=? OR c.zona_id=?)':'') + ' GROUP BY u.nombre ORDER BY total DESC').all(...ap.concat(zona>0?[zona,zona]:[]));
          var pagosPorMes = db.prepare('SELECT strftime(?,created_at) as mes, COALESCE(SUM(monto),0) as total FROM pagos WHERE strftime(?,created_at)=? GROUP BY strftime(?,created_at) ORDER BY mes').all('%Y-%m', '%Y-%m', String(anio), '%Y-%m');
          var cobradoHoy = db.prepare("SELECT COALESCE(SUM(monto),0) as t FROM pagos WHERE date(created_at)=date('now')").get().t;
          var cobradoMesActual = db.prepare("SELECT COALESCE(SUM(monto),0) as t FROM pagos WHERE strftime('%Y-%m', created_at)=strftime('%Y-%m','now')").get().t;
          var ultimosPagos = db.prepare('SELECT p.id, p.monto, p.metodo, p.created_at, c.nombre as cliente_nombre, c.id as cliente_id FROM pagos p LEFT JOIN clientes c ON c.id=p.cliente_id ORDER BY p.id DESC LIMIT 15').all();
          return res.json({
            status: 'success', modo: 'finanzas',
            success: true,
            cobradoTotal: cobradoTotal.t, pendienteTotal: pendienteTotal.t, gastosTotal: gastosTotal.t,
            cobradoHoy: cobradoHoy, cobradoMesActual: cobradoMesActual,
            cobradoPorMetodo: cobradoPorMetodo, cobradoPorCobrador: cobradoPorCobrador,
            pagosPorMes: pagosPorMes, ultimosPagos: ultimosPagos, mes: mes, anio: anio,
            finanzas: {
              total_ciclo: cobradoTotal.t + pendienteTotal.t,
              cobrado_mes: cobradoTotal.t,
              cobrado_hoy: cobradoHoy,
              pendiente_mes: pendienteTotal.t,
              total_gastos: gastosTotal.t,
              total_vencido: 0,
              gastos_desde: gastosTotal.t,
              gastos_hasta: 0,
              gastos_por_tipo: [],
              por_metodo_ciclo: cobradoPorMetodo,
              por_metodo_hoy: cobradoPorMetodo,
              por_cobrador: cobradoPorCobrador,
              por_dia: pagosPorMes,
              planes_top: []
            }
          });
        }

        // ===== MODO CLIENTES =====
        if (modo === 'clientes') {
          var czw = '';
          var czp = [];
          if (zona > 0) { czw = 'WHERE c.zona_id=?'; czp.push(zona); }
          var totalClientes = db.prepare('SELECT COUNT(*) as c FROM clientes c ' + czw).get(...czp);
          var activos = db.prepare('SELECT COUNT(*) as c FROM servicios s LEFT JOIN clientes c ON c.id=s.cliente_id WHERE s.estado=?' + (zona>0?' AND (s.zona_id=? OR c.zona_id=?)':'')).get(...['activo'].concat(zona>0?[zona,zona]:[]));
          var suspendidos = db.prepare('SELECT COUNT(*) as c FROM servicios s LEFT JOIN clientes c ON c.id=s.cliente_id WHERE s.estado=?' + (zona>0?' AND (s.zona_id=? OR c.zona_id=?)':'')).get(...['suspendido'].concat(zona>0?[zona,zona]:[]));
          var sinServicio = db.prepare('SELECT COUNT(*) as c FROM clientes c WHERE (SELECT COUNT(*) FROM servicios s WHERE s.cliente_id=c.id AND s.estado!=?) = 0' + (zona>0?' AND c.zona_id=?':'')).get(...['retirado'].concat(zona>0?[zona]:[]));
          var serviciosPorPlan = db.prepare("SELECT p.nombre as plan, p.precio, COUNT(*) as total, SUM(CASE WHEN s.estado='activo' THEN 1 ELSE 0 END) as activos, SUM(CASE WHEN s.estado='suspendido' THEN 1 ELSE 0 END) as suspendidos FROM servicios s LEFT JOIN planes p ON p.id=s.plan_id LEFT JOIN clientes c ON c.id=s.cliente_id WHERE s.plan_id IS NOT NULL" + (zona>0?' AND s.zona_id=?':'') + ' GROUP BY s.plan_id ORDER BY total DESC').all(...zona>0?[zona]:[]);
          var serviciosPorZona = db.prepare("SELECT z.nombre as zona, COUNT(*) as total, SUM(CASE WHEN s.estado='activo' THEN 1 ELSE 0 END) as activos, SUM(CASE WHEN s.estado='suspendido' THEN 1 ELSE 0 END) as suspendidos FROM servicios s LEFT JOIN zonas z ON z.id=s.zona_id LEFT JOIN clientes c ON c.id=s.cliente_id WHERE s.zona_id IS NOT NULL" + (zona>0?' AND s.zona_id=?':'') + ' GROUP BY s.zona_id ORDER BY total DESC').all(...zona>0?[zona]:[]);
          var instaladosMes = db.prepare("SELECT strftime('%Y-%m',fecha_activacion) as mes, COUNT(*) as total FROM servicios WHERE fecha_activacion IS NOT NULL AND strftime('%Y',fecha_activacion)=? GROUP BY strftime('%Y-%m',fecha_activacion) ORDER BY mes").all(String(anio));
          var instaladosAnio = db.prepare('SELECT COUNT(*) as total FROM servicios WHERE fecha_activacion IS NOT NULL AND strftime(?,fecha_activacion)=?').get('%Y', String(anio));
          var retiradosMes = db.prepare('SELECT COUNT(*) as total FROM servicios WHERE fecha_suspension IS NOT NULL AND strftime(?,fecha_suspension)=?').get('%Y-%m', String(anio)+'-'+String(mes).padStart(2,'0'));
          return res.json({
            status: 'success', modo: 'clientes',
            success: true,
            totalClientes: totalClientes.c, activos: activos.c, suspendidos: suspendidos.c, sinServicio: sinServicio.c,
            serviciosPorPlan: serviciosPorPlan, serviciosPorZona: serviciosPorZona,
            instaladosMes: instaladosMes, retiradosMes: retiradosMes?retiradosMes.total:0,
            mes: mes, anio: anio,
            clientes: {
              activos: activos.c,
              suspendidos: suspendidos.c,
              suspendidos_largos: 0,
              instalados_anio: instaladosAnio ? instaladosAnio.total : 0,
              instalados_mes: instaladosMes.length > 0 ? instaladosMes[0].total : 0,
              suspendidos_mes: 0,
              reactivados_mes: 0,
              retirados_mes: retiradosMes ? retiradosMes.total : 0,
              nuevos_mes: instaladosMes.length > 0 ? instaladosMes[0].total : 0,
              nuevos_anio: 0,
              suspended_over: 0,
              por_mes: instaladosMes,
              por_zona: serviciosPorZona.map(function(sz){return {zona_nombre: sz.zona, total: sz.activos || sz.total};}),
              top_planes: serviciosPorPlan.map(function(sp){return {plan_nombre: sp.plan, total: sp.activos || sp.total};})
            }
          });
        }
        return res.json({ success: false, message: 'Modo no especificado' });
      }

      // ===================== get_invoices_detail =====================
      if (ajax === 'get_invoices_detail') {
        const page = Math.max(1, parseInt(req.query.page)||1);
        const limit = Math.min(50, parseInt(req.query.limit)||15);
        const offset = (page-1)*limit;
        const tipo = req.query.tipo||'todas';
        const order = req.query.order||'id';
        const dir = req.query.dir==='asc'?'ASC':'DESC';
        const search = (req.query.search||'').trim();
        let where = 'WHERE 1=1';
        let params = [];
        if (tipo==='pendientes') { where += " AND f.estado='pendiente' AND f.monto > COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0)"; }
        else if (tipo==='pagadas') { where += " AND f.estado='pagada'"; }
        else if (tipo==='vencidas') { where += " AND f.estado='pendiente' AND f.monto > COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0) AND date(f.fecha_vencimiento) < date('now')"; }
        if (search) { where += ' AND (c.nombre LIKE ? OR f.periodo LIKE ?)'; params.push('%'+search+'%','%'+search+'%'); }
        var oc = 'ORDER BY f.id DESC';
        if (order==='monto') oc = 'ORDER BY f.monto '+dir;
        else if (order==='cliente') oc = 'ORDER BY c.nombre '+dir;
        else if (order==='vencimiento') oc = 'ORDER BY f.fecha_vencimiento '+dir;
        else if (order==='periodo') oc = 'ORDER BY f.periodo '+dir;
        var cr = db.prepare('SELECT COUNT(*) as total FROM facturas f LEFT JOIN servicios s ON s.id=f.servicio_id LEFT JOIN clientes c ON c.id=s.cliente_id '+where).get(...params);
        var total = cr?cr.total:0;
        var rows = db.prepare('SELECT f.id, f.servicio_id, f.periodo, f.monto, f.estado, f.fecha_emision, f.fecha_vencimiento, f.created_at, c.nombre as cliente_nombre, c.id as cliente_id, COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0) as pagado FROM facturas f LEFT JOIN servicios s ON s.id=f.servicio_id LEFT JOIN clientes c ON c.id=s.cliente_id '+where+' '+oc+' LIMIT ? OFFSET ?').all(...params.concat([limit,offset]));
        rows.forEach(function(r){
          var pg = parseFloat(r.pagado)||0;
          var mt = parseFloat(r.monto)||0;
          if (pg>=mt) { r.estado_legible='Pagada'; r.estado_class='pagada'; }
          else if (pg>0) { r.estado_legible='Parcial'; r.estado_class='parcial'; }
          else if (r.fecha_vencimiento && new Date(r.fecha_vencimiento)<new Date()) { r.estado_legible='Vencida'; r.estado_class='vencida'; }
          else { r.estado_legible='Pendiente'; r.estado_class='pendiente'; }
          r.restante = mt-pg;
        });
        return res.json({ success:true, data:rows, total:total, page:page, pages:Math.max(1,Math.ceil(total/limit)) });
      }

      // ===================== get_monthly_comparison =====================
      if (ajax === 'get_monthly_comparison') {
        const anio = req.query.anio || String(new Date().getFullYear());
        var mesesData = [];
        for (var mi = 1; mi <= 12; mi++) {
          var ms = String(mi).padStart(2,'0');
          var p = db.prepare("SELECT COALESCE(SUM(monto),0) as t FROM pagos WHERE strftime('%Y-%m', created_at)=?").get(anio+'-'+ms);
          var v = db.prepare("SELECT COALESCE(SUM(total),0) as t FROM ventas WHERE strftime('%Y-%m', created_at)=?").get(anio+'-'+ms);
          var g = db.prepare("SELECT COALESCE(SUM(monto),0) as t FROM gastos WHERE strftime('%Y-%m', created_at)=?").get(anio+'-'+ms);
          mesesData.push({
            mes: ms,
            pagos_internet: p.t,
            otros_ingresos: v.t,
            gastos: g.t,
            total: (p.t + v.t) - g.t
          });
        }
        return res.json({ status: 'success', data: mesesData, anio: anio });
      }

      // ===================== get_services_detail =====================
      if (ajax === 'get_services_detail') {
        const page = Math.max(1, parseInt(req.query.page)||1);
        const limit = Math.min(50, parseInt(req.query.limit)||15);
        const offset = (page-1)*limit;
        const estado = req.query.estado||'todos';
        const order = req.query.order||'id';
        const dir = req.query.dir==='asc'?'ASC':'DESC';
        const search = (req.query.search||'').trim();
        const zonaFiltro = parseInt(req.query.zona)||0;
        let where = 'WHERE 1=1';
        let params = [];
        if (estado && estado!=='todos') { where += ' AND s.estado=?'; params.push(estado); }
        if (zonaFiltro>0) { where += ' AND (s.zona_id=? OR c.zona_id=?)'; params.push(zonaFiltro,zonaFiltro); }
        if (search) { where += ' AND (c.nombre LIKE ? OR s.direccion LIKE ? OR s.ip LIKE ?)'; params.push('%'+search+'%','%'+search+'%','%'+search+'%'); }
        var oc = 'ORDER BY s.id DESC';
        if (order==='nombre') oc = 'ORDER BY c.nombre '+dir;
        else if (order==='plan') oc = 'ORDER BY p.nombre '+dir;
        else if (order==='zona') oc = 'ORDER BY z.nombre '+dir;
        else if (order==='estado') oc = 'ORDER BY s.estado '+dir;
        var cr = db.prepare('SELECT COUNT(*) as total FROM servicios s LEFT JOIN clientes c ON c.id=s.cliente_id LEFT JOIN planes p ON p.id=s.plan_id LEFT JOIN zonas z ON z.id=s.zona_id '+where).get(...params);
        var total = cr?cr.total:0;
        var rows = db.prepare('SELECT s.id, s.cliente_id, s.estado, s.ip, s.direccion, s.fecha_activacion, s.fecha_suspension, s.created_at, c.nombre as cliente_nombre, c.telefono, p.nombre as plan_nombre, p.precio as plan_precio, z.nombre as zona_nombre FROM servicios s LEFT JOIN clientes c ON c.id=s.cliente_id LEFT JOIN planes p ON p.id=s.plan_id LEFT JOIN zonas z ON z.id=s.zona_id '+where+' '+oc+' LIMIT ? OFFSET ?').all(...params.concat([limit,offset]));
        return res.json({ success:true, data:rows, total:total, page:page, pages:Math.max(1,Math.ceil(total/limit)) });
      }

      // ===================== print handlers =====================
      if (ajax === 'print_services') {
        var rows = db.prepare("SELECT s.id, s.estado, s.ip, s.direccion, s.fecha_activacion, c.nombre as cliente_nombre, c.cedula, c.telefono, p.nombre as plan_nombre, p.precio as plan_precio, z.nombre as zona_nombre FROM servicios s LEFT JOIN clientes c ON c.id=s.cliente_id LEFT JOIN planes p ON p.id=s.plan_id LEFT JOIN zonas z ON z.id=s.zona_id WHERE s.estado NOT IN ('retirado') ORDER BY z.nombre, c.nombre").all();
        var h = generarHTMLImpresion('Listado de Servicios', rows, 'servicios');
        res.set('Content-Type','text/html; charset=utf-8'); return res.send(h);
      }
      if (ajax === 'print_suspended') {
        var rows = db.prepare("SELECT s.id, s.estado, s.ip, s.direccion, s.fecha_suspension, c.nombre as cliente_nombre, c.cedula, c.telefono, p.nombre as plan_nombre, p.precio as plan_precio, z.nombre as zona_nombre FROM servicios s LEFT JOIN clientes c ON c.id=s.cliente_id LEFT JOIN planes p ON p.id=s.plan_id LEFT JOIN zonas z ON z.id=s.zona_id WHERE s.estado='suspendido' ORDER BY z.nombre, c.nombre").all();
        var h = generarHTMLImpresion('Listado de Suspendidos', rows, 'servicios');
        res.set('Content-Type','text/html; charset=utf-8'); return res.send(h);
      }
      if (ajax === 'print_gastos') {
        var mes = parseInt(req.query.mes)||new Date().getMonth()+1;
        var anio = parseInt(req.query.anio)||new Date().getFullYear();
        var ms = String(mes).padStart(2,'0');
        var rows = db.prepare("SELECT g.*, u.nombre as usuario_nombre FROM gastos g LEFT JOIN usuarios u ON u.id=g.usuario_id WHERE strftime('%Y-%m', g.created_at)=? ORDER BY g.created_at DESC").all(anio+'-'+ms);
        var total = rows.reduce(function(a,r){return a+parseFloat(r.monto||0);},0);
        var h = generarHTMLImpresion('Listado de Gastos - '+mesesEsp[mes-1]+' '+anio, rows, 'gastos', total);
        res.set('Content-Type','text/html; charset=utf-8'); return res.send(h);
      }
      if (ajax === 'print_cobrador') {
        var mes = parseInt(req.query.mes)||new Date().getMonth()+1;
        var anio = parseInt(req.query.anio)||new Date().getFullYear();
        var cid = parseInt(req.query.cobrador_id)||0;
        var ms = String(mes).padStart(2,'0');
        if (cid > 0) {
          var rows = db.prepare("SELECT p.*, c.nombre as cliente_nombre, u.nombre as cobrador_nombre FROM pagos p LEFT JOIN clientes c ON c.id=p.cliente_id LEFT JOIN usuarios u ON u.id=p.usuario_id WHERE p.usuario_id=? AND strftime('%Y-%m', p.created_at)=? ORDER BY p.created_at DESC").all(cid, anio+'-'+ms);
          var total = rows.reduce(function(a,r){return a+parseFloat(r.monto||0);},0);
          var cn = rows.length>0?(rows[0].cobrador_nombre||'Cobrador'):'Cobrador';
          var h = generarHTMLImpresion('Cobros de '+cn+' - '+mesesEsp[mes-1]+' '+anio, rows, 'cobrador', total);
          res.set('Content-Type','text/html; charset=utf-8'); return res.send(h);
        } else {
          var cobradores = db.prepare("SELECT u.id, u.nombre, COALESCE(SUM(p.monto),0) as total, COUNT(*) as cantidad FROM pagos p LEFT JOIN usuarios u ON u.id=p.usuario_id WHERE strftime('%Y-%m', p.created_at)=? GROUP BY u.id, u.nombre ORDER BY total DESC").all(anio+'-'+ms);
          return res.json({ success:true, data:cobradores });
        }
      }

      // ===================== Initial page load =====================
      if (!ajax) {
        data.zonas = zonas;
        data.empleados = db.prepare('SELECT * FROM empleados WHERE activo=1').all();
        data.cobradores = db.prepare('SELECT id, nombre FROM usuarios WHERE activo=1').all();
        data.totalClientes = db.prepare('SELECT COUNT(*) as c FROM clientes').get().c;
        data.activos = db.prepare("SELECT COUNT(*) as c FROM servicios WHERE estado='activo'").get().c;
        data.suspendidos = db.prepare("SELECT COUNT(*) as c FROM servicios WHERE estado='suspendido'").get().c;
        data.ingresosMes = db.prepare("SELECT COALESCE(SUM(monto),0) as t FROM pagos WHERE strftime('%Y-%m', created_at)=strftime('%Y-%m','now')").get().t;
        data.gastosMes = db.prepare("SELECT COALESCE(SUM(monto),0) as t FROM gastos WHERE strftime('%Y-%m', created_at)=strftime('%Y-%m','now')").get().t;
        data.pendienteTotal = db.prepare("SELECT COALESCE(SUM(f.monto - COALESCE((SELECT SUM(p.monto) FROM pagos p WHERE p.factura_id=f.id),0)),0) as t FROM facturas f WHERE f.estado='pendiente'").get().t;
      }
      break;
    }

// ===== Helper: generarHTMLImpresion =====
function generarHTMLImpresion(titulo, rows, tipo, total) {
  var mensEsp = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  var h = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>'+escapeHtml(titulo)+'</title>';
  h += '<style>body{font-family:monospace;font-size:11px;margin:0;padding:15px;}h2{text-align:center;margin:0 0 5px;font-size:16px;}.sub{text-align:center;font-size:10px;color:#666;margin-bottom:10px;}table{width:100%;border-collapse:collapse;}th{background:#f1f5f9;padding:6px 8px;font-size:10px;text-align:left;border:1px solid #ddd;}td{padding:5px 8px;border:1px solid #ddd;}.total{font-weight:bold;text-align:right;padding:8px;}.badge{display:inline-block;padding:1px 6px;border-radius:4px;font-size:9px;}.ba{background:#dcfce7;color:#166534;}.bs{background:#fef3c7;color:#92400e;}.bi{background:#fee2e2;color:#991b1b;}@media print{@page{margin:10mm;}body{padding:0;}}</style></head><body>';
  h += '<h2>'+escapeHtml(titulo)+'</h2><div class="sub">Generado: '+new Date().toLocaleDateString('es-DO',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})+'</div>';
  if (tipo==='servicios') {
    h += '<table><thead><tr><th>ID</th><th>Cliente</th><th>Cédula</th><th>Teléfono</th><th>Plan</th><th>Precio</th><th>Zona</th><th>Estado</th><th>Dirección</th><th>Activación</th></tr></thead><tbody>';
    rows.forEach(function(r){
      var bc='ba'; if(r.estado==='suspendido')bc='bs'; else if(r.estado==='retirado')bc='bi';
      var el=(r.estado||'').charAt(0).toUpperCase()+(r.estado||'').slice(1);
      h += '<tr><td>'+r.id+'</td><td>'+escapeHtml(r.cliente_nombre||'')+'</td><td>'+escapeHtml(r.cedula||'')+'</td><td>'+escapeHtml(r.telefono||'')+'</td><td>'+escapeHtml(r.plan_nombre||'')+'</td><td>$'+(parseFloat(r.plan_precio)||0).toFixed(2)+'</td><td>'+escapeHtml(r.zona_nombre||'')+'</td><td><span class="badge '+bc+'">'+el+'</span></td><td>'+escapeHtml(r.direccion||'')+'</td><td>'+(r.fecha_activacion||'')+'</td></tr>';
    });
    h += '</tbody></table>';
  } else if (tipo==='gastos') {
    h += '<table><thead><tr><th>ID</th><th>Concepto</th><th>Monto</th><th>Método</th><th>Categoría</th><th>Referencia</th><th>Fecha</th><th>Registrado por</th></tr></thead><tbody>';
    rows.forEach(function(r){
      h += '<tr><td>'+r.id+'</td><td>'+escapeHtml(r.concepto||'')+'</td><td>$'+(parseFloat(r.monto)||0).toFixed(2)+'</td><td>'+escapeHtml(r.metodo||'')+'</td><td>'+escapeHtml(r.categoria||'')+'</td><td>'+escapeHtml(r.referencia||'')+'</td><td>'+(r.payment_date||r.created_at||'')+'</td><td>'+escapeHtml(r.usuario_nombre||'')+'</td></tr>';
    });
    h += '</tbody></table><div class="total">Total: $'+(parseFloat(total)||0).toFixed(2)+'</div>';
  } else if (tipo==='cobrador') {
    h += '<table><thead><tr><th>ID Pago</th><th>Cliente</th><th>Monto</th><th>Método</th><th>Fecha</th></tr></thead><tbody>';
    rows.forEach(function(r){
      h += '<tr><td>'+r.id+'</td><td>'+escapeHtml(r.cliente_nombre||'')+'</td><td>$'+(parseFloat(r.monto)||0).toFixed(2)+'</td><td>'+escapeHtml(r.metodo||'')+'</td><td>'+(r.created_at||'')+'</td></tr>';
    });
    h += '</tbody></table><div class="total">Total cobrado: $'+(parseFloat(total)||0).toFixed(2)+'</div>';
  }
  h += '<script>window.print();<\/script></body></html>';
  return h;
}

var mesesEsp = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
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
      data.servicios = db.prepare('SELECT s.*, p.nombre as plan_nombre, p.precio as plan_precio, z.nombre as zona_nombre, o.sn as onu_sn, o.estado as onu_estado, o.senial as onu_senial FROM servicios s LEFT JOIN planes p ON p.id=s.plan_id LEFT JOIN zonas z ON z.id=s.zona_id LEFT JOIN onu o ON o.servicio_id=s.id WHERE s.cliente_id=? ORDER BY s.id DESC').all(cid);
      // Agregar información de deuda por servicio
      data.servicios.forEach(function(s) {
        var deuda = db.prepare("SELECT COALESCE(SUM(f.monto - COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0)),0) as total FROM facturas f WHERE f.servicio_id=? AND f.estado='pendiente'").get(s.id);
        s.deuda_total = deuda ? deuda.total : 0;
        s.al_dia = (s.deuda_total <= 0);
      });
      // Total ganado con este cliente (suma de facturas pagadas)
      var totalGanado = db.prepare("SELECT COALESCE(SUM(f.monto),0) as total FROM facturas f JOIN servicios s ON s.id=f.servicio_id WHERE s.cliente_id=? AND f.estado='pagada'").get(cid);
      data.total_ganado = totalGanado ? totalGanado.total : 0;

      // Facturas pagadas con detalle de días de atraso (desde suspend_day)
      data.facturas_pagadas = db.prepare(`
        SELECT f.id, f.servicio_id, f.periodo, f.monto, f.fecha_vencimiento,
          COALESCE((SELECT p.created_at FROM pagos p WHERE p.factura_id=f.id ORDER BY p.id ASC LIMIT 1), f.fecha_vencimiento) as fecha_pago,
          COALESCE(bc.suspend_day, 4) as suspend_day,
          COALESCE(bc.payment_day, 30) as payment_day
        FROM facturas f
        JOIN servicios s ON s.id=f.servicio_id
        LEFT JOIN billing_cycles bc ON bc.id = COALESCE(s.ciclo_id, 1)
        WHERE s.cliente_id=? AND f.estado='pagada'
        ORDER BY f.id ASC
      `).all(cid);

      // Calcular días de atraso para cada factura pagada
      data.facturas_pagadas.forEach(function(f) {
        try {
          var pagoDate = new Date(f.fecha_pago);
          var vencDate = new Date(f.fecha_vencimiento);
          var sd = f.suspend_day || 4;

          // Determinar el mes del suspend_day (siguiente mes si suspend_day <= payment_day)
          var susMonth = new Date(vencDate);
          if (sd <= (f.payment_day || 30)) {
            susMonth.setMonth(susMonth.getMonth() + 1);
          }
          susMonth.setDate(sd);

          // Días de atraso = días desde suspend_day hasta pago
          var diffDays = Math.round((pagoDate - susMonth) / (1000 * 60 * 60 * 24));
          f.dias_atraso = diffDays > 0 ? diffDays : 0;
          f.fecha_corte = susMonth.toISOString().split('T')[0];
        } catch(e) {
          f.dias_atraso = 0;
          f.fecha_corte = '';
        }
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

      // AJAX: get_invoices for VerCliente
      const ajax_vc = req.query.ajax;
      if (ajax_vc === 'get_invoices') {
        const clientId = parseInt(req.query.id) || 0;
        const serviceId = parseInt(req.query.service_id) || 0;
        if (!clientId) return res.json({ status: 'error', msg: 'Cliente requerido' });
        
        let sqlWhere = 'WHERE s.cliente_id=?';
        let params = [clientId];
        if (serviceId > 0) {
          sqlWhere += ' AND f.servicio_id=?';
          params.push(serviceId);
        }
        
        const invoices = db.prepare(`
          SELECT f.id, f.servicio_id, f.periodo, f.monto, f.estado, f.fecha_emision, f.fecha_vencimiento,
            COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0) as pagado,
            p.nombre as plan_name, s.direccion as svc_address
          FROM facturas f
          JOIN servicios s ON s.id=f.servicio_id
          LEFT JOIN planes p ON p.id=s.plan_id
          ${sqlWhere}
          ORDER BY f.id DESC
        `).all(...params);
        
        invoices.forEach(function(inv) {
          var mt = parseFloat(inv.monto) || 0;
          var pg = parseFloat(inv.pagado) || 0;
          if (pg >= mt) inv.status = 'paid';
          else if (pg > 0) inv.status = 'partial';
          else if (inv.fecha_vencimiento && new Date(inv.fecha_vencimiento) < new Date()) inv.status = 'overdue';
          else inv.status = 'pending';
          inv.total = mt;
          inv.paid_amount = pg;
          inv.due_date = inv.fecha_vencimiento;
        });
        
        return res.json({ status: 'success', data: invoices });
      }

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
        ).get(...params);
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
          if (id) {
            var svcCount = db.prepare('SELECT COUNT(*) as c FROM servicios WHERE ciclo_id=?').get(id);
            if (svcCount && svcCount.c > 0) {
              // Reasignar servicios a null antes de eliminar
              db.prepare("UPDATE servicios SET ciclo_id=NULL WHERE ciclo_id=?").run(id);
            }
            db.prepare('DELETE FROM billing_cycles WHERE id=?').run(id);
          }
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

        // Reactivar servicios suspendidos
        (async function() {
          try {
            var svcIdList = [];
            try { svcIdList = JSON.parse(svcIds); } catch(e) {}
            svcIdList.forEach(function(sid) {
              db.prepare("UPDATE servicios SET estado='activo' WHERE id=? AND estado='suspendido'").run(sid);
              sendReactivationNotification(client_id, sid, due_date);
            });
          } catch(e) {}
        })();

        return res.json({ status: 'success', msg: 'Promesa creada correctamente. Servicios reactivados.' });
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
      console.log('[CC DEBUG] CuadreCaja case entered, ajax=' + ajax + ' pagina=' + req.query.pagina);

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

      // --- Listar usuarios para cuadre (cobradores/empleados) ---
      if (ajax === 'list_usuarios_cuadre') {
        var usuarios = db.prepare("SELECT id, nombre FROM empleados WHERE activo=1 AND (tipo='cobrador' OR tipo='oficina' OR tipo='admin') ORDER BY nombre").all();
        // Also add system users
        var sysUsers = db.prepare("SELECT id, nombre FROM usuarios WHERE activo=1 ORDER BY nombre").all();
        // Merge and deduplicate
        var nombres = {};
        var result = [];
        sysUsers.forEach(function(u) {
          if (!nombres[u.nombre]) {
            nombres[u.nombre] = true;
            result.push({ value: u.nombre, label: u.nombre });
          }
        });
        usuarios.forEach(function(u) {
          if (!nombres[u.nombre]) {
            nombres[u.nombre] = true;
            result.push({ value: u.nombre, label: u.nombre });
          }
        });
        return res.json({ status: 'success', data: result });
      }

      // --- Obtener pagos pendientes de un usuario desde su último cuadre ---
      if (ajax === 'get_pendientes_cuadre') {
        var usuario = req.query.usuario || '';
        if (!usuario) return res.json({ status: 'error', msg: 'Usuario requerido' });

        // Encontrar el último cuadre de este usuario
        var ultimo = db.prepare("SELECT MAX(fecha_hasta) as ultima_fecha FROM cuadre_caja WHERE usuario_nombre=? AND fecha_hasta IS NOT NULL").get(usuario);
        var fechaDesde = ultimo && ultimo.ultima_fecha ? ultimo.ultima_fecha : '1970-01-01';

        // Obtener pagos NO cuadrados de este usuario (cobrador)
        // Usamos el nombre del empleado/sistema que coincide con el usuario del cuadre
        var pagos = db.prepare(`
          SELECT p.*, c.nombre as cliente_nombre, c.telefono as telefono
          FROM pagos p
          LEFT JOIN clientes c ON c.id=p.cliente_id
          WHERE p.cuadrado=0 AND p.created_at > ?
          ORDER BY p.created_at ASC
        `).all(fechaDesde);

        var desglose = {};
        var total = 0;
        pagos.forEach(function(p) {
          var met = p.metodo || 'EFECTIVO';
          if (!desglose[met]) desglose[met] = { cantidad: 0, total: 0 };
          desglose[met].cantidad++;
          desglose[met].total += parseFloat(p.monto || 0);
          total += parseFloat(p.monto || 0);
        });

        return res.json({
          status: 'success',
          data: {
            pagos: pagos,
            desglose: desglose,
            total: total,
            cantidad: pagos.length,
            ultimo_cuadre: ultimo && ultimo.ultima_fecha ? ultimo.ultima_fecha : null
          }
        });
      }

      // --- Crear cuadre para un usuario específico ---
      if (ajax === 'crear_cuadre_usuario') {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
        var usuario = req.body.usuario || '';
        if (!usuario) return res.json({ status: 'error', msg: 'Usuario requerido' });

        // Get pending payments
        var ultimo = db.prepare("SELECT MAX(fecha_hasta) as ultima_fecha FROM cuadre_caja WHERE usuario_nombre=? AND fecha_hasta IS NOT NULL").get(usuario);
        var fechaDesde = ultimo && ultimo.ultima_fecha ? ultimo.ultima_fecha : '1970-01-01';
        var ahora = new Date().toISOString();

        var pagos = db.prepare("SELECT p.*, c.nombre as cliente_nombre FROM pagos p LEFT JOIN clientes c ON c.id=p.cliente_id WHERE p.cuadrado=0 AND p.created_at > ? ORDER BY p.created_at ASC").all(fechaDesde);
        if (pagos.length === 0) return res.json({ status: 'error', msg: 'No hay pagos pendientes de cuadrar' });

        var total = 0;
        var detalles = [];
        var metodos = {};
        pagos.forEach(function(p) {
          var m = parseFloat(p.monto || 0);
          total += m;
          detalles.push({
            pago_id: p.id, cliente: p.cliente_nombre || 'N/A', monto: m,
            metodo: p.metodo || 'EFECTIVO', fecha: p.created_at
          });
          var met = p.metodo || 'EFECTIVO';
          if (!metodos[met]) metodos[met] = { cantidad: 0, total: 0 };
          metodos[met].cantidad++;
          metodos[met].total += m;
        });

        var r = db.prepare("INSERT INTO cuadre_caja (usuario_nombre, fecha, fecha_desde, fecha_hasta, total_pagos, pagos_count, detalles_json, total_metodos_json) VALUES (?,?,?,?,?,?,?,?)").run(usuario, ahora.slice(0,10), fechaDesde, ahora, total, pagos.length, JSON.stringify(detalles), JSON.stringify(metodos));
        var cuadreId = r.lastInsertRowid;

        // Mark payments as cuadrado
        pagos.forEach(function(p) {
          db.prepare("UPDATE pagos SET cuadrado=1, cuadre_id=? WHERE id=?").run(cuadreId, p.id);
        });

        return res.json({ status: 'success', msg: 'Cuadre realizado', cuadre_id: cuadreId, total: total, cantidad: pagos.length, detalles: detalles, metodos: metodos, desde: fechaDesde, hasta: ahora });
      }

      // --- Obtener detalle de un cuadre ---
      if (ajax === 'get_cuadre_detalle') {
        var cuadreId = parseInt(req.query.cuadre_id) || 0;
        if (!cuadreId) return res.json({ status: 'error', msg: 'ID requerido' });
        var cuadre = db.prepare("SELECT * FROM cuadre_caja WHERE id=?").get(cuadreId);
        if (!cuadre) return res.json({ status: 'error', msg: 'Cuadre no encontrado' });
        var pagos = db.prepare("SELECT p.*, c.nombre as cliente_nombre FROM pagos p LEFT JOIN clientes c ON c.id=p.cliente_id WHERE p.cuadre_id=? ORDER BY p.created_at ASC").all(cuadreId);
        return res.json({ status: 'success', cuadre: cuadre, detalles: pagos, desde: cuadre.fecha_desde });
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

        // En modo informativo, no hay updates reales - solo reportar que está actualizado
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
          var output = ejecutarGenerarFacturas(req.body.ciclo_id || null);
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
      data.ciclos = db.prepare('SELECT * FROM billing_cycles ORDER BY id').all();
      break;
    }
    case 'Log': {
      console.log('[Log] isTenant=' + req.session.isTenant + ' db_path=' + req.session.db_path + ' _tenant=' + (typeof _tenantDbGlobal !== 'undefined' && _tenantDbGlobal !== null ? 'YES' : 'NO'));
      const logAjax = req.query.ajax;
      if (logAjax === 'list') {
        const search = (req.query.search || '').trim();
        const logUser = req.query.user || '';
        const logModule = req.query.module || '';
        const desde = req.query.desde || '';
        const hasta = req.query.hasta || '';
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const perPage = 25;
        const offset = (page - 1) * perPage;
        let where = 'WHERE 1=1'; let params = [];
        if (search) { var like = '%' + search + '%'; where += ' AND (usuario_nombre LIKE ? OR accion LIKE ? OR cliente_nombre LIKE ? OR detalle LIKE ? OR ip_address LIKE ?)'; params.push(like, like, like, like, like); }
        if (logUser) { where += ' AND usuario_nombre = ?'; params.push(logUser); }
        if (logModule) { where += ' AND modulo = ?'; params.push(logModule); }
        if (desde) { where += ' AND date(created_at) >= ?'; params.push(desde); }
        if (hasta) { where += ' AND date(created_at) <= ?'; params.push(hasta); }
        var totalRow = db.prepare('SELECT COUNT(*) as total FROM logs ' + where).get(...params);
        var total = totalRow ? totalRow.total : 0;
        var rows = db.prepare('SELECT * FROM logs ' + where + ' ORDER BY created_at DESC LIMIT ? OFFSET ?').all(...params, perPage, offset);
        var users = db.prepare("SELECT DISTINCT usuario_nombre FROM logs WHERE usuario_nombre != '' ORDER BY usuario_nombre").all().map(function(r) { return r.usuario_nombre; });
        var modulos = db.prepare('SELECT DISTINCT modulo FROM logs ORDER BY modulo').all().map(function(r) { return r.modulo; });
        return res.json({ status: 'success', data: rows, total: total, pages: Math.ceil(total / perPage), page: page, users: users, modules: modulos });
      }
      if (logAjax === 'clean') {
        if (req.method !== 'POST') return res.json({ status: 'error', msg: 'Método no permitido' });
        const days = parseInt(req.body.days) || 30;
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
        var delInfo = db.prepare('DELETE FROM logs WHERE created_at < ?').run(cutoff);
        return res.json({ status: 'success', deleted: delInfo.changes });
      }
      data.logUsers = db.prepare("SELECT DISTINCT usuario_nombre FROM logs WHERE usuario_nombre != '' ORDER BY usuario_nombre").all().map(function(r) { return r.usuario_nombre; });
      data.logModules = db.prepare('SELECT DISTINCT modulo FROM logs ORDER BY modulo').all().map(function(r) { return r.modulo; });
      break;
    }
    case 'Mensajeria': {
      const ajax = req.query.ajax;
      const isTenant = req.session && req.session.isTenant;

      // WhatsApp status
      if (ajax === 'wa_status') {
        if (isTenant) {
          var openwaM = require('./openwa-multi');
          var st = openwaM.getStatus(req.session);
          if (st.state === 'connected') {
            return res.json({ status: 'success', data: { status: 'connected', phone: st.phone || 'Conectado', name: st.name || 'WhatsApp', messages_sent: st.messagesSent || 0, uptime: st.uptime || 0 } });
          } else if (st.state === 'qr') {
            var tenantKey = (req.session.db_path || '').replace(/\.db$/, '').replace(/^tenant_/, '');
            var qrFile = '/data/wa-sessions/' + tenantKey.replace(/[^a-zA-Z0-9_]/g, '_') + '_qr.png';
            return res.json({ status: 'success', data: { status: 'qr', qr: qrFile } });
          } else if (st.state === 'starting') {
            return res.json({ status: 'success', data: { status: 'connecting' } });
          } else {
            return res.json({ status: 'success', data: { status: 'disconnected' } });
          }
        } else {
          try {
            var openwaS = require('./openwa-service');
            if (openwaS.getStatus) {
              var s = openwaS.getStatus();
              console.log('[WA-admin] Status:', JSON.stringify(s));
              var isConnected = s.state === 'connected';
              if (s.qr && s.state === 'qr') {
                return res.json({ status: 'success', data: { status: 'qr', qr: '/openwa-qr.png' } });
              }
              return res.json({ status: 'success', data: { status: isConnected ? 'connected' : 'disconnected', phone: s.phone || (isConnected ? 'Conectado' : ''), name: s.name || '', messages_sent: s.messagesSent || 0, uptime: s.uptime || 0 } });
            }
          } catch(e) { console.log('[WA-admin] Status error:', e.message); }
          return res.json({ status: 'success', data: { status: 'disconnected' } });
        }
      }

      // WhatsApp disconnect
      if (ajax === 'wa_disconnect') {
        if (isTenant) {
          var openwaM = require('./openwa-multi');
          openwaM.stop(req.session).then(function(r) {
            return res.json({ status: 'success', msg: r.msg });
          }).catch(function(e) {
            return res.json({ status: 'error', msg: e.message });
          });
        } else {
          try {
            var openwaS = require('./openwa-service');
            openwaS.stop();
            return res.json({ status: 'success' });
          } catch(e) { return res.json({ status: 'error', msg: e.message }); }
        }
        return;
      }

      // WhatsApp restart (generate QR)
      if (ajax === 'wa_restart') {
        if (isTenant) {
          var openwaM = require('./openwa-multi');
          openwaM.stop(req.session).then(function() {
            return openwaM.start(req.session);
          }).then(function(r) {
            return res.json({ status: 'success', msg: r.msg });
          }).catch(function(e) {
            return res.json({ status: 'error', msg: e.message });
          });
        } else {
          try {
            var openwaS = require('./openwa-service');
            console.log('[WA-admin] Deteniendo WhatsApp admin...');
            openwaS.stop();
            setTimeout(async function() {
              console.log('[WA-admin] Iniciando WhatsApp admin...');
              var r = await openwaS.start();
              console.log('[WA-admin] Resultado:', JSON.stringify(r));
            }, 1000);
            return res.json({ status: 'success', msg: 'Generando QR...' });
          } catch(e) {
            console.log('[WA-admin] Error:', e.message);
            return res.json({ status: 'error', msg: e.message });
          }
        }
        return;
      }

      // WhatsApp send message
      if (ajax === 'wa_send') {
        if (req.method !== 'POST') return res.json({ status: 'error', msg: 'POST required' });
        var phone = req.body.phone || '';
        var message = req.body.message || '';
        if (!phone || !message) return res.json({ status: 'error', msg: 'Teléfono y mensaje requeridos' });

        if (isTenant) {
          var openwaM = require('./openwa-multi');
          openwaM.sendMessage(req.session, phone, message).then(function(r) {
            return res.json({ status: r.success ? 'success' : 'error', msg: r.msg });
          }).catch(function(e) {
            return res.json({ status: 'error', msg: e.message });
          });
        } else {
          try {
            var openwaS = require('./openwa-service');
            openwaS.sendMessage(phone, message).then(function(r) {
              return res.json({ status: r.success ? 'success' : 'error', msg: r.msg });
            }).catch(function(e) {
              return res.json({ status: 'error', msg: e.message });
            });
          } catch(e) { return res.json({ status: 'error', msg: e.message }); }
        }
        return;
      }

      // Gateway API - list
      if (ajax === 'list_gateways') {
        try {
          db.exec("CREATE TABLE IF NOT EXISTS api_whatsapp_gateways (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, provider TEXT, url TEXT, params TEXT, encrypted INTEGER DEFAULT 0, activo INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
          var gateways = db.prepare('SELECT * FROM api_whatsapp_gateways ORDER BY created_at DESC').all();
          return res.json({ status: 'success', data: gateways });
        } catch(e) { return res.json({ status: 'error', msg: e.message }); }
      }

      // Gateway API - save
      if (ajax === 'save_gateway') {
        if (req.method !== 'POST') return res.json({ status: 'error', msg: 'POST required' });
        var gId = req.body.id;
        var gName = (req.body.name || '').trim();
        var gProvider = (req.body.provider || '').trim();
        var gUrl = (req.body.url || '').trim();
        var gParams = (req.body.params || '').trim();
        var gEncrypted = req.body.encrypted === '1' ? 1 : 0;

        if (!gName || !gProvider || !gUrl) return res.json({ status: 'error', msg: 'Nombre, proveedor y URL son obligatorios' });

        db.exec("CREATE TABLE IF NOT EXISTS api_whatsapp_gateways (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, provider TEXT, url TEXT, params TEXT, encrypted INTEGER DEFAULT 0, activo INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");

        if (gId) {
          db.prepare('UPDATE api_whatsapp_gateways SET name=?, provider=?, url=?, params=?, encrypted=? WHERE id=?').run(gName, gProvider, gUrl, gParams, gEncrypted, gId);
        } else {
          db.prepare('INSERT INTO api_whatsapp_gateways (name, provider, url, params, encrypted) VALUES (?,?,?,?,?)').run(gName, gProvider, gUrl, gParams, gEncrypted);
        }
        return res.json({ status: 'success', msg: gId ? 'Gateway actualizado' : 'Gateway creado' });
      }

      // Gateway API - delete
      if (ajax === 'delete_gateway') {
        if (req.method !== 'POST') return res.json({ status: 'error', msg: 'POST required' });
        var delId = req.body.id;
        if (delId) { db.prepare('DELETE FROM api_whatsapp_gateways WHERE id=?').run(delId); }
        return res.json({ status: 'success' });
      }

      // Gateway API - test
      if (ajax === 'test_gateway') {
        if (req.method !== 'POST') return res.json({ status: 'error', msg: 'POST required' });
        return res.json({ status: 'success', msg: 'Prueba enviada (simulado)' });
      }

      // Message logs
      if (ajax === 'get_log') {
        try {
          var logPage = Math.max(1, parseInt(req.query.page) || 1);
          var logPerPage = 25;
          var logOffset = (logPage - 1) * logPerPage;
          var totalLogs = (db.prepare('SELECT COUNT(*) as c FROM message_logs').get() || {}).c || 0;
          var logs = db.prepare('SELECT * FROM message_logs ORDER BY created_at DESC LIMIT ? OFFSET ?').all(logPerPage, logOffset);
          return res.json({ status: 'success', rows: logs, total: totalLogs, pages: Math.ceil(totalLogs / logPerPage), page: logPage });
        } catch(e) { return res.json({ status: 'error', msg: e.message, rows: [], total: 0, pages: 0, page: 1 }); }
      }

      // Bulk messaging filters
      if (ajax === 'masivos_filters') {
        try {
          var zonasList = db.prepare('SELECT id, nombre FROM zonas ORDER BY nombre').all();
          var planesList = db.prepare('SELECT id, nombre FROM planes ORDER BY nombre').all();
          return res.json({ status: 'success', zonas: zonasList, planes: planesList });
        } catch(e) { return res.json({ status: 'error', msg: e.message }); }
      }

      // Bulk messaging preview
      if (ajax === 'masivos_preview') {
        if (req.method !== 'POST') return res.json({ status: 'error', msg: 'POST required' });
        try {
          var zonaFilter = req.body.zona || '';
          var planFilter = req.body.plan || '';
          var clientFilter = req.body.cliente || '';
          var statusFilter = req.body.estado || '';
          var where = 'WHERE 1=1';
          var params = [];
          if (zonaFilter) { where += ' AND zona_id=?'; params.push(zonaFilter); }
          if (planFilter) { where += ' AND id IN (SELECT cliente_id FROM servicios WHERE plan_id=? )'; params.push(planFilter); }
          if (clientFilter) { where += ' AND (nombre LIKE ? OR telefono LIKE ?)'; var like = '%' + clientFilter + '%'; params.push(like, like); }
          if (statusFilter) {
            if (statusFilter === 'activos') where += ' ';
            else if (statusFilter === 'suspendidos') where += ' AND activo=0';
          }
          var clientes = db.prepare('SELECT id, nombre, telefono FROM clientes ' + where + ' ORDER BY nombre').all(params);
          return res.json({ status: 'success', total: clientes.length, data: clientes });
        } catch(e) { return res.json({ status: 'error', msg: e.message }); }
      }

      // Bulk messaging search client
      if (ajax === 'masivos_search_client') {
        var q = (req.query.q || '').trim();
        if (!q) return res.json({ status: 'success', data: [] });
        var like = '%' + q + '%';
        var resultados = db.prepare("SELECT id, nombre, telefono FROM clientes WHERE nombre LIKE ? OR telefono LIKE ? LIMIT 20").all(like, like);
        return res.json({ status: 'success', data: resultados });
      }

      // Bulk messaging send
      if (ajax === 'masivos_send') {
        if (req.method !== 'POST') return res.json({ status: 'error', msg: 'POST required' });
        try {
          var clientIds = req.body.clientes;
          var msgText = req.body.mensaje || '';
          if (!clientIds || !msgText) return res.json({ status: 'error', msg: 'Seleccione clientes y escriba un mensaje' });
          var ids = Array.isArray(clientIds) ? clientIds : [clientIds];
          var sent = 0;
          for (var i = 0; i < ids.length; i++) {
            var cl = db.prepare('SELECT id, nombre, telefono FROM clientes WHERE id=?').get(ids[i]);
            if (cl && cl.telefono) {
              // Add to message queue
              try { db.prepare("INSERT INTO message_queue (cliente_id, telefono, mensaje, tipo) VALUES (?,?,?,'masivo')").run(cl.id, cl.telefono, msgText); sent++; } catch(e) {}
            }
          }
          return res.json({ status: 'success', msg: sent + ' mensajes encolados' });
        } catch(e) { return res.json({ status: 'error', msg: e.message }); }
      }

      // Default: render the page
      data.messageLogs = [];
      try { data.messageLogs = db.prepare('SELECT * FROM message_logs ORDER BY created_at DESC LIMIT 25').all(); } catch(e) {}
      break;
    }

  }

  // SmartOLT modules se renderizan sin layout (standalone)
  var smartoltModules = ['GPONManager', 'SmartoltConfigured', 'SmartoltUnconfigured', 'SmartoltLocations', 'SmartoltOnuTypes', 'SmartoltSpeedProfiles', 'SmartoltSettings', 'SmartoltDashboard'];
  if (smartoltModules.indexOf(pagina) !== -1) {
    res.render('pages/' + pagina, { ...data, user: req.session.user });
  } else {
    renderPage(req, res, pagina, data);
  }
  // Cleanup tenant DB pointer after request completes
  _tenantDbGlobal = null;
  global.__tenantDbForLogs = null;
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

  // Cargar config de empresa
  var config = {};
  var cr = db.prepare("SELECT key, value FROM configuracion WHERE key IN ('empresa_nombre','empresa_telefono')").all();
  cr.forEach(function(r) { config[r.key] = r.value || ''; });

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
      .replace(/{company_phone}/g, config.empresa_telefono || '8092470033')
      .replace(/{company_name}/g, config.empresa_nombre || 'Joel Wifi Dominicana');

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

  // Usar fecha simulada si está configurada
  var sd = getCurrentServerDate();
  var fechaRef = sd.overridden ? "'" + sd.current_date_only + "'" : "date('now')";

  // Clientes con facturas vencidas que tienen servicios activos
  // Excluye clientes con promesa de pago activa con fecha limite no vencida
  var pendientes = db.prepare(`
    SELECT DISTINCT c.id as cliente_id, c.nombre as cliente_nombre, c.telefono
    FROM facturas f
    JOIN servicios s ON s.id=f.servicio_id
    JOIN clientes c ON c.id=s.cliente_id
    LEFT JOIN billing_cycles bc ON bc.id = COALESCE(s.ciclo_id, (SELECT id FROM billing_cycles WHERE is_default=1 LIMIT 1))
    WHERE f.estado='pendiente' AND s.estado='activo'
      AND (
        -- CASO 1: suspend_day > payment_day → corte en el MISMO mes
        (bc.suspend_day > COALESCE(bc.payment_day, bc.invoice_day)
         AND CAST(strftime('%d', ` + fechaRef + `) AS INTEGER) >= bc.suspend_day
         AND julianday(` + fechaRef + `) > julianday(f.fecha_vencimiento))
        OR
        -- CASO 2: suspend_day <= payment_day → corte en el MES SIGUIENTE
        (bc.suspend_day <= COALESCE(bc.payment_day, bc.invoice_day)
         AND strftime('%Y-%m', ` + fechaRef + `) > strftime('%Y-%m', f.fecha_vencimiento)
         AND CAST(strftime('%d', ` + fechaRef + `) AS INTEGER) >= bc.suspend_day)
      )
      AND f.monto > COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0)
      AND c.id NOT IN (
        SELECT cliente_id FROM promesas_pago
        WHERE estado = 'activa'
          AND fecha_limite >= ` + fechaRef + `
      )
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

function ejecutarGenerarFacturas(cicloIdFilter) {
  var lines = [];
  var ts = new Date().toLocaleString();
  lines.push('============================================================');
  lines.push('[' + ts + '] CRON GENERAR FACTURAS - START');
  lines.push('============================================================');

  try {
    // Usar fecha efectiva (simulada o real)
    var sd = getCurrentServerDate();
    var nowDate = sd.overridden ? new Date(sd.current_date_only + 'T12:00:00') : new Date();
    var todayDay = nowDate.getDate();
    var periodo = nowDate.getFullYear() + '-' + String(nowDate.getMonth() + 1).padStart(2, '0');
    var fechaEmision = nowDate.toISOString().split('T')[0];

    // Vencimiento: 30 dias despues
    var venc = new Date(nowDate);
    venc.setDate(venc.getDate() + 30);
    var fechaVenc = venc.toISOString().split('T')[0];

    lines.push('Fecha efectiva: ' + fechaEmision + ' (dia ' + todayDay + ')');
    lines.push('Periodo: ' + periodo);
    lines.push('');

    // Obtener ciclos de facturacion
    var ciclos = db.prepare('SELECT * FROM billing_cycles ORDER BY id').all();

    if (!ciclos.length) {
      lines.push('⚠ No hay ciclos de facturación configurados');
      lines.push('   Ve a Configuración > Facturación para crear uno');
    } else {
      var totalCreadas = 0;
      var totalSaltadas = 0;
      var totalErrores = 0;

      ciclos.forEach(function(ciclo) {
        // Si hay filtro de ciclo, solo procesar ese
        if (cicloIdFilter && cicloIdFilter != -1 && ciclo.id != cicloIdFilter) return;

        var cicloName = ciclo.name || 'Ciclo #' + ciclo.id;
        lines.push('--- ' + cicloName + ' ---');

        // Verificar si hoy es el dia de facturacion
        if (todayDay !== ciclo.invoice_day) {
          lines.push('  ⏭ Día de facturación: ' + ciclo.invoice_day + ' (hoy es ' + todayDay + ') - saltado');
          return;
        }

        lines.push('  ✓ Día de facturación coincide (' + ciclo.invoice_day + ')');

        // Obtener servicios activos de este ciclo
        var servicios = [];
        if (cicloIdFilter && cicloIdFilter != -1) {
          servicios = db.prepare("SELECT s.id, s.cliente_id, p.nombre as plan_nombre, p.precio as plan_precio, c.nombre as cliente_nombre FROM servicios s LEFT JOIN planes p ON p.id=s.plan_id LEFT JOIN clientes c ON c.id=s.cliente_id WHERE s.estado='activo' AND s.ciclo_id=?").all(ciclo.id);
        } else {
          servicios = db.prepare("SELECT s.id, s.cliente_id, p.nombre as plan_nombre, p.precio as plan_precio, c.nombre as cliente_nombre FROM servicios s LEFT JOIN planes p ON p.id=s.plan_id LEFT JOIN clientes c ON c.id=s.cliente_id WHERE s.estado='activo' AND (s.ciclo_id=? OR s.ciclo_id IS NULL)").all(ciclo.id);
        }

        if (!servicios.length) {
          lines.push('  Sin servicios activos en este ciclo');
          return;
        }

        var cicloCreadas = 0;
        var cicloSaltadas = 0;
        var cicloErrores = 0;

        servicios.forEach(function(svc) {
          try {
            var precio = parseFloat(svc.plan_precio || 0);
            if (precio <= 0) {
              cicloSaltadas++;
              return;
            }

            // Verificar si ya existe factura para este periodo
            var existing = db.prepare('SELECT id FROM facturas WHERE servicio_id=? AND periodo=?').get(svc.id, periodo);
            if (existing) {
              cicloSaltadas++;
              return;
            }

            // Crear factura
            db.prepare('INSERT INTO facturas (servicio_id, periodo, monto, estado, fecha_emision, fecha_vencimiento) VALUES (?,?,?,\'pendiente\',?,?)').run(svc.id, periodo, precio, fechaEmision, fechaVenc);
            cicloCreadas++;
          } catch(e) {
            cicloErrores++;
          }
        });

        lines.push('  Creadas: ' + cicloCreadas + ' | Ya existían: ' + cicloSaltadas + ' | Errores: ' + cicloErrores + ' (de ' + servicios.length + ' servicios)');
        totalCreadas += cicloCreadas;
        totalSaltadas += cicloSaltadas;
        totalErrores += cicloErrores;
      });

      lines.push('');
      lines.push('============================================================');
      lines.push('RESUMEN: ' + totalCreadas + ' facturas creadas, ' + totalSaltadas + ' saltadas, ' + totalErrores + ' errores');
    }
  } catch(e) {
    lines.push('');
    lines.push('❌ ERROR: ' + e.message);
  }

  lines.push('============================================================');
  lines.push('[' + ts + '] CRON GENERAR FACTURAS - END');
  lines.push('============================================================');
  return lines.join('\n');
}

// Función: expirar promesas de pago vencidas
function ejecutarExpirarPromesas(req, res) {
  try {
    var sd = getCurrentServerDate();
    var fechaStr = sd.current_date_only;
    var horaStr = sd.current_time || '12:00';
    var fechaTimeStr = fechaStr + ' ' + horaStr + ':00';
    var fechaRef = sd.overridden ? ("'" + fechaTimeStr + "'") : "datetime('now','localtime')";

    // La promesa vence a las 12:00 del dia de la fecha limite
    // Si la fecha/hora simulada es >= fecha_limite + 12:00, la promesa esta vencida
    var vencidas = db.prepare(`
      SELECT pp.id, pp.cliente_id, pp.servicio_ids, pp.fecha_limite,
        c.nombre as cliente_nombre
      FROM promesas_pago pp
      JOIN clientes c ON c.id=pp.cliente_id
      WHERE pp.estado='activa'
        AND (pp.fecha_limite || ' 12:00:00') < ` + fechaRef + `
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
        // Obtener IDs de servicios (pueden venir como JSON o comma-separated)
        var svcIds = [];
        var raw = (p.servicio_ids || '').toString().trim();
        if (raw.startsWith('[')) {
          try { svcIds = JSON.parse(raw); } catch(e) {}
        } else if (raw) {
          svcIds = raw.split(',').map(function(s) { return parseInt(s.trim()); }).filter(function(n) { return !isNaN(n) && n > 0; });
        }

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
  try {
    const filter = req.query.filter || 'active';
    let where = '';
    if (filter === 'active') where = "WHERE pp.estado='activa' AND pp.fecha_limite >= date('now')";
    else if (filter === 'expired') where = "WHERE (pp.estado='vencida' OR (pp.estado='activa' AND pp.fecha_limite < date('now')))";
    else if (filter === 'cancelled') where = "WHERE pp.estado='cancelada'";
    
    // Obtener datos base sin json_each (que falla con formato inconsistente)
    var rows = db.prepare(`
      SELECT pp.*, c.nombre as client_name, c.apodo as alias,
        u.nombre as created_by_name
      FROM promesas_pago pp
      LEFT JOIN clientes c ON c.id=pp.cliente_id
      LEFT JOIN usuarios u ON u.id=pp.usuario_id
      ${where}
      ORDER BY pp.created_at DESC LIMIT 200
    `).all();

    // Procesar servicio_ids (puede ser JSON array o comma-separated)
    rows.forEach(function(row) {
      var svcIds = [];
      var raw = (row.servicio_ids || '').toString().trim();
      if (raw.startsWith('[')) {
        try { svcIds = JSON.parse(raw); } catch(e) {}
      } else if (raw) {
        svcIds = raw.split(',').map(function(s) { return parseInt(s.trim()); }).filter(function(n) { return !isNaN(n) && n > 0; });
      }

      row.nics = svcIds.map(function(id) { return 'SVC-' + id; }).join(', ');

      row.svc_status = 'suspended';
      for (var si = 0; si < svcIds.length; si++) {
        var svc = db.prepare('SELECT estado FROM servicios WHERE id=?').get(svcIds[si]);
        if (svc && svc.estado === 'activo') {
          row.svc_status = 'active';
          break;
        }
      }
    });

    res.json({ status: 'success', data: rows });
  } catch(e) {
    res.json({ status: 'error', msg: e.message });
  }
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
        db.prepare("UPDATE servicios SET estado='activo' WHERE id=? AND estado='suspendido'").run(sid);
        sendReactivationNotification(client_id, sid, due_date);
      });
    } catch(e) {}
  })();

  res.json({ status: 'success', msg: 'Promesa creada correctamente. Servicios reactivados.', id: r.lastInsertRowid });
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
    if (id) {
      var svcCount2 = db.prepare('SELECT COUNT(*) as c FROM servicios WHERE ciclo_id=?').get(id);
      if (svcCount2 && svcCount2.c > 0) {
        db.prepare('UPDATE servicios SET ciclo_id=NULL WHERE ciclo_id=?').run(id);
      }
      db.prepare('DELETE FROM billing_cycles WHERE id=?').run(id);
    }
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
  console.log('[API-TEST] Probando conexión a ' + host + ':' + (port || 8728) + ' user=' + username);
  try {
    const result = await MikroTikAPI.testConnection(host, port || 8728, username, password);
    console.log('[API-TEST] Resultado: ' + (result.success ? 'OK' : 'FAIL: ' + result.error));
    res.json(result);
  } catch(e) {
    console.log('[API-TEST] Error inesperado:', e.message);
    res.json({ success: false, error: e.message });
  }
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
  const { accion, id_router, id_router_edit, name, ip, port, user, password, ip_blocks, interface_wan } = req.body;
  console.log('[SAVE-ROUTER] Request:', JSON.stringify({accion, id_router, id_router_edit, name, ip, interface_wan}));

  let routerId = id_router || id_router_edit;
  console.log('[SAVE-ROUTER] routerId:', routerId);

  if (accion === "editar" && (id_router || id_router_edit)) {
    const editId = parseInt(id_router || id_router_edit);
    console.log('[SAVE-ROUTER] EDIT mode, editId:', editId);
    if (password) {
      db.prepare("UPDATE routers SET name=?, ip=?, port=?, user=?, password=?, ip_blocks=?, interface_wan=? WHERE id=?")
        .run(name, ip, port || 8728, user, password, ip_blocks || "[]", interface_wan || "ether1", editId);
    } else {
      db.prepare("UPDATE routers SET name=?, ip=?, port=?, user=?, ip_blocks=?, interface_wan=? WHERE id=?")
        .run(name, ip, port || 8728, user, ip_blocks || "[]", interface_wan || "ether1", editId);
    }
    routerId = editId;
  } else {
    console.log('[SAVE-ROUTER] NEW/CREATE mode');
    // Avoid duplicates by IP
    const existing = db.prepare('SELECT id FROM routers WHERE ip=?').get(ip);
    if (existing) {
      db.prepare("UPDATE routers SET name=?, port=?, user=?, password=?, ip_blocks=?, interface_wan=? WHERE id=?")
        .run(name, port || 8728, user, password || "", ip_blocks || "[]", interface_wan || "ether1", existing.id);
      routerId = existing.id;
    } else {
      const r = db.prepare("INSERT INTO routers (name, ip, port, user, password, ip_blocks, interface_wan) VALUES (?,?,?,?,?,?,?)")
        .run(name, ip, port || 8728, user, password || "", ip_blocks || "[]", interface_wan || "ether1");
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

// POST /api/planes/save - Create or update plan
app.post('/api/planes/save', requireAuth, (req, res) => {
  try {
    const { id, nombre, precio, velocidad_subida, velocidad_bajada, upload_burst, download_burst,
      burst_threshold_up, burst_threshold_down, perfil_mikrotik, perfil_olt_descarga, perfil_olt_subida,
      zonas, disponible } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.json({ success: false, message: 'El nombre del plan es requerido' });
    }

    const planId = parseInt(id) || 0;
    if (planId > 0) {
      db.prepare(`UPDATE planes SET nombre=?, precio=?, velocidad=?, velocidad_subida=?, velocidad_bajada=?,
        upload_burst=?, download_burst=?, burst_threshold_up=?, burst_threshold_down=?,
        perfil_mikrotik=?, perfil_olt_descarga=?, perfil_olt_subida=?, zonas=?, disponible=? WHERE id=?`)
        .run(nombre.trim(), parseFloat(precio) || 0, velocidad_subida || velocidad_bajada || '',
          velocidad_subida || '', velocidad_bajada || '', upload_burst || '', download_burst || '',
          burst_threshold_up || '', burst_threshold_down || '', perfil_mikrotik || '',
          perfil_olt_descarga || '', perfil_olt_subida || '', zonas || 'all', disponible !== 0 ? 1 : 0, planId);
    } else {
      db.prepare(`INSERT INTO planes (nombre, precio, velocidad, velocidad_subida, velocidad_bajada,
        upload_burst, download_burst, burst_threshold_up, burst_threshold_down,
        perfil_mikrotik, perfil_olt_descarga, perfil_olt_subida, zonas, disponible)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(nombre.trim(), parseFloat(precio) || 0, velocidad_subida || velocidad_bajada || '',
          velocidad_subida || '', velocidad_bajada || '', upload_burst || '', download_burst || '',
          burst_threshold_up || '', burst_threshold_down || '', perfil_mikrotik || '',
          perfil_olt_descarga || '', perfil_olt_subida || '', zonas || 'all', disponible !== 0 ? 1 : 0);
    }

    res.json({ success: true, message: 'Plan guardado' });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

// POST /api/planes/:id/delete - Delete a plan
app.post('/api/planes/:id/delete', requireAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id) || 0;
    if (!id) return res.json({ success: false, message: 'ID requerido' });
    const count = db.prepare('SELECT COUNT(*) as c FROM servicios WHERE plan_id=?').get(id);
    if (count && count.c > 0) {
      return res.json({ success: false, message: 'No se puede eliminar: ' + count.c + ' servicio(s) usan este plan' });
    }
    db.prepare('DELETE FROM planes WHERE id=?').run(id);
    res.json({ success: true, message: 'Plan eliminado' });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

// GET /api/planes/:id - Get single plan
app.get('/api/planes/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id) || 0;
  if (!id) return res.json({ success: false, message: 'ID requerido' });
  const plan = db.prepare('SELECT p.* FROM planes p WHERE p.id=?').get(id);
  if (!plan) return res.json({ success: false, message: 'Plan no encontrado' });
  res.json(plan);
});

// ======== IP POOLS API ========
app.get('/api/ip-pools/:router_id', requireAuth, (req, res) => {
  try {
    // Ensure tables exist in the active DB
    db.exec("CREATE TABLE IF NOT EXISTS ip_pools (id INTEGER PRIMARY KEY AUTOINCREMENT, router_id INTEGER NOT NULL, red TEXT NOT NULL, gateway TEXT, tipo TEXT DEFAULT 'privada', total INTEGER DEFAULT 0, disponibles INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE)");
    db.exec("CREATE TABLE IF NOT EXISTS ips_asignadas (id INTEGER PRIMARY KEY AUTOINCREMENT, pool_id INTEGER, ip TEXT, servicio_id INTEGER, cliente_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
    const pools = db.prepare('SELECT * FROM ip_pools WHERE router_id=? ORDER BY red').all(req.params.router_id);
    // Get assigned count for each pool
    for (var i = 0; i < pools.length; i++) {
      const used = db.prepare('SELECT COUNT(*) as c FROM ips_asignadas WHERE pool_id=?').get(pools[i].id);
      pools[i].usadas = used ? used.c : 0;
      pools[i].disponibles = (pools[i].total || 0) - pools[i].usadas;
    }
    res.json(pools);
  } catch(e) {
    console.log('[IP-POOLS] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ip-pools/calcular', requireAuth, (req, res) => {
  try { db.exec("CREATE TABLE IF NOT EXISTS ip_pools (id INTEGER PRIMARY KEY AUTOINCREMENT, router_id INTEGER NOT NULL, red TEXT NOT NULL, gateway TEXT, tipo TEXT DEFAULT 'privada', total INTEGER DEFAULT 0, disponibles INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE)"); } catch(e) {}
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
  try { db.exec("CREATE TABLE IF NOT EXISTS ip_pools (id INTEGER PRIMARY KEY AUTOINCREMENT, router_id INTEGER NOT NULL, red TEXT NOT NULL, gateway TEXT, tipo TEXT DEFAULT 'privada', total INTEGER DEFAULT 0, disponibles INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE)"); db.exec("CREATE TABLE IF NOT EXISTS ips_asignadas (id INTEGER PRIMARY KEY AUTOINCREMENT, pool_id INTEGER, ip TEXT, servicio_id INTEGER, cliente_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"); } catch(e) {}
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
          montoProrrateado = '✅ Sin costo: está dentro de los días de gracia.';
          diasFacturados = 0;
        } else {
          diasFacturados = daysUntilPay;
          var montoProrrateo = precioPorDia * diasFacturados;
          montoProrrateado = '💰 ' + config.moneda + montoProrrateo.toFixed(2) + ' por ' + diasFacturados + ' días de uso';
        }

        // Calcular días desde el pago hasta el corte
        if (cutDay > payDay) {
          // Corte en el mismo mes después del pago
          diasHastaCorte = (cutDay - payDay) + '';
        } else {
          // Corte al mes siguiente (ej: pago día 15, corte día 4 del mes siguiente)
          var diasEnMes = new Date(anioHoy, mesHoy + 1, 0).getDate();
          diasHastaCorte = ((diasEnMes - payDay) + cutDay) + '';
        }
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
            montoProrrateado = '✅ Sin costo: está dentro de los días de gracia.';
            diasFacturados = 0;
          } else {
            diasFacturados = daysUntilPay;
            var montoProrrateo = precioPorDia * diasFacturados;
            montoProrrateado = '💰 ' + config.moneda + montoProrrateo.toFixed(2) + ' por ' + diasFacturados + ' días de uso';
          }

          if (cutDay > payDay) {
            diasHastaCorte = (cutDay - payDay) + '';
          } else {
            var diasEnMes = new Date(anioHoy, mesHoy + 1, 0).getDate();
            diasHastaCorte = ((diasEnMes - payDay) + cutDay) + '';
          }
        } else {
          // Sin ciclos en el sistema: mostrar el precio completo
          proximoPago = '30 de ' + meses[mesHoy + 1 < 12 ? mesHoy + 1 : 0];
          diasFacturados = 30;
          var montoProrrateo = precioPorDia * 30;
          montoProrrateado = '💰 ' + config.moneda + montoProrrateo.toFixed(2) + ' por ' + diasFacturados + ' días de uso';
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

// Función: enviar confirmación de pago
function sendPaymentConfirmation(clienteId, monto, metodo, facturaId) {
  try {
    var openwa = require('./openwa-service');
    var cliente = db.prepare('SELECT nombre, telefono FROM clientes WHERE id=?').get(clienteId);
    if (!cliente || !cliente.telefono) return;

    var config = {};
    var cr = db.prepare("SELECT key, value FROM configuracion WHERE key IN ('empresa_nombre','empresa_telefono')").all();
    cr.forEach(function(r) { config[r.key] = r.value || ''; });

    var tpl = db.prepare("SELECT content FROM templates WHERE template_key='confirmacion_pago'").get();
    if (!tpl || !tpl.content) return;

    var msg = tpl.content
      .replace(/{client_name}/g, cliente.nombre || '')
      .replace(/{payment_amount}/g, '$' + parseFloat(monto || 0).toFixed(2))
      .replace(/{payment_method}/g, metodo || '')
      .replace(/{payment_date}/g, new Date().toLocaleDateString('es-DO'))
      .replace(/{invoice_id}/g, facturaId ? '#' + facturaId : '')
      .replace(/{total_pendiente}/g, '')
      .replace(/{plan_name}/g, '')
      .replace(/{company_name}/g, config.empresa_nombre || '')
      .replace(/{company_phone}/g, config.empresa_telefono || '');

    openwa.encolarMensaje(clienteId, null, cliente.telefono, msg, 'confirmacion_pago');
  } catch(e) {
    console.log('[Pago] Error notificación:', e.message);
  }
}

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
    'X-Token': config.smartolt_api_key,
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


// Helper: fetch SmartOLT API via MikroTik proxy (para OLTs especificas)
var _mikrotikApiInstance = null;

async function _getMikrotikApi() {
  if (_mikrotikApiInstance) {
    try {
      await _mikrotikApiInstance.exec('/system/resource/print', '=count-only');
      return _mikrotikApiInstance;
    } catch(e) {
      try { _mikrotikApiInstance.disconnect(); } catch(e2) {}
      _mikrotikApiInstance = null;
    }
  }
  var router = db.prepare('SELECT * FROM routers WHERE connected=1 ORDER BY id LIMIT 1').get();
  if (!router) router = db.prepare('SELECT * FROM routers ORDER BY id LIMIT 1').get();
  if (!router) throw new Error('No hay routers configurados en la base de datos');
  var MikroTikAPI = require('./mikrotik-api');
  var api = new MikroTikAPI(router.ip, router.port || 8730, { timeout: 15000 });
  await api.connect();
  await api.login(router.user, router.password);
  _mikrotikApiInstance = api;
  return api;
}

async function smartoltFetchOlt(oltObj, endpoint, method, body) {
  if (!oltObj || !oltObj.smartolt_subdomain || !oltObj.smartolt_api_key) {
    throw new Error('OLT no tiene configuracion SmartOLT');
  }
  var subdomain = oltObj.smartolt_subdomain;
  var apiKey = oltObj.smartolt_api_key;
  var apiUrl = 'https://' + subdomain + '.smartolt.com/api' + endpoint;
  var randomTag = Math.random().toString(36).substring(2, 8);
  var fileName = 'so_' + randomTag + '.txt';
  try {
    var api = await _getMikrotikApi();
    var args = [
      '/tool/fetch',
      '=url=' + apiUrl,
      '=dst-path=' + fileName,
      '=http-method=' + (method || 'GET').toLowerCase(),
      '=http-header-field=X-Token: ' + apiKey
    ];
    if (body) {
      var bodyStr = body;
      if (typeof body === 'object' && body.toString) {
        bodyStr = body.toString();
        // Usar text/plain porque CloudFront bloquea urlencoded
        args.push('=http-header-field=Content-Type: text/plain');
      } else {
        bodyStr = JSON.stringify(body);
        args.push('=http-header-field=Content-Type: application/json');
      }
      args.push('=http-data=' + bodyStr);
    }
    var fetchResult = await api.exec(...args);
    for (var s of fetchResult) {
      if (s[0] === '!trap') {
        var msg = s.find(w => w.startsWith('=message='));
        throw new Error(msg ? msg.split('=').slice(2).join('=') : 'Error en fetch');
      }
    }
    var fileResult = await api.exec('/file/print', '?name=' + fileName);
    var contents = null;
    for (var s of fileResult) {
      if (s[0] === '!re') {
        var contentVal = s.find(w => w.startsWith('=contents='));
        if (contentVal) {
          contents = contentVal.substring('=contents='.length);
        }
      }
    }
    try { await api.exec('/file/remove', '=.id=' + fileName); } catch(e) {}
    if (!contents) throw new Error('Respuesta vacia de SmartOLT');
    try { return JSON.parse(contents); } catch(e) {
      throw new Error('Respuesta no JSON: ' + contents.substring(0, 300));
    }
  } catch(e) {
    if (e.message && (e.message.indexOf('Not connected') >= 0 || e.message.indexOf('connect') >= 0)) {
      _mikrotikApiInstance = null;
    }
    throw e;
  }
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
      'X-Token': api_key,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    // Try to get configured ONUs (endpoint confirmado que funciona)
    const response = await fetch(apiUrl + '/onu/configured_onus/status', { method: 'GET', headers: headers });

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
    const olts = db.prepare("SELECT * FROM olts WHERE smartolt_subdomain IS NOT NULL AND smartolt_subdomain != '' AND smartolt_api_key IS NOT NULL AND smartolt_api_key != '' ").all();
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
      'X-Token': config.smartolt_api_key,
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
      const existing = db.prepare('SELECT value FROM configuracion WHERE key LIKE \'onu_type_%\'').all();
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


    // Enviar mensaje de bienvenida por WhatsApp
    try {
      sendWelcomeMessage(servicioId, clienteId, plan_id, cicloVal);
    } catch(e) {
      console.log('[Bienvenida] Error al enviar mensaje (nuevo cliente):', e.message);
    }

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
  res.json({ status:'success', id: r.lastInsertRowid, message: 'Orden creada' });
});

// POST /api/ordenes/:id/completar - Completar orden
app.post('/api/ordenes/:id/completar', requireAuth, (req, res) => {
  const id = parseInt(req.params.id) || 0;
  if (!id) return res.json({ status:'error', msg:'ID requerido' });
  var usuarioId = req.session.user ? req.session.user.id : 0;
  try {
    const orden = db.prepare('SELECT * FROM ordenes WHERE id=?').get(id);
    if (!orden) return res.json({ status:'error', msg:'Orden no encontrada' });
    
    // Handle ONU swap for traslados
    var newOnuSn = req.body.new_onu_sn || '';
    var oltId = parseInt(req.body.olt_id) || 0;
    var servicioId = parseInt(req.body.servicio_id) || 0;
    
    if (orden.tipo === 'traslado' && newOnuSn) {
      // 1. Desvincular ONU vieja del servicio
      if (servicioId) {
        var oldOnu = db.prepare('SELECT id, sn, olt_id FROM onu WHERE servicio_id=?').get(servicioId);
        if (oldOnu) {
          db.prepare('UPDATE onu SET servicio_id=NULL, cliente_id=NULL WHERE id=?').run(oldOnu.id);
        }
      }
      
      // 2. Vincular ONU nueva al servicio
      var newOnu = db.prepare('SELECT id FROM onu WHERE sn=?').get(newOnuSn);
      if (newOnu) {
        db.prepare('UPDATE onu SET servicio_id=?, cliente_id=? WHERE id=?').run(servicioId, orden.cliente_id, newOnu.id);
      } else {
        // Create new ONU record if SN not in system
        var onuData = db.prepare('SELECT model FROM cambio_onu_swaps WHERE new_sn=? ORDER BY id DESC LIMIT 1').get(newOnuSn);
        var modelName = req.body.new_onu_model || (onuData ? onuData.model : '');
        db.prepare('INSERT INTO onu (sn, nombre, cliente_id, olt_id, servicio_id, estado) VALUES (?,?,?,?,?,\'activo\')').run(newOnuSn, modelName || 'ONU ' + newOnuSn, orden.cliente_id, oltId || null, servicioId);
      }
      
      // 3. Registrar en cambio_onu_swaps
      var oldSn = '';
      if (oldOnu && oldOnu.sn) oldSn = oldOnu.sn;
      try {
        db.prepare(`INSERT INTO cambio_onu_swaps (cliente_id, servicio_id, old_sn, new_sn, old_olt_id, new_olt_id, change_reason, created_by, estado, completed_at) VALUES (?,?,?,?,?,?,?,'completado','completado',datetime('now'))`).run(
          orden.cliente_id, servicioId, oldSn, newOnuSn, 
          (oldOnu ? oldOnu.olt_id : null), oltId || null,
          'Traslado - Orden #' + id, usuarioId
        );
      } catch(e) {}
      
            // 4. Autorizar ONU via API interna (mismo flujo que detalle de cliente)
      try {
        var http = require('http');
        var authBody = JSON.stringify({
          olt_id: oltId,
          serial: newOnuSn,
          model: req.body.new_onu_model || '',
          servicio_id: servicioId,
          cliente_nombre: orden.cliente_id ? (db.prepare('SELECT nombre FROM clientes WHERE id=?').get(orden.cliente_id) || {}).nombre || '' : '',
          onu_mode: 'Routing'
        });
        var internalReq = http.request({
          hostname: 'localhost', port: 3020, path: '/api/smartolt/onu/authorize',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(authBody),
            'Cookie': req.headers.cookie || ''
          }
        }, function(internalRes) {
          var d = '';
          internalRes.on('data', function(c) { d += c; });
          internalRes.on('end', function() {
            require('fs').appendFileSync('/tmp/isptotal.log', new Date().toISOString() + ' [TRASLADO-AUTH] Result: ' + d.substring(0,200) + '\n');
          });
        });
        internalReq.on('error', function(e) {
          require('fs').appendFileSync('/tmp/isptotal.log', new Date().toISOString() + ' [TRASLADO-AUTH] Error: ' + e.message + '\n');
        });
        internalReq.write(authBody);
        internalReq.end();
      } catch(eAuth) {
        require('fs').appendFileSync('/tmp/isptotal.log', new Date().toISOString() + ' [TRASLADO-AUTH] Init error: ' + eAuth.message + '\n');
      }
    
    }
    
    // Complete the order
    db.prepare("UPDATE ordenes SET estado='completada', tecnico_id=?, direccion=?, detalle=?, fecha_completada=datetime('now'), completada_por=? WHERE id=?")
      .run(req.body.tecnico_id || orden.tecnico_id, req.body.direccion || orden.direccion || '', (orden.detalle || '') + (req.body.observaciones ? ' | Res: ' + req.body.observaciones : ''), usuarioId, id);
    
    res.json({ status:'success', msg:'Orden completada' + (newOnuSn ? ' con cambio de ONU' : '') });
  } catch(e) { res.json({ status:'error', msg:e.message }); }
});

// POST /api/ordenes/:id/cancelar - Cancelar orden
app.post('/api/ordenes/:id/cancelar', requireAuth, (req, res) => {
  const id = parseInt(req.params.id) || 0;
  if (!id) return res.json({ status:'error', msg:'ID requerido' });
  try {
    db.prepare("UPDATE ordenes SET estado='cancelada' WHERE id=?").run(id);
    res.json({ status:'success', msg:'Orden cancelada' });
  } catch(e) { res.json({ status:'error', msg:e.message }); }
});

app.post('/api/pagos', requireAuth, (req, res) => {
  const { cliente_id, servicio_id, monto, metodo, factura_id } = req.body;
  const r = db.prepare('INSERT INTO pagos (cliente_id, servicio_id, monto, metodo, usuario_id) VALUES (?,?,?,?,?)')
    .run(cliente_id, servicio_id || null, monto, metodo, req.session.user.id);
  if (factura_id) {
    db.prepare('UPDATE facturas SET estado=\'pagada\' WHERE id=?').run(factura_id);
  }

  // Si el cliente tiene promesa activa, se marca como cumplida
  var promesaActiva = db.prepare("SELECT id FROM promesas_pago WHERE cliente_id=? AND estado='activa' LIMIT 1").get(cliente_id);
  if (promesaActiva) {
    db.prepare("UPDATE promesas_pago SET estado='cumplida' WHERE id=?").run(promesaActiva.id);
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
  const olt = db.prepare('SELECT * FROM olts WHERE id=? ').get(olt_id);
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
    // Enviar onu_type si está disponible (requerido por SmartOLT)
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
      var existingOnuList = searchData.onus || searchData.response || [];
      if (Array.isArray(existingOnuList) && existingOnuList.length > 0) {
        existingOnuId = existingOnuList[0].id || existingOnuList[0].onu_id || existingOnuList[0].external_id || existingOnuList[0].unique_external_id || null;
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
          // Validar que cliente_id y servicio_id existan antes de insertar
          var valCliente = clId ? db.prepare('SELECT id FROM clientes WHERE id=?').get(clId) : null;
          var valServicio = db.prepare('SELECT id FROM servicios WHERE id=?').get(servicio_id);
          var finalClId = valCliente ? clId : null;
          var finalSvcId = valServicio ? servicio_id : null;
          db.prepare('INSERT INTO onu (sn, nombre, cliente_id, olt_id, servicio_id, estado) VALUES (?,?,?,?,?,\'activo\') ON CONFLICT(sn) DO UPDATE SET cliente_id=COALESCE(excluded.cliente_id,onu.cliente_id), servicio_id=COALESCE(excluded.servicio_id,onu.servicio_id), olt_id=COALESCE(excluded.olt_id,onu.olt_id)')
            .run(serial, cliente_nombre || descripcion || serial, finalClId, olt_id, finalSvcId);
          require('fs').appendFileSync('/tmp/isptotal.log', '[AUTHORIZE-ONU] ONU vinculada a servicio #' + servicio_id + ' (cliente=' + (finalClId||'?') + ')\n');
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

// POST /api/smartolt/onu/scan - Scan unconfigured ONUs from specific SmartOLT (via MikroTik)
app.post('/api/smartolt/onu/scan', requireAuth, async (req, res) => {
  const { olt_id } = req.body;
  const olt = db.prepare('SELECT * FROM olts WHERE id=?').get(olt_id);
  if (!olt || !olt.smartolt_subdomain || !olt.smartolt_api_key) {
    return res.json({ success: false, message: 'OLT no configurada para SmartOLT' });
  }
  try {
    var data = await smartoltFetchOlt(olt, '/onu/unconfigured_onus', 'GET');
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
  const olt = db.prepare('SELECT * FROM olts WHERE id=? ').get(olt_id);
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

  const olt = db.prepare('SELECT * FROM olts WHERE id=? ').get(olt_id);
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

    const olt = db.prepare('SELECT * FROM olts WHERE id=? ').get(oltId);
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
  const olt = db.prepare('SELECT * FROM olts WHERE id=? ').get(olt_id);
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
  const olt = db.prepare('SELECT * FROM olts WHERE id=? ').get(oltId);
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
  const { client_id, service_id, sector_id, address, observations, crear_factura, precio_traslado, traslado_pagada } = req.body;
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

    // Crear factura de traslado si aplica
    var precio = parseFloat(precio_traslado) || 0;
    if (crear_factura && precio > 0) {
      var pagada = traslado_pagada === true || traslado_pagada === '1' || traslado_pagada === 1 ? 1 : 0;
      db.prepare("INSERT INTO facturas (servicio_id, periodo, monto, estado, fecha_emision, fecha_vencimiento) VALUES (?,?,?,?,date('now'),date('now','+30 days'))").run(service_id, 'Traslado', precio, pagada ? 'pagada' : 'pendiente');
      if (pagada) {
        db.prepare("INSERT INTO pagos (servicio_id, cliente_id, monto, metodo, usuario_id) VALUES (?,?,?,'efectivo',?)").run(service_id, client_id, precio, usuarioId);
      }
    }

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
    const olt = db.prepare('SELECT * FROM olts WHERE id=? ').get(oltId);
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
    const olt = db.prepare('SELECT * FROM olts WHERE id=? ').get(olt_id);
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
    const olt = db.prepare('SELECT * FROM olts WHERE id=? ').get(olt_id);
    if (!olt || !olt.smartolt_subdomain || !olt.smartolt_api_key) {
      return res.json({ success: false, message: 'OLT no configurada para SmartOLT' });
    }
    const apiUrl = 'https://' + olt.smartolt_subdomain + '.smartolt.com/api';

    // Delete old ONU first (if provided)
    if (req.body.old_sn && req.body.old_olt_id) {
      try {
        const oldOlt = db.prepare('SELECT * FROM olts WHERE id=? ').get(req.body.old_olt_id);
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
    // No enviamos onu_type para evitar error 'type not defined' en SmartOLT
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
    const olt = db.prepare('SELECT * FROM olts WHERE id=? ').get(olt_id);
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
    db.exec("CREATE TABLE IF NOT EXISTS wan_traffic (id INTEGER PRIMARY KEY AUTOINCREMENT, router_id INTEGER, bps_in REAL, bps_out REAL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
    db.exec("CREATE TABLE IF NOT EXISTS wan_daily_max (id INTEGER PRIMARY KEY AUTOINCREMENT, router_id INTEGER, fecha TEXT, max_bps_in REAL DEFAULT 0, max_bps_out REAL DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)");

    // Get user's preferred router, or fallback
    var routerId = req.query.router_id || null;
    var router = null;
    if (routerId) {
      router = db.prepare('SELECT * FROM routers WHERE id=?').get(routerId);
    }
    if (!router) router = db.prepare('SELECT * FROM routers WHERE connected=1 ORDER BY id DESC LIMIT 1').get();
    if (!router) router = db.prepare('SELECT * FROM routers ORDER BY id DESC LIMIT 1').get();
    if (!router) return res.json({ success: false, message: 'No hay routers configurados' });

    const MikroTikAPI = require('./mikrotik-api');
    const result = await MikroTikAPI.getTraffic(router.ip, router.port || 8728, router.user, router.password, router.interface_wan || 'ether1');

    var bps_in = result.success ? result.bps_in : 0;
    var bps_out = result.success ? result.bps_out : 0;

    // Get last 24h history
    const history = db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%S', created_at) as ts, bps_in, bps_out FROM wan_traffic WHERE router_id=? AND created_at >= datetime('now','-24 hours','localtime') ORDER BY created_at ASC").all(router.id);

    // ── Daily max tracking ──
    var today = new Date().toISOString().substring(0, 10);
    var dailyMax = db.prepare("SELECT * FROM wan_daily_max WHERE router_id=? AND fecha=?").get(router.id, today);
    if (!dailyMax) {
      db.prepare("INSERT INTO wan_daily_max (router_id, fecha, max_bps_in, max_bps_out) VALUES (?,?,?,?)").run(router.id, today, bps_in, bps_out);
      dailyMax = { max_bps_in: bps_in, max_bps_out: bps_out };
    } else {
      var newMaxIn = Math.max(dailyMax.max_bps_in, bps_in);
      var newMaxOut = Math.max(dailyMax.max_bps_out, bps_out);
      if (newMaxIn > dailyMax.max_bps_in || newMaxOut > dailyMax.max_bps_out) {
        db.prepare("UPDATE wan_daily_max SET max_bps_in=?, max_bps_out=?, updated_at=datetime('now') WHERE id=?").run(newMaxIn, newMaxOut, dailyMax.id);
        dailyMax.max_bps_in = newMaxIn;
        dailyMax.max_bps_out = newMaxOut;
      }
    }

    res.json({
      success: true,
      current: { bps_in: bps_in, bps_out: bps_out },
      max: { bps_in: dailyMax.max_bps_in, bps_out: dailyMax.max_bps_out },
      history: history
    });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

// Get user's preferred dashboard router
app.get('/api/dashboard/router-pref', requireAuth, (req, res) => {
  try {
    db.exec("CREATE TABLE IF NOT EXISTS configuracion (key TEXT PRIMARY KEY, value TEXT)");
    const row = db.prepare("SELECT value FROM configuracion WHERE key='dashboard_router_id'").get();
    res.json({ router_id: row ? row.value : null });
  } catch(e) {
    res.json({ router_id: null });
  }
});

// Set user's preferred dashboard router
app.post('/api/dashboard/set-router', requireAuth, (req, res) => {
  try {
    db.exec("CREATE TABLE IF NOT EXISTS configuracion (key TEXT PRIMARY KEY, value TEXT)");
    const rid = req.body.router_id;
    if (rid) {
      db.prepare("INSERT OR REPLACE INTO configuracion (key, value) VALUES ('dashboard_router_id', ?)").run(String(rid));
    } else {
      db.prepare("DELETE FROM configuracion WHERE key='dashboard_router_id'").run();
    }
    res.json({ success: true });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

// Auto-collect WAN traffic every 5 minutes
setInterval(async function() {
  try {
    var router = db.prepare('SELECT * FROM routers WHERE connected=1 ORDER BY id DESC LIMIT 1').get();
    if (!router) router = db.prepare('SELECT * FROM routers ORDER BY id DESC LIMIT 1').get();
    if (!router) return;
    db.exec("CREATE TABLE IF NOT EXISTS wan_traffic (id INTEGER PRIMARY KEY AUTOINCREMENT, router_id INTEGER, bps_in REAL, bps_out REAL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
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

// GET /api/servicios/:id - Obtener datos de un servicio
app.get('/api/servicios/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id) || 0;
  if (!id) return res.json({ success: false, message: 'ID requerido' });
  try {
    const svc = db.prepare(`
      SELECT s.*, p.nombre as plan_nombre, p.precio as plan_precio,
             z.id as zona_id, z.nombre as zona_nombre,
             o.sn as onu_sn
      FROM servicios s
      LEFT JOIN planes p ON p.id=s.plan_id
      LEFT JOIN zonas z ON z.id=s.zona_id
      LEFT JOIN onu o ON o.servicio_id=s.id
      WHERE s.id=?
    `).get(id);
    if (!svc) return res.json({ success: false, message: 'No encontrado' });
    res.json({ success: true, data: svc });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

// POST /api/servicios/editar - Editar servicio (también envía WiFi/WAN a ONU si aplica)
app.post('/api/servicios/editar', requireAuth, async (req, res) => {
  const { id, ip, plan_id, auth_type, pppoe_user, pppoe_pass, wifi_ssid, wifi_pass, direccion, tipo_servicio, ciclo_id, netflix_email, netflix_password, netflix_perfil, netflix_vencimiento, descripcion_servicio, precio_servicio } = req.body;
  if (!id) return res.json({ success: false, message: 'ID de servicio requerido' });
  try {
    db.prepare(`UPDATE servicios SET ip=?, plan_id=?, auth_type=?, pppoe_user=?, pppoe_pass=?, wifi_ssid=?, wifi_pass=?, direccion=?, tipo_servicio=?, ciclo_id=?, netflix_email=?, netflix_password=?, netflix_perfil=?, netflix_vencimiento=?, descripcion_servicio=?, precio_servicio=? WHERE id=?`)
      .run(ip || '', plan_id || null, auth_type || 'dhcp', pppoe_user || '', pppoe_pass || '', wifi_ssid || '', wifi_pass || '', direccion || '', tipo_servicio || 'internet', ciclo_id || null, netflix_email || '', netflix_password || '', netflix_perfil || '', netflix_vencimiento || null, descripcion_servicio || '', precio_servicio || 0, id);

    // ===== Enviar WiFi/WAN a la ONU via SmartOLT TR069 =====
    var tr069Promise = null;
    try {
      var onu = db.prepare('SELECT * FROM onu WHERE servicio_id=? ORDER BY id DESC LIMIT 1').get(id);
      if (onu && onu.sn && onu.olt_id) {
        var olt = db.prepare('SELECT * FROM olts WHERE id=? ').get(onu.olt_id);
        if (olt && olt.smartolt_subdomain && olt.smartolt_api_key) {
          require('fs').appendFileSync('/tmp/isptotal.log', '\\n[EDIT-SRV-' + id + '] ONU sn=' + onu.sn + ' olt=' + olt.smartolt_subdomain + ' sniff, enviando config...\\n');
          tr069Promise = (async function() {
            try {
              const apiUrl = 'https://' + olt.smartolt_subdomain + '.smartolt.com/api';
              // Get ONU external ID
              const detResp = await fetch(apiUrl + '/onu/get_onus_details_by_sn/' + onu.sn, {
                method: 'GET', headers: { 'X-Token': olt.smartolt_api_key, 'Accept': 'application/json' }
              });
              const detData = await detResp.json();
              let onuList = detData.onus || detData.response || [];
              if (onuList.length) {
                const extId = onuList[0].unique_external_id || onuList[0].id || onuList[0].onu_id || '';
                if (extId) {
                  // Set WiFi if service has SSID
                  if (wifi_ssid) {
                    try {
                      var wifiParams = new URLSearchParams();
                      wifiParams.append('wifi_port', 'wifi_0/1');
                      wifiParams.append('ssid', wifi_ssid);
                      wifiParams.append('password', wifi_pass || '');
                      wifiParams.append('authentication_mode', 'WPA2');
                      await fetch(apiUrl + '/onu/set_wifi_port_lan/' + extId, {
                        method: 'POST', headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: wifiParams
                      });
                      require('fs').appendFileSync('/tmp/isptotal.log', '[EDIT-SRV-' + id + '] WiFi configurado en ONU\\n');
                    } catch(eW) { require('fs').appendFileSync('/tmp/isptotal.log', '[EDIT-SRV-' + id + '] WiFi error: ' + eW.message + '\\n'); }
                  }
                  // Update WAN if auth_type changed / PPPoE creds changed
                  if (auth_type === 'pppoe' && pppoe_user) {
                    try {
                      var ppParams = new URLSearchParams();
                      ppParams.append('username', pppoe_user);
                      ppParams.append('password', pppoe_pass || '');
                      ppParams.append('configuration_method', 'TR069');
                      ppParams.append('ip_protocol', 'ipv4ipv6');
                      await fetch(apiUrl + '/onu/set_onu_wan_mode_pppoe/' + extId, {
                        method: 'POST', headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: ppParams
                      });
                      require('fs').appendFileSync('/tmp/isptotal.log', '[EDIT-SRV-' + id + '] WAN PPPoE actualizado en ONU\\n');
                    } catch(eP) { require('fs').appendFileSync('/tmp/isptotal.log', '[EDIT-SRV-' + id + '] WAN error: ' + eP.message + '\\n'); }
                  }
                  // Save config
                  try {
                    await fetch(apiUrl + '/system/save_config', { method: 'POST', headers: { 'X-Token': olt.smartolt_api_key } });
                    require('fs').appendFileSync('/tmp/isptotal.log', '[EDIT-SRV-' + id + '] Config guardada en OLT\\n');
                  } catch(eS) { require('fs').appendFileSync('/tmp/isptotal.log', '[EDIT-SRV-' + id + '] SaveConfig error: ' + eS.message + '\\n'); }
                }
              }
            } catch(eD) {
              require('fs').appendFileSync('/tmp/isptotal.log', '[EDIT-SRV-' + id + '] Error obteniendo extId: ' + eD.message + '\\n');
            }
          })();
        }
      }
    } catch(eO) {
      require('fs').appendFileSync('/tmp/isptotal.log', '[EDIT-SRV-' + id + '] Error buscando ONU: ' + eO.message + '\\n');
    }

    // No esperar a que termine TR069 para responder
    if (tr069Promise) {
      tr069Promise.catch(function() {});
    }

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

// POST /api/servicios/:id/retirar - Retirar servicio (como DomISP)
app.post('/api/servicios/:id/retirar', requireAuth, (req, res) => {
  const id = parseInt(req.params.id) || 0;
  if (!id) return res.json({ success: false, message: 'ID requerido' });
  try {
    var svc = db.prepare('SELECT s.*, o.sn as onu_sn, o.olt_id FROM servicios s LEFT JOIN onu o ON o.servicio_id=s.id WHERE s.id=?').get(id);
    if (!svc) return res.json({ success: false, message: 'Servicio no encontrado' });

    var motivo = (req.body.motivo || '').trim();

    db.prepare("UPDATE servicios SET estado='retirado', fecha_retiro=datetime('now','localtime'), motivo_retiro=? WHERE id=?").run(motivo, id);

    // Intentar eliminar ONU de SmartOLT
    try {
      if (svc.onu_sn && svc.olt_id) {
        var oltCfg = db.prepare('SELECT smartolt_subdomain, smartolt_api_key FROM olts WHERE id=?').get(svc.olt_id);
        if (oltCfg && oltCfg.smartolt_subdomain && oltCfg.smartolt_api_key) {
          // Buscar external_id de la ONU primero
          var searchUrl = 'https://' + oltCfg.smartolt_subdomain + '.smartolt.com/api/onu/get_onus_details_by_sn/' + svc.onu_sn;
          fetch(searchUrl, { headers: { 'X-Token': oltCfg.smartolt_api_key } }).then(function(r) { return r.json(); }).then(function(sd) {
            var list = sd.onus || sd.response || [];
            if (list.length > 0) {
              var extId = list[0].unique_external_id || list[0].id || list[0].onu_id || '';
              if (extId) {
                var delUrl = 'https://' + oltCfg.smartolt_subdomain + '.smartolt.com/api/onu/delete/' + extId;
                fetch(delUrl, { method: 'POST', headers: { 'X-Token': oltCfg.smartolt_api_key } }).catch(function() {});
              }
            }
          }).catch(function() {});
        }
      }
    } catch(e) {}

    // Eliminar ONU de BD local
    db.prepare('DELETE FROM onu WHERE servicio_id=?').run(id);

    db.logActivity(req.session.user, 'Retiró servicio #' + id + ': ' + motivo, 'Servicios', { servicio_id: id, usuario_id: req.session.user.id });

    res.json({ success: true, message: 'Servicio retirado correctamente' });
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
    db.prepare('DELETE FROM promesas_pago WHERE servicio_ids=? OR servicio_ids LIKE ? OR servicio_ids LIKE ? OR servicio_ids LIKE ?').run(String(id), '%,' + id + ',%', id + ',%', '%,' + id);
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
    const svc = db.prepare('SELECT s.*, c.id as cliente_id, p.nombre as plan_nombre FROM servicios s JOIN clientes c ON c.id=s.cliente_id LEFT JOIN planes p ON p.id=s.plan_id WHERE s.id=?').get(id);
    if (!svc) return res.json({ success: false, message: 'Servicio no encontrado' });
    const nuevoEstado = svc.estado === 'suspendido' ? 'activo' : 'suspendido';
    db.prepare("UPDATE servicios SET estado=?, fecha_suspension=CASE WHEN ?='suspendido' THEN datetime('now','localtime') ELSE fecha_suspension END WHERE id=?").run(nuevoEstado, nuevoEstado, id);

    // Enviar notificación según el estado
    if (nuevoEstado === 'suspendido') {
      (async function() {
        try {
          var openwa = require('./openwa-service');
          var cli = db.prepare('SELECT nombre, telefono FROM clientes WHERE id=?').get(svc.cliente_id);
          if (cli && cli.telefono) {
            var tpl = db.prepare("SELECT content FROM templates WHERE template_key='notif_suspension'").get();
            if (tpl && tpl.content) {
              var deuda = db.prepare("SELECT COALESCE(SUM(f.monto - COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0)),0) as total FROM facturas f WHERE f.servicio_id=? AND f.estado='pendiente'").get(id);
              var deudaTotal = deuda ? deuda.total : 0;
              var configRows = db.prepare("SELECT key, value FROM configuracion WHERE key IN ('empresa_nombre','empresa_telefono')").all();
              var config = { empresa_nombre: '', empresa_telefono: '' };
              configRows.forEach(function(r) { config[r.key] = r.value || ''; });
              var msg = tpl.content
                .replace(/{client_name}/g, cli.nombre || '')
                .replace(/{service_address}/g, svc.direccion || '')
                .replace(/{plan_name}/g, svc.plan_nombre || '')
                .replace(/{invoice_remaining}/g, '$' + deudaTotal.toFixed(2))
                .replace(/{company_phone}/g, config.empresa_telefono || '')
                .replace(/{company_name}/g, config.empresa_nombre || '')
                .replace(/{current_date}/g, new Date().toLocaleDateString('es-DO'));
              openwa.encolarMensaje(svc.cliente_id, id, cli.telefono, msg, 'suspension');
            }
          }
        } catch(eNotif) { console.log('[Suspender] Error notificación:', eNotif.message); }
      })();
    } else if (nuevoEstado === 'activo') {
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



// ======== TENANT PROFILE API ========
app.get('/api/tenant/profile', requireAuth, (req, res) => {
  if (!req.session.isTenant) {
    return res.json({ status: 'success', username: req.session.user.username, company_name: 'Administrador', email: (db.prepare("SELECT value FROM configuracion WHERE key='empresa_correo'").get() || {}).value || '', license_active: true, max_clients: 'Ilimitado', client_count: (db.prepare('SELECT COUNT(*) as c FROM clientes').get() || {}).c || 0, created_at: 'Administrador' });
  }
  try {
    var Database = require('better-sqlite3');
    var path = require('path');
    var mdb = new Database(path.join(__dirname, '..', 'data', 'master.db'));
    var company = mdb.prepare('SELECT * FROM companies WHERE id=?').get(req.session.user.id);
    mdb.close();
    if (!company) return res.json({ status: 'error', msg: 'No encontrada' });
    var cc = 0; try { var tdb2 = mt.getTenantDb(company.db_path); if (tdb2) { var r2 = tdb2.prepare('SELECT COUNT(*) as c FROM clientes').get(); cc = r2 ? r2.c : 0; tdb2.close(); } } catch(e) {}
    res.json({ status: 'success', username: company.username, company_name: company.company_name, email: company.email, license_active: !!company.license_active, max_clients: company.max_clients || 25, client_count: cc, created_at: company.created_at });
  } catch(e) { res.json({ status: 'error', msg: e.message }); }
});

app.post('/api/tenant/profile', requireAuth, (req, res) => {
  if (!req.session.isTenant) return res.json({ status: 'error', msg: 'Solo para usuarios registrados' });
  try {
    var { email, current_password, new_password } = req.body;
    if (!email || !current_password) return res.json({ status: 'error', msg: 'Campos requeridos' });
    var bcrypt2 = require('bcrypt');
    var Database2 = require('better-sqlite3');
    var path2 = require('path');
    var mdb2 = new Database2(path2.join(__dirname, '..', 'data', 'master.db'));
    var company2 = mdb2.prepare('SELECT * FROM companies WHERE id=?').get(req.session.user.id);
    if (!company2 || !bcrypt2.compareSync(current_password, company2.password)) { mdb2.close(); return res.json({ status: 'error', msg: 'Contraseña incorrecta' }); }
    if (email !== company2.email) { mdb2.prepare('UPDATE companies SET email=? WHERE id=?').run(email, company2.id); }
    if (new_password) {
      if (new_password.length < 6) { mdb2.close(); return res.json({ status: 'error', msg: 'Mínimo 6 caracteres' }); }
      var nh = bcrypt2.hashSync(new_password, 10);
      mdb2.prepare('UPDATE companies SET password=? WHERE id=?').run(nh, company2.id);
      try { var tdb3 = mt.getTenantDb(company2.db_path); if (tdb3) { tdb3.prepare('UPDATE usuarios SET password=? WHERE username=?').run(nh, company2.username); tdb3.close(); } } catch(e) {}
    }
    mdb2.close();
    res.json({ status: 'success', msg: 'Perfil actualizado' });
  } catch(e) { res.json({ status: 'error', msg: e.message }); }
});
// ======== GPON MANAGER API ========
const ZteOLT = require('./zte-olt');
var gponConnections = {}; // { userId: ZteOLT instance }
var gponDataCache = {}; // { userId: { data, timestamp } }
var gponConfigMap = {}; // { userId: { oltId, host, port, user, pass, socksHost, socksPort } }

// ---- Cache persistente en SQLite ----
// Inicializar tabla de caché GPON
function initGponDbCache() {
  db.exec("CREATE TABLE IF NOT EXISTS gpon_cache (id INTEGER PRIMARY KEY CHECK(id=1), configured_json TEXT, unconfigured_json TEXT, state_json TEXT, total_count INTEGER DEFAULT 0, online_count INTEGER DEFAULT 0, offline_count INTEGER DEFAULT 0, pending_count INTEGER DEFAULT 0, updated_at DATETIME)");
  // Insert row if not exists
  var row = db.prepare('SELECT id FROM gpon_cache WHERE id=1').get();
  if (!row) {
    db.prepare("INSERT INTO gpon_cache (id, updated_at) VALUES (1, datetime('now'))").run();
  }
}
initGponDbCache();

function saveGponCache(configured, unconfigured, state, total, online, offline, pending) {
  try {
    db.prepare("UPDATE gpon_cache SET configured_json=?, unconfigured_json=?, state_json=?, total_count=?, online_count=?, offline_count=?, pending_count=?, updated_at=datetime('now') WHERE id=1")
      .run(JSON.stringify(configured), JSON.stringify(unconfigured), JSON.stringify(state), total, online, offline, pending);
  } catch(e) {
    console.log('[GPON-CACHE] Error saving to DB:', e.message);
  }
}

function loadGponCache() {
  try {
    var row = db.prepare('SELECT * FROM gpon_cache WHERE id=1').get();
    if (!row || !row.updated_at) return null;
    return {
      configured: row.configured_json ? JSON.parse(row.configured_json) : [],
      unconfigured: row.unconfigured_json ? JSON.parse(row.unconfigured_json) : [],
      state: row.state_json ? JSON.parse(row.state_json) : [],
      total_count: row.total_count || 0,
      online_count: row.online_count || 0,
      offline_count: row.offline_count || 0,
      pending_count: row.pending_count || 0,
      updated_at: row.updated_at
    };
  } catch(e) {
    console.log('[GPON-CACHE] Error loading from DB:', e.message);
    return null;
  }
}

function getGponCache(req) {
  var key = getOltKey(req);
  var cache = gponDataCache[key];
  if (cache && (Date.now() - cache.timestamp < 300000)) return cache.data; // 5 min cache
  return null;
}

function setGponCache(req, data) {
  var key = getOltKey(req);
  gponDataCache[key] = { data: data, timestamp: Date.now() };
}

function storeOltConfig(req, oltId) {
  var key = getOltKey(req);
  if (oltId) {
    var cfg = db.prepare('SELECT * FROM olts WHERE id=?').get(oltId);
    if (cfg) {
      gponConfigMap[key] = { oltId: oltId, host: cfg.olt_ip, port: cfg.olt_port, user: cfg.olt_username, pass: cfg.olt_password, socksHost: cfg.socks_host, socksPort: cfg.socks_port };
    }
  }
}

async function ensureOltConnection(req) {
  // Check if already connected
  var olt = getOltConnection(req);
  if (olt && olt.isConnected && olt.isConnected()) return olt;

  // Try to reconnect from stored config
  var key = getOltKey(req);
  var cfg = gponConfigMap[key];
  if (!cfg) {
    // Try first OLT from DB
    var firstOlt = db.prepare("SELECT * FROM olts WHERE olt_ip IS NOT NULL AND olt_ip != '' ORDER BY id LIMIT 1").get();
    if (firstOlt) {
      cfg = { oltId: firstOlt.id, host: firstOlt.olt_ip, port: firstOlt.olt_port, user: firstOlt.olt_username, pass: firstOlt.olt_password, socksHost: firstOlt.socks_host, socksPort: firstOlt.socks_port };
      gponConfigMap[key] = cfg;
    }
  }

  if (cfg) {
    try {
      var ZteOLT = require('./zte-olt');
      var newOlt = new ZteOLT(
        { host: cfg.socksHost || '2803:5a10:2:2800::2', port: cfg.socksPort || 1080 },
        { host: cfg.host || '192.168.20.80', username: cfg.user || 'zte', password: cfg.pass || 'zte' }
      );
      await newOlt.connect();
      setOltConnectionRaw(key, newOlt);
      return newOlt;
    } catch(e) {
      console.log('[GPON] Auto-reconnect failed:', e.message);
    }
  }
  return null;
}

function setOltConnectionRaw(key, olt) {
  gponConnections[key] = olt;
}

function getOltKey(req) {
  // Usar user ID si está autenticado, sino session ID
  return req.session.user ? ('user_' + req.session.user.id) : ('sess_' + req.session.id);
}

function getOltConnection(req) {
  var key = getOltKey(req);
  return gponConnections[key] || null;
}

function setOltConnection(req, olt) {
  var key = getOltKey(req);
  gponConnections[key] = olt;
}

function clearOltConnection(req) {
  var key = getOltKey(req);
  delete gponConnections[key];
}

// GET /api/gpon/config - Obtener config de OLT
app.get('/api/gpon/config', requireAuth, async (req, res) => {
  try {
    var olts = db.prepare('SELECT id, nombre, olt_ip, olt_port, olt_username, olt_password, socks_host, socks_port, tipo FROM olts ORDER BY id').all();
    res.json({ success: true, data: olts });
  } catch(e) {
    res.json({ success: false, msg: e.message });
  }
});

// POST /api/gpon/config/save - Guardar config de OLT
app.post('/api/gpon/config/save', requireAuth, async (req, res) => {
  try {
    var oltId = parseInt(req.body.id) || 0;
    var oltIp = (req.body.olt_ip || '192.168.20.80').trim();
    var oltPort = parseInt(req.body.olt_port) || 23;
    var oltUsername = (req.body.olt_username || 'zte').trim();
    var oltPassword = (req.body.olt_password || 'zte').trim();
    var socksHost = (req.body.socks_host || '2803:5a10:2:2800::2').trim();
    var socksPort = parseInt(req.body.socks_port) || 1080;

    if (oltId) {
      db.prepare('UPDATE olts SET olt_ip=?, olt_port=?, olt_username=?, olt_password=?, socks_host=?, socks_port=? WHERE id=?').run(oltIp, oltPort, oltUsername, oltPassword, socksHost, socksPort, oltId);
    } else {
      var r = db.prepare('INSERT INTO olts (nombre, olt_ip, olt_port, olt_username, olt_password, socks_host, socks_port, tipo) VALUES (?,?,?,?,?,?,?,\'local\')').run('Mi OLT', oltIp, oltPort, oltUsername, oltPassword, socksHost, socksPort);
      oltId = r.lastInsertRowid;
    }

    db.logActivity(req.session.user, 'Configuró OLT #' + oltId, 'GPON', { usuario_id: req.session.user.id });
    res.json({ success: true, msg: 'OLT configurada', id: oltId });
  } catch(e) {
    res.json({ success: false, msg: 'Error: ' + e.message });
  }
});

// POST /api/gpon/connect - Conectar a OLT via SOCKS proxy (MikroTik) + telnet
app.post('/api/gpon/connect', requireAuth, async (req, res) => {
  try {
    var oltConfig;
    var oltId = parseInt(req.body.olt_id) || 0;

    if (oltId) {
      oltConfig = db.prepare('SELECT * FROM olts WHERE id=?').get(oltId);
    } else {
      // Usar la primera OLT configurada
      oltConfig = db.prepare("SELECT * FROM olts WHERE olt_ip IS NOT NULL AND olt_ip != '' ORDER BY id LIMIT 1").get();
    }

    if (!oltConfig) {
      return res.json({ success: false, msg: 'No hay OLT configurada. Ve a Configuraci\u00f3n > OLT primero.' });
    }

    var socksHost = oltConfig.socks_host || '2803:5a10:2:2800::2';
    var socksPort = parseInt(oltConfig.socks_port) || 1080;
    var oltHost = oltConfig.olt_ip || '192.168.20.80';
    var oltPort = parseInt(oltConfig.olt_port) || 23;
    var oltUser = oltConfig.olt_username || 'zte';
    var oltPass = oltConfig.olt_password || 'zte';

    var olt = new ZteOLT(
      { host: socksHost, port: socksPort },
      { host: oltHost, username: oltUser, password: oltPass }
    );
    await olt.connect();
    setOltConnection(req, olt);
    storeOltConfig(req, oltId || oltConfig.id);

    res.json({ success: true, msg: 'Conectado a OLT ' + oltHost + ' via SOCKS proxy' });
  } catch(e) {
    res.json({ success: false, msg: 'Error: ' + e.message });
  }
});

// POST /api/gpon/disconnect - Desconectar
app.post('/api/gpon/disconnect', requireAuth, async (req, res) => {
  try {
    var olt = await ensureOltConnection(req);
    if (olt) await olt.disconnect();
    clearOltConnection(req);
    res.json({ success: true });
  } catch(e) {
    res.json({ success: false, msg: e.message });
  }
});

// GET /api/gpon/onus - Obtener lista de ONUs
// Lee INSTANTÁNEAMENTE desde la DB local (cache persistente)
// El background refresh service actualiza los datos cada 3 minutos
app.get('/api/gpon/onus', requireAuth, async (req, res) => {
  try {
    var dbOnus = db.prepare('SELECT o.*, c.nombre as cliente_nombre FROM onu o LEFT JOIN clientes c ON c.id=o.cliente_id ORDER BY o.id DESC').all();

    // === 1. Intentar cache en memoria primero (ultra rápido) ===
    var cached = gponDataCache['background'];
    if (cached && (Date.now() - cached.timestamp < 240000)) { // 4 min cache
      return res.json(cached.data);
    }

    // === 2. Cache en DB (persistente) ===
    var dbCache = loadGponCache();
    if (dbCache && dbCache.total_count > 0) {
      var gponResult = {
        success: true,
        configured: dbCache.configured || [],
        unconfigured: dbCache.unconfigured || [],
        state: dbCache.state || dbCache.configured || [],
        db_onus: dbOnus,
        low_signal: 0
      };
      // Cachear en memoria también
      gponDataCache['background'] = { data: gponResult, timestamp: Date.now() };
      return res.json(gponResult);
    }

    // Fallback: DB local
    var mergedState = [];
    if (dbOnus.length > 0) {
      mergedState = dbOnus.map(function(d) {
        return { port: '', onuId: d.sn || '', sn: d.sn || '', name: d.cliente_nombre || '', state: d.estado || 'unknown', adminState: 'unknown', omccState: 'unknown', phaseState: 'unknown' };
      });
    }

    var result = {
      success: true,
      configured: mergedState,
      unconfigured: [],
      state: mergedState,
      db_onus: dbOnus,
      low_signal: 0
    };

    res.json(result);
  } catch(e) {
    console.log('[GPON] Error en /api/gpon/onus:', e.message);
    res.json({ success: false, msg: 'Error: ' + e.message });
  }
});

// POST /api/gpon/authorize - Autorizar ONU (vía telnet directo OLT)
app.post('/api/gpon/authorize', requireAuth, async (req, res) => {
  try {
    var olt = await ensureOltConnection(req);
    if (!olt) return res.json({ success: false, msg: 'No conectado a OLT' });

    var sn = (req.body.sn || '').trim().toUpperCase();
    var port = req.body.port || '';
    var profile = parseInt(req.body.profile) || 1;
    var lineProfile = parseInt(req.body.line_profile) || 1;
    var clienteId = req.body.cliente_id || null;
    var nombre = (req.body.nombre || '').trim();
    var vlan = (req.body.vlan || '').trim();
    var planId = parseInt(req.body.plan_id) || 0;

    if (!sn) return res.json({ success: false, msg: 'SN requerido' });

    // Si no se especificó puerto, buscar uno libre automáticamente
    if (!port) {
      var onus = await olt.getConfiguredOnus();
      var usedPorts = {};
      onus.forEach(function(o) { if (o.port) usedPorts[o.port] = (usedPorts[o.port] || 0) + 1; });
      for (var s = 1; s <= 3; s++) {
        for (var p = 1; p <= 8; p++) {
          var portKey = '1/' + s + '/' + p;
          if ((usedPorts[portKey] || 0) < 64) { port = portKey; break; }
        }
        if (port) break;
      }
      if (!port) return res.json({ success: false, msg: 'No hay puertos disponibles en la OLT' });
    }

    // Asignar perfil según plan si no se especificó
    if (planId && profile === 1) {
      var plan = db.prepare('SELECT * FROM planes WHERE id=?').get(planId);
      if (plan) {
        var dlProfile = (plan.perfil_olt_descarga || '').replace(/[^0-9]/g, '');
        var speed = parseInt(dlProfile) || 0;
        if (speed <= 10) profile = 2;
        else if (speed <= 30) profile = 3;
        else if (speed <= 50) profile = 4;
        else if (speed <= 100) profile = 5;
        else if (speed <= 200) profile = 6;
        else if (speed <= 500) profile = 7;
        else profile = 8;
      }
    }

    var parts = port.split('/');
    var frame = parseInt(parts[0]) || 1;
    var slot = parseInt(parts[1]) || 2;
    var portNum = parseInt(parts[2]) || 1;

    var result = await olt.authorizeOnu(frame, slot, portNum, sn, profile, lineProfile);

    if (result.success) {
      var oltId = 6;

      // Guardar en BD local con todos los datos
      var insertData = {
        sn: sn,
        nombre: nombre || 'ONU ' + sn,
        vlan: vlan || null,
        plan_id: planId || null,
        cliente_id: clienteId || null,
        olt_id: oltId
      };

      if (clienteId) {
        db.prepare("INSERT INTO onu (sn, nombre, cliente_id, vlan, olt_id, estado, created_at) VALUES (?, ?, ?, ?, ?, 'activo', datetime('now'))").run(sn, nombre || 'ONU ' + sn, clienteId, vlan || null, oltId);
      } else {
        db.prepare("INSERT INTO onu (sn, nombre, vlan, cliente_id, olt_id, estado, created_at) VALUES (?, ?, ?, ?, ?, 'activo', datetime('now'))").run(sn, nombre || 'ONU ' + sn, vlan || null, null, oltId);
      }

      res.json({ success: true, msg: 'ONU ' + sn + ' autorizada en puerto ' + port });
    } else {
      res.json({ success: false, msg: result.output || 'Error al autorizar' });
    }
  } catch(e) {
    res.json({ success: false, msg: 'Error: ' + e.message });
  }
});

// POST /api/gpon/sync - Sincronizar ONUs desde SmartOLT a DB local
// Toma los datos de SmartOLT (con SN, nombres, zonas) y los guarda en la tabla onu
// Así al consultar la DB local ya tenemos los nombres aunque la OLT no los tenga
app.post('/api/gpon/sync', requireAuth, async (req, res) => {
  try {
    var stats = { added: 0, updated: 0, skipped: 0, errors: 0 };
    
    // 1. Obtener ONUs configuradas desde SmartOLT (tienen SN + nombre)
    var smartoltData = null;
    try {
      var p = new Promise(function(resolve) {
        smartoltFetch('/onu/configured_onus/status', 'GET').then(function(data) { resolve(data); }).catch(function() { resolve(null); });
        setTimeout(function() { resolve(null); }, 15000);
      });
      smartoltData = await p;
    } catch(e) {}
    
    if (!smartoltData || !smartoltData.response || smartoltData.response.length === 0) {
      return res.json({ success: false, msg: 'No se pudieron obtener datos de SmartOLT' });
    }
    
    // 2. Para cada ONU de SmartOLT, guardar/actualizar en DB local
    var oltId = 6; // ID por defecto de la OLT
    smartoltData.response.forEach(function(apiOnu) {
      if (!apiOnu.sn || apiOnu.sn.length < 8) {
        stats.skipped++;
        return;
      }
      try {
        var sn = apiOnu.sn;
        var name = apiOnu.location_name || '';
        var description = apiOnu.description || ''; // "gpon-onu_1/3/3:1"
        
        var existing = db.prepare('SELECT id, nombre FROM onu WHERE sn=?').get(sn);
        if (existing) {
          // Actualizar nombre si estaba vacío
          if (!existing.nombre && name) {
            db.prepare('UPDATE onu SET nombre=?, olt_id=? WHERE id=?').run(name, oltId, existing.id);
            stats.updated++;
          } else {
            stats.skipped++;
          }
        } else {
          // Insertar nueva ONU
          db.prepare("INSERT INTO onu (sn, nombre, olt_id, estado, created_at) VALUES (?, ?, ?, 'activo', datetime('now'))").run(sn, name, oltId);
          stats.added++;
        }
      } catch(e) {
        stats.errors++;
      }
    });
    
    // 3. También sincronizar ONUs no configuradas (pendientes)
    try {
      var p2 = new Promise(function(resolve) {
        smartoltFetch('/onu/unconfigured_onus', 'GET').then(function(data) { resolve(data); }).catch(function() { resolve(null); });
        setTimeout(function() { resolve(null); }, 10000);
      });
      var unconfData = await p2;
      if (unconfData && unconfData.response) {
        unconfData.response.forEach(function(u) {
          if (!u.sn || u.sn.length < 8) return;
          try {
            var existing = db.prepare('SELECT id FROM onu WHERE sn=?').get(u.sn);
            if (!existing) {
              db.prepare("INSERT INTO onu (sn, olt_id, estado, created_at) VALUES (?, ?, 'pendiente', datetime('now'))").run(u.sn, oltId);
              stats.added++;
            }
          } catch(e) { stats.errors++; }
        });
      }
    } catch(e) {}
    
    res.json({ 
      success: true, 
      msg: stats.added + ' agregadas, ' + stats.updated + ' actualizadas, ' + stats.skipped + ' omitidas' + (stats.errors ? ', ' + stats.errors + ' errores' : '')
    });
  } catch(e) {
    res.json({ success: false, msg: 'Error: ' + e.message });
  }
});

// GET /api/gpon/signal/:sn - Obtener señal de ONU
app.get('/api/gpon/signal/:sn', requireAuth, async (req, res) => {
  try {
    var olt = await ensureOltConnection(req);
    if (!olt) return res.json({ success: false, msg: 'No conectado a OLT' });

    var signal = await olt.getOnuSignal(req.params.sn);
    res.json({ success: true, data: signal });
  } catch(e) {
    res.json({ success: false, msg: 'Error: ' + e.message });
  }
});

// GET /api/gpon/onus/detailed - ONUs configuradas + pendientes
// Lee de la CACHÉ en DB (actualizada cada 3 min por background refresh)
app.get('/api/gpon/onus/detailed', requireAuth, async (req, res) => {
  try {
    // 1. Intentar cache en memoria primero
    var cached = gponDataCache['background'];
    if (cached && (Date.now() - cached.timestamp < 240000)) {
      var data = cached.data;
      // Combinar configured con pending
      var allOnus = (data.configured || []).map(function(o) {
        return { id: '', sn: o.sn || '', name: o.name || '', description: o.onuId || '', onuId: o.onuId || '', port: o.port || '', state: o.state || 'unknown', type: 'configured', zone_name: o.zone_name || '', onu_type_name: o.onu_type_name || '', wan_mode: o.wan_mode || o.mode || '', vlan: o.vlan || '' };
      });
      (data.unconfigured || []).forEach(function(p) {
        allOnus.push({
          id: '',
          sn: p.sn || '',
          name: 'Pendiente',
          description: 'Board: ' + (p.board || '?') + ' Port: ' + (p.port || '?'),
          onuId: p.sn || '',
          port: (p.board || '') + '/' + (p.port || ''),
          state: 'pending',
          type: 'unconfigured',
          zone_name: '',
          onu_type_name: p.onu_type_name || '',
          wan_mode: '',
          vlan: ''
        });
      });
      return res.json({ success: true, onus: allOnus });
    }

    // 2. Fallback: leer de DB cache
    var dbCache = loadGponCache();
    if (dbCache && dbCache.configured && dbCache.configured.length > 0) {
      var allOnus = (dbCache.configured || []).map(function(o) {
        return { id: '', sn: o.sn || '', name: o.name || '', description: o.onuId || '', onuId: o.onuId || '', port: o.port || '', state: o.state || 'unknown', type: 'configured', zone_name: o.zone_name || '', onu_type_name: o.onu_type_name || '', wan_mode: o.wan_mode || o.mode || '', vlan: o.vlan || '' };
      });
      (dbCache.unconfigured || []).forEach(function(p) {
        allOnus.push({
          id: '',
          sn: (typeof p === 'string') ? p : (p.sn || ''),
          name: 'Pendiente',
          description: 'SN: ' + ((typeof p === 'string') ? p : (p.sn || '')),
          onuId: (typeof p === 'string') ? p : (p.sn || ''),
          port: '',
          state: 'pending',
          type: 'unconfigured',
          zone_name: '',
          onu_type_name: (typeof p === 'object' && p.onu_type_name) ? p.onu_type_name : '',
          wan_mode: '',
          vlan: ''
        });
      });
      return res.json({ success: true, onus: allOnus });
    }

    res.json({ success: true, onus: [] });
  } catch(e) {
    console.log('[GPON] Error detailed:', e.message);
    res.json({ success: false, msg: 'Error: ' + e.message, onus: [] });
  }
});

// GET /api/gpon/onu/detail/:sn - Obtener detalles de una ONU (SmartOLT + DB local + señal)
// Acepta tanto SN como ONU ID (ej: gpon-onu_1/2/1:1)
app.get('/api/gpon/onu/detail/:sn', requireAuth, async (req, res) => {
  try {
    var sn = (req.params.sn || '').trim();
    if (!sn) return res.json({ success: false, msg: 'ID requerido' });
    
    var resolvedSn = sn;
    var isOnuId = sn.indexOf('gpon-onu_') === 0;
    
    // Si es ONU ID, buscar SN en caché
    if (isOnuId) {
      var cache = gponDataCache['background'];
      var data = cache ? cache.data : null;
      if (data && data.configured) {
        var found = data.configured.find(function(o) { return o.onuId === sn; });
        if (found && found.sn) resolvedSn = found.sn;
      }
      if (!resolvedSn || resolvedSn === sn) {
        // Fallback: buscar en DB cache
        var dbCache = loadGponCache();
        if (dbCache && dbCache.configured) {
          var found = dbCache.configured.find(function(o) { return o.onuId === sn; });
          if (found && found.sn) resolvedSn = found.sn;
        }
      }
    }

    // 1. Buscar en DB local
    var local = db.prepare('SELECT o.*, c.nombre as cliente_nombre, c.telefono, c.direccion FROM onu o LEFT JOIN clientes c ON c.id=o.cliente_id WHERE o.sn=?').get(resolvedSn);
    
    // Si no se encontró por SN, buscar por descripción
    if (!local && isOnuId) {
      local = db.prepare('SELECT o.*, c.nombre as cliente_nombre, c.telefono, c.direccion FROM onu o LEFT JOIN clientes c ON c.id=o.cliente_id WHERE o.puerto_olt=?').get(sn);
    }

    // 2. Buscar en SmartOLT (solo si tenemos un SN real)
    var smartolt = null;
    if (resolvedSn && resolvedSn.length >= 8 && !isOnuId) {
      try {
        var p = new Promise(function(resolve) {
          smartoltFetch('/onu/get_onus_details_by_sn/' + resolvedSn, 'GET').then(function(d) { resolve(d); }).catch(function() { resolve(null); });
          setTimeout(function() { resolve(null); }, 10000);
        });
        var data = await p;
        if (data && data.onus && data.onus.length > 0) {
          smartolt = data.onus[0];
        }
      } catch(e) {}

      // 3. Buscar señal óptica
      var signal = null;
      try {
        var p2 = new Promise(function(resolve) {
          smartoltFetch('/onu/get_onu_full_status_info/' + resolvedSn, 'GET').then(function(d) { resolve(d); }).catch(function() { resolve(null); });
          setTimeout(function() { resolve(null); }, 8000);
        });
        var sigData = await p2;
        if (sigData && sigData.full_status_json) {
          signal = sigData.full_status_json;
        }
      } catch(e) {}
      return res.json({ success: true, data: { sn: resolvedSn, onuId: isOnuId ? sn : '', local: local || null, smartolt: smartolt, signal: signal || null } });
    }
    
    res.json({ success: true, data: { sn: resolvedSn, onuId: isOnuId ? sn : '', local: local || null, smartolt: smartolt, signal: null } });
  } catch(e) {
    console.log('[GPON] Error detail:', e.message);
    res.json({ success: false, msg: 'Error: ' + e.message });
  }
});

// POST /api/gpon/onu/save - Guardar cambios de una ONU
app.post('/api/gpon/onu/save', requireAuth, async (req, res) => {
  try {
    var sn = (req.body.sn || '').trim();
    var nombre = (req.body.nombre || '').trim();
    var zona = (req.body.zona || '').trim();
    var vlan = (req.body.vlan || '').trim();
    var onuType = (req.body.onu_type || '').trim();

    if (!sn) return res.json({ success: false, msg: 'SN requerido' });

    var existing = db.prepare('SELECT id FROM onu WHERE sn=?').get(sn);
    if (existing) {
      var updates = [];
      var params = [];
      if (nombre) { updates.push('nombre=?'); params.push(nombre); }
      if (zona) { updates.push('zona=?'); params.push(zona); }
      if (vlan) { updates.push('vlan=?'); params.push(vlan); }
      if (onuType) { updates.push('onu_type=?'); params.push(onuType); }
      if (updates.length > 0) {
        params.push(sn);
        db.prepare('UPDATE onu SET ' + updates.join(',') + ' WHERE sn=?').run.apply(null, params);
      }
    } else {
      db.prepare("INSERT INTO onu (sn, nombre, zona, vlan, onu_type, olt_id, estado, created_at) VALUES (?, ?, ?, ?, ?, 6, 'activo', datetime('now'))").run(sn, nombre || '', zona || '', vlan || '', onuType || '');
    }

    res.json({ success: true, msg: 'ONU actualizada' });
  } catch(e) {
    res.json({ success: false, msg: 'Error: ' + e.message });
  }
});

// ======== SMARTOLT REPLACEMENT - NUEVOS ENDPOINTS ========

// GET /api/gpon/onus/all - Listar TODAS las ONUs con estado + detalle
app.get('/api/gpon/onus/all', requireAuth, async (req, res) => {
  try {
    var olt = await ensureOltConnection(req);
    if (!olt) return res.json({ success: false, msg: 'No conectado a OLT' });

    var onus = await olt.getConfiguredOnus();
    var uncfg = await olt.getUnconfiguredOnus();

    // Enriquecer con datos de BD local
    onus.forEach(function(o) {
      var dbOnu = db.prepare('SELECT * FROM onu WHERE sn=?').get(o.sn);
      if (dbOnu) {
        o.nombre = dbOnu.nombre || o.nombre;
        o.cliente_id = dbOnu.cliente_id;
        o.zona = dbOnu.zona;
        o.vlan = dbOnu.vlan;
        o.onu_type = dbOnu.onu_type;
      }
      if (o.sn) {
        var cli = db.prepare('SELECT c.nombre, c.id FROM clientes c JOIN servicios s ON s.cliente_id=c.id JOIN onu o2 ON o2.sn=? WHERE o2.sn=? LIMIT 1').get(o.sn, o.sn);
        if (!cli) cli = db.prepare('SELECT c.nombre, c.id FROM onu o2 JOIN clientes c ON c.id=o2.cliente_id WHERE o2.sn=? LIMIT 1').get(o.sn);
        if (cli) o.cliente_nombre = cli.nombre;
      }
    });

    res.json({ success: true, data: { onus: onus, uncfg: uncfg } });
  } catch(e) {
    res.json({ success: false, msg: 'Error: ' + e.message });
  }
});

// POST /api/gpon/onu/action - Acciones: delete, disable, enable, reboot, factory-reset, signal
app.post('/api/gpon/onu/action', requireAuth, async (req, res) => {
  try {
    var olt = await ensureOltConnection(req);
    if (!olt) return res.json({ success: false, msg: 'No conectado a OLT' });

    var action = req.body.action || '';
    var onuId = req.body.onu_id || '';
    var sn = req.body.sn || '';

    if (!action || !onuId) return res.json({ success: false, msg: 'Acción y ONU ID requeridos' });

    var result;
    switch(action) {
      case 'delete':
        var m = onuId.match(/gpon-onu_(\S+):(\d+)/);
        if (!m) return res.json({ success: false, msg: 'Formato inválido' });
        result = await olt.deleteOnu(m[1], m[2]);
        if (result.success) {
          if (sn) db.prepare('DELETE FROM onu WHERE sn=?').run(sn);
          await olt.saveConfig();
        }
        break;
      case 'disable': result = await olt.disableOnu(onuId); break;
      case 'enable': result = await olt.enableOnu(onuId); break;
      case 'reboot': result = await olt.rebootOnu(onuId); break;
      case 'factory-reset': result = await olt.factoryResetOnu(onuId); break;
      case 'signal':
        if (!sn) return res.json({ success: false, msg: 'SN requerido para señal' });
        var sig = await olt.getOnuSignal(sn);
        return res.json({ success: true, data: sig });
      default:
        return res.json({ success: false, msg: 'Acción desconocida: ' + action });
    }

    res.json({
      success: result.success,
      msg: result.success ? 'Acción completada: ' + action : (result.output || result.msg || 'Error')
    });
  } catch(e) {
    res.json({ success: false, msg: 'Error: ' + e.message });
  }
});

// POST /api/gpon/onu/assign-cliente - Asignar ONU a cliente
app.post('/api/gpon/onu/assign-cliente', requireAuth, async (req, res) => {
  try {
    var sn = (req.body.sn || '').trim();
    var clienteId = parseInt(req.body.cliente_id) || 0;
    var servicioId = parseInt(req.body.servicio_id) || 0;

    if (!sn || !clienteId) return res.json({ success: false, msg: 'SN y Cliente requeridos' });

    // Validar que cliente_id y servicio_id existan
    var valCliente = db.prepare('SELECT id FROM clientes WHERE id=?').get(clienteId);
    if (!valCliente) return res.json({ success: false, msg: 'Cliente no existe (ID: ' + clienteId + ')' });
    var valServicio = servicioId ? db.prepare('SELECT id FROM servicios WHERE id=?').get(servicioId) : null;
    var finalSvcId = valServicio ? servicioId : null;

    var existing = db.prepare('SELECT id FROM onu WHERE sn=?').get(sn);
    if (existing) {
      db.prepare('UPDATE onu SET cliente_id=?, servicio_id=? WHERE sn=?').run(clienteId, finalSvcId, sn);
    } else {
      db.prepare("INSERT INTO onu (sn, cliente_id, servicio_id, olt_id, estado) VALUES (?,?,?,6,'activo')").run(sn, clienteId, finalSvcId);
    }

    res.json({ success: true, msg: 'ONU asignada al cliente' });
  } catch(e) {
    res.json({ success: false, msg: 'Error: ' + e.message });
  }
});

// GET /api/gpon/ports/disponibles - Puertos disponibles en la OLT
app.get('/api/gpon/ports/disponibles', requireAuth, async (req, res) => {
  try {
    var olt = await ensureOltConnection(req);
    if (!olt) return res.json({ success: false, msg: 'No conectado a OLT' });

    var onus = await olt.getConfiguredOnus();
    var portCounts = {};
    onus.forEach(function(o) {
      var p = o.port || (o.onuId ? o.onuId.match(/gpon-onu_(\d+\/\d+\/\d+)/) : null);
      if (p) {
        if (Array.isArray(p)) p = p[1];
        portCounts[p] = (portCounts[p] || 0) + 1;
      }
    });

    var ports = Object.keys(portCounts).map(function(p) {
      var libre = 64 - portCounts[p];
      return { port: p, usadas: portCounts[p], libres: Math.max(0, libre), total: 64 };
    });

    res.json({ success: true, data: ports });
  } catch(e) {
    res.json({ success: false, msg: 'Error: ' + e.message });
  }
});

// GET /api/gpon/onu/servicios-sin-onu - Servicios activos sin ONU asignada
app.get('/api/gpon/onu/servicios-sin-onu', requireAuth, (req, res) => {
  try {
    var rows = db.prepare(`
      SELECT s.id, c.nombre as cliente, p.nombre as plan
      FROM servicios s
      JOIN clientes c ON c.id=s.cliente_id
      JOIN planes p ON p.id=s.plan_id
      WHERE s.estado='activo'
        AND NOT EXISTS (SELECT 1 FROM onu WHERE servicio_id=s.id)
      ORDER BY c.nombre
    `).all();
    res.json({ success: true, data: rows });
  } catch(e) {
    res.json({ success: false, data: [] });
  }
});

// ===== SMARTOLT FILTER API ENDPOINTS =====

// GET /api/gpon/locations - Zonas para filtros
app.get('/api/gpon/locations', requireAuth, (req, res) => {
  try {
    var rows = db.prepare('SELECT id, nombre as name FROM zonas ORDER BY nombre').all();
    res.json({ response: rows });
  } catch(e) { res.json({ response: [] }); }
});

// GET /api/gpon/odbs - ODBs (Cajas NAP) para filtros
app.get('/api/gpon/odbs', requireAuth, (req, res) => {
  try {
    var rows = db.prepare('SELECT id, nombre as name FROM cajas_nap ORDER BY nombre').all();
    res.json({ response: rows });
  } catch(e) { res.json({ response: [] }); }
});

// GET /api/gpon/onu_types - Tipos de ONU
app.get('/api/gpon/onu_types', requireAuth, (req, res) => {
  try {
    var rows = db.prepare("SELECT key, value FROM configuracion WHERE key LIKE 'onu_type_%' ORDER BY key").all();
    var types = rows.map(function(r) { return { name: r.value || r.key.replace('onu_type_','') }; });
    res.json({ response: types });
  } catch(e) { res.json({ response: [] }); }
});

// GET /api/gpon/speed_profiles - Perfiles de velocidad
app.get('/api/gpon/speed_profiles', requireAuth, (req, res) => {
  try {
    var rows = db.prepare('SELECT id, nombre as name, velocidad FROM planes ORDER BY nombre').all();
    res.json({ response: rows });
  } catch(e) { res.json({ response: [] }); }
});

// GET /api/gpon/pon_types - Tipos de PON
app.get('/api/gpon/pon_types', requireAuth, (req, res) => {
  res.json({ response: [{ name: 'GPON' }, { name: 'EPON' }] });
});

// GET /api/gpon/olts - OLTs para filtros
app.get('/api/gpon/olts', requireAuth, (req, res) => {
  try {
    var rows = db.prepare('SELECT id, nombre as name FROM olts ORDER BY nombre').all();
    res.json({ response: rows });
  } catch(e) { res.json({ response: [] }); }
});

// POST /api/gpon/debug - Ejecutar comando raw y ver salida (para depuración)
app.post('/api/gpon/debug', requireAuth, async (req, res) => {
  try {
    var olt = await ensureOltConnection(req);
    if (!olt) return res.json({ success: false, msg: 'No conectado a OLT' });

    var cmd = (req.body.command || '').trim();
    if (!cmd) return res.json({ success: false, msg: 'Comando requerido' });

    var timeout = parseInt(req.body.timeout) || 5000;
    var output = await olt.exec(cmd, timeout);

    res.json({ success: true, command: cmd, output: output, length: output.length });
  } catch(e) {
    res.json({ success: false, msg: 'Error: ' + e.message });
  }
});

// ======== SERVER DATE API ========
app.get('/api/server/date', requireAuth, (req, res) => {
  try {
    var sd = getCurrentServerDate();
    res.json({ status: 'success', ...sd });
  } catch(e) {
    res.json({ status: 'error', msg: e.message });
  }
});

app.post('/api/server/date', requireAuth, (req, res) => {
  try {
    var dateVal = (req.body.date || '').trim();
    var timeVal = (req.body.time || '').trim();
    if (!dateVal) return res.json({ status: 'error', msg: 'Fecha requerida' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
      return res.json({ status: 'error', msg: 'Formato inválido. Use YYYY-MM-DD' });
    }
    if (timeVal && !/^\d{2}:\d{2}$/.test(timeVal)) {
      timeVal = '12:00';
    }
    db.prepare("INSERT OR REPLACE INTO configuracion (key, value) VALUES ('fecha_simulada', ?)").run(dateVal);
    if (timeVal) {
      db.prepare("INSERT OR REPLACE INTO configuracion (key, value) VALUES ('hora_simulada', ?)").run(timeVal);
    }
    db.logActivity(req.session.user, 'Cambió fecha simulada a ' + dateVal + ' ' + timeVal, 'Configuración', { usuario_id: req.session.user.id });

    // ⏰ AUTO-EXPIRAR PROMESAS: al cambiar la fecha, detectar promesas vencidas y suspender de una vez
    var promExpOutput = '';
    try {
      var sd = getCurrentServerDate();
      var fechaStr = sd.current_date_only;
      var horaStr = sd.current_time || '12:00';
      var fechaTimeStr = fechaStr + ' ' + horaStr + ':00';
      var fechaRef = "'" + fechaTimeStr + "'";

      var vencidas = db.prepare(`
        SELECT pp.id, pp.cliente_id, pp.servicio_ids, pp.fecha_limite,
          c.nombre as cliente_nombre
        FROM promesas_pago pp
        JOIN clientes c ON c.id=pp.cliente_id
        WHERE pp.estado='activa'
          AND (pp.fecha_limite || ' 12:00:00') < ` + fechaRef + `
        ORDER BY pp.fecha_limite ASC
      `).all();

      if (vencidas.length > 0) {
        var suspendidos = 0;
        vencidas.forEach(function(p) {
          try {
            var raw = (p.servicio_ids || '').toString().trim();
            var svcIds = [];
            if (raw.startsWith('[')) {
              try { svcIds = JSON.parse(raw); } catch(e) {}
            } else if (raw) {
              svcIds = raw.split(',').map(function(s) { return parseInt(s.trim()); }).filter(function(n) { return !isNaN(n) && n > 0; });
            }
            svcIds.forEach(function(sid) {
              db.prepare("UPDATE servicios SET estado='suspendido' WHERE id=? AND estado='activo'").run(sid);
              suspendidos++;
            });
            db.prepare("UPDATE promesas_pago SET estado='vencida' WHERE id=?").run(p.id);
          } catch(e) {}
        });
        promExpOutput = 'Auto: ' + vencidas.length + ' promesas vencidas, ' + suspendidos + ' servicios suspendidos';
        db.prepare("UPDATE cron_tasks SET last_run=datetime('now','localtime'), last_status='ok', last_output=? WHERE task_name='expirar_promesas'").run(promExpOutput);
        console.log('[Fecha] ' + promExpOutput);
      }
    } catch(e) {
      console.log('[Fecha] Error auto-expiracion:', e.message);
    }

    var sd = getCurrentServerDate();
    var respData = { status: 'success', msg: 'Fecha cambiada a ' + dateVal + ' ' + timeVal, ...sd };
    if (promExpOutput) respData.promExpired = promExpOutput;
    res.json(respData);
  } catch(e) {
    res.json({ status: 'error', msg: e.message });
  }
});

app.post('/api/server/date/reset', requireAuth, (req, res) => {
  try {
    db.prepare("DELETE FROM configuracion WHERE key='fecha_simulada'").run();
    db.logActivity(req.session.user, 'Restauró fecha real del servidor', 'Configuración', { usuario_id: req.session.user.id });
    var sd = getCurrentServerDate();
    res.json({ status: 'success', msg: 'Fecha restaurada a la real', ...sd });
  } catch(e) {
    res.json({ status: 'error', msg: e.message });
  }
});

// ======== CRON SCHEDULER ========
// Verifica cada 60 segundos si hay tareas programadas que ejecutar
setInterval(function() {
  try {
    var sd = getCurrentServerDate();
    var realNow = new Date();
    var horaActual = realNow.getHours();
    var minActual = realNow.getMinutes();

    // Obtener tareas habilitadas
    var tasks = db.prepare('SELECT * FROM cron_tasks WHERE enabled=1').all();

    tasks.forEach(function(t) {
      // Verificar si la hora y minuto coinciden (tolerancia de 2 min)
      var diffMin = Math.abs((horaActual * 60 + minActual) - (t.hour * 60 + t.minute));
      if (diffMin > 2) return;

      // Evitar ejecutar si ya se ejecutó en los últimos 5 minutos (usando tiempo real, no simulado)
      if (t.last_run) {
        var lastRun = new Date(t.last_run + 'Z');
        var diffReal = (new Date().getTime() - lastRun.getTime()) / 1000 / 60;
        if (diffReal < 5) return;
      }

      console.log('[Cron] Ejecutando tarea: ' + t.task_name + ' a las ' + horaActual + ':' + String(minActual).padStart(2,'0'));

      try {
        var output = '';
        if (t.task_name === 'generar_facturas') {
          output = ejecutarGenerarFacturas(null);
        } else if (t.task_name === 'suspension') {
          // La suspension usa response, creamos un mock parcial
          try {
            var fakeRes = { json: function(o) { output = (o.data && o.data.output) || o.msg || 'OK'; } };
            enviarNotifSuspensionWA({}, fakeRes);
            return;
          } catch(e2) { output = 'Error: ' + e2.message; }
        } else if (t.task_name === 'expirar_promesas') {
          try {
            var fakeRes2 = { json: function(o) { output = (o.data && o.data.output) || o.msg || 'OK'; } };
            ejecutarExpirarPromesas({}, fakeRes2);
            return;
          } catch(e2) { output = 'Error: ' + e2.message; }
        } else if (t.task_name === 'backup') {
          output = '[Backup] Simulado - ' + new Date().toLocaleString();
        }

        if (output) {
          db.prepare("UPDATE cron_tasks SET last_run=datetime('now','localtime'), last_status='ok', last_output=? WHERE task_name=?").run(output, t.task_name);
        }
      } catch(e) {
        console.log('[Cron] Error en ' + t.task_name + ': ' + e.message);
        db.prepare("UPDATE cron_tasks SET last_run=datetime('now','localtime'), last_status='error', last_output=? WHERE task_name=?").run('Error: ' + e.message, t.task_name);
      }
    });
  } catch(e) {
    console.log('[Cron-Scheduler] Error: ' + e.message);
  }
}, 60000);

console.log('[Cron] Scheduler iniciado (cada 60s)');

// ======== GPON BACKGROUND REFRESH SERVICE ========
// Cada 3 minutos refresca los datos de la OLT y los guarda en DB local
// La página carga INSTANTÁNEA desde la DB sin esperar a la OLT

var _gponRefreshTimer = null;
var _gponRefreshing = false;

async function refreshGponData() {
  if (_gponRefreshing) return;
  _gponRefreshing = true;

  try {
    console.log('[GPON-Refresh] Background refresh started...');
    var startTime = Date.now();

    // Conectar a la OLT (autodetect from DB)
    var oltConfig = db.prepare("SELECT * FROM olts WHERE olt_ip IS NOT NULL AND olt_ip != '' ORDER BY id LIMIT 1").get();
    if (!oltConfig) {
      console.log('[GPON-Refresh] No OLT configured');
      _gponRefreshing = false;
      return;
    }

    var ZteOLT = require('./zte-olt');
    var olt = new ZteOLT(
      { host: oltConfig.socks_host || '2803:5a10:2:2800::2', port: parseInt(oltConfig.socks_port) || 1080 },
      { host: oltConfig.olt_ip || '192.168.20.80', username: oltConfig.olt_username || 'zte', password: oltConfig.olt_password || 'zte' }
    );

    await olt.connect();

    // 1. Obtener estado de ONUs configuradas
    var stateFromTelnet = await olt.getConfiguredOnus();

    // 2. ONUs no configuradas
    var unconfiguredTelnet = [];
    try { unconfiguredTelnet = await olt.getUnconfiguredOnus(); } catch(e) {}

    // 3. SmartOLT API enrichment (nombres y SN - timeout 10s)
    var smartoltNameMap = {};
    try {
      var p = new Promise(function(resolve) {
        smartoltFetch('/onu/configured_onus/status', 'GET').then(function(data) { resolve(data); }).catch(function() { resolve(null); });
        setTimeout(function() { resolve(null); }, 10000);
      });
      var data = await p;
      if (data && data.response) {
        data.response.forEach(function(apiOnu) {
          // La descripción de SmartOLT ya viene como "gpon-onu_1/3/3:1"
          var desc = apiOnu.description || '';
          var onuId = desc.indexOf('gpon-onu_') === 0 ? desc : 'gpon-onu_' + desc;
          smartoltNameMap[onuId] = { sn: apiOnu.sn || '', name: apiOnu.location_name || '' };
        });
      }
    } catch(e) {}
    
    // 3b. Obtener info detallada de ONUs desde la OLT (150 por ciclo, secuencial)
    // La OLT guarda: Name, SN, Type, Distance - todo directo del detail-info
    var oltFullInfo = {};
    try {
      var batchInfo = await olt.getOnuBatchInfo(stateFromTelnet, 150);
      if (Object.keys(batchInfo).length > 0) {
        console.log('[GPON-Refresh] Got info for ' + Object.keys(batchInfo).length + ' ONUs from OLT');
        oltFullInfo = batchInfo;
      }
    } catch(e) {
      console.log('[GPON-Refresh] OLT batch-info error:', e.message);
    }
    
    var unconfiguredFinal = unconfiguredTelnet;
    try {
      var p2 = new Promise(function(resolve) {
        smartoltFetch('/onu/unconfigured_onus', 'GET').then(function(data) { resolve(data); }).catch(function() { resolve(null); });
        setTimeout(function() { resolve(null); }, 8000);
      });
      var data2 = await p2;
      if (data2 && data2.response) unconfiguredFinal = data2.response;
    } catch(e) {}

    // 4. Merge: enriquecer con SNs de OLT + SmartOLT
    var mergedState = stateFromTelnet.map(function(t) {
      var enrich = smartoltNameMap[t.onuId] || {};
      // Si SmartOLT no tiene SN, buscar en el config de la OLT
      var oltInfo = {};
      if (t.onuId && oltFullInfo[t.onuId]) oltInfo = oltFullInfo[t.onuId];
      var mergedSn = enrich.sn || oltInfo.sn || t.sn || '';
      var mergedName = enrich.name || oltInfo.name || t.name || '';
      return {
        port: t.port || '',
        onuId: t.onuId || '',
        sn: mergedSn,
        name: mergedName,
        type: oltInfo.type || '',
        distance: oltInfo.distance || '',
        duration: oltInfo.duration || '',
        vlans: oltInfo.vlans || [],
        adminState: t.adminState || 'unknown',
        omccState: t.omccState || 'unknown',
        phaseState: t.phaseState || 'unknown',
        state: t.state || 'unknown'
      };
    });

    var total = mergedState.length;
    var online = mergedState.filter(function(s) { return s.state === 'working' || s.state === 'online'; }).length;
    var offline = total - online;
    var pending = (Array.isArray(unconfiguredFinal) ? unconfiguredFinal.length : 0);

    // 5. Guardar en DB (cache persistente)
    saveGponCache(mergedState, unconfiguredFinal, mergedState, total, online, offline, pending);
    
    // 5b. Sincronizar nombres de SmartOLT a la tabla onu (para tener nombres en DB local)
    try {
      Object.keys(smartoltNameMap).forEach(function(key) {
        if (!key.startsWith('gpon-onu_')) return;
        var info = smartoltNameMap[key];
        if (!info.sn || info.sn.length < 8) return;
        try {
          var existing = db.prepare('SELECT id, nombre FROM onu WHERE sn=?').get(info.sn);
          if (existing) {
            if (!existing.nombre && info.name) {
              db.prepare('UPDATE onu SET nombre=?, olt_id=6 WHERE id=?').run(info.name, existing.id);
            }
          } else {
            db.prepare("INSERT INTO onu (sn, nombre, olt_id, estado, created_at) VALUES (?, ?, 6, 'activo', datetime('now'))").run(info.sn, info.name);
          }
        } catch(e) {}
      });
    } catch(e) {}
    
    // 5c. Sincronizar info de la OLT a la tabla onu (usando puerto_olt como key, no SN)
    try {
      Object.keys(oltFullInfo).forEach(function(onuId) {
        var info = oltFullInfo[onuId];
        if (!info.sn || info.sn.length < 8) return;
        try {
          // Buscar por ONU ID (puerto_olt) - esto es único y NO se mezcla como el SN
          var byPort = db.prepare('SELECT id, sn, nombre, onu_type FROM onu WHERE puerto_olt=?').get(onuId);
          if (byPort) {
            var updates = [];
            var params = [];
            // Si el SN almacenado es diferente al real, corregirlo
            if (byPort.sn !== info.sn) { updates.push('sn=?'); params.push(info.sn); }
            if (info.name && !byPort.nombre) { updates.push('nombre=?'); params.push(info.name); }
            if (info.type && !byPort.onu_type) { updates.push('onu_type=?'); params.push(info.type); }
            if (updates.length > 0) {
              params.push(byPort.id);
              db.prepare('UPDATE onu SET ' + updates.join(',') + ' WHERE id=?').run.apply(null, params);
            }
          } else {
            db.prepare("INSERT INTO onu (sn, nombre, onu_type, puerto_olt, olt_id, estado, created_at) VALUES (?, ?, ?, ?, 6, 'activo', datetime('now'))").run(info.sn, info.name || '', info.type || '', onuId);
          }
        } catch(e) {}
      });
    } catch(e) {}

    // 6. Actualizar cache en memoria
    var dbOnus = db.prepare('SELECT o.*, c.nombre as cliente_nombre FROM onu o LEFT JOIN clientes c ON c.id=o.cliente_id ORDER BY o.id DESC').all();
    var gponResult = {
      success: true,
      configured: mergedState,
      unconfigured: (Array.isArray(unconfiguredFinal) ? unconfiguredFinal.map(function(u) { return { sn: u.sn || '', pon_type: u.pon_type || '', board: u.board || '', port: u.port || '', onu: u.onu || '', onu_type_name: u.onu_type_name || '' }; }) : []),
      state: mergedState,
      db_onus: dbOnus,
      low_signal: 0
    };
    gponDataCache['background'] = { data: gponResult, timestamp: Date.now() };

    var took = Date.now() - startTime;
    console.log('[GPON-Refresh] Done in ' + took + 'ms: ' + total + ' ONUs (' + online + ' online, ' + offline + ' offline, ' + pending + ' pending)');

    await olt.disconnect();
  } catch(e) {
    console.log('[GPON-Refresh] Error:', e.message);
  }

  _gponRefreshing = false;
}

// ======== SMARTOLT ONU AUTHORIZATION WITH PROGRESS (SSE) ========
// Este endpoint transmite progreso en tiempo real durante la autorización
app.get('/api/smartolt/onu/authorize/progress', requireAuth, async (req, res) => {
  var olt_id = req.query.olt_id;
  var serial = req.query.serial;
  if (!olt_id || !serial) {
    res.writeHead(400, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ step: 'error', msg: 'Faltan parámetros' }) + '\n\n');
    res.end();
    return;
  }

  // Headers SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  function sendProgress(step, msg) {
    res.write('data: ' + JSON.stringify({ step: step, msg: msg }) + '\n\n');
    if (res.flush) res.flush();
  }

  // Leer IDs al inicio para que estén disponibles en toda la función
  var clienteId = parseInt(req.query.cliente_id) || null;
  var servicioId = parseInt(req.query.servicio_id) || null;

  try {
    var olt = db.prepare('SELECT * FROM olts WHERE id=? ').get(olt_id);
    if (!olt || !olt.smartolt_subdomain || !olt.smartolt_api_key) {
      sendProgress('error', 'OLT no configurada');
      res.end();
      return;
    }

    sendProgress('search', 'Buscando ONU en SmartOLT...');
    var apiUrl = 'https://' + olt.smartolt_subdomain + '.smartolt.com/api';

    // 1. Verificar si la ONU ya existe
    var searchResp = await fetch(apiUrl + '/onu/get_onus_details_by_sn/' + serial, {
      method: 'GET', headers: { 'X-Token': olt.smartolt_api_key, 'Accept': 'application/json' }
    });
    var searchData = await searchResp.json();
    var existingList = searchData.onus || searchData.response || [];
    var existingId = null;
    if (existingList.length > 0) {
      existingId = existingList[0].unique_external_id || existingList[0].id || existingList[0].onu_id || null;
    }

    if (existingId) {
      sendProgress('delete', 'ONU ya existe en SmartOLT. Eliminando...');
      await fetch(apiUrl + '/onu/delete/' + existingId, {
        method: 'POST', headers: { 'X-Token': olt.smartolt_api_key }
      });
    }

    sendProgress('authorize', 'Autorizando ONU en SmartOLT...');
    // Construir params
    var params = new URLSearchParams();
    params.append('olt_id', olt.smartolt_olt_id || olt_id);
    params.append('sn', serial);
    params.append('pon_type', 'gpon');
    var model = req.query.model || '';
    if (model) params.append('onu_type', model);
    params.append('onu_mode', 'Routing');
    if (req.query.onu_mode === 'bridge' || req.query.onu_mode === 'bridging') params.set('onu_mode', 'Bridging');
    params.append('zone', req.query.zone || 'default');
    params.append('name', (req.query.name || serial).replace(/[^a-zA-Z0-9 @\$&()\-`.+,/_\:;]/g, '').trim().substring(0, 64) || serial);
    if (req.query.vlan) params.append('vlan', req.query.vlan);
    else if (olt.vlan_default) params.append('vlan', olt.vlan_default);
    if (req.query.board) params.append('board', req.query.board);
    if (req.query.port) params.append('port', req.query.port);

    var authResp = await fetch(apiUrl + '/onu/authorize_onu', {
      method: 'POST',
      headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    var authData = await authResp.json();

    if (authData.status !== 'success' && authData.status !== true && authData.response_code !== 'success') {
      sendProgress('error', authData.error || authData.message || 'Error al autorizar');
      res.end();
      return;
    }

    // Obtener external ID de la ONU recién autorizada
    sendProgress('config', 'Obteniendo datos de la ONU...');
    var extSearch = await fetch(apiUrl + '/onu/get_onus_details_by_sn/' + serial, {
      method: 'GET', headers: { 'X-Token': olt.smartolt_api_key, 'Accept': 'application/json' }
    });
    var extData = await extSearch.json();
    var onuList = extData.onus || extData.response || [];
    var extId = '';
    if (onuList.length > 0) {
      extId = onuList[0].unique_external_id || onuList[0].id || onuList[0].onu_id || '';
    }

    // ✅ Cerrar SSE inmediatamente (usuario ve "completado" al instante)
    sendProgress('done', '✅ ONU autorizada exitosamente. Aplicando configuración en segundo plano...');
    res.end();

    // ====== CONTINUAR CONFIG EN SEGUNDO PLANO ======
    if (!extId) {
      require('fs').appendFileSync('/tmp/isptotal.log', '[AUTHORIZE-BG] No se obtuvo extId, saltando config\n');
      return;
    }

    configurarOnuBackground(serial, olt, apiUrl, extId, servicioId, clienteId, req);

  } catch(e) {
    sendProgress('error', 'Error: ' + e.message);
    res.end();
  }
});

// ====== FUNCIÓN EN SEGUNDO PLANO: configurar TR069, WAN, WiFi ======
async function configurarOnuBackground(serial, olt, apiUrl, extId, servicioId, clienteId, req) {
  try {
    // Obtener perfiles de velocidad desde el plan del servicio
    var dlProfile = req.query.dl_profile || '';
    var ulProfile = req.query.ul_profile || '';
    if (!dlProfile && servicioId) {
      var planInfo = db.prepare('SELECT p.perfil_olt_descarga, p.perfil_olt_subida, p.perfil_mikrotik, p.nombre FROM servicios s LEFT JOIN planes p ON p.id=s.plan_id WHERE s.id=?').get(servicioId);
      if (planInfo) {
        dlProfile = planInfo.perfil_olt_descarga || planInfo.perfil_mikrotik || planInfo.nombre || '';
        ulProfile = planInfo.perfil_olt_subida || dlProfile;
      }
    }

    // Speed profiles
    if (dlProfile) {
      try {
        var spParams = new URLSearchParams();
        spParams.append('upload_speed_profile_name', ulProfile || dlProfile);
        spParams.append('download_speed_profile_name', dlProfile);
        await fetch(apiUrl + '/onu/update_onu_speed_profiles/' + extId, {
          method: 'POST', headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: spParams
        });
      } catch(e) {}
    }

    // TR069 + Mgmt IP
    var mgmtVlan = olt.tr069_vlan || req.query.vlan || olt.vlan_default || '';
    if (mgmtVlan) {
      try {
        var mgmtParams = new URLSearchParams();
        mgmtParams.append('vlan', mgmtVlan);
        await fetch(apiUrl + '/onu/set_onu_mgmt_ip_dhcp/' + extId, {
          method: 'POST', headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: mgmtParams
        });
      } catch(e) {}
    }

    try {
      var tr069Params = new URLSearchParams();
      tr069Params.append('tr069_profile', olt.tr069_profile || 'SmartOLT');
      await fetch(apiUrl + '/onu/enable_tr069/' + extId, {
        method: 'POST', headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: tr069Params
      });
    } catch(e) {}

    // WAN mode
    var authType = req.query.auth_type || 'dhcp';
    var pppoeUser = req.query.pppoe_user || '';
    var pppoePass = req.query.pppoe_pass || '';
    if (!pppoeUser && servicioId) {
      try {
        var svcWan = db.prepare('SELECT pppoe_user, pppoe_pass, auth_type, wifi_ssid, wifi_pass FROM servicios WHERE id=?').get(servicioId);
        if (svcWan) {
          if (svcWan.pppoe_user) pppoeUser = svcWan.pppoe_user;
          if (svcWan.pppoe_pass) pppoePass = svcWan.pppoe_pass;
          if (svcWan.auth_type) authType = svcWan.auth_type;
        }
      } catch(e) {}
    }

    if (authType === 'pppoe' && pppoeUser) {
      try {
        var wanParams = new URLSearchParams();
        wanParams.append('username', pppoeUser);
        wanParams.append('password', pppoePass || '1320');
        wanParams.append('configuration_method', 'TR069');
        wanParams.append('ip_protocol', 'ipv4ipv6');
        await fetch(apiUrl + '/onu/set_onu_wan_mode_pppoe/' + extId, {
          method: 'POST', headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: wanParams
        });
      } catch(e) {}
    } else {
      try {
        var dhcpParams = new URLSearchParams();
        dhcpParams.append('vlan', req.query.vlan || olt.vlan_default || '');
        dhcpParams.append('configuration_method', 'TR069');
        dhcpParams.append('ip_protocol', 'ipv4ipv6');
        await fetch(apiUrl + '/onu/set_onu_wan_mode_dhcp/' + extId, {
          method: 'POST', headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: dhcpParams
        });
      } catch(e) {}
    }

    // WiFi
    var wifiSsid = req.query.wifi_ssid || '';
    var wifiPass = req.query.wifi_pass || '';
    if (!wifiSsid && servicioId) {
      try {
        var svcWifi = db.prepare('SELECT wifi_ssid, wifi_pass FROM servicios WHERE id=?').get(servicioId);
        if (svcWifi) {
          wifiSsid = svcWifi.wifi_ssid || '';
          wifiPass = svcWifi.wifi_pass || '';
        }
      } catch(e) {}
    }
    if (wifiSsid) {
      try {
        var wifiParams = new URLSearchParams();
        wifiParams.append('wifi_port', 'wifi_0/1');
        wifiParams.append('ssid', wifiSsid);
        wifiParams.append('password', wifiPass || '');
        wifiParams.append('authentication_mode', 'WPA2');
        await fetch(apiUrl + '/onu/set_wifi_port_lan/' + extId, {
          method: 'POST', headers: { 'X-Token': olt.smartolt_api_key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: wifiParams
        });
      } catch(e) {}
    }

    // Guardar config en OLT
    try {
      await fetch(apiUrl + '/system/save_config', { method: 'POST', headers: { 'X-Token': olt.smartolt_api_key } });
    } catch(e) {}

    // Guardar en BD local
    if (clienteId) {
      try {
        var valCliente = db.prepare('SELECT id FROM clientes WHERE id=?').get(clienteId);
        if (valCliente) {
          var valServicio = servicioId ? db.prepare('SELECT id FROM servicios WHERE id=?').get(servicioId) : null;
          var finalSvcId = valServicio ? servicioId : null;
          var existingOnu = db.prepare('SELECT id FROM onu WHERE sn=?').get(serial);
          if (existingOnu) {
            db.prepare('UPDATE onu SET cliente_id=?, servicio_id=?, nombre=? WHERE sn=?').run(clienteId, finalSvcId, req.query.name || null, serial);
          } else {
            db.prepare("INSERT INTO onu (sn, nombre, cliente_id, servicio_id, vlan, olt_id, estado) VALUES (?,?,?,?,?,?,'activo')").run(serial, req.query.name || '', clienteId, finalSvcId, req.query.vlan || null, olt.id);
          }
        }
      } catch(e) {
        require('fs').appendFileSync('/tmp/isptotal.log', '[AUTHORIZE-BG] Error BD: ' + e.message + '\n');
      }
    }

    require('fs').appendFileSync('/tmp/isptotal.log', '[AUTHORIZE-BG] Config completa para ' + serial + '\n');
  } catch(e) {
    require('fs').appendFileSync('/tmp/isptotal.log', '[AUTHORIZE-BG] Error: ' + e.message + '\n');
  }
}

// ======== SERVICIOS CONFIG (como DomISP) ========

// GET /api/servicios/config-data/:cliente_id - Obtener datos de config de servicios
app.get('/api/servicios/config-data/:clienteId', requireAuth, (req, res) => {
  try {
    var clienteId = parseInt(req.params.clienteId) || 0;
    var rows = db.prepare(`
      SELECT s.id, s.es_gratis as free, s.no_suspender as no_suspend,
        s.ciclo_id as billing_cycle_id, s.custom_suspend_day,
        s.descuento_monto as discount, s.notify_invoices,
        s.ncf_type, s.consolidated, s.estado,
        p.nombre as plan, p.precio as price
      FROM servicios s
      LEFT JOIN planes p ON p.id=s.plan_id
      WHERE s.cliente_id=? AND s.estado != 'retirado'
      ORDER BY s.id
    `).all(clienteId);
    res.json({ success: true, data: rows });
  } catch(e) {
    res.json({ success: false, msg: e.message });
  }
});

// POST /api/servicios/config/save - Guardar config de servicio
app.post('/api/servicios/config/save', requireAuth, (req, res) => {
  try {
    var serviceId = parseInt(req.body.service_id) || 0;
    if (!serviceId) return res.json({ success: false, msg: 'ID requerido' });

    var updates = [];
    var params = [];

    if (req.body.free_service !== undefined) {
      updates.push('es_gratis=?');
      params.push(parseInt(req.body.free_service) ? 1 : 0);
    }
    if (req.body.no_suspend !== undefined) {
      updates.push('no_suspender=?');
      params.push(parseInt(req.body.no_suspend) ? 1 : 0);
    }
    if (req.body.billing_cycle_id !== undefined) {
      updates.push('ciclo_id=?');
      params.push(parseInt(req.body.billing_cycle_id) || null);
    }
    if (req.body.custom_suspend_day !== undefined) {
      var day = parseInt(req.body.custom_suspend_day);
      updates.push('custom_suspend_day=?');
      params.push(day > 0 && day <= 31 ? day : null);
    }
    if (req.body.discount !== undefined) {
      updates.push('descuento_monto=?');
      params.push(parseFloat(req.body.discount) || 0);
    }
    if (req.body.notify_invoices !== undefined) {
      updates.push('notify_invoices=?');
      params.push(parseInt(req.body.notify_invoices) ? 1 : 0);
    }
    if (req.body.ncf_type !== undefined) {
      updates.push('ncf_type=?');
      params.push(req.body.ncf_type || '');
    }
    if (req.body.consolidated !== undefined) {
      updates.push('consolidated=?');
      params.push(parseInt(req.body.consolidated) ? 1 : 0);
    }

    if (updates.length > 0) {
      params.push(serviceId);
      var stmt = db.prepare('UPDATE servicios SET ' + updates.join(',') + ' WHERE id=?');
      stmt.run.apply(stmt, params);
    }

    res.json({ success: true, msg: 'Configuración guardada' });
  } catch(e) {
    res.json({ success: false, msg: e.message });
  }
});

// ======== EXCEL IMPORT/EXPORT ========
const XLSX = require('xlsx');

app.get('/api/clientes/export/excel', requireAuth, (req, res) => {
  try {
    var clientes = db.prepare(`
      SELECT c.id, c.nombre, c.apodo, c.cedula, c.telefono, c.direccion,
        COALESCE(z.nombre, '') as zona,
        GROUP_CONCAT(s.estado || '|' || COALESCE(p.nombre, 'Sin plan') || '|' || COALESCE(p.precio, 0) || '|' || COALESCE(s.direccion, ''), '; ') as servicios_info,
        COALESCE((SELECT SUM(f.monto - COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0))
          FROM facturas f JOIN servicios s2 ON s2.id=f.servicio_id
          WHERE s2.cliente_id=c.id AND f.estado='pendiente'
          AND f.monto > COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.factura_id=f.id),0)), 0) as deuda_total
      FROM clientes c
      LEFT JOIN zonas z ON z.id=c.zona_id
      LEFT JOIN servicios s ON s.cliente_id=c.id AND s.estado != 'retirado'
      LEFT JOIN planes p ON p.id=s.plan_id
      GROUP BY c.id
      ORDER BY c.nombre
    `).all();

    var data = clientes.map(function(c) {
      return {
        ID: c.id,
        Nombre: c.nombre || '',
        Apodo: c.apodo || '',
        Cedula: c.cedula || '',
        Telefono: c.telefono || '',
        Direccion: c.direccion || '',
        Zona: c.zona || '',
        Servicios: c.servicios_info || '',
        Deuda_Total: c.deuda_total || 0
      };
    });

    var ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
      {wch:6},{wch:30},{wch:20},{wch:14},{wch:14},{wch:30},{wch:20},{wch:50},{wch:12}
    ];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Clientes');

    var buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=clientes_export_' + new Date().toISOString().slice(0,10) + '.xlsx');
    res.send(buf);
  } catch(e) {
    res.json({ status: 'error', msg: e.message });
  }
});

app.post('/api/clientes/import/excel', requireAuth, (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.json({ status: 'error', msg: 'No se subió ningún archivo' });
    }

    var file = req.files.file;
    var wb = XLSX.read(file.data, { type: 'buffer' });
    var ws = wb.Sheets[wb.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (!rows || rows.length === 0) {
      return res.json({ status: 'error', msg: 'El archivo Excel está vacío' });
    }

    var creados = 0;
    var actualizados = 0;
    var errores = [];

    var insertCliente = db.prepare(`INSERT INTO clientes (nombre, apodo, cedula, telefono, direccion, zona_id) VALUES (?,?,?,?,?,?)`);
    var getZona = db.prepare("SELECT id FROM zonas WHERE nombre LIKE ? LIMIT 1");
    var getPlan = db.prepare("SELECT id, precio FROM planes WHERE nombre LIKE ? LIMIT 1");

    rows.forEach(function(row, i) {
      try {
        var nombre = (row['Nombre'] || '').toString().trim();
        if (!nombre) { errores.push('Fila ' + (i+2) + ': Sin nombre'); return; }

        var cedula = (row['Cedula'] || '').toString().trim();
        var telefono = (row['Telefono'] || '').toString().trim();
        var apodo = (row['Apodo'] || '').toString().trim();
        var direccion = (row['Direccion'] || '').toString().trim();
        var zonaNombre = (row['Zona'] || '').toString().trim();

        var zonaId = null;
        if (zonaNombre) {
          var z = getZona.get('%' + zonaNombre + '%');
          if (z) zonaId = z.id;
        }

        // Buscar si ya existe por cédula o teléfono
        var existente = null;
        if (cedula) existente = db.prepare("SELECT id FROM clientes WHERE cedula=? LIMIT 1").get(cedula);
        if (!existente && telefono) existente = db.prepare("SELECT id FROM clientes WHERE telefono=? LIMIT 1").get(telefono);

        if (existente) {
          db.prepare("UPDATE clientes SET nombre=?, apodo=?, telefono=?, direccion=?, zona_id=? WHERE id=?")
            .run(nombre, apodo, telefono, direccion, zonaId, existente.id);
          actualizados++;
        } else {
          var r = insertCliente.run(nombre, apodo, cedula, telefono, direccion, zonaId);
          creados++;
        }
      } catch(e) {
        errores.push('Fila ' + (i+2) + ': ' + e.message);
      }
    });

    var msg = creados + ' cliente(s) creado(s), ' + actualizados + ' actualizado(s)';
    if (errores.length > 0) msg += ', ' + errores.length + ' error(es)';

    res.json({ status: 'success', msg: msg, creados: creados, actualizados: actualizados, errores: errores });
  } catch(e) {
    res.json({ status: 'error', msg: e.message });
  }
});

// Template de Excel para descargar
app.get('/api/clientes/import/template', requireAuth, (req, res) => {
  try {
    var template = [{
      Nombre: 'Ejemplo Juan',
      Apodo: 'Juan',
      Cedula: '001-0000000-0',
      Telefono: '8090000000',
      Direccion: 'Calle Principal #123',
      Zona: 'Zona 1'
    }];
    var ws = XLSX.utils.json_to_sheet(template);
    ws['!cols'] = [{wch:30},{wch:20},{wch:16},{wch:14},{wch:30},{wch:20}];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Clientes');

    // Add a second sheet with instructions
    var instr = XLSX.utils.aoa_to_sheet([
      ['INSTRUCCIONES PARA IMPORTAR CLIENTES'],
      [''],
      ['Columnas obligatorias: Nombre'],
      ['Columnas opcionales: Apodo, Cedula, Telefono, Direccion, Zona'],
      [''],
      ['- Si la cedula ya existe, se actualiza el cliente'],
      ['- Si el telefono ya existe, se actualiza el cliente'],
      ['- La zona debe coincidir con una existente en el sistema'],
      ['- Borre la fila de ejemplo y ponga sus datos'],
    ]);
    XLSX.utils.book_append_sheet(wb, instr, 'Instrucciones');

    var buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=plantilla_importar_clientes.xlsx');
    res.send(buf);
  } catch(e) {
    res.json({ status: 'error', msg: e.message });
  }
});

function startGponBackgroundRefresh() {
  if (_gponRefreshTimer) clearInterval(_gponRefreshTimer);
  // Primer refresh a los 10 segundos
  setTimeout(refreshGponData, 10000);
  // Luego cada 3 minutos
  _gponRefreshTimer = setInterval(refreshGponData, 180000);
  console.log('[GPON-Refresh] Background refresh cada 3 minutos');
}

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

  // Iniciar background refresh de GPON (cada 3 minutos)
  startGponBackgroundRefresh();
});

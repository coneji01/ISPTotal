// Réplica mínima de ISPTotal para benchmark de velocidad
// Solo carga: express, session, fileUpload, database, multi-tenant, login + 1 ruta

const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const fileUpload = require('express-fileupload');
const path = require('path');
const app = express();
const PORT = 3030;

// Body parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session
app.use(session({
  store: new SQLiteStore({ dir: path.join(__dirname, '..', 'data'), db: 'sessions.sqlite' }),
  secret: 'isp-total-minimal-benchmark',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Static
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use(express.static(path.join(__dirname, '..')));

// Database
const Database = require('better-sqlite3');
const dbPath = path.join(__dirname, '..', 'isptotal.db');
const db = new Database(dbPath);
db.pragma('journal_mode=WAL');

// Simple requireAuth
function requireAuth(req, res, next) {
  if (!req.session.user) {
    if (req.path && req.path.startsWith('/api/')) {
      return res.status(401).json({ success: false, message: 'Sesión expirada' });
    }
    return res.redirect('/');
  }
  next();
}

// Login route
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  try {
    const user = db.prepare('SELECT * FROM usuarios WHERE username = ? AND password = ?').get(username, password);
    if (user) {
      req.session.user = user;
      return res.redirect('/modulo?pagina=Dashboard');
    }
  } catch(e) {}
  res.render('login', { error: 'Usuario o contraseña incorrectos' });
});

// Simple route for benchmark
app.get('/api/ping', requireAuth, (req, res) => {
  res.json({ success: true, time: Date.now() });
});

// EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Benchmark server corriendo en http://0.0.0.0:${PORT}`);
});

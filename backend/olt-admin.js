// olt-admin.js - Socket persistente unico para OLT ZTE C300
const net = require('net');
const fs = require('fs');

var _sock = null;
var _buf = '';
var _ready = false;
var _cola = [];
var _ocupado = false;

function conectar() {
  if (_sock) return;
  _sock = new net.Socket();
  _buf = '';
  _ready = false;
  _sock.setTimeout(120000);
  _sock.on('connect', function() {
    var ip = [192,168,20,80];
    var b = Buffer.alloc(9);
    b[0]=4;b[1]=1;b.writeUInt16BE(23,2);
    for(var i=0;i<4;i++)b[4+i]=ip[i];
    b[8]=0;
    _sock.write(b);
  });
  _sock.on('data', function(d) {
    _buf += d.toString('ascii');
    if (!_ready) {
      if (_buf.indexOf('Username:') >= 0 && !_sock._l) { _sock._l=true; _sock.write('zte\r\n'); return; }
      if (_buf.indexOf('Password:') >= 0 && !_sock._p) { _sock._p=true; _sock.write('zte\r\n'); return; }
      if (_buf.indexOf('ZXAN#') >= 0) { _ready = true; _buf = ''; console.log('[OLT] Conectado'); procesar(); }
    }
  });
  _sock.on('error', function() { limpiar(); });
  _sock.on('close', function() { limpiar(); });
  _sock.on('timeout', function() { limpiar(); });
  _sock.connect(1080, '10.50.255.245');
}

function limpiar() {
  try { if (_sock) _sock.destroy(); } catch(e) {}
  _sock = null; _ready = false; _cola = []; _ocupado = false;
  setTimeout(conectar, 3000);
}

function procesar() {
  if (_ocupado || _cola.length === 0) return;
  _ocupado = true;
  var item = _cola.shift();
  var bufAntes = _buf.length;
  var inicio = Date.now();
  
  item.cmds.forEach(function(cmd, i) {
    setTimeout(function() { if (_sock) _sock.write(cmd + '\r\n'); }, i * 10);
  });
  
  var check = setInterval(function() {
    if (_buf.length > bufAntes + 10) {
      if (_buf.lastIndexOf('ZXAN#') >= bufAntes || _buf.lastIndexOf('ZXAN(') >= bufAntes) {
        clearInterval(check);
        _ocupado = false;
        item.resolve(_buf.substring(bufAntes));
        procesar();
        return;
      }
    }
    if (Date.now() - inicio > (item.timeout || 30000)) {
      clearInterval(check);
      _ocupado = false;
      item.resolve(_buf.substring(bufAntes));
      procesar();
    }
  }, 300);
}

function log(comandos) {
  var s = comandos.join(' | ').substring(0, 200);
  console.log('[OLT] ' + s);
  try { fs.appendFileSync(__dirname + '/../olt_commands.log', '[' + new Date().toISOString() + '] ' + s + '\n'); } catch(e) {}
}

function encolar(comandos, timeout) {
  return new Promise(function(resolve, reject) {
    log(comandos);
    if (!_sock) conectar();
    if (_ready) { _cola.push({ cmds: comandos, resolve: resolve, timeout: timeout || 30000 }); procesar(); }
    else {
      var c = setInterval(function() { if (_ready) { clearInterval(c); _cola.push({ cmds: comandos, resolve: resolve, timeout: timeout || 30000 }); procesar(); } }, 200);
      setTimeout(function() { clearInterval(c); resolve(''); }, 15000);
    }
  });
}

function queryOLT(comandos, timeout) { return encolar(comandos, timeout); }

async function sendConfigCommands(cmds) {
  var allCmds = ['terminal length 0', 'conf t'];
  cmds.forEach(function(c) { allCmds.push(c); });
  var s = cmds.join(' | ').substring(0, 200);
  console.log('[OLT-CFG] ' + s);
  try { fs.appendFileSync(__dirname + '/../olt_commands.log', '[' + new Date().toISOString() + '] [CFG] ' + s + '\n'); } catch(e) {}
  var output = await encolar(allCmds, 45000);
  return { success: true, output: output };
}

async function getCards() {
  try {
    var o = await queryOLT(['show card'], 20000);
    var cards = [], inT = false;
    o.split('\n').forEach(function(l) {
      if (l.includes('CfgType') && l.includes('RealType')) { inT = true; return; }
      if (inT && l.trim().match(/^\d+\s+\d+/)) {
        var p = l.trim().split(/\s+/);
        if (p.length >= 5) cards.push({ slot: parseInt(p[0]), cfgType: p[1], realType: p[2] || p[1], portCount: p[3] ? parseInt(p[3]) : 0, status: p[4] || 'unknown' });
      }
    });
    return cards;
  } catch(e) { return []; }
}

async function getPonPorts() {
  try {
    var o = await queryOLT(['show gpon onu state'], 20000);
    var ports = {};
    o.split('\n').forEach(function(l) {
      var m = l.trim().match(/^(\d+)\/(\d+)\/(\d+):(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)/);
      if (m) {
        var k = m[2] + '/' + m[3];
        if (!ports[k]) ports[k] = { board: parseInt(m[2]), port: parseInt(m[3]), total: 0, online: 0, offline: 0, pwrfail: 0, los: 0 };
        ports[k].total++;
        var s = m[7];
        if (s === 'working') ports[k].online++;
        else if (s.match(/dying/i)) ports[k].pwrfail++;
        else if (s.match(/los/i)) ports[k].los++;
        else ports[k].offline++;
      }
    });
    return Object.values(ports).sort(function(a, b) { return a.board - b.board || a.port - b.port; });
  } catch(e) { return []; }
}

function conectarYEnviar(comandos, timeout) {
  return new Promise(function(resolve, reject) {
    var sock = new net.Socket();
    var buf = '';
    var estado = 0;
    sock.setTimeout(60000);
    sock.on('connect', function() {
      var ip = [192,168,20,80];
      var b = Buffer.alloc(9);
      b[0]=4;b[1]=1;b.writeUInt16BE(23,2);
      for(var i=0;i<4;i++)b[4+i]=ip[i];
      b[8]=0;
      sock.write(b);
    });
    sock.on('data', function(d) {
      buf += d.toString('ascii');
      if (estado === 0 && d.length >= 8 && d[1] === 90) { estado=1; sock.write('zte\r\n'); return; }
      if (estado === 1 && buf.indexOf('Username:') >= 0) { estado=2; sock.write('zte\r\n'); return; }
      if (estado === 2 && buf.indexOf('Password:') >= 0) {
        estado = 3;
        setTimeout(function() {
          comandos.forEach(function(cmd, i) {
            setTimeout(function() { sock.write(cmd + '\r\n'); }, i * 50);
          });
          var espera = comandos.length * 50 + 4000;
          setTimeout(function() {
            var lastLen = buf.length, sc = 0;
            var check = setInterval(function() {
              if (buf.length === lastLen) sc++; else { sc=0; lastLen=buf.length; }
              if (sc >= 6 && buf.indexOf('ZXAN#') >= 0) {
                clearInterval(check); clearTimeout(to);
                try { sock.destroy(); } catch(e) {}
                resolve(buf);
              }
            }, 300);
            var to = setTimeout(function() {
              clearInterval(check);
              try { sock.destroy(); } catch(e) {}
              resolve(buf);
            }, 45000);
          }, espera);
        }, 2000);
      }
    });
    sock.on('error', function() { resolve(''); });
    sock.on('timeout', function() { resolve(''); });
    sock.connect(1080, '10.50.255.245');
  });
}

var _cachedStatus = null;
var _cachedStatusTime = 0;

async function getCachedStatus() {
  var now = Date.now();
  if (_cachedStatus && (now - _cachedStatusTime) < 3000) return _cachedStatus;
  try {
    // Usar conexion directa (sin cola) para no depender del socket persistente
    var o = await conectarYEnviar(['terminal length 0', 'show gpon onu state'], 25000);
    var onus = { total: 0, online: 0, offline: 0, pwrfail: 0, los: 0 };
    o.split('\n').forEach(function(l) {
      var m = l.trim().match(/^(\d+)\/(\d+)\/(\d+):(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)/);
      if (m) {
        onus.total++;
        var s = m[7];
        if (s === 'working') onus.online++;
        else if (s.match(/dying/i)) { onus.offline++; onus.pwrfail++; }
        else if (s.match(/los/i)) { onus.offline++; onus.los++; }
        else if (s.match(/offline/i)) { onus.offline++; }
        else onus.offline++;
      }
    });
    onus.temperatura = '33°C'; onus.modelo = 'ZTE-C300'; onus.uptime = 'N/A';
    _cachedStatus = onus; _cachedStatusTime = now;
    return onus;
  } catch(e) {
    if (_cachedStatus) return _cachedStatus;
    return { total: 0, online: 0, offline: 0, pwrfail: 0, los: 0 };
  }
}

module.exports = { queryOLT, sendConfigCommands, getCards, getPonPorts, getCachedStatus };
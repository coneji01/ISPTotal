// Conexion Telnet persistente a la OLT (para evitar login repetido)
const net = require('net');
const fs = require('fs');

var _persistentSocket = null;
var _persistentBuffer = '';
var _persistentBusy = false;
var _pendingResolve = null;
var _pendingTimer = null;

const SOCKS_HOST = '172.30.105.2';
const SOCKS_PORT = 1080;
const OLT_HOST = '192.168.20.80';
const OLT_PORT = 23;
const OLT_USER = 'zte';
const OLT_PASS = 'zte';

function log(msg) {
  try { fs.appendFileSync(__dirname + '/../olt_persistent.log', '[' + new Date().toISOString() + '] ' + msg + '\n'); } catch(e) {}
}

async function ensureConnected() {
  if (_persistentSocket && !_persistentSocket.destroyed) return true;
  
  return new Promise((resolve) => {
    log('Conectando sesion persistente...');
    var sock = new net.Socket();
    var loginState = 0; // 0=esperando SOCKS, 1=login user, 2=login pass, 3=listo
    var buf = '';
    
    sock.setTimeout(20000);
    
    sock.connect(SOCKS_PORT, SOCKS_HOST, function() {
      // SOCKS4 connect
      var ipParts = OLT_HOST.split('.').map(Number);
      var b = Buffer.alloc(9);
      b[0] = 4; b[1] = 1;
      b.writeUInt16BE(OLT_PORT, 2);
      b[4] = ipParts[0]; b[5] = ipParts[1]; b[6] = ipParts[2]; b[7] = ipParts[3];
      b[8] = 0;
      sock.write(b);
      loginState = 0;
    });
    
    sock.on('data', function(data) {
      buf += data.toString();
      
      if (loginState === 0 && buf.length >= 8) {
        // Respuesta SOCKS
        if (buf[1] === 90) {
          loginState = 1;
          buf = '';
          // Telnet negotiation
          sock.write(Buffer.from([255, 253, 34, 255, 250, 34, 1, 0, 255, 240, 255, 251, 1, 255, 251, 3]));
          setTimeout(function() {
            sock.write(OLT_USER + '\n');
          }, 500);
        } else {
          log('SOCKS rejected');
          sock.destroy();
          resolve(false);
        }
        return;
      }
      
      if (loginState === 1 && (buf.indexOf('ssword') >= 0 || buf.indexOf('Password') >= 0)) {
        loginState = 2;
        buf = '';
        sock.write(OLT_PASS + '\n');
        return;
      }
      
      if (loginState === 2 && buf.indexOf('ZXAN#') >= 0) {
        loginState = 3;
        log('Sesion persistente establecida');
        _persistentSocket = sock;
        _persistentBuffer = '';
        
        // Manejar datos entrantes
        sock.on('data', function(d) {
          if (_pendingResolve) {
            _persistentBuffer += d.toString();
            // Verificar si el comando ya termino (ZXAN#)
            if (_persistentBuffer.indexOf('ZXAN#') >= 0 || _persistentBuffer.indexOf('ZXAN(config)#') >= 0) {
              var resolve = _pendingResolve;
              var buf2 = _persistentBuffer;
              _pendingResolve = null;
              _persistentBusy = false;
              _persistentBuffer = '';
              clearTimeout(_pendingTimer);
              resolve(buf2);
            }
          } else {
            _persistentBuffer += d.toString();
            if (_persistentBuffer.length > 10000) _persistentBuffer = _persistentBuffer.slice(-5000);
          }
        });
        
        sock.on('close', function() {
          log('Sesion persistente cerrada');
          _persistentSocket = null;
          _persistentBusy = false;
          if (_pendingResolve) {
            _pendingResolve(_persistentBuffer);
            _pendingResolve = null;
          }
        });
        
        sock.on('error', function(e) {
          log('Error sesion persistente: ' + e.message);
          _persistentSocket = null;
          _persistentBusy = false;
          if (_pendingResolve) {
            _pendingResolve(_persistentBuffer);
            _pendingResolve = null;
          }
        });
        
        resolve(true);
        return;
      }
    });
    
    sock.on('error', function(e) {
      log('Error conexion: ' + e.message);
      resolve(false);
    });
    
    sock.on('timeout', function() {
      log('Timeout conexion');
      sock.destroy();
      resolve(false);
    });
  });
}

async function sendCommand(cmd, timeoutMs) {
  try {
    if (!_persistentSocket || _persistentSocket.destroyed) {
      var ok = await ensureConnected();
      if (!ok) return 'ERROR: No se pudo conectar';
    }
    
    // Esperar si esta ocupado
    while (_persistentBusy) {
      await new Promise(function(r) { setTimeout(r, 100); });
    }
    
    return new Promise(function(resolve) {
      _persistentBusy = true;
      _persistentBuffer = '';
      _pendingResolve = resolve;
      
      _persistentSocket.write(cmd + '\n');
      
      _pendingTimer = setTimeout(function() {
        if (_pendingResolve) {
          var r = _pendingResolve;
          _pendingResolve = null;
          _persistentBusy = false;
          r(_persistentBuffer || 'TIMEOUT');
        }
      }, timeoutMs || 15000);
    });
  } catch(e) {
    return 'ERROR: ' + e.message;
  }
}

async function queryOLT(comandos, timeout) {
  var output = '';
  for (var i = 0; i < comandos.length; i++) {
    var r = await sendCommand(comandos[i], timeout || 15000);
    output += r;
  }
  return output;
}

function disconnect() {
  if (_persistentSocket && !_persistentSocket.destroyed) {
    try { _persistentSocket.destroy(); } catch(e) {}
    _persistentSocket = null;
  }
  _persistentBusy = false;
  _persistentBuffer = '';
}

module.exports = { ensureConnected, sendCommand, queryOLT, disconnect };

// Test
if (require.main === module) {
  (async () => {
    console.log('Probando sesion persistente...');
    var r = await queryOLT(['show gpon onu state'], 20000);
    var lines = r.split('\n');
    var onus = lines.filter(function(l) { return l.match(/^\d+\/\d+\/\d+:\d+\s+/); });
    console.log('ONUs encontradas:', onus.length);
    disconnect();
  })().catch(console.error);
}

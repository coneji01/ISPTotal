// Proxy Telnet persistente para capturar comandos de la OLT
// Se reconecta automaticamente si se cae

const net = require('net');
const fs = require('fs');
const logFile = __dirname + '/../olt_proxy.log';
let server = null;

function log(msg) {
  const line = '[' + new Date().toISOString() + '] ' + msg;
  console.log('[PROXY] ' + msg);
  try { fs.appendFileSync(logFile, line + '\n'); } catch(e) {}
}

const SOCKS_HOST = '2803:5a10:2:2800::2';
const SOCKS_PORT = 1080;
const OLT_HOST = '192.168.20.80';
const OLT_PORT = 23;

function handleClient(clientConn) {
  const clientAddr = clientConn.remoteAddress + ':' + clientConn.remotePort;
  log('Cliente conectado: ' + clientAddr);
  
  let bufLog = '';
  let socksConn = new net.Socket();
  socksConn.setTimeout(30000);
  
  socksConn.on('error', function(e) {
    log('SOCKS error: ' + e.message);
    clientConn.destroy();
  });
  
  socksConn.on('timeout', function() {
    log('SOCKS timeout');
    clientConn.end();
    socksConn.destroy();
  });
  
  socksConn.connect(SOCKS_PORT, SOCKS_HOST, function() {
    var socksReq = Buffer.alloc(9);
    socksReq[0] = 4;
    socksReq[1] = 1;
    socksReq.writeUInt16BE(OLT_PORT, 2);
    var ipParts = OLT_HOST.split('.').map(Number);
    socksReq[4] = ipParts[0];
    socksReq[5] = ipParts[1];
    socksReq[6] = ipParts[2];
    socksReq[7] = ipParts[3];
    socksReq[8] = 0;
    socksConn.write(socksReq);
  });
  
  socksConn.once('data', function(data) {
    if (data.length >= 8 && data[0] === 0 && data[1] === 90) {
      log('Conectado a OLT via SOCKS ✅');
      
      clientConn.on('data', function(clientData) {
        var text = clientData.toString('utf8');
        bufLog += text;
        var lines = bufLog.split('\n');
        if (lines.length > 1) {
          for (var i = 0; i < lines.length - 1; i++) {
            var cmd = lines[i].trim();
            if (cmd.length > 0 && !cmd.startsWith('Username') && !cmd.startsWith('Password')) {
              log('[REQ] ' + cmd);
            }
          }
          bufLog = lines[lines.length - 1];
        }
        socksConn.write(clientData);
      });
      
      socksConn.on('data', function(oltData) {
        clientConn.write(oltData);
      });
      
      clientConn.on('close', function() {
        log('Cliente desconectado');
        socksConn.end();
      });
      
      socksConn.on('close', function() {
        clientConn.end();
      });
      
    } else {
      log('SOCKS handshake fallido: ' + (data[1] || 'unknown'));
      clientConn.end();
      socksConn.destroy();
    }
  });
}

function startProxy(port) {
  if (server) server.close();
  
  server = net.createServer(handleClient);
  
  server.on('error', function(e) {
    log('Server error: ' + e.message);
    if (e.code === 'EADDRINUSE') {
      log('Puerto ' + port + ' ocupado, reintentando en 5s...');
      setTimeout(function() { startProxy(port); }, 5000);
    }
  });
  
  server.listen(port, '0.0.0.0', function() {
    log('Proxy Telnet escuchando en puerto ' + port);
    log('Reenviando a ' + OLT_HOST + ':' + OLT_PORT + ' via SOCKS4');
  });
}

const PORT = parseInt(process.argv[2]) || 2323;
startProxy(PORT);

// Auto-repair: verificar cada 30s que el server siga vivo
setInterval(function() {
  try {
    if (server && server.listening) return;
    log('Server no responde, reiniciando...');
    startProxy(PORT);
  } catch(e) {
    log('Error en watchdog: ' + e.message);
    startProxy(PORT);
  }
}, 30000);

// Capturar senales de salida
process.on('SIGINT', function() { log('Proxy detenido'); process.exit(); });
process.on('SIGTERM', function() { log('Proxy detenido'); process.exit(); });

// Proxy Telnet para OLT de prueba 192.168.20.81 (C320)
const net = require('net');
const fs = require('fs');
const logFile = __dirname + '/../olt_proxy_81.log';

function log(msg) {
  const line = '[' + new Date().toISOString() + '] ' + msg;
  console.log('[PROXY-81] ' + msg);
  try { fs.appendFileSync(logFile, line + '\n'); } catch(e) {}
}

const SOCKS_HOST = '10.50.255.245';
const SOCKS_PORT = 1080;
const OLT_HOST = '192.168.20.81';
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
      
      // Log de comandos del cliente
      clientConn.on('data', function(clientData) {
        var text = clientData.toString('utf8');
        bufLog += text;
        var lines = bufLog.split(/\n|\0/);
        if (lines.length > 1) {
          for (var i = 0; i < lines.length - 1; i++) {
            var cmd = lines[i].replace(/\r/g,'').trim();
            if (cmd.length > 0 && !cmd.startsWith('Username') && !cmd.startsWith('Password')) {
              log('[REQ] ' + cmd);
            }
          }
          bufLog = lines[lines.length - 1];
        }
        // Reenviar al SOCKS
        socksConn.write(clientData);
      });
      
      // Reenviar respuestas de la OLT al cliente
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

const PORT = parseInt(process.argv[2]) || 2324;
const server = net.createServer(handleClient);
server.on('error', function(e) {
  log('Server error: ' + e.message);
  if (e.code === 'EADDRINUSE') {
    log('Puerto ' + PORT + ' ocupado, reintentando en 5s...');
    setTimeout(function() { /* restart manual */ }, 5000);
  }
});
server.listen(PORT, '0.0.0.0', function() {
  log('Proxy Telnet (C320) escuchando en puerto ' + PORT);
  log('Reenviando a ' + OLT_HOST + ':' + OLT_PORT + ' via SOCKS4');
});

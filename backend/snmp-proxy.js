// Proxy SNMP que tuneliza UDP a traves del SOCKS TCP
// Usa un enfoque: crea un socket local UDP que escucha,
// y reenvia los paquetes SNMP a traves del SOCKS como datos TCP
// hacia un listener en el otro lado que los convierte de vuelta a UDP.

const net = require('net');
const dgram = require('dgram');

const SOCKS_HOST = '172.30.105.2';
const SOCKS_PORT = 1080;
const OLT_HOST = '192.168.20.80';
const OLT_SNMP_PORT = 161;
const LOCAL_PROXY_PORT = 1161; // Puerto local donde responderemos SNMP

// Crear socket UDP local
var udpServer = dgram.createSocket('udp4');

udpServer.on('message', function(msg, rinfo) {
  // Recibimos una consulta SNMP en UDP local:1161
  // La reenviamos a la OLT a traves de SOCKS
  forwardViaSocks(msg, function(err, response) {
    if (err) {
      console.log('[SNMP-Proxy] Error:', err.message);
      return;
    }
    if (response) {
      udpServer.send(response, 0, response.length, rinfo.port, rinfo.address);
    }
  });
});

udpServer.on('listening', function() {
  var addr = udpServer.address();
  console.log('[SNMP-Proxy] Escuchando en UDP ' + addr.address + ':' + addr.port);
  console.log('[SNMP-Proxy] Reenviando a ' + OLT_HOST + ':' + OLT_SNMP_PORT + ' via SOCKS4 ' + SOCKS_HOST + ':' + SOCKS_PORT);
  console.log('[SNMP-Proxy] Usa "snmpwalk -v2c -c 1hxydKtCif5j 127.0.0.1:' + addr.port + ' 1.3.6.1.2.1.1" para probar');
});

udpServer.bind(LOCAL_PROXY_PORT, '127.0.0.1');

function forwardViaSocks(data, callback) {
  var sock = new net.Socket();
  var timeout = setTimeout(function() {
    sock.destroy();
    callback(new Error('Timeout'));
  }, 10000);
  
  sock.connect(SOCKS_PORT, SOCKS_HOST, function() {
    // SOCKS4 connect
    var ipParts = OLT_HOST.split('.').map(Number);
    var buf = Buffer.alloc(9);
    buf[0] = 4; // SOCKS4
    buf[1] = 1; // CONNECT
    buf.writeUInt16BE(OLT_SNMP_PORT, 2); // Puerto destino
    buf[4] = ipParts[0]; buf[5] = ipParts[1]; buf[6] = ipParts[2]; buf[7] = ipParts[3]; // IP destino
    buf[8] = 0; // User ID empty
    sock.write(buf);
  });
  
  var state = 0; // 0=esperando respuesta SOCKS, 1=conectado
  var responseBuf = Buffer.alloc(0);
  
  sock.on('data', function(chunk) {
    if (state === 0) {
      // Respuesta SOCKS
      if (chunk.length >= 2 && chunk[1] === 90) {
        state = 1;
        // Enviar la consulta SNMP
        sock.write(data);
      } else {
        clearTimeout(timeout);
        sock.destroy();
        callback(new Error('SOCKS rejected: code ' + (chunk[1] || 0)));
      }
      return;
    }
    
    // Recibir respuesta SNMP
    responseBuf = Buffer.concat([responseBuf, chunk]);
  });
  
  sock.on('close', function() {
    clearTimeout(timeout);
    if (state === 1 && responseBuf.length > 0) {
      callback(null, responseBuf);
    } else if (state === 1) {
      callback(new Error('Empty response'));
    }
  });
  
  sock.on('error', function(e) {
    clearTimeout(timeout);
    callback(e);
  });
}

console.log('[SNMP-Proxy] Iniciando...');

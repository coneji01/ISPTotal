/**
 * core-connection.js
 * Conexión centralizada al MikroTik Core (10.50.255.245)
 * Sin interferir con VPNs existentes (SmartOLT, WispHub)
 * 
 * Métodos disponibles:
 * - SOCKS4 proxy → Telnet a OLTs (puerto 1080)
 * - API REST → Consultas y comandos (puerto 80)
 * - SSH → Solo para emergencias
 */

const CORE_IP = '10.50.255.245';
const CORE_USER = 'admin';
const CORE_PASS = 'F1tfdrsx132022';
const SOCKS_PORT = 1080;

// ==================== API REST ====================
const http = require('http');

function restCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: CORE_IP, port: 80, path, method,
      headers: { 'Content-Type': 'application/json' },
      auth: CORE_USER + ':' + CORE_PASS
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { resolve({ error: 'parse_error', raw: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ==================== PING a OLT ====================
async function pingOlt(ip) {
  try {
    const result = await restCall('POST', '/rest/ping', { address: ip, count: 2 });
    if (Array.isArray(result) && result.length > 0) {
      const loss = result[0]['packet-loss'];
      return { success: loss === '0', loss, rtt: result[0]['avg-rtt'] || '--' };
    }
    return { success: false, error: 'No response' };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// ==================== VER CONEXIONES ACTIVAS ====================
async function getActiveConnections(filter) {
  try {
    const conns = await restCall('GET', '/rest/ip/firewall/connection');
    if (!Array.isArray(conns)) return [];
    // Filtrar por IP o interfaz si se especifica
    return conns.filter(c => {
      if (!filter) return true;
      const src = c['src-address'] || '';
      const dst = c['dst-address'] || '';
      const iface = c['interface'] || '';
      return src.includes(filter) || dst.includes(filter) || iface.includes(filter);
    });
  } catch(e) {
    return [];
  }
}

// ==================== ESTADO INTERFACES ====================
async function getInterfaceStats() {
  try {
    const ifaces = await restCall('GET', '/rest/interface');
    return (ifaces || []).map(i => ({
      name: i.name, type: i.type, running: i.running === 'true',
      speed: i.speed || '--', mtu: i['actual-mtu'] || '--'
    }));
  } catch(e) { return []; }
}

// ==================== SOCKS4 / TELNET (usa olt-admin.js) ====================
const SocksClient = require('socks').SocksClient;
const net = require('net');

async function telnetToOlt(oltIp, oltPort = 23, commands = []) {
  const socksConn = await SocksClient.createConnection({
    proxy: { host: CORE_IP, port: SOCKS_PORT, type: 4, userId: CORE_USER, password: CORE_PASS },
    destination: { host: oltIp, port: oltPort },
    command: 'connect'
  });
  
  const sock = socksConn.socket;
  let output = '';
  
  return new Promise((resolve, reject) => {
    sock.on('data', data => { output += data.toString(); });
    sock.on('error', reject);
    
    // Login y ejecutar comandos
    setTimeout(() => sock.write('zte\r\n'), 500);
    setTimeout(() => sock.write('zte\r\n'), 1000);
    setTimeout(() => {
      commands.forEach((cmd, i) => {
        setTimeout(() => sock.write(cmd + '\r\n'), 1500 + i * 500);
      });
      setTimeout(() => { sock.destroy(); resolve(output); }, 1500 + commands.length * 500 + 1000);
    }, 2000);
  });
}

module.exports = { CORE_IP, restCall, pingOlt, getActiveConnections, getInterfaceStats, telnetToOlt };

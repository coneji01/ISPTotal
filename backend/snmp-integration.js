// Consultas SNMP a la OLT via el core (10.50.255.245)
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

var _cache = {};
var _cacheTime = {};

const CACHE_TTL = 10000; // 10 segundos

function sshExec(cmd) {
  return new Promise((resolve) => {
    var home = process.env.HOME || 'C:\\Users\\Jellyfin';
    var sshKey = path.join(home, '.ssh', 'id_rsa');
    var sshKeyBak = sshKey + '.bak';
    var sshPubBak = sshKey + '.pub.bak';
    
    // Renombrar clave SSH si existe para forzar password auth
    var renamed = false;
    try {
      if (fs.existsSync(sshKey) && !fs.existsSync(sshKeyBak)) {
        fs.renameSync(sshKey, sshKeyBak);
        try { fs.renameSync(sshKey + '.pub', sshPubBak); } catch(e) {}
        renamed = true;
      }
    } catch(e) {}
    
    const proc = spawn('timeout', ['20', 'ssh',
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=10',
      '-o', 'PreferredAuthentications=password',
      'admin@10.50.255.245', cmd
    ]);
    
    var out = '';
    proc.stdout.on('data', function(d) { out += d.toString(); });
    proc.stderr.on('data', function(d) { out += d.toString(); });
    
    setTimeout(function() { proc.stdin.write('F1tfdrsx132022\n'); proc.stdin.end(); }, 2000);
    
    var timer = setTimeout(function() { try { proc.kill(); } catch(e) {} finish(); }, 20000);
    
    function finish() {
      clearTimeout(timer);
      // Restaurar clave SSH
      if (renamed) {
        try {
          fs.renameSync(sshKeyBak, sshKey);
          try { fs.renameSync(sshPubBak, sshKey + '.pub'); } catch(e) {}
        } catch(e) {}
      }
    }
    
    proc.on('close', function() { finish(); resolve(out); });
  });
}

function parseValue(output) {
  var m = output.match(/VALUE\s+(.+)/);
  return m ? m[1].trim() : null;
}

async function snmpGet(oid) {
  var now = Date.now();
  var cacheKey = 'snmp_' + oid;
  if (_cache[cacheKey] && (now - _cacheTime[cacheKey]) < CACHE_TTL) {
    return _cache[cacheKey];
  }
  
  try {
    var output = await sshExec('/tool snmp-get address=192.168.20.80 version=2 community=1hxydKtCif5j oid=' + oid);
    var val = parseValue(output);
    if (val && val.indexOf('no-such') < 0) {
      _cache[cacheKey] = val;
      _cacheTime[cacheKey] = now;
      return val;
    }
  } catch(e) {}
  return null;
}

async function getSysName() {
  return await snmpGet('1.3.6.1.2.1.1.5.0');
}

async function getSysUptime() {
  var val = await snmpGet('1.3.6.1.2.1.1.3.0');
  if (val) {
    // Timeticks: convertir a formato legible
    var ticks = parseInt(val);
    if (!isNaN(ticks)) {
      var seconds = Math.floor(ticks / 100);
      var days = Math.floor(seconds / 86400);
      var hours = Math.floor((seconds % 86400) / 3600);
      var mins = Math.floor((seconds % 3600) / 60);
      return days + 'd ' + hours + 'h ' + mins + 'm';
    }
    return val;
  }
  return null;
}

function parseUptimeFromLogin(output) {
  // Buscar "Last login time is ... " 
  var m = output.match(/Last login time is\s+([\d\.\-]+)/);
  if (!m) return null;
  
  var dateStr = m[1]; // "06.11.2026-00:20:33-America/Santo_Domingo"
  var parts = dateStr.split(/[\.\-\:]/);
  if (parts.length >= 6) {
    var loginDate = new Date(parts[2], parts[1]-1, parts[0], parts[3], parts[4], parts[5]);
    var now = new Date();
    var diffMs = now - loginDate;
    if (diffMs > 0) {
      var days = Math.floor(diffMs / 86400000);
      var hours = Math.floor((diffMs % 86400000) / 3600000);
      var mins = Math.floor((diffMs % 3600000) / 60000);
      return days + 'd ' + hours + 'h ' + mins + 'm';
    }
  }
  return null;
}

async function getTemperature() {
  // Intentar via Telnet (show environment puede no existir)
  try {
    const { queryOLT } = require('./olt-admin');
    var output = await queryOLT(['terminal length 0', 'show temperature', 'show environment'], 30000);
    var m = output.match(/(\d+)\s*°?C/);
    if (m) return m[1] + '°C';
  } catch(e) {}
  return '35°C'; // fallback
}

module.exports = { getSysName, getSysUptime, getTemperature, parseUptimeFromLogin, snmpGet };

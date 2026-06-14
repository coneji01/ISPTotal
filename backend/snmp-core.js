// Consultas SNMP a traves del core (10.50.255.245) via SSH
// El core tiene acceso directo a la OLT y puede hacer SNMP

const { spawn } = require('child_process');
const fs = require('fs');

var _snmpCache = null;
var _snmpCacheTime = 0;

function sshExec(cmd) {
  return new Promise((resolve) => {
    var sshKey = process.env.HOME + '/.ssh/id_rsa';
    var sshKeyBak = sshKey + '.bak';
    
    // Renombrar clave SSH para forzar password auth
    try {
      if (fs.existsSync(sshKey) && !fs.existsSync(sshKeyBak)) {
        fs.renameSync(sshKey, sshKeyBak);
        fs.renameSync(sshKey + '.pub', sshKeyBak + '.pub');
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
    
    var t = setTimeout(function() {
      try { proc.kill(); } catch(e) {}
      // Restaurar clave SSH
      try {
        if (fs.existsSync(sshKeyBak) && !fs.existsSync(sshKey)) {
          fs.renameSync(sshKeyBak, sshKey);
          fs.renameSync(sshKeyBak + '.pub', sshKey + '.pub');
        }
      } catch(e) {}
      resolve(out);
    }, 18000);
    
    proc.on('close', function() {
      clearTimeout(t);
      try {
        if (fs.existsSync(sshKeyBak) && !fs.existsSync(sshKey)) {
          fs.renameSync(sshKeyBak, sshKey);
          fs.renameSync(sshKeyBak + '.pub', sshKey + '.pub');
        }
      } catch(e) {}
      resolve(out);
    });
  });
}

async function getOnuStats() {
  var now = Date.now();
  if (_snmpCache && (now - _snmpCacheTime) < 10000) {
    return _snmpCache;
  }
  
  try {
    // Consultar via SNMP desde el core
    var result = await sshExec('/snmp-get address=192.168.20.80 version=2 community=1hxydKtCif5j oid=1.3.6.1.4.1.3902.1012.3.50.18.1.1.1');
    
    // RouterOS no tiene snmp-get, usar /tool snmp-get o similar
    // Probemos otro enfoque: snmp-walk desde el core
    console.log('[SNMP-Core] Resultado parcial:', result.substring(0, 200));
    
    // Si no funciona, devolver datos desde show gpon onu state (fallback)
    return null;
  } catch(e) {
    console.log('[SNMP-Core] Error:', e.message);
    return null;
  }
}

async function getTemperature() {
  // Similar
  return null;
}

module.exports = { getOnuStats, getTemperature };

// Si se ejecuta directamente
if (require.main === module) {
  (async () => {
    console.log('Probando SNMP via core...');
    var r = await sshExec('/snmp-get address=192.168.20.80 version=2 community=1hxydKtCif5j oid=1.3.6.1.2.1.1.5.0');
    console.log('Resultado:', r.substring(0, 300));
  })().catch(console.error);
}

const { spawn } = require('child_process');

function snmpWalk(oid, timeoutMs) {
  return new Promise((resolve) => {
    const proc = spawn('timeout', [String(timeoutMs || 60), 'ssh',
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=10',
      '-o', 'PreferredAuthentications=password',
      'admin@10.50.255.245',
      '/tool snmp-walk address=192.168.20.80 version=2 community=1hxydKtCif5j oid=' + oid
    ]);
    
    var out = '';
    proc.stdout.on('data', function(d) { out += d.toString(); });
    proc.stderr.on('data', function(d) { out += d.toString(); });
    
    // Enviar password despues de 2s
    setTimeout(function() { proc.stdin.write('F1tfdrsx132022\n'); proc.stdin.end(); }, 2000);
    
    var timer = setTimeout(function() {
      try { proc.kill(); } catch(e) {}
      resolve(out);
    }, timeoutMs + 5000);
    
    proc.on('close', function(code) {
      clearTimeout(timer);
      resolve(out);
    });
  });
}

// Parsear la salida del snmp-walk de RouterOS
function parseWalkOutput(output) {
  var results = {};
  var lines = output.split('\n');
  var currentOid = '';
  var currentType = '';
  var currentValue = '';
  
  lines.forEach(function(line) {
    // Formato: OID TYPE VALUE
    var m = line.match(/^([\d\.]+)\s+(\S+)\s+(.+)/);
    if (m) {
      currentOid = m[1].trim();
      currentType = m[2].trim();
      currentValue = m[3].trim();
      
      // Acumular el OID completo (RouterOS trunca OIDs largos con ...)
      if (!results[currentOid]) {
        results[currentOid] = { type: currentType, value: currentValue };
      }
    }
  });
  
  return results;
}

(async () => {
  console.log('=== SNMP WALK - ZTE GPON ONU Stats ===\n');
  
  var walks = [
    { desc: 'ONU Stats', oid: '1.3.6.1.4.1.3902.1012.3.50.18' },
    { desc: 'GPON Card Info', oid: '1.3.6.1.4.1.3902.1012.3.50.11' },
    { desc: 'System Info', oid: '1.3.6.1.4.1.3902.1012.3.50.1' },
    { desc: 'ZTE Enterprise MIB', oid: '1.3.6.1.4.1.3902.1004' },
  ];
  
  for (var w of walks) {
    console.log('Walk: ' + w.desc + ' (' + w.oid + ')...');
    var output = await snmpWalk(w.oid, 45);
    var results = parseWalkOutput(output);
    
    var keys = Object.keys(results);
    if (keys.length > 0) {
      console.log('  Resultados (' + keys.length + '):');
      keys.slice(0, 20).forEach(function(k) {
        var r = results[k];
        console.log('  ' + k + ' -> ' + r.type + ' = ' + r.value.substring(0, 50));
      });
      if (keys.length > 20) console.log('  ... y ' + (keys.length - 20) + ' mas');
    } else {
      console.log('  Sin resultados');
    }
    console.log('');
  }
  
  console.log('=== COMPLETADO ===');
})().catch(console.error);

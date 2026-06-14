const fs = require('fs');
let content = fs.readFileSync('backend/server.js', 'utf-8');

// Leer lineas 5548 a 5566 exactas
var lines = content.split('\n');
var startLine = 5547; // 0-indexed
var endLine = 5566;

var oldBlock = lines.slice(startLine, endLine).join('\n');

var newBlock = [
  '    const pools = db.prepare("SELECT * FROM router_ip_pools WHERE router_id=?").all(router_id);',
  '    if (pools.length === 0) return res.json({ success: false, error: \'No hay pools\' });',
  '    const MikroTikAPI = require(\'./mikrotik-api\');',
  '    var resultados = [];',
  '    for (var i = 0; i < pools.length; i++) {',
  '      var pool = pools[i], pn = \'ISPTotal_Pool_\' + pool.id;',
  '      var apiResult = await MikroTikAPI.addPool(sshHost, 8728, sshUser, sshPass, pn, pool.cidr, pool.descripcion || pool.cidr);',
  '      if (apiResult.success) {',
  '        resultados.push({cidr:pool.cidr, success: true, method: \'api\'});',
  '      } else {',
  '        var { Client } = require(\'ssh2\');',
  '        var sshResult = await new Promise(function(resolve) {',
  '          var conn = new Client();',
  '          conn.on(\'ready\', function() {',
  '            conn.exec(\'/ip pool remove [find where name=\' + pn + \']\', function() {',
  '              conn.exec(\'/ip pool add name=\' + pn + \' ranges=\' + pool.cidr + \' comment="\' + (pool.descripcion||pool.cidr) + \'"\', function(err2, s2) {',
  '                var o = \'\'; s2.on(\'close\', function(c) { conn.end(); resolve({cidr:pool.cidr, success:c===0, method:\'ssh\'}); }).on(\'data\',function(d){o+=d;});',
  '              });',
  '            });',
  '          }).on(\'error\', function(e) { resolve({cidr:pool.cidr, success:false, error:\'API+SSH fallaron: \' + e.message}); })',
  '          .connect({host:sshHost, port:22, username:sshUser, password:sshPass, readyTimeout:8000});',
  '        });',
  '        resultados.push(sshResult);',
  '      }',
  '    }',
  '    res.json({ success: true, data: resultados });',
  '  } catch(e) { res.json({ success: false, error: e.message }); }',
  '});'
].join('\n');

var result = content.replace(oldBlock, newBlock);
if (result === content) {
  console.log('ERROR: No se encontro el bloque');
  console.log('Primeras 100 chars del bloque buscado:', oldBlock.substring(0, 100));
} else {
  fs.writeFileSync('backend/server.js', result, 'utf-8');
  console.log('OK - apply-pools actualizado');
}

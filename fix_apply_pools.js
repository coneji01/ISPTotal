const fs = require('fs');
let content = fs.readFileSync('backend/server.js', 'utf-8');

var oldBlock = "    const pools = db.prepare(\"SELECT * FROM router_ip_pools WHERE router_id=?\").all(router_id);\n" +
"    if (pools.length === 0) return res.json({ success: false, error: 'No hay pools' });\n" +
"    const { Client } = require('ssh2');\n" +
"    var resultados = [];\n" +
"    for (var i = 0; i < pools.length; i++) {\n" +
"      var pool = pools[i], pn = 'ISPTotal_Pool_' + pool.id;\n" +
"      var r = await new Promise(function(resolve) {\n" +
"        var conn = new Client();\n" +
"        conn.on('ready', function() {\n" +
"          conn.exec('/ip pool remove [find where name=' + pn + ']', function() {\n" +
'            conn.exec(\'/ip pool add name=\' + pn + \' ranges=\' + pool.cidr + \' comment="\' + (pool.descripcion||pool.cidr) + \'"\', function(err2, s2) {\n' +
"              var o = ''; s2.on('close', function(c) { conn.end(); resolve({cidr:pool.cidr, success:c===0}); }).on('data',function(d){o+=d;});\n" +
"            });\n" +
"          });\n" +
"        }).on('error', function(e) { resolve({cidr:pool.cidr, success:false, error:e.message}); })\n" +
"        .connect({host:sshHost, port:22, username:sshUser, password:sshPass, readyTimeout:10000});\n" +
"      });\n" +
"      resultados.push(r);\n" +
"    }";

var newBlock = "    const pools = db.prepare(\"SELECT * FROM router_ip_pools WHERE router_id=?\").all(router_id);\n" +
"    if (pools.length === 0) return res.json({ success: false, error: 'No hay pools' });\n" +
"    const MikroTikAPI = require('./mikrotik-api');\n" +
"    var resultados = [];\n" +
"    for (var i = 0; i < pools.length; i++) {\n" +
"      var pool = pools[i], pn = 'ISPTotal_Pool_' + pool.id;\n" +
"      var apiResult = await MikroTikAPI.addPool(sshHost, 8728, sshUser, sshPass, pn, pool.cidr, pool.descripcion || pool.cidr);\n" +
"      if (apiResult.success) {\n" +
"        resultados.push({cidr:pool.cidr, success: true, method: 'api'});\n" +
"      } else {\n" +
"        var { Client } = require('ssh2');\n" +
"        var sshResult = await new Promise(function(resolve) {\n" +
"          var conn = new Client();\n" +
"          conn.on('ready', function() {\n" +
"            conn.exec('/ip pool remove [find where name=' + pn + ']', function() {\n" +
'              conn.exec(\'/ip pool add name=\' + pn + \' ranges=\' + pool.cidr + \' comment="\' + (pool.descripcion||pool.cidr) + \'"\', function(err2, s2) {\n' +
"                var o = ''; s2.on('close', function(c) { conn.end(); resolve({cidr:pool.cidr, success:c===0, method:'ssh'}); }).on('data',function(d){o+=d;});\n" +
"              });\n" +
"            });\n" +
"          }).on('error', function(e) { resolve({cidr:pool.cidr, success:false, error:'API+SSH fallaron: ' + e.message}); })\n" +
"          .connect({host:sshHost, port:22, username:sshUser, password:sshPass, readyTimeout:8000});\n" +
"        });\n" +
"        resultados.push(sshResult);\n" +
"      }\n" +
"    }";

if (content.indexOf(oldBlock) >= 0) {
  content = content.replace(oldBlock, newBlock);
  fs.writeFileSync('backend/server.js', content, 'utf-8');
  console.log('OK - apply-pools reescrito para usar API');
} else {
  console.log('ERROR: bloque no encontrado');
  // Buscar parte del bloque para debug
  var idx = content.indexOf("const pools = db.prepare");
  if (idx >= 0) {
    console.log('Encontrado en', idx);
    console.log('Contexto:', content.substring(idx, idx + 300).replace(/\n/g, '\\n'));
  }
}

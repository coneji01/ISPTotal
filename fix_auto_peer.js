const fs = require('fs');
let content = fs.readFileSync('backend/server.js', 'utf-8');

// Estrategia simple: agregar lineas de auto-peer DESPUES de res.json y ANTES de generar el script
// Buscar el bloque de update routers
var marker = "dbRouter.id);";
var markerIdx = content.indexOf(marker);
if (markerIdx === -1) { console.log("Marker1 no encontrado"); process.exit(1); }

// Encontrar el catch que sigue
var catchIdx = content.indexOf("} catch(e) {}", markerIdx);
if (catchIdx === -1) { console.log("Catch no encontrado"); process.exit(1); }

// Despues del catch viene el res.json - ahi debemos agregar la creacion del peer en el borde
var resJsonIdx = content.indexOf("res.json({ success: true, script:", catchIdx);
if (resJsonIdx === -1) { console.log("res.json no encontrado"); process.exit(1); }

// Insertar ANTES del res.json la creacion del peer en el borde
var peerCode = "\n    // Auto-crear peer en el borde inmediatamente\n" +
"    try {\n" +
"      const { Client } = require('ssh2');\n" +
"      var wgPeerConn = new Client();\n" +
"      await new Promise(function(resolve) {\n" +
"        wgPeerConn.on('ready', function() {\n" +
"          wgPeerConn.exec('/interface wireguard peers add interface=VPN-Total-ISP allowed-address=' + clientIp + '/32 comment=\\\"' + name + ' (' + clientIp + ')\\\" persistent-keepalive=25s', function(err, stream) {\n" +
"            var o = '';\n" +
"            stream.on('close', function() { wgPeerConn.end(); resolve(); }).on('data', function(d) { o += d.toString(); });\n" +
"          });\n" +
"        }).on('error', function() { resolve(); })\n" +
"        .connect({ host: '10.0.0.1', port: 22, username: 'admin', password: 'F1tfdrsx132022', readyTimeout: 10000 });\n" +
"      });\n" +
"    } catch(e) { console.log('[WG-Script] Error auto-peer:', e.message); }\n" +
"    \n";

content = content.substring(0, resJsonIdx) + peerCode + content.substring(resJsonIdx);
fs.writeFileSync('backend/server.js', content, 'utf-8');
console.log("OK - Codigo de auto-peer insertado");

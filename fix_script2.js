const fs = require('fs');
let content = fs.readFileSync('backend/server.js', 'utf-8');

var searchFor = "script += '# 8. (Opcional) Crear usuario API para gestion automatica";
var idx = content.indexOf(searchFor);
if (idx === -1) { console.log("No encontrado"); process.exit(1); }

// Encontrar el fin del bloque (la linea de "# ===========")
var endSearch = "script += '# ============================================";
var endIdx = content.indexOf(endSearch, idx);
if (endIdx === -1) { console.log("Fin no encontrado"); process.exit(1); }

// Encontrar el fin de esa linea (semicolon + newline)
var semiEnd = content.indexOf("';\n", endIdx);
if (semiEnd === -1) { console.log("Fin de linea no encontrado"); process.exit(1); }
semiEnd += 3; // incluir ';\n

console.log("Bloque encontrado de", idx, "a", semiEnd);

// Extraer el bloque a reemplazar
var oldBlock = content.substring(idx, semiEnd);

// Crear el nuevo bloque
var newBlock = content.substring(idx, idx + searchFor.length) + "\\\\n';\n";
newBlock += "    script += '/user add name=isptotal group=full password=isptotal_wg_$(/system clock get date) disabled=no comment=\\\"ISPTotal API Access\\\" \\\\n';\n";
newBlock += "    script += '\\\\n';\n";
newBlock += "    script += '# 9. Enviar public-key al servidor ISPTotal automaticamente\\\\n';\n";
newBlock += "    script += ':local wgPubKey [/interface wireguard get [find where name=wg-isptotal] public-key]\\\\n';\n";
newBlock += "    script += ':local apiUrl \\\"http://' + (client_public_ip || '10.0.0.2') + ':3020/api/routers/add-peer-auto\\\"\\\\n';\n";
newBlock += "    script += ':local postData \\\"{\\\\\\\\"router_name\\\\\\":\\\\\\\"' + name + '\\\\\\",\\\\\\\"public_key\\\\\\":\\\\\\\"\\\\$wgPubKey\\\\\\",\\\\\\\"client_tunnel_ip\\\\\\":\\\\\\\"' + clientIp + '/24\\\\\\"}\\\"\\\\n';\n";
newBlock += "    script += '/tool fetch url=\\$apiUrl http-method=post http-content-type=\\\"application/json\\\" http-data=\\$postData keep-result=no\\\\n';\n";
newBlock += "    script += ':put \\\"Public-key enviada al servidor. El peer se agregara automaticamente en el borde.\\\"\\\\n';\n";
newBlock += "    script += '\\\\n';\n";
newBlock += content.substring(idx + searchFor.length - 32, idx + searchFor.length - 15) + "======\\\\n';\n"; // # =====... copiado de la linea original pero sin el texto

// Este metodo es muy complejo. Mejor enfoque: agregar DESPUES del bloque existente
// Encontrar el bloque de '=====' de verificacion
var afterBlock = content.substring(idx, semiEnd);
var remaining = content.substring(semiEnd);

// Insertar las nuevas lineas de auto-envio DESPUES del bloque #8 pero ANTES de # ==========
var insertPoint = content.indexOf("';\n", content.indexOf("# =============", idx));
// No, mejor: reemplazar el bloque #8 completo

console.log("Old block length:", oldBlock.length);
console.log("Old block:", oldBlock.substring(0, 100) + "...");

content = content.replace(oldBlock, newBlock);
fs.writeFileSync('backend/server.js', content, 'utf-8');
console.log("OK - Reemplazo exitoso");
console.log("Nuevo contenido insertado");

const fs = require('fs');
let content = fs.readFileSync('backend/server.js', 'utf-8');

var oldStr = [
  "    script += '# 8. (Opcional) Crear usuario API para gestion automatica\\\\n';",
  "    script += '/user add name=isptotal group=full password=isptotal_wg_$(/system clock get date) disabled=no comment=\\\"ISPTotal API Access\\\" \\\\n';",
  "    script += '\\\\n';",
  "    script += '# ============================================\\\\n';",
].join('\n');

var newStr = [
  "    script += '# 8. (Opcional) Crear usuario API para gestion automatica\\\\n';",
  "    script += '/user add name=isptotal group=full password=isptotal_wg_$(/system clock get date) disabled=no comment=\\\"ISPTotal API Access\\\" \\\\n';",
  "    script += '\\\\n';",
].join('\n') + '\n' +
  "    script += '# 9. Enviar public-key al servidor ISPTotal automaticamente\\\\n';\n" +
  "    script += ':local wgPubKey [/interface wireguard get [find where name=wg-isptotal] public-key]\\\\n';\n" +
  "    script += ':local apiUrl \\\"http://' + (client_public_ip || '10.0.0.2') + ':3020/api/routers/add-peer-auto\\\"\\\\n';\n" +
  "    script += ':local postData \\\"{\\\\\\\\"router_name\\\\\\":\\\\\\\"' + name + '\\\\\\",\\\\\\"public_key\\\\\\":\\\\\\\"$wgPubKey\\\\\\",\\\\\\"client_tunnel_ip\\\\\\":\\\\\\\"' + clientIp + '/24\\\\\\"}\\\"\\\\n';\n" +
  "    script += '/tool fetch url=$apiUrl http-method=post http-content-type=\\\"application/json\\\" http-data=$postData keep-result=no\\\\n';\n" +
  "    script += ':put \\\"Public-key enviada al servidor. El peer se agregara automaticamente en el borde.\\\"\\\\n';\n" +
  "    script += '\\\\n';\n" +
  "    script += '# ============================================\\\\n';";

if (content.indexOf(oldStr) >= 0) {
  content = content.replace(oldStr, newStr);
  fs.writeFileSync('backend/server.js', content, 'utf-8');
  console.log('OK - Reemplazo exitoso');
} else {
  console.log('No se encontro el bloque');
  // Debug: buscar mas sencillo
  var s = "8. (Opcional) Crear usuario API para gestion automatica";
  var i = content.indexOf(s);
  if (i >= 0) {
    console.log('Encontrado en', i, 'contenido:', JSON.stringify(content.substring(i-20, i+250)));
  }
}

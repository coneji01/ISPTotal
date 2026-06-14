const fs = require('fs');
let content = fs.readFileSync('C:\\Users\\Jellyfin\\ISPTotal\\views\\pages\\Routers.ejs', 'utf-8');

var oldStr = 'function aplicarPoolsRouter() {\n' +
'  var id = routerActualId || document.getElementById(\'idRouterInput\').value;\n' +
'  if (!id) { showToast(\'Primero guarda el router\', \'error\'); return; }\n' +
'  \n' +
'  var btn = document.getElementById(\'btnAplicarPools\');\n' +
'  btn.disabled = true;\n' +
'  btn.innerHTML = \'<i class="fas fa-spinner fa-spin"></i> Enviando...\';\n' +
'  \n' +
'  // Primero guardar pools, luego aplicar\n' +
'  guardarPoolsRouter(id).then(function() {\n' +
'    fetch(\'/api/routers/apply-pools\', {\n' +
'      method: \'POST\',\n' +
'      headers: { \'Content-Type\': \'application/json\' },\n' +
'      body: JSON.stringify({ router_id: id })\n' +
'    })';

var newStr = 'function aplicarPoolsRouter() {\n' +
'  var id = routerActualId || document.getElementById(\'idRouterInput\').value;\n' +
'  if (!id) { showToast(\'Primero guarda el router\', \'error\'); return; }\n' +
'  \n' +
'  var btn = document.getElementById(\'btnAplicarPools\');\n' +
'  btn.disabled = true;\n' +
'  btn.innerHTML = \'<i class="fas fa-spinner fa-spin"></i> Enviando...\';\n' +
'  \n' +
'  fetch(\'/api/routers/apply-pools\', {\n' +
'    method: \'POST\',\n' +
'    headers: { \'Content-Type\': \'application/json\' },\n' +
'    body: JSON.stringify({ router_id: id })\n' +
'  })';

if (content.indexOf(oldStr) >= 0) {
  content = content.replace(oldStr, newStr);
  fs.writeFileSync('C:\\Users\\Jellyfin\\ISPTotal\\views\\pages\\Routers.ejs', content, 'utf-8');
  console.log('OK - Fixed aplicarPoolsRouter');
} else {
  console.log('ERROR: bloque no encontrado');
  // Mostrar lo que hay cerca
  var idx = content.indexOf('aplicarPoolsRouter');
  if (idx >= 0) {
    console.log('Contexto:', content.substring(idx, idx + 400).replace(/\n/g, '\\n'));
  }
}

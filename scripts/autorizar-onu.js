const { queryOLT, sendConfigCommands } = require('../backend/olt-admin');

async function autorizarONU(board, port, sn, tipo, vlanId, nombre, zona, oltUpProfile, oltDownProfile) {
  console.log('=== AUTORIZAR ONU ===');
  console.log('Board:', board, 'Port:', port, 'SN:', sn, 'Tipo:', tipo, 'VLAN:', vlanId, 'Zona:', zona);
  
  // PASO 1: Obtener indice EXACTO de show gpon onu uncfg (como SmartOLT)
  console.log('\n[PASO 1] Buscando ONU', sn, 'en show gpon onu uncfg...');
  var uncfg = await queryOLT(['show gpon onu uncfg'], 20000);
  var lines = uncfg.split('\n');
  var idx = null;
  var inTable = false;
  
  lines.forEach(function(l) {
    var t = l.trim();
    if (t.indexOf('OnuIndex') >= 0) { inTable = true; return; }
    if (t.indexOf('-----') >= 0) return;
    
    // Formato: gpon-onu_1/BOARD/PORT:INDEX  SN  State
    var m = t.match(/^gpon-onu_1\/(\d+)\/(\d+):(\d+)\s+(\S+)\s+/);
    if (m && m[4] === sn) {
      idx = parseInt(m[3]);
      board = parseInt(m[1]);
      port = parseInt(m[2]);
      console.log('  Encontrada en', board + '/' + port + ':' + idx);
    }
  });
  
  if (idx === null) {
    console.log('  ❌ ONU no encontrada en show gpon onu uncfg');
    console.log('  Intentando buscar indice libre en onu state como fallback...');
    var state = await queryOLT(['terminal length 0', 'show gpon onu state'], 20000);
    var sLines = state.split('\n');
    var used = {};
    sLines.forEach(function(l) {
      var m = l.trim().match(new RegExp('^1/' + board + '/' + port + ':(\\d+)\\s+'));
      if (m) used[parseInt(m[1])] = true;
    });
    idx = 1;
    while (used[idx]) idx++;
    console.log('  Índice libre fallback: ' + idx);
  }
  
  // PASO 2: Enviar comandos de config (sendConfigCommands agrega terminal length 0 + conf t automaticamente)
  console.log('\n[PASO 2] Autorizando ONU...');
  
  var allCmds = [];
  allCmds.push('interface gpon-olt_1/' + board + '/' + port);
  allCmds.push('onu ' + idx + ' type ' + tipo + ' sn ' + sn);
  allCmds.push('exit');
  
  if (vlanId) {
    var zonaStr = (zona || 'General').substring(0, 15);
    var fecha = new Date().toISOString().substring(0,10).replace(/-/g,'');
    oltUpProfile = oltUpProfile || 'SMARTOLT-1G-UP';
    oltDownProfile = oltDownProfile || 'SMARTOLT-1G-DOWN';
    allCmds.push('interface gpon-onu_1/' + board + '/' + port + ':' + idx);
    allCmds.push('name ' + (nombre || sn).substring(0, 25));
    allCmds.push('description zone_' + zonaStr + '_authd_' + fecha);
    allCmds.push('tcont 1 profile ' + oltUpProfile);
    allCmds.push('gemport 1 tcont 1');
    allCmds.push('gemport 1 traffic-limit downstream ' + oltDownProfile);
    allCmds.push('service-port 1 vport 1 user-vlan ' + vlanId + ' vlan ' + vlanId);
    allCmds.push('!');
    allCmds.push('pon-onu-mng gpon-onu_1/' + board + '/' + port + ':' + idx);
    allCmds.push('flow 1 switch switch_0/1');
    allCmds.push('gemport 1 flow 1');
    allCmds.push('flow mode 1 tag-filter vlan-filter untag-filter discard');
    allCmds.push('flow 1 pri 0 vlan ' + vlanId);
    allCmds.push('switchport-bind switch_0/1 veip 1');
    allCmds.push('switchport-bind switch_0/1 iphost 1');
    allCmds.push('vlan-filter-mode iphost 1 tag-filter vlan-filter untag-filter discard');
  }
  
  var r = await sendConfigCommands(allCmds);
  var output = r.output || '';
  
  // Parsear indice libre del output del show gpon onu state
  var statePart = output.split('\n');
  var used = {};
  statePart.forEach(function(l) {
    var m = l.trim().match(new RegExp('^1/' + board + '/' + port + ':(\\d+)\\s+'));
    if (m) used[parseInt(m[1])] = true;
  });
  var idxReal = 1;
  while (used[idxReal]) idxReal++;
  
  // Verificar errores (despues de conf t, ignorando login)
  var configPart = output;
  var idxConfT = output.indexOf('conf t\r\n');
  if (idxConfT >= 0) configPart = output.substring(idxConfT + 8);
  var idxEnd = configPart.indexOf('ZXAN#');
  if (idxEnd >= 0) configPart = configPart.substring(0, idxEnd);
  
  var hasError20202 = configPart.match(/%Error 2020[2-9]/);
  var hasSuccessful = output.indexOf('[Successful]') >= 0;
  var hasCode63869 = output.indexOf('%Code 63869') >= 0;
  
  if (hasError20202 && !hasSuccessful && !hasCode63869) {
    console.log('  ❌ ERROR: ' + hasError20202[0]);
    return false;
  }
  
  console.log('  ✅ ONU autorizada y configurada (indice: ' + idxReal + ')');
  return { board: board, port: port, index: idxReal, sn: sn };
}

if (require.main === module) {
  var args = {
    board: parseInt(process.argv[2]) || 2,
    port: parseInt(process.argv[3]) || 16,
    sn: process.argv[4] || 'AABBCCDDEEFF',
    tipo: process.argv[5] || 'HS8545M5',
    vlan: parseInt(process.argv[6]) || 28,
    nombre: process.argv[7] || 'Test ONU'
  };
  autorizarONU(args.board, args.port, args.sn, args.tipo, args.vlan, args.nombre)
    .then(function(r) { console.log('Resultado:', JSON.stringify(r)); process.exit(0); })
    .catch(function(e) { console.error('FATAL:', e.message); process.exit(1); });
}

module.exports = { autorizarONU };
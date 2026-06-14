const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'backend', 'server.js');
let content = fs.readFileSync(filePath, 'utf-8');

const oldFunc = `app.post("/api/routers/generate-vpn-script", requireAuth, async (req, res) => {
  const { name, router_id, ip_fija } = req.body;
  if (!name) return res.json({ success: false, error: 'Nombre del router requerido' });
  try {
    const vpnUser = router_id || ('rtr-' + generarIdUnico());
    const vpnPass = generarIdUnico() + '-' + generarIdUnico();
    const vpnIP = ip_fija || '10.50.' + (Math.floor(Math.random() * 255) + 1) + '.' + (Math.floor(Math.random() * 254) + 2);
    var scr = '# ============================================\\n';
    scr += '# Script de conexion VPN - ' + name + '\\n';
    scr += '# Generado: ' + new Date().toISOString() + '\\n';
    scr += '# ============================================\\n\\n';
    scr += '# 1. Perfil PPP\\n';
    scr += '/ppp profile remove [find where name~"tusistema-profile"]\\n';
    scr += '/ppp profile add name=tusistema-profile use-encryption=yes\\n\\n';
    scr += '# 2. Interfaz SSTP cliente\\n';
    scr += '/interface sstp-client remove [find where comment~"tusistema"]\\n';
    scr += '/interface sstp-client add comment="tusistema VPN" connect-to=38.159.230.88 name="tusistemaVPN" user="' + vpnUser + '" password="' + vpnPass + '" profile=tusistema-profile disabled=no add-default-route=no\\n\\n';
    scr += '# 3. Ruta al pool de management\\n';
    scr += '/ip route remove [find where dst-address=10.50.0.0/16]\\n';
    scr += '/ip route add distance=1 dst-address=10.50.0.0/16 gateway=tusistemaVPN\\n\\n';
    scr += '# 4. Usuario local para API\\n';
    scr += '/user remove [find where name~"tusistema-api"]\\n';
    scr += '/user group remove [find where name~"tusistema"]\\n';
    scr += '/user group add name=tusistema policy="local, ftp, reboot, read, write, policy, test, password, sniff, api, romon, sensitive"\\n';
    scr += '/user add name="' + vpnUser + '-api" password="' + vpnPass + '" group=tusistema\\n\\n';
    scr += '# 5. API solo desde el tunel\\n';
    scr += '/ip service set api port=8728 disabled=no address=10.50.0.0/16\\n\\n';
    scr += '# 6. Scheduler reconexion diaria\\n';
    scr += '/system scheduler remove [find where comment="Reconectar SSTP tusistema"]\\n';
    scr += '/system scheduler add comment="Reconectar SSTP tusistema" interval=1d name="ReconectarSSTP" on-event="/interface set tusistemaVPN disabled=yes; :delay 4s; /interface set tusistemaVPN disabled=no; :log info \\"Reconectando SSTP\\";" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive start-date=nov/21/1970 start-time=06:21:00\\n\\n';
    scr += ':log info "Router conectado via SSTP. IP asignada: [/interface sstp-client get tusistemaVPN local-address]";\\n';
    res.json({ success: true, script: scr, vpn_user: vpnUser, vpn_password: vpnPass, vpn_ip: vpnIP });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});`;

const newFunc = `app.post("/api/routers/generate-vpn-script", requireAuth, async (req, res) => {
  const { name, router_id, ip_fija } = req.body;
  if (!name) return res.json({ success: false, error: 'Nombre del router requerido' });
  try {
    // Obtener nombre de empresa del tenant
    var empresaNombre = 'Cliente';
    try {
      if (req.session.isTenant && req.session.db_path) {
        var tenantDb = new (require('better-sqlite3'))(req.session.db_path);
        var cfg = tenantDb.prepare("SELECT value FROM configuracion WHERE key='empresa_nombre'").get();
        if (cfg && cfg.value) empresaNombre = cfg.value.trim();
        tenantDb.close();
      } else {
        var masterDb = new (require('better-sqlite3'))(path.join(__dirname, '..', 'data', 'master.db'));
        var co = masterDb.prepare('SELECT company_name FROM companies WHERE username=?').get(req.session.user.username);
        if (co && co.company_name) empresaNombre = co.company_name.trim();
        masterDb.close();
      }
    } catch(e) { console.log('[VPN-Script] Error obteniendo empresa:', e.message); }
    
    // Nombre de usuario: empresa_normalizado + sufijo
    var empNorm = empresaNombre.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'cliente';
    var sufijo = router_id || generarIdUnico();
    var vpnUser = empNorm.substring(0, 40) + '-' + sufijo;
    var vpnPass = generarIdUnico() + '-' + generarIdUnico();
    var vpnIP = ip_fija || '10.50.' + (Math.floor(Math.random() * 255) + 1) + '.' + (Math.floor(Math.random() * 254) + 2);
    
    // Crear usuario PPP en el CCR automaticamente
    try {
      const { execSync } = require('child_process');
      var ccrPass = 'F1tfdrsx132022';
      var cmd = 'sshpass -p "' + ccrPass + '" ssh -o StrictHostKeyChecking=no admin@192.168.101.1 "/ppp secret add name=' + vpnUser + ' password=' + vpnPass + ' service=sstp profile=sstp-profile-borde"';
      var sshResult = execSync(cmd, { timeout: 10000, shell: '/bin/bash' }).toString();
      console.log('[VPN-Script] Usuario creado en CCR:', vpnUser);
    } catch(e) {
      console.log('[VPN-Script] Error creando usuario en CCR:', e.message);
    }
    
    // Generar script
    var scr = '# ============================================\\n';
    scr += '# Script de conexion VPN\\n';
    scr += '# Empresa: ' + empresaNombre + '\\n';
    scr += '# Router: ' + name + '\\n';
    scr += '# Generado: ' + new Date().toISOString() + '\\n';
    scr += '# ============================================\\n\\n';
    scr += '# 1. Perfil PPP\\n';
    scr += '/ppp profile remove [find where name~"tusistema-profile"]\\n';
    scr += '/ppp profile add name=tusistema-profile use-encryption=yes\\n\\n';
    scr += '# 2. Interfaz SSTP cliente\\n';
    scr += '/interface sstp-client remove [find where comment~"tusistema"]\\n';
    scr += '/interface sstp-client add comment="tusistema VPN" connect-to=38.159.230.88 name="tusistemaVPN" user="' + vpnUser + '" password="' + vpnPass + '" profile=tusistema-profile disabled=no add-default-route=no\\n\\n';
    scr += '# 3. Ruta al pool de management\\n';
    scr += '/ip route remove [find where dst-address=10.50.0.0/16]\\n';
    scr += '/ip route add distance=1 dst-address=10.50.0.0/16 gateway=tusistemaVPN\\n\\n';
    scr += '# 4. Usuario local para API\\n';
    scr += '/user remove [find where name~"tusistema-api"]\\n';
    scr += '/user group remove [find where name~"tusistema"]\\n';
    scr += '/user group add name=tusistema policy="local, ftp, reboot, read, write, policy, test, password, sniff, api, romon, sensitive"\\n';
    scr += '/user add name="' + vpnUser + '-api" password="' + vpnPass + '" group=tusistema\\n\\n';
    scr += '# 5. API solo desde el tunel\\n';
    scr += '/ip service set api port=8728 disabled=no address=10.50.0.0/16\\n\\n';
    scr += '# 6. Scheduler reconexion diaria\\n';
    scr += '/system scheduler remove [find where comment="Reconectar SSTP tusistema"]\\n';
    scr += '/system scheduler add comment="Reconectar SSTP tusistema" interval=1d name="ReconectarSSTP" on-event="/interface set tusistemaVPN disabled=yes; :delay 4s; /interface set tusistemaVPN disabled=no; :log info \\"Reconectando SSTP\\";" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive start-date=nov/21/1970 start-time=06:21:00\\n\\n';
    scr += ':log info "Router conectado via SSTP. IP asignada: [/interface sstp-client get tusistemaVPN local-address]";\\n';
    res.json({ success: true, script: scr, vpn_user: vpnUser, vpn_password: vpnPass, vpn_ip: vpnIP, empresa: empresaNombre });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});`;

if (content.includes(oldFunc)) {
  content = content.replace(oldFunc, newFunc);
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log('✅ Función actualizada correctamente');
} else {
  console.log('❌ No se encontró la función original');
  // Debug - show the actual function start
  var idx = content.indexOf('app.post("/api/routers/generate-vpn-script"');
  if (idx >= 0) {
    console.log('Se encontró en posición', idx);
    console.log('Primeros 200 chars:', content.substring(idx, idx + 200));
  } else {
    console.log('No se encontró el texto en el archivo');
  }
}

const { NodeSSH } = require('node-ssh');
const path = require('path');

const BORDE_IP = '10.0.0.1';
const BORDE_USER = 'admin';
const BORDE_PASS = 'F1tfdrsx132022';
const SSTP_SERVER_IP = '38.159.230.88';

function generarIdUnico() {
  return Math.random().toString(36).substring(2, 8).toLowerCase();
}

function getEmpresaNombre(req) {
  try {
    if (req.session.isTenant && req.session.db_path) {
      const Database = require('better-sqlite3');
      const tdb = new Database(req.session.db_path);
      const cfg = tdb.prepare("SELECT value FROM configuracion WHERE key='empresa_nombre'").get();
      tdb.close();
      if (cfg && cfg.value) return cfg.value.trim();
    } else {
      const Database = require('better-sqlite3');
      const mdb = new Database(path.join(__dirname, '..', 'data', 'master.db'));
      const co = mdb.prepare('SELECT company_name FROM companies WHERE username=?').get(req.session.user.username);
      mdb.close();
      if (co && co.company_name) return co.company_name.trim();
    }
  } catch(e) {
    console.log('[VPN] Error empresa:', e.message);
  }
  return 'Cliente';
}

async function crearUsuarioBorde(username, password) {
  try {
    const ssh = new NodeSSH();
    await ssh.connect({
      host: BORDE_IP,
      username: BORDE_USER,
      password: BORDE_PASS,
      readyTimeout: 10000
    });
    
    const check = await ssh.execCommand('/ppp secret print where name=' + username);
    if (check.stdout.trim()) {
      console.log('[VPN] Usuario ya existe en borde:', username);
      ssh.dispose();
      return { success: true, created: false };
    }
    
    const cmd = '/ppp secret add name=' + username + ' password=' + password + ' service=sstp profile=sstp-profile-borde';
    const result = await ssh.execCommand(cmd);
    console.log('[VPN] Usuario creado en borde:', username);
    ssh.dispose();
    return { success: true, created: true };
  } catch(e) {
    console.log('[VPN] Error creando usuario en borde:', e.message);
    return { success: false, error: e.message };
  }
}

function generarScript(name, empresa, vpnUser, vpnPass, vpnIP) {
  var lines = [
    '# ============================================',
    '# Script de conexion VPN',
    '# Empresa: ' + empresa,
    '# Router: ' + name,
    '# Generado: ' + new Date().toISOString(),
    '# ============================================',
    '',
    '# 1. Perfil PPP',
    '/ppp profile remove [find where name~"tusistema-profile"]',
    '/ppp profile add name=tusistema-profile use-encryption=yes',
    '',
    '# 2. Interfaz SSTP cliente',
    '/interface sstp-client remove [find where comment~"tusistema"]',
    '/interface sstp-client add comment="tusistema VPN" connect-to=' + SSTP_SERVER_IP + ' name="tusistemaVPN" user="' + vpnUser + '" password="' + vpnPass + '" profile=tusistema-profile disabled=no add-default-route=no',
    '',
    '# 3. Ruta al pool de management',
    '/ip route remove [find where dst-address=10.50.0.0/16]',
    '/ip route add distance=1 dst-address=10.50.0.0/16 gateway=tusistemaVPN',
    '',
    '# 4. Usuario local para API',
    '/user remove [find where name~"tusistema-api"]',
    '/user group remove [find where name~"tusistema"]',
    '/user group add name=tusistema policy="local, ftp, reboot, read, write, policy, test, password, sniff, api, romon, sensitive"',
    '/user add name="' + vpnUser + '-api" password="' + vpnPass + '" group=tusistema',
    '',
    '# 5. API solo desde el tunel',
    '/ip service set api port=8728 disabled=no address=10.50.0.0/16',
    '',
    '# 6. Scheduler reconexion diaria',
    '/system scheduler remove [find where comment="Reconectar SSTP tusistema"]',
    '/system scheduler add comment="Reconectar SSTP tusistema" interval=1d name="ReconectarSSTP" on-event="/interface set tusistemaVPN disabled=yes; :delay 4s; /interface set tusistemaVPN disabled=no; :log info \\\"Reconectando SSTP\\\";" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive start-date=nov/21/1970 start-time=06:21:00',
    '',
    ':log info "Router conectado via SSTP. IP asignada: [/interface sstp-client get tusistemaVPN local-address]";'
  ];
  return lines.join('\n');
}

module.exports = function(req, res) {
  const { name, router_id, ip_fija } = req.body;
  if (!name) return res.json({ success: false, error: 'Nombre del router requerido' });
  
  try {
    const empresaNombre = getEmpresaNombre(req);
    const empNorm = empresaNombre.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'cliente';
    var sufijo = router_id;
    if (!sufijo || sufijo === 'RTR-' || sufijo === '') {
      sufijo = generarIdUnico();
    }
    const vpnUser = empNorm.substring(0, 40) + '-' + sufijo;
    const vpnPass = generarIdUnico() + '-' + generarIdUnico();
    const vpnIP = ip_fija || '10.50.' + (Math.floor(Math.random() * 255) + 1) + '.' + (Math.floor(Math.random() * 254) + 2);
    
    crearUsuarioBorde(vpnUser, vpnPass).then(function(result) {
      const script = generarScript(name, empresaNombre, vpnUser, vpnPass, vpnIP);
      
      res.json({
        success: true,
        script: script,
        vpn_user: vpnUser,
        vpn_password: vpnPass,
        vpn_ip: vpnIP,
        empresa: empresaNombre,
        borde_creado: result.created,
        borde_error: result.error || null
      });
    }).catch(function(e) {
      res.json({ success: false, error: 'Error creando usuario en borde: ' + e.message });
    });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
};

const snmp = require('net-snmp');

// Usar el SOCKS proxy para conectar a la OLT via SNMP
// SNMP usa UDP, no TCP, asi que no podemos usar SOCKS directamente.
// Necesitamos que el SNMP llegue a la OLT directamente o via el core.

// Primero, probemos SNMP directo a la OLT (si es accesible desde el servidor)
const OLT_IP = '192.168.20.80';
const COMMUNITY = '1hxydKtCif5j';

// OIDs importantes para ZTE C300
const OIDS = {
  // Sistema
  sysUptime: '1.3.6.1.2.1.1.3.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  sysDescr: '1.3.6.1.2.1.1.1.0',
  
  // Temperatura (ZTE specific)
  // Estos OIDs pueden variar segun el modelo
  gponCardTemperature: '1.3.6.1.4.1.3902.1012.3.50.11.1.1.7',
  
  // Numero de ONUs (ZTE specific)
  gponOnuTotal: '1.3.6.1.4.1.3902.1012.3.50.18.1.1.1',
  gponOnuOnline: '1.3.6.1.4.1.3902.1012.3.50.18.1.1.2',
  gponOnuOffline: '1.3.6.1.4.1.3902.1012.3.50.18.1.1.3',
  
  // Estado de ONUs
  gponOnuStatus: '1.3.6.1.4.1.3902.1012.3.50.18.1.1.5',
  
  // Potencia optica (valores tipicos)
  gponOnuRxPower: '1.3.6.1.4.1.3902.1012.3.50.20.1.1.1',
  gponOnuTxPower: '1.3.6.1.4.1.3902.1012.3.50.20.1.1.2',
};

async function snmpGet(oid) {
  return new Promise((resolve, reject) => {
    var session = snmp.createSession(OLT_IP, COMMUNITY, {
      port: 161,
      retries: 1,
      timeout: 5000,
      transport: 'udp4'
    });
    
    session.get([oid], function(error, varbinds) {
      session.close();
      if (error) {
        reject(error);
      } else {
        if (varbinds[0].value) {
          resolve(varbinds[0].value);
        } else {
          reject(new Error('No value for ' + oid));
        }
      }
    });
  });
}

(async () => {
  console.log('=== PROBANDO SNMP EN LA OLT ===\n');
  console.log('OLT IP:', OLT_IP);
  console.log('Community:', COMMUNITY);
  console.log('');
  
  // Probar conexion basica
  try {
    var name = await snmpGet(OIDS.sysName);
    console.log('✅ sysName:', name.toString());
  } catch(e) {
    console.log('❌ SysName:', e.message);
  }
  
  try {
    var uptime = await snmpGet(OIDS.sysUptime);
    console.log('✅ Uptime:', uptime);
  } catch(e) {
    console.log('❌ Uptime:', e.message);
  }
  
  try {
    var temp = await snmpGet(OIDS.gponCardTemperature);
    console.log('✅ Temperature:', temp);
  } catch(e) {
    console.log('❌ Temperature:', e.message);
  }
  
  try {
    var total = await snmpGet(OIDS.gponOnuTotal);
    console.log('✅ ONU Total:', total);
  } catch(e) {
    console.log('❌ ONU Total:', e.message);
  }
  
  try {
    var online = await snmpGet(OIDS.gponOnuOnline);
    console.log('✅ ONU Online:', online);
  } catch(e) {
    console.log('❌ ONU Online:', e.message);
  }
  
  try {
    var offline = await snmpGet(OIDS.gponOnuOffline);
    console.log('✅ ONU Offline:', offline);
  } catch(e) {
    console.log('❌ ONU Offline:', e.message);
  }
})().catch(console.error);

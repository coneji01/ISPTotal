// ZTE C300 OLT Manager - Conexión via SOCKS proxy + telnet con manejo de paginación
const net = require('net');

class ZteOLT {
  constructor(socksConfig, oltConfig) {
    this.socksHost = socksConfig.host || '2803:5a10:2:2800::2';
    this.socksPort = socksConfig.port || 1080;
    this.oltHost = (oltConfig && oltConfig.host) || '192.168.20.80';
    this.oltUser = (oltConfig && oltConfig.username) || 'zte';
    this.oltPass = (oltConfig && oltConfig.password) || 'zte';
    this.oltPort = 23;
    this.socket = null;
    this.buffer = '';
    this.ready = false;
    this._dataHandler = null;
    this._keepaliveTimer = null;
    this._lastActivity = Date.now();
  }
  
  // Iniciar keepalive para mantener la sesión telnet activa
  _startKeepalive() {
    this._stopKeepalive();
    // Enviar un enter cada 2 minutos para evitar timeout de sesión
    this._keepaliveTimer = setInterval(() => {
      if (this.socket && this.ready) {
        this.socket.write('\r\n');
        this._lastActivity = Date.now();
      } else {
        this._stopKeepalive();
      }
    }, 120000); // 2 minutos
  }
  
  _stopKeepalive() {
    if (this._keepaliveTimer) {
      clearInterval(this._keepaliveTimer);
      this._keepaliveTimer = null;
    }
  }
  
  // Verificar si la conexión sigue viva
  isConnected() {
    return this.ready && this.socket && !this.socket.destroyed;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      this.socket.setTimeout(30000);
      
      this.socket.on('connect', () => {
        var ipParts = this.oltHost.split('.').map(Number);
        var buf = Buffer.from([4, 1, (this.oltPort >> 8) & 0xff, this.oltPort & 0xff, ipParts[0], ipParts[1], ipParts[2], ipParts[3], 0]);
        this.socket.write(buf);
      });
      
      this.socket.once('data', (data) => {
        if (data.length < 2 || data[1] !== 90) {
          reject(new Error('SOCKS rejected: ' + (data[1] || 0)));
          return;
        }
        this.socket.setTimeout(0);
        this._startTelnetLogin(resolve, reject);
      });
      
      this.socket.on('error', (err) => reject(new Error('Socket: ' + err.message)));
      this.socket.on('timeout', () => { this.socket.destroy(); reject(new Error('Timeout')); });
      this.socket.connect(this.socksPort, this.socksHost);
    });
  }

  _startTelnetLogin(resolve, reject) {
    var buf = '';
    var step = 0;
    var timeout = setTimeout(() => {
      reject(new Error('Login timeout. Buffer: ' + buf.substring(0, 200)));
    }, 25000);
    
    var handler = (chunk) => {
      buf += chunk.toString();
      
      if (step === 0 && buf.toLowerCase().includes('username')) {
        step = 1; this.sendLine(this.oltUser); buf = '';
      }
      else if (step === 1 && buf.toLowerCase().includes('password')) {
        step = 2; this.sendLine(this.oltPass); buf = '';
      }
      else if (step === 2 && buf.includes('>')) {
        step = 3; this.sendLine('enable'); buf = '';
      }
      else if (step === 3 && buf.includes('#')) {
        if (!buf.includes('config')) {
          // Estamos en enable mode (ZXAN#) - listo para comandos show
          clearTimeout(timeout);
          this.socket.removeListener('data', handler);
          this.ready = true;
          this._startKeepalive();
          resolve(true);
        }
      }
      
      // Si vemos # sin >, estamos en algún prompt de comando
      if (step >= 2 && buf.includes('#') && !buf.includes('>') && buf.length > 10) {
        clearTimeout(timeout);
        this.socket.removeListener('data', handler);
        this.ready = true;
        this._startKeepalive();
        resolve(true);
      }
    };
    
    this.socket.on('data', handler);
    
    // Enviar enter después de 2s para despertar el login
    setTimeout(() => { if (step === 0) this.sendLine(''); }, 2000);
  }

  sendLine(text) { if (this.socket) this.socket.write(text + '\r\n'); }

  // Ejecutar comando manejando paginación --More--
  // Versión robusta: busca --More-- en el buffer ACUMULADO (no solo en chunk actual)
  // para manejar fragmentación TCP que parte el marcador entre paquetes.
  async exec(command, timeout = 10000) {
    if (!this.ready || !this.socket) return '';
    
    return new Promise((resolve) => {
      var output = '';
      var moreCount = 0;
      var lastMore = 0;
      var done = false;
      
      var handler = (chunk) => {
        var text = chunk.toString();
        output += text;
        
        // Buscar --More-- en el output ACUMULADO (output completo), no solo en el chunk actual.
        // La OLT ZTE C300 muestra "---- More ----", "--More--(X%)" o "--More--".
        var morePos = output.indexOf('--More--');
        if (morePos < 0) morePos = output.indexOf('---- More');
        if (morePos < 0) morePos = output.indexOf('--More');
        
        if (morePos >= 0 && !done) {
          var now = Date.now();
          if (now - lastMore > 100) {
            lastMore = now;
            moreCount++;
            if (moreCount > 100) { // límite de seguridad
              if (!done) { done = true; this.socket.removeListener('data', handler); resolve(output); }
              return;
            }
            // Remover la línea de --More-- del output para que no interfiera
            // con la detección del prompt (ZXAN#)
            var eolAfter = output.indexOf('\n', morePos);
            if (eolAfter >= 0) {
              output = output.substring(0, morePos) + output.substring(eolAfter + 1);
            } else {
              output = output.substring(0, morePos);
            }
            this.socket.write(' ');
            return;
          }
        }
        
        if (done) return;
        
        // Detectar prompt (# o > al final del output, ignorando espacios)
        // Formato típico ZTE: "ZXAN#"  o  "ZXAN>"
        var trimmed = output.trimEnd();
        if (/[#>]\s*$/.test(trimmed)) {
          // Verificar que no sea falso positivo (últimos chars no contengan "more")
          var tail = trimmed.substring(Math.max(0, trimmed.length - 20)).toLowerCase();
          if (!tail.includes('more')) {
            done = true;
            this.socket.removeListener('data', handler);
            resolve(output);
          }
        }
      };
      
      this.socket.on('data', handler);
      this.sendLine(command);
      
      setTimeout(() => {
        if (!done) {
          done = true;
          this.socket.removeListener('data', handler);
          resolve(output);
        }
      }, timeout);
    });
  }

  async disconnect() {
    try {
      this._stopKeepalive();
      if (this.socket) {
        this.sendLine('exit');
        this.sendLine('exit');
        setTimeout(() => { try { this.socket.end(); } catch(e) {} }, 500);
      }
    } catch(e) {}
    this.socket = null;
    this.ready = false;
  }

  // ======== COMANDOS ========

  // Obtener SNs de TODAS las ONUs desde el running-config de la OLT
  // ZTE C300 guarda: "gpon onu add 1/2/1 sn ZTEGDC7946D3 profile ..."
  async getOnuSnsFromConfig() {
    try {
      var out = await this.exec('show running-config | include sn', 60000);
      var snMap = {};
      out.split('\n').forEach(function(line) {
        // gpon onu add 1/2/1 sn ZTEGDC7946D3 profile 1 line-profile 1
        var m = line.match(/onu\s+add\s+(\S+)\s+sn\s+(\S{8,})/i);
        if (m) {
          var port = m[1]; // "1/2/1"
          var sn = m[2].toUpperCase().trim();
          // Construir onuId como "gpon-onu_1/2/X:Y" pero el config tiene "1/2/1" sin :Y
          snMap[sn] = sn; // key por SN
        }
      });
      if (Object.keys(snMap).length > 0) {
        console.log('[ZTE] Got ' + Object.keys(snMap).length + ' unique SNs from running-config');
      }
      return snMap;
    } catch(e) {
      console.log('[ZTE] Config SN error:', e.message.substring(0,60));
      return {};
    }
  }
  
  // Obtener SNs via detail-info en PARALELO (rápido) pero validando duplicados
  // El telnet mezcla respuestas cuando se hacen requests en paralelo,
  // Obtener INFO de ONUs working desde la OLT (detail-info SECUENCIAL)
  // Telnet es un protocolo secuencial, las respuestas paralelas se mezclan.
  // Procesamos 1 ONU a la vez pero solo las primeras N del ciclo.
  async getOnuBatchInfo(onuList, maxCount) {
    var resultMap = {};
    var working = onuList.filter(function(o) { return o.state === 'working' || o.state === 'online'; });
    var limit = Math.min(working.length, maxCount || 100);
    if (limit === 0) return resultMap;
    
    console.log('[ZTE] Getting SNs for ' + limit + '/' + working.length + ' working ONUs (sequential)...');
    
    for (var i = 0; i < limit; i++) {
      try {
        if (!working[i] || !working[i].onuId) continue;
        var out = await this.exec('show gpon onu detail-info ' + working[i].onuId, 3000);
        var det = this._parseOnuDetail(out);
        var sn = (det['Serial number'] || '').trim();
        if (sn.length >= 8 && /^[A-Z0-9]+$/i.test(sn)) {
          var isDup = false;
          Object.keys(resultMap).forEach(function(k) { if (resultMap[k].sn === sn) isDup = true; });
          if (!isDup) {
            resultMap[working[i].onuId] = {
              onuId: working[i].onuId,
              sn: sn,
              name: (det['Name'] || '').trim(),
              type: (det['Type'] || '').trim(),
              distance: (det['ONU Distance'] || '').trim(),
              duration: (det['Online Duration'] || '').trim(),
              phaseState: (det['Phase state'] || '').trim()
            };
          }
        }
      } catch(e) {}
    }
    return resultMap;
  }

  // Obtener SNs iterando por ONUs (fallback lento pero seguro)
  // Procesa en lotes para no saturar la OLT
  async getAllOnuSnsByDetail(onuList, batchSize) {
    batchSize = batchSize || 5;
    var snMap = {};
    for (var i = 0; i < onuList.length; i += batchSize) {
      var batch = onuList.slice(i, i + batchSize);
      var promises = batch.map(function(o) {
        var self = this;
        return (async function() {
          try {
            var detail = await self.getOnuDetail(o.onuId);
            if (detail && detail['Serial number'] && detail['Serial number'].length >= 8) {
              return { port: o.port || '', sn: detail['Serial number'] };
            }
          } catch(e) {}
          return null;
        })();
      }.bind(this));
      var results = await Promise.all(promises);
      results.forEach(function(r) {
        if (r && r.sn) snMap[r.port] = r.sn;
      });
    }
    return snMap;
  }

  async getConfiguredOnus() {
    var out = await this.exec('show gpon onu state', 20000);
    var onus = this._parseOnuState(out);
    
    // Si devolvió muy pocos (< 5 por puerto), algo falló con la paginación.
    // Hacer barrido por cada puerto como fallback.
    if (onus.length < 40) {
      for (var portId = 1; portId <= 8; portId++) {
        var moreOut = await this.exec('show gpon onu state 1/2/' + portId, 10000);
        var moreOnus = this._parseOnuState(moreOut);
        moreOnus.forEach(function(o) {
          if (!onus.some(function(e) { return e.onuId === o.onuId; })) {
            onus.push(o);
          }
        });
      }
    }
    
    return onus;
  }

  async getUnconfiguredOnus() {
    var out = await this.exec('show gpon onu uncfg', 10000);
    return this._parseUnregistered(out);
  }

  async getOnuDetail(onuId) {
    var out = await this.exec('show gpon onu detail-info ' + onuId, 5000);
    return this._parseOnuDetail(out);
  }

  async getOnuSignal(sn) {
    var out = await this.exec('show gpon onu optics sn ' + sn, 6000);
    return this._parseSignal(out);
  }

  // Obtener TODAS las ONUs con su SN recorriendo puertos
  async getAllOnus() {
    // Primero obtener el estado de todas las ONUs
    var stateOutput = await this.exec('show gpon onu state', 20000);
    var onus = this._parseOnuState(stateOutput);
    
    // Si hay menos de 700, intentar obtener por puerto
    // La ZTE C300 puede tener puertos 1/2/1 a 1/2/8
    if (onus.length < 50) {
      for (var portId = 1; portId <= 8; portId++) {
        var moreOut = await this.exec('show gpon onu state 1/2/' + portId, 10000);
        var moreOnus = this._parseOnuState(moreOut);
        // Agregar solo los que no tengamos ya
        moreOnus.forEach(function(o) {
          if (!onus.some(function(e) { return e.onuId === o.onuId; })) {
            onus.push(o);
          }
        });
      }
    }
    
    return onus;
  }

  // Obtener detalle de cada ONU para tener SN
  async getAllOnusWithSn() {
    var onus = await this.getAllOnus();
    var result = [];
    
    // Obtener SN de cada ONU (máximo 10 en paralelo para no saturar)
    for (var i = 0; i < onus.length; i++) {
      try {
        var detail = await this.getOnuDetail(onus[i].onuId);
        onus[i].sn = detail['Serial number'] || '';
        onus[i].name = detail['Name'] || '';
        onus[i].type = detail['Type'] || '';
        onus[i].distance = detail['ONU Distance'] || '';
        onus[i].onlineDuration = detail['Online Duration'] || '';
      } catch(e) {
        onus[i].sn = '';
      }
      result.push(onus[i]);
    }
    
    return result;
  }

  async authorizeOnu(frame, slot, port, sn, profile, lineProfile) {
    // Necesitamos entrar a config mode para autorizar
    await this.exec('config terminal', 2000);
    var cmd = 'gpon onu add ' + frame + '/' + slot + '/' + port + ' sn ' + sn + ' profile ' + profile + ' line-profile ' + lineProfile;
    var out = await this.exec(cmd, 8000);
    // Volver a enable mode
    await this.exec('exit', 1000);
    return { success: !out.toLowerCase().includes('error') && !out.toLowerCase().includes('already'), output: out || '' };
  }

  // ======== PARSERS ========

  _parseOnuState(output) {
    if (!output || output.trim().length < 10) return [];
    var results = [];
    output.split('\n').forEach(function(line) {
      // Formato: 1/2/1:1     enable       enable      working      1(GPON)
      var m = line.match(/(\d+\/\d+\/\d+):(\d+)\s+(\S+)\s+(\S+)\s+(\S+)/);
      if (m) {
        results.push({
          port: m[1],
          onuId: 'gpon-onu_' + m[1] + ':' + m[2],
          sn: '',
          name: '',
          state: m[5] || m[3],
          adminState: m[3],
          omccState: m[4],
          phaseState: m[5]
        });
      }
    });
    return results;
  }

  _parseUnregistered(output) {
    if (!output || output.trim().length < 5) return [];
    var results = [];
    output.split('\n').forEach(function(line) {
      if (line.toLowerCase().includes('invalid') || line.toLowerCase().includes('error')) return;
      // Formato: gpon-onu_1/3/3:1         HWTCDF3AD5A6        unknown
      var m = line.match(/gpon-onu_\S+\s+(\S{10,20})\s+/);
      if (m) {
        var sn = m[1].trim();
        if (sn.length >= 10 && /^[A-Z0-9]+$/.test(sn)) results.push({ sn: sn });
      }
    });
    return results;
  }

  _parseOnuDetail(output) {
    if (!output) return {};
    var result = {};
    output.split('\n').forEach(function(line) {
      var m = line.match(/^\s{2}(\S[\S\s]*?):\s+(.*)/);
      if (m) result[m[1].trim()] = m[2].trim();
    });
    return result;
  }

  _parseSignal(output) {
    if (!output) return {};
    var result = {};
    var rx = output.match(/RX\s*power:\s*([-\d.]+)/i);
    var tx = output.match(/TX\s*power:\s*([-\d.]+)/i);
    var temp = output.match(/Temperature:\s*([-\d.]+)/i);
    var volt = output.match(/Voltage:\s*([-\d.]+)/i);
    if (rx) result.rxPower = parseFloat(rx[1]);
    if (tx) result.txPower = parseFloat(tx[1]);
    if (temp) result.temperature = parseFloat(temp[1]);
    if (volt) result.voltage = parseFloat(volt[1]);
    return result;
  }

  // ======== NUEVOS COMANDOS ========

  // Buscar ONU por Serial Number
  async findOnuBySn(sn) {
    try {
      var out = await this.exec('show gpon onu by-sn ' + sn, 10000);
      // Formato: "gpon-onu_1/2/1:2"
      var m = out.match(/(gpon-onu_\S+)/);
      if (m) return { success: true, onuId: m[1].trim() };
      return { success: false, msg: 'ONU not found' };
    } catch(e) {
      return { success: false, msg: e.message };
    }
  }

  // Obtener running-config de una ONU específica
  async getOnuConfig(onuId) {
    try {
      var out = await this.exec('show running-config interface ' + onuId, 10000);
      return this._parseOnuDetail(out);
    } catch(e) {
      return {};
    }
  }

  // Rebootear ONU
  async rebootOnu(onuId) {
    try {
      await this.exec('reboot ' + onuId + ' confirm', 5000);
      return { success: true };
    } catch(e) {
      return { success: false, msg: e.message };
    }
  }

  // Obtener configuración de ONU via show onu running config
  async getOnuRunningConfig(onuId) {
    try {
      var out = await this.exec('show onu running config ' + onuId, 10000);
      return this._parseOnuDetail(out);
    } catch(e) {
      return {};
    }
  }

  // Obtener todas las ONUs con perfiles
  async getOnuProfiles() {
    try {
      var out = await this.exec('show gpon onu profile', 20000);
      var results = [];
      out.split('\n').forEach(function(line) {
        var m = line.match(/(gpon-onu_\S+)\s+(\S+)\s+(\S+)/);
        if (m) results.push({ onuId: m[1], profile: m[2], state: m[3] });
      });
      return results;
    } catch(e) {
      return [];
    }
  }

  // ======== NUEVOS COMANDOS (SmartOLT replacement) ========

  // Eliminar ONU de la OLT
  async deleteOnu(port, onuNum) {
    try {
      await this.exec('config terminal', 2000);
      await this.exec('interface gpon-olt_' + port, 2000);
      var out = await this.exec('no onu ' + onuNum, 5000);
      await this.exec('exit', 1000);
      await this.exec('exit', 1000);
      return { success: !out.toLowerCase().includes('error'), output: out };
    } catch(e) {
      return { success: false, output: e.message };
    }
  }

  // Deshabilitar ONU (shutdown)
  async disableOnu(onuId) {
    try {
      await this.exec('config terminal', 2000);
      await this.exec('interface ' + onuId, 2000);
      var out = await this.exec('shutdown', 3000);
      await this.exec('exit', 1000);
      await this.exec('exit', 1000);
      return { success: !out.toLowerCase().includes('error'), output: out };
    } catch(e) {
      return { success: false, output: e.message };
    }
  }

  // Habilitar ONU (no shutdown)
  async enableOnu(onuId) {
    try {
      await this.exec('config terminal', 2000);
      await this.exec('interface ' + onuId, 2000);
      var out = await this.exec('no shutdown', 3000);
      await this.exec('exit', 1000);
      await this.exec('exit', 1000);
      return { success: !out.toLowerCase().includes('error'), output: out };
    } catch(e) {
      return { success: false, output: e.message };
    }
  }

  // Configurar VLAN en una ONU
  async setOnuVlan(onuId, vlan, svlan) {
    try {
      await this.exec('config terminal', 2000);
      var out = await this.exec('service-port vlan ' + vlan + ' gpon-onu ' + onuId + ' gemport 1', 5000);
      await this.exec('exit', 1000);
      return { success: !out.toLowerCase().includes('error'), output: out };
    } catch(e) {
      return { success: false, output: e.message };
    }
  }

  // Renombrar ONU en la OLT
  async setOnuName(onuId, name) {
    try {
      await this.exec('config terminal', 2000);
      await this.exec('interface ' + onuId, 2000);
      var out = await this.exec('name ' + name.substring(0, 64), 3000);
      await this.exec('exit', 1000);
      await this.exec('exit', 1000);
      return { success: !out.toLowerCase().includes('error'), output: out };
    } catch(e) {
      return { success: false, output: e.message };
    }
  }

  // Obtener tipos de ONU disponibles
  async getOnuTypes() {
    try {
      var out = await this.exec('show onu-type', 10000);
      var types = [];
      out.split('\n').forEach(function(line) {
        var m = line.match(/^\s*(\S+)\s+(.+)/);
        if (m && m[1] && m[1].length > 2 && !m[1].includes('----')) {
          types.push({ name: m[1], desc: m[2].trim() });
        }
      });
      return types;
    } catch(e) {
      return [];
    }
  }

  // Obtener service-ports de una ONU
  async getOnuServicePorts(onuId) {
    try {
      var out = await this.exec('show service-port | include ' + onuId, 10000);
      return out;
    } catch(e) {
      return '';
    }
  }

  // Guardar configuración en la OLT
  async saveConfig() {
    try {
      var out = await this.exec('write memory', 5000);
      return { success: !out.toLowerCase().includes('error'), output: out };
    } catch(e) {
      return { success: false, output: e.message };
    }
  }

  // Reset de fábrica de una ONU
  async factoryResetOnu(onuId) {
    try {
      var out = await this.exec('restore factory ' + onuId, 5000);
      return { success: !out.toLowerCase().includes('error'), output: out };
    } catch(e) {
      return { success: false, output: e.message };
    }
  }
}

module.exports = ZteOLT;

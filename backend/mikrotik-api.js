// MikroTik RouterOS API Client for Node.js
// Implements the binary API protocol over TCP
const net = require('net');

class MikroTikAPI {
  constructor(host, port = 8728, options = {}) {
    this.host = host;
    this.port = port;
    this.timeout = options.timeout || 8000;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this._execResolve = null;
    this._execReject = null;
    this._sentences = [];
    this._currentSentence = [];
    this._tagCounter = 0;
    this._timeoutTimer = null;
  }

  // Encode a word length per API protocol
  _encodeLength(len) {
    if (len < 0x80) {
      return Buffer.from([len]);
    } else if (len < 0x4000) {
      const b = Buffer.alloc(2);
      b.writeUInt16BE(len | 0x8000, 0);
      return b;
    } else if (len < 0x200000) {
      const b = Buffer.alloc(3);
      b.writeUInt8((len >> 16) | 0xC0, 0);
      b.writeUInt16BE(len & 0xFFFF, 1);
      return b;
    } else if (len < 0x10000000) {
      const b = Buffer.alloc(4);
      b.writeUInt32BE(len | 0xE0000000, 0);
      return b;
    }
    const b = Buffer.alloc(5);
    b[0] = 0xF0;
    b.writeUInt32BE(len, 1);
    return b;
  }

  // Encode a word
  _encodeWord(word) {
    const wordBuf = Buffer.from(word, 'utf8');
    const lenBuf = this._encodeLength(wordBuf.length);
    return Buffer.concat([lenBuf, wordBuf]);
  }

  // Encode a sentence: [words..., zero-length word]
  _encodeSentence(words) {
    const parts = words.map(w => this._encodeWord(w));
    parts.push(Buffer.from([0x00])); // zero-length word terminates sentence
    return Buffer.concat(parts);
  }

  // Connect to Router
  connect() {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      this.socket.setTimeout(this.timeout);
      
      this.socket.on('connect', () => {
        resolve(true); // Conexión TCP establecida
        this._readLoop();
      });

      this.socket.on('data', (data) => {
        this.buffer = Buffer.concat([this.buffer, data]);
        this._tryParse();
      });

      this.socket.on('error', (err) => {
        reject(new Error('Connection failed: ' + err.message));
      });

      this.socket.on('timeout', () => {
        this.socket.destroy();
        reject(new Error('Connection timeout'));
      });

      this.socket.connect(this.port, this.host);
    });
  }

  _readLoop() {
    // Read loop placeholder
  }

  _tryParse() {
    while (this.buffer.length > 0) {
      // Read word length
      const firstByte = this.buffer[0];
      let wordLen = 0;
      let headerLen = 1;

      // Zero-length word (0x00) terminates the sentence - check BEFORE word length
      if (firstByte === 0x00) {
        this._onSentenceComplete();
        this.buffer = this.buffer.slice(1);
        continue;
      }
      
      if (firstByte < 0x80) {
        wordLen = firstByte;
      } else if (firstByte < 0xC0) {
        wordLen = ((firstByte & 0x3F) << 8) | this.buffer[1];
        headerLen = 2;
      } else if (firstByte < 0xE0) {
        wordLen = ((firstByte & 0x1F) << 16) | (this.buffer[1] << 8) | this.buffer[2];
        headerLen = 3;
      } else if (firstByte < 0xF0) {
        wordLen = ((firstByte & 0x0F) << 24) | (this.buffer[1] << 16) | (this.buffer[2] << 8) | this.buffer[3];
        headerLen = 4;
      } else if (firstByte === 0xF0) {
        wordLen = (this.buffer[1] << 24) | (this.buffer[2] << 16) | (this.buffer[3] << 8) | this.buffer[4];
        headerLen = 5;
      } else {
        // Control byte (>= 0xF8), skip it
        this.buffer = this.buffer.slice(1);
        continue;
      }

      if (this.buffer.length < headerLen + wordLen) break; // Wait for more data

      const wordBuf = this.buffer.slice(headerLen, headerLen + wordLen);
      this._currentSentence.push(wordBuf.toString('utf8'));
      this.buffer = this.buffer.slice(headerLen + wordLen);
    }
  }

  _onSentenceComplete() {
    if (this._currentSentence.length === 0) return;
    const sentence = this._currentSentence;
    this._currentSentence = [];
    this._sentences.push(sentence);
    
    // Check if this is a terminal reply
    const isDone = sentence[0] === '!done';
    const isTrap = sentence[0] === '!trap';
    
    if ((isDone || isTrap) && this._execResolve) {
      if (this._timeoutTimer) { clearTimeout(this._timeoutTimer); this._timeoutTimer = null; }
      this._execResolve(this._sentences);
      this._sentences = [];
      this._execResolve = null;
      this._execReject = null;
    }
  }

  // Send a command and wait for response
  async exec(...args) {
    if (!this.socket || !this.socket.writable) {
      throw new Error('Not connected to Router');
    }

    var self = this;
    return new Promise(function(resolve, reject) {
      self._execResolve = resolve;
      self._execReject = reject;
      self._sentences = [];

      // Set timeout for this command
      if (self._timeoutTimer) clearTimeout(self._timeoutTimer);
      self._timeoutTimer = setTimeout(function() {
        self._execReject = null;
        reject(new Error('Command timeout after ' + self.timeout + 'ms'));
      }, self.timeout);

      const command = args[0].startsWith('/') ? args[0] : '/' + args[0];
      const words = [command].concat(args.slice(1));
      const data = self._encodeSentence(words);
      self.socket.write(data);
    });
  }

  // Login
  async login(username, password) {
    const crypto = require('crypto');
    // Try new method first (direct password)
    const result = await this.exec('/login', '=name=' + username, '=password=' + password);
    
    // Check if challenge was requested
    const firstSentence = result[0];
    if (firstSentence && firstSentence.some(w => w.startsWith('=ret='))) {
      const ret = firstSentence.find(w => w.startsWith('=ret='));
      const challenge = ret.split('=')[2];
      const chalBytes = Buffer.from(challenge, 'hex');
      
      // MD5(0x00 + password + challenge_bytes)
      const md5 = crypto.createHash('md5');
      md5.update(Buffer.from([0x00]));
      md5.update(Buffer.from(password, 'utf8'));
      md5.update(chalBytes);
      const hash = md5.digest('hex');
      
      await this.exec('/login', '=name=' + username, '=response=00' + hash);
    }
    return true;
  }

  // Convenience: print command
  async print(path, query = null, proplist = null) {
    const args = [path + '/print'];
    if (query) args.push(query);
    if (proplist) args.push('.proplist=' + proplist);
    return this.exec(...args);
  }

  // Convenience: get all
  async getAll(path) {
    return this.exec(path + '/getall');
  }

  // Disconnect
  disconnect() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  // Test connection
  static async testConnection(host, port, username, password) {
    const api = new MikroTikAPI(host, port);
    try {
      await api.connect();
      await api.login(username, password);
      const result = await api.exec('/system/resource/print');
      api.disconnect();
      
      // Parse resource info
      const info = {};
      for (const sentence of result) {
        for (const word of sentence) {
          if (word.startsWith('=')) {
            const eq = word.indexOf('=', 1);
            if (eq > 0) {
              info[word.substring(1, eq)] = word.substring(eq + 1);
            }
          }
        }
      }
      return { success: true, info };
    } catch (err) {
      if (api) api.disconnect();
      return { success: false, error: err.message };
    }
  }

  // Get interfaces
  static async getInterfaces(host, port, username, password) {
    const api = new MikroTikAPI(host, port);
    try {
      await api.connect();
      await api.login(username, password);
      const result = await api.exec('/interface/print');
      api.disconnect();
      
      const interfaces = [];
      for (const sentence of result) {
        if (sentence[0] === '!re') {
          const iface = {};
          for (const word of sentence) {
            if (word.startsWith('=')) {
              const eq = word.indexOf('=', 1);
              if (eq > 0) iface[word.substring(1, eq)] = word.substring(eq + 1);
            }
          }
          interfaces.push(iface);
        }
      }
      // Filter physical interfaces only (ether, sfp, sfp-plus)
      const physicalInterfaces = interfaces.filter(function(iface) {
        var type = iface.type || '';
        return type === 'ether' || type === 'sfp' || type === 'sfp-plus';
      });
      return { success: true, interfaces: physicalInterfaces };
    } catch (err) {
      if (api) api.disconnect();
      return { success: false, error: err.message };
    }
  }

  // Get DHCP pools from router
  static async getPools(host, port, username, password) {
    const api = new MikroTikAPI(host, port);
    try {
      await api.connect();
      await api.login(username, password);
      const result = await api.exec('/ip/pool/print');
      api.disconnect();
      
      const pools = [];
      for (const sentence of result) {
        if (sentence[0] === '!re') {
          const pool = {};
          for (const word of sentence) {
            if (word.startsWith('=')) {
              const eq = word.indexOf('=', 1);
              if (eq > 0) pool[word.substring(1, eq)] = word.substring(eq + 1);
            }
          }
          pools.push(pool);
        }
      }
      return { success: true, pools };
    } catch (err) {
      if (api) api.disconnect();
      return { success: false, error: err.message };
    }
  }

  // Get DHCP Leases
  static async getDHCPLeases(host, port, username, password) {
    const api = new MikroTikAPI(host, port);
    try {
      await api.connect();
      await api.login(username, password);
      const result = await api.exec('/ip/dhcp-server/lease/print');
      api.disconnect();
      
      const leases = [];
      for (const sentence of result) {
        if (sentence[0] === '!re') {
          const lease = {};
          for (const word of sentence) {
            if (word.startsWith('=')) {
              const eq = word.indexOf('=', 1);
              if (eq > 0) lease[word.substring(1, eq)] = word.substring(eq + 1);
            }
          }
          leases.push(lease);
        }
      }
      return { success: true, leases };
    } catch (err) {
      if (api) api.disconnect();
      return { success: false, error: err.message };
    }
  }

  // Add DHCP lease (IPoE client)
  static async addDHCPLease(host, port, username, password, params) {
    const api = new MikroTikAPI(host, port);
    try {
      await api.connect();
      await api.login(username, password);
      
      const words = ['/ip/dhcp-server/lease/add'];
      if (params.address) words.push('=address=' + params.address);
      if (params['mac-address']) words.push('=mac-address=' + params['mac-address']);
      if (params.comment) words.push('=comment=' + params.comment);
      if (params.server) words.push('=server=' + params.server);
      // Always reserve the lease
      words.push('=always-broadcast=no');
      
      const result = await api.exec(...words);
      api.disconnect();
      
      // Check for success
      for (const sentence of result) {
        if (sentence[0] === '!trap') {
          const msg = sentence.find(w => w.startsWith('=message='));
          return { success: false, error: msg ? msg.split('=', 3).slice(2).join('=') : 'Error al agregar lease DHCP' };
        }
      }
      
      return { success: true, message: 'Lease DHCP agregado' };
    } catch (err) {
      if (api) api.disconnect();
      return { success: false, error: err.message };
    }
  }

  // Remove DHCP lease
  static async removeDHCPLease(host, port, username, password, macAddress) {
    const api = new MikroTikAPI(host, port);
    try {
      await api.connect();
      await api.login(username, password);
      
      // Find lease by MAC first
      const searchResult = await api.exec('/ip/dhcp-server/lease/print', '?mac-address=' + macAddress);
      let leaseId = null;
      for (const sentence of searchResult) {
        if (sentence[0] === '!re') {
          for (const word of sentence) {
            if (word.startsWith('=.id=')) {
              leaseId = word.split('=')[2];
              break;
            }
          }
        }
      }
      
      if (!leaseId) {
        api.disconnect();
        return { success: false, error: 'Lease no encontrado' };
      }
      
      // Remove the lease
      await api.exec('/ip/dhcp-server/lease/remove', '=.id=' + leaseId);
      api.disconnect();
      return { success: true, message: 'Lease DHCP eliminado' };
    } catch (err) {
      if (api) api.disconnect();
      return { success: false, error: err.message };
    }
  }

  // Suspend/disable DHCP lease (disable, don't remove)
  static async setDHCPLeaseDisabled(host, port, username, password, macAddress, disabled) {
    const api = new MikroTikAPI(host, port);
    try {
      await api.connect();
      await api.login(username, password);
      
      // Find lease by MAC
      const searchResult = await api.exec('/ip/dhcp-server/lease/print', '?mac-address=' + macAddress);
      let leaseId = null;
      for (const sentence of searchResult) {
        if (sentence[0] === '!re') {
          for (const word of sentence) {
            if (word.startsWith('=.id=')) {
              leaseId = word.split('=')[2];
              break;
            }
          }
        }
      }
      
      if (!leaseId) {
        api.disconnect();
        return { success: false, error: 'Lease no encontrado' };
      }
      
      await api.exec('/ip/dhcp-server/lease/set', '=.id=' + leaseId, '=disabled=' + (disabled ? 'yes' : 'no'));
      api.disconnect();
      return { success: true, message: disabled ? 'Cliente suspendido' : 'Cliente activado' };
    } catch (err) {
      if (api) api.disconnect();
      return { success: false, error: err.message };
    }
  }

  // Get PPP profiles from router (for PPPoE)
  static async getPPPProfiles(host, port, username, password) {
    const api = new MikroTikAPI(host, port);
    try {
      await api.connect();
      await api.login(username, password);
      const result = await api.exec('/ppp/profile/print');
      api.disconnect();
      const profiles = [];
      for (const sentence of result) {
        if (sentence[0] === '!re') {
          const profile = {};
          for (const word of sentence) {
            if (word.startsWith('=')) {
              const eq = word.indexOf('=', 1);
              if (eq > 0) profile[word.substring(1, eq)] = word.substring(eq + 1);
            }
          }
          profiles.push(profile);
        }
      }
      return { success: true, profiles };
    } catch (err) {
      if (api) api.disconnect();
      return { success: false, error: err.message };
    }
  }

  // Add PPPoE secret to router
  static async addPPPSecret(host, port, username, password, params) {
    const api = new MikroTikAPI(host, port);
    try {
      await api.connect();
      await api.login(username, password);
      
      const words = ['/ppp/secret/add'];
      if (params.name) words.push('=name=' + params.name);
      if (params.password) words.push('=password=' + params.password);
      if (params.profile) words.push('=profile=' + params.profile);
      if (params.service) words.push('=service=' + params.service);
      if (params['remote-address']) words.push('=remote-address=' + params['remote-address']);
      if (params.comment) words.push('=comment=' + params.comment);
      
      const result = await api.exec(...words);
      api.disconnect();
      
      for (const sentence of result) {
        if (sentence[0] === '!trap') {
          const msg = sentence.find(w => w.startsWith('=message='));
          return { success: false, error: msg ? msg.split('=', 3).slice(2).join('=') : 'Error al crear secreto PPP' };
        }
      }
      
      return { success: true, message: 'Secreto PPP agregado' };
    } catch (err) {
      if (api) api.disconnect();
      return { success: false, error: err.message };
    }
  }

  // Remove PPPoE secret by name
  static async removePPPSecret(host, port, username, password, secretName) {
    if (!secretName) return { success: false, error: 'Nombre del secreto requerido' };
    const api = new MikroTikAPI(host, port);
    try {
      await api.connect();
      await api.login(username, password);
      
      // Find the secret first
      const findResult = await api.exec('/ppp/secret/print', '?name=' + secretName);
      var secretId = null;
      for (const sentence of findResult) {
        if (sentence[0] === '!re') {
          for (const word of sentence) {
            if (word.startsWith('=.id=')) {
              secretId = word.split('=')[2];
              break;
            }
          }
        }
      }
      
      if (!secretId) {
        api.disconnect();
        return { success: true, message: 'Secreto no encontrado (ya fue eliminado)' };
      }
      
      // Remove the secret
      await api.exec('/ppp/secret/remove', '=.id=' + secretName);
      api.disconnect();
      return { success: true, message: 'Secreto PPP eliminado' };
    } catch (err) {
      if (api) api.disconnect();
      return { success: false, error: err.message };
    }
  }

  // Get available (unused) IP from a pool or IP range
  static async getAvailableIP(host, port, username, password, poolName) {
    const api = new MikroTikAPI(host, port);
    try {
      await api.connect();
      await api.login(username, password);
      
      // Get all used IPs from leases
      const leasesResult = await api.exec('/ip/dhcp-server/lease/print', '.proplist=address');
      const usedIPs = new Set();
      for (const sentence of leasesResult) {
        if (sentence[0] === '!re') {
          for (const word of sentence) {
            if (word.startsWith('=address=')) {
              usedIPs.add(word.split('=')[2]);
            }
          }
        }
      }
      
      // Get pool info to find the range
      if (poolName) {
        const poolResult = await api.exec('/ip/pool/print', '?name=' + poolName);
        let poolRange = '';
        for (const sentence of poolResult) {
          if (sentence[0] === '!re') {
            for (const word of sentence) {
              if (word.startsWith('=ranges=')) {
                poolRange = word.split('=').slice(2).join('=');
              }
            }
          }
        }
        
        // Parse the range (e.g., "192.168.1.2-192.168.1.254")
        if (poolRange) {
          const parts = poolRange.split('-');
          if (parts.length >= 2) {
            const startIP = parts[0].trim();
            const endIP = parts[parts.length - 1].trim();
            
            const startParts = startIP.split('.').map(Number);
            const endParts = endIP.split('.').map(Number);
            
            // Try to find the first unused IP in the range
            for (let a = startParts[0]; a <= endParts[0]; a++) {
              for (let b = (a === startParts[0] ? startParts[1] : 0); b <= (a === endParts[0] ? endParts[1] : 255); b++) {
                for (let c = (a === startParts[0] && b === startParts[1] ? startParts[2] : 0); c <= (a === endParts[0] && b === endParts[1] ? endParts[2] : 255); c++) {
                  for (let d = (a === startParts[0] && b === startParts[1] && c === startParts[2] ? startParts[3] : 1); d <= (a === endParts[0] && b === endParts[1] && c === endParts[2] ? endParts[3] : 254); d++) {
                    const ip = a + '.' + b + '.' + c + '.' + d;
                    if (!usedIPs.has(ip)) {
                      api.disconnect();
                      return { success: true, ip: ip };
                    }
                  }
                }
              }
            }
          }
        }
      }
      
      api.disconnect();
      return { success: false, error: 'No hay IPs disponibles en el pool' };
    } catch (err) {
      if (api) api.disconnect();
      return { success: false, error: err.message };
    }
  }

  // Get WAN interface traffic (bps in/out)
  static async getTraffic(host, port, username, password, interfaceName) {
    const api = new MikroTikAPI(host, port);
    try {
      await api.connect();
      await api.login(username, password);
      const result = await api.exec('/interface/monitor-traffic', '=interface=' + (interfaceName || 'ether1'), '=once=');
      api.disconnect();

      let bps_in = 0, bps_out = 0;
      for (const sentence of result) {
        if (sentence[0] === '!re') {
          for (const word of sentence) {
            if (word.startsWith('=rx-bits-per-second=')) {
              bps_in = parseFloat(word.split('=')[2]) || 0;
            } else if (word.startsWith('=tx-bits-per-second=')) {
              bps_out = parseFloat(word.split('=')[2]) || 0;
            }
          }
        }
      }
      return { success: true, bps_in, bps_out };
    } catch (err) {
      if (api) api.disconnect();
      return { success: false, message: err.message };
    }
  }

  // Add or remove IP from address list
  static async setAddressList(host, port, username, password, ipAddress, listName, add) {
    const api = new MikroTikAPI(host, port);
    try {
      await api.connect();
      await api.login(username, password);
      
      if (add) {
        // Check if already exists
        const searchResult = await api.exec('/ip/firewall/address-list/print', '?address=' + ipAddress, '?list=' + listName);
        var found = false;
        for (var s of searchResult) {
          if (s[0] === '!re') {
            for (var w of s) {
              if (w === '=address=' + ipAddress || w.startsWith('=address=' + ipAddress)) {
                found = true;
                break;
              }
            }
          }
          if (found) break;
        }
        
        if (!found) {
          await api.exec('/ip/firewall/address-list/add', '=address=' + ipAddress, '=list=' + listName, '=comment=ISP_Total');
        }
      } else {
        // Remove from list
        const searchResult = await api.exec('/ip/firewall/address-list/print', '?address=' + ipAddress, '?list=' + listName);
        for (var s of searchResult) {
          if (s[0] === '!re') {
            var id = null;
            for (var w of s) {
              if (w.startsWith('=.id=')) {
                id = w.substring(5);
                break;
              }
            }
            if (id) {
              await api.exec('/ip/firewall/address-list/remove', '=.id=' + id);
            }
          }
        }
      }
      
      api.disconnect();
      return { success: true };
    } catch (err) {
      if (api) api.disconnect();
      return { success: false, message: err.message };
    }
  }
}

module.exports = MikroTikAPI;

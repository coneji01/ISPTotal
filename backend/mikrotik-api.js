// MikroTik RouterOS API Client for Node.js
// Implements the binary API protocol over TCP
const net = require('net');

class MikroTikAPI {
  constructor(host, port = 8728, options = {}) {
    this.host = host;
    this.port = port;
    this.timeout = options.timeout || 5000;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this._resolve = null;
    this._reject = null;
    this._sentences = [];
    this._currentSentence = [];
    this._tagCounter = 0;
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
    parts.push(Buffer.from([0xC0, 0x00])); // zero-length word (0x4000 -> 0xC000 in 2-byte encoding)
    return Buffer.concat(parts);
  }

  // Connect to Router
  connect() {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      this.socket.setTimeout(this.timeout);
      
      this.socket.on('connect', () => {
        this._resolve = resolve;
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
        // Zero-length word or control byte
        if (firstByte === 0x00) {
          this._onSentenceComplete();
          this.buffer = this.buffer.slice(1);
          continue;
        }
        // Try to handle 0xC0 0x00 pattern (2-byte zero-length)
        if (firstByte === 0xC0 && this.buffer[1] === 0x00) {
          this._onSentenceComplete();
          this.buffer = this.buffer.slice(2);
          continue;
        }
        // Unknown control byte
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
    
    if (sentence[0] === '!done' && this._resolve) {
      this._resolve(this._sentences);
      this._sentences = [];
      this._resolve = null;
    }
  }

  // Send a command and wait for response
  async exec(...args) {
    if (!this.socket || !this.socket.writable) {
      throw new Error('Not connected to Router');
    }

    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
      this._sentences = [];

      const command = args[0].startsWith('/') ? args[0] : '/' + args[0];
      const words = [command, ...args.slice(1)];
      const data = this._encodeSentence(words);
      this.socket.write(data);
    });
  }

  // Login
  async login(username, password) {
    await this.exec('/login', '=name=' + username, '=password=' + password);
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
      return { success: true, interfaces };
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
}

module.exports = MikroTikAPI;

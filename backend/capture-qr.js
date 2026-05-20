#!/usr/bin/env node
/**
 * Captura el QR de OpenWa desde Chromium y lo guarda como imagen.
 */
const CDP_URL = 'http://127.0.0.1';
const OUT = '/home/jellyfin/.openclaw/workspace/isptotal/qr-capture.png';

async function main() {
  // Find the OpenWa Chromium debugging port
  const { execSync } = require('child_process');
  const ss = execSync('ss -tlnp 2>/dev/null | grep chrome | grep -v "2462548"', {timeout:5000}).toString();
  const match = ss.match(/:(\d+)/);
  if (!match) { console.log('QR_PORT_NOT_FOUND'); process.exit(0); }
  const port = match[1];
  
  // Get page info via CDP
  const http = require('http');
  const data = await new Promise((resolve, reject) => {
    http.get(`${CDP_URL}:${port}/json`, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
  
  const targets = JSON.parse(data);
  const page = targets.find(t => t.type === 'page' && t.url.includes('whatsapp'));
  if (!page) { console.log('QR_PAGE_NOT_FOUND'); process.exit(0); }
  
  // Connect via WebSocket and capture screenshot
  const WebSocket = require('ws');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  
  const send = (msg) => new Promise((resolve, reject) => {
    ws.send(JSON.stringify(msg));
    ws.once('message', data => {
      try { resolve(JSON.parse(data.toString())); } catch(e) { reject(e); }
    });
  });
  
  ws.on('open', async () => {
    // Enable Page domain
    // Take screenshot
    const result = await new Promise((resolve, reject) => {
      ws.send(JSON.stringify({id: 1, method: 'Page.captureScreenshot', params: {format: 'png'}}));
      ws.once('message', data => {
        try {
          const resp = JSON.parse(data.toString());
          if (resp.result && resp.result.data) resolve(resp.result.data);
          else reject(new Error('No data'));
        } catch(e) { reject(e); }
      });
    });
    
    require('fs').writeFileSync(OUT, Buffer.from(result, 'base64'));
    console.log('QR_CAPTURED:' + OUT);
    ws.close();
    process.exit(0);
  });
}

main().catch(e => { console.log('QR_ERROR:' + e.message); process.exit(0); });

const puppeteer = require('puppeteer');
const fs = require('fs');
(async () => {
  const browser = await puppeteer.launch({headless: 'new'});
  const page = await browser.newPage();
  const errors = [];
  const responses = [];
  
  page.on('console', msg => errors.push({type: msg.type(), text: msg.text()}));
  page.on('pageerror', err => errors.push({type: 'pageerror', text: err.message}));
  page.on('response', resp => {
    if (resp.url().includes('/api/')) {
      responses.push({url: resp.url(), status: resp.status()});
    }
  });
  
  // Login
  await page.goto('http://10.0.0.2:3020/', {waitUntil: 'networkidle2', timeout: 30000});
  await page.type('input[name="username"]', 'admin');
  await page.type('input[name="password"]', 'admin');
  await Promise.all([
    page.waitForNavigation({waitUntil: 'networkidle2', timeout: 30000}),
    page.click('button[type="submit"]')
  ]);
  
  // Go to OLT details with id=4
  await page.goto('http://10.0.0.2:3020/modulo?pagina=smartolt_olt_details&olt_id=4', {waitUntil: 'networkidle2', timeout: 60000});
  await new Promise(r => setTimeout(r, 10000));
  
  const vals = await page.evaluate(() => {
    return {
      uptime: document.getElementById('olt-uptime')?.textContent,
      sidebarUptime: document.getElementById('olt-up-time-sidebar')?.textContent,
      name: document.getElementById('olt-name')?.textContent,
      model: document.getElementById('olt-model')?.textContent,
      ip: document.getElementById('olt-ip')?.textContent,
      version: document.getElementById('olt-version')?.textContent,
      online: document.getElementById('kpi-online')?.textContent,
      offline: document.getElementById('kpi-offline')?.textContent,
      waiting: document.getElementById('kpi-waiting')?.textContent,
      lowSignal: document.getElementById('kpi-low-signal')?.textContent,
      loadingDisplay: document.getElementById('olt-loading')?.style?.display,
      tableDisplay: document.getElementById('olt-details-table')?.style?.display
    };
  });
  
  console.log('=== ELEMENTOS DOM ===');
  console.log(JSON.stringify(vals, null, 2));
  
  console.log('\n=== API RESPONSES ===');
  responses.forEach(r => console.log(r.status + ' ' + r.url));
  
  console.log('\n=== CONSOLE ERRORS ===');
  errors.filter(e => e.type === 'error').forEach(e => console.log(e.text));
  
  await browser.close();
})();

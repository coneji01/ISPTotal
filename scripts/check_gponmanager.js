const puppeteer = require('puppeteer');
const fs = require('fs');
(async () => {
  const browser = await puppeteer.launch({headless: 'new'});
  const page = await browser.newPage();
  
  // Login primero
  await page.goto('http://10.0.0.2:3020/', {waitUntil: 'networkidle2', timeout: 30000});
  await page.type('input[name="username"]', 'admin');
  await page.type('input[name="password"]', 'admin');
  await Promise.all([
    page.waitForNavigation({waitUntil: 'networkidle2', timeout: 30000}),
    page.click('button[type="submit"]')
  ]);
  
  await page.goto('http://10.0.0.2:3020/modulo?pagina=GPONManager', {waitUntil: 'networkidle2', timeout: 60000});
  await new Promise(r => setTimeout(r, 12000)); // esperar a que carguen datos OLT
  
  // Capturar errores de consola
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  
  // Información del DOM
  const info = await page.evaluate(() => {
    const data = {};
    const el = id => document.getElementById(id);
    
    // OLT dashboard metrics
    data.onlineTotal = el('onu-online')?.textContent || el('online-count')?.textContent || '-';
    data.offline = el('onu-offline')?.textContent || el('offline-count')?.textContent || '-';
    data.unconfigured = el('onu-unauth')?.textContent || el('unconfigured-count')?.textContent || '-';
    data.uptime = el('olt-uptime')?.textContent || '-';
    data.temperature = el('olt-temp')?.textContent || '-';
    
    // Buscar cualquier elemento con KPIs
    document.querySelectorAll('[class*="kpi"], [class*="stat"], [class*="metric"]').forEach(e => {
      data[e.id || e.className] = e.textContent?.trim();
    });
    
    // Capturar texto completo de la página
    data.pageText = document.body?.innerText?.substring(0, 3000);
    
    return data;
  });
  
  console.log('=== GPONManager STATUS ===');
  console.log(JSON.stringify(info, null, 2));
  
  // Errores de API
  const apiLogs = await page.evaluate(() => {
    const entries = performance.getEntriesByType('resource');
    return entries.filter(e => e.name.includes('/api/')).map(e => ({url: e.name, status: e.responseStatus, duration: Math.round(e.duration)}));
  });
  console.log('\n=== API CALLS ===');
  console.log(JSON.stringify(apiLogs, null, 2));
  
  await browser.close();
})();

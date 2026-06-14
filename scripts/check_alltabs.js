const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({headless: 'new'});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  
  await page.goto('http://10.0.0.2:3020/', {waitUntil: 'networkidle2', timeout: 30000});
  await page.type('input[name="username"]', 'admin');
  await page.type('input[name="password"]', 'admin');
  await Promise.all([
    page.waitForNavigation({waitUntil: 'networkidle2', timeout: 30000}),
    page.click('button[type="submit"]')
  ]);
  
  const results = {};
  
  // Test CARDS tab
  await page.goto('http://10.0.0.2:3020/modulo?pagina=smartolt_olt_details&olt_id=5#cards', {waitUntil: 'networkidle2', timeout: 60000});
  await new Promise(r => setTimeout(r, 12000));
  results.cards = await page.evaluate(() => {
    var el = document.getElementById('general_boards_info');
    return { active: document.querySelector('.tab-pane.active')?.id, rows: el?.querySelectorAll('tr')?.length, headers: Array.from(el?.querySelectorAll('th') || []).map(function(t){return t.textContent.trim();}) };
  });
  
  // Test UPLINK tab
  await page.goto('http://10.0.0.2:3020/modulo?pagina=smartolt_olt_details&olt_id=5#uplink_ports', {waitUntil: 'networkidle2', timeout: 60000});
  await new Promise(r => setTimeout(r, 8000));
  results.uplink = await page.evaluate(() => {
    var el = document.getElementById('uplink_ports');
    return { active: document.querySelector('.tab-pane.active')?.id, headers: Array.from(el?.querySelectorAll('th') || []).map(function(t){return t.textContent.trim();}), rows: el?.querySelectorAll('tr')?.length };
  });
  
  // Test VLANs tab
  await page.goto('http://10.0.0.2:3020/modulo?pagina=smartolt_olt_details&olt_id=5#vlans', {waitUntil: 'networkidle2', timeout: 60000});
  await new Promise(r => setTimeout(r, 12000));
  results.vlans = await page.evaluate(() => {
    var el = document.getElementById('vlans');
    return { active: document.querySelector('.tab-pane.active')?.id, headers: Array.from(el?.querySelectorAll('th') || []).map(function(t){return t.textContent.trim();}), rows: el?.querySelectorAll('tr')?.length };
  });
  
  console.log(JSON.stringify(results, null, 2));
  console.log('\n=== ERRORS ===');
  errors.forEach(function(e) { console.log(e); });
  if (errors.length === 0) console.log('None!');
  
  await browser.close();
})();

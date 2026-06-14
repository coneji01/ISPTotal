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
  
  // Test PON ports tab
  await page.goto('http://10.0.0.2:3020/modulo?pagina=smartolt_olt_details&olt_id=5#pon_ports', {waitUntil: 'networkidle2', timeout: 60000});
  await new Promise(r => setTimeout(r, 12000));
  
  const state = await page.evaluate(() => {
    return {
      activeTab: document.querySelector('.tab-pane.active')?.id,
      ponContent: document.getElementById('general_pon_ports_info')?.innerHTML?.substring(0, 500),
      headers: Array.from(document.querySelectorAll('#general_pon_ports_info th')).map(function(t) { return t.textContent.trim(); }),
      tableRows: document.querySelectorAll('#general_pon_ports_info tr').length
    };
  });
  
  console.log('=== PON PORTS TAB ===');
  console.log(JSON.stringify(state, null, 2));
  
  console.log('\n=== JS ERRORS ===');
  errors.forEach(function(e) { console.log(e); });
  if (errors.length === 0) console.log('None!');
  
  await browser.close();
})();

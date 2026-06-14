const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({headless: 'new'});
  const page = await browser.newPage();
  const errors = [];
  const responses = [];
  
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));
  page.on('response', resp => {
    if (resp.url().includes('/api/')) responses.push({url: resp.url(), status: resp.status()});
  });
  
  // Login
  await page.goto('http://10.0.0.2:3020/', {waitUntil: 'networkidle2', timeout: 30000});
  await page.type('input[name="username"]', 'admin');
  await page.type('input[name="password"]', 'admin');
  await Promise.all([
    page.waitForNavigation({waitUntil: 'networkidle2', timeout: 30000}),
    page.click('button[type="submit"]')
  ]);
  
  // Go to OLT details with #cards tab
  await page.goto('http://10.0.0.2:3020/modulo?pagina=smartolt_olt_details&olt_id=5#cards', {waitUntil: 'networkidle2', timeout: 60000});
  await new Promise(r => setTimeout(r, 10000));
  
  // Check DOM state
  const state = await page.evaluate(() => {
    return {
      hash: window.location.hash,
      activeTab: document.querySelector('.tab-pane.active')?.id,
      boardsContainer: document.getElementById('general_boards_info')?.innerHTML?.substring(0, 300),
      tabContent: document.getElementById('cards')?.innerHTML?.substring(0, 300),
      errorEl: document.querySelector('#cards .text-danger')?.textContent
    };
  });
  
  console.log('=== PAGE STATE ===');
  console.log(JSON.stringify(state, null, 2));
  
  console.log('\n=== API RESPONSES ===');
  responses.forEach(r => console.log(r.status + ' ' + r.url));
  
  console.log('\n=== ERRORS ===');
  errors.forEach(e => console.log(e));
  
  await browser.close();
})();

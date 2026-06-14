const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({headless: 'new'});
  const page = await browser.newPage();
  const errors = [];
  const failedUrls = new Set();
  
  page.on('console', msg => errors.push({type: msg.type(), text: msg.text()}));
  page.on('pageerror', err => errors.push({type: 'pageerror', text: err.message}));
  page.on('requestfailed', req => {
    const url = req.url();
    const errText = req.failure() ? req.failure().errorText : 'unknown';
    failedUrls.add(url);
    if (errText.includes('404') || errText === 'net::ERR_ABORTED') {
      // skip aborted
    } else {
      errors.push({type: 'requestfailed', url, err: errText});
    }
  });
  page.on('response', resp => {
    if (resp.status() === 404) {
      failedUrls.add(resp.url());
    }
  });

  // Set cookies from curl
  const cookieJar = fs.readFileSync('C:/Users/Jellyfin/tmp/cookies2.txt', 'utf8');
  const cookies = [];
  cookieJar.split('\n').forEach(function(line) {
    const parts = line.trim().split('\t');
    if (parts.length >= 7) {
      cookies.push({
        name: parts[5],
        value: parts[6],
        domain: '10.0.0.2',
        path: '/',
        httpOnly: false,
        secure: false
      });
    }
  });
  if (cookies.length > 0) {
    await page.setCookie(...cookies);
  }
  
  await page.goto('http://10.0.0.2:3020/modulo?pagina=smartolt_olt_details&olt_id=3', {waitUntil: 'networkidle2', timeout: 60000});
  await new Promise(r => setTimeout(r, 5000));
  
  console.log('=== PAGE ERRORS (JS) ===');
  errors.forEach(function(e) { console.log('[' + e.type + '] ' + e.text); });
  
  console.log('\n=== UNIQUE 404 URLs ===');
  const sorted = Array.from(failedUrls).sort();
  sorted.forEach(function(u) { console.log('404: ' + u); });
  
  console.log('\nTotal 404 resources: ' + sorted.length);
  
  // Check the API endpoint too
  console.log('\n=== Checking API /api/olts/3/status ===');
  try {
    const resp = await page.evaluate(() => {
      return fetch('/api/olts/3/status', { credentials: 'same-origin' })
        .then(r => r.status + ' ' + r.statusText)
        .catch(e => 'FETCH ERROR: ' + e.message);
    });
    console.log('API response: ' + resp);
  } catch(e) {
    console.log('API eval error: ' + e.message);
  }
  
  await browser.close();
})();

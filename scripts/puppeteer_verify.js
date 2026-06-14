const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({headless: 'new'});
  const page = await browser.newPage();
  const pageErrors = [];
  const failedUrls = new Set();
  
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('response', resp => {
    if (resp.status() === 404) failedUrls.add(resp.url());
  });

  const cookieJar = fs.readFileSync('C:/Users/Jellyfin/tmp/cookies3.txt', 'utf8');
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
  if (cookies.length > 0) await page.setCookie(...cookies);
  
  await page.goto('http://10.0.0.2:3020/modulo?pagina=smartolt_olt_details&olt_id=3', {waitUntil: 'networkidle2', timeout: 60000});
  await new Promise(r => setTimeout(r, 3000));
  
  console.log('=== JS Errors ===');
  pageErrors.forEach(function(e) { console.log('  ERROR: ' + e); });
  if (pageErrors.length === 0) console.log('  None!');
  
  console.log('\n=== 404 URLs ===');
  const sorted = Array.from(failedUrls).sort();
  sorted.forEach(function(u) { console.log('  404: ' + u); });
  if (sorted.length === 0) console.log('  None!');
  
  console.log('\nTotal 404s: ' + sorted.length);
  console.log('Total JS errors: ' + pageErrors.length);
  
  await browser.close();
})();

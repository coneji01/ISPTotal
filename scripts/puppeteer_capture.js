const { execSync } = require('child_process');
const fs = require('fs');

// Read cookies from the curl cookie jar
const cookieJar = fs.readFileSync('C:/Users/Jellyfin/tmp/cookies2.txt', 'utf8');
let cookieStr = '';
cookieJar.split('\n').forEach(function(line) {
  const parts = line.trim().split('\t');
  if (parts.length >= 7) {
    cookieStr += parts[5] + '=' + parts[6] + '; ';
  }
});

console.log('Cookies:', cookieStr);

// Use single-file with a cookie file
// single-file doesn't support cookies natively, so let's try puppeteer from the project
const projectDir = 'C:/Users/Jellyfin/ISPTotal';
const puppeteerPath = projectDir + '/node_modules/puppeteer';

if (fs.existsSync(puppeteerPath)) {
  console.log('puppeteer found in project node_modules');
  const puppeteer = require(puppeteerPath);
  
  (async () => {
    const browser = await puppeteer.launch({headless: 'new'});
    const page = await browser.newPage();
    const errors = [];
    page.on('console', msg => errors.push({type: msg.type(), text: msg.text()}));
    page.on('pageerror', err => errors.push({type: 'pageerror', text: err.message}));
    page.on('requestfailed', req => errors.push({type: 'requestfailed', url: req.url(), err: req.failure().errorText}));
    
    // Set cookies
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
      console.log('Set ' + cookies.length + ' cookies');
    }
    
    await page.goto('http://10.0.0.2:3020/modulo?pagina=smartolt_olt_details&olt_id=3', {waitUntil: 'networkidle2', timeout: 60000});
    await new Promise(r => setTimeout(r, 5000));
    console.log('ERRORS:', JSON.stringify(errors, null, 2));
    await browser.close();
  })();
} else {
  console.log('puppeteer NOT found at ' + puppeteerPath);
}

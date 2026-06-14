const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  try {
    await page.goto('https://joelwifi.smartolt.com/auth/login', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.type('#identity', 'joelr802@gmail.com');
    await page.type('#password', '7rQMHukJVn1R');
    await page.click('input[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
    
    await page.goto('https://joelwifi.smartolt.com/onu_authorization/authorize?board=3&port=3&sn=HWTC4ACADA1C&pon=gpon&onu_type=55&olt=1', {
      waitUntil: 'networkidle2', timeout: 30000
    }).catch(() => {});
    
    await new Promise(r => setTimeout(r, 2000));
    
    const html = await page.content();
    const url = page.url();
    console.log('URL final:', url);
    console.log('HTML size:', html.length);
    
    // Guardar en el directorio de trabajo actual
    const savePath = path.join(process.cwd(), 'public', 'smartolt-full', 'smartolt_authorize_puppeteer.html');
    console.log('Guardando en:', savePath);
    fs.writeFileSync(savePath, html);
    console.log('Guardado OK');
    
  } catch(e) {
    console.error('ERROR:', e.message);
  }
  
  await browser.close();
})();

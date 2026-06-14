const puppeteer = require('puppeteer');
const fs = require('fs');
(async () => {
  const browser = await puppeteer.launch({headless: 'new'});
  const page = await browser.newPage();
  const cookieJar = fs.readFileSync('C:/Users/Jellyfin/tmp/cookies4.txt','utf8');
  const cookies = [];
  cookieJar.split('\n').forEach(l => { const p = l.trim().split('\t'); if (p.length>=7) cookies.push({name:p[5],value:p[6],domain:'10.0.0.2',path:'/',httpOnly:false,secure:false}); });
  if (cookies.length) await page.setCookie(...cookies);
  await page.goto('http://10.0.0.2:3020/modulo?pagina=smartolt_olt_details&olt_id=3',{waitUntil:'networkidle2',timeout:60000});
  await new Promise(r => setTimeout(r, 4000));
  const apiResp = await page.evaluate(() => fetch('/api/olts/3/status', {credentials:'same-origin'}).then(r=>r.text()));
  console.log('API RESPONSE:');
  console.log(apiResp);
  await browser.close();
})();

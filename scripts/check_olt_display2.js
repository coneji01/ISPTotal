const puppeteer = require('puppeteer');
const fs = require('fs');
(async () => {
  const browser = await puppeteer.launch({headless: 'new'});
  const page = await browser.newPage();
  const cookieJar = fs.readFileSync('C:/Users/Jellyfin/tmp/cookies5.txt','utf8');
  const cookies = [];
  cookieJar.split('\n').forEach(l => { const p = l.trim().split('\t'); if (p.length>=7) cookies.push({name:p[5],value:p[6],domain:'10.0.0.2',path:'/',httpOnly:false,secure:false}); });
  if (cookies.length) await page.setCookie(...cookies);
  await page.goto('http://10.0.0.2:3020/modulo?pagina=smartolt_olt_details&olt_id=3',{waitUntil:'networkidle2',timeout:60000});
  await new Promise(r => setTimeout(r, 8000));
  const vals = await page.evaluate(() => {
    return {
      uptime: document.getElementById('olt-uptime')?.textContent,
      sidebarUptime: document.getElementById('olt-up-time-sidebar')?.textContent,
      name: document.getElementById('olt-name')?.textContent,
      model: document.getElementById('olt-model')?.textContent,
      online: document.getElementById('kpi-online')?.textContent,
      offline: document.getElementById('kpi-offline')?.textContent
    };
  });
  console.log(JSON.stringify(vals, null, 2));
  await browser.close();
})();

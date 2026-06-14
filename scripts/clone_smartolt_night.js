const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'puppeteer_data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const SMARTOLT_URL = 'https://joelwifi.smartolt.com';
const EMAIL = 'joelr802@gmail.com';
const PASSWORD='7rQMHukJVn1R';

(async () => {
  try {
    const browser = await puppeteer.launch({
      headless: false,
      defaultViewport: { width: 1366, height: 768 },
      args: ['--window-size=1366,768']
    });
    const page = await browser.newPage();
    
    // Ir a SmartOLT
    await page.goto(SMARTOLT_URL, { waitUntil: 'networkidle0', timeout: 30000 });
    var title = await page.title();
    
    if (title === 'Login') {
      console.log('Haciendo login...');
      await new Promise(function(r) { setTimeout(r, 2000); });
      
      var emailInput = await page.$('input[name="identity"]') || await page.$('input[type="email"]') || await page.$('input[name="email"]') || await page.$('input[type="text"]');
      var passInput = await page.$('input[type="password"]');
      
      if (emailInput && passInput) {
        await emailInput.click({ clickCount: 3 });
        await emailInput.type(EMAIL, { delay: 30 });
        await passInput.click({ clickCount: 3 });
        await passInput.type(PASSWORD, { delay: 30 });
        await page.keyboard.press('Enter');
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(function(){});
      }
    }
    
    console.log('Login OK:', await page.title());
    
    // FORZAR NIGHT MODE activado
    await page.evaluate(function() {
      // Forzar night mode
      document.documentElement.classList.add('smartolt-night');
      document.documentElement.classList.remove('smartolt-light');
      // Guardar preferencia en localStorage
      localStorage.setItem('smartolt-night', '1');
      localStorage.setItem('smartolt-theme-local', 'night');
      // Cambiar la cookie
      document.cookie = 'smartolt-night=1; path=/; max-age=31536000';
    });
    
    await new Promise(function(r) { setTimeout(r, 1000); });
    
    // Verificar que el night mode se aplicó
    var hasNight = await page.evaluate(function() {
      return document.documentElement.classList.contains('smartolt-night');
    });
    console.log('Night mode activado:', hasNight);
    
    // Lista completa de páginas a clonar
    var pagesToClone = [
      ['dashboard', '/'],
      ['configured', '/onu/configured'],
      ['configured_olt1', '/onu/configured?olt_id=1'],
      ['unconfigured', '/onu/unconfigured'],
      ['unconfigured_olt1', '/onu/unconfigured?olt_id=1'],
      ['onu_types', '/onu_types/listing'],
      ['speed_profiles', '/speed_profiles'],
      ['locations', '/locations/listing'],
      ['odbs', '/odbs/listing'],
      ['presets', '/onu_authorization_presets/listing'],
      ['diagnostics', '/diagnostics?signal=critical,warning&olt_id=1'],
      ['graphs', '/graphs'],
      ['general', '/general'],
      ['billing', '/general/listing/billing'],
      ['system_config', '/system_config'],
      ['olt_list', '/olt'],
      ['olt_details', '/olt/olt_details/1/details'],
      ['olt_cards', '/olt/olt_details/1/cards'],
      ['olt_pon_ports', '/olt/olt_details/1/pon_ports'],
      ['olt_uplink_ports', '/olt/olt_details/1/uplink_ports'],
      ['olt_vlans', '/olt/olt_details/1/vlans'],
      ['olt_ip_pools', '/olt/olt_details/1/ip_pools/mgmt']
    ];
    
    for (var i = 0; i < pagesToClone.length; i++) {
      var name = pagesToClone[i][0];
      var urlPath = pagesToClone[i][1];
      var fullUrl = SMARTOLT_URL + urlPath;
      
      console.log('[' + (i+1) + '/' + pagesToClone.length + '] ' + name + '...');
      try {
        await page.goto(fullUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        
        // Re-forzar night mode en cada página
        await page.evaluate(function() {
          document.documentElement.classList.add('smartolt-night');
          document.documentElement.classList.remove('smartolt-light');
        });
        
        await new Promise(function(r) { setTimeout(r, 500); });
        
        var html = await page.content();
        var size = html.length;
        var outputPath = path.join(DATA_DIR, name + '.html');
        fs.writeFileSync(outputPath, html);
        console.log('  -> ' + name + '.html (' + size + ' bytes)');
      } catch(e) {
        console.log('  -> ERROR: ' + e.message);
      }
    }
    
    console.log('CLONACION COMPLETA');
    fs.writeFileSync(path.join(DATA_DIR, 'result.txt'), 'CLONING COMPLETE: ' + pagesToClone.length + ' pages');
    
    // Cerrar browser
    await browser.close();
    
  } catch(e) {
    console.error('FATAL:', e.message);
    console.error(e.stack);
    fs.writeFileSync(path.join(DATA_DIR, 'error.txt'), e.message);
  }
})();

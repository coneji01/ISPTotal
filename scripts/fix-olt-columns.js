// Fix: Add olt_ip column alias to olts table
// The table has 'ip' column, but newer code uses 'olt_ip'
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const masterDbPath = path.join(__dirname, '..', 'data', 'master.db');
const tenantsDir = path.join(__dirname, '..', 'data', 'tenants');

console.log('=== Fix OLT columns ===');
console.log(`Master DB: ${masterDbPath}`);

// Fix master db
try {
  const db = new Database(masterDbPath);
  // Check if olts table exists in master
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='olts'").all();
  if (tables.length > 0) {
    console.log('Master DB has olts table');
    const cols = db.prepare("PRAGMA table_info(olts)").all();
    console.log('Columns:', cols.map(c => c.name).join(', '));
    if (!cols.find(c => c.name === 'olt_ip')) {
      console.log('Adding olt_ip column...');
      db.prepare("ALTER TABLE olts ADD COLUMN olt_ip TEXT DEFAULT ''").run();
      console.log('✓ Added olt_ip');
    } else {
      console.log('✓ olt_ip already exists');
    }
    if (!cols.find(c => c.name === 'olt_port')) {
      console.log('Adding olt_port column...');
      db.prepare("ALTER TABLE olts ADD COLUMN olt_port INTEGER DEFAULT 23").run();
      console.log('✓ Added olt_port');
    }
    if (!cols.find(c => c.name === 'olt_username')) {
      console.log('Adding olt_username column...');
      db.prepare("ALTER TABLE olts ADD COLUMN olt_username TEXT DEFAULT ''").run();
      console.log('✓ Added olt_username');
    }
    if (!cols.find(c => c.name === 'olt_password')) {
      console.log('Adding olt_password column...');
      db.prepare("ALTER TABLE olts ADD COLUMN olt_password TEXT DEFAULT ''").run();
      console.log('✓ Added olt_password');
    }
    if (!cols.find(c => c.name === 'socks_host')) {
      console.log('Adding socks_host column...');
      db.prepare("ALTER TABLE olts ADD COLUMN socks_host TEXT DEFAULT ''").run();
      console.log('✓ Added socks_host');
    }
    if (!cols.find(c => c.name === 'socks_port')) {
      console.log('Adding socks_port column...');
      db.prepare("ALTER TABLE olts ADD COLUMN socks_port INTEGER DEFAULT 1080").run();
      console.log('✓ Added socks_port');
    }
    // Copy ip -> olt_ip where olt_ip is empty
    db.prepare("UPDATE olts SET olt_ip = ip WHERE (olt_ip IS NULL OR olt_ip = '') AND ip IS NOT NULL AND ip != ''").run();
    console.log('✓ Copied ip values to olt_ip');
  }
  db.close();
} catch(e) {
  console.error('Error in master db:', e.message);
}

// Fix tenant databases
if (fs.existsSync(tenantsDir)) {
  const tenantFiles = fs.readdirSync(tenantsDir).filter(f => f.endsWith('.db'));
  console.log(`\nFound ${tenantFiles.length} tenant databases`);
  for (const file of tenantFiles) {
    try {
      const dbPath = path.join(tenantsDir, file);
      const db = new Database(dbPath);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='olts'").all();
      if (tables.length > 0) {
        console.log(`\nTenant ${file}:`);
        const cols = db.prepare("PRAGMA table_info(olts)").all();
        const colNames = cols.map(c => c.name);
        console.log('  Columns:', colNames.join(', '));
        
        const needed = [
          ['olt_ip', "TEXT DEFAULT ''"],
          ['olt_port', 'INTEGER DEFAULT 23'],
          ['olt_username', "TEXT DEFAULT ''"],
          ['olt_password', "TEXT DEFAULT ''"],
          ['socks_host', "TEXT DEFAULT ''"],
          ['socks_port', 'INTEGER DEFAULT 1080']
        ];
        
        for (const [col, type] of needed) {
          if (!colNames.includes(col)) {
            db.prepare(`ALTER TABLE olts ADD COLUMN ${col} ${type}`).run();
            console.log(`  ✓ Added ${col}`);
          }
        }
        
        // Copy ip -> olt_ip
        db.prepare("UPDATE olts SET olt_ip = ip WHERE (olt_ip IS NULL OR olt_ip = '') AND ip IS NOT NULL AND ip != ''").run();
        console.log('  ✓ Copied ip values to olt_ip');
      }
      db.close();
    } catch(e) {
      console.error(`Error in ${file}:`, e.message);
    }
  }
}

console.log('\n=== Fix complete ===');

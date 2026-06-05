#!/usr/bin/env node
const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '..', 'isptotal.db'));

console.log('Generando datos demo...');

// Aplicar migraciones
try { db.exec("ALTER TABLE clientes ADD COLUMN direccion TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE servicios ADD COLUMN fecha_activacion DATE"); } catch(e) {}
try { db.exec("ALTER TABLE servicios ADD COLUMN fecha_suspension DATE"); } catch(e) {}

// Zonas
try { db.prepare("INSERT INTO zonas (nombre) VALUES ('Zona Centro')").run(); } catch(e) {}
try { db.prepare("INSERT INTO zonas (nombre) VALUES ('Zona Norte')").run(); } catch(e) {}

const nombres = [
  ['Juan Pérez', '03105259991', '8092470033'],
  ['María Rodríguez', '03105259992', '8293560044'],
  ['Carlos Martínez', '03105259993', '8495670055'],
  ['Ana García', '03105259994', '8096780066'],
  ['Luis López', '03105259995', '8297890077'],
  ['Rosa Hernández', '03105259996', '8498900088'],
  ['Pedro González', '03105259997', '8099010099'],
  ['Juana Díaz', '03105259998', '8290120100'],
  ['Ramón Torres', '03105259999', '8491230111'],
  ['Magdalena Reyes', '03105260000', '8092340122']
];

const batch = db.transaction(() => {
  for (let i = 0; i < nombres.length; i++) {
    const [nombre, cedula, telefono] = nombres[i];
    const zonaId = (i % 2) + 1;
    const planId = (i % 3) + 1;
    const ip = `10.0.${Math.floor(i/10)}.${(i%10)+100}`;
    const dir = `Calle Principal #${i+1}`;
    
    db.prepare('INSERT INTO clientes (nombre, cedula, telefono, direccion, zona_id, created_at) VALUES (?,?,?,?,?,?)')
      .run(nombre, cedula, telefono, dir, zonaId, '2026-01-15 08:00:00');
    
    const r = db.prepare('INSERT INTO servicios (cliente_id, plan_id, zona_id, estado, ip, fecha_activacion, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(i+1, planId, zonaId, 'activo', ip, '2026-01-15', '2026-01-15 08:00:00');
    const svcId = r.lastInsertRowid;
    
    // Facturas
    const meses = [
      { label: 'Marzo', y: 2026, m: 3, days: 31 },
      { label: 'Abril', y: 2026, m: 4, days: 30 },
      { label: 'Mayo', y: 2026, m: 5, days: 31 }
    ];
    
    for (const mes of meses) {
      const ms = `${mes.y}-${String(mes.m).padStart(2,'0')}`;
      const facturaDate = `${ms}-${mes.days}`;
      const montos = [800, 1200, 1800];
      const monto = montos[planId - 1];
      
      const f = db.prepare('INSERT INTO facturas (servicio_id, periodo, monto, estado, fecha_emision, fecha_vencimiento) VALUES (?,?,?,?,?,?)')
        .run(svcId, ms, monto, 'pendiente', facturaDate, facturaDate);
      
      // ~80% pagadas
      if (Math.random() < 0.8 || mes.m < 5) {
        const payDay = Math.floor(Math.random() * 15) + 1;
        const payDate = `${ms}-${String(payDay).padStart(2,'0')} 18:00:00`;
        const metodos = ['EFECTIVO', 'Transferencia', 'BANRESERVAS'];
        db.prepare('INSERT INTO pagos (factura_id, servicio_id, cliente_id, monto, metodo, created_at, recibo, activar) VALUES (?,?,?,?,?,?,?,1)')
          .run(f.lastInsertRowid, svcId, i+1, monto, metodos[Math.floor(Math.random()*3)], payDate, i*3+meses.indexOf(mes)+1);
      }
    }
  }
});

batch();
console.log(`✅ ${nombres.length} clientes demo creados con facturas de 3 meses`);
console.log('📧 Usuario: admin / Contraseña: admin123');
db.close();

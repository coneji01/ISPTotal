#!/usr/bin/env node
/**
 * Genera datos demo para la versión de prueba en Docker
 * Crea ~20 clientes con facturas y pagos de los últimos 3 meses
 */
const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '..', 'isptotal.db'));

const nombres = [
  'Juan Pérez', 'María Rodríguez', 'Carlos Martínez', 'Ana García',
  'Luis López', 'Rosa Hernández', 'Pedro González', 'Juana Díaz',
  'Ramón Torres', 'Magdalena Reyes', 'Francisco Castillo', 'Antonia Romero',
  'Miguel Almonte', 'Francisca Jiménez', 'Ángel Vásquez', 'Ramona Cruz',
  'David Santos', 'Teresa Moreno', 'Jorge Ramírez', 'Margarita Fernández'
];

const rncs = [
  '03105259991','03105259992','03105259993','03105259994','03105259995',
  '03105259996','03105259997','03105259998','03105259999','03105260000',
  '03105260001','03105260002','03105260003','03105260004','03105260005',
  '03105260006','03105260007','03105260008','03105260009','03105260010'
];

const phones = [
  '8092470033','8293560044','8495670055','8096780066','8297890077',
  '8498900088','8099010099','8290120100','8491230111','8092340122',
  '8293450133','8494560144','8095670155','8296780166','8497890177',
  '8098900188','8299010199','8490120200','8091230211','8292340222'
];

const zoneIds = [1, 2];
const planIds = [1, 2, 3];

const zonas = { 1: 'Zona Demo 1', 2: 'Zona Demo 2' };
const planes = { 1: 'Plan Básico 50M', 2: 'Plan Estándar 100M', 3: 'Plan Premium 200M' };

let lastRecibo = 0;

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function padDay(d) {
  return String(d).padStart(2, '0');
}

const meses = [
  { label: 'Marzo', y: 2026, m: 3 },
  { label: 'Abril', y: 2026, m: 4 },
  { label: 'Mayo', y: 2026, m: 5 }
];

const insertCliente = db.prepare(
  'INSERT INTO clientes (nombre, cedula, telefono, direccion, zona_id, created_at) VALUES (?,?,?,?,?,?)'
);

const insertServicio = db.prepare(
  'INSERT INTO servicios (cliente_id, plan_id, zona_id, estado, ip, direccion, fecha_activacion, created_at) VALUES (?,?,?,?,?,?,?,?)'
);

const insertFactura = db.prepare(
  'INSERT INTO facturas (servicio_id, periodo, monto, estado, fecha_emision, fecha_vencimiento) VALUES (?,?,?,?,?,?)'
);

const insertPago = db.prepare(
  'INSERT INTO pagos (factura_id, servicio_id, cliente_id, monto, metodo, created_at, recibo, activar) VALUES (?,?,?,?,?,?,?,?)'
);

console.log('Generando clientes demo...');

const batchInsert = db.transaction(() => {
  for (let i = 0; i < nombres.length; i++) {
    const name = nombres[i];
    const rnc = rncs[i];
    const phone = phones[i];
    const zonaId = zoneIds[i % 2];
    const planId = planIds[i % 3];
    const fechaAct = '2026-01-15';
    const ip = `10.0.${Math.floor(i / 10)}.${(i % 10) + 100}`;
    const dir = `Calle Principal #${i + 1}, ${zonas[zonaId]}`;
    
    insertCliente.run(name, rnc, phone, dir, zonaId, '2026-01-15 08:00:00');
    const svcResult = insertServicio.run(i + 1, planId, zonaId, 'activo', ip, dir, fechaAct, '2026-01-15 08:00:00');
    const svcId = svcResult.lastInsertRowid;
    
    // Generar facturas y pagos para los últimos 3 meses
    for (const mes of meses) {
      const ms = `${mes.y}-${String(mes.m).padStart(2, '0')}`;
      const daysInM = new Date(mes.y, mes.m, 0).getDate();
      const facturaDate = `${ms}-${daysInM}`;
      const monto = planId === 3 ? 2500 : planId === 2 ? 1500 : 1000;
      
      const fResult = insertFactura.run(svcId, ms, monto, 'pendiente', facturaDate, facturaDate);
      const facturaId = fResult.lastInsertRowid;
      
      // ~90% de las facturas están pagadas (mayo tiene menos pagos)
      const payProb = mes.m === 5 ? 0.7 : 0.95;
      if (Math.random() < payProb) {
        const payDay = randInt(1, Math.min(15, daysInM));
        const payDate = `${ms}-${padDay(payDay)} 18:${String(randInt(0, 59)).padStart(2, '0')}:00`;
        const metodo = ['EFECTIVO', 'Transferencia', 'BANRESERVAS'][randInt(0, 2)];
        lastRecibo++;
        insertPago.run(facturaId, svcId, i + 1, monto, metodo, payDate, lastRecibo, 1);
      }
    }
  }
});

batchInsert();

console.log(`✅ ${nombres.length} clientes demo creados con facturas de ${meses.length} meses`);
console.log('📧 Credenciales: admin / admin123');
db.close();

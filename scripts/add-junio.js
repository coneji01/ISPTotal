#!/usr/bin/env node
const Database = require('better-sqlite3');
const db = new Database(__dirname + '/../isptotal.db');

const nombres = ['Carlos Manuel','Ana María','Luis Alberto','María Fernanda','Juan Carlos','Rosa Elena','Pedro Antonio','Sandra Milena','José Ramón','Marta Lucía','Rafael Emilio','Carmen Rosa','Francisco Javier','Dulce María','Miguel Ángel'];
const apellidos = ['Rodríguez','Martínez','García','Pérez','Jiménez','Castillo','Reyes','Contreras','Santos','Vargas','Fernández','Rojas','Cruz','Méndez','Cuevas'];
const calles = ['C/ Principal #42, Reparto Peralta','C/ Duarte #18, Reparto Peralta','C/ Salomé Ureña #7, Reparto Peralta','Av. Independencia #68, Bella Vista','C/ Benito Juárez #27, Bella Vista','Av. 27 de Febrero #120, Bella Vista','C/ Sarasota #42, Bella Vista','C/ Roberto Pastoriza #35, Bella Vista'];
const motivosRetiro = ['Cambio de domicilio','No pagó','Migración a otro ISP','Problemas económicos','Cancelación voluntaria'];

function ri(min,max){return Math.floor(Math.random()*(max-min+1))+min;}
function rc(arr){return arr[Math.floor(Math.random()*arr.length)];}
function rced(){return ri(10000000000,99999999999).toString();}
function rtel(){const p=['809','829','849'];return rc(p)+ri(1000000,9999999).toString();}

let ipCount = 400;
let svcIds = [];

const insertCliente = db.prepare(
  'INSERT INTO clientes (nombre, cedula, telefono, telefono2, direccion, zona_id, estado, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);
const insertServicio = db.prepare(
  'INSERT INTO servicios (cliente_id, plan_id, zona_id, ip, estado, fecha_activacion, ciclo_id, direccion, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
);

const tx1 = db.transaction(() => {
  for (let i = 0; i < 15; i++) {
    const dia = String(ri(2, 20)).padStart(2, '0');
    const createdDate = '2026-06-' + dia;
    const nombre = rc(nombres) + ' ' + rc(apellidos);
    const dir = rc(calles);
    const zona = rc([1, 2]);
    const r = insertCliente.run(nombre, rced(), rtel(), rtel(), dir, zona, 'activo', createdDate);
    const cid = r.lastInsertRowid;

    const plan = rc([2, 4]);
    const ip = '10.0.' + Math.floor(ipCount / 256) + '.' + (ipCount % 256);
    ipCount++;
    const ciclo = rc([1, 2]);
    const sr = insertServicio.run(cid, plan, zona, ip, 'activo', createdDate, ciclo, dir, createdDate);
    svcIds.push(sr.lastInsertRowid);
  }
});
tx1();
console.log('✓ 15 clientes creados en junio 2026');

// 4 retiros en junio 2026
const activos = db.prepare("SELECT id, fecha_activacion FROM servicios WHERE estado = 'activo' ORDER BY RANDOM() LIMIT 10").all();
const updateRetiro = db.prepare("UPDATE servicios SET estado = 'retirado', fecha_retiro = ?, motivo_retiro = ? WHERE id = ?");
let ret = 0;
const tx2 = db.transaction(() => {
  for (let i = 0; i < 4 && i < activos.length; i++) {
    const s = activos[i];
    const dia = String(ri(22, 28)).padStart(2, '0');
    const retDate = '2026-06-' + dia;
    const mot = rc(motivosRetiro);
    updateRetiro.run(retDate, mot, s.id);
    ret++;
  }
});
tx2();
console.log('✓ ' + ret + ' retiros asignados en junio 2026');

console.log('');
console.log('Clientes total:', db.prepare('SELECT COUNT(*) as c FROM clientes').get().c);
console.log('Servicios activos:', db.prepare("SELECT COUNT(*) as c FROM servicios WHERE estado = 'activo'").get().c);
console.log('Servicios retirados:', db.prepare("SELECT COUNT(*) as c FROM servicios WHERE estado = 'retirado'").get().c);

db.close();

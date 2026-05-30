#!/usr/bin/env node
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'isptotal.db');
const db = new Database(dbPath);

const motivosRetiro = [
  'Cambio de domicilio', 'No pagó', 'Migración a otro ISP',
  'Problemas económicos', 'Cierre temporal', 'Cancelación voluntaria',
  'Se mudó de zona', 'Inconformidad con el servicio', 'Falla técnica recurrente',
  'Reducción de gastos', 'Viaje prolongado', 'Servicio duplicado'
];

function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Paso 1: Limpiar retiros existentes (poner los 4 retirados actuales a activo)
console.log('Paso 1: Restaurando servicios retirados a activo...');
const retirosActuales = db.prepare("SELECT id, cliente_id, fecha_activacion FROM servicios WHERE estado='retirado'").all();
console.log(`  ${retirosActuales.length} servicios retirados encontrados, restaurando...`);
db.prepare("UPDATE servicios SET estado='activo', fecha_retiro=NULL, motivo_retiro=NULL WHERE estado='retirado'").run();
console.log('  ✓ Restaurados');

// Paso 2: Obtener todos los servicios activos con su fecha de activación
console.log('\nPaso 2: Preparando asignación de retiros mes por mes...');
const servicios = db.prepare("SELECT s.id, s.cliente_id, s.fecha_activacion, c.nombre as cliente_nombre FROM servicios s JOIN clientes c ON c.id=s.cliente_id WHERE s.estado='activo' ORDER BY s.fecha_activacion ASC").all();

// Paso 3: Definir distribución de retiros mes por mes
// Julio 2025 -> no hay servicios previos, no se puede
// Agosto 2025 a Mayo 2026 = 10 meses
const retirosPorMes = {
  '2025-08': 4,
  '2025-09': 3,
  '2025-10': 5,
  '2025-11': 2,
  '2025-12': 4,
  '2026-01': 6,
  '2026-02': 3,
  '2026-03': 5,
  '2026-04': 2,
  '2026-05': 3
};

console.log('Distribución de retiros por mes:');
Object.entries(retirosPorMes).forEach(([mes, count]) => {
  console.log(`  ${mes}: ${count} retiro(s)`);
});

const totalRetiros = Object.values(retirosPorMes).reduce((s, v) => s + v, 0);
console.log(`  Total: ${totalRetiros} retiros`);

// Paso 4: Asignar retiros
console.log('\nPaso 3: Asignando retiros...');
let asignados = 0;
let pool = [...servicios]; // copy

const updateRetiro = db.prepare(
  "UPDATE servicios SET estado='retirado', fecha_retiro=?, motivo_retiro=? WHERE id=?"
);

const transaction = db.transaction(() => {
  Object.entries(retirosPorMes).forEach(([mesKey, count]) => {
    const [year, month] = mesKey.split('-').map(Number);
    const mesNombre = new Date(year, month - 1).toLocaleString('es', { month: 'long', year: 'numeric' });
    
    // Retiro date: random day 15-26 of that month
    const day = randomInt(18, 28);
    const retiroDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    // Filter: servicios activados al menos 1 mes antes de la fecha de retiro
    const eligiblePool = pool.filter(s => {
      const actDate = new Date(s.fecha_activacion);
      // Must be activated at least 1 month before the retirement month
      const actMonth = actDate.getFullYear() * 12 + actDate.getMonth();
      const retMonth = year * 12 + (month - 1);
      return (retMonth - actMonth) >= 1;
    });
    
    let assignedInMonth = 0;
    const toAssign = Math.min(count, eligiblePool.length);
    
    for (let i = 0; i < toAssign && eligiblePool.length > 0; i++) {
      const idx = randomInt(0, eligiblePool.length - 1);
      const pick = eligiblePool[idx];
      
      // Remove from both pools
      const poolIdx = pool.findIndex(s => s.id === pick.id);
      if (poolIdx !== -1) pool.splice(poolIdx, 1);
      eligiblePool.splice(idx, 1);
      
      const motivo = randomChoice(motivosRetiro);
      updateRetiro.run(retiroDate, motivo, pick.id);
      assignedInMonth++;
      asignados++;
    }
    
    if (assignedInMonth < count) {
      console.log(`  ⚠ ${mesNombre}: solo se pudieron asignar ${assignedInMonth}/${count} (faltaron servicios elegibles)`);
    } else {
      console.log(`  ✓ ${mesNombre}: ${assignedInMonth} retiro(s) asignados (ej: ${retiroDate})`);
    }
  });
});

transaction();

console.log(`\n✓ Total: ${asignados}/${totalRetiros} retiros asignados`);

// Verificación final
const verif = db.prepare("SELECT estado, COUNT(*) as c FROM servicios GROUP BY estado").all();
console.log('\n=== VERIFICACIÓN FINAL ===');
verif.forEach(v => console.log(`  ${v.estado}: ${v.c}`));

// Mostrar retiros por mes
console.log('');
const retiros = db.prepare(`
  SELECT strftime('%Y-%m', s.fecha_retiro) as mes, COUNT(*) as count
  FROM servicios s WHERE s.estado='retirado'
  GROUP BY mes ORDER BY mes
`).all();
console.log('Retiros por mes:');
retiros.forEach(r => console.log(`  ${r.mes}: ${r.count}`));

db.close();

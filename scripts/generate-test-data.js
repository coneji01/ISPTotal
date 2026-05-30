#!/usr/bin/env node
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'isptotal.db');
const db = new Database(dbPath);

const nombres = [
  'Carlos Manuel', 'Ana María', 'Luis Alberto', 'María Fernanda', 'Juan Carlos',
  'Rosa Elena', 'Pedro Antonio', 'Sandra Milena', 'José Ramón', 'Marta Lucía',
  'Rafael Emilio', 'Carmen Rosa', 'Francisco Javier', 'Dulce María', 'Miguel Ángel',
  'Altagracia Delgado', 'Ramón Antonio', 'Yolanda Reyes', 'Víctor Manuel', 'Natalia Suárez',
  'Félix Omar', 'Elizabeth Rojas', 'Manuel de Jesús', 'Patricia Jiménez', 'Alberto José',
  'Johanna Martínez', 'Reynaldo Pérez', 'Katherine Fernández', 'Héctor Luis', 'Melissa Cruz',
  'Wilfredo José', 'Gabriela Vargas', 'Gregorio Antonio', 'Daniela Castillo', 'Andrés Felipe',
  'Carolina Méndez', 'José Miguel', 'Angélica María', 'Ricardo José', 'Lourdes Villar',
  'Tomás Enrique', 'Gisselle Tejada', 'Samuel David', 'Raquel Peña', 'Eduardo Javier',
  'Claudia María', 'Fernando Arturo', 'Leticia Soto', 'Rafael Augusto', 'Xiomara Rivas',
  'Benjamín Alexander', 'Marisol de la Rosa', 'Isaac David', 'Tania Cabrera', 'Saúl Enrique',
  'Marina Contreras', 'Oscar Ramón', 'Nellys Castillo', 'David Alfonso', 'Arelis Cuevas',
  'Jorge Luis', 'Ivelisse Germán', 'Emmanuel José', 'Yanet de León', 'Julián Alberto',
  'Soraya Vargas', 'Cristian Rafael', 'Mirian Bautista', 'Adrián de Jesús', 'Juana Peralta',
  'Abelardo José', 'Fiordaliza Pérez', 'Rubén Darío', 'Viviana Espaillat', 'Johan Manuel',
  'Sugey Rodríguez', 'Randy Alexander', 'Yudelka Jiménez', 'Eliezer Valdez', 'Betania Medina',
  'Moisés David', 'Luz María', 'Jairo Enrique', 'Gregoria Paulino', 'Dionisio Antonio',
  'Massiel Herrera', 'Sergio Andrés', 'Alejandrina Díaz', 'Pablo Rafael', 'Yaquelín Mota',
  'Eddy José', 'Rosalía Mora', 'César Augusto', 'Adalgisa Guzmán', 'Alexander Paulino',
  'Virginia Cuevas', 'Marino Antonio', 'Mercedes Ureña', 'Joel Antonio', 'Cristina Santos'
];

const apellidos = [
  'Rodríguez', 'Martínez', 'García', 'Pérez', 'Jiménez',
  'Castillo', 'Reyes', 'Contreras', 'Santos', 'Vargas',
  'Fernández', 'Rojas', 'Cruz', 'Méndez', 'Cuevas',
  'Tejada', 'Peña', 'de la Rosa', 'Cabrera', 'Rivas',
  'Germán', 'Castellanos', 'Valdez', 'Medina', 'Paulino',
  'Mota', 'Guzmán', 'Ureña', 'Suárez', 'Villar',
  'Delgado', 'Soto', 'Bautista', 'Peralta', 'Espaillat',
  'Mora', 'Díaz', 'Marte', 'Almonte', 'Báez'
];

const calles = [
  'C/ Principal #42, Reparto Peralta', 'C/ Duarte #18, Reparto Peralta',
  'C/ Salomé Ureña #7, Reparto Peralta', 'C/ Restauración #31, Reparto Peralta',
  'C/ Las Flores #15, Reparto Peralta', 'C/ Los Manganeses #9, Reparto Peralta',
  'C/ Mella #24, Reparto Peralta', 'C/ 27 de Febrero #11, Reparto Peralta',
  'C/ Colón #33, Reparto Peralta', 'C/ Independencia #5, Reparto Peralta',
  'C/ Sánchez #19, Reparto Peralta', 'C/ Luperón #28, Reparto Peralta',
  'C/ Espaillat #44, Reparto Peralta', 'C/ Bolívar #13, Reparto Peralta',
  'C/ Hostos #38, Reparto Peralta', 'C/ La Trinitaria #22, Reparto Peralta',
  'C/ 30 de Marzo #16, Reparto Peralta', 'C/ Padre Billini #8, Reparto Peralta',
  'C/ Mercedes #36, Reparto Peralta', 'C/ El Carmen #3, Reparto Peralta',
  'Av. Independencia #68, Bella Vista', 'C/ Benito Juárez #27, Bella Vista',
  'Av. 27 de Febrero #120, Bella Vista', 'C/ Abraham Lincoln #55, Bella Vista',
  'C/ Sarasota #42, Bella Vista', 'C/ Roberto Pastoriza #35, Bella Vista',
  'C/ Gustavo Mejía Ricart #71, Bella Vista', 'Av. Winston Churchill #90, Bella Vista',
  'C/ Cayetano Germosén #15, Bella Vista', 'C/ Agustin Lara #48, Bella Vista',
  'C/ Elvira de Mendoza #63, Bella Vista', 'C/ Pedro Henríquez Ureña #29, Bella Vista'
];

function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomCedula() { return randomInt(10000000000, 99999999999).toString(); }
function randomPhone() { const p = ['809','829','849']; return randomChoice(p) + randomInt(1000000, 9999999).toString(); }
function dateToStr(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }

// ========== DISTRIBUIR CLIENTES POR MES (Jul 2025 - May 2026) ==========
const meses = [
  { mes: 7,  year: 2025, label: 'Jul 2025' },
  { mes: 8,  year: 2025, label: 'Ago 2025' },
  { mes: 9,  year: 2025, label: 'Sep 2025' },
  { mes: 10, year: 2025, label: 'Oct 2025' },
  { mes: 11, year: 2025, label: 'Nov 2025' },
  { mes: 12, year: 2025, label: 'Dic 2025' },
  { mes: 1,  year: 2026, label: 'Ene 2026' },
  { mes: 2,  year: 2026, label: 'Feb 2026' },
  { mes: 3,  year: 2026, label: 'Mar 2026' },
  { mes: 4,  year: 2026, label: 'Abr 2026' },
  { mes: 5,  year: 2026, label: 'May 2026' }
];

// Generar distribución: 100 clientes en 11 meses con cantidades variadas
// Usar un patrón de pesos para que unos meses tengan más que otros
const pesos = [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2];
const totalPeso = pesos.reduce((s, v) => s + v, 0);

// Asignar pesos aleatorios a cada mes
let shuffledPesos = [...pesos].sort(() => Math.random() - 0.5);
const distribucion = meses.map((m, i) => ({
  mes: m,
  peso: shuffledPesos[i],
  clientes: Math.round((shuffledPesos[i] / totalPeso) * 100)
}));

// Ajustar para que sumen exactamente 100
let suma = distribucion.reduce((s, d) => s + d.clientes, 0);
let diff = 100 - suma;
distribucion[0].clientes += diff;

console.log('=== Distribución de clientes por mes ===');
distribucion.forEach(d => {
  // Generar fechas aleatorias dentro del mes
  const diasEnMes = new Date(d.mes.year, d.mes.mes, 0).getDate();
  const maxDia = d.mes.mes === 5 && d.mes.year === 2026 ? 25 : diasEnMes; // May 2026 solo hasta día 25
  console.log(`  ${d.mes.label}: ${d.clientes} cliente(s) (días 1-${maxDia})`);
  d.diasMes = maxDia;
});
console.log(`  Total: ${distribucion.reduce((s, d) => s + d.clientes, 0)}`);

// Generar clientes
const insertCliente = db.prepare(
  `INSERT INTO clientes (nombre, cedula, telefono, telefono2, direccion, zona_id, estado, created_at) VALUES (?, ?, ?, ?, ?, ?, 'activo', ?)`
);
const insertServicio = db.prepare(
  `INSERT INTO servicios (cliente_id, plan_id, zona_id, ip, estado, fecha_activacion, ciclo_id, direccion, created_at) VALUES (?, ?, ?, ?, 'activo', ?, ?, ?, ?)`
);

const planes = [2, 4];
const zonas = [1, 2];
const ciclos = [1, 2];
const serviciosCreados = [];

let totalClientes = 0;
let totalServicios = 0;

const transaction = db.transaction(() => {
  let ipCount = 11;
  
  distribucion.forEach((d) => {
    const { year, mes } = d.mes;
    const maxDia = d.diasMes;
    
    // Distribuir los clientes del mes en diferentes días (evitar que todos caigan el mismo día)
    const clientesDelMes = d.clientes;
    const diasUsados = [];
    
    // Repartir clientes en varios días del mes
    for (let i = 0; i < clientesDelMes; i++) {
      // Elegir día del mes (con algo de variación)
      let dia;
      if (i < clientesDelMes / 2) {
        // Primera mitad: primeros días del mes
        dia = randomInt(2, Math.min(15, maxDia));
      } else {
        // Segunda mitad: días más variados
        dia = randomInt(5, maxDia - 1);
      }
      
      const createdDate = `${year}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      
      const nombreCompleto = randomChoice(nombres) + ' ' + randomChoice(apellidos);
      const cedula = randomCedula();
      const telefono = randomPhone();
      const direccion = randomChoice(calles);
      const zonaId = randomChoice(zonas);
      
      const result = insertCliente.run(nombreCompleto, cedula, telefono, randomPhone(), direccion, zonaId, createdDate);
      const clienteId = result.lastInsertRowid;
      
      // 1 o 2 servicios por cliente (70% un servicio, 30% dos)
      const numServicios = Math.random() < 0.7 ? 1 : 2;
      
      for (let s = 0; s < numServicios; s++) {
        const planId = randomChoice(planes);
        const ip = '10.0.' + Math.floor(ipCount / 256) + '.' + (ipCount % 256);
        ipCount++;
        const cicloId = randomChoice(ciclos);
        
        // Activación: mismo día o 1-3 días después
        const actOffset = randomInt(0, 3);
        const actDate = new Date(year, mes - 1, dia + actOffset);
        const actStr = dateToStr(actDate);
        
        const svcResult = insertServicio.run(clienteId, planId, zonaId, ip, actStr, cicloId, direccion, actStr);
        serviciosCreados.push({ id: svcResult.lastInsertRowid, activacion: new Date(actStr) });
        totalServicios++;
      }
      totalClientes++;
    }
  });
});

console.log('\nInsertando clientes y servicios...');
const startTime = Date.now();
transaction();
console.log('✓ Hecho en ' + ((Date.now()-startTime)/1000).toFixed(1) + 's');
console.log('Clientes: ' + totalClientes + ' | Servicios: ' + totalServicios);

// ========== ASIGNAR RETIROS MES POR MES ==========
console.log('\n=== Asignando retiros mes por mes ===');

const motivosRetiro = [
  'Cambio de domicilio', 'No pagó', 'Migración a otro ISP',
  'Problemas económicos', 'Cierre temporal', 'Cancelación voluntaria',
  'Se mudó de zona', 'Inconformidad con el servicio', 'Falla técnica recurrente',
  'Reducción de gastos', 'Viaje prolongado', 'Servicio duplicado'
];

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

let pool = [...serviciosCreados];
let asignados = 0;

const updateRetiro = db.prepare(
  "UPDATE servicios SET estado='retirado', fecha_retiro=?, motivo_retiro=? WHERE id=?"
);

const retiroTransaction = db.transaction(() => {
  Object.entries(retirosPorMes).forEach(([mesKey, count]) => {
    const [year, month] = mesKey.split('-').map(Number);
    const day = randomInt(18, 28);
    const retiroDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    // Servicios activados al menos 1 mes antes
    const eligiblePool = pool.filter(s => {
      const actMonth = s.activacion.getFullYear() * 12 + s.activacion.getMonth();
      const retMonth = year * 12 + (month - 1);
      return (retMonth - actMonth) >= 1;
    });
    
    const toAssign = Math.min(count, eligiblePool.length);
    let assigned = 0;
    
    for (let i = 0; i < toAssign && eligiblePool.length > 0; i++) {
      const idx = randomInt(0, eligiblePool.length - 1);
      const pick = eligiblePool[idx];
      
      const poolIdx = pool.findIndex(s => s.id === pick.id);
      if (poolIdx !== -1) pool.splice(poolIdx, 1);
      eligiblePool.splice(idx, 1);
      
      const motivo = randomChoice(motivosRetiro);
      updateRetiro.run(retiroDate, motivo, pick.id);
      assigned++;
      asignados++;
    }
    
    if (assigned < count) {
      console.log(`  ⚠ ${mesKey}: ${assigned}/${count} (faltaron servicios elegibles)`);
    } else {
      console.log(`  ✓ ${mesKey}: ${assigned} retiro(s)`);
    }
  });
});

retiroTransaction();

console.log(`\n✓ Total retiros: ${asignados}`);

// Verificación final
console.log('\n=== DISTRIBUCIÓN FINAL ===');
const instalados = db.prepare(`
  SELECT strftime('%Y-%m', fecha_activacion) as mes, COUNT(*) as total
  FROM servicios GROUP BY mes ORDER BY mes
`).all();
console.log('Instalados por mes:');
instalados.forEach(r => console.log(`  ${r.mes}: ${r.total}`));

const retirados = db.prepare(`
  SELECT strftime('%Y-%m', fecha_retiro) as mes, COUNT(*) as total
  FROM servicios WHERE estado='retirado' GROUP BY mes ORDER BY mes
`).all();
console.log('Retirados por mes:');
retirados.forEach(r => console.log(`  ${r.mes}: ${r.total}`));

const estados = db.prepare("SELECT estado, COUNT(*) as c FROM servicios GROUP BY estado").all();
console.log('\nServicios:');
estados.forEach(r => console.log(`  ${r.estado}: ${r.c}`));

console.log(`\nClientes total: ${db.prepare('SELECT COUNT(*) as c FROM clientes').get().c}`);

db.close();

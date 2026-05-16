// ISP Total - Frontend App
document.addEventListener('DOMContentLoaded', function() {
  // Initialize tooltips
  document.querySelectorAll('[data-tooltip]').forEach(el => {
    el.addEventListener('mouseenter', function() {
      const tip = document.createElement('div');
      tip.className = 'tooltip';
      tip.textContent = this.dataset.tooltip;
      this.appendChild(tip);
    });
    el.addEventListener('mouseleave', function() {
      this.querySelector('.tooltip')?.remove();
    });
  });
});

// Global search function (used by BuscarOnu module)
async function buscarCliente(query, callback) {
  if (!query || query.length < 3) return;
  try {
    const r = await fetch('/api/clientes/buscar?q=' + encodeURIComponent(query));
    const data = await r.json();
    if (callback) callback(data);
  } catch(e) {
    console.error('Error buscando cliente:', e);
  }
}

// Format currency
function formatMoney(n) {
  return '$' + parseFloat(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Date helpers
function today() { return new Date().toISOString().split('T')[0]; }
function formatDate(d) {
  return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });
}

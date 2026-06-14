// olt_unconfigured.js - Carga de ONUs no configuradas
$(document).ready(function() {
  function cargarUnconfigured() {
    $.ajax({ url: '/api/olt/unconfigured-onus', method: 'GET',
      success: function(r) {
        if (!r.success || !r.data || !r.data.length) {
          $('#gpon-epon-unconfigured-1 table tbody').html('<tr><td colspan="7" class="text-center text-muted">No unconfigured ONUs found</td></tr>');
          return;
        }
        var h = '';
        r.data.forEach(function(o) {
          h += '<tr class="valign-center"><td>GPON</td><td>' + o.board + '</td><td>' + o.port + '</td><td></td><td>' + (o.sn||'N/A') + '</td><td>Auto-detect</td>' +
            '<td class="text-center"><a href="#" class="btn btn-link activateButton">Authorize</a></td></tr>';
        });
        $('#gpon-epon-unconfigured-1 table tbody').html(h);
        $('.waiting-auth').text(r.data.length);
      }
    });
  }
  cargarUnconfigured();
  setInterval(cargarUnconfigured, 30000);
});

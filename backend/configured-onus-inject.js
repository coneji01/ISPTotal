// Script de inyeccion para smartolt_configured_full.ejs
// Carga datos desde /api/onu/configured-list y renderiza la tabla
module.exports = function() {
  return '<script>\n' +
  'function cargarConfigured(pag) {\n' +
  '  pag = pag || 1;\n' +
  '  $.ajax({ url: "/api/onu/configured-list?page=" + pag + "&per_page=100&_=" + Date.now(), method: "GET", dataType: "json",\n' +
  '    success: function(r) {\n' +
  '      if (!r.success || !r.data) return;\n' +
  '      var h = \'<div class="table-responsive"><table class="table table-striped table-bordered"><thead><tr><th></th><th>Status</th><th>View</th><th>Name</th><th>SN / MAC</th><th>ONU</th><th>Zone</th><th>ODB</th><th>Signal</th><th>B/R</th><th>VLAN</th><th>VoIP</th><th>TV</th><th>Type</th><th>Auth date</th></tr></thead><tbody>\';\n' +
  '      r.data.forEach(function(o) {\n' +
  '        var ic = "fa-globe text-green";\n' +
  '        if (o.state === "pwrfail") ic = "fa-exclamation-triangle text-warning";\n' +
  '        else if (o.state === "los") ic = "fa-times-circle text-red";\n' +
  '        else if (o.state === "offline") ic = "fa-circle text-grey";\n' +
  '        h += \'<tr class="valign-center"><td></td><td class="text-center"><i class="fa \' + ic + \'" style="font-size:16px"></i></td>\';\n' +
  '        h += \'<td class="text-center"><a href="/onu/view/\' + o.id + \'" class="btn btn-success btn-xs">View</a></td>\';\n' +
  '        h += \'<td><span class="onu-copy-cell" data-copy="\' + $(\'<div>\').text(o.name||"").html() + \'">\' + $(\'<div>\').text(o.name||"").html() + \'</span></td>\';\n' +
  '        h += \'<td><span class="onu-copy-cell" data-copy="\' + (o.sn||"") + \'">\' + (o.sn||"") + \'</span></td>\';\n' +
  '        h += \'<td style="font-size:12px">\' + (o.description||"") + \'</td>\';\n' +
  '        h += \'<td>\' + (o.zone_name||"") + \'</td>\';\n' +
  '        h += \'<td>\' + (o.odb||"") + \'</td>\';\n' +
  '        h += \'<td style="white-space:nowrap">\' + (o.signal||"") + \'</td>\';\n' +
  '        h += \'<td>\' + (o.mode||"") + \'</td>\';\n' +
  '        h += \'<td>\' + (o.vlan||"") + \'</td>\';\n' +
  '        h += \'<td>\' + (o.voip||"") + \'</td>\';\n' +
  '        h += \'<td>\' + (o.tv||"") + \'</td>\';\n' +
  '        h += \'<td>\' + (o.onu_type_name||"") + \'</td>\';\n' +
  '        h += \'<td style="white-space:nowrap">\' + (o.auth_date||"") + \'</td></tr>\';\n' +
  '      });\n' +
  '      h += \'</tbody></table></div>\';\n' +
  '      var tp = r.last_page || 1;\n' +
  '      h += \'<div class="text-center"><ul class="pagination pagination-sm">\';\n' +
  '      for (var i = 1; i <= tp; i++) {\n' +
  '        h += \'<li class="\' + (i === pag ? "active":"") + \'"><a href="#" onclick="cargarConfigured(\' + i + \');return false">\' + i + \'</a></li>\';\n' +
  '      }\n' +
  '      h += \'</ul></div>\';\n' +
  '      var f = (pag-1)*100+1, t = Math.min(pag*100, r.total);\n' +
  '      h += \'<div class="text-muted text-center" style="font-size:12px;padding:5px">\' + f + \'-\' + t + \' ONUs of \' + r.total + \' displayed</div>\';\n' +
  '      $("#onu_configured_list").html(h);\n' +
  '    }\n' +
  '  });\n' +
  '}\n' +
  // Usar setTimeout largo para ejecutarse DESPUES de todos los scripts del clon
  'setTimeout(function() { if ($("#onu_configured_list").length) cargarConfigured(1); }, 1500);\n' +
  '</script>';
};

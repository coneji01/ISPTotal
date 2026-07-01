// dashboard-realtime.js
// Intercepta llamadas AJAX a SmartOLT y las redirige a endpoints locales
(function() {
  var origAjax = $.ajax;
  $.ajax = function(opts) {
    if (opts && opts.url) {
      var u = opts.url;
      // Solo interceptar llamadas a smartolt.com
      if (u.indexOf('smartolt.com') >= 0) {
        var newUrl = u;
        if (u.indexOf('/dashboard/get_onus_stats/') >= 0) newUrl = '/dashboard/get_onus_stats/1';
        else if (u.indexOf('/dashboard/get_waiting_auth/') >= 0) newUrl = '/dashboard/get_waiting_auth/1';
        else if (u.indexOf('/dashboard/get_onus_signals/') >= 0) newUrl = '/dashboard/get_onus_signals/1';
        else if (u.indexOf('/dashboard/get_onus_auth_per_day/') >= 0) newUrl = '/dashboard/get_onus_auth_per_day/1';
        else if (u.indexOf('/dashboard/get_outage_pons/') >= 0) newUrl = '/dashboard/get_outage_pons/1';
        else if (u.indexOf('/graphs_olt/') >= 0) newUrl = '/graphs_olt/get_onus_statuses_series/daily/1';
        else if (u.indexOf('/olt/get_olt_uptime_batch') >= 0) newUrl = '/olt/get_olt_uptime_batch';
        
        if (newUrl !== u) {
          opts.url = newUrl;
          opts.headers = opts.headers || {};
          delete opts.headers['X-Token'];
          delete opts.beforeSend;
        }
      }
    }
    return origAjax.call(this, opts);
  };
  
  // Forzar refresco inmediato
  $(function() {
    setTimeout(function() {
      if (typeof actualizarDashboard === 'function') actualizarDashboard();
    }, 1500);
  });
})();

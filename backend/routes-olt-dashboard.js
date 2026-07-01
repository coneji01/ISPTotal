// routes-olt-dashboard.js - Endpoints para el dashboard OLT
// Se carga desde server.js con app.use()

module.exports = function(app, db, requireAuth) {

  // GET /api/olt/stats - Estadísticas generales de la OLT
  app.get('/api/olt/stats', requireAuth, function(req, res) {
    try {
      var stats = db.prepare('SELECT * FROM olt_stats WHERE olt_id=1 ORDER BY updated_at DESC LIMIT 1').get();
      if (!stats) return res.json({ success: true, total: 0, online: 0, offline: 0, pwrfail: 0, los: 0, waiting_auth: 0, uptime: 'N/A', temperature: 'N/A' });
      res.json({
        success: true,
        total: stats.total_onus,
        online: stats.online_count,
        offline: stats.offline_count,
        pwrfail: stats.pwrfail_count,
        los: stats.los_count,
        waiting_auth: stats.waiting_auth,
        uptime: stats.uptime || 'N/A',
        temperature: stats.temperature || 'N/A',
        updated_at: stats.updated_at
      });
    } catch(e) {
      res.json({ success: false, error: e.message });
    }
  });

  // GET /api/olt/status-history - Historial para gráficos
  app.get('/api/olt/status-history', requireAuth, function(req, res) {
    try {
      var period = req.query.period || 'daily';
      var limit = 24;
      if (period === 'weekly') limit = 168;
      else if (period === 'monthly') limit = 720;
      var data = db.prepare('SELECT timestamp, working, power_fail as pwrfail, los, offline FROM olt_status_history WHERE olt_id=1 ORDER BY timestamp DESC LIMIT ?').all(limit);
      var series = [
        { key: 'working', color: '#28a745', label: 'Working', points: [] },
        { key: 'powerFail', color: '#ff851b', label: 'Power Fail', points: [] },
        { key: 'los', color: '#e83e8c', label: 'LoS', points: [] },
        { key: 'offline', color: '#dc3545', label: 'Offline', points: [] }
      ];
      data.reverse().forEach(function(row) {
        var ts = new Date(row.timestamp).getTime();
        series[0].points.push([ts, row.working]);
        series[1].points.push([ts, row.pwrfail]);
        series[2].points.push([ts, row.los]);
        series[3].points.push([ts, row.offline]);
      });
      res.json({ success: true, series: series });
    } catch(e) {
      res.json({ success: false, error: e.message });
    }
  });

  // GET /api/olt/activity - Feed de actividad reciente
  app.get('/api/olt/activity', requireAuth, function(req, res) {
    try {
      var activity = db.prepare('SELECT * FROM olt_activity WHERE olt_id=1 ORDER BY created_at DESC LIMIT 20').all();
      res.json({ success: true, data: activity });
    } catch(e) {
      res.json({ success: false, error: e.message });
    }
  });

  // GET /api/olt/sync - Forzar sincronización manual
  app.post('/api/olt/sync', requireAuth, function(req, res) {
    try {
      var syncOLT = require('../scripts/sync-olt-stats');
      syncOLT().then(function(result) {
        res.json(result);
      }).catch(function(e) {
        res.json({ success: false, error: e.message });
      });
    } catch(e) {
      res.json({ success: false, error: e.message });
    }
  });

  // GET /api/olt/uptime - Uptime de la OLT
  app.get('/api/olt/uptime', requireAuth, function(req, res) {
    try {
      var stats = db.prepare('SELECT uptime, temperature, updated_at FROM olt_stats WHERE olt_id=1 ORDER BY updated_at DESC LIMIT 1').get();
      if (stats) {
        res.json({ success: true, olt_id: 1, uptime: stats.uptime, temperature: stats.temperature, updated_at: stats.updated_at });
      } else {
        res.json({ success: true, olt_id: 1, uptime: 'N/A', temperature: 'N/A' });
      }
    } catch(e) {
      res.json({ success: false, error: e.message });
    }
  });

};

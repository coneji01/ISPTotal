module.exports = {
  apps: [{
    name: 'isptotal',
    script: 'backend/server.js',
    cwd: '/home/jellyfin/.openclaw/workspace/ISPTotal',
    
    // Auto-reinicio en crash
    autorestart: true,
    max_restarts: 50,
    restart_delay: 2000,
    min_uptime: 10000,
    
    // Watchdog de memoria: reiniciar si pasa 500MB
    max_memory_restart: '500M',
    
    // Logs
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: '/home/jellyfin/.openclaw/workspace/ISPTotal/logs/error.log',
    out_file: '/home/jellyfin/.openclaw/workspace/ISPTotal/logs/out.log',
    merge_logs: true,
    
    // Entorno
    env: {
      NODE_ENV: 'production'
    },
    
    // Tiempo de espera antes de forzar kill en shutdown
    kill_timeout: 5000,
    
    // Forzar kill si no responde
    force: true,
    
    // Watch de cambios en archivos (desactivado para producción)
    watch: false,
    
    // Instancia única
    instances: 1,
    exec_mode: 'fork',

    // Limpiar logs viejos
    max_size: '10M',
    retain: 5
  }]
};

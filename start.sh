#!/bin/bash
# Auto-arranque del sistema ISP Total
export PATH=$PATH:/home/jellyfin/.npm-global/bin
cd /home/jellyfin/.openclaw/workspace/ISPTotal

# Matar cualquier proceso zombie que haya quedado colgado
CUR_PID=$(lsof -ti:3020 2>/dev/null)
if [ -n "$CUR_PID" ]; then
  for pid in $CUR_PID; do
    kill -9 $pid 2>/dev/null
  done
  sleep 1
fi

# Iniciar con PM2
pm2 start ecosystem.config.js --no-daemon

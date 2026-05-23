#!/bin/bash
# 🛡️ Watchdog de ISP Total — Skynet
# Corre cada 30 segundos para mantener el server vivo
# ====================================================

SERVER_PORT=3020
SERVER_DIR="/home/joel/.openclaw/workspace/isptotal"
SERVER_LOG="/tmp/isptotal-server.log"
WA_SESSIONS="$SERVER_DIR/data/wa-sessions"

# Verificar si el server responde
curl -s -o /dev/null -w "" http://localhost:$SERVER_PORT/ 2>/dev/null
if [ $? -ne 0 ]; then
    echo "[Watchdog] $(date) Server caído, reiniciando..."

    # Limpiar locks huérfanos antes de reiniciar
    find "$WA_SESSIONS" -name "Singleton*" -delete 2>/dev/null
    find "$WA_SESSIONS" -name "*.lock" -delete 2>/dev/null
    find "$SERVER_DIR/openwa-sessions" -name "Singleton*" -delete 2>/dev/null

    # Matar cualquier chrome zombie de puppeteer
    ps aux | grep "[p]uppeteer" | awk '{print $2}' | xargs kill -9 2>/dev/null

    # Iniciar server
    cd "$SERVER_DIR" && node backend/server.js > "$SERVER_LOG" 2>&1 &
    echo "[Watchdog] $(date) Server reiniciado (PID $!)"
fi

# Verificar que el OpenWA admin esté conectado (opcional)
if [ -f "$SERVER_LOG" ]; then
    LAST_CONNECTED=$(grep -c "Conectado a WhatsApp" "$SERVER_LOG" 2>/dev/null)
    echo "[Watchdog] $(date) OK - Conexiones WA: $LAST_CONNECTED"
fi

#!/bin/bash
# Sincronizar cambios al Docker de producción
# Las DBs ya están unificadas, solo reinicia el backend si es necesario

set -e

echo "🔄 Sincronizando cambios al Docker isptotal-demo..."
echo ""

# Verificar que el contenedor existe
if ! sudo docker ps --format '{{.Names}}' | grep -q isptotal-demo; then
    echo "❌ Contenedor isptotal-demo no está corriendo"
    echo "   Iniciándolo..."
    PROJECT_DIR="/home/jellyfin/.openclaw/workspace/ISPTotal"
    sudo docker run -d \
      --name isptotal-demo \
      --restart unless-stopped \
      -p 80:3020 \
      -e PORT=3020 \
      -e NODE_ENV=production \
      -v $PROJECT_DIR/backend:/app/backend \
      -v $PROJECT_DIR/views:/app/views \
      -v $PROJECT_DIR/frontend:/app/frontend \
      -v $PROJECT_DIR/scripts:/app/scripts \
      -v $PROJECT_DIR/package.json:/app/package.json \
      -v $PROJECT_DIR/isptotal.db:/app/isptotal.db \
      -v $PROJECT_DIR/data:/app/data \
      isptotal-demo:latest
    echo "✅ Contenedor creado"
fi

echo "📁 Bind mounts activos:"
echo "   • backend/    → /app/backend"
echo "   • views/      → /app/views"
echo "   • frontend/   → /app/frontend"
echo "   • isptotal.db → /app/isptotal.db (UNIFICADA)"
echo "   • data/       → /app/data"
echo ""

echo "🔄 Aplicando cambios del backend..."
sudo docker restart isptotal-demo
sleep 3

echo "✅ Contenedor reiniciado"
echo ""
sudo docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep isptotal-demo
echo ""
echo "🌐 http://38.159.230.88 (producción)"
echo "🌐 http://192.168.100.40:3020 (desarrollo)"
echo ""
echo "📌 Nota: Los cambios en vistas se ven al recargar la página (sin reinicio)"

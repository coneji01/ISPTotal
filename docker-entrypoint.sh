#!/bin/sh
set -e

cd /app

# Si no existe la base de datos, crearla desde schema.sql
if [ ! -f isptotal.db ]; then
    node scripts/init-demo-db.js
    node scripts/generate-demo-data.js
fi

echo "🚀 Iniciando ISPTotal en puerto $PORT"
cd backend
exec node server.js

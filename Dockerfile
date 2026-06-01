FROM node:22-alpine

WORKDIR /app

# Solo dependencias esenciales del sistema
RUN apk add --no-cache ca-certificates sqlite

# Copiar proyecto
COPY package*.json ./
COPY backend/ ./backend/
COPY views/ ./views/
COPY frontend/ ./frontend/
COPY scripts/ ./scripts/

# Instalar dependencias npm (necesita build tools para better-sqlite3)
RUN apk add --no-cache build-base python3 && npm install 2>&1 | tail -5

ENV PORT=3020
EXPOSE 3020

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]

# syntax=docker/dockerfile:1.7
# ^ Necesario para los cache mounts (--mount=type=cache). Coolify usa BuildKit por defecto.

# Imagen Debian slim (glibc), NO Alpine: sharp, node-forge, xml-crypto, pg, fontkit
# traen o enlazan binarios nativos que en musl (Alpine) dan dolores de cabeza.
ARG NODE_IMAGE=node:22-slim

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: deps — instala node_modules en una capa que SOLO se invalida cuando
# cambian package.json / package-lock.json.
# ─────────────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

# Copiamos SOLO los manifiestos primero. Mientras el lockfile no cambie, Docker
# reutiliza esta capa entera y npm ci ni corre.
COPY package.json package-lock.json ./

# npm ci = install limpio y reproducible desde el lockfile.
# Cache mount de ~/.npm: aunque npm ci borre node_modules, los tarballs salen del
# caché en vez de bajarse de la red otra vez.
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: builder — compila Next con caché incremental persistente entre deploys.
# ─────────────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

# Reusamos node_modules ya instalados (no reinstalamos).
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Telemetría off y modo producción.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Cache mount en .next/cache: acá vive el caché incremental del compilador de Next.
# Persiste en el builder entre deploys, así Next recompila solo lo que cambió en
# vez de las ~984 páginas desde cero. Es la optimización de mayor impacto.
# (typescript.ignoreBuildErrors ya está en next.config.ts; no se toca acá.)
RUN --mount=type=cache,target=/app/.next/cache \
    npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: runner — imagen final mínima. Solo lo que la app necesita para correr.
# ─────────────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# standalone arranca con `node server.js`, que lee estas dos variables.
# Sin HOSTNAME=0.0.0.0 el server escucha en localhost y el contenedor NO acepta
# conexiones externas (Coolify/nginx no llega).
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# ffmpeg + ffprobe: dependencia de SISTEMA (no de npm). La ruta
# src/app/api/chat/send-media/route.ts los invoca por execFile para transcodificar
# audio a MP3 y comprimir video < 16 MB antes de mandarlos por WhatsApp. Sin esto,
# el envío de notas de voz y videos grandes se rompe SOLO en runtime, no en el build.
# ffmpeg (paquete Debian) incluye ffprobe.
#
# curl: lo necesita el HEALTHCHECK de Coolify, que corre DENTRO del contenedor
# (GET http://localhost:3000/... con curl/wget). node:22-slim no trae ninguno de los
# dos, así que sin esto la imagen buildea y arranca, pero Coolify la marca "unhealthy"
# y descarta el deploy aunque la app esté sirviendo bien.
# Limpiamos apt lists para no engordar la capa.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

# Usuario no-root (buena práctica; standalone no necesita root).
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# Salida standalone: server.js + el subconjunto mínimo de node_modules que Next
# rastreó como necesarios (incluye sharp y demás nativos usados por el código).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Assets estáticos (JS/CSS con hash) — standalone NO los copia solo.
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# public/: la app lo lee en runtime (fuentes de tickets de sorteo, logo del KUDE).
# standalone NO lo copia solo.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

# standalone arranca así, NO con `next start`.
CMD ["node", "server.js"]

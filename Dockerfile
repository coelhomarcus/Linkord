# ---- estagio 1: build do frontend (React + TS + Tailwind, via Vite) ----
FROM node:22-alpine AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- estagio 2: compilacao do servidor TypeScript ----
FROM node:22-alpine AS server-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY server/ ./server/
RUN npm run build:server

# ---- estagio 3: dependencias de producao do servidor ----
FROM node:22-alpine AS server-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- estagio 4: runtime enxuto (sem devDependencies, sem fonte do frontend) ----
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY --from=server-deps /app/node_modules ./node_modules
COPY package.json ./
COPY --from=server-build /app/server/dist ./server/dist
COPY server/db/migrations ./server/db/migrations
COPY --from=web-build /app/web/dist ./web/dist

EXPOSE 3000
ENV HOST_BIND=0.0.0.0 PORT=3000 TRUST_PROXY=1

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/healthz > /dev/null || exit 1

CMD ["node", "server/dist/index.js"]

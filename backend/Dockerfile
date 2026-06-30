FROM node:20-slim

WORKDIR /app

# Install dependencies first for better layer caching. A lockfile is present,
# but npm install (not ci) is used so a minor package.json drift won't fail the
# build on the free plan.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .
RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production
# Render injects PORT at runtime; the app falls back to 3001 locally.
EXPOSE 3001

# Entrypoint runs idempotent migrate + seed, then starts the server.
CMD ["./docker-entrypoint.sh"]

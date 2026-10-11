# GrowMetric backend image — runs BOTH the HTTP API and the job worker
# inside a single container. They coordinate through the shared database
# (Neon), so no Redis or extra services are required.
#
#   build:   docker build -t growmetric-backend --build-arg PORT=7860 .
#   run:     docker run -p 7860:7860 --env-file .env growmetric-backend
#
# Set PORT to match the platform (Hugging Face expects 7860).

FROM node:20-bookworm-slim AS deps
WORKDIR /growmetric
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS build
WORKDIR /growmetric
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=deps /growmetric/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime
WORKDIR /growmetric
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=7860
COPY --from=build /growmetric/node_modules ./node_modules
COPY --from=build /growmetric/dist ./dist
COPY --from=build /growmetric/prisma ./prisma
COPY --from=build /growmetric/package.json ./package.json

EXPOSE 7860

# Start the job worker and the API together in one container. `wait -n` keeps
# the container alive until either process exits (matching orchestrator
# restart behavior on crashes).
CMD ["bash", "-c", "node dist/src/workers/runner.js & node dist/src/server.js & wait -n"]